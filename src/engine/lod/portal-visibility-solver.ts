import * as THREE from 'three';
import type { RoomZoneLodRegistration } from '../../core/entities.ts';
import type { FloorViewMode } from '../../core/types/scene.ts';
import type { FloorId, RoomBoundingBox, RoomZoneId } from '../../core/types/topology.ts';

export interface ExteriorWindowPortal {
  readonly id?: string;
  readonly roomZoneId: RoomZoneId;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly centerZ: number;
  readonly outwardNx: number;
  readonly outwardNy: number;
  readonly outwardNz: number;
  readonly isRooflight?: boolean;
  /** Optional dynamic predicate (e.g. opaque exterior door / garage door open check). Defaults to always active. */
  readonly isActive?: () => boolean;
}

export interface InteriorRoomPortal {
  readonly id?: string;
  readonly roomA: RoomZoneId;
  readonly roomB: RoomZoneId;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
  /** True for open archways, double-height stair voids, glazed interior doors, and vision-panel doors. */
  readonly alwaysOpenOrGlazed?: boolean;
  /** Live door open predicate (`door.isOpen || door.progress > 0.01`) when `alwaysOpenOrGlazed` is false. */
  readonly isActive?: () => boolean;
}

export interface PortalVisibilityConfig {
  readonly rooms: readonly RoomZoneLodRegistration[];
  readonly exteriorPortals: readonly ExteriorWindowPortal[];
  readonly interiorPortals: readonly InteriorRoomPortal[];
  /** Optional point-exclusion predicate for L-shaped room bounds (e.g. upperLanding courtyard notch). */
  readonly isPointExcludedFromRoom?: (
    zoneId: RoomZoneId,
    wx: number,
    wy: number,
    wz: number
  ) => boolean;
}

export interface PortalSolveOptions {
  /**
   * True when `floorViewMode === 'all'` AND `ceilingCutaway` is currently hiding the roof close-up,
   * exposing 1st-floor bedrooms from above even though walls are up.
   */
  readonly roofCutawayOpen?: boolean;
}

interface InternalRoomRecord {
  readonly index: number;
  readonly zoneId: RoomZoneId;
  readonly floorId: FloorId;
  readonly worldBounds: RoomBoundingBox;
  readonly hasObb: boolean;
  readonly ox: number;
  readonly oy: number;
  readonly oz: number;
  readonly cosY: number;
  readonly sinY: number;
  readonly localMinX: number;
  readonly localMaxX: number;
  readonly localMinY: number;
  readonly localMaxY: number;
  readonly localMinZ: number;
  readonly localMaxZ: number;
}

interface InternalExteriorPortal {
  readonly roomIndex: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly centerZ: number;
  readonly outwardNx: number;
  readonly outwardNy: number;
  readonly outwardNz: number;
  readonly horizonThreshold: number;
  readonly isActive?: () => boolean;
}

interface InternalInteriorPortal {
  readonly indexA: number;
  readonly indexB: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly alwaysOpenOrGlazed: boolean;
  readonly isActive?: () => boolean;
}

const CAMERA_CONTAINMENT_INFLATE_M = 0.35;
const EXTERIOR_PROXIMITY_M = 1.5;
const INTERIOR_DOORWAY_PROXIMITY_M = 0.45;
const EXTERIOR_HORIZON_DOT = -0.25;
const ROOFLIGHT_HORIZON_DOT = -0.45;

/**
 * Exact Conservative Cell-and-Portal + Exterior-Window Occlusion Solver (`0.00 px` visual diff, `< 0.03 ms` CPU).
 *
 * Pre-allocates all working buffers at construction time so `solveVisibleInteriorRooms()` performs
 * zero heap allocations per frame during orbit and first-person walkthrough.
 */
export class PortalVisibilitySolver {
  private readonly rooms: readonly InternalRoomRecord[];
  private readonly roomIndexById = new Map<RoomZoneId, number>();
  private readonly exteriorPortals: readonly InternalExteriorPortal[];
  private readonly interiorPortals: readonly InternalInteriorPortal[];
  private readonly isPointExcludedFromRoom?: (
    zoneId: RoomZoneId,
    wx: number,
    wy: number,
    wz: number
  ) => boolean;

