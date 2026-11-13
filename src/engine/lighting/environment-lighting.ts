import * as THREE from 'three';
import type { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import {
  float,
  fog,
  length,
  max,
  positionWorld,
  renderGroup,
  uniform,
  vec2,
} from 'three/tsl';
import type { WebGPURenderer } from 'three/webgpu';
import type { TerrainSurfaceSampler } from '../../core/geo/terrain-modifiers.ts';
import type {
  AcousticOcclusionState,
  NormalizedSoundscapeDescriptor,
  SoundscapeDescriptor,
} from '../../core/types/acoustics.ts';
import {
  canonicalDayOfYearForSeason,
  resolveSeasonalGroundStyle,
  type HouseClimateInput,
  type HouseEnvironmentHdrSpec,
  type HouseEnvironmentInput,
  type SeasonSelection,
} from '../../core/types/environment-hdri.ts';
import type { TimeOfDay } from '../../core/types/scene.ts';
import type {
  HouseLocation,
  SkyWeatherSnapshot,
  SolarDateTimeInput,
} from '../../core/types/solar-weather.ts';
import {
  shortestDayOfYearDelta,
  wrapDayOfYear,
} from '../../core/geo/climate-phenology.ts';
import { SoundscapeController } from '../audio/soundscape-controller.ts';
import { VegetationPhenologyController } from '../vegetation/vegetation-uniforms.ts';
import {
  AtmosphereEphemerisSolver,
  MODE_TO_MINUTES,
} from './env/atmosphere-ephemeris-solver.ts';
import {
  DirectionalShadowController,
  type ShadowFrustumDiagnostics,
} from './env/directional-shadow-controller.ts';
import { CANONICAL_SOLAR_PRESETS, ENV_PRESETS } from './env/env-presets.ts';
import {
  copyEnvState,
  lerpEnvState,
  stateFromPreset,
  type EnvLightingState,
} from './env/env-state.ts';
import { HdrEnvironmentManager, type PmremTarget } from './env/hdr-environment-manager.ts';
import { createSiteGround, type SiteGround } from './env/site-ground.ts';
import { DEFAULT_SITE_HAZE_FOOTPRINT } from './env/site-haze-fog.ts';
import { getCurrentSolarClockForLocation } from './env/solar-astronomy.ts';
import { WeatherController } from './env/weather-controller.ts';
import {
  installShaderLightCulling,
  setSunShadowPenumbraUniforms,
} from './shader-light-culling.ts';

export type { ShadowFrustumDiagnostics };

/** Duration (ms) of the eased cross-fade between time-of-day presets. */
const TRANSITION_MS = 900;
const SEASON_EASE_MS = 750;

/**
 * Interval (ms) between real-time local solar clock evaluations in `liveClockSync` mode.
 * Updating cleanly every 30s keeps idle GPU frames at `0 / 300` (`0%` wakeup) between ticks!
 */
const LIVE_SOLAR_TICK_MS = 30_000;

/**
 * Sky / astronomical sun & moon / 3D `(Season × TimeSlot × WeatherRegime)` HDR PMREM IBL /
 * exposure / haze / composable global weather.
 *
 * Facade coordinating `HdrEnvironmentManager`, `DirectionalShadowController`,
 * `AtmosphereEphemerisSolver`, `WeatherController`, `SiteGround`, and `AmbientSoundscape`.
 */
export class EnvironmentLighting {
  public currentMinutes: number = MODE_TO_MINUTES.dusk;
  public readonly weather: WeatherController;
  public readonly vegetationPhenology = new VegetationPhenologyController();

  private readonly scene: THREE.Scene;
  private readonly hemiLight: THREE.HemisphereLight;
  private readonly sunLight: THREE.DirectionalLight;
  private readonly ground?: SiteGround;
  private readonly onEnvUpdated?: (invalidateShadows?: boolean) => void;
  private readonly renderer?: WebGPURenderer;
  private readonly uFogColor = uniform(new THREE.Color(ENV_PRESETS.dusk.fogColor)).setGroup(renderGroup);
  private readonly uFogDensity = uniform(ENV_PRESETS.dusk.fogDensity).setGroup(renderGroup);
  private readonly uFogClearRadius = uniform(DEFAULT_SITE_HAZE_FOOTPRINT.radius).setGroup(renderGroup);

  private readonly hdrManager: HdrEnvironmentManager;
  private readonly shadowController: DirectionalShadowController;
  private readonly solver: AtmosphereEphemerisSolver;
  private readonly ambientSoundscape = new SoundscapeController();
  private readonly skyListeners = new Set<(snapshot: SkyWeatherSnapshot) => void>();

  private disposed = false;
  private hasAppliedMode = false;
  private liveClockTimer: ReturnType<typeof setInterval> | null = null;
  private lastSolarScrubMs = -10_000;
  private readonly state: EnvLightingState = stateFromPreset(ENV_PRESETS.dusk);
  private readonly transitionFrom: EnvLightingState = stateFromPreset(ENV_PRESETS.dusk);
  private readonly transitionTo: EnvLightingState = stateFromPreset(ENV_PRESETS.dusk);
  private transitioning = false;
  private transitionElapsedMs = 0;
  private lastTransitionShadowMs = -1000;
  private seasonEasing = false;
  private seasonEaseElapsedMs = 0;
  private seasonEaseFromDoy = 172;
  private seasonEaseDeltaDoy = 0;
  private seasonEaseFromHour = 12;
  private seasonEaseToHour = 12;
  private lastSeasonShadowMs = -1000;
  private hdrClockMs = 0;

  private buildHdrApplyOptions(animate: boolean) {
    return {
      query: this.solver.getEnvironmentQuery(this.weather),
      continuousBlend: this.solver.getContinuousEnvironmentBlend(this.weather),
      plusXTrueBearingDeg: this.solver.getPlusXTrueBearingDeg(),
      animate,
      nowMs: this.hdrClockMs,
    };
  }

  /** Creates the hemisphere + shadow-casting sun lights + site ground, haze, and weather layers. */
  public constructor(
    scene: THREE.Scene,
    renderer?: WebGPURenderer,
    onEnvUpdated?: (invalidateShadows?: boolean) => void,
    location?: HouseLocation,
    terrainSampler?: Pick<TerrainSurfaceSampler, 'sampleTerrainY' | 'sampleCarvedMeshY' | 'sampleNormal'>,
    environment?: HouseEnvironmentInput,
    climate?: HouseClimateInput
  ) {
    this.scene = scene;
    this.renderer = renderer;
    this.onEnvUpdated = onEnvUpdated;
    this.solver = new AtmosphereEphemerisSolver(location, environment, climate);

    installShaderLightCulling();

    this.hemiLight = new THREE.HemisphereLight(0xdcd8ce, 0x3d352e, 0.1);
    scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xffdfba, 1.0);
    this.sunLight.userData = { ...this.sunLight.userData, cloudGobo: true };
    scene.add(this.sunLight.target);
    this.shadowController = new DirectionalShadowController(this.sunLight, renderer);
    scene.add(this.sunLight);

    this.hdrManager = new HdrEnvironmentManager({
      scene,
      renderer,
      environment,
      bakeEquirectPmrem: (r, eq) => this.bakeEquirectPmremTarget(r, eq),
      onApplyIntensities: () => this.applyIntensities(),
      onEnvUpdated,
    });

    const prevWeatherSunDir = new THREE.Vector3();
    this.weather = new WeatherController({
      location: this.solver.getInitialLocation(),
      onWeatherChanged: () => {
        if (this.disposed) return;
        prevWeatherSunDir.copy(this.state.sunDirection);
        const wasTransitioning = this.transitioning;
        this.cancelTransition();
        if (this.solver.liveClockSync) {
          this.solver.solarInput = getCurrentSolarClockForLocation(
            this.solver.getLiveClockOptions(this.weather)
          );
        }
        this.currentMinutes = this.solver.refreshEphemerisFromInput(this.weather);
        this.syncClimateSnowAllowance();
        this.uFogClearRadius.value = this.solver.recomputeCurrentTargetState(
          this.state,
          this.weather
        );
        const sunMoved =
          wasTransitioning ||
          prevWeatherSunDir.distanceToSquared(this.state.sunDirection) > 1e-8;
        const needsShadowCatchUp =
          this.shadowController.isStaleWhileExtinct() && this.hasActiveSunShadow();
        const shouldBakeShadow = (sunMoved || needsShadowCatchUp) && this.hasActiveSunShadow();
        this.hdrManager.applyEnvironmentTextures(
          this.solver.activeHdrBucket,
          this.state.sunDirection,
          this.state.fogColor,
          this.buildHdrApplyOptions(this.hasAppliedMode && Boolean(this.renderer))
        );
        this.applyState(shouldBakeShadow);
        this.solver.syncWeatherLightingContext(this.weather, this.state.sunDirection);
        this.emitSkySnapshot();
        this.onEnvUpdated?.(shouldBakeShadow);
      },
    });
    this.currentMinutes = this.solver.refreshEphemerisFromInput(this.weather);
    this.syncClimateSnowAllowance();
    this.weather.attachScene(scene);

    if (renderer) {
      const fogOffset = positionWorld.xz.sub(
        vec2(DEFAULT_SITE_HAZE_FOOTPRINT.centerX, DEFAULT_SITE_HAZE_FOOTPRINT.centerZ)
      );
      const fogDepth = max(float(0), length(fogOffset).sub(this.uFogClearRadius));
      const fogFactor = this.uFogDensity
        .mul(this.uFogDensity)
        .mul(fogDepth)
        .mul(fogDepth)
        .negate()
        .exp()
        .oneMinus();
      scene.fogNode = fog(this.uFogColor, fogFactor);
      if (terrainSampler) {
        this.weather.setTerrainSampler(terrainSampler.sampleTerrainY);
      }
      this.ground = createSiteGround(undefined, terrainSampler);
      scene.add(this.ground.mesh);
    }

    this.solver.syncWeatherLightingContext(this.weather, this.state.sunDirection);
    this.syncVegetationPhenology(false, 0);
  }

  /**
   * Synchronizes `weather.setSnowAllowed` with the resolved location & season climate capabilities.
   * Automatically clamps active snow to `0` if switching to a non-winter season or warm climate.
   */
  private syncClimateSnowAllowance(): boolean {
    const caps = this.solver.getClimateCapabilities();
    return this.weather.setSnowAllowed(caps.snowAllowedNow, true);
  }

  // Preserved private test-hook bridges for `env.test.ts` instance monkey-patching.
  private bakeEquirectPmremTarget(
    renderer: WebGPURenderer,
    equirect: THREE.Texture
  ): PmremTarget {
    return this.hdrManager.defaultBakeEquirectPmremTarget(renderer, equirect);
  }

  // @ts-expect-error Preserved private accessor bridge for `env.test.ts` mock `hdrLoader` injection.
  private get hdrLoader(): HDRLoader | null {
    return this.hdrManager.hdrLoader;
  }

  private set hdrLoader(loader: HDRLoader | null) {
    this.hdrManager.hdrLoader = loader;
  }

  public getSiteGround(): SiteGround | undefined {
    return this.ground;
  }

  public collectDynamicObjects(target: Set<THREE.Object3D>): void {
    target.add(this.sunLight);
    target.add(this.sunLight.target);
    target.add(this.hemiLight);
    if (this.ground) {
      target.add(this.ground.mesh);
    }
  }

  public getBakedProceduralSkyCount(): number {
    return this.hdrManager.getBakedProceduralSkyCount();
  }

  public getRequestedHdrCount(): number {
    return this.hdrManager.getRequestedHdrCount();
  }

  public bakeProceduralEnvironments(
    renderer: WebGPURenderer | undefined = this.renderer,
    options?: { readonly deferHdr?: boolean }
  ): void {
    const baked = this.hdrManager.bakeProceduralEnvironments(
      renderer,
      this.solver.activeHdrBucket,
      this.state.sunDirection,
      this.state.fogColor,
      {
        ...options,
        query: this.solver.getEnvironmentQuery(this.weather),
        continuousBlend: this.solver.getContinuousEnvironmentBlend(this.weather),
        plusXTrueBearingDeg: this.solver.getPlusXTrueBearingDeg(),
      }
    );
    if (baked) {
      this.applyState();
    }
  }

  public startDeferredHdrUpgrade(): void {
    this.hdrManager.startDeferredHdrUpgrade(this.solver.getEnvironmentQuery(this.weather));
  }

  public async preloadActiveHdr(renderer?: WebGPURenderer): Promise<void> {
    await this.hdrManager.preloadActiveHdr(
      renderer,
      this.solver.activeHdrBucket,
      this.state.sunDirection,
      this.state.fogColor,
      this.shadowController.isInteractiveScrubShadow(),
      this.solver.getEnvironmentQuery(this.weather)
    );
  }

  public getRetainedEnvironmentTextures(): THREE.Texture[] {
    return this.hdrManager.getRetainedEnvironmentTextures();
  }

  public async withEachEnvironmentBucketForCompile(
    compileStep: (mode: TimeOfDay) => Promise<void>
  ): Promise<void> {
    await this.hdrManager.withEachEnvironmentBucketForCompile(
      this.solver.activeHdrBucket,
      this.state.sunDirection,
      this.state.fogColor,
      () => this.applyState(false),
      compileStep,
      this.solver.getEnvironmentQuery(this.weather)
    );
  }

  public flushPendingHdrBakes(): boolean {
    return this.hdrManager.flushPendingHdrBakes(
      this.solver.activeHdrBucket,
      this.state.sunDirection,
      this.state.fogColor,
      this.shadowController.isInteractiveScrubShadow(),
      this.solver.getEnvironmentQuery(this.weather)
    );
  }

  /** True when direct sun/moon intensity and shadow intensity are non-zero (false at 100% overcast). */
  public hasActiveSunShadow(): boolean {
    return this.state.sunIntensity > 0.001 && this.state.sunShadowIntensity > 0.001;
  }

  private applyState(updateShadowMap = true): void {
    const s = this.state;
    this.hemiLight.intensity = s.hemiIntensity;
    this.hemiLight.color.copy(s.hemiSkyColor);
    this.hemiLight.groundColor.copy(s.hemiGroundColor);

    this.solver.syncCloudGoboState(this.weather, s.sunDirection);
    this.sunLight.intensity = s.sunIntensity;
    this.sunLight.color.copy(s.sunColor);
    this.sunLight.shadow.intensity = s.sunShadowIntensity;
    this.sunLight.shadow.radius = s.sunShadowRadius;
    setSunShadowPenumbraUniforms(s.sunShadowRadius, this.shadowController.getShadowMapSize());
    const hasShadow = this.hasActiveSunShadow();
    const needsShadowAttempt = updateShadowMap || this.shadowController.isStaleWhileExtinct();
    const shouldBake = needsShadowAttempt && hasShadow;
    if (needsShadowAttempt && !hasShadow) {
      this.shadowController.markStaleWhileExtinct();
    }
    this.shadowController.placeSun(s.sunDirection, shouldBake, hasShadow);

    this.uFogColor.value.copy(s.fogColor);
    this.uFogDensity.value = s.fogDensity;
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.copy(s.fogColor);
    }

    if (this.renderer) {
      this.renderer.toneMappingExposure = s.exposure;
    }
    this.applyIntensities();
  }

  private applyIntensities(): void {
    this.scene.environmentIntensity = this.state.envIntensity;
    this.scene.backgroundIntensity = this.state.bgIntensity;
    const bgIsEquirect = this.hdrManager.hasEquirectBackground();
    this.scene.backgroundBlurriness = bgIsEquirect ? 0 : this.state.bgBlurriness;
    if (this.ground) {
      const baseHorizon = this.hdrManager.getActiveHorizonGround(this.solver.activeHdrBucket);
      this.ground.setHorizonColor(
        this.solver.computeModulatedGroundHorizon(
          baseHorizon,
          this.state.bgIntensity,
          this.weather
        )
      );
      const caps = this.solver.getClimateCapabilities();
      const weatherState = this.weather.getState();
      const seasonalStyle = resolveSeasonalGroundStyle({
        season: this.solver.getEffectiveSeason(),
        weather: this.solver.getWeatherRegime(this.weather),
        climateZone: caps.zone,
        precipIntensity: weatherState.precipIntensity,
      });
      this.ground.setSeasonalStyle(seasonalStyle.tintRgb, seasonalStyle.snowCover);
    }
    this.syncVegetationPhenology(this.weather.isAnimating(), 0);
  }
  private syncVegetationPhenology(windAnimating = false, dtSeconds = 0): void {
    const loc = this.solver.getLocation();
    const caps = this.solver.getClimateCapabilities();
    const w = this.weather.getState();
    const weatherRegime = this.solver.getWeatherRegime(this.weather);
    const effectiveSeason = this.solver.getEffectiveSeason();
    const snowAmount =
      caps.zone !== 'warm' && effectiveSeason === 'winter' && weatherRegime === 'snow'
        ? THREE.MathUtils.clamp(0.45 + 0.55 * w.precipIntensity, 0, 1)
        : 0;
    const rainWetness = THREE.MathUtils.clamp(
      Math.max(w.surfaceWetness ?? 0, w.precipType === 'rain' ? w.precipIntensity * 0.85 : 0),
      0,
      1
    );
    const doy = this.solver.latestSolar?.dayOfYear ?? this.solver.solarInput.dayOfYear;
    const climateOverride =
      typeof this.solver.climateInput === 'string' ? undefined : loc.climateOverride;
    this.vegetationPhenology.syncFromEnvironment({
      location: climateOverride ? { ...loc, climateOverride } : loc,
      dayOfYear: doy,
      snowAmount,
      rainWetness,
      windSpeedKph: w.windSpeedKph,
      windDirDeg: w.windDirDeg,
      windAnimating,
      dtSeconds,
    });
  }

  public updateShadowFrustumForCamera(
    cameraTarget: THREE.Vector3,
    cameraDistanceM: number,
    isWalkthrough = false
  ): boolean {
    return this.shadowController.updateShadowFrustumForCamera(
      cameraTarget,
      cameraDistanceM,
      isWalkthrough,
      this.state.sunDirection,
      this.hasActiveSunShadow(),
      (x, z) => this.weather.setCloudAnchorXZ(x, z)
    );
  }

  public getShadowFrustumDiagnostics(): ShadowFrustumDiagnostics {
    return this.shadowController.getShadowFrustumDiagnostics();
  }

  public flushShadowUpdate(): void {
    this.shadowController.flushShadowUpdate(this.hasActiveSunShadow());
  }

  public getShadowMapSize(): 1024 | 2048 | 4096 {
    return this.shadowController.getShadowMapSize();
  }

  public setShadowMapSize(size: 1024 | 2048 | 4096): void {
    this.shadowController.setShadowMapSize(
      size,
      this.state.sunDirection,
      this.state.sunShadowRadius,
      this.hasActiveSunShadow()
    );
  }

  public setInteractiveScrubShadow(active: boolean): void {
    this.shadowController.setInteractiveScrubShadow(active);
  }

  public isInteractiveScrubShadow(): boolean {
    return this.shadowController.isInteractiveScrubShadow();
  }

  public hasActiveCloudDrift(): boolean {
    return this.solver.hasActiveCloudDrift(this.weather);
  }

  public stepCloudDrift(dtSeconds: number): boolean {
    return this.solver.stepCloudDrift(dtSeconds, this.weather, this.state.sunDirection);
  }

  public getTimeOfDay(): TimeOfDay {
    return this.solver.currentMode;
  }

  public getEnvironment(): HouseEnvironmentHdrSpec {
    return this.hdrManager.getEnvironmentSpec();
  }

  public setEnvironment(
    environment?: HouseEnvironmentInput,
    options?: { readonly animate?: boolean }
  ): SkyWeatherSnapshot {
    this.solver.environmentInput = environment;
    this.hdrManager.setEnvironmentSpec(environment);
    this.syncClimateSnowAllowance();
    if (this.hasAppliedMode) {
      this.uFogClearRadius.value = this.solver.recomputeCurrentTargetState(
        this.state,
        this.weather
      );
      const shouldAnimate = (options?.animate ?? true) && Boolean(this.renderer);
      this.hdrManager.applyEnvironmentTextures(
        this.solver.activeHdrBucket,
        this.state.sunDirection,
        this.state.fogColor,
        this.buildHdrApplyOptions(shouldAnimate)
      );
      this.applyState(false);
      this.solver.syncWeatherLightingContext(this.weather, this.state.sunDirection);
      this.onEnvUpdated?.(false);
    }
    const snap = this.getSkyWeatherSnapshot();
    this.emitSkySnapshot(snap);
    return snap;
  }

  public setClimate(climate?: HouseClimateInput): SkyWeatherSnapshot {
    this.solver.climateInput = climate;
    this.syncClimateSnowAllowance();
    if (this.hasAppliedMode) {
      this.uFogClearRadius.value = this.solver.recomputeCurrentTargetState(
        this.state,
        this.weather
      );
      this.hdrManager.applyEnvironmentTextures(
        this.solver.activeHdrBucket,
        this.state.sunDirection,
        this.state.fogColor,
        this.buildHdrApplyOptions(Boolean(this.renderer))
      );
      this.applyState(false);
      this.solver.syncWeatherLightingContext(this.weather, this.state.sunDirection);
      this.onEnvUpdated?.(false);
    }
    const snap = this.getSkyWeatherSnapshot();
    this.emitSkySnapshot(snap);
    return snap;
  }

  public getSeasonSelection(): SeasonSelection {
    return this.solver.seasonSelection;
  }

  /**
   * Sets the explicit season (`'auto' | 'spring' | 'summer' | 'autumn' | 'winter'`), updating
   * solar declination/date, clamping snow if switching out of winter, and lazily loading the
   * matching seasonal `.hdr` panorama cell.
   */
  public setSeason(
    selection: SeasonSelection,
    options?: { readonly animate?: boolean }
  ): SkyWeatherSnapshot {
    const prevSunDir = this.state.sunDirection.clone();
    const prevDoy = this.solver.latestSolar?.dayOfYear ?? this.solver.solarInput.dayOfYear;
    const prevHour = this.solver.solarInput.civilHour;
    this.solver.seasonSelection = selection;

    let targetInput = this.solver.solarInput;
    if (selection !== 'auto') {
      this.setLiveClockSyncInternal(false);
      if (this.solver.isContinuousSolarMode) {
        const doy = canonicalDayOfYearForSeason(selection, this.solver.getLocation().lat);
        targetInput = {
          civilHour: this.solver.solarInput.civilHour,
          dayOfYear: doy,
          year: this.solver.solarInput.year,
        };
      } else {
        targetInput = this.solver.resolvePresetSolarInputForSeason(
          this.solver.currentMode,
          this.weather
        );
      }
    } else if (!this.solver.isContinuousSolarMode) {
      targetInput = { ...CANONICAL_SOLAR_PRESETS[this.solver.currentMode] };
    }

    const canAnimate =
      (options?.animate ?? true) && this.hasAppliedMode && Boolean(this.renderer);
    const doyDelta = shortestDayOfYearDelta(prevDoy, targetInput.dayOfYear);

    if (canAnimate && selection !== 'auto' && Math.abs(doyDelta) > 0.25) {
      this.seasonEasing = true;
      this.seasonEaseElapsedMs = 0;
      this.seasonEaseFromDoy = prevDoy;
      this.seasonEaseDeltaDoy = doyDelta;
      this.seasonEaseFromHour = prevHour;
      this.seasonEaseToHour = targetInput.civilHour;
      this.lastSeasonShadowMs = -1000;
      this.solver.solarInput = {
        civilHour: prevHour,
        dayOfYear: prevDoy,
        year: targetInput.year,
      };
    } else {
      this.seasonEasing = false;
      this.solver.solarInput = targetInput;
    }

    this.currentMinutes = this.solver.refreshEphemerisFromInput(this.weather);
    this.syncClimateSnowAllowance();

    if (this.solver.isContinuousSolarMode) {
      const alt = this.solver.latestSolar.altitudeDeg;
      this.solver.currentMode = alt >= 12.0 ? 'day' : alt >= -3.0 ? 'dusk' : 'night';
    }

    this.hasAppliedMode = true;
    this.transitioning = false;
    this.uFogClearRadius.value = this.solver.recomputeCurrentTargetState(this.state, this.weather);
    const sunMoved = prevSunDir.distanceToSquared(this.state.sunDirection) > 1e-8;
    const bakeShadow = sunMoved && this.hasActiveSunShadow();
    if (sunMoved && !this.hasActiveSunShadow()) {
      this.shadowController.markStaleWhileExtinct();
    }

    this.hdrManager.applyEnvironmentTextures(
      this.solver.activeHdrBucket,
      this.state.sunDirection,
      this.state.fogColor,
      this.buildHdrApplyOptions(canAnimate)
    );
    this.applyState(bakeShadow);
    this.solver.syncWeatherLightingContext(this.weather, this.state.sunDirection);
    this.onEnvUpdated?.(bakeShadow);
    const snap = this.getSkyWeatherSnapshot();
    this.emitSkySnapshot(snap);
    return snap;
  }

  public setLocation(location: HouseLocation): void {
    this.currentMinutes = this.solver.setLocationData(location, this.weather);
    this.syncClimateSnowAllowance();
    if (this.hasAppliedMode) {
      const prevSunDir = this.state.sunDirection.clone();
      this.cancelTransition();
      this.uFogClearRadius.value = this.solver.recomputeCurrentTargetState(
        this.state,
        this.weather
      );
      const sunMoved = prevSunDir.distanceToSquared(this.state.sunDirection) > 1e-8;
      const bakeShadow = sunMoved && this.hasActiveSunShadow();
      this.hdrManager.applyEnvironmentTextures(
        this.solver.activeHdrBucket,
        this.state.sunDirection,
        this.state.fogColor,
        this.buildHdrApplyOptions(false)
      );
      this.applyState(bakeShadow);
      this.solver.syncWeatherLightingContext(this.weather, this.state.sunDirection);
      this.onEnvUpdated?.(bakeShadow);
    } else {
      this.solver.syncWeatherLightingContext(this.weather, this.state.sunDirection);
    }
    this.emitSkySnapshot();
  }

  public getLocation(): HouseLocation {
    return this.solver.getLocation();
  }

  public getPlusXTrueBearingDeg(): number {
    return this.solver.getPlusXTrueBearingDeg();
  }

  /** Immediately applies the current or specified time-of-day textures and state without transition. */
  public applyTimeOfDay(modeOrMinutes?: TimeOfDay | number, _scene?: THREE.Scene): void {
    if (modeOrMinutes === 'day' || modeOrMinutes === 'dusk' || modeOrMinutes === 'night') {
      this.setLiveClockSyncInternal(false);
      this.solver.isContinuousSolarMode = false;
      this.solver.currentMode = modeOrMinutes;
      this.solver.solarInput = this.solver.resolvePresetSolarInputForSeason(
        modeOrMinutes,
        this.weather
      );
      this.currentMinutes = this.solver.refreshEphemerisFromInput(this.weather);
      this.syncClimateSnowAllowance();
    } else if (typeof modeOrMinutes === 'number' && Number.isFinite(modeOrMinutes)) {
      this.currentMinutes = modeOrMinutes;
    }
    this.hasAppliedMode = true;
    this.cancelTransition();
    this.uFogClearRadius.value = this.solver.recomputeCurrentTargetState(this.state, this.weather);
    this.hdrManager.applyEnvironmentTextures(
      this.solver.activeHdrBucket,
      this.state.sunDirection,
      this.state.fogColor,
      this.buildHdrApplyOptions(false)
    );
    this.applyState();
    this.solver.syncWeatherLightingContext(this.weather, this.state.sunDirection);
    this.emitSkySnapshot();
  }

  /** Switches to a canonical time-of-day preset (`day` | `dusk` | `night`) with smooth cross-fade. */
  public setTimeOfDay(mode: TimeOfDay, options?: { readonly animate?: boolean }): void {
    this.setLiveClockSyncInternal(false);
    this.solver.isContinuousSolarMode = false;
    this.solver.currentMode = mode;
    this.solver.solarInput = this.solver.resolvePresetSolarInputForSeason(mode, this.weather);
    this.currentMinutes = this.solver.refreshEphemerisFromInput(this.weather);
    this.syncClimateSnowAllowance();

    const target = stateFromPreset(ENV_PRESETS[mode]);
    this.uFogClearRadius.value = this.solver.applyWeatherModulationToState(target, this.weather);
    this.solver.activeHdrBucket = mode;

    const canAnimate = (options?.animate ?? true) && this.hasAppliedMode && !!this.renderer;
    this.hasAppliedMode = true;
    this.transitioning = false;

    if (!canAnimate) {
      this.hdrManager.cancelHdrTransition();
      copyEnvState(target, this.state);
      this.hdrManager.applyEnvironmentTextures(
        mode,
        target.sunDirection,
        target.fogColor,
        this.buildHdrApplyOptions(false)
      );
      this.applyState();
      this.solver.syncWeatherLightingContext(this.weather, this.state.sunDirection);
      this.emitSkySnapshot();
      return;
    }

    copyEnvState(this.state, this.transitionFrom);
    copyEnvState(target, this.transitionTo);
    this.transitioning = true;
    this.transitionElapsedMs = 0;
    this.lastTransitionShadowMs = -1000;
    this.hdrManager.applyEnvironmentTextures(
      mode,
      target.sunDirection,
      target.fogColor,
      this.buildHdrApplyOptions(true)
    );
    this.solver.syncWeatherLightingContext(this.weather, this.state.sunDirection);
    this.emitSkySnapshot();
    this.stepTransition(0);
  }

  /** Continuously positions the Sun and Moon using Spencer/NOAA + Meeus Ch. 47 ephemeris. */
  public setSolarDateTime(
    input: SolarDateTimeInput,
    options: {
      readonly keepLiveSync?: boolean;
      readonly updateShadowMap?: boolean;
      readonly suppressEnvCallback?: boolean;
    } = {}
  ): SkyWeatherSnapshot {
    if (!options.keepLiveSync) {
      this.setLiveClockSyncInternal(false);
    }
    const year = input.year ?? this.solver.solarInput.year;
    const normHour = ((input.civilHour % 24.0) + 24.0) % 24.0;
    const clampedDay = Math.max(1, Math.min(366, input.dayOfYear));
    const dayChanged = Math.abs(clampedDay - this.solver.solarInput.dayOfYear) > 1e-4;
    if (dayChanged && this.solver.seasonSelection !== 'auto') {
      // Scrubbing the calendar date slider returns season tracking to calendar-derived 'auto'
      this.solver.seasonSelection = 'auto';
    }
    this.solver.solarInput = { civilHour: normHour, dayOfYear: clampedDay, year };
    this.solver.isContinuousSolarMode = true;
    this.currentMinutes = this.solver.refreshEphemerisFromInput(this.weather);
    this.syncClimateSnowAllowance();

    const alt = this.solver.latestSolar.altitudeDeg;
    this.solver.currentMode = alt >= 12.0 ? 'day' : alt >= -3.0 ? 'dusk' : 'night';

    const requestedBake = options.updateShadowMap ?? true;
    this.lastSolarScrubMs = typeof performance !== 'undefined' ? performance.now() : 0;
    this.hasAppliedMode = true;
    this.cancelTransition();
    this.uFogClearRadius.value = this.solver.computeContinuousSolarState(this.state, this.weather);
    const bakeShadow = requestedBake && this.hasActiveSunShadow();
    if (requestedBake && !this.hasActiveSunShadow()) {
      this.shadowController.markStaleWhileExtinct();
    }
    this.hdrManager.applyEnvironmentTextures(
      this.solver.activeHdrBucket,
      this.state.sunDirection,
      this.state.fogColor,
      this.buildHdrApplyOptions(false)
    );
    this.applyState(bakeShadow);
    this.solver.syncWeatherLightingContext(this.weather, this.state.sunDirection);
    if (!options.suppressEnvCallback) {
      this.onEnvUpdated?.(bakeShadow);
    }
    const snap = this.getSkyWeatherSnapshot();
    this.emitSkySnapshot(snap);
    return snap;
  }

  public setLiveClockSync(enabled: boolean): SkyWeatherSnapshot {
    this.setLiveClockSyncInternal(enabled);
    if (enabled) {
      this.solver.seasonSelection = 'auto';
      const nowLocal = getCurrentSolarClockForLocation(
        this.solver.getLiveClockOptions(this.weather)
      );
      return this.setSolarDateTime(nowLocal, { keepLiveSync: true });
    }
    const snap = this.getSkyWeatherSnapshot();
    this.emitSkySnapshot(snap);
    return snap;
  }

  public isLiveClockSync(): boolean {
    return this.solver.liveClockSync;
  }

  private setLiveClockSyncInternal(enabled: boolean): void {
    this.solver.liveClockSync = enabled;
    if (this.liveClockTimer !== null) {
      clearInterval(this.liveClockTimer);
      this.liveClockTimer = null;
    }
    if (enabled && !this.disposed && typeof setInterval === 'function') {
      this.liveClockTimer = setInterval(() => {
        if (this.disposed || !this.solver.liveClockSync) return;
        if (typeof document !== 'undefined' && document.hidden) return;
        const nowLocal = getCurrentSolarClockForLocation(
          this.solver.getLiveClockOptions(this.weather)
        );
        this.setSolarDateTime(nowLocal, { keepLiveSync: true });
      }, LIVE_SOLAR_TICK_MS);
    }
  }

  public getDaylightGiState(): {
    readonly strength: number;
    readonly tint: readonly [number, number, number];
  } {
    return {
      strength: this.state.daylightGiStrength,
      tint: [
        this.state.daylightGiTint.r,
        this.state.daylightGiTint.g,
        this.state.daylightGiTint.b,
      ],
    };
  }

  public getComputedAmbientLux(): number {
    return this.solver.getComputedAmbientLux(this.weather);
  }

  public getSkyWeatherSnapshot(): SkyWeatherSnapshot {
    return this.solver.buildSkyWeatherSnapshot(
      this.weather,
      this.hdrManager.getActiveCellKey()
    );
  }

  public onSkyWeatherChanged(listener: (snapshot: SkyWeatherSnapshot) => void): () => void {
    this.skyListeners.add(listener);
    return () => {
      this.skyListeners.delete(listener);
    };
  }

  private emitSkySnapshot(snapshot?: SkyWeatherSnapshot): void {
    if (this.skyListeners.size === 0) return;
    const snap = snapshot ?? this.getSkyWeatherSnapshot();
    for (const l of this.skyListeners) {
      l(snap);
    }
  }

  public getHdrDualSlotState() {
    return this.hdrManager.getDualSlotState();
  }

  public isTransitioning(): boolean {
    return (
      this.transitioning ||
      this.seasonEasing ||
      this.hdrManager.isHdrTransitioning() ||
      this.hdrManager.hasPendingBakes()
    );
  }

  public stepTransition(dtSeconds: number, allowHdrBakeFlush = true): boolean {
    const dtMs = Math.max(0, dtSeconds) * 1000;
    this.hdrClockMs += dtMs;
    const activelyScrubbing =
      typeof performance !== 'undefined' && performance.now() - this.lastSolarScrubMs < 200;
    const flushedHdr =
      allowHdrBakeFlush && !activelyScrubbing ? this.flushPendingHdrBakes() : false;
    const wasHdrTransitioning = this.hdrManager.isHdrTransitioning();
    const hdrStillAnimating = wasHdrTransitioning
      ? this.hdrManager.tickTransition(this.hdrClockMs)
      : false;
    const steppedHdr = wasHdrTransitioning || hdrStillAnimating;

    if (this.seasonEasing) {
      this.seasonEaseElapsedMs += dtMs;
      const st = Math.min(1, this.seasonEaseElapsedMs / SEASON_EASE_MS);
      const sEased = st * st * (3 - 2 * st);
      const nextDoy = wrapDayOfYear(this.seasonEaseFromDoy + this.seasonEaseDeltaDoy * sEased);
      const nextHour = THREE.MathUtils.lerp(this.seasonEaseFromHour, this.seasonEaseToHour, sEased);
      this.solver.solarInput = {
        civilHour: nextHour,
        dayOfYear: nextDoy,
        year: this.solver.solarInput.year,
      };
      this.currentMinutes = this.solver.refreshEphemerisFromInput(this.weather);
      if (this.solver.isContinuousSolarMode) {
        const alt = this.solver.latestSolar.altitudeDeg;
        this.solver.currentMode = alt >= 12.0 ? 'day' : alt >= -3.0 ? 'dusk' : 'night';
      }
      this.uFogClearRadius.value = this.solver.recomputeCurrentTargetState(this.state, this.weather);
      const isSeasonFinal = st >= 1;
      const dueForSeasonShadow =
        isSeasonFinal || this.seasonEaseElapsedMs - this.lastSeasonShadowMs >= 75;
      if (dueForSeasonShadow) {
        this.lastSeasonShadowMs = this.seasonEaseElapsedMs;
      }
      const bakeSeasonShadow = dueForSeasonShadow && this.hasActiveSunShadow();
      if (dueForSeasonShadow && !this.hasActiveSunShadow()) {
        this.shadowController.markStaleWhileExtinct();
      }
      if (isSeasonFinal) {
        this.seasonEasing = false;
      }
      this.applyState(bakeSeasonShadow);
      this.solver.syncWeatherLightingContext(this.weather, this.state.sunDirection);
      this.emitSkySnapshot();
      this.onEnvUpdated?.(bakeSeasonShadow);
      if (!this.transitioning) {
        return true;
      }
    }

    if (!this.transitioning) {
      if (steppedHdr) {
        this.onEnvUpdated?.(false);
        return true;
      }
      return flushedHdr;
    }

    this.transitionElapsedMs += dtMs;
    const t = Math.min(1, this.transitionElapsedMs / TRANSITION_MS);
    const eased = t * t * (3 - 2 * t);
    lerpEnvState(this.transitionFrom, this.transitionTo, eased, this.state);
    const isFinal = t >= 1;
    const dueForShadow =
      isFinal || this.transitionElapsedMs - this.lastTransitionShadowMs >= 75;
    if (dueForShadow) {
      this.lastTransitionShadowMs = this.transitionElapsedMs;
    }
    const bakeShadow = dueForShadow && this.hasActiveSunShadow();
    if (dueForShadow && !this.hasActiveSunShadow()) {
      this.shadowController.markStaleWhileExtinct();
    }
    if (isFinal) {
      this.transitioning = false;
    }
    this.applyState(bakeShadow);
    this.solver.syncWeatherLightingContext(this.weather, this.state.sunDirection);
    this.onEnvUpdated?.(bakeShadow);
    return true;
  }

  private cancelTransition(): void {
    this.transitioning = false;
    this.seasonEasing = false;
    this.hdrManager.cancelHdrTransition();
  }

  public updateWeatherAnimation(
    dtSeconds: number,
    cameraPosition: THREE.Vector3,
    cameraTarget: THREE.Vector3,
    cameraQuaternion?: THREE.Quaternion
  ): boolean {
    const active = this.weather.update(dtSeconds, cameraPosition, cameraTarget, cameraQuaternion);
    this.syncVegetationPhenology(active, active ? dtSeconds : 0);
    return active;
  }

  public setSoundscape(descriptor: SoundscapeDescriptor): void {
    this.ambientSoundscape.setSoundscape(descriptor);
  }

  public getSoundscape(): NormalizedSoundscapeDescriptor {
    return this.ambientSoundscape.getSoundscape();
  }

  public updateAmbientAudio(
    dtSeconds: number,
    isInterior: boolean,
    bifoldsOpen: boolean,
    occlusion?: AcousticOcclusionState
  ): void {
    const coupling = this.weather.getAtmosphereCoupling();
    this.ambientSoundscape.update(
      dtSeconds,
      this.currentMinutes / 60,
      isInterior,
      bifoldsOpen,
      coupling.audio,
      occlusion
    );
  }

  public dispose(): void {
    this.disposed = true;
    this.setLiveClockSyncInternal(false);
    this.cancelTransition();
    this.ambientSoundscape.dispose();
    this.weather.dispose();
    this.skyListeners.clear();
    this.hdrManager.dispose();
  }
}
