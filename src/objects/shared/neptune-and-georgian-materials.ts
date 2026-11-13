import * as THREE from 'three';
import { getOrCreateCachedTexture } from '../../engine/textures/texture-registry.ts';
import {
  sharedBoxGeometry,
  sharedCylinderGeometry,
  sharedSphereGeometry,
  sharedTorusGeometry,
} from './geometry-cache.ts';
import { prepGeo, tagHighLod } from './scene-helpers.ts';

export interface PbrDataMapBundle {
  readonly colorMap: THREE.DataTexture;
  readonly normalMap: THREE.DataTexture;
  readonly roughnessMap: THREE.DataTexture;
}

function clampByte(v: number): number {
  return v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
}

function hash2DPeriodic(
  ix: number,
  iy: number,
  periodX: number,
  periodY: number,
  seed: number
): number {
  const wx = ((ix % periodX) + periodX) % periodX;
  const wy = ((iy % periodY) + periodY) % periodY;
  let h = (wx * 374761393 + wy * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

export function seamlessValueNoise2D(
  u: number,
  v: number,
  freqX: number,
  freqY: number,
  seed: number
): number {
  const uf = u - Math.floor(u);
  const vf = v - Math.floor(v);
  const x = uf * freqX;
  const y = vf * freqY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = THREE.MathUtils.smoothstep(x - x0, 0, 1);
  const fy = THREE.MathUtils.smoothstep(y - y0, 0, 1);

  const n00 = hash2DPeriodic(x0, y0, freqX, freqY, seed);
  const n10 = hash2DPeriodic(x0 + 1, y0, freqX, freqY, seed);
  const n01 = hash2DPeriodic(x0, y0 + 1, freqX, freqY, seed);
  const n11 = hash2DPeriodic(x0 + 1, y0 + 1, freqX, freqY, seed);

  const nx0 = n00 + (n10 - n00) * fx;
  const nx1 = n01 + (n11 - n01) * fx;
  return nx0 + (nx1 - nx0) * fy;
}

export function seamlessFbm2D(
  u: number,
  v: number,
  baseFreq: number,
  octaves: number,
  seed: number
): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let freq = baseFreq;
  for (let o = 0; o < octaves; o++) {
    sum += amp * seamlessValueNoise2D(u, v, freq, freq, seed + o * 101);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return norm > 0 ? sum / norm : 0.5;
}

export function makeRgbaDataTexture(
  data: Uint8Array<ArrayBuffer>,
  width: number,
  height: number,
  name: string,
  srgb: boolean,
  repeatX = 1,
  repeatY = 1
): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.name = name;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

export function deriveNormalAndRoughnessFromHeight(
  heightField: Float32Array,
  roughField: Float32Array,
  width: number,
  height: number,
  normalStrength: number,
  namePrefix: string,
  repeatX = 1,
  repeatY = 1
): { readonly normalMap: THREE.DataTexture; readonly roughnessMap: THREE.DataTexture } {
  const normData = new Uint8Array(width * height * 4);
  const roughData = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    const ym = (y - 1 + height) % height;
    const yp = (y + 1) % height;
    for (let x = 0; x < width; x++) {
      const xm = (x - 1 + width) % width;
      const xp = (x + 1) % width;
      const idx = y * width + x;
      const dhdx = (heightField[y * width + xp]! - heightField[y * width + xm]!) * normalStrength;
      const dhdy = (heightField[yp * width + x]! - heightField[ym * width + x]!) * normalStrength;
      let nx = -dhdx;
      let ny = -dhdy;
      let nz = 1;
      const invLen = 1 / Math.hypot(nx, ny, nz);
      nx *= invLen;
      ny *= invLen;
      nz *= invLen;

      const o = idx * 4;
      normData[o] = clampByte((nx * 0.5 + 0.5) * 255);
      normData[o + 1] = clampByte((ny * 0.5 + 0.5) * 255);
      normData[o + 2] = clampByte((nz * 0.5 + 0.5) * 255);
      normData[o + 3] = 255;

      const rv = clampByte(roughField[idx]! * 255);
      roughData[o] = rv;
      roughData[o + 1] = rv;
      roughData[o + 2] = rv;
      roughData[o + 3] = 255;
    }
  }

  return {
    normalMap: makeRgbaDataTexture(
      normData,
      width,
      height,
      `${namePrefix}.normal`,
      false,
      repeatX,
      repeatY
    ),
    roughnessMap: makeRgbaDataTexture(
      roughData,
      width,
      height,
      `${namePrefix}.roughness`,
      false,
      repeatX,
      repeatY
    ),
  };
}

export function getHonedCarraraMarbleMaps(): PbrDataMapBundle {
  return getOrCreateCachedTexture('catalog:honed-carrara-pbr:v1', () => {
    const size = 128;
    const color = new Uint8Array(size * size * 4);
    const height = new Float32Array(size * size);
    const rough = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const warp = seamlessFbm2D(u, v, 3, 3, 411) * 0.35;
        const veinA = Math.abs(
          Math.sin((u * 2 + v * 1 + warp) * Math.PI * 2) * 0.65 +
            (seamlessFbm2D(u + 0.2, v, 6, 3, 733) - 0.5) * 0.7
        );
        const veinB = Math.abs(
          Math.sin((u * -1 + v * 3 - warp * 0.8) * Math.PI * 2) * 0.7 +
            (seamlessFbm2D(u, v + 0.35, 8, 2, 919) - 0.5) * 0.65
        );
        const vPrimary = Math.max(0, 1 - veinA * 7.5);
        const vSecondary = Math.max(0, 1 - veinB * 11.5) * 0.55;
        const cloud = (seamlessFbm2D(u, v, 4, 3, 181) - 0.5) * 10;
        const veinAmt = Math.min(1, vPrimary * 0.72 + vSecondary);

        const r = 236 + cloud - veinAmt * 48;
        const g = 234 + cloud - veinAmt * 47;
        const b = 228 + cloud - veinAmt * 43;
        const idx = y * size + x;
        const o = idx * 4;
        color[o] = clampByte(r);
        color[o + 1] = clampByte(g);
        color[o + 2] = clampByte(b);
        color[o + 3] = 255;
        height[idx] = 0.52 - veinAmt * 0.06 + cloud * 0.002;
        rough[idx] = 0.29 + veinAmt * 0.07;
      }
    }

    const derived = deriveNormalAndRoughnessFromHeight(
      height,
      rough,
      size,
      size,
      1.8,
      'catalog.honedCarrara'
    );
    return {
      colorMap: makeRgbaDataTexture(color, size, size, 'catalog.honedCarrara.color', true),
      normalMap: derived.normalMap,
      roughnessMap: derived.roughnessMap,
    };
  });
}

