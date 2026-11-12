import * as THREE from 'three';
import type { GraphicsTier } from '../../../core/types/twin-ux.ts';
import {
  Fn,
  abs,
  cameraPosition,
  clamp,
  dot,
  float,
  length,
  mix,
  normalize,
  normalWorld,
  positionWorld,
  smoothstep,
  uniform,
} from 'three/tsl';
import {
  DEFAULT_HUS_PLUS_X_BEARING_DEG,
  DEFAULT_HUS_LATITUDE_DEG,
  DEFAULT_HUS_LONGITUDE_DEG,
  resolvePlusXTrueBearingDeg,
  type HouseLocation,
  type LiveWeatherState,
  type PrecipitationType,
  type WeatherCondition,
  type WeatherLayersState,
  type WeatherPresetId,
} from '../../../core/types/solar-weather.ts';
import type { RoomBoundingBox } from '../../../core/types/topology.ts';
import type { AmbientWeatherAudioState } from './ambient-soundscape.ts';
import { compassAzimuthAltitudeToWorldVector } from './solar-astronomy.ts';

export type {
  LiveWeatherState,
  PrecipitationType,
  WeatherCondition,
  WeatherLayersState,
  WeatherPresetId,
};

/**
 * Builds the global Open-Meteo seamless best-match forecast URL for any WGS84 coordinate pair.
 * With `timezone=auto` (default), Open-Meteo automatically resolves `timezone`,
 * `timezone_abbreviation`, `utc_offset_seconds`, and `elevation` for the coordinates.
 */
export function buildOpenMeteoForecastUrl(lat: number, lon: number, timezone = 'auto'): string {
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,precipitation,rain,showers,snowfall,weather_code,cloud_cover,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility' +
    '&hourly=precipitation_probability,visibility' +
    `&timezone=${encodeURIComponent(timezone)}&forecast_days=1`
  );
}

/** Live weather polling interval: 5 minutes (paused automatically when tab is hidden or manual override is active). */
const LIVE_WEATHER_POLL_MS = 5 * 60 * 1000;

const CLOUD_CLUSTERS = 44;
const PUFFS_PER_CLUSTER = 6;
const TOTAL_CLOUD_INSTANCES = CLOUD_CLUSTERS * PUFFS_PER_CLUSTER;
const RAIN_BANDS = 3;
const DROPS_PER_RAIN_BAND = 300;
const PRECIP_TILE_SPAN_XZ = 88.0;
const RAIN_TILE_HEIGHT_Y = 30.0;
const SPLASH_PHASE_GROUPS = 4;
const RINGS_PER_SPLASH_GROUP = 32;
const SNOW_BANDS = 3;
const FLAKES_PER_SNOW_BAND = 180;
const SNOW_TILE_HEIGHT_Y = 26.0;
const CLOUD_DRIFT_SYNC_STEP_M = 0.35;

export interface DerivedWeatherClassification {
  readonly condition: WeatherCondition;
  readonly rawConditionCode: string;
  readonly description: string;
  readonly precipitationMm: number;
  readonly intensity: number;
}

export interface WeatherTelemetryInput {
  readonly wmoCode?: number;
  readonly precipChancePct: number;
  readonly liquidPrecipMm: number;
  readonly snowPrecipMm: number;
  readonly cloudCoverPct: number;
  readonly visibilityKm: number;
  readonly humidityPct: number;
  readonly tempC: number;
  readonly dewPointC: number;
  readonly thunderChancePct?: number;
}

const CONDITION_LABELS: Readonly<Record<WeatherCondition, string>> = {
  clear: 'Clear Sky',
  partly_cloudy: 'Partly Cloudy',
  overcast: 'Overcast',
  drizzle: 'Light Rain',
  rain: 'Rain',
  heavy_rain: 'Heavy Storm',
  fog: 'Valley Mist',
  snow: 'Winter Snow',
};

function primaryLocationName(locationLabel?: string): string | undefined {
  const trimmed = locationLabel?.trim();
  if (!trimmed) return undefined;
  const primary = trimmed.split('·')[0]?.trim();
  return primary || trimmed;
}

function formatConditionDescription(baseLabel: string, locationLabel?: string): string {
  const primary = primaryLocationName(locationLabel);
  return primary ? `${baseLabel} · ${primary}` : baseLabel;
}

/**
 * Weather classification rules mapping precipitation, visibility, dew spread, cloud cover,
 * and WMO weather codes from Open-Meteo into normalized architectural weather conditions.
 */
export function deriveWeatherConditionFromTelemetry(
  input: WeatherTelemetryInput,
  locationLabel?: string
): DerivedWeatherClassification {
  const wmo = input.wmoCode ?? -1;
  const thunderChance = input.thunderChancePct ?? (wmo >= 95 && wmo <= 99 ? 75 : 0);
  const dewSpread = Math.max(0, input.tempC - input.dewPointC);

  const isWmoSnow = (wmo >= 71 && wmo <= 77) || wmo === 85 || wmo === 86;
  const isWmoHeavyRain = wmo === 65 || wmo === 67 || wmo === 82 || (wmo >= 95 && wmo <= 99);
  const isWmoRain = wmo === 61 || wmo === 63 || wmo === 66 || wmo === 80 || wmo === 81;
  const isWmoDrizzle = wmo >= 51 && wmo <= 57;
  const isWmoFog = wmo === 45 || wmo === 48;
  const isWmoPrecip = isWmoSnow || isWmoHeavyRain || isWmoRain || isWmoDrizzle;

  const hasActivePrecip =
    input.precipChancePct >= 20 ||
    input.liquidPrecipMm >= 0.1 ||
    input.snowPrecipMm >= 0.1 ||
    isWmoPrecip;

  if (hasActivePrecip && (isWmoSnow || input.snowPrecipMm >= 0.1 || (input.tempC <= 0.5 && input.liquidPrecipMm >= 0.15))) {
    const totalSnow = Math.max(input.snowPrecipMm, input.liquidPrecipMm, isWmoSnow ? 0.8 : 0);
    const intensity = Math.min(1.0, Math.max(0.28, totalSnow / 4.0));
    return {
      condition: 'snow',
      rawConditionCode: 'SNOW',
      description: formatConditionDescription(CONDITION_LABELS.snow, locationLabel),
      precipitationMm: Number(totalSnow.toFixed(2)),
      intensity: Number(intensity.toFixed(2)),
    };
  }

  if (
    hasActivePrecip &&
    (isWmoHeavyRain ||
      input.liquidPrecipMm >= 6.35 ||
      (thunderChance >= 40 && input.liquidPrecipMm >= 0.25))
  ) {
    const effMm = Math.max(input.liquidPrecipMm, isWmoHeavyRain ? 6.5 : 0.5);
    const intensity = Math.min(1.0, Math.max(0.75, effMm / 8.0));
    return {
      condition: 'heavy_rain',
      rawConditionCode: 'HEAVY_RAIN',
      description: formatConditionDescription(CONDITION_LABELS.heavy_rain, locationLabel),
      precipitationMm: Number(effMm.toFixed(2)),
      intensity: Number(intensity.toFixed(2)),
    };
  }

  if (
    hasActivePrecip &&
    (input.liquidPrecipMm >= 0.76 || isWmoRain)
  ) {
    const effMm = Math.max(input.liquidPrecipMm, isWmoRain ? 1.4 : 0.8);
    const intensity = Math.min(0.9, Math.max(0.45, effMm / 5.0));
    return {
      condition: 'rain',
      rawConditionCode: 'RAIN',
      description: formatConditionDescription(CONDITION_LABELS.rain, locationLabel),
      precipitationMm: Number(effMm.toFixed(2)),
      intensity: Number(intensity.toFixed(2)),
    };
  }

  if (hasActivePrecip && (input.liquidPrecipMm >= 0.1 || input.precipChancePct >= 25 || isWmoDrizzle)) {
    const effMm = Math.max(input.liquidPrecipMm, isWmoDrizzle ? 0.35 : 0.15);
    const intensity = Math.min(0.6, Math.max(0.25, effMm / 2.0));
    return {
      condition: 'drizzle',
      rawConditionCode: 'LIGHT_RAIN',
      description: formatConditionDescription(CONDITION_LABELS.drizzle, locationLabel),
      precipitationMm: Number(effMm.toFixed(2)),
      intensity: Number(intensity.toFixed(2)),
    };
  }

  if (
    isWmoFog ||
    (input.visibilityKm > 0 && input.visibilityKm <= 2.5) ||
    (input.humidityPct >= 96 && dewSpread <= 1.0 && input.cloudCoverPct >= 75)
  ) {
    const fogInt = Math.min(
      1.0,
      Math.max(0.35, input.visibilityKm > 0 ? (10.0 - Math.min(10.0, input.visibilityKm)) / 9.0 : 0.75)
    );
    return {
      condition: 'fog',
      rawConditionCode: 'FOG',
      description: formatConditionDescription(CONDITION_LABELS.fog, locationLabel),
      precipitationMm: 0,
      intensity: Number(fogInt.toFixed(2)),
    };
  }

  if (input.cloudCoverPct >= 90) {
    const overcastInt = Number(Math.min(1.0, Math.max(0.35, input.cloudCoverPct / 100.0)).toFixed(2));
    return {
      condition: 'overcast',
      rawConditionCode: 'CLOUDY',
      description: formatConditionDescription(CONDITION_LABELS.overcast, locationLabel),
      precipitationMm: 0,
      intensity: overcastInt,
    };
  }

  if (input.cloudCoverPct >= 65) {
    const cloudyInt = Number(Math.min(0.85, Math.max(0.2, input.cloudCoverPct / 100.0)).toFixed(2));
    return {
      condition: 'partly_cloudy',
      rawConditionCode: 'MOSTLY_CLOUDY',
      description: formatConditionDescription('Mostly Cloudy', locationLabel),
      precipitationMm: 0,
      intensity: cloudyInt,
    };
  }

  if (input.cloudCoverPct >= 20) {
    const cloudyInt = Number(Math.min(0.85, Math.max(0.2, input.cloudCoverPct / 100.0)).toFixed(2));
    return {
      condition: 'partly_cloudy',
      rawConditionCode: input.cloudCoverPct >= 30 ? 'PARTLY_CLOUDY' : 'MOSTLY_CLEAR',
      description: formatConditionDescription(CONDITION_LABELS.partly_cloudy, locationLabel),
      precipitationMm: 0,
      intensity: cloudyInt,
    };
  }

  return {
    condition: 'clear',
    rawConditionCode: 'CLEAR',
    description: formatConditionDescription(CONDITION_LABELS.clear, locationLabel),
    precipitationMm: 0,
    intensity: Number(Math.max(0.1, input.cloudCoverPct / 100.0).toFixed(2)),
  };
}

