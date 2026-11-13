import * as THREE from 'three';
import { soundEngine } from '../../audio/sound-engine.ts';
import { easeInOutCubic } from '../interaction-math.ts';

/** World-space closed doorway threshold geometry, cached per door. */
export interface ClosedDoorwayGeometry {
  readonly centerX: number;
  readonly centerZ: number;
  readonly minY: number;
  readonly maxY: number;
  readonly tangentX: number;
  readonly tangentZ: number;
  readonly normalX: number;
  readonly normalZ: number;
  readonly halfWidth: number;
}

/**
 * Animation state of a hinged leaf: room/cupboard/appliance doors, the overhead garage doors
 * (`overheadTrackZ`) and the golf simulator sliding mat (`isFoldingFloorMat`).
 */
export interface HingedDoorState {
  readonly id: string;
  pivot: THREE.Group;
  readonly axis: 'x' | 'y' | 'z';
  closedAngle: number;
  openAngle: number;
  isOpen: boolean;
  progress: number;
  speed: number;
  overheadTrackZ?: number;
  closedPosZ?: number;
  isFoldingFloorMat?: boolean;
  closedPivotPos?: THREE.Vector3;
  stowedPivotOffset?: THREE.Vector3;
  linkedDrawerId?: string;
  partnerDoorId?: string;
  onStateChange?: (isOpen: boolean) => void;
  bargeSwingSign?: -1 | 1;
  fromAngle?: number;
  closedGeometry?: ClosedDoorwayGeometry;
  isWalkthroughCandidate?: boolean;
}

export function createHingedDoorState(
  id: string,
  pivot: THREE.Group,
  axis: 'x' | 'y' | 'z',
  initialAngle: number,
  openAngle: number
): HingedDoorState {
  return {
    id,
    pivot,
    axis,
    closedAngle: initialAngle,
    openAngle,
    isOpen: false,
    progress: 0,
    speed: 2.6,
  };
}

/** Click-toggle speed for a door (mat and overhead doors travel more slowly). */
export function getClickToggleSpeed(door: HingedDoorState): number {
  return door.isFoldingFloorMat ? 0.95 : door.overheadTrackZ !== undefined ? 1.55 : 2.8;
}

/** Applies the overhead-track rearward glide of an up-and-over garage door for `angle`. */
export function applyOverheadTrackOffset(door: HingedDoorState, angle: number): void {
  if (door.overheadTrackZ !== undefined && door.closedPosZ !== undefined) {
    door.pivot.position.z = door.closedPosZ + door.overheadTrackZ * Math.sin(Math.abs(angle));
  }
}

/** Poses a (non-mat) hinged door for its current `progress` towards `effectiveOpen`. */
export function applyHingedDoorPose(door: HingedDoorState, effectiveOpen: number): void {
  const pocketVec = door.pivot.userData?.pocketRetractOffset as THREE.Vector3 | undefined;
  if (pocketVec) {
    door.closedPivotPos ??= door.pivot.position.clone();
    const p = door.progress;
    const pivotT = easeInOutCubic(Math.min(1, p / 0.55));
    const retractT = p <= 0.55 ? 0 : easeInOutCubic((p - 0.55) / 0.45);
    door.pivot.rotation[door.axis] =
      door.closedAngle + (effectiveOpen - door.closedAngle) * pivotT;
    door.pivot.position.copy(door.closedPivotPos).addScaledVector(pocketVec, retractT);
    return;
  }
  const linearVec = door.pivot.userData?.linearSlideOffset as THREE.Vector3 | undefined;
  const smooth = easeInOutCubic(door.progress);
  const startAngle = door.fromAngle ?? door.closedAngle;
  const currentAngle = startAngle + (effectiveOpen - startAngle) * smooth;
  door.pivot.rotation[door.axis] = currentAngle;
  if (linearVec) {
    door.closedPivotPos ??= door.pivot.position.clone();
    door.pivot.position.copy(door.closedPivotPos).addScaledVector(linearVec, smooth);
  }
  applyOverheadTrackOffset(door, currentAngle);
}

