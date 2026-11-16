import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  CircuitBus,
  defineHouse,
  gradePad,
  mountHouse,
  normalizeSoundscapeDescriptor,
  wireTwoWay,
  type RoomManifestEntry,
} from 'husjs';
import {
  AudioEngine,
  SoundscapeController,
  attachAudioEmitter,
  computeAcousticOcclusion,
  computeSabineRt60,
  type AcousticPortalState,
  type FloorSurfaceType,
} from 'husjs/audio';
import { Frame2D } from 'husjs/objects';
import { CameraRig, PropertyScene, WalkthroughController } from 'husjs/viewer';
import '../state/shell-store.ts';
import {
  type FakeCanvasElement,
  flushMicrotasks,
  installFakeDom,
} from '../ui/shell/shell-test-harness.ts';

describe('husjs public API (defineHouse, CircuitBus, Frame2D, acoustics)', () => {
  it('defines a 1-floor house with zero-config location, modifiable terrain, soundscape, and 2-way mains wiring', () => {
    const livingEntry: RoomManifestEntry = {
      zoneId: 'living',
      label: 'Living Pavilion',
      group: 'house-ground',
      floor: 'ground',
      lights: [],
      scenes: [],
      devices: [],
    };

    const floorSurface: FloorSurfaceType = 'stone';

    const house = defineHouse({
      id: 'stahl-case-study-22',
      name: 'Stahl House (Case Study House #22)',
      location: { lat: 34.1003, lon: -118.3698, label: 'Hollywood Hills · Los Angeles' },
      floors: [{ id: 'ground', label: 'Main Level', elevationY: 0, ceilingHeight: 2.75 }],
      terrain: {
        base: 'flat',
        flatElevationY: -4.0,
        modifiers: [gradePad({ minX: -12, maxX: 12, minZ: -8, maxZ: 8, elevationY: 0, featherM: 3 })],
      },
      soundscape: 'hills-city',
      rooms: {
        manifest: [livingEntry],
        navTree: [{ id: 'main', label: 'Pavilion', rooms: [livingEntry] }],
      },
      zones: {
        modules: [],
        lodRegistrations: [
          {
            zoneId: 'living',
            shortName: 'Living',
            floorId: 'ground',
            isInterior: true,
            floorSurface,
            volumeM3: 110,
            primarySurface: 'glass',
            bounds: { minX: -8, maxX: 8, minY: 0, maxY: 2.8, minZ: -5, maxZ: 5 },
          },
        ],
        circuitMaxIntensity: { livingSoffit: 6.5 },
      },
      electrical: {
        circuits: [
          {
            id: 'livingSoffit',
            name: 'Living Soffit',
            zoneId: 'living',
            wiring: wireTwoWay('swEntry', 'swHall'),
          },
        ],
        switches: [
          { id: 'swEntry', initialPose: 'up' },
          { id: 'swHall', initialPose: 'up' },
        ],
      },
    });

    expect(house.floors).toHaveLength(1);
    expect(house.terrainSampler.sampleTerrainY(0, 0)).toBeCloseTo(0, 5);
    expect(house.terrainSampler.sampleTerrainY(30, 30)).toBeCloseTo(-4.0, 5);
    expect(normalizeSoundscapeDescriptor(house.soundscape)?.preset).toBe('hills-city');

    const profile = house.createSceneProfile();
    expect(profile.name).toBe('Stahl House (Case Study House #22)');
    expect(profile.location?.lat).toBeCloseTo(34.1003, 5);
    expect(profile.soundscape).toBe('hills-city');

    const bus = new CircuitBus(house.electrical);
    const initial = bus.getCircuitBrightness('livingSoffit');
    bus.flipSwitch('swEntry');
    expect(bus.getCircuitBrightness('livingSoffit')).toBe(initial > 0 ? 0 : 1);
    bus.flipSwitch('swHall');
    expect(bus.getCircuitBrightness('livingSoffit')).toBe(initial);

    const frame = Frame2D.fromOriginAndAngle(2, 3, Math.PI / 2);
    const [wx, wz] = frame.toWorldXZ(1, 0);
    expect(wx).toBeCloseTo(2, 6);
    expect(wz).toBeCloseTo(2, 6);

    const speaker = new THREE.Group();
    const emitter = attachAudioEmitter(speaker, { kind: 'continuous', preset: 'waterFeature' });
    expect(emitter.isActive()).toBe(true);
    emitter.dispose();

    const portal: AcousticPortalState = {
      id: 'sliding-wall',
      position: [0, 1.4, 5],
      areaM2: 12,
      openness: 0.75,
    };
    const rt60 = computeSabineRt60({ volumeM3: 110, primarySurface: 'glass', openPortalAreaM2: 0 });
    const occlusion = computeAcousticOcclusion({
      listenerPos: [0, 1.5, 2],
      isInterior: true,
      room: { volumeM3: 110, primarySurface: 'glass' },
      exteriorPortals: [portal],
    });
    expect(occlusion.reverbDecaySec).toBeLessThan(rt60);
    expect(occlusion.effectiveOpenness).toBeGreaterThan(0.5);

    const engine = new AudioEngine();
    const controller = new SoundscapeController(engine);
    controller.setSoundscape('hills-city');
    expect(controller.getSoundscape().preset).toBe('hills-city');
    controller.dispose();
    engine.dispose();
  });
});

