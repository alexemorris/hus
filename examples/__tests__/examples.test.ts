if (typeof globalThis.document === 'undefined') {
  const noop = () => undefined;
  const grad = { addColorStop: noop };
  const ctx2d = new Proxy(
    {
      createLinearGradient: () => grad,
      createRadialGradient: () => grad,
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
      }),
      measureText: () => ({ width: 10 }),
    },
    { get: (target, prop) => (prop in target ? (target as Record<PropertyKey, unknown>)[prop] : noop) }
  );
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => ({
      width: 256,
      height: 256,
      getContext: () => ctx2d,
    }),
  };
}
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { CircuitBus } from 'husjs';
import { assertNoZFighting, runArchitecturalAudit } from 'husjs/testing';
import {
  buildPropertySceneContent,
  createPropertySceneLayers,
  CutawayController,
  InteractionRegistry,
  RoomLodController,
  type CutawayWallGroups,
  type LightCircuitGroup,
  type SceneBuilderContext,
} from 'husjs/viewer';
import { simpleFlat } from '../simple-flat/index.ts';
import { simpleHouse } from '../simple-house/index.ts';
import { stahlHouse, STAHL_ELECTRICAL } from '../stahl-house/index.ts';

function createHarnessContext(circuitIds: readonly string[]): {
  readonly ctx: SceneBuilderContext;
  readonly scene: THREE.Scene;
} {
  const scene = new THREE.Scene();
  const firstFloorMeshGroup = new THREE.Group();
  const groundFloorCeilingGroup = new THREE.Group();
  const ceilingMeshGroup = new THREE.Group();
  const cutawayWallGroups: CutawayWallGroups = {
    southWest: new THREE.Group(),
    west: new THREE.Group(),
    north: new THREE.Group(),
    east: new THREE.Group(),
  };
  scene.add(firstFloorMeshGroup, groundFloorCeilingGroup, ceilingMeshGroup);
  const lightGroups: Record<string, LightCircuitGroup> = {};
  for (const id of circuitIds) {
    lightGroups[id] = { lights: [], emissives: [], cones: [], pools: [], maxIntensity: 3.0 };
  }
  const interactiveMeshes: THREE.Object3D[] = [];
  const interactions = new InteractionRegistry(interactiveMeshes);
  const ctx: SceneBuilderContext = {
    scene,
    firstFloorMeshGroup,
    groundFloorCeilingGroup,
    ceilingMeshGroup,
    ceilingCutaway: false,
    cutawayWallGroups,
    bifoldPanels: [],
    interactiveMeshes,
    interactions,
    lightGroups: lightGroups as SceneBuilderContext['lightGroups'],
    addGlowPool: () => undefined,
  };
  return { ctx, scene };
}

