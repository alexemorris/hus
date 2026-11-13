import { EnvironmentLighting } from '../environment-lighting.ts';
import {
  SHARED_SUN_SHADOW_PENUMBRA,
  evaluateCloudTransmittanceCpu,
  uCloudGoboParams,
  uCloudSunDir,
} from '../shader-light-culling.ts';
import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_HUS_LOCATION } from '../../../core/types/solar-weather.ts';
import { ENV_PRESETS, environmentRotationForSun } from './env-presets.ts';
import {
  SITE_SHADOW_BOX,
  copyEnvState,
  fitShadowFrustum,
  lerpEnvState,
  stateFromPreset,
  sunPlacement,
} from './env-state.ts';
import { buildMeadowTextureData, createSiteGround } from './site-ground.ts';
import { compassAzimuthAltitudeToWorldVector } from './solar-astronomy.ts';
import {
  bakeProceduralSky,
  deriveDetailWebpUrl,
  deriveFallbackDetailWebpUrl,
  environmentRotationForTrueNorth,
  prepareHdrBuffers,
  fuseGainmapDetailToHalfFloat,
  prepareHdrPanorama,
} from './hdr-processing.ts';

/** World azimuth at which three.js shows a panorama column `u` under environment rotation `theta`. */
function worldAzimuthOfPanoramaColumn(u: number, theta: number): number {
  const hdrAzimuth = (u - 0.5) * Math.PI * 2;
  // three rotates the lookup direction by −θ, so panorama azimuth φ appears at world azimuth φ − θ.
  const dir = new THREE.Vector3(Math.cos(hdrAzimuth), 0, Math.sin(hdrAzimuth));
  dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), theta);
  return Math.atan2(dir.z, dir.x);
}

describe('environmentRotationForSun', () => {
  it.each(['day', 'dusk', 'night'] as const)('puts the %s HDR sun disc on the sun light azimuth', (mode) => {
    const cfg = ENV_PRESETS[mode];
    const theta = environmentRotationForSun(cfg.sunDirection, cfg.hdrSunU);
    const expected = Math.atan2(cfg.sunDirection[2], cfg.sunDirection[0]);
    const actual = worldAzimuthOfPanoramaColumn(cfg.hdrSunU, theta);
    const diff = Math.atan2(Math.sin(actual - expected), Math.cos(actual - expected));
    expect(Math.abs(diff)).toBeLessThan(1e-9);
    expect(theta).toBeGreaterThan(-Math.PI);
    expect(theta).toBeLessThanOrEqual(Math.PI);
  });

  it('matches the hand-tuned legacy day rotation for the legacy sun position', () => {
    expect(Math.abs(environmentRotationForSun([6.5, 14.5, -13.5], 0.6) - 1.81)).toBeLessThan(0.1);
  });

  it('locks True-North worldAnchored panoramas (N=0, E=0.25, S=0.5, W=0.75) to compassAzimuthAltitudeToWorldVector across any plusXTrueBearingDeg', () => {
    for (const bearing of [0, 90, 180, 270, 340.17, 132.5]) {
      const theta = environmentRotationForTrueNorth(bearing, 0);
      for (const [u, compassDeg] of [
        [0.0, 0],
        [0.25, 90],
        [0.5, 180],
        [0.75, 270],
      ] as const) {
        const worldVec = compassAzimuthAltitudeToWorldVector(
          (compassDeg * Math.PI) / 180,
          0,
          bearing
        );
        const expectedWorldAz = Math.atan2(worldVec.z, worldVec.x);
        const actualWorldAz = worldAzimuthOfPanoramaColumn(u, theta);
        const diff = Math.atan2(
          Math.sin(actualWorldAz - expectedWorldAz),
          Math.cos(actualWorldAz - expectedWorldAz)
        );
        expect(Math.abs(diff)).toBeLessThan(1e-9);
      }
    }
  });
});

describe('presets', () => {
  it('reads as daylight > dusk > night', () => {
    const { day, dusk, night } = ENV_PRESETS;
    expect(day.sunIntensity).toBeGreaterThan(dusk.sunIntensity);
    expect(dusk.sunIntensity).toBeGreaterThan(night.sunIntensity);
    expect(day.envIntensity).toBeGreaterThan(dusk.envIntensity);
    expect(dusk.envIntensity).toBeGreaterThan(night.envIntensity);
    // Night IBL and hemi fill stay low so interiors are lit by the fittings.
    expect(night.envIntensity).toBeLessThanOrEqual(0.1);
    expect(night.hemiIntensity).toBeLessThanOrEqual(0.1);
    expect(day.hemiIntensity).toBeGreaterThan(dusk.hemiIntensity);
    expect(dusk.hemiIntensity).toBeGreaterThan(night.hemiIntensity);
  });

  it('keeps the sun above the horizon', () => {
    for (const cfg of Object.values(ENV_PRESETS)) {
      expect(cfg.sunDirection[1]).toBeGreaterThan(0);
    }
  });
});

describe('fitShadowFrustum', () => {
  it.each(['day', 'dusk', 'night'] as const)('contains every site corner for the %s sun', (mode) => {
    const dir = new THREE.Vector3(...ENV_PRESETS[mode].sunDirection).normalize();
    const { position, target } = sunPlacement(dir);
    const f = fitShadowFrustum(position, target, SITE_SHADOW_BOX, 0);
    const cam = new THREE.OrthographicCamera(f.left, f.right, f.top, f.bottom, f.near, f.far);
    cam.position.copy(position);
    cam.lookAt(target);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    const b = SITE_SHADOW_BOX;
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Vector3(
        i & 1 ? b.max[0] : b.min[0],
        i & 2 ? b.max[1] : b.min[1],
        i & 4 ? b.max[2] : b.min[2]
      ).project(cam);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(1 + 1e-6);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(1 + 1e-6);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(1 + 1e-6);
    }
    expect(f.near).toBeGreaterThan(0);
  });
});

describe('lerpEnvState', () => {
  it('hits both endpoints and stays between them', () => {
    const a = stateFromPreset(ENV_PRESETS.day);
    const b = stateFromPreset(ENV_PRESETS.night);
    const out = stateFromPreset(ENV_PRESETS.dusk);
    lerpEnvState(a, b, 0, out);
    expect(out.sunIntensity).toBeCloseTo(a.sunIntensity);
    expect(out.sunDirection.distanceTo(a.sunDirection)).toBeLessThan(1e-6);
    lerpEnvState(a, b, 1, out);
    expect(out.exposure).toBeCloseTo(b.exposure);
    expect(out.sunDirection.distanceTo(b.sunDirection)).toBeLessThan(1e-6);
    lerpEnvState(a, b, 0.5, out);
    expect(out.envIntensity).toBeLessThan(a.envIntensity);
    expect(out.envIntensity).toBeGreaterThan(b.envIntensity);
    expect(out.sunDirection.length()).toBeCloseTo(1);
  });

  it('copies state', () => {
    const a = stateFromPreset(ENV_PRESETS.day);
    const out = copyEnvState(a, stateFromPreset(ENV_PRESETS.night));
    expect(out.fogColor.getHex()).toBe(a.fogColor.getHex());
    expect(out.fogDensity).toBeCloseTo(a.fogDensity);
  });
});

