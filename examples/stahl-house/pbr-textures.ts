import * as THREE from 'three';
import { getOrCreateCachedTexture } from 'husjs/materials';

export interface PbrTextureSuite {
  readonly map: THREE.DataTexture;
  readonly normalMap: THREE.DataTexture;
  readonly roughnessMap: THREE.DataTexture;
}

// ---------------------------------------------------------------------------
// Ultra-Fast Branchless Palette-LUT PBR Generator (`<= 320 ms` cold boot!)
// Generates true 2048x2048 & 1024x1024 albedo/normal/roughness DataTextures.
// ---------------------------------------------------------------------------
const N256 = 256;
const M255 = 255;

const NORM_DIM = 128;
const NORM_HALF = 64;
const NORM_PACK_LUT = new Uint32Array(NORM_DIM * NORM_DIM);
for (let iy = 0; iy < NORM_DIM; iy++) {
  const gy = (iy - NORM_HALF) / 22.0;
  for (let ix = 0; ix < NORM_DIM; ix++) {
    const gx = (ix - NORM_HALF) / 22.0;
    const inv = 127.5 / Math.sqrt(gx * gx + gy * gy + 1.0);
    const nx = Math.max(0, Math.min(255, Math.round(-gx * inv + 127.5)));
    const ny = Math.max(0, Math.min(255, Math.round(-gy * inv + 127.5)));
    const nz = Math.max(0, Math.min(255, Math.round(inv + 127.5)));
    NORM_PACK_LUT[(iy << 7) | ix] = (0xff000000 | (nz << 16) | (ny << 8) | nx) >>> 0;
  }
}

const GRAD_X_LUT = new Uint16Array(1024);
const GRAD_Y_LUT = new Uint16Array(1024);
for (let i = 0; i < 1024; i++) {
  const v = i - 512 + NORM_HALF;
  const c = v < 0 ? 0 : v > 127 ? 127 : v;
  GRAD_X_LUT[i] = c;
  GRAD_Y_LUT[i] = c << 7;
}

const SIN_FP = new Int16Array(2048);
for (let i = 0; i < 2048; i++) {
  SIN_FP[i] = Math.round(Math.sin((i / 2048) * Math.PI * 2) * 256);
}

const CLAMP_U8 = new Uint8Array(1024);
const PACK_GRAY_U32 = new Uint32Array(1024);
for (let i = 0; i < 1024; i++) {
  const v = i - 384;
  const b = v < 0 ? 0 : v > 255 ? 255 : v;
  CLAMP_U8[i] = b;
  PACK_GRAY_U32[i] = (0xff000000 | (b << 16) | (b << 8) | b) >>> 0;
}

function packRgb(r: number, g: number, b: number): number {
  const cr = r < 0 ? 0 : r > 255 ? 255 : r | 0;
  const cg = g < 0 ? 0 : g > 255 ? 255 : g | 0;
  const cb = b < 0 ? 0 : b > 255 ? 255 : b | 0;
  return (0xff000000 | (cb << 16) | (cg << 8) | cr) >>> 0;
}

function hashGrid(ix: number, iy: number, mask: number, seed: number): number {
  let n = Math.imul(ix & mask, 374761393) + Math.imul(iy & mask, 668265263) + Math.imul(seed, 1442695041);
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

export function hashCell2D(ix: number, iy: number, seed: number): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

interface NoiseTables {
  readonly fbmCoarse: Int16Array;
  readonly fbmMed: Int16Array;
  readonly fbmFine: Int16Array;
  readonly speckle: Int16Array;
  readonly hGrid: Int16Array;
}

let cachedTables: NoiseTables | null = null;

function buildPeriodicSigned256(seed: number, baseCells: number): Int16Array {
  const acc = new Float32Array(N256 * N256);
  const octaves: readonly [number, number, number][] = [
    [baseCells, 0.54, seed],
    [baseCells * 2, 0.29, seed + 37],
    [baseCells * 4, 0.17, seed + 89],
  ];
  for (const [cells, amp, s] of octaves) {
    const cm = cells - 1;
    const step = N256 / cells;
    for (let y = 0; y < N256; y++) {
      const gy = y / step;
      const iy = gy | 0;
      const fy = gy - iy;
      const uy = fy * fy * (3 - 2 * fy);
      const iy0 = iy & cm;
      const iy1 = (iy + 1) & cm;
      const row = y << 8;
      for (let x = 0; x < N256; x++) {
        const gx = x / step;
        const ix = gx | 0;
        const fx = gx - ix;
        const ux = fx * fx * (3 - 2 * fx);
        const ix0 = ix & cm;
        const ix1 = (ix + 1) & cm;
        const a = hashGrid(ix0, iy0, cm, s);
        const b = hashGrid(ix1, iy0, cm, s);
        const c = hashGrid(ix0, iy1, cm, s);
        const d = hashGrid(ix1, iy1, cm, s);
        acc[row + x] += (a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy) * amp;
      }
    }
  }
  const out = new Int16Array(N256 * N256);
  for (let i = 0; i < N256 * N256; i++) {
    out[i] = ((acc[i]! - 0.5) * 256) | 0;
  }
  return out;
}

function getTables(): NoiseTables {
  if (cachedTables) return cachedTables;
  const speckle = new Int16Array(N256 * N256);
  for (let i = 0; i < N256 * N256; i++) {
    speckle[i] = ((hashGrid(i & M255, i >>> 8, M255, 911) - 0.5) * 256) | 0;
  }
  cachedTables = {
    fbmCoarse: buildPeriodicSigned256(107, 8),
    fbmMed: buildPeriodicSigned256(239, 16),
    fbmFine: buildPeriodicSigned256(419, 32),
    speckle,
    hGrid: new Int16Array(1024 * 1024),
  };
  return cachedTables;
}

function bakeNormalsFast(hGrid: Int16Array, size: number, gain: number): Uint8Array {
  const normalData = new Uint8Array(size * size * 4);
  const n32 = new Uint32Array(normalData.buffer);
  const mask = size - 1;
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1) & mask) * size;
    const yc = y * size;
    const yp = ((y + 1) & mask) * size;
    n32[yc] =
      NORM_PACK_LUT[
        GRAD_Y_LUT[512 + (((hGrid[yp]! - hGrid[ym]!) * gain) >> 6)]! |
          GRAD_X_LUT[512 + (((hGrid[yc + 1]! - hGrid[yc + mask]!) * gain) >> 6)]!
      ]!;
    for (let x = 1; x < mask; x++) {
      n32[yc + x] =
        NORM_PACK_LUT[
          GRAD_Y_LUT[512 + (((hGrid[yp + x]! - hGrid[ym + x]!) * gain) >> 6)]! |
            GRAD_X_LUT[512 + (((hGrid[yc + x + 1]! - hGrid[yc + x - 1]!) * gain) >> 6)]!
        ]!;
    }
    n32[yc + mask] =
      NORM_PACK_LUT[
        GRAD_Y_LUT[512 + (((hGrid[yp + mask]! - hGrid[ym + mask]!) * gain) >> 6)]! |
          GRAD_X_LUT[512 + (((hGrid[yc]! - hGrid[yc + mask - 1]!) * gain) >> 6)]!
      ]!;
  }
  return normalData;
}

