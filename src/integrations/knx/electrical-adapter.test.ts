import { describe, expect, it } from 'vitest';
import type { CircuitConfig, CircuitId, ScenePreset } from '../../core/types/knx.ts';
import { buildTP1FrameHex, encodeDpt1, encodeDpt5Scaling } from './dpt-codec.ts';
import {
  KnxElectricalAdapter,
  createCircuitBusFromKnx,
  createKnxElectricalAdapter,
} from './electrical-adapter.ts';
import { KNXPropertyBusController } from './emulator.ts';
import type { KnxLightingZone, KnxPresenceDetectorDevice, KnxProject } from './project.ts';

function makeCircuit(
  id: CircuitId,
  zoneId: CircuitConfig['zoneId'],
  channel: number,
  dimmable = true
): CircuitConfig {
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
    isSceneMember: zoneId === 'kitchen',
    dimmable,
    defaultLevel: 0,
  };
}

const HALL_ZONE: KnxLightingZone = {
  id: 'hall',
  name: 'Hall',
  circuits: ['hallPendant', 'hallStairLeds', 'hallLamps5A'],
  scenes: [
    {
      id: 'bright',
      label: 'Bright',
      levels: { hallPendant: 100, hallStairLeds: 80, hallLamps5A: 100 },
    },
    {
      id: 'evening',
      label: 'Evening',
      levels: { hallPendant: 40, hallStairLeds: 50, hallLamps5A: 100 },
    },
  ],
  nightLevels: { hallStairLeds: 10 },
  ga: {
    scene: '1/6/4',
    night: '1/6/5',
    full: '1/6/6',
    dim: '1/6/7',
    sceneStatus: '1/7/2',
    status: '1/7/3',
  },
};

const KITCHEN_ZONE: KnxLightingZone = {
  id: 'kitchen',
  name: 'Kitchen',
  circuits: ['islandPendants', 'spotlights'],
  scenes: [
    {
      id: 'cooking',
      label: 'Cooking',
      levels: { islandPendants: 90, spotlights: 100 },
    },
    {
      id: 'dining',
      label: 'Dining',
      levels: { islandPendants: 50, spotlights: 20 },
    },
  ],
  nightLevels: { islandPendants: 6 },
  ga: {
    scene: '1/6/10',
    night: '1/6/11',
    full: '1/6/12',
    dim: '1/6/13',
    sceneStatus: '1/7/10',
    status: '1/7/11',
  },
};

const HALL_DETECTOR: KnxPresenceDetectorDevice = {
  pa: '1.1.61',
  name: 'Hall PIR',
  zoneId: 'hall',
  gaPresence: '1/4/21',
  position: { x: 0, y: 2.5, z: 0 },
  coverage: {
    polygon: [
      [-2, -2],
      [2, -2],
      [2, 2],
      [-2, 2],
    ],
    minY: 0,
    maxY: 2.6,
  },
  params: { holdTimeSec: 30, luxThreshold: 100 },
};

const CENTRAL_SCENES: ScenePreset[] = [
  {
    index: 0,
    number: 1,
    code: 'S1',
    name: 'DayBright',
    shortLabel: 'Bright',
    isSwitchScene: true,
    levels: {
      islandPendants: 85,
      sittingPendants: 0,
      bifoldUplights: 0,
      spotlights: 100,
      underCabinet: 0,
      aboveCabinet: 0,
    },
  },
];

function makeTestProject(): KnxProject {
  return {
    name: 'KNX Adapter Test Project',
    buildings: {
      mainHouse: { id: 'mainHouse', name: 'Main House', knxArea: 1, description: '' },
      annex: { id: 'annex', name: 'Annex', knxArea: 2, description: '' },
      courtyardGrounds: { id: 'courtyardGrounds', name: 'Grounds', knxArea: 1, description: '' },
    },
    floors: [],
    rooms: [],
    circuits: [
      makeCircuit('hallPendant', 'hall', 1),
      makeCircuit('hallStairLeds', 'hall', 2),
      makeCircuit('hallLamps5A', 'hall', 3, false),
      makeCircuit('islandPendants', 'kitchen', 4),
      makeCircuit('spotlights', 'kitchen', 5),
      makeCircuit('wineCellarLeds', 'bootLobby', 6, false),
    ],
    centralScenes: CENTRAL_SCENES,
    zones: [HALL_ZONE, KITCHEN_ZONE],
    pushButtons: [
      {
        pa: '1.1.17',
        name: 'Hall 2-Gang Plate',
        mountedInZoneId: 'hall',
        location: 'Hall Foot of Stairs',
        gangs: [
          { gang: 1, zoneId: 'hall', label: 'Hall' },
          { gang: 2, zoneId: 'kitchen', label: 'Kitchen' },
        ],
        params: { longPressMs: 600 },
      },
    ],
    presenceDetectors: [HALL_DETECTOR],
    physicalDevices: [],
    roomAutomation: {
      nightWalkRules: [],
      motionCircuitRules: [
        {
          circuitId: 'wineCellarLeds',
          sensorId: 'wineCellar',
          onLevel: 100,
        },
      ],
      motionSensors: [
        {
          id: 'wineCellar',
          pa: '1.1.70',
          ga: '1/4/30',
          name: 'Wine Cellar PIR',
          zoneId: 'bootLobby',
        },
      ],
    },
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
    defaultPresenceHoldTimeSec: 30,
    groupAddresses: [],
  };
}

