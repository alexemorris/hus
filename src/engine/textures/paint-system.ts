/**
 * Physical Architectural Paint System (`husjs/materials`).
 *
 * Models real interior and exterior architectural paint finishes (`Dead Flat`,
 * `Estate Emulsion`, `Modern Emulsion`, `Limewash`, `Estate Eggshell`,
 * `Exterior Eggshell`, `Satinwood`, `Modern Eggshell`, `Full Gloss`) from
 * measured 60°/85° specular gloss units (GU) onto WebGPU/WebGL2 TSL-compatible
 * `THREE.MeshPhysicalMaterial` instances (`transmission = 0`) with deterministic
 * instance caching for `SceneBatchOptimizer` draw-call coalescing.
 */
import * as THREE from 'three';
import type { PaintSheen, RoomPaintSurfaceSpec } from '../../core/types/twin-ux.ts';

export type { PaintSheen, RoomPaintSurfaceSpec };

export type PaintMicroTextureKind = 'chalk' | 'limewash' | 'roller';

export interface PaintSheenDescriptor {
  /** Canonical sheen identifier, e.g. `'estate-emulsion'`. */
  readonly id: PaintSheen;
  readonly label: string;
  /** Nominal specular gloss percentage (GU at 60° / 85° grazing angle for ultra-matt finishes). */
  readonly glossPercent: number;
  /** Base pigmented binder microfacet roughness `[0..1]`. */
  readonly roughness: number;
  /** Always `0.0` (pure dielectric pigmented coating). */
  readonly metalness: number;
  /** Dielectric binder index of refraction (`1.44..1.52`). */
  readonly ior: number;
  /** Calibrated normal-incidence dielectric reflectivity factor (`0.32..0.58`). */
  readonly reflectivity: number;
  /** Grazing-angle mineral/chalk retro-reflection lobe strength (`0..1`). */
  readonly sheen: number;
  /** Grazing-angle mineral/chalk sheen roughness (`0..1`). */
  readonly sheenRoughness: number;
  /** Dielectric resin/oil topcoat intensity (`0..1`). */
  readonly clearcoat: number;
  /** Dielectric resin/oil topcoat microfacet roughness (`0..1`). */
  readonly clearcoatRoughness: number;
  /** Default procedural micro-texture profile (`true` for chalky `estate-emulsion` & `limewash`). */
  readonly defaultMicroTexture: boolean;
  /** Procedural micro-texture profile used when `microTexture` is active. */
  readonly microTextureKind: PaintMicroTextureKind;
}

export const PAINT_SHEENS: Readonly<Record<PaintSheen, PaintSheenDescriptor>> = Object.freeze({
  limewash: Object.freeze({
    id: 'limewash',
    label: 'Limewash',
    glossPercent: 1.5,
    roughness: 0.95,
    metalness: 0.0,
    ior: 1.44,
    reflectivity: 0.32,
    sheen: 0.12,
    sheenRoughness: 0.96,
    clearcoat: 0.0,
    clearcoatRoughness: 0.95,
    defaultMicroTexture: true,
    microTextureKind: 'limewash',
  }),
  'dead-flat': Object.freeze({
    id: 'dead-flat',
    label: 'Dead Flat',
    glossPercent: 2,
    roughness: 0.94,
    metalness: 0.0,
    ior: 1.45,
    reflectivity: 0.34,
    sheen: 0.06,
    sheenRoughness: 0.95,
    clearcoat: 0.0,
    clearcoatRoughness: 0.94,
    defaultMicroTexture: false,
    microTextureKind: 'chalk',
  }),
  'estate-emulsion': Object.freeze({
    id: 'estate-emulsion',
    label: 'Estate Emulsion',
    glossPercent: 2,
    roughness: 0.91,
    metalness: 0.0,
    ior: 1.46,
    reflectivity: 0.36,
    sheen: 0.1,
    sheenRoughness: 0.9,
    clearcoat: 0.0,
    clearcoatRoughness: 0.9,
    defaultMicroTexture: true,
    microTextureKind: 'chalk',
  }),
  'modern-emulsion': Object.freeze({
    id: 'modern-emulsion',
    label: 'Modern Emulsion',
    glossPercent: 7,
    roughness: 0.78,
    metalness: 0.0,
    ior: 1.48,
    reflectivity: 0.42,
    sheen: 0.0,
    sheenRoughness: 1.0,
    clearcoat: 0.07,
    clearcoatRoughness: 0.68,
    defaultMicroTexture: false,
    microTextureKind: 'roller',
  }),
  'estate-eggshell': Object.freeze({
    id: 'estate-eggshell',
    label: 'Estate Eggshell',
    glossPercent: 20,
    roughness: 0.52,
    metalness: 0.0,
    ior: 1.49,
    reflectivity: 0.46,
    sheen: 0.0,
    sheenRoughness: 1.0,
    clearcoat: 0.18,
    clearcoatRoughness: 0.46,
    defaultMicroTexture: false,
    microTextureKind: 'roller',
  }),
  'exterior-eggshell': Object.freeze({
    id: 'exterior-eggshell',
    label: 'Exterior Eggshell',
    glossPercent: 20,
    roughness: 0.5,
    metalness: 0.0,
    ior: 1.49,
    reflectivity: 0.47,
    sheen: 0.0,
    sheenRoughness: 1.0,
    clearcoat: 0.2,
    clearcoatRoughness: 0.44,
    defaultMicroTexture: false,
    microTextureKind: 'roller',
  }),
  satinwood: Object.freeze({
    id: 'satinwood',
    label: 'Satinwood',
    glossPercent: 30,
    roughness: 0.42,
    metalness: 0.0,
    ior: 1.5,
    reflectivity: 0.48,
    sheen: 0.0,
    sheenRoughness: 1.0,
    clearcoat: 0.28,
    clearcoatRoughness: 0.36,
    defaultMicroTexture: false,
    microTextureKind: 'roller',
  }),
  'modern-eggshell': Object.freeze({
    id: 'modern-eggshell',
    label: 'Modern Eggshell',
    glossPercent: 40,
    roughness: 0.36,
    metalness: 0.0,
    ior: 1.5,
    reflectivity: 0.5,
    sheen: 0.0,
    sheenRoughness: 1.0,
    clearcoat: 0.38,
    clearcoatRoughness: 0.28,
    defaultMicroTexture: false,
    microTextureKind: 'roller',
  }),
  'full-gloss': Object.freeze({
    id: 'full-gloss',
    label: 'Full Gloss',
    glossPercent: 95,
    roughness: 0.14,
    metalness: 0.0,
    ior: 1.52,
    reflectivity: 0.58,
    sheen: 0.0,
    sheenRoughness: 1.0,
    clearcoat: 0.92,
    clearcoatRoughness: 0.08,
    defaultMicroTexture: false,
    microTextureKind: 'roller',
  }),
});

