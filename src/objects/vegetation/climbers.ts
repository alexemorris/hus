import * as THREE from 'three';
import type { AssetMetadata } from '../../core/assets/asset-metadata.ts';
import type { VegetationExposure } from '../../core/geo/climate-phenology.ts';
import type { BarkTextureStyle } from '../../engine/vegetation/vegetation-textures.ts';
import type { VegetationUniforms } from '../../engine/vegetation/vegetation-uniforms.ts';
import {
  buildClimbingRoseClimber,
  buildEnglishIvyClimber,
  buildGrapevineClimber,
  buildStarJasmineClimber,
  buildVirginiaCreeperClimber,
  buildWisteriaClimber,
  type ClimberBuildContext,
  type ClimberSupportFrame,
} from './climber-species-builders.ts';
import {
  OrganCollector,
  assembleBotanicalMeshes,
  createBotanicalRng,
  resolveReactivity,
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
  readonly density?: number;
  readonly exposure?: VegetationExposure;
  readonly seed?: number;
  readonly uniforms?: VegetationUniforms;
  readonly castShadow?: boolean;
  readonly name?: string;
  readonly metadata?: Partial<AssetMetadata>;
}

interface ClimberDescriptor {
  readonly label: string;
  readonly botanical: string;
  readonly barkStyle: BarkTextureStyle;
  readonly build: (ctx: ClimberBuildContext) => void;
}

const CLIMBER_DESCRIPTORS: Readonly<Record<ClimberSpecies, ClimberDescriptor>> = {
  'english-ivy': {
    label: 'English Ivy',
    botanical: 'Hedera helix',
    barkStyle: 'fibrous-vine',
    build: buildEnglishIvyClimber,
  },
  'virginia-creeper': {
    label: 'Virginia Creeper',
    botanical: 'Parthenocissus quinquefolia',
    barkStyle: 'smooth-beech',
    build: buildVirginiaCreeperClimber,
  },
  'star-jasmine': {
    label: 'Star Jasmine',
    botanical: 'Trachelospermum jasminoides',
    barkStyle: 'fibrous-vine',
    build: buildStarJasmineClimber,
  },
  grapevine: {
    label: 'Pergola Grapevine',
    botanical: 'Vitis vinifera',
    barkStyle: 'fibrous-vine',
    build: buildGrapevineClimber,
  },
  'climbing-rose': {
    label: 'English Climbing Rose',
    botanical: 'Rosa David Austin Climber',
    barkStyle: 'smooth-beech',
    build: buildClimbingRoseClimber,
  },
  wisteria: {
    label: 'Chinese Wisteria',
    botanical: 'Wisteria sinensis',
    barkStyle: 'fibrous-vine',
    build: buildWisteriaClimber,
  },
};

function createSupportFrameSampler(opts: {
  readonly species: ClimberSpecies;
  readonly support: ClimberSupport;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly colRadius: number;
}): (uNorm: number, vNorm: number) => ClimberSupportFrame {
  const { species, support, width, height, depth, colRadius } = opts;

  return (uRaw: number, vRaw: number): ClimberSupportFrame => {
    const uNorm = THREE.MathUtils.clamp(uRaw, 0, 1);
    const vNorm = THREE.MathUtils.clamp(vRaw, 0, 1);

    if (support === 'pier-column') {
      const theta = uNorm * Math.PI * 2;
      const r = colRadius + 0.012;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      return {
        pos: new THREE.Vector3(cosT * r, vNorm * height, sinT * r),
        normal: new THREE.Vector3(cosT, 0.12, sinT).normalize(),
        tangentU: new THREE.Vector3(-sinT, 0, cosT),
        tangentV: new THREE.Vector3(0, 1, 0),
      };
    }

    if (support === 'pergola-wire') {
      const climbFrac = 0.34;
      if (vNorm <= climbFrac) {
        const f = vNorm / climbFrac;
        return {
          pos: new THREE.Vector3((uNorm - 0.5) * Math.min(0.32, width * 0.22), f * height, 0.01),
          normal: new THREE.Vector3((uNorm - 0.5) * 0.25, 0.12, 1).normalize(),
          tangentU: new THREE.Vector3(1, 0, 0),
          tangentV: new THREE.Vector3(0, 1, 0),
        };
      }
      const runF = (vNorm - climbFrac) / (1 - climbFrac);
      return {
        pos: new THREE.Vector3(
          (uNorm - 0.5) * width,
          height + Math.sin(runF * Math.PI) * 0.04,
          runF * depth
        ),
        normal: new THREE.Vector3(0, 1, 0),
        tangentU: new THREE.Vector3(1, 0, 0),
        tangentV: new THREE.Vector3(0, 0, 1),
      };
    }

    if (support === 'arch-trellis') {
      const halfSpan = width * 0.5;
      const archTop = Math.max(height - halfSpan, 0.45);
      const spanZ = (uNorm - 0.5) * Math.min(0.6, depth * 0.42);
      if (vNorm < 0.35) {
        const y = (vNorm / 0.35) * archTop;
        return {
          pos: new THREE.Vector3(-halfSpan, y, spanZ),
          normal: new THREE.Vector3(-1, 0.08, 0.22).normalize(),
          tangentU: new THREE.Vector3(0, 0, 1),
          tangentV: new THREE.Vector3(0, 1, 0),
        };
      }
      if (vNorm <= 0.65) {
        const a = ((vNorm - 0.35) / 0.3) * Math.PI;
        const cosA = Math.cos(a);
        const sinA = Math.sin(a);
        return {
          pos: new THREE.Vector3(-cosA * halfSpan, archTop + sinA * halfSpan, spanZ),
          normal: new THREE.Vector3(-cosA, sinA, 0.2).normalize(),
          tangentU: new THREE.Vector3(0, 0, 1),
          tangentV: new THREE.Vector3(sinA, cosA, 0).normalize(),
        };
      }
      const y = (1 - (vNorm - 0.65) / 0.35) * archTop;
      return {
        pos: new THREE.Vector3(halfSpan, y, spanZ),
        normal: new THREE.Vector3(1, 0.08, 0.22).normalize(),
        tangentU: new THREE.Vector3(0, 0, 1),
        tangentV: new THREE.Vector3(0, -1, 0),
      };
    }

    const useShingleSpread =
      species === 'english-ivy' || species === 'virginia-creeper' || species === 'star-jasmine';
    const spread = useShingleSpread
      ? THREE.MathUtils.lerp(0.64, 1.0, THREE.MathUtils.smoothstep(vNorm, 0.0, 0.28))
      : 1.0;

    return {
      pos: new THREE.Vector3((uNorm - 0.5) * width * spread, vNorm * height, 0.008),
      normal: new THREE.Vector3((uNorm - 0.5) * 0.12, 0.08, 1).normalize(),
      tangentU: new THREE.Vector3(1, 0, 0),
      tangentV: new THREE.Vector3(0, 1, 0),
    };
  };
}

