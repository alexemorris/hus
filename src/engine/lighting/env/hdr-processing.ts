import * as THREE from 'three';
import {
  environmentRotationForSun,
  environmentRotationForSunXZ,
  type EnvPresetConfig,
} from './env-presets.ts';

export { environmentRotationForSun, environmentRotationForSunXZ };

/**
 * Invertible highlight-shoulder constant used when encoding `*_8k.webp` / `*_4k.webp` detail maps:
 *   `encodedLinear = L / (GAINMAP_SHOULDER_K + L)` -> sRGB 8-bit.
 * Maps `[0 .. +inf)` smoothly into `[0 .. 1)` without hard 8-bit clipping on bright clouds,
 * dusk horizon glow, or night city lights while preserving dark shadow precision.
 */
export const GAINMAP_SHOULDER_K = 0.85;

/** Default maximum 2D equirectangular background texture width (`8192×4096`). */
export const DEFAULT_MAX_HDR_DETAIL_WIDTH = 8192;

/** Maximum HDR equirectangular width on mobile / iOS / iPadOS devices (`2048x1024`). */
export const MOBILE_MAX_HDR_DETAIL_WIDTH = 2048;

export interface HdrDeviceLimitsLike {
  readonly maxTextureDimension2D?: number;
  readonly maxBufferSize?: number;
}

/**
 * Computes the aligned WebGPU staging byte size for a `width x (width / 2)` `RGBA16F` (8 B/px)
 * equirectangular panorama upload (WebGPU `bytesPerRow` alignment = 256 bytes).
 */
export function computeEquirectHalfFloatUploadBytes(width: number): number {
  const w = Math.max(2, Math.floor(width));
  const h = Math.max(1, Math.floor(w / 2));
  const unalignedRowBytes = w * 8;
  const alignedRowBytes = Math.ceil(unalignedRowBytes / 256) * 256;
  return alignedRowBytes * h;
}

/**
 * Resolves a safe `maxDetailWidth` respecting mobile memory caps (`<= 2048`),
 * `device.limits.maxTextureDimension2D`, and `device.limits.maxBufferSize`.
 */
export function resolveMaxHdrDetailWidth(
  limits?: HdrDeviceLimitsLike | null,
  isMobile = false
): number {
  let maxW = isMobile ? MOBILE_MAX_HDR_DETAIL_WIDTH : DEFAULT_MAX_HDR_DETAIL_WIDTH;
  const texLimit = limits?.maxTextureDimension2D;
  if (typeof texLimit === "number" && Number.isFinite(texLimit) && texLimit >= 512) {
    maxW = Math.min(maxW, Math.floor(texLimit));
  }
  const bufLimit = limits?.maxBufferSize;
  if (typeof bufLimit === "number" && Number.isFinite(bufLimit) && bufLimit >= 4 * 1024 * 1024) {
    while (maxW > 512 && computeEquirectHalfFloatUploadBytes(maxW) > bufLimit) {
      maxW = Math.max(512, Math.floor(maxW / 2));
    }
  }
  return maxW;
}

const SRGB_BYTE_TO_LINEAR_LUT = (() => {
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const s = i / 255.0;
    lut[i] = s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }
  return lut;
})();

const GAINMAP_BYTE_TO_BASE_RADIANCE_LUT = (() => {
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const m = SRGB_BYTE_TO_LINEAR_LUT[i]!;
    lut[i] = (GAINMAP_SHOULDER_K * m) / Math.max(0.06, 1.0 - m);
  }
  return lut;
})();

function smoothPeriodicGrid3x3(src: Float32Array, W: number, H: number): Float32Array {
  const dst = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    const ym = Math.max(0, y - 1) * W;
    const y0 = y * W;
    const yp = Math.min(H - 1, y + 1) * W;
    for (let x = 0; x < W; x++) {
      const xm = (x - 1 + W) % W;
      const xp = (x + 1) % W;
      const o = (y0 + x) * 3;
      for (let c = 0; c < 3; c++) {
        const s =
          src[(ym + xm) * 3 + c]! +
          src[(ym + x) * 3 + c]! * 2 +
          src[(ym + xp) * 3 + c]! +
          src[(y0 + xm) * 3 + c]! * 2 +
          src[(y0 + x) * 3 + c]! * 4 +
          src[(y0 + xp) * 3 + c]! * 2 +
          src[(yp + xm) * 3 + c]! +
          src[(yp + x) * 3 + c]! * 2 +
          src[(yp + xp) * 3 + c]!;
        dst[o + c] = s * 0.0625;
      }
    }
  }
  return dst;
}

function wrapPi(angleRad: number): number {
  let theta = angleRad % (Math.PI * 2);
  while (theta > Math.PI) theta -= Math.PI * 2;
  while (theta <= -Math.PI) theta += Math.PI * 2;
  return theta;
}

