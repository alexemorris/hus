import {
  BAKED_VOLUME_MIN,
  BAKED_VOLUME_SIZE,
  LIGHT_CLUSTER_NX,
  LIGHT_CLUSTER_NY,
  LIGHT_CLUSTER_NZ,
  MAX_CLUSTERED_POINT_LIGHTS,
  SHARED_CLUSTER_LIGHT_DATA_TEXTURE,
  SHARED_LIGHT_CLUSTER_TEXTURE,
  SHARED_POINT_LIGHT_ACTIVITY,
  TOTAL_CLUSTER_VOXELS,
  buildRoomBoundsBoxes,
  toRoomLocalX,
  toRoomLocalZ,
  type BakedRoomVolumeBounds,
  type RoomBoundsBox,
} from './light-volume-state.ts';

export interface ClusterPointLightInput {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly intensity: number;
  readonly distance: number;
  readonly decay: number;
}

let cachedClusterRooms: RoomBoundsBox[] = [];
let cachedClusterRoomsEpoch = 0;
let lastClusterBuildRoomsEpoch = -1;
let prevClusterActiveCount = -1;
let prevClusterEnabled = false;
const prevClusterSignature = new Float32Array(MAX_CLUSTERED_POINT_LIGHTS * 8);
const clusterSortOrder = new Int32Array(256);
const clusterSortLum = new Float32Array(256);
const clusterTopScores = new Float32Array(TOTAL_CLUSTER_VOXELS * 4);
const clusterTouchedVoxels = new Uint32Array(TOTAL_CLUSTER_VOXELS);
const clusterVoxelStamp = new Uint32Array(TOTAL_CLUSTER_VOXELS);
let clusterStampGen = 1;

export function notifyClusterRoomsRebuilt(rooms: RoomBoundsBox[]): void {
  cachedClusterRooms = rooms;
  cachedClusterRoomsEpoch++;
}

