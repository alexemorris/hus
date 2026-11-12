import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyGpu,
  detectDeviceProfile,
  detectMobile,
  estimateInitialTier,
  getDeviceCacheKey,
  resetEphemeralWebGlGpuProbeCache,
  type DeviceProfile,
} from './device-tier.ts';

const DESKTOP: DeviceProfile = {
  gpuRenderer: '',
  gpuVendor: '',
  hardwareConcurrency: 16,
  deviceMemoryGb: 16,
  devicePixelRatio: 2,
  isMobile: false,
  isTouch: false,
  maxTextureSize: 16384,
};

afterEach(() => {
  resetEphemeralWebGlGpuProbeCache();
  vi.unstubAllGlobals();
});

describe('classifyGpu', () => {
  it.each([
    ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', 'low'],
    ['llvmpipe (LLVM 15.0.7, 256 bits)', 'low'],
    ['ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ultra'],
    ['Apple M2 Max', 'ultra'],
    ['Apple M1', 'high'],
    ['NVIDIA GeForce RTX 2060', 'high'],
    ['AMD Radeon RX 580', 'high'],
    ['NVIDIA GeForce GTX 960', 'medium'],
    ['Intel(R) Iris(R) Xe Graphics', 'medium'],
    ['Adreno (TM) 740', 'medium'],
    ['Adreno (TM) 720', 'low'],
    ['Adreno (TM) 650', 'low'],
    ['Intel(R) UHD Graphics 620', 'low'],
    ['Mali-G78 MP14', 'low'],
    ['ANGLE (ARM, Mali-G710, OpenGL ES 3.2)', 'low'],
    ['PowerVR Rogue GE8320', 'low'],
  ] as const)('%s -> %s', (renderer, tier) => {
    expect(classifyGpu(renderer)).toBe(tier);
  });

  it('returns null for unknown GPUs', () => {
    expect(classifyGpu('Totally Unknown Accelerator 9000')).toBeNull();
    expect(classifyGpu('')).toBeNull();
  });
});