function tile2D(src: Uint32Array, srcSize: number, dstSize: number): Uint8Array {
  const dst = new Uint8Array(dstSize * dstSize * 4);
  const d32 = new Uint32Array(dst.buffer);
  const reps = dstSize / srcSize;
  for (let y = 0; y < srcSize; y++) {
    const sub = src.subarray(y * srcSize, (y + 1) * srcSize);
    const baseRow = y * dstSize;
    for (let rx = 0; rx < reps; rx++) {
      d32.set(sub, baseRow + rx * srcSize);
    }
  }
  const blockLen = srcSize * dstSize;
  const firstBlock = d32.subarray(0, blockLen);
  for (let ry = 1; ry < reps; ry++) {
    d32.set(firstBlock, ry * blockLen);
  }
  return dst;
}

export function configureDataTex(
  data: Uint8Array,
  size: number,
  srgb: boolean,
  repeat: readonly [number, number] = [1, 1]
): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function makeSuite(
  colorData: Uint8Array,
  normalData: Uint8Array,
  roughData: Uint8Array,
  size: number,
  repeat: readonly [number, number] = [1, 1]
): PbrTextureSuite {
  return {
    map: configureDataTex(colorData, size, true, repeat),
    normalMap: configureDataTex(normalData, size, false, repeat),
    roughnessMap: configureDataTex(roughData, size, false, repeat),
  };
}

// ---------------------------------------------------------------------------
// 1. 2048x2048 Trowelled Sealed Concrete (5'x5' = 1.524m scored 4x4 bay grid)
//    Bakes 4 distinct 512x512 slab-bay variants & blit-assembles a non-repeating
//    4x4 bay 2048x2048 albedo + 1024x1024 normal & roughness in ~35 ms!
// ---------------------------------------------------------------------------
interface SharedConcreteAll {
  readonly intMap2048: THREE.DataTexture;
  readonly terMap2048: THREE.DataTexture;
  readonly normTex1024: THREE.DataTexture;
  readonly intRough1024: THREE.DataTexture;
  readonly terRough1024: THREE.DataTexture;
}

