import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import {
  husCloudPenumbraShadowFilter,
  setSunShadowPenumbraUniforms,
} from '../shader-light-culling.ts';
import {
  SITE_CASTER_SHADOW_BOX,
  SITE_SHADOW_BOX,
  fitCameraTargetShadowFrustum,
  fitShadowFrustum,
  sunPlacement,
} from './env-state.ts';

/** Coarse camera-fitted shadow frustum half-extent tiers (metres). */
const SHADOW_HALF_EXTENT_CLOSE_M = 22.5;
const SHADOW_HALF_EXTENT_MID_M = 26.5;
const SHADOW_HALF_EXTENT_FAR_M = 48.0;
/** Coarse world-space grid step (metres) for camera-target shadow anchor quantization. */
const SHADOW_CENTER_GRID_M = 12.0;
/** Deadband (metres, >= 10m) beyond the current grid cell center before re-snapping the shadow anchor. */
const SHADOW_CENTER_DEADBAND_M = 10.8;
/** Larger 1PV walkthrough deadband (metres) so multi-room walking across the house triggers 0 mid-walk 4096^2 shadow passes. */
const SHADOW_CENTER_WALKTHROUGH_DEADBAND_M = 22.0;

export interface ShadowFrustumDiagnostics {
  readonly shadowMapSize: 1024 | 2048 | 4096;
  readonly halfExtentM: number;
  readonly texelSizeM: number;
  readonly texelsPerMetre: number;
  readonly normalBiasM: number;
  readonly shadowIntensity: number;
  readonly shadowRadius: number;
  readonly centerCellX: number;
  readonly centerCellZ: number;
  readonly isCameraFitted: boolean;
}

/**
 * Manages the `4096` directional sun/moon shadow map, camera-target-fitted quantized
 * shadow frustum (`12 m` anchor cells + hysteresis deadbands + light-space texel-snap dedup),
 * and immutable-resolution interactive scrub state.
 */
export class DirectionalShadowController {
  private readonly sunLight: THREE.DirectionalLight;
  private readonly renderer?: WebGPURenderer;
  private shadowMapSize: 1024 | 2048 | 4096 = 4096;
  private interactiveScrubShadow = false;
  private shadowMapStaleWhileExtinct = false;
  private shadowCameraFitted = false;
  private shadowHalfExtentM = SHADOW_HALF_EXTENT_MID_M;
  private readonly shadowCellCenter = new THREE.Vector3(-4.0, 2.0, 6.0);
  private lastSnappedLightX = Number.NaN;
  private lastSnappedLightY = Number.NaN;
  private lastAppliedHalfExtentM = Number.NaN;
  private lastAppliedShadowMapSize = 0;
  private readonly fitPosScratch = new THREE.Vector3();
  private readonly fitTargetScratch = new THREE.Vector3();

  public constructor(sunLight: THREE.DirectionalLight, renderer?: WebGPURenderer) {
    this.sunLight = sunLight;
    this.renderer = renderer;

    this.sunLight.castShadow = true;
    this.sunLight.shadow.autoUpdate = false;
    this.sunLight.shadow.needsUpdate = true;
    this.sunLight.shadow.mapSize.set(this.shadowMapSize, this.shadowMapSize);
    this.sunLight.shadow.bias = -0.00014;
    (this.sunLight.shadow as unknown as { filterNode: unknown }).filterNode =
      husCloudPenumbraShadowFilter;
    setSunShadowPenumbraUniforms(1.0, this.shadowMapSize);
  }

  public isStaleWhileExtinct(): boolean {
    return this.shadowMapStaleWhileExtinct;
  }

  public markStaleWhileExtinct(): void {
    this.shadowMapStaleWhileExtinct = true;
  }

