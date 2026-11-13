import * as THREE from 'three';

export type SoilSubstrate =
  | 'garden-loam'
  | 'bark-mulch'
  | 'tilled-veg-earth'
  | 'potting-compost'
  | 'gravel-mulch'
  | 'decomposed-granite';

export interface SoilTextureSet {
  readonly substrate: SoilSubstrate;
  readonly albedoMap: THREE.DataTexture;
  readonly normalMap: THREE.DataTexture;
  readonly roughnessMap: THREE.DataTexture;
  /** Default world metres per 1.0 UV tile. */
  readonly tileMetres: number;
}

const soilTextureCache = new Map<SoilSubstrate, SoilTextureSet>();

const SUBSTRATE_SPECS: Readonly<
  Record<SoilSubstrate, { readonly dark: number; readonly light: number; readonly tileMetres: number; readonly normalStrength: number }>
> = {
  'garden-loam': { dark: 0x3a2a1d, light: 0x523c2a, tileMetres: 0.85, normalStrength: 3.2 },
  'bark-mulch': { dark: 0x462e1e, light: 0x684730, tileMetres: 0.75, normalStrength: 4.1 },
  'tilled-veg-earth': { dark: 0x3f2d1f, light: 0x59412e, tileMetres: 0.70, normalStrength: 3.5 },
  'potting-compost': { dark: 0x2c1f16, light: 0x3f2d20, tileMetres: 0.45, normalStrength: 2.4 },
  'gravel-mulch': { dark: 0x8b7e6b, light: 0xafa18c, tileMetres: 0.65, normalStrength: 4.3 },
  'decomposed-granite': { dark: 0xa89274, light: 0xc4ae8e, tileMetres: 0.80, normalStrength: 2.7 },
};

function hash2d(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function wrapIndex(i: number, period: number): number {
  return ((i % period) + period) % period;
}

function valueNoiseTile(u: number, v: number, freqU: number, freqV: number, seed: number): number {
  const wU = Math.max(1, Math.round(freqU));
  const wV = Math.max(1, Math.round(freqV));
  const x = u * wU;
  const y = v * wV;
  const ix0 = Math.floor(x);
  const iy0 = Math.floor(y);
  const sx = THREE.MathUtils.smoothstep(x - ix0, 0, 1);
  const sy = THREE.MathUtils.smoothstep(y - iy0, 0, 1);
  const x0 = wrapIndex(ix0, wU);
  const x1 = wrapIndex(ix0 + 1, wU);
  const y0 = wrapIndex(iy0, wV);
  const y1 = wrapIndex(iy0 + 1, wV);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(hash2d(x0, y0, seed), hash2d(x1, y0, seed), sx),
    THREE.MathUtils.lerp(hash2d(x0, y1, seed), hash2d(x1, y1, seed), sx),
    sy
  );
}

function fbmTile(u: number, v: number, baseFreq: number, seed: number): number {
  return (
    valueNoiseTile(u, v, baseFreq, baseFreq, seed) * 0.54 +
    valueNoiseTile(u, v, baseFreq * 2, baseFreq * 2, seed + 37) * 0.30 +
    valueNoiseTile(u, v, baseFreq * 4, baseFreq * 4, seed + 83) * 0.16
  );
}

interface CellularSample {
  readonly f1: number;
  readonly edge: number;
  readonly idHash: number;
  readonly orient: number;
}

function cellularTile(
  u: number,
  v: number,
  cellsU: number,
  cellsV: number,
  aniso: number,
  seed: number
): CellularSample {
  const gx = u * cellsU;
  const gy = v * cellsV;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  let d1 = 1e9;
  let d2 = 1e9;
  let idHash = 0.5;
  let orient = 0;

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = wrapIndex(ix + dx, cellsU);
      const cy = wrapIndex(iy + dy, cellsV);
      const ang = hash2d(cx, cy, seed + 41) * Math.PI;
      const rx = gx - (ix + dx + 0.14 + hash2d(cx, cy, seed) * 0.72);
      const ry = gy - (iy + dy + 0.14 + hash2d(cx, cy, seed + 19) * 0.72);
      let distSq = rx * rx + ry * ry;
      if (aniso > 1.01) {
        const cosA = Math.cos(ang);
        const sinA = Math.sin(ang);
        const along = rx * cosA + ry * sinA;
        const across = (-rx * sinA + ry * cosA) * aniso;
        distSq = along * along + across * across;
      }
      if (distSq < d1) {
        d2 = d1;
        d1 = distSq;
        idHash = hash2d(cx, cy, seed + 67);
        orient = ang;
      } else if (distSq < d2) {
        d2 = distSq;
      }
    }
  }
  const f1 = Math.sqrt(d1);
  return { f1, edge: THREE.MathUtils.clamp(Math.sqrt(d2) - f1, 0, 1), idHash, orient };
}