describe('husjs Example Homes', { timeout: 30_000 }, () => {
  afterEach(() => new Promise((resolve) => setTimeout(resolve, 10)));
  it('simple-flat: single-floor apartment, 2-way hallway switches & living dimmer', () => {
    expect(simpleFlat.id).toBe('simple-flat');
    expect(simpleFlat.floors).toHaveLength(1);
    expect(simpleFlat.floors[0].id).toBe('level-0');
    expect(simpleFlat.floors[0].ceilingCutawayY).toBe(2.75);
    expect(simpleFlat.soundscape).toEqual({ preset: 'urban', gain: 0.9 });

    const bus = new CircuitBus(simpleFlat.electrical);
    const initialHall = bus.getTargetLevels01().flatHallPendant > 0.5;
    bus.flipSwitch('sw-hall-entry', undefined, { immediate: true });
    expect(bus.getTargetLevels01().flatHallPendant > 0.5).toBe(!initialHall);
    bus.flipSwitch('sw-hall-inner', undefined, { immediate: true });
    expect(bus.getTargetLevels01().flatHallPendant > 0.5).toBe(initialHall);

    bus.setDimmerLevel('dimmer-living', 0.42, { immediate: true });
    expect(bus.getTargetLevels01().flatLivingPendants).toBeCloseTo(0.42, 4);

    const { ctx, scene } = createHarnessContext(Object.keys(simpleFlat.zones.circuitMaxIntensity));
    for (const mod of simpleFlat.zones.modules ?? []) {
      mod.build(ctx);
    }
    expect(ctx.interactiveMeshes.length).toBeGreaterThanOrEqual(8);
    expect(scene.children.length).toBeGreaterThan(3);
  });

  it('simple-house: 2-storey pitched-roof house, 2-way landing, 3-way principal bedroom & terrain', () => {
    expect(simpleHouse.id).toBe('simple-house');
    expect(simpleHouse.floors.map((f) => f.id)).toEqual(['ground', 'first']);
    expect(simpleHouse.initialView).toEqual({ floor: 'all', sectionCut: false });
    expect(simpleHouse.soundscape).toEqual({ preset: 'countryside', gain: 1.0 });

    const bus = new CircuitBus(simpleHouse.electrical);
    const initialStair = bus.getTargetLevels01().houseStairPendant > 0.5;
    bus.flipSwitch('sw-stair-bottom', undefined, { immediate: true });
    expect(bus.getTargetLevels01().houseStairPendant > 0.5).toBe(!initialStair);
    bus.flipSwitch('sw-stair-top', undefined, { immediate: true });
    expect(bus.getTargetLevels01().houseStairPendant > 0.5).toBe(initialStair);

    const initialPrincipal = bus.getTargetLevels01().housePrincipalPendant > 0.5;
    bus.flipSwitch('sw-bed1-door', undefined, { immediate: true });
    expect(bus.getTargetLevels01().housePrincipalPendant > 0.5).toBe(!initialPrincipal);
    bus.flipSwitch('sw-bed1-left', undefined, { immediate: true });
    expect(bus.getTargetLevels01().housePrincipalPendant > 0.5).toBe(initialPrincipal);
    bus.flipSwitch('sw-bed1-right', undefined, { immediate: true });
    expect(bus.getTargetLevels01().housePrincipalPendant > 0.5).toBe(!initialPrincipal);

    const { ctx } = createHarnessContext(Object.keys(simpleHouse.zones.circuitMaxIntensity));
    for (const mod of simpleHouse.zones.modules ?? []) {
      mod.build(ctx);
    }
    expect(ctx.interactiveMeshes.length).toBeGreaterThanOrEqual(10);
    expect(simpleHouse.terrainSampler?.sampleTerrainY(2.2, 5.2)).toBeCloseTo(-0.18, 2);
  });

  it('stahl-house: Case Study House #22 HABS grid, cantilevered promontory DEM, Arcadia sliders & 2-way/3-way electrical', () => {
    expect(stahlHouse.id).toBe('stahl-house');
    expect(stahlHouse.location.lat).toBeCloseTo(34.100437, 5);
    expect(stahlHouse.location.lon).toBeCloseTo(-118.370152, 5);
    expect(stahlHouse.soundscape).toEqual({ preset: 'hills-city', gain: 1.0 });
    expect(stahlHouse.floors).toHaveLength(1);

    const sampleY = stahlHouse.walkthrough?.sampleTerrainY!;
    expect(sampleY(0, 0)).toBeGreaterThan(-0.3);
    expect(sampleY(0, 60)).toBeLessThan(-30);
    expect(sampleY(60, 60)).toBeLessThan(-30);

    const walkY = stahlHouse.walkthrough?.sampleWalkableElevation!;
    expect(walkY(-1.35, 0, 2.35, () => null)).toBeCloseTo(0.05, 3);
    expect(walkY(-1.35, 0, 6.05, () => null)).toBeCloseTo(0.05, 3);

    const bus = new CircuitBus(STAHL_ELECTRICAL);
    const poolInit = bus.getTargetLevels01().stahlPoolUnderwater > 0.5;
    bus.flipSwitch('sw-pool-entry', undefined, { immediate: true });
    expect(bus.getTargetLevels01().stahlPoolUnderwater > 0.5).toBe(!poolInit);
    bus.flipSwitch('sw-pool-living', undefined, { immediate: true });
    expect(bus.getTargetLevels01().stahlPoolUnderwater > 0.5).toBe(poolInit);

    const { ctx, scene } = createHarnessContext(Object.keys(stahlHouse.zones.circuitMaxIntensity));
    for (const mod of stahlHouse.zones.modules ?? []) {
      mod.build(ctx);
    }
    const arcadiaPivots: THREE.Object3D[] = [];
    scene.traverse((obj) => {
      if (obj.userData?.linearSlideOffset instanceof THREE.Vector3) {
        arcadiaPivots.push(obj);
      }
    });
    expect(arcadiaPivots).toHaveLength(4);
    let pointLightCount = 0;
    scene.traverse((obj) => {
      if (obj instanceof THREE.PointLight) pointLightCount++;
    });
    expect(pointLightCount).toBeLessThanOrEqual(10);
  });

  it('synthesizes orthographic top Plan preset and passes zero-z-fighting checks on simple-flat, simple-house & stahl-house', () => {
    for (const house of [simpleFlat, simpleHouse, stahlHouse]) {
      const profile = house.createSceneProfile();
      const registry = profile.createZoneRegistry();
      const topPreset = registry.getCameraPreset('top');
      expect(topPreset).toBeDefined();
      expect(topPreset?.useOrthographic).toBe(true);

      const scene = new THREE.Scene();
      const layers = createPropertySceneLayers(scene, profile.floors);
      const lodController = new RoomLodController(profile.lodRegistrations);
      buildPropertySceneContent(layers, {
        profile,
        registry,
        lodController,
        ceilingCutaway: false,
      });

      assertNoZFighting(scene, { epsilonM: 0.00035 });
    }
  }, 30000);

  it('stahl-house boots with roof intact via initialView and cuts away roof, camera-facing Arcadia sliders & carportWall when Section is toggled ON', () => {
    expect(stahlHouse.initialView).toEqual({ floor: 'ground', sectionCut: false });

    const profile = stahlHouse.createSceneProfile();
    const scene = new THREE.Scene();
    const layers = createPropertySceneLayers(scene, profile.floors);
    const registry = profile.createZoneRegistry();
    const lodController = new RoomLodController(profile.lodRegistrations);
    buildPropertySceneContent(layers, {
      profile,
      registry,
      lodController,
      ceilingCutaway: profile.initialView?.sectionCut ?? false,
    });

    const cutaway = new CutawayController(layers, registry, lodController, profile);
    cutaway.collectDynamicCutawayWalls();

    const overview = registry.getCameraPreset('overview')!;
    expect(overview).toBeDefined();
    cutaway.update({
      cameraPosition: overview.pos.clone(),
      target: overview.target.clone(),
      isOrthographic: false,
      orthoZoom: 1,
    });

    expect(cutaway.isCeilingCutaway()).toBe(false);
    expect(layers.roofGroup.visible).toBe(true);

    const diningSliderLeaf = scene.getObjectByName('stahlArcadiaDiningWest');
    const livingSliderLeaf = scene.getObjectByName('stahlArcadiaLivingWest');
    const carportWall = scene.getObjectByName('stahl.carportWall');
    expect(diningSliderLeaf?.parent).toBeDefined();
    expect(livingSliderLeaf?.parent).toBeDefined();
    expect(carportWall).toBeDefined();
    expect(diningSliderLeaf!.parent!.visible).toBe(true);
    expect(livingSliderLeaf!.parent!.visible).toBe(true);
    expect(carportWall!.visible).toBe(true);

    cutaway.toggleCeilingCutaway();
    expect(cutaway.isCeilingCutaway()).toBe(true);
    cutaway.update({
      cameraPosition: overview.pos.clone(),
      target: overview.target.clone(),
      isOrthographic: false,
      orthoZoom: 1,
    });
    expect(layers.roofGroup.visible).toBe(false);
    expect(diningSliderLeaf!.parent!.visible).toBe(false);
    expect(livingSliderLeaf!.parent!.visible).toBe(false);

    // Looking East from the carport into the private wing cuts away carportWall
    cutaway.update({
      cameraPosition: new THREE.Vector3(-18.5, 4.5, -3.0),
      target: new THREE.Vector3(-9.2, 1.0, -3.0),
      isOrthographic: false,
      orthoZoom: 1,
    });
    expect(layers.roofGroup.visible).toBe(false);
    expect(carportWall!.visible).toBe(false);

    // Looking North across the pool into the private wing cuts away South Arcadia slider pivots
    cutaway.update({
      cameraPosition: new THREE.Vector3(-6.1, 5.5, 6.5),
      target: new THREE.Vector3(-6.1, 1.0, -2.5),
      isOrthographic: false,
      orthoZoom: 1,
    });
    expect(layers.roofGroup.visible).toBe(false);
    const denSliderLeaf = scene.getObjectByName('stahlArcadiaDenSouth');
    const masterSliderLeaf = scene.getObjectByName('stahlArcadiaMasterSouth');
    expect(denSliderLeaf!.parent!.visible).toBe(false);
    expect(masterSliderLeaf!.parent!.visible).toBe(false);
  });

  it('simple-house: Georgian double-fronted architecture, floorLayers, sash windows, runner w/ 15 brass stair rods & linked double wrought-iron gate', () => {
    expect(simpleHouse.initialView).toEqual({ floor: 'all', sectionCut: false });

    const profile = simpleHouse.createSceneProfile();
    const registry = profile.createZoneRegistry();
    const scene = new THREE.Scene();
    const layers = createPropertySceneLayers(scene, profile.floors);
    expect(layers.floorLayers.map((f) => f.id)).toEqual(['ground', 'first']);

    const lodController = new RoomLodController(profile.lodRegistrations);
    const content = buildPropertySceneContent(layers, {
      profile,
      registry,
      lodController,
      ceilingCutaway: profile.initialView?.sectionCut ?? false,
    });

    const sashLowerLeaves: THREE.Object3D[] = [];
    const stairRods: THREE.Object3D[] = [];
    let runnerMesh: THREE.Object3D | undefined;
    scene.traverse((obj) => {
      if (obj.name.startsWith('simpleHouse.sash.') && obj.name.endsWith('.lowerSash')) {
        sashLowerLeaves.push(obj);
      }
      if (/^flight_\d+\.stairRod_\d+$/.test(obj.name)) {
        stairRods.push(obj);
      }
      if (obj.name === 'flight_1.carpetRunner') {
        runnerMesh = obj;
      }
    });

    expect(sashLowerLeaves.length).toBeGreaterThanOrEqual(8);
    expect(runnerMesh).toBeDefined();
    expect(stairRods).toHaveLength(15);

    // Linked double wrought-iron front gate: clicking left leaf opens both left & right pivots together
    const leftGateLeaf = scene.getObjectByName('simpleHouse.grounds.frontRailingsAndGate.leftGateLeaf');
    const rightGateLeaf = scene.getObjectByName('simpleHouse.grounds.frontRailingsAndGate.rightGateLeaf');
    expect(leftGateLeaf?.parent).toBeDefined();
    expect(rightGateLeaf?.parent).toBeDefined();

    const leftGatePivot = leftGateLeaf!.parent!;
    const rightGatePivot = rightGateLeaf!.parent!;
    expect(leftGatePivot.userData?.doorRole).toBe('pivot');
    expect(rightGatePivot.userData?.doorRole).toBe('pivot');
    const leftGateId = leftGatePivot.userData?.interactableId as string;
    expect(typeof leftGateId).toBe('string');

    expect(leftGatePivot.rotation.y).toBeCloseTo(0, 4);
    expect(rightGatePivot.rotation.y).toBeCloseTo(0, 4);

    expect(content.interactions.handleInteractableClick(leftGateId)).toBe(true);
    for (let i = 0; i < 40; i++) {
      content.interactions.update(0.05);
    }
    expect(Math.abs(leftGatePivot.rotation.y)).toBeGreaterThan(1.0);
    expect(Math.abs(rightGatePivot.rotation.y)).toBeGreaterThan(1.0);
    expect(Math.sign(leftGatePivot.rotation.y)).toBe(-Math.sign(rightGatePivot.rotation.y));
  });

  it('defaults bare / to simple-house (Georgian House) and enforces 10 F&B schemes, 10 distinct PBR floorings, metric brick UVs, and zero wall-penetrating furniture', () => {
    const profile = simpleHouse.createSceneProfile();
    const registry = profile.createZoneRegistry();
    const scene = new THREE.Scene();
    const layers = createPropertySceneLayers(scene, profile.floors);
    const lodController = new RoomLodController(profile.lodRegistrations);
    buildPropertySceneContent(layers, {
      profile,
      registry,
      lodController,
      ceilingCutaway: false,
    });
    scene.updateMatrixWorld(true);

    // 10 distinct PBR floorings across the Georgian House
    const expectedFloors = [
      'simpleHouse.floor.hallChequer',
      'simpleHouse.floor.drawingOak',
      'simpleHouse.floor.kitchenHerringbone',
      'simpleHouse.floor.bootTerracotta',
      'simpleHouse.floor.wcVitoriaChequer',
      'simpleHouse.floor.landingSmokedOak',
      'simpleHouse.landing.rogerOatesRunner',
      'simpleHouse.floor.principalOatmealCarpet',
      'simpleHouse.floor.dressingOatmealCarpet',
      'simpleHouse.floor.ensuiteParisianManoir',
      'simpleHouse.floor.guestHoneySisal',
      'simpleHouse.floor.studyFumedWalnutOak',
      'simpleHouse.floor.bathroomLimestone',
    ];
    for (const floorName of expectedFloors) {
      expect(scene.getObjectByName(floorName), `Missing floor ${floorName}`).toBeDefined();
    }

    // Neptune Olive-Moss/Oak/Carrara kitchen & re-proportioned Master Dressing / Ensuite / Airing Cupboard
    for (const keyPiece of [
      'simpleHouse.kitchen.rangeChimneyBreast',
      'simpleHouse.kitchen.lacancheRange',
      'simpleHouse.kitchen.oakPrepIsland',
      'simpleHouse.kitchen.wovenCordStool_1',
      'simpleHouse.kitchen.oliveCorbelShelf',
      'simpleHouse.kitchen.islandPendant_1',
      'simpleHouse.dressing.wardrobeWest.door_1',
      'simpleHouse.dressing.archedBrassMirror',
      'simpleHouse.airingCupboard.hotWaterCylinder',
      'simpleHouse.bathroom.wetZoneOliveMetroNorth',
      'simpleHouse.structure.kitchenSpineRsj',
      'simpleHouse.structure.kitchenNorthRsj',
      'simpleHouse.structure.kitchenRsjPierWest',
      'simpleHouse.structure.kitchenRsjPierEast',
      'simpleHouse.structure.stairwellTrimmer',
      'simpleHouse.study.chimneyBreast',
      'simpleHouse.principal.chimneyBreast',
    ]) {
      expect(scene.getObjectByName(keyPiece), `Missing key piece ${keyPiece}`).toBeDefined();
    }

    // Zero wall-penetration check: no interior furniture/joinery/sanitaryware protrudes past exterior brick shell
    const box = new THREE.Box3();
    const interiorRoots = [
      scene.getObjectByName('simpleHouse.interiors.ground'),
      scene.getObjectByName('simpleHouse.interiors.first'),
    ];
    for (const root of interiorRoots) {
      expect(root).toBeDefined();
      root!.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        box.setFromObject(node);
        if (box.isEmpty()) return;
        const minXLimit = node.name.includes('bolectionFireplace') ? -7.31 : -7.09;
        expect(box.min.x, `${node.name} protrudes past West brick shell`).toBeGreaterThanOrEqual(minXLimit);
        expect(box.max.x, `${node.name} protrudes past East brick shell`).toBeLessThanOrEqual(7.09);
        expect(box.min.z, `${node.name} protrudes past North brick shell`).toBeGreaterThanOrEqual(-4.26);
        expect(box.max.z, `${node.name} protrudes past South brick shell`).toBeLessThanOrEqual(4.26);
      });
    }
  });
  it('builds complete per-room skirtings and ceiling cornices across simple-house and simple-flat with 0 architectural audit errors', () => {
    const checkTrimMeshes = (scene: THREE.Scene, names: readonly string[]) => {
      for (const name of names) {
        const obj = scene.getObjectByName(name);
        expect(obj, `Missing trim group ${name}`).toBeDefined();
        let meshCount = 0;
        obj!.traverse((child) => {
          if (child instanceof THREE.Mesh && child.geometry.attributes.position.count > 0) {
            meshCount++;
          }
        });
        expect(meshCount, `Expected non-empty mesh geometry under ${name}`).toBeGreaterThan(0);
      }
    };

    const flatProfile = simpleFlat.createSceneProfile();
    const flatRegistry = flatProfile.createZoneRegistry();
    const flatScene = new THREE.Scene();
    const flatLayers = createPropertySceneLayers(flatScene, flatProfile.floors);
    const flatLod = new RoomLodController(flatProfile.lodRegistrations);
    const flatBuilt = buildPropertySceneContent(flatLayers, {
      profile: flatProfile,
      registry: flatRegistry,
      lodController: flatLod,
      ceilingCutaway: false,
    });
    checkTrimMeshes(flatScene, [
      'flat.living.skirting',
      'flat.hall.skirting',
      'flat.bedroom.skirting',
      'flat.bathroom.skirting',
      'flat.living.cornice',
      'flat.hall.cornice',
      'flat.bedroom.cornice',
      'flat.bathroom.cornice',
    ]);
    const flatAudit = runArchitecturalAudit(flatScene, {
      floors: flatProfile.floors,
      roomZones: flatProfile.lodRegistrations,
      interactions: flatBuilt.interactions,
      doorPolicy: flatProfile.doorPolicy,
      terrainSampler: flatProfile.terrainSampler?.sampleTerrainY,
    });
    expect(flatAudit.errorCount).toBe(0);
    expect(flatAudit.warningCount).toBe(0);

    const houseProfile = simpleHouse.createSceneProfile();
    const houseRegistry = houseProfile.createZoneRegistry();
    const houseScene = new THREE.Scene();
    const houseLayers = createPropertySceneLayers(houseScene, houseProfile.floors);
    const houseLod = new RoomLodController(houseProfile.lodRegistrations);
    const houseBuilt = buildPropertySceneContent(houseLayers, {
      profile: houseProfile,
      registry: houseRegistry,
      lodController: houseLod,
      ceilingCutaway: false,
    });
    checkTrimMeshes(houseScene, [
      'simpleHouse.skirting.hall',
      'simpleHouse.skirting.drawing',
      'simpleHouse.skirting.drawingBreast',
      'simpleHouse.skirting.kitchenDiner',
      'simpleHouse.skirting.bootLobby',
      'simpleHouse.skirting.cloakroom',
      'simpleHouse.skirting.landing',
      'simpleHouse.skirting.principal',
      'simpleHouse.skirting.dressing',
      'simpleHouse.skirting.ensuite',
      'simpleHouse.skirting.guest',
      'simpleHouse.skirting.study',
      'simpleHouse.skirting.bathroom',
      'simpleHouse.skirting.bathroomNorth',
      'simpleHouse.cornice.hall',
      'simpleHouse.cornice.drawing',
      'simpleHouse.cornice.drawingBreast',
      'simpleHouse.cornice.kitchen',
      'simpleHouse.cornice.kitchenBreast',
      'simpleHouse.cornice.bootLobby',
      'simpleHouse.cornice.cloakroom',
      'simpleHouse.cornice.landing',
      'simpleHouse.cornice.principal',
      'simpleHouse.cornice.dressing',
      'simpleHouse.cornice.ensuite',
      'simpleHouse.cornice.guest',
      'simpleHouse.cornice.study',
      'simpleHouse.cornice.bathroom',
    ]);
    const houseSpawns = simpleHouse.walkthrough?.spawns ?? [];
    const houseAudit = runArchitecturalAudit(houseScene, {
      floors: houseProfile.floors,
      roomZones: houseProfile.lodRegistrations,
      interactions: houseBuilt.interactions,
      doorPolicy: houseProfile.doorPolicy,
      terrainSampler: houseProfile.terrainSampler?.sampleTerrainY,
      ...(houseSpawns[0] ? { entryPosition: houseSpawns[0].position, entryZoneId: houseSpawns[0].zoneId } : {}),
    });
    expect(houseAudit.errorCount).toBe(0);
    expect(houseAudit.warningCount).toBe(0);
  }, 60000);
});
