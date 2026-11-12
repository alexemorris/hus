import * as THREE from 'three';

/** Minimum triangle count for lazy flat-BVH raycast acceleration on static meshes. */
export const MIN_BVH_TRIANGLES = 256;

const MAX_LEAF_TRIANGLES = 4;
const _bvhCache = new WeakMap<THREE.BufferGeometry, FlatTriangleBvh | null>();

let _scratchTriCap = 0;
let _scratchTriBoxes = new Float32Array(0);
let _scratchCentroids = new Float32Array(0);
let _scratchOrder = new Uint32Array(0);
let _scratchNodeCap = 0;
let _scratchNodeBounds = new Float32Array(0);
let _scratchNodeRight = new Uint32Array(0);
let _scratchNodeLeaf = new Uint16Array(0);

function ensureScratchCapacity(triCount: number): void {
  if (triCount > _scratchTriCap) {
    _scratchTriCap = Math.max(triCount, _scratchTriCap * 2, 16384);
    _scratchTriBoxes = new Float32Array(_scratchTriCap * 6);
    _scratchCentroids = new Float32Array(_scratchTriCap * 3);
    _scratchOrder = new Uint32Array(_scratchTriCap);
  }
  const neededNodes = Math.max(2, triCount * 2);
  if (neededNodes > _scratchNodeCap) {
    _scratchNodeCap = Math.max(neededNodes, _scratchNodeCap * 2, 32768);
    _scratchNodeBounds = new Float32Array(_scratchNodeCap * 6);
    _scratchNodeRight = new Uint32Array(_scratchNodeCap);
    _scratchNodeLeaf = new Uint16Array(_scratchNodeCap);
  }
}

interface MergedSubMeshMetadata {
  readonly subBounds?: Float32Array;
  readonly subRanges?: Uint32Array;
  readonly subMeshes?: readonly THREE.Mesh[];
}

interface MeshWithInternalRaycast extends THREE.Mesh {
  _computeIntersections(
    raycaster: THREE.Raycaster,
    intersects: THREE.Intersection[],
    rayLocalSpace: THREE.Ray
  ): void;
}

interface BvhRaycastFn {
  (raycaster: THREE.Raycaster, intersects: THREE.Intersection[]): void;
  __isBvhRaycast?: boolean;
}

/**
 * Compact, zero-dependency flat binary triangle BVH stored in contiguous TypedArrays.
 * Built lazily on the first raycast that pierces a static mesh's bounding volume.
 */
export class FlatTriangleBvh {
  public readonly nodeBounds: Float32Array;
  public readonly nodeRightOrStart: Uint32Array;
  public readonly nodeLeafCount: Uint16Array;
  public readonly triIndices: Uint32Array;
  public readonly triSubMesh: Uint32Array | null;
  public readonly nodeCount: number;

  public constructor(
    nodeBounds: Float32Array,
    nodeRightOrStart: Uint32Array,
    nodeLeafCount: Uint16Array,
    triIndices: Uint32Array,
    triSubMesh: Uint32Array | null,
    nodeCount: number
  ) {
    this.nodeBounds = nodeBounds;
    this.nodeRightOrStart = nodeRightOrStart;
    this.nodeLeafCount = nodeLeafCount;
    this.triIndices = triIndices;
    this.triSubMesh = triSubMesh;
    this.nodeCount = nodeCount;
  }

  public static build(geometry: THREE.BufferGeometry): FlatTriangleBvh | null {
    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!posAttr || posAttr.count < 3) return null;

    const indexAttr = geometry.index;
    const rawTriCount = Math.floor((indexAttr ? indexAttr.count : posAttr.count) / 3);
    if (rawTriCount <= 0) return null;

    const meta = geometry.userData as MergedSubMeshMetadata | undefined;
    const subRanges = meta?.subRanges;
    const subMeshes = meta?.subMeshes;
    const hasSubMeshes = Boolean(subRanges && subMeshes && subRanges.length >= 2);

    const triIndicesTemp = new Uint32Array(rawTriCount);
    const triSubMeshTemp = hasSubMeshes ? new Uint32Array(rawTriCount) : null;
    let activeTriCount = 0;