function hexRgb(hex: number): readonly [number, number, number] {
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
}

function lerpRgb(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number
): [number, number, number] {
  const k = THREE.MathUtils.clamp(t, 0, 1);
  return [
    THREE.MathUtils.lerp(a[0], b[0], k),
    THREE.MathUtils.lerp(a[1], b[1], k),
    THREE.MathUtils.lerp(a[2], b[2], k),
  ];
}

function createTiledDataTexture(
  data: Uint8Array,
  size: number,
  colorSpace: THREE.ColorSpace
): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = colorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function buildNormalMapFromHeights(
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
      const invLen = 1 / Math.hypot(-dx, -dy, 1);
      const idx = (y * size + x) * 4;
      data[idx] = Math.round(THREE.MathUtils.clamp((-dx * invLen * 0.5 + 0.5) * 255, 0, 255));
      data[idx + 1] = Math.round(THREE.MathUtils.clamp((-dy * invLen * 0.5 + 0.5) * 255, 0, 255));
      data[idx + 2] = Math.round(THREE.MathUtils.clamp((invLen * 0.5 + 0.5) * 255, 0, 255));
      data[idx + 3] = 255;
    }
  }
  return createTiledDataTexture(data, size, THREE.NoColorSpace);
}

/**
 * Generates and caches deterministic tileable `128x128` PBR soil & mulch `DataTexture` sets
 * (`albedoMap`, `normalMap`, `roughnessMap`) for all 6 horticultural substrates.
 */
