import * as THREE from 'three';

const unwrappedGeometryCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

export interface ConsolidatedMultiMaterialResult {
  readonly geometry: THREE.BufferGeometry;
  readonly materials: readonly THREE.Material[];
}

/**
 * Creates a zero-copy `BufferGeometry` view sharing all vertex/index `BufferAttribute`s with `geo`
 * while stripping `groups` so a single-material mesh emits 1 draw call instead of `groups.length`.
 */
export function unwrapSingleMaterialGeometry(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  if (geo.groups.length === 0) return geo;
  let cached = unwrappedGeometryCache.get(geo);
  if (!cached) {
    cached = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(geo.attributes)) {
      cached.setAttribute(name, attr);
    }
    if (geo.index) {
      cached.setIndex(geo.index);
    }
    if (geo.boundingBox) cached.boundingBox = geo.boundingBox.clone();
    if (geo.boundingSphere) cached.boundingSphere = geo.boundingSphere.clone();
    cached.userData = { ...geo.userData };
    unwrappedGeometryCache.set(geo, cached);
  }
  return cached;
}

/**
 * Consolidates a multi-material mesh's `geometry.groups` after slot material canonicalization:
 * - If all active groups reference the exact same `THREE.Material`, unwraps to a 1-material
 *   group-less `BufferGeometry` view (`6 -> 1` draw calls, eligible for standard single-mat batching).
 * - If `K >= 2` distinct materials appear across `M > K` face groups (e.g. 6-face `BoxGeometry`
 *   with exterior brick + interior plaster), reorders the index buffer into `K` contiguous face
 *   groups (`6 -> K` draw calls, and ready for per-group static batching).
 */
export function consolidateMultiMaterialGeometry(
  geo: THREE.BufferGeometry,
  slotMaterials: readonly THREE.Material[]
): ConsolidatedMultiMaterialResult {
  const posAttr = geo.getAttribute('position');
  if (!posAttr || posAttr.count === 0 || geo.groups.length === 0) {
    return { geometry: geo, materials: slotMaterials };
  }

  const activeGroups: Array<{
    readonly start: number;
    readonly count: number;
    readonly mat: THREE.Material;
  }> = [];
  const distinctMaterials: THREE.Material[] = [];
  const matToConsolidatedIndex = new Map<THREE.Material, number>();

  for (let i = 0; i < geo.groups.length; i++) {
    const grp = geo.groups[i]!;
    if (grp.count <= 0) continue;
    const matIdx = grp.materialIndex ?? 0;
    const mat = slotMaterials[matIdx];
    if (!mat) continue;
    activeGroups.push({ start: grp.start, count: grp.count, mat });
    if (!matToConsolidatedIndex.has(mat)) {
      matToConsolidatedIndex.set(mat, distinctMaterials.length);
      distinctMaterials.push(mat);
    }
  }

  if (distinctMaterials.length === 0) {
    return { geometry: geo, materials: slotMaterials };
  }

  if (distinctMaterials.length === 1) {
    const totalGroupIndices = activeGroups.reduce((acc, g) => acc + g.count, 0);
    const fullCount = geo.index ? geo.index.count : posAttr.count;
    if (totalGroupIndices === fullCount) {
      return {
        geometry: unwrapSingleMaterialGeometry(geo),
        materials: distinctMaterials,
      };
    }
  }

  // Already minimal and ordered 0..K-1?
  if (activeGroups.length === distinctMaterials.length) {
    let alreadyMinimal = true;
    for (let i = 0; i < geo.groups.length; i++) {
      const grp = geo.groups[i]!;
      if ((grp.materialIndex ?? 0) !== i || grp.count <= 0) {
        alreadyMinimal = false;
        break;
      }
    }
    if (alreadyMinimal && geo.index !== null && slotMaterials.length === distinctMaterials.length) {
      return { geometry: geo, materials: distinctMaterials };
    }
  }

  const totalIndices = activeGroups.reduce((acc, g) => acc + g.count, 0);
  const newIndices =
    posAttr.count > 65535 ? new Uint32Array(totalIndices) : new Uint16Array(totalIndices);
  const srcIndex = geo.index?.array;

  const consolidated = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)) {
    consolidated.setAttribute(name, attr);
  }

  let writeOffset = 0;
  for (let mIdx = 0; mIdx < distinctMaterials.length; mIdx++) {
    const targetMat = distinctMaterials[mIdx]!;
    const groupStart = writeOffset;
    for (let gIdx = 0; gIdx < activeGroups.length; gIdx++) {
      const grp = activeGroups[gIdx]!;
      if (grp.mat !== targetMat) continue;
      if (srcIndex) {
        for (let k = 0; k < grp.count; k++) {
          newIndices[writeOffset++] = srcIndex[grp.start + k]!;
        }
      } else {
        for (let k = 0; k < grp.count; k++) {
          newIndices[writeOffset++] = grp.start + k;
        }
      }
    }
    const groupCount = writeOffset - groupStart;
    if (groupCount > 0) {
      consolidated.addGroup(groupStart, groupCount, mIdx);
    }
  }

  consolidated.setIndex(new THREE.BufferAttribute(newIndices, 1));
  if (geo.boundingBox) consolidated.boundingBox = geo.boundingBox.clone();
  if (geo.boundingSphere) consolidated.boundingSphere = geo.boundingSphere.clone();
  consolidated.userData = { ...geo.userData };

  return {
    geometry: consolidated,
    materials: distinctMaterials,
  };
}