  /**
   * Positions the sun for `direction` and fits either a camera-target-fitted, quantized &
   * texel-snapped frustum (default in interactive views) or the full-site fallback frustum.
   */
  public placeSun(
    direction: THREE.Vector3,
    updateShadowMap: boolean,
    hasActiveSunShadow: boolean
  ): void {
    const cam = this.sunLight.shadow.camera;
    if (this.shadowCameraFitted) {
      const fitted = fitCameraTargetShadowFrustum(
        direction,
        this.shadowCellCenter,
        this.shadowHalfExtentM,
        this.shadowMapSize,
        SITE_CASTER_SHADOW_BOX,
        this.fitPosScratch,
        this.fitTargetScratch
      );
      this.sunLight.position.copy(fitted.position);
      this.sunLight.target.position.copy(fitted.target);
      cam.left = fitted.frustum.left;
      cam.right = fitted.frustum.right;
      cam.top = fitted.frustum.top;
      cam.bottom = fitted.frustum.bottom;
      cam.near = fitted.frustum.near;
      cam.far = fitted.frustum.far;
      this.lastSnappedLightX = fitted.snappedLightX;
      this.lastSnappedLightY = fitted.snappedLightY;
      this.lastAppliedHalfExtentM = this.shadowHalfExtentM;
      this.lastAppliedShadowMapSize = this.shadowMapSize;
    } else {
      const { position, target } = sunPlacement(direction, SITE_SHADOW_BOX);
      this.sunLight.position.copy(position);
      this.sunLight.target.position.copy(target);
      const f = fitShadowFrustum(position, target, SITE_SHADOW_BOX);
      cam.left = f.left;
      cam.right = f.right;
      cam.top = f.top;
      cam.bottom = f.bottom;
      cam.near = f.near;
      cam.far = f.far;
      this.lastAppliedHalfExtentM = Math.max(f.right - f.left, f.top - f.bottom) * 0.5;
      this.lastAppliedShadowMapSize = this.shadowMapSize;
    }
    // Always sync local + world matrices explicitly because StaticSceneService freezes
    // scene.matrixWorldAutoUpdate = false and obj.matrixAutoUpdate = false!
    this.sunLight.updateMatrix();
    this.sunLight.updateMatrixWorld(true);
    this.sunLight.target.updateMatrix();
    this.sunLight.target.updateMatrixWorld(true);
    cam.position.copy(this.sunLight.position);
    cam.lookAt(this.sunLight.target.position);
    cam.updateMatrix();
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    if (updateShadowMap && hasActiveSunShadow) {
      this.shadowMapStaleWhileExtinct = false;
      this.sunLight.shadow.needsUpdate = true;
      if (this.renderer?.shadowMap && 'needsUpdate' in this.renderer.shadowMap) {
        this.renderer.shadowMap.needsUpdate = true;
      }
    } else if (updateShadowMap) {
      this.shadowMapStaleWhileExtinct = true;
    }
    this.updateNormalBias();
  }