export function getNeroMarquinaMarbleMaps(): PbrDataMapBundle {
  return getOrCreateCachedTexture('catalog:nero-marquina-pbr:v1', () => {
    const size = 128;
    const color = new Uint8Array(size * size * 4);
    const height = new Float32Array(size * size);
    const rough = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const warp = seamlessFbm2D(u, v, 4, 3, 1217) * 0.28;
        const ridge = Math.abs(
          Math.sin((u * 2 + v * 2 + warp) * Math.PI * 2) +
            (seamlessFbm2D(u + 0.13, v + 0.29, 8, 3, 1553) - 0.5) * 0.85
        );
        const calcite = Math.pow(Math.max(0, 1 - ridge * 9.5), 1.6);
        const fine = Math.pow(
          Math.max(
            0,
            1 -
              Math.abs(
                Math.cos((u * 3 - v * 2 - warp) * Math.PI * 2) +
                  (seamlessValueNoise2D(u, v, 12, 12, 1801) - 0.5) * 0.8
              ) *
                14
          ),
          1.8
        );
        const vein = Math.min(1, calcite * 0.88 + fine * 0.52);
        const tone = (seamlessFbm2D(u, v, 5, 2, 2003) - 0.5) * 8;

        const r = 30 + tone + vein * 195;
        const g = 31 + tone + vein * 192;
        const b = 33 + tone + vein * 186;
        const idx = y * size + x;
        const o = idx * 4;
        color[o] = clampByte(r);
        color[o + 1] = clampByte(g);
        color[o + 2] = clampByte(b);
        color[o + 3] = 255;
        height[idx] = 0.5 + vein * 0.05;
        rough[idx] = 0.24 + vein * 0.08;
      }
    }

    const derived = deriveNormalAndRoughnessFromHeight(
      height,
      rough,
      size,
      size,
      1.7,
      'catalog.neroMarquina'
    );
    return {
      colorMap: makeRgbaDataTexture(color, size, size, 'catalog.neroMarquina.color', true),
      normalMap: derived.normalMap,
      roughnessMap: derived.roughnessMap,
    };
  });
}

export function getBathStoneMaps(): PbrDataMapBundle {
  return getOrCreateCachedTexture('catalog:bath-stone-pbr:v1', () => {
    const size = 128;
    const color = new Uint8Array(size * size * 4);
    const height = new Float32Array(size * size);
    const rough = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const oolite = seamlessValueNoise2D(u, v, 32, 32, 3119);
        const bed = seamlessFbm2D(u, v * 2, 6, 3, 3301);
        const delta = (bed - 0.5) * 18 + (oolite - 0.5) * 11;
        const idx = y * size + x;
        const o = idx * 4;
        color[o] = clampByte(221 + delta);
        color[o + 1] = clampByte(208 + delta * 0.92);
        color[o + 2] = clampByte(184 + delta * 0.82);
        color[o + 3] = 255;
        height[idx] = 0.5 + (oolite - 0.5) * 0.14 + (bed - 0.5) * 0.1;
        rough[idx] = 0.76 + (oolite - 0.5) * 0.1;
      }
    }

    const derived = deriveNormalAndRoughnessFromHeight(
      height,
      rough,
      size,
      size,
      2.6,
      'catalog.bathStone'
    );
    return {
      colorMap: makeRgbaDataTexture(color, size, size, 'catalog.bathStone.color', true),
      normalMap: derived.normalMap,
      roughnessMap: derived.roughnessMap,
    };
  });
}

export function getZelligeTileMaps(): PbrDataMapBundle {
  return getOrCreateCachedTexture('catalog:moroccan-zellige-pbr:v1', () => {
    const size = 128;
    const cells = 4;
    const color = new Uint8Array(size * size * 4);
    const height = new Float32Array(size * size);
    const rough = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      const v = y / size;
      const cy = Math.floor(v * cells);
      const fv = v * cells - cy;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const cx = Math.floor(u * cells);
        const fu = u * cells - cx;

        const edgeDist = Math.min(fu, 1 - fu, fv, 1 - fv);
        const isGrout = edgeDist < 0.032;
        const tileSeed = hash2DPeriodic(cx, cy, cells, cells, 4409);
        const undulate =
          Math.sin(fu * Math.PI) *
          Math.sin(fv * Math.PI) *
          (0.08 + 0.05 * seamlessValueNoise2D(u, v, 16, 16, 4517));
        const glazeDelta = (tileSeed - 0.5) * 14 + (seamlessFbm2D(u, v, 10, 2, 4639) - 0.5) * 8;

        const idx = y * size + x;
        const o = idx * 4;
        if (isGrout) {
          color[o] = 208;
          color[o + 1] = 202;
          color[o + 2] = 192;
          color[o + 3] = 255;
          height[idx] = 0.25;
          rough[idx] = 0.78;
        } else {
          color[o] = clampByte(236 + glazeDelta);
          color[o + 1] = clampByte(232 + glazeDelta * 0.96);
          color[o + 2] = clampByte(223 + glazeDelta * 0.9);
          color[o + 3] = 255;
          height[idx] = 0.5 + undulate;
          rough[idx] = 0.14 + (tileSeed - 0.5) * 0.06;
        }
      }
    }

    const derived = deriveNormalAndRoughnessFromHeight(
      height,
      rough,
      size,
      size,
      3.4,
      'catalog.zellige'
    );
    return {
      colorMap: makeRgbaDataTexture(color, size, size, 'catalog.zellige.color', true, 2.5, 2),
      normalMap: derived.normalMap,
      roughnessMap: derived.roughnessMap,
    };
  });
}

