import * as THREE from 'three';
import {
  DEFAULT_HUS_PLUS_X_BEARING_DEG,
  DEFAULT_HUS_LATITUDE_DEG,
  DEFAULT_HUS_LONGITUDE_DEG,
  type LunarEphemerisSummary,
  type SolarDateTimeInput,
  type SolarEphemerisSummary,
} from '../../../core/types/solar-weather.ts';
import { formatUtcOffsetLabel } from '../../../core/solar-weather-format.ts';
import type { Vec3Tuple } from '../../../core/types/scene.ts';

export {
  DEFAULT_HUS_PLUS_X_BEARING_DEG,
  DEFAULT_HUS_LATITUDE_DEG,
  DEFAULT_HUS_LONGITUDE_DEG,
  type LunarEphemerisSummary,
  type SolarDateTimeInput,
  type SolarEphemerisSummary,
};

const DEG_TO_RAD = Math.PI / 180.0;
const RAD_TO_DEG = 180.0 / Math.PI;

/** Minimum directional-light shadow elevation (`0.11 rad ≈ 6.30°`) so golden-hour shadows never clip or shimmer. */
export const MIN_SOLAR_SHADOW_ALTITUDE_RAD = 0.11;

/** Minimum lunar shadow elevation (`0.14 rad ≈ 8.02°`) when moonlight drives nocturnal shadows. */
export const MIN_LUNAR_SHADOW_ALTITUDE_RAD = 0.14;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export interface SolarAstronomyOptions {
  readonly latitudeDeg?: number;
  readonly longitudeDeg?: number;
  readonly plusXTrueBearingDeg?: number;
  readonly year?: number;
  readonly timezone?: string;
  readonly utcOffsetSeconds?: number;
  readonly timezoneAbbreviation?: string;
}

/** Full astronomical solar position and 3D scene vectors for a georeferenced Hus scene. */
export interface SolarPosition extends SolarEphemerisSummary {
  readonly declinationRad: number;
  readonly altitudeRad: number;
  readonly azimuthFromNorthRad: number;
  /** Azimuth relative to Twin `+X` axis (`azimuthFromNorthRad - plusXTrueBearingRad`). */
  readonly plusXRelativeAzimuthRad: number;
  /** Unclamped 3D unit vector toward the Sun in Three.js world space (`y < 0` after sunset). */
  readonly trueSunVector: THREE.Vector3;
  /** Elevation-clamped (`>= 6.3°`) 3D unit vector for the shadow-casting `DirectionalLight`. */
  readonly shadowLightVector: THREE.Vector3;
  /** Full 3D cosine of solar incidence on the Main Street `-X` vertical frontage (`160.17°` SSE). */
  readonly mainStreetIncidenceCos: number;
  /** Full 3D cosine of solar incidence on the Paddock `+X` vertical rear facade (`340.17°` NNW). */
  readonly paddockIncidenceCos: number;
  /** Full 3D cosine of solar incidence on the Courtyard `+Z` vertical facade (`70.17°` ENE). */
  readonly courtyardIncidenceCos: number;
}

/** Full topocentric lunar position, phase, and 3D scene vectors for a georeferenced Hus scene. */
export interface LunarPosition extends LunarEphemerisSummary {
  readonly altitudeRad: number;
  readonly azimuthFromNorthRad: number;
  readonly trueMoonVector: THREE.Vector3;
  readonly shadowMoonVector: THREE.Vector3;
}

/**
 * Returns the UK civil timezone offset (`+1` for British Summer Time, `0` for GMT)
 * for a given `dayOfYear` and `referenceYear` using the statutory UK rule
 * (last Sunday of March to last Sunday of October).
 */
