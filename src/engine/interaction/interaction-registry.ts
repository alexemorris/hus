import * as THREE from 'three';
import type { InspectedAssetAction } from '../../core/assets/asset-metadata.ts';
import type { AcousticPortalState } from '../../core/types/acoustics.ts';
import type {
  AssetInteractionAudio,
  AssetInteractionSpec,
} from '../assets/smart-asset.ts';
import type { AudioEmitterHandle } from '../audio/spatial-emitters.ts';
import type { CircuitId } from '../../core/types/knx.ts';
import type { InteractiveUserData } from '../../core/types/scene.ts';
import { deriveStableIds, type StableIdKind, type StableIdSource } from './device-ids.ts';
import {
  createBifoldCupboardPair,
  playBifoldSound,
  stepBifoldCupboard,
  type BifoldCupboardState,
} from './handlers/bifold-cupboards.ts';
import {
  createMotorizedCarGatePair,
  playCarGateSound,
  stepCarGates,
  type MotorizedCarGatePairState,
} from './handlers/car-gates.ts';
import { EMPTY_DOOR_POLICY, type DoorPolicy } from './handlers/door-policy.ts';
import type { AnimatedInteractable, FirstPersonPoseSample } from './handlers/animated-interactable.ts';
import { describeFlagInteractable } from './handlers/flag-prompts.ts';
import {
  applySlidingGolfMatKinematics,
  cancelGolfSimulatorShot,
  collectGolfMatTrackDynamicObjects,
  collectGolfShotDynamicObjects,
  createFoldingGolfMat,
  createGolfSimulatorShotState,
  getGolfSimulatorPromptLabel,
  GOLF_SIMULATOR_SHOT_ID,
  stepGolfSimulatorShot,
  triggerGolfSimulatorShot,
  type GolfSimulatorShotConfig,
  type GolfSimulatorShotState,
} from './handlers/golf-simulator.ts';
import { findDescendantCutawayWall, wrapInHingePivot } from './handlers/hinge-pivot.ts';
import {
  applyHingedDoorPose,
  createHingedDoorState,
  describeHingedDoor,
  getClosedDoorwayGeometry,
  getClickToggleSpeed,
  getDefaultDoorOpenAngle,
  getEffectiveDoorOpenAngle,
  isWalkthroughDoorState,
  playHingedDoorSound,
  type HingedDoorState,
} from './handlers/hinged-doors.ts';
import { GARAGE_DOOR_GROUP_ID, getPseudoDeviceUserData } from './handlers/pseudo-devices.ts';
import {
  collectPulleyMaidDynamicObjects,
  createPulleyMaidState,
  playPulleyMaidSound,
  stepPulleyMaid,
  tagPulleyMaidRoles,
  type PulleyMaidConfig,
  type PulleyMaidState,
} from './handlers/pulley-maid.ts';
import {
  createSlidingDrawerState,
  playSlidingDrawerSound,
  stepSlidingDrawer,
  type SlidingDrawerState,
} from './handlers/sliding-drawers.ts';
import {
  createSmartAcousticPortalProvider,
  createSmartInteractionEntry,
  describeSmartInteractionEntry,
  playSmartInteractionAudio,
  setSmartEntryActive,
  stepSmartInteractionEntry,
  toInspectedAssetAction,
  type SmartInteractionEntry,
} from './handlers/smart-interactions.ts';
import {
  bargeNearbyWalkthroughDoors,
  bargeOpenWalkthroughDoor,
  type DoorBargeContext,
} from './handlers/walkthrough-door-barge.ts';

/** Kind of a registry-managed interactable, as reported by `listInteractables()`. */
export type InteractableKind =
  | 'door'
  | 'garage-door'
  | 'golf-mat'
  | 'drawer'
  | 'bifold-cupboard'
  | 'toggle'
  | 'pulley-maid'
  | 'golf-simulator-shot'
  | 'animated'
  | 'smart';

export interface InteractableInfo {
  /** Stable id (preferred for persistence / manifests). */
  readonly id: string;
  /** Build-order id written into mesh userData (still accepted everywhere). */
  readonly legacyId: string;
  readonly kind: InteractableKind;
  /** Display label (animated props only). */
  readonly label?: string;
  /** Natural-language aliases (animated props only). */
  readonly aliases?: readonly string[];
}

interface ToggleCallbackEntry {
  readonly onToggle: () => void;
  readonly dynamicRoots: readonly THREE.Object3D[];
}

/**
 * Registry of every interactive 3D prop in a property scene: registration (from zone builders),
 * lookup by interactableId (legacy `door-N` or stable `door:<name>` ids), click handling,
 * describe/prompt text, the per-frame animation update and dynamic-object collection.
 * Device behaviour lives in `./handlers/*`; the registry only owns state and routing.
 *
 * NOTE: the snapshot tool fingerprints this object's own enumerable fields
 * (`tools/snapshot/property-scene-build.ts` → `interactionState`). The public-ish state fields
 * below therefore keep their historical names/shapes; runtime-only bookkeeping uses `#private`
 * fields, which the fingerprint does not see.
 */
export class InteractionRegistry {
  private readonly interactiveMeshes: THREE.Object3D[];
  private readonly hingedDoors = new Map<string, HingedDoorState>();
  private readonly bifoldCupboards = new Map<string, BifoldCupboardState>();
  private readonly slidingDrawers = new Map<string, SlidingDrawerState>();
  private readonly toggleCallbacks = new Map<string, ToggleCallbackEntry>();
  private pulleyMaid: PulleyMaidState | null = null;
  private carGatePair: MotorizedCarGatePairState | null = null;
  private golfSimulatorShot: GolfSimulatorShotState | null = null;
  private nextId = 1;
  private readonly tmpHingeWorld = new THREE.Vector3();

  #doorPolicy: DoorPolicy = EMPTY_DOOR_POLICY;
  #stableIds: { byLegacy: Map<string, string>; byStable: Map<string, string> } | null = null;
  readonly #manualCloseMs = new Map<string, number>();
  /** Runtime-only (`#private` keeps the snapshot fingerprint of this registry unchanged). */
  readonly #animated = new Map<string, AnimatedInteractable>();
  #unbatchSubtreeHandler: ((root: THREE.Object3D) => void) | null = null;
  readonly #unbatchedRoots = new Set<THREE.Object3D>();
  readonly #bargeContext: DoorBargeContext;
  #cachedExteriorDoorPortals:
    | {
        readonly entries: readonly {
          readonly door: HingedDoorState;
          readonly state: {
            readonly id: string;
            readonly position: readonly [number, number, number];
            readonly areaM2: number;
            openness: number;
          };
        }[];
        readonly output: readonly AcousticPortalState[];
      }
    | null = null;
  readonly #tmpPortalBox = new THREE.Box3();
  readonly #tmpPortalQuat = new THREE.Quaternion();
  readonly #tmpPortalForward = new THREE.Vector3();
  readonly #exteriorAcousticPortals: Array<() => AcousticPortalState> = [];
  readonly #smartEntries = new Map<string, SmartInteractionEntry>();
  readonly #smartMeshToId = new WeakMap<THREE.Object3D, string>();
  readonly #smartClickableMeshes: THREE.Object3D[] = [];
  readonly #smartClickableSet = new Set<THREE.Object3D>();
  readonly #smartAudioEmitters: AudioEmitterHandle[] = [];
  readonly #smartAudioEmitterSet = new Set<AudioEmitterHandle>();
  readonly #audioOverrides = new Map<string, AssetInteractionAudio>();
  #smartNextId = 1;

