import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { RoomZoneLodRegistration } from '../../core/entities.ts';
import { RoomLodController } from './lod-manager.ts';
import { PortalVisibilitySolver } from './portal-visibility-solver.ts';

const TEST_ROOMS: readonly RoomZoneLodRegistration[] = [
  {
    zoneId: 'kitchen',
    shortName: 'Kitchen',
    floorId: 'ground',
    bounds: { minX: -4, maxX: 2, minY: 0, maxY: 2.7, minZ: -3, maxZ: 3 },
  },
  {
    zoneId: 'utility',
    shortName: 'Utility',
    floorId: 'ground',
    bounds: { minX: 2, maxX: 6, minY: 0, maxY: 2.7, minZ: -3, maxZ: 3 },
  },
  {
    zoneId: 'familyRoom',
    shortName: 'Dining',
    floorId: 'ground',
    bounds: { minX: -10, maxX: -4, minY: 0, maxY: 2.7, minZ: -3, maxZ: 3 },
  },
  {
    zoneId: 'bedroom2',
    shortName: 'Bed 2',
    floorId: 'first',
    bounds: { minX: -23, maxX: -19, minY: 2.7, maxY: 5.4, minZ: -3, maxZ: 2 },
  },
  {
    zoneId: 'outbuildingGym',
    shortName: 'Gym',
    floorId: 'ground',
    bounds: { minX: -20, maxX: -16, minY: 0, maxY: 2.7, minZ: 15, maxZ: 20 },
  },
];

function makeCamera(
  pos: [number, number, number],
  lookAt: [number, number, number]
): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 200);
  cam.position.set(pos[0], pos[1], pos[2]);
  cam.up.set(0, 1, 0);
  cam.updateMatrixWorld(true);
  cam.lookAt(lookAt[0], lookAt[1], lookAt[2]);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