/**
 * Computes the default collision-free open angle for a hinged door when clicked:
 * - `overrideAngle` (from the home's door policy) wins when present
 * - Provides a ~86° swing for doors whose initial registration specified `openAngle = 0`
 * - Clamps over-rotated (> 83°) cupboard/corner doors so adjacent doors never cross past 90°
 *   or intersect walls/furniture
 */
export function getDefaultDoorOpenAngle(
  door: HingedDoorState,
  overrideAngle: number | undefined
): number {
  if (overrideAngle !== undefined) return overrideAngle;

  const pivotChainLower = `${door.pivot.name} ${door.pivot.children[0]?.name ?? ""}`.toLowerCase();
  if (
    door.overheadTrackZ !== undefined ||
    door.isFoldingFloorMat ||
    door.pivot.userData?.pocketRetractOffset !== undefined ||
    door.pivot.userData?.linearSlideOffset !== undefined ||
    pivotChainLower.includes("tvcarrier") ||
    pivotChainLower.includes("safepanel")
  ) {
    return door.openAngle;
  }

  const rawDelta = door.openAngle - door.closedAngle;
  if (Math.abs(rawDelta) < 0.05) {
    const swingSign = door.pivot.position.z > 1.5 ? 1 : -1;
    return door.closedAngle + swingSign * Math.PI * 0.48;
  }

  const pivotChain = `${door.pivot.name} ${door.pivot.children[0]?.name ?? ""}`.toLowerCase();
  const isCupboardLike =
    door.isWalkthroughCandidate === false ||
    /understairs|cupboard|larder|fridge|freezer|winecooler|wardrobe|barcabinet|shower/.test(pivotChain);
  const maxSwing = pivotChain.includes("kingsley") ? 1.95 : isCupboardLike ? 1.45 : 1.54;
  if (Math.abs(rawDelta) > maxSwing) {
    return door.closedAngle + Math.sign(rawDelta) * maxSwing;
  }
  return door.openAngle;
}

/** Applies a walkthrough barge swing direction (if any) to the default open angle. */
export function getEffectiveDoorOpenAngle(door: HingedDoorState, defaultOpen: number): number {
  if (door.bargeSwingSign !== undefined && door.axis === 'y') {
    const mag = Math.abs(defaultOpen - door.closedAngle);
    return door.closedAngle + door.bargeSwingSign * mag;
  }
  return defaultOpen;
}

const tmpDoorBounds = new THREE.Box3();

/**
 * Computes and caches the world-space closed doorway threshold geometry for `door`:
 * - `(centerX, centerZ)` is the world XZ midpoint of the closed door leaf
 * - `(tangentX, tangentZ)` points along the closed door plane from the hinge jamb to the latch jamb
 * - `(normalX, normalZ) = (tangentZ, -tangentX)` is perpendicular to the closed doorway plane AND
 *   points in the exact world XZ direction that increasing `pivot.rotation.y` (`deltaAngle > 0`) swings the door leaf!
 */
export function getClosedDoorwayGeometry(
  door: HingedDoorState,
  tmpHingeWorld: THREE.Vector3
): ClosedDoorwayGeometry {
  if (door.closedGeometry) return door.closedGeometry;

  const savedRot = door.pivot.rotation[door.axis];
  if (savedRot !== door.closedAngle) {
    door.pivot.rotation[door.axis] = door.closedAngle;
    door.pivot.updateMatrixWorld(true);
  } else {
    door.pivot.updateMatrixWorld(true);
  }

  tmpDoorBounds.setFromObject(door.pivot);
  door.pivot.getWorldPosition(tmpHingeWorld);

  if (savedRot !== door.closedAngle) {
    door.pivot.rotation[door.axis] = savedRot;
    door.pivot.updateMatrixWorld(true);
  }

  const centerX = (tmpDoorBounds.min.x + tmpDoorBounds.max.x) * 0.5;
  const centerZ = (tmpDoorBounds.min.z + tmpDoorBounds.max.z) * 0.5;
  const dx = centerX - tmpHingeWorld.x;
  const dz = centerZ - tmpHingeWorld.z;
  const distFromHinge = Math.hypot(dx, dz);
  const boxSpan = Math.max(
    tmpDoorBounds.max.x - tmpDoorBounds.min.x,
    tmpDoorBounds.max.z - tmpDoorBounds.min.z
  );
  const halfWidth = distFromHinge >= 0.18 ? distFromHinge : Math.max(0.35, boxSpan * 0.5);
  const tangentX = distFromHinge >= 1e-4 ? dx / distFromHinge : 1;
  const tangentZ = distFromHinge >= 1e-4 ? dz / distFromHinge : 0;
  const normalX = tangentZ;
  const normalZ = -tangentX;

  const geom: ClosedDoorwayGeometry = {
    centerX,
    centerZ,
    minY: tmpDoorBounds.min.y,
    maxY: tmpDoorBounds.max.y,
    tangentX,
    tangentZ,
    normalX,
    normalZ,
    halfWidth,
  };
  door.closedGeometry = geom;
  return geom;
}

