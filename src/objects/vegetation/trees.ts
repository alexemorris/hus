import * as THREE from 'three';
import type { AssetMetadata } from '../../core/assets/asset-metadata.ts';
import type {
  VegetationExposure,
  VegetationOrganKind,
} from '../../core/geo/climate-phenology.ts';
import type { BarkTextureStyle } from '../../engine/vegetation/vegetation-textures.ts';
import { detectMobile } from '../../engine/perf/device-tier.ts';
import type { VegetationUniforms } from '../../engine/vegetation/vegetation-uniforms.ts';
import {
  OrganCollector,
  assembleBotanicalMeshes,
  createBotanicalRng,
  resolveReactivity,
  type BotanicalRng,
  type LeafShapeProfile,
} from './organ-geometry.ts';

export type TreeSpecies =
  | 'english-oak'
  | 'silver-birch'
  | 'weeping-willow'
  | 'flowering-cherry'
  | 'magnolia'
  | 'orchard-apple'
  | 'orchard-pear'
  | 'orchard-plum'
  | 'fig-tree'
  | 'olive-tree'
  | 'lemon-tree'
  | 'holly-tree'
  | 'scots-pine'
  | 'italian-cypress';

export interface CreateTreeOptions {
  readonly species: TreeSpecies;
  readonly height?: number;
  readonly spread?: number;
  readonly seed?: number;
  readonly exposure?: VegetationExposure;
  readonly uniforms?: VegetationUniforms;
  readonly castShadow?: boolean;
  readonly groundLitter?: boolean;
  readonly name?: string;
  readonly metadata?: Partial<AssetMetadata>;
}

interface TreeSpeciesSpec {
  readonly label: string;
  readonly botanicalName: string;
  readonly defaultHeight: number;
  readonly spreadRatio: number;
  readonly trunkRadiusRatio: number;
  readonly clearTrunkRatio: number;
  readonly barkColor: number;
  readonly barkStyle: BarkTextureStyle;
  readonly leafOrgan: VegetationOrganKind;
  readonly leafShape: LeafShapeProfile;
  readonly leafColor: number;
  readonly leafLength: number;
  readonly leafWidth: number;
  readonly autumnVariant: number;
  readonly branchLevels: number;
  readonly primaryBranches: number;
  readonly spreadAngle: number;
  readonly droop: number;
  readonly gnarl: number;
  readonly fastigiate?: boolean;
  readonly crownOnlyTop?: boolean;
  readonly blossom?: {
    readonly color: number;
    readonly centerColor: number;
    readonly radius: number;
    readonly petals: number;
    readonly variant: number;
    readonly density: number;
  };
  readonly fruit?: {
    readonly color: number;
    readonly radiusXZ: number;
    readonly radiusY: number;
    readonly winterBerry: boolean;
    readonly density: number;
  };
}