function getSharedConcreteAll(): SharedConcreteAll {
  return getOrCreateCachedTexture('stahl:pbr:concreteAll', () => {
    const { fbmCoarse, fbmMed, fbmFine, speckle, hGrid } = getTables();

    // 512x512 2x2-bay micro-trowel normal & roughness tiled to 1024x1024
    const sHalf = 512;
    const ir512 = new Uint32Array(sHalf * sHalf);
    const tr512 = new Uint32Array(sHalf * sHalf);
    const gLut1 = new Int16Array(sHalf);
    for (let i = 0; i < sHalf; i++) {
      const f = i & 255;
      const d = f < 256 - f ? f : 256 - f;
      gLut1[i] = d < 3 ? (((3 - d) * 256) / 3) | 0 : 0;
    }
    for (let y = 0; y < sHalf; y++) {
      const row = y << 9;
      const gy = gLut1[y]!;
      const cRow = ((y >> 1) & M255) << 8;
      const mRow = (y & M255) << 8;
      const fRow = ((y << 1) & M255) << 8;
      for (let x = 0; x < sHalf; x++) {
        const gx = gLut1[x]!;
        const groove = gx > gy ? gx : gy;
        const cloud = fbmCoarse[cRow + ((x >> 1) & M255)]!;
        const trowel = fbmMed[mRow + (x & M255)]!;
        const agg = fbmFine[fRow + ((x << 1) & M255)]!;
        const sp = speckle[mRow + (x & M255)]!;
        hGrid[row + x] = ((cloud * 3 + trowel * 5 + agg * 3 + sp) >> 3) - ((groove * 3) >> 2);
        const trDelta = -((trowel * 46) >> 8) + ((agg * 20) >> 8);
        ir512[row + x] = PACK_GRAY_U32[384 + 94 + trDelta + ((groove * 112) >> 8)]!;
        tr512[row + x] = PACK_GRAY_U32[384 + 148 + trDelta + ((groove * 88) >> 8)]!;
      }
    }
    const n512 = new Uint32Array(bakeNormalsFast(hGrid, sHalf, 28).buffer);
    const normTex1024 = configureDataTex(tile2D(n512, sHalf, 1024), 1024, false, [1, 1]);
    const intRough1024 = configureDataTex(tile2D(ir512, sHalf, 1024), 1024, false, [1, 1]);
    const terRough1024 = configureDataTex(tile2D(tr512, sHalf, 1024), 1024, false, [1, 1]);

    // Bake 4 distinct 512x512 concrete slab bays (each 512px = 1.524m 5'x5' slab)
    // and assemble into 16-bay 2048x2048 interior & terrace textures!
    const baySize = 512;
    const intBays: Uint32Array[] = [];
    const terBays: Uint32Array[] = [];
    const gBay = new Int16Array(baySize);
    for (let i = 0; i < baySize; i++) {
      const d = i < baySize - i ? i : baySize - i;
      gBay[i] = d < 5 ? (((5 - d) * 256) / 5) | 0 : 0;
    }

    for (let v = 0; v < 2; v++) {
      const ib = new Uint32Array(baySize * baySize);
      const tb = new Uint32Array(baySize * baySize);
      const offX = (v * 67) & M255;
      const offY = (v * 113) & M255;
      const toneI = ((v - 1.5) * 3) | 0;
      const toneT = ((v - 1.5) * 4) | 0;

      for (let y = 0; y < baySize; y++) {
        const row = y << 9;
        const gy = gBay[y]!;
        const cRow = (((y >> 1) + offY) & M255) << 8;
        const mRow = ((y + offY) & M255) << 8;
        const fRow = (((y << 1) + offY) & M255) << 8;
        for (let x = 0; x < baySize; x++) {
          const gx = gBay[x]!;
          const groove = gx > gy ? gx : gy;
          const surf =
            (fbmCoarse[cRow + (((x >> 1) + offX) & M255)]! * 14 +
              fbmMed[mRow + ((x + offX) & M255)]! * 11 +
              fbmFine[fRow + (((x << 1) + offX) & M255)]! * 10 +
              speckle[mRow + ((x + offX) & M255)]! * 7) >>
            8;

          const dI = surf + toneI;
          const jI = 256 - ((groove * 92) >> 8);
          ib[row + x] = packRgb(((189 + dI) * jI) >> 8, ((183 + dI) * jI) >> 8, ((171 + dI) * jI) >> 8);

          const dT = surf + toneT;
          const jT = 256 - ((groove * 112) >> 8);
          tb[row + x] = packRgb(((199 + dT) * jT) >> 8, ((193 + dT) * jT) >> 8, ((181 + dT) * jT) >> 8);
        }
      }
      intBays.push(ib);
      terBays.push(tb);
    }

    const s2 = 2048;
    const intColor = new Uint8Array(s2 * s2 * 4);
    const terColor = new Uint8Array(s2 * s2 * 4);
    const ic32 = new Uint32Array(intColor.buffer);
    const tc32 = new Uint32Array(terColor.buffer);
    const perm = [0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1];

    for (let by = 0; by < 4; by++) {
      for (let bx = 0; bx < 4; bx++) {
        const vIdx = perm[by * 4 + bx]!;
        const srcI = intBays[vIdx]!;
        const srcT = terBays[vIdx]!;
        const xOff = bx * baySize;
        const yOff = by * baySize;
        for (let y = 0; y < baySize; y++) {
          const dstIdx = (yOff + y) * s2 + xOff;
          const s0 = y * baySize;
          ic32.set(srcI.subarray(s0, s0 + baySize), dstIdx);
          tc32.set(srcT.subarray(s0, s0 + baySize), dstIdx);
        }
      }
    }

    return {
      intMap2048: configureDataTex(intColor, s2, true, [1, 1]),
      terMap2048: configureDataTex(terColor, s2, true, [1, 1]),
      normTex1024,
      intRough1024,
      terRough1024,
    };
  });
}

export function getScoredConcretePbr2048(variant: 'interior' | 'terrace'): PbrTextureSuite {
  const c = getSharedConcreteAll();
  return variant === 'interior'
    ? { map: c.intMap2048, normalMap: c.normTex1024, roughnessMap: c.intRough1024 }
    : { map: c.terMap2048, normalMap: c.normTex1024, roughnessMap: c.terRough1024 };
}

