/**
 * TSL Camera Motion Blur, Directional FXAA 3.11 edge anti-aliasing, and Contrast-Adaptive Sharpening.
 */
import type * as THREE from 'three';
import type { Node, TextureNode, UniformNode } from 'three/webgpu';
import {
  If,
  abs,
  clamp,
  dot,
  float,
  length,
  max,
  min,
  mix,
  screenCoordinate,
  select,
  type ShaderNodeObject,
  smoothstep,
  sqrt,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { spatialInterleavedGradientNoise } from './contact-shadows-and-gtao.ts';

export interface FxaaAndCasUniforms {
  readonly uTexelSize: ShaderNodeObject<UniformNode<THREE.Vector2>>;
  readonly uFxaaEnabled: ShaderNodeObject<UniformNode<number>>;
  readonly uSharpenIntensity: ShaderNodeObject<UniformNode<number>>;
  readonly uResolution: ShaderNodeObject<UniformNode<THREE.Vector2>>;
  readonly uCurrInvViewProj: ShaderNodeObject<UniformNode<THREE.Matrix4>>;
  readonly uPrevViewProj: ShaderNodeObject<UniformNode<THREE.Matrix4>>;
  readonly uMotionBlurEnabled: ShaderNodeObject<UniformNode<number>>;
  readonly uShutterScale: ShaderNodeObject<UniformNode<number>>;
  readonly uIsWebGPU: ShaderNodeObject<UniformNode<number>>;
}

export function sampleClampedHdrRgb(
  colorNode: ShaderNodeObject<TextureNode>,
  sampleUv: ShaderNodeObject<Node>
): ShaderNodeObject<Node> {
  return (
    colorNode.sample(clamp(sampleUv, 0.001, 0.999)) as unknown as ShaderNodeObject<TextureNode>
  ).level(float(0)).rgb;
}

function perceptualLuma(rgb: ShaderNodeObject<Node>): ShaderNodeObject<Node> {
  return sqrt(max(0.0, dot(rgb, vec3(0.299, 0.587, 0.114))));
}

/**
 * Evaluates camera-velocity motion blur when moving, or FXAA 3.11 + CAS when stationary,
 * returning `{ hdrColor, speedPx }`.
 */
export function evaluateMotionBlurOrFxaaCas(
  colorNode: ShaderNodeObject<TextureNode>,
  vUv: ShaderNodeObject<Node>,
  rawDepth: ShaderNodeObject<Node>,
  centerColor: ShaderNodeObject<Node>,
  uniforms: FxaaAndCasUniforms
): { readonly hdrColor: ShaderNodeObject<Node>; readonly speedPx: ShaderNodeObject<Node> } {
  const sampleHdr = (uvCoord: ShaderNodeObject<Node>): ShaderNodeObject<Node> =>
    sampleClampedHdrRgb(colorNode, uvCoord);

  const hdrColor = vec3(centerColor).toVar();
  const speedPx = float(0.0).toVar();
  const velocity = vec2(0.0).toVar();

  If(uniforms.uMotionBlurEnabled.greaterThan(0.5), () => {
    const clipZ = select(
      uniforms.uIsWebGPU.greaterThan(0.5),
      rawDepth,
      rawDepth.mul(2.0).sub(1.0)
    );
    const ndcXY = vec2(vUv.x, float(1.0).sub(vUv.y)).mul(2.0).sub(1.0);
    const worldPos = uniforms.uCurrInvViewProj.mul(vec4(ndcXY, clipZ, 1.0)).toVar();
    worldPos.divAssign(max(1e-6, worldPos.w));

    const prevClipPos = uniforms.uPrevViewProj.mul(worldPos).toVar();
    If(prevClipPos.w.greaterThan(1e-4), () => {
      const prevNdc = prevClipPos.xy.div(prevClipPos.w);
      const prevUv = vec2(prevNdc.x.mul(0.5).add(0.5), float(0.5).sub(prevNdc.y.mul(0.5)));
      const rawVel = vUv.sub(prevUv).mul(uniforms.uShutterScale).toVar();
      const velMag = length(rawVel);
      const maxRadius = float(0.012);
      velocity.assign(
        select(
          velMag.greaterThan(maxRadius),
          rawVel.mul(maxRadius.div(max(1e-6, velMag))),
          rawVel
        )
      );
      speedPx.assign(length(velocity.mul(uniforms.uResolution)));
    });
  });

  const applyBlur = uniforms.uMotionBlurEnabled.greaterThan(0.5).and(speedPx.greaterThan(2.2));
  If(applyBlur, () => {
    const noise = spatialInterleavedGradientNoise(screenCoordinate.xy).toVar();
    const accumColor = centerColor.mul(1.5).toVar();
    const totalWeight = float(1.5).toVar();
    const sampleCount = 4;
    for (let i = 0; i < sampleCount; i++) {
      const fi = float(i).add(noise).div(float(sampleCount)).sub(0.5);
      const sampleUv = clamp(vUv.add(velocity.mul(fi)), 0.001, 0.999);
      const w = float(1.0).sub(abs(fi).mul(0.75));
      accumColor.addAssign(sampleHdr(sampleUv).mul(w));
      totalWeight.addAssign(w);
    }
    hdrColor.assign(mix(centerColor, accumColor.div(totalWeight), smoothstep(2.2, 6.5, speedPx)));
  });

  If(
    applyBlur
      .not()
      .and(
        uniforms.uFxaaEnabled
          .greaterThan(0.5)
          .or(uniforms.uSharpenIntensity.greaterThan(0.001))
      ),
    () => {
      hdrColor.assign(evaluateFxaaAndCas(colorNode, vUv, centerColor, uniforms));
    }
  );

  return { hdrColor, speedPx };
}

export function evaluateFxaaAndCas(
  colorNode: ShaderNodeObject<TextureNode>,
  vUv: ShaderNodeObject<Node>,
  centerColor: ShaderNodeObject<Node>,
  uniforms: Pick<FxaaAndCasUniforms, 'uTexelSize' | 'uFxaaEnabled' | 'uSharpenIntensity'>
): ShaderNodeObject<Node> {
  const { uTexelSize, uFxaaEnabled, uSharpenIntensity } = uniforms;
  const sampleHdr = (uvCoord: ShaderNodeObject<Node>): ShaderNodeObject<Node> =>
    sampleClampedHdrRgb(colorNode, uvCoord);

  const rgbN = sampleHdr(vUv.add(vec2(0.0, uTexelSize.y))).toVar();
  const rgbS = sampleHdr(vUv.sub(vec2(0.0, uTexelSize.y))).toVar();
  const rgbE = sampleHdr(vUv.add(vec2(uTexelSize.x, 0.0))).toVar();
  const rgbW = sampleHdr(vUv.sub(vec2(uTexelSize.x, 0.0))).toVar();

  const lumaM = perceptualLuma(centerColor).toVar();
  const lumaN = perceptualLuma(rgbN).toVar();
  const lumaS = perceptualLuma(rgbS).toVar();
  const lumaE = perceptualLuma(rgbE).toVar();
  const lumaW = perceptualLuma(rgbW).toVar();

  const lumaMin = min(lumaM, min(min(lumaN, lumaS), min(lumaE, lumaW))).toVar();
  const lumaMax = max(lumaM, max(max(lumaN, lumaS), max(lumaE, lumaW))).toVar();
  const lumaRange = lumaMax.sub(lumaMin).toVar();

  const resultColor = vec3(centerColor).toVar();

  If(
    uFxaaEnabled
      .greaterThan(0.5)
      .and(lumaRange.greaterThanEqual(max(0.0312, lumaMax.mul(0.125)))),
    () => {
      const rgbNW = sampleHdr(vUv.add(vec2(uTexelSize.x.negate(), uTexelSize.y)));
      const rgbNE = sampleHdr(vUv.add(vec2(uTexelSize.x, uTexelSize.y)));
      const rgbSW = sampleHdr(vUv.add(vec2(uTexelSize.x.negate(), uTexelSize.y.negate())));
      const rgbSE = sampleHdr(vUv.add(vec2(uTexelSize.x, uTexelSize.y.negate())));

      const lumaNW = perceptualLuma(rgbNW);
      const lumaNE = perceptualLuma(rgbNE);
      const lumaSW = perceptualLuma(rgbSW);
      const lumaSE = perceptualLuma(rgbSE);

      const lumaDownUp = lumaS.add(lumaN);
      const lumaLeftRight = lumaW.add(lumaE);
      const lumaLeftCorners = lumaSW.add(lumaNW);
      const lumaDownCorners = lumaSW.add(lumaSE);
      const lumaRightCorners = lumaSE.add(lumaNE);
      const lumaUpCorners = lumaNE.add(lumaNW);

      const edgeHorizontal = abs(lumaW.mul(-2.0).add(lumaLeftCorners))
        .add(abs(lumaM.mul(-2.0).add(lumaDownUp)).mul(2.0))
        .add(abs(lumaE.mul(-2.0).add(lumaRightCorners)));
      const edgeVertical = abs(lumaN.mul(-2.0).add(lumaUpCorners))
        .add(abs(lumaM.mul(-2.0).add(lumaLeftRight)).mul(2.0))
        .add(abs(lumaS.mul(-2.0).add(lumaDownCorners)));

      const isHorizontal = edgeHorizontal.greaterThanEqual(edgeVertical).toVar();
      const luma1 = select(isHorizontal, lumaS, lumaW);
      const luma2 = select(isHorizontal, lumaN, lumaE);
      const gradient1 = luma1.sub(lumaM);
      const gradient2 = luma2.sub(lumaM);
      const is1Steepest = abs(gradient1).greaterThanEqual(abs(gradient2));
      const gradientScaled = max(abs(gradient1), abs(gradient2)).mul(0.25).toVar();

      const baseStep = select(isHorizontal, uTexelSize.y, uTexelSize.x);
      const stepLength = select(is1Steepest, baseStep.negate(), baseStep).toVar();
      const lumaLocalAverage = select(
        is1Steepest,
        luma1.add(lumaM).mul(0.5),
        luma2.add(lumaM).mul(0.5)
      ).toVar();

      const currentUv = vec2(
        select(isHorizontal, vUv.x, vUv.x.add(stepLength.mul(0.5))),
        select(isHorizontal, vUv.y.add(stepLength.mul(0.5)), vUv.y)
      );

      const offset = select(
        isHorizontal,
        vec2(uTexelSize.x, 0.0),
        vec2(0.0, uTexelSize.y)
      ).toVar();
      const uv1 = currentUv.sub(offset).toVar();
      const uv2 = currentUv.add(offset).toVar();

      const lumaEnd1 = perceptualLuma(sampleHdr(uv1)).sub(lumaLocalAverage).toVar();
      const lumaEnd2 = perceptualLuma(sampleHdr(uv2)).sub(lumaLocalAverage).toVar();
      const reached1 = abs(lumaEnd1).greaterThanEqual(gradientScaled).toVar();
      const reached2 = abs(lumaEnd2).greaterThanEqual(gradientScaled).toVar();

      uv1.assign(select(reached1, uv1, uv1.sub(offset.mul(1.5))));
      uv2.assign(select(reached2, uv2, uv2.add(offset.mul(1.5))));

      const stepMultipliers: readonly number[] = [2.0, 2.0, 4.0, 8.0];
      for (const stepMul of stepMultipliers) {
        If(reached1.and(reached2).not(), () => {
          If(reached1.not(), () => {
            lumaEnd1.assign(perceptualLuma(sampleHdr(uv1)).sub(lumaLocalAverage));
          });
          If(reached2.not(), () => {
            lumaEnd2.assign(perceptualLuma(sampleHdr(uv2)).sub(lumaLocalAverage));
          });
          reached1.assign(abs(lumaEnd1).greaterThanEqual(gradientScaled));
          reached2.assign(abs(lumaEnd2).greaterThanEqual(gradientScaled));
          uv1.assign(select(reached1, uv1, uv1.sub(offset.mul(stepMul))));
          uv2.assign(select(reached2, uv2, uv2.add(offset.mul(stepMul))));
        });
      }

      const distance1 = select(isHorizontal, vUv.x.sub(uv1.x), vUv.y.sub(uv1.y));
      const distance2 = select(isHorizontal, uv2.x.sub(vUv.x), uv2.y.sub(vUv.y));
      const isDirection1 = distance1.lessThan(distance2);
      const distanceFinal = min(distance1, distance2);
      const edgeThickness = max(1e-5, distance1.add(distance2));
      const pixelOffset = distanceFinal.negate().div(edgeThickness).add(0.5);

      const isLumaCenterSmaller = lumaM.lessThan(lumaLocalAverage);
      const chosenEndLuma = select(isDirection1, lumaEnd1, lumaEnd2);
      const correctVariation = chosenEndLuma.lessThan(0.0).notEqual(isLumaCenterSmaller);
      const finalOffset = select(correctVariation, pixelOffset, float(0.0)).toVar();

      const lumaAverage = lumaDownUp
        .add(lumaLeftRight)
        .mul(2.0)
        .add(lumaLeftCorners)
        .add(lumaRightCorners)
        .mul(1.0 / 12.0);
      const subPixelOffset1 = clamp(
        abs(lumaAverage.sub(lumaM)).div(max(1e-5, lumaRange)),
        0.0,
        1.0
      );
      const subPixelOffset2 = subPixelOffset1
        .mul(-2.0)
        .add(3.0)
        .mul(subPixelOffset1)
        .mul(subPixelOffset1);
      const subPixelOffsetFinal = subPixelOffset2.mul(subPixelOffset2).mul(0.75);

      finalOffset.assign(max(finalOffset, subPixelOffsetFinal));
      const finalUv = vec2(
        select(isHorizontal, vUv.x, vUv.x.add(finalOffset.mul(stepLength))),
        select(isHorizontal, vUv.y.add(finalOffset.mul(stepLength)), vUv.y)
      );
      resultColor.assign(sampleHdr(finalUv));
    }
  );

  If(uSharpenIntensity.greaterThan(0.001), () => {
    const neighborAvg = rgbN.add(rgbS).add(rgbE).add(rgbW).mul(0.25);
    const detailWeight = float(1.0).sub(smoothstep(0.25, 0.85, lumaRange)).mul(uSharpenIntensity);
    resultColor.assign(
      max(vec3(0.0), resultColor.add(centerColor.sub(neighborAvg).mul(detailWeight)))
    );
  });

  return resultColor;
}
