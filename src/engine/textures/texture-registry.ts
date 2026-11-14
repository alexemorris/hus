/**
 * Deterministic procedural canvas and texture memoization registry.
 *
 * Caches generated `HTMLCanvasElement` surfaces by key so callers that wrap a canvas in
 * `new THREE.CanvasTexture(cachedCanvas)` can independently mutate `.repeat`, `.offset`,
 * `.wrapS`, or `.wrapT` without redundant 2D rasterisation. Also provides:
 * - Shared-`THREE.Source` UV-rotated / UV-transformed texture wrappers (eliminating
 *   duplicate GPU uploads for `:secondary` rotated variants)
 * - Compact 1-channel (`THREE.RedFormat` R8) and 2-channel (`THREE.RGFormat` RG8)
 *   `THREE.DataTexture` converters for scalar `bumpMap`/`clearcoatMap`/`roughnessMap` slots
 * - Snapshot-safe deterministic `CanvasTexture` memoization for repeated props & furnishings.
 */
import * as THREE from 'three';
import { detectMobile } from '../perf/device-tier.ts';
import { createRuntimeOrHeadlessCanvas } from './headless-canvas.ts';
import { boxDownsampleTexels, type DownsampledTexelBuffer } from './texture-downsample.ts';

interface RecordingCanvasLike {
  readonly log?: readonly string[];
}

const canvasCache = new Map<string, HTMLCanvasElement>();
const canvasPairCache = new Map<string, readonly [HTMLCanvasElement, HTMLCanvasElement]>();
const textureCache = new Map<string, unknown>();
const propTextureCache = new Map<string, unknown>();
const scalarDataCache = new Map<string, { readonly data: Uint8Array; readonly width: number; readonly height: number }>();
let rgbaDataCache = new WeakMap<HTMLCanvasElement, Map<string, { readonly data: Uint8Array; readonly width: number; readonly height: number }>>();
const statefulRecordingKeys = new Set<string>();

let downsampleScratchCanvas: HTMLCanvasElement | null = null;
let cachedIsSnapshotRecordingEnv: boolean | null = null;

/**
 * Returns true when `canvas` is a recording canvas stub (either `tools/snapshot/recording-canvas.ts`
 * or a lightweight unit-test recording stub with a `.log` command array).
 */
export function isRecordingCanvasStub(canvas: unknown): boolean {
  return (
    typeof canvas === 'object' &&
    canvas !== null &&
    'log' in canvas &&
    Array.isArray((canvas as RecordingCanvasLike).log)
  );
}

/**
 * Returns true when running under a headless recording canvas stub,
 * preserving deterministic texture IDs and gradient handle IDs.
 */
export function isSnapshotRecordingCanvas(canvas: unknown): boolean {
  if (typeof canvas !== 'object' || canvas === null) {
    return false;
  }
  return Object.getOwnPropertySymbols(canvas).some((s) => s.description === 'recordingCanvas');
}

function isSnapshotRecordingEnvironment(): boolean {
  if (cachedIsSnapshotRecordingEnv !== null) {
    return cachedIsSnapshotRecordingEnv;
  }
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    cachedIsSnapshotRecordingEnv = false;
    return false;
  }
  const probe = document.createElement('canvas');
  cachedIsSnapshotRecordingEnv = isSnapshotRecordingCanvas(probe);
  return cachedIsSnapshotRecordingEnv;
}

/**
 * True when mobile texture memory caps apply: a phone/tablet session (`detectMobile()`) outside
 * headless snapshot recording, so desktop and recorded output stay bit-for-bit identical.
 */
export function isMobileTextureBudgetActive(): boolean {
  return detectMobile() && !isSnapshotRecordingEnvironment();
}

function isStatefulRecordingCanvas(canvas: HTMLCanvasElement): boolean {
  const maybeRecording = canvas as unknown as RecordingCanvasLike;
  if (!Array.isArray(maybeRecording.log)) {
    return false;
  }
  return maybeRecording.log.some(
    (entry) => typeof entry === 'string' && (entry.includes('grad') || entry.includes('pat'))
  );
}

/**
 * Returns a cached `HTMLCanvasElement` for `key`, or creates a `width x height` canvas
 * and runs `draw` once to populate it.
 */
