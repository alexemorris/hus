import * as THREE from 'three';
import { defineHouse, type HouseDefinition } from 'husjs';
import {
  PropertyScene,
  type CameraPresetDefinition,
  type SceneBuilderContext,
  type SceneZoneModule,
} from 'husjs/viewer';
import {
  STAHL_DOOR_POLICY,
  STAHL_ELECTRICAL,
  STAHL_FLOORS,
  STAHL_MANIFEST,
  STAHL_NAV_TREE,
  STAHL_ROOM_ZONES,
} from './electrical-and-rooms.ts';
import { buildStahlInteriors } from './interiors.ts';
import {
  buildStahlPoolAndGrounds,
  syncStahlCityLightsFromSky,
} from './pool-and-grounds.ts';
import { buildStahlStructure, createStahlMaterials } from './structure.ts';
import {
  POOL_MAX_X,
  POOL_MAX_Z,
  POOL_MIN_X,
  POOL_MIN_Z,
  STAHL_TERRAIN_CONFIG,
  stahlTerrainSampler,
} from './terrain.ts';

/**
 * `examples/stahl-house`
 * **Case Study House #22 (Stahl House)**, Pierre Koenig, FAIA (1959–1960), HABS CA-2702.
 * 1635 Woods Drive, Hollywood Hills, Los Angeles (`34.100437° N, 118.370152° W`, `240.2 m` ASL).
 */

const STAHL_CAMERA_PRESETS: readonly CameraPresetDefinition[] = [
  {
    id: 'overview',
    label: 'Shulman Cantilever Vista',
    buildingId: 'mainHouse',
    floorViewMode: 'all',
    // Classic Julius Shulman angle from West across the pool & stepping bridges through the 270° glass pavilion!
    pos: new THREE.Vector3(-8.8, 1.72, 6.6),
    target: new THREE.Vector3(4.6, 1.22, 8.2),
  },
  {
    id: 'pool',
    label: 'Pool Terrace & VKG Loungers',
    buildingId: 'mainHouse',
    zoneId: 'stahlPoolTerrace',
    floorViewMode: 'all',
    pos: new THREE.Vector3(-13.1, 1.78, 8.15),
    target: new THREE.Vector3(-1.2, 0.88, 3.85),
  },
  {
    id: 'livingRoom',
    label: '270° Cantilevered Living',
    buildingId: 'mainHouse',
    zoneId: 'stahlLivingDining',
    floorViewMode: 'ground',
    pos: new THREE.Vector3(1.1, 1.58, 4.9),
    target: new THREE.Vector3(4.8, 1.15, 10.6),
  },
  {
    id: 'shulmanView',
    label: 'SE Overlook & LA Grid',
    buildingId: 'mainHouse',
    zoneId: 'stahlLivingDining',
    floorViewMode: 'all',
    pos: new THREE.Vector3(-4.6, 2.05, 8.85),
    target: new THREE.Vector3(7.5, 0.55, 11.4),
  },
  {
    id: 'kitchen',
    label: 'Luminous Ceiling Kitchen',
    buildingId: 'mainHouse',
    zoneId: 'stahlKitchen',
    floorViewMode: 'ground',
    pos: new THREE.Vector3(1.6, 1.62, 1.2),
    target: new THREE.Vector3(3.2, 1.28, -4.4),
  },
  {
    id: 'carport',
    label: '1635 Woods Drive Carport',
    buildingId: 'mainHouse',
    zoneId: 'stahlCarport',
    floorViewMode: 'all',
    pos: new THREE.Vector3(-21.8, 1.68, -1.55),
    target: new THREE.Vector3(-13.4, 1.05, -3.95),
  },
  {
    id: 'courtyard',
    label: 'Promontory Aerial',
    buildingId: 'mainHouse',
    floorViewMode: 'all',
    pos: new THREE.Vector3(-18.5, 11.5, 19.5),
    target: new THREE.Vector3(-1.5, 1.0, 2.5),
  },
];

const STAHL_MODULE: SceneZoneModule = {
  id: 'stahl-house-csh22',
  name: 'Case Study House #22 (Stahl House)',
  buildingId: 'mainHouse',
  floorId: 'ground',
  zoneIds: Object.keys(STAHL_ROOM_ZONES),
  interiorBounds: Object.values(STAHL_ROOM_ZONES)
    .filter((z) => z.isInterior)
    .map((z) => z.bounds),
  cameraPresets: STAHL_CAMERA_PRESETS,
  build(ctx: SceneBuilderContext) {
    const root = new THREE.Group();
    root.name = 'stahlHouse.root';
    ctx.scene.add(root);

    const mats = createStahlMaterials();
    const cuts = buildStahlStructure(ctx, root, mats);
    buildStahlInteriors(ctx, root, mats, cuts);
    buildStahlPoolAndGrounds(ctx, root, mats);

    return {};
  },
};

