import { DEFAULT_HUS_PLUS_X_BEARING_DEG, type WeatherCondition } from './types/solar-weather.ts';

const COMPASS_16 = [
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
] as const;

const MONTH_SHORT = [
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
] as const;

/** Formats a compass bearing (0..360° CW from True North) to a 16-wind cardinal label. */
export function bearingToCardinal16(bearingDeg: number): string {
  const norm = ((bearingDeg % 360) + 360) % 360;
  const idx = Math.round(norm / 22.5) % 16;
  return COMPASS_16[idx] ?? 'N';
}

/** Formats a decimal clock hour (`0..24`) as `HH:MM`. */
export function formatCivilHourHHMM(civilHour: number): string {
  const norm = ((civilHour % 24) + 24) % 24;
  const totalMinutes = Math.round(norm * 60) % 1440;
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Formats a day length in hours (`16.84`) as `16h 50m`. */
export function formatDurationHoursHM(hours: number): string {
  const clamped = Math.max(0, Math.min(24, hours));
  const totalMinutes = Math.round(clamped * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** Converts `(dayOfYear, year)` to a short calendar label such as `21 Jun`. */
export function formatDayOfYearShort(dayOfYear: number, year = 2026): string {
  const clamped = Math.max(1, Math.min(366, Math.round(dayOfYear)));
  const dt = new Date(Date.UTC(year, 0, clamped));
  const day = dt.getUTCDate();
  const month = MONTH_SHORT[dt.getUTCMonth()] ?? 'Jan';
  return `${day} ${month}`;
}

/** Projects a compass azimuth & altitude (degrees) to relative screen-compass polar coordinates `(x, y)` inside `[-1, 1]`. */
export function projectCelestialOnCompassRose(
  azimuthFromNorthDeg: number,
  altitudeDeg: number,
  cameraBearingDeg: number
): { readonly rx: number; readonly ry: number; readonly isAboveHorizon: boolean } {
  // Angle on compass rose where top (0, -1) is the camera's forward heading
  const relRad = (((azimuthFromNorthDeg - cameraBearingDeg) % 360) * Math.PI) / 180;
  const clampedAlt = Math.max(0, Math.min(90, altitudeDeg));
  // Outer ring (r=0.84) = horizon (0°), center (r=0.14) = zenith (90°)
  const radius = altitudeDeg >= 0 ? 0.84 - (clampedAlt / 90) * 0.68 : 0.9;
  return {
    rx: Math.sin(relRad) * radius,
    ry: -Math.cos(relRad) * radius,
    isAboveHorizon: altitudeDeg >= -0.833,
  };
}

/** Pure scalar True-North bearing for a world XZ forward vector `(fx, fz)`. */
export function forwardXZToTrueBearingDeg(
  fx: number,
  fz: number,
  plusXTrueBearingDeg = DEFAULT_HUS_PLUS_X_BEARING_DEG
): number {
  if (fx * fx + fz * fz < 1e-10) {
    return ((plusXTrueBearingDeg % 360) + 360) % 360;
  }
  const angleFromPlusXDeg = (Math.atan2(fz, fx) * 180) / Math.PI;
  return (((plusXTrueBearingDeg + angleFromPlusXDeg) % 360) + 360) % 360;
}

export function weatherConditionShortLabel(condition: WeatherCondition): string {
  switch (condition) {
    case 'clear':
      return 'Clear';
    case 'partly_cloudy':
      return 'Partly Cloudy';
    case 'overcast':
      return 'Overcast';
    case 'drizzle':
      return 'Light Rain';
    case 'rain':
      return 'Rain';
    case 'heavy_rain':
      return 'Heavy Storm';
    case 'fog':
      return 'Valley Mist';
    case 'snow':
      return 'Snow';
  }
}

/** Formats a UTC offset in hours (e.g. `-7`, `1`, `5.5`) as `UTC-7`, `UTC+1`, `UTC+5:30`, or `GMT`. */
export function formatUtcOffsetLabel(utcOffsetHours: number): string {
  if (!Number.isFinite(utcOffsetHours) || Math.abs(utcOffsetHours) < 1e-6) {
    return "GMT";
  }
  const sign = utcOffsetHours >= 0 ? "+" : "-";
  const totalMinutes = Math.round(Math.abs(utcOffsetHours) * 60);
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  return mm === 0 ? `UTC${sign}${hh}` : `UTC${sign}${hh}:${String(mm).padStart(2, "0")}`;
}

/** Formats WGS84 decimal degrees into compact hemisphere coordinates (e.g. `34.100°N, 118.370°W`). */
export function formatLatLonCoords(latitudeDeg: number, longitudeDeg: number): string {
  const latHem = latitudeDeg >= 0 ? "N" : "S";
  const lonHem = longitudeDeg >= 0 ? "E" : "W";
  return `${Math.abs(latitudeDeg).toFixed(3)}°${latHem}, ${Math.abs(longitudeDeg).toFixed(3)}°${lonHem}`;
}