function clampWallPlaneDepth(collector: OrganCollector): THREE.BufferGeometry {
  const geo = collector.toBufferGeometry();
  const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
  const piv = geo.getAttribute('aVegPivot') as THREE.BufferAttribute | undefined;
  if (pos) {
    for (let i = 0; i < pos.count; i++) {
      pos.setZ(i, THREE.MathUtils.clamp(pos.getZ(i), 0.005, 0.22));
    }
    pos.needsUpdate = true;
  }
  if (piv) {
    for (let i = 0; i < piv.count; i++) {
      piv.setZ(i, THREE.MathUtils.clamp(piv.getZ(i), 0.005, 0.2));
    }
    piv.needsUpdate = true;
  }
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

export function createClimber(options: CreateClimberOptions): THREE.Group {
  const descriptor = CLIMBER_DESCRIPTORS[options.species];
  const support = options.support ?? 'wall-plane';
  const exposure = options.exposure ?? 'outdoor';
  const reactivity = resolveReactivity(exposure);
  const width = Math.max(0.4, options.width ?? 2.2);
  const height = Math.max(0.6, options.height ?? 2.6);
  const depth = Math.max(0.3, options.depth ?? 1.8);
  const colRadius = Math.max(0.12, options.radius ?? 0.22);
  const density = THREE.MathUtils.clamp(options.density ?? 1.0, 0.35, 3.5);
  const rng = createBotanicalRng(options.seed ?? 709 + options.species.length * 31);

  const bark = new OrganCollector();
  const foliage = new OrganCollector();
  const sampleFrame = createSupportFrameSampler({
    species: options.species,
    support,
    width,
    height,
    depth,
    colRadius,
  });

  descriptor.build({
    support,
    width,
    height,
    depth,
    colRadius,
    density,
    reactivity,
    bark,
    foliage,
    rng,
    sampleFrame,
  });

  const namePrefix = options.name ?? `climber.${options.species}`;
  const group = new THREE.Group();
  group.name = namePrefix;
  const assembled = assembleBotanicalMeshes({
    group,
    namePrefix,
    exposure,
    barkCollector: bark,
    foliageCollector: foliage,
    barkStyle: descriptor.barkStyle,
    uniforms: options.uniforms,
    castCanopyShadow: options.castShadow ?? true,
    solidTrunkCollision: false,
    metadata: {
      name: `${descriptor.label} (${descriptor.botanical})`,
      collection: 'husjs/vegetation Climbers',
      dimensionsMm: [
        Math.round(width * 1000),
        Math.round((support === 'pergola-wire' ? depth : 0.22) * 1000),
        Math.round(height * 1000),
      ],
      ...options.metadata,
    },
  });

  if (support === 'wall-plane') {
    for (const child of assembled.children) {
      if (child instanceof THREE.Mesh) {
        if (child.name.endsWith('.bark') && !bark.isEmpty()) {
          const clamped = clampWallPlaneDepth(bark);
          clamped.name = `${namePrefix}.barkGeo`;
          child.geometry.dispose();
          child.geometry = clamped;
        } else if (child.name.endsWith('.foliage') && !foliage.isEmpty()) {
          const clamped = clampWallPlaneDepth(foliage);
          clamped.name = `${namePrefix}.foliageGeo`;
          child.geometry.dispose();
          child.geometry = clamped;
        }
      }
    }
  }

  return assembled;
}
