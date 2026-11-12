import * as THREE from 'three';
import type { CutawayWallDescriptor } from '../../core/types/scene.ts';
import {
  clipPolygonToPlanes,
  clipProfileToPlanes,
  computeSignedPolygonArea2D,
  extrudePlanarSolidWithHoles,
  type HalfPlane2D,
  type HalfPlane3D,
  type Point2DInput,
  projectWorldBoxUVs,
} from '../../engine/geometry/cad-primitives.ts';
import {
  type InteractionTarget,
  tagCollisionRole,
  tagCutaway,
} from '../../engine/geometry/mesh-traits.ts';
import type { Point2D } from '../../engine/geometry/period-house-primitives.ts';
import type { SkirtingGap } from './skirting-run.ts';
import {
  createWallFaceFrame,
  placeOnWall,
  type WallFaceFrame,
  type WallFaceSide,
  type WallMountOptions,
} from './wall-mounting.ts';
import {
  type BuiltWallOpening,
  type OpeningHostWallInfo,
  type PopulateOpeningsNetworkHost,
  populateWallOpenings,
  resolveOpeningCenterAlongM,
  type ResolvedWallApertureRequest,
  type WallOpeningSpec,
} from './wall-openings.ts';

export type WallAlignment = 'interior' | 'center' | 'exterior';
export type WallSegmentKind = 'exterior' | 'partition';
export type CardinalSide = 'north' | 'south' | 'east' | 'west';

export interface WallNetworkOpening {
  readonly id?: string;
  readonly centerOffset: number;
  readonly width: number;
  readonly sillY: number;
  readonly height: number;
  readonly archRiseM?: number;
  readonly suppressRawReveals?: boolean;
}

export interface WallNetworkSegmentInput {
  readonly id: string;
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
  readonly thickness: number;
  readonly align?: WallAlignment;
  readonly kind?: WallSegmentKind;
  readonly outwardSide?: CardinalSide;
  readonly baseY?: number;
  readonly height?: number;
  readonly openings?: readonly (WallNetworkOpening | WallOpeningSpec)[];
  readonly roofClipPlanes?: readonly HalfPlane3D[];
  readonly exteriorMaterial?: THREE.Material;
  readonly interiorMaterial?: THREE.Material;
  readonly revealMaterial?: THREE.Material;
  readonly zone?: string;
  readonly splitAtPartitions?: boolean;
  readonly includeInFirstFloorCutaway?: boolean;
}

export interface CreateWallNetworkOptions {
  readonly floor: string;
  readonly baseY?: number;
  readonly height?: number;
  readonly interStoreyClearanceM?: number;
  readonly walls: readonly WallNetworkSegmentInput[];
  /** Optional network-level unified openings (`wallId`, `offsetM` / `centerAlongM`, `kind`, etc.). */
  readonly openings?: readonly WallOpeningSpec[];
  /** Optional interaction registry / context for interactive doors & Georgian sash windows. */
  readonly ctx?: InteractionTarget | null;
  readonly interactions?: InteractionTarget | null;
  readonly exteriorMaterial?: THREE.Material;
  readonly interiorMaterial?: THREE.Material;
  readonly revealMaterial?: THREE.Material;
  readonly roofClipPlanes?: readonly HalfPlane3D[];
  readonly name?: string;
}

export interface BuiltWallSegment {
  readonly id: string;
  readonly kind: WallSegmentKind;
  readonly from: Point2D;
  readonly to: Point2D;
  readonly lengthM: number;
  readonly thickness: number;
  readonly baseY: number;
  readonly height: number;
  readonly outwardNormalXZ: Point2D;
  readonly outwardSide?: CardinalSide;
  readonly cutaways: readonly CutawayWallDescriptor[];
  getFace(side?: WallFaceSide, alongM?: number): WallFaceFrame;
  mount<T extends THREE.Object3D>(target: T, options?: WallMountOptions): T;
}

export interface WallNetworkResult {
  readonly group: THREE.Group;
  readonly cutaways: readonly CutawayWallDescriptor[];
  readonly cutawaysByWallId: ReadonlyMap<string, readonly CutawayWallDescriptor[]>;
  getWallCutaway(wallId: string, alongOffsetM?: number): CutawayWallDescriptor | undefined;
  readonly interiorPolygonXZ: readonly [number, number][];
}

export interface BuiltWallNetwork extends WallNetworkResult, PopulateOpeningsNetworkHost {
  readonly segments: readonly BuiltWallSegment[];
  readonly segmentsById: ReadonlyMap<string, BuiltWallSegment>;
  getSegment(wallId: string): BuiltWallSegment | undefined;
  mount<T extends THREE.Object3D>(wallId: string, target: T, options?: WallMountOptions): T;
  readonly openings: readonly BuiltWallOpening[];
  readonly skirtingGaps: readonly SkirtingGap[];
  readonly dadoGaps: readonly SkirtingGap[];
}

export interface CreateFloorSlabOptions {
  readonly polygon?: readonly Point2DInput[];
  readonly wallNetwork?: WallNetworkResult;
  readonly insetM?: number;
  readonly voids?: readonly (readonly Point2DInput[])[];
  readonly elevationY: number;
  readonly thickness?: number;
  readonly finishThickness?: number;
  readonly ceilingThickness?: number;
  readonly floorMaterial: THREE.Material;
  readonly deckMaterial?: THREE.Material;
  readonly ceilingMaterial?: THREE.Material;
  readonly floor?: { readonly slabGroup: THREE.Group };
  readonly lowerFloor?: { readonly ceilingGroup: THREE.Group };
  readonly zone?: string;
  readonly name?: string;
}

export interface FloorSlabResult {
  readonly slabGroup: THREE.Group;
  readonly ceilingMesh: THREE.Mesh | null;
  readonly finishMesh: THREE.Mesh;
  readonly deckMesh?: THREE.Mesh;
  readonly bounds: THREE.Box3;
}

export interface RoofFootprintBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface RoofFootprintDimensions {
  readonly width: number;
  readonly depth: number;
  readonly centerXZ?: readonly [number, number];
}

export interface BaseRoofBuildOptions {
  readonly minX?: number;
  readonly maxX?: number;
  readonly minZ?: number;
  readonly maxZ?: number;
  readonly width?: number;
  readonly depth?: number;
  readonly centerXZ?: readonly [number, number];
  readonly footprint?: RoofFootprintBounds | RoofFootprintDimensions;
  readonly eavesY: number;
  readonly pitchDeg?: number;
  readonly ridgeY?: number;
  readonly ridgeAxis?: 'x' | 'z';
  readonly overhangM?: number;
  readonly thickness?: number;
  readonly liningThickness?: number;
  readonly outerMaterial: THREE.Material;
  readonly innerMaterial?: THREE.Material;
  readonly fasciaMaterial?: THREE.Material;
  readonly ridgeCapMaterial?: THREE.Material;
  readonly name?: string;
}

export type CreatePitchedRoofOptions = BaseRoofBuildOptions;
export type CreateHippedRoofOptions = BaseRoofBuildOptions;

export interface RoofBuildResult {
  readonly group: THREE.Group;
  readonly ridgeY: number;
  readonly soffitClipPlanes: readonly HalfPlane3D[];
}

const NODE_SNAP_EPS = 1e-4;
const LAYER_CLEARANCE_M = 0.0005;
const MAX_MITER_RATIO = 4.0;

let fallbackExteriorMat: THREE.MeshStandardMaterial | null = null;
let fallbackInteriorMat: THREE.MeshStandardMaterial | null = null;
let fallbackRevealMat: THREE.MeshStandardMaterial | null = null;
let fallbackCeilingMat: THREE.MeshStandardMaterial | null = null;

function getDefaultExteriorMaterial(): THREE.Material {
  if (!fallbackExteriorMat) {
    fallbackExteriorMat = new THREE.MeshStandardMaterial({
      color: 0xa45a44,
      roughness: 0.88,
    });
  }
  return fallbackExteriorMat;
}

function getDefaultInteriorMaterial(): THREE.Material {
  if (!fallbackInteriorMat) {
    fallbackInteriorMat = new THREE.MeshStandardMaterial({
      color: 0xf2efe9,
      roughness: 0.9,
    });
  }
  return fallbackInteriorMat;
}

function getDefaultRevealMaterial(): THREE.Material {
  if (!fallbackRevealMat) {
    fallbackRevealMat = new THREE.MeshStandardMaterial({
      color: 0xeae6de,
      roughness: 0.88,
    });
  }
  return fallbackRevealMat;
}

function getDefaultCeilingMaterial(): THREE.Material {
  if (!fallbackCeilingMat) {
    fallbackCeilingMat = new THREE.MeshStandardMaterial({
      color: 0xf6f4ef,
      roughness: 0.92,
    });
  }
  return fallbackCeilingMat;
}

function toPoint2D(p: Point2DInput): [number, number] {
  if (Array.isArray(p)) {
    return [p[0], p[1]];
  }
  return [(p as { readonly x: number }).x, (p as { readonly y: number }).y];
}

function toVec3(p: readonly [number, number, number] | THREE.Vector3): THREE.Vector3 {
  return p instanceof THREE.Vector3 ? p.clone() : new THREE.Vector3(p[0], p[1], p[2]);
}

interface Line2D {
  readonly px: number;
  readonly pz: number;
  readonly dx: number;
  readonly dz: number;
}

function intersectLines2D(
  a: Line2D,
  b: Line2D,
  fallback: readonly [number, number],
  maxDist: number
): [number, number] {
  const det = a.dx * b.dz - a.dz * b.dx;
  if (Math.abs(det) < 1e-6) {
    return [fallback[0], fallback[1]];
  }
  const rx = b.px - a.px;
  const rz = b.pz - a.pz;
  const s = (rx * b.dz - rz * b.dx) / det;
  const ix = a.px + s * a.dx;
  const iz = a.pz + s * a.dz;
  const dist = Math.hypot(ix - fallback[0], iz - fallback[1]);
  if (dist > maxDist) {
    const scale = maxDist / dist;
    return [
      fallback[0] + (ix - fallback[0]) * scale,
      fallback[1] + (iz - fallback[1]) * scale,
    ];
  }
  return [ix, iz];
}

function cardinalVector(side: CardinalSide): [number, number] {
  switch (side) {
    case 'north':
      return [0, -1];
    case 'south':
      return [0, 1];
    case 'east':
      return [1, 0];
    case 'west':
      return [-1, 0];
  }
}

function inferCardinalSide(nx: number, nz: number): CardinalSide {
  if (Math.abs(nz) >= Math.abs(nx)) {
    return nz >= 0 ? 'south' : 'north';
  }
  return nx >= 0 ? 'east' : 'west';
}

interface NodeCluster {
  x: number;
  z: number;
  readonly incidences: Array<{ readonly wallIdx: number; readonly end: 0 | 1 }>;
}

interface PreparedWall {
  readonly idx: number;
  readonly input: WallNetworkSegmentInput;
  readonly from: [number, number];
  readonly to: [number, number];
  readonly length: number;
  readonly tx: number;
  readonly tz: number;
  readonly startNode: number;
  readonly endNode: number;
  kind: WallSegmentKind;
  outwardNormal: [number, number];
  outwardSide?: CardinalSide;
  offsetOuter: number;
  offsetInner: number;
}

interface OuterLoopInfo {
  readonly wallIndices: Set<number>;
  readonly orderedNodes: number[];
  readonly orderedWalls: Array<{ readonly wallIdx: number; readonly forward: boolean }>;
  readonly signedArea: number;
}

function detectOuterLoop(
  walls: readonly PreparedWall[],
  nodes: readonly NodeCluster[]
): OuterLoopInfo | null {
  const eligible = walls.filter((w) => w.input.kind !== 'partition');
  if (eligible.length < 3) return null;

  const adj = new Map<number, Array<{ wallIdx: number; toNode: number; angle: number }>>();
  for (const w of eligible) {
    if (w.startNode === w.endNode) continue;
    const listA = adj.get(w.startNode) ?? [];
    listA.push({
      wallIdx: w.idx,
      toNode: w.endNode,
      angle: Math.atan2(w.tz, w.tx),
    });
    adj.set(w.startNode, listA);

    const listB = adj.get(w.endNode) ?? [];
    listB.push({
      wallIdx: w.idx,
      toNode: w.startNode,
      angle: Math.atan2(-w.tz, -w.tx),
    });
    adj.set(w.endNode, listB);
  }

  // Iteratively prune degree-1 leaves to isolate closed boundary cycles
  const activeWalls = new Set(eligible.map((w) => w.idx));
  let changed = true;
  while (changed) {
    changed = false;
    for (const [nodeId, edges] of adj.entries()) {
      const live = edges.filter((e) => activeWalls.has(e.wallIdx));
      if (live.length === 1) {
        activeWalls.delete(live[0]!.wallIdx);
        changed = true;
      }
      adj.set(nodeId, live);
    }
  }

  if (activeWalls.size < 3) return null;

  // Start at lexicographically minimum (x, z) live node and trace outer perimeter
  let startNode = -1;
  for (const [nodeId, edges] of adj.entries()) {
    if (edges.length < 2) continue;
    if (
      startNode === -1 ||
      nodes[nodeId]!.x < nodes[startNode]!.x - 1e-7 ||
      (Math.abs(nodes[nodeId]!.x - nodes[startNode]!.x) <= 1e-7 &&
        nodes[nodeId]!.z < nodes[startNode]!.z)
    ) {
      startNode = nodeId;
    }
  }
  if (startNode === -1) return null;

  const startEdges = adj.get(startNode)!;
  // Coming from (-X) direction (angle = pi), pick edge with minimum CW/outer turn
  let firstEdge = startEdges[0]!;
  let bestStartScore = Infinity;
  for (const e of startEdges) {
    // Prefer smallest angle in [-pi/2, pi/2] (most -Z / North-going from min-X vertex)
    let ang = e.angle;
    while (ang <= -Math.PI) ang += Math.PI * 2;
    while (ang > Math.PI) ang -= Math.PI * 2;
    if (ang < bestStartScore) {
      bestStartScore = ang;
      firstEdge = e;
    }
  }

  const orderedNodes: number[] = [startNode];
  const orderedWalls: Array<{ readonly wallIdx: number; readonly forward: boolean }> = [];
  const usedDirected = new Set<string>();

  let currNode = startNode;
  let currEdge = firstEdge;
  const maxSteps = activeWalls.size * 2 + 4;

  for (let step = 0; step < maxSteps; step++) {
    const dirKey = `${currNode}->${currEdge.toNode}:${currEdge.wallIdx}`;
    if (usedDirected.has(dirKey)) break;
    usedDirected.add(dirKey);

    const w = walls[currEdge.wallIdx]!;
    orderedWalls.push({
      wallIdx: currEdge.wallIdx,
      forward: w.startNode === currNode,
    });

    const nextNode = currEdge.toNode;
    if (nextNode === startNode) {
      const polyPts = orderedNodes.map((nid): [number, number] => [
        nodes[nid]!.x,
        nodes[nid]!.z,
      ]);
      const signedArea = computeSignedPolygonArea2D(polyPts);
      if (Math.abs(signedArea) > 1e-6) {
        return {
          wallIndices: new Set(orderedWalls.map((ow) => ow.wallIdx)),
          orderedNodes,
          orderedWalls,
          signedArea,
        };
      }
      break;
    }

    orderedNodes.push(nextNode);
    const nextCandidates = adj.get(nextNode) ?? [];
    if (nextCandidates.length === 0) break;

    const backAngle = Math.atan2(
      nodes[currNode]!.z - nodes[nextNode]!.z,
      nodes[currNode]!.x - nodes[nextNode]!.x
    );

    let chosen = nextCandidates[0]!;
    let bestTurn = Infinity;
    for (const cand of nextCandidates) {
      if (cand.wallIdx === currEdge.wallIdx && nextCandidates.length > 1) continue;
      // Smallest positive CCW sweep from backAngle traces the outer face when signedArea > 0
      let delta = cand.angle - backAngle;
      while (delta <= 1e-9) delta += Math.PI * 2;
      if (delta < bestTurn) {
        bestTurn = delta;
        chosen = cand;
      }
    }

    currNode = nextNode;
    currEdge = chosen;
  }

  return null;
}

