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
    buildingId: 'mainHouse',
    floorId: 'ground',
    zoneId,
    actuatorPa: '1.1.20',
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
    buildingId: 'mainHouse',
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
    circuit('islandPendants', 'kitchen', 'Blue Island Pendants (Set 1)', 'Island Pendants', '3 Concrete Dome Pendants over Island'),
    circuit('spotlights', 'kitchen', 'Kitchen Ceiling Spotlights', 'Kitchen Spots', '10 Warm-Dim Downlights'),
    circuit('familyRoomSpots', 'familyRoom', 'Dining Room Recessed Downlights', 'Dining Spots', '6 Recessed Downlights'),
    circuit('studyPendant', 'study', 'Study & South Lobby Ceiling Pendant', 'Study Pendant', 'Brass Globe Pendant'),
    circuit(
      'barnTrussAndSimHalo',
      'outbuildingBarn',
      'Barn Truss Spotlights, Pool Light & Golf Sim LED Ring',
      'Barn & Sim Ring',
      'Oak Truss Spotlights + Pool Table Canopy',
      ['barn downlights', 'barn spots'],
    ),
    circuit('barnCoveLeds', 'outbuildingBarn', 'Barn Cove LEDs & Wall Sconces', 'Barn Cove', 'Eave cove strips'),
    circuit('golfSimHalo', 'outbuildingBarn', 'Golf Simulator LED Halo', 'Sim Halo', 'Inner LED halo ring around the golf sim'),
    circuit(
      'mezzanineSconcesAndAmbient',
      'outbuildingMezzanine',
      'Barn Mezzanine Wall Sconces & Ambient Downlights',
      'Mezz Sconces',
      '2 Pleated-Linen Wall Sconces',
    ),
    circuit('mezzanineLamps5A', 'outbuildingMezzanine', 'Barn Mezzanine 5V/5A Lamp Sockets (4 Lamps)', 'Mezz 5V Lamps', 'Corston 5A sockets'),
    circuit('mezzanineDownlights', 'outbuildingMezzanine', 'Barn Mezzanine Downlights', 'Mezz Downlights', 'Recessed downlights'),
    circuit('stableOfficeSpotlights', 'outbuildingStableOffice', 'Stable Office Recessed Spotlights', 'Office Spots', '6 spots'),
  ],
  zones: [
    zone('kitchen', 'Kitchen', ['islandPendants', 'spotlights'], [
      { id: 'cooking', label: 'Cooking', levels: {} },
      { id: 'dining', label: 'Dining', levels: {} },
    ]),
    zone('familyRoom', 'Dining Room', ['familyRoomSpots']),
    zone('study', 'Plant Room', ['studyPendant'], [], ['study']),
    zone('outbuildingBarn', 'Barn', ['barnTrussAndSimHalo', 'barnCoveLeds', 'golfSimHalo'], [
      { id: 'bright', label: 'Bright', levels: {} },
      { id: 'golf', label: 'Golf Sim', levels: {} },
      { id: 'evening', label: 'Evening Bar', levels: {} },
    ], ['games barn']),
    zone('outbuildingMezzanine', 'Mezzanine', ['mezzanineSconcesAndAmbient', 'mezzanineLamps5A', 'mezzanineDownlights']),
    zone('outbuildingStableOffice', 'Stable Office', ['stableOfficeSpotlights']),
  ],
  rooms: [
    room('kitchen', 'Kitchen', 'Kitchen'),
    room('familyRoom', 'Dining Room', 'Dining'),
    room('study', 'Plant Room', 'Plant'),
    room('outbuildingBarn', 'Games Barn', 'Barn'),
    room('outbuildingMezzanine', 'Barn Mezzanine', 'Mezzanine'),
    room('outbuildingStableOffice', 'Stable Office', 'Office'),
  ],
};

const resolver = createKnxNameResolver(PROJECT);

describe('tokeniseKnxName', () => {
  it('splits camelCase, singularises and drops socket ratings', () => {
    expect(tokeniseKnxName('mezzanineLamps5A')).toEqual(['mezzanine', 'lamp']);
    expect(tokeniseKnxName('Barn & Sim Ring')).toEqual(['barn', 'sim', 'ring']);
    expect(tokeniseKnxName('Island Pendants')).toEqual(['island', 'pendant']);
    expect(tokeniseKnxName('the kitchen spotlights')).toEqual(['kitchen', 'spot']);
  });
});

describe('resolveCircuit', () => {
  it.each<[string, CircuitId]>([
    ['barn downlights', 'barnTrussAndSimHalo'],
    ['mezzanine lamps', 'mezzanineLamps5A'],
    ['island pendants', 'islandPendants'],
    ['golf sim', 'golfSimHalo'],
    ['Island Pendants', 'islandPendants'],
    ['islandPendants', 'islandPendants'],
    ['mezzanine downlights', 'mezzanineDownlights'],
    ['kitchen spots', 'spotlights'],
    ['set the island pendants to 40%', 'islandPendants'],
  ])('%s → %s', (text, id) => {
    expect(resolver.resolveCircuit(text)?.id).toBe(id);
  });

  it('returns null for unrelated text or bare fitting words', () => {
    expect(resolver.resolveCircuit('what is the weather')).toBeNull();
    expect(resolver.resolveCircuit('lights')).toBeNull();
  });

  it('ranks multiple matches best first', () => {
    const ranked = resolver.rankCircuits('mezzanine');
    expect(ranked.length).toBeGreaterThan(1);
    expect(ranked.every((m) => m.id.startsWith('mezzanine'))).toBe(true);
  });
});

describe('resolveZone', () => {
  it.each<[string, RoomZoneId]>([
    ['office', 'outbuildingStableOffice'],
    ['plant room', 'study'],
    ['study', 'study'],
    ['dining room', 'familyRoom'],
    ['the kitchen', 'kitchen'],
    ['games barn', 'outbuildingBarn'],
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
    expect(resolver.resolveScene('outbuildingBarn', 'golf sim')).toMatchObject({ id: 'golf', index: 1 });
    expect(resolver.resolveScene('outbuildingBarn', 'evening')).toMatchObject({ id: 'evening', index: 2 });
    expect(resolver.resolveScene('outbuildingBarn', 'bright')).toMatchObject({ id: 'bright', index: 0 });
    expect(resolver.resolveScene('kitchen', '2')).toMatchObject({ id: 'dining', index: 1 });
    expect(resolver.resolveScene('kitchen', 'scene 1')).toMatchObject({ id: 'cooking', index: 0 });
  });

  it('returns null for zones without scenes or unmatched text', () => {
    expect(resolver.resolveScene('familyRoom', 'cooking')).toBeNull();
    expect(resolver.resolveScene('kitchen', 'disco')).toBeNull();
    expect(resolver.resolveScene('kitchen', '9')).toBeNull();
  });
});
