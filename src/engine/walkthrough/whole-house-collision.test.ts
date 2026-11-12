import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { InteractionRegistry } from '../interaction/interaction-registry.ts';
import { RoomLodController } from '../lod/lod-manager.ts';
import { SceneBatchOptimizer } from '../rendering/scene-batch-optimizer.ts';
import { createPropertySceneLayers } from '../viewer/scene-content.ts';
import { WalkthroughDoorBargeAndCollisionSolver } from './parts/walkthrough-door-barge.ts';
import { STANDING_EYE_HEIGHT } from './parts/walkthrough-spawns.ts';

type OptimizerDeps = ConstructorParameters<typeof SceneBatchOptimizer>[0];

describe('Engine Post-Batch 1PV Collisions & Auto-Barge', () => {
  it('preserves raycast & furniture OBB colliders across SceneBatchOptimizer empty-group pruning while honouring explicit ancestor hides', () => {
    const layers = createPropertySceneLayers(new THREE.Scene());
    const { scene } = layers;
    const roomGroup = new THREE.Group();
    roomGroup.name = 'testRoom';
    layers.firstFloorMeshGroup.add(roomGroup);

    const mat = new THREE.MeshStandardMaterial({ color: 0x888888 });
    const wallA = new THREE.Mesh(new THREE.BoxGeometry(0.24, 2.4, 2.0), mat);
    wallA.name = 'testRoom.wallA';
    wallA.userData = { isArchitecturalShell: true };
    wallA.position.set(1.2, 1.2, 0);
    roomGroup.add(wallA);

    const wallB = new THREE.Mesh(new THREE.BoxGeometry(0.24, 2.4, 2.0), mat);
    wallB.name = 'testRoom.wallB';
    wallB.userData = { isArchitecturalShell: true };
    wallB.position.set(1.2, 1.2, 2.2);
    roomGroup.add(wallB);

    const sofaGroup = new THREE.Group();
    sofaGroup.name = 'testRoom.sofa';
    const sofaA = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.78, 0.9), mat);
    sofaA.position.set(-1.2, 0.39, 0);
    const sofaB = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.78, 0.9), mat);
    sofaB.position.set(-1.2, 0.39, 1.0);
    // Tiny decorative ConeGeometry finial inside the room must NOT inflate to a 2m x 2m cylinder
    const tinyCone = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.03, 12), mat);
    tinyCone.position.set(0, 0.95, 0);
    sofaGroup.add(sofaA, sofaB, tinyCone);
    roomGroup.add(sofaGroup);

    scene.updateMatrixWorld(true);

    const solver = new WalkthroughDoorBargeAndCollisionSolver({
      scene,
      onBargeWalkthroughDoor: () => false,
      onProximityBargeDoors: () => false,
      onDoorBarged: () => {},
    });
    expect(
      solver.isBlockedByWallOrCabinet(
        new THREE.Vector3(0.75, 0, 0),
        new THREE.Vector3(1, 0, 0),
        0.35,
        STANDING_EYE_HEIGHT,
        false,
        false
      )
    ).toBe(true);

    const lodController = new RoomLodController([]);
    const optimizer = new SceneBatchOptimizer({
      layers,
      lodController,
      interactiveMeshes: [],
      bifoldPanels: [],
      lightGroups: {} as OptimizerDeps['lightGroups'],
      indicatorMats: {} as OptimizerDeps['indicatorMats'],
      roomSwitchLedMats: [],
      getDynamicObjects: () => new Set<THREE.Object3D>(),
    });
    optimizer.optimize();
    scene.updateMatrixWorld(true);

    // Emptied groups were pruned by SceneBatchOptimizer, yet colliders stay 100% active
    expect(
      solver.isBlockedByWallOrCabinet(
        new THREE.Vector3(0.75, 0, 0),
        new THREE.Vector3(1, 0, 0),
        0.35,
        STANDING_EYE_HEIGHT,
        false,
        false
      )
    ).toBe(true);
    expect(
      solver.isBlockedByWallOrCabinet(
        new THREE.Vector3(-0.55, 0, 0),
        new THREE.Vector3(-1, 0, 0),
        0.35,
        STANDING_EYE_HEIGHT,
        false,
        false
      )
    ).toBe(true);
    // Tiny ConeGeometry at origin did not create a false 2m x 2m furniture OBB
    expect(
      solver.isBlockedByWallOrCabinet(
        new THREE.Vector3(0, 0, -0.5),
        new THREE.Vector3(0, 0, 1),
        0.35,
        STANDING_EYE_HEIGHT,
        false,
        false
      )
    ).toBe(false);

    // Explicit cutaway / visibility hide on an ancestor still disables colliders cleanly
    layers.firstFloorMeshGroup.visible = false;
    expect(
      solver.isBlockedByWallOrCabinet(
        new THREE.Vector3(0.75, 0, 0),
        new THREE.Vector3(1, 0, 0),
        0.35,
        STANDING_EYE_HEIGHT,
        false,
        false
      )
    ).toBe(false);
  });

  it('auto-barges closed walkthrough doors at normal walking speed (isSprinting = false)', () => {
    const scene = new THREE.Scene();
    const interactiveMeshes: THREE.Object3D[] = [];
    const interactions = new InteractionRegistry(interactiveMeshes);
    const mat = new THREE.MeshStandardMaterial({ color: 0x665544 });

    const doorGroup = new THREE.Group();
    doorGroup.name = 'testDoor.leaf';
    doorGroup.position.set(0, 1.02, 0);
    const doorPanel = new THREE.Mesh(new THREE.BoxGeometry(0.84, 2.04, 0.044), mat);
    doorPanel.name = 'interiorDoor.recessCore';
    doorGroup.add(doorPanel);
    scene.add(doorGroup);

    const pivot = interactions.registerHingedDoor(
      scene,
      doorGroup,
      new THREE.Vector3(-0.42, 0, 0),
      'y',
      -Math.PI * 0.48,
      0
    );
    pivot.name = 'testDoor.pivot';
    scene.updateMatrixWorld(true);

    const solver = new WalkthroughDoorBargeAndCollisionSolver({
      scene,
      onBargeWalkthroughDoor: (id, isSprinting, fx, fy, fz, dx, dz) =>
        interactions.bargeOpenWalkthroughDoor(id, isSprinting, fx, fy, fz, dx, dz),
      onProximityBargeDoors: (fx, fy, fz, dx, dz, isSprinting) =>
        interactions.bargeNearbyWalkthroughDoors(fx, fy, fz, dx, dz, isSprinting),
      onDoorBarged: () => {},
    });
    const foot = new THREE.Vector3(0, 0, 0.85);
    const moveDir = new THREE.Vector3(0, 0, -1);

    for (let step = 0; step < 90; step++) {
      interactions.update(1 / 60);
      const blocked = solver.isBlockedByWallOrCabinet(
        foot,
        moveDir,
        0.045,
        STANDING_EYE_HEIGHT,
        true,
        false
      );
      if (!blocked) {
        foot.addScaledVector(moveDir, 0.045);
      }
    }

    expect(foot.z).toBeLessThan(-0.35);
  });
});
