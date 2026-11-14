import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ENGLISH_COUNTRYSIDE_HDR_SPEC } from '../../core/types/environment-hdri.ts';
import { DirectionalShadowController } from '../lighting/env/directional-shadow-controller.ts';
import {
  HdrEnvironmentManager,
  MAX_CACHED_CELLS,
  MOBILE_MAX_CACHED_CELLS,
  getMaxHdrCachedCells,
  type PmremTarget,
} from '../lighting/env/hdr-environment-manager.ts';
import {
  DEFAULT_MAX_HDR_DETAIL_WIDTH,
  MOBILE_MAX_HDR_DETAIL_WIDTH,
  computeEquirectHalfFloatUploadBytes,
  deriveDetailWebpUrl,
  resolveMaxHdrDetailWidth,
} from '../lighting/env/hdr-processing.ts';
import { buildSafeRequiredWebGpuLimits } from '../viewer/services/viewer-renderer.ts';
import {
  detectDeviceProfile,
  detectIOS,
  detectMobile,
  estimateInitialTier,
  resetEphemeralWebGlGpuProbeCache,
  type ExtendedNavigator,
} from './device-tier.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

afterEach(() => {
  resetEphemeralWebGlGpuProbeCache();
  vi.unstubAllGlobals();
});

describe('iOS & iPadOS detection and initial tier selection', () => {
  it('detects iPhone, iPod, explicit iPad, and iPadOS 13+ desktop-class Macintosh UA with maxTouchPoints > 1', () => {
    const iphoneNav = {
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1',
      maxTouchPoints: 5,
    } as unknown as ExtendedNavigator;
    expect(detectIOS(iphoneNav)).toBe(true);
    expect(detectMobile(iphoneNav)).toBe(true);

    const ipadosDesktopModeNav = {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
      maxTouchPoints: 5,
    } as unknown as ExtendedNavigator;
    expect(detectIOS(ipadosDesktopModeNav)).toBe(true);
    expect(detectMobile(ipadosDesktopModeNav)).toBe(true);

    const explicitIpadNav = {
      userAgent:
        'Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
      maxTouchPoints: 5,
    } as unknown as ExtendedNavigator;
    expect(detectIOS(explicitIpadNav)).toBe(true);
    expect(detectMobile(explicitIpadNav)).toBe(true);
  });

  it('never false-flags desktop macOS, Windows touch laptops, Linux desktops, or Android as iOS', () => {
    const macDesktopNav = {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      maxTouchPoints: 0,
    } as unknown as ExtendedNavigator;
    expect(detectIOS(macDesktopNav)).toBe(false);
    expect(detectMobile(macDesktopNav)).toBe(false);

    const windowsTouchLaptopNav = {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      maxTouchPoints: 10,
      userAgentData: { mobile: false },
    } as unknown as ExtendedNavigator;
    vi.stubGlobal('window', {
      innerWidth: 1920,
      innerHeight: 1080,
      matchMedia: () => ({ matches: false }),
    });
    expect(detectIOS(windowsTouchLaptopNav)).toBe(false);
    expect(detectMobile(windowsTouchLaptopNav)).toBe(false);

    const linuxDesktopNav = {
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      maxTouchPoints: 0,
    } as unknown as ExtendedNavigator;
    expect(detectIOS(linuxDesktopNav)).toBe(false);
    expect(detectMobile(linuxDesktopNav)).toBe(false);

    const androidNav = {
      userAgent:
        'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
      maxTouchPoints: 5,
    } as unknown as ExtendedNavigator;
    expect(detectIOS(androidNav)).toBe(false);
    expect(detectMobile(androidNav)).toBe(true);
  });

  it('honours ?mobile=1 and ?ios=1 URL query overrides for deterministic simulation', () => {
    const desktopNav = {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      maxTouchPoints: 0,
    } as unknown as ExtendedNavigator;

    vi.stubGlobal('window', {
      location: { search: '?mobile=1' },
      matchMedia: () => ({ matches: false }),
    });
    expect(detectMobile(desktopNav)).toBe(true);
    expect(detectIOS(desktopNav)).toBe(false);

    vi.stubGlobal('window', {
      location: { search: '?ios=1' },
      matchMedia: () => ({ matches: false }),
    });
    expect(detectIOS(desktopNav)).toBe(true);
    expect(detectMobile(desktopNav)).toBe(true);
  });

  it('assigns low initial graphics tier on iOS and iPadOS Safari so full-res HalfFloat post-processing and 2048 shadows do not blow unified jetsam RAM', () => {
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
      maxTouchPoints: 5,
      hardwareConcurrency: 8,
    });
    vi.stubGlobal('window', {
      devicePixelRatio: 2,
      innerWidth: 1180,
      innerHeight: 820,
      matchMedia: () => ({ matches: true }),
    });

    const profile = detectDeviceProfile();
    expect(profile.isIOS).toBe(true);
    expect(profile.isMobile).toBe(true);
    expect(
      estimateInitialTier({
        ...profile,
        gpuRenderer: 'Apple GPU',
        gpuVendor: 'Apple Inc.',
        maxTextureSize: 8192,
      })
    ).toBe('low');
  });
});

