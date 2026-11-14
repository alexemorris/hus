import * as THREE from 'three';
import { isDynamicMaterial } from './scene-batch-classification.ts';

export interface MultiMaterialBakeResult {
  readonly geometry: THREE.BufferGeometry;
  readonly slotVcEligible: readonly boolean[];
  readonly slotUvRefTex: readonly (THREE.Texture | null)[];
  readonly bakedPerGroupVc: boolean;
  readonly bakedPerGroupUv: boolean;
}

/**
 * Uniform-repeat UV and vertex-color geometry baker used by `MaterialTextureDeduplicator`.
 *
 * Holds instance-level baked `THREE.BufferGeometry` caches so `optimize() -> unbatchAll() ->
 * optimize()` reuses identical baked geometries with zero leaks.
 */
export class MaterialUvColorBaker {
  private readonly uvBakedGeoCache = new WeakMap<
    THREE.BufferGeometry,
    Map<string, THREE.BufferGeometry>
  >();
  private readonly bakedColorGeos = new WeakMap<
    THREE.BufferGeometry,
    Map<string, THREE.BufferGeometry>
  >();
  private readonly bakedMultiColorGeos = new WeakMap<
    THREE.BufferGeometry,
    Map<string, THREE.BufferGeometry>
  >();
  private readonly whiteVcSlotCache = new WeakMap<THREE.Material, THREE.Material>();
  private readonly unitUvGeoCache = new WeakMap<THREE.BufferGeometry, boolean>();

  /** Clones `geo` with `sampleTex`'s UV transform baked into its `uv` attribute. */
  public getBakedUvGeometry(
    geo: THREE.BufferGeometry,
    sampleTex: THREE.Texture
  ): THREE.BufferGeometry | null {
    const uvAttr = geo.getAttribute('uv');
    if (
      !uvAttr ||
      uvAttr.itemSize !== 2 ||
      (uvAttr as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute
    ) {
      return null;
    }
    const transformSig = `${sampleTex.repeat.x.toFixed(5)}|${sampleTex.repeat.y.toFixed(5)}|${sampleTex.offset.x.toFixed(5)}|${sampleTex.offset.y.toFixed(5)}|${sampleTex.rotation.toFixed(5)}|${sampleTex.center.x.toFixed(5)}|${sampleTex.center.y.toFixed(5)}`;
    let perGeo = this.uvBakedGeoCache.get(geo);
    if (!perGeo) {
      perGeo = new Map<string, THREE.BufferGeometry>();
      this.uvBakedGeoCache.set(geo, perGeo);
    }
    let cached = perGeo.get(transformSig);
    if (cached) return cached;

    sampleTex.updateMatrix();
    const e = sampleTex.matrix.elements;
    const e0 = e[0]!;
    const e1 = e[1]!;
    const e3 = e[3]!;
    const e4 = e[4]!;
    const e6 = e[6]!;
    const e7 = e[7]!;

    const count = uvAttr.count;
    const dst = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const u0 = uvAttr.getX(i);
      const v0 = uvAttr.getY(i);
      dst[i * 2] = e0 * u0 + e3 * v0 + e6;
      dst[i * 2 + 1] = e1 * u0 + e4 * v0 + e7;
    }
    const clonedGeo = geo.clone();
    clonedGeo.setAttribute('uv', new THREE.BufferAttribute(dst, 2));
    perGeo.set(transformSig, clonedGeo);
    return clonedGeo;
  }