const TREE_SPECIES_SPECS: Readonly<Record<TreeSpecies, TreeSpeciesSpec>> = {
  'english-oak': {
    label: 'English Oak',
    botanicalName: 'Quercus robur',
    defaultHeight: 8.5,
    spreadRatio: 0.92,
    trunkRadiusRatio: 0.048,
    clearTrunkRatio: 0.28,
    barkColor: 0x524538,
    barkStyle: 'fissured-oak',
    leafOrgan: 'deciduous-leaf',
    leafShape: 'lobed-oak',
    leafColor: 0x355c27,
    leafLength: 0.30,
    leafWidth: 0.21,
    autumnVariant: 0.32,
    branchLevels: 3,
    primaryBranches: 5,
    spreadAngle: 0.88,
    droop: 0.18,
    gnarl: 0.28,
  },
  'silver-birch': {
    label: 'Silver Birch',
    botanicalName: 'Betula pendula',
    defaultHeight: 7.4,
    spreadRatio: 0.48,
    trunkRadiusRatio: 0.024,
    clearTrunkRatio: 0.34,
    barkColor: 0xdad5cc,
    barkStyle: 'birch-lenticel',
    leafOrgan: 'deciduous-leaf',
    leafShape: 'cordate',
    leafColor: 0x4b742f,
    leafLength: 0.22,
    leafWidth: 0.16,
    autumnVariant: 0.08,
    branchLevels: 3,
    primaryBranches: 5,
    spreadAngle: 0.58,
    droop: 0.38,
    gnarl: 0.12,
  },
  'weeping-willow': {
    label: 'Weeping Willow',
    botanicalName: 'Salix babylonica',
    defaultHeight: 6.8,
    spreadRatio: 0.96,
    trunkRadiusRatio: 0.044,
    clearTrunkRatio: 0.3,
    barkColor: 0x5d5142,
    barkStyle: 'fissured-oak',
    leafOrgan: 'deciduous-leaf',
    leafShape: 'lanceolate',
    leafColor: 0x557d36,
    leafLength: 0.32,
    leafWidth: 0.085,
    autumnVariant: 0.12,
    branchLevels: 3,
    primaryBranches: 6,
    spreadAngle: 0.92,
    droop: 0.85,
    gnarl: 0.2,
  },
  'flowering-cherry': {
    label: 'Flowering Cherry',
    botanicalName: 'Prunus serrulata',
    defaultHeight: 4.8,
    spreadRatio: 0.88,
    trunkRadiusRatio: 0.036,
    clearTrunkRatio: 0.32,
    barkColor: 0x593e36,
    barkStyle: 'smooth-beech',
    leafOrgan: 'deciduous-leaf',
    leafShape: 'ovate',
    leafColor: 0x3b6329,
    leafLength: 0.25,
    leafWidth: 0.16,
    autumnVariant: 0.72,
    branchLevels: 3,
    primaryBranches: 5,
    spreadAngle: 0.82,
    droop: 0.22,
    gnarl: 0.18,
    blossom: {
      color: 0xf6c4d2,
      centerColor: 0xd96b8a,
      radius: 0.105,
      petals: 5,
      variant: 0.42,
      density: 0.85,
    },
  },
  magnolia: {
    label: 'Saucer Magnolia',
    botanicalName: 'Magnolia × soulangeana',
    defaultHeight: 4.2,
    spreadRatio: 0.86,
    trunkRadiusRatio: 0.038,
    clearTrunkRatio: 0.22,
    barkColor: 0x736c63,
    barkStyle: 'smooth-beech',
    leafOrgan: 'deciduous-leaf',
    leafShape: 'ovate',
    leafColor: 0x3f692c,
    leafLength: 0.28,
    leafWidth: 0.19,
    autumnVariant: 0.25,
    branchLevels: 3,
    primaryBranches: 5,
    spreadAngle: 0.78,
    droop: 0.14,
    gnarl: 0.22,
    blossom: {
      color: 0xf4dce6,
      centerColor: 0xc56b92,
      radius: 0.13,
      petals: 6,
      variant: 0.22,
      density: 0.72,
    },
  },
  'orchard-apple': {
    label: 'Orchard Apple',
    botanicalName: 'Malus domestica',
    defaultHeight: 3.9,
    spreadRatio: 0.9,
    trunkRadiusRatio: 0.042,
    clearTrunkRatio: 0.34,
    barkColor: 0x5c4d3f,
    barkStyle: 'flaky-pine',
    leafOrgan: 'deciduous-leaf',
    leafShape: 'ovate',
    leafColor: 0x3b6428,
    leafLength: 0.24,
    leafWidth: 0.16,
    autumnVariant: 0.28,
    branchLevels: 3,
    primaryBranches: 4,
    spreadAngle: 0.86,
    droop: 0.24,
    gnarl: 0.3,
    blossom: {
      color: 0xfaf0f3,
      centerColor: 0xe89eb2,
      radius: 0.095,
      petals: 5,
      variant: 0.58,
      density: 0.65,
    },
    fruit: {
      color: 0xc8372d,
      radiusXZ: 0.042,
      radiusY: 0.04,
      winterBerry: false,
      density: 0.45,
    },
  },
  'orchard-pear': {
    label: 'Orchard Pear',
    botanicalName: 'Pyrus communis',
    defaultHeight: 4.4,
    spreadRatio: 0.68,
    trunkRadiusRatio: 0.038,
    clearTrunkRatio: 0.32,
    barkColor: 0x52463b,
    barkStyle: 'fissured-oak',
    leafOrgan: 'deciduous-leaf',
    leafShape: 'ovate',
    leafColor: 0x365f26,
    leafLength: 0.24,
    leafWidth: 0.15,
    autumnVariant: 0.64,
    branchLevels: 3,
    primaryBranches: 5,
    spreadAngle: 0.64,
    droop: 0.2,
    gnarl: 0.2,
    blossom: {
      color: 0xf7f7f4,
      centerColor: 0xd9d2a3,
      radius: 0.09,
      petals: 5,
      variant: 0.5,
      density: 0.62,
    },
    fruit: {
      color: 0xb79f3b,
      radiusXZ: 0.036,
      radiusY: 0.048,
      winterBerry: false,
      density: 0.42,
    },
  },
  'orchard-plum': {
    label: 'Victoria Plum',
    botanicalName: 'Prunus domestica',
    defaultHeight: 3.8,
    spreadRatio: 0.82,
    trunkRadiusRatio: 0.036,
    clearTrunkRatio: 0.32,
    barkColor: 0x4f3f39,
    barkStyle: 'smooth-beech',
    leafOrgan: 'deciduous-leaf',
    leafShape: 'ovate',
    leafColor: 0x3d632a,
    leafLength: 0.23,
    leafWidth: 0.15,
    autumnVariant: 0.35,
    branchLevels: 3,
    primaryBranches: 4,
    spreadAngle: 0.78,
    droop: 0.22,
    gnarl: 0.22,
    blossom: {
      color: 0xf9f6f7,
      centerColor: 0xe3b8c6,
      radius: 0.088,
      petals: 5,
      variant: 0.35,
      density: 0.64,
    },
    fruit: {
      color: 0x5c234c,
      radiusXZ: 0.03,
      radiusY: 0.036,
      winterBerry: false,
      density: 0.48,
    },
  },
  'fig-tree': {
    label: 'Common Fig',
    botanicalName: 'Ficus carica',
    defaultHeight: 3.4,
    spreadRatio: 0.96,
    trunkRadiusRatio: 0.044,
    clearTrunkRatio: 0.24,
    barkColor: 0x827c73,
    barkStyle: 'smooth-beech',
    leafOrgan: 'deciduous-leaf',
    leafShape: 'lobed-oak',
    leafColor: 0x3b6a28,
    leafLength: 0.32,
    leafWidth: 0.26,
    autumnVariant: 0.18,
    branchLevels: 3,
    primaryBranches: 5,
    spreadAngle: 0.88,
    droop: 0.16,
    gnarl: 0.28,
    fruit: {
      color: 0x542c4d,
      radiusXZ: 0.03,
      radiusY: 0.038,
      winterBerry: false,
      density: 0.38,
    },
  },
  'olive-tree': {
    label: 'Mediterranean Olive',
    botanicalName: 'Olea europaea',
    defaultHeight: 4.2,
    spreadRatio: 0.86,
    trunkRadiusRatio: 0.058,
    clearTrunkRatio: 0.34,
    barkColor: 0x766e61,
    barkStyle: 'gnarled-olive',
    leafOrgan: 'evergreen-leaf',
    leafShape: 'lanceolate',
    leafColor: 0x5f7352,
    leafLength: 0.21,
    leafWidth: 0.08,
    autumnVariant: 0.2,
    branchLevels: 3,
    primaryBranches: 4,
    spreadAngle: 0.82,
    droop: 0.2,
    gnarl: 0.38,
    fruit: {
      color: 0x3a2e3f,
      radiusXZ: 0.015,
      radiusY: 0.02,
      winterBerry: false,
      density: 0.32,
    },
  },
  'lemon-tree': {
    label: 'Lemon Tree',
    botanicalName: 'Citrus × limon',
    defaultHeight: 3.0,
    spreadRatio: 0.8,
    trunkRadiusRatio: 0.036,
    clearTrunkRatio: 0.3,
    barkColor: 0x62584a,
    barkStyle: 'smooth-beech',
    leafOrgan: 'evergreen-leaf',
    leafShape: 'ovate',
    leafColor: 0x386b24,
    leafLength: 0.23,
    leafWidth: 0.15,
    autumnVariant: 0.1,
    branchLevels: 3,
    primaryBranches: 4,
    spreadAngle: 0.76,
    droop: 0.18,
    gnarl: 0.18,
    fruit: {
      color: 0xe6c329,
      radiusXZ: 0.032,
      radiusY: 0.042,
      winterBerry: true,
      density: 0.42,
    },
  },
  'holly-tree': {
    label: 'English Holly',
    botanicalName: 'Ilex aquifolium',
    defaultHeight: 4.6,
    spreadRatio: 0.54,
    trunkRadiusRatio: 0.034,
    clearTrunkRatio: 0.2,
    barkColor: 0x66625a,
    barkStyle: 'smooth-beech',
    leafOrgan: 'evergreen-leaf',
    leafShape: 'lobed-oak',
    leafColor: 0x1e441e,
    leafLength: 0.22,
    leafWidth: 0.15,
    autumnVariant: 0.5,
    branchLevels: 3,
    primaryBranches: 6,
    spreadAngle: 0.62,
    droop: 0.14,
    gnarl: 0.14,
    fruit: {
      color: 0xc91e1e,
      radiusXZ: 0.014,
      radiusY: 0.014,
      winterBerry: true,
      density: 0.62,
    },
  },
  'scots-pine': {
    label: 'Scots Pine',
    botanicalName: 'Pinus sylvestris',
    defaultHeight: 9.2,
    spreadRatio: 0.56,
    trunkRadiusRatio: 0.04,
    clearTrunkRatio: 0.56,
    barkColor: 0x8a5336,
    barkStyle: 'flaky-pine',
    leafOrgan: 'evergreen-leaf',
    leafShape: 'needle-spray',
    leafColor: 0x284b2c,
    leafLength: 0.26,
    leafWidth: 0.11,
    autumnVariant: 0.1,
    branchLevels: 3,
    primaryBranches: 5,
    spreadAngle: 0.85,
    droop: 0.14,
    gnarl: 0.24,
    crownOnlyTop: true,
  },
  'italian-cypress': {
    label: 'Italian Cypress',
    botanicalName: 'Cupressus sempervirens',
    defaultHeight: 7.8,
    spreadRatio: 0.19,
    trunkRadiusRatio: 0.028,
    clearTrunkRatio: 0.12,
    barkColor: 0x5c4f44,
    barkStyle: 'fibrous-vine',
    leafOrgan: 'evergreen-leaf',
    leafShape: 'needle-spray',
    leafColor: 0x234423,
    leafLength: 0.22,
    leafWidth: 0.12,
    autumnVariant: 0.1,
    branchLevels: 2,
    primaryBranches: 9,
    spreadAngle: 0.26,
    droop: 0.05,
    gnarl: 0.08,
    fastigiate: true,
  },
};