export function getOrCreateCachedCanvas(
  key: string,
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => void
): HTMLCanvasElement {
  const cached = canvasCache.get(key);
  if (
    cached !== undefined &&
    !statefulRecordingKeys.has(key) &&
    (isRecordingCanvasStub(cached) || (cached.width > 0 && cached.height > 0))
  ) {
    return cached;
  }

  const canvas = createRuntimeOrHeadlessCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx) {
    draw(ctx, canvas);
  }

  canvasCache.set(key, canvas);
  if (isStatefulRecordingCanvas(canvas)) {
    statefulRecordingKeys.add(key);
  }
  return canvas;
}

/**
 * Returns a cached pair of `[primaryCanvas, secondaryCanvas]` for synchronized
 * color + bump/depth procedural generators.
 */
export function getOrCreateCachedCanvasPair(
  key: string,
  width: number,
  height: number,
  draw: (
    primaryCtx: CanvasRenderingContext2D,
    secondaryCtx: CanvasRenderingContext2D,
    primaryCanvas: HTMLCanvasElement,
    secondaryCanvas: HTMLCanvasElement
  ) => void
): readonly [HTMLCanvasElement, HTMLCanvasElement] {
  const cached = canvasPairCache.get(key);
  if (
    cached !== undefined &&
    !statefulRecordingKeys.has(key) &&
    (isRecordingCanvasStub(cached[0]) ||
      (cached[0].width > 0 &&
        cached[0].height > 0 &&
        cached[1].width > 0 &&
        cached[1].height > 0))
  ) {
    return cached;
  }

  const primaryCanvas = createRuntimeOrHeadlessCanvas(width, height);
  const primaryCtx = primaryCanvas.getContext('2d', { willReadFrequently: true });

  const secondaryCanvas = createRuntimeOrHeadlessCanvas(width, height);
  const secondaryCtx = secondaryCanvas.getContext('2d', { willReadFrequently: true });

  if (primaryCtx && secondaryCtx) {
    draw(primaryCtx, secondaryCtx, primaryCanvas, secondaryCanvas);
  }

  const pair: readonly [HTMLCanvasElement, HTMLCanvasElement] = [primaryCanvas, secondaryCanvas];
  canvasPairCache.set(key, pair);
  canvasCache.set(`${key}:primary`, primaryCanvas);
  canvasCache.set(`${key}:secondary`, secondaryCanvas);
  if (isStatefulRecordingCanvas(primaryCanvas) || isStatefulRecordingCanvas(secondaryCanvas)) {
    statefulRecordingKeys.add(key);
  }
  return pair;
}

/**
 * Memoizes a shared texture or texture bundle by `key`.
 */
export function getOrCreateCachedTexture<T>(key: string, create: () => T): T {
  if (textureCache.has(key)) {
    return textureCache.get(key) as T;
  }
  const value = create();
  textureCache.set(key, value);
  return value;
}

/**
 * Memoizes a deterministic prop/furnishing/signage texture or texture bundle by `key`
 * across repeated furniture and architectural prop instances (`Map<string, T>`),
 * while remaining transparent to headless recording runs.
 */
export function getOrCreateCachedPropTexture<T>(key: string, create: () => T): T {
  if (isSnapshotRecordingEnvironment()) {
    return create();
  }
  if (propTextureCache.has(key)) {
    return propTextureCache.get(key) as T;
  }
  const value = create();
  propTextureCache.set(key, value);
  return value;
}

/**
 * Selects a right-sized browser canvas dimension while preserving exact legacy dimensions
 * during headless recording runs.
 */
export function resolveRightSizedCanvasDim(snapshotDim: number, runtimeDim: number): number {
  if (isSnapshotRecordingEnvironment()) return snapshotDim;
  if (detectMobile()) {
    return Math.max(128, Math.min(512, Math.round(runtimeDim * 0.5)));
  }
  return runtimeDim;
}

export interface SharedSourceTextureVariantOptions {
  readonly rotation?: number;
  readonly center?: readonly [number, number];
  readonly repeat?: readonly [number, number];
  readonly offset?: readonly [number, number];
  readonly wrapS?: THREE.Wrapping;
  readonly wrapT?: THREE.Wrapping;
}

