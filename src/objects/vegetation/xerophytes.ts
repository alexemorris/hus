import * as THREE from 'three';
import type { AssetMetadata } from '../../core/assets/asset-metadata.ts';
import type { VegetationExposure } from '../../core/geo/climate-phenology.ts';
import type { VegetationUniforms } from '../../engine/vegetation/vegetation-uniforms.ts';
import {
  OrganCollector,
  assembleBotanicalMeshes,
  createBotanicalRng,
  resolveReactivity,
} from './organ-geometry.ts';

export type XerophyteSpecies =
  | 'agave-attenuata'
  | 'california-deergrass'
  | 'barrel-cactus'
  | 'aloe';

export interface CreateXerophyteOptions {
  readonly species: XerophyteSpecies;
  readonly scale?: number;
  readonly exposure?: VegetationExposure;
  readonly seed?: number;
  readonly uniforms?: VegetationUniforms;
  readonly castShadow?: boolean;
  readonly name?: string;
  readonly metadata?: Partial<AssetMetadata>;
}

export function createXerophyte(options: CreateXerophyteOptions): THREE.Group {
  const exposure = options.exposure ?? 'outdoor';
  const reactivity = resolveReactivity(exposure);
  const s = Math.max(0.35, options.scale ?? 1.0);
  const rng = createBotanicalRng(options.seed ?? 1409 + options.species.length * 29);

  const bark = new OrganCollector();
  const foliage = new OrganCollector();
  const namePrefix = options.name ?? `xerophyte.${options.species}`;
  const group = new THREE.Group();
  group.name = namePrefix;

  let nominalW = 0.9 * s;
  let nominalH = 0.75 * s;
  let label = 'Foxtail Agave (Agave attenuata)';

  if (options.species === 'agave-attenuata' || options.species === 'aloe') {
    const isAloe = options.species === 'aloe';
    label = isAloe ? 'Architectural Aloe (Aloe arborescens)' : 'Foxtail Agave (Agave attenuata)';
    nominalW = (isAloe ? 0.72 : 0.95) * s;
    nominalH = (isAloe ? 0.58 : 0.72) * s;
    const stemH = (isAloe ? 0.12 : 0.18) * s;
    bark.addTaperedTube({
      points: [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, stemH, 0)],
      radii: [0.055 * s, 0.042 * s],
      radialSegments: 7,
      color: new THREE.Color(0x6e6253),
      jitter: rng.next(),
      reactivity,
    });

    const baseCol = new THREE.Color(isAloe ? 0x4b7454 : 0x6b9472);
    const whorls = 4;
    const golden = Math.PI * (3 - Math.sqrt(5));
    let bladeIdx = 0;
    for (let w = 0; w < whorls; w++) {
      const wf = w / (whorls - 1);
      const count = isAloe ? 6 - w : 8 - w;
      for (let k = 0; k < count; k++) {
        bladeIdx++;
        const az = bladeIdx * golden + rng.signed() * 0.08;
        const elev = THREE.MathUtils.lerp(0.22, 0.88, wf);
        const dir = new THREE.Vector3(
          Math.cos(az) * (1 - elev * 0.65),
          elev,
          Math.sin(az) * (1 - elev * 0.65)
        ).normalize();
        const bladeLen = THREE.MathUtils.lerp(nominalW * 0.54, nominalW * 0.34, wf);
        const piv = new THREE.Vector3(0, stemH * THREE.MathUtils.lerp(0.65, 1.0, wf), 0);
        foliage.addCuppedLeafBlade({
          pivot: piv,
          direction: dir,
          length: bladeLen,
          width: bladeLen * (isAloe ? 0.22 : 0.34),
          archDrop: bladeLen * (isAloe ? 0.14 : 0.24),
          cupDepth: bladeLen * 0.08,
          segsLength: 5,
          segsWidth: 3,
          shape: 'succulent-sword',
          color: baseCol.clone().offsetHSL(0, 0, wf * 0.04),
          meta: {
            organ: 'evergreen-leaf',
            jitter: rng.next(),
            reactivity,
            variant: 0.2,
          },
        });
      }
    }
  } else if (options.species === 'california-deergrass') {
    label = 'California Deergrass (Muhlenbergia rigens)';
    nominalW = 1.15 * s;
    nominalH = 0.88 * s;
    const bladeCol = new THREE.Color(0x557b3c);
    const blades = 64;
    for (let i = 0; i < blades; i++) {
      const az = (i / blades) * Math.PI * 2 + rng.signed() * 0.15;
      const radial = rng.range(0.01, 0.12) * s;
      const piv = new THREE.Vector3(Math.cos(az) * radial, 0.01, Math.sin(az) * radial);
      const tilt = rng.range(0.28, 0.86);
      const dir = new THREE.Vector3(Math.cos(az) * tilt, 1.05 - tilt * 0.45, Math.sin(az) * tilt).normalize();
      const len = rng.range(0.48, 0.78) * s;
      foliage.addCuppedLeafBlade({
        pivot: piv,
        direction: dir,
        length: len,
        width: 0.022 * s,
        archDrop: len * 0.46,
        cupDepth: 0.004,
        segsLength: 5,
        segsWidth: 2,
        shape: 'lanceolate',
        color: bladeCol.clone().offsetHSL(rng.signed() * 0.02, 0, rng.signed() * 0.04),
        meta: {
          organ: 'warm-season-grass',
          jitter: rng.next(),
          reactivity,
          variant: 0.5,
        },
      });
    }
  } else {
    // barrel-cactus: ribbed succulent dome + golden apical crown bloom
    label = 'Golden Barrel Cactus (Kroenleinia grusonii)';
    const radius = 0.26 * s;
    nominalW = radius * 2.1;
    nominalH = radius * 1.85;
    const latSegs = 10;
    const lonSegs = 24;
    const cactusCol = new THREE.Color(0x4b7438);
    const spineRidgeCol = new THREE.Color(0xc9b56a);
    const baseV = foliage.getVertexCount();

    for (let iy = 0; iy <= latSegs; iy++) {
      const v = iy / latSegs;
      const phi = v * Math.PI * 0.88;
      const sinP = Math.sin(phi);
      const cosP = Math.cos(phi);
      for (let ix = 0; ix <= lonSegs; ix++) {
        const u = ix / lonSegs;
        const theta = u * Math.PI * 2;
        const rib = 0.5 + 0.5 * Math.cos(theta * 14);
        const rMod = radius * (0.9 + 0.1 * rib);
        const nx = -Math.cos(theta) * sinP;
        const ny = cosP;
        const nz = Math.sin(theta) * sinP;
        const px = nx * rMod;
        const py = radius * 0.78 + ny * radius * 0.88;
        const pz = nz * rMod;
        const col = cactusCol.clone().lerp(spineRidgeCol, Math.pow(rib, 3) * 0.55);
        foliage.pushVertex(
          px,
          Math.max(0, py),
          pz,
          nx,
          ny,
          nz,
          u,
          1 - v,
          col.r,
          col.g,
          col.b,
          0,
          0,
          0,
          2,
          0.5,
          reactivity,
          0.1
        );
      }
    }
    const stride = lonSegs + 1;
    for (let iy = 0; iy < latSegs; iy++) {
      const r0 = baseV + iy * stride;
      const r1 = r0 + stride;
      for (let ix = 0; ix < lonSegs; ix++) {
        foliage.pushQuad(r0 + ix, r1 + ix, r1 + ix + 1, r0 + ix + 1);
      }
    }
    foliage.addFlowerRosette({
      pivot: new THREE.Vector3(0, radius * 1.64, 0),
      normal: new THREE.Vector3(0, 1, 0),
      radius: 0.065 * s,
      petalCount: 8,
      layers: 2,
      petalColor: new THREE.Color(0xecc83a),
      centerColor: new THREE.Color(0xd69e1c),
      rng,
      meta: {
        organ: 'summer-flower',
        jitter: rng.next(),
        reactivity,
        variant: 0.45,
      },
    });
  }

  return assembleBotanicalMeshes({
    group,
    namePrefix,
    exposure,
    barkCollector: bark,
    foliageCollector: foliage,
    barkStyle: 'gnarled-olive',
    uniforms: options.uniforms,
    castCanopyShadow: options.castShadow ?? true,
    solidTrunkCollision: false,
    metadata: {
      name: label,
      collection: 'husjs/vegetation Xerophytes',
      dimensionsMm: [
        Math.round(nominalW * 1000),
        Math.round(nominalW * 1000),
        Math.round(nominalH * 1000),
      ],
      ...options.metadata,
    },
  });
}