  public constructor(interactiveMeshes: THREE.Object3D[]) {
    this.interactiveMeshes = interactiveMeshes;
    this.#bargeContext = {
      doors: this.hingedDoors,
      tmpHingeWorld: this.tmpHingeWorld,
      isWalkthroughDoor: (id) => this.isWalkthroughDoor(id),
      getEffectiveOpenAngle: (door) => this.#effectiveOpenAngle(door),
      closeConflictingDoors: (id) => this.#closeConflictingDoors(id),
      getSplitLeafPartnerId: (id) => this.#splitLeafPartnerId(id),
      getLastManualCloseMs: (id) => this.#manualCloseMs.get(id) ?? 0,
    };
  }

  private allocateId(prefix: string): string {
    const id = `${prefix}-${this.nextId}`;
    this.nextId += 1;
    this.#stableIds = null;
    return id;
  }

  // ---------------------------------------------------------------------------
  // Ids
  // ---------------------------------------------------------------------------

  /**
   * Installs the per-home door behaviour table (keyed by stable door ids), normally from
   * `PropertySceneProfile.doorPolicy`.
   */
  public setDoorPolicy(policy: DoorPolicy): void {
    this.#doorPolicy = policy;
    this.#stableIds = null;
  }

  #ensureStableIds(): { byLegacy: Map<string, string>; byStable: Map<string, string> } {
    if (this.#stableIds) return this.#stableIds;
    const sources: StableIdSource[] = [];
    const push = (
      legacyId: string,
      kind: StableIdKind,
      anchor: THREE.Object3D,
      primary: THREE.Object3D | undefined,
      secondary: THREE.Object3D | undefined
    ): void => {
      sources.push({ legacyId, kind, anchor, primary, secondary });
    };
    for (const door of this.hingedDoors.values()) {
      push(door.id, 'door', door.pivot, door.pivot.children[0], door.pivot);
    }
    for (const dr of this.slidingDrawers.values()) {
      push(dr.id, 'drawer', dr.group, dr.group, undefined);
    }
    for (const bf of this.bifoldCupboards.values()) {
      push(bf.id, 'bifold-cupboard', bf.outerPivot, bf.outerPivot.children[0], bf.innerLeaf);
    }
    for (const [id, tc] of this.toggleCallbacks) {
      const root = tc.dynamicRoots[0];
      if (root) push(id, 'toggle', root, root, undefined);
    }
    const byLegacy = deriveStableIds(sources);
    const byStable = new Map<string, string>();
    for (const [legacy, stable] of byLegacy) byStable.set(stable, legacy);
    this.#stableIds = { byLegacy, byStable };
    this.#warnUnknownPolicyIds(byStable);
    return this.#stableIds;
  }

  /** Surfaces door-policy entries that no longer match a registered door (renamed/moved meshes). */
  #warnUnknownPolicyIds(byStable: ReadonlyMap<string, string>): void {
    if (this.hingedDoors.size === 0) return;
    const policy = this.#doorPolicy;
    const referenced = new Set<string>([
      ...Object.keys(policy.conflicts),
      ...Object.values(policy.conflicts).flat(),
      ...Object.keys(policy.openAngles),
      ...policy.splitLeafPairs.flat(),
    ]);
    const missing = [...referenced].filter((id) => !byStable.has(id));
    if (missing.length > 0) {
      console.warn(`[interaction] door policy references unknown stable ids: ${missing.join(', ')}`);
    }
  }

  /** Maps a stable id (`door:<name>`) or legacy id (`door-N`) to the registry's legacy id. */
  public resolveInteractableId(id: string): string {
    if (!id.includes(':')) return id;
    return this.#ensureStableIds().byStable.get(id) ?? id;
  }

  /** Stable id for a legacy id (or the id itself for fixed ids such as `pulley-maid`). */
  public getStableId(id: string): string {
    return this.#ensureStableIds().byLegacy.get(this.resolveInteractableId(id)) ?? id;
  }

  /** Lists every registry-managed interactable with its stable and legacy ids. */
  public listInteractables(): readonly InteractableInfo[] {
    const { byLegacy } = this.#ensureStableIds();
    const out: InteractableInfo[] = [];
    const add = (legacyId: string, kind: InteractableKind): void => {
      out.push({ id: byLegacy.get(legacyId) ?? legacyId, legacyId, kind });
    };
    for (const door of this.hingedDoors.values()) {
      add(
        door.id,
        door.isFoldingFloorMat ? 'golf-mat' : door.overheadTrackZ !== undefined ? 'garage-door' : 'door'
      );
    }
    for (const dr of this.slidingDrawers.values()) add(dr.id, 'drawer');
    for (const bf of this.bifoldCupboards.values()) add(bf.id, 'bifold-cupboard');
    for (const id of this.toggleCallbacks.keys()) add(id, 'toggle');
    if (this.pulleyMaid) add(this.pulleyMaid.id, 'pulley-maid');
    if (this.golfSimulatorShot) add(this.golfSimulatorShot.id, 'golf-simulator-shot');
    for (const device of this.#animated.values()) {
      out.push({ id: device.id, legacyId: device.id, kind: 'animated', label: device.label, aliases: device.aliases });
    }
    for (const entry of this.#smartEntries.values()) {
      out.push({ id: entry.id, legacyId: entry.id, kind: 'smart', label: entry.spec.label });
    }
    return out;
  }

  /**
   * Synthetic userData for pseudo-device ids (`car-gates`, `kitchen-bifolds`, `frame-tv`) whose
   * state lives outside the registry; the caller routes it like a mesh click.
   */
  public getPseudoDeviceUserData(id: string): InteractiveUserData | null {
    return getPseudoDeviceUserData(id);
  }

  #stableIdOf(legacyId: string): string | undefined {
    return this.#ensureStableIds().byLegacy.get(legacyId);
  }

  #splitLeafPartnerId(legacyId: string): string | undefined {
    const stable = this.#stableIdOf(legacyId);
    if (stable === undefined) return undefined;
    for (const [a, b] of this.#doorPolicy.splitLeafPairs) {
      const other = stable === a ? b : stable === b ? a : undefined;
      if (other !== undefined) return this.resolveInteractableId(other);
    }
    return undefined;
  }


  // ---------------------------------------------------------------------------
  // Zero-ctx Smart Asset Interactions & Audio Overrides
  // ---------------------------------------------------------------------------

  public setInteractableAudioOverride(
    interactableId: string,
    audio: AssetInteractionAudio
  ): void {
    const resolved = this.resolveInteractableId(interactableId);
    this.#audioOverrides.set(resolved, audio);
  }

  public registerSmartAudioEmitter(emitter: AudioEmitterHandle): boolean {
    if (this.#smartAudioEmitterSet.has(emitter)) return false;
    this.#smartAudioEmitterSet.add(emitter);
    this.#smartAudioEmitters.push(emitter);
    return true;
  }

  public getSmartAudioEmitters(): readonly AudioEmitterHandle[] {
    return this.#smartAudioEmitters;
  }

  public getSmartClickableMeshes(): readonly THREE.Object3D[] {
    return this.#smartClickableMeshes;
  }

  public registerSmartInteraction(
    target: THREE.Object3D,
    spec: AssetInteractionSpec,
    activeLoopEmitter: AudioEmitterHandle | null = null
  ): string {
    const baseId = spec.id ? `smart:${spec.id}` : `smart-${this.#smartNextId++}`;
    const id = this.#smartEntries.has(baseId) ? `${baseId}-${this.#smartNextId++}` : baseId;
    const entry = createSmartInteractionEntry(id, target, spec, activeLoopEmitter);
    this.#smartEntries.set(id, entry);
    this.#smartMeshToId.set(target, id);
    for (let i = 0; i < entry.clickableMeshes.length; i++) {
      const m = entry.clickableMeshes[i]!;
      if (!this.#smartMeshToId.has(m)) {
        this.#smartMeshToId.set(m, id);
      }
      if (!this.#smartClickableSet.has(m)) {
        this.#smartClickableSet.add(m);
        this.#smartClickableMeshes.push(m);
      }
    }
    const portalProvider = createSmartAcousticPortalProvider(entry);
    if (portalProvider) {
      this.#exteriorAcousticPortals.push(portalProvider);
    }
    return id;
  }

  public linkSmartHingePair(idA: string, idB: string): void {
    const a = this.#smartEntries.get(idA);
    const b = this.#smartEntries.get(idB);
    if (!a || !b || a.state.kind !== 'hinge' || b.state.kind !== 'hinge') return;
    if (!a.state.partnerIds.includes(idB)) a.state.partnerIds.push(idB);
    if (!b.state.partnerIds.includes(idA)) b.state.partnerIds.push(idA);
  }

  public getSmartInteractableIdForObject(
    obj: THREE.Object3D | null | undefined
  ): string | undefined {
    let cur: THREE.Object3D | null | undefined = obj;
    while (cur) {
      const id = this.#smartMeshToId.get(cur);
      if (id !== undefined) return id;
      const savedParent = (cur.userData as Record<string, unknown> | undefined)
        ?.__batchOriginalParent as THREE.Object3D | undefined;
      cur = savedParent ?? cur.parent;
    }
    return undefined;
  }

  public getInspectedAssetActions(assetRoot: THREE.Object3D): readonly InspectedAssetAction[] {
    const isDescendant = (node: THREE.Object3D | undefined | null): boolean => {
      let cur: THREE.Object3D | null | undefined = node;
      while (cur) {
        if (cur === assetRoot) return true;
        const savedParent = (cur.userData as Record<string, unknown> | undefined)
          ?.__batchOriginalParent as THREE.Object3D | undefined;
        cur = savedParent ?? cur.parent;
      }
      return false;
    };

    const actions: InspectedAssetAction[] = [];
    const seenPairs = new Set<string>();

    for (const entry of this.#smartEntries.values()) {
      if (!isDescendant(entry.target)) continue;
      if (entry.state.kind === 'hinge' && entry.state.partnerIds.length > 0) {
        const pairKey = [entry.id, ...entry.state.partnerIds].sort().join('|');
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);
      }
      actions.push(toInspectedAssetAction(entry));
    }

    for (const [id, door] of this.hingedDoors) {
      if (!isDescendant(door.pivot)) continue;
      if (door.partnerDoorId) {
        const pairKey = [id, door.partnerDoorId].sort().join('|');
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);
      }
      const mesh = door.pivot.children[0] ?? door.pivot;
      actions.push({
        id,
        label: describeHingedDoor(door, mesh, () => this.isWalkthroughDoor(id)),
        active: door.isOpen,
        kind: 'hinge',
      });
    }

    for (const [id, drawer] of this.slidingDrawers) {
      if (!isDescendant(drawer.group)) continue;
      actions.push({
        id,
        label: `${drawer.isOpen ? 'Close' : 'Open'} Drawer`,
        active: drawer.isOpen,
        kind: 'slide',
      });
    }

    for (const [id, bf] of this.bifoldCupboards) {
      if (!isDescendant(bf.outerPivot)) continue;
      actions.push({
        id,
        label: `${bf.isOpen ? 'Close' : 'Open'} Bi-Fold Doors`,
        active: bf.isOpen,
        kind: 'hinge',
      });
    }

    for (const [id, tc] of this.toggleCallbacks) {
      if (!tc.dynamicRoots.some((r) => isDescendant(r))) continue;
      actions.push({
        id,
        label: 'Toggle Mechanism',
        kind: 'toggle',
      });
    }

    for (const [id, anim] of this.#animated) {
      if (!anim.clickableTargets.some((t) => isDescendant(t))) continue;
      const label = anim.describe();
      if (label) {
        actions.push({
          id,
          label,
          kind: 'custom',
        });
      }
    }

    return actions;
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  /**
   * Marks an Object3D and all its descendant Meshes with the given InteractiveUserData
   * and registers them for raycasting.
   */
  public registerClickableObject(root: THREE.Object3D, data: InteractiveUserData): void {
    root.userData = { ...root.userData, ...data };
    root.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.userData = { ...child.userData, ...data };
        if (!this.interactiveMeshes.includes(child)) {
          this.interactiveMeshes.push(child);
        }
      }
    });
  }

  /** Marks a light fixture mesh or group so clicking any part of it toggles the given KNX circuit. */
  public registerLightFixture(root: THREE.Object3D, circuitId: CircuitId): void {
    this.registerClickableObject(root, { circuitId });
  }

  /** Marks a bifold door leaf or frame so clicking it toggles the 4-leaf concertina bifold doors. */
  public registerBifoldDoor(root: THREE.Object3D): void {
    this.registerClickableObject(root, { isBifoldDoor: true });
  }

  /**
   * Wraps `doorObj` (which must already have its local position set and be added to `parent`)
   * in a hinge pivot group located at `doorObj.position + hingeOffsetInParent`, so clicking
   * any mesh inside `doorObj` smoothly swings it open/closed around `axis`.
   */
  public registerHingedDoor(
    parent: THREE.Object3D,
    doorObj: THREE.Object3D,
    hingeOffsetInParent: THREE.Vector3,
    axis: 'x' | 'y' | 'z',
    openAngle: number,
    initialAngle = 0
  ): THREE.Group {
    const id = this.allocateId('door');
    const pivot = wrapInHingePivot(parent, doorObj, hingeOffsetInParent);
    if (initialAngle !== 0) {
      pivot.rotation[axis] = initialAngle;
    }
    parent.add(pivot);
    this.registerClickableObject(pivot, { interactableId: id });
    pivot.userData = { ...pivot.userData, doorRole: 'pivot' };
    this.hingedDoors.set(id, createHingedDoorState(id, pivot, axis, initialAngle, openAngle));
    return pivot;
  }

  /**
   * Links two hinged door pivot groups (such as a pair of French double doors) so clicking,
   * toggling, or barging either leaf opens and closes both leaves together as a synchronized pair.
   */
  public linkDoorPair(doorPivotA: THREE.Object3D, doorPivotB: THREE.Object3D): void {
    const idA = (doorPivotA.userData as InteractiveUserData | undefined)?.interactableId;
    const idB = (doorPivotB.userData as InteractiveUserData | undefined)?.interactableId;
    if (!idA || !idB) return;
    const stateA = this.hingedDoors.get(idA);
    const stateB = this.hingedDoors.get(idB);
    if (stateA && stateB) {
      stateA.partnerDoorId = idB;
      stateB.partnerDoorId = idA;
    }
  }

  /**
   * Registers a single-piece retractable up-and-over overhead garage door (`axis = 'x'`).
   * As the panel tilts upward (`rotation.x` from `0` to `+openAngle`), the top roller pivot
   * glides rearward (`+z`) along the horizontal overhead ceiling tracks by `overheadTrackZ * sin(rx)`,
   * so the bottom edge rises straight up the doorway jambs without ever swinging inward into a parked car.
   */
  public registerOverheadGarageDoor(
    parent: THREE.Object3D,
    doorObj: THREE.Object3D,
    hingeOffsetInParent: THREE.Vector3,
    overheadTrackZ: number,
    openAngle = Math.PI * 0.495
  ): THREE.Group {
    const id = this.allocateId('door');
    const pivot = wrapInHingePivot(parent, doorObj, hingeOffsetInParent);
    parent.add(pivot);
    this.registerClickableObject(pivot, { interactableId: id });
    pivot.userData = { ...pivot.userData, doorRole: 'pivot' };
    const door = createHingedDoorState(id, pivot, 'x', 0, openAngle);
    door.speed = 1.65;
    door.overheadTrackZ = overheadTrackZ;
    door.closedPosZ = pivot.position.z;
    this.hingedDoors.set(id, door);
    return pivot;
  }

  /**
   * Registers the track-mounted sliding Golf Simulator front stance mat and links it
   * with the Callaway Tour Golf Bag (`bagGroup`).
   */
  public registerFoldingGolfMat(
    parent: THREE.Object3D,
    foldingMatObj: THREE.Object3D,
    hingeOffsetInParent: THREE.Vector3,
    bagGroup: THREE.Group,
    bagStowedDelta: THREE.Vector3,
    _openAngle = Math.PI * 0.994,
    onStateChange?: (isFolded: boolean) => void
  ): { readonly matPivot: THREE.Group; readonly matDoorId: string; readonly bagDrawerId: string } {
    const matDoorId = this.allocateId('door');
    const bagDrawerId = this.allocateId('drawer');
    const { matPivot, door, bag } = createFoldingGolfMat(
      matDoorId,
      bagDrawerId,
      parent,
      foldingMatObj,
      hingeOffsetInParent,
      bagGroup,
      bagStowedDelta,
      onStateChange
    );
    this.registerClickableObject(matPivot, { interactableId: matDoorId });
    matPivot.userData = { ...matPivot.userData, doorRole: 'pivot' };
    this.registerClickableObject(bagGroup, { interactableId: bagDrawerId });
    bagGroup.userData = { ...bagGroup.userData, drawerRole: 'group' };
    this.hingedDoors.set(matDoorId, door);
    this.slidingDrawers.set(bagDrawerId, bag);
    return { matPivot, matDoorId, bagDrawerId };
  }

  /**
   * Registers a 2-leaf folding bi-fold cupboard door pair (such as the upper Pantry doors)
   * so clicking either leaf folds both leaves together in a concertina motion.
   */
  public registerBifoldCupboardPair(
    parent: THREE.Object3D,
    outerLeaf: THREE.Group,
    innerLeaf: THREE.Group,
    sideSign: -1 | 1,
    leafWidth: number,
    faceZ: number
  ): void {
    const id = this.allocateId('bifold-cupboard');
    const state = createBifoldCupboardPair(id, parent, outerLeaf, innerLeaf, sideSign, leafWidth, faceZ);
    this.registerClickableObject(state.outerPivot, { interactableId: id });
    this.registerClickableObject(innerLeaf, { interactableId: id });
    state.outerPivot.userData = { ...state.outerPivot.userData, bifoldRole: 'outerPivot' };
    innerLeaf.userData = { ...innerLeaf.userData, bifoldRole: 'innerLeaf' };
    this.bifoldCupboards.set(id, state);
  }

  /** Registers a sliding pan drawer or warming drawer so clicking it smoothly slides it out/in. */
  public registerSlidingDrawer(drawerGroup: THREE.Group, slideDelta: THREE.Vector3): void {
    const id = this.allocateId('drawer');
    const state = createSlidingDrawerState(id, drawerGroup, slideDelta);
    this.registerClickableObject(drawerGroup, { interactableId: id });
    const cutawayDesc = !drawerGroup.userData?.cutawayWall
      ? findDescendantCutawayWall(drawerGroup)
      : undefined;
    drawerGroup.userData = {
      ...drawerGroup.userData,
      drawerRole: 'group',
      ...(cutawayDesc ? { isCutawayWall: true, cutawayWall: cutawayDesc } : {}),
    };
    this.slidingDrawers.set(id, state);
  }

  /**
   * Registers a custom exterior acoustic portal provider (e.g. an operable sash window) whose live
   * `AcousticPortalState` is appended to `getExteriorDoorAcousticPortals()`.
   */
  public registerExteriorAcousticPortal(provider: () => AcousticPortalState): void {
    this.#exteriorAcousticPortals.push(provider);
  }

  /**
   * Registers the Utility Room Pulley Maid ceiling clothes airer so clicking it lowers/raises
   * the wooden drying laths and dynamically adjusts the vertical hoist ropes.
   */
  public registerPulleyMaid(config: PulleyMaidConfig): void {
    const state = createPulleyMaidState(config);
    this.registerClickableObject(config.clickRoot, { interactableId: state.id });
    tagPulleyMaidRoles(config);
    this.pulleyMaid = state;
  }

  /**
   * Registers the Motorized Dual-Leaf Front Car Entrance Gates so both leaves swing open/closed
   * together slowly (~10.0 seconds) when clicked or controlled via the KNX bus.
   */
  public registerMotorizedCarGatePair(
    parent: THREE.Object3D,
    northLeaf: THREE.Object3D,
    northHingeOffset: THREE.Vector3,
    northOpenAngle: number,
    southLeaf: THREE.Object3D,
    southHingeOffset: THREE.Vector3,
    southOpenAngle: number,
    travelDurationSec = 10.0
  ): void {
    const state = createMotorizedCarGatePair(
      parent,
      northLeaf,
      northHingeOffset,
      northOpenAngle,
      southLeaf,
      southHingeOffset,
      southOpenAngle,
      travelDurationSec
    );
    this.registerClickableObject(state.northPivot, { isCarGate: true });
    this.registerClickableObject(state.southPivot, { isCarGate: true });
    state.northPivot.userData = { ...state.northPivot.userData, carGateRole: 'northPivot' };
    state.southPivot.userData = { ...state.southPivot.userData, carGateRole: 'southPivot' };
    this.carGatePair = state;
  }

  /** Registers an interactive prop with a custom click toggle callback (e.g. extending the dining table). */
  public registerToggleCallback(
    root: THREE.Object3D,
    onToggle: () => void,
    dynamicRoots: readonly THREE.Object3D[] = [root]
  ): void {
    const id = this.allocateId('toggle');
    this.registerClickableObject(root, { interactableId: id });
    this.toggleCallbacks.set(id, { onToggle, dynamicRoots });
  }

  /**
   * Registers the Barn TrackMan Golf Simulator active club swing, 3D ball launch,
   * screen fabric ripple, and live projected trajectory animation.
   */
  public registerGolfSimulatorShot(config: GolfSimulatorShotConfig): string {
    const id = GOLF_SIMULATOR_SHOT_ID;
    for (const target of config.clickableTargets) {
      this.registerClickableObject(target, { interactableId: id, isGolfSimulatorShot: true });
    }
    this.golfSimulatorShot = createGolfSimulatorShotState(config);
    return id;
  }

  /**
   * Registers a self-contained animated prop (see `AnimatedInteractable`): its click targets get
   * `interactableId = device.id`, and clicks, prompts, per-frame steps and dynamic-object
   * collection are routed to it.
   */
  public registerAnimatedInteractable(device: AnimatedInteractable): string {
    for (const target of device.clickableTargets) {
      this.registerClickableObject(target, { interactableId: device.id });
    }
    this.#animated.set(device.id, device);
    return device.id;
  }

  // ---------------------------------------------------------------------------
  // Car gates
  // ---------------------------------------------------------------------------

  public setUnbatchSubtreeHandler(handler: ((root: THREE.Object3D) => void) | null): void {
    this.#unbatchSubtreeHandler = handler;
  }

  #ensureUnbatched(root: THREE.Object3D | null | undefined): void {
    if (!root || this.#unbatchedRoots.has(root)) return;
    this.#unbatchedRoots.add(root);
    this.#unbatchSubtreeHandler?.(root);
    root.traverse((c) => {
      c.matrixAutoUpdate = true;
      (c as unknown as { static?: boolean }).static = false;
    });
  }

  #ensureUnbatchedSet(objects: ReadonlySet<THREE.Object3D>): void {
    for (const obj of objects) {
      let hasParentInSet = false;
      for (let p = obj.parent; p !== null; p = p.parent) {
        if (objects.has(p)) {
          hasParentInSet = true;
          break;
        }
      }
      if (!hasParentInSet) {
        this.#ensureUnbatched(obj);
      }
    }
  }

  #ensureUnbatchedDoor(door: HingedDoorState): void {
    this.#ensureUnbatched(door.pivot);
    if (door.isFoldingFloorMat) {
      const tmp = new Set<THREE.Object3D>();
      collectGolfMatTrackDynamicObjects(door, tmp);
      this.#ensureUnbatchedSet(tmp);
    }
  }

  public setCarGatesOpen(isOpen: boolean): void {
    if (this.carGatePair && this.carGatePair.isOpen !== isOpen) {
      this.#ensureUnbatched(this.carGatePair.northPivot);
      this.#ensureUnbatched(this.carGatePair.southPivot);
      this.carGatePair.isOpen = isOpen;
      playCarGateSound(this.carGatePair);
    }
  }

  public isCarGatesOpen(): boolean {
    return this.carGatePair?.isOpen ?? false;
  }

  public getCarGatesProgress(): number {
    return this.carGatePair?.progress ?? 0;
  }

  // ---------------------------------------------------------------------------
  // Golf simulator
  // ---------------------------------------------------------------------------

  /**
   * Returns true when the Barn Golf Simulator folding hitting mat is stowed away
   * (or currently stowing away) so the golf bag is hidden and the simulator is put away.
   */
  public isGolfSimulatorStowed(): boolean {
    const gs = this.golfSimulatorShot;
    if (!gs || !gs.matDoorId) return false;
    const matDoor = this.hingedDoors.get(gs.matDoorId);
    if (!matDoor) return false;
    return matDoor.isOpen || matDoor.progress > 0.05;
  }

  /**
   * Triggers a full TrackMan Golf Simulator shot sequence. Does not trigger when the golf
   * simulator hitting mat is stowed away.
   */
  public triggerGolfSimulatorShot(): boolean {
    const gs = this.golfSimulatorShot;
    if (!gs) return false;
    const tmp = new Set<THREE.Object3D>();
    collectGolfShotDynamicObjects(gs, tmp);
    this.#ensureUnbatchedSet(tmp);
    return triggerGolfSimulatorShot(gs, this.isGolfSimulatorStowed());
  }

  public isGolfSimulatorShotPlaying(): boolean {
    return this.golfSimulatorShot?.isPlaying ?? false;
  }

  public getGolfSimulatorShotElapsedSec(): number | null {
    const gs = this.golfSimulatorShot;
    return gs && gs.isPlaying ? gs.elapsedSec : null;
  }

  public getGolfSimulatorPromptLabel(): string {
    return getGolfSimulatorPromptLabel(this.golfSimulatorShot, this.isGolfSimulatorStowed());
  }

  #cancelGolfShot(): void {
    if (this.golfSimulatorShot) cancelGolfSimulatorShot(this.golfSimulatorShot);
  }

  // ---------------------------------------------------------------------------
  // Clicks / toggles
  // ---------------------------------------------------------------------------

  #closeConflictingDoors(openedId: string): void {
    const stable = this.#stableIdOf(openedId);
    const conflicts = stable === undefined ? undefined : this.#doorPolicy.conflicts[stable];
    if (!conflicts) return;
    for (const conflictStableId of conflicts) {
      const conflictId = this.resolveInteractableId(conflictStableId);
      const otherDoor = this.hingedDoors.get(conflictId);
      if (otherDoor && otherDoor.isOpen) {
        otherDoor.fromAngle = undefined;
        otherDoor.isOpen = false;
        otherDoor.speed = 3.2;
      }
      const otherBifold = this.bifoldCupboards.get(conflictId);
      if (otherBifold && otherBifold.isOpen) {
        otherBifold.isOpen = false;
      }
    }
  }

  /** Common open/close bookkeeping: conflicts when opening, barge cooldown when closing. */
  #afterDoorTargetChanged(door: HingedDoorState, changed = true): void {
    door.onStateChange?.(door.isOpen);
    if (door.isOpen) {
      this.#closeConflictingDoors(door.id);
    } else if (changed) {
      this.#manualCloseMs.set(door.id, performance.now());
    }
  }

  /**
   * Sets a door's open target (plus its linked partner leaf). `syncLinkedDrawer` mirrors the
   * target onto a linked drawer (golf bag) as a direct click does.
   */
  #setDoorTarget(door: HingedDoorState, isOpen: boolean, speed: number, syncLinkedDrawer: boolean): void {
    this.#ensureUnbatchedDoor(door);
    const changed = door.isOpen !== isOpen;
    door.fromAngle = undefined;
    door.isOpen = isOpen;
    door.speed = speed;
    if (changed) {
      const audioOverride = this.#audioOverrides.get(door.id);
      if (audioOverride) {
        playSmartInteractionAudio(door.pivot, audioOverride, isOpen, 'hinge');
      } else {
        playHingedDoorSound(door, isOpen ? 'open' : 'close');
      }
    }
    if (door.isFoldingFloorMat && door.isOpen) {
      this.#cancelGolfShot();
    }
    if (syncLinkedDrawer && door.linkedDrawerId) {
      const linkedDrawer = this.slidingDrawers.get(door.linkedDrawerId);
      if (linkedDrawer) {
        this.#ensureUnbatched(linkedDrawer.group);
        linkedDrawer.isOpen = door.isOpen;
      }
    }
    const partnerChanged = door.partnerDoorId ? (this.hingedDoors.get(door.partnerDoorId)?.isOpen !== door.isOpen) : false;
    this.#afterDoorTargetChanged(door, changed);
    if (door.partnerDoorId) {
      const partner = this.hingedDoors.get(door.partnerDoorId);
      if (partner) {
        this.#ensureUnbatchedDoor(partner);
        partner.fromAngle = undefined;
        partner.isOpen = door.isOpen;
        partner.speed = door.speed;
        this.#afterDoorTargetChanged(partner, partnerChanged);
      }
    }
  }

  /** `garage-door`: opens every overhead garage door if any is closed, otherwise closes them all. */
  #toggleGarageDoors(): boolean {
    const garageDoors = [...this.hingedDoors.values()].filter((d) => d.overheadTrackZ !== undefined);
    if (garageDoors.length === 0) return false;
    const open = garageDoors.some((d) => !d.isOpen);
    for (const door of garageDoors) {
      if (door.isOpen !== open) this.#setDoorTarget(door, open, getClickToggleSpeed(door), true);
    }
    return true;
  }

  /**
   * Toggles the interactive prop with the given id (legacy `door-N`, stable `door:<name>`, or the
   * `garage-door` group). Returns true if a prop was matched and toggled. Pseudo-device ids
   * (`car-gates`, `kitchen-bifolds`, `frame-tv`) return false: see `getPseudoDeviceUserData`.
   */
  public handleInteractableClick(interactableId: string): boolean {
    if (interactableId === GARAGE_DOOR_GROUP_ID) {
      return this.#toggleGarageDoors();
    }
    const id = this.resolveInteractableId(interactableId);

    if (this.golfSimulatorShot && this.golfSimulatorShot.id === id) {
      return this.triggerGolfSimulatorShot();
    }

    const animated = this.#animated.get(id);
    if (animated) {
      const animTargets = new Set<THREE.Object3D>();
      animated.collectDynamicObjects(animTargets);
      this.#ensureUnbatchedSet(animTargets);
      const wasFpActive = animated.isFirstPersonActive?.() ?? false;
      const handled = animated.trigger();
      if (handled && !wasFpActive && (animated.isFirstPersonActive?.() ?? false)) {
        for (const [otherId, other] of this.#animated) {
          if (otherId !== id && (other.isFirstPersonActive?.() ?? false)) {
            other.cancelFirstPerson?.();
          }
        }
      }
      return handled;
    }

    const toggleCb = this.toggleCallbacks.get(id);
    if (toggleCb) {
      for (const r of toggleCb.dynamicRoots) {
        this.#ensureUnbatched(r);
      }
      toggleCb.onToggle();
      return true;
    }

    const door = this.hingedDoors.get(id);
    if (door) {
      this.#setDoorTarget(door, !door.isOpen, getClickToggleSpeed(door), true);
      return true;
    }

    const bifoldCup = this.bifoldCupboards.get(id);
    if (bifoldCup) {
      this.#ensureUnbatched(bifoldCup.outerPivot);
      this.#ensureUnbatched(bifoldCup.innerLeaf);
      bifoldCup.isOpen = !bifoldCup.isOpen;
      playBifoldSound(bifoldCup.outerPivot, bifoldCup.isOpen);
      if (bifoldCup.isOpen) {
        this.#closeConflictingDoors(id);
      }
      return true;
    }

    const drawer = this.slidingDrawers.get(id);
    if (drawer) {
      this.#ensureUnbatched(drawer.group);
      drawer.isOpen = !drawer.isOpen;
      const drawerAudioOverride = this.#audioOverrides.get(id);
      if (drawerAudioOverride) {
        playSmartInteractionAudio(drawer.group, drawerAudioOverride, drawer.isOpen, 'slide');
      } else {
        playSlidingDrawerSound(drawer);
      }
      if (drawer.linkedDoorId) {
        const linkedDoor = this.hingedDoors.get(drawer.linkedDoorId);
        if (linkedDoor) {
          this.#ensureUnbatchedDoor(linkedDoor);
          linkedDoor.fromAngle = undefined;
          linkedDoor.isOpen = drawer.isOpen;
          linkedDoor.speed = 1.55;
          if (linkedDoor.isFoldingFloorMat && linkedDoor.isOpen) {
            this.#cancelGolfShot();
          }
          linkedDoor.onStateChange?.(linkedDoor.isOpen);
        }
      }
      return true;
    }

    if (this.pulleyMaid && this.pulleyMaid.id === id) {
      const pmTargets = new Set<THREE.Object3D>();
      collectPulleyMaidDynamicObjects(this.pulleyMaid, pmTargets);
      this.#ensureUnbatchedSet(pmTargets);
      this.pulleyMaid.isLowered = !this.pulleyMaid.isLowered;
      playPulleyMaidSound(this.pulleyMaid);
      return true;
    }

    const smartEntry = this.#smartEntries.get(id);
    if (smartEntry) {
      for (let i = 0; i < smartEntry.dynamicRoots.length; i++) {
        this.#ensureUnbatched(smartEntry.dynamicRoots[i]!);
      }
      const nextActive = !smartEntry.state.active;
      setSmartEntryActive(smartEntry, nextActive);
      if (smartEntry.state.kind === 'hinge') {
        for (let i = 0; i < smartEntry.state.partnerIds.length; i++) {
          const partner = this.#smartEntries.get(smartEntry.state.partnerIds[i]!);
          if (partner) {
            for (let j = 0; j < partner.dynamicRoots.length; j++) {
              this.#ensureUnbatched(partner.dynamicRoots[j]!);
            }
            if (partner.state.active !== nextActive) {
              partner.state.active = nextActive;
            }
          }
        }
      }
      return true;
    }

    return false;
  }

  /** Opens/closes a hinged door (and its linked partner leaf) programmatically. */
  public setHingedDoorOpen(interactableId: string, isOpen: boolean): boolean {
    const door = this.hingedDoors.get(this.resolveInteractableId(interactableId));
    if (!door) return false;
    this.#setDoorTarget(door, isOpen, 2.8, false);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Walkthrough door barge
  // ---------------------------------------------------------------------------

  /**
   * Returns true if `interactableId` is a walk-through room, exterior, courtyard, or stable door
   * (rather than a cupboard, larder, or appliance door).
   */
  /**
   * Returns true when a hinged door or overhead garage door (by stable or legacy id)
   * is open or mid-animation (progress > 0.01). Used by PortalVisibilitySolver.
   */
  public isInteractableOpenOrMoving(interactableId: string): boolean {
    const legacyId = this.resolveInteractableId(interactableId);
    const door = this.hingedDoors.get(legacyId);
    if (door) {
      return (
        door.isOpen ||
        Math.abs(door.progress) > 0.01 ||
        (door.overheadTrackZ === undefined &&
          !door.isFoldingFloorMat &&
          Math.abs(door.pivot.rotation[door.axis]) > 0.015)
      );
    }

    return false;
  }

  public isWalkthroughDoor(interactableId: string): boolean {
    const door = this.hingedDoors.get(this.resolveInteractableId(interactableId));
    return door ? isWalkthroughDoorState(door, this.tmpHingeWorld) : false;
  }

  /** See `bargeOpenWalkthroughDoor` in `handlers/walkthrough-door-barge.ts`. */
  public bargeOpenWalkthroughDoor(
    interactableId: string,
    isSprinting = false,
    footX?: number,
    footY?: number,
    footZ?: number,
    moveDirX?: number,
    moveDirZ?: number
  ): boolean {
    return bargeOpenWalkthroughDoor(
      this.#bargeContext,
      this.resolveInteractableId(interactableId),
      isSprinting,
      footX,
      footY,
      footZ,
      moveDirX,
      moveDirZ
    );
  }

  /** See `bargeNearbyWalkthroughDoors` in `handlers/walkthrough-door-barge.ts`. */
  public bargeNearbyWalkthroughDoors(
    footX: number,
    footY: number,
    footZ: number,
    moveDirX: number,
    moveDirZ: number,
    isSprinting = false
  ): boolean {
    return bargeNearbyWalkthroughDoors(
      this.#bargeContext,
      footX,
      footY,
      footZ,
      moveDirX,
      moveDirZ,
      isSprinting
    );
  }

  #effectiveOpenAngle(door: HingedDoorState): number {
    const stable = this.#stableIdOf(door.id);
    const override = stable === undefined ? undefined : this.#doorPolicy.openAngles[stable];
    return getEffectiveDoorOpenAngle(door, getDefaultDoorOpenAngle(door, override));
  }

  // ---------------------------------------------------------------------------
  // Prompts
  // ---------------------------------------------------------------------------

  /**
   * Returns a concise action prompt label for a looked-at interactive mesh
   * (e.g. "Open Door", "Close Cupboard", "Open AGA Lid", "Toggle Light Switch").
   */
  public describeInteractable(mesh: THREE.Object3D, isBifoldsOpen = false): string {
    const data = mesh.userData as InteractiveUserData;
    const id = data.interactableId ?? this.getSmartInteractableIdForObject(mesh);
    if (id) {
      const door = this.hingedDoors.get(id);
      if (door) {
        return describeHingedDoor(door, mesh, () => this.isWalkthroughDoor(id));
      }
      const bifoldCup = this.bifoldCupboards.get(id);
      if (bifoldCup) {
        return `${bifoldCup.isOpen ? 'Close' : 'Open'} Pantry Bi-Fold Doors`;
      }
      const drawer = this.slidingDrawers.get(id);
      if (drawer) {
        if (drawer.linkedDoorId) {
          return `${drawer.isOpen ? 'Roll Out Flush' : 'Lift & Roll In'} Golf Simulator Mat`;
        }
        return `${drawer.isOpen ? 'Close' : 'Open'} Drawer`;
      }
      if (this.pulleyMaid && this.pulleyMaid.id === id) {
        return `${this.pulleyMaid.isLowered ? 'Raise' : 'Lower'} Pulley Maid Airer`;
      }
      if (this.toggleCallbacks.has(id)) {
        return 'Extend / Retract Table';
      }
      if (this.golfSimulatorShot && this.golfSimulatorShot.id === id) {
        return this.getGolfSimulatorPromptLabel();
      }
      const animated = this.#animated.get(id);
      if (animated) {
        return animated.describe();
      }
      const smartEntry = this.#smartEntries.get(id);
      if (smartEntry) {
        return describeSmartInteractionEntry(smartEntry);
      }
    }
    return describeFlagInteractable(data, {
      isBifoldsOpen,
      isCarGatesOpen: this.isCarGatesOpen(),
      golfPrompt: () => this.getGolfSimulatorPromptLabel(),
    });
  }

  // ---------------------------------------------------------------------------
  // Dynamic objects & update loop
  // ---------------------------------------------------------------------------

  /**
   * Collects all dynamic Object3Ds managed by the registry so static matrix
   * freezing leaves their transforms dynamic.
   */
  public collectDynamicObjects(outSet: Set<THREE.Object3D>): void {
    for (const tc of this.toggleCallbacks.values()) {
      for (const r of tc.dynamicRoots) {
        r.traverse((c) => outSet.add(c));
      }
    }
    for (const door of this.hingedDoors.values()) {
      door.pivot.traverse((c) => outSet.add(c));
      if (door.isFoldingFloorMat) {
        collectGolfMatTrackDynamicObjects(door, outSet);
      }
    }
    for (const bf of this.bifoldCupboards.values()) {
      bf.outerPivot.traverse((c) => outSet.add(c));
      bf.innerLeaf.traverse((c) => outSet.add(c));
    }
    for (const dr of this.slidingDrawers.values()) {
      dr.group.traverse((c) => outSet.add(c));
    }
    if (this.pulleyMaid) {
      collectPulleyMaidDynamicObjects(this.pulleyMaid, outSet);
    }
    if (this.carGatePair) {
      this.carGatePair.northPivot.traverse((c) => outSet.add(c));
      this.carGatePair.southPivot.traverse((c) => outSet.add(c));
    }
    if (this.golfSimulatorShot) {
      collectGolfShotDynamicObjects(this.golfSimulatorShot, outSet);
    }
    for (const device of this.#animated.values()) {
      device.collectDynamicObjects(outSet);
    }
    for (const entry of this.#smartEntries.values()) {
      for (let i = 0; i < entry.dynamicRoots.length; i++) {
        entry.dynamicRoots[i]!.traverse((c) => outSet.add(c));
      }
    }
  }

  /**
   * Collects only continuously-moving ambient loop objects (e.g. active stove flames/sparks)
   * that must remain unbatched at boot; click-triggered doors, drawers, tables, and props
   * stay merged in static batches and lazily unbatch on first interaction.
   */
  public collectBootPinnedDynamicObjects(outSet: Set<THREE.Object3D>): void {
    for (const door of this.hingedDoors.values()) {
      if (isWalkthroughDoorState(door, this.tmpHingeWorld)) {
        door.pivot.traverse((c) => outSet.add(c));
      }
    }
    if (this.carGatePair) {
      this.carGatePair.northPivot.traverse((c) => outSet.add(c));
      this.carGatePair.southPivot.traverse((c) => outSet.add(c));
    }
    for (const device of this.#animated.values()) {
      if (!device.isAmbientLoop) continue;
      if (device.collectBootPinnedDynamicObjects) {
        device.collectBootPinnedDynamicObjects(outSet);
      } else {
        device.collectDynamicObjects(outSet);
      }
    }
  }

  /**
   * Returns the active first-person camera/body pose sample if any registered
   * `AnimatedInteractable` (e.g. gym treadmill run or bench press) is currently
   * driving a first-person sequence.
   */
  public getActiveFirstPersonPose(): FirstPersonPoseSample | null {
    for (const device of this.#animated.values()) {
      if (device.isFirstPersonActive?.()) {
        const pose = device.sampleFirstPersonPose?.() ?? null;
        if (pose) return pose;
      }
    }
    return null;
  }

  /**
   * Cancels any active first-person sequence on registered `AnimatedInteractable` devices.
   */
  public cancelActiveFirstPerson(): boolean {
    let cancelled = false;
    for (const device of this.#animated.values()) {
      if (device.isFirstPersonActive?.()) {
        device.cancelFirstPerson?.();
        cancelled = true;
      }
    }
    return cancelled;
  }

  /**
   * Checks if the player's feet `(footX, footY, footZ)` are inside the proximity trigger zone
   * of any registered `AnimatedInteractable` (such as the gym treadmill or squat rack).
   */
  public getProximityAnimatedInteractable(
    footX: number,
    footY: number,
    footZ: number
  ): { readonly id: string; readonly prompt: string; readonly targetMesh: THREE.Object3D | null } | null {
    for (const device of this.#animated.values()) {
      if (device.isFirstPersonActive?.() && device.isPlayerInProximityZone?.(footX, footY, footZ)) {
        const prompt = device.describe();
        if (prompt.length > 0) {
          return {
            id: device.id,
            prompt,
            targetMesh: device.clickableTargets[0] ?? null,
          };
        }
      }
    }
    for (const device of this.#animated.values()) {
      if (device.isPlayerInProximityZone?.(footX, footY, footZ)) {
        const prompt = device.describe();
        if (prompt.length > 0) {
          return {
            id: device.id,
            prompt,
            targetMesh: device.clickableTargets[0] ?? null,
          };
        }
      }
    }
    return null;
  }

  /** Steps all active animations. Returns true if any animation moved this frame. */
  public update(dtSeconds: number): boolean {
    let anyChanged = false;

    if (this.carGatePair && stepCarGates(this.carGatePair, dtSeconds)) {
      anyChanged = true;
    }

    for (const door of this.hingedDoors.values()) {
      if (this.#stepHingedDoor(door, dtSeconds)) anyChanged = true;
    }

    for (const bf of this.bifoldCupboards.values()) {
      if (stepBifoldCupboard(bf, dtSeconds)) anyChanged = true;
    }

    for (const dr of this.slidingDrawers.values()) {
      if (stepSlidingDrawer(dr, dtSeconds)) anyChanged = true;
    }

    if (this.pulleyMaid && stepPulleyMaid(this.pulleyMaid, dtSeconds)) {
      anyChanged = true;
    }

    if (this.golfSimulatorShot && stepGolfSimulatorShot(this.golfSimulatorShot, dtSeconds)) {
      anyChanged = true;
    }

    for (const device of this.#animated.values()) {
      if (!device.isAmbientLoop && device.step(dtSeconds)) anyChanged = true;
    }

    for (const entry of this.#smartEntries.values()) {
      if (
        stepSmartInteractionEntry(entry, dtSeconds, (roots) => {
          for (let i = 0; i < roots.length; i++) {
            this.#ensureUnbatched(roots[i]!);
          }
        })
      ) {
        anyChanged = true;
      }
    }

    return anyChanged;
  }

  /**
   * Steps continuous ambient visual animations (such as flickering stove flames and embers)
   * that request a frame render without invalidating shadow maps.
   */

  /**
   * Discovers and caches openable hinged/overhead exterior doors by probing `0.85 m` along both
   * sides of each doorway normal, returning live `0..1` `openness` without touching enumerable
   * snapshot state.
   */
  public getExteriorDoorAcousticPortals(
    isInteriorPoint: (x: number, y: number, z: number) => boolean
  ): readonly AcousticPortalState[] {
    if (!this.#cachedExteriorDoorPortals) {
      const entries: {
        readonly door: HingedDoorState;
        readonly state: {
          readonly id: string;
          readonly position: readonly [number, number, number];
          readonly areaM2: number;
          openness: number;
        };
      }[] = [];
      const output: AcousticPortalState[] = [];
      const probeDist = 0.85;

      for (const [legacyId, door] of this.hingedDoors.entries()) {
        if (door.isFoldingFloorMat) continue;
        const isOverhead = door.overheadTrackZ !== undefined;
        if (!isOverhead && !isWalkthroughDoorState(door, this.tmpHingeWorld)) continue;

        let cx: number;
        let cy: number;
        let cz: number;
        let nx: number;
        let nz: number;
        let areaM2: number;

        if (isOverhead) {
          const savedRot = door.pivot.rotation[door.axis];
          const savedPosZ = door.pivot.position.z;
          if (savedRot !== door.closedAngle || (door.closedPosZ !== undefined && savedPosZ !== door.closedPosZ)) {
            door.pivot.rotation[door.axis] = door.closedAngle;
            if (door.closedPosZ !== undefined) door.pivot.position.z = door.closedPosZ;
          }
          door.pivot.updateWorldMatrix(true, true);
          this.#tmpPortalBox.setFromObject(door.pivot);
          door.pivot.getWorldQuaternion(this.#tmpPortalQuat);
          if (savedRot !== door.closedAngle || savedPosZ !== door.pivot.position.z) {
            door.pivot.rotation[door.axis] = savedRot;
            door.pivot.position.z = savedPosZ;
            door.pivot.updateWorldMatrix(true, true);
          }
          if (this.#tmpPortalBox.isEmpty()) continue;
          cx = (this.#tmpPortalBox.min.x + this.#tmpPortalBox.max.x) * 0.5;
          cy = (this.#tmpPortalBox.min.y + this.#tmpPortalBox.max.y) * 0.5;
          cz = (this.#tmpPortalBox.min.z + this.#tmpPortalBox.max.z) * 0.5;
          this.#tmpPortalForward.set(0, 0, 1).applyQuaternion(this.#tmpPortalQuat);
          const nLen = Math.hypot(this.#tmpPortalForward.x, this.#tmpPortalForward.z);
          nx = nLen > 1e-4 ? this.#tmpPortalForward.x / nLen : 0;
          nz = nLen > 1e-4 ? this.#tmpPortalForward.z / nLen : 1;
          const spanXZ = Math.max(
            this.#tmpPortalBox.max.x - this.#tmpPortalBox.min.x,
            this.#tmpPortalBox.max.z - this.#tmpPortalBox.min.z
          );
          const height = Math.max(0.5, this.#tmpPortalBox.max.y - this.#tmpPortalBox.min.y);
          areaM2 = Math.max(0.5, spanXZ * height);
        } else {
          const geom = getClosedDoorwayGeometry(door, this.tmpHingeWorld);
          cx = geom.centerX;
          cy = (geom.minY + geom.maxY) * 0.5;
          cz = geom.centerZ;
          nx = geom.normalX;
          nz = geom.normalZ;
          areaM2 = Math.max(0.5, geom.halfWidth * 2 * Math.max(0.5, geom.maxY - geom.minY));
        }

        const sideAInterior = isInteriorPoint(cx + nx * probeDist, cy, cz + nz * probeDist);
        const sideBInterior = isInteriorPoint(cx - nx * probeDist, cy, cz - nz * probeDist);
        if (sideAInterior === sideBInterior) continue;

        const stableId = this.#ensureStableIds().byLegacy.get(legacyId) ?? legacyId;
        const state = {
          id: stableId,
          position: [cx, cy, cz] as const,
          areaM2,
          openness: door.progress,
        };
        entries.push({ door, state });
        output.push(state);
      }

      this.#cachedExteriorDoorPortals = { entries, output };
    }

    for (let i = 0; i < this.#cachedExteriorDoorPortals.entries.length; i++) {
      const entry = this.#cachedExteriorDoorPortals.entries[i]!;
      entry.state.openness = entry.door.progress;
    }
    if (this.#exteriorAcousticPortals.length === 0) {
      return this.#cachedExteriorDoorPortals.output;
    }
    return [
      ...this.#cachedExteriorDoorPortals.output,
      ...this.#exteriorAcousticPortals.map((provider) => provider()),
    ];
  }

  public stepAmbient(dtSeconds: number): boolean {
    let anyChanged = false;
    for (const device of this.#animated.values()) {
      if (device.isAmbientLoop && device.step(dtSeconds)) anyChanged = true;
    }
    return anyChanged;
  }

  #stepHingedDoor(door: HingedDoorState, dtSeconds: number): boolean {
    const target = door.isOpen ? 1 : 0;
    if (door.progress === target) return false;
    this.#ensureUnbatchedDoor(door);
    const step = dtSeconds * door.speed;
    door.progress =
      door.progress < target ? Math.min(1, door.progress + step) : Math.max(0, door.progress - step);
    if (door.isFoldingFloorMat) {
      applySlidingGolfMatKinematics(door, this.golfSimulatorShot);
    } else {
      applyHingedDoorPose(door, this.#effectiveOpenAngle(door));
    }
    if (door.progress === 0) {
      door.bargeSwingSign = undefined;
      door.fromAngle = undefined;
    } else if (door.progress === 1) {
      door.fromAngle = undefined;
    }
    door.pivot.updateMatrixWorld(true);
    return true;
  }
}
