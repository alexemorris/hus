import type { TimeOfDay, Vec3Tuple } from './scene.ts';
import type {
  HouseLocation,
  PrecipitationType,
  WeatherCondition,
} from './solar-weather.ts';

/** Canonical meteorological/astronomical season axis of the 3D environment HDRI tensor. */
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

/** User-facing season selector state (`'auto'` derives season from ephemeris date + hemisphere). */
export type SeasonSelection = 'auto' | Season;

/** Solar elevation & east/west hemisphere time slot of the 3D environment HDRI tensor. */
export type TimeSlot = 'dawn' | 'day' | 'dusk' | 'night';

/** Atmospheric cloud & precipitation regime of the 3D environment HDRI tensor. */
export type WeatherRegime = 'clear' | 'cloudy' | 'overcast' | 'rain' | 'snow';

/** Built-in environment HDRI suite identifiers shipped with `husjs`. */
export type HouseEnvironmentPresetId =
  | 'english-countryside'
  | 'hollywood-hills';

/** Broad climate classification governing seasonal foliage shifts and winter snow availability. */
export type HouseClimateZone = 'temperate' | 'warm';

/** Optional explicit climate override on `defineHouse({ climate })`. */
export interface HouseClimateConfig {
  readonly zone?: HouseClimateZone;
  readonly allowSnow?: boolean;
  readonly seasonalFoliage?: boolean;
}

export type HouseClimateInput = HouseClimateZone | HouseClimateConfig;

/** Resolved location- & season-aware climate capabilities surfaced in `SkyWeatherSnapshot` and HUD. */
export interface HouseClimateCapabilities {
  readonly zone: HouseClimateZone;
  readonly hasDistinctFoliageSeasons: boolean;
  readonly snowSupportedAtLocation: boolean;
  readonly snowAllowedNow: boolean;
  readonly snowDisabledReason: string | null;
  readonly seasonNote: string | null;
}

/** Single `(season, time, weather)` Radiance `.hdr` panorama cell in a house's environment manifest. */
export interface HouseEnvironmentHdrCell {
  readonly key: string;
  readonly season?: Season;
  readonly time: TimeSlot;
  readonly weather?: WeatherRegime;
  /** High-resolution Radiance `.hdr` filename (under `textures/hdr/`) or URL/path. */
  readonly hdrUrl: string;
  /** Optional `512×256` fast-preview Radiance `.hdr` filename or URL/path. */
  readonly previewHdrUrl?: string;
  /** Optional explicit visual detail `.webp` URL override (e.g. legacy `*_4k.webp`). */
  readonly detailUrl?: string;
  /** Horizontal equirectangular UV `[0..1)` of the dominant sun/moon azimuth in this panorama. */
  readonly hdrSunU: number;
  /** Vertical equirectangular UV `[0..1]` (`0` = zenith, `0.5` = horizon) of the sun/moon in this panorama. */
  readonly hdrSunV: number;
  /** Average linear sRGB radiance `[R, G, B]` of the distant ground band just below the horizon. */
  readonly horizonGround: Vec3Tuple;
  /** True only for legacy Poly Haven `meadow_2` where a low photographed sun is healed & moved overhead. */
  readonly relocateDaySun?: boolean;
}

export type EnvironmentHdrCell = HouseEnvironmentHdrCell;

/** Declarative 3D `(Season × TimeSlot × WeatherRegime)` HDRI environment specification. */
export interface HouseEnvironmentHdrSpec {
  readonly id: string;
  readonly label?: string;
  readonly defaultClimate?: HouseClimateZone;
  /**
   * When `true`, all panorama cells share a fixed True-North compass equirectangular frame
   * (`northU`, default `0`) so the skybox & IBL horizon lock to the site's True-North compass
   * bearing (`plusXTrueBearingDeg`) and never spin as solar azimuth moves.
   */
  readonly worldAnchored?: boolean;
  /**
   * Panorama horizontal coordinate `[0, 1)` corresponding to True North (`0°` compass bearing).
   * Defaults to `0` (`u = 0`: North, `u = 0.25`: East, `u = 0.5`: South, `u = 0.75`: West).
   */
  readonly northU?: number;
  readonly cells: readonly HouseEnvironmentHdrCell[];
}

