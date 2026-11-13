import {
  clamp,
  dot,
  float,
  fract,
  max,
  mix,
  normalView,
  positionViewDirection,
  pow,
  type ShaderNodeObject,
  smoothstep,
  vec3,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import {
  SHARED_VEGETATION_UNIFORMS,
  type VegetationUniforms,
} from './vegetation-uniforms.ts';

type TslNode = ShaderNodeObject<Node>;

function tslWrapUnitPhase(x: TslNode): TslNode {
  return fract(fract(x).add(1.0));
}

function tslCircularDist(a: TslNode, b: TslNode): TslNode {
  const d = tslWrapUnitPhase(a.sub(b));
  return d.greaterThan(0.5).select(float(1.0).sub(d), d);
}

function tslCircularWindow(
  phase: TslNode,
  center: TslNode,
  halfSpan: TslNode,
  feather: TslNode
): TslNode {
  const dist = tslCircularDist(phase, center);
  return float(1.0).sub(smoothstep(halfSpan, halfSpan.add(max(feather, float(1e-4))), dist));
}

export interface TurfShadingInputs {
  /** Base linear RGB grass albedo (from meadow or roller-mown striped lawn texture). */
  readonly baseGrassRgb: TslNode;
  /** Blade height / micro-tuft factor in `[0, 1]` (`0` = thatch crevice, `1` = upright blade tip). */
  readonly bladeHeight: TslNode;
  /** Sunlit chlorophyll / clover patch noise in `[0, 1]`. */
  readonly patchNoise: TslNode;
  /** Base dry micro-roughness in `[0, 1]`. */
  readonly baseRoughness: TslNode;
  /** Optional distance attenuation `[0..1]` (`1` close-up, `0` far horizon). */
  readonly detailWeight?: TslNode;
  /** Optional uniform block override (defaults to `SHARED_VEGETATION_UNIFORMS`). */
  readonly uniforms?: VegetationUniforms;
}

export interface TurfShadingNodes {
  readonly colorRgb: TslNode;
  readonly roughness: TslNode;
}

/**
 * Continuous GPU TSL seasonal grass & lawn shading graph matching `evaluateSeasonalTurfPhenology` 1:1.
 *
 * Couples `uYearPhase`, `uClimateCurves` (`springOnset`, `summerDormancy`), `uRainWetness`, and
 * `uSnowAmount` with blade-crevice hoarfrost/snow accumulation and grazing-angle velvety Fresnel
 * blade sheen so lawns and meadows never read as flat green plastic or discrete 4-season steps.
 */
export function buildContinuousTurfShadingNodes(input: TurfShadingInputs): TurfShadingNodes {
  const u = input.uniforms ?? SHARED_VEGETATION_UNIFORMS;
  const p = tslWrapUnitPhase(float(u.uYearPhase));
  const springOnset = u.uClimateCurves.z;
  const summerDormancy = u.uClimateCurves.w;
  const rain = clamp(float(u.uRainWetness), 0.0, 1.0);
  const snow = clamp(float(u.uSnowAmount), 0.0, 1.0);
  const detailW = input.detailWeight ?? float(1.0);

  const springEmerald = tslCircularWindow(
    p,
    springOnset.add(0.075),
    float(0.065),
    float(0.085)
  );
  const warmSummer = tslCircularWindow(p, float(0.55), float(0.075), float(0.085));
  const verdantAutumn = tslCircularWindow(p, float(0.80), float(0.075), float(0.085)).mul(
    float(1.0).sub(summerDormancy.mul(0.7))
  );
  const coolWinter = tslCircularWindow(p, float(0.015), float(0.085), float(0.085)).mul(
    float(1.0).sub(summerDormancy.mul(0.8))
  );
  const medWinterGreen = tslCircularWindow(p, float(0.14), float(0.14), float(0.10)).mul(
    summerDormancy
  );
  const summerDormancyMix = tslCircularWindow(p, float(0.62), float(0.13), float(0.10)).mul(
    summerDormancy
  );

  let tint: TslNode = vec3(1.0, 1.0, 1.0);
  tint = mix(tint, vec3(0.93, 1.12, 0.88), springEmerald.mul(0.75));
  tint = mix(tint, vec3(0.90, 1.14, 0.86), medWinterGreen.mul(0.65));

  const tempSummer = warmSummer.mul(float(1.0).sub(summerDormancy.mul(0.8)));
  const sunlitChlorophyll = mix(
    vec3(0.98, 1.02, 0.94),
    vec3(1.07, 1.07, 0.92),
    smoothstep(0.32, 0.78, input.patchNoise)
  );
  tint = mix(tint, sunlitChlorophyll, tempSummer.mul(0.58));

  // Deep verdant autumn dew-rich turf (Sept-Nov stays rich emerald-olive rather than dead brown)
  tint = mix(tint, vec3(0.95, 1.03, 0.92), verdantAutumn.mul(0.65));

  // Winter temperate olive-green dormancy with subtle hoarfrost tip silvering in Dec-Feb
  tint = mix(tint, vec3(1.02, 0.90, 0.86), coolWinter.mul(0.72));

  // Mediterranean / arid sun-bleached golden-buff summer dormancy (Jul-Oct)
  const dormantPatch = smoothstep(0.22, 0.82, input.patchNoise.mul(0.65).add(0.18));
  const goldenStraw = mix(vec3(1.36, 1.04, 0.74), vec3(1.56, 1.16, 0.78), dormantPatch);
  tint = mix(tint, goldenStraw, summerDormancyMix.mul(0.88));

  // Rain wetness deepens chlorophyll saturation
  const wetScale = vec3(
    mix(float(1.0), float(0.84), rain),
    mix(float(1.0), float(0.88), rain),
    mix(float(1.0), float(0.84), rain)
  );

  // Thatch basal AO + blade tip lift for close/mid-range 3D depth
  const thatchShade = mix(
    float(1.0),
    mix(float(0.84), float(1.09), clamp(input.bladeHeight, 0.0, 1.0)),
    detailW.mul(0.75)
  );
  const seasonalGrass = input.baseGrassRgb.mul(tint).mul(wetScale).mul(thatchShade);

  // Grazing-angle velvety Fresnel blade sheen (eliminates flat matte-plastic slab appearance)
  const ndotv = clamp(dot(normalView, positionViewDirection), 0.0, 1.0);
  const grazingFresnel = pow(float(1.0).sub(ndotv), float(2.85));
  const sheenWeight = grazingFresnel
    .mul(mix(float(0.16), float(0.42), clamp(input.bladeHeight, 0.0, 1.0)))
    .mul(float(1.0).sub(snow.mul(0.8)))
    .mul(mix(float(0.35), float(1.0), detailW));
  const velvetTarget = seasonalGrass
    .mul(vec3(1.20, 1.26, 1.10))
    .add(vec3(0.010, 0.018, 0.007));
  const velvetyGrass = mix(seasonalGrass, velvetTarget, clamp(sheenWeight, 0.0, 0.45));

  // Winter hoarfrost & snow settles first into sheltered blade crevices, then blankets turf
  const crevicePocket = float(1.0).sub(clamp(input.bladeHeight, 0.0, 1.0).mul(0.55));
  const frostCreviceMask = clamp(
    snow.mul(crevicePocket.mul(0.85).add(0.45)).add(
      coolWinter.mul(0.08).mul(crevicePocket).mul(float(1.0).sub(rain))
    ),
    0.0,
    0.94
  );
  const snowTint = vec3(0.86, 0.90, 0.95);
  const colorRgb = mix(velvetyGrass, snowTint, frostCreviceMask);

  const wetRough = mix(input.baseRoughness, float(0.56), rain.mul(0.82));
  const roughness = clamp(mix(wetRough, float(0.84), frostCreviceMask), 0.42, 0.98);

  return { colorRgb, roughness };
}