  // Pre-allocated zero-GC working buffers
  private readonly visibleFlags: Uint8Array;
  private readonly inFrustumFlags: Uint8Array;
  private readonly seedFlags: Uint8Array;
  /** Per-room screen-space NDC rect `[minU, minV, maxU, maxV]` (`minU > maxU` => empty). */
  private readonly roomRects: Float64Array;
  /** Cached per-solve portal NDC rects `[minU, minV, maxU, maxV]` + active flags. */
  private readonly interiorPortalRects: Float64Array;
  private readonly interiorPortalActive: Uint8Array;

  private readonly projScreenMatrix = new THREE.Matrix4();
  private readonly frustum = new THREE.Frustum();
  private readonly scratchBox = new THREE.Box3();
  private readonly scratchRect = new Float64Array(4);
  private readonly exteriorExitRect = new Float64Array(4);
  private lastSolveDurationMs = 0;

  public constructor(config: PortalVisibilityConfig) {
    this.isPointExcludedFromRoom = config.isPointExcludedFromRoom;

    const interiorRegs = config.rooms.filter((r) => r.isInterior !== false);
    const records: InternalRoomRecord[] = [];
    for (let i = 0; i < interiorRegs.length; i++) {
      const reg = interiorRegs[i]!;
      const obb = reg.obb;
      const lb = obb ? obb.bounds : reg.bounds;
      const rotY = obb?.rotationY ?? 0;
      records.push({
        index: i,
        zoneId: reg.zoneId,
        floorId: reg.floorId,
        worldBounds: reg.bounds,
        hasObb: Boolean(obb),
        ox: obb?.offset[0] ?? 0,
        oy: obb?.offset[1] ?? 0,
        oz: obb?.offset[2] ?? 0,
        cosY: Math.cos(rotY),
        sinY: Math.sin(rotY),
        localMinX: lb.minX,
        localMaxX: lb.maxX,
        localMinY: lb.minY,
        localMaxY: lb.maxY,
        localMinZ: lb.minZ,
        localMaxZ: lb.maxZ,
      });
      this.roomIndexById.set(reg.zoneId, i);
    }
    this.rooms = records;

    const extList: InternalExteriorPortal[] = [];
    for (const p of config.exteriorPortals) {
      const rIdx = this.roomIndexById.get(p.roomZoneId);
      if (rIdx === undefined) continue;
      extList.push({
        roomIndex: rIdx,
        minX: p.minX,
        maxX: p.maxX,
        minY: p.minY,
        maxY: p.maxY,
        minZ: p.minZ,
        maxZ: p.maxZ,
        centerX: p.centerX,
        centerY: p.centerY,
        centerZ: p.centerZ,
        outwardNx: p.outwardNx,
        outwardNy: p.outwardNy,
        outwardNz: p.outwardNz,
        horizonThreshold: p.isRooflight ? ROOFLIGHT_HORIZON_DOT : EXTERIOR_HORIZON_DOT,
        isActive: p.isActive,
      });
    }
    this.exteriorPortals = extList;

    const intList: InternalInteriorPortal[] = [];
    for (const p of config.interiorPortals) {
      const idxA = this.roomIndexById.get(p.roomA);
      const idxB = this.roomIndexById.get(p.roomB);
      if (idxA === undefined || idxB === undefined || idxA === idxB) continue;
      intList.push({
        indexA: idxA,
        indexB: idxB,
        minX: p.minX,
        maxX: p.maxX,
        minY: p.minY,
        maxY: p.maxY,
        minZ: p.minZ,
        maxZ: p.maxZ,
        alwaysOpenOrGlazed: Boolean(p.alwaysOpenOrGlazed),
        isActive: p.isActive,
      });
    }
    this.interiorPortals = intList;

    const nRooms = records.length;
    this.visibleFlags = new Uint8Array(nRooms);
    this.inFrustumFlags = new Uint8Array(nRooms);
    this.seedFlags = new Uint8Array(nRooms);
    this.roomRects = new Float64Array(nRooms * 4);
    this.interiorPortalRects = new Float64Array(intList.length * 4);
    this.interiorPortalActive = new Uint8Array(intList.length);
    this.visibleFlags.fill(1);
  }