describe('mountHouse, PropertyScene & WalkthroughController lifecycle & async safety', () => {
  it('tears down Preact shell, DOM/window/canvas listeners, ResizeObserver, rAF handles, and mid-await warmup cleanly and idempotently', async () => {
    const dom = installFakeDom();
    const fakeDoc = dom.document;
    const fakeWin = dom.window;
    const hostDiv = fakeDoc.createElement('div');
    hostDiv.id = 'app';
    fakeDoc.body.appendChild(hostDiv);

    try {
      const livingEntry: RoomManifestEntry = {
        zoneId: 'living',
        label: 'Living',
        group: 'house-ground',
        floor: 'ground',
        lights: [],
        scenes: [],
        devices: [],
      };

      let createdScene: PropertyScene | null = null;
      const house = defineHouse({
        id: 'lifecycle-test-house',
        name: 'Lifecycle Test House',
        location: { lat: 34.1, lon: -118.37, label: 'Test Hills' },
        floors: [{ id: 'ground', label: 'Ground', elevationY: 0, ceilingHeight: 2.7 }],
        terrain: { base: 'flat', flatElevationY: 0 },
        rooms: {
          manifest: [livingEntry],
          navTree: [{ id: 'main', label: 'Main', rooms: [livingEntry] }],
        },
        zones: {
          modules: [],
          circuitMaxIntensity: {},
          lodRegistrations: [
            {
              zoneId: 'living',
              shortName: 'Living',
              floorId: 'ground',
              isInterior: true,
              bounds: { minX: -4, maxX: 4, minY: 0, maxY: 2.7, minZ: -4, maxZ: 4 },
            },
          ],
        },
        createScene: (canvas, onInteract, profile) => {
          const ps = new PropertyScene(canvas, onInteract, profile);
          // Skip WebGPU device init in headless Node while keeping real PropertyScene teardown
          vi.spyOn(ps, 'warmUpForStartup').mockResolvedValue(undefined);
          createdScene = ps;
          return ps;
        },
      });

      const mounted = await mountHouse(house, hostDiv as unknown as HTMLElement);

      const shellRoot = hostDiv.querySelector('#shell-root')!;
      const canvasEl = hostDiv.querySelector('#three-canvas') as FakeCanvasElement;
      expect(createdScene).not.toBeNull();
      expect(shellRoot.children.length).toBeGreaterThan(0);
      expect(shellRoot.querySelector('.shell-help-backdrop')).toBeNull();
      expect(dom.resizeObserver.observes).toBe(1);
      expect(fakeWin.countListeners()).toBeGreaterThan(0);
      expect(fakeDoc.countListeners()).toBeGreaterThan(0);
      expect(canvasEl.countListeners()).toBeGreaterThan(0);
      expect(dom.visualViewport.countListeners()).toBe(1);
      expect(dom.pendingRafs.size).toBeGreaterThan(0);

      // Dispose mounted house and verify idempotent full teardown
      mounted.dispose();
      mounted.dispose();

      expect(shellRoot.children).toHaveLength(0);
      expect(dom.resizeObserver.disconnects).toBe(1);
      expect(dom.pendingRafs.size).toBe(0);
      expect(fakeWin.countListeners()).toBe(0);
      expect(fakeDoc.countListeners()).toBe(0);
      expect(dom.visualViewport.countListeners()).toBe(0);
      expect(canvasEl.countListeners()).toBe(0);
      expect(createdScene!.renderer.isDisposed()).toBe(true);
      expect((fakeWin as unknown as Record<string, unknown>)['__HUSJS_MOUNTED__']).toBeUndefined();

      // Also verify mid-await disposal of PropertyScene.warmUpForStartup() prevents post-dispose continuation
      const midCanvas = fakeDoc.createElement('canvas') as FakeCanvasElement;
      const midScene = new PropertyScene(midCanvas as unknown as HTMLCanvasElement, () => {}, house.createSceneProfile());
      let resolveInit!: () => void;
      vi.spyOn(midScene.renderer, 'init').mockImplementation(
        () =>
          new Promise<void>((r) => {
            resolveInit = r;
          })
      );
      const preloadSpy = vi.spyOn(midScene.environment, 'preloadActiveHdr');
      const progressCalls: number[] = [];

      const warmPromise = midScene.warmUpForStartup((_label, frac) => {
        progressCalls.push(frac);
      });
      midScene.dispose();
      resolveInit();
      await warmPromise;

      expect(progressCalls).toEqual([]);
      expect(preloadSpy).not.toHaveBeenCalled();
    } finally {
      dom.restore();
    }
  });

  it('catches async SecurityError rejections from canvas.requestPointerLock() without unhandled rejections', async () => {
    const dom = installFakeDom();
    const fakeDoc = dom.document;
    const fakeWin = dom.window;
    const canvas = fakeDoc.createElement('canvas') as FakeCanvasElement;
    let pointerLockCalls = 0;
    canvas.requestPointerLock = () => {
      pointerLockCalls++;
      return Promise.reject(new Error('SecurityError: The user has exited the lock before this request was completed.'));
    };

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);

    try {
      const scene = new THREE.Scene();
      const rig = new CameraRig(canvas as unknown as HTMLCanvasElement, () => {});
      const walkthrough = new WalkthroughController({
        canvas: canvas as unknown as HTMLCanvasElement,
        scene,
        rig,
        getRoomMinYAt: () => 0,
        getInteractiveMeshes: () => [],
        describeInteractable: () => '',
        onInteractWithMesh: () => {},
        onStateChanged: () => {},
        onPoseUpdated: () => {},
        hooks: {
          spawns: [{ id: 'entry', zoneId: 'living', label: 'Entry', position: [0, 0, 0], yawDeg: 0 }],
        },
      });

      walkthrough.enter({
        position: [0, 2, 5],
        target: [0, 1, 0],
        floorViewMode: 'ground',
        ceilingCutaway: false,
        isOrthographic: false,
      });
      walkthrough.requestMouseLock();
      canvas.dispatch('pointerdown', {
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
        clientX: 100,
        clientY: 100,
      });

      await flushMicrotasks();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(pointerLockCalls).toBe(2);
      expect(unhandled).toHaveLength(0);

      fakeDoc.pointerLockElement = canvas;
      walkthrough.dispose();
      expect(fakeDoc.exitPointerLock).toHaveBeenCalled();
      expect(fakeWin.countListeners()).toBe(0);
      expect(fakeDoc.listeners.get('pointerlockchange')?.size ?? 0).toBe(0);
      rig.dispose();
      expect(fakeDoc.countListeners()).toBe(0);
      expect(canvas.countListeners()).toBe(0);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      dom.restore();
    }
  });
});
