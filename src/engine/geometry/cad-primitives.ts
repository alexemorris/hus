import * as THREE from 'three';
import type { Frame2D, Plane2D } from '../../core/geo/frame2d.ts';
import type { Vec3Tuple } from '../../core/types/scene.ts';
import type { Point2D, WallLocalFrame } from './period-house-primitives.ts';

/**
 * 2D point accepted by low-level CAD primitives: either `[u, v]` tuple or `{ x, y }` / `THREE.Vector2`.
 */
export type Point2DInput = Point2D | { readonly x: number; readonly y: number };

/**
 * 3D point accepted by low-level CAD primitives: either `[x, y, z]` tuple or `THREE.Vector3`.
 */
export type Point3DInput = Vec3Tuple | THREE.Vector3;

/**
 * Analytical 2D half-plane keeping points `(x, y)` that satisfy:
 * `nx * x + ny * y + constant >= 0`
 * (consistent with `THREE.Plane.distanceToPoint(p) >= 0` and `Plane2D` in `src/core/geo/frame2d.ts`).
 */
export interface HalfPlane2D {
  readonly nx: number;
  readonly ny: number;
  readonly constant: number;
}

/**
 * Analytical 3D half-space keeping points `p` that satisfy:
 * `normal · p + constant >= 0` (compatible with `THREE.Plane`).
 */
export interface HalfPlane3D {
  readonly normal: Point3DInput;
  readonly constant: number;
}

export interface PlanarProfile2D {
  readonly outer: readonly Point2DInput[];
  readonly holes?: readonly (readonly Point2DInput[])[];
}

export interface ClippedProfile2D {
  readonly outer: [number, number][];
  readonly holes: [number, number][][];
}

export interface ExtrudePlanarSolidOptions {
  /** Outer polygon boundary in 2D `(u, v)` coordinates. */
  readonly outer: readonly Point2DInput[];
  /** Optional interior hole boundaries in 2D `(u, v)` coordinates. */
  readonly holes?: readonly (readonly Point2DInput[])[];
  /** Extrusion thickness along `wAxis` (metres, used when `depthRange` is omitted; default `0.1`). */
  readonly depth?: number;
  /** Center extrusion `[ -depth / 2, +depth / 2 ]` when `depthRange` is omitted (default `false`). */
  readonly centered?: boolean;
  /** Explicit `[wMin, wMax]` interval along `wAxis` (metres). */
  readonly depthRange?: readonly [number, number];
  /** Optional 3D origin for `(u = 0, v = 0, w = 0)`. */
  readonly origin?: Point3DInput;
  /** Optional 3D basis vector for `+u` (default `[1, 0, 0]`). */
  readonly uAxis?: Point3DInput;
  /** Optional 3D basis vector for `+v` (default `[0, 1, 0]`). */
  readonly vAxis?: Point3DInput;
  /** Optional 3D basis vector for `+w` extrusion direction (defaults to `normalize(uAxis x vAxis)`). */
  readonly wAxis?: Point3DInput;
  /** Optional `Frame2D` basis (`'xy'` extrudes vertical `(x, y)` along local `z`; `'xz'` extrudes horizontal `(x, z)` along `+Y`). */
  readonly frame2D?: Frame2D;
  readonly framePlane?: 'xy' | 'xz';
  /** Optional `WallLocalFrame` basis (`u` along wall tangent, `v` along world `+Y`, `w` along wall normal). */
  readonly wallFrame?: WallLocalFrame;
  /** Metric UV scale (`1` = `1 UV unit per metre`). */
  readonly uvScale?: number;
}

export interface SweepMouldingOptions {
  /** Closed or open path: when `true`, connects last path point back to first with a mitered corner. */
  readonly closed?: boolean;
  /** Whether the 2D profile forms a closed loop (default `true` when `profile.length >= 3`). */
  readonly closeProfile?: boolean;
  /** Emit start/end planar caps when `closed` is `false` and the profile is closed (default `true`). */
  readonly endCaps?: boolean;
  /** World `Y` elevation used when `path` is supplied as 2D `(x, z)` points (default `0`). */
  readonly elevationY?: number;
  /** Reference up vector for frame orientation (`N = normalize(T x up)`, `B = N x T`; default `[0, 1, 0]`). */
  readonly up?: Point3DInput;
  /** Maximum miter tangent ratio `|tan(theta / 2)|` to clamp extreme acute spikes (default `4`). */
  readonly maxMiterRatio?: number;
  /** Metric UV scale (`1` = `1 UV unit per metre`). */
  readonly uvScale?: number;
}

export interface WorldBoxUvOptions {
  readonly worldMatrix?: THREE.Matrix4;
  readonly scale?: number;
  readonly offset?: readonly [number, number];
}

const DEFAULT_CLIP_EPS = 1e-7;

function toXY(p: Point2DInput): [number, number] {
  if (Array.isArray(p)) {
    return [p[0], p[1]];
  }
  return [(p as { readonly x: number }).x, (p as { readonly y: number }).y];
}

function toVec3(p: Point3DInput): THREE.Vector3 {
  if (p instanceof THREE.Vector3) {
    return p.clone();
  }
  return new THREE.Vector3(p[0], p[1], p[2]);
}

function is2DPointInput(p: Point2DInput | Point3DInput): p is Point2DInput {
  if (Array.isArray(p)) {
    return p.length === 2;
  }
  return !('z' in p);
}

/** Converts an `(X, Z)` `Plane2D` from `Frame2D` into a `HalfPlane2D`. */
export function plane2DToHalfPlane2D(plane: Plane2D): HalfPlane2D {
  return { nx: plane.nx, ny: plane.nz, constant: plane.constant };
}

/** Converts a `Frame2D` into an equivalent Three.js `Matrix4` (`Object3D` local-to-world transform). */
export function frame2DToThreeMatrix4(frame: Frame2D): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  m.set(
    frame.cos, 0, frame.sin, frame.originX,
    0, 1, 0, frame.elevationY,
    -frame.sin, 0, frame.cos, frame.originZ,
    0, 0, 0, 1
  );
  return m;
}

/** Transforms a local `(x, y, z)` point in `frame` into a world `THREE.Vector3`. */
export function transformFrame2DPoint(
  frame: Frame2D,
  x: number,
  y: number,
  z: number
): THREE.Vector3 {
  const [wx, wy, wz] = frame.toWorldTuple3(x, y, z);
  return new THREE.Vector3(wx, wy, wz);
}

