import * as THREE from 'three';
import type { BatchRestorationStore } from './batch-restoration-store.ts';
import { SHADOW_PASS_HOOK_FLAG } from './scene-batch-classification.ts';

export interface MergeableMeshItem {
  readonly mesh: THREE.Mesh;
  readonly indexRange?: { readonly start: number; readonly count: number };
}

/**
 * Single-pass typed-array geometry merger (`snorm16x4` normals, `float32x2` UVs, `Uint16`/`Uint32`
 * threshold at `65535` vertices, `subBounds`/`subRanges`/`subMeshes`) and canonical WebGPU vertex
 * buffer layout normalizer for unmerged meshes.
 */
export class FastGeometryMerger {
  private readonly canonicalGeoCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
  private readonly scratchNormalMatrix = new THREE.Matrix3();

  /**
   * Single-pass typed-array geometry merger that transforms positions, normals, UVs, and indices
   * directly into pre-allocated buffers while simultaneously computing the merged bounding box
   * and bounding sphere (avoiding intermediate BufferGeometry clones and redundant bounding passes).
   */
  public mergeMeshListFast(
    list: ReadonlyArray<MergeableMeshItem>,
    invTargetWorld: THREE.Matrix4,
    scratchMatrix: THREE.Matrix4
  ): THREE.BufferGeometry | null {
    let totalVerts = 0;
    let totalIndices = 0;
    let remappedSubVerts: Array<Uint32Array | null> | null = null;
    let remappedLocalIndices: Array<Uint32Array | null> | null = null;

    for (let i = 0; i < list.length; i++) {
      const item = list[i]!;
      const g = item.mesh.geometry;
      const pos = g.getAttribute('position');
      if (!pos || pos.count === 0) return null;

      if (item.indexRange && g.index) {
        if (!remappedSubVerts) {
          remappedSubVerts = new Array<Uint32Array | null>(list.length).fill(null);
          remappedLocalIndices = new Array<Uint32Array | null>(list.length).fill(null);
        }
        const { start, count } = item.indexRange;
        const srcIdx = g.index.array;
        const map = new Int32Array(pos.count).fill(-1);
        const usedVerts = new Uint32Array(Math.min(pos.count, count));
        const localIdx = new Uint32Array(count);
        let uniqueCount = 0;
        for (let k = 0; k < count; k++) {
          const sv = srcIdx[start + k]!;
          let lv = map[sv]!;
          if (lv === -1) {
            lv = uniqueCount++;
            map[sv] = lv;
            usedVerts[lv] = sv;
          }
          localIdx[k] = lv;
        }
        remappedSubVerts[i] = usedVerts.subarray(0, uniqueCount);
        remappedLocalIndices![i] = localIdx;
        totalVerts += uniqueCount;
        totalIndices += count;
      } else {
        totalVerts += pos.count;
        totalIndices += g.index ? g.index.count : pos.count;
      }
    }

    let anyColor = false;
    for (let i = 0; i < list.length; i++) {
      const m = list[i]!.mesh;
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      if (
        m.geometry.getAttribute('color') ||
        Boolean((mat as THREE.MeshStandardMaterial | undefined)?.vertexColors)
      ) {
        anyColor = true;
        break;
      }
    }
    const posOut = new Float32Array(totalVerts * 3);
    const normInt16x4 = new Int16Array(totalVerts * 4);
    const uvOut = new Float32Array(totalVerts * 2);
    const colorOut = anyColor ? new Float32Array(totalVerts * 3) : null;
    let minUv = Number.POSITIVE_INFINITY;
    let maxUv = Number.NEGATIVE_INFINITY;
    const idxOut =
      totalVerts > 65535
        ? new Uint32Array(totalIndices)
        : new Uint16Array(totalIndices);

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;

    const subBounds = new Float32Array(list.length * 6);
    const subRanges = new Uint32Array(list.length * 2);

    let vOffset = 0;
    let iOffset = 0;

    for (let i = 0; i < list.length; i++) {
      const m = list[i]!.mesh;
      const g = m.geometry;
      if (!g.getAttribute('normal')) {
        g.computeVertexNormals();
      }

      scratchMatrix.multiplyMatrices(invTargetWorld, m.matrixWorld);
      const e = scratchMatrix.elements;
      const m00 = e[0];
      const m01 = e[4];
      const m02 = e[8];
      const tx = e[12];
      const m10 = e[1];
      const m11 = e[5];
      const m12 = e[9];
      const ty = e[13];
      const m20 = e[2];
      const m21 = e[6];
      const m22 = e[10];
      const tz = e[14];

      this.scratchNormalMatrix.getNormalMatrix(scratchMatrix);
      const ne = this.scratchNormalMatrix.elements;
      const n00 = ne[0];
      const n01 = ne[3];
      const n02 = ne[6];
      const n10 = ne[1];
      const n11 = ne[4];
      const n12 = ne[7];
      const n20 = ne[2];
      const n21 = ne[5];
      const n22 = ne[8];

      const posAttr = g.getAttribute('position') as THREE.BufferAttribute;
      const normAttr = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
      const uvAttr = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
      const colorAttr = colorOut
        ? (g.getAttribute('color') as THREE.BufferAttribute | undefined)
        : undefined;
      const posArr = posAttr.array;
      const normArr = normAttr?.array;
      const uvArr = uvAttr && uvAttr.itemSize === 2 ? uvAttr.array : undefined;
      const colorArr = colorAttr && colorAttr.itemSize >= 3 ? colorAttr.array : undefined;
      const colorStride = colorAttr ? colorAttr.itemSize : 3;
      const usedSrcVerts = remappedSubVerts ? remappedSubVerts[i] : null;
      const count = usedSrcVerts ? usedSrcVerts.length : posAttr.count;

      let sMinX = Number.POSITIVE_INFINITY;
      let sMinY = Number.POSITIVE_INFINITY;
      let sMinZ = Number.POSITIVE_INFINITY;
      let sMaxX = Number.NEGATIVE_INFINITY;
      let sMaxY = Number.NEGATIVE_INFINITY;
      let sMaxZ = Number.NEGATIVE_INFINITY;

      if (!uvArr && count > 0) {
        if (0 < minUv) minUv = 0;
        if (0 > maxUv) maxUv = 0;
      }

      for (let v = 0; v < count; v++) {
        const srcV = usedSrcVerts ? usedSrcVerts[v]! : v;
        const v3 = srcV * 3;
        const dstVert = vOffset + v;
        const out3 = dstVert * 3;
        const out4 = dstVert * 4;
        const px = posArr[v3]!;
        const py = posArr[v3 + 1]!;
        const pz = posArr[v3 + 2]!;

        const wx = m00 * px + m01 * py + m02 * pz + tx;
        const wy = m10 * px + m11 * py + m12 * pz + ty;
        const wz = m20 * px + m21 * py + m22 * pz + tz;

        posOut[out3] = wx;
        posOut[out3 + 1] = wy;
        posOut[out3 + 2] = wz;

        if (wx < sMinX) sMinX = wx;
        if (wx > sMaxX) sMaxX = wx;
        if (wy < sMinY) sMinY = wy;
        if (wy > sMaxY) sMaxY = wy;
        if (wz < sMinZ) sMinZ = wz;
        if (wz > sMaxZ) sMaxZ = wz;

        if (normArr) {
          const nStride = normAttr!.itemSize;
          const nv = srcV * nStride;
          const nx = normAttr!.normalized ? normAttr!.getX(srcV) : normArr[nv]!;
          const ny = normAttr!.normalized ? normAttr!.getY(srcV) : normArr[nv + 1]!;
          const nz = normAttr!.normalized ? normAttr!.getZ(srcV) : normArr[nv + 2]!;
          const rx = n00 * nx + n01 * ny + n02 * nz;
          const ry = n10 * nx + n11 * ny + n12 * nz;
          const rz = n20 * nx + n21 * ny + n22 * nz;
          const invLen = 32767 / (Math.hypot(rx, ry, rz) || 1);
          normInt16x4[out4] = Math.max(-32767, Math.min(32767, Math.round(rx * invLen)));
          normInt16x4[out4 + 1] = Math.max(-32767, Math.min(32767, Math.round(ry * invLen)));
          normInt16x4[out4 + 2] = Math.max(-32767, Math.min(32767, Math.round(rz * invLen)));
        } else {
          normInt16x4[out4 + 1] = 32767;
        }

        if (uvArr) {
          const v2 = srcV * 2;
          const out2 = dstVert * 2;
          const u = uvAttr!.normalized ? uvAttr!.getX(srcV) : uvArr[v2]!;
          const w = uvAttr!.normalized ? uvAttr!.getY(srcV) : uvArr[v2 + 1]!;
          uvOut[out2] = u;
          uvOut[out2 + 1] = w;
          if (u < minUv) minUv = u;
          if (u > maxUv) maxUv = u;
          if (w < minUv) minUv = w;
          if (w > maxUv) maxUv = w;
        }

        if (colorOut) {
          if (colorArr && !colorAttr!.normalized) {
            const cv = srcV * colorStride;
            colorOut[out3] = colorArr[cv]!;
            colorOut[out3 + 1] = colorArr[cv + 1]!;
            colorOut[out3 + 2] = colorArr[cv + 2]!;
          } else if (colorAttr) {
            colorOut[out3] = colorAttr.getX(srcV);
            colorOut[out3 + 1] = colorAttr.getY(srcV);
            colorOut[out3 + 2] = colorAttr.getZ(srcV);
          } else {
            colorOut[out3] = 1;
            colorOut[out3 + 1] = 1;
            colorOut[out3 + 2] = 1;
          }
        }
      }

      if (sMinX < minX) minX = sMinX;
      if (sMaxX > maxX) maxX = sMaxX;
      if (sMinY < minY) minY = sMinY;
      if (sMaxY > maxY) maxY = sMaxY;
      if (sMinZ < minZ) minZ = sMinZ;
      if (sMaxZ > maxZ) maxZ = sMaxZ;

      const b6 = i * 6;
      subBounds[b6] = sMinX;
      subBounds[b6 + 1] = sMinY;
      subBounds[b6 + 2] = sMinZ;
      subBounds[b6 + 3] = sMaxX;
      subBounds[b6 + 4] = sMaxY;
      subBounds[b6 + 5] = sMaxZ;

      const subStart = iOffset;
      let subIdxCount = count;
      const localRemapIdx = remappedLocalIndices ? remappedLocalIndices[i] : null;
      if (localRemapIdx) {
        subIdxCount = localRemapIdx.length;
        for (let k = 0; k < subIdxCount; k++) {
          idxOut[iOffset + k] = localRemapIdx[k]! + vOffset;
        }
        iOffset += subIdxCount;
      } else if (g.index) {
        const idxArr = g.index.array;
        const idxCount = g.index.count;
        subIdxCount = idxCount;
        for (let k = 0; k < idxCount; k++) {
          idxOut[iOffset + k] = idxArr[k]! + vOffset;
        }
        iOffset += idxCount;
      } else {
        for (let k = 0; k < count; k++) {
          idxOut[iOffset + k] = vOffset + k;
        }
        iOffset += count;
      }

      const r2 = i * 2;
      subRanges[r2] = subStart;
      subRanges[r2 + 1] = subIdxCount;

      vOffset += count;
    }

    void minUv;
    void maxUv;
    const uvBufferAttr = new THREE.BufferAttribute(uvOut, 2);

    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(posOut, 3));
    merged.setAttribute('normal', new THREE.Int16BufferAttribute(normInt16x4, 4, true));
    merged.setAttribute('uv', uvBufferAttr);
    if (colorOut) {
      merged.setAttribute('color', new THREE.BufferAttribute(colorOut, 3));
    }
    merged.setIndex(new THREE.BufferAttribute(idxOut, 1));