function findSmallestRoomForCluster(
  wx: number,
  wy: number,
  wz: number,
  rooms: readonly RoomBoundsBox[]
): RoomBoundsBox | null {
  let best: RoomBoundsBox | null = null;
  for (let i = 0; i < rooms.length; i++) {
    const r = rooms[i]!;
    if (!r.isInterior) continue;
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

function computeClusterWallAndSlabOcclusion(
  vx: number,
  vy: number,
  vz: number,
  room: RoomBoundsBox
): number {
  const lx = toRoomLocalX(vx, vz, room);
  const ly = vy - room.oy;
  const lz = toRoomLocalZ(vx, vz, room);
  // Solid floor / ceiling slab occlusion between Ground and First floor (padded by half-voxel Y = 0.5m)
  if (ly < room.minY - 0.52 || ly > room.maxY + 0.55) {
    return 0.03;
  }
  const dxOut = Math.max(0, room.minX - lx, lx - room.maxX);
  const dzOut = Math.max(0, room.minZ - lz, lz - room.maxZ);
  const wallDist = Math.hypot(dxOut, dzOut);
  if (wallDist <= 0.45) return 1.0;
  return Math.exp(-(wallDist - 0.3) * 2.1) * 0.22;
}

/**
 * Event-driven CPU builder for the 32x8x24 3D Voxel-Clustered KNX Point-Light Grid.
 * Runs in <0.15 ms ONLY when KNX levels, TimeOfDay, or light fades change (0.00 ms/frame during orbit).
 * Returns the number of active clustered point lights uploaded (0..64).
 */
export function updateClusteredPointLightGrid(
  lights: readonly ClusterPointLightInput[],
  enabled: boolean,
  explicitRooms?: readonly BakedRoomVolumeBounds[]
): number {
  if (explicitRooms && explicitRooms.length > 0) {
    notifyClusterRoomsRebuilt(buildRoomBoundsBoxes(explicitRooms, { useObb: true }));
  }

  if (!enabled) {
    prevClusterEnabled = false;
    SHARED_POINT_LIGHT_ACTIVITY.w = 0.0;
    return 0;
  }

  const candidateCap = Math.min(lights.length, clusterSortOrder.length);
  let activeTotal = 0;
  for (let i = 0; i < candidateCap; i++) {
    const l = lights[i]!;
    if (l.intensity <= 1e-4) continue;
    const lum = l.intensity * (0.2126 * l.r + 0.7152 * l.g + 0.0722 * l.b);
    if (lum <= 1e-5) continue;
    clusterSortOrder[activeTotal] = i;
    clusterSortLum[activeTotal] = lum;
    activeTotal++;
  }

  if (activeTotal === 0) {
    if (prevClusterActiveCount !== 0 || !prevClusterEnabled) {
      const clusterData = SHARED_LIGHT_CLUSTER_TEXTURE.image.data as Uint8Array;
      clusterData.fill(0);
      SHARED_LIGHT_CLUSTER_TEXTURE.needsUpdate = true;
      prevClusterActiveCount = 0;
      prevClusterEnabled = true;
    }
    SHARED_POINT_LIGHT_ACTIVITY.w = 0.0;
    return 0;
  }

  // Sort active lights by peak luminance descending if > MAX_CLUSTERED_POINT_LIGHTS (or deterministic top-64)
  if (activeTotal > MAX_CLUSTERED_POINT_LIGHTS) {
    for (let i = 1; i < activeTotal; i++) {
      const idx = clusterSortOrder[i]!;
      const lum = clusterSortLum[i]!;
      let j = i - 1;
      while (j >= 0 && clusterSortLum[j]! < lum) {
        clusterSortOrder[j + 1] = clusterSortOrder[j]!;
        clusterSortLum[j + 1] = clusterSortLum[j]!;
        j--;
      }
      clusterSortOrder[j + 1] = idx;
      clusterSortLum[j + 1] = lum;
    }
  }

  const activeCount = Math.min(activeTotal, MAX_CLUSTERED_POINT_LIGHTS);
  let dirty =
    !prevClusterEnabled ||
    activeCount !== prevClusterActiveCount ||
    lastClusterBuildRoomsEpoch !== cachedClusterRoomsEpoch;

  if (!dirty) {
    for (let k = 0; k < activeCount; k++) {
      const l = lights[clusterSortOrder[k]!]!;
      const base = k * 8;
      const cutoff = l.distance > 0 ? l.distance : 12.0;
      const lr = l.r * l.intensity;
      const lg = l.g * l.intensity;
      const lb = l.b * l.intensity;
      if (
        Math.abs(prevClusterSignature[base]! - l.x) > 1e-4 ||
        Math.abs(prevClusterSignature[base + 1]! - l.y) > 1e-4 ||
        Math.abs(prevClusterSignature[base + 2]! - l.z) > 1e-4 ||
        Math.abs(prevClusterSignature[base + 3]! - cutoff) > 1e-4 ||
        Math.abs(prevClusterSignature[base + 4]! - lr) > 1e-5 ||
        Math.abs(prevClusterSignature[base + 5]! - lg) > 1e-5 ||
        Math.abs(prevClusterSignature[base + 6]! - lb) > 1e-5 ||
        Math.abs(prevClusterSignature[base + 7]! - l.decay) > 1e-4
      ) {
        dirty = true;
        break;
      }
    }
  }

  SHARED_POINT_LIGHT_ACTIVITY.w = 1.0;
  if (!dirty) {
    return activeCount;
  }

  prevClusterEnabled = true;
  prevClusterActiveCount = activeCount;
  lastClusterBuildRoomsEpoch = cachedClusterRoomsEpoch;

  const lightTexData = SHARED_CLUSTER_LIGHT_DATA_TEXTURE.image.data as Float32Array;
  const clusterData = SHARED_LIGHT_CLUSTER_TEXTURE.image.data as Uint8Array;
  clusterData.fill(0);

  let stamp = ++clusterStampGen;
  if (stamp >= 0x7fffffff) {
    clusterVoxelStamp.fill(0);
    stamp = 1;
    clusterStampGen = 1;
  }

  const stepX = BAKED_VOLUME_SIZE.x / LIGHT_CLUSTER_NX; // 1.75 m
  const stepY = BAKED_VOLUME_SIZE.y / LIGHT_CLUSTER_NY; // 1.00 m
  const stepZ = BAKED_VOLUME_SIZE.z / LIGHT_CLUSTER_NZ; // 1.8333 m
  // Half-diagonal of a (1.75 x 1.00 x 1.8333 m) voxel is 1.36 m; pad by 1.45 m for zero boundary seams.
  const rPad = 1.45;
  let touchedCount = 0;

  for (let k = 0; k < activeCount; k++) {
    const l = lights[clusterSortOrder[k]!]!;
    const rawCutoff = l.distance > 0 ? l.distance : 12.0;
    const lr = l.r * l.intensity;
    const lg = l.g * l.intensity;
    const lb = l.b * l.intensity;
    const decay = l.decay;

    const sigBase = k * 8;
    prevClusterSignature[sigBase] = l.x;
    prevClusterSignature[sigBase + 1] = l.y;
    prevClusterSignature[sigBase + 2] = l.z;
    prevClusterSignature[sigBase + 3] = rawCutoff;
    prevClusterSignature[sigBase + 4] = lr;
    prevClusterSignature[sigBase + 5] = lg;
    prevClusterSignature[sigBase + 6] = lb;
    prevClusterSignature[sigBase + 7] = decay;

    // Row 0 (y = 0): (worldPos.x, worldPos.y, worldPos.z, rawCutoff)
    const row0 = k * 4;
    lightTexData[row0] = l.x;
    lightTexData[row0 + 1] = l.y;
    lightTexData[row0 + 2] = l.z;
    lightTexData[row0 + 3] = rawCutoff;

    // Row 1 (y = 1): (linearColor * intensity, decay)
    const row1 = (MAX_CLUSTERED_POINT_LIGHTS + k) * 4;
    lightTexData[row1] = lr;
    lightTexData[row1 + 1] = lg;
    lightTexData[row1 + 2] = lb;
    lightTexData[row1 + 3] = decay;

    const peakLum = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
    const effectiveCutoff = Math.min(rawCutoff, 14.0);
    const maxR = effectiveCutoff + rPad;
    const maxRSq = maxR * maxR;
    const hostRoom = findSmallestRoomForCluster(l.x, l.y, l.z, cachedClusterRooms);
    const slotValue = k + 1;

    const minIx = Math.max(
      0,
      Math.floor(((l.x - maxR - BAKED_VOLUME_MIN.x) / BAKED_VOLUME_SIZE.x) * LIGHT_CLUSTER_NX)
    );
    const maxIx = Math.min(
      LIGHT_CLUSTER_NX - 1,
      Math.floor(((l.x + maxR - BAKED_VOLUME_MIN.x) / BAKED_VOLUME_SIZE.x) * LIGHT_CLUSTER_NX)
    );
    const minIy = Math.max(
      0,
      Math.floor(((l.y - maxR - BAKED_VOLUME_MIN.y) / BAKED_VOLUME_SIZE.y) * LIGHT_CLUSTER_NY)
    );
    const maxIy = Math.min(
      LIGHT_CLUSTER_NY - 1,
      Math.floor(((l.y + maxR - BAKED_VOLUME_MIN.y) / BAKED_VOLUME_SIZE.y) * LIGHT_CLUSTER_NY)
    );
    const minIz = Math.max(
      0,
      Math.floor(((l.z - maxR - BAKED_VOLUME_MIN.z) / BAKED_VOLUME_SIZE.z) * LIGHT_CLUSTER_NZ)
    );
    const maxIz = Math.min(
      LIGHT_CLUSTER_NZ - 1,
      Math.floor(((l.z + maxR - BAKED_VOLUME_MIN.z) / BAKED_VOLUME_SIZE.z) * LIGHT_CLUSTER_NZ)
    );

    for (let iz = minIz; iz <= maxIz; iz++) {
      const vz = BAKED_VOLUME_MIN.z + (iz + 0.5) * stepZ;
      const dz = vz - l.z;
      const dzSq = dz * dz;
      if (dzSq >= maxRSq) continue;
      for (let iy = minIy; iy <= maxIy; iy++) {
        const vy = BAKED_VOLUME_MIN.y + (iy + 0.5) * stepY;
        const dy = vy - l.y;
        const dyzSq = dzSq + dy * dy;
        if (dyzSq >= maxRSq) continue;
        const rowBase = LIGHT_CLUSTER_NX * (iy + LIGHT_CLUSTER_NY * iz);
        for (let ix = minIx; ix <= maxIx; ix++) {
          const vx = BAKED_VOLUME_MIN.x + (ix + 0.5) * stepX;
          const dx = vx - l.x;
          const distSq = dyzSq + dx * dx;
          if (distSq >= maxRSq) continue;

          const dist = Math.sqrt(distSq);
          const effDist = Math.max(0.25, dist - 0.65 * rPad);
          const rRatio = Math.min(1, effDist / Math.max(effectiveCutoff, 0.5));
          const rRatio2 = rRatio * rRatio;
          const win = Math.max(0, 1 - rRatio2 * rRatio2);
          const atten = (win * win) / Math.max(0.05, Math.pow(effDist, decay));
          const occlusion = hostRoom
            ? computeClusterWallAndSlabOcclusion(vx, vy, vz, hostRoom)
            : 0.85;
          const score = peakLum * atten * occlusion;
          if (score <= 1e-6) continue;

          const vIdx = ix + rowBase;
          const v4 = vIdx * 4;
          if (clusterVoxelStamp[vIdx] !== stamp) {
            clusterVoxelStamp[vIdx] = stamp;
            clusterTouchedVoxels[touchedCount++] = vIdx;
            clusterTopScores[v4] = score;
            clusterTopScores[v4 + 1] = 0;
            clusterTopScores[v4 + 2] = 0;
            clusterTopScores[v4 + 3] = 0;
            clusterData[v4] = slotValue;
          } else if (score > clusterTopScores[v4 + 3]!) {
            // Insert into sorted top-4 slots
            let pos = 3;
            while (pos > 0 && score > clusterTopScores[v4 + pos - 1]!) {
              clusterTopScores[v4 + pos] = clusterTopScores[v4 + pos - 1]!;
              clusterData[v4 + pos] = clusterData[v4 + pos - 1]!;
              pos--;
            }
            clusterTopScores[v4 + pos] = score;
            clusterData[v4 + pos] = slotValue;
          }
        }
      }
    }
  }

  SHARED_CLUSTER_LIGHT_DATA_TEXTURE.needsUpdate = true;
  SHARED_LIGHT_CLUSTER_TEXTURE.needsUpdate = true;
  return activeCount;
}
