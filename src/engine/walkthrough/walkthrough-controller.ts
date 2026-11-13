import * as THREE from 'three';
import type { SceneCameraPoseSnapshot } from '../../core/types/scene.ts';
import type { RoomZoneId } from '../../core/types/topology.ts';
import type { FirstPersonPoseSample } from '../interaction/handlers/animated-interactable.ts';
import { intersectVisibleObjects } from '../util/object-utils.ts';
import type { CameraRig } from '../camera/camera-rig.ts';
import {
  WalkthroughDoorBargeAndCollisionSolver,
  type WalkthroughDoorBargeHandler,
  type WalkthroughProximityDoorBargeHandler,
} from './parts/walkthrough-door-barge.ts';
import {
  classifyFloorSurface,
  type FloorSurfaceType,
  playWalkthroughFootstep,
  warmUpWalkthroughFootstepAudio,
  playWalkthroughJump,
  playWalkthroughLand,
} from './parts/walkthrough-footstep-audio.ts';
import {
  getGenericWalkthroughTargetEyeHeight,
  resolveGenericWalkthroughEntryPose,
  sampleGenericWalkableElevation,
} from './parts/walkthrough-elevation-solver.ts';
import {
  NoopWalkthroughClimbableController,
  type WalkthroughClimbableController,
  type WalkthroughClimbableStepResult,
  type WalkthroughStairWalkKinematics,
} from './parts/walkthrough-ladder-climb.ts';
import {
  CROUCH_EYE_HEIGHT,
  CROUCH_SPEED_MPS,
  DEFAULT_WALKTHROUGH_FOV,
  DRAG_SENSITIVITY,
  GRAVITY_MPS2,
  type HouseWalkthroughHooks,
  INTERACT_MAX_DISTANCE,
  JUMP_IMPULSE_MPS,
  KEY_TURN_SPEED_RAD,
  loadWalkthroughSessionFromStorage,
  MAX_PITCH_RAD,
  MOUSE_SENSITIVITY,
  type SavedOrbitState,
  SPRINT_FOV_BOOST,
  SPRINT_SPEED_MPS,
  STANDING_EYE_HEIGHT,
  saveWalkthroughSessionToStorage,
  syncWalkthroughCameraPose,
  WALK_SPEED_MPS,
  WALKTHROUGH_FOV_PRESETS,
  WALKTHROUGH_MOVEMENT_KEYS,
  type WalkthroughCutsceneController,
  type WalkthroughCutsceneCurrentPose,
  type WalkthroughCutscenePose,
  type WalkthroughSpawnPoint,
} from './parts/walkthrough-spawns.ts';

export {
  WALKTHROUGH_FOV_PRESETS,
  type HouseWalkthroughHooks,
  type WalkthroughClimbableController,
  type WalkthroughClimbableStepResult,
  type WalkthroughCutsceneController,
  type WalkthroughCutscenePose,
  type WalkthroughSpawnPoint,
};

const NO_HOUSE_HOOKS: HouseWalkthroughHooks = {};
const NO_STAIR_WALK_KINEMATICS: WalkthroughStairWalkKinematics = {
  onStairs: false,
  bobOffsetY: 0,
  rollRad: 0,
  pitchNodRad: 0,
  fovBoost: 0,
};

function shortestAngleDelta(fromRad: number, toRad: number): number {
  return Math.atan2(Math.sin(toRad - fromRad), Math.cos(toRad - fromRad));
}

function lerpAngle(fromRad: number, toRad: number, t: number): number {
  return fromRad + shortestAngleDelta(fromRad, toRad) * t;
}

/**
 * Call-of-Duty-style First-Person Walkthrough Controller (no weapon). House-specific spawns,
 * elevation, stairs, ladders, cutscenes and collision rules arrive via `HouseWalkthroughHooks`.
 */
export class WalkthroughController {
  private readonly canvas: HTMLCanvasElement;
  private readonly rig: CameraRig;
  private readonly getRoomMinYAt: (x: number, y: number, z: number) => number | null;
  private readonly getCurrentRoomId?: () => RoomZoneId | null;
  private readonly getRoomFloorSurface?: (roomId: RoomZoneId) => FloorSurfaceType | undefined;
  private readonly getInteractiveMeshes: () => readonly THREE.Object3D[];
  private readonly describeInteractable: (mesh: THREE.Object3D) => string;
  private readonly onInteractWithMesh: (mesh: THREE.Object3D) => void;
  private readonly getActiveFirstPersonPose?: () => FirstPersonPoseSample | null;
  private readonly cancelActiveFirstPerson?: () => boolean;
  private readonly getProximityAnimatedInteractable?: (
    footX: number,
    footY: number,
    footZ: number
  ) => { readonly id: string; readonly prompt: string; readonly trigger: () => boolean } | null;
  private readonly onStateChanged: (active: boolean) => void;
  private readonly onPoseUpdated: () => void;
  private readonly collisionAndBarge: WalkthroughDoorBargeAndCollisionSolver;
  private readonly hooks: HouseWalkthroughHooks;
  private readonly climbable: WalkthroughClimbableController;
  private readonly cutscenes: readonly WalkthroughCutsceneController[];

  private active = false;
  private crouched = false;
  private isCurrentlySprinting = false;
  private pointerLocked = false;
  private isDraggingLook = false;
  private dragLookPointerId: number | null = null;
  private lookDirty = false;
  private lastDragClientX = 0;
  private lastDragClientY = 0;
  private dragLookStartX = 0;
  private dragLookStartY = 0;
  private dragLookStartTimeMs = 0;
  private touchForwardInput = 0;
  private touchStrafeInput = 0;
  private touchSprint = false;
  private touchLookYaw = 0;
  private touchLookPitch = 0;

  private baseFov: number = DEFAULT_WALKTHROUGH_FOV;
  private currentFov: number = DEFAULT_WALKTHROUGH_FOV;

  private footPos = new THREE.Vector3();
  private verticalVelocity = 0;
  private jumpOffsetY = 0;
  private currentEyeHeight = STANDING_EYE_HEIGHT;
  private yawRad = 0;
  private pitchRad = 0;
  private targetYawRad = 0;
  private targetPitchRad = 0;
  private groundVelX = 0;
  private groundVelZ = 0;
  private bobPhase = 0;
  private ladderSoundAccumSec = 0;
  private smoothedFps = 120;

  private glideTargetFoot: THREE.Vector3 | null = null;
  private savedOrbitState: SavedOrbitState | null = null;

  private targetedMesh: THREE.Object3D | null = null;
  private targetedPrompt: string | null = null;
  private lastCameraEyePos = new THREE.Vector3();
  private lastCameraRollRad = 0;
  private fpEntryBlend: {
    readonly poseId: string;
    readonly startEye: readonly [number, number, number];
    readonly startFoot: readonly [number, number, number];
    readonly startYaw: number;
    readonly startPitch: number;
    readonly startRoll: number;
    elapsedSec: number;
    requireMoveKeyRelease: boolean;
  } | null = null;
  private lastActiveFpPose: {
    readonly eye: readonly [number, number, number];
    readonly foot: readonly [number, number, number];
    readonly yaw: number;
    readonly pitch: number;
    readonly roll: number;
  } | null = null;
  private fpExitBlend: {
    readonly startEye: readonly [number, number, number];
    readonly startFoot: readonly [number, number, number];
    readonly startYaw: number;
    readonly startPitch: number;
    readonly startRoll: number;
    readonly targetFoot: readonly [number, number, number];
    readonly targetEyeH: number;
    readonly targetYaw: number;
    readonly targetPitch: number;
    elapsedSec: number;
  } | null = null;
  private lastRaycastMs = 0;
  private lastSessionSaveMs = 0;

  private readonly keysDown = new Set<string>();
  private readonly interactRaycaster = new THREE.Raycaster();
  private readonly nearbyInteractiveMeshes: THREE.Object3D[] = [];
  private readonly interactWorldSphere = new THREE.Sphere();
  private readonly centerNdc = new THREE.Vector2(0, 0);
  private readonly moveVec = new THREE.Vector3();
  private readonly listeners = new Set<(active: boolean) => void>();

