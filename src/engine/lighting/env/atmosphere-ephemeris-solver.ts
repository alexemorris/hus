import * as THREE from 'three';
import {
  canonicalDayOfYearForSeason,
  deriveSeasonFromDayOfYear,
  deriveTimeSlot,
  deriveWeatherRegime,
  normalizeEnvironmentHdrSpec,
  resolveClimateCapabilities,
  resolveContinuousEnvironmentHdrBlend,
  resolveContinuousTimeSlotBlend,
  type ContinuousEnvironmentHdrBlend,
  type EnvironmentHdrQuery,
  type HouseClimateCapabilities,
  type HouseClimateInput,
  type HouseEnvironmentInput,
  type Season,
  type SeasonSelection,
  type TimeSlot,
  type WeatherRegime,
} from '../../../core/types/environment-hdri.ts';
import type { TimeOfDay } from '../../../core/types/scene.ts';
import {
  DEFAULT_HUS_PLUS_X_BEARING_DEG,
  DEFAULT_HUS_LATITUDE_DEG,
  DEFAULT_HUS_LONGITUDE_DEG,
  resolvePlusXTrueBearingDeg,
  type HouseLocation,
  type SkyWeatherSnapshot,
  type SolarDateTimeInput,
} from '../../../core/types/solar-weather.ts';
import { setCloudGoboUniforms } from '../shader-light-culling.ts';
import { CANONICAL_SOLAR_PRESETS, ENV_PRESETS } from './env-presets.ts';
import {
  copyEnvState,
  lerpEnvState,
  stateFromPreset,
  type EnvLightingState,
} from './env-state.ts';
import {
  computeLunarPosition,
  computeSolarPosition,
  getCurrentSolarClockForLocation,
  type LunarPosition,
  type SolarAstronomyOptions,
  type SolarPosition,
} from './solar-astronomy.ts';
import type { WeatherController } from './weather-controller.ts';

export const MODE_TO_MINUTES: Readonly<Record<TimeOfDay, number>> = {
  day: Math.round(CANONICAL_SOLAR_PRESETS.day.civilHour * 60),
  dusk: Math.round(CANONICAL_SOLAR_PRESETS.dusk.civilHour * 60),
  night: Math.round(CANONICAL_SOLAR_PRESETS.night.civilHour * 60),
};

const COLOR_OVERCAST_SUN = new THREE.Color(0xdce5f0);
const COLOR_OVERCAST_SKY = new THREE.Color(0xb6c4d4);
const COLOR_OVERCAST_GROUND = new THREE.Color(0x6f747a);
const COLOR_OVERCAST_FOG = new THREE.Color(0xb7c4d3);
const COLOR_STORM_FOG = new THREE.Color(0x6d7b8c);
const COLOR_MIST_FOG = new THREE.Color(0xcbd5df);
const COLOR_SNOW_FOG = new THREE.Color(0xdce5f0);
const COLOR_DAYLIGHT_GI_CLEAR = new THREE.Color(1.0, 0.98, 0.94);
const COLOR_DAYLIGHT_GI_OVERCAST = new THREE.Color(0.90, 0.95, 1.02);

/**
 * Evaluates Spencer/NOAA solar + Meeus Ch. 47 lunar ephemeris, 3D `(Season × TimeSlot × WeatherRegime)`
 * environment coordinates, location/season climate capabilities, continuous `0..100%` two-stage
 * cloud optical-depth extinction & penumbra/gobo modulation, cloud-gobo wind drift, ambient exterior
 * lux, and `SkyWeatherSnapshot` telemetry.
 */
export class AtmosphereEphemerisSolver {
  public currentMode: TimeOfDay = 'dusk';
  public activeHdrBucket: TimeOfDay = 'dusk';
  public isContinuousSolarMode = false;
  public liveClockSync = false;
  public seasonSelection: SeasonSelection = 'auto';
  public environmentInput: HouseEnvironmentInput | undefined;
  public climateInput: HouseClimateInput | undefined;
  public solarInput: Required<SolarDateTimeInput> = { ...CANONICAL_SOLAR_PRESETS.dusk };
  public latestSolar!: SolarPosition;
  public latestLunar!: LunarPosition;

