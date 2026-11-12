import * as THREE from 'three';
import type { CircuitId, CircuitLevels } from '../../core/types/knx.ts';
import type { TimeOfDay } from '../../core/types/scene.ts';
import type { RoomZoneLodRegistration } from '../../core/entities.ts';
import { BakedLightVolumeController, setAnyPointLightsActive } from './baked-light-volume.ts';
import type { LightGroupMap, ZoneIndicatorMaterials } from '../viewer/scene-types.ts';

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
import type {
  CircuitFixtureAppearance,
  SwitchLedIndicatorKey,
  SwitchLedIndicatorRule,
} from '../viewer/property-scene-profile.ts';
import type { RoomSwitchLedBinding } from '../viewer/scene-content.ts';
import {
  getPointLightBudgetWeight,
  notifyCircuitLevelsChanged,
} from '../rendering/scene-batch-optimizer.ts';
import { FittingEffects } from './fitting-fx.ts';

const SWITCH_LED_ON = 3.0;
const SWITCH_LED_OFF = 0.15;

export interface CircuitLightingOptions {
  readonly lightGroups: LightGroupMap;
  readonly indicatorMats: ZoneIndicatorMaterials;
  readonly roomSwitchLedMats: readonly RoomSwitchLedBinding[];
  readonly switchLedRules: readonly SwitchLedIndicatorRule[];
  readonly defaultFixtureAppearance: CircuitFixtureAppearance;
  readonly fixtureAppearanceOverrides: Readonly<Partial<Record<CircuitId, CircuitFixtureAppearance>>>;
  readonly tvArtTextures: readonly THREE.CanvasTexture[];
  readonly tvOffTexture: THREE.CanvasTexture;
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
 * Distance (m) at which a light keeps its authored brightness when switching to inverse-square
 * decay (≈ ceiling fitting → worktop/floor). Closer surfaces get brighter, farther ones darker.
 */
const DECAY_REFERENCE_DISTANCE_M = 2.0;

/** `userData` key: intensity gain compensating an authored decay < 2 at the reference distance. */
const DECAY_GAIN_KEY = 'knxDecayGain';

/** Switches every KNX circuit light to inverse-square decay, preserving brightness at ~2 m. */
function adoptPhysicalDecay(lightGroups: LightGroupMap): void {
  for (const group of Object.values(lightGroups)) {
    if (!group) continue;
    for (const light of group.lights) {
      if (typeof light.userData?.[DECAY_GAIN_KEY] === 'number') continue;
      const isOutbuilding = light.name.startsWith('outbuildings.');
      const refDist = isOutbuilding ? 3.2 : DECAY_REFERENCE_DISTANCE_M;
      const outbuildingBoost = isOutbuilding ? 2.4 : 1.0;
      const gain = Math.pow(refDist, CIRCUIT_LIGHT_DECAY - light.decay) * outbuildingBoost;
      light.decay = CIRCUIT_LIGHT_DECAY;
      if (!light.userData) light.userData = {};
      light.userData[DECAY_GAIN_KEY] = gain;
    }
  }
}

/**
 * Drives every KNX-controlled visual in the scene: point lights, emissive
 * fixtures, light cones, glow pools, switch/sensor status LEDs and the Frame TV.
 */
export class CircuitLightingController {
  private readonly lightGroups: LightGroupMap;
  private readonly roomSwitchLedMats: readonly RoomSwitchLedBinding[];
  private readonly switchLedRules: readonly SwitchLedIndicatorRule[];
  private readonly defaultFixtureAppearance: CircuitFixtureAppearance;
  private readonly fixtureAppearanceOverrides: Readonly<
    Partial<Record<CircuitId, CircuitFixtureAppearance>>
  >;
  private readonly switchLedMats: Readonly<Record<SwitchLedIndicatorKey, THREE.MeshStandardMaterial>>;
  private readonly kitchenSensorLedMat: THREE.MeshStandardMaterial;
  private readonly utilitySensorLedMat: THREE.MeshStandardMaterial;
  private readonly tvScreenMat: THREE.MeshStandardMaterial;
  private readonly tvArtTextures: readonly THREE.CanvasTexture[];
  private readonly tvOffTexture: THREE.CanvasTexture;
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
    this.tvArtTextures = options.tvArtTextures;
    this.tvOffTexture = options.tvOffTexture;
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
    adoptPhysicalDecay(options.lightGroups);
    this.bakedVolume = new BakedLightVolumeController(
      options.lightGroups,
      options.lodRegistrations ?? [],
      resolvedSceneRoot
    );

