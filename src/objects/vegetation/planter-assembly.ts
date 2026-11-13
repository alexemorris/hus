import * as THREE from 'three';
import type { MeshStandardNodeMaterial } from 'three/webgpu';
import type { AssetMetadata } from '../../core/assets/asset-metadata.ts';
import {
  getExposureEnvelope,
  type VegetationExposure,
} from '../../core/geo/climate-phenology.ts';
import { attachAssetMetadata } from '../../engine/assets/smart-asset.ts';
import { tagCollisionRole } from '../../engine/geometry/mesh-traits.ts';
import type { BarkTextureStyle } from '../../engine/vegetation/vegetation-textures.ts';
import type { VegetationUniforms } from '../../engine/vegetation/vegetation-uniforms.ts';
import type { OrganCollector } from './organ-geometry.ts';
import { getSharedPhenologyMaterial } from './phenology-material.ts';
import { createSoilBed, createSoilMaterial } from './soil-bed.ts';

export type PlanterStyle =
  | 'terracotta'
  | 'glazed-ceramic'
  | 'stoneware'
  | 'lead-cube'
  | 'woven-basket';

const PLANTER_MATERIAL_CACHE = new Map<string, THREE.MeshStandardMaterial>();

function getPlanterMaterial(style: PlanterStyle): THREE.MeshStandardMaterial {
  let mat = PLANTER_MATERIAL_CACHE.get(style);
  if (!mat) {
    const specs: Record<PlanterStyle, { color: number; roughness: number; metalness: number }> = {
      terracotta: { color: 0xb55d3c, roughness: 0.78, metalness: 0.0 },
      'glazed-ceramic': { color: 0x3d554c, roughness: 0.24, metalness: 0.04 },
      stoneware: { color: 0xd8d2c7, roughness: 0.68, metalness: 0.0 },
      'lead-cube': { color: 0x464b50, roughness: 0.56, metalness: 0.38 },
      'woven-basket': { color: 0xa9895b, roughness: 0.88, metalness: 0.0 },
    };
    const s = specs[style];
    mat = new THREE.MeshStandardMaterial({
      name: `husjs.vegetation.planter.${style}`,
      color: s.color,
      roughness: s.roughness,
      metalness: s.metalness,
    });
    PLANTER_MATERIAL_CACHE.set(style, mat);
  }
  return mat;
}

export function getMulchSoilMaterial(): MeshStandardNodeMaterial {
  return createSoilMaterial({ substrate: 'bark-mulch' });
}

export function buildPlanterAssembly(opts: {
  readonly style: PlanterStyle;
  readonly radiusTop: number;
  readonly radiusBottom: number;
  readonly height: number;
  readonly namePrefix: string;
  readonly exposure?: VegetationExposure;
  readonly uniforms?: VegetationUniforms;
  readonly seed?: number;
}): { readonly group: THREE.Group; readonly soilY: number } {
  const group = new THREE.Group();
  group.name = `${opts.namePrefix}.planter`;
  const h = opts.height;
  const rTop = opts.radiusTop;
  const rBot = opts.radiusBottom;
  const exposure = opts.exposure ?? 'outdoor';
  const mat = getPlanterMaterial(opts.style);

  if (opts.style === 'lead-cube') {
    const w = rTop * 1.88;
    const wall = Math.max(0.02, w * 0.07);
    const rimH = Math.max(0.026, wall * 1.15);
    const bodyH = Math.max(0.05, h - rimH);
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, bodyH, w), mat);
    body.name = `${opts.namePrefix}.planterBox`;
    body.position.y = bodyH * 0.5;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const outerW = w + wall * 0.8;
    const innerOpening = Math.max(0.08, w - wall * 1.2);
    const barThick = (outerW - innerOpening) * 0.5;
    const rimY = h - rimH * 0.5;
    const rimOffset = (innerOpening + barThick) * 0.5;
    for (const [barSuffix, bx, bz, bw, bd] of [
      ['N', 0, -rimOffset, outerW, barThick],
      ['S', 0, rimOffset, outerW, barThick],
      ['W', -rimOffset, 0, barThick, innerOpening],
      ['E', rimOffset, 0, barThick, innerOpening],
    ] as const) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(bw, rimH, bd), mat);
      bar.name = `${opts.namePrefix}.planterRim${barSuffix}`;
      bar.position.set(bx, rimY, bz);
      bar.castShadow = true;
      bar.receiveShadow = true;
      group.add(bar);
    }

    const baseLipY = bodyH + rimH * 0.42;
    const innerSpan = Math.max(0.07, innerOpening - 0.008);
    const soilBed = createSoilBed({
      substrate: 'potting-compost',
      exposure,
      width: innerSpan,
      depth: innerSpan,
      baseY: baseLipY,
      crownHeightM: 0.016,
      edgeRecessM: 0.004,
      gridStepM: Math.max(0.04, innerSpan * 0.2),
      plantings: [{ x: 0, z: 0, stemRadius: 0.03, moundRadius: 0.11, moundHeight: 0.012 }],
      uniforms: opts.uniforms,
      seed: opts.seed,
      name: `${opts.namePrefix}.soil`,
    });
    group.add(soilBed.group);
    return { group, soilY: soilBed.samplePlantingY(0, 0) };
  }

  const wallT = Math.max(0.014, rTop * 0.08);
  const innerFloorY = Math.max(0.02, h - wallT * 1.6 - 0.024);
  const profile: THREE.Vector2[] = [
    new THREE.Vector2(0.001, 0),
    new THREE.Vector2(rBot, 0),
    new THREE.Vector2(THREE.MathUtils.lerp(rBot, rTop, 0.55), h * 0.52),
    new THREE.Vector2(rTop, h * 0.9),
    new THREE.Vector2(rTop + wallT * 0.55, h * 0.94),
    new THREE.Vector2(rTop + wallT * 0.55, h),
    new THREE.Vector2(Math.max(0.02, rTop - wallT), h),
    new THREE.Vector2(Math.max(0.02, rTop - wallT), innerFloorY),
    new THREE.Vector2(0.001, innerFloorY),
  ];
  const potGeo = new THREE.LatheGeometry(profile, 18);
  const potMesh = new THREE.Mesh(potGeo, mat);
  potMesh.name = `${opts.namePrefix}.pot`;
  potMesh.castShadow = true;
  potMesh.receiveShadow = true;
  group.add(potMesh);

  const baseLipY = h - wallT * 1.45;
  const innerRadius = Math.max(0.04, rTop - wallT * 0.96);
  const soilBed = createSoilBed({
    substrate: 'potting-compost',
    exposure,
    radius: innerRadius,
    radialSegments: 18,
    baseY: baseLipY,
    crownHeightM: 0.018,
    edgeRecessM: 0.006,
    gridStepM: Math.max(0.04, innerRadius * 0.32),
    plantings: [{ x: 0, z: 0, stemRadius: 0.03, moundRadius: 0.11, moundHeight: 0.014 }],
    uniforms: opts.uniforms,
    seed: opts.seed,
    name: `${opts.namePrefix}.soil`,
  });
  group.add(soilBed.group);

  return { group, soilY: soilBed.samplePlantingY(0, 0) };
}