export function getLondonUtcOffsetHours(dayOfYear: number, referenceYear = 2026): number {
  const maxDay = isLeapYear(referenceYear) ? 366 : 365;
  const clampedDay = Math.max(1, Math.min(maxDay, Math.round(dayOfYear)));
  const jan1Ms = Date.UTC(referenceYear, 0, 1);

  const march31 = new Date(Date.UTC(referenceYear, 2, 31));
  const lastSundayMarchMs = Date.UTC(referenceYear, 2, 31 - march31.getUTCDay());
  const bstStartDayOfYear = Math.round((lastSundayMarchMs - jan1Ms) / 86_400_000) + 1;

  const oct31 = new Date(Date.UTC(referenceYear, 9, 31));
  const lastSundayOctMs = Date.UTC(referenceYear, 9, 31 - oct31.getUTCDay());
  const bstEndDayOfYear = Math.round((lastSundayOctMs - jan1Ms) / 86_400_000) + 1;

  return clampedDay >= bstStartDayOfYear && clampedDay < bstEndDayOfYear ? 1.0 : 0.0;
}

function parseShortOffsetHours(raw: string | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const match = /^(?:GMT|UTC)(?:([+\-\u2212])(\d{1,2})(?::(\d{2}))?)?$/i.exec(trimmed);
  if (!match) return null;
  if (!match[1] || !match[2]) return 0;
  const sign = match[1] === '+' ? 1 : -1;
  const hh = Number(match[2]);
  const mm = match[3] ? Number(match[3]) : 0;
  return sign * (hh + mm / 60.0);
}

/**
 * Resolves the civil UTC offset (hours) and short timezone abbreviation for any global site:
 * 1. Explicit `utcOffsetSeconds` (e.g. from Open-Meteo `&timezone=auto`)
 * 2. Valid IANA `timezone` evaluated via `Intl.DateTimeFormat` (DST-aware)
 * 3. Longitude solar-time fallback `Math.round(longitudeDeg / 15)` (`UTC+H`)
 */
export function resolveUtcOffsetAndAbbrev(params: {
  readonly year: number;
  readonly dayOfYear: number;
  readonly civilHour?: number;
  readonly timezone?: string;
  readonly utcOffsetSeconds?: number;
  readonly timezoneAbbreviation?: string;
  readonly longitudeDeg?: number;
}): { readonly utcOffsetHours: number; readonly timezoneAbbreviation: string } {
  if (typeof params.utcOffsetSeconds === 'number' && Number.isFinite(params.utcOffsetSeconds)) {
    const utcOffsetHours = params.utcOffsetSeconds / 3600.0;
    const abbrev = params.timezoneAbbreviation?.trim() || formatUtcOffsetLabel(utcOffsetHours);
    return { utcOffsetHours, timezoneAbbreviation: abbrev };
  }

  const tz = params.timezone?.trim();
  if (tz) {
    try {
      const maxDay = isLeapYear(params.year) ? 366 : 365;
      const clampedDay = Math.max(1, Math.min(maxDay, Math.round(params.dayOfYear)));
      const jan1UtcMs = Date.UTC(params.year, 0, 1, 0, 0, 0);
      const probeNoon = new Date(jan1UtcMs + ((clampedDay - 1) * 24 + 12) * 3_600_000);
      const offsetFmt = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        timeZoneName: 'shortOffset',
      });
      const readOffset = (d: Date): number | null => {
        const part = offsetFmt.formatToParts(d).find((p) => p.type === 'timeZoneName')?.value;
        return parseShortOffsetHours(part);
      };
      let offsetHours = readOffset(probeNoon);
      if (offsetHours !== null) {
        let targetDate = probeNoon;
        if (typeof params.civilHour === 'number' && Number.isFinite(params.civilHour)) {
          const normHour = ((params.civilHour % 24.0) + 24.0) % 24.0;
          targetDate = new Date(
            jan1UtcMs + ((clampedDay - 1) * 24 + normHour - offsetHours) * 3_600_000
          );
          const refined = readOffset(targetDate);
          if (refined !== null) {
            offsetHours = refined;
          }
        }
        const shortLocale = tz === 'Europe/London' ? 'en-GB' : 'en-US';
        const shortPart = new Intl.DateTimeFormat(shortLocale, {
          timeZone: tz,
          timeZoneName: 'short',
        })
          .formatToParts(targetDate)
          .find((p) => p.type === 'timeZoneName')?.value;
        const timezoneAbbreviation =
          params.timezoneAbbreviation?.trim() ||
          (shortPart && shortPart.trim().length > 0
            ? shortPart.trim()
            : formatUtcOffsetLabel(offsetHours));
        return { utcOffsetHours: offsetHours, timezoneAbbreviation };
      }
    } catch {
      if (tz === 'Europe/London') {
        const utcOffsetHours = getLondonUtcOffsetHours(params.dayOfYear, params.year);
        return {
          utcOffsetHours,
          timezoneAbbreviation: utcOffsetHours === 1 ? 'BST' : 'GMT',
        };
      }
    }
  }

  const offset = Math.round((params.longitudeDeg ?? 0) / 15.0);
  const timezoneAbbreviation =
    params.timezoneAbbreviation?.trim() || `UTC${offset >= 0 ? '+' : ''}${offset}`;
  return { utcOffsetHours: offset, timezoneAbbreviation };
}

