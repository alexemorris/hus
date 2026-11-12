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
    {
      get: (target, prop) =>
        prop in target ? (target as Record<PropertyKey, unknown>)[prop] : noop,
    }
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
import { describe, expect, it } from 'vitest';
import type { RoomZoneLodRegistration } from '../../core/entities.ts';
import type { CircuitId } from '../../core/types/knx.ts';
import type { CutawayWallDescriptor, FloorDefinition } from '../../core/types/scene.ts';
import type { BuildingId, RoomZoneId } from '../../core/types/topology.ts';
import { CutawayController } from '../cutaway/cutaway-controller.ts';
import { registerHingedDoor, registerSlidingDrawer, tagCutaway } from '../geometry/mesh-traits.ts';
import { InteractionRegistry } from '../interaction/interaction-registry.ts';
import { RoomLodController } from '../lod/lod-manager.ts';
import { SceneBatchOptimizer } from '../rendering/scene-batch-optimizer.ts';
import type { WalkthroughController } from '../walkthrough/walkthrough-controller.ts';
import type { PropertySceneProfile } from './property-scene-profile.ts';
import {
  buildPropertySceneContent,
  createPropertySceneLayers,
  createScopedBuilderContext,
} from './scene-content.ts';
import { SceneZoneRegistry } from './scene-zone-registry.ts';
import { CameraService } from './services/camera-service.ts';
import type { ViewerRenderer } from './services/viewer-renderer.ts';

const THREE_STOREY_FLOORS: readonly FloorDefinition[] = [
  { id: 'basement', label: 'Basement', elevationY: -2.8, ceilingHeight: 2.6 },
  { id: 'ground', label: 'Ground Floor', elevationY: 0, ceilingHeight: 2.8 },
  { id: 'first', label: 'First Floor', elevationY: 2.8, ceilingHeight: 2.6 },
];

const THREE_STOREY_LOD_REGISTRATIONS: readonly RoomZoneLodRegistration[] = [
  {
    zoneId: 'cellar' as RoomZoneId,
    shortName: 'Cellar',
    floorId: 'basement',
    bounds: { minX: -4, maxX: 4, minY: -2.8, maxY: -0.2, minZ: -3, maxZ: 3 },
    isInterior: true,
  },
  {
    zoneId: 'lounge' as RoomZoneId,
    shortName: 'Lounge',
    floorId: 'ground',
    bounds: { minX: -4, maxX: 4, minY: 0, maxY: 2.8, minZ: -3, maxZ: 3 },
    isInterior: true,
  },
  {
    zoneId: 'loft' as RoomZoneId,
    shortName: 'Loft',
    floorId: 'first',
    bounds: { minX: -4, maxX: 4, minY: 2.8, maxY: 5.4, minZ: -3, maxZ: 3 },
    isInterior: true,
  },
];

function createThreeStoreyProfile(
  overrides: Partial<PropertySceneProfile> = {},
  buildFn?: Parameters<SceneZoneRegistry['registerZoneModule']>[0]['build']
): PropertySceneProfile {
  return {
    name: 'Three-Storey Test House',
    floors: THREE_STOREY_FLOORS,
    createZoneRegistry: () =>
      new SceneZoneRegistry([
        {
          id: 'main-shell',
          name: 'Main Shell',
          buildingId: 'mainHouse' as BuildingId,
          floorId: 'ground',
          zoneIds: ['lounge' as RoomZoneId],
          build: buildFn ?? (() => ({})),
        },
      ]),
    lodRegistrations: THREE_STOREY_LOD_REGISTRATIONS,
    circuitMaxIntensity: {
      cellarGlow: 10,
      loungeGlow: 10,
      loftGlow: 10,
    } as unknown as Readonly<Record<CircuitId, number>>,
    defaultFixtureAppearance: { emissiveMax: 1, coneOpacity: 0.35 },
    fixtureAppearanceOverrides: {},
    switchLedRules: [],
    bifoldTrack: { anchorRightX: 2, trackZ: 0, leafWidth: 0.8, maxFoldAngle: Math.PI / 2 },
    buildSecurityOverlay: () => ({
      syncCameras: () => {},
      syncAccessPoints: () => {},
    }),
    ...overrides,
  };
}