/** Accepted `environment` property on `defineHouse({ environment })` and `PropertySceneProfile`. */
export type HouseEnvironmentInput = HouseEnvironmentPresetId | HouseEnvironmentHdrSpec;

/** Query coordinates in the 3D `(Season × TimeSlot × WeatherRegime)` environment tensor. */
export interface EnvironmentHdrQuery {
  readonly season: Season;
  readonly time: TimeSlot;
  readonly weather: WeatherRegime;
}

/** Result of resolving a `(season, time, weather)` query against a `HouseEnvironmentHdrSpec`. */
export interface ResolvedEnvironmentHdrCell {
  readonly specId: string;
  readonly cellKey: string;
  readonly cell: HouseEnvironmentHdrCell;
  readonly exactMatch: boolean;
  readonly distance: number;
}

/** Continuous dual-slot HDR blend resolved from topocentric solar altitude & azimuth. */
export interface ContinuousEnvironmentHdrBlend {
  readonly cellA: ResolvedEnvironmentHdrCell;
  readonly cellB: ResolvedEnvironmentHdrCell;
  /** Continuous blend factor in `[0, 1]` (`0` = 100% `cellA`, `1` = 100% `cellB`). */
  readonly blendT: number;
  /** Dominant slot (`blendT < 0.5 ? slotA : slotB`) for HUD / snapshot telemetry. */
  readonly dominantTimeSlot: TimeSlot;
  /** Adjacent time-of-day cell keys worth pre-warming in background. */
  readonly preloadCells: readonly ResolvedEnvironmentHdrCell[];
}

export const ALL_SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];
export const ALL_TIME_SLOTS: readonly TimeSlot[] = ['dawn', 'day', 'dusk', 'night'];
export const ALL_WEATHER_REGIMES: readonly WeatherRegime[] = [
  'clear',
  'cloudy',
  'overcast',
  'rain',
  'snow',
];

const NORTHERN_CANONICAL_DOY: Readonly<Record<Season, number>> = {
  spring: 110, // 20 Apr (mid-spring blossom)
  summer: 172, // 21 Jun (summer solstice)
  autumn: 288, // 15 Oct (golden autumn foliage)
  winter: 15, // 15 Jan (mid-winter)
};

const SOUTHERN_CANONICAL_DOY: Readonly<Record<Season, number>> = {
  spring: 288, // 15 Oct
  summer: 355, // 21 Dec
  autumn: 110, // 20 Apr
  winter: 196, // 15 Jul
};

const OPPOSITE_HEMISPHERE_SEASON: Readonly<Record<Season, Season>> = {
  spring: 'autumn',
  summer: 'winter',
  autumn: 'spring',
  winter: 'summer',
};

