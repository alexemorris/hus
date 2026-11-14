import * as THREE from 'three';
import type { RoomLodController } from '../../lod/lod-manager.ts';
import {
  compactScalarRgbaDataTexture,
  createRgbaDataTextureFromCanvas,
  createScalarDataTextureFromCanvas,
  downsampleDataTextureForMobile,
  isMobileTextureBudgetActive,
  isRecordingCanvasStub,
} from '../../textures/texture-registry.ts';
import { consolidateMultiMaterialGeometry } from '../multi-material-batch-utils.ts';
import type { BatchRestorationStore } from './batch-restoration-store.ts';
import {
  isClosedSolidGeometry,
  isDynamicMaterial,
  LEAF_OR_MICRO_SHADOW_EXCLUDE_RE,
  SHADOW_PASS_HOOK_FLAG,
} from './scene-batch-classification.ts';
import { MaterialUvColorBaker } from './material-uv-color-baker.ts';

export interface MaterialDeduplicationDeps {
  readonly lodController: RoomLodController;
  readonly store: BatchRestorationStore;
}

/**
 * Instance-cached material & texture deduplicator, `R8`/`RG8` scalar `DataTexture` compactor,
 * small-prop `256`/`512` `DataTexture` clamper, uniform-repeat UV & vertex-color geometry baker,
 * multi-material group consolidator, and micro/foliage/LOD2 shadow-caster filter.
 *
 * Holds instance-level caches so `optimize() -> unbatchAll() -> optimize()` reuses canonical
 * `THREE.Material`, `THREE.DataTexture`, and baked `THREE.BufferGeometry` instances with zero leaks.
 */
export class MaterialTextureDeduplicator {
  private readonly canonicalBySig = new Map<string, THREE.Material>();
  private readonly imageIdMap = new WeakMap<object, number>();
  private nextImageId = 1;
  private readonly canonicalSourceByKey = new Map<string, THREE.Source>();
  private readonly canonicalTexBySig = new Map<string, THREE.Texture>();
  private readonly scalarTexCache = new Map<string, THREE.DataTexture | null>();
  private readonly rgbaTexCache = new Map<string, THREE.DataTexture | null>();
  private readonly baker = new MaterialUvColorBaker();

