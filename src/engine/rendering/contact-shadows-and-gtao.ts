/**
 * Horizon-Based Ground-Truth Ambient Occlusion (GTAO), Separable Two-Pass Scalar-Linear-Z
 * Bilateral Denoising, 4-Tap Bilateral Upsampling, Multi-Bounce & Specular AO, and Unified
 * Multi-Scale Screen-Space Contact Shadows (SSCS) in TSL.
 *
 * Compatible with both `WebGPUCoordinateSystem` and `WebGLCoordinateSystem` (`?forceWebGL=1`),
 * perspective and orthographic cameras, and 0 Hz demand-driven idle sleep (purely spatial
 * sampling with zero temporal frame accumulation).
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
  int,
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

export interface BilateralDenoiseSampleCpu {
  readonly ao: number;
  readonly contact?: number;
  readonly viewPos: THREE.Vector3;
  readonly viewNormal: THREE.Vector3;
  readonly isSky?: boolean;
}

export interface BilateralDenoisedValueCpu {
  readonly ao: number;
  readonly contact: number;
}

export const GTAO_SLICE_COUNT = 2;
export const GTAO_STEPS_PER_SIDE = 3;
export const CONTACT_SHADOW_STEPS = 8;
export const BILATERAL_KERNEL_RADIUS = 3;
export const BILATERAL_SPATIAL_SIGMA = 1.85;

/** Safe viewport UV margin so horizon / contact-shadow taps never sample clamped border depth. */
export const VIEWPORT_SAFE_UV_MIN = 0.002;
export const VIEWPORT_SAFE_UV_MAX = 0.998;

/** Maximum perspective GTAO search radius as a fraction of `|viewZ|` (`worldRadius / scaleDist`). */
export const GTAO_MAX_REL_SCREEN_RADIUS = 0.135;

/** Minimum `dot(N, L)` for a surface to receive direct sun and screen-space sun contact shadows. */
export const CONTACT_SHADOW_MIN_NDOTL = 0.05;

/**
 * Minimum elevation (metres) above the receiver tangent plane required for a GTAO horizon tap
 * to register occlusion. Set above 5 mm heritage lime-plaster undulation so flat or hand-trowelled
 * oblique walls never self-occlude as the 1PV camera moves.
 */
export const GTAO_MIN_PLANE_ELEV_M = 0.006;

/** Close-up plaster micro-relief outer fade distance (metres), matching micro-surface-detail.ts. */
export const CLOSE_UP_MICRO_RELIEF_MAX_DIST_M = 1.95;

const sunPosScratch = new THREE.Vector3();
const targetPosScratch = new THREE.Vector3();
const worldDirScratch = new THREE.Vector3();

/**
 * Pure CPU reference for scalar linear view-Z reconstruction directly from raw depth and
 * `projectionMatrix` elements `[10]` and `[14]` (3 scalar ops, zero 4x4 matrix multiplies).
 */
export function reconstructLinearViewZCpu(
  rawDepth: number,
  projMatrix: THREE.Matrix4,
  isOrtho: boolean,
  isWebGPU = true
): number {
  const clipZ = isWebGPU ? rawDepth : rawDepth * 2.0 - 1.0;
  const e = projMatrix.elements;
  const p10 = e[10]!;
  const p14 = e[14]!;
  if (isOrtho) {
    return (clipZ - p14) / p10;
  }
  return -p14 / (clipZ + p10);
}

/**
 * TSL scalar linear view-Z reconstruction directly from raw depth and `uProjMatrix`
 * (3 scalar ops, zero `4x4` `uProjMatrixInverse` matrix multiplies per denoiser/upsample tap).
 */
export const reconstructLinearViewZ = Fn(
  (
    [rawDepth, uProjMatrix, uIsOrtho]: [
      ShaderNodeObject<Node>,
      ShaderNodeObject<UniformNode<THREE.Matrix4>>,
      ShaderNodeObject<UniformNode<number>>,
    ],
    builder: { renderer?: { coordinateSystem?: THREE.CoordinateSystem } }
  ) => {
    const clipZ =
      builder?.renderer?.coordinateSystem === THREE.WebGPUCoordinateSystem
        ? rawDepth
        : rawDepth.mul(2.0).sub(1.0);
    const p10 = uProjMatrix.element(int(2)).z;
    const p14 = uProjMatrix.element(int(3)).z;
    const perspViewZ = p14.negate().div(clipZ.add(p10));
    const orthoViewZ = clipZ.sub(p14).div(p10);
    return select(uIsOrtho.greaterThan(0.5), orthoViewZ, perspViewZ);
  }
);

function pow16FastNode(dotVal: ShaderNodeObject<Node>): ShaderNodeObject<Node> {
  const d = max(0.0, dotVal).toVar();
  const d2 = d.mul(d).toVar();
  const d4 = d2.mul(d2).toVar();
  const d8 = d4.mul(d4).toVar();
  return d8.mul(d8);
}

function pow16FastCpu(dotVal: number): number {
  const d = Math.max(0.0, dotVal);
  const d2 = d * d;
  const d4 = d2 * d2;
  const d8 = d4 * d4;
  return d8 * d8;
}

/**
 * Pure CPU reference for the perspective-capped GTAO world-space search radius (metres)
 * and close-range 1PV strength scale at `scaleDist` (`-viewZ` in metres).
 */
export function computeGtaoRadiusAndCloseRangeWeight(scaleDistMeters: number): {
  readonly worldRadiusM: number;
  readonly closeRangeWeight: number;
} {
  const safeDist = Math.max(0.1, scaleDistMeters);
  const worldRadiusM = THREE.MathUtils.clamp(safeDist * GTAO_MAX_REL_SCREEN_RADIUS, 0.024, 0.44);
  const closeRangeWeight = THREE.MathUtils.smoothstep(safeDist, 0.28, 0.85);
  return { worldRadiusM, closeRangeWeight };
}

