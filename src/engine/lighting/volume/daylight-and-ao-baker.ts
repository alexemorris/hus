import * as THREE from 'three';
import {
  BAKED_VOLUME_MIN,
  BAKED_VOLUME_NX,
  BAKED_VOLUME_NY,
  BAKED_VOLUME_NZ,
  BAKED_VOLUME_SIZE,
  HDR_IRRADIANCE_RANGE,
  SHARED_DAYLIGHT_VOLUME_TEXTURE,
  TOTAL_VOXELS,
  findSmallestContainingRoom,
  toRoomLocalX,
  toRoomLocalZ,
  type RoomBoundsBox,
} from './light-volume-state.ts';
import {
  discoverDaylightPortals,
  findContainingInteriorRoomStrict,
} from './glazed-portal-discovery.ts';

export function computePortalToVoxelCoupling(
  vx: number,
  _vy: number,
  vz: number,
  portalRoom: RoomBoundsBox,
  voxelRoom: RoomBoundsBox
): number {
  if (portalRoom === voxelRoom) return 1.0;

  // Open-plan rooms share a seamless opening with zero partition wall
  const isOpenPlan =
    Boolean(portalRoom.linkedOpenPlanZones?.includes(voxelRoom.zoneId)) ||
    Boolean(voxelRoom.linkedOpenPlanZones?.includes(portalRoom.zoneId));
  if (isOpenPlan) return 0.92;

  // Open stairwell between a lower hall and the landing above it
  const isStairwell =
    Boolean(portalRoom.linkedStairwellZones?.includes(voxelRoom.zoneId)) ||
    Boolean(voxelRoom.linkedStairwellZones?.includes(portalRoom.zoneId));
  if (isStairwell) return 0.38;

  // Solid floor slab between Ground and First Floor
  const pMinY = portalRoom.oy + portalRoom.minY;
  const pMaxY = portalRoom.oy + portalRoom.maxY;
  const vMinY = voxelRoom.oy + voxelRoom.minY;
  const vMaxY = voxelRoom.oy + voxelRoom.maxY;
  if (vMaxY < pMinY + 0.25 || vMinY > pMaxY - 0.25) {
    return 0.0;
  }

  // Soft doorway spill into adjacent rooms on the same floor
  const lx = toRoomLocalX(vx, vz, portalRoom);
  const lz = toRoomLocalZ(vx, vz, portalRoom);
  const dxOut = Math.max(0, portalRoom.minX - lx, lx - portalRoom.maxX);
  const dzOut = Math.max(0, portalRoom.minZ - lz, lz - portalRoom.maxZ);
  const wallDist = Math.hypot(dxOut, dzOut);
  return Math.exp(-wallDist * 0.95) * 0.28;
}

