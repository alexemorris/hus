import * as THREE from 'three';
import type {
  BathroomMetalMaterialPalette,
  BcDesignsBoatBathExteriorFinish,
  BrasswareFinishCode,
  FixtureMetalFinish,
} from './bathroom-spec-types.ts';

/**
 * Reusable PBR materials and pure in-memory `THREE.DataTexture` procedural surface maps
 * for the bathroom sanitaryware & brassware collection.
 *
 * Uses `Uint8Array` RGBA `DataTexture` buffers exclusively (zero DOM `document` access)
 * so materials work identically in browser WebGL, Node Vitest suites, and headless
 * snapshot tooling.
 */

export type WcSeatFinish = 'glossWhite' | 'antiqueOak' | 'walnut' | 'darkOak';

export interface BurnishedCopperMaterialPalette {
  readonly shell: THREE.MeshPhysicalMaterial;
  readonly plinth: THREE.MeshPhysicalMaterial;
}

export interface PaintedCabinetMaterialPalette {
  readonly cabinet: THREE.MeshPhysicalMaterial;
  readonly accentReveal: THREE.MeshStandardMaterial;
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/** Deterministic 2D integer hash in `[0, 1]`, periodic over `(periodX, periodY)` for seamless tiling. */
function hash2DPeriodic(ix: number, iy: number, periodX: number, periodY: number, seed: number): number {
  const wx = ((ix % periodX) + periodX) % periodX;
  const wy = ((iy % periodY) + periodY) % periodY;
  let h = (wx * 374761393 + wy * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}

/** Seamless tileable 2D value noise in `[0, 1]` over `[0..1) x [0..1)` UV coordinates. */
function seamlessNoise2D(u: number, v: number, freqX: number, freqY: number, seed: number): number {
  const x = u * freqX;
  const y = v * freqY;
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

function seamlessFbm2D(u: number, v: number, baseFreq: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let freq = baseFreq;
  for (let o = 0; o < octaves; o++) {
    sum += amp * seamlessNoise2D(u, v, freq, freq, seed + o * 97);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return norm > 0 ? sum / norm : 0.5;
}

function configureDataTexture(
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

// Cached Procedural DataTextures

let brushedMetalMapsCache: {
  readonly roughnessMap: THREE.DataTexture;
  readonly bumpMap: THREE.DataTexture;
} | null = null;

function getBrushedMetalMaps(): {
  readonly roughnessMap: THREE.DataTexture;
  readonly bumpMap: THREE.DataTexture;
} {
  if (brushedMetalMapsCache) return brushedMetalMapsCache;
  const w = 128;
  const h = 128;
  const roughData = new Uint8Array(w * h * 4);
  const bumpData = new Uint8Array(w * h * 4);

  for (let y = 0; y < h; y++) {
    const v = y / h;
    const rowGrain = hash2DPeriodic(0, y, 1, h, 401);
    const fineBand = Math.sin(v * Math.PI * 44) * 0.5 + 0.5;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      // Directional horizontal lathe/brush streaks with subtle longitudinal modulation
      const streak = seamlessNoise2D(u, v, 4, 64, 719);
      const micro = seamlessNoise2D(u, v, 16, 128, 1231);
      const brushVal = 0.52 * streak + 0.28 * rowGrain + 0.20 * micro;

      // Keep roughness multiplier high (218..255) so material.roughness sets exact mean finish
      const rByte = clampByte(220 + brushVal * 35);
      const bByte = clampByte(112 + (brushVal - 0.5) * 72 + (fineBand - 0.5) * 18);

      const idx = (y * w + x) * 4;
      roughData[idx] = rByte;
      roughData[idx + 1] = rByte;
      roughData[idx + 2] = rByte;
      roughData[idx + 3] = 255;

      bumpData[idx] = bByte;
      bumpData[idx + 1] = bByte;
      bumpData[idx + 2] = bByte;
      bumpData[idx + 3] = 255;
    }
  }

  brushedMetalMapsCache = {
    roughnessMap: configureDataTexture(roughData, w, h, 'bathroom.brushedMetal.roughness', false, 2, 2),
    bumpMap: configureDataTexture(bumpData, w, h, 'bathroom.brushedMetal.bump', false, 2, 2),
  };
  return brushedMetalMapsCache;
}

let knurlBumpMapCache: THREE.DataTexture | null = null;

/**
 * Fine 45-degree cross-hatched diamond knurling heightmap for Perrin & Rowe
 * Armstrong signature industrial collars, nuts & handshower grips.
 */
function getDiamondKnurlBumpMap(): THREE.DataTexture {
  if (knurlBumpMapCache) return knurlBumpMapCache;
  const w = 128;
  const h = 128;
  const data = new Uint8Array(w * h * 4);
  const cellsU = 32; // circumferential diamond pitch
  const cellsV = 8; // axial diamond pitch

  for (let y = 0; y < h; y++) {
    const v = (y / h) * cellsV;
    for (let x = 0; x < w; x++) {
      const u = (x / w) * cellsU;
      // 45° opposing helical V-grooves forming crisp raised diamond pyramids
      const d1 = Math.abs(((u + v) % 1 + 1) % 1 - 0.5) * 2; // 0 in groove, 1 on ridge
      const d2 = Math.abs(((u - v) % 1 + 1) % 1 - 0.5) * 2;
      const pyramid = Math.min(d1, d2);
      const sharpened = Math.pow(pyramid, 0.78);
      const byte = clampByte(24 + sharpened * 224);

      const idx = (y * w + x) * 4;
      data[idx] = byte;
      data[idx + 1] = byte;
      data[idx + 2] = byte;
      data[idx + 3] = 255;
    }
  }

  knurlBumpMapCache = configureDataTexture(data, w, h, 'bathroom.diamondKnurl.bump', false, 2, 1);
  return knurlBumpMapCache;
}

let mirostoneMapsCache: {
  readonly colorMap: THREE.DataTexture;
  readonly roughnessMap: THREE.DataTexture;
} | null = null;

/**
 * Veined Quartz / Mirostone (`MWFT SN`) procedural stone surface:
 * soft warm alabaster/off-white quartz matrix with delicate branching Carrara grey-taupe veining.
 */
function getMirostoneQuartzMaps(): {
  readonly colorMap: THREE.DataTexture;
  readonly roughnessMap: THREE.DataTexture;
} {
  if (mirostoneMapsCache) return mirostoneMapsCache;
  const w = 256;
  const h = 256;
  const colorData = new Uint8Array(w * h * 4);
  const roughData = new Uint8Array(w * h * 4);

  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;

      // Domain-warped diagonal mineral veins
      const warpX = seamlessFbm2D(u, v, 3, 4, 5101) - 0.5;
      const warpY = seamlessFbm2D(u, v, 3, 4, 6203) - 0.5;
      const wu = u + warpX * 0.22;
      const wv = v + warpY * 0.22;

      // Primary lazy diagonal quartz vein ribbon
      const phase1 = (wu * 1.5 + wv * 1.0) * Math.PI * 2;
      const ridge1 = 1 - Math.abs(Math.sin(phase1 * 0.5 + warpX * 2.1));
      const vein1 = Math.pow(Math.max(0, ridge1), 16);

      // Delicate secondary capillary vein
      const phase2 = (wu * 2.0 - wv * 1.5 + 0.37) * Math.PI * 2;
      const ridge2 = 1 - Math.abs(Math.sin(phase2 * 0.5 + warpY * 2.6));
      const vein2 = Math.pow(Math.max(0, ridge2), 24) * 0.65;

      // Subtle mineral clouding & fine quartz crystal grain
      const cloud = seamlessFbm2D(u, v, 5, 3, 7309);
      const speckle = seamlessNoise2D(u, v, 64, 64, 8419);

      const veinWeight = Math.min(1, vein1 * 0.85 + vein2);

      // Warm alabaster base (#f6f4ee) -> soft warm grey-taupe vein (#beb7ab)
      const baseR = 246 + (cloud - 0.5) * 6 + (speckle - 0.5) * 4;
      const baseG = 244 + (cloud - 0.5) * 6 + (speckle - 0.5) * 4;
      const baseB = 238 + (cloud - 0.5) * 7 + (speckle - 0.5) * 4;

      const r = clampByte(baseR * (1 - veinWeight) + 188 * veinWeight);
      const g = clampByte(baseG * (1 - veinWeight) + 182 * veinWeight);
      const b = clampByte(baseB * (1 - veinWeight) + 172 * veinWeight);

      const roughByte = clampByte(228 + veinWeight * 24 + (speckle - 0.5) * 10);

      const idx = (y * w + x) * 4;
      colorData[idx] = r;
      colorData[idx + 1] = g;
      colorData[idx + 2] = b;
      colorData[idx + 3] = 255;

      roughData[idx] = roughByte;
      roughData[idx + 1] = roughByte;
      roughData[idx + 2] = roughByte;
      roughData[idx + 3] = 255;
    }
  }

  mirostoneMapsCache = {
    colorMap: configureDataTexture(colorData, w, h, 'bathroom.mirostoneQuartz.color', true, 1, 1),
    roughnessMap: configureDataTexture(roughData, w, h, 'bathroom.mirostoneQuartz.roughness', false, 1, 1),
  };
  return mirostoneMapsCache;
}

const woodGrainMapsCache = new Map<'antiqueOak' | 'walnut', {
  readonly colorMap: THREE.DataTexture;
  readonly bumpMap: THREE.DataTexture;
}>();

function getWoodSeatMaps(variant: 'antiqueOak' | 'walnut'): {
  readonly colorMap: THREE.DataTexture;
  readonly bumpMap: THREE.DataTexture;
} {
  const cached = woodGrainMapsCache.get(variant);
  if (cached) return cached;

  const w = 128;
  const h = 128;
  const colorData = new Uint8Array(w * h * 4);
  const bumpData = new Uint8Array(w * h * 4);
  const isWalnut = variant === 'walnut';
  const baseRgb = isWalnut ? [96, 64, 44] : [156, 110, 68];

  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const cathedral = seamlessFbm2D(u, v, 3, 3, isWalnut ? 9103 : 9209);
      const fiber = seamlessNoise2D(u, v, 6, 64, isWalnut ? 9311 : 9413);
      const ring = Math.sin((v * 14 + cathedral * 2.4) * Math.PI * 2) * 0.5 + 0.5;
      const delta = (ring - 0.5) * 26 + (fiber - 0.5) * 16;

      const idx = (y * w + x) * 4;
      colorData[idx] = clampByte(baseRgb[0]! + delta);
      colorData[idx + 1] = clampByte(baseRgb[1]! + delta * 0.82);
      colorData[idx + 2] = clampByte(baseRgb[2]! + delta * 0.65);
      colorData[idx + 3] = 255;

      const bVal = clampByte(132 + (fiber - 0.5) * 48 + (ring - 0.5) * 22);
      bumpData[idx] = bVal;
      bumpData[idx + 1] = bVal;
      bumpData[idx + 2] = bVal;
      bumpData[idx + 3] = 255;
    }
  }

