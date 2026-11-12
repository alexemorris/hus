import * as THREE from 'three';
import type { InspectedAssetAction } from '../../../core/assets/asset-metadata.ts';
import type { AcousticPortalState } from '../../../core/types/acoustics.ts';
import type {
  AssetHingeInteractionSpec,
  AssetInteractionAudio,
  AssetInteractionSpec,
  AssetSlideInteractionSpec,
  AssetToggleInteractionSpec,
} from '../../assets/smart-asset.ts';
import { soundEngine } from '../../audio/sound-engine.ts';
import { playFoleyAtObject, type AudioEmitterHandle } from '../../audio/spatial-emitters.ts';
import { easeInOutCubic, stepProgress } from '../interaction-math.ts';

export interface SmartHingeRuntimeState {
  readonly kind: 'hinge';
  readonly axis: 'x' | 'y' | 'z';
  readonly closedAngle: number;
  readonly openAngle: number;
  readonly closedPos: THREE.Vector3;
  readonly closedQuat: THREE.Quaternion;
  readonly pivotOffset: THREE.Vector3;
  readonly hingeAnchor: THREE.Vector3;
  readonly hasPivotOffset: boolean;
  readonly partnerIds: string[];
  active: boolean;
  progress: number;
  readonly speed: number;
}

export interface SmartSlideRuntimeState {
  readonly kind: 'slide';
  readonly closedPos: THREE.Vector3;
  readonly openPos: THREE.Vector3;
  active: boolean;
  progress: number;
  readonly speed: number;
}

export interface SmartToggleRuntimeState {
  readonly kind: 'toggle' | 'custom';
  active: boolean;
  progress: number;
  elapsedActiveSec: number;
  readonly speed: number;
  readonly autoResetAfterSec: number | undefined;
}

export type SmartRuntimeState =
  | SmartHingeRuntimeState
  | SmartSlideRuntimeState
  | SmartToggleRuntimeState;

export interface SmartInteractionEntry {
  readonly id: string;
  readonly target: THREE.Object3D;
  readonly spec: AssetInteractionSpec;
  readonly clickableMeshes: readonly THREE.Object3D[];
  readonly dynamicRoots: readonly THREE.Object3D[];
  readonly activeLoopEmitter: AudioEmitterHandle | null;
  readonly state: SmartRuntimeState;
}

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

const tmpDeltaQuat = new THREE.Quaternion();
const tmpOffsetVec = new THREE.Vector3();
const tmpSoundWorldPos = new THREE.Vector3();
const tmpPortalBounds = new THREE.Box3();

function axisUnitVector(axis: 'x' | 'y' | 'z'): THREE.Vector3 {
  return axis === 'x' ? AXIS_X : axis === 'z' ? AXIS_Z : AXIS_Y;
}

export function collectClickableMeshesForTarget(
  target: THREE.Object3D,
  explicitTargets?: readonly THREE.Object3D[]
): THREE.Object3D[] {
  const roots = explicitTargets && explicitTargets.length > 0 ? explicitTargets : [target];
  const seen = new Set<THREE.Object3D>();
  const out: THREE.Object3D[] = [];
  for (let i = 0; i < roots.length; i++) {
    roots[i]!.traverse((child) => {
      if (child instanceof THREE.Mesh && !seen.has(child)) {
        seen.add(child);
        out.push(child);
      }
    });
  }
  return out;
}

export function createSmartInteractionEntry(
  id: string,
  target: THREE.Object3D,
  spec: AssetInteractionSpec,
  activeLoopEmitter: AudioEmitterHandle | null
): SmartInteractionEntry {
  const clickableMeshes = collectClickableMeshesForTarget(
    target,
    spec.kind === 'toggle' || spec.kind === 'custom' ? spec.clickableTargets : undefined
  );
  const dynamicRoots =
    (spec.kind === 'toggle' || spec.kind === 'custom') &&
    spec.dynamicTargets &&
    spec.dynamicTargets.length > 0
      ? [target, ...spec.dynamicTargets]
      : [target];

  let state: SmartRuntimeState;
  if (spec.kind === 'hinge') {
    const axis = spec.axis ?? 'y';
    const closedAngle = spec.initialAngle ?? target.rotation[axis];
    const [ox, oy, oz] = spec.pivotOffset;
    const pivotOffset = new THREE.Vector3(ox, oy, oz);
    const hasPivotOffset = Math.abs(ox) > 1e-6 || Math.abs(oy) > 1e-6 || Math.abs(oz) > 1e-6;
    const closedPos = target.position.clone();
    const closedQuat = target.quaternion.clone();
    const hingeAnchor = closedPos.clone().add(pivotOffset);
    state = {
      kind: 'hinge',
      axis,
      closedAngle,
      openAngle: spec.openAngle,
      closedPos,
      closedQuat,
      pivotOffset,
      hingeAnchor,
      hasPivotOffset,
      partnerIds: [],
      active: false,
      progress: 0,
      speed: spec.speed ?? 2.8,
    };
  } else if (spec.kind === 'slide') {
    const closedPos = target.position.clone();
    const [dx, dy, dz] = spec.slideDelta;
    const openPos = closedPos.clone().add(new THREE.Vector3(dx, dy, dz));
    state = {
      kind: 'slide',
      closedPos,
      openPos,
      active: false,
      progress: 0,
      speed: spec.speed ?? 2.8,
    };
  } else {
    const initialActive = Boolean(spec.initialActive);
    state = {
      kind: spec.kind,
      active: initialActive,
      progress: initialActive ? 1 : 0,
      elapsedActiveSec: 0,
      speed: spec.speed ?? 3.2,
      autoResetAfterSec: spec.autoResetAfterSec,
    };
  }

  return {
    id,
    target,
    spec,
    clickableMeshes,
    dynamicRoots,
    activeLoopEmitter,
    state,
  };
}

