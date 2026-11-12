import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_HUS_LOCATION } from '../../../core/types/solar-weather.ts';
import {
  WeatherController,
  buildOpenMeteoForecastUrl,
  deriveWeatherConditionFromTelemetry,
  parseOpenMeteoForecastResponse,
  parseOpenMeteoUkvResponse,
} from './weather-controller.ts';

describe('Global Open-Meteo classification & parser', () => {
  it('builds global Open-Meteo forecast URLs with timezone=auto and without ukmo_seamless', () => {
    const laUrl = buildOpenMeteoForecastUrl(34.1003, -118.3698);
    expect(laUrl).toContain('latitude=34.1003');
    expect(laUrl).toContain('longitude=-118.3698');
    expect(laUrl).toContain('timezone=auto');
    expect(laUrl).not.toContain('ukmo_seamless');

    const ukUrl = buildOpenMeteoForecastUrl(52.544462, -0.947371);
    expect(ukUrl).toContain('latitude=52.544462');
    expect(ukUrl).toContain('longitude=-0.947371');
    expect(ukUrl).toContain('timezone=auto');
    expect(ukUrl).not.toContain('ukmo_seamless');
  });

  it('classifies snow, heavy_rain, rain, drizzle, fog, overcast, partly_cloudy, and clear per Platform 37 rules', () => {
    expect(
      deriveWeatherConditionFromTelemetry({
        wmoCode: 73,
        precipChancePct: 75,
        liquidPrecipMm: 0,
        snowPrecipMm: 2.2,
        cloudCoverPct: 92,
        visibilityKm: 2.8,
        humidityPct: 88,
        tempC: -1.2,
        dewPointC: -2.4,
      }).condition
    ).toBe('snow');

    expect(
      deriveWeatherConditionFromTelemetry({
        wmoCode: 95,
        precipChancePct: 90,
        liquidPrecipMm: 7.4,
        snowPrecipMm: 0,
        cloudCoverPct: 98,
        visibilityKm: 3.5,
        humidityPct: 94,
        tempC: 14.0,
        dewPointC: 13.0,
        thunderChancePct: 70,
      }).condition
    ).toBe('heavy_rain');

    expect(
      deriveWeatherConditionFromTelemetry({
        wmoCode: 61,
        precipChancePct: 65,
        liquidPrecipMm: 1.8,
        snowPrecipMm: 0,
        cloudCoverPct: 86,
        visibilityKm: 7.5,
        humidityPct: 86,
        tempC: 11.5,
        dewPointC: 9.2,
      }).condition
    ).toBe('rain');

    expect(
      deriveWeatherConditionFromTelemetry({
        wmoCode: 51,
        precipChancePct: 40,
        liquidPrecipMm: 0.25,
        snowPrecipMm: 0,
        cloudCoverPct: 78,
        visibilityKm: 9.0,
        humidityPct: 82,
        tempC: 12.0,
        dewPointC: 9.0,
      }).condition
    ).toBe('drizzle');

    expect(
      deriveWeatherConditionFromTelemetry({
        wmoCode: 45,
        precipChancePct: 5,
        liquidPrecipMm: 0,
        snowPrecipMm: 0,
        cloudCoverPct: 60,
        visibilityKm: 1.4,
        humidityPct: 98,
        tempC: 6.5,
        dewPointC: 6.2,
      }).condition
    ).toBe('fog');

    expect(
      deriveWeatherConditionFromTelemetry({
        wmoCode: 3,
        precipChancePct: 10,
        liquidPrecipMm: 0,
        snowPrecipMm: 0,
        cloudCoverPct: 94,
        visibilityKm: 14,
        humidityPct: 74,
        tempC: 13.0,
        dewPointC: 8.5,
      }).condition
    ).toBe('overcast');

    expect(
      deriveWeatherConditionFromTelemetry({
        wmoCode: 2,
        precipChancePct: 5,
        liquidPrecipMm: 0,
        snowPrecipMm: 0,
        cloudCoverPct: 45,
        visibilityKm: 18,
        humidityPct: 64,
        tempC: 16.5,
        dewPointC: 9.5,
      }).condition
    ).toBe('partly_cloudy');

    expect(
      deriveWeatherConditionFromTelemetry({
        wmoCode: 0,
        precipChancePct: 0,
        liquidPrecipMm: 0,
        snowPrecipMm: 0,
        cloudCoverPct: 6,
        visibilityKm: 24,
        humidityPct: 55,
        tempC: 19.0,
        dewPointC: 9.5,
      }).condition
    ).toBe('clear');
  });

  it('parses global Open-Meteo JSON payloads including timezone & elevation metadata', () => {
    const parsed = parseOpenMeteoUkvResponse({
      timezone: 'Europe/London',
      timezone_abbreviation: 'BST',
      utc_offset_seconds: 3600,
      elevation: 121.0,
      current: {
        time: '2026-06-21T14:00',
        temperature_2m: 16.4,
        apparent_temperature: 15.2,
        relative_humidity_2m: 84,
        dew_point_2m: 13.6,
        precipitation: 2.1,
        rain: 2.1,
        showers: 0,
        snowfall: 0,
        weather_code: 61,
        cloud_cover: 88,
        surface_pressure: 1009.4,
        wind_speed_10m: 22.5,
        wind_direction_10m: 240,
        wind_gusts_10m: 34.0,
        visibility: 6500,
      },
      hourly: {
        time: ['2026-06-21T13:00', '2026-06-21T14:00'],
        precipitation_probability: [30, 80],
        visibility: [10000, 6500],
      },
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.condition).toBe('rain');
    expect(parsed!.precipType).toBe('rain');
    expect(parsed!.temperatureC).toBeCloseTo(16.4, 1);
    expect(parsed!.feelsLikeC).toBeCloseTo(15.2, 1);
    expect(parsed!.cloudCoverPct).toBe(88);
    expect(parsed!.windSpeedKph).toBeCloseTo(22.5, 1);
    expect(parsed!.visibilityKm).toBeCloseTo(6.5, 1);
    expect(parsed!.timezone).toBe('Europe/London');
    expect(parsed!.timezoneAbbreviation).toBe('BST');
    expect(parsed!.utcOffsetSeconds).toBe(3600);
    expect(parsed!.elevationM).toBeCloseTo(121.0, 1);
    expect(parsed!.source).toBe('Open-Meteo Live');
    expect(parsed!.description).toBe('Rain');

    const labeled = parseOpenMeteoForecastResponse(
      {
        timezone: 'America/Los_Angeles',
        timezone_abbreviation: 'PDT',
        utc_offset_seconds: -25200,
        elevation: 231.0,
        current: { temperature_2m: 26.2, weather_code: 0, cloud_cover: 5 },
      },
      'Hollywood Hills'
    );
    expect(labeled!.timezone).toBe('America/Los_Angeles');
    expect(labeled!.timezoneAbbreviation).toBe('PDT');
    expect(labeled!.utcOffsetSeconds).toBe(-25200);
    expect(labeled!.elevationM).toBe(231);
    expect(labeled!.source).toBe('Open-Meteo Live (Hollywood Hills)');
    expect(labeled!.description).toBe('Clear Sky · Hollywood Hills');
  });

  it('queries Hollywood Hills with timezone=auto and preserves Cotswolds label only when configured', async () => {
    const requestedUrls: string[] = [];
    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      requestedUrls.push(String(url));
      return {
        ok: true,
        json: async () => ({
          timezone: 'America/Los_Angeles',
          timezone_abbreviation: 'PDT',
          utc_offset_seconds: -25200,
          elevation: 231.0,
          current: {
            time: '2026-06-21T15:00',
            temperature_2m: 27.4,
            apparent_temperature: 26.8,
            relative_humidity_2m: 38,
            dew_point_2m: 12.0,
            precipitation: 0,
            rain: 0,
            showers: 0,
            snowfall: 0,
            weather_code: 0,
            cloud_cover: 8,
            surface_pressure: 1013.2,
            wind_speed_10m: 11.5,
            wind_direction_10m: 255,
            wind_gusts_10m: 18.0,
            visibility: 16000,
          },
        }),
      } as unknown as Response;
    });

    const laCtrl = new WeatherController({
      fetchImpl: mockFetch,
      location: { lat: 34.1003, lon: -118.3698 },
    });
    expect(laCtrl.getState().source).toBe('Weather Preset');
    expect(laCtrl.getState().description).toBe('Clear Sky');

    const liveLa = await laCtrl.setLiveFeedEnabled(true);
    expect(requestedUrls[0]).toContain('latitude=34.1003');
    expect(requestedUrls[0]).toContain('longitude=-118.3698');
    expect(requestedUrls[0]).toContain('timezone=auto');
    expect(requestedUrls[0]).not.toContain('ukmo_seamless');
    expect(liveLa.timezone).toBe('America/Los_Angeles');
    expect(liveLa.timezoneAbbreviation).toBe('PDT');
    expect(liveLa.utcOffsetSeconds).toBe(-25200);
    expect(liveLa.elevationM).toBe(231);
    expect(liveLa.source).toBe('Open-Meteo Live');
    expect(liveLa.description).toBe('Clear Sky');
    laCtrl.dispose();

    const ukCtrl = new WeatherController({ location: DEFAULT_HUS_LOCATION });
    expect(ukCtrl.getState().source).toBe('Preset (Cotswolds · Gloucestershire)');
    expect(ukCtrl.getState().description).toBe('Clear Sky · Cotswolds');
    ukCtrl.dispose();
  });
});

