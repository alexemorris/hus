import * as THREE from 'three';

export const SITE_GROUND_TEXTURE_SIZE = 256;

/** Small seeded PRNG (mulberry32) so procedural terrain textures are deterministic on every load. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createPeriodicLatticeSampler(size: number, rand: () => number) {
  const buildLattice = (n: number): Float32Array => {
    const g = new Float32Array(n * n);
    for (let i = 0; i < g.length; i++) g[i] = rand();
    return g;
  };
  const sample = (g: Float32Array, n: number, x: number, y: number): number => {
    const fx = ((((x % size) + size) % size) / size) * n;
    const fy = ((((y % size) + size) % size) / size) * n;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const at = (ix: number, iy: number): number => g[((iy % n) * n + (ix % n)) % (n * n)]!;
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
  return { buildLattice, sample };
}

export function configureRepeatDataTexture(
  data: Uint8Array,
  size: number,
  colorSpace: THREE.ColorSpace
): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = colorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Tileable English meadow & lawn albedo (sRGB bytes): three smooth periodic noise octaves plus
 * directional fescue/ryegrass blade micro-grain and subtle sunlit chlorophyll variation.
 */
export function buildMeadowTextureData(size = SITE_GROUND_TEXTURE_SIZE, seed = 1337): Uint8Array {
  const rand = mulberry32(seed);
  const { buildLattice, sample } = createPeriodicLatticeSampler(size, rand);
  const g0 = buildLattice(6);
  const g1 = buildLattice(18);
  const g2 = buildLattice(54);
  const gBlade = buildLattice(96);

  const data = new Uint8Array(size * size * 4);
  const lush = [84, 114, 53];
  const warmClover = [106, 126, 61];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fbm =
        sample(g0, 6, x, y) * 0.44 +
        sample(g1, 18, x, y) * 0.34 +
        sample(g2, 54, x, y) * 0.22;
      const bladeTuft = sample(gBlade, 96, x * 1.15, y * 0.85) - 0.5;
      const bladeGrain = (rand() - 0.5) * 0.065 + bladeTuft * 0.09;
      const shade = 0.89 + fbm * 0.19 + bladeGrain;
      const warmMix = THREE.MathUtils.clamp((fbm - 0.40) * 1.38, 0, 1);
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        const base = lush[c]! + (warmClover[c]! - lush[c]!) * warmMix;
        data[i + c] = THREE.MathUtils.clamp(Math.round(base * shade), 0, 255);
      }
      data[i + 3] = 255;
    }
  }
  return data;
}

/**
 * Multi-scale procedural grass-blade & thatch relief detail map (linear RGBA):
 * - `R`: `dH/dU` normal derivative (`0.5` = flat)
 * - `G`: `dH/dV` normal derivative (`0.5` = flat)
 * - `B`: blade height / thatch crevice AO (`0` = recessed thatch, `1` = upright blade tip)
 * - `A`: dry blade micro-roughness (`0.72` waxy blade cuticle .. `0.97` matte thatch pocket)
 */