export function playSmartInteractionAudio(
  target: THREE.Object3D,
  audio: AssetInteractionAudio | undefined,
  active: boolean,
  fallbackKind?: 'hinge' | 'slide' | 'toggle' | 'custom',
  isAutoReset = false
): void {
  const spatialOpts = {
    dryGain: audio?.volume ?? 0.65,
    refDistance: audio?.refDistance ?? 1.8,
    maxDistance: audio?.maxDistance ?? 20,
  };

  if (audio) {
    if (audio.recipe) {
      if (isAutoReset && !active) return;
      target.updateWorldMatrix(true, false);
      target.getWorldPosition(tmpSoundWorldPos);
      soundEngine.playSpatial(tmpSoundWorldPos, (tk) => audio.recipe!(tk, active), spatialOpts);
      return;
    }
    const preset = active ? audio.openPreset : isAutoReset ? undefined : audio.closePreset;
    if (preset) {
      playFoleyAtObject(target, preset, spatialOpts);
    }
    return;
  }

  if (isAutoReset) return;
  if (fallbackKind === 'hinge') {
    playFoleyAtObject(target, 'doorLatch', spatialOpts);
  } else if (fallbackKind === 'slide') {
    playFoleyAtObject(target, 'drawerSlide', spatialOpts);
  }
}

export function applySmartHingePose(
  target: THREE.Object3D,
  state: SmartHingeRuntimeState
): void {
  const smooth = easeInOutCubic(state.progress);
  const currentAngle = state.closedAngle + (state.openAngle - state.closedAngle) * smooth;
  if (!state.hasPivotOffset) {
    target.rotation[state.axis] = currentAngle;
    return;
  }
  const deltaAngle = currentAngle - state.closedAngle;
  tmpDeltaQuat.setFromAxisAngle(axisUnitVector(state.axis), deltaAngle);
  tmpOffsetVec.copy(state.pivotOffset).negate().applyQuaternion(tmpDeltaQuat);
  target.position.copy(state.hingeAnchor).add(tmpOffsetVec);
  target.quaternion.multiplyQuaternions(tmpDeltaQuat, state.closedQuat);
}

export function applySmartSlidePose(
  target: THREE.Object3D,
  state: SmartSlideRuntimeState
): void {
  const smooth = easeInOutCubic(state.progress);
  target.position.lerpVectors(state.closedPos, state.openPos, smooth);
}

export function setSmartEntryActive(
  entry: SmartInteractionEntry,
  nextActive: boolean,
  isAutoReset = false
): boolean {
  const { state, spec, target, activeLoopEmitter } = entry;
  if (state.active === nextActive) return false;
  state.active = nextActive;
  if (state.kind === 'toggle' || state.kind === 'custom') {
    if (nextActive) {
      state.elapsedActiveSec = 0;
    }
    (spec as AssetToggleInteractionSpec).onToggle?.(nextActive, target);
  }
  activeLoopEmitter?.setActive(nextActive);
  playSmartInteractionAudio(target, spec.audio, nextActive, spec.kind, isAutoReset);
  return true;
}