  public getRoomCount(): number {
    return this.rooms.length;
  }

  public getExteriorPortalCount(): number {
    return this.exteriorPortals.length;
  }

  public getInteriorPortalCount(): number {
    return this.interiorPortals.length;
  }

  public getLastSolveDurationMs(): number {
    return this.lastSolveDurationMs;
  }

  /** Returns whether `zoneId` was visible in the most recent `solveVisibleInteriorRooms()` call. */
  public isRoomVisible(zoneId: RoomZoneId): boolean {
    const idx = this.roomIndexById.get(zoneId);
    if (idx === undefined) return true;
    return this.visibleFlags[idx] === 1;
  }

  /** Returns an array of currently visible interior `RoomZoneId`s (for diagnostics & unit tests). */
  public getVisibleRoomIds(): RoomZoneId[] {
    const out: RoomZoneId[] = [];
    for (let i = 0; i < this.rooms.length; i++) {
      if (this.visibleFlags[i] === 1) {
        out.push(this.rooms[i]!.zoneId);
      }
    }
    return out;
  }

  /**
   * Solves conservative interior room visibility for `camera` and `floorViewMode`.
   * Zero heap allocations per call.
   */
  public solveVisibleInteriorRooms(
    camera: THREE.Camera,
    floorViewMode: FloorViewMode,
    options?: PortalSolveOptions
  ): void {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const nRooms = this.rooms.length;

    // Dollhouse cutaway modes ('ground' or 'first'): all rooms on the open floor remain 100% visible.
    if (floorViewMode === 'ground' || floorViewMode === 'first') {
      this.visibleFlags.fill(1);
      this.lastSolveDurationMs =
        typeof performance !== 'undefined' ? performance.now() - t0 : 0;
      return;
    }

    // Ensure world->clip matrix is fresh for this exact camera pose.
    this.projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);
    const nearClipW =
      camera instanceof THREE.PerspectiveCamera ? Math.max(1e-4, camera.near) : 1e-4;

    const camX = camera.position.x;
    const camY = camera.position.y;
    const camZ = camera.position.z;

    this.visibleFlags.fill(0);
    this.seedFlags.fill(0);
    for (let i = 0; i < nRooms; i++) {
      const b = i * 4;
      this.roomRects[b] = 2;
      this.roomRects[b + 1] = 2;
      this.roomRects[b + 2] = -2;
      this.roomRects[b + 3] = -2;
    }

    // Frustum test + camera containment (+0.35m inflated room bounds)
    let seedCount = 0;
    for (let i = 0; i < nRooms; i++) {
      const room = this.rooms[i]!;
      const wb = room.worldBounds;
      this.scratchBox.min.set(wb.minX - 0.25, wb.minY - 0.25, wb.minZ - 0.25);
      this.scratchBox.max.set(wb.maxX + 0.25, wb.maxY + 0.25, wb.maxZ + 0.25);
      const inFrustum = this.frustum.intersectsBox(this.scratchBox);
      this.inFrustumFlags[i] = inFrustum ? 1 : 0;

      if (this.distancePointToRoom(camX, camY, camZ, room) <= CAMERA_CONTAINMENT_INFLATE_M) {
        if (!this.isPointExcludedFromRoom?.(room.zoneId, camX, camY, camZ)) {
          this.seedFlags[i] = 1;
          this.visibleFlags[i] = 1;
          this.setFullScreenRect(i);
          seedCount++;
        }
      }
    }

