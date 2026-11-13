import * as THREE from 'three';
import {
  Break,
  Fn,
  If,
  Loop,
  cameraViewMatrix,
  add,
  clamp,
  clearcoatNormalView,
  cos,
  dot,
  float,
  fract,
  int,
  ivec2,
  max,
  min,
  mix,
  normalView,
  normalWorld,
  positionViewDirection,
  positionWorld,
  renderGroup,
  screenCoordinate,
  select,
  type ShaderNodeObject,
  sin,
  smoothstep,
  sqrt,
  texture,
  texture3D,
  textureLoad,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import {
  DirectionalLightNode,
  type Node,
  type NodeBuilder,
  PhysicalLightingModel,
  PointLightNode,
} from 'three/webgpu';
import {
  SHARED_BAKED_VOLUME_TEXTURE,
  SHARED_CAMERA_WORLD_MATRIX,
  SHARED_CLUSTER_LIGHT_DATA_TEXTURE,
  SHARED_DAYLIGHT_GI_TINT,
  SHARED_DAYLIGHT_VOLUME_TEXTURE,
  SHARED_LIGHT_CLUSTER_TEXTURE,
  SHARED_POINT_LIGHT_ACTIVITY,
  SHARED_VOLUME_INV_SIZE,
  SHARED_VOLUME_MAX,
  SHARED_VOLUME_MIN,
  SHARED_VOLUME_PARAMS,
  setAnyPointLightsActive,
} from './baked-light-volume.ts';

export {
  SHARED_BAKED_VOLUME_TEXTURE,
  SHARED_CAMERA_WORLD_MATRIX,
  SHARED_DAYLIGHT_GI_TINT,
  SHARED_DAYLIGHT_VOLUME_TEXTURE,
  SHARED_POINT_LIGHT_ACTIVITY,
  SHARED_VOLUME_INV_SIZE,
  SHARED_VOLUME_MAX,
  SHARED_VOLUME_MIN,
  SHARED_VOLUME_PARAMS,
  setAnyPointLightsActive,
};

/** TSL uniform nodes backed directly by the shared Vector3 / Vector4 singletons in renderGroup. */
export const uBakedVolumeMinNode = uniform(SHARED_VOLUME_MIN).setGroup(renderGroup);
export const uBakedVolumeMaxNode = uniform(SHARED_VOLUME_MAX).setGroup(renderGroup);
export const uBakedVolumeInvSizeNode = uniform(SHARED_VOLUME_INV_SIZE).setGroup(renderGroup);
export const uBakedVolumeParamsNode = uniform(SHARED_VOLUME_PARAMS).setGroup(renderGroup);
export const uDaylightGiTintNode = uniform(SHARED_DAYLIGHT_GI_TINT).setGroup(renderGroup);
export const uPointLightActivityNode = uniform(SHARED_POINT_LIGHT_ACTIVITY).setGroup(renderGroup);
export const uAnyPointLightsActive = uPointLightActivityNode.x;
export const uClusteredPointLightsActive = uPointLightActivityNode.w;

function makeNonCloningVec<T extends { clone: () => T }>(value: T): T {
  value.clone = () => value;
  return value;
}

/**
 * Shared 3D oblique cloud-gobo parameters (world-space cloud shadow projection):
 * - `x`: effective cloud cover (`0..1`)
 * - `y`: night factor (`0..1`, attenuates gobo contrast after sunset)
 * - `z`: wind offset X (`m`)
 * - `w`: wind offset Z (`m`)
 */
export const SHARED_CLOUD_GOBO_PARAMS: THREE.Vector4 = makeNonCloningVec(
  new THREE.Vector4(0, 0, 0, 0)
);
export const SHARED_CLOUD_SUN_DIR: THREE.Vector3 = makeNonCloningVec(
  new THREE.Vector3(-0.59, 0.71, 0.38).normalize()
);

export const uCloudGoboParams = { value: SHARED_CLOUD_GOBO_PARAMS };
export const uCloudSunDir = { value: SHARED_CLOUD_SUN_DIR };

export const uCloudGoboParamsNode = uniform(SHARED_CLOUD_GOBO_PARAMS).setGroup(renderGroup);
export const uCloudSunDirNode = uniform(SHARED_CLOUD_SUN_DIR).setGroup(renderGroup);
export const uCloudGoboTierScaleNode = uniform(1.0).setGroup(renderGroup);

/** Enables or disables per-fragment 2-octave FBM cloud-shadow gobo evaluation (disabled on 'low' mobile tier). */
export function setCloudGoboTierEnabled(enabled: boolean): void {
  uCloudGoboTierScaleNode.value = enabled ? 1.0 : 0.0;
}

export function setCloudGoboUniforms(
  cloudCover: number,
  nightFactor: number,
  windOffsetX: number,
  windOffsetZ: number,
  sunDirection: THREE.Vector3
): void {
  SHARED_CLOUD_GOBO_PARAMS.set(
    Math.max(0, Math.min(1, cloudCover)),
    Math.max(0, Math.min(1, nightFactor)),
    windOffsetX,
    windOffsetZ
  );
  if (sunDirection.lengthSq() > 1e-8) {
    SHARED_CLOUD_SUN_DIR.copy(sunDirection).normalize();
  }
}

function cpuCloudHash21(px: number, py: number): number {
  let qx = (px * 127.1) % 1;
  if (qx < 0) qx += 1;
  let qy = (py * 311.7) % 1;
  if (qy < 0) qy += 1;
  const d = qx * (qx + 34.23) + qy * (qy + 34.23);
  const prod = (qx + d) * (qy + d);
  let f = prod % 1;
  if (f < 0) f += 1;
  return f;
}

function cpuCloudValueNoise2(px: number, py: number): number {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const fx = px - ix;
  const fy = py - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = cpuCloudHash21(ix, iy);
  const b = cpuCloudHash21(ix + 1, iy);
  const c = cpuCloudHash21(ix, iy + 1);
  const d = cpuCloudHash21(ix + 1, iy + 1);
  const ab = a + (b - a) * ux;
  const cd = c + (d - c) * ux;
  return ab + (cd - ab) * uy;
}

function cpuSmoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-6, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Exact CPU mirror of `sampleCloudGoboTransmittanceNode` / `husCloudTransmittance` for deterministic testing. */
export function evaluateCloudTransmittanceCpu(
  worldX: number,
  worldY: number,
  worldZ: number
): number {
  const cloudCover = SHARED_CLOUD_GOBO_PARAMS.x;
  if (cloudCover <= 0.0) return 1.0;
  if (cloudCover <= 0.05) return 1.0;
  const nightFactor = SHARED_CLOUD_GOBO_PARAMS.y;
  const sunY = Math.max(0.28, SHARED_CLOUD_SUN_DIR.y);
  const projX = worldX - (SHARED_CLOUD_SUN_DIR.x / sunY) * worldY;
  const projZ = worldZ - (SHARED_CLOUD_SUN_DIR.z / sunY) * worldY;
  const uvX = (projX - SHARED_CLOUD_GOBO_PARAMS.z) * 0.014;
  const uvZ = (projZ - SHARED_CLOUD_GOBO_PARAMS.w) * 0.014;
  const c1 = cpuCloudValueNoise2(uvX, uvZ);
  const c2 = cpuCloudValueNoise2(uvX * 2.43 + 13.7, uvZ * 2.43 + 7.3);
  const c = c1 * 0.65 + c2 * 0.35;
  const overcastFlatten = 1 - cpuSmoothstep(0.68, 0.96, cloudCover);
  if (overcastFlatten <= 1e-4) return 1.0;
  const cloudMask = cpuSmoothstep(0.66 - cloudCover * 0.4, 0.86 - cloudCover * 0.24, c);
  const shadowDepth =
    Math.max(0, Math.min(0.5, cloudCover * 0.55)) * overcastFlatten * (1 - nightFactor);
  return 1 - cloudMask * shadowDepth;
}

const CLOUD_GOBO_TEX_SIZE = 128;
const CLOUD_GOBO_NOISE_PERIOD = 16;

function periodicCloudValueNoise2(px: number, py: number, period: number): number {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const fx = px - ix;
  const fy = py - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const wrap = (n: number): number => ((n % period) + period) % period;
  const x0 = wrap(ix);
  const x1 = wrap(ix + 1);
  const y0 = wrap(iy);
  const y1 = wrap(iy + 1);
  const a = cpuCloudHash21(x0, y0);
  const b = cpuCloudHash21(x1, y0);
  const c = cpuCloudHash21(x0, y1);
  const d = cpuCloudHash21(x1, y1);
  const ab = a + (b - a) * ux;
  const cd = c + (d - c) * ux;
  return ab + (cd - ab) * uy;
}

function createBakedCloudGoboTexture(): THREE.DataTexture {
  const data = new Uint8Array(CLOUD_GOBO_TEX_SIZE * CLOUD_GOBO_TEX_SIZE * 4);
  for (let y = 0; y < CLOUD_GOBO_TEX_SIZE; y++) {
    const v = (y + 0.5) / CLOUD_GOBO_TEX_SIZE;
    for (let x = 0; x < CLOUD_GOBO_TEX_SIZE; x++) {
      const u = (x + 0.5) / CLOUD_GOBO_TEX_SIZE;
      const c1 = periodicCloudValueNoise2(
        u * CLOUD_GOBO_NOISE_PERIOD,
        v * CLOUD_GOBO_NOISE_PERIOD,
        CLOUD_GOBO_NOISE_PERIOD
      );
      const c2 = periodicCloudValueNoise2(u * 39 + 13.7, v * 39 + 7.3, 39);
      const c = Math.max(0, Math.min(1, c1 * 0.65 + c2 * 0.35));
      const byte = Math.round(c * 255);
      const idx = (y * CLOUD_GOBO_TEX_SIZE + x) * 4;
      data[idx] = byte;
      data[idx + 1] = byte;
      data[idx + 2] = byte;
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(
    data,
    CLOUD_GOBO_TEX_SIZE,
    CLOUD_GOBO_TEX_SIZE,
    THREE.RGBAFormat,
    THREE.UnsignedByteType
  );
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Tileable `128x128` baked 2-octave cloud FBM texture sampled once per fragment on both
 * mobile and desktop (8x faster than 8-hash ALU FBM and 100% visually identical across tiers).
 */
export const SHARED_CLOUD_GOBO_TEXTURE: THREE.DataTexture = createBakedCloudGoboTexture();

/**
 * TSL 3D oblique world-space cloud shadow gobo (`1.0` when `uCloudCover <= 0.05`,
 * otherwise `1.0 - cloudMask * shadowDepth` projected along `uCloudSunDir`).
 */
export const sampleCloudGoboTransmittanceNode = Fn(() => {
  const cloudCover = uCloudGoboParamsNode.x.mul(uCloudGoboTierScaleNode);
  const transmittance = float(1.0).toVar('husCloudTransmittance');

  If(cloudCover.greaterThan(0.05).and(cloudCover.lessThan(0.96)), () => {
    const overcastFlatten = float(1.0).sub(smoothstep(float(0.68), float(0.96), cloudCover));
    const nightFactor = uCloudGoboParamsNode.y;
    const windOffset = uCloudGoboParamsNode.zw;
    const sunY = max(float(0.28), uCloudSunDirNode.y);
    const sunProjXZ = positionWorld.xz.sub(uCloudSunDirNode.xz.div(sunY).mul(positionWorld.y));
    const cloudUv = sunProjXZ
      .sub(windOffset)
      .mul(0.014 / CLOUD_GOBO_NOISE_PERIOD)
      .toVar('husCloudUv');
    const c = texture(SHARED_CLOUD_GOBO_TEXTURE, cloudUv, 0).setGroup(renderGroup).r;
    const cloudMask = smoothstep(
      float(0.66).sub(cloudCover.mul(0.4)),
      float(0.86).sub(cloudCover.mul(0.24)),
      c
    );
    const shadowDepth = clamp(cloudCover.mul(0.55), 0.0, 0.5)
      .mul(overcastFlatten)
      .mul(float(1.0).sub(nightFactor));
    transmittance.assign(float(1.0).sub(cloudMask.mul(shadowDepth)));
  });

  return transmittance;
});

/**
 * Dynamic directional sun shadow penumbra uniforms (`renderGroup`, zero pipeline recompiles):
 * - `x`: penumbra radius in shadow-map texels (`1.0` clear sky -> `~28` diffused overcast)
 * - `y`: inverse shadow-map resolution (`1.0 / mapSize`, e.g. `1 / 4096`)
 */
export const SHARED_SUN_SHADOW_PENUMBRA: THREE.Vector2 = makeNonCloningVec(
  new THREE.Vector2(1.0, 1.0 / 4096.0)
);
export const uSunShadowPenumbraNode = uniform(SHARED_SUN_SHADOW_PENUMBRA).setGroup(renderGroup);

export function setSunShadowPenumbraUniforms(radiusTexels: number, mapSize: number): void {
  const safeRadius = Math.max(0.5, radiusTexels);
  const invMap = 1.0 / Math.max(256, mapSize);
  SHARED_SUN_SHADOW_PENUMBRA.set(safeRadius, invMap);
}

interface VogelDiskTap {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

const VOGEL_DISK_16: readonly VogelDiskTap[] = Array.from({ length: 16 }, (_, i) => {
  const r = Math.sqrt((i + 0.5) / 16.0);
  const theta = i * 2.399963229728653;
  return { x: Math.cos(theta) * r, y: Math.sin(theta) * r, r };
});

type ShadowFilterInputs = {
  readonly depthTexture: THREE.DepthTexture;
  readonly shadowCoord: ShaderNodeObject<Node>;
  readonly depthLayer: ShaderNodeObject<Node>;
  readonly [key: string]: unknown;
};

/**
 * Zero-recompile TSL directional shadow filter (`sunLight.shadow.filterNode`):
 * - Clear skies (`radius < 1.8` texels): crisp 9-tap weighted PCF matching sharp direct sunlight.
 * - Cloudy / overcast skies (`radius >= 1.8` texels): 16-tap Jimenez Interleaved-Gradient-Noise (IGN)
 *   rotated Vogel-disk PCF with radial slope bias so shadows progressively diffuse up to `~28` texels
 *   (`~35–45 cm` soft penumbra) with zero 5-copy PCF ghost banding and zero roof/wall self-shadow acne.
 */
export const husCloudPenumbraShadowFilter = Fn((inputs: ShadowFilterInputs) => {
  const { depthTexture, shadowCoord, depthLayer } = inputs;
  const depthCompare = (
    uv: ShaderNodeObject<Node>,
    compareZ: ShaderNodeObject<Node>
  ): ShaderNodeObject<Node> => {
    let depthSample = texture(depthTexture, uv);
    if ((depthTexture as unknown as { isArrayTexture?: boolean }).isArrayTexture === true) {
      depthSample = (
        depthSample as unknown as { depth(layer: ShaderNodeObject<Node>): typeof depthSample }
      ).depth(depthLayer);
    }
    return (
      depthSample as unknown as { compare(z: ShaderNodeObject<Node>): ShaderNodeObject<Node> }
    ).compare(compareZ);
  };

  const radius = uSunShadowPenumbraNode.x;
  const texel = uSunShadowPenumbraNode.y;
  const result = float(1.0).toVar('husSunShadowVis');

  If(radius.lessThan(1.8), () => {
    const d = texel.mul(radius);
    const dh = d.mul(0.5);
    result.assign(
      add(
        depthCompare(shadowCoord.xy, shadowCoord.z).mul(2.0),
        depthCompare(shadowCoord.xy.add(vec2(d.negate(), d.negate())), shadowCoord.z),
        depthCompare(shadowCoord.xy.add(vec2(d, d.negate())), shadowCoord.z),
        depthCompare(shadowCoord.xy.add(vec2(d.negate(), d)), shadowCoord.z),
        depthCompare(shadowCoord.xy.add(vec2(d, d)), shadowCoord.z),
        depthCompare(shadowCoord.xy.add(vec2(dh.negate(), float(0.0))), shadowCoord.z),
        depthCompare(shadowCoord.xy.add(vec2(dh, float(0.0))), shadowCoord.z),
        depthCompare(shadowCoord.xy.add(vec2(float(0.0), dh.negate())), shadowCoord.z),
        depthCompare(shadowCoord.xy.add(vec2(float(0.0), dh)), shadowCoord.z)
      ).mul(1.0 / 10.0)
    );
  }).Else(() => {
    const ign = fract(
      float(52.9829189).mul(
        fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715)))
      )
    );
    const angle = ign.mul(Math.PI * 2.0).toVar('husVogelAngle');
    const cosA = cos(angle).toVar('husVogelCos');
    const sinA = sin(angle).toVar('husVogelSin');
    const spreadUv = texel.mul(radius).toVar('husVogelSpreadUv');
    let acc: ShaderNodeObject<Node> | null = null;
    for (let i = 0; i < VOGEL_DISK_16.length; i++) {
      const tap = VOGEL_DISK_16[i]!;
      const rotX = cosA.mul(tap.x).sub(sinA.mul(tap.y));
      const rotY = sinA.mul(tap.x).add(cosA.mul(tap.y));
      const uv = shadowCoord.xy.add(vec2(rotX, rotY).mul(spreadUv));
      const tapBias = max(float(0.0), radius.mul(tap.r).sub(1.25)).mul(0.000085);
      const sampleVis = depthCompare(uv, shadowCoord.z.sub(tapBias));
      acc = acc === null ? sampleVis : acc.add(sampleVis);
    }
    result.assign(acc!.mul(1.0 / 16.0));
  });

  return result;
});

/** True when a material explicitly opts out of indoor PointLights & 3D volume GI (e.g. exterior terrain). */
function isMaterialExcludedFromIndoorLighting(builder: NodeBuilder): boolean {
  const mat = (builder as unknown as { material?: THREE.Material }).material;
  return mat?.userData?.['excludeIndoorLighting'] === true;
}

/**
 * TSL node that samples the hardware-trilinear 3D Baked Light & AO Volume (`SHARED_BAKED_VOLUME_TEXTURE`)
 * plus the static Daylight Sky-Portal 3D Volume (`SHARED_DAYLIGHT_VOLUME_TEXTURE * uDaylightGiTint`),
 * fast-outing with 0 `texture3D` fetches for exterior pixels outside `[uBakedVolumeMin, uBakedVolumeMax]`.
 */
export const sampleBakedLightVolumeNode = Fn(() => {
  const hasKnxVolume = uPointLightActivityNode.y.greaterThan(1e-3);
  const hasDaylightVolume = uPointLightActivityNode.z
    .greaterThan(0.5)
    .and(
      max(
        uDaylightGiTintNode.x,
        max(uDaylightGiTintNode.y, uDaylightGiTintNode.z)
      ).greaterThan(1e-4)
    );
  const biasedPos = positionWorld.add(normalWorld.mul(0.22)).toVar('husBiasedWorldPos');
  const inVolume = uBakedVolumeParamsNode.x
    .greaterThan(0.5)
    .and(hasKnxVolume.or(hasDaylightVolume))
    .and(biasedPos.x.greaterThanEqual(uBakedVolumeMinNode.x))
    .and(biasedPos.x.lessThanEqual(uBakedVolumeMaxNode.x))
    .and(biasedPos.y.greaterThanEqual(uBakedVolumeMinNode.y))
    .and(biasedPos.y.lessThanEqual(uBakedVolumeMaxNode.y))
    .and(biasedPos.z.greaterThanEqual(uBakedVolumeMinNode.z))
    .and(biasedPos.z.lessThanEqual(uBakedVolumeMaxNode.z));

  const bakedIrradiance = vec3(0.0).toVar('husBakedIrradiance');
  const bakedAo = float(1.0).toVar('husBakedAo');

  If(inVolume, () => {
    const bakedUvw = clamp(
      biasedPos.sub(uBakedVolumeMinNode).mul(uBakedVolumeInvSizeNode),
      vec3(0.005),
      vec3(0.995)
    ).toVar('husBakedUvw');
    const giScale = uBakedVolumeParamsNode.y.mul(3.5).toVar('husGiScale');
    const knxGi = vec3(0.0).toVar('husKnxGi');

    If(hasKnxVolume, () => {
      const bakedTexel = texture3D(SHARED_BAKED_VOLUME_TEXTURE, bakedUvw, 0)
        .setGroup(renderGroup)
        .toVar('husBakedTexel');
      knxGi.assign(
        bakedTexel.rgb.mul(bakedTexel.rgb).mul(uPointLightActivityNode.y)
      );
      bakedAo.assign(mix(float(1.0), bakedTexel.a, uBakedVolumeParamsNode.z));
    });

    If(hasDaylightVolume, () => {
      const dlTexel = texture3D(SHARED_DAYLIGHT_VOLUME_TEXTURE, bakedUvw, 0)
        .setGroup(renderGroup)
        .toVar('husDaylightTexel');
      const daylightGi = dlTexel.rgb.mul(dlTexel.rgb).mul(uDaylightGiTintNode);
      knxGi.assign(knxGi.add(daylightGi));
    });

    bakedIrradiance.assign(knxGi.mul(giScale));
  });

  return vec4(bakedIrradiance, bakedAo);
});

let webGpuLightVolumeInstalled = false;

interface TslIrradianceNode {
  assign(value: unknown): void;
  add(value: unknown): { mul(factor: unknown): unknown };
}

interface DirectLightInput {
  readonly lightDirection: Node;
  readonly lightColor: Node;
  readonly reflectedLight: unknown;
  readonly lightNode?: unknown;
}

function installWebGpuLightVolumeHooks(): void {
  if (webGpuLightVolumeInstalled) return;
  webGpuLightVolumeInstalled = true;

  const lightingProto = PhysicalLightingModel.prototype as unknown as {
    clearcoat?: boolean;
    start?: (this: PhysicalLightingModel, builder: NodeBuilder) => void;
    direct?: (this: PhysicalLightingModel, input: DirectLightInput, builder: NodeBuilder) => void;
    indirectDiffuse?: (this: PhysicalLightingModel, builder: NodeBuilder) => void;
  };

  const origStart = lightingProto.start;
  const origDirect = lightingProto.direct;
  if (typeof origStart === 'function') {
    lightingProto.start = function (this: PhysicalLightingModel, builder: NodeBuilder): void {
      const stack = (builder as unknown as { stack?: { add(node: unknown): void } }).stack;
      if (stack) {
        stack.add(normalView);
        stack.add(positionViewDirection);
        if ((this as unknown as { clearcoat?: boolean }).clearcoat === true) {
          stack.add(clearcoatNormalView);
        }
      }
      origStart.call(this, builder);

      // 3D Voxel-Clustered Forward KNX Point-Light Grid (0..4 lights per voxel, full GGX + Clearcoat + Sheen BRDF)
      if (typeof origDirect === 'function' && !isMaterialExcludedFromIndoorLighting(builder)) {
        const reflectedLight = (
          builder as unknown as { context?: { reflectedLight?: unknown } }
        ).context?.reflectedLight;
        if (reflectedLight) {
          const inClusterBounds = uClusteredPointLightsActive
            .greaterThan(0.5)
            .and(positionWorld.x.greaterThanEqual(uBakedVolumeMinNode.x))
            .and(positionWorld.x.lessThanEqual(uBakedVolumeMaxNode.x))
            .and(positionWorld.y.greaterThanEqual(uBakedVolumeMinNode.y))
            .and(positionWorld.y.lessThanEqual(uBakedVolumeMaxNode.y))
            .and(positionWorld.z.greaterThanEqual(uBakedVolumeMinNode.z))
            .and(positionWorld.z.lessThanEqual(uBakedVolumeMaxNode.z));

          If(inClusterBounds, () => {
            const clusterUvw = clamp(
              positionWorld.sub(uBakedVolumeMinNode).mul(uBakedVolumeInvSizeNode),
              vec3(0.001),
              vec3(0.999)
            ).toVar('husClusterUvw');
            const rawSlots = texture3D(SHARED_LIGHT_CLUSTER_TEXTURE, clusterUvw, 0)
              .setGroup(renderGroup)
              .toVar('husClusterSlots');
            const s0 = int(rawSlots.x.mul(255.0).add(0.5)).toVar('husLightSlot0');

            If(s0.greaterThan(0), () => {
              const s1 = int(rawSlots.y.mul(255.0).add(0.5)).toVar('husLightSlot1');
              const s2 = int(rawSlots.z.mul(255.0).add(0.5)).toVar('husLightSlot2');
              const s3 = int(rawSlots.w.mul(255.0).add(0.5)).toVar('husLightSlot3');

              Loop(int(4), ({ i }) => {
                const idx = i as unknown as ShaderNodeObject<Node>;
                const slotVal = select(
                  idx.equal(0),
                  s0,
                  select(idx.equal(1), s1, select(idx.equal(2), s2, s3))
                ).toVar('husActiveLightSlot');

                If(slotVal.lessThanEqual(0), () => {
                  Break();
                });

                const lightIdx = slotVal.sub(1).toVar();
                const posCutoff = textureLoad(
                  SHARED_CLUSTER_LIGHT_DATA_TEXTURE,
                  ivec2(lightIdx, int(0))
                )
                  .setGroup(renderGroup)
                  .toVar();
                const colDecay = textureLoad(
                  SHARED_CLUSTER_LIGHT_DATA_TEXTURE,
                  ivec2(lightIdx, int(1))
                )
                  .setGroup(renderGroup)
                  .toVar();

                const lVecWorld = posCutoff.xyz.sub(positionWorld).toVar();
                const distSq = dot(lVecWorld, lVecWorld).toVar();
                const rawCutoff = posCutoff.w;
                const effectiveCutoff = select(
                  uBakedVolumeParamsNode.x.greaterThan(0.5).and(rawCutoff.greaterThan(0.0)),
                  min(rawCutoff, uBakedVolumeParamsNode.w),
                  rawCutoff
                ).toVar();
                const inRange = effectiveCutoff
                  .lessThanEqual(0.0)
                  .or(distSq.lessThan(effectiveCutoff.mul(effectiveCutoff)));

                If(inRange, () => {
                  const lightDistance = max(sqrt(distSq), 1e-4).toVar();
                  const lDirWorld = lVecWorld.div(lightDistance);
                  const lDirView = cameraViewMatrix
                    .mul(vec4(lDirWorld, 0.0))
                    .xyz.normalize()
                    .toVar();
                  const distanceFalloff = lightDistance.pow(colDecay.w).max(0.01).reciprocal();
                  const cutoffRatio = lightDistance.div(max(effectiveCutoff, 1e-4));
                  const windowFactor = clamp(float(1.0).sub(cutoffRatio.pow4()), 0.0, 1.0).pow2();
                  const attenuation = select(
                    effectiveCutoff.greaterThan(0.0),
                    distanceFalloff.mul(windowFactor),
                    distanceFalloff
                  );
                  const attenColor = colDecay.xyz.mul(attenuation).toVar();
                  If(
                    max(attenColor.x, max(attenColor.y, attenColor.z)).greaterThan(1e-4),
                    () => {
                      origDirect.call(
                        this,
                        {
                          lightDirection: lDirView,
                          lightColor: attenColor,
                          reflectedLight,
                        },
                        builder
                      );
                    }
                  );
                });
              });
            });
          });
        }
      }
    };
  }
  if (typeof origDirect === 'function') {
    lightingProto.direct = function (
      this: PhysicalLightingModel,
      input: DirectLightInput,
      builder: NodeBuilder
    ): void {
      if (input.lightNode instanceof PointLightNode) {
        if (isMaterialExcludedFromIndoorLighting(builder)) {
          return;
        }
        const lc = input.lightColor as unknown as ShaderNodeObject<Node>;
        If(
          uAnyPointLightsActive
            .greaterThan(0.5)
            .and(max(lc.r, max(lc.g, lc.b)).greaterThan(1e-4)),
          () => {
            origDirect.call(this, input, builder);
          }
        );
        return;
      }
      origDirect.call(this, input, builder);
    };
  }

  const origIndirectDiffuse = lightingProto.indirectDiffuse;
  if (typeof origIndirectDiffuse === 'function') {
    lightingProto.indirectDiffuse = function (
      this: PhysicalLightingModel,
      builder: NodeBuilder
    ): void {
      if (!isMaterialExcludedFromIndoorLighting(builder)) {
        const ctx = (
          builder as unknown as {
            context?: {
              irradiance?: TslIrradianceNode & { mul(factor: unknown): unknown };
              iblIrradiance?: TslIrradianceNode & { mul(factor: unknown): unknown };
            };
          }
        ).context;
        if (ctx?.irradiance) {
          const sample = sampleBakedLightVolumeNode();
          const bakedIrradiance = sample.xyz;
          const bakedAo = sample.w;
          ctx.irradiance.assign(ctx.irradiance.add(bakedIrradiance).mul(bakedAo));
          if (ctx.iblIrradiance) {
            ctx.iblIrradiance.assign(ctx.iblIrradiance.mul(bakedAo));
          }
        }
      }
      origIndirectDiffuse.call(this, builder);
    };
  }

  const pointLightProto = PointLightNode.prototype as unknown as {
    setupDirect?: (this: PointLightNode, builder: NodeBuilder) => unknown;
  };
  const origSetupDirect = pointLightProto.setupDirect;
  if (typeof origSetupDirect === 'function') {
    pointLightProto.setupDirect = function (this: PointLightNode, builder: NodeBuilder): unknown {
      if (isMaterialExcludedFromIndoorLighting(builder)) {
        return {
          lightDirection: vec3(0.0, 1.0, 0.0),
          lightColor: vec3(0.0),
        };
      }

      const c = (this as unknown as { colorNode: ShaderNodeObject<Node> }).colorNode;
      const hasColor = uAnyPointLightsActive
        .greaterThan(0.5)
        .and(max(c.r, max(c.g, c.b)).greaterThan(1e-4));

      const margin = uBakedVolumeParamsNode.w;
      const inLightBounds = uBakedVolumeParamsNode.x
        .lessThanEqual(0.5)
        .or(
          positionWorld.x
            .greaterThanEqual(uBakedVolumeMinNode.x.sub(margin))
            .and(positionWorld.x.lessThanEqual(uBakedVolumeMaxNode.x.add(margin)))
            .and(positionWorld.y.greaterThanEqual(uBakedVolumeMinNode.y.sub(margin)))
            .and(positionWorld.y.lessThanEqual(uBakedVolumeMaxNode.y.add(margin)))
            .and(positionWorld.z.greaterThanEqual(uBakedVolumeMinNode.z.sub(margin)))
            .and(positionWorld.z.lessThanEqual(uBakedVolumeMaxNode.z.add(margin)))
        );

      const lightDirection = vec3(0.0, 1.0, 0.0).toVar();
      const lightColor = vec3(0.0).toVar();

      If(hasColor.and(inLightBounds), () => {
        const lVector = (
          this as unknown as { getLightVector(b: NodeBuilder): ShaderNodeObject<Node> }
        )
          .getLightVector(builder)
          .toVar();
        const distSq = dot(lVector, lVector).toVar();
        const rawCutoff = float(this.cutoffDistanceNode);
        const effectiveCutoff = select(
          uBakedVolumeParamsNode.x.greaterThan(0.5).and(rawCutoff.greaterThan(0.0)),
          min(rawCutoff, uBakedVolumeParamsNode.w),
          rawCutoff
        ).toVar();
        const inRange = effectiveCutoff
          .lessThanEqual(0.0)
          .or(distSq.lessThan(effectiveCutoff.mul(effectiveCutoff)));

        If(inRange, () => {
          const decay = float(this.decayExponentNode);
          const lightDistance = max(sqrt(distSq), 1e-4).toVar();
          lightDirection.assign(lVector.div(lightDistance));
          const distanceFalloff = lightDistance.pow(decay).max(0.01).reciprocal();
          const cutoffRatio = lightDistance.div(max(effectiveCutoff, 1e-4));
          const windowFactor = clamp(float(1.0).sub(cutoffRatio.pow4()), 0.0, 1.0).pow2();
          const attenuation = select(
            effectiveCutoff.greaterThan(0.0),
            distanceFalloff.mul(windowFactor),
            distanceFalloff
          );
          lightColor.assign(c.mul(attenuation));
        });
      });

      return { lightDirection, lightColor };
    };
  }

  const dirLightProto = DirectionalLightNode.prototype as unknown as {
    setupDirect?: (
      this: DirectionalLightNode,
      builder: NodeBuilder
    ) => { lightDirection: Node; lightColor: ShaderNodeObject<Node> };
  };
  const origDirSetupDirect = dirLightProto.setupDirect;
  if (typeof origDirSetupDirect === 'function') {
    dirLightProto.setupDirect = function (
      this: DirectionalLightNode,
      builder: NodeBuilder
    ): { lightDirection: Node; lightColor: ShaderNodeObject<Node> } {
      const base = origDirSetupDirect.call(this, builder);
      const light = (this as unknown as { light?: THREE.Light }).light;
      if (light?.userData?.['cloudGobo'] === false) {
        return base;
      }
      return {
        lightDirection: base.lightDirection,
        lightColor: base.lightColor.mul(sampleCloudGoboTransmittanceNode()),
      };
    };
  }
}

export function installShaderLightCulling(): void {
  installWebGpuLightVolumeHooks();
}
