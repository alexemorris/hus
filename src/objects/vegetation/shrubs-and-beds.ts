import * as THREE from 'three';
import type { AssetMetadata } from '../../core/assets/asset-metadata.ts';
import type {
  VegetationExposure,
  VegetationOrganKind,
} from '../../core/geo/climate-phenology.ts';
import { tagCollisionRole } from '../../engine/geometry/mesh-traits.ts';
import type { VegetationUniforms } from '../../engine/vegetation/vegetation-uniforms.ts';
import {
  OrganCollector,
  assembleBotanicalMeshes,
  createBotanicalRng,
  resolveReactivity,
  type BotanicalRng,
  type LeafShapeProfile,
} from './organ-geometry.ts';
import {
  createSoilBed,
  type SoilBedPoint2D,
  type SoilPlantingAnchor,
} from './soil-bed.ts';

export type ShrubSpecies =
  | 'english-rose-shrub'
  | 'hydrangea'
  | 'lavender'
  | 'rosemary'
  | 'rhododendron'
  | 'blackthorn-sloe'
  | 'bramble';

export interface CreateShrubOptions {
  readonly species: ShrubSpecies;
  readonly radius?: number;
  readonly height?: number;
  readonly exposure?: VegetationExposure;
  readonly seed?: number;
  readonly uniforms?: VegetationUniforms;
  readonly castShadow?: boolean;
  readonly name?: string;
  readonly metadata?: Partial<AssetMetadata>;
}

interface ShrubSpec {
  readonly label: string;
  readonly botanical: string;
  readonly defaultRadius: number;
  readonly defaultHeight: number;
  readonly barkColor: number;
  readonly thornyArching?: boolean;
  readonly leafOrgan: VegetationOrganKind;
  readonly leafShape: LeafShapeProfile;
  readonly leafColor: number;
  readonly leafLen: number;
  readonly autumnVariant: number;
  readonly bloom: {
    readonly organ: 'summer-flower' | 'spring-blossom';
    readonly color: number;
    readonly altColor: number;
    readonly radius: number;
    readonly layers: number;
    readonly variant: number;
    readonly spike?: boolean;
  };
  readonly berry?: {
    readonly color: number;
    readonly radiusXZ: number;
    readonly radiusY: number;
    readonly countMin: number;
    readonly countMax: number;
    readonly variant: number;
  };
}