/** Parses a raw Open-Meteo forecast JSON payload into normalized telemetry and location metadata. */
export function parseOpenMeteoForecastResponse(
  raw: unknown,
  locationLabel?: string
): Omit<LiveWeatherState, 'liveFeedEnabled' | 'surfaceWetness'> | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const root = raw as Record<string, unknown>;
  const current = root['current'];
  if (typeof current !== 'object' || current === null) return null;
  const cur = current as Record<string, unknown>;

  const num = (v: unknown, fallback: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  const tempC = Number(num(cur['temperature_2m'], 13.5).toFixed(1));
  const feelsLikeC = Number(num(cur['apparent_temperature'], tempC).toFixed(1));
  const humidityPct = Math.max(0, Math.min(100, Math.round(num(cur['relative_humidity_2m'], 70))));
  const dewPointC = Number(num(cur['dew_point_2m'], tempC - 4.0).toFixed(1));
  const precipTotalMm = Math.max(0, num(cur['precipitation'], 0));
  const rainMm = Math.max(0, num(cur['rain'], 0) + num(cur['showers'], 0));
  // Open-Meteo `snowfall` is reported in cm/h; convert to mm water/snow depth proxy
  const snowfallCm = Math.max(0, num(cur['snowfall'], 0));
  const snowMm = snowfallCm * 10.0;
  const liquidPrecipMm = Math.max(rainMm, snowfallCm > 0 ? 0 : precipTotalMm);
  const wmoCode = Math.round(num(cur['weather_code'], 2));
  const cloudCoverPct = Math.max(0, Math.min(100, Math.round(num(cur['cloud_cover'], 38))));
  const pressureHpa = Number(num(cur['surface_pressure'], 1014.0).toFixed(1));
  const windSpeedKph = Number(Math.max(0, num(cur['wind_speed_10m'], 14.0)).toFixed(1));
  const windGustKph = Number(Math.max(windSpeedKph, num(cur['wind_gusts_10m'], windSpeedKph * 1.4)).toFixed(1));
  const windDirDeg = ((Math.round(num(cur['wind_direction_10m'], 235)) % 360) + 360) % 360;

  let visibilityMeters = num(cur['visibility'], Number.NaN);
  let precipChancePct = 15;
  const hourly = root['hourly'];
  if (typeof hourly === 'object' && hourly !== null) {
    const h = hourly as Record<string, unknown>;
    const curHourPrefix = typeof cur['time'] === 'string' ? cur['time'].slice(0, 13) : '';
    const times = Array.isArray(h['time']) ? h['time'] : [];
    let idx = curHourPrefix
      ? times.findIndex((t) => typeof t === 'string' && t.startsWith(curHourPrefix))
      : -1;
    if (idx < 0 && times.length > 0) idx = 0;
    const pops = Array.isArray(h['precipitation_probability']) ? h['precipitation_probability'] : [];
    if (idx >= 0 && idx < pops.length) {
      precipChancePct = Math.max(0, Math.min(100, Math.round(num(pops[idx], precipChancePct))));
    }
    if (!Number.isFinite(visibilityMeters)) {
      const visArr = Array.isArray(h['visibility']) ? h['visibility'] : [];
      if (idx >= 0 && idx < visArr.length) {
        visibilityMeters = num(visArr[idx], 12_000);
      }
    }
  }
  const visibilityKm = Number(
    Math.max(0.1, (Number.isFinite(visibilityMeters) ? visibilityMeters : 12_000) / 1000.0).toFixed(1)
  );
  const thunderChancePct = wmoCode >= 95 && wmoCode <= 99 ? 75 : 0;

  const classified = deriveWeatherConditionFromTelemetry(
    {
      wmoCode,
      precipChancePct,
      liquidPrecipMm,
      snowPrecipMm: snowMm,
      cloudCoverPct,
      visibilityKm,
      humidityPct,
      tempC,
      dewPointC,
      thunderChancePct,
    },
    locationLabel
  );

  const cloudEnabled = cloudCoverPct > 2;
  let precipType: PrecipitationType = 'none';
  let precipIntensity = 0;
  if (classified.condition === 'snow') {
    precipType = 'snow';
    precipIntensity = classified.intensity;
  } else if (
    classified.condition === 'drizzle' ||
    classified.condition === 'rain' ||
    classified.condition === 'heavy_rain'
  ) {
    precipType = 'rain';
    precipIntensity = classified.intensity;
  }

  const fogEnabled = classified.condition === 'fog' || visibilityKm < 3.5;
  const fogIntensity = fogEnabled
    ? Math.max(0.35, Math.min(0.95, 1.0 - visibilityKm / 6.0))
    : 0;

  const timezone = typeof root['timezone'] === 'string' ? root['timezone'] : undefined;
  const timezoneAbbreviation =
    typeof root['timezone_abbreviation'] === 'string'
      ? root['timezone_abbreviation']
      : undefined;
  const rawUtcOffset = root['utc_offset_seconds'];
  const utcOffsetSeconds =
    typeof rawUtcOffset === 'number' && Number.isFinite(rawUtcOffset) ? rawUtcOffset : undefined;
  const rawElevation = root['elevation'];
  const elevationM =
    typeof rawElevation === 'number' && Number.isFinite(rawElevation) ? rawElevation : undefined;
  const trimmedLabel = locationLabel?.trim();

  return {
    condition: classified.condition,
    rawConditionCode: classified.rawConditionCode,
    description: classified.description,
    temperatureC: tempC,
    feelsLikeC,
    dewPointC,
    precipitationMm: classified.precipitationMm,
    precipitationChancePct: precipChancePct,
    thunderstormChancePct: thunderChancePct,
    cloudCoverPct: cloudEnabled ? cloudCoverPct : 0,
    windSpeedKph,
    windGustKph,
    windDirDeg,
    humidityPct,
    visibilityKm,
    pressureHpa,
    source: trimmedLabel ? `Open-Meteo Live (${trimmedLabel})` : 'Open-Meteo Live',
    updatedAtIso: typeof cur['time'] === 'string' ? cur['time'] : new Date().toISOString(),
    cloudEnabled,
    precipType,
    precipIntensity,
    fogEnabled,
    fogIntensity,
    timezone,
    timezoneAbbreviation,
    utcOffsetSeconds,
    elevationM,
  };
}

/** Backwards-compatible alias for {@link parseOpenMeteoForecastResponse}. */
export const parseOpenMeteoUkvResponse = parseOpenMeteoForecastResponse;

