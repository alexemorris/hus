/**
 * Three.js property scene -> binary glTF 2.0 (`.glb`) exporter.
 *
 * `GLTFExporter` (three r180) has four texture limitations this module works around:
 * - it throws on a `DataTexture` `roughnessMap` / `metalnessMap` (`drawImage` on `{ data, width, height }`),
 * - it only understands `RGBAFormat` data textures (`RGFormat` / `RedFormat` come out garbled),
 * - it ignores `flipY` for data textures (`putImageData` is not affected by the canvas transform),
 * - it writes `bumpMap` as the non-standard `EXT_materials_bump` extension.
 *
 * Every exported material is therefore rebuilt as a clean `MeshStandardMaterial` /
 * `MeshPhysicalMaterial` / `MeshBasicMaterial` whose data textures are repainted onto canvases and
 * whose procedural bump maps are converted to tangent-space normal maps.
 */

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

export interface HeightfieldNormalOptions {
  /** Multiplier applied to the height derivatives (default `1`). */
  readonly strength?: number;
  /** Wrap horizontally instead of clamping at the left/right edges. */
  readonly wrapS?: boolean;
  /** Wrap vertically instead of clamping at the top/bottom edges. */
  readonly wrapT?: boolean;
}

function buildNeighbourLut(size: number, delta: number, wrap: boolean): Int32Array {
  const lut = new Int32Array(size);
  for (let i = 0; i < size; i++) {
    const j = i + delta;
    lut[i] = wrap ? ((j % size) + size) % size : Math.max(0, Math.min(size - 1, j));
  }
  return lut;
}