/**
 * Returns true if `door` is a walk-through room, exterior, courtyard, or stable door
 * (rather than a cupboard, larder, or appliance door).
 */
export function isWalkthroughDoorState(
  door: HingedDoorState,
  tmpHingeWorld: THREE.Vector3
): boolean {
  if (door.isWalkthroughCandidate !== undefined) {
    return door.isWalkthroughCandidate;
  }
  if (door.axis !== 'y') {
    door.isWalkthroughCandidate = false;
    return false;
  }
  const pivotName = (door.pivot.name + ' ' + (door.pivot.children[0]?.name ?? '')).toLowerCase();
  if (
    pivotName.includes('understairs') ||
    pivotName.includes('cupboard') ||
    pivotName.includes('wardrobe') ||
    pivotName.includes('southeastcupboards') ||
    pivotName.includes('larder') ||
    pivotName.includes('fridge') ||
    pivotName.includes('freezer') ||
    pivotName.includes('winecooler') ||
    pivotName.includes('storeupperhayloftdoor') ||
    pivotName.includes('pocket') ||
    pivotName.includes('tvcarrier') ||
    pivotName.includes('safepanel') ||
    pivotName.includes('eurogradesafe') ||
    pivotName.includes('kingsley') ||
    pivotName.includes('barcabinet') ||
    pivotName.includes('shower')
  ) {
    door.isWalkthroughCandidate = false;
    return false;
  }
  const geom = getClosedDoorwayGeometry(door, tmpHingeWorld);
  const h = geom.maxY - geom.minY;
  const w = geom.halfWidth * 2;
  const ok = h >= 0.92 && h <= 2.45 && w >= 0.45;
  door.isWalkthroughCandidate = ok;
  return ok;
}

/**
 * Returns a concise action prompt for a looked-at mesh belonging to `door`
 * (e.g. "Open Door", "Close Cupboard", "Open AGA Lid"). `isWalkthroughDoor` is evaluated lazily.
 */
export function describeHingedDoor(
  door: HingedDoorState,
  mesh: THREE.Object3D,
  isWalkthroughDoor: () => boolean
): string {
  const verb = door.isOpen ? 'Close' : 'Open';
  const chainNames = [
    mesh.name,
    mesh.parent?.name ?? '',
    door.pivot.name,
    door.pivot.children[0]?.name ?? '',
  ]
    .join(' ')
    .toLowerCase();
  if (chainNames.includes('kingsley')) {
    return `${verb} Kingsley Bar Cabinet`;
  }
  if (
    chainNames.includes('domelid') ||
    (chainNames.includes('aga') && /\blid\b/.test(chainNames))
  ) {
    return `${verb} AGA Simmering/Boiling Lid`;
  }
  if (chainNames.includes('balcony')) {
    return `${verb} Balcony Doors`;
  }
  if (
    chainNames.includes('aga') ||
    chainNames.includes('roasting') ||
    chainNames.includes('baking') ||
    chainNames.includes('simmering') ||
    chainNames.includes('warming')
  ) {
    return `${verb} AGA Oven Door`;
  }
  if (door.isFoldingFloorMat || chainNames.includes('turfmat')) {
    return `${door.isOpen ? 'Roll Out Flush' : 'Lift & Roll In'} Golf Simulator Mat`;
  }
  if (door.overheadTrackZ !== undefined) {
    return `${verb} Garage Door`;
  }
  if (chainNames.includes('tvcarrier') || chainNames.includes('safepanel')) {
    return `${verb} LG 55" G5 OLED TV Carrier`;
  }
  if (
    door.axis !== 'y' ||
    chainNames.includes('fridge') ||
    chainNames.includes('freezer') ||
    (chainNames.includes('wine') && !chainNames.includes('cellar')) ||
    chainNames.includes('dishwasher') ||
    chainNames.includes('miele')
  ) {
    return `${verb} Appliance Door`;
  }
  if (door.pivot.userData?.pocketRetractOffset !== undefined) {
    return `${verb} Pocket Wardrobe Doors`;
  }
  if (chainNames.includes('eurogradesafe')) {
    return `${verb} Safe`;
  }
  if (chainNames.includes('wardrobe') || chainNames.includes('southeastcupboards')) {
    return `${verb} Wardrobe`;
  }
  if (chainNames.includes('shower')) {
    return `${verb} Shower Door`;
  }
  if (isWalkthroughDoor()) {
    return `${verb} Door`;
  }
  return `${verb} Cupboard`;
}