describe('site ground meadow texture', () => {
  it('is deterministic, opaque and pasture-green', () => {
    const a = buildMeadowTextureData(32, 7);
    const b = buildMeadowTextureData(32, 7);
    expect(a).toEqual(b);
    expect(a.length).toBe(32 * 32 * 4);
    let r = 0;
    let g = 0;
    let bl = 0;
    for (let i = 0; i < a.length; i += 4) {
      r += a[i]!;
      g += a[i + 1]!;
      bl += a[i + 2]!;
      expect(a[i + 3]).toBe(255);
    }
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(bl);
  });
});

describe('HDR panorama full-resolution fidelity', () => {
  it('preserves full 2K (2048x1024) skybox & PMREM envSource resolution with 0 downsampling and 512x256 procedural sky', () => {
    const srcW = 2048;
    const srcH = 1024;
    const src = new Float32Array(srcW * srcH * 4);
    for (let i = 0; i < src.length; i += 4) {
      src[i] = 0.8 + ((i * 7) % 100) * 0.01;
      src[i + 1] = 0.9 + ((i * 13) % 100) * 0.01;
      src[i + 2] = 1.2 + ((i * 17) % 100) * 0.01;
      src[i + 3] = 1.0;
    }
    const rawTex = new THREE.DataTexture(src, srcW, srcH, THREE.RGBAFormat, THREE.FloatType);
    const prepared = prepareHdrPanorama(rawTex, ENV_PRESETS.day);
    expect(prepared).not.toBeNull();
    expect(prepared!.background.image.width).toBe(srcW);
    expect(prepared!.background.image.height).toBe(srcH);
    expect(prepared!.envSource.image.width).toBe(srcW);
    expect(prepared!.envSource.image.height).toBe(srcH);

    // Deterministic bit-identical HalfFloat output on repeated calls
    const preparedAgain = prepareHdrPanorama(rawTex, ENV_PRESETS.day);
    expect(Buffer.compare(Buffer.from(prepared!.background.image.data.buffer), Buffer.from(preparedAgain!.background.image.data.buffer))).toBe(0);
    expect(Buffer.compare(Buffer.from(prepared!.envSource.image.data.buffer), Buffer.from(preparedAgain!.envSource.image.data.buffer))).toBe(0);

    const sky = bakeProceduralSky(ENV_PRESETS.dusk);
    expect(sky.image.width).toBe(512);
    expect(sky.image.height).toBe(256);
  });
});

describe('Astronomical Cotswolds calibration, SITE_SHADOW_BOX & continuous EnvironmentLighting', () => {
  it('extends SITE_SHADOW_BOX.min[1] to -3.0m so lower road / valley receivers never clip shadows', () => {
    expect(SITE_SHADOW_BOX.min[1]).toBe(-3.0);
  });

  it('uses curated front-lit dusk & overhead day presets by default while keeping astronomical ephemeris opt-in', () => {
    expect(ENV_PRESETS.day.sunDirection).toEqual([0.18, 0.96, -0.20]);
    expect(ENV_PRESETS.dusk.sunDirection).toEqual([0.72, 0.48, 0.50]);
    expect(ENV_PRESETS.dusk.sunDirection[0]).toBeGreaterThan(0.6);
    expect(ENV_PRESETS.dusk.sunDirection[2]).toBeGreaterThan(0.4);
  });

  it('supports continuous setSolarDateTime, setLiveClockSync, and composable weather coupling while keeping setTimeOfDay presets intact', () => {
    const scene = new THREE.Scene();
    const env = new EnvironmentLighting(scene);

    // Canonical presets remain exact
    env.setTimeOfDay('day');
    expect(env.getTimeOfDay()).toBe('day');
    expect(env.getSkyWeatherSnapshot().liveClockSync).toBe(false);

    // Continuous summer morning (08:30 BST, 21 June -> sun in ENE +Z shining into Courtyard)
    const morning = env.setSolarDateTime({ civilHour: 8.5, dayOfYear: 172, year: 2026 });
    expect(morning.solar.altitudeDeg).toBeGreaterThan(25);
    expect(morning.solar.trueSunDirection[0]).toBeGreaterThan(0.5);
    expect(env.getTimeOfDay()).toBe('day');

    // Continuous winter midnight -> astronomical night + Meeus lunar moonlight
    const midnight = env.setSolarDateTime({ civilHour: 0.5, dayOfYear: 355, year: 2026 });
    expect(midnight.solar.altitudeDeg).toBeLessThan(-50);
    expect(env.getTimeOfDay()).toBe('night');
    expect(midnight.lunar.illuminatedFraction).toBeGreaterThanOrEqual(0);
    expect(midnight.lunar.illuminatedFraction).toBeLessThanOrEqual(1);

    // Live UK clock sync toggles cleanly without waking per-frame idle loop
    const liveSnap = env.setLiveClockSync(true);
    expect(liveSnap.liveClockSync).toBe(true);
    expect(
      env.updateWeatherAnimation(1 / 60, new THREE.Vector3(0, 5, 10), new THREE.Vector3(0, 0, 0))
    ).toBe(false);

    // Dry clear weather keeps weather.group hidden and lazily skips scene traversal until wet
    expect(env.weather.group.visible).toBe(false);
    const extMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.85, metalness: 0.05 });
    const extMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), extMat);
    extMesh.position.set(40, 1, 40);
    let traverseVisited = false;
    Object.defineProperty(extMesh, 'isIndexedProbe', {
      get() {
        traverseVisited = true;
        return true;
      },
    });
    scene.add(extMesh);
    env.weather.indexExteriorMaterials(scene);
    expect(extMat.roughness).toBe(0.85);
    expect(traverseVisited).toBe(false);

    // Enabling rain turns weather.group visible and lazily indexes & wets exterior materials
    env.weather.setPrecipitationLayer('rain', 0.8);
    expect(env.weather.group.visible).toBe(true);
    expect(extMat.roughness).toBeLessThan(0.85);

    // Returning to dry restores original material roughness and hides weather.group when clouds are off
    env.weather.setCloudLayer(false, 0);
    env.weather.setPrecipitationLayer('none', 0);
    expect(env.weather.group.visible).toBe(false);
    expect(extMat.roughness).toBeCloseTo(0.85, 5);

    // Day preset enables balanced daylight sky-portal GI (~0.76) while Dusk and Night keep it strictly 0
    env.applyTimeOfDay('day');
    expect(env.getDaylightGiState().strength).toBeGreaterThan(0.7);
    expect(env.getDaylightGiState().strength).toBeLessThan(0.85);
    expect(env.getComputedAmbientLux()).toBeGreaterThanOrEqual(250);

    // Heavy storm clouds + rain drop exterior lux below the 200 lux KNX indoor-lighting threshold
    env.weather.setCloudLayer(true, 98);
    env.weather.setPrecipitationLayer('rain', 0.95);
    env.setSolarDateTime({ civilHour: 16.5, dayOfYear: 295, year: 2026 });
    expect(env.getComputedAmbientLux()).toBeLessThan(200);

    // Clear mid-morning / spring-autumn sun (~36°+ altitude) reaches full daytime GI & >= 250 lux
    env.weather.setCloudLayer(false, 0);
    env.weather.setPrecipitationLayer('none', 0);
    const springMidday = env.setSolarDateTime({ civilHour: 12.2, dayOfYear: 105, year: 2026 });
    expect(springMidday.solar.altitudeDeg).toBeGreaterThan(36);
    expect(env.getDaylightGiState().strength).toBeCloseTo(ENV_PRESETS.day.daylightGiStrength ?? 0.76, 2);
    expect(env.getComputedAmbientLux()).toBeGreaterThanOrEqual(400);

    env.applyTimeOfDay('dusk');
    expect(env.getDaylightGiState().strength).toBe(0);
    expect(env.getComputedAmbientLux()).toBeLessThan(120);

    env.applyTimeOfDay('night');
    expect(env.getDaylightGiState().strength).toBe(0);

    env.dispose();
  });
});