export function getTimberGrainMaps(
  key: string,
  baseHex: number,
  grainContrast: number,
  roughBase: number,
  isEndGrain = false
): PbrDataMapBundle {
  return getOrCreateCachedTexture(`catalog:timber:${key}:v2`, () => {
    const size = 512;
    const base = new THREE.Color(baseHex);
    const br = base.r * 255;
    const bg = base.g * 255;
    const bb = base.b * 255;
    const color = new Uint8Array(size * size * 4);
    const height = new Float32Array(size * size);
    const rough = new Float32Array(size * size);

    // Precompute compact seamless 2D noise tables so 512x512 multi-octave anisotropic FBM builds in ~20 ms
    const sampleGrid = (g: Float32Array, gw: number, gh: number, u: number, v: number): number => {
      const uf = u - Math.floor(u);
      const vf = v - Math.floor(v);
      const x = uf * gw;
      const y = vf * gh;
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const x1 = (x0 + 1) % gw;
      const y1 = (y0 + 1) % gh;
      const fx = THREE.MathUtils.smoothstep(x - x0, 0, 1);
      const fy = THREE.MathUtils.smoothstep(y - y0, 0, 1);
      const n00 = g[y0 * gw + x0]!;
      const n10 = g[y0 * gw + x1]!;
      const n01 = g[y1 * gw + x0]!;
      const n11 = g[y1 * gw + x1]!;
      return (n00 + (n10 - n00) * fx) * (1 - fy) + (n01 + (n11 - n01) * fx) * fy;
    };
    const buildGrid = (gw: number, gh: number, seed: number): Float32Array => {
      const out = new Float32Array(gw * gh);
      for (let iy = 0; iy < gh; iy++) {
        for (let ix = 0; ix < gw; ix++) {
          out[iy * gw + ix] = hash2DPeriodic(ix, iy, gw, gh, seed);
        }
      }
      return out;
    };

    const gWarp1 = buildGrid(8, 16, 5303);
    const gWarp2 = buildGrid(16, 32, 5347);
    const gFine = buildGrid(24, 96, 5381);
    const gPore = buildGrid(48, 256, 5417);
    const gRay = buildGrid(64, 24, 5449);

    const nStaves = 12;
    for (let y = 0; y < size; y++) {
      const v = y / size;
      const staveF = v * nStaves;
      const staveIdx = Math.floor(staveF);
      const fv = staveF - staveIdx;
      const staveTone = (hash2DPeriodic(staveIdx, 0, nStaves, 1, 5209) - 0.5) * (grainContrast * 0.42);
      const stavePhase = hash2DPeriodic(staveIdx, 1, nStaves, 2, 5227) * 6.0;
      const isQuarterSawn = hash2DPeriodic(staveIdx, 2, nStaves, 3, 5233) > 0.45;
      const seamDist = Math.min(fv, 1 - fv);
      const seamFactor = seamDist < 0.018 ? 1 - seamDist / 0.018 : 0;

      for (let x = 0; x < size; x++) {
        const u = x / size;
        const idx = y * size + x;
        const o = idx * 4;
        if (isEndGrain) {
          const gx = Math.floor(u * 8);
          const gy = Math.floor(v * 8);
          const lu = u * 8 - gx - 0.5 + (sampleGrid(gWarp1, 8, 16, u, v) - 0.5) * 0.18;
          const lv = v * 8 - gy - 0.5 + (sampleGrid(gWarp2, 16, 32, u, v) - 0.5) * 0.18;
          const blockTone = (hash2DPeriodic(gx, gy, 8, 8, 5101) - 0.5) * 24;
          const rad = Math.hypot(lu, lv) * 7.5;
          const ringRaw = rad - Math.floor(rad);
          const ring = Math.pow(ringRaw, 2.2) - 0.35;
          const ray = Math.max(0, Math.sin(Math.atan2(lv, lu) * 18) - 0.72) * 14;
          const joint = Math.min(u * 8 - gx, 1 - (u * 8 - gx), v * 8 - gy, 1 - (v * 8 - gy)) < 0.022;
          const d = joint ? -18 : blockTone + ring * (grainContrast * 0.55) + ray;
          color[o] = clampByte(br + d);
          color[o + 1] = clampByte(bg + d * 0.86);
          color[o + 2] = clampByte(bb + d * 0.72);
          color[o + 3] = 255;
          height[idx] = joint ? 0.36 : 0.52 + ring * 0.05;
          rough[idx] = Math.max(0.12, Math.min(0.92, roughBase + (joint ? 0.1 : -ring * 0.04)));
        } else {
          // Anisotropic FBM grain running ALONG u (stave length), staves stacked across v
          const warp =
            (sampleGrid(gWarp1, 8, 16, u, v + stavePhase * 0.1) - 0.5) * 0.85 +
            (sampleGrid(gWarp2, 16, 32, u, v + stavePhase * 0.17) - 0.5) * 0.35 +
            (sampleGrid(gFine, 24, 96, u, v) - 0.5) * 0.14;
          const centeredV = (fv - 0.5) * (isQuarterSawn ? 2.4 : 1.55);
          const arch = Math.hypot(centeredV, warp * 0.72) * (isQuarterSawn ? 3.2 : 2.35) + stavePhase;
          const ringFrac = arch - Math.floor(arch);
          // Asymmetric latewood/earlywood oak growth-ring profile (crisp latewood band, gentle earlywood)
          const latewood = Math.exp(-Math.pow((ringFrac - 0.78) * 5.2, 2));
          const fiber = sampleGrid(gFine, 24, 96, u * 2, v) - 0.5;
          const poreVal = sampleGrid(gPore, 48, 256, u * 2, v);
          const openPore = poreVal < 0.24 ? (0.24 - poreVal) / 0.24 : 0;
          const rayNoise = sampleGrid(gRay, 64, 24, u * 2, v * 2);
          const medRay = isQuarterSawn && rayNoise > 0.76 ? (rayNoise - 0.76) / 0.24 : 0;

          const d =
            staveTone -
            latewood * (grainContrast * 0.52) +
            fiber * (grainContrast * 0.24) -
            openPore * (grainContrast * 0.38) +
            medRay * (grainContrast * 0.34) -
            seamFactor * (grainContrast * 0.28);

          color[o] = clampByte(br + d);
          color[o + 1] = clampByte(bg + d * 0.86);
          color[o + 2] = clampByte(bb + d * 0.71);
          color[o + 3] = 255;
          height[idx] =
            0.54 - openPore * 0.14 - latewood * 0.03 + fiber * 0.025 + medRay * 0.015 - seamFactor * 0.08;
          rough[idx] = Math.max(
            0.12,
            Math.min(
              0.92,
              roughBase + openPore * 0.09 + latewood * 0.02 - medRay * 0.05 + seamFactor * 0.06
            )
          );
        }
      }
    }

    const derived = deriveNormalAndRoughnessFromHeight(
      height,
      rough,
      size,
      size,
      1.65,
      `catalog.timber.${key}`
    );
    return {
      colorMap: makeRgbaDataTexture(color, size, size, `catalog.timber.${key}.color`, true),
      normalMap: derived.normalMap,
      roughnessMap: derived.roughnessMap,
    };
  });
}

