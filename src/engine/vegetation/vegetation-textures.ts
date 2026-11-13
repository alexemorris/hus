import * as THREE from 'three';

export type BarkTextureStyle =
  | 'fissured-oak'
  | 'birch-lenticel'
  | 'smooth-beech'
  | 'flaky-pine'
  | 'gnarled-olive'
  | 'fibrous-vine';

export interface BarkTextureSet {
  readonly albedoMap: THREE.DataTexture;
  readonly normalMap: THREE.DataTexture;
}

const barkCache = new Map<BarkTextureStyle, BarkTextureSet>();
let leafVeinNormalCache: THREE.DataTexture | null = null;

function hash2d(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1442695041) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function valueNoiseTile(u: number, v: number, freqU: number, freqV: number, seed: number): number {
  const x = u * freqU;
  const y = v * freqV;
  const ix0 = Math.floor(x);
  const iy0 = Math.floor(y);
  const fx = x - ix0;
  const fy = y - iy0;
  const sx = THREE.MathUtils.smoothstep(fx, 0, 1);
  const sy = THREE.MathUtils.smoothstep(fy, 0, 1);

  const wU = Math.max(1, Math.round(freqU));
  const wV = Math.max(1, Math.round(freqV));
  const x0 = ((ix0 % wU) + wU) % wU;
  const x1 = (x0 + 1) % wU;
  const y0 = ((iy0 % wV) + wV) % wV;
  const y1 = (y0 + 1) % wV;

  const n00 = hash2d(x0, y0, seed);
  const n10 = hash2d(x1, y0, seed);
  const n01 = hash2d(x0, y1, seed);
  const n11 = hash2d(x1, y1, seed);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(n00, n10, sx),
    THREE.MathUtils.lerp(n01, n11, sx),
    sy
  );
}

function buildNormalFromHeightField(
  heights: Float32Array,
  size: number,
  strength: number
): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const ym = (y - 1 + size) % size;
    const yp = (y + 1) % size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;
      const dx = (heights[y * size + xp]! - heights[y * size + xm]!) * strength;
      const dy = (heights[yp * size + x]! - heights[ym * size + x]!) * strength;
      let nx = -dx;
      let ny = -dy;
      let nz = 1.0;
      const invLen = 1 / Math.hypot(nx, ny, nz);
      nx *= invLen;
      ny *= invLen;
      nz *= invLen;
      const idx = (y * size + x) * 4;
      data[idx] = Math.round(THREE.MathUtils.clamp((nx * 0.5 + 0.5) * 255, 0, 255));
      data[idx + 1] = Math.round(THREE.MathUtils.clamp((ny * 0.5 + 0.5) * 255, 0, 255));
      data[idx + 2] = Math.round(THREE.MathUtils.clamp((nz * 0.5 + 0.5) * 255, 0, 255));
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates and caches tileable procedural bark albedo and tangent-space normal `DataTexture` pairs
 * so trunks, limbs, twigs, and woody vines render deep bark fissures without external image files.
 */
