import { describe, expect, it } from 'vitest';
import type { CircuitConfig, CircuitId, ZoneScenePreset } from '../../core/types/knx.ts';
import type { RoomZoneDefinition, RoomZoneId } from '../../core/types/topology.ts';
import { createKnxNameResolver, tokeniseKnxName, type KnxNameResolverProject } from './name-resolver.ts';
import type { KnxLightingZone } from './project.ts';

function circuit(
  id: CircuitId,
  zoneId: RoomZoneId,
  name: string,
  shortName: string,
  location: string,
  aliases?: readonly string[],
): CircuitConfig {
  return {
    id,
    channel: 1,
    name,
    shortName,
    location,
    buildingId: 'house',
    floorId: 'ground',
    zoneId,
    actuatorPa: '1.1.10',
    gaSwitch: '1/1/1',
    gaValue: '1/2/1',
    gaStatus: '1/3/1',
    isSceneMember: false,
    ...(aliases ? { aliases } : {}),
  };
}

function room(id: RoomZoneId, name: string, shortName: string): RoomZoneDefinition {
  return {
    id,
    name,
    shortName,
    buildingId: 'house',
    floorId: 'ground',
    knxAreaLine: '1.1',
    isInterior: true,
    bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1 },
  };
}

function zone(
  id: RoomZoneId,
  name: string,
  circuits: readonly CircuitId[],
  scenes: readonly ZoneScenePreset[] = [],
  aliases?: readonly string[],
): KnxLightingZone {
  return {
    id,
    name,
    circuits,
    scenes,
    nightLevels: {},
    ga: { scene: '0/0/1', sceneStatus: '0/0/2', night: '0/0/3', full: '0/0/4', status: '0/0/5', dim: '0/0/6' },
    ...(aliases ? { aliases } : {}),
  };
}

const PROJECT: KnxNameResolverProject = {
  circuits: [
    circuit('counterPendants', 'kitchen', 'Kitchen Counter Pendants', 'Counter Pendants', '3 Dome Pendants over Counter'),
    circuit('kitchenSpots', 'kitchen', 'Kitchen Ceiling Spotlights', 'Kitchen Spots', '10 Warm-Dim Downlights'),
    circuit('diningSpots', 'diningRoom', 'Dining Room Recessed Downlights', 'Dining Spots', '6 Recessed Downlights'),
    circuit('hallPendant', 'hallway', 'Entrance Hall Ceiling Pendant', 'Hall Pendant', 'Brass Globe Pendant'),
    circuit(
      'livingDownlights',
      'livingRoom',
      'Living Room Ceiling Spotlights',
      'Living Spots',
      'Recessed ceiling downlights',
      ['lounge downlights', 'lounge spots'],
    ),
    circuit('livingCoveLeds', 'livingRoom', 'Living Room Cove LEDs', 'Living Cove', 'Perimeter cove strips'),
    circuit('featureHalo', 'livingRoom', 'Ceiling Feature LED Halo', 'Feature Halo', 'Inner LED halo ring'),
    circuit('bedroomSconces', 'bedroom1', 'Primary Bedroom Wall Sconces', 'Bedroom Sconces', '2 Linen Wall Sconces'),
    circuit('bedroomLamps5A', 'bedroom1', 'Primary Bedroom 5A Lamp Sockets', 'Bedroom 5A Lamps', 'Switched 5A lamp sockets'),
    circuit('bedroomDownlights', 'bedroom1', 'Primary Bedroom Downlights', 'Bedroom Downlights', 'Recessed downlights'),
    circuit('officeSpotlights', 'homeOffice', 'Home Office Recessed Spotlights', 'Office Spots', '6 spots'),
  ],
  zones: [
    zone('kitchen', 'Kitchen', ['counterPendants', 'kitchenSpots'], [
      { id: 'cooking', label: 'Cooking', levels: {} },
      { id: 'dining', label: 'Dining', levels: {} },
    ]),
    zone('diningRoom', 'Dining Room', ['diningSpots']),
    zone('hallway', 'Entrance Hall', ['hallPendant'], [], ['foyer']),
    zone(
      'livingRoom',
      'Living Room',
      ['livingDownlights', 'livingCoveLeds', 'featureHalo'],
      [
        { id: 'bright', label: 'Bright', levels: {} },
        { id: 'cinema', label: 'Cinema', levels: {} },
        { id: 'evening', label: 'Evening Relax', levels: {} },
      ],
      ['lounge'],
    ),
    zone('bedroom1', 'Primary Bedroom', ['bedroomSconces', 'bedroomLamps5A', 'bedroomDownlights']),
    zone('homeOffice', 'Home Office', ['officeSpotlights']),
  ],
  rooms: [
    room('kitchen', 'Kitchen', 'Kitchen'),
    room('diningRoom', 'Dining Room', 'Dining'),
    room('hallway', 'Entrance Hall', 'Hall'),
    room('livingRoom', 'Living Room', 'Living'),
    room('bedroom1', 'Primary Bedroom', 'Bedroom'),
    room('homeOffice', 'Home Office', 'Office'),
  ],
};

