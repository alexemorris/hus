import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  RoomVariationController,
  VariationRegistry,
  createRoomVariationGroup,
} from './room-variation-controller.ts';
import { CutawayController } from '../cutaway/cutaway-controller.ts';
import { createPropertySceneLayers } from '../viewer/scene-content.ts';
import { SceneZoneRegistry } from '../viewer/scene-zone-registry.ts';
import type { LightGroupMap } from '../viewer/scene-types.ts';
import { RoomLodController } from '../lod/lod-manager.ts';
import { SceneBatchOptimizer } from '../rendering/scene-batch-optimizer.ts';
import { intersectVisibleObjects, isObjectVisibleInHierarchy } from '../util/object-utils.ts';
import { WalkthroughDoorBargeAndCollisionSolver } from '../walkthrough/parts/walkthrough-door-barge.ts';
import { composeHouseWalkthroughElevation } from '../walkthrough/auto-elevation-composer.ts';
import { SceneInteractionManager } from '../interaction/interaction-manager.ts';
import {
  applyVariationsToUrl,
  parseVariationSearchParams,
} from '../../core/variations-url.ts';

function makeBoxMesh(name: string, x: number, y: number, z: number, sx = 1, sy = 2, sz = 0.4): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(sx, sy, sz),
    new THREE.MeshStandardMaterial({ color: 0xccbbaa })
  );
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

