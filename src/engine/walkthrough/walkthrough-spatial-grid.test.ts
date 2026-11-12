import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WalkthroughDoorBargeAndCollisionSolver } from './parts/walkthrough-door-barge.ts';
import {
  DEFAULT_WALKTHROUGH_FOV,
  SPRINT_FOV_BOOST,
  STANDING_EYE_HEIGHT,
  WALKTHROUGH_FOV_PRESETS,
  loadWalkthroughSessionFromStorage,
} from './parts/walkthrough-spawns.ts';

describe('WalkthroughDoorBargeAndCollisionSolver 2m spatial hash grid', () => {
  it('indexes static walls & furniture into 2m cells, skips merged/ground/foliage vertex scans, and preserves collision & depenetration', () => {
    const scene = new THREE.Scene();

    // Wall blocking +X movement at x = 1.25 (inside room walkable bounds [-3..+3, -3..+3])
    const wallMat = new THREE.MeshStandardMaterial();
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.4, 3.0), wallMat);
    wall.userData = { isArchitecturalShell: true };
    wall.position.set(1.25, 1.2, 0);
    scene.add(wall);

    // Table OBB at (-1.5, 0.45, 0) for depenetration + furniture collision
    const table = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.78, 0.8), wallMat);
    table.position.set(-1.5, 0.39, 0);
    scene.add(table);

    // Merged source mesh + exterior terrain + decorative foliage subtree that must be skipped without scanning vertices
    const unindexedGeo = new THREE.BufferGeometry();
    let computeBbCalled = false;
    unindexedGeo.computeBoundingBox = () => {
      computeBbCalled = true;
      unindexedGeo.boundingBox = new THREE.Box3(
        new THREE.Vector3(-1, -1, -1),
        new THREE.Vector3(1, 1, 1)
      );
    };
    const mergedSource = new THREE.Mesh(unindexedGeo, wallMat);
    mergedSource.userData = { isMergedSourceMesh: true };
    scene.add(mergedSource);

    const foliageGroup = new THREE.Group();
    foliageGroup.name = 'garden.oliveTree';
    const foliageLeaf = new THREE.Mesh(unindexedGeo, wallMat);
    foliageGroup.add(foliageLeaf);
    scene.add(foliageGroup);

    const groundMesh = new THREE.Mesh(unindexedGeo, wallMat);
    groundMesh.userData = { isEnvironmentGround: true };
    scene.add(groundMesh);

    const solver = new WalkthroughDoorBargeAndCollisionSolver({
      scene,
      onBargeWalkthroughDoor: () => false,
      onProximityBargeDoors: () => false,
      onDoorBarged: () => {},
    });

    solver.captureFurnitureColliders();
    expect(computeBbCalled).toBe(false);

    const stats = solver.getSpatialGridStats();
    expect(stats.obstacleCount).toBeGreaterThanOrEqual(2);
    expect(stats.furnitureCount).toBe(1);
    expect(stats.obstacleCells).toBeGreaterThan(0);
    expect(stats.furnitureCells).toBeGreaterThan(0);

    // Approaching wall at x = 1.25 from x = 0.95 along +X is blocked
    const nearWallFoot = new THREE.Vector3(0.95, 0, 0);
    const blockedByWall = solver.isBlockedByWallOrCabinet(
      nearWallFoot,
      new THREE.Vector3(1, 0, 0),
      0.18,
      1.65,
      false,
      false
    );
    expect(blockedByWall).toBe(true);

    // Walking into open space along -Z at (0, 0, 0) is unblocked
    const openStepBlocked = solver.isBlockedByWallOrCabinet(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -1),
      0.18,
      1.65,
      false,
      false
    );
    expect(openStepBlocked).toBe(false);

    // Foot placed inside table margin is depenetrated outside the 0.2m furniture pad
    const insideTableFoot = new THREE.Vector3(-0.92, 0, 0);
    solver.depenetrateFootPosition(insideTableFoot, 1.65);
    expect(insideTableFoot.x).toBeGreaterThan(-0.82);
  });
  it("pre-builds FlatTriangleBvh on high-poly obstacle meshes (>= 64 triangles) during captureFurnitureColliders", () => {
    const scene = new THREE.Scene();
    const wallMat = new THREE.MeshStandardMaterial();
    const highPolyWall = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 2.2, 48, 4), wallMat);
    highPolyWall.userData = { isArchitecturalShell: true };
    highPolyWall.position.set(1.0, 1.1, 0);
    scene.add(highPolyWall);

    const solver = new WalkthroughDoorBargeAndCollisionSolver({
      scene,
      onBargeWalkthroughDoor: () => false,
      onProximityBargeDoors: () => false,
      onDoorBarged: () => {},
    });
    solver.captureFurnitureColliders();

    expect((highPolyWall.raycast as unknown as { __isBvhRaycast?: boolean }).__isBvhRaycast).toBe(true);

    const foot = new THREE.Vector3(0.35, 0, 0);
    const dir = new THREE.Vector3(1, 0, 0);
    const t0 = performance.now();
    for (let i = 0; i < 180; i++) {
      solver.isBlockedByWallOrCabinet(foot, dir, 0.35, 1.65, false, false);
    }
    const avgMs = (performance.now() - t0) / 180;
    expect(avgMs).toBeLessThan(0.25);
  });

  it('calibrates 5\'10" (1.67 m) standing eye height, 62° natural vFOV presets, overhead cottage beam clearance, and surveyed floor elevations', () => {
    expect(STANDING_EYE_HEIGHT).toBe(1.67);
    expect(DEFAULT_WALKTHROUGH_FOV).toBe(62);
    expect(WALKTHROUGH_FOV_PRESETS).toEqual([58, 62, 72]);
    expect(SPRINT_FOV_BOOST).toBe(4);

    // Stale 78° / 90° sessionStorage sessions fall back cleanly to 62° while valid presets persist
    const prevStorage = (globalThis as Record<string, unknown>).sessionStorage;
    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>).sessionStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    };
    try {
      store.set(
        'husjs_walkthrough_state_v1',
        JSON.stringify({ active: true, footPos: [0, 0, 0], yawRad: 0, pitchRad: 0, crouched: false, baseFov: 78 })
      );
      expect(loadWalkthroughSessionFromStorage()?.baseFov).toBe(62);

      store.set(
        'husjs_walkthrough_state_v1',
        JSON.stringify({ active: true, footPos: [0, 0, 0], yawRad: 0, pitchRad: 0, crouched: false, baseFov: 58 })
      );
      expect(loadWalkthroughSessionFromStorage()?.baseFov).toBe(58);
    } finally {
      (globalThis as Record<string, unknown>).sessionStorage = prevStorage;
    }

    // Overhead cottage beams (1.852m Dining spine beam above 0.000m FFL; 1.405m Entrance Hall upper soffit above -0.495m FFL)
    // must NOT block 1.67m standing eye height (1.778m crown)
    const beamScene = new THREE.Scene();
    const beamMat = new THREE.MeshStandardMaterial();
    const diningSpineBeam = new THREE.Mesh(new THREE.BoxGeometry(3.22, 0.216, 0.2), beamMat);
    diningSpineBeam.userData = { isArchitecturalShell: true };
    diningSpineBeam.position.set(0, 1.852 + 0.216 / 2, -0.85);
    beamScene.add(diningSpineBeam);

    const hallSoffit = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.2, 1.0), beamMat);
    hallSoffit.userData = { isArchitecturalShell: true };
    hallSoffit.position.set(2.0, 1.405 + 0.1, -0.85);
    beamScene.add(hallSoffit);

    const beamSolver = new WalkthroughDoorBargeAndCollisionSolver({
      scene: beamScene,
      onBargeWalkthroughDoor: () => false,
      onProximityBargeDoors: () => false,
      onDoorBarged: () => {},
    });
    beamSolver.captureFurnitureColliders();

    expect(
      beamSolver.isBlockedByWallOrCabinet(
        new THREE.Vector3(0, 0, -0.45),
        new THREE.Vector3(0, 0, -1),
        0.5,
        STANDING_EYE_HEIGHT,
        false,
        false
      )
    ).toBe(false);
    expect(
      beamSolver.isBlockedByWallOrCabinet(
        new THREE.Vector3(2.0, -0.495, -0.2),
        new THREE.Vector3(0, 0, -1),
        0.5,
        STANDING_EYE_HEIGHT,
        false,
        false
      )
    ).toBe(false);
  });
});