  /**
   * Returns the reference texture whose shared non-identity repeat/offset/rotation can be baked
   * into geometry UVs, or `null` when the material's map slots disagree or need no baking.
   */
  public canBakeUniformRepeatUv(
    mat: THREE.MeshPhysicalMaterial,
    allowUvBake: boolean
  ): THREE.Texture | null {
    if (!allowUvBake) return null;
    if (
      mat.aoMap ||
      mat.lightMap ||
      mat.displacementMap ||
      mat.clearcoatNormalMap ||
      mat.anisotropyMap ||
      mat.transmissionMap ||
      mat.thicknessMap ||
      mat.sheenColorMap ||
      mat.sheenRoughnessMap ||
      mat.specularIntensityMap ||
      mat.specularColorMap
    ) {
      return null;
    }
    const effectiveBump = mat.normalMap ? null : mat.bumpMap;
    const slots: (THREE.Texture | null | undefined)[] = [
      mat.map,
      mat.normalMap,
      mat.roughnessMap,
      effectiveBump,
      mat.alphaMap,
      mat.emissiveMap,
      mat.metalnessMap,
      mat.clearcoatMap,
      mat.clearcoatRoughnessMap,
    ];
    let ref: THREE.Texture | null = null;
    for (let i = 0; i < slots.length; i++) {
      const t = slots[i];
      if (!t) continue;
      if (
        t.channel !== 0 ||
        t.matrixAutoUpdate === false ||
        t.wrapS !== THREE.RepeatWrapping ||
        t.wrapT !== THREE.RepeatWrapping ||
        t.repeat.x <= 0 ||
        t.repeat.y <= 0
      ) {
        return null;
      }
      if (!ref) {
        ref = t;
      } else if (
        Math.abs(t.repeat.x - ref.repeat.x) > 1e-4 ||
        Math.abs(t.repeat.y - ref.repeat.y) > 1e-4 ||
        Math.abs(t.offset.x - ref.offset.x) > 1e-4 ||
        Math.abs(t.offset.y - ref.offset.y) > 1e-4 ||
        Math.abs(t.rotation - ref.rotation) > 1e-4 ||
        (Math.abs(ref.rotation) > 1e-4 &&
          (Math.abs(t.center.x - ref.center.x) > 1e-4 ||
            Math.abs(t.center.y - ref.center.y) > 1e-4))
      ) {
        return null;
      }
    }
    if (!ref) return null;
    const isIdentity =
      Math.abs(ref.repeat.x - 1) <= 1e-5 &&
      Math.abs(ref.repeat.y - 1) <= 1e-5 &&
      Math.abs(ref.offset.x) <= 1e-5 &&
      Math.abs(ref.offset.y) <= 1e-5 &&
      Math.abs(ref.rotation) <= 1e-5;
    return isIdentity ? null : ref;
  }