const SHRUB_SPECS: Readonly<Record<ShrubSpecies, ShrubSpec>> = {
  'english-rose-shrub': {
    label: 'English Shrub Rose',
    botanical: 'Rosa Gertrude Jekyll',
    defaultRadius: 0.55,
    defaultHeight: 0.95,
    barkColor: 0x524838,
    leafOrgan: 'deciduous-leaf',
    leafShape: 'ovate',
    leafColor: 0x355f28,
    leafLen: 0.15,
    autumnVariant: 0.24,
    bloom: {
      organ: 'summer-flower',
      color: 0xea9ab2,
      altColor: 0xf7d6df,
      radius: 0.09,
      layers: 3,
      variant: 0.72,
    },
  },
  hydrangea: {
    label: 'Mophead Hydrangea',
    botanical: 'Hydrangea macrophylla',
    defaultRadius: 0.68,
    defaultHeight: 1.05,
    barkColor: 0x5c4c3d,
    leafOrgan: 'deciduous-leaf',
    leafShape: 'cordate',
    leafColor: 0x3e6d2c,
    leafLen: 0.19,
    autumnVariant: 0.45,
    bloom: {
      organ: 'summer-flower',
      color: 0x8aa8e6,
      altColor: 0xc5b3ea,
      radius: 0.095,
      layers: 2,
      variant: 0.85,
    },
  },
  lavender: {
    label: 'English Lavender',
    botanical: 'Lavandula angustifolia',
    defaultRadius: 0.38,
    defaultHeight: 0.58,
    barkColor: 0x625a4f,
    leafOrgan: 'evergreen-leaf',
    leafShape: 'lanceolate',
    leafColor: 0x5c7560,
    leafLen: 0.12,
    autumnVariant: 0.1,
    bloom: {
      organ: 'summer-flower',
      color: 0x7a5cc7,
      altColor: 0x9b82dc,
      radius: 0.022,
      layers: 1,
      variant: 0.68,
      spike: true,
    },
  },
  rosemary: {
    label: 'Mediterranean Rosemary',
    botanical: 'Salvia rosmarinus',
    defaultRadius: 0.48,
    defaultHeight: 0.78,
    barkColor: 0x5b4c3e,
    leafOrgan: 'evergreen-leaf',
    leafShape: 'needle-spray',
    leafColor: 0x3a5c36,
    leafLen: 0.12,
    autumnVariant: 0.1,
    bloom: {
      organ: 'summer-flower',
      color: 0x98b4e6,
      altColor: 0xbdd1f2,
      radius: 0.02,
      layers: 1,
      variant: 0.34,
    },
  },
  rhododendron: {
    label: 'Garden Rhododendron',
    botanical: 'Rhododendron catawbiense',
    defaultRadius: 0.85,
    defaultHeight: 1.35,
    barkColor: 0x524336,
    leafOrgan: 'evergreen-leaf',
    leafShape: 'ovate',
    leafColor: 0x244d21,
    leafLen: 0.2,
    autumnVariant: 0.1,
    bloom: {
      organ: 'summer-flower',
      color: 0xc8649a,
      altColor: 0xe6a1c5,
      radius: 0.075,
      layers: 2,
      variant: 0.38,
    },
  },
  'blackthorn-sloe': {
    label: 'Wild Blackthorn Sloe Thicket',
    botanical: 'Prunus spinosa',
    defaultRadius: 0.88,
    defaultHeight: 1.45,
    barkColor: 0x382e28,
    thornyArching: true,
    leafOrgan: 'deciduous-leaf',
    leafShape: 'ovate',
    leafColor: 0x335d25,
    leafLen: 0.13,
    autumnVariant: 0.42,
    bloom: {
      organ: 'spring-blossom',
      color: 0xfaf8f2,
      altColor: 0xefe6c8,
      radius: 0.032,
      layers: 1,
      variant: 0.44,
    },
    berry: {
      color: 0x242a48,
      radiusXZ: 0.011,
      radiusY: 0.012,
      countMin: 2,
      countMax: 4,
      variant: 0.28,
    },
  },
  bramble: {
    label: 'Wild Blackberry Bramble Mound',
    botanical: 'Rubus fruticosus',
    defaultRadius: 0.92,
    defaultHeight: 1.15,
    barkColor: 0x4c352d,
    thornyArching: true,
    leafOrgan: 'deciduous-leaf',
    leafShape: 'serrated-vine',
    leafColor: 0x2d5822,
    leafLen: 0.16,
    autumnVariant: 0.85,
    bloom: {
      organ: 'spring-blossom',
      color: 0xfaf6f4,
      altColor: 0xf4dce4,
      radius: 0.028,
      layers: 1,
      variant: 0.56,
    },
    berry: {
      color: 0x1f1122,
      radiusXZ: 0.012,
      radiusY: 0.014,
      countMin: 3,
      countMax: 5,
      variant: 0.28,
    },
  },
};

