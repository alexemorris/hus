import { describe, expect, it } from 'vitest';
import type { CircuitConfig, CircuitId, ScenePreset } from '../../core/types/knx.ts';
import { KNXPropertyBusController } from './emulator.ts';
import { MotionPresenceBridge } from './motion-presence.ts';
import type { KnxLightingZone, KnxPresenceDetectorDevice, KnxProject } from './project.ts';

function circuit(id: CircuitId, zoneId: CircuitConfig['zoneId'], channel: number, dimmable = true): CircuitConfig {
  return {
    id,
    channel,
    name: id,
    shortName: id,
    location: id,
    buildingId: 'mainHouse',
    floorId: 'ground',
    zoneId,
    actuatorPa: '1.1.20',
    gaSwitch: `1/1/${channel}`,
    gaValue: `1/2/${channel}`,
    gaStatus: `1/3/${channel}`,
    isSceneMember: false,
    dimmable,
    defaultLevel: 0,
  };
}

const HALL: KnxLightingZone = {
  id: 'hall',
  name: 'Hall',
  circuits: ['hallPendant', 'hallStairLeds', 'hallLamps5A'],
  scenes: [
    { id: 'bright', label: 'Bright', levels: { hallPendant: 100, hallStairLeds: 80, hallLamps5A: 100 } },
    { id: 'evening', label: 'Evening', levels: { hallPendant: 40, hallStairLeds: 50, hallLamps5A: 60 } },
    { id: 'glow', label: 'Glow', levels: { hallStairLeds: 30 } },
  ],
  nightLevels: { hallStairLeds: 4 },
  ga: { scene: '1/6/4', night: '1/6/5', full: '1/6/6', dim: '1/6/7', sceneStatus: '1/7/2', status: '1/7/3' },
};

const DETECTOR: KnxPresenceDetectorDevice = {
  pa: '1.1.61',
  name: 'Hall PIR',
  zoneId: 'hall',
  gaPresence: '1/4/21',
  position: { x: 0, y: 2.5, z: 0 },
  coverage: { polygon: [[-2, -2], [2, -2], [2, 2], [-2, 2]], minY: 0, maxY: 2.6 },
  params: { holdTimeSec: 60, luxThreshold: 100 },
};

const NO_SCENE: ScenePreset[] = [];

function makeProject(): KnxProject {
  return {
    name: 'Test',
    buildings: {
      mainHouse: { id: 'mainHouse', name: 'House', knxArea: 1, description: '' },
      annex: { id: 'annex', name: 'Annex', knxArea: 2, description: '' },
      courtyardGrounds: { id: 'courtyardGrounds', name: 'Grounds', knxArea: 1, description: '' },
    },
    floors: [],
    rooms: [],
    circuits: [circuit('hallPendant', 'hall', 1), circuit('hallStairLeds', 'hall', 2), circuit('hallLamps5A', 'hall', 3, false)],
    centralScenes: NO_SCENE,
    zones: [HALL],
    pushButtons: [
      {
        pa: '1.1.17',
        name: 'Stair foot',
        mountedInZoneId: 'hall',
        location: 'Hall',
        gangs: [{ gang: 1, zoneId: 'hall', label: 'Hall' }],
        params: { longPressMs: 600 },
      },
    ],
    presenceDetectors: [DETECTOR],
    physicalDevices: [],
    roomAutomation: { nightWalkRules: [], motionCircuitRules: [], motionSensors: [] },
    centralGa: {
      masterOff: '1/0/0',
      centralScene: '1/0/1',
      masterFull: '1/0/2',
      kitchenPresence: '1/4/1',
      ambientLux: '1/4/2',
      utilityPresence: '1/4/3',
      tvArt: '1/4/4',
      carGatesCommand: '1/5/1',
      carGatesPosition: '1/5/2',
    },
    centralPa: {
      ipInterface: '1.1.1',
      aiBridge: '1.1.2',
      kitchenSwitchGroup: '1.1.10',
      kitchenPresence: '1.1.12',
      utilityPresence: '1.1.13',
      utilitySwitch: '1.1.11',
      courtyardSwitch: '1.1.14',
      kitchenActuator: '1.1.20',
      carGates: '1.1.22',
    },
    defaultPresenceHoldTimeSec: 60,
    groupAddresses: [],
  };
}

function levels(knx: KNXPropertyBusController): readonly number[] {
  const t = knx.getTargetLevels();
  return [t.hallPendant, t.hallStairLeds, t.hallLamps5A];
}