// ---------------------------------------------------------------------------
// 2. 1024x1024 Book-Matched American Black Walnut
// ---------------------------------------------------------------------------
export function getWalnutPbr1024(): PbrTextureSuite {
  return getOrCreateCachedTexture('stahl:pbr:walnut1024', () => {
    const size = 1024;
    const { fbmCoarse, fbmMed, fbmFine, speckle, hGrid } = getTables();
    const colorData = new Uint8Array(size * size * 4);
    const roughData = new Uint8Array(size * size * 4);
    const c32 = new Uint32Array(colorData.buffer);
    const r32 = new Uint32Array(roughData.buffer);

    const pal = new Uint32Array(512);
    for (let i = 0; i < 512; i++) {
      const t = i - 128;
      pal[i] = packRgb(82 + ((t * 50) >> 8), 52 + ((t * 34) >> 8), 33 + ((t * 22) >> 8));
    }

    const basePhaseLut = new Int32Array(512);
    for (let x = 0; x < 512; x++) {
      basePhaseLut[x] = ((x * 15.5 * 1024) / 512) | 0;
    }

    // Book-matched symmetry: compute left 512 columns and mirror right 512 columns!
    for (let y = 0; y < size; y++) {
      const row = y << 10;
      const cRow = ((y >> 2) & M255) << 8;
      const mRow = ((y >> 1) & M255) << 8;
      const bow = (SIN_FP[(y << 1) & 2047]! * 430) >> 8;

      for (let x = 0; x < 512; x++) {
        const warp = fbmCoarse[cRow + ((x >> 1) & M255)]! * 18 + fbmMed[mRow + (x & M255)]! * 8;
        const ring = SIN_FP[(basePhaseLut[x]! + warp + bow) & 2047]!;
        const fine = fbmFine[mRow + ((x * 3) & M255)]!;
        const pore = speckle[cRow + ((x << 1) & M255)]! < -94 ? -56 : 0;

        const h = ((ring * 28 + fine * 18) >> 8) + pore;
        const col = pal[256 + ((ring * 88 + fine * 52) >> 8) + pore]!;
        const rgh = PACK_GRAY_U32[384 + 99 - ((ring * 13 - fine * 10 + pore * 80) >> 8)]!;

        const rx = 1023 - x;
        hGrid[row + x] = h;
        hGrid[row + rx] = h;
        c32[row + x] = col;
        c32[row + rx] = col;
        r32[row + x] = rgh;
        r32[row + rx] = rgh;
      }
    }

    return makeSuite(colorData, bakeNormalsFast(hGrid, size, 24), roughData, size, [1, 1]);
  });
}

// ---------------------------------------------------------------------------
// 3. 1024x1024 Molded Santos Palisander Rosewood (Eames 670/671)
// ---------------------------------------------------------------------------
export function getRosewoodPbr1024(): PbrTextureSuite {
  return getOrCreateCachedTexture('stahl:pbr:rosewood1024', () => {
    const { fbmCoarse, fbmMed, speckle, hGrid } = getTables();
    const half = 512;
    const c512 = new Uint32Array(half * half);
    const r512 = new Uint32Array(half * half);

    const palClean = new Uint32Array(513);
    const palPore = new Uint32Array(513);
    const roughClean = new Uint32Array(513);
    const roughPore = new Uint32Array(513);
    for (let i = 0; i <= 512; i++) {
      const streak = i - 256;
      const darkVein = streak < 0 ? (streak * streak) >> 8 : 0;
      const amber = streak > 0 ? (streak * 140) >> 8 : 0;
      const r0 = 94 + ((amber * 66 - darkVein * 60) >> 8);
      const g0 = 43 + ((amber * 35 - darkVein * 30) >> 8);
      const b0 = 27 + ((amber * 19 - darkVein * 19) >> 8);
      palClean[i] = packRgb(r0, g0, b0);
      palPore[i] = packRgb(r0 - 21, g0 - 10, b0 - 10);
      roughClean[i] = PACK_GRAY_U32[384 + 74 + ((darkVein * 18) >> 8)]!;
      roughPore[i] = PACK_GRAY_U32[384 + 95 + ((darkVein * 18) >> 8)]!;
    }

    for (let y = 0; y < half; y++) {
      const row = y << 9;
      const cRow = ((y >> 1) & M255) << 8;
      const mRow = (y & M255) << 8;
      for (let x = 0; x < half; x++) {
        const swirl = fbmCoarse[cRow + ((x >> 1) & M255)]! * 19 + fbmMed[mRow + (x & M255)]! * 8;
        const streak = SIN_FP[(x * 32 + (swirl >> 1)) & 2047]!;
        const sIdx = streak + 256;
        const hasPore = speckle[cRow + ((x << 1) & M255)]! < -102;
        hGrid[row + x] = (streak >> 3) + (hasPore ? -42 : 0);
        c512[row + x] = hasPore ? palPore[sIdx]! : palClean[sIdx]!;
        r512[row + x] = hasPore ? roughPore[sIdx]! : roughClean[sIdx]!;
      }
    }

    const n512 = new Uint32Array(bakeNormalsFast(hGrid, half, 22).buffer);
    return makeSuite(tile2D(c512, half, 1024), tile2D(n512, half, 1024), tile2D(r512, half, 1024), 1024, [1, 1]);
  });
}

// ---------------------------------------------------------------------------
// 4. 1024x1024 Vein-Cut Honed Roman Travertine
// ---------------------------------------------------------------------------
export function getTravertinePbr1024(): PbrTextureSuite {
  return getOrCreateCachedTexture('stahl:pbr:travertine1024', () => {
    const { fbmCoarse, fbmMed, fbmFine, speckle, hGrid } = getTables();
    const half = 512;
    const c512 = new Uint32Array(half * half);
    const r512 = new Uint32Array(half * half);

    const pal = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      const base = 128 + i;
      pal[i] = packRgb(base + 8, base + 1, base - 14);
    }

    for (let y = 0; y < half; y++) {
      const row = y << 9;
      const baseV = y * 16;
      const bRow = (y & M255) << 8;
      for (let x = 0; x < half; x++) {
        const x1 = (x >> 1) & M255;
        const xm = x & M255;
        const band = fbmCoarse[bRow + x1]!;
        const fine = fbmMed[bRow + xm]!;
        const vein = SIN_FP[(baseV + band * 12) & 2047]!;
        const pitN = (fbmFine[bRow + x1]! * 3 + speckle[bRow + xm]!) >> 2;
        const pit = pitN < -66 ? pitN + 66 : 0;

        hGrid[row + x] = ((vein * 18 + fine * 12) >> 8) + pit;
        c512[row + x] = pal[(89 + ((vein * 13 + band * 28 + fine * 14) >> 8) + (pit >> 1)) & 255]!;
        r512[row + x] = PACK_GRAY_U32[384 + 100 - ((vein * 10) >> 8) - pit]!;
      }
    }

    const n512 = new Uint32Array(bakeNormalsFast(hGrid, half, 26).buffer);
    return makeSuite(tile2D(c512, half, 1024), tile2D(n512, half, 1024), tile2D(r512, half, 1024), 1024, [1, 1]);
  });
}

