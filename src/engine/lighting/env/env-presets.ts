import {
  timeSlotToTimeOfDay,
  type HouseEnvironmentHdrCell,
  type HouseEnvironmentHdrSpec,
} from '../../../core/types/environment-hdri.ts';
import type { TimeOfDay } from '../../../core/types/scene.ts';
import type { SolarDateTimeInput } from '../../../core/types/solar-weather.ts';

/** World-space vector as a readonly tuple (metres / unit direction). */
export type Vec3Tuple = readonly [number, number, number];

/**
 * Per-time-of-day environment preset. Everything here is camera-independent: the same values apply
 * to perspective, orthographic, walkthrough and top-down views.
 */
export interface EnvPresetConfig {
  /** 2K Radiance `.hdr` panorama (CC0, Poly Haven — see public/textures/hdr/README.md). */
  readonly hdrUrl: string;
  /** Horizontal texture coordinate (0..1) of the sun / moon disc in the HDR panorama. */
  readonly hdrSunU: number;
  /** Vertical texture coordinate (0 = zenith, 1 = nadir) of the sun / moon disc in the HDR panorama. */
  readonly hdrSunV: number;
  /** True only for legacy Poly Haven `meadow_2` day HDR where a low photographed sun is healed & moved overhead. */
  readonly relocateDaySun?: boolean;
  // Procedural fallback sky colours (used until the 2K HDR has streamed in, or if it fails to load).
  readonly skyZenith: number;
  readonly skyHorizon: number;
  readonly horizonGlow: number;
  readonly groundPasture: number;
  readonly groundBounce: number;
  readonly sunOrbColor: number;
  readonly sunOrbPeak: number;
  /** Image-based lighting strength (`scene.environmentIntensity`). */
  readonly envIntensity: number;
  /** Skybox brightness (`scene.backgroundIntensity`), independent from the IBL strength. */
  readonly bgIntensity: number;
  /** Skybox blur (`scene.backgroundBlurriness`); a touch of blur reads as aerial depth of field. */
  readonly bgBlurriness: number;
  /** Peak radiance kept in the IBL source; the sun disc is removed because the shadowed sun light replaces it. */
  readonly hdrMaxClampEnv: number;
  /** Peak radiance kept in the visible skybox (soft knee on the sun disc). */
  readonly hdrMaxClampBg: number;
  /** Extra darkening of the upper dome (0 = none) for a deeper twilight zenith. */
  readonly zenithDarkening: number;
  /** Warm stone/earth bounce lift added only to the IBL lower hemisphere (0 = none). */
  readonly envGroundBounceLift?: number;
  /** Baseline strength of precomputed window sky-portal daylight GI (0 at dusk/night). */
  readonly daylightGiStrength?: number;
  /** Direction *towards* the sun / moon (normalised at use). */
  readonly sunDirection: Vec3Tuple;
  readonly sunColor: number;
  readonly sunIntensity: number;
  readonly hemiSkyColor: number;
  readonly hemiGroundColor: number;
  readonly hemiIntensity: number;
  /** Renderer tone-mapping exposure for this time of day (the post pipeline reads it from the renderer). */
  readonly exposure: number;
  /** World-space site haze colour (also the fallback background colour). */
  readonly fogColor: number;
  /** Exp² haze density per metre *beyond the site radius* (camera-independent; see site-haze-fog.ts). */
  readonly fogDensity: number;
}

const HDR_BASE = `${import.meta.env?.BASE_URL ?? '/'}textures/hdr/`;

/** Resolves a bare `.hdr` filename (or relative/absolute URL) against `public/textures/hdr/`. */
export function resolveHdrAssetUrl(hdrUrlOrFile: string): string {
  if (
    hdrUrlOrFile.startsWith('/') ||
    hdrUrlOrFile.startsWith('http://') ||
    hdrUrlOrFile.startsWith('https://') ||
    hdrUrlOrFile.startsWith('blob:') ||
    hdrUrlOrFile.startsWith('data:')
  ) {
    return hdrUrlOrFile;
  }
  return `${HDR_BASE}${hdrUrlOrFile}`;
}

