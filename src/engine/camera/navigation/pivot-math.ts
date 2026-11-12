import * as THREE from 'three';

/** Axis-aligned world-space box (metres). */
export interface NavigationBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** Region the orbit pivot (controls.target) is allowed to occupy across the full site & paddock. */
export const SITE_PIVOT_BOUNDS: NavigationBounds = {
  minX: -65,
  maxX: 65,
  minY: -2,
  maxY: 16,
  minZ: -55,
  maxZ: 60,
};

/** Maximum camera-to-pivot distance (m) before the pivot is pulled in (matches CameraRig maxDistance). */
export const PIVOT_MAX_DISTANCE = 44;

export interface PivotClampResult {
  /** The corrected pivot (a new vector; equal to the input if nothing changed). */
  readonly pivot: THREE.Vector3;
  readonly changed: boolean;
  /**
   * True when the corrected pivot still lies on the camera's current view ray, so it
   * can be applied instantly without any visible change to the view.
   */
  readonly onViewRay: boolean;
}

const EPS = 1e-6;

/** Clamps a world-space point component-wise to `bounds`. */
export function clampPointToBounds(
  point: THREE.Vector3,
  bounds: NavigationBounds = SITE_PIVOT_BOUNDS
): THREE.Vector3 {
  return new THREE.Vector3(
    THREE.MathUtils.clamp(point.x, bounds.minX, bounds.maxX),
    THREE.MathUtils.clamp(point.y, bounds.minY, bounds.maxY),
    THREE.MathUtils.clamp(point.z, bounds.minZ, bounds.maxZ)
  );
}

/**
 * Intersects the ray `origin + t * dir` (t >= 0) with the box using the slab method.
 * Returns the [tMin, tMax] interval or null if the ray misses.
 */
function rayBoxInterval(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  bounds: NavigationBounds
): [number, number] | null {
  let tMin = 0;
  let tMax = Number.POSITIVE_INFINITY;
  const axes: ReadonlyArray<[number, number, number, number]> = [
    [origin.x, dir.x, bounds.minX, bounds.maxX],
    [origin.y, dir.y, bounds.minY, bounds.maxY],
    [origin.z, dir.z, bounds.minZ, bounds.maxZ],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < EPS) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  return [tMin, tMax];
}

/**
 * Keeps the pivot inside `bounds` and within [minDistance, maxDistance] of the camera.
 * Prefers sliding the pivot along the camera->pivot ray (invisible to the user); only
 * falls back to an off-ray point when the ray never enters the valid region.
 */
export function clampPivot(
  cameraPos: THREE.Vector3,
  pivot: THREE.Vector3,
  bounds: NavigationBounds = SITE_PIVOT_BOUNDS,
  maxDistance: number = PIVOT_MAX_DISTANCE,
  minDistance = 0
): PivotClampResult {
  const offset = pivot.clone().sub(cameraPos);
  const len = offset.length();
  if (len < EPS) {
    return { pivot: pivot.clone(), changed: false, onViewRay: true };
  }
  const dir = offset.divideScalar(len);
  const interval = rayBoxInterval(cameraPos, dir, bounds);
  if (interval) {
    const lo = Math.max(interval[0], minDistance);
    const hi = Math.min(interval[1], maxDistance);
    if (lo <= hi) {
      const t = THREE.MathUtils.clamp(len, lo, hi);
      if (Math.abs(t - len) < 1e-4) {
        return { pivot: pivot.clone(), changed: false, onViewRay: true };
      }
      return {
        pivot: cameraPos.clone().addScaledVector(dir, t),
        changed: true,
        onViewRay: true,
      };
    }
  }
  // The view ray never passes through the valid region: clamp hard.
  const hard = clampPointToBounds(pivot, bounds);
  const hardOffset = hard.clone().sub(cameraPos);
  const hardLen = hardOffset.length();
  if (hardLen > maxDistance) {
    hard.copy(cameraPos).addScaledVector(hardOffset.divideScalar(hardLen), maxDistance);
  }
  return { pivot: hard, changed: hard.distanceToSquared(pivot) > 1e-8, onViewRay: false };
}

export interface FramingPose {
  readonly position: THREE.Vector3;
  readonly target: THREE.Vector3;
  /** Orthographic zoom that fits the box (only meaningful for ortho cameras). */
  readonly orthoZoom: number;
}

export interface FramingOptions {
  readonly camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  readonly currentTarget: THREE.Vector3;
  readonly elevationDeg: number;
  readonly minDistance: number;
  readonly maxDistance: number;
  readonly orthoHalfHeight: number;
  readonly minZoom: number;
  readonly maxZoom: number;
}

/**
 * Computes a camera pose that frames `bounds`, keeping the current view azimuth
 * and looking down at the requested elevation.
 */
export function computeFramingPose(bounds: NavigationBounds, opts: FramingOptions): FramingPose {
  const center = new THREE.Vector3(
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minY + bounds.maxY) / 2,
    (bounds.minZ + bounds.maxZ) / 2
  );
  const radius = Math.max(
    0.5,
    0.5 *
      Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ)
  );

  const offset = opts.camera.position.clone().sub(opts.currentTarget);
  const horizontal = Math.hypot(offset.x, offset.z);
  const theta = horizontal > EPS ? Math.atan2(offset.x, offset.z) : 0;
  const phi = THREE.MathUtils.degToRad(90 - opts.elevationDeg);

  let distance: number;
  let orthoZoom = 1;
  const cam = opts.camera;
  if (cam instanceof THREE.PerspectiveCamera) {
    const vFov = THREE.MathUtils.degToRad(cam.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * cam.aspect);
    const fitFov = Math.min(vFov, hFov);
    distance = (radius / Math.sin(fitFov / 2)) * 1.05;
  } else {
    const aspect = (cam.right - cam.left) / Math.max(EPS, cam.top - cam.bottom);
    const halfExtent = Math.min(opts.orthoHalfHeight, opts.orthoHalfHeight * aspect);
    orthoZoom = THREE.MathUtils.clamp(halfExtent / (radius * 1.1), opts.minZoom, opts.maxZoom);
    distance = Math.max(radius * 2, 12);
  }
  distance = THREE.MathUtils.clamp(distance, opts.minDistance, opts.maxDistance);

  const position = new THREE.Vector3()
    .setFromSphericalCoords(distance, phi, theta)
    .add(center);
  return { position, target: center, orthoZoom };
}
