import * as THREE from 'three';
import type { CircuitId, CircuitLevels } from '../../core/types/knx.ts';
import type { TimeOfDay } from '../../core/types/scene.ts';
import type { LightGroupMap } from '../viewer/scene-types.ts';
import {
  BAKED_VOLUME_MAX,
  BAKED_VOLUME_MIN,
  BAKED_VOLUME_NX,
  BAKED_VOLUME_NY,
  BAKED_VOLUME_NZ,
  BAKED_VOLUME_SIZE,
  HDR_IRRADIANCE_RANGE,
  HDR_KNX_UNSCALED_RANGE,
  LIGHT_CLUSTER_NX,
  LIGHT_CLUSTER_NY,
  LIGHT_CLUSTER_NZ,
  MAX_CLUSTERED_POINT_LIGHTS,
  MAX_TOD_LIGHT_SCALE,
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
  TOD_LIGHT_SCALE,
  TOTAL_CLUSTER_VOXELS,
  TOTAL_VOXELS,
  buildRoomBoundsBoxes,
  computeRoomWallAndSlabOcclusion,
  findSmallestContainingRoom,
  setAnyPointLightsActive,
  setBakedLightTierDirectCutoff,
  setBakedVolumeLowTierState,
  setBaseKnxTodUniformScale,
  setPendingStaticAoUpload,
  setPointLightZeroBudgetBoost,
  syncBakedLightCameraMatrix,
  type BakedRoomBox,
  type BakedRoomVolumeBounds,
  type SparseCircuitBake,
} from './volume/light-volume-state.ts';
import { bakeDaylightPortals, bakeStaticArchitecturalAo } from './volume/daylight-and-ao-baker.ts';
import {
  discoverExteriorGlazedPortals,
  type DiscoveredExteriorGlazedPortal,
} from './volume/glazed-portal-discovery.ts';
import {
  notifyClusterRoomsRebuilt,
  updateClusteredPointLightGrid,
  type ClusterPointLightInput,
} from './volume/clustered-point-light-grid.ts';

export {
  BAKED_VOLUME_NX,
  BAKED_VOLUME_NY,
  BAKED_VOLUME_NZ,
  LIGHT_CLUSTER_NX,
  LIGHT_CLUSTER_NY,
  LIGHT_CLUSTER_NZ,
  TOTAL_CLUSTER_VOXELS,
  MAX_CLUSTERED_POINT_LIGHTS,
  BAKED_VOLUME_MIN,
  BAKED_VOLUME_MAX,
  BAKED_VOLUME_SIZE,
  SHARED_BAKED_VOLUME_TEXTURE,
  SHARED_DAYLIGHT_VOLUME_TEXTURE,
  SHARED_LIGHT_CLUSTER_TEXTURE,
  SHARED_CLUSTER_LIGHT_DATA_TEXTURE,
  SHARED_DAYLIGHT_GI_TINT,
  SHARED_POINT_LIGHT_ACTIVITY,
  SHARED_CAMERA_WORLD_MATRIX,
  SHARED_VOLUME_MIN,
  SHARED_VOLUME_MAX,
  SHARED_VOLUME_INV_SIZE,
  SHARED_VOLUME_PARAMS,
  setAnyPointLightsActive,
  setPointLightZeroBudgetBoost,
  setBakedVolumeLowTierState,
  syncBakedLightCameraMatrix,
  setBakedLightTierDirectCutoff,
  updateClusteredPointLightGrid,
  discoverExteriorGlazedPortals,
  type BakedRoomBox,
  type BakedRoomVolumeBounds,
  type ClusterPointLightInput,
  type DiscoveredExteriorGlazedPortal,
};

export class BakedLightVolumeController {
  private readonly circuitBakes: SparseCircuitBake[] = [];
  private daylightVoxelCount = 0;
  private portalCount = 0;
  private daylightR = 0;
  private daylightG = 0;
  private daylightB = 0;
  private knxTodUniformScale = TOD_LIGHT_SCALE.dusk / MAX_TOD_LIGHT_SCALE;
  private readonly hdrAccum = new Float32Array(TOTAL_VOXELS * 3);
  private appliedWeights = new Float32Array(0);
  private lastTimeOfDay: TimeOfDay | null = null;
  private dirtyEpoch = 1;
  private readonly voxelDirtyStamp = new Uint32Array(TOTAL_VOXELS);
  private readonly dirtyVoxelList = new Uint32Array(TOTAL_VOXELS);
  private incrementalCount = 0;
  private lastContinuousUploadMs = -Infinity;
  private rebuildFullVolumeCount = 0;
  private baked = false;