  public constructor(options: {
    readonly canvas: HTMLCanvasElement;
    readonly scene: THREE.Scene;
    readonly rig: CameraRig;
    readonly getRoomMinYAt: (x: number, y: number, z: number) => number | null;
    readonly getCurrentRoomId?: () => RoomZoneId | null;
    readonly getRoomFloorSurface?: (roomId: RoomZoneId) => FloorSurfaceType | undefined;
    readonly getInteractiveMeshes: () => readonly THREE.Object3D[];
    readonly describeInteractable: (mesh: THREE.Object3D) => string;
    readonly onInteractWithMesh: (mesh: THREE.Object3D) => void;
    readonly onTriggerGolfSimulatorShot?: () => boolean;
    readonly getGolfSimulatorShotElapsedSec?: () => number | null;
    readonly getGolfSimulatorPrompt?: () => string | null;
    readonly getActiveFirstPersonPose?: () => FirstPersonPoseSample | null;
    readonly cancelActiveFirstPerson?: () => boolean;
    readonly getProximityAnimatedInteractable?: (
      footX: number,
      footY: number,
      footZ: number
    ) => { readonly id: string; readonly prompt: string; readonly trigger: () => boolean } | null;
    readonly onBargeWalkthroughDoor?: WalkthroughDoorBargeHandler;
    readonly onProximityBargeDoors?: WalkthroughProximityDoorBargeHandler;
    readonly onStateChanged: (active: boolean) => void;
    readonly onPoseUpdated: () => void;
    /** Per-house walkthrough rules; omitted for a flat house with no stairs, ladders or cutscenes. */
    readonly hooks?: HouseWalkthroughHooks;
  }) {
    const hooks = options.hooks ?? NO_HOUSE_HOOKS;
    this.hooks = hooks;
    this.climbable = hooks.createClimbableController?.() ?? new NoopWalkthroughClimbableController();
    this.cutscenes =
      hooks.createCutscenes?.({
        triggerGolfSimulatorShot: options.onTriggerGolfSimulatorShot,
        getGolfSimulatorShotElapsedSec: options.getGolfSimulatorShotElapsedSec,
        getGolfSimulatorPrompt: options.getGolfSimulatorPrompt,
      }) ?? [];
    const firstSpawn = hooks.spawns?.[0];
    if (firstSpawn) {
      this.footPos.set(firstSpawn.position[0], firstSpawn.position[1], firstSpawn.position[2]);
    }
    this.canvas = options.canvas;
    this.rig = options.rig;
    this.getRoomMinYAt = options.getRoomMinYAt;
    this.getCurrentRoomId = options.getCurrentRoomId;
    this.getRoomFloorSurface = options.getRoomFloorSurface;
    this.getInteractiveMeshes = options.getInteractiveMeshes;
    this.describeInteractable = options.describeInteractable;
    this.onInteractWithMesh = options.onInteractWithMesh;
    this.getActiveFirstPersonPose = options.getActiveFirstPersonPose;
    this.cancelActiveFirstPerson = options.cancelActiveFirstPerson;
    this.getProximityAnimatedInteractable = options.getProximityAnimatedInteractable;
    this.onStateChanged = options.onStateChanged;
    this.onPoseUpdated = options.onPoseUpdated;

    this.collisionAndBarge = new WalkthroughDoorBargeAndCollisionSolver({
      scene: options.scene,
      onBargeWalkthroughDoor: options.onBargeWalkthroughDoor ?? (() => false),
      onProximityBargeDoors: options.onProximityBargeDoors ?? (() => false),
      onDoorBarged: () => this.refreshTargetedInteractable(true),
      hooks,
      getRoomMinYAt: options.getRoomMinYAt,
    });

    this.interactRaycaster.near = 0.05;
    this.interactRaycaster.far = INTERACT_MAX_DISTANCE;
    this.bindInputEvents();
  }

  public isActive(): boolean { return this.active; }
  public isCrouched(): boolean { return this.crouched; }
  public isPointerLocked(): boolean { return this.pointerLocked; }
  public getBaseFov(): number { return this.baseFov; }
  public getSmoothedFps(): number { return Math.round(this.smoothedFps); }
  public getTargetedPrompt(): string | null { return this.targetedPrompt; }
  public getFootPosition(): THREE.Vector3 { return this.footPos; }
  public getSpawns(): readonly WalkthroughSpawnPoint[] { return this.hooks.spawns ?? []; }
  public invalidateObstacleCache(): void { this.collisionAndBarge.invalidateObstacleCache(); }
  public captureFurnitureColliders(): void {
    this.collisionAndBarge.captureFurnitureColliders();
    this.sampleElevation(this.footPos.x, this.footPos.y, this.footPos.z);
  }
  public warmSpatialIndices(): void { this.collisionAndBarge.getObstacleCache(); }
  public getSpatialGridStats() { return this.collisionAndBarge.getSpatialGridStats(); }
  public pressKey(code: string): void { this.keysDown.add(code); }
  public refreshPrompt(): void { this.refreshTargetedInteractable(true); }

  private sampleElevation(x: number, refFootY: number, z: number): number {
    const hooks = this.hooks;
    return hooks.sampleWalkableElevation
      ? hooks.sampleWalkableElevation(x, refFootY, z, this.getRoomMinYAt)
      : sampleGenericWalkableElevation(x, refFootY, z, this.getRoomMinYAt, hooks.sampleTerrainY);
  }

  private getTargetEyeHeight(x: number, footY: number, z: number, crouched: boolean): number {
    return (this.hooks.getTargetEyeHeight ?? getGenericWalkthroughTargetEyeHeight)(
      x,
      footY,
      z,
      crouched
    );
  }

  private classifySurface(
    roomId: string | null,
    x: number,
    y: number,
    z: number,
    onLadder: boolean
  ): FloorSurfaceType {
    if (this.hooks.classifyFloorSurface) {
      return this.hooks.classifyFloorSurface(roomId, x, y, z, onLadder);
    }
    const roomFloorSurface = roomId ? this.getRoomFloorSurface?.(roomId) : undefined;
    return classifyFloorSurface(roomId, x, y, z, onLadder, roomFloorSurface);
  }

  private getCutsceneCurrentPose(): WalkthroughCutsceneCurrentPose {
    return {
      footPos: this.footPos,
      yawRad: this.yawRad,
      pitchRad: this.pitchRad,
      eyeHeight: this.currentEyeHeight,
    };
  }

  private haltFreeMovementForCutscene(): void {
    this.glideTargetFoot = null;
    this.verticalVelocity = 0;
    this.jumpOffsetY = 0;
  }

  /** Starts the house cutscene `id` from the current pose; false when no such cutscene exists. */
  public beginCutscene(id: string): boolean {
    const cutscene = this.cutscenes.find((c) => c.id === id);
    if (!cutscene) return false;
    cutscene.begin?.(this.getCutsceneCurrentPose());
    this.haltFreeMovementForCutscene();
    return true;
  }

  private tryTriggerCutscene(targetedPrompt: string | null): boolean {
    for (const cutscene of this.cutscenes) {
      if (
        cutscene.tryTrigger(
          this.footPos,
          this.yawRad,
          this.pitchRad,
          this.currentEyeHeight,
          targetedPrompt
        )
      ) {
        this.haltFreeMovementForCutscene();
        return true;
      }
    }
    return false;
  }

  private getCutsceneProximityPrompt(rawTargetedPrompt: string | null): string | null {
    for (const cutscene of this.cutscenes) {
      const prompt = cutscene.getProximityPrompt?.(this.footPos, rawTargetedPrompt) ?? null;
      if (prompt !== null && prompt.length > 0) return prompt;
    }
    return null;
  }