describe('Site-ground exclusion, lazy active-only HDR & throttled transition shadows', () => {
  it('marks exterior siteGround material with excludeIndoorLighting so valley terrain skips 27 PointLights & 3D volume GI', () => {
    const ground = createSiteGround();
    expect((ground.mesh.material as THREE.Material).userData['excludeIndoorLighting']).toBe(true);
    ground.dispose();
  });

  it('throttles directional shadow invalidations to <= 13 across a 900 ms ToD transition stepped on scene.update(dt)', () => {
    const scene = new THREE.Scene();
    let shadowBakes = 0;
    let totalUpdates = 0;
    const fakeRenderer = {} as unknown as WebGPURenderer;
    const env = new EnvironmentLighting(scene, fakeRenderer, (invalidateShadows = true) => {
      totalUpdates++;
      if (invalidateShadows) shadowBakes++;
    });

    // Initial mode application (non-animated)
    env.setTimeOfDay('dusk');
    shadowBakes = 0;
    totalUpdates = 0;

    // Animated Dusk -> Day transition driven by stepTransition(dt)
    env.setTimeOfDay('day');
    expect(env.isTransitioning()).toBe(true);
    let steps = 0;
    while (env.isTransitioning() && steps < 120) {
      env.stepTransition(1 / 60);
      steps++;
    }
    expect(env.isTransitioning()).toBe(false);
    expect(totalUpdates).toBeGreaterThan(45);
    expect(shadowBakes).toBeLessThanOrEqual(13);
    expect(shadowBakes).toBeGreaterThanOrEqual(11);
    env.dispose();
  });
  it("pre-bakes WebGPU PMREM sky backgrounds outside render passes, defers async 2K HDR bakes to stepTransition, and retains scene-bound targets until dispose()", async () => {
    const scene = new THREE.Scene();
    let inRenderPass = false;
    let reentrantPmremCalls = 0;
    const disposedTargets: THREE.Texture[] = [];
    let resolveGpuWork!: () => void;
    const gpuWorkPromise = new Promise<void>((r) => {
      resolveGpuWork = r;
    });

    const fakeWebGpuRenderer = {
      isWebGPURenderer: true,
      toneMappingExposure: 1,
      shadowMap: { needsUpdate: false },
      backend: {
        device: {
          queue: {
            onSubmittedWorkDone: () => gpuWorkPromise,
          },
        },
      },
    } as unknown as WebGPURenderer;

    const env = new EnvironmentLighting(scene, fakeWebGpuRenderer);
    let pmremCalls = 0;
    const createdTargets: Array<{ texture: THREE.Texture; disposed: boolean; dispose: () => void }> = [];
    (env as unknown as {
      bakeEquirectPmremTarget: (_r: unknown, eq: THREE.Texture) => { texture: THREE.Texture; dispose: () => void };
    }).bakeEquirectPmremTarget = (_r, eq) => {
      pmremCalls++;
      if (inRenderPass) reentrantPmremCalls++;
      const tex = new THREE.Texture();
      tex.mapping = THREE.CubeUVReflectionMapping;
      (tex as unknown as { isPMREMTexture: boolean }).isPMREMTexture = true;
      tex.name = `pmrem_${(eq.image as { width?: number })?.width ?? 0}_${pmremCalls}`;
      const target = {
        texture: tex,
        disposed: false,
        dispose() {
          this.disposed = true;
          disposedTargets.push(tex);
        },
      };
      createdTargets.push(target);
      return target;
    };

    const hdrCallbacks: Partial<Record<"day" | "dusk" | "night", (tex: THREE.DataTexture) => void>> = {};
    (env as unknown as { hdrLoader: { load: (url: string, onLoad: (tex: THREE.DataTexture) => void) => void } }).hdrLoader = {
      load: (url, onLoad) => {
        const mode = url.includes("day") ? "day" : url.includes("night") ? "night" : "dusk";
        hdrCallbacks[mode] = onLoad;
      },
    };

    const sceneNodes = scene as unknown as { backgroundNode: unknown; environmentNode: unknown };
    env.bakeProceduralEnvironments(fakeWebGpuRenderer);
    env.setTimeOfDay("dusk");
    expect(scene.background).toBeNull();
    expect(scene.environment).toBeNull();
    expect(sceneNodes.backgroundNode).toBeTruthy();
    expect(sceneNodes.environmentNode).toBeTruthy();
    const initialBgNode = sceneNodes.backgroundNode;
    const initialEnvNode = sceneNodes.environmentNode;
    expect((env.getHdrDualSlotState().envTexA as unknown as { isPMREMTexture?: boolean })?.isPMREMTexture).toBe(true);
    expect(env.getHdrDualSlotState().bgTexA.mapping).toBe(THREE.EquirectangularReflectionMapping);
    expect(scene.backgroundBlurriness).toBe(0);

    // Rapid Dusk -> Day -> Night -> Dusk -> Day transitions + solar scrubbing while simulating render passes
    for (const next of ["day", "night", "dusk", "day"] as const) {
      env.setTimeOfDay(next);
      inRenderPass = true;
      expect(scene.background).toBeNull();
      expect(sceneNodes.backgroundNode).toBe(initialBgNode);
      expect(sceneNodes.environmentNode).toBe(initialEnvNode);
      expect((env.getHdrDualSlotState().envTexA as unknown as { isPMREMTexture?: boolean })?.isPMREMTexture).toBe(true);
      expect(env.getHdrDualSlotState().bgTexA.mapping).toBe(THREE.EquirectangularReflectionMapping);
      inRenderPass = false;
      env.stepTransition(0.05);
    }

    // Async 2K day HDR arrives mid-session: must NOT run PMREMGenerator inside XHR callback or destroy procedural target
    const pmremBeforeHdr = pmremCalls;
    const hdrData = new Float32Array(64 * 32 * 4).fill(0.75);
    const rawHdr = new THREE.DataTexture(hdrData, 64, 32, THREE.RGBAFormat, THREE.FloatType);
    inRenderPass = true;
    hdrCallbacks.day?.(rawHdr);
    inRenderPass = false;
    expect(pmremCalls).toBe(pmremBeforeHdr);
    expect(reentrantPmremCalls).toBe(0);
    expect(env.isTransitioning()).toBe(true);

    // Frame-boundary stepTransition flushes queued HDR bake outside render pass
    env.stepTransition(1 / 60);
    expect(pmremCalls).toBeGreaterThan(pmremBeforeHdr);
    expect(reentrantPmremCalls).toBe(0);
    expect(scene.background).toBeNull();
    expect(sceneNodes.backgroundNode).toBe(initialBgNode);
    expect(sceneNodes.environmentNode).toBe(initialEnvNode);
    expect((env.getHdrDualSlotState().envTexB as unknown as { isPMREMTexture?: boolean })?.isPMREMTexture).toBe(true);
    expect(env.getHdrDualSlotState().bgTexB.mapping).toBe(THREE.EquirectangularReflectionMapping);
    expect(scene.backgroundBlurriness).toBe(0);

    // Even after GPU queue completes, previously scene-bound PMREM targets remain alive until env.dispose()
    resolveGpuWork();
    await gpuWorkPromise;
    expect(disposedTargets).toHaveLength(0);

    // Continuous solar scrubbing across twilight & midday keeps persistent dual-slot TSL nodes bound
    env.setSolarDateTime({ civilHour: 13.0, dayOfYear: 172, year: 2026 });
    env.setSolarDateTime({ civilHour: 21.5, dayOfYear: 172, year: 2026 });
    expect(scene.background).toBeNull();
    expect(sceneNodes.backgroundNode).toBe(initialBgNode);
    expect(sceneNodes.environmentNode).toBe(initialEnvNode);
    expect((env.getHdrDualSlotState().envTexA as unknown as { isPMREMTexture?: boolean })?.isPMREMTexture).toBe(true);
    expect(env.getHdrDualSlotState().bgTexA.mapping).toBe(THREE.EquirectangularReflectionMapping);

    env.dispose();
    expect(createdTargets.every((t) => t.disposed)).toBe(true);
  });
});

