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
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    this.renderer.setPixelRatio(1);
    this.renderer.sortObjects = true;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = RENDERER_TONE_MAPPING;
    this.renderer.toneMappingExposure = 1.12;

    this.post = new PostProcessingPipeline(this.renderer, canvas.clientWidth, canvas.clientHeight);
  }

  public init(): Promise<void> {
    if (this.initialized) return Promise.resolve();
    if (!this.initPromise) {
      this.initPromise = this.renderer.init().then(() => {
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
