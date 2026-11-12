import * as THREE from 'three';
import type { CircuitId } from '../../../core/types/knx.ts';
import type { TimeOfDay } from '../../../core/types/scene.ts';
import type { GraphicsTier } from '../../../core/types/twin-ux.ts';

export interface BakedRoomBox {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface BakedRoomVolumeBounds {
  readonly zoneId?: string;
  readonly isInterior?: boolean;
  /** Rooms sharing one open-plan volume with this room (daylight spills almost unattenuated). */
  readonly linkedOpenPlanZones?: readonly string[];
  /** Rooms joined to this room by an open stair void (daylight spills between floors). */
  readonly linkedStairwellZones?: readonly string[];
  readonly obb?: {
    readonly bounds: BakedRoomBox;
    readonly offset: readonly [number, number, number];
    readonly rotationY: number;
  };
  readonly bounds: BakedRoomBox;
}

/**
 * 3D Baked Light & Ambient Occlusion Volume covering the entire architectural scene,
 * Courtyard, and Outbuildings/Barns footprint:
 *   X: [-34.0 .. 22.0] (56.0 m)
 *   Y: [ -0.6 ..  7.4] ( 8.0 m)
 *   Z: [-18.0 .. 26.0] (44.0 m)
 *
 * Channel packing (RGBA8 3D texture, hardware trilinear filtered via sampler3D):
 *   - RGB: Gamma-encoded (sqrt) HDR diffuse irradiance combining:
 *          (a) Per-circuit KNX direct + 1-bounce warm room GI with wall & slab occlusion, and
 *          (b) Precomputed exterior window / bifold / rooflight sky-portal daylight GI + warm
 *              floor/wall 1-bounce reflection (strictly masked to interior rooms, 0 GPU shader cost).
 *   - A:   Static architectural Ambient Occlusion (floor-wall skirting corners,
 *          wall-wall intersections, and ceiling coves) baked once at startup.
 */
export const BAKED_VOLUME_NX = 64;
export const BAKED_VOLUME_NY = 16;
export const BAKED_VOLUME_NZ = 48;
export const TOTAL_VOXELS = BAKED_VOLUME_NX * BAKED_VOLUME_NY * BAKED_VOLUME_NZ;

export const LIGHT_CLUSTER_NX = 32;
export const LIGHT_CLUSTER_NY = 8;
export const LIGHT_CLUSTER_NZ = 24;
export const TOTAL_CLUSTER_VOXELS = LIGHT_CLUSTER_NX * LIGHT_CLUSTER_NY * LIGHT_CLUSTER_NZ;
export const MAX_CLUSTERED_POINT_LIGHTS = 64;

export const BAKED_VOLUME_MIN = new THREE.Vector3(-34.0, -0.6, -18.0);
export const BAKED_VOLUME_MAX = new THREE.Vector3(22.0, 7.4, 26.0);
export const BAKED_VOLUME_SIZE = new THREE.Vector3().subVectors(BAKED_VOLUME_MAX, BAKED_VOLUME_MIN);

export const HDR_IRRADIANCE_RANGE = 3.5;
export const MAX_TOD_LIGHT_SCALE = 0.95;
export const HDR_KNX_UNSCALED_RANGE = HDR_IRRADIANCE_RANGE / MAX_TOD_LIGHT_SCALE;

export const TOD_LIGHT_SCALE: Readonly<Record<TimeOfDay, number>> = {
  day: 0.24,
  dusk: 0.84,
  night: 0.95,
};

export interface SparseCircuitBake {
  readonly circuitId: CircuitId;
  /** Flat voxel indices (0 .. TOTAL_VOXELS - 1). */
  readonly voxelIndices: Uint32Array;
  /** Interleaved (r, g, b) unit-level irradiance weights (length = voxelIndices.length * 3). */
  readonly rgbWeights: Float32Array;
}

export interface RoomBoundsBox {
  readonly zoneId: string;
  readonly isInterior: boolean;
  readonly linkedOpenPlanZones?: readonly string[];
  readonly linkedStairwellZones?: readonly string[];
  readonly ox: number;
  readonly oy: number;
  readonly oz: number;
  readonly cosY: number;
  readonly sinY: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly worldCenterX: number;
  readonly worldCenterY: number;
  readonly worldCenterZ: number;
  readonly volume: number;
}

export interface DaylightPortalEmitter {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  area: number;
  readonly exposure: number;
  readonly hostRoom: RoomBoundsBox;
}

// ---------------------------------------------------------------------------
// Shared Uniform Singletons (bound by reference across renderGroup materials)
// ---------------------------------------------------------------------------

function makeNonCloning<T extends { clone: () => T }>(obj: T): T {
  obj.clone = () => obj;
  return obj;
}

const initialVolumeData = new Uint8Array(TOTAL_VOXELS * 4);
for (let i = 0; i < TOTAL_VOXELS; i++) {
  initialVolumeData[i * 4 + 3] = 255; // neutral AO = 1.0 until baked
}

function createVolume3DTexture(data: Uint8Array): THREE.Data3DTexture {
  const tex = new THREE.Data3DTexture(
    data,
    BAKED_VOLUME_NX,
    BAKED_VOLUME_NY,
    BAKED_VOLUME_NZ
  );
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export const SHARED_BAKED_VOLUME_TEXTURE: THREE.Data3DTexture = makeNonCloning(
  createVolume3DTexture(initialVolumeData)
);

/**
 * Static prebaked daylight sky-portal GI 3D texture (64x16x48 RGBA8), uploaded once at bake time.
 * Runtime solar/weather/ToD updates modulate only `SHARED_DAYLIGHT_GI_TINT` (0 CPU rebuilds, 0 uploads).
 */
export const SHARED_DAYLIGHT_VOLUME_TEXTURE: THREE.Data3DTexture = makeNonCloning(
  createVolume3DTexture(new Uint8Array(TOTAL_VOXELS * 4))
);

function createLightCluster3DTexture(): THREE.Data3DTexture {
  const tex = new THREE.Data3DTexture(
    new Uint8Array(TOTAL_CLUSTER_VOXELS * 4),
    LIGHT_CLUSTER_NX,
    LIGHT_CLUSTER_NY,
    LIGHT_CLUSTER_NZ
  );
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function createClusterLightDataTexture(): THREE.DataTexture {
  const tex = new THREE.DataTexture(
    new Float32Array(MAX_CLUSTERED_POINT_LIGHTS * 2 * 4),
    MAX_CLUSTERED_POINT_LIGHTS,
    2,
    THREE.RGBAFormat,
    THREE.FloatType
  );
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.flipY = false;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 32x8x24 (24 KB) RGBA8 3D voxel cluster grid storing up to 4 1-based active PointLight indices
 * (`idx + 1`, `0` = empty) per voxel across `[BAKED_VOLUME_MIN, BAKED_VOLUME_MAX]`.
 */
export const SHARED_LIGHT_CLUSTER_TEXTURE: THREE.Data3DTexture = makeNonCloning(
  createLightCluster3DTexture()
);

/**
 * 64x2 RGBA32F DataTexture (`NearestFilter`, core WebGPU `UnfilterableFloat` via `textureLoad`):
 * - Row `y = 0`: `(worldPos.x, worldPos.y, worldPos.z, rawCutoffM)`
 * - Row `y = 1`: `(linearColor.r * intensity, linearColor.g * intensity, linearColor.b * intensity, decay)`
 */
export const SHARED_CLUSTER_LIGHT_DATA_TEXTURE: THREE.DataTexture = makeNonCloning(
  createClusterLightDataTexture()
);

export const SHARED_DAYLIGHT_GI_TINT: THREE.Vector3 = makeNonCloning(new THREE.Vector3(0, 0, 0));

/**
 * x = uAnyPointLightsActive (1 when >=1 scene point light has intensity > 0, else 0)
 * y = KNX 3D GI TimeOfDay scale (TOD_LIGHT_SCALE[mode] / MAX_TOD_LIGHT_SCALE)
 * z = Daylight 3D GI enabled (1.0 across all tiers)
 * w = uClusteredPointLightsActive (1 when 3D Voxel-Clustered KNX Grid has >=1 active light)
 */
let baseKnxTodUniformScale = TOD_LIGHT_SCALE.dusk / MAX_TOD_LIGHT_SCALE;
let pointLightZeroBudgetBoost = 1.0;
let lowTierDisableDaylightVolume = false;
let lowTierSuppressKnxVolume = false;

export const SHARED_POINT_LIGHT_ACTIVITY: THREE.Vector4 = makeNonCloning(
  new THREE.Vector4(1.0, baseKnxTodUniformScale, 1.0, 0.0)
);

export function syncSharedPointLightActivity(): void {
  SHARED_POINT_LIGHT_ACTIVITY.y = lowTierSuppressKnxVolume
    ? 0.0
    : baseKnxTodUniformScale * pointLightZeroBudgetBoost;
  SHARED_POINT_LIGHT_ACTIVITY.z = lowTierDisableDaylightVolume ? 0.0 : 1.0;
}

export function setBaseKnxTodUniformScale(scale: number): void {
  baseKnxTodUniformScale = scale;
  syncSharedPointLightActivity();
}

export function setAnyPointLightsActive(active: boolean): void {
  SHARED_POINT_LIGHT_ACTIVITY.x = active ? 1.0 : 0.0;
}

/**
 * Boosts KNX 3D baked irradiance volume contribution by 1.35x when `pointLightBudget === 0`
 * ('low' mobile tier) so Dusk/Night KNX rooms stay warm and bright with 0 active PointLights.
 */
export function setPointLightZeroBudgetBoost(enabled: boolean): void {
  pointLightZeroBudgetBoost = enabled ? 1.35 : 1.0;
  syncSharedPointLightActivity();
}

/**
 * On `'low'` mobile tier, disables the 3D daylight sky-portal texture lookup permanently and
 * suppresses the 3D KNX baked volume lookup during Daytime or when viewing the exterior (`all` floors),
 * eliminating all 32 trilinear voxel reads per pixel on exterior walls, roofs, and daytime views.
 */
export function setBakedVolumeLowTierState(
  lowTier: boolean,
  suppressKnxVolume: boolean
): void {
  lowTierDisableDaylightVolume = lowTier;
  lowTierSuppressKnxVolume = lowTier && suppressKnxVolume;
  syncSharedPointLightActivity();
}

export const SHARED_CAMERA_WORLD_MATRIX: THREE.Matrix4 = makeNonCloning(new THREE.Matrix4());

export const SHARED_VOLUME_MIN: THREE.Vector3 = makeNonCloning(BAKED_VOLUME_MIN.clone());
export const SHARED_VOLUME_MAX: THREE.Vector3 = makeNonCloning(BAKED_VOLUME_MAX.clone());

export const SHARED_VOLUME_INV_SIZE: THREE.Vector3 = makeNonCloning(
  new THREE.Vector3(
    1 / BAKED_VOLUME_SIZE.x,
    1 / BAKED_VOLUME_SIZE.y,
    1 / BAKED_VOLUME_SIZE.z
  )
);

/**
 * x = enabled (1 or 0)
 * y = baked GI irradiance multiplier
 * z = baked architectural AO strength (0..1)
 * w = direct PointLight GGX BRDF cutoff distance (m)
 */
export const SHARED_VOLUME_PARAMS: THREE.Vector4 = makeNonCloning(
  new THREE.Vector4(0.0, 1.35, 0.20, 8.5)
);

let pendingStaticAoUpload = false;

export function setPendingStaticAoUpload(pending: boolean): void {
  pendingStaticAoUpload = pending;
}

export function syncBakedLightCameraMatrix(camera: THREE.Camera): void {
  SHARED_CAMERA_WORLD_MATRIX.copy(camera.matrixWorld);
  if (pendingStaticAoUpload) {
    pendingStaticAoUpload = false;
    SHARED_BAKED_VOLUME_TEXTURE.needsUpdate = true;
  }
}

export function setBakedLightTierDirectCutoff(tier: GraphicsTier): void {
  const cutoffByTier: Readonly<Record<GraphicsTier, number>> = {
    low: 6.0,
    medium: 7.5,
    high: 9.5,
    ultra: 14.0,
  };
  const aoStrengthByTier: Readonly<Record<GraphicsTier, number>> = {
    low: 0.24,
    medium: 0.22,
    high: 0.16,
    ultra: 0.14,
  };
  SHARED_VOLUME_PARAMS.z = aoStrengthByTier[tier];
  SHARED_VOLUME_PARAMS.w = cutoffByTier[tier];
}

// ---------------------------------------------------------------------------
// OBB Room Bounds & Wall/Slab Occlusion Helpers
// ---------------------------------------------------------------------------

export function buildRoomBoundsBoxes(
  registrations: readonly BakedRoomVolumeBounds[],
  options: { readonly useObb?: boolean; readonly interiorOnly?: boolean } = {}
): RoomBoundsBox[] {
  const useObb = options.useObb !== false;
  const interiorOnly = options.interiorOnly === true;
  const out: RoomBoundsBox[] = [];
  for (const reg of registrations) {
    const isInterior = reg.isInterior !== false;
    if (interiorOnly && !isInterior) continue;

    if (!useObb) {
      const b = reg.bounds;
      const volume = Math.max(0.1, (b.maxX - b.minX) * (b.maxY - b.minY) * (b.maxZ - b.minZ));
      out.push({
        zoneId: reg.zoneId ?? '',
        isInterior,
        linkedOpenPlanZones: reg.linkedOpenPlanZones,
        linkedStairwellZones: reg.linkedStairwellZones,
        ox: 0,
        oy: 0,
        oz: 0,
        cosY: 1,
        sinY: 0,
        minX: b.minX,
        maxX: b.maxX,
        minY: b.minY,
        maxY: b.maxY,
        minZ: b.minZ,
        maxZ: b.maxZ,
        worldCenterX: 0.5 * (b.minX + b.maxX),
        worldCenterY: 0.5 * (b.minY + b.maxY),
        worldCenterZ: 0.5 * (b.minZ + b.maxZ),
        volume,
      });
      continue;
    }

    const b = reg.obb ? reg.obb.bounds : reg.bounds;
    const ox = reg.obb?.offset[0] ?? 0;
    const oy = reg.obb?.offset[1] ?? 0;
    const oz = reg.obb?.offset[2] ?? 0;
    const rotY = reg.obb?.rotationY ?? 0;
    const cosY = Math.cos(rotY);
    const sinY = Math.sin(rotY);
    const cxLocal = 0.5 * (b.minX + b.maxX);
    const cyLocal = 0.5 * (b.minY + b.maxY);
    const czLocal = 0.5 * (b.minZ + b.maxZ);
    const volume = Math.max(0.1, (b.maxX - b.minX) * (b.maxY - b.minY) * (b.maxZ - b.minZ));
    out.push({
      zoneId: reg.zoneId ?? '',
      isInterior,
      linkedOpenPlanZones: reg.linkedOpenPlanZones,
      linkedStairwellZones: reg.linkedStairwellZones,
      ox,
      oy,
      oz,
      cosY,
      sinY,
      minX: b.minX,
      maxX: b.maxX,
      minY: b.minY,
      maxY: b.maxY,
      minZ: b.minZ,
      maxZ: b.maxZ,
      worldCenterX: cxLocal * cosY + czLocal * sinY + ox,
      worldCenterY: cyLocal + oy,
      worldCenterZ: -cxLocal * sinY + czLocal * cosY + oz,
      volume,
    });
  }
  return out;
}

export function toRoomLocalX(wx: number, wz: number, r: RoomBoundsBox): number {
  const dx = wx - r.ox;
  const dz = wz - r.oz;
  return dx * r.cosY - dz * r.sinY;
}

export function toRoomLocalZ(wx: number, wz: number, r: RoomBoundsBox): number {
  const dx = wx - r.ox;
  const dz = wz - r.oz;
  return dx * r.sinY + dz * r.cosY;
}

export function findSmallestContainingRoom(
  wx: number,
  wy: number,
  wz: number,
  rooms: readonly RoomBoundsBox[]
): RoomBoundsBox | null {
  let best: RoomBoundsBox | null = null;
  for (const r of rooms) {
    const lx = toRoomLocalX(wx, wz, r);
    const ly = wy - r.oy;
    const lz = toRoomLocalZ(wx, wz, r);
    if (
      lx >= r.minX - 0.35 &&
      lx <= r.maxX + 0.35 &&
      ly >= r.minY - 0.25 &&
      ly <= r.maxY + 0.35 &&
      lz >= r.minZ - 0.35 &&
      lz <= r.maxZ + 0.35
    ) {
      if (!best || r.volume < best.volume) {
        best = r;
      }
    }
  }
  return best;
}

export function computeRoomWallAndSlabOcclusion(
  vx: number,
  vy: number,
  vz: number,
  room: RoomBoundsBox
): number {
  const lx = toRoomLocalX(vx, vz, room);
  const ly = vy - room.oy;
  const lz = toRoomLocalZ(vx, wzOrVz(vz), room);
  // Solid floor / ceiling slab occlusion between Ground and First floor
  if (ly < room.minY - 0.18 || ly > room.maxY + 0.22) {
    return 0.03;
  }
  const dxOut = Math.max(0, room.minX - lx, lx - room.maxX);
  const dzOut = Math.max(0, room.minZ - lz, lz - room.maxZ);
  const wallDist = Math.hypot(dxOut, dzOut);
  if (wallDist <= 0.15) return 1.0;
  // Soft doorway spill near room boundary, strong attenuation through solid walls
  return Math.exp(-wallDist * 2.1) * 0.22;
}

function wzOrVz(vz: number): number {
  return vz;
}
