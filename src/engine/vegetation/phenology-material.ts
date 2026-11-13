import * as THREE from 'three';
import {
  Fn,
  abs,
  attribute,
  clamp,
  cos,
  diffuseColor,
  dot,
  float,
  fract,
  max,
  mix,
  normalLocal,
  normalView,
  normalWorld,
  positionLocal,
  positionViewDirection,
  positionWorld,
  pow,
  select,
  type ShaderNodeObject,
  sin,
  smoothstep,
  texture,
  uv,
  vec3,
  vertexColor,
} from 'three/tsl';
import {
  type LightingModelDirectInput,
  MeshStandardNodeMaterial,
  type Node,
  type NodeBuilder,
  PhysicalLightingModel,
} from 'three/webgpu';
import {
  ORGAN_PHASE_JITTER_SPAN,
  getExposureEnvelope,
  type VegetationExposure,
} from '../../core/geo/climate-phenology.ts';
import {
  getOrCreateBarkTextures,
  getOrCreateLeafVeinNormalMap,
  type BarkTextureStyle,
} from './vegetation-textures.ts';
import {
  SHARED_VEGETATION_UNIFORMS,
  type VegetationUniforms,
} from './vegetation-uniforms.ts';

export const VEG_PIVOT_ATTR = 'aVegPivot';
export const VEG_META_ATTR = 'aVegMeta';

type TslNode = ShaderNodeObject<Node>;

/**
 * Thin-walled botanical lighting model extending Three.js `PhysicalLightingModel` with
 * shadow- and cloud-gobo-aware backlit subsurface transmission for leaves and flower petals.
 */
export class FoliageLightingModel extends PhysicalLightingModel {
  private readonly translucencyWeightNode: Node;

  public constructor(translucencyWeightNode: Node) {
    super();
    this.translucencyWeightNode = translucencyWeightNode;
  }

  public override direct(input: LightingModelDirectInput, builder: NodeBuilder): void {
    super.direct(input, builder);
    const lightDir = vec3(input.lightDirection);
    const lightCol = vec3(input.lightColor);
    const negLight = lightDir.negate();
    const viewForward = pow(clamp(dot(positionViewDirection, negLight), 0.0, 1.0), 3.4);
    const backWrap = clamp(dot(normalView.negate(), lightDir), 0.0, 1.0);
    const transLobe = viewForward.mul(0.64).add(backWrap.mul(0.36));
    const warmChlorophyllShift = vec3(1.16, 1.26, 0.74);
    const sssRadiance = lightCol
      .mul(diffuseColor.rgb)
      .mul(warmChlorophyllShift)
      .mul(transLobe)
      .mul(float(this.translucencyWeightNode));
    const directDiff = input.reflectedLight.directDiffuse as unknown as {
      addAssign(node: unknown): void;
    };
    directDiff.addAssign(sssRadiance);
  }
}

export type PhenologySurfaceKind = 'foliage' | 'bark';

export interface PhenologyMaterialOptions {
  readonly exposure?: VegetationExposure;
  readonly surface?: PhenologySurfaceKind;
  readonly barkStyle?: BarkTextureStyle;
  readonly uniforms?: VegetationUniforms;
  readonly translucency?: number;
  readonly roughness?: number;
  readonly alphaCutoff?: number;
  readonly doubleSided?: boolean;
  readonly name?: string;
}

/**
 * Multi-organ TSL `MeshStandardNodeMaterial` driving continuous seasonal growth, unfurling,
 * October/November autumn senescence, blossom/petal drop, fruit ripening, rain wetness,
 * winter snow normal-caps, wind flutter, and thin-walled subsurface scattering in `O(1)`
 * via `VegetationUniforms` (matching `evaluateOrganPhenology` 1:1).
 */
export class PhenologyMaterial extends MeshStandardNodeMaterial {
  public readonly exposure: VegetationExposure;
  public readonly surfaceKind: PhenologySurfaceKind;
  public readonly vegetationUniforms: VegetationUniforms;
  private readonly translucencyNode: Node;

