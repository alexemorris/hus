import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Fn, float, rtt, texture, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { TextureNode } from 'three/webgpu';
import {
  CLOSE_UP_MICRO_RELIEF_MAX_DIST_M,
  CONTACT_SHADOW_MIN_NDOTL,
  CONTACT_SHADOW_STEPS,
  GTAO_MAX_REL_SCREEN_RADIUS,
  GTAO_MIN_PLANE_ELEV_M,
  GTAO_SLICE_COUNT,
  GTAO_STEPS_PER_SIDE,
  VIEWPORT_SAFE_UV_MAX,
  VIEWPORT_SAFE_UV_MIN,
  computeContactShadowFacingAndBias,
  computeGtaoRadiusAndCloseRangeWeight,
  decodeOctNormalCpu,
  denoiseBilateralAoAndContactPass,
  encodeOctNormalCpu,
  evaluateBilateralAoDenoise1DCpu,
  evaluateDeterministicMicroContactShadow,
  evaluateHalfResAoAndContactRaw,
  evaluateHalfResGtao,
  evaluateNormalizedGtaoVisibilityCpu,
  evaluateScreenSpaceContactShadow,
  evaluateSeparableBilateralAoDenoise2DCpu,
  isScreenUvInsideSafeViewport,
  reconstructMinDeltaViewNormal,
  resolvePrimaryDirectionalSunSample,
  spatialInterleavedGradientNoise,
  upsampleBilateralAoAndContact,
  type BilateralDenoiseSampleCpu,
  type GtaoAndContactShadowUniforms,
} from '../contact-shadows-and-gtao.ts';
import {
  SHARPEN_INTENSITY,
  resolveScenePassMsaaSamples,
} from '../post-processing-pipeline.ts';
import {
  buildGeometricSpecularRoughnessNode,
  computeGeometricSpecularAaRoughnessCpu,
  getGeometricSpecularAAMetadata,
} from '../../textures/specular-anti-aliasing.ts';
import { createFinishMaterial } from '../../textures/finish-materials.ts';
import { createPaintMaterial } from '../../textures/paint-system.ts';

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