/**
 * Y rotation (radians) for `scene.environmentRotation` / `scene.backgroundRotation` that locks a
 * True-North world-anchored equirectangular panorama (`u = northU` -> `0°` True North,
 * `u = northU + 0.25` -> `90°` East, `u = northU + 0.5` -> `180°` South, `u = northU + 0.75` -> `270°` West)
 * onto the site's True-North compass bearing (`plusXTrueBearingDeg`).
 */
export function environmentRotationForTrueNorth(
  plusXTrueBearingDeg: number,
  northU = 0
): number {
  return wrapPi((northU - 0.5) * Math.PI * 2 + (plusXTrueBearingDeg * Math.PI) / 180);
}

export function configureEquirect(tex: THREE.Texture): void {
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.flipY = true;
  tex.needsUpdate = true;
}

/**
 * Derives the companion `8192×4096` Ultra-HDR visual detail `.webp` URL for any `*_2k.hdr` asset
 * (unless an explicit `detailOverrideUrl` is provided), or returns `null` for `_512.hdr` preview /
 * non-standard URLs.
 */
export function deriveDetailWebpUrl(
  hdrUrl: string,
  detailOverrideUrl?: string | null,
  isMobile = false
): string | null {
  if (isMobile) {
    return null;
  }
  if (!/_2k\.hdr(\?.*)?$/i.test(hdrUrl)) {
    return null;
  }
  if (detailOverrideUrl) {
    return detailOverrideUrl;
  }
  return hdrUrl.replace(/_2k\.hdr(\?.*)?$/i, '_8k.webp$1');
}

/**
 * Converts a primary `*_8k.webp` detail URL to its `*_4k.webp` fallback URL, or returns `null`
 * if `detailUrl` is not an `_8k.webp` asset.
 */
export function deriveFallbackDetailWebpUrl(detailUrl: string): string | null {
  if (!/_8k\.webp(\?.*)?$/i.test(detailUrl)) {
    return null;
  }
  return detailUrl.replace(/_8k\.webp(\?.*)?$/i, '_4k.webp$1');
}

/**
 * Downsamples an RGBA detail image to `maxDetailWidth` (preserving aspect ratio) using area/bilinear
 * averaging so decoded skyboxes never exceed the WebGPU device's `maxTextureDimension2D`.
 */
export function downsampleDetailRgbaImage(
  detail: DetailRgbaImage,
  maxDetailWidth: number
): DetailRgbaImage {
  const safeMaxW = Math.max(64, Math.floor(maxDetailWidth));
  if (detail.width <= safeMaxW) {
    return detail;
  }
  const targetW = safeMaxW;
  const targetH = Math.max(1, Math.round((detail.height * targetW) / detail.width));
  const out = new Uint8ClampedArray(targetW * targetH * 4);
  const scaleX = detail.width / targetW;
  const scaleY = detail.height / targetH;
  const src = detail.data;
  const srcW = detail.width;
  const srcH = detail.height;

  for (let y = 0; y < targetH; y++) {
    const sy0 = Math.floor(y * scaleY);
    const sy1 = Math.max(sy0 + 1, Math.min(srcH, Math.ceil((y + 1) * scaleY)));
    for (let x = 0; x < targetW; x++) {
      const sx0 = Math.floor(x * scaleX);
      const sx1 = Math.max(sx0 + 1, Math.min(srcW, Math.ceil((x + 1) * scaleX)));
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sa = 0;
      let count = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        const rowOff = sy * srcW * 4;
        for (let sx = sx0; sx < sx1; sx++) {
          const pi = rowOff + sx * 4;
          sr += src[pi]!;
          sg += src[pi + 1]!;
          sb += src[pi + 2]!;
          sa += src[pi + 3]!;
          count++;
        }
      }
      const inv = 1 / Math.max(1, count);
      const oi = (y * targetW + x) * 4;
      out[oi] = Math.round(sr * inv);
      out[oi + 1] = Math.round(sg * inv);
      out[oi + 2] = Math.round(sb * inv);
      out[oi + 3] = Math.round(sa * inv);
    }
  }

  return { data: out, width: targetW, height: targetH };
}

/**
 * Bakes a small HalfFloat equirectangular sky (gradient dome, horizon glow, soft
 * cloud bands, hedgerow silhouette, sun / moon disc at the preset's HDR sun position) so frame 0
 * has a plausible sky and IBL before the `.hdr` streams in.
 */