/**
 * Creates a lightweight `THREE.Texture` wrapper sharing `baseTexture.source` (no canvas
 * duplication) with independent UV transform state (e.g. `:secondary` 90-degree rotated
 * `center = (0.5, 0.5), rotation = Math.PI / 2` or custom `.repeat`).
 */
export function createSharedSourceTextureVariant(
  baseTexture: THREE.Texture,
  options: SharedSourceTextureVariantOptions = {}
): THREE.Texture {
  const variant =
    baseTexture instanceof THREE.DataTexture
      ? new THREE.DataTexture()
      : baseTexture instanceof THREE.CanvasTexture
        ? new THREE.CanvasTexture()
        : new THREE.Texture();
  variant.source = baseTexture.source;
  variant.name = baseTexture.name;
  variant.mapping = baseTexture.mapping;
  variant.wrapS = options.wrapS ?? baseTexture.wrapS;
  variant.wrapT = options.wrapT ?? baseTexture.wrapT;
  variant.magFilter = baseTexture.magFilter;
  variant.minFilter = baseTexture.minFilter;
  variant.anisotropy = baseTexture.anisotropy;
  variant.format = baseTexture.format;
  variant.internalFormat = baseTexture.internalFormat;
  variant.type = baseTexture.type;
  variant.colorSpace = baseTexture.colorSpace;
  variant.flipY = baseTexture.flipY;
  variant.premultiplyAlpha = baseTexture.premultiplyAlpha;
  variant.unpackAlignment = baseTexture.unpackAlignment;
  variant.generateMipmaps = baseTexture.generateMipmaps;

  if (options.repeat) {
    variant.repeat.set(options.repeat[0], options.repeat[1]);
  } else {
    variant.repeat.copy(baseTexture.repeat);
  }
  if (options.offset) {
    variant.offset.set(options.offset[0], options.offset[1]);
  } else {
    variant.offset.copy(baseTexture.offset);
  }

  const rotation = options.rotation ?? baseTexture.rotation;
  if (options.center) {
    variant.center.set(options.center[0], options.center[1]);
  } else if (rotation !== 0 && baseTexture.center.x === 0 && baseTexture.center.y === 0) {
    variant.center.set(0.5, 0.5);
  } else {
    variant.center.copy(baseTexture.center);
  }
  variant.rotation = rotation;
  variant.version = Math.max(1, baseTexture.version);
  return variant;
}

export interface ScalarDataTextureOptions {
  readonly maxDimension?: number;
  readonly wrapS?: THREE.Wrapping;
  readonly wrapT?: THREE.Wrapping;
  readonly repeat?: readonly [number, number];
  readonly offset?: readonly [number, number];
  readonly center?: readonly [number, number];
  readonly rotation?: number;
  readonly anisotropy?: number;
  readonly flipY?: boolean;
}