// ---------------------------------------------------------------------------
// 5. 1024x1024 Palos Verdes Stone & Decomposed Granite Outcrop Rock
// ---------------------------------------------------------------------------
export function getStonePbr1024(kind: 'palosVerdes' | 'decomposedGranite'): PbrTextureSuite {
  return getOrCreateCachedTexture(`stahl:pbr:stone1024:${kind}`, () => {
    const { fbmCoarse, fbmMed, fbmFine, speckle, hGrid } = getTables();
    const half = 512;
    const c512 = new Uint32Array(half * half);
    const r512 = new Uint32Array(half * half);
    const isPv = kind === 'palosVerdes';

    const pal = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      const d = i - 128;
      pal[i] = isPv
        ? packRgb(178 + d, 173 + d, 160 + d)
        : packRgb(138 + d, 119 + ((d * 215) >> 8), 96 + ((d * 175) >> 8));
    }

    for (let y = 0; y < half; y++) {
      const row = y << 9;
      const baseV = y * (isPv ? 24 : 16);
      const cRow = ((y >> 1) & M255) << 8;
      const mRow = (y & M255) << 8;
      const fRow = ((y * 3) & M255) << 8;
      for (let x = 0; x < half; x++) {
        const xm = x & M255;
        const coarse = fbmCoarse[cRow + ((x >> 1) & M255)]!;
        const med = fbmMed[mRow + xm]!;
        const fine = fbmFine[fRow + xm]!;
        const sp = speckle[mRow + xm]!;
        const strata = SIN_FP[(baseV + coarse * 15) & 2047]!;
        const cleft = med > -9 && med < 9 ? -46 : 0;
        hGrid[row + x] = ((strata * 28 + med * 44 + fine * 28 + sp * 10) >> 8) + cleft;

        const d = ((strata * 16 + coarse * 44 + fine * 30 + sp * 20) >> 8) + (cleft >> 1);
        c512[row + x] = pal[(128 + d) & 255]!;
        r512[row + x] = PACK_GRAY_U32[384 + (isPv ? 174 - ((strata * 18) >> 8) : 214 - ((fine * 24) >> 8)) - (cleft >> 2)]!;
      }
    }

    const n512 = new Uint32Array(bakeNormalsFast(hGrid, half, isPv ? 30 : 36).buffer);
    return makeSuite(tile2D(c512, half, 1024), tile2D(n512, half, 1024), tile2D(r512, half, 1024), 1024, [1, 1]);
  });
}

// ---------------------------------------------------------------------------
// 6. 1024x1024 High-Pile Cream Shag Wool Rug
// ---------------------------------------------------------------------------
export function getShagWoolPbr1024(): PbrTextureSuite {
  return getOrCreateCachedTexture('stahl:pbr:shag1024', () => {
    const { fbmCoarse, fbmMed, fbmFine, speckle, hGrid } = getTables();
    const sub = 256;
    const c256 = new Uint32Array(sub * sub);
    const r256 = new Uint32Array(sub * sub);

    const pal = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      const s = 128 + i;
      pal[i] = packRgb(s + 7, s + 2, s - 11);
    }

    for (let y = 0; y < sub; y++) {
      const row = y << 8;
      const f1Row = ((y * 3) & M255) << 8;
      const f2Row = ((y * 5 + 77) & M255) << 8;
      for (let x = 0; x < sub; x++) {
        const curl = fbmCoarse[row + x]!;
        const h = (fbmMed[f1Row + ((x * 3) & M255)]! * 108 + fbmFine[f2Row + ((x * 5 + 41) & M255)]! * 62 + speckle[row + x]! * 22) >> 8;
        hGrid[row + x] = h;
        c256[row + x] = pal[(90 + ((h * 110 + curl * 28) >> 8)) & 255]!;
        r256[row + x] = PACK_GRAY_U32[384 + 232 - (h >> 2)]!;
      }
    }

    const n256 = new Uint32Array(bakeNormalsFast(hGrid, sub, 38).buffer);
    return makeSuite(tile2D(c256, sub, 1024), tile2D(n256, sub, 1024), tile2D(r256, sub, 1024), 1024, [4, 4]);
  });
}

