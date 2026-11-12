import * as THREE from 'three';
import type { SceneCameraPoseSnapshot } from '../../../core/types/scene.ts';
import type { RoomZoneId } from '../../../core/types/topology.ts';
import type { CameraRig } from '../../camera/camera-rig.ts';
import type { FloorSurfaceType } from './walkthrough-footstep-audio.ts';
import type { WalkthroughClimbableController } from './walkthrough-ladder-climb.ts';

export interface WalkthroughSpawnPoint {
  readonly id: string;
  readonly label: string;
  readonly zoneId: RoomZoneId;
  readonly position: readonly [number, number, number]; // [x, footY, z]
  readonly yawDeg: number; // 0 = looking North (-Z), 90 = West (-X), -90 = East (+X), 180 = South (+Z)
}

export type WalkthroughRoomMinYSampler = (x: number, y: number, z: number) => number | null;

export interface WalkthroughEntryPose {
  readonly footX: number;
  readonly footY: number;
  readonly footZ: number;
  readonly yawRad: number;
  readonly pitchRad: number;
  readonly checkMode: 'none' | 'depenetrate' | 'ensure_unblocked';
}

export interface WalkthroughWallSlideAxes {
  readonly projU: number;
  readonly projV: number;
  readonly slideU: THREE.Vector3;
  readonly slideV: THREE.Vector3;
}

/** Scripted first-person camera pose emitted by a cutscene for one frame. */
export interface WalkthroughCutscenePose {
  readonly footPos: readonly [number, number, number];
  readonly yawRad: number;
  readonly pitchRad: number;
  readonly eyeHeight: number;
  readonly bobOffsetY?: number;
  readonly rollRad?: number;
  readonly fovBoost?: number;
}

export interface WalkthroughCutsceneCurrentPose {
  readonly footPos: THREE.Vector3;
  readonly yawRad: number;
  readonly pitchRad: number;
  readonly eyeHeight: number;
}

/** House-supplied scripted first-person choreography that temporarily owns the walkthrough camera. */
export interface WalkthroughCutsceneController {
  readonly id: string;
  getProximityPrompt?(footPos: THREE.Vector3, rawTargetedPrompt: string | null): string | null;
  tryTrigger(
    footPos: THREE.Vector3,
    yawRad: number,
    pitchRad: number,
    eyeHeight: number,
    targetedPrompt: string | null
  ): boolean;
  /** Optional: capture the blend-in start pose when the cutscene is started programmatically. */
  begin?(current: WalkthroughCutsceneCurrentPose): void;
  isActive(): boolean;
  reset(): void;
  step(dtSeconds: number, current: WalkthroughCutsceneCurrentPose): WalkthroughCutscenePose | null;
}

/** Scene callbacks a house's cutscenes may drive. */
export interface WalkthroughCutsceneHost {
  readonly triggerGolfSimulatorShot?: () => boolean;
  readonly getGolfSimulatorShotElapsedSec?: () => number | null;
  readonly getGolfSimulatorPrompt?: () => string | null;
}

/** How a house wants one candidate mesh treated by the walkthrough collision solver. */
export interface WalkthroughCollisionMeshRule {
  /** Never collide with this mesh. */
  readonly ignore?: boolean;
  /** Treat a zero-thickness plane as a solid wall. */
  readonly solidPlane?: boolean;
  /** Low, thin barrier (fence / gate) that blocks movement despite its small footprint. */
  readonly thinBarrier?: boolean;
  /** Solid raycast obstacle regardless of geometry type. */
  readonly solid?: boolean;
  /** Never register a furniture OBB for this mesh. */
  readonly noFurniture?: boolean;
  /** Always register a furniture OBB, extended upward by this many metres. */
  readonly forceFurnitureHeadroomM?: number;
}

/**
 * Per-house first-person walkthrough rules. Every member is optional; the engine falls back to
 * flat room-floor elevation, axis-aligned wall sliding, and `userData`-driven collision.
 */
