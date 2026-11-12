import * as THREE from 'three';
import {
  type ClusterPointLightInput,
  setAnyPointLightsActive,
  updateClusteredPointLightGrid,
} from '../../lighting/baked-light-volume.ts';
import type { RoomLodController } from '../../lod/lod-manager.ts';
import type { TimeOfDay } from '../../../core/types/scene.ts';
import type { LightGroupMap } from '../../viewer/scene-types.ts';
import type { RoomZoneId } from '../../../core/types/topology.ts';
import type { PropertySceneLayers } from '../../viewer/scene-content.ts';
import { SHADOW_PASS_HOOK_FLAG } from './scene-batch-classification.ts';

/** Desktop 'high'/'ultra' WebGPU PointLight carrier pool size (cuts unrolled WGSL & VGPR pressure 2x). */
export const CARRIER_POINT_LIGHT_POOL_SIZE = 8;
const CARRIER_SLOT_FADE_S = 0.18;

interface OriginalLightRecord {
  readonly light: THREE.PointLight;
  readonly originalParent: THREE.Object3D;
  readonly originalPosition: THREE.Vector3;
  readonly originalVisible: boolean;
  readonly originalIntensity: number;
  readonly originalDistance: number;
}

export interface ManagedPointLightEntry {
  readonly light: THREE.PointLight;
  readonly worldPos: THREE.Vector3;
  readonly isFirstFloor: boolean;
  readonly isStandalone: boolean;
  readonly baseIntensity: number;
}

/** World-space anchor (or room id) used to pick which point lights stay inside the light budget. */
export type PointLightBudgetAnchor = RoomZoneId | THREE.Vector3;

/** Seconds taken to fade a point light in/out when it enters or leaves the light budget. */
const POINT_LIGHT_BUDGET_FADE_S = 0.25;

/** Max intensity boost for a circuit's surviving lights when the budget drops some of them. */
const BUDGET_MAX_BOOST = 1.6;

/** Weight of vertical (floor-to-floor) distance when ranking lights against the budget anchor. */
const BUDGET_VERTICAL_WEIGHT = 3;

/** `userData` key holding a managed light's current budget fade weight (0..1). */
export const POINT_LIGHT_BUDGET_WEIGHT_KEY = 'budgetWeight';

/** Reads the budget fade weight that `SceneBatchOptimizer` stored on a light (1 when unmanaged). */
export function getPointLightBudgetWeight(light: THREE.Light): number {
  const w = light.userData?.[POINT_LIGHT_BUDGET_WEIGHT_KEY];
  return typeof w === 'number' ? w : 1;
}

/** Budget re-rank listeners keyed by the shared light-group map (one optimizer per scene). */
const levelChangeListeners = new WeakMap<LightGroupMap, () => void>();

/**
 * Called by the circuit lighting controller after it writes new KNX target intensities so the
 * light budget re-ranks immediately (outside the frame loop): newly switched-on circuits get a
 * slot at once instead of waiting for the next `stepFades`.
 */
export function notifyCircuitLevelsChanged(lightGroups: LightGroupMap): void {
  levelChangeListeners.get(lightGroups)?.();
}

/**
 * Userdata flag for runtime-added lights (e.g. synthetic fitting fill lights) whose parent may be
 * hidden by room LOD / floor modes: they are always hoisted to the scene root like 1F lights.
 */
export const ALWAYS_HOIST_LIGHT_FLAG = 'alwaysHoistLight';

export interface PointLightBudgetControllerOptions {
  readonly layers: PropertySceneLayers;
  readonly lodController: RoomLodController;
  readonly lightGroups: LightGroupMap;
  readonly snapshotParentChildren: (parent: THREE.Object3D) => void;
}

/**
 * Owns standalone `PointLight` 3.4 m × 3.4 m consolidation, 1F/cutaway light hoisting
 * (preserving invariant `NUM_POINT_LIGHTS`), KNX recency budget + 250 ms fades,
 * the `CARRIER_POINT_LIGHT_POOL_SIZE` invariant carrier pool, and zero-budget clustered grid sync.
 */
export class PointLightBudgetController {
  private readonly options: PointLightBudgetControllerOptions;
  private readonly originalLightRecords: OriginalLightRecord[] = [];
  private readonly managedPointLights: ManagedPointLightEntry[] = [];
  private readonly clusterCandidates: ClusterPointLightInput[] = [];
  private timeOfDay: TimeOfDay = 'dusk';

  // Fixed point-light budget (camera-independent). `Infinity` keeps every managed light active.
  private pointLightBudget = Number.POSITIVE_INFINITY;
  private budgetAnchor: PointLightBudgetAnchor | null = null;
  /** Per managed light (parallel to `managedPointLights`): current fade weight 0..1. */
  private readonly budgetWeights: number[] = [];
  /** Per managed light: target fade weight (0 = outside budget, 1 = inside). */
  private readonly budgetTargets: number[] = [];
  /** ON/OFF signature of the managed lights when the budget targets were last computed. */
  private budgetActivityKey = '';
  /**
   * KNX switch-on order per budget group (`circuit:<id>`): bumped whenever a circuit goes from OFF
   * to ON after boot. Recently switched-on circuits outrank older ones for budget slots, so the
   * room the user just lit never stays dark. Depends only on KNX history, never on the camera.
   */
  private readonly budgetGroupActivation = new Map<string, number>();
  private budgetActivationCounter = 0;