/**
 * Pure CPU reference check for whether a screen-space UV tap lies strictly inside the valid
 * un-clamped viewport (`[0.002, 0.998]^2`).
 */
export function isScreenUvInsideSafeViewport(u: number, v: number): boolean {
  return (
    u > VIEWPORT_SAFE_UV_MIN &&
    u < VIEWPORT_SAFE_UV_MAX &&
    v > VIEWPORT_SAFE_UV_MIN &&
    v < VIEWPORT_SAFE_UV_MAX
  );
}

/**
 * Pure CPU reference for octahedral unit-normal encoding (`[-1, 1]^2`).
 */
export function encodeOctNormalCpu(normal: THREE.Vector3): readonly [number, number] {
  const invL1 = 1 / Math.max(1e-6, Math.abs(normal.x) + Math.abs(normal.y) + Math.abs(normal.z));
  let ox = normal.x * invL1;
  let oy = normal.y * invL1;
  if (normal.z < 0) {
    const wrappedX = (1 - Math.abs(oy)) * (ox >= 0 ? 1 : -1);
    const wrappedY = (1 - Math.abs(ox)) * (oy >= 0 ? 1 : -1);
    ox = wrappedX;
    oy = wrappedY;
  }
  return [ox, oy];
}

/**
 * Pure CPU reference for octahedral unit-normal decoding.
 */
export function decodeOctNormalCpu(
  ox: number,
  oy: number,
  out = new THREE.Vector3()
): THREE.Vector3 {
  const nz = 1 - Math.abs(ox) - Math.abs(oy);
  const t = Math.max(0, -nz);
  const nx = ox + (ox >= 0 ? -t : t);
  const ny = oy + (oy >= 0 ? -t : t);
  return out.set(nx, ny, nz).normalize();
}

/**
 * Pure CPU reference for the 7-tap (`-3..+3`) scalar-linear-Z + normal-aware bilateral denoiser pass.
 * Matches `denoiseBilateralAoAndContactPass` spatial Gaussian (`sigma = 1.85`), scalar linear-Z
 * normal-projected depth weight, and 4-multiply `dot(N_c, N_t)^16` normal weight, preserving
 * exact `1.0` constant invariance on flat unoccluded walls while rejecting depth/normal edges.
 */
export function evaluateBilateralAoDenoise1DCpu(
  samples: readonly BilateralDenoiseSampleCpu[]
): BilateralDenoisedValueCpu[] {
  const n = samples.length;
  const out: BilateralDenoisedValueCpu[] = new Array(n);
  const centerNormal = new THREE.Vector3();
  const tapNormal = new THREE.Vector3();

  for (let i = 0; i < n; i++) {
    const center = samples[i]!;
    if (center.isSky) {
      out[i] = { ao: 1.0, contact: 1.0 };
      continue;
    }
    const [cox, coy] = encodeOctNormalCpu(center.viewNormal);
    decodeOctNormalCpu(cox, coy, centerNormal);
    const centerZ = center.viewPos.z;
    const normalZScale = Math.max(0.25, Math.abs(centerNormal.z));
    const invDepthSigma = 1.0 / Math.max(0.012, Math.abs(centerZ) * 0.022);

    let sumAo = center.ao;
    let sumContact = center.contact ?? 1.0;
    let weightTotal = 1.0;

    for (let k = -BILATERAL_KERNEL_RADIUS; k <= BILATERAL_KERNEL_RADIUS; k++) {
      if (k === 0) continue;
      const idx = i + k;
      if (idx < 0 || idx >= n) continue;
      const tap = samples[idx]!;
      if (tap.isSky) continue;

      const wSpatial = Math.exp(
        -0.5 * (k / BILATERAL_SPATIAL_SIGMA) * (k / BILATERAL_SPATIAL_SIGMA)
      );
      const zDiff = Math.abs(tap.viewPos.z - centerZ) * normalZScale;
      const wDepth = Math.exp(-zDiff * invDepthSigma);

      const [tox, toy] = encodeOctNormalCpu(tap.viewNormal);
      decodeOctNormalCpu(tox, toy, tapNormal);
      const wNormal = pow16FastCpu(centerNormal.dot(tapNormal));

      const w = wSpatial * wDepth * wNormal;
      sumAo += tap.ao * w;
      sumContact += (tap.contact ?? 1.0) * w;
      weightTotal += w;
    }

    out[i] = {
      ao: sumAo / weightTotal,
      contact: sumContact / weightTotal,
    };
  }

  return out;
}

/**
 * Pure CPU reference for the two-pass separable (Horizontal -> Vertical) 7x7 bilateral denoiser.
 */
export function evaluateSeparableBilateralAoDenoise2DCpu(
  grid: readonly (readonly BilateralDenoiseSampleCpu[])[]
): BilateralDenoisedValueCpu[][] {
  const height = grid.length;
  if (height === 0) return [];
  const width = grid[0]!.length;

  const hPassGrid: BilateralDenoiseSampleCpu[][] = Array.from({ length: height }, (_, y) => {
    const row = grid[y]!;
    const denoisedRow = evaluateBilateralAoDenoise1DCpu(row);
    return row.map((cell, x) => ({
      ao: denoisedRow[x]!.ao,
      contact: denoisedRow[x]!.contact,
      viewPos: cell.viewPos,
      viewNormal: cell.viewNormal,
      isSky: cell.isSky,
    }));
  });

  const vOut: BilateralDenoisedValueCpu[][] = Array.from({ length: height }, () =>
    new Array<BilateralDenoisedValueCpu>(width)
  );
  for (let x = 0; x < width; x++) {
    const col = Array.from({ length: height }, (_, y) => hPassGrid[y]![x]!);
    const denoisedCol = evaluateBilateralAoDenoise1DCpu(col);
    for (let y = 0; y < height; y++) {
      vOut[y]![x] = denoisedCol[y]!;
    }
  }
  return vOut;
}