const tmpDoorSoundPos = new THREE.Vector3();

/**
 * Synthesizes 3D spatial mechanical audio for a hinged door, overhead garage door, or sliding golf mat.
 */
export function playHingedDoorSound(
  door: HingedDoorState,
  action: 'open' | 'close' | 'barge'
): void {
  door.pivot.getWorldPosition(tmpDoorSoundPos);
  soundEngine.playSpatial(
    tmpDoorSoundPos,
    (tk) => {
      const { now } = tk;
      if (door.overheadTrackZ !== undefined) {
        tk.noiseBurst({
          startTime: now,
          duration: 0.55,
          filterType: 'bandpass',
          freqStart: action === 'open' ? 280 : 420,
          freqEnd: action === 'open' ? 520 : 240,
          q: 2.0,
          gainPeak: 0.16,
          attackSec: 0.05,
        });
        tk.tone({
          startTime: now,
          duration: 0.5,
          type: 'sawtooth',
          freqStart: 92,
          freqEnd: action === 'open' ? 112 : 76,
          gainPeak: 0.055,
        });
        return;
      }

      if (door.isFoldingFloorMat) {
        tk.noiseBurst({
          startTime: now,
          duration: 0.42,
          filterType: 'bandpass',
          freqStart: door.isOpen ? 460 : 680,
          freqEnd: door.isOpen ? 720 : 390,
          q: 1.8,
          gainPeak: 0.14,
          attackSec: 0.04,
        });
        return;
      }

      if (action === 'barge') {
        tk.tone({
          startTime: now,
          duration: 0.11,
          type: 'sine',
          freqStart: 165,
          freqEnd: 52,
          gainPeak: 0.34,
        });
        tk.tone({
          startTime: now + 0.01,
          duration: 0.035,
          type: 'triangle',
          freqStart: 2200,
          freqEnd: 1100,
          gainPeak: 0.18,
        });
        tk.noiseBurst({
          startTime: now + 0.02,
          duration: 0.16,
          filterType: 'bandpass',
          freqStart: 850,
          freqEnd: 380,
          q: 1.8,
          gainPeak: 0.18,
        });
      } else if (action === 'open') {
        tk.tone({
          startTime: now,
          duration: 0.032,
          type: 'triangle',
          freqStart: 1950,
          freqEnd: 980,
          gainPeak: 0.14,
        });
        tk.tone({
          startTime: now + 0.03,
          duration: 0.22,
          type: 'sine',
          freqStart: 310,
          freqEnd: 420,
          gainPeak: 0.045,
        });
        tk.noiseBurst({
          startTime: now + 0.02,
          duration: 0.18,
          filterType: 'bandpass',
          freqStart: 620,
          freqEnd: 880,
          q: 2.4,
          gainPeak: 0.06,
        });
      } else {
        tk.tone({
          startTime: now + 0.18,
          duration: 0.095,
          type: 'sine',
          freqStart: 128,
          freqEnd: 46,
          gainPeak: 0.26,
        });
        tk.tone({
          startTime: now + 0.19,
          duration: 0.035,
          type: 'triangle',
          freqStart: 1680,
          freqEnd: 840,
          gainPeak: 0.13,
        });
      }
    },
    { dryGain: 0.55, wetSend: 0.22, refDistance: 2.0, maxDistance: 22 }
  );
}
