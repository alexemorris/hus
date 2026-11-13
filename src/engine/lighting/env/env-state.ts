import * as THREE from 'three';
import type { EnvPresetConfig, Vec3Tuple } from './env-presets.ts';

/** World-space box that must receive sun shadows (buildings, courtyard, garden, road & valley). */
export interface ShadowFitBox {
  readonly min: Vec3Tuple;
  readonly max: Vec3Tuple;
}

/**
 * Navigable site (`SITE_PIVOT_BOUNDS` x −40..30, z −20..35) from lower road / valley grade
 * (`min[1] = -3.0` so lower road/valley receivers never clip shadows) up to roof ridges / tree tops.
 */
export const SITE_SHADOW_BOX: ShadowFitBox = { min: [-44, -3.0, -20], max: [34, 18.5, 32] };

/** Extended caster depth box including the upper paddock (+X up to +50 m) so raking sun never clips upstream casters. */
export const SITE_CASTER_SHADOW_BOX: ShadowFitBox = { min: [-46, -3.5, -22], max: [50, 19.5, 34] };

/** Distance (m) from the shadow box centre to the directional light. */
const SUN_DISTANCE = 105;

/** Orthographic extents of a shadow camera fitted around a box, in light view space. */
export interface ShadowFrustum {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly near: number;
  readonly far: number;
}

/**
 * Computes the tightest orthographic shadow frustum around `box` for a directional light at
 * `position` looking at `target` (what three's `DirectionalLightShadow` does with `lookAt`).
 * Depends only on the sun direction, never on the camera, so shadows are identical in every view.
 */
const _fitViewScratch = new THREE.Matrix4();
const _fitCornerScratch = new THREE.Vector3();
const _fitCenterLightScratch = new THREE.Vector3();
const _fitDirScratch = new THREE.Vector3();
const _upY = new THREE.Vector3(0, 1, 0);
const _upZ = new THREE.Vector3(0, 0, 1);
const _lerpDirScratch = new THREE.Vector3();
const _lerpQuatScratch = new THREE.Quaternion();
const _lerpQuatKScratch = new THREE.Quaternion();

