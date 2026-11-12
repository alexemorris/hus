import * as THREE from 'three';

export interface DetectZFightingOptions {
  /** Maximum perpendicular plane-distance separation (metres) considered coplanar z-fighting. Default: `0.00035` (0.35 mm). */
  readonly epsilonM?: number;
  /** Minimum coplanar polygon intersection area (m²) to report (ignores pure edge/vertex touches). Default: `1e-4` (1.0 cm²). */
  readonly minOverlapAreaM2?: number;
  /** Minimum `|n1 · n2|` alignment to treat two planes as parallel/coplanar. Default: `0.999`. */
  readonly minNormalDot?: number;
  /** Skip invisible objects/ancestors (`!obj.visible`). Default: `true`. */
  readonly onlyVisible?: boolean;
  /** Optional predicate to skip specific meshes (e.g. intentional decals or custom exclusions). */
  readonly ignoreMesh?: (mesh: THREE.Mesh) => boolean;
  /** Maximum number of aggregated mesh-pair findings returned (sorted by `overlapAreaCm2` desc). Default: `200`. */
  readonly maxFindings?: number;
}

export interface ZFightingFinding {
  readonly meshA: string;
  readonly meshB: string;
  readonly objectA: THREE.Mesh;
  readonly objectB: THREE.Mesh;
  readonly materialA: string;
  readonly materialB: string;
  readonly normal: readonly [number, number, number];
  readonly planeDistanceDiffMm: number;
  readonly overlapAreaCm2: number;
  readonly centroid: readonly [number, number, number];
}

const DEFAULT_EPSILON_M = 0.00035;
const DEFAULT_MIN_OVERLAP_AREA_M2 = 1e-4;
const DEFAULT_MIN_NORMAL_DOT = 0.999;
const DEFAULT_MAX_FINDINGS = 200;
const DEGENERATE_TRIANGLE_AREA_M2 = 1e-8;
const MICRO_CLIP_AREA_M2 = 1e-8;
const POLYGON_OFFSET_THRESHOLD = 0.5;

interface SourceDescriptor {
  readonly sourceId: number;
  readonly entityId: number;
  readonly materialId: number;
  readonly mesh: THREE.Mesh;
  readonly instanceIndex: number;
  readonly material: THREE.Material;
  readonly isDoubleSide: boolean;
  readonly flipNormal: boolean;
  readonly offsetFactor: number;
  readonly offsetUnits: number;
}

interface AggregatedPair {
  readonly srcA: SourceDescriptor;
  readonly srcB: SourceDescriptor;
  totalAreaM2: number;
  weightedCx: number;
  weightedCy: number;
  weightedCz: number;
  weightedNx: number;
  weightedNy: number;
  weightedNz: number;
  minDistM: number;
}

class TriangleBuffer {
  public count = 0;
  public capacity: number;
  public sourceIds: Int32Array;
  public verts: Float64Array;
  public centroids: Float64Array;
  public normals: Float64Array;
  public canonNormals: Float64Array;

  public constructor(initialCapacity = 4096) {
    this.capacity = initialCapacity;
    this.sourceIds = new Int32Array(initialCapacity);
    this.verts = new Float64Array(initialCapacity * 9);
    this.centroids = new Float64Array(initialCapacity * 3);
    this.normals = new Float64Array(initialCapacity * 3);
    this.canonNormals = new Float64Array(initialCapacity * 3);
  }

  public ensureCapacity(needed: number): void {
    if (needed <= this.capacity) return;
    let nextCap = this.capacity;
    while (nextCap < needed) {
      nextCap *= 2;
    }
    const nextSourceIds = new Int32Array(nextCap);
    nextSourceIds.set(this.sourceIds);
    this.sourceIds = nextSourceIds;

    const nextVerts = new Float64Array(nextCap * 9);
    nextVerts.set(this.verts);
    this.verts = nextVerts;

    const nextCentroids = new Float64Array(nextCap * 3);
    nextCentroids.set(this.centroids);
    this.centroids = nextCentroids;

    const nextNormals = new Float64Array(nextCap * 3);
    nextNormals.set(this.normals);
    this.normals = nextNormals;

    const nextCanonNormals = new Float64Array(nextCap * 3);
    nextCanonNormals.set(this.canonNormals);
    this.canonNormals = nextCanonNormals;

    this.capacity = nextCap;
  }
}

class ProjectionWorkspace {
  public capacity = 0;
  public order = new Int32Array(0);
  public triIdx = new Int32Array(0);
  public primary = new Uint8Array(0);
  public nMin = new Float64Array(0);
  public nMax = new Float64Array(0);
  public uMin = new Float64Array(0);
  public uMax = new Float64Array(0);
  public vMin = new Float64Array(0);
  public vMax = new Float64Array(0);

  public ensureCapacity(needed: number): void {
    if (needed <= this.capacity) return;
    let nextCap = Math.max(256, this.capacity || 256);
    while (nextCap < needed) {
      nextCap *= 2;
    }
    this.capacity = nextCap;
    this.order = new Int32Array(nextCap);
    this.triIdx = new Int32Array(nextCap);
    this.primary = new Uint8Array(nextCap);
    this.nMin = new Float64Array(nextCap);
    this.nMax = new Float64Array(nextCap);
    this.uMin = new Float64Array(nextCap);
    this.uMax = new Float64Array(nextCap);
    this.vMin = new Float64Array(nextCap);
    this.vMax = new Float64Array(nextCap);
  }
}

function sortOrderByKey(
  order: Int32Array,
  keys: Float64Array,
  left: number,
  right: number
): void {
  if (right - left <= 1) return;

  const stackL = new Int32Array(64);
  const stackR = new Int32Array(64);
  let sp = 0;
  stackL[sp] = left;
  stackR[sp] = right;
  sp++;

  while (sp > 0) {
    sp--;
    let lo = stackL[sp];
    let hi = stackR[sp];

    while (hi - lo > 16) {
      const mid = (lo + hi) >> 1;
      const pivot = keys[order[mid]];
      let i = lo;
      let j = hi - 1;
      while (i <= j) {
        while (keys[order[i]] < pivot) i++;
        while (keys[order[j]] > pivot) j--;
        if (i <= j) {
          const tmp = order[i];
          order[i] = order[j];
          order[j] = tmp;
          i++;
          j--;
        }
      }
      if (j - lo < hi - i) {
        if (i < hi) {
          stackL[sp] = i;
          stackR[sp] = hi;
          sp++;
        }
        hi = j + 1;
      } else {
        if (lo <= j) {
          stackL[sp] = lo;
          stackR[sp] = j + 1;
          sp++;
        }
        lo = i;
      }
    }

    for (let i = lo + 1; i < hi; i++) {
      const val = order[i];
      const key = keys[val];
      let j = i - 1;
      while (j >= lo && keys[order[j]] > key) {
        order[j + 1] = order[j];
        j--;
      }
      order[j + 1] = val;
    }
  }
}

