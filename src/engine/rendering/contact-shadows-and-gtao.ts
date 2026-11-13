/**
 * Horizon-Based Ground-Truth Ambient Occlusion (GTAO), Depth-Bilateral Upsampling,
 * Multi-Bounce & Specular AO, and Screen-Space Contact Shadows (SSCS) in TSL.
 *
 * Compatible with both `WebGPUCoordinateSystem` and `WebGLCoordinateSystem` (`?forceWebGL=1`),
 * perspective and orthographic cameras, and 0 Hz demand-driven idle sleep (purely spatial
 * Interleaved Gradient Noise with zero temporal frame jitter).
 */
import * as THREE from 'three';
import type { Node, RTTNode, TextureNode, UniformNode } from 'three/webgpu';
import {
  Fn,
  If,
  PI,
  abs,
  acos,
  clamp,
  cos,
  cross,
  dot,
  exp,
  float,
  fract,
  getScreenPosition,
  getViewPosition,
  max,
  min,
  mix,
  normalize,
  pow,
  screenCoordinate,
  select,
  type ShaderNodeObject,
  sin,
  smoothstep,
  sqrt,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { buildCloseUpTriplanarMicroReliefNode } from '../textures/micro-surface-detail.ts';

export interface GtaoAndContactShadowUniforms {
  readonly uProjMatrix: ShaderNodeObject<UniformNode<THREE.Matrix4>>;
  readonly uProjMatrixInverse: ShaderNodeObject<UniformNode<THREE.Matrix4>>;
  readonly uCameraWorldMatrix: ShaderNodeObject<UniformNode<THREE.Matrix4>>;
  readonly uTexelSize: ShaderNodeObject<UniformNode<THREE.Vector2>>;
  readonly uHalfTexelSize: ShaderNodeObject<UniformNode<THREE.Vector2>>;
  readonly uIsOrtho: ShaderNodeObject<UniformNode<number>>;
  readonly uOrthoEquivDepth: ShaderNodeObject<UniformNode<number>>;
  readonly uAoIntensity: ShaderNodeObject<UniformNode<number>>;
  readonly uSunViewDir: ShaderNodeObject<UniformNode<THREE.Vector3>>;
  readonly uSunWorldDir: ShaderNodeObject<UniformNode<THREE.Vector3>>;
  readonly uContactShadowStrength: ShaderNodeObject<UniformNode<number>>;
}

export interface PrimarySunLightSample {
  readonly sunViewDir: THREE.Vector3;
  readonly sunWorldDir: THREE.Vector3;
  readonly contactShadowStrength: number;
}

const GTAO_SLICE_COUNT = 3;
const GTAO_STEPS_PER_SIDE = 3;
const CONTACT_SHADOW_STEPS = 10;

const sunPosScratch = new THREE.Vector3();
const targetPosScratch = new THREE.Vector3();
const worldDirScratch = new THREE.Vector3();

/**
 * Discovers the primary active directional sun/moon light in `scene` and computes its
 * unit world-space direction (from surface toward light), view-space direction, and
 * smooth contact-shadow strength (fading to `0` at night, heavy overcast, or when shadows are off).
 */
export function resolvePrimaryDirectionalSunSample(
  scene: THREE.Scene,
  camera: THREE.Camera,
  outViewDir: THREE.Vector3,
  outWorldDir: THREE.Vector3
): number {
  let primaryLight: THREE.DirectionalLight | null = null;
  let bestScore = 0;

  for (let i = 0; i < scene.children.length; i++) {
    const child = scene.children[i];
    if (child && (child as THREE.DirectionalLight).isDirectionalLight) {
      const dirLight = child as THREE.DirectionalLight;
      if (!dirLight.visible) continue;
      const score = dirLight.intensity * (dirLight.castShadow ? 1.0 : 0.25);
      if (score > bestScore) {
        bestScore = score;
        primaryLight = dirLight;
      }
    }
  }

  if (!primaryLight) {
    scene.traverse((obj) => {
      if ((obj as THREE.DirectionalLight).isDirectionalLight) {
        const dirLight = obj as THREE.DirectionalLight;
        if (!dirLight.visible) return;
        const score = dirLight.intensity * (dirLight.castShadow ? 1.0 : 0.25);
        if (score > bestScore) {
          bestScore = score;
          primaryLight = dirLight;
        }
      }
    });
  }

  if (!primaryLight) {
    outWorldDir.set(0.35, 0.88, 0.32).normalize();
    outViewDir.copy(outWorldDir).transformDirection(camera.matrixWorldInverse).normalize();
    return 0.0;
  }

  sunPosScratch.setFromMatrixPosition(primaryLight.matrixWorld);
  targetPosScratch.setFromMatrixPosition(primaryLight.target.matrixWorld);
  worldDirScratch.subVectors(sunPosScratch, targetPosScratch);
  if (worldDirScratch.lengthSq() < 1e-8) {
    outWorldDir.set(0.35, 0.88, 0.32).normalize();
    outViewDir.copy(outWorldDir).transformDirection(camera.matrixWorldInverse).normalize();
    return 0.0;
  }

  outWorldDir.copy(worldDirScratch).normalize();
  outViewDir.copy(outWorldDir).transformDirection(camera.matrixWorldInverse).normalize();

  const shadowFactor = primaryLight.castShadow ? primaryLight.shadow.intensity : 0.0;
  const effectiveRadiance = primaryLight.intensity * shadowFactor;
  const horizonElevationFade = THREE.MathUtils.smoothstep(outWorldDir.y, 0.015, 0.14);
  const radianceFade = THREE.MathUtils.smoothstep(effectiveRadiance, 0.015, 0.42);
  return THREE.MathUtils.clamp(horizonElevationFade * radianceFade, 0.0, 1.0);
}

/**
 * Purely spatial Interleaved Gradient Noise (Jimenez 2014) — deterministic per pixel
 * so demand-driven 0 Hz idle frames never shimmer or re-trigger rAF.
 */
export function spatialInterleavedGradientNoise(
  coordXY: ShaderNodeObject<Node>
): ShaderNodeObject<Node> {
  const magic = vec2(0.06711056, 0.00583715);
  return fract(float(52.9829189).mul(fract(dot(coordXY, magic))));
}

function sampleClampedDepth(
  depthNode: ShaderNodeObject<TextureNode>,
  sampleUv: ShaderNodeObject<Node>
): ShaderNodeObject<Node> {
  return depthNode.sample(clamp(sampleUv, 0.001, 0.999)).r;
}

/**
 * Reconstructs view-space surface normal from depth using closest-depth-delta neighbor taps
 * so foreground silhouettes never produce false bevels or dark halo ringing.
 */
export function reconstructMinDeltaViewNormal(
  depthNode: ShaderNodeObject<TextureNode>,
  centerUv: ShaderNodeObject<Node>,
  centerViewPos: ShaderNodeObject<Node>,
  stepUv: ShaderNodeObject<UniformNode<THREE.Vector2>>,
  uProjMatrixInverse: ShaderNodeObject<UniformNode<THREE.Matrix4>>
): ShaderNodeObject<Node> {
  const uvR = centerUv.add(vec2(stepUv.x, 0.0));
  const uvL = centerUv.sub(vec2(stepUv.x, 0.0));
  const uvD = centerUv.add(vec2(0.0, stepUv.y));
  const uvU = centerUv.sub(vec2(0.0, stepUv.y));

  const posR = getViewPosition(uvR, sampleClampedDepth(depthNode, uvR), uProjMatrixInverse).toVar();
  const posL = getViewPosition(uvL, sampleClampedDepth(depthNode, uvL), uProjMatrixInverse).toVar();
  const posD = getViewPosition(uvD, sampleClampedDepth(depthNode, uvD), uProjMatrixInverse).toVar();
  const posU = getViewPosition(uvU, sampleClampedDepth(depthNode, uvU), uProjMatrixInverse).toVar();

  const useRight = abs(posR.z.sub(centerViewPos.z)).lessThan(abs(centerViewPos.z.sub(posL.z)));
  const dpdx = select(useRight, posR.sub(centerViewPos), centerViewPos.sub(posL));

  const useUp = abs(posU.z.sub(centerViewPos.z)).lessThan(abs(centerViewPos.z.sub(posD.z)));
  const dpdyUp = select(useUp, posU.sub(centerViewPos), centerViewPos.sub(posD));

  const rawCross = cross(dpdx, dpdyUp);
  return normalize(select(dot(rawCross, rawCross).greaterThan(1e-12), rawCross, vec3(0.0, 0.0, 1.0)));
}

/**
 * Evaluates multi-slice cosine-space Ground-Truth Ambient Occlusion (Jimenez 2016) at half resolution.
 * Integrates projected surface-normal visibility across 3 rotated hemisphere slices (18 horizon taps)
 * with thickness-aware distance falloff so foreground furniture legs never cast halos onto far walls.
 */
export function evaluateHalfResGtao(
  depthNode: ShaderNodeObject<TextureNode>,
  hUv: ShaderNodeObject<Node>,
  hRawDepth: ShaderNodeObject<Node>,
  uniforms: GtaoAndContactShadowUniforms
): ShaderNodeObject<Node> {
  const {
    uProjMatrix,
    uProjMatrixInverse,
    uHalfTexelSize,
    uIsOrtho,
    uOrthoEquivDepth,
    uAoIntensity,
  } = uniforms;

  const aoOut = float(1.0).toVar();
  const centerViewPos = getViewPosition(hUv, hRawDepth, uProjMatrixInverse).toVar();
  const scaleDist = select(
    uIsOrtho.greaterThan(0.5),
    uOrthoEquivDepth,
    max(0.22, centerViewPos.z.negate())
  ).toVar();

  If(uAoIntensity.greaterThan(0.001).and(scaleDist.lessThan(26.0)), () => {
    const viewNormal = reconstructMinDeltaViewNormal(
      depthNode,
      hUv,
      centerViewPos,
      uHalfTexelSize,
      uProjMatrixInverse
    ).toVar();

    const viewDir = select(
      uIsOrtho.greaterThan(0.5),
      vec3(0.0, 0.0, 1.0),
      normalize(centerViewPos.negate())
    ).toVar();

    const worldRadius = clamp(scaleDist.mul(0.135), 0.085, 0.44).toVar();
    const normalBias = viewNormal.mul(clamp(scaleDist.mul(0.0022), 0.0012, 0.009)).toVar();
    const ignAngle = spatialInterleavedGradientNoise(screenCoordinate.xy).mul(PI).toVar();
    const ignRadial = spatialInterleavedGradientNoise(
      screenCoordinate.xy.add(vec2(19.0, 37.0))
    ).toVar();

    const visAccum = float(0.0).toVar();

    for (let s = 0; s < GTAO_SLICE_COUNT; s++) {
      const sliceAngle = ignAngle.add(float(s / GTAO_SLICE_COUNT).mul(PI));
      const sampleDir = vec3(cos(sliceAngle), sin(sliceAngle), 0.0).toVar();
      const rawBitangent = cross(sampleDir, viewDir);
      const sliceBitangent = normalize(
        select(dot(rawBitangent, rawBitangent).greaterThan(1e-8), rawBitangent, vec3(0.0, 1.0, 0.0))
      ).toVar();
      const sliceTangent = cross(sliceBitangent, viewDir).toVar();

      const rawProjNormal = viewNormal.sub(sliceBitangent.mul(dot(viewNormal, sliceBitangent))).toVar();
      const projNormLen = clamp(
        sqrt(max(1e-6, dot(rawProjNormal, rawProjNormal))),
        0.05,
        1.0
      ).toVar();
      const normalInSlice = rawProjNormal.div(projNormLen).toVar();
      const tangentToNormal = cross(normalInSlice, sliceBitangent).toVar();

      const cosHx = clamp(dot(viewDir, tangentToNormal), -1.0, 1.0).toVar();
      const cosHy = clamp(dot(viewDir, tangentToNormal.negate()), -1.0, 1.0).toVar();

      for (let j = 0; j < GTAO_STEPS_PER_SIDE; j++) {
        const tFrac = float(j)
          .add(float(0.32).add(ignRadial.mul(0.58)))
          .div(float(GTAO_STEPS_PER_SIDE));
        const stepMeters = worldRadius.mul(float(0.15).add(tFrac.mul(tFrac).mul(0.85)));
        const viewOffset = sampleDir.mul(stepMeters);

        const uvPos = getScreenPosition(centerViewPos.add(viewOffset), uProjMatrix).toVar();
        const depthPos = sampleClampedDepth(depthNode, uvPos).toVar();
        If(depthPos.lessThan(0.9999), () => {
          const samplePos = getViewPosition(uvPos, depthPos, uProjMatrixInverse);
          const delta = samplePos.sub(centerViewPos).sub(normalBias).toVar();
          const distSq = dot(delta, delta);
          If(distSq.greaterThan(1e-7), () => {
            const dist = sqrt(distSq);
            const falloff = float(1.0)
              .sub(smoothstep(worldRadius.mul(0.62), worldRadius.mul(1.28), dist))
              .mul(float(1.0).sub(smoothstep(worldRadius.mul(0.85), worldRadius.mul(1.35), abs(delta.z))));
            const shc = dot(viewDir, delta.div(dist));
            cosHx.addAssign(max(0.0, shc.sub(cosHx).mul(falloff)));
          });
        });

        const uvNeg = getScreenPosition(centerViewPos.sub(viewOffset), uProjMatrix).toVar();
        const depthNeg = sampleClampedDepth(depthNode, uvNeg).toVar();
        If(depthNeg.lessThan(0.9999), () => {
          const sampleNeg = getViewPosition(uvNeg, depthNeg, uProjMatrixInverse);
          const deltaNeg = sampleNeg.sub(centerViewPos).sub(normalBias).toVar();
          const distSqNeg = dot(deltaNeg, deltaNeg);
          If(distSqNeg.greaterThan(1e-7), () => {
            const distNeg = sqrt(distSqNeg);
            const falloffNeg = float(1.0)
              .sub(smoothstep(worldRadius.mul(0.62), worldRadius.mul(1.28), distNeg))
              .mul(
                float(1.0).sub(
                  smoothstep(worldRadius.mul(0.85), worldRadius.mul(1.35), abs(deltaNeg.z))
                )
              );
            const shcNeg = dot(viewDir, deltaNeg.div(distNeg));
            cosHy.addAssign(max(0.0, shcNeg.sub(cosHy).mul(falloffNeg)));
          });
        });
      }

      const cx = clamp(cosHx, -1.0, 1.0).toVar();
      const cy = clamp(cosHy, -1.0, 1.0).toVar();
      const sx = sqrt(max(0.0, float(1.0).sub(cx.mul(cx))));
      const sy = sqrt(max(0.0, float(1.0).sub(cy.mul(cy))));
      const nx = dot(normalInSlice, sliceTangent);
      const ny = dot(normalInSlice, viewDir);
      const nxb = float(0.5).mul(acos(cy).sub(acos(cx)).add(sx.mul(cx).sub(sy.mul(cy))));
      const nyb = float(0.5).mul(float(2.0).sub(cx.mul(cx)).sub(cy.mul(cy)));
      visAccum.addAssign(projNormLen.mul(nx.mul(nxb).add(ny.mul(nyb))));
    }

    const rawVisibility = clamp(visAccum.div(float(GTAO_SLICE_COUNT)), 0.0, 1.0);
    const distanceFade = float(1.0).sub(smoothstep(16.0, 25.0, scaleDist));
    const shapedAo = pow(rawVisibility, uAoIntensity.mul(1.85));
    aoOut.assign(clamp(mix(float(1.0), shapedAo, distanceFade), 0.36, 1.0));
  });

  return aoOut;
}

/**
 * Depth + plane-slope bilateral 5-tap cross upsample of half-resolution GTAO (`halfResFxRtt.a`),
 * preventing dark floor or furniture occlusion from bleeding across foreground silhouettes.
 */
export function upsampleBilateralGtao(
  halfResFxRtt: ShaderNodeObject<RTTNode>,
  depthNode: ShaderNodeObject<TextureNode>,
  vUv: ShaderNodeObject<Node>,
  centerViewPos: ShaderNodeObject<Node>,
  centerViewNormal: ShaderNodeObject<Node>,
  uniforms: GtaoAndContactShadowUniforms
): ShaderNodeObject<Node> {
  const { uHalfTexelSize, uProjMatrixInverse } = uniforms;
  const sampleHalfAo = (uvCoord: ShaderNodeObject<Node>): ShaderNodeObject<Node> =>
    (
      (halfResFxRtt as unknown as ShaderNodeObject<TextureNode>).sample(
        clamp(uvCoord, 0.001, 0.999)
      ) as unknown as ShaderNodeObject<TextureNode>
    ).level(float(0)).a;

  const invSigma = float(1.0).div(max(0.014, abs(centerViewPos.z).mul(0.022))).toVar();
  const centerAo = sampleHalfAo(vUv).toVar();
  const weightedSum = centerAo.mul(1.5).toVar();
  const weightTotal = float(1.5).toVar();

  const offsets: readonly ShaderNodeObject<Node>[] = [
    vec2(uHalfTexelSize.x, 0.0),
    vec2(uHalfTexelSize.x.negate(), 0.0),
    vec2(0.0, uHalfTexelSize.y),
    vec2(0.0, uHalfTexelSize.y.negate()),
  ];

  for (const off of offsets) {
    const tapUv = clamp(vUv.add(off), 0.001, 0.999);
    const tapDepth = sampleClampedDepth(depthNode, tapUv);
    const tapPos = getViewPosition(tapUv, tapDepth, uProjMatrixInverse);
    const planeDist = abs(dot(tapPos.sub(centerViewPos), centerViewNormal));
    const zGap = abs(tapPos.z.sub(centerViewPos.z));
    const w = exp(planeDist.mul(3.5).add(zGap.mul(0.65)).mul(invSigma).negate()).mul(
      select(tapDepth.lessThan(0.9999), float(1.0), float(0.0))
    );
    weightedSum.addAssign(sampleHalfAo(tapUv).mul(w));
    weightTotal.addAssign(w);
  }

  return clamp(weightedSum.div(max(1e-4, weightTotal)), 0.36, 1.0);
}

/**
 * Full-resolution thickness-bounded Screen-Space Contact Shadows (10 steps covering ~5–20 cm)
 * marching toward `uSunViewDir` so chair legs, table feet, skirting quirks, window mullions,
 * frames, hardware, and cobbles cast crisp grounded micro-shadows without peter-panning.
 */
export function evaluateScreenSpaceContactShadow(
  depthNode: ShaderNodeObject<TextureNode>,
  centerViewPos: ShaderNodeObject<Node>,
  centerViewNormal: ShaderNodeObject<Node>,
  scaleDist: ShaderNodeObject<Node>,
  uniforms: GtaoAndContactShadowUniforms
): ShaderNodeObject<Node> {
  const { uProjMatrix, uProjMatrixInverse, uSunViewDir, uContactShadowStrength, uAoIntensity } =
    uniforms;

  const shadowVis = float(1.0).toVar();
  const activeStrength = uContactShadowStrength.mul(smoothstep(0.0, 0.15, uAoIntensity)).toVar();

  If(activeStrength.greaterThan(0.005).and(scaleDist.lessThan(26.0)), () => {
    const nDotL = dot(centerViewNormal, uSunViewDir).toVar();
    const facingWeight = smoothstep(-0.03, 0.14, nDotL).toVar();

    If(facingWeight.greaterThan(0.005), () => {
      const rayLength = clamp(scaleDist.mul(0.044), 0.055, 0.2).toVar();
      const maxThickness = clamp(rayLength.mul(0.58), 0.038, 0.13).toVar();
      const originBias = clamp(scaleDist.mul(0.0016), 0.001, 0.007);
      const rayOrigin = centerViewPos.add(centerViewNormal.mul(originBias)).toVar();
      const jitter = spatialInterleavedGradientNoise(
        screenCoordinate.xy.add(vec2(43.0, 11.0))
      ).toVar();

      const maxOcclusion = float(0.0).toVar();

      for (let i = 0; i < CONTACT_SHADOW_STEPS; i++) {
        const sNorm = float(i)
          .add(float(0.3).add(jitter.mul(0.55)))
          .div(float(CONTACT_SHADOW_STEPS));
        const tMeters = rayLength.mul(sNorm.mul(0.28).add(sNorm.mul(sNorm).mul(0.72)));
        const rayPos = rayOrigin.add(uSunViewDir.mul(tMeters)).toVar();
        const rayUv = getScreenPosition(rayPos, uProjMatrix).toVar();

        const inViewport = rayUv.x
          .greaterThan(0.0015)
          .and(rayUv.x.lessThan(0.9985))
          .and(rayUv.y.greaterThan(0.0015))
          .and(rayUv.y.lessThan(0.9985));

        If(inViewport, () => {
          const sampleD = depthNode.sample(rayUv).r;
          If(sampleD.lessThan(0.9999), () => {
            const scenePos = getViewPosition(rayUv, sampleD, uProjMatrixInverse);
            const depthDiff = scenePos.z.sub(rayPos.z);
            const minBias = float(0.0014).add(tMeters.mul(0.024)).add(scaleDist.mul(0.0007));

            const enterHit = smoothstep(minBias, minBias.mul(2.4).add(0.002), depthDiff);
            const thicknessExit = float(1.0).sub(
              smoothstep(maxThickness.mul(0.62), maxThickness, depthDiff)
            );
            const stepAtten = float(1.0).sub(sNorm.mul(0.42));
            maxOcclusion.assign(max(maxOcclusion, enterHit.mul(thicknessExit).mul(stepAtten)));
          });
        });
      }

      const distFade = float(1.0).sub(smoothstep(17.0, 26.0, scaleDist));
      const contactDarken = maxOcclusion
        .mul(activeStrength)
        .mul(facingWeight)
        .mul(distFade)
        .mul(0.46);
      shadowVis.assign(clamp(float(1.0).sub(contactDarken), 0.48, 1.0));
    });
  });

  return shadowVis;
}

/**
 * Applies Jimenez multi-bounce colored ambient occlusion (preserving warm plaster & cornice bounce
 * instead of grey corner soot), Specular AO highlight damping, Screen-Space Contact Shadows,
 * and subtle close-up (< 1.85 m) world-space triplanar plaster micro-relief.
 */
export const applyPhotorealismShading = Fn(
  ([
    hdrColorIn,
    gtaoVisIn,
    contactShadowVisIn,
    centerViewPosIn,
    centerViewNormalIn,
    scaleDistIn,
    localLumaSpanIn,
    uCameraWorldMatrix,
    uSunWorldDir,
  ]: [
    ShaderNodeObject<Node>,
    ShaderNodeObject<Node>,
    ShaderNodeObject<Node>,
    ShaderNodeObject<Node>,
    ShaderNodeObject<Node>,
    ShaderNodeObject<Node>,
    ShaderNodeObject<Node>,
    ShaderNodeObject<UniformNode<THREE.Matrix4>>,
    ShaderNodeObject<UniformNode<THREE.Vector3>>,
  ]) => {
    const hdr = vec3(hdrColorIn).toVar();
    const gtao = clamp(gtaoVisIn, 0.0, 1.0).toVar();
    const contactVis = clamp(contactShadowVisIn, 0.0, 1.0).toVar();

    const peakChannel = max(hdr.r, max(hdr.g, hdr.b));
    const estAlbedo = clamp(
      hdr.div(max(0.16, peakChannel.add(0.14))).add(vec3(0.03, 0.024, 0.016)),
      vec3(0.08),
      vec3(0.86)
    );
    const multiBounceAo = clamp(
      vec3(gtao).div(max(vec3(0.18), vec3(1.0).sub(estAlbedo.mul(float(1.0).sub(gtao)).mul(0.72)))),
      0.0,
      1.0
    );

    const luma = dot(hdr, vec3(0.2126, 0.7152, 0.0722));
    const specMask = smoothstep(0.55, 1.85, luma);
    const combinedScalarVis = min(gtao, contactVis);
    const specularAo = clamp(pow(combinedScalarVis, float(1.32)), 0.25, 1.0);

    const diffuseShaded = hdr.mul(multiBounceAo).mul(contactVis);
    const specularDamped = hdr.mul(specularAo).mul(contactVis);
    hdr.assign(mix(diffuseShaded, specularDamped, specMask.mul(0.55)));

    If(scaleDistIn.lessThan(1.85), () => {
      const worldPos = uCameraWorldMatrix.mul(vec4(centerViewPosIn, 1.0)).xyz;
      const worldNormal = normalize(uCameraWorldMatrix.mul(vec4(centerViewNormalIn, 0.0)).xyz);
      const smoothSurfaceMask = float(1.0).sub(smoothstep(0.012, 0.048, localLumaSpanIn));
      const microStrength = float(0.068).mul(smoothSurfaceMask);
      const relief = buildCloseUpTriplanarMicroReliefNode(
        worldPos,
        worldNormal,
        vec3(uSunWorldDir),
        scaleDistIn,
        microStrength
      );
      hdr.mulAssign(relief);
    });

    return max(vec3(0.0), hdr);
  }
);