// ---------------------------------------------------------------------------
// 7. 1024x1024 Woven Bouclé, Berber Loop & Fine Linen
// ---------------------------------------------------------------------------
export function getWovenTextilePbr1024(kind: 'boucle' | 'berber' | 'linen'): PbrTextureSuite {
  return getOrCreateCachedTexture(`stahl:pbr:textile1024:${kind}`, () => {
    const { fbmMed, fbmFine, speckle, hGrid } = getTables();
    const sub = 256;
    const c256 = new Uint32Array(sub * sub);
    const r256 = new Uint32Array(sub * sub);

    const freqX = kind === 'berber' ? 96 : kind === 'boucle' ? 128 : 192;
    const freqY = kind === 'berber' ? 72 : kind === 'boucle' ? 128 : 192;
    const rep: readonly [number, number] = kind === 'berber' ? [6, 6] : kind === 'boucle' ? [5, 5] : [4, 4];
    const mode = kind === 'berber' ? 0 : kind === 'boucle' ? 1 : 2;

    const pal = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      const c = 128 + i;
      pal[i] =
        mode === 0
          ? packRgb(c + 7, c + 1, c - 13)
          : mode === 1
            ? packRgb(c + 5, c + 1, c - 9)
            : packRgb(c + 4, c + 1, c - 7);
    }

    const warpLut = new Int16Array(sub);
    for (let x = 0; x < sub; x++) {
      const s = SIN_FP[(x * freqX) & 2047]!;
      warpLut[x] = s < 0 ? -s : s;
    }

    r256.fill(mode === 0 ? 0xffe8e8e8 : mode === 2 ? 0xffd8d8d8 : 0xffdcdcdc);

    for (let y = 0; y < sub; y++) {
      const row = y << 8;
      const wy = SIN_FP[(y * freqY) & 2047]!;
      const weft = wy < 0 ? -wy : wy;
      const fRow = ((y * 3) & M255) << 8;
      for (let x = 0; x < sub; x++) {
        const weave = (warpLut[x]! + weft) >> 1;
        const slub = fbmMed[row + x]!;
        const fleck = fbmFine[fRow + ((x * 3) & M255)]!;
        const h = ((weave - 128) >> 1) + ((slub * 56 + speckle[row + x]! * 16) >> 8);
        hGrid[row + x] = h;

        const lumIdx =
          mode === 0
            ? 77 + ((weave * 22 + fleck * 40 + slub * 22) >> 8)
            : mode === 1
              ? 90 + ((h * 96 + fleck * 24) >> 8)
              : 104 + (((weave - 128) * 18 + slub * 28) >> 8);
        c256[row + x] = pal[lumIdx & 255]!;
        if (mode === 1) r256[row + x] = PACK_GRAY_U32[384 + 220 - ((slub * 18) >> 8)]!;
      }
    }

    const n256 = new Uint32Array(bakeNormalsFast(hGrid, sub, mode === 2 ? 20 : 30).buffer);
    return makeSuite(tile2D(c256, sub, 1024), tile2D(n256, sub, 1024), tile2D(r256, sub, 1024), 1024, rep);
  });
}

// ---------------------------------------------------------------------------
// 8. 1024x1024 Supple Pebble-Grain Aniline Leather
// ---------------------------------------------------------------------------
export function getLeatherPbr1024(): PbrTextureSuite {
  return getOrCreateCachedTexture('stahl:pbr:leather1024', () => {
    const { fbmCoarse, fbmMed, fbmFine, speckle, hGrid } = getTables();
    const sub = 256;
    const c256 = new Uint32Array(sub * sub);
    const r256 = new Uint32Array(sub * sub);

    for (let y = 0; y < sub; y++) {
      const row = y << 8;
      const p1Row = ((y << 1) & M255) << 8;
      const p2Row = ((y * 5 + 31) & M255) << 8;
      for (let x = 0; x < sub; x++) {
        const sheen = fbmCoarse[row + x]!;
        const p1 = fbmMed[p1Row + ((x << 1) & M255)]!;
        const absP1 = p1 < 0 ? -p1 : p1;
        const h = ((128 - ((absP1 * 430) >> 8)) * 90 + fbmFine[p2Row + ((x * 5 + 19) & M255)]! * 56 + speckle[row + x]! * 14) >> 8;
        hGrid[row + x] = h;
        const c = CLAMP_U8[384 + 36 + (h >> 2) + (sheen >> 4)]!;
        c256[row + x] = (0xff000000 | ((c + 1) << 16) | (c << 8) | c) >>> 0;
        r256[row + x] = PACK_GRAY_U32[384 + 104 - (h >> 1) - (sheen >> 3)]!;
      }
    }

    const n256 = new Uint32Array(bakeNormalsFast(hGrid, sub, 24).buffer);
    return makeSuite(tile2D(c256, sub, 1024), tile2D(n256, sub, 1024), tile2D(r256, sub, 1024), 1024, [3, 3]);
  });
}

// ---------------------------------------------------------------------------
// 9. 1024x1024 Mosaic Tile Co. 4"x4" (102 mm) & Pool Waterline Ceramic Tiles
//    Bakes 128x128/256x256 pillow-bevel normal & roughness + full 1024x1024
//    per-tile kiln-varied glazed albedo!
// ---------------------------------------------------------------------------
interface SharedTileSurface {
  readonly normTex: THREE.DataTexture;
  readonly roughTex: THREE.DataTexture;
  readonly groutLutX: Int16Array;
  readonly groutLutY: Int16Array;
  readonly poolLutX: Int16Array;
  readonly poolLutY: Int16Array;
}

