import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { CutawayWallDescriptor } from '../../core/types/scene.ts';
import { InteractionRegistry } from '../interaction/interaction-registry.ts';
import {
  registerHingedDoor,
  registerSlidingDrawer,
  tagCollisionRole,
  tagCutaway,
  tagDynamicBatch,
  tagHighLod,
} from './mesh-traits.ts';

describe('mesh-traits', () => {
  it('tags cutaway walls recursively by default and supports { recursive: false } opt-out', () => {
    const desc: CutawayWallDescriptor = {
      axis: 'z',
      coord: 2.68,
      minSpan: -16.92,
      maxSpan: -6.4,
      floor: 'ground',
      outwardSide: 'south',
    };

    const group = new THREE.Group();
    const childMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    group.add(childMesh);

    expect(tagCutaway(group, desc)).toBe(group);
    expect(group.userData.isCutawayWall).toBe(true);
    expect(group.userData.cutawayWall).toEqual(desc);
    expect(childMesh.userData.isCutawayWall).toBe(true);
    expect(childMesh.userData.cutawayWall).toEqual(desc);

    const nonRecGroup = new THREE.Group();
    const nonRecChild = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    nonRecGroup.add(nonRecChild);
    expect(tagCutaway(nonRecGroup, desc, { recursive: false })).toBe(nonRecGroup);
    expect(nonRecGroup.userData.isCutawayWall).toBe(true);
    expect(nonRecGroup.userData.cutawayWall).toEqual(desc);
    expect(nonRecChild.userData.isCutawayWall).toBeUndefined();
  });

  it('applies collision roles recursively by default and clears conflicting role flags', () => {
    const group = new THREE.Group();
    const rungMesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.05));
    group.add(rungMesh);

    expect(tagCollisionRole(group, 'ignore')).toBe(group);
    expect(group.userData.ignoreWalkthroughCollision).toBe(true);
    expect(rungMesh.userData.ignoreWalkthroughCollision).toBe(true);

    tagCollisionRole(group, 'solidPlane');
    expect(group.userData.ignoreWalkthroughCollision).toBeUndefined();
    expect(group.userData.isWalkthroughSolidPlane).toBe(true);
    expect(rungMesh.userData.ignoreWalkthroughCollision).toBeUndefined();
    expect(rungMesh.userData.isWalkthroughSolidPlane).toBe(true);

    tagCollisionRole(group, 'climbable');
    expect(group.userData.isWalkthroughSolidPlane).toBeUndefined();
    expect(group.userData.isClimbableLadder).toBe(true);
    expect(rungMesh.userData.isWalkthroughSolidPlane).toBeUndefined();
    expect(rungMesh.userData.isClimbableLadder).toBe(true);
  });

  it('tags dynamic batch exclusion and restores matrixAutoUpdate across subtree', () => {
    const group = new THREE.Group();
    group.matrixAutoUpdate = false;
    const leafMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5));
    leafMesh.matrixAutoUpdate = false;
    group.add(leafMesh);

    expect(tagDynamicBatch(group)).toBe(group);
    expect(group.userData.isDynamicBatchExcluded).toBe(true);
    expect(group.matrixAutoUpdate).toBe(true);
    expect(leafMesh.userData.isDynamicBatchExcluded).toBe(true);
    expect(leafMesh.matrixAutoUpdate).toBe(true);
  });

  it('matches scene-helpers tagHighLod semantics 100%', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1));
    expect(tagHighLod(mesh)).toBe(mesh);
    expect(mesh.userData.lodTier).toBe('high');
    expect(mesh.userData.lodMaxDistance).toBe(12);

    tagHighLod(mesh, 7.5);
    expect(mesh.userData.lodMaxDistance).toBe(7.5);
  });

  it('registers hinged doors and sliding drawers via both SceneBuilderContext-like and direct InteractionRegistry signatures', () => {
    const interactiveMeshes: THREE.Object3D[] = [];
    const registry = new InteractionRegistry(interactiveMeshes);
    const ctxLike = { interactions: registry };

    const roomGroup = new THREE.Group();
    const doorMeshA = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.0, 0.04));
    doorMeshA.name = 'hall.oakDoorA';
    doorMeshA.position.set(1.0, 1.0, 0);
    roomGroup.add(doorMeshA);

    const pivotA = registerHingedDoor(ctxLike, {
      parent: roomGroup,
      door: doorMeshA,
      hingeOffset: [-0.4, 0, 0],
      axis: 'y',
      openAngle: Math.PI / 2,
    });
    expect(pivotA.userData.doorRole).toBe('pivot');
    expect(interactiveMeshes).toContain(doorMeshA);

    const doorMeshB = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.0, 0.04));
    doorMeshB.name = 'hall.oakDoorB';
    doorMeshB.position.set(2.5, 1.0, 0);
    roomGroup.add(doorMeshB);

    const pivotB = registerHingedDoor(
      registry,
      roomGroup,
      doorMeshB,
      new THREE.Vector3(0.4, 0, 0),
      'y',
      -Math.PI / 2,
      0.1
    );
    expect(pivotB.rotation.y).toBeCloseTo(0.1, 6);

    // Clicking door A toggles open state and animates pivot rotation
    const doorAId = doorMeshA.userData.interactableId as string;
    expect(registry.handleInteractableClick(doorAId)).toBe(true);
    registry.update(1.0);
    expect(pivotA.rotation.y).toBeGreaterThan(0.5);

    // Sliding drawers (options & positional)
    const drawerA = new THREE.Group();
    drawerA.name = 'kitchen.islandDrawerA';
    const drawerFrontA = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.02));
    drawerA.add(drawerFrontA);
    roomGroup.add(drawerA);

    expect(
      registerSlidingDrawer(ctxLike, {
        drawer: drawerA,
        slideDelta: [0, 0, 0.45],
      })
    ).toBe(drawerA);

    const drawerB = new THREE.Group();
    drawerB.name = 'kitchen.islandDrawerB';
    const drawerFrontB = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.02));
    drawerB.add(drawerFrontB);
    roomGroup.add(drawerB);

    expect(registerSlidingDrawer(registry, drawerB, new THREE.Vector3(0, 0, 0.35))).toBe(drawerB);

    const drawerAId = drawerA.userData.interactableId as string;
    expect(registry.handleInteractableClick(drawerAId)).toBe(true);
    registry.update(1.0);
    expect(drawerA.position.z).toBeGreaterThan(0.2);
  });
});
