import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { RoomLodController } from '../../lod/lod-manager.ts';
import { createPropertySceneLayers } from '../../viewer/scene-content.ts';
import { collectProtectedObjects, isNonBatchableMaterial } from '../batching/scene-batch-classification.ts';
import {
  MirrorReflectorController,
  createMirrorMaterial,
  isLikelyMirrorGlassMesh,
  markMirrorSurface,
} from '../mirror-reflector-controller.ts';
import { SceneBatchOptimizer } from '../scene-batch-optimizer.ts';

function makeCamera(position: [number, number, number], lookAtTarget: [number, number, number]): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);
  cam.position.set(position[0], position[1], position[2]);
  cam.lookAt(lookAtTarget[0], lookAtTarget[1], lookAtTarget[2]);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  return cam;
}

describe('MirrorReflectorController & Mirror Batch Protection', () => {
  it('discovers marked, material-flagged, and convention-named mirror panes while excluding frames, clips, backing, and micro-strips', () => {
    const scene = new THREE.Scene();

    // Explicitly marked mesh
    const markedPane = markMirrorSurface(
      new THREE.Mesh(
        new THREE.PlaneGeometry(0.7, 1.0),
        new THREE.MeshStandardMaterial({ color: 0xeeeeee, metalness: 0.95, roughness: 0.02 })
      ),
      { zoneId: 'zone-bath' }
    );
    markedPane.name = 'vanity.customPane';
    scene.add(markedPane);

    // Mirror created with createMirrorMaterial
    const matMirror = new THREE.Mesh(
      new THREE.PlaneGeometry(0.6, 0.8),
      createMirrorMaterial({ name: 'guestBathMirrorMat' })
    );
    matMirror.name = 'guestBath.glass';
    scene.add(matMirror);

    // Convention-named mirror assembly with frame, backing, clips, and LED halo
    const mirrorAssembly = new THREE.Group();
    mirrorAssembly.name = 'dressing.wallMirror';
    mirrorAssembly.userData.zoneId = 'zone-dressing';
    const silverMat = new THREE.MeshStandardMaterial({
      name: 'silveredMirror',
      color: 0xf0f4f5,
      metalness: 0.96,
      roughness: 0.02,
    });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x8a6d3b, metalness: 0.8, roughness: 0.35 });

    const conventionPane = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 0.006), silverMat);
    conventionPane.name = 'dressing.mirrorGlass';
    conventionPane.position.z = 0.014;

    const backingBoard = new THREE.Mesh(new THREE.BoxGeometry(0.82, 1.22, 0.01), frameMat);
    backingBoard.name = 'dressing.backingBoard';
    backingBoard.position.z = 0.005;

    const brassFrame = new THREE.Mesh(new THREE.BoxGeometry(0.84, 1.24, 0.024), frameMat);
    brassFrame.name = 'dressing.brassFrame';

    const mountingClip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.01), silverMat);
    mountingClip.name = 'dressing.mirrorClip';

    const ledStrip = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.015, 0.01), silverMat);
    ledStrip.name = 'dressing.ledHaloStrip';

    // Narrow 5.6 cm decorative slat mirror strip (< 0.14 m min width threshold)
    const narrowSlatStrip = new THREE.Mesh(new THREE.BoxGeometry(0.056, 1.4, 0.01), silverMat);
    narrowSlatStrip.name = 'headerWall.mirrorGlass';

    mirrorAssembly.add(conventionPane, backingBoard, brassFrame, mountingClip, ledStrip, narrowSlatStrip);
    scene.add(mirrorAssembly);

    expect(isLikelyMirrorGlassMesh(markedPane)).toBe(true);
    expect(isLikelyMirrorGlassMesh(matMirror)).toBe(true);
    expect(isLikelyMirrorGlassMesh(conventionPane)).toBe(true);
    expect(isLikelyMirrorGlassMesh(backingBoard)).toBe(false);
    expect(isLikelyMirrorGlassMesh(brassFrame)).toBe(false);
    expect(isLikelyMirrorGlassMesh(mountingClip)).toBe(false);
    expect(isLikelyMirrorGlassMesh(ledStrip)).toBe(false);
    expect(isLikelyMirrorGlassMesh(narrowSlatStrip)).toBe(false);

    const controller = new MirrorReflectorController(scene, {
      isConstrainedMobile: false,
      graphicsTier: 'high',
    });
    expect(controller.discoverMirrors()).toBe(3);
    controller.dispose();
  });

  it('protects mirror panes from static geometry merging in collectProtectedObjects and SceneBatchOptimizer', () => {
    const scene = new THREE.Scene();
    const layers = createPropertySceneLayers(scene);
    const sharedSilverMat = createMirrorMaterial({ name: 'sharedMirrorGlass' });

    const roomGroup = new THREE.Group();
    roomGroup.name = 'bath.mirrors';
    scene.add(roomGroup);

    const mirrorA = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 0.006), sharedSilverMat);
    mirrorA.name = 'bath.mirrorA';
    mirrorA.position.set(-0.8, 1.4, 0);

    const mirrorB = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 0.006), sharedSilverMat);
    mirrorB.name = 'bath.mirrorB';
    mirrorB.position.set(0.8, 1.4, 0);

    const plainWallMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.7 });
    const trimA = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.05), plainWallMat);
    trimA.position.set(-1, 0.5, -1);
    const trimB = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.05), plainWallMat);
    trimB.position.set(1, 0.5, -1);

    roomGroup.add(mirrorA, mirrorB, trimA, trimB);
    scene.updateMatrixWorld(true);

    expect(isNonBatchableMaterial(sharedSilverMat, undefined)).toBe(true);

    const protectedSet = collectProtectedObjects(layers, [], () => new Set(), {});
    expect(protectedSet.has(mirrorA)).toBe(true);
    expect(protectedSet.has(mirrorB)).toBe(true);
    expect(protectedSet.has(trimA)).toBe(false);

    type OptimizerDeps = ConstructorParameters<typeof SceneBatchOptimizer>[0];
    const optimizer = new SceneBatchOptimizer({
      layers,
      lodController: new RoomLodController([]),
      interactiveMeshes: [],
      bifoldPanels: [],
      lightGroups: {} as OptimizerDeps['lightGroups'],
      indicatorMats: {} as OptimizerDeps['indicatorMats'],
      roomSwitchLedMats: [],
      getDynamicObjects: () => new Set(),
    });

    optimizer.optimize();

    // Both mirrorA and mirrorB remain unmerged individual THREE.Mesh nodes in the scene graph
    expect(mirrorA.parent).toBe(roomGroup);
    expect(mirrorB.parent).toBe(roomGroup);
    optimizer.unbatchAll();
  });

  it('computes accurate world outward normals (+Z target axis) and front-surface coplanar origins for PlaneGeometry, X-thin BoxGeometry, and tilted floor mirrors', () => {
    // Case A: PlaneGeometry facing +Z rotated by -90 deg around Y (world normal = -X)
    {
      const scene = new THREE.Scene();
      const planeMirror = markMirrorSurface(
        new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.1), createMirrorMaterial())
      );
      planeMirror.position.set(3.0, 1.4, 0);
      planeMirror.rotation.y = -Math.PI / 2;
      scene.add(planeMirror);

      const controller = new MirrorReflectorController(scene, {
        isConstrainedMobile: false,
        graphicsTier: 'high',
      });
      controller.discoverMirrors();

      const cam = makeCamera([1.2, 1.4, 0], [3.0, 1.4, 0]);
      controller.update(cam);

      expect(controller.getActiveMirrorCount()).toBe(1);
      const target = controller.getActiveReflectorTargets()[0]!;
      const zAxis = new THREE.Vector3().setFromMatrixColumn(target.matrixWorld, 2);
      const origin = new THREE.Vector3().setFromMatrixPosition(target.matrixWorld);

      expect(zAxis.x).toBeCloseTo(-1, 4);
      expect(zAxis.y).toBeCloseTo(0, 4);
      expect(zAxis.z).toBeCloseTo(0, 4);
      expect(origin.x).toBeCloseTo(3.0, 4);
      expect(origin.y).toBeCloseTo(1.4, 4);
      controller.dispose();
    }

    // Case B: Thin BoxGeometry(0.008, 0.9, 0.7) thin along local X with walnut backing behind -X
    {
      const scene = new THREE.Scene();
      const vanityGroup = new THREE.Group();
      vanityGroup.position.set(-4.0, 0, -2.0);
      const backing = new THREE.Mesh(
        new THREE.BoxGeometry(0.024, 0.94, 0.74),
        new THREE.MeshStandardMaterial({ color: 0x4a3525 })
      );
      backing.name = 'vanity.backingBoard';
      backing.position.set(0.012, 1.45, 0);

      const thinBoxMirror = new THREE.Mesh(
        new THREE.BoxGeometry(0.008, 0.9, 0.7),
        createMirrorMaterial()
      );
      thinBoxMirror.name = 'vanity.mirrorGlass';
      thinBoxMirror.position.set(0.030, 1.45, 0);
      vanityGroup.add(backing, thinBoxMirror);
      scene.add(vanityGroup);

      const controller = new MirrorReflectorController(scene, {
        isConstrainedMobile: false,
        graphicsTier: 'high',
      });
      controller.discoverMirrors();

      const cam = makeCamera([-2.0, 1.45, -2.0], [-4.0, 1.45, -2.0]);
      controller.update(cam);

      expect(controller.getActiveMirrorCount()).toBe(1);
      const target = controller.getActiveReflectorTargets()[0]!;
      const zAxis = new THREE.Vector3().setFromMatrixColumn(target.matrixWorld, 2);
      const origin = new THREE.Vector3().setFromMatrixPosition(target.matrixWorld);

      // Outward normal is +X, front surface at -4.0 + 0.030 + 0.004 = -3.966
      expect(zAxis.x).toBeCloseTo(1, 4);
      expect(zAxis.y).toBeCloseTo(0, 4);
      expect(zAxis.z).toBeCloseTo(0, 4);
      expect(origin.x).toBeCloseTo(-3.966, 4);
      expect(origin.y).toBeCloseTo(1.45, 4);
      expect(origin.z).toBeCloseTo(-2.0, 4);
      controller.dispose();
    }

    // Case C: Tilted ornate gilt floor mirror (leanDeg = 5 deg)
    {
      const scene = new THREE.Scene();
      const leanRadSetup = (5 * Math.PI) / 180;
      const floorMirror = new THREE.Group();
      floorMirror.name = 'suite.venosaFloorMirror';
      floorMirror.position.set(0, 0, -2.5);
      const leanerAssembly = new THREE.Group();
      leanerAssembly.position.set(0, 0.002, 0.08);
      leanerAssembly.rotation.x = -leanRadSetup;
      const archShape = new THREE.Shape();
      archShape.moveTo(-0.48, 0.02);
      archShape.lineTo(0.48, 0.02);
      archShape.lineTo(0.48, 1.3);
      archShape.absarc(0, 1.3, 0.48, 0, Math.PI, false);
      archShape.closePath();
      const glassPane = new THREE.Mesh(
        new THREE.ShapeGeometry(archShape, 24),
        createMirrorMaterial({ name: 'suite.venosaFloorMirror.mirrorGlassMat' })
      );
      glassPane.name = 'suite.venosaFloorMirror.mirrorGlass';
      glassPane.position.z = 0.0065;
      markMirrorSurface(glassPane, { localNormal: [0, 0, 1], zoneId: 'suite-zone' });
      leanerAssembly.add(glassPane);
      floorMirror.add(leanerAssembly);
      scene.add(floorMirror);

      const controller = new MirrorReflectorController(scene, {
        isConstrainedMobile: false,
        graphicsTier: 'high',
      });
      expect(controller.discoverMirrors()).toBe(1);

      const cam = makeCamera([0, 1.2, 0.2], [0, 1.0, -2.5]);
      controller.update(cam, 'suite-zone');

      expect(controller.getActiveMirrorCount()).toBe(1);
      const target = controller.getActiveReflectorTargets()[0]!;
      const zAxis = new THREE.Vector3().setFromMatrixColumn(target.matrixWorld, 2);

      // Leaning backward by -5 deg around X tilts the +Z normal slightly upward (+Y = sin(5 deg))
      const leanRad = (5 * Math.PI) / 180;
      expect(zAxis.x).toBeCloseTo(0, 4);
      expect(zAxis.y).toBeCloseTo(Math.sin(leanRad), 3);
      expect(zAxis.z).toBeCloseTo(Math.cos(leanRad), 3);
      controller.dispose();
    }
  });

  it('enforces room priority, frustum, facing (dot > 0), cutaway visibility, and <= 14 m distance gating with maxActiveMirrors = 2', () => {
    const scene = new THREE.Scene();

    const makeRoomMirror = (
      name: string,
      zoneId: string,
      pos: [number, number, number],
      rotY = 0
    ): { group: THREE.Group; mesh: THREE.Mesh; baseMat: THREE.MeshPhysicalMaterial } => {
      const group = new THREE.Group();
      group.name = `${zoneId}.group`;
      group.userData.zoneId = zoneId;
      const baseMat = createMirrorMaterial({ name: `${name}.mat` });
      const mesh = markMirrorSurface(
        new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.1), baseMat),
        { localNormal: [0, 0, 1], zoneId }
      );
      mesh.name = name;
      mesh.position.set(pos[0], pos[1], pos[2]);
      mesh.rotation.y = rotY;
      group.add(mesh);
      scene.add(group);
      return { group, mesh, baseMat };
    };

    // 6 mirrors across the house
    const mBathPrimary = makeRoomMirror('m1', 'master-bathroom', [-0.6, 1.4, -2.5], 0);
    const mBathSecondary = makeRoomMirror('m2', 'master-bathroom', [0.6, 1.4, -2.8], 0);
    const mHallCloserOtherRoom = makeRoomMirror('m3', 'hallway', [0.0, 1.4, -1.8], 0);
    const mBackFacing = makeRoomMirror('m4', 'master-bathroom', [0.2, 1.4, -2.2], Math.PI);
    const mDistant = makeRoomMirror('m5', 'master-bathroom', [0.0, 1.4, -18.5], 0);
    const mCutawayHidden = makeRoomMirror('m6', 'master-bathroom', [-0.2, 1.4, -2.0], 0);
    mCutawayHidden.group.visible = false;

    const controller = new MirrorReflectorController(scene, {
      maxActiveMirrors: 2,
      maxDistanceM: 14.0,
      isConstrainedMobile: false,
      graphicsTier: 'high',
    });
    expect(controller.discoverMirrors()).toBe(6);

    const cam = makeCamera([0, 1.4, 0.5], [0, 1.4, -3.0]);
    controller.update(cam, 'master-bathroom');

    // Only the 2 visible, front-facing, <= 14 m mirrors in 'master-bathroom' win (beating closer 'hallway' mirror)
    expect(controller.getActiveMirrorCount()).toBe(2);
    expect(controller.getAllocatedSlotCount()).toBe(2);
    const activeMeshes = controller.getActiveMirrorMeshes();
    expect(activeMeshes).toContain(mBathPrimary.mesh);
    expect(activeMeshes).toContain(mBathSecondary.mesh);

    // Active mirrors have swapped node materials; non-active mirrors keep their exact fallback MeshPhysicalMaterial
    expect(mBathPrimary.mesh.material).not.toBe(mBathPrimary.baseMat);
    expect(mBathSecondary.mesh.material).not.toBe(mBathSecondary.baseMat);
    expect(mHallCloserOtherRoom.mesh.material).toBe(mHallCloserOtherRoom.baseMat);
    expect(mBackFacing.mesh.material).toBe(mBackFacing.baseMat);
    expect(mDistant.mesh.material).toBe(mDistant.baseMat);
    expect(mCutawayHidden.mesh.material).toBe(mCutawayHidden.baseMat);

    // Medium tier caps active mirrors at 1
    controller.setGraphicsTier('medium');
    controller.update(cam, 'master-bathroom');
    expect(controller.getActiveMirrorCount()).toBe(1);
    expect(mBathPrimary.mesh.material !== mBathPrimary.baseMat || mBathSecondary.mesh.material !== mBathSecondary.baseMat).toBe(true);

    // Turning camera completely away (looking +Z, all mirrors behind frustum) restores all fallback materials (0 active)
    const camLookingAway = makeCamera([0, 1.4, 0.5], [0, 1.4, 10.0]);
    controller.update(camLookingAway, 'master-bathroom');
    expect(controller.getActiveMirrorCount()).toBe(0);
    expect(mBathPrimary.mesh.material).toBe(mBathPrimary.baseMat);
    expect(mBathSecondary.mesh.material).toBe(mBathSecondary.baseMat);
    expect(mHallCloserOtherRoom.mesh.material).toBe(mHallCloserOtherRoom.baseMat);

    // Moving camera > 14 m away from all front-facing mirrors keeps active count at 0
    const camFar = makeCamera([0, 1.4, 15.0], [0, 1.4, -3.0]);
    controller.setGraphicsTier('ultra');
    controller.update(camFar, 'master-bathroom');
    expect(controller.getActiveMirrorCount()).toBe(0);

    controller.dispose();
  });

  it('allocates zero ReflectorNodes and zero RenderTargets on constrained mobile or low graphics tier', () => {
    const scene = new THREE.Scene();
    const baseMat = createMirrorMaterial();
    const mirror = markMirrorSurface(
      new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.2), baseMat),
      { zoneId: 'bath' }
    );
    mirror.position.set(0, 1.4, -2.0);
    scene.add(mirror);

    const cam = makeCamera([0, 1.4, 0.5], [0, 1.4, -2.0]);

    // Constrained mobile even when graphicsTier is 'high'
    const mobileController = new MirrorReflectorController(scene, {
      isConstrainedMobile: true,
      graphicsTier: 'high',
    });
    expect(mobileController.discoverMirrors()).toBe(1);
    mobileController.update(cam, 'bath');
    expect(mobileController.getActiveMirrorCount()).toBe(0);
    expect(mobileController.getAllocatedSlotCount()).toBe(0);
    expect(mirror.material).toBe(baseMat);
    mobileController.dispose();

    // Desktop on 'low' tier
    const lowTierController = new MirrorReflectorController(scene, {
      isConstrainedMobile: false,
      graphicsTier: 'low',
    });
    expect(lowTierController.discoverMirrors()).toBe(1);
    lowTierController.update(cam, 'bath');
    expect(lowTierController.getActiveMirrorCount()).toBe(0);
    expect(lowTierController.getAllocatedSlotCount()).toBe(0);
    expect(mirror.material).toBe(baseMat);
    lowTierController.dispose();
  });

  it('restores original materials and disposes all pooled reflector render targets and node materials on dispose()', () => {
    const scene = new THREE.Scene();
    const baseMatA = createMirrorMaterial({ name: 'matA' });
    const baseMatB = createMirrorMaterial({ name: 'matB' });

    const mirrorA = markMirrorSurface(new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.2), baseMatA), {
      zoneId: 'bath',
    });
    mirrorA.position.set(-0.6, 1.4, -2.0);

    const mirrorB = markMirrorSurface(new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.2), baseMatB), {
      zoneId: 'bath',
    });
    mirrorB.position.set(0.6, 1.4, -2.0);
    scene.add(mirrorA, mirrorB);

    const controller = new MirrorReflectorController(scene, {
      isConstrainedMobile: false,
      graphicsTier: 'high',
    });
    controller.discoverMirrors();

    const cam = makeCamera([0, 1.4, 0.5], [0, 1.4, -2.0]);
    controller.update(cam, 'bath');
    expect(controller.getActiveMirrorCount()).toBe(2);
    expect(controller.getAllocatedSlotCount()).toBe(2);

    const activeMatA = mirrorA.material as THREE.Material;
    const activeMatB = mirrorB.material as THREE.Material;
    expect(activeMatA).not.toBe(baseMatA);
    expect(activeMatB).not.toBe(baseMatB);

    const matDisposeSpyA = vi.spyOn(activeMatA, 'dispose');
    const matDisposeSpyB = vi.spyOn(activeMatB, 'dispose');

    // Populate a camera RenderTarget in slot 0's ReflectorBaseNode to verify RenderTarget disposal
    const emissiveNode = (activeMatA as unknown as { emissiveNode?: unknown }).emissiveNode;
    expect(emissiveNode).toBeDefined();

    // Access internal slots via controller to attach a spy to any allocated RenderTarget
    const internalSlots = (controller as unknown as {
      slots: Array<{
        baseReflector: {
          getRenderTarget: (c: THREE.Camera) => THREE.RenderTarget;
          renderTargets: Map<THREE.Camera, THREE.RenderTarget>;
        };
      }>;
    }).slots;
    const rt0 = internalSlots[0]!.baseReflector.getRenderTarget(cam);
    const rt1 = internalSlots[1]!.baseReflector.getRenderTarget(cam);
    const rtDisposeSpy0 = vi.spyOn(rt0, 'dispose');
    const rtDisposeSpy1 = vi.spyOn(rt1, 'dispose');

    controller.dispose();

    expect(mirrorA.material).toBe(baseMatA);
    expect(mirrorB.material).toBe(baseMatB);
    expect(matDisposeSpyA).toHaveBeenCalledTimes(1);
    expect(matDisposeSpyB).toHaveBeenCalledTimes(1);
    expect(rtDisposeSpy0).toHaveBeenCalled();
    expect(rtDisposeSpy1).toHaveBeenCalled();
    expect(controller.getActiveMirrorCount()).toBe(0);
    expect(controller.getAllocatedSlotCount()).toBe(0);
    expect(controller.getDiscoveredMirrorCount()).toBe(0);
  });
});