  const maps = {
    colorMap: configureDataTexture(colorData, w, h, `bathroom.wcSeat.${variant}.color`, true, 2, 2),
    bumpMap: configureDataTexture(bumpData, w, h, `bathroom.wcSeat.${variant}.bump`, false, 2, 2),
  };
  woodGrainMapsCache.set(variant, maps);
  return maps;
}

let cabinetBrushBumpCache: THREE.DataTexture | null = null;
function getPaintedTimberBumpMap(): THREE.DataTexture {
  if (cabinetBrushBumpCache) return cabinetBrushBumpCache;
  const w = 128;
  const h = 128;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const grain = seamlessNoise2D(u, v, 8, 64, 5501);
      const pore = seamlessNoise2D(u, v, 16, 96, 5623);
      const byte = clampByte(128 + (grain - 0.5) * 34 + (pore - 0.5) * 20);
      const idx = (y * w + x) * 4;
      data[idx] = byte;
      data[idx + 1] = byte;
      data[idx + 2] = byte;
      data[idx + 3] = 255;
    }
  }
  cabinetBrushBumpCache = configureDataTexture(data, w, h, 'bathroom.paintedJoinery.bump', false, 2, 2);
  return cabinetBrushBumpCache;
}

let tissueCrepeBumpCache: THREE.DataTexture | null = null;
function getTissueCrepeBumpMap(): THREE.DataTexture {
  if (tissueCrepeBumpCache) return tissueCrepeBumpCache;
  const w = 64;
  const h = 64;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const emboss = seamlessNoise2D(u, v, 32, 32, 7717);
      const byte = clampByte(128 + (emboss - 0.5) * 64);
      const idx = (y * w + x) * 4;
      data[idx] = byte;
      data[idx + 1] = byte;
      data[idx + 2] = byte;
      data[idx + 3] = 255;
    }
  }
  tissueCrepeBumpCache = configureDataTexture(data, w, h, 'bathroom.tissueCrepe.bump', false, 3, 2);
  return tissueCrepeBumpCache;
}

// Cached Sanitaryware & Brassware Materials

let agedBrassPatinaCache: { colorMap: THREE.DataTexture; roughnessMap: THREE.DataTexture } | null = null;
function getAgedBrassPatinaMaps(): { colorMap: THREE.DataTexture; roughnessMap: THREE.DataTexture } {
  if (agedBrassPatinaCache) return agedBrassPatinaCache;
  const w = 128;
  const h = 128;
  const colorData = new Uint8Array(w * h * 4);
  const roughData = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const cloud = seamlessFbm2D(u, v, 3, 3, 6113);
      const brush = seamlessNoise2D(u, v, 6, 36, 6271);
      // Warm antique patinated English living brass (#8B6932 .. #AA8443)
      const patina = (cloud - 0.5) * 28 + (brush - 0.5) * 12;
      const idx = (y * w + x) * 4;
      colorData[idx] = clampByte(156 + patina);
      colorData[idx + 1] = clampByte(120 + patina * 0.84);
      colorData[idx + 2] = clampByte(58 + patina * 0.52);
      colorData[idx + 3] = 255;

      const rByte = clampByte(196 + (0.5 - cloud) * 34 + (brush - 0.5) * 18);
      roughData[idx] = rByte;
      roughData[idx + 1] = rByte;
      roughData[idx + 2] = rByte;
      roughData[idx + 3] = 255;
    }
  }
  agedBrassPatinaCache = {
    colorMap: configureDataTexture(colorData, w, h, 'bathroom.brass.AB.color', true, 2, 2),
    roughnessMap: configureDataTexture(roughData, w, h, 'bathroom.brass.AB.roughness', false, 2, 2),
  };
  return agedBrassPatinaCache;
}

const brassPaletteCache = new Map<BrasswareFinishCode, BathroomMetalMaterialPalette>();
let darkShadowMatCache: THREE.MeshStandardMaterial | null = null;

function getSharedDarkShadowMaterial(): THREE.MeshStandardMaterial {
  if (!darkShadowMatCache) {
    darkShadowMatCache = new THREE.MeshStandardMaterial({
      name: 'bathroom.darkShadowRecess',
      color: 0x1a1917,
      roughness: 0.72,
      metalness: 0.18,
    });
  }
  return darkShadowMatCache;
}

/**
 * Returns the cached PBR metal palette (`primary`, `knurled`, `darkShadow`) for a
 * Perrin & Rowe / coordinated metalware finish code (`'SB'`, `'PF'`, `'BR'`).
 */
