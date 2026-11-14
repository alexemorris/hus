import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import type { RigCamera } from '../../camera/camera-rig.ts';
import { syncBakedLightCameraMatrix } from '../../lighting/baked-light-volume.ts';
import { detectMobile } from '../../perf/device-tier.ts';
import {
  PostProcessingPipeline,
  RENDERER_TONE_MAPPING,
} from '../../rendering/post-processing-pipeline.ts';
import type { RenderInvalidator } from './viewer-types.ts';

export interface NegotiatedWebGpuLimits {
  maxSampledTexturesPerShaderStage?: number;
  maxSamplersPerShaderStage?: number;
  maxTextureDimension2D?: number;
  maxBufferSize?: number;
  maxStorageBufferBindingSize?: number;
}

export function buildSafeRequiredWebGpuLimits(
  adapterLimits: Partial<Record<keyof NegotiatedWebGpuLimits, number>> | null | undefined,
  isMobile: boolean
): NegotiatedWebGpuLimits {
  if (!adapterLimits) return {};
  const out: NegotiatedWebGpuLimits = {};
  if (
    typeof adapterLimits.maxSampledTexturesPerShaderStage === "number" &&
    adapterLimits.maxSampledTexturesPerShaderStage > 16
  ) {
    out.maxSampledTexturesPerShaderStage = Math.min(
      adapterLimits.maxSampledTexturesPerShaderStage,
      32
    );
  }
  if (
    typeof adapterLimits.maxSamplersPerShaderStage === "number" &&
    adapterLimits.maxSamplersPerShaderStage > 16
  ) {
    out.maxSamplersPerShaderStage = Math.min(adapterLimits.maxSamplersPerShaderStage, 32);
  }
  const desiredMaxTex = isMobile ? 4096 : 8192;
  if (
    typeof adapterLimits.maxTextureDimension2D === "number" &&
    adapterLimits.maxTextureDimension2D >= 2048
  ) {
    out.maxTextureDimension2D = Math.min(adapterLimits.maxTextureDimension2D, desiredMaxTex);
  }
  const desiredMaxBuf = isMobile ? 256 * 1024 * 1024 : 512 * 1024 * 1024;
  if (
    typeof adapterLimits.maxBufferSize === "number" &&
    adapterLimits.maxBufferSize >= 256 * 1024 * 1024
  ) {
    out.maxBufferSize = Math.min(adapterLimits.maxBufferSize, desiredMaxBuf);
  }
  if (
    typeof adapterLimits.maxStorageBufferBindingSize === "number" &&
    adapterLimits.maxStorageBufferBindingSize >= 128 * 1024 * 1024
  ) {
    out.maxStorageBufferBindingSize = Math.min(
      adapterLimits.maxStorageBufferBindingSize,
      desiredMaxBuf
    );
  }
  return out;
}

async function configureAdapterRequiredLimits(
  renderer: WebGPURenderer,
  isMobile: boolean
): Promise<void> {
  const backend = (
    renderer as unknown as {
      backend?: {
        isWebGPUBackend?: boolean;
        parameters?: {
          powerPreference?: GPUPowerPreference;
          requiredLimits?: Record<string, number>;
        };
      };
    }
  ).backend;
  if (!backend?.isWebGPUBackend || !backend.parameters) return;
  const gpu = (typeof navigator !== "undefined" ? (navigator as Navigator & { gpu?: GPU }).gpu : undefined);
  if (!gpu || typeof gpu.requestAdapter !== "function") return;
  try {
    const adapter = await gpu.requestAdapter({
      powerPreference: backend.parameters.powerPreference,
    });
    if (!adapter?.limits) return;
    const negotiated = buildSafeRequiredWebGpuLimits(
      adapter.limits as unknown as Partial<Record<keyof NegotiatedWebGpuLimits, number>>,
      isMobile
    );
    backend.parameters.requiredLimits = {
      ...(backend.parameters.requiredLimits ?? {}),
      ...negotiated,
    };
  } catch {
    // Fall back to default WebGPU limits if adapter probe fails
  }
}

/**
 * Owns the WebGPU renderer (with automatic WebGL2 backend fallback), the
 * post-processing pipeline and the on-demand render flag. Frames are only
 * drawn when something requested a render and after `init()` has resolved.
 */
export class ViewerRenderer implements RenderInvalidator {
  public readonly renderer: WebGPURenderer;
  public readonly post: PostProcessingPipeline;
  public onRequestRender: (() => void) | null = null;
  private readonly requestRenderListeners = new Set<() => void>();
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private needsRender = true;
  private shadowsDirty = true;
  private shadowBakeCount = 0;
  private postBlurSettleFrames = 0;