    if (hasSubMeshes && subRanges && subMeshes && triSubMeshTemp) {
      const subCount = subRanges.length >>> 1;
      for (let s = 0; s < subCount; s++) {
        if (subMeshes[s]?.userData?.excludeFromRaycast) continue;
        const startTri = Math.floor(subRanges[s * 2]! / 3);
        const triLen = Math.floor(subRanges[s * 2 + 1]! / 3);
        for (let k = 0; k < triLen; k++) {
          const t = startTri + k;
          if (t < rawTriCount) {
            triIndicesTemp[activeTriCount] = t;
            triSubMeshTemp[t] = s;
            activeTriCount++;
          }
        }
      }
    } else {
      for (let t = 0; t < rawTriCount; t++) {
        triIndicesTemp[t] = t;
      }
      activeTriCount = rawTriCount;
    }

    const triIndices =
      activeTriCount === rawTriCount
        ? triIndicesTemp
        : triIndicesTemp.slice(0, activeTriCount);

    if (activeTriCount === 0) {
      return new FlatTriangleBvh(
        new Float32Array(0),
        new Uint32Array(0),
        new Uint16Array(0),
        triIndices,
        triSubMeshTemp,
        0
      );
    }

    ensureScratchCapacity(activeTriCount);
    const posArr = posAttr.array;
    const idxArr = indexAttr?.array;
    const triBoxes = _scratchTriBoxes;
    const centroids = _scratchCentroids;

    for (let i = 0; i < activeTriCount; i++) {
      const t = triIndices[i]!;
      const base = t * 3;
      const i0 = (idxArr ? idxArr[base]! : base) * 3;
      const i1 = (idxArr ? idxArr[base + 1]! : base + 1) * 3;
      const i2 = (idxArr ? idxArr[base + 2]! : base + 2) * 3;

      const x0 = posArr[i0]!, y0 = posArr[i0 + 1]!, z0 = posArr[i0 + 2]!;
      const x1 = posArr[i1]!, y1 = posArr[i1 + 1]!, z1 = posArr[i1 + 2]!;
      const x2 = posArr[i2]!, y2 = posArr[i2 + 1]!, z2 = posArr[i2 + 2]!;

      const minX = x0 < x1 ? (x0 < x2 ? x0 : x2) : (x1 < x2 ? x1 : x2);
      const minY = y0 < y1 ? (y0 < y2 ? y0 : y2) : (y1 < y2 ? y1 : y2);
      const minZ = z0 < z1 ? (z0 < z2 ? z0 : z2) : (z1 < z2 ? z1 : z2);
      const maxX = x0 > x1 ? (x0 > x2 ? x0 : x2) : (x1 > x2 ? x1 : x2);
      const maxY = y0 > y1 ? (y0 > y2 ? y0 : y2) : (y1 > y2 ? y1 : y2);
      const maxZ = z0 > z1 ? (z0 > z2 ? z0 : z2) : (z1 > z2 ? z1 : z2);

      const b6 = i * 6;
      triBoxes[b6] = minX;
      triBoxes[b6 + 1] = minY;
      triBoxes[b6 + 2] = minZ;
      triBoxes[b6 + 3] = maxX;
      triBoxes[b6 + 4] = maxY;
      triBoxes[b6 + 5] = maxZ;

      const c3 = i * 3;
      centroids[c3] = (x0 + x1 + x2) * (1 / 3);
      centroids[c3 + 1] = (y0 + y1 + y2) * (1 / 3);
      centroids[c3 + 2] = (z0 + z1 + z2) * (1 / 3);
    }

    const order = _scratchOrder;
    for (let i = 0; i < activeTriCount; i++) order[i] = i;

    const nodeBounds = _scratchNodeBounds;
    const nodeRightOrStart = _scratchNodeRight;
    const nodeLeafCount = _scratchNodeLeaf;
    let nextNode = 0;

