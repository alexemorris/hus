import * as THREE from 'three';
import type { AssetMetadata } from '../../core/assets/asset-metadata.ts';
import type { VegetationExposure } from '../../core/geo/climate-phenology.ts';
import type { VegetationUniforms } from '../../engine/vegetation/vegetation-uniforms.ts';
import {
  OrganCollector,
  assembleBotanicalMeshes,
  buildPlanterAssembly,
  createBotanicalRng,
  resolveReactivity,
  type PlanterStyle,
} from './organ-geometry.ts';

export type HouseplantSpecies =
  | 'fiddle-leaf-fig'
  | 'monstera-deliciosa'
  | 'calathea-pothos'
  | 'olive-indoor'
  | 'sansevieria'
  | 'kentia-palm'
  | 'boston-fern'
  | 'trailing-ivy';

export interface CreateHouseplantOptions {
  readonly species: HouseplantSpecies;
  readonly height?: number;
  readonly potStyle?: PlanterStyle;
  /** Defaults to `'indoor'` (protected year-round lushness, zero leaf drop, zero snow, zero wind). */
  readonly exposure?: VegetationExposure;
  readonly seed?: number;
  readonly uniforms?: VegetationUniforms;
  readonly castShadow?: boolean;
  readonly name?: string;
  readonly metadata?: Partial<AssetMetadata>;
}

const HOUSEPLANT_DEFAULTS: Readonly<
  Record<
    HouseplantSpecies,
    {
      readonly label: string;
      readonly botanical: string;
      readonly height: number;
      readonly spread: number;
      readonly potStyle: PlanterStyle;
      readonly potH: number;
      readonly potR: number;
    }
  >
> = {
  'fiddle-leaf-fig': {
    label: 'Fiddle-Leaf Fig',
    botanical: 'Ficus lyrata',
    height: 1.65,
    spread: 0.85,
    potStyle: 'woven-basket',
    potH: 0.34,
    potR: 0.19,
  },
  'monstera-deliciosa': {
    label: 'Swiss Cheese Plant',
    botanical: 'Monstera deliciosa',
    height: 1.15,
    spread: 0.92,
    potStyle: 'stoneware',
    potH: 0.3,
    potR: 0.18,
  },
  'calathea-pothos': {
    label: 'Calathea & Golden Pothos Planter',
    botanical: 'Goeppertia × Epipremnum',
    height: 0.62,
    spread: 0.56,
    potStyle: 'glazed-ceramic',
    potH: 0.22,
    potR: 0.14,
  },
  'olive-indoor': {
    label: 'Potted Conservatory Olive',
    botanical: 'Olea europaea',
    height: 1.55,
    spread: 0.78,
    potStyle: 'terracotta',
    potH: 0.34,
    potR: 0.2,
  },
  sansevieria: {
    label: 'Architectural Snake Plant',
    botanical: 'Dracaena trifasciata',
    height: 0.88,
    spread: 0.38,
    potStyle: 'stoneware',
    potH: 0.28,
    potR: 0.15,
  },
  'kentia-palm': {
    label: 'Kentia Parlour Palm',
    botanical: 'Howea forsteriana',
    height: 1.85,
    spread: 1.15,
    potStyle: 'glazed-ceramic',
    potH: 0.36,
    potR: 0.2,
  },
  'boston-fern': {
    label: 'Boston Sword Fern',
    botanical: 'Nephrolepis exaltata',
    height: 0.58,
    spread: 0.76,
    potStyle: 'terracotta',
    potH: 0.22,
    potR: 0.15,
  },
  'trailing-ivy': {
    label: 'Trailing Shelf Ivy',
    botanical: 'Hedera helix',
    height: 0.48,
    spread: 0.54,
    potStyle: 'stoneware',
    potH: 0.18,
    potR: 0.12,
  },
};