describe('KNXPropertyBusController zone gestures', () => {
  it('steps scenes on short presses and wraps both ways', () => {
    const knx = new KNXPropertyBusController(makeProject());
    expect(knx.getZoneState('hall').mode).toBe('off');
    knx.handleZoneSwitchGesture('hall', 'up', 120, '1.1.17');
    expect(knx.getZoneState('hall')).toEqual({ mode: 'scene', sceneIndex: 0 });
    knx.handleZoneSwitchGesture('hall', 'up', 120, '1.1.17');
    expect(knx.getZoneState('hall').sceneIndex).toBe(1);
    knx.handleZoneSwitchGesture('hall', 'down', 120, '1.1.17');
    knx.handleZoneSwitchGesture('hall', 'down', 120, '1.1.17');
    expect(knx.getZoneState('hall').sceneIndex).toBe(2);
    expect(levels(knx)).toEqual([0, 30, 0]);
  });

  it('hold up = full, hold down = night (dim when dark, off in daylight)', () => {
    const knx = new KNXPropertyBusController(makeProject());
    knx.handleZoneSwitchGesture('hall', 'up', 800, '1.1.17');
    expect(knx.getZoneState('hall').mode).toBe('full');
    expect(levels(knx)).toEqual([100, 100, 100]);
    knx.handleZoneSwitchGesture('hall', 'down', 650, '1.1.17');
    expect(knx.getZoneState('hall').mode).toBe('night');
    expect(levels(knx)).toEqual([0, 4, 0]);
    knx.setAmbientLux(500, false);
    expect(levels(knx)).toEqual([0, 0, 0]);
    knx.setAmbientLux(20, false);
    expect(levels(knx)).toEqual([0, 4, 0]);
  });

  it('clamps switched-only channels to 100 %', () => {
    const knx = new KNXPropertyBusController(makeProject());
    knx.recallZoneScene('hall', 1);
    expect(knx.getTargetLevels().hallLamps5A).toBe(100);
    expect(knx.getZoneState('hall')).toEqual({ mode: 'scene', sceneIndex: 1 });
  });
});

describe('KNXPropertyBusController presence', () => {
  it('turns a night zone off after the hold time without presence', () => {
    const knx = new KNXPropertyBusController(makeProject());
    knx.setPresenceHoldTimeOverride(12);
    knx.enterZoneNight('hall');
    knx.stepDimming(6);
    expect(knx.getZoneState('hall').mode).toBe('night');
    knx.stepDimming(7);
    expect(knx.getZoneState('hall').mode).toBe('off');
    expect(levels(knx)).toEqual([0, 0, 0]);
  });

  it('keeps night mode while presence is reported, then expires; presence restores night after dark', () => {
    const knx = new KNXPropertyBusController(makeProject());
    const bridge = new MotionPresenceBridge(knx, knx.getPresenceDetectors());
    knx.enterZoneNight('hall');
    for (let t = 0; t < 120; t += 1) {
      bridge.update({ x: 0.5, y: 0.1, z: 0.5 });
      knx.stepDimming(1);
    }
    expect(knx.getZoneState('hall').mode).toBe('night');
    expect(knx.getPresenceState('1.1.61').detected).toBe(true);
    // Walk out (last movement was 1 s ago): presence holds 60 s, then the zone switches off.
    bridge.update({ x: 10, y: 0.1, z: 10 });
    knx.stepDimming(57);
    expect(knx.getZoneState('hall').mode).toBe('night');
    knx.stepDimming(3);
    expect(knx.getPresenceState('1.1.61').detected).toBe(false);
    expect(knx.getZoneState('hall').mode).toBe('off');
    // Walk back in after dark → night mode restored.
    bridge.update({ x: 0, y: 0.1, z: 0 });
    expect(knx.getZoneState('hall').mode).toBe('night');
    expect(levels(knx)).toEqual([0, 4, 0]);
  });

  it('does not wake an off zone in daylight', () => {
    const knx = new KNXPropertyBusController(makeProject());
    knx.setAmbientLux(800, false);
    knx.reportPresence('1.1.61');
    expect(knx.getZoneState('hall').mode).toBe('off');
  });

  it('emits a 1.018 telegram on presence transitions only', () => {
    const knx = new KNXPropertyBusController(makeProject());
    knx.reportPresence('1.1.61');
    knx.reportPresence('1.1.61');
    const presenceTelegrams = knx.getTelegrams().filter((t) => t.dst === '1/4/21');
    expect(presenceTelegrams).toHaveLength(1);
    expect(presenceTelegrams[0]?.dpt).toBe('1.018');
  });
  it("guards stepDimming against negative/NaN deltas and clamps liveLevels in [0, 100] while reporting hasPendingAnimations", () => {
    const knx = new KNXPropertyBusController(makeProject());
    knx.recallZoneScene("hall", 0);
    for (let i = 0; i < 40; i++) knx.stepDimming(0.05);
    expect(knx.hasPendingAnimations()).toBe(false);
    expect(knx.getLiveLevels().hallPendant).toBe(100);

    // Dusk -> Day turn-off ramp (80 -> 0): negative clock-skew dt (-53.75s) must NEVER drive levels to 6052% or < 0%
    knx.setZoneOff("hall");
    expect(knx.hasPendingAnimations()).toBe(true);
    expect(knx.stepDimming(-53.75)).toBe(false);
    expect(knx.stepDimming(Number.NaN)).toBe(false);
    expect(knx.getLiveLevels().hallPendant).toBe(100);

    for (let i = 0; i < 30; i++) knx.stepDimming(0.05);
    expect(knx.getLiveLevels().hallPendant).toBe(0);
    expect(knx.hasPendingAnimations()).toBe(false);
  });
});