export function bakeProceduralSky(cfg: EnvPresetConfig, width = 512, height = 256): THREE.DataTexture {
  const zenithCol = new THREE.Color(cfg.skyZenith);
  const horizonCol = new THREE.Color(cfg.skyHorizon);
  const glowCol = new THREE.Color(cfg.horizonGlow);
  const pastureCol = new THREE.Color(cfg.groundPasture);
  const groundCol = new THREE.Color(cfg.groundBounce);
  const sunCol = new THREE.Color(cfg.sunOrbColor);
  const tmpCol = new THREE.Color();

  const data = new Uint16Array(width * height * 4);
  const fullAlpha = THREE.DataUtils.toHalfFloat(1.0);
  const sunU = cfg.hdrSunU;
  const sunV = cfg.hdrSunV;
  const sunPeak = cfg.sunOrbPeak;

  for (let y = 0; y < height; y++) {
    // Row 0 is the zenith (flipY = true).
    const vTop = y / (height - 1);
    const elevation = (0.5 - vTop) * Math.PI;

    for (let x = 0; x < width; x++) {
      const u = x / width;
      const az = u * Math.PI * 2;
      const hedgerowH =
        0.012 +
        0.008 * Math.sin(az * 5.0 + 0.7) +
        0.005 * Math.cos(az * 13.0 - 1.2) +
        0.003 * Math.sin(az * 29.0 + 2.1);

      const du = Math.min(Math.abs(u - sunU), 1 - Math.abs(u - sunU));
      const dv = vTop - sunV;
      const sunDist = Math.hypot(du * 2.0, dv);

      if (elevation >= 0) {
        const ny = Math.sin(elevation);
        tmpCol.copy(horizonCol).lerp(zenithCol, Math.pow(ny, 0.52));
        const glowFactor = Math.exp(-sunDist * 3.2) * (1 - ny * 0.65);
        tmpCol.lerp(glowCol, Math.min(0.85, glowFactor));
        const cloudWave =
          0.5 + 0.3 * Math.sin(az * 6.0 + ny * 9.0) + 0.2 * Math.cos(az * 15.0 - ny * 14.0);
        const cloudBand = THREE.MathUtils.smoothstep(ny, 0.06, 0.35) * (1 - THREE.MathUtils.smoothstep(ny, 0.55, 0.92));
        tmpCol.lerp(glowCol, Math.max(0, cloudWave - 0.45) * cloudBand * 0.45);
        if (ny < hedgerowH) {
          tmpCol.lerp(groundCol, (1 - THREE.MathUtils.smoothstep(ny, hedgerowH * 0.35, hedgerowH)) * 0.82);
        }
        const disc = Math.exp(-sunDist * sunDist * 1400.0) * sunPeak;
        const corona = Math.exp(-sunDist * 9.5) * (sunPeak * 0.14);
        tmpCol.r += sunCol.r * (disc + corona);
        tmpCol.g += sunCol.g * (disc + corona);
        tmpCol.b += sunCol.b * (disc + corona);
      } else {
        const downSin = Math.sin(-elevation);
        tmpCol.copy(pastureCol).lerp(groundCol, THREE.MathUtils.smoothstep(downSin, 0.0, 0.38));
        const nadirNeutralMix = THREE.MathUtils.smoothstep(downSin, 0.06, 0.35) * 0.85;
        if (nadirNeutralMix > 0) {
          const lum = 0.299 * tmpCol.r + 0.587 * tmpCol.g + 0.114 * tmpCol.b;
          tmpCol.r = tmpCol.r * (1 - nadirNeutralMix) + lum * 1.06 * nadirNeutralMix;
          tmpCol.g = tmpCol.g * (1 - nadirNeutralMix) + lum * 0.98 * nadirNeutralMix;
          tmpCol.b = tmpCol.b * (1 - nadirNeutralMix) + lum * 0.88 * nadirNeutralMix;
        }
        const bounceLift = cfg.envGroundBounceLift ?? 0;
        if (bounceLift > 0) {
          const lift = bounceLift * THREE.MathUtils.smoothstep(downSin, 0.02, 0.52);
          tmpCol.r += lift * 1.04;
          tmpCol.g += lift * 1.00;
          tmpCol.b += lift * 0.93;
        }
      }

      const idx = (y * width + x) * 4;
      data[idx] = THREE.DataUtils.toHalfFloat(tmpCol.r);
      data[idx + 1] = THREE.DataUtils.toHalfFloat(tmpCol.g);
      data[idx + 2] = THREE.DataUtils.toHalfFloat(tmpCol.b);
      data[idx + 3] = fullAlpha;
    }
  }

  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  configureEquirect(tex);
  return tex;
}

export interface PreparedHdr {
  readonly background: THREE.DataTexture;
  readonly envSource: THREE.DataTexture;
  readonly horizonGround: THREE.Color;
}