describe('Direct Daylight, Camera-Fitted 4096 Shadows & Volumetric Cloud Cover', () => {
  it('delivers high direct-to-ambient contrast & dual Main-Street/Courtyard SE incidence in Day mode while keeping Dusk & Night untouched', () => {
    const day = ENV_PRESETS.day;
    const dusk = ENV_PRESETS.dusk;
    const night = ENV_PRESETS.night;

    // Curated overhead daylight preset ([0.18, 0.96, -0.20])
    expect(day.sunDirection).toEqual([0.18, 0.96, -0.20]);
    expect(day.sunIntensity).toBe(4.6);
    expect(day.hemiIntensity).toBe(0.72);
    expect(day.envIntensity).toBe(1.18);
    expect(day.exposure).toBe(1.15);

    // Dusk and Night presets remain 100% untouched
    expect(dusk.sunIntensity).toBe(2.4);
    expect(dusk.hemiIntensity).toBe(0.46);
    expect(dusk.exposure).toBe(1.20);
    expect(night.sunIntensity).toBe(0.22);
    expect(night.hemiIntensity).toBe(0.05);
    expect(night.exposure).toBe(1.12);
  });

  it('couples 0..100% cloud cover continuously (no 0..35% dead zone), drives 3D oblique cloud-shadow gobos, and sleeps at 0 Hz when clear', () => {
    const scene = new THREE.Scene();
    const env = new EnvironmentLighting(scene);
    env.applyTimeOfDay('day');

    const getLights = () => {
      let sun: THREE.DirectionalLight | undefined;
      let hemi: THREE.HemisphereLight | undefined;
      scene.traverse((obj) => {
        if (obj instanceof THREE.DirectionalLight) sun = obj;
        if (obj instanceof THREE.HemisphereLight) hemi = obj;
      });
      return { sun: sun!, hemi: hemi! };
    };

    const { sun, hemi } = getLights();
    const clearSun = sun.intensity;
    const clearHemi = hemi.intensity;
    expect(uCloudGoboParams.value.x).toBe(0);
    expect(env.hasActiveCloudDrift()).toBe(false);
    expect(env.stepCloudDrift(0.1)).toBe(false);
    expect(evaluateCloudTransmittanceCpu(0, 0, 0)).toBe(1.0);

    // 25% cloud cover is well inside the former 0..35% dead zone and MUST measurably modulate
    // uCloudGoboParams.x, direct sunIntensity, and diffuse hemiIntensity!
    env.weather.setCloudLayer(true, 25);
    const sun25 = sun.intensity;
    const hemi25 = hemi.intensity;
    expect(uCloudGoboParams.value.x).toBeCloseTo(0.25, 4);
    expect(sun25).toBeLessThan(clearSun);
    expect(hemi25).toBeGreaterThan(clearHemi);
    expect(env.hasActiveCloudDrift()).toBe(true);

    // 45% Partly Cloudy deepens gobo contrast, cools sun & lifts sky scatter further
    env.weather.setCloudLayer(true, 45);
    const sun45 = sun.intensity;
    const hemi45 = hemi.intensity;
    expect(uCloudGoboParams.value.x).toBeCloseTo(0.45, 4);
    expect(sun45).toBeLessThan(sun25);
    expect(hemi45).toBeGreaterThan(hemi25);

    // Sample world-space 3D oblique cloud gobo across a 160 m transect: verify both bright breaks (~1.0)
    // and cool cloud-shaded bands (< 0.85) exist, and elevated roofs project obliquely along the sun ray!
    let minTrans = 1.0;
    let maxTrans = 0.0;
    for (let x = -80; x <= 80; x += 4) {
      for (let z = -60; z <= 60; z += 4) {
        const t = evaluateCloudTransmittanceCpu(x, 0, z);
        minTrans = Math.min(minTrans, t);
        maxTrans = Math.max(maxTrans, t);
      }
    }
    expect(maxTrans).toBeGreaterThan(0.98);
    expect(minTrans).toBeLessThan(0.84);

    // Oblique projection invariant: shifting along +sunDir from ground (y=0) to roof ridge (y=7m)
    // lands on the EXACT same cloud ray transmittance!
    const { x: sx, y: sy, z: sz } = uCloudSunDir.value;
    const scaleY = 7.0 / Math.max(0.28, sy);
    const groundSample = evaluateCloudTransmittanceCpu(12.0, 0.0, -8.0);
    const roofRaySample = evaluateCloudTransmittanceCpu(
      12.0 + sx * scaleY,
      7.0,
      -8.0 + sz * scaleY
    );
    expect(roofRaySample).toBeCloseTo(groundSample, 5);

    // 92% Overcast attenuates direct sun strongly and boosts diffuse hemisphere fill
    env.weather.setCloudLayer(true, 92);
    expect(sun.intensity).toBeLessThan(sun45 * 0.55);
    expect(hemi.intensity).toBeGreaterThan(hemi45);

    // Returning to 0% Clear restores exact 1.0 transmittance and 0 Hz idle sleep
    env.weather.setCloudLayer(false, 0);
    expect(uCloudGoboParams.value.x).toBe(0);
    expect(evaluateCloudTransmittanceCpu(12, 0, -8)).toBe(1.0);
    expect(env.hasActiveCloudDrift()).toBe(false);
    expect(sun.intensity).toBeCloseTo(clearSun, 5);
    expect(hemi.intensity).toBeCloseTo(clearHemi, 5);

    env.dispose();
  });

  it('fits a 4096 texel-snapped ~1.1 cm/texel shadow frustum to close views with 0 re-bakes on sub-step orbit', () => {
    const scene = new THREE.Scene();
    const env = new EnvironmentLighting(scene);
    env.applyTimeOfDay('day');

    expect(env.getShadowMapSize()).toBe(4096);

    // Initial fit to Kitchen / Courtyard close-up target (-2, 1.2, 6) at 13 m orbit distance
    const firstFit = env.updateShadowFrustumForCamera(new THREE.Vector3(-2.0, 1.2, 6.0), 13.0);
    expect(firstFit).toBe(true);

    const diag = env.getShadowFrustumDiagnostics();
    expect(diag.shadowMapSize).toBe(4096);
    expect(diag.halfExtentM).toBeCloseTo(22.5, 3);
    expect(diag.texelSizeM).toBeLessThan(0.0115); // ~1.10 cm/texel (90.9 texels/m!)
    expect(diag.texelsPerMetre).toBeGreaterThan(90.0);
    expect(diag.normalBiasM).toBeGreaterThan(0.004);
    expect(diag.normalBiasM).toBeLessThan(0.0055); // ~4.9 mm normalBias

    // Clear shadow.needsUpdate and perform 40 normal orbit / pan micro-movements within the room/courtyard:
    // MUST trigger 0 shadow invalidations!
    let sunLight: THREE.DirectionalLight | undefined;
    scene.traverse((o) => {
      if (o instanceof THREE.DirectionalLight) sunLight = o;
    });
    sunLight!.shadow.needsUpdate = false;

    let orbitInvalidations = 0;
    for (let step = 0; step < 40; step++) {
      const angle = (step / 40) * Math.PI * 2;
      const subStepTarget = new THREE.Vector3(
        diag.centerCellX + Math.cos(angle) * 2.4,
        1.2,
        diag.centerCellZ + Math.sin(angle) * 2.4
      );
      const subStepDist = 13.0 + Math.sin(angle) * 4.0;
      if (env.updateShadowFrustumForCamera(subStepTarget, subStepDist)) {
        orbitInvalidations++;
      }
    }
    expect(orbitInvalidations).toBe(0);
    expect(sunLight!.shadow.needsUpdate).toBe(false);

    // Translating > 12 m across the estate to the Paddock snaps cleanly to a new quantized cell once
    const movedToPaddock = env.updateShadowFrustumForCamera(new THREE.Vector3(24.0, 1.0, 6.0), 14.0);
    expect(movedToPaddock).toBe(true);
    expect(sunLight!.shadow.needsUpdate).toBe(true);

    // Zooming out to a full-estate overview (48 m distance) expands cleanly to the 48 m half-extent tier
    sunLight!.shadow.needsUpdate = false;
    const zoomedOut = env.updateShadowFrustumForCamera(new THREE.Vector3(0.0, 1.0, 6.0), 50.0);
    expect(zoomedOut).toBe(true);
    expect(env.getShadowFrustumDiagnostics().halfExtentM).toBeCloseTo(48.0, 3);

    env.dispose();
  });

  it('scrubs 0..100% Cloud Cover & weather presets with 0 shadow re-bakes when sunDirection is unchanged', () => {
    const scene = new THREE.Scene();
    const shadowInvalidationFlags: boolean[] = [];
    const env = new EnvironmentLighting(scene, undefined, (invalidateShadows = true) => {
      shadowInvalidationFlags.push(invalidateShadows);
    });
    env.applyTimeOfDay('day');

    let sunLight: THREE.DirectionalLight | undefined;
    scene.traverse((o) => {
      if (o instanceof THREE.DirectionalLight) sunLight = o;
    });
    expect(sunLight).toBeDefined();

    shadowInvalidationFlags.length = 0;
    sunLight!.shadow.needsUpdate = false;

    for (const pct of [10, 25, 42, 68, 92, 0]) {
      env.weather.setCloudLayer(pct > 0, pct);
    }
    env.weather.applyPreset('partly_cloudy');
    env.weather.applyPreset('overcast');
    env.weather.applyPreset('clear');

    expect(shadowInvalidationFlags.length).toBe(9);
    expect(shadowInvalidationFlags.every((flag) => flag === false)).toBe(true);
    expect(sunLight!.shadow.needsUpdate).toBe(false);

    env.dispose();
  });

  it('updates sunLight.matrixWorld, target.matrixWorld, and shadow.camera.matrixWorld on every setSolarDateTime scrub even when scene matrices are frozen', () => {
    const scene = new THREE.Scene();
    let shadowInvalidations = 0;
    const env = new EnvironmentLighting(scene, undefined, (invalidateShadows) => {
      if (invalidateShadows) shadowInvalidations++;
    });
    env.applyTimeOfDay('dusk');
    env.updateShadowFrustumForCamera(new THREE.Vector3(-4, 2, 6), 24, false);

    // Mirror StaticSceneService.freezeStaticMatrices()
    scene.updateMatrixWorld(true);
    scene.matrixWorldAutoUpdate = false;
    scene.traverse((obj) => {
      if (obj !== scene) obj.matrixAutoUpdate = false;
    });

    let sunLight!: THREE.DirectionalLight;
    scene.traverse((obj) => {
      if (obj instanceof THREE.DirectionalLight) sunLight = obj;
    });
    expect(sunLight).toBeDefined();

    const posAtBoot = new THREE.Vector3().setFromMatrixPosition(sunLight.matrixWorld);
    const camPosAtBoot = new THREE.Vector3().setFromMatrixPosition(sunLight.shadow.camera.matrixWorld);

    shadowInvalidations = 0;
    sunLight.shadow.needsUpdate = false;
    env.setSolarDateTime({ civilHour: 8.0, dayOfYear: 172, year: 2026 });
    const posMorning = new THREE.Vector3().setFromMatrixPosition(sunLight.matrixWorld);
    const camPosMorning = new THREE.Vector3().setFromMatrixPosition(sunLight.shadow.camera.matrixWorld);
    expect(sunLight.shadow.needsUpdate).toBe(true);
    expect(shadowInvalidations).toBe(1);
    expect(posMorning.distanceTo(posAtBoot)).toBeGreaterThan(25);
    expect(camPosMorning.distanceTo(camPosAtBoot)).toBeGreaterThan(25);

    sunLight.shadow.needsUpdate = false;
    env.setSolarDateTime({ civilHour: 13.0, dayOfYear: 172, year: 2026 });
    const posMidday = new THREE.Vector3().setFromMatrixPosition(sunLight.matrixWorld);
    expect(sunLight.shadow.needsUpdate).toBe(true);
    expect(shadowInvalidations).toBe(2);
    expect(posMidday.distanceTo(posMorning)).toBeGreaterThan(35);

    sunLight.shadow.needsUpdate = false;
    env.setSolarDateTime({ civilHour: 18.5, dayOfYear: 172, year: 2026 });
    const posEvening = new THREE.Vector3().setFromMatrixPosition(sunLight.matrixWorld);
    expect(sunLight.shadow.needsUpdate).toBe(true);
    expect(shadowInvalidations).toBe(3);
    expect(posEvening.distanceTo(posMidday)).toBeGreaterThan(35);

    // Discrete preset pill restores curated dusk direction
    env.setTimeOfDay('dusk');
    const posPresetDusk = new THREE.Vector3().setFromMatrixPosition(sunLight.matrixWorld);
    expect(posPresetDusk.distanceTo(posAtBoot)).toBeLessThan(0.05);

    env.dispose();
  });

  it('keeps directional shadow map resolution immutable across interactive scrub start and settle (0 GPUTexture.destroy resizes)', () => {
    const scene = new THREE.Scene();
    const env = new EnvironmentLighting(scene);
    const sun = scene.children.find((c): c is THREE.DirectionalLight => c instanceof THREE.DirectionalLight && c.castShadow)!;
    env.setShadowMapSize(4096);
    expect(env.getShadowMapSize()).toBe(4096);
    expect(env.getShadowFrustumDiagnostics().shadowMapSize).toBe(4096);

    env.setInteractiveScrubShadow(true);
    expect(env.isInteractiveScrubShadow()).toBe(true);
    expect(env.getShadowMapSize()).toBe(4096);
    expect(sun.shadow.mapSize.x).toBe(4096);
    expect(sun.shadow.mapSize.y).toBe(4096);
    expect(env.getShadowFrustumDiagnostics().shadowMapSize).toBe(4096);

    env.setInteractiveScrubShadow(false);
    expect(env.isInteractiveScrubShadow()).toBe(false);
    expect(env.getShadowMapSize()).toBe(4096);
    expect(sun.shadow.mapSize.x).toBe(4096);
    expect(sun.shadow.mapSize.y).toBe(4096);
    expect(env.getShadowFrustumDiagnostics().shadowMapSize).toBe(4096);

    env.dispose();
  });

  it('progressively diffuses shadow penumbra radius (0% < 40% < 75%) and completely extinguishes direct sun & shadows at 100% cloud cover', () => {
    const scene = new THREE.Scene();
    const env = new EnvironmentLighting(scene);
    env.applyTimeOfDay('day');

    const sun = scene.children.find(
      (c): c is THREE.DirectionalLight => c instanceof THREE.DirectionalLight && c.castShadow
    )!;
    const hemi = scene.children.find(
      (c): c is THREE.HemisphereLight => c instanceof THREE.HemisphereLight
    )!;

    // 0% cloud cover: exact ENV_PRESETS.day parity
    env.weather.setCloudLayer(false, 0);
    expect(sun.intensity).toBeCloseTo(ENV_PRESETS.day.sunIntensity, 5);
    expect(hemi.intensity).toBeCloseTo(ENV_PRESETS.day.hemiIntensity, 5);
    expect(scene.environmentIntensity).toBeCloseTo(ENV_PRESETS.day.envIntensity, 5);
    expect(sun.shadow.intensity).toBeCloseTo(1.0, 5);
    expect(sun.shadow.radius).toBeCloseTo(1.0, 5);
    expect(SHARED_SUN_SHADOW_PENUMBRA.x).toBeCloseTo(1.0, 5);
    expect(env.hasActiveSunShadow()).toBe(true);
    const r0 = sun.shadow.radius;

    // 40% cloud cover: softer penumbra + active cloud gobo contrast + lifted diffuse hemi
    env.weather.setCloudLayer(true, 40);
    const r40 = sun.shadow.radius;
    const sun40 = sun.intensity;
    const hemi40 = hemi.intensity;
    expect(r40).toBeGreaterThan(r0 + 5.0);
    expect(SHARED_SUN_SHADOW_PENUMBRA.x).toBeCloseTo(r40, 5);
    expect(sun40).toBeLessThan(ENV_PRESETS.day.sunIntensity);
    expect(sun40).toBeGreaterThan(2.2);
    expect(hemi40).toBeGreaterThan(ENV_PRESETS.day.hemiIntensity + 0.2);

    // Cloud gobo has natural broken-cloud contrast around 40%..65%, then flattens to 1.0 at >=96%
    let minGobo40 = 1.0;
    let maxGobo40 = 0.0;
    for (let x = -40; x <= 40; x += 5) {
      for (let z = -40; z <= 40; z += 5) {
        const t = evaluateCloudTransmittanceCpu(x, 0, z);
        minGobo40 = Math.min(minGobo40, t);
        maxGobo40 = Math.max(maxGobo40, t);
      }
    }
    expect(maxGobo40 - minGobo40).toBeGreaterThan(0.1);

    // 75% cloud cover: wide diffused penumbra + strongly attenuated direct sun + brighter sky scatter
    env.weather.setCloudLayer(true, 75);
    const r75 = sun.shadow.radius;
    const sun75 = sun.intensity;
    const hemi75 = hemi.intensity;
    expect(r75).toBeGreaterThan(r40 + 8.0);
    expect(r75).toBeGreaterThan(20.0);
    expect(SHARED_SUN_SHADOW_PENUMBRA.x).toBeCloseTo(r75, 5);
    expect(sun75).toBeLessThan(sun40 * 0.45);
    expect(sun75).toBeGreaterThan(0.4);
    expect(sun.shadow.intensity).toBeLessThan(0.9);
    expect(hemi75).toBeGreaterThan(hemi40 + 0.35);

    // 100% cloud cover: zero direct sun, zero shadow intensity, zero gobo patchiness, healthy dry-overcast diffuse sky
    env.weather.setCloudLayer(true, 100);
    expect(sun.intensity).toBe(0);
    expect(sun.shadow.intensity).toBe(0);
    expect(env.hasActiveSunShadow()).toBe(false);
    expect(sun.shadow.radius).toBeGreaterThan(r75);
    expect(hemi.intensity).toBeGreaterThan(hemi75 + 0.15);
    expect(hemi.intensity).toBeGreaterThan(ENV_PRESETS.day.hemiIntensity * 2.2);
    expect(scene.environmentIntensity).toBeGreaterThanOrEqual(ENV_PRESETS.day.envIntensity);

    for (let x = -40; x <= 40; x += 10) {
      for (let z = -40; z <= 40; z += 10) {
        expect(evaluateCloudTransmittanceCpu(x, 0, z)).toBe(1.0);
      }
    }

    // At Night + 100% cloud cover: moon shadows extinguish AND night stays dark (0 daytime solar scatter leak!)
    env.applyTimeOfDay('night');
    expect(sun.intensity).toBe(0);
    expect(sun.shadow.intensity).toBe(0);
    expect(hemi.intensity).toBeCloseTo(ENV_PRESETS.night.hemiIntensity, 4);
    expect(scene.environmentIntensity).toBeLessThanOrEqual(ENV_PRESETS.night.envIntensity);

    env.dispose();
  });

  it('skips directional 4096x4096 shadow-map re-bakes while scrubbing time-of-day at 100% cloud cover and performs a catch-up bake when clouds clear', () => {
    const scene = new THREE.Scene();
    const shadowInvalidations: boolean[] = [];
    const env = new EnvironmentLighting(scene, undefined, (invalidateShadows) => {
      shadowInvalidations.push(Boolean(invalidateShadows));
    });
    env.applyTimeOfDay('day');

    const sun = scene.children.find(
      (c): c is THREE.DirectionalLight => c instanceof THREE.DirectionalLight && c.castShadow
    )!;

    env.weather.setCloudLayer(true, 100);
    expect(env.hasActiveSunShadow()).toBe(false);
    shadowInvalidations.length = 0;
    sun.shadow.needsUpdate = false;

    // Scrub across morning -> noon -> afternoon at 100% overcast: 0 shadow bakes!
    env.setSolarDateTime({ civilHour: 9.0, dayOfYear: 172, year: 2026 });
    env.setSolarDateTime({ civilHour: 12.0, dayOfYear: 172, year: 2026 });
    env.setSolarDateTime({ civilHour: 15.5, dayOfYear: 172, year: 2026 });
    env.flushShadowUpdate();

    expect(sun.shadow.needsUpdate).toBe(false);
    expect(shadowInvalidations.every((flag) => flag === false)).toBe(true);

    // Lowering cloud cover back below 100% triggers a single catch-up shadow bake for the new solar angle
    shadowInvalidations.length = 0;
    env.weather.setCloudLayer(true, 55);
    expect(env.hasActiveSunShadow()).toBe(true);
    expect(sun.shadow.needsUpdate).toBe(true);
    expect(shadowInvalidations).toEqual([true]);

    env.dispose();
  });
});

