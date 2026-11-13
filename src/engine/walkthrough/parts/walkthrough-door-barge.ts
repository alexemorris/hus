import * as THREE from 'three';
import { accelerateStaticMeshRaycast, prebuildGeometryBvh } from '../../rendering/mesh-bvh.ts';
import { getStaircaseWalkableSampler } from '../auto-elevation-composer.ts';
import { sampleGenericWalkableElevation } from './walkthrough-elevation-solver.ts';

function isColliderVisibleInHierarchy(object: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = object;
  while (cur) {
    if (!cur.visible && cur.userData?.__prunedEmptyBatchGroup !== true) {
      return false;
    }
    cur = cur.parent;
  }
  return true;
}

interface CachedDoorwayOpening {
  readonly centerX: number;
  readonly centerZ: number;
  readonly minY: number;
  readonly maxY: number;
  readonly tangentX: number;
  readonly tangentZ: number;
  readonly normalX: number;
  readonly normalZ: number;
  readonly halfWidth: number;
}
import {
  computeDefaultWallSlideAxes,
  findNearestWalkthroughSpawn,
  type HouseWalkthroughHooks,
  STANDING_EYE_HEIGHT,
  WALK_SPEED_MPS,
  type WalkthroughCollisionMeshRule,
  type WalkthroughRoomMinYSampler,
} from './walkthrough-spawns.ts';

const NO_HOUSE_HOOKS: HouseWalkthroughHooks = {};
const SOLID_PLANE_RULE: WalkthroughCollisionMeshRule = { solidPlane: true };

const CARDINAL_DIRS: readonly THREE.Vector3[] = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
];

export type WalkthroughDoorBargeHandler = (
  interactableId: string,
  isSprinting: boolean,
  footX: number,
  footY: number,
  footZ: number,
  moveDirX: number,
  moveDirZ: number
) => boolean;

export type WalkthroughProximityDoorBargeHandler = (
  footX: number,
  footY: number,
  footZ: number,
  moveDirX: number,
  moveDirZ: number,
  isSprinting: boolean
) => boolean;

export interface CachedObstacle {
  readonly mesh: THREE.Mesh;
  readonly visibilityNode: THREE.Object3D;
  readonly localBox: THREE.Box3;
  centerX: number;
  centerZ: number;
  radiusXZ: number;
  minY: number;
  maxY: number;
  readonly isDynamic: boolean;
  visitStamp: number;
}

export interface CachedFurnitureBox {
  readonly mesh: THREE.Mesh;
  readonly visibilityNode: THREE.Object3D;
  readonly centerX: number;
  readonly centerZ: number;
  readonly radiusXZ: number;
  readonly minY: number;
  readonly maxY: number;
  readonly ux: number;
  readonly uz: number;
  readonly minU: number;
  readonly maxU: number;
  readonly minV: number;
  readonly maxV: number;
  visitStamp: number;
}

/** 2 m x 2 m 2D spatial hash cell size for O(1) obstacle & furniture queries. */
const SPATIAL_CELL_SIZE = 2.0;
const INV_SPATIAL_CELL_SIZE = 1.0 / SPATIAL_CELL_SIZE;

function spatialCellKey(cx: number, cz: number): number {
  return ((cx + 32768) << 16) | ((cz + 32768) & 0xffff);
}

function ensureGeometryBoundingBoxFast(geom: THREE.BufferGeometry): THREE.Box3 | null {
  if (geom.boundingBox) return geom.boundingBox;
  if (geom instanceof THREE.BoxGeometry) {
    const p = geom.parameters;
    const hx = (typeof p?.width === 'number' ? p.width : 1) * 0.5;
    const hy = (typeof p?.height === 'number' ? p.height : 1) * 0.5;
    const hz = (typeof p?.depth === 'number' ? p.depth : 1) * 0.5;
    geom.boundingBox = new THREE.Box3(
      new THREE.Vector3(-hx, -hy, -hz),
      new THREE.Vector3(hx, hy, hz)
    );
    return geom.boundingBox;
  }
  if (geom instanceof THREE.ConeGeometry) {
    const p = geom.parameters;
    const r = typeof p?.radius === 'number' ? Math.abs(p.radius) : 1;
    const hy = (typeof p?.height === 'number' ? p.height : 1) * 0.5;
    geom.boundingBox = new THREE.Box3(
      new THREE.Vector3(-r, -hy, -r),
      new THREE.Vector3(r, hy, r)
    );
    return geom.boundingBox;
  }
  if (geom instanceof THREE.CylinderGeometry) {
    const p = geom.parameters;
    const rt = typeof p?.radiusTop === 'number' ? Math.abs(p.radiusTop) : 1;
    const rb = typeof p?.radiusBottom === 'number' ? Math.abs(p.radiusBottom) : 1;
    const r = Math.max(rt, rb);
    const hy = (typeof p?.height === 'number' ? p.height : 1) * 0.5;
    geom.boundingBox = new THREE.Box3(
      new THREE.Vector3(-r, -hy, -r),
      new THREE.Vector3(r, hy, r)
    );
    return geom.boundingBox;
  }
  if (geom instanceof THREE.SphereGeometry) {
    const r = typeof geom.parameters?.radius === 'number' ? Math.abs(geom.parameters.radius) : 1;
    geom.boundingBox = new THREE.Box3(
      new THREE.Vector3(-r, -r, -r),
      new THREE.Vector3(r, r, r)
    );
    return geom.boundingBox;
  }
  if (geom instanceof THREE.CapsuleGeometry) {
    const p = geom.parameters;
    const r = typeof p?.radius === 'number' ? Math.abs(p.radius) : 1;
    const hl = (typeof p?.height === 'number' ? p.height : 1) * 0.5 + r;
    geom.boundingBox = new THREE.Box3(
      new THREE.Vector3(-r, -hl, -r),
      new THREE.Vector3(r, hl, r)
    );
    return geom.boundingBox;
  }
  if (geom instanceof THREE.TorusGeometry) {
    const p = geom.parameters;
    const r = (typeof p?.radius === 'number' ? p.radius : 1) + (typeof p?.tube === 'number' ? p.tube : 0.4);
    const t = typeof p?.tube === 'number' ? p.tube : 0.4;
    geom.boundingBox = new THREE.Box3(
      new THREE.Vector3(-r, -r, -t),
      new THREE.Vector3(r, r, t)
    );
    return geom.boundingBox;
  }
  if (geom instanceof THREE.CircleGeometry || geom instanceof THREE.RingGeometry) {
    const p = geom.parameters as { radius?: number; outerRadius?: number } | undefined;
    const r = typeof p?.outerRadius === 'number' ? p.outerRadius : typeof p?.radius === 'number' ? p.radius : 1;
    geom.boundingBox = new THREE.Box3(
      new THREE.Vector3(-r, -r, 0),
      new THREE.Vector3(r, r, 0)
    );
    return geom.boundingBox;
  }
  geom.computeBoundingBox();
  return geom.boundingBox;
}

function isDynamicNode(node: THREE.Object3D): boolean {
  const u = node.userData as Record<string, unknown> | undefined;
  if (u?.isBifoldDoor === true || u?.isCarGate === true || u?.doorRole === 'pivot') {
    return true;
  }
  if (
    typeof u?.interactableId === 'string' &&
    (u.interactableId.startsWith('door-') ||
      u.interactableId.startsWith('door:') ||
      u.interactableId.startsWith('bifold-cupboard-'))
  ) {
    return true;
  }
  return typeof node.name === 'string' && /bifold|doorPivot/i.test(node.name);
}