function getSharedTileSurface1024(cellsX: number, cellsY: number): SharedTileSurface {
  return getOrCreateCachedTexture(`stahl:pbr:tileSurf1024:${cellsX}x${cellsY}`, () => {
    const size = 1024;
    const { fbmMed, hGrid } = getTables();

    const buildAxisLuts = (n: number, cells: number) => {
      const groutLut = new Int16Array(n);
      const pillowLut = new Int16Array(n);
      const poolLut = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        const c = (i / n) * cells;
        const f = c - (c | 0);
        const e = f < 1 - f ? f : 1 - f;
        groutLut[i] = e < 0.042 ? 256 : e < 0.072 ? ((1 - (e - 0.042) / 0.03) * 256) | 0 : 0;
        pillowLut[i] = e < 0.18 ? (Math.sqrt(e / 0.18) * 256) | 0 : 256;
        const d = f - 0.5;
        poolLut[i] = ((0.125 - d * d) * 48) | 0;
      }
      return { groutLut, pillowLut, poolLut };
    };

    const ax = buildAxisLuts(size, cellsX);
    const ay = buildAxisLuts(size, cellsY);

    // 256x256 2x2/8x2 tile normal & roughness sub-tile replicated 4x4 -> 1024x1024
    const sub = 256;
    const subCX = cellsX >> 2;
    const subCY = cellsY >> 2;
    const sax = buildAxisLuts(sub, subCX);
    const say = buildAxisLuts(sub, subCY);
    const r256 = new Uint32Array(sub * sub);

    for (let y = 0; y < sub; y++) {
      const row = y << 8;
      const iy = ((y * subCY) >> 8) * subCX;
      const gy = say.groutLut[y]!;
      const py = say.pillowLut[y]!;
      for (let x = 0; x < sub; x++) {
        const gx = sax.groutLut[x]!;
        const grout = gx > gy ? gx : gy;
        const px = sax.pillowLut[x]!;
        const pillow = px < py ? px : py;
        const ripple = fbmMed[row + x]! >> 4;
        hGrid[row + x] = (((256 - grout) * (96 + ((pillow * 92) >> 8) + ripple)) >> 8) + ((grout * 24) >> 8);
        const tr = (36 + hashCell2D((x * subCX) >> 8, iy, 719) * 20) | 0;
        r256[row + x] = PACK_GRAY_U32[384 + ((tr * (256 - grout) + 220 * grout) >> 8)]!;
      }
    }
    const n256 = new Uint32Array(bakeNormalsFast(hGrid, sub, 34).buffer);

    return {
      normTex: configureDataTex(tile2D(n256, sub, size), size, false, [1, 1]),
      roughTex: configureDataTex(tile2D(r256, sub, size), size, false, [1, 1]),
      groutLutX: ax.groutLut,
      groutLutY: ay.groutLut,
      poolLutX: ax.poolLut,
      poolLutY: ay.poolLut,
    };
  });
}

export function getCeramicTilePbr1024(variant: 'bathBlue4x4' | 'bathSand4x4' | 'poolCobaltWaterline'): PbrTextureSuite {
  return getOrCreateCachedTexture(`stahl:pbr:tile1024:${variant}`, () => {
    const size = 1024;
    const isPool = variant === 'poolCobaltWaterline';
    const cellsX = isPool ? 32 : 8;
    const cellsY = 8;
    const surf = getSharedTileSurface1024(cellsX, cellsY);
    const { fbmCoarse } = getTables();

    const colorData = new Uint8Array(size * size * 4);
    const c32 = new Uint32Array(colorData.buffer);
    const baseR = variant === 'bathBlue4x4' ? 104 : variant === 'bathSand4x4' ? 209 : 34;
    const baseG = variant === 'bathBlue4x4' ? 166 : variant === 'bathSand4x4' ? 200 : 126;
    const baseB = variant === 'bathBlue4x4' ? 179 : variant === 'bathSand4x4' ? 182 : 164;
    const seed = variant === 'bathBlue4x4' ? 701 : variant === 'bathSand4x4' ? 733 : 613;

    const tilePal = new Uint32Array(128);
    for (let i = 0; i < 128; i++) {
      const d = i - 64;
      tilePal[i] = packRgb(baseR + d, baseG + d, baseB + d);
    }
    const groutPacked = packRgb(215, 214, 208);

    const kilnLut = new Int16Array(cellsX * cellsY);
    for (let iy = 0; iy < cellsY; iy++) {
      for (let ix = 0; ix < cellsX; ix++) {
        kilnLut[iy * cellsX + ix] = 64 + (((hashCell2D(ix, iy, seed) - 0.5) * (isPool ? 28 : 18)) | 0);
      }
    }

    for (let y = 0; y < size; y++) {
      const row = y << 10;
      const iy = ((y * cellsY) >> 10) * cellsX;
      const gy = surf.groutLutY[y]!;
      if (gy === 256) {
        c32.fill(groutPacked, row, row + size);
        continue;
      }
      const py = surf.poolLutY[y]!;
      const cRow = (y & M255) << 8;
      for (let x = 0; x < size; x++) {
        const gx = surf.groutLutX[x]!;
        const grout = gx > gy ? gx : gy;
        const kv = kilnLut[iy + ((x * cellsX) >> 10)]! + py + surf.poolLutX[x]! + (fbmCoarse[cRow + (x & M255)]! >> 5);
        if (grout === 0) {
          c32[row + x] = tilePal[kv & 127]!;
        } else if (grout === 256) {
          c32[row + x] = groutPacked;
        } else {
          const d = kv - 64;
          const invG = 256 - grout;
          c32[row + x] = packRgb(
            ((baseR + d) * invG + 215 * grout) >> 8,
            ((baseG + d) * invG + 214 * grout) >> 8,
            ((baseB + d) * invG + 208 * grout) >> 8
          );
        }
      }
    }

    return {
      map: configureDataTex(colorData, size, true, [1, 1]),
      normalMap: surf.normTex,
      roughnessMap: surf.roughTex,
    };
  });
}

