import type { WebGPURenderer } from 'three/webgpu';
import type { GraphicsTier } from '../../core/types/twin-ux.ts';
import { compareTiers } from './tier-settings.ts';

/** Hardware signals collected once at boot. */
export interface DeviceProfile {
  /** Unmasked GPU renderer string when available (e.g. `ANGLE (NVIDIA, GeForce RTX 3070 ...)`). */
  readonly gpuRenderer: string;
  readonly gpuVendor: string;
  /** Logical CPU cores (`navigator.hardwareConcurrency`), 0 when unknown. */
  readonly hardwareConcurrency: number;
  /** Approximate RAM in GB (`navigator.deviceMemory`), null when unsupported. */
  readonly deviceMemoryGb: number | null;
  readonly devicePixelRatio: number;
  readonly isMobile: boolean;
  readonly isTouch: boolean;
  readonly maxTextureSize: number;
}

interface NavigatorUaData {
  readonly mobile?: boolean;
}

export type ExtendedNavigator = Navigator & {
  readonly deviceMemory?: number;
  readonly userAgentData?: NavigatorUaData;
};

interface WebGpuAdapterInfoLike {
  readonly description?: string;
  readonly device?: string;
  readonly vendor?: string;
  readonly architecture?: string;
  readonly isFallbackAdapter?: boolean;
}

interface WebGpuAdapterLike {
  readonly info?: WebGpuAdapterInfoLike;
  readonly adapterInfo?: WebGpuAdapterInfoLike;
  readonly isFallbackAdapter?: boolean;
}

interface WebGpuDeviceLike {
  readonly adapterInfo?: WebGpuAdapterInfoLike;
  readonly info?: WebGpuAdapterInfoLike;
  readonly limits?: {
    readonly maxTextureDimension2D?: number;
  };
}

interface RendererBackendLike {
  readonly isWebGPUBackend?: boolean;
  readonly isWebGLBackend?: boolean;
  readonly adapter?: WebGpuAdapterLike | null;
  readonly device?: WebGpuDeviceLike | null;
  readonly gl?: WebGLRenderingContext | WebGL2RenderingContext | null;
}

function isWebGlContext(ctx: unknown): ctx is WebGLRenderingContext | WebGL2RenderingContext {
  return (
    typeof ctx === 'object' &&
    ctx !== null &&
    'getParameter' in ctx &&
    typeof (ctx as WebGLRenderingContext).getParameter === 'function' &&
    'getExtension' in ctx &&
    typeof (ctx as WebGLRenderingContext).getExtension === 'function'
  );
}

function readStringParam(gl: WebGLRenderingContext | WebGL2RenderingContext, param: number): string {
  try {
    const value: unknown = gl.getParameter(param);
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

function readNumberParam(gl: WebGLRenderingContext | WebGL2RenderingContext, param: number): number {
  try {
    const value: unknown = gl.getParameter(param);
    return typeof value === 'number' ? value : 0;
  } catch {
    return 0;
  }
}

interface EphemeralWebGlGpuInfo {
  readonly renderer: string;
  readonly vendor: string;
}

let cachedEphemeralWebGlInfo: EphemeralWebGlGpuInfo | null = null;

/** Reset cached ephemeral WebGL probe (for deterministic unit tests). */
export function resetEphemeralWebGlGpuProbeCache(): void {
  cachedEphemeralWebGlInfo = null;
}

/**
 * Queries a tiny 1x1 offscreen WebGL context once when WebGPU hides or sanitizes
 * `GPUAdapter.info`, then immediately releases the context via `WEBGL_lose_context`.
 */
function probeEphemeralWebGlGpuInfo(): EphemeralWebGlGpuInfo {
  if (cachedEphemeralWebGlInfo) return cachedEphemeralWebGlInfo;
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return { renderer: '', vendor: '' };
  }
  let renderer = '';
  let vendor = '';
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const attrs: WebGLContextAttributes = {
      antialias: false,
      depth: false,
      stencil: false,
      alpha: false,
      powerPreference: 'high-performance',
    };
    const rawCtx =
      canvas.getContext('webgl2', attrs) ??
      canvas.getContext('webgl', attrs) ??
      canvas.getContext('experimental-webgl', attrs);
    if (isWebGlContext(rawCtx)) {
      try {
        const debugInfo = rawCtx.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          renderer = readStringParam(rawCtx, debugInfo.UNMASKED_RENDERER_WEBGL).trim();
          vendor = readStringParam(rawCtx, debugInfo.UNMASKED_VENDOR_WEBGL).trim();
        }
      } catch {
        // Ignore blocked debug extension
      }
      if (!renderer) renderer = readStringParam(rawCtx, rawCtx.RENDERER).trim();
      if (!vendor) vendor = readStringParam(rawCtx, rawCtx.VENDOR).trim();
      try {
        rawCtx.getExtension('WEBGL_lose_context')?.loseContext();
      } catch {
        // Ignore loseContext failures
      }
    }
    canvas.width = 0;
    canvas.height = 0;
  } catch {
    // Headless / sandboxed DOM without WebGL canvas support
  }
  cachedEphemeralWebGlInfo = { renderer, vendor };
  return cachedEphemeralWebGlInfo;
}

