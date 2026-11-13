import type { ClimateZone } from "../geo/climate-phenology.ts";
import type {
  HouseClimateCapabilities,
  Season,
  SeasonSelection,
  TimeSlot,
  WeatherRegime,
} from './environment-hdri.ts';
import type { TimeOfDay, Vec3Tuple } from './scene.ts';

/** Default temperate WGS84 latitude (Cotswolds / Oxfordshire countryside, 51.8412°N). */
export const DEFAULT_HUS_LATITUDE_DEG = 51.8412;

/** Default temperate WGS84 longitude (Cotswolds / Oxfordshire countryside, -1.7924°W). */
export const DEFAULT_HUS_LONGITUDE_DEG = -1.7924;

/** Default True-North compass bearing (degrees clockwise from True North) of scene `+X` (`90°` East, `-Z` = True North). */
export const DEFAULT_HUS_PLUS_X_BEARING_DEG = 90;
export const DEFAULT_HUS_MINUS_X_BEARING_DEG = 270;
export const DEFAULT_HUS_PLUS_Z_BEARING_DEG = 180;
export const DEFAULT_HUS_MINUS_Z_BEARING_DEG = 0;

/** Geodetic site location & compass orientation for solar/lunar ephemeris and Open-Meteo live weather. */
export interface HouseLocation {
  readonly lat: number;
  readonly lon: number;
  /**
   * Optional clockwise rotation offset (degrees) of True North relative to default `-Z = North`
   * (`+X = East = 90° True`): when provided without `plusXTrueBearingDeg`,
   * `plusXTrueBearingDeg = ((90 + northOffsetDeg) % 360 + 360) % 360`.
   */
  readonly northOffsetDeg?: number;
  /**
   * Optional explicit True-North compass bearing (degrees clockwise from True North) of Twin `+X`
   * (e.g. `90` when `+X` faces due East). Takes precedence over `northOffsetDeg`.
   */
  readonly plusXTrueBearingDeg?: number;
  readonly label?: string;
  readonly timezone?: string;
  readonly elevationM?: number;
  /** Optional explicit botanical climate override (`classifyClimateZone` honors this first). */
  readonly climateOverride?: ClimateZone;
}

/** Alias for `HouseLocation` accepted by `classifyClimateZone` and `husjs/vegetation`. */
export type HomeLocation = HouseLocation;

/**
 * Resolves the True-North compass bearing (degrees clockwise from True North) of Twin `+X`
 * from an optional `HouseLocation`. Defaults to `90°` (`+X = East`, `-Z = North`) when neither
 * `plusXTrueBearingDeg` nor `northOffsetDeg` is provided.
 */
export function resolvePlusXTrueBearingDeg(location?: Partial<HouseLocation>): number {
  if (
    typeof location?.plusXTrueBearingDeg === 'number' &&
    Number.isFinite(location.plusXTrueBearingDeg)
  ) {
    return ((location.plusXTrueBearingDeg % 360) + 360) % 360;
  }
  if (
    typeof location?.northOffsetDeg === 'number' &&
    Number.isFinite(location.northOffsetDeg)
  ) {
    return (((90 + location.northOffsetDeg) % 360) + 360) % 360;
  }
  return 90;
}

/** Default temperate countryside location metadata for Hus scenes when no explicit `location` is supplied. */
export const DEFAULT_HUS_LOCATION: HouseLocation = {
  lat: DEFAULT_HUS_LATITUDE_DEG,
  lon: DEFAULT_HUS_LONGITUDE_DEG,
  plusXTrueBearingDeg: DEFAULT_HUS_PLUS_X_BEARING_DEG,
  label: 'Cotswolds · Gloucestershire',
  timezone: 'Europe/London',
  elevationM: 142,
};

/** Canonical weather conditions matching Open-Meteo Met Office UKV classification. */
export type WeatherCondition =
  | 'clear'
  | 'partly_cloudy'
  | 'overcast'
  | 'drizzle'
  | 'rain'
  | 'heavy_rain'
  | 'fog'
  | 'snow';

/** Active precipitation particle mode (`none` = 0 GPU cost & 0 idle frame wakeups). */
export type PrecipitationType = 'none' | 'rain' | 'snow';

/** Quick weather presets exposed in the HUD weather popover. */
export type WeatherPresetId =
  | 'clear'
  | 'partly_cloudy'
  | 'overcast'
  | 'light_rain'
  | 'heavy_storm'
  | 'morning_mist'
  | 'winter_snow';