  private location: HouseLocation;
  private hasExplicitLocation: boolean;
  private readonly cloudWindOffset = new THREE.Vector2(0, 0);
  private readonly dayPresetState: EnvLightingState = stateFromPreset(ENV_PRESETS.day);
  private readonly duskPresetState: EnvLightingState = stateFromPreset(ENV_PRESETS.dusk);
  private readonly nightPresetState: EnvLightingState = stateFromPreset(ENV_PRESETS.night);
  private readonly horizonScratch = new THREE.Color();
  private readonly colorScratch = new THREE.Color();

  public constructor(
    location?: HouseLocation,
    environment?: HouseEnvironmentInput,
    climate?: HouseClimateInput
  ) {
    this.hasExplicitLocation = Boolean(location);
    this.environmentInput = environment;
    this.climateInput = climate;
    this.location = location
      ? { ...location }
      : {
          lat: DEFAULT_HUS_LATITUDE_DEG,
          lon: DEFAULT_HUS_LONGITUDE_DEG,
          plusXTrueBearingDeg: DEFAULT_HUS_PLUS_X_BEARING_DEG,
        };
  }

  public getInitialLocation(): HouseLocation {
    return this.location;
  }

  public getEffectiveSeason(): Season {
    if (this.seasonSelection !== 'auto') {
      return this.seasonSelection;
    }
    const doy = this.latestSolar?.dayOfYear ?? this.solarInput.dayOfYear;
    return deriveSeasonFromDayOfYear(doy, this.location.lat);
  }

  public getEffectiveTimeSlot(): TimeSlot {
    if (!this.isContinuousSolarMode) {
      return this.currentMode;
    }
    if (
      !Number.isFinite(this.latestSolar?.altitudeDeg) ||
      !Number.isFinite(this.latestSolar?.azimuthFromNorthDeg)
    ) {
      return deriveTimeSlot(NaN, NaN, this.currentMode);
    }
    return resolveContinuousTimeSlotBlend(
      this.latestSolar.altitudeDeg,
      this.latestSolar.azimuthFromNorthDeg
    ).dominantTimeSlot;
  }

  public getClimateCapabilities(): HouseClimateCapabilities {
    return resolveClimateCapabilities({
      location: this.location,
      season: this.getEffectiveSeason(),
      environment: this.environmentInput,
      climate: this.climateInput,
    });
  }

  public getWeatherRegime(weather: WeatherController): WeatherRegime {
    const w = weather.getState();
    const caps = this.getClimateCapabilities();
    return deriveWeatherRegime({
      cloudEnabled: w.cloudEnabled,
      cloudCoverPct: w.cloudCoverPct,
      precipType: w.precipType,
      precipIntensity: w.precipIntensity,
      condition: w.condition,
      snowAllowed: caps.snowAllowedNow,
    });
  }

  public getEnvironmentQuery(weather: WeatherController): EnvironmentHdrQuery {
    return {
      season: this.getEffectiveSeason(),
      time: this.getEffectiveTimeSlot(),
      weather: this.getWeatherRegime(weather),
    };
  }

  public getContinuousEnvironmentBlend(
    weather: WeatherController
  ): ContinuousEnvironmentHdrBlend | undefined {
    if (!this.isContinuousSolarMode) {
      return undefined;
    }
    return resolveContinuousEnvironmentHdrBlend(
      this.environmentInput,
      this.getEffectiveSeason(),
      this.getWeatherRegime(weather),
      this.latestSolar.altitudeDeg,
      this.latestSolar.azimuthFromNorthDeg
    );
  }