    const buildNode = (start: number, end: number, depth: number): number => {
      const nodeIdx = nextNode++;
      let bMinX = Number.POSITIVE_INFINITY;
      let bMinY = Number.POSITIVE_INFINITY;
      let bMinZ = Number.POSITIVE_INFINITY;
      let bMaxX = Number.NEGATIVE_INFINITY;
      let bMaxY = Number.NEGATIVE_INFINITY;
      let bMaxZ = Number.NEGATIVE_INFINITY;
      let cMinX = Number.POSITIVE_INFINITY;
      let cMinY = Number.POSITIVE_INFINITY;
      let cMinZ = Number.POSITIVE_INFINITY;
      let cMaxX = Number.NEGATIVE_INFINITY;
      let cMaxY = Number.NEGATIVE_INFINITY;
      let cMaxZ = Number.NEGATIVE_INFINITY;

      for (let i = start; i < end; i++) {
        const idx = order[i]!;
        const b6 = idx * 6;
        if (triBoxes[b6]! < bMinX) bMinX = triBoxes[b6]!;
        if (triBoxes[b6 + 1]! < bMinY) bMinY = triBoxes[b6 + 1]!;
        if (triBoxes[b6 + 2]! < bMinZ) bMinZ = triBoxes[b6 + 2]!;
        if (triBoxes[b6 + 3]! > bMaxX) bMaxX = triBoxes[b6 + 3]!;
        if (triBoxes[b6 + 4]! > bMaxY) bMaxY = triBoxes[b6 + 4]!;
        if (triBoxes[b6 + 5]! > bMaxZ) bMaxZ = triBoxes[b6 + 5]!;

        const c3 = idx * 3;
        const cx = centroids[c3]!;
        const cy = centroids[c3 + 1]!;
        const cz = centroids[c3 + 2]!;
        if (cx < cMinX) cMinX = cx;
        if (cx > cMaxX) cMaxX = cx;
        if (cy < cMinY) cMinY = cy;
        if (cy > cMaxY) cMaxY = cy;
        if (cz < cMinZ) cMinZ = cz;
        if (cz > cMaxZ) cMaxZ = cz;
      }

      const nb6 = nodeIdx * 6;
      nodeBounds[nb6] = bMinX;
      nodeBounds[nb6 + 1] = bMinY;
      nodeBounds[nb6 + 2] = bMinZ;
      nodeBounds[nb6 + 3] = bMaxX;
      nodeBounds[nb6 + 4] = bMaxY;
      nodeBounds[nb6 + 5] = bMaxZ;

      const count = end - start;
      if (count <= MAX_LEAF_TRIANGLES || depth >= 28) {
        nodeRightOrStart[nodeIdx] = start;
        nodeLeafCount[nodeIdx] = count;
        return nodeIdx;
      }

      const extX = cMaxX - cMinX;
      const extY = cMaxY - cMinY;
      const extZ = cMaxZ - cMinZ;
      const axis = extX >= extY && extX >= extZ ? 0 : extY >= extZ ? 1 : 2;
      const maxExtent = axis === 0 ? extX : axis === 1 ? extY : extZ;

      let mid: number;
      if (maxExtent <= 1e-7) {
        mid = (start + end) >>> 1;
      } else {
        const splitPos =
          axis === 0
            ? (cMinX + cMaxX) * 0.5
            : axis === 1
              ? (cMinY + cMaxY) * 0.5
              : (cMinZ + cMaxZ) * 0.5;
        let left = start;
        let right = end - 1;
        while (left <= right) {
          const lIdx = order[left]!;
          if (centroids[lIdx * 3 + axis]! <= splitPos) {
            left++;
          } else {
            const rIdx = order[right]!;
            order[left] = rIdx;
            order[right] = lIdx;
            right--;
          }
        }
        mid = left;
        if (mid <= start || mid >= end) {
          mid = (start + end) >>> 1;
        }
      }

      // Left child is placed immediately at `nodeIdx + 1`
      buildNode(start, mid, depth + 1);
      const rightChild = buildNode(mid, end, depth + 1);
      nodeRightOrStart[nodeIdx] = rightChild;
      nodeLeafCount[nodeIdx] = 0;
      return nodeIdx;
    };

    buildNode(0, activeTriCount, 0);

    const orderedTriIndices = new Uint32Array(activeTriCount);
    for (let i = 0; i < activeTriCount; i++) {
      orderedTriIndices[i] = triIndices[order[i]!]!;
    }

    return new FlatTriangleBvh(
      nodeBounds.slice(0, nextNode * 6),
      nodeRightOrStart.slice(0, nextNode),
      nodeLeafCount.slice(0, nextNode),
      orderedTriIndices,
      triSubMeshTemp,
      nextNode
    );
  }
}

const _inverseMatrix = new THREE.Matrix4();
const _localRay = new THREE.Ray();
const _worldSphere = new THREE.Sphere();
const _sphereHit = new THREE.Vector3();
const _subBox = new THREE.Box3();
const _traversalStack = new Int32Array(64);

