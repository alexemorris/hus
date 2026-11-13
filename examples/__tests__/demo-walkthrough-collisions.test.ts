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
  const listeners = new Map<string, Set<EventListener>>();
  const stubTarget = {
    addEventListener: (type: string, fn: EventListener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: EventListener) => {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent: () => true,
  };
  (globalThis as unknown as { window?: unknown }).window ??= {
    ...stubTarget,
    devicePixelRatio: 1,
    innerWidth: 1440,
    innerHeight: 900,
  };
  (globalThis as unknown as { HTMLElement?: unknown }).HTMLElement ??= class {};
  (globalThis as unknown as { document: unknown }).document = {
    ...stubTarget,
    activeElement: null,
    pointerLockElement: null,
    body: { ...stubTarget },
    createElement: (tag: string) => {
      if (tag === 'canvas') {
        return {
          ...stubTarget,
          width: 256,
          height: 256,
          clientWidth: 1440,
          clientHeight: 900,
          style: {},
          setPointerCapture: noop,
          getRootNode: () => document,
          releasePointerCapture: noop,
          getBoundingClientRect: () => ({
            left: 0,
            top: 0,
            width: 1440,
            height: 900,
            right: 1440,
            bottom: 900,
          }),
          getContext: () => ctx2d,
        };
      }
      return { ...stubTarget, width: 256, height: 256, style: {}, getContext: () => ctx2d };
    },
  };
}

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildPropertySceneContent,
  CameraRig,
  createPropertySceneLayers,
  CutawayController,
  InteractionRegistry,
  RoomLodController,
  SceneBatchOptimizer,
  WalkthroughController,
} from 'husjs/viewer';
import { simpleFlat } from '../simple-flat/index.ts';
import { simpleHouse } from '../simple-house/index.ts';
import { stahlHouse } from '../stahl-house/index.ts';

interface WalkthroughTestRig {
  readonly scene: THREE.Scene;
  readonly walkthrough: WalkthroughController;
  readonly interactions: InteractionRegistry;
  readonly lodController: RoomLodController;
  readonly cutaways: CutawayController;
  walkTowards(
    targetX: number,
    targetZ: number,
    maxSeconds?: number,
    arrivalRadius?: number
  ): THREE.Vector3;
  teleportAndWalk(
    start: readonly [number, number, number],
    targetX: number,
    targetZ: number,
    maxSeconds?: number
  ): THREE.Vector3;
}