  public constructor(canvas: HTMLCanvasElement) {
    const forceWebGLParam =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('forceWebGL')
        : null;
    const isMobile = detectMobile();
    const forceWebGL = forceWebGLParam === '1';
    this.renderer = new WebGPURenderer({
      canvas,
      antialias: !isMobile,
      forceWebGL,
      powerPreference: isMobile ? undefined : 'high-performance',
      logarithmicDepthBuffer: false,
    });
    const initW = Math.max(1, canvas.clientWidth || 1);
    const initH = Math.max(1, canvas.clientHeight || 1);
    this.renderer.setPixelRatio(isMobile ? 0.85 : 1);
    this.renderer.setSize(initW, initH, false);
    this.renderer.sortObjects = true;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = RENDERER_TONE_MAPPING;
    this.renderer.toneMappingExposure = 1.12;

    this.post = new PostProcessingPipeline(this.renderer, initW, initH);
  }

  public init(): Promise<void> {
    if (this.initialized) return Promise.resolve();
    if (!this.initPromise) {
      const isMobile = detectMobile();
      this.initPromise = configureAdapterRequiredLimits(this.renderer, isMobile)
        .then(() => this.renderer.init())
        .catch((err) => {
          const backend = (
            this.renderer as unknown as {
              backend?: { parameters?: { requiredLimits?: Record<string, number> } };
            }
          ).backend;
          if (backend?.parameters?.requiredLimits && Object.keys(backend.parameters.requiredLimits).length > 0) {
            backend.parameters.requiredLimits = {};
            return this.renderer.init();
          }
          throw err;
        })
        .then(() => {
          this.initialized = true;
          this.needsRender = true;
          this.shadowsDirty = true;
        });
    }
    return this.initPromise;
  }

  // All shader pipelines and textures are compiled & uploaded upfront during warmUpForStartup()
  // before loading.finish(), so renderIfNeeded() never blocks or drops frames on background compiles.

  public isInitialized(): boolean {
    return this.initialized;
  }

  public addRequestRenderListener(cb: () => void): () => void {
    this.requestRenderListeners.add(cb);
    return () => {
      this.requestRenderListeners.delete(cb);
    };
  }

  public hasPendingRender(): boolean {
    return this.needsRender || this.postBlurSettleFrames > 0;
  }

  public getShadowBakeCount(): number {
    return this.shadowBakeCount;
  }

  public setShadowMapType(type: THREE.ShadowMapType): void {
    if (this.renderer.shadowMap.type === type) return;
    this.renderer.shadowMap.type = type;
    this.invalidateShadows();
  }

  private notifyRequestRender(): void {
    this.onRequestRender?.();
    for (const cb of this.requestRenderListeners) {
      cb();
    }
  }

  public requestRender(): void {
    this.needsRender = true;
    this.notifyRequestRender();
  }

  public invalidateShadows(): void {
    this.shadowsDirty = true;
  }

  /** Clears temporal history (TAA / motion blur) after a camera cut. */
  public resetHistory(): void {
    this.post.resetHistory();
  }

  public getMaxAnisotropy(): number {
    try {
      return this.renderer.getMaxAnisotropy() || 8;
    } catch {
      return 8;
    }
  }

  public resize(width: number, height: number): void {
    this.post.resize(width, height);
    this.needsRender = true;
    this.notifyRequestRender();
  }

  /**
   * Draws a frame when dirty (plus one settle frame after motion-blurred camera
   * motion). Returns true when a frame was rendered.
   */
  public renderIfNeeded(
    scene: THREE.Scene,
    camera: RigCamera,
    dtSeconds: number,
    cameraMoved: boolean,
    beforeRender: () => void
  ): boolean {
    if (!this.initialized) {
      return false;
    }
    if (cameraMoved && this.post.isMotionBlurEnabled()) {
      this.postBlurSettleFrames = 1;
    } else if (!this.needsRender && this.postBlurSettleFrames > 0) {
      this.postBlurSettleFrames -= 1;
      this.needsRender = true;
    }
    if (!this.needsRender) return false;
    if (this.shadowsDirty) {
      let bakedAny = false;
      for (const child of scene.children) {
        if (child instanceof THREE.Light && child.castShadow && child.shadow) {
          child.shadow.autoUpdate = false;
          child.shadow.needsUpdate = true;
          bakedAny = true;
        }
      }
      if (bakedAny) this.shadowBakeCount++;
      this.shadowsDirty = false;
    }
    camera.updateMatrixWorld();
    syncBakedLightCameraMatrix(camera);
    beforeRender();
    this.post.render(scene, camera, dtSeconds);
    for (const child of scene.children) {
      if (child instanceof THREE.Light && child.castShadow && child.shadow) {
        child.shadow.needsUpdate = false;
      }
    }
    this.needsRender = false;
    return true;
  }
}