function shouldSkipSubtree(node: THREE.Object3D): boolean {
  const u = node.userData as Record<string, unknown> | undefined;
  if (
    u?.isAnnotationGroup === true ||
    u?.isWeatherOverlay === true ||
    u?.isEnvironmentGround === true ||
    u?.isShadowPassHook === true ||
    u?.isLightGlowPool === true ||
    u?.isFittingFx === true ||
    u?.ignoreWalkthroughCollision === true ||
    u?.isClimbableLadder === true ||
    u?.collisionRole === 'ignore' ||
    u?.collisionRole === 'climbable' ||
    Boolean(u?.ufhZoneId)
  ) {
    return true;
  }
  const name = node.name;
  if (typeof name === 'string' && name.length > 0) {
    if (
      name.endsWith('.groundCeiling') ||
      name.endsWith('.roof') ||
      name.includes('turfMat') ||
      name.includes('ufh') ||
      name.includes('grapeVineCanopy') ||
      name.includes('dryStoneRelief') ||
      name.includes('climbingIvy') ||
      name.includes('wisteria') ||
      name.includes('oliveTree') ||
      name.includes('fiddleLeaf') ||
      name.includes('botanicalShrub')
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Handles automatic walkthrough door proximity detection, smooth Call-of-Duty-style
 * door auto-barging on contact/approach, 2D OBB furniture depenetration, and
 * 2m spatial-hash-indexed wall/cabinetry/door raycast collision.
 */
export class WalkthroughDoorBargeAndCollisionSolver {
  private readonly scene: THREE.Scene;
  private readonly onBargeWalkthroughDoor: WalkthroughDoorBargeHandler;
  private readonly onProximityBargeDoors: WalkthroughProximityDoorBargeHandler;
  private readonly onDoorBarged: () => void;
  private readonly hooks: HouseWalkthroughHooks;
  private readonly getRoomMinYAt: WalkthroughRoomMinYSampler;

  private cachedObstacles: CachedObstacle[] | null = null;
  private dynamicObstacles: CachedObstacle[] = [];
  private cachedFurnitureBoxes: CachedFurnitureBox[] = [];
  private cachedDoorways: CachedDoorwayOpening[] = [];
  private readonly staticObstacleGrid = new Map<number, CachedObstacle[]>();
  private readonly furnitureGrid = new Map<number, CachedFurnitureBox[]>();
  private queryStamp = 0;
  private readonly queryFurnitureScratch: CachedFurnitureBox[] = [];
  private readonly nearbyObstacleMeshes: THREE.Object3D[] = [];
  private readonly tmpBox = new THREE.Box3();
  private readonly tmpCorner = new THREE.Vector3();
  private readonly tmpOrigin = new THREE.Vector3();
  private readonly tmpNormal = new THREE.Vector3();
  private readonly tmpRayDir = new THREE.Vector3();
  private readonly tmpPushDir = new THREE.Vector3();
  private readonly tmpHitNormal1 = new THREE.Vector3();
  private readonly tmpHitNormal2 = new THREE.Vector3();
  private readonly tmpSlideDir = new THREE.Vector3();
  private readonly wallRaycaster = new THREE.Raycaster();
  private lastMovedDistance = 0;

  public constructor(options: {
    readonly scene: THREE.Scene;
    readonly onBargeWalkthroughDoor: WalkthroughDoorBargeHandler;
    readonly onProximityBargeDoors: WalkthroughProximityDoorBargeHandler;
    readonly onDoorBarged: () => void;
    /** Per-house collision, elevation and stair rules; omitted for a flat, hook-free house. */
    readonly hooks?: HouseWalkthroughHooks;
    readonly getRoomMinYAt?: WalkthroughRoomMinYSampler;
  }) {
    this.hooks = options.hooks ?? NO_HOUSE_HOOKS;
    this.getRoomMinYAt = options.getRoomMinYAt ?? (() => null);
    this.scene = options.scene;
    this.onBargeWalkthroughDoor = options.onBargeWalkthroughDoor;
    this.onProximityBargeDoors = options.onProximityBargeDoors;
    this.onDoorBarged = options.onDoorBarged;
    this.wallRaycaster.near = 0.02;
    this.wallRaycaster.far = 0.55;
  }

  private sampleElevation(x: number, refFootY: number, z: number): number {
    const hooks = this.hooks;
    return hooks.sampleWalkableElevation
      ? hooks.sampleWalkableElevation(x, refFootY, z, this.getRoomMinYAt)
      : sampleGenericWalkableElevation(x, refFootY, z, this.getRoomMinYAt, hooks.sampleTerrainY);
  }

  private resolveCollisionMeshRule(mesh: THREE.Mesh): WalkthroughCollisionMeshRule | null {
    const houseRule = this.hooks.classifyCollisionMesh?.(mesh) ?? null;
    const u = mesh.userData as Record<string, unknown> | undefined;
    if (u?.collisionRole === 'ignore' || u?.ignoreWalkthroughCollision === true) {
      return { ignore: true };
    }
    if (u?.collisionRole === 'solidPlane' || u?.isWalkthroughSolidPlane === true) {
      return houseRule ? { ...houseRule, solidPlane: true } : SOLID_PLANE_RULE;
    }
    return houseRule;
  }

  private nextVisitStamp(): number {
    this.queryStamp = (this.queryStamp + 1) | 0;
    if (this.queryStamp <= 0) {
      this.queryStamp = 1;
      if (this.cachedObstacles) {
        for (let i = 0; i < this.cachedObstacles.length; i++) {
          this.cachedObstacles[i]!.visitStamp = 0;
        }
      }
      for (let i = 0; i < this.cachedFurnitureBoxes.length; i++) {
        this.cachedFurnitureBoxes[i]!.visitStamp = 0;
      }
    }
    return this.queryStamp;
  }

  public getSpatialGridStats(): {
    readonly obstacleCells: number;
    readonly furnitureCells: number;
    readonly obstacleCount: number;
    readonly furnitureCount: number;
  } {
    this.getObstacleCache();
    return {
      obstacleCells: this.staticObstacleGrid.size,
      furnitureCells: this.furnitureGrid.size,
      obstacleCount: this.cachedObstacles?.length ?? 0,
      furnitureCount: this.cachedFurnitureBoxes.length,
    };
  }

  public invalidateObstacleCache(): void {
    if (this.cachedObstacles === null) return;
    // Keep pre-batch obstacle cache intact if already built from unbatched meshes
  }

  private hasDetachedStaticBatches(): boolean {
    if (this.cachedObstacles && this.cachedObstacles.some((obs) => obs.mesh.parent === null)) {
      return true;
    }
    let foundBatched = false;
    this.scene.traverse((obj) => {
      if (obj.userData?.isBatchedStaticMesh === true) {
        foundBatched = true;
      }
    });
    return foundBatched;
  }

  public captureFurnitureColliders(): void {
    if (
      this.cachedObstacles !== null &&
      this.cachedObstacles.length > 0 &&
      this.hasDetachedStaticBatches()
    ) {
      return;
    }
    this.cachedFurnitureBoxes = [];
    this.cachedObstacles = null;
    this.dynamicObstacles = [];
    this.cachedDoorways = [];
    this.staticObstacleGrid.clear();
    this.furnitureGrid.clear();
    this.getObstacleCache();
  }

  private collectNearbyFurniture(
    x: number,
    z: number,
    reach: number
  ): readonly CachedFurnitureBox[] {
    const out = this.queryFurnitureScratch;
    out.length = 0;
    const stamp = this.nextVisitStamp();
    const minCx = Math.floor((x - reach) * INV_SPATIAL_CELL_SIZE);
    const maxCx = Math.floor((x + reach) * INV_SPATIAL_CELL_SIZE);
    const minCz = Math.floor((z - reach) * INV_SPATIAL_CELL_SIZE);
    const maxCz = Math.floor((z + reach) * INV_SPATIAL_CELL_SIZE);
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const bucket = this.furnitureGrid.get(spatialCellKey(cx, cz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const item = bucket[i]!;
          if (item.visitStamp !== stamp) {
            item.visitStamp = stamp;
            out.push(item);
          }
        }
      }
    }
    return out;
  }

  public checkProximityDoorBarge(
    footPos: THREE.Vector3,
    moveDirX: number,
    moveDirZ: number,
    isSprinting: boolean
  ): boolean {
    const barged = this.onProximityBargeDoors(
      footPos.x,
      footPos.y,
      footPos.z,
      moveDirX,
      moveDirZ,
      isSprinting
    );
    if (barged) this.onDoorBarged();
    return barged;
  }

  private findHitInteractableId(hitObject: THREE.Object3D): string | undefined {
    let curObj: THREE.Object3D | null = hitObject;
    while (curObj && curObj !== this.scene) {
      const uid = (curObj.userData as Record<string, unknown> | undefined)?.interactableId;
      if (typeof uid === 'string') return uid;
      curObj = curObj.parent;
    }
    return undefined;
  }

  private tryBargeHitDoor(
    hitObject: THREE.Object3D,
    allowDoorBarge: boolean,
    isSprinting: boolean,
    fromFoot: THREE.Vector3,
    moveDirXZ: THREE.Vector3
  ): boolean {
    if (!allowDoorBarge) return false;
    const interactableId = this.findHitInteractableId(hitObject);
    if (!interactableId) return false;
    const barged = this.onBargeWalkthroughDoor(
      interactableId,
      isSprinting,
      fromFoot.x,
      fromFoot.y,
      fromFoot.z,
      moveDirXZ.x,
      moveDirXZ.z
    );
    if (barged) this.onDoorBarged();
    return barged;
  }

  public depenetrateFootPosition(footPos: THREE.Vector3, currentEyeHeight: number): void {
    if (this.hooks.shouldSkipDepenetration?.(footPos) === true) return;
    this.getObstacleCache();
    const furnMinY = footPos.y + 0.25;
    const furnMaxY = footPos.y + Math.max(currentEyeHeight, STANDING_EYE_HEIGHT) + 0.108;
    const furnPad = 0.2;
    const furnPadSq = furnPad * furnPad;

    for (let iter = 0; iter < 2; iter++) {
      let pushed = false;
      const candidates = this.collectNearbyFurniture(footPos.x, footPos.z, furnPad + 0.35);
      for (let i = 0; i < candidates.length; i++) {
        const f = candidates[i]!;
        if (f.maxY <= furnMinY || f.minY >= furnMaxY) continue;
        const dx = f.centerX - footPos.x;
        const dz = f.centerZ - footPos.z;
        const maxDist = f.radiusXZ + furnPad + 0.15;
        if (dx * dx + dz * dz > maxDist * maxDist) continue;
        const visTarget = f.mesh.parent ? f.mesh : f.visibilityNode;
        if (!isColliderVisibleInHierarchy(visTarget)) continue;

        const vx = -f.uz;
        const vz = f.ux;
        const curU = footPos.x * f.ux + footPos.z * f.uz;
        const curV = footPos.x * vx + footPos.z * vz;
        const clampedU = Math.max(f.minU, Math.min(f.maxU, curU));
        const clampedV = Math.max(f.minV, Math.min(f.maxV, curV));
        const du = curU - clampedU;
        const dv = curV - clampedV;
        const distSq = du * du + dv * dv;
        if (distSq >= furnPadSq) continue;

        let targetU = curU;
        let targetV = curV;
        if (distSq > 1e-6) {
          const dist = Math.sqrt(distSq);
          const push = furnPad - dist + 0.005;
          targetU += (du / dist) * push;
          targetV += (dv / dist) * push;
        } else {
          const dMinU = curU - (f.minU - furnPad);
          const dMaxU = f.maxU + furnPad - curU;
          const dMinV = curV - (f.minV - furnPad);
          const dMaxV = f.maxV + furnPad - curV;
          const minD = Math.min(dMinU, dMaxU, dMinV, dMaxV);
          if (minD === dMinU) targetU = f.minU - furnPad - 0.005;
          else if (minD === dMaxU) targetU = f.maxU + furnPad + 0.005;
          else if (minD === dMinV) targetV = f.minV - furnPad - 0.005;
          else targetV = f.maxV + furnPad + 0.005;
        }

        const nextX = targetU * f.ux + targetV * vx;
        const nextZ = targetU * f.uz + targetV * vz;
        const pushDir = this.tmpPushDir.set(nextX - footPos.x, 0, nextZ - footPos.z);
        const pushLen = pushDir.length();
        if (pushLen > 1e-4) {
          pushDir.divideScalar(pushLen);
          if (
            !this.isBlockedByWallOrCabinet(footPos, pushDir, pushLen, currentEyeHeight, false, false)
          ) {
            footPos.x = nextX;
            footPos.z = nextZ;
            pushed = true;
          }
        }
      }
      if (!pushed) break;
    }
  }

  public ensureFootPositionUnblocked(footPos: THREE.Vector3, currentEyeHeight: number): void {
    this.depenetrateFootPosition(footPos, currentEyeHeight);
    let blockedCount = 0;
    for (let i = 0; i < CARDINAL_DIRS.length; i++) {
      if (this.isBlockedByWallOrCabinet(footPos, CARDINAL_DIRS[i]!, 0.32, currentEyeHeight, false, false)) {
        blockedCount++;
      }
    }
    if (blockedCount >= 2) {
      const bestSpawn = findNearestWalkthroughSpawn(
        footPos.x,
        footPos.y,
        footPos.z,
        this.hooks.spawns
      );
      if (bestSpawn) {
        footPos.set(bestSpawn.position[0], bestSpawn.position[1], bestSpawn.position[2]);
        footPos.y = this.sampleElevation(footPos.x, footPos.y, footPos.z);
      }
    }
  }

  private indexObstacleIntoGrid(obs: CachedObstacle): void {
    const minCx = Math.floor((obs.centerX - obs.radiusXZ) * INV_SPATIAL_CELL_SIZE);
    const maxCx = Math.floor((obs.centerX + obs.radiusXZ) * INV_SPATIAL_CELL_SIZE);
    const minCz = Math.floor((obs.centerZ - obs.radiusXZ) * INV_SPATIAL_CELL_SIZE);
    const maxCz = Math.floor((obs.centerZ + obs.radiusXZ) * INV_SPATIAL_CELL_SIZE);
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const key = spatialCellKey(cx, cz);
        let bucket = this.staticObstacleGrid.get(key);
        if (!bucket) {
          bucket = [];
          this.staticObstacleGrid.set(key, bucket);
        }
        bucket.push(obs);
      }
    }
  }

  private indexFurnitureIntoGrid(furn: CachedFurnitureBox): void {
    const minCx = Math.floor((furn.centerX - furn.radiusXZ) * INV_SPATIAL_CELL_SIZE);
    const maxCx = Math.floor((furn.centerX + furn.radiusXZ) * INV_SPATIAL_CELL_SIZE);
    const minCz = Math.floor((furn.centerZ - furn.radiusXZ) * INV_SPATIAL_CELL_SIZE);
    const maxCz = Math.floor((furn.centerZ + furn.radiusXZ) * INV_SPATIAL_CELL_SIZE);
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const key = spatialCellKey(cx, cz);
        let bucket = this.furnitureGrid.get(key);
        if (!bucket) {
          bucket = [];
          this.furnitureGrid.set(key, bucket);
        }
        bucket.push(furn);
      }
    }
  }

  public getObstacleCache(): readonly CachedObstacle[] {
    if (this.cachedObstacles !== null) return this.cachedObstacles;
    const list: CachedObstacle[] = [];
    const dynList: CachedObstacle[] = [];
    const furnitureList: CachedFurnitureBox[] = [];
    const doorwayList: CachedDoorwayOpening[] = [];
    const rebuildFurniture = this.cachedFurnitureBoxes.length === 0;
    this.staticObstacleGrid.clear();
    if (rebuildFurniture) {
      this.furnitureGrid.clear();
    }
    this.scene.updateMatrixWorld();

    const emitCompositeGroupObb = (groupNode: THREE.Object3D, insetPad = 0): void => {
      if (!rebuildFurniture) return;
      const me = groupNode.matrixWorld.elements;
      const lenAx = Math.hypot(me[0]!, me[2]!);
      const lenAz = Math.hypot(me[8]!, me[10]!);
      let ux = 1;
      let uz = 0;
      if (lenAx >= lenAz && lenAx > 1e-4) {
        ux = me[0]! / lenAx;
        uz = me[2]! / lenAx;
      } else if (lenAz > 1e-4) {
        ux = me[8]! / lenAz;
        uz = me[10]! / lenAz;
      }
      const vx = -uz;
      const vz = ux;

      let minU = Number.POSITIVE_INFINITY;
      let maxU = Number.NEGATIVE_INFINITY;
      let minV = Number.POSITIVE_INFINITY;
      let maxV = Number.NEGATIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      let firstMesh: THREE.Mesh | null = null;

      groupNode.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        if (child.name.endsWith('.contactShadow')) return;
        const gBox = ensureGeometryBoundingBoxFast(child.geometry);
        if (!gBox || gBox.isEmpty()) return;
        if (!firstMesh) firstMesh = child;
        for (let cxIdx = 0; cxIdx < 2; cxIdx++) {
          const lx = cxIdx === 0 ? gBox.min.x : gBox.max.x;
          for (let cyIdx = 0; cyIdx < 2; cyIdx++) {
            const ly = cyIdx === 0 ? gBox.min.y : gBox.max.y;
            for (let czIdx = 0; czIdx < 2; czIdx++) {
              const lz = czIdx === 0 ? gBox.min.z : gBox.max.z;
              this.tmpCorner.set(lx, ly, lz).applyMatrix4(child.matrixWorld);
              const uCoord = this.tmpCorner.x * ux + this.tmpCorner.z * uz;
              const vCoord = this.tmpCorner.x * vx + this.tmpCorner.z * vz;
              if (uCoord < minU) minU = uCoord;
              if (uCoord > maxU) maxU = uCoord;
              if (vCoord < minV) minV = vCoord;
              if (vCoord > maxV) maxV = vCoord;
              if (this.tmpCorner.y < minY) minY = this.tmpCorner.y;
              if (this.tmpCorner.y > maxY) maxY = this.tmpCorner.y;
            }
          }
        }
      });

      if (!firstMesh || !Number.isFinite(minU) || !Number.isFinite(minV)) return;
      minU += insetPad;
      maxU -= insetPad;
      minV += insetPad;
      maxV -= insetPad;
      if (maxU <= minU || maxV <= minV) return;
      const midU = (minU + maxU) * 0.5;
      const midV = (minV + maxV) * 0.5;
      const centerX = midU * ux + midV * vx;
      const centerZ = midU * uz + midV * vz;
      const uSpan = maxU - minU;
      const vSpan = maxV - minV;
      const furn: CachedFurnitureBox = {
        mesh: firstMesh,
        visibilityNode: groupNode,
        centerX,
        centerZ,
        radiusXZ: Math.hypot(uSpan, vSpan) * 0.5,
        minY,
        maxY,
        ux,
        uz,
        minU,
        maxU,
        minV,
        maxV,
        visitStamp: 0,
      };
      furnitureList.push(furn);
      this.indexFurnitureIntoGrid(furn);
    };

    const recordDoorwayIfCandidate = (doorGroup: THREE.Object3D): void => {
      const pName = (doorGroup.name + ' ' + (doorGroup.children[0]?.name ?? '')).toLowerCase();
      if (
        /understairs|cupboard|larder|fridge|freezer|winecooler|wardrobe|barcabinet/.test(pName) ||
        this.hooks.isNonWalkthroughDoor?.(pName) === true
      ) {
        return;
      }
      this.tmpBox.setFromObject(doorGroup);
      if (this.tmpBox.isEmpty()) return;
      const h = this.tmpBox.max.y - this.tmpBox.min.y;
      if (h < 0.92 || h > 2.45) return;
      const centerX = (this.tmpBox.min.x + this.tmpBox.max.x) * 0.5;
      const centerZ = (this.tmpBox.min.z + this.tmpBox.max.z) * 0.5;
      const hingeX = doorGroup.matrixWorld.elements[12]!;
      const hingeZ = doorGroup.matrixWorld.elements[14]!;
      const dx = centerX - hingeX;
      const dz = centerZ - hingeZ;
      const distFromHinge = Math.hypot(dx, dz);
      const boxSpan = Math.max(
        this.tmpBox.max.x - this.tmpBox.min.x,
        this.tmpBox.max.z - this.tmpBox.min.z
      );
      const halfWidth = distFromHinge >= 0.18 ? distFromHinge : boxSpan * 0.5;
      if (halfWidth * 2 < 0.45) return;
      const tangentX = distFromHinge >= 1e-4 ? dx / distFromHinge : 1;
      const tangentZ = distFromHinge >= 1e-4 ? dz / distFromHinge : 0;
      doorwayList.push({
        centerX,
        centerZ,
        minY: this.tmpBox.min.y,
        maxY: this.tmpBox.max.y,
        tangentX,
        tangentZ,
        normalX: tangentZ,
        normalZ: -tangentX,
        halfWidth,
      });
    };

    const emitFlightBalustradeObbs = (flightGroup: THREE.Object3D): void => {
      if (!rebuildFurniture) return;
      for (const side of ['left', 'right'] as const) {
        const sideSuffix = `_${side}`;
        const sideMeshes: THREE.Mesh[] = [];
        for (let i = 0; i < flightGroup.children.length; i++) {
          const ch = flightGroup.children[i]!;
          const cName = typeof ch.name === 'string' ? ch.name : '';
          if (
            !cName.endsWith(sideSuffix) &&
            !cName.includes(`spindle_${side}_`) &&
            !cName.includes(`cutSpindle_${side}_`)
          ) {
            continue;
          }
          if (
            /handrail_|shoeRail_|footNewel_|topNewel_|spindle_|cutSpindle_|understairsCupboardSpandrel_/.test(
              cName
            )
          ) {
            ch.traverse((m) => {
              if (m instanceof THREE.Mesh) sideMeshes.push(m);
            });
          }
        }
        if (sideMeshes.length === 0) continue;

        const me = flightGroup.matrixWorld.elements;
        const lenAx = Math.hypot(me[0]!, me[2]!);
        const lenAz = Math.hypot(me[8]!, me[10]!);
        let ux = 1;
        let uz = 0;
        if (lenAx >= lenAz && lenAx > 1e-4) {
          ux = me[0]! / lenAx;
          uz = me[2]! / lenAx;
        } else if (lenAz > 1e-4) {
          ux = me[8]! / lenAz;
          ux = me[8]! / lenAz;
          uz = me[10]! / lenAz;
        }
        const vx = -uz;
        const vz = ux;

        let minU = Number.POSITIVE_INFINITY;
        let maxU = Number.NEGATIVE_INFINITY;
        let minV = Number.POSITIVE_INFINITY;
        let maxV = Number.NEGATIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;

        for (let mIdx = 0; mIdx < sideMeshes.length; mIdx++) {
          const m = sideMeshes[mIdx]!;
          const gBox = ensureGeometryBoundingBoxFast(m.geometry);
          if (!gBox || gBox.isEmpty()) continue;
          for (let cxIdx = 0; cxIdx < 2; cxIdx++) {
            const lx = cxIdx === 0 ? gBox.min.x : gBox.max.x;
            for (let cyIdx = 0; cyIdx < 2; cyIdx++) {
              const ly = cyIdx === 0 ? gBox.min.y : gBox.max.y;
              for (let czIdx = 0; czIdx < 2; czIdx++) {
                const lz = czIdx === 0 ? gBox.min.z : gBox.max.z;
                this.tmpCorner.set(lx, ly, lz).applyMatrix4(m.matrixWorld);
                const uCoord = this.tmpCorner.x * ux + this.tmpCorner.z * uz;
                const vCoord = this.tmpCorner.x * vx + this.tmpCorner.z * vz;
                if (uCoord < minU) minU = uCoord;
                if (uCoord > maxU) maxU = uCoord;
                if (vCoord < minV) minV = vCoord;
                if (vCoord > maxV) maxV = vCoord;
                if (this.tmpCorner.y < minY) minY = this.tmpCorner.y;
                if (this.tmpCorner.y > maxY) maxY = this.tmpCorner.y;
              }
            }
          }
        }
        if (!Number.isFinite(minU) || maxU <= minU || maxV <= minV) continue;
        const midU = (minU + maxU) * 0.5;
        const midV = (minV + maxV) * 0.5;
        const furn: CachedFurnitureBox = {
          mesh: sideMeshes[0]!,
          visibilityNode: flightGroup,
          centerX: midU * ux + midV * vx,
          centerZ: midU * uz + midV * vz,
          radiusXZ: Math.hypot(maxU - minU, maxV - minV) * 0.5,
          minY,
          maxY,
          ux,
          uz,
          minU,
          maxU,
          minV,
          maxV,
          visitStamp: 0,
        };
        furnitureList.push(furn);
        this.indexFurnitureIntoGrid(furn);
      }
    };

    const isBuiltInCompositeGroup = (node: THREE.Object3D): boolean => {
      if (node instanceof THREE.Mesh) return false;
      const n = typeof node.name === 'string' ? node.name : '';
      if (!n) return false;
      // createBalustradeRun segments & newel posts (blocks walking through open spindle gaps!)
      if (/\.segment_\d+$/.test(n) && node.children.some((c) => /handrail_|shoeRail_|spindle_/.test(c.name))) {
        return true;
      }
      // buildGeorgianBrickRailingsAndGate railing bays & masonry piers
      if (/\.(railingBay(?:Left|Right)?_\d+|(?:gate|end)?Pier(?:Left|Right)(?:_\d+)?)$/i.test(n)) {
        return true;
      }
      // Cast-iron column radiators (multi-column sub-meshes < 0.29m deep individually)
      if (/\.radiator\b|radiator$/i.test(n) && node.children.some((c) => /headerBarrel|sectionBoss|colTube/.test(c.name))) {
        return true;
      }
      // Double-sided / architectural fireplace assemblies (includes low open hearth plinth!)
      if (/fireplace\.assembly$/i.test(n)) {
        return true;
      }
      return false;
    };

    const visitNode = (
      node: THREE.Object3D,
      inheritedDynamic: boolean,
      inheritedShell: boolean,
      inheritedStaircase: boolean
    ): void => {
      if (
        node !== this.scene &&
        (shouldSkipSubtree(node) || this.hooks.shouldSkipCollisionSubtree?.(node) === true)
      ) {
        return;
      }

      const isRegisteredStair = node !== this.scene && getStaircaseWalkableSampler(node) !== undefined;
      const inStaircase = inheritedStaircase || isRegisteredStair;

      if (inStaircase && /^flight_\d+$/.test(node.name)) {
        emitFlightBalustradeObbs(node);
        return;
      }
      if (inStaircase && !isRegisteredStair) {
        // Inside a registered staircase: quarter-landing & walkable treads/risers/runner/rods/soffit
        // are handled by sampleWalkableElevation; only nested flight balustrades emit OBBs above.
        const children = node.children;
        for (let i = 0; i < children.length; i++) {
          visitNode(children[i]!, inheritedDynamic, inheritedShell, true);
        }
        return;
      }

      const compositeInset =
        this.hooks.getCompositeObbInset?.(node) ??
        (isBuiltInCompositeGroup(node) ? 0 : null);
      if (compositeInset !== null) {
        emitCompositeGroupObb(node, compositeInset);
        return;
      }

      const u = node.userData as Record<string, unknown> | undefined;
      if (
        !inheritedDynamic &&
        typeof u?.interactableId === 'string' &&
        (u.interactableId.startsWith('door-') || u.interactableId.startsWith('door:'))
      ) {
        recordDoorwayIfCandidate(node);
      }

      const hasDynamic = inheritedDynamic || (node !== this.scene && isDynamicNode(node));
      const hasShell =
        inheritedShell ||
        u?.isArchitecturalShell === true ||
        u?.isCutawayWall === true ||
        Boolean(u?.cutawayWall);

      if (
        node instanceof THREE.Mesh &&
        !(node instanceof THREE.InstancedMesh) &&
        !u?.circuitId &&
        u?.isMergedSourceMesh !== true &&
        u?.isBatchedStaticMesh !== true &&
        u?.skipWalkthroughObstacle !== true &&
        u?.ignoreWalkthroughCollision !== true
      ) {
        const rule = this.resolveCollisionMeshRule(node);
        if (!(node.geometry instanceof THREE.PlaneGeometry) || rule?.solidPlane === true) {
          this.processCandidateMesh(
            node,
            rule,
            hasDynamic,
            hasShell,
            rebuildFurniture,
            list,
            dynList,
            furnitureList
          );
        }
      }

      const children = node.children;
      for (let i = 0; i < children.length; i++) {
        visitNode(children[i]!, hasDynamic, hasShell, inStaircase);
      }
    };

    visitNode(this.scene, false, false, false);

    this.cachedObstacles = list;
    this.dynamicObstacles = dynList;
    this.cachedDoorways = doorwayList;
    if (rebuildFurniture) this.cachedFurnitureBoxes = furnitureList;
    return list;
  }

  private processCandidateMesh(
    obj: THREE.Mesh,
    rule: WalkthroughCollisionMeshRule | null,
    hasDynamicAncestor: boolean,
    hasArchitecturalShellAncestor: boolean,
    rebuildFurniture: boolean,
    list: CachedObstacle[],
    dynList: CachedObstacle[],
    furnitureList: CachedFurnitureBox[]
  ): void {
    const name = obj.name;
    if (rule?.ignore === true) return;
    if (
      typeof name === 'string' &&
      (name.includes('turfMat') || /romanBlind|thresholdStep/i.test(name))
    ) {
      return;
    }

    const u = obj.userData as Record<string, unknown> | undefined;
    const parentName = obj.parent?.name ?? '';
    const fullName = typeof name === 'string' ? `${parentName} ${name}` : parentName;
    if (
      u?.isFloorSlab === true ||
      u?.walkableSurface === true ||
      u?.collisionRole === 'walkable' ||
      /\.(slab|finish|deck|ceiling)$|threshold|yorkstoneLowerStep|yorkstoneUpperLanding|frenchDoorLowerStep|frenchDoorUpperStep|pool\.water|waterSurface|skirting|cornice|coving|pictureRail|dado|architrave/i.test(
        fullName
      )
    ) {
      return;
    }

    const isBlindOrCurtain = typeof name === 'string' && /curtain/i.test(name);
    const isSolidPlane = rule?.solidPlane === true;
    const isThinBarrier =
      rule?.thinBarrier === true ||
      (typeof name === 'string' &&
        (name.includes('.picketFence.') ||
          name.includes('.picketGate.') ||
          /yewHedge|hedge|fence|parapet|retainingWall/i.test(fullName)));
    const isForcedSolid = rule?.solid === true;
    const forcedFurnitureHeadroomM = rule?.forceFurnitureHeadroomM;
    const isForcedFurniture = forcedFurnitureHeadroomM !== undefined;

    const mat = obj.material;
    const isTransparentGlassMat = Array.isArray(mat)
      ? mat.some(
          (m) =>
            Boolean((m as THREE.Material & { transparent?: boolean }).transparent) &&
            ((m as THREE.Material & { opacity?: number }).opacity ?? 1) <= 0.5
        )
      : Boolean(
          (mat as THREE.Material & { transparent?: boolean })?.transparent &&
            ((mat as THREE.Material & { opacity?: number })?.opacity ?? 1) <= 0.5
        );

    const isDoorFrameOrJamb =
      typeof name === 'string' &&
      (name.includes('.doorFrame') ||
        name.includes('.sill') ||
        /\.(jamb|head|casing|stop|horn)(?:_|$)/i.test(name));

    const isWalkableOrFoliage =
      rule?.noFurniture === true ||
      (typeof name === 'string' &&
        (name.includes('.botanical') ||
          name.includes('trailingSpray') ||
          name.includes('cropMound') ||
          name.includes('vineClimber') ||
          /terrace|patio|walkway|footway|lawn|gravel|driveway|catwalk|bridgePad/i.test(fullName)));

    const isFloorRugOrSill =
      typeof name === 'string' &&
      /rug|runner|tiledFloor|thresholdSill|doorThresholdTile|doorThresholdStrip|carpet|bathMat|doormat|coirMat|romanBlind|window[XZ]?\\.\\d+\\.(glass|rail)/i.test(
        fullName
      );

    // Extruded BufferGeometry walls/partitions (e.g. extrudePlanarSolidWithHoles), hedges, and
    // sculpted furniture/sanitaryware are all eligible candidates!
    const isExtrudedOrSolidMesh =
      !isWalkableOrFoliage && !isFloorRugOrSill && !isDoorFrameOrJamb;

    const mayBeObstacle =
      isBlindOrCurtain ||
      isSolidPlane ||
      isThinBarrier ||
      isForcedSolid ||
      (!hasDynamicAncestor && isTransparentGlassMat) ||
      hasDynamicAncestor ||
      obj.geometry instanceof THREE.BoxGeometry ||
      hasArchitecturalShellAncestor ||
      isExtrudedOrSolidMesh;

    const mayBeFurniture =
      rebuildFurniture &&
      (isForcedFurniture ||
        (!isWalkableOrFoliage &&
          !isFloorRugOrSill &&
          !isThinBarrier &&
          !hasDynamicAncestor &&
          !isDoorFrameOrJamb));

    if (!mayBeObstacle && !mayBeFurniture) {
      return;
    }
    const footprint = this.hooks.collisionFootprint;
    if (footprint && !hasArchitecturalShellAncestor && !hasDynamicAncestor) {
      const me = obj.matrixWorld.elements;
      const wx = me[12]!;
      const wz = me[14]!;
      if (
        wx < footprint.minX ||
        wx > footprint.maxX ||
        wz < footprint.minZ ||
        wz > footprint.maxZ
      ) {
        return;
      }
    }

    const geomBox = ensureGeometryBoundingBoxFast(obj.geometry);
    if (!geomBox || geomBox.isEmpty()) return;
    this.tmpBox.copy(geomBox).applyMatrix4(obj.matrixWorld);
    if (this.tmpBox.isEmpty()) return;

    const sizeX = this.tmpBox.max.x - this.tmpBox.min.x;
    const sizeY = this.tmpBox.max.y - this.tmpBox.min.y;
    const sizeZ = this.tmpBox.max.z - this.tmpBox.min.z;
    const centerX = (this.tmpBox.min.x + this.tmpBox.max.x) * 0.5;
    const centerZ = (this.tmpBox.min.z + this.tmpBox.max.z) * 0.5;
    const radiusXZ = Math.hypot(sizeX, sizeZ) * 0.5;

    // Horizontal solidPlane slabs/steps (sizeY < 0.42 && min(sizeX, sizeZ) > 0.35) are walkable
    // surfaces for elevation sampling, NOT horizontal blocking walls!
    if (isSolidPlane && !isForcedSolid && sizeY < 0.42 && Math.min(sizeX, sizeZ) > 0.35) {
      return;
    }

    const isWindowGlass =
      !hasDynamicAncestor &&
      isTransparentGlassMat &&
      sizeY >= 0.45 &&
      Math.min(sizeX, sizeZ) <= 0.16 &&
      Math.max(sizeX, sizeZ) >= 0.35;

    const isExtrudedWallOrBarrier =
      isExtrudedOrSolidMesh &&
      !(obj.geometry instanceof THREE.BoxGeometry) &&
      sizeY >= 0.55 &&
      Math.max(sizeX, sizeZ) >= 0.32 &&
      (Math.min(sizeX, sizeZ) <= 0.85 || /hedge|wall|partition|divider|core|island|counter|vanity|tub|bath|wc|toilet|wardrobe/i.test(fullName));

    const isBoxOrShellWall =
      isBlindOrCurtain ||
      isSolidPlane ||
      isThinBarrier ||
      isForcedSolid ||
      isWindowGlass ||
      hasDynamicAncestor ||
      obj.geometry instanceof THREE.BoxGeometry ||
      hasArchitecturalShellAncestor ||
      isExtrudedWallOrBarrier;

    const validObstacleSpan =
      Math.max(sizeX, sizeZ) >= 0.32 ||
      (sizeY >= 0.85 && Math.max(sizeX, sizeZ) >= 0.04) ||
      (isThinBarrier && sizeY >= 0.45 && Math.max(sizeX, sizeZ) >= 0.04) ||
      (hasDynamicAncestor &&
        ((sizeY >= 0.45 && Math.max(sizeX, sizeZ) >= 0.014) ||
          (sizeY >= 0.012 && Math.max(sizeX, sizeZ) >= 0.28)));

    const validObstacleHeight =
      sizeY >= 0.45 ||
      (isBlindOrCurtain && sizeY >= 0.25) ||
      (isThinBarrier && sizeY >= 0.04 && Math.max(sizeX, sizeZ) >= 0.32) ||
      (hasDynamicAncestor && sizeY >= 0.012 && Math.max(sizeX, sizeZ) >= 0.28);

    if (
      isBoxOrShellWall &&
      validObstacleHeight &&
      validObstacleSpan &&
      (isSolidPlane || hasDynamicAncestor || Math.min(sizeX, sizeZ) >= 0.008) &&
      Math.max(sizeX, sizeZ) <= 28.0
    ) {
      const obs: CachedObstacle = {
        mesh: obj,
        visibilityNode: obj.parent ?? obj,
        localBox: geomBox.clone(),
        centerX,
        centerZ,
        radiusXZ,
        minY: this.tmpBox.min.y,
        maxY: this.tmpBox.max.y,
        isDynamic: hasDynamicAncestor,
        visitStamp: 0,
      };
      accelerateStaticMeshRaycast(obj, 64);
      prebuildGeometryBvh(obj.geometry, 64);
      list.push(obs);
      if (hasDynamicAncestor) {
        dynList.push(obs);
      } else {
        this.indexObstacleIntoGrid(obs);
      }
    }

    if (mayBeFurniture && Math.max(sizeX, sizeZ) <= 5.8) {
      const floorY = this.sampleElevation(centerX, this.tmpBox.min.y + 0.12, centerZ);
      const effectiveMaxY = this.tmpBox.max.y + (forcedFurnitureHeadroomM ?? 0);
      const topAboveFloor = effectiveMaxY - floorY;
      const botAboveFloor = this.tmpBox.min.y - floorY;

      const isOverheadFixture =
        botAboveFloor >= 1.55 ||
        /pendant|chandelier|lantern|downlight|spotlight|ceilingRose/i.test(fullName);
      if (
        !isOverheadFixture &&
        (isForcedFurniture || !(sizeY <= 0.06 && topAboveFloor <= 0.09)) &&
        topAboveFloor >= 0.26 &&
        topAboveFloor <= 2.65 &&
        botAboveFloor <= 1.55
      ) {
        const m = obj.matrixWorld.elements;
        const lenAx = Math.hypot(m[0]!, m[2]!);
        const lenAz = Math.hypot(m[8]!, m[10]!);
        let ux = 1;
        let uz = 0;
        if (lenAx >= lenAz && lenAx > 1e-4) {
          ux = m[0]! / lenAx;
          uz = m[2]! / lenAx;
        } else if (lenAz > 1e-4) {
          ux = m[8]! / lenAz;
          uz = m[10]! / lenAz;
        }
        const vx = -uz;
        const vz = ux;

        let minU = Number.POSITIVE_INFINITY;
        let maxU = Number.NEGATIVE_INFINITY;
        let minV = Number.POSITIVE_INFINITY;
        let maxV = Number.NEGATIVE_INFINITY;

        for (let cxIdx = 0; cxIdx < 2; cxIdx++) {
          const lx = cxIdx === 0 ? geomBox.min.x : geomBox.max.x;
          for (let cyIdx = 0; cyIdx < 2; cyIdx++) {
            const ly = cyIdx === 0 ? geomBox.min.y : geomBox.max.y;
            for (let czIdx = 0; czIdx < 2; czIdx++) {
              const lz = czIdx === 0 ? geomBox.min.z : geomBox.max.z;
              this.tmpCorner.set(lx, ly, lz).applyMatrix4(obj.matrixWorld);
              const uCoord = this.tmpCorner.x * ux + this.tmpCorner.z * uz;
              const vCoord = this.tmpCorner.x * vx + this.tmpCorner.z * vz;
              if (uCoord < minU) minU = uCoord;
              if (uCoord > maxU) maxU = uCoord;
              if (vCoord < minV) minV = vCoord;
              if (vCoord > maxV) maxV = vCoord;
            }
          }
        }

        let uSpan = maxU - minU;
        let vSpan = maxV - minV;
        if (isBlindOrCurtain || isWindowGlass) {
          const padDepth = isWindowGlass ? 0.15 : 0.1;
          if (uSpan < vSpan) {
            minU -= padDepth;
            maxU += padDepth;
            uSpan = maxU - minU;
          } else {
            minV -= padDepth;
            maxV += padDepth;
            vSpan = maxV - minV;
          }
        }

        const validDimensions =
          isBlindOrCurtain || isWindowGlass
            ? Math.max(uSpan, vSpan) >= 0.32 && Math.max(uSpan, vSpan) <= 5.8
            : Math.min(uSpan, vSpan) >= 0.29 &&
              Math.max(uSpan, vSpan) >= 0.36 &&
              Math.max(uSpan, vSpan) <= 5.8;

        if (validDimensions) {
          const furn: CachedFurnitureBox = {
            mesh: obj,
            visibilityNode: obj.parent ?? obj,
            centerX,
            centerZ,
            radiusXZ: Math.max(radiusXZ, Math.hypot(uSpan, vSpan) * 0.5),
            minY: this.tmpBox.min.y,
            maxY: effectiveMaxY,
            ux,
            uz,
            minU,
            maxU,
            minV,
            maxV,
            visitStamp: 0,
          };
          furnitureList.push(furn);
          this.indexFurnitureIntoGrid(furn);
        }
      }
    }
  }

  public getLastMovedDistance(): number {
    return this.lastMovedDistance;
  }

  public isBlockedByWallOrCabinet(
    fromFoot: THREE.Vector3,
    moveDirXZ: THREE.Vector3,
    stepDist: number,
    currentEyeHeight: number,
    allowDoorBarge: boolean,
    isSprinting: boolean,
    outNormal?: THREE.Vector3
  ): boolean {
    if (outNormal) outNormal.set(0, 0, 0);
    const nextX = fromFoot.x + moveDirXZ.x * stepDist;
    const nextZ = fromFoot.z + moveDirXZ.z * stepDist;

    const boundsStatus =
      this.hooks.evaluateWalkwayBounds?.(fromFoot, nextX, nextZ) ?? 'check_obstacles';
    if (boundsStatus === 'blocked') return true;
    if (boundsStatus === 'clear') return false;

    this.getObstacleCache();
    const furnMinY = fromFoot.y + 0.25;
    const furnMaxY = fromFoot.y + Math.max(currentEyeHeight, STANDING_EYE_HEIGHT) + 0.108;
    const furnPad = 0.2;
    const furnPadSq = furnPad * furnPad;
    const furnReach = stepDist + furnPad + 0.25;

    const nearbyFurn = this.collectNearbyFurniture(fromFoot.x, fromFoot.z, furnReach);
    for (let i = 0; i < nearbyFurn.length; i++) {
      const f = nearbyFurn[i]!;
      if (f.maxY <= furnMinY || f.minY >= furnMaxY) continue;
      const dx = f.centerX - fromFoot.x;
      const dz = f.centerZ - fromFoot.z;
      const maxDist = f.radiusXZ + furnReach;
      if (dx * dx + dz * dz > maxDist * maxDist) continue;
      const visTarget = f.mesh.parent ? f.mesh : f.visibilityNode;
      if (!isColliderVisibleInHierarchy(visTarget)) continue;

      const vx = -f.uz;
      const vz = f.ux;
      const curU = fromFoot.x * f.ux + fromFoot.z * f.uz;
      const curV = fromFoot.x * vx + fromFoot.z * vz;
      const nextU = nextX * f.ux + nextZ * f.uz;
      const nextV = nextX * vx + nextZ * vz;

      const curDu = curU < f.minU ? f.minU - curU : curU > f.maxU ? curU - f.maxU : 0;
      const curDv = curV < f.minV ? f.minV - curV : curV > f.maxV ? curV - f.maxV : 0;
      const curDistSq = curDu * curDu + curDv * curDv;

      const nextDu = nextU < f.minU ? f.minU - nextU : nextU > f.maxU ? nextU - f.maxU : 0;
      const nextDv = nextV < f.minV ? f.minV - nextV : nextV > f.maxV ? nextV - f.maxV : 0;
      const nextDistSq = nextDu * nextDu + nextDv * nextDv;

      if (nextDistSq < furnPadSq) {
        let blockedByFurn = false;
        if (curDistSq >= furnPadSq || nextDistSq < curDistSq - 1e-5) {
          blockedByFurn = true;
        } else if (curDistSq === 0) {
          const midU = (f.minU + f.maxU) * 0.5;
          const midV = (f.minV + f.maxV) * 0.5;
          const curCenterSq = (curU - midU) ** 2 + (curV - midV) ** 2;
          const nextCenterSq = (nextU - midU) ** 2 + (nextV - midV) ** 2;
          if (nextCenterSq < curCenterSq) blockedByFurn = true;
        }
        if (blockedByFurn) {
          if (outNormal) {
            const clampedU = Math.max(f.minU, Math.min(f.maxU, nextU));
            const clampedV = Math.max(f.minV, Math.min(f.maxV, nextV));
            let ou = nextU - clampedU;
            let ov = nextV - clampedV;
            if (Math.hypot(ou, ov) < 1e-4) {
              const midU = (f.minU + f.maxU) * 0.5;
              const midV = (f.minV + f.maxV) * 0.5;
              ou = Math.abs(curU - midU) >= Math.abs(curV - midV) ? Math.sign(curU - midU) : 0;
              ov = ou === 0 ? Math.sign(curV - midV) || 1 : 0;
            }
            const nx = ou * f.ux + ov * vx;
            const nz = ou * f.uz + ov * vz;
            const nLen = Math.hypot(nx, nz);
            if (nLen > 1e-4) {
              outNormal.set(nx / nLen, 0, nz / nLen);
            }
          }
          return true;
        }
      }
    }

    this.nearbyObstacleMeshes.length = 0;
    const footMinY = fromFoot.y + 0.3;
    const footMaxY = fromFoot.y + Math.max(currentEyeHeight, STANDING_EYE_HEIGHT) + 0.108;
    const reach = stepDist + 0.72;
    const stamp = this.nextVisitStamp();

    const minCx = Math.floor((fromFoot.x - reach) * INV_SPATIAL_CELL_SIZE);
    const maxCx = Math.floor((fromFoot.x + reach) * INV_SPATIAL_CELL_SIZE);
    const minCz = Math.floor((fromFoot.z - reach) * INV_SPATIAL_CELL_SIZE);
    const maxCz = Math.floor((fromFoot.z + reach) * INV_SPATIAL_CELL_SIZE);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const bucket = this.staticObstacleGrid.get(spatialCellKey(cx, cz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const obs = bucket[i]!;
          if (obs.visitStamp === stamp) continue;
          obs.visitStamp = stamp;
          if (obs.maxY <= footMinY || obs.minY >= footMaxY) continue;
          const coarseDx = obs.centerX - fromFoot.x;
          const coarseDz = obs.centerZ - fromFoot.z;
          const coarseMaxDist = obs.radiusXZ + reach;
          if (coarseDx * coarseDx + coarseDz * coarseDz > coarseMaxDist * coarseMaxDist) continue;
          const visTarget = obs.mesh.parent ? obs.mesh : obs.visibilityNode;
          if (!isColliderVisibleInHierarchy(visTarget)) continue;
          this.nearbyObstacleMeshes.push(obs.mesh);
        }
      }
    }

    for (let i = 0; i < this.dynamicObstacles.length; i++) {
      const obs = this.dynamicObstacles[i]!;
      const coarseDx = obs.centerX - fromFoot.x;
      const coarseDz = obs.centerZ - fromFoot.z;
      const coarseMaxDist = obs.radiusXZ + reach + 1.4;
      if (coarseDx * coarseDx + coarseDz * coarseDz > coarseMaxDist * coarseMaxDist) continue;
      const visTarget = obs.mesh.parent ? obs.mesh : obs.visibilityNode;
      if (!isColliderVisibleInHierarchy(visTarget)) continue;

      if (!obs.mesh.parent) {
        obs.mesh.matrixWorld.multiplyMatrices(obs.visibilityNode.matrixWorld, obs.mesh.matrix);
      }
      this.tmpBox.copy(obs.localBox).applyMatrix4(obs.mesh.matrixWorld);
      obs.centerX = (this.tmpBox.min.x + this.tmpBox.max.x) * 0.5;
      obs.centerZ = (this.tmpBox.min.z + this.tmpBox.max.z) * 0.5;
      obs.minY = this.tmpBox.min.y;
      obs.maxY = this.tmpBox.max.y;
      if (obs.maxY <= footMinY || obs.minY >= footMaxY) continue;
      const dx = obs.centerX - fromFoot.x;
      const dz = obs.centerZ - fromFoot.z;
      const maxDist = obs.radiusXZ + reach;
      if (dx * dx + dz * dz > maxDist * maxDist) continue;
      this.nearbyObstacleMeshes.push(obs.mesh);
    }

    if (this.nearbyObstacleMeshes.length === 0) return false;

    const backOff = 0.08;
    const maxHitDist = stepDist + 0.34 + backOff;
    this.wallRaycaster.far = Math.max(0.42, maxHitDist + 0.04);
    const perpX = -moveDirXZ.z;
    const perpZ = moveDirXZ.x;
    const upperRayY = Math.min(1.28, Math.max(0.85, currentEyeHeight - 0.12));

    let inActiveDoorway = false;
    for (let dIdx = 0; dIdx < this.cachedDoorways.length; dIdx++) {
      const dw = this.cachedDoorways[dIdx]!;
      if (dw.maxY <= fromFoot.y + 0.25 || dw.minY >= fromFoot.y + 1.78) continue;
      const relX = fromFoot.x - dw.centerX;
      const relZ = fromFoot.z - dw.centerZ;
      const n = relX * dw.normalX + relZ * dw.normalZ;
      if (Math.abs(n) > 0.45) continue;
      const u = relX * dw.tangentX + relZ * dw.tangentZ;
      if (u >= -(dw.halfWidth - 0.06) && u <= dw.halfWidth + 0.06) {
        inActiveDoorway = true;
        break;
      }
    }
    const latWhisker = inActiveDoorway ? 0.11 : 0.15;

    let bestHitDist = Number.POSITIVE_INFINITY;
    let foundHit = false;

    for (const rayOffsetY of [0.52, upperRayY] as const) {
      for (const latOffset of [0, -latWhisker, latWhisker] as const) {
        this.tmpOrigin.set(
          fromFoot.x + perpX * latOffset - moveDirXZ.x * backOff,
          fromFoot.y + rayOffsetY,
          fromFoot.z + perpZ * latOffset - moveDirXZ.z * backOff
        );
        this.wallRaycaster.set(this.tmpOrigin, moveDirXZ);

        const hits = this.wallRaycaster.intersectObjects(this.nearbyObstacleMeshes, false);
        for (let i = 0; i < hits.length; i++) {
          const hit = hits[i]!;
          if (hit.distance >= 0.01 && hit.distance <= maxHitDist && hit.face) {
            if (this.tryBargeHitDoor(hit.object, allowDoorBarge, isSprinting, fromFoot, moveDirXZ)) {
              continue;
            }
            this.tmpNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
            if (Math.abs(this.tmpNormal.y) < 0.45) {
              const horizLen = Math.hypot(this.tmpNormal.x, this.tmpNormal.z);
              if (horizLen > 1e-4) {
                let nx = this.tmpNormal.x / horizLen;
                let nz = this.tmpNormal.z / horizLen;
                const dotMove = nx * moveDirXZ.x + nz * moveDirXZ.z;
                if (dotMove > 0.01) {
                  nx = -nx;
                  nz = -nz;
                }
                if (nx * moveDirXZ.x + nz * moveDirXZ.z < -0.01) {
                  if (!outNormal) return true;
                  if (hit.distance < bestHitDist) {
                    bestHitDist = hit.distance;
                    outNormal.set(nx, 0, nz);
                    foundHit = true;
                  }
                }
              }
            }
          }
        }
      }
    }

    // Capsule shoulder whisker rays (±26 deg) so sliding nearly parallel to a wall maintains capsule skin clearance
    if (!foundHit && !inActiveDoorway) {
      const cosA = 0.8988;
      const sinA = 0.4384;
      const shoulderMaxDist = stepDist + 0.29;
      this.wallRaycaster.far = shoulderMaxDist + 0.04;
      this.tmpOrigin.set(fromFoot.x, fromFoot.y + 0.52, fromFoot.z);
      for (const sign of [-1, 1] as const) {
        this.tmpRayDir.set(
          moveDirXZ.x * cosA - sign * moveDirXZ.z * sinA,
          0,
          moveDirXZ.x * sign * sinA + moveDirXZ.z * cosA
        );
        this.wallRaycaster.set(this.tmpOrigin, this.tmpRayDir);
        const hits = this.wallRaycaster.intersectObjects(this.nearbyObstacleMeshes, false);
        for (let i = 0; i < hits.length; i++) {
          const hit = hits[i]!;
          if (hit.distance >= 0.01 && hit.distance <= shoulderMaxDist && hit.face) {
            this.tmpNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
            if (Math.abs(this.tmpNormal.y) < 0.45) {
              const horizLen = Math.hypot(this.tmpNormal.x, this.tmpNormal.z);
              if (horizLen > 1e-4) {
                let nx = this.tmpNormal.x / horizLen;
                let nz = this.tmpNormal.z / horizLen;
                if (nx * this.tmpRayDir.x + nz * this.tmpRayDir.z > 0) {
                  nx = -nx;
                  nz = -nz;
                }
                if (nx * moveDirXZ.x + nz * moveDirXZ.z < -0.08) {
                  if (outNormal) outNormal.set(nx, 0, nz);
                  return true;
                }
              }
            }
          }
        }
      }
    }

    return foundHit;
  }

  public stepHorizontalMovement(
    footPos: THREE.Vector3,
    moveVec: THREE.Vector3,
    forwardInput: number,
    targetYawRad: number,
    stepDist: number,
    currentEyeHeight: number,
    isSprinting: boolean,
    dtSeconds: number
  ): number {
    const startX = footPos.x;
    const startZ = footPos.z;

    this.checkProximityDoorBarge(footPos, moveVec.x, moveVec.z, isSprinting);
    const hooks = this.hooks;
    const updatedYaw =
      hooks.applyHelicalStairGuidance?.(footPos, moveVec, forwardInput, targetYawRad, dtSeconds) ??
      targetYawRad;
    const preStairState =
      hooks.evaluateStairRiserState?.(footPos.x, footPos.y, footPos.z) ?? null;
    const stairHaulPulse = preStairState
      ? 0.92 + 0.22 * Math.sin(preStairState.riserIndex * Math.PI * 2 - Math.PI * 0.25)
      : 1.0;
    const effectiveStepDist = stepDist * stairHaulPulse;
    const primaryBlocked = this.isBlockedByWallOrCabinet(
      footPos,
      moveVec,
      effectiveStepDist,
      currentEyeHeight,
      true,
      isSprinting,
      this.tmpHitNormal1
    );
    if (!primaryBlocked) {
      footPos.x += moveVec.x * effectiveStepDist;
      footPos.z += moveVec.z * effectiveStepDist;
    } else if (this.tmpHitNormal1.lengthSq() > 0.5) {
      const n1x = this.tmpHitNormal1.x;
      const n1z = this.tmpHitNormal1.z;
      const inwardDot = moveVec.x * n1x + moveVec.z * n1z;
      if (inwardDot > -0.94 && inwardDot < 0) {
        const slideX = moveVec.x - inwardDot * n1x;
        const slideZ = moveVec.z - inwardDot * n1z;
        const slideMag = Math.hypot(slideX, slideZ);
        const wallFriction = 0.9;
        const slideStepDist = effectiveStepDist * slideMag * wallFriction;
        if (slideMag > 0.22 && slideStepDist > 1e-4) {
          this.tmpSlideDir.set(slideX / slideMag, 0, slideZ / slideMag);
          const secondBlocked = this.isBlockedByWallOrCabinet(
            footPos,
            this.tmpSlideDir,
            slideStepDist,
            currentEyeHeight,
            false,
            isSprinting,
            this.tmpHitNormal2
          );
          if (!secondBlocked) {
            footPos.x += this.tmpSlideDir.x * slideStepDist;
            footPos.z += this.tmpSlideDir.z * slideStepDist;
          }
        }
      }
    } else {
      const { projU, projV, slideU, slideV } = (
        hooks.computeWallSlideAxes ?? computeDefaultWallSlideAxes
      )(footPos.x, footPos.z, moveVec);
      if (
        Math.abs(projU) >= 0.34 &&
        !this.isBlockedByWallOrCabinet(
          footPos,
          slideU,
          Math.abs(projU) * effectiveStepDist * 0.9,
          currentEyeHeight,
          false,
          isSprinting
        )
      ) {
        footPos.x += slideU.x * Math.abs(projU) * effectiveStepDist * 0.9;
        footPos.z += slideU.z * Math.abs(projU) * effectiveStepDist * 0.9;
      } else if (
        Math.abs(projV) >= 0.34 &&
        !this.isBlockedByWallOrCabinet(
          footPos,
          slideV,
          Math.abs(projV) * effectiveStepDist * 0.9,
          currentEyeHeight,
          false,
          isSprinting
        )
      ) {
        footPos.x += slideV.x * Math.abs(projV) * effectiveStepDist * 0.9;
        footPos.z += slideV.z * Math.abs(projV) * effectiveStepDist * 0.9;
      }
    }
    this.depenetrateFootPosition(footPos, currentEyeHeight);
    this.lastMovedDistance = Math.hypot(footPos.x - startX, footPos.z - startZ);
    const targetFloorY = this.sampleElevation(footPos.x, footPos.y, footPos.z);
    const onStairsNow =
      preStairState !== null ||
      (hooks.evaluateStairRiserState?.(footPos.x, targetFloorY, footPos.z) ?? null) !== null;
    const elevRate = onStairsNow ? 26 : 15;
    footPos.y = THREE.MathUtils.lerp(footPos.y, targetFloorY, 1 - Math.exp(-elevRate * dtSeconds));
    return updatedYaw;
  }

  public stepGlideToTarget(
    footPos: THREE.Vector3,
    glideTargetFoot: THREE.Vector3,
    currentEyeHeight: number,
    dtSeconds: number
  ): { readonly nextGlideTarget: THREE.Vector3 | null; readonly bobDelta: number } {
    const toTarget = new THREE.Vector3(
      glideTargetFoot.x - footPos.x,
      0,
      glideTargetFoot.z - footPos.z
    );
    const dist = toTarget.length();
    if (dist < 0.08) {
      footPos.copy(glideTargetFoot);
      return { nextGlideTarget: null, bobDelta: 0 };
    }
    toTarget.divideScalar(dist);
    this.checkProximityDoorBarge(footPos, toTarget.x, toTarget.z, false);
    const step = Math.min(dist, WALK_SPEED_MPS * 1.25 * dtSeconds);
    if (this.isBlockedByWallOrCabinet(footPos, toTarget, step, currentEyeHeight, true, false)) {
      return { nextGlideTarget: null, bobDelta: 0 };
    }
    footPos.x += toTarget.x * step;
    footPos.z += toTarget.z * step;
    const targetFloorY = this.sampleElevation(footPos.x, footPos.y, footPos.z);
    footPos.y = THREE.MathUtils.lerp(footPos.y, targetFloorY, 1 - Math.exp(-15 * dtSeconds));
    return { nextGlideTarget: glideTargetFoot, bobDelta: dtSeconds * 8.5 };
  }
}