export const stahlHouse: HouseDefinition = defineHouse({
  id: 'stahl-house',
  name: 'Case Study House #22 (Stahl House)',
  location: {
    lat: 34.100437,
    lon: -118.370152,
    elevationM: 240.2,
    northOffsetDeg: -0.93,
    timezone: 'America/Los_Angeles',
    label: 'Hollywood Hills · 1635 Woods Drive',
  },
  floors: STAHL_FLOORS,
  initialView: { floor: 'ground', sectionCut: false },
  terrain: STAHL_TERRAIN_CONFIG,
  environment: 'hollywood-hills',
  soundscape: { preset: 'hills-city', gain: 1.0 },
  electrical: STAHL_ELECTRICAL,
  rooms: {
    manifest: STAHL_MANIFEST,
    navTree: STAHL_NAV_TREE,
    roomZones: STAHL_ROOM_ZONES,
  },
  zones: {
    modules: [STAHL_MODULE],
    doorPolicy: STAHL_DOOR_POLICY,
    circuitMaxIntensity: {
      stahlKitchenLuminous: 3.0,
      stahlLivingCones: 3.2,
      stahlDiningPendant: 2.5,
      stahlPoolUnderwater: 3.6,
      stahlCantileverSoffit: 2.2,
      stahlMasterCones: 2.4,
      stahlDenCones: 2.4,
      stahlBathVanity: 2.0,
      stahlCarportGlobes: 2.4,
    },
  },
  walkthrough: {
    spawns: [
      { id: 'shulman-pool-deck', label: 'Pool Deck (Shulman Angle)', zoneId: 'stahlPoolTerrace', position: [-10.8, 0, 5.2], yawDeg: -80 },
      { id: 'cantilever-living', label: '270° Living Pavilion', zoneId: 'stahlLivingDining', position: [2.4, 0, 9.2], yawDeg: -135 },
      { id: 'carport-arrival', label: 'Woods Drive Carport', zoneId: 'stahlCarport', position: [-15.2, 0, -2.5], yawDeg: -95 },
    ],
    sampleTerrainY: (x, z) => stahlTerrainSampler.sampleTerrainY(x, z),
    sampleWalkableElevation(x, refFootY, z, getRoomMinYAt) {
      // Stepping bridge pads across the East pool inlets remain walkable at Y = 0.05 m!
      const onNorthBridge = x >= -2.1 && x <= -0.6 && z >= 1.68 && z <= 3.02;
      const onSouthBridge = x >= -2.1 && x <= -0.6 && z >= 5.38 && z <= 6.72;
      if (onNorthBridge || onSouthBridge) return 0.05;
      // Keep walker on pool floor if inside the carved pool basin
      if (x > POOL_MIN_X && x < POOL_MAX_X && z > POOL_MIN_Z && z < POOL_MAX_Z) {
        return -1.55;
      }
      const roomY = getRoomMinYAt(x, refFootY + 0.5, z);
      if (roomY !== null) return roomY;
      // Exterior catwalk along East (`X in [6.096..6.72]`) & South (`Z in [12.192..12.82]`) cliff edges!
      if ((x >= 6.0 && x <= 6.75 && z >= -6.15 && z <= 12.85) || (z >= 12.1 && z <= 12.85 && x >= -0.4 && x <= 6.75)) {
        return 0.0;
      }
      return stahlTerrainSampler.sampleTerrainY(x, z);
    },
  },
  lenses: {
    enabledTrades: ['owner', 'architect', 'electrician'],
    defaultTrade: 'owner',
  },
  createScene(canvas, onObjectInteraction, profile) {
    const scene = new PropertyScene(canvas, onObjectInteraction, profile);
    // Extend perspective & orthographic far clip plane to 4.8 km so the distant LA Basin
    // street-lights grid below the 240 m Hollywood Hills bluff renders all the way to the horizon.
    scene.camera.rig.perspCamera.far = 4800;
    scene.camera.rig.perspCamera.updateProjectionMatrix();
    scene.camera.rig.orthoCamera.far = 4800;
    scene.camera.rig.orthoCamera.updateProjectionMatrix();

    syncStahlCityLightsFromSky(scene.scene, scene.getSkyWeatherSnapshot());
    scene.onSkyWeatherChanged((snap) => {
      syncStahlCityLightsFromSky(scene.scene, snap);
    });
    return scene;
  },
});

export {
  STAHL_ELECTRICAL,
  STAHL_FLOORS,
  STAHL_ROOM_ZONES,
  STAHL_TERRAIN_CONFIG,
  stahlTerrainSampler,
  syncStahlCityLightsFromSky,
};
export default stahlHouse;