function isSkippedHelperUserData(userData: Record<string, unknown> | undefined): boolean {
  if (!userData) return false;
  return (
    userData.isCollisionOnly === true ||
    userData.isWalkthroughCollider === true ||
    userData.isShadowProxy === true ||
    userData.isLightCone === true ||
    userData.isGlowPool === true ||
    userData.isShadowPassHook === true ||
    userData.isMergedSourceMesh === true
  );
}

function isRenderableDepthMaterial(mat: THREE.Material | null | undefined): mat is THREE.Material {
  if (!mat) return false;
  if (!mat.visible) return false;
  if (mat.colorWrite === false) return false;
  if (mat.depthWrite === false) return false;
  if ((mat as THREE.MeshBasicMaterial).wireframe === true) return false;
  return true;
}

function formatMeshLabel(mesh: THREE.Mesh, root: THREE.Object3D, instanceIndex: number): string {
  const segments: string[] = [];
  let cur: THREE.Object3D | null = mesh;
  while (cur) {
    const trimmed = cur.name ? cur.name.trim() : '';
    if (trimmed.length > 0) {
      segments.push(trimmed);
    }
    if (cur === root) break;
    cur = cur.parent;
  }
  segments.reverse();
  const ownName = mesh.name ? mesh.name.trim() : '';
  if (ownName.length === 0) {
    segments.push(`Mesh(${mesh.uuid.slice(0, 8)})`);
  }
  const base = segments.join(' > ');
  return instanceIndex >= 0 ? `${base}#instance${instanceIndex}` : base;
}

function formatMaterialLabel(mat: THREE.Material): string {
  const trimmed = mat.name ? mat.name.trim() : '';
  return trimmed.length > 0 ? trimmed : `${mat.type}(${mat.uuid.slice(0, 8)})`;
}

function symmetricRound(value: number): number {
  return value >= 0 ? (value + 0.5) | 0 : -((-value + 0.5) | 0);
}

function packCanonicalCellKey(rx: number, ry: number, rz: number): number {
  if (rx < 0 || (rx === 0 && (ry < 0 || (ry === 0 && rz < 0)))) {
    rx = -rx;
    ry = -ry;
    rz = -rz;
  }
  return ((rx + 512) << 20) | ((ry + 512) << 10) | (rz + 512);
}

function unpackCellKey(key: number): readonly [number, number, number] {
  const qx = ((key >> 20) & 0x3ff) - 512;
  const qy = ((key >> 10) & 0x3ff) - 512;
  const qz = (key & 0x3ff) - 512;
  return [qx, qy, qz];
}

const CLIP_POLY_A = new Float64Array(16);
const CLIP_POLY_B = new Float64Array(16);
const CLIP_EDGES = new Float64Array(12);
const CLIP_RESULT = { area: 0, cu: 0, cv: 0 };

/**
 * Clips 2D triangle B against CCW 2D triangle A using Sutherland–Hodgman in zero-allocation
 * scratch buffers and populates `CLIP_RESULT` with exact clipped area and 2D centroid.
 */
function clipTriangles2D(
  au0: number,
  av0: number,
  au1: number,
  av1: number,
  au2: number,
  av2: number,
  bu0: number,
  bv0: number,
  bu1: number,
  bv1: number,
  bu2: number,
  bv2: number
): boolean {
  const area2A = (au1 - au0) * (av2 - av0) - (av1 - av0) * (au2 - au0);
  if (Math.abs(area2A) < 2 * MICRO_CLIP_AREA_M2) return false;
  if (area2A < 0) {
    const tu = au1;
    const tv = av1;
    au1 = au2;
    av1 = av2;
    au2 = tu;
    av2 = tv;
  }

  const area2B = (bu1 - bu0) * (bv2 - bv0) - (bv1 - bv0) * (bu2 - bu0);
  if (Math.abs(area2B) < 2 * MICRO_CLIP_AREA_M2) return false;
  if (area2B < 0) {
    const tu = bu1;
    const tv = bv1;
    bu1 = bu2;
    bv1 = bv2;
    bu2 = tu;
    bv2 = tv;
  }

  CLIP_EDGES[0] = au0;
  CLIP_EDGES[1] = av0;
  CLIP_EDGES[2] = au1;
  CLIP_EDGES[3] = av1;
  CLIP_EDGES[4] = au1;
  CLIP_EDGES[5] = av1;
  CLIP_EDGES[6] = au2;
  CLIP_EDGES[7] = av2;
  CLIP_EDGES[8] = au2;
  CLIP_EDGES[9] = av2;
  CLIP_EDGES[10] = au0;
  CLIP_EDGES[11] = av0;

  let srcPoly = CLIP_POLY_A;
  let dstPoly = CLIP_POLY_B;
  srcPoly[0] = bu0;
  srcPoly[1] = bv0;
  srcPoly[2] = bu1;
  srcPoly[3] = bv1;
  srcPoly[4] = bu2;
  srcPoly[5] = bv2;
  let vertCount = 3;

  const insideEps = -1e-12;

  for (let e = 0; e < 12; e += 4) {
    const ex0 = CLIP_EDGES[e];
    const ey0 = CLIP_EDGES[e + 1];
    const edx = CLIP_EDGES[e + 2] - ex0;
    const edy = CLIP_EDGES[e + 3] - ey0;

    let nextCount = 0;
    let prevU = srcPoly[(vertCount - 1) * 2];
    let prevV = srcPoly[(vertCount - 1) * 2 + 1];
    let prevDist = edx * (prevV - ey0) - edy * (prevU - ex0);
    let prevInside = prevDist >= insideEps;

    for (let i = 0; i < vertCount; i++) {
      const currU = srcPoly[i * 2];
      const currV = srcPoly[i * 2 + 1];
      const currDist = edx * (currV - ey0) - edy * (currU - ex0);
      const currInside = currDist >= insideEps;

      if (currInside) {
        if (!prevInside) {
          const denom = prevDist - currDist;
          const t = denom !== 0 ? Math.max(0, Math.min(1, prevDist / denom)) : 0;
          dstPoly[nextCount * 2] = prevU + t * (currU - prevU);
          dstPoly[nextCount * 2 + 1] = prevV + t * (currV - prevV);
          nextCount++;
        }
        dstPoly[nextCount * 2] = currU;
        dstPoly[nextCount * 2 + 1] = currV;
        nextCount++;
      } else if (prevInside) {
        const denom = prevDist - currDist;
        const t = denom !== 0 ? Math.max(0, Math.min(1, prevDist / denom)) : 0;
        dstPoly[nextCount * 2] = prevU + t * (currU - prevU);
        dstPoly[nextCount * 2 + 1] = prevV + t * (currV - prevV);
        nextCount++;
      }

      prevU = currU;
      prevV = currV;
      prevDist = currDist;
      prevInside = currInside;
    }

    if (nextCount < 3) return false;
    vertCount = nextCount;
    const swap = srcPoly;
    srcPoly = dstPoly;
    dstPoly = swap;
  }

  const u0 = srcPoly[0];
  const v0 = srcPoly[1];
  let totalArea = 0;
  let weightedU = 0;
  let weightedV = 0;

  for (let i = 1; i < vertCount - 1; i++) {
    const u1 = srcPoly[i * 2];
    const v1 = srcPoly[i * 2 + 1];
    const u2 = srcPoly[(i + 1) * 2];
    const v2 = srcPoly[(i + 1) * 2 + 1];
    const triArea = 0.5 * ((u1 - u0) * (v2 - v0) - (v1 - v0) * (u2 - u0));
    totalArea += triArea;
    weightedU += triArea * ((u0 + u1 + u2) / 3);
    weightedV += triArea * ((v0 + v1 + v2) / 3);
  }

  if (totalArea <= MICRO_CLIP_AREA_M2) return false;

  CLIP_RESULT.area = totalArea;
  CLIP_RESULT.cu = weightedU / totalArea;
  CLIP_RESULT.cv = weightedV / totalArea;
  return true;
}