export interface HouseWalkthroughHooks {
  readonly spawns?: readonly WalkthroughSpawnPoint[];
  readonly sessionStorageKey?: string;
  readonly sampleTerrainY?: (x: number, z: number) => number;
  readonly sampleWalkableElevation?: (
    x: number,
    refFootY: number,
    z: number,
    getRoomMinYAt: WalkthroughRoomMinYSampler
  ) => number;
  readonly getTargetEyeHeight?: (x: number, footY: number, z: number, crouched: boolean) => number;
  readonly resolveEntryPose?: (
    currentPose: SceneCameraPoseSnapshot,
    getRoomMinYAt: WalkthroughRoomMinYSampler,
    spawnOverride?: {
      readonly position: readonly [number, number, number];
      readonly yawDeg?: number;
    }
  ) => WalkthroughEntryPose;
  readonly computeWallSlideAxes?: (
    footX: number,
    footZ: number,
    moveVec: THREE.Vector3
  ) => WalkthroughWallSlideAxes;
  /** Steers `moveVec` (mutated in place) along curved stairs; returns the new target yaw. */
  readonly applyHelicalStairGuidance?: (
    footPos: THREE.Vector3,
    moveVec: THREE.Vector3,
    forwardInput: number,
    targetYawRad: number,
    dtSeconds: number
  ) => number;
  readonly evaluateStairRiserState?: (
    x: number,
    footY: number,
    z: number
  ) => { readonly riserIndex: number } | null;
  /** Analytical guardrail / corridor bounds evaluated before generic obstacle checks. */
  readonly evaluateWalkwayBounds?: (
    fromFoot: THREE.Vector3,
    nextX: number,
    nextZ: number
  ) => 'blocked' | 'clear' | 'check_obstacles';
  readonly shouldSkipDepenetration?: (footPos: THREE.Vector3) => boolean;
  readonly shouldSkipCollisionSubtree?: (node: THREE.Object3D) => boolean;
  /** Returns an inset (m) to collide with `node` as one composite OBB, or `null` to recurse. */
  readonly getCompositeObbInset?: (node: THREE.Object3D) => number | null;
  readonly classifyCollisionMesh?: (mesh: THREE.Mesh) => WalkthroughCollisionMeshRule | null;
  /** `lowerName` is the lower-cased door group + first child name. */
  readonly isNonWalkthroughDoor?: (lowerName: string) => boolean;
  /** World XZ bounds outside which loose (non-shell, non-dynamic) props are not collided with. */
  readonly collisionFootprint?: {
    readonly minX: number;
    readonly maxX: number;
    readonly minZ: number;
    readonly maxZ: number;
  };
  /** Where to stand after leaving a first-person interactable pose. */
  readonly resolveFirstPersonDismount?: (
    footPos: THREE.Vector3,
    prevYaw: number
  ) => { readonly footX: number; readonly footZ: number; readonly targetYaw: number } | null;
  readonly classifyFloorSurface?: (
    roomId: string | null,
    x: number,
    y: number,
    z: number,
    onLadder: boolean
  ) => FloorSurfaceType;
  readonly createClimbableController?: () => WalkthroughClimbableController;
  readonly createCutscenes?: (host: WalkthroughCutsceneHost) => readonly WalkthroughCutsceneController[];
}

export const STANDING_EYE_HEIGHT = 1.67;
export const CROUCH_EYE_HEIGHT = 1.00;
export const WALK_SPEED_MPS = 3.35;
export const SPRINT_SPEED_MPS = 5.85;
export const CROUCH_SPEED_MPS = 1.85;
export const JUMP_IMPULSE_MPS = 4.1;
export const GRAVITY_MPS2 = 16.0;
export const KEY_TURN_SPEED_RAD = 1.85;
export const MOUSE_SENSITIVITY = 0.0022;
export const DRAG_SENSITIVITY = 0.0042;
export const MAX_PITCH_RAD = THREE.MathUtils.degToRad(84);
export const WALKTHROUGH_FOV_PRESETS = [58, 62, 72] as const;
export const DEFAULT_WALKTHROUGH_FOV = 62;
export const SPRINT_FOV_BOOST = 4;
export const INTERACT_MAX_DISTANCE = 2.85;

export const WALKTHROUGH_MOVEMENT_KEYS = new Set<string>([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyQ',
  'KeyE',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ShiftLeft',
  'ShiftRight',
]);

export interface SavedOrbitState {
  readonly pose: SceneCameraPoseSnapshot;
  readonly fov: number;
}

export interface PersistedWalkthroughSession {
  readonly active: boolean;
  readonly footPos: readonly [number, number, number];
  readonly yawRad: number;
  readonly pitchRad: number;
  readonly crouched: boolean;
  readonly baseFov: number;
}

export const WALKTHROUGH_SESSION_KEY = 'husjs_walkthrough_state_v1';