/** Applies a `Frame2D` pose (`position` + `rotation.y`) onto a Three.js `Object3D`. */
export function applyFrame2DToObject3D<T extends THREE.Object3D>(obj: T, frame: Frame2D): T {
  obj.position.set(frame.originX, frame.elevationY, frame.originZ);
  obj.rotation.set(0, frame.rotationY, 0);
  return obj;
}

/** Signed 2D shoelace area (`> 0` for CCW, `< 0` for CW). */
export function computeSignedPolygonArea2D(ring: readonly Point2DInput[]): number {
  const n = ring.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = toXY(ring[i]!);
    const [x1, y1] = toXY(ring[(i + 1) % n]!);
    sum += x0 * y1 - x1 * y0;
  }
  return sum * 0.5;
}

function deduplicate2DRing(
  pts: readonly [number, number][],
  eps = DEFAULT_CLIP_EPS
): [number, number][] {
  if (pts.length === 0) return [];
  const epsSq = eps * eps;
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    if (out.length === 0) {
      out.push([p[0], p[1]]);
      continue;
    }
    const prev = out[out.length - 1]!;
    const dx = p[0] - prev[0];
    const dy = p[1] - prev[1];
    if (dx * dx + dy * dy > epsSq) {
      out.push([p[0], p[1]]);
    }
  }
  while (out.length > 1) {
    const first = out[0]!;
    const last = out[out.length - 1]!;
    const dx = first[0] - last[0];
    const dy = first[1] - last[1];
    if (dx * dx + dy * dy <= epsSq) {
      out.pop();
    } else {
      break;
    }
  }
  return out;
}

function deduplicate3DRing(
  pts: readonly THREE.Vector3[],
  eps = DEFAULT_CLIP_EPS
): THREE.Vector3[] {
  if (pts.length === 0) return [];
  const epsSq = eps * eps;
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    if (out.length === 0 || p.distanceToSquared(out[out.length - 1]!) > epsSq) {
      out.push(p.clone());
    }
  }
  while (out.length > 1 && out[0]!.distanceToSquared(out[out.length - 1]!) <= epsSq) {
    out.pop();
  }
  return out;
}

/**
 * Clips a 2D polygon against an array of analytical 2D half-planes
 * (`nx * x + ny * y + constant >= 0`), deduplicating near-coincident vertices.
 */
export function clipPolygon2DToPlanes(
  polygon: readonly Point2DInput[],
  planes: readonly HalfPlane2D[],
  eps = DEFAULT_CLIP_EPS
): [number, number][] {
  let ring = deduplicate2DRing(polygon.map(toXY), eps);
  if (ring.length < 3) return [];

  for (let pIdx = 0; pIdx < planes.length; pIdx++) {
    const plane = planes[pIdx]!;
    const nextRing: [number, number][] = [];
    const count = ring.length;
    if (count === 0) return [];

    for (let i = 0; i < count; i++) {
      const curr = ring[i]!;
      const prev = ring[(i + count - 1) % count]!;
      const dCurr = plane.nx * curr[0] + plane.ny * curr[1] + plane.constant;
      const dPrev = plane.nx * prev[0] + plane.ny * prev[1] + plane.constant;
      const currInside = dCurr >= -eps;
      const prevInside = dPrev >= -eps;

      if (currInside !== prevInside) {
        const denom = dPrev - dCurr;
        const t = Math.abs(denom) > 1e-15 ? Math.min(1, Math.max(0, dPrev / denom)) : 0.5;
        nextRing.push([
          prev[0] + (curr[0] - prev[0]) * t,
          prev[1] + (curr[1] - prev[1]) * t,
        ]);
      }
      if (currInside) {
        nextRing.push(curr);
      }
    }

    ring = deduplicate2DRing(nextRing, eps);
    if (ring.length < 3) return [];
  }

  if (Math.abs(computeSignedPolygonArea2D(ring)) <= eps * eps) {
    return [];
  }
  return ring;
}

/**
 * Clips a 3D planar polygon (or 2D polygon via overload) against analytical convex half-spaces
 * (`normal · p + constant >= 0`, matching `THREE.Plane.distanceToPoint(p) >= 0`).
 */
export function clipPolygonToPlanes(
  polygon: readonly Point2DInput[],
  planes: readonly HalfPlane2D[],
  eps?: number
): [number, number][];
export function clipPolygonToPlanes(
  polygon: readonly Point3DInput[],
  planes: readonly HalfPlane3D[],
  eps?: number
): THREE.Vector3[];
export function clipPolygonToPlanes(
  polygon: readonly (Point2DInput | Point3DInput)[],
  planes: readonly (HalfPlane2D | HalfPlane3D)[],
  eps = DEFAULT_CLIP_EPS
): [number, number][] | THREE.Vector3[] {
  const is2D =
    planes.length > 0
      ? 'nx' in planes[0]!
      : polygon.length > 0
        ? is2DPointInput(polygon[0]!)
        : false;

  if (is2D) {
    return clipPolygon2DToPlanes(
      polygon as readonly Point2DInput[],
      planes as readonly HalfPlane2D[],
      eps
    );
  }

  let ring = deduplicate3DRing((polygon as readonly Point3DInput[]).map(toVec3), eps);
  if (ring.length < 3) return [];

  const planes3D = planes as readonly HalfPlane3D[];
  for (let pIdx = 0; pIdx < planes3D.length; pIdx++) {
    const pl = planes3D[pIdx]!;
    const normal = toVec3(pl.normal);
    const constant = pl.constant;
    const nextRing: THREE.Vector3[] = [];
    const count = ring.length;
    if (count === 0) return [];

    for (let i = 0; i < count; i++) {
      const curr = ring[i]!;
      const prev = ring[(i + count - 1) % count]!;
      const dCurr = normal.dot(curr) + constant;
      const dPrev = normal.dot(prev) + constant;
      const currInside = dCurr >= -eps;
      const prevInside = dPrev >= -eps;

      if (currInside !== prevInside) {
        const denom = dPrev - dCurr;
        const t = Math.abs(denom) > 1e-15 ? Math.min(1, Math.max(0, dPrev / denom)) : 0.5;
        nextRing.push(new THREE.Vector3().lerpVectors(prev, curr, t));
      }
      if (currInside) {
        nextRing.push(curr);
      }
    }

    ring = deduplicate3DRing(nextRing, eps);
    if (ring.length < 3) return [];
  }

  // Verify non-zero 3D polygon area via Newell's normal vector
  const newell = new THREE.Vector3();
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    newell.x += (a.y - b.y) * (a.z + b.z);
    newell.y += (a.z - b.z) * (a.x + b.x);
    newell.z += (a.x - b.x) * (a.y + b.y);
  }
  if (newell.length() * 0.5 <= eps * eps) {
    return [];
  }
  return ring;
}

