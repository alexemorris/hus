import * as THREE from 'three';
import {
  paintSpecFromSwatch,
  type BuildingId,
  type ElectricalSystemOptions,
  type RoomManifestEntry,
  type RoomZoneDefinition,
  type RoomZoneId,
  type FloorDefinition,
  type TwinRoomNavGroup,
} from 'husjs';
import type { CameraPresetDefinition } from 'husjs/viewer';

export const FFL_Y = 0.0;
export const WALL_H = 2.75;
export const IN_X = 4.2;
export const IN_Z = 3.4;
export const EXT_T = 0.24;
export const INT_T = 0.12;

export const SPINE_X = -0.6;
export const BED_BATH_Z = 1.1;
export const BATH_HALL_X = -2.2;

export const SIMPLE_FLAT_BUILDING_ID = 'mainHouse' as BuildingId;

export const SIMPLE_FLAT_FLOORS: readonly FloorDefinition[] = [
  {
    id: 'level-0',
    label: 'Apartment Floor',
    shortLabel: '0',
    order: 0,
    elevationY: FFL_Y,
    elevationM: FFL_Y,
    ceilingHeight: WALL_H,
    ceilingCutawayY: WALL_H,
  },
];

export const CIRCUIT_MAX_INTENSITY: Readonly<Record<string, number>> = {
  flatHallPendant: 2.2,
  flatEntryLantern: 1.4,
  flatLivingPendants: 2.8,
  flatKitchenTask: 1.6,
  flatBedroomPendant: 2.2,
  flatBathroomSpots: 2.0,
};