  public constructor(
    lightGroups: LightGroupMap,
    lodRegistrations: readonly BakedRoomVolumeBounds[] = [],
    sceneRoot?: THREE.Object3D
  ) {
    this.bakeFromScene(lightGroups, lodRegistrations, sceneRoot);
  }

  public isBaked(): boolean {
    return this.baked;
  }

  public getBakedCircuitCount(): number {
    return this.circuitBakes.length;
  }

  public getBakedDaylightPortalCount(): number {
    return this.portalCount;
  }

  public getBakedDaylightVoxelCount(): number {
    return this.daylightVoxelCount;
  }

  public getRebuildFullVolumeCount(): number {
    return this.rebuildFullVolumeCount;
  }

  /**
   * Precomputes:
   * 1. Static architectural Ambient Occlusion (`A` channel) from room wall/floor/ceiling proximity.
   * 2. Per-circuit sparse voxel irradiance + wall/slab occlusion + warm indirect bounce (`RGB` basis).
   * 3. Static exterior window / glazing sky-portal daylight GI (`RGB` basis strictly inside interior rooms).
   */
  public bakeFromScene(
    lightGroups: LightGroupMap,
    lodRegistrations: readonly BakedRoomVolumeBounds[] = [],
    sceneRoot?: THREE.Object3D
  ): void {
    this.circuitBakes.length = 0;
    const aabbRooms = buildRoomBoundsBoxes(lodRegistrations, { useObb: false });
    const portalRooms = buildRoomBoundsBoxes(lodRegistrations, { useObb: true });

    notifyClusterRoomsRebuilt(portalRooms);
    const interiorPortalRooms = portalRooms.filter((r) => r.isInterior);
    const texData = SHARED_BAKED_VOLUME_TEXTURE.image.data as Uint8Array;
    bakeStaticArchitecturalAo(texData, aabbRooms);
    const daylightResult = bakeDaylightPortals(sceneRoot, interiorPortalRooms);
    this.daylightVoxelCount = daylightResult.daylightVoxelCount;
    this.portalCount = daylightResult.portalCount;

    const stepX = BAKED_VOLUME_SIZE.x / BAKED_VOLUME_NX;
    const stepY = BAKED_VOLUME_SIZE.y / BAKED_VOLUME_NY;
    const stepZ = BAKED_VOLUME_SIZE.z / BAKED_VOLUME_NZ;

    const worldPos = new THREE.Vector3();
    const colorLinear = new THREE.Color();
    const bakeStamp = new Uint32Array(TOTAL_VOXELS);
    const bakeSlot = new Uint32Array(TOTAL_VOXELS);
    const bakeVoxels = new Uint32Array(TOTAL_VOXELS);
    const bakeRgb = new Float32Array(TOTAL_VOXELS * 3);
    let stampGen = 1;

    for (const [rawId, group] of Object.entries(lightGroups)) {
      if (!group || group.lights.length === 0) continue;
      const circuitId = rawId as CircuitId;
      let count = 0;
      const curStamp = stampGen++;

      for (const light of group.lights) {
        light.updateWorldMatrix(true, false);
        light.getWorldPosition(worldPos);
        colorLinear.copy(light.color);

        const baseIntensity =
          typeof light.userData?.baseIntensity === 'number'
            ? (light.userData.baseIntensity as number)
            : light.intensity;
        const decayGain =
          typeof light.userData?.knxDecayGain === 'number'
            ? (light.userData.knxDecayGain as number)
            : 1;
        const unitPeak = Math.max(0, baseIntensity * decayGain);
        if (unitPeak <= 1e-4) continue;

        const radius = light.distance > 0 ? Math.min(11.0, light.distance * 1.15) : 6.5;
        const radiusSq = radius * radius;

        const hostRoom = findSmallestContainingRoom(
          worldPos.x,
          worldPos.y,
          worldPos.z,
          aabbRooms
        );

        const minIx = Math.max(
          0,
          Math.floor(((worldPos.x - radius - BAKED_VOLUME_MIN.x) / BAKED_VOLUME_SIZE.x) * BAKED_VOLUME_NX)
        );
        const maxIx = Math.min(
          BAKED_VOLUME_NX - 1,
          Math.ceil(((worldPos.x + radius - BAKED_VOLUME_MIN.x) / BAKED_VOLUME_SIZE.x) * BAKED_VOLUME_NX)
        );
        const minIy = Math.max(
          0,
          Math.floor(((worldPos.y - radius - BAKED_VOLUME_MIN.y) / BAKED_VOLUME_SIZE.y) * BAKED_VOLUME_NY)
        );
        const maxIy = Math.min(
          BAKED_VOLUME_NY - 1,
          Math.ceil(((worldPos.y + radius - BAKED_VOLUME_MIN.y) / BAKED_VOLUME_SIZE.y) * BAKED_VOLUME_NY)
        );
        const minIz = Math.max(
          0,
          Math.floor(((worldPos.z - radius - BAKED_VOLUME_MIN.z) / BAKED_VOLUME_SIZE.z) * BAKED_VOLUME_NZ)
        );
        const maxIz = Math.min(
          BAKED_VOLUME_NZ - 1,
          Math.ceil(((worldPos.z + radius - BAKED_VOLUME_MIN.z) / BAKED_VOLUME_SIZE.z) * BAKED_VOLUME_NZ)
        );

        for (let iz = minIz; iz <= maxIz; iz++) {
          const vz = BAKED_VOLUME_MIN.z + (iz + 0.5) * stepZ;
          const dz = vz - worldPos.z;
          const dzSq = dz * dz;
          if (dzSq >= radiusSq) continue;
          for (let iy = minIy; iy <= maxIy; iy++) {
            const vy = BAKED_VOLUME_MIN.y + (iy + 0.5) * stepY;
            const dy = vy - worldPos.y;
            const dyzSq = dzSq + dy * dy;
            if (dyzSq >= radiusSq) continue;
            const rowBase = BAKED_VOLUME_NX * (iy + BAKED_VOLUME_NY * iz);
            for (let ix = minIx; ix <= maxIx; ix++) {
              const vx = BAKED_VOLUME_MIN.x + (ix + 0.5) * stepX;
              const dx = vx - worldPos.x;
              const distSq = dyzSq + dx * dx;
              if (distSq >= radiusSq) continue;

              const dist = Math.sqrt(distSq);
              const rRatio = dist / radius;
              const windowFactor = Math.max(0, 1 - rRatio * rRatio * rRatio * rRatio);
              const smoothWindow = windowFactor * windowFactor;
              const directAtten = smoothWindow / (1.0 + 0.45 * distSq);
              // 1-bounce warm indirect room fill inside the light's zone
              const bounceAtten = 0.24 * Math.max(0, 1 - rRatio) * Math.max(0, 1 - rRatio);

              const occlusion = hostRoom
                ? computeRoomWallAndSlabOcclusion(vx, vy, vz, hostRoom)
                : 0.85;
              const totalAtten =
                (directAtten * 0.42 + bounceAtten) * occlusion * Math.min(2.6, unitPeak * 0.14);
              if (totalAtten <= 1e-4) continue;

              // Warm oak/plaster indirect tint on the bounce component
              const r = colorLinear.r * totalAtten * 1.04;
              const g = colorLinear.g * totalAtten * 0.98;
              const b = colorLinear.b * totalAtten * 0.90;

              const flatIdx = ix + rowBase;
              if (bakeStamp[flatIdx] === curStamp) {
                const slot3 = bakeSlot[flatIdx]! * 3;
                bakeRgb[slot3] = bakeRgb[slot3]! + r;
                bakeRgb[slot3 + 1] = bakeRgb[slot3 + 1]! + g;
                bakeRgb[slot3 + 2] = bakeRgb[slot3 + 2]! + b;
              } else {
                const slot = count++;
                bakeStamp[flatIdx] = curStamp;
                bakeSlot[flatIdx] = slot;
                bakeVoxels[slot] = flatIdx;
                const slot3 = slot * 3;
                bakeRgb[slot3] = r;
                bakeRgb[slot3 + 1] = g;
                bakeRgb[slot3 + 2] = b;
              }
            }
          }
        }
      }

      if (count > 0) {
        const voxelIndices = bakeVoxels.slice(0, count);
        const rgbWeights = bakeRgb.slice(0, count * 3);
        this.circuitBakes.push({ circuitId, voxelIndices, rgbWeights });
      }
    }

    this.hdrAccum.fill(0);
    this.appliedWeights = new Float32Array(this.circuitBakes.length);
    this.daylightR = 0;
    this.daylightG = 0;
    this.daylightB = 0;
    SHARED_DAYLIGHT_GI_TINT.set(0, 0, 0);
    this.lastTimeOfDay = null;
    this.incrementalCount = 0;
    for (let i = 0; i < TOTAL_VOXELS; i++) {
      const dst = i * 4;
      texData[dst] = 0;
      texData[dst + 1] = 0;
      texData[dst + 2] = 0;
    }

    this.baked = this.circuitBakes.length > 0 || this.daylightVoxelCount > 0;
    SHARED_VOLUME_PARAMS.x = this.baked ? 1.0 : 0.0;
    setPendingStaticAoUpload(this.baked);
  }