function populateShrubIntoCollectors(opts: {
  readonly spec: ShrubSpec;
  readonly origin: THREE.Vector3;
  readonly radius: number;
  readonly height: number;
  readonly reactivity: number;
  readonly bark: OrganCollector;
  readonly foliage: OrganCollector;
  readonly rng: BotanicalRng;
}): void {
  const { spec, origin, radius, height, reactivity, bark, foliage, rng } = opts;
  const stems = Math.max(12, Math.round(radius * (spec.thornyArching ? 32 : 28)));
  const barkCol = new THREE.Color(spec.barkColor);
  const leafCol = new THREE.Color(spec.leafColor);

  for (let i = 0; i < stems; i++) {
    const az = (i / stems) * Math.PI * 2 + rng.signed() * 0.28;
    const tilt = rng.range(0.28, spec.thornyArching ? 1.06 : 0.88);
    const tipR = radius * tilt;
    const peakY = height * THREE.MathUtils.lerp(1.02, 0.52, tilt * 0.78);
    const tipY = spec.thornyArching && tilt > 0.65 ? peakY * rng.range(0.45, 0.78) : peakY;

    const base = origin.clone().add(new THREE.Vector3(Math.cos(az) * 0.035, 0, Math.sin(az) * 0.035));
    const mid = origin.clone().add(
      new THREE.Vector3(
        Math.cos(az) * tipR * 0.54,
        peakY * (spec.thornyArching ? 0.74 : 0.55),
        Math.sin(az) * tipR * 0.54
      )
    );
    const tip = origin.clone().add(new THREE.Vector3(Math.cos(az) * tipR, tipY, Math.sin(az) * tipR));

    bark.addTaperedTube({
      points: [base, mid, tip],
      radii: spec.thornyArching ? [0.015, 0.009, 0.0038] : [0.012, 0.007, 0.003],
      radialSegments: 4,
      color: barkCol,
      jitter: rng.next(),
      reactivity,
    });

    if (spec.thornyArching && i % 2 === 0) {
      const spurDir = new THREE.Vector3(-Math.sin(az), 0.35, Math.cos(az)).normalize();
      bark.addTaperedTube({
        points: [mid, mid.clone().addScaledVector(spurDir, rng.range(0.04, 0.08))],
        radii: [0.004, 0.001],
        radialSegments: 4,
        color: barkCol,
        jitter: rng.next(),
        reactivity,
      });
    }

    const outDir = tip.clone().sub(origin).normalize();
    const midDir = mid.clone().sub(origin).normalize();

    for (const nodePt of [mid, tip]) {
      const nDir = nodePt === mid ? midDir : outDir;
      const nodeJit = rng.next();
      foliage.addLeafCluster({
        pivot: nodePt,
        normal: nDir,
        leafCount: nodePt === tip ? 6 : 5,
        leafLength: spec.leafLen * rng.range(0.88, 1.12),
        leafWidth: spec.leafLen * 0.58,
        shape: spec.leafShape,
        color: leafCol,
        droop: spec.thornyArching ? 0.24 : 0.16,
        rng,
        meta: {
          organ: spec.leafOrgan,
          jitter: nodeJit,
          reactivity,
          variant: spec.autumnVariant,
        },
      });

      if (spec.berry && rng.next() < 0.48) {
        const berryCol = new THREE.Color(spec.berry.color);
        const count = rng.int(spec.berry.countMin, spec.berry.countMax);
        for (let b = 0; b < count; b++) {
          foliage.addSpheroidOrgan({
            pivot: nodePt,
            centerOffset: new THREE.Vector3(
              nDir.x * 0.02 + rng.signed() * 0.022,
              -0.01 + rng.signed() * 0.016,
              nDir.z * 0.02 + rng.signed() * 0.022
            ),
            radiusXZ: spec.berry.radiusXZ,
            radiusY: spec.berry.radiusY,
            latSegments: 4,
            lonSegments: 5,
            color: berryCol.clone().offsetHSL(rng.signed() * 0.015, rng.signed() * 0.04, rng.signed() * 0.03),
            meta: {
              organ: 'fruit',
              jitter: THREE.MathUtils.clamp(nodeJit + b * 0.03, 0, 1),
              reactivity,
              variant: spec.berry.variant,
            },
          });
        }
      }
    }

    if (rng.next() < (spec.thornyArching ? 0.82 : 0.72)) {
      const flwCol = new THREE.Color(spec.bloom.color).lerp(
        new THREE.Color(spec.bloom.altColor),
        rng.next()
      );
      if (spec.bloom.spike) {
        const spikeTip = tip.clone().addScaledVector(outDir, 0.14);
        for (let w = 0; w < 3; w++) {
          const p = tip.clone().lerp(spikeTip, (w + 1) / 3);
          foliage.addSpheroidOrgan({
            pivot: tip,
            centerOffset: p.clone().sub(tip),
            radiusXZ: spec.bloom.radius * 0.75,
            radiusY: spec.bloom.radius * 1.35,
            latSegments: 4,
            lonSegments: 5,
            color: flwCol,
            meta: {
              organ: spec.bloom.organ,
              jitter: rng.next(),
              reactivity,
              variant: spec.bloom.variant,
            },
          });
        }
      } else {
        const blossomClusters = spec.thornyArching ? 2 : 1;
        for (let c = 0; c < blossomClusters; c++) {
          const anchor = c === 0 ? tip : mid;
          const bPiv = anchor
            .clone()
            .addScaledVector(outDir, 0.016)
            .add(new THREE.Vector3(rng.signed() * 0.025, rng.signed() * 0.02, rng.signed() * 0.025));
          foliage.addFlowerRosette({
            pivot: bPiv,
            normal: outDir,
            radius: spec.bloom.radius,
            petalCount: spec.bloom.organ === 'spring-blossom' ? 5 : 6,
            layers: spec.bloom.layers,
            cupFactor: spec.bloom.organ === 'spring-blossom' ? 0.25 : 0.42,
            petalColor: flwCol,
            centerColor: new THREE.Color(spec.bloom.altColor),
            rng,
            meta: {
              organ: spec.bloom.organ,
              jitter: rng.next(),
              reactivity,
              variant: spec.bloom.variant,
            },
          });
        }
      }
    }
  }
}