export function getWovenFabricMaps(
  key: string,
  baseHex: number,
  mode: 'linen' | 'ticking' | 'cashmere' | 'matelasse' | 'kubu' | 'leather' | 'hydrocotton'
): PbrDataMapBundle {
  return getOrCreateCachedTexture(`catalog:fabric:${key}:${mode}:v1`, () => {
    const size = 128;
    const base = new THREE.Color(baseHex);
    const br = base.r * 255;
    const bg = base.g * 255;
    const bb = base.b * 255;
    const color = new Uint8Array(size * size * 4);
    const height = new Float32Array(size * size);
    const rough = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const idx = y * size + x;
        const o = idx * 4;

        let d = 0;
        let h = 0.5;
        let rVal = 0.84;

        if (mode === 'kubu') {
          const row = Math.floor(v * 16);
          const shift = (row % 2) * 0.5;
          const strand = Math.sin(((u * 8 + shift) % 1) * Math.PI);
          const reed = Math.sin((v * 16 - row) * Math.PI);
          const weave = strand * reed;
          const n = seamlessValueNoise2D(u, v, 24, 24, 6007) - 0.5;
          d = (weave - 0.45) * 44 + n * 16;
          h = 0.35 + weave * 0.35;
          rVal = 0.8 + (1 - weave) * 0.12;
        } else if (mode === 'matelasse') {
          const du = Math.abs(((u * 8 + v * 8) % 1) - 0.5) * 2;
          const dv = Math.abs(((u * 8 - v * 8 + 8) % 1) - 0.5) * 2;
          const quilt = Math.min(du, dv);
          d = (quilt - 0.4) * 14;
          h = 0.42 + quilt * 0.22;
          rVal = 0.86;
        } else if (mode === 'ticking') {
          const stripePhase = (u * 12) % 1;
          const isStripe = stripePhase < 0.22 || (stripePhase > 0.3 && stripePhase < 0.36);
          const slub = (seamlessValueNoise2D(u, v, 32, 32, 6113) - 0.5) * 10;
          d = slub - (isStripe ? 58 : 0);
          h = 0.5 + slub * 0.005;
          rVal = 0.84;
        } else if (mode === 'leather') {
          const pebble = seamlessFbm2D(u, v, 16, 3, 6221);
          d = (pebble - 0.5) * 20;
          h = 0.46 + pebble * 0.1;
          rVal = 0.42 + (1 - pebble) * 0.12;
        } else if (mode === 'hydrocotton') {
          const rib = Math.sin(u * Math.PI * 32) * 0.5 + 0.5;
          const loop = seamlessValueNoise2D(u, v, 48, 48, 6311) - 0.5;
          d = (rib - 0.5) * 10 + loop * 8;
          h = 0.45 + rib * 0.12 + loop * 0.05;
          rVal = 0.88;
        } else {
          const warp = Math.sin(u * Math.PI * 64) * 0.5;
          const weft = Math.sin(v * Math.PI * 64) * 0.5;
          const slub = (seamlessFbm2D(u, v, 12, 2, 6421) - 0.5) * 14;
          d = (warp + weft) * 4 + slub;
          h = 0.5 + (warp + weft) * 0.04;
          rVal = mode === 'cashmere' ? 0.9 : 0.85;
        }

        color[o] = clampByte(br + d);
        color[o + 1] = clampByte(bg + d * 0.96);
        color[o + 2] = clampByte(bb + d * 0.92);
        color[o + 3] = 255;
        height[idx] = h;
        rough[idx] = rVal;
      }
    }

    const derived = deriveNormalAndRoughnessFromHeight(
      height,
      rough,
      size,
      size,
      mode === 'kubu' ? 3.8 : mode === 'matelasse' ? 2.6 : 1.6,
      `catalog.fabric.${key}`
    );
    return {
      colorMap: makeRgbaDataTexture(color, size, size, `catalog.fabric.${key}.color`, true),
      normalMap: derived.normalMap,
      roughnessMap: derived.roughnessMap,
    };
  });
}