  /**
   * Updates the dynamic solar/weather multiplier & sky tint for precomputed window sky-portal GI.
   * When `strength === 0` (`dusk` and `night`), zero daylight GI is added so evening/night
   * volumes remain 100% unchanged. Skips GPU uploads on no-op updates.
   */
  public setDaylightState(
    strength: number,
    tint: readonly [number, number, number] = [1.0, 0.98, 0.94]
  ): void {
    if (!this.baked || this.daylightVoxelCount === 0) {
      SHARED_DAYLIGHT_GI_TINT.set(0, 0, 0);
      return;
    }
    const clamped = strength > 1e-4 ? Math.max(0, strength) : 0;
    const nextR = clamped * Math.max(0, tint[0]);
    const nextG = clamped * Math.max(0, tint[1]);
    const nextB = clamped * Math.max(0, tint[2]);
    if (
      Math.abs(nextR - this.daylightR) <= 1e-4 &&
      Math.abs(nextG - this.daylightG) <= 1e-4 &&
      Math.abs(nextB - this.daylightB) <= 1e-4
    ) {
      return;
    }
    this.daylightR = nextR;
    this.daylightG = nextG;
    this.daylightB = nextB;
    SHARED_DAYLIGHT_GI_TINT.set(nextR, nextG, nextB);
  }