/**
 * Pure CPU reference for the view-ray-orthogonal, unoccluded-normalized GTAO slice estimator.
 * Verifies that any unoccluded flat wall at any oblique angle and off-axis view ray produces
 * exact `rawVisibility = 1.0` (eliminating camera-following oblique wall darkening bands),
 * while genuine architectural corners (`horizonElevRad > 0`) produce physical occlusion.
 */
export function evaluateNormalizedGtaoVisibilityCpu(
  viewPos: THREE.Vector3,
  viewNormal: THREE.Vector3,
  ignAngleRad = 0.7,
  extraHorizonRad = 0
): number {
  const viewDir = viewPos.clone().negate().normalize();
  const unitNormal = viewNormal.clone().normalize();
  const refUp =
    Math.abs(viewDir.y) < 0.999 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const basisX = new THREE.Vector3().crossVectors(refUp, viewDir).normalize();
  const basisY = new THREE.Vector3().crossVectors(viewDir, basisX);

  let visAccum = 0;
  let unoccludedAccum = 0;

  const integrateHalfSlice = (
    projNormLen: number,
    nx: number,
    ny: number,
    cPos: number,
    cNeg: number
  ): number => {
    const sPos = Math.sqrt(Math.max(0, 1 - cPos * cPos));
    const sNeg = Math.sqrt(Math.max(0, 1 - cNeg * cNeg));
    const thPos = Math.acos(THREE.MathUtils.clamp(cPos, -1, 1));
    const thNeg = Math.acos(THREE.MathUtils.clamp(cNeg, -1, 1));
    const termPos = ny * (1 - cPos * cPos) + nx * (thPos - sPos * cPos);
    const termNeg = ny * (1 - cNeg * cNeg) - nx * (thNeg - sNeg * cNeg);
    return projNormLen * 0.25 * Math.max(0, termPos + termNeg);
  };

  for (let s = 0; s < GTAO_SLICE_COUNT; s++) {
    const sliceAngle = ignAngleRad + (s / GTAO_SLICE_COUNT) * Math.PI;
    const sampleDir = basisX
      .clone()
      .multiplyScalar(Math.cos(sliceAngle))
      .addScaledVector(basisY, Math.sin(sliceAngle));
    const sliceBitangent = new THREE.Vector3().crossVectors(sampleDir, viewDir).normalize();
    const rawProjNormal = unitNormal
      .clone()
      .sub(sliceBitangent.clone().multiplyScalar(unitNormal.dot(sliceBitangent)));
    const projNormLen = THREE.MathUtils.clamp(
      Math.sqrt(Math.max(1e-6, rawProjNormal.dot(rawProjNormal))),
      0.05,
      1.0
    );
    const normalInSlice = rawProjNormal.divideScalar(projNormLen);
    const tangentToNormal = new THREE.Vector3().crossVectors(normalInSlice, sliceBitangent);

    const cx0 = THREE.MathUtils.clamp(viewDir.dot(tangentToNormal), -1, 1);
    const cy0 = THREE.MathUtils.clamp(viewDir.dot(tangentToNormal.clone().negate()), -1, 1);
    const nx = normalInSlice.dot(sampleDir);
    const ny = normalInSlice.dot(viewDir);

    const baseVis = integrateHalfSlice(projNormLen, nx, ny, cx0, cy0);
    unoccludedAccum += baseVis;

    const thPos = Math.max(0, Math.acos(cx0) - extraHorizonRad);
    const thNeg = Math.max(0, Math.acos(cy0) - extraHorizonRad);
    visAccum += integrateHalfSlice(projNormLen, nx, ny, Math.cos(thPos), Math.cos(thNeg));
  }

  return THREE.MathUtils.clamp(visAccum / Math.max(1e-4, unoccludedAccum), 0, 1);
}

export function computeContactShadowFacingAndBias(
  nDotL: number,
  nDotV: number,
  tMeters: number,
  scaleDistMeters: number
): {
  readonly facingWeight: number;
  readonly minBiasM: number;
} {
  const facingWeight =
    nDotL <= CONTACT_SHADOW_MIN_NDOTL
      ? 0.0
      : THREE.MathUtils.smoothstep(nDotL, CONTACT_SHADOW_MIN_NDOTL, 0.2);
  const grazingScale = 1.0 / Math.max(0.15, nDotV);
  const baseBias = 0.0016 + tMeters * 0.026 + Math.max(0.1, scaleDistMeters) * 0.0008;
  return {
    facingWeight,
    minBiasM: baseBias * grazingScale,
  };
}

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

/**
 * Samples a single-sample scene depth node (`DepthTexture` or resolved `RedFormat` `FloatType` `RTTNode`)
 * at explicit mip level 0 so WGSL never requires implicit screen-space derivatives inside non-uniform branches.
 */
export function sampleDepthLevel0(
  depthNode: ShaderNodeObject<TextureNode>,
  sampleUv: ShaderNodeObject<Node>
): ShaderNodeObject<Node> {
  return (depthNode.sample(sampleUv) as unknown as ShaderNodeObject<TextureNode>).level(float(0)).r;
}

function sampleClampedDepth(
  depthNode: ShaderNodeObject<TextureNode>,
  sampleUv: ShaderNodeObject<Node>
): ShaderNodeObject<Node> {
  return sampleDepthLevel0(depthNode, clamp(sampleUv, 0.001, 0.999));
}

function sampleRttLevel0(
  rttNode: ShaderNodeObject<RTTNode>,
  sampleUv: ShaderNodeObject<Node>
): ShaderNodeObject<Node> {
  return (
    (rttNode as unknown as ShaderNodeObject<TextureNode>).sample(
      clamp(sampleUv, 0.001, 0.999)
    ) as unknown as ShaderNodeObject<TextureNode>
  ).level(float(0));
}

function isUvInSafeViewportNode(sampleUv: ShaderNodeObject<Node>): ShaderNodeObject<Node> {
  return sampleUv.x
    .greaterThan(VIEWPORT_SAFE_UV_MIN)
    .and(sampleUv.x.lessThan(VIEWPORT_SAFE_UV_MAX))
    .and(sampleUv.y.greaterThan(VIEWPORT_SAFE_UV_MIN))
    .and(sampleUv.y.lessThan(VIEWPORT_SAFE_UV_MAX));
}