/**
 * Extracts the real-time calendar `year`, `dayOfYear`, and fractional `civilHour`
 * in any IANA `timezone` (with `utcOffsetSeconds` or longitude solar-time fallback).
 */
export function getCurrentSolarClockForLocation(options: {
  readonly now?: Date;
  readonly timezone?: string;
  readonly utcOffsetSeconds?: number;
  readonly longitudeDeg?: number;
} = {}): Required<SolarDateTimeInput> {
  const now = options.now ?? new Date();
  const tz = options.timezone?.trim();
  if (tz) {
    try {
      const dtf = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      });
      const parts = dtf.formatToParts(now);
      const num = (type: Intl.DateTimeFormatPartTypes, fallback: number): number => {
        const val = Number(parts.find((p) => p.type === type)?.value);
        return Number.isFinite(val) ? val : fallback;
      };
      const year = num('year', now.getUTCFullYear());
      const month = num('month', now.getUTCMonth() + 1);
      const day = num('day', now.getUTCDate());
      const hour = num('hour', now.getUTCHours()) % 24;
      const minute = num('minute', now.getUTCMinutes());
      const second = num('second', now.getUTCSeconds());

      const jan1Ms = Date.UTC(year, 0, 1);
      const curMs = Date.UTC(year, month - 1, day);
      const dayOfYear = Math.max(1, Math.round((curMs - jan1Ms) / 86_400_000) + 1);
      const civilHour = hour + minute / 60.0 + second / 3600.0;
      return { civilHour, dayOfYear, year };
    } catch {
      // Fall through to offset-based extraction
    }
  }

  let offsetMs = 0;
  if (typeof options.utcOffsetSeconds === 'number' && Number.isFinite(options.utcOffsetSeconds)) {
    offsetMs = options.utcOffsetSeconds * 1000;
  } else if (tz === 'Europe/London') {
    const year = now.getUTCFullYear();
    const jan1Ms = Date.UTC(year, 0, 1);
    const dayOfYear = Math.max(1, Math.floor((now.getTime() - jan1Ms) / 86_400_000) + 1);
    offsetMs = getLondonUtcOffsetHours(dayOfYear, year) * 3_600_000;
  } else if (typeof options.longitudeDeg === 'number' && Number.isFinite(options.longitudeDeg)) {
    offsetMs = Math.round(options.longitudeDeg / 15.0) * 3_600_000;
  }

  const local = new Date(now.getTime() + offsetMs);
  const year = local.getUTCFullYear();
  const jan1Ms = Date.UTC(year, 0, 1);
  const curMs = Date.UTC(year, local.getUTCMonth(), local.getUTCDate());
  const dayOfYear = Math.max(1, Math.round((curMs - jan1Ms) / 86_400_000) + 1);
  const civilHour =
    local.getUTCHours() + local.getUTCMinutes() / 60.0 + local.getUTCSeconds() / 3600.0;
  return { civilHour, dayOfYear, year };
}

/**
 * Extracts the real-time UK (`Europe/London` GMT/BST) calendar year, `dayOfYear`, and fractional
 * `civilHour` from a JavaScript `Date` (defaults to `new Date()`).
 */