export interface PaintSwatch {
  /** Canonical namespaced ID, e.g. `'farrow-ball:light-blue'` or `'neptune:shingle'`. */
  readonly id: string;
  /** Brand-independent slug, e.g. `'light-blue'` or `'shingle'`. */
  readonly slug: string;
  /** Human-readable swatch name, e.g. `'Light Blue'`. */
  readonly name: string;
  /** Paint house / manufacturer, e.g. `'Farrow & Ball'` or `'Neptune'`. */
  readonly brand: string;
  /** Manufacturer colour number / code, e.g. `'No. 22'`. */
  readonly code?: string;
  /** Verified uppercase 6-digit sRGB hex string (`#RRGGBB`). */
  readonly hex: `#${string}`;
  /** Approximate CIE Y Light Reflectance Value (`0..100`). */
  readonly lrv: number;
  /** Official complementary white swatch slugs/IDs in priority order. */
  readonly recommendedWhites: readonly string[];
  /** Official manufacturer product page URL. */
  readonly productUrl?: string;
  /** Optional undertone / architectural usage notes. */
  readonly notes?: string;
}

export interface PaintSwatchRegistration {
  readonly id?: string;
  readonly slug?: string;
  readonly name: string;
  readonly brand: string;
  readonly code?: string;
  readonly hex: THREE.ColorRepresentation;
  readonly lrv?: number;
  readonly recommendedWhites?: readonly string[];
  readonly productUrl?: string;
  readonly notes?: string;
}

export interface CustomPaintColorSpec {
  readonly color: THREE.ColorRepresentation;
  readonly name?: string;
  readonly brand?: string;
  readonly code?: string;
  readonly complementaryWhite?: string;
  readonly recommendedWhites?: readonly string[];
  readonly productUrl?: string;
}

export type PaintColorInput =
  | string
  | number
  | THREE.Color
  | CustomPaintColorSpec
  | PaintSwatch;

export interface ResolvedPaintColor {
  readonly hex: `#${string}`;
  readonly color: THREE.Color;
  readonly lrv: number;
  readonly name: string;
  readonly brand: string;
  readonly code?: string;
  readonly swatchId?: string;
  readonly swatch?: PaintSwatch;
  readonly recommendedWhites: readonly string[];
  readonly productUrl?: string;
}

export interface PaintMaterialOptions {
  /** Curated swatch ID / name, inline custom paint spec, or raw `THREE.ColorRepresentation`. */
  readonly color: PaintColorInput;
  /** Physical architectural paint sheen (default `'estate-emulsion'`). */
  readonly sheen?: PaintSheen;
  /** Face culling mode (default `THREE.FrontSide`). */
  readonly side?: THREE.Side;
  /**
   * Optional subtle procedural chalk/roller/limewash micro-texture (`DataTexture`).
   * Defaults to the sheen's physical profile (`true` for `'estate-emulsion'` and `'limewash'`,
   * `false` for washable/joinery sheens unless explicitly requested).
   */
  readonly microTexture?: boolean;
  /**
   * Allocates an isolated uncached `THREE.MeshPhysicalMaterial` instance when `true`.
   */
  readonly unique?: boolean;
}

export interface ResolvedPaintInfo {
  readonly hex: `#${string}`;
  readonly lrv: number;
  readonly brand: string;
  readonly name: string;
  readonly swatchName?: string;
  readonly swatchId?: string;
  readonly code?: string;
  readonly sheen: PaintSheen;
  readonly sheenLabel: string;
  readonly glossPercent: number;
  readonly microTexture: boolean;
  readonly side: THREE.Side;
  readonly recommendedWhites: readonly string[];
  readonly productUrl?: string;
  readonly swatch?: PaintSwatch;
}

export type RoomPaintKind =
  | 'living'
  | 'drawing-room'
  | 'sitting-room'
  | 'dining'
  | 'bedroom'
  | 'nursery'
  | 'study'
  | 'library'
  | 'dressing-room'
  | 'landing'
  | 'hallway'
  | 'kitchen'
  | 'bathroom'
  | 'ensuite'
  | 'wc'
  | 'utility'
  | 'boot-room';

export interface RoomPaintSchemeOptions {
  readonly wallColor: PaintColorInput;
  readonly trimColor?: PaintColorInput;
  readonly ceilingColor?: PaintColorInput;
  readonly doorColor?: PaintColorInput;
  readonly radiatorColor?: PaintColorInput;
  readonly roomKind?: RoomPaintKind;
  readonly wallSheen?: PaintSheen;
  readonly trimSheen?: PaintSheen;
  readonly ceilingSheen?: PaintSheen;
  readonly doorSheen?: PaintSheen;
  readonly radiatorSheen?: PaintSheen;
  readonly microTexture?: boolean;
  readonly side?: THREE.Side;
}

export interface RoomPaintSchemeInfo {
  readonly roomKind: RoomPaintKind;
  readonly walls: ResolvedPaintInfo;
  readonly trim: ResolvedPaintInfo;
  readonly ceiling: ResolvedPaintInfo;
  readonly doors: ResolvedPaintInfo;
  readonly radiator: ResolvedPaintInfo;
}

export interface RoomPaintScheme {
  readonly walls: THREE.MeshPhysicalMaterial;
  readonly trim: THREE.MeshPhysicalMaterial;
  readonly ceiling: THREE.MeshPhysicalMaterial;
  readonly doors: THREE.MeshPhysicalMaterial;
  readonly radiator: THREE.MeshPhysicalMaterial;
  readonly info: RoomPaintSchemeInfo;
}

// -----------------------------------------------------------------------------
// Pure colour & LRV utilities
// -----------------------------------------------------------------------------

const colorScratch = new THREE.Color();
const PURE_WHITE = new THREE.Color(0xffffff);