function makeFakeCanvas(): HTMLCanvasElement {
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  return {
    clientWidth: 1200,
    clientHeight: 800,
    width: 1200,
    height: 800,
    style: {},
    addEventListener: (type: string, fn: EventListenerOrEventListenerObject) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: EventListenerOrEventListenerObject) => {
      listeners.get(type)?.delete(fn);
    },
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      right: 1200,
      bottom: 800,
      width: 1200,
      height: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    getRootNode: () => ({
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  } as unknown as HTMLCanvasElement;
}

describe('N-Storey Floor Ergonomics & Cutaway Engine', () => {
  it('preserves exact legacy scene.children layout when lazy floor/site groups are unused', () => {
    const scene = new THREE.Scene();
    const layers = createPropertySceneLayers(scene);

    expect(scene.children).toHaveLength(7);
    expect(scene.children[0]).toBe(layers.firstFloorMeshGroup);
    expect(scene.children[1]).toBe(layers.groundFloorCeilingGroup);
    expect(scene.children[2]).toBe(layers.ceilingMeshGroup);
    expect(layers.roofGroup).toBe(layers.ceilingMeshGroup);
    expect(layers.firstFloorMeshGroup.name).toBe('');
    expect(layers.firstFloorMeshGroup.userData).toEqual({});
    expect(layers.siteGroup.parent).toBeNull();
    expect(layers.floorLayers[0]!.contentGroup.parent).toBeNull();
  });

  it('builds 3-storey basement/ground/first content via ctx.floor(), ctx.roof, ctx.site, and createScopedBuilderContext', () => {
    const scene = new THREE.Scene();
    const layers = createPropertySceneLayers(scene);
    let unknownFloorError: Error | undefined;

    const profile = createThreeStoreyProfile({}, (ctx) => {
      const b = ctx.floor!('basement');
      const g = ctx.floor!('ground');
      const f = ctx.floor!('first');

      expect(b.elevationY).toBe(-2.8);
      expect(b.ceilingHeight).toBe(2.6);
      expect(g.elevationY).toBe(0);
      expect(f.elevationY).toBe(2.8);

      const basementMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
      basementMesh.name = 'cellar.table';
      b.add(basementMesh);

      const basementSlab = new THREE.Mesh(new THREE.BoxGeometry(8, 0.2, 6));
      b.slabGroup.add(basementSlab);

      const groundMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
      groundMesh.name = 'lounge.sofa';
      g.add(groundMesh);

      const firstCeiling = new THREE.Mesh(new THREE.BoxGeometry(8, 0.1, 6));
      f.ceilingGroup.add(firstCeiling);

      const roofRidge = new THREE.Mesh(new THREE.BoxGeometry(8, 0.5, 6));
      ctx.roof!.add(roofRidge);

      const gardenTree = new THREE.Mesh(new THREE.BoxGeometry(1, 3, 1));
      ctx.site!.add(gardenTree);

      const wingCtx = createScopedBuilderContext(ctx, {
        name: 'eastWing',
        offset: [10, 0, 4],
      });
      const wingFirstMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
      wingFirstMesh.name = 'desk';
      wingCtx.floor!('first').add(wingFirstMesh);

      ctx.addGlowPool('cellarGlow' as CircuitId, 0, -2.79, 0, 1.2);
      ctx.addGlowPool('loungeGlow' as CircuitId, 0, 0.01, 0, 1.2);
      ctx.addGlowPool('loftGlow' as CircuitId, 0, 2.81, 0, 1.2);

      try {
        ctx.floor!('penthouse');
      } catch (err) {
        unknownFloorError = err as Error;
      }

      return {};
    });

    const registry = profile.createZoneRegistry();
    const lod = new RoomLodController(profile.lodRegistrations);
    buildPropertySceneContent(layers, {
      profile,
      registry,
      lodController: lod,
      ceilingCutaway: true,
    });

    expect(unknownFloorError?.message).toContain('basement, ground, first');
    expect(layers.floorLayers.map((fl) => fl.id)).toEqual(['basement', 'ground', 'first']);
    expect(layers.getFloorLayer('basement')!.contentGroup.parent).toBe(scene);
    expect(layers.getFloorLayer('basement')!.slabGroup.parent).toBe(scene);
    expect(layers.getFloorLayer('basement')!.ceilingGroup).toBe(layers.groundFloorCeilingGroup);
    expect(layers.getFloorLayer('ground')!.contentGroup).toBe(layers.firstFloorMeshGroup);
    expect(layers.getFloorLayer('first')!.ceilingGroup.parent).toBe(scene);
    expect(layers.siteGroup.parent).toBe(scene);

    const hasGlow = (root: THREE.Object3D, yApprox: number): boolean => {
      let found = false;
      root.traverse((o) => {
        if (
          o instanceof THREE.Mesh &&
          o.material instanceof THREE.MeshBasicMaterial &&
          Math.abs(o.position.y - yApprox) < 0.05
        ) {
          found = true;
        }
      });
      return found;
    };
    expect(hasGlow(layers.getFloorLayer('basement')!.contentGroup, -2.79)).toBe(true);
    expect(hasGlow(layers.getFloorLayer('ground')!.contentGroup, 0.01)).toBe(true);
    expect(hasGlow(layers.getFloorLayer('first')!.contentGroup, 2.81)).toBe(true);
  });

  it('supports deterministic 3-storey isolation, initialView, and All+Section dollhouse wall cutaway', () => {
    const scene = new THREE.Scene();
    const layers = createPropertySceneLayers(scene, THREE_STOREY_FLOORS);

    const southWalls: Record<string, THREE.Mesh> = {};
    const northWalls: Record<string, THREE.Mesh> = {};

    const profile = createThreeStoreyProfile(
      {
        initialView: { floor: 'all', sectionCut: false },
      },
      (ctx) => {
        for (const fl of THREE_STOREY_FLOORS) {
          const ceilH = fl.ceilingHeight ?? 2.6;
          const scope = ctx.floor!(fl.id);
          const southWall = new THREE.Mesh(new THREE.BoxGeometry(8, ceilH, 0.2));
          southWall.position.set(0, fl.elevationY + ceilH * 0.5, 3);
          tagCutaway(southWall, {
            axis: 'z',
            coord: 3,
            minSpan: -4,
            maxSpan: 4,
            floor: fl.id,
            outwardSide: 'south',
          });
          scope.add(southWall);
          southWalls[fl.id] = southWall;

          const northWall = new THREE.Mesh(new THREE.BoxGeometry(8, ceilH, 0.2));
          northWall.position.set(0, fl.elevationY + ceilH * 0.5, -3);
          tagCutaway(northWall, {
            axis: 'z',
            coord: -3,
            minSpan: -4,
            maxSpan: 4,
            floor: fl.id,
            outwardSide: 'north',
          });
          scope.add(northWall);
          northWalls[fl.id] = northWall;

          scope.slabGroup.add(new THREE.Mesh(new THREE.BoxGeometry(8, 0.2, 6)));
          scope.ceilingGroup.add(new THREE.Mesh(new THREE.BoxGeometry(8, 0.1, 6)));
        }
        ctx.roof!.add(new THREE.Mesh(new THREE.BoxGeometry(8.4, 1.2, 6.4)));
        return {};
      }
    );

    const registry = profile.createZoneRegistry();
    const lod = new RoomLodController(profile.lodRegistrations);
    buildPropertySceneContent(layers, {
      profile,
      registry,
      lodController: lod,
      ceilingCutaway: false,
    });

    const cutaways = new CutawayController(layers, registry, lod, profile);
    cutaways.collectDynamicCutawayWalls();

    expect(cutaways.getFloorViewMode()).toBe('all');
    expect(cutaways.isCeilingCutaway()).toBe(false);

    const southOrbitView = {
      cameraPosition: new THREE.Vector3(0, 8, 14),
      target: new THREE.Vector3(0, 1, 0),
      isOrthographic: false,
      orthoZoom: 1,
    };

    cutaways.update(southOrbitView);
    expect(layers.roofGroup.visible).toBe(true);
    expect(southWalls.basement!.visible).toBe(true);
    expect(southWalls.ground!.visible).toBe(true);
    expect(southWalls.first!.visible).toBe(true);

    cutaways.toggleCeilingCutaway();
    expect(cutaways.isCeilingCutaway()).toBe(true);
    cutaways.update(southOrbitView);

    const bLayer = layers.getFloorLayer('basement')!;
    const gLayer = layers.getFloorLayer('ground')!;
    const fLayer = layers.getFloorLayer('first')!;

    expect(bLayer.contentGroup.visible).toBe(true);
    expect(gLayer.contentGroup.visible).toBe(true);
    expect(fLayer.contentGroup.visible).toBe(true);
    expect(bLayer.ceilingGroup.visible).toBe(true);
    expect(gLayer.ceilingGroup.visible).toBe(true);
    expect(fLayer.ceilingGroup.visible).toBe(false);
    expect(layers.roofGroup.visible).toBe(false);

    expect(southWalls.basement!.visible).toBe(false);
    expect(southWalls.ground!.visible).toBe(false);
    expect(southWalls.first!.visible).toBe(false);
    expect(northWalls.basement!.visible).toBe(true);
    expect(northWalls.ground!.visible).toBe(true);
    expect(northWalls.first!.visible).toBe(true);

    cutaways.setFloorViewMode('basement');
    cutaways.update(southOrbitView);
    expect(bLayer.contentGroup.visible).toBe(true);
    expect(bLayer.ceilingGroup.visible).toBe(false);
    expect(gLayer.contentGroup.visible).toBe(false);
    expect(gLayer.slabGroup.visible).toBe(false);
    expect(gLayer.ceilingGroup.visible).toBe(false);
    expect(fLayer.contentGroup.visible).toBe(false);
    expect(layers.roofGroup.visible).toBe(false);
    expect(southWalls.basement!.visible).toBe(false);

    cutaways.toggleCeilingCutaway();
    cutaways.update(southOrbitView);
    expect(bLayer.ceilingGroup.visible).toBe(true);
    expect(gLayer.contentGroup.visible).toBe(false);
    expect(layers.roofGroup.visible).toBe(false);

    cutaways.setFloorViewMode('ground');
    cutaways.update(southOrbitView);
    expect(bLayer.contentGroup.visible).toBe(true);
    expect(bLayer.ceilingGroup.visible).toBe(true);
    expect(gLayer.contentGroup.visible).toBe(true);
    expect(gLayer.ceilingGroup.visible).toBe(false);
    expect(fLayer.contentGroup.visible).toBe(false);
    expect(layers.roofGroup.visible).toBe(false);
    expect(southWalls.ground!.visible).toBe(false);
    expect(southWalls.basement!.visible).toBe(true);
  });

  it('never merges static meshes across different floors in SceneBatchOptimizer', () => {
    const scene = new THREE.Scene();
    const layers = createPropertySceneLayers(scene, THREE_STOREY_FLOORS);
    const sharedMat = new THREE.MeshStandardMaterial({ color: 0xcccccc });

    const profile = createThreeStoreyProfile({}, (ctx) => {
      for (const fl of THREE_STOREY_FLOORS) {
        const scope = ctx.floor!(fl.id);
        for (const x of [-1.5, 1.5]) {
          const box = new THREE.Mesh(new THREE.BoxGeometry(1, 0.8, 1), sharedMat);
          box.position.set(x, fl.elevationY + 0.5, 0);
          scope.add(box);
        }
        const directA = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), sharedMat);
        directA.position.set(-0.5, fl.elevationY + 0.4, 1.2);
        directA.userData.floorId = fl.id;
        ctx.scene.add(directA);

        const directB = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), sharedMat);
        directB.position.set(0.5, fl.elevationY + 0.4, 1.2);
        directB.userData.floorId = fl.id;
        ctx.scene.add(directB);
      }
      return {};
    });

    const registry = profile.createZoneRegistry();
    const lod = new RoomLodController(profile.lodRegistrations);
    const content = buildPropertySceneContent(layers, {
      profile,
      registry,
      lodController: lod,
      ceilingCutaway: true,
    });

    const optimizer = new SceneBatchOptimizer({
      layers,
      lodController: lod,
      lightGroups: content.lightGroups,
      indicatorMats: content.indicatorMats,
      roomSwitchLedMats: content.roomSwitchLedMats,
      interactiveMeshes: content.interactiveMeshes,
      bifoldPanels: content.bifoldPanels,
      getDynamicObjects: () => new Set(),
    });
    optimizer.optimize();

    const sceneBatches = scene.children.filter(
      (c): c is THREE.Mesh => c instanceof THREE.Mesh && Boolean(c.userData?.isBatchedStaticMesh)
    );
    expect(sceneBatches.length).toBe(3);
    const seenFloors = new Set(sceneBatches.map((m) => m.userData.floorId));
    expect(seenFloors).toEqual(new Set(['basement', 'ground', 'first']));

    for (const batchMesh of sceneBatches) {
      const box = new THREE.Box3().setFromObject(batchMesh);
      expect(box.max.y - box.min.y).toBeLessThan(1.5);
    }

    for (const fl of THREE_STOREY_FLOORS) {
      const ceilH = fl.ceilingHeight ?? 2.6;
      const group = layers.getFloorLayer(fl.id)!.contentGroup;
      const box = new THREE.Box3().setFromObject(group);
      expect(box.min.y).toBeGreaterThanOrEqual(fl.elevationY - 0.1);
      expect(box.max.y).toBeLessThanOrEqual(fl.elevationY + ceilH + 0.1);
    }

    optimizer.unbatchAll();
    const remainingSceneBatches = scene.children.filter((c) =>
      Boolean(c.userData?.isBatchedStaticMesh)
    );
    expect(remainingSceneBatches).toHaveLength(0);
  });

  it('auto-populates interiorBounds, synthesizes the top Plan preset, and resolves walkthrough floors dynamically', () => {
    const scene = new THREE.Scene();
    const layers = createPropertySceneLayers(scene, THREE_STOREY_FLOORS);
    const profile = createThreeStoreyProfile({
      initialView: { floor: 'ground', sectionCut: false },
    });
    const registry = profile.createZoneRegistry();
    const lod = new RoomLodController(profile.lodRegistrations);

    expect(registry.getCameraPreset('top')).toBeUndefined();
    expect(registry.getInteriorBounds()).toHaveLength(0);

    buildPropertySceneContent(layers, {
      profile,
      registry,
      lodController: lod,
      ceilingCutaway: false,
    });

    expect(registry.getInteriorBounds()).toHaveLength(3);
    expect(registry.isPointInsideInteriorRoom(0, -1.5, 0)).toBe(true);
    const topPreset = registry.getCameraPreset('top');
    expect(topPreset).toBeDefined();
    expect(topPreset!.useOrthographic).toBe(true);
    expect(topPreset!.orthoZoom).toBeDefined();
    expect(topPreset!.floorViewMode).toBeUndefined();

    const cutaways = new CutawayController(layers, registry, lod, profile);
    expect(cutaways.getFloorViewMode()).toBe('ground');
    expect(cutaways.isCeilingCutaway()).toBe(false);

    let walkthroughActive = false;
    const cameraService = new CameraService({
      canvas: makeFakeCanvas(),
      scene,
      renderer: {
        resetHistory: () => {},
        requestRender: () => {},
      } as unknown as ViewerRenderer,
      zoneRegistry: registry,
      lodController: lod,
      onActiveCameraChanged: () => {},
      getCutaways: () => cutaways,
      getWalkthrough: () =>
        ({
          isActive: () => walkthroughActive,
          isPointerLocked: () => false,
          exit: () => {
            walkthroughActive = false;
          },
        }) as unknown as WalkthroughController,
      isPickExcluded: () => false,
      refreshView: () => {},
    });

    cameraService.flyToPreset('top');
    expect(cameraService.rig.isOrthographic()).toBe(true);
    expect(cameraService.rig.orthoCamera.zoom).toBeCloseTo(topPreset!.orthoZoom!, 5);
    expect(cutaways.getFloorViewMode()).toBe('ground');
    expect(cutaways.isCeilingCutaway()).toBe(true);

    walkthroughActive = true;
    cameraService.rig.useCamera(false);
    cameraService.rig.getActiveCamera().position.set(0, -1.2, 0);
    expect(cameraService.getViewState().floorViewMode).toBe('basement');

    cameraService.rig.getActiveCamera().position.set(0, 1.5, 0);
    expect(cameraService.getViewState().floorViewMode).toBe('ground');

    cameraService.rig.getActiveCamera().position.set(0, 4.2, 0);
    expect(cameraService.getViewState().floorViewMode).toBe('first');
  });

  it('hoists cutawayWall onto hinged door pivots, sliding drawers/sashes, and supports exterior acoustic portals', () => {
    const scene = new THREE.Scene();
    const layers = createPropertySceneLayers(scene, THREE_STOREY_FLOORS);
    const interactiveMeshes: THREE.Object3D[] = [];
    const interactions = new InteractionRegistry(interactiveMeshes);
    const baselineEnumerableKeys = Object.keys(interactions);

    const wallCutaway: CutawayWallDescriptor = {
      axis: 'z',
      coord: 3,
      minSpan: -2,
      maxSpan: 2,
      floor: 'ground',
      outwardSide: 'south',
    };

    const doorRoomGroup = new THREE.Group();
    layers.getFloorLayer('ground')!.contentGroup.add(doorRoomGroup);
    const doorLeaf = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 2.1, 0.045),
      new THREE.MeshStandardMaterial({ color: 0x6b4423 })
    );
    doorLeaf.name = 'lounge.frontDoor';
    doorLeaf.position.set(0, 1.05, 3);
    doorRoomGroup.add(doorLeaf);
    tagCutaway(doorLeaf, wallCutaway);

    const doorPivot = registerHingedDoor(
      { interactions },
      {
        parent: doorRoomGroup,
        door: doorLeaf,
        hingeOffset: [-0.45, 0, 0],
        axis: 'y',
        openAngle: Math.PI / 2,
      }
    );
    expect(doorPivot.userData.isCutawayWall).toBe(true);
    expect(doorPivot.userData.cutawayWall).toEqual(wallCutaway);

    const sashGroup = new THREE.Group();
    sashGroup.name = 'lounge.lowerSash';
    const sashRailA = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 0.06, 0.04),
      new THREE.MeshStandardMaterial({ color: 0xffffff })
    );
    const sashRailB = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 0.04), sashRailA.material);
    sashRailB.position.y = 0.6;
    tagCutaway(sashRailA, wallCutaway);
    sashGroup.add(sashRailA, sashRailB);
    doorRoomGroup.add(sashGroup);

    registerSlidingDrawer({ interactions }, { drawer: sashGroup, slideDelta: [0, 0.55, 0] });
    expect(sashGroup.userData.isCutawayWall).toBe(true);
    expect(sashGroup.userData.cutawayWall).toEqual(wallCutaway);

    let sashOpenness = 0.25;
    interactions.registerExteriorAcousticPortal(() => ({
      id: 'window:lounge.sash',
      position: [1.5, 1.4, 3],
      areaM2: 1.2,
      openness: sashOpenness,
    }));

    expect(Object.keys(interactions)).toEqual(baselineEnumerableKeys);
    const portalsA = interactions.getExteriorDoorAcousticPortals((_x, _y, z) => z < 3);
    expect(portalsA.find((p) => p.id === 'window:lounge.sash')?.openness).toBe(0.25);

    sashOpenness = 0.85;
    const portalsB = interactions.getExteriorDoorAcousticPortals((_x, _y, z) => z < 3);
    expect(portalsB.find((p) => p.id === 'window:lounge.sash')?.openness).toBe(0.85);

    const profile = createThreeStoreyProfile();
    const registry = profile.createZoneRegistry();
    const lod = new RoomLodController(profile.lodRegistrations);
    const cutaways = new CutawayController(layers, registry, lod, profile);
    cutaways.setFloorViewMode('ground');
    cutaways.collectDynamicCutawayWalls();
    cutaways.update({
      cameraPosition: new THREE.Vector3(0, 5, 12),
      target: new THREE.Vector3(0, 1, 0),
      isOrthographic: false,
      orthoZoom: 1,
    });

    expect(doorPivot.visible).toBe(false);
    expect(sashGroup.visible).toBe(false);
  });
});
