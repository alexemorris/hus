import { describe, expect, it } from 'vitest';
import {
  CircuitBus,
  ElectricalSystem,
  createElectricalSystem,
  defaultPlateGangSwitchId,
  wireDimmer,
  wireMultiWay,
  wireOneWay,
  wireThreeWay,
  wireTwoWay,
  type ElectricalBusEvent,
  type SwitchGangPose,
} from './index.ts';

describe('CircuitBus / ElectricalSystem — Conventional Mains Wiring', () => {
  it('supports 1-way SPST switches, multi-gang wall plates, and custom string IDs', () => {
    const bus = createElectricalSystem();
    expect(bus).toBeInstanceOf(CircuitBus);
    expect(bus).toBeInstanceOf(ElectricalSystem);

    const plate = bus.registerWallPlate({
      plateId: 'cottage-entry-plate',
      mountedInZoneId: 'cottage-porch',
      location: 'Front Door',
      gangs: [
        { gang: 1, id: 'sw-porch-lantern', label: 'Porch Lantern', initialPose: 'up' },
        { gang: 2, label: 'Hallway', initialPose: 'up' },
      ],
    });

    expect(plate.gangs).toHaveLength(2);
    expect(plate.gangs[0]?.switchId).toBe('sw-porch-lantern');
    expect(plate.gangs[1]?.switchId).toBe(defaultPlateGangSwitchId('cottage-entry-plate', 2));

    bus.registerCircuit({
      id: 'porch-lantern',
      name: 'Porch Lantern',
      zoneId: 'cottage-porch',
      wiring: wireOneWay('sw-porch-lantern'),
    });

    // UK/Corston default: 'up' = OFF (0), 'down' = ON (1)
    expect(bus.getSwitchPose('sw-porch-lantern')).toBe('up');
    expect(bus.getPlateGangPose('cottage-entry-plate', 1)).toBe('up');
    expect(bus.getCircuitBrightness('porch-lantern')).toBe(0);
    expect(bus.getPlateGangIndicator('cottage-entry-plate', 1)).toBe(false);

    const events: ElectricalBusEvent[] = [];
    const unsubscribe = bus.subscribe((e) => events.push(e));

    // Flip via (plateId, gang)
    bus.flipPlateGang('cottage-entry-plate', 1);
    expect(bus.getSwitchPose('sw-porch-lantern')).toBe('down');
    expect(bus.getCircuitBrightness('porch-lantern')).toBe(1);
    expect(bus.getLiveLevels01()['porch-lantern']).toBe(1);
    expect(bus.getLiveLevelsPct()['porch-lantern']).toBe(100);
    expect(bus.getTargetLevelsPct()['porch-lantern']).toBe(100);
    expect(bus.getPlateGangIndicator('cottage-entry-plate', 1)).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('switchChange');
    expect(events[0]?.changedCircuits).toEqual(['porch-lantern']);

    // Flip back via switchId
    bus.flipSwitch('sw-porch-lantern');
    expect(bus.getPlateGangPose('cottage-entry-plate', 1)).toBe('up');
    expect(bus.getCircuitBrightness('porch-lantern')).toBe(0);
    expect(bus.getLiveLevelsPct()['porch-lantern']).toBe(0);

    // Custom onPose: 'up'
    bus.registerSwitch({ id: 'us-toggle', initialPose: 'down' });
    bus.registerCircuit({
      id: 'garage-worklight',
      name: 'Garage Worklight',
      zoneId: 'garage',
      wiring: wireOneWay('us-toggle', { onPose: 'up' }),
    });
    expect(bus.getCircuitBrightness('garage-worklight')).toBe(0);
    bus.flipSwitch('us-toggle', 'up');
    expect(bus.getCircuitBrightness('garage-worklight')).toBe(1);

    unsubscribe();
    bus.flipSwitch('us-toggle', 'down');
    expect(events).toHaveLength(3);
  });

  it('models 2-way traveller/strapper pairs across all 4 pose combinations', () => {
    const bus = new CircuitBus({
      switches: [
        { id: 'stairs-bottom', initialPose: 'up' },
        { id: 'stairs-top', initialPose: 'up' },
      ],
      circuits: [
        {
          id: 'stairwell-pendant',
          name: 'Stairwell Pendant',
          zoneId: 'stairwell',
          wiring: wireTwoWay('stairs-bottom', 'stairs-top'),
        },
      ],
    });

    const combos: ReadonlyArray<readonly [SwitchGangPose, SwitchGangPose, number]> = [
      ['up', 'up', 0],
      ['down', 'up', 1],
      ['down', 'down', 0],
      ['up', 'down', 1],
    ];

    for (const [poseA, poseB, expected] of combos) {
      bus.flipSwitch('stairs-bottom', poseA);
      bus.flipSwitch('stairs-top', poseB);
      expect(bus.getCircuitBrightness('stairwell-pendant')).toBe(expected);
    }

    // Starting from ('up', 'down') => ON (1), flipping EITHER switch strictly inverts continuity
    expect(bus.getCircuitBrightness('stairwell-pendant')).toBe(1);
    bus.flipSwitch('stairs-bottom'); // -> ('down', 'down') => OFF
    expect(bus.getCircuitBrightness('stairwell-pendant')).toBe(0);
    bus.flipSwitch('stairs-top'); // -> ('down', 'up') => ON
    expect(bus.getCircuitBrightness('stairwell-pendant')).toBe(1);
    bus.flipSwitch('stairs-bottom'); // -> ('up', 'up') => OFF
    expect(bus.getCircuitBrightness('stairwell-pendant')).toBe(0);
  });

  it('models 3-way and 4-way intermediate DPDT crossover chains where flipping ANY switch inverts continuity', () => {
    const bus = new CircuitBus();

    // 3-way chain: 2 SPDT endpoints + 1 DPDT intermediate crossover switch
    bus.registerCircuit({
      id: 'landing-lights',
      name: 'Landing Lights',
      zoneId: 'landing',
      wiring: wireThreeWay('landing-east', 'landing-mid', 'landing-west'),
    });

    const threeWaySwitches = ['landing-east', 'landing-mid', 'landing-west'] as const;
    // All start 'up' => OFF
    expect(bus.getCircuitBrightness('landing-lights')).toBe(0);

    // Exhaustively check all 2^3 = 8 pose states and verify single-switch inversion from every state
    for (let mask = 0; mask < 8; mask++) {
      for (let i = 0; i < 3; i++) {
        bus.flipSwitch(threeWaySwitches[i]!, (mask & (1 << i)) !== 0 ? 'down' : 'up');
      }
      const popcount =
        ((mask & 1) !== 0 ? 1 : 0) + ((mask & 2) !== 0 ? 1 : 0) + ((mask & 4) !== 0 ? 1 : 0);
      const expected = popcount % 2 === 1 ? 1 : 0;
      expect(bus.getCircuitBrightness('landing-lights')).toBe(expected);

      // Flipping ANY single switch (endpoint or intermediate) must invert continuity
      for (const swId of threeWaySwitches) {
        bus.flipSwitch(swId);
        expect(bus.getCircuitBrightness('landing-lights')).toBe(1 - expected);
        bus.flipSwitch(swId);
        expect(bus.getCircuitBrightness('landing-lights')).toBe(expected);
      }
    }

    // 4-way chain: 2 SPDT endpoints + 2 DPDT intermediate crossover switches
    const fourWaySwitches = ['corridor-s1', 'corridor-x1', 'corridor-x2', 'corridor-s2'] as const;
    bus.registerCircuit({
      id: 'long-corridor',
      name: 'Long Corridor Downlights',
      zoneId: 'corridor',
      wiring: wireMultiWay(['corridor-s1', 'corridor-s2'], ['corridor-x1', 'corridor-x2']),
    });

    expect(bus.getCircuitBrightness('long-corridor')).toBe(0);

    // Walk down the corridor flipping each switch in sequence: 0 -> 1 -> 0 -> 1 -> 0
    let expected = 0;
    for (const swId of fourWaySwitches) {
      bus.flipSwitch(swId);
      expected = 1 - expected;
      expect(bus.getCircuitBrightness('long-corridor')).toBe(expected);
    }

    // Exhaustively check all 2^4 = 16 states for single-switch inversion
    for (let mask = 0; mask < 16; mask++) {
      let downCount = 0;
      for (let i = 0; i < 4; i++) {
        const down = (mask & (1 << i)) !== 0;
        if (down) downCount++;
        bus.flipSwitch(fourWaySwitches[i]!, down ? 'down' : 'up');
      }
      const stateContinuity = downCount % 2 === 1 ? 1 : 0;
      expect(bus.getCircuitBrightness('long-corridor')).toBe(stateContinuity);

      for (const swId of fourWaySwitches) {
        bus.flipSwitch(swId);
        expect(bus.getCircuitBrightness('long-corridor')).toBe(1 - stateContinuity);
        bus.flipSwitch(swId);
      }
    }
  });

  it('supports rotary / trailing-edge dimmers in series with multi-way switches, push-toggle, and smooth step(dt)', () => {
    const bus = new CircuitBus();

    // Instant dimmer in series with a 3-way switch chain
    bus.registerDimmer({
      id: 'dim-dining',
      initialLevel: 0.65,
      minLevel: 0.1,
    });
    bus.registerCircuit({
      id: 'dining-chandelier',
      name: 'Dining Chandelier',
      zoneId: 'dining',
      wiring: wireThreeWay(['din-door-a', 'din-door-b'], ['din-credenza']),
      dimmerId: 'dim-dining',
    });

    // Switch chain initially open -> brightness 0 despite dimmer at 0.65
    expect(bus.getCircuitBrightness('dining-chandelier')).toBe(0);

    // Close via intermediate switch -> brightness = 0.65
    bus.flipSwitch('din-credenza');
    expect(bus.getCircuitBrightness('dining-chandelier')).toBeCloseTo(0.65, 5);
    expect(bus.getLiveLevelsPct()['dining-chandelier']).toBeCloseTo(65, 3);

    // Adjust rotary dimmer level and clamp to minLevel
    bus.adjustDimmerLevel('dim-dining', -0.25);
    expect(bus.getCircuitBrightness('dining-chandelier')).toBeCloseTo(0.4, 5);
    bus.setDimmerLevel('dim-dining', 0.02);
    expect(bus.getCircuitBrightness('dining-chandelier')).toBeCloseTo(0.1, 5);

    // Push-off / push-on rotary toggle preserves rotary knob level
    bus.setDimmerLevel('dim-dining', 0.75);
    expect(bus.toggleDimmer('dim-dining')).toBe(false);
    expect(bus.getCircuitBrightness('dining-chandelier')).toBe(0);
    expect(bus.toggleDimmer('dim-dining')).toBe(true);
    expect(bus.getCircuitBrightness('dining-chandelier')).toBeCloseTo(0.75, 5);

    // Trailing-edge dimmer with smooth rampSpeedPerSec = 2.0 (full 0..1 stroke in 0.5s)
    bus.registerDimmer({
      id: 'dim-lounge',
      initialLevel: 0.8,
      enabled: false,
      rampSpeedPerSec: 2.0,
    });
    bus.registerCircuit({
      id: 'lounge-pendant',
      name: 'Lounge Pendant',
      zoneId: 'lounge',
      wiring: wireDimmer('dim-lounge'),
    });

    expect(bus.getCircuitBrightness('lounge-pendant')).toBe(0);
    bus.toggleDimmer('dim-lounge'); // enabled -> target = 0.8, live starts ramping from 0
    expect(bus.getCircuitTargetBrightness('lounge-pendant')).toBeCloseTo(0.8, 5);
    expect(bus.getCircuitBrightness('lounge-pendant')).toBe(0);
    expect(bus.hasPendingRamps()).toBe(true);

    // Guard negative / NaN dt
    expect(bus.step(-1)).toBe(false);
    expect(bus.step(Number.NaN)).toBe(false);

    // Step 0.2s -> advances by 0.4
    expect(bus.step(0.2)).toBe(true);
    expect(bus.getCircuitBrightness('lounge-pendant')).toBeCloseTo(0.4, 5);
    expect(bus.getLiveLevelsPct()['lounge-pendant']).toBeCloseTo(40, 3);
    expect(bus.getTargetLevelsPct()['lounge-pendant']).toBeCloseTo(80, 3);

    // Step another 0.25s -> clamps at target 0.8
    expect(bus.step(0.25)).toBe(true);
    expect(bus.getCircuitBrightness('lounge-pendant')).toBeCloseTo(0.8, 5);
    expect(bus.hasPendingRamps()).toBe(false);
    expect(bus.step(0.1)).toBe(false);
  });

  it('synchronizes physical switch poses when UI calls setCircuitBrightness or toggleCircuit, and supports room scenes', () => {
    const bus = new CircuitBus();
    bus.registerDimmer({ id: 'dim-bed', initialLevel: 1 });
    bus.registerCircuit({
      id: 'bed-pendant',
      name: 'Bedroom Pendant',
      zoneId: 'bedroom',
      wiring: wireTwoWay('bed-door', 'bed-headboard'),
      dimmerId: 'dim-bed',
    });
    bus.registerCircuit({
      id: 'bed-reading',
      name: 'Reading Lamps',
      zoneId: 'bedroom',
      wiring: wireOneWay('bed-lamp-sw'),
      dimmable: false,
    });
    bus.registerCircuit({
      id: 'bed-cove',
      name: 'Cove Strip',
      zoneId: 'bedroom',
    });

    bus.registerZone({
      id: 'bedroom',
      name: 'Principal Bedroom',
      scenes: [
        {
          id: 'relax',
          label: 'Relax',
          levels: { 'bed-pendant': 0.35, 'bed-reading': 1, 'bed-cove': 0.5 },
        },
      ],
    });

    // Initially all OFF, switches 'up'
    expect(bus.isRoomOn('bedroom')).toBe(false);
    expect(bus.getSwitchPose('bed-door')).toBe('up');
    expect(bus.getSwitchPose('bed-headboard')).toBe('up');

    // UI sets 'bed-pendant' to 0.45 -> primary switch 'bed-door' flips 'down' & dimmer becomes 0.45
    bus.setCircuitBrightness('bed-pendant', 0.45);
    expect(bus.getSwitchPose('bed-door')).toBe('down');
    expect(bus.getCircuitBrightness('bed-pendant')).toBeCloseTo(0.45, 5);
    expect(bus.getDimmer('dim-bed')?.level).toBeCloseTo(0.45, 5);

    // Physical switch at headboard flips -> turns OFF ('down', 'down')
    bus.flipSwitch('bed-headboard');
    expect(bus.getCircuitBrightness('bed-pendant')).toBe(0);

    // UI toggleCircuit turns it back ON -> flips primary switch 'bed-door' back to 'up' so ('up', 'down') is closed!
    bus.toggleCircuit('bed-pendant');
    expect(bus.getSwitchPose('bed-door')).toBe('up');
    expect(bus.getSwitchPose('bed-headboard')).toBe('down');
    expect(bus.getCircuitBrightness('bed-pendant')).toBeCloseTo(0.45, 5);

    // UI toggleCircuit turns it OFF -> flips primary switch 'bed-door' to 'down' so ('down', 'down') is open!
    bus.toggleCircuit('bed-pendant');
    expect(bus.getCircuitBrightness('bed-pendant')).toBe(0);

    // Room helpers & scene recall
    expect(bus.getZones().map((z) => z.id)).toContain('bedroom');
    expect(bus.getRoomCircuits('bedroom')).toHaveLength(3);

    expect(bus.recallRoomScene('bedroom', 'relax')).toBe(true);
    expect(bus.isRoomOn('bedroom')).toBe(true);
    expect(bus.getCircuitBrightness('bed-pendant')).toBeCloseTo(0.35, 5);
    expect(bus.getCircuitBrightness('bed-reading')).toBe(1);
    expect(bus.getSwitchPose('bed-lamp-sw')).toBe('down');
    expect(bus.getCircuitBrightness('bed-cove')).toBeCloseTo(0.5, 5);

    bus.setRoomOff('bedroom');
    expect(bus.isRoomOn('bedroom')).toBe(false);
    expect(bus.getSwitchPose('bed-lamp-sw')).toBe('up');

    bus.setRoomFull('bedroom');
    expect(bus.getCircuitBrightness('bed-pendant')).toBe(1);
    expect(bus.getCircuitBrightness('bed-reading')).toBe(1);
    expect(bus.getCircuitBrightness('bed-cove')).toBe(1);

    // toggleRoom turns off when on, and recalls first scene when off
    expect(bus.toggleRoom('bedroom')).toBe(false);
    expect(bus.isRoomOn('bedroom')).toBe(false);
    expect(bus.toggleRoom('bedroom')).toBe(true);
    expect(bus.getCircuitBrightness('bed-pendant')).toBeCloseTo(0.35, 5);
  });
});