describe('WeatherController composable 3-layer behaviour & 0% idle loop discipline', () => {
  it('guarantees 0 idle frame wakeups when precipType === "none" and animates smoothly during rain/snow', () => {
    const ctrl = new WeatherController();
    const camPos = new THREE.Vector3(12, 6, 18);
    const camTarget = new THREE.Vector3(0, 1, 4);

    // Default startup: clear & cloudEnabled=false, precipType === 'none' -> 0 sky overdraw & 0 idle wakeups!
    expect(ctrl.getState().precipType).toBe('none');
    expect(ctrl.isAnimating()).toBe(false);
    let wakeups = 0;
    for (let i = 0; i < 300; i++) {
      if (ctrl.update(1 / 60, camPos, camTarget)) wakeups++;
    }
    expect(wakeups).toBe(0);

    // Activate Heavy Storm preset -> rain + clouds + mist + specular surface wetness
    const storm = ctrl.applyPreset('heavy_storm');
    expect(storm.condition).toBe('heavy_rain');
    expect(storm.precipType).toBe('rain');
    expect(storm.surfaceWetness).toBeGreaterThan(0.8);
    expect(ctrl.isAnimating()).toBe(true);
    expect(ctrl.update(1 / 60, camPos, camTarget)).toBe(true);

    // Switch to Winter Snow -> snow particles active
    const snow = ctrl.applyPreset('winter_snow');
    expect(snow.condition).toBe('snow');
    expect(snow.precipType).toBe('snow');
    expect(ctrl.isAnimating()).toBe(true);
    expect(ctrl.update(1 / 60, camPos, camTarget)).toBe(true);

    // Switch to Morning Mist -> fog layer active, precipType === 'none' -> back to 0% idle wakeups!
    const mist = ctrl.applyPreset('morning_mist');
    expect(mist.condition).toBe('fog');
    expect(mist.precipType).toBe('none');
    expect(ctrl.isAnimating()).toBe(false);
    expect(ctrl.update(1 / 60, camPos, camTarget)).toBe(false);

    ctrl.dispose();
  });

  it('modulates exterior cobblestone/slate roughness when wet and restores dry values, while sparing interior rooms', () => {
    const root = new THREE.Group();
    const outdoorCobbleMat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0.04 });
    const outdoorMesh = new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 2), outdoorCobbleMat);
    outdoorMesh.position.set(0, 0, 10); // Exterior courtyard
    root.add(outdoorMesh);

    const indoorOakMat = new THREE.MeshStandardMaterial({ roughness: 0.65, metalness: 0.0 });
    const indoorMesh = new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 2), indoorOakMat);
    indoorMesh.position.set(0, 0.5, 0); // Inside kitchen zone
    root.add(indoorMesh);
    root.updateMatrixWorld(true);

    const ctrl = new WeatherController();
    ctrl.setInteriorRoomBounds([{ minX: -4.5, maxX: 5.0, minY: 0, maxY: 3.0, minZ: -2.1, maxZ: 2.5 }]);
    ctrl.indexExteriorMaterials(root);

    ctrl.applyPreset('heavy_storm');
    expect(outdoorCobbleMat.roughness).toBeGreaterThanOrEqual(0.42);
    expect(outdoorCobbleMat.roughness).toBeLessThan(0.82);
    expect(outdoorCobbleMat.metalness).toBeCloseTo(0.04, 5); // 0.0 metalness delta on wet dielectrics!
    expect(indoorOakMat.roughness).toBeCloseTo(0.65, 5); // Unchanged indoors!

    ctrl.applyPreset('clear');
    expect(outdoorCobbleMat.roughness).toBeCloseTo(0.82, 5);
    expect(outdoorCobbleMat.metalness).toBeCloseTo(0.04, 5);
    ctrl.dispose();
  });

  it('falls back gracefully without throwing when Open-Meteo fetch rejects offline', async () => {
    const offlineFetch = vi.fn().mockRejectedValue(new Error('Network unreachable'));
    const ctrl = new WeatherController({ fetchImpl: offlineFetch });
    const state = await ctrl.setLiveFeedEnabled(true);
    expect(offlineFetch).toHaveBeenCalledTimes(1);
    expect(state.liveFeedEnabled).toBe(true);
    expect(state.condition).toBe('clear');
    ctrl.dispose();
  });

  it('parks all inactive InstancedMesh slots at (0, -10000, 0) zero-scale and never places any cloud, splash, snow, or rain streak near world origin (0, 0, 0) Kitchen Range Hob', () => {
    const ctrl = new WeatherController();
    const mat = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    const assertNoOriginOrIndoorInstances = (label: string): void => {
      ctrl.group.traverse((obj) => {
        if (obj instanceof THREE.InstancedMesh) {
          const maxCount = obj.instanceMatrix.count;
          expect(obj.count, `${label}:${obj.name}.count`).toBeGreaterThanOrEqual(0);
          expect(obj.count, `${label}:${obj.name}.count<=max`).toBeLessThanOrEqual(maxCount);
          for (let i = 0; i < maxCount; i++) {
            obj.getMatrixAt(i, mat);
            mat.decompose(pos, quat, scale);
            // Zero slots may ever sit near world origin (0, 0, 0) or inside the Kitchen / Farmhouse!
            const inKitchenBox =
              pos.x >= -22.5 &&
              pos.x <= 13.5 &&
              pos.y >= -2.0 &&
              pos.y <= 12.0 &&
              pos.z >= -11.5 &&
              pos.z <= 5.2;
            expect(inKitchenBox, `${label}:${obj.name}[${i}] pos=(${pos.x},${pos.y},${pos.z})`).toBe(
              false
            );
            if (obj.name === '__hus_volumetric_clouds__' || obj.name.startsWith('__hus_rain_splash_phase_')) {
              if (i >= obj.count) {
                expect(pos.y, `${label}:${obj.name}[${i}] parked y`).toBeCloseTo(-10_000, 1);
                expect(scale.lengthSq(), `${label}:${obj.name}[${i}] parked scale`).toBe(0);
              }
            }
          }
        } else if (obj instanceof THREE.LineSegments) {
          const attr = obj.geometry.getAttribute('position');
          for (let v = 0; v < attr.count; v++) {
            const vx = attr.getX(v);
            const vz = attr.getZ(v);
            const insideKitchenFootprint =
              vx >= -23.0 && vx <= 13.8 && vz >= -11.8 && vz <= 5.4;
            expect(insideKitchenFootprint, `${label}:${obj.name} v=${v}`).toBe(false);
          }
        }
      });
    };

    assertNoOriginOrIndoorInstances('initial-partly_cloudy');
    ctrl.applyPreset('clear');
    assertNoOriginOrIndoorInstances('clear');
    ctrl.applyPreset('overcast');
    assertNoOriginOrIndoorInstances('overcast');
    ctrl.applyPreset('heavy_storm');
    ctrl.update(1 / 60, new THREE.Vector3(-1.5, 1.6, 0.5), new THREE.Vector3(-2.16, 0.9, -2.13));
    assertNoOriginOrIndoorInstances('heavy_storm-in-kitchen');
    ctrl.applyPreset('winter_snow');
    ctrl.update(1 / 60, new THREE.Vector3(-1.5, 1.6, 0.5), new THREE.Vector3(-2.16, 0.9, -2.13));
    assertNoOriginOrIndoorInstances('winter_snow-in-kitchen');

    ctrl.dispose();
  });

  it('updates cumulus lighting uniforms in O(1) during solar scrubbing without re-uploading 264 instance matrices', () => {
    const ctrl = new WeatherController();
    ctrl.setGraphicsTier('ultra');
    ctrl.setCloudLayer(true, 55);

    let cloudInst: THREE.InstancedMesh | null = null;
    ctrl.group.traverse((obj) => {
      if (obj instanceof THREE.InstancedMesh && obj.count > 0) {
        cloudInst = obj;
      }
    });
    expect(cloudInst).not.toBeNull();
    const matVersionBefore = cloudInst!.instanceMatrix.version;
    const colVersionBefore = cloudInst!.instanceColor?.version ?? 0;

    for (const hr of [0, 6, 12, 18, 22]) {
      const rad = (hr / 24) * Math.PI * 2;
      ctrl.syncWithLighting({
        sunDirection: new THREE.Vector3(Math.cos(rad), Math.sin(rad), 0.3).normalize(),
        sunAltitudeDeg: Math.sin(rad) * 60,
        goldenFactor: hr === 6 || hr === 18 ? 0.85 : 0,
        nightFactor: hr === 0 || hr === 22 ? 1 : 0,
      });
    }

    expect(cloudInst!.instanceMatrix.version).toBe(matVersionBefore);
    expect(cloudInst!.instanceColor?.version ?? 0).toBe(colVersionBefore);

    // Changing cloud cover percentage DOES update instance geometry
    ctrl.setCloudLayer(true, 82);
    expect(cloudInst!.instanceMatrix.version).toBeGreaterThan(matVersionBefore);

    ctrl.dispose();
  });
});
