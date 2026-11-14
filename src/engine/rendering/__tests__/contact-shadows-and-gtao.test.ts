import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Fn, float, texture, uniform, vec2, vec3 } from 'three/tsl';
import type { TextureNode } from 'three/webgpu';
import {
  CONTACT_SHADOW_MIN_NDOTL,
  GTAO_MAX_REL_SCREEN_RADIUS,
  VIEWPORT_SAFE_UV_MAX,
  VIEWPORT_SAFE_UV_MIN,
  computeContactShadowFacingAndBias,
  computeGtaoRadiusAndCloseRangeWeight,
  evaluateHalfResGtao,
  evaluateScreenSpaceContactShadow,
  isScreenUvInsideSafeViewport,
  reconstructMinDeltaViewNormal,
  resolvePrimaryDirectionalSunSample,
  spatialInterleavedGradientNoise,
  type GtaoAndContactShadowUniforms,
} from '../contact-shadows-and-gtao.ts';

function makeDummyGtaoUniforms(): GtaoAndContactShadowUniforms {
  return {
    uProjMatrix: uniform(new THREE.Matrix4()),
    uProjMatrixInverse: uniform(new THREE.Matrix4()),
    uCameraWorldMatrix: uniform(new THREE.Matrix4()),
    uTexelSize: uniform(new THREE.Vector2(1 / 1440, 1 / 900)),
    uHalfTexelSize: uniform(new THREE.Vector2(1 / 720, 1 / 450)),
    uIsOrtho: uniform(0),
    uOrthoEquivDepth: uniform(10),
    uAoIntensity: uniform(1.0),
    uSunViewDir: uniform(new THREE.Vector3(0.2, 0.8, 0.5).normalize()),
    uSunWorldDir: uniform(new THREE.Vector3(0.2, 0.8, 0.5).normalize()),
    uContactShadowStrength: uniform(1.0),
  };
}

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

  it('builds purely spatial IGN and GTAO / contact-shadow TSL shader functions without temporal state', () => {
    const node = spatialInterleavedGradientNoise(vec2(142.0, 289.0));
    expect(node).toBeDefined();

    const dummyTex = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
    const depthNode = texture(dummyTex) as unknown as ReturnType<typeof texture> & TextureNode;
    const uniforms = makeDummyGtaoUniforms();

    const gtaoShader = Fn(() =>
      evaluateHalfResGtao(depthNode, vec2(0.5, 0.5), float(0.5), uniforms)
    );
    const contactShader = Fn(() => {
      const n = reconstructMinDeltaViewNormal(
        depthNode,
        vec2(0.5, 0.5),
        vec3(0.2, 0.0, -0.55),
        uniforms.uHalfTexelSize,
        uniforms.uProjMatrixInverse
      );
      return evaluateScreenSpaceContactShadow(
        depthNode,
        vec3(0.2, 0.0, -0.55),
        n,
        float(0.55),
        uniforms
      );
    });
    expect(gtaoShader).toBeDefined();
    expect(contactShader).toBeDefined();
  });

  it('rejects out-of-frustum screen UVs so oblique close walls never sample clamped border depth', () => {
    expect(isScreenUvInsideSafeViewport(0.5, 0.5)).toBe(true);
    expect(isScreenUvInsideSafeViewport(VIEWPORT_SAFE_UV_MIN + 1e-4, 0.5)).toBe(true);
    expect(isScreenUvInsideSafeViewport(VIEWPORT_SAFE_UV_MAX - 1e-4, 0.5)).toBe(true);

    expect(isScreenUvInsideSafeViewport(-0.05, 0.5)).toBe(false);
    expect(isScreenUvInsideSafeViewport(1.08, 0.5)).toBe(false);
    expect(isScreenUvInsideSafeViewport(0.5, -0.02)).toBe(false);
    expect(isScreenUvInsideSafeViewport(0.5, 1.04)).toBe(false);
    expect(isScreenUvInsideSafeViewport(0.001, 0.5)).toBe(false);
    expect(isScreenUvInsideSafeViewport(0.999, 0.5)).toBe(false);
  });

  it('caps perspective GTAO world radius at close 1PV wall distances to prevent radiusPx blow-up', () => {
    for (const dist of [0.22, 0.35, 0.5, 0.75, 1.2, 2.5]) {
      const { worldRadiusM, closeRangeWeight } = computeGtaoRadiusAndCloseRangeWeight(dist);
      expect(worldRadiusM / dist).toBeLessThanOrEqual(GTAO_MAX_REL_SCREEN_RADIUS + 0.001);
      expect(closeRangeWeight).toBeGreaterThanOrEqual(0);
      expect(closeRangeWeight).toBeLessThanOrEqual(1);
    }
    expect(computeGtaoRadiusAndCloseRangeWeight(0.24).closeRangeWeight).toBe(0);
    expect(computeGtaoRadiusAndCloseRangeWeight(0.95).closeRangeWeight).toBe(1);
    expect(computeGtaoRadiusAndCloseRangeWeight(8.0).worldRadiusM).toBeCloseTo(0.44, 5);
  });

  it('zeros contact shadows on surfaces facing away from the sun and scales grazing depth bias by 1 / max(dot(N, V), 0.15)', () => {
    expect(computeContactShadowFacingAndBias(-0.4, 0.8, 0.05, 0.6).facingWeight).toBe(0);
    expect(computeContactShadowFacingAndBias(0.0, 0.8, 0.05, 0.6).facingWeight).toBe(0);
    expect(
      computeContactShadowFacingAndBias(CONTACT_SHADOW_MIN_NDOTL, 0.8, 0.05, 0.6).facingWeight
    ).toBe(0);
    expect(computeContactShadowFacingAndBias(0.35, 0.8, 0.05, 0.6).facingWeight).toBe(1);

    const headOn = computeContactShadowFacingAndBias(0.5, 1.0, 0.06, 0.5);
    const grazing = computeContactShadowFacingAndBias(0.5, 0.18, 0.06, 0.5);
    expect(grazing.minBiasM).toBeCloseTo(headOn.minBiasM / 0.18, 6);
    expect(computeContactShadowFacingAndBias(0.5, 0.02, 0.06, 0.5).minBiasM).toBeCloseTo(
      headOn.minBiasM / 0.15,
      6
    );
  });
});
