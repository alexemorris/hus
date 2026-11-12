import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  normalizeSoundscapeDescriptor,
  type AcousticPortalState,
  type FloorSurfaceType,
  type SoundscapePresetId,
} from '../../core/types/acoustics.ts';
import { AmbientSoundscape } from '../lighting/env/ambient-soundscape.ts';
import {
  SURFACE_ABSORPTION_COEFFS,
  computeAcousticOcclusion,
  computeSabineRt60,
} from './acoustic-occlusion.ts';
import { SoundEngine } from './sound-engine.ts';
import {
  attachAudioEmitter,
  getAttachedAudioEmitters,
  playFoleyAtObject,
} from './spatial-emitters.ts';

describe('acoustics & soundscape API', () => {
  describe('core acoustics types', () => {
    it('exports FloorSurfaceType and AcousticPortalState cleanly', () => {
      const surfaces: readonly FloorSurfaceType[] = [
        'wood',
        'stone',
        'turf',
        'gravel',
        'stair',
        'ladder',
      ];
      expect(surfaces).toHaveLength(6);

      const portal: AcousticPortalState = {
        id: 'courtyard-bifolds',
        position: [0, 1.4, 3.2],
        areaM2: 9.5,
        openness: 0.75,
      };
      expect(portal.openness).toBe(0.75);
    });
  });

  describe('normalizeSoundscapeDescriptor', () => {
    it('normalizes omitted input and all 5 declarative presets with defaults', () => {
      expect(normalizeSoundscapeDescriptor()).toEqual({
        preset: 'countryside',
        gain: 1,
        channelLayout: 'stereo',
      });

      const presets: readonly SoundscapePresetId[] = [
        'countryside',
        'coastal',
        'hills-city',
        'urban',
        'quiet',
      ];
      for (const preset of presets) {
        expect(normalizeSoundscapeDescriptor(preset)).toEqual({
          preset,
          gain: 1,
          channelLayout: 'stereo',
        });
      }
    });

    it('preserves custom stem URLs, clamps gain, and validates channel layout', () => {
      const normalized = normalizeSoundscapeDescriptor({
        preset: 'hills-city',
        gain: 1.45,
        dayUrl: 'https://assets.example.com/stahl-day.ogg',
        duskUrl: '  https://assets.example.com/stahl-dusk.ogg  ',
        nightUrl: 'https://assets.example.com/stahl-night.ogg',
        windUrl: 'https://assets.example.com/canyon-wind.ogg',
        rainUrl: 'https://assets.example.com/rain.ogg',
        channelLayout: 'foa',
      });

      expect(normalized).toEqual({
        preset: 'hills-city',
        gain: 1.45,
        channelLayout: 'foa',
        dayUrl: 'https://assets.example.com/stahl-day.ogg',
        duskUrl: 'https://assets.example.com/stahl-dusk.ogg',
        nightUrl: 'https://assets.example.com/stahl-night.ogg',
        windUrl: 'https://assets.example.com/canyon-wind.ogg',
        rainUrl: 'https://assets.example.com/rain.ogg',
      });

      expect(normalizeSoundscapeDescriptor({ preset: 'coastal', gain: 5 }).gain).toBe(2);
      expect(normalizeSoundscapeDescriptor({ preset: 'coastal', gain: -1 }).gain).toBe(0);
    });
  });

  describe('AmbientSoundscape', () => {
    it('crossfades time-of-day stem weights smoothly across discrete modes and 0..24 civil hours', () => {
      expect(AmbientSoundscape.computeTimeOfDayStemWeights('day')).toEqual({
        day: 1,
        dusk: 0,
        night: 0,
      });
      expect(AmbientSoundscape.computeTimeOfDayStemWeights('dusk')).toEqual({
        day: 0,
        dusk: 1,
        night: 0,
      });
      expect(AmbientSoundscape.computeTimeOfDayStemWeights('night')).toEqual({
        day: 0,
        dusk: 0,
        night: 1,
      });

      const noon = AmbientSoundscape.computeTimeOfDayStemWeights(12);
      expect(noon.day).toBeCloseTo(1, 5);
      expect(noon.dusk).toBeCloseTo(0, 5);
      expect(noon.night).toBeCloseTo(0, 5);

      const midnight = AmbientSoundscape.computeTimeOfDayStemWeights(0);
      expect(midnight.night).toBeCloseTo(1, 5);
      expect(midnight.day).toBeCloseTo(0, 5);

      const sunset = AmbientSoundscape.computeTimeOfDayStemWeights(18.8);
      expect(sunset.dusk).toBeGreaterThan(0.95);

      const dawn = AmbientSoundscape.computeTimeOfDayStemWeights(6.2);
      expect(dawn.dusk).toBeGreaterThan(0.95);

      let prev = AmbientSoundscape.computeTimeOfDayStemWeights(0);
      for (let h = 0.25; h <= 24.0; h += 0.25) {
        const w = AmbientSoundscape.computeTimeOfDayStemWeights(h);
        expect(w.day).toBeGreaterThanOrEqual(0);
        expect(w.dusk).toBeGreaterThanOrEqual(0);
        expect(w.night).toBeGreaterThanOrEqual(0);
        expect(w.day + w.dusk + w.night).toBeCloseTo(1, 6);
        expect(Math.abs(w.day - prev.day)).toBeLessThan(0.3);
        expect(Math.abs(w.dusk - prev.dusk)).toBeLessThan(0.3);
        expect(Math.abs(w.night - prev.night)).toBeLessThan(0.3);
        prev = w;
      }
    });

    it('updates headless-safely across preset changes and custom occlusion states', () => {
      const soundscape = new AmbientSoundscape('coastal');
      expect(soundscape.getSoundscape().preset).toBe('coastal');

      soundscape.setSoundscape({
        preset: 'hills-city',
        gain: 0.9,
        nightUrl: 'https://assets.example.com/night.ogg',
        channelLayout: 'quad',
      });
      expect(soundscape.getSoundscape().preset).toBe('hills-city');
      expect(soundscape.getSoundscape().channelLayout).toBe('quad');

      const occ = computeAcousticOcclusion({
        listenerPos: [0, 1.5, 0],
        isInterior: true,
        room: { zoneId: 'living', volumeM3: 110, primarySurface: 'glass' },
        exteriorPortals: [{ id: 'slider', position: [0, 1.5, 2], areaM2: 12, openness: 0.8 }],
      });

      expect(() =>
        soundscape.update(
          0.016,
          'dusk',
          true,
          true,
          { windSpeedKph: 18, rainIntensity: 0.3, snowIntensity: 0 },
          occ
        )
      ).not.toThrow();
      expect(() => soundscape.dispose()).not.toThrow();
    });
  });

  describe('computeSabineRt60 & computeAcousticOcclusion', () => {
    it('scales standalone Sabine RT60 cleanly with room volume, finish absorption, and open portal area', () => {
      const stoneBarn = computeSabineRt60({
        volumeM3: 360,
        primarySurface: 'stone',
      });
      const timberKitchen = computeSabineRt60({
        volumeM3: 90,
        primarySurface: 'timber',
      });
      const carpetSnug = computeSabineRt60({
        volumeM3: 32,
        primarySurface: 'carpet',
      });
      const openStoneBarn = computeSabineRt60({
        volumeM3: 360,
        primarySurface: 'stone',
        openPortalAreaM2: 16,
      });

      expect(stoneBarn).toBeGreaterThan(timberKitchen);
      expect(timberKitchen).toBeGreaterThan(carpetSnug);
      expect(openStoneBarn).toBeLessThan(stoneBarn);
      expect(carpetSnug).toBeGreaterThanOrEqual(0.12);
      expect(stoneBarn).toBeLessThanOrEqual(2.2);
    });

    it('distinguishes outdoors (18 kHz) from sealed indoors (~720 Hz) accurately', () => {
      const outdoor = computeAcousticOcclusion({
        listenerPos: [5, 1.6, 5],
        isInterior: false,
      });
      expect(outdoor.isInterior).toBe(false);
      expect(outdoor.effectiveOpenness).toBe(1);
      expect(outdoor.exteriorLowpassHz).toBe(18000);
      expect(outdoor.exteriorHighShelfDb).toBe(0);
      expect(outdoor.exteriorGainScale).toBe(1);
      expect(outdoor.reverbWetSend).toBeLessThanOrEqual(0.06);

      const sealed = computeAcousticOcclusion({
        listenerPos: [0, 1.6, 0],
        isInterior: true,
        room: { zoneId: 'living', volumeM3: 85, primarySurface: 'plaster' },
        exteriorPortals: [{ id: 'glass-wall', position: [0, 1.5, 2], areaM2: 12, openness: 0 }],
      });
      expect(sealed.isInterior).toBe(true);
      expect(sealed.effectiveOpenness).toBe(0);
      expect(sealed.exteriorLowpassHz).toBeCloseTo(720, 1);
      expect(sealed.exteriorHighShelfDb).toBeCloseTo(-14, 1);
      expect(sealed.exteriorGainScale).toBeCloseTo(0.18, 2);
      expect(sealed.reverbWetSend).toBeGreaterThan(outdoor.reverbWetSend);
    });

    it('opens exterior acoustics and reduces RT60 when a wide nearby glass wall slides open', () => {
      const closed = computeAcousticOcclusion({
        listenerPos: [0, 1.5, 0],
        isInterior: true,
        room: { zoneId: 'greatRoom', volumeM3: 140, primarySurface: 'stone' },
        exteriorPortals: [{ id: 'slider-east', position: [0, 1.5, 1.8], areaM2: 12, openness: 0 }],
      });

      const halfOpen = computeAcousticOcclusion({
        listenerPos: [0, 1.5, 0],
        isInterior: true,
        room: { zoneId: 'greatRoom', volumeM3: 140, primarySurface: 'stone' },
        exteriorPortals: [
          { id: 'slider-east', position: [0, 1.5, 1.8], areaM2: 12, openness: 0.45 },
        ],
      });

      const open = computeAcousticOcclusion({
        listenerPos: [0, 1.5, 0],
        isInterior: true,
        room: { zoneId: 'greatRoom', volumeM3: 140, primarySurface: 'stone' },
        exteriorPortals: [{ id: 'slider-east', position: [0, 1.5, 1.8], areaM2: 12, openness: 1 }],
      });

      expect(closed.exteriorLowpassHz).toBeCloseTo(720, 1);
      expect(halfOpen.exteriorLowpassHz).toBeGreaterThan(closed.exteriorLowpassHz);
      expect(open.exteriorLowpassHz).toBeGreaterThan(halfOpen.exteriorLowpassHz);
      expect(open.effectiveOpenness).toBeGreaterThan(0.8);
      expect(open.exteriorLowpassHz).toBeGreaterThan(8500);
      expect(open.exteriorHighShelfDb).toBeGreaterThan(-3.5);
      expect(open.exteriorGainScale).toBeGreaterThan(0.8);
      expect(open.reverbDecaySec).toBeLessThan(closed.reverbDecaySec);
      expect(open.reverbWetSend).toBeLessThan(closed.reverbWetSend);
    });

    it('weights open portals strongly by distance from the listener', () => {
      const near = computeAcousticOcclusion({
        listenerPos: [0, 1.5, 0],
        isInterior: true,
        exteriorPortals: [{ id: 'portal', position: [2, 1.5, 0], areaM2: 10, openness: 1 }],
      });

      const far = computeAcousticOcclusion({
        listenerPos: [0, 1.5, 0],
        isInterior: true,
        exteriorPortals: [{ id: 'portal', position: [22, 1.5, 0], areaM2: 10, openness: 1 }],
      });

      expect(near.effectiveOpenness).toBeGreaterThan(far.effectiveOpenness * 4);
      expect(near.exteriorLowpassHz).toBeGreaterThan(far.exteriorLowpassHz * 3);
      expect(near.exteriorGainScale).toBeGreaterThan(far.exteriorGainScale);
    });

    it('computes longer Sabine RT60 and wetter reverb for large stone rooms than small carpeted rooms', () => {
      expect(SURFACE_ABSORPTION_COEFFS.stone).toBeLessThan(SURFACE_ABSORPTION_COEFFS.carpet);

      const stoneHall = computeAcousticOcclusion({
        listenerPos: [0, 1.5, 0],
        isInterior: true,
        room: { zoneId: 'hall', volumeM3: 320, primarySurface: 'stone' },
      });

      const carpetedStudy = computeAcousticOcclusion({
        listenerPos: [0, 1.5, 0],
        isInterior: true,
        room: { zoneId: 'study', volumeM3: 28, primarySurface: 'carpet' },
      });

      expect(stoneHall.reverbDecaySec).toBeGreaterThan(carpetedStudy.reverbDecaySec * 3);
      expect(stoneHall.reverbWetSend).toBeGreaterThan(carpetedStudy.reverbWetSend);
    });

    it('stores and exposes acoustic occlusion state cleanly on SoundEngine in headless mode', () => {
      const engine = new SoundEngine();
      const occ = computeAcousticOcclusion({
        listenerPos: [0, 1.5, 0],
        isInterior: true,
        room: { zoneId: 'kitchen', volumeM3: 95, primarySurface: 'tile' },
        exteriorPortals: [{ id: 'bifold', position: [0, 1.5, 3], areaM2: 10, openness: 0.5 }],
      });

      expect(() => engine.applyAcousticOcclusion(occ)).not.toThrow();
      expect(engine.getAcousticOcclusion()).toEqual(occ);
      expect(engine.getExteriorAmbientBus()).toBeNull();

      const cam = new THREE.PerspectiveCamera();
      cam.position.set(1, 1.6, 2);
      cam.updateMatrixWorld(true);
      expect(() => engine.updateListener(cam, true, occ)).not.toThrow();
      engine.dispose();
    });
  });

  describe('attachAudioEmitter & spatial foley', () => {
    it('attaches continuous and one-shot emitters without mutating object3d.userData', () => {
      const room = new THREE.Group();
      const stove = new THREE.Object3D();
      stove.position.set(2, 0.5, -1);
      const wallSwitch = new THREE.Object3D();
      wallSwitch.position.set(-1, 1.2, 0);
      const door = new THREE.Object3D();
      const drawer = new THREE.Object3D();
      room.add(stove, wallSwitch, door, drawer);

      const stoveHandle = attachAudioEmitter(stove, {
        id: 'hearth',
        kind: 'continuous',
        preset: 'woodStove',
        volume: 0.8,
        zoneId: 'sitting',
      });
      const switchHandle = attachAudioEmitter(wallSwitch, {
        kind: 'oneshot',
        preset: 'switchClick',
      });
      const doorHandle = attachAudioEmitter(door, {
        kind: 'oneshot',
        preset: 'doorLatch',
      });
      const drawerHandle = attachAudioEmitter(drawer, {
        kind: 'oneshot',
        preset: 'drawerSlide',
      });

      // Snapshot-clean invariant: zero keys written to object3d.userData
      expect(Object.keys(room.userData)).toEqual([]);
      expect(Object.keys(stove.userData)).toEqual([]);
      expect(Object.keys(wallSwitch.userData)).toEqual([]);
      expect(Object.keys(door.userData)).toEqual([]);
      expect(Object.keys(drawer.userData)).toEqual([]);

      expect(getAttachedAudioEmitters(room)).toHaveLength(4);
      expect(stoveHandle.isActive()).toBe(true);
      expect(stoveHandle.getVolume()).toBeCloseTo(0.8, 5);
      stoveHandle.setVolume(0.6);
      expect(stoveHandle.getVolume()).toBeCloseTo(0.6, 5);

      expect(() => switchHandle.trigger()).not.toThrow();
      expect(() => doorHandle.trigger()).not.toThrow();
      expect(() => drawerHandle.trigger()).not.toThrow();
      expect(() => playFoleyAtObject(wallSwitch, 'gateLatch')).not.toThrow();
      expect(() => stoveHandle.update(0.016, [0, 1.6, 0])).not.toThrow();

      stoveHandle.setActive(false);
      expect(stoveHandle.isActive()).toBe(false);
      expect(stoveHandle.evaluateAtListener([2, 0.5, -1]).effectiveGain).toBe(0);

      stoveHandle.dispose();
      switchHandle.dispose();
      doorHandle.dispose();
      drawerHandle.dispose();
      expect(getAttachedAudioEmitters(room)).toHaveLength(0);
      expect(Object.keys(stove.userData)).toEqual([]);
    });

    it('clamps areaSize box emitter distance to zero inside/on the pool edge and rolls off smoothly beyond', () => {
      const pool = new THREE.Object3D();
      pool.position.set(10, 0, 5);

      const poolEmitter = attachAudioEmitter(pool, {
        kind: 'continuous',
        preset: 'waterFeature',
        areaSize: [8, 0.2, 3],
        refDistance: 2,
        maxDistance: 24,
        isExterior: true,
        volume: 1,
      });

      expect(Object.keys(pool.userData)).toEqual([]);

      // Listener at center and along pool rim (`x in [6..14]`, `y in [-0.1..0.1]`, `z in [3.5..6.5]`)
      const onRim = poolEmitter.evaluateAtListener([14, 0, 6.5]);
      expect(onRim.distanceM).toBe(0);
      expect(onRim.effectiveGain).toBeCloseTo(1, 5);

      const inside = poolEmitter.evaluateAtListener([7.5, 0.05, 4.2]);
      expect(inside.distanceM).toBe(0);
      expect(inside.samplePoint).toEqual([7.5, 0.05, 4.2]);

      // 4 m outside the east edge (`x = 18` -> closest box edge `x = 14`, `distanceM = 4`)
      const nearby = poolEmitter.evaluateAtListener([18, 0, 5]);
      expect(nearby.samplePoint[0]).toBeCloseTo(14, 5);
      expect(nearby.samplePoint[1]).toBeCloseTo(0, 5);
      expect(nearby.samplePoint[2]).toBeCloseTo(5, 5);
      expect(nearby.distanceM).toBeCloseTo(4, 5);
      expect(nearby.effectiveGain).toBeLessThan(1);
      expect(nearby.effectiveGain).toBeGreaterThan(0.2);

      // Farther away rolls off strictly below nearby
      const far = poolEmitter.evaluateAtListener([26, 0, 5]);
      expect(far.distanceM).toBeCloseTo(12, 5);
      expect(far.effectiveGain).toBeLessThan(nearby.effectiveGain);

      poolEmitter.dispose();
    });

    it('attenuates and low-passes exterior emitters indoors when portals are shut (~720 Hz), opening up when portals open', () => {
      const pool = new THREE.Object3D();
      pool.position.set(0, 0, 5);
      const poolEmitter = attachAudioEmitter(pool, {
        kind: 'continuous',
        preset: 'waterFeature',
        areaSize: [8, 0.2, 3],
        isExterior: true,
        refDistance: 3,
        maxDistance: 30,
      });

      const listenerPos: readonly [number, number, number] = [0, 1.5, 2.5];

      const outdoorEval = poolEmitter.evaluateAtListener(
        listenerPos,
        computeAcousticOcclusion({ listenerPos, isInterior: false })
      );

      const sealedIndoorEval = poolEmitter.evaluateAtListener(
        listenerPos,
        computeAcousticOcclusion({
          listenerPos,
          isInterior: true,
          exteriorPortals: [{ id: 'glass-wall', position: [0, 1.5, 3], areaM2: 14, openness: 0 }],
        })
      );

      const openIndoorEval = poolEmitter.evaluateAtListener(
        listenerPos,
        computeAcousticOcclusion({
          listenerPos,
          isInterior: true,
          exteriorPortals: [{ id: 'glass-wall', position: [0, 1.5, 3], areaM2: 14, openness: 1 }],
        })
      );

      expect(outdoorEval.lowpassHz).toBe(18000);
      expect(sealedIndoorEval.lowpassHz).toBeCloseTo(720, 1);
      expect(sealedIndoorEval.effectiveGain).toBeLessThan(outdoorEval.effectiveGain * 0.25);

      expect(openIndoorEval.lowpassHz).toBeGreaterThan(10000);
      expect(openIndoorEval.effectiveGain).toBeGreaterThan(sealedIndoorEval.effectiveGain * 4);
      expect(openIndoorEval.effectiveGain).toBeLessThan(outdoorEval.effectiveGain);

      poolEmitter.dispose();
    });
  });
});