const RAW_COLOR_STRING_RE =
  /^(?:#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|0x[0-9a-fA-F]{1,6}|rgba?\s*\([^)]+\)|hsla?\s*\([^)]+\))$/;

const CSS_NAMED_COLORS = new Set<string>([
  'aliceblue',
  'antiquewhite',
  'beige',
  'bisque',
  'black',
  'blanchedalmond',
  'cornsilk',
  'floralwhite',
  'gainsboro',
  'ghostwhite',
  'gray',
  'grey',
  'honeydew',
  'ivory',
  'lavender',
  'linen',
  'mintcream',
  'mistyrose',
  'navajowhite',
  'oldlace',
  'papayawhip',
  'LightSlateGray'.toLowerCase(),
  'seashell',
  'silver',
  'slategray',
  'slategrey',
  'wheat',
  'white',
  'whitesmoke',
]);

function toSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/&/g, '-and-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toBrandSlug(brand: string): string {
  const normalized = toSlug(brand);
  if (
    normalized === 'farrow-and-ball' ||
    normalized === 'farrow-ball' ||
    normalized === 'fb'
  ) {
    return 'farrow-ball';
  }
  return normalized || 'custom';
}

function srgbByteToLinear(byte: number): number {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function normalizeHexString(input: THREE.ColorRepresentation): `#${string}` {
  colorScratch.set(input);
  return `#${colorScratch.getHexString().toUpperCase()}`;
}

/**
 * Computes approximate CIE Y Light Reflectance Value (`0..100`) from an sRGB hex/color.
 */
export function computePaintLrv(color: THREE.ColorRepresentation): number {
  const hex = normalizeHexString(color);
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  const y =
    0.2126 * srgbByteToLinear(r) +
    0.7152 * srgbByteToLinear(g) +
    0.0722 * srgbByteToLinear(b);
  return Math.round(y * 1000) / 10;
}

/**
 * Evaluates a monotonic physical specular response index for a calibrated paint sheen
 * or `THREE.MeshPhysicalMaterial`, combining dielectric Fresnel F0 (`ior` & `specularIntensity`),
 * base microfacet sharpness (`1 / roughness^2`), and topcoat clearcoat reflection
 * (`clearcoat / clearcoatRoughness^2`).
 */
export function computePaintSpecularResponse(
  target: PaintSheen | THREE.MeshPhysicalMaterial
): number {
  if (typeof target === 'string') {
    const d = getPaintSheenDescriptor(target);
    const f0 = ((d.ior - 1) / (d.ior + 1)) ** 2;
    const specScale = Math.min(1, d.reflectivity / 0.5);
    const baseLobe = (f0 * specScale) / Math.max(0.01, d.roughness * d.roughness);
    const coatLobe =
      d.clearcoat > 0
        ? (0.04 * d.clearcoat) / Math.max(0.004, d.clearcoatRoughness * d.clearcoatRoughness)
        : 0;
    return baseLobe + coatLobe;
  }

  const f0 = ((target.ior - 1) / (target.ior + 1)) ** 2;
  const specScale = target.specularIntensity ?? 1;
  const baseLobe = (f0 * specScale) / Math.max(0.01, target.roughness * target.roughness);
  const coatLobe =
    target.clearcoat > 0
      ? (0.04 * target.clearcoat) /
        Math.max(0.004, target.clearcoatRoughness * target.clearcoatRoughness)
      : 0;
  return baseLobe + coatLobe;
}

export function getPaintSheenDescriptor(sheen: PaintSheen): PaintSheenDescriptor {
  const descriptor = PAINT_SHEENS[sheen];
  if (!descriptor) {
    throw new Error(`Unknown architectural paint sheen '${String(sheen)}'.`);
  }
  return descriptor;
}

// -----------------------------------------------------------------------------
// Curated Swatch Registry (Farrow & Ball + Neptune + Extensible Registration)
// -----------------------------------------------------------------------------

const swatchesById = new Map<string, PaintSwatch>();
const swatchesByLookupKey = new Map<string, PaintSwatch>();

/**
 * Registers a curated or project-specific architectural paint swatch.
 */
export function registerPaintSwatch(input: PaintSwatchRegistration): PaintSwatch {
  const brandSlug = toBrandSlug(input.brand);
  const slug = input.slug ? toSlug(input.slug) : toSlug(input.name);
  if (!slug) {
    throw new Error('registerPaintSwatch: swatch name/slug must not be empty.');
  }
  const id = input.id ? input.id.trim().toLowerCase() : `${brandSlug}:${slug}`;
  const hex = normalizeHexString(input.hex);
  const lrv =
    input.lrv !== undefined && Number.isFinite(input.lrv)
      ? Math.max(0, Math.min(100, Math.round(input.lrv * 10) / 10))
      : computePaintLrv(hex);
  const recommendedWhites = Object.freeze([...(input.recommendedWhites ?? [])]);

  const swatch: PaintSwatch = Object.freeze({
    id,
    slug,
    name: input.name.trim(),
    brand: input.brand.trim(),
    ...(input.code ? { code: input.code.trim() } : {}),
    hex,
    lrv,
    recommendedWhites,
    ...(input.productUrl ? { productUrl: input.productUrl.trim() } : {}),
    ...(input.notes ? { notes: input.notes.trim() } : {}),
  });

  swatchesById.set(id, swatch);
  swatchesByLookupKey.set(id, swatch);
  swatchesByLookupKey.set(`${brandSlug}:${slug}`, swatch);
  if (!swatchesByLookupKey.has(slug) || brandSlug === 'farrow-ball') {
    swatchesByLookupKey.set(slug, swatch);
  }
  const nameSlug = toSlug(input.name);
  if (nameSlug && !swatchesByLookupKey.has(nameSlug)) {
    swatchesByLookupKey.set(nameSlug, swatch);
  }
  if (input.code) {
    const codeSlug = toSlug(input.code);
    if (codeSlug) {
      swatchesByLookupKey.set(`${brandSlug}:${codeSlug}`, swatch);
      if (!swatchesByLookupKey.has(codeSlug)) {
        swatchesByLookupKey.set(codeSlug, swatch);
      }
    }
  }

  return swatch;
}

/**
 * Looks up a registered `PaintSwatch` by namespaced ID (`'farrow-ball:light-blue'`),
 * slug (`'light-blue'`), human-readable name (`"Farrow's Cream"`), or code (`'No. 22'`).
 */
export function getPaintSwatch(idOrName: string): PaintSwatch | undefined {
  const raw = idOrName.trim();
  if (!raw) return undefined;
  const direct = swatchesByLookupKey.get(raw.toLowerCase());
  if (direct) return direct;

  const colonIdx = raw.indexOf(':');
  if (colonIdx > 0) {
    const prefix = toBrandSlug(raw.slice(0, colonIdx));
    const rest = toSlug(raw.slice(colonIdx + 1));
    return swatchesByLookupKey.get(`${prefix}:${rest}`);
  }

  return swatchesByLookupKey.get(toSlug(raw));
}

/**
 * Lists all registered paint swatches, optionally filtered by brand name or slug.
 */
export function listPaintSwatches(brand?: string): readonly PaintSwatch[] {
  const all = Array.from(swatchesById.values());
  if (!brand) return all;
  const targetBrandSlug = toBrandSlug(brand);
  return all.filter((s) => toBrandSlug(s.brand) === targetBrandSlug);
}

interface FbSeedRow {
  readonly slug: string;
  readonly name: string;
  readonly code: string;
  readonly hex: `#${string}`;
  readonly whites: readonly string[];
}

// Verified against official Farrow & Ball sRGB swatches & complementary white pairings
// (https://www.farrow-ball.com/paint/<slug>).
const FARROW_AND_BALL_SEED: readonly FbSeedRow[] = [
  { slug: 'lime-white', name: 'Lime White', code: 'No. 1', hex: '#E3DCC7', whites: ['slipper-satin', 'off-white'] },
  { slug: 'off-white', name: 'Off-White', code: 'No. 3', hex: '#DBD4BF', whites: ['slipper-satin', 'wimborne-white'] },
  { slug: 'string', name: 'String', code: 'No. 8', hex: '#D8CBAE', whites: ['white-tie', 'wimborne-white'] },
  { slug: 'cord', name: 'Cord', code: 'No. 16', hex: '#D1C19F', whites: ['white-tie', 'new-white'] },
  { slug: 'french-gray', name: 'French Gray', code: 'No. 18', hex: '#B0AF9B', whites: ['slipper-satin', 'off-white'] },
  { slug: 'light-blue', name: 'Light Blue', code: 'No. 22', hex: '#B5BBB4', whites: ['school-house-white', 'shaded-white'] },
  { slug: 'pigeon', name: 'Pigeon', code: 'No. 25', hex: '#9A9F94', whites: ['school-house-white', 'shaded-white'] },
  { slug: 'down-pipe', name: 'Down Pipe', code: 'No. 26', hex: '#606565', whites: ['blackened', 'pavilion-gray'] },
  { slug: 'dead-salmon', name: 'Dead Salmon', code: 'No. 28', hex: '#B19C8D', whites: ['dimity', 'pointing'] },
  { slug: 'hague-blue', name: 'Hague Blue', code: 'No. 30', hex: '#3F4D57', whites: ['wevet', 'wimborne-white'] },
  { slug: 'railings', name: 'Railings', code: 'No. 31', hex: '#45494C', whites: ['blackened', 'all-white'] },
  { slug: 'green-smoke', name: 'Green Smoke', code: 'No. 47', hex: '#6F7B71', whites: ['shaded-white', 'school-house-white'] },
  { slug: 'off-black', name: 'Off-Black', code: 'No. 57', hex: '#454749', whites: ['blackened', 'all-white'] },
  { slug: 'new-white', name: 'New White', code: 'No. 59', hex: '#EFE6CF', whites: ['white-tie', 'wimborne-white'] },
  { slug: 'farrows-cream', name: "Farrow's Cream", code: 'No. 67', hex: '#E9D8B4', whites: ['white-tie', 'new-white', 'wimborne-white'] },
  { slug: 'card-room-green', name: 'Card Room Green', code: 'No. 79', hex: '#878F81', whites: ['shaded-white', 'school-house-white'] },
  { slug: 'shaded-white', name: 'Shaded White', code: 'No. 201', hex: '#D5CFC0', whites: ['school-house-white', 'pointing'] },
  { slug: 'pink-ground', name: 'Pink Ground', code: 'No. 202', hex: '#EAD4C6', whites: ['wimborne-white', 'all-white'] },
  { slug: 'pantalon', name: 'Pantalon', code: 'No. 221', hex: '#6E6656', whites: ['string', 'white-tie'] },
  { slug: 'joas-white', name: "Joa's White", code: 'No. 226', hex: '#DBCFBB', whites: ['dimity', 'pointing'] },
  { slug: 'cornforth-white', name: 'Cornforth White', code: 'No. 228', hex: '#CFCBC4', whites: ['wevet', 'ammonite'] },
  { slug: 'elephants-breath', name: "Elephant's Breath", code: 'No. 229', hex: '#C7BEB3', whites: ['strong-white', 'skimming-stone'] },
  { slug: 'setting-plaster', name: 'Setting Plaster', code: 'No. 231', hex: '#D9C0AE', whites: ['school-house-white', 'skimming-stone', 'wimborne-white'] },
  { slug: 'wimborne-white', name: 'Wimborne White', code: 'No. 239', hex: '#F4F2E7', whites: ['all-white', 'pointing'] },
  { slug: 'skimming-stone', name: 'Skimming Stone', code: 'No. 241', hex: '#DBD5CA', whites: ['strong-white', 'wimborne-white'] },
  { slug: 'pavilion-gray', name: 'Pavilion Gray', code: 'No. 242', hex: '#C3C1BB', whites: ['blackened', 'all-white'] },
  { slug: 'mizzle', name: 'Mizzle', code: 'No. 266', hex: '#BEC1B3', whites: ['slipper-satin', 'wimborne-white'] },
  { slug: 'wevet', name: 'Wevet', code: 'No. 273', hex: '#ECEBE9', whites: ['all-white', 'ammonite'] },
  { slug: 'ammonite', name: 'Ammonite', code: 'No. 274', hex: '#D8D6CF', whites: ['wevet', 'all-white'] },
  { slug: 'purbeck-stone', name: 'Purbeck Stone', code: 'No. 275', hex: '#C0BCB3', whites: ['wevet', 'ammonite'] },
  { slug: 'stiffkey-blue', name: 'Stiffkey Blue', code: 'No. 281', hex: '#4A5B6B', whites: ['ammonite', 'wevet'] },
  { slug: 'shadow-white', name: 'Shadow White', code: 'No. 282', hex: '#DCD7C8', whites: ['school-house-white', 'shaded-white'] },
  { slug: 'drop-cloth', name: 'Drop Cloth', code: 'No. 283', hex: '#C5BDAC', whites: ['school-house-white', 'shaded-white'] },
  { slug: 'cromarty', name: 'Cromarty', code: 'No. 285', hex: '#CACCC0', whites: ['school-house-white', 'shaded-white'] },
  { slug: 'inchyra-blue', name: 'Inchyra Blue', code: 'No. 289', hex: '#58686A', whites: ['school-house-white', 'wevet'] },
  { slug: 'school-house-white', name: 'School House White', code: 'No. 291', hex: '#E3DED0', whites: ['wimborne-white', 'shaded-white'] },
  { slug: 'jitney', name: 'Jitney', code: 'No. 293', hex: '#C1B2A2', whites: ['dimity', 'wimborne-white'] },
  { slug: 'sulking-room-pink', name: 'Sulking Room Pink', code: 'No. 295', hex: '#AA8D87', whites: ['skimming-stone', 'school-house-white', 'shaded-white'] },
  { slug: 'stirabout', name: 'Stirabout', code: 'No. 300', hex: '#D9CFC2', whites: ['school-house-white', 'wimborne-white'] },
  { slug: 'templeton-pink', name: 'Templeton Pink', code: 'No. 303', hex: '#CDB19D', whites: ['stirabout', 'pointing', 'school-house-white'] },
  { slug: 'strong-white', name: 'Strong White', code: 'No. 2001', hex: '#E4E2DC', whites: ['all-white', 'wevet'] },
  { slug: 'white-tie', name: 'White Tie', code: 'No. 2002', hex: '#EFE9D8', whites: ['wimborne-white', 'new-white'] },
  { slug: 'pointing', name: 'Pointing', code: 'No. 2003', hex: '#F3EFE3', whites: ['all-white', 'wimborne-white'] },
  { slug: 'slipper-satin', name: 'Slipper Satin', code: 'No. 2004', hex: '#E6E0D2', whites: ['wimborne-white', 'pointing', 'off-white'] },
  { slug: 'all-white', name: 'All White', code: 'No. 2005', hex: '#F6F6F2', whites: ['strong-white', 'wimborne-white'] },
  { slug: 'dimity', name: 'Dimity', code: 'No. 2008', hex: '#EAE1D3', whites: ['pointing', 'wimborne-white'] },
  { slug: 'james-white', name: 'James White', code: 'No. 2010', hex: '#E9E7D8', whites: ['all-white', 'slipper-satin'] },
  { slug: 'blackened', name: 'Blackened', code: 'No. 2011', hex: '#DBDBDA', whites: ['all-white', 'wevet'] },
];

for (const row of FARROW_AND_BALL_SEED) {
  registerPaintSwatch({
    id: `farrow-ball:${row.slug}`,
    slug: row.slug,
    name: row.name,
    brand: 'Farrow & Ball',
    code: row.code,
    hex: row.hex,
    recommendedWhites: row.whites,
    productUrl: `https://www.farrow-ball.com/paint/${row.slug}`,
  });
}

const NEPTUNE_SEED: readonly FbSeedRow[] = [
  { slug: 'shingle', name: 'Shingle', code: 'NP-SHINGLE', hex: '#D5D4CA', whites: ['salt', 'snow'] },
  { slug: 'ink', name: 'Ink', code: 'NP-INK', hex: '#283142', whites: ['snow', 'salt'] },
  { slug: 'salt', name: 'Salt', code: 'NP-SALT', hex: '#E9E3D8', whites: ['snow', 'shell'] },
  { slug: 'old-chalk', name: 'Old Chalk', code: 'NP-OLD-CHALK', hex: '#D8D2C2', whites: ['salt', 'snow'] },
  { slug: 'snow', name: 'Snow', code: 'NP-SNOW', hex: '#F8F8EF', whites: ['salt', 'shell'] },
  { slug: 'shell', name: 'Shell', code: 'NP-SHELL', hex: '#E4DFD5', whites: ['snow', 'salt'] },
];

for (const row of NEPTUNE_SEED) {
  registerPaintSwatch({
    id: `neptune:${row.slug}`,
    slug: row.slug,
    name: row.name,
    brand: 'Neptune',
    code: row.code,
    hex: row.hex,
    recommendedWhites: row.whites,
    productUrl: `https://www.neptune.com/products/${row.slug}-paint`,
  });
}

function isPaintSwatchObject(value: unknown): value is PaintSwatch {
  return (
    typeof value === 'object' &&
    value !== null &&
    'hex' in value &&
    'slug' in value &&
    'recommendedWhites' in value &&
    typeof (value as PaintSwatch).hex === 'string'
  );
}

function isCustomPaintColorSpec(value: unknown): value is CustomPaintColorSpec {
  return (
    typeof value === 'object' &&
    value !== null &&
    !('isColor' in value) &&
    'color' in value &&
    (value as CustomPaintColorSpec).color !== undefined
  );
}

/**
 * Resolves a curated swatch ID/name, `PaintSwatch`, custom `{ color, name, brand, code, complementaryWhite }`
 * specification, or raw `THREE.ColorRepresentation` (`'#E6E1D3'`, `0xe6e1d3`, `THREE.Color`) into a
 * normalized `ResolvedPaintColor`.
 */
export function resolvePaintColor(input: PaintColorInput): ResolvedPaintColor {
  if (isPaintSwatchObject(input)) {
    return {
      hex: input.hex,
      color: new THREE.Color(input.hex),
      lrv: input.lrv,
      name: input.name,
      brand: input.brand,
      ...(input.code ? { code: input.code } : {}),
      swatchId: input.id,
      swatch: input,
      recommendedWhites: input.recommendedWhites,
      ...(input.productUrl ? { productUrl: input.productUrl } : {}),
    };
  }

  if (isCustomPaintColorSpec(input)) {
    const base =
      typeof input.color === 'string' && !RAW_COLOR_STRING_RE.test(input.color.trim())
        ? resolvePaintColor(input.color)
        : null;
    const hex = base ? base.hex : normalizeHexString(input.color);
    const lrv = base ? base.lrv : computePaintLrv(hex);
    const recommendedWhites = input.recommendedWhites
      ? [...input.recommendedWhites]
      : input.complementaryWhite
        ? [input.complementaryWhite]
        : base
          ? [...base.recommendedWhites]
          : [];
    return {
      hex,
      color: new THREE.Color(hex),
      lrv,
      name: input.name?.trim() || base?.name || hex,
      brand: input.brand?.trim() || base?.brand || 'Custom',
      ...(input.code?.trim() ? { code: input.code.trim() } : base?.code ? { code: base.code } : {}),
      ...(base?.swatchId && !input.name && !input.brand ? { swatchId: base.swatchId, swatch: base.swatch } : {}),
      recommendedWhites: Object.freeze(recommendedWhites),
      ...(input.productUrl?.trim()
        ? { productUrl: input.productUrl.trim() }
        : base?.productUrl
          ? { productUrl: base.productUrl }
          : {}),
    };
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!RAW_COLOR_STRING_RE.test(trimmed)) {
      const swatch = getPaintSwatch(trimmed);
      if (swatch) {
        return resolvePaintColor(swatch);
      }
      if (!CSS_NAMED_COLORS.has(trimmed.toLowerCase())) {
        throw new Error(
          `Unknown architectural paint swatch or invalid CSS colour '${input}'.`
        );
      }
    }
    const hex = normalizeHexString(trimmed);
    return {
      hex,
      color: new THREE.Color(hex),
      lrv: computePaintLrv(hex),
      name: hex,
      brand: 'Custom',
      recommendedWhites: Object.freeze([]),
    };
  }

  const hex = normalizeHexString(input);
  return {
    hex,
    color: new THREE.Color(hex),
    lrv: computePaintLrv(hex),
    name: hex,
    brand: 'Custom',
    recommendedWhites: Object.freeze([]),
  };
}

