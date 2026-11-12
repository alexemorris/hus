import type * as THREE from 'three';
import {
  getClosedDoorwayGeometry,
  playHingedDoorSound,
  type HingedDoorState,
} from './hinged-doors.ts';

/** Minimum time after a manual close before a walkthrough barge may re-open a door. */
const MANUAL_CLOSE_BARGE_COOLDOWN_MS = 650;

/** Registry services the walkthrough barge logic needs. */
export interface DoorBargeContext {
  readonly doors: ReadonlyMap<string, HingedDoorState>;
  readonly tmpHingeWorld: THREE.Vector3;
  isWalkthroughDoor(id: string): boolean;
  getEffectiveOpenAngle(door: HingedDoorState): number;
  closeConflictingDoors(id: string): void;
  /** Other leaf of a split (stable) door that must barge open together, if any. */
  getSplitLeafPartnerId(id: string): string | undefined;
  /** `performance.now()` timestamp of the last manual close of `id` (0 if never). */
  getLastManualCloseMs(id: string): number;
}

/**
 * Determines whether a player at `(footX, footY, footZ)` moving with horizontal unit direction
 * `(moveDirX, moveDirZ)` is genuinely running/walking **through** `door`'s doorway (rather than
 * running parallel past the door in a corridor).
 *
 * Returns the desired `rotation.y` swing sign (`+1` or `-1`) so the door swings open **away**
 * from the player in whichever direction they are running through, or `null` if not traversing.
 */
export function computeDoorwayTraversalSwingSign(
  door: HingedDoorState,
  tmpHingeWorld: THREE.Vector3,
  footX: number,
  footY: number,
  footZ: number,
  moveDirX: number,
  moveDirZ: number,
  isSprinting: boolean,
  isRaycastHit: boolean
): -1 | 1 | null {
  const geom = getClosedDoorwayGeometry(door, tmpHingeWorld);
  if (geom.maxY <= footY + 0.25 || geom.minY >= footY + 1.78) {
    return null;
  }

  const relX = footX - geom.centerX;
  const relZ = footZ - geom.centerZ;
  // Lateral offset along the doorway (0 = center, ±halfWidth = jambs)
  const u = relX * geom.tangentX + relZ * geom.tangentZ;
  // Signed perpendicular distance from the closed doorway plane
  const n = relX * geom.normalX + relZ * geom.normalZ;

  // Velocity components along and perpendicular to the doorway plane
  const vu = moveDirX * geom.tangentX + moveDirZ * geom.tangentZ;
  const vn = moveDirX * geom.normalX + moveDirZ * geom.normalZ;

  // 1. Must be moving substantially across the doorway plane (never open when running parallel past a door!)
  if (Math.abs(vn) < 0.58) {
    return null;
  }

  // 2. Must be on the approach side of the doorway (or right in the threshold) moving toward/across n = 0
  if (n * vn > 0.05) {
    return null;
  }

  const maxPerpDist = isRaycastHit ? (door.isOpen ? 0.88 : 0.54) : isSprinting ? 0.56 : 0.48;
  if (Math.abs(n) > maxPerpDist) {
    return null;
  }

  const latchCrossMargin = door.partnerDoorId !== undefined ? 0.08 : -0.02;
  if (u < -(geom.halfWidth + 0.04) || u > geom.halfWidth + Math.max(0.04, latchCrossMargin)) {
    return null;
  }
  const distToPlane = Math.max(0, -n / vn);
  const uCross = u + vu * distToPlane;
  if (uCross < -(geom.halfWidth - 0.02) || uCross > geom.halfWidth + latchCrossMargin) {
    return null;
  }

  return vn >= 0 ? 1 : -1;
}

function applyDoorBargeSwing(
  ctx: DoorBargeContext,
  door: HingedDoorState,
  desiredSign: -1 | 1 | undefined,
  bargeSpeed: number
): void {
  if (!door.isOpen) {
    const currentEffectiveOpen = ctx.getEffectiveOpenAngle(door);
    const currentSign: -1 | 1 = currentEffectiveOpen - door.closedAngle >= 0 ? 1 : -1;
    door.fromAngle = door.progress > 0.01 ? door.pivot.rotation[door.axis] : undefined;
    door.bargeSwingSign = desiredSign ?? currentSign;
    door.progress = 0;
    door.isOpen = true;
    door.speed = bargeSpeed;
    playHingedDoorSound(door, 'barge');
    ctx.closeConflictingDoors(door.id);
  } else if (door.progress < 0.95 && door.speed < bargeSpeed) {
    door.speed = bargeSpeed;
  }
}