export const SIMPLE_FLAT_ELECTRICAL: ElectricalSystemOptions = {
  wallPlates: [
    {
      plateId: 'plate-hall-entry',
      name: 'Entrance Hall Switch',
      mountedInZoneId: 'flatHall',
      location: 'Entrance door jamb',
      gangs: [
        { gang: 1, id: 'sw-hall-entry', zoneId: 'flatHall', label: 'Hall 2-Way A', initialPose: 'down' },
        { gang: 2, id: 'sw-entry-lantern', zoneId: 'flatHall', label: 'Courtyard Coach Lantern', initialPose: 'down' },
      ],
    },
    {
      plateId: 'plate-hall-inner',
      name: 'Inner Hall Switch',
      mountedInZoneId: 'flatHall',
      location: 'Living/Bedroom junction',
      gangs: [{ gang: 1, id: 'sw-hall-inner', zoneId: 'flatHall', label: 'Hall 2-Way B', initialPose: 'up' }],
    },
    {
      plateId: 'plate-bedroom',
      name: 'Bedroom Door Switch',
      mountedInZoneId: 'flatBedroom',
      location: 'Bedroom latch jamb',
      gangs: [{ gang: 1, id: 'sw-bedroom', zoneId: 'flatBedroom', label: 'Bedroom 3-Way (Door)', initialPose: 'down' }],
    },
    {
      plateId: 'plate-bedroom-left',
      name: 'Bedroom Left Bedside Switch',
      mountedInZoneId: 'flatBedroom',
      location: 'North Chichester bedside',
      gangs: [{ gang: 1, id: 'sw-bedroom-left', zoneId: 'flatBedroom', label: 'Bedroom 3-Way (Left Bedside)', initialPose: 'up' }],
    },
    {
      plateId: 'plate-bedroom-right',
      name: 'Bedroom Right Bedside Switch',
      mountedInZoneId: 'flatBedroom',
      location: 'South Chichester bedside',
      gangs: [{ gang: 1, id: 'sw-bedroom-right', zoneId: 'flatBedroom', label: 'Bedroom 3-Way (Right Bedside)', initialPose: 'up' }],
    },
    {
      plateId: 'plate-bathroom',
      name: 'Shower Room Switch',
      mountedInZoneId: 'flatHall',
      location: 'Outside shower room jamb',
      gangs: [{ gang: 1, id: 'sw-bathroom', zoneId: 'flatBathroom', label: 'Shower Room Sconces', initialPose: 'down' }],
    },
    {
      plateId: 'plate-kitchen',
      name: 'Kitchen Task Switch',
      mountedInZoneId: 'flatLivingKitchen',
      location: 'Kitchen Zellige splashback',
      gangs: [{ gang: 1, id: 'sw-kitchen-task', zoneId: 'flatLivingKitchen', label: 'Corbel Shelf LED Strip', initialPose: 'down' }],
    },
  ],
  dimmers: [
    {
      id: 'dimmer-living',
      zoneId: 'flatLivingKitchen',
      label: 'Living & Dining Brass Rotary Dimmer',
      initialLevel: 0.78,
      minLevel: 0.08,
      enabled: true,
    },
  ],
  circuits: [
    {
      id: 'flatHallPendant',
      name: 'Hallway Glazed Brass Lantern (2-Way)',
      zoneId: 'flatHall',
      floorId: 'level-0',
      kind: 'pendants',
      dimmable: false,
      wiring: { kind: 'two-way', switches: ['sw-hall-entry', 'sw-hall-inner'] },
    },
    {
      id: 'flatEntryLantern',
      name: 'Courtyard Entrance Coach Lantern',
      zoneId: 'flatHall',
      floorId: 'level-0',
      kind: 'wallLights',
      dimmable: false,
      wiring: { kind: 'one-way', switchId: 'sw-entry-lantern' },
    },
    {
      id: 'flatLivingPendants',
      name: 'Living Chandelier & Dining Saucer Pendant',
      zoneId: 'flatLivingKitchen',
      floorId: 'level-0',
      kind: 'pendants',
      dimmable: true,
      wiring: { kind: 'dimmer', dimmerId: 'dimmer-living' },
    },
    {
      id: 'flatKitchenTask',
      name: 'Kitchen Corbel-Shelf Task Strip',
      zoneId: 'flatLivingKitchen',
      floorId: 'level-0',
      kind: 'task',
      dimmable: false,
      wiring: { kind: 'one-way', switchId: 'sw-kitchen-task' },
    },
    {
      id: 'flatBedroomPendant',
      name: 'Bedroom Fluted Pendant & Bedside Lamps (3-Way)',
      zoneId: 'flatBedroom',
      floorId: 'level-0',
      kind: 'pendants',
      dimmable: false,
      wiring: {
        kind: 'three-way',
        endpoints: ['sw-bedroom', 'sw-bedroom-right'],
        intermediates: ['sw-bedroom-left'],
      },
    },
    {
      id: 'flatBathroomSpots',
      name: 'Shower Room Fluted Vanity Sconces',
      zoneId: 'flatBathroom',
      floorId: 'level-0',
      kind: 'wallLights',
      dimmable: false,
      wiring: { kind: 'one-way', switchId: 'sw-bathroom' },
    },
  ],
  zones: [
    {
      id: 'flatLivingKitchen',
      name: 'Open-Plan Living, Kitchen & Dining',
      circuits: ['flatLivingPendants', 'flatKitchenTask'],
      scenes: [
        { id: 'bright', label: 'Bright', levels: { flatLivingPendants: 1.0, flatKitchenTask: 1.0 } },
        { id: 'evening', label: 'Evening', levels: { flatLivingPendants: 0.42, flatKitchenTask: 1.0 } },
      ],
    },
    {
      id: 'flatHall',
      name: 'Entrance Hall',
      circuits: ['flatHallPendant', 'flatEntryLantern'],
      scenes: [{ id: 'on', label: 'Welcome', levels: { flatHallPendant: 1.0, flatEntryLantern: 1.0 } }],
    },
    {
      id: 'flatBedroom',
      name: 'Double Bedroom',
      circuits: ['flatBedroomPendant'],
      scenes: [{ id: 'rest', label: 'Rest', levels: { flatBedroomPendant: 1.0 } }],
    },
    {
      id: 'flatBathroom',
      name: 'Shower Room',
      circuits: ['flatBathroomSpots'],
      scenes: [{ id: 'fresh', label: 'Fresh', levels: { flatBathroomSpots: 1.0 } }],
    },
  ],
};