/** Input parameters for continuous solar + lunar evaluation in `Europe/London` civil time. */
export interface SolarDateTimeInput {
  /** Local UK civil clock hour in `[0, 24)` (`Europe/London`: GMT in winter, BST in summer). */
  readonly civilHour: number;
  /** Day of year in `[1, 366]` (1 = Jan 1). */
  readonly dayOfYear: number;
  /** Calendar year used for UK BST transitions and lunar orbital epoch (default current year). */
  readonly year?: number;
}

/** Renderer-agnostic scalar summary of the sun's astronomical state at the site location. */
export interface SolarEphemerisSummary {
  readonly civilHour: number;
  readonly dayOfYear: number;
  readonly year: number;
  /** Local civil timezone offset from UTC in hours (e.g. `+1` for BST, `-7` for PDT, `0` for GMT). */
  readonly utcOffsetHours: number;
  /** Optional IANA timezone identifier (e.g. `'Europe/London'`, `'America/Los_Angeles'`). */
  readonly timezone?: string;
  /** Short civil timezone abbreviation (e.g. `'BST'`, `'GMT'`, `'PDT'`, `'UTC-8'`). */
  readonly timezoneAbbreviation?: string;
  readonly equationOfTimeMin: number;
  readonly apparentSolarHour: number;
  readonly solarNoonHour: number;
  readonly sunriseHour: number;
  readonly sunsetHour: number;
  readonly dayLengthHours: number;
  readonly declinationDeg: number;
  /** Apparent solar altitude above the horizon in degrees (including Bennett refraction). */
  readonly altitudeDeg: number;
  /** True compass azimuth in degrees `[0, 360)` clockwise from True North (`0°=N, 90°=E, 180°=S, 270°=W`). */
  readonly azimuthFromNorthDeg: number;
  readonly isAfterSunset: boolean;
  /** Unclamped unit vector toward the sun in Three.js world space. */
  readonly trueSunDirection: Vec3Tuple;
  /** Altitude-clamped (`>= 6.3°`) unit vector driving the directional shadow light. */
  readonly shadowLightDirection: Vec3Tuple;
}

/** Renderer-agnostic scalar summary of the Moon's topocentric state & phase at the site location. */
export interface LunarEphemerisSummary {
  readonly altitudeDeg: number;
  readonly azimuthFromNorthDeg: number;
  /** Illuminated disc fraction in `[0, 1]` (`0` = New Moon, `0.5` = Quarter, `1` = Full Moon). */
  readonly illuminatedFraction: number;
  readonly synodicPhaseDeg: number;
  readonly isWaxing: boolean;
  readonly lunarAgeDays: number;
  readonly phaseName: string;
  readonly trueMoonDirection: Vec3Tuple;
  readonly shadowMoonDirection: Vec3Tuple;
}

/** Independent composable 3-layer weather state (Cloud Deck + Precipitation + Valley Mist/Fog). */
export interface WeatherLayersState {
  readonly cloudEnabled: boolean;
  readonly cloudCoverPct: number;
  readonly precipType: PrecipitationType;
  readonly precipIntensity: number;
  readonly fogEnabled: boolean;
  readonly fogIntensity: number;
}

/** Full live or manual weather state for the active site location. */
export interface LiveWeatherState extends WeatherLayersState {
  readonly liveFeedEnabled: boolean;
  readonly condition: WeatherCondition;
  readonly rawConditionCode: string;
  readonly description: string;
  readonly temperatureC: number;
  readonly feelsLikeC: number;
  readonly dewPointC: number;
  readonly precipitationMm: number;
  readonly precipitationChancePct: number;
  readonly thunderstormChancePct: number;
  readonly windSpeedKph: number;
  readonly windGustKph: number;
  readonly windDirDeg: number;
  readonly humidityPct: number;
  readonly visibilityKm: number;
  readonly pressureHpa: number;
  readonly source: string;
  readonly updatedAtIso: string;
  /** Surface wetness factor `[0, 1]` applied to exterior cobbles, slate, and asphalt. */
  readonly surfaceWetness: number;
  /** Optional IANA timezone returned by Open-Meteo (`&timezone=auto`) or configured on the location. */
  readonly timezone?: string;
  /** Optional short timezone abbreviation returned by Open-Meteo (e.g. `'PDT'`, `'BST'`). */
  readonly timezoneAbbreviation?: string;
  /** Optional UTC offset in seconds returned by Open-Meteo (e.g. `-25200`). */
  readonly utcOffsetSeconds?: number;
  /** Optional site elevation in metres returned by Open-Meteo or configured on the location. */
  readonly elevationM?: number;
}