const resolver = createKnxNameResolver(PROJECT);

describe('tokeniseKnxName', () => {
  it('splits camelCase, singularises and drops socket ratings', () => {
    expect(tokeniseKnxName('bedroomLamps5A')).toEqual(['bedroom', 'lamp']);
    expect(tokeniseKnxName('Feature & Halo Ring')).toEqual(['feature', 'halo', 'ring']);
    expect(tokeniseKnxName('Counter Pendants')).toEqual(['counter', 'pendant']);
    expect(tokeniseKnxName('the kitchen spotlights')).toEqual(['kitchen', 'spot']);
  });
});

describe('resolveCircuit', () => {
  it.each<[string, CircuitId]>([
    ['lounge downlights', 'livingDownlights'],
    ['bedroom lamps', 'bedroomLamps5A'],
    ['counter pendants', 'counterPendants'],
    ['feature halo', 'featureHalo'],
    ['Counter Pendants', 'counterPendants'],
    ['counterPendants', 'counterPendants'],
    ['bedroom downlights', 'bedroomDownlights'],
    ['kitchen spots', 'kitchenSpots'],
    ['set the counter pendants to 40%', 'counterPendants'],
  ])('%s → %s', (text, id) => {
    expect(resolver.resolveCircuit(text)?.id).toBe(id);
  });

  it('returns null for unrelated text or bare fitting words', () => {
    expect(resolver.resolveCircuit('what is the weather')).toBeNull();
    expect(resolver.resolveCircuit('lights')).toBeNull();
  });

  it('ranks multiple matches best first', () => {
    const ranked = resolver.rankCircuits('bedroom');
    expect(ranked.length).toBeGreaterThan(1);
    expect(ranked.every((m) => m.id.startsWith('bedroom'))).toBe(true);
  });
});

describe('resolveZone', () => {
  it.each<[string, RoomZoneId]>([
    ['office', 'homeOffice'],
    ['entrance hall', 'hallway'],
    ['foyer', 'hallway'],
    ['dining room', 'diningRoom'],
    ['the kitchen', 'kitchen'],
    ['lounge', 'livingRoom'],
    ['turn the kitchen lights off', 'kitchen'],
  ])('%s → %s', (text, id) => {
    expect(resolver.resolveZone(text)?.id).toBe(id);
  });

  it('returns null for unknown rooms', () => {
    expect(resolver.resolveZone('swimming pool')).toBeNull();
  });
});

describe('resolveScene', () => {
  it('matches by label, id and number', () => {
    expect(resolver.resolveScene('livingRoom', 'cinema')).toMatchObject({ id: 'cinema', index: 1 });
    expect(resolver.resolveScene('livingRoom', 'evening')).toMatchObject({ id: 'evening', index: 2 });
    expect(resolver.resolveScene('livingRoom', 'bright')).toMatchObject({ id: 'bright', index: 0 });
    expect(resolver.resolveScene('kitchen', '2')).toMatchObject({ id: 'dining', index: 1 });
    expect(resolver.resolveScene('kitchen', 'scene 1')).toMatchObject({ id: 'cooking', index: 0 });
  });

  it('returns null for zones without scenes or unmatched text', () => {
    expect(resolver.resolveScene('diningRoom', 'cooking')).toBeNull();
    expect(resolver.resolveScene('kitchen', 'disco')).toBeNull();
    expect(resolver.resolveScene('kitchen', '9')).toBeNull();
  });
});