export function createHouseplant(options: CreateHouseplantOptions): THREE.Group {
  const def = HOUSEPLANT_DEFAULTS[options.species];
  const exposure = options.exposure ?? 'indoor';
  const reactivity = resolveReactivity(exposure);
  const totalHeight = Math.max(0.3, options.height ?? def.height);
  const scale = totalHeight / def.height;
  const rng = createBotanicalRng(options.seed ?? 1709 + options.species.length * 41);

  const namePrefix = options.name ?? `houseplant.${options.species}`;
  const group = new THREE.Group();
  group.name = namePrefix;

  const pot = buildPlanterAssembly({
    style: options.potStyle ?? def.potStyle,
    radiusTop: def.potR * scale,
    radiusBottom: def.potR * 0.78 * scale,
    height: def.potH * scale,
    namePrefix,
  });
  group.add(pot.group);
  const soilY = pot.soilY;

  const bark = new OrganCollector();
  const foliage = new OrganCollector();
  const barkCol = new THREE.Color(0x635343);

  if (options.species === 'fiddle-leaf-fig' || options.species === 'olive-indoor') {
    const isOlive = options.species === 'olive-indoor';
    const stemTopY = totalHeight * 0.78;
    const stems = isOlive ? 1 : 2;
    for (let st = 0; st < stems; st++) {
      const lean = st === 0 ? 0.02 : -0.05;
      const top = new THREE.Vector3(lean * scale, stemTopY * (st === 0 ? 1 : 0.82), rng.signed() * 0.03);
      const mid = new THREE.Vector3(lean * 0.4 * scale, (soilY + top.y) * 0.5, 0);
      bark.addTaperedTube({
        points: [new THREE.Vector3(0, soilY, 0), mid, top],
        radii: [0.022 * scale, 0.016 * scale, 0.009 * scale],
        radialSegments: 6,
        color: barkCol,
        jitter: rng.next(),
        reactivity,
      });

      const branches = isOlive ? 16 : 11;
      for (let b = 0; b < branches; b++) {
        const bf = b / (branches - 1);
        const y = THREE.MathUtils.lerp(soilY + (top.y - soilY) * 0.34, top.y, bf);
        const az = b * 2.39996 + st * 1.4;
        const branchTip = new THREE.Vector3(
          Math.cos(az) * 0.14 * scale * (1 - bf * 0.35),
          y + 0.08 * scale,
          Math.sin(az) * 0.14 * scale * (1 - bf * 0.35)
        );
        bark.addTaperedTube({
          points: [new THREE.Vector3(lean * bf * scale, y, 0), branchTip],
          radii: [0.008 * scale, 0.004 * scale],
          radialSegments: 4,
          color: barkCol,
          jitter: rng.next(),
          reactivity,
        });
        const dir = new THREE.Vector3(Math.cos(az) * 0.82, 0.48, Math.sin(az) * 0.82).normalize();
        if (isOlive) {
          foliage.addLeafCluster({
            pivot: branchTip,
            normal: dir,
            leafCount: 5,
            leafLength: 0.085 * scale,
            leafWidth: 0.03 * scale,
            shape: 'lanceolate',
            color: new THREE.Color(0x5b724e),
            droop: 0.18,
            rng,
            meta: { organ: 'evergreen-leaf', jitter: rng.next(), reactivity, variant: 0.2 },
          });
        } else {
          foliage.addCuppedLeafBlade({
            pivot: branchTip,
            direction: dir,
            length: 0.25 * scale * rng.range(0.85, 1.12),
            width: 0.16 * scale * rng.range(0.85, 1.12),
            archDrop: 0.055 * scale,
            cupDepth: 0.022 * scale,
            shape: 'lyrate-fiddle',
            color: new THREE.Color(0x285422).offsetHSL(0, 0, bf * 0.04),
            meta: { organ: 'evergreen-leaf', jitter: rng.next(), reactivity, variant: 0.15 },
          });
        }
      }
    }
  } else if (options.species === 'monstera-deliciosa' || options.species === 'calathea-pothos') {
    const isMonstera = options.species === 'monstera-deliciosa';
    const petioles = isMonstera ? 11 : 14;
    const leafCol = new THREE.Color(isMonstera ? 0x265824 : 0x3b6e2c);
    for (let i = 0; i < petioles; i++) {
      const f = i / (petioles - 1);
      const az = i * 2.39996 + rng.signed() * 0.18;
      const spreadR = (isMonstera ? 0.34 : 0.2) * scale * THREE.MathUtils.lerp(1.0, 0.38, f);
      const tipY = soilY + (totalHeight - soilY) * THREE.MathUtils.lerp(0.45, 0.96, f);
      const base = new THREE.Vector3(rng.signed() * 0.03, soilY, rng.signed() * 0.03);
      const tip = new THREE.Vector3(Math.cos(az) * spreadR, tipY, Math.sin(az) * spreadR);
      bark.addTaperedTube({
        points: [base, base.clone().lerp(tip, 0.55).add(new THREE.Vector3(0, 0.05, 0)), tip],
        radii: [0.009 * scale, 0.006 * scale, 0.004 * scale],
        radialSegments: 4,
        color: leafCol.clone().multiplyScalar(0.75),
        jitter: rng.next(),
        reactivity,
      });
      const dir = new THREE.Vector3(Math.cos(az) * 0.88, 0.25, Math.sin(az) * 0.88).normalize();
      foliage.addCuppedLeafBlade({
        pivot: tip,
        direction: dir,
        length: (isMonstera ? 0.28 : 0.14) * scale,
        width: (isMonstera ? 0.22 : 0.095) * scale,
        archDrop: (isMonstera ? 0.08 : 0.035) * scale,
        shape: isMonstera ? 'monstera' : 'cordate',
        color: leafCol.clone().offsetHSL(0, 0, f * 0.05),
        meta: { organ: 'evergreen-leaf', jitter: rng.next(), reactivity, variant: 0.2 },
      });
    }
  } else if (options.species === 'sansevieria') {
    const blades = 13;
    const col = new THREE.Color(0x325e34);
    for (let i = 0; i < blades; i++) {
      const az = (i / blades) * Math.PI * 2 + rng.signed() * 0.2;
      const r = rng.range(0.01, def.potR * 0.55) * scale;
      const piv = new THREE.Vector3(Math.cos(az) * r, soilY, Math.sin(az) * r);
      const dir = new THREE.Vector3(Math.cos(az) * 0.14, 1, Math.sin(az) * 0.14).normalize();
      const len = (totalHeight - soilY) * rng.range(0.58, 1.02);
      foliage.addCuppedLeafBlade({
        pivot: piv,
        direction: dir,
        length: len,
        width: 0.062 * scale,
        archDrop: 0.015 * scale,
        cupDepth: 0.012 * scale,
        segsLength: 5,
        segsWidth: 2,
        shape: 'succulent-sword',
        color: col.clone().offsetHSL(0, 0, rng.signed() * 0.04),
        meta: { organ: 'evergreen-leaf', jitter: rng.next(), reactivity, variant: 0.1 },
      });
    }
  } else if (options.species === 'kentia-palm') {
    const fronds = 9;
    const palmCol = new THREE.Color(0x2e6128);
    for (let f = 0; f < fronds; f++) {
      const ff = f / (fronds - 1);
      const az = f * 2.39996;
      const archLen = (totalHeight - soilY) * THREE.MathUtils.lerp(0.75, 1.05, ff);
      const rachisMid = new THREE.Vector3(
        Math.cos(az) * archLen * 0.34,
        soilY + archLen * 0.68,
        Math.sin(az) * archLen * 0.34
      );
      const rachisTip = new THREE.Vector3(
        Math.cos(az) * archLen * 0.72,
        soilY + archLen * 0.56,
        Math.sin(az) * archLen * 0.72
      );
      bark.addTaperedTube({
        points: [new THREE.Vector3(0, soilY, 0), rachisMid, rachisTip],
        radii: [0.011 * scale, 0.007 * scale, 0.003 * scale],
        radialSegments: 4,
        color: palmCol.clone().multiplyScalar(0.7),
        jitter: rng.next(),
        reactivity,
      });
      const pinnae = 8;
      for (let p = 1; p <= pinnae; p++) {
        const pf = p / pinnae;
        const node = pf < 0.5
          ? new THREE.Vector3(0, soilY, 0).lerp(rachisMid, pf * 2)
          : rachisMid.clone().lerp(rachisTip, (pf - 0.5) * 2);
        for (const side of [-1, 1]) {
          const perpAz = az + side * 1.15;
          const dir = new THREE.Vector3(Math.cos(perpAz), -0.25, Math.sin(perpAz)).normalize();
          foliage.addCuppedLeafBlade({
            pivot: node,
            direction: dir,
            length: 0.22 * scale * Math.sin(pf * Math.PI * 0.9 + 0.1),
            width: 0.032 * scale,
            archDrop: 0.045 * scale,
            shape: 'lanceolate',
            color: palmCol,
            meta: { organ: 'evergreen-leaf', jitter: rng.next(), reactivity, variant: 0.15 },
          });
        }
      }
    }
  } else if (options.species === 'boston-fern') {
    const fronds = 22;
    const fernCol = new THREE.Color(0x467e2f);
    for (let i = 0; i < fronds; i++) {
      const az = (i / fronds) * Math.PI * 2 + rng.signed() * 0.15;
      const elev = rng.range(0.18, 0.85);
      const dir = new THREE.Vector3(Math.cos(az), elev, Math.sin(az)).normalize();
      const len = rng.range(0.28, 0.44) * scale;
      foliage.addCuppedLeafBlade({
        pivot: new THREE.Vector3(Math.cos(az) * 0.04 * scale, soilY + 0.01, Math.sin(az) * 0.04 * scale),
        direction: dir,
        length: len,
        width: 0.085 * scale,
        archDrop: len * 0.55,
        shape: 'fern-frond',
        segsLength: 5,
        color: fernCol.clone().offsetHSL(0, 0, rng.signed() * 0.04),
        meta: { organ: 'evergreen-leaf', jitter: rng.next(), reactivity, variant: 0.2 },
      });
    }
  } else {
    // trailing-ivy
    const trails = 9;
    const ivyCol = new THREE.Color(0x2a5c26);
    for (let t = 0; t < trails; t++) {
      const az = (t / trails) * Math.PI * 2 + rng.signed() * 0.2;
      const rimR = (def.potR + 0.025) * scale;
      const p0 = new THREE.Vector3(0, soilY, 0);
      const p1 = new THREE.Vector3(Math.cos(az) * rimR, soilY + 0.03 * scale, Math.sin(az) * rimR);
      const dropY = Math.max(0.02, soilY - rng.range(0.12, 0.24) * scale);
      const p2 = new THREE.Vector3(Math.cos(az) * (rimR + 0.08 * scale), dropY, Math.sin(az) * (rimR + 0.08 * scale));
      bark.addTaperedTube({
        points: [p0, p1, p2],
        radii: [0.005 * scale, 0.004 * scale, 0.002 * scale],
        radialSegments: 4,
        color: barkCol,
        jitter: rng.next(),
        reactivity,
      });
      for (const node of [p1, p1.clone().lerp(p2, 0.5), p2]) {
        foliage.addLeafCluster({
          pivot: node,
          normal: new THREE.Vector3(Math.cos(az), 0.35, Math.sin(az)).normalize(),
          leafCount: 3,
          leafLength: 0.068 * scale,
          leafWidth: 0.055 * scale,
          shape: 'lobed-oak',
          color: ivyCol,
          droop: 0.25,
          rng,
          meta: { organ: 'evergreen-leaf', jitter: rng.next(), reactivity, variant: 0.15 },
        });
      }
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
      name: `${def.label} (${def.botanical})`,
      collection: 'husjs/vegetation Houseplants',
      dimensionsMm: [
        Math.round(def.spread * scale * 1000),
        Math.round(def.spread * scale * 1000),
        Math.round(totalHeight * 1000),
      ],
      ...options.metadata,
    },
  });
}
