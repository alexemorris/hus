import type { Vector3 } from 'three';
import type { RoomZoneLodRegistration } from '../../core/entities.ts';
import type { FloorDefinition, FloorViewMode } from '../../core/types/scene.ts';
import type { RoomBoundingBox, RoomZoneId } from '../../core/types/topology.ts';

/**
 * Works out the "current room" for the room context panel.
 *
 * - Walkthrough: the room containing the player's feet, committed immediately. Where bounds
 *   overlap (stair voids, ground vs first floor), the room whose walking floor matches the foot
 *   height wins, then the smallest footprint.
 * - Orbit: the room under the orbit pivot, filtered by the active floor view. A new room only
 *   commits after it has been under the pivot for `dwellMs` (default 400 ms), so the panel does
 *   not flicker while panning.
 * - Explicit (navigator click): overrides both until the tracked point moves more than
 *   `explicitReleaseDistanceM` (default 2 m) from where the selection was made.
 */

export interface RoomTrackerOptions {
  readonly registrations: readonly RoomZoneLodRegistration[];
  readonly onChange: (zoneId: RoomZoneId | null) => void;
  /** Orbit dwell before a new room commits (ms). Default 400. */
  readonly dwellMs?: number;
  /** Pivot/foot travel that releases an explicit selection (m). Default 2. */
  readonly explicitReleaseDistanceM?: number;
  /**
   * Walking floor height for a registration. Defaults to the same mapping the walkthrough uses
   * for `getRoomMinYAt` in `PropertyScene`, so foot heights line up exactly.
   */
  readonly getWalkingFloorY?: (reg: RoomZoneLodRegistration) => number;
  /** The home's storeys. When omitted, the lowest floor is inferred from the registrations. */
  readonly floors?: readonly FloorDefinition[];
  /** Timer hooks (injectable for tests). Default `globalThis.setTimeout` / `clearTimeout`. */
  readonly setTimer?: (cb: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

interface TrackedRoom {
  readonly zoneId: RoomZoneId;
  readonly floorId: RoomZoneLodRegistration['floorId'];
  readonly bounds: RoomBoundingBox;
  readonly obb?: {
    readonly bounds: RoomBoundingBox;
    readonly ox: number;
    readonly oz: number;
    readonly cosY: number;
    readonly sinY: number;
  };
  readonly footprintM2: number;
  readonly walkingFloorY: number;
  readonly isExterior: boolean;
  /** XZ points inside the bounds that are not part of the room (L-shaped rooms). */
  readonly excludedCutout?: (x: number, z: number) => boolean;
}

interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Max distance between foot height and a room's walking floor for it to count (m). */
const WALK_FLOOR_TOLERANCE_M = 0.95;
/** Candidates whose floor is within this of the best match are treated as equally good (m). */
const WALK_FLOOR_TIE_M = 0.3;

/**
 * A room's walking floor elevation: its registered `walkingFloorY`, or the bottom of its
 * bounds when the home does not declare one.
 */
export function defaultWalkingFloorY(reg: RoomZoneLodRegistration): number {
  return reg.walkingFloorY ?? reg.bounds.minY;
}

function containsXZ(room: TrackedRoom, x: number, z: number): boolean {
  if (room.excludedCutout?.(x, z)) return false;
  if (room.obb) {
    const dx = x - room.obb.ox;
    const dz = z - room.obb.oz;
    const lx = dx * room.obb.cosY - dz * room.obb.sinY;
    const lz = dx * room.obb.sinY + dz * room.obb.cosY;
    const lb = room.obb.bounds;
    return lx >= lb.minX && lx <= lb.maxX && lz >= lb.minZ && lz <= lb.maxZ;
  }
  const b = room.bounds;
  return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
}

function containsY(room: TrackedRoom, y: number): boolean {
  return y >= room.bounds.minY - 0.1 && y <= room.bounds.maxY + 0.1;
}

/** Smallest footprint first; interiors before exteriors on ties. */
function compareBySize(a: TrackedRoom, b: TrackedRoom): number {
  if (a.isExterior !== b.isExterior) return a.isExterior ? 1 : -1;
  return a.footprintM2 - b.footprintM2;
}

function smallest(rooms: readonly TrackedRoom[]): TrackedRoom | undefined {
  let best: TrackedRoom | undefined;
  for (const r of rooms) {
    if (!best || compareBySize(r, best) < 0) best = r;
  }
  return best;
}

/**
 * The floor that exterior zones are grouped with: the lowest declared floor, or (when the home
 * declares none) the floor of the interior room with the lowest walking floor.
 */
function resolveLowestFloorId(
  rooms: readonly TrackedRoom[],
  floors: readonly FloorDefinition[] | undefined
): string | null {
  if (floors && floors.length > 0) {
    let lowest = floors[0]!;
    for (const f of floors) {
      if (f.elevationY < lowest.elevationY) lowest = f;
    }
    return lowest.id;
  }
  let lowestRoom: TrackedRoom | null = null;
  for (const r of rooms) {
    if (r.isExterior) continue;
    if (!lowestRoom || r.walkingFloorY < lowestRoom.walkingFloorY) lowestRoom = r;
  }
  return lowestRoom?.floorId ?? null;
}

function distanceSq(a: Point3, b: Point3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function copyPoint(p: Point3): Point3 {
  return { x: p.x, y: p.y, z: p.z };
}

export class RoomTracker {
  private readonly rooms: readonly TrackedRoom[];
  private readonly onChange: (zoneId: RoomZoneId | null) => void;
  private readonly dwellMs: number;
  private readonly releaseDistSq: number;
  private readonly setTimer: (cb: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  private readonly lowestFloorId: string | null;

  private current: RoomZoneId | null = null;
  /** Orbit candidate waiting out the dwell, and when it first appeared. */
  private pending: RoomZoneId | null = null;
  private pendingSinceMs = 0;
  private hasPending = false;
  private dwellTimer: unknown = null;

  /** Explicit selection lock: released once the tracked point moves away from the anchor. */
  private explicitActive = false;
  private explicitAnchor: Point3 | null = null;

  public constructor(options: RoomTrackerOptions) {
    const floorY = options.getWalkingFloorY ?? defaultWalkingFloorY;
    this.rooms = options.registrations.map((reg) => {
      const footprintBox = reg.obb ? reg.obb.bounds : reg.bounds;
      return {
        zoneId: reg.zoneId,
        floorId: reg.floorId,
        bounds: reg.bounds,
        ...(reg.obb
          ? {
              obb: {
                bounds: reg.obb.bounds,
                ox: reg.obb.offset[0],
                oz: reg.obb.offset[2],
                cosY: Math.cos(reg.obb.rotationY),
                sinY: Math.sin(reg.obb.rotationY),
              },
            }
          : {}),
        footprintM2:
          Math.max(0, footprintBox.maxX - footprintBox.minX) *
          Math.max(0, footprintBox.maxZ - footprintBox.minZ),
        walkingFloorY: floorY(reg),
        isExterior: reg.floorId === 'exterior' || reg.isInterior === false,
        ...(reg.excludedCutout ? { excludedCutout: reg.excludedCutout } : {}),
      };
    });
    this.lowestFloorId = resolveLowestFloorId(this.rooms, options.floors);
    this.onChange = options.onChange;
    this.dwellMs = Math.max(0, options.dwellMs ?? 400);
    const release = options.explicitReleaseDistanceM ?? 2;
    this.releaseDistSq = release * release;
    this.setTimer = options.setTimer ?? ((cb, ms) => globalThis.setTimeout(cb, ms));
    this.clearTimer =
      options.clearTimer ??
      ((handle) => {
        if (typeof handle === 'number' || typeof handle === 'object') {
          globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
        }
      });
  }

  public getCurrent(): RoomZoneId | null {
    return this.current;
  }

  /** True while a navigator selection is pinning the current room. */
  public isExplicit(): boolean {
    return this.explicitActive;
  }

  /**
   * Walkthrough: room containing the feet, committed immediately.
   * `footPos` is the player's foot position (camera position minus eye height).
   */
  public updateFromWalkthrough(footPos: Vector3): void {
    if (this.holdExplicit(footPos)) return;
    this.cancelPending();
    this.commit(this.findWalkthroughRoom(footPos.x, footPos.y, footPos.z));
  }

  /**
   * Orbit: room under the pivot for the active floor view, committed after `dwellMs`.
   * Call on every camera change; `nowMs` is a monotonic clock (e.g. `performance.now()`).
   */
  public updateFromOrbit(pivot: Vector3, floorMode: FloorViewMode, nowMs: number): void {
    if (this.holdExplicit(pivot)) return;
    const candidate = this.findOrbitRoom(pivot.x, pivot.y, pivot.z, floorMode);

    if (candidate === this.current) {
      this.cancelPending();
      return;
    }
    if (!this.hasPending || candidate !== this.pending) {
      this.cancelPending();
      this.pending = candidate;
      this.pendingSinceMs = nowMs;
      this.hasPending = true;
      if (this.dwellMs === 0) {
        this.commitPending();
        return;
      }
      // Panning usually stops before the dwell elapses, so commit from a timer too.
      this.dwellTimer = this.setTimer(() => {
        this.dwellTimer = null;
        this.commitPending();
      }, this.dwellMs);
      return;
    }
    this.tick(nowMs);
  }

  /** Optional: commit a pending orbit room whose dwell has elapsed (e.g. from the render loop). */
  public tick(nowMs: number): void {
    if (this.hasPending && nowMs - this.pendingSinceMs >= this.dwellMs) {
      this.commitPending();
    }
  }

  /**
   * Navigator click: commits immediately and pins the room until the tracked point (orbit pivot
   * or walkthrough feet) moves more than the release distance from `anchor`. Without an anchor,
   * the next update supplies it. Passing `null` clears the selection.
   */
  public setExplicit(zoneId: RoomZoneId | null, anchor?: Vector3): void {
    this.cancelPending();
    this.explicitActive = zoneId !== null;
    this.explicitAnchor = zoneId !== null && anchor ? copyPoint(anchor) : null;
    this.commit(zoneId);
  }

  /**
   * Re-bases the explicit anchor (call when a fly-to animation started by the navigator
   * finishes, so the camera travel itself does not release the selection).
   */
  public rebaseExplicitAnchor(point: Vector3): void {
    if (this.explicitActive) this.explicitAnchor = copyPoint(point);
  }

  public clearExplicit(): void {
    this.explicitActive = false;
    this.explicitAnchor = null;
  }

  /** Pure lookup used by orbit mode (no dwell, no state change). */
  public findOrbitRoom(x: number, y: number, z: number, floorMode: FloorViewMode): RoomZoneId | null {
    // Exterior zones (grounds, courtyards) are shown together with the lowest floor.
    const onLowestFloor = (r: TrackedRoom): boolean =>
      r.floorId === this.lowestFloorId || r.isExterior;
    const inXZ = this.rooms.filter((r) => {
      if (!containsXZ(r, x, z)) return false;
      if (floorMode === 'all' || r.floorId === floorMode) return true;
      return floorMode === this.lowestFloorId && r.isExterior;
    });
    if (inXZ.length === 0) return null;
    if (floorMode === 'all') {
      // Every floor visible: trust the pivot height when it lands inside a room's volume.
      const inY = inXZ.filter((r) => containsY(r, y));
      const pick = smallest(inY.length > 0 ? inY : inXZ.filter(onLowestFloor));
      return pick?.zoneId ?? smallest(inXZ)?.zoneId ?? null;
    }
    return smallest(inXZ)?.zoneId ?? null;
  }

  /** Pure lookup used by walkthrough mode. */
  public findWalkthroughRoom(x: number, y: number, z: number): RoomZoneId | null {
    let bestDy = Number.POSITIVE_INFINITY;
    const scored: { readonly room: TrackedRoom; readonly dy: number }[] = [];
    for (const r of this.rooms) {
      if (!containsXZ(r, x, z)) continue;
      const dy = Math.abs(y - r.walkingFloorY);
      if (r.isExterior) {
        // Exterior grounds have no single floor height; accept anywhere near ground level.
        if (y <= 1.5) scored.push({ room: r, dy: WALK_FLOOR_TOLERANCE_M });
        continue;
      }
      if (dy > WALK_FLOOR_TOLERANCE_M) continue;
      scored.push({ room: r, dy });
      if (dy < bestDy) bestDy = dy;
    }
    if (scored.length === 0) return null;
    const interiors = scored.filter((s) => !s.room.isExterior && s.dy <= bestDy + WALK_FLOOR_TIE_M);
    const pool = interiors.length > 0 ? interiors : scored;
    return smallest(pool.map((s) => s.room))?.zoneId ?? null;
  }

  public dispose(): void {
    this.cancelPending();
  }

  /** Returns true if an explicit selection should keep the current room. */
  private holdExplicit(point: Point3): boolean {
    if (!this.explicitActive) return false;
    if (!this.explicitAnchor) {
      this.explicitAnchor = copyPoint(point);
      return true;
    }
    if (distanceSq(point, this.explicitAnchor) <= this.releaseDistSq) return true;
    this.clearExplicit();
    return false;
  }

  private commitPending(): void {
    if (!this.hasPending) return;
    const next = this.pending;
    this.cancelPending();
    this.commit(next);
  }

  private cancelPending(): void {
    this.hasPending = false;
    this.pending = null;
    if (this.dwellTimer !== null) {
      this.clearTimer(this.dwellTimer);
      this.dwellTimer = null;
    }
  }

  private commit(zoneId: RoomZoneId | null): void {
    if (zoneId === this.current) return;
    this.current = zoneId;
    this.onChange(zoneId);
  }
}