  public hasOnlyUnitUvs(g: THREE.BufferGeometry): boolean {
    const cached = this.unitUvGeoCache.get(g);
    if (cached !== undefined) return cached;
    const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
    if (!uv) {
      this.unitUvGeoCache.set(g, true);
      return true;
    }
    let ok = true;
    for (let i = 0, n = uv.count; i < n; i++) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      if (u < -1e-4 || u > 1.0001 || v < -1e-4 || v > 1.0001) {
        ok = false;
        break;
      }
    }
    this.unitUvGeoCache.set(g, ok);
    return ok;
  }

  /** Clones `geo` with its existing float RGB vertex colors multiplied by `color`. */
  public bakeTintedVertexColorGeometry(
    geo: THREE.BufferGeometry,
    existingColorAttr: THREE.BufferAttribute,
    color: THREE.Color
  ): THREE.BufferGeometry {
    const vcGeoKey = `tintvc|${color.getHexString()}`;
    let perGeo = this.bakedColorGeos.get(geo);
    if (!perGeo) {
      perGeo = new Map<string, THREE.BufferGeometry>();
      this.bakedColorGeos.set(geo, perGeo);
    }
    let vcGeo = perGeo.get(vcGeoKey);
    if (!vcGeo) {
      const vCount = geo.getAttribute('position').count;
      const srcArr = existingColorAttr.array as Float32Array;
      const colArr = new Float32Array(vCount * 3);
      const cr = color.r;
      const cg = color.g;
      const cb = color.b;
      for (let i = 0, n = vCount * 3; i < n; i += 3) {
        colArr[i] = srcArr[i]! * cr;
        colArr[i + 1] = srcArr[i + 1]! * cg;
        colArr[i + 2] = srcArr[i + 2]! * cb;
      }
      vcGeo = geo.clone();
      vcGeo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
      perGeo.set(vcGeoKey, vcGeo);
    }
    return vcGeo;
  }

  /** Clones `geo` with a uniform float RGB `color` vertex attribute. */
  public bakeSolidVertexColorGeometry(
    geo: THREE.BufferGeometry,
    color: THREE.Color
  ): THREE.BufferGeometry {
    const vcGeoKey = color.getHexString();
    let perGeo = this.bakedColorGeos.get(geo);
    if (!perGeo) {
      perGeo = new Map<string, THREE.BufferGeometry>();
      this.bakedColorGeos.set(geo, perGeo);
    }
    let vcGeo = perGeo.get(vcGeoKey);
    if (!vcGeo) {
      const vCount = geo.getAttribute('position').count;
      const colArr = new Float32Array(vCount * 3);
      const cr = color.r;
      const cg = color.g;
      const cb = color.b;
      for (let i = 0, n = vCount * 3; i < n; i += 3) {
        colArr[i] = cr;
        colArr[i + 1] = cg;
        colArr[i + 2] = cb;
      }
      vcGeo = geo.clone();
      vcGeo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
      perGeo.set(vcGeoKey, vcGeo);
    }
    return vcGeo;
  }

  /** Returns the cached white, vertex-colored clone of a multi-material slot material. */
  public getWhiteVertexColorSlotMaterial(m: THREE.Material): THREE.Material {
    let whiteVc = this.whiteVcSlotCache.get(m);
    if (!whiteVc) {
      const c = m.clone() as THREE.MeshStandardMaterial;
      c.color.setRGB(1, 1, 1);
      c.vertexColors = true;
      this.whiteVcSlotCache.set(m, c);
      whiteVc = c;
    }
    return whiteVc;
  }

  /**
   * Bakes per-group flat material colors and uniform-repeat UV transforms of a multi-material
   * mesh into one cached geometry clone, when no vertex is shared by conflicting groups.
   */
  public bakeMultiMaterialGroups(
    geometry: THREE.BufferGeometry,
    materials: readonly THREE.Material[],
    mutableMaterials: ReadonlySet<THREE.Material>
  ): MultiMaterialBakeResult {
    let workGeo = geometry;
    const posAttrMm = workGeo.getAttribute('position');
    const hasExistingColorMm = Boolean(workGeo.getAttribute('color'));
    const slotVcEligible: boolean[] = new Array(materials.length).fill(false);
    let anySlotVc = false;
    if (
      posAttrMm &&
      posAttrMm.count > 0 &&
      !hasExistingColorMm &&
      workGeo.groups.length > 0
    ) {
      for (let s = 0; s < materials.length; s++) {
        const sm = materials[s] as THREE.MeshPhysicalMaterial | undefined;
        if (!sm || isDynamicMaterial(sm, mutableMaterials)) continue;
        const isStd =
          sm.type === 'MeshStandardMaterial' || sm.type === 'MeshPhysicalMaterial';
        const noSpecial =
          !sm.normalMap &&
          !sm.roughnessMap &&
          !sm.bumpMap &&
          !sm.alphaMap &&
          !sm.emissiveMap &&
          !sm.metalnessMap &&
          !sm.displacementMap &&
          !sm.clearcoatMap &&
          !sm.clearcoatRoughnessMap &&
          !sm.clearcoatNormalMap &&
          !sm.sheenColorMap &&
          !sm.sheenRoughnessMap;
        const zeroEm =
          (sm.emissiveIntensity ?? 0) === 0 ||
          ((sm.emissive?.r ?? 0) === 0 &&
            (sm.emissive?.g ?? 0) === 0 &&
            (sm.emissive?.b ?? 0) === 0);
        const simplePhys =
          (sm.transmission ?? 0) === 0 &&
          (sm.clearcoat ?? 0) === 0 &&
          (sm.sheen ?? 0) === 0 &&
          (sm.iridescence ?? 0) === 0 &&
          sm.clearcoatNormalMap == null &&
          (sm.ior === undefined || Math.abs(sm.ior - 1.5) <= 1e-3) &&
          (sm.specularIntensity === undefined || Math.abs(sm.specularIntensity - 1) <= 1e-3);
        if (
          isStd &&
          Boolean(sm.color) &&
          !sm.transparent &&
          (sm.opacity ?? 1) >= 0.999 &&
          !sm.vertexColors &&
          noSpecial &&
          zeroEm &&
          simplePhys
        ) {
          slotVcEligible[s] = true;
          anySlotVc = true;
        }
      }
    }
    const uvAttrMm = workGeo.getAttribute('uv');
    const hasValidUvAttrMm = Boolean(
      uvAttrMm &&
        uvAttrMm.itemSize === 2 &&
        !(uvAttrMm as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute
    );
    const slotUvRefTex = new Array<THREE.Texture | null>(materials.length).fill(null);
    const slotUvSig = new Array<string>(materials.length).fill('');
    let anySlotUv = false;
    if (hasValidUvAttrMm) {
      for (let s = 0; s < materials.length; s++) {
        const sm = materials[s] as THREE.MeshPhysicalMaterial | undefined;
        if (!sm || isDynamicMaterial(sm, mutableMaterials)) continue;
        const refTex = this.canBakeUniformRepeatUv(sm, true);
        if (refTex) {
          slotUvRefTex[s] = refTex;
          slotUvSig[s] =
            `${refTex.repeat.x.toFixed(5)},${refTex.repeat.y.toFixed(5)},${refTex.offset.x.toFixed(5)},${refTex.offset.y.toFixed(5)},${refTex.rotation.toFixed(5)},${refTex.center.x.toFixed(5)},${refTex.center.y.toFixed(5)}`;
          anySlotUv = true;
        }
      }
    }
    let bakedPerGroupVc = false;
    let bakedPerGroupUv = false;
    if ((anySlotVc || anySlotUv) && posAttrMm) {
      const vCount = posAttrMm.count;
      const ownerSig = new Array<string | undefined>(vCount);
      const ownerSlot = new Int32Array(vCount).fill(-1);
      const srcIdx = workGeo.index?.array;
      let conflict = false;
      for (let g = 0; g < workGeo.groups.length && !conflict; g++) {
        const grp = workGeo.groups[g]!;
        if (grp.count <= 0) continue;
        const mIdx = grp.materialIndex ?? 0;
        const sm = materials[mIdx] as THREE.MeshStandardMaterial | undefined;
        const hex = slotVcEligible[mIdx] && sm?.color ? sm.color.getHexString() : 'ffffff';
        const uSig = slotUvSig[mIdx] ?? '';
        const combinedSig = `${hex}@${uSig}`;
        for (let k = 0; k < grp.count; k++) {
          const v = srcIdx ? srcIdx[grp.start + k]! : grp.start + k;
          const prev = ownerSig[v];
          if (prev !== undefined && prev !== combinedSig) {
            conflict = true;
            break;
          }
          ownerSig[v] = combinedSig;
          ownerSlot[v] = mIdx;
        }
      }
      if (!conflict) {
        bakedPerGroupVc = anySlotVc;
        bakedPerGroupUv = anySlotUv;
        const keyParts: string[] = [];
        for (let g = 0; g < workGeo.groups.length; g++) {
          const grp = workGeo.groups[g]!;
          if (grp.count <= 0) continue;
          const mIdx = grp.materialIndex ?? 0;
          const sm = materials[mIdx] as THREE.MeshStandardMaterial | undefined;
          const hex = slotVcEligible[mIdx] && sm?.color ? sm.color.getHexString() : 'ffffff';
          const uSig = slotUvSig[mIdx] ?? '';
          keyParts.push(`${hex}@${uSig}`);
        }
        const mmKey = keyParts.join('|');
        let perMmGeo = this.bakedMultiColorGeos.get(workGeo);
        if (!perMmGeo) {
          perMmGeo = new Map<string, THREE.BufferGeometry>();
          this.bakedMultiColorGeos.set(workGeo, perMmGeo);
        }
        let cachedMmGeo = perMmGeo.get(mmKey);
        if (!cachedMmGeo) {
          const clonedMm = workGeo.clone();
          if (anySlotVc) {
            const colArr = new Float32Array(vCount * 3);
            colArr.fill(1);
            for (let g = 0; g < workGeo.groups.length; g++) {
              const grp = workGeo.groups[g]!;
              if (grp.count <= 0) continue;
              const mIdx = grp.materialIndex ?? 0;
              if (!slotVcEligible[mIdx]) continue;
              const sm = materials[mIdx] as THREE.MeshStandardMaterial;
              const cr = sm.color.r;
              const cg = sm.color.g;
              const cb = sm.color.b;
              for (let k = 0; k < grp.count; k++) {
                const v3 = (srcIdx ? srcIdx[grp.start + k]! : grp.start + k) * 3;
                colArr[v3] = cr;
                colArr[v3 + 1] = cg;
                colArr[v3 + 2] = cb;
              }
            }
            clonedMm.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
          }
          if (anySlotUv && uvAttrMm) {
            const uvCount = uvAttrMm.count;
            const dstUv = new Float32Array(uvCount * 2);
            for (let s = 0; s < slotUvRefTex.length; s++) {
              slotUvRefTex[s]?.updateMatrix();
            }
            for (let vi = 0; vi < uvCount; vi++) {
              const u0 = uvAttrMm.getX(vi);
              const v0 = uvAttrMm.getY(vi);
              const sIdx = vi < ownerSlot.length ? ownerSlot[vi]! : -1;
              const refTex = sIdx >= 0 ? slotUvRefTex[sIdx] : null;
              if (refTex) {
                const e = refTex.matrix.elements;
                dstUv[vi * 2] = e[0]! * u0 + e[3]! * v0 + e[6]!;
                dstUv[vi * 2 + 1] = e[1]! * u0 + e[4]! * v0 + e[7]!;
              } else {
                dstUv[vi * 2] = u0;
                dstUv[vi * 2 + 1] = v0;
              }
            }
            clonedMm.setAttribute('uv', new THREE.BufferAttribute(dstUv, 2));
          }
          perMmGeo.set(mmKey, clonedMm);
          cachedMmGeo = clonedMm;
        }
        workGeo = cachedMmGeo;
      }
    }
    return { geometry: workGeo, slotVcEligible, slotUvRefTex, bakedPerGroupVc, bakedPerGroupUv };
  }
}