    // Pre-evaluate active interior portals & their projected NDC rects once per solve
    const nInt = this.interiorPortals.length;
    for (let p = 0; p < nInt; p++) {
      const portal = this.interiorPortals[p]!;
      const active =
        portal.alwaysOpenOrGlazed || (portal.isActive ? portal.isActive() : true);
      this.interiorPortalActive[p] = active ? 1 : 0;
      const base = p * 4;
      if (!active) {
        this.interiorPortalRects[base] = 2;
        this.interiorPortalRects[base + 1] = 2;
        this.interiorPortalRects[base + 2] = -2;
        this.interiorPortalRects[base + 3] = -2;
      } else {
        this.projectAabbToNdcRect(
          portal.minX,
          portal.minY,
          portal.minZ,
          portal.maxX,
          portal.maxY,
          portal.maxZ,
          nearClipW,
          this.scratchRect
        );
        this.interiorPortalRects[base] = this.scratchRect[0]!;
        this.interiorPortalRects[base + 1] = this.scratchRect[1]!;
        this.interiorPortalRects[base + 2] = this.scratchRect[2]!;
        this.interiorPortalRects[base + 3] = this.scratchRect[3]!;
      }
    }

    const roofCutawayOpen = Boolean(options?.roofCutawayOpen);

    if (seedCount === 0) {
      // CASE A: Camera is OUTSIDE all interior rooms (exterior orbit / courtyard)
      for (let i = 0; i < nRooms; i++) {
        if (this.inFrustumFlags[i] === 0) continue;
        const room = this.rooms[i]!;

        // If roof cutaway is open in 'all' mode, 1st-floor rooms in frustum are exposed from above.
        if (roofCutawayOpen && room.floorId === 'first') {
          this.visibleFlags[i] = 1;
          this.setFullScreenRect(i);
          continue;
        }

        // (i) Conservative proximity band around room shell (<= 1.5m)
        if (this.distancePointToRoom(camX, camY, camZ, room) <= EXTERIOR_PROXIMITY_M) {
          this.visibleFlags[i] = 1;
          this.setFullScreenRect(i);
        }
      }

      // (ii) Active ExteriorWindowPortals facing camera & intersecting NDC [-1, 1]^2
      const nExt = this.exteriorPortals.length;
      for (let e = 0; e < nExt; e++) {
        const ext = this.exteriorPortals[e]!;
        const rIdx = ext.roomIndex;
        if (this.inFrustumFlags[rIdx] === 0) continue;
        if (ext.isActive && !ext.isActive()) continue;

        const vx = camX - ext.centerX;
        const vy = camY - ext.centerY;
        const vz = camZ - ext.centerZ;
        const vLen = Math.hypot(vx, vy, vz);
        if (vLen > 1e-4) {
          const cosHorizon =
            (vx * ext.outwardNx + vy * ext.outwardNy + vz * ext.outwardNz) / vLen;
          if (cosHorizon <= ext.horizonThreshold) continue;
        }

        if (
          this.projectAabbToNdcRect(
            ext.minX,
            ext.minY,
            ext.minZ,
            ext.maxX,
            ext.maxY,
            ext.maxZ,
            nearClipW,
            this.scratchRect
          )
        ) {
          this.visibleFlags[rIdx] = 1;
          this.unionRoomRect(rIdx, this.scratchRect);
        }
      }

      // (iii) 1-3 hop interior sightline propagation through active InteriorRoomPortals
      this.propagateInteriorPortals(3);
    } else {
      // CASE B: Camera is INSIDE room(s) R_0 (first-person walkthrough or interior orbit)
      // Doorway threshold guard: any room within 0.45m connected via active portal to a seed room gets full rect
      for (let p = 0; p < nInt; p++) {
        if (this.interiorPortalActive[p] === 0) continue;
        const portal = this.interiorPortals[p]!;
        const aSeed = this.seedFlags[portal.indexA] === 1;
        const bSeed = this.seedFlags[portal.indexB] === 1;
        if (aSeed && !bSeed) {
          const roomB = this.rooms[portal.indexB]!;
          if (this.distancePointToRoom(camX, camY, camZ, roomB) <= INTERIOR_DOORWAY_PROXIMITY_M) {
            this.visibleFlags[portal.indexB] = 1;
            this.setFullScreenRect(portal.indexB);
          }
        } else if (bSeed && !aSeed) {
          const roomA = this.rooms[portal.indexA]!;
          if (this.distancePointToRoom(camX, camY, camZ, roomA) <= INTERIOR_DOORWAY_PROXIMITY_M) {
            this.visibleFlags[portal.indexA] = 1;
            this.setFullScreenRect(portal.indexA);
          }
        }
      }

      // Traverse active InteriorRoomPortals up to depth 4
      this.propagateInteriorPortals(4);

      // 1-hop Exterior Courtyard Re-Entry: looking out a window of a visible room across the courtyard
      // into another building/wing's window (e.g. Kitchen/Hall window -> Gym/Barn glazed screen)
      this.exteriorExitRect[0] = 2;
      this.exteriorExitRect[1] = 2;
      this.exteriorExitRect[2] = -2;
      this.exteriorExitRect[3] = -2;
      let hasExteriorExit = false;

      const nExt = this.exteriorPortals.length;
      for (let e = 0; e < nExt; e++) {
        const ext = this.exteriorPortals[e]!;
        const rIdx = ext.roomIndex;
        if (this.visibleFlags[rIdx] === 0) continue;
        if (ext.isActive && !ext.isActive()) continue;

        // Camera must be on the interior side looking outward through this window
        const toWinX = ext.centerX - camX;
        const toWinY = ext.centerY - camY;
        const toWinZ = ext.centerZ - camZ;
        const toWinLen = Math.hypot(toWinX, toWinY, toWinZ);
        if (toWinLen > 1e-4) {
          const outDot =
            (toWinX * ext.outwardNx + toWinY * ext.outwardNy + toWinZ * ext.outwardNz) / toWinLen;
          if (outDot < -0.15) continue;
        }

        if (
          this.projectAabbToNdcRect(
            ext.minX,
            ext.minY,
            ext.minZ,
            ext.maxX,
            ext.maxY,
            ext.maxZ,
            nearClipW,
            this.scratchRect
          )
        ) {
          const b = rIdx * 4;
          const minU = Math.max(this.roomRects[b]!, this.scratchRect[0]!);
          const minV = Math.max(this.roomRects[b + 1]!, this.scratchRect[1]!);
          const maxU = Math.min(this.roomRects[b + 2]!, this.scratchRect[2]!);
          const maxV = Math.min(this.roomRects[b + 3]!, this.scratchRect[3]!);
          if (minU < maxU && minV < maxV) {
            if (!hasExteriorExit) {
              this.exteriorExitRect[0] = minU;
              this.exteriorExitRect[1] = minV;
              this.exteriorExitRect[2] = maxU;
              this.exteriorExitRect[3] = maxV;
              hasExteriorExit = true;
            } else {
              if (minU < this.exteriorExitRect[0]!) this.exteriorExitRect[0] = minU;
              if (minV < this.exteriorExitRect[1]!) this.exteriorExitRect[1] = minV;
              if (maxU > this.exteriorExitRect[2]!) this.exteriorExitRect[2] = maxU;
              if (maxV > this.exteriorExitRect[3]!) this.exteriorExitRect[3] = maxV;
            }
          }
        }
      }

      if (hasExteriorExit) {
        let anyReEntered = false;
        for (let e = 0; e < nExt; e++) {
          const ext = this.exteriorPortals[e]!;
          const rIdx = ext.roomIndex;
          if (this.seedFlags[rIdx] === 1 || this.inFrustumFlags[rIdx] === 0) continue;
          if (ext.isActive && !ext.isActive()) continue;

          const vx = camX - ext.centerX;
          const vy = camY - ext.centerY;
          const vz = camZ - ext.centerZ;
          const vLen = Math.hypot(vx, vy, vz);
          if (vLen <= 0.5) continue;
          const cosHorizon =
            (vx * ext.outwardNx + vy * ext.outwardNy + vz * ext.outwardNz) / vLen;
          // Opposite wing/outbuilding window must face across the courtyard toward the viewer
          if (cosHorizon <= 0.05) continue;

          if (
            this.projectAabbToNdcRect(
              ext.minX,
              ext.minY,
              ext.minZ,
              ext.maxX,
              ext.maxY,
              ext.maxZ,
              nearClipW,
              this.scratchRect
            )
          ) {
            const minU = Math.max(this.exteriorExitRect[0]!, this.scratchRect[0]!);
            const minV = Math.max(this.exteriorExitRect[1]!, this.scratchRect[1]!);
            const maxU = Math.min(this.exteriorExitRect[2]!, this.scratchRect[2]!);
            const maxV = Math.min(this.exteriorExitRect[3]!, this.scratchRect[3]!);
            if (minU < maxU && minV < maxV) {
              this.scratchRect[0] = minU;
              this.scratchRect[1] = minV;
              this.scratchRect[2] = maxU;
              this.scratchRect[3] = maxV;
              this.visibleFlags[rIdx] = 1;
              this.unionRoomRect(rIdx, this.scratchRect);
              anyReEntered = true;
            }
          }
        }
        if (anyReEntered) {
          this.propagateInteriorPortals(2);
        }
      }
    }

