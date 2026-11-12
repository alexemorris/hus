import * as THREE from 'three';
import type { SceneCameraPoseSnapshot } from '../../../core/types/scene.ts';
import {
  CROUCH_EYE_HEIGHT,
  STANDING_EYE_HEIGHT,
  type WalkthroughEntryPose,
  type WalkthroughRoomMinYSampler,
  type WalkthroughSpawnPoint,
} from './walkthrough-spawns.ts';

/**
 * House-agnostic walkable elevation: the floor of the room containing `(x, refFootY, z)`,
 * falling back to `sampleTerrainY(x, z)` outdoors (or `0` when no terrain sampler is supplied).
 */
export function sampleGenericWalkableElevation(
  x: number,
  refFootY: number,
  z: number,
  getRoomMinYAt: WalkthroughRoomMinYSampler,
  sampleTerrainY?: (x: number, z: number) => number
): number {
  return getRoomMinYAt(x, refFootY, z) ?? (sampleTerrainY ? sampleTerrainY(x, z) : 0);
}

/** House-agnostic eye height: standing or crouched, with no ceiling-clearance ducking. */
export function getGenericWalkthroughTargetEyeHeight(
  _x: number,
  _footY: number,
  _z: number,
  crouched: boolean
): number {
  return crouched ? CROUCH_EYE_HEIGHT : STANDING_EYE_HEIGHT;
}

/**
 * Resolves where a walkthrough starts: an explicit spawn override, else just behind the orbit
 * camera target when it lies inside a room, else the first configured spawn, else the orbit target.
 */
export function resolveGenericWalkthroughEntryPose(
  currentPose: SceneCameraPoseSnapshot,
  getRoomMinYAt: WalkthroughRoomMinYSampler,
  spawnOverride?: {
    readonly position: readonly [number, number, number];
    readonly yawDeg?: number;
  },
  spawns: readonly WalkthroughSpawnPoint[] = [],
  sampleElevation: (x: number, refFootY: number, z: number) => number = (x, refFootY, z) =>
    sampleGenericWalkableElevation(x, refFootY, z, getRoomMinYAt)
): WalkthroughEntryPose {
  if (spawnOverride) {
    const [fx, fy, fz] = spawnOverride.position;
    return {
      footX: fx,
      footY: sampleElevation(fx, fy, fz),
      footZ: fz,
      yawRad: THREE.MathUtils.degToRad(spawnOverride.yawDeg ?? 0),
      pitchRad: -0.03,
      checkMode: 'depenetrate',
    };
  }

  const [tx, ty, tz] = currentPose.target;
  const [cx, , cz] = currentPose.position;
  const dirX = tx - cx;
  const dirZ = tz - cz;
  const distXZ = Math.hypot(dirX, dirZ);
  const roomMinY = getRoomMinYAt(tx, ty, tz);
  if (roomMinY !== null && distXZ < 18.0) {
    const spawnX = distXZ > 0.5 ? tx - (dirX / distXZ) * Math.min(1.4, distXZ * 0.4) : tx;
    const spawnZ = distXZ > 0.5 ? tz - (dirZ / distXZ) * Math.min(1.4, distXZ * 0.4) : tz;
    const baseFloorY = getRoomMinYAt(spawnX, ty, spawnZ) ?? roomMinY;
    return {
      footX: spawnX,
      footY: sampleElevation(spawnX, baseFloorY, spawnZ),
      footZ: spawnZ,
      yawRad: Math.atan2(-dirX, -dirZ),
      pitchRad: -0.04,
      checkMode: 'ensure_unblocked',
    };
  }

  const def = spawns[0];
  if (def) {
    return {
      footX: def.position[0],
      footY: def.position[1],
      footZ: def.position[2],
      yawRad: THREE.MathUtils.degToRad(def.yawDeg),
      pitchRad: -0.03,
      checkMode: 'none',
    };
  }

  return {
    footX: tx,
    footY: sampleElevation(tx, ty, tz),
    footZ: tz,
    yawRad: distXZ > 1e-4 ? Math.atan2(-dirX, -dirZ) : 0,
    pitchRad: -0.03,
    checkMode: 'depenetrate',
  };
}
