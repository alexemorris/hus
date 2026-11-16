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
import type { BifoldPanelRef } from '../viewer/scene-types.ts';
import { BifoldDoorAnimator, type BifoldDoorAssemblyConfig } from './bifold-animator.ts';
import { deriveStableIds, type StableIdKind, type StableIdSource } from './device-ids.ts';
import {
  createBifoldCupboardPair,
  playBifoldSound,
  stepBifoldCupboard,
  type BifoldCupboardState,
} from './handlers/bifold-cupboards.ts';
import { EMPTY_DOOR_POLICY, type DoorPolicy } from './handlers/door-policy.ts';
import type { AnimatedInteractable, FirstPersonPoseSample } from './handlers/animated-interactable.ts';
import { describeFlagInteractable } from './handlers/flag-prompts.ts';
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
import { GARAGE_DOOR_GROUP_ID } from './handlers/pseudo-devices.ts';
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
  createSwingGatePair,
  playSwingGateSound,
  stepSwingGatePair,
  type SwingGatePairConfig,
  type SwingGatePairState,
} from './handlers/swing-gates.ts';
import {
  bargeNearbyWalkthroughDoors,
  bargeOpenWalkthroughDoor,
  type DoorBargeContext,
} from './handlers/walkthrough-door-barge.ts';

/** Extensible custom interactable handler registered by a home or prop builder. */
export interface CustomInteractionHandler {
  readonly id: string;
  readonly kind?: InteractableKind;
  readonly targets: readonly THREE.Object3D[];
  readonly cutsceneId?: string;
  readonly label?: string;
  readonly aliases?: readonly string[];
  getPromptLabel(): string;
  trigger(): boolean;
  cancel?(): void;
  isActive?(): boolean;
  getElapsedSec?(): number | null;
  step?(dtSeconds: number): boolean | void;
  collectDynamicObjects?(outSet: Set<THREE.Object3D>): void;
}

/** Kind of a registry-managed interactable, as reported by `listInteractables()`. */
export type InteractableKind =
  | 'door'
  | 'garage-door'
  | 'bifold-door'
  | 'swing-gate'
  | 'drawer'
  | 'bifold-cupboard'
  | 'toggle'
  | 'animated'
  | 'smart'
  | 'custom';

export interface InteractableInfo {
  /** Stable id (preferred for persistence / manifests). */
  readonly id: string;
  /** Build-order id written into mesh userData (still accepted everywhere). */
  readonly legacyId: string;
  readonly kind: InteractableKind;
  /** Display label (animated / custom / assembly props). */
  readonly label?: string;
  /** Natural-language aliases (animated / custom / assembly props). */
  readonly aliases?: readonly string[];
}

interface ToggleCallbackEntry {
  readonly onToggle: () => void;
  readonly dynamicRoots: readonly THREE.Object3D[];
  readonly label?: string;
}

interface BifoldAssemblyEntry {
  readonly config: BifoldDoorAssemblyConfig;
  readonly animator: BifoldDoorAnimator;
}

interface SwingGatePairEntry {
  readonly config: SwingGatePairConfig;
  readonly state: SwingGatePairState;
}

/**
 * Registry of every interactive 3D prop in a property scene: registration (from zone builders),
 * lookup by interactableId (legacy `door-N` or stable `door:<name>` ids), click handling,
 * describe/prompt text, the per-frame animation update and dynamic-object collection.
 * Device behaviour lives in `./handlers/*`; the registry only owns state and routing.
 */
export class InteractionRegistry {
  private readonly interactiveMeshes: THREE.Object3D[];
  private readonly hingedDoors = new Map<string, HingedDoorState>();
  private readonly bifoldCupboards = new Map<string, BifoldCupboardState>();
  private readonly slidingDrawers = new Map<string, SlidingDrawerState>();
  private readonly toggleCallbacks = new Map<string, ToggleCallbackEntry>();
  private nextId = 1;
  private readonly tmpHingeWorld = new THREE.Vector3();