/** Builds an `EnvPresetConfig` for decoding & preparing a specific `HouseEnvironmentHdrCell`. */
export function buildCellEnvPresetConfig(
  spec: HouseEnvironmentHdrSpec,
  cell: HouseEnvironmentHdrCell
): EnvPresetConfig {
  const baseMode = timeSlotToTimeOfDay(cell.time);
  const base = ENV_PRESETS[baseMode];
  const isLegacyCountryside = spec.id === 'english-countryside';
  return {
    ...base,
    hdrUrl: resolveHdrAssetUrl(cell.hdrUrl),
    hdrSunU: cell.hdrSunU,
    hdrSunV: cell.hdrSunV,
    relocateDaySun: Boolean(cell.relocateDaySun),
    zenithDarkening: isLegacyCountryside ? base.zenithDarkening : 0,
  };
}

/**
 * Canonical UK (`Europe/London`) dates & hours backing the quick `Day`, `Dusk`, and `Night`
 * presets for temperate UK latitudes (Europe/London):
 * - `day`:   21 Jun (Summer Solstice) 10:21 BST — raking SE sun (~45.4° altitude, ~127° SE onto the `-X` frontage & `+Z` courtyard)
 * - `dusk`:  21 Jun 19:24 BST — warm golden-hour sun (~17.6° WNW over Paddock `+X` & Walled Garden)
 * - `night`: 02 Jan 23:00 GMT — crisp Full Moon night (~63.6° SSE illuminating west frontage & courtyard)
 */
export const CANONICAL_SOLAR_PRESETS: Readonly<Record<TimeOfDay, Required<SolarDateTimeInput>>> = {
  day: { civilHour: 10.35, dayOfYear: 172, year: 2026 },
  dusk: { civilHour: 19.4, dayOfYear: 172, year: 2026 },
  night: { civilHour: 23.0, dayOfYear: 2, year: 2026 },
};