export function getBathroomBrassMaterials(finish: BrasswareFinishCode): BathroomMetalMaterialPalette {
  const existing = brassPaletteCache.get(finish);
  if (existing) return existing;

  const brushed = getBrushedMetalMaps();
  const knurlBump = getDiamondKnurlBumpMap();
  const darkShadow = getSharedDarkShadowMaterial();

  let primary: THREE.MeshPhysicalMaterial;
  let knurled: THREE.MeshPhysicalMaterial;

  switch (finish) {
    case 'SB': {
      // Satin Brass — Perrin & Rowe unlacquered living brushed aged brass
      primary = new THREE.MeshPhysicalMaterial({
        name: 'bathroom.brass.SB.primary',
        color: 0xb89146,
        metalness: 0.88,
        roughness: 0.33,
        roughnessMap: brushed.roughnessMap,
        bumpMap: brushed.bumpMap,
        bumpScale: 0.0007,
        clearcoat: 0.05,
        clearcoatRoughness: 0.28,
      });
      knurled = new THREE.MeshPhysicalMaterial({
        name: 'bathroom.brass.SB.knurled',
        color: 0xb48c42,
        metalness: 0.88,
        roughness: 0.41,
        bumpMap: knurlBump,
        bumpScale: 0.0025,
        clearcoat: 0.04,
        clearcoatRoughness: 0.34,
      });
      break;
    }
    case 'PF': {
      // Pewter — Perrin & Rowe brushed nickel / warm pewter
      primary = new THREE.MeshPhysicalMaterial({
        name: 'bathroom.brass.PF.primary',
        color: 0xb5b3ac,
        metalness: 0.90,
        roughness: 0.29,
        roughnessMap: brushed.roughnessMap,
        bumpMap: brushed.bumpMap,
        bumpScale: 0.0006,
        clearcoat: 0.06,
        clearcoatRoughness: 0.24,
      });
      knurled = new THREE.MeshPhysicalMaterial({
        name: 'bathroom.brass.PF.knurled',
        color: 0xaeaca5,
        metalness: 0.90,
        roughness: 0.37,
        bumpMap: knurlBump,
        bumpScale: 0.0025,
        clearcoat: 0.04,
        clearcoatRoughness: 0.30,
      });
      break;
    }
    case 'BR': {
      // Polished Brass — Perrin & Rowe unlacquered mirror-bright solid brass
      primary = new THREE.MeshPhysicalMaterial({
        name: 'bathroom.brass.BR.primary',
        color: 0xe0b958,
        metalness: 0.96,
        roughness: 0.11,
        clearcoat: 0.18,
        clearcoatRoughness: 0.08,
      });
      knurled = new THREE.MeshPhysicalMaterial({
        name: 'bathroom.brass.BR.knurled',
        color: 0xd9b150,
        metalness: 0.95,
        roughness: 0.19,
        bumpMap: knurlBump,
        bumpScale: 0.0025,
        clearcoat: 0.12,
        clearcoatRoughness: 0.14,
      });
      break;
    }
    case 'AB': {
      // Aged Brass — warm antique patinated ochre-bronze living solid brass
      const patina = getAgedBrassPatinaMaps();
      primary = new THREE.MeshPhysicalMaterial({
        name: 'bathroom.brass.AB.primary',
        color: 0xffffff,
        map: patina.colorMap,
        metalness: 0.87,
        roughness: 0.34,
        roughnessMap: patina.roughnessMap,
        bumpMap: brushed.bumpMap,
        bumpScale: 0.0008,
        clearcoat: 0.07,
        clearcoatRoughness: 0.34,
      });
      knurled = new THREE.MeshPhysicalMaterial({
        name: 'bathroom.brass.AB.knurled',
        color: 0x947137,
        metalness: 0.86,
        roughness: 0.42,
        bumpMap: knurlBump,
        bumpScale: 0.0025,
        clearcoat: 0.05,
        clearcoatRoughness: 0.38,
      });
      break;
    }
    case 'BN': {
      // Silver Nickel — Lefroy Brooks warm satin/brushed silver nickel (harmonising with P&R PF Pewter)
      primary = new THREE.MeshPhysicalMaterial({
        name: 'bathroom.brass.BN.primary',
        color: 0xc6c4bc,
        metalness: 0.92,
        roughness: 0.23,
        roughnessMap: brushed.roughnessMap,
        bumpMap: brushed.bumpMap,
        bumpScale: 0.0005,
        clearcoat: 0.09,
        clearcoatRoughness: 0.18,
      });
      knurled = new THREE.MeshPhysicalMaterial({
        name: 'bathroom.brass.BN.knurled',
        color: 0xbdbbb2,
        metalness: 0.91,
        roughness: 0.31,
        bumpMap: knurlBump,
        bumpScale: 0.0024,
        clearcoat: 0.06,
        clearcoatRoughness: 0.24,
      });
      break;
    }
    case 'CP': {
      // Polished Chrome — cool mirror-bright electroplated chrome
      primary = new THREE.MeshPhysicalMaterial({
        name: 'bathroom.brass.CP.primary',
        color: 0xe6eaee,
        metalness: 0.96,
        roughness: 0.09,
        clearcoat: 0.14,
        clearcoatRoughness: 0.06,
      });
      knurled = new THREE.MeshPhysicalMaterial({
        name: 'bathroom.brass.CP.knurled',
        color: 0xdfe4e9,
        metalness: 0.95,
        roughness: 0.17,
        bumpMap: knurlBump,
        bumpScale: 0.0025,
        clearcoat: 0.10,
        clearcoatRoughness: 0.12,
      });
      break;
    }
    case 'NI': {
      // Polished Nickel — warm champagne-silver mirror nickel
      primary = new THREE.MeshPhysicalMaterial({
        name: 'bathroom.brass.NI.primary',
        color: 0xdcd7cc,
        metalness: 0.94,
        roughness: 0.12,
        clearcoat: 0.12,
        clearcoatRoughness: 0.08,
      });
      knurled = new THREE.MeshPhysicalMaterial({
        name: 'bathroom.brass.NI.knurled',
        color: 0xd4cfc3,
        metalness: 0.93,
        roughness: 0.20,
        bumpMap: knurlBump,
        bumpScale: 0.0025,
        clearcoat: 0.09,
        clearcoatRoughness: 0.14,
      });
      break;
    }
    case 'BZ': {
      // English Bronze — deep oil-rubbed gunmetal bronze w/ warm brass highlights
      primary = new THREE.MeshPhysicalMaterial({
        name: 'bathroom.brass.BZ.primary',
        color: 0x46382d,
        metalness: 0.84,
        roughness: 0.36,
        roughnessMap: brushed.roughnessMap,
        bumpMap: brushed.bumpMap,
        bumpScale: 0.0007,
        clearcoat: 0.06,
        clearcoatRoughness: 0.32,
      });
      knurled = new THREE.MeshPhysicalMaterial({
        name: 'bathroom.brass.BZ.knurled',
        color: 0x524133,
        metalness: 0.84,
        roughness: 0.43,
        bumpMap: knurlBump,
        bumpScale: 0.0025,
        clearcoat: 0.04,
        clearcoatRoughness: 0.36,
      });
      break;
    }
    case 'IG': {
      // English Gold — rich warm 24ct polished gold
      primary = new THREE.MeshPhysicalMaterial({
        name: 'bathroom.brass.IG.primary',
        color: 0xd4a647,
        metalness: 0.93,
        roughness: 0.15,
        clearcoat: 0.16,
        clearcoatRoughness: 0.09,
      });
      knurled = new THREE.MeshPhysicalMaterial({
        name: 'bathroom.brass.IG.knurled',
        color: 0xcc9d3f,
        metalness: 0.92,
        roughness: 0.23,
        bumpMap: knurlBump,
        bumpScale: 0.0025,
        clearcoat: 0.11,
        clearcoatRoughness: 0.15,
      });
      break;
    }
  }

  const palette: BathroomMetalMaterialPalette = { primary, knurled, darkShadow };
  brassPaletteCache.set(finish, palette);
  return palette;
}

let blackPorcelainCache: THREE.MeshPhysicalMaterial | null = null;
/** High-gloss ebonised black vitreous porcelain lever & index material. */
export function getBlackPorcelainMaterial(): THREE.MeshPhysicalMaterial {
  if (!blackPorcelainCache) {
    blackPorcelainCache = new THREE.MeshPhysicalMaterial({
      name: 'bathroom.blackPorcelain',
      color: 0x16171a,
      metalness: 0.02,
      roughness: 0.11,
      clearcoat: 0.88,
      clearcoatRoughness: 0.06,
      reflectivity: 0.65,
    });
  }
  return blackPorcelainCache;
}

let vitreousChinaCache: THREE.MeshPhysicalMaterial | null = null;
/** High-fire glazed English Vitreous China (`Lefroy Brooks Charterhouse` WC & `RUB-W` basin). */
export function getVitreousChinaMaterial(): THREE.MeshPhysicalMaterial {
  if (!vitreousChinaCache) {
    vitreousChinaCache = new THREE.MeshPhysicalMaterial({
      name: 'bathroom.vitreousChina',
      color: 0xf7f6f2,
      metalness: 0.0,
      roughness: 0.10,
      clearcoat: 0.85,
      clearcoatRoughness: 0.07,
      reflectivity: 0.65,
    });
  }
  return vitreousChinaCache;
}

let antiqueWhiteCeramicCache: THREE.MeshPhysicalMaterial | null = null;
/** Warm heritage Thomas Crapper Antique White glazed vitreous china / fireclay (`#F2EDE0`). */
export function getAntiqueWhiteCeramicMaterial(): THREE.MeshPhysicalMaterial {
  if (!antiqueWhiteCeramicCache) {
    antiqueWhiteCeramicCache = new THREE.MeshPhysicalMaterial({
      name: 'bathroom.antiqueWhiteCeramic',
      color: 0xf2ede0,
      metalness: 0.0,
      roughness: 0.11,
      clearcoat: 0.86,
      clearcoatRoughness: 0.07,
      reflectivity: 0.65,
    });
  }
  return antiqueWhiteCeramicCache;
}