export interface PreparedHdrRawBuffers {
  readonly width: number;
  readonly height: number;
  readonly bgWidth?: number;
  readonly bgHeight?: number;
  readonly envWidth?: number;
  readonly envHeight?: number;
  readonly bgData: Uint16Array;
  readonly envData: Uint16Array;
  readonly avgR: number;
  readonly avgG: number;
  readonly avgB: number;
}

export interface DetailRgbaImage {
  readonly data: Uint8ClampedArray | Uint8Array;
  readonly width: number;
  readonly height: number;
}

export function wrapPreparedHdrBuffers(raw: PreparedHdrRawBuffers): PreparedHdr {
  const bgW = raw.bgWidth ?? raw.width;
  const bgH = raw.bgHeight ?? raw.height;
  const envW = raw.envWidth ?? raw.width;
  const envH = raw.envHeight ?? raw.height;

  const background = new THREE.DataTexture(
    raw.bgData,
    bgW,
    bgH,
    THREE.RGBAFormat,
    THREE.HalfFloatType
  );
  configureEquirect(background);
  background.minFilter = THREE.LinearFilter;
  background.magFilter = THREE.LinearFilter;
  background.generateMipmaps = false;

  const envSource = new THREE.DataTexture(
    raw.envData,
    envW,
    envH,
    THREE.RGBAFormat,
    THREE.HalfFloatType
  );
  configureEquirect(envSource);
  return {
    background,
    envSource,
    horizonGround: new THREE.Color(raw.avgR, raw.avgG, raw.avgB),
  };
}

