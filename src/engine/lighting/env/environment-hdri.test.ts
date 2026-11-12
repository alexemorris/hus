import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EnvironmentLighting } from '../environment-lighting.ts';
import {
  ALL_SEASONS,
  ALL_TIME_SLOTS,
  ALL_WEATHER_REGIMES,
  ENGLISH_COUNTRYSIDE_HDR_SPEC,
  HOLLYWOOD_HILLS_HDR_SPEC,
  deriveSeasonFromDayOfYear,
  deriveTimeSlot,
  deriveWeatherRegime,
  resolveClimateCapabilities,
  resolveContinuousEnvironmentHdrBlend,
  resolveContinuousTimeSlotBlend,
  resolveEnvironmentHdrCell,
} from '../../../core/types/environment-hdri.ts';
import { DEFAULT_HUS_LOCATION } from '../../../core/types/solar-weather.ts';

describe('3D (Season × TimeSlot × WeatherRegime) Environment HDRI Tensor & Climate Capabilities', () => {
  it('derives meteorological seasons accurately across Northern and Southern hemispheres', () => {
    expect(deriveSeasonFromDayOfYear(105, 52.54)).toBe('spring');
    expect(deriveSeasonFromDayOfYear(172, 52.54)).toBe('summer');
    expect(deriveSeasonFromDayOfYear(280, 52.54)).toBe('autumn');
    expect(deriveSeasonFromDayOfYear(355, 52.54)).toBe('winter');
    expect(deriveSeasonFromDayOfYear(172, -33.86)).toBe('winter');
    expect(deriveSeasonFromDayOfYear(355, -33.86)).toBe('summer');
  });

  it('distinguishes East dawn vs West dusk, high day, and astronomical night', () => {
    expect(deriveTimeSlot(6.5, 92.0)).toBe('dawn');
    expect(deriveTimeSlot(6.5, 272.0)).toBe('dusk');
    expect(deriveTimeSlot(38.0, 175.0)).toBe('day');
    expect(deriveTimeSlot(-8.0, 350.0)).toBe('night');
  });

  it('resolves every (season, time, weather) query across english-countryside & hollywood-hills with zero missing files', () => {
    const hdrDir = path.resolve(process.cwd(), 'public/textures/hdr');
    for (const spec of [
      ENGLISH_COUNTRYSIDE_HDR_SPEC,
      HOLLYWOOD_HILLS_HDR_SPEC,
    ]) {
      for (const season of ALL_SEASONS) {
        for (const time of ALL_TIME_SLOTS) {
          for (const weather of ALL_WEATHER_REGIMES) {
            const { cell } = resolveEnvironmentHdrCell(spec, { season, time, weather });
            if (cell.key !== 'dawn_clear') {
              expect(fs.existsSync(path.join(hdrDir, cell.hdrUrl))).toBe(true);
              if (cell.previewHdrUrl) {
                expect(fs.existsSync(path.join(hdrDir, cell.previewHdrUrl))).toBe(true);
              }
            }
          }
        }
      }
    }

        expect(
      resolveEnvironmentHdrCell('hollywood-hills', { season: 'summer', time: 'day', weather: 'overcast' }).cell.key
    ).toBe('day_overcast');
    expect(
      resolveEnvironmentHdrCell('hollywood-hills', { season: 'summer', time: 'dawn', weather: 'clear' }).cellKey
    ).toBe('dawn_clear');
  });

  it('infers location & season climate capabilities and clamps active snow when leaving Winter or switching to Stahl House', () => {
    const stahlWinter = resolveClimateCapabilities({
      location: { lat: 34.100437, lon: -118.370152, elevationM: 240.2 },
      season: 'winter',
      environment: 'hollywood-hills',
    });
    expect(stahlWinter.zone).toBe('warm');
    expect(stahlWinter.snowSupportedAtLocation).toBe(false);
    expect(stahlWinter.snowAllowedNow).toBe(false);
    expect(stahlWinter.snowDisabledReason).toContain('34.1°N');

    const alpineWinter = resolveClimateCapabilities({
      location: { lat: 34.1, lon: -118.2, elevationM: 2200 },
      season: 'winter',
    });
    expect(alpineWinter.zone).toBe('temperate');
    expect(alpineWinter.snowAllowedNow).toBe(true);

    const ukSummer = resolveClimateCapabilities({
      location: DEFAULT_HUS_LOCATION,
      season: 'summer',
      environment: 'english-countryside',
    });
    expect(ukSummer.zone).toBe('temperate');
    expect(ukSummer.snowSupportedAtLocation).toBe(true);
    expect(ukSummer.snowAllowedNow).toBe(false);
    expect(ukSummer.snowDisabledReason).toBe('Snow only available in Winter');

    const scene = new THREE.Scene();
    const env = new EnvironmentLighting(
      scene,
      undefined,
      undefined,
      DEFAULT_HUS_LOCATION,
      undefined,
      'english-countryside'
    );
    env.setTimeOfDay('day');
    env.setSeason('winter');
    env.weather.applyPreset('winter_snow');
    expect(env.getSkyWeatherSnapshot().weather.precipType).toBe('snow');
    expect(env.getSkyWeatherSnapshot().weatherRegime).toBe('snow');
    expect(env.getSkyWeatherSnapshot().activeHdrCellKey).toBe('day');

    const summerSnap = env.setSeason('summer');
    expect(summerSnap.season).toBe('summer');
    expect(summerSnap.weather.precipType).toBe('none');
    expect(summerSnap.weather.precipIntensity).toBe(0);
    expect(summerSnap.weatherRegime).toBe('overcast');

    env.setSeason('winter');
    env.weather.applyPreset('winter_snow');
    expect(env.getSkyWeatherSnapshot().weather.precipType).toBe('snow');
    env.setLocation({ lat: 34.100437, lon: -118.370152, elevationM: 240.2 });
    env.setEnvironment('hollywood-hills');
    const warmSnap = env.getSkyWeatherSnapshot();
    expect(warmSnap.weather.precipType).toBe('none');
    expect(warmSnap.climate?.snowAllowedNow).toBe(false);
    expect(
      deriveWeatherRegime({
        cloudEnabled: true,
        cloudCoverPct: 88,
        precipType: 'snow',
        precipIntensity: 0.8,
        snowAllowed: false,
      })
    ).toBe('overcast');
    env.dispose();
  });

  it('computes C1-continuous dual-slot solar blend weights across Night -> Dawn -> Day -> Dusk -> Night with zero jump across solar noon (180°) or midnight (0°)', () => {
    expect(resolveContinuousTimeSlotBlend(-7.0, 75)).toMatchObject({
      slotA: 'night',
      slotB: 'night',
      blendT: 0,
    });
    const preDawn = resolveContinuousTimeSlotBlend(-1.5, 80);
    expect(preDawn.slotA).toBe('night');
    expect(preDawn.slotB).toBe('dawn');
    expect(preDawn.blendT).toBeGreaterThan(0.1);
    expect(preDawn.blendT).toBeLessThan(0.9);

    const morningRise = resolveContinuousTimeSlotBlend(7.5, 110);
    expect(morningRise.slotA).toBe('dawn');
    expect(morningRise.slotB).toBe('day');
    expect(morningRise.blendT).toBeCloseTo(0.5, 5);

    const goldenHour = resolveContinuousTimeSlotBlend(9.0, 260);
    expect(goldenHour.slotA).toBe('day');
    expect(goldenHour.slotB).toBe('dusk');
    expect(goldenHour.blendT).toBeCloseTo(0.5, 5);

    const civilDusk = resolveContinuousTimeSlotBlend(-0.75, 290);
    expect(civilDusk.slotA).toBe('dusk');
    expect(civilDusk.slotB).toBe('night');
    expect(civilDusk.blendT).toBeCloseTo(0.5, 5);

    const evalWeights = (alt: number, az: number): Record<string, number> => {
      const r = resolveContinuousTimeSlotBlend(alt, az);
      const out: Record<string, number> = { dawn: 0, day: 0, dusk: 0, night: 0 };
      out[r.slotA] = (out[r.slotA] ?? 0) + (1 - r.blendT);
      out[r.slotB] = (out[r.slotB] ?? 0) + r.blendT;
      return out;
    };

    for (const alt of [-10, -2, 2.5, 6.0, 10.5, 13.0, 14.0, 45.0]) {
      const preNoon = evalWeights(alt, 179.99);
      const postNoon = evalWeights(alt, 180.01);
      for (const k of ['dawn', 'day', 'dusk', 'night']) {
        expect(Math.abs(preNoon[k]! - postNoon[k]!)).toBeLessThan(1e-3);
      }
      const preMidnight = evalWeights(alt, 359.99);
      const postMidnight = evalWeights(alt, 0.01);
      for (const k of ['dawn', 'day', 'dusk', 'night']) {
        expect(Math.abs(preMidnight[k]! - postMidnight[k]!)).toBeLessThan(1e-3);
      }
    }

    const envBlend = resolveContinuousEnvironmentHdrBlend('hollywood-hills', 'summer', 'clear', 7.5, 110);
    expect(envBlend.cellA.cellKey).toBe('dawn_clear');
    expect(envBlend.cellB.cellKey).toBe('day_clear');
    expect(envBlend.preloadCells.map((c) => c.cellKey)).toEqual(['dusk_clear', 'night_clear']);
  });
});