export function stepSmartInteractionEntry(
  entry: SmartInteractionEntry,
  dtSeconds: number,
  ensureUnbatched: (roots: readonly THREE.Object3D[]) => void
): boolean {
  const { state, spec, target, dynamicRoots } = entry;

  if (state.kind === 'hinge') {
    const goal: 0 | 1 = state.active ? 1 : 0;
    if (state.progress === goal) return false;
    ensureUnbatched(dynamicRoots);
    state.progress = stepProgress(state.progress, goal, dtSeconds, state.speed);
    applySmartHingePose(target, state);
    target.updateMatrixWorld(true);
    return true;
  }

  if (state.kind === 'slide') {
    const goal: 0 | 1 = state.active ? 1 : 0;
    if (state.progress === goal) return false;
    ensureUnbatched(dynamicRoots);
    state.progress = stepProgress(state.progress, goal, dtSeconds, state.speed);
    applySmartSlidePose(target, state);
    target.updateMatrixWorld(true);
    return true;
  }

  let changed = false;
  const toggleSpec = spec as AssetToggleInteractionSpec;
  if (state.active) {
    state.elapsedActiveSec += dtSeconds;
    if (
      state.autoResetAfterSec !== undefined &&
      state.autoResetAfterSec > 0 &&
      state.elapsedActiveSec >= state.autoResetAfterSec
    ) {
      setSmartEntryActive(entry, false, true);
      changed = true;
    }
  }

  const goal: 0 | 1 = state.active ? 1 : 0;
  if (state.progress !== goal) {
    ensureUnbatched(dynamicRoots);
    state.progress = stepProgress(state.progress, goal, dtSeconds, state.speed);
    changed = true;
  }

  if (toggleSpec.onStep && (changed || state.active || state.progress > 0)) {
    ensureUnbatched(dynamicRoots);
    const stepMoved = toggleSpec.onStep(
      dtSeconds,
      {
        active: state.active,
        progress: easeInOutCubic(state.progress),
        elapsedActiveSec: state.elapsedActiveSec,
      },
      target
    );
    if (stepMoved) {
      target.updateMatrixWorld(true);
      changed = true;
    }
  }

  return changed;
}

export function describeSmartInteractionEntry(entry: SmartInteractionEntry): string {
  const { spec, state } = entry;
  if (spec.kind === 'toggle' || spec.kind === 'custom') {
    if (state.active && spec.activeLabel) {
      return spec.activeLabel;
    }
    return spec.label;
  }
  const lower = spec.label.toLowerCase();
  if (
    lower.startsWith('open ') ||
    lower.startsWith('close ') ||
    lower.startsWith('raise ') ||
    lower.startsWith('lower ') ||
    lower.startsWith('slide ')
  ) {
    if (!state.active) return spec.label;
    if (lower.startsWith('open ')) return `Close ${spec.label.slice(5)}`;
    if (lower.startsWith('close ')) return `Open ${spec.label.slice(6)}`;
    if (lower.startsWith('raise ')) return `Lower ${spec.label.slice(6)}`;
    if (lower.startsWith('lower ')) return `Raise ${spec.label.slice(6)}`;
  }
  return `${state.active ? 'Close' : 'Open'} ${spec.label}`;
}

export function toInspectedAssetAction(entry: SmartInteractionEntry): InspectedAssetAction {
  return {
    id: entry.id,
    label: describeSmartInteractionEntry(entry),
    active: entry.state.active,
    kind:
      entry.spec.kind === 'hinge'
        ? 'hinge'
        : entry.spec.kind === 'slide'
          ? 'slide'
          : entry.spec.kind === 'custom'
            ? 'custom'
            : 'toggle',
  };
}

export function createSmartAcousticPortalProvider(
  entry: SmartInteractionEntry
): (() => AcousticPortalState) | null {
  const spec = entry.spec as AssetHingeInteractionSpec | AssetSlideInteractionSpec;
  if ((spec.kind !== 'hinge' && spec.kind !== 'slide') || !spec.acousticPortal) {
    return null;
  }
  let cachedCenter: readonly [number, number, number] | null = null;
  let cachedAreaM2 = 0.85;
  return (): AcousticPortalState => {
    if (!cachedCenter) {
      entry.target.updateWorldMatrix(true, true);
      tmpPortalBounds.setFromObject(entry.target);
      if (!tmpPortalBounds.isEmpty()) {
        const cx = (tmpPortalBounds.min.x + tmpPortalBounds.max.x) * 0.5;
        const cy = (tmpPortalBounds.min.y + tmpPortalBounds.max.y) * 0.5;
        const cz = (tmpPortalBounds.min.z + tmpPortalBounds.max.z) * 0.5;
        const spanXZ = Math.max(
          tmpPortalBounds.max.x - tmpPortalBounds.min.x,
          tmpPortalBounds.max.z - tmpPortalBounds.min.z
        );
        const h = Math.max(0.25, tmpPortalBounds.max.y - tmpPortalBounds.min.y);
        cachedCenter = [cx, cy, cz];
        cachedAreaM2 = Math.max(0.15, spanXZ * h);
      } else {
        entry.target.getWorldPosition(tmpSoundWorldPos);
        cachedCenter = [tmpSoundWorldPos.x, tmpSoundWorldPos.y, tmpSoundWorldPos.z];
      }
    }
    return {
      id: entry.id,
      position: cachedCenter,
      areaM2: cachedAreaM2,
      openness: entry.state.progress,
    };
  };
}