  /**
   * Computes a representative `SolarDateTimeInput` for `(mode, season)` when `!isContinuousSolarMode`
   * so the HUD date & civil time match the selected season's real golden hour / daylight window.
   */
  public resolvePresetSolarInputForSeason(
    mode: TimeOfDay,
    weather: WeatherController
  ): Required<SolarDateTimeInput> {
    if (this.seasonSelection === 'auto') {
      return { ...CANONICAL_SOLAR_PRESETS[mode] };
    }
    const year = this.solarInput.year;
    const dayOfYear = canonicalDayOfYearForSeason(this.seasonSelection, this.location.lat);
    if (mode === 'night') {
      return { civilHour: 23.0, dayOfYear, year };
    }
    if (mode === 'day') {
      return {
        civilHour: this.seasonSelection === 'winter' ? 12.1 : 10.35,
        dayOfYear,
        year,
      };
    }
    const noonProbe = computeSolarPosition(
      12.0,
      dayOfYear,
      this.getEffectiveAstronomyOptions(weather, year)
    );
    const duskHour = Number.isFinite(noonProbe.sunsetHour)
      ? THREE.MathUtils.clamp(noonProbe.sunsetHour - 0.65, 14.5, 20.75)
      : CANONICAL_SOLAR_PRESETS.dusk.civilHour;
    return { civilHour: Number(duskHour.toFixed(2)), dayOfYear, year };
  }

  public currentNightFactor(): number {
    const alt = this.latestSolar.altitudeDeg;
    const rawNight = THREE.MathUtils.clamp((2.5 - alt) / 6.5, 0, 1);
    return rawNight * rawNight * (3 - 2 * rawNight);
  }

  public computeGoldenFactor(): number {
    const alt = this.latestSolar.altitudeDeg;
    const nightFactor = this.currentNightFactor();
    const goldenDist = Math.abs(alt - 8.0) / 14.0;
    const rawGolden = THREE.MathUtils.clamp(1.0 - goldenDist, 0, 1);
    return rawGolden * rawGolden * (3 - 2 * rawGolden) * (1 - nightFactor * 0.85);
  }

  public syncCloudGoboState(weather: WeatherController, sunDirection: THREE.Vector3): void {
    const coupling = weather.getAtmosphereCoupling();
    setCloudGoboUniforms(
      coupling.effCloudCover,
      this.currentNightFactor(),
      this.cloudWindOffset.x,
      this.cloudWindOffset.y,
      sunDirection
    );
  }

  public syncWeatherLightingContext(
    weather: WeatherController,
    sunDirection: THREE.Vector3
  ): void {
    weather.syncWithLighting({
      sunDirection,
      sunAltitudeDeg: this.latestSolar.altitudeDeg,
      goldenFactor: this.computeGoldenFactor(),
      nightFactor: this.currentNightFactor(),
    });
    this.syncCloudGoboState(weather, sunDirection);
  }