  public deduplicateMaterialsAndCullSmallShadows(
    scene: THREE.Scene,
    mutableMaterials: ReadonlySet<THREE.Material>,
    deps: MaterialDeduplicationDeps
  ): void {
    const { lodController, store } = deps;
    const canonicalBySig = this.canonicalBySig;
    const imageIdMap = this.imageIdMap;
    const canonicalSourceByKey = this.canonicalSourceByKey;
    const canonicalTexBySig = this.canonicalTexBySig;
    const scalarTexCache = this.scalarTexCache;
    const rgbaTexCache = this.rgbaTexCache;
    const baker = this.baker;
    const mobileTextureBudget = isMobileTextureBudgetActive();

    interface ImageSlotUsage {
      colorOrVector: boolean;
      roughness: boolean;
      scalarR: boolean;
      maxWorldSpanM: number;
    }
    const imageUsage = new Map<object, ImageSlotUsage>();
    const isHtmlCanvas = (img: unknown): img is HTMLCanvasElement =>
      typeof img === 'object' &&
      img !== null &&
      !isRecordingCanvasStub(img) &&
      typeof (img as HTMLCanvasElement).getContext === 'function' &&
      typeof (img as HTMLCanvasElement).width === 'number' &&
      typeof (img as HTMLCanvasElement).height === 'number';

    const getImageKeyObj = (tex: THREE.Texture): object | null => {
      const img = tex.image as { data?: object } | undefined;
      if (!img || typeof img !== 'object') return null;
      if ((tex as THREE.DataTexture).isDataTexture && img.data && typeof img.data === 'object') {
        return img.data;
      }
      return img;
    };

    const getImgId = (keyObj: object): number => {
      let id = imageIdMap.get(keyObj);
      if (id === undefined) {
        id = this.nextImageId++;
        imageIdMap.set(keyObj, id);
      }
      return id;
    };

    const markUsage = (
      tex: THREE.Texture | null | undefined,
      kind: 'colorOrVector' | 'roughness' | 'scalarR',
      worldSpanM: number
    ): void => {
      if (!tex) return;
      const isData = Boolean((tex as THREE.DataTexture).isDataTexture);
      if (!isData && !isHtmlCanvas(tex.image)) return;
      const keyObj = getImageKeyObj(tex);
      if (!keyObj) return;
      let u = imageUsage.get(keyObj);
      if (!u) {
        u = { colorOrVector: false, roughness: false, scalarR: false, maxWorldSpanM: 0 };
        imageUsage.set(keyObj, u);
      }
      u[kind] = true;
      if (worldSpanM > u.maxWorldSpanM) {
        u.maxWorldSpanM = worldSpanM;
      }
    };

    const inspectMatUsage = (
      rawMat: THREE.Material | null | undefined,
      worldSpanM: number
    ): void => {
      if (!rawMat) return;
      const m = rawMat as THREE.MeshPhysicalMaterial;
      markUsage(m.map, 'colorOrVector', worldSpanM);
      markUsage(m.emissiveMap, 'colorOrVector', worldSpanM);
      markUsage(m.normalMap, 'colorOrVector', worldSpanM);
      markUsage(m.metalnessMap, 'colorOrVector', worldSpanM);
      markUsage(m.aoMap, 'colorOrVector', worldSpanM);
      markUsage(m.lightMap, 'colorOrVector', worldSpanM);
      markUsage(m.alphaMap, 'colorOrVector', worldSpanM);
      markUsage(m.clearcoatNormalMap, 'colorOrVector', worldSpanM);
      markUsage(m.roughnessMap, 'roughness', worldSpanM);
      markUsage(m.clearcoatRoughnessMap, 'roughness', worldSpanM);
      // Three.js skips bumpMap whenever normalMap is present
      if (!m.normalMap) {
        markUsage(m.bumpMap, 'scalarR', worldSpanM);
      }
      markUsage(m.displacementMap, 'scalarR', worldSpanM);
      markUsage(m.clearcoatMap, 'scalarR', worldSpanM);
    };

    const spanScaleVec = new THREE.Vector3();
    scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh) || obj.userData?.[SHADOW_PASS_HOOK_FLAG]) return;
      if (!obj.geometry.boundingBox) {
        obj.geometry.computeBoundingBox();
      }
      const bb = obj.geometry.boundingBox;
      let worldSpanM = 1.0;
      if (bb) {
        spanScaleVec.setFromMatrixScale(obj.matrixWorld);
        worldSpanM = Math.max(
          (bb.max.x - bb.min.x) * Math.abs(spanScaleVec.x),
          (bb.max.y - bb.min.y) * Math.abs(spanScaleVec.y),
          (bb.max.z - bb.min.z) * Math.abs(spanScaleVec.z)
        );
      }
      if (Array.isArray(obj.material)) {
        for (let i = 0; i < obj.material.length; i++) inspectMatUsage(obj.material[i], worldSpanM);
      } else {
        inspectMatUsage(obj.material, worldSpanM);
      }
    });

    const resolveCompactedOrSourceSharedTex = (
      tex: THREE.Texture | null | undefined,
      forceUnitUv: boolean,
      forceLinearColorSpace = false
    ): THREE.Texture | null => {
      if (!tex) return null;
      let working = tex;
      const targetColorSpace: THREE.ColorSpace = forceLinearColorSpace
        ? THREE.NoColorSpace
        : (working.colorSpace as THREE.ColorSpace);
      const initKeyObj = getImageKeyObj(tex);
      const usage = initKeyObj ? imageUsage.get(initKeyObj) : undefined;
      if (!(tex as THREE.DataTexture).isDataTexture && isHtmlCanvas(tex.image)) {
        if (usage && !usage.colorOrVector && (usage.roughness || usage.scalarR)) {
          const cId = getImgId(tex.image);
          const channels: 1 | 2 = usage.roughness ? 2 : 1;
          const repX = forceUnitUv ? 1 : tex.repeat.x;
          const repY = forceUnitUv ? 1 : tex.repeat.y;
          const offX = forceUnitUv ? 0 : tex.offset.x;
          const offY = forceUnitUv ? 0 : tex.offset.y;
          const ctrX = forceUnitUv ? 0 : tex.center.x;
          const ctrY = forceUnitUv ? 0 : tex.center.y;
          const rot = forceUnitUv ? 0 : tex.rotation;
          const scalarCacheKey = `${cId}:${channels}:${tex.wrapS}:${tex.wrapT}:${repX}:${repY}:${offX}:${offY}:${ctrX}:${ctrY}:${rot}:${tex.flipY ? 1 : 0}`;
          const isRepeatTiled =
            tex.wrapS === THREE.RepeatWrapping || tex.wrapT === THREE.RepeatWrapping;
          const scalarMaxDim = mobileTextureBudget
            ? isRepeatTiled
              ? 256
              : 128
            : isRepeatTiled
              ? Math.min(1024, Math.max(tex.image.width, tex.image.height))
              : 512;
          let scalarTex = scalarTexCache.get(scalarCacheKey);
          if (scalarTex === undefined) {
            scalarTex = createScalarDataTextureFromCanvas(
              `sbo-scalar:${scalarCacheKey}`,
              tex.image,
              channels,
              {
                maxDimension: scalarMaxDim,
                wrapS: tex.wrapS,
                wrapT: tex.wrapT,
                repeat: [repX, repY],
                offset: [offX, offY],
                center: [ctrX, ctrY],
                rotation: rot,
                anisotropy: tex.anisotropy,
                flipY: tex.flipY,
              }
            );
            scalarTexCache.set(scalarCacheKey, scalarTex);
          }
          if (scalarTex) {
            working = scalarTex;
          }
        } else {
          // Convert all remaining static HTMLCanvasElement textures (albedo, normal, artwork, vehicle/prop)
          // to pure CPU DataTextures so zero Skia 2D canvas flushes or copyExternalImageToTexture stalls occur.
          const isSmallClampedProp =
            working.wrapS === THREE.ClampToEdgeWrapping &&
            working.wrapT === THREE.ClampToEdgeWrapping &&
            Boolean(usage && usage.maxWorldSpanM <= 3.2);
          const targetMaxDim = mobileTextureBudget
            ? isSmallClampedProp
              ? usage!.maxWorldSpanM > 0 && usage!.maxWorldSpanM < 1.2
                ? 128
                : 256
              : Math.min(512, Math.max(tex.image.width, tex.image.height))
            : isSmallClampedProp
              ? usage!.maxWorldSpanM > 0 && usage!.maxWorldSpanM < 0.65
                ? 256
                : 512
              : Math.max(tex.image.width, tex.image.height);
          const cId = getImgId(tex.image);
          const repX = forceUnitUv ? 1 : working.repeat.x;
          const repY = forceUnitUv ? 1 : working.repeat.y;
          const offX = forceUnitUv ? 0 : working.offset.x;
          const offY = forceUnitUv ? 0 : working.offset.y;
          const ctrX = forceUnitUv ? 0 : working.center.x;
          const ctrY = forceUnitUv ? 0 : working.center.y;
          const rot = forceUnitUv ? 0 : working.rotation;
          const rgbaKey = `${cId}:${targetMaxDim}:${working.wrapS}:${working.wrapT}:${repX}:${repY}:${offX}:${offY}:${ctrX}:${ctrY}:${rot}:${targetColorSpace}:${working.flipY ? 1 : 0}`;
          let dataTex = rgbaTexCache.get(rgbaKey);
          if (dataTex === undefined) {
            dataTex = createRgbaDataTextureFromCanvas(`sbo-rgba:${rgbaKey}`, tex.image, {
              maxDimension: targetMaxDim,
              wrapS: working.wrapS,
              wrapT: working.wrapT,
              repeat: [repX, repY],
              offset: [offX, offY],
              center: [ctrX, ctrY],
              rotation: rot,
              colorSpace: targetColorSpace,
              anisotropy: working.anisotropy,
              flipY: working.flipY,
            });
            rgbaTexCache.set(rgbaKey, dataTex);
          }
          if (dataTex) {
            dataTex.name = working.name;
            working = dataTex;
          }
        }
      } else if ((tex as THREE.DataTexture).isDataTexture) {
        let dataTex = tex as THREE.DataTexture;
        if (mobileTextureBudget) {
          const isSmallClampedProp =
            tex.wrapS === THREE.ClampToEdgeWrapping &&
            tex.wrapT === THREE.ClampToEdgeWrapping &&
            Boolean(usage && usage.maxWorldSpanM <= 3.2);
          dataTex = downsampleDataTextureForMobile(dataTex, isSmallClampedProp ? 256 : 512);
          working = dataTex;
        }
        if (initKeyObj && usage && !usage.colorOrVector && (usage.roughness || usage.scalarR)) {
          const dId = getImgId(initKeyObj);
          const channels: 1 | 2 = usage.roughness ? 2 : 1;
          const compacted = compactScalarRgbaDataTexture(`sbo-dtex:${dId}`, dataTex, channels);
          if (compacted) {
            working = compacted;
          }
        }
      }

      const keyObj = getImageKeyObj(working);
      if (!keyObj) return working;
      const imgId = getImgId(keyObj);
      const effColorSpace = forceLinearColorSpace ? THREE.NoColorSpace : working.colorSpace;
      const needsLinearClone = forceLinearColorSpace && working.colorSpace !== THREE.NoColorSpace;
      const srcKey = `${imgId}|${working.format}|${working.type}|${effColorSpace}|${working.flipY ? 1 : 0}|${working.generateMipmaps ? 1 : 0}`;

      const rx = forceUnitUv ? 1 : working.repeat.x;
      const ry = forceUnitUv ? 1 : working.repeat.y;
      const ox = forceUnitUv ? 0 : working.offset.x;
      const oy = forceUnitUv ? 0 : working.offset.y;
      const rot = forceUnitUv ? 0 : working.rotation;
      const cx = forceUnitUv ? 0 : rot !== 0 ? working.center.x : 0;
      const cy = forceUnitUv ? 0 : rot !== 0 ? working.center.y : 0;

      const sig = `${srcKey}|${rx.toFixed(4)}|${ry.toFixed(4)}|${ox.toFixed(4)}|${oy.toFixed(4)}|${rot.toFixed(4)}|${cx.toFixed(4)}|${cy.toFixed(4)}|${working.wrapS}|${working.wrapT}`;
      let canon = canonicalTexBySig.get(sig);
      if (!canon) {
        const needsUnitClone =
          forceUnitUv &&
          (Math.abs(working.repeat.x - 1) > 1e-5 ||
            Math.abs(working.repeat.y - 1) > 1e-5 ||
            Math.abs(working.offset.x) > 1e-5 ||
            Math.abs(working.offset.y) > 1e-5 ||
            Math.abs(working.rotation) > 1e-5);
        if (needsUnitClone || needsLinearClone) {
          const unitClone = working.clone();
          unitClone.source = working.source;
          unitClone.colorSpace = effColorSpace;
          if (needsUnitClone) {
            unitClone.repeat.set(1, 1);
            unitClone.offset.set(0, 0);
            unitClone.center.set(0, 0);
            unitClone.rotation = 0;
          }
          unitClone.version = Math.max(1, working.version);
          canon = unitClone;
        } else {
          canon = working;
        }
        let sharedSource = canonicalSourceByKey.get(srcKey);
        if (!sharedSource) {
          sharedSource = canon.source;
          canonicalSourceByKey.set(srcKey, sharedSource);
        } else if (canon.source !== sharedSource) {
          canon.source = sharedSource;
        }
        canonicalTexBySig.set(sig, canon);
      }
      return canon;
    };

    const nonUnitUvMaterials = new WeakSet<THREE.Material>();
    scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh) || Array.isArray(obj.material) || !obj.material) return;
      if (!baker.hasOnlyUnitUvs(obj.geometry)) {
        nonUnitUvMaterials.add(obj.material);
      }
    });

    const canonicalizeMaterial = (
      rawMat: THREE.Material,
      geo: THREE.BufferGeometry,
      allowUvBake: boolean | 'prebaked',
      _isInteriorScope = false
    ): { readonly material: THREE.Material; readonly geometry: THREE.BufferGeometry } => {
      const mat = rawMat as THREE.MeshPhysicalMaterial;
      const rawNode = rawMat as THREE.Material & {
        readonly isNodeMaterial?: boolean;
        readonly positionNode?: unknown;
        readonly colorNode?: unknown;
      };
      if (
        rawNode.isNodeMaterial === true ||
        rawNode.positionNode != null ||
        rawNode.colorNode != null ||
        Boolean(rawMat.userData?.skipMaterialDedupe) ||
        Boolean(rawMat.userData?.isVegetationMaterial) ||
        isDynamicMaterial(mat, mutableMaterials)
      ) {
        // Three.js ignores bumpMap whenever normalMap is present, so drop the dead reference on
        // mobile to let its texel buffer be collected instead of retained for the session.
        if (
          mobileTextureBudget &&
          mat.normalMap &&
          mat.bumpMap &&
          !isDynamicMaterial(mat, mutableMaterials)
        ) {
          mat.bumpMap = null;
        }
        return { material: rawMat, geometry: geo };
      }

      let outGeo = geo;
      let forceUnitUv = allowUvBake === 'prebaked';
      const allowVcConsolidation = Boolean(allowUvBake);
      const uvRefTex = allowUvBake === true ? baker.canBakeUniformRepeatUv(mat, true) : null;
      if (uvRefTex) {
        const baked = baker.getBakedUvGeometry(geo, uvRefTex);
        if (baked) {
          outGeo = baked;
          forceUnitUv = true;
        }
      }

      const map = resolveCompactedOrSourceSharedTex(mat.map, forceUnitUv, false);
      const normalMap = resolveCompactedOrSourceSharedTex(mat.normalMap, forceUnitUv, true);
      const roughnessMap = resolveCompactedOrSourceSharedTex(mat.roughnessMap, forceUnitUv, true);
      // Drop redundant bumpMap when normalMap is active (Three.js shader uses normalMap else bumpMap)
      const bumpMap = normalMap
        ? null
        : resolveCompactedOrSourceSharedTex(mat.bumpMap, forceUnitUv, true);
      const alphaMap = resolveCompactedOrSourceSharedTex(mat.alphaMap, forceUnitUv, true);
      const emissiveMap = resolveCompactedOrSourceSharedTex(mat.emissiveMap, forceUnitUv, false);
      const metalnessMap = resolveCompactedOrSourceSharedTex(mat.metalnessMap, forceUnitUv, true);
      const displacementMap = resolveCompactedOrSourceSharedTex(
        mat.displacementMap,
        forceUnitUv,
        true
      );
      const clearcoatMap = resolveCompactedOrSourceSharedTex(mat.clearcoatMap, forceUnitUv, true);
      const clearcoatRoughnessMap = resolveCompactedOrSourceSharedTex(
        mat.clearcoatRoughnessMap,
        forceUnitUv,
        true
      );

      const matUserEarly = mat.userData as Record<string, unknown> | undefined;
      const preserveDoubleSide = Boolean(matUserEarly?.preserveDoubleSide);
      const targetSide =
        mat.side === THREE.DoubleSide &&
        !preserveDoubleSide &&
        !mat.transparent &&
        isClosedSolidGeometry(outGeo)
          ? THREE.FrontSide
          : mat.side;

      const posAttrForVc = outGeo.getAttribute('position');
      const existingColorAttr = outGeo.getAttribute('color') as THREE.BufferAttribute | undefined;
      const isStdOrPhys =
        mat.type === 'MeshStandardMaterial' || mat.type === 'MeshPhysicalMaterial';
      const hasNoSpecialMaps =
        !alphaMap &&
        !emissiveMap &&
        !metalnessMap &&
        !displacementMap &&
        !clearcoatMap &&
        !clearcoatRoughnessMap &&
        !mat.clearcoatNormalMap &&
        !mat.sheenColorMap &&
        !mat.sheenRoughnessMap &&
        !mat.specularIntensityMap &&
        !mat.specularColorMap;
      const hasNoPbrDetailMaps = !normalMap && !roughnessMap && !bumpMap;
      const hasNoMaps = !map && hasNoPbrDetailMaps && hasNoSpecialMaps;
      const isZeroEmissive =
        (mat.emissiveIntensity ?? 0) === 0 ||
        ((mat.emissive?.r ?? 0) === 0 &&
          (mat.emissive?.g ?? 0) === 0 &&
          (mat.emissive?.b ?? 0) === 0);
      const hasCustomPhysicalResponse =
        (mat.clearcoat ?? 0) > 0 ||
        (mat.sheen ?? 0) > 0 ||
        mat.clearcoatNormalMap != null ||
        (mat.ior !== undefined && Math.abs(mat.ior - 1.5) > 1e-3) ||
        (mat.specularIntensity !== undefined && Math.abs(mat.specularIntensity - 1) > 1e-3);
      const isSimplePhysical =
        ((mat as THREE.MeshPhysicalMaterial).transmission ?? 0) === 0 &&
        ((mat as THREE.MeshPhysicalMaterial).iridescence ?? 0) === 0 &&
        !hasCustomPhysicalResponse;
      const matUser = mat.userData as Record<string, unknown> | undefined;
      const hasRuntimeOpacityToggle = matUser?.cutawayLightOpacity !== undefined;

      const canBakeOpaqueVc =
        allowVcConsolidation &&
        isStdOrPhys &&
        Boolean(mat.color) &&
        !mat.transparent &&
        (mat.opacity ?? 1) >= 0.999 &&
        !mat.vertexColors &&
        !existingColorAttr &&
        Boolean(posAttrForVc && posAttrForVc.count > 0) &&
        hasNoSpecialMaps &&
        hasNoPbrDetailMaps &&
        isZeroEmissive &&
        isSimplePhysical;

      const hasValidFloat3ColorAttr = Boolean(
        existingColorAttr &&
          existingColorAttr.itemSize === 3 &&
          !existingColorAttr.normalized &&
          existingColorAttr.array instanceof Float32Array
      );
      const isWhiteTint =
        Boolean(mat.color) && mat.color.r >= 0.99 && mat.color.g >= 0.99 && mat.color.b >= 0.99;

      const canShareExistingOpaqueVc =
        allowVcConsolidation &&
        isStdOrPhys &&
        isWhiteTint &&
        !mat.transparent &&
        (mat.opacity ?? 1) >= 0.999 &&
        mat.vertexColors === true &&
        hasValidFloat3ColorAttr &&
        hasNoSpecialMaps &&
        hasNoPbrDetailMaps &&
        isZeroEmissive &&
        isSimplePhysical;

      const canTintExistingOpaqueVc =
        allowVcConsolidation &&
        isStdOrPhys &&
        Boolean(mat.color) &&
        !isWhiteTint &&
        !mat.transparent &&
        (mat.opacity ?? 1) >= 0.999 &&
        hasValidFloat3ColorAttr &&
        mat.vertexColors === true &&
        hasNoSpecialMaps &&
        hasNoPbrDetailMaps &&
        isZeroEmissive &&
        isSimplePhysical;

      const canBakeTransparentVc =
        allowVcConsolidation &&
        isStdOrPhys &&
        Boolean(mat.color) &&
        mat.transparent &&
        (mat.blending ?? THREE.NormalBlending) === THREE.NormalBlending &&
        !hasRuntimeOpacityToggle &&
        !mat.vertexColors &&
        !existingColorAttr &&
        Boolean(posAttrForVc && posAttrForVc.count > 0) &&
        hasNoMaps &&
        isZeroEmissive &&
        isSimplePhysical;

      const canBakeEmissiveVc =
        allowVcConsolidation &&
        isStdOrPhys &&
        Boolean(mat.color) &&
        !mat.transparent &&
        (mat.opacity ?? 1) >= 0.999 &&
        !mat.vertexColors &&
        !existingColorAttr &&
        Boolean(posAttrForVc && posAttrForVc.count > 0) &&
        hasNoMaps &&
        !isZeroEmissive &&
        isSimplePhysical;

      const needsBakeVertexColors = canBakeOpaqueVc || canBakeTransparentVc || canBakeEmissiveVc;
      const canUseVertexColorConsolidation =
        needsBakeVertexColors || canShareExistingOpaqueVc || canTintExistingOpaqueVc;

      if (canTintExistingOpaqueVc && existingColorAttr && posAttrForVc) {
        outGeo = baker.bakeTintedVertexColorGeometry(outGeo, existingColorAttr, mat.color);
      } else if (needsBakeVertexColors && posAttrForVc) {
        outGeo = baker.bakeSolidVertexColorGeometry(outGeo, mat.color);
      }

      const rawRough = mat.roughness ?? 0.5;
      const rawMetal = mat.metalness ?? 0;
      const preserveExactPbrScalars = !hasNoPbrDetailMaps || hasCustomPhysicalResponse;
      const qRough = canUseVertexColorConsolidation
        ? rawRough < 0.34
          ? 0.22
          : rawRough < 0.68
            ? 0.52
            : 0.85
        : preserveExactPbrScalars
          ? rawRough
          : Math.round(rawRough * 20) / 20;
      const qMetal = canUseVertexColorConsolidation
        ? rawMetal >= 0.45
          ? 0.88
          : 0.0
        : rawMetal < 0.06
          ? 0
          : Math.round(rawMetal * 20) / 20;
      const qOpacity = canBakeTransparentVc
        ? Math.max(0.05, Math.min(0.95, Math.round((mat.opacity ?? 1) * 8) / 8))
        : (mat.opacity ?? 1);
      const qEmissiveIntensity = canBakeEmissiveVc
        ? Math.round((mat.emissiveIntensity ?? 1) * 4) / 4
        : (mat.emissiveIntensity ?? 0);
      const rawClearcoat = mat.clearcoat ?? 0;
      const downgradePhysicalToStandard =
        canUseVertexColorConsolidation && !hasCustomPhysicalResponse && rawClearcoat < 0.12;
      const canonMatType = downgradePhysicalToStandard ? 'MeshStandardMaterial' : mat.type;
      const qClearcoat = downgradePhysicalToStandard
        ? 0
        : canUseVertexColorConsolidation
          ? Math.round(rawClearcoat * 4) / 4
          : rawClearcoat;
      const qClearcoatRough = downgradePhysicalToStandard
        ? 0
        : canUseVertexColorConsolidation
          ? 0.2
          : (mat.clearcoatRoughness ?? 0);
      const rawSheen = mat.sheen ?? 0;
      const rawSheenRough = mat.sheenRoughness ?? 1;
      const rawSheenColorHex = rawSheen > 0 ? (mat.sheenColor?.getHexString?.() ?? 'ffffff') : '';
      const rawIor = canonMatType === 'MeshPhysicalMaterial' ? (mat.ior ?? 1.5) : 1.5;
      const rawSpecInt =
        canonMatType === 'MeshPhysicalMaterial' ? (mat.specularIntensity ?? 1) : 1;
      const rawSpecColorHex =
        canonMatType === 'MeshPhysicalMaterial' && rawSpecInt > 0
          ? (mat.specularColor?.getHexString?.() ?? 'ffffff')
          : '';
      const rawEnvMapInt = mat.envMapIntensity ?? 1;
      const rawCcNs =
        mat.clearcoatNormalMap != null
          ? `${(mat.clearcoatNormalScale?.x ?? 1).toFixed(2)},${(mat.clearcoatNormalScale?.y ?? 1).toFixed(2)}`
          : '';
      const canonPolyOffset =
        canUseVertexColorConsolidation && !mat.transparent ? false : Boolean(mat.polygonOffset);

      const qBumpScale = bumpMap
        ? canUseVertexColorConsolidation
          ? Math.abs(mat.bumpScale ?? 0) < 0.012
            ? 0.003
            : 0.03
          : (mat.bumpScale ?? 0)
        : 0;
      const rawNsX = mat.normalScale?.x ?? 1;
      const rawNsY = mat.normalScale?.y ?? 1;
      const qNsX = normalMap
        ? canUseVertexColorConsolidation
          ? Math.sign(rawNsX || 1) * (Math.abs(rawNsX) < 0.5 ? 0.35 : 1.0)
          : rawNsX
        : 1;
      const qNsY = normalMap
        ? canUseVertexColorConsolidation
          ? Math.sign(rawNsY || 1) * (Math.abs(rawNsY) < 0.5 ? 0.35 : 1.0)
          : rawNsY
        : 1;

      const sig = [
        canonMatType,
        canUseVertexColorConsolidation ? 'VC' : (mat.color?.getHexString?.() ?? ''),
        canBakeOpaqueVc ||
        canShareExistingOpaqueVc ||
        canTintExistingOpaqueVc ||
        canBakeTransparentVc
          ? '000000'
          : (mat.emissive?.getHexString?.() ?? ''),
        canBakeOpaqueVc ||
        canShareExistingOpaqueVc ||
        canTintExistingOpaqueVc ||
        canBakeTransparentVc
          ? '0.00'
          : qEmissiveIntensity.toFixed(2),
        qRough.toFixed(3),
        qMetal.toFixed(2),
        bumpMap ? qBumpScale.toFixed(3) : '0',
        normalMap ? `${qNsX.toFixed(2)},${qNsY.toFixed(2)}` : '',
        qOpacity.toFixed(2),
        mat.transparent ? '1' : '0',
        targetSide,
        mat.depthWrite ? '1' : '0',
        canonPolyOffset ? '1' : '0',
        qClearcoat.toFixed(3),
        qClearcoatRough.toFixed(3),
        rawSheen.toFixed(3),
        rawSheen > 0 ? `${rawSheenRough.toFixed(3)}:${rawSheenColorHex}` : '',
        rawIor.toFixed(3),
        rawSpecInt.toFixed(3),
        rawSpecColorHex,
        rawEnvMapInt.toFixed(2),
        rawCcNs,
        map?.uuid ?? '',
        normalMap?.uuid ?? '',
        roughnessMap?.uuid ?? '',
        bumpMap?.uuid ?? '',
        alphaMap?.uuid ?? '',
        emissiveMap?.uuid ?? '',
        metalnessMap?.uuid ?? '',
        displacementMap?.uuid ?? '',
        clearcoatMap?.uuid ?? '',
        clearcoatRoughnessMap?.uuid ?? '',
        mat.clearcoatNormalMap?.uuid ?? '',
        mat.sheenColorMap?.uuid ?? '',
        mat.sheenRoughnessMap?.uuid ?? '',
      ].join('|');

      let existing = canonicalBySig.get(sig);
      if (!existing) {
        const needsClone =
          canUseVertexColorConsolidation ||
          mat.side !== targetSide ||
          (mat.map ?? null) !== map ||
          (mat.normalMap ?? null) !== normalMap ||
          (mat.roughnessMap ?? null) !== roughnessMap ||
          (mat.bumpMap ?? null) !== bumpMap ||
          (mat.alphaMap ?? null) !== alphaMap ||
          (mat.emissiveMap ?? null) !== emissiveMap ||
          (mat.metalnessMap ?? null) !== metalnessMap ||
          (mat.displacementMap ?? null) !== displacementMap ||
          (mat.clearcoatMap ?? null) !== clearcoatMap ||
          (mat.clearcoatRoughnessMap ?? null) !== clearcoatRoughnessMap;
        if (needsClone) {
          const cloned = (
            downgradePhysicalToStandard && mat.type === 'MeshPhysicalMaterial'
              ? new THREE.MeshStandardMaterial({
                  color: 0xffffff,
                  roughness: qRough,
                  metalness: qMetal,
                  transparent: mat.transparent,
                  opacity: qOpacity,
                  blending: mat.blending,
                  depthWrite: mat.depthWrite,
                  depthTest: mat.depthTest,
                  alphaTest: mat.alphaTest,
                  emissive: mat.emissive?.clone?.() ?? new THREE.Color(0x000000),
                  emissiveIntensity: canBakeEmissiveVc
                    ? qEmissiveIntensity
                    : (mat.emissiveIntensity ?? 1),
                })
              : mat.clone()
          ) as THREE.MeshPhysicalMaterial;
          if (canUseVertexColorConsolidation) {
            cloned.color.setRGB(1, 1, 1);
            cloned.vertexColors = true;
            cloned.roughness = qRough;
            cloned.metalness = qMetal;
            cloned.polygonOffset = canonPolyOffset;
            if (bumpMap) cloned.bumpScale = qBumpScale;
            if (normalMap) cloned.normalScale.set(qNsX, qNsY);
            if (canBakeTransparentVc) {
              cloned.opacity = qOpacity;
            }
            if (canBakeEmissiveVc) {
              cloned.emissiveIntensity = qEmissiveIntensity;
            }
          }
          if (preserveDoubleSide) {
            cloned.userData = { ...(cloned.userData ?? {}), preserveDoubleSide: true };
          }
          cloned.side = targetSide;
          cloned.map = map;
          cloned.normalMap = normalMap;
          cloned.roughnessMap = roughnessMap;
          cloned.bumpMap = bumpMap;
          cloned.alphaMap = alphaMap;
          cloned.emissiveMap = emissiveMap;
          cloned.metalnessMap = metalnessMap;
          cloned.displacementMap = displacementMap;
          if ('clearcoatMap' in cloned) cloned.clearcoatMap = clearcoatMap;
          if ('clearcoatRoughnessMap' in cloned) {
            cloned.clearcoatRoughnessMap = clearcoatRoughnessMap;
          }
          existing = cloned;
        } else {
          existing = mat;
        }
        canonicalBySig.set(sig, existing);
      }
      return { material: existing, geometry: outGeo };
    };

    const visit = (
      node: THREE.Object3D,
      ancestorHighLod: boolean,
      ancestorLeafOrPlant: boolean,
      ancestorPergola: boolean,
      ancestorZone: string | undefined
    ): void => {
      const u = node.userData;
      const nextZone =
        (typeof (u?.zoneId ?? u?.zone) === 'string'
          ? ((u?.zoneId ?? u?.zone) as string)
          : undefined) ??
        lodController.inferZoneFromName(node.name) ??
        ancestorZone;
      const isInteriorScope = Boolean(nextZone && !lodController.isExteriorZone(nextZone));
      const nameStr = typeof node.name === 'string' ? node.name : '';
      const isHighLod = ancestorHighLod || u?.lodTier === 2 || u?.lodTier === 'high';
      const isLeafOrPlant =
        ancestorLeafOrPlant ||
        (nameStr.length > 0 && LEAF_OR_MICRO_SHADOW_EXCLUDE_RE.test(nameStr));
      const isPergola = ancestorPergola || nameStr.includes('grapeVinePergola');

      if (node.userData?.[SHADOW_PASS_HOOK_FLAG]) return;

      if (node instanceof THREE.Mesh) {
        store.snapshotMeshPropsIfAbsent(node);
        if (!node.geometry.boundingBox) {
          node.geometry.computeBoundingBox();
        }
        if (!node.geometry.boundingSphere) {
          node.geometry.computeBoundingSphere();
        }

        if (node.castShadow) {
          const allowFoliageShadow = Boolean(u?.allowFoliageShadow);
          if (isHighLod || (isLeafOrPlant && !allowFoliageShadow)) {
            node.castShadow = false;
          } else {
            const sphere = node.geometry.boundingSphere;
            const bbox = node.geometry.boundingBox;
            const sx = Math.abs(node.scale.x);
            const sy = Math.abs(node.scale.y);
            const sz = Math.abs(node.scale.z);
            const maxScale = Math.max(sx, sy, sz);
            if (isPergola && bbox) {
              const minBoxDim = Math.min(
                (bbox.max.x - bbox.min.x) * sx,
                (bbox.max.y - bbox.min.y) * sy,
                (bbox.max.z - bbox.min.z) * sz
              );
              if (minBoxDim < 0.06) {
                node.castShadow = false;
              }
            }
            if (node.castShadow && sphere) {
              const isArch =
                Boolean(u?.isArchitecturalShell) ||
                Boolean(u?.cutawayWall) ||
                Boolean(u?.isCutawayWall);
              const minShadowRadius = isArch ? 0.22 : 0.42;
              if (sphere.radius * maxScale < minShadowRadius) {
                node.castShadow = false;
              }
            }
          }
        }

        if (Array.isArray(node.material)) {
          const baked = baker.bakeMultiMaterialGroups(node.geometry, node.material, mutableMaterials);
          const workGeo = baked.geometry;
          const { slotVcEligible, slotUvRefTex, bakedPerGroupVc, bakedPerGroupUv } = baked;
          const canonSlots = node.material.map((m, idx) => {
            if (!m) return m;
            const uvMode: boolean | 'prebaked' =
              bakedPerGroupUv && Boolean(slotUvRefTex[idx]) ? 'prebaked' : false;
            if (bakedPerGroupVc && slotVcEligible[idx]) {
              const whiteVc = baker.getWhiteVertexColorSlotMaterial(m);
              return canonicalizeMaterial(whiteVc, workGeo, uvMode, isInteriorScope).material;
            }
            return canonicalizeMaterial(m, workGeo, uvMode, isInteriorScope).material;
          });
          const consolidated = consolidateMultiMaterialGeometry(workGeo, canonSlots);
          if (consolidated.geometry !== node.geometry) {
            node.geometry = consolidated.geometry;
            store.markGeometrySwappedIfPostUnbatch(node);
          }
          if (consolidated.materials.length === 1) {
            node.material = consolidated.materials[0]!;
          } else {
            node.material = [...consolidated.materials];
          }
        } else if (node.material) {
          const mat = node.material as THREE.MeshStandardMaterial;
          if (mat.blending === THREE.AdditiveBlending && mat.depthWrite === false) {
            node.raycast = (): void => {};
          }
          const canon = canonicalizeMaterial(mat, node.geometry, true, isInteriorScope);
          if (canon.geometry !== node.geometry) {
            node.geometry = canon.geometry;
            store.markGeometrySwappedIfPostUnbatch(node);
          }
          node.material = canon.material;
        }
      }

      for (const child of node.children) {
        visit(child, isHighLod, isLeafOrPlant, isPergola, nextZone);
      }
    };

    visit(scene, false, false, false, undefined);
  }
}