describe('Zero-config HouseLocation decoupling & instance-isolated bearings', () => {
  it('supports zero-config Hollywood Hills (34.1003, -118.3698) with automatic Open-Meteo timezone & elevation', async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        requestedUrls.push(String(url));
        return {
          ok: true,
          json: async () => ({
            timezone: 'America/Los_Angeles',
            timezone_abbreviation: 'PDT',
            utc_offset_seconds: -25200,
            elevation: 231.0,
            current: {
              time: '2026-06-21T15:00',
              temperature_2m: 28.0,
              apparent_temperature: 27.1,
              relative_humidity_2m: 36,
              dew_point_2m: 11.4,
              precipitation: 0,
              rain: 0,
              showers: 0,
              snowfall: 0,
              weather_code: 0,
              cloud_cover: 6,
              surface_pressure: 1014.0,
              wind_speed_10m: 12.0,
              wind_direction_10m: 260,
              wind_gusts_10m: 19.0,
              visibility: 16000,
            },
          }),
        } as unknown as Response;
      })
    );

    try {
      const scene = new THREE.Scene();
      const env = new EnvironmentLighting(scene, undefined, undefined, {
        lat: 34.1003,
        lon: -118.3698,
      });

      // Before Open-Meteo fetch: uses longitude solar-time fallback (UTC-8), default East +X = 90°, no UK labels
      const preFetch = env.setSolarDateTime({ civilHour: 15.0, dayOfYear: 172, year: 2026 });
      expect(preFetch.plusXTrueBearingDeg).toBe(90);
      expect(preFetch.locationLabel).toBeUndefined();
      expect(preFetch.latitudeDeg).toBeCloseTo(34.1003, 4);
      expect(preFetch.longitudeDeg).toBeCloseTo(-118.3698, 4);
      expect(preFetch.solar.utcOffsetHours).toBe(-8);
      expect(preFetch.solar.timezoneAbbreviation).toBe('UTC-8');

      // Live Open-Meteo fetch updates timezone, abbreviation, elevation, and LA solar ephemeris automatically
      await env.weather.setLiveFeedEnabled(true);
      expect(requestedUrls[0]).toContain('latitude=34.1003');
      expect(requestedUrls[0]).toContain('longitude=-118.3698');
      expect(requestedUrls[0]).toContain('timezone=auto');
      expect(requestedUrls[0]).not.toContain('ukmo_seamless');

      const postFetch = env.getSkyWeatherSnapshot();
      expect(postFetch.solar.timezone).toBe('America/Los_Angeles');
      expect(postFetch.solar.timezoneAbbreviation).toBe('PDT');
      expect(postFetch.solar.utcOffsetHours).toBe(-7);
      expect(postFetch.elevationM).toBe(231);
      expect(postFetch.solar.altitudeDeg).toBeGreaterThan(55);
      expect(postFetch.solar.altitudeDeg).toBeLessThan(72);
      expect(postFetch.solar.azimuthFromNorthDeg).toBeGreaterThan(240);
      expect(postFetch.solar.azimuthFromNorthDeg).toBeLessThan(275);

      env.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('preserves Cotswolds ephemeris, 340.17° bearing, GMT/BST transitions, and HUD label when configured', () => {
    const scene = new THREE.Scene();
    const env = new EnvironmentLighting(scene, undefined, undefined, DEFAULT_HUS_LOCATION);

    const summer = env.setSolarDateTime({ civilHour: 13.09, dayOfYear: 172, year: 2026 });
    expect(summer.plusXTrueBearingDeg).toBeCloseTo(90, 2);
    expect(summer.locationLabel).toBe('Cotswolds · Gloucestershire');
    expect(summer.solar.utcOffsetHours).toBe(1);
    expect(summer.solar.timezoneAbbreviation).toBe('BST');
    expect(summer.solar.timezone).toBe('Europe/London');

    const winter = env.setSolarDateTime({ civilHour: 12.03, dayOfYear: 355, year: 2026 });
    expect(winter.solar.utcOffsetHours).toBe(0);
    expect(winter.solar.timezoneAbbreviation).toBe('GMT');
    env.dispose();
  });

  it('keeps plusXTrueBearingDeg and sun vectors completely independent across multiple EnvironmentLighting instances', () => {
    const sceneA = new THREE.Scene();
    const sceneB = new THREE.Scene();
    const envA = new EnvironmentLighting(sceneA, undefined, undefined, {
      lat: 51.84,
      lon: -1.79,
      plusXTrueBearingDeg: 340.17,
      timezone: 'Europe/London',
    });
    const envB = new EnvironmentLighting(sceneB, undefined, undefined, {
      lat: 51.84,
      lon: -1.79,
      plusXTrueBearingDeg: 90,
      timezone: 'Europe/London',
    });

    const snapA = envA.setSolarDateTime({ civilHour: 10.0, dayOfYear: 172, year: 2026 });
    const snapB = envB.setSolarDateTime({ civilHour: 10.0, dayOfYear: 172, year: 2026 });

    expect(envA.getPlusXTrueBearingDeg()).toBeCloseTo(340.17, 2);
    expect(envB.getPlusXTrueBearingDeg()).toBeCloseTo(90, 2);
    expect(snapA.plusXTrueBearingDeg).toBeCloseTo(340.17, 2);
    expect(snapB.plusXTrueBearingDeg).toBeCloseTo(90, 2);

    // Same geographic solar azimuth/altitude, completely distinct world-space sun vectors!
    expect(snapA.solar.azimuthFromNorthDeg).toBeCloseTo(snapB.solar.azimuthFromNorthDeg, 4);
    const vecA = new THREE.Vector3(...snapA.solar.trueSunDirection);
    const vecB = new THREE.Vector3(...snapB.solar.trueSunDirection);
    expect(vecA.distanceTo(vecB)).toBeGreaterThan(0.5);

    envA.dispose();
    envB.dispose();
  });
});