function extractDownsampledRgbaPixels(
  sourceCanvas: HTMLCanvasElement,
  targetW: number,
  targetH: number
): Uint8ClampedArray | null {
  const srcW = Math.max(1, sourceCanvas.width);
  const srcH = Math.max(1, sourceCanvas.height);
  if (targetW === srcW && targetH === srcH) {
    const srcCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
    if (!srcCtx || typeof srcCtx.getImageData !== 'function') return null;
    return srcCtx.getImageData(0, 0, srcW, srcH).data;
  }

  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    if (!downsampleScratchCanvas || isRecordingCanvasStub(downsampleScratchCanvas)) {
      downsampleScratchCanvas = document.createElement('canvas');
    }
    if (!isRecordingCanvasStub(downsampleScratchCanvas)) {
      downsampleScratchCanvas.width = targetW;
      downsampleScratchCanvas.height = targetH;
      const scratchCtx = downsampleScratchCanvas.getContext('2d', { willReadFrequently: true });
      if (
        scratchCtx &&
        typeof scratchCtx.drawImage === 'function' &&
        typeof scratchCtx.getImageData === 'function'
      ) {
        scratchCtx.clearRect(0, 0, targetW, targetH);
        scratchCtx.drawImage(sourceCanvas, 0, 0, targetW, targetH);
        const pixels = scratchCtx.getImageData(0, 0, targetW, targetH).data;
        downsampleScratchCanvas.width = 0;
        downsampleScratchCanvas.height = 0;
        return pixels;
      }
    }
  }

  // Fallback box-filter downsample for headless pixel canvas stubs in unit tests
  const srcCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!srcCtx || typeof srcCtx.getImageData !== 'function') return null;
  const srcData = srcCtx.getImageData(0, 0, srcW, srcH).data;
  const out = new Uint8ClampedArray(targetW * targetH * 4);
  const scaleX = srcW / targetW;
  const scaleY = srcH / targetH;
  for (let y = 0; y < targetH; y++) {
    const sy0 = Math.min(srcH - 1, Math.floor(y * scaleY));
    const sy1 = Math.min(srcH - 1, Math.floor((y + 0.5) * scaleY));
    for (let x = 0; x < targetW; x++) {
      const sx0 = Math.min(srcW - 1, Math.floor(x * scaleX));
      const sx1 = Math.min(srcW - 1, Math.floor((x + 0.5) * scaleX));
      const i00 = (sy0 * srcW + sx0) * 4;
      const i10 = (sy0 * srcW + sx1) * 4;
      const i01 = (sy1 * srcW + sx0) * 4;
      const i11 = (sy1 * srcW + sx1) * 4;
      const dst = (y * targetW + x) * 4;
      out[dst] = (srcData[i00]! + srcData[i10]! + srcData[i01]! + srcData[i11]! + 2) >> 2;
      out[dst + 1] =
        (srcData[i00 + 1]! + srcData[i10 + 1]! + srcData[i01 + 1]! + srcData[i11 + 1]! + 2) >> 2;
      out[dst + 2] =
        (srcData[i00 + 2]! + srcData[i10 + 2]! + srcData[i01 + 2]! + srcData[i11 + 2]! + 2) >> 2;
      out[dst + 3] = 255;
    }
  }
  return out;
}

/**
 * Converts a scalar grayscale `HTMLCanvasElement` into a compact `THREE.DataTexture`
 * downsampled to `maxDimension` (default `512`):
 * - `channels = 1` (`THREE.RedFormat` / `R8`, 1 byte/px): for `bumpMap`, `displacementMap`, `clearcoatMap` (`.r` channel)
 * - `channels = 2` (`THREE.RGFormat` / `RG8`, 2 bytes/px with `.r = .g = val`): for `roughnessMap` (`.g` channel in Three.js PBR!).
 */
