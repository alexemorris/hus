/**
 * Stage 4.10b — `examples/simple-house`
 *
 * Double-Fronted Symmetrical Georgian Country House (5-bay Flemish-bond brick,
 * Bath-stone Tuscan portico, hipped Welsh-slate roof, Neptune Olive-Moss/Oak/Carrara
 * Chichester kitchen, Georgian bolection drawing room, galleried Roger Oates staircase,
 * Principal suite w/ Walk-In Dressing & Parisian Manoir Ensuite, Family Bathroom & Airing Cupboard).
 */

import { defineHouse, type HouseDefinition } from 'husjs';
import type { SceneBuilderContext, SceneZoneModule } from 'husjs/viewer';
import { buildSimpleHouseArchitecture } from './architecture.ts';
import {
  CIRCUIT_MAX_INTENSITY,
  FFL_FIRST,
  FFL_GROUND,
  SIMPLE_HOUSE_BUILDING_ID,
  SIMPLE_HOUSE_CAMERAS,
  SIMPLE_HOUSE_ELECTRICAL,
  SIMPLE_HOUSE_FLOORS,
  SIMPLE_HOUSE_MANIFEST,
  SIMPLE_HOUSE_NAV_TREE,
  SIMPLE_HOUSE_ROOM_ZONES,
} from './electrical-and-rooms.ts';
import {
  buildSimpleHouseGrounds,
  SIMPLE_HOUSE_TERRAIN_CONFIG,
  simpleHouseTerrainSampler,
} from './grounds.ts';
import { buildSimpleHouseFirstInteriors } from './interiors-first.ts';
import { buildSimpleHouseGroundInteriors } from './interiors-ground.ts';
import {
  buildSimpleHouseStaircaseAndHall,
  createSimpleHouseStair,
} from './staircase-and-hall.ts';

const sharedStair = createSimpleHouseStair();

const SIMPLE_HOUSE_MODULE: SceneZoneModule = {
  id: 'simple-house-main',
  name: 'Georgian Double-Fronted Country House',
  buildingId: SIMPLE_HOUSE_BUILDING_ID,
  floorId: 'ground',
  zoneIds: Object.keys(SIMPLE_HOUSE_ROOM_ZONES) as SceneZoneModule['zoneIds'],
  cameraPresets: Object.values(SIMPLE_HOUSE_CAMERAS),
  build(ctx: SceneBuilderContext) {
    buildSimpleHouseGrounds(ctx);
    const shell = buildSimpleHouseArchitecture(ctx, sharedStair);
    buildSimpleHouseStaircaseAndHall(ctx, sharedStair);
    buildSimpleHouseGroundInteriors(ctx, shell);
    buildSimpleHouseFirstInteriors(ctx, shell);
    return {};
  },
};

export const simpleHouse: HouseDefinition = defineHouse({
  id: 'simple-house',
  name: 'Georgian Double-Fronted Country House',
  location: {
    lat: 51.8412,
    lon: -1.7924,
    elevationM: 142,
    northOffsetDeg: -6,
    timezone: 'Europe/London',
    label: 'Cotswolds · Gloucestershire',
  },
  floors: SIMPLE_HOUSE_FLOORS,
  initialView: { floor: 'all', sectionCut: false },
  terrain: SIMPLE_HOUSE_TERRAIN_CONFIG,
  soundscape: { preset: 'countryside', gain: 1.0 },
  electrical: SIMPLE_HOUSE_ELECTRICAL,
  rooms: {
    manifest: SIMPLE_HOUSE_MANIFEST,
    navTree: SIMPLE_HOUSE_NAV_TREE,
    roomZones: SIMPLE_HOUSE_ROOM_ZONES,
  },
  zones: {
    modules: [SIMPLE_HOUSE_MODULE],
    lodRegistrations: Object.values(SIMPLE_HOUSE_ROOM_ZONES).map((r) => ({
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
      { id: 'front-hall', label: 'Marble Entrance Hall', zoneId: 'houseHall', position: [-0.45, FFL_GROUND, 3.1], yawDeg: 0 },
      { id: 'drawing-hearth', label: 'Georgian Drawing Room', zoneId: 'houseDrawing', position: [-2.2, FFL_GROUND, 1.9], yawDeg: 50 },
      { id: 'chichester-kitchen', label: 'Chichester Kitchen & Dining', zoneId: 'houseKitchenDiner', position: [2.15, FFL_GROUND, -0.85], yawDeg: -90 },
      { id: 'principal-bedroom', label: 'Principal Bedroom', zoneId: 'housePrincipalBed', position: [-2.35, FFL_FIRST, 1.4], yawDeg: 65 },
    ],
    sampleTerrainY: (x, z) => simpleHouseTerrainSampler.sampleTerrainY(x, z),
    classifyCollisionMesh: (mesh) => (mesh.userData?.isArchitecturalShell === true ? { noFurniture: true } : null),
  },
  lenses: {
    enabledTrades: ['owner', 'architect', 'electrician'],
    defaultTrade: 'owner',
  },
});

export {
  SIMPLE_HOUSE_CAMERAS,
  SIMPLE_HOUSE_ELECTRICAL,
  SIMPLE_HOUSE_FLOORS,
  SIMPLE_HOUSE_ROOM_ZONES,
  SIMPLE_HOUSE_TERRAIN_CONFIG,
  simpleHouseTerrainSampler,
};
export default simpleHouse;
