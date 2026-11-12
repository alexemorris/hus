import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  buildHallWoodBurningStoveFirebox,
  createSculptedFlameTongueGeometry,
} from './wood-burning-stove-fire.ts';

describe('WoodBurningStoveFireController', () => {
  it('builds sculpted bottom-anchored flame tongue geometry with valid normals and UVs', () => {
    const geo = createSculptedFlameTongueGeometry(0.06, 0.16, 0.036);
    expect(geo.getAttribute('position')?.count).toBeGreaterThan(50);
    expect(geo.getAttribute('normal')?.count).toBeGreaterThan(50);
    expect(geo.getAttribute('uv')?.count).toBeGreaterThan(50);
    expect(geo.boundingBox).not.toBeNull();
    expect(geo.boundingBox!.min.y).toBeCloseTo(0, 4);
    expect(geo.boundingBox!.max.y).toBeCloseTo(0.16, 4);
  });

  it('populates stoveGroup with sculpted emissive flames, sparks, and animates them on step()', () => {
    const stoveGroup = new THREE.Group();
    const castIronMat = new THREE.MeshStandardMaterial({ color: 0x222428 });

    const controller = buildHallWoodBurningStoveFirebox({
      stoveGroup,
      castIronMat,
      namePrefix: 'hall.woodBurningStove',
    });

    expect(controller.isAmbientLoop).toBe(true);

    const dynamicSet = new Set<THREE.Object3D>();
    controller.collectDynamicObjects(dynamicSet);
    expect(dynamicSet.size).toBeGreaterThan(20);

    const flame1 = stoveGroup.getObjectByName('hall.woodBurningStove.flame.1') as THREE.Mesh;
    const core1 = stoveGroup.getObjectByName('hall.woodBurningStove.flameCore.1') as THREE.Mesh;
    const spark1 = stoveGroup.getObjectByName('hall.woodBurningStove.spark.1') as THREE.Mesh;
    const doorGlass = stoveGroup.getObjectByName('hall.woodBurningStove.doorGlass') as THREE.Mesh;
    expect(flame1).toBeInstanceOf(THREE.Mesh);
    expect(core1).toBeInstanceOf(THREE.Mesh);
    expect(spark1).toBeInstanceOf(THREE.Mesh);
    expect(doorGlass).toBeInstanceOf(THREE.Mesh);

    const flameMat = flame1.material as THREE.MeshStandardMaterial;
    const coreMat = core1.material as THREE.MeshStandardMaterial;
    expect(flameMat.emissiveIntensity).toBeGreaterThan(3.0);
    expect(coreMat.emissiveIntensity).toBeGreaterThan(4.0);

    const initialY = spark1.position.y;
    const initialScaleY = flame1.scale.y;

    expect(controller.step(0.05)).toBe(true);
    expect(spark1.position.y).not.toBe(initialY);
    expect(flame1.scale.y).not.toBe(initialScaleY);
  });

  it('settles at 0 fps when hidden, beyond 14 m, or facing away, and throttles close views to ~28 Hz', () => {
    const stoveGroup = new THREE.Group();
    stoveGroup.position.set(-13.33, 0.07, -0.53);
    const castIronMat = new THREE.MeshStandardMaterial({ color: 0x222428 });
    const camMatrix = new THREE.Matrix4();
    const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100);

    const controller = buildHallWoodBurningStoveFirebox({
      stoveGroup,
      castIronMat,
      cameraWorldMatrix: camMatrix,
    });

    // Overview camera (~48 m away): 0 fps
    cam.position.set(22, 18, 28);
    cam.lookAt(0, 1, 4);
    cam.updateMatrixWorld();
    camMatrix.copy(cam.matrixWorld);
    expect(controller.step(0.05)).toBe(false);

    // Adjacent room within 10 m but facing away from the stove: 0 fps
    cam.position.set(-6, 1.5, -0.53);
    cam.lookAt(5, 1.5, -0.53);
    cam.updateMatrixWorld();
    camMatrix.copy(cam.matrixWorld);
    expect(controller.step(0.05)).toBe(false);

    // Close hall view looking directly at the stove (~3 m away): throttled to ~28 Hz
    cam.position.set(-10.5, 1.4, -0.53);
    cam.lookAt(-13.33, 0.4, -0.53);
    cam.updateMatrixWorld();
    camMatrix.copy(cam.matrixWorld);
    expect(controller.step(0.016)).toBe(false);
    expect(controller.step(0.016)).toBe(false);
    expect(controller.step(0.016)).toBe(true);

    // Floor cutaway hiding ancestor group: 0 fps
    stoveGroup.visible = false;
    expect(controller.step(0.05)).toBe(false);
  });
});