export function createShrub(options: CreateShrubOptions): THREE.Group {
  const spec = SHRUB_SPECS[options.species];
  const exposure = options.exposure ?? 'outdoor';
  const reactivity = resolveReactivity(exposure);
  const radius = Math.max(0.2, options.radius ?? spec.defaultRadius);
  const height = Math.max(0.25, options.height ?? spec.defaultHeight);
  const rng = createBotanicalRng(options.seed ?? 911 + options.species.length * 23);

  const bark = new OrganCollector();
  const foliage = new OrganCollector();
  populateShrubIntoCollectors({
    spec,
    origin: new THREE.Vector3(0, 0, 0),
    radius,
    height,
    reactivity,
    bark,
    foliage,
    rng,
  });

  const namePrefix = options.name ?? `shrub.${options.species}`;
  const group = new THREE.Group();
  group.name = namePrefix;
  return assembleBotanicalMeshes({
    group,
    namePrefix,
    exposure,
    barkCollector: bark,
    foliageCollector: foliage,
    barkStyle: spec.thornyArching ? 'fissured-oak' : 'smooth-beech',
    uniforms: options.uniforms,
    castCanopyShadow: options.castShadow ?? true,
    solidTrunkCollision: false,
    metadata: {
      name: `${spec.label} (${spec.botanical})`,
      collection: 'husjs/vegetation Shrubs',
      dimensionsMm: [
        Math.round(radius * 2000),
        Math.round(radius * 2000),
        Math.round(height * 1000),
      ],
      ...options.metadata,
    },
  });
}

export type FlowerBedStyle =
  | 'cottage-perennial-border'
  | 'spring-bulb-drift'
  | 'kitchen-garden-bed';

export interface CreateFlowerBedOptions {
  readonly style: FlowerBedStyle;
  readonly width?: number;
  readonly depth?: number;
  readonly polygon?: readonly (readonly [number, number] | THREE.Vector2)[];
  readonly raisedEdging?: boolean;
  readonly exposure?: VegetationExposure;
  readonly seed?: number;
  readonly uniforms?: VegetationUniforms;
  readonly castShadow?: boolean;
  readonly name?: string;
  readonly metadata?: Partial<AssetMetadata>;
}