function rayIntersectsNodeBounds(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  invX: number,
  invY: number,
  invZ: number,
  bounds: Float32Array,
  b6: number
): number {
  let tMin = 0;
  let tMax = Number.POSITIVE_INFINITY;

  if (Math.abs(dx) < 1e-12) {
    if (ox < bounds[b6]! || ox > bounds[b6 + 3]!) return -1;
  } else {
    const t1 = (bounds[b6]! - ox) * invX;
    const t2 = (bounds[b6 + 3]! - ox) * invX;
    const near = t1 < t2 ? t1 : t2;
    const far = t1 > t2 ? t1 : t2;
    if (near > tMin) tMin = near;
    if (far < tMax) tMax = far;
    if (tMin > tMax) return -1;
  }

  if (Math.abs(dy) < 1e-12) {
    if (oy < bounds[b6 + 1]! || oy > bounds[b6 + 4]!) return -1;
  } else {
    const t1 = (bounds[b6 + 1]! - oy) * invY;
    const t2 = (bounds[b6 + 4]! - oy) * invY;
    const near = t1 < t2 ? t1 : t2;
    const far = t1 > t2 ? t1 : t2;
    if (near > tMin) tMin = near;
    if (far < tMax) tMax = far;
    if (tMin > tMax) return -1;
  }

  if (Math.abs(dz) < 1e-12) {
    if (oz < bounds[b6 + 2]! || oz > bounds[b6 + 5]!) return -1;
  } else {
    const t1 = (bounds[b6 + 2]! - oz) * invZ;
    const t2 = (bounds[b6 + 5]! - oz) * invZ;
    const near = t1 < t2 ? t1 : t2;
    const far = t1 > t2 ? t1 : t2;
    if (near > tMin) tMin = near;
    if (far < tMax) tMax = far;
    if (tMin > tMax) return -1;
  }

  return tMin;
}

function localRayHitsTriangle(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  posArr: Float32Array,
  idxArr: Uint16Array | Uint32Array | undefined,
  triIdx: number
): boolean {
  const base = triIdx * 3;
  const i0 = (idxArr ? idxArr[base]! : base) * 3;
  const i1 = (idxArr ? idxArr[base + 1]! : base + 1) * 3;
  const i2 = (idxArr ? idxArr[base + 2]! : base + 2) * 3;

  const ax = posArr[i0]!, ay = posArr[i0 + 1]!, az = posArr[i0 + 2]!;
  const e1x = posArr[i1]! - ax, e1y = posArr[i1 + 1]! - ay, e1z = posArr[i1 + 2]! - az;
  const e2x = posArr[i2]! - ax, e2y = posArr[i2 + 1]! - ay, e2z = posArr[i2 + 2]! - az;

  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return false;

  const invDet = 1 / det;
  const tx = ox - ax, ty = oy - ay, tz = oz - az;
  const u = (tx * px + ty * py + tz * pz) * invDet;
  if (u < -1e-5 || u > 1.00001) return false;

  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * invDet;
  if (v < -1e-5 || u + v > 1.00001) return false;

  return (e2x * qx + e2y * qy + e2z * qz) * invDet >= -1e-5;
}

function getOrCreateGeometryBvh(geometry: THREE.BufferGeometry): FlatTriangleBvh | null {
  if (_bvhCache.has(geometry)) {
    return _bvhCache.get(geometry) ?? null;
  }
  const built = FlatTriangleBvh.build(geometry);
  _bvhCache.set(geometry, built);
  return built;
}

function getGeometryTriangleCount(geometry: THREE.BufferGeometry): number {
  const index = geometry.index;
  if (index) return Math.floor(index.count / 3);
  const pos = geometry.getAttribute('position');
  return pos ? Math.floor(pos.count / 3) : 0;
}

function isIdentityMatrix4(m: THREE.Matrix4): boolean {
  const e = m.elements;
  return (
    e[0] === 1 && e[5] === 1 && e[10] === 1 && e[15] === 1 &&
    e[12] === 0 && e[13] === 0 && e[14] === 0 &&
    e[1] === 0 && e[2] === 0 && e[4] === 0 && e[6] === 0 && e[8] === 0 && e[9] === 0 &&
    e[3] === 0 && e[7] === 0 && e[11] === 0
  );
}

function prepareLocalRayAndCullBounds(
  mesh: THREE.Mesh,
  geometry: THREE.BufferGeometry,
  raycaster: THREE.Raycaster
): boolean {
  if (
    raycaster.near === 0 &&
    raycaster.far === Infinity &&
    geometry.boundingBox !== null &&
    isIdentityMatrix4(mesh.matrixWorld)
  ) {
    if (!raycaster.ray.intersectsBox(geometry.boundingBox)) return false;
    _localRay.copy(raycaster.ray);
    return true;
  }

  if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
  _worldSphere.copy(geometry.boundingSphere!).applyMatrix4(mesh.matrixWorld);

  _localRay.copy(raycaster.ray).recast(raycaster.near);
  if (!_worldSphere.containsPoint(_localRay.origin)) {
    if (_localRay.intersectSphere(_worldSphere, _sphereHit) === null) return false;
    if (_localRay.origin.distanceToSquared(_sphereHit) > (raycaster.far - raycaster.near) ** 2) {
      return false;
    }
  }

  _inverseMatrix.copy(mesh.matrixWorld).invert();
  _localRay.copy(raycaster.ray).applyMatrix4(_inverseMatrix);

  if (geometry.boundingBox !== null && !_localRay.intersectsBox(geometry.boundingBox)) {
    return false;
  }
  return true;
}

