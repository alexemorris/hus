import * as THREE from 'three';
import type { AssetMetadata } from '../../core/assets/asset-metadata.ts';
import type {
  VegetationExposure,
  VegetationOrganKind,
} from '../../core/geo/climate-phenology.ts';
import type { VegetationUniforms } from '../../engine/vegetation/vegetation-uniforms.ts';
import {
  OrganCollector,
  assembleBotanicalMeshes,
  createBotanicalRng,
  resolveReactivity,
  type LeafShapeProfile,
} from './organ-geometry.ts';

export type ClimberSpecies =
  | 'english-ivy'
  | 'virginia-creeper'
  | 'climbing-rose'
  | 'wisteria'
  | 'star-jasmine'
  | 'grapevine';

export type ClimberSupport =
  | 'wall-plane'
  | 'pier-column'
  | 'pergola-wire'
  | 'arch-trellis';

export interface CreateClimberOptions {
  readonly species: ClimberSpecies;
  readonly support?: ClimberSupport;
  readonly width?: number;
  readonly height?: number;
  readonly depth?: number;
  readonly radius?: number;
  readonly exposure?: VegetationExposure;
  readonly seed?: number;
  readonly uniforms?: VegetationUniforms;
  readonly castShadow?: boolean;
  readonly name?: string;
  readonly metadata?: Partial<AssetMetadata>;
}

interface ClimberSpec {
  readonly label: string;
  readonly botanical: string;
  readonly leafOrgan: VegetationOrganKind;
  readonly leafShape: LeafShapeProfile;
  readonly leafColor: number;
  readonly leafLen: number;
  readonly autumnVariant: number;
  readonly flower?: {
    readonly color: number;
    readonly centerColor: number;
    readonly radius: number;
    readonly layers: number;
    readonly petals: number;
    readonly variant: number;
    readonly racemeCount?: number;
  };
  readonly grapeClusterColor?: number;
}

const CLIMBER_SPECS: Readonly<Record<ClimberSpecies, ClimberSpec>> = {
  'english-ivy': {
    label: 'English Ivy',
    botanical: 'Hedera helix',
    leafOrgan: 'evergreen-leaf',
    leafShape: 'lobed-oak',
    leafColor: 0x244a22,
    leafLen: 0.16,
    autumnVariant: 0.15,
  },
  'virginia-creeper': {
    label: 'Virginia Creeper',
    botanical: 'Parthenocissus quinquefolia',
    leafOrgan: 'deciduous-leaf',
    leafShape: 'lobed-oak',
    leafColor: 0x3b6a28,
    leafLen: 0.19,
    autumnVariant: 0.92,
  },
  'climbing-rose': {
    label: 'English Climbing Rose',
    botanical: 'Rosa David Austin Climber',
    leafOrgan: 'deciduous-leaf',
    leafShape: 'ovate',
    leafColor: 0x315a26,
    leafLen: 0.15,
    autumnVariant: 0.25,
    flower: {
      color: 0xf4c2cc,
      centerColor: 0xe6899d,
      radius: 0.092,
      layers: 3,
      petals: 6,
      variant: 0.72,
    },
  },
  wisteria: {
    label: 'Chinese Wisteria',
    botanical: 'Wisteria sinensis',
    leafOrgan: 'deciduous-leaf',
    leafShape: 'lanceolate',
    leafColor: 0x487330,
    leafLen: 0.17,
    autumnVariant: 0.14,
    flower: {
      color: 0xa78be6,
      centerColor: 0xd8cbf8,
      radius: 0.036,
      layers: 1,
      petals: 5,
      variant: 0.36,
      racemeCount: 6,
    },
  },
  'star-jasmine': {
    label: 'Star Jasmine',
    botanical: 'Trachelospermum jasminoides',
    leafOrgan: 'evergreen-leaf',
    leafShape: 'ovate',
    leafColor: 0x2a5623,
    leafLen: 0.14,
    autumnVariant: 0.45,
    flower: {
      color: 0xfaf9f2,
      centerColor: 0xe8dd9e,
      radius: 0.032,
      layers: 1,
      petals: 5,
      variant: 0.66,
    },
  },
  grapevine: {
    label: 'Pergola Grapevine',
    botanical: 'Vitis vinifera',
    leafOrgan: 'deciduous-leaf',
    leafShape: 'lobed-oak',
    leafColor: 0x42702a,
    leafLen: 0.21,
    autumnVariant: 0.55,
    grapeClusterColor: 0x4b224f,
  },
};