export function fitShadowFrustum(
  position: THREE.Vector3,
  target: THREE.Vector3,
  box: ShadowFitBox,
  margin = 1.0
): ShadowFrustum {
  const view = _fitViewScratch.lookAt(position, target, _upY);
  view.setPosition(position);
  view.invert();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const p = _fitCornerScratch;
  for (let i = 0; i < 8; i++) {
    p.set(i & 1 ? box.max[0] : box.min[0], i & 2 ? box.max[1] : box.min[1], i & 4 ? box.max[2] : box.min[2]);
    p.applyMatrix4(view);
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  // The light looks down −Z in its own view space.
  return {
    left: minX - margin,
    right: maxX + margin,
    bottom: minY - margin,
    top: maxY + margin,
    near: Math.max(0.1, -maxZ - margin),
    far: -minZ + margin,
  };
}

/** Light position + target for a sun direction, centred on the shadow box. */
export function sunPlacement(
  direction: THREE.Vector3,
  box: ShadowFitBox = SITE_SHADOW_BOX
): { position: THREE.Vector3; target: THREE.Vector3 } {
  const target = new THREE.Vector3(
    (box.min[0] + box.max[0]) / 2,
    0,
    (box.min[2] + box.max[2]) / 2
  );
  const position = target.clone().addScaledVector(direction.clone().normalize(), SUN_DISTANCE);
  return { position, target };
}

export interface CameraFittedShadowFrustumResult {
  readonly position: THREE.Vector3;
  readonly target: THREE.Vector3;
  readonly frustum: ShadowFrustum;
  readonly texelSizeM: number;
  readonly snappedLightX: number;
  readonly snappedLightY: number;
}

/**
 * Builds a camera-target-fitted, light-space texel-snapped directional shadow frustum.
 *
 * The light view rotation stays anchored at world origin `(0, 0, 0)` (eliminating `lookAt`
 * rotation jitter), while the orthographic XY window (`±halfExtentM`) is centred on `worldCenter`
 * and snapped to exact integer multiples of `texelSizeM = (halfExtentM * 2) / shadowMapSize`.
 * Depth (`near` / `far`) spans the entire `casterBox` so upstream roofs, chimneys, and trees
 * never clip along low raking sun rays.
 */
export function fitCameraTargetShadowFrustum(
  sunDirection: THREE.Vector3,
  worldCenter: THREE.Vector3,
  halfExtentM: number,
  shadowMapSize: number,
  casterBox: ShadowFitBox = SITE_CASTER_SHADOW_BOX,
  outPosition?: THREE.Vector3,
  outTarget?: THREE.Vector3
): CameraFittedShadowFrustumResult {
  const dir = _fitDirScratch.copy(sunDirection).normalize();
  const target = (outTarget ?? new THREE.Vector3()).set(0, 0, 0);
  const position = (outPosition ?? new THREE.Vector3()).copy(dir).multiplyScalar(SUN_DISTANCE);
  const up = Math.abs(dir.y) > 0.995 ? _upZ : _upY;
  const view = _fitViewScratch.lookAt(position, target, up);
  view.setPosition(position);
  view.invert();

  const cLight = _fitCenterLightScratch.copy(worldCenter).applyMatrix4(view);
  const safeMapSize = Math.max(256, shadowMapSize);
  const texelSizeM = (halfExtentM * 2) / safeMapSize;
  const snappedLightX = Math.round(cLight.x / texelSizeM) * texelSizeM;
  const snappedLightY = Math.round(cLight.y / texelSizeM) * texelSizeM;

  let minZ = Infinity;
  let maxZ = -Infinity;
  const corner = _fitCornerScratch;
  for (let i = 0; i < 8; i++) {
    corner.set(
      i & 1 ? casterBox.max[0] : casterBox.min[0],
      i & 2 ? casterBox.max[1] : casterBox.min[1],
      i & 4 ? casterBox.max[2] : casterBox.min[2]
    );
    corner.applyMatrix4(view);
    minZ = Math.min(minZ, corner.z);
    maxZ = Math.max(maxZ, corner.z);
  }

  return {
    position,
    target,
    frustum: {
      left: snappedLightX - halfExtentM,
      right: snappedLightX + halfExtentM,
      bottom: snappedLightY - halfExtentM,
      top: snappedLightY + halfExtentM,
      near: Math.max(0.5, -maxZ - 6.0),
      far: -minZ + 8.0,
    },
    texelSizeM,
    snappedLightX,
    snappedLightY,
  };
}

/** The interpolatable (non-texture) part of the environment for smooth time-of-day transitions. */
export interface EnvLightingState {
  readonly sunDirection: THREE.Vector3;
  readonly sunColor: THREE.Color;
  sunIntensity: number;
  sunShadowIntensity: number;
  sunShadowRadius: number;
  readonly hemiSkyColor: THREE.Color;
  readonly hemiGroundColor: THREE.Color;
  hemiIntensity: number;
  envIntensity: number;
  bgIntensity: number;
  bgBlurriness: number;
  exposure: number;
  readonly fogColor: THREE.Color;
  fogDensity: number;
  daylightGiStrength: number;
  readonly daylightGiTint: THREE.Color;
}

export function stateFromPreset(cfg: EnvPresetConfig): EnvLightingState {
  return {
    sunDirection: new THREE.Vector3(...cfg.sunDirection).normalize(),
    sunColor: new THREE.Color(cfg.sunColor),
    sunIntensity: cfg.sunIntensity,
    sunShadowIntensity: 1.0,
    sunShadowRadius: 1.0,
    hemiSkyColor: new THREE.Color(cfg.hemiSkyColor),
    hemiGroundColor: new THREE.Color(cfg.hemiGroundColor),
    hemiIntensity: cfg.hemiIntensity,
    envIntensity: cfg.envIntensity,
    bgIntensity: cfg.bgIntensity,
    bgBlurriness: cfg.bgBlurriness,
    exposure: cfg.exposure,
    fogColor: new THREE.Color(cfg.fogColor),
    fogDensity: cfg.fogDensity,
    daylightGiStrength: cfg.daylightGiStrength ?? 0,
    daylightGiTint: new THREE.Color(1.0, 0.98, 0.94),
  };
}

/**
 * Writes `from → to` at `t` (0..1) into `out`. Intensities and exposure interpolate geometrically
 * (perceptually even fades between e.g. 3.2 and 0.22), the sun direction along the great circle.
 */
function geoLerp(a: number, b: number, k: number): number {
  return a > 0 && b > 0 ? Math.exp(THREE.MathUtils.lerp(Math.log(a), Math.log(b), k)) : THREE.MathUtils.lerp(a, b, k);
}

export function lerpEnvState(
  from: EnvLightingState,
  to: EnvLightingState,
  t: number,
  out: EnvLightingState
): EnvLightingState {
  const k = Math.max(0, Math.min(1, t));
  const dir = _lerpDirScratch.copy(from.sunDirection);
  const q = _lerpQuatScratch.setFromUnitVectors(from.sunDirection, to.sunDirection);
  const qk = _lerpQuatKScratch.identity().slerp(q, k);
  out.sunDirection.copy(dir.applyQuaternion(qk)).normalize();
  out.sunColor.copy(from.sunColor).lerp(to.sunColor, k);
  out.sunIntensity = geoLerp(from.sunIntensity, to.sunIntensity, k);
  out.sunShadowIntensity = THREE.MathUtils.lerp(from.sunShadowIntensity, to.sunShadowIntensity, k);
  out.sunShadowRadius = THREE.MathUtils.lerp(from.sunShadowRadius, to.sunShadowRadius, k);
  out.hemiSkyColor.copy(from.hemiSkyColor).lerp(to.hemiSkyColor, k);
  out.hemiGroundColor.copy(from.hemiGroundColor).lerp(to.hemiGroundColor, k);
  out.hemiIntensity = geoLerp(from.hemiIntensity, to.hemiIntensity, k);
  out.envIntensity = geoLerp(from.envIntensity, to.envIntensity, k);
  out.bgIntensity = geoLerp(from.bgIntensity, to.bgIntensity, k);
  out.bgBlurriness = THREE.MathUtils.lerp(from.bgBlurriness, to.bgBlurriness, k);
  out.exposure = geoLerp(from.exposure, to.exposure, k);
  out.fogColor.copy(from.fogColor).lerp(to.fogColor, k);
  out.fogDensity = geoLerp(from.fogDensity, to.fogDensity, k);
  out.daylightGiStrength = THREE.MathUtils.lerp(from.daylightGiStrength, to.daylightGiStrength, k);
  out.daylightGiTint.copy(from.daylightGiTint).lerp(to.daylightGiTint, k);
  return out;
}

/** Copies every field of `src` into `dst` with zero allocations. */
export function copyEnvState(src: EnvLightingState, dst: EnvLightingState): EnvLightingState {
  dst.sunDirection.copy(src.sunDirection);
  dst.sunColor.copy(src.sunColor);
  dst.sunIntensity = src.sunIntensity;
  dst.sunShadowIntensity = src.sunShadowIntensity;
  dst.sunShadowRadius = src.sunShadowRadius;
  dst.hemiSkyColor.copy(src.hemiSkyColor);
  dst.hemiGroundColor.copy(src.hemiGroundColor);
  dst.hemiIntensity = src.hemiIntensity;
  dst.envIntensity = src.envIntensity;
  dst.bgIntensity = src.bgIntensity;
  dst.bgBlurriness = src.bgBlurriness;
  dst.exposure = src.exposure;
  dst.fogColor.copy(src.fogColor);
  dst.fogDensity = src.fogDensity;
  dst.daylightGiStrength = src.daylightGiStrength;
  dst.daylightGiTint.copy(src.daylightGiTint);
  return dst;
}