describe('Mobile HDRI resolution cap, cache bounds, preload suppression & WebGPU maxBufferSize safety', () => {
  it('caps mobile HDR detail width to <= 2048 and respects WebGPU maxBufferSize and maxTextureDimension2D on desktop', () => {
    expect(MOBILE_MAX_HDR_DETAIL_WIDTH).toBeLessThanOrEqual(2048);
    expect(
      resolveMaxHdrDetailWidth(
        { maxTextureDimension2D: 16384, maxBufferSize: 1024 * 1024 * 1024 },
        true
      )
    ).toBeLessThanOrEqual(2048);

    // 8192 x 4096 RGBA16F = 268,435,456 bytes (exact 256 MiB WebGPU default maxBufferSize)
    expect(computeEquirectHalfFloatUploadBytes(8192)).toBe(268_435_456);
    expect(
      resolveMaxHdrDetailWidth(
        { maxTextureDimension2D: 8192, maxBufferSize: 268_435_456 },
        false
      )
    ).toBe(DEFAULT_MAX_HDR_DETAIL_WIDTH);

    // Constrained 128 MiB maxBufferSize must clamp below 8192 so upload never exceeds device.limits.maxBufferSize
    const clampedFor128MiB = resolveMaxHdrDetailWidth(
      { maxTextureDimension2D: 8192, maxBufferSize: 128 * 1024 * 1024 },
      false
    );
    expect(clampedFor128MiB).toBeLessThan(8192);
    expect(computeEquirectHalfFloatUploadBytes(clampedFor128MiB)).toBeLessThanOrEqual(
      128 * 1024 * 1024
    );
  });

  it('never derives 8K or 4K WebP detail URLs on mobile or for _512.hdr preview stages', () => {
    expect(
      deriveDetailWebpUrl(
        '/textures/hdr/english_countryside_day_512.hdr',
        '/textures/hdr/english_countryside_day_4k.webp',
        false
      )
    ).toBeNull();
    expect(
      deriveDetailWebpUrl(
        '/textures/hdr/tur_langton_summer_day_clear_2k.hdr',
        '/textures/hdr/english_countryside_day_4k.webp',
        true
      )
    ).toBeNull();
    expect(
      deriveDetailWebpUrl('/textures/hdr/tur_langton_summer_day_clear_2k.hdr', undefined, true)
    ).toBeNull();
    expect(
      deriveDetailWebpUrl('/textures/hdr/tur_langton_summer_day_clear_2k.hdr', undefined, false)
    ).toBe('/textures/hdr/tur_langton_summer_day_clear_8k.webp');
  });

  it('caps MAX_CACHED_CELLS to <= 2 on mobile and suppresses background neighbour preloads on mobile', () => {
    expect(MOBILE_MAX_CACHED_CELLS).toBeLessThanOrEqual(2);
    expect(getMaxHdrCachedCells(true)).toBeLessThanOrEqual(2);
    expect(getMaxHdrCachedCells(false)).toBe(MAX_CACHED_CELLS);

    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
      maxTouchPoints: 5,
    });
    vi.stubGlobal('window', {
      location: { href: 'https://hus.example/?ios=1', search: '?ios=1' },
      matchMedia: () => ({ matches: true }),
    });

    const postedRequests: Array<{ url: string; detailUrl?: string | null; maxDetailWidth?: number }> = [];
    class MockHdrWorker {
      public onmessage: ((ev: unknown) => void) | null = null;
      public onerror: ((ev: unknown) => void) | null = null;
      public postMessage(req: { url: string; detailUrl?: string | null; maxDetailWidth?: number }): void {
        postedRequests.push(req);
      }
      public terminate(): void {}
    }
    vi.stubGlobal('Worker', MockHdrWorker);

    const fakeRenderer = {
      backend: { device: { limits: { maxTextureDimension2D: 8192, maxBufferSize: 268_435_456 } } },
    } as never;
    const scene = new THREE.Scene();
    const mgr = new HdrEnvironmentManager({
      scene,
      renderer: fakeRenderer,
      environment: ENGLISH_COUNTRYSIDE_HDR_SPEC,
      bakeEquirectPmrem: () => {
        const tex = new THREE.Texture();
        tex.mapping = THREE.CubeUVReflectionMapping;
        (tex as unknown as { isPMREMTexture: boolean }).isPMREMTexture = true;
        return { texture: tex, dispose: () => {} } as unknown as PmremTarget;
      },
      onApplyIntensities: () => {},
    });
    mgr.bakeProceduralEnvironments(fakeRenderer, 'day', new THREE.Vector3(0.4, 0.8, 0.3).normalize(), new THREE.Color(0x99b3cc), { query: { season: 'summer', time: 'day', weather: 'clear' } });

    mgr.applyEnvironmentTextures('day', new THREE.Vector3(0.4, 0.8, 0.3).normalize(), new THREE.Color(0x99b3cc), {
      query: { season: 'summer', time: 'day', weather: 'clear' },
    });

    expect(postedRequests).toHaveLength(1);
    expect(postedRequests[0]!.url).toContain('_512.hdr');
    expect(postedRequests[0]!.detailUrl).toBeNull();
    expect(postedRequests[0]!.maxDetailWidth).toBeLessThanOrEqual(2048);

    mgr.dispose();
  });
});