let acrymiteWhiteCache: THREE.MeshPhysicalMaterial | null = null;
/** Crisp gloss-white reinforced `Acrymite` interior shell of the BC Designs Boat Bath. */
export function getAcrymiteWhiteMaterial(): THREE.MeshPhysicalMaterial {
  if (!acrymiteWhiteCache) {
    acrymiteWhiteCache = new THREE.MeshPhysicalMaterial({
      name: 'bathroom.acrymiteGlossWhite',
      color: 0xfafaf7,
      metalness: 0.0,
      roughness: 0.08,
      clearcoat: 0.92,
      clearcoatRoughness: 0.05,
      reflectivity: 0.7,
    });
  }
  return acrymiteWhiteCache;
}

let burnishedCopperColorMapCache: THREE.DataTexture | null = null;

function getBurnishedCopperColorMap(): THREE.DataTexture {
  if (burnishedCopperColorMapCache) return burnishedCopperColorMapCache;
  const w = 256;
  const h = 256;
  const colorData = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const cloud = seamlessFbm2D(u, v, 3, 3, 2111);
      const sweep = seamlessNoise2D(u, v, 5, 18, 4099);
      // Barely-there warm tonal depth (±3%) so specular copper mirror sheen stays crisp and glossy
      const warmShift = (cloud - 0.5) * 14 + (sweep - 0.5) * 5;
      const idx = (y * w + x) * 4;
      colorData[idx] = clampByte(250 + warmShift * 0.85);
      colorData[idx + 1] = clampByte(247 + warmShift * 0.95);
      colorData[idx + 2] = clampByte(244 + warmShift * 1.05);
      colorData[idx + 3] = 255;
    }
  }
  burnishedCopperColorMapCache = configureDataTexture(
    colorData,
    w,
    h,
    'bathroom.burnishedCopper.color',
    true,
    2,
    1
  );
  return burnishedCopperColorMapCache;
}

let copperMaterialsCache: BurnishedCopperMaterialPalette | null = null;
/** High-lustre burnished mirror-copper exterior hull & warm polished copper plinth for BC Designs Boat Bath. */

export function resolveFixtureFinishToBrassCode(finish: FixtureMetalFinish): BrasswareFinishCode {
  switch (finish) {
    case 'antiqueBrass':
      return 'AB';
    case 'polishedNickel':
      return 'NI';
    case 'bronze':
      return 'BZ';
    default:
      return finish;
  }
}

const boatBathTinCache: { palette: BurnishedCopperMaterialPalette | null } = { palette: null };
const boatBathBrassCache: { palette: BurnishedCopperMaterialPalette | null } = { palette: null };
const boatBathPaintedCache = new Map<string, BurnishedCopperMaterialPalette>();

/**
 * Returns exterior hull & moulded plinth PBR materials for the BC Designs Boat Bath.
 * Returns `getBurnishedCopperMaterials()` bit-for-bit when `exteriorFinish` is omitted or `'copper'`.
 */
export function getBoatBathExteriorMaterials(
  exteriorFinish: BcDesignsBoatBathExteriorFinish = 'copper',
  exteriorPaintColor?: THREE.ColorRepresentation
): BurnishedCopperMaterialPalette {
  if (exteriorFinish === 'copper') {
    return getBurnishedCopperMaterials();
  }
  const brushed = getBrushedMetalMaps();
  if (exteriorFinish === 'tin') {
    if (!boatBathTinCache.palette) {
      const colorModMap = getBurnishedCopperColorMap();
      boatBathTinCache.palette = {
        shell: new THREE.MeshPhysicalMaterial({
          name: 'bathroom.boatBath.tinShell',
          color: 0xc2c3be,
          map: colorModMap,
          roughnessMap: brushed.roughnessMap,
          bumpMap: brushed.bumpMap,
          bumpScale: 0.0006,
          metalness: 0.91,
          roughness: 0.24,
          clearcoat: 0.18,
          clearcoatRoughness: 0.16,
        }),
        plinth: new THREE.MeshPhysicalMaterial({
          name: 'bathroom.boatBath.tinPlinth',
          color: 0xb1b2ad,
          map: colorModMap,
          roughnessMap: brushed.roughnessMap,
          bumpMap: brushed.bumpMap,
          bumpScale: 0.0006,
          metalness: 0.91,
          roughness: 0.27,
          clearcoat: 0.16,
          clearcoatRoughness: 0.18,
        }),
      };
    }
    return boatBathTinCache.palette;
  }
  if (exteriorFinish === 'polishedBrass') {
    if (!boatBathBrassCache.palette) {
      const br = getBathroomBrassMaterials('BR');
      boatBathBrassCache.palette = {
        shell: br.primary,
        plinth: new THREE.MeshPhysicalMaterial({
          name: 'bathroom.boatBath.polishedBrassPlinth',
          color: 0xd4ad4e,
          metalness: 0.95,
          roughness: 0.14,
          clearcoat: 0.18,
          clearcoatRoughness: 0.10,
        }),
      };
    }
    return boatBathBrassCache.palette;
  }
  // 'painted'
  const col = new THREE.Color(exteriorPaintColor ?? 0x3b444b);
  const hexKey = col.getHexString();
  const cached = boatBathPaintedCache.get(hexKey);
  if (cached) return cached;
  const plinthCol = col.clone().multiplyScalar(0.92);
  const painted: BurnishedCopperMaterialPalette = {
    shell: new THREE.MeshPhysicalMaterial({
      name: `bathroom.boatBath.paintedShell.${hexKey}`,
      color: col,
      bumpMap: getPaintedTimberBumpMap(),
      bumpScale: 0.0005,
      metalness: 0.02,
      roughness: 0.34,
      clearcoat: 0.22,
      clearcoatRoughness: 0.26,
    }),
    plinth: new THREE.MeshPhysicalMaterial({
      name: `bathroom.boatBath.paintedPlinth.${hexKey}`,
      color: plinthCol,
      bumpMap: getPaintedTimberBumpMap(),
      bumpScale: 0.0005,
      metalness: 0.02,
      roughness: 0.36,
      clearcoat: 0.20,
      clearcoatRoughness: 0.28,
    }),
  };
  boatBathPaintedCache.set(hexKey, painted);
  return painted;
}

export function getBurnishedCopperMaterials(): BurnishedCopperMaterialPalette {
  if (copperMaterialsCache) return copperMaterialsCache;
  const colorModMap = getBurnishedCopperColorMap();
  const shell = new THREE.MeshPhysicalMaterial({
    name: 'bathroom.copperBurnishedShell',
    color: 0xb96539,
    map: colorModMap,
    metalness: 0.90,
    roughness: 0.13,
    clearcoat: 0.42,
    clearcoatRoughness: 0.08,
  });
  const plinth = new THREE.MeshPhysicalMaterial({
    name: 'bathroom.copperPatinatedPlinth',
    color: 0xa4562e,
    map: colorModMap,
    metalness: 0.90,
    roughness: 0.13,
    clearcoat: 0.42,
    clearcoatRoughness: 0.08,
  });
  copperMaterialsCache = { shell, plinth };
  return copperMaterialsCache;
}

let mirostoneMaterialCache: THREE.MeshPhysicalMaterial | null = null;
/** Veined Quartz / Mirostone (`MWFT SN`) 20mm vanity countertop & rear splashback upstand. */
export function getMirostoneQuartzMaterial(): THREE.MeshPhysicalMaterial {
  if (!mirostoneMaterialCache) {
    const maps = getMirostoneQuartzMaps();
    mirostoneMaterialCache = new THREE.MeshPhysicalMaterial({
      name: 'bathroom.mirostoneQuartzMWFTSN',
      color: 0xffffff,
      map: maps.colorMap,
      roughnessMap: maps.roughnessMap,
      metalness: 0.0,
      roughness: 0.20,
      clearcoat: 0.35,
      clearcoatRoughness: 0.12,
    });
  }
  return mirostoneMaterialCache;
}