  #doorPolicy: DoorPolicy = EMPTY_DOOR_POLICY;
  #stableIds: { byLegacy: Map<string, string>; byStable: Map<string, string> } | null = null;
  readonly #manualCloseMs = new Map<string, number>();
  readonly #bifoldAssemblies = new Map<string, BifoldAssemblyEntry>();
  readonly #swingGatePairs = new Map<string, SwingGatePairEntry>();
  readonly #animated = new Map<string, AnimatedInteractable>();
  readonly #customInteractions = new Map<string, CustomInteractionHandler>();
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

  public resolveInteractableId(id: string): string {
    if (!id.includes(':')) return id;
    return this.#ensureStableIds().byStable.get(id) ?? id;
  }

  public getStableId(id: string): string {
    return this.#ensureStableIds().byLegacy.get(this.resolveInteractableId(id)) ?? id;
  }

  public listInteractables(): readonly InteractableInfo[] {
    const { byLegacy } = this.#ensureStableIds();
    const out: InteractableInfo[] = [];
    const add = (legacyId: string, kind: InteractableKind): void => {
      out.push({ id: byLegacy.get(legacyId) ?? legacyId, legacyId, kind });
    };
    for (const door of this.hingedDoors.values()) {
      add(door.id, door.overheadTrackZ !== undefined ? 'garage-door' : 'door');
    }
    for (const dr of this.slidingDrawers.values()) add(dr.id, 'drawer');
    for (const bf of this.bifoldCupboards.values()) add(bf.id, 'bifold-cupboard');
    for (const id of this.toggleCallbacks.keys()) add(id, 'toggle');
    for (const { config } of this.#bifoldAssemblies.values()) {
      out.push({
        id: config.id,
        legacyId: config.id,
        kind: 'bifold-door',
        label: config.label ?? config.id,
        ...(config.aliases ? { aliases: config.aliases } : {}),
      });
    }
    for (const { config } of this.#swingGatePairs.values()) {
      out.push({
        id: config.id,
        legacyId: config.id,
        kind: 'swing-gate',
        label: config.label ?? config.id,
        ...(config.aliases ? { aliases: config.aliases } : {}),
      });
    }
    for (const custom of this.#customInteractions.values()) {
      out.push({
        id: custom.id,
        legacyId: custom.id,
        kind: custom.kind ?? 'custom',
        label: custom.label ?? (custom.getPromptLabel() || custom.id),
        ...(custom.aliases ? { aliases: custom.aliases } : {}),
      });
    }
    for (const device of this.#animated.values()) {
      out.push({
        id: device.id,
        legacyId: device.id,
        kind: 'animated',
        label: device.label,
        aliases: device.aliases,
      });
    }
    for (const entry of this.#smartEntries.values()) {
      out.push({ id: entry.id, legacyId: entry.id, kind: 'smart', label: entry.spec.label });
    }
    return out;
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

    for (const [id, entry] of this.#bifoldAssemblies) {
      if (!entry.config.panels.some((p) => isDescendant(p.group))) continue;
      actions.push({
        id,
        label: `${entry.animator.isOpen() ? 'Close' : 'Open'} ${entry.config.label ?? 'Bi-Fold Doors'}`,
        active: entry.animator.isOpen(),
        kind: 'hinge',
      });
    }

    for (const [id, entry] of this.#swingGatePairs) {
      if (!isDescendant(entry.state.pivotA) && !isDescendant(entry.state.pivotB)) continue;
      actions.push({
        id,
        label: `${entry.state.isOpen ? 'Close' : 'Open'} ${entry.config.label ?? 'Gates'}`,
        active: entry.state.isOpen,
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
        label: tc.label ?? 'Toggle Mechanism',
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

  public registerLightFixture(root: THREE.Object3D, circuitId: CircuitId): void {
    this.registerClickableObject(root, { circuitId });
  }

  /**
   * Registers a multi-leaf concertina bifold door assembly parameterized by id, panels, and track.
   */
  public registerBifoldDoorAssembly(config: BifoldDoorAssemblyConfig): BifoldDoorAnimator {
    const animator = new BifoldDoorAnimator(config.panels, config.track);
    for (const panel of config.panels) {
      this.registerClickableObject(panel.group, { interactableId: config.id });
      panel.group.userData = {
        ...panel.group.userData,
        isAnimatedDoor: true,
        isDynamicBarrier: true,
        isRigidDynamicGroup: true,
      };
    }
    for (const target of config.clickableTargets ?? []) {
      this.registerClickableObject(target, {
        interactableId: config.id,
        isAnimatedDoor: true,
      });
    }
    if (config.isExteriorPortal !== false && config.panels.length > 0) {
      this.#exteriorAcousticPortals.push(
        () =>
          animator.getAcousticPortalState(config.id) ?? {
            id: config.id,
            position: [config.track.anchorRightX, 1.1, config.track.trackZ],
            areaM2: 1.0,
            openness: 0,
          }
      );
    }
    this.#bifoldAssemblies.set(config.id, { config, animator });
    return animator;
  }

  public getBifoldAssembly(id: string): BifoldDoorAnimator | undefined {
    return this.#bifoldAssemblies.get(id)?.animator;
  }

  public isBifoldAssemblyOpen(id: string): boolean {
    return this.#bifoldAssemblies.get(id)?.animator.isOpen() ?? false;
  }

  public setBifoldAssemblyOpen(id: string, isOpen: boolean): boolean {
    const entry = this.#bifoldAssemblies.get(id);
    if (!entry) return false;
    for (const panel of entry.config.panels) {
      this.#ensureUnbatched(panel.group);
    }
    entry.animator.setOpen(isOpen);
    return true;
  }

  public toggleBifoldAssembly(id: string): boolean {
    const entry = this.#bifoldAssemblies.get(id);
    if (!entry) return false;
    for (const panel of entry.config.panels) {
      this.#ensureUnbatched(panel.group);
    }
    return entry.animator.toggle();
  }

  public getAllBifoldPanels(): readonly BifoldPanelRef[] {
    const out: BifoldPanelRef[] = [];
    for (const entry of this.#bifoldAssemblies.values()) {
      out.push(...entry.config.panels);
    }
    return out;
  }

  /**
   * Registers a generic paired swing-gate assembly (e.g. driveway, courtyard, or garden double gates).
   */
  public registerSwingGatePair(config: SwingGatePairConfig): SwingGatePairState {
    const state = createSwingGatePair(config);
    this.registerClickableObject(state.pivotA, { interactableId: config.id, tradeCategory: 'external' });
    this.registerClickableObject(state.pivotB, { interactableId: config.id, tradeCategory: 'external' });
    for (const pivot of [state.pivotA, state.pivotB]) {
      pivot.userData = {
        ...pivot.userData,
        isAnimatedDoor: true,
        isExteriorGate: true,
        isDynamicBarrier: true,
        isRigidDynamicGroup: true,
      };
    }
    for (const target of config.clickableTargets ?? []) {
      this.registerClickableObject(target, {
        interactableId: config.id,
        isExteriorGate: true,
        tradeCategory: 'external',
      });
    }
    this.#swingGatePairs.set(config.id, { config, state });
    return state;
  }

  public getSwingGatePair(id: string): SwingGatePairState | undefined {
    return this.#swingGatePairs.get(id)?.state;
  }

  public setSwingGatePairToggleHandler(id: string, onToggle: (nextOpen: boolean) => void): void {
    const entry = this.#swingGatePairs.get(id);
    if (entry) {
      this.#swingGatePairs.set(id, { ...entry, config: { ...entry.config, onToggle } });
    }
  }

  public isSwingGatePairOpen(id: string): boolean {
    return this.#swingGatePairs.get(id)?.state.isOpen ?? false;
  }

  public getSwingGatePairProgress(id: string): number {
    return this.#swingGatePairs.get(id)?.state.progress ?? 0;
  }

  public setSwingGatePairOpen(id: string, isOpen: boolean): boolean {
    const entry = this.#swingGatePairs.get(id);
    if (!entry) return false;
    if (entry.state.isOpen !== isOpen) {
      this.#ensureUnbatched(entry.state.pivotA);
      this.#ensureUnbatched(entry.state.pivotB);
      entry.state.isOpen = isOpen;
      playSwingGateSound(entry.state);
    }
    return true;
  }

  public toggleSwingGatePair(id: string): boolean {
    const entry = this.#swingGatePairs.get(id);
    if (!entry) return false;
    const next = !entry.state.isOpen;
    this.setSwingGatePairOpen(id, next);
    return next;
  }

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
    this.registerClickableObject(state.outerPivot, { interactableId: id, isJoineryDoor: true });
    this.registerClickableObject(innerLeaf, { interactableId: id, isJoineryDoor: true });
    state.outerPivot.userData = {
      ...state.outerPivot.userData,
      bifoldRole: 'outerPivot',
      isRigidDynamicGroup: true,
    };
    innerLeaf.userData = {
      ...innerLeaf.userData,
      bifoldRole: 'innerLeaf',
      isRigidDynamicGroup: true,
    };
    this.bifoldCupboards.set(id, state);
  }

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
      isRigidDynamicGroup: true,
      ...(cutawayDesc ? { isCutawayWall: true, cutawayWall: cutawayDesc } : {}),
    };
    this.slidingDrawers.set(id, state);
  }