export function bakeDaylightPortals(
  sceneRoot: THREE.Object3D | undefined,
  interiorRooms: readonly RoomBoundsBox[]
): { readonly daylightVoxelCount: number; readonly portalCount: number } {
  const dlTexData = SHARED_DAYLIGHT_VOLUME_TEXTURE.image.data as Uint8Array;
  dlTexData.fill(0);
  SHARED_DAYLIGHT_VOLUME_TEXTURE.needsUpdate = true;

  if (!sceneRoot || interiorRooms.length === 0) {
    return { daylightVoxelCount: 0, portalCount: 0 };
  }

  const portals = discoverDaylightPortals(sceneRoot, interiorRooms);
  const portalCount = portals.length;
  if (portalCount === 0) {
    return { daylightVoxelCount: 0, portalCount: 0 };
  }

  const stepX = BAKED_VOLUME_SIZE.x / BAKED_VOLUME_NX;
  const stepY = BAKED_VOLUME_SIZE.y / BAKED_VOLUME_NY;
  const stepZ = BAKED_VOLUME_SIZE.z / BAKED_VOLUME_NZ;

  const indicesBuf = new Uint32Array(TOTAL_VOXELS);
  const basisBuf = new Float32Array(TOTAL_VOXELS * 3);
  let count = 0;

  for (let iz = 0; iz < BAKED_VOLUME_NZ; iz++) {
    const vz = BAKED_VOLUME_MIN.z + (iz + 0.5) * stepZ;
    for (let iy = 0; iy < BAKED_VOLUME_NY; iy++) {
      const vy = BAKED_VOLUME_MIN.y + (iy + 0.5) * stepY;
      const rowBase = BAKED_VOLUME_NX * (iy + BAKED_VOLUME_NY * iz);
      for (let ix = 0; ix < BAKED_VOLUME_NX; ix++) {
        const vx = BAKED_VOLUME_MIN.x + (ix + 0.5) * stepX;
        const voxelRoom = findContainingInteriorRoomStrict(vx, vy, vz, interiorRooms);
        if (!voxelRoom) continue;

        let skySum = 0;
        let bounceSum = 0;
        const roomHeight = Math.max(1.5, voxelRoom.maxY - voxelRoom.minY);
        const ceilRatio = THREE.MathUtils.clamp(
          (vy - (voxelRoom.oy + voxelRoom.minY)) / roomHeight,
          0,
          1
        );
        const ceilBounceBoost = 0.88 + 0.30 * ceilRatio;

        for (let pIdx = 0; pIdx < portals.length; pIdx++) {
          const p = portals[pIdx]!;
          const reach = Math.min(13.5, 6.4 + 2.4 * Math.sqrt(p.area));
          const dx = vx - p.x;
          const dy = vy - p.y;
          const dz = vz - p.z;
          const distSq = dx * dx + dy * dy + dz * dz;
          if (distSq >= reach * reach) continue;

          const coupling = computePortalToVoxelCoupling(
            vx,
            vy,
            vz,
            p.hostRoom,
            voxelRoom
          );
          if (coupling <= 1e-3) continue;

          const dist = Math.sqrt(distSq);
          const cosIn = dist > 0.2 ? (dx * p.nx + dy * p.ny + dz * p.nz) / dist : 0.78;
          if (cosIn <= -0.25) continue;

          const hemiWrap =
            THREE.MathUtils.smoothstep(cosIn, -0.25, 0.55) *
            (0.46 + 0.54 * Math.max(0, cosIn));
          const rRatio = dist / reach;
          const win = Math.max(0, 1 - rRatio * rRatio * rRatio * rRatio);
          const directSky = ((win * win) / (1.0 + 0.14 * distSq)) * hemiWrap;

          const bounceSpan = Math.max(0, 1 - rRatio * 0.88);
          const bounce = 0.32 * bounceSpan * bounceSpan * ceilBounceBoost;

          const effArea = Math.min(3.5, Math.pow(p.area, 0.82)) * p.exposure * coupling;
          skySum += directSky * effArea;
          bounceSum += bounce * effArea;
        }

        // Soft-shoulder room radiosity compression + borrowed doorway daylight floor inside interior rooms
        const skyTerm = (skySum * 0.44) / (1.0 + skySum * 0.52);
        const bounceTerm = (bounceSum * 0.38) / (1.0 + bounceSum * 0.62) + 0.075;

        // Edge feathering near the exterior perimeter so trilinear filtering never bleeds onto outer brick/cobbles
        const lx = toRoomLocalX(vx, vz, voxelRoom);
        const lz = toRoomLocalZ(vx, vz, voxelRoom);
        const dWall = Math.min(
          lx - voxelRoom.minX,
          voxelRoom.maxX - lx,
          lz - voxelRoom.minZ,
          voxelRoom.maxZ - lz
        );
        const perimeterFeather = THREE.MathUtils.clamp(0.72 + 0.28 * (dWall / 0.45), 0.72, 1.0);

        const br = (skyTerm * 0.97 + bounceTerm * 1.05) * perimeterFeather;
        const bg = (skyTerm * 0.99 + bounceTerm * 0.99) * perimeterFeather;
        const bb = (skyTerm * 1.03 + bounceTerm * 0.91) * perimeterFeather;
        if (br <= 1e-4 && bg <= 1e-4 && bb <= 1e-4) continue;

        const slot = count++;
        indicesBuf[slot] = ix + rowBase;
        const slot3 = slot * 3;
        basisBuf[slot3] = br;
        basisBuf[slot3 + 1] = bg;
        basisBuf[slot3 + 2] = bb;
      }
    }
  }

  if (count > 0) {
    const invRange = 1 / HDR_IRRADIANCE_RANGE;
    for (let i = 0; i < count; i++) {
      const dst = indicesBuf[i]! * 4;
      const src = i * 3;
      const br = basisBuf[src]!;
      const bg = basisBuf[src + 1]!;
      const bb = basisBuf[src + 2]!;
      dlTexData[dst] = br > 0 ? Math.round(Math.sqrt(Math.min(1, br * invRange)) * 255) : 0;
      dlTexData[dst + 1] = bg > 0 ? Math.round(Math.sqrt(Math.min(1, bg * invRange)) * 255) : 0;
      dlTexData[dst + 2] = bb > 0 ? Math.round(Math.sqrt(Math.min(1, bb * invRange)) * 255) : 0;
      dlTexData[dst + 3] = 255;
    }
    SHARED_DAYLIGHT_VOLUME_TEXTURE.needsUpdate = true;
  }

  return { daylightVoxelCount: count, portalCount };
}