const wcSeatMatCache = new Map<WcSeatFinish, THREE.MeshPhysicalMaterial>();
export function getWcSeatMaterial(seatFinish: WcSeatFinish): THREE.MeshPhysicalMaterial {
  const existing = wcSeatMatCache.get(seatFinish);
  if (existing) return existing;

  let mat: THREE.MeshPhysicalMaterial;
  if (seatFinish === 'glossWhite') {
    mat = new THREE.MeshPhysicalMaterial({
      name: 'bathroom.wcSeat.glossWhite',
      color: 0xf8f7f3,
      metalness: 0.0,
      roughness: 0.11,
      clearcoat: 0.82,
      clearcoatRoughness: 0.08,
    });
  } else if (seatFinish === 'darkOak') {
    const darkOak = getDarkOakVeneerMaterials();
    const seatColorMap = darkOak.veneer.map!.clone();
    seatColorMap.name = 'bathroom.wcSeat.darkOak.color';
    seatColorMap.repeat.set(1, 1);
    seatColorMap.needsUpdate = true;
    const seatBumpMap = darkOak.veneer.bumpMap!.clone();
    seatBumpMap.name = 'bathroom.wcSeat.darkOak.bump';
    seatBumpMap.repeat.set(1, 1);
    seatBumpMap.needsUpdate = true;
    const seatRoughMap = darkOak.veneer.roughnessMap!.clone();
    seatRoughMap.name = 'bathroom.wcSeat.darkOak.roughness';
    seatRoughMap.repeat.set(1, 1);
    seatRoughMap.needsUpdate = true;
    mat = new THREE.MeshPhysicalMaterial({
      name: 'bathroom.wcSeat.darkOak',
      color: 0xffffff,
      map: seatColorMap,
      bumpMap: seatBumpMap,
      bumpScale: 0.0007,
      roughnessMap: seatRoughMap,
      metalness: 0.0,
      roughness: 0.34,
      clearcoat: 0.38,
      clearcoatRoughness: 0.2,
    });
  } else {
    const maps = getWoodSeatMaps(seatFinish);
    mat = new THREE.MeshPhysicalMaterial({
      name: `bathroom.wcSeat.${seatFinish}`,
      color: 0xffffff,
      map: maps.colorMap,
      bumpMap: maps.bumpMap,
      bumpScale: 0.0009,
      metalness: 0.0,
      roughness: seatFinish === 'walnut' ? 0.28 : 0.33,
      clearcoat: 0.42,
      clearcoatRoughness: 0.18,
    });
  }
  wcSeatMatCache.set(seatFinish, mat);
  return mat;
}

let wcWaterMatCache: THREE.MeshPhysicalMaterial | null = null;
export function getWcWaterSealMaterial(): THREE.MeshPhysicalMaterial {
  if (!wcWaterMatCache) {
    wcWaterMatCache = new THREE.MeshPhysicalMaterial({
      name: 'bathroom.wcWaterSeal',
      color: 0xdceef2,
      metalness: 0.0,
      roughness: 0.04,
      transmission: 0,
      transparent: true,
      opacity: 0.74,
      ior: 1.333,
      clearcoat: 1.0,
      clearcoatRoughness: 0.03,
    });
  }
  return wcWaterMatCache;
}

let tissuePaperMatCache: THREE.MeshStandardMaterial | null = null;
let cardboardCoreMatCache: THREE.MeshStandardMaterial | null = null;

export function getTissuePaperMaterial(): THREE.MeshStandardMaterial {
  if (!tissuePaperMatCache) {
    tissuePaperMatCache = new THREE.MeshStandardMaterial({
      name: 'bathroom.ivoryTissuePaper',
      color: 0xf6f2e8,
      roughness: 0.86,
      metalness: 0.0,
      bumpMap: getTissueCrepeBumpMap(),
      bumpScale: 0.0012,
      side: THREE.DoubleSide,
    });
  }
  return tissuePaperMatCache;
}

export function getCardboardCoreMaterial(): THREE.MeshStandardMaterial {
  if (!cardboardCoreMatCache) {
    cardboardCoreMatCache = new THREE.MeshStandardMaterial({
      name: 'bathroom.tissueCardboardCore',
      color: 0xb59874,
      roughness: 0.88,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
  }
  return cardboardCoreMatCache;
}

const cabinetMatCache = new Map<string, PaintedCabinetMaterialPalette>();
/** Heritage eggshell painted timber & shadow-reveal accent materials for In-Frame Shaker cabinetry. */
export function getPaintedShakerCabinetMaterials(
  cabinetColorHex: number,
  frameAccentColorHex?: number
): PaintedCabinetMaterialPalette {
  const derivedAccentHex =
    frameAccentColorHex ??
    new THREE.Color(cabinetColorHex).multiplyScalar(0.68).getHex();
  const key = `${cabinetColorHex.toString(16)}:${derivedAccentHex.toString(16)}`;
  const cached = cabinetMatCache.get(key);
  if (cached) return cached;

  const bump = getPaintedTimberBumpMap();
  const cabinet = new THREE.MeshPhysicalMaterial({
    name: `bathroom.campdenShakerPaint.${cabinetColorHex.toString(16)}`,
    color: cabinetColorHex,
    roughness: 0.42,
    metalness: 0.0,
    bumpMap: bump,
    bumpScale: 0.0005,
    clearcoat: 0.08,
    clearcoatRoughness: 0.45,
  });
  const accentReveal = new THREE.MeshStandardMaterial({
    name: `bathroom.campdenShakerReveal.${derivedAccentHex.toString(16)}`,
    color: derivedAccentHex,
    roughness: 0.56,
    metalness: 0.0,
  });

  const palette: PaintedCabinetMaterialPalette = { cabinet, accentReveal };
  cabinetMatCache.set(key, palette);
  return palette;
}

// Shared Geometry & Scene-Graph Invariant Helpers

/**
 * Enforces all sanitaryware scene-graph invariants across `root`:
 * - `root.userData.tradeCategory` set cleanly (`'sanitary'` or `'plumbing'`).
 * - Every `BufferGeometry` has a valid `boundingSphere`.
 * - Fine-detail meshes (`boundingSphere.radius < 0.08`) receive `lodTier = 'high'`
 *   and `lodMaxDistance = 12` with `castShadow = false`.
 */
export function finalizeSanitaryGroup(
  root: THREE.Group,
  defaultTradeCategory: 'sanitary' | 'plumbing'
): THREE.Group {
  if (!root.userData['tradeCategory']) {
    root.userData['tradeCategory'] = defaultTradeCategory;
  }
  root.traverse((node) => {
    if ((node instanceof THREE.Mesh || node instanceof THREE.Group) && !node.name) {
      node.name = `${root.name}.part`;
    }
    if (node instanceof THREE.Mesh) {
      const geo = node.geometry as THREE.BufferGeometry;
      if (!geo.boundingSphere) {
        geo.computeBoundingSphere();
      }
      const radius = geo.boundingSphere?.radius ?? 0;
      node.receiveShadow = true;
      if (radius < 0.08) {
        node.userData['lodTier'] = 'high';
        node.userData['lodMaxDistance'] = 12;
        node.castShadow = false;
      } else {
        node.castShadow = true;
      }
    }
  });
  return root;
}

// Smoked Dark Oak Veneer, Carrara Marble & Waffle Textiles

export interface DarkOakVeneerMaterialPalette {
  readonly veneer: THREE.MeshPhysicalMaterial;
  readonly panelField: THREE.MeshPhysicalMaterial;
  readonly shadowReveal: THREE.MeshStandardMaterial;
}

let darkOakVeneerCache: DarkOakVeneerMaterialPalette | null = null;

/**
 * Rich smoked dark-stained European oak veneer PBR palette:
 * deep umber-espresso heartwood (#3e2c1e .. #523b29) with warm bronze-brown cathedral grain,
 * open-pore bump relief, and hand-rubbed satin lacquer sheen (~0.46 roughness).
 */
export function getDarkOakVeneerMaterials(): DarkOakVeneerMaterialPalette {
  if (darkOakVeneerCache) return darkOakVeneerCache;

  const w = 256;
  const h = 256;
  const colorData = new Uint8Array(w * h * 4);
  const bumpData = new Uint8Array(w * h * 4);
  const roughData = new Uint8Array(w * h * 4);

  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      // Straight-grained quarter-sawn fumed/smoked English oak (#38281d .. #463325):
      // fine longitudinal vessel pores along v with minimal lateral drift and delicate medullary rays.
      const subtleDrift = seamlessFbm2D(u, v, 2, 2, 14107);
      const fineFiber = seamlessNoise2D(u, v, 36, 128, 14221);
      const openPore = seamlessNoise2D(u, v, 56, 96, 14519);
      const medullary = seamlessNoise2D(u, v, 44, 16, 14347);
      const straightRing =
        Math.sin((u * 22.0 + (subtleDrift - 0.5) * 0.55) * Math.PI * 2) * 0.5 + 0.5;
      const poreGroove = Math.pow(Math.max(0, 1 - openPore * 1.15), 2.4);
      const rayFleck = Math.pow(medullary, 3.2);

      const grainLift =
        (straightRing - 0.5) * 9 +
        (fineFiber - 0.5) * 11 -
        poreGroove * 13 +
        rayFleck * 7;
      const idx = (y * w + x) * 4;
      colorData[idx] = clampByte(63 + grainLift * 0.98);
      colorData[idx + 1] = clampByte(45 + grainLift * 0.76);
      colorData[idx + 2] = clampByte(33 + grainLift * 0.56);
      colorData[idx + 3] = 255;

      const bByte = clampByte(132 + (fineFiber - 0.5) * 36 - poreGroove * 44);
      bumpData[idx] = bByte;
      bumpData[idx + 1] = bByte;
      bumpData[idx + 2] = bByte;
      bumpData[idx + 3] = 255;

      const rByte = clampByte(218 + poreGroove * 26 + (1 - fineFiber) * 10);
      roughData[idx] = rByte;
      roughData[idx + 1] = rByte;
      roughData[idx + 2] = rByte;
      roughData[idx + 3] = 255;
    }
  }

  const colorMap = configureDataTexture(colorData, w, h, 'bathroom.darkOakVeneer.color', true, 1.5, 1.5);
  const bumpMap = configureDataTexture(bumpData, w, h, 'bathroom.darkOakVeneer.bump', false, 1.5, 1.5);
  const roughnessMap = configureDataTexture(roughData, w, h, 'bathroom.darkOakVeneer.roughness', false, 1.5, 1.5);

  const veneer = new THREE.MeshPhysicalMaterial({
    name: 'bathroom.darkOakVeneer',
    color: 0xffffff,
    map: colorMap,
    bumpMap,
    bumpScale: 0.0014,
    roughnessMap,
    roughness: 0.47,
    metalness: 0.0,
    clearcoat: 0.14,
    clearcoatRoughness: 0.38,
  });

  const panelField = new THREE.MeshPhysicalMaterial({
    name: 'bathroom.darkOakVeneer.panelField',
    color: 0xf4ece4,
    map: colorMap,
    bumpMap,
    bumpScale: 0.0016,
    roughnessMap,
    roughness: 0.50,
    metalness: 0.0,
    clearcoat: 0.12,
    clearcoatRoughness: 0.42,
  });

  const shadowReveal = new THREE.MeshStandardMaterial({
    name: 'bathroom.darkOakVeneer.shadowReveal',
    color: 0x22170f,
    roughness: 0.68,
    metalness: 0.0,
  });

  darkOakVeneerCache = { veneer, panelField, shadowReveal };
  return darkOakVeneerCache;
}