export function getOrCreateBarkTextures(style: BarkTextureStyle = 'fissured-oak'): BarkTextureSet {
  const existing = barkCache.get(style);
  if (existing) return existing;

  const size = 128;
  const heights = new Float32Array(size * size);
  const albedo = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      let h = 0.5;
      let r = 0.36;
      let g = 0.29;
      let b = 0.23;

      if (style === 'birch-lenticel') {
        const basePaper = valueNoiseTile(u, v, 6, 4, 17);
        const lenticelBand = valueNoiseTile(u, v, 3, 42, 31);
        const darkCrevice = lenticelBand > 0.77 ? THREE.MathUtils.smoothstep(lenticelBand, 0.77, 0.93) : 0;
        const basalCrack = valueNoiseTile(u, v, 14, 5, 53);
        const crack = basalCrack > 0.78 ? (basalCrack - 0.78) * 3.2 : 0;
        h = 0.78 - darkCrevice * 0.42 - crack * 0.55 + basePaper * 0.12;
        const tone = THREE.MathUtils.clamp(0.88 + basePaper * 0.1 - darkCrevice * 0.62 - crack * 0.58, 0.18, 0.96);
        r = tone;
        g = tone * 0.97;
        b = tone * 0.93;
      } else if (style === 'smooth-beech') {
        const grain = valueNoiseTile(u, v, 10, 12, 71);
        const horizontalRing = valueNoiseTile(u, v, 3, 26, 89);
        h = 0.55 + grain * 0.18 + (horizontalRing - 0.5) * 0.14;
        const tone = 0.42 + grain * 0.12;
        r = tone * 1.02;
        g = tone * 0.98;
        b = tone * 0.93;
      } else if (style === 'flaky-pine') {
        const plate = valueNoiseTile(u, v, 7, 5, 103);
        const fine = valueNoiseTile(u, v, 22, 18, 127);
        const ridge = THREE.MathUtils.smoothstep(plate, 0.36, 0.62);
        h = ridge * 0.72 + fine * 0.22;
        r = THREE.MathUtils.lerp(0.22, 0.48, ridge) + fine * 0.05;
        g = THREE.MathUtils.lerp(0.15, 0.31, ridge) + fine * 0.04;
        b = THREE.MathUtils.lerp(0.12, 0.22, ridge) + fine * 0.03;
      } else if (style === 'gnarled-olive') {
        const twistU = u + (valueNoiseTile(u, v, 4, 6, 151) - 0.5) * 0.18;
        const furrow = valueNoiseTile(twistU, v, 14, 5, 163);
        const micro = valueNoiseTile(u, v, 28, 20, 181);
        h = THREE.MathUtils.smoothstep(furrow, 0.28, 0.74) * 0.75 + micro * 0.25;
        const greyTone = THREE.MathUtils.lerp(0.28, 0.56, h);
        r = greyTone * 1.03;
        g = greyTone * 1.0;
        b = greyTone * 0.92;
      } else if (style === 'fibrous-vine') {
        const strand = valueNoiseTile(u, v, 24, 4, 197);
        const micro = valueNoiseTile(u, v, 32, 16, 211);
        h = strand * 0.7 + micro * 0.3;
        r = THREE.MathUtils.lerp(0.26, 0.44, h);
        g = THREE.MathUtils.lerp(0.21, 0.35, h);
        b = THREE.MathUtils.lerp(0.16, 0.26, h);
      } else {
        const warp = (valueNoiseTile(u, v, 5, 6, 229) - 0.5) * 0.09;
        const fissure = valueNoiseTile(u + warp, v, 16, 4, 241);
        const detail = valueNoiseTile(u, v, 32, 14, 257);
        const ridge = THREE.MathUtils.smoothstep(fissure, 0.32, 0.72);
        h = ridge * 0.78 + detail * 0.22;
        const mossHint = valueNoiseTile(u, v, 6, 6, 271) > 0.74 ? 0.05 : 0;
        r = THREE.MathUtils.lerp(0.2, 0.42, ridge) + detail * 0.05;
        g = THREE.MathUtils.lerp(0.16, 0.34, ridge) + detail * 0.05 + mossHint;
        b = THREE.MathUtils.lerp(0.12, 0.25, ridge) + detail * 0.04;
      }

      heights[y * size + x] = h;
      const idx = (y * size + x) * 4;
      albedo[idx] = Math.round(THREE.MathUtils.clamp(r * 255, 0, 255));
      albedo[idx + 1] = Math.round(THREE.MathUtils.clamp(g * 255, 0, 255));
      albedo[idx + 2] = Math.round(THREE.MathUtils.clamp(b * 255, 0, 255));
      albedo[idx + 3] = 255;
    }
  }

  const albedoMap = new THREE.DataTexture(albedo, size, size, THREE.RGBAFormat);
  albedoMap.wrapS = THREE.RepeatWrapping;
  albedoMap.wrapT = THREE.RepeatWrapping;
  albedoMap.colorSpace = THREE.SRGBColorSpace;
  albedoMap.magFilter = THREE.LinearFilter;
  albedoMap.minFilter = THREE.LinearMipmapLinearFilter;
  albedoMap.generateMipmaps = true;
  albedoMap.needsUpdate = true;

  const strength = style === 'smooth-beech' ? 1.4 : style === 'birch-lenticel' ? 2.2 : 3.4;
  const normalMap = buildNormalFromHeightField(heights, size, strength);
  const set: BarkTextureSet = { albedoMap, normalMap };
  barkCache.set(style, set);
  return set;
}

/**
 * Shared procedural foliage midrib & lateral-vein normal map (`64x64`) giving leaves and petals
 * realistic micro-relief and specular breakup across UV `[0..1]`.
 */
export function getOrCreateLeafVeinNormalMap(): THREE.DataTexture {
  if (leafVeinNormalCache) return leafVeinNormalCache;
  const size = 64;
  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = y / (size - 1);
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1);
      const midribDist = Math.abs(u - 0.5);
      const midrib = Math.exp(-midribDist * midribDist * 280) * (1 - v * 0.55);
      const chevronCoord = v * 9.5 - midribDist * 6.2;
      const lateralWave = Math.abs(Math.sin(chevronCoord * Math.PI));
      const lateralVein = Math.pow(1 - lateralWave, 5) * THREE.MathUtils.smoothstep(midribDist, 0.02, 0.42) * 0.42;
      const cellMicro = valueNoiseTile(u, v, 18, 18, 313) * 0.12;
      heights[y * size + x] = 0.5 + midrib * 0.35 + lateralVein * 0.25 + cellMicro;
    }
  }
  leafVeinNormalCache = buildNormalFromHeightField(heights, size, 1.85);
  return leafVeinNormalCache;
}