/**
 * Call-of-Duty style door barge: if `id` is a closed walk-through door and the player is
 * genuinely running **through** the doorway (not running parallel past it), automatically flings
 * it open away from the player's movement direction (including both halves of a split stable door
 * and linked French door pairs) and returns `true` so First-Person Walkthrough collision lets the
 * player run right through. If the door is already open, it stays open without swinging back.
 */
export function bargeOpenWalkthroughDoor(
  ctx: DoorBargeContext,
  id: string,
  isSprinting: boolean,
  footX?: number,
  footY?: number,
  footZ?: number,
  moveDirX?: number,
  moveDirZ?: number
): boolean {
  if (!ctx.isWalkthroughDoor(id)) return false;
  const door = ctx.doors.get(id);
  if (!door) return false;

  const lastCloseMs = ctx.getLastManualCloseMs(id);
  if (lastCloseMs > 0 && performance.now() - lastCloseMs < MANUAL_CLOSE_BARGE_COOLDOWN_MS) {
    return false;
  }

  // If the door is already open, do not swing it the other way again; allow passing while it finishes opening
  if (door.isOpen) {
    if (door.progress < 0.95) {
      const bargeSpeed = isSprinting ? 6.8 : 4.8;
      if (door.speed < bargeSpeed) door.speed = bargeSpeed;
      return true;
    }
    return false;
  }

  let desiredSign: -1 | 1 | undefined;
  if (
    footX !== undefined &&
    footY !== undefined &&
    footZ !== undefined &&
    moveDirX !== undefined &&
    moveDirZ !== undefined
  ) {
    const sign = computeDoorwayTraversalSwingSign(
      door,
      ctx.tmpHingeWorld,
      footX,
      footY,
      footZ,
      moveDirX,
      moveDirZ,
      isSprinting,
      true
    );
    if (sign === null) {
      return false;
    }
    desiredSign = sign;
  }

  const bargeSpeed = isSprinting ? 6.8 : 4.8;
  applyDoorBargeSwing(ctx, door, desiredSign, bargeSpeed);

  // Barging a split stable door or a linked pair of French doors opens both leaves together.
  const partnerId = door.partnerDoorId ?? ctx.getSplitLeafPartnerId(id);
  if (partnerId !== undefined) {
    const partner = ctx.doors.get(partnerId);
    if (partner && !partner.isOpen) {
      const sameHingeDir =
        Math.sign(partner.openAngle - partner.closedAngle) ===
        Math.sign(door.openAngle - door.closedAngle);
      const partnerSign =
        desiredSign === undefined
          ? undefined
          : sameHingeDir
            ? desiredSign
            : (-desiredSign as -1 | 1);
      applyDoorBargeSwing(ctx, partner, partnerSign, bargeSpeed);
    }
  }

  return true;
}

/**
 * Checks if the player's capsule in First-Person Walkthrough mode is running/walking **through**
 * any closed walk-through doorway and pre-emptively barges it open away from the player's
 * movement direction.
 */
export function bargeNearbyWalkthroughDoors(
  ctx: DoorBargeContext,
  footX: number,
  footY: number,
  footZ: number,
  moveDirX: number,
  moveDirZ: number,
  isSprinting: boolean
): boolean {
  let anyBarged = false;
  let now = -1;

  for (const [id, door] of ctx.doors.entries()) {
    if (door.isOpen || door.axis !== 'y' || door.isWalkthroughCandidate === false) continue;
    const geom = door.closedGeometry ?? getClosedDoorwayGeometry(door, ctx.tmpHingeWorld);
    const dx = footX - geom.centerX;
    const dz = footZ - geom.centerZ;
    const dy = footY + 0.9 - (geom.minY + geom.maxY) * 0.5;
    if (dx * dx + dz * dz > 5.0 || Math.abs(dy) > 2.6) continue;
    if (!ctx.isWalkthroughDoor(id)) continue;
    if (now < 0) now = performance.now();
    const lastCloseMs = ctx.getLastManualCloseMs(id);
    if (lastCloseMs > 0 && now - lastCloseMs < MANUAL_CLOSE_BARGE_COOLDOWN_MS) continue;

    const desiredSign = computeDoorwayTraversalSwingSign(
      door,
      ctx.tmpHingeWorld,
      footX,
      footY,
      footZ,
      moveDirX,
      moveDirZ,
      isSprinting,
      false
    );
    if (desiredSign === null) continue;

    if (bargeOpenWalkthroughDoor(ctx, id, isSprinting, footX, footY, footZ, moveDirX, moveDirZ)) {
      anyBarged = true;
    }
  }
  return anyBarged;
}
