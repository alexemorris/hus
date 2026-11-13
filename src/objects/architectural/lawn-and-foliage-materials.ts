import * as THREE from 'three';
import {
  Fn,
  clamp,
  float,
  mix,
  positionWorld,
  texture,
  uv,
  vec3,
} from 'three/tsl';
import { buildContinuousTurfShadingNodes } from '../../engine/vegetation/turf-phenology-node.ts';
import {
  deriveNormalAndRoughnessFromHeight,
  makeRgbaDataTexture,
  seamlessFbm2D,
  seamlessValueNoise2D,
} from '../shared/neptune-and-georgian-materials.ts';

interface TslCapableStandardMaterial {
  colorNode?: unknown;
  roughnessNode?: unknown;
}

let cachedRollerMownLawnMat: THREE.MeshStandardMaterial | null = null;

/**
 * 512x512 procedural PBR Roller-Mown Striped English Lawn material (`1 UV = 1.80 m` -> `900 mm` mowing stripes,
 * multi-scale fescue/ryegrass blade & thatch normal relief, micro-roughness variation, grazing-angle
 * velvety Fresnel blade sheen, and continuous `uYearPhase` + `ClimateZone` + `rainWetness` + `snowAmount`
 * seasonal TSL shading).
 */
export function createRollerMownStripedLawnMaterial(): THREE.MeshStandardMaterial {
  if (cachedRollerMownLawnMat) return cachedRollerMownLawnMat;
  const N = 512;
  const albedo = new Uint8Array(N * N * 4);
  const bladeMeta = new Uint8Array(N * N * 4);
  const heightF = new Float32Array(N * N);
  const roughF = new Float32Array(N * N);

  for (let py = 0; py < N; py++) {
    const v = py / N;
    for (let px = 0; px < N; px++) {
      const u = px / N;
      const wobble = (seamlessFbm2D(u, v, 4, 3, 211) - 0.5) * 0.045;
      const rawWave = Math.sin((u + wobble) * Math.PI * 2);
      const stripe = 0.5 + 0.5 * Math.tanh(rawWave * 3.1);

      const turfPatch = seamlessFbm2D(u, v, 6, 4, 307);
      const thatchClump = seamlessFbm2D(u, v, 18, 3, 359);
      const bladeA = seamlessValueNoise2D(u, v, 96, 144, 419);
      const bladeB = seamlessValueNoise2D(u, v, 176, 104, 523);
      const fineStrand = seamlessValueNoise2D(u, v, 224, 192, 607);
      const blades = bladeA * 0.46 + bladeB * 0.34 + fineStrand * 0.20;
      const thatchPocket = blades < 0.34 ? 0.72 : 1.0;

      // Rich natural English fescue & perennial ryegrass (light bent-away vs dark bent-toward blades)
      const rBase =
        (56 + stripe * 22 + (turfPatch - 0.5) * 14 + (blades - 0.5) * 19) * thatchPocket;
      const gBase =
        (91 + stripe * 27 + (turfPatch - 0.5) * 16 + (blades - 0.5) * 22) * thatchPocket;
      const bBase =
        (40 + stripe * 13 + (turfPatch - 0.5) * 9 + (blades - 0.5) * 11) * thatchPocket;

      const idx = py * N + px;
      const o = idx * 4;
      albedo[o] = THREE.MathUtils.clamp(Math.round(rBase), 0, 255);
      albedo[o + 1] = THREE.MathUtils.clamp(Math.round(gBase), 0, 255);
      albedo[o + 2] = THREE.MathUtils.clamp(Math.round(bBase), 0, 255);
      albedo[o + 3] = 255;

      const h = THREE.MathUtils.clamp(
        (0.24 + blades * 0.54 + thatchClump * 0.14 + turfPatch * 0.08) *
          (blades < 0.32 ? 0.65 : 1.0),
        0,
        1
      );
      const rough = THREE.MathUtils.clamp(
        0.95 - stripe * 0.09 - h * 0.12 + (0.5 - blades) * 0.06,
        0.68,
        0.98
      );
      heightF[idx] = h;
      roughF[idx] = rough;

      bladeMeta[o] = Math.round(h * 255);
      bladeMeta[o + 1] = Math.round(turfPatch * 255);
      bladeMeta[o + 2] = Math.round(stripe * 255);
      bladeMeta[o + 3] = Math.round(rough * 255);
    }
  }

  const map = makeRgbaDataTexture(albedo, N, N, 'catalog.rollerMownLawn.albedo', true, 1, 1);
  const metaMap = makeRgbaDataTexture(
    bladeMeta,
    N,
    N,
    'catalog.rollerMownLawn.bladeMeta',
    false,
    1,
    1
  );
  const nr = deriveNormalAndRoughnessFromHeight(
    heightF,
    roughF,
    N,
    N,
    3.6,
    'catalog.rollerMownLawn',
    1,
    1
  );

  const mat = new THREE.MeshStandardMaterial({
    name: 'catalog.rollerMownStripedLawn',
    color: 0xffffff,
    map,
    normalMap: nr.normalMap,
    normalScale: new THREE.Vector2(0.82, 0.82),
    roughnessMap: nr.roughnessMap,
    roughness: 0.90,
    metalness: 0.0,
  });
  mat.userData = {
    ...mat.userData,
    skipMaterialDedupe: true,
    excludeIndoorLighting: true,
  };

  const tslMat = mat as unknown as TslCapableStandardMaterial;
  const uMacroInvM = float(1.0 / 9.5);

  tslMat.colorNode = Fn(() => {
    const uvCoord = uv();
    const baseSample = texture(map, uvCoord).rgb;
    const metaSample = texture(metaMap, uvCoord);
    const worldPatch = texture(metaMap, positionWorld.xz.mul(uMacroInvM)).g;
    const patchNoise = clamp(metaSample.g.mul(0.55).add(worldPatch.mul(0.45)), 0.0, 1.0);
    // Roller-mown stripe directional sheen boost on blades bent away from camera
    const stripeLift = mix(float(0.95), float(1.06), metaSample.b);
    const turf = buildContinuousTurfShadingNodes({
      baseGrassRgb: baseSample.mul(stripeLift),
      bladeHeight: metaSample.r,
      patchNoise,
      baseRoughness: metaSample.a,
    });
    return turf.colorRgb;
  })();

  tslMat.roughnessNode = Fn(() => {
    const metaSample = texture(metaMap, uv());
    const turf = buildContinuousTurfShadingNodes({
      baseGrassRgb: vec3(0.24, 0.36, 0.16),
      bladeHeight: metaSample.r,
      patchNoise: metaSample.g,
      baseRoughness: metaSample.a,
    });
    return turf.roughness;
  })();

  cachedRollerMownLawnMat = mat;
  return cachedRollerMownLawnMat;
}