describe('8K Ultra-HDR detail resolution, maxDetailWidth clamping & worldAnchored fixed horizon', () => {
  it('derives _8k.webp with _4k.webp fallback, honours detailOverrideUrl, configures LinearFilter mip=0, and clamps detail to maxDetailWidth', () => {
    expect(deriveDetailWebpUrl('/textures/hdr/hollywood_hills_day_clear_2k.hdr')).toBe(
      '/textures/hdr/hollywood_hills_day_clear_8k.webp'
    );
    expect(
      deriveDetailWebpUrl(
        '/textures/hdr/english_countryside_day_2k.hdr',
        '/textures/hdr/english_countryside_day_4k.webp'
      )
    ).toBe('/textures/hdr/english_countryside_day_4k.webp');
    expect(deriveDetailWebpUrl('/textures/hdr/hollywood_hills_day_clear_512.hdr')).toBeNull();
    expect(deriveFallbackDetailWebpUrl('/textures/hdr/hollywood_hills_day_clear_8k.webp')).toBe(
      '/textures/hdr/hollywood_hills_day_clear_4k.webp'
    );
    expect(deriveFallbackDetailWebpUrl('/textures/hdr/english_countryside_day_4k.webp')).toBeNull();

    const hdrSrc = new Float32Array(32 * 16 * 4).fill(0.5);
    const detail128 = {
      width: 128,
      height: 64,
      data: new Uint8ClampedArray(128 * 64 * 4).fill(180),
    };
    const clamped = prepareHdrBuffers(hdrSrc, 32, 16, ENV_PRESETS.day, detail128, 64);
    expect(clamped.bgWidth).toBe(64);
    expect(clamped.bgHeight).toBe(32);

    const rawTex = new THREE.DataTexture(hdrSrc, 32, 16, THREE.RGBAFormat, THREE.FloatType);
    const wrapped = prepareHdrPanorama(rawTex, ENV_PRESETS.day, detail128, 64)!;
    expect(wrapped.background.minFilter).toBe(THREE.LinearFilter);
    expect(wrapped.background.magFilter).toBe(THREE.LinearFilter);
    expect(wrapped.background.generateMipmaps).toBe(false);
  });

  it('keeps worldAnchored horizon rotation strictly constant across 24h solar scrubbing while cross-blending Dawn -> Day -> Dusk -> Night', () => {
    const scene = new THREE.Scene();
    const fakeRenderer = {
      isWebGPURenderer: true,
      toneMappingExposure: 1,
      shadowMap: { needsUpdate: false },
    } as unknown as WebGPURenderer;
    const env = new EnvironmentLighting(
      scene,
      fakeRenderer,
      undefined,
      DEFAULT_HUS_LOCATION,
      undefined,
      'hollywood-hills'
    );
    (env as unknown as {
      bakeEquirectPmremTarget: () => { texture: THREE.Texture; dispose: () => void };
    }).bakeEquirectPmremTarget = () => {
      const tex = new THREE.Texture();
      tex.mapping = THREE.CubeUVReflectionMapping;
      (tex as unknown as { isPMREMTexture: boolean }).isPMREMTexture = true;
      return { texture: tex, dispose: vi.fn() };
    };
    (env as unknown as { hdrLoader: { load: () => void } }).hdrLoader = { load: () => {} };
    env.bakeProceduralEnvironments(fakeRenderer);

    const expectedTheta = environmentRotationForTrueNorth(90, 0);
    for (const civilHour of [5.1, 7.0, 12.5, 20.4, 23.8]) {
      env.setSolarDateTime({ civilHour, dayOfYear: 172, year: 2026 });
      const dual = env.getHdrDualSlotState();
      expect(dual.rotationYA).toBeCloseTo(expectedTheta, 8);
      expect(dual.rotationYB).toBeCloseTo(expectedTheta, 8);
    }

    // Golden-hour evening transition blends Day -> Dusk smoothly
    env.setSolarDateTime({ civilHour: 20.6, dayOfYear: 172, year: 2026 });
    const eveningBlend = env.getHdrDualSlotState();
    expect(eveningBlend.cellKeyA).toBe('day_clear');
    expect(eveningBlend.cellKeyB).toBe('dusk_clear');
    expect(eveningBlend.blendT).toBeGreaterThan(0.05);
    expect(eveningBlend.blendT).toBeLessThan(0.95);
    env.dispose();
  });
});