  /**
   * Re-accumulates the baked 3D irradiance volume from the live KNX circuit levels
   * and time-of-day scale. Uses sparse incremental delta accumulation when only a
   * subset of circuits change (<0.02 ms), skipping GPU 3D texture uploads entirely
   * on no-op updates.
   */
  public updateFromCircuitLevels(
    levels: Readonly<CircuitLevels>,
    timeOfDay: TimeOfDay,
    continuousFade = false
  ): void {
    if (!this.baked) return;
    const knxTodScale = TOD_LIGHT_SCALE[timeOfDay] / MAX_TOD_LIGHT_SCALE;
    this.knxTodUniformScale = knxTodScale;
    setBaseKnxTodUniformScale(knxTodScale);

    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (
      continuousFade &&
      this.lastTimeOfDay === timeOfDay &&
      nowMs - this.lastContinuousUploadMs < 66
    ) {
      return;
    }

    const bakes = this.circuitBakes;
    const bakeCount = bakes.length;
    const applied = this.appliedWeights;
    const accum = this.hdrAccum;
    const texData = SHARED_BAKED_VOLUME_TEXTURE.image.data as Uint8Array;
    const invRange = 1 / HDR_KNX_UNSCALED_RANGE;

    if (this.lastTimeOfDay !== null && this.incrementalCount < 256) {
      let changedCircuits = 0;
      for (let c = 0; c < bakeCount; c++) {
        const rawPct = levels[bakes[c]!.circuitId] ?? 0;
        const norm = rawPct <= 0 ? 0 : Math.max(0, Math.min(100, rawPct)) / 100;
        const w = norm > 0 ? Math.pow(norm, 1.35) : 0;
        const nextW = w > 1e-4 ? w : 0;
        if (Math.abs(nextW - applied[c]!) > 1e-6) {
          changedCircuits++;
        }
      }

      if (changedCircuits === 0) {
        this.lastTimeOfDay = timeOfDay;
        return;
      }

      if (changedCircuits <= bakeCount >>> 1) {
        let epoch = ++this.dirtyEpoch;
        if (epoch >= 0x7fffffff) {
          this.voxelDirtyStamp.fill(0);
          epoch = 1;
          this.dirtyEpoch = 1;
        }
        const stamp = this.voxelDirtyStamp;
        const dirtyList = this.dirtyVoxelList;
        let dirtyCount = 0;

        for (let c = 0; c < bakeCount; c++) {
          const bake = bakes[c]!;
          const rawPct = levels[bake.circuitId] ?? 0;
          const norm = rawPct <= 0 ? 0 : Math.max(0, Math.min(100, rawPct)) / 100;
          const w = norm > 0 ? Math.pow(norm, 1.35) : 0;
          const nextW = w > 1e-4 ? w : 0;
          const prevW = applied[c]!;
          const delta = nextW - prevW;
          if (Math.abs(delta) <= 1e-6) continue;
          applied[c] = nextW;

          const indices = bake.voxelIndices;
          const rgb = bake.rgbWeights;
          const n = indices.length;
          for (let i = 0; i < n; i++) {
            const vIdx = indices[i]!;
            const dstOffset = vIdx * 3;
            const srcOffset = i * 3;
            const nr = accum[dstOffset]! + rgb[srcOffset]! * delta;
            const ng = accum[dstOffset + 1]! + rgb[srcOffset + 1]! * delta;
            const nb = accum[dstOffset + 2]! + rgb[srcOffset + 2]! * delta;
            accum[dstOffset] = nr > 1e-6 ? nr : 0;
            accum[dstOffset + 1] = ng > 1e-6 ? ng : 0;
            accum[dstOffset + 2] = nb > 1e-6 ? nb : 0;
            if (stamp[vIdx] !== epoch) {
              stamp[vIdx] = epoch;
              dirtyList[dirtyCount++] = vIdx;
            }
          }
        }

        for (let d = 0; d < dirtyCount; d++) {
          const vIdx = dirtyList[d]!;
          const src = vIdx * 3;
          const dst = vIdx * 4;
          const ar = accum[src]!;
          const ag = accum[src + 1]!;
          const ab = accum[src + 2]!;
          if (ar <= 0 && ag <= 0 && ab <= 0) {
            texData[dst] = 0;
            texData[dst + 1] = 0;
            texData[dst + 2] = 0;
          } else {
            texData[dst] = ar > 0 ? Math.round(Math.sqrt(Math.min(1, ar * invRange)) * 255) : 0;
            texData[dst + 1] = ag > 0 ? Math.round(Math.sqrt(Math.min(1, ag * invRange)) * 255) : 0;
            texData[dst + 2] = ab > 0 ? Math.round(Math.sqrt(Math.min(1, ab * invRange)) * 255) : 0;
          }
        }

        this.lastTimeOfDay = timeOfDay;
        this.incrementalCount++;
        this.lastContinuousUploadMs = nowMs;
        setPendingStaticAoUpload(false);
        SHARED_BAKED_VOLUME_TEXTURE.needsUpdate = true;
        return;
      }
    }

    this.lastContinuousUploadMs = nowMs;
    this.rebuildFullVolume(levels, timeOfDay);
  }