/**
 * Encodes a unit view-space normal into octahedral `[-1, 1]^2` coordinates for packing into `.zw`
 * of `HalfFloatType` AO/contact buffers.
 */
export function encodeOctNormalNode(unitNormal: ShaderNodeObject<Node>): ShaderNodeObject<Node> {
  const n = unitNormal.toVar();
  const invL1 = float(1.0).div(max(1e-6, abs(n.x).add(abs(n.y)).add(abs(n.z))));
  const p = n.xy.mul(invL1).toVar();
  const signX = select(p.x.greaterThanEqual(0.0), float(1.0), float(-1.0));
  const signY = select(p.y.greaterThanEqual(0.0), float(1.0), float(-1.0));
  const wrapped = vec2(float(1.0).sub(abs(p.y)).mul(signX), float(1.0).sub(abs(p.x)).mul(signY));
  return select(n.z.lessThan(0.0), wrapped, p);
}

/**
 * Decodes an octahedral `[-1, 1]^2` normal back into a unit `vec3` view-space normal.
 */
export function decodeOctNormalNode(oct: ShaderNodeObject<Node>): ShaderNodeObject<Node> {
  const e = oct.toVar();
  const nz = float(1.0).sub(abs(e.x)).sub(abs(e.y)).toVar();
  const t = max(0.0, nz.negate()).toVar();
  const nx = e.x.add(select(e.x.greaterThanEqual(0.0), t.negate(), t));
  const ny = e.y.add(select(e.y.greaterThanEqual(0.0), t.negate(), t));
  return normalize(vec3(nx, ny, nz));
}

/**
 * Reconstructs view-space surface normal from depth using closest-depth-delta neighbor taps
 * so foreground silhouettes and viewport borders never produce false bevels or tilted normals.
 */
export function reconstructMinDeltaViewNormal(
  depthNode: ShaderNodeObject<TextureNode>,
  centerUv: ShaderNodeObject<Node>,
  centerViewPos: ShaderNodeObject<Node>,
  stepUv: ShaderNodeObject<UniformNode<THREE.Vector2>>,
  uProjMatrixInverse: ShaderNodeObject<UniformNode<THREE.Matrix4>>
): ShaderNodeObject<Node> {
  const rawUvR = centerUv.add(vec2(stepUv.x, 0.0));
  const rawUvL = centerUv.sub(vec2(stepUv.x, 0.0));
  const rawUvD = centerUv.add(vec2(0.0, stepUv.y));
  const rawUvU = centerUv.sub(vec2(0.0, stepUv.y));

  const uvR = clamp(rawUvR, 0.001, 0.999).toVar();
  const uvL = clamp(rawUvL, 0.001, 0.999).toVar();
  const uvD = clamp(rawUvD, 0.001, 0.999).toVar();
  const uvU = clamp(rawUvU, 0.001, 0.999).toVar();

  const posR = getViewPosition(uvR, sampleDepthLevel0(depthNode, uvR), uProjMatrixInverse).toVar();
  const posL = getViewPosition(uvL, sampleDepthLevel0(depthNode, uvL), uProjMatrixInverse).toVar();
  const posD = getViewPosition(uvD, sampleDepthLevel0(depthNode, uvD), uProjMatrixInverse).toVar();
  const posU = getViewPosition(uvU, sampleDepthLevel0(depthNode, uvU), uProjMatrixInverse).toVar();

  const validR = rawUvR.x.lessThan(0.999);
  const validL = rawUvL.x.greaterThan(0.001);
  const closerR = abs(posR.z.sub(centerViewPos.z)).lessThan(abs(centerViewPos.z.sub(posL.z)));
  const useRight = select(validR.and(validL), closerR, validR);
  const dpdx = select(useRight, posR.sub(centerViewPos), centerViewPos.sub(posL));

  const validD = rawUvD.y.lessThan(0.999);
  const validU = rawUvU.y.greaterThan(0.001);
  const closerU = abs(posU.z.sub(centerViewPos.z)).lessThan(abs(centerViewPos.z.sub(posD.z)));
  const useUp = select(validU.and(validD), closerU, validU);
  const dpdyUp = select(useUp, posU.sub(centerViewPos), centerViewPos.sub(posD));

  const rawCross = cross(dpdx, dpdyUp);
  return normalize(
    select(dot(rawCross, rawCross).greaterThan(1e-12), rawCross, vec3(0.0, 0.0, 1.0))
  );
}