  /**
   * Modulates a base preset or continuous lighting state with continuous `0..100%`
   * two-stage cloud-to-lighting & sky coupling (no `0..35%` dead zone!).
   * Returns `fogClearRadiusM` for the `renderGroup` fog uniform.
   */
  public applyWeatherModulationToState(
    target: EnvLightingState,
    weather: WeatherController
  ): number {
    const coupling = weather.getAtmosphereCoupling();
    const { effCloudCover, rainDarkening, fogStrength, fogClearRadiusM, condition } = coupling;

    target.sunShadowIntensity = 1.0;
    target.sunShadowRadius = 1.0;
    target.daylightGiTint.copy(COLOR_DAYLIGHT_GI_CLEAR);
    if (effCloudCover <= 0.005 && rainDarkening <= 0.005 && fogStrength <= 0.005) {
      return fogClearRadiusM;
    }

    const weatherState = weather.getState();
    const precipScale =
      weatherState.precipType !== 'none'
        ? THREE.MathUtils.clamp(weatherState.precipIntensity, 0, 1)
        : 0;
    const stormDarkening = precipScale * rainDarkening;
    const manualFogScale = weatherState.fogEnabled
      ? THREE.MathUtils.clamp(weatherState.fogIntensity, 0, 1)
      : 0;

    const partlyBlend = THREE.MathUtils.smoothstep(effCloudCover, 0.04, 0.55);
    const overcastBlend = THREE.MathUtils.smoothstep(effCloudCover, 0.45, 0.96);
    const nightFactor = this.currentNightFactor();
    const dayScatterWeight = 1.0 - nightFactor;

    const giTransmittance = Math.max(
      0.30,
      1.0 -
        partlyBlend * 0.03 -
        overcastBlend * 0.10 -
        stormDarkening * 0.34 -
        manualFogScale * 0.15
    );
    target.daylightGiStrength *= giTransmittance;
    target.daylightGiTint.lerp(
      COLOR_DAYLIGHT_GI_OVERCAST,
      Math.min(1, partlyBlend * 0.25 + overcastBlend * 0.75)
    );

    const baseSunIntensity = target.sunIntensity;
    const cloudDirectTransmittance =
      effCloudCover >= 0.999
        ? 0.0
        : Math.pow(Math.max(0.0, 1.0 - Math.pow(effCloudCover, 1.78)), 1.75);
    const precipMistAtten = Math.max(
      0.0,
      (1.0 - stormDarkening * 0.48) * (1.0 - manualFogScale * 0.32)
    );
    const directSunAtten = cloudDirectTransmittance * precipMistAtten;
    target.sunIntensity = baseSunIntensity * directSunAtten;
    target.sunColor.lerp(
      COLOR_OVERCAST_SUN,
      Math.min(0.92, partlyBlend * 0.22 + overcastBlend * 0.66)
    );

    const penumbraCurve = Math.pow(THREE.MathUtils.smoothstep(effCloudCover, 0.02, 0.95), 1.15);
    target.sunShadowRadius = 1.0 + 27.0 * penumbraCurve + manualFogScale * 5.0;
    const midCloudShadowSoften = 1.0 - THREE.MathUtils.smoothstep(effCloudCover, 0.42, 0.94) * 0.34;
    const overcastShadowExtinction =
      effCloudCover >= 0.995 ? 0.0 : 1.0 - THREE.MathUtils.smoothstep(effCloudCover, 0.86, 0.995);
    target.sunShadowIntensity = midCloudShadowSoften * overcastShadowExtinction;

    const attenuatedDaySolarFlux =
      baseSunIntensity * (1.0 - cloudDirectTransmittance) * dayScatterWeight;
    const stormScatterAtten = Math.max(0.35, 1.0 - stormDarkening * 0.45 - manualFogScale * 0.15);
    const forwardScatteredHemi = attenuatedDaySolarFlux * 0.25 * stormScatterAtten;
    target.hemiIntensity =
      target.hemiIntensity * (1.0 - stormDarkening * 0.24) + forwardScatteredHemi;
    target.hemiSkyColor.lerp(
      COLOR_OVERCAST_SKY,
      Math.min(0.88, partlyBlend * 0.24 + overcastBlend * 0.60)
    );
    target.hemiGroundColor.lerp(
      COLOR_OVERCAST_GROUND,
      Math.min(0.50, partlyBlend * 0.12 + overcastBlend * 0.32)
    );

    const dryOvercastEnvLift =
      1.0 +
      (partlyBlend * 0.03 + overcastBlend * 0.05) * dayScatterWeight -
      overcastBlend * 0.10 * nightFactor;
    const envWeatherScale =
      dryOvercastEnvLift * (1.0 - stormDarkening * 0.34 - manualFogScale * 0.12);
    target.envIntensity *= Math.max(0.28, envWeatherScale);
    target.bgIntensity *= Math.max(
      0.34,
      1.0 -
        partlyBlend * 0.05 -
        overcastBlend * 0.16 -
        stormDarkening * 0.30 -
        manualFogScale * 0.14
    );
    const activeFogBlur = weatherState.fogEnabled ? fogStrength * 0.28 : 0;
    target.bgBlurriness = Math.min(0.48, target.bgBlurriness + activeFogBlur);

    target.fogColor.lerp(
      COLOR_OVERCAST_FOG,
      Math.min(0.82, partlyBlend * 0.18 + overcastBlend * 0.56)
    );
    if (condition === 'snow') {
      target.fogColor.lerp(COLOR_SNOW_FOG, Math.max(0.45, fogStrength * 0.75));
    } else if (stormDarkening > 0.12) {
      target.fogColor.lerp(COLOR_STORM_FOG, Math.min(0.8, stormDarkening * 0.85));
    } else if (manualFogScale > 0.05) {
      target.fogColor.lerp(COLOR_MIST_FOG, Math.min(0.75, manualFogScale * 0.75));
    }

    target.fogDensity =
      target.fogDensity +
      partlyBlend * 0.0004 +
      overcastBlend * 0.0012 +
      stormDarkening * 0.0065 +
      manualFogScale * 0.0145;

    return fogClearRadiusM;
  }

