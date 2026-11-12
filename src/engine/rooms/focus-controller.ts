import type { FloorDefinition, FloorViewMode } from '../../core/types/scene.ts';
import type { FloorId, RoomBoundingBox, RoomZoneId } from '../../core/types/topology.ts';

/** How far the user is "zoomed into" the property. */
export type FocusLevel = 'property' | 'floor' | 'room';

export interface FocusState {
  readonly level: FocusLevel;
  /** Floor the camera is looking at. */
  readonly floorId: FloorId;
  /** Focused room when `level === 'room'`, otherwise null. */
  readonly zoneId: RoomZoneId | null;
  /** True when the user has locked the focus (camera moves no longer change it). */
  readonly pinned: boolean;
}

export interface FocusRoom {
  readonly zoneId: RoomZoneId;
  readonly floorId: FloorId;
  readonly isInterior: boolean;
  readonly bounds: RoomBoundingBox;
}

interface Vec3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface FocusViewInput {
  readonly cameraPosition: Vec3Like;
  readonly target: Vec3Like;
  readonly isOrthographic: boolean;
  readonly orthoZoom: number;
  readonly floorViewMode: FloorViewMode;
}

/**
 * Distance thresholds (metres camera→target, or orthographic zoom factors).
 * `*Enter` applies when moving into a level, `*Exit` when leaving it, giving
 * hysteresis so the HUD does not flicker at the boundary.
 */
export interface FocusThresholds {
  readonly roomEnterM: number;
  readonly roomExitM: number;
  readonly propertyEnterM: number;
  readonly propertyExitM: number;
  readonly topDownPropertyEnterM: number;
  readonly topDownPropertyExitM: number;
  readonly orthoRoomEnterZoom: number;
  readonly orthoRoomExitZoom: number;
  readonly orthoPropertyEnterZoom: number;
  readonly orthoPropertyExitZoom: number;
  /**
   * Target Y above which the first floor is assumed when viewing all floors. Only used when the
   * controller is built without floor definitions.
   */
  readonly firstFloorTargetY: number;
}

export const DEFAULT_FOCUS_THRESHOLDS: FocusThresholds = {
  roomEnterM: 8.5,
  roomExitM: 9.8,
  // Matches the cutaway "zoomed out" distances where the house is shown whole.
  propertyEnterM: 16.5,
  propertyExitM: 15.0,
  topDownPropertyEnterM: 33.0,
  topDownPropertyExitM: 31.0,
  orthoRoomEnterZoom: 1.9,
  orthoRoomExitZoom: 1.7,
  orthoPropertyEnterZoom: 0.62,
  orthoPropertyExitZoom: 0.7,
  firstFloorTargetY: 2.2,
};

const TOP_DOWN_HORIZONTAL_LEN_M = 0.45;
/** A target this far below a floor's elevation already counts as looking at that floor (m). */
const FLOOR_TARGET_MARGIN_M = 0.3;

function containsXZ(b: RoomBoundingBox, x: number, z: number): boolean {
  return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
}

function statesEqual(a: FocusState, b: FocusState): boolean {
  return (
    a.level === b.level && a.floorId === b.floorId && a.zoneId === b.zoneId && a.pinned === b.pinned
  );
}

/**
 * Derives the property / floor / room the user is focused on from the camera.
 *
 * - Room: camera close to its target and the target is inside a room.
 * - Floor: mid distance, or close but not inside any room.
 * - Property: zoomed all the way out, or looking at the grounds rather than
 *   into the house.
 *
 * Focus can be pinned to lock it while the camera moves freely.
 */
export class FocusController {
  private readonly rooms: readonly FocusRoom[];
  private readonly thresholds: FocusThresholds;
  /** Declared storeys, lowest first; empty selects the two-storey `ground` / `first` default. */
  private readonly floors: readonly FloorDefinition[];
  private state: FocusState;
  private holdUntilMs = Number.NEGATIVE_INFINITY;
  private readonly listeners = new Set<(state: FocusState) => void>();

  public constructor(
    rooms: readonly FocusRoom[],
    thresholds: FocusThresholds = DEFAULT_FOCUS_THRESHOLDS,
    floors: readonly FloorDefinition[] = []
  ) {
    this.rooms = rooms;
    this.thresholds = thresholds;
    this.floors = [...floors].sort((a, b) => a.elevationY - b.elevationY);
    this.state = {
      level: 'floor',
      floorId: this.floors[0]?.id ?? 'ground',
      zoneId: null,
      pinned: false,
    };
  }