let honedCarraraCache: THREE.MeshPhysicalMaterial | null = null;

/**
 * Honed Italian Bianco Carrara marble countertop & shaped heritage splashback upstand
 * (cool-warm alabaster white ground with feathery soft grey mineral veins).
 */
export function getHonedCarraraMarbleMaterial(): THREE.MeshPhysicalMaterial {
  if (honedCarraraCache) return honedCarraraCache;

  const w = 256;
  const h = 256;
  const colorData = new Uint8Array(w * h * 4);
  const roughData = new Uint8Array(w * h * 4);

  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const wx = seamlessFbm2D(u, v, 3, 4, 15101) - 0.5;
      const wy = seamlessFbm2D(u, v, 3, 4, 15217) - 0.5;
      const p1 = ((u + wx * 0.28) * 2.0 + (v + wy * 0.28) * 1.0) * Math.PI * 2;
      const p2 = ((u + wx * 0.22) * 3.0 - (v + wy * 0.22) * 2.0 + 0.41) * Math.PI * 2;
      const veinPrimary = Math.pow(Math.max(0, 1 - Math.abs(Math.sin(p1 * 0.5 + wx * 2.4))), 11);
      const veinFine = Math.pow(Math.max(0, 1 - Math.abs(Math.sin(p2 * 0.5 + wy * 3.0))), 20) * 0.72;
      const cloud = seamlessFbm2D(u, v, 5, 3, 15331);
      const wVein = Math.min(1, veinPrimary * 0.82 + veinFine + Math.max(0, cloud - 0.58) * 0.35);

      const baseR = 243 + (cloud - 0.5) * 8;
      const baseG = 242 + (cloud - 0.5) * 8;
      const baseB = 239 + (cloud - 0.5) * 8;

      const idx = (y * w + x) * 4;
      colorData[idx] = clampByte(baseR * (1 - wVein) + 162 * wVein);
      colorData[idx + 1] = clampByte(baseG * (1 - wVein) + 165 * wVein);
      colorData[idx + 2] = clampByte(baseB * (1 - wVein) + 170 * wVein);
      colorData[idx + 3] = 255;

      const rByte = clampByte(224 + wVein * 24);
      roughData[idx] = rByte;
      roughData[idx + 1] = rByte;
      roughData[idx + 2] = rByte;
      roughData[idx + 3] = 255;
    }
  }

  honedCarraraCache = new THREE.MeshPhysicalMaterial({
    name: 'bathroom.honedCarraraMarble',
    color: 0xffffff,
    map: configureDataTexture(colorData, w, h, 'bathroom.honedCarrara.color', true, 1.4, 1.0),
    roughnessMap: configureDataTexture(roughData, w, h, 'bathroom.honedCarrara.roughness', false, 1.4, 1.0),
    roughness: 0.24,
    metalness: 0.0,
    clearcoat: 0.28,
    clearcoatRoughness: 0.18,
  });
  return honedCarraraCache;
}

let zelligeShowerTileCache: THREE.MeshPhysicalMaterial | null = null;

/**
 * Glazed warm-cream vertical zellige ceramic wall tile material for walk-in showers.
 */
export function getZelligeCreamWallTileMaterial(): THREE.MeshPhysicalMaterial {
  if (zelligeShowerTileCache) return zelligeShowerTileCache;

  const w = 256;
  const h = 256;
  const colorData = new Uint8Array(w * h * 4);
  const bumpData = new Uint8Array(w * h * 4);
  const cols = 8; // ~75mm narrow vertical tile pitch
  const rows = 4; // ~150mm vertical tile height

  for (let y = 0; y < h; y++) {
    const v = y / h;
    const ry = v * rows;
    const rowIdx = Math.floor(ry);
    const fy = ry - rowIdx;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const cx = u * cols;
      const colIdx = Math.floor(cx);
      const fx = cx - colIdx;

      const groutX = Math.min(fx, 1 - fx) * (w / cols);
      const groutY = Math.min(fy, 1 - fy) * (h / rows);
      const groutMask = THREE.MathUtils.smoothstep(Math.min(1, Math.min(groutX, groutY) / 2.1), 0, 1);

      const tileTone = hash2DPeriodic(colIdx, rowIdx, cols, rows, 16111) - 0.5;
      const handRipple = seamlessFbm2D(u, v, 16, 3, 16223) - 0.5;

      const tileR = 235 + tileTone * 11 + handRipple * 7;
      const tileG = 230 + tileTone * 10 + handRipple * 7;
      const tileB = 219 + tileTone * 10 + handRipple * 6;

      const idx = (y * w + x) * 4;
      colorData[idx] = clampByte(208 * (1 - groutMask) + tileR * groutMask);
      colorData[idx + 1] = clampByte(203 * (1 - groutMask) + tileG * groutMask);
      colorData[idx + 2] = clampByte(193 * (1 - groutMask) + tileB * groutMask);
      colorData[idx + 3] = 255;

      const pillow = Math.sin(fx * Math.PI) * Math.sin(fy * Math.PI);
      const bByte = clampByte(64 * (1 - groutMask) + (142 + pillow * 36 + handRipple * 32) * groutMask);
      bumpData[idx] = bByte;
      bumpData[idx + 1] = bByte;
      bumpData[idx + 2] = bByte;
      bumpData[idx + 3] = 255;
    }
  }

  zelligeShowerTileCache = new THREE.MeshPhysicalMaterial({
    name: 'bathroom.zelligeCreamWallTile',
    color: 0xffffff,
    map: configureDataTexture(colorData, w, h, 'bathroom.zelligeCream.color', true, 2.2, 3.2),
    bumpMap: configureDataTexture(bumpData, w, h, 'bathroom.zelligeCream.bump', false, 2.2, 3.2),
    bumpScale: 0.0018,
    roughness: 0.19,
    metalness: 0.0,
    clearcoat: 0.68,
    clearcoatRoughness: 0.14,
  });
  return zelligeShowerTileCache;
}