  private rebuildFullVolume(
    levels: Readonly<CircuitLevels> | null,
    timeOfDay: TimeOfDay
  ): void {
    const knxTodScale = TOD_LIGHT_SCALE[timeOfDay] / MAX_TOD_LIGHT_SCALE;
    this.knxTodUniformScale = knxTodScale;
    setBaseKnxTodUniformScale(knxTodScale);
    const bakes = this.circuitBakes;
    const bakeCount = bakes.length;
    const applied = this.appliedWeights;
    const accum = this.hdrAccum;
    const texData = SHARED_BAKED_VOLUME_TEXTURE.image.data as Uint8Array;
    const invRange = 1 / HDR_KNX_UNSCALED_RANGE;

    accum.fill(0);

    if (levels) {
      for (let c = 0; c < bakeCount; c++) {
        const bake = bakes[c]!;
        const rawPct = levels[bake.circuitId] ?? 0;
        const norm = rawPct <= 0 ? 0 : Math.max(0, Math.min(100, rawPct)) / 100;
        const w = norm > 0 ? Math.pow(norm, 1.35) : 0;
        const nextW = w > 1e-4 ? w : 0;
        applied[c] = nextW;
        if (nextW === 0) continue;

        const indices = bake.voxelIndices;
        const rgb = bake.rgbWeights;
        const n = indices.length;
        for (let i = 0; i < n; i++) {
          const dstOffset = indices[i]! * 3;
          const srcOffset = i * 3;
          accum[dstOffset] = accum[dstOffset]! + rgb[srcOffset]! * nextW;
          accum[dstOffset + 1] = accum[dstOffset + 1]! + rgb[srcOffset + 1]! * nextW;
          accum[dstOffset + 2] = accum[dstOffset + 2]! + rgb[srcOffset + 2]! * nextW;
        }
      }
    } else {
      applied.fill(0);
    }

    for (let i = 0; i < TOTAL_VOXELS; i++) {
      const src = i * 3;
      const dst = i * 4;
      const ar = accum[src]!;
      const ag = accum[src + 1]!;
      const ab = accum[src + 2]!;
      if (ar <= 0 && ag <= 0 && ab <= 0) {
        texData[dst] = 0;
        texData[dst + 1] = 0;
        texData[dst + 2] = 0;
      } else {
        texData[dst] = ar > 0 ? Math.round(Math.sqrt(Math.min(1, ar * invRange)) * 255) : 0;
        texData[dst + 1] = ag > 0 ? Math.round(Math.sqrt(Math.min(1, ag * invRange)) * 255) : 0;
        texData[dst + 2] = ab > 0 ? Math.round(Math.sqrt(Math.min(1, ab * invRange)) * 255) : 0;
      }
    }

    this.lastTimeOfDay = timeOfDay;
    this.incrementalCount = 0;
    this.rebuildFullVolumeCount++;
    setPendingStaticAoUpload(false);
    SHARED_BAKED_VOLUME_TEXTURE.needsUpdate = true;
  }