    // Missing indicators all share one detached fallback material so writes are harmless.
    const indicatorMats = options.indicatorMats;
    const fallbackMat = new THREE.MeshStandardMaterial();
    this.tvScreenMat = indicatorMats.tvScreenMat ?? fallbackMat;
    this.switchLedMats = {
      wallSwitchLedMat: indicatorMats.wallSwitchLedMat ?? fallbackMat,
      courtyardSwitchLedMat: indicatorMats.courtyardSwitchLedMat ?? fallbackMat,
      utilitySwitchLedMat: indicatorMats.utilitySwitchLedMat ?? fallbackMat,
    };
    this.kitchenSensorLedMat = indicatorMats.kitchenSensorLedMat ?? fallbackMat;
    this.utilitySensorLedMat = indicatorMats.utilitySensorLedMat ?? fallbackMat;
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
        // Pure function of KNX level × time of day (× the fixed, room-anchored light-budget fade
        // weight). Never depends on camera position, zoom or floor/cutaway mode.
        light.intensity = targetIntensity * getPointLightBudgetWeight(light);
      }
      for (const mat of group.emissives) {
        const customEmissiveMax =
          typeof mat.userData?.baseEmissiveIntensity === 'number'
            ? (mat.userData.baseEmissiveIntensity as number)
            : appearance.emissiveMax;
        // Bulb cores / LED diffusers get a high HDR gain so they saturate to near-white and bloom.
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

    // Re-rank the point-light budget now so a newly switched-on circuit is never left dark.
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
      const anyOn = rule.circuits.some((circuitId) => (liveLevels[circuitId] ?? 0) > 1);
      this.switchLedMats[rule.material].emissiveIntensity = anyOn ? SWITCH_LED_ON : SWITCH_LED_OFF;
    }

    for (const { circuitId, mat } of this.roomSwitchLedMats) {
      const isOn = (liveLevels[circuitId] ?? 0) > 1;
      mat.emissiveIntensity = isOn ? SWITCH_LED_ON : SWITCH_LED_OFF;
    }
  }

  public setMotionSensorStates(kitchenMotion: boolean, utilityMotion: boolean): void {
    this.kitchenSensorLedMat.color.setHex(kitchenMotion ? 0x4be07a : 0x555c66);
    this.kitchenSensorLedMat.emissive.setHex(kitchenMotion ? 0x32c864 : 0x22262c);
    this.kitchenSensorLedMat.emissiveIntensity = kitchenMotion ? 2.6 : 0.2;

    this.utilitySensorLedMat.color.setHex(utilityMotion ? 0x4be07a : 0x555c66);
    this.utilitySensorLedMat.emissive.setHex(utilityMotion ? 0x32c864 : 0x22262c);
    this.utilitySensorLedMat.emissiveIntensity = utilityMotion ? 2.6 : 0.2;
  }

  /** Returns true if the TV screen material changed. */
  public setTVArtState(artModeOn: boolean, artIndex: number): boolean {
    if (artModeOn) {
      const tex =
        this.tvArtTextures[artIndex % this.tvArtTextures.length] ?? this.tvArtTextures[0];
      if (tex && (this.tvScreenMat.map !== tex || this.tvScreenMat.emissiveIntensity !== 0.04)) {
        this.tvScreenMat.map = tex;
        this.tvScreenMat.emissiveMap = tex;
        this.tvScreenMat.color.setHex(0xa69e92);
        this.tvScreenMat.emissive.setHex(0xffffff);
        this.tvScreenMat.emissiveIntensity = 0.04;
        this.tvScreenMat.needsUpdate = true;
        return true;
      }
    } else if (this.tvScreenMat.map !== this.tvOffTexture || this.tvScreenMat.emissiveIntensity !== 0) {
      this.tvScreenMat.map = this.tvOffTexture;
      this.tvScreenMat.emissiveMap = null;
      this.tvScreenMat.color.setHex(0x3a3d42);
      this.tvScreenMat.emissive.setHex(0x000000);
      this.tvScreenMat.emissiveIntensity = 0;
      this.tvScreenMat.needsUpdate = true;
      return true;
    }
    return false;
  }
}
