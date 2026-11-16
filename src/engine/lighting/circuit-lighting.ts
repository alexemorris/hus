import * as THREE from 'three';
import type { CircuitId, CircuitLevels } from '../../core/types/knx.ts';
import type { TimeOfDay } from '../../core/types/scene.ts';
import type { RoomZoneLodRegistration } from '../../core/entities.ts';
import { BakedLightVolumeController, setAnyPointLightsActive } from './baked-light-volume.ts';
import type { LightGroupMap, ZoneIndicatorMaterials } from '../viewer/scene-types.ts';
import type {
  CircuitFixtureAppearance,
  SwitchLedIndicatorRule,
} from '../viewer/property-scene-profile.ts';
import type { RoomSwitchLedBinding } from '../viewer/scene-content.ts';
import {
  getPointLightBudgetWeight,
  notifyCircuitLevelsChanged,
} from '../rendering/scene-batch-optimizer.ts';
import { FittingEffects } from './fitting-fx.ts';

const TOD_INDOOR_LIGHT_SCALE: Readonly<
  Record<
    TimeOfDay,
    {
      readonly lightScale: number;
      readonly emissiveScale: number;
      readonly coneScale: number;
      readonly poolScale: number;
    }
  >
> = {
  day: {
    lightScale: 0.68,
    emissiveScale: 0.95,
    coneScale: 0.45,
    poolScale: 0.50,
  },
  dusk: {
    lightScale: 0.62,
    emissiveScale: 0.94,
    coneScale: 0.55,
    poolScale: 0.60,
  },
  night: {
    lightScale: 1.0,
    emissiveScale: 1.0,
    coneScale: 1.0,
    poolScale: 1.0,
  },
};

const SWITCH_LED_ON = 3.0;
const SWITCH_LED_OFF = 0.15;

export interface CircuitLightingOptions {
  readonly lightGroups: LightGroupMap;
  readonly indicatorMats?: ZoneIndicatorMaterials;
  readonly roomSwitchLedMats: readonly RoomSwitchLedBinding[];
  readonly switchLedRules: readonly SwitchLedIndicatorRule[];
  readonly defaultFixtureAppearance: CircuitFixtureAppearance;
  readonly fixtureAppearanceOverrides: Readonly<Partial<Record<CircuitId, CircuitFixtureAppearance>>>;
  readonly circuitIntensityMultipliers?: Readonly<Record<CircuitId, number>>;
  /**
   * Root searched for fitting meshes when building runtime fitting effects (halos, LED washes,
   * fill lights). Defaults to the root ancestor of the circuit lights.
   */
  readonly sceneRoot?: THREE.Object3D;
  readonly lodRegistrations?: readonly RoomZoneLodRegistration[];
}

/** Inverse-square falloff for KNX circuit lights: tight pools under fittings, darker room edges. */
const CIRCUIT_LIGHT_DECAY = 2;

/**
 * Default distance (m) at which a light keeps its authored brightness when switching to inverse-square
 * decay (≈ ceiling fitting → worktop/floor). Individual lights may override via `light.userData.decayReferenceDistanceM`
 * and `light.userData.circuitIntensityScale`.
 */
const DECAY_REFERENCE_DISTANCE_M = 2.0;

/** `userData` key: intensity gain compensating an authored decay < 2 at the reference distance. */
const DECAY_GAIN_KEY = 'knxDecayGain';

function adoptPhysicalDecay(
  lightGroups: LightGroupMap,
  circuitIntensityMultipliers?: Readonly<Record<CircuitId, number>>
): void {
  for (const [circuitId, group] of Object.entries(lightGroups)) {
    if (!group) continue;
    const circuitMultiplier = circuitIntensityMultipliers?.[circuitId] ?? 1.0;
    for (const light of group.lights) {
      if (typeof light.userData?.[DECAY_GAIN_KEY] === 'number') continue;
      const customRefDist =
        typeof light.userData?.decayReferenceDistanceM === 'number'
          ? (light.userData.decayReferenceDistanceM as number)
          : DECAY_REFERENCE_DISTANCE_M;
      const customScale =
        typeof light.userData?.circuitIntensityScale === 'number'
          ? (light.userData.circuitIntensityScale as number)
          : 1.0;
      const gain =
        Math.pow(customRefDist, CIRCUIT_LIGHT_DECAY - light.decay) *
        customScale *
        circuitMultiplier;
      light.decay = CIRCUIT_LIGHT_DECAY;
      if (!light.userData) light.userData = {};
      light.userData[DECAY_GAIN_KEY] = gain;
    }
  }
}