function evaluateHalfResGtaoWithNormal(
  depthNode: ShaderNodeObject<TextureNode>,
  centerViewPos: ShaderNodeObject<Node>,
  viewNormal: ShaderNodeObject<Node>,
  scaleDist: ShaderNodeObject<Node>,
  uniforms: GtaoAndContactShadowUniforms
): ShaderNodeObject<Node> {
  const { uProjMatrix, uProjMatrixInverse, uIsOrtho, uAoIntensity } = uniforms;
  const aoOut = float(1.0).toVar();

  If(uAoIntensity.greaterThan(0.001).and(scaleDist.lessThan(26.0)), () => {
    const viewDir = select(
      uIsOrtho.greaterThan(0.5),
      vec3(0.0, 0.0, 1.0),
      normalize(centerViewPos.negate())
    ).toVar();

    const nDotV = max(0.15, dot(viewNormal, viewDir)).toVar();
    const grazingBiasScale = float(1.0).div(nDotV).toVar();

    const worldRadius = clamp(scaleDist.mul(GTAO_MAX_REL_SCREEN_RADIUS), 0.024, 0.44).toVar();
    const normalBias = viewNormal
      .mul(clamp(scaleDist.mul(0.0025), 0.0015, 0.01).mul(grazingBiasScale))
      .toVar();
    const ignAngle = spatialInterleavedGradientNoise(screenCoordinate.xy).mul(PI).toVar();
    const ignRadial = spatialInterleavedGradientNoise(
      screenCoordinate.xy.add(vec2(19.0, 37.0))
    ).toVar();

    const refUp = select(
      abs(viewDir.y).lessThan(0.999),
      vec3(0.0, 1.0, 0.0),
      vec3(1.0, 0.0, 0.0)
    );
    const basisX = normalize(cross(refUp, viewDir)).toVar();
    const basisY = cross(viewDir, basisX).toVar();

    const visAccum = float(0.0).toVar();
    const unoccludedAccum = float(0.0).toVar();

    for (let s = 0; s < GTAO_SLICE_COUNT; s++) {
      const sliceAngle = ignAngle.add(float(s / GTAO_SLICE_COUNT).mul(PI));
      const sampleDir = basisX.mul(cos(sliceAngle)).add(basisY.mul(sin(sliceAngle))).toVar();
      const sliceBitangent = normalize(cross(sampleDir, viewDir)).toVar();

      const rawProjNormal = viewNormal
        .sub(sliceBitangent.mul(dot(viewNormal, sliceBitangent)))
        .toVar();
      const projNormLen = clamp(
        sqrt(max(1e-6, dot(rawProjNormal, rawProjNormal))),
        0.05,
        1.0
      ).toVar();
      const normalInSlice = rawProjNormal.div(projNormLen).toVar();
      const tangentToNormal = cross(normalInSlice, sliceBitangent).toVar();

      const cx0 = clamp(dot(viewDir, tangentToNormal), -1.0, 1.0).toVar();
      const cy0 = clamp(dot(viewDir, tangentToNormal.negate()), -1.0, 1.0).toVar();
      const cosHx = float(cx0).toVar();
      const cosHy = float(cy0).toVar();

      for (let j = 0; j < GTAO_STEPS_PER_SIDE; j++) {
        const tFrac = float(j)
          .add(float(0.32).add(ignRadial.mul(0.58)))
          .div(float(GTAO_STEPS_PER_SIDE));
        const stepMeters = worldRadius.mul(float(0.15).add(tFrac.mul(tFrac).mul(0.85)));
        const viewOffset = sampleDir.mul(stepMeters);

        const uvPos = getScreenPosition(centerViewPos.add(viewOffset), uProjMatrix).toVar();
        If(isUvInSafeViewportNode(uvPos), () => {
          const depthPos = sampleDepthLevel0(depthNode, uvPos).toVar();
          If(depthPos.lessThan(0.9999), () => {
            const samplePos = getViewPosition(uvPos, depthPos, uProjMatrixInverse);
            const rawDeltaPos = samplePos.sub(centerViewPos).toVar();
            const delta = rawDeltaPos.sub(normalBias).toVar();
            const distSq = dot(delta, delta);
            If(distSq.greaterThan(1e-7), () => {
              const dist = sqrt(distSq);
              const planeElev = dot(rawDeltaPos, viewNormal);
              const minPlaneElev = max(GTAO_MIN_PLANE_ELEV_M, dist.mul(0.038)).mul(
                grazingBiasScale
              );
              const planeGate = smoothstep(minPlaneElev, minPlaneElev.mul(2.4), planeElev);
              const falloff = planeGate
                .mul(float(1.0).sub(smoothstep(worldRadius.mul(0.62), worldRadius.mul(1.28), dist)))
                .mul(
                  float(1.0).sub(
                    smoothstep(worldRadius.mul(0.85), worldRadius.mul(1.35), abs(delta.z))
                  )
                );
              const shc = dot(viewDir, delta.div(dist));
              cosHx.addAssign(max(0.0, shc.sub(cosHx).mul(falloff)));
            });
          });
        });

        const uvNeg = getScreenPosition(centerViewPos.sub(viewOffset), uProjMatrix).toVar();
        If(isUvInSafeViewportNode(uvNeg), () => {
          const depthNeg = sampleDepthLevel0(depthNode, uvNeg).toVar();
          If(depthNeg.lessThan(0.9999), () => {
            const sampleNeg = getViewPosition(uvNeg, depthNeg, uProjMatrixInverse);
            const rawDeltaNeg = sampleNeg.sub(centerViewPos).toVar();
            const deltaNeg = rawDeltaNeg.sub(normalBias).toVar();
            const distSqNeg = dot(deltaNeg, deltaNeg);
            If(distSqNeg.greaterThan(1e-7), () => {
              const distNeg = sqrt(distSqNeg);
              const planeElevNeg = dot(rawDeltaNeg, viewNormal);
              const minPlaneElevNeg = max(GTAO_MIN_PLANE_ELEV_M, distNeg.mul(0.038)).mul(
                grazingBiasScale
              );
              const planeGateNeg = smoothstep(
                minPlaneElevNeg,
                minPlaneElevNeg.mul(2.4),
                planeElevNeg
              );
              const falloffNeg = planeGateNeg
                .mul(
                  float(1.0).sub(smoothstep(worldRadius.mul(0.62), worldRadius.mul(1.28), distNeg))
                )
                .mul(
                  float(1.0).sub(
                    smoothstep(worldRadius.mul(0.85), worldRadius.mul(1.35), abs(deltaNeg.z))
                  )
                );
              const shcNeg = dot(viewDir, deltaNeg.div(distNeg));
              cosHy.addAssign(max(0.0, shcNeg.sub(cosHy).mul(falloffNeg)));
            });
          });
        });
      }

      const nx = dot(normalInSlice, sampleDir).toVar();
      const ny = dot(normalInSlice, viewDir).toVar();

      const sx0 = sqrt(max(0.0, float(1.0).sub(cx0.mul(cx0))));
      const sy0 = sqrt(max(0.0, float(1.0).sub(cy0.mul(cy0))));
      const thP0 = acos(cx0);
      const thN0 = acos(cy0);
      const baseTerm = ny
        .mul(float(2.0).sub(cx0.mul(cx0)).sub(cy0.mul(cy0)))
        .add(nx.mul(thP0.sub(sx0.mul(cx0)).sub(thN0.sub(sy0.mul(cy0)))));
      unoccludedAccum.addAssign(projNormLen.mul(0.25).mul(max(0.0, baseTerm)));

      const cx = clamp(cosHx, -1.0, 1.0).toVar();
      const cy = clamp(cosHy, -1.0, 1.0).toVar();
      const sx = sqrt(max(0.0, float(1.0).sub(cx.mul(cx))));
      const sy = sqrt(max(0.0, float(1.0).sub(cy.mul(cy))));
      const thP = acos(cx);
      const thN = acos(cy);
      const occTerm = ny
        .mul(float(2.0).sub(cx.mul(cx)).sub(cy.mul(cy)))
        .add(nx.mul(thP.sub(sx.mul(cx)).sub(thN.sub(sy.mul(cy)))));
      visAccum.addAssign(projNormLen.mul(0.25).mul(max(0.0, occTerm)));
    }

    const rawVisibility = clamp(visAccum.div(max(1e-4, unoccludedAccum)), 0.0, 1.0);
    const closeFade = select(
      uIsOrtho.greaterThan(0.5),
      float(1.0),
      smoothstep(0.28, 0.85, scaleDist)
    );
    const distanceFade = float(1.0).sub(smoothstep(16.0, 25.0, scaleDist)).mul(closeFade);
    const shapedAo = pow(rawVisibility, uAoIntensity.mul(1.85));
    aoOut.assign(clamp(mix(float(1.0), shapedAo, distanceFade), 0.36, 1.0));
  });

  return aoOut;
}