export function buildMeadowBladeDetailTextureData(
  size = SITE_GROUND_TEXTURE_SIZE,
  seed = 2749
): Uint8Array {
  const rand = mulberry32(seed);
  const { buildLattice, sample } = createPeriodicLatticeSampler(size, rand);
  const gTuft = buildLattice(16);
  const gClump = buildLattice(40);
  const gBladeA = buildLattice(88);
  const gBladeB = buildLattice(112);

  const heightField = new Float32Array(size * size);
  const roughField = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const swirl = (sample(gTuft, 16, x, y) - 0.5) * 9.0;
      const clump = sample(gClump, 40, x + swirl * 0.35, y - swirl * 0.25);
      // Anisotropic crisscross blade strands so turf has crisp close-up grass texture without grid lines
      const strandA = sample(gBladeA, 88, x * 1.35 + swirl, y * 0.72 - swirl * 0.5);
      const strandB = sample(gBladeB, 112, x * 0.68 - swirl * 0.6, y * 1.42 + swirl);
      const bladePeak = Math.max(strandA, strandB * 0.94);
      const thatchPocket = bladePeak < 0.38 ? 0.55 : 1.0;
      const h = THREE.MathUtils.clamp(
        (bladePeak * 0.62 + clump * 0.26 + (rand() - 0.5) * 0.05) * thatchPocket,
        0,
        1
      );
      const idx = y * size + x;
      heightField[idx] = h;
      roughField[idx] = THREE.MathUtils.clamp(0.96 - h * 0.22 + (0.5 - clump) * 0.05, 0.70, 0.98);
    }
  }

  const hAt = (ix: number, iy: number): number => {
    const wx = ((ix % size) + size) % size;
    const wy = ((iy % size) + size) % size;
    return heightField[wy * size + wx]!;
  };

  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      const i4 = idx * 4;
      const dU = THREE.MathUtils.clamp((hAt(x + 1, y) - hAt(x - 1, y)) * 1.85, -0.48, 0.48);
      const dV = THREE.MathUtils.clamp((hAt(x, y + 1) - hAt(x, y - 1)) * 1.85, -0.48, 0.48);
      out[i4] = Math.round((0.5 + dU) * 255);
      out[i4 + 1] = Math.round((0.5 + dV) * 255);
      out[i4 + 2] = Math.round(heightField[idx]! * 255);
      out[i4 + 3] = Math.round(roughField[idx]! * 255);
    }
  }
  return out;
}

/**
 * Tileable decomposed-granite gravel & dusty sandy-loam detail texture (linear variation factors
 * centered around warm neutral buff, with coarse quartz/feldspar gravel grit & pebble pockets).
 */
export function buildAridSoilTextureData(
  size = SITE_GROUND_TEXTURE_SIZE,
  seed = 4120
): Uint8Array {
  const rand = mulberry32(seed);
  const { buildLattice, sample } = createPeriodicLatticeSampler(size, rand);
  const g0 = buildLattice(8);
  const g1 = buildLattice(24);
  const g2 = buildLattice(64);

  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const macro = sample(g0, 8, x, y);
      const mid = sample(g1, 24, x, y);
      const fine = sample(g2, 64, x, y);
      const pebble = rand();
      const speckle = pebble > 0.93 ? 0.14 : pebble < 0.06 ? -0.13 : (pebble - 0.5) * 0.08;
      const fbm = macro * 0.42 + mid * 0.35 + fine * 0.23;

      const lum = THREE.MathUtils.clamp(0.84 + fbm * 0.32 + speckle, 0.68, 1.32);
      const warmShift = (macro - 0.5) * 0.08;
      const i = (y * size + x) * 4;
      data[i] = THREE.MathUtils.clamp(Math.round((lum + warmShift) * 192), 0, 255);
      data[i + 1] = THREE.MathUtils.clamp(Math.round(lum * 192), 0, 255);
      data[i + 2] = THREE.MathUtils.clamp(Math.round((lum - warmShift * 0.9) * 192), 0, 255);
      data[i + 3] = THREE.MathUtils.clamp(Math.round((0.88 + (1 - fine) * 0.10) * 255), 0, 255);
    }
  }
  return data;
}

export interface AridCliffRockTextureBundle {
  readonly rockPattern: Uint8Array;
  readonly rockDetail: Uint8Array;
}

/**
 * Tileable fractured decomposed-granite & iron-stained Hollywood Hills sandstone cliff maps.
 */
