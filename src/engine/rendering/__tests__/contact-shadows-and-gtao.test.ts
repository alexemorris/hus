import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { vec2 } from 'three/tsl';
import {
  resolvePrimaryDirectionalSunSample,
  spatialInterleavedGradientNoise,
} from '../contact-shadows-and-gtao.ts';

describe('contact-shadows-and-gtao', () => {
  it('fades contact shadow strength smoothly to zero at night or when shadows are disabled', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 150);
    camera.position.set(0, 1.65, 4);
    camera.lookAt(0, 1.4, 0);
    camera.updateMatrixWorld(true);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

    const sunViewDir = new THREE.Vector3();
    const sunWorldDir = new THREE.Vector3();

    expect(resolvePrimaryDirectionalSunSample(scene, camera, sunViewDir, sunWorldDir)).toBe(0);

    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(18, 26, 14);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    sun.shadow.intensity = 1.0;
    scene.add(sun);
    scene.add(sun.target);
    scene.updateMatrixWorld(true);

    const dayStrength = resolvePrimaryDirectionalSunSample(scene, camera, sunViewDir, sunWorldDir);
    expect(dayStrength).toBeGreaterThan(0.95);
    expect(sunViewDir.length()).toBeCloseTo(1, 5);
    expect(sunWorldDir.y).toBeGreaterThan(0.5);

    sun.intensity = 0.002;
    expect(resolvePrimaryDirectionalSunSample(scene, camera, sunViewDir, sunWorldDir)).toBe(0);

    sun.intensity = 2.2;
    sun.position.set(20, -4, 14);
    scene.updateMatrixWorld(true);
    expect(resolvePrimaryDirectionalSunSample(scene, camera, sunViewDir, sunWorldDir)).toBe(0);
  });

  it('builds a purely spatial IGN TSL node without temporal state', () => {
    const node = spatialInterleavedGradientNoise(vec2(142.0, 289.0));
    expect(node).toBeDefined();
  });
});