export function createScalarDataTextureFromCanvas(
  key: string,
  sourceCanvas: HTMLCanvasElement,
  channels: 1 | 2,
  options: ScalarDataTextureOptions = {}
): THREE.DataTexture | null {
  if (isRecordingCanvasStub(sourceCanvas)) {
    return null;
  }

  const maxDim = detectMobile()
    ? Math.min(options.maxDimension ?? 256, 256)
    : (options.maxDimension ?? 1024);
  const srcW = Math.max(1, sourceCanvas.width);
  const srcH = Math.max(1, sourceCanvas.height);
  const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
  const targetW =
    scale < 1 ? Math.max(4, Math.round((srcW * scale) / 4) * 4) : srcW;
  const targetH =
    scale < 1 ? Math.max(4, Math.round((srcH * scale) / 4) * 4) : srcH;

  const bufferKey = `${key}:c${channels}:${targetW}x${targetH}`;
  let cachedBuf = scalarDataCache.get(bufferKey);
  if (!cachedBuf) {
    const rgba = extractDownsampledRgbaPixels(sourceCanvas, targetW, targetH);
    if (!rgba) return null;
    const pixelCount = targetW * targetH;
    const data = new Uint8Array(pixelCount * channels);
    if (channels === 1) {
      for (let i = 0; i < pixelCount; i++) {
        data[i] = rgba[i * 4]!;
      }
    } else {
      for (let i = 0; i < pixelCount; i++) {
        const gVal = rgba[i * 4 + 1]!;
        data[i * 2] = gVal;
        data[i * 2 + 1] = gVal;
      }
    }
    cachedBuf = { data, width: targetW, height: targetH };
    scalarDataCache.set(bufferKey, cachedBuf);
  }

  const format = channels === 1 ? THREE.RedFormat : THREE.RGFormat;
  const tex = new THREE.DataTexture(
    cachedBuf.data,
    cachedBuf.width,
    cachedBuf.height,
    format,
    THREE.UnsignedByteType
  );
  tex.wrapS = options.wrapS ?? THREE.RepeatWrapping;
  tex.wrapT = options.wrapT ?? THREE.RepeatWrapping;
  if (options.repeat) tex.repeat.set(options.repeat[0], options.repeat[1]);
  if (options.offset) tex.offset.set(options.offset[0], options.offset[1]);
  if (options.center) tex.center.set(options.center[0], options.center[1]);
  tex.rotation = options.rotation ?? 0;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = options.anisotropy ?? (detectMobile() ? 4 : 8);
  tex.flipY = options.flipY ?? true;
  tex.unpackAlignment = 1;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

const compactedScalarDataTexCache = new Map<string, THREE.DataTexture>();

/**
 * Losslessly repacks a 4-channel RGBA8 `DataTexture` used purely as a scalar `.r`
 * (`bumpMap` / `clearcoatMap` / `displacementMap`) or `.g` (`roughnessMap`) map
 * into a 1-channel `RedFormat` (`R8`) or 2-channel `RGFormat` (`RG8`) `DataTexture`,
 * cutting GPU VRAM by 4x / 2x with bit-for-bit identical shader channel values.
 */
export function compactScalarRgbaDataTexture(
  key: string,
  sourceTex: THREE.DataTexture,
  channels: 1 | 2
): THREE.DataTexture | null {
  if (isSnapshotRecordingEnvironment()) return null;
  if (sourceTex.format !== THREE.RGBAFormat || sourceTex.type !== THREE.UnsignedByteType) {
    return null;
  }
  const img = sourceTex.image as
    | { data?: Uint8Array | Uint8ClampedArray; width?: number; height?: number }
    | undefined;
  if (!img || !img.data || typeof img.width !== "number" || typeof img.height !== "number") {
    return null;
  }
  const w = img.width;
  const h = img.height;
  const pixelCount = w * h;
  if (w <= 0 || h <= 0 || img.data.length < pixelCount * 4) return null;

  const cacheKey = `${key}:c${channels}:${w}x${h}`;
  const cached = compactedScalarDataTexCache.get(cacheKey);
  if (cached) return cached;

  const src = img.data;
  const dst = new Uint8Array(pixelCount * channels);
  if (channels === 1) {
    for (let i = 0; i < pixelCount; i++) {
      dst[i] = src[i * 4]!;
    }
  } else {
    for (let i = 0; i < pixelCount; i++) {
      dst[i * 2] = src[i * 4]!;
      dst[i * 2 + 1] = src[i * 4 + 1]!;
    }
  }

  const mobileCompact =
    detectMobile() && (w > 256 || h > 256) ? boxDownsampleTexels(dst, w, h, channels, 256) : null;
  const tex = new THREE.DataTexture(
    mobileCompact ? mobileCompact.data : dst,
    mobileCompact ? mobileCompact.width : w,
    mobileCompact ? mobileCompact.height : h,
    channels === 1 ? THREE.RedFormat : THREE.RGFormat,
    THREE.UnsignedByteType
  );
  tex.name = sourceTex.name;
  tex.wrapS = sourceTex.wrapS;
  tex.wrapT = sourceTex.wrapT;
  tex.repeat.copy(sourceTex.repeat);
  tex.offset.copy(sourceTex.offset);
  tex.center.copy(sourceTex.center);
  tex.rotation = sourceTex.rotation;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = sourceTex.anisotropy;
  tex.flipY = sourceTex.flipY;
  tex.unpackAlignment = 1;
  tex.magFilter = sourceTex.magFilter;
  tex.minFilter = sourceTex.minFilter;
  tex.generateMipmaps = sourceTex.generateMipmaps;
  tex.needsUpdate = true;
  compactedScalarDataTexCache.set(cacheKey, tex);
  return tex;
}

let mobileDownsampledBufferCache = new WeakMap<
  object,
  Map<number, DownsampledTexelBuffer | null>
>();
let mobileDownsampledTexCache = new WeakMap<THREE.DataTexture, Map<number, THREE.DataTexture>>();

function copyTextureUvTransform(target: THREE.Texture, source: THREE.Texture): void {
  target.wrapS = source.wrapS;
  target.wrapT = source.wrapT;
  target.repeat.copy(source.repeat);
  target.offset.copy(source.offset);
  target.center.copy(source.center);
  target.rotation = source.rotation;
  target.channel = source.channel;
  target.matrixAutoUpdate = source.matrixAutoUpdate;
  target.matrix.copy(source.matrix);
}

/**
 * On mobile (`detectMobile()`), returns a box-filtered copy of an 8-bit `RGBAFormat` /
 * `RGFormat` / `RedFormat` `DataTexture` whose longest edge exceeds `maxDimension`, sharing one
 * downsampled buffer per source `image.data` + `maxDimension`. Desktop, headless recording, and
 * textures that already fit return `tex` unchanged.
 */
export function downsampleDataTextureForMobile(
  tex: THREE.DataTexture,
  maxDimension = 512
): THREE.DataTexture {
  if (!isMobileTextureBudgetActive() || tex.type !== THREE.UnsignedByteType) return tex;
  const channels: 0 | 1 | 2 | 4 =
    tex.format === THREE.RGBAFormat
      ? 4
      : tex.format === THREE.RGFormat
        ? 2
        : tex.format === THREE.RedFormat
          ? 1
          : 0;
  if (channels === 0) return tex;
  const img = tex.image as { data?: unknown; width?: number; height?: number } | undefined;
  const srcData = img?.data;
  if (
    !img ||
    !(srcData instanceof Uint8Array || srcData instanceof Uint8ClampedArray) ||
    typeof img.width !== 'number' ||
    typeof img.height !== 'number' ||
    (img.width <= maxDimension && img.height <= maxDimension)
  ) {
    return tex;
  }

  let perTex = mobileDownsampledTexCache.get(tex);
  const cachedTex = perTex?.get(maxDimension);
  if (cachedTex) {
    copyTextureUvTransform(cachedTex, tex);
    return cachedTex;
  }

  let perBuffer = mobileDownsampledBufferCache.get(srcData);
  if (!perBuffer) {
    perBuffer = new Map();
    mobileDownsampledBufferCache.set(srcData, perBuffer);
  }
  let small = perBuffer.get(maxDimension);
  if (small === undefined) {
    small = boxDownsampleTexels(srcData, img.width, img.height, channels, maxDimension);
    perBuffer.set(maxDimension, small);
  }
  if (!small) return tex;

  const out = new THREE.DataTexture(
    small.data,
    small.width,
    small.height,
    tex.format as THREE.PixelFormat,
    tex.type
  );
  out.name = tex.name;
  out.mapping = tex.mapping;
  copyTextureUvTransform(out, tex);
  out.magFilter = tex.magFilter;
  out.minFilter = tex.minFilter;
  out.anisotropy = tex.anisotropy;
  out.internalFormat = tex.internalFormat;
  out.colorSpace = tex.colorSpace;
  out.flipY = tex.flipY;
  out.premultiplyAlpha = tex.premultiplyAlpha;
  out.unpackAlignment = channels === 4 ? tex.unpackAlignment : 1;
  out.generateMipmaps = tex.generateMipmaps;
  out.needsUpdate = true;

  if (!perTex) {
    perTex = new Map();
    mobileDownsampledTexCache.set(tex, perTex);
  }
  perTex.set(maxDimension, out);
  return out;
}

export interface RgbaDataTextureOptions extends ScalarDataTextureOptions {
  readonly colorSpace?: THREE.ColorSpace;
}

/**
 * Converts an `HTMLCanvasElement` into an RGBA8 `THREE.DataTexture` in browser runtime
 * (returning `null` for headless recording canvas stubs).
 * Eliminates deferred Skia 2D canvas flushes and `copyExternalImageToTexture` main-thread stalls.
 */
export function createRgbaDataTextureFromCanvas(
  key: string,
  sourceCanvas: HTMLCanvasElement,
  options: RgbaDataTextureOptions = {}
): THREE.DataTexture | null {
  if (isRecordingCanvasStub(sourceCanvas)) {
    return null;
  }
  const srcW = Math.max(1, sourceCanvas.width);
  const srcH = Math.max(1, sourceCanvas.height);
  const maxDim = detectMobile()
    ? Math.min(options.maxDimension ?? 512, Math.max(srcW, srcH) >= 1024 ? 512 : 256)
    : (options.maxDimension ?? Math.max(srcW, srcH));
  const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
  const targetW =
    scale < 1 ? Math.max(4, Math.round((srcW * scale) / 4) * 4) : srcW;
  const targetH =
    scale < 1 ? Math.max(4, Math.round((srcH * scale) / 4) * 4) : srcH;

  void key;
  const dimKey = `${targetW}x${targetH}`;
  let perCanvas = rgbaDataCache.get(sourceCanvas);
  if (!perCanvas) {
    perCanvas = new Map();
    rgbaDataCache.set(sourceCanvas, perCanvas);
  }
  let cachedBuf = perCanvas.get(dimKey);
  if (!cachedBuf) {
    const rgba = extractDownsampledRgbaPixels(sourceCanvas, targetW, targetH);
    if (!rgba) return null;
    const data = new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength).slice();
    cachedBuf = { data, width: targetW, height: targetH };
    perCanvas.set(dimKey, cachedBuf);
  }

  const tex = new THREE.DataTexture(
    cachedBuf.data,
    cachedBuf.width,
    cachedBuf.height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType
  );
  tex.wrapS = options.wrapS ?? THREE.RepeatWrapping;
  tex.wrapT = options.wrapT ?? THREE.RepeatWrapping;
  if (options.repeat) tex.repeat.set(options.repeat[0], options.repeat[1]);
  if (options.offset) tex.offset.set(options.offset[0], options.offset[1]);
  if (options.center) tex.center.set(options.center[0], options.center[1]);
  tex.rotation = options.rotation ?? 0;
  tex.colorSpace = options.colorSpace ?? THREE.SRGBColorSpace;
  tex.anisotropy = options.anisotropy ?? 8;
  tex.flipY = options.flipY ?? true;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Wraps a procedural `HTMLCanvasElement` in a `THREE.DataTexture` in browser runtime
 * (cast as `THREE.CanvasTexture` for API compatibility) while preserving `THREE.CanvasTexture`
 * for headless recording stubs and unit tests.
 */
export function createBrowserDataOrCanvasTexture(
  key: string,
  canvas: HTMLCanvasElement,
  options: RgbaDataTextureOptions = {}
): THREE.CanvasTexture {
  const dataTex = createRgbaDataTextureFromCanvas(key, canvas, options);
  if (dataTex) {
    return dataTex as unknown as THREE.CanvasTexture;
  }
  const tex = new THREE.CanvasTexture(canvas);
  if (options.wrapS !== undefined) tex.wrapS = options.wrapS;
  if (options.wrapT !== undefined) tex.wrapT = options.wrapT;
  if (options.repeat) tex.repeat.set(options.repeat[0], options.repeat[1]);
  if (options.offset) tex.offset.set(options.offset[0], options.offset[1]);
  if (options.center) tex.center.set(options.center[0], options.center[1]);
  if (options.rotation !== undefined) tex.rotation = options.rotation;
  if (options.colorSpace !== undefined) tex.colorSpace = options.colorSpace;
  if (options.anisotropy !== undefined) tex.anisotropy = options.anisotropy;
  if (options.flipY !== undefined) tex.flipY = options.flipY;
  return tex;
}

/**
 * Returns a pure CPU `THREE.DataTexture` directly from an `ImageData` buffer in browser runtime
 * (without calling `ctx.putImageData` or creating a Skia-backed `CanvasTexture`), while falling
 * back to `ctx.putImageData` + `THREE.CanvasTexture` for headless recording canvas stubs.
 */
export function createBrowserDataOrCanvasTextureFromImageData(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  imgData: ImageData,
  options: RgbaDataTextureOptions = {}
): THREE.CanvasTexture {
  if (!isRecordingCanvasStub(canvas)) {
    const isMobile = detectMobile();
    const fullRes = new Uint8Array(
      imgData.data.buffer,
      imgData.data.byteOffset,
      imgData.data.byteLength
    );
    const mobileFit =
      isMobile && (imgData.width > 512 || imgData.height > 512)
        ? boxDownsampleTexels(fullRes, imgData.width, imgData.height, 4, 512)
        : null;
    const tex = new THREE.DataTexture(
      mobileFit ? mobileFit.data : fullRes,
      mobileFit ? mobileFit.width : imgData.width,
      mobileFit ? mobileFit.height : imgData.height,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    );
    tex.wrapS = options.wrapS ?? THREE.RepeatWrapping;
    tex.wrapT = options.wrapT ?? THREE.RepeatWrapping;
    if (options.repeat) tex.repeat.set(options.repeat[0], options.repeat[1]);
    if (options.offset) tex.offset.set(options.offset[0], options.offset[1]);
    if (options.center) tex.center.set(options.center[0], options.center[1]);
    tex.rotation = options.rotation ?? 0;
    tex.colorSpace = options.colorSpace ?? THREE.SRGBColorSpace;
    tex.anisotropy = isMobile ? Math.min(options.anisotropy ?? 4, 4) : (options.anisotropy ?? 8);
    tex.flipY = options.flipY ?? true;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    canvas.width = 0;
    canvas.height = 0;
    return tex as unknown as THREE.CanvasTexture;
  }
  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  if (options.wrapS !== undefined) tex.wrapS = options.wrapS;
  if (options.wrapT !== undefined) tex.wrapT = options.wrapT;
  if (options.repeat) tex.repeat.set(options.repeat[0], options.repeat[1]);
  if (options.offset) tex.offset.set(options.offset[0], options.offset[1]);
  if (options.center) tex.center.set(options.center[0], options.center[1]);
  if (options.rotation !== undefined) tex.rotation = options.rotation;
  if (options.colorSpace !== undefined) tex.colorSpace = options.colorSpace;
  if (options.anisotropy !== undefined) tex.anisotropy = options.anisotropy;
  if (options.flipY !== undefined) tex.flipY = options.flipY;
  return tex;
}

/**
 * Releases 2D backing stores (`width = 0; height = 0;`) of static `HTMLCanvasElement`s
 * whose pixel data has already been converted to `DataTexture`s or uploaded to GPU VRAM,
 * skipping any dynamic runtime canvases in `retainedCanvases` and any `RecordingCanvasStub`,
 * and evicts zeroed canvases from `canvasCache` and `canvasPairCache`.
 */
export function releaseUploadedStaticCanvases(
  extraCanvases?: Iterable<HTMLCanvasElement>,
  retainedCanvases?: ReadonlySet<HTMLCanvasElement>
): number {
  const candidates = new Set<HTMLCanvasElement>();
  for (const canvas of canvasCache.values()) {
    candidates.add(canvas);
  }
  for (const [primary, secondary] of canvasPairCache.values()) {
    candidates.add(primary);
    candidates.add(secondary);
  }
  if (extraCanvases) {
    for (const canvas of extraCanvases) {
      candidates.add(canvas);
    }
  }

  let released = 0;
  for (const canvas of candidates) {
    if (!canvas || isRecordingCanvasStub(canvas)) continue;
    if (retainedCanvases?.has(canvas)) continue;
    if (canvas.width > 0 || canvas.height > 0) {
      canvas.width = 0;
      canvas.height = 0;
      released++;
    }
  }

  if (downsampleScratchCanvas && !isRecordingCanvasStub(downsampleScratchCanvas)) {
    downsampleScratchCanvas.width = 0;
    downsampleScratchCanvas.height = 0;
  }

  for (const [key, canvas] of canvasCache.entries()) {
    if (!isRecordingCanvasStub(canvas) && (canvas.width === 0 || canvas.height === 0)) {
      canvasCache.delete(key);
    }
  }
  for (const [key, [primary, secondary]] of canvasPairCache.entries()) {
    if (
      (!isRecordingCanvasStub(primary) && (primary.width === 0 || primary.height === 0)) ||
      (!isRecordingCanvasStub(secondary) && (secondary.width === 0 || secondary.height === 0))
    ) {
      canvasPairCache.delete(key);
    }
  }

  return released;
}

/**
 * Clears all memoized procedural canvases and textures from the registry.
 */
export function clearTextureRegistryCache(): void {
  rgbaDataCache = new WeakMap();
  mobileDownsampledBufferCache = new WeakMap();
  mobileDownsampledTexCache = new WeakMap();
  compactedScalarDataTexCache.clear();
  canvasCache.clear();
  canvasPairCache.clear();
  textureCache.clear();
  propTextureCache.clear();
  scalarDataCache.clear();
  statefulRecordingKeys.clear();
  downsampleScratchCanvas = null;
  cachedIsSnapshotRecordingEnv = null;
}