function createBvhRaycastFn(): BvhRaycastFn {
  const fn: BvhRaycastFn = function (
    this: THREE.Mesh,
    raycaster: THREE.Raycaster,
    intersects: THREE.Intersection[]
  ): void {
    const geometry = this.geometry;
    const material = this.material;
    if (!material || !this.visible) return;

    if (!prepareLocalRayAndCullBounds(this, geometry, raycaster)) return;

    const bvh = getOrCreateGeometryBvh(geometry);
    if (!bvh || bvh.nodeCount === 0) return;

    const ox = _localRay.origin.x;
    const oy = _localRay.origin.y;
    const oz = _localRay.origin.z;
    const dx = _localRay.direction.x;
    const dy = _localRay.direction.y;
    const dz = _localRay.direction.z;
    const invX = Math.abs(dx) >= 1e-12 ? 1 / dx : 0;
    const invY = Math.abs(dy) >= 1e-12 ? 1 / dy : 0;
    const invZ = Math.abs(dz) >= 1e-12 ? 1 / dz : 0;

    const { nodeBounds, nodeRightOrStart, nodeLeafCount, triIndices, triSubMesh } = bvh;
    if (rayIntersectsNodeBounds(ox, oy, oz, dx, dy, dz, invX, invY, invZ, nodeBounds, 0) < 0) {
      return;
    }

    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!posAttr) return;
    const posArr = posAttr.array as Float32Array;
    const idxArr = geometry.index?.array as Uint16Array | Uint32Array | undefined;

    const meta = geometry.userData as MergedSubMeshMetadata | undefined;
    const subMeshes = meta?.subMeshes;
    const selfWithCompute = this as unknown as MeshWithInternalRaycast;
    const prevDrawStart = geometry.drawRange.start;
    const prevDrawCount = geometry.drawRange.count;
    let changedDrawRange = false;

    let sp = 0;
    _traversalStack[sp++] = 0;

    try {
      while (sp > 0) {
        const nodeIdx = _traversalStack[--sp]!;
        const leafCount = nodeLeafCount[nodeIdx]!;
        if (leafCount > 0) {
          const leafStart = nodeRightOrStart[nodeIdx]!;
          for (let j = 0; j < leafCount; j++) {
            const triIdx = triIndices[leafStart + j]!;
            if (!localRayHitsTriangle(ox, oy, oz, dx, dy, dz, posArr, idxArr, triIdx)) {
              continue;
            }
            changedDrawRange = true;
            geometry.setDrawRange(triIdx * 3, 3);
            const prevLen = intersects.length;
            selfWithCompute._computeIntersections(raycaster, intersects, _localRay);
            if (subMeshes && triSubMesh && intersects.length > prevLen) {
              const origMesh = subMeshes[triSubMesh[triIdx]!];
              if (origMesh) {
                for (let k = prevLen; k < intersects.length; k++) {
                  (intersects[k]! as THREE.Intersection & { originalMesh?: THREE.Mesh }).originalMesh =
                    origMesh;
                }
              }
            }
          }
          continue;
        }

        const leftIdx = nodeIdx + 1;
        const rightIdx = nodeRightOrStart[nodeIdx]!;
        const tLeft = rayIntersectsNodeBounds(
          ox, oy, oz, dx, dy, dz, invX, invY, invZ, nodeBounds, leftIdx * 6
        );
        const tRight = rayIntersectsNodeBounds(
          ox, oy, oz, dx, dy, dz, invX, invY, invZ, nodeBounds, rightIdx * 6
        );

        if (tLeft >= 0 && tRight >= 0) {
          if (tLeft <= tRight) {
            _traversalStack[sp++] = rightIdx;
            _traversalStack[sp++] = leftIdx;
          } else {
            _traversalStack[sp++] = leftIdx;
            _traversalStack[sp++] = rightIdx;
          }
        } else if (tLeft >= 0) {
          _traversalStack[sp++] = leftIdx;
        } else if (tRight >= 0) {
          _traversalStack[sp++] = rightIdx;
        }
      }
    } finally {
      if (changedDrawRange) {
        geometry.setDrawRange(prevDrawStart, prevDrawCount);
      }
    }
  };
  fn.__isBvhRaycast = true;
  return fn;
}