function buildPostBatchWalkthroughRig(house: Pick<typeof simpleHouse, 'createSceneProfile'>): WalkthroughTestRig {
  const profile = house.createSceneProfile();
  const zoneRegistry = profile.createZoneRegistry();
  const scene = new THREE.Scene();
  const layers = createPropertySceneLayers(scene, profile.floors);
  const lodController = new RoomLodController(profile.lodRegistrations);
  const cutaways = new CutawayController(layers, zoneRegistry, lodController, profile);
  const getRoomMinYAt = (x: number, y: number, z: number): number | null => {
    let bestMinY: number | null = null;
    let bestDistY = Number.POSITIVE_INFINITY;
    for (const reg of profile.lodRegistrations) {
      if (reg.isInterior === false) continue;
      if (reg.excludedCutout?.(x, z)) continue;
      const b = reg.bounds;
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) {
        const floorDef = profile.floors?.find((f: { readonly id: string }) => f.id === reg.floorId);
        const walkingFloorY = reg.walkingFloorY ?? floorDef?.elevationY ?? b.minY;
        const distY = Math.abs(y - walkingFloorY);
        if (distY <= 0.95 && distY < bestDistY) {
          bestDistY = distY;
          bestMinY = walkingFloorY;
        }
      }
    }
    return bestMinY;
  };

  const canvas = document.createElement('canvas') as HTMLCanvasElement;
  if (!canvas.clientWidth) {
    Object.defineProperty(canvas, 'clientWidth', { value: 1440 });
    Object.defineProperty(canvas, 'clientHeight', { value: 900 });
  }
  if (!(canvas as unknown as { getRootNode?: unknown }).getRootNode) {
    (canvas as unknown as { getRootNode: () => unknown }).getRootNode = () => document;
  }
  if (!canvas.getBoundingClientRect) {
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 1440, height: 900, right: 1440, bottom: 900 }) as DOMRect;
  }
  const rig = new CameraRig(canvas, () => undefined);

  let content!: ReturnType<typeof buildPropertySceneContent>;
  let interactions!: InteractionRegistry;

  const refreshView = () => {
    const camPos = rig.getActiveCamera().position;
    const isWalkthrough = walkthrough.isActive();
    lodController.evaluateLod(camPos, camPos, cutaways.getFloorViewMode(), true, { camera: rig.getActiveCamera(), isWalkthrough });
    scene.updateMatrixWorld(true);
  };

  const walkthrough = new WalkthroughController({
    canvas,
    scene,
    rig,
    getRoomMinYAt,
    getCurrentRoomId: () => null,
    getRoomFloorSurface: () => undefined,
    getInteractiveMeshes: () => {
      const base = content?.interactiveMeshes ?? [];
      const extra = interactions?.getSmartClickableMeshes() ?? [];
      return extra.length > 0 ? [...base, ...extra] : base;
    },
    describeInteractable: (mesh) => interactions.describeInteractable(mesh, false),
    onInteractWithMesh: (mesh) => {
      const rawId = mesh.userData?.interactableId;
      const id = typeof rawId === 'string' ? interactions.resolveInteractableId(rawId) : null;
      if (id) interactions.handleInteractableClick(id);
    },
    onBargeWalkthroughDoor: (id, isSprinting, fx, fy, fz, dx, dz) =>
      interactions.bargeOpenWalkthroughDoor(id, isSprinting, fx, fy, fz, dx, dz),
    onProximityBargeDoors: (fx, fy, fz, dx, dz, isSprinting) =>
      interactions.bargeNearbyWalkthroughDoors(fx, fy, fz, dx, dz, isSprinting),
    onStateChanged: () => refreshView(),
    onPoseUpdated: () => refreshView(),
    hooks: profile.walkthroughHooks,
  });

  content = buildPropertySceneContent(layers, { profile, registry: zoneRegistry, lodController, ceilingCutaway: false });
  interactions = content.interactions;
  scene.updateMatrixWorld(true);

  const optimizer = new SceneBatchOptimizer({
    layers,
    lodController,
    interactiveMeshes: content.interactiveMeshes,
    bifoldPanels: content.bifoldPanels,
    lightGroups: content.lightGroups,
    indicatorMats: {} as ConstructorParameters<typeof SceneBatchOptimizer>[0]['indicatorMats'],
    roomSwitchLedMats: content.roomSwitchLedMats ?? [],
    getDynamicObjects: () => {
      const dyn = new Set<THREE.Object3D>();
      for (const m of interactions.getSmartClickableMeshes()) dyn.add(m);
      scene.traverse((obj) => {
        const u = obj.userData as Record<string, unknown> | undefined;
        if (
          u?.doorRole === 'pivot' ||
          u?.drawerRole === 'group' ||
          (typeof u?.interactableId === 'string' && u.interactableId.length > 0)
        ) {
          obj.traverse((c) => dyn.add(c));
        }
      });
      return dyn;
    },
  });
  interactions.setUnbatchSubtreeHandler((targetRoot) => optimizer.unbatchSubtree(targetRoot));

  // Mirror ViewerComposition boot sequence: capture colliders, then optimize static batches!
  walkthrough.captureFurnitureColliders();
  optimizer.optimize();
  scene.updateMatrixWorld(true);

  const poseSnapshot = {
    position: [0, 2, 8] as [number, number, number],
    target: [0, 1, 0] as [number, number, number],
    isOrthographic: false,
    orthoZoom: 1,
    floorViewMode: 'all' as const,
    ceilingCutaway: false,
  };

  const dt = 1 / 60;
  const stepFrame = () => {
    interactions.update(dt);
    scene.updateMatrixWorld(true);
    walkthrough.update(dt);
  };

  const walkTowards = (
    targetX: number,
    targetZ: number,
    maxSeconds = 4.0,
    arrivalRadius = 0.14
  ): THREE.Vector3 => {
    const steps = Math.ceil(maxSeconds / dt);
    for (let i = 0; i < steps; i++) {
      const fp = walkthrough.getFootPosition();
      const dx = targetX - fp.x;
      const dz = targetZ - fp.z;
      if (Math.hypot(dx, dz) <= arrivalRadius) {
        walkthrough.setTouchMoveVector(0, 0, false);
        for (let s = 0; s < 15; s++) stepFrame();
        break;
      }
      // Face target directly: camera forward is (-sin(yaw), -cos(yaw))
      const desiredYaw = Math.atan2(-dx, -dz);
      const curYaw = (walkthrough as unknown as { yawRad: number }).yawRad;
      (walkthrough as unknown as { yawRad: number; targetYawRad: number }).yawRad = desiredYaw;
      (walkthrough as unknown as { yawRad: number; targetYawRad: number }).targetYawRad =
        desiredYaw;
      void curYaw;
      walkthrough.setTouchMoveVector(0, 1, false);
      stepFrame();
    }
    walkthrough.setTouchMoveVector(0, 0, false);
    return walkthrough.getFootPosition().clone();
  };

  const teleportAndWalk = (
    start: readonly [number, number, number],
    targetX: number,
    targetZ: number,
    maxSeconds = 3.0
  ): THREE.Vector3 => {
    const yawDeg = THREE.MathUtils.radToDeg(Math.atan2(-(targetX - start[0]), -(targetZ - start[2])));
    walkthrough.enter(poseSnapshot, { position: start, yawDeg }, { warmUpAudio: false });
    return walkTowards(targetX, targetZ, maxSeconds);
  };

  return {
    scene,
    walkthrough,
    interactions,
    lodController,
    cutaways,
    walkTowards,
    teleportAndWalk,
  };
}