function computeVariance(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let mean = 0;
  for (const v of values) mean += v;
  mean /= values.length;
  let sq = 0;
  for (const v of values) {
    const d = v - mean;
    sq += d * d;
  }
  return sq / values.length;
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

  it('builds purely spatial IGN, raw AO+contact, separable bilateral blur, upsample, and deterministic micro-contact TSL nodes', () => {
    expect(GTAO_SLICE_COUNT).toBe(4);
    expect(GTAO_STEPS_PER_SIDE).toBe(4);
    expect(CONTACT_SHADOW_STEPS).toBe(12);

    const node = spatialInterleavedGradientNoise(vec2(142.0, 289.0));
    expect(node).toBeDefined();

    const dummyTex = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
    const depthNode = texture(dummyTex) as unknown as ReturnType<typeof texture> & TextureNode;
    const uniforms = makeDummyGtaoUniforms();

    const gtaoShader = Fn(() =>
      evaluateHalfResGtao(depthNode, vec2(0.5, 0.5), float(0.5), uniforms)
    );
    const rawAoContactShader = Fn(() =>
      evaluateHalfResAoAndContactRaw(depthNode, vec2(0.5, 0.5), float(0.5), uniforms)
    );
    const dummyRtt = rtt(vec4(1.0, 1.0, 0.0, 0.0), 4, 4);
    const blurShader = Fn(() =>
      denoiseBilateralAoAndContactPass(
        dummyRtt,
        depthNode,
        vec2(0.5, 0.5),
        vec2(uniforms.uHalfTexelSize.x, 0.0),
        uniforms
      )
    );
    const upsampleAndMicroShader = Fn(() => {
      const n = reconstructMinDeltaViewNormal(
        depthNode,
        vec2(0.5, 0.5),
        vec3(0.2, 0.0, -0.55),
        uniforms.uHalfTexelSize,
        uniforms.uProjMatrixInverse
      );
      const rawContact = evaluateScreenSpaceContactShadow(
        depthNode,
        vec3(0.2, 0.0, -0.55),
        n,
        float(0.55),
        uniforms
      );
      const micro = evaluateDeterministicMicroContactShadow(
        depthNode,
        vec3(0.2, 0.0, -0.55),
        n,
        float(0.55),
        uniforms
      );
      const up = upsampleBilateralAoAndContact(
        dummyRtt,
        depthNode,
        vec2(0.5, 0.5),
        vec3(0.2, 0.0, -0.55),
        n,
        uniforms
      );
      return vec4(up.x, up.y, rawContact, micro);
    });

    expect(gtaoShader).toBeDefined();
    expect(rawAoContactShader).toBeDefined();
    expect(blurShader).toBeDefined();
    expect(upsampleAndMicroShader).toBeDefined();
    dummyRtt.renderTarget?.dispose();
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

  it('normalizes GTAO slice visibility in the view-ray-orthogonal basis so unoccluded oblique 1PV walls stay 1.0 across all camera positions and screen UVs', () => {
    const wallAnglesDeg = [0, 25, 50, 68, 76, 81];
    const viewOffsets = [
      new THREE.Vector3(0, 0, -1.6),
      new THREE.Vector3(0.85, 0.55, -1.35),
      new THREE.Vector3(1.15, -0.62, -1.1),
      new THREE.Vector3(-0.95, 0.48, -2.15),
    ];

    for (const deg of wallAnglesDeg) {
      const rad = THREE.MathUtils.degToRad(deg);
      const wallNormal = new THREE.Vector3(-Math.sin(rad), 0.04, Math.cos(rad)).normalize();
      for (const viewPos of viewOffsets) {
        const viewDir = viewPos.clone().negate().normalize();
        if (wallNormal.dot(viewDir) <= 0.08) continue;
        for (const ign of [0.0, 0.65, 1.42, 2.35]) {
          const vis = evaluateNormalizedGtaoVisibilityCpu(viewPos, wallNormal, ign, 0);
          expect(vis).toBeCloseTo(1.0, 5);
        }
      }
    }

    const cornerVis = evaluateNormalizedGtaoVisibilityCpu(
      new THREE.Vector3(0.4, 0.1, -1.8),
      new THREE.Vector3(-0.5, 0.0, 0.866).normalize(),
      0.5,
      0.55
    );
    expect(cornerVis).toBeLessThan(0.75);
    expect(cornerVis).toBeGreaterThan(0.15);

    expect(GTAO_MIN_PLANE_ELEV_M).toBeGreaterThanOrEqual(0.006);
    expect(CLOSE_UP_MICRO_RELIEF_MAX_DIST_M).toBeCloseTo(1.95, 5);
  });

  it('denoises alternating IGN stipple variance by > 85%, preserves depth/normal discontinuities, and keeps flat walls identically 1.0', () => {
    for (const dir of [
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(-0.62, 0.34, 0.71).normalize(),
      new THREE.Vector3(0.48, -0.73, -0.48).normalize(),
    ]) {
      const [ox, oy] = encodeOctNormalCpu(dir);
      const decoded = decodeOctNormalCpu(ox, oy);
      expect(decoded.distanceTo(dir)).toBeLessThan(1e-5);
    }

    // (a) High-frequency IGN stipple variance drops by > 85% in both 1D and separable 2D passes
    const flatNormal = new THREE.Vector3(0, 0, 1);
    const len1D = 32;
    const rawLine: BilateralDenoiseSampleCpu[] = [];
    for (let i = 0; i < len1D; i++) {
      const ign = (52.9829189 * (((0.06711056 * (i + 17) + 0.00583715 * 43) % 1) + 1)) % 1;
      const stipple = (i % 2 === 0 ? 1 : -1) * 0.16 + (ign - 0.5) * 0.12;
      rawLine.push({
        ao: 0.72 + stipple,
        contact: 0.65 - stipple,
        viewPos: new THREE.Vector3((i - 16) * 0.01, 0, -2.0),
        viewNormal: flatNormal,
      });
    }
    const denoisedLine = evaluateBilateralAoDenoise1DCpu(rawLine);
    const interiorRawAo = rawLine.slice(6, len1D - 6).map((s) => s.ao);
    const interiorDenoisedAo = denoisedLine.slice(6, len1D - 6).map((s) => s.ao);
    const varianceReduction1D =
      1 - computeVariance(interiorDenoisedAo) / computeVariance(interiorRawAo);
    expect(varianceReduction1D).toBeGreaterThan(0.85);

    const gridW = 20;
    const gridH = 20;
    const rawGrid: BilateralDenoiseSampleCpu[][] = [];
    const rawInterior2D: number[] = [];
    for (let y = 0; y < gridH; y++) {
      const row: BilateralDenoiseSampleCpu[] = [];
      for (let x = 0; x < gridW; x++) {
        const checker = ((x + y) % 2 === 0 ? 1 : -1) * 0.18;
        const aoVal = 0.74 + checker;
        if (x >= 5 && x < gridW - 5 && y >= 5 && y < gridH - 5) {
          rawInterior2D.push(aoVal);
        }
        row.push({
          ao: aoVal,
          contact: 0.68 - checker,
          viewPos: new THREE.Vector3((x - 10) * 0.01, (y - 10) * 0.01, -2.0),
          viewNormal: flatNormal,
        });
      }
      rawGrid.push(row);
    }
    const denoisedGrid = evaluateSeparableBilateralAoDenoise2DCpu(rawGrid);
    const denoisedInterior2D: number[] = [];
    for (let y = 5; y < gridH - 5; y++) {
      for (let x = 5; x < gridW - 5; x++) {
        denoisedInterior2D.push(denoisedGrid[y]![x]!.ao);
      }
    }
    const varianceReduction2D =
      1 - computeVariance(denoisedInterior2D) / computeVariance(rawInterior2D);
    expect(varianceReduction2D).toBeGreaterThan(0.92);

    // (b1) Depth silhouette discontinuity: foreground object at 0.5 m (ao = 0.35) vs background wall at 3.0 m (ao = 1.0)
    const silhouetteLine: BilateralDenoiseSampleCpu[] = [];
    for (let i = 0; i < 18; i++) {
      const isForeground = i < 9;
      silhouetteLine.push({
        ao: isForeground ? 0.35 : 1.0,
        contact: isForeground ? 0.25 : 1.0,
        viewPos: new THREE.Vector3((i - 9) * 0.008, 0, isForeground ? -0.5 : -3.0),
        viewNormal: flatNormal,
      });
    }
    const denoisedSilhouette = evaluateBilateralAoDenoise1DCpu(silhouetteLine);
    expect(denoisedSilhouette[8]!.ao).toBeCloseTo(0.35, 5);
    expect(denoisedSilhouette[9]!.ao).toBeCloseTo(1.0, 5);
    expect(denoisedSilhouette[8]!.contact).toBeCloseTo(0.25, 5);
    expect(denoisedSilhouette[9]!.contact).toBeCloseTo(1.0, 5);

    // (b2) 90-degree normal corner discontinuity: left wall normal (+1, 0, 0) vs back wall normal (0, 0, +1)
    const leftWallNormal = new THREE.Vector3(1, 0, 0);
    const backWallNormal = new THREE.Vector3(0, 0, 1);
    const cornerLine: BilateralDenoiseSampleCpu[] = [];
    for (let i = 0; i < 18; i++) {
      const isLeftWall = i < 9;
      cornerLine.push({
        ao: isLeftWall ? 0.42 : 0.96,
        contact: isLeftWall ? 0.3 : 1.0,
        viewPos: isLeftWall
          ? new THREE.Vector3(-0.4, 0, -2.0 + (8 - i) * 0.012)
          : new THREE.Vector3(-0.4 + (i - 9) * 0.012, 0, -2.0),
        viewNormal: isLeftWall ? leftWallNormal : backWallNormal,
      });
    }
    const denoisedCorner = evaluateBilateralAoDenoise1DCpu(cornerLine);
    expect(denoisedCorner[8]!.ao).toBeCloseTo(0.42, 5);
    expect(denoisedCorner[9]!.ao).toBeCloseTo(0.96, 5);

    // (c) Flat unoccluded oblique wall preserves exact constant 1.0 within 1e-6
    const obliqueNormal = new THREE.Vector3(-Math.sin(1.15), 0.05, Math.cos(1.15)).normalize();
    const obliqueTangent = new THREE.Vector3(obliqueNormal.z, 0, -obliqueNormal.x).normalize();
    const obliqueOrigin = new THREE.Vector3(0.3, 0.1, -1.75);
    const obliqueWallLine: BilateralDenoiseSampleCpu[] = [];
    for (let i = 0; i < 20; i++) {
      obliqueWallLine.push({
        ao: 1.0,
        contact: 1.0,
        viewPos: obliqueOrigin.clone().addScaledVector(obliqueTangent, (i - 10) * 0.015),
        viewNormal: obliqueNormal,
      });
    }
    const denoisedOblique = evaluateBilateralAoDenoise1DCpu(obliqueWallLine);
    for (const sample of denoisedOblique) {
      expect(Math.abs(sample.ao - 1.0)).toBeLessThan(1e-6);
      expect(Math.abs(sample.contact - 1.0)).toBeLessThan(1e-6);
    }
  });

  it('filters sub-pixel normal curvature via Geometric Specular AA while preserving flat-surface roughness', () => {
    expect(computeGeometricSpecularAaRoughnessCpu(0.12, 0, 0)).toBeCloseTo(0.12, 6);
    expect(computeGeometricSpecularAaRoughnessCpu(0.48, 0, 0)).toBeCloseTo(0.48, 6);

    const filteredBrass = computeGeometricSpecularAaRoughnessCpu(0.12, 0.36, 0.36);
    expect(filteredBrass).toBeGreaterThan(0.35);
    expect(filteredBrass).toBeLessThanOrEqual(1.0);

    expect(computeGeometricSpecularAaRoughnessCpu(0.98, 4.0, 4.0)).toBeLessThanOrEqual(1.0);
    expect(computeGeometricSpecularAaRoughnessCpu(0.0, 0.0, 0.0)).toBe(0.0);

    const specAaNode = Fn(() => buildGeometricSpecularRoughnessNode(float(0.14)));
    expect(specAaNode).toBeDefined();

    const brassMat = createFinishMaterial('unlacquered-brass', undefined, { unique: true });
    const paintMat = createPaintMaterial({ color: '#e8e2d5', sheen: 'satinwood', unique: true });
    expect(getGeometricSpecularAAMetadata(brassMat)?.enabled).toBe(true);
    expect(getGeometricSpecularAAMetadata(paintMat)?.enabled).toBe(true);
    brassMat.dispose();
    paintMat.dispose();
  });

  it('selects 4x MSAA on desktop high/ultra tiers and 1x on low/medium or constrained mobile devices', () => {
    expect(resolveScenePassMsaaSamples('ultra', false)).toBe(4);
    expect(resolveScenePassMsaaSamples('high', false)).toBe(4);
    expect(resolveScenePassMsaaSamples('medium', false)).toBe(1);
    expect(resolveScenePassMsaaSamples('low', false)).toBe(1);

    expect(resolveScenePassMsaaSamples('ultra', true)).toBe(1);
    expect(resolveScenePassMsaaSamples('high', true)).toBe(1);
    expect(resolveScenePassMsaaSamples('medium', true)).toBe(1);
    expect(resolveScenePassMsaaSamples('low', true)).toBe(1);

    expect(SHARPEN_INTENSITY).toBeCloseTo(0.18, 5);
  });
});