export const ENV_PRESETS: Readonly<Record<TimeOfDay, EnvPresetConfig>> = {
  day: {
    // Poly Haven "meadow_2" (CC0): clear blue sky, hedgerow trees, sun ~72° high overhead.
    hdrUrl: `${HDR_BASE}english_countryside_day_2k.hdr`,
    hdrSunU: 0.6,
    hdrSunV: 0.10,
    relocateDaySun: true,
    skyZenith: 0x3b73b8,
    skyHorizon: 0xcbe0f2,
    horizonGlow: 0xf6efe2,
    groundPasture: 0x3c4d28,
    groundBounce: 0x2c381e,
    sunOrbColor: 0xfff8e8,
    sunOrbPeak: 7.5,
    // Generous sky IBL + hemisphere fill so daytime shadows in the courtyard and rooms read as
    // open sunlit daylight rather than dark gloom.
    envIntensity: 1.18,
    bgIntensity: 1.15,
    bgBlurriness: 0.02,
    hdrMaxClampEnv: 4.5,
    hdrMaxClampBg: 18.0,
    zenithDarkening: 0,
    envGroundBounceLift: 0.06,
    daylightGiStrength: 0.76,
    // High overhead summer midday sun (~74.3° elevation) so roof shadows are short (~1.7m)
    // and the entire courtyard, driveway, patio, pergola, and lawns are bathed in direct sunlight.
    sunDirection: [0.18, 0.96, -0.20],
    // ~5800 K daylight.
    sunColor: 0xfff4e8,
    sunIntensity: 4.6,
    hemiSkyColor: 0xeaf4ff,
    hemiGroundColor: 0x8c8276,
    hemiIntensity: 0.72,
    exposure: 1.15,
    fogColor: 0xcad9e8,
    fogDensity: 0.0016,
  },
  dusk: {
    // Poly Haven "spruit_sunrise" (CC0): warm golden-hour sun above the horizon.
    hdrUrl: `${HDR_BASE}english_countryside_dusk_2k.hdr`,
    hdrSunU: 0.6,
    hdrSunV: 0.34,
    relocateDaySun: false,
    skyZenith: 0x283c62,
    skyHorizon: 0xb87e56,
    horizonGlow: 0xf4a868,
    groundPasture: 0x363822,
    groundBounce: 0x28261a,
    sunOrbColor: 0xffb878,
    sunOrbPeak: 5.5,
    // Boosted twilight IBL + warm hemisphere fill so shadowed areas during dusk stay clear,
    // luminous, and readable rather than crushing to dark shadows.
    envIntensity: 0.68,
    bgIntensity: 0.82,
    bgBlurriness: 0.03,
    hdrMaxClampEnv: 4.2,
    hdrMaxClampBg: 16.0,
    zenithDarkening: 0.16,
    // Curated front-lit golden-hour sun (+Z SE ~+30.5° -> [59.84, 43.23, 52.53]) so warm rays reach into the courtyard and across the patio.
    sunDirection: [0.72, 0.48, 0.50],
    // ~3100 K golden hour.
    sunColor: 0xffbe7a,
    sunIntensity: 2.4,
    hemiSkyColor: 0x9eb0d4,
    hemiGroundColor: 0x5c4c3e,
    hemiIntensity: 0.46,
    exposure: 1.20,
    fogColor: 0xa68e7c,
    fogDensity: 0.0045,
  },
  night: {
    // Poly Haven "kloppenheim_02" (CC0): moonlit field with distant village glow.
    hdrUrl: `${HDR_BASE}english_countryside_night_2k.hdr`,
    hdrSunU: 0.6,
    hdrSunV: 0.405,
    relocateDaySun: false,
    skyZenith: 0x070c18,
    skyHorizon: 0x152238,
    horizonGlow: 0x243654,
    groundPasture: 0x0d120c,
    groundBounce: 0x090c08,
    sunOrbColor: 0x9ab4dc,
    sunOrbPeak: 3.2,
    // Kept low so interiors are lit by the fittings, not washed by sky IBL.
    envIntensity: 0.06,
    bgIntensity: 0.12,
    bgBlurriness: 0,
    hdrMaxClampEnv: 4.0,
    hdrMaxClampBg: 6.5,
    zenithDarkening: 0,
    // Static unit vector matching the canonical Full Moon direction (zero import-time ephemeris).
    sunDirection: [-0.445086, 0.895416, 0.01138],
    sunColor: 0x9fb6e6,
    sunIntensity: 0.22,
    hemiSkyColor: 0x34466a,
    hemiGroundColor: 0x14181a,
    hemiIntensity: 0.05,
    exposure: 1.12,
    fogColor: 0x0a0f1a,
    fogDensity: 0.007,
  },
};

/**
 * Y rotation (radians) for `scene.environmentRotation` / `scene.backgroundRotation` that puts the
 * HDR's sun disc (at texture column `hdrSunU`) on the azimuth of the world-space `sunDirection`.
 *
 * three.js maps a world direction to `u = atan2(z, x) / 2π + 0.5`, and an environment rotation of θ
 * moves panorama azimuth φ to world azimuth φ − θ, so θ = φ_hdr − φ_world.
 */
export function environmentRotationForSunXZ(sunX: number, sunZ: number, hdrSunU: number): number {
  const hdrAzimuth = (hdrSunU - 0.5) * Math.PI * 2;
  const worldAzimuth = Math.atan2(sunZ, sunX);
  let theta = hdrAzimuth - worldAzimuth;
  while (theta > Math.PI) theta -= Math.PI * 2;
  while (theta <= -Math.PI) theta += Math.PI * 2;
  return theta;
}

export function environmentRotationForSun(sunDirection: Vec3Tuple, hdrSunU: number): number {
  return environmentRotationForSunXZ(sunDirection[0], sunDirection[2], hdrSunU);
}

/** Uses crisp 2048x1024 2K .hdr panoramas on desktop and lightweight 512x256 .hdr on mobile. */
export function resolveEnvHdrUrl(mode: TimeOfDay, isMobile: boolean): string {
  const url = ENV_PRESETS[mode].hdrUrl;
  return isMobile ? url.replace('_2k.hdr', '_512.hdr') : url;
}