  /**
   * Fits the `4096` directional shadow frustum to a coarse (`12 m`) quantized camera-target grid
   * cell and coarse distance tier (`22.5 m`, `26.5 m`, `48 m`), snapped to exact light-space texel
   * increments `(halfExtent * 2) / shadowMapSize`.
   *
   * Returns `true` ONLY when the quantized tier or light-space texel cell actually changes, so
   * normal camera orbit inside a room or courtyard triggers `0` shadow re-bakes!
   */
  public updateShadowFrustumForCamera(
    cameraTarget: THREE.Vector3,
    cameraDistanceM: number,
    isWalkthrough: boolean,
    sunDirection: THREE.Vector3,
    hasActiveSunShadow: boolean,
    onCloudAnchorChanged: (x: number, z: number) => void
  ): boolean {
    const dist = Number.isFinite(cameraDistanceM) ? Math.max(1.0, cameraDistanceM) : 20.0;
    let nextHalfExtent = this.shadowHalfExtentM;
    if (!this.shadowCameraFitted) {
      nextHalfExtent =
        dist < 22.0
          ? SHADOW_HALF_EXTENT_CLOSE_M
          : dist <= 36.0
            ? SHADOW_HALF_EXTENT_MID_M
            : SHADOW_HALF_EXTENT_FAR_M;
    } else if (
      isWalkthrough &&
      (this.shadowHalfExtentM === SHADOW_HALF_EXTENT_CLOSE_M ||
        this.shadowHalfExtentM === SHADOW_HALF_EXTENT_MID_M)
    ) {
      // Hold close/mid shadow extent steady throughout 1PV walkthrough
      nextHalfExtent = this.shadowHalfExtentM;
    } else if (this.shadowHalfExtentM === SHADOW_HALF_EXTENT_CLOSE_M) {
      if (dist > 40.0) nextHalfExtent = SHADOW_HALF_EXTENT_FAR_M;
      else if (dist > 24.5) nextHalfExtent = SHADOW_HALF_EXTENT_MID_M;
    } else if (this.shadowHalfExtentM === SHADOW_HALF_EXTENT_MID_M) {
      if (dist < 21.0) nextHalfExtent = SHADOW_HALF_EXTENT_CLOSE_M;
      else if (dist > 40.0) nextHalfExtent = SHADOW_HALF_EXTENT_FAR_M;
    } else {
      if (dist < 21.0) nextHalfExtent = SHADOW_HALF_EXTENT_CLOSE_M;
      else if (dist <= 36.0) nextHalfExtent = SHADOW_HALF_EXTENT_MID_M;
    }

    const clampedX = THREE.MathUtils.clamp(
      cameraTarget.x,
      SITE_SHADOW_BOX.min[0] + 4.0,
      SITE_SHADOW_BOX.max[0] - 4.0
    );
    const clampedZ = THREE.MathUtils.clamp(
      cameraTarget.z,
      SITE_SHADOW_BOX.min[2] + 4.0,
      SITE_SHADOW_BOX.max[2] - 4.0
    );
    const deadbandM = isWalkthrough ? SHADOW_CENTER_WALKTHROUGH_DEADBAND_M : SHADOW_CENTER_DEADBAND_M;
    let nextCellX = this.shadowCellCenter.x;
    let nextCellZ = this.shadowCellCenter.z;
    if (
      !this.shadowCameraFitted ||
      Math.abs(clampedX - this.shadowCellCenter.x) > deadbandM ||
      Math.abs(clampedZ - this.shadowCellCenter.z) > deadbandM
    ) {
      nextCellX = Math.round(clampedX / SHADOW_CENTER_GRID_M) * SHADOW_CENTER_GRID_M;
      nextCellZ = Math.round(clampedZ / SHADOW_CENTER_GRID_M) * SHADOW_CENTER_GRID_M;
    }

    const wasFitted = this.shadowCameraFitted;
    const cellOrExtentChanged =
      !wasFitted ||
      nextHalfExtent !== this.shadowHalfExtentM ||
      nextCellX !== this.shadowCellCenter.x ||
      nextCellZ !== this.shadowCellCenter.z ||
      this.shadowMapSize !== this.lastAppliedShadowMapSize;

    if (!cellOrExtentChanged) {
      return false;
    }

    this.shadowCameraFitted = true;
    this.shadowHalfExtentM = nextHalfExtent;
    this.shadowCellCenter.set(nextCellX, 2.0, nextCellZ);
    onCloudAnchorChanged(nextCellX, nextCellZ);

    const probe = fitCameraTargetShadowFrustum(
      sunDirection,
      this.shadowCellCenter,
      this.shadowHalfExtentM,
      this.shadowMapSize,
      SITE_CASTER_SHADOW_BOX
    );
    if (
      wasFitted &&
      nextHalfExtent === this.lastAppliedHalfExtentM &&
      this.shadowMapSize === this.lastAppliedShadowMapSize &&
      Math.abs(probe.snappedLightX - this.lastSnappedLightX) <= 1e-5 &&
      Math.abs(probe.snappedLightY - this.lastSnappedLightY) <= 1e-5
    ) {
      return false;
    }

    this.placeSun(sunDirection, hasActiveSunShadow, hasActiveSunShadow);
    if (hasActiveSunShadow && this.renderer?.shadowMap && 'needsUpdate' in this.renderer.shadowMap) {
      this.renderer.shadowMap.needsUpdate = true;
    }
    return hasActiveSunShadow;
  }

