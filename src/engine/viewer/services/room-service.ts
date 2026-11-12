import * as THREE from 'three';
import type { LodPolicyMode, RoomZoneLodRegistration } from '../../../core/entities.ts';
import type { FloorDefinition, FloorViewMode } from '../../../core/types/scene.ts';
import type { RoomZoneId } from '../../../core/types/topology.ts';
import type { RoomLodController } from '../../lod/lod-manager.ts';
import { RoomHighlight } from '../../rooms/room-highlight.ts';
import { RoomTracker, defaultWalkingFloorY } from '../../rooms/room-tracker.ts';
import { STANDING_EYE_HEIGHT } from '../../walkthrough/parts/walkthrough-spawns.ts';
import { Emitter } from '../../util/emitter.ts';
import type { RenderInvalidator } from './viewer-types.ts';

export interface RoomServiceHost {
  readonly scene: THREE.Scene;
  readonly registrations: readonly RoomZoneLodRegistration[];
  /** The home's storeys (lowest first); inferred from the registrations when omitted. */
  readonly floors?: readonly FloorDefinition[];
  readonly lodController: RoomLodController;
  readonly invalidator: RenderInvalidator;
  getCameraPosition(): THREE.Vector3;
  getOrbitTarget(): THREE.Vector3;
  getOrbitPivot(): THREE.Vector3;
  getFloorViewMode(): FloorViewMode;
  /** Called when the current room changes (e.g. to re-anchor the point-light budget). */
  onCurrentRoomChanged(zoneId: RoomZoneId): void;
}

/** Max distance between a foot height and a room's walking floor (m). */
const WALK_FLOOR_SNAP_M = 0.95;

/**
 * Current-room tracking (orbit pivot / walkthrough feet / explicit selection),
 * focused-room LOD, room highlight and walkthrough floor heights.
 */
export class RoomService {
  public readonly changed = new Emitter<[zoneId: RoomZoneId | null]>();
  private readonly host: RoomServiceHost;
  private readonly tracker: RoomTracker;
  private readonly highlighter: RoomHighlight;
  private readonly footScratch = new THREE.Vector3();
  private current: RoomZoneId | null = null;

  public constructor(host: RoomServiceHost) {
    this.host = host;
    this.tracker = new RoomTracker({
      registrations: host.registrations,
      ...(host.floors ? { floors: host.floors } : {}),
      onChange: (zoneId) => this.setCurrent(zoneId),
    });
    this.highlighter = new RoomHighlight(host.scene);
  }

  public getCurrent(): RoomZoneId | null {
    return this.current;
  }

  public getRegistration(zoneId: RoomZoneId): RoomZoneLodRegistration | undefined {
    return this.host.registrations.find((r) => r.zoneId === zoneId);
  }

  /** Explicitly selects a room (e.g. from the room navigator) and focuses its LOD. */
  public select(zoneId: RoomZoneId): void {
    this.tracker.setExplicit(zoneId, this.host.getOrbitPivot());
    this.setFocusedZone(zoneId);
  }

  public rebaseExplicitAnchor(point: THREE.Vector3): void {
    this.tracker.rebaseExplicitAnchor(point);
  }

  public setFocusedZone(zoneId: RoomZoneId): void {
    const changed = this.host.lodController.setFocusedZoneId(
      zoneId,
      this.host.getCameraPosition(),
      this.host.getOrbitTarget(),
      this.host.getFloorViewMode()
    );
    if (changed) {
      if (this.host.lodController.didLastEvalChangeShadows()) {
        this.host.invalidator.invalidateShadows();
      }
      this.host.invalidator.requestRender();
    }
  }

  public getLodPolicyMode(): LodPolicyMode {
    return this.host.lodController.getPolicyMode();
  }

  public setLodPolicyMode(mode: LodPolicyMode): void {
    const changed = this.host.lodController.setPolicyMode(
      mode,
      this.host.getCameraPosition(),
      this.host.getOrbitTarget(),
      this.host.getFloorViewMode()
    );
    if (changed) {
      if (this.host.lodController.didLastEvalChangeShadows()) {
        this.host.invalidator.invalidateShadows();
      }
      this.host.invalidator.requestRender();
    }
  }

  /** Updates the tracked room from the current view (walkthrough eye or orbit pivot). */
  public updateFromView(isWalkthrough: boolean, eyeOrTarget: THREE.Vector3): void {
    if (isWalkthrough) {
      this.footScratch.copy(eyeOrTarget);
      this.footScratch.y -= STANDING_EYE_HEIGHT;
      this.tracker.updateFromWalkthrough(this.footScratch);
    } else {
      this.tracker.updateFromOrbit(eyeOrTarget, this.host.getFloorViewMode(), performance.now());
    }
  }

  /** Subtle floor tint / outline for a room; `null` clears it. */
  public highlight(zoneId: RoomZoneId | null): void {
    const reg = zoneId ? this.getRegistration(zoneId) : undefined;
    this.highlighter.show(reg?.bounds ?? null, reg ? defaultWalkingFloorY(reg) : 0);
    this.host.invalidator.requestRender();
  }

  /**
   * Walking floor height under (x, z) closest to foot height `y`, or null when
   * outside every room (used by walkthrough gravity / collision).
   */
  public getRoomMinYAt(x: number, y: number, z: number): number | null {
    let bestMinY: number | null = null;
    let bestDistY = Number.POSITIVE_INFINITY;
    for (const reg of this.host.registrations) {
      if (reg.isInterior === false) continue;
      // Skip the part of an L-shaped room's bounding box that lies outside the room.
      if (reg.excludedCutout?.(x, z)) continue;
      const b = reg.bounds;
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) {
        // Sub-floor bounding-box minY (screed / cellar) is not the walking floor elevation.
        const walkingFloorY = defaultWalkingFloorY(reg);
        const distY = Math.abs(y - walkingFloorY);
        if (distY <= WALK_FLOOR_SNAP_M && distY < bestDistY) {
          bestDistY = distY;
          bestMinY = walkingFloorY;
        }
      }
    }
    return bestMinY;
  }

  private setCurrent(zoneId: RoomZoneId | null): void {
    if (zoneId === this.current) return;
    this.current = zoneId;
    if (zoneId) this.host.onCurrentRoomChanged(zoneId);
    this.changed.emit(zoneId);
  }
}