describe('Mobile shadow initialization & WebGPU adapter limit negotiation', () => {
  it('initializes DirectionalShadowController to 1024 on iOS instead of allocating a 4096^2 shadow map', () => {
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
      maxTouchPoints: 5,
    });
    const iosSun = new THREE.DirectionalLight(0xffffff, 1);
    const iosShadows = new DirectionalShadowController(iosSun);
    expect(iosSun.shadow.mapSize.x).toBe(1024);
    expect(iosSun.shadow.mapSize.y).toBe(1024);
    expect(iosShadows.getShadowMapSize()).toBe(1024);

    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      maxTouchPoints: 0,
    });
    vi.stubGlobal('window', {
      location: { search: '' },
      matchMedia: () => ({ matches: false }),
    });
    const desktopSun = new THREE.DirectionalLight(0xffffff, 1);
    const desktopShadows = new DirectionalShadowController(desktopSun);
    expect(desktopSun.shadow.mapSize.x).toBe(4096);
    expect(desktopShadows.getShadowMapSize()).toBe(4096);
  });

  it('negotiates elevated WebGPU adapter limits safely within mobile and desktop ceilings', () => {
    const mobileLimits = buildSafeRequiredWebGpuLimits(
      {
        maxSampledTexturesPerShaderStage: 32,
        maxSamplersPerShaderStage: 32,
        maxTextureDimension2D: 16384,
        maxBufferSize: 1024 * 1024 * 1024,
        maxStorageBufferBindingSize: 512 * 1024 * 1024,
      },
      true
    );
    expect(mobileLimits.maxSampledTexturesPerShaderStage).toBe(32);
    expect(mobileLimits.maxTextureDimension2D).toBe(4096);
    expect(mobileLimits.maxBufferSize).toBe(256 * 1024 * 1024);

    const desktopLimits = buildSafeRequiredWebGpuLimits(
      {
        maxSampledTexturesPerShaderStage: 48,
        maxTextureDimension2D: 16384,
        maxBufferSize: 1024 * 1024 * 1024,
      },
      false
    );
    expect(desktopLimits.maxSampledTexturesPerShaderStage).toBe(32);
    expect(desktopLimits.maxTextureDimension2D).toBe(8192);
    expect(desktopLimits.maxBufferSize).toBe(512 * 1024 * 1024);
  });
});

describe('Showcase homes mobile GPU memory budget (< 300 MB) & WebGPU sampled texture limit (<= 16)', () => {
  it(
    'keeps every showcase home strictly under 300 MB total GPU footprint and <= 16 sampled textures per fragment stage on iPhone & iPad Safari',
    async () => {
      const { stdout: raw } = await execFileAsync(
        process.execPath,
        [resolve(REPO_ROOT, 'tools/measure-ios-memory.mjs'), '--all-examples', '--json'],
        {
          cwd: REPO_ROOT,
          encoding: 'utf8',
          maxBuffer: 32 * 1024 * 1024,
        }
      );
      const rows = JSON.parse(raw) as Array<{
        houseId: string;
        profileKey: 'desktop' | 'iphone' | 'ipad';
        tier: string;
        maxTexDimension: number;
        maxSampledTextures: number;
        totalGpuMiB: number;
      }>;

      expect(rows.length).toBeGreaterThanOrEqual(9);
      for (const row of rows) {
        expect(
          row.maxSampledTextures,
          `${row.houseId} (${row.profileKey}) exceeded WebGPU default maxSampledTexturesPerShaderStage=16`
        ).toBeLessThanOrEqual(16);

        if (row.profileKey === 'iphone' || row.profileKey === 'ipad') {
          expect(row.tier).toBe('low');
          expect(row.maxTexDimension).toBeLessThanOrEqual(512);
          expect(
            row.totalGpuMiB,
            `${row.houseId} (${row.profileKey}) exceeded 300 MiB mobile GPU budget (${row.totalGpuMiB} MiB)`
          ).toBeLessThan(300);
        }
      }
    },
    120_000
  );
});