function isPointInOrOnPolygon2D(
  px: number,
  py: number,
  ring: readonly [number, number][],
  eps = DEFAULT_CLIP_EPS
): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const dx = xj - xi;
    const dy = yj - yi;
    const lenSq = dx * dx + dy * dy;
    if (lenSq > 0) {
      const t = Math.max(0, Math.min(1, ((px - xi) * dx + (py - yi) * dy) / lenSq));
      const projX = xi + t * dx;
      const projY = yi + t * dy;
      if ((px - projX) * (px - projX) + (py - projY) * (py - projY) <= eps * eps) {
        return true;
      }
    }
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function computePolygonCentroid2D(ring: readonly [number, number][]): [number, number] {
  let area6 = 0;
  let cx = 0;
  let cy = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = ring[i]!;
    const [x1, y1] = ring[(i + 1) % n]!;
    const cross = x0 * y1 - x1 * y0;
    area6 += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(area6) < 1e-12) {
    let sx = 0;
    let sy = 0;
    for (const [x, y] of ring) {
      sx += x;
      sy += y;
    }
    return [sx / Math.max(1, n), sy / Math.max(1, n)];
  }
  return [cx / (3 * area6), cy / (3 * area6)];
}

/**
 * Clips a 2D cross-section or wall elevation profile (outer boundary + optional holes)
 * against analytical 2D half-planes (`nx * u + ny * v + constant >= 0`).
 * Normalizes `outer` to CCW (`area > 0`) and surviving `holes` to CW (`area < 0`).
 */
export function clipProfileToPlanes(
  profile: PlanarProfile2D,
  planes: readonly HalfPlane2D[],
  eps = DEFAULT_CLIP_EPS
): ClippedProfile2D {
  const clippedOuter = clipPolygon2DToPlanes(profile.outer, planes, eps);
  if (clippedOuter.length < 3) {
    return { outer: [], holes: [] };
  }
  if (computeSignedPolygonArea2D(clippedOuter) < 0) {
    clippedOuter.reverse();
  }
  const outerArea = computeSignedPolygonArea2D(clippedOuter);

  const validHoles: [number, number][][] = [];
  if (profile.holes) {
    for (const rawHole of profile.holes) {
      const clippedHole = clipPolygon2DToPlanes(rawHole, planes, eps);
      if (clippedHole.length < 3) continue;
      if (computeSignedPolygonArea2D(clippedHole) > 0) {
        clippedHole.reverse();
      }
      const holeArea = Math.abs(computeSignedPolygonArea2D(clippedHole));
      if (holeArea <= eps * eps || holeArea >= outerArea - eps * eps) continue;
      const [cx, cy] = computePolygonCentroid2D(clippedHole);
      if (!isPointInOrOnPolygon2D(cx, cy, clippedOuter, eps)) continue;
      validHoles.push(clippedHole);
    }
  }

  return { outer: clippedOuter, holes: validHoles };
}

interface Resolved3DBasis {
  readonly origin: THREE.Vector3;
  readonly uAxis: THREE.Vector3;
  readonly vAxis: THREE.Vector3;
  readonly wAxis: THREE.Vector3;
  readonly determinant: number;
  readonly jacobianSign: 1 | -1;
}

function resolveExtrusionBasis(options: ExtrudePlanarSolidOptions): Resolved3DBasis {
  let origin: THREE.Vector3;
  let uAxis: THREE.Vector3;
  let vAxis: THREE.Vector3;
  let wAxis: THREE.Vector3;

  if (options.wallFrame) {
    const wf = options.wallFrame;
    origin = options.origin
      ? toVec3(options.origin)
      : new THREE.Vector3(wf.start[0], 0, wf.start[1]);
    uAxis = options.uAxis
      ? toVec3(options.uAxis)
      : new THREE.Vector3(wf.tangent[0], 0, wf.tangent[1]);
    vAxis = options.vAxis ? toVec3(options.vAxis) : new THREE.Vector3(0, 1, 0);
    wAxis = options.wAxis
      ? toVec3(options.wAxis)
      : new THREE.Vector3(wf.normal[0], 0, wf.normal[1]);
  } else if (options.frame2D) {
    const f = options.frame2D;
    origin = options.origin
      ? toVec3(options.origin)
      : new THREE.Vector3(f.originX, f.elevationY, f.originZ);
    if (options.framePlane === 'xz') {
      const [ux, uz] = f.vectorToWorldXZ(1, 0);
      const [vx, vz] = f.vectorToWorldXZ(0, 1);
      uAxis = options.uAxis ? toVec3(options.uAxis) : new THREE.Vector3(ux, 0, uz);
      vAxis = options.vAxis ? toVec3(options.vAxis) : new THREE.Vector3(vx, 0, vz);
      wAxis = options.wAxis ? toVec3(options.wAxis) : new THREE.Vector3(0, 1, 0);
    } else {
      const [ux, uz] = f.vectorToWorldXZ(1, 0);
      const [wx, wz] = f.vectorToWorldXZ(0, 1);
      uAxis = options.uAxis ? toVec3(options.uAxis) : new THREE.Vector3(ux, 0, uz);
      vAxis = options.vAxis ? toVec3(options.vAxis) : new THREE.Vector3(0, 1, 0);
      wAxis = options.wAxis ? toVec3(options.wAxis) : new THREE.Vector3(wx, 0, wz);
    }
  } else {
    origin = options.origin ? toVec3(options.origin) : new THREE.Vector3(0, 0, 0);
    uAxis = options.uAxis ? toVec3(options.uAxis) : new THREE.Vector3(1, 0, 0);
    vAxis = options.vAxis ? toVec3(options.vAxis) : new THREE.Vector3(0, 1, 0);
    if (options.wAxis) {
      wAxis = toVec3(options.wAxis);
    } else {
      wAxis = new THREE.Vector3().crossVectors(uAxis, vAxis).normalize();
    }
  }

  const uCrossV = new THREE.Vector3().crossVectors(uAxis, vAxis);
  const determinant = uCrossV.dot(wAxis);
  if (Math.abs(determinant) < 1e-10) {
    throw new Error(
      `extrudePlanarSolidWithHoles: degenerate 3D basis with near-zero Jacobian determinant (${determinant})`
    );
  }
  const jacobianSign: 1 | -1 = determinant > 0 ? 1 : -1;
  return { origin, uAxis, vAxis, wAxis, determinant, jacobianSign };
}

