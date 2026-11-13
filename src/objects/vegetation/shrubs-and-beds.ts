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
  getMulchSoilMaterial,
  resolveReactivity,
  type BotanicalRng,
  type LeafShapeProfile,
} from './organ-geometry.ts';

export type ShrubSpecies =
  | 'english-rose-shrub'
  | 'hydrangea'
  | 'lavender'
  | 'rosemary'
  | 'rhododendron';

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
  readonly leafOrgan: VegetationOrganKind;
  readonly leafShape: LeafShapeProfile;
  readonly leafColor: number;
  readonly leafLen: number;
  readonly autumnVariant: number;
  readonly bloom: {
    readonly color: number;
    readonly altColor: number;
    readonly radius: number;
    readonly layers: number;
    readonly variant: number;
    readonly spike?: boolean;
  };
}

const SHRUB_SPECS: Readonly<Record<ShrubSpecies, ShrubSpec>> = {
  'english-rose-shrub': {
    label: 'English Shrub Rose',
    botanical: 'Rosa Gertrude Jekyll',
    defaultRadius: 0.55,
    defaultHeight: 0.95,
    leafOrgan: 'deciduous-leaf',
    leafShape: 'ovate',
    leafColor: 0x355f28,
    leafLen: 0.15,
    autumnVariant: 0.24,
    bloom: {
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
    leafOrgan: 'deciduous-leaf',
    leafShape: 'cordate',
    leafColor: 0x3e6d2c,
    leafLen: 0.19,
    autumnVariant: 0.45,
    bloom: {
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
    leafOrgan: 'evergreen-leaf',
    leafShape: 'lanceolate',
    leafColor: 0x5c7560,
    leafLen: 0.12,
    autumnVariant: 0.1,
    bloom: {
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
    leafOrgan: 'evergreen-leaf',
    leafShape: 'needle-spray',
    leafColor: 0x3a5c36,
    leafLen: 0.12,
    autumnVariant: 0.1,
    bloom: {
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
    leafOrgan: 'evergreen-leaf',
    leafShape: 'ovate',
    leafColor: 0x244d21,
    leafLen: 0.2,
    autumnVariant: 0.1,
    bloom: {
      color: 0xc8649a,
      altColor: 0xe6a1c5,
      radius: 0.075,
      layers: 2,
      variant: 0.38,
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
  const stems = Math.max(12, Math.round(radius * 28));
  const barkCol = new THREE.Color(0x57483a);
  const leafCol = new THREE.Color(spec.leafColor);

  for (let i = 0; i < stems; i++) {
    const az = (i / stems) * Math.PI * 2 + rng.signed() * 0.25;
    const tilt = rng.range(0.25, 0.88);
    const tipR = radius * tilt;
    const tipY = height * THREE.MathUtils.lerp(0.98, 0.56, tilt * 0.85);
    const base = origin.clone().add(new THREE.Vector3(Math.cos(az) * 0.03, 0, Math.sin(az) * 0.03));
    const mid = origin.clone().add(
      new THREE.Vector3(Math.cos(az) * tipR * 0.5, tipY * 0.55, Math.sin(az) * tipR * 0.5)
    );
    const tip = origin.clone().add(new THREE.Vector3(Math.cos(az) * tipR, tipY, Math.sin(az) * tipR));

    bark.addTaperedTube({
      points: [base, mid, tip],
      radii: [0.012, 0.007, 0.003],
      radialSegments: 4,
      color: barkCol,
      jitter: rng.next(),
      reactivity,
    });

    const outDir = tip.clone().sub(origin).normalize();
    foliage.addLeafCluster({
      pivot: mid,
      normal: outDir,
      leafCount: 5,
      leafLength: spec.leafLen,
      leafWidth: spec.leafLen * 0.55,
      shape: spec.leafShape,
      color: leafCol,
      droop: 0.16,
      rng,
      meta: {
        organ: spec.leafOrgan,
        jitter: rng.next(),
        reactivity,
        variant: spec.autumnVariant,
      },
    });
    foliage.addLeafCluster({
      pivot: tip,
      normal: outDir,
      leafCount: 6,
      leafLength: spec.leafLen,
      leafWidth: spec.leafLen * 0.55,
      shape: spec.leafShape,
      color: leafCol,
      droop: 0.16,
      rng,
      meta: {
        organ: spec.leafOrgan,
        jitter: rng.next(),
        reactivity,
        variant: spec.autumnVariant,
      },
    });

    if (rng.next() < 0.72) {
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
              organ: 'summer-flower',
              jitter: rng.next(),
              reactivity,
              variant: spec.bloom.variant,
            },
          });
        }
      } else {
        foliage.addFlowerRosette({
          pivot: tip.clone().addScaledVector(outDir, 0.015),
          normal: outDir,
          radius: spec.bloom.radius,
          petalCount: 6,
          layers: spec.bloom.layers,
          cupFactor: 0.42,
          petalColor: flwCol,
          centerColor: new THREE.Color(spec.bloom.altColor),
          rng,
          meta: {
            organ: 'summer-flower',
            jitter: rng.next(),
            reactivity,
            variant: spec.bloom.variant,
          },
        });
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
    barkStyle: 'smooth-beech',
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

export function createFlowerBed(options: CreateFlowerBedOptions): THREE.Group {
  const exposure = options.exposure ?? 'outdoor';
  const reactivity = resolveReactivity(exposure);
  const rng = createBotanicalRng(options.seed ?? 1201 + options.style.length * 17);
  const namePrefix = options.name ?? `flowerBed.${options.style}`;
  const group = new THREE.Group();
  group.name = namePrefix;

  const poly: THREE.Vector2[] =
    options.polygon && options.polygon.length >= 3
      ? options.polygon.map((p) => (p instanceof THREE.Vector2 ? p.clone() : new THREE.Vector2(p[0], p[1])))
      : (() => {
          const hw = Math.max(0.3, (options.width ?? 2.4) * 0.5);
          const hd = Math.max(0.3, (options.depth ?? 1.2) * 0.5);
          return [
            new THREE.Vector2(-hw, -hd),
            new THREE.Vector2(hw, -hd),
            new THREE.Vector2(hw, hd),
            new THREE.Vector2(-hw, hd),
          ];
        })();

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

  const soilHeight = options.style === 'kitchen-garden-bed' || options.raisedEdging ? 0.14 : 0.035;
  const shape = new THREE.Shape();
  poly.forEach((p, idx) => {
    if (idx === 0) shape.moveTo(p.x, -p.y);
    else shape.lineTo(p.x, -p.y);
  });
  shape.closePath();

  const mulchGeo = new THREE.ExtrudeGeometry(shape, {
    depth: soilHeight,
    bevelEnabled: true,
    bevelThickness: 0.01,
    bevelSize: 0.015,
    bevelSegments: 1,
  });
  mulchGeo.rotateX(-Math.PI / 2);
  const mulchMesh = new THREE.Mesh(mulchGeo, getMulchSoilMaterial());
  mulchMesh.name = `${namePrefix}.mulchBed`;
  mulchMesh.receiveShadow = true;
  tagCollisionRole(mulchMesh, 'ignore');
  group.add(mulchMesh);

  const bark = new OrganCollector();
  const foliage = new OrganCollector();
  const area = Math.max(0.4, (maxX - minX) * (maxZ - minZ));
  const clumpCount = Math.min(48, Math.max(8, Math.round(area * 8)));

  let placed = 0;
  let attempts = 0;
  while (placed < clumpCount && attempts < clumpCount * 8) {
    attempts++;
    const x = rng.range(minX + 0.1, maxX - 0.1);
    const z = rng.range(minZ + 0.1, maxZ - 0.1);
    if (!pointInPolygon2D(x, z, poly)) continue;
    placed++;

    const origin = new THREE.Vector3(x, soilHeight, z);
    const jitter = rng.next();

    if (options.style === 'spring-bulb-drift') {
      // Daffodils (yellow) & Tulips (crimson/pink) with early-spring phase variant 0.05..0.18
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
    } else if (options.style === 'kitchen-garden-bed') {
      // Rhubarb / swiss chard broad leaves, leafy greens, and ripening summer squash / tomatoes
      const kind = placed % 3;
      if (kind === 0) {
        const leafCol = new THREE.Color(0x3b6e28);
        foliage.addLeafCluster({
          pivot: origin,
          normal: new THREE.Vector3(0, 1, 0),
          leafCount: 6,
          leafLength: 0.24,
          leafWidth: 0.17,
          shape: 'cordate',
          color: leafCol,
          droop: 0.35,
          rng,
          meta: { organ: 'deciduous-leaf', jitter, reactivity, variant: 0.2 },
        });
      } else if (kind === 1) {
        foliage.addLeafCluster({
          pivot: origin,
          normal: new THREE.Vector3(0, 1, 0),
          leafCount: 7,
          leafLength: 0.15,
          leafWidth: 0.11,
          shape: 'ovate',
          color: new THREE.Color(0x4d8232),
          droop: 0.2,
          rng,
          meta: { organ: 'deciduous-leaf', jitter, reactivity, variant: 0.15 },
        });
      } else {
        foliage.addLeafCluster({
          pivot: origin,
          normal: new THREE.Vector3(0, 1, 0),
          leafCount: 5,
          leafLength: 0.2,
          leafWidth: 0.16,
          shape: 'lobed-oak',
          color: new THREE.Color(0x3a6a26),
          droop: 0.28,
          rng,
          meta: { organ: 'deciduous-leaf', jitter, reactivity, variant: 0.25 },
        });
        foliage.addSpheroidOrgan({
          pivot: origin,
          centerOffset: new THREE.Vector3(0.05, 0.055, 0.03),
          radiusXZ: 0.065,
          radiusY: 0.05,
          color: new THREE.Color(0xd96b1f),
          meta: { organ: 'fruit', jitter, reactivity, variant: 0.2 },
        });
      }
    } else {
      // cottage-perennial-border: delphinium/salvia spikes, roses, geraniums, lavender mounds
      const subSpec =
        placed % 3 === 0
          ? SHRUB_SPECS.lavender
          : placed % 3 === 1
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
        Math.round((soilHeight + 0.65) * 1000),
      ],
      ...options.metadata,
    },
  });
}