export function assembleBotanicalMeshes(opts: {
  readonly group: THREE.Group;
  readonly namePrefix: string;
  readonly exposure: VegetationExposure;
  readonly barkCollector?: OrganCollector;
  readonly foliageCollector?: OrganCollector;
  readonly barkStyle?: BarkTextureStyle;
  readonly uniforms?: VegetationUniforms;
  readonly castCanopyShadow?: boolean;
  readonly solidTrunkCollision?: boolean;
  readonly trunkColliderRadius?: number;
  readonly trunkColliderHeight?: number;
  readonly metadata?: AssetMetadata;
}): THREE.Group {
  const { group, exposure } = opts;
  group.userData['vegetationExposure'] = exposure;
  group.userData['tradeCategory'] = exposure === 'indoor' ? 'decor' : 'external';
  const castShadow = opts.castCanopyShadow ?? true;

  if (opts.barkCollector && !opts.barkCollector.isEmpty()) {
    const barkMat = getSharedPhenologyMaterial({
      exposure,
      surface: 'bark',
      barkStyle: opts.barkStyle ?? 'fissured-oak',
      doubleSided: false,
      uniforms: opts.uniforms,
    });
    const barkMesh = new THREE.Mesh(
      opts.barkCollector.toBufferGeometry(`${opts.namePrefix}.barkGeo`),
      barkMat
    );
    barkMesh.name = `${opts.namePrefix}.bark`;
    barkMesh.castShadow = castShadow;
    barkMesh.receiveShadow = true;
    barkMesh.userData['vegetationExposure'] = exposure;
    barkMesh.userData['allowFoliageShadow'] = castShadow;
    if (!opts.solidTrunkCollision) {
      tagCollisionRole(barkMesh, 'ignore');
    }
    group.add(barkMesh);
  }

  if (opts.foliageCollector && !opts.foliageCollector.isEmpty()) {
    const foliageMat = getSharedPhenologyMaterial({
      exposure,
      surface: 'foliage',
      doubleSided: true,
      uniforms: opts.uniforms,
    });
    const foliageMesh = new THREE.Mesh(
      opts.foliageCollector.toBufferGeometry(`${opts.namePrefix}.foliageGeo`),
      foliageMat
    );
    foliageMesh.name = `${opts.namePrefix}.foliage`;
    foliageMesh.castShadow = castShadow;
    foliageMesh.receiveShadow = true;
    foliageMesh.userData['vegetationExposure'] = exposure;
    foliageMesh.userData['allowFoliageShadow'] = castShadow;
    tagCollisionRole(foliageMesh, 'ignore');
    group.add(foliageMesh);
  }

  if (opts.solidTrunkCollision && (opts.trunkColliderRadius ?? 0) > 0.04) {
    const r = opts.trunkColliderRadius!;
    const h = Math.max(0.5, opts.trunkColliderHeight ?? 1.8);
    const colGeo = new THREE.CylinderGeometry(r * 0.85, r, h, 8);
    const colMat = new THREE.MeshBasicMaterial({ visible: false });
    const colMesh = new THREE.Mesh(colGeo, colMat);
    colMesh.name = `${opts.namePrefix}.trunkCollider`;
    colMesh.position.y = h * 0.5;
    tagCollisionRole(colMesh, 'solidPlane');
    group.add(colMesh);
  }

  if (opts.metadata) {
    attachAssetMetadata(group, {
      category: 'vegetation',
      ...opts.metadata,
    });
  }
  return group;
}

export function resolveReactivity(exposure: VegetationExposure): number {
  return getExposureEnvelope(exposure).reactivity;
}