export function getCurrentLondonSolarClock(now: Date = new Date()): Required<SolarDateTimeInput> {
  return getCurrentSolarClockForLocation({ now, timezone: 'Europe/London' });
}

/**
 * Projects any compass azimuth `azimuthFromNorthRad` (clockwise from True North) and elevation
 * `altitudeRad` into right-handed Three.js world space `(wx, wy, wz)` (`+Y` Up).
 */
export function compassAzimuthAltitudeToWorldVector(
  azimuthFromNorthRad: number,
  altitudeRad: number,
  plusXTrueBearingDeg = DEFAULT_HUS_PLUS_X_BEARING_DEG,
  target = new THREE.Vector3()
): THREE.Vector3 {
  const relPlusXRad = azimuthFromNorthRad - plusXTrueBearingDeg * DEG_TO_RAD;
  const cosAlt = Math.cos(altitudeRad);
  const sinAlt = Math.sin(altitudeRad);
  return target
    .set(Math.cos(relPlusXRad) * cosAlt, sinAlt, Math.sin(relPlusXRad) * cosAlt)
    .normalize();
}

/**
 * Inverse mapping: converts a Three.js world direction `(wx, wy, wz)` into True-North compass
 * azimuth `[0, 360)` and altitude `[-90, +90]` degrees.
 */
export function worldVectorToCompassAzimuthAltitude(
  dir: THREE.Vector3 | Vec3Tuple,
  plusXTrueBearingDeg = DEFAULT_HUS_PLUS_X_BEARING_DEG
): { readonly azimuthFromNorthDeg: number; readonly altitudeDeg: number } {
  const x = dir instanceof THREE.Vector3 ? dir.x : dir[0];
  const y = dir instanceof THREE.Vector3 ? dir.y : dir[1];
  const z = dir instanceof THREE.Vector3 ? dir.z : dir[2];
  const len = Math.hypot(x, y, z) || 1.0;
  const altitudeDeg = Math.asin(THREE.MathUtils.clamp(y / len, -1.0, 1.0)) * RAD_TO_DEG;
  const relDeg = Math.atan2(z, x) * RAD_TO_DEG;
  const azimuthFromNorthDeg = (((plusXTrueBearingDeg + relDeg) % 360.0) + 360.0) % 360.0;
  return { azimuthFromNorthDeg, altitudeDeg };
}

/**
 * Computes Spencer (1971) / NOAA solar declination (radians) and Equation of Time (minutes)
 * from the fractional year angle `gammaRad`.
 */
function evaluateSpencerFourier(gammaRad: number): {
  readonly declinationRad: number;
  readonly equationOfTimeMin: number;
} {
  const cosG = Math.cos(gammaRad);
  const sinG = Math.sin(gammaRad);
  const cos2G = Math.cos(2.0 * gammaRad);
  const sin2G = Math.sin(2.0 * gammaRad);
  const cos3G = Math.cos(3.0 * gammaRad);
  const sin3G = Math.sin(3.0 * gammaRad);

  const equationOfTimeMin =
    229.18 *
    (0.000075 +
      0.001868 * cosG -
      0.032077 * sinG -
      0.014615 * cos2G -
      0.040849 * sin2G);

  const declinationRad =
    0.006918 -
    0.399912 * cosG +
    0.070257 * sinG -
    0.006758 * cos2G +
    0.000907 * sin2G -
    0.002697 * cos3G +
    0.00148 * sin3G;

  return { declinationRad, equationOfTimeMin };
}

/** Bennett (1982) / NOAA atmospheric refraction correction near the horizon (degrees). */
function evaluateBennettRefractionDeg(trueAltitudeDeg: number): number {
  if (trueAltitudeDeg <= -0.833 || trueAltitudeDeg >= 85.0) {
    return 0.0;
  }
  const tanArgRad = (trueAltitudeDeg + 10.3 / (trueAltitudeDeg + 5.11)) * DEG_TO_RAD;
  return THREE.MathUtils.clamp(1.02 / (60.0 * Math.tan(tanArgRad)), 0.0, 0.58);
}