describe('PortalVisibilitySolver', () => {
  it('keeps 100% of rooms visible in ground/first cutaway modes and culls occluded rooms in all mode with zero shadow rebuilds', () => {
    let utilityDoorOpen = false;
    const solver = new PortalVisibilitySolver({
      rooms: TEST_ROOMS,
      exteriorPortals: [
        {
          id: 'kitchen-south-window',
          roomZoneId: 'kitchen',
          minX: -2.0,
          maxX: 1.0,
          minY: 0.8,
          maxY: 2.2,
          minZ: 2.8,
          maxZ: 3.3,
          centerX: -0.5,
          centerY: 1.5,
          centerZ: 3.0,
          outwardNx: 0,
          outwardNy: 0,
          outwardNz: 1,
        },
        {
          id: 'gym-north-glazed-screen',
          roomZoneId: 'outbuildingGym',
          minX: -19.5,
          maxX: -16.5,
          minY: 0.1,
          maxY: 2.2,
          minZ: 14.8,
          maxZ: 15.2,
          centerX: -18.0,
          centerY: 1.15,
          centerZ: 15.0,
          outwardNx: 0,
          outwardNy: 0,
          outwardNz: -1,
        },
      ],
      interiorPortals: [
        {
          id: 'kitchen-familyRoom-arch',
          roomA: 'kitchen',
          roomB: 'familyRoom',
          minX: -4.25,
          maxX: -3.75,
          minY: 0.0,
          maxY: 2.2,
          minZ: -1.0,
          maxZ: 1.5,
          alwaysOpenOrGlazed: true,
        },
        {
          id: 'kitchen-utility-door',
          roomA: 'kitchen',
          roomB: 'utility',
          minX: 1.75,
          maxX: 2.25,
          minY: 0.0,
          maxY: 2.1,
          minZ: -0.6,
          maxZ: 0.6,
          alwaysOpenOrGlazed: false,
          isActive: () => utilityDoorOpen,
        },
      ],
    });

    // Cutaway dollhouse modes ('ground' & 'first') keep all rooms visible
    const extCam = makeCamera([-1, 2.2, 11], [-2.5, 1.3, 0]);
    solver.solveVisibleInteriorRooms(extCam, 'ground');
    expect(solver.isRoomVisible('kitchen')).toBe(true);
    expect(solver.isRoomVisible('utility')).toBe(true);
    expect(solver.isRoomVisible('bedroom2')).toBe(true);

    // Exterior Case A ('all'): perpendicular south patio view sees Kitchen through south window,
    // while familyRoom (off-angle behind solid brick wall), utility (closed door), and bedroom2 are culled!
    solver.solveVisibleInteriorRooms(extCam, 'all');
    expect(solver.isRoomVisible('kitchen')).toBe(true);
    expect(solver.isRoomVisible('familyRoom')).toBe(false);
    expect(solver.isRoomVisible('utility')).toBe(false);
    expect(solver.isRoomVisible('bedroom2')).toBe(false);

    // Angled south-east patio view looking WNW through Kitchen south window straight through kitchen-familyRoom-arch
    // propagates 1 hop into familyRoom!
    const angledToFamilyCam = makeCamera([1.8, 1.6, 7.5], [-4.0, 1.3, 0.5]);
    solver.solveVisibleInteriorRooms(angledToFamilyCam, 'all');
    expect(solver.isRoomVisible('kitchen')).toBe(true);
    expect(solver.isRoomVisible('familyRoom')).toBe(true);

    // Opening the Kitchen <-> Utility door makes Utility visible from the angled exterior sightline!
    const angledExtCam = makeCamera([-2.5, 1.5, 8], [2.5, 1.2, 0]);
    solver.solveVisibleInteriorRooms(angledExtCam, 'all');
    expect(solver.isRoomVisible('utility')).toBe(false);
    utilityDoorOpen = true;
    solver.solveVisibleInteriorRooms(angledExtCam, 'all');
    expect(solver.isRoomVisible('utility')).toBe(true);

    // Interior Case B (first-person inside Kitchen looking east toward Utility door):
    utilityDoorOpen = false;
    const walkCamEast = makeCamera([0, 1.6, 0], [4, 1.5, 0]);
    solver.solveVisibleInteriorRooms(walkCamEast, 'all');
    expect(solver.isRoomVisible('kitchen')).toBe(true);
    expect(solver.isRoomVisible('utility')).toBe(false);
    expect(solver.isRoomVisible('familyRoom')).toBe(false);

    // Opening Utility door immediately reveals Utility in first-person
    utilityDoorOpen = true;
    solver.solveVisibleInteriorRooms(walkCamEast, 'all');
    expect(solver.isRoomVisible('utility')).toBe(true);

    // 1-hop Exterior Courtyard Re-Entry: looking out Kitchen south window toward Gym north glazed screen
    const walkCamToGym = makeCamera([-0.5, 1.6, 1.2], [-18.0, 1.2, 16.0]);
    solver.solveVisibleInteriorRooms(walkCamToGym, 'all');
    expect(solver.isRoomVisible('kitchen')).toBe(true);
    expect(solver.isRoomVisible('outbuildingGym')).toBe(true);
  });

  it('integrates with RoomLodController without dirtying shadow maps and yields portal-culled LOD1 casters for shadow passes', () => {
    const lod = new RoomLodController(TEST_ROOMS);
    const solver = new PortalVisibilitySolver({
      rooms: TEST_ROOMS,
      exteriorPortals: [
        {
          roomZoneId: 'kitchen',
          minX: -2,
          maxX: 1,
          minY: 0.8,
          maxY: 2.2,
          minZ: 2.8,
          maxZ: 3.2,
          centerX: -0.5,
          centerY: 1.5,
          centerZ: 3.0,
          outwardNx: 0,
          outwardNy: 0,
          outwardNz: 1,
        },
      ],
      interiorPortals: [],
    });
    lod.setPortalVisibilitySolver(solver);

    const kitchenTable = new THREE.Mesh(new THREE.BoxGeometry(1, 0.8, 1));
    kitchenTable.castShadow = true;
    const utilityWasher = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.85, 0.6));
    utilityWasher.castShadow = true;
    lod.registerObjectWithTier('kitchen', kitchenTable, 1);
    lod.registerObjectWithTier('utility', utilityWasher, 1);

    // Baseline all-visible evaluation
    lod.evaluateLod(new THREE.Vector3(0, 2, 10), new THREE.Vector3(0, 1, 0), 'all');
    expect(kitchenTable.visible).toBe(true);
    expect(utilityWasher.visible).toBe(true);

    // With camera supplied, PortalVisibilitySolver occludes Utility while keeping Kitchen visible,
    // and `didLastEvalChangeShadows()` MUST remain false (zero shadow-map rebuilds during orbit!)
    const cam = makeCamera([-0.5, 2.0, 10], [-0.5, 1.3, 0]);
    lod.evaluateLod(cam.position, new THREE.Vector3(-0.5, 1.3, 0), 'all', false, { camera: cam });
    expect(kitchenTable.visible).toBe(true);
    expect(utilityWasher.visible).toBe(false);
    expect(lod.didLastEvalChangeShadows()).toBe(false);

    const shadowRevealed: THREE.Object3D[] = [];
    lod.forEachPortalCulledObject((obj) => shadowRevealed.push(obj));
    expect(shadowRevealed).toContain(utilityWasher);
    expect(shadowRevealed).not.toContain(kitchenTable);
  });
});
