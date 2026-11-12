import * as THREE from 'three';
import type { CutawayWallDescriptor } from '../../core/types/scene.ts';
import { tagCutaway } from '../../engine/geometry/mesh-traits.ts';
import type { Point2D } from '../../engine/geometry/period-house-primitives.ts';

export type WallFaceSide = 'left' | 'right' | 'interior' | 'exterior';
export type ObjectForwardAxis = '+z' | '-z' | '+x' | '-x';

/**
 * Orthonormal local coordinate frame anchored on a specific vertical face of a wall segment.
 *
 * - `originXZ` -> `toXZ`: horizontal span along the wall face (`lengthM = |toXZ - originXZ|`).
 * - `tangentXZ`: unit horizontal tangent `(toXZ - originXZ) / lengthM`.
 * - `normalXZ`: unit horizontal outward normal pointing **from the wall face into the room**.
 * - `rotationY`: `Math.atan2(normalXZ[0], normalXZ[1])` so Three.js local `+Z` points along `normalXZ`
 *   into the room, and local `+X` points along `[normalXZ[1], -normalXZ[0]]`.
 */
export interface WallFaceFrame {
  readonly originXZ: Point2D;
  readonly toXZ: Point2D;
  readonly lengthM: number;
  readonly tangentXZ: Point2D;
  readonly normalXZ: Point2D;
  readonly rotationY: number;
  readonly floorY: number;
  readonly ceilingHeight?: number;
  readonly cutaway?: CutawayWallDescriptor | null;
}

/**
 * Structural duck-type for `BuiltWallSegment` (or any wall segment exposing `.getFace(side, alongM?)`).
 */
export interface MountableWallSegment {
  getFace(side?: WallFaceSide, alongM?: number): WallFaceFrame;
}

export interface CreateWallFaceFrameOptions {
  readonly originXZ: Point2D;
  readonly toXZ: Point2D;
  /** Outward face normal pointing into the room; defaults to right-hand normal `[-tz, tx]` or `roomSide`. */
  readonly normalXZ?: Point2D;
  readonly roomSide?: 'left' | 'right';
  readonly floorY?: number;
  readonly ceilingHeight?: number;
  readonly cutaway?: CutawayWallDescriptor | null;
}

export interface WallMountOptions {
  /** Which face of a `BuiltWallSegment` to mount onto (`'interior'` auto-picks the room side on exterior walls). */
  readonly side?: WallFaceSide;
  /** Horizontal distance (metres) measured from `face.originXZ` along `face.tangentXZ`. */
  readonly alongM?: number;
  /** Fractional position (`0..1`) along `face.lengthM` when `alongM` & `offsetFromCenterM` are omitted (default `0.5`). */
  readonly fraction?: number;
  /** Signed horizontal offset (metres) from the midpoint `face.lengthM * 0.5` along `face.tangentXZ`. */
  readonly offsetFromCenterM?: number;
  /** Vertical elevation (metres) above `face.floorY` (default `0` when `worldY` is omitted). */
  readonly elevationY?: number;
  /** Explicit world-space `Y` coordinate (overrides `face.floorY + elevationY`). */
  readonly worldY?: number;
  /** Anti-z-fighting standoff clear of the wall plane along `face.normalXZ` (default `0.0005` = `0.5 mm`). */
  readonly standoffM?: number;
  /** Extra forward shift along `face.normalXZ` (e.g. `halfDepth` for origin-centered boxes). */
  readonly depthOffsetM?: number;
  /**
   * Depth anchor mode:
   * - `'origin'` (default): places `target`'s local origin at `standoffM + depthOffsetM` in front of the wall face.
   * - `'back'`: measures `target`'s local bounding box along its back direction and shifts forward so its rear-most
   *   surface sits at exact `standoffM + depthOffsetM` in front of the wall face.
   */
  readonly anchor?: 'back' | 'origin';
  /** Which local horizontal axis of `target` represents its room-facing front (default `'+z'`). */
  readonly objectForward?: ObjectForwardAxis;
  /** Optional extra yaw rotation (radians) added after aligning `objectForward` with `face.normalXZ`. */
  readonly yawOffsetRad?: number;
  /** Optional parent `THREE.Object3D` to `.add(target)` onto. */
  readonly parent?: THREE.Object3D;
  /** Automatically call `tagCutaway(target, face.cutaway)` when `face.cutaway` is non-null (default `true`). */
  readonly inheritCutaway?: boolean;
}

const DEFAULT_WALL_MOUNT_STANDOFF_M = 0.0005;

function forwardAxisYawOffset(axis: ObjectForwardAxis | undefined): number {
  switch (axis) {
    case '-z':
      return Math.PI;
    case '+x':
      return -Math.PI * 0.5;
    case '-x':
      return Math.PI * 0.5;
    case '+z':
    default:
      return 0;
  }
}