/**
 * Detects phones, tablets, and unfolded foldables (e.g. Google Pixel Fold unfolded ~884x736,
 * where `userAgentData.mobile === false` and Chrome Android's "Desktop site" strips `"Android"`).
 */
export function detectMobile(
  nav: ExtendedNavigator | null = typeof navigator !== 'undefined' ? navigator : null
): boolean {
  if (!nav) return false;
  if (typeof nav.userAgentData?.mobile === 'boolean' && nav.userAgentData.mobile) return true;
  const ua = nav.userAgent || '';
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|Opera Mini|IEMobile|Pixel\s+Fold|SM-F9/i.test(ua)) {
    return true;
  }
  // iPadOS 13+ reports a desktop Mac user agent but has multi-touch.
  if (/Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1) return true;

  if (typeof window !== 'undefined') {
    // Primary check: every phone, foldable, and tablet — even under Chrome Android "Desktop site"
    // mode where UA is Linux x86_64, userAgentData.mobile is false, and screen.width is 2208 —
    // reports `(hover: none) and (pointer: coarse)`, whereas touchscreen Windows/Mac laptops
    // report `(hover: hover)` and `(pointer: fine)`.
    if (
      (nav.maxTouchPoints || 0) >= 1 &&
      Boolean(window.matchMedia?.('(hover: none) and (pointer: coarse)')?.matches)
    ) {
      return true;
    }

    // Secondary fallback when `(hover: none)` isn't evaluated/supported:
    if (
      (nav.maxTouchPoints || 0) >= 2 &&
      Boolean(window.matchMedia?.('(pointer: coarse)')?.matches)
    ) {
      const sw = window.screen?.width || window.innerWidth || 0;
      const sh = window.screen?.height || window.innerHeight || 0;
      const shortEdge = Math.min(sw, sh);
      if (shortEdge > 0 && shortEdge <= 1024) {
        return true;
      }
    }
  }
  return false;
}

/**
 * True only in a real browser mobile/foldable session (never in Node/Vitest `process` workers),
 * used to guard build-time mobile material/geometry fast-paths so Vitest, `snapshot:check`, and
 * `lighting:check` stay bit-for-bit identical.
 */
export function isRealBrowserMobile(): boolean {
  return typeof process === 'undefined' && detectMobile();
}

function isGenericGpuString(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.length === 0 ||
    /^(?:webgpu(?:\s+hardware\s+adapter)?|unknown(?:-gpu)?|generic\s+gpu)$/i.test(trimmed)
  );
}