/** Deterministic PRNG (mulberry32) so cloud puffs, rain streaks, and splash rings are bit-reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Procedural 64x64 RGBA splash-crown double-ring DataTexture (WebGPU + WebGL2 + Node safe). */
function createSplashRingTexture(size = 64): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = ((x + 0.5) / size) * 2.0 - 1.0;
      const ny = ((y + 0.5) / size) * 2.0 - 1.0;
      const r = Math.hypot(nx, ny);
      let alpha = 0;
      if (r <= 1.0) {
        const outerRing = Math.exp(-Math.pow((r - 0.78) * 6.5, 2));
        const innerRing = Math.exp(-Math.pow((r - 0.42) * 7.2, 2)) * 0.55;
        const centerMist = Math.max(0, 1.0 - r * r) * 0.28;
        alpha = Math.min(1.0, outerRing * 0.85 + innerRing + centerMist);
      }
      const i = (y * size + x) * 4;
      data[i] = 228;
      data[i + 1] = 238;
      data[i + 2] = 250;
      data[i + 3] = Math.round(alpha * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Procedural 64x64 RGBA 6-fold hexagonal crystal snowflake DataTexture (WebGPU + WebGL2 + Node safe). */
function createSnowflakeTexture(size = 64): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = ((x + 0.5) / size) * 2.0 - 1.0;
      const ny = ((y + 0.5) / size) * 2.0 - 1.0;
      const r = Math.hypot(nx, ny);
      let alpha = 0;
      if (r <= 1.0) {
        const ang = Math.atan2(ny, nx);
        const hexStar = 0.76 + 0.24 * Math.cos(ang * 6.0);
        const dendrite = 0.88 + 0.12 * Math.cos(ang * 12.0);
        const normR = r / Math.max(0.2, hexStar * dendrite);
        alpha = normR < 1.0 ? Math.pow(1.0 - normR * normR, 1.55) : 0;
      }
      const i = (y * size + x) * 4;
      data[i] = 246;
      data[i + 1] = 250;
      data[i + 2] = 255;
      data[i + 3] = Math.round(Math.min(1, alpha) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

interface CloudPuffSeed {
  readonly clusterIdx: number;
  readonly baseX: number;
  readonly baseY: number;
  readonly baseZ: number;
  readonly localOffsetX: number;
  readonly localOffsetY: number;
  readonly localOffsetZ: number;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly radiusZ: number;
  readonly rotY: number;
  readonly threshold: number;
  readonly shadeBias: number;
}

interface TiledRainBand {
  readonly meshA: THREE.LineSegments;
  readonly meshB: THREE.LineSegments;
  readonly geometry: THREE.BufferGeometry;
  readonly fallSpeed: number;
  readonly phaseOffset: number;
}

interface TiledSnowBand {
  readonly meshA: THREE.InstancedMesh;
  readonly meshB: THREE.InstancedMesh;
  readonly fallSpeed: number;
  readonly swirlFreq: number;
  readonly swirlAmp: number;
  readonly phaseOffset: number;
}

interface SplashPhaseGroup {
  readonly mesh: THREE.InstancedMesh;
  readonly material: THREE.MeshBasicMaterial;
  readonly seeds: readonly { readonly relX: number; readonly relZ: number; readonly maxRadius: number }[];
  readonly phaseOffset: number;
  validCount: number;
}

/**
 * Off-world zero-scale matrix `(0, -10000, 0)` with scale `(0, 0, 0)` written to every
 * unpopulated or inactive `InstancedMesh` slot (`0 .. maxCount - 1`) so WebGPU/WebGL2
 * pipelines can NEVER render a default identity instance at world origin `(0, 0, 0)`
 * (the Kitchen Range Hob!).
 */
const PARKED_INSTANCE_MATRIX = new THREE.Matrix4().compose(
  new THREE.Vector3(0, -10_000, 0),
  new THREE.Quaternion(),
  new THREE.Vector3(0, 0, 0)
);

function parkInstancedMeshRange(mesh: THREE.InstancedMesh, startIndex = 0): void {
  const maxCount = mesh.instanceMatrix.count;
  for (let i = Math.max(0, startIndex); i < maxCount; i++) {
    mesh.setMatrixAt(i, PARKED_INSTANCE_MATRIX);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

function isDefaultIndoorFootprint(x: number, z: number): boolean {
  // Default building roof pad envelope around world origin (0, 0, 0)
  return x >= -23.0 && x <= 13.8 && z >= -11.8 && z <= 5.4;
}

/** Deterministically samples `(x, z)` strictly outside the farmhouse roof envelope (0% indoor leak). */
function sampleOutdoorXZ(
  rand: () => number,
  halfSpanX: number,
  halfSpanZ: number,
  centerZ = 4.0
): readonly [number, number] {
  for (let attempt = 0; attempt < 24; attempt++) {
    const x = (rand() * 2.0 - 1.0) * halfSpanX;
    const z = centerZ + (rand() * 2.0 - 1.0) * halfSpanZ;
    if (!isDefaultIndoorFootprint(x, z)) return [x, z];
  }
  // Deterministic exterior fallback in the South/East cobbled courtyard (+Z)
  return [(rand() * 2.0 - 1.0) * halfSpanX, 7.5 + rand() * Math.max(6.0, halfSpanZ - 6.0)];
}

interface ExteriorWetMaterialEntry {
  readonly mat: THREE.MeshStandardMaterial;
  readonly baseRoughness: number;
  readonly baseMetalness: number;
}

export interface WeatherAtmosphereCoupling {
  readonly condition: WeatherCondition;
  readonly effCloudCover: number;
  readonly rainDarkening: number;
  readonly fogStrength: number;
  readonly fogClearRadiusM: number;
  readonly surfaceWetness: number;
  readonly audio: AmbientWeatherAudioState;
}

export interface WeatherLightingContext {
  readonly sunDirection: THREE.Vector3;
  readonly sunAltitudeDeg: number;
  readonly goldenFactor: number;
  readonly nightFactor: number;
}

const NOOP_RAYCAST = (): void => {};

export interface WeatherControllerOptions {
  readonly onWeatherChanged?: () => void;
  readonly fetchImpl?: typeof fetch;
  readonly location?: HouseLocation;
}

/**
 * WebGPU + WebGL2 safe composable 3-layer weather engine:
 * 1. 3D Volumetric Cumulus/Stratocumulus Cloud Deck (`InstancedMesh`, per-puff sunlit/storm shading)
 * 2. Wind-Sheared Precipitation (`LineSegments` rain streaks + exterior ground splash crowns, or
 *    billboarded 6-fold hexagonal crystal snowflakes; strict 0 GPU cost & 0 idle wakeups when `none`)
 * 3. Valley Mist / Fog, Exterior Surface Wetness Sheen & Global Open-Meteo Live Weather Feed
 */
export class WeatherController {
  public readonly group: THREE.Group;

  private readonly cloudMesh: THREE.InstancedMesh;
  private readonly cloudMaterial: THREE.MeshBasicMaterial;
  private readonly cloudSeeds: readonly CloudPuffSeed[];
  private readonly uCumulusSunDir: THREE.Vector3;
  private readonly uCumulusTopColor: THREE.Color;
  private readonly uCumulusBaseColor: THREE.Color;
  private readonly uCumulusParams: THREE.Vector4;

  private readonly rainGroup: THREE.Group;
  private readonly rainMaterial: THREE.LineBasicMaterial;
  private readonly rainBands: readonly TiledRainBand[];

  private readonly splashGroup: THREE.Group;
  private readonly splashGeometry: THREE.PlaneGeometry;
  private readonly splashTexture: THREE.DataTexture;
  private readonly splashPhaseGroups: readonly SplashPhaseGroup[];
  private splashBakedAnchorX = Number.NaN;
  private splashBakedAnchorZ = Number.NaN;

  private readonly snowGroup: THREE.Group;
  private readonly snowGeometry: THREE.PlaneGeometry;
  private readonly snowTexture: THREE.DataTexture;
  private readonly snowMaterial: THREE.MeshBasicMaterial;
  private readonly snowBands: readonly TiledSnowBand[];

  private interiorBounds: readonly RoomBoundingBox[] = [];
  private wetMaterialsIndexed = false;
  private readonly wetMaterials: ExteriorWetMaterialEntry[] = [];

  private state: LiveWeatherState;
  private snowAllowed = true;
  private manualOverrideVersion = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private hostScene: THREE.Scene | null = null;
  private elapsedSec = 0;
  private readonly lastCamPos = new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN);
  private readonly lastCamTarget = new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN);
  private readonly lastCamQuat = new THREE.Quaternion(Number.NaN, Number.NaN, Number.NaN, Number.NaN);
  private stationarySec = 0;
  private stationaryRainAccumSec = 0;
  private cloudDriftOffsetXZ = new THREE.Vector2(0, 0);
  private readonly cloudAnchorXZ = new THREE.Vector2(-4, 4);
  private readonly lastSyncedCloudDriftXZ = new THREE.Vector2(Number.NaN, Number.NaN);
  private readonly windWorldDir = new THREE.Vector3(-0.7, 0, -0.7);
  private readonly lastLightingCtx: { sunDirection: THREE.Vector3; sunAltitudeDeg: number; goldenFactor: number; nightFactor: number } = {
    sunDirection: new THREE.Vector3(-0.45, 0.87, -0.17),
    sunAltitudeDeg: 45,
    goldenFactor: 0,
    nightFactor: 0,
  };

  private readonly dummyMatrix = new THREE.Matrix4();
  private readonly dummyPos = new THREE.Vector3();
  private readonly dummyQuat = new THREE.Quaternion();
  private readonly dummyScale = new THREE.Vector3();
  private readonly colorScratch = new THREE.Color();

  private readonly onWeatherChanged?: () => void;
  private readonly fetchImpl: typeof fetch | undefined;
  private location: HouseLocation;
  private sampleGroundY: (wx: number, wz: number) => number = () => 0;

  public constructor(options: WeatherControllerOptions = {}) {
    this.onWeatherChanged = options.onWeatherChanged;
    this.fetchImpl = options.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
    this.location = options.location
      ? { ...options.location }
      : {
          lat: DEFAULT_HUS_LATITUDE_DEG,
          lon: DEFAULT_HUS_LONGITUDE_DEG,
          plusXTrueBearingDeg: DEFAULT_HUS_PLUS_X_BEARING_DEG,
        };

    this.group = new THREE.Group();
    this.group.name = '__hus_weather_system__';
    this.group.userData = {
      tradeViewIgnore: true,
      excludeFromPick: true,
      isWeatherOverlay: true,
    };

    const rand = mulberry32(20260837);

    // 1. platform37-style Solar-Lit Volumetric Cumulus Cloud Deck (44 sky-dome clusters × 6 puffs,
    //    flat 0.42× condensation bases, progressive coverageOrder 0..100%, half-Lambert sun shading,
    //    British slate undersides & soft view-normal rim feathering in both WebGPU TSL & WebGL2 GLSL)
    const puffGeo = new THREE.IcosahedronGeometry(1, 1);
    const puffPosAttr = puffGeo.getAttribute('position');
    for (let vi = 0; vi < puffPosAttr.count; vi++) {
      const vx = puffPosAttr.getX(vi);
      const vy = puffPosAttr.getY(vi);
      const vz = puffPosAttr.getZ(vi);
      // Organic cumulus billow harmonics + flat 0.42x condensation base on lower hemisphere
      const billow =
        1.0 +
        0.11 * Math.sin(vx * 3.1 + vz * 2.3) +
        0.07 * Math.cos(vy * 3.7 - vx * 2.1) +
        0.05 * Math.sin((vx + vy + vz) * 4.3);
      const flatY = vy < 0 ? vy * 0.42 : vy * (0.92 + 0.12 * Math.max(0, vy));
      puffPosAttr.setXYZ(vi, vx * billow, flatY * billow, vz * billow);
    }
    puffPosAttr.needsUpdate = true;
    puffGeo.computeVertexNormals();

    const nonCloning = <T extends { clone: () => T }>(v: T): T => {
      v.clone = () => v;
      return v;
    };
    this.uCumulusSunDir = nonCloning(new THREE.Vector3(-0.59, 0.71, 0.38).normalize());
    this.uCumulusTopColor = nonCloning(new THREE.Color(0xfffdf8));
    this.uCumulusBaseColor = nonCloning(new THREE.Color(0x8fa1b8));
    // x = effCloudCover (0..1), y = silverLiningStrength, z = opacityScale, w = overcastDarken
    this.uCumulusParams = nonCloning(new THREE.Vector4(0.0, 0.35, 0.92, 0.0));

    this.cloudMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.94,
      depthTest: true,
      depthWrite: false,
      fog: false,
    });
    const cumulusSunNode = uniform(this.uCumulusSunDir);
    const cumulusTopNode = uniform(this.uCumulusTopColor);
    const cumulusBaseNode = uniform(this.uCumulusBaseColor);
    const cumulusParamsNode = uniform(this.uCumulusParams);

    const tslCloudMat = this.cloudMaterial as unknown as {
      colorNode?: unknown;
      opacityNode?: unknown;
    };
    tslCloudMat.colorNode = Fn(() => {
      const nWorld = normalize(normalWorld).toVar();
      const viewDir = normalize(cameraPosition.sub(positionWorld)).toVar();
      const halfLambert = smoothstep(
        0.16,
        0.92,
        dot(nWorld, cumulusSunNode).mul(0.5).add(0.5)
      );
      const domeUp = clamp(nWorld.y.mul(0.58).add(0.46), 0.0, 1.0);
      const litMix = clamp(domeUp.mul(0.54).add(halfLambert.mul(0.46)), 0.0, 1.0);
      const forwardSun = clamp(dot(viewDir.negate(), cumulusSunNode), 0.0, 1.0);
      const rimEdge = float(1.0).sub(abs(dot(nWorld, viewDir)));
      const silver = forwardSun
        .pow(4.0)
        .mul(rimEdge)
        .mul(cumulusParamsNode.y);
      return mix(cumulusBaseNode, cumulusTopNode, litMix).add(cumulusTopNode.mul(silver));
    })();
    tslCloudMat.opacityNode = Fn(() => {
      const nWorld = normalize(normalWorld);
      const viewDir = normalize(cameraPosition.sub(positionWorld));
      const ndv = abs(dot(nWorld, viewDir));
      const rimFeather = smoothstep(0.06, 0.64, ndv);
      const distXZ = length(positionWorld.xz.sub(cameraPosition.xz));
      const horizonFade = float(1.0).sub(smoothstep(62.0, 90.0, distXZ));
      return clamp(rimFeather.mul(horizonFade).mul(cumulusParamsNode.z), 0.0, 0.95);
    })();


    this.cloudMesh = new THREE.InstancedMesh(puffGeo, this.cloudMaterial, TOTAL_CLOUD_INSTANCES);
    this.cloudMesh.name = '__hus_volumetric_clouds__';
    this.cloudMesh.renderOrder = 2;
    this.cloudMesh.castShadow = false;
    this.cloudMesh.receiveShadow = false;
    this.cloudMesh.frustumCulled = false;
    this.cloudMesh.raycast = NOOP_RAYCAST;
    this.cloudMesh.userData = { tradeViewIgnore: true, excludeFromPick: true };

    const cloudSeeds: CloudPuffSeed[] = [];
    for (let c = 0; c < CLOUD_CLUSTERS; c++) {
      // Full sky-dome golden-angle distribution inside perspCamera.far (110 m):
      // r = 10..76 m around viewer anchor, arching from ~52 m overhead down to ~18..28 m toward horizon
      const u = (c + 0.45) / CLOUD_CLUSTERS;
      const r = 10.0 + Math.pow(u, 0.58) * 66.0;
      const theta = c * 2.39996323 + (rand() - 0.5) * 0.24;
      const cx = Math.cos(theta) * r;
      const cz = Math.sin(theta) * r;
      // Store per-cluster vertical jitter in baseY (actual dome arch evaluated dynamically after XZ wrap)
      const cy = rand() * 8.5;
      // Shuffled coverageOrder [0..1) so cumulus clusters nucleate naturally across the whole sky from 0%..100%
      const coverageOrder = ((c * 17 + 5) % CLOUD_CLUSTERS) / CLOUD_CLUSTERS;

      const clusterScale = 0.78 + rand() * 0.36;
      for (let p = 0; p < PUFFS_PER_CLUSTER; p++) {
        const isCrown = p === 0;
        const isUpperTurret = p === 1;
        const lobeAngle = ((p - 1) / Math.max(1, PUFFS_PER_CLUSTER - 1)) * Math.PI * 2 + rand() * 0.65;
        const lobeDist = isCrown
          ? 0
          : isUpperTurret
            ? (2.2 + rand() * 2.1) * clusterScale
            : (3.8 + rand() * 3.9) * clusterScale;
        const localOffsetX = Math.cos(lobeAngle) * lobeDist;
        const localOffsetZ = Math.sin(lobeAngle) * lobeDist;
        // Flat condensation level: lower base lobes sit flush around y = 0, upper crown/turret puffs billow upward!
        const localOffsetY = isCrown
          ? (2.1 + rand() * 1.4) * clusterScale
          : isUpperTurret
            ? (1.1 + rand() * 1.1) * clusterScale
            : (-0.15 + rand() * 0.5) * clusterScale;
        const baseScale = (isCrown ? 7.2 + rand() * 2.2 : isUpperTurret ? 5.8 + rand() * 1.8 : 5.2 + rand() * 2.0) * clusterScale;
        cloudSeeds.push({
          clusterIdx: c,
          baseX: cx,
          baseY: cy,
          baseZ: cz,
          localOffsetX,
          localOffsetY,
          localOffsetZ,
          radiusX: baseScale * (1.18 + rand() * 0.36),
          // Flat 0.42x condensation base aspect for lower skirt lobes, taller rounded turrets on crown puffs
          radiusY: baseScale * (isCrown || isUpperTurret ? 0.56 + rand() * 0.18 : 0.42 + rand() * 0.1),
          radiusZ: baseScale * (1.02 + rand() * 0.34),
          rotY: rand() * Math.PI * 2,
          threshold: coverageOrder,
          shadeBias: isCrown ? 1.0 : isUpperTurret ? 0.94 : 0.82 + rand() * 0.12,
        });
      }
    }
    this.cloudSeeds = cloudSeeds;
    this.cloudMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    parkInstancedMeshRange(this.cloudMesh, 0);
    this.cloudMesh.count = 0;
    for (let i = 0; i < TOTAL_CLOUD_INSTANCES; i++) {
      this.cloudMesh.setColorAt(i, new THREE.Color(0xffffff));
    }
    if (this.cloudMesh.instanceColor) {
      this.cloudMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    this.group.add(this.cloudMesh);

    // 2A. Zero-VBO-Upload Tiled Wind-Sheared Rain Streaks (3 speed bands × 2 seamless vertical wrap tiles)
    this.rainGroup = new THREE.Group();
    this.rainGroup.name = '__hus_rain_streaks__';
    this.rainGroup.visible = false;
    this.rainGroup.userData = { tradeViewIgnore: true, excludeFromPick: true };
    this.rainMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
      fog: false,
    });

    const halfSpan = PRECIP_TILE_SPAN_XZ * 0.5;
    const rainBands: TiledRainBand[] = [];
    for (let b = 0; b < RAIN_BANDS; b++) {
      const positions = new Float32Array(DROPS_PER_RAIN_BAND * 6);
      const colors = new Float32Array(DROPS_PER_RAIN_BAND * 6);
      for (let i = 0; i < DROPS_PER_RAIN_BAND; i++) {
        const [rx, rz] = sampleOutdoorXZ(rand, halfSpan, halfSpan, 4.0);
        const yTop = rand() * RAIN_TILE_HEIGHT_Y;
        const streakLen = (0.85 + rand() * 0.95) * (1.0 + b * 0.14);
        const idx = i * 6;
        positions[idx] = rx;
        positions[idx + 1] = yTop;
        positions[idx + 2] = rz;
        positions[idx + 3] = rx;
        positions[idx + 4] = yTop - streakLen;
        positions[idx + 5] = rz;

        colors[idx] = 0.28;
        colors[idx + 1] = 0.31;
        colors[idx + 2] = 0.37;
        colors[idx + 3] = 0.82;
        colors[idx + 4] = 0.89;
        colors[idx + 5] = 0.98;
      }

      const rainGeo = new THREE.BufferGeometry();
      rainGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      rainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      const makeRainTile = (suffix: string): THREE.LineSegments => {
        const seg = new THREE.LineSegments(rainGeo, this.rainMaterial);
        seg.name = `__hus_rain_band_${b}_${suffix}__`;
        seg.frustumCulled = false;
        seg.castShadow = false;
        seg.receiveShadow = false;
        seg.raycast = NOOP_RAYCAST;
        seg.userData = { tradeViewIgnore: true, excludeFromPick: true };
        return seg;
      };
      const meshA = makeRainTile('a');
      const meshB = makeRainTile('b');
      this.rainGroup.add(meshA, meshB);
      rainBands.push({
        meshA,
        meshB,
        geometry: rainGeo,
        fallSpeed: 20.5 + b * 4.2,
        phaseOffset: b * 9.3,
      });
    }
    this.rainBands = rainBands;
    this.group.add(this.rainGroup);

    // 2B. Zero-VBO-Upload Out-of-Phase Ground Splash Crowns (4 phase groups, opacity-modulated only)
    this.splashGroup = new THREE.Group();
    this.splashGroup.name = '__hus_rain_splashes__';
    this.splashGroup.visible = false;
    this.splashGroup.userData = { tradeViewIgnore: true, excludeFromPick: true };
    this.splashTexture = createSplashRingTexture(64);
    this.splashGeometry = new THREE.PlaneGeometry(1.0, 1.0);
    this.splashGeometry.rotateX(-Math.PI / 2);

    const splashPhaseGroups: SplashPhaseGroup[] = [];
    for (let g = 0; g < SPLASH_PHASE_GROUPS; g++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.splashTexture,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      });
      const mesh = new THREE.InstancedMesh(this.splashGeometry, mat, RINGS_PER_SPLASH_GROUP);
      mesh.name = `__hus_rain_splash_phase_${g}__`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      parkInstancedMeshRange(mesh, 0);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.raycast = NOOP_RAYCAST;
      mesh.userData = { tradeViewIgnore: true, excludeFromPick: true };

      const seeds: { readonly relX: number; readonly relZ: number; readonly maxRadius: number }[] = [];
      for (let i = 0; i < RINGS_PER_SPLASH_GROUP; i++) {
        const [sx, sz] = sampleOutdoorXZ(rand, 28.0, 26.0, 4.0);
        seeds.push({
          relX: sx,
          relZ: sz,
          maxRadius: 0.24 + rand() * 0.24,
        });
      }
      this.splashGroup.add(mesh);
      splashPhaseGroups.push({
        mesh,
        material: mat,
        seeds,
        phaseOffset: g / SPLASH_PHASE_GROUPS,
        validCount: 0,
      });
    }
    this.splashPhaseGroups = splashPhaseGroups;
    this.group.add(this.splashGroup);

    // 2C. Zero-VBO-Upload Tiled 6-Fold Swirling Snowflakes (3 swirl bands × 2 seamless vertical wrap tiles)
    this.snowGroup = new THREE.Group();
    this.snowGroup.name = '__hus_snowflakes__';
    this.snowGroup.visible = false;
    this.snowGroup.userData = { tradeViewIgnore: true, excludeFromPick: true };
    this.snowTexture = createSnowflakeTexture(64);
    this.snowGeometry = new THREE.PlaneGeometry(1.0, 1.0);
    this.snowMaterial = new THREE.MeshBasicMaterial({
      map: this.snowTexture,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });

    const snowBands: TiledSnowBand[] = [];
    const snowEuler = new THREE.Euler();
    for (let b = 0; b < SNOW_BANDS; b++) {
      const makeSnowTile = (suffix: string): THREE.InstancedMesh => {
        const m = new THREE.InstancedMesh(this.snowGeometry, this.snowMaterial, FLAKES_PER_SNOW_BAND);
        m.name = `__hus_snow_band_${b}_${suffix}__`;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        parkInstancedMeshRange(m, 0);
        m.count = 0;
        m.frustumCulled = false;
        m.castShadow = false;
        m.receiveShadow = false;
        m.raycast = NOOP_RAYCAST;
        m.userData = { tradeViewIgnore: true, excludeFromPick: true };
        return m;
      };
      const meshA = makeSnowTile('a');
      const meshB = makeSnowTile('b');

      for (let i = 0; i < FLAKES_PER_SNOW_BAND; i++) {
        const [sx, sz] = sampleOutdoorXZ(rand, 38.0, 38.0, 4.0);
        const sy = rand() * SNOW_TILE_HEIGHT_Y;
        const size = 0.075 + rand() * 0.085;
        this.dummyPos.set(sx, sy, sz);
        snowEuler.set((rand() - 0.5) * 0.9, rand() * Math.PI * 2, (rand() - 0.5) * 0.9);
        this.dummyQuat.setFromEuler(snowEuler);
        this.dummyScale.set(size, size, size);
        this.dummyMatrix.compose(this.dummyPos, this.dummyQuat, this.dummyScale);
        meshA.setMatrixAt(i, this.dummyMatrix);
        meshB.setMatrixAt(i, this.dummyMatrix);
      }
      meshA.instanceMatrix.needsUpdate = true;
      meshB.instanceMatrix.needsUpdate = true;

      this.snowGroup.add(meshA, meshB);
      snowBands.push({
        meshA,
        meshB,
        fallSpeed: 1.55 + b * 0.48,
        swirlFreq: 0.85 + b * 0.32,
        swirlAmp: 0.95 + b * 0.45,
        phaseOffset: b * 2.094,
      });
    }
    this.snowBands = snowBands;
    this.group.add(this.snowGroup);

    this.state = {
      liveFeedEnabled: false,
      condition: 'clear',
      rawConditionCode: 'CLEAR',
      description: formatConditionDescription(CONDITION_LABELS.clear, this.location.label),
      temperatureC: 15.8,
      feelsLikeC: 15.2,
      dewPointC: 8.2,
      precipitationMm: 0,
      precipitationChancePct: 0,
      thunderstormChancePct: 0,
      cloudCoverPct: 0,
      windSpeedKph: 11.0,
      windGustKph: 16.0,
      windDirDeg: 235,
      humidityPct: 62,
      visibilityKm: 20.0,
      pressureHpa: 1019.0,
      source: this.formatPresetSource(),
      updatedAtIso: new Date().toISOString(),
      cloudEnabled: false,
      precipType: 'none',
      precipIntensity: 0,
      fogEnabled: false,
      fogIntensity: 0,
      surfaceWetness: 0,
      timezone: this.location.timezone,
      elevationM: this.location.elevationM,
    };

    this.recomputeDerivedState();
    this.syncCloudInstances(true);
    this.group.updateMatrixWorld(true);
  }

  private formatPresetSource(): string {
    const label = this.location.label?.trim();
    return label ? `Preset (${label})` : 'Weather Preset';
  }

  private formatCustomSource(): string {
    const label = this.location.label?.trim();
    return label ? `Custom Layers (${label})` : 'Custom Layers';
  }

  /** Updates the site location used for Open-Meteo queries, wind compass projection, and labels. */
  public setLocation(location: HouseLocation, notify = true): void {
    this.location = { ...location };
    this.state = {
      ...this.state,
      source: this.state.liveFeedEnabled
        ? (this.location.label?.trim()
            ? `Open-Meteo Live (${this.location.label.trim()})`
            : 'Open-Meteo Live')
        : this.formatPresetSource(),
      timezone: location.timezone,
      timezoneAbbreviation: undefined,
      utcOffsetSeconds: undefined,
      elevationM: location.elevationM,
    };
    this.recomputeDerivedState();
    if (notify) {
      this.onWeatherChanged?.();
    }
  }

  public getLocation(): HouseLocation {
    return { ...this.location };
  }

  public setTerrainSampler(sampleGroundY: (wx: number, wz: number) => number): void {
    this.sampleGroundY = sampleGroundY;
  }

  /** Registers interior room AABBs so raindrops, splashes, snowflakes, and surface wetness stay strictly outdoors. */
  public setInteriorRoomBounds(bounds: readonly RoomBoundingBox[]): void {
    this.interiorBounds = bounds;
    this.wetMaterialsIndexed = false;
    this.splashBakedAnchorX = Number.NaN;
    this.bakeSplashGroupPositions(0, 0);
  }

  private graphicsTier: GraphicsTier = 'high';
  private pendingSceneRoot: THREE.Object3D | null = null;

  /** Adjusts cumulus dome puff density for mobile/foldable GPUs (<= 54 puffs on 'low'/'medium', full 122 on 'high'/'ultra'). */
  public setGraphicsTier(tier: GraphicsTier): void {
    if (this.graphicsTier === tier) return;
    this.graphicsTier = tier;
    if (this.state.cloudEnabled && this.state.cloudCoverPct > 0) {
      this.syncCloudInstances(false);
    }
  }
  private materialsCurrentlyWet = false;
  private cachedCoupling: WeatherAtmosphereCoupling | null = null;

  /**
   * Registers the scene root for exterior surface-wetness indexing.
   * Lazy in dry weather (`surfaceWetness <= 0.03`): avoids traversing 32,000 scene nodes on
   * startup until rain/fog wetness is actually enabled!
   */
  public indexExteriorMaterials(sceneRoot: THREE.Object3D): void {
    if (this.materialsCurrentlyWet) {
      this.restoreDryMaterials();
    }
    this.pendingSceneRoot = sceneRoot;
    this.wetMaterials.length = 0;
    this.wetMaterialsIndexed = false;
    if (this.state.surfaceWetness > 0.03) {
      this.ensureExteriorMaterialsIndexed();
      this.applySurfaceWetness();
    }
  }

  private ensureExteriorMaterialsIndexed(): void {
    if (this.wetMaterialsIndexed || !this.pendingSceneRoot) return;
    const sceneRoot = this.pendingSceneRoot;
    this.wetMaterials.length = 0;
    const seen = new Set<THREE.MeshStandardMaterial>();
    const worldCenter = new THREE.Vector3();

    sceneRoot.updateMatrixWorld(true);
    sceneRoot.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const u = obj.userData as Record<string, unknown> | undefined;
      if (u?.['isWeatherOverlay'] || u?.['tradeViewIgnore'] || u?.['isAnnotationGroup']) return;

      const geom = obj.geometry;
      if (geom) {
        if (!geom.boundingBox) geom.computeBoundingBox();
        if (geom.boundingBox && !geom.boundingBox.isEmpty()) {
          geom.boundingBox.getCenter(worldCenter).applyMatrix4(obj.matrixWorld);
          if (this.isPointInsideInteriorRoom(worldCenter.x, worldCenter.y, worldCenter.z)) {
            return;
          }
        }
      }

      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (!(m instanceof THREE.MeshStandardMaterial) || seen.has(m)) continue;
        const emissiveLum = (m.emissive.r + m.emissive.g + m.emissive.b) * m.emissiveIntensity;
        if (m.transparent || m.opacity < 0.98 || emissiveLum > 0.05) continue;
        if ('colorNode' in m && (m as unknown as { colorNode?: unknown }).colorNode != null) continue;
        if (m.roughness < 0.32) continue;
        seen.add(m);
        this.wetMaterials.push({
          mat: m,
          baseRoughness: m.roughness,
          baseMetalness: m.metalness,
        });
      }
    });

    this.wetMaterialsIndexed = true;
  }

  private restoreDryMaterials(): void {
    for (const entry of this.wetMaterials) {
      entry.mat.roughness = entry.baseRoughness;
      entry.mat.metalness = entry.baseMetalness;
    }
    this.materialsCurrentlyWet = false;
  }

  private applySurfaceWetness(): void {
    const w = this.state.surfaceWetness;
    if (w <= 0.03) {
      if (this.materialsCurrentlyWet) {
        this.restoreDryMaterials();
      }
      return;
    }
    this.ensureExteriorMaterialsIndexed();
    if (this.wetMaterials.length === 0) return;
    for (const entry of this.wetMaterials) {
      entry.mat.roughness = THREE.MathUtils.lerp(
        entry.baseRoughness,
        Math.max(0.42, entry.baseRoughness * 0.62),
        w
      );
      entry.mat.metalness = entry.baseMetalness;
    }
    this.materialsCurrentlyWet = true;
  }

  /** Returns the roof ceiling Y over `(x, z)` if `(x, z)` lies within an interior room footprint, or `-Infinity` outdoors. */
  private getInteriorRoofShieldY(x: number, z: number): number {
    let maxY = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < this.interiorBounds.length; i++) {
      const b = this.interiorBounds[i]!;
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) {
        if (b.maxY > maxY) maxY = b.maxY;
      }
    }
    return maxY;
  }

  private isPointInsideInteriorRoom(x: number, y: number, z: number): boolean {
    for (let i = 0; i < this.interiorBounds.length; i++) {
      const b = this.interiorBounds[i]!;
      if (
        x >= b.minX &&
        x <= b.maxX &&
        y >= b.minY - 0.1 &&
        y <= b.maxY + 0.15 &&
        z >= b.minZ &&
        z <= b.maxZ
      ) {
        return true;
      }
    }
    return false;
  }

  /** Registers the host scene so weather meshes attach lazily only when clouds or precipitation are active. */
  public attachScene(scene: THREE.Scene): void {
    this.hostScene = scene;
    this.syncSceneAttachment();
  }

  public isWeatherMeshActive(): boolean {
    const cloudsActive = this.state.cloudEnabled && this.state.cloudCoverPct > 0.5;
    const precipActive = this.state.precipType !== 'none' && this.state.precipIntensity > 0.01;
    return cloudsActive || precipActive;
  }

  private syncSceneAttachment(): void {
    if (!this.hostScene || this.disposed) return;
    const shouldAttach = this.isWeatherMeshActive();
    if (shouldAttach && this.group.parent !== this.hostScene) {
      this.hostScene.add(this.group);
    } else if (!shouldAttach && this.group.parent === this.hostScene) {
      this.hostScene.remove(this.group);
    }
  }

  /** True ONLY when active precipitation particles (`rain` or `snow`) require per-frame animation. */
  public isAnimating(): boolean {
    return this.state.precipType !== 'none' && this.state.precipIntensity > 0.01;
  }

  public getState(): LiveWeatherState {
    return { ...this.state };
  }

  public getAtmosphereCoupling(): WeatherAtmosphereCoupling {
    if (this.cachedCoupling) return this.cachedCoupling;
    return this.computeAtmosphereCoupling();
  }

  private computeAtmosphereCoupling(): WeatherAtmosphereCoupling {
    const effCloudCover = this.state.cloudEnabled
      ? THREE.MathUtils.clamp(this.state.cloudCoverPct / 100.0, 0, 1)
      : 0;
    const isRain = this.state.precipType === 'rain';
    const isSnow = this.state.precipType === 'snow';
    const rScale = isRain ? THREE.MathUtils.clamp(this.state.precipIntensity, 0, 1) : 0;
    const sScale = isSnow ? THREE.MathUtils.clamp(this.state.precipIntensity, 0, 1) : 0;
    const fScale = this.state.fogEnabled ? THREE.MathUtils.clamp(this.state.fogIntensity, 0, 1) : 0;

    const cloudDark = THREE.MathUtils.clamp((effCloudCover - 0.6) * 0.65, 0, 0.32);
    const precipDark = rScale * (0.25 + 0.75 * Math.max(0.4, effCloudCover));
    const rainDarkening = THREE.MathUtils.clamp(
      Math.max(cloudDark, precipDark, fScale * 0.2),
      0,
      1
    );

    const fogStrength = THREE.MathUtils.clamp(
      Math.max(fScale, rScale * 0.42, sScale * 0.36, Math.max(0, effCloudCover - 0.75) * 0.35),
      0,
      1
    );
    const fogClearRadiusM = THREE.MathUtils.lerp(38.0, 32.0, Math.max(fScale, rScale * 0.55, sScale * 0.45));

    return {
      condition: this.state.condition,
      effCloudCover,
      rainDarkening,
      fogStrength,
      fogClearRadiusM,
      surfaceWetness: this.state.surfaceWetness,
      audio: {
        windSpeedKph: this.state.windSpeedKph,
        rainIntensity: rScale,
        snowIntensity: sScale,
      },
    };
  }

  /** Enables or disables the live 5-minute Open-Meteo weather feed for the configured location. */
  public async setLiveFeedEnabled(enabled: boolean): Promise<LiveWeatherState> {
    if (this.disposed) return this.getState();
    this.state = { ...this.state, liveFeedEnabled: enabled };
    this.clearPollTimer();
    if (enabled) {
      await this.refreshLiveWeather();
      if (!this.disposed && this.state.liveFeedEnabled && typeof setInterval === 'function') {
        this.pollTimer = setInterval(() => {
          if (typeof document !== 'undefined' && document.hidden) return;
          if (this.state.liveFeedEnabled) {
            void this.refreshLiveWeather();
          }
        }, LIVE_WEATHER_POLL_MS);
      }
    } else {
      this.onWeatherChanged?.();
    }
    return this.getState();
  }

  /** Fetches live Open-Meteo forecast telemetry for the configured location, falling back cleanly if offline. */
  public async refreshLiveWeather(): Promise<LiveWeatherState> {
    if (!this.fetchImpl || this.disposed) return this.getState();
    const versionAtStart = this.manualOverrideVersion;
    const url = buildOpenMeteoForecastUrl(
      this.location.lat,
      this.location.lon,
      this.location.timezone ?? 'auto'
    );
    try {
      const response = await this.fetchImpl(url, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok || versionAtStart !== this.manualOverrideVersion || this.disposed) {
        return this.getState();
      }
      const json: unknown = await response.json();
      if (versionAtStart !== this.manualOverrideVersion || this.disposed) {
        return this.getState();
      }
      const parsed = parseOpenMeteoForecastResponse(json, this.location.label);
      if (!parsed) return this.getState();

      const clampedLivePrecip =
        !this.snowAllowed && parsed.precipType === 'snow' ? 'none' : parsed.precipType;
      this.state = {
        ...parsed,
        precipType: clampedLivePrecip,
        precipIntensity: clampedLivePrecip === 'none' ? 0 : parsed.precipIntensity,
        timezone: parsed.timezone ?? this.location.timezone,
        elevationM: parsed.elevationM ?? this.location.elevationM,
        liveFeedEnabled: this.state.liveFeedEnabled,
        surfaceWetness: this.state.surfaceWetness,
      };
      this.recomputeDerivedState();
      this.syncCloudInstances();
      this.onWeatherChanged?.();
    } catch {
      // Graceful offline fallback: keep current deterministic weather state without console noise
    }
    return this.getState();
  }

  /**
   * Updates whether snow precipitation is permitted for the current location & season.
   * When `allowed` becomes `false` while snow is active, snow is clamped to `0` (`none`),
   * transitioning cleanly to `overcast` or `clear`.
   */
  public setSnowAllowed(allowed: boolean, suppressCallback = false): boolean {
    this.snowAllowed = allowed;
    if (!allowed && (this.state.precipType === 'snow' || this.state.condition === 'snow')) {
      const nextTemp = this.state.temperatureC < 6 ? 14.5 : this.state.temperatureC;
      this.state = {
        ...this.state,
        precipType: 'none',
        precipIntensity: 0,
        fogEnabled: false,
        fogIntensity: 0,
        temperatureC: nextTemp,
        feelsLikeC: Number((nextTemp - this.state.windSpeedKph * 0.06).toFixed(1)),
      };
      this.recomputeDerivedState();
      this.syncCloudInstances();
      if (!suppressCallback) {
        this.onWeatherChanged?.();
      }
      return true;
    }
    return false;
  }

  public isSnowAllowed(): boolean {
    return this.snowAllowed;
  }

  /** Applies one of the 7 quick architectural weather presets (disabling live weather feed). */
  public applyPreset(preset: WeatherPresetId): LiveWeatherState {
    this.manualOverrideVersion++;
    this.clearPollTimer();
    let cloudEnabled = false;
    let cloudCoverPct = 0;
    let precipType: PrecipitationType = 'none';
    let precipIntensity = 0;
    let fogEnabled = false;
    let fogIntensity = 0;
    let windSpeedKph = 12;
    let tempC = 15.5;

    switch (preset) {
      case 'clear':
        cloudEnabled = false;
        cloudCoverPct = 0;
        windSpeedKph = 10;
        tempC = 18.0;
        break;
      case 'partly_cloudy':
        cloudEnabled = true;
        cloudCoverPct = 42;
        windSpeedKph = 14;
        tempC = 15.5;
        break;
      case 'overcast':
        cloudEnabled = true;
        cloudCoverPct = 92;
        windSpeedKph = 19;
        tempC = 12.5;
        break;
      case 'light_rain':
        cloudEnabled = true;
        cloudCoverPct = 82;
        precipType = 'rain';
        precipIntensity = 0.42;
        windSpeedKph = 21;
        tempC = 11.2;
        break;
      case 'heavy_storm':
        cloudEnabled = true;
        cloudCoverPct = 98;
        precipType = 'rain';
        precipIntensity = 0.94;
        fogEnabled = true;
        fogIntensity = 0.35;
        windSpeedKph = 44;
        tempC = 9.8;
        break;
      case 'morning_mist':
        cloudEnabled = true;
        cloudCoverPct = 48;
        fogEnabled = true;
        fogIntensity = 0.82;
        windSpeedKph = 6;
        tempC = 7.5;
        break;
      case 'winter_snow':
        cloudEnabled = true;
        cloudCoverPct = 88;
        if (this.snowAllowed) {
          precipType = 'snow';
          precipIntensity = 0.76;
          fogEnabled = true;
          fogIntensity = 0.28;
          tempC = -0.8;
        } else {
          precipType = 'none';
          precipIntensity = 0;
          fogEnabled = false;
          fogIntensity = 0;
          tempC = 14.5;
        }
        windSpeedKph = 16;
        break;
    }

    this.state = {
      ...this.state,
      liveFeedEnabled: false,
      cloudEnabled,
      cloudCoverPct,
      precipType,
      precipIntensity,
      fogEnabled,
      fogIntensity,
      windSpeedKph,
      windGustKph: Number((windSpeedKph * 1.45).toFixed(1)),
      temperatureC: tempC,
      feelsLikeC: Number((tempC - windSpeedKph * 0.06).toFixed(1)),
      source: this.formatPresetSource(),
      updatedAtIso: new Date().toISOString(),
    };
    this.recomputeDerivedState();
    this.syncCloudInstances();
    this.onWeatherChanged?.();
    return this.getState();
  }

  public setCloudLayer(enabled: boolean, coverPct: number): LiveWeatherState {
    this.manualOverrideVersion++;
    this.clearPollTimer();
    const clamped = Math.max(0, Math.min(100, Math.round(coverPct)));
    this.state = {
      ...this.state,
      liveFeedEnabled: false,
      cloudEnabled: enabled && clamped > 0,
      cloudCoverPct: enabled ? clamped : 0,
      source: this.formatCustomSource(),
    };
    this.recomputeDerivedState();
    this.syncCloudInstances();
    this.onWeatherChanged?.();
    return this.getState();
  }

  public setPrecipitationLayer(type: PrecipitationType, intensity: number): LiveWeatherState {
    this.manualOverrideVersion++;
    this.clearPollTimer();
    const effectiveType: PrecipitationType = !this.snowAllowed && type === 'snow' ? 'none' : type;
    const clamped = effectiveType === 'none' ? 0 : THREE.MathUtils.clamp(intensity, 0.08, 1.0);
    // Automatically ensure realistic cloud canopy if user turns on rain/snow from a clear sky
    const autoClouds = effectiveType !== 'none' && (!this.state.cloudEnabled || this.state.cloudCoverPct < 45);
    this.state = {
      ...this.state,
      liveFeedEnabled: false,
      precipType: effectiveType,
      precipIntensity: clamped,
      cloudEnabled: autoClouds ? true : this.state.cloudEnabled,
      cloudCoverPct: autoClouds ? Math.max(72, this.state.cloudCoverPct) : this.state.cloudCoverPct,
      source: this.formatCustomSource(),
    };
    this.recomputeDerivedState();
    this.syncCloudInstances();
    this.onWeatherChanged?.();
    return this.getState();
  }

  public setFogLayer(enabled: boolean, intensity: number): LiveWeatherState {
    this.manualOverrideVersion++;
    this.clearPollTimer();
    const clamped = enabled ? THREE.MathUtils.clamp(intensity, 0.08, 1.0) : 0;
    this.state = {
      ...this.state,
      liveFeedEnabled: false,
      fogEnabled: enabled && clamped > 0.01,
      fogIntensity: clamped,
      source: this.formatCustomSource(),
    };
    this.recomputeDerivedState();
    this.syncCloudInstances();
    this.onWeatherChanged?.();
    return this.getState();
  }

  private recomputeDerivedState(): void {
    const effCloud = this.state.cloudEnabled ? this.state.cloudCoverPct : 0;
    const isRain = this.state.precipType === 'rain' && this.state.precipIntensity > 0.01;
    const isSnow = this.state.precipType === 'snow' && this.state.precipIntensity > 0.01;
    const isFog = this.state.fogEnabled && this.state.fogIntensity > 0.01;

    let condition: WeatherCondition = 'clear';
    let rawCode = 'CLEAR';
    if (isSnow) {
      condition = 'snow';
      rawCode = 'SNOW';
    } else if (isRain) {
      if (this.state.precipIntensity >= 0.72) {
        condition = 'heavy_rain';
        rawCode = 'HEAVY_RAIN';
      } else if (this.state.precipIntensity >= 0.38) {
        condition = 'rain';
        rawCode = 'RAIN';
      } else {
        condition = 'drizzle';
        rawCode = 'LIGHT_RAIN';
      }
    } else if (isFog && this.state.fogIntensity >= 0.25) {
      condition = 'fog';
      rawCode = 'FOG';
    } else if (effCloud >= 85) {
      condition = 'overcast';
      rawCode = 'CLOUDY';
    } else if (effCloud >= 18) {
      condition = 'partly_cloudy';
      rawCode = 'PARTLY_CLOUDY';
    }

    const rScale = isRain ? this.state.precipIntensity : 0;
    const sScale = isSnow ? this.state.precipIntensity : 0;
    const fScale = isFog ? this.state.fogIntensity : 0;

    let wetness = 0;
    if (isRain) {
      wetness = THREE.MathUtils.lerp(0.32, 1.0, rScale);
    } else if (isSnow) {
      wetness = 0.24 * sScale;
    }
    if (isFog) {
      wetness = Math.max(wetness, 0.3 * fScale);
    }
    if (effCloud > 78) {
      wetness = Math.max(wetness, ((effCloud - 78) / 22) * 0.08);
    }

    const precipMm = isRain
      ? Number((rScale * 8.5).toFixed(1))
      : isSnow
        ? Number((sScale * 3.5).toFixed(1))
        : 0;
    const visibilityKm = isFog
      ? Number(THREE.MathUtils.lerp(6.5, 0.6, fScale).toFixed(1))
      : isRain
        ? Number(THREE.MathUtils.lerp(11.0, 2.8, rScale).toFixed(1))
        : isSnow
          ? Number(THREE.MathUtils.lerp(8.0, 1.5, sScale).toFixed(1))
          : 16.0;

    // Meteorological windDirDeg is the direction wind blows FROM; advection moves TOWARD +180°
    const downwindCompassRad = (((this.state.windDirDeg + 180.0) % 360.0) * Math.PI) / 180.0;
    compassAzimuthAltitudeToWorldVector(
      downwindCompassRad,
      0,
      resolvePlusXTrueBearingDeg(this.location),
      this.windWorldDir
    );

    this.rainGroup.visible = isRain;
    this.splashGroup.visible = isRain;
    this.snowGroup.visible = isSnow;
    this.cloudMesh.visible = effCloud > 1;
    this.group.visible = isRain || isSnow || effCloud > 1;

    if (isRain) {
      const activeDropsPerBand = Math.max(
        60,
        Math.min(DROPS_PER_RAIN_BAND, Math.round(DROPS_PER_RAIN_BAND * (0.24 + 0.76 * rScale)))
      );
      for (const band of this.rainBands) {
        band.geometry.setDrawRange(0, activeDropsPerBand * 2);
      }
      this.rainMaterial.opacity = THREE.MathUtils.lerp(0.34, 0.68, rScale);

      const anchorX = Number.isNaN(this.splashBakedAnchorX) ? 0 : this.splashBakedAnchorX;
      const anchorZ = Number.isNaN(this.splashBakedAnchorZ) ? 0 : this.splashBakedAnchorZ;
      this.bakeSplashGroupPositions(anchorX, anchorZ);
    } else {
      for (const band of this.rainBands) {
        band.geometry.setDrawRange(0, 0);
      }
      this.splashBakedAnchorX = Number.NaN;
      this.splashBakedAnchorZ = Number.NaN;
      for (const pg of this.splashPhaseGroups) {
        pg.mesh.count = 0;
        pg.material.opacity = 0;
        parkInstancedMeshRange(pg.mesh, 0);
      }
    }

    if (isSnow) {
      const activeFlakesPerBand = Math.max(
        40,
        Math.min(FLAKES_PER_SNOW_BAND, Math.round(FLAKES_PER_SNOW_BAND * (0.28 + 0.72 * sScale)))
      );
      for (const band of this.snowBands) {
        band.meshA.count = activeFlakesPerBand;
        band.meshB.count = activeFlakesPerBand;
      }
      this.snowMaterial.opacity = THREE.MathUtils.lerp(0.58, 0.92, sScale);
    } else {
      for (const band of this.snowBands) {
        band.meshA.count = 0;
        band.meshB.count = 0;
      }
    }

    this.state = {
      ...this.state,
      condition,
      rawConditionCode: rawCode,
      description:
        this.state.liveFeedEnabled && this.state.description
          ? this.state.description
          : formatConditionDescription(CONDITION_LABELS[condition], this.location.label),
      precipitationMm: this.state.liveFeedEnabled ? this.state.precipitationMm : precipMm,
      visibilityKm: this.state.liveFeedEnabled ? this.state.visibilityKm : visibilityKm,
      surfaceWetness: Number(wetness.toFixed(3)),
    };

    this.cachedCoupling = this.computeAtmosphereCoupling();
    this.syncSceneAttachment();
    this.applySurfaceWetness();
  }

  /** Returns the current downwind world-space unit vector for coherent cloud-gobo + cumulus drift. */
  public getWindWorldDirection(): THREE.Vector3 {
    return this.windWorldDir;
  }

  /**
   * Synchronizes the 3D sky cumulus deck drift offset with `EnvironmentLighting`'s world-space
   * cloud-gobo wind offset so sky clouds and ground shadows glide in coherent lockstep.
   */
  /** Keeps the 156 m cumulus sky dome centered on the quantized camera cell (0 updates during steady orbit). */
  public setCloudAnchorXZ(anchorX: number, anchorZ: number): void {
    if (
      Math.abs(anchorX - this.cloudAnchorXZ.x) < 3.5 &&
      Math.abs(anchorZ - this.cloudAnchorXZ.y) < 3.5
    ) {
      return;
    }
    this.cloudAnchorXZ.set(anchorX, anchorZ);
    if (this.cloudMesh.visible) {
      this.syncCloudInstances(false);
      this.group.updateMatrixWorld(true);
    }
  }

  public syncCloudDrift(windOffsetX: number, windOffsetZ: number): void {
    this.cloudDriftOffsetXZ.set(windOffsetX, windOffsetZ);
    if (!this.cloudMesh.visible) return;
    const driftDelta = Math.hypot(
      this.cloudDriftOffsetXZ.x - this.lastSyncedCloudDriftXZ.x,
      this.cloudDriftOffsetXZ.y - this.lastSyncedCloudDriftXZ.y
    );
    if (Number.isNaN(driftDelta) || driftDelta >= CLOUD_DRIFT_SYNC_STEP_M) {
      this.syncCloudInstances(false);
      this.group.updateMatrixWorld(true);
    }
  }

  private lastSyncedCloudEff = -1;
  private lastSyncedCloudTier: GraphicsTier | null = null;
  private readonly lastSyncedCloudAnchorXZ = new THREE.Vector2(Number.NaN, Number.NaN);
  private lastSyncedCloudColorKey = '';

  /** Updates cloud shader uniforms in O(1) from solar/lunar lighting (skipping 264-puff matrix uploads when geometry is unchanged). */
  public syncWithLighting(ctx: WeatherLightingContext): void {
    this.lastLightingCtx.sunDirection.copy(ctx.sunDirection);
    this.lastLightingCtx.sunAltitudeDeg = ctx.sunAltitudeDeg;
    this.lastLightingCtx.goldenFactor = ctx.goldenFactor;
    this.lastLightingCtx.nightFactor = ctx.nightFactor;
    this.syncCloudInstances(false);
  }

  private syncCloudInstances(forceGeometryRebuild = true): void {
    const effCloud = this.state.cloudEnabled
      ? THREE.MathUtils.clamp(this.state.cloudCoverPct / 100.0, 0, 1)
      : 0;
    if (effCloud <= 0.01 || this.graphicsTier === 'low') {
      this.uCumulusParams.set(0, 0, 0, 0);
      this.cloudMaterial.opacity = 0;
      if (this.cloudMesh.visible || this.cloudMesh.count > 0 || this.lastSyncedCloudEff !== 0) {
        this.cloudMesh.visible = false;
        this.cloudMesh.count = 0;
        parkInstancedMeshRange(this.cloudMesh, 0);
        this.lastSyncedCloudEff = 0;
        this.lastSyncedCloudTier = this.graphicsTier;
      }
      this.group.visible = this.rainGroup.visible || this.snowGroup.visible;
      return;
    }
    const { sunDirection, goldenFactor, nightFactor } = this.lastLightingCtx;
    if (sunDirection.lengthSq() > 1e-8) {
      this.uCumulusSunDir.copy(sunDirection).normalize();
    }

    const coupling = this.getAtmosphereCoupling();
    const overcastShade = THREE.MathUtils.smoothstep(effCloud, 0.38, 0.95);
    const heavyDarken = Math.min(1, overcastShade * 0.55 + coupling.rainDarkening * 0.65);

    // Sunward cauliflower tops: warm sunlit ivory -> soft overcast pearl -> golden hour -> moonlight
    this.uCumulusTopColor
      .setHex(0xfffdf7)
      .lerp(this.colorScratch.setHex(0xdbe3ee), overcastShade * 0.42 + coupling.rainDarkening * 0.38)
      .lerp(this.colorScratch.setHex(0xffbe82), goldenFactor * 0.78)
      .lerp(this.colorScratch.setHex(0x2d3d57), nightFactor);

    // Flat 0.42x condensation undersides: cool sky-blue shadow -> deeper British slate as cloud cover rises
    this.uCumulusBaseColor
      .setHex(0x9cb0c9)
      .lerp(this.colorScratch.setHex(0x5b697c), heavyDarken)
      .lerp(this.colorScratch.setHex(0x7a5c5e), goldenFactor * 0.6)
      .lerp(this.colorScratch.setHex(0x131b2b), nightFactor);

    const silverStrength = (1 - overcastShade * 0.72) * (1 - nightFactor * 0.75) * 0.36;
    const opacityScale = THREE.MathUtils.lerp(0.76, 0.95, Math.min(1, effCloud * 1.25));
    this.uCumulusParams.set(effCloud, silverStrength, opacityScale, heavyDarken);
    this.cloudMaterial.opacity = opacityScale;

    const geomUnchanged =
      !forceGeometryRebuild &&
      this.cloudMesh.visible &&
      Math.abs(effCloud - this.lastSyncedCloudEff) <= 1e-4 &&
      this.graphicsTier === this.lastSyncedCloudTier &&
      Math.abs(this.cloudAnchorXZ.x - this.lastSyncedCloudAnchorXZ.x) <= 1e-3 &&
      Math.abs(this.cloudAnchorXZ.y - this.lastSyncedCloudAnchorXZ.y) <= 1e-3 &&
      Math.abs(this.cloudDriftOffsetXZ.x - this.lastSyncedCloudDriftXZ.x) <= 1e-3 &&
      Math.abs(this.cloudDriftOffsetXZ.y - this.lastSyncedCloudDriftXZ.y) <= 1e-3;
    if (geomUnchanged) {
      return;
    }

    this.lastSyncedCloudEff = effCloud;
    this.lastSyncedCloudTier = this.graphicsTier;
    this.lastSyncedCloudAnchorXZ.copy(this.cloudAnchorXZ);
    this.lastSyncedCloudDriftXZ.copy(this.cloudDriftOffsetXZ);
    const nextColorKey = `${this.graphicsTier}:${effCloud.toFixed(4)}`;
    const needColorUpload = forceGeometryRebuild || nextColorKey !== this.lastSyncedCloudColorKey;
    this.lastSyncedCloudColorKey = nextColorKey;

    const wrapSpan = 156.0;
    const halfSpan = wrapSpan * 0.5;
    const horizBoost = THREE.MathUtils.lerp(0.76, 1.28, effCloud);
    const vertBoost = THREE.MathUtils.lerp(0.72, 1.16, effCloud);
    const anchorX = this.cloudAnchorXZ.x;
    const anchorZ = this.cloudAnchorXZ.y;

    const isMobileBudgetTier = this.graphicsTier === 'medium';
    const maxActivePuffs = isMobileBudgetTier ? 54 : TOTAL_CLOUD_INSTANCES;
    const indexStep = isMobileBudgetTier ? TOTAL_CLOUD_INSTANCES / maxActivePuffs : 1;
    let activeCount = 0;
    for (let slot = 0; slot < maxActivePuffs; slot++) {
      const i = isMobileBudgetTier ? Math.min(TOTAL_CLOUD_INSTANCES - 1, Math.floor(slot * indexStep)) : slot;
      const seed = this.cloudSeeds[i]!;
      const activationStart = seed.threshold * 0.84;
      const rawEmergence = THREE.MathUtils.clamp((effCloud - activationStart) / 0.22, 0, 1);
      const emergence = rawEmergence * rawEmergence * (3 - 2 * rawEmergence);
      if (emergence <= 0.015) {
        continue;
      }

      const relX =
        ((((seed.baseX + this.cloudDriftOffsetXZ.x - anchorX + halfSpan) % wrapSpan) + wrapSpan) %
          wrapSpan) -
        halfSpan;
      const relZ =
        ((((seed.baseZ + this.cloudDriftOffsetXZ.y - anchorZ + halfSpan) % wrapSpan) + wrapSpan) %
          wrapSpan) -
        halfSpan;
      const radialDist = Math.hypot(relX, relZ);
      const domeArc = Math.max(0, 1.0 - (radialDist / 84.0) * (radialDist / 84.0));
      const wx = anchorX + relX + seed.localOffsetX * horizBoost;
      const wz = anchorZ + relZ + seed.localOffsetZ * horizBoost;
      const wy = Math.max(16.5, 17.5 + domeArc * 29.0 + seed.baseY + seed.localOffsetY * vertBoost);

      this.dummyPos.set(wx, wy, wz);
      this.dummyQuat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, seed.rotY);
      const sxz = (0.35 + 0.65 * emergence) * horizBoost;
      const sy = (0.35 + 0.65 * emergence) * vertBoost;
      this.dummyScale.set(seed.radiusX * sxz, seed.radiusY * sy, seed.radiusZ * sxz);
      this.dummyMatrix.compose(this.dummyPos, this.dummyQuat, this.dummyScale);
      this.cloudMesh.setMatrixAt(activeCount, this.dummyMatrix);

      // Subtle per-puff self-shadowing modulation (crown puffs brighter, lower skirt lobes slightly deeper)
      const selfOcc = THREE.MathUtils.lerp(0.84, 1.0, seed.shadeBias);
      this.colorScratch.setRGB(selfOcc, selfOcc * 0.995, Math.min(1, selfOcc * 1.01));
      this.cloudMesh.setColorAt(activeCount, this.colorScratch);
      activeCount++;
    }

    // Park every inactive slot `activeCount .. TOTAL_CLOUD_INSTANCES - 1` at (0, -10000, 0) zero-scale!
    parkInstancedMeshRange(this.cloudMesh, activeCount);
    this.cloudMesh.count = activeCount;
    this.cloudMesh.visible = activeCount > 0;
    this.group.visible = activeCount > 0 || this.rainGroup.visible || this.snowGroup.visible;
    this.cloudMesh.instanceMatrix.needsUpdate = true;
    if (needColorUpload && this.cloudMesh.instanceColor) {
      this.cloudMesh.instanceColor.needsUpdate = true;
    }
  }

  /**
   * Steps active precipitation & storm cloud advection with ZERO per-frame BufferAttribute uploads.
   * Returns `true` ONLY when active precipitation (`rain` or `snow`) requires a new rendered frame;
   * returns `false` when `precipType === 'none'` so idle GPU wakeups remain strictly `0%` (`0 / 300`).
   */
  public update(
    dtSeconds: number,
    cameraPosition: THREE.Vector3,
    cameraTarget: THREE.Vector3,
    cameraQuaternion?: THREE.Quaternion
  ): boolean {
    if (!this.isAnimating()) {
      this.stationarySec = 0;
      this.stationaryRainAccumSec = 0;
      return false;
    }

    const dt = Math.max(0, Math.min(0.1, dtSeconds));
    this.elapsedSec += dt;

    const camMoved =
      Number.isNaN(this.lastCamPos.x) ||
      this.lastCamPos.distanceToSquared(cameraPosition) > 1e-6 ||
      this.lastCamTarget.distanceToSquared(cameraTarget) > 1e-6 ||
      (cameraQuaternion !== undefined &&
        (Number.isNaN(this.lastCamQuat.x) ||
          1 - Math.abs(this.lastCamQuat.dot(cameraQuaternion)) > 1e-6));
    if (camMoved) {
      this.lastCamPos.copy(cameraPosition);
      this.lastCamTarget.copy(cameraTarget);
      if (cameraQuaternion) this.lastCamQuat.copy(cameraQuaternion);
      this.stationarySec = 0;
      this.stationaryRainAccumSec = 0;
    } else {
      this.stationarySec += dt;
    }

    // Cap stationary Rain rendering to 30 Hz when the camera has not moved for > 1.5 s.
    if (this.state.precipType === 'rain' && this.stationarySec > 1.5) {
      this.stationaryRainAccumSec += dt;
      if (this.stationaryRainAccumSec < 1 / 30) {
        return false;
      }
      this.stationaryRainAccumSec %= 1 / 30;
    }

    // Gentle downwind cloud drift, throttled so instanceMatrix only uploads when offset moves >= 0.35 m
    const cloudSpeedMps = Math.max(0.6, this.state.windSpeedKph * 0.14);
    this.cloudDriftOffsetXZ.x += this.windWorldDir.x * cloudSpeedMps * dt;
    this.cloudDriftOffsetXZ.y += this.windWorldDir.z * cloudSpeedMps * dt;
    if (this.cloudMesh.visible) {
      const driftDelta = Math.hypot(
        this.cloudDriftOffsetXZ.x - this.lastSyncedCloudDriftXZ.x,
        this.cloudDriftOffsetXZ.y - this.lastSyncedCloudDriftXZ.y
      );
      if (Number.isNaN(driftDelta) || driftDelta >= CLOUD_DRIFT_SYNC_STEP_M) {
        this.syncCloudInstances(false);
      }
    }

    const anchorX = THREE.MathUtils.lerp(cameraTarget.x, cameraPosition.x, 0.45);
    const anchorZ = THREE.MathUtils.lerp(cameraTarget.z, cameraPosition.z, 0.45);
    // Quantize XZ tile cell so rain/snow stay world-anchored (0 swimming on camera orbit & dry farmhouse interior at cell 0,0)
    const cellX = Math.round(anchorX / PRECIP_TILE_SPAN_XZ) * PRECIP_TILE_SPAN_XZ;
    const cellZ = Math.round(anchorZ / PRECIP_TILE_SPAN_XZ) * PRECIP_TILE_SPAN_XZ;
    const baseGroundY = this.sampleGroundY(cellX, cellZ) - 1.2;

    const windSpeedMps = (this.state.windSpeedKph / 3.6) * 0.55;
    const windVx = this.windWorldDir.x * windSpeedMps;
    const windVz = this.windWorldDir.z * windSpeedMps;

    if (this.state.precipType === 'rain') {
      this.stepRainLayers(cellX, baseGroundY, cellZ, windVx, windVz);
      this.stepSplashPhaseGroups(anchorX, anchorZ);
    } else if (this.state.precipType === 'snow') {
      this.stepSnowLayers(cellX, baseGroundY, cellZ, windVx, windVz);
    }

    // `StaticSceneService.freezeStaticMatrices()` sets `scene.matrixWorldAutoUpdate = false`,
    // so explicitly propagate weather tile world transforms each animated frame.
    this.group.updateMatrixWorld(true);
    return true;
  }

  private stepRainLayers(
    cellX: number,
    baseGroundY: number,
    cellZ: number,
    windVx: number,
    windVz: number
  ): void {
    const rScale = THREE.MathUtils.clamp(this.state.precipIntensity, 0.08, 1.0);
    const speedScale = THREE.MathUtils.lerp(0.82, 1.25, rScale);
    const t = this.elapsedSec;

    // Subtle wind-shear tilt of the pre-baked LineSegments layers (0 vertex uploads!)
    const avgFall = 24.0 * speedScale;
    const tiltZ = THREE.MathUtils.clamp(-windVx / avgFall, -0.26, 0.26);
    const tiltX = THREE.MathUtils.clamp(windVz / avgFall, -0.26, 0.26);
    this.rainGroup.rotation.set(tiltX, 0, tiltZ);

    for (let b = 0; b < this.rainBands.length; b++) {
      const band = this.rainBands[b]!;
      const fall = band.fallSpeed * speedScale;
      const dy = ((t * fall + band.phaseOffset) % RAIN_TILE_HEIGHT_Y + RAIN_TILE_HEIGHT_Y) % RAIN_TILE_HEIGHT_Y;
      const gustX = Math.sin(t * 1.4 + band.phaseOffset) * 0.35;
      const gustZ = Math.cos(t * 1.2 + band.phaseOffset) * 0.35;
      const yA = baseGroundY - dy;
      band.meshA.position.set(cellX + gustX, yA, cellZ + gustZ);
      band.meshB.position.set(cellX + gustX, yA + RAIN_TILE_HEIGHT_Y, cellZ + gustZ);
    }
  }

  private bakeSplashGroupPositions(anchorX: number, anchorZ: number): void {
    const cellX = Math.round(anchorX / 24.0) * 24.0;
    const cellZ = Math.round(anchorZ / 24.0) * 24.0;
    this.splashBakedAnchorX = cellX;
    this.splashBakedAnchorZ = cellZ;
    this.dummyQuat.identity();
    const isRain = this.state?.precipType === 'rain' && this.state.precipIntensity > 0.01;
    const targetSplashes = isRain
      ? Math.max(
          8,
          Math.min(
            RINGS_PER_SPLASH_GROUP,
            Math.round(RINGS_PER_SPLASH_GROUP * (0.28 + 0.72 * this.state.precipIntensity))
          )
        )
      : 0;

    for (const pg of this.splashPhaseGroups) {
      let validCount = 0;
      for (let i = 0; i < pg.seeds.length; i++) {
        const s = pg.seeds[i]!;
        const wx = cellX + s.relX;
        const wz = cellZ + s.relZ;
        if (this.getInteriorRoofShieldY(wx, wz) > -10 || isDefaultIndoorFootprint(wx, wz)) {
          continue;
        }
        const groundY = this.sampleGroundY(wx, wz);
        this.dummyPos.set(wx, groundY + 0.028, wz);
        this.dummyScale.set(s.maxRadius, 1, s.maxRadius);
        this.dummyMatrix.compose(this.dummyPos, this.dummyQuat, this.dummyScale);
        pg.mesh.setMatrixAt(validCount, this.dummyMatrix);
        validCount++;
      }
      pg.validCount = validCount;
      const activeCount = isRain ? Math.min(validCount, targetSplashes) : 0;
      pg.mesh.count = activeCount;
      parkInstancedMeshRange(pg.mesh, activeCount);
      pg.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private stepSplashPhaseGroups(anchorX: number, anchorZ: number): void {
    const cellX = Math.round(anchorX / 24.0) * 24.0;
    const cellZ = Math.round(anchorZ / 24.0) * 24.0;
    if (cellX !== this.splashBakedAnchorX || cellZ !== this.splashBakedAnchorZ) {
      this.bakeSplashGroupPositions(anchorX, anchorZ);
    }

    const rScale = THREE.MathUtils.clamp(this.state.precipIntensity, 0.08, 1.0);
    const maxOpacity = THREE.MathUtils.lerp(0.26, 0.58, rScale);
    const t = this.elapsedSec * 2.2;
    for (let g = 0; g < this.splashPhaseGroups.length; g++) {
      const pg = this.splashPhaseGroups[g]!;
      const phase = ((t + pg.phaseOffset) % 1.0 + 1.0) % 1.0;
      pg.material.opacity = maxOpacity * Math.sin(phase * Math.PI);
    }
  }

  private stepSnowLayers(
    cellX: number,
    baseGroundY: number,
    cellZ: number,
    windVx: number,
    windVz: number
  ): void {
    const t = this.elapsedSec;
    for (let b = 0; b < this.snowBands.length; b++) {
      const band = this.snowBands[b]!;
      const dy = ((t * band.fallSpeed + band.phaseOffset) % SNOW_TILE_HEIGHT_Y + SNOW_TILE_HEIGHT_Y) % SNOW_TILE_HEIGHT_Y;
      const swirlX = Math.sin(t * band.swirlFreq + band.phaseOffset) * band.swirlAmp + Math.sin(t * 0.35) * windVx * 0.35;
      const swirlZ = Math.cos(t * band.swirlFreq * 0.86 + band.phaseOffset) * band.swirlAmp + Math.cos(t * 0.35) * windVz * 0.35;
      const yA = baseGroundY - dy;
      band.meshA.position.set(cellX + swirlX, yA, cellZ + swirlZ);
      band.meshB.position.set(cellX + swirlX, yA + SNOW_TILE_HEIGHT_Y, cellZ + swirlZ);
    }
  }

  private clearPollTimer(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  public dispose(): void {
    if (this.hostScene && this.group.parent === this.hostScene) {
      this.hostScene.remove(this.group);
    }
    this.hostScene = null;
    this.disposed = true;
    this.clearPollTimer();
    this.restoreDryMaterials();
    this.cloudMesh.geometry.dispose();
    this.cloudMaterial.dispose();
    for (const band of this.rainBands) {
      band.geometry.dispose();
    }
    this.rainMaterial.dispose();
    this.splashGeometry.dispose();
    for (const pg of this.splashPhaseGroups) {
      pg.material.dispose();
    }
    this.splashTexture.dispose();
    this.snowGeometry.dispose();
    this.snowMaterial.dispose();
    this.snowTexture.dispose();
  }
}