describe('RoomVariationController & Engine Invariants', () => {
  it('activates defaultOptionId and hides sibling options with userData.variationHidden', () => {
    const optAGroup = new THREE.Group();
    optAGroup.add(makeBoxMesh('joinery.shelves', 0, 1, 0));

    const optBGroup = new THREE.Group();
    optBGroup.add(makeBoxMesh('joinery.cupboards', 0, 1, 0));

    const optCGroup = new THREE.Group();
    optCGroup.add(makeBoxMesh('joinery.desk', 0, 1, 0));

    const group = createRoomVariationGroup({
      id: 'gallery-east-wall',
      label: 'Gallery — East Wall',
      zoneId: 'gallery',
      defaultOptionId: 'shelves',
      options: [
        { id: 'shelves', label: 'Open Shelves', description: 'Oak open shelving', objects: [optAGroup] },
        { id: 'cupboards', label: 'Full Cupboards', description: 'Flush panelled doors', objects: [optBGroup] },
        { id: 'desk', label: 'Study Alcove', objects: [optCGroup] },
      ],
    });

    expect(optAGroup.visible).toBe(true);
    expect(optAGroup.userData.variationHidden).toBe(false);
    expect(optBGroup.visible).toBe(false);
    expect(optBGroup.userData.variationHidden).toBe(true);
    expect(optCGroup.visible).toBe(false);
    expect(optCGroup.userData.variationHidden).toBe(true);

    const replacedUrls: string[] = [];
    const controller = new RoomVariationController({
      groups: [group],
      syncUrl: true,
      replaceUrlState: (url) => replacedUrls.push(url),
    });

    const onChange = vi.fn();
    const unsub = controller.onChanged(onChange);

    expect(controller.getActiveOptionId('gallery-east-wall')).toBe('shelves');
    expect(controller.forRoom('gallery')).toHaveLength(1);
    expect(controller.forRoom('other')).toHaveLength(0);
    expect(controller.getSelections()).toEqual({});

    // Select cupboards
    expect(controller.selectOption('gallery-east-wall', 'cupboards')).toBe(true);
    expect(optAGroup.visible).toBe(false);
    expect(optAGroup.userData.variationHidden).toBe(true);
    expect(optBGroup.visible).toBe(true);
    expect(optBGroup.userData.variationHidden).toBe(false);
    expect(optCGroup.visible).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(replacedUrls.at(-1)).toContain('vars=gallery-east-wall%3Acupboards');

    // Cycle forward -> desk, cycle forward -> wraps back to shelves
    expect(controller.cycleOption('gallery-east-wall', 1)).toBe('desk');
    expect(optBGroup.visible).toBe(false);
    expect(optCGroup.visible).toBe(true);

    expect(controller.cycleOption('gallery-east-wall', 1)).toBe('shelves');
    expect(optAGroup.visible).toBe(true);
    expect(optCGroup.visible).toBe(false);
    // Back to default removes ?vars from URL
    expect(replacedUrls.at(-1)).not.toContain('vars=');

    // Cycle backward -> desk, then resetDefaults -> shelves
    expect(controller.cycleOption('gallery-east-wall', -1)).toBe('desk');
    expect(controller.resetDefaults()).toBe(true);
    expect(controller.getActiveOptionId('gallery-east-wall')).toBe('shelves');

    unsub();
  });

  it('parses and preserves URL query parameters (?vars= and ?var.<groupId>=)', () => {
    expect(
      parseVariationSearchParams('?dev=1&vars=wall-a:opt2,island:stone&var.wall-a=opt3')
    ).toEqual({
      'wall-a': 'opt3',
      island: 'stone',
    });

    const updatedUrl = applyVariationsToUrl(
      'https://example.com/viewer?dev=1&var.old=foo#top',
      { 'wall-a': 'opt2' }
    );
    expect(updatedUrl).toBe('https://example.com/viewer?dev=1&vars=wall-a%3Aopt2#top');

    const clearedUrl = applyVariationsToUrl(updatedUrl, {});
    expect(clearedUrl).toBe('https://example.com/viewer?dev=1#top');

    const opt1 = new THREE.Group();
    const opt2 = new THREE.Group();
    const ctl = new RoomVariationController({
      groups: [
        {
          id: 'wall-a',
          label: 'Wall A',
          defaultOptionId: 'opt1',
          options: [
            { id: 'opt1', label: 'Option 1', objects: [opt1] },
            { id: 'opt2', label: 'Option 2', objects: [opt2] },
          ],
        },
      ],
      syncUrl: false,
      initialSearch: '?var.wall-a=opt2',
    });
    expect(ctl.getActiveOptionId('wall-a')).toBe('opt2');
    expect(opt1.visible).toBe(false);
    expect(opt2.visible).toBe(true);
  });

  it('preserves CutawayController floor & wall cutaway invariants and never reveals hidden variations during shadow passes', () => {
    const scene = new THREE.Scene();
    const layers = createPropertySceneLayers(scene);
    const zoneRegistry = new SceneZoneRegistry([]);
    const lod = new RoomLodController([
      {
        zoneId: 'gallery',
        shortName: 'Gallery',
        floorId: 'first',
        bounds: { minX: -4, maxX: 4, minY: 2.8, maxY: 5.4, minZ: -4, maxZ: 4 },
      },
    ]);

    const optA = new THREE.Group();
    const wallA = makeBoxMesh('wallA', 0, 4.0, 3.8, 4, 2.4, 0.2);
    wallA.userData.cutawayWall = { floor: 'first', axis: 'z', coord: 3.8, minSpan: -2, maxSpan: 2, outwardSide: 'south' };
    optA.add(wallA);

    const optB = new THREE.Group();
    const wallB = makeBoxMesh('wallB', 0, 4.0, 3.8, 4, 2.4, 0.2);
    wallB.userData.cutawayWall = { floor: 'first', axis: 'z', coord: 3.8, minSpan: -2, maxSpan: 2, outwardSide: 'south' };
    optB.add(wallB);

    layers.firstFloorMeshGroup.add(optA, optB);

    const registry = new VariationRegistry();
    registry.createGroup({
      id: 'east-wall',
      label: 'East Wall',
      zoneId: 'gallery',
      defaultOptionId: 'a',
      options: [
        { id: 'a', label: 'A', objects: [optA] },
        { id: 'b', label: 'B', objects: [optB] },
      ],
    });

    lod.indexBuiltSceneHierarchy([layers.scene, layers.firstFloorMeshGroup]);

    const cutaway = new CutawayController(layers, zoneRegistry, lod);
    cutaway.collectDynamicCutawayWalls();
    cutaway.setFloorViewMode('first');

    const ctl = new RoomVariationController({
      groups: registry.getGroups(),
      syncUrl: false,
      onAfterVariationChange: () => {
        cutaway.invalidateLodCache();
      },
    });

    const camNorth = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camNorth.position.set(0, 6, -10);
    const target = new THREE.Vector3(0, 3.5, 0);

    cutaway.update({
      cameraPosition: camNorth.position,
      target,
      isOrthographic: false,
      orthoZoom: 1,
      camera: camNorth,
    });

    expect(optA.visible).toBe(true);
    expect(wallA.visible).toBe(true);
    expect(optB.visible).toBe(false);

    // Shadow-pass hook meshes must never reveal inactive variation wallB or optB
    const startHook = scene.getObjectByName('__cutawayShadowPassStart');
    const endHook = scene.getObjectByName('__cutawayShadowPassEnd');
    expect(startHook).toBeDefined();
    const dummyRenderer = {} as THREE.WebGLRenderer;
    const dummyGeo = new THREE.BufferGeometry();
    const dummyMat = new THREE.MeshBasicMaterial();
    const dummyGroup = new THREE.Group();
    startHook?.onBeforeShadow(dummyRenderer, scene, camNorth, camNorth, dummyGeo, dummyMat, dummyGroup);
    expect(isObjectVisibleInHierarchy(wallB)).toBe(false);
    endHook?.onBeforeShadow(dummyRenderer, scene, camNorth, camNorth, dummyGeo, dummyMat, dummyGroup);

    // Move camera to +Z side so +Z cutaway triggers on wallA, then switch live to option B
    const camSouth = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camSouth.position.set(0, 6, 10);
    cutaway.update({
      cameraPosition: camSouth.position,
      target,
      isOrthographic: false,
      orthoZoom: 1,
      camera: camSouth,
    });
    expect(wallA.visible).toBe(false);

    ctl.selectOption('east-wall', 'b');
    cutaway.update({
      cameraPosition: camSouth.position,
      target,
      isOrthographic: false,
      orthoZoom: 1,
      camera: camSouth,
    });
    expect(optA.visible).toBe(false);
    expect(optB.visible).toBe(true);
    expect(wallB.visible).toBe(false); // newly activated variation's cutaway wall cuts away too!

    // Move camera back to -Z side: wallB restores to visible while optA remains hidden
    cutaway.update({
      cameraPosition: camNorth.position,
      target,
      isOrthographic: false,
      orthoZoom: 1,
      camera: camNorth,
    });
    expect(optA.visible).toBe(false);
    expect(wallB.visible).toBe(true);

    // LOD tier changes never force inactive variation roots visible
    lod.setPolicyMode('lod2', camNorth.position, target, 'first');
    expect(optA.visible).toBe(false);
    expect(optB.visible).toBe(true);
  });

  it('excludes inactive variation meshes from raycasting, walkthrough collision, door auto-barge, and auto-elevation', () => {
    const scene = new THREE.Scene();

    // Option A has a solid blocking partition cabinet at z = 0 and a raised platform at x = 3, z = 0
    const optA = new THREE.Group();
    const blockingCabinet = makeBoxMesh('joinery.blockingCabinet', 0, 1.0, 0, 2.4, 2.0, 0.5);
    const platformA = makeBoxMesh('platformFloor.slab', 3, 0.2, 0, 2.0, 0.4, 2.0);
    platformA.userData.walkableSurface = true;
    optA.add(blockingCabinet, platformA);

    // Option B vacates z = 0 (open passage) and places a hinged door at x = -3, z = 0
    const optB = new THREE.Group();
    const doorLeaf = makeBoxMesh('doorLeaf', -3.0, 1.0, 0, 0.8, 2.0, 0.05);
    optB.add(doorLeaf);

    scene.add(optA, optB);
    scene.updateMatrixWorld(true);

    const interactiveMeshes: THREE.Object3D[] = [blockingCabinet];
    const interactions = new SceneInteractionManager(interactiveMeshes);
    const doorPivot = interactions.registerHingedDoor(
      optB,
      doorLeaf,
      new THREE.Vector3(-3.4, 0, 0),
      'y',
      Math.PI / 2,
      0
    );
    const doorId = String(doorPivot.userData.interactableId);

    const solver = new WalkthroughDoorBargeAndCollisionSolver({
      scene,
      onBargeWalkthroughDoor: (id, sprint, fx, fy, fz, mx, mz) =>
        interactions.bargeOpenWalkthroughDoor(id, sprint, fx, fy, fz, mx, mz),
      onProximityBargeDoors: (fx, fy, fz, mx, mz, sprint) =>
        interactions.bargeNearbyWalkthroughDoors(fx, fy, fz, mx, mz, sprint),
      onDoorBarged: () => {},
    });
    solver.captureFurnitureColliders();

    const elevation = composeHouseWalkthroughElevation({
      floors: [{ id: 'ground', label: 'Ground', elevationY: 0, ceilingHeight: 2.8 }],
      getScene: () => scene,
    });

    const ctl = new RoomVariationController({
      groups: [
        {
          id: 'layout',
          label: 'Layout',
          defaultOptionId: 'closed-joinery',
          options: [
            { id: 'closed-joinery', label: 'Joinery Wall', objects: [optA] },
            { id: 'open-passage', label: 'Open Passage', objects: [optB] },
          ],
        },
      ],
      syncUrl: false,
      onAfterVariationChange: () => {
        solver.invalidateObstacleCache();
      },
    });

    // 1. Raycasting across (0, 1, -2 -> +2): hits blockingCabinet in Option A
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(0, 1.0, -2.0),
      new THREE.Vector3(0, 0, 1)
    );
    scene.updateMatrixWorld(true);
    let hits = intersectVisibleObjects(raycaster, [scene], true);
    expect(hits.map((h) => h.object)).toContain(blockingCabinet);

    // 2. Walkthrough collision across z = -0.8 -> z = +0.8 at x = 0: blocked when Option A is active
    expect(
      solver.isBlockedByWallOrCabinet(
        new THREE.Vector3(0, 0, -0.8),
        new THREE.Vector3(0, 0, 1),
        1.6,
        1.7,
        true,
        false
      )
    ).toBe(true);

    // 3. Inactive door in Option B must NOT auto-barge when walking through (-3, 0, -0.35)
    interactions.bargeNearbyWalkthroughDoors(-3.0, 0, -0.35, 0, 1, true);
    expect(interactions.isInteractableOpenOrMoving(doorId)).toBe(false);

    // 4. Platform in Option A raises walkable elevation to ~0.4m at (3, 0)
    expect(elevation.sampleWalkableElevation(3, 0.1, 0, () => 0)).toBeCloseTo(0.4, 2);

    // Switch live to Option B ('open-passage')!
    ctl.selectOption('layout', 'open-passage');
    scene.updateMatrixWorld(true);

    // Raycast at x = 0 no longer hits hidden blockingCabinet
    hits = intersectVisibleObjects(raycaster, [scene], true);
    expect(hits.map((h) => h.object)).not.toContain(blockingCabinet);

    // Walkthrough collision at x = 0 is now completely clear!
    expect(
      solver.isBlockedByWallOrCabinet(
        new THREE.Vector3(0, 0, -0.8),
        new THREE.Vector3(0, 0, 1),
        1.6,
        1.7,
        true,
        false
      )
    ).toBe(false);

    // Hidden platform in Option A no longer raises elevation at (3, 0)
    expect(elevation.sampleWalkableElevation(3, 0.1, 0, () => 0)).toBeCloseTo(0, 2);

    // Active door in Option B now auto-barges cleanly when traversed!
    interactions.bargeNearbyWalkthroughDoors(-3.0, 0, -0.35, 0, 1, true);
    expect(interactions.isInteractableOpenOrMoving(doorId)).toBe(true);
  });

  it('deduplicates shared materials across variations, batches per option container, and suppresses lights in inactive variations', () => {
    const scene = new THREE.Scene();
    const layers = createPropertySceneLayers(scene);
    const lod = new RoomLodController([
      {
        zoneId: 'study',
        shortName: 'Study',
        floorId: 'ground',
        bounds: { minX: -4, maxX: 4, minY: 0, maxY: 2.8, minZ: -4, maxZ: 4 },
      },
    ]);

    const matCloneA = new THREE.MeshStandardMaterial({ color: 0x8b6f4e, roughness: 0.7 });
    const matCloneB = new THREE.MeshStandardMaterial({ color: 0x8b6f4e, roughness: 0.7 });

    const optA = new THREE.Group();
    const shelfMesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.8, 0.35), matCloneA);
    shelfMesh.position.set(1, 0.9, 0);
    const spotA = new THREE.SpotLight(0xffe6c2, 5.0, 6);
    spotA.position.set(1, 2.4, 0.5);
    const pointA = new THREE.PointLight(0xffe6c2, 3.0, 5);
    pointA.position.set(1, 2.2, 0.4);
    optA.add(shelfMesh, spotA, pointA);

    const optB = new THREE.Group();
    const cabinetMesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.1, 0.55), matCloneB);
    cabinetMesh.position.set(1, 1.05, 0);
    const spotB = new THREE.SpotLight(0xffe6c2, 5.0, 6);
    spotB.position.set(1, 2.4, 0.5);
    const pointB = new THREE.PointLight(0xffe6c2, 4.0, 5);
    pointB.position.set(1, 2.2, 0.4);
    optB.add(cabinetMesh, spotB, pointB);

    scene.add(optA, optB);

    const group = createRoomVariationGroup({
      id: 'study-joinery',
      label: 'Study Joinery',
      zoneId: 'study',
      defaultOptionId: 'a',
      options: [
        { id: 'a', label: 'Shelves', objects: [optA] },
        { id: 'b', label: 'Cupboards', objects: [optB] },
      ],
    });

    lod.indexBuiltSceneHierarchy([layers.scene, layers.firstFloorMeshGroup]);

    const batcher = new SceneBatchOptimizer({
      layers,
      lodController: lod,
      lightGroups: {} as unknown as LightGroupMap,
      indicatorMats: {},
      roomSwitchLedMats: [],
      interactiveMeshes: [],
      bifoldPanels: [],
      getDynamicObjects: () => new Set(),
    });
    batcher.setTimeOfDay('night');
    batcher.optimize();
    batcher.enableCarrierPointLightPool(4, new THREE.Vector3(1, 1.5, 1));

    const ctl = new RoomVariationController({
      groups: [group],
      syncUrl: false,
      onAfterVariationChange: () => {
        batcher.refreshManagedLights();
        batcher.stepFades(0);
      },
    });
    batcher.refreshManagedLights();
    batcher.stepFades(0);

    let matRefA: THREE.Material | undefined;
    let matRefB: THREE.Material | undefined;
    optA.traverse((n) => {
      if (n instanceof THREE.Mesh) matRefA = n.material as THREE.Material;
    });
    optB.traverse((n) => {
      if (n instanceof THREE.Mesh) matRefB = n.material as THREE.Material;
    });
    expect(matRefA).toBeDefined();
    expect(matRefA).toBe(matRefB);

    expect(spotA.visible).toBe(true);
    expect(spotB.visible).toBe(false);
    const getTotalCarrierIntensity = (): number => {
      let sum = 0;
      scene.traverse((n) => {
        if (n instanceof THREE.PointLight && n.userData?.isCarrierPointLight) {
          sum += n.intensity;
        }
      });
      return sum;
    };
    const intensityA = getTotalCarrierIntensity();
    expect(intensityA).toBeGreaterThan(0);

    ctl.selectOption('study-joinery', 'b');
    expect(spotA.visible).toBe(false);
    expect(spotB.visible).toBe(true);
    const intensityB = getTotalCarrierIntensity();
    // Option B's PointLight (base 4.0) replaces Option A's PointLight (base 3.0) at exact 4/3 ratio (not 3+4=7!)
    expect(intensityB / intensityA).toBeCloseTo(4.0 / 3.0, 2);
  });
});