describe('detectMobile & WebGPU Pixel Fold Mali-G710 detection', () => {
  it('detects unfolded Google Pixel Fold even when userAgentData.mobile is false and Desktop site strips Android from UA', () => {
    vi.stubGlobal('window', {
      innerWidth: 884,
      innerHeight: 736,
      screen: { width: 884, height: 736 },
      devicePixelRatio: 2.5,
      matchMedia: (q: string) => ({ matches: q === '(pointer: coarse)' }),
    });
    const unfoldedPixelFoldNav = {
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      userAgentData: { mobile: false },
      maxTouchPoints: 5,
      hardwareConcurrency: 8,
      deviceMemory: 8,
    };
    expect(detectMobile(unfoldedPixelFoldNav as never)).toBe(true);
  });

  it('does not treat a desktop PC with fine pointer as mobile', () => {
    vi.stubGlobal('window', {
      innerWidth: 1920,
      innerHeight: 1080,
      screen: { width: 1920, height: 1080 },
      devicePixelRatio: 2,
      matchMedia: () => ({ matches: false }),
    });
    const desktopTouchLaptop = {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
      userAgentData: { mobile: false },
      maxTouchPoints: 10,
      hardwareConcurrency: 16,
      deviceMemory: 16,
    };
    expect(detectMobile(desktopTouchLaptop as never)).toBe(false);
  });

  it('reads WebGPU backend.adapter.info and falls back to ephemeral WebGL UNMASKED_RENDERER_WEBGL when masked', () => {
    let lostContext = false;
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        if (tag !== 'canvas') return {};
        return {
          width: 1,
          height: 1,
          getContext: () => ({
            RENDERER: 0x1f01,
            VENDOR: 0x1f00,
            getExtension: (name: string) => {
              if (name === 'WEBGL_debug_renderer_info') {
                return { UNMASKED_RENDERER_WEBGL: 0x9246, UNMASKED_VENDOR_WEBGL: 0x9245 };
              }
              if (name === 'WEBGL_lose_context') {
                return {
                  loseContext: () => {
                    lostContext = true;
                  },
                };
              }
              return null;
            },
            getParameter: (p: number) => {
              if (p === 0x9246) return 'ANGLE (ARM, Mali-G710, OpenGL ES 3.2)';
              if (p === 0x9245) return 'Google Inc. (ARM)';
              return '';
            },
          }),
        };
      },
    });
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0',
      userAgentData: { mobile: false },
      maxTouchPoints: 5,
      hardwareConcurrency: 8,
      deviceMemory: 8,
    });
    vi.stubGlobal('window', {
      innerWidth: 884,
      innerHeight: 736,
      screen: { width: 884, height: 736 },
      devicePixelRatio: 2.5,
      matchMedia: (q: string) => ({ matches: q === '(pointer: coarse)' }),
    });

    const fakeWebGpuRenderer = {
      backend: {
        isWebGPUBackend: true,
        adapter: { info: { vendor: '', architecture: '', device: '', description: '' } },
        device: { limits: { maxTextureDimension2D: 8192 } },
      },
    };

    const profile = detectDeviceProfile(fakeWebGpuRenderer as never);
    expect(lostContext).toBe(true);
    expect(profile.gpuRenderer).toContain('Mali-G710');
    expect(profile.isMobile).toBe(true);
    expect(estimateInitialTier(profile)).toBe('low');
  });
  it('detects unfolded Pixel Fold in Chrome Android "Desktop site" mode even when screen is 2208x1840 (> 1024)', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      userAgentData: { mobile: false },
      maxTouchPoints: 5,
      hardwareConcurrency: 8,
      deviceMemory: 8,
    });
    vi.stubGlobal('window', {
      innerWidth: 980,
      innerHeight: 816,
      screen: { width: 2208, height: 1840 },
      devicePixelRatio: 2.5,
      matchMedia: (q: string) => ({
        matches: q === '(hover: none) and (pointer: coarse)' || q === '(pointer: coarse)',
      }),
    });

    expect(detectMobile()).toBe(true);

    // Touchscreen laptop with fine trackpad/mouse pointer + hover remains desktop (false)
    vi.stubGlobal('window', {
      innerWidth: 1440,
      innerHeight: 900,
      screen: { width: 1440, height: 900 },
      devicePixelRatio: 2,
      matchMedia: (q: string) => ({
        matches: q === '(hover: hover) and (pointer: fine)',
      }),
    });
    expect(detectMobile()).toBe(false);
    const desktopProfile = detectDeviceProfile({
      backend: {
        isWebGPUBackend: true,
        adapter: { info: { vendor: 'nvidia', description: 'NVIDIA GeForce RTX 5080' } },
        device: { limits: { maxTextureDimension2D: 16384 } },
      },
    } as never);
    expect(desktopProfile.isMobile).toBe(false);
    expect(desktopProfile.isTouch).toBe(false);
    expect(estimateInitialTier(desktopProfile)).toBe('ultra');
  });

});

describe('estimateInitialTier', () => {
  it('defaults unknown GPUs to medium', () => {
    expect(estimateInitialTier({ ...DESKTOP, gpuRenderer: 'mystery' })).toBe('medium');
  });

  it('treats desktop Safari "Apple GPU" as high', () => {
    expect(estimateInitialTier({ ...DESKTOP, gpuRenderer: 'Apple GPU' })).toBe('high');
  });

  it('caps by device capabilities', () => {
    const rtx = { ...DESKTOP, gpuRenderer: 'NVIDIA GeForce RTX 4090' };
    expect(estimateInitialTier(rtx)).toBe('ultra');
    expect(estimateInitialTier({ ...rtx, hardwareConcurrency: 6 })).toBe('high');
    expect(estimateInitialTier({ ...rtx, isMobile: true })).toBe('medium');
    expect(estimateInitialTier({ ...rtx, deviceMemoryGb: 2 })).toBe('low');
    expect(estimateInitialTier({ ...rtx, maxTextureSize: 2048 })).toBe('low');
  });

  it('builds a stable cache key', () => {
    expect(getDeviceCacheKey({ ...DESKTOP, gpuRenderer: '  Apple M1 ', devicePixelRatio: 2.1 })).toBe(
      'apple m1|dpr2'
    );
    expect(getDeviceCacheKey(DESKTOP)).toBe('unknown-gpu|dpr2');
  });
});