const SHARED_BVH_RAYCAST = createBvhRaycastFn();

/**
 * Eagerly builds and caches the FlatTriangleBvh for a geometry during startup/optimization
 * so runtime pointermove and click raycasts never hit a lazy BVH construction spike.
 */
export function prebuildGeometryBvh(
  geometry: THREE.BufferGeometry,
  minTriangles = 1500
): boolean {
  if (getGeometryTriangleCount(geometry) < minTriangles) return false;
  return getOrCreateGeometryBvh(geometry) !== null;
}

/**
 * Attaches lazy flat-BVH raycasting to an unbatched static high-poly mesh without overwriting
 * any pre-existing custom `mesh.raycast` override.
 */
export function accelerateStaticMeshRaycast(
  mesh: THREE.Mesh,
  minTriangles = MIN_BVH_TRIANGLES
): boolean {
  if (mesh.raycast !== THREE.Mesh.prototype.raycast) return false;
  if ((mesh as THREE.SkinnedMesh).isSkinnedMesh || mesh.geometry?.morphAttributes?.position) {
    return false;
  }
  if (getGeometryTriangleCount(mesh.geometry) < minTriangles) return false;
  mesh.raycast = SHARED_BVH_RAYCAST;
  return true;
}

/** Restores `THREE.Mesh.prototype.raycast` on a mesh previously accelerated by `accelerateStaticMeshRaycast`. */
export function restoreDefaultMeshRaycast(mesh: THREE.Mesh): void {
  if ((mesh.raycast as BvhRaycastFn).__isBvhRaycast) {
    delete (mesh as Partial<THREE.Mesh>).raycast;
  }
}

/**
 * Accelerates CPU raycasting against merged static batch meshes:
 * - Uses the lazy flat triangle BVH whenever the merged batch has `>= MIN_BVH_TRIANGLES` triangles
 *   (or any high-poly sub-mesh), preserving exact `originalMesh` attribution.
 * - Falls back to per-sub-mesh AABB culling for small merged batches.
 */
export function accelerateMergedBatchRaycast(mesh: THREE.Mesh): void {
  const meta = mesh.geometry.userData as MergedSubMeshMetadata | undefined;
  const subBounds = meta?.subBounds;
  const subRanges = meta?.subRanges;
  const subMeshes = meta?.subMeshes;
  if (!subBounds || !subRanges) return;

  const subCount = subRanges.length >>> 1;
  if (getGeometryTriangleCount(mesh.geometry) >= 64 || subCount >= 8) {
    mesh.raycast = SHARED_BVH_RAYCAST;
    return;
  }
  if (subCount < 2) return;

  mesh.raycast = function (
    this: THREE.Mesh,
    raycaster: THREE.Raycaster,
    intersects: THREE.Intersection[]
  ): void {
    const geometry = this.geometry;
    const material = this.material;
    if (!material || !this.visible) return;

    if (!prepareLocalRayAndCullBounds(this, geometry, raycaster)) return;

    const selfWithCompute = this as unknown as MeshWithInternalRaycast;
    for (let s = 0; s < subCount; s++) {
      const origMesh = subMeshes?.[s];
      if (origMesh?.userData?.excludeFromRaycast) continue;
      const b6 = s * 6;
      _subBox.min.set(subBounds[b6]!, subBounds[b6 + 1]!, subBounds[b6 + 2]!);
      _subBox.max.set(subBounds[b6 + 3]!, subBounds[b6 + 4]!, subBounds[b6 + 5]!);
      if (_localRay.intersectsBox(_subBox)) {
        const r2 = s * 2;
        geometry.setDrawRange(subRanges[r2]!, subRanges[r2 + 1]!);
        const prevLen = intersects.length;
        selfWithCompute._computeIntersections(raycaster, intersects, _localRay);
        if (origMesh && intersects.length > prevLen) {
          for (let k = prevLen; k < intersects.length; k++) {
            (intersects[k]! as THREE.Intersection & { originalMesh?: THREE.Mesh }).originalMesh =
              origMesh;
          }
        }
      }
    }
    geometry.setDrawRange(0, Infinity);
  };
}