const paintedMatCache = new Map<string, THREE.MeshStandardMaterial>();

export function getPaintedJoineryMaterial(
  color: THREE.ColorRepresentation,
  roughness = 0.52,
  name = 'catalog.paintedJoinery'
): THREE.MeshStandardMaterial {
  const c = new THREE.Color(color);
  const key = `${name}:${c.getHexString()}:${roughness.toFixed(3)}`;
  let mat = paintedMatCache.get(key);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      name,
      color: c,
      roughness,
      metalness: 0.02,
    });
    paintedMatCache.set(key, mat);
  }
  return mat;
}

let cachedAgedBrassMat: THREE.MeshStandardMaterial | null = null;
let cachedDarkBrassMat: THREE.MeshStandardMaterial | null = null;
let cachedGiltGoldMat: THREE.MeshStandardMaterial | null = null;
let cachedCopperMat: THREE.MeshStandardMaterial | null = null;
let cachedStainlessMat: THREE.MeshStandardMaterial | null = null;
let cachedCastIronMat: THREE.MeshStandardMaterial | null = null;
let cachedClearGlassMat: THREE.MeshPhysicalMaterial | null = null;
let cachedFlutedGlassMat: THREE.MeshPhysicalMaterial | null = null;
let cachedMirrorPlateMat: THREE.MeshPhysicalMaterial | null = null;
let cachedHonedCarraraMat: THREE.MeshStandardMaterial | null = null;
let cachedNeroMarquinaMat: THREE.MeshStandardMaterial | null = null;
let cachedNaturalOakMat: THREE.MeshStandardMaterial | null = null;
let cachedEndGrainOakMat: THREE.MeshStandardMaterial | null = null;
let cachedFireclayMat: THREE.MeshPhysicalMaterial | null = null;
let cachedLimePlasterMat: THREE.MeshStandardMaterial | null = null;
let cachedWarm2700kEmissiveMat: THREE.MeshStandardMaterial | null = null;
let cachedCandle2200kEmissiveMat: THREE.MeshStandardMaterial | null = null;

export function getAgedBrassMaterial(): THREE.MeshStandardMaterial {
  if (!cachedAgedBrassMat) {
    cachedAgedBrassMat = new THREE.MeshStandardMaterial({
      name: 'catalog.agedBrass',
      color: 0xb59150,
      roughness: 0.32,
      metalness: 0.86,
    });
  }
  return cachedAgedBrassMat;
}

export function getDarkAntiquedBrassMaterial(): THREE.MeshStandardMaterial {
  if (!cachedDarkBrassMat) {
    cachedDarkBrassMat = new THREE.MeshStandardMaterial({
      name: 'catalog.darkAntiquedBrass',
      color: 0x7c5f30,
      roughness: 0.42,
      metalness: 0.82,
    });
  }
  return cachedDarkBrassMat;
}

export function getRegencyGiltwoodMaterial(): THREE.MeshStandardMaterial {
  if (!cachedGiltGoldMat) {
    cachedGiltGoldMat = new THREE.MeshStandardMaterial({
      name: 'catalog.regencyWaterGilt',
      color: 0xc8a04b,
      roughness: 0.28,
      metalness: 0.78,
    });
  }
  return cachedGiltGoldMat;
}

export function getBurnishedCopperCatalogMaterial(): THREE.MeshStandardMaterial {
  if (!cachedCopperMat) {
    cachedCopperMat = new THREE.MeshStandardMaterial({
      name: 'catalog.burnishedCopper',
      color: 0xc57449,
      roughness: 0.26,
      metalness: 0.88,
    });
  }
  return cachedCopperMat;
}

export function getBrushedStainlessCatalogMaterial(): THREE.MeshStandardMaterial {
  if (!cachedStainlessMat) {
    cachedStainlessMat = new THREE.MeshStandardMaterial({
      name: 'catalog.brushedStainless',
      color: 0xcfd3d6,
      roughness: 0.26,
      metalness: 0.88,
    });
  }
  return cachedStainlessMat;
}

export function getMatteCastIronMaterial(colorHex = 0x26282b): THREE.MeshStandardMaterial {
  if (colorHex === 0x26282b && cachedCastIronMat) {
    return cachedCastIronMat;
  }
  const mat = new THREE.MeshStandardMaterial({
    name: 'catalog.matteCastIron',
    color: colorHex,
    roughness: 0.66,
    metalness: 0.46,
  });
  if (colorHex === 0x26282b) {
    cachedCastIronMat = mat;
  }
  return mat;
}