function extractTrianglesForMatrix(
  positionAttr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  indexAttr: THREE.BufferAttribute | null,
  drawStart: number,
  drawEnd: number,
  matrix: THREE.Matrix4,
  source: SourceDescriptor,
  buf: TriangleBuffer
): void {
  const e = matrix.elements;
  const m00 = e[0];
  const m01 = e[4];
  const m02 = e[8];
  const m03 = e[12];
  const m10 = e[1];
  const m11 = e[5];
  const m12 = e[9];
  const m13 = e[13];
  const m20 = e[2];
  const m21 = e[6];
  const m22 = e[10];
  const m23 = e[14];

  const det =
    m00 * (m11 * m22 - m12 * m21) -
    m01 * (m10 * m22 - m12 * m20) +
    m02 * (m10 * m21 - m11 * m20);
  if (Math.abs(det) < 1e-18) return;
  const swapWinding = det < 0;

  const maxNewTris = ((drawEnd - drawStart) / 3) | 0;
  if (maxNewTris <= 0) return;
  buf.ensureCapacity(buf.count + maxNewTris);

  const isFastPos =
    !(positionAttr as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute &&
    !(positionAttr as THREE.BufferAttribute).normalized &&
    positionAttr.itemSize >= 3;
  const posArr = isFastPos ? (positionAttr as THREE.BufferAttribute).array : null;
  const posStride = positionAttr.itemSize;

  const isFastIdx =
    indexAttr !== null &&
    !(indexAttr as unknown as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute &&
    !indexAttr.normalized;
  const idxArr = isFastIdx ? indexAttr.array : null;

  const sourceId = source.sourceId;
  const flipSign = source.flipNormal ? -1 : 1;

  const sourceIds = buf.sourceIds;
  const verts = buf.verts;
  const centroids = buf.centroids;
  const normals = buf.normals;
  const canonNormals = buf.canonNormals;
  let outIdx = buf.count;

  for (let i = drawStart; i + 2 < drawEnd; i += 3) {
    let i0: number;
    let i1: number;
    let i2: number;
    if (idxArr) {
      i0 = idxArr[i];
      i1 = idxArr[i + 1];
      i2 = idxArr[i + 2];
    } else if (indexAttr) {
      i0 = indexAttr.getX(i);
      i1 = indexAttr.getX(i + 1);
      i2 = indexAttr.getX(i + 2);
    } else {
      i0 = i;
      i1 = i + 1;
      i2 = i + 2;
    }

    if (swapWinding) {
      const tmp = i1;
      i1 = i2;
      i2 = tmp;
    }

    let lx0: number;
    let ly0: number;
    let lz0: number;
    let lx1: number;
    let ly1: number;
    let lz1: number;
    let lx2: number;
    let ly2: number;
    let lz2: number;

    if (posArr) {
      const b0 = i0 * posStride;
      lx0 = posArr[b0];
      ly0 = posArr[b0 + 1];
      lz0 = posArr[b0 + 2];
      const b1 = i1 * posStride;
      lx1 = posArr[b1];
      ly1 = posArr[b1 + 1];
      lz1 = posArr[b1 + 2];
      const b2 = i2 * posStride;
      lx2 = posArr[b2];
      ly2 = posArr[b2 + 1];
      lz2 = posArr[b2 + 2];
    } else {
      lx0 = positionAttr.getX(i0);
      ly0 = positionAttr.getY(i0);
      lz0 = positionAttr.getZ(i0);
      lx1 = positionAttr.getX(i1);
      ly1 = positionAttr.getY(i1);
      lz1 = positionAttr.getZ(i1);
      lx2 = positionAttr.getX(i2);
      ly2 = positionAttr.getY(i2);
      lz2 = positionAttr.getZ(i2);
    }

    const v0x = m00 * lx0 + m01 * ly0 + m02 * lz0 + m03;
    const v0y = m10 * lx0 + m11 * ly0 + m12 * lz0 + m13;
    const v0z = m20 * lx0 + m21 * ly0 + m22 * lz0 + m23;

    const v1x = m00 * lx1 + m01 * ly1 + m02 * lz1 + m03;
    const v1y = m10 * lx1 + m11 * ly1 + m12 * lz1 + m13;
    const v1z = m20 * lx1 + m21 * ly1 + m22 * lz1 + m23;

    const v2x = m00 * lx2 + m01 * ly2 + m02 * lz2 + m03;
    const v2y = m10 * lx2 + m11 * ly2 + m12 * lz2 + m13;
    const v2z = m20 * lx2 + m21 * ly2 + m22 * lz2 + m23;

    const e1x = v1x - v0x;
    const e1y = v1y - v0y;
    const e1z = v1z - v0z;
    const e2x = v2x - v0x;
    const e2y = v2y - v0y;
    const e2z = v2z - v0z;

    const crx = e1y * e2z - e1z * e2y;
    const cry = e1z * e2x - e1x * e2z;
    const crz = e1x * e2y - e1y * e2x;
    const crossLenSq = crx * crx + cry * cry + crz * crz;
    if (!(crossLenSq >= 4 * DEGENERATE_TRIANGLE_AREA_M2 * DEGENERATE_TRIANGLE_AREA_M2)) {
      continue;
    }

    const invLen = flipSign / Math.sqrt(crossLenSq);
    const nx = crx * invLen;
    const ny = cry * invLen;
    const nz = crz * invLen;

    let cnx = nx;
    let cny = ny;
    let cnz = nz;
    if (Math.abs(nx) > 1e-12) {
      if (nx < 0) {
        cnx = -nx;
        cny = -ny;
        cnz = -nz;
      }
    } else if (Math.abs(ny) > 1e-12) {
      if (ny < 0) {
        cnx = -nx;
        cny = -ny;
        cnz = -nz;
      }
    } else if (nz < 0) {
      cnx = -nx;
      cny = -ny;
      cnz = -nz;
    }

    sourceIds[outIdx] = sourceId;
    const vBase = outIdx * 9;
    verts[vBase] = v0x;
    verts[vBase + 1] = v0y;
    verts[vBase + 2] = v0z;
    verts[vBase + 3] = v1x;
    verts[vBase + 4] = v1y;
    verts[vBase + 5] = v1z;
    verts[vBase + 6] = v2x;
    verts[vBase + 7] = v2y;
    verts[vBase + 8] = v2z;

    const cBase = outIdx * 3;
    centroids[cBase] = (v0x + v1x + v2x) / 3;
    centroids[cBase + 1] = (v0y + v1y + v2y) / 3;
    centroids[cBase + 2] = (v0z + v1z + v2z) / 3;

    normals[cBase] = nx;
    normals[cBase + 1] = ny;
    normals[cBase + 2] = nz;

    canonNormals[cBase] = cnx;
    canonNormals[cBase + 1] = cny;
    canonNormals[cBase + 2] = cnz;

    outIdx++;
  }

  buf.count = outIdx;
}

/**
 * Deterministically detects coplanar z-fighting triangle pairs across a `THREE.Object3D`
 * scene graph in world space using canonical normal bucketing, 2D sweep-and-prune, and
 * exact Sutherland–Hodgman polygon clipping.
 */
export function detectZFighting(
  root: THREE.Object3D,
  options?: DetectZFightingOptions
): ZFightingFinding[] {
  const epsilonM = options?.epsilonM ?? DEFAULT_EPSILON_M;
  const minOverlapAreaM2 = options?.minOverlapAreaM2 ?? DEFAULT_MIN_OVERLAP_AREA_M2;
  const minNormalDot = options?.minNormalDot ?? DEFAULT_MIN_NORMAL_DOT;
  const onlyVisible = options?.onlyVisible !== false;
  const ignoreMesh = options?.ignoreMesh;
  const maxFindings = options?.maxFindings ?? DEFAULT_MAX_FINDINGS;

  if (maxFindings <= 0) return [];

  root.updateMatrixWorld(true);

  const buf = new TriangleBuffer(4096);
  const sources: SourceDescriptor[] = [];
  const materialIds = new Map<THREE.Material, number>();
  let nextEntityId = 0;

  const getMaterialId = (mat: THREE.Material): number => {
    let id = materialIds.get(mat);
    if (id === undefined) {
      id = materialIds.size;
      materialIds.set(mat, id);
    }
    return id;
  };

  const instanceLocalMatrix = new THREE.Matrix4();
  const instanceWorldMatrix = new THREE.Matrix4();

  const visit = (node: THREE.Object3D): void => {
    if (onlyVisible && !node.visible) return;
    if (isSkippedHelperUserData(node.userData as Record<string, unknown> | undefined)) return;

    if (node instanceof THREE.Mesh) {
      if (!ignoreMesh?.(node)) {
        const geometry = node.geometry;
        const posAttr = geometry?.attributes?.position as
          | THREE.BufferAttribute
          | THREE.InterleavedBufferAttribute
          | undefined;
        if (posAttr && posAttr.count >= 3) {
          const indexAttr = geometry.index;
          const totalVertices = indexAttr ? indexAttr.count : posAttr.count;
          const drawStart = Math.max(0, geometry.drawRange.start);
          const drawEnd = Math.min(
            totalVertices,
            geometry.drawRange.start + geometry.drawRange.count
          );

          if (drawEnd - drawStart >= 3) {
            const rawMaterial = node.material;
            const materialRanges: Array<{
              readonly mat: THREE.Material;
              readonly start: number;
              readonly end: number;
            }> = [];

            if (Array.isArray(rawMaterial)) {
              if (geometry.groups.length > 0) {
                for (const grp of geometry.groups) {
                  const mat = rawMaterial[grp.materialIndex ?? 0];
                  if (!isRenderableDepthMaterial(mat)) continue;
                  const s = Math.max(drawStart, grp.start);
                  const e = Math.min(drawEnd, grp.start + grp.count);
                  if (e - s >= 3) {
                    materialRanges.push({ mat, start: s, end: e });
                  }
                }
              } else if (isRenderableDepthMaterial(rawMaterial[0])) {
                materialRanges.push({ mat: rawMaterial[0], start: drawStart, end: drawEnd });
              }
            } else if (isRenderableDepthMaterial(rawMaterial)) {
              materialRanges.push({ mat: rawMaterial, start: drawStart, end: drawEnd });
            }

            if (materialRanges.length > 0) {
              if (node instanceof THREE.InstancedMesh) {
                const count = Math.max(0, node.count);
                for (let instIdx = 0; instIdx < count; instIdx++) {
                  node.getMatrixAt(instIdx, instanceLocalMatrix);
                  instanceWorldMatrix.multiplyMatrices(node.matrixWorld, instanceLocalMatrix);
                  const entityId = nextEntityId++;
                  for (const range of materialRanges) {
                    const mat = range.mat;
                    const src: SourceDescriptor = {
                      sourceId: sources.length,
                      entityId,
                      materialId: getMaterialId(mat),
                      mesh: node,
                      instanceIndex: instIdx,
                      material: mat,
                      isDoubleSide: mat.side === THREE.DoubleSide,
                      flipNormal: mat.side === THREE.BackSide,
                      offsetFactor: mat.polygonOffset ? mat.polygonOffsetFactor || 0 : 0,
                      offsetUnits: mat.polygonOffset ? mat.polygonOffsetUnits || 0 : 0,
                    };
                    sources.push(src);
                    extractTrianglesForMatrix(
                      posAttr,
                      indexAttr,
                      range.start,
                      range.end,
                      instanceWorldMatrix,
                      src,
                      buf
                    );
                  }
                }
              } else {
                const entityId = nextEntityId++;
                for (const range of materialRanges) {
                  const mat = range.mat;
                  const src: SourceDescriptor = {
                    sourceId: sources.length,
                    entityId,
                    materialId: getMaterialId(mat),
                    mesh: node,
                    instanceIndex: -1,
                    material: mat,
                    isDoubleSide: mat.side === THREE.DoubleSide,
                    flipNormal: mat.side === THREE.BackSide,
                    offsetFactor: mat.polygonOffset ? mat.polygonOffsetFactor || 0 : 0,
                    offsetUnits: mat.polygonOffset ? mat.polygonOffsetUnits || 0 : 0,
                  };
                  sources.push(src);
                  extractTrianglesForMatrix(
                    posAttr,
                    indexAttr,
                    range.start,
                    range.end,
                    node.matrixWorld,
                    src,
                    buf
                  );
                }
              }
            }
          }
        }
      }
    }

    const children = node.children;
    for (let i = 0, len = children.length; i < len; i++) {
      visit(children[i]);
    }
  };

  visit(root);

  const triCount = buf.count;
  if (triCount < 2 || sources.length < 2) return [];

  const sourceIds = buf.sourceIds;
  const verts = buf.verts;
  const centroids = buf.centroids;
  const normals = buf.normals;
  const canonNormals = buf.canonNormals;

  const clampedMinDot = Math.max(0, Math.min(1, minNormalDot));
  const maxChord = Math.sqrt(2 * Math.max(0, 1 - clampedMinDot));
  const normalStep = Math.max(0.025, maxChord * 1.05);
  const invNormalStep = 1 / normalStep;

  interface NormalCell {
    readonly key: number;
    readonly qx: number;
    readonly qy: number;
    readonly qz: number;
    readonly tris: number[];
    singleEntityId: number;
    singleMatId: number;
  }

  const cells = new Map<number, NormalCell>();
  for (let t = 0; t < triCount; t++) {
    const cBase = t * 3;
    const rx = symmetricRound(canonNormals[cBase] * invNormalStep);
    const ry = symmetricRound(canonNormals[cBase + 1] * invNormalStep);
    const rz = symmetricRound(canonNormals[cBase + 2] * invNormalStep);
    const key = packCanonicalCellKey(rx, ry, rz);
    const src = sources[sourceIds[t]];

    let cell = cells.get(key);
    if (!cell) {
      const [qx, qy, qz] = unpackCellKey(key);
      cell = {
        key,
        qx,
        qy,
        qz,
        tris: [t],
        singleEntityId: src.entityId,
        singleMatId: src.materialId,
      };
      cells.set(key, cell);
    } else {
      cell.tris.push(t);
      if (
        cell.singleEntityId >= 0 &&
        (cell.singleEntityId !== src.entityId || cell.singleMatId !== src.materialId)
      ) {
        cell.singleEntityId = -1;
      }
    }
  }

  const aggregated = new Map<string, AggregatedPair>();
  const broadEps = epsilonM * 1.01 + 1e-6;
  const planeEps = epsilonM + 1e-9;
  const ws = new ProjectionWorkspace();
  const neighborKeys = new Int32Array(27);

  const testCandidatePair = (t1: number, t2: number): void => {
    const s1Idx = sourceIds[t1];
    const s2Idx = sourceIds[t2];
    if (s1Idx === s2Idx) return;

    const s1 = sources[s1Idx];
    const s2 = sources[s2Idx];
    if (s1.entityId === s2.entityId && s1.materialId === s2.materialId) return;

    if (
      Math.abs(s1.offsetFactor - s2.offsetFactor) >= POLYGON_OFFSET_THRESHOLD ||
      Math.abs(s1.offsetUnits - s2.offsetUnits) >= POLYGON_OFFSET_THRESHOLD
    ) {
      return;
    }

    const n1Base = t1 * 3;
    const n2Base = t2 * 3;
    const n1x = normals[n1Base];
    const n1y = normals[n1Base + 1];
    const n1z = normals[n1Base + 2];
    const n2x = normals[n2Base];
    const n2y = normals[n2Base + 1];
    const n2z = normals[n2Base + 2];

    const dot = n1x * n2x + n1y * n2y + n1z * n2z;
    if (s1.isDoubleSide || s2.isDoubleSide) {
      if (Math.abs(dot) < minNormalDot) return;
    } else if (dot < minNormalDot) {
      return;
    }

    const v1Base = t1 * 9;
    const v2Base = t2 * 9;
    const t1v0x = verts[v1Base];
    const t1v0y = verts[v1Base + 1];
    const t1v0z = verts[v1Base + 2];
    const t2v0x = verts[v2Base];
    const t2v0y = verts[v2Base + 1];
    const t2v0z = verts[v2Base + 2];

    const t1cx = centroids[n1Base];
    const t1cy = centroids[n1Base + 1];
    const t1cz = centroids[n1Base + 2];
    const t2cx = centroids[n2Base];
    const t2cy = centroids[n2Base + 1];
    const t2cz = centroids[n2Base + 2];

    const dist1 = Math.abs(n1x * (t2cx - t1v0x) + n1y * (t2cy - t1v0y) + n1z * (t2cz - t1v0z));
    if (dist1 > planeEps) return;

    const dist2 = Math.abs(n2x * (t1cx - t2v0x) + n2y * (t1cy - t2v0y) + n2z * (t1cz - t2v0z));
    if (dist2 > planeEps) return;

    const cn1x = canonNormals[n1Base];
    const cn1y = canonNormals[n1Base + 1];
    const cn1z = canonNormals[n1Base + 2];
    let pnx = cn1x + canonNormals[n2Base];
    let pny = cn1y + canonNormals[n2Base + 1];
    let pnz = cn1z + canonNormals[n2Base + 2];
    const pLen = Math.hypot(pnx, pny, pnz);
    if (pLen > 1e-9) {
      pnx /= pLen;
      pny /= pLen;
      pnz /= pLen;
    } else {
      pnx = cn1x;
      pny = cn1y;
      pnz = cn1z;
    }

    let ux: number;
    let uy: number;
    let uz: number;
    if (Math.abs(pny) < 0.9) {
      const len = Math.hypot(pnz, pnx) || 1;
      ux = pnz / len;
      uy = 0;
      uz = -pnx / len;
    } else {
      const len = Math.hypot(pnz, pny) || 1;
      ux = 0;
      uy = -pnz / len;
      uz = pny / len;
    }
    const vx = pny * uz - pnz * uy;
    const vy = pnz * ux - pnx * uz;
    const vz = pnx * uy - pny * ux;

    const ox = 0.5 * (t1cx + t2cx);
    const oy = 0.5 * (t1cy + t2cy);
    const oz = 0.5 * (t1cz + t2cz);

    const d10x = t1v0x - ox;
    const d10y = t1v0y - oy;
    const d10z = t1v0z - oz;
    const d11x = verts[v1Base + 3] - ox;
    const d11y = verts[v1Base + 4] - oy;
    const d11z = verts[v1Base + 5] - oz;
    const d12x = verts[v1Base + 6] - ox;
    const d12y = verts[v1Base + 7] - oy;
    const d12z = verts[v1Base + 8] - oz;

    const d20x = t2v0x - ox;
    const d20y = t2v0y - oy;
    const d20z = t2v0z - oz;
    const d21x = verts[v2Base + 3] - ox;
    const d21y = verts[v2Base + 4] - oy;
    const d21z = verts[v2Base + 5] - oz;
    const d22x = verts[v2Base + 6] - ox;
    const d22y = verts[v2Base + 7] - oy;
    const d22z = verts[v2Base + 8] - oz;

    if (
      !clipTriangles2D(
        d10x * ux + d10y * uy + d10z * uz,
        d10x * vx + d10y * vy + d10z * vz,
        d11x * ux + d11y * uy + d11z * uz,
        d11x * vx + d11y * vy + d11z * vz,
        d12x * ux + d12y * uy + d12z * uz,
        d12x * vx + d12y * vy + d12z * vz,
        d20x * ux + d20y * uy + d20z * uz,
        d20x * vx + d20y * vy + d20z * vz,
        d21x * ux + d21y * uy + d21z * uz,
        d21x * vx + d21y * vy + d21z * vz,
        d22x * ux + d22y * uy + d22z * uz,
        d22x * vx + d22y * vy + d22z * vz
      )
    ) {
      return;
    }

    const area = CLIP_RESULT.area;
    const cu = CLIP_RESULT.cu;
    const cv = CLIP_RESULT.cv;
    const worldCx = ox + cu * ux + cv * vx;
    const worldCy = oy + cu * uy + cv * vy;
    const worldCz = oz + cu * uz + cv * vz;
    const pairDistM = 0.5 * (dist1 + dist2);

    const firstIsA =
      s1.entityId < s2.entityId ||
      (s1.entityId === s2.entityId && s1.materialId < s2.materialId);
    const srcA = firstIsA ? s1 : s2;
    const srcB = firstIsA ? s2 : s1;
    const baseA = firstIsA ? n1Base : n2Base;
    const baseB = firstIsA ? n2Base : n1Base;

    let repNx: number;
    let repNy: number;
    let repNz: number;
    if (!srcA.isDoubleSide) {
      repNx = normals[baseA];
      repNy = normals[baseA + 1];
      repNz = normals[baseA + 2];
    } else if (!srcB.isDoubleSide) {
      repNx = normals[baseB];
      repNy = normals[baseB + 1];
      repNz = normals[baseB + 2];
    } else {
      repNx = canonNormals[baseA];
      repNy = canonNormals[baseA + 1];
      repNz = canonNormals[baseA + 2];
    }

    const dirQx = symmetricRound(repNx * invNormalStep);
    const dirQy = symmetricRound(repNy * invNormalStep);
    const dirQz = symmetricRound(repNz * invNormalStep);
    const aggKey = `${srcA.entityId}:${srcA.materialId}:${srcB.entityId}:${srcB.materialId}:${dirQx},${dirQy},${dirQz}`;

    let entry = aggregated.get(aggKey);
    if (!entry) {
      entry = {
        srcA,
        srcB,
        totalAreaM2: 0,
        weightedCx: 0,
        weightedCy: 0,
        weightedCz: 0,
        weightedNx: 0,
        weightedNy: 0,
        weightedNz: 0,
        minDistM: pairDistM,
      };
      aggregated.set(aggKey, entry);
    }

    entry.totalAreaM2 += area;
    entry.weightedCx += area * worldCx;
    entry.weightedCy += area * worldCy;
    entry.weightedCz += area * worldCz;
    entry.weightedNx += area * repNx;
    entry.weightedNy += area * repNy;
    entry.weightedNz += area * repNz;
    if (pairDistM < entry.minDistM) {
      entry.minDistM = pairDistM;
    }
  };

  const processProjectedComponent = (
    compStart: number,
    compEnd: number,
    crossCellOnly: boolean
  ): void => {
    const len = compEnd - compStart;
    if (len < 2) return;

    const order = ws.order;
    const triIdx = ws.triIdx;
    const primary = ws.primary;

    // Fast O(len) multi-source & cross-cell check before 2D sort / sweep
    const firstSrc = sources[sourceIds[triIdx[order[compStart]]]];
    const firstEnt = firstSrc.entityId;
    const firstMat = firstSrc.materialId;
    const firstPrim = primary[order[compStart]];
    let hasOtherSource = false;
    let hasOtherCell = !crossCellOnly;
    for (let k = compStart + 1; k < compEnd; k++) {
      const idx = order[k];
      if (!hasOtherCell && primary[idx] !== firstPrim) {
        hasOtherCell = true;
      }
      if (!hasOtherSource) {
        const s = sources[sourceIds[triIdx[idx]]];
        if (s.entityId !== firstEnt || s.materialId !== firstMat) {
          hasOtherSource = true;
        }
      }
      if (hasOtherSource && hasOtherCell) break;
    }
    if (!hasOtherSource || !hasOtherCell) return;

    const nMin = ws.nMin;
    const nMax = ws.nMax;
    const uMin = ws.uMin;
    const uMax = ws.uMax;
    const vMin = ws.vMin;
    const vMax = ws.vMax;

    if (len <= 24) {
      for (let i = compStart; i < compEnd; i++) {
        const ai = order[i];
        const aPrim = primary[ai];
        const aNMin = nMin[ai];
        const aNLimit = nMax[ai] + broadEps;
        const aUMin = uMin[ai];
        const aUMax = uMax[ai];
        const aVMin = vMin[ai];
        const aVMax = vMax[ai];
        const aTri = triIdx[ai];

        for (let j = i + 1; j < compEnd; j++) {
          const bi = order[j];
          if (crossCellOnly && aPrim === primary[bi]) continue;
          if (nMin[bi] > aNLimit || aNMin > nMax[bi] + broadEps) continue;
          if (aUMax < uMin[bi] - 1e-6 || uMax[bi] < aUMin - 1e-6) continue;
          if (aVMax < vMin[bi] - 1e-6 || vMax[bi] < aVMin - 1e-6) continue;
          testCandidatePair(aTri, triIdx[bi]);
        }
      }
      return;
    }

    sortOrderByKey(order, uMin, compStart, compEnd);

    for (let i = compStart; i < compEnd; i++) {
      const ai = order[i];
      const uLimit = uMax[ai] + 1e-6;
      const aPrim = primary[ai];
      const aNMin = nMin[ai];
      const aNLimit = nMax[ai] + broadEps;
      const aVMin = vMin[ai];
      const aVMax = vMax[ai];
      const aTri = triIdx[ai];

      for (let j = i + 1; j < compEnd; j++) {
        const bi = order[j];
        if (uMin[bi] > uLimit) break;
        if (crossCellOnly && aPrim === primary[bi]) continue;
        if (nMin[bi] > aNLimit || aNMin > nMax[bi] + broadEps) continue;
        if (aVMax < vMin[bi] - 1e-6 || vMax[bi] < aVMin - 1e-6) continue;
        testCandidatePair(aTri, triIdx[bi]);
      }
    }
  };

  for (const cellA of cells.values()) {
    let neighborCount = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const nKey = packCanonicalCellKey(cellA.qx + dx, cellA.qy + dy, cellA.qz + dz);
          if (nKey < cellA.key) continue;
          let dup = false;
          for (let k = 0; k < neighborCount; k++) {
            if (neighborKeys[k] === nKey) {
              dup = true;
              break;
            }
          }
          if (!dup) {
            neighborKeys[neighborCount++] = nKey;
          }
        }
      }
    }

    for (let ni = 0; ni < neighborCount; ni++) {
      const neighborKey = neighborKeys[ni];
      const cellB = cells.get(neighborKey);
      if (!cellB) continue;

      const sameCell = neighborKey === cellA.key;
      if (sameCell) {
        if (cellA.tris.length < 2 || cellA.singleEntityId >= 0) continue;
      } else if (
        cellA.singleEntityId >= 0 &&
        cellA.singleEntityId === cellB.singleEntityId &&
        cellA.singleMatId === cellB.singleMatId
      ) {
        continue;
      }

      const trisA = cellA.tris;
      const trisB = cellB.tris;
      const totalProj = sameCell ? trisA.length : trisA.length + trisB.length;
      ws.ensureCapacity(totalProj);

      const firstBase = trisA[0] * 3;
      const refNx = canonNormals[firstBase];
      const refNy = canonNormals[firstBase + 1];
      const refNz = canonNormals[firstBase + 2];

      let ux: number;
      let uy: number;
      let uz: number;
      if (Math.abs(refNy) < 0.9) {
        const len = Math.hypot(refNz, refNx) || 1;
        ux = refNz / len;
        uy = 0;
        uz = -refNx / len;
      } else {
        const len = Math.hypot(refNz, refNy) || 1;
        ux = 0;
        uy = -refNz / len;
        uz = refNy / len;
      }
      const vx = refNy * uz - refNz * uy;
      const vy = refNz * ux - refNx * uz;
      const vz = refNx * uy - refNy * ux;

      const order = ws.order;
      const triIdx = ws.triIdx;
      const primary = ws.primary;
      const nMinArr = ws.nMin;
      const nMaxArr = ws.nMax;
      const uMinArr = ws.uMin;
      const uMaxArr = ws.uMax;
      const vMinArr = ws.vMin;
      const vMaxArr = ws.vMax;

      let p = 0;
      const projectList = (list: number[], isPrim: number): void => {
        for (let k = 0, lLen = list.length; k < lLen; k++) {
          const t = list[k];
          const vb = t * 9;
          const v0x = verts[vb];
          const v0y = verts[vb + 1];
          const v0z = verts[vb + 2];
          const v1x = verts[vb + 3];
          const v1y = verts[vb + 4];
          const v1z = verts[vb + 5];
          const v2x = verts[vb + 6];
          const v2y = verts[vb + 7];
          const v2z = verts[vb + 8];

          const n0 = v0x * refNx + v0y * refNy + v0z * refNz;
          const n1 = v1x * refNx + v1y * refNy + v1z * refNz;
          const n2 = v2x * refNx + v2y * refNy + v2z * refNz;

          const u0 = v0x * ux + v0y * uy + v0z * uz;
          const u1 = v1x * ux + v1y * uy + v1z * uz;
          const u2 = v2x * ux + v2y * uy + v2z * uz;

          const v0 = v0x * vx + v0y * vy + v0z * vz;
          const v1 = v1x * vx + v1y * vy + v1z * vz;
          const v2 = v2x * vx + v2y * vy + v2z * vz;

          order[p] = p;
          triIdx[p] = t;
          primary[p] = isPrim;
          nMinArr[p] = n0 < n1 ? (n0 < n2 ? n0 : n2) : n1 < n2 ? n1 : n2;
          nMaxArr[p] = n0 > n1 ? (n0 > n2 ? n0 : n2) : n1 > n2 ? n1 : n2;
          uMinArr[p] = u0 < u1 ? (u0 < u2 ? u0 : u2) : u1 < u2 ? u1 : u2;
          uMaxArr[p] = u0 > u1 ? (u0 > u2 ? u0 : u2) : u1 > u2 ? u1 : u2;
          vMinArr[p] = v0 < v1 ? (v0 < v2 ? v0 : v2) : v1 < v2 ? v1 : v2;
          vMaxArr[p] = v0 > v1 ? (v0 > v2 ? v0 : v2) : v1 > v2 ? v1 : v2;
          p++;
        }
      };

      projectList(trisA, 1);
      if (!sameCell) {
        projectList(trisB, 0);
      }

      sortOrderByKey(order, nMinArr, 0, totalProj);

      let compStart = 0;
      let maxEnd = nMaxArr[order[0]] + broadEps;
      for (let i = 1; i < totalProj; i++) {
        const idx = order[i];
        if (nMinArr[idx] > maxEnd) {
          if (i - compStart >= 2) {
            processProjectedComponent(compStart, i, !sameCell);
          }
          compStart = i;
          maxEnd = nMaxArr[idx] + broadEps;
        } else {
          const candidateEnd = nMaxArr[idx] + broadEps;
          if (candidateEnd > maxEnd) maxEnd = candidateEnd;
        }
      }
      if (totalProj - compStart >= 2) {
        processProjectedComponent(compStart, totalProj, !sameCell);
      }
    }
  }

  const meshLabelCache = new Map<number, string>();
  const matLabelCache = new Map<number, string>();
  const getEntityLabel = (src: SourceDescriptor): string => {
    let lbl = meshLabelCache.get(src.entityId);
    if (lbl === undefined) {
      lbl = formatMeshLabel(src.mesh, root, src.instanceIndex);
      meshLabelCache.set(src.entityId, lbl);
    }
    return lbl;
  };
  const getMatLabel = (src: SourceDescriptor): string => {
    let lbl = matLabelCache.get(src.materialId);
    if (lbl === undefined) {
      lbl = formatMaterialLabel(src.material);
      matLabelCache.set(src.materialId, lbl);
    }
    return lbl;
  };

  const findings: ZFightingFinding[] = [];
  for (const entry of aggregated.values()) {
    if (entry.totalAreaM2 < minOverlapAreaM2) continue;
    const invArea = 1 / entry.totalAreaM2;
    const nLen = Math.hypot(entry.weightedNx, entry.weightedNy, entry.weightedNz) || 1;
    const roundCoord = (v: number): number => {
      const r = Math.round(v * 1e6) / 1e6;
      return Object.is(r, -0) ? 0 : r;
    };

    findings.push({
      meshA: getEntityLabel(entry.srcA),
      meshB: getEntityLabel(entry.srcB),
      objectA: entry.srcA.mesh,
      objectB: entry.srcB.mesh,
      materialA: getMatLabel(entry.srcA),
      materialB: getMatLabel(entry.srcB),
      normal: [
        roundCoord(entry.weightedNx / nLen),
        roundCoord(entry.weightedNy / nLen),
        roundCoord(entry.weightedNz / nLen),
      ],
      planeDistanceDiffMm: Math.round(entry.minDistM * 1000 * 1e4) / 1e4,
      overlapAreaCm2: Math.round(entry.totalAreaM2 * 10000 * 1e3) / 1e3,
      centroid: [
        roundCoord(entry.weightedCx * invArea),
        roundCoord(entry.weightedCy * invArea),
        roundCoord(entry.weightedCz * invArea),
      ],
    });
  }

  findings.sort((a, b) => {
    if (b.overlapAreaCm2 !== a.overlapAreaCm2) {
      return b.overlapAreaCm2 - a.overlapAreaCm2;
    }
    if (a.planeDistanceDiffMm !== b.planeDistanceDiffMm) {
      return a.planeDistanceDiffMm - b.planeDistanceDiffMm;
    }
    return a.meshA.localeCompare(b.meshA) || a.meshB.localeCompare(b.meshB);
  });

  return findings.slice(0, maxFindings);
}