/**
 * Evaluates multi-slice cosine-space Ground-Truth Ambient Occlusion (Jimenez 2016) at half resolution.
 * Integrates projected surface-normal visibility across 2 rotated hemisphere slices (12 horizon taps)
 * with strict viewport-bounds rejection, close-range radius capping, and grazing-plane self-occlusion
 * rejection so walking beside oblique walls in 1PV produces zero camera-following dark bands.
 */
export function evaluateHalfResGtao(
  depthNode: ShaderNodeObject<TextureNode>,
  hUv: ShaderNodeObject<Node>,
  hRawDepth: ShaderNodeObject<Node>,
  uniforms: GtaoAndContactShadowUniforms
): ShaderNodeObject<Node> {
  const { uProjMatrixInverse, uHalfTexelSize, uIsOrtho, uOrthoEquivDepth } = uniforms;
  const centerViewPos = getViewPosition(hUv, hRawDepth, uProjMatrixInverse).toVar();
  const scaleDist = select(
    uIsOrtho.greaterThan(0.5),
    uOrthoEquivDepth,
    max(0.12, centerViewPos.z.negate())
  ).toVar();
  const viewNormal = reconstructMinDeltaViewNormal(
    depthNode,
    hUv,
    centerViewPos,
    uHalfTexelSize,
    uProjMatrixInverse
  ).toVar();
  return evaluateHalfResGtaoWithNormal(depthNode, centerViewPos, viewNormal, scaleDist, uniforms);
}

/**
 * Unified 8-step multi-scale Screen-Space Contact Shadows (`t = ((i + jitter) / 8)^1.6`) marching
 * toward `uSunViewDir` at half resolution, covering both `1–5 cm` close furniture grounding and
 * up to `55 cm` macro contact shadows in one pass before separable bilateral denoising.
 */
export function evaluateScreenSpaceContactShadow(
  depthNode: ShaderNodeObject<TextureNode>,
  centerViewPos: ShaderNodeObject<Node>,
  centerViewNormal: ShaderNodeObject<Node>,
  scaleDist: ShaderNodeObject<Node>,
  uniforms: GtaoAndContactShadowUniforms
): ShaderNodeObject<Node> {
  const {
    uProjMatrix,
    uProjMatrixInverse,
    uIsOrtho,
    uSunViewDir,
    uContactShadowStrength,
    uAoIntensity,
  } = uniforms;

  const shadowVis = float(1.0).toVar();
  const activeStrength = uContactShadowStrength.mul(smoothstep(0.0, 0.15, uAoIntensity)).toVar();

  If(activeStrength.greaterThan(0.005).and(scaleDist.lessThan(26.0)), () => {
    const nDotL = dot(centerViewNormal, uSunViewDir).toVar();
    If(nDotL.greaterThan(CONTACT_SHADOW_MIN_NDOTL), () => {
      const facingWeight = smoothstep(CONTACT_SHADOW_MIN_NDOTL, 0.2, nDotL).toVar();
      const viewDir = select(
        uIsOrtho.greaterThan(0.5),
        vec3(0.0, 0.0, 1.0),
        normalize(centerViewPos.negate())
      ).toVar();
      const nDotV = max(0.15, dot(centerViewNormal, viewDir)).toVar();
      const grazingScale = float(1.0).div(nDotV).toVar();

      const sunGrazingBoost = mix(
        float(2.4),
        float(1.0),
        smoothstep(CONTACT_SHADOW_MIN_NDOTL, 0.38, nDotL)
      ).toVar();
      const rayLength = clamp(scaleDist.mul(0.088), 0.075, 0.55).toVar();
      const originBias = clamp(scaleDist.mul(0.0018), 0.0015, 0.008)
        .mul(grazingScale)
        .mul(sunGrazingBoost);
      const rayOrigin = centerViewPos.add(centerViewNormal.mul(originBias)).toVar();
      const jitter = float(0.2).add(
        spatialInterleavedGradientNoise(screenCoordinate.xy.add(vec2(43.0, 11.0))).mul(0.65)
      );

      const maxOcclusion = float(0.0).toVar();

      for (let i = 0; i < CONTACT_SHADOW_STEPS; i++) {
        const sNorm = float(i).add(jitter).div(float(CONTACT_SHADOW_STEPS)).toVar();
        const tFrac = pow(sNorm, float(1.6)).toVar();
        const tMeters = rayLength.mul(tFrac).toVar();
        const stepThickness = clamp(tMeters.mul(0.85).add(0.018), 0.024, 0.22);
        const rayPos = rayOrigin.add(uSunViewDir.mul(tMeters)).toVar();
        const rayUv = getScreenPosition(rayPos, uProjMatrix).toVar();

        If(isUvInSafeViewportNode(rayUv), () => {
          const sampleD = sampleDepthLevel0(depthNode, rayUv);
          If(sampleD.lessThan(0.9999), () => {
            const scenePos = getViewPosition(rayUv, sampleD, uProjMatrixInverse);
            const depthDiff = scenePos.z.sub(rayPos.z);
            const minBias = float(0.0014)
              .add(tMeters.mul(0.024))
              .add(scaleDist.mul(0.0007))
              .mul(grazingScale);

            const planeElev = dot(scenePos.sub(centerViewPos), centerViewNormal);
            const minPlaneElev = max(0.0085, tMeters.mul(0.056))
              .mul(grazingScale)
              .mul(sunGrazingBoost);
            const planeGate = smoothstep(minPlaneElev, minPlaneElev.mul(2.2), planeElev);

            const enterHit = smoothstep(minBias, minBias.mul(2.3).add(0.0018), depthDiff);
            const thicknessExit = float(1.0).sub(
              smoothstep(stepThickness.mul(0.6), stepThickness, depthDiff)
            );
            const stepAtten = float(1.0).sub(tFrac.mul(0.42));
            maxOcclusion.assign(
              max(maxOcclusion, enterHit.mul(thicknessExit).mul(stepAtten).mul(planeGate))
            );
          });
        });
      }

      const closeFade = select(
        uIsOrtho.greaterThan(0.5),
        float(1.0),
        smoothstep(0.25, 0.75, scaleDist)
      );
      const distFade = float(1.0).sub(smoothstep(17.0, 26.0, scaleDist)).mul(closeFade);
      const contactDarken = maxOcclusion
        .mul(activeStrength)
        .mul(facingWeight)
        .mul(distFade)
        .mul(0.48);
      shadowVis.assign(clamp(float(1.0).sub(contactDarken), 0.48, 1.0));
    });
  });

  return shadowVis;
}