  public constructor(options: PhenologyMaterialOptions = {}) {
    const exposure = options.exposure ?? 'outdoor';
    const surfaceKind = options.surface ?? 'foliage';
    const doubleSided = options.doubleSided ?? surfaceKind === 'foliage';
    super({
      name: options.name ?? `husjs.vegetation.${surfaceKind}.${exposure}`,
      roughness: options.roughness ?? (surfaceKind === 'bark' ? 0.88 : 0.62),
      metalness: 0.0,
      side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      vertexColors: false,
    });

    this.exposure = exposure;
    this.surfaceKind = surfaceKind;
    const u = options.uniforms ?? SHARED_VEGETATION_UNIFORMS;
    this.vegetationUniforms = u;

    const env = getExposureEnvelope(exposure);
    const leafDropFlag = float(env.leafDropAllowed ? 1.0 : 0.0);
    const winterFloor = float(env.winterFloorScale);
    const senescenceEnv = float(env.senescenceScale);
    const extWin = float(env.extendedWindow);
    const windEnv = float(env.windScale);
    const snowEnv = float(env.snowScale);
    const jitterSpan = float(ORGAN_PHASE_JITTER_SPAN);
    const baseRough = float(options.roughness ?? (surfaceKind === 'bark' ? 0.88 : 0.62));
    const baseTranslucency = float(
      options.translucency ?? (surfaceKind === 'bark' ? 0.0 : 0.42)
    );

    if (surfaceKind === 'bark') {
      const barkSet = getOrCreateBarkTextures(options.barkStyle ?? 'fissured-oak');
      this.normalMap = barkSet.normalMap;
      this.normalScale = new THREE.Vector2(0.85, 0.85);
    } else {
      this.normalMap = getOrCreateLeafVeinNormalMap();
      this.normalScale = new THREE.Vector2(0.45, 0.45);
    }

    const aPivot = attribute(VEG_PIVOT_ATTR, 'vec3');
    const aMeta = attribute(VEG_META_ATTR, 'vec4');

    const circularWin = (
      phase: TslNode,
      center: TslNode,
      halfSpan: TslNode,
      feather: TslNode
    ): TslNode => {
      const rawDelta = abs(fract(phase.sub(center).add(0.5)).sub(0.5));
      return float(1.0).sub(smoothstep(halfSpan, halfSpan.add(max(feather, 0.001)), rawDelta));
    };

    const computeOrganScale = (
      organ: TslNode,
      p: TslNode,
      react: TslNode,
      variant: TslNode
    ): TslNode => {
      const decMin = u.uClimateCurves.x;
      const autStrength = u.uClimateCurves.y;
      const sprOnset = u.uClimateCurves.z;
      const sumDorm = u.uClimateCurves.w;

      // Asymmetric deciduous canopy (1:1 with evaluateOrganPhenology):
      // Full green canopy through September, 85-95% in October, 55-82% in mid-November,
      // tapering to bare branches in early-to-mid December (earlier mid-Nov drop on Virginia Creeper).
      const earlyDrop = smoothstep(0.80, 0.95, variant).mul(-0.048);
      const oakAppleHold = smoothstep(0.18, 0.28, variant)
        .mul(float(1.0).sub(smoothstep(0.38, 0.52, variant)))
        .mul(0.016);
      const dropShift = earlyDrop.add(oakAppleHold).add(decMin.mul(0.04));

      const springBud = smoothstep(
        sprOnset.sub(0.035).sub(extWin.mul(0.5)),
        sprOnset.add(0.075),
        p
      );
      const octThin = smoothstep(
        float(0.742).add(dropShift),
        float(0.835).add(dropShift),
        p
      ).mul(0.10);
      const novDrop = smoothstep(
        float(0.832).add(dropShift),
        float(0.950).add(dropShift).add(extWin),
        p
      ).mul(0.90);
      const decRaw = clamp(springBud.mul(float(1.0).sub(octThin).sub(novDrop)), 0.0, 1.0);
      const decOutdoor = mix(decMin, float(1.0), decRaw);
      const decProtected = mix(float(1.0), max(winterFloor, decOutdoor), react);
      const decScale = mix(decProtected, decOutdoor, leafDropFlag);

      // Marcescent leaf (~75% winter retention outdoors, e.g. Copper Beech)
      const marcRaw = circularWin(p, float(0.53), float(0.27).add(extWin), float(0.09));
      const marcFloor = mix(max(float(0.88), winterFloor), float(0.75), leafDropFlag);
      const marcScale = mix(marcFloor, float(1.0), marcRaw);

      // Spring blossom
      const blosCenter = sprOnset.add(0.018).add(variant.sub(0.5).mul(0.05));
      const blosRaw = circularWin(p, blosCenter, float(0.032).add(extWin.mul(0.4)), float(0.048));
      const blosScale = select(react.lessThan(0.12), blosRaw.mul(0.35), blosRaw);

      // Summer / repeat flower & phase-encoded spring bulbs
      const medBonus = select(sumDorm.greaterThan(0.7), float(0.035), float(0.0));
      const flwCenter = mix(float(0.20), float(0.56), variant);
      const flwRamp = smoothstep(0.20, 0.55, variant);
      const flwHalf = mix(float(0.042), float(0.13), flwRamp).add(extWin).add(medBonus);
      const flwFeather = mix(float(0.038), float(0.068), flwRamp);
      const flwRaw = circularWin(p, flwCenter, flwHalf, flwFeather);
      const flwScale = select(react.lessThan(0.12), mix(float(0.65), float(1.0), flwRaw), flwRaw);

      // Fruit & winter berries (summer-to-autumn grapes/apples full from mid-June through late Oct)
      const isWinterBerry = variant.greaterThanEqual(0.5);
      const frtWin = select(
        isWinterBerry,
        circularWin(p, float(0.84), float(0.24).add(extWin), float(0.09)),
        circularWin(p, float(0.635), float(0.18).add(extWin), float(0.075))
      );

      // Ground litter (spring petals < 0.5, Oct-Dec fallen autumn leaves >= 0.5)
      const isAutLitter = variant.greaterThanEqual(0.5);
      const litRaw = select(
        isAutLitter,
        circularWin(p, float(0.865), float(0.068), float(0.078)).mul(autStrength),
        circularWin(p, sprOnset.add(0.055), float(0.026), float(0.038))
      );
      const litScale = litRaw.mul(leafDropFlag);

      // Grass & 3D turf tufts (temperate winter trim + mediterranean summer dormancy)
      const grassDorm = circularWin(p, float(0.62), float(0.13), float(0.10))
        .mul(sumDorm)
        .mul(react);
      const coolWinter = circularWin(p, float(0.02), float(0.09), float(0.08))
        .mul(float(1.0).sub(sumDorm.mul(0.85)))
        .mul(react);
      const grassScale = mix(float(0.92), float(1.0), float(1.0).sub(grassDorm.mul(0.5))).mul(
        mix(float(1.0), float(0.84), coolWinter)
      );

      let scale: TslNode = float(1.0);
      scale = select(organ.greaterThan(0.5).and(organ.lessThan(1.5)), decScale, scale);
      scale = select(organ.greaterThan(2.5).and(organ.lessThan(3.5)), marcScale, scale);
      scale = select(organ.greaterThan(3.5).and(organ.lessThan(4.5)), blosScale, scale);
      scale = select(organ.greaterThan(4.5).and(organ.lessThan(5.5)), flwScale, scale);
      scale = select(organ.greaterThan(5.5).and(organ.lessThan(6.5)), frtWin, scale);
      scale = select(organ.greaterThan(6.5).and(organ.lessThan(7.5)), litScale, scale);
      scale = select(organ.greaterThan(7.5), grassScale, scale);
      return clamp(scale, 0.0, 1.0);
    };

    const vertexPosNode = Fn(() => {
      const organ = aMeta.x;
      const jitter = aMeta.y;
      const react = aMeta.z;
      const variant = aMeta.w;
      const p = fract(u.uYearPhase.add(jitter.sub(0.5).mul(jitterSpan)).add(1.0));
      const rawScale = computeOrganScale(organ, p, react, variant);
      const effectiveScale = select(rawScale.lessThan(0.025), float(0.0), rawScale);
      const unfurledPos = mix(aPivot, positionLocal, effectiveScale);

      // Outdoor wind sway + leaf flutter around twig attachment (zero when uWindStrength == 0).
      const windAmp = u.uWindStrength.mul(windEnv);
      const isFlexibleOrgan = smoothstep(0.2, 1.0, organ);
      const tipDist = positionLocal.sub(aPivot);
      const phaseSeed = jitter.mul(19.7).add(aPivot.x.mul(1.7)).add(aPivot.z.mul(1.3));
      const gust = sin(u.uWindTime.mul(2.35).add(phaseSeed));
      const flutter = cos(u.uWindTime.mul(6.8).add(phaseSeed.mul(2.1))).mul(0.35);
      const branchHeight = clamp(unfurledPos.y.mul(0.22), 0.0, 1.35);
      const swayMag = windAmp
        .mul(effectiveScale)
        .mul(branchHeight.mul(0.045).add(isFlexibleOrgan.mul(0.028)));
      const windOffset = vec3(
        u.uWindDirection.x.mul(gust.add(flutter)).mul(swayMag),
        tipDist.y.mul(flutter).mul(windAmp).mul(isFlexibleOrgan).mul(0.08),
        u.uWindDirection.y.mul(gust.add(flutter)).mul(swayMag)
      );

      return unfurledPos.add(windOffset);
    })();

    this.positionNode = vertexPosNode;
    this.castShadowPositionNode = vertexPosNode;

    const barkTex =
      surfaceKind === 'bark'
        ? getOrCreateBarkTextures(options.barkStyle ?? 'fissured-oak').albedoMap
        : null;

    this.colorNode = Fn(() => {
      const organ = aMeta.x;
      const jitter = aMeta.y;
      const react = aMeta.z;
      const variant = aMeta.w;
      const p = fract(u.uYearPhase.add(jitter.sub(0.5).mul(jitterSpan)).add(1.0));
      const sprOnset = u.uClimateCurves.z;
      const autStrength = u.uClimateCurves.y;
      const sumDorm = u.uClimateCurves.w;

      let baseCol: TslNode = vertexColor().rgb;
      if (barkTex) {
        const barkSample = texture(barkTex, uv().mul(vec3(2.0, 3.0, 1.0).xy)).rgb;
        baseCol = baseCol.mul(barkSample.mul(1.55));
      } else {
        const uvCoord = uv();
        const laminaShade = mix(float(0.88), float(1.08), smoothstep(0.0, 0.85, uvCoord.y));
        baseCol = baseCol.mul(laminaShade);
      }

      const sprFlush = circularWin(p, sprOnset.add(0.045), float(0.035), float(0.065)).mul(
        mix(float(0.28), float(1.0), react)
      );

      // Deciduous color (1:1 3-stop gold -> russet-ochre -> scarlet-crimson through Oct & Nov)
      const decSpringCol = vec3(
        baseCol.x.mul(1.42).add(0.04),
        baseCol.y.mul(1.36).add(0.06),
        baseCol.z.mul(0.78)
      );
      const earlyScarlet = smoothstep(0.75, 0.94, variant);
      const senOnset = mix(float(0.742), float(0.682), earlyScarlet);
      const senPeak = mix(float(0.835), float(0.738), earlyScarlet);
      const senReset = float(1.0).sub(smoothstep(0.960, 0.990, p));
      const decAutMix = smoothstep(senOnset, senPeak, p)
        .mul(senReset)
        .mul(autStrength)
        .mul(senescenceEnv);

      const tLow = clamp(variant.div(0.45), 0.0, 1.0);
      const tHigh = clamp(variant.sub(0.45).div(0.55), 0.0, 1.0);
      const autMid = mix(vec3(0.78, 0.58, 0.09), vec3(0.66, 0.34, 0.08), tLow);
      const autHue = mix(autMid, vec3(0.64, 0.09, 0.07), tHigh);
      const decCol = mix(mix(baseCol, decSpringCol, sprFlush.mul(0.75)), autHue, decAutMix);

      // Evergreen color (bright spring shoot tips)
      const evgBoost = float(1.0).add(sprFlush.mul(0.24));
      const evgCol = vec3(
        baseCol.x.mul(evgBoost.mul(1.04)),
        baseCol.y.mul(evgBoost.mul(1.12)),
        baseCol.z.mul(float(1.0).add(sprFlush.mul(0.06)))
      );

      // Marcescent color (Copper Beech plum-copper -> winter dry russet-bronze)
      const marcSummer = circularWin(p, float(0.53), float(0.27).add(extWin), float(0.09));
      const marcDry = float(1.0)
        .sub(marcSummer.mul(0.85))
        .mul(mix(float(0.15), float(1.0), senescenceEnv));
      const marcSpring = vec3(
        baseCol.x.mul(1.35).add(0.06),
        baseCol.y.mul(1.15).add(0.02),
        baseCol.z.mul(1.20).add(0.03)
      );
      const marcCol = mix(
        mix(baseCol, marcSpring, sprFlush.mul(0.7)),
        vec3(0.44, 0.19, 0.09),
        marcDry
      );

      // Fruit ripening (pale green berries in June -> deep burgundy/cultivar ripe hue July-Oct)
      const isWinterBerry = variant.greaterThanEqual(0.5);
      const ripeness = select(
        isWinterBerry,
        circularWin(p, float(0.92), float(0.20), float(0.10)),
        smoothstep(0.45, 0.63, p).mul(float(1.0).sub(smoothstep(0.86, 0.95, p)))
      );
      const frtCol = mix(vec3(0.24, 0.46, 0.15), baseCol, clamp(ripeness, 0.0, 1.0));

      // Grass & 3D turf tufts (spring emerald flush, winter olive, mediterranean golden dormancy)
      const grassFlush = circularWin(p, sprOnset.add(0.06), float(0.055), float(0.075)).mul(
        mix(float(0.25), float(1.0), react)
      );
      const coolWinter = circularWin(p, float(0.02), float(0.09), float(0.08))
        .mul(float(1.0).sub(sumDorm.mul(0.85)))
        .mul(react);
      const grassDorm = circularWin(p, float(0.62), float(0.13), float(0.10))
        .mul(sumDorm)
        .mul(react);
      const grassSpring = mix(
        baseCol,
        vec3(baseCol.x.mul(1.18).add(0.02), baseCol.y.mul(1.24).add(0.04), baseCol.z.mul(0.92)),
        grassFlush.mul(0.65)
      );
      const grassWinter = mix(
        grassSpring,
        vec3(grassSpring.x.mul(1.04).add(0.03), grassSpring.y.mul(0.88), grassSpring.z.mul(0.86)),
        coolWinter.mul(0.55)
      );
      const grassCol = mix(grassWinter, vec3(0.72, 0.57, 0.28), grassDorm);

      let seasonalCol: TslNode = baseCol;
      seasonalCol = select(organ.greaterThan(0.5).and(organ.lessThan(1.5)), decCol, seasonalCol);
      seasonalCol = select(organ.greaterThan(1.5).and(organ.lessThan(2.5)), evgCol, seasonalCol);
      seasonalCol = select(organ.greaterThan(2.5).and(organ.lessThan(3.5)), marcCol, seasonalCol);
      seasonalCol = select(organ.greaterThan(5.5).and(organ.lessThan(6.5)), frtCol, seasonalCol);
      seasonalCol = select(organ.greaterThan(7.5), grassCol, seasonalCol);

      const wetness = u.uRainWetness.mul(snowEnv);
      const wetDarkened = seasonalCol.mul(mix(float(1.0), float(0.82), wetness));

      const upAlign = smoothstep(0.22, 0.72, normalWorld.y);
      const frostHash = fract(
        sin(positionWorld.x.mul(12.9898).add(positionWorld.z.mul(78.233))).mul(43758.5453)
      );
      const snowCap = clamp(
        u.uSnowAmount.mul(snowEnv).mul(upAlign).mul(mix(float(0.78), float(1.15), frostHash)),
        0.0,
        0.92
      );
      return clamp(mix(wetDarkened, vec3(0.91, 0.94, 0.98), snowCap), 0.0, 1.0);
    })();

    this.roughnessNode = Fn(() => {
      const organ = aMeta.x;
      const isFruitOrPetal = organ.greaterThan(3.5).and(organ.lessThan(6.5));
      const organRough = select(isFruitOrPetal, baseRough.mul(0.72), baseRough);
      const wetness = u.uRainWetness.mul(snowEnv);
      const wetRough = mix(organRough, float(0.18), wetness.mul(0.8));
      const upAlign = smoothstep(0.22, 0.72, normalWorld.y);
      const snowCap = clamp(u.uSnowAmount.mul(snowEnv).mul(upAlign), 0.0, 0.9);
      return clamp(mix(wetRough, float(0.86), snowCap), 0.08, 0.98);
    })();

    this.translucencyNode = Fn(() => {
      const organ = aMeta.x;
      const isTranslucentOrgan = smoothstep(0.4, 0.9, organ).mul(
        float(1.0).sub(smoothstep(6.6, 7.2, organ).mul(0.5))
      );
      const veinMask = mix(float(0.68), float(1.08), abs(uv().x.sub(0.5)).mul(2.0));
      const snowBlock = float(1.0).sub(
        clamp(u.uSnowAmount.mul(snowEnv).mul(smoothstep(0.2, 0.7, normalLocal.y)), 0.0, 0.85)
      );
      return baseTranslucency.mul(isTranslucentOrgan).mul(veinMask).mul(snowBlock);
    })();

    this.userData['isVegetationMaterial'] = true;
    this.userData['skipMaterialDedupe'] = true;
    this.userData['vegetationExposure'] = exposure;
    this.userData['vegetationSurface'] = surfaceKind;
    if (exposure === 'outdoor') {
      this.userData['excludeIndoorLighting'] = true;
    }
  }