export function buildAridCliffRockTextureData(
  size = SITE_GROUND_TEXTURE_SIZE,
  seed = 9069
): AridCliffRockTextureBundle {
  const rand = mulberry32(seed);
  const { buildLattice, sample } = createPeriodicLatticeSampler(size, rand);
  const gMacro = buildLattice(6);
  const gMid = buildLattice(16);
  const gJointA = buildLattice(12);
  const gJointB = buildLattice(28);
  const gFine = buildLattice(56);
  const gGrit = buildLattice(96);

  const heightField = new Float32Array(size * size);
  const creviceField = new Float32Array(size * size);
  const ironField = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const warpX = (sample(gMacro, 6, x, y) - 0.5) * 26.0;
      const warpY = (sample(gMid, 16, x + 37, y + 19) - 0.5) * 18.0;

      const strataCoord = (y + warpY + (x / size) * 14.0) / size;
      const strataWave =
        0.5 +
        0.28 * Math.sin(strataCoord * Math.PI * 2 * 7.0) +
        0.14 * Math.sin(strataCoord * Math.PI * 2 * 19.0 + 1.1) +
        0.08 * Math.sin(strataCoord * Math.PI * 2 * 37.0 + 2.4);

      const jA =
        1.0 - Math.abs(sample(gJointA, 12, x + warpX * 0.5, y * 0.75 + warpY * 0.35) * 2.0 - 1.0);
      const jB =
        1.0 - Math.abs(sample(gJointB, 28, x * 1.15 - warpY * 0.4, y + warpX * 0.3) * 2.0 - 1.0);
      const fine = sample(gFine, 56, x, y);
      const grit = sample(gGrit, 96, x, y);

      const fissureA = Math.pow(Math.max(0, jA - 0.38) / 0.62, 2.4);
      const fissureB = Math.pow(Math.max(0, jB - 0.46) / 0.54, 2.8);
      const strataLedge = Math.pow(Math.max(0, 1.0 - Math.abs(strataWave - 0.48) * 3.4), 2.1);
      const crevice = Math.min(1.0, fissureA * 0.78 + fissureB * 0.52 + strataLedge * 0.28);

      const blockFacet =
        strataWave * 0.38 +
        sample(gMid, 16, x + warpX * 0.25, y) * 0.30 +
        fine * 0.20 +
        grit * 0.12;
      const h = THREE.MathUtils.clamp(blockFacet - crevice * 0.52, 0, 1);

      const idx = y * size + x;
      heightField[idx] = h;
      creviceField[idx] = 1.0 - crevice * 0.78;
      ironField[idx] = THREE.MathUtils.clamp(
        strataWave * 0.55 + sample(gMacro, 6, x + 71, y + 43) * 0.45,
        0,
        1
      );
    }
  }

  const rockPattern = new Uint8Array(size * size * 4);
  const rockDetail = new Uint8Array(size * size * 4);
  const hAt = (ix: number, iy: number): number => {
    const wx = ((ix % size) + size) % size;
    const wy = ((iy % size) + size) % size;
    return heightField[wy * size + wx]!;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      const i4 = idx * 4;
      const h = heightField[idx]!;
      const ao = creviceField[idx]!;
      const iron = ironField[idx]!;
      const micro = (rand() - 0.5) * 0.06;

      const dHdU = (hAt(x + 1, y) - hAt(x - 1, y)) * 2.35;
      const dHdV = (hAt(x, y + 1) - hAt(x, y - 1)) * 2.65;

      rockPattern[i4] = THREE.MathUtils.clamp(Math.round(THREE.MathUtils.clamp(h + micro, 0, 1) * 255), 0, 255);
      rockPattern[i4 + 1] = THREE.MathUtils.clamp(Math.round(iron * 255), 0, 255);
      rockPattern[i4 + 2] = THREE.MathUtils.clamp(Math.round(ao * 255), 0, 255);
      const rough = THREE.MathUtils.clamp(0.84 + (1.0 - ao) * 0.14 - h * 0.06, 0.76, 0.99);
      rockPattern[i4 + 3] = Math.round(rough * 255);

      rockDetail[i4] = THREE.MathUtils.clamp(
        Math.round((0.5 + THREE.MathUtils.clamp(dHdU, -0.48, 0.48)) * 255),
        0,
        255
      );
      rockDetail[i4 + 1] = THREE.MathUtils.clamp(
        Math.round((0.5 + THREE.MathUtils.clamp(dHdV, -0.48, 0.48)) * 255),
        0,
        255
      );
      rockDetail[i4 + 2] = rockPattern[i4 + 2]!;
      rockDetail[i4 + 3] = rockPattern[i4 + 3]!;
    }
  }

  return { rockPattern, rockDetail };
}