export function getClearArchitecturalGlassMaterial(): THREE.MeshPhysicalMaterial {
  if (!cachedClearGlassMat) {
    cachedClearGlassMat = new THREE.MeshPhysicalMaterial({
      name: 'catalog.clearGlass',
      color: 0xeaf4f8,
      transparent: true,
      opacity: 0.28,
      roughness: 0.05,
      metalness: 0.04,
      ior: 1.52,
      clearcoat: 0.5,
      depthWrite: false,
    });
  }
  return cachedClearGlassMat;
}

export function getPrismaticFlutedGlassMaterial(): THREE.MeshPhysicalMaterial {
  if (!cachedFlutedGlassMat) {
    const maps = getWovenFabricMaps('fluted-glass', 0xeef5f7, 'hydrocotton');
    cachedFlutedGlassMat = new THREE.MeshPhysicalMaterial({
      name: 'catalog.flutedGlass',
      color: 0xeef6f9,
      normalMap: maps.normalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      transparent: true,
      opacity: 0.44,
      roughness: 0.14,
      metalness: 0.04,
      ior: 1.52,
      clearcoat: 0.65,
      depthWrite: false,
    });
  }
  return cachedFlutedGlassMat;
}

export function getSilveredMirrorPlateMaterial(): THREE.MeshPhysicalMaterial {
  if (!cachedMirrorPlateMat) {
    cachedMirrorPlateMat = new THREE.MeshPhysicalMaterial({
      name: 'catalog.silveredMirrorPlate',
      color: 0xe8edf0,
      roughness: 0.03,
      metalness: 0.96,
      clearcoat: 0.6,
      clearcoatRoughness: 0.03,
    });
  }
  return cachedMirrorPlateMat;
}

export function getHonedCarraraCatalogMaterial(): THREE.MeshStandardMaterial {
  if (!cachedHonedCarraraMat) {
    const maps = getHonedCarraraMarbleMaps();
    cachedHonedCarraraMat = new THREE.MeshStandardMaterial({
      name: 'catalog.honedCarraraMarble',
      color: 0xffffff,
      map: maps.colorMap,
      normalMap: maps.normalMap,
      normalScale: new THREE.Vector2(0.25, 0.25),
      roughnessMap: maps.roughnessMap,
      roughness: 0.3,
      metalness: 0.02,
    });
  }
  return cachedHonedCarraraMat;
}

export function getNeroMarquinaCatalogMaterial(): THREE.MeshStandardMaterial {
  if (!cachedNeroMarquinaMat) {
    const maps = getNeroMarquinaMarbleMaps();
    cachedNeroMarquinaMat = new THREE.MeshStandardMaterial({
      name: 'catalog.neroMarquinaMarble',
      color: 0xffffff,
      map: maps.colorMap,
      normalMap: maps.normalMap,
      normalScale: new THREE.Vector2(0.25, 0.25),
      roughnessMap: maps.roughnessMap,
      roughness: 0.26,
      metalness: 0.03,
    });
  }
  return cachedNeroMarquinaMat;
}

export function getCharacterOakMaterial(): THREE.MeshStandardMaterial {
  if (!cachedNaturalOakMat) {
    const maps = getTimberGrainMaps('character-oak', 0xc29868, 22, 0.52, false);
    cachedNaturalOakMat = new THREE.MeshStandardMaterial({
      name: 'catalog.characterOak',
      color: 0xffffff,
      map: maps.colorMap,
      normalMap: maps.normalMap,
      normalScale: new THREE.Vector2(0.32, 0.32),
      roughnessMap: maps.roughnessMap,
      roughness: 0.52,
      metalness: 0.02,
    });
  }
  return cachedNaturalOakMat;
}

export function getEndGrainOakMaterial(): THREE.MeshStandardMaterial {
  if (!cachedEndGrainOakMat) {
    const maps = getTimberGrainMaps('end-grain-oak', 0xbe915e, 24, 0.46, true);
    cachedEndGrainOakMat = new THREE.MeshStandardMaterial({
      name: 'catalog.endGrainOak',
      color: 0xffffff,
      map: maps.colorMap,
      normalMap: maps.normalMap,
      normalScale: new THREE.Vector2(0.35, 0.35),
      roughnessMap: maps.roughnessMap,
      roughness: 0.46,
      metalness: 0.02,
    });
  }
  return cachedEndGrainOakMat;
}

export function getHeavyFireclayMaterial(): THREE.MeshPhysicalMaterial {
  if (!cachedFireclayMat) {
    cachedFireclayMat = new THREE.MeshPhysicalMaterial({
      name: 'catalog.shawsFireclay',
      color: 0xf6f5f0,
      roughness: 0.14,
      metalness: 0.01,
      clearcoat: 0.72,
      clearcoatRoughness: 0.08,
    });
  }
  return cachedFireclayMat;
}

export function getGeorgianLimePlasterMaterial(): THREE.MeshStandardMaterial {
  if (!cachedLimePlasterMat) {
    cachedLimePlasterMat = new THREE.MeshStandardMaterial({
      name: 'catalog.georgianLimePlaster',
      color: 0xf5f2ea,
      roughness: 0.78,
      metalness: 0.01,
    });
  }
  return cachedLimePlasterMat;
}

export function getWarm2700kLedMaterial(): THREE.MeshStandardMaterial {
  if (!cachedWarm2700kEmissiveMat) {
    cachedWarm2700kEmissiveMat = new THREE.MeshStandardMaterial({
      name: 'catalog.warm2700kLed',
      color: 0xfff1d6,
      emissive: new THREE.Color(0xffcf87),
      emissiveIntensity: 1.85,
      roughness: 0.2,
      metalness: 0,
    });
  }
  return cachedWarm2700kEmissiveMat;
}