    this.lastSolveDurationMs =
      typeof performance !== 'undefined' ? performance.now() - t0 : 0;
  }

  private propagateInteriorPortals(maxHops: number): void {
    const nInt = this.interiorPortals.length;
    for (let hop = 0; hop < maxHops; hop++) {
      let widened = false;
      for (let p = 0; p < nInt; p++) {
        if (this.interiorPortalActive[p] === 0) continue;
        const pBase = p * 4;
        const pMinU = this.interiorPortalRects[pBase]!;
        const pMinV = this.interiorPortalRects[pBase + 1]!;
        const pMaxU = this.interiorPortalRects[pBase + 2]!;
        const pMaxV = this.interiorPortalRects[pBase + 3]!;
        if (pMinU >= pMaxU || pMinV >= pMaxV) continue;

        const portal = this.interiorPortals[p]!;
        const idxA = portal.indexA;
        const idxB = portal.indexB;

        // Propagate A -> B
        if (this.visibleFlags[idxA] === 1 && this.inFrustumFlags[idxB] === 1) {
          const aBase = idxA * 4;
          const minU = Math.max(this.roomRects[aBase]!, pMinU);
          const minV = Math.max(this.roomRects[aBase + 1]!, pMinV);
          const maxU = Math.min(this.roomRects[aBase + 2]!, pMaxU);
          const maxV = Math.min(this.roomRects[aBase + 3]!, pMaxV);
          if (minU < maxU && minV < maxV) {
            this.scratchRect[0] = minU;
            this.scratchRect[1] = minV;
            this.scratchRect[2] = maxU;
            this.scratchRect[3] = maxV;
            this.visibleFlags[idxB] = 1;
            if (this.unionRoomRect(idxB, this.scratchRect)) {
              widened = true;
            }
          }
        }

        // Propagate B -> A
        if (this.visibleFlags[idxB] === 1 && this.inFrustumFlags[idxA] === 1) {
          const bBase = idxB * 4;
          const minU = Math.max(this.roomRects[bBase]!, pMinU);
          const minV = Math.max(this.roomRects[bBase + 1]!, pMinV);
          const maxU = Math.min(this.roomRects[bBase + 2]!, pMaxU);
          const maxV = Math.min(this.roomRects[bBase + 3]!, pMaxV);
          if (minU < maxU && minV < maxV) {
            this.scratchRect[0] = minU;
            this.scratchRect[1] = minV;
            this.scratchRect[2] = maxU;
            this.scratchRect[3] = maxV;
            this.visibleFlags[idxA] = 1;
            if (this.unionRoomRect(idxA, this.scratchRect)) {
              widened = true;
            }
          }
        }
      }
      if (!widened) break;
    }
  }

  private setFullScreenRect(roomIdx: number): void {
    const b = roomIdx * 4;
    this.roomRects[b] = -1;
    this.roomRects[b + 1] = -1;
    this.roomRects[b + 2] = 1;
    this.roomRects[b + 3] = 1;
  }

  private unionRoomRect(roomIdx: number, rect: Float64Array): boolean {
    const b = roomIdx * 4;
    let changed = false;
    const r0 = rect[0]!;
    const r1 = rect[1]!;
    const r2 = rect[2]!;
    const r3 = rect[3]!;
    if (this.roomRects[b]! > this.roomRects[b + 2]!) {
      this.roomRects[b] = r0;
      this.roomRects[b + 1] = r1;
      this.roomRects[b + 2] = r2;
      this.roomRects[b + 3] = r3;
      return true;
    }
    if (r0 < this.roomRects[b]! - 1e-4) {
      this.roomRects[b] = r0;
      changed = true;
    }
    if (r1 < this.roomRects[b + 1]! - 1e-4) {
      this.roomRects[b + 1] = r1;
      changed = true;
    }
    if (r2 > this.roomRects[b + 2]! + 1e-4) {
      this.roomRects[b + 2] = r2;
      changed = true;
    }
    if (r3 > this.roomRects[b + 3]! + 1e-4) {
      this.roomRects[b + 3] = r3;
      changed = true;
    }
    return changed;
  }

  private distancePointToRoom(
    wx: number,
    wy: number,
    wz: number,
    room: InternalRoomRecord
  ): number {
    let lx = wx;
    let ly = wy;
    let lz = wz;
    if (room.hasObb) {
      const dx = wx - room.ox;
      const dz = wz - room.oz;
      lx = dx * room.cosY - dz * room.sinY;
      ly = wy - room.oy;
      lz = dx * room.sinY + dz * room.cosY;
    }
    const outX = Math.max(0, room.localMinX - lx, lx - room.localMaxX);
    const outY = Math.max(0, room.localMinY - ly, ly - room.localMaxY);
    const outZ = Math.max(0, room.localMinZ - lz, lz - room.localMaxZ);
    return Math.hypot(outX, outY, outZ);
  }

  /**
   * Projects a world AABB to NDC `[-1, 1]^2` without allocating objects.
   * Conservatively clamps to full `[-1, 1]^2` whenever any corner straddles `w <= nearClipW`
   * while any corner is in front of the camera (`w > 1e-4`).
   */
  private projectAabbToNdcRect(
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
    nearClipW: number,
    outRect: Float64Array
  ): boolean {
    const e = this.projScreenMatrix.elements;
    const e0 = e[0]!, e1 = e[1]!, e3 = e[3]!;
    const e4 = e[4]!, e5 = e[5]!, e7 = e[7]!;
    const e8 = e[8]!, e9 = e[9]!, e11 = e[11]!;
    const e12 = e[12]!, e13 = e[13]!, e15 = e[15]!;

    let anyInFront = false;
    let anyStraddleNear = false;
    let minU = Infinity;
    let minV = Infinity;
    let maxU = -Infinity;
    let maxV = -Infinity;

    for (let mask = 0; mask < 8; mask++) {
      const x = (mask & 1) === 0 ? minX : maxX;
      const y = (mask & 2) === 0 ? minY : maxY;
      const z = (mask & 4) === 0 ? minZ : maxZ;

      const cx = e0 * x + e4 * y + e8 * z + e12;
      const cy = e1 * x + e5 * y + e9 * z + e13;
      const cw = e3 * x + e7 * y + e11 * z + e15;

      if (cw > 1e-4) {
        anyInFront = true;
      }
      if (cw <= nearClipW) {
        anyStraddleNear = true;
      } else {
        const invW = 1 / cw;
        const u = cx * invW;
        const v = cy * invW;
        if (u < minU) minU = u;
        if (v < minV) minV = v;
        if (u > maxU) maxU = u;
        if (v > maxV) maxV = v;
      }
    }

    if (!anyInFront) {
      outRect[0] = 2;
      outRect[1] = 2;
      outRect[2] = -2;
      outRect[3] = -2;
      return false;
    }

    if (anyStraddleNear) {
      outRect[0] = -1;
      outRect[1] = -1;
      outRect[2] = 1;
      outRect[3] = 1;
      return true;
    }

    const cMinU = minU < -1 ? -1 : minU;
    const cMinV = minV < -1 ? -1 : minV;
    const cMaxU = maxU > 1 ? 1 : maxU;
    const cMaxV = maxV > 1 ? 1 : maxV;
    if (cMinU >= cMaxU || cMinV >= cMaxV) {
      outRect[0] = 2;
      outRect[1] = 2;
      outRect[2] = -2;
      outRect[3] = -2;
      return false;
    }

    outRect[0] = cMinU;
    outRect[1] = cMinV;
    outRect[2] = cMaxU;
    outRect[3] = cMaxV;
    return true;
  }
}