function populateTwigOrgans(opts: {
  readonly spec: TreeSpeciesSpec;
  readonly tip: THREE.Vector3;
  readonly dir: THREE.Vector3;
  readonly foliage: OrganCollector;
  readonly reactivity: number;
  readonly scaleFactor: number;
  readonly rng: BotanicalRng;
}): void {
  const { spec, tip, dir, foliage, reactivity, scaleFactor, rng } = opts;
  const leafColor = new THREE.Color(spec.leafColor);
  const jitter = rng.next();

  foliage.addLeafCluster({
    pivot: tip,
    normal: dir,
    leafCount: spec.fastigiate ? 7 : 7,
    leafLength: spec.leafLength * scaleFactor,
    leafWidth: spec.leafWidth * scaleFactor,
    shape: spec.leafShape,
    color: leafColor,
    droop: spec.droop,
    rng,
    meta: {
      organ: spec.leafOrgan,
      jitter,
      reactivity,
      variant: THREE.MathUtils.clamp(spec.autumnVariant + rng.signed() * 0.12, 0, 1),
    },
  });

  if (spec.blossom && rng.next() < spec.blossom.density) {
    foliage.addFlowerRosette({
      pivot: tip.clone().addScaledVector(dir, 0.015),
      normal: dir,
      radius: spec.blossom.radius * scaleFactor,
      petalCount: spec.blossom.petals,
      layers: 2,
      cupFactor: 0.36,
      petalColor: new THREE.Color(spec.blossom.color),
      centerColor: new THREE.Color(spec.blossom.centerColor),
      rng,
      meta: {
        organ: 'spring-blossom',
        jitter: THREE.MathUtils.clamp(jitter + rng.signed() * 0.06, 0, 1),
        reactivity,
        variant: spec.blossom.variant,
      },
    });
  }

  if (spec.fruit && rng.next() < spec.fruit.density) {
    const count = spec.fruit.winterBerry && spec.fruit.radiusXZ < 0.02 ? 3 : 1;
    const fruitColor = new THREE.Color(spec.fruit.color);
    for (let k = 0; k < count; k++) {
      const offset = new THREE.Vector3(
        rng.signed() * 0.022,
        -spec.fruit.radiusY * 1.15 - k * 0.01,
        rng.signed() * 0.022
      );
      foliage.addSpheroidOrgan({
        pivot: tip,
        centerOffset: offset,
        radiusXZ: spec.fruit.radiusXZ * scaleFactor,
        radiusY: spec.fruit.radiusY * scaleFactor,
        latSegments: count > 1 ? 4 : 5,
        lonSegments: count > 1 ? 5 : 7,
        color: fruitColor,
        meta: {
          organ: 'fruit',
          jitter: rng.next(),
          reactivity,
          variant: spec.fruit.winterBerry ? 0.8 : 0.2,
        },
      });
    }
  }
}