  private applyCutscenePose(pose: WalkthroughCutscenePose, dtSeconds: number): void {
    this.lookDirty = false;
    this.glideTargetFoot = null;
    this.jumpOffsetY = 0;
    this.verticalVelocity = 0;

    this.footPos.set(pose.footPos[0], pose.footPos[1], pose.footPos[2]);
    this.yawRad = pose.yawRad;
    this.pitchRad = pose.pitchRad;
    this.targetYawRad = pose.yawRad;
    this.targetPitchRad = pose.pitchRad;
    this.currentEyeHeight = pose.eyeHeight;

    const desiredFov = this.baseFov + (pose.fovBoost ?? 0);
    if (Math.abs(this.currentFov - desiredFov) > 0.02) {
      this.currentFov = THREE.MathUtils.lerp(
        this.currentFov,
        desiredFov,
        1 - Math.exp(-14 * dtSeconds)
      );
      this.rig.perspCamera.fov = this.currentFov;
      this.rig.perspCamera.updateProjectionMatrix();
    }

    this.syncCameraFromFootAndAngles(pose.bobOffsetY ?? 0, pose.rollRad ?? 0, 0);
    this.refreshTargetedInteractable();
    this.onPoseUpdated();
    this.saveSessionState(false);
  }

  public setBaseFov(fov: number): void {
    this.baseFov = THREE.MathUtils.clamp(fov, 50, 90);
    this.currentFov = this.baseFov;
    if (this.active) {
      this.rig.perspCamera.fov = this.currentFov;
      this.rig.perspCamera.updateProjectionMatrix();
      this.onPoseUpdated();
    }
    this.saveSessionState(true);
    this.emit();
  }

  public cycleBaseFov(): number {
    const idx = WALKTHROUGH_FOV_PRESETS.indexOf(
      this.baseFov as (typeof WALKTHROUGH_FOV_PRESETS)[number]
    );
    const nextFov = WALKTHROUGH_FOV_PRESETS[(idx + 1) % WALKTHROUGH_FOV_PRESETS.length];
    this.setBaseFov(nextFov);
    return nextFov;
  }

  public subscribe(cb: (active: boolean) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    for (const cb of this.listeners) cb(this.active);
  }

  public setCrouched(crouched: boolean): void {
    this.crouched = crouched;
    this.saveSessionState(true);
    this.emit();
  }

  public setTouchMoveVector(strafe: number, forward: number, sprint = false): void {
    this.touchStrafeInput = THREE.MathUtils.clamp(strafe, -1, 1);
    this.touchForwardInput = THREE.MathUtils.clamp(forward, -1, 1);
    this.touchSprint = sprint;
  }

  public setTouchLookVector(yawInput: number, pitchInput: number): void {
    this.touchLookYaw = THREE.MathUtils.clamp(yawInput, -1, 1);
    this.touchLookPitch = THREE.MathUtils.clamp(pitchInput, -1, 1);
  }

  public toggleCrouched(): boolean {
    this.crouched = !this.crouched;
    this.saveSessionState(true);
    this.emit();
    return this.crouched;
  }

  public jump(): void {
    if (!this.active) return;
    if ((this.getActiveFirstPersonPose?.() ?? null) !== null) {
      this.cancelActiveFirstPerson?.();
      this.refreshTargetedInteractable(true);
      return;
    }
    const ladderJump = this.climbable.tryHandleSpaceJump(
      this.footPos,
      this.yawRad,
      this.pitchRad,
      this.currentEyeHeight
    );
    if (ladderJump.handled) {
      this.verticalVelocity = ladderJump.kickBackVelocityY;
      playWalkthroughJump(this.footPos);
      return;
    }
    if (this.crouched) {
      this.setCrouched(false);
    } else if (this.jumpOffsetY <= 0.01) {
      this.verticalVelocity = JUMP_IMPULSE_MPS;
      playWalkthroughJump(this.footPos);
    }
  }