function smoothstep01(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-6, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Returns a representative `dayOfYear` (`1..365`) for `season` respecting Northern (`lat >= 0`)
 * vs Southern (`lat < 0`) hemisphere solar declination.
 */
export function canonicalDayOfYearForSeason(
  season: Season,
  latitudeDeg = 51.8412
): number {
  return latitudeDeg < 0
    ? SOUTHERN_CANONICAL_DOY[season]
    : NORTHERN_CANONICAL_DOY[season];
}

/**
 * Auto-derives `Season` from calendar `dayOfYear` (`1..366`) and site `latitudeDeg`
 * (`>= 0` Northern hemisphere vs `< 0` Southern hemisphere).
 */
export function deriveSeasonFromDayOfYear(
  dayOfYear: number,
  latitudeDeg = 51.8412
): Season {
  const doy = Math.max(1, Math.min(366, Math.round(dayOfYear)));
  let northern: Season;
  if (doy >= 79 && doy <= 171) {
    northern = 'spring';
  } else if (doy >= 172 && doy <= 264) {
    northern = 'summer';
  } else if (doy >= 265 && doy <= 354) {
    northern = 'autumn';
  } else {
    northern = 'winter';
  }
  return latitudeDeg < 0 ? OPPOSITE_HEMISPHERE_SEASON[northern] : northern;
}

/**
 * Derives `TimeSlot` (`dawn | day | dusk | night`) from topocentric solar altitude and
 * True-North compass azimuth (`< 180°` Eastern rising sun = `dawn`, `>= 180°` Western setting sun = `dusk`).
 */
export function deriveTimeSlot(
  altitudeDeg: number,
  azimuthFromNorthDeg: number,
  fallbackMode?: TimeOfDay
): TimeSlot {
  if (!Number.isFinite(altitudeDeg)) {
    return fallbackMode ?? 'dusk';
  }
  if (altitudeDeg < -3.5) {
    return 'night';
  }
  if (altitudeDeg >= 18.0) {
    return 'day';
  }
  const normAz = ((azimuthFromNorthDeg % 360) + 360) % 360;
  return normAz < 180 ? 'dawn' : 'dusk';
}

/**
 * Computes C1-smooth continuous dual-slot blend weights `(slotA, slotB, blendT)` across the
 * full 24-hour solar arc (`Night -> Dawn -> Day -> Dusk -> Night`) with zero jump across
 * solar noon (`azimuth = 180°`) or midnight (`azimuth = 0°`), including low-altitude winter
 * solstice and sub-arctic trajectories.
 */
export function resolveContinuousTimeSlotBlend(
  altitudeDeg: number,
  azimuthFromNorthDeg: number
): {
  readonly slotA: TimeSlot;
  readonly slotB: TimeSlot;
  readonly blendT: number;
  readonly dominantTimeSlot: TimeSlot;
} {
  if (!Number.isFinite(altitudeDeg) || !Number.isFinite(azimuthFromNorthDeg)) {
    return { slotA: 'dusk', slotB: 'dusk', blendT: 0, dominantTimeSlot: 'dusk' };
  }

  const normAz = ((azimuthFromNorthDeg % 360) + 360) % 360;

  // Outside the 18° meridian windows around 180° (solar noon) and 0°/360° (midnight),
  // follow the exact East (sin >= 0) and West (sin < 0) altitude smoothstep curves.
  // Inside the meridian windows, C1-taper residual twilight weight smoothly so crossing
  // 179.99° -> 180.01° or 359.99° -> 0.01° is 100% continuous at every altitude.
  let eastTwil = 0;
  let westTwil = 0;
  let westSide = 0;
  if (normAz >= 18 && normAz <= 162) {
    eastTwil = 1;
    westSide = 0;
  } else if (normAz > 162 && normAz <= 180) {
    eastTwil = 1 - smoothstep01(162, 180, normAz);
    westSide = smoothstep01(162, 198, normAz);
  } else if (normAz > 180 && normAz < 198) {
    westTwil = smoothstep01(180, 198, normAz);
    westSide = smoothstep01(162, 198, normAz);
  } else if (normAz >= 198 && normAz <= 342) {
    westTwil = 1;
    westSide = 1;
  } else if (normAz > 342) {
    westTwil = 1 - smoothstep01(342, 360, normAz);
    westSide = 1 - smoothstep01(-18, 18, normAz - 360);
  } else {
    eastTwil = smoothstep01(0, 18, normAz);
    westSide = 1 - smoothstep01(-18, 18, normAz);
  }

  const peakAlt = 2.5 + 2.0 * westSide;
  const dayAlt = 12.5 + 1.0 * westSide;

  let wNight = 0;
  let wTwil = 0;
  let wDay = 0;
  if (altitudeDeg <= -6.0) {
    wNight = 1;
  } else if (altitudeDeg < peakAlt) {
    const t = smoothstep01(-6.0, peakAlt, altitudeDeg);
    wNight = 1 - t;
    wTwil = t;
  } else if (altitudeDeg < dayAlt) {
    const t = smoothstep01(peakAlt, dayAlt, altitudeDeg);
    wTwil = 1 - t;
    wDay = t;
  } else {
    wDay = 1;
  }

  const twilKeep = eastTwil + westTwil;
  const residualTwil = (1 - twilKeep) * wTwil;
  if (normAz >= 90 && normAz <= 270) {
    wDay += residualTwil;
  } else {
    wNight += residualTwil;
  }
  const wDawn = eastTwil * wTwil;
  const wDusk = westTwil * wTwil;

  const entries: Array<readonly [TimeSlot, number]> = [
    ['day', wDay],
    ['dawn', wDawn],
    ['dusk', wDusk],
    ['night', wNight],
  ];
  entries.sort((a, b) => b[1] - a[1]);

  const [s1, v1] = entries[0]!;
  const [s2, v2] = entries[1]!;
  const v3 = entries[2]![1];
  const a1 = v1 - v3;
  const a2 = v2 - v3;
  const denom = a1 + a2;
  const rawT = denom > 1e-8 ? a2 / denom : 0;

  let slotA: TimeSlot = s1;
  let slotB: TimeSlot = s2;
  let blendT = rawT;
  if (rawT <= 1e-7) {
    slotB = slotA;
    blendT = 0;
  } else if (
    (slotA === 'dawn' && slotB === 'night') ||
    (slotA === 'day' && slotB === 'dawn') ||
    (slotA === 'dusk' && slotB === 'day') ||
    (slotA === 'night' && slotB === 'dusk')
  ) {
    slotA = s2;
    slotB = s1;
    blendT = 1 - rawT;
  }

  const dominantTimeSlot: TimeSlot = blendT < 0.5 ? slotA : slotB;
  return { slotA, slotB, blendT, dominantTimeSlot };
}

/** Maps a 4-state `TimeSlot` onto the nearest 3-state legacy `TimeOfDay` lighting baseline. */
export function timeSlotToTimeOfDay(slot: TimeSlot): TimeOfDay {
  if (slot === 'day') return 'day';
  if (slot === 'night') return 'night';
  return 'dusk';
}

/**
 * Auto-derives `WeatherRegime` (`clear | cloudy | overcast | rain | snow`) from composable
 * cloud cover, precipitation layer, and live weather condition.
 */
export function deriveWeatherRegime(input: {
  readonly cloudEnabled?: boolean;
  readonly cloudCoverPct: number;
  readonly precipType: PrecipitationType;
  readonly precipIntensity: number;
  readonly condition?: WeatherCondition;
  readonly snowAllowed?: boolean;
}): WeatherRegime {
  const allowSnow = input.snowAllowed ?? true;
  if (
    allowSnow &&
    ((input.precipType === 'snow' && input.precipIntensity > 0.05) ||
      input.condition === 'snow')
  ) {
    return 'snow';
  }
  if (
    (input.precipType === 'rain' && input.precipIntensity > 0.05) ||
    input.condition === 'rain' ||
    input.condition === 'heavy_rain' ||
    input.condition === 'drizzle'
  ) {
    return 'rain';
  }
  // If snow was requested where disallowed, treat its cloud deck as overcast rather than snow
  const effCloud =
    input.cloudEnabled === false ? 0 : Math.max(0, Math.min(100, input.cloudCoverPct));
  if (
    effCloud >= 76 ||
    input.condition === 'overcast' ||
    input.condition === 'fog' ||
    (!allowSnow && input.condition === 'snow')
  ) {
    return 'overcast';
  }
  if (effCloud >= 22 || input.condition === 'partly_cloudy') {
    return 'cloudy';
  }
  return 'clear';
}

function formatLocationSummaryForTooltip(location?: Partial<HouseLocation>): string {
  const lat = location?.lat;
  if (typeof lat !== 'number' || !Number.isFinite(lat)) {
    return 'warm/subtropical climate';
  }
  const absLat = Math.abs(lat).toFixed(1);
  const hemi = lat >= 0 ? 'N' : 'S';
  const elev = location?.elevationM;
  if (typeof elev === 'number' && Number.isFinite(elev)) {
    return `${absLat}°${hemi}, ${Math.round(elev)} m`;
  }
  return `${absLat}°${hemi}`;
}

/**
 * Evaluates location- & season-aware climate capabilities:
 *  - Warm / Mediterranean / Subtropical / Tropical (`|lat| < 36°` and `elevationM < 900 m`, unless overridden):
 *    disables snow year-round (`snowSupportedAtLocation = false`, `snowAllowedNow = false`) with a clear location tooltip.
 *  - Temperate / Alpine (`|lat| >= 36°` or `elevationM >= 900 m`):
 *    enables all 4 distinct foliage seasons and enables `Snow` in `Winter` while greying out `Snow` in
 *    `Spring`, `Summer`, and `Autumn` (`"Snow only available in Winter"`).
 */
export function resolveClimateCapabilities(params: {
  readonly location?: Partial<HouseLocation>;
  readonly season: Season;
  readonly environment?: HouseEnvironmentInput;
  readonly climate?: HouseClimateInput;
}): HouseClimateCapabilities {
  const { location, season, environment, climate } = params;
  const climateCfg: HouseClimateConfig | undefined =
    typeof climate === 'string' ? { zone: climate } : climate;

  const specDefaultZone =
    typeof environment === 'object' && environment !== null
      ? environment.defaultClimate
      : environment === 'hollywood-hills'
        ? 'warm'
        : undefined;

  const absLat =
    typeof location?.lat === 'number' && Number.isFinite(location.lat)
      ? Math.abs(location.lat)
      : 51.8412;
  const elevM =
    typeof location?.elevationM === 'number' && Number.isFinite(location.elevationM)
      ? location.elevationM
      : 0;

  const inferredZone: HouseClimateZone =
    absLat < 36 && elevM < 900 ? 'warm' : 'temperate';
  const zone: HouseClimateZone =
    climateCfg?.zone ??
    (location?.lat !== undefined ? inferredZone : specDefaultZone ?? inferredZone);

  const snowSupportedAtLocation =
    climateCfg?.allowSnow ?? zone === 'temperate';
  const hasDistinctFoliageSeasons =
    climateCfg?.seasonalFoliage ?? zone === 'temperate';

  if (!snowSupportedAtLocation) {
    const locSummary = formatLocationSummaryForTooltip(location);
    return {
      zone,
      hasDistinctFoliageSeasons,
      snowSupportedAtLocation: false,
      snowAllowedNow: false,
      snowDisabledReason: `Snow unavailable at this location (${locSummary})`,
      seasonNote: hasDistinctFoliageSeasons
        ? null
        : 'Mild climate — season adjusts solar declination & sun arc',
    };
  }

  const isWinter = season === 'winter';
  return {
    zone,
    hasDistinctFoliageSeasons,
    snowSupportedAtLocation: true,
    snowAllowedNow: isWinter,
    snowDisabledReason: isWinter ? null : 'Snow only available in Winter',
    seasonNote: null,
  };
}

/**
 * Computes subtle seasonal meadow grass tint (`tintRgb`) and snow dusting (`snowCover` in `[0, 1]`)
 * for `SiteGround` so the 3D terrain harmonizes seamlessly with the active 360° HDRI horizon.
 */
export function resolveSeasonalGroundStyle(params: {
  readonly season: Season;
  readonly weather: WeatherRegime;
  readonly climateZone: HouseClimateZone;
  readonly precipIntensity?: number;
}): {
  readonly tintRgb: Vec3Tuple;
  readonly snowCover: number;
} {
  const { season, weather, climateZone, precipIntensity = 0.7 } = params;
  if (climateZone === 'warm') {
    switch (season) {
      case 'spring':
        return { tintRgb: [0.97, 1.03, 0.93], snowCover: 0 };
      case 'summer':
        return { tintRgb: [1.05, 0.99, 0.87], snowCover: 0 };
      case 'autumn':
        return { tintRgb: [1.07, 0.96, 0.85], snowCover: 0 };
      case 'winter':
        return { tintRgb: [0.95, 1.01, 0.94], snowCover: 0 };
    }
  }

  if (season === 'winter' && weather === 'snow') {
    const clampedP = Math.max(0, Math.min(1, precipIntensity));
    return {
      tintRgb: [0.94, 0.97, 1.02],
      snowCover: 0.72 + 0.2 * clampedP,
    };
  }

  switch (season) {
    case 'spring':
      return { tintRgb: [0.95, 1.08, 0.90], snowCover: 0 };
    case 'summer':
      return { tintRgb: [1.0, 1.0, 1.0], snowCover: 0 };
    case 'autumn':
      return { tintRgb: [1.14, 0.93, 0.75], snowCover: 0 };
    case 'winter':
      return { tintRgb: [0.91, 0.95, 0.90], snowCover: 0 };
  }
}

// ---------------------------------------------------------------------------
// Built-in Environment HDRI Specifications
// ---------------------------------------------------------------------------

export const ENGLISH_COUNTRYSIDE_HDR_SPEC: HouseEnvironmentHdrSpec = {
  id: 'english-countryside',
  label: 'English Countryside (Legacy 3-Slot)',
  defaultClimate: 'temperate',
  worldAnchored: false,
  cells: [
    {
      key: 'day',
      time: 'day',
      weather: 'clear',
      hdrUrl: 'english_countryside_day_2k.hdr',
      previewHdrUrl: 'english_countryside_day_512.hdr',
      detailUrl: '/textures/hdr/english_countryside_day_4k.webp',
      hdrSunU: 0.6,
      hdrSunV: 0.1,
      horizonGround: [0.1048, 0.1182, 0.0447],
      relocateDaySun: true,
    },
    {
      key: 'dusk',
      time: 'dusk',
      weather: 'clear',
      hdrUrl: 'english_countryside_dusk_2k.hdr',
      previewHdrUrl: 'english_countryside_dusk_512.hdr',
      detailUrl: '/textures/hdr/english_countryside_dusk_4k.webp',
      hdrSunU: 0.653,
      hdrSunV: 0.34,
      horizonGround: [0.3038, 0.2094, 0.0697],
    },
    {
      key: 'night',
      time: 'night',
      weather: 'clear',
      hdrUrl: 'english_countryside_night_2k.hdr',
      previewHdrUrl: 'english_countryside_night_512.hdr',
      detailUrl: '/textures/hdr/english_countryside_night_4k.webp',
      hdrSunU: 0.556,
      hdrSunV: 0.38,
      horizonGround: [0.0687, 0.0678, 0.0393],
    },
  ],
};

export const HOLLYWOOD_HILLS_HDR_SPEC: HouseEnvironmentHdrSpec = {
  id: 'hollywood-hills',
  label: 'Hollywood Hills · Los Angeles Basin',
  defaultClimate: 'warm',
  worldAnchored: true,
  northU: 0,
  cells: [
    {
      key: 'dawn_clear',
      time: 'dawn',
      weather: 'clear',
      hdrUrl: 'hollywood_hills_dawn_clear_2k.hdr',
      previewHdrUrl: 'hollywood_hills_dawn_clear_512.hdr',
      hdrSunU: 0.25,
      hdrSunV: 0.42,
      horizonGround: [0.2797, 0.2029, 0.26],
    },
    {
      key: 'day_clear',
      time: 'day',
      weather: 'clear',
      hdrUrl: 'hollywood_hills_day_clear_2k.hdr',
      previewHdrUrl: 'hollywood_hills_day_clear_512.hdr',
      hdrSunU: 0.5,
      hdrSunV: 0.18,
      horizonGround: [0.3751, 0.4747, 0.661],
    },
    {
      key: 'day_overcast',
      time: 'day',
      weather: 'overcast',
      hdrUrl: 'hollywood_hills_day_overcast_2k.hdr',
      previewHdrUrl: 'hollywood_hills_day_overcast_512.hdr',
      hdrSunU: 0.5,
      hdrSunV: 0.18,
      horizonGround: [0.4558, 0.4922, 0.6267],
    },
    {
      key: 'dusk_clear',
      time: 'dusk',
      weather: 'clear',
      hdrUrl: 'hollywood_hills_dusk_clear_2k.hdr',
      previewHdrUrl: 'hollywood_hills_dusk_clear_512.hdr',
      hdrSunU: 0.75,
      hdrSunV: 0.36,
      horizonGround: [0.2231, 0.14, 0.1834],
    },
    {
      key: 'night_clear',
      time: 'night',
      weather: 'clear',
      hdrUrl: 'hollywood_hills_night_clear_2k.hdr',
      previewHdrUrl: 'hollywood_hills_night_clear_512.hdr',
      hdrSunU: 0.5,
      hdrSunV: 0.38,
      horizonGround: [0.0458, 0.034, 0.0301],
    },
  ],
};

export const BUILTIN_ENVIRONMENT_HDR_SPECS: Readonly<
  Record<HouseEnvironmentPresetId, HouseEnvironmentHdrSpec>
> = {
  'english-countryside': ENGLISH_COUNTRYSIDE_HDR_SPEC,
  'hollywood-hills': HOLLYWOOD_HILLS_HDR_SPEC,
};

/** Normalizes an optional `HouseEnvironmentInput` into a concrete `HouseEnvironmentHdrSpec`. */
export function normalizeEnvironmentHdrSpec(
  input?: HouseEnvironmentInput
): HouseEnvironmentHdrSpec {
  if (!input) {
    return ENGLISH_COUNTRYSIDE_HDR_SPEC;
  }
  if (typeof input === 'string') {
    return BUILTIN_ENVIRONMENT_HDR_SPECS[input] ?? ENGLISH_COUNTRYSIDE_HDR_SPEC;
  }
  return input.cells.length > 0 ? input : ENGLISH_COUNTRYSIDE_HDR_SPEC;
}

const SEASON_RING_INDEX: Readonly<Record<Season, number>> = {
  spring: 0,
  summer: 1,
  autumn: 2,
  winter: 3,
};

function computeTimeDistance(cellTime: TimeSlot, queryTime: TimeSlot): number {
  if (cellTime === queryTime) return 0;
  // Never mix night with daytime/twilight unless no other cell exists
  if (cellTime === 'night' || queryTime === 'night') return 24.0;
  // Dawn and Dusk are both low golden-horizon skies
  if (
    (cellTime === 'dawn' && queryTime === 'dusk') ||
    (cellTime === 'dusk' && queryTime === 'dawn')
  ) {
    return 0.45;
  }
  // Dawn/Dusk <-> Day
  return 2.6;
}

function computeWeatherDistance(
  cellWeather: WeatherRegime | undefined,
  queryWeather: WeatherRegime
): number {
  if (!cellWeather || cellWeather === queryWeather) return 0;
  // Never show snow-covered ground when queryWeather is not snow!
  if (cellWeather === 'snow' && queryWeather !== 'snow') return 12.0;
  if (queryWeather === 'snow' && cellWeather !== 'snow') {
    // If snow was queried on a non-snow manifest, overcast/rain diffuse sky is closest
    if (cellWeather === 'overcast') return 0.8;
    if (cellWeather === 'rain') return 1.0;
    if (cellWeather === 'cloudy') return 1.8;
    return 2.8;
  }

  const order: Readonly<Record<Exclude<WeatherRegime, 'snow'>, number>> = {
    clear: 0,
    cloudy: 0.9,
    overcast: 1.75,
    rain: 2.05,
  };
  const a = order[cellWeather as Exclude<WeatherRegime, 'snow'>];
  const b = order[queryWeather as Exclude<WeatherRegime, 'snow'>];
  return Math.abs(a - b);
}

function computeSeasonDistance(cellSeason: Season | undefined, querySeason: Season): number {
  if (!cellSeason || cellSeason === querySeason) return 0;
  const diff = Math.abs(SEASON_RING_INDEX[cellSeason] - SEASON_RING_INDEX[querySeason]);
  const ringDist = Math.min(diff, 4 - diff); // 1 for adjacent season, 2 for opposite season
  // Winter bare branches vs leafy seasons is slightly larger than spring <-> summer
  const winterPenalty =
    (cellSeason === 'winter' || querySeason === 'winter') && cellSeason !== querySeason ? 0.35 : 0;
  return ringDist * 0.95 + winterPenalty;
}

/**
 * Resolves the best-matching `.hdr` cell from `specInput` for `{ season, time, weather }`:
 *  - Returns an exact `(season, time, weather)` match (`exactMatch = true`) whenever available.
 *  - Otherwise falls back deterministically along physical distance (`time -> weather -> season`),
 *    guaranteeing zero 404s for 3-cell legacy `'english-countryside'`, 5-cell `'hollywood-hills'`,
 *    or custom user manifests.
 */
export function resolveEnvironmentHdrCell(
  specInput: HouseEnvironmentInput | undefined,
  query: EnvironmentHdrQuery
): ResolvedEnvironmentHdrCell {
  const spec = normalizeEnvironmentHdrSpec(specInput);
  let bestCell = spec.cells[0]!;
  let bestDist = Infinity;
  let bestExact = false;

  for (const cell of spec.cells) {
    const isExact =
      (cell.season === undefined || cell.season === query.season) &&
      cell.time === query.time &&
      (cell.weather === undefined || cell.weather === query.weather);

    // Slight specificity preference (+0.01) for cells declaring explicit season/weather over wildcards
    const wildcardNudge =
      (cell.season === undefined ? 0.005 : 0) + (cell.weather === undefined ? 0.005 : 0);

    const d =
      computeTimeDistance(cell.time, query.time) +
      computeWeatherDistance(cell.weather, query.weather) +
      computeSeasonDistance(cell.season, query.season) +
      wildcardNudge;

    if (d < bestDist) {
      bestDist = d;
      bestCell = cell;
      bestExact = isExact;
    }
  }

  return {
    specId: spec.id,
    cellKey: bestCell.key,
    cell: bestCell,
    exactMatch: bestExact,
    distance: Number(bestDist.toFixed(4)),
  };
}

/**
 * Resolves continuous dual-slot HDR cells `(cellA, cellB, blendT)` and background `preloadCells`
 * for `(season, weather, altitudeDeg, azimuthFromNorthDeg)`.
 */
export function resolveContinuousEnvironmentHdrBlend(
  input: HouseEnvironmentInput | undefined,
  season: Season,
  weather: WeatherRegime,
  altitudeDeg: number,
  azimuthFromNorthDeg: number
): ContinuousEnvironmentHdrBlend {
  const spec = normalizeEnvironmentHdrSpec(input);
  const { slotA, slotB, blendT: rawBlendT, dominantTimeSlot } = resolveContinuousTimeSlotBlend(
    altitudeDeg,
    azimuthFromNorthDeg
  );
  const cellA = resolveEnvironmentHdrCell(spec, { season, time: slotA, weather });
  const cellB = resolveEnvironmentHdrCell(spec, { season, time: slotB, weather });
  const blendT = cellA.cellKey === cellB.cellKey ? 0 : rawBlendT;

  const preloadCells: ResolvedEnvironmentHdrCell[] = [];
  const seenKeys = new Set<string>([cellA.cellKey, cellB.cellKey]);
  for (const slot of ALL_TIME_SLOTS) {
    const candidate = resolveEnvironmentHdrCell(spec, { season, time: slot, weather });
    if (!seenKeys.has(candidate.cellKey)) {
      seenKeys.add(candidate.cellKey);
      preloadCells.push(candidate);
    }
  }

  return {
    cellA,
    cellB,
    blendT,
    dominantTimeSlot,
    preloadCells,
  };
}