  /** Reads back the decoded RGB irradiance and static AO at a world position (used by unit tests). */
  public sampleAtWorldPosition(
    x: number,
    y: number,
    z: number
  ): { readonly r: number; readonly g: number; readonly b: number; readonly ao: number } {
    const ix = THREE.MathUtils.clamp(
      Math.floor(((x - BAKED_VOLUME_MIN.x) / BAKED_VOLUME_SIZE.x) * BAKED_VOLUME_NX),
      0,
      BAKED_VOLUME_NX - 1
    );
    const iy = THREE.MathUtils.clamp(
      Math.floor(((y - BAKED_VOLUME_MIN.y) / BAKED_VOLUME_SIZE.y) * BAKED_VOLUME_NY),
      0,
      BAKED_VOLUME_NY - 1
    );
    const iz = THREE.MathUtils.clamp(
      Math.floor(((z - BAKED_VOLUME_MIN.z) / BAKED_VOLUME_SIZE.z) * BAKED_VOLUME_NZ),
      0,
      BAKED_VOLUME_NZ - 1
    );
    const flatIdx = (ix + BAKED_VOLUME_NX * (iy + BAKED_VOLUME_NY * iz)) * 4;
    const texData = SHARED_BAKED_VOLUME_TEXTURE.image.data as Uint8Array;
    const dlData = SHARED_DAYLIGHT_VOLUME_TEXTURE.image.data as Uint8Array;
    const rn = texData[flatIdx]! / 255;
    const gn = texData[flatIdx + 1]! / 255;
    const bn = texData[flatIdx + 2]! / 255;
    const ao = texData[flatIdx + 3]! / 255;
    const drn = dlData[flatIdx]! / 255;
    const dgn = dlData[flatIdx + 1]! / 255;
    const dbn = dlData[flatIdx + 2]! / 255;
    const knxScale = this.knxTodUniformScale;
    return {
      r: (rn * rn * knxScale + drn * drn * this.daylightR) * HDR_IRRADIANCE_RANGE,
      g: (gn * gn * knxScale + dgn * dgn * this.daylightG) * HDR_IRRADIANCE_RANGE,
      b: (bn * bn * knxScale + dbn * dbn * this.daylightB) * HDR_IRRADIANCE_RANGE,
      ao,
    };
  }
}