describe('1PV Post-Batch Walkthrough Collisions, Door Auto-Barge & Staircase Ascent/Descent', () => {
  it('simple-house: blocks walls/furniture/balustrades, auto-barges doors, and climbs/descends stairs post-batch', () => {
    const rig = buildPostBatchWalkthroughRig(simpleHouse);
    // Simulate Ground-only floorViewMode before entering walkthrough to verify walkthrough forces all floors visible
    rig.cutaways.setFloorViewMode('ground');

    // Exterior steps + front door auto-barge: gravel forecourt (Y = -0.16) -> portico steps -> houseHall (Y = 0)
    const afterFrontDoor = rig.teleportAndWalk([0, -0.16, 7.6], 0, 2.8, 4.5);
    expect(afterFrontDoor.z).toBeLessThan(3.2);
    expect(Math.abs(afterFrontDoor.y - 0.0)).toBeLessThan(0.03);

    // Wall containment: Hall -> West spine partition wall (X = -1.65 inner face, solid section away from hallDrawing at Z = 3.52)
    const wallWest = rig.teleportAndWalk([-0.4, 0, 1.8], -2.5, 1.8, 2.2);
    expect(wallWest.x).toBeGreaterThan(-1.74);

    // Drawing Room exterior West brick wall (X = -7.05 inner face, north of bolection fireplace)
    const extWest = rig.teleportAndWalk([-6.1, 0, -2.0], -7.6, -2.0, 2.2);
    expect(extWest.x).toBeGreaterThan(-7.15);

    // Exterior front brick railings & yew hedge containment (expanded 14.82 m house curtilage)
    const railingHit = rig.teleportAndWalk([2.1, -0.16, 9.8], 2.1, 12.2, 2.5);
    expect(railingHit.z).toBeLessThan(11.1);
    const hedgeEast = rig.teleportAndWalk([9.8, -0.16, 2.0], 13.0, 2.0, 2.5);
    expect(hedgeEast.x).toBeLessThan(11.8);

    // Furniture & joinery blocking in simple-house:
    // Kitchen Ink prep island ([4.25, 0, -1.55], rotated 90 deg -> 1.08 W x 2.20 D -> X in [3.71, 4.79], Z in [-2.65, -0.45])
    const islandHit = rig.teleportAndWalk([2.85, 0, -1.55], 4.4, -1.55, 2.5);
    expect(islandHit.x).toBeLessThan(3.75);

    // Drawing Room sofa ([-4.22, 0, -1.45]) & coffee table ([-4.22, 0, 0.0])
    const sofaHit = rig.teleportAndWalk([-4.22, 0, -2.6], -4.22, -1.45, 2.0);
    expect(sofaHit.z).toBeLessThan(-1.8);
    const coffeeHit = rig.teleportAndWalk([-2.7, 0, 0.0], -4.22, 0.0, 2.2);
    expect(coffeeHit.x).toBeGreaterThan(-3.7);

    // Arundel dining table ([4.55, 0, 2.05])
    const diningHit = rig.teleportAndWalk([2.95, 0, 2.05], 4.55, 2.05, 2.5);
    expect(diningHit.x).toBeLessThan(3.95);

    // Principal Bed ([-6.99.. -4.8, 3.05, 2.38]) & Guest Bed ([4.47, 3.05, -0.08..2.0])
    const principalBedHit = rig.teleportAndWalk([-3.4, 3.05, 2.38], -5.8, 2.38, 2.5);
    expect(principalBedHit.x).toBeGreaterThan(-4.55);
    const guestBedHit = rig.teleportAndWalk([4.47, 3.05, 3.1], 4.47, 0.8, 2.5);
    expect(guestBedHit.z).toBeGreaterThan(1.8);

    // Study desk ([4.48, 3.05, -3.72]) & Family Bathroom copper boat bath ([-0.05, 3.05, -3.72])
    const deskHit = rig.teleportAndWalk([4.48, 3.05, -2.3], 4.48, -3.9, 2.2);
    expect(deskHit.z).toBeGreaterThan(-3.35);
    const bathHit = rig.teleportAndWalk([-0.05, 3.05, -2.3], -0.05, -3.8, 2.2);
    expect(bathHit.z).toBeGreaterThan(-3.35);

    // Doorway auto-barge across bilaterally symmetric Hall doors, direct Cloakroom WC door & twin rear French doors
    const hallToDrawing = rig.teleportAndWalk([-0.6, 0, 3.52], -2.6, 3.52, 2.5);
    expect(hallToDrawing.x).toBeLessThan(-2.15);
    const hallToKitchen = rig.teleportAndWalk([0.6, 0, 3.52], 2.6, 3.52, 2.5);
    expect(hallToKitchen.x).toBeGreaterThan(2.15);
    const hallToDirectWc = rig.teleportAndWalk([0.32, 0, -0.95], 0.32, -2.55, 2.5);
    expect(hallToDirectWc.z).toBeLessThan(-2.05);
    const kitchenFrenchOut = rig.teleportAndWalk([5.35, 0, -3.2], 5.35, -5.6, 3.2);
    expect(kitchenFrenchOut.z).toBeLessThan(-5.0);
    const drawingFrenchOut = rig.teleportAndWalk([-5.35, 0, -3.2], -5.35, -5.6, 3.2);
    expect(drawingFrenchOut.z).toBeLessThan(-5.0);

    const landingToPrincipal = rig.teleportAndWalk([-0.6, 3.05, 3.48], -2.6, 3.48, 2.5);
    expect(landingToPrincipal.x).toBeLessThan(-2.15);
    const landingToGuest = rig.teleportAndWalk([-0.3, 3.05, 3.48], 2.6, 3.48, 3.2);
    expect(landingToGuest.x).toBeGreaterThan(2.15);
    const landingToStudy = rig.teleportAndWalk([0.6, 3.05, -0.84], 2.5, -0.84, 2.5);
    expect(landingToStudy.x).toBeGreaterThan(2.1);
    const landingToBath = rig.teleportAndWalk([-1.05, 3.05, -0.95], -1.05, -2.45, 2.5);
    expect(landingToBath.z).toBeLessThan(-2.0);

    // Full Staircase Ascent & Descent + Fitted Under-Stairs Cupboard / Landing Balustrade Guarding
    // Side of under-stairs spandrel/balustrade (X = 0.53) from Hall is blocked
    const stairSideBlocked = rig.teleportAndWalk([-0.4, 0, 1.2], 1.09, 1.2, 2.0);
    expect(stairSideBlocked.x).toBeLessThan(0.54);

    // Ascend from houseHall [1.09, 0, 3.35] all the way up simpleHouse.stair (STAIR_WIDTH_M = 1.12) to houseLanding (Y = 3.05)
    rig.teleportAndWalk([1.09, 0, 3.35], 1.09, 3.1, 0.5);
    let prevY = rig.walkthrough.getFootPosition().y;
    const dt = 1 / 60;
    (rig.walkthrough as unknown as { yawRad: number; targetYawRad: number }).yawRad = 0;
    (rig.walkthrough as unknown as { yawRad: number; targetYawRad: number }).targetYawRad = 0;
    rig.walkthrough.setTouchMoveVector(0, 1, false);
    for (let i = 0; i < 240; i++) {
      rig.interactions.update(dt);
      rig.scene.updateMatrixWorld(true);
      rig.walkthrough.update(dt);
      const cur = rig.walkthrough.getFootPosition();
      expect(cur.y).toBeGreaterThanOrEqual(prevY - 1e-3);
      prevY = cur.y;
      if (cur.z <= -0.95) break;
    }
    rig.walkthrough.setTouchMoveVector(0, 0, false);
    for (let s = 0; s < 18; s++) {
      rig.interactions.update(dt);
      rig.scene.updateMatrixWorld(true);
      rig.walkthrough.update(dt);
    }
    const atTopLanding = rig.walkthrough.getFootPosition().clone();
    expect(atTopLanding.z).toBeLessThan(-0.75);
    expect(Math.abs(atTopLanding.y - 3.05)).toBeLessThan(0.02);

    // First-floor landingGuard (X = 0.475, Z = 2.62) MUST be visible & block walking East/North into the stairwell void!
    const guardObj = rig.scene.getObjectByName('simpleHouse.landingGuard');
    expect(guardObj?.visible ?? true).toBe(true);
    const guardWestBlocked = rig.teleportAndWalk([-0.4, 3.05, 1.0], 1.09, 1.0, 2.2);
    expect(guardWestBlocked.x).toBeLessThan(0.49);
    const guardSouthBlocked = rig.teleportAndWalk([1.0, 3.05, 3.2], 1.0, 2.0, 2.2);
    expect(guardSouthBlocked.z).toBeGreaterThan(2.62);

    // Mid-stair open West balustrade MUST block walking sideways off the stairs into houseHall!
    rig.teleportAndWalk([1.09, 0, 3.35], 1.09, 1.2, 2.5);
    const midStair = rig.walkthrough.getFootPosition().clone();
    expect(midStair.y).toBeGreaterThan(1.1);
    const offStairAttempt = rig.walkTowards(-0.4, midStair.z, 1.8);
    expect(offStairAttempt.x).toBeGreaterThan(0.53);

    // Descend from houseLanding [1.09, 3.05, -0.95] smoothly back down to houseHall [1.09, 0, 3.35]
    const backInHall = rig.teleportAndWalk([1.09, 3.05, -0.95], 1.09, 3.35, 4.5);
    expect(backInHall.z).toBeGreaterThan(3.15);
    expect(Math.abs(backInHall.y - 0.0)).toBeLessThan(0.02);
  }, 60_000);

  it('simple-flat: blocks extruded walls & furniture and auto-barges all apartment doors post-batch', () => {
    const rig = buildPostBatchWalkthroughRig(simpleFlat);

    // Extruded perimeter & spine partition walls (BufferGeometry from extrudePlanarSolidWithHoles)
    const eastExt = rig.teleportAndWalk([3.3, 0, 0.0], 5.0, 0.0, 2.2);
    expect(eastExt.x).toBeLessThan(4.2);
    const spineWall = rig.teleportAndWalk([-1.4, 0, -0.4], 0.5, -0.4, 2.2);
    expect(spineWall.x).toBeLessThan(-0.6);

    // Kitchen worktop/carcass ([2.1, 0, -3.04]), sofa ([2.35, 0, 1.35]), dining table ([0.65, 0, -0.55]), bed ([-3.1, 0, -1.35]), wardrobe ([-3.1, 0, -3.0])
    const flatKitchen = rig.teleportAndWalk([2.1, 0, -1.8], 2.1, -3.1, 2.2);
    expect(flatKitchen.z).toBeGreaterThan(-2.75);
    const flatSofa = rig.teleportAndWalk([2.35, 0, 0.2], 2.35, 1.45, 2.2);
    expect(flatSofa.z).toBeLessThan(1.0);
    const flatDining = rig.teleportAndWalk([0.65, 0, 0.8], 0.65, -0.55, 2.2);
    expect(flatDining.z).toBeGreaterThan(-0.05);
    const flatBed = rig.teleportAndWalk([-1.5, 0, -1.35], -3.5, -1.35, 2.2);
    expect(flatBed.x).toBeGreaterThan(-2.3);
    const flatWardrobe = rig.teleportAndWalk([-1.5, 0, -2.5], -1.5, -3.2, 1.0);
    expect(flatWardrobe.z).toBeGreaterThan(-3.4);

    // Doorways: Hall -> Living (open doorway in spine at Z = 1.95), Hall -> Bedroom ([-1.325, 1.1]), Hall -> Bathroom ([-2.2, 1.825])
    const hallToLiving = rig.teleportAndWalk([-1.3, 0, 1.95], 0.5, 1.95, 2.5);
    expect(hallToLiving.x).toBeGreaterThan(0.1);
    const hallToBed = rig.teleportAndWalk([-1.325, 0, 1.9], -1.325, 0.2, 2.5);
    expect(hallToBed.z).toBeLessThan(0.55);
    const hallToBath = rig.teleportAndWalk([-1.4, 0, 1.825], -3.0, 1.825, 2.5);
    expect(hallToBath.x).toBeLessThan(-2.55);
  }, 20_000);

  it('stahl-house: blocks glass curtain walls, Koenig fireplace & island, and slides Arcadia glass doors open', () => {
    const rig = buildPostBatchWalkthroughRig(stahlHouse);

    // Fixed curtain-wall glass on East panoramic elevation (X = 3.05) MUST block walking off the cliff!
    const eastGlass = rig.teleportAndWalk([1.8, 0, 2.5], 4.0, 2.5, 2.2);
    expect(eastGlass.x).toBeLessThan(3.05);

    // Koenig double-sided fireplace hearth plinth ([0.0, 0, 2.1])
    const fireplaceHit = rig.teleportAndWalk([0.0, 0, 3.8], 0.0, 2.1, 2.2);
    expect(fireplaceHit.z).toBeGreaterThan(2.55);

    // Arcadia linear sliding glass door from Living Room West onto Pool Terrace (Z = 1.52, X = -3.05 -> -4.4)
    const sliderOut = rig.teleportAndWalk([-1.8, 0, 1.52], -4.4, 1.52, 3.0);
    expect(sliderOut.x).toBeLessThan(-3.8);
  }, 20_000);
});
