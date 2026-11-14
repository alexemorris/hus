import * as THREE from 'three';
import {
  PostProcessing,
  type Node,
  type PassNode,
  type RTTNode,
  type TextureNode,
  type UniformNode,
  type WebGPURenderer,
} from 'three/webgpu';
import {
  Fn,
  If,
  abs,
  agxToneMapping,
  clamp,
  dot,
  float,
  getViewPosition,
  max,
  min,
  mix,
  pass,
  pow,
  renderGroup,
  rtt,
  select,
  type ShaderNodeObject,
  sRGBTransferOETF,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { RigCamera } from '../camera/camera-rig.ts';
import type { GraphicsTier, GraphicsTierSettings } from '../../core/types/twin-ux.ts';
import {
  clampPixelRatioForViewport,
  getTierSettings,
  isGraphicsTier,
} from '../perf/tier-settings.ts';
import { BloomPass } from './bloom-pass.ts';
import {
  applyPhotorealismShading,
  evaluateHalfResGtao,
  evaluateScreenSpaceContactShadow,
  reconstructMinDeltaViewNormal,
  resolvePrimaryDirectionalSunSample,
  upsampleBilateralGtao,
} from './contact-shadows-and-gtao.ts';
import { evaluateMotionBlurOrFxaaCas, sampleClampedHdrRgb } from './fxaa-and-cas.ts';

/** Legacy 3-step preset kept for the existing HUD; each preset maps onto a {@link GraphicsTier}. */
export type GraphicsQualityPreset = 'ultra' | 'balanced' | 'performance';
export type PostProcessingQualityPreset = GraphicsQualityPreset;

export interface GraphicsSettingsState {
  readonly quality: GraphicsQualityPreset;
  readonly tier: GraphicsTier;
  readonly motionBlurEnabled: boolean;
  readonly motionBlurStrength: number;
  readonly postProcessingEnabled: boolean;
  readonly ambientOcclusionEnabled: boolean;
  readonly fxaaEnabled: boolean;
  readonly bloomEnabled: boolean;
  readonly sharpenEnabled: boolean;
  readonly pixelRatio: number;
}
export type PostProcessingSettings = GraphicsSettingsState;

const PRESET_TO_TIER: Readonly<Record<GraphicsQualityPreset, GraphicsTier>> = {
  ultra: 'ultra',
  balanced: 'high',
  performance: 'low',
};

function tierToPreset(tier: GraphicsTier): GraphicsQualityPreset {
  if (tier === 'ultra') return 'ultra';
  if (tier === 'low') return 'performance';
  return 'balanced';
}

/** Vertical projection scale (`P[1][1]`) of the rig's 42-degree perspective camera; used until one is seen. */
const DEFAULT_PERSPECTIVE_PROJ_Y = 1 / Math.tan(THREE.MathUtils.degToRad(21));

/** Matching built-in AgX tone mapping for frames rendered straight to the canvas (post disabled). */
export const RENDERER_TONE_MAPPING: THREE.ToneMapping = THREE.AgXToneMapping;

const STORAGE_KEY = 'hus_graphics_settings_v3';
const AO_INTENSITY = 0.48;
const BLOOM_INTENSITY = 0.12;
const SHARPEN_INTENSITY = 0.26;
const MOTION_BLUR_STRENGTH = 0.38;

function currentDevicePixelRatio(): number {
  return typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
}

export class PostProcessingPipeline {
  private readonly renderer: WebGPURenderer;
  private postProcessing: PostProcessing | null = null;
  private scenePass: ShaderNodeObject<PassNode> | null = null;
  private halfResFxRtt: ShaderNodeObject<RTTNode> | null = null;
  private readonly bloom = new BloomPass();

  private readonly uResolution: ShaderNodeObject<UniformNode<THREE.Vector2>>;
  private readonly uTexelSize: ShaderNodeObject<UniformNode<THREE.Vector2>>;
  private readonly uHalfTexelSize: ShaderNodeObject<UniformNode<THREE.Vector2>>;
  private readonly uProjMatrix = uniform(new THREE.Matrix4()).setGroup(renderGroup);
  private readonly uProjMatrixInverse = uniform(new THREE.Matrix4()).setGroup(renderGroup);
  private readonly uCameraWorldMatrix = uniform(new THREE.Matrix4()).setGroup(renderGroup);
  private readonly uIsOrtho = uniform(0.0).setGroup(renderGroup);
  private readonly uOrthoEquivDepth = uniform(10.0).setGroup(renderGroup);
  private readonly uExposure: ShaderNodeObject<UniformNode<number>>;
  private readonly uCurrInvViewProj = uniform(new THREE.Matrix4()).setGroup(renderGroup);
  private readonly uPrevViewProj = uniform(new THREE.Matrix4()).setGroup(renderGroup);
  private readonly uMotionBlurEnabled = uniform(1.0).setGroup(renderGroup);
  private readonly uShutterScale = uniform(MOTION_BLUR_STRENGTH).setGroup(renderGroup);
  private readonly uAoIntensity = uniform(AO_INTENSITY).setGroup(renderGroup);
  private readonly uSunViewDir = uniform(new THREE.Vector3(0.35, 0.88, 0.32)).setGroup(renderGroup);
  private readonly uSunWorldDir = uniform(new THREE.Vector3(0.35, 0.88, 0.32)).setGroup(
    renderGroup
  );
  private readonly uContactShadowStrength = uniform(0.0).setGroup(renderGroup);
  private readonly uSharpenIntensity = uniform(SHARPEN_INTENSITY).setGroup(renderGroup);
  private readonly uFxaaEnabled = uniform(0.0).setGroup(renderGroup);
  private readonly uHalfResFxWeight = uniform(1.0).setGroup(renderGroup);
  private readonly uIsWebGPU = uniform(1.0).setGroup(renderGroup);

  private readonly currViewProj = new THREE.Matrix4();
  private readonly currInvViewProj = new THREE.Matrix4();
  private readonly prevViewProj = new THREE.Matrix4();
  private hasPrevMatrix = false;

  private tier: GraphicsTier = 'low';
  private motionBlurEnabled = false;
  private motionBlurUserOverride: boolean | null = null;
  private motionBlurStrength = MOTION_BLUR_STRENGTH;
  private postEnabled = false;
  private ambientOcclusionEnabled = false;
  private fxaaEnabled = false;
  private bloomEnabled = false;
  private sharpenEnabled = false;
  private targetPixelRatio = 1.0;
  private cssWidth = 1;
  private cssHeight = 1;
  private currentPixelRatio = 1.0;
  private interactiveScrubActive = false;
  private halfResRenderedOnce = false;
  private lastPerspectiveProjY = DEFAULT_PERSPECTIVE_PROJ_Y;

  public constructor(renderer: WebGPURenderer, initialWidth = 1, initialHeight = 1) {
    this.renderer = renderer;
    this.cssWidth = Math.max(1, initialWidth);
    this.cssHeight = Math.max(1, initialHeight);

    this.restoreSettings();
    const rtWidth = Math.max(1, Math.round(this.cssWidth * this.currentPixelRatio));
    const rtHeight = Math.max(1, Math.round(this.cssHeight * this.currentPixelRatio));
    const halfW = Math.max(1, Math.floor(rtWidth * 0.5));
    const halfH = Math.max(1, Math.floor(rtHeight * 0.5));

    this.uResolution = uniform(new THREE.Vector2(rtWidth, rtHeight)).setGroup(renderGroup);
    this.uTexelSize = uniform(new THREE.Vector2(1 / rtWidth, 1 / rtHeight)).setGroup(renderGroup);
    this.uHalfTexelSize = uniform(new THREE.Vector2(1 / halfW, 1 / halfH)).setGroup(renderGroup);
    this.uExposure = uniform(renderer.toneMappingExposure).setGroup(renderGroup);
  }

  private assignTierSettings(settings: GraphicsTierSettings): void {
    this.tier = settings.tier;
    this.targetPixelRatio = Math.max(0.5, settings.pixelRatio);
    this.postEnabled = settings.postProcessing;
    this.ambientOcclusionEnabled = settings.postProcessing && settings.ambientOcclusion;
    this.fxaaEnabled = settings.postProcessing;
    this.bloomEnabled = settings.postProcessing && settings.bloom;
    this.sharpenEnabled = settings.postProcessing && settings.sharpen;
    this.motionBlurEnabled = settings.postProcessing && this.motionBlurUserOverride === true;
  }

  private syncRendererPixelRatio(): void {
    this.currentPixelRatio = clampPixelRatioForViewport(
      this.tier,
      this.targetPixelRatio,
      this.cssWidth,
      this.cssHeight
    );
    this.renderer.setPixelRatio(this.currentPixelRatio);
    this.renderer.setSize(this.cssWidth, this.cssHeight, false);

    const rtWidth = Math.max(1, Math.round(this.cssWidth * this.currentPixelRatio));
    const rtHeight = Math.max(1, Math.round(this.cssHeight * this.currentPixelRatio));
    const halfW = Math.max(1, Math.floor(rtWidth * 0.5));
    const halfH = Math.max(1, Math.floor(rtHeight * 0.5));
    this.uResolution.value.set(rtWidth, rtHeight);
    this.uTexelSize.value.set(1 / rtWidth, 1 / rtHeight);
    this.uHalfTexelSize.value.set(1 / halfW, 1 / halfH);
    if (this.scenePass) {
      this.scenePass.renderTarget.samples = 1;
    }
    if (this.halfResFxRtt) {
      const prevRt = this.halfResFxRtt.renderTarget;
      const sizeChanged = !prevRt || prevRt.width !== halfW || prevRt.height !== halfH;
      this.halfResFxRtt.setSize(halfW, halfH);
      if (sizeChanged) {
        this.halfResRenderedOnce = false;
      }
      this.syncHalfResAutoUpdate();
    }
    if (this.postEnabled) {
      this.bloom.setSize(halfW, halfH);
    }
  }

  private syncHalfResAutoUpdate(): boolean {
    const shouldUpdateHalfRes =
      (this.bloomEnabled || this.ambientOcclusionEnabled) &&
      (!this.interactiveScrubActive || !this.halfResRenderedOnce);
    if (this.halfResFxRtt) {
      this.halfResFxRtt.autoUpdate = shouldUpdateHalfRes;
      if (!shouldUpdateHalfRes) {
        this.halfResFxRtt.textureNeedsUpdate = false;
      } else if (!this.halfResRenderedOnce) {
        this.halfResFxRtt.textureNeedsUpdate = true;
      }
    }
    return shouldUpdateHalfRes;
  }

  public setInteractiveScrubActive(active: boolean): void {
    if (this.interactiveScrubActive === active) return;
    this.interactiveScrubActive = active;
    this.syncHalfResAutoUpdate();
    this.hasPrevMatrix = false;
  }

  public isInteractiveScrubActive(): boolean {
    return this.interactiveScrubActive;
  }

  public resize(cssWidth: number, cssHeight: number, pixelRatio?: number): void {
    this.cssWidth = Math.max(1, cssWidth);
    this.cssHeight = Math.max(1, cssHeight);
    if (typeof pixelRatio === 'number' && Number.isFinite(pixelRatio) && pixelRatio > 0) {
      this.targetPixelRatio = Math.max(0.5, pixelRatio);
    }
    this.syncRendererPixelRatio();
    this.hasPrevMatrix = false;
  }

  public resetHistory(): void {
    this.hasPrevMatrix = false;
  }

  public getSettings(): GraphicsSettingsState {
    return {
      quality: tierToPreset(this.tier),
      tier: this.tier,
      motionBlurEnabled: this.motionBlurEnabled,
      motionBlurStrength: this.motionBlurStrength,
      postProcessingEnabled: this.postEnabled,
      ambientOcclusionEnabled: this.ambientOcclusionEnabled,
      fxaaEnabled: this.fxaaEnabled,
      bloomEnabled: this.bloomEnabled,
      sharpenEnabled: this.sharpenEnabled,
      pixelRatio: this.currentPixelRatio,
    };
  }

  public applyTierSettings(settings: GraphicsTierSettings): void {
    const wasPostEnabled = this.postEnabled;
    this.assignTierSettings(settings);
    if (wasPostEnabled && !this.postEnabled) {
      this.dispose();
    }
    this.syncRendererPixelRatio();
    this.hasPrevMatrix = false;
    this.saveSettings();
  }

  public setQualityPreset(preset: GraphicsQualityPreset): void {
    this.applyTierSettings(getTierSettings(PRESET_TO_TIER[preset], currentDevicePixelRatio()));
  }

  public cycleQualityPreset(): GraphicsQualityPreset {
    const order: readonly GraphicsQualityPreset[] = ['ultra', 'balanced', 'performance'];
    const current = tierToPreset(this.tier);
    const next = order[(order.indexOf(current) + 1) % order.length]!;
    this.setQualityPreset(next);
    return next;
  }

  public isMotionBlurEnabled(): boolean {
    return this.motionBlurEnabled;
  }

  public setMotionBlurEnabled(enabled: boolean): void {
    this.motionBlurUserOverride = enabled;
    this.motionBlurEnabled = enabled;
    if (enabled) this.postEnabled = true;
    this.saveSettings();
  }

  public toggleMotionBlur(): boolean {
    this.setMotionBlurEnabled(!this.motionBlurEnabled);
    return this.motionBlurEnabled;
  }

  public isSsaoEnabled(): boolean {
    return this.ambientOcclusionEnabled;
  }

  public setSsaoEnabled(enabled: boolean): void {
    this.ambientOcclusionEnabled = enabled;
    if (enabled) this.postEnabled = true;
    this.syncHalfResAutoUpdate();
    this.saveSettings();
  }

  public isFxaaEnabled(): boolean {
    return this.fxaaEnabled;
  }

  public setFxaaEnabled(enabled: boolean): void {
    this.fxaaEnabled = enabled;
    if (enabled) this.postEnabled = true;
    this.saveSettings();
  }

  private saveSettings(): void {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          motionBlurUserOverride: this.motionBlurUserOverride,
        })
      );
    } catch {
      // Ignore storage quota or disabled storage errors
    }
  }

  private restoreSettings(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<{
        motionBlurUserOverride: unknown;
      }>;
      if (typeof parsed.motionBlurUserOverride === 'boolean') {
        this.motionBlurUserOverride = parsed.motionBlurUserOverride;
      }
    } catch {
      // Ignore malformed stored settings
    }
    void isGraphicsTier;
  }

  private ensurePostProcessing(
    renderer: WebGPURenderer,
    scene: THREE.Scene,
    camera: THREE.Camera
  ): PostProcessing {
    if (this.postProcessing && this.scenePass) {
      this.scenePass.scene = scene;
      this.scenePass.camera = camera;
      return this.postProcessing;
    }

    const scenePass = pass(scene, camera, { samples: 1 });
    scenePass.renderTarget.samples = 1;
    if (scenePass.renderTarget.depthTexture) {
      scenePass.renderTarget.depthTexture.minFilter = THREE.NearestFilter;
      scenePass.renderTarget.depthTexture.magFilter = THREE.NearestFilter;
      scenePass.renderTarget.depthTexture.generateMipmaps = false;
    }
    const passInternal = scenePass as unknown as {
      _width: number;
      _height: number;
      _pixelRatio: number;
      _resolution: number;
      renderTarget: THREE.RenderTarget;
      setSize: (width: number, height: number) => void;
    };
    passInternal.setSize = function (width: number, height: number): void {
      this._width = width;
      this._height = height;
      const effectiveWidth = Math.max(
        1,
        Math.floor(this._width * this._pixelRatio * this._resolution)
      );
      const effectiveHeight = Math.max(
        1,
        Math.floor(this._height * this._pixelRatio * this._resolution)
      );
      this.renderTarget.setSize(effectiveWidth, effectiveHeight);
    };
    scenePass.renderTarget.addEventListener('dispose', () => {
      for (const tex of scenePass.renderTarget.textures) {
        tex.version++;
      }
      if (scenePass.renderTarget.depthTexture) {
        scenePass.renderTarget.depthTexture.version++;
      }
    });
    this.scenePass = scenePass;

    const colorNode = scenePass.getTextureNode('output');
    const depthNode = scenePass.getTextureNode('depth');

    const postProcessing = new PostProcessing(renderer);
    postProcessing.outputColorTransform = false;
    postProcessing.outputNode = this.buildCompositeNode(colorNode, depthNode);
    this.postProcessing = postProcessing;
    return postProcessing;
  }

  private buildCompositeNode(
    colorNode: ShaderNodeObject<TextureNode>,
    depthNode: ShaderNodeObject<TextureNode>
  ): ShaderNodeObject<Node> {
    const sampleHdr = (sampleUv: ShaderNodeObject<Node>): ShaderNodeObject<Node> =>
      sampleClampedHdrRgb(colorNode, sampleUv);

    const toneMap = (hdrColor: ShaderNodeObject<Node>): ShaderNodeObject<Node> => {
      const base = agxToneMapping(hdrColor, this.uExposure);
      const contrasted = pow(max(base, vec3(0.0)), vec3(1.12));
      const agxLuma = dot(contrasted, vec3(0.2126, 0.7152, 0.0722));
      return clamp(vec3(agxLuma).add(contrasted.sub(agxLuma).mul(1.16)), 0.0, 1.0);
    };

    const gtaoUniforms = {
      uProjMatrix: this.uProjMatrix,
      uProjMatrixInverse: this.uProjMatrixInverse,
      uCameraWorldMatrix: this.uCameraWorldMatrix,
      uTexelSize: this.uTexelSize,
      uHalfTexelSize: this.uHalfTexelSize,
      uIsOrtho: this.uIsOrtho,
      uOrthoEquivDepth: this.uOrthoEquivDepth,
      uAoIntensity: this.uAoIntensity,
      uSunViewDir: this.uSunViewDir,
      uSunWorldDir: this.uSunWorldDir,
      uContactShadowStrength: this.uContactShadowStrength,
    };

    const fxaaUniforms = {
      uTexelSize: this.uTexelSize,
      uFxaaEnabled: this.uFxaaEnabled,
      uSharpenIntensity: this.uSharpenIntensity,
      uResolution: this.uResolution,
      uCurrInvViewProj: this.uCurrInvViewProj,
      uPrevViewProj: this.uPrevViewProj,
      uMotionBlurEnabled: this.uMotionBlurEnabled,
      uShutterScale: this.uShutterScale,
      uIsWebGPU: this.uIsWebGPU,
    };

    const rtWidth = Math.max(1, Math.round(this.cssWidth * this.currentPixelRatio));
    const rtHeight = Math.max(1, Math.round(this.cssHeight * this.currentPixelRatio));
    const initHalfW = Math.max(1, Math.floor(rtWidth * 0.5));
    const initHalfH = Math.max(1, Math.floor(rtHeight * 0.5));
    this.bloom.setSize(initHalfW, initHalfH);

    const halfResFxShader = Fn(() => {
      const hUv = uv();
      const hRawDepth = depthNode.sample(hUv).r.toVar();
      const hBloom = this.bloom.buildNode(colorNode, hUv).toVar();
      const hAo = float(1.0).toVar();
      If(hRawDepth.lessThan(0.9999), () => {
        hAo.assign(evaluateHalfResGtao(depthNode, hUv, hRawDepth, gtaoUniforms));
      });
      return vec4(hBloom, hAo);
    });

    const halfResFxRtt = rtt(
      halfResFxShader(),
      initHalfW,
      initHalfH,
      {
        type: THREE.HalfFloatType,
        depthBuffer: false,
      } as unknown as Parameters<typeof rtt>[3]
    );
    if (halfResFxRtt.renderTarget) {
      halfResFxRtt.renderTarget.depthBuffer = false;
    }
    const halfRt = halfResFxRtt.renderTarget;
    if (halfRt) {
      halfRt.texture.minFilter = THREE.LinearFilter;
      halfRt.texture.magFilter = THREE.LinearFilter;
      halfRt.addEventListener('dispose', () => {
        for (const tex of halfRt.textures) {
          tex.version++;
        }
      });
    }
    this.halfResRenderedOnce = false;
    this.halfResFxRtt = halfResFxRtt;
    this.syncHalfResAutoUpdate();

    const compositeShader = Fn(() => {
      const vUv = uv();
      const rawDepth = depthNode.sample(vUv).r.toVar();
      const centerColor = sampleHdr(vUv).toVar();
      const bloomColor = vec3(0.0).toVar();
      If(this.uHalfResFxWeight.greaterThan(0.001), () => {
        const halfFx = (
          halfResFxRtt.sample(clamp(vUv, 0.001, 0.999)) as unknown as ShaderNodeObject<TextureNode>
        )
          .level(float(0))
          .toVar();
        bloomColor.assign(halfFx.rgb.mul(this.uHalfResFxWeight));
      });
      const ldrOut = vec3(0.0).toVar();

      If(rawDepth.greaterThanEqual(0.9999), () => {
        ldrOut.assign(toneMap(centerColor.add(bloomColor)));
      });

      If(rawDepth.lessThan(0.9999), () => {
        const { hdrColor, speedPx } = evaluateMotionBlurOrFxaaCas(colorNode, vUv, rawDepth, centerColor, fxaaUniforms);

        const centerViewPos = getViewPosition(vUv, rawDepth, this.uProjMatrixInverse).toVar();
        const scaleDist = select(
          this.uIsOrtho.greaterThan(0.5),
          this.uOrthoEquivDepth,
          max(0.1, centerViewPos.z.negate())
        ).toVar();
        const centerViewNormal = reconstructMinDeltaViewNormal(
          depthNode,
          vUv,
          centerViewPos,
          this.uTexelSize,
          this.uProjMatrixInverse
        ).toVar();

        const motionFade = float(1.0).sub(clamp(speedPx.sub(4.0).div(18.0), 0.0, 0.65));
        const gtaoVis = float(1.0).toVar();
        const contactVis = float(1.0).toVar();

        If(this.uHalfResFxWeight.greaterThan(0.001).and(this.uAoIntensity.greaterThan(0.001)), () => {
          const upsampledAo = upsampleBilateralGtao(
            halfResFxRtt,
            depthNode,
            vUv,
            centerViewPos,
            centerViewNormal,
            gtaoUniforms
          );
          gtaoVis.assign(mix(float(1.0), upsampledAo, motionFade.mul(this.uHalfResFxWeight)));
          const rawContact = evaluateScreenSpaceContactShadow(
            depthNode,
            centerViewPos,
            centerViewNormal,
            scaleDist,
            gtaoUniforms
          );
          contactVis.assign(mix(float(1.0), rawContact, motionFade.mul(this.uHalfResFxWeight)));
        });

        const neighborE = sampleHdr(vUv.add(vec2(this.uTexelSize.x, 0.0)));
        const neighborN = sampleHdr(vUv.add(vec2(0.0, this.uTexelSize.y)));
        const lumaC = dot(centerColor, vec3(0.2126, 0.7152, 0.0722));
        const lumaE = dot(neighborE, vec3(0.2126, 0.7152, 0.0722));
        const lumaN = dot(neighborN, vec3(0.2126, 0.7152, 0.0722));
        const localLumaSpan = max(abs(lumaC.sub(lumaE)), abs(lumaC.sub(lumaN))).div(
          max(0.08, max(lumaC, max(lumaE, lumaN)))
        );

        const shadedHdr = applyPhotorealismShading(
          hdrColor,
          gtaoVis,
          contactVis,
          centerViewPos,
          centerViewNormal,
          scaleDist,
          min(1.0, localLumaSpan),
          this.uCameraWorldMatrix,
          this.uSunWorldDir
        );

        ldrOut.assign(toneMap(shadedHdr.add(bloomColor)));
      });

      return sRGBTransferOETF(vec4(ldrOut, 1.0));
    });

    return compositeShader();
  }

  public async withSceneCompileState(
    scene: THREE.Scene,
    camera: THREE.Camera,
    compileFn: () => Promise<unknown>,
    compileCompositeQuad = false
  ): Promise<void> {
    const getFrameBufferTarget = (
      this.renderer as unknown as {
        _getFrameBufferTarget?: () => THREE.RenderTarget | null;
      }
    )._getFrameBufferTarget;
    const frameBufferTarget =
      typeof getFrameBufferTarget === 'function' ? getFrameBufferTarget.call(this.renderer) : null;
    const rtSetter = this.renderer as unknown as {
      getRenderTarget: () => THREE.RenderTarget | null;
      setRenderTarget: (rt: THREE.RenderTarget | null) => void;
      getMRT?: () => unknown;
      setMRT?: (mrt: unknown) => void;
    };
    const prevRenderTarget = rtSetter.getRenderTarget();
    const prevMRT = typeof rtSetter.getMRT === 'function' ? rtSetter.getMRT() : null;

    if (!this.postEnabled) {
      try {
        if (frameBufferTarget) {
          rtSetter.setRenderTarget(frameBufferTarget);
        }
        await compileFn();
      } finally {
        if (frameBufferTarget) {
          rtSetter.setRenderTarget(prevRenderTarget);
        }
      }
      return;
    }

    const postProcessing = this.ensurePostProcessing(this.renderer, scene, camera);
    const postInternal = postProcessing as unknown as {
      _update?: () => void;
      _quadMesh?: THREE.Mesh & { camera?: THREE.Camera };
    };
    postInternal._update?.();

    const scenePass = this.scenePass!;
    scenePass.renderTarget.samples = 1;
    const getColorBufferType = (
      this.renderer as unknown as { getColorBufferType?: () => THREE.TextureDataType }
    ).getColorBufferType;
    if (typeof getColorBufferType === 'function') {
      scenePass.renderTarget.texture.type = getColorBufferType.call(this.renderer);
    }
    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    const passInternal = scenePass as unknown as {
      _pixelRatio: number;
      _mrt?: unknown;
      setSize: (w: number, h: number) => void;
    };
    passInternal._pixelRatio = this.renderer.getPixelRatio();
    passInternal.setSize(size.x, size.y);
    if (this.halfResFxRtt) {
      const fullW = Math.max(1, Math.floor(size.x * passInternal._pixelRatio));
      const fullH = Math.max(1, Math.floor(size.y * passInternal._pixelRatio));
      const halfW = Math.max(1, Math.floor(fullW * 0.5));
      const halfH = Math.max(1, Math.floor(fullH * 0.5));
      this.halfResFxRtt.setSize(halfW, halfH);
      this.uHalfTexelSize.value.set(1 / halfW, 1 / halfH);
    }

    const prevToneMapping = this.renderer.toneMapping;
    const prevColorSpace = this.renderer.outputColorSpace;

    try {
      this.renderer.toneMapping = THREE.NoToneMapping;
      this.renderer.outputColorSpace = THREE.ColorManagement.workingColorSpace;
      rtSetter.setRenderTarget(scenePass.renderTarget);
      if (typeof rtSetter.setMRT === 'function') {
        rtSetter.setMRT(passInternal._mrt ?? null);
      }
      await compileFn();

      if (compileCompositeQuad && postInternal._quadMesh && postInternal._quadMesh.camera) {
        if (typeof rtSetter.setMRT === 'function') {
          rtSetter.setMRT(prevMRT);
        }
        if (frameBufferTarget !== null) {
          rtSetter.setRenderTarget(frameBufferTarget);
          await this.renderer.compileAsync(postInternal._quadMesh, postInternal._quadMesh.camera);
        }

        const halfRttInternal = this.halfResFxRtt as unknown as {
          _rttNode?: Node | null;
          _quadMesh?: THREE.Mesh & {
            camera?: THREE.Camera;
            material?: THREE.Material & { fragmentNode?: Node | null };
          };
          renderTarget?: THREE.RenderTarget | null;
        } | null;
        if (
          halfRttInternal?._rttNode &&
          halfRttInternal._quadMesh?.camera &&
          halfRttInternal._quadMesh.material &&
          halfRttInternal.renderTarget
        ) {
          halfRttInternal._quadMesh.material.fragmentNode = halfRttInternal._rttNode;
          halfRttInternal._quadMesh.material.needsUpdate = true;
          rtSetter.setRenderTarget(halfRttInternal.renderTarget);
          await this.renderer.compileAsync(
            halfRttInternal._quadMesh,
            halfRttInternal._quadMesh.camera
          );
        }
      }
    } finally {
      const rendererInternal = this.renderer as unknown as {
        _handleObjectFunction?: unknown;
        _renderObjectDirect?: unknown;
      };
      if (
        rendererInternal._renderObjectDirect &&
        rendererInternal._handleObjectFunction !== rendererInternal._renderObjectDirect
      ) {
        rendererInternal._handleObjectFunction = rendererInternal._renderObjectDirect;
      }
      this.renderer.toneMapping = prevToneMapping;
      this.renderer.outputColorSpace = prevColorSpace;
      if (typeof rtSetter.setMRT === 'function') {
        rtSetter.setMRT(prevMRT);
      }
      rtSetter.setRenderTarget(prevRenderTarget);
    }
  }

  public render(scene: THREE.Scene, camera: RigCamera | THREE.Camera, dtSeconds: number): void {
    if (!this.postEnabled) {
      this.renderer.setRenderTarget(null);
      this.renderer.render(scene, camera);
      this.hasPrevMatrix = false;
      return;
    }

    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    this.currViewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.currInvViewProj.copy(this.currViewProj).invert();

    if (!this.hasPrevMatrix) {
      this.prevViewProj.copy(this.currViewProj);
      this.hasPrevMatrix = true;
    }

    let maxMatrixDelta = 0;
    const ce = this.currViewProj.elements;
    const pe = this.prevViewProj.elements;
    for (let i = 0; i < 16; i++) {
      const d = Math.abs(ce[i]! - pe[i]!);
      if (d > maxMatrixDelta) maxMatrixDelta = d;
    }
    const cameraMoved = maxMatrixDelta > 1e-5;

    const isOrtho = (camera as THREE.OrthographicCamera).isOrthographicCamera === true;
    const projElements = camera.projectionMatrix.elements;
    const projY = projElements[5]!;
    if (!isOrtho && projY > 1e-6) {
      this.lastPerspectiveProjY = projY;
    }

    this.uProjMatrix.value.copy(camera.projectionMatrix);
    this.uProjMatrixInverse.value.copy(camera.projectionMatrixInverse);
    this.uCameraWorldMatrix.value.copy(camera.matrixWorld);
    this.uIsOrtho.value = isOrtho ? 1.0 : 0.0;
    this.uOrthoEquivDepth.value = isOrtho
      ? this.lastPerspectiveProjY / Math.max(1e-6, projY)
      : 0.0;
    this.uIsWebGPU.value =
      this.renderer.coordinateSystem === THREE.WebGPUCoordinateSystem ? 1.0 : 0.0;
    this.uExposure.value = this.renderer.toneMappingExposure;

    const rawContactStrength = resolvePrimaryDirectionalSunSample(
      scene,
      camera,
      this.uSunViewDir.value,
      this.uSunWorldDir.value
    );

    if (cameraMoved) {
      this.uCurrInvViewProj.value.copy(this.currInvViewProj);
      this.uPrevViewProj.value.copy(this.prevViewProj);
    }

    const fpsNorm = THREE.MathUtils.clamp(1.0 / (Math.max(0.004, dtSeconds) * 60.0), 0.45, 1.65);
    const postActive = this.postEnabled;
    const scrubBypass = this.interactiveScrubActive;
    const hasHalfResFx = this.bloomEnabled || this.ambientOcclusionEnabled;
    const postProcessing = this.ensurePostProcessing(this.renderer, scene, camera);
    const shouldUpdateHalfRes = hasHalfResFx && (!scrubBypass || !this.halfResRenderedOnce);
    if (this.halfResFxRtt) {
      if (!shouldUpdateHalfRes) {
        this.halfResFxRtt.autoUpdate = false;
        this.halfResFxRtt.textureNeedsUpdate = false;
      } else if (!this.halfResFxRtt.autoUpdate) {
        this.halfResFxRtt.autoUpdate = true;
        this.halfResFxRtt.textureNeedsUpdate = true;
      }
    }
    this.uHalfResFxWeight.value = postActive && hasHalfResFx && !scrubBypass ? 1.0 : 0.0;
    this.uMotionBlurEnabled.value =
      postActive && !scrubBypass && this.motionBlurEnabled && !isOrtho && cameraMoved ? 1.0 : 0.0;
    this.uShutterScale.value = this.motionBlurStrength * fpsNorm;
    const aoActive = postActive && !scrubBypass && this.ambientOcclusionEnabled;
    this.uAoIntensity.value = aoActive ? AO_INTENSITY : 0.0;
    this.uContactShadowStrength.value = aoActive ? rawContactStrength : 0.0;
    this.bloom.setIntensity(
      postActive && !scrubBypass && this.bloomEnabled ? BLOOM_INTENSITY : 0.0
    );
    this.uSharpenIntensity.value = postActive && this.sharpenEnabled ? SHARPEN_INTENSITY : 0.0;
    this.uFxaaEnabled.value = postActive && !scrubBypass && this.fxaaEnabled ? 1.0 : 0.0;

    postProcessing.render();
    if (this.halfResFxRtt && this.halfResFxRtt.autoUpdate !== false) {
      this.halfResRenderedOnce = true;
    }

    this.prevViewProj.copy(this.currViewProj);
  }

  public dispose(): void {
    this.bloom.dispose();
    if (this.halfResFxRtt) {
      this.halfResFxRtt.renderTarget?.dispose();
      this.halfResFxRtt = null;
    }
    this.halfResRenderedOnce = false;
    if (this.scenePass) {
      this.scenePass.dispose();
      this.scenePass = null;
    }
    if (this.postProcessing) {
      this.postProcessing.dispose();
      this.postProcessing = null;
    }
  }
}