function heightfieldToNormalRgba(
  heights: Float32Array,
  width: number,
  height: number,
  strength: number,
  wrapS: boolean,
  wrapT: boolean,
  ySign: 1 | -1
): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid heightfield size ${width}x${height}`);
  }
  if (heights.length < width * height) {
    throw new Error(
      `Heightfield buffer length ${heights.length} is smaller than ${width}x${height}`
    );
  }

  const xm2 = buildNeighbourLut(width, -2, wrapS);
  const xm1 = buildNeighbourLut(width, -1, wrapS);
  const xp1 = buildNeighbourLut(width, 1, wrapS);
  const xp2 = buildNeighbourLut(width, 2, wrapS);
  const ym2 = buildNeighbourLut(height, -2, wrapT);
  const ym1 = buildNeighbourLut(height, -1, wrapT);
  const yp1 = buildNeighbourLut(height, 1, wrapT);
  const yp2 = buildNeighbourLut(height, 2, wrapT);

  const out = new Uint8Array(width * height * 4);
  const toByte = (v: number): number =>
    Math.max(0, Math.min(255, Math.round((v * 0.5 + 0.5) * 255)));

  for (let y = 0; y < height; y++) {
    const rowM2 = ym2[y]! * width;
    const rowM1 = ym1[y]! * width;
    const row0 = y * width;
    const rowP1 = yp1[y]! * width;
    const rowP2 = yp2[y]! * width;

    for (let x = 0; x < width; x++) {
      const l = xm1[x]!;
      const r = xp1[x]!;

      const tl = heights[rowM1 + l]!;
      const tc = heights[rowM1 + x]!;
      const tr = heights[rowM1 + r]!;
      const ml = heights[row0 + l]!;
      const mr = heights[row0 + r]!;
      const bl = heights[rowP1 + l]!;
      const bc = heights[rowP1 + x]!;
      const br = heights[rowP1 + r]!;

      const sobelX = (tr + 2 * mr + br - (tl + 2 * ml + bl)) * 0.125;
      const sobelY = (bl + 2 * bc + br - (tl + 2 * tc + tr)) * 0.125;
      const wideX = (heights[row0 + xp2[x]!]! - heights[row0 + xm2[x]!]!) * 0.25;
      const wideY = (heights[rowP2 + x]! - heights[rowM2 + x]!) * 0.25;

      const dX = sobelX * 0.72 + wideX * 0.28;
      const dY = sobelY * 0.72 + wideY * 0.28;

      const nx = -dX * strength;
      const ny = dY * strength * ySign;
      const invLen = 1 / Math.sqrt(nx * nx + ny * ny + 1);

      const o = (row0 + x) * 4;
      out[o] = toByte(nx * invLen);
      out[o + 1] = toByte(ny * invLen);
      out[o + 2] = toByte(invLen);
      out[o + 3] = 255;
    }
  }
  return out;
}

/**
 * Converts a row-major heightfield into tangent-space normal RGBA bytes using a 3x3 Sobel
 * blended with a wide 5-tap gradient. A flat field yields `[128, 128, 255, 255]`.
 *
 * Rows are assumed to run top-to-bottom (row 0 at `v = 1`, i.e. a `flipY = true` texture), so a
 * height increasing with the row index produces green above 128.
 */
export function convertHeightfieldToNormalRgba(
  heights: Float32Array,
  width: number,
  height: number,
  options: HeightfieldNormalOptions = {}
): Uint8Array {
  return heightfieldToNormalRgba(
    heights,
    width,
    height,
    options.strength ?? 1,
    options.wrapS === true,
    options.wrapT === true,
    1
  );
}

const EXCLUDED_USER_DATA_FLAGS = [
  'excludeFromExport',
  'isShadowPassHook',
  'isAnnotationGroup',
  'isWeatherOverlay',
  'isSecurityFovCone',
  'isFittingFx',
] as const;

const EXCLUDED_NAMES: ReadonlySet<string> = new Set([
  'ufh.heatingPipesLayer',
  '__fullSceneShaderWarmupGroup',
]);

const EXCLUDED_NAME_PREFIXES = ['__hus_weather', '__cutawayShadowPass', 'unifi.frustum'] as const;

type MaterialSlot = THREE.Material | null | undefined;

function materialSlots(material: MaterialSlot | readonly MaterialSlot[]): readonly MaterialSlot[] {
  return Array.isArray(material) ? material : [material as MaterialSlot];
}

/** True for materials that never contribute visible, exportable surface colour. */
function isNonExportableMaterial(material: MaterialSlot): boolean {
  if (!material) return true;
  if (material.visible === false || material.colorWrite === false) return true;
  if (material.transparent === true && material.opacity <= 0.001 && material.depthWrite === false) {
    return true;
  }
  return material.blending === THREE.AdditiveBlending;
}

/** Helper subtrees flagged by `userData` or by a reserved object name. */
function isExcludedHelperSubtree(obj: THREE.Object3D): boolean {
  const userData = obj.userData as Record<string, unknown> | undefined;
  if (userData) {
    for (const flag of EXCLUDED_USER_DATA_FLAGS) {
      if (userData[flag] === true) return true;
    }
  }
  const name = obj.name;
  if (EXCLUDED_NAMES.has(name)) return true;
  return EXCLUDED_NAME_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/** Meshes whose every material slot is invisible, and additive helper lines / points. */
function hasNoExportableSurface(obj: THREE.Object3D): boolean {
  const renderable = obj as Partial<THREE.Mesh & THREE.Line & THREE.Points>;
  if (renderable.isLine === true || renderable.isPoints === true) {
    return materialSlots(renderable.material).some(
      (m) => m?.blending === THREE.AdditiveBlending
    );
  }
  if (renderable.isMesh === true) {
    return materialSlots(renderable.material).every(isNonExportableMaterial);
  }
  return false;
}

/**
 * True when `obj` must not appear in an exported `.glb`: annotation / weather / security / FX
 * helpers, shadow-pass hooks, the UFH pipe overlay, the shader warm-up group, additive glow
 * decals and meshes that only carry invisible (collision / x-ray) materials.
 */
export function shouldExcludeObjectFromGlbExport(obj: THREE.Object3D): boolean {
  return isExcludedHelperSubtree(obj) || hasNoExportableSurface(obj);
}

type ExportCanvas = HTMLCanvasElement | OffscreenCanvas;
type ExportContext2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface PixelBufferImage {
  readonly data: ArrayLike<number>;
  readonly width: number;
  readonly height: number;
}

type DrawableImage = HTMLImageElement | HTMLCanvasElement | ImageBitmap | OffscreenCanvas;

export interface GlbExportSessionOptions {
  /** Largest texture edge written to the `.glb` (default `2048`). */
  readonly maxTextureSize?: number;
}

/** Per-export caches so shared textures and materials stay shared in the `.glb`. */
export interface GlbExportSession {
  readonly maxTextureSize: number;
  readonly textures: Map<string, THREE.Texture | null>;
  readonly normalMaps: Map<string, THREE.Texture | null>;
  readonly materials: Map<THREE.Material, THREE.Material>;
  convertedBumpMaps: number;
  strippedTextures: number;
}

export function createGlbExportSession(options: GlbExportSessionOptions = {}): GlbExportSession {
  return {
    maxTextureSize: options.maxTextureSize ?? 2048,
    textures: new Map(),
    normalMaps: new Map(),
    materials: new Map(),
    convertedBumpMaps: 0,
    strippedTextures: 0,
  };
}

function createExportCanvas(width: number, height: number): ExportCanvas | null {
  if (!(width > 0) || !(height > 0)) return null;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  return null;
}

function getExportContext2D(canvas: ExportCanvas): ExportContext2D | null {
  return (canvas as HTMLCanvasElement).getContext('2d', {
    willReadFrequently: true,
  }) as ExportContext2D | null;
}

function isPixelBufferImage(image: unknown): image is PixelBufferImage {
  if (!image || typeof image !== 'object') return false;
  const candidate = image as Partial<PixelBufferImage>;
  return (
    candidate.data !== undefined &&
    candidate.data !== null &&
    typeof candidate.data.length === 'number' &&
    typeof candidate.width === 'number' &&
    typeof candidate.height === 'number'
  );
}

function isDrawableImage(image: unknown): image is DrawableImage {
  return (
    (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement) ||
    (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) ||
    (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) ||
    (typeof OffscreenCanvas !== 'undefined' && image instanceof OffscreenCanvas)
  );
}

/** Scale that maps a pixel buffer's sample range onto `0..255`, or `null` when unsupported. */
function pixelBufferByteScale(data: ArrayLike<number>): number | null {
  if (data instanceof Uint8Array || data instanceof Uint8ClampedArray) return 1;
  if (data instanceof Float32Array || data instanceof Float64Array) return 255;
  return null;
}

function pixelBufferChannelCount(image: PixelBufferImage, format: THREE.AnyPixelFormat): number {
  if (format === THREE.RGBAFormat) return 4;
  if (format === THREE.RGFormat) return 2;
  if (format === THREE.RedFormat) return 1;
  return Math.floor(image.data.length / (image.width * image.height));
}

/**
 * Expands 1 / 2 / 3 / 4-channel pixel data to RGBA: `Red -> [r, r, r, 255]`,
 * `RG -> [r, g, g, 255]` (keeps roughness in G, where glTF expects it), `RGB -> [r, g, b, 255]`.
 */
function expandPixelBufferToRgba(
  image: PixelBufferImage,
  format: THREE.AnyPixelFormat
): Uint8ClampedArray | null {
  const texels = image.width * image.height;
  const scale = pixelBufferByteScale(image.data);
  if (!(texels > 0) || scale === null) return null;
  const channels = pixelBufferChannelCount(image, format);
  if (channels < 1 || channels > 4 || image.data.length < texels * channels) return null;

  const { data } = image;
  const out = new Uint8ClampedArray(texels * 4);
  for (let i = 0, p = 0, o = 0; i < texels; i++, p += channels, o += 4) {
    const r = data[p]! * scale;
    const g = channels >= 2 ? data[p + 1]! * scale : r;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = channels >= 3 ? data[p + 2]! * scale : g;
    out[o + 3] = channels === 4 ? data[p + 3]! * scale : 255;
  }
  return out;
}

function createCanvasTextureFromRgba(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): THREE.CanvasTexture | null {
  const canvas = createExportCanvas(width, height);
  const ctx = canvas ? getExportContext2D(canvas) : null;
  if (!canvas || !ctx) return null;
  const imageData = ctx.createImageData(width, height);
  imageData.data.set(rgba);
  ctx.putImageData(imageData, 0, 0);
  return new THREE.CanvasTexture(canvas as HTMLCanvasElement);
}

/**
 * Copies sampling state. `flipY` is carried over unchanged and pixel rows are never reordered:
 * row 0 of a pixel buffer and row 0 (top) of a canvas both sit at `v = 1` when `flipY` is true
 * and at `v = 0` when it is false, and `GLTFExporter.processImage` honours `flipY` for canvases.
 */
function copyTextureSampling(source: THREE.Texture, target: THREE.Texture): void {
  target.name = source.name;
  target.wrapS = source.wrapS;
  target.wrapT = source.wrapT;
  target.magFilter = source.magFilter;
  target.minFilter = source.minFilter;
  target.repeat.copy(source.repeat);
  target.offset.copy(source.offset);
  target.center.copy(source.center);
  target.rotation = source.rotation;
  target.channel = source.channel;
  target.flipY = source.flipY;
}

/**
 * Returns a texture `GLTFExporter` can write, or `null` when it has to be dropped.
 *
 * Pixel-buffer textures (`DataTexture`, `ImageData`) are repainted onto a canvas with the given
 * `colorSpace`; image / canvas / bitmap textures with a non-zero size pass through untouched;
 * anything else (empty `0x0` canvases, unloaded images, compressed or half-float data, video) is
 * stripped so the export never throws.
 */
export function normalizeTextureForGlbExport(
  texture: THREE.Texture | null | undefined,
  colorSpace: THREE.ColorSpace,
  session: GlbExportSession
): THREE.Texture | null {
  if (!texture) return null;
  const key = `${texture.uuid}|${colorSpace}`;
  const cached = session.textures.get(key);
  if (cached !== undefined) return cached;

  let result: THREE.Texture | null = null;
  const image: unknown = texture.image;
  const isCompressed = (texture as Partial<THREE.CompressedTexture>).isCompressedTexture === true;
  if (isCompressed) {
    result = null;
  } else if (isPixelBufferImage(image)) {
    const rgba = expandPixelBufferToRgba(image, texture.format);
    const canvasTexture = rgba
      ? createCanvasTextureFromRgba(rgba, image.width, image.height)
      : null;
    if (canvasTexture) {
      copyTextureSampling(texture, canvasTexture);
      canvasTexture.colorSpace = colorSpace;
      result = canvasTexture;
    }
  } else if (isDrawableImage(image) && image.width > 0 && image.height > 0) {
    result = texture;
  }

  if (!result) session.strippedTextures++;
  session.textures.set(key, result);
  return result;
}

interface Heightfield {
  readonly heights: Float32Array;
  readonly width: number;
  readonly height: number;
}

/** Reads the red channel of a bump texture as heights in `[0..1]`, rows in storage order. */
function readBumpHeightfield(texture: THREE.Texture, session: GlbExportSession): Heightfield | null {
  const image: unknown = texture.image;

  if (isPixelBufferImage(image)) {
    const texels = image.width * image.height;
    const scale = pixelBufferByteScale(image.data);
    if (!(texels > 0) || scale === null) return null;
    const channels = pixelBufferChannelCount(image, texture.format);
    if (channels < 1 || image.data.length < texels * channels) return null;
    const heights = new Float32Array(texels);
    for (let i = 0, p = 0; i < texels; i++, p += channels) {
      heights[i] = Math.max(0, Math.min(1, (image.data[p]! * scale) / 255));
    }
    return { heights, width: image.width, height: image.height };
  }

  if (!isDrawableImage(image) || !(image.width > 0) || !(image.height > 0)) return null;
  const width = Math.min(image.width, session.maxTextureSize);
  const height = Math.min(image.height, session.maxTextureSize);
  const canvas = createExportCanvas(width, height);
  const ctx = canvas ? getExportContext2D(canvas) : null;
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, width, height);
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const heights = new Float32Array(width * height);
  for (let i = 0; i < heights.length; i++) {
    heights[i] = rgba[i * 4]! / 255;
  }
  return { heights, width, height };
}

/**
 * Replaces `material.bumpMap` with an equivalent tangent-space `normalMap` (when the material has
 * no normal map yet) so `GLTFExporter` writes a standard `normalTexture` instead of
 * `EXT_materials_bump`. Mutates `material`: only call it on export copies. Returns true when a
 * normal map was assigned; `bumpMap` is cleared either way.
 */
export function convertBumpMapToNormalMap(
  material: THREE.MeshStandardMaterial,
  session: GlbExportSession
): boolean {
  const bumpMap = material.bumpMap;
  if (!bumpMap || material.normalMap) return false;

  const strength = Math.max(0.35, Math.min(12, Math.abs(material.bumpScale || 1) * 18));
  // A leftover non-default bumpScale alone still makes GLTFExporter emit EXT_materials_bump.
  material.bumpMap = null;
  material.bumpScale = 1;
  const key = `${bumpMap.uuid}|${strength}`;
  let normalMap = session.normalMaps.get(key);
  if (normalMap === undefined) {
    normalMap = null;
    const field = readBumpHeightfield(bumpMap, session);
    if (field) {
      const rgba = heightfieldToNormalRgba(
        field.heights,
        field.width,
        field.height,
        strength,
        bumpMap.wrapS === THREE.RepeatWrapping,
        bumpMap.wrapT === THREE.RepeatWrapping,
        bumpMap.flipY ? 1 : -1
      );
      normalMap = createCanvasTextureFromRgba(rgba, field.width, field.height);
      if (normalMap) {
        copyTextureSampling(bumpMap, normalMap);
        normalMap.name = `${bumpMap.name || material.name || 'bump'}.normal`;
        normalMap.colorSpace = THREE.NoColorSpace;
      }
    }
    if (!normalMap) session.strippedTextures++;
    session.normalMaps.set(key, normalMap);
  }
  if (!normalMap) return false;

  material.normalMap = normalMap;
  material.normalScale = new THREE.Vector2(1, 1);
  session.convertedBumpMaps++;
  return true;
}

type MaterialSource = THREE.Material &
  Partial<
    Omit<THREE.MeshPhysicalMaterial, keyof THREE.Material | 'isMeshPhysicalMaterial'> & {
      isMeshBasicMaterial: boolean;
      isMeshPhysicalMaterial: boolean;
    }
  >;

function isColor(value: unknown): value is THREE.Color {
  return (value as Partial<THREE.Color> | null | undefined)?.isColor === true;
}

function copyCommonMaterialState(source: MaterialSource, target: THREE.Material): void {
  target.name = source.name;
  target.opacity = source.opacity;
  target.transparent = source.transparent;
  target.alphaTest = source.alphaTest;
  target.side = source.side;
  target.vertexColors = source.vertexColors;
}

function copyPhysicalScalars(source: MaterialSource, target: THREE.MeshPhysicalMaterial): void {
  const scalarKeys = [
    'clearcoat',
    'clearcoatRoughness',
    'transmission',
    'ior',
    'thickness',
    'attenuationDistance',
    'sheen',
    'sheenRoughness',
    'specularIntensity',
  ] as const;
  for (const key of scalarKeys) {
    const value = source[key];
    if (typeof value === 'number') target[key] = value;
  }
  if (isColor(source.attenuationColor)) target.attenuationColor.copy(source.attenuationColor);
  if (isColor(source.sheenColor)) target.sheenColor.copy(source.sheenColor);
  if (isColor(source.specularColor)) target.specularColor.copy(source.specularColor);
}

/**
 * Builds (and caches per source material) a clean glTF-friendly copy: only standard PBR
 * properties are carried over, so custom node / shader hooks on the source never reach the
 * exporter, textures are normalised and bump maps become normal maps.
 */
export function prepareMaterialForGlbExport(
  source: THREE.Material,
  session: GlbExportSession
): THREE.Material {
  const cached = session.materials.get(source);
  if (cached) return cached;

  const src = source as MaterialSource;
  let result: THREE.Material;

  if (src.isMeshBasicMaterial === true) {
    const basic = new THREE.MeshBasicMaterial();
    copyCommonMaterialState(src, basic);
    if (isColor(src.color)) basic.color.copy(src.color);
    basic.map = normalizeTextureForGlbExport(src.map, THREE.SRGBColorSpace, session);
    result = basic;
  } else {
    const pbr =
      src.isMeshPhysicalMaterial === true
        ? new THREE.MeshPhysicalMaterial()
        : new THREE.MeshStandardMaterial();
    copyCommonMaterialState(src, pbr);
    if (Boolean(src.userData?.isVegetationMaterial)) {
      pbr.vertexColors = true;
    }
    if (isColor(src.color)) pbr.color.copy(src.color);
    pbr.map = normalizeTextureForGlbExport(src.map, THREE.SRGBColorSpace, session);
    pbr.roughness = typeof src.roughness === 'number' ? src.roughness : 1;
    pbr.metalness = typeof src.metalness === 'number' ? src.metalness : 0;
    pbr.roughnessMap = normalizeTextureForGlbExport(src.roughnessMap, THREE.NoColorSpace, session);
    pbr.metalnessMap = normalizeTextureForGlbExport(src.metalnessMap, THREE.NoColorSpace, session);
    pbr.normalMap = normalizeTextureForGlbExport(src.normalMap, THREE.NoColorSpace, session);
    if (src.normalScale) pbr.normalScale.copy(src.normalScale);
    pbr.aoMap = normalizeTextureForGlbExport(src.aoMap, THREE.NoColorSpace, session);
    if (typeof src.aoMapIntensity === 'number') pbr.aoMapIntensity = src.aoMapIntensity;
    if (isColor(src.emissive)) pbr.emissive.copy(src.emissive);
    pbr.emissiveMap = normalizeTextureForGlbExport(src.emissiveMap, THREE.SRGBColorSpace, session);
    if (typeof src.emissiveIntensity === 'number') pbr.emissiveIntensity = src.emissiveIntensity;
    pbr.flatShading = src.flatShading === true;

    if (src.bumpMap && !pbr.normalMap) {
      pbr.bumpMap = src.bumpMap;
      pbr.bumpScale = typeof src.bumpScale === 'number' ? src.bumpScale : 1;
      convertBumpMapToNormalMap(pbr, session);
    }
    if (pbr instanceof THREE.MeshPhysicalMaterial) copyPhysicalScalars(src, pbr);
    result = pbr;
  }

  session.materials.set(source, result);
  return result;
}

export interface GlbExportSceneBuild {
  readonly exportScene: THREE.Scene;
  readonly meshCount: number;
  readonly materialCount: number;
  readonly convertedBumpMaps: number;
}

interface SceneBuildState {
  readonly session: GlbExportSession;
  readonly usedMaterials: Set<THREE.Material>;
  meshCount: number;
}

/** Shares `geometry`'s buffers but keeps only the draw groups of the listed material slots. */
function geometryWithMaterialSlots(
  geometry: THREE.BufferGeometry,
  keptSlots: readonly number[]
): THREE.BufferGeometry | null {
  const remap = new Map(keptSlots.map((slot, index) => [slot, index] as const));
  const filtered = new THREE.BufferGeometry();
  filtered.name = geometry.name;
  filtered.setIndex(geometry.index);
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    filtered.setAttribute(name, attribute);
  }
  filtered.morphAttributes = geometry.morphAttributes;
  filtered.morphTargetsRelative = geometry.morphTargetsRelative;
  for (const group of geometry.groups) {
    const slot = group.materialIndex === undefined ? undefined : remap.get(group.materialIndex);
    if (slot !== undefined) filtered.addGroup(group.start, group.count, slot);
  }
  return filtered.groups.length > 0 ? filtered : null;
}

function buildExportMesh(source: THREE.Mesh, state: SceneBuildState): THREE.Mesh | null {
  let geometry: THREE.BufferGeometry | null = source.geometry ?? null;
  const position = geometry?.getAttribute('position');
  if (!geometry || !position || position.count === 0) return null;

  const prepare = (material: THREE.Material): THREE.Material => {
    const prepared = prepareMaterialForGlbExport(material, state.session);
    state.usedMaterials.add(prepared);
    return prepared;
  };

  let material: THREE.Material | THREE.Material[];
  if (Array.isArray(source.material)) {
    const slots: readonly MaterialSlot[] = source.material;
    const keptSlots: number[] = [];
    slots.forEach((slot, index) => {
      if (!isNonExportableMaterial(slot)) keptSlots.push(index);
    });
    if (keptSlots.length < slots.length) {
      geometry = geometryWithMaterialSlots(geometry, keptSlots);
      if (!geometry) return null;
    }
    material = keptSlots.map((index) => prepare(slots[index]!));
  } else {
    material = prepare(source.material);
  }

  const instanced = source as Partial<THREE.InstancedMesh>;
  if (instanced.isInstancedMesh === true && instanced.instanceMatrix) {
    const count = instanced.count ?? 0;
    if (count <= 0) return null;
    const copy = new THREE.InstancedMesh(geometry, material, count);
    copy.instanceMatrix = instanced.instanceMatrix;
    copy.instanceColor = instanced.instanceColor ?? null;
    state.meshCount++;
    return copy;
  }

  state.meshCount++;
  return new THREE.Mesh(geometry, material);
}

function hasExportRoomMetadata(source: THREE.Object3D): boolean {
  const ud = source.userData as Record<string, unknown> | undefined;
  return Boolean(ud && (ud.roomFinishes !== undefined || ud.roomNotes !== undefined));
}

function copyExportRoomMetadata(source: THREE.Object3D, target: THREE.Object3D): void {
  const ud = source.userData as Record<string, unknown> | undefined;
  if (!ud) return;
  const extras: Record<string, unknown> = {};
  if (ud.roomFinishes !== undefined) extras.roomFinishes = ud.roomFinishes;
  if (ud.roomNotes !== undefined) extras.roomNotes = ud.roomNotes;
  if (extras.roomFinishes !== undefined || extras.roomNotes !== undefined) {
    if (typeof ud.zoneId === 'string') extras.zoneId = ud.zoneId;
    else if (typeof ud.zone === 'string') extras.zoneId = ud.zone;
    if (typeof ud.roomLabel === 'string') extras.roomLabel = ud.roomLabel;
    target.userData = { ...target.userData, ...extras };
  }
}

function cloneExportNode(source: THREE.Object3D, state: SceneBuildState): THREE.Object3D | null {
  if (!source.visible || isExcludedHelperSubtree(source)) return null;

  let node: THREE.Object3D | null = null;
  if ((source as Partial<THREE.Mesh>).isMesh === true && !hasNoExportableSurface(source)) {
    node = buildExportMesh(source as THREE.Mesh, state);
  }

  const children: THREE.Object3D[] = [];
  for (const child of source.children) {
    const clone = cloneExportNode(child, state);
    if (clone) children.push(clone);
  }

  if (!node) {
    if (children.length === 0 && !hasExportRoomMetadata(source)) return null;
    node = new THREE.Group();
  }

  node.name = source.name;
  node.matrixAutoUpdate = false;
  node.matrix.copy(source.matrix);
  copyExportRoomMetadata(source, node);
  for (const child of children) node.add(child);
  return node;
}

/**
 * Clones the visible hierarchy under `root` into a fresh `THREE.Scene` containing only groups and
 * exportable meshes. Lights, cameras, lines, points, sprites and excluded helpers are dropped,
 * and groups left without any mesh descendant are pruned. Local transforms are preserved, so
 * `root.updateMatrixWorld(true)` must have run first. Geometry buffers are shared, not copied.
 */
export function buildGlbExportScene(
  root: THREE.Object3D,
  options: GlbExportSessionOptions & { readonly sceneName?: string } = {}
): GlbExportSceneBuild {
  const session = createGlbExportSession(options);
  const state: SceneBuildState = { session, usedMaterials: new Set(), meshCount: 0 };

  const exportScene = new THREE.Scene();
  exportScene.name = options.sceneName ?? 'HusjsPropertyScene';
  if ((root as Partial<THREE.Scene>).isScene === true && root.userData?.roomFinishes !== undefined) {
    exportScene.userData = { ...exportScene.userData, roomFinishes: root.userData.roomFinishes };
  }

  const sources = (root as Partial<THREE.Scene>).isScene === true ? root.children : [root];
  for (const source of sources) {
    const clone = cloneExportNode(source, state);
    if (clone) exportScene.add(clone);
  }

  if (session.strippedTextures > 0) {
    console.warn(
      `[glb-scene-exporter] Dropped ${session.strippedTextures} texture(s) that cannot be written to glTF (empty, unloaded or unsupported pixel data).`
    );
  }

  return {
    exportScene,
    meshCount: state.meshCount,
    materialCount: state.usedMaterials.size,
    convertedBumpMaps: session.convertedBumpMaps,
  };
}

export interface ExportedCameraPreset {
  readonly id: string;
  readonly position: [number, number, number];
  readonly target: [number, number, number];
  readonly fovDeg?: number;
}

export interface GlbSceneExportResult {
  readonly glbBytes: Uint8Array;
  readonly meshCount: number;
  readonly materialCount: number;
  readonly convertedBumpMaps: number;
  readonly cameraPresets: readonly ExportedCameraPreset[];
}

interface Vec3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** The subset of a `PropertyScene` / `ViewerComposition` the exporter relies on. */
export interface GlbExportViewerLike {
  readonly scene: THREE.Object3D;
  readonly staticScene?: {
    readonly batchOptimizer?: { isBatched(): boolean; unbatchAll(): void };
  };
  readonly camera?: { readonly rig?: { readonly perspCamera?: { readonly fov?: number } } };
  setTradeView?(view: 'owner'): void;
  setUfhLayerVisible?(visible: boolean): void;
  setFloorViewMode?(mode: 'all'): void;
  isCeilingCutaway?(): boolean;
  toggleCeilingCutaway?(): unknown;
  setLodPolicyMode?(mode: 'lod2'): void;
  getPropertyName?(): string | undefined;
  getZoneRegistry?(): {
    getAllCameraPresets?(): readonly {
      readonly id: string;
      readonly pos: Vec3Like;
      readonly target: Vec3Like;
    }[];
  };
}

export type GlbExportSource = GlbExportViewerLike | THREE.Object3D;

export interface GlbSceneExportOptions extends GlbExportSessionOptions {
  /** Overrides the exported scene name (default: the viewer's property name). */
  readonly sceneName?: string;
}

function isObject3D(source: GlbExportSource): source is THREE.Object3D {
  return (source as Partial<THREE.Object3D>).isObject3D === true;
}

/**
 * Puts a viewer into its export state and returns the scene root to export: batches are undone,
 * the owner trade view, all floors and the highest-detail LOD are selected, the UFH overlay and
 * the ceiling cutaway are switched off, and world matrices are refreshed.
 *
 * These view-state changes are left in place afterwards. A bare `Object3D` only gets its
 * matrices refreshed.
 */
export function preparePropertySceneForExport(source: GlbExportSource): THREE.Object3D {
  if (isObject3D(source)) {
    source.updateMatrixWorld(true);
    return source;
  }

  const viewer = source;
  const batchOptimizer = viewer.staticScene?.batchOptimizer;
  if (batchOptimizer?.isBatched()) {
    batchOptimizer.unbatchAll();
  }
  viewer.setTradeView?.('owner');
  viewer.setUfhLayerVisible?.(false);
  viewer.setFloorViewMode?.('all');
  if (viewer.isCeilingCutaway?.()) {
    viewer.toggleCeilingCutaway?.();
  }
  viewer.setLodPolicyMode?.('lod2');

  viewer.scene.updateMatrixWorld(true);
  return viewer.scene;
}

/** Camera presets registered on the viewer's zone registry, as plain Y-up tuples. */
export function collectExportCameraPresets(source: GlbExportSource): ExportedCameraPreset[] {
  if (isObject3D(source)) return [];
  const presets = source.getZoneRegistry?.().getAllCameraPresets?.() ?? [];
  const fov = source.camera?.rig?.perspCamera?.fov;
  const fovDeg = typeof fov === 'number' && Number.isFinite(fov) ? fov : undefined;
  return presets.map((preset) => ({
    id: preset.id,
    position: [preset.pos.x, preset.pos.y, preset.pos.z],
    target: [preset.target.x, preset.target.y, preset.target.z],
    ...(fovDeg !== undefined ? { fovDeg } : {}),
  }));
}

/**
 * Exports a viewer (or a bare scene) to a binary `.glb`.
 *
 * Needs a browser-like environment: `GLTFExporter` relies on `FileReader`, and textures are only
 * written when a 2D canvas is available.
 */
export async function exportPropertySceneToGlb(
  source: GlbExportSource,
  options: GlbSceneExportOptions = {}
): Promise<GlbSceneExportResult> {
  if (typeof FileReader === 'undefined') {
    throw new Error(
      'exportPropertySceneToGlb needs a browser-like environment (FileReader is not available).'
    );
  }

  const root = preparePropertySceneForExport(source);
  const propertyName = isObject3D(source) ? undefined : source.getPropertyName?.();
  const maxTextureSize = options.maxTextureSize ?? 2048;
  const build = buildGlbExportScene(root, {
    maxTextureSize,
    sceneName: options.sceneName ?? propertyName ?? 'HusjsPropertyScene',
  });

  const output = await new GLTFExporter().parseAsync(build.exportScene, {
    binary: true,
    onlyVisible: true,
    maxTextureSize,
  });
  if (!(output instanceof ArrayBuffer)) {
    throw new Error('GLTFExporter did not return binary .glb data.');
  }

  return {
    glbBytes: new Uint8Array(output),
    meshCount: build.meshCount,
    materialCount: build.materialCount,
    convertedBumpMaps: build.convertedBumpMaps,
    cameraPresets: collectExportCameraPresets(source),
  };
}