export const SIMPLE_FLAT_ROOM_ZONES: Readonly<Record<string, RoomZoneDefinition>> = {
  flatLivingKitchen: {
    id: 'flatLivingKitchen' as RoomZoneId,
    name: 'Open-Plan Living, Kitchen & Dining',
    shortName: 'Living / Kitchen',
    buildingId: SIMPLE_FLAT_BUILDING_ID,
    floorId: 'level-0',
    knxAreaLine: '1.1',
    isInterior: true,
    bounds: { minX: SPINE_X, maxX: IN_X, minY: FFL_Y, maxY: WALL_H, minZ: -IN_Z, maxZ: IN_Z },
    floorSurface: 'wood',
    volumeM3: 88,
    primarySurface: 'timber',
  },
  flatHall: {
    id: 'flatHall' as RoomZoneId,
    name: 'Entrance Hall',
    shortName: 'Hall',
    buildingId: SIMPLE_FLAT_BUILDING_ID,
    floorId: 'level-0',
    knxAreaLine: '1.1',
    isInterior: true,
    bounds: { minX: BATH_HALL_X, maxX: SPINE_X, minY: FFL_Y, maxY: WALL_H, minZ: BED_BATH_Z, maxZ: IN_Z },
    floorSurface: 'wood',
    volumeM3: 18,
    primarySurface: 'plaster',
  },
  flatBedroom: {
    id: 'flatBedroom' as RoomZoneId,
    name: 'Double Bedroom',
    shortName: 'Bedroom',
    buildingId: SIMPLE_FLAT_BUILDING_ID,
    floorId: 'level-0',
    knxAreaLine: '1.1',
    isInterior: true,
    bounds: { minX: -IN_X, maxX: SPINE_X, minY: FFL_Y, maxY: WALL_H, minZ: -IN_Z, maxZ: BED_BATH_Z },
    floorSurface: 'wood',
    volumeM3: 44,
    primarySurface: 'carpet',
  },
  flatBathroom: {
    id: 'flatBathroom' as RoomZoneId,
    name: 'Shower Room',
    shortName: 'Bathroom',
    buildingId: SIMPLE_FLAT_BUILDING_ID,
    floorId: 'level-0',
    knxAreaLine: '1.1',
    isInterior: true,
    bounds: { minX: -IN_X, maxX: BATH_HALL_X, minY: FFL_Y, maxY: WALL_H, minZ: BED_BATH_Z, maxZ: IN_Z },
    floorSurface: 'stone',
    volumeM3: 13,
    primarySurface: 'tile',
  },
};

export const SIMPLE_FLAT_MANIFEST: readonly RoomManifestEntry[] = [
  {
    zoneId: 'flatLivingKitchen' as RoomZoneId,
    label: 'Living, Kitchen & Dining',
    group: 'apartment',
    floor: 'level-0',
    lights: [
      { circuitId: 'flatLivingPendants', label: 'Chandelier & Dining Pendant (Dimmer)', dimmable: true },
      { circuitId: 'flatKitchenTask', label: 'Corbel-Shelf 2700K Task Strip', dimmable: false },
    ],
    scenes: [],
    devices: [{ interactableId: 'flatBalconyDoor', label: 'Juliet Balcony French Door' }],
    finishes: {
      walls: paintSpecFromSwatch('school-house-white', 'estate-emulsion', 'Warm chalky off-white gallery walls'),
      ceiling: paintSpecFromSwatch('wimborne-white', 'dead-flat'),
      trim: paintSpecFromSwatch('wimborne-white', 'estate-eggshell'),
      flooring: 'Blonde European oak herringbone parquet with faded Ziegler Oushak area rug',
      joinery: 'Neptune Chichester in-frame Shaker kitchen in Farrow & Ball Pigeon No. 25 with honed Carrara worktops & Zellige splashback',
    },
  },
  {
    zoneId: 'flatHall' as RoomZoneId,
    label: 'Entrance Hall',
    group: 'apartment',
    floor: 'level-0',
    lights: [
      { circuitId: 'flatHallPendant', label: 'Glazed Brass Lantern (2-Way)', dimmable: false },
      { circuitId: 'flatEntryLantern', label: 'Courtyard Coach Lantern', dimmable: false },
    ],
    scenes: [],
    devices: [],
    finishes: {
      walls: paintSpecFromSwatch('slipper-satin', 'estate-emulsion', 'Soft limestone-chalk entrance hall plaster'),
      ceiling: paintSpecFromSwatch('wimborne-white', 'dead-flat'),
      trim: paintSpecFromSwatch('wimborne-white', 'estate-eggshell'),
      flooring: 'Blonde European oak herringbone parquet with Roger Oates flatweave runner',
      joinery: 'Wall-mounted Shaker peg rail & Character Oak console shelf',
    },
  },
  {
    zoneId: 'flatBedroom' as RoomZoneId,
    label: 'Double Bedroom',
    group: 'apartment',
    floor: 'level-0',
    lights: [{ circuitId: 'flatBedroomPendant', label: 'Fluted Pendant & Bedside Lamps (3-Way)', dimmable: false }],
    scenes: [],
    devices: [{ interactableId: 'flatBedroomDoor', label: 'Bedroom 4-Panel Door' }],
    finishes: {
      walls: paintSpecFromSwatch('skimming-stone', 'estate-emulsion', 'Warm stony plaster bedroom walls'),
      ceiling: paintSpecFromSwatch('wimborne-white', 'dead-flat'),
      trim: paintSpecFromSwatch('wimborne-white', 'estate-eggshell'),
      flooring: 'Wide-plank European oak boards with Cox & Cox woven pebble-wool rug',
      joinery: 'Full-height scribed Shaker double wardrobe in Farrow & Ball Shaded White No. 201',
    },
  },
  {
    zoneId: 'flatBathroom' as RoomZoneId,
    label: 'Shower Room',
    group: 'apartment',
    floor: 'level-0',
    lights: [{ circuitId: 'flatBathroomSpots', label: 'Fluted Vanity Sconces', dimmable: false }],
    scenes: [],
    devices: [{ interactableId: 'flatBathroomDoor', label: 'Shower Room 4-Panel Door' }],
    finishes: {
      walls: paintSpecFromSwatch('mizzle', 'modern-emulsion', 'Moisture-resistant soft grey-green upper plaster'),
      ceiling: paintSpecFromSwatch('wimborne-white', 'dead-flat'),
      trim: paintSpecFromSwatch('wimborne-white', 'estate-eggshell'),
      flooring: 'Parisian Manoir honed limestone & noir cabochon stone tiles',
      joinery: 'Neptune Chichester painted vanity with Carrara top & handmade olive glazed vertical metro wet-zone tiling',
    },
  },
];