export function getOrCreateSoilTextures(
  substrate: SoilSubstrate = 'garden-loam'
): SoilTextureSet {
  const cached = soilTextureCache.get(substrate);
  if (cached) return cached;

  const size = 128;
  const spec = SUBSTRATE_SPECS[substrate];
  const darkCol = hexRgb(spec.dark);
  const lightCol = hexRgb(spec.light);
  const heights = new Float32Array(size * size);
  const albedoBytes = new Uint8Array(size * size * 4);
  const roughBytes = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const pixHash = hash2d(x, y, 911);
      let rgb: [number, number, number] = [darkCol[0], darkCol[1], darkCol[2]];
      let h = 0.5;
      let rough = 0.9;

      if (substrate === 'garden-loam') {
        const clod = cellularTile(u, v, 11, 11, 1.0, 101);
        const crumb = cellularTile(u, v, 24, 24, 1.0, 131);
        const humus = fbmTile(u, v, 6, 157);
        const clodDome = THREE.MathUtils.smoothstep(clod.edge, 0.02, 0.28);
        const crumbDome = THREE.MathUtils.smoothstep(crumb.edge, 0.02, 0.24);
        const pocket = THREE.MathUtils.smoothstep(humus, 0.18, 0.58);
        h = clodDome * 0.52 + crumbDome * 0.28 + humus * 0.20;
        rgb = lerpRgb(darkCol, lightCol, pocket * 0.58 + clodDome * 0.26 + clod.idHash * 0.16);
        if (pixHash > 0.992) rgb = lerpRgb(rgb, [0.56, 0.47, 0.35], 0.45);
        rough = THREE.MathUtils.lerp(0.96, 0.84, clodDome * 0.7);
      } else if (substrate === 'bark-mulch') {
        const chip = cellularTile(u, v, 9, 14, 2.35, 211);
        const crevice = THREE.MathUtils.smoothstep(chip.edge, 0.015, 0.19);
        const fibCoord = (u * Math.cos(chip.orient) + v * Math.sin(chip.orient)) * 38;
        const fiber = 0.5 + 0.5 * Math.sin(fibCoord * Math.PI * 2 + chip.idHash * 6.28);
        const micro = valueNoiseTile(u, v, 26, 26, 239);
        h = crevice * (0.68 + fiber * 0.18 + chip.idHash * 0.14) + micro * 0.06;
        rgb = lerpRgb(darkCol, lightCol, crevice * (0.45 + chip.idHash * 0.42 + fiber * 0.16));
        const shadowMul = THREE.MathUtils.lerp(0.58, 1.0, crevice);
        rgb = [rgb[0] * shadowMul, rgb[1] * shadowMul, rgb[2] * shadowMul];
        rough = THREE.MathUtils.lerp(0.95, 0.78, crevice * (0.5 + fiber * 0.5));
      } else if (substrate === 'tilled-veg-earth') {
        const wobble = (valueNoiseTile(u, v, 8, 4, 307) - 0.5) * 0.035;
        const furrowWave = 0.5 + 0.5 * Math.sin((v + wobble) * Math.PI * 2 * 5);
        const rakeFine = 0.5 + 0.5 * Math.sin((v + wobble * 0.6) * Math.PI * 2 * 15);
        const crumb = cellularTile(u, v, 22, 22, 1.0, 331);
        const crumbRelief = THREE.MathUtils.smoothstep(crumb.edge, 0.02, 0.25);
        const tilthNoise = fbmTile(u, v, 8, 353);
        h = furrowWave * 0.46 + rakeFine * 0.12 + crumbRelief * 0.26 + tilthNoise * 0.16;
        rgb = lerpRgb(darkCol, lightCol, furrowWave * 0.5 + crumbRelief * 0.25 + tilthNoise * 0.25);
        rough = THREE.MathUtils.lerp(0.96, 0.85, furrowWave);
      } else if (substrate === 'potting-compost') {
        const coir = fbmTile(u, v, 14, 409);
        const fineCrumb = cellularTile(u, v, 28, 28, 1.3, 433);
        const crumbTop = THREE.MathUtils.smoothstep(fineCrumb.edge, 0.02, 0.24);
        h = coir * 0.55 + crumbTop * 0.45;
        rgb = lerpRgb(darkCol, lightCol, coir * 0.62 + fineCrumb.idHash * 0.38);
        if (pixHash > 0.995) {
          rgb = lerpRgb(rgb, [0.68, 0.64, 0.58], 0.58);
          h = Math.min(1, h + 0.14);
        }
        rough = THREE.MathUtils.lerp(0.97, 0.88, crumbTop);
      } else if (substrate === 'gravel-mulch') {
        const pebble = cellularTile(u, v, 16, 16, 1.15, 503);
        const grit = cellularTile(u, v, 32, 32, 1.0, 541);
        const stoneDome = THREE.MathUtils.smoothstep(pebble.edge, 0.015, 0.24);
        const facet = THREE.MathUtils.clamp(1 - pebble.f1 * 1.15, 0, 1);
        const micro = valueNoiseTile(u, v, 32, 32, 577);
        h = stoneDome * (0.62 + facet * 0.26) + grit.edge * 0.12;
        rgb = lerpRgb(
          darkCol,
          lightCol,
          pebble.idHash * 0.68 + stoneDome * 0.22 + (micro - 0.5) * 0.18
        );
        const gapAo = THREE.MathUtils.lerp(0.62, 1.0, stoneDome);
        rgb = [rgb[0] * gapAo, rgb[1] * gapAo, rgb[2] * gapAo];
        rough = THREE.MathUtils.lerp(0.92, 0.64, stoneDome * (0.55 + pebble.idHash * 0.45));
      } else {
        const coarseSand = fbmTile(u, v, 12, 613);
        const gritCell = cellularTile(u, v, 28, 28, 1.1, 647);
        const fineGrain = valueNoiseTile(u, v, 44, 44, 673);
        const grainFacet = THREE.MathUtils.smoothstep(gritCell.edge, 0.02, 0.22);
        h = coarseSand * 0.44 + grainFacet * 0.34 + fineGrain * 0.22;
        rgb = lerpRgb(darkCol, lightCol, coarseSand * 0.48 + gritCell.idHash * 0.34 + fineGrain * 0.18);
        rough = THREE.MathUtils.lerp(0.93, 0.78, grainFacet);
      }

      heights[y * size + x] = h;
      const idx = (y * size + x) * 4;
      albedoBytes[idx] = Math.round(THREE.MathUtils.clamp(rgb[0] * 255, 0, 255));
      albedoBytes[idx + 1] = Math.round(THREE.MathUtils.clamp(rgb[1] * 255, 0, 255));
      albedoBytes[idx + 2] = Math.round(THREE.MathUtils.clamp(rgb[2] * 255, 0, 255));
      albedoBytes[idx + 3] = 255;

      const rByte = Math.round(THREE.MathUtils.clamp(rough * 255, 0, 255));
      roughBytes[idx] = rByte;
      roughBytes[idx + 1] = rByte;
      roughBytes[idx + 2] = rByte;
      roughBytes[idx + 3] = 255;
    }
  }

  const set: SoilTextureSet = {
    substrate,
    albedoMap: createTiledDataTexture(albedoBytes, size, THREE.SRGBColorSpace),
    normalMap: buildNormalMapFromHeights(heights, size, spec.normalStrength),
    roughnessMap: createTiledDataTexture(roughBytes, size, THREE.NoColorSpace),
    tileMetres: spec.tileMetres,
  };
  soilTextureCache.set(substrate, set);
  return set;
}
