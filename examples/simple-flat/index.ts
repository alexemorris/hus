import { defineHouse, type HouseDefinition } from 'husjs';
import type { SceneBuilderContext, SceneZoneModule } from 'husjs/viewer';
import { buildSimpleFlatArchitecture } from './architecture.ts';
import {
  CIRCUIT_MAX_INTENSITY,
  FFL_Y,
  SIMPLE_FLAT_BUILDING_ID,
  SIMPLE_FLAT_CAMERAS,
  SIMPLE_FLAT_ELECTRICAL,
  SIMPLE_FLAT_FLOORS,
  SIMPLE_FLAT_MANIFEST,
  SIMPLE_FLAT_NAV_TREE,
  SIMPLE_FLAT_ROOM_ZONES,
} from './electrical-and-rooms.ts';
import {
  SIMPLE_FLAT_TERRAIN_CONFIG,
  simpleFlatTerrainSampler,
} from './grounds-and-openings.ts';
import { buildLivingKitchenAndHallInteriors } from './interiors-living-and-hall.ts';
import { buildBedroomAndBathroomInteriors } from './interiors-private.ts';

const SIMPLE_FLAT_MODULE: SceneZoneModule = {
  id: 'simple-flat-main',
  name: 'Pied-à-terre Apartment',
  buildingId: SIMPLE_FLAT_BUILDING_ID,
  floorId: 'level-0',
  zoneIds: Object.keys(SIMPLE_FLAT_ROOM_ZONES) as SceneZoneModule['zoneIds'],
  cameraPresets: Object.values(SIMPLE_FLAT_CAMERAS),
  build(ctx: SceneBuilderContext) {
    const shell = buildSimpleFlatArchitecture(ctx);
    buildLivingKitchenAndHallInteriors(ctx, shell);
    buildBedroomAndBathroomInteriors(ctx, shell);
    return {};
  },
};

export const simpleFlat: HouseDefinition = defineHouse({
  id: 'simple-flat',
  name: 'Pied-à-terre Apartment',
  location: {
    lat: 55.6761,
    lon: 12.5683,
    elevationM: 12,
    northOffsetDeg: 0,
    timezone: 'Europe/Copenhagen',
    label: 'Frederiksberg · Copenhagen',
  },
  floors: SIMPLE_FLAT_FLOORS,
  initialView: { floor: 'all', sectionCut: false },
  terrain: SIMPLE_FLAT_TERRAIN_CONFIG,
  soundscape: { preset: 'urban', gain: 0.9 },
  electrical: SIMPLE_FLAT_ELECTRICAL,
  rooms: {
    manifest: SIMPLE_FLAT_MANIFEST,
    navTree: SIMPLE_FLAT_NAV_TREE,
    roomZones: SIMPLE_FLAT_ROOM_ZONES,
  },
  zones: {
    modules: [SIMPLE_FLAT_MODULE],
    lodRegistrations: Object.values(SIMPLE_FLAT_ROOM_ZONES).map((r) => ({
      zoneId: r.id,
      shortName: r.shortName,
      floorId: r.floorId,
      bounds: r.bounds,
      isInterior: r.isInterior,
    })),
    circuitMaxIntensity: CIRCUIT_MAX_INTENSITY,
  },
  walkthrough: {
    spawns: [
      { id: 'entry-hall', label: 'Entrance Hall', zoneId: 'flatHall', position: [-1.35, FFL_Y, 2.55], yawDeg: 180 },
      { id: 'living-lounge', label: 'Living, Kitchen & Dining', zoneId: 'flatLivingKitchen', position: [1.45, FFL_Y, 1.9], yawDeg: -35 },
      { id: 'double-bedroom', label: 'Double Bedroom', zoneId: 'flatBedroom', position: [-1.45, FFL_Y, 0.3], yawDeg: 145 },
      { id: 'shower-bathroom', label: 'Shower Bathroom', zoneId: 'flatBathroom', position: [-2.65, FFL_Y, 1.85], yawDeg: -135 },
    ],
    sampleTerrainY: (x, z) => simpleFlatTerrainSampler.sampleTerrainY(x, z),
  },
  lenses: {
    enabledTrades: ['owner', 'architect', 'electrician'],
    defaultTrade: 'owner',
  },
});

export {
  SIMPLE_FLAT_CAMERAS,
  SIMPLE_FLAT_ELECTRICAL,
  SIMPLE_FLAT_FLOORS,
  SIMPLE_FLAT_ROOM_ZONES,
  SIMPLE_FLAT_TERRAIN_CONFIG,
  simpleFlatTerrainSampler,
};
export default simpleFlat;