  /** Evaluates continuous solar + lunar ephemeris into `out` (anchored to `ENV_PRESETS` quality). */
  public computeContinuousSolarState(
    out: EnvLightingState,
    weather: WeatherController
  ): number {
    const solar = this.latestSolar;
    const lunar = this.latestLunar;
    const alt = solar.altitudeDeg;

    if (alt >= 14.0) {
      const tHigh = THREE.MathUtils.smoothstep(alt, 14.0, 36.0);
      lerpEnvState(this.duskPresetState, this.dayPresetState, tHigh, out);
      out.daylightGiStrength =
        this.dayPresetState.daylightGiStrength * THREE.MathUtils.smoothstep(alt, 18.0, 36.0);
      out.sunDirection.copy(solar.shadowLightVector);
      this.activeHdrBucket = tHigh >= 0.35 ? 'day' : 'dusk';
    } else if (alt >= -3.5) {
      const tTwil = THREE.MathUtils.smoothstep(alt, -3.5, 14.0);
      lerpEnvState(this.nightPresetState, this.duskPresetState, tTwil, out);
      const moonBlend = THREE.MathUtils.smoothstep(-alt, -0.5, 3.2);
      out.sunDirection
        .copy(solar.shadowLightVector)
        .lerp(lunar.shadowMoonVector, moonBlend)
        .normalize();
      this.activeHdrBucket = tTwil >= 0.3 ? 'dusk' : 'night';
    } else {
      copyEnvState(this.nightPresetState, out);
      out.sunDirection.copy(lunar.shadowMoonVector);
      const moonAbove = THREE.MathUtils.smoothstep(lunar.altitudeDeg, -1.5, 10.0);
      const phaseCurve = Math.pow(lunar.illuminatedFraction, 1.45);
      out.sunIntensity = 0.04 + 0.24 * moonAbove * phaseCurve;
      this.activeHdrBucket = 'night';
    }

    return this.applyWeatherModulationToState(out, weather);
  }

  private getCachedPresetState(mode: TimeOfDay): EnvLightingState {
    return mode === 'day'
      ? this.dayPresetState
      : mode === 'night'
        ? this.nightPresetState
        : this.duskPresetState;
  }

  public recomputeCurrentTargetState(
    out: EnvLightingState,
    weather: WeatherController
  ): number {
    if (this.isContinuousSolarMode) {
      return this.computeContinuousSolarState(out, weather);
    }
    this.activeHdrBucket = this.currentMode;
    copyEnvState(this.getCachedPresetState(this.currentMode), out);
    return this.applyWeatherModulationToState(out, weather);
  }

  public computeModulatedGroundHorizon(
    baseHorizon: THREE.Color,
    bgIntensity: number,
    weather: WeatherController
  ): THREE.Color {
    const horizon = this.horizonScratch.copy(baseHorizon);
    const coupling = weather.getAtmosphereCoupling();
    const overcastBlend = THREE.MathUtils.smoothstep(coupling.effCloudCover, 0.45, 0.95);
    if (overcastBlend > 0.01) {
      horizon.lerp(this.colorScratch.setHex(0x8896a6), overcastBlend * 0.35);
    }
    if (coupling.condition === 'snow') {
      horizon.lerp(this.colorScratch.setHex(0xc8d4e3), 0.55);
    } else if (weather.getState().precipType === 'rain' && coupling.rainDarkening > 0.1) {
      horizon.multiplyScalar(1.0 - coupling.rainDarkening * 0.35);
    }
    return horizon.multiplyScalar(bgIntensity);
  }