  // Optional invariant WebGPU PointLight carrier pool (opt-in from GraphicsService; disabled in headless lighting:check).
  private carrierPoolEnabled = false;
  private readonly carrierLights: THREE.PointLight[] = [];
  private readonly carrierLogicalIdx: number[] = [];
  private readonly carrierSlotFade: number[] = [];
  private readonly carrierCameraAnchor = new THREE.Vector3(0, 1.6, 0);
  private carrierHasCameraAnchor = false;
  private readonly lastScoredCameraPos = new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN);
  private carrierAssignmentDirty = true;

  public constructor(options: PointLightBudgetControllerOptions) {
    this.options = options;
    levelChangeListeners.set(options.lightGroups, () => this.handleCircuitLevelsChanged());
  }

  private getStandaloneLightTodScale(): number {
    // Outbuilding / Barn / Gym / Garage / Mezzanine / Stable interiors have deep footprints and minimal
    // window daylight, so their standalone task & ambient PointLights stay bright across all times of day.
    if (this.timeOfDay === 'day') return 1.15;
    if (this.timeOfDay === 'dusk') return 1.20;
    return 1.15;
  }

  public setTimeOfDay(mode: TimeOfDay): void {
    if (this.timeOfDay === mode) return;
    this.timeOfDay = mode;
    this.applyManagedLightIntensities();
  }

  /**
   * Physical (pre-budget) intensity of a managed light: the KNX dimmer target for KNX circuits,
   * or `baseIntensity × time-of-day scale` for standalone lights. Never depends on the camera.
   */
  private getManagedLightTargetIntensity(entry: ManagedPointLightEntry): number {
    if (entry.isStandalone) {
      return entry.baseIntensity * this.getStandaloneLightTodScale();
    }
    const knxTarget = entry.light.userData?.knxTargetIntensity;
    return typeof knxTarget === 'number' ? knxTarget : entry.baseIntensity;
  }

  /**
   * Mounts an invariant pool of `poolSize` (`8` desktop, `0` mobile) permanently `visible = true`
   * `THREE.PointLight`s on `scene` and permanently hides the logical fixture `PointLight`s
   * so Three.js WebGPU `LightsNode._getHash()` NEVER changes across walking, KNX switches, or tier changes.
   */
  public enableCarrierPointLightPool(
    poolSize: number,
    initialCameraPos?: THREE.Vector3
  ): void {
    const clampedPool = Math.max(0, Math.floor(poolSize));
    if (initialCameraPos) {
      this.carrierCameraAnchor.copy(initialCameraPos);
      this.carrierHasCameraAnchor = true;
    }
    if (this.carrierPoolEnabled && this.carrierLights.length === clampedPool) {
      this.carrierAssignmentDirty = true;
      this.applyManagedLightIntensities();
      return;
    }

    const { scene } = this.options.layers;
    for (const c of this.carrierLights) {
      scene.remove(c);
    }
    this.carrierLights.length = 0;
    this.carrierLogicalIdx.length = 0;
    this.carrierSlotFade.length = 0;
    this.carrierPoolEnabled = true;

    for (let s = 0; s < clampedPool; s++) {
      const carrier = new THREE.PointLight(0xfff1dc, 0, 10, 2);
      carrier.name = `__carrierPointLight.${s}`;
      carrier.castShadow = false;
      carrier.visible = true;
      carrier.userData = {
        isCarrierPointLight: true,
        [SHADOW_PASS_HOOK_FLAG]: true,
      };
      scene.add(carrier);
      carrier.updateMatrixWorld();
      this.carrierLights.push(carrier);
      this.carrierLogicalIdx.push(-1);
      this.carrierSlotFade.push(1);
    }

    for (let i = 0; i < this.managedPointLights.length; i++) {
      const light = this.managedPointLights[i]!.light;
      light.visible = false;
      light.userData = {
        ...light.userData,
        carriedByPool: true,
        carrierPoolActive: clampedPool > 0 && this.pointLightBudget > 0,
      };
    }

    this.carrierAssignmentDirty = true;
    this.updateCarrierPoolAssignment(true);
    this.applyManagedLightIntensities();
  }

  private computeCarrierDistanceAtten(worldPos: THREE.Vector3, camPos: THREE.Vector3): {
    readonly effDistSq: number;
    readonly atten: number;
  } {
    const dx = worldPos.x - camPos.x;
    const dy = (worldPos.y - camPos.y) * 2.25;
    const dz = worldPos.z - camPos.z;
    const effDistSq = dx * dx + dy * dy + dz * dz;
    const effDist = Math.sqrt(effDistSq);
    const t = THREE.MathUtils.clamp((effDist - 18.0) / 14.0, 0, 1);
    const atten = 1 - t * t * (3 - 2 * t);
    return { effDistSq, atten };
  }

  private updateCarrierPoolAssignment(snapFades: boolean): boolean {
    const poolLen = this.carrierLights.length;
    if (!this.carrierPoolEnabled || poolLen === 0 || this.managedPointLights.length === 0) {
      return false;
    }

    const activeCap = Number.isFinite(this.pointLightBudget)
      ? Math.min(poolLen, Math.max(0, Math.floor(this.pointLightBudget)))
      : poolLen;

    if (activeCap === 0) {
      let cleared = false;
      for (let s = 0; s < poolLen; s++) {
        if (this.carrierLogicalIdx[s] !== -1) {
          this.carrierLogicalIdx[s] = -1;
          this.carrierSlotFade[s] = 0;
          cleared = true;
        }
      }
      this.carrierAssignmentDirty = false;
      return cleared;
    }

    const camPos = this.carrierHasCameraAnchor
      ? this.carrierCameraAnchor
      : (this.resolveBudgetAnchorPosition() ?? this.carrierCameraAnchor);

    const currentlyAssigned = new Set<number>();
    for (let s = 0; s < poolLen; s++) {
      const idx = this.carrierLogicalIdx[s]!;
      if (idx >= 0) currentlyAssigned.add(idx);
    }

    const n = this.managedPointLights.length;
    const candidates: Array<{ readonly idx: number; readonly score: number }> = [];
    for (let i = 0; i < n; i++) {
      const entry = this.managedPointLights[i]!;
      const physI = this.getManagedLightTargetIntensity(entry);
      if (physI <= 1e-4) continue;
      const { effDistSq, atten } = this.computeCarrierDistanceAtten(entry.worldPos, camPos);
      if (atten <= 1e-4) continue;
      const hysteresis = currentlyAssigned.has(i) ? 1.18 : 1.0;
      const score = ((physI * (0.3 + 0.7 * atten)) / (1.0 + effDistSq * 0.085)) * hysteresis;
      if (score > 1e-6) {
        candidates.push({ idx: i, score });
      }
    }

    candidates.sort((a, b) => b.score - a.score || a.idx - b.idx);
    const chosenSet = new Set<number>();
    const limit = Math.min(activeCap, candidates.length);
    for (let k = 0; k < limit; k++) {
      chosenSet.add(candidates[k]!.idx);
    }

    let assignmentChanged = false;
    const keptSet = new Set<number>();
    for (let s = 0; s < poolLen; s++) {
      const curIdx = this.carrierLogicalIdx[s]!;
      if (curIdx >= 0 && chosenSet.has(curIdx)) {
        keptSet.add(curIdx);
      } else if (curIdx !== -1) {
        this.carrierLogicalIdx[s] = -1;
        this.carrierSlotFade[s] = 0;
        assignmentChanged = true;
      }
    }

    let nextFreeSlot = 0;
    for (let k = 0; k < limit; k++) {
      const idx = candidates[k]!.idx;
      if (keptSet.has(idx)) continue;
      while (nextFreeSlot < poolLen && this.carrierLogicalIdx[nextFreeSlot] !== -1) {
        nextFreeSlot++;
      }
      if (nextFreeSlot >= poolLen) break;
      this.carrierLogicalIdx[nextFreeSlot] = idx;
      this.carrierSlotFade[nextFreeSlot] = snapFades ? 1 : 0.15;
      nextFreeSlot++;
      assignmentChanged = true;
    }

    this.lastScoredCameraPos.copy(camPos);
    this.carrierAssignmentDirty = false;
    return assignmentChanged;
  }

  private syncCarrierLightTransformsAndIntensities(): boolean {
    const poolLen = this.carrierLights.length;
    const activeCap = Number.isFinite(this.pointLightBudget)
      ? Math.min(poolLen, Math.max(0, Math.floor(this.pointLightBudget)))
      : poolLen;
    const poolActive = poolLen > 0 && activeCap > 0;
    const camPos = this.carrierHasCameraAnchor
      ? this.carrierCameraAnchor
      : (this.resolveBudgetAnchorPosition() ?? this.carrierCameraAnchor);

    for (let i = 0; i < this.managedPointLights.length; i++) {
      const entry = this.managedPointLights[i]!;
      if (entry.light.visible) {
        entry.light.visible = false;
      }
      if (entry.light.userData?.carrierPoolActive !== poolActive) {
        entry.light.userData = {
          ...entry.light.userData,
          carriedByPool: true,
          carrierPoolActive: poolActive,
        };
      }
    }

    let changed = false;
    let anyCarrierLit = false;
    for (let s = 0; s < poolLen; s++) {
      const carrier = this.carrierLights[s]!;
      // Invariant: NEVER toggle carrier.visible after mount!
      if (!carrier.visible) carrier.visible = true;

      const idx = activeCap > 0 ? this.carrierLogicalIdx[s]! : -1;
      if (idx < 0 || idx >= this.managedPointLights.length) {
        if (carrier.intensity !== 0) {
          carrier.intensity = 0;
          changed = true;
        }
        continue;
      }

      const entry = this.managedPointLights[idx]!;
      const physI = this.getManagedLightTargetIntensity(entry);
      const { atten } = this.computeCarrierDistanceAtten(entry.worldPos, camPos);
      const fade = this.carrierSlotFade[s] ?? 1;
      const nextIntensity = physI * atten * fade;

      if (!carrier.position.equals(entry.worldPos)) {
        carrier.position.copy(entry.worldPos);
        carrier.updateMatrixWorld();
        changed = true;
      }
      if (!carrier.color.equals(entry.light.color)) {
        carrier.color.copy(entry.light.color);
        changed = true;
      }
      if (carrier.distance !== entry.light.distance) {
        carrier.distance = entry.light.distance;
        changed = true;
      }
      if (carrier.decay !== entry.light.decay) {
        carrier.decay = entry.light.decay;
        changed = true;
      }
      if (Math.abs(carrier.intensity - nextIntensity) > 1e-5) {
        carrier.intensity = nextIntensity;
        changed = true;
      }
      if (nextIntensity > 1e-4) {
        anyCarrierLit = true;
      }
    }

    setAnyPointLightsActive(anyCarrierLit);
    this.syncClusteredPointLightGrid();
    return changed;
  }

  public applyManagedLightIntensities(): boolean {
    if (this.carrierPoolEnabled) {
      if (this.carrierAssignmentDirty) {
        this.updateCarrierPoolAssignment(false);
      }
      return this.syncCarrierLightTransformsAndIntensities();
    }

    let changed = false;
    const nextVisible = this.pointLightBudget !== 0;
    for (let i = 0; i < this.managedPointLights.length; i++) {
      const entry = this.managedPointLights[i]!;
      const weight = this.pointLightBudget === 0 ? 0 : (this.budgetWeights[i] ?? 1);
      const next = this.getManagedLightTargetIntensity(entry) * weight;
      if (entry.light.intensity !== next) {
        entry.light.intensity = next;
        changed = true;
      }
      if (entry.light.visible !== nextVisible) {
        entry.light.visible = nextVisible;
        changed = true;
      }
    }
    this.syncClusteredPointLightGrid();
    return changed;
  }

  private syncClusteredPointLightGrid(): void {
    const count = this.managedPointLights.length;
    if (count === 0 || this.pointLightBudget !== 0) {
      updateClusteredPointLightGrid([], false);
      return;
    }
    this.clusterCandidates.length = count;
    for (let i = 0; i < count; i++) {
      const entry = this.managedPointLights[i]!;
      this.clusterCandidates[i] = {
        x: entry.worldPos.x,
        y: entry.worldPos.y,
        z: entry.worldPos.z,
        r: entry.light.color.r,
        g: entry.light.color.g,
        b: entry.light.color.b,
        intensity: this.getManagedLightTargetIntensity(entry),
        distance: entry.light.distance,
        decay: entry.light.decay,
      };
    }
    updateClusteredPointLightGrid(this.clusterCandidates, this.pointLightBudget === 0);
  }

  /**
   * Sets a fixed number of managed point lights that may be lit at once (per quality tier).
   * Lights are chosen by proximity to the budget anchor room (never the camera) and only change
   * when the budget or anchor changes. `Infinity` (default) keeps every light active.
   * Returns true if the active set changed (call `stepFades` each frame to animate the switch,
   * or `stepFades(0)` at startup to snap immediately before first shader compile).
   */
  public setPointLightBudget(n: number): boolean {
    const next = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : Number.POSITIVE_INFINITY;
    if (next === this.pointLightBudget) return false;
    const prev = this.pointLightBudget;
    this.pointLightBudget = next;
    const targetsChanged = this.recomputeBudgetTargets();
    if (this.carrierPoolEnabled) {
      this.carrierAssignmentDirty = true;
      const carrierChanged = this.updateCarrierPoolAssignment(true);
      const lightsChanged = this.syncCarrierLightTransformsAndIntensities();
      return targetsChanged || carrierChanged || lightsChanged;
    }
    if (next === 0 || prev === 0) {
      for (let i = 0; i < this.managedPointLights.length; i++) {
        const w = next === 0 ? 0 : (this.budgetTargets[i] ?? 1);
        this.budgetWeights[i] = w;
        const light = this.managedPointLights[i]!.light;
        light.userData = { ...light.userData, [POINT_LIGHT_BUDGET_WEIGHT_KEY]: w };
      }
      const lightsChanged = this.applyManagedLightIntensities();
      return targetsChanged || lightsChanged;
    }
    return targetsChanged;
  }

  public getPointLightBudget(): number {
    return this.pointLightBudget;
  }

  /**
   * Sets the room (zone id, resolved via `RoomLodController.getRoomCenter`) or world position that
   * the light budget is centred on. Only explicit calls change the active set.
   * Returns true if the active set changed.
   */
  public setBudgetAnchorZone(anchor: PointLightBudgetAnchor): boolean {
    if (anchor instanceof THREE.Vector3) {
      if (this.budgetAnchor instanceof THREE.Vector3 && this.budgetAnchor.equals(anchor)) {
        return false;
      }
      this.budgetAnchor = anchor.clone();
    } else {
      if (this.budgetAnchor === anchor) return false;
      this.budgetAnchor = anchor;
    }
    return this.recomputeBudgetTargets();
  }

  private resolveBudgetAnchorPosition(): THREE.Vector3 | null {
    const anchor = this.budgetAnchor;
    if (anchor === null) return null;
    if (anchor instanceof THREE.Vector3) return anchor;
    return this.options.lodController.getRoomCenter(anchor) ?? null;
  }

  /**
   * Recomputes which managed lights are inside the budget. Returns true if any target changed.
   */
  private recomputeBudgetTargets(): boolean {
    const n = this.managedPointLights.length;
    const budget = this.pointLightBudget;
    const nextTargets = new Array<number>(n).fill(1);
    const prevActivityKey = this.budgetActivityKey;
    this.budgetActivityKey = this.computeBudgetActivityKey();
    if (prevActivityKey.length === n) {
      this.stampSwitchedOnGroups(prevActivityKey, this.budgetActivityKey);
    }
    if (Number.isFinite(budget) && budget < n) {
      const anchorPos = this.resolveBudgetAnchorPosition();
      const order: number[] = [];
      for (let i = 0; i < n; i++) order.push(i);
      if (anchorPos) {
        const dist = order.map((i) => {
          const p = this.managedPointLights[i]!.worldPos;
          const dx = p.x - anchorPos.x;
          const dy = (p.y - anchorPos.y) * BUDGET_VERTICAL_WEIGHT;
          const dz = p.z - anchorPos.z;
          return dx * dx + dy * dy + dz * dz;
        });
        order.sort((a, b) => dist[a]! - dist[b]! || a - b);
      }
      const keys = this.computeBudgetGroupKeys();
      const isOn = order.map(() => false);
      for (let i = 0; i < n; i++) isOn[i] = this.isManagedLightOn(i);

      const picked: number[] = [];
      const pickedSet = new Set<number>();
      const seenGroups = new Set<string>();
      const recency = (i: number): number => this.budgetGroupActivation.get(keys[i]!) ?? 0;
      const knxOrder = [...order].sort((a, b) => recency(b) - recency(a));
      const newestKey = this.budgetActivationCounter > 0 ? keys[knxOrder[0] ?? -1] : undefined;
      if (newestKey !== undefined && recency(knxOrder[0]!) > 0) {
        for (const i of knxOrder) {
          if (keys[i] !== newestKey || !isOn[i]) continue;
          picked.push(i);
          pickedSet.add(i);
        }
        seenGroups.add(newestKey);
      }
      for (const knxPass of [true, false]) {
        for (const i of knxPass ? knxOrder : order) {
          const key = keys[i]!;
          if (!isOn[i] || seenGroups.has(key) || key.startsWith('circuit:') !== knxPass) continue;
          seenGroups.add(key);
          picked.push(i);
          pickedSet.add(i);
        }
      }
      for (const i of order) {
        if (isOn[i] && !pickedSet.has(i)) {
          picked.push(i);
          pickedSet.add(i);
        }
      }
      for (const i of order) {
        if (!pickedSet.has(i)) {
          picked.push(i);
          pickedSet.add(i);
        }
      }

      nextTargets.fill(0);
      const onTotal = new Map<string, number>();
      const onActive = new Map<string, number>();
      for (let k = 0; k < n; k++) {
        const i = picked[k]!;
        if (k < budget) nextTargets[i] = 1;
        if (!isOn[i]) continue;
        const key = keys[i]!;
        onTotal.set(key, (onTotal.get(key) ?? 0) + 1);
        if (k < budget) onActive.set(key, (onActive.get(key) ?? 0) + 1);
      }
      for (let i = 0; i < n; i++) {
        if (nextTargets[i] !== 1 || !isOn[i]) continue;
        const key = keys[i]!;
        const total = onTotal.get(key) ?? 1;
        const active = onActive.get(key) ?? 1;
        if (active < total) nextTargets[i] = Math.min(BUDGET_MAX_BOOST, total / active);
      }
    }
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (this.budgetTargets[i] !== nextTargets[i]) {
        this.budgetTargets[i] = nextTargets[i]!;
        changed = true;
      }
    }
    return changed;
  }

  /** Bumps the activation stamp of every budget group with a light that just went OFF → ON. */
  private stampSwitchedOnGroups(prevKey: string, nextKey: string): void {
    let groupKeys: string[] | null = null;
    for (let i = 0; i < nextKey.length; i++) {
      if (nextKey[i] !== '1' || prevKey[i] === '1') continue;
      groupKeys ??= this.computeBudgetGroupKeys();
      const key = groupKeys[i]!;
      if (key.startsWith('circuit:')) {
        this.budgetGroupActivation.set(key, ++this.budgetActivationCounter);
      }
    }
  }

  private isManagedLightOn(i: number): boolean {
    const entry = this.managedPointLights[i];
    return entry !== undefined && this.getManagedLightTargetIntensity(entry) > 1e-4;
  }

  /** One char per managed light: '1' when ON. Budget targets are recomputed when it changes. */
  private computeBudgetActivityKey(): string {
    let key = '';
    for (let i = 0; i < this.managedPointLights.length; i++) {
      key += this.isManagedLightOn(i) ? '1' : '0';
    }
    return key;
  }

  /**
   * Room/circuit grouping used by the one-light-per-room pass: the KNX circuit id for circuit
   * lights; the `<building>.<room>` name prefix (or a 6 m cell) for standalone lights.
   */
  private computeBudgetGroupKeys(): string[] {
    const circuitByLight = new Map<THREE.Light, string>();
    for (const [circuitId, grp] of Object.entries(this.options.lightGroups)) {
      if (!grp) continue;
      for (const l of grp.lights) circuitByLight.set(l, circuitId);
    }
    return this.managedPointLights.map((entry) => {
      const circuitId = circuitByLight.get(entry.light);
      if (circuitId) return `circuit:${circuitId}`;
      const parts = entry.light.name.split('.');
      if (parts.length >= 3) return `room:${parts[0]}.${parts[1]}`;
      return `cell:${entry.isFirstFloor ? 1 : 0}:${Math.floor(entry.worldPos.x / 6)}:${Math.floor(entry.worldPos.z / 6)}`;
    });
  }

  /**
   * Advances budget fades (~250 ms) and writes the resulting intensities. Re-evaluates the active
   * set whenever a light is switched on/off (KNX), never on camera movement.
   * Returns true while any light intensity changed this step (caller should re-render).
   */
  public stepFades(dtSeconds: number): boolean {
    const n = this.managedPointLights.length;
    if (n === 0) return false;
    if (this.carrierPoolEnabled) {
      const actKey = this.computeBudgetActivityKey();
      if (actKey !== this.budgetActivityKey) {
        this.budgetActivityKey = actKey;
        this.carrierAssignmentDirty = true;
      }
      const snap = !(dtSeconds > 0);
      if (this.carrierAssignmentDirty) {
        this.updateCarrierPoolAssignment(snap);
      }
      let anyCarrierFade = false;
      const step = snap ? Number.POSITIVE_INFINITY : dtSeconds / CARRIER_SLOT_FADE_S;
      for (let s = 0; s < this.carrierLights.length; s++) {
        if (this.carrierLogicalIdx[s] === -1) continue;
        const cur = this.carrierSlotFade[s] ?? 1;
        if (cur < 1) {
          this.carrierSlotFade[s] = Math.min(1, cur + step);
          anyCarrierFade = true;
        }
      }
      if (!anyCarrierFade && !snap) return false;
      return this.syncCarrierLightTransformsAndIntensities();
    }
    if (
      Number.isFinite(this.pointLightBudget) &&
      this.computeBudgetActivityKey() !== this.budgetActivityKey
    ) {
      this.recomputeBudgetTargets();
    }
    const baseStep =
      dtSeconds > 0 ? dtSeconds / POINT_LIGHT_BUDGET_FADE_S : Number.POSITIVE_INFINITY;
    let anyWeightChanged = false;
    for (let i = 0; i < n; i++) {
      const cur = this.budgetWeights[i] ?? 1;
      const target = this.budgetTargets[i] ?? 1;
      if (cur === target) continue;
      // Scale by the larger endpoint so boosted (>1) targets still fade in ~250 ms.
      const step = baseStep * Math.max(1, cur, target);
      const next = target > cur ? Math.min(target, cur + step) : Math.max(target, cur - step);
      this.budgetWeights[i] = next;
      const light = this.managedPointLights[i]!.light;
      light.userData = { ...light.userData, [POINT_LIGHT_BUDGET_WEIGHT_KEY]: next };
      anyWeightChanged = true;
    }
    if (!anyWeightChanged) return false;
    return this.applyManagedLightIntensities();
  }

  /** True while any managed light is still fading toward its budget target. */
  public hasPendingFades(): boolean {
    if (this.carrierPoolEnabled) {
      for (let s = 0; s < this.carrierLights.length; s++) {
        if (this.carrierLogicalIdx[s] !== -1 && (this.carrierSlotFade[s] ?? 1) < 1) return true;
      }
      return false;
    }
    for (let i = 0; i < this.managedPointLights.length; i++) {
      if ((this.budgetWeights[i] ?? 1) !== (this.budgetTargets[i] ?? 1)) return true;
    }
    return false;
  }

  /**
   * Re-ranks the budget right after a KNX level change. Lights that were OFF before and are now
   * inside the budget snap straight to their target weight (they were dark, so there is no pop);
   * lights losing their slot still fade out via `stepFades`.
   */
  private handleCircuitLevelsChanged(): void {
    if (this.carrierPoolEnabled && this.managedPointLights.length > 0) {
      this.carrierAssignmentDirty = true;
      this.updateCarrierPoolAssignment(true);
      this.syncCarrierLightTransformsAndIntensities();
      return;
    }
    if (!Number.isFinite(this.pointLightBudget) || this.managedPointLights.length === 0) return;
    if (this.pointLightBudget === 0) {
      this.syncClusteredPointLightGrid();
      return;
    }
    const prevKey = this.budgetActivityKey;
    if (this.computeBudgetActivityKey() === prevKey) return;
    this.recomputeBudgetTargets();
    for (let i = 0; i < this.managedPointLights.length; i++) {
      const wasOn = prevKey[i] === '1';
      if (wasOn || !this.isManagedLightOn(i)) continue;
      const target = this.budgetTargets[i] ?? 1;
      this.budgetWeights[i] = target;
      const light = this.managedPointLights[i]!.light;
      light.userData = { ...light.userData, [POINT_LIGHT_BUDGET_WEIGHT_KEY]: target };
    }
    this.applyManagedLightIntensities();
  }

  public getManagedPointLights(): readonly ManagedPointLightEntry[] {
    return this.managedPointLights;
  }

  /**
   * Consolidates overlapping standalone Outbuilding/Grounds `PointLight` clusters and hoists active
   * first-floor / cutaway `PointLight`s onto `scene` once so `NUM_POINT_LIGHTS` never changes
   * when `firstFloorMeshGroup.visible` toggles (eliminating PBR shader recompilations).
   */
  public consolidateAndHoistOnce(): void {
    if (this.originalLightRecords.length > 0) return;

    const { layers, lightGroups, snapshotParentChildren } = this.options;
    const {
      scene,
      firstFloorMeshGroup,
      groundFloorCeilingGroup,
      ceilingMeshGroup,
      cutawayWallGroups,
    } = layers;

    const knxLights = new Set<THREE.PointLight>();
    for (const grp of Object.values(lightGroups)) {
      if (!grp) continue;
      for (const l of grp.lights) {
        knxLights.add(l);
      }
    }

    const allPointLights: THREE.PointLight[] = [];
    scene.traverse((obj) => {
      if (obj instanceof THREE.PointLight && !obj.userData?.isCarrierPointLight) {
        allPointLights.push(obj);
      }
    });

    const upperFloorGroups = new Set<THREE.Object3D>([firstFloorMeshGroup]);
    if (layers.floorLayers) {
      for (let i = 1; i < layers.floorLayers.length; i++) {
        const entry = layers.floorLayers[i]!;
        upperFloorGroups.add(entry.contentGroup);
        upperFloorGroups.add(entry.slabGroup);
        upperFloorGroups.add(entry.ceilingGroup);
      }
    }

    const isInsideFirstFloor = (obj: THREE.Object3D): boolean => {
      let cur: THREE.Object3D | null = obj.parent;
      while (cur) {
        if (upperFloorGroups.has(cur)) return true;
        cur = cur.parent;
      }
      return false;
    };

    const cutawayLayers = new Set<THREE.Object3D>([
      firstFloorMeshGroup,
      groundFloorCeilingGroup,
      ceilingMeshGroup,
      cutawayWallGroups.southWest,
      cutawayWallGroups.west,
      cutawayWallGroups.north,
      cutawayWallGroups.east,
    ]);
    if (layers.roofGroup) {
      cutawayLayers.add(layers.roofGroup);
    }
    if (layers.floorLayers) {
      for (let i = 0; i < layers.floorLayers.length; i++) {
        const entry = layers.floorLayers[i]!;
        if (i >= 1) {
          cutawayLayers.add(entry.contentGroup);
        }
        cutawayLayers.add(entry.slabGroup);
        cutawayLayers.add(entry.ceilingGroup);
      }
    }
    const isInsideCutawayLayer = (obj: THREE.Object3D): boolean => {
      let cur: THREE.Object3D | null = obj.parent;
      while (cur) {
        if (cutawayLayers.has(cur) || cur.userData?.cutawayWall) return true;
        cur = cur.parent;
      }
      return false;
    };

    const standaloneClusters = new Map<
      string,
      Array<{
        readonly light: THREE.PointLight;
        readonly worldPos: THREE.Vector3;
        readonly is1F: boolean;
        readonly hoist: boolean;
      }>
    >();

    for (const light of allPointLights) {
      if (!light.parent) continue;
      this.originalLightRecords.push({
        light,
        originalParent: light.parent,
        originalPosition: light.position.clone(),
        originalVisible: light.visible,
        originalIntensity: light.intensity,
        originalDistance: light.distance,
      });

      const worldPos = new THREE.Vector3();
      light.getWorldPosition(worldPos);
      const is1F = isInsideFirstFloor(light);
      const hoist =
        is1F ||
        isInsideCutawayLayer(light) ||
        light.userData?.[ALWAYS_HOIST_LIGHT_FLAG] === true;

      if (knxLights.has(light)) {
        if (hoist) {
          snapshotParentChildren(light.parent);
          snapshotParentChildren(scene);
          scene.add(light);
          light.position.copy(worldPos);
          light.updateMatrixWorld();
        }
        this.managedPointLights.push({
          light,
          worldPos,
          isFirstFloor: is1F,
          isStandalone: false,
          baseIntensity: light.intensity,
        });
        continue;
      }

      // Keep all interior Barn/Outbuilding task & ambient lights active; only skip micro-range (<=2.4m) accent lights
      if (light.distance > 0 && light.distance <= 2.4) {
        light.visible = false;
        continue;
      }

      // Group overlapping standalone PointLights into fine sub-zone clusters (~3.4m x 3.4m cells)
      const clusterKey = `${is1F ? '1F' : 'GF'}:${Math.floor(worldPos.x / 3.4)}:${Math.floor(worldPos.z / 3.4)}`;
      let list = standaloneClusters.get(clusterKey);
      if (!list) {
        list = [];
        standaloneClusters.set(clusterKey, list);
      }
      list.push({ light, worldPos, is1F, hoist });
    }

    for (const list of standaloneClusters.values()) {
      const primary = list[0]!;
      if (list.length > 1) {
        const avgPos = new THREE.Vector3();
        let totalIntensity = 0;
        let maxDist = primary.light.distance;
        for (const item of list) {
          avgPos.add(item.worldPos);
          totalIntensity += item.light.intensity;
          if (item.light.distance > maxDist) maxDist = item.light.distance;
        }
        avgPos.divideScalar(list.length);

        for (let i = 1; i < list.length; i++) {
          list[i]!.light.visible = false;
        }

        const mergedIntensity = Math.min(primary.light.intensity * 2.25, totalIntensity * 0.92);
        const mergedDistance = Math.min(14.0, maxDist * 1.42);
        primary.light.intensity = mergedIntensity;
        primary.light.distance = mergedDistance;
        primary.worldPos.copy(avgPos);

        if (primary.is1F || primary.light.parent !== scene) {
          snapshotParentChildren(primary.light.parent!);
          snapshotParentChildren(scene);
          scene.add(primary.light);
        }
        primary.light.position.copy(avgPos);
        primary.light.updateMatrixWorld();
      } else if (primary.hoist) {
        snapshotParentChildren(primary.light.parent!);
        snapshotParentChildren(scene);
        scene.add(primary.light);
        primary.light.position.copy(primary.worldPos);
        primary.light.updateMatrixWorld();
      }

      const rawBaseIntensity = primary.light.intensity;
      primary.light.intensity = rawBaseIntensity * this.getStandaloneLightTodScale();
      this.managedPointLights.push({
        light: primary.light,
        worldPos: primary.worldPos.clone(),
        isFirstFloor: primary.is1F,
        isStandalone: true,
        baseIntensity: rawBaseIntensity,
      });
    }

    this.budgetWeights.length = 0;
    this.budgetTargets.length = 0;
    this.recomputeBudgetTargets();
    for (let i = 0; i < this.managedPointLights.length; i++) {
      // Lights start at their budget target (no fade-in on load / re-batch).
      const w = this.budgetTargets[i] ?? 1;
      this.budgetWeights[i] = w;
      const light = this.managedPointLights[i]!.light;
      light.userData = { ...light.userData, [POINT_LIGHT_BUDGET_WEIGHT_KEY]: w };
    }
    this.applyManagedLightIntensities();
  }

  /**
   * Re-syncs managed `PointLight` intensities from KNX dimmer targets and time of day
   * (or updates carrier pool camera scoring when the invariant carrier pool is enabled).
   */
  public syncPointLightVisibilityAndDistance(
    cameraPos: THREE.Vector3,
    _firstFloorVisible: boolean
  ): boolean {
    if (this.managedPointLights.length === 0) return false;
    if (this.carrierPoolEnabled) {
      this.carrierCameraAnchor.copy(cameraPos);
      this.carrierHasCameraAnchor = true;
      const movedSq = Number.isNaN(this.lastScoredCameraPos.x)
        ? Number.POSITIVE_INFINITY
        : cameraPos.distanceToSquared(this.lastScoredCameraPos);
      if (movedSq > 0.16) {
        this.carrierAssignmentDirty = true;
      }
      if (this.carrierAssignmentDirty) {
        this.updateCarrierPoolAssignment(Number.isNaN(this.lastScoredCameraPos.x));
      }
      return this.syncCarrierLightTransformsAndIntensities();
    }
    return this.applyManagedLightIntensities();
  }
}