/**
 * Drives every KNX-controlled visual in the scene: point lights, emissive
 * fixtures, light cones, glow pools, and data-driven switch/sensor status LEDs.
 */
export class CircuitLightingController {
  private readonly lightGroups: LightGroupMap;
  private readonly roomSwitchLedMats: readonly RoomSwitchLedBinding[];
  private readonly switchLedRules: readonly SwitchLedIndicatorRule[];
  private readonly defaultFixtureAppearance: CircuitFixtureAppearance;
  private readonly fixtureAppearanceOverrides: Readonly<
    Partial<Record<CircuitId, CircuitFixtureAppearance>>
  >;
  private readonly switchLedMats: Readonly<Record<string, THREE.MeshStandardMaterial>>;
  private readonly sensorLedMats: Readonly<Record<string, THREE.MeshStandardMaterial>>;
  private readonly fittingEffects: FittingEffects;
  public readonly bakedVolume: BakedLightVolumeController;
  private timeOfDay: TimeOfDay = 'dusk';
  private lastLevels: Readonly<CircuitLevels> | null = null;

  public constructor(options: CircuitLightingOptions) {
    this.lightGroups = options.lightGroups;
    this.roomSwitchLedMats = options.roomSwitchLedMats;
    this.switchLedRules = options.switchLedRules;
    this.defaultFixtureAppearance = options.defaultFixtureAppearance;
    this.fixtureAppearanceOverrides = options.fixtureAppearanceOverrides;
    this.switchLedMats = options.indicatorMats?.switchLedMats ?? {};
    this.sensorLedMats = options.indicatorMats?.sensorLedMats ?? {};
    // Must run before SceneBatchOptimizer.optimize() so synthetic fill lights join the budget.
    this.fittingEffects = new FittingEffects({
      lightGroups: options.lightGroups,
      sceneRoot: options.sceneRoot,
    });

    let resolvedSceneRoot = options.sceneRoot;
    if (!resolvedSceneRoot) {
      for (const group of Object.values(options.lightGroups)) {
        const firstLight = group?.lights[0];
        if (firstLight && firstLight.parent) {
          let root: THREE.Object3D = firstLight.parent;
          while (root.parent) root = root.parent;
          resolvedSceneRoot = root;
          break;
        }
      }
    }
    adoptPhysicalDecay(options.lightGroups, options.circuitIntensityMultipliers);
    this.bakedVolume = new BakedLightVolumeController(
      options.lightGroups,
      options.lodRegistrations ?? [],
      resolvedSceneRoot
    );
  }

  public setTimeOfDay(mode: TimeOfDay): void {
    if (this.timeOfDay === mode) return;
    this.timeOfDay = mode;
    if (this.lastLevels) {
      this.applyLevels(this.lastLevels);
    }
  }