function measureBackExtentAlongForward(
  target: THREE.Object3D,
  objectForward: ObjectForwardAxis
): number {
  const savedPos = target.position.clone();
  const savedQuat = target.quaternion.clone();
  const savedScale = target.scale.clone();

  target.position.set(0, 0, 0);
  target.quaternion.identity();
  target.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(target);

  target.position.copy(savedPos);
  target.quaternion.copy(savedQuat);
  target.scale.copy(savedScale);
  target.updateMatrixWorld(true);

  if (box.isEmpty()) {
    return 0;
  }

  switch (objectForward) {
    case '+z':
      return -box.min.z;
    case '-z':
      return box.max.z;
    case '+x':
      return -box.min.x;
    case '-x':
      return box.max.x;
  }
}

/**
 * Constructs a normalized `WallFaceFrame` from two 2D face endpoints `[x, z]`.
 */
export function createWallFaceFrame(options: CreateWallFaceFrameOptions): WallFaceFrame {
  const dx = options.toXZ[0] - options.originXZ[0];
  const dz = options.toXZ[1] - options.originXZ[1];
  const len = Math.hypot(dx, dz);
  const tx = len > 1e-9 ? dx / len : 1;
  const tz = len > 1e-9 ? dz / len : 0;

  let nx: number;
  let nz: number;
  if (options.normalXZ) {
    const nLen = Math.hypot(options.normalXZ[0], options.normalXZ[1]) || 1;
    nx = options.normalXZ[0] / nLen;
    nz = options.normalXZ[1] / nLen;
  } else if (options.roomSide === 'left') {
    nx = tz;
    nz = -tx;
  } else {
    nx = -tz;
    nz = tx;
  }

  return {
    originXZ: [options.originXZ[0], options.originXZ[1]],
    toXZ: [options.toXZ[0], options.toXZ[1]],
    lengthM: len,
    tangentXZ: [tx, tz],
    normalXZ: [nx, nz],
    rotationY: Math.atan2(nx, nz),
    floorY: options.floorY ?? 0,
    ...(options.ceilingHeight !== undefined ? { ceilingHeight: options.ceilingHeight } : {}),
    cutaway: options.cutaway ?? null,
  };
}

function isMountableSegment(
  faceOrSegment: WallFaceFrame | MountableWallSegment
): faceOrSegment is MountableWallSegment {
  return typeof (faceOrSegment as MountableWallSegment).getFace === 'function';
}

function resolveAlongDistance(lengthM: number, options: WallMountOptions): number {
  if (options.alongM !== undefined) {
    return options.alongM;
  }
  if (options.offsetFromCenterM !== undefined) {
    return lengthM * 0.5 + options.offsetFromCenterM;
  }
  const fraction = options.fraction ?? 0.5;
  return lengthM * fraction;
}

/**
 * Resolves either a `WallFaceFrame` or a `BuiltWallSegment` into the concrete `WallFaceFrame`
 * at the requested `side` and horizontal `alongM` offset (so bay-split exterior walls resolve
 * the exact per-room `CutawayWallDescriptor`).
 */
export function resolveWallFaceFrame(
  faceOrSegment: WallFaceFrame | MountableWallSegment,
  options: WallMountOptions = {}
): WallFaceFrame {
  if (!isMountableSegment(faceOrSegment)) {
    return faceOrSegment;
  }
  const side = options.side ?? 'interior';
  const initialFace = faceOrSegment.getFace(side);
  const alongM = resolveAlongDistance(initialFace.lengthM, options);
  return faceOrSegment.getFace(side, alongM);
}

/**
 * Places, orients, offsets clear of z-fighting (`+0.5 mm` default standoff), and optionally
 * cutaway-tags `target` against a `WallFaceFrame` or `BuiltWallSegment`.
 */
export function placeOnWall<T extends THREE.Object3D>(
  target: T,
  faceOrSegment: WallFaceFrame | MountableWallSegment,
  options: WallMountOptions = {}
): T {
  const face = resolveWallFaceFrame(faceOrSegment, options);
  const alongM = resolveAlongDistance(face.lengthM, options);
  const standoffM = options.standoffM ?? DEFAULT_WALL_MOUNT_STANDOFF_M;
  const extraDepth = options.depthOffsetM ?? 0;
  const objectForward = options.objectForward ?? '+z';
  const backShift =
    options.anchor === 'back' ? measureBackExtentAlongForward(target, objectForward) : 0;
  const totalForwardM = standoffM + extraDepth + backShift;

  const wx = face.originXZ[0] + face.tangentXZ[0] * alongM + face.normalXZ[0] * totalForwardM;
  const wz = face.originXZ[1] + face.tangentXZ[1] * alongM + face.normalXZ[1] * totalForwardM;
  const wy =
    options.worldY !== undefined ? options.worldY : face.floorY + (options.elevationY ?? 0);

  const yaw = face.rotationY + forwardAxisYawOffset(objectForward) + (options.yawOffsetRad ?? 0);

  target.position.set(wx, wy, wz);
  target.rotation.set(0, yaw, 0);

  if (options.inheritCutaway !== false && face.cutaway) {
    tagCutaway(target, face.cutaway, { recursive: true });
  }

  if (options.parent) {
    options.parent.add(target);
  }

  return target;
}