  public registerExteriorAcousticPortal(provider: () => AcousticPortalState): void {
    this.#exteriorAcousticPortals.push(provider);
  }

  public registerToggleCallback(
    root: THREE.Object3D,
    onToggle: () => void,
    dynamicRoots: readonly THREE.Object3D[] = [root],
    label?: string
  ): void {
    const id = this.allocateId('toggle');
    this.registerClickableObject(root, { interactableId: id });
    this.toggleCallbacks.set(id, { onToggle, dynamicRoots, ...(label ? { label } : {}) });
  }

  public registerCustomInteraction(handler: CustomInteractionHandler): void {
    this.#customInteractions.set(handler.id, handler);
    for (const target of handler.targets) {
      this.registerClickableObject(target, { interactableId: handler.id, isCustomInteraction: true });
    }
  }

  public getCustomInteraction(id: string): CustomInteractionHandler | undefined {
    return this.#customInteractions.get(id);
  }

  public triggerCustomInteraction(id: string): boolean {
    const handler = this.#customInteractions.get(id);
    if (!handler) return false;
    if (handler.collectDynamicObjects) {
      const tmp = new Set<THREE.Object3D>();
      handler.collectDynamicObjects(tmp);
      this.#ensureUnbatchedSet(tmp);
    }
    return handler.trigger();
  }