/**
 * Extrudes a 2D planar polygon with optional interior holes into a watertight indexed
 * `THREE.BufferGeometry` with sharp per-face normals and metric UVs.
 *
 * Enforces outward normal winding via:
 * - Shoelace normalization (`outer` -> CCW, `holes` -> CW)
 * - Explicit Jacobian determinant check (`det([uAxis, vAxis, wAxis])`), flipping triangle
 *   index winding `(a, b, c) -> (a, c, b)` whenever `det < 0`
 * - Direct per-triangle verification `(v1 - v0) x (v2 - v0) · outwardNormal > 0` on front,
 *   back, outer-perimeter, and inner-hole-jamb faces.
 */
export function extrudePlanarSolidWithHoles(
  options: ExtrudePlanarSolidOptions
): THREE.BufferGeometry {
  const outerRing = deduplicate2DRing(options.outer.map(toXY));
  if (outerRing.length < 3 || Math.abs(computeSignedPolygonArea2D(outerRing)) <= 1e-14) {
    return new THREE.BufferGeometry();
  }
  if (computeSignedPolygonArea2D(outerRing) < 0) {
    outerRing.reverse();
  }

  const holeRings: [number, number][][] = [];
  if (options.holes) {
    for (const h of options.holes) {
      const cleanHole = deduplicate2DRing(h.map(toXY));
      if (cleanHole.length < 3 || Math.abs(computeSignedPolygonArea2D(cleanHole)) <= 1e-14) {
        continue;
      }
      if (computeSignedPolygonArea2D(cleanHole) > 0) {
        cleanHole.reverse();
      }
      holeRings.push(cleanHole);
    }
  }

  let wMin: number;
  let wMax: number;
  if (options.depthRange) {
    wMin = Math.min(options.depthRange[0], options.depthRange[1]);
    wMax = Math.max(options.depthRange[0], options.depthRange[1]);
  } else {
    const depth = options.depth ?? 0.1;
    if (options.centered) {
      const half = Math.abs(depth) * 0.5;
      wMin = -half;
      wMax = half;
    } else if (depth >= 0) {
      wMin = 0;
      wMax = depth;
    } else {
      wMin = depth;
      wMax = 0;
    }
  }
  if (wMax - wMin <= 1e-9) {
    return new THREE.BufferGeometry();
  }

  const basis = resolveExtrusionBasis(options);
  const uvScale = options.uvScale ?? 1;
  const uMetricScale = basis.uAxis.length() * uvScale;
  const vMetricScale = basis.vAxis.length() * uvScale;
  const wMetricScale = basis.wAxis.length() * uvScale;

  const mapPoint = (u: number, v: number, w: number): THREE.Vector3 =>
    new THREE.Vector3(
      basis.origin.x + u * basis.uAxis.x + v * basis.vAxis.x + w * basis.wAxis.x,
      basis.origin.y + u * basis.uAxis.y + v * basis.vAxis.y + w * basis.wAxis.y,
      basis.origin.z + u * basis.uAxis.z + v * basis.vAxis.z + w * basis.wAxis.z
    );

  // Clone Vector2 arrays because THREE.ShapeUtils.triangulateShape may reverse inputs in-place.
  const contourVec2 = outerRing.map(([u, v]) => new THREE.Vector2(u, v));
  const holesVec2 = holeRings.map((ring) => ring.map(([u, v]) => new THREE.Vector2(u, v)));
  const capTriangles = THREE.ShapeUtils.triangulateShape(contourVec2, holesVec2);

  const all2DPoints: [number, number][] = [
    ...contourVec2.map((p): [number, number] => [p.x, p.y]),
    ...holesVec2.flatMap((h) => h.map((p): [number, number] => [p.x, p.y])),
  ];

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const tmpEdge1 = new THREE.Vector3();
  const tmpEdge2 = new THREE.Vector3();
  const tmpCross = new THREE.Vector3();

  const emitOrientedTriangle = (
    i0: number,
    i1: number,
    i2: number,
    outwardNormal: THREE.Vector3
  ): void => {
    const p0x = positions[i0 * 3]!;
    const p0y = positions[i0 * 3 + 1]!;
    const p0z = positions[i0 * 3 + 2]!;
    tmpEdge1.set(
      positions[i1 * 3]! - p0x,
      positions[i1 * 3 + 1]! - p0y,
      positions[i1 * 3 + 2]! - p0z
    );
    tmpEdge2.set(
      positions[i2 * 3]! - p0x,
      positions[i2 * 3 + 1]! - p0y,
      positions[i2 * 3 + 2]! - p0z
    );
    tmpCross.crossVectors(tmpEdge1, tmpEdge2);
    if (tmpCross.dot(outwardNormal) >= 0) {
      indices.push(i0, i1, i2);
    } else {
      indices.push(i0, i2, i1);
    }
  };

  // Front cap (w = wMax, outward normal = jacobianSign * normalize(uAxis x vAxis))
  const frontNormal = new THREE.Vector3()
    .crossVectors(basis.uAxis, basis.vAxis)
    .multiplyScalar(basis.jacobianSign)
    .normalize();
  const frontBase = positions.length / 3;
  for (const [u, v] of all2DPoints) {
    const p = mapPoint(u, v, wMax);
    positions.push(p.x, p.y, p.z);
    normals.push(frontNormal.x, frontNormal.y, frontNormal.z);
    uvs.push(u * uMetricScale, v * vMetricScale);
  }
  for (const tri of capTriangles) {
    const a = frontBase + tri[0]!;
    const b = frontBase + tri[1]!;
    const c = frontBase + tri[2]!;
    if (basis.jacobianSign > 0) {
      emitOrientedTriangle(a, b, c, frontNormal);
    } else {
      emitOrientedTriangle(a, c, b, frontNormal);
    }
  }

  // Back cap (w = wMin, outward normal = -frontNormal)
  const backNormal = frontNormal.clone().negate();
  const backBase = positions.length / 3;
  for (const [u, v] of all2DPoints) {
    const p = mapPoint(u, v, wMin);
    positions.push(p.x, p.y, p.z);
    normals.push(backNormal.x, backNormal.y, backNormal.z);
    uvs.push(-u * uMetricScale, v * vMetricScale);
  }
  for (const tri of capTriangles) {
    const a = backBase + tri[0]!;
    const b = backBase + tri[1]!;
    const c = backBase + tri[2]!;
    if (basis.jacobianSign > 0) {
      emitOrientedTriangle(a, c, b, backNormal);
    } else {
      emitOrientedTriangle(a, b, c, backNormal);
    }
  }

  // Outer perimeter & inner hole jambs (each ring edge emits a crisp 4-vertex quad)
  const emitRingSideFaces = (ring: readonly [number, number][]): void => {
    let arcLen = 0;
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const [u0, v0] = ring[i]!;
      const [u1, v1] = ring[(i + 1) % n]!;
      const du = u1 - u0;
      const dv = v1 - v0;
      const edge3D = new THREE.Vector3()
        .addScaledVector(basis.uAxis, du)
        .addScaledVector(basis.vAxis, dv);
      const segLen = edge3D.length();
      if (segLen <= 1e-10) continue;

      // Exact outward normal: jacobianSign * normalize(edge3D x wAxis)
      const sideNormal = new THREE.Vector3()
        .crossVectors(edge3D, basis.wAxis)
        .multiplyScalar(basis.jacobianSign)
        .normalize();

      const p0Back = mapPoint(u0, v0, wMin);
      const p1Back = mapPoint(u1, v1, wMin);
      const p1Front = mapPoint(u1, v1, wMax);
      const p0Front = mapPoint(u0, v0, wMax);

      const base = positions.length / 3;
      positions.push(
        p0Back.x, p0Back.y, p0Back.z,
        p1Back.x, p1Back.y, p1Back.z,
        p1Front.x, p1Front.y, p1Front.z,
        p0Front.x, p0Front.y, p0Front.z
      );
      for (let k = 0; k < 4; k++) {
        normals.push(sideNormal.x, sideNormal.y, sideNormal.z);
      }

      const s0 = arcLen * uvScale;
      const s1 = (arcLen + segLen) * uvScale;
      const t0 = wMin * wMetricScale;
      const t1 = wMax * wMetricScale;
      uvs.push(s0, t0, s1, t0, s1, t1, s0, t1);
      arcLen += segLen;

      if (basis.jacobianSign > 0) {
        emitOrientedTriangle(base, base + 2, base + 1, sideNormal);
        emitOrientedTriangle(base, base + 3, base + 2, sideNormal);
      } else {
        emitOrientedTriangle(base, base + 1, base + 2, sideNormal);
        emitOrientedTriangle(base, base + 2, base + 3, sideNormal);
      }
    }
  };

  emitRingSideFaces(outerRing);
  for (const hole of holeRings) {
    emitRingSideFaces(hole);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

interface PathSegmentFrame {
  readonly p0: THREE.Vector3;
  readonly p1: THREE.Vector3;
  readonly length: number;
  readonly tangent: THREE.Vector3;
  readonly normal: THREE.Vector3;
  readonly binormal: THREE.Vector3;
  readonly cumulativeDist: number;
}

function transportVector(
  vec: THREE.Vector3,
  fromTangent: THREE.Vector3,
  toTangent: THREE.Vector3
): THREE.Vector3 {
  const axis = new THREE.Vector3().crossVectors(fromTangent, toTangent);
  const sinAngle = axis.length();
  const cosAngle = Math.max(-1, Math.min(1, fromTangent.dot(toTangent)));
  if (sinAngle < 1e-8) {
    if (cosAngle > 0) return vec.clone();
    // 180-degree reversal: reflect across plane orthogonal tovec/tangent
    const fallbackAxis =
      Math.abs(fromTangent.y) < 0.9
        ? new THREE.Vector3(0, 1, 0).cross(fromTangent).normalize()
        : new THREE.Vector3(1, 0, 0).cross(fromTangent).normalize();
    return vec.clone().applyAxisAngle(fallbackAxis, Math.PI);
  }
  axis.divideScalar(sinAngle);
  const angle = Math.atan2(sinAngle, cosAngle);
  return vec.clone().applyAxisAngle(axis, angle);
}

function buildPathSegmentFrames(
  points: readonly THREE.Vector3[],
  closed: boolean,
  referenceUp: THREE.Vector3
): PathSegmentFrame[] {
  const segCount = closed ? points.length : points.length - 1;
  if (segCount < 1) return [];

  const tangents: THREE.Vector3[] = [];
  const p0s: THREE.Vector3[] = [];
  const p1s: THREE.Vector3[] = [];
  const lengths: number[] = [];

  for (let i = 0; i < segCount; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const delta = new THREE.Vector3().subVectors(b, a);
    const len = delta.length();
    if (len <= 1e-8) continue;
    p0s.push(a);
    p1s.push(b);
    lengths.push(len);
    tangents.push(delta.divideScalar(len));
  }
  if (tangents.length === 0) return [];

  const up = referenceUp.clone().normalize();
  const canUseConsistentUp = tangents.every((t) => Math.abs(t.dot(up)) < 0.995);

  const frames: PathSegmentFrame[] = [];
  let cumDist = 0;

  if (canUseConsistentUp) {
    for (let i = 0; i < tangents.length; i++) {
      const tangent = tangents[i]!;
      const normal = new THREE.Vector3().crossVectors(tangent, up).normalize();
      const binormal = new THREE.Vector3().crossVectors(normal, tangent).normalize();
      frames.push({
        p0: p0s[i]!,
        p1: p1s[i]!,
        length: lengths[i]!,
        tangent,
        normal,
        binormal,
        cumulativeDist: cumDist,
      });
      cumDist += lengths[i]!;
    }
    return frames;
  }

  // Rotation-minimizing parallel transport when any segment aligns with `up`.
  const t0 = tangents[0]!;
  let seedUp = up;
  if (Math.abs(t0.dot(seedUp)) >= 0.995) {
    let planeNormal: THREE.Vector3 | null = null;
    for (let i = 1; i < tangents.length; i++) {
      const c = new THREE.Vector3().crossVectors(tangents[i]!, t0);
      if (c.lengthSq() > 1e-6) {
        planeNormal = c.normalize();
        break;
      }
    }
    seedUp =
      planeNormal ??
      (Math.abs(t0.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0));
  }

  let prevNormal = new THREE.Vector3().crossVectors(t0, seedUp).normalize();
  let prevBinormal = new THREE.Vector3().crossVectors(prevNormal, t0).normalize();

  for (let i = 0; i < tangents.length; i++) {
    const tangent = tangents[i]!;
    if (i > 0) {
      prevNormal = transportVector(prevNormal, tangents[i - 1]!, tangent);
      prevNormal.addScaledVector(tangent, -prevNormal.dot(tangent)).normalize();
      prevBinormal = new THREE.Vector3().crossVectors(prevNormal, tangent).normalize();
    }
    frames.push({
      p0: p0s[i]!,
      p1: p1s[i]!,
      length: lengths[i]!,
      tangent,
      normal: prevNormal.clone(),
      binormal: prevBinormal.clone(),
      cumulativeDist: cumDist,
    });
    cumDist += lengths[i]!;
  }

  return frames;
}

function evaluateMiterPoint(
  corner: THREE.Vector3,
  frame: PathSegmentFrame,
  miterNormal: THREE.Vector3,
  px: number,
  py: number,
  maxMiterRatio: number
): { readonly point: THREE.Vector3; readonly shift: number } {
  const offset = new THREE.Vector3()
    .addScaledVector(frame.normal, px)
    .addScaledVector(frame.binormal, py);
  const denom = frame.tangent.dot(miterNormal);
  let shift = 0;
  if (Math.abs(denom) > 1e-4) {
    const rawShift = -offset.dot(miterNormal) / denom;
    const radial = Math.hypot(px, py);
    const maxShift = radial * maxMiterRatio;
    shift = Math.max(-maxShift, Math.min(maxShift, rawShift));
  }
  const point = corner
    .clone()
    .add(offset)
    .addScaledVector(frame.tangent, shift);
  return { point, shift };
}

/**
 * Sweeps a 2D moulding cross-section (`profile` in `(normalOffset, upOffset)` metres)
 * along an open or closed 2D (`[x, z]` at `elevationY`) or 3D polyline with exact
 * bisector miter planes at corners, twist-free frames, optional endcaps, outward-facing
 * normals, and metric UVs (`u` = distance along path in metres, `v` = arc-length along profile in metres).
 */
export function sweepMouldingAlongPath(
  profile: readonly Point2DInput[],
  path: readonly (Point2DInput | Point3DInput)[],
  options: SweepMouldingOptions = {}
): THREE.BufferGeometry {
  if (profile.length < 2 || path.length < 2) {
    return new THREE.BufferGeometry();
  }

  const closedPath = options.closed ?? false;
  const elevationY = options.elevationY ?? 0;
  const maxMiterRatio = options.maxMiterRatio ?? 4;
  const uvScale = options.uvScale ?? 1;
  const referenceUp = options.up ? toVec3(options.up) : new THREE.Vector3(0, 1, 0);

  const raw3DPath = path.map((pt) => {
    if (is2DPointInput(pt)) {
      const [x, z] = toXY(pt);
      return new THREE.Vector3(x, elevationY, z);
    }
    return toVec3(pt);
  });

  // Deduplicate consecutive near-identical path vertices
  const cleanPath: THREE.Vector3[] = [];
  for (const pt of raw3DPath) {
    if (cleanPath.length === 0 || pt.distanceToSquared(cleanPath[cleanPath.length - 1]!) > 1e-12) {
      cleanPath.push(pt);
    }
  }
  if (
    closedPath &&
    cleanPath.length > 1 &&
    cleanPath[0]!.distanceToSquared(cleanPath[cleanPath.length - 1]!) <= 1e-12
  ) {
    cleanPath.pop();
  }
  if ((closedPath && cleanPath.length < 3) || (!closedPath && cleanPath.length < 2)) {
    return new THREE.BufferGeometry();
  }

  const closeProfile = options.closeProfile ?? profile.length >= 3;
  let cleanProfile = closeProfile
    ? deduplicate2DRing(profile.map(toXY))
    : profile.map(toXY);
  if (cleanProfile.length < 2 || (closeProfile && cleanProfile.length < 3)) {
    return new THREE.BufferGeometry();
  }
  if (closeProfile && computeSignedPolygonArea2D(cleanProfile) < 0) {
    cleanProfile = [...cleanProfile].reverse();
  }

  const frames = buildPathSegmentFrames(cleanPath, closedPath, referenceUp);
  if (frames.length === 0) {
    return new THREE.BufferGeometry();
  }

  // Cumulative profile arc-lengths (metres)
  const profileEdgeCount = closeProfile ? cleanProfile.length : cleanProfile.length - 1;
  const profileArc: number[] = [0];
  for (let j = 0; j < profileEdgeCount; j++) {
    const [x0, y0] = cleanProfile[j]!;
    const [x1, y1] = cleanProfile[(j + 1) % cleanProfile.length]!;
    profileArc.push(profileArc[j]! + Math.hypot(x1 - x0, y1 - y0));
  }

  // Evaluate start and end mitered profile rings for every segment
  const segStartRings: THREE.Vector3[][] = [];
  const segEndRings: THREE.Vector3[][] = [];
  const segStartShifts: number[][] = [];
  const segEndShifts: number[][] = [];

  for (let i = 0; i < frames.length; i++) {
    const curr = frames[i]!;
    const prev = closedPath
      ? frames[(i + frames.length - 1) % frames.length]!
      : i > 0
        ? frames[i - 1]
        : undefined;
    const next = closedPath
      ? frames[(i + 1) % frames.length]!
      : i + 1 < frames.length
        ? frames[i + 1]
        : undefined;

    const startRing: THREE.Vector3[] = [];
    const startShift: number[] = [];
    const startMiter = prev
      ? new THREE.Vector3().addVectors(prev.tangent, curr.tangent)
      : curr.tangent.clone();

    for (const [px, py] of cleanProfile) {
      if (!prev) {
        startRing.push(
          curr.p0
            .clone()
            .addScaledVector(curr.normal, px)
            .addScaledVector(curr.binormal, py)
        );
        startShift.push(0);
      } else {
        const a = evaluateMiterPoint(curr.p0, prev, startMiter, px, py, maxMiterRatio);
        const b = evaluateMiterPoint(curr.p0, curr, startMiter, px, py, maxMiterRatio);
        startRing.push(new THREE.Vector3().addVectors(a.point, b.point).multiplyScalar(0.5));
        startShift.push(b.shift);
      }
    }

    const endRing: THREE.Vector3[] = [];
    const endShift: number[] = [];
    const endMiter = next
      ? new THREE.Vector3().addVectors(curr.tangent, next.tangent)
      : curr.tangent.clone();

    for (const [px, py] of cleanProfile) {
      if (!next) {
        endRing.push(
          curr.p1
            .clone()
            .addScaledVector(curr.normal, px)
            .addScaledVector(curr.binormal, py)
        );
        endShift.push(0);
      } else {
        const a = evaluateMiterPoint(curr.p1, curr, endMiter, px, py, maxMiterRatio);
        const b = evaluateMiterPoint(curr.p1, next, endMiter, px, py, maxMiterRatio);
        endRing.push(new THREE.Vector3().addVectors(a.point, b.point).multiplyScalar(0.5));
        endShift.push(a.shift);
      }
    }

    segStartRings.push(startRing);
    segEndRings.push(endRing);
    segStartShifts.push(startShift);
    segEndShifts.push(endShift);
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const tmpE1 = new THREE.Vector3();
  const tmpE2 = new THREE.Vector3();
  const tmpTriN = new THREE.Vector3();

  const emitOrientedTri = (
    i0: number,
    i1: number,
    i2: number,
    expectedOutward: THREE.Vector3
  ): void => {
    const p0x = positions[i0 * 3]!;
    const p0y = positions[i0 * 3 + 1]!;
    const p0z = positions[i0 * 3 + 2]!;
    tmpE1.set(
      positions[i1 * 3]! - p0x,
      positions[i1 * 3 + 1]! - p0y,
      positions[i1 * 3 + 2]! - p0z
    );
    tmpE2.set(
      positions[i2 * 3]! - p0x,
      positions[i2 * 3 + 1]! - p0y,
      positions[i2 * 3 + 2]! - p0z
    );
    tmpTriN.crossVectors(tmpE1, tmpE2);
    if (tmpTriN.dot(expectedOutward) >= 0) {
      indices.push(i0, i1, i2);
    } else {
      indices.push(i0, i2, i1);
    }
  };

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!;
    const sRing = segStartRings[i]!;
    const eRing = segEndRings[i]!;
    const sShifts = segStartShifts[i]!;
    const eShifts = segEndShifts[i]!;

    for (let j = 0; j < profileEdgeCount; j++) {
      const jNext = (j + 1) % cleanProfile.length;
      const [px0, py0] = cleanProfile[j]!;
      const [px1, py1] = cleanProfile[jNext]!;
      const dpx = px1 - px0;
      const dpy = py1 - py0;
      if (dpx * dpx + dpy * dpy <= 1e-16) continue;

      // For a CCW profile in (normal, binormal), 2D outward vector is (dpy, -dpx)
      const faceNormal = new THREE.Vector3()
        .addScaledVector(frame.normal, dpy)
        .addScaledVector(frame.binormal, -dpx)
        .normalize();

      const a0 = sRing[j]!;
      const a1 = sRing[jNext]!;
      const b1 = eRing[jNext]!;
      const b0 = eRing[j]!;

      const base = positions.length / 3;
      positions.push(
        a0.x, a0.y, a0.z,
        b0.x, b0.y, b0.z,
        b1.x, b1.y, b1.z,
        a1.x, a1.y, a1.z
      );
      for (let k = 0; k < 4; k++) {
        normals.push(faceNormal.x, faceNormal.y, faceNormal.z);
      }

      const uA0 = (frame.cumulativeDist + sShifts[j]!) * uvScale;
      const uB0 = (frame.cumulativeDist + frame.length + eShifts[j]!) * uvScale;
      const uB1 = (frame.cumulativeDist + frame.length + eShifts[jNext]!) * uvScale;
      const uA1 = (frame.cumulativeDist + sShifts[jNext]!) * uvScale;
      const v0 = profileArc[j]! * uvScale;
      const v1 = profileArc[j + 1]! * uvScale;
      uvs.push(uA0, v0, uB0, v0, uB1, v1, uA1, v1);

      emitOrientedTri(base, base + 1, base + 2, faceNormal);
      emitOrientedTri(base, base + 2, base + 3, faceNormal);
    }
  }

  // Optional start and end caps for open paths with closed profiles
  const includeEndCaps = !closedPath && closeProfile && (options.endCaps ?? true);
  if (includeEndCaps && cleanProfile.length >= 3) {
    const capContour = cleanProfile.map(([px, py]) => new THREE.Vector2(px, py));
    const capTris = THREE.ShapeUtils.triangulateShape(capContour, []);
    // Map capContour indices back if ShapeUtils reversed capContour
    const contourReversed =
      capContour.length === cleanProfile.length &&
      (Math.abs(capContour[0]!.x - cleanProfile[0]![0]) > 1e-9 ||
        Math.abs(capContour[0]!.y - cleanProfile[0]![1]) > 1e-9);
    const mapProfileIdx = (k: number): number =>
      contourReversed ? cleanProfile.length - 1 - k : k;

    const firstFrame = frames[0]!;
    const startCapNormal = firstFrame.tangent.clone().negate();
    const startRing = segStartRings[0]!;
    const startBase = positions.length / 3;
    for (let j = 0; j < cleanProfile.length; j++) {
      const p = startRing[j]!;
      const [px, py] = cleanProfile[j]!;
      positions.push(p.x, p.y, p.z);
      normals.push(startCapNormal.x, startCapNormal.y, startCapNormal.z);
      uvs.push(-px * uvScale, py * uvScale);
    }
    for (const tri of capTris) {
      emitOrientedTri(
        startBase + mapProfileIdx(tri[0]!),
        startBase + mapProfileIdx(tri[1]!),
        startBase + mapProfileIdx(tri[2]!),
        startCapNormal
      );
    }

    const lastIdx = frames.length - 1;
    const lastFrame = frames[lastIdx]!;
    const endCapNormal = lastFrame.tangent.clone();
    const endRing = segEndRings[lastIdx]!;
    const endBase = positions.length / 3;
    for (let j = 0; j < cleanProfile.length; j++) {
      const p = endRing[j]!;
      const [px, py] = cleanProfile[j]!;
      positions.push(p.x, p.y, p.z);
      normals.push(endCapNormal.x, endCapNormal.y, endCapNormal.z);
      uvs.push(px * uvScale, py * uvScale);
    }
    for (const tri of capTris) {
      emitOrientedTri(
        endBase + mapProfileIdx(tri[0]!),
        endBase + mapProfileIdx(tri[1]!),
        endBase + mapProfileIdx(tri[2]!),
        endCapNormal
      );
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

type DominantAxis = 0 | 1 | 2;

function dominantAxisOf(nx: number, ny: number, nz: number): DominantAxis {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  if (ax >= ay && ax >= az) return 0;
  if (ay >= ax && ay >= az) return 1;
  return 2;
}

function projectPointOnAxis(
  axis: DominantAxis,
  wx: number,
  wy: number,
  wz: number,
  scale: number,
  offsetU: number,
  offsetV: number
): [number, number] {
  if (axis === 0) {
    return [wz * scale + offsetU, wy * scale + offsetV];
  }
  if (axis === 1) {
    return [wx * scale + offsetU, wz * scale + offsetV];
  }
  return [wx * scale + offsetU, wy * scale + offsetV];
}

/**
 * Applies `1 unit = 1 m` metric world-space box/triplanar UV projection onto `geometry`.
 *
 * Accepts either `(geometry, worldMatrix?, scale?, offset?)` or `(geometry, options)`.
 * Picks the dominant world normal axis (`|nx|`, `|ny|`, `|nz|`) per triangle/vertex and
 * projects world `(x, y, z)` metres onto `(u, v)` without stretching.
 */
export function projectWorldBoxUVs<T extends THREE.BufferGeometry>(
  geometry: T,
  worldMatrixOrOptions?: THREE.Matrix4 | WorldBoxUvOptions,
  scaleArg = 1,
  offsetArg?: readonly [number, number]
): T {
  const posAttr = geometry.getAttribute('position');
  if (!posAttr || posAttr.count === 0) {
    return geometry;
  }

  let worldMatrix: THREE.Matrix4 | undefined;
  let scale = scaleArg;
  let offset: readonly [number, number] = offsetArg ?? [0, 0];

  if (worldMatrixOrOptions instanceof THREE.Matrix4) {
    worldMatrix = worldMatrixOrOptions;
  } else if (worldMatrixOrOptions !== undefined) {
    worldMatrix = worldMatrixOrOptions.worldMatrix;
    scale = worldMatrixOrOptions.scale ?? 1;
    offset = worldMatrixOrOptions.offset ?? [0, 0];
  }

  const offsetU = offset[0];
  const offsetV = offset[1];
  const count = posAttr.count;

  const worldPositions = new Float64Array(count * 3);
  const tmpP = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    tmpP.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
    if (worldMatrix) {
      tmpP.applyMatrix4(worldMatrix);
    }
    worldPositions[i * 3] = tmpP.x;
    worldPositions[i * 3 + 1] = tmpP.y;
    worldPositions[i * 3 + 2] = tmpP.z;
  }

  const normalMatrix = worldMatrix ? new THREE.Matrix3().getNormalMatrix(worldMatrix) : null;
  const normAttr = geometry.getAttribute('normal');
  const indexAttr = geometry.getIndex();

  // Determine dominant world axis per vertex (-1 = unset, -2 = mixed across shared vertex)
  const vertexAxis = new Int8Array(count).fill(-1);
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const fn = new THREE.Vector3();

  const triCount = indexAttr ? Math.floor(indexAttr.count / 3) : Math.floor(count / 3);
  for (let t = 0; t < triCount; t++) {
    const i0 = indexAttr ? indexAttr.getX(t * 3) : t * 3;
    const i1 = indexAttr ? indexAttr.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = indexAttr ? indexAttr.getX(t * 3 + 2) : t * 3 + 2;

    const p0x = worldPositions[i0 * 3]!;
    const p0y = worldPositions[i0 * 3 + 1]!;
    const p0z = worldPositions[i0 * 3 + 2]!;
    e1.set(
      worldPositions[i1 * 3]! - p0x,
      worldPositions[i1 * 3 + 1]! - p0y,
      worldPositions[i1 * 3 + 2]! - p0z
    );
    e2.set(
      worldPositions[i2 * 3]! - p0x,
      worldPositions[i2 * 3 + 1]! - p0y,
      worldPositions[i2 * 3 + 2]! - p0z
    );
    fn.crossVectors(e1, e2);
    if (fn.lengthSq() <= 1e-20) continue;

    const axis = dominantAxisOf(fn.x, fn.y, fn.z);
    for (const idx of [i0, i1, i2]) {
      const prev = vertexAxis[idx]!;
      if (prev === -1) {
        vertexAxis[idx] = axis;
      } else if (prev !== axis) {
        vertexAxis[idx] = -2;
      }
    }
  }

  let uvAttr = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!uvAttr || uvAttr.count !== count || uvAttr.itemSize !== 2) {
    uvAttr = new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2);
    geometry.setAttribute('uv', uvAttr);
  }

  const tmpN = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    let axis: DominantAxis;
    const recorded = vertexAxis[i]!;
    if (recorded === 0 || recorded === 1 || recorded === 2) {
      axis = recorded;
    } else if (normAttr) {
      tmpN.set(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i));
      if (normalMatrix) {
        tmpN.applyMatrix3(normalMatrix);
      }
      axis = dominantAxisOf(tmpN.x, tmpN.y, tmpN.z);
    } else {
      axis = 1;
    }

    const wx = worldPositions[i * 3]!;
    const wy = worldPositions[i * 3 + 1]!;
    const wz = worldPositions[i * 3 + 2]!;
    const [u, v] = projectPointOnAxis(axis, wx, wy, wz, scale, offsetU, offsetV);
    uvAttr.setXY(i, u, v);
  }

  uvAttr.needsUpdate = true;
  return geometry;
}