function pointInPolygon2D(x: number, z: number, poly: readonly THREE.Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]!.x;
    const zi = poly[i]!.y;
    const xj = poly[j]!.x;
    const zj = poly[j]!.y;
    const intersect = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function addRaisedTimberEdging(
  group: THREE.Group,
  poly: readonly THREE.Vector2[],
  kerbHeight: number,
  namePrefix: string
): void {
  const sleeperThick = 0.045;
  const mat = new THREE.MeshStandardMaterial({
    name: `${namePrefix}.sleeperMat`,
    color: 0x5c4734,
    roughness: 0.88,
    metalness: 0.0,
  });
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const len = a.distanceTo(b);
    if (len < 1e-3) continue;
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(len + sleeperThick * 0.5, kerbHeight, sleeperThick),
      mat
    );
    beam.name = `${namePrefix}.edging.${i}`;
    beam.position.set((a.x + b.x) * 0.5, kerbHeight * 0.5, (a.y + b.y) * 0.5);
    beam.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x);
    beam.castShadow = true;
    beam.receiveShadow = true;
    tagCollisionRole(beam, 'ignore');
    group.add(beam);
  }
}

export function createFlowerBed(options: CreateFlowerBedOptions): THREE.Group {
  const exposure = options.exposure ?? 'outdoor';
  const reactivity = resolveReactivity(exposure);
  const seedVal = options.seed ?? 1201 + options.style.length * 17;
  const rng = createBotanicalRng(seedVal);
  const namePrefix = options.name ?? `flowerBed.${options.style}`;
  const group = new THREE.Group();
  group.name = namePrefix;

  const hasCustomPoly = Boolean(options.polygon && options.polygon.length >= 3);
  const rectW = Math.max(0.6, options.width ?? 2.4);
  const rectD = Math.max(0.6, options.depth ?? 1.2);
  const poly: THREE.Vector2[] = hasCustomPoly
    ? options.polygon!.map((p) => (p instanceof THREE.Vector2 ? p.clone() : new THREE.Vector2(p[0], p[1])))
    : [
        new THREE.Vector2(-rectW * 0.5, -rectD * 0.5),
        new THREE.Vector2(rectW * 0.5, -rectD * 0.5),
        new THREE.Vector2(rectW * 0.5, rectD * 0.5),
        new THREE.Vector2(-rectW * 0.5, rectD * 0.5),
      ];

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.y);
    maxZ = Math.max(maxZ, p.y);
  }

  const useRaisedKerb = Boolean(options.raisedEdging);
  const kerbHeight = useRaisedKerb ? 0.14 : 0;
  if (useRaisedKerb) {
    addRaisedTimberEdging(group, poly, kerbHeight, namePrefix);
  }

  const area = Math.max(0.4, (maxX - minX) * (maxZ - minZ));
  const targetCount = Math.min(48, Math.max(8, Math.round(area * 8)));
  const cropPositions: { x: number; z: number }[] = [];

  if (options.style === 'kitchen-garden-bed' && !hasCustomPoly) {
    const furrowSpacing = 0.28;
    const marginX = Math.min(0.2, rectW * 0.18);
    const marginZ = Math.min(0.18, rectD * 0.18);
    const cols = Math.max(2, Math.floor((rectW - marginX * 2) / furrowSpacing) + 1);
    const rows = Math.max(2, Math.round((rectD - marginZ * 2) / 0.32) + 1);
    for (let c = 0; c < cols && cropPositions.length < 54; c++) {
      const fx = cols === 1 ? 0 : THREE.MathUtils.lerp(-rectW * 0.5 + marginX, rectW * 0.5 - marginX, c / (cols - 1));
      for (let r = 0; r < rows && cropPositions.length < 54; r++) {
        const fz = rows === 1 ? 0 : THREE.MathUtils.lerp(-rectD * 0.5 + marginZ, rectD * 0.5 - marginZ, r / (rows - 1));
        cropPositions.push({ x: fx + rng.signed() * 0.025, z: fz + rng.signed() * 0.03 });
      }
    }
  } else {
    let attempts = 0;
    while (cropPositions.length < targetCount && attempts < targetCount * 8) {
      attempts++;
      const x = rng.range(minX + 0.1, maxX - 0.1);
      const z = rng.range(minZ + 0.1, maxZ - 0.1);
      if (pointInPolygon2D(x, z, poly)) {
        cropPositions.push({ x, z });
      }
    }
  }

  const plantings: SoilPlantingAnchor[] = cropPositions.slice(0, 48).map((pt) => ({
    x: pt.x,
    z: pt.z,
    stemRadius: options.style === 'kitchen-garden-bed' ? 0.026 : 0.028,
    moundRadius: options.style === 'kitchen-garden-bed' ? 0.13 : 0.15,
    moundHeight: options.style === 'kitchen-garden-bed' ? 0.018 : 0.016,
  }));

  const polyPoints2D: SoilBedPoint2D[] = poly.map((p) => ({ x: p.x, z: p.y }));
  const isKitchen = options.style === 'kitchen-garden-bed';
  const substrate = isKitchen
    ? 'tilled-veg-earth'
    : options.style === 'cottage-perennial-border'
      ? 'garden-loam'
      : 'bark-mulch';

  const soilBed = createSoilBed({
    substrate,
    exposure,
    ...(hasCustomPoly ? { polygon: polyPoints2D } : { width: rectW, depth: rectD }),
    baseY: useRaisedKerb ? kerbHeight - 0.012 : 0.008,
    edgeRecessM: useRaisedKerb ? 0.014 : 0.008,
    crownHeightM: isKitchen ? 0.042 : 0.034,
    furrowAmplitudeM: isKitchen ? 0.014 : 0,
    furrowSpacingM: 0.28,
    plantings,
    seasonalLitter: !isKitchen && exposure === 'outdoor' ? 'autumn-leaves' : false,
    uniforms: options.uniforms,
    seed: seedVal,
    name: `${namePrefix}.soilBed`,
  });
  group.add(soilBed.group);

  const bark = new OrganCollector();
  const foliage = new OrganCollector();
  const stakeBarkCol = new THREE.Color(0x6b5842);

  for (let idx = 0; idx < cropPositions.length; idx++) {
    const { x, z } = cropPositions[idx]!;
    const origin = new THREE.Vector3(x, soilBed.samplePlantingY(x, z), z);
    const jitter = rng.next();

    if (options.style === 'spring-bulb-drift') {
      const isDaffodil = rng.next() < 0.55;
      const stemH = rng.range(0.24, 0.38);
      const bladeCol = new THREE.Color(0x41742c);
      for (let b = 0; b < 4; b++) {
        const az = rng.range(0, Math.PI * 2);
        foliage.addCuppedLeafBlade({
          pivot: origin,
          direction: new THREE.Vector3(Math.cos(az) * 0.42, 0.9, Math.sin(az) * 0.42).normalize(),
          length: stemH * 0.88,
          width: 0.028,
          shape: 'lanceolate',
          color: bladeCol,
          meta: { organ: 'deciduous-leaf', jitter, reactivity, variant: 0.15 },
        });
      }
      const bloomTip = origin.clone().add(new THREE.Vector3(rng.signed() * 0.03, stemH, rng.signed() * 0.03));
      foliage.addFlowerRosette({
        pivot: bloomTip,
        normal: new THREE.Vector3(rng.signed() * 0.25, 0.95, rng.signed() * 0.25).normalize(),
        radius: isDaffodil ? 0.048 : 0.042,
        petalCount: 6,
        layers: isDaffodil ? 2 : 1,
        cupFactor: isDaffodil ? 0.3 : 0.65,
        petalColor: new THREE.Color(isDaffodil ? 0xf2c922 : 0xd9385a),
        centerColor: new THREE.Color(isDaffodil ? 0xe89314 : 0x8f1a33),
        rng,
        meta: {
          organ: 'summer-flower',
          jitter,
          reactivity,
          variant: isDaffodil ? 0.06 : 0.14,
        },
      });
    } else if (isKitchen) {
      const kind = idx % 3;
      if (kind === 0) {
        const cabbageOuter = new THREE.Color(0x3a6e32);
        const cabbageHeart = new THREE.Color(0x63984a);
        foliage.addLeafCluster({
          pivot: origin,
          normal: new THREE.Vector3(0, 1, 0),
          leafCount: 7,
          leafLength: 0.21,
          leafWidth: 0.17,
          shape: 'cordate',
          color: cabbageOuter,
          droop: 0.34,
          rng,
          meta: { organ: 'deciduous-leaf', jitter, reactivity, variant: 0.2 },
        });
        foliage.addSpheroidOrgan({
          pivot: origin,
          centerOffset: new THREE.Vector3(0, 0.065, 0),
          radiusXZ: 0.068,
          radiusY: 0.062,
          latSegments: 5,
          lonSegments: 7,
          color: cabbageHeart,
          meta: { organ: 'deciduous-leaf', jitter, reactivity, variant: 0.18 },
        });
      } else if (kind === 1) {
        const stakeH = rng.range(0.58, 0.76);
        const stakeTop = origin.clone().add(new THREE.Vector3(rng.signed() * 0.015, stakeH, rng.signed() * 0.015));
        bark.addTaperedTube({
          points: [origin, stakeTop],
          radii: [0.009, 0.006],
          radialSegments: 5,
          color: stakeBarkCol,
          jitter,
          reactivity: reactivity * 0.25,
        });
        const vineLevels = 3;
        for (let lv = 0; lv < vineLevels; lv++) {
          const ly = origin.y + 0.14 + (lv / (vineLevels - 1)) * (stakeH * 0.68);
          const nodePiv = new THREE.Vector3(x, ly, z);
          foliage.addLeafCluster({
            pivot: nodePiv,
            normal: new THREE.Vector3(rng.signed() * 0.35, 0.85, rng.signed() * 0.35).normalize(),
            leafCount: 5,
            leafLength: 0.15,
            leafWidth: 0.1,
            shape: 'serrated-vine',
            color: new THREE.Color(0x3b7026),
            droop: 0.26,
            rng,
            meta: { organ: 'deciduous-leaf', jitter, reactivity, variant: 0.24 },
          });
          if (lv < 2) {
            for (let t = 0; t < 2; t++) {
              const az = rng.range(0, Math.PI * 2);
              foliage.addSpheroidOrgan({
                pivot: nodePiv,
                centerOffset: new THREE.Vector3(Math.cos(az) * 0.045, -0.025, Math.sin(az) * 0.045),
                radiusXZ: 0.022,
                radiusY: 0.02,
                latSegments: 5,
                lonSegments: 6,
                color: new THREE.Color(t === 0 ? 0xc9301e : 0xd9681e),
                meta: { organ: 'fruit', jitter: THREE.MathUtils.clamp(jitter + t * 0.04, 0, 1), reactivity, variant: 0.22 },
              });
            }
          }
        }
      } else {
        foliage.addLeafCluster({
          pivot: origin,
          normal: new THREE.Vector3(0, 1, 0),
          leafCount: 8,
          leafLength: 0.14,
          leafWidth: 0.085,
          shape: idx % 2 === 0 ? 'ovate' : 'lanceolate',
          color: new THREE.Color(idx % 2 === 0 ? 0x4b8032 : 0x41683c),
          droop: 0.18,
          rng,
          meta: { organ: 'deciduous-leaf', jitter, reactivity, variant: 0.16 },
        });
      }
    } else {
      const subSpec =
        idx % 3 === 0
          ? SHRUB_SPECS.lavender
          : idx % 3 === 1
            ? SHRUB_SPECS['english-rose-shrub']
            : SHRUB_SPECS.hydrangea;
      populateShrubIntoCollectors({
        spec: subSpec,
        origin,
        radius: rng.range(0.24, 0.42),
        height: rng.range(0.38, 0.72),
        reactivity,
        bark,
        foliage,
        rng,
      });
    }
  }

  return assembleBotanicalMeshes({
    group,
    namePrefix,
    exposure,
    barkCollector: bark,
    foliageCollector: foliage,
    barkStyle: 'smooth-beech',
    uniforms: options.uniforms,
    castCanopyShadow: options.castShadow ?? false,
    solidTrunkCollision: false,
    metadata: {
      name: `Planted Garden Bed (${options.style})`,
      collection: 'husjs/vegetation Beds & Borders',
      dimensionsMm: [
        Math.round((maxX - minX) * 1000),
        Math.round((maxZ - minZ) * 1000),
        Math.round((kerbHeight + 0.72) * 1000),
      ],
      ...options.metadata,
    },
  });
}