  /** True when cloud cover is active (`> 5%`) during daytime/twilight so gentle cloud-gobo drift can run. */
  public hasActiveCloudDrift(weather: WeatherController): boolean {
    const coupling = weather.getAtmosphereCoupling();
    return coupling.effCloudCover > 0.05 && this.currentNightFactor() < 0.95;
  }

  /**
   * Advances world-space cloud-gobo `windOffset` and synchronizes the 3D sky cumulus deck in lockstep.
   * Returns `true` when cloud cover `> 5%` moved `windOffset`.
   */
  public stepCloudDrift(
    dtSeconds: number,
    weather: WeatherController,
    sunDirection: THREE.Vector3
  ): boolean {
    if (!this.hasActiveCloudDrift(weather)) return false;
    const dt = Math.min(0.25, Math.max(0, dtSeconds));
    if (dt <= 0) return false;
    const state = weather.getState();
    const windDir = weather.getWindWorldDirection();
    const driftSpeedMps = THREE.MathUtils.clamp(state.windSpeedKph * 0.11, 0.9, 3.2);
    this.cloudWindOffset.x += windDir.x * driftSpeedMps * dt;
    this.cloudWindOffset.y += windDir.z * driftSpeedMps * dt;
    this.syncCloudGoboState(weather, sunDirection);
    weather.syncCloudDrift(this.cloudWindOffset.x, this.cloudWindOffset.y);
    return true;
  }

  public getLiveClockOptions(weather: WeatherController): {
    readonly timezone?: string;
    readonly utcOffsetSeconds?: number;
    readonly longitudeDeg?: number;
  } {
    const w = weather.getState();
    return {
      timezone:
        this.location.timezone ??
        w.timezone ??
        (this.hasExplicitLocation ? undefined : 'Europe/London'),
      utcOffsetSeconds: w.utcOffsetSeconds,
      longitudeDeg: this.location.lon,
    };
  }

  private getEffectiveAstronomyOptions(
    weather: WeatherController,
    yearOverride?: number
  ): SolarAstronomyOptions {
    const w = weather.getState();
    return {
      latitudeDeg: this.location.lat,
      longitudeDeg: this.location.lon,
      plusXTrueBearingDeg: this.getPlusXTrueBearingDeg(),
      year: yearOverride ?? this.solarInput.year,
      timezone:
        this.location.timezone ??
        w.timezone ??
        (this.hasExplicitLocation ? undefined : 'Europe/London'),
      utcOffsetSeconds: w.utcOffsetSeconds,
      timezoneAbbreviation: w.timezoneAbbreviation,
    };
  }

  public setLocationData(location: HouseLocation, weather: WeatherController): number {
    this.hasExplicitLocation = true;
    this.location = { ...location };
    weather.setLocation(this.location, false);
    if (this.liveClockSync) {
      this.solarInput = getCurrentSolarClockForLocation(this.getLiveClockOptions(weather));
    }
    return this.refreshEphemerisFromInput(weather);
  }

  public getLocation(): HouseLocation {
    return { ...this.location };
  }

  public getPlusXTrueBearingDeg(): number {
    return resolvePlusXTrueBearingDeg(this.location);
  }

  public refreshEphemerisFromInput(weather: WeatherController): number {
    const { civilHour, dayOfYear, year } = this.solarInput;
    const astroOpts = this.getEffectiveAstronomyOptions(weather, year);
    this.latestSolar = computeSolarPosition(civilHour, dayOfYear, astroOpts);
    this.latestLunar = computeLunarPosition(civilHour, dayOfYear, year, astroOpts);
    return Math.round(this.latestSolar.civilHour * 60);
  }