export function bakeStaticArchitecturalAo(
  texData: Uint8Array,
  rooms: readonly RoomBoundsBox[]
): void {
  const stepX = BAKED_VOLUME_SIZE.x / BAKED_VOLUME_NX;
  const stepY = BAKED_VOLUME_SIZE.y / BAKED_VOLUME_NY;
  const stepZ = BAKED_VOLUME_SIZE.z / BAKED_VOLUME_NZ;

  for (let iz = 0; iz < BAKED_VOLUME_NZ; iz++) {
    const vz = BAKED_VOLUME_MIN.z + (iz + 0.5) * stepZ;
    for (let iy = 0; iy < BAKED_VOLUME_NY; iy++) {
      const vy = BAKED_VOLUME_MIN.y + (iy + 0.5) * stepY;
      for (let ix = 0; ix < BAKED_VOLUME_NX; ix++) {
        const vx = BAKED_VOLUME_MIN.x + (ix + 0.5) * stepX;
        const room = findSmallestContainingRoom(vx, vy, vz, rooms);
        let ao = 1.0;
        if (room) {
          const lx = toRoomLocalX(vx, vz, room);
          const ly = vy - room.oy;
          const lz = toRoomLocalZ(vx, vz, room);
          const dFloor = Math.max(0, ly - room.minY);
          const dCeil = Math.max(0, room.maxY - ly);
          const dWallX = Math.max(0, Math.min(lx - room.minX, room.maxX - lx));
          const dWallZ = Math.max(0, Math.min(lz - room.minZ, room.maxZ - lz));

          const fFloor = 1 - Math.exp(-dFloor * 2.2);
          const fCeil = 1 - Math.exp(-dCeil * 2.0);
          const fWallX = 1 - Math.exp(-dWallX * 1.8);
          const fWallZ = 1 - Math.exp(-dWallZ * 1.8);

          // Crevice / corner darkening where two or three planes meet
          const cornerFactor = fFloor * fCeil * fWallX * fWallZ;
          ao = 0.62 + 0.38 * Math.min(1, Math.pow(cornerFactor, 0.45));
        } else if (vy >= 0 && vy < 0.8) {
          // Subtle ground contact AO outdoors
          ao = 0.88 + 0.12 * Math.min(1, vy / 0.8);
        }
        const flatIdx = (ix + BAKED_VOLUME_NX * (iy + BAKED_VOLUME_NY * iz)) * 4;
        texData[flatIdx + 3] = Math.round(THREE.MathUtils.clamp(ao, 0.55, 1.0) * 255);
      }
    }
  }
}