let bathroomTextilesCache: {
  readonly ivoryWaffleRobe: THREE.MeshStandardMaterial;
  readonly oatmealWaffleRobe: THREE.MeshStandardMaterial;
  readonly stripedRailTowel: THREE.MeshStandardMaterial;
  readonly crispWhiteWaffleTowel: THREE.MeshStandardMaterial;
} | null = null;

/**
 * Tactile honeycomb waffle-weave cotton-linen bathrobe materials & woven ticking-stripe
 * bath towel material.
 */
export function getBathroomTextileMaterials(): {
  readonly ivoryWaffleRobe: THREE.MeshStandardMaterial;
  readonly oatmealWaffleRobe: THREE.MeshStandardMaterial;
  readonly stripedRailTowel: THREE.MeshStandardMaterial;
  readonly crispWhiteWaffleTowel: THREE.MeshStandardMaterial;
} {
  if (bathroomTextilesCache) return bathroomTextilesCache;

  const w = 128;
  const h = 128;
  const waffleBumpData = new Uint8Array(w * h * 4);
  const stripeColorData = new Uint8Array(w * h * 4);

  for (let y = 0; y < h; y++) {
    const v = y / h;
    // Horizontal woven taupe-grey stripes on warm ivory cotton
    const stripeCycle = (v * 18) % 1;
    const isStripe = stripeCycle > 0.30 && stripeCycle < 0.56 ? 1 : 0;
    const slub = seamlessNoise2D(0.5, v, 4, 64, 17107) - 0.5;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const cellX = Math.abs(((u * 32) % 1) - 0.5) * 2;
      const cellY = Math.abs(((v * 32) % 1) - 0.5) * 2;
      const waffle = Math.max(cellX, cellY);
      const yarn = seamlessNoise2D(u, v, 64, 64, 17209) - 0.5;
      const bByte = clampByte(92 + waffle * 124 + yarn * 26);

      const idx = (y * w + x) * 4;
      waffleBumpData[idx] = bByte;
      waffleBumpData[idx + 1] = bByte;
      waffleBumpData[idx + 2] = bByte;
      waffleBumpData[idx + 3] = 255;

      const creamR = 242 + yarn * 8 + slub * 6;
      const creamG = 238 + yarn * 8 + slub * 6;
      const creamB = 229 + yarn * 8 + slub * 6;
      const stripeR = 160 + yarn * 10;
      const stripeG = 156 + yarn * 10;
      const stripeB = 149 + yarn * 10;
      // Leave crisp solid cream borders near top/bottom hem
      const inBand = v > 0.08 && v < 0.92 ? isStripe : 0;
      stripeColorData[idx] = clampByte(creamR * (1 - inBand) + stripeR * inBand);
      stripeColorData[idx + 1] = clampByte(creamG * (1 - inBand) + stripeG * inBand);
      stripeColorData[idx + 2] = clampByte(creamB * (1 - inBand) + stripeB * inBand);
      stripeColorData[idx + 3] = 255;
    }
  }

  const waffleBump = configureDataTexture(waffleBumpData, w, h, 'bathroom.waffleLinen.bump', false, 4, 6);
  const stripeMap = configureDataTexture(stripeColorData, w, h, 'bathroom.stripedTowel.color', true, 1, 2);

  bathroomTextilesCache = {
    ivoryWaffleRobe: new THREE.MeshStandardMaterial({
      name: 'bathroom.waffleRobe.warmIvory',
      color: 0xe2d7c5,
      bumpMap: waffleBump,
      bumpScale: 0.0028,
      roughness: 0.89,
      metalness: 0.0,
      side: THREE.DoubleSide,
    }),
    oatmealWaffleRobe: new THREE.MeshStandardMaterial({
      name: 'bathroom.waffleRobe.naturalOatmeal',
      color: 0xd2c4ae,
      bumpMap: waffleBump,
      bumpScale: 0.0028,
      roughness: 0.90,
      metalness: 0.0,
      side: THREE.DoubleSide,
    }),
    stripedRailTowel: new THREE.MeshStandardMaterial({
      name: 'bathroom.stripedCottonTowel',
      color: 0xffffff,
      map: stripeMap,
      bumpMap: waffleBump,
      bumpScale: 0.0018,
      roughness: 0.87,
      metalness: 0.0,
      side: THREE.DoubleSide,
    }),
    crispWhiteWaffleTowel: new THREE.MeshStandardMaterial({
      name: "bathroom.waffleTowel.crispWhite",
      color: 0xf7f5f0,
      bumpMap: waffleBump,
      bumpScale: 0.0024,
      roughness: 0.88,
      metalness: 0.0,
      side: THREE.DoubleSide,
    }),
  };
  return bathroomTextilesCache;
}

let oliveGreenVerticalMetroTileCache: THREE.MeshPhysicalMaterial | null = null;

/**
 * Artisanal hand-glazed Olive Green vertical-stacked narrow metro ceramic wall tile material
 * (`62.5mm W x 250mm H` = `16 columns x 4 rows` per `1.0m x 1.0m` world repeat on `512 x 512`
 * `DataTexture`) with muted heritage grey-olive kiln glaze variation (`#484F3C`..`#616854`
 * around `#555C47` smoky olive base), edge glaze pooling, ceramic ripple, and crisp `2.2mm`
 * warm cream grout (`#F2EEE3`).
 */