/** Unified sky, solar/lunar ephemeris, compass, and weather snapshot delivered through `TwinApi`. */
export interface SkyWeatherSnapshot {
  readonly timeOfDay: TimeOfDay;
  readonly liveClockSync: boolean;
  readonly plusXTrueBearingDeg: number;
  readonly locationLabel?: string;
  readonly latitudeDeg?: number;
  readonly longitudeDeg?: number;
  readonly elevationM?: number;
  readonly season?: Season;
  readonly seasonSelection?: SeasonSelection;
  readonly timeSlot?: TimeSlot;
  readonly weatherRegime?: WeatherRegime;
  readonly environmentId?: string;
  readonly activeHdrCellKey?: string;
  readonly climate?: HouseClimateCapabilities;
  readonly solar: SolarEphemerisSummary;
  readonly lunar: LunarEphemerisSummary;
  readonly weather: LiveWeatherState;
}

const CARDINAL_16: readonly string[] = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
];

/** Converts a compass bearing `[0, 360)` into a 16-wind cardinal label (`N`, `NNE`, …, `SSE`, …). */
export function bearingToCardinal16(bearingDeg: number): string {
  const norm = ((bearingDeg % 360) + 360) % 360;
  const idx = Math.round(norm / 22.5) % 16;
  return CARDINAL_16[idx] ?? 'N';
}

/** Formats a fractional clock hour `[0, 24)` as `HH:MM` (e.g. `13.5` -> `"13:30"`). */
export function formatHourClock(hour: number): string {
  const norm = ((hour % 24) + 24) % 24;
  const totalMinutes = Math.round(norm * 60) % (24 * 60);
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

const MONTH_SHORT: readonly string[] = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Formats a `dayOfYear` (`1..366`) in a given `year` as e.g. `"21 Jun"`. */
export function formatDayOfYear(dayOfYear: number, year = 2026): string {
  const d = new Date(Date.UTC(year, 0, Math.max(1, Math.min(366, Math.round(dayOfYear)))));
  const day = d.getUTCDate();
  const mon = MONTH_SHORT[d.getUTCMonth()] ?? 'Jan';
  return `${day} ${mon}`;
}

/**
 * Converts a horizontal camera look vector `(fx, fz)` (from `cameraPosition` toward `target`)
 * into a True-North compass bearing `[0, 360)` using the estate's `+X` True bearing.
 */
export function cameraForwardToTrueBearingDeg(
  fx: number,
  fz: number,
  plusXTrueBearingDeg = DEFAULT_HUS_PLUS_X_BEARING_DEG
): number {
  if (Math.hypot(fx, fz) < 1e-6) {
    return ((plusXTrueBearingDeg % 360) + 360) % 360;
  }
  const relDeg = (Math.atan2(fz, fx) * 180) / Math.PI;
  return (((plusXTrueBearingDeg + relDeg) % 360) + 360) % 360;
}

/**
 * Computes the exact SVG `<path d="...">` for the illuminated portion of a
 * `32x32` lunar phase disc (`cx = 16, cy = 16, r = 12.5`) matching the Moon's
 * selenocentric illumination fraction and waxing/waning limb orientation.
 */
export function buildMoonTerminatorSvgPath(illuminatedFraction: number, isWaxing: boolean): string {
  const k = Math.max(0, Math.min(1, illuminatedFraction));
  if (k <= 0.012) return '';
  if (k >= 0.988) {
    return 'M 16 3.5 A 12.5 12.5 0 1 1 16 28.5 A 12.5 12.5 0 1 1 16 3.5 Z';
  }
  const outerSweep = isWaxing ? 1 : 0;
  const isGibbous = k >= 0.5;
  const terminatorSweep = isWaxing === isGibbous ? 1 : 0;
  const rx = Math.max(0.08, 12.5 * Math.abs(2.0 * k - 1.0));
  return `M 16 3.5 A 12.5 12.5 0 0 ${outerSweep} 16 28.5 A ${rx.toFixed(2)} 12.5 0 0 ${terminatorSweep} 16 3.5 Z`;
}