export function fuseGainmapDetailToHalfFloat(
  hdrBgLinear: Float32Array,
  envW: number,
  envH: number,
  detail: DetailRgbaImage,
  kneeBg: number,
  hdrOverrideWeights?: Float32Array | null
): Uint16Array {
  const detW = detail.width;
  const detH = detail.height;
  const detPixels = detail.data;
  const fullAlpha = THREE.DataUtils.toHalfFloat(1.0);

  const lowBaseRaw = new Float32Array(envW * envH * 3);
  const scaleX = detW / envW;
  const scaleY = detH / envH;

  for (let ey = 0; ey < envH; ey++) {
    const dy0 = Math.floor(ey * scaleY);
    const dy1 = Math.max(dy0 + 1, Math.min(detH, Math.ceil((ey + 1) * scaleY)));
    for (let ex = 0; ex < envW; ex++) {
      const dx0 = Math.floor(ex * scaleX);
      const dx1 = Math.max(dx0 + 1, Math.min(detW, Math.ceil((ex + 1) * scaleX)));
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let count = 0;
      for (let dy = dy0; dy < dy1; dy++) {
        const rowOff = dy * detW * 4;
        for (let dx = dx0; dx < dx1; dx++) {
          const pi = rowOff + dx * 4;
          sr += GAINMAP_BYTE_TO_BASE_RADIANCE_LUT[detPixels[pi]!]!;
          sg += GAINMAP_BYTE_TO_BASE_RADIANCE_LUT[detPixels[pi + 1]!]!;
          sb += GAINMAP_BYTE_TO_BASE_RADIANCE_LUT[detPixels[pi + 2]!]!;
          count++;
        }
      }
      const inv = 1.0 / Math.max(1, count);
      const li = (ey * envW + ex) * 3;
      lowBaseRaw[li] = sr * inv;
      lowBaseRaw[li + 1] = sg * inv;
      lowBaseRaw[li + 2] = sb * inv;
    }
  }

  // Smooth both low-frequency grids across a 3x3 periodic-X kernel so high-contrast
  // sky/foliage boundaries never create single-texel ratio spikes or ringing halos.
  const smoothTarget = smoothPeriodicGrid3x3(hdrBgLinear, envW, envH);
  const smoothBase = smoothPeriodicGrid3x3(lowBaseRaw, envW, envH);

  // Chromaticity-preserving scalar luminance gain + bounded sky-only tint + sun/moon HDR excess.
  // Keeping gain scalar on dark silhouettes prevents independent R/G/B division from inverting
  // or solarizing tree contours when HDR corona or plain-sRGB WebP baselines differ from HDR.
  const gainGrid = new Float32Array(envW * envH * 3);
  const addGrid = new Float32Array(envW * envH * 3);
  const lowLumGrid = new Float32Array(envW * envH);
  const LUM_REG = 0.045;
  const MIN_GAIN = 0.14;
  const MAX_GAIN = 2.85;

  for (let i = 0, n = envW * envH; i < n; i++) {
    const i3 = i * 3;
    const tr = smoothTarget[i3]!;
    const tg = smoothTarget[i3 + 1]!;
    const tb = smoothTarget[i3 + 2]!;
    const br = smoothBase[i3]!;
    const bg = smoothBase[i3 + 1]!;
    const bb = smoothBase[i3 + 2]!;

    const tLum = 0.2126 * tr + 0.7152 * tg + 0.0722 * tb;
    const bLum = 0.2126 * br + 0.7152 * bg + 0.0722 * bb;
    lowLumGrid[i] = bLum;

    const scalarGain = Math.min(MAX_GAIN, Math.max(MIN_GAIN, (tLum + LUM_REG) / (bLum + LUM_REG)));

    // Gentle chromaticity alignment ONLY in bright unoccluded sky/zenith (bLum > 0.14 & tLum > 0.14);
    // dark foliage/ridge silhouettes (bLum <= 0.14) use 100% pure scalar luminance gain.
    const tintWeight = THREE.MathUtils.smoothstep(Math.min(tLum, bLum), 0.14, 0.48) * 0.45;
    let gr = scalarGain;
    let gg = scalarGain;
    let gb = scalarGain;
    if (tintWeight > 0) {
      const cr = Math.min(1.32, Math.max(0.74, ((tr + 0.06) / (tLum + 0.06)) / ((br + 0.06) / (bLum + 0.06))));
      const cg = Math.min(1.32, Math.max(0.74, ((tg + 0.06) / (tLum + 0.06)) / ((bg + 0.06) / (bLum + 0.06))));
      const cb = Math.min(1.32, Math.max(0.74, ((tb + 0.06) / (tLum + 0.06)) / ((bb + 0.06) / (bLum + 0.06))));
      gr = scalarGain * (1.0 + (cr - 1.0) * tintWeight);
      gg = scalarGain * (1.0 + (cg - 1.0) * tintWeight);
      gb = scalarGain * (1.0 + (cb - 1.0) * tintWeight);
    }

    gainGrid[i3] = gr;
    gainGrid[i3 + 1] = gg;
    gainGrid[i3 + 2] = gb;

    // Preserve pinpoint HDR solar/lunar energy above the 8-bit WebP ceiling from unsmoothed hdrBgLinear.
    const rawTr = hdrBgLinear[i3]!;
    const rawTg = hdrBgLinear[i3 + 1]!;
    const rawTb = hdrBgLinear[i3 + 2]!;
    const rawBr = lowBaseRaw[i3]!;
    const rawBg = lowBaseRaw[i3 + 1]!;
    const rawBb = lowBaseRaw[i3 + 2]!;
    addGrid[i3] = Math.max(0, rawTr - Math.max(br, rawBr) * gr);
    addGrid[i3 + 1] = Math.max(0, rawTg - Math.max(bg, rawBg) * gg);
    addGrid[i3 + 2] = Math.max(0, rawTb - Math.max(bb, rawBb) * gb);
  }

  const outHalf = new Uint16Array(detW * detH * 4);
  const invScaleX = envW / detW;
  const invScaleY = envH / detH;

  for (let y = 0; y < detH; y++) {
    const fy = (y + 0.5) * invScaleY - 0.5;
    const cy = Math.max(0, Math.min(envH - 1, fy));
    const y0 = Math.floor(cy);
    const y1 = Math.min(envH - 1, y0 + 1);
    const ty = cy - y0;
    const oneMinusTy = 1.0 - ty;
    const row0 = y0 * envW;
    const row1 = y1 * envW;
    const detRow = y * detW * 4;

    for (let x = 0; x < detW; x++) {
      const fx = (x + 0.5) * invScaleX - 0.5;
      const xFloor = Math.floor(fx);
      const tx = fx - xFloor;
      const oneMinusTx = 1.0 - tx;
      const x0 = ((xFloor % envW) + envW) % envW;
      const x1 = (x0 + 1) % envW;

      const p00 = row0 + x0;
      const p10 = row0 + x1;
      const p01 = row1 + x0;
      const p11 = row1 + x1;

      const i00 = p00 * 3;
      const i10 = p10 * 3;
      const i01 = p01 * 3;
      const i11 = p11 * 3;

      const w00 = oneMinusTx * oneMinusTy;
      const w10 = tx * oneMinusTy;
      const w01 = oneMinusTx * ty;
      const w11 = tx * ty;

      const pi = detRow + x * 4;
      const br = GAINMAP_BYTE_TO_BASE_RADIANCE_LUT[detPixels[pi]!]!;
      const bg = GAINMAP_BYTE_TO_BASE_RADIANCE_LUT[detPixels[pi + 1]!]!;
      const bb = GAINMAP_BYTE_TO_BASE_RADIANCE_LUT[detPixels[pi + 2]!]!;
      const bPxLum = 0.2126 * br + 0.7152 * bg + 0.0722 * bb;

      const gr =
        gainGrid[i00]! * w00 + gainGrid[i10]! * w10 + gainGrid[i01]! * w01 + gainGrid[i11]! * w11;
      const gg =
        gainGrid[i00 + 1]! * w00 +
        gainGrid[i10 + 1]! * w10 +
        gainGrid[i01 + 1]! * w01 +
        gainGrid[i11 + 1]! * w11;
      const gb =
        gainGrid[i00 + 2]! * w00 +
        gainGrid[i10 + 2]! * w10 +
        gainGrid[i01 + 2]! * w01 +
        gainGrid[i11 + 2]! * w11;

      const ar =
        addGrid[i00]! * w00 + addGrid[i10]! * w10 + addGrid[i01]! * w01 + addGrid[i11]! * w11;
      const ag =
        addGrid[i00 + 1]! * w00 +
        addGrid[i10 + 1]! * w10 +
        addGrid[i01 + 1]! * w01 +
        addGrid[i11 + 1]! * w11;
      const ab =
        addGrid[i00 + 2]! * w00 +
        addGrid[i10 + 2]! * w10 +
        addGrid[i01 + 2]! * w01 +
        addGrid[i11 + 2]! * w11;

      // Gate additive HDR sun/corona excess by bright detail luminance so opaque silhouettes
      // (dark foliage, branches, spires, ridgelines) never receive additive sky/sun bloom.
      const lowLum =
        lowLumGrid[p00]! * w00 +
        lowLumGrid[p10]! * w10 +
        lowLumGrid[p01]! * w01 +
        lowLumGrid[p11]! * w11;
      const skyEmissiveMask = THREE.MathUtils.smoothstep(bPxLum, 0.38, 0.95);
      const addVis = skyEmissiveMask * Math.min(1.25, (bPxLum + 0.02) / (lowLum + 0.02));

      let r = br * gr + ar * addVis;
      let g = bg * gg + ag * addVis;
      let b = bb * gb + ab * addVis;

      if (hdrOverrideWeights) {
        const ow =
          hdrOverrideWeights[p00]! * w00 +
          hdrOverrideWeights[p10]! * w10 +
          hdrOverrideWeights[p01]! * w01 +
          hdrOverrideWeights[p11]! * w11;
        if (ow > 1e-4) {
          const hr =
            hdrBgLinear[i00]! * w00 +
            hdrBgLinear[i10]! * w10 +
            hdrBgLinear[i01]! * w01 +
            hdrBgLinear[i11]! * w11;
          const hg =
            hdrBgLinear[i00 + 1]! * w00 +
            hdrBgLinear[i10 + 1]! * w10 +
            hdrBgLinear[i01 + 1]! * w01 +
            hdrBgLinear[i11 + 1]! * w11;
          const hb =
            hdrBgLinear[i00 + 2]! * w00 +
            hdrBgLinear[i10 + 2]! * w10 +
            hdrBgLinear[i01 + 2]! * w01 +
            hdrBgLinear[i11 + 2]! * w11;
          r = r * (1.0 - ow) + hr * ow;
          g = g * (1.0 - ow) + hg * ow;
          b = b * (1.0 - ow) + hb * ow;
        }
      }

      const peak = Math.max(r, g, b);
      if (peak > kneeBg) {
        const s = kneeBg / peak;
        r *= s;
        g *= s;
        b *= s;
      }

      outHalf[pi] = THREE.DataUtils.toHalfFloat(r);
      outHalf[pi + 1] = THREE.DataUtils.toHalfFloat(g);
      outHalf[pi + 2] = THREE.DataUtils.toHalfFloat(b);
      outHalf[pi + 3] = fullAlpha;
    }
  }

  return outHalf;
}