/**
 * Evaluates raw half-resolution `(rawAo, rawContact, octNormal.x, octNormal.y)` in a single pass,
 * reconstructing `viewNormal` once per half-res texel and packing it into `.zw` so the H and V
 * bilateral passes never re-reconstruct normals across their 14 taps.
 */
export function evaluateHalfResAoAndContactRaw(
  depthNode: ShaderNodeObject<TextureNode>,
  hUv: ShaderNodeObject<Node>,
  hRawDepth: ShaderNodeObject<Node>,
  uniforms: GtaoAndContactShadowUniforms
): ShaderNodeObject<Node> {
  const { uProjMatrixInverse, uHalfTexelSize, uIsOrtho, uOrthoEquivDepth } = uniforms;
  const outPacked = vec4(1.0, 1.0, 0.0, 0.0).toVar();

  If(hRawDepth.lessThan(0.9999), () => {
    const hCenterViewPos = getViewPosition(hUv, hRawDepth, uProjMatrixInverse).toVar();
    const hScaleDist = select(
      uIsOrtho.greaterThan(0.5),
      uOrthoEquivDepth,
      max(0.12, hCenterViewPos.z.negate())
    ).toVar();
    const hCenterViewNormal = reconstructMinDeltaViewNormal(
      depthNode,
      hUv,
      hCenterViewPos,
      uHalfTexelSize,
      uProjMatrixInverse
    ).toVar();

    const rawAo = evaluateHalfResGtaoWithNormal(
      depthNode,
      hCenterViewPos,
      hCenterViewNormal,
      hScaleDist,
      uniforms
    );
    const rawContact = evaluateScreenSpaceContactShadow(
      depthNode,
      hCenterViewPos,
      hCenterViewNormal,
      hScaleDist,
      uniforms
    );
    const octNormal = encodeOctNormalNode(hCenterViewNormal);
    outPacked.assign(vec4(rawAo, rawContact, octNormal.x, octNormal.y));
  });

  return outPacked;
}

/**
 * Single separable 7-tap (`-3..+3` half-res texels) scalar-linear-Z + normal-aware bilateral pass.
 * Uses `reconstructLinearViewZ` (zero `4x4` `uProjMatrixInverse` matrix multiplies per tap) and
 * 4-multiply `d^16` normal weights while preserving `.zw` octahedral view normals unchanged.
 */