export function createTree(options: CreateTreeOptions): THREE.Group {
  const spec = TREE_SPECIES_SPECS[options.species];
  const exposure = options.exposure ?? 'outdoor';
  const reactivity = resolveReactivity(exposure);
  const height = Math.max(1.2, options.height ?? spec.defaultHeight);
  const scaleFactor = THREE.MathUtils.clamp(height / spec.defaultHeight, 0.65, 1.45);
  const spread = options.spread ?? height * spec.spreadRatio;
  const crownRadius = spread * 0.5;
  const rng = createBotanicalRng(options.seed ?? 101 + options.species.length * 37);
  // Phones/tablets grow fewer whorls and twig stations to cut canopy vertex memory.
  const mobileBudget = detectMobile();

  const bark = new OrganCollector();
  const foliage = new OrganCollector();
  const barkCol = new THREE.Color(spec.barkColor);

  const baseRadius = height * spec.trunkRadiusRatio;
  const trunkTopY = spec.fastigiate ? height * 0.92 : height * (spec.crownOnlyTop ? 0.72 : 0.54);
  const trunkSegs = 6;
  const trunkPts: THREE.Vector3[] = [];
  const trunkRadii: number[] = [];
  let leanX = 0;
  let leanZ = 0;

  for (let i = 0; i <= trunkSegs; i++) {
    const t = i / trunkSegs;
    if (i > 0) {
      leanX += rng.signed() * spec.gnarl * height * 0.025;
      leanZ += rng.signed() * spec.gnarl * height * 0.025;
    }
    trunkPts.push(new THREE.Vector3(leanX, t * trunkTopY, leanZ));
    trunkRadii.push(THREE.MathUtils.lerp(baseRadius, baseRadius * (spec.fastigiate ? 0.2 : 0.42), t));
  }

  bark.addTaperedTube({
    points: trunkPts,
    radii: trunkRadii,
    radialSegments: 8,
    color: barkCol,
    rootFlare: 0.36,
    barkFluting: 0.06,
    jitter: rng.next(),
    reactivity,
  });

  const sampleTrunkAt = (frac: number): THREE.Vector3 => {
    const scaled = THREE.MathUtils.clamp(frac, 0, 1) * trunkSegs;
    const i0 = Math.min(trunkSegs - 1, Math.floor(scaled));
    const f = scaled - i0;
    return new THREE.Vector3().lerpVectors(trunkPts[i0]!, trunkPts[i0 + 1]!, f);
  };

  if (spec.fastigiate) {
    // Columnar cypress whorls along the vertical axis
    const whorls = mobileBudget ? 9 : 14;
    for (let w = 0; w < whorls; w++) {
      const wf = w / (whorls - 1);
      const yFrac = THREE.MathUtils.lerp(spec.clearTrunkRatio, 0.98, wf);
      const origin = sampleTrunkAt(Math.min(1, yFrac / 0.92));
      origin.y = height * yFrac;
      const env = Math.sin(Math.pow(wf, 0.65) * Math.PI);
      const rWhorl = Math.max(0.14, crownRadius * (0.28 + 0.85 * env));
      const branchesInWhorl = mobileBudget ? 4 : 5;
      for (let b = 0; b < branchesInWhorl; b++) {
        const az = (w * 0.85) + (b / branchesInWhorl) * Math.PI * 2 + rng.signed() * 0.2;
        const tip = new THREE.Vector3(
          origin.x + Math.cos(az) * rWhorl,
          origin.y + rWhorl * 0.65,
          origin.z + Math.sin(az) * rWhorl
        );
        const mid = origin.clone().lerp(tip, 0.5);
        mid.y -= rWhorl * 0.08;
        bark.addTaperedTube({
          points: [origin, mid, tip],
          radii: [baseRadius * 0.25, baseRadius * 0.14, 0.008],
          radialSegments: 4,
          color: barkCol,
          jitter: rng.next(),
          reactivity,
        });
        const dir = tip.clone().sub(origin).normalize();
        populateTwigOrgans({ spec, tip: mid, dir, foliage, reactivity, scaleFactor, rng });
        populateTwigOrgans({ spec, tip, dir, foliage, reactivity, scaleFactor, rng });
      }
    }
  } else {
    const growBranch = (
      origin: THREE.Vector3,
      dir: THREE.Vector3,
      length: number,
      radius: number,
      depth: number
    ): void => {
      const mid = origin
        .clone()
        .addScaledVector(dir, length * 0.52)
        .add(
          new THREE.Vector3(
            rng.signed() * spec.gnarl * length * 0.22,
            (1 - spec.droop * 0.7) * length * 0.08,
            rng.signed() * spec.gnarl * length * 0.22
          )
        );
      const endDir = dir.clone();
      endDir.y -= spec.droop * (depth === 1 ? 0.65 : 0.22);
      endDir.normalize();
      const tip = mid.clone().addScaledVector(endDir, length * 0.52);

      bark.addTaperedTube({
        points: [origin, mid, tip],
        radii: [radius, radius * 0.64, Math.max(0.006, radius * 0.34)],
        radialSegments: depth >= 3 ? 6 : 4,
        color: barkCol,
        jitter: rng.next(),
        reactivity,
      });

      if (depth === 2) {
        populateTwigOrgans({ spec, tip: mid, dir: endDir, foliage, reactivity, scaleFactor, rng });
        populateTwigOrgans({ spec, tip, dir: endDir, foliage, reactivity, scaleFactor, rng });
      }
      if (depth <= 1) {
        for (const f of mobileBudget ? [0.45, 1.0] : [0.28, 0.55, 0.8, 1.0]) {
          const station = f <= 0.5
            ? origin.clone().lerp(mid, f * 2)
            : mid.clone().lerp(tip, (f - 0.5) * 2);
          const puff = station.clone().add(new THREE.Vector3(rng.signed() * 0.09, rng.signed() * 0.07, rng.signed() * 0.09));
          populateTwigOrgans({ spec, tip: puff, dir: endDir, foliage, reactivity, scaleFactor, rng });
        }
        if (spec.droop > 0.6) {
          const curtainTip = tip.clone().add(new THREE.Vector3(rng.signed() * 0.08, -length * 0.85, rng.signed() * 0.08));
          bark.addTaperedTube({
            points: [tip, curtainTip],
            radii: [0.008, 0.004],
            radialSegments: 4,
            color: barkCol,
            jitter: rng.next(),
            reactivity,
          });
          populateTwigOrgans({
            spec,
            tip: tip.clone().lerp(curtainTip, 0.5),
            dir: new THREE.Vector3(0, -1, 0),
            foliage,
            reactivity,
            scaleFactor,
            rng,
          });
          populateTwigOrgans({
            spec,
            tip: curtainTip,
            dir: new THREE.Vector3(0, -1, 0),
            foliage,
            reactivity,
            scaleFactor,
            rng,
          });
        }
        return;
      }

      const subCount = 3;
      for (let s = 0; s < subCount; s++) {
        const spawnOrigin = s === 0 ? mid.clone().lerp(tip, 0.45) : tip;
        const yaw = rng.range(0, Math.PI * 2);
        const spreadTilt = spec.spreadAngle * rng.range(0.45, 0.85);
        const childDir = endDir
          .clone()
          .multiplyScalar(0.68)
          .add(
            new THREE.Vector3(
              Math.cos(yaw) * spreadTilt,
              rng.range(0.12, 0.52) - spec.droop * 0.25,
              Math.sin(yaw) * spreadTilt
            )
          )
          .normalize();
        growBranch(
          spawnOrigin,
          childDir,
          length * rng.range(0.58, 0.74),
          radius * 0.58,
          depth - 1
        );
      }
    };

    const primaryCount = spec.primaryBranches;
    for (let p = 0; p < primaryCount; p++) {
      const frac = THREE.MathUtils.lerp(
        spec.clearTrunkRatio / Math.max(0.35, trunkTopY / height),
        1.0,
        (p + 0.3) / primaryCount
      );
      const origin = sampleTrunkAt(THREE.MathUtils.clamp(frac, 0.35, 1));
      const az = (p / primaryCount) * Math.PI * 2 + rng.signed() * 0.32;
      const elev = THREE.MathUtils.lerp(0.35, 0.78, p / Math.max(1, primaryCount - 1));
      const dir = new THREE.Vector3(
        Math.cos(az) * spec.spreadAngle,
        elev,
        Math.sin(az) * spec.spreadAngle
      ).normalize();
      const len = THREE.MathUtils.lerp(crownRadius * 0.82, crownRadius * 0.62, p / primaryCount);
      growBranch(origin, dir, len, baseRadius * 0.44, spec.branchLevels);
    }

    // Leader crown branch
    const leaderOrigin = trunkPts[trunkPts.length - 1]!;
    growBranch(
      leaderOrigin,
      new THREE.Vector3(rng.signed() * 0.16, 1, rng.signed() * 0.16).normalize(),
      Math.max(0.6, (height - trunkTopY) * 0.58),
      baseRadius * 0.36,
      spec.branchLevels
    );
  }

  const allowLitter = (options.groundLitter ?? true) && exposure === 'outdoor';
  if (allowLitter && spec.blossom) {
    foliage.addGroundLitterScatter({
      radiusMin: baseRadius * 2.2,
      radiusMax: crownRadius * 0.92,
      count: 26,
      flakeSize: 0.045,
      color: new THREE.Color(spec.blossom.color),
      isAutumnLeaves: false,
      reactivity,
      rng,
    });
  }
  if (allowLitter && spec.leafOrgan === 'deciduous-leaf') {
    const autCol = new THREE.Color().lerpColors(
      new THREE.Color(0xc28e17),
      new THREE.Color(0x941c12),
      spec.autumnVariant
    );
    foliage.addGroundLitterScatter({
      radiusMin: baseRadius * 2.2,
      radiusMax: crownRadius * 0.98,
      count: 30,
      flakeSize: spec.leafLength * 0.72,
      color: autCol,
      isAutumnLeaves: true,
      reactivity,
      rng,
    });
  }

  const namePrefix = options.name ?? `tree.${options.species}`;
  const group = new THREE.Group();
  group.name = namePrefix;
  return assembleBotanicalMeshes({
    group,
    namePrefix,
    exposure,
    barkCollector: bark,
    foliageCollector: foliage,
    barkStyle: spec.barkStyle,
    uniforms: options.uniforms,
    castCanopyShadow: options.castShadow ?? true,
    solidTrunkCollision: exposure === 'outdoor',
    trunkColliderRadius: Math.max(0.08, baseRadius * 1.15),
    trunkColliderHeight: Math.min(2.2, trunkTopY),
    metadata: {
      name: `${spec.label} (${spec.botanicalName})`,
      collection: 'husjs/vegetation Trees',
      dimensionsMm: [
        Math.round(spread * 1000),
        Math.round(spread * 1000),
        Math.round(height * 1000),
      ],
      ...options.metadata,
    },
  });
}