export function getCandle2200kFilamentMaterial(): THREE.MeshStandardMaterial {
  if (!cachedCandle2200kEmissiveMat) {
    cachedCandle2200kEmissiveMat = new THREE.MeshStandardMaterial({
      name: 'catalog.candle2200kFilament',
      color: 0xffe4b5,
      emissive: new THREE.Color(0xffa947),
      emissiveIntensity: 2.35,
      roughness: 0.15,
      metalness: 0,
    });
  }
  return cachedCandle2200kEmissiveMat;
}

export function addNamedBox(
  parent: THREE.Object3D,
  name: string,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  mat: THREE.Material,
  highLod = false
): THREE.Mesh {
  const mesh = new THREE.Mesh(sharedBoxGeometry(w, h, d), mat);
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (highLod || Math.max(w, h, d) < 0.25) {
    tagHighLod(mesh);
  }
  parent.add(mesh);
  return mesh;
}

export function addNamedCyl(
  parent: THREE.Object3D,
  name: string,
  rTop: number,
  rBot: number,
  h: number,
  segs: number,
  x: number,
  y: number,
  z: number,
  mat: THREE.Material,
  highLod = false
): THREE.Mesh {
  const mesh = new THREE.Mesh(sharedCylinderGeometry(rTop, rBot, h, segs), mat);
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (highLod || Math.max(rTop * 2, rBot * 2, h) < 0.25) {
    tagHighLod(mesh);
  }
  parent.add(mesh);
  return mesh;
}

/**
 * Builds a Neptune Aged Brass *Mushroom* Ø32 mm knob projecting along `+Z` from `z = 0`.
 */
export function buildAgedBrassMushroomKnob(namePrefix: string): THREE.Group {
  const brass = getAgedBrassMaterial();
  const darkBrass = getDarkAntiquedBrassMaterial();
  const g = tagHighLod(new THREE.Group());
  g.name = namePrefix;

  const rose = new THREE.Mesh(sharedCylinderGeometry(0.013, 0.014, 0.004, 14), darkBrass);
  rose.name = `${namePrefix}.backplateRose`;
  rose.rotation.x = Math.PI * 0.5;
  rose.position.set(0, 0, 0.002);
  g.add(rose);

  const stem = new THREE.Mesh(sharedCylinderGeometry(0.0055, 0.007, 0.014, 12), brass);
  stem.name = `${namePrefix}.stem`;
  stem.rotation.x = Math.PI * 0.5;
  stem.position.set(0, 0, 0.011);
  g.add(stem);

  const cap = new THREE.Mesh(sharedSphereGeometry(0.016, 14, 10), brass);
  cap.name = `${namePrefix}.mushroomDome`;
  cap.scale.set(1, 1, 0.58);
  cap.position.set(0, 0, 0.023);
  g.add(cap);

  return g;
}

/**
 * Builds a Neptune Aged Brass *Barlow* `94 mm` cup pull projecting along `+Z` from `z = 0`.
 */
export function buildAgedBrassBarlowCupPull(namePrefix: string): THREE.Group {
  const brass = getAgedBrassMaterial();
  const darkBrass = getDarkAntiquedBrassMaterial();
  const g = tagHighLod(new THREE.Group());
  g.name = namePrefix;

  // Back flange (94 mm wide x 36 mm high x 3.5 mm proud)
  const flange = new THREE.Mesh(sharedBoxGeometry(0.094, 0.036, 0.0035), darkBrass);
  flange.name = `${namePrefix}.flange`;
  flange.position.set(0, 0, 0.00175);
  g.add(flange);

  // Hooded cup shell (76 mm wide, 22 mm projection)
  const hood = new THREE.Mesh(
    sharedCylinderGeometry(0.016, 0.016, 0.074, 14, 1, false, 0, Math.PI),
    brass
  );
  hood.name = `${namePrefix}.cupShell`;
  hood.rotation.z = Math.PI * 0.5;
  hood.position.set(0, -0.002, 0.0055);
  g.add(hood);

  for (const [tag, sx] of [
    ['leftScrew', -0.04],
    ['rightScrew', 0.04],
  ] as const) {
    const screw = new THREE.Mesh(sharedSphereGeometry(0.0025, 8, 6), brass);
    screw.name = `${namePrefix}.${tag}`;
    screw.position.set(sx, 0, 0.0042);
    g.add(screw);
  }

  return g;
}

/**
 * Builds a non-coplanar Shaker door/drawer panel centered at `(0, 0, 0)` of total size `(w, h, thickness)`
 * with outer stiles/rails (`thickness`) and a recessed center panel (`thickness - 0.008`) so no two faces share a plane!
 */
export function buildShakerDoorAssembly(
  namePrefix: string,
  w: number,
  h: number,
  thickness: number,
  mat: THREE.Material,
  stileW = 0.058
): THREE.Group {
  const g = new THREE.Group();
  g.name = namePrefix;

  const sw = Math.min(stileW, w * 0.26, h * 0.26);
  const innerW = Math.max(0.02, w - sw * 2);
  const innerH = Math.max(0.02, h - sw * 2);

  // Left and right full-height stiles
  addNamedBox(
    g,
    `${namePrefix}.stileLeft`,
    sw,
    h,
    thickness,
    -(w * 0.5 - sw * 0.5),
    0,
    0,
    mat
  );
  addNamedBox(
    g,
    `${namePrefix}.stileRight`,
    sw,
    h,
    thickness,
    w * 0.5 - sw * 0.5,
    0,
    0,
    mat
  );

  // Top and bottom rails strictly between stiles (zero overlap with stiles!)
  addNamedBox(
    g,
    `${namePrefix}.railTop`,
    innerW,
    sw,
    thickness,
    0,
    h * 0.5 - sw * 0.5,
    0,
    mat
  );
  addNamedBox(
    g,
    `${namePrefix}.railBottom`,
    innerW,
    sw,
    thickness,
    0,
    -(h * 0.5 - sw * 0.5),
    0,
    mat
  );

  // Recessed center field panel strictly inside rails/stiles and thinner by 8 mm (4 mm front & back step)
  const panelT = Math.max(0.008, thickness - 0.008);
  addNamedBox(
    g,
    `${namePrefix}.centerPanel`,
    innerW,
    innerH,
    panelT,
    0,
    0,
    0,
    mat
  );

  return g;
}