  public applyLevels(liveLevels: Readonly<CircuitLevels>, continuousFade = false): void {
    this.lastLevels = liveLevels;
    const todScale = TOD_INDOOR_LIGHT_SCALE[this.timeOfDay];
    const entries = Object.entries(this.lightGroups) as Array<
      [CircuitId, LightGroupMap[CircuitId]]
    >;

    const toClampedUnit = (levelPct: number | undefined): number => {
      const raw = levelPct ?? 0;
      return Number.isFinite(raw) ? Math.max(0, Math.min(1, raw / 100)) : 0;
    };

    for (const [circuitId, group] of entries) {
      const pct = toClampedUnit(liveLevels[circuitId]);
      const curved = Math.pow(pct, 1.35);
      const appearance =
        this.fixtureAppearanceOverrides[circuitId] ?? this.defaultFixtureAppearance;

      for (const light of group.lights) {
        const customMax =
          typeof light.userData?.baseIntensity === 'number'
            ? (light.userData.baseIntensity as number)
            : group.maxIntensity;
        const decayGain =
          typeof light.userData?.[DECAY_GAIN_KEY] === 'number'
            ? (light.userData[DECAY_GAIN_KEY] as number)
            : 1;
        const targetIntensity = customMax * decayGain * curved * todScale.lightScale;
        if (!light.userData) light.userData = {};
        light.userData.knxTargetIntensity = targetIntensity;
        light.intensity = targetIntensity * getPointLightBudgetWeight(light);
      }
      for (const mat of group.emissives) {
        const customEmissiveMax =
          typeof mat.userData?.baseEmissiveIntensity === 'number'
            ? (mat.userData.baseEmissiveIntensity as number)
            : appearance.emissiveMax;
        const gain = this.fittingEffects.getEmissiveGain(mat);
        mat.emissiveIntensity = customEmissiveMax * gain * pct * todScale.emissiveScale;
      }
      for (const coneMat of group.cones) {
        const nextOpacity = appearance.coneOpacity * pct * todScale.coneScale;
        coneMat.opacity = nextOpacity;
        coneMat.visible = nextOpacity > 0.002;
      }
      for (const pool of group.pools) {
        const nextOpacity = pool.maxOpacity * pct * todScale.poolScale;
        pool.mat.opacity = nextOpacity;
        pool.mat.visible = nextOpacity > 0.002;
      }
    }

    notifyCircuitLevelsChanged(this.lightGroups);
    this.bakedVolume.updateFromCircuitLevels(liveLevels, this.timeOfDay, continuousFade);

    this.fittingEffects.applyLevels(
      (circuitId) => toClampedUnit(liveLevels[circuitId]),
      todScale.emissiveScale
    );

    let anyPointActive = false;
    for (const [, group] of entries) {
      for (const light of group.lights) {
        const carriedActive =
          light.userData?.carriedByPool === true &&
          light.userData?.carrierPoolActive === true &&
          (typeof light.userData?.knxTargetIntensity === 'number'
            ? light.userData.knxTargetIntensity
            : light.intensity) > 1e-4;
        if ((light.visible && light.intensity > 1e-4) || carriedActive) {
          anyPointActive = true;
          break;
        }
      }
      if (anyPointActive) break;
    }
    if (!anyPointActive) {
      for (const fill of this.fittingEffects.getFillLights()) {
        const carriedActive =
          fill.userData?.carriedByPool === true &&
          fill.userData?.carrierPoolActive === true &&
          (typeof fill.userData?.knxTargetIntensity === 'number'
            ? fill.userData.knxTargetIntensity
            : fill.intensity) > 1e-4;
        if ((fill.visible && fill.intensity > 1e-4) || carriedActive) {
          anyPointActive = true;
          break;
        }
      }
    }
    setAnyPointLightsActive(anyPointActive);

    for (const rule of this.switchLedRules) {
      const mat = this.switchLedMats[rule.material];
      if (!mat) continue;
      const anyOn = rule.circuits.some((circuitId) => (liveLevels[circuitId] ?? 0) > 1);
      mat.emissiveIntensity = anyOn ? SWITCH_LED_ON : SWITCH_LED_OFF;
    }

    for (const { circuitId, mat } of this.roomSwitchLedMats) {
      const isOn = (liveLevels[circuitId] ?? 0) > 1;
      mat.emissiveIntensity = isOn ? SWITCH_LED_ON : SWITCH_LED_OFF;
    }
  }

  public setSensorLedState(sensorId: string, detected: boolean): boolean {
    const mat = this.sensorLedMats[sensorId];
    if (!mat) return false;
    const nextColor = detected ? 0x4be07a : 0x555c66;
    const nextEmissive = detected ? 0x32c864 : 0x22262c;
    const nextIntensity = detected ? 2.6 : 0.2;
    if (mat.emissiveIntensity === nextIntensity) return false;
    mat.color.setHex(nextColor);
    mat.emissive.setHex(nextEmissive);
    mat.emissiveIntensity = nextIntensity;
    return true;
  }

  public setSensorLedStates(states: Readonly<Record<string, boolean>>): boolean {
    let changed = false;
    for (const [sensorId, detected] of Object.entries(states)) {
      if (this.setSensorLedState(sensorId, detected)) {
        changed = true;
      }
    }
    return changed;
  }
}