/**
 * Computes the complete Spencer (1971) / NOAA astronomical sun position, civil sunrise/sunset,
 * day length, Bennett atmospheric refraction, and Three.js world-space sun & shadow vectors
 * for the configured site coordinates.
 */
export function computeSolarPosition(
  civilHour: number,
  dayOfYear: number,
  options: SolarAstronomyOptions = {}
): SolarPosition {
  const year = options.year ?? 2026;
  const daysInYear = isLeapYear(year) ? 366 : 365;
  const normCivilHour = ((civilHour % 24.0) + 24.0) % 24.0;
  const clampedDay = Math.max(1, Math.min(daysInYear, Math.round(dayOfYear)));
  const isImplicitDefault =
    options.latitudeDeg === undefined &&
    options.longitudeDeg === undefined &&
    options.timezone === undefined &&
    options.utcOffsetSeconds === undefined;

  const latitudeDeg = options.latitudeDeg ?? DEFAULT_HUS_LATITUDE_DEG;
  const longitudeDeg = options.longitudeDeg ?? DEFAULT_HUS_LONGITUDE_DEG;
  const effectiveTimezone = options.timezone ?? (isImplicitDefault ? 'Europe/London' : undefined);
  const { utcOffsetHours, timezoneAbbreviation } = resolveUtcOffsetAndAbbrev({
    year,
    dayOfYear: clampedDay,
    civilHour: normCivilHour,
    timezone: effectiveTimezone,
    utcOffsetSeconds: options.utcOffsetSeconds,
    timezoneAbbreviation: options.timezoneAbbreviation,
    longitudeDeg,
  });
  const utcHour = normCivilHour - utcOffsetHours;
  const plusXDeg = options.plusXTrueBearingDeg ?? DEFAULT_HUS_PLUS_X_BEARING_DEG;

  const latRad = latitudeDeg * DEG_TO_RAD;
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);

  const gammaRad =
    ((2.0 * Math.PI) / daysInYear) * (clampedDay - 1 + (utcHour - 12.0) / 24.0);
  const { declinationRad, equationOfTimeMin } = evaluateSpencerFourier(gammaRad);
  const declinationDeg = declinationRad * RAD_TO_DEG;

  const sinDecl = Math.sin(declinationRad);
  const cosDecl = Math.cos(declinationRad);

  // Longitude + Equation of Time offset from UTC mean solar time
  // Longitude offset is 4 minutes per degree East of the Prime Meridian.
  const solarTimeOffsetMin = 4.0 * longitudeDeg + equationOfTimeMin;
  const solarNoonHour = 12.0 + utcOffsetHours - solarTimeOffsetMin / 60.0;

  // Standard geometric sunrise/sunset altitude (-0.833° = atmospheric refraction + solar semi-diameter)
  const horizonRefractionRad = -0.833 * DEG_TO_RAD;
  const cosOmega0 = THREE.MathUtils.clamp(
    (Math.sin(horizonRefractionRad) - sinLat * sinDecl) / Math.max(1e-5, cosLat * cosDecl),
    -1.0,
    1.0
  );
  const halfDayHours = (Math.acos(cosOmega0) * RAD_TO_DEG) / 15.0;
  const sunriseHour = solarNoonHour - halfDayHours;
  const sunsetHour = solarNoonHour + halfDayHours;
  const dayLengthHours = sunsetHour - sunriseHour;

  // Apparent Solar Time (AST) and Solar Hour Angle (negative morning, positive afternoon)
  const rawAstHour = utcHour + solarTimeOffsetMin / 60.0;
  const apparentSolarHour = ((rawAstHour % 24.0) + 24.0) % 24.0;
  const hourAngleRad = (rawAstHour - 12.0) * 15.0 * DEG_TO_RAD;
  const sinOmega = Math.sin(hourAngleRad);
  const cosOmega = Math.cos(hourAngleRad);

  // True & Bennett-refracted solar altitude
  const sinTrueAlt = THREE.MathUtils.clamp(
    sinLat * sinDecl + cosLat * cosDecl * cosOmega,
    -1.0,
    1.0
  );
  const trueAltitudeDeg = Math.asin(sinTrueAlt) * RAD_TO_DEG;
  const altitudeDeg = trueAltitudeDeg + evaluateBennettRefractionDeg(trueAltitudeDeg);
  const altitudeRad = altitudeDeg * DEG_TO_RAD;

  // True compass azimuth clockwise from True North (0°=N, 90°=E, 180°=S, 270°=W)
  const eastSun = -cosDecl * sinOmega;
  const northSun = cosLat * sinDecl - sinLat * cosDecl * cosOmega;
  const rawAzimuthRad = Math.atan2(eastSun, northSun);
  const azimuthFromNorthRad =
    ((rawAzimuthRad % (2.0 * Math.PI)) + 2.0 * Math.PI) % (2.0 * Math.PI);
  const azimuthFromNorthDeg = azimuthFromNorthRad * RAD_TO_DEG;

  const plusXRelativeAzimuthRad = azimuthFromNorthRad - plusXDeg * DEG_TO_RAD;
  const trueSunVector = compassAzimuthAltitudeToWorldVector(
    azimuthFromNorthRad,
    altitudeRad,
    plusXDeg
  );

  // Clamped shadow-light elevation (>= 6.30°) so golden-hour shadows stay crisp & non-degenerate
  const effShadowAltRad = Math.max(MIN_SOLAR_SHADOW_ALTITUDE_RAD, altitudeRad);
  const shadowLightVector = compassAzimuthAltitudeToWorldVector(
    azimuthFromNorthRad,
    effShadowAltRad,
    plusXDeg
  );

  const cosAltPos = altitudeDeg > 0.0 ? Math.max(0.0, Math.cos(altitudeRad)) : 0.0;
  const mainStreetNormalDeg = (plusXDeg + 180.0) % 360.0;
  const courtyardNormalDeg = (plusXDeg + 90.0) % 360.0;
  const mainStreetIncidenceCos = Math.max(
    0.0,
    cosAltPos * Math.cos((azimuthFromNorthDeg - mainStreetNormalDeg) * DEG_TO_RAD)
  );
  const paddockIncidenceCos = Math.max(
    0.0,
    cosAltPos * Math.cos((azimuthFromNorthDeg - plusXDeg) * DEG_TO_RAD)
  );
  const courtyardIncidenceCos = Math.max(
    0.0,
    cosAltPos * Math.cos((azimuthFromNorthDeg - courtyardNormalDeg) * DEG_TO_RAD)
  );

  const isAfterSunset = normCivilHour >= sunsetHour || normCivilHour < sunriseHour;

  return {
    civilHour: normCivilHour,
    dayOfYear: clampedDay,
    year,
    utcOffsetHours,
    timezone: effectiveTimezone,
    timezoneAbbreviation,
    equationOfTimeMin,
    apparentSolarHour,
    solarNoonHour,
    sunriseHour,
    sunsetHour,
    dayLengthHours,
    declinationRad,
    declinationDeg,
    altitudeRad,
    altitudeDeg,
    azimuthFromNorthRad,
    azimuthFromNorthDeg,
    plusXRelativeAzimuthRad,
    isAfterSunset,
    trueSunDirection: [trueSunVector.x, trueSunVector.y, trueSunVector.z],
    shadowLightDirection: [shadowLightVector.x, shadowLightVector.y, shadowLightVector.z],
    trueSunVector,
    shadowLightVector,
    mainStreetIncidenceCos,
    paddockIncidenceCos,
    courtyardIncidenceCos,
  };
}