  /** The floor a world height belongs to. */
  private floorIdForY(y: number): FloorId {
    if (this.floors.length === 0) {
      return y >= this.thresholds.firstFloorTargetY ? 'first' : 'ground';
    }
    let floorId = this.floors[0]!.id;
    for (let i = 1; i < this.floors.length; i++) {
      const floor = this.floors[i]!;
      if (y >= floor.elevationY - FLOOR_TARGET_MARGIN_M) floorId = floor.id;
    }
    return floorId;
  }

  private isFloorId(mode: FloorViewMode): boolean {
    if (this.floors.length === 0) return mode === 'ground' || mode === 'first';
    return this.floors.some((f) => f.id === mode);
  }

  public getState(): FocusState {
    return this.state;
  }

  public subscribe(listener: (state: FocusState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Locks (or unlocks) the current focus. */
  public setPinned(pinned: boolean): void {
    this.commit({ ...this.state, pinned });
  }

  /**
   * Explicitly focuses a level (e.g. from the breadcrumb or a room tile).
   * Camera-driven updates are suspended for `holdMs` so the fly-to animation
   * does not flicker the focus through intermediate levels.
   */
  public focus(
    level: FocusLevel,
    floorId: FloorId,
    zoneId: RoomZoneId | null,
    holdMs = 1000,
    nowMs: number = performance.now()
  ): void {
    this.holdUntilMs = nowMs + holdMs;
    this.commit({
      level,
      floorId,
      zoneId: level === 'room' ? zoneId : null,
      pinned: this.state.pinned,
    });
  }

  /** Returns the room containing a world point on the given floor, if any. */
  public findRoomAt(x: number, y: number, z: number, floorId?: FloorId): FocusRoom | null {
    const floor = floorId ?? this.floorIdForY(y);
    return (
      this.rooms.find((r) => r.isInterior && r.floorId === floor && containsXZ(r.bounds, x, z)) ??
      this.rooms.find((r) => !r.isInterior && containsXZ(r.bounds, x, z)) ??
      null
    );
  }

  /** Re-evaluates focus from the camera. Returns true if the focus changed. */
  public update(view: FocusViewInput, nowMs: number = performance.now()): boolean {
    if (this.state.pinned || nowMs < this.holdUntilMs) return false;
    return this.commit(this.evaluate(view));
  }

  private evaluate(view: FocusViewInput): FocusState {
    const t = this.thresholds;
    const prev = this.state.level;
    const { cameraPosition: cam, target } = view;

    const floorId: FloorId = this.isFloorId(view.floorViewMode)
      ? view.floorViewMode
      : this.floorIdForY(target.y);

    let wantsProperty: boolean;
    let wantsRoom: boolean;
    if (view.isOrthographic) {
      const zoom = view.orthoZoom;
      wantsProperty =
        zoom <= (prev === 'property' ? t.orthoPropertyExitZoom : t.orthoPropertyEnterZoom);
      wantsRoom = zoom >= (prev === 'room' ? t.orthoRoomExitZoom : t.orthoRoomEnterZoom);
    } else {
      const dist = Math.hypot(target.x - cam.x, target.y - cam.y, target.z - cam.z);
      const horizLen = Math.hypot(target.x - cam.x, target.z - cam.z);
      const isTopDown = horizLen < TOP_DOWN_HORIZONTAL_LEN_M;
      const propertyM = isTopDown
        ? prev === 'property'
          ? t.topDownPropertyExitM
          : t.topDownPropertyEnterM
        : prev === 'property'
          ? t.propertyExitM
          : t.propertyEnterM;
      wantsProperty = dist >= propertyM;
      wantsRoom = dist <= (prev === 'room' ? t.roomExitM : t.roomEnterM);
    }

    if (wantsProperty) {
      return { level: 'property', floorId, zoneId: null, pinned: false };
    }

    const room = this.findRoomAt(target.x, target.y, target.z, floorId);
    if (wantsRoom && room) {
      return { level: 'room', floorId, zoneId: room.zoneId, pinned: false };
    }
    // Looking at the grounds (not into the house) from mid distance: whole-home controls.
    if (!room || !room.isInterior) {
      return { level: 'property', floorId, zoneId: null, pinned: false };
    }
    return { level: 'floor', floorId, zoneId: null, pinned: false };
  }

  private commit(next: FocusState): boolean {
    if (statesEqual(next, this.state)) return false;
    this.state = next;
    for (const listener of this.listeners) {
      listener(next);
    }
    return true;
  }
}