  public override setupLightingModel(): PhysicalLightingModel {
    if (this.surfaceKind === 'bark') {
      return new PhysicalLightingModel();
    }
    return new FoliageLightingModel(this.translucencyNode);
  }
}

const sharedMaterialPool = new Map<string, PhenologyMaterial>();

/**
 * Returns a shared singleton `PhenologyMaterial` for `(surface, exposure, barkStyle)` when using
 * default `SHARED_VEGETATION_UNIFORMS`, allowing `StaticContainerBatcher` to merge all outdoor
 * foliage or bark across a property into unified draw calls.
 */
export function getSharedPhenologyMaterial(
  options: PhenologyMaterialOptions = {}
): PhenologyMaterial {
  if (options.uniforms && options.uniforms !== SHARED_VEGETATION_UNIFORMS) {
    return new PhenologyMaterial(options);
  }
  const exposure = options.exposure ?? 'outdoor';
  const surface = options.surface ?? 'foliage';
  const barkStyle = surface === 'bark' ? (options.barkStyle ?? 'fissured-oak') : 'leaf';
  const doubleSided = options.doubleSided ?? surface === 'foliage';
  const key = `${surface}:${exposure}:${barkStyle}:${doubleSided ? '2s' : '1s'}`;
  let mat = sharedMaterialPool.get(key);
  if (!mat) {
    mat = new PhenologyMaterial({
      ...options,
      exposure,
      surface,
      doubleSided,
    });
    sharedMaterialPool.set(key, mat);
  }
  return mat;
}