export function findNearestWalkthroughSpawn(
  footX: number,
  footY: number,
  footZ: number,
  spawns: readonly WalkthroughSpawnPoint[] = []
): WalkthroughSpawnPoint | null {
  let bestSpawn: WalkthroughSpawnPoint | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const sp of spawns) {
    const dx = sp.position[0] - footX;
    const dy = (sp.position[1] - footY) * 2.5;
    const dz = sp.position[2] - footZ;
    const score = dx * dx + dy * dy + dz * dz;
    if (score < bestScore) {
      bestScore = score;
      bestSpawn = sp;
    }
  }
  return bestSpawn;
}

/** Axis-aligned world X / Z wall-slide axes used when a house supplies no rotated-wing axes. */
export function computeDefaultWallSlideAxes(
  _footX: number,
  _footZ: number,
  moveVec: THREE.Vector3
): WalkthroughWallSlideAxes {
  const projU = moveVec.x;
  const projV = moveVec.z;
  return {
    projU,
    projV,
    slideU: new THREE.Vector3(Math.sign(projU), 0, 0),
    slideV: new THREE.Vector3(0, 0, Math.sign(projV)),
  };
}

export function syncWalkthroughCameraPose(
  rig: CameraRig,
  footPos: THREE.Vector3,
  currentEyeHeight: number,
  jumpOffsetY: number,
  bobOffsetY: number,
  yawRad: number,
  pitchRad: number,
  rollRad = 0,
  eyeOverride?: readonly [number, number, number]
): void {
  const cam = rig.perspCamera;
  if (eyeOverride) {
    cam.position.set(eyeOverride[0], eyeOverride[1], eyeOverride[2]);
  } else {
    const eyeY = footPos.y + currentEyeHeight + jumpOffsetY + bobOffsetY;
    cam.position.set(footPos.x, eyeY, footPos.z);
  }

  const cosPitch = Math.cos(pitchRad);
  const sinPitch = Math.sin(pitchRad);
  const lookDirX = -Math.sin(yawRad) * cosPitch;
  const lookDirY = sinPitch;
  const lookDirZ = -Math.cos(yawRad) * cosPitch;

  const lookDistance = 2.2;
  rig.controls.target.set(
    cam.position.x + lookDirX * lookDistance,
    cam.position.y + lookDirY * lookDistance,
    cam.position.z + lookDirZ * lookDistance
  );
  cam.up.set(0, 1, 0);
  cam.lookAt(rig.controls.target);
  if (Math.abs(rollRad) > 1e-5) {
    cam.rotateZ(rollRad);
  }
  cam.updateMatrixWorld();
}

export function saveWalkthroughSessionToStorage(
  payload: PersistedWalkthroughSession,
  storageKey: string = WALKTHROUGH_SESSION_KEY
): void {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(payload));
  } catch {
    // Ignore storage quota or private mode errors
  }
}

export function loadWalkthroughSessionFromStorage(storageKey: string = WALKTHROUGH_SESSION_KEY): {
  readonly footPos: readonly [number, number, number];
  readonly yawDeg: number;
  readonly pitchRad?: number;
  readonly crouched?: boolean;
  readonly baseFov?: number;
} | null {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedWalkthroughSession>;
    if (!parsed || parsed.active !== true || !Array.isArray(parsed.footPos)) {
      return null;
    }
    const [fx, fy, fz] = parsed.footPos;
    if (
      typeof fx !== 'number' ||
      typeof fy !== 'number' ||
      typeof fz !== 'number' ||
      !Number.isFinite(fx) ||
      !Number.isFinite(fy) ||
      !Number.isFinite(fz)
    ) {
      return null;
    }
    return {
      footPos: [fx, fy, fz],
      yawDeg:
        typeof parsed.yawRad === 'number' && Number.isFinite(parsed.yawRad)
          ? THREE.MathUtils.radToDeg(parsed.yawRad)
          : 0,
      pitchRad:
        typeof parsed.pitchRad === 'number' && Number.isFinite(parsed.pitchRad)
          ? THREE.MathUtils.clamp(parsed.pitchRad, -MAX_PITCH_RAD, MAX_PITCH_RAD)
          : undefined,
      crouched: typeof parsed.crouched === 'boolean' ? parsed.crouched : undefined,
      baseFov:
        typeof parsed.baseFov === 'number' &&
        Number.isFinite(parsed.baseFov) &&
        (WALKTHROUGH_FOV_PRESETS as readonly number[]).includes(parsed.baseFov)
          ? parsed.baseFov
          : DEFAULT_WALKTHROUGH_FOV,
    };
  } catch {
    return null;
  }
}
