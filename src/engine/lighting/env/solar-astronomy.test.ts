import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HUS_LATITUDE_DEG,
  DEFAULT_HUS_LOCATION,
  DEFAULT_HUS_LONGITUDE_DEG,
  DEFAULT_HUS_PLUS_X_BEARING_DEG,
  resolvePlusXTrueBearingDeg,
} from '../../../core/types/solar-weather.ts';
import { bearingToCardinal16 } from '../../../core/solar-weather-format.ts';
import {
  compassAzimuthAltitudeToWorldVector,
  computeLunarPosition,
  computeSolarPosition,
  worldVectorToCompassAzimuthAltitude,
} from './solar-astronomy.ts';

describe('Default Hus geodesic & compass calibration', () => {
  it('uses temperate Cotswolds coordinates (51.8412°N, -1.7924°W) and right-handed +X=90° East / -Z=North bearings', () => {
    expect(DEFAULT_HUS_LATITUDE_DEG).toBeCloseTo(51.8412, 4);
    expect(DEFAULT_HUS_LONGITUDE_DEG).toBeCloseTo(-1.7924, 4);
    expect(DEFAULT_HUS_PLUS_X_BEARING_DEG).toBe(90);

    const north = compassAzimuthAltitudeToWorldVector(0, 0, 90);
    expect(north.x).toBeCloseTo(0, 5);
    expect(north.z).toBeCloseTo(-1, 5);
    const east = compassAzimuthAltitudeToWorldVector(Math.PI / 2, 0, 90);
    expect(east.x).toBeCloseTo(1, 5);
    expect(east.z).toBeCloseTo(0, 5);

    const roundTrip = worldVectorToCompassAzimuthAltitude(
      compassAzimuthAltitudeToWorldVector((215 * Math.PI) / 180, (34 * Math.PI) / 180, 90),
      90
    );
    expect(roundTrip.azimuthFromNorthDeg).toBeCloseTo(215, 4);
    expect(roundTrip.altitudeDeg).toBeCloseTo(34, 4);
    expect(bearingToCardinal16(0)).toBe('N');
    expect(bearingToCardinal16(90)).toBe('E');
  });
});

describe('Spencer (1971) / NOAA Solar & Meeus Lunar Ephemeris', () => {
  it('matches summer solstice (21 Jun, Day 172) and winter solstice (21 Dec, Day 355) in Europe/London', () => {
    const summerNoon = computeSolarPosition(13.12, 172, { year: 2026 });
    expect(summerNoon.utcOffsetHours).toBe(1);
    expect(summerNoon.timezoneAbbreviation).toBe('BST');
    expect(summerNoon.dayLengthHours).toBeGreaterThan(16.4);
    expect(summerNoon.altitudeDeg).toBeCloseTo(90 - DEFAULT_HUS_LATITUDE_DEG + 23.44, 0);
    expect(summerNoon.azimuthFromNorthDeg).toBeGreaterThan(176);
    expect(summerNoon.azimuthFromNorthDeg).toBeLessThan(184);

    const winterNoon = computeSolarPosition(12.08, 355, { year: 2026 });
    expect(winterNoon.utcOffsetHours).toBe(0);
    expect(winterNoon.timezoneAbbreviation).toBe('GMT');
    expect(winterNoon.dayLengthHours).toBeLessThan(8.0);
    expect(winterNoon.altitudeDeg).toBeCloseTo(90 - DEFAULT_HUS_LATITUDE_DEG - 23.44, 0);

    const midnight = computeSolarPosition(0.5, 172, { year: 2026 });
    expect(midnight.isAfterSunset).toBe(true);
    expect(midnight.shadowLightDirection[1]).toBeGreaterThan(0.1);
  });

  it('tracks lunar synodic phases smoothly across a full month', () => {
    const samples = [];
    for (let day = 1; day <= 31; day++) {
      samples.push(computeLunarPosition(22.0, day, 2026));
    }
    const maxIllum = Math.max(...samples.map((s) => s.illuminatedFraction));
    const minIllum = Math.min(...samples.map((s) => s.illuminatedFraction));
    expect(maxIllum).toBeGreaterThan(0.95);
    expect(minIllum).toBeLessThan(0.06);
  });

  it('resolves plusXTrueBearingDeg from northOffsetDeg and explicit plusXTrueBearingDeg', () => {
    expect(resolvePlusXTrueBearingDeg()).toBe(90);
    expect(resolvePlusXTrueBearingDeg(DEFAULT_HUS_LOCATION)).toBe(90);
    expect(resolvePlusXTrueBearingDeg({ lat: 34.1003, lon: -118.3698, northOffsetDeg: 250.17 })).toBeCloseTo(340.17, 2);
  });
});