/**
 * Builds a cock-beaded rectangular aperture surround on the front face (`z = frontZ`):
 * `5.5 mm` half-round cock-bead proud of the `28 mm` face-frame around `[cx ± openW/2, cy ± openH/2]`.
 */
export function addCockBeadApertureTrim(
  parent: THREE.Object3D,
  namePrefix: string,
  cx: number,
  cy: number,
  frontZ: number,
  openW: number,
  openH: number,
  mat: THREE.Material
): void {
  const r = 0.00275; // 5.5 mm diameter half-round bead
  const bz = frontZ + r * 0.85;
  const topH = addNamedCyl(
    parent,
    `${namePrefix}.beadTop`,
    r,
    r,
    Math.max(0.01, openW - r * 2),
    8,
    cx,
    cy + openH * 0.5 - r,
    bz,
    mat,
    true
  );
  topH.rotation.z = Math.PI * 0.5;

  const botH = addNamedCyl(
    parent,
    `${namePrefix}.beadBottom`,
    r,
    r,
    Math.max(0.01, openW - r * 2),
    8,
    cx,
    cy - openH * 0.5 + r,
    bz,
    mat,
    true
  );
  botH.rotation.z = Math.PI * 0.5;

  addNamedCyl(
    parent,
    `${namePrefix}.beadLeft`,
    r,
    r,
    Math.max(0.01, openH - r * 4),
    8,
    cx - openW * 0.5 + r,
    cy,
    bz,
    mat,
    true
  );
  addNamedCyl(
    parent,
    `${namePrefix}.beadRight`,
    r,
    r,
    Math.max(0.01, openH - r * 4),
    8,
    cx + openW * 0.5 - r,
    cy,
    bz,
    mat,
    true
  );
}

/**
 * Ensures deterministic dot-hierarchical names, computed bounding spheres/boxes,
 * and automatic `tagHighLod` on fine hardware/detail meshes (`< 250 mm` max dimension).
 */
export function finalizeCatalogGroup<T extends THREE.Object3D>(
  root: T,
  namePrefix: string,
  position?: readonly [number, number, number],
  rotationY?: number
): T {
  if (!root.name) {
    root.name = namePrefix;
  }
  if (position) {
    root.position.set(position[0], position[1], position[2]);
  }
  if (rotationY !== undefined) {
    root.rotation.y = rotationY;
  }

  let autoIdx = 0;
  const box = new THREE.Box3();
  const size = new THREE.Vector3();

  root.traverse((node) => {
    if ((node instanceof THREE.Mesh || node instanceof THREE.Group) && !node.name) {
      autoIdx += 1;
      node.name = `${namePrefix}.part_${autoIdx}`;
    }
    if (node instanceof THREE.Mesh && node.geometry) {
      const geo = node.geometry as THREE.BufferGeometry;
      if (!geo.attributes['normal']) {
        geo.computeVertexNormals();
      }
      if (!geo.boundingBox) {
        geo.computeBoundingBox();
      }
      if (!geo.boundingSphere) {
        geo.computeBoundingSphere();
      }
      if (
        !node.userData.isArchitecturalShell &&
        !node.userData.isCutawayWall &&
        node.userData.lodTier === undefined &&
        geo.boundingBox
      ) {
        box.copy(geo.boundingBox);
        box.getSize(size);
        const maxDim = Math.max(
          size.x * Math.abs(node.scale.x),
          size.y * Math.abs(node.scale.y),
          size.z * Math.abs(node.scale.z)
        );
        if (maxDim > 0 && maxDim < 0.25) {
          tagHighLod(node);
        }
      }
    }
  });

  return root;
}

export {
  prepGeo,
  sharedBoxGeometry,
  sharedCylinderGeometry,
  sharedSphereGeometry,
  sharedTorusGeometry,
  tagHighLod,
};

let cachedVitreousPorcelainMat: THREE.MeshPhysicalMaterial | null = null;
export function getVitreousPorcelainLeverMaterial(): THREE.MeshPhysicalMaterial {
  if (!cachedVitreousPorcelainMat) {
    cachedVitreousPorcelainMat = new THREE.MeshPhysicalMaterial({
      name: 'catalog.vitreousPorcelain',
      color: 0xf8f6f0,
      roughness: 0.12,
      metalness: 0.01,
      clearcoat: 0.8,
      clearcoatRoughness: 0.06,
    });
  }
  return cachedVitreousPorcelainMat;
}

const vitreousEnamelCache = new Map<string, THREE.MeshPhysicalMaterial>();
export function getVitreousEnamelMaterial(
  color: THREE.ColorRepresentation,
  name = 'catalog.vitreousEnamel'
): THREE.MeshPhysicalMaterial {
  const c = new THREE.Color(color);
  const key = `${c.getHexString()}:${name}`;
  let mat = vitreousEnamelCache.get(key);
  if (!mat) {
    mat = new THREE.MeshPhysicalMaterial({
      name,
      color: c,
      roughness: 0.14,
      metalness: 0.06,
      clearcoat: 0.9,
      clearcoatRoughness: 0.08,
    });
    vitreousEnamelCache.set(key, mat);
  }
  return mat;
}
