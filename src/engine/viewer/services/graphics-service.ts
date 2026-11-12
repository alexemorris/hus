import * as THREE from 'three';
import type { GraphicsMode, GraphicsTier, GraphicsTierSettings } from '../../../core/types/twin-ux.ts';
import {
  setBakedLightTierDirectCutoff,
  setPointLightZeroBudgetBoost,
} from '../../lighting/baked-light-volume.ts';
import type { EnvironmentLighting } from '../../lighting/environment-lighting.ts';
import { setCloudGoboTierEnabled } from '../../lighting/shader-light-culling.ts';
import type { RoomLodController } from '../../lod/lod-manager.ts';
import {
  PerformanceGovernor,
  detectDeviceProfile,
  estimateInitialTier,
  getPointLightBudget,
  type PerformanceGovernorStats,
} from '../../perf/index.ts';
import type {
  GraphicsQualityPreset,
  GraphicsSettingsState,
} from '../../rendering/post-processing-pipeline.ts';
import {
  CARRIER_POINT_LIGHT_POOL_SIZE,
  type SceneBatchOptimizer,
} from '../../rendering/scene-batch-optimizer.ts';
import { Emitter } from '../../util/emitter.ts';
import type { ViewerRenderer } from './viewer-renderer.ts';

export interface GraphicsServiceHost {
  readonly renderer: ViewerRenderer;
  readonly environment: EnvironmentLighting;
  readonly lodController: RoomLodController;
  readonly batchOptimizer: SceneBatchOptimizer;
  /** Re-evaluates cutaways / LOD for the current view after a tier change. */
  refreshView(): void;
}

/**
 * Graphics quality: the auto-tuning `PerformanceGovernor` (persisted mode,
 * cached per-GPU tier), post-processing presets and FPS stats.
 */
export class GraphicsService {
  /** Short user-facing messages such as automatic quality step-downs. */
  public readonly toast = new Emitter<[message: string]>();
  private readonly host: GraphicsServiceHost;
  private readonly governor: PerformanceGovernor;
  private isMobileDevice: boolean;

  public constructor(host: GraphicsServiceHost) {
    this.host = host;
    // Performance auto-tune: device heuristic + adaptive mobile governor.
    const deviceProfile = detectDeviceProfile(host.renderer.renderer);
    const initialTier = estimateInitialTier(deviceProfile);
    this.isMobileDevice = deviceProfile.isMobile;
    const canvas = host.renderer.renderer.domElement;
    this.governor = new PerformanceGovernor({
      devicePixelRatio: deviceProfile.devicePixelRatio,
      autoAdaptationEnabled: deviceProfile.isMobile,
      viewportWidth: canvas?.clientWidth || undefined,
      viewportHeight: canvas?.clientHeight || undefined,
      initialTier,
      applyTier: (settings) => this.applyTier(settings),
      onToast: (message) => this.toast.emit(message),
    });
  }

  public getMode(): GraphicsMode {
    return this.governor.getMode();
  }

  public getActiveTier(): GraphicsTier {
    return this.governor.getActiveTier();
  }

  public setMode(mode: GraphicsMode): void {
    this.governor.setMode(mode);
    this.host.renderer.requestRender();
  }

  /** Live FPS / tier stats (O(1): last governor window). */
  public getStats(): PerformanceGovernorStats {
    return this.governor.getStats();
  }

  public getSettings(): GraphicsSettingsState {
    return this.host.renderer.post.getSettings();
  }

  public setQualityPreset(preset: GraphicsQualityPreset): void {
    this.host.renderer.post.setQualityPreset(preset);
    this.host.environment.setShadowMapSize(
      preset === 'ultra' ? 4096 : preset === 'balanced' ? 2048 : 1024
    );
    this.host.renderer.invalidateShadows();
    this.host.renderer.requestRender();
  }

  public cycleQualityPreset(): GraphicsQualityPreset {
    const next = this.host.renderer.post.cycleQualityPreset();
    this.host.environment.setShadowMapSize(
      next === 'ultra' ? 4096 : next === 'balanced' ? 2048 : 1024
    );
    this.host.renderer.invalidateShadows();
    this.host.renderer.requestRender();
    return next;
  }