describe('KnxElectricalAdapter', () => {
  it('populates circuits, zones/scenes, and multi-gang push-buttons onto CircuitBus', () => {
    const knx = new KNXPropertyBusController(makeTestProject());
    const bus = createCircuitBusFromKnx(knx);

    expect(bus.getCircuits().map((c) => c.id)).toEqual([
      'hallPendant',
      'hallStairLeds',
      'hallLamps5A',
      'islandPendants',
      'spotlights',
      'wineCellarLeds',
    ]);
    expect(bus.getZone('hall')?.scenes.map((s) => s.id)).toEqual(['bright', 'evening']);
    const plate = bus.getWallPlate('1.1.17');
    expect(plate?.gangs).toHaveLength(2);
    expect(plate?.gangs[0]?.label).toBe('Hall');
    expect(plate?.gangs[1]?.label).toBe('Kitchen');
  });

  it('handles KNX push-button gestures, scene recalls, zone modes, and indicator states', () => {
    const knx = new KNXPropertyBusController(makeTestProject());
    const adapter = createKnxElectricalAdapter(knx);
    const { bus } = adapter;

    // Short press down on gang 1 -> updates gang pose to 'down' and steps Hall scene
    adapter.pressSwitchGang({
      switchPa: '1.1.17',
      gang: 1,
      direction: 'up',
      pressDurationMs: 120,
    });
    expect(bus.getPlateGangPose('1.1.17', 1)).toBe('up');
    expect(bus.getPlateGangIndicator('1.1.17', 1)).toBe(true);
    expect(bus.getCircuitBrightness('hallPendant')).toBeCloseTo(1.0, 5);
    expect(bus.getCircuitBrightness('hallStairLeds')).toBeCloseTo(0.8, 5);
    expect(bus.getCircuitBrightness('hallLamps5A')).toBeCloseTo(1.0, 5);

    // Explicit zone scene recall (Evening: 40%, 50%, 100%)
    adapter.recallZoneScene('hall', 1);
    expect(bus.getCircuitBrightness('hallPendant')).toBeCloseTo(0.4, 5);
    expect(bus.getCircuitBrightness('hallStairLeds')).toBeCloseTo(0.5, 5);
    expect(bus.getCircuitBrightness('hallLamps5A')).toBeCloseTo(1.0, 5);

    // Zone night, full, and off
    adapter.enterZoneNight('hall');
    expect(bus.getCircuitBrightness('hallPendant')).toBe(0);
    expect(bus.getCircuitBrightness('hallStairLeds')).toBeCloseTo(0.1, 5);
    expect(bus.getPlateGangIndicator('1.1.17', 1)).toBe(true);

    adapter.setZoneFull('hall');
    expect(bus.getCircuitBrightness('hallPendant')).toBe(1);
    expect(bus.getCircuitBrightness('hallStairLeds')).toBe(1);

    adapter.setZoneOff('hall');
    expect(bus.getCircuitBrightness('hallPendant')).toBe(0);
    expect(bus.getCircuitBrightness('hallStairLeds')).toBe(0);
    expect(bus.getPlateGangIndicator('1.1.17', 1)).toBe(false);

    // Central scene recall + masterFull + masterOff
    adapter.recallCentralScene(0);
    expect(bus.getCircuitBrightness('islandPendants')).toBeCloseTo(0.85, 5);
    expect(bus.getCircuitBrightness('spotlights')).toBeCloseTo(1.0, 5);
    expect(bus.getPlateGangIndicator('1.1.17', 2)).toBe(true);

    adapter.masterFull();
    expect(bus.getCircuitBrightness('islandPendants')).toBe(1);
    expect(bus.getCircuitBrightness('spotlights')).toBe(1);

    adapter.masterOff();
    expect(bus.getCircuitBrightness('islandPendants')).toBeCloseTo(0.06, 5);
    expect(bus.getCircuitBrightness('spotlights')).toBe(0);

    adapter.dispose();
  });

  it('forwards PIR occupancy and room motion sensors, and mirrors soft-dimming via step(dt)', () => {
    const knx = new KNXPropertyBusController(makeTestProject());
    const adapter = new KnxElectricalAdapter(knx);
    const { bus } = adapter;

    // Room motion sensor (Wine Cellar PIR)
    expect(bus.getCircuitBrightness('wineCellarLeds')).toBe(1);
    adapter.triggerRoomMotion('wineCellar', false);
    expect(bus.getCircuitBrightness('wineCellarLeds')).toBe(0);
    adapter.triggerRoomMotion('wineCellar', true);
    expect(bus.getCircuitBrightness('wineCellarLeds')).toBe(1);

    // Zone PIR occupancy wake-to-night when dark + hold timeout via step(dt)
    knx.setAmbientLux(10, false);
    expect(knx.getZoneState('hall').mode).toBe('off');
    adapter.setPresence('1.1.61', true, 5);
    expect(knx.getPresenceState('1.1.61').detected).toBe(true);
    expect(knx.getZoneState('hall').mode).toBe('night');
    expect(bus.getCircuitBrightness('hallStairLeds')).toBeCloseTo(0.1, 5);

    // Step past 30s hold time without further presence -> Hall turns off & syncs to CircuitBus
    adapter.step(15);
    expect(knx.getZoneState('hall').mode).toBe('night');
    adapter.step(20);
    expect(knx.getZoneState('hall').mode).toBe('off');
    expect(bus.getCircuitBrightness('hallStairLeds')).toBe(0);

    // Soft-dimming mirror: recall Bright on Hall, then step live levels
    knx.setZoneFull('hall');
    // Immediately after setZoneFull, target is 100% while KNX liveLevels ramp from 0 -> 100
    expect(knx.hasPendingAnimations()).toBe(true);
    adapter.step(0.1);
    const midLive = bus.getCircuitBrightness('hallPendant');
    expect(midLive).toBeGreaterThan(0);
    expect(midLive).toBeLessThanOrEqual(1);
    for (let i = 0; i < 40; i++) {
      adapter.step(0.05);
    }
    expect(bus.getCircuitBrightness('hallPendant')).toBe(1);

    adapter.dispose();
  });

  it('processes inbound group/physical address frames and maintains loop-free bidirectional sync', () => {
    const knx = new KNXPropertyBusController(makeTestProject());
    const adapter = new KnxElectricalAdapter(knx);
    const { bus } = adapter;

    let knxEventCount = 0;
    let busEventCount = 0;
    knx.subscribe((e) => {
      if (e.type === 'stateChange') knxEventCount++;
    });
    bus.subscribe(() => {
      busEventCount++;
    });

    // Inbound DPT 5.001 scaling frame to hallPendant gaValue (1/2/1) -> ~60% (0.60)
    const hexValueFrame = buildTP1FrameHex('1.1.1', '1/2/1', true, encodeDpt5Scaling(60));
    adapter.injectInboundFrame(hexValueFrame);
    expect(bus.getCircuitBrightness('hallPendant')).toBeCloseTo(0.6, 2);

    // Inbound DPT 1.001 switch frame to hallLamps5A gaSwitch (1/1/3) -> ON (1.0)
    adapter.injectInboundFrame({
      src: '1.1.1',
      dst: '1/1/3',
      isGroup: true,
      payloadBytes: encodeDpt1(true),
    });
    expect(bus.getCircuitBrightness('hallLamps5A')).toBe(1);

    // Inbound physical-address P2P management frame (isGroup: false) does not corrupt circuit levels
    const p2pHex = buildTP1FrameHex('1.1.1', '1.1.20', false, [0x00, 0x80]);
    adapter.injectInboundFrame(p2pHex);
    expect(bus.getCircuitBrightness('hallPendant')).toBeCloseTo(0.6, 2);

    // Direct CircuitBus mutation writes back to KNX with zero feedback loops
    knxEventCount = 0;
    busEventCount = 0;
    bus.setCircuitBrightness('islandPendants', 0.72);
    expect(knx.getTargetLevels().islandPendants).toBe(72);
    expect(bus.getCircuitBrightness('islandPendants')).toBeCloseTo(0.72, 5);
    expect(knxEventCount).toBe(1);
    expect(busEventCount).toBeLessThanOrEqual(2);

    // Direct KNX setCircuitLevel mirrors onto CircuitBus with zero write-back loops
    knxEventCount = 0;
    busEventCount = 0;
    knx.setCircuitLevel('spotlights', 35);
    expect(bus.getCircuitBrightness('spotlights')).toBeCloseTo(0.35, 5);
    expect(knxEventCount).toBe(1);
    expect(busEventCount).toBeLessThanOrEqual(2);

    adapter.dispose();
  });
});