/**
 * Asserts that `root` contains zero coplanar z-fighting overlaps above threshold,
 * throwing a formatted diagnostic `Error` listing top findings when overlaps exist.
 */
export function assertNoZFighting(
  root: THREE.Object3D,
  options?: DetectZFightingOptions
): void {
  const findings = detectZFighting(root, options);
  if (findings.length === 0) return;

  const previewLimit = Math.min(findings.length, 20);
  const lines: string[] = [
    `Detected ${findings.length} coplanar z-fighting overlap(s):`,
    '  # | Area (cm²) | Diff (mm) | Normal              | Centroid [x, y, z]       | Mesh Pair',
    '----+------------+-----------+---------------------+--------------------------+----------',
  ];

  for (let i = 0; i < previewLimit; i++) {
    const f = findings[i];
    const idx = String(i + 1).padStart(3, ' ');
    const area = f.overlapAreaCm2.toFixed(2).padStart(10, ' ');
    const diff = f.planeDistanceDiffMm.toFixed(3).padStart(9, ' ');
    const norm = `[${f.normal.map((n) => n.toFixed(2)).join(', ')}]`.padEnd(19, ' ');
    const cent = `[${f.centroid.map((c) => c.toFixed(2)).join(', ')}]`.padEnd(24, ' ');
    lines.push(`${idx} | ${area} | ${diff} | ${norm} | ${cent} | ${f.meshA} <-> ${f.meshB}`);
  }

  if (findings.length > previewLimit) {
    lines.push(`... and ${findings.length - previewLimit} more finding(s).`);
  }

  throw new Error(lines.join('\n'));
}