describe('HDRI solarization & top-to-bottom row orientation regressions', () => {
  it('preserves monotonic luminance and natural green foliage chromaticity across high-contrast sky/tree boundaries without thermal halos', () => {
    const envW = 16;
    const envH = 8;
    const detW = 64;
    const detH = 32;

    // Simulate intense warm golden-hour HDR sky/sun bloom bleeding across row 3..4 where dark green foliage sits in the 8K detail map
    const hdrBgLinear = new Float32Array(envW * envH * 3);
    for (let y = 0; y < envH; y++) {
      const isSky = y < 4;
      for (let x = 0; x < envW; x++) {
        const i3 = (y * envW + x) * 3;
        if (isSky) {
          // Warm orange-red sunset bloom in HDR (R >> G >> B)
          hdrBgLinear[i3] = 3.2;
          hdrBgLinear[i3 + 1] = 1.3;
          hdrBgLinear[i3 + 2] = 0.35;
        } else {
          hdrBgLinear[i3] = 0.22;
          hdrBgLinear[i3 + 1] = 0.25;
          hdrBgLinear[i3 + 2] = 0.09;
        }
      }
    }

    // In 8K detail map, a dark green tree canopy extends up into sky rows y=8..19, x=24..40
    const detailData = new Uint8ClampedArray(detW * detH * 4);
    for (let y = 0; y < detH; y++) {
      for (let x = 0; x < detW; x++) {
        const pi = (y * detW + x) * 4;
        const inCanopy = y >= 8 && y <= 19 && x >= 24 && x <= 40;
        if (inCanopy) {
          // Dark green foliage (G > R, G > B)
          detailData[pi] = 34;
          detailData[pi + 1] = 52;
          detailData[pi + 2] = 28;
        } else if (y < 16) {
          // Bright sky
          detailData[pi] = 235;
          detailData[pi + 1] = 212;
          detailData[pi + 2] = 185;
        } else {
          // Meadow ground
          detailData[pi] = 78;
          detailData[pi + 1] = 96;
          detailData[pi + 2] = 48;
        }
        detailData[pi + 3] = 255;
      }
    }

    const fused = fuseGainmapDetailToHalfFloat(
      hdrBgLinear,
      envW,
      envH,
      { data: detailData, width: detW, height: detH },
      16.0
    );

    const lumAt = (x: number, y: number): [number, number, number, number] => {
      const pi = (y * detW + x) * 4;
      const r = THREE.DataUtils.fromHalfFloat(fused[pi]!);
      const g = THREE.DataUtils.fromHalfFloat(fused[pi + 1]!);
      const b = THREE.DataUtils.fromHalfFloat(fused[pi + 2]!);
      return [r, g, b, 0.2126 * r + 0.7152 * g + 0.0722 * b];
    };

    const [, , , skyLum] = lumAt(10, 10);
    const [edgeR, edgeG, edgeB, canopyEdgeLum] = lumAt(24, 10);
    const [inR, inG, inB, canopyInteriorLum] = lumAt(32, 12);

    // Monotonic luminance: dark tree canopy and its silhouette contour must remain much darker than sky (no >1 solarized halo blowup)
    expect(canopyInteriorLum).toBeLessThan(skyLum * 0.35);
    expect(canopyEdgeLum).toBeLessThan(skyLum * 0.45);
    expect(canopyEdgeLum).toBeLessThan(0.5);

    // Chromaticity preservation: dark green foliage must remain green-dominant (G > R and G > B), never inverted red-orange
    expect(edgeG).toBeGreaterThan(edgeR);
    expect(edgeG).toBeGreaterThan(edgeB);
    expect(inG).toBeGreaterThan(inR);
    expect(inG).toBeGreaterThan(inB);
  });

  it('maintains top-zenith (row 0) to bottom-nadir (row H-1) orientation and flipY=true across prepareHdrPanorama and fallback equirect textures', () => {
    const W = 8;
    const H = 4;
    const hdrFloats = new Float32Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        // Bright blue zenith at row 0, dim ground at row H-1
        const val = y === 0 ? 2.0 : 0.1 * (H - y);
        hdrFloats[i] = val * 0.5;
        hdrFloats[i + 1] = val * 0.7;
        hdrFloats[i + 2] = val;
        hdrFloats[i + 3] = 1.0;
      }
    }
    const rawTex = new THREE.DataTexture(hdrFloats, W, H, THREE.RGBAFormat, THREE.FloatType);
    const detailRgba = new Uint8ClampedArray(16 * 8 * 4);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 16; x++) {
        const i = (y * 16 + x) * 4;
        const byte = y < 2 ? 220 : 60;
        detailRgba[i] = byte;
        detailRgba[i + 1] = byte;
        detailRgba[i + 2] = byte;
        detailRgba[i + 3] = 255;
      }
    }

    const prepared = prepareHdrPanorama(rawTex, ENV_PRESETS.day, {
      data: detailRgba,
      width: 16,
      height: 8,
    });
    expect(prepared).not.toBeNull();
    expect(prepared!.background.flipY).toBe(true);
    expect(prepared!.envSource.flipY).toBe(true);

    const bgHalf = prepared!.background.image.data as Uint16Array;
    const zenithG = THREE.DataUtils.fromHalfFloat(bgHalf[1]!);
    const nadirG = THREE.DataUtils.fromHalfFloat(bgHalf[(7 * 16 + 0) * 4 + 1]!);
    expect(zenithG).toBeGreaterThan(nadirG * 3);
  });
});