/**
 * Computes the astronomical topocentric Moon position (altitude, true compass azimuth,
 * 3D world direction, illuminated phase fraction, and 8-part lunar phase) at the configured site coordinates using Jean Meeus (*Astronomical Algorithms*, Ch. 47)
 * lunar ephemeris, horizontal parallax, and Local Sidereal Time.
 */
export function computeLunarPosition(
  civilHour: number,
  dayOfYear: number,
  referenceYear = 2026,
  options: SolarAstronomyOptions = {}
): LunarPosition {
  const year = options.year ?? referenceYear;
  const daysInYear = isLeapYear(year) ? 366 : 365;
  const normCivilHour = ((civilHour % 24.0) + 24.0) % 24.0;
  const clampedDay = Math.max(1, Math.min(daysInYear, Math.round(dayOfYear)));
  const isImplicitDefault =
    options.latitudeDeg === undefined &&
    options.longitudeDeg === undefined &&
    options.timezone === undefined &&
    options.utcOffsetSeconds === undefined;

  const latitudeDeg = options.latitudeDeg ?? DEFAULT_HUS_LATITUDE_DEG;
  const longitudeDeg = options.longitudeDeg ?? DEFAULT_HUS_LONGITUDE_DEG;
  const effectiveTimezone = options.timezone ?? (isImplicitDefault ? 'Europe/London' : undefined);
  const { utcOffsetHours } = resolveUtcOffsetAndAbbrev({
    year,
    dayOfYear: clampedDay,
    civilHour: normCivilHour,
    timezone: effectiveTimezone,
    utcOffsetSeconds: options.utcOffsetSeconds,
    timezoneAbbreviation: options.timezoneAbbreviation,
    longitudeDeg,
  });
  const utcHour = normCivilHour - utcOffsetHours;
  const plusXDeg = options.plusXTrueBearingDeg ?? DEFAULT_HUS_PLUS_X_BEARING_DEG;

  // Days elapsed since J2000.0 (2000-01-01 12:00:00 TT/UTC = 946728000000 ms)
  const jan1UtcMs = Date.UTC(year, 0, 1, 0, 0, 0);
  const instantUtcMs = jan1UtcMs + ((clampedDay - 1) * 24.0 + utcHour) * 3_600_000.0;
  const d = (instantUtcMs - 946_728_000_000.0) / 86_400_000.0;

  // Meeus Ch. 47 fundamental lunar orbital arguments (radians)
  const Lprime = (218.3164477 + 13.17639648 * d) * DEG_TO_RAD;
  const D = (297.8501921 + 12.19074912 * d) * DEG_TO_RAD;
  const M = (357.5291092 + 0.98560028 * d) * DEG_TO_RAD;
  const Mprime = (134.9633964 + 13.06499295 * d) * DEG_TO_RAD;
  const F = (93.272095 + 13.22935024 * d) * DEG_TO_RAD;

  // Geocentric ecliptic longitude and latitude
  const eclLonDeg =
    Lprime * RAD_TO_DEG +
    6.288774 * Math.sin(Mprime) +
    1.274027 * Math.sin(2.0 * D - Mprime) +
    0.658314 * Math.sin(2.0 * D) +
    0.213618 * Math.sin(2.0 * Mprime) -
    0.185596 * Math.sin(M) -
    0.114336 * Math.sin(2.0 * F);
  const eclLatDeg =
    5.128122 * Math.sin(F) +
    0.280602 * Math.sin(Mprime + F) +
    0.277693 * Math.sin(Mprime - F) +
    0.173237 * Math.sin(2.0 * D - F);

  const eclLonRad = eclLonDeg * DEG_TO_RAD;
  const eclLatRad = eclLatDeg * DEG_TO_RAD;
  const epsRad = (23.439291 - 0.000013 * d) * DEG_TO_RAD;

  const sinEps = Math.sin(epsRad);
  const cosEps = Math.cos(epsRad);
  const sinLon = Math.sin(eclLonRad);
  const cosLon = Math.cos(eclLonRad);
  const sinBeta = Math.sin(eclLatRad);
  const cosBeta = Math.cos(eclLatRad);

  // Geocentric equatorial Right Ascension and Declination
  const sinDecl = THREE.MathUtils.clamp(
    sinBeta * cosEps + cosBeta * sinEps * sinLon,
    -1.0,
    1.0
  );
  const declRad = Math.asin(sinDecl);
  const cosDecl = Math.cos(declRad);
  const raRad = Math.atan2(sinLon * cosEps - Math.tan(eclLatRad) * sinEps, cosLon);

  // Greenwich Mean Sidereal Time & Local Sidereal Time at site longitude
  const gmstDeg = (((280.46061837 + 360.98564736629 * d) % 360.0) + 360.0) % 360.0;
  const lstRad = (gmstDeg + longitudeDeg) * DEG_TO_RAD;
  const hourAngleRad = lstRad - raRad;
  const sinH = Math.sin(hourAngleRad);
  const cosH = Math.cos(hourAngleRad);

  // Geocentric -> Topocentric Altitude (lunar horizontal parallax ~0.9507° + Bennett refraction)
  const latRad = latitudeDeg * DEG_TO_RAD;
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);

  const sinGeoAlt = THREE.MathUtils.clamp(
    sinLat * sinDecl + cosLat * cosDecl * cosH,
    -1.0,
    1.0
  );
  const geoAltDeg = Math.asin(sinGeoAlt) * RAD_TO_DEG;
  const parallaxDeg = 0.9507 * Math.cos(geoAltDeg * DEG_TO_RAD);
  let topoAltDeg = geoAltDeg - parallaxDeg;
  topoAltDeg += evaluateBennettRefractionDeg(topoAltDeg);
  const altitudeRad = topoAltDeg * DEG_TO_RAD;

  // True compass azimuth clockwise from True North
  const eastMoon = -cosDecl * sinH;
  const northMoon = cosLat * sinDecl - sinLat * cosDecl * cosH;
  const rawAzRad = Math.atan2(eastMoon, northMoon);
  const azimuthFromNorthRad =
    ((rawAzRad % (2.0 * Math.PI)) + 2.0 * Math.PI) % (2.0 * Math.PI);
  const azimuthFromNorthDeg = azimuthFromNorthRad * RAD_TO_DEG;

  const trueMoonVector = compassAzimuthAltitudeToWorldVector(
    azimuthFromNorthRad,
    altitudeRad,
    plusXDeg
  );
  const effShadowAltRad = Math.max(MIN_LUNAR_SHADOW_ALTITUDE_RAD, altitudeRad);
  const shadowMoonVector = compassAzimuthAltitudeToWorldVector(
    azimuthFromNorthRad,
    effShadowAltRad,
    plusXDeg
  );

  // Illuminated fraction & waxing/waning phase from selenocentric elongation D
  const synodicPhaseDeg = (((D * RAD_TO_DEG) % 360.0) + 360.0) % 360.0;
  const isWaxing = synodicPhaseDeg < 180.0;
  const lunarAgeDays = (synodicPhaseDeg / 360.0) * 29.530588853;
  const phaseAngleRad = Math.PI - D + 0.1098 * Math.sin(Mprime) - 0.0366 * Math.sin(M);
  const illuminatedFraction = THREE.MathUtils.clamp(
    0.5 * (1.0 + Math.cos(phaseAngleRad)),
    0.0,
    1.0
  );

  let phaseName = 'Waning Crescent';
  if (synodicPhaseDeg < 11.25 || synodicPhaseDeg >= 348.75) {
    phaseName = 'New Moon';
  } else if (synodicPhaseDeg < 78.75) {
    phaseName = 'Waxing Crescent';
  } else if (synodicPhaseDeg < 101.25) {
    phaseName = 'First Quarter';
  } else if (synodicPhaseDeg < 168.75) {
    phaseName = 'Waxing Gibbous';
  } else if (synodicPhaseDeg < 191.25) {
    phaseName = 'Full Moon';
  } else if (synodicPhaseDeg < 258.75) {
    phaseName = 'Waning Gibbous';
  } else if (synodicPhaseDeg < 281.25) {
    phaseName = 'Third Quarter';
  }

  return {
    altitudeDeg: topoAltDeg,
    altitudeRad,
    azimuthFromNorthDeg,
    azimuthFromNorthRad,
    illuminatedFraction,
    synodicPhaseDeg,
    isWaxing,
    lunarAgeDays,
    phaseName,
    trueMoonDirection: [trueMoonVector.x, trueMoonVector.y, trueMoonVector.z],
    shadowMoonDirection: [shadowMoonVector.x, shadowMoonVector.y, shadowMoonVector.z],
    trueMoonVector,
    shadowMoonVector,
  };
}