  public getShadowFrustumDiagnostics(): ShadowFrustumDiagnostics {
    const cam = this.sunLight.shadow.camera;
    const span = Math.max(cam.right - cam.left, cam.top - cam.bottom);
    const texelSizeM = span / this.shadowMapSize;
    return {
      shadowMapSize: this.shadowMapSize,
      halfExtentM: span * 0.5,
      texelSizeM,
      texelsPerMetre: texelSizeM > 0 ? 1.0 / texelSizeM : 0,
      normalBiasM: this.sunLight.shadow.normalBias,
      shadowIntensity: this.sunLight.shadow.intensity,
      shadowRadius: this.sunLight.shadow.radius,
      centerCellX: this.shadowCellCenter.x,
      centerCellZ: this.shadowCellCenter.z,
      isCameraFitted: this.shadowCameraFitted,
    };
  }

  /** Marks the directional shadow map dirty after throttled continuous solar scrubbing settles. */
  public flushShadowUpdate(hasActiveSunShadow: boolean): void {
    if (!hasActiveSunShadow) {
      this.shadowMapStaleWhileExtinct = true;
      return;
    }
    this.shadowMapStaleWhileExtinct = false;
    this.sunLight.shadow.needsUpdate = true;
    if (this.renderer?.shadowMap && 'needsUpdate' in this.renderer.shadowMap) {
      this.renderer.shadowMap.needsUpdate = true;
    }
  }

  /** Normal-offset bias scaled to the world size of one shadow texel (~4.9 mm at 22.5 m / 4096). */
  private updateNormalBias(): void {
    const cam = this.sunLight.shadow.camera;
    const texel = Math.max(cam.right - cam.left, cam.top - cam.bottom) / this.shadowMapSize;
    this.sunLight.shadow.normalBias = texel * 0.45;
  }

  public getShadowMapSize(): 1024 | 2048 | 4096 {
    return this.shadowMapSize;
  }

  /**
   * Changes the sun shadow-map resolution (graphics tier) and re-snaps the shadow frustum and
   * texel-proportional `normalBias`.
   */
  public setShadowMapSize(
    size: 1024 | 2048 | 4096,
    sunDirection: THREE.Vector3,
    sunShadowRadius: number,
    hasActiveSunShadow: boolean
  ): void {
    if (size === this.shadowMapSize) return;
    this.shadowMapSize = size;
    const shadow = this.sunLight.shadow;
    shadow.mapSize.set(size, size);
    setSunShadowPenumbraUniforms(sunShadowRadius, size);
    this.placeSun(sunDirection, hasActiveSunShadow, hasActiveSunShadow);
    if (hasActiveSunShadow && this.renderer?.shadowMap && 'needsUpdate' in this.renderer.shadowMap) {
      this.renderer.shadowMap.needsUpdate = true;
    }
  }

  /**
   * Records interactive scrub state while keeping `sunLight.shadow.map` at its immutable tier
   * resolution (`4096x4096` on `'ultra'`) so `shadow.map.depthTexture`'s `GPUTextureView` is
   * never destroyed across Three.js WebGPU mesh `GPUBindGroup`s.
   */
  public setInteractiveScrubShadow(active: boolean): void {
    this.interactiveScrubShadow = active;
  }

  public isInteractiveScrubShadow(): boolean {
    return this.interactiveScrubShadow;
  }
}