/** Collects GPU and device signals used to pick an initial graphics tier. */
export function detectDeviceProfile(
  renderer?: WebGPURenderer | null
): DeviceProfile {
  const backend = (renderer as unknown as { readonly backend?: RendererBackendLike } | null | undefined)?.backend;
  const gl: WebGLRenderingContext | WebGL2RenderingContext | null = isWebGlContext(backend?.gl)
    ? backend.gl
    : null;

  let gpuRenderer = '';
  let gpuVendor = '';
  let maxTextureSize = 8192;

  if (gl) {
    try {
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        gpuRenderer = readStringParam(gl, debugInfo.UNMASKED_RENDERER_WEBGL);
        gpuVendor = readStringParam(gl, debugInfo.UNMASKED_VENDOR_WEBGL);
      }
    } catch {
      // Extension unavailable; fall back to standard parameters below.
    }
    // Firefox deprecates the extension but returns the sanitized renderer from RENDERER directly.
    if (!gpuRenderer) gpuRenderer = readStringParam(gl, gl.RENDERER);
    if (!gpuVendor) gpuVendor = readStringParam(gl, gl.VENDOR);
    maxTextureSize = readNumberParam(gl, gl.MAX_TEXTURE_SIZE) || 8192;
  } else {
    // Chrome WebGPU exposes GPUAdapterInfo at `adapter.info` (not `device.adapterInfo`).
    const info =
      backend?.adapter?.info ??
      backend?.adapter?.adapterInfo ??
      backend?.device?.adapterInfo ??
      backend?.device?.info;
    const parts = [info?.description, info?.device, info?.architecture].filter(
      (part): part is string => typeof part === 'string' && part.trim().length > 0
    );
    const rawVendor =
      typeof info?.vendor === 'string' && info.vendor.trim().length > 0 ? info.vendor.trim() : '';
    gpuRenderer = parts.join(' ').trim();
    gpuVendor = rawVendor || 'WebGPU';

    // When WebGPU masks adapter description/device (returning "" or only vendor/arch),
    // query a 1x1 ephemeral offscreen WebGL context's UNMASKED_RENDERER_WEBGL once so
    // Mali-G710 / Adreno / PowerVR / RTX models are accurately identified under WebGPU.
    if (isGenericGpuString(gpuRenderer) || classifyGpu(gpuRenderer) === null) {
      const probed = probeEphemeralWebGlGpuInfo();
      if (!isGenericGpuString(probed.renderer)) {
        gpuRenderer = probed.renderer;
      }
      if ((!rawVendor || /^webgpu$/i.test(gpuVendor)) && probed.vendor) {
        gpuVendor = probed.vendor;
      }
    }

    if (!gpuRenderer && rawVendor) {
      gpuRenderer = rawVendor;
    }
    if (
      Boolean(backend?.adapter?.isFallbackAdapter || info?.isFallbackAdapter) &&
      !/swiftshader|llvmpipe|software/i.test(gpuRenderer)
    ) {
      gpuRenderer = gpuRenderer ? `${gpuRenderer} (SwiftShader Fallback)` : 'SwiftShader Fallback';
    }
    if (!gpuRenderer) {
      gpuRenderer = 'WebGPU Hardware Adapter';
    }

    const limitTex = backend?.device?.limits?.maxTextureDimension2D;
    maxTextureSize = typeof limitTex === 'number' && limitTex > 0 ? limitTex : 8192;
  }

  const nav: ExtendedNavigator | null = typeof navigator !== 'undefined' ? navigator : null;
  const deviceMemory = nav?.deviceMemory;
  const isMobile = detectMobile(nav);
  const hasFineDesktopPointer =
    !isMobile &&
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    (window.matchMedia('(pointer: fine)').matches ||
      window.matchMedia('(hover: hover) and (pointer: fine)').matches);
  const isTouch =
    !hasFineDesktopPointer &&
    ((nav?.maxTouchPoints ?? 0) > 0 ||
      (typeof window !== 'undefined' && 'ontouchstart' in window));

  return {
    gpuRenderer,
    gpuVendor,
    hardwareConcurrency: nav?.hardwareConcurrency ?? 0,
    deviceMemoryGb: typeof deviceMemory === 'number' && deviceMemory > 0 ? deviceMemory : null,
    devicePixelRatio:
      typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1,
    isMobile,
    isTouch,
    maxTextureSize,
  };
}

/** Stable cache key for a device (GPU string + DPR bucket). */
export function getDeviceCacheKey(profile: DeviceProfile): string {
  const gpu = (profile.gpuRenderer || 'unknown-gpu').trim().toLowerCase();
  return `${gpu}|dpr${Math.round(profile.devicePixelRatio * 4) / 4}`;
}

interface GpuRule {
  readonly pattern: RegExp;
  readonly tier: GraphicsTier;
}

