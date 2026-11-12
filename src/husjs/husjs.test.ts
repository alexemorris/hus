import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  CircuitBus,
  defineHouse,
  gradePad,
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