export function createClimber(options: CreateClimberOptions): THREE.Group {
  const spec = CLIMBER_SPECS[options.species];
  const support = options.support ?? 'wall-plane';
  const exposure = options.exposure ?? 'outdoor';
  const reactivity = resolveReactivity(exposure);
  const width = Math.max(0.4, options.width ?? 2.2);
  const height = Math.max(0.6, options.height ?? 2.6);
  const depth = Math.max(0.3, options.depth ?? 1.8);
  const colRadius = Math.max(0.12, options.radius ?? 0.22);
  const rng = createBotanicalRng(options.seed ?? 709 + options.species.length * 31);

  const bark = new OrganCollector();
  const foliage = new OrganCollector();
  const barkCol = new THREE.Color(0x5b4a3b);
  const leafCol = new THREE.Color(spec.leafColor);

  const sampleSupportFrame = (
    uNorm: number,
    vNorm: number
  ): { readonly pos: THREE.Vector3; readonly normal: THREE.Vector3 } => {
    if (support === 'pier-column') {
      const theta = uNorm * Math.PI * 2 * 1.45;
      const r = colRadius + 0.018;
      return {
        pos: new THREE.Vector3(Math.cos(theta) * r, vNorm * height, Math.sin(theta) * r),
        normal: new THREE.Vector3(Math.cos(theta), 0.18, Math.sin(theta)).normalize(),
      };
    }
    if (support === 'pergola-wire') {
      const climbFrac = 0.48;
      if (vNorm <= climbFrac) {
        const f = vNorm / climbFrac;
        return {
          pos: new THREE.Vector3((uNorm - 0.5) * 0.28, f * height, 0),
          normal: new THREE.Vector3(uNorm - 0.5, 0.2, 1).normalize(),
        };
      }
      const runF = (vNorm - climbFrac) / (1 - climbFrac);
      return {
        pos: new THREE.Vector3(
          (uNorm - 0.5) * width,
          height + Math.sin(runF * Math.PI) * 0.05,
          runF * depth
        ),
        normal: new THREE.Vector3(0, 1, 0),
      };
    }
    if (support === 'arch-trellis') {
      const archAngle = vNorm * Math.PI;
      const halfSpan = width * 0.5;
      const archTop = Math.max(height - halfSpan, 0.5);
      let x = -halfSpan;
      let y = 0;
      let nx = -1;
      let ny = 0;
      if (vNorm < 0.35) {
        x = -halfSpan;
        y = (vNorm / 0.35) * archTop;
        nx = -1;
        ny = 0.1;
      } else if (vNorm <= 0.65) {
        const a = ((vNorm - 0.35) / 0.3) * Math.PI;
        x = -Math.cos(a) * halfSpan;
        y = archTop + Math.sin(a) * halfSpan;
        nx = -Math.cos(a);
        ny = Math.sin(a);
      } else {
        x = halfSpan;
        y = (1 - (vNorm - 0.65) / 0.35) * archTop;
        nx = 1;
        ny = 0.1;
      }
      void archAngle;
      return {
        pos: new THREE.Vector3(x, y, (uNorm - 0.5) * Math.min(0.55, depth * 0.35)),
        normal: new THREE.Vector3(nx, ny, 0.35).normalize(),
      };
    }
    // wall-plane: spreads from root fan across X in [-width/2, +width/2], Y in [0, height], +Z normal
    const fanSpread = THREE.MathUtils.lerp(0.18, 1.0, Math.pow(vNorm, 0.62));
    return {
      pos: new THREE.Vector3((uNorm - 0.5) * width * fanSpread, vNorm * height, 0.025),
      normal: new THREE.Vector3((uNorm - 0.5) * 0.25, 0.18, 1).normalize(),
    };
  };

  const mainVines: number = 7;
  const stepsPerVine = 14;

  for (let v = 0; v < mainVines; v++) {
    const baseU = mainVines === 1 ? 0.5 : v / (mainVines - 1);
    const pts: THREE.Vector3[] = [];
    const normals: THREE.Vector3[] = [];
    const radii: number[] = [];

    for (let s = 0; s <= stepsPerVine; s++) {
      const t = s / stepsPerVine;
      const meander = Math.sin(t * Math.PI * 3.2 + v * 1.7) * 0.08;
      const u = THREE.MathUtils.clamp(baseU + meander, 0.02, 0.98);
      const frame = sampleSupportFrame(u, t);
      const p = frame.pos.clone().addScaledVector(frame.normal, rng.range(0.008, 0.032));
      pts.push(p);
      normals.push(frame.normal);
      radii.push(THREE.MathUtils.lerp(0.02, 0.005, t));
    }

    bark.addTaperedTube({
      points: pts,
      radii,
      radialSegments: 5,
      color: barkCol,
      jitter: rng.next(),
      reactivity,
    });

    for (let s = 1; s <= stepsPerVine; s++) {
      const nodePos = pts[s]!;
      const nodeNormal = normals[s]!;
      const jitter = rng.next();

      foliage.addLeafCluster({
        pivot: nodePos,
        normal: nodeNormal,
        leafCount: 6,
        leafLength: spec.leafLen,
        leafWidth: spec.leafLen * 0.68,
        shape: spec.leafShape,
        color: leafCol,
        droop: 0.22,
        rng,
        meta: {
          organ: spec.leafOrgan,
          jitter,
          reactivity,
          variant: spec.autumnVariant,
        },
      });

      if (spec.flower && s >= 2 && rng.next() < 0.72) {
        if (spec.flower.racemeCount) {
          // Pendulous wisteria raceme cluster
          const racemeLen = 0.24 * rng.range(0.8, 1.2);
          const count = spec.flower.racemeCount;
          for (let rIdx = 0; rIdx < count; rIdx++) {
            const rf = rIdx / (count - 1);
            const flwPiv = nodePos
              .clone()
              .addScaledVector(nodeNormal, 0.035)
              .add(new THREE.Vector3(0, -rf * racemeLen, 0));
            foliage.addFlowerRosette({
              pivot: flwPiv,
              normal: new THREE.Vector3(rng.signed() * 0.4, -0.5, 0.7).normalize(),
              radius: spec.flower.radius * THREE.MathUtils.lerp(1.15, 0.62, rf),
              petalCount: spec.flower.petals,
              layers: 1,
              petalColor: new THREE.Color(spec.flower.color),
              centerColor: new THREE.Color(spec.flower.centerColor),
              rng,
              meta: {
                organ: 'summer-flower',
                jitter: THREE.MathUtils.clamp(jitter + rf * 0.04, 0, 1),
                reactivity,
                variant: spec.flower.variant,
              },
            });
          }
        } else {
          foliage.addFlowerRosette({
            pivot: nodePos.clone().addScaledVector(nodeNormal, 0.025),
            normal: nodeNormal,
            radius: spec.flower.radius,
            petalCount: spec.flower.petals,
            layers: spec.flower.layers,
            cupFactor: spec.flower.layers > 1 ? 0.48 : 0.25,
            petalColor: new THREE.Color(spec.flower.color),
            centerColor: new THREE.Color(spec.flower.centerColor),
            rng,
            meta: {
              organ: 'summer-flower',
              jitter,
              reactivity,
              variant: spec.flower.variant,
            },
          });
        }
      }

      if (spec.grapeClusterColor !== undefined && s >= 4 && rng.next() < 0.52) {
        const bunchCol = new THREE.Color(spec.grapeClusterColor);
        const berries = 7;
        for (let b = 0; b < berries; b++) {
          const bf = b / berries;
          const ringR = (1 - bf * 0.65) * 0.022;
          const az = b * 2.2;
          foliage.addSpheroidOrgan({
            pivot: nodePos,
            centerOffset: new THREE.Vector3(
              Math.cos(az) * ringR,
              -0.03 - bf * 0.075,
              Math.sin(az) * ringR + 0.02
            ),
            radiusXZ: 0.015,
            radiusY: 0.017,
            latSegments: 4,
            lonSegments: 5,
            color: bunchCol,
            meta: {
              organ: 'fruit',
              jitter: rng.next(),
              reactivity,
              variant: 0.25,
            },
          });
        }
      }
    }
  }

  const namePrefix = options.name ?? `climber.${options.species}`;
  const group = new THREE.Group();
  group.name = namePrefix;
  return assembleBotanicalMeshes({
    group,
    namePrefix,
    exposure,
    barkCollector: bark,
    foliageCollector: foliage,
    barkStyle: 'fibrous-vine',
    uniforms: options.uniforms,
    castCanopyShadow: options.castShadow ?? true,
    solidTrunkCollision: false,
    metadata: {
      name: `${spec.label} (${spec.botanical})`,
      collection: 'husjs/vegetation Climbers',
      dimensionsMm: [
        Math.round(width * 1000),
        Math.round((support === 'pergola-wire' ? depth : 0.25) * 1000),
        Math.round(height * 1000),
      ],
      ...options.metadata,
    },
  });
}