export function getOliveGreenVerticalMetroTileMaterial(): THREE.MeshPhysicalMaterial {
  if (oliveGreenVerticalMetroTileCache) return oliveGreenVerticalMetroTileCache;

  const w = 512;
  const h = 512;
  const colorData = new Uint8Array(w * h * 4);
  const roughData = new Uint8Array(w * h * 4);
  const clearcoatData = new Uint8Array(w * h * 4);
  const bumpData = new Uint8Array(w * h * 4);

  const cols = 16; // 1.000m / 16 = 62.5mm tile pitch
  const rows = 4;  // 1.000m / 4  = 250.0mm vertical tile pitch
  const tileW = 1.0 / cols; // 0.0625m
  const tileH = 1.0 / rows; // 0.2500m
  const halfGroutM = 0.0011; // 1.1mm each side = 2.2mm warm cream grout joint

  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    const ry = v * rows;
    const rowIdx = Math.floor(ry);
    const fy = ry - rowIdx;
    const distYM = Math.min(fy, 1 - fy) * tileH;

    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const cx = u * cols;
      const colIdx = Math.floor(cx);
      const fx = cx - colIdx;
      const distXM = Math.min(fx, 1 - fx) * tileW;
      const edgeDistM = Math.min(distXM, distYM);

      // tileMask = 0 inside 2.2mm grout joint, smoothly rising to 1 across glazed bevel arris
      const tileMask = THREE.MathUtils.smoothstep(
        Math.max(0, Math.min(1, (edgeDistM - (halfGroutM - 0.0002)) / 0.00075)),
        0,
        1
      );

      // Per-tile kiln temperature & glaze thickness variation (#484F3C .. #616854 around #555C47 muted grey-olive)
      const kilnVal = hash2DPeriodic(colIdx, rowIdx, cols, rows, 28411); // [0, 1]
      const kilnHue = hash2DPeriodic(colIdx, rowIdx, cols, rows, 28517) - 0.5;
      const handRipple = seamlessFbm2D(u, v, 24, 3, 28619) - 0.5;
      const glazeWave =
        Math.sin((fx * 2.1 + kilnHue * 1.7) * Math.PI) *
        Math.sin((fy * 3.0 - kilnHue * 1.3) * Math.PI) *
        0.5;

      // Interpolate kiln firing between smoky grey-olive #484F3C (72,79,60) and warm heritage sage-olive #616854 (97,104,84)
      // centered on #555C47 (84.5, 91.5, 71.5 — S ≈ 13.5% muted heritage grey-olive)
      const tKiln = kilnVal - 0.5; // [-0.5, +0.5]
      let tileR = 84.5 + tKiln * 25 + kilnHue * 3 + handRipple * 5.5 + glazeWave * 2.8;
      let tileG = 91.5 + tKiln * 25 - kilnHue * 2.5 + handRipple * 6 + glazeWave * 3.0;
      let tileB = 71.5 + tKiln * 24 + kilnHue * 2.5 + handRipple * 5 + glazeWave * 2.5;

      // Artisanal glaze pooling: darker olive band 1.6mm..7.5mm inside the tile edge,
      // plus subtle translucent glaze thinning right on the 1.5mm bevel crest
      const poolBand =
        THREE.MathUtils.smoothstep(Math.max(0, Math.min(1, (edgeDistM - 0.0014) / 0.0018)), 0, 1) *
        (1 - THREE.MathUtils.smoothstep(Math.max(0, Math.min(1, (edgeDistM - 0.0036) / 0.0052)), 0, 1));
      const crestThin =
        tileMask * (1 - THREE.MathUtils.smoothstep(Math.max(0, Math.min(1, (edgeDistM - 0.0013) / 0.0016)), 0, 1));
      const poolFactor = 1 - poolBand * 0.13 + crestThin * 0.05;
      tileR *= poolFactor;
      tileG *= poolFactor;
      tileB *= poolFactor;

      // Crisp warm cream / off-white grout (#F2EEE3 = 242, 238, 227) with fine mineral grain
      const mortarGrain = (seamlessNoise2D(u, v, 64, 64, 28723) - 0.5) * 6;
      const groutR = 242 + mortarGrain;
      const groutG = 238 + mortarGrain;
      const groutB = 227 + mortarGrain;

      const idx = (y * w + x) * 4;
      colorData[idx] = clampByte(groutR * (1 - tileMask) + tileR * tileMask);
      colorData[idx + 1] = clampByte(groutG * (1 - tileMask) + tileG * tileMask);
      colorData[idx + 2] = clampByte(groutB * (1 - tileMask) + tileB * tileMask);
      colorData[idx + 3] = 255;

      // Roughness map (multiplied by material.roughness = 0.88):
      // Grout = 255 -> 0.88 * 1.0 = 0.88 (matte mortar)
      // Glazed tile face = 38 -> 0.88 * (38/255) = 0.131 (glossy ceramic glaze)
      const tileRoughByte = 38 + handRipple * 6 - poolBand * 4;
      const rByte = clampByte(255 * (1 - tileMask) + tileRoughByte * tileMask);
      roughData[idx] = rByte;
      roughData[idx + 1] = rByte;
      roughData[idx + 2] = rByte;
      roughData[idx + 3] = 255;

      // Clearcoat mask: full clearcoat (0.88) on glazed tile, 0.0 on matte cream grout
      const ccByte = clampByte(tileMask * 255);
      clearcoatData[idx] = ccByte;
      clearcoatData[idx + 1] = ccByte;
      clearcoatData[idx + 2] = ccByte;
      clearcoatData[idx + 3] = 255;

      // Bump height: recessed grout channel + pillowed ceramic bevel + artisanal hand-glazed ripple
      const bevelDome = THREE.MathUtils.smoothstep(Math.max(0, Math.min(1, (edgeDistM - halfGroutM) / 0.0045)), 0, 1);
      const tileHeight = 148 + bevelDome * 42 + handRipple * 26 + glazeWave * 14;
      const bByte = clampByte(52 * (1 - tileMask) + tileHeight * tileMask);
      bumpData[idx] = bByte;
      bumpData[idx + 1] = bByte;
      bumpData[idx + 2] = bByte;
      bumpData[idx + 3] = 255;
    }
  }

  oliveGreenVerticalMetroTileCache = new THREE.MeshPhysicalMaterial({
    name: "bathroom.oliveGreenVerticalMetroTile",
    color: 0xffffff,
    map: configureDataTexture(
      colorData,
      w,
      h,
      "bathroom.oliveGreenVerticalMetroTile.color",
      true,
      1,
      1
    ),
    roughnessMap: configureDataTexture(
      roughData,
      w,
      h,
      "bathroom.oliveGreenVerticalMetroTile.roughness",
      false,
      1,
      1
    ),
    clearcoatMap: configureDataTexture(
      clearcoatData,
      w,
      h,
      "bathroom.oliveGreenVerticalMetroTile.clearcoat",
      false,
      1,
      1
    ),
    bumpMap: configureDataTexture(
      bumpData,
      w,
      h,
      "bathroom.oliveGreenVerticalMetroTile.bump",
      false,
      1,
      1
    ),
    bumpScale: 0.0022,
    roughness: 0.88,
    metalness: 0.0,
    clearcoat: 0.88,
    clearcoatRoughness: 0.08,
  });
  return oliveGreenVerticalMetroTileCache;
}

// 1920s/1930s Art Deco Fluted Prismatic Opal Glass (IP44 Vanity Sconces)

export interface ArtDecoFlutedGlassMaterialPalette {
  readonly flutedShade: THREE.MeshPhysicalMaterial;
  readonly warmFilamentCore: THREE.MeshStandardMaterial;
}

let artDecoFlutedGlassCache: ArtDecoFlutedGlassMaterialPalette | null = null;

/**
 * Procedural 28-flute vertical prismatic opal-glass material for IP44 Art Deco wall sconces
 * (`userData.baseEmissiveIntensity` is wired into the room lighting circuit; uses emissive
 * glow instead of `transmission` to avoid an extra WebGPU transmission pass).
 */
export function getArtDecoFlutedGlassMaterials(): ArtDecoFlutedGlassMaterialPalette {
  if (artDecoFlutedGlassCache) return artDecoFlutedGlassCache;

  const w = 256;
  const h = 128;
  const colorData = new Uint8Array(w * h * 4);
  const bumpData = new Uint8Array(w * h * 4);
  const roughData = new Uint8Array(w * h * 4);

  const fluteCount = 28;
  for (let y = 0; y < h; y++) {
    const v = y / h;
    // Vertical warm hotspot around central lamp filament (v ≈ 0.5)
    const verticalGlow = Math.exp(-Math.pow((v - 0.5) / 0.36, 2));
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const flutePhase = (u * fluteCount) % 1;
      // Crisp semi-cylindrical Art Deco vertical flute profile
      const ridge = Math.sqrt(Math.max(0, 1 - Math.pow((flutePhase - 0.5) * 1.96, 2)));
      const microFrost = seamlessNoise2D(u, v, 56, 32, 18911);

      const idx = (y * w + x) * 4;
      const warmTint = 0.88 + 0.12 * verticalGlow;
      colorData[idx] = clampByte((244 + ridge * 10) * warmTint);
      colorData[idx + 1] = clampByte((236 + ridge * 11) * warmTint);
      colorData[idx + 2] = clampByte((220 + ridge * 12) * (0.85 + 0.15 * verticalGlow));
      colorData[idx + 3] = 255;

      const bByte = clampByte(54 + ridge * 188 + (microFrost - 0.5) * 10);
      bumpData[idx] = bByte;
      bumpData[idx + 1] = bByte;
      bumpData[idx + 2] = bByte;
      bumpData[idx + 3] = 255;

      const rByte = clampByte(192 - ridge * 46 + (microFrost - 0.5) * 14);
      roughData[idx] = rByte;
      roughData[idx + 1] = rByte;
      roughData[idx + 2] = rByte;
      roughData[idx + 3] = 255;
    }
  }

  const flutedShade = new THREE.MeshPhysicalMaterial({
    name: 'bathroom.artDecoFlutedOpalGlass',
    color: 0xfff8ec,
    map: configureDataTexture(colorData, w, h, 'bathroom.artDecoFlutedGlass.color', true, 1, 1),
    bumpMap: configureDataTexture(bumpData, w, h, 'bathroom.artDecoFlutedGlass.bump', false, 1, 1),
    bumpScale: 0.0038,
    roughnessMap: configureDataTexture(roughData, w, h, 'bathroom.artDecoFlutedGlass.roughness', false, 1, 1),
    roughness: 0.28,
    metalness: 0.0,
    clearcoat: 0.90,
    clearcoatRoughness: 0.08,
    emissive: new THREE.Color(0xffc97a),
    emissiveIntensity: 0.72,
  });
  flutedShade.userData['baseEmissiveIntensity'] = 0.72;

  const warmFilamentCore = new THREE.MeshStandardMaterial({
    name: 'bathroom.artDecoSconceFilament',
    color: 0xfff2d6,
    roughness: 0.22,
    metalness: 0.0,
    emissive: new THREE.Color(0xffbe63),
    emissiveIntensity: 1.85,
  });
  warmFilamentCore.userData['baseEmissiveIntensity'] = 1.85;

  artDecoFlutedGlassCache = { flutedShade, warmFilamentCore };
  return artDecoFlutedGlassCache;
}