  /** Ambient exterior illuminance (lux) matching the current solar altitude & cloud attenuation (for KNX lux bridge). */
  public getComputedAmbientLux(weather: WeatherController): number {
    const coupling = weather.getAtmosphereCoupling();
    if (!this.isContinuousSolarMode && this.currentMode === 'dusk') {
      const duskAtten = Math.max(
        0.55,
        1.0 - coupling.effCloudCover * 0.35 - coupling.rainDarkening * 0.25
      );
      return Math.round(Math.max(20, 38 * duskAtten));
    }
    const alt = this.latestSolar.altitudeDeg;
    if (alt < -3.0) {
      return 5;
    }
    const cloudAtten = Math.max(
      0.14,
      1.0 -
        coupling.effCloudCover * 0.56 -
        coupling.rainDarkening * 0.30 -
        coupling.fogStrength * 0.14
    );
    const tTwil = THREE.MathUtils.clamp((alt + 3.0) / 17.0, 0, 1);
    const twilightBase = 16 + Math.pow(tTwil, 1.35) * 178;
    const daySolar = 980 * Math.sin((Math.min(78, Math.max(0, alt)) * Math.PI) / 180);
    const dayBlend = THREE.MathUtils.smoothstep(alt, 14.0, 16.0);
    const clearLux = twilightBase * (1 - dayBlend) + daySolar * dayBlend;
    return Math.round(Math.max(5, clearLux * cloudAtten));
  }

  public buildSkyWeatherSnapshot(
    weather: WeatherController,
    activeHdrCellKey?: string
  ): SkyWeatherSnapshot {
    const {
      civilHour,
      dayOfYear,
      year,
      utcOffsetHours,
      timezone,
      timezoneAbbreviation,
      equationOfTimeMin,
      apparentSolarHour,
      solarNoonHour,
      sunriseHour,
      sunsetHour,
      dayLengthHours,
      declinationDeg,
      altitudeDeg,
      azimuthFromNorthDeg,
      isAfterSunset,
      trueSunDirection,
      shadowLightDirection,
    } = this.latestSolar;
    const {
      altitudeDeg: moonAlt,
      azimuthFromNorthDeg: moonAz,
      illuminatedFraction,
      synodicPhaseDeg,
      isWaxing,
      lunarAgeDays,
      phaseName,
      trueMoonDirection,
      shadowMoonDirection,
    } = this.latestLunar;
    const weatherState = weather.getState();
    const spec = normalizeEnvironmentHdrSpec(this.environmentInput);
    const season = this.getEffectiveSeason();
    const timeSlot = this.getEffectiveTimeSlot();
    const climate = this.getClimateCapabilities();
    const weatherRegime = deriveWeatherRegime({
      cloudEnabled: weatherState.cloudEnabled,
      cloudCoverPct: weatherState.cloudCoverPct,
      precipType: weatherState.precipType,
      precipIntensity: weatherState.precipIntensity,
      condition: weatherState.condition,
      snowAllowed: climate.snowAllowedNow,
    });
    return {
      timeOfDay: this.currentMode,
      liveClockSync: this.liveClockSync,
      plusXTrueBearingDeg: this.getPlusXTrueBearingDeg(),
      locationLabel: this.location.label,
      latitudeDeg: this.location.lat,
      longitudeDeg: this.location.lon,
      elevationM: weatherState.elevationM ?? this.location.elevationM,
      season,
      seasonSelection: this.seasonSelection,
      timeSlot,
      weatherRegime,
      environmentId: spec.id,
      activeHdrCellKey,
      climate,
      solar: {
        civilHour,
        dayOfYear,
        year,
        utcOffsetHours,
        timezone,
        timezoneAbbreviation,
        equationOfTimeMin,
        apparentSolarHour,
        solarNoonHour,
        sunriseHour,
        sunsetHour,
        dayLengthHours,
        declinationDeg,
        altitudeDeg,
        azimuthFromNorthDeg,
        isAfterSunset,
        trueSunDirection,
        shadowLightDirection,
      },
      lunar: {
        altitudeDeg: moonAlt,
        azimuthFromNorthDeg: moonAz,
        illuminatedFraction,
        synodicPhaseDeg,
        isWaxing,
        lunarAgeDays,
        phaseName,
        trueMoonDirection,
        shadowMoonDirection,
      },
      weather: weatherState,
    };
  }
}
