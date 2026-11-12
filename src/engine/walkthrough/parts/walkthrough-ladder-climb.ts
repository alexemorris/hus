import type * as THREE from 'three';

/** Per-frame camera state returned by a house-supplied climbable (ladder / guided stair) controller. */
export interface WalkthroughClimbableStepResult {
  readonly yawRad: number;
  readonly pitchRad: number;
  readonly targetYawRad: number;
  readonly targetPitchRad: number;
  readonly currentEyeHeight: number;
  readonly bobOffsetY: number;
  readonly rollRad: number;
  readonly pitchNodRad: number;
  readonly fovBoost: number;
}

/** Camera offsets applied while the player walks manually on a staircase. */
export interface WalkthroughStairWalkKinematics {
  readonly onStairs: boolean;
  readonly bobOffsetY: number;
  readonly rollRad: number;
  readonly pitchNodRad: number;
  readonly fovBoost: number;
}

/**
 * House-agnostic contract for first-person ladder / guided-climb state machines.
 * Houses supply an implementation through `HouseWalkthroughHooks.createClimbableController`.
 */
export interface WalkthroughClimbableController {
  isActive(): boolean;
  reset(): void;
  getTargetedPrompt?(
    footPos: THREE.Vector3,
    yawRad: number,
    pitchRad: number,
    eyeHeight: number,
    targetedMesh: THREE.Object3D | null
  ): string | null;
  tryTriggerInteraction(
    footPos: THREE.Vector3,
    yawRad: number,
    pitchRad: number,
    eyeHeight: number,
    targetedMesh: THREE.Object3D | null
  ): boolean;
  checkAutoMountOnMovement(
    footPos: THREE.Vector3,
    moveVec: THREE.Vector3,
    forwardInput: number,
    yawRad: number,
    pitchRad: number,
    eyeHeight: number,
    keysDown: ReadonlySet<string>,
    touchForwardInput: number
  ): boolean;
  tryHandleSpaceJump(
    footPos: THREE.Vector3,
    yawRad: number,
    pitchRad: number,
    eyeHeight: number
  ): { readonly handled: boolean; readonly kickBackVelocityY: number };
  step(
    dtSeconds: number,
    footPos: THREE.Vector3,
    yawRad: number,
    pitchRad: number,
    targetYawRad: number,
    targetPitchRad: number,
    currentEyeHeight: number,
    crouched: boolean,
    keysDown: ReadonlySet<string>,
    touchForwardInput: number,
    touchStrafeInput: number,
    touchSprint: boolean
  ): WalkthroughClimbableStepResult;
  /** Optional riser-synchronised camera animation while walking manually on stairs. */
  sampleStairWalkKinematics?(
    dtSeconds: number,
    footPos: THREE.Vector3,
    isMoving: boolean,
    isSprinting: boolean
  ): WalkthroughStairWalkKinematics;
}

/** True when `obj` or any ancestor is tagged as climbable via `userData`. */
export function isClimbableObject(obj: THREE.Object3D | null): boolean {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    const u = cur.userData as Record<string, unknown> | undefined;
    if (u?.isClimbableLadder === true || u?.collisionRole === 'climbable') return true;
    cur = cur.parent;
  }
  return false;
}

/** Default climbable controller for houses without ladders: never mounts, never moves the camera. */
export class NoopWalkthroughClimbableController implements WalkthroughClimbableController {
  public isActive(): boolean {
    return false;
  }

  public reset(): void {}

  public tryTriggerInteraction(): boolean {
    return false;
  }

  public checkAutoMountOnMovement(): boolean {
    return false;
  }

  public tryHandleSpaceJump(): { readonly handled: boolean; readonly kickBackVelocityY: number } {
    return { handled: false, kickBackVelocityY: 0 };
  }

  public step(
    _dtSeconds: number,
    _footPos: THREE.Vector3,
    yawRad: number,
    pitchRad: number,
    targetYawRad: number,
    targetPitchRad: number,
    currentEyeHeight: number
  ): WalkthroughClimbableStepResult {
    return {
      yawRad,
      pitchRad,
      targetYawRad,
      targetPitchRad,
      currentEyeHeight,
      bobOffsetY: 0,
      rollRad: 0,
      pitchNodRad: 0,
      fovBoost: 0,
    };
  }
}