export function denoiseBilateralAoAndContactPass(
  srcRtt: ShaderNodeObject<RTTNode>,
  depthNode: ShaderNodeObject<TextureNode>,
  centerUv: ShaderNodeObject<Node>,
  stepDirUv: ShaderNodeObject<Node>,
  uniforms: Pick<GtaoAndContactShadowUniforms, 'uProjMatrix' | 'uIsOrtho'>
): ShaderNodeObject<Node> {
  const { uProjMatrix, uIsOrtho } = uniforms;
  const centerSample = sampleRttLevel0(srcRtt, centerUv).toVar();
  const centerDepth = sampleClampedDepth(depthNode, centerUv).toVar();
  const outSample = vec4(centerSample).toVar();

  If(centerDepth.lessThan(0.9999), () => {
    const centerZ = reconstructLinearViewZ(centerDepth, uProjMatrix, uIsOrtho).toVar();
    const centerNormal = decodeOctNormalNode(centerSample.zw).toVar();
    const normalZScale = max(0.25, abs(centerNormal.z)).toVar();
    const invDepthSigma = float(1.0).div(max(0.012, abs(centerZ).mul(0.022))).toVar();

    const sumAo = centerSample.x.toVar();
    const sumContact = centerSample.y.toVar();
    const weightTotal = float(1.0).toVar();

    for (let k = -BILATERAL_KERNEL_RADIUS; k <= BILATERAL_KERNEL_RADIUS; k++) {
      if (k === 0) continue;
      const wSpatial = Math.exp(
        -0.5 * (k / BILATERAL_SPATIAL_SIGMA) * (k / BILATERAL_SPATIAL_SIGMA)
      );
      const rawTapUv = centerUv.add(stepDirUv.mul(float(k)));
      const inBounds = isUvInSafeViewportNode(rawTapUv);
      const tapUv = clamp(rawTapUv, 0.001, 0.999).toVar();
      const tapDepth = sampleDepthLevel0(depthNode, tapUv).toVar();
      const tapSample = sampleRttLevel0(srcRtt, tapUv).toVar();
      const tapZ = reconstructLinearViewZ(tapDepth, uProjMatrix, uIsOrtho);
      const tapNormal = decodeOctNormalNode(tapSample.zw);

      const zDiff = abs(tapZ.sub(centerZ)).mul(normalZScale);
      const wDepth = exp(zDiff.mul(invDepthSigma).negate());
      const wNormal = pow16FastNode(dot(centerNormal, tapNormal));
      const valid = select(inBounds.and(tapDepth.lessThan(0.9999)), float(1.0), float(0.0));
      const w = float(wSpatial).mul(wDepth).mul(wNormal).mul(valid);

      sumAo.addAssign(tapSample.x.mul(w));
      sumContact.addAssign(tapSample.y.mul(w));
      weightTotal.addAssign(w);
    }

    outSample.assign(
      vec4(sumAo.div(weightTotal), sumContact.div(weightTotal), centerSample.z, centerSample.w)
    );
  });

  return outSample;
}

/**
 * Full-resolution 4-tap scalar-linear-Z + normal-aware bilateral upsampler for
 * `(denoisedAo, denoisedContact)` from `halfResAoBlurVRtt`, using zero `4x4` matrix multiplies
 * and 4-multiply `d^16` normal weights to prevent dark corner/floor occlusion from haloing.
 */
export function upsampleBilateralAoAndContact(
  denoisedHalfRtt: ShaderNodeObject<RTTNode>,
  depthNode: ShaderNodeObject<TextureNode>,
  vUv: ShaderNodeObject<Node>,
  centerViewPos: ShaderNodeObject<Node>,
  centerViewNormal: ShaderNodeObject<Node>,
  uniforms: GtaoAndContactShadowUniforms
): ShaderNodeObject<Node> {
  const { uHalfTexelSize, uProjMatrix, uIsOrtho } = uniforms;
  const centerZ = centerViewPos.z;
  const normalZScale = max(0.25, abs(centerViewNormal.z)).toVar();
  const invSigma = float(1.0).div(max(0.014, abs(centerZ).mul(0.024))).toVar();

  const hx = uHalfTexelSize.x.mul(0.5);
  const hy = uHalfTexelSize.y.mul(0.5);
  const offsets: readonly ShaderNodeObject<Node>[] = [
    vec2(hx.negate(), hy.negate()),
    vec2(hx, hy.negate()),
    vec2(hx.negate(), hy),
    vec2(hx, hy),
  ];

  const weightedSum = vec2(0.0, 0.0).toVar();
  const weightTotal = float(0.0).toVar();
  const fallbackSum = vec2(0.0, 0.0).toVar();

  for (const off of offsets) {
    const rawTapUv = vUv.add(off);
    const inBounds = isUvInSafeViewportNode(rawTapUv);
    const tapUv = clamp(rawTapUv, 0.001, 0.999).toVar();
    const tapDepth = sampleClampedDepth(depthNode, tapUv);
    const tapSample = sampleRttLevel0(denoisedHalfRtt, tapUv).toVar();
    const tapZ = reconstructLinearViewZ(tapDepth, uProjMatrix, uIsOrtho);
    const tapNormal = decodeOctNormalNode(tapSample.zw);

    const zDiff = abs(tapZ.sub(centerZ)).mul(normalZScale);
    const wDepth = exp(zDiff.mul(2.2).mul(invSigma).negate());
    const wNormal = pow16FastNode(dot(centerViewNormal, tapNormal));
    const valid = select(inBounds.and(tapDepth.lessThan(0.9999)), float(1.0), float(0.0));
    const w = wDepth.mul(wNormal).mul(valid);

    fallbackSum.addAssign(tapSample.xy.mul(0.25));
    weightedSum.addAssign(tapSample.xy.mul(w));
    weightTotal.addAssign(w);
  }

  const upsampled = select(
    weightTotal.greaterThan(1e-4),
    weightedSum.div(max(1e-5, weightTotal)),
    fallbackSum
  );
  return vec2(clamp(upsampled.x, 0.36, 1.0), clamp(upsampled.y, 0.48, 1.0));
}

/**
 * Legacy single-channel bilateral GTAO upsampler preserved for external callers.
 */
export function upsampleBilateralGtao(
  halfResRtt: ShaderNodeObject<RTTNode>,
  depthNode: ShaderNodeObject<TextureNode>,
  vUv: ShaderNodeObject<Node>,
  centerViewPos: ShaderNodeObject<Node>,
  centerViewNormal: ShaderNodeObject<Node>,
  uniforms: GtaoAndContactShadowUniforms
): ShaderNodeObject<Node> {
  return upsampleBilateralAoAndContact(
    halfResRtt,
    depthNode,
    vUv,
    centerViewPos,
    centerViewNormal,
    uniforms
  ).x;
}

/**
 * Applies Jimenez multi-bounce colored ambient occlusion (preserving warm plaster & cornice bounce
 * instead of grey corner soot), Specular AO highlight damping, Screen-Space Contact Shadows,
 * and subtle close-up (< 1.95 m) world-space triplanar plaster micro-relief.
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
      vec3(gtao).div(
        max(vec3(0.18), vec3(1.0).sub(estAlbedo.mul(float(1.0).sub(gtao)).mul(0.72)))
      ),
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

    If(scaleDistIn.lessThan(CLOSE_UP_MICRO_RELIEF_MAX_DIST_M), () => {
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