export const SIMPLE_FLAT_NAV_TREE: readonly TwinRoomNavGroup[] = [
  { id: 'apartment', label: 'Pied-à-terre Apartment', rooms: SIMPLE_FLAT_MANIFEST },
];

export const SIMPLE_FLAT_CAMERAS: readonly CameraPresetDefinition[] = [
  {
    id: 'overview',
    label: 'Apartment Cutaway',
    buildingId: SIMPLE_FLAT_BUILDING_ID,
    floorViewMode: 'level-0',
    pos: new THREE.Vector3(7.4, 7.6, 8.6),
    target: new THREE.Vector3(0.1, 1.05, 0.0),
  },
  {
    id: 'livingRoom',
    label: 'Living, Kitchen & Dining',
    buildingId: SIMPLE_FLAT_BUILDING_ID,
    zoneId: 'flatLivingKitchen' as RoomZoneId,
    floorViewMode: 'level-0',
    pos: new THREE.Vector3(0.05, 1.62, 2.75),
    target: new THREE.Vector3(2.25, 1.12, -0.85),
  },
  {
    id: 'mainBedroom',
    label: 'Double Bedroom',
    buildingId: SIMPLE_FLAT_BUILDING_ID,
    zoneId: 'flatBedroom' as RoomZoneId,
    floorViewMode: 'level-0',
    pos: new THREE.Vector3(-1.05, 1.58, 0.72),
    target: new THREE.Vector3(-3.15, 0.95, -1.65),
  },
  {
    id: 'showerRoom',
    label: 'Shower Room',
    buildingId: SIMPLE_FLAT_BUILDING_ID,
    zoneId: 'flatBathroom' as RoomZoneId,
    floorViewMode: 'level-0',
    pos: new THREE.Vector3(-2.45, 1.58, 1.55),
    target: new THREE.Vector3(-3.65, 1.05, 2.75),
  },
  {
    id: 'entranceHall',
    label: 'Entrance Hall',
    buildingId: SIMPLE_FLAT_BUILDING_ID,
    zoneId: 'flatHall' as RoomZoneId,
    floorViewMode: 'level-0',
    pos: new THREE.Vector3(-1.35, 1.58, 1.45),
    target: new THREE.Vector3(-1.55, 1.15, 3.15),
  },
];