const cachedFoliageMaterials = new Map<string, THREE.MeshStandardMaterial>();

/**
 * 512x512 procedural evergreen leaf-cluster PBR material (`albedo + normalMap + roughnessMap`)
 * for Taxus baccata (English Yew) hedging & Buxus sempervirens (Boxwood) topiary.
 */
export function createEvergreenFoliagePbrMaterial(
  species: 'englishYew' | 'boxwoodBuxus' | 'herbaceousBorder' = 'englishYew'
): THREE.MeshStandardMaterial {
  const hit = cachedFoliageMaterials.get(species);
  if (hit) return hit;

  const N = 512;
  const albedo = new Uint8Array(N * N * 4);
  const heightF = new Float32Array(N * N);
  const roughF = new Float32Array(N * N);

  const palette =
    species === 'englishYew'
      ? { r: 36, g: 59, b: 34, tipR: 58, tipG: 88, tipB: 46, seed: 613 }
      : species === 'boxwoodBuxus'
        ? { r: 52, g: 84, b: 39, tipR: 86, tipG: 124, tipB: 54, seed: 727 }
        : { r: 58, g: 82, b: 54, tipR: 118, tipG: 108, tipB: 138, seed: 839 };

  for (let py = 0; py < N; py++) {
    const v = py / N;
    for (let px = 0; px < N; px++) {
      const u = px / N;
      const clump = seamlessFbm2D(u, v, 8, 4, palette.seed);
      const leafA = seamlessValueNoise2D(u, v, 44, 52, palette.seed + 31);
      const leafB = seamlessValueNoise2D(u, v, 88, 76, palette.seed + 67);
      const needle = leafA * 0.55 + leafB * 0.45;
      const pocket = needle < 0.34 ? 0.52 : 1.0;
      const shoot = Math.max(0, (needle - 0.58) / 0.42) * clump;

      const r = (palette.r * (1 - shoot) + palette.tipR * shoot + (clump - 0.5) * 14) * pocket;
      const g = (palette.g * (1 - shoot) + palette.tipG * shoot + (clump - 0.5) * 18) * pocket;
      const b = (palette.b * (1 - shoot) + palette.tipB * shoot + (clump - 0.5) * 12) * pocket;

      const idx = py * N + px;
      const o = idx * 4;
      albedo[o] = THREE.MathUtils.clamp(Math.round(r), 0, 255);
      albedo[o + 1] = THREE.MathUtils.clamp(Math.round(g), 0, 255);
      albedo[o + 2] = THREE.MathUtils.clamp(Math.round(b), 0, 255);
      albedo[o + 3] = 255;

      heightF[idx] = pocket < 1 ? 0.12 + needle * 0.3 : 0.45 + needle * 0.42 + clump * 0.13;
      roughF[idx] = pocket < 1 ? 0.96 : 0.68 + (1 - shoot) * 0.16;
    }
  }

  const rep = species === 'boxwoodBuxus' ? 2.4 : 1.6;
  const map = makeRgbaDataTexture(
    albedo,
    N,
    N,
    `catalog.foliage.${species}.albedo`,
    true,
    rep,
    rep
  );
  const nr = deriveNormalAndRoughnessFromHeight(
    heightF,
    roughF,
    N,
    N,
    3.6,
    `catalog.foliage.${species}`,
    rep,
    rep
  );
  const mat = new THREE.MeshStandardMaterial({
    name: `catalog.foliage.${species}`,
    color: 0xffffff,
    map,
    normalMap: nr.normalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughnessMap: nr.roughnessMap,
    roughness: 0.82,
    metalness: 0.0,
  });
  cachedFoliageMaterials.set(species, mat);
  return mat;
}