    const bbox = new THREE.Box3(
      new THREE.Vector3(minX, minY, minZ),
      new THREE.Vector3(maxX, maxY, maxZ)
    );
    merged.boundingBox = bbox;
    merged.boundingSphere = bbox.getBoundingSphere(new THREE.Sphere());
    const subMeshes = list.map((item) => item.mesh);
    merged.userData = { subBounds, subRanges, subMeshes };
    return merged;
  }

  /**
   * Normalizes a BufferGeometry to the canonical
   * (position: float32x3, normal: snorm16x4, uv: float32x2) vertex buffer layout so
   * merged and unmerged meshes share identical WebGPU GPURenderPipeline signatures.
   */
  public toCanonicalVertexLayoutGeometry(srcGeo: THREE.BufferGeometry): THREE.BufferGeometry {
    const posAttr = srcGeo.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (
      !posAttr ||
      posAttr.count === 0 ||
      (posAttr as unknown as { isInterleavedBufferAttribute?: boolean })
        .isInterleavedBufferAttribute === true
    ) {
      return srcGeo;
    }
    const normAttr = srcGeo.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const uvAttr = srcGeo.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const alreadyCanonical =
      normAttr !== undefined &&
      normAttr.array instanceof Int16Array &&
      normAttr.itemSize === 4 &&
      normAttr.normalized === true &&
      uvAttr !== undefined &&
      uvAttr.array instanceof Float32Array &&
      uvAttr.itemSize === 2 &&
      !uvAttr.normalized;
    if (alreadyCanonical) return srcGeo;

    let canonGeo = this.canonicalGeoCache.get(srcGeo);
    if (!canonGeo) {
      const nextGeo = srcGeo.clone();
      if (!nextGeo.getAttribute('normal')) {
        nextGeo.computeVertexNormals();
      }
      const cNorm = nextGeo.getAttribute('normal') as THREE.BufferAttribute | undefined;
      const count = posAttr.count;
      const n16 = new Int16Array(count * 4);
      if (cNorm) {
        for (let i = 0; i < count; i++) {
          const nx = cNorm.getX(i);
          const ny = cNorm.getY(i);
          const nz = cNorm.getZ(i);
          const invLen = 32767 / (Math.hypot(nx, ny, nz) || 1);
          const o4 = i * 4;
          n16[o4] = Math.max(-32767, Math.min(32767, Math.round(nx * invLen)));
          n16[o4 + 1] = Math.max(-32767, Math.min(32767, Math.round(ny * invLen)));
          n16[o4 + 2] = Math.max(-32767, Math.min(32767, Math.round(nz * invLen)));
        }
      } else {
        for (let i = 0; i < count; i++) {
          n16[i * 4 + 1] = 32767;
        }
      }
      nextGeo.setAttribute('normal', new THREE.Int16BufferAttribute(n16, 4, true));

      const cUv = nextGeo.getAttribute('uv') as THREE.BufferAttribute | undefined;
      if (!cUv || !(cUv.array instanceof Float32Array) || cUv.itemSize !== 2 || cUv.normalized) {
        const uv32 = new Float32Array(count * 2);
        if (cUv) {
          for (let i = 0; i < count; i++) {
            uv32[i * 2] = cUv.getX(i);
            uv32[i * 2 + 1] = cUv.getY(i);
          }
        }
        nextGeo.setAttribute('uv', new THREE.BufferAttribute(uv32, 2));
      }
      canonGeo = nextGeo;
      this.canonicalGeoCache.set(srcGeo, nextGeo);
    }
    return canonGeo;
  }

  public canonicalizeUnmergedVertexLayouts(
    scene: THREE.Scene,
    store: BatchRestorationStore
  ): void {
    scene.traverse((obj) => {
      if (
        !(obj instanceof THREE.Mesh) ||
        obj.userData?.isBatchedStaticMesh ||
        obj.userData?.[SHADOW_PASS_HOOK_FLAG] ||
        (obj as THREE.SkinnedMesh).isSkinnedMesh ||
        obj.geometry?.morphAttributes?.position
      ) {
        return;
      }

      const srcGeo = obj.geometry;
      const canonGeo = this.toCanonicalVertexLayoutGeometry(srcGeo);
      if (canonGeo === srcGeo) return;

      store.snapshotMeshPropsIfAbsent(obj);
      obj.geometry = canonGeo;
      store.markGeometrySwappedIfPostUnbatch(obj);
    });
  }
}