/** First match wins. Order from most specific to most generic. */
const GPU_RULES: readonly GpuRule[] = [
  // Software rasterizers.
  { pattern: /swiftshader|llvmpipe|softpipe|software|basic render|mesa offscreen/i, tier: 'low' },
  // Flagship discrete GPUs.
  { pattern: /rtx\s*(30[6-9]0|40[6-9]0|50[6-9]0|a[4-6]000)|radeon\s*rx\s*(6[7-9]|7[7-9]|9[0-9])\d\d/i, tier: 'ultra' },
  { pattern: /apple\s*m\d+\s*(pro|max|ultra)/i, tier: 'ultra' },
  // Strong discrete / Apple silicon.
  { pattern: /apple\s*m\d+/i, tier: 'high' },
  { pattern: /\brtx\b|quadro|titan|gtx\s*(10[5-8]0|16[5-6]0)|tesla|nvidia\s*a\d{2,3}/i, tier: 'high' },
  { pattern: /radeon\s*(rx|pro)\b/i, tier: 'high' },
  { pattern: /intel.*\barc\b/i, tier: 'high' },
  // Mid-range desktop & flagship Snapdragon Adreno (730+ / 8xx).
  { pattern: /gtx|geforce|nvidia/i, tier: 'medium' },
  { pattern: /iris\s*\(?r?\)?\s*xe/i, tier: 'medium' },
  { pattern: /radeon.*(vega|graphics|680m|780m|890m)/i, tier: 'medium' },
  { pattern: /adreno.*\b(7[3-9]\d|8\d\d)\b/i, tier: 'medium' },
  { pattern: /apple\s*gpu/i, tier: 'medium' },
  // Weak integrated / mobile TBDR GPUs (Arm Mali / Valhall / Bifrost, PowerVR, Adreno <= 729).
  { pattern: /intel.*(uhd|hd\s*graphics|iris)|intel\(r\)\s*(uhd|hd)/i, tier: 'low' },
  {
    pattern:
      /\bmali\b|\bvalhall\b|\bbifrost\b|\bmidgard\b|\bimmortalis\b|powervr|imgtec|imagination|adreno|videocore|tegra|radeon\s*r[2-7]\b|^arm$/i,
    tier: 'low',
  },
];

function minTier(a: GraphicsTier, b: GraphicsTier): GraphicsTier {
  return compareTiers(a, b) <= 0 ? a : b;
}

/** Tier implied by the GPU string alone, or null when the GPU is not recognised. */
export function classifyGpu(gpuRenderer: string): GraphicsTier | null {
  for (const rule of GPU_RULES) {
    if (rule.pattern.test(gpuRenderer)) return rule.tier;
  }
  return null;
}

/**
 * Heuristic initial tier from hardware signals only.
 *
 * - Software rasterizers, Intel UHD/HD/Iris (non-Xe), Mali, PowerVR, Adreno <= 729 → low.
 * - Apple M-series, RTX, Radeon RX/Pro, Intel Arc → high; flagship RTX/RX/M Pro/Max → ultra.
 * - Unknown GPUs default to medium (or low when GPU vendor is Arm/ImgTec/Qualcomm without model).
 * - Device caps: mobile/foldable / ≤4 GB RAM / ≤4 cores → at most medium; ≤2 GB RAM / ≤2 cores /
 *   max texture size < 4096 → low. Ultra additionally requires ≥8 cores on desktop.
 */
export function estimateInitialTier(profile: DeviceProfile): GraphicsTier {
  let gpuTier = classifyGpu(profile.gpuRenderer);
  if (gpuTier === null && /\b(arm|imgtec|imagination)\b/i.test(profile.gpuVendor)) {
    gpuTier = 'low';
  }
  let tier: GraphicsTier = gpuTier ?? 'medium';

  // Safari on macOS masks every GPU as "Apple GPU", and desktop Chrome/Safari WebGPU may mask
  // adapterInfo while reporting "WebGPU Hardware Adapter" or vendor "apple"/"nvidia"/"amd".
  if (
    !profile.isMobile &&
    !profile.isTouch &&
    gpuTier === null &&
    (/apple\s*gpu|webgpu\s*hardware\s*adapter/i.test(profile.gpuRenderer) ||
      /^(apple|nvidia|amd)\b/i.test(profile.gpuVendor))
  ) {
    tier = 'high';
  } else if (/apple\s*gpu/i.test(profile.gpuRenderer) && !profile.isMobile && !profile.isTouch) {
    tier = 'high';
  }

  const cores = profile.hardwareConcurrency;
  const memory = profile.deviceMemoryGb;

  if (profile.isMobile) tier = minTier(tier, 'medium');
  if (memory !== null && memory <= 4) tier = minTier(tier, 'medium');
  if (cores > 0 && cores <= 4) tier = minTier(tier, 'medium');
  if (tier === 'ultra' && cores > 0 && cores < 8) tier = 'high';

  if (memory !== null && memory <= 2) tier = 'low';
  if (cores > 0 && cores <= 2) tier = 'low';
  if (profile.maxTextureSize > 0 && profile.maxTextureSize < 4096) tier = 'low';

  return tier;
}