// -----------------------------------------------------------------------------
// Headless-safe Procedural Micro-Texture DataTextures (Node & WebGPU identical)
// -----------------------------------------------------------------------------

interface PaintMicroTextureSet {
  readonly roughnessMap: THREE.DataTexture;
  readonly valueModMap: THREE.DataTexture | null;
}

const microTextureCache = new Map<PaintMicroTextureKind, PaintMicroTextureSet>();

function hashPeriodic2D(ix: number, iy: number, period: number, seed: number): number {
  const wx = ((ix % period) + period) % period;
  const wy = ((iy % period) + period) % period;
  let h = (Math.imul(wx, 374761393) + Math.imul(wy, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smoothPeriodicNoise(u: number, v: number, freq: number, seed: number): number {
  const x = u * freq;
  const y = v * freq;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);

  const n00 = hashPeriodic2D(x0, y0, freq, seed);
  const n10 = hashPeriodic2D(x0 + 1, y0, freq, seed);
  const n01 = hashPeriodic2D(x0, y0 + 1, freq, seed);
  const n11 = hashPeriodic2D(x0 + 1, y0 + 1, freq, seed);
  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sy;
}

function createPeriodicGrayscaleDataTexture(
  name: string,
  size: number,
  repeat: number,
  colorSpace: THREE.ColorSpace,
  sampleByte: (x: number, y: number) => number
): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const byte = Math.max(0, Math.min(255, Math.round(sampleByte(x, y))));
      const p4 = (y * size + x) * 4;
      data[p4] = byte;
      data[p4 + 1] = byte;
      data[p4 + 2] = byte;
      data[p4 + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.name = name;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = colorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function getPaintMicroTextures(kind: PaintMicroTextureKind): PaintMicroTextureSet {
  const existing = microTextureCache.get(kind);
  if (existing) return existing;

  const size = 64;
  let created: PaintMicroTextureSet;

  if (kind === 'limewash') {
    const roughnessMap = createPeriodicGrayscaleDataTexture(
      'paint:micro:limewash:roughness',
      size,
      3,
      THREE.NoColorSpace,
      (x, y) => {
        const u = x / size;
        const v = y / size;
        const cloud =
          smoothPeriodicNoise(u, v, 4, 101) * 0.55 +
          smoothPeriodicNoise(u, v, 8, 211) * 0.3 +
          smoothPeriodicNoise(u, v, 16, 307) * 0.15;
        return 240 + cloud * 15;
      }
    );
    const valueModMap = createPeriodicGrayscaleDataTexture(
      'paint:micro:limewash:value',
      size,
      3,
      THREE.SRGBColorSpace,
      (x, y) => {
        const u = x / size;
        const v = y / size;
        const brush =
          smoothPeriodicNoise(u, v, 4, 401) * 0.6 +
          smoothPeriodicNoise(u, v, 10, 509) * 0.28 +
          hashPeriodic2D(x, y, size, 613) * 0.12;
        return 244 + brush * 11;
      }
    );
    created = { roughnessMap, valueModMap };
  } else if (kind === 'chalk') {
    const roughnessMap = createPeriodicGrayscaleDataTexture(
      'paint:micro:chalk:roughness',
      size,
      6,
      THREE.NoColorSpace,
      (x, y) => {
        const u = x / size;
        const v = y / size;
        const grain =
          smoothPeriodicNoise(u, v, 12, 71) * 0.55 +
          hashPeriodic2D(x, y, size, 97) * 0.45;
        return 244 + grain * 11;
      }
    );
    created = { roughnessMap, valueModMap: null };
  } else {
    const roughnessMap = createPeriodicGrayscaleDataTexture(
      'paint:micro:roller:roughness',
      size,
      8,
      THREE.NoColorSpace,
      (x, y) => {
        const u = x / size;
        const v = y / size;
        const stipple =
          smoothPeriodicNoise(u, v, 16, 131) * 0.65 +
          hashPeriodic2D(x, y, size, 173) * 0.35;
        return 246 + stipple * 9;
      }
    );
    created = { roughnessMap, valueModMap: null };
  }

  microTextureCache.set(kind, created);
  return created;
}

// -----------------------------------------------------------------------------
// Deterministic Paint Material Factory & WeakMap Metadata Registry
// -----------------------------------------------------------------------------

const paintMaterialCache = new Map<string, THREE.MeshPhysicalMaterial>();
const paintInfoRegistry = new WeakMap<THREE.Material, ResolvedPaintInfo>();

function buildPaintCacheKey(
  resolvedHex: `#${string}`,
  sheen: PaintSheen,
  side: THREE.Side,
  microTexture: boolean
): string {
  return `${resolvedHex}|${sheen}|${side}|${microTexture ? 1 : 0}`;
}

function buildResolvedPaintInfo(
  resolved: ResolvedPaintColor,
  descriptor: PaintSheenDescriptor,
  side: THREE.Side,
  microTexture: boolean
): ResolvedPaintInfo {
  return Object.freeze({
    hex: resolved.hex,
    lrv: resolved.lrv,
    brand: resolved.brand,
    name: resolved.name,
    ...(resolved.swatch ? { swatchName: resolved.swatch.name } : {}),
    ...(resolved.swatchId ? { swatchId: resolved.swatchId } : {}),
    ...(resolved.code ? { code: resolved.code } : {}),
    sheen: descriptor.id,
    sheenLabel: descriptor.label,
    glossPercent: descriptor.glossPercent,
    microTexture,
    side,
    recommendedWhites: resolved.recommendedWhites,
    ...(resolved.productUrl ? { productUrl: resolved.productUrl } : {}),
    ...(resolved.swatch ? { swatch: resolved.swatch } : {}),
  });
}

/**
 * Creates (or returns a deterministically cached) `THREE.MeshPhysicalMaterial`
 * calibrated for an architectural paint sheen (`transmission = 0` for 100%
 * WebGPU & WebGL2 TSL parity).
 *
 * Cache key is `(resolvedHex, sheen, side, microTexture)` so identical painted
 * walls, ceilings, skirtings, architraves, and doors share the exact same
 * `MeshPhysicalMaterial` reference for `SceneBatchOptimizer` draw-call coalescing.
 */
export function createPaintMaterial(options: PaintMaterialOptions): THREE.MeshPhysicalMaterial {
  const sheen: PaintSheen = options.sheen ?? 'estate-emulsion';
  const descriptor = getPaintSheenDescriptor(sheen);
  const resolved = resolvePaintColor(options.color);
  const side = options.side ?? THREE.FrontSide;
  const microTexture = options.microTexture ?? descriptor.defaultMicroTexture;
  const unique = options.unique === true;

  const cacheKey = buildPaintCacheKey(resolved.hex, sheen, side, microTexture);
  if (!unique) {
    const cached = paintMaterialCache.get(cacheKey);
    if (cached) {
      const existingInfo = paintInfoRegistry.get(cached);
      if (existingInfo && !existingInfo.swatch && resolved.swatch) {
        paintInfoRegistry.set(
          cached,
          buildResolvedPaintInfo(resolved, descriptor, side, microTexture)
        );
      }
      return cached;
    }
  }

  // Note: Do NOT pass `reflectivity` alongside `ior` into `new THREE.MeshPhysicalMaterial(...)`
  // because Three.js defines `reflectivity` as a setter mutating `this.ior`.
  // Instead, set `ior: descriptor.ior` directly and scale `specularIntensity` from
  // `descriptor.reflectivity` so both `material.ior` and dielectric F0/F90 are exact.
  const specularIntensity = Math.min(1, Number((descriptor.reflectivity / 0.5).toFixed(4)));
  const baseColor = new THREE.Color(resolved.hex);
  const sheenColor =
    descriptor.sheen > 0
      ? baseColor.clone().lerp(PURE_WHITE, 0.35)
      : new THREE.Color(0x000000);

  const params: THREE.MeshPhysicalMaterialParameters = {
    name: `paint:${sheen}:${resolved.swatch?.slug ?? resolved.hex.slice(1).toLowerCase()}`,
    color: baseColor,
    roughness: descriptor.roughness,
    metalness: descriptor.metalness,
    ior: descriptor.ior,
    specularIntensity,
    clearcoat: descriptor.clearcoat,
    clearcoatRoughness: descriptor.clearcoatRoughness,
    sheen: descriptor.sheen,
    sheenColor,
    sheenRoughness: descriptor.sheenRoughness,
    transmission: 0,
    side,
  };

  if (microTexture) {
    const maps = getPaintMicroTextures(descriptor.microTextureKind);
    params.roughnessMap = maps.roughnessMap;
    if (maps.valueModMap) {
      params.map = maps.valueModMap;
    }
  }

  const material = new THREE.MeshPhysicalMaterial(params);
  paintInfoRegistry.set(
    material,
    buildResolvedPaintInfo(resolved, descriptor, side, microTexture)
  );

  if (!unique) {
    paintMaterialCache.set(cacheKey, material);
  }
  return material;
}

/**
 * Explicit cached paint material accessor supporting either `PaintMaterialOptions`
 * or positional `(color, sheen?, options?)` arguments.
 */
export function getCachedPaintMaterial(
  options: Omit<PaintMaterialOptions, 'unique'>
): THREE.MeshPhysicalMaterial;
export function getCachedPaintMaterial(
  color: PaintColorInput,
  sheen?: PaintSheen,
  options?: Omit<PaintMaterialOptions, 'color' | 'sheen' | 'unique'>
): THREE.MeshPhysicalMaterial;
export function getCachedPaintMaterial(
  colorOrOptions: PaintColorInput | Omit<PaintMaterialOptions, 'unique'>,
  sheen?: PaintSheen,
  extraOptions?: Omit<PaintMaterialOptions, 'color' | 'sheen' | 'unique'>
): THREE.MeshPhysicalMaterial {
  if (
    arguments.length === 1 &&
    typeof colorOrOptions === 'object' &&
    colorOrOptions !== null &&
    !('isColor' in colorOrOptions) &&
    !isPaintSwatchObject(colorOrOptions) &&
    'color' in colorOrOptions &&
    ('sheen' in colorOrOptions ||
      'side' in colorOrOptions ||
      'microTexture' in colorOrOptions ||
      !(
        'name' in colorOrOptions ||
        'brand' in colorOrOptions ||
        'code' in colorOrOptions ||
        'complementaryWhite' in colorOrOptions ||
        'recommendedWhites' in colorOrOptions
      ))
  ) {
    const opts = colorOrOptions as Omit<PaintMaterialOptions, 'unique'>;
    return createPaintMaterial({ ...opts, unique: false });
  }

  return createPaintMaterial({
    color: colorOrOptions as PaintColorInput,
    ...(sheen !== undefined ? { sheen } : {}),
    ...extraOptions,
    unique: false,
  });
}

/**
 * Clears the cached `MeshPhysicalMaterial` table (primarily for isolated unit tests).
 */
export function clearPaintMaterialCache(): void {
  paintMaterialCache.clear();
}

/**
 * Retrieves non-intrusive resolved swatch & physical sheen metadata for a material
 * created by `createPaintMaterial` / `createRoomPaintScheme`.
 */
export function getPaintMaterialInfo(
  material: THREE.Material | null | undefined
): ResolvedPaintInfo | undefined {
  if (!material) return undefined;
  return paintInfoRegistry.get(material);
}

// -----------------------------------------------------------------------------
// Complete Room Paint Scheme Factory
// -----------------------------------------------------------------------------

const WASHABLE_ROOM_KINDS = new Set<RoomPaintKind>([
  'bathroom',
  'ensuite',
  'wc',
  'kitchen',
  'hallway',
  'utility',
  'boot-room',
]);

/**
 * Builds a complete, harmonised architectural room paint scheme (`{ walls, trim, ceiling, doors, radiator, info }`)
 * ready to pass directly into `createWallNetwork`, `createSkirtingRun`, `createCorniceRun`,
 * `createDadoRun`, `createPanellingRun`, and `populateWallOpenings`.
 */
export function createRoomPaintScheme(options: RoomPaintSchemeOptions): RoomPaintScheme {
  const roomKind: RoomPaintKind = options.roomKind ?? 'living';
  const wallsResolved = resolvePaintColor(options.wallColor);

  const trimColorInput: PaintColorInput =
    options.trimColor ??
    (wallsResolved.recommendedWhites.length > 0
      ? wallsResolved.recommendedWhites[0]!
      : 'wimborne-white');
  const trimResolved = resolvePaintColor(trimColorInput);

  const ceilingColorInput: PaintColorInput =
    options.ceilingColor ?? (trimResolved.lrv >= 50 ? trimColorInput : 'wimborne-white');

  const doorColorInput: PaintColorInput = options.doorColor ?? trimColorInput;
  const radiatorColorInput: PaintColorInput = options.radiatorColor ?? trimColorInput;

  const wallSheen: PaintSheen =
    options.wallSheen ??
    (WASHABLE_ROOM_KINDS.has(roomKind) ? 'modern-emulsion' : 'estate-emulsion');
  const trimSheen: PaintSheen = options.trimSheen ?? 'estate-eggshell';
  const ceilingSheen: PaintSheen = options.ceilingSheen ?? 'dead-flat';
  const doorSheen: PaintSheen = options.doorSheen ?? trimSheen;
  const radiatorSheen: PaintSheen = options.radiatorSheen ?? trimSheen;

  const sharedMatOpts = {
    ...(options.side !== undefined ? { side: options.side } : {}),
    ...(options.microTexture !== undefined ? { microTexture: options.microTexture } : {}),
  };

  const walls = createPaintMaterial({
    color: options.wallColor,
    sheen: wallSheen,
    ...sharedMatOpts,
  });
  const trim = createPaintMaterial({
    color: trimColorInput,
    sheen: trimSheen,
    ...sharedMatOpts,
  });
  const ceiling = createPaintMaterial({
    color: ceilingColorInput,
    sheen: ceilingSheen,
    ...sharedMatOpts,
  });
  const doors = createPaintMaterial({
    color: doorColorInput,
    sheen: doorSheen,
    ...sharedMatOpts,
  });
  const radiator = createPaintMaterial({
    color: radiatorColorInput,
    sheen: radiatorSheen,
    ...sharedMatOpts,
  });

  return Object.freeze({
    walls,
    trim,
    ceiling,
    doors,
    radiator,
    info: Object.freeze({
      roomKind,
      walls: getPaintMaterialInfo(walls)!,
      trim: getPaintMaterialInfo(trim)!,
      ceiling: getPaintMaterialInfo(ceiling)!,
      doors: getPaintMaterialInfo(doors)!,
      radiator: getPaintMaterialInfo(radiator)!,
    }),
  });
}

function isMaterialLike(value: unknown): value is THREE.Material {
  return (
    typeof value === 'object' &&
    value !== null &&
    ((value as Partial<THREE.Material>).isMaterial === true || value instanceof THREE.Material)
  );
}

/**
 * Builds a structured `RoomPaintSurfaceSpec` directly from a registered swatch ID/name,
 * `PaintSwatch`, `CustomPaintColorSpec`, raw colour, or live `THREE.Material` created via
 * `createPaintMaterial` / `createRoomPaintScheme`, ensuring room manifest metadata never
 * drifts from `paint-system.ts`.
 */
export function paintSpecFromSwatch(
  swatchIdOrMaterial: PaintColorInput | THREE.Material,
  sheen?: PaintSheen | string,
  notes?: string
): RoomPaintSurfaceSpec {
  if (isMaterialLike(swatchIdOrMaterial)) {
    const info = getPaintMaterialInfo(swatchIdOrMaterial);
    if (info) {
      return Object.freeze({
        ...(info.brand && info.brand !== 'Custom' ? { brand: info.brand } : {}),
        name: info.name,
        ...(info.code ? { code: info.code } : {}),
        hex: info.hex,
        sheen: sheen ?? info.sheen,
        ...(notes ? { notes } : {}),
      });
    }
    const matColor = (swatchIdOrMaterial as THREE.Material & { color?: THREE.Color }).color;
    const hex = matColor && matColor.isColor ? normalizeHexString(matColor) : '#FFFFFF';
    const matName = swatchIdOrMaterial.name?.trim() || hex;
    return Object.freeze({
      name: matName,
      hex,
      ...(sheen ? { sheen } : {}),
      ...(notes ? { notes } : {}),
    });
  }

  const resolved = resolvePaintColor(swatchIdOrMaterial);
  const explicitBrand =
    isCustomPaintColorSpec(swatchIdOrMaterial) && swatchIdOrMaterial.brand?.trim()
      ? swatchIdOrMaterial.brand.trim()
      : undefined;
  const brand =
    explicitBrand ?? (resolved.brand && resolved.brand !== 'Custom' ? resolved.brand : undefined);

  return Object.freeze({
    ...(brand ? { brand } : {}),
    name: resolved.name,
    ...(resolved.code ? { code: resolved.code } : {}),
    hex: resolved.hex,
    ...(sheen ? { sheen } : {}),
    ...(notes ? { notes } : {}),
  });
}