export function prepareHdrBuffers(
  srcData: Float32Array,
  W: number,
  H: number,
  cfg: EnvPresetConfig,
  detail?: DetailRgbaImage | null,
  maxDetailWidth = DEFAULT_MAX_HDR_DETAIL_WIDTH
): PreparedHdrRawBuffers {
  const clampedDetail =
    detail && detail.width > maxDetailWidth
      ? downsampleDetailRgbaImage(detail, maxDetailWidth)
      : detail;
  const hasDetail = Boolean(
    clampedDetail && clampedDetail.width >= W && clampedDetail.height >= H
  );
  const envData = new Uint16Array(srcData.length);
  const hdrBgLinear = hasDetail ? new Float32Array(W * H * 3) : null;
  const hdrOverrideWeights = hasDetail ? new Float32Array(W * H) : null;
  const fallbackBgData = hasDetail ? null : new Uint16Array(srcData.length);
  const fullAlpha = THREE.DataUtils.toHalfFloat(1.0);

  const yBand0 = Math.floor(H * 0.525);
  const yBand1 = Math.max(yBand0 + 1, Math.floor(H * 0.540));
  const colR = new Float32Array(W);
  const colG = new Float32Array(W);
  const colB = new Float32Array(W);
  let avgR = 0;
  let avgG = 0;
  let avgB = 0;
  const bandRows = Math.max(1, yBand1 - yBand0);
  for (let x = 0; x < W; x++) {
    let sr = 0;
    let sg = 0;
    let sb = 0;
    for (let y = yBand0; y < yBand1; y++) {
      const i = (y * W + x) * 4;
      sr += Math.min(srcData[i]!, 2.0);
      sg += Math.min(srcData[i + 1]!, 2.0);
      sb += Math.min(srcData[i + 2]!, 2.0);
    }
    colR[x] = sr / bandRows;
    colG[x] = sg / bandRows;
    colB[x] = sb / bandRows;
    avgR += colR[x]!;
    avgG += colG[x]!;
    avgB += colB[x]!;
  }
  avgR /= W;
  avgG /= W;
  avgB /= W;

  const smoothR = new Float32Array(W);
  const smoothG = new Float32Array(W);
  const smoothB = new Float32Array(W);
  const blurRadius = Math.max(4, Math.round(W * 0.012));
  const inv = 1 / (blurRadius * 2 + 1);
  for (let x = 0; x < W; x++) {
    let sr = 0;
    let sg = 0;
    let sb = 0;
    for (let dx = -blurRadius; dx <= blurRadius; dx++) {
      const xw = (x + dx + W) % W;
      sr += colR[xw]!;
      sg += colG[xw]!;
      sb += colB[xw]!;
    }
    smoothR[x] = sr * inv;
    smoothG[x] = sg * inv;
    smoothB[x] = sb * inv;
  }

  const yNadirStart = Math.floor(H * 0.542);
  const yNadirFull = Math.floor(H * 0.66);
  const yEnvNeutralStart = Math.floor(H * 0.502);
  const yEnvNeutralFull = Math.floor(H * 0.58);
  const kneeBg = cfg.hdrMaxClampBg;
  const kneeEnv = cfg.hdrMaxClampEnv;
  const sunCol = new THREE.Color(cfg.sunOrbColor);
  const relocateDaySun = cfg.relocateDaySun !== undefined ? cfg.relocateDaySun : cfg.hdrSunV <= 0.26;

  for (let y = 0; y < H; y++) {
    const vTop = y / (H - 1);
    const nadirBlend = y > yNadirStart ? THREE.MathUtils.smoothstep(y, yNadirStart, yNadirFull) : 0;
    const deepNadirMix = y > yNadirStart ? THREE.MathUtils.smoothstep(y, yNadirStart, H - 1) * 0.72 : 0;
    const envNeutralMix =
      y > yEnvNeutralStart ? THREE.MathUtils.smoothstep(y, yEnvNeutralStart, yEnvNeutralFull) * 0.88 : 0;
    const zenithFactor =
      cfg.zenithDarkening > 0 && vTop < 0.48 ? (1 - THREE.MathUtils.smoothstep(vTop, 0.05, 0.48)) * cfg.zenithDarkening : 0;

    const cleanX = Math.floor(((cfg.hdrSunU + 0.32) % 1.0) * W);
    const cleanIdx = (y * W + cleanX) * 4;
    const rowCleanR = Math.min(srcData[cleanIdx]!, 2.2);
    const rowCleanG = Math.min(srcData[cleanIdx + 1]!, 2.2);
    const rowCleanB = Math.min(srcData[cleanIdx + 2]!, 2.4);

    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let r = srcData[i]!;
      let g = srcData[i + 1]!;
      let b = srcData[i + 2]!;
      let sunHealWeight = 0;

      if (relocateDaySun && vTop < 0.46) {
        const u = x / W;
        const du = Math.min(Math.abs(u - cfg.hdrSunU), 1 - Math.abs(u - cfg.hdrSunU));
        const oldDv = vTop - 0.35;
        const oldDist = Math.hypot(du * 1.8, oldDv);
        if (oldDist < 0.14) {
          const heal = 1 - THREE.MathUtils.smoothstep(oldDist, 0.02, 0.14);
          sunHealWeight = heal * 0.88;
          r = r * (1 - sunHealWeight) + rowCleanR * sunHealWeight;
          g = g * (1 - sunHealWeight) + rowCleanG * sunHealWeight;
          b = b * (1 - sunHealWeight) + rowCleanB * sunHealWeight;
        }
        const newDv = vTop - cfg.hdrSunV;
        const newDist = Math.hypot(du * 1.35, newDv);
        const disc = Math.exp(-newDist * newDist * 1400.0) * cfg.sunOrbPeak;
        const corona = Math.exp(-newDist * 11.0) * (cfg.sunOrbPeak * 0.14);
        r += sunCol.r * (disc + corona);
        g += sunCol.g * (disc + corona);
        b += sunCol.b * (disc + corona);
      }

      if (zenithFactor > 0) {
        r *= 1 - zenithFactor * 1.0;
        g *= 1 - zenithFactor * 0.8;
        b *= 1 - zenithFactor * 0.5;
      }

      if (nadirBlend > 0) {
        const pr = smoothR[x]! * (1 - deepNadirMix) + avgR * 0.65 * deepNadirMix;
        const pg = smoothG[x]! * (1 - deepNadirMix) + avgG * 0.65 * deepNadirMix;
        const pb = smoothB[x]! * (1 - deepNadirMix) + avgB * 0.65 * deepNadirMix;
        r = r * (1 - nadirBlend) + pr * nadirBlend;
        g = g * (1 - nadirBlend) + pg * nadirBlend;
        b = b * (1 - nadirBlend) + pb * nadirBlend;
      }

      const peak = Math.max(r, g, b);
      const sBg = peak > kneeBg ? kneeBg / peak : 1;
      if (hdrBgLinear) {
        const pIdx = y * W + x;
        const i3 = pIdx * 3;
        hdrBgLinear[i3] = r * sBg;
        hdrBgLinear[i3 + 1] = g * sBg;
        hdrBgLinear[i3 + 2] = b * sBg;
        if (hdrOverrideWeights) {
          hdrOverrideWeights[pIdx] = Math.max(nadirBlend, sunHealWeight);
        }
      } else if (fallbackBgData) {
        fallbackBgData[i] = THREE.DataUtils.toHalfFloat(r * sBg);
        fallbackBgData[i + 1] = THREE.DataUtils.toHalfFloat(g * sBg);
        fallbackBgData[i + 2] = THREE.DataUtils.toHalfFloat(b * sBg);
        fallbackBgData[i + 3] = fullAlpha;
      }

      let envR = r;
      let envG = g;
      let envB = b;
      if (envNeutralMix > 0) {
        const lum = 0.299 * envR + 0.587 * envG + 0.114 * envB;
        envR = envR * (1 - envNeutralMix) + lum * 1.06 * envNeutralMix;
        envG = envG * (1 - envNeutralMix) + lum * 0.98 * envNeutralMix;
        envB = envB * (1 - envNeutralMix) + lum * 0.88 * envNeutralMix;
      }
      const bounceLift = cfg.envGroundBounceLift ?? 0;
      if (bounceLift > 0 && y > yEnvNeutralStart) {
        const lift = bounceLift * THREE.MathUtils.smoothstep(y, yEnvNeutralStart, H - 1);
        envR += lift * 1.04;
        envG += lift * 1.00;
        envB += lift * 0.93;
      }
      const envPeak = Math.max(envR, envG, envB);
      const sEnv = envPeak > kneeEnv ? kneeEnv / envPeak : 1;
      envData[i] = THREE.DataUtils.toHalfFloat(envR * sEnv);
      envData[i + 1] = THREE.DataUtils.toHalfFloat(envG * sEnv);
      envData[i + 2] = THREE.DataUtils.toHalfFloat(envB * sEnv);
      envData[i + 3] = fullAlpha;
    }
  }

  if (hasDetail && hdrBgLinear && clampedDetail) {
    const fusedBg = fuseGainmapDetailToHalfFloat(
      hdrBgLinear,
      W,
      H,
      clampedDetail,
      kneeBg,
      hdrOverrideWeights
    );
    return {
      width: clampedDetail.width,
      height: clampedDetail.height,
      bgWidth: clampedDetail.width,
      bgHeight: clampedDetail.height,
      envWidth: W,
      envHeight: H,
      bgData: fusedBg,
      envData,
      avgR,
      avgG,
      avgB,
    };
  }

  return {
    width: W,
    height: H,
    bgWidth: W,
    bgHeight: H,
    envWidth: W,
    envHeight: H,
    bgData: fallbackBgData!,
    envData,
    avgR,
    avgG,
    avgB,
  };
}

export function prepareHdrPanorama(
  loadedTex: THREE.DataTexture,
  cfg: EnvPresetConfig,
  detail?: DetailRgbaImage | null,
  maxDetailWidth = DEFAULT_MAX_HDR_DETAIL_WIDTH
): PreparedHdr | null {
  const img = loadedTex.image as { width: number; height: number; data: Float32Array } | undefined;
  if (!img?.data) return null;
  return wrapPreparedHdrBuffers(
    prepareHdrBuffers(img.data, img.width, img.height, cfg, detail, maxDetailWidth)
  );
}