  public requestMouseLock(): void {
    if (!this.active) return;
    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock?.();
    } else {
      try {
        this.canvas.requestPointerLock?.();
      } catch {
        // Ignore if browser blocks pointer lock outside direct gesture
      }
    }
  }

  public interactWithClimbableLadder(): boolean {
    if (!this.active) return false;
    const triggered = this.climbable.tryTriggerInteraction(
      this.footPos,
      this.yawRad,
      this.pitchRad,
      this.currentEyeHeight,
      this.targetedMesh
    );
    if (triggered) {
      this.glideTargetFoot = null;
      this.verticalVelocity = 0;
      this.jumpOffsetY = 0;
      this.refreshTargetedInteractable(true);
    }
    return triggered;
  }

  private hasMovementInput(): boolean {
    return (
      this.keysDown.has('KeyW') ||
      this.keysDown.has('KeyA') ||
      this.keysDown.has('KeyS') ||
      this.keysDown.has('KeyD') ||
      this.keysDown.has('ArrowUp') ||
      this.keysDown.has('ArrowDown') ||
      this.keysDown.has('ArrowLeft') ||
      this.keysDown.has('ArrowRight') ||
      Math.hypot(this.touchForwardInput, this.touchStrafeInput) > 0.25
    );
  }

  public triggerTargetedInteraction(): boolean {
    if (!this.active) return false;
    const activeFpPose = this.getActiveFirstPersonPose?.() ?? null;
    if (activeFpPose !== null) {
      if (activeFpPose.allowFreeLook) {
        this.refreshTargetedInteractable(true);
        if (this.targetedMesh) {
          this.onInteractWithMesh(this.targetedMesh);
          this.refreshTargetedInteractable(true);
          return true;
        }
      }
      const cancelled = this.cancelActiveFirstPerson?.() ?? false;
      this.refreshTargetedInteractable(true);
      return cancelled;
    }
    this.refreshTargetedInteractable(true);
    if (this.interactWithClimbableLadder()) {
      return true;
    }
    if (this.targetedMesh) {
      const prompt = this.describeInteractable(this.targetedMesh);
      if (this.tryTriggerCutscene(prompt)) {
        this.refreshTargetedInteractable(true);
        return true;
      }
      this.onInteractWithMesh(this.targetedMesh);
      this.refreshTargetedInteractable(true);
      return true;
    }
    const proxAnim =
      this.getProximityAnimatedInteractable?.(this.footPos.x, this.footPos.y, this.footPos.z) ??
      null;
    if (proxAnim && proxAnim.trigger()) {
      this.refreshTargetedInteractable(true);
      return true;
    }
    if (this.tryTriggerCutscene(null)) {
      this.refreshTargetedInteractable(true);
      return true;
    }
    return false;
  }

  private blurActiveControlIfNeeded(): void {
    const activeEl = document.activeElement;
    if (activeEl instanceof HTMLElement && activeEl !== document.body && activeEl !== this.canvas) {
      activeEl.blur();
    }
  }

  private saveSessionState(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastSessionSaveMs < 1500) return;
    this.lastSessionSaveMs = now;
    saveWalkthroughSessionToStorage(
      {
        active: this.active,
        footPos: [
          Number(this.footPos.x.toFixed(3)),
          Number(this.footPos.y.toFixed(3)),
          Number(this.footPos.z.toFixed(3)),
        ],
        yawRad: Number(this.yawRad.toFixed(4)),
        pitchRad: Number(this.pitchRad.toFixed(4)),
        crouched: this.crouched,
        baseFov: this.baseFov,
      },
      this.hooks.sessionStorageKey
    );
  }

  public restoreFromSessionIfActive(currentPose: SceneCameraPoseSnapshot): boolean {
    const session = loadWalkthroughSessionFromStorage(this.hooks.sessionStorageKey);
    if (!session) return false;
    if (session.baseFov !== undefined) this.baseFov = session.baseFov;
    this.enter(
      currentPose,
      { position: session.footPos, yawDeg: session.yawDeg },
      { warmUpAudio: false }
    );
    if (session.pitchRad !== undefined) {
      this.pitchRad = session.pitchRad;
      this.targetPitchRad = session.pitchRad;
    }
    if (session.crouched !== undefined) {
      this.crouched = session.crouched;
      this.currentEyeHeight = this.crouched ? CROUCH_EYE_HEIGHT : STANDING_EYE_HEIGHT;
    }
    this.collisionAndBarge.ensureFootPositionUnblocked(this.footPos, this.currentEyeHeight);
    this.syncCameraFromFootAndAngles(0);
    this.onPoseUpdated();
    this.emit();
    return true;
  }

  public enter(
    currentPose: SceneCameraPoseSnapshot,
    spawnOverride?: { readonly position: readonly [number, number, number]; readonly yawDeg?: number },
    options?: { readonly warmUpAudio?: boolean }
  ): void {
    if (!this.active) {
      this.savedOrbitState = { pose: currentPose, fov: this.rig.perspCamera.fov };
    }
    this.blurActiveControlIfNeeded();

    this.active = true;
    this.crouched = false;
    this.verticalVelocity = 0;
    this.jumpOffsetY = 0;
    this.currentEyeHeight = STANDING_EYE_HEIGHT;
    this.currentFov = this.baseFov;
    this.glideTargetFoot = null;
    this.lookDirty = false;
    this.keysDown.clear();
    this.climbable.reset();

    this.collisionAndBarge.getObstacleCache();
    if (options?.warmUpAudio !== false) {
      warmUpWalkthroughFootstepAudio();
    }
    this.rig.useCamera(false);
    this.rig.controls.enabled = false;
    this.rig.perspCamera.fov = this.baseFov;
    this.rig.perspCamera.near = 0.06;
    this.rig.perspCamera.updateProjectionMatrix();

    const resolved = this.hooks.resolveEntryPose
      ? this.hooks.resolveEntryPose(currentPose, this.getRoomMinYAt, spawnOverride)
      : resolveGenericWalkthroughEntryPose(
          currentPose,
          this.getRoomMinYAt,
          spawnOverride,
          this.getSpawns(),
          (x, refFootY, z) => this.sampleElevation(x, refFootY, z)
        );
    this.footPos.set(resolved.footX, resolved.footY, resolved.footZ);
    this.yawRad = resolved.yawRad;
    this.pitchRad = resolved.pitchRad;

    if (resolved.checkMode === 'depenetrate') {
      this.collisionAndBarge.depenetrateFootPosition(this.footPos, this.currentEyeHeight);
    } else if (resolved.checkMode === 'ensure_unblocked') {
      this.collisionAndBarge.ensureFootPositionUnblocked(this.footPos, this.currentEyeHeight);
    }

    this.targetYawRad = this.yawRad;
    this.targetPitchRad = this.pitchRad;
    this.syncCameraFromFootAndAngles(0);
    this.refreshTargetedInteractable(true);
    this.onStateChanged(true);
    this.onPoseUpdated();
    this.saveSessionState(true);
    this.emit();
  }

  public exit(): SceneCameraPoseSnapshot | null {
    if (!this.active) return null;
    this.cancelActiveFirstPerson?.();
    this.fpEntryBlend = null;
    this.lastActiveFpPose = null;
    this.fpExitBlend = null;
    this.active = false;
    this.keysDown.clear();
    this.glideTargetFoot = null;
    this.climbable.reset();
    this.isDraggingLook = false;
    this.dragLookPointerId = null;
    this.touchForwardInput = 0;
    this.touchStrafeInput = 0;
    this.touchSprint = false;
    this.touchLookYaw = 0;
    this.touchLookPitch = 0;
    this.lookDirty = false;
    this.targetedMesh = null;
    this.targetedPrompt = null;
    this.verticalVelocity = 0;
    this.jumpOffsetY = 0;

    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock?.();
    }

    const saved = this.savedOrbitState;
    this.rig.perspCamera.fov = saved?.fov ?? 42;
    this.rig.perspCamera.near = 0.15;
    this.rig.perspCamera.updateProjectionMatrix();
    this.rig.controls.enabled = true;

    this.onStateChanged(false);
    this.saveSessionState(true);
    this.emit();
    return saved?.pose ?? null;
  }

  public teleportToSpawn(spawnId: string): boolean {
    const sp = this.getSpawns().find((s) => s.id === spawnId);
    if (!sp) return false;
    this.cancelActiveFirstPerson?.();
    this.fpEntryBlend = null;
    this.lastActiveFpPose = null;
    this.fpExitBlend = null;
    this.blurActiveControlIfNeeded();
    this.glideTargetFoot = null;
    this.climbable.reset();
    this.verticalVelocity = 0;
    this.jumpOffsetY = 0;
    this.footPos.set(sp.position[0], sp.position[1], sp.position[2]);
    this.footPos.y = this.sampleElevation(this.footPos.x, this.footPos.y, this.footPos.z);
    this.collisionAndBarge.depenetrateFootPosition(this.footPos, this.currentEyeHeight);
    this.yawRad = THREE.MathUtils.degToRad(sp.yawDeg);
    this.pitchRad = -0.03;
    this.targetYawRad = this.yawRad;
    this.targetPitchRad = this.pitchRad;
    this.syncCameraFromFootAndAngles(0);
    this.refreshTargetedInteractable(true);
    this.onPoseUpdated();
    this.saveSessionState(true);
    this.emit();
    return true;
  }

  public glideToWorldPoint(point: THREE.Vector3): void {
    if (!this.active) return;
    const targetFloorY = this.sampleElevation(point.x, point.y, point.z);
    this.glideTargetFoot = new THREE.Vector3(point.x, targetFloorY, point.z);
    const dx = point.x - this.footPos.x;
    const dz = point.z - this.footPos.z;
    if (Math.hypot(dx, dz) > 0.25) {
      this.yawRad = Math.atan2(-dx, -dz);
      this.targetYawRad = this.yawRad;
    }
  }

  private refreshTargetedInteractable(force = false): void {
    if (!this.active) return;
    const now = performance.now();
    if (!force && now - this.lastRaycastMs < 90) return;
    this.lastRaycastMs = now;

    const proxAnim =
      this.getProximityAnimatedInteractable?.(this.footPos.x, this.footPos.y, this.footPos.z) ??
      null;
    const activeFpPose = this.getActiveFirstPersonPose?.() ?? null;
    if (activeFpPose !== null && !activeFpPose.allowFreeLook && proxAnim !== null) {
      const activePrompt = proxAnim.prompt;
      if (this.targetedMesh !== null || activePrompt !== this.targetedPrompt) {
        this.targetedMesh = null;
        this.targetedPrompt = activePrompt;
        this.emit();
      }
      return;
    }

    this.interactRaycaster.setFromCamera(this.centerNdc, this.rig.perspCamera);
    const camPos = this.rig.perspCamera.position;
    const allInteractive = this.getInteractiveMeshes();
    const candidates = this.nearbyInteractiveMeshes;
    candidates.length = 0;
    for (let i = 0; i < allInteractive.length; i++) {
      const obj = allInteractive[i]!;
      if (!obj.visible) continue;
      if (obj instanceof THREE.Mesh && obj.geometry.boundingSphere) {
        this.interactWorldSphere.copy(obj.geometry.boundingSphere).applyMatrix4(obj.matrixWorld);
        const maxR = this.interactWorldSphere.radius + INTERACT_MAX_DISTANCE;
        if (this.interactWorldSphere.center.distanceToSquared(camPos) > maxR * maxR) {
          continue;
        }
      }
      candidates.push(obj);
    }
    const hits = intersectVisibleObjects(
      this.interactRaycaster,
      candidates,
      false
    );
    const firstHit = hits.find((h) => {
      if (h.distance > INTERACT_MAX_DISTANCE) return false;
      const orig = (h as THREE.Intersection & { readonly originalMesh?: THREE.Mesh }).originalMesh;
      return !orig || orig.userData?.__isInteractiveTarget !== false;
    });

    const nextMesh =
      (firstHit as (THREE.Intersection & { readonly originalMesh?: THREE.Mesh }) | undefined)
        ?.originalMesh ??
      firstHit?.object ??
      null;
    const ladderPrompt =
      this.climbable.getTargetedPrompt?.(
        this.footPos,
        this.yawRad,
        this.pitchRad,
        this.currentEyeHeight,
        nextMesh
      ) ?? null;
    const rawPrompt = nextMesh ? this.describeInteractable(nextMesh) : null;
    if (activeFpPose !== null) {
      if (activeFpPose.allowFreeLook) {
        const hasHitPrompt = rawPrompt !== null && rawPrompt.length > 0;
        const effectiveMesh = hasHitPrompt ? nextMesh : null;
        const activePrompt = hasHitPrompt
          ? rawPrompt
          : (activeFpPose.activePrompt ?? proxAnim?.prompt ?? null);
        if (effectiveMesh !== this.targetedMesh || activePrompt !== this.targetedPrompt) {
          this.targetedMesh = effectiveMesh;
          this.targetedPrompt = activePrompt;
          this.emit();
        }
        return;
      }
      const activePrompt = proxAnim?.prompt ?? (rawPrompt && rawPrompt.length > 0 ? rawPrompt : null);
      if (nextMesh !== this.targetedMesh || activePrompt !== this.targetedPrompt) {
        this.targetedMesh = nextMesh;
        this.targetedPrompt = activePrompt;
        this.emit();
      }
      return;
    }
    const cutsceneProximityPrompt = this.getCutsceneProximityPrompt(rawPrompt);
    const nextPrompt =
      ladderPrompt ??
      cutsceneProximityPrompt ??
      (rawPrompt && rawPrompt.length > 0 ? rawPrompt : (proxAnim?.prompt ?? null));
    if (nextMesh !== this.targetedMesh || nextPrompt !== this.targetedPrompt) {
      this.targetedMesh = nextMesh;
      this.targetedPrompt = nextPrompt;
      this.emit();
    }
  }

  private syncCameraFromFootAndAngles(
    bobOffsetY: number,
    rollRad = 0,
    pitchNodRad = 0,
    eyeOverride?: readonly [number, number, number]
  ): void {
    syncWalkthroughCameraPose(
      this.rig,
      this.footPos,
      this.currentEyeHeight,
      this.jumpOffsetY,
      bobOffsetY,
      this.yawRad,
      THREE.MathUtils.clamp(this.pitchRad + pitchNodRad, -MAX_PITCH_RAD, MAX_PITCH_RAD),
      rollRad,
      eyeOverride
    );
    this.lastCameraEyePos.copy(this.rig.perspCamera.position);
    this.lastCameraRollRad = rollRad;
  }

  public update(dtSeconds: number): boolean {
    if (dtSeconds > 0.0005 && dtSeconds < 0.25) {
      this.smoothedFps = this.smoothedFps * 0.9 + (1 / dtSeconds) * 0.1;
    }
    if (!this.active) return false;

    let turnInput = 0;
    if (this.keysDown.has('KeyQ')) turnInput += 1;
    if (this.keysDown.has('KeyE')) turnInput -= 1;
    if (turnInput !== 0) {
      this.targetYawRad += turnInput * KEY_TURN_SPEED_RAD * dtSeconds;
    }

    if (Math.abs(this.touchLookYaw) > 1e-4 || Math.abs(this.touchLookPitch) > 1e-4) {
      const curvedYaw =
        Math.sign(this.touchLookYaw) * Math.pow(Math.abs(this.touchLookYaw), 1.35);
      const curvedPitch =
        Math.sign(this.touchLookPitch) * Math.pow(Math.abs(this.touchLookPitch), 1.35);
      const TOUCH_LOOK_YAW_SPEED_RAD = 2.45;
      const TOUCH_LOOK_PITCH_SPEED_RAD = 1.65;
      this.targetYawRad -= curvedYaw * TOUCH_LOOK_YAW_SPEED_RAD * dtSeconds;
      this.targetPitchRad = THREE.MathUtils.clamp(
        this.targetPitchRad + curvedPitch * TOUCH_LOOK_PITCH_SPEED_RAD * dtSeconds,
        -MAX_PITCH_RAD,
        MAX_PITCH_RAD
      );
      this.lookDirty = true;
    }

    if (this.climbable.isActive()) {
      this.lookDirty = false;
      this.glideTargetFoot = null;
      this.jumpOffsetY = 0;
      this.verticalVelocity = 0;
      const ladderStep = this.climbable.step(
        dtSeconds,
        this.footPos,
        this.yawRad,
        this.pitchRad,
        this.targetYawRad,
        this.targetPitchRad,
        this.currentEyeHeight,
        this.crouched,
        this.keysDown,
        this.touchForwardInput,
        this.touchStrafeInput,
        this.touchSprint
      );
      this.yawRad = ladderStep.yawRad;
      this.pitchRad = ladderStep.pitchRad;
      this.targetYawRad = ladderStep.targetYawRad;
      this.targetPitchRad = ladderStep.targetPitchRad;
      this.currentEyeHeight = ladderStep.currentEyeHeight;

      const desiredLadderFov = this.baseFov + ladderStep.fovBoost;
      if (Math.abs(this.currentFov - desiredLadderFov) > 0.02) {
        this.currentFov = THREE.MathUtils.lerp(
          this.currentFov,
          desiredLadderFov,
          1 - Math.exp(-12 * dtSeconds)
        );
        this.rig.perspCamera.fov = this.currentFov;
        this.rig.perspCamera.updateProjectionMatrix();
      }

      this.syncCameraFromFootAndAngles(
        ladderStep.bobOffsetY,
        ladderStep.rollRad,
        ladderStep.pitchNodRad
      );
      if (Math.abs(ladderStep.bobOffsetY) > 0.002) {
        this.ladderSoundAccumSec += dtSeconds;
        if (this.ladderSoundAccumSec >= 0.34) {
          this.ladderSoundAccumSec = 0;
          playWalkthroughFootstep('ladder', this.footPos, false);
        }
      }
      this.refreshTargetedInteractable();
      this.onPoseUpdated();
      this.saveSessionState(false);
      return true;
    }

    for (const cutscene of this.cutscenes) {
      const cutscenePose = cutscene.step(dtSeconds, this.getCutsceneCurrentPose());
      if (cutscenePose !== null) {
        this.applyCutscenePose(cutscenePose, dtSeconds);
        return true;
      }
    }

    let fpSample = this.getActiveFirstPersonPose?.() ?? null;
    if (fpSample !== null) {
      const samplePoseId = fpSample.poseId ?? 'default';
      if (this.fpEntryBlend === null || this.fpEntryBlend.poseId !== samplePoseId) {
        this.fpEntryBlend = {
          poseId: samplePoseId,
          startEye: [
            this.lastCameraEyePos.x,
            this.lastCameraEyePos.y,
            this.lastCameraEyePos.z,
          ],
          startFoot: [this.footPos.x, this.footPos.y, this.footPos.z],
          startYaw: this.yawRad,
          startPitch: this.pitchRad,
          startRoll: this.lastCameraRollRad,
          elapsedSec: 0,
          requireMoveKeyRelease: this.hasMovementInput(),
        };
        if (fpSample.allowFreeLook) {
          this.targetYawRad = fpSample.yawRad;
          this.targetPitchRad = fpSample.pitchRad;
        }
      } else {
        this.fpEntryBlend.elapsedSec += dtSeconds;
        if (this.fpEntryBlend.requireMoveKeyRelease && !this.hasMovementInput()) {
          this.fpEntryBlend.requireMoveKeyRelease = false;
        }
        if (
          fpSample.allowFreeLook &&
          !this.fpEntryBlend.requireMoveKeyRelease &&
          this.fpEntryBlend.elapsedSec >= 0.35 &&
          this.hasMovementInput()
        ) {
          this.cancelActiveFirstPerson?.();
          this.refreshTargetedInteractable(true);
          fpSample = null;
        }
      }
    }

    if (fpSample !== null && this.fpEntryBlend !== null) {
      this.lookDirty = false;
      this.glideTargetFoot = null;
      this.jumpOffsetY = 0;
      this.verticalVelocity = 0;
      this.groundVelX = 0;
      this.groundVelZ = 0;
      this.fpExitBlend = null;

      const FP_ENTRY_BLEND_DURATION_SEC = 0.52;
      const wIn = THREE.MathUtils.smoothstep(this.fpEntryBlend.elapsedSec, 0, FP_ENTRY_BLEND_DURATION_SEC);
      const [rawFx, rawFy, rawFz] = fpSample.footPosition;
      const [rawEx, rawEy, rawEz] = fpSample.eyePosition;
      const fx = THREE.MathUtils.lerp(this.fpEntryBlend.startFoot[0], rawFx, wIn);
      const fy = THREE.MathUtils.lerp(this.fpEntryBlend.startFoot[1], rawFy, wIn);
      const fz = THREE.MathUtils.lerp(this.fpEntryBlend.startFoot[2], rawFz, wIn);
      const ex = THREE.MathUtils.lerp(this.fpEntryBlend.startEye[0], rawEx, wIn);
      const ey = THREE.MathUtils.lerp(this.fpEntryBlend.startEye[1], rawEy, wIn);
      const ez = THREE.MathUtils.lerp(this.fpEntryBlend.startEye[2], rawEz, wIn);

      let blendedYaw: number;
      let blendedPitch: number;
      if (fpSample.allowFreeLook) {
        if (wIn < 1) {
          blendedYaw = lerpAngle(this.fpEntryBlend.startYaw, this.targetYawRad, wIn);
          blendedPitch = THREE.MathUtils.lerp(
            this.fpEntryBlend.startPitch,
            this.targetPitchRad,
            wIn
          );
        } else {
          const lookAlpha = 1 - Math.exp(-48 * dtSeconds);
          const yawDiff = shortestAngleDelta(this.yawRad, this.targetYawRad);
          const pitchDiff = this.targetPitchRad - this.pitchRad;
          blendedYaw =
            Math.abs(yawDiff) <= 1e-4 ? this.targetYawRad : this.yawRad + yawDiff * lookAlpha;
          blendedPitch =
            Math.abs(pitchDiff) <= 1e-4
              ? this.targetPitchRad
              : THREE.MathUtils.lerp(this.pitchRad, this.targetPitchRad, lookAlpha);
        }
      } else {
        blendedYaw = lerpAngle(this.fpEntryBlend.startYaw, fpSample.yawRad, wIn);
        blendedPitch = THREE.MathUtils.lerp(this.fpEntryBlend.startPitch, fpSample.pitchRad, wIn);
        this.targetYawRad = blendedYaw;
        this.targetPitchRad = blendedPitch;
      }
      const blendedRoll = THREE.MathUtils.lerp(
        this.fpEntryBlend.startRoll,
        fpSample.rollRad ?? 0,
        wIn
      );

      this.footPos.set(fx, fy, fz);
      this.yawRad = blendedYaw;
      this.pitchRad = blendedPitch;
      this.currentEyeHeight = Math.max(0.25, ey - fy);

      this.lastActiveFpPose = {
        eye: [ex, ey, ez],
        foot: [fx, fy, fz],
        yaw: blendedYaw,
        pitch: blendedPitch,
        roll: blendedRoll,
      };

      const desiredFpFov = this.baseFov + (fpSample.fovBoostDeg ?? 0) * wIn;
      if (Math.abs(this.currentFov - desiredFpFov) > 0.02) {
        this.currentFov = THREE.MathUtils.lerp(
          this.currentFov,
          desiredFpFov,
          1 - Math.exp(-12 * dtSeconds)
        );
        this.rig.perspCamera.fov = this.currentFov;
        this.rig.perspCamera.updateProjectionMatrix();
      }

      this.syncCameraFromFootAndAngles(0, blendedRoll, 0, [ex, ey, ez]);
      this.refreshTargetedInteractable();
      this.onPoseUpdated();
      this.saveSessionState(false);
      return true;
    }

    if (this.fpEntryBlend !== null && this.lastActiveFpPose !== null) {
      const prev = this.lastActiveFpPose;
      this.fpEntryBlend = null;
      this.lastActiveFpPose = null;

      let exitTargetYaw = prev.yaw;
      // If the pose ended with the feet still on (or inside) the interactable, let the house
      // step the player onto clear floor beside it instead of colliding with its mesh.
      const dismount = this.hooks.resolveFirstPersonDismount?.(this.footPos, prev.yaw) ?? null;
      if (dismount) {
        this.footPos.x = dismount.footX;
        this.footPos.z = dismount.footZ;
        exitTargetYaw = dismount.targetYaw;
      }

      const floorY = this.sampleElevation(this.footPos.x, this.footPos.y, this.footPos.z);
      this.footPos.y = floorY;
      const targetEyeH = this.getTargetEyeHeight(
        this.footPos.x,
        this.footPos.y,
        this.footPos.z,
        this.crouched
      );
      this.collisionAndBarge.depenetrateFootPosition(this.footPos, targetEyeH);
      const targetEyeY = this.footPos.y + targetEyeH;
      const targetPitch = THREE.MathUtils.clamp(prev.pitch, -0.35, 0.15);
      const eyeDelta = Math.hypot(
        prev.eye[0] - this.footPos.x,
        prev.eye[1] - targetEyeY,
        prev.eye[2] - this.footPos.z
      );
      if (
        eyeDelta > 0.01 ||
        Math.abs(prev.pitch - targetPitch) > 0.01 ||
        Math.abs(prev.roll) > 0.004
      ) {
        this.fpExitBlend = {
          startEye: prev.eye,
          startFoot: prev.foot,
          startYaw: prev.yaw,
          startPitch: prev.pitch,
          startRoll: prev.roll,
          targetFoot: [this.footPos.x, this.footPos.y, this.footPos.z],
          targetEyeH,
          targetYaw: exitTargetYaw,
          targetPitch,
          elapsedSec: 0,
        };
      }
    }

    if (this.fpExitBlend !== null) {
      this.fpExitBlend.elapsedSec += dtSeconds;
      const FP_EXIT_BLEND_DURATION_SEC = 0.45;
      const wOut = THREE.MathUtils.smoothstep(this.fpExitBlend.elapsedSec, 0, FP_EXIT_BLEND_DURATION_SEC);
      const fx = THREE.MathUtils.lerp(
        this.fpExitBlend.startFoot[0],
        this.fpExitBlend.targetFoot[0],
        wOut
      );
      const fy = THREE.MathUtils.lerp(
        this.fpExitBlend.startFoot[1],
        this.fpExitBlend.targetFoot[1],
        wOut
      );
      const fz = THREE.MathUtils.lerp(
        this.fpExitBlend.startFoot[2],
        this.fpExitBlend.targetFoot[2],
        wOut
      );
      const targetEyeY = this.fpExitBlend.targetFoot[1] + this.fpExitBlend.targetEyeH;
      const ex = THREE.MathUtils.lerp(this.fpExitBlend.startEye[0], fx, wOut);
      const ey = THREE.MathUtils.lerp(this.fpExitBlend.startEye[1], targetEyeY, wOut);
      const ez = THREE.MathUtils.lerp(this.fpExitBlend.startEye[2], fz, wOut);

      this.footPos.set(fx, fy, fz);
      this.currentEyeHeight = Math.max(0.25, ey - fy);
      this.yawRad = lerpAngle(this.fpExitBlend.startYaw, this.fpExitBlend.targetYaw, wOut);
      this.pitchRad = THREE.MathUtils.lerp(
        this.fpExitBlend.startPitch,
        this.fpExitBlend.targetPitch,
        wOut
      );
      this.targetYawRad = this.yawRad;
      this.targetPitchRad = this.pitchRad;
      const roll = THREE.MathUtils.lerp(this.fpExitBlend.startRoll, 0, wOut);

      if (Math.abs(this.currentFov - this.baseFov) > 0.02) {
        this.currentFov = THREE.MathUtils.lerp(
          this.currentFov,
          this.baseFov,
          1 - Math.exp(-12 * dtSeconds)
        );
        this.rig.perspCamera.fov = this.currentFov;
        this.rig.perspCamera.updateProjectionMatrix();
      }

      this.syncCameraFromFootAndAngles(0, roll, 0, [ex, ey, ez]);
      this.refreshTargetedInteractable();
      this.onPoseUpdated();
      this.saveSessionState(false);

      if (this.fpExitBlend.elapsedSec >= FP_EXIT_BLEND_DURATION_SEC) {
        this.fpExitBlend = null;
      }
      return true;
    }

    let movedOrRotated = false;
    if (this.lookDirty) {
      this.lookDirty = false;
      movedOrRotated = true;
    }
    if (turnInput !== 0) {
      movedOrRotated = true;
    }

    const yawDiff = this.targetYawRad - this.yawRad;
    const pitchDiff = this.targetPitchRad - this.pitchRad;
    if (Math.abs(yawDiff) > 1e-5 || Math.abs(pitchDiff) > 1e-5) {
      const lookAlpha = 1 - Math.exp(-48 * dtSeconds);
      this.yawRad = Math.abs(yawDiff) <= 1e-4 ? this.targetYawRad : THREE.MathUtils.lerp(this.yawRad, this.targetYawRad, lookAlpha);
      this.pitchRad = Math.abs(pitchDiff) <= 1e-4 ? this.targetPitchRad : THREE.MathUtils.lerp(this.pitchRad, this.targetPitchRad, lookAlpha);
      movedOrRotated = true;
    }

    const targetEyeH = this.getTargetEyeHeight(
      this.footPos.x,
      this.footPos.y,
      this.footPos.z,
      this.crouched
    );
    if (Math.abs(this.currentEyeHeight - targetEyeH) > 1e-3) {
      const eyeRate = this.footPos.y >= 1.5 && this.currentEyeHeight > targetEyeH ? 24 : 14;
      this.currentEyeHeight = THREE.MathUtils.lerp(
        this.currentEyeHeight,
        targetEyeH,
        1 - Math.exp(-eyeRate * dtSeconds)
      );
      movedOrRotated = true;
    }

    if (this.jumpOffsetY > 0 || this.verticalVelocity !== 0) {
      const prevJumpOffset = this.jumpOffsetY;
      this.jumpOffsetY += this.verticalVelocity * dtSeconds;
      this.verticalVelocity -= GRAVITY_MPS2 * dtSeconds;
      if (this.footPos.y >= 1.8 && targetEyeH < STANDING_EYE_HEIGHT - 0.1) {
        this.jumpOffsetY = 0;
        this.verticalVelocity = 0;
      } else if (this.jumpOffsetY <= 0) {
        this.jumpOffsetY = 0;
        this.verticalVelocity = 0;
        if (prevJumpOffset > 0.025) {
          const surface = this.classifySurface(
            this.getCurrentRoomId?.() ?? null,
            this.footPos.x,
            this.footPos.y,
            this.footPos.z,
            false
          );
          playWalkthroughLand(surface, this.footPos);
        }
      }
      movedOrRotated = true;
    }

    let forwardInput = this.touchForwardInput;
    let strafeInput = this.touchStrafeInput;
    if (this.keysDown.has('KeyW') || this.keysDown.has('ArrowUp')) forwardInput += 1;
    if (this.keysDown.has('KeyS') || this.keysDown.has('ArrowDown')) forwardInput -= 1;
    if (this.keysDown.has('KeyD') || this.keysDown.has('ArrowRight')) strafeInput += 1;
    if (this.keysDown.has('KeyA') || this.keysDown.has('ArrowLeft')) strafeInput -= 1;
    forwardInput = THREE.MathUtils.clamp(forwardInput, -1, 1);
    strafeInput = THREE.MathUtils.clamp(strafeInput, -1, 1);

    const inputMag = Math.min(1, Math.hypot(forwardInput, strafeInput));
    const isMoving = inputMag > 0.02;
    const isSprinting =
      isMoving &&
      !this.crouched &&
      (this.touchSprint || this.keysDown.has('ShiftLeft') || this.keysDown.has('ShiftRight'));
    this.isCurrentlySprinting = isSprinting;
    const baseSpeed = this.crouched ? CROUCH_SPEED_MPS : isSprinting ? SPRINT_SPEED_MPS : WALK_SPEED_MPS;
    const speed = baseSpeed * inputMag;

    const targetFov = this.baseFov + (isSprinting ? SPRINT_FOV_BOOST : 0);
    if (Math.abs(this.currentFov - targetFov) > 0.05) {
      this.currentFov = THREE.MathUtils.lerp(this.currentFov, targetFov, 1 - Math.exp(-10 * dtSeconds));
      this.rig.perspCamera.fov = this.currentFov;
      this.rig.perspCamera.updateProjectionMatrix();
      movedOrRotated = true;
    }

    const forwardX = -Math.sin(this.yawRad);
    const forwardZ = -Math.cos(this.yawRad);
    const rightX = Math.cos(this.yawRad);
    const rightZ = -Math.sin(this.yawRad);
    const rawMoveX = forwardX * forwardInput + rightX * strafeInput;
    const rawMoveZ = forwardZ * forwardInput + rightZ * strafeInput;
    const rawMoveLen = Math.hypot(rawMoveX, rawMoveZ);
    const desiredVx = rawMoveLen > 1e-4 ? (rawMoveX / rawMoveLen) * speed : 0;
    const desiredVz = rawMoveLen > 1e-4 ? (rawMoveZ / rawMoveLen) * speed : 0;
    const velRate = isMoving ? 22 : 26;
    const velAlpha = 1 - Math.exp(-velRate * dtSeconds);
    this.groundVelX = THREE.MathUtils.lerp(this.groundVelX, desiredVx, velAlpha);
    this.groundVelZ = THREE.MathUtils.lerp(this.groundVelZ, desiredVz, velAlpha);
    const groundSpeed = Math.hypot(this.groundVelX, this.groundVelZ);
    if (!isMoving && groundSpeed < 0.03) {
      this.groundVelX = 0;
      this.groundVelZ = 0;
    }

    const prevBobStride = Math.floor(this.bobPhase / Math.PI);

    if (isMoving || groundSpeed >= 0.03) {
      this.glideTargetFoot = null;
      const moveVec = this.moveVec.set(this.groundVelX, 0, this.groundVelZ);
      if (moveVec.lengthSq() > 1e-5) {
        moveVec.normalize();
        if (
          isMoving &&
          this.climbable.checkAutoMountOnMovement(
            this.footPos,
            moveVec,
            forwardInput,
            this.yawRad,
            this.pitchRad,
            this.currentEyeHeight,
            this.keysDown,
            this.touchForwardInput
          )
        ) {
          this.jumpOffsetY = 0;
          this.verticalVelocity = 0;
          this.groundVelX = 0;
          this.groundVelZ = 0;
          movedOrRotated = true;
        } else {
          const stepDist = groundSpeed * dtSeconds;
          this.targetYawRad = this.collisionAndBarge.stepHorizontalMovement(
            this.footPos,
            moveVec,
            forwardInput,
            this.targetYawRad,
            stepDist,
            this.currentEyeHeight,
            this.isCurrentlySprinting,
            dtSeconds
          );
          const actualMoved = this.collisionAndBarge.getLastMovedDistance();
          const movedRatio = THREE.MathUtils.clamp(
            actualMoved / Math.max(1e-4, stepDist),
            0,
            1
          );
          if (movedRatio < 0.08) {
            // Blocked head-on by a wall or corner: damp velocity and settle head-bob to rest
            this.groundVelX *= 0.25;
            this.groundVelZ *= 0.25;
            if (Math.abs(Math.sin(this.bobPhase)) > 1e-3) {
              const nearestZeroPhase = Math.round(this.bobPhase / Math.PI) * Math.PI;
              this.bobPhase = THREE.MathUtils.lerp(
                this.bobPhase,
                nearestZeroPhase,
                1 - Math.exp(-18 * dtSeconds)
              );
            }
          } else {
            const speedScale = THREE.MathUtils.clamp(groundSpeed / WALK_SPEED_MPS, 0.35, 1.45);
            this.bobPhase +=
              dtSeconds * (isSprinting ? 13.0 : 9.0) * movedRatio * Math.min(1, speedScale);
          }
          movedOrRotated = true;
        }
      }
    } else if (this.glideTargetFoot) {
      const glideStep = this.collisionAndBarge.stepGlideToTarget(
        this.footPos,
        this.glideTargetFoot,
        this.currentEyeHeight,
        dtSeconds
      );
      this.glideTargetFoot = glideStep.nextGlideTarget;
      this.bobPhase += glideStep.bobDelta;
      movedOrRotated = true;
    } else if (Math.abs(Math.sin(this.bobPhase)) > 1e-3) {
      const nearestZeroPhase = Math.round(this.bobPhase / Math.PI) * Math.PI;
      this.bobPhase = THREE.MathUtils.lerp(
        this.bobPhase,
        nearestZeroPhase,
        1 - Math.exp(-16 * dtSeconds)
      );
      if (Math.abs(this.bobPhase - nearestZeroPhase) <= 1e-3) {
        this.bobPhase = 0;
      }
      movedOrRotated = true;
    }

    const currBobStride = Math.floor(this.bobPhase / Math.PI);
    if (
      currBobStride > prevBobStride &&
      this.jumpOffsetY === 0 &&
      (isMoving || Boolean(this.glideTargetFoot))
    ) {
      const surface = this.classifySurface(
        this.getCurrentRoomId?.() ?? null,
        this.footPos.x,
        this.footPos.y,
        this.footPos.z,
        false
      );
      playWalkthroughFootstep(surface, this.footPos, isSprinting);
    }

    const stairKinematics =
      this.climbable.sampleStairWalkKinematics?.(
        dtSeconds,
        this.footPos,
        (isMoving || Boolean(this.glideTargetFoot)) && this.jumpOffsetY === 0,
        isSprinting
      ) ?? NO_STAIR_WALK_KINEMATICS;
    if (
      stairKinematics.onStairs ||
      Math.abs(stairKinematics.rollRad) > 1e-4 ||
      Math.abs(stairKinematics.bobOffsetY) > 1e-4 ||
      Math.abs(stairKinematics.pitchNodRad) > 1e-4
    ) {
      movedOrRotated = true;
    }

    if (stairKinematics.fovBoost > 0.02) {
      const stairTargetFov =
        this.baseFov + (isSprinting ? SPRINT_FOV_BOOST : 0) + stairKinematics.fovBoost;
      this.currentFov = THREE.MathUtils.lerp(
        this.currentFov,
        stairTargetFov,
        1 - Math.exp(-10 * dtSeconds)
      );
      this.rig.perspCamera.fov = this.currentFov;
      this.rig.perspCamera.updateProjectionMatrix();
    }

    if (movedOrRotated) {
      const flatWalkBob =
        this.jumpOffsetY === 0
          ? Math.sin(this.bobPhase) * (isSprinting ? 0.022 : 0.015)
          : 0;
      const bobOffset = stairKinematics.onStairs
        ? stairKinematics.bobOffsetY + flatWalkBob * 0.25
        : flatWalkBob + stairKinematics.bobOffsetY;
      this.syncCameraFromFootAndAngles(
        bobOffset,
        stairKinematics.rollRad,
        stairKinematics.pitchNodRad
      );
      this.refreshTargetedInteractable();
      this.onPoseUpdated();
      this.saveSessionState(false);
    }

    return movedOrRotated;
  }

  private bindInputEvents(): void {
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      this.emit();
    });

    this.canvas.addEventListener('pointerdown', (e: PointerEvent) => {
      if (!this.active || e.button !== 0) return;
      this.blurActiveControlIfNeeded();
      if (this.pointerLocked) {
        this.triggerTargetedInteraction();
        return;
      }
      if (e.pointerType === 'touch') {
        // Multi-touch guard: if a finger is already looking around on the canvas,
        // ignore any secondary finger touching the canvas so walking + looking never conflict.
        if (this.dragLookPointerId !== null) return;
        try {
          this.canvas.setPointerCapture(e.pointerId);
        } catch {
          // Ignore synthetic pointer capture errors
        }
      } else {
        try {
          this.canvas.requestPointerLock?.();
        } catch {
          // Fallback to drag look
        }
      }
      this.isDraggingLook = true;
      this.dragLookPointerId = e.pointerId;
      this.lastDragClientX = e.clientX;
      this.lastDragClientY = e.clientY;
      this.dragLookStartX = e.clientX;
      this.dragLookStartY = e.clientY;
      this.dragLookStartTimeMs = performance.now();
    });

    window.addEventListener(
      'pointermove',
      (e: PointerEvent) => {
        if (!this.active) return;
        if (this.pointerLocked) {
          this.targetYawRad -= e.movementX * MOUSE_SENSITIVITY;
          this.targetPitchRad = THREE.MathUtils.clamp(
            this.targetPitchRad - e.movementY * MOUSE_SENSITIVITY,
            -MAX_PITCH_RAD,
            MAX_PITCH_RAD
          );
          this.lookDirty = true;
          return;
        }
        if (
          this.isDraggingLook &&
          e.pointerId === this.dragLookPointerId &&
          (e.pointerType === 'touch' || (e.buttons & 1) !== 0)
        ) {
          const dx = e.clientX - this.lastDragClientX;
          const dy = e.clientY - this.lastDragClientY;
          this.lastDragClientX = e.clientX;
          this.lastDragClientY = e.clientY;
          if (e.pointerType === 'touch') {
            const speedPx = Math.hypot(dx, dy);
            const accel = 1 + Math.min(0.65, speedPx * 0.018);
            const yawSens = 0.0088 * accel;
            const pitchSens = 0.0072 * accel;
            this.targetYawRad -= dx * yawSens;
            this.targetPitchRad = THREE.MathUtils.clamp(
              this.targetPitchRad - dy * pitchSens,
              -MAX_PITCH_RAD,
              MAX_PITCH_RAD
            );
          } else {
            this.targetYawRad -= dx * DRAG_SENSITIVITY;
            this.targetPitchRad = THREE.MathUtils.clamp(
              this.targetPitchRad - dy * DRAG_SENSITIVITY,
              -MAX_PITCH_RAD,
              MAX_PITCH_RAD
            );
          }
          this.lookDirty = true;
        }
      },
      { passive: true }
    );

    const endDragLook = (e: PointerEvent): void => {
      if (this.dragLookPointerId !== null && e.pointerId === this.dragLookPointerId) {
        const wasTap =
          e.type === 'pointerup' &&
          e.pointerType === 'touch' &&
          Math.hypot(e.clientX - this.dragLookStartX, e.clientY - this.dragLookStartY) < 10 &&
          performance.now() - this.dragLookStartTimeMs < 260;
        this.isDraggingLook = false;
        this.dragLookPointerId = null;
        try {
          if (this.canvas.hasPointerCapture(e.pointerId)) {
            this.canvas.releasePointerCapture(e.pointerId);
          }
        } catch {
          // Ignore pointer capture release errors
        }
        if (wasTap && this.targetedPrompt !== null) {
          this.triggerTargetedInteraction();
        }
      }
    };
    window.addEventListener('pointerup', endDragLook);
    window.addEventListener('pointercancel', endDragLook);

    window.addEventListener('keydown', (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const tag = activeEl?.tagName ?? '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.altKey || !this.active) return;
      if (tag === 'SELECT' || tag === 'BUTTON') (activeEl as HTMLElement).blur();

      if (e.code === 'KeyF' && !e.repeat && !e.ctrlKey) {
        e.preventDefault();
        this.triggerTargetedInteraction();
        return;
      }
      if ((e.code === 'KeyC' || e.code === 'ControlLeft') && !e.repeat) {
        e.preventDefault();
        this.toggleCrouched();
        return;
      }
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        this.jump();
        return;
      }
      if (WALKTHROUGH_MOVEMENT_KEYS.has(e.code)) {
        e.preventDefault();
        this.keysDown.add(e.code);
      }
    });

    window.addEventListener('keyup', (e: KeyboardEvent) => {
      this.keysDown.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.keysDown.clear();
      this.isDraggingLook = false;
      this.dragLookPointerId = null;
      this.touchForwardInput = 0;
      this.touchStrafeInput = 0;
      this.touchSprint = false;
      this.touchLookYaw = 0;
      this.touchLookPitch = 0;
      this.groundVelX = 0;
      this.groundVelZ = 0;
    });
  }
}