  public getCustomInteractionElapsedSec(id: string): number | null {
    return this.#customInteractions.get(id)?.getElapsedSec?.() ?? null;
  }

  public getCustomInteractionPromptLabel(id: string): string {
    return this.#customInteractions.get(id)?.getPromptLabel() ?? '';
  }

  public getCustomInteractionCutsceneId(id: string): string | undefined {
    return this.#customInteractions.get(id)?.cutsceneId;
  }

  public registerAnimatedInteractable(device: AnimatedInteractable): string {
    for (const target of device.clickableTargets) {
      this.registerClickableObject(target, { interactableId: device.id });
    }
    this.#animated.set(device.id, device);
    return device.id;
  }

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
  }

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

  #afterDoorTargetChanged(door: HingedDoorState, changed = true): void {
    door.onStateChange?.(door.isOpen);
    if (door.isOpen) {
      this.#closeConflictingDoors(door.id);
    } else if (changed) {
      this.#manualCloseMs.set(door.id, performance.now());
    }
  }

  #setDoorTarget(door: HingedDoorState, isOpen: boolean, speed: number): void {
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

    const partnerChanged = door.partnerDoorId
      ? this.hingedDoors.get(door.partnerDoorId)?.isOpen !== door.isOpen
      : false;
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

  #toggleGarageDoors(): boolean {
    const garageDoors = [...this.hingedDoors.values()].filter((d) => d.overheadTrackZ !== undefined);
    if (garageDoors.length === 0) return false;
    const open = garageDoors.some((d) => !d.isOpen);
    for (const door of garageDoors) {
      if (door.isOpen !== open) this.#setDoorTarget(door, open, getClickToggleSpeed(door));
    }
    return true;
  }

  public handleInteractableClick(interactableId: string): boolean {
    if (interactableId === GARAGE_DOOR_GROUP_ID) {
      return this.#toggleGarageDoors();
    }
    const id = this.resolveInteractableId(interactableId);

    const bifoldAssembly = this.#bifoldAssemblies.get(interactableId) ?? this.#bifoldAssemblies.get(id);
    if (bifoldAssembly) {
      const nextOpen = !bifoldAssembly.animator.isOpen();
      if (bifoldAssembly.config.onToggle) {
        bifoldAssembly.config.onToggle(nextOpen);
      } else {
        this.setBifoldAssemblyOpen(bifoldAssembly.config.id, nextOpen);
      }
      return true;
    }

    const swingGate = this.#swingGatePairs.get(interactableId) ?? this.#swingGatePairs.get(id);
    if (swingGate) {
      const nextOpen = !swingGate.state.isOpen;
      if (swingGate.config.onToggle) {
        swingGate.config.onToggle(nextOpen);
      } else {
        this.setSwingGatePairOpen(swingGate.config.id, nextOpen);
      }
      return true;
    }

    if (this.#customInteractions.has(interactableId)) {
      return this.triggerCustomInteraction(interactableId);
    }
    if (this.#customInteractions.has(id)) {
      return this.triggerCustomInteraction(id);
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
      this.#setDoorTarget(door, !door.isOpen, getClickToggleSpeed(door));
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

  public setHingedDoorOpen(interactableId: string, isOpen: boolean): boolean {
    const door = this.hingedDoors.get(this.resolveInteractableId(interactableId));
    if (!door) return false;
    this.#setDoorTarget(door, isOpen, 2.8);
    return true;
  }

  public isInteractableOpenOrMoving(interactableId: string): boolean {
    const bifoldAssembly = this.#bifoldAssemblies.get(interactableId);
    if (bifoldAssembly) {
      return (
        bifoldAssembly.animator.isOpen() || bifoldAssembly.animator.getOpenProgress() > 0.01
      );
    }
    const swingGate = this.#swingGatePairs.get(interactableId);
    if (swingGate) {
      return swingGate.state.isOpen || swingGate.state.progress > 0.01;
    }
    const custom = this.#customInteractions.get(interactableId);
    if (custom) {
      return custom.isActive?.() ?? false;
    }
    const legacyId = this.resolveInteractableId(interactableId);
    const door = this.hingedDoors.get(legacyId);
    if (door) {
      return (
        door.isOpen ||
        Math.abs(door.progress) > 0.01 ||
        (door.overheadTrackZ === undefined &&
          Math.abs(door.pivot.rotation[door.axis]) > 0.015)
      );
    }
    return false;
  }

  public isWalkthroughDoor(interactableId: string): boolean {
    const door = this.hingedDoors.get(this.resolveInteractableId(interactableId));
    return door ? isWalkthroughDoorState(door, this.tmpHingeWorld) : false;
  }

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

  public describeInteractable(mesh: THREE.Object3D): string {
    const data = mesh.userData as InteractiveUserData;
    const id = data.interactableId ?? this.getSmartInteractableIdForObject(mesh);
    if (id) {
      const bifoldAssembly =
        (data.interactableId ? this.#bifoldAssemblies.get(data.interactableId) : undefined) ??
        this.#bifoldAssemblies.get(id);
      if (bifoldAssembly) {
        return `${bifoldAssembly.animator.isOpen() ? 'Close' : 'Open'} ${bifoldAssembly.config.label ?? 'Bi-Fold Doors'}`;
      }
      const swingGate =
        (data.interactableId ? this.#swingGatePairs.get(data.interactableId) : undefined) ??
        this.#swingGatePairs.get(id);
      if (swingGate) {
        return `${swingGate.state.isOpen ? 'Close' : 'Open'} ${swingGate.config.label ?? 'Gates'}`;
      }
      const door = this.hingedDoors.get(id);
      if (door) {
        return describeHingedDoor(door, mesh, () => this.isWalkthroughDoor(id));
      }
      const bifoldCup = this.bifoldCupboards.get(id);
      if (bifoldCup) {
        return `${bifoldCup.isOpen ? 'Close' : 'Open'} Bi-Fold Doors`;
      }
      const custom =
        (data.interactableId ? this.#customInteractions.get(data.interactableId) : undefined) ??
        this.#customInteractions.get(id);
      if (custom) {
        return custom.getPromptLabel();
      }
      const drawer = this.slidingDrawers.get(id);
      if (drawer) {
        return `${drawer.isOpen ? 'Close' : 'Open'} Drawer`;
      }
      const toggleCb = this.toggleCallbacks.get(id);
      if (toggleCb) {
        return toggleCb.label ?? data.interactionPromptLabel ?? 'Toggle Mechanism';
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
    return describeFlagInteractable(data);
  }

  public collectDynamicObjects(outSet: Set<THREE.Object3D>): void {
    for (const tc of this.toggleCallbacks.values()) {
      for (const r of tc.dynamicRoots) {
        r.traverse((c) => outSet.add(c));
      }
    }
    for (const door of this.hingedDoors.values()) {
      door.pivot.traverse((c) => outSet.add(c));
    }
    for (const entry of this.#bifoldAssemblies.values()) {
      for (const panel of entry.config.panels) {
        panel.group.traverse((c) => outSet.add(c));
      }
    }
    for (const entry of this.#swingGatePairs.values()) {
      entry.state.pivotA.traverse((c) => outSet.add(c));
      entry.state.pivotB.traverse((c) => outSet.add(c));
    }
    for (const bf of this.bifoldCupboards.values()) {
      bf.outerPivot.traverse((c) => outSet.add(c));
      bf.innerLeaf.traverse((c) => outSet.add(c));
    }
    for (const dr of this.slidingDrawers.values()) {
      dr.group.traverse((c) => outSet.add(c));
    }
    for (const custom of this.#customInteractions.values()) {
      custom.collectDynamicObjects?.(outSet);
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

  public collectBootPinnedDynamicObjects(outSet: Set<THREE.Object3D>): void {
    for (const door of this.hingedDoors.values()) {
      if (isWalkthroughDoorState(door, this.tmpHingeWorld)) {
        door.pivot.traverse((c) => outSet.add(c));
      }
    }
    for (const entry of this.#bifoldAssemblies.values()) {
      for (const panel of entry.config.panels) {
        panel.group.traverse((c) => outSet.add(c));
      }
    }
    for (const entry of this.#swingGatePairs.values()) {
      entry.state.pivotA.traverse((c) => outSet.add(c));
      entry.state.pivotB.traverse((c) => outSet.add(c));
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

  public getActiveFirstPersonPose(): FirstPersonPoseSample | null {
    for (const device of this.#animated.values()) {
      if (device.isFirstPersonActive?.()) {
        const pose = device.sampleFirstPersonPose?.() ?? null;
        if (pose) return pose;
      }
    }
    return null;
  }

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

    for (const entry of this.#bifoldAssemblies.values()) {
      if (entry.animator.update(dtSeconds)) anyChanged = true;
    }

    for (const entry of this.#swingGatePairs.values()) {
      if (stepSwingGatePair(entry.state, dtSeconds)) anyChanged = true;
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

    for (const custom of this.#customInteractions.values()) {
      if (custom.step?.(dtSeconds)) anyChanged = true;
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
    applyHingedDoorPose(door, this.#effectiveOpenAngle(door));
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