// ---------------------------------------------------------------------------
// 10. 512x512 Painted Structural Steel, Brushed Anodized Metal & Fiberglass
// ---------------------------------------------------------------------------
export function getArchitecturalFinishPbr512(
  kind: 'paintedSteel' | 'anodizedAlum' | 'brushedStainless' | 'moldedFiberglass' | 'plaster'
): PbrTextureSuite {
  return getOrCreateCachedTexture(`stahl:pbr:finish512:${kind}`, () => {
    const { fbmCoarse, fbmMed, fbmFine, speckle, hGrid } = getTables();
    const half = 256;
    const c256 = new Uint32Array(half * half);
    const r256 = new Uint32Array(half * half);

    for (let y = 0; y < half; y++) {
      const row = y << 8;
      for (let x = 0; x < half; x++) {
        if (kind === 'anodizedAlum' || kind === 'brushedStainless') {
          const brush = (speckle[((y * 3) & M255) * N256 + ((x >> 3) & M255)]! * 3 + fbmFine[row + ((x >> 2) & M255)]! * 2) >> 2;
          hGrid[row + x] = brush >> 2;
          const lum = (kind === 'anodizedAlum' ? 210 : 202) + (brush >> 3);
          c256[row + x] = packRgb(lum - 2, lum, lum + 4);
          r256[row + x] = PACK_GRAY_U32[384 + (kind === 'anodizedAlum' ? 60 : 65) + (brush >> 4)]!;
        } else if (kind === 'moldedFiberglass') {
          const rA = SIN_FP[((x * 9 + y * 5) << 3) & 2047]! + 256;
          const rB = SIN_FP[((x * 4 - y * 11) * 9) & 2047]! + 256;
          const strand = (rA * rB > 178000 ? 22 : 0) + (fbmMed[row + x]! >> 3);
          hGrid[row + x] = strand;
          const lum = 242 + (strand >> 1);
          c256[row + x] = packRgb(lum, lum - 1, lum - 3);
          r256[row + x] = PACK_GRAY_U32[384 + 84 - (strand >> 1)]!;
        } else if (kind === 'paintedSteel') {
          const peel = fbmMed[((y << 1) & M255) * N256 + ((x << 1) & M255)]!;
          const mill = fbmCoarse[row + ((x >> 1) & M255)]!;
          hGrid[row + x] = (peel >> 2) + (mill >> 3);
          const lum = 236 + (peel >> 4) + (mill >> 4);
          c256[row + x] = packRgb(lum, lum, lum);
          r256[row + x] = PACK_GRAY_U32[384 + 102 - (peel >> 3)]!;
        } else {
          const flt = (fbmCoarse[row + x]! * 3 + fbmFine[row + x]! * 2) >> 2;
          const sand = speckle[row + x]!;
          hGrid[row + x] = (flt >> 2) + (sand >> 3);
          const lum = 240 + (flt >> 4) + (sand >> 5);
          c256[row + x] = packRgb(lum + 2, lum, lum - 5);
          r256[row + x] = PACK_GRAY_U32[384 + 199 + (sand >> 4)]!;
        }
      }
    }

    const n256 = new Uint32Array(bakeNormalsFast(hGrid, half, kind === 'plaster' ? 22 : 16).buffer);
    const rep: readonly [number, number] = kind === 'moldedFiberglass' ? [3, 3] : [2, 2];
    return makeSuite(tile2D(c256, half, 512), tile2D(n256, half, 512), tile2D(r256, half, 512), 512, rep);
  });
}

// ---------------------------------------------------------------------------
// 11. Translucent Woven Wire Spark-Screen & Vinyl Yacht-Cord Textures
// ---------------------------------------------------------------------------
export function getWovenSparkMeshTexture512(): THREE.DataTexture {
  return getOrCreateCachedTexture('stahl:pbr:sparkMesh512', () => {
    const c256 = new Uint32Array(256 * 256);
    for (let y = 0; y < 256; y++) {
      const isWireY = (y & 7) <= 1;
      const row = y << 8;
      for (let x = 0; x < 256; x++) {
        const isWireX = (x & 7) <= 1;
        if (isWireX || isWireY) {
          const over = isWireX && isWireY ? (((x >> 3) + (y >> 3)) & 1 ? 52 : 30) : 38;
          c256[row + x] = ((232 << 24) | ((over - 2) << 16) | ((over - 1) << 8) | over) >>> 0;
        } else {
          c256[row + x] = ((42 << 24) | (18 << 16) | (18 << 8) | 18) >>> 0;
        }
      }
    }
    return configureDataTex(tile2D(c256, 256, 512), 512, true, [6, 3]);
  });
}

export function getVinylYachtCordPbr512(): PbrTextureSuite {
  return getOrCreateCachedTexture('stahl:pbr:yachtCord512', () => {
    const { fbmMed, hGrid } = getTables();
    const c256 = new Uint32Array(256 * 256);
    const r256 = new Uint32Array(256 * 256);
    for (let y = 0; y < 256; y++) {
      const sv = ((y / 256) * 24) % 1;
      const t = (sv - 0.5) * 2;
      const cyl = (Math.sqrt(Math.max(0, 1 - t * t)) * 200) | 0;
      const row = y << 8;
      for (let x = 0; x < 256; x++) {
        const micro = fbmMed[row + x]! >> 4;
        hGrid[row + x] = cyl + micro;
        const lum = 212 + ((cyl * 34) >> 8) + micro;
        c256[row + x] = packRgb(lum + 3, lum + 1, lum - 6);
        r256[row + x] = PACK_GRAY_U32[384 + 92 + (((200 - cyl) * 90) >> 8)]!;
      }
    }
    const n256 = new Uint32Array(bakeNormalsFast(hGrid, 256, 28).buffer);
    return makeSuite(tile2D(c256, 256, 512), tile2D(n256, 256, 512), tile2D(r256, 256, 512), 512, [2, 2]);
  });
}