  public isMotionBlurEnabled(): boolean {
    return this.host.renderer.post.isMotionBlurEnabled();
  }

  public setMotionBlurEnabled(enabled: boolean): void {
    this.host.renderer.post.setMotionBlurEnabled(enabled);
    this.host.renderer.requestRender();
  }

  public toggleMotionBlur(): boolean {
    const next = this.host.renderer.post.toggleMotionBlur();
    this.host.renderer.requestRender();
    return next;
  }

  public isSsaoEnabled(): boolean {
    return this.host.renderer.post.isSsaoEnabled();
  }

  public setSsaoEnabled(enabled: boolean): void {
    this.host.renderer.post.setSsaoEnabled(enabled);
    this.host.renderer.requestRender();
  }

  public isFxaaEnabled(): boolean {
    return this.host.renderer.post.isFxaaEnabled();
  }

  public setFxaaEnabled(enabled: boolean): void {
    this.host.renderer.post.setFxaaEnabled(enabled);
    this.host.renderer.requestRender();
  }

  public setDevicePixelRatio(ratio: number): void {
    this.governor.setDevicePixelRatio(ratio);
  }

  /** Re-inspects the GPU adapter after `await renderer.init()` and updates the auto tier & DPR. */
  public refreshDeviceProfile(): void {
    const profile = detectDeviceProfile(this.host.renderer.renderer);
    this.isMobileDevice = profile.isMobile;
    this.governor.setAutoAdaptationEnabled(profile.isMobile);
    this.governor.setDevicePixelRatio(profile.devicePixelRatio);
    this.governor.setAutoTier(estimateInitialTier(profile));
    this.governor.syncEffectivePixelRatio(this.host.renderer.post.getSettings().pixelRatio);
  }

  /** Feeds a rendered frame's duration to the governor. */
  public recordFrame(dtMs: number, cameraMoving: boolean): void {
    this.governor.recordFrame(dtMs, cameraMoving);
  }

  /** Applies a pending tier change once the camera is idle. */
  public notifyIdle(): void {
    if (this.governor.hasPendingChange()) this.governor.notifyCameraIdle();
  }

  private applyTier(settings: GraphicsTierSettings): void {
    const { renderer, environment, lodController, batchOptimizer } = this.host;
    setBakedLightTierDirectCutoff(settings.tier);
    renderer.setShadowMapType(THREE.PCFShadowMap);
    renderer.post.applyTierSettings(settings);
    this.governor?.syncEffectivePixelRatio(renderer.post.getSettings().pixelRatio);
    environment.setShadowMapSize(settings.shadowMapSize);
    lodController.setDistanceScale(settings.lodDistanceScale);
    lodController.setHighDetailMaxDistance(settings.highDetailMaxDistance);
    // WebGPU PointLight carrier pool: 8 on 'high'/'ultra' (6 on 'medium', 0 on 'low'/mobile),
    // cutting unrolled PointLight WGSL ALU & VGPR pressure 2x while BakedLightVolume illuminates all 59 circuits.
    const carrierPoolSize =
      this.isMobileDevice || settings.tier === 'low'
        ? 0
        : settings.tier === 'medium'
          ? 6
          : CARRIER_POINT_LIGHT_POOL_SIZE;
    const pointLightBudget =
      carrierPoolSize === 0 ? 0 : Math.min(carrierPoolSize, getPointLightBudget(settings.tier));
    setPointLightZeroBudgetBoost(pointLightBudget === 0 && !this.isMobileDevice);
    batchOptimizer.setPointLightBudget(pointLightBudget);
    batchOptimizer.enableCarrierPointLightPool(carrierPoolSize);
    batchOptimizer.stepFades(0);
    setCloudGoboTierEnabled(settings.tier !== 'low');
    environment.weather.setGraphicsTier(settings.tier);
    this.host.refreshView();
    renderer.invalidateShadows();
    renderer.requestRender();
  }
}