interface GeometryAccumulator {
  readonly positions: number[];
  readonly normals: number[];
  readonly uvs: number[];
  readonly indices: number[];
}

function createAccumulator(): GeometryAccumulator {
  return { positions: [], normals: [], uvs: [], indices: [] };
}

function buildBufferGeometry(acc: GeometryAccumulator): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  if (acc.positions.length === 0 || acc.indices.length === 0) {
    return geo;
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(acc.positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(acc.normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(acc.uvs, 2));
  geo.setIndex(acc.indices);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

function emitConvexOrPlanarPolygon3D(
  acc: GeometryAccumulator,
  pts: readonly THREE.Vector3[],
  outwardNormal: THREE.Vector3,
  uvProject: (p: THREE.Vector3) => [number, number]
): void {
  if (pts.length < 3) return;

  // Build orthonormal 2D basis on the polygon plane for triangulation
  const n = outwardNormal.clone().normalize();
  const ref = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const uBasis = new THREE.Vector3().crossVectors(ref, n).normalize();
  const vBasis = new THREE.Vector3().crossVectors(n, uBasis).normalize();

  const origin = pts[0]!;
  const poly2D: [number, number][] = pts.map((p) => {
    const rel = p.clone().sub(origin);
    return [rel.dot(uBasis), rel.dot(vBasis)];
  });

  let orderedPts = [...pts];
  if (computeSignedPolygonArea2D(poly2D) < 0) {
    orderedPts.reverse();
    poly2D.reverse();
  }
  if (Math.abs(computeSignedPolygonArea2D(poly2D)) <= 1e-12) return;

  const contour = poly2D.map(([u, v]) => new THREE.Vector2(u, v));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  if (tris.length === 0) return;

  const reversedByShapeUtils =
    contour.length === poly2D.length &&
    Math.hypot(contour[0]!.x - poly2D[0]![0], contour[0]!.y - poly2D[0]![1]) > 1e-8;
  if (reversedByShapeUtils) {
    orderedPts = [...orderedPts].reverse();
  }

  const baseIdx = acc.positions.length / 3;
  for (const p of orderedPts) {
    acc.positions.push(p.x, p.y, p.z);
    acc.normals.push(n.x, n.y, n.z);
    const [u, v] = uvProject(p);
    acc.uvs.push(u, v);
  }

  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const cross = new THREE.Vector3();

  for (const [a, b, c] of tris) {
    const p0 = orderedPts[a]!;
    const p1 = orderedPts[b]!;
    const p2 = orderedPts[c]!;
    e1.subVectors(p1, p0);
    e2.subVectors(p2, p0);
    cross.crossVectors(e1, e2);
    if (cross.lengthSq() <= 1e-20) continue;
    if (cross.dot(n) >= 0) {
      acc.indices.push(baseIdx + a, baseIdx + b, baseIdx + c);
    } else {
      acc.indices.push(baseIdx + a, baseIdx + c, baseIdx + b);
    }
  }
}

function emitClippedPolygon3D(
  acc: GeometryAccumulator,
  pts: readonly THREE.Vector3[],
  outwardNormal: THREE.Vector3,
  clipPlanes: readonly HalfPlane3D[],
  uvProject: (p: THREE.Vector3) => [number, number]
): void {
  const clipped = clipPlanes.length > 0 ? clipPolygonToPlanes(pts, clipPlanes) : [...pts];
  if (clipped.length < 3) return;
  emitConvexOrPlanarPolygon3D(acc, clipped, outwardNormal, uvProject);
}

function buildOpeningTopArc2D(
  u0: number,
  u1: number,
  y1: number,
  archRiseM: number | undefined
): [number, number][] {
  const rise = archRiseM ?? 0;
  if (rise <= 1e-4) {
    return [
      [u0, y1],
      [u1, y1],
    ];
  }
  const segs = 12;
  const halfW = (u1 - u0) * 0.5;
  const uc = (u0 + u1) * 0.5;
  // Circular segmental arch passing through (u0, y1), (uc, y1 + rise), (u1, y1)
  const radius = (halfW * halfW + rise * rise) / (2 * rise);
  const centerY = y1 + rise - radius;
  const pts: [number, number][] = [];
  for (let i = 0; i <= segs; i++) {
    const frac = i / segs;
    const u = u0 + (u1 - u0) * frac;
    const du = u - uc;
    const y = centerY + Math.sqrt(Math.max(0, radius * radius - du * du));
    pts.push([u, y]);
  }
  return pts;
}

function emitWallFaceElevation(
  acc: GeometryAccumulator,
  uMin: number,
  uMax: number,
  yMin: number,
  yMax: number,
  openings: readonly WallNetworkOpening[],
  wallBaseY: number,
  faceOrigin: THREE.Vector3,
  tangent3: THREE.Vector3,
  faceOutwardNormal: THREE.Vector3,
  roofClipPlanes: readonly HalfPlane3D[]
): void {
  if (uMax - uMin <= 1e-5 || yMax - yMin <= 1e-5) return;

  const yAxis = new THREE.Vector3(0, 1, 0);
  const planes2D: HalfPlane2D[] = roofClipPlanes.map((pl) => {
    const n = toVec3(pl.normal);
    return {
      nx: n.dot(tangent3),
      ny: n.dot(yAxis),
      constant: n.dot(faceOrigin) + pl.constant,
    };
  });

  // Filter and clamp openings overlapping [uMin, uMax]
  const activeOpenings = openings
    .map((op) => {
      const u0 = Math.max(uMin, op.centerOffset - op.width * 0.5);
      const u1 = Math.min(uMax, op.centerOffset + op.width * 0.5);
      const y0 = wallBaseY + op.sillY;
      const y1 = wallBaseY + op.sillY + op.height;
      return { op, u0, u1, y0, y1 };
    })
    .filter((item) => item.u1 - item.u0 > 1e-4 && item.y1 > yMin + 1e-4 && item.y0 < yMax - 1e-4)
    .sort((a, b) => a.u0 - b.u0);

  const floorNotches = activeOpenings.filter((o) => o.y0 <= yMin + 1e-4);
  const windowHoles = activeOpenings.filter((o) => o.y0 > yMin + 1e-4);

  // Build sub-contours split at any full-height openings; doorway lintels step cleanly over floor notches
  interface SubElevation {
    readonly outer: [number, number][];
    readonly uRange: readonly [number, number];
  }

  const subElevations: SubElevation[] = [];
  let cursorU = uMin;
  let currentBottomChain: [number, number][] = [[uMin, yMin]];

  for (const notch of floorNotches) {
    const archTop = notch.y1 + (notch.op.archRiseM ?? 0);
    if (archTop >= yMax - 1e-4) {
      if (notch.u0 - cursorU > 1e-4) {
        currentBottomChain.push([notch.u0, yMin]);
        subElevations.push({
          outer: [...currentBottomChain, [notch.u0, yMax], [cursorU, yMax]],
          uRange: [cursorU, notch.u0],
        });
      }
      cursorU = notch.u1;
      currentBottomChain = [[cursorU, yMin]];
    } else {
      if (notch.u0 > cursorU + 1e-5) {
        currentBottomChain.push([notch.u0, yMin]);
      }
      const arcPts = buildOpeningTopArc2D(notch.u0, notch.u1, notch.y1, notch.op.archRiseM);
      for (const pt of arcPts) {
        currentBottomChain.push(pt);
      }
      currentBottomChain.push([notch.u1, yMin]);
    }
  }

  if (uMax - cursorU > 1e-4) {
    currentBottomChain.push([uMax, yMin], [uMax, yMax], [cursorU, yMax]);
    subElevations.push({
      outer: currentBottomChain,
      uRange: [cursorU, uMax],
    });
  }

  const toWorld = (u: number, y: number): THREE.Vector3 =>
    new THREE.Vector3(
      faceOrigin.x + tangent3.x * u,
      y,
      faceOrigin.z + tangent3.z * u
    );

  const uvProject = (p: THREE.Vector3): [number, number] => [
    p.x * tangent3.x + p.z * tangent3.z,
    p.y,
  ];

  for (const sub of subElevations) {
    const holes: [number, number][][] = [];
    const topNotches = windowHoles.filter(
      (w) =>
        w.u0 >= sub.uRange[0] + 1e-4 &&
        w.u1 <= sub.uRange[1] - 1e-4 &&
        w.y1 + (w.op.archRiseM ?? 0) >= yMax - 1e-4
    );

    let outerRing = sub.outer;
    if (topNotches.length > 0) {
      // Splice top-reaching openings into the top edge (running right-to-left from uRange[1] to uRange[0])
      const head = outerRing.slice(0, outerRing.length - 2);
      const topChain: [number, number][] = [[sub.uRange[1], yMax]];
      const desc = [...topNotches].sort((a, b) => b.u1 - a.u1);
      for (const tn of desc) {
        topChain.push([tn.u1, yMax], [tn.u1, tn.y0], [tn.u0, tn.y0], [tn.u0, yMax]);
      }
      topChain.push([sub.uRange[0], yMax]);
      outerRing = [...head, ...topChain];
    }

    for (const win of windowHoles) {
      if (win.u0 < sub.uRange[0] + 1e-4 || win.u1 > sub.uRange[1] - 1e-4) continue;
      if (win.y1 + (win.op.archRiseM ?? 0) >= yMax - 1e-4) continue;
      const arcPts = buildOpeningTopArc2D(win.u0, win.u1, win.y1, win.op.archRiseM);
      // CW hole in (u, y): bottom-left -> top-left..arc..top-right -> bottom-right
      const holePts: [number, number][] = [[win.u0, win.y0], ...arcPts, [win.u1, win.y0]];
      holes.push(holePts);
    }

    const clipped =
      planes2D.length > 0
        ? clipProfileToPlanes({ outer: outerRing, holes }, planes2D)
        : { outer: outerRing, holes };

    if (clipped.outer.length < 3) continue;
    if (computeSignedPolygonArea2D(clipped.outer) < 0) {
      clipped.outer.reverse();
    }

    const contourV2 = clipped.outer.map(([u, y]) => new THREE.Vector2(u, y));
    const holesV2 = clipped.holes.map((h) => {
      const copy = [...h];
      if (computeSignedPolygonArea2D(copy) > 0) copy.reverse();
      return copy.map(([u, y]) => new THREE.Vector2(u, y));
    });

    const tris = THREE.ShapeUtils.triangulateShape(contourV2, holesV2);
    if (tris.length === 0) continue;

    const all2D: [number, number][] = [
      ...contourV2.map((v): [number, number] => [v.x, v.y]),
      ...holesV2.flatMap((h) => h.map((v): [number, number] => [v.x, v.y])),
    ];
    const all3D = all2D.map(([u, y]) => toWorld(u, y));

    const baseIdx = acc.positions.length / 3;
    for (const p of all3D) {
      acc.positions.push(p.x, p.y, p.z);
      acc.normals.push(faceOutwardNormal.x, faceOutwardNormal.y, faceOutwardNormal.z);
      const [uu, vv] = uvProject(p);
      acc.uvs.push(uu, vv);
    }

    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    const cross = new THREE.Vector3();
    for (const [a, b, c] of tris) {
      const p0 = all3D[a]!;
      const p1 = all3D[b]!;
      const p2 = all3D[c]!;
      e1.subVectors(p1, p0);
      e2.subVectors(p2, p0);
      cross.crossVectors(e1, e2);
      if (cross.lengthSq() <= 1e-20) continue;
      if (cross.dot(faceOutwardNormal) >= 0) {
        acc.indices.push(baseIdx + a, baseIdx + b, baseIdx + c);
      } else {
        acc.indices.push(baseIdx + a, baseIdx + c, baseIdx + b);
      }
    }
  }
}

interface WallEndTrim {
  readonly uOuter: number;
  readonly uInner: number;
  readonly centerVertex?: [number, number];
  readonly suppressCap: boolean;
}

/**
 * Builds an analytical 3D wall network with mitered L-corners, flush T-junction trims,
 * multi-wall node intersections, `+0.5 mm` inter-storey clearances, metric `1 UV = 1 m`
 * world-space UVs, roof-plane gable clipping, and per-bay `CutawayWallDescriptor` tagging.
 */
export function createWallNetwork(options: CreateWallNetworkOptions): BuiltWallNetwork {
  const rootGroup = new THREE.Group();
  rootGroup.name = options.name ?? `wallNetwork.${options.floor}`;
  rootGroup.userData.isArchitecturalShell = true;

  const defaultBaseY = options.baseY ?? 0;
  const defaultHeight = options.height ?? 2.7;
  const clearance = options.interStoreyClearanceM ?? LAYER_CLEARANCE_M;
  const defaultExtMat = options.exteriorMaterial ?? getDefaultExteriorMaterial();
  const defaultIntMat = options.interiorMaterial ?? getDefaultInteriorMaterial();
  const defaultRevMat = options.revealMaterial ?? getDefaultRevealMaterial();
  const globalRoofPlanes = options.roofClipPlanes ?? [];

  // Cluster endpoints within 1e-4 m
  const nodes: NodeCluster[] = [];
  const findOrCreateNode = (x: number, z: number): number => {
    for (let i = 0; i < nodes.length; i++) {
      if (Math.hypot(nodes[i]!.x - x, nodes[i]!.z - z) <= NODE_SNAP_EPS) {
        return i;
      }
    }
    nodes.push({ x, z, incidences: [] });
    return nodes.length - 1;
  };

  const preparedWalls: PreparedWall[] = [];
  for (let i = 0; i < options.walls.length; i++) {
    const input = options.walls[i]!;
    const dx = input.to[0] - input.from[0];
    const dz = input.to[1] - input.from[1];
    const len = Math.hypot(dx, dz);
    if (len <= 1e-5) continue;

    const sNode = findOrCreateNode(input.from[0], input.from[1]);
    const eNode = findOrCreateNode(input.to[0], input.to[1]);
    const pwIndex = preparedWalls.length;
    nodes[sNode]!.incidences.push({ wallIdx: pwIndex, end: 0 });
    nodes[eNode]!.incidences.push({ wallIdx: pwIndex, end: 1 });

    preparedWalls.push({
      idx: pwIndex,
      input,
      from: [input.from[0], input.from[1]],
      to: [input.to[0], input.to[1]],
      length: len,
      tx: dx / len,
      tz: dz / len,
      startNode: sNode,
      endNode: eNode,
      kind: input.kind ?? (input.outwardSide ? 'exterior' : 'partition'),
      outwardNormal: [-dz / len, dx / len],
      outwardSide: input.outwardSide,
      offsetOuter: input.thickness * 0.5,
      offsetInner: -input.thickness * 0.5,
    });
  }

  const outerLoop = detectOuterLoop(preparedWalls, nodes);

  // Network centroid fallback for open exterior chains without explicit outwardSide
  let netCx = 0;
  let netCz = 0;
  if (nodes.length > 0) {
    for (const nd of nodes) {
      netCx += nd.x;
      netCz += nd.z;
    }
    netCx /= nodes.length;
    netCz /= nodes.length;
  }

  for (const w of preparedWalls) {
    const inOuterLoop = outerLoop?.wallIndices.has(w.idx) ?? false;
    if (w.input.kind) {
      w.kind = w.input.kind;
    } else if (w.input.outwardSide || inOuterLoop) {
      w.kind = 'exterior';
    } else {
      w.kind = 'partition';
    }

    const nRight: [number, number] = [-w.tz, w.tx];
    const nLeft: [number, number] = [w.tz, -w.tx];

    if (w.input.outwardSide) {
      const card = cardinalVector(w.input.outwardSide);
      const dotR = nRight[0] * card[0] + nRight[1] * card[1];
      const dotL = nLeft[0] * card[0] + nLeft[1] * card[1];
      w.outwardNormal = dotR >= dotL ? nRight : nLeft;
    } else if (inOuterLoop && outerLoop) {
      const entry = outerLoop.orderedWalls.find((ow) => ow.wallIdx === w.idx)!;
      // When loop signedArea > 0, walking along loop forward has outward normal nLeft ([tz, -tx])
      const loopOutMatchesLeft = outerLoop.signedArea > 0;
      const useLeft = entry.forward ? loopOutMatchesLeft : !loopOutMatchesLeft;
      w.outwardNormal = useLeft ? nLeft : nRight;
    } else if (w.kind === 'exterior' && nodes.length >= 3) {
      const mx = (w.from[0] + w.to[0]) * 0.5;
      const mz = (w.from[1] + w.to[1]) * 0.5;
      const vx = mx - netCx;
      const vz = mz - netCz;
      const dotR = vx * nRight[0] + vz * nRight[1];
      const dotL = vx * nLeft[0] + vz * nLeft[1];
      w.outwardNormal = dotR >= dotL ? nRight : nLeft;
    } else {
      w.outwardNormal = nRight;
    }

    if (w.kind === 'exterior') {
      w.outwardSide =
        w.input.outwardSide ?? inferCardinalSide(w.outwardNormal[0], w.outwardNormal[1]);
    }

    const align = w.input.align ?? 'center';
    if (align === 'interior') {
      w.offsetOuter = w.input.thickness;
      w.offsetInner = 0;
    } else if (align === 'exterior') {
      w.offsetOuter = 0;
      w.offsetInner = -w.input.thickness;
    } else {
      w.offsetOuter = w.input.thickness * 0.5;
      w.offsetInner = -w.input.thickness * 0.5;
    }
  }

  const wallLineAtOffset = (w: PreparedWall, normalOffset: number): Line2D => ({
    px: w.from[0] + w.outwardNormal[0] * normalOffset,
    pz: w.from[1] + w.outwardNormal[1] * normalOffset,
    dx: w.tx,
    dz: w.tz,
  });

  const projectU = (w: PreparedWall, pt: readonly [number, number]): number =>
    (pt[0] - w.from[0]) * w.tx + (pt[1] - w.from[1]) * w.tz;

  const startTrims = new Map<number, WallEndTrim>();
  const endTrims = new Map<number, WallEndTrim>();

  // Initialize default square trims
  for (const w of preparedWalls) {
    startTrims.set(w.idx, { uOuter: 0, uInner: 0, suppressCap: false });
    endTrims.set(w.idx, { uOuter: w.length, uInner: w.length, suppressCap: false });
  }

  // Resolve 2-way L-corners and 3+ way multi-wall nodes
  for (const node of nodes) {
    const k = node.incidences.length;
    if (k < 2) continue;

    interface HalfEdge {
      readonly wall: PreparedWall;
      readonly end: 0 | 1;
      readonly dirX: number;
      readonly dirZ: number;
      readonly angle: number;
      readonly plusIsOuter: boolean;
      readonly plusLine: Line2D;
      readonly minusLine: Line2D;
    }

    const halfEdges: HalfEdge[] = node.incidences.map((inc) => {
      const w = preparedWalls[inc.wallIdx]!;
      const dirX = inc.end === 0 ? w.tx : -w.tx;
      const dirZ = inc.end === 0 ? w.tz : -w.tz;
      // +angle side normal of ray [dirX, dirZ] is nPlus = [-dirZ, dirX]
      const nPlusX = -dirZ;
      const nPlusZ = dirX;
      const dotOut = nPlusX * w.outwardNormal[0] + nPlusZ * w.outwardNormal[1];
      const plusIsOuter = dotOut >= 0;
      const outerL = wallLineAtOffset(w, w.offsetOuter);
      const innerL = wallLineAtOffset(w, w.offsetInner);
      return {
        wall: w,
        end: inc.end,
        dirX,
        dirZ,
        angle: Math.atan2(dirZ, dirX),
        plusIsOuter,
        plusLine: plusIsOuter ? outerL : innerL,
        minusLine: plusIsOuter ? innerL : outerL,
      };
    });

    halfEdges.sort((a, b) => a.angle - b.angle);

    // Sector i lies between halfEdges[i] (+angle side) and halfEdges[(i+1)%k] (-angle side)
    const sectorCorners: [number, number][] = [];
    for (let i = 0; i < k; i++) {
      const curr = halfEdges[i]!;
      const next = halfEdges[(i + 1) % k]!;
      const maxMiter =
        Math.max(curr.wall.input.thickness, next.wall.input.thickness) * MAX_MITER_RATIO;
      const fallbackX =
        node.x +
        (-curr.dirZ) *
          (curr.plusIsOuter ? curr.wall.offsetOuter : -curr.wall.offsetInner);
      const fallbackZ =
        node.z +
        curr.dirX *
          (curr.plusIsOuter ? curr.wall.offsetOuter : -curr.wall.offsetInner);
      sectorCorners.push(
        intersectLines2D(curr.plusLine, next.minusLine, [fallbackX, fallbackZ], maxMiter)
      );
    }

    let centerVertex: [number, number] | undefined;
    if (k >= 3) {
      let sx = 0;
      let sz = 0;
      for (const c of sectorCorners) {
        sx += c[0];
        sz += c[1];
      }
      centerVertex = [sx / k, sz / k];
    }

    for (let i = 0; i < k; i++) {
      const curr = halfEdges[i]!;
      const plusCorner = sectorCorners[i]!;
      const minusCorner = sectorCorners[(i + k - 1) % k]!;
      const outerCorner = curr.plusIsOuter ? plusCorner : minusCorner;
      const innerCorner = curr.plusIsOuter ? minusCorner : plusCorner;
      const trim: WallEndTrim = {
        uOuter: projectU(curr.wall, outerCorner),
        uInner: projectU(curr.wall, innerCorner),
        centerVertex,
        suppressCap: true,
      };
      if (curr.end === 0) {
        startTrims.set(curr.wall.idx, trim);
      } else {
        endTrims.set(curr.wall.idx, trim);
      }
    }
  }

  // Detect T-junctions where a degree-1 wall endpoint lands on another host wall's interior span
  const hostPartitionSplits = new Map<number, number[]>();

  for (const w of preparedWalls) {
    for (const end of [0, 1] as const) {
      const nodeId = end === 0 ? w.startNode : w.endNode;
      if (nodes[nodeId]!.incidences.length > 1) {
        // Also record 3+ way partition junction splits on exterior host walls if collinear
        continue;
      }

      const pt = end === 0 ? w.from : w.to;
      const dirIntoW: [number, number] = end === 0 ? [w.tx, w.tz] : [-w.tx, -w.tz];

      let bestHost: PreparedWall | null = null;
      let bestDist = Infinity;
      let bestProj = 0;

      for (const candidate of preparedWalls) {
        if (candidate.idx === w.idx) continue;
        const proj = projectU(candidate, pt);
        if (proj <= 1e-3 || proj >= candidate.length - 1e-3) continue;

        const signedN =
          (pt[0] - candidate.from[0]) * candidate.outwardNormal[0] +
          (pt[1] - candidate.from[1]) * candidate.outwardNormal[1];
        const distToOuter = Math.abs(signedN - candidate.offsetOuter);
        const distToInner = Math.abs(signedN - candidate.offsetInner);
        const withinCore =
          signedN >= candidate.offsetInner - 0.02 && signedN <= candidate.offsetOuter + 0.02;
        const minFaceDist = Math.min(distToOuter, distToInner);
        const threshold = candidate.input.thickness + 0.02;

        if (withinCore || minFaceDist <= threshold) {
          // Ensure walls are non-parallel
          const cross = Math.abs(w.tx * candidate.tz - w.tz * candidate.tx);
          if (cross < 0.08) continue;
          const score = withinCore ? 0 : minFaceDist;
          if (score < bestDist) {
            bestDist = score;
            bestHost = candidate;
            bestProj = proj;
          }
        }
      }

      if (bestHost) {
        // Near face of host is the face whose outward normal aligns with dirIntoW
        const dotHostOut =
          dirIntoW[0] * bestHost.outwardNormal[0] + dirIntoW[1] * bestHost.outwardNormal[1];
        const hostFaceOffset = dotHostOut >= 0 ? bestHost.offsetOuter : bestHost.offsetInner;
        const hostFaceLine = wallLineAtOffset(bestHost, hostFaceOffset);

        const wOuterLine = wallLineAtOffset(w, w.offsetOuter);
        const wInnerLine = wallLineAtOffset(w, w.offsetInner);
        const maxTrim = (bestHost.input.thickness + w.input.thickness) * MAX_MITER_RATIO;

        const outerHit = intersectLines2D(wOuterLine, hostFaceLine, pt, maxTrim);
        const innerHit = intersectLines2D(wInnerLine, hostFaceLine, pt, maxTrim);

        const trim: WallEndTrim = {
          uOuter: projectU(w, outerHit),
          uInner: projectU(w, innerHit),
          suppressCap: true,
        };
        if (end === 0) {
          startTrims.set(w.idx, trim);
        } else {
          endTrims.set(w.idx, trim);
        }

        if (bestHost.kind === 'exterior' && w.kind === 'partition') {
          const list = hostPartitionSplits.get(bestHost.idx) ?? [];
          list.push(bestProj);
          hostPartitionSplits.set(bestHost.idx, list);
        }
      }
    }
  }

  // Compute closed interior polygon XZ when outerLoop exists
  const interiorPolygonXZ: [number, number][] = [];
  if (outerLoop && outerLoop.orderedWalls.length >= 3) {
    const count = outerLoop.orderedWalls.length;
    for (let i = 0; i < count; i++) {
      const ow = outerLoop.orderedWalls[i]!;
      const w = preparedWalls[ow.wallIdx]!;
      const trim = ow.forward ? startTrims.get(w.idx)! : endTrims.get(w.idx)!;
      const ix = w.from[0] + w.tx * trim.uInner + w.outwardNormal[0] * w.offsetInner;
      const iz = w.from[1] + w.tz * trim.uInner + w.outwardNormal[1] * w.offsetInner;
      if (
        interiorPolygonXZ.length === 0 ||
        Math.hypot(
          ix - interiorPolygonXZ[interiorPolygonXZ.length - 1]![0],
          iz - interiorPolygonXZ[interiorPolygonXZ.length - 1]![1]
        ) > 1e-5
      ) {
        interiorPolygonXZ.push([ix, iz]);
      }
    }
    if (
      interiorPolygonXZ.length > 1 &&
      Math.hypot(
        interiorPolygonXZ[0]![0] - interiorPolygonXZ[interiorPolygonXZ.length - 1]![0],
        interiorPolygonXZ[0]![1] - interiorPolygonXZ[interiorPolygonXZ.length - 1]![1]
      ) <= 1e-5
    ) {
      interiorPolygonXZ.pop();
    }
  }

  // Collect all initial rich opening specs (both per-wall with `kind` and network-level `options.openings`)
  const wallAperturesMap = new Map<string, WallNetworkOpening[]>();
  const initialRichSpecs: WallOpeningSpec[] = [];

  for (const w of preparedWalls) {
    const wallList: WallNetworkOpening[] = [];
    for (const rawOp of w.input.openings ?? []) {
      const centerOffset = resolveOpeningCenterAlongM(rawOp as WallOpeningSpec, w.length);
      const sillY = rawOp.sillY ?? 0;
      const richKind = (rawOp as WallOpeningSpec).kind;
      const suppressRawReveals =
        (rawOp as WallNetworkOpening).suppressRawReveals ??
        Boolean(richKind && richKind !== 'raw-hole' && richKind !== 'georgian-sash');
      wallList.push({
        ...(rawOp.id !== undefined ? { id: rawOp.id } : {}),
        centerOffset,
        width: rawOp.width,
        sillY,
        height: rawOp.height,
        ...(rawOp.archRiseM !== undefined ? { archRiseM: rawOp.archRiseM } : {}),
        ...(suppressRawReveals ? { suppressRawReveals: true } : {}),
      });
      if (richKind) {
        initialRichSpecs.push({
          ...(rawOp as WallOpeningSpec),
          wallId: w.input.id,
          centerOffset,
          sillY,
        });
      }
    }
    wallAperturesMap.set(w.input.id, wallList);
  }

  for (const netOp of options.openings ?? []) {
    const targetWall = preparedWalls.find((pw) => pw.input.id === netOp.wallId);
    if (!targetWall) {
      throw new Error(`createWallNetwork: opening references unknown wallId '${netOp.wallId}'.`);
    }
    const centerOffset = resolveOpeningCenterAlongM(netOp, targetWall.length);
    const sillY = netOp.sillY ?? 0;
    const richKind = netOp.kind ?? 'raw-hole';
    const wallList = wallAperturesMap.get(targetWall.input.id)!;
    wallList.push({
      ...(netOp.id !== undefined ? { id: netOp.id } : {}),
      centerOffset,
      width: netOp.width,
      sillY,
      height: netOp.height,
      ...(netOp.archRiseM !== undefined ? { archRiseM: netOp.archRiseM } : {}),
      suppressRawReveals: richKind !== 'raw-hole' && richKind !== 'georgian-sash',
    });
    initialRichSpecs.push({
      ...netOp,
      wallId: targetWall.input.id,
      centerOffset,
      sillY,
      kind: richKind,
    });
  }

  const allCutaways: CutawayWallDescriptor[] = [];
  const cutawaysByWallId = new Map<string, readonly CutawayWallDescriptor[]>();
  const wallBayGroupsByWallId = new Map<string, THREE.Group[]>();

  const buildSingleWallGeometry = (w: PreparedWall): void => {
    // Remove any previously built bay groups for this wall when rebuilding for populateWallOpenings
    const prevGroups = wallBayGroupsByWallId.get(w.input.id);
    if (prevGroups) {
      for (const g of prevGroups) {
        rootGroup.remove(g);
      }
    }
    const prevCutaways = cutawaysByWallId.get(w.input.id);
    if (prevCutaways && prevCutaways.length > 0) {
      for (const pc of prevCutaways) {
        const idx = allCutaways.indexOf(pc);
        if (idx >= 0) allCutaways.splice(idx, 1);
      }
    }

    const wallBaseY = w.input.baseY ?? defaultBaseY;
    const wallHeight = w.input.height ?? defaultHeight;
    const yMin = wallBaseY + clearance;
    const yMax = wallBaseY + wallHeight - clearance;
    if (yMax - yMin <= 1e-5) {
      wallBayGroupsByWallId.set(w.input.id, []);
      cutawaysByWallId.set(w.input.id, []);
      return;
    }

    const roofPlanes = [
      ...globalRoofPlanes,
      ...(w.input.roofClipPlanes ?? []),
    ];

    const extMat =
      w.input.exteriorMaterial ??
      (w.kind === 'exterior' ? defaultExtMat : (w.input.interiorMaterial ?? defaultIntMat));
    const intMat = w.input.interiorMaterial ?? defaultIntMat;
    const revMat = w.input.revealMaterial ?? defaultRevMat;
    const openings = wallAperturesMap.get(w.input.id) ?? [];
    const createdBayGroups: THREE.Group[] = [];

    const sTrim = startTrims.get(w.idx)!;
    const eTrim = endTrims.get(w.idx)!;

    // Determine bay split points along u in (0, w.length)
    const shouldSplit = w.kind === 'exterior' && w.input.splitAtPartitions !== false;
    const rawSplits = shouldSplit ? (hostPartitionSplits.get(w.idx) ?? []) : [];
    const validSplits = [...rawSplits]
      .filter((u) => {
        if (u <= 0.05 || u >= w.length - 0.05) return false;
        // Avoid splitting right through the middle of a door or window opening
        for (const op of openings) {
          const op0 = op.centerOffset - op.width * 0.5 - 0.02;
          const op1 = op.centerOffset + op.width * 0.5 + 0.02;
          if (u > op0 && u < op1) return false;
        }
        return true;
      })
      .sort((a, b) => a - b);

    const dedupSplits: number[] = [];
    for (const s of validSplits) {
      if (dedupSplits.length === 0 || s - dedupSplits[dedupSplits.length - 1]! > 0.05) {
        dedupSplits.push(s);
      }
    }

    const bayCount = dedupSplits.length + 1;
    const wallCutaways: CutawayWallDescriptor[] = [];

    const tangent3 = new THREE.Vector3(w.tx, 0, w.tz);
    const normal3 = new THREE.Vector3(w.outwardNormal[0], 0, w.outwardNormal[1]);
    const negNormal3 = normal3.clone().negate();

    const outerFaceOrigin = new THREE.Vector3(
      w.from[0] + w.outwardNormal[0] * w.offsetOuter,
      0,
      w.from[1] + w.outwardNormal[1] * w.offsetOuter
    );
    const innerFaceOrigin = new THREE.Vector3(
      w.from[0] + w.outwardNormal[0] * w.offsetInner,
      0,
      w.from[1] + w.outwardNormal[1] * w.offsetInner
    );

    const toWorldUW = (u: number, y: number, wOff: number): THREE.Vector3 =>
      new THREE.Vector3(
        w.from[0] + w.tx * u + w.outwardNormal[0] * wOff,
        y,
        w.from[1] + w.tz * u + w.outwardNormal[1] * wOff
      );

    for (let bIdx = 0; bIdx < bayCount; bIdx++) {
      const isFirstBay = bIdx === 0;
      const isLastBay = bIdx === bayCount - 1;

      const uOuter0 = isFirstBay ? sTrim.uOuter : dedupSplits[bIdx - 1]!;
      const uInner0 = isFirstBay ? sTrim.uInner : dedupSplits[bIdx - 1]!;
      const uOuter1 = isLastBay ? eTrim.uOuter : dedupSplits[bIdx]!;
      const uInner1 = isLastBay ? eTrim.uInner : dedupSplits[bIdx]!;

      const bayStartSuppress = isFirstBay ? sTrim.suppressCap : true;
      const bayEndSuppress = isLastBay ? eTrim.suppressCap : true;
      const bayStartCenter = isFirstBay ? sTrim.centerVertex : undefined;
      const bayEndCenter = isLastBay ? eTrim.centerVertex : undefined;

      const extAcc = createAccumulator();
      const intAcc = createAccumulator();
      const revAcc = createAccumulator();

      // Outer face (+normal)
      emitWallFaceElevation(
        extAcc,
        uOuter0,
        uOuter1,
        yMin,
        yMax,
        openings,
        wallBaseY,
        outerFaceOrigin,
        tangent3,
        normal3,
        roofPlanes
      );

      // Inner face (-normal)
      emitWallFaceElevation(
        intAcc,
        uInner0,
        uInner1,
        yMin,
        yMax,
        openings,
        wallBaseY,
        innerFaceOrigin,
        tangent3,
        negNormal3,
        roofPlanes
      );

      // Opening reveals (jambs, sill, lintel/arch soffit)
      const uRevealMin = Math.max(uOuter0, uInner0);
      const uRevealMax = Math.min(uOuter1, uInner1);
      for (const op of openings) {
        if (op.suppressRawReveals) continue;
        const op0 = op.centerOffset - op.width * 0.5;
        const op1 = op.centerOffset + op.width * 0.5;
        if (op1 <= uRevealMin + 1e-4 || op0 >= uRevealMax - 1e-4) continue;
        const u0 = Math.max(uRevealMin, op0);
        const u1 = Math.min(uRevealMax, op1);
        const y0 = Math.max(yMin, wallBaseY + op.sillY);
        const y1 = wallBaseY + op.sillY + op.height;
        if (y1 <= y0 + 1e-4) continue;

        const uvNormalVertical = (p: THREE.Vector3): [number, number] => [
          p.x * normal3.x + p.z * normal3.z,
          p.y,
        ];
        const uvHorizReveal = (p: THREE.Vector3): [number, number] => [
          p.x * tangent3.x + p.z * tangent3.z,
          p.x * normal3.x + p.z * normal3.z,
        ];

        // Left jamb at u0 (normal +tangent)
        if (Math.abs(u0 - op0) <= 1e-4) {
          emitClippedPolygon3D(
            revAcc,
            [
              toWorldUW(u0, y0, w.offsetInner),
              toWorldUW(u0, y0, w.offsetOuter),
              toWorldUW(u0, y1, w.offsetOuter),
              toWorldUW(u0, y1, w.offsetInner),
            ],
            tangent3,
            roofPlanes,
            uvNormalVertical
          );
        }

        // Right jamb at u1 (normal -tangent)
        if (Math.abs(u1 - op1) <= 1e-4) {
          emitClippedPolygon3D(
            revAcc,
            [
              toWorldUW(u1, y0, w.offsetOuter),
              toWorldUW(u1, y0, w.offsetInner),
              toWorldUW(u1, y1, w.offsetInner),
              toWorldUW(u1, y1, w.offsetOuter),
            ],
            tangent3.clone().negate(),
            roofPlanes,
            uvNormalVertical
          );
        }

        // Window sill at y0 (omitted for floor-level doorways)
        if (wallBaseY + op.sillY > yMin + 1e-4) {
          emitClippedPolygon3D(
            revAcc,
            [
              toWorldUW(u0, y0, w.offsetInner),
              toWorldUW(u1, y0, w.offsetInner),
              toWorldUW(u1, y0, w.offsetOuter),
              toWorldUW(u0, y0, w.offsetOuter),
            ],
            new THREE.Vector3(0, 1, 0),
            roofPlanes,
            uvHorizReveal
          );
        }

        // Top lintel or segmental arch soffit (normal pointing downward into opening)
        const arcPts = buildOpeningTopArc2D(u0, u1, y1, op.archRiseM);
        for (let k = 0; k + 1 < arcPts.length; k++) {
          const [au0, ay0] = arcPts[k]!;
          const [au1, ay1] = arcPts[k + 1]!;
          if (ay0 >= yMax - 1e-4 && ay1 >= yMax - 1e-4) continue;
          const du = au1 - au0;
          const dy = ay1 - ay0;
          // Downward normal into opening in (tangent, Y)
          const soffitNormal = new THREE.Vector3(
            tangent3.x * dy,
            -du,
            tangent3.z * dy
          ).normalize();
          emitClippedPolygon3D(
            revAcc,
            [
              toWorldUW(au0, ay0, w.offsetOuter),
              toWorldUW(au1, ay1, w.offsetOuter),
              toWorldUW(au1, ay1, w.offsetInner),
              toWorldUW(au0, ay0, w.offsetInner),
            ],
            soffitNormal,
            roofPlanes,
            uvHorizReveal
          );
        }
      }

      // Free end-caps (omitted at mitered L-corners, multi-wall nodes, T-junctions, and bay splits)
      const uvEndCap = (p: THREE.Vector3): [number, number] => [
        p.x * normal3.x + p.z * normal3.z,
        p.y,
      ];
      if (!bayStartSuppress) {
        const pIn0 = toWorldUW(uInner0, yMin, w.offsetInner);
        const pOut0 = toWorldUW(uOuter0, yMin, w.offsetOuter);
        const edge = new THREE.Vector3().subVectors(pOut0, pIn0);
        const capN = new THREE.Vector3().crossVectors(edge, new THREE.Vector3(0, 1, 0)).normalize();
        if (capN.dot(tangent3) > 0) capN.negate();
        emitClippedPolygon3D(
          revAcc,
          [
            pIn0,
            pOut0,
            toWorldUW(uOuter0, yMax, w.offsetOuter),
            toWorldUW(uInner0, yMax, w.offsetInner),
          ],
          capN,
          roofPlanes,
          uvEndCap
        );
      }

      if (!bayEndSuppress) {
        const pIn1 = toWorldUW(uInner1, yMin, w.offsetInner);
        const pOut1 = toWorldUW(uOuter1, yMin, w.offsetOuter);
        const edge = new THREE.Vector3().subVectors(pOut1, pIn1);
        const capN = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), edge).normalize();
        if (capN.dot(tangent3) < 0) capN.negate();
        emitClippedPolygon3D(
          revAcc,
          [
            pOut1,
            pIn1,
            toWorldUW(uInner1, yMax, w.offsetInner),
            toWorldUW(uOuter1, yMax, w.offsetOuter),
          ],
          capN,
          roofPlanes,
          uvEndCap
        );
      }

      // Top & bottom horizontal caps (split around floor-level or top-reaching openings)
      const uvHorizCap = (p: THREE.Vector3): [number, number] => [
        p.x * tangent3.x + p.z * tangent3.z,
        p.x * normal3.x + p.z * normal3.z,
      ];

      const buildBayPlanPolygonAtY = (
        yLevel: number,
        spanType: 'full' | 'sub',
        subU0: number,
        subU1: number
      ): THREE.Vector3[] => {
        if (spanType === 'full') {
          const pts: THREE.Vector3[] = [toWorldUW(uOuter0, yLevel, w.offsetOuter)];
          pts.push(toWorldUW(uOuter1, yLevel, w.offsetOuter));
          if (bayEndCenter) {
            pts.push(new THREE.Vector3(bayEndCenter[0], yLevel, bayEndCenter[1]));
          }
          pts.push(toWorldUW(uInner1, yLevel, w.offsetInner));
          pts.push(toWorldUW(uInner0, yLevel, w.offsetInner));
          if (bayStartCenter) {
            pts.push(new THREE.Vector3(bayStartCenter[0], yLevel, bayStartCenter[1]));
          }
          return pts;
        }

        const atStart = Math.abs(subU0 - Math.min(uOuter0, uInner0)) <= 1e-4;
        const atEnd = Math.abs(subU1 - Math.max(uOuter1, uInner1)) <= 1e-4;
        const o0 = atStart ? uOuter0 : subU0;
        const i0 = atStart ? uInner0 : subU0;
        const o1 = atEnd ? uOuter1 : subU1;
        const i1 = atEnd ? uInner1 : subU1;
        const pts: THREE.Vector3[] = [
          toWorldUW(o0, yLevel, w.offsetOuter),
          toWorldUW(o1, yLevel, w.offsetOuter),
        ];
        if (atEnd && bayEndCenter) {
          pts.push(new THREE.Vector3(bayEndCenter[0], yLevel, bayEndCenter[1]));
        }
        pts.push(toWorldUW(i1, yLevel, w.offsetInner), toWorldUW(i0, yLevel, w.offsetInner));
        if (atStart && bayStartCenter) {
          pts.push(new THREE.Vector3(bayStartCenter[0], yLevel, bayStartCenter[1]));
        }
        return pts;
      };

      const bayMinU = Math.min(uOuter0, uInner0);
      const bayMaxU = Math.max(uOuter1, uInner1);

      // Bottom cap (split around floor-level doorways)
      const bottomDoorCuts = openings
        .filter((op) => wallBaseY + op.sillY <= yMin + 1e-4)
        .map((op): [number, number] => [
          op.centerOffset - op.width * 0.5,
          op.centerOffset + op.width * 0.5,
        ])
        .filter(([a, b]) => b > bayMinU + 1e-4 && a < bayMaxU - 1e-4)
        .sort((a, b) => a[0] - b[0]);

      if (bottomDoorCuts.length === 0) {
        emitClippedPolygon3D(
          revAcc,
          buildBayPlanPolygonAtY(yMin, 'full', bayMinU, bayMaxU),
          new THREE.Vector3(0, -1, 0),
          roofPlanes,
          uvHorizCap
        );
      } else {
        let cur = bayMinU;
        for (const [c0, c1] of bottomDoorCuts) {
          if (c0 - cur > 1e-4) {
            emitClippedPolygon3D(
              revAcc,
              buildBayPlanPolygonAtY(yMin, 'sub', cur, c0),
              new THREE.Vector3(0, -1, 0),
              roofPlanes,
              uvHorizCap
            );
          }
          cur = Math.max(cur, c1);
        }
        if (bayMaxU - cur > 1e-4) {
          emitClippedPolygon3D(
            revAcc,
            buildBayPlanPolygonAtY(yMin, 'sub', cur, bayMaxU),
            new THREE.Vector3(0, -1, 0),
            roofPlanes,
            uvHorizCap
          );
        }
      }

      // Top cap at yMax (clipped against roofPlanes so gable peaks above roof soffit vanish cleanly)
      const topCuts = openings
        .filter((op) => wallBaseY + op.sillY + op.height + (op.archRiseM ?? 0) >= yMax - 1e-4)
        .map((op): [number, number] => [
          op.centerOffset - op.width * 0.5,
          op.centerOffset + op.width * 0.5,
        ])
        .filter(([a, b]) => b > bayMinU + 1e-4 && a < bayMaxU - 1e-4)
        .sort((a, b) => a[0] - b[0]);

      if (topCuts.length === 0) {
        emitClippedPolygon3D(
          revAcc,
          buildBayPlanPolygonAtY(yMax, 'full', bayMinU, bayMaxU),
          new THREE.Vector3(0, 1, 0),
          roofPlanes,
          uvHorizCap
        );
      } else {
        let cur = bayMinU;
        for (const [c0, c1] of topCuts) {
          if (c0 - cur > 1e-4) {
            emitClippedPolygon3D(
              revAcc,
              buildBayPlanPolygonAtY(yMax, 'sub', cur, c0),
              new THREE.Vector3(0, 1, 0),
              roofPlanes,
              uvHorizCap
            );
          }
          cur = Math.max(cur, c1);
        }
        if (bayMaxU - cur > 1e-4) {
          emitClippedPolygon3D(
            revAcc,
            buildBayPlanPolygonAtY(yMax, 'sub', cur, bayMaxU),
            new THREE.Vector3(0, 1, 0),
            roofPlanes,
            uvHorizCap
          );
        }
      }

      const bayGroup = new THREE.Group();
      const baySuffix = bayCount > 1 ? `.bay_${bIdx}` : '';
      bayGroup.name = `${w.input.id}${baySuffix}`;
      bayGroup.userData.wallId = w.input.id;
      bayGroup.userData.isArchitecturalShell = true;
      if (w.input.zone) {
        bayGroup.userData.zoneId = w.input.zone;
      }

      const addAccMesh = (
        acc: GeometryAccumulator,
        mat: THREE.Material,
        partLabel: string
      ): void => {
        const geo = buildBufferGeometry(acc);
        if (!geo.getAttribute('position')) return;
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = `${bayGroup.name}.${partLabel}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.isArchitecturalShell = true;
        if (w.input.zone) {
          mesh.userData.zoneId = w.input.zone;
        }
        bayGroup.add(mesh);
      };

      addAccMesh(extAcc, extMat, 'outer');
      addAccMesh(intAcc, intMat, 'inner');
      addAccMesh(revAcc, revMat, 'reveals');

      if (bayGroup.children.length === 0) continue;

      if (w.kind === 'exterior') {
        const midOffset = (w.offsetOuter + w.offsetInner) * 0.5;
        const uBayMid0 = (uOuter0 + uInner0) * 0.5;
        const uBayMid1 = (uOuter1 + uInner1) * 0.5;
        const pA = toWorldUW(uBayMid0, wallBaseY, midOffset);
        const pB = toWorldUW(uBayMid1, wallBaseY, midOffset);
        const cornerPts = [
          toWorldUW(uOuter0, wallBaseY, w.offsetOuter),
          toWorldUW(uOuter1, wallBaseY, w.offsetOuter),
          toWorldUW(uInner0, wallBaseY, w.offsetInner),
          toWorldUW(uInner1, wallBaseY, w.offsetInner),
        ];

        const axis: 'x' | 'z' = Math.abs(w.tx) >= Math.abs(w.tz) ? 'z' : 'x';
        const coord = axis === 'z' ? (pA.z + pB.z) * 0.5 : (pA.x + pB.x) * 0.5;
        const spans = cornerPts.map((cp) => (axis === 'z' ? cp.x : cp.z));
        const desc: CutawayWallDescriptor = {
          axis,
          coord,
          minSpan: Math.min(...spans),
          maxSpan: Math.max(...spans),
          floor: options.floor,
          outwardSide: w.outwardSide,
          ...(w.input.includeInFirstFloorCutaway !== undefined
            ? { includeInFirstFloorCutaway: w.input.includeInFirstFloorCutaway }
            : {}),
        };
        tagCutaway(bayGroup, desc, { recursive: true });
        allCutaways.push(desc);
        wallCutaways.push(desc);
      }

      rootGroup.add(bayGroup);
      createdBayGroups.push(bayGroup);
    }

    wallBayGroupsByWallId.set(w.input.id, createdBayGroups);
    cutawaysByWallId.set(w.input.id, wallCutaways);
  };

  for (const w of preparedWalls) {
    buildSingleWallGeometry(w);
  }

  const getWallCutaway = (
    wallId: string,
    alongOffsetM?: number
  ): CutawayWallDescriptor | undefined => {
    const list = cutawaysByWallId.get(wallId);
    if (!list || list.length === 0) return undefined;
    if (alongOffsetM === undefined || list.length === 1) return list[0];

    const w = preparedWalls.find((pw) => pw.input.id === wallId);
    if (!w) return list[0];
    const worldPt: [number, number] = [
      w.from[0] + w.tx * alongOffsetM,
      w.from[1] + w.tz * alongOffsetM,
    ];
    for (const desc of list) {
      const spanCoord = desc.axis === 'z' ? worldPt[0] : worldPt[1];
      if (spanCoord >= desc.minSpan - 1e-3 && spanCoord <= desc.maxSpan + 1e-3) {
        return desc;
      }
    }
    return list[list.length - 1];
  };

  // Helper to compute clear unobstructed face span [uMin, uMax] around uCenter on inner (-outwardNormal) or outer (+outwardNormal) face,
  // accounting for mitered L-corners and perpendicular T-junction partitions!
  const computeFaceClearSpan = (
    w: PreparedWall,
    faceIsInner: boolean,
    uCenter: number
  ): readonly [number, number] => {
    const sTrim = startTrims.get(w.idx)!;
    const eTrim = endTrims.get(w.idx)!;
    let uMin = faceIsInner ? sTrim.uInner : sTrim.uOuter;
    let uMax = faceIsInner ? eTrim.uInner : eTrim.uOuter;

    const faceNormalSign = faceIsInner ? -1 : 1;
    const faceOffset = faceIsInner ? w.offsetInner : w.offsetOuter;

    // Check any perpendicular walls intersecting or abutting this face
    for (const other of preparedWalls) {
      if (other.idx === w.idx) continue;
      const cross = Math.abs(w.tx * other.tz - w.tz * other.tx);
      if (cross < 0.25) continue;

      for (const end of [0, 1] as const) {
        const pt = end === 0 ? other.from : other.to;
        const dirIntoOther: [number, number] =
          end === 0 ? [other.tx, other.tz] : [-other.tx, -other.tz];
        // Does `other` extend onto this side of `w`?
        const dotSide =
          dirIntoOther[0] * w.outwardNormal[0] * faceNormalSign +
          dirIntoOther[1] * w.outwardNormal[1] * faceNormalSign;
        if (dotSide <= 0.2) continue;

        const signedN =
          (pt[0] - w.from[0]) * w.outwardNormal[0] + (pt[1] - w.from[1]) * w.outwardNormal[1];
        if (Math.abs(signedN - faceOffset) > w.input.thickness + 0.05) continue;

        const uHit = projectU(w, pt);
        if (uHit <= 1e-3 || uHit >= w.length - 1e-3) continue;
        const halfOtherT = (other.input.thickness * 0.5) / cross;
        const obs0 = uHit - halfOtherT;
        const obs1 = uHit + halfOtherT;
        if (obs1 <= uCenter && obs1 > uMin) {
          uMin = obs1;
        } else if (obs0 >= uCenter && obs0 < uMax) {
          uMax = obs0;
        }
      }
    }

    return [uMin, uMax];
  };

  const segments: BuiltWallSegment[] = [];
  const segmentsById = new Map<string, BuiltWallSegment>();
  const openingHostWalls = new Map<string, OpeningHostWallInfo>();

  for (const w of preparedWalls) {
    const wallBaseY = w.input.baseY ?? defaultBaseY;
    const wallHeight = w.input.height ?? defaultHeight;
    const sTrim = startTrims.get(w.idx)!;
    const eTrim = endTrims.get(w.idx)!;

    const getFace = (side: WallFaceSide = 'interior', alongM?: number): WallFaceFrame => {
      // Geometric left/right of `from -> to`:
      // nLeft = [tz, -tx], nRight = [-tz, tx].
      // Compare with w.outwardNormal:
      const nLeft: [number, number] = [w.tz, -w.tx];
      const dotOutLeft = w.outwardNormal[0] * nLeft[0] + w.outwardNormal[1] * nLeft[1];
      const outwardIsLeft = dotOutLeft >= 0;

      let useInnerFace: boolean;
      if (side === 'interior') {
        useInnerFace = true;
      } else if (side === 'exterior') {
        useInnerFace = false;
      } else if (side === 'left') {
        useInnerFace = !outwardIsLeft;
      } else {
        // side === 'right'
        useInnerFace = outwardIsLeft;
      }

      const u0 = useInnerFace ? sTrim.uInner : sTrim.uOuter;
      const u1 = useInnerFace ? eTrim.uInner : eTrim.uOuter;
      const wOff = useInnerFace ? w.offsetInner : w.offsetOuter;
      const nx = useInnerFace ? -w.outwardNormal[0] : w.outwardNormal[0];
      const nz = useInnerFace ? -w.outwardNormal[1] : w.outwardNormal[1];

      // Walk originXZ -> toXZ so looking at the face from the room (along -normal) or keeping w.from -> w.to order:
      // Keeping `originXZ` at `u0` (near `from`) and `toXZ` at `u1` (near `to`) makes `alongM` match `from -> to` intuitively!
      const originXZ: Point2D = [
        w.from[0] + w.tx * u0 + w.outwardNormal[0] * wOff,
        w.from[1] + w.tz * u0 + w.outwardNormal[1] * wOff,
      ];
      const toXZ: Point2D = [
        w.from[0] + w.tx * u1 + w.outwardNormal[0] * wOff,
        w.from[1] + w.tz * u1 + w.outwardNormal[1] * wOff,
      ];

      const centerlineU = alongM !== undefined ? u0 + alongM : (u0 + u1) * 0.5;
      const cutaway =
        w.kind === 'exterior' ? (getWallCutaway(w.input.id, centerlineU) ?? null) : null;

      return createWallFaceFrame({
        originXZ,
        toXZ,
        normalXZ: [nx, nz],
        floorY: wallBaseY,
        ceilingHeight: wallHeight,
        cutaway,
      });
    };

    const seg: BuiltWallSegment = {
      id: w.input.id,
      kind: w.kind,
      from: [w.from[0], w.from[1]],
      to: [w.to[0], w.to[1]],
      lengthM: w.length,
      thickness: w.input.thickness,
      baseY: wallBaseY,
      height: wallHeight,
      outwardNormalXZ: [w.outwardNormal[0], w.outwardNormal[1]],
      ...(w.outwardSide ? { outwardSide: w.outwardSide } : {}),
      get cutaways(): readonly CutawayWallDescriptor[] {
        return cutawaysByWallId.get(w.input.id) ?? [];
      },
      getFace,
      mount<T extends THREE.Object3D>(target: T, mountOptions?: WallMountOptions): T {
        return placeOnWall(target, seg, mountOptions);
      },
    };

    segments.push(seg);
    segmentsById.set(w.input.id, seg);

    openingHostWalls.set(w.input.id, {
      id: w.input.id,
      kind: w.kind,
      from: [w.from[0], w.from[1]],
      to: [w.to[0], w.to[1]],
      length: w.length,
      tx: w.tx,
      tz: w.tz,
      outwardNormal: [w.outwardNormal[0], w.outwardNormal[1]],
      offsetOuter: w.offsetOuter,
      offsetInner: w.offsetInner,
      thickness: w.input.thickness,
      baseY: wallBaseY,
      height: wallHeight,
      ...(w.input.zone ? { zone: w.input.zone } : {}),
      innerFaceClearSpanAt: (uCenter: number) => computeFaceClearSpan(w, true, uCenter),
      outerFaceClearSpanAt: (uCenter: number) => computeFaceClearSpan(w, false, uCenter),
    });
  }

  const builtOpeningsList: BuiltWallOpening[] = [];
  const skirtingGapsList: SkirtingGap[] = [];
  const dadoGapsList: SkirtingGap[] = [];

  const network: BuiltWallNetwork = {
    group: rootGroup,
    cutaways: allCutaways,
    cutawaysByWallId,
    getWallCutaway,
    interiorPolygonXZ,
    segments,
    segmentsById,
    getSegment(wallId: string): BuiltWallSegment | undefined {
      return segmentsById.get(wallId);
    },
    mount<T extends THREE.Object3D>(
      wallId: string,
      target: T,
      mountOptions?: WallMountOptions
    ): T {
      const seg = segmentsById.get(wallId);
      if (!seg) {
        throw new Error(`BuiltWallNetwork.mount: unknown wallId '${wallId}'.`);
      }
      return seg.mount(target, mountOptions);
    },
    openings: builtOpeningsList,
    skirtingGaps: skirtingGapsList,
    dadoGaps: dadoGapsList,
    _getOpeningHostWall(wallId: string): OpeningHostWallInfo | undefined {
      return openingHostWalls.get(wallId);
    },
    _ensureAperturesCut(requests: readonly ResolvedWallApertureRequest[]): void {
      const dirtyWallIds = new Set<string>();
      for (const req of requests) {
        const list = wallAperturesMap.get(req.wallId);
        if (!list) continue;
        const existingIdx = list.findIndex(
          (op) =>
            Math.abs(op.centerOffset - req.centerOffset) <= 1e-3 &&
            Math.abs(op.width - req.width) <= 1e-3 &&
            Math.abs(op.sillY - req.sillY) <= 1e-3 &&
            Math.abs(op.height - req.height) <= 1e-3
        );
        if (existingIdx >= 0) {
          const ex = list[existingIdx]!;
          if (Boolean(ex.suppressRawReveals) !== req.suppressRawReveals) {
            list[existingIdx] = {
              ...ex,
              suppressRawReveals: req.suppressRawReveals,
            };
            dirtyWallIds.add(req.wallId);
          }
        } else {
          list.push({
            id: req.id,
            centerOffset: req.centerOffset,
            width: req.width,
            sillY: req.sillY,
            height: req.height,
            ...(req.archRiseM !== undefined ? { archRiseM: req.archRiseM } : {}),
            suppressRawReveals: req.suppressRawReveals,
          });
          dirtyWallIds.add(req.wallId);
        }
      }
      for (const wallId of dirtyWallIds) {
        const pw = preparedWalls.find((w) => w.input.id === wallId);
        if (pw) {
          buildSingleWallGeometry(pw);
        }
      }
    },
    _registerBuiltOpenings(
      built: readonly BuiltWallOpening[],
      skirtingGaps: readonly SkirtingGap[],
      dadoGaps: readonly SkirtingGap[]
    ): void {
      builtOpeningsList.push(...built);
      skirtingGapsList.push(...skirtingGaps);
      dadoGapsList.push(...dadoGaps);
    },
  };

  if (initialRichSpecs.length > 0) {
    populateWallOpenings(options.ctx ?? options.interactions ?? null, network, initialRichSpecs);
  }

  return network;
}

function insetPolygon2D(
  rawPoly: readonly Point2DInput[],
  insetM: number
): [number, number][] {
  const ring = rawPoly.map(toPoint2D);
  if (ring.length < 3) return [];
  if (computeSignedPolygonArea2D(ring) < 0) {
    ring.reverse();
  }
  if (Math.abs(insetM) <= 1e-8) {
    return ring;
  }

  const n = ring.length;
  const offsetLines: Line2D[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = ring[i]!;
    const p1 = ring[(i + 1) % n]!;
    const dx = p1[0] - p0[0];
    const dz = p1[1] - p0[1];
    const len = Math.hypot(dx, dz);
    if (len <= 1e-8) continue;
    const tx = dx / len;
    const tz = dz / len;
    // For computeSignedPolygonArea2D(ring) > 0, inward normal is [-tz, tx]
    const inX = -tz;
    const inZ = tx;
    offsetLines.push({
      px: p0[0] + inX * insetM,
      pz: p0[1] + inZ * insetM,
      dx: tx,
      dz: tz,
    });
  }

  if (offsetLines.length < 3) return [];
  const out: [number, number][] = [];
  const m = offsetLines.length;
  const maxMiter = Math.max(0.05, Math.abs(insetM) * MAX_MITER_RATIO);
  for (let i = 0; i < m; i++) {
    const prev = offsetLines[(i + m - 1) % m]!;
    const curr = offsetLines[i]!;
    out.push(intersectLines2D(prev, curr, [curr.px, curr.pz], maxMiter));
  }
  return out;
}

function pointStrictlyInsidePolygon2D(
  px: number,
  py: number,
  ring: readonly [number, number][],
  eps = 1e-5
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
      const dist = Math.hypot(px - (xi + t * dx), py - (yi + t * dy));
      if (dist <= eps) return false;
    }
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function segmentsProperlyOrOnEdgeIntersect(
  a0: readonly [number, number],
  a1: readonly [number, number],
  b0: readonly [number, number],
  b1: readonly [number, number],
  eps = 1e-6
): boolean {
  const minAx = Math.min(a0[0], a1[0]) - eps;
  const maxAx = Math.max(a0[0], a1[0]) + eps;
  const minAy = Math.min(a0[1], a1[1]) - eps;
  const maxAy = Math.max(a0[1], a1[1]) + eps;
  const minBx = Math.min(b0[0], b1[0]) - eps;
  const maxBx = Math.max(b0[0], b1[0]) + eps;
  const minBy = Math.min(b0[1], b1[1]) - eps;
  const maxBy = Math.max(b0[1], b1[1]) + eps;
  if (maxAx < minBx || maxBx < minAx || maxAy < minBy || maxBy < minAy) return false;

  const dax = a1[0] - a0[0];
  const day = a1[1] - a0[1];
  const dbx = b1[0] - b0[0];
  const dby = b1[1] - b0[1];
  const det = dax * dby - day * dbx;
  if (Math.abs(det) <= 1e-10) return false;
  const rx = b0[0] - a0[0];
  const ry = b0[1] - a0[1];
  const t = (rx * dby - ry * dbx) / det;
  const u = (rx * day - ry * dax) / det;
  return t >= -eps && t <= 1 + eps && u >= -eps && u <= 1 + eps;
}

function isConvexPolygonCCW(ring: readonly [number, number][]): boolean {
  const n = ring.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    const c = ring[(i + 2) % n]!;
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cross < -1e-7) return false;
  }
  return true;
}

interface SlabRegion2D {
  readonly outer: [number, number][];
  readonly holes: [number, number][][];
}

function subtractConvexVoidFromRegion(
  region: SlabRegion2D,
  convexVoidCCW: readonly [number, number][]
): SlabRegion2D[] {
  // Partition space outside convexVoidCCW into disjoint convex cells using the void's edge half-planes
  const m = convexVoidCCW.length;
  const outsideHalfPlanes: HalfPlane2D[] = [];
  const insideHalfPlanes: HalfPlane2D[] = [];

  for (let i = 0; i < m; i++) {
    const p0 = convexVoidCCW[i]!;
    const p1 = convexVoidCCW[(i + 1) % m]!;
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const len = Math.hypot(dx, dy);
    if (len <= 1e-8) continue;
    // Outward normal of CCW polygon in (x, y) is [dy / len, -dx / len]
    const outNx = dy / len;
    const outNy = -dx / len;
    const outC = -(outNx * p0[0] + outNy * p0[1]);
    outsideHalfPlanes.push({ nx: outNx, ny: outNy, constant: outC });
    insideHalfPlanes.push({ nx: -outNx, ny: -outNy, constant: -outC });
  }

  const outRegions: SlabRegion2D[] = [];
  const accumulatedInside: HalfPlane2D[] = [];

  for (let i = 0; i < outsideHalfPlanes.length; i++) {
    const cellPlanes = [...accumulatedInside, outsideHalfPlanes[i]!];
    const clipped = clipProfileToPlanes(
      { outer: region.outer, holes: region.holes },
      cellPlanes
    );
    if (clipped.outer.length >= 3) {
      outRegions.push({ outer: clipped.outer, holes: clipped.holes });
    }
    accumulatedInside.push(insideHalfPlanes[i]!);
  }

  return outRegions;
}

function resolveSlabRegions(
  outerRing: [number, number][],
  rawVoids: readonly (readonly Point2DInput[])[]
): SlabRegion2D[] {
  const interiorHoles: [number, number][][] = [];
  const boundaryVoids: [number, number][][] = [];

  for (const rawVoid of rawVoids) {
    const vRing = rawVoid.map(toPoint2D);
    if (vRing.length < 3 || Math.abs(computeSignedPolygonArea2D(vRing)) <= 1e-10) continue;
    if (computeSignedPolygonArea2D(vRing) < 0) vRing.reverse();

    let strictlyInside = vRing.every(([vx, vy]) =>
      pointStrictlyInsidePolygon2D(vx, vy, outerRing, 1e-4)
    );
    if (strictlyInside) {
      for (let i = 0; i < vRing.length && strictlyInside; i++) {
        const a0 = vRing[i]!;
        const a1 = vRing[(i + 1) % vRing.length]!;
        for (let j = 0; j < outerRing.length; j++) {
          const b0 = outerRing[j]!;
          const b1 = outerRing[(j + 1) % outerRing.length]!;
          if (segmentsProperlyOrOnEdgeIntersect(a0, a1, b0, b1)) {
            strictlyInside = false;
            break;
          }
        }
      }
    }

    if (strictlyInside) {
      const cwHole = [...vRing].reverse();
      interiorHoles.push(cwHole);
    } else {
      boundaryVoids.push(vRing);
    }
  }

  let regions: SlabRegion2D[] = [{ outer: outerRing, holes: interiorHoles }];
  for (const bVoid of boundaryVoids) {
    if (isConvexPolygonCCW(bVoid)) {
      regions = regions.flatMap((reg) => subtractConvexVoidFromRegion(reg, bVoid));
    } else {
      // Triangulate non-convex boundary void into convex triangles and subtract sequentially
      const v2 = bVoid.map(([x, y]) => new THREE.Vector2(x, y));
      const tris = THREE.ShapeUtils.triangulateShape(v2, []);
      for (const [i0, i1, i2] of tris) {
        const triPoly: [number, number][] = [
          [v2[i0]!.x, v2[i0]!.y],
          [v2[i1]!.x, v2[i1]!.y],
          [v2[i2]!.x, v2[i2]!.y],
        ];
        if (computeSignedPolygonArea2D(triPoly) < 0) triPoly.reverse();
        if (Math.abs(computeSignedPolygonArea2D(triPoly)) > 1e-10) {
          regions = regions.flatMap((reg) => subtractConvexVoidFromRegion(reg, triPoly));
        }
      }
    }
  }

  return regions;
}

function mergeGeometries(geos: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  const valid = geos.filter((g) => {
    const pos = g.getAttribute('position');
    return Boolean(pos && pos.count > 0);
  });
  if (valid.length === 0) return new THREE.BufferGeometry();
  if (valid.length === 1) return valid[0]!;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (const g of valid) {
    const pos = g.getAttribute('position');
    const norm = g.getAttribute('normal');
    const uv = g.getAttribute('uv');
    const idx = g.getIndex();
    const base = positions.length / 3;

    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (norm) {
        normals.push(norm.getX(i), norm.getY(i), norm.getZ(i));
      } else {
        normals.push(0, 1, 0);
      }
      if (uv) {
        uvs.push(uv.getX(i), uv.getY(i));
      } else {
        uvs.push(0, 0);
      }
    }

    if (idx) {
      for (let i = 0; i < idx.count; i++) {
        indices.push(base + idx.getX(i));
      }
    } else {
      for (let i = 0; i < pos.count; i++) {
        indices.push(base + i);
      }
    }
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  out.setIndex(indices);
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

function extrudeSlabLayer(
  regions: readonly SlabRegion2D[],
  yMin: number,
  yMax: number
): THREE.BufferGeometry {
  if (yMax - yMin <= 1e-6 || regions.length === 0) {
    return new THREE.BufferGeometry();
  }
  const geos = regions.map((reg) => {
    const g = extrudePlanarSolidWithHoles({
      outer: reg.outer,
      holes: reg.holes,
      depthRange: [yMin, yMax],
      origin: [0, 0, 0],
      uAxis: [1, 0, 0],
      vAxis: [0, 0, 1],
      wAxis: [0, 1, 0],
      uvScale: 1,
    });
    return projectWorldBoxUVs(g);
  });
  return mergeGeometries(geos);
}

/**
 * Builds a layered floor slab (`+Y` finished floor, optional separated structural deck,
 * and `-Y` plaster ceiling soffit) trimmed flush to `wallNetwork.interiorPolygonXZ` or `polygon`
 * with `0.5 mm` anti-z-fighting clearances, stairwell `voids` subtraction, and `1 UV = 1 m` world UVs.
 */
export function createFloorSlab(options: CreateFloorSlabOptions): FloorSlabResult {
  const sourcePoly = options.polygon ?? options.wallNetwork?.interiorPolygonXZ;
  if (!sourcePoly || sourcePoly.length < 3) {
    throw new Error(
      'createFloorSlab: requires either options.polygon (>= 3 points) or options.wallNetwork with a closed exterior loop.'
    );
  }

  const insetM = options.insetM ?? LAYER_CLEARANCE_M;
  const elevationY = options.elevationY;
  const thickness = options.thickness ?? 0.22;
  const finishThickness = options.finishThickness ?? 0.02;
  const ceilingThickness = options.ceilingThickness ?? 0.015;
  const baseName = options.name ?? (options.zone ? `slab.${options.zone}` : 'floorSlab');

  const insetOuter = insetPolygon2D(sourcePoly, insetM);
  const regions = resolveSlabRegions(insetOuter, options.voids ?? []);

  const slabGroup = new THREE.Group();
  slabGroup.name = baseName;
  slabGroup.userData.isArchitecturalShell = true;
  if (options.zone) {
    slabGroup.userData.zoneId = options.zone;
  }

  // +Y finished floor layer: [elevationY - finishThickness, elevationY]
  const finishY0 = elevationY - finishThickness;
  const finishY1 = elevationY;
  const finishGeo = extrudeSlabLayer(regions, finishY0, finishY1);
  const finishMesh = new THREE.Mesh(finishGeo, options.floorMaterial);
  finishMesh.name = `${baseName}.finish`;
  finishMesh.receiveShadow = true;
  finishMesh.castShadow = true;
  finishMesh.userData.isArchitecturalShell = true;
  if (options.zone) {
    finishMesh.userData.zoneId = options.zone;
  }
  tagCollisionRole(finishMesh, 'solidPlane');
  slabGroup.add(finishMesh);

  // Structural deck/core layer separated by 0.5 mm from both finish and ceiling soffit
  let deckMesh: THREE.Mesh | undefined;
  const hasVoids = Boolean(options.voids && options.voids.length > 0);
  const deckY0 = elevationY - thickness + ceilingThickness + LAYER_CLEARANCE_M;
  const deckY1 = elevationY - finishThickness - LAYER_CLEARANCE_M;
  if ((options.deckMaterial || hasVoids) && deckY1 - deckY0 > 1e-4) {
    const deckGeo = extrudeSlabLayer(regions, deckY0, deckY1);
    deckMesh = new THREE.Mesh(deckGeo, options.deckMaterial ?? options.floorMaterial);
    deckMesh.name = `${baseName}.deck`;
    deckMesh.castShadow = true;
    deckMesh.receiveShadow = true;
    deckMesh.userData.isArchitecturalShell = true;
    if (options.zone) {
      deckMesh.userData.zoneId = options.zone;
    }
    slabGroup.add(deckMesh);
  }

  // -Y plaster ceiling soffit layer: [elevationY - thickness, elevationY - thickness + ceilingThickness]
  let ceilingMesh: THREE.Mesh | null = null;
  if (ceilingThickness > 1e-6) {
    const ceilY0 = elevationY - thickness;
    const ceilY1 = elevationY - thickness + ceilingThickness;
    const ceilGeo = extrudeSlabLayer(regions, ceilY0, ceilY1);
    ceilingMesh = new THREE.Mesh(
      ceilGeo,
      options.ceilingMaterial ?? getDefaultCeilingMaterial()
    );
    ceilingMesh.name = `${baseName}.ceiling`;
    ceilingMesh.receiveShadow = true;
    ceilingMesh.castShadow = false;
    ceilingMesh.userData.isArchitecturalShell = true;
    if (options.zone) {
      ceilingMesh.userData.zoneId = options.zone;
    }

    if (options.lowerFloor?.ceilingGroup) {
      options.lowerFloor.ceilingGroup.add(ceilingMesh);
    } else {
      slabGroup.add(ceilingMesh);
    }
  }

  if (options.floor?.slabGroup) {
    options.floor.slabGroup.add(slabGroup);
  }

  const bounds = new THREE.Box3();
  bounds.expandByObject(slabGroup);
  if (ceilingMesh && ceilingMesh.parent !== slabGroup) {
    bounds.expandByObject(ceilingMesh);
  }

  return {
    slabGroup,
    ceilingMesh,
    finishMesh,
    ...(deckMesh ? { deckMesh } : {}),
    bounds,
  };
}

function resolveRoofFootprint(options: BaseRoofBuildOptions): RoofFootprintBounds {
  const fp = options.footprint;
  if (fp && 'minX' in fp) {
    return {
      minX: fp.minX,
      maxX: fp.maxX,
      minZ: fp.minZ,
      maxZ: fp.maxZ,
    };
  }
  if (
    options.minX !== undefined &&
    options.maxX !== undefined &&
    options.minZ !== undefined &&
    options.maxZ !== undefined
  ) {
    return {
      minX: options.minX,
      maxX: options.maxX,
      minZ: options.minZ,
      maxZ: options.maxZ,
    };
  }

  const dims = fp && 'width' in fp ? fp : options;
  if (dims.width !== undefined && dims.depth !== undefined) {
    const cx = dims.centerXZ?.[0] ?? 0;
    const cz = dims.centerXZ?.[1] ?? 0;
    return {
      minX: cx - dims.width * 0.5,
      maxX: cx + dims.width * 0.5,
      minZ: cz - dims.depth * 0.5,
      maxZ: cz + dims.depth * 0.5,
    };
  }

  throw new Error(
    'Roof builder requires either { minX, maxX, minZ, maxZ } or { width, depth, centerXZ? }.'
  );
}

interface RoofSlopeSpec {
  readonly id: string;
  readonly uOutX: number;
  readonly uOutZ: number;
  readonly eavesWallCoord: number;
  readonly verticalClipPlanes: readonly HalfPlane3D[];
  readonly eavesOuterEdge: readonly [readonly [number, number], readonly [number, number]];
  readonly vergeEdges?: readonly (readonly [readonly [number, number], readonly [number, number]])[];
}

function buildAnalyticalRoof(
  options: BaseRoofBuildOptions,
  hipped: boolean
): RoofBuildResult {
  const fp = resolveRoofFootprint(options);
  const spanX = fp.maxX - fp.minX;
  const spanZ = fp.maxZ - fp.minZ;
  if (spanX <= 1e-4 || spanZ <= 1e-4) {
    throw new Error('Roof footprint spans must be strictly positive.');
  }

  const cx = (fp.minX + fp.maxX) * 0.5;
  const cz = (fp.minZ + fp.maxZ) * 0.5;
  const ridgeAxis: 'x' | 'z' = options.ridgeAxis ?? (spanX >= spanZ ? 'x' : 'z');

  // For hipped roofs, ridge rises over min(spanX, spanZ)/2 when equal pitch on all 4 sides
  const halfSpan = hipped
    ? Math.min(spanX, spanZ) * 0.5
    : ridgeAxis === 'x'
      ? spanZ * 0.5
      : spanX * 0.5;

  let pitchRad: number;
  let ridgeY: number;
  if (options.ridgeY !== undefined) {
    ridgeY = options.ridgeY;
    pitchRad = Math.atan2(Math.max(0.01, ridgeY - options.eavesY), halfSpan);
  } else {
    const pitchDeg = options.pitchDeg ?? 35;
    pitchRad = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(pitchDeg, 2, 80));
    ridgeY = options.eavesY + halfSpan * Math.tan(pitchRad);
  }

  const tanPitch = Math.tan(pitchRad);
  const sinPitch = Math.sin(pitchRad);
  const cosPitch = Math.cos(pitchRad);

  const overhangM = options.overhangM ?? 0.25;
  const thickness = options.thickness ?? 0.18;
  const liningThickness = options.liningThickness ?? 0.015;

  const verticalThickness = thickness / cosPitch;
  const verticalLining = liningThickness > 0 ? liningThickness / cosPitch : 0;
  const verticalClearance = LAYER_CLEARANCE_M / cosPitch;

  const ox0 = fp.minX - overhangM;
  const ox1 = fp.maxX + overhangM;
  const oz0 = fp.minZ - overhangM;
  const oz1 = fp.maxZ + overhangM;

  const slopes: RoofSlopeSpec[] = [];

  if (!hipped) {
    if (ridgeAxis === 'x') {
      // North (-Z) and South (+Z) slopes meeting at vertical ridge miter plane z = cz
      slopes.push({
        id: 'north',
        uOutX: 0,
        uOutZ: -1,
        eavesWallCoord: -fp.minZ,
        verticalClipPlanes: [
          { normal: [0, 0, -1], constant: cz },
          { normal: [0, 0, 1], constant: -oz0 },
          { normal: [1, 0, 0], constant: -ox0 },
          { normal: [-1, 0, 0], constant: ox1 },
        ],
        eavesOuterEdge: [
          [ox1, oz0],
          [ox0, oz0],
        ],
        vergeEdges: [
          [
            [ox0, oz0],
            [ox0, cz],
          ],
          [
            [ox1, cz],
            [ox1, oz0],
          ],
        ],
      });
      slopes.push({
        id: 'south',
        uOutX: 0,
        uOutZ: 1,
        eavesWallCoord: fp.maxZ,
        verticalClipPlanes: [
          { normal: [0, 0, 1], constant: -cz },
          { normal: [0, 0, -1], constant: oz1 },
          { normal: [1, 0, 0], constant: -ox0 },
          { normal: [-1, 0, 0], constant: ox1 },
        ],
        eavesOuterEdge: [
          [ox0, oz1],
          [ox1, oz1],
        ],
        vergeEdges: [
          [
            [ox0, cz],
            [ox0, oz1],
          ],
          [
            [ox1, oz1],
            [ox1, cz],
          ],
        ],
      });
    } else {
      // West (-X) and East (+X) slopes meeting at vertical ridge miter plane x = cx
      slopes.push({
        id: 'west',
        uOutX: -1,
        uOutZ: 0,
        eavesWallCoord: -fp.minX,
        verticalClipPlanes: [
          { normal: [-1, 0, 0], constant: cx },
          { normal: [1, 0, 0], constant: -ox0 },
          { normal: [0, 0, 1], constant: -oz0 },
          { normal: [0, 0, -1], constant: oz1 },
        ],
        eavesOuterEdge: [
          [ox0, oz0],
          [ox0, oz1],
        ],
        vergeEdges: [
          [
            [cx, oz0],
            [ox0, oz0],
          ],
          [
            [ox0, oz1],
            [cx, oz1],
          ],
        ],
      });
      slopes.push({
        id: 'east',
        uOutX: 1,
        uOutZ: 0,
        eavesWallCoord: fp.maxX,
        verticalClipPlanes: [
          { normal: [1, 0, 0], constant: -cx },
          { normal: [-1, 0, 0], constant: ox1 },
          { normal: [0, 0, 1], constant: -oz0 },
          { normal: [0, 0, -1], constant: oz1 },
        ],
        eavesOuterEdge: [
          [ox1, oz1],
          [ox1, oz0],
        ],
        vergeEdges: [
          [
            [ox1, oz0],
            [cx, oz0],
          ],
          [
            [cx, oz1],
            [ox1, oz1],
          ],
        ],
      });
    }
  } else {
    // 4-sided hipped roof clipped against exact 45-degree corner hip bisectors and ridge plane
    slopes.push({
      id: 'north',
      uOutX: 0,
      uOutZ: -1,
      eavesWallCoord: -fp.minZ,
      verticalClipPlanes: [
        { normal: [0, 0, 1], constant: -oz0 },
        { normal: [0, 0, -1], constant: cz },
        // z - minZ <= x - minX  =>  x - z + (minZ - minX) >= 0
        { normal: [1, 0, -1], constant: fp.minZ - fp.minX },
        // z - minZ <= maxX - x  =>  -x - z + (maxX + minZ) >= 0
        { normal: [-1, 0, -1], constant: fp.maxX + fp.minZ },
      ],
      eavesOuterEdge: [
        [ox1, oz0],
        [ox0, oz0],
      ],
    });
    slopes.push({
      id: 'south',
      uOutX: 0,
      uOutZ: 1,
      eavesWallCoord: fp.maxZ,
      verticalClipPlanes: [
        { normal: [0, 0, -1], constant: oz1 },
        { normal: [0, 0, 1], constant: -cz },
        // maxZ - z <= x - minX  =>  x + z - (minX + maxZ) >= 0
        { normal: [1, 0, 1], constant: -(fp.minX + fp.maxZ) },
        // maxZ - z <= maxX - x  =>  -x + z + (maxX - maxZ) >= 0
        { normal: [-1, 0, 1], constant: fp.maxX - fp.maxZ },
      ],
      eavesOuterEdge: [
        [ox0, oz1],
        [ox1, oz1],
      ],
    });
    slopes.push({
      id: 'west',
      uOutX: -1,
      uOutZ: 0,
      eavesWallCoord: -fp.minX,
      verticalClipPlanes: [
        { normal: [1, 0, 0], constant: -ox0 },
        { normal: [-1, 0, 0], constant: cx },
        // x - minX <= z - minZ  =>  -x + z + (minX - minZ) >= 0
        { normal: [-1, 0, 1], constant: fp.minX - fp.minZ },
        // x - minX <= maxZ - z  =>  -x - z + (minX + maxZ) >= 0
        { normal: [-1, 0, -1], constant: fp.minX + fp.maxZ },
      ],
      eavesOuterEdge: [
        [ox0, oz0],
        [ox0, oz1],
      ],
    });
    slopes.push({
      id: 'east',
      uOutX: 1,
      uOutZ: 0,
      eavesWallCoord: fp.maxX,
      verticalClipPlanes: [
        { normal: [-1, 0, 0], constant: ox1 },
        { normal: [1, 0, 0], constant: -cx },
        // maxX - x <= z - minZ  =>  x + z - (maxX + minZ) >= 0
        { normal: [1, 0, 1], constant: -(fp.maxX + fp.minZ) },
        // maxX - x <= maxZ - z  =>  x - z + (maxZ - maxX) >= 0
        { normal: [1, 0, -1], constant: fp.maxZ - fp.maxX },
      ],
      eavesOuterEdge: [
        [ox1, oz1],
        [ox1, oz0],
      ],
    });
  }

  const outerAcc = createAccumulator();
  const innerAcc = createAccumulator();
  const fasciaAcc = createAccumulator();
  const soffitClipPlanes: HalfPlane3D[] = [];

  const interiorClipPlanes: HalfPlane3D[] = [
    { normal: [1, 0, 0], constant: -(fp.minX + LAYER_CLEARANCE_M) },
    { normal: [-1, 0, 0], constant: fp.maxX - LAYER_CLEARANCE_M },
    { normal: [0, 0, 1], constant: -(fp.minZ + LAYER_CLEARANCE_M) },
    { normal: [0, 0, -1], constant: fp.maxZ - LAYER_CLEARANCE_M },
  ];

  // Large bounding XZ quad covering the entire roof footprint + overhang prior to analytical plane clipping
  const bx0 = ox0 - 1;
  const bx1 = ox1 + 1;
  const bz0 = oz0 - 1;
  const bz1 = oz1 + 1;

  for (const slope of slopes) {
    // Signed outward distance past the nominal wall eaves line:
    // dWall(x, z) = uOut · [x, z] - eavesWallCoord  (0 at nominal wall line, < 0 inside, > 0 on overhang)
    const evalOuterY = (x: number, z: number): number => {
      const dWall = slope.uOutX * x + slope.uOutZ * z - slope.eavesWallCoord;
      return options.eavesY - dWall * tanPitch;
    };

    const slopeOutNormal = new THREE.Vector3(
      slope.uOutX * sinPitch,
      cosPitch,
      slope.uOutZ * sinPitch
    ).normalize();
    const slopeInNormal = slopeOutNormal.clone().negate();

    // Tangent basis on slope for 1 UV = 1 m world-metric UVs
    const eaveTangent = new THREE.Vector3(-slope.uOutZ, 0, slope.uOutX);
    const upSlopeTangent = new THREE.Vector3(
      -slope.uOutX * cosPitch,
      sinPitch,
      -slope.uOutZ * cosPitch
    );
    const uvSlope = (p: THREE.Vector3): [number, number] => [
      p.dot(eaveTangent),
      p.dot(upSlopeTangent),
    ];

    const buildSlopeQuad = (deltaY: number): THREE.Vector3[] => [
      new THREE.Vector3(bx0, evalOuterY(bx0, bz0) + deltaY, bz0),
      new THREE.Vector3(bx0, evalOuterY(bx0, bz1) + deltaY, bz1),
      new THREE.Vector3(bx1, evalOuterY(bx1, bz1) + deltaY, bz1),
      new THREE.Vector3(bx1, evalOuterY(bx1, bz0) + deltaY, bz0),
    ];

    // Structural outer top face
    emitClippedPolygon3D(
      outerAcc,
      buildSlopeQuad(0),
      slopeOutNormal,
      slope.verticalClipPlanes,
      uvSlope
    );

    // Structural inner underside face (offset perpendicular by thickness)
    emitClippedPolygon3D(
      outerAcc,
      buildSlopeQuad(-verticalThickness),
      slopeInNormal,
      slope.verticalClipPlanes,
      uvSlope
    );

    // Eaves fascia board on outer overhang boundary
    const [e0, e1] = slope.eavesOuterEdge;
    const fasciaNormal = new THREE.Vector3(slope.uOutX, 0, slope.uOutZ);
    emitClippedPolygon3D(
      fasciaAcc,
      [
        new THREE.Vector3(e0[0], evalOuterY(e0[0], e0[1]) - verticalThickness, e0[1]),
        new THREE.Vector3(e1[0], evalOuterY(e1[0], e1[1]) - verticalThickness, e1[1]),
        new THREE.Vector3(e1[0], evalOuterY(e1[0], e1[1]), e1[1]),
        new THREE.Vector3(e0[0], evalOuterY(e0[0], e0[1]), e0[1]),
      ],
      fasciaNormal,
      slope.verticalClipPlanes,
      (p) => [p.dot(eaveTangent), p.y]
    );

    // Gable verge bargeboards on pitched roofs
    if (slope.vergeEdges) {
      for (const [v0, v1] of slope.vergeEdges) {
        const dx = v1[0] - v0[0];
        const dz = v1[1] - v0[1];
        const vergeOut = new THREE.Vector3(dz, 0, -dx).normalize();
        // Ensure vergeOut points outward from roof center
        const midX = (v0[0] + v1[0]) * 0.5 - cx;
        const midZ = (v0[1] + v1[1]) * 0.5 - cz;
        if (vergeOut.x * midX + vergeOut.z * midZ < 0) {
          vergeOut.negate();
        }
        emitClippedPolygon3D(
          fasciaAcc,
          [
            new THREE.Vector3(v0[0], evalOuterY(v0[0], v0[1]) - verticalThickness, v0[1]),
            new THREE.Vector3(v1[0], evalOuterY(v1[0], v1[1]) - verticalThickness, v1[1]),
            new THREE.Vector3(v1[0], evalOuterY(v1[0], v1[1]), v1[1]),
            new THREE.Vector3(v0[0], evalOuterY(v0[0], v0[1]), v0[1]),
          ],
          vergeOut,
          slope.verticalClipPlanes,
          (p) => [p.x * (dx !== 0 ? 1 : 0) + p.z * (dz !== 0 ? 1 : 0), p.y]
        );
      }
    }

    // Interior plasterboard skeiling lining (offset 0.5 mm perpendicular below structural inner plane, clipped to interior footprint)
    if (liningThickness > 1e-5) {
      const liningTopDelta = -verticalThickness - verticalClearance;
      const liningBotDelta = -verticalThickness - verticalClearance - verticalLining;
      const liningClips = [...slope.verticalClipPlanes, ...interiorClipPlanes];
      emitClippedPolygon3D(
        innerAcc,
        buildSlopeQuad(liningTopDelta),
        slopeOutNormal,
        liningClips,
        uvSlope
      );
      emitClippedPolygon3D(
        innerAcc,
        buildSlopeQuad(liningBotDelta),
        slopeInNormal,
        liningClips,
        uvSlope
      );
    }

    // Analytical underside HalfPlane3D (0.5 mm below lowest roof underside so clipped gable/attic walls never z-fight)
    const totalVerticalDrop =
      verticalThickness +
      (liningThickness > 1e-5 ? verticalLining + 2 * verticalClearance : verticalClearance);
    // Point on soffit clip plane at nominal wall eaves line:
    const refX = slope.uOutX !== 0 ? (slope.uOutX > 0 ? fp.maxX : fp.minX) : cx;
    const refZ = slope.uOutZ !== 0 ? (slope.uOutZ > 0 ? fp.maxZ : fp.minZ) : cz;
    const refY = options.eavesY - totalVerticalDrop;
    const plNormal: [number, number, number] = [
      slopeInNormal.x,
      slopeInNormal.y,
      slopeInNormal.z,
    ];
    const plConstant = -(
      plNormal[0] * refX +
      plNormal[1] * refY +
      plNormal[2] * refZ
    );
    soffitClipPlanes.push({
      normal: plNormal,
      constant: plConstant,
    });
  }

  const group = new THREE.Group();
  group.name = options.name ?? (hipped ? 'hippedRoof' : 'pitchedRoof');
  group.userData.isArchitecturalShell = true;

  const outerGeo = buildBufferGeometry(outerAcc);
  if (outerGeo.getAttribute('position')) {
    const outerMesh = new THREE.Mesh(outerGeo, options.outerMaterial);
    outerMesh.name = `${group.name}.slopes`;
    outerMesh.castShadow = true;
    outerMesh.receiveShadow = true;
    outerMesh.userData.isArchitecturalShell = true;
    group.add(outerMesh);
  }

  const fasciaGeo = buildBufferGeometry(fasciaAcc);
  if (fasciaGeo.getAttribute('position')) {
    const fasciaMesh = new THREE.Mesh(
      fasciaGeo,
      options.fasciaMaterial ?? options.outerMaterial
    );
    fasciaMesh.name = `${group.name}.fascia`;
    fasciaMesh.castShadow = true;
    fasciaMesh.receiveShadow = true;
    fasciaMesh.userData.isArchitecturalShell = true;
    group.add(fasciaMesh);
  }

  const innerGeo = buildBufferGeometry(innerAcc);
  if (innerGeo.getAttribute('position')) {
    const innerMesh = new THREE.Mesh(
      innerGeo,
      options.innerMaterial ?? getDefaultCeilingMaterial()
    );
    innerMesh.name = `${group.name}.lining`;
    innerMesh.castShadow = false;
    innerMesh.receiveShadow = true;
    innerMesh.userData.isArchitecturalShell = true;
    group.add(innerMesh);
  }

  // Optional ridge cap strip (+1 mm above outer slope planes so zero coplanar faces)
  if (options.ridgeCapMaterial) {
    const ridgeSpan = hipped ? Math.max(0, Math.abs(spanX - spanZ)) : ridgeAxis === 'x' ? spanX + 2 * overhangM : spanZ + 2 * overhangM;
    if (ridgeSpan > 0.02) {
      const capHalfW = 0.11;
      const capLift = 0.001;
      const capDrop = capHalfW * tanPitch;
      const capAcc = createAccumulator();
      if ((hipped && spanX >= spanZ) || (!hipped && ridgeAxis === 'x')) {
        const rx0 = hipped ? fp.minX + halfSpan : ox0;
        const rx1 = hipped ? fp.maxX - halfSpan : ox1;
        const apexY = ridgeY + capLift + 0.025;
        const skirtY = ridgeY - capDrop + capLift;
        emitConvexOrPlanarPolygon3D(
          capAcc,
          [
            new THREE.Vector3(rx0, apexY, cz),
            new THREE.Vector3(rx1, apexY, cz),
            new THREE.Vector3(rx1, skirtY, cz - capHalfW),
            new THREE.Vector3(rx0, skirtY, cz - capHalfW),
          ],
          new THREE.Vector3(0, cosPitch, -sinPitch),
          (p) => [p.x, p.z]
        );
        emitConvexOrPlanarPolygon3D(
          capAcc,
          [
            new THREE.Vector3(rx1, apexY, cz),
            new THREE.Vector3(rx0, apexY, cz),
            new THREE.Vector3(rx0, skirtY, cz + capHalfW),
            new THREE.Vector3(rx1, skirtY, cz + capHalfW),
          ],
          new THREE.Vector3(0, cosPitch, sinPitch),
          (p) => [p.x, p.z]
        );
      } else {
        const rz0 = hipped ? fp.minZ + halfSpan : oz0;
        const rz1 = hipped ? fp.maxZ - halfSpan : oz1;
        const apexY = ridgeY + capLift + 0.025;
        const skirtY = ridgeY - capDrop + capLift;
        emitConvexOrPlanarPolygon3D(
          capAcc,
          [
            new THREE.Vector3(cx, apexY, rz1),
            new THREE.Vector3(cx, apexY, rz0),
            new THREE.Vector3(cx - capHalfW, skirtY, rz0),
            new THREE.Vector3(cx - capHalfW, skirtY, rz1),
          ],
          new THREE.Vector3(-sinPitch, cosPitch, 0),
          (p) => [p.z, p.x]
        );
        emitConvexOrPlanarPolygon3D(
          capAcc,
          [
            new THREE.Vector3(cx, apexY, rz0),
            new THREE.Vector3(cx, apexY, rz1),
            new THREE.Vector3(cx + capHalfW, skirtY, rz1),
            new THREE.Vector3(cx + capHalfW, skirtY, rz0),
          ],
          new THREE.Vector3(sinPitch, cosPitch, 0),
          (p) => [p.z, p.x]
        );
      }
      const capGeo = buildBufferGeometry(capAcc);
      if (capGeo.getAttribute('position')) {
        const capMesh = new THREE.Mesh(capGeo, options.ridgeCapMaterial);
        capMesh.name = `${group.name}.ridgeCap`;
        capMesh.castShadow = true;
        capMesh.receiveShadow = true;
        capMesh.userData.isArchitecturalShell = true;
        group.add(capMesh);
      }
    }
  }

  return {
    group,
    ridgeY,
    soffitClipPlanes,
  };
}

/**
 * Builds an analytical gable pitched roof with perpendicular slope thickness, exact ridge miter
 * plane clipping, overhanging eaves fascia & verge bargeboards, `0.5 mm`-separated interior
 * plasterboard skeiling lining, and `soffitClipPlanes` for zero-poke-through gable wall clipping.
 */
export function createPitchedRoof(options: CreatePitchedRoofOptions): RoofBuildResult {
  return buildAnalyticalRoof(options, false);
}

/**
 * Builds an analytical 4-sided hipped roof clipped against exact `45°` diagonal hip bisector
 * planes and central ridge plane with zero penetrating or coplanar triangles.
 */
export function createHippedRoof(options: CreateHippedRoofOptions): RoofBuildResult {
  return buildAnalyticalRoof(options, true);
}
