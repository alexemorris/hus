import { isVariationHiddenInHierarchy } from "../util/object-utils.ts";
/**
 * Auto-composed first-person walkthrough elevation & stairwell void solver.
 *
 * Eliminates manual `walkthrough.sampleElevationY` / `sampleWalkableElevation` boilerplate for
 * multi-storey houses, split-level FFLs, exterior portico steps, terraces, and staircases while
 * keeping scene snapshots 100% untouched via `WeakMap` staircase registration.
 */
import * as THREE from 'three';
import type { RoomZoneLodRegistration } from '../../core/entities.ts';
import type { TerrainSurfaceSampler } from '../../core/geo/terrain-modifiers.ts';
import type { FloorDefinition } from '../../core/types/scene.ts';
import type { WalkthroughRoomMinYSampler } from './parts/walkthrough-spawns.ts';

export interface StairWalkableSampler {
  readonly bottomY: number;
  readonly topY: number;
  readonly voidOpeningXZ: readonly (readonly [number, number])[];
  readonly bounds: THREE.Box3;
  sampleWalkableY(worldX: number, worldZ: number): number | null;
  /** Optional staircase-local void polygon (`[lx, lz]`) so reparented/rotated groups transform accurately. */
  readonly voidLocalXZ?: readonly (readonly [number, number])[];
  /** Optional staircase-local walkable height sampler (`[lx, lz] -> localY | null`). */
  sampleLocalWalkableY?(localX: number, localZ: number): number | null;
}

const staircaseSamplerRegistry = new WeakMap<THREE.Object3D, StairWalkableSampler>();

/**
 * Associates a built staircase `THREE.Object3D` with its analytical walkable sampler and
 * stairwell void polygon in a side-table `WeakMap` (zero `userData` mutations).
 */
export function registerStaircaseWalkableSampler(
  group: THREE.Object3D,
  sampler: StairWalkableSampler
): void {
  staircaseSamplerRegistry.set(group, sampler);
}

/** Looks up a registered `StairWalkableSampler` for `obj`, if one was registered. */
export function getStaircaseWalkableSampler(
  obj: THREE.Object3D
): StairWalkableSampler | undefined {
  return staircaseSamplerRegistry.get(obj);
}

export interface IndexedStaircaseEntry {
  readonly group: THREE.Object3D;
  readonly sampler: StairWalkableSampler;
  readonly worldBottomY: number;
  readonly worldTopY: number;
  readonly worldVoidXZ: readonly (readonly [number, number])[];
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  sampleWorldY(worldX: number, worldZ: number): number | null;
}

interface WalkableTriangle {
  readonly visibilityNode: THREE.Object3D;
  readonly ax: number;
  readonly az: number;
  readonly bx: number;
  readonly bz: number;
  readonly cx: number;
  readonly cz: number;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly planeD: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export type TerrainElevationFn =
  | TerrainSurfaceSampler
  | ((x: number, z: number) => number)
  | undefined;

export interface AutoWalkthroughElevationComposerOptions {
  readonly floors: readonly FloorDefinition[];
  readonly getScene: () => THREE.Object3D | null | undefined;
  readonly terrainSampler?: TerrainElevationFn;
  readonly roomRegistrations?: readonly RoomZoneLodRegistration[];
  /**
   * Optional custom `(x, z, currentFootY)` override. If it returns a finite number, that elevation
   * is used directly; returning `null` or `undefined` falls back to the auto-composed solver.
   */
  readonly customSampler?: (
    x: number,
    z: number,
    currentFootY: number
  ) => number | null | undefined;
  /**
   * Optional legacy/full `HouseWalkthroughHooks.sampleWalkableElevation` hook. When provided,
   * delegates first so existing custom houses retain 100% identical behavior.
   */
  readonly customWalkableSampler?: (
    x: number,
    refFootY: number,
    z: number,
    getRoomMinYAt: WalkthroughRoomMinYSampler
  ) => number;
  /** Maximum vertical step-up height onto steps/thresholds/slabs (default `0.32 m`). */
  readonly maxStepUpM?: number;
}

export interface AutoWalkthroughElevationComposer {
  /** Evaluates walkable foot elevation at `(x, z)` given `currentFootY`. */
  sampleElevationY(
    x: number,
    z: number,
    currentFootY: number,
    getRoomMinYAt?: WalkthroughRoomMinYSampler
  ): number;
  /** Adapter matching `HouseWalkthroughHooks.sampleWalkableElevation`. */
  sampleWalkableElevation(
    x: number,
    refFootY: number,
    z: number,
    getRoomMinYAt: WalkthroughRoomMinYSampler
  ): number;
  /** Returns true when `(x, z)` lies inside a discovered stairwell void opening for `floorElevationY`. */
  isInsideUpperStairwellVoid(x: number, z: number, floorElevationY: number): boolean;
  /** Returns currently indexed staircases in the active scene. */
  getIndexedStaircases(): readonly IndexedStaircaseEntry[];
  /** Forces re-indexing on the next query. */
  invalidate(): void;
}

/** Max walkable top-surface slope (`15°`). */
const COS_MAX_WALKABLE_SLOPE = Math.cos((15 * Math.PI) / 180);
const CELL_SIZE_M = 1.0;
const INV_CELL_SIZE = 1 / CELL_SIZE_M;

const NON_WALKABLE_ANCESTOR_RE =
  /ceiling|roof|cornice|coving|ceilingRose|pendant|chandelier|downlight|sconce|wall|partition|skirting|dado|pictureRail|window|sash|architrave|lintel|balustrade|handrail|spindle|newel|fence|gate/i;

const WALKABLE_SURFACE_NAME_RE =
  /(?:^|[._-])(slab|floor|step|steps|tread|landing|terrace|patio|stoop|threshold|deck|decking|catwalk|bridge|walkway|walk|paving|footway|lawn|gravel|cobble|flagstone|driveway|path|showerTray|bathFloor)(?:$|[._A-Z0-9-])|[a-z0-9](Step|Steps|Tread|Landing|Terrace|Patio|Stoop|Threshold|Deck|Decking|Catwalk|Bridge|Walkway|Walk|Paving|Footway|Lawn|Gravel|Cobble|Flagstone|Driveway|ShowerTray|BathFloor)(?:$|[._A-Z0-9-])/i;

const WALKABLE_CONTAINER_NAME_RE =
  /(?:^|[._-])(slab|floor|terrace|patio|deck|decking|catwalk|bridge|walkway|driveway)(?:$|[._A-Z0-9-])|[a-z0-9](Slab|Floor|Terrace|Patio|Deck|Decking|Catwalk|Bridge|Walkway|Driveway)(?:$|[._A-Z0-9-])/i;

const FURNITURE_OR_FIXTURE_NAME_RE =
  /table|desk|chair|sofa|armchair|bed|mattress|pillow|duvet|wardrobe|cabinet|cupboard|carcass|worktop|island|counter|shelf|shelves|bookcase|dresser|sideboard|console|bench|stool|ottoman|tv|fridge|freezer|oven|cooker|range|sink|basin|washstand|toilet|wc|cistern|tub|radiator|towel|lamp|switch|socket|dimmer|rug|carpet|runner|mat\b/i;

export function pointInPolygonXZ(
  px: number,
  pz: number,
  poly: readonly (readonly [number, number])[]
): boolean {
  const n = poly.length;
  if (n < 3) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, zi] = poly[i]!;
    const [xj, zj] = poly[j]!;
    const intersect =
      zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distanceToSegmentXZ(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq <= 1e-12) return Math.hypot(px - ax, pz - az);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

function isStrictlyInsidePolygonXZ(
  px: number,
  pz: number,
  poly: readonly (readonly [number, number])[],
  insetEpsM = 0.015
): boolean {
  if (!pointInPolygonXZ(px, pz, poly)) return false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!;
    const [xj, zj] = poly[j]!;
    if (distanceToSegmentXZ(px, pz, xi, zi, xj, zj) < insetEpsM) {
      return false;
    }
  }
  return true;
}

function evaluateTerrain(sampler: TerrainElevationFn, x: number, z: number): number {
  if (!sampler) return 0;
  if (typeof sampler === 'function') return sampler(x, z);
  return sampler.sampleTerrainY(x, z);
}

function cellKey(cx: number, cz: number): number {
  return ((cx + 32768) << 16) | ((cz + 32768) & 0xffff);
}

function pointInTriangleXZ(
  px: number,
  pz: number,
  t: WalkableTriangle
): boolean {
  const tol = 1e-5;
  const c1 = (t.bx - t.ax) * (pz - t.az) - (t.bz - t.az) * (px - t.ax);
  const c2 = (t.cx - t.bx) * (pz - t.bz) - (t.cz - t.bz) * (px - t.bx);
  const c3 = (t.ax - t.cx) * (pz - t.cz) - (t.az - t.cz) * (px - t.cx);
  const hasNeg = c1 < -tol || c2 < -tol || c3 < -tol;
  const hasPos = c1 > tol || c2 > tol || c3 > tol;
  return !(hasNeg && hasPos);
}

/**
 * Discovers all `createStaircase` groups under `root` and resolves their world-space walkable
 * height samplers and stairwell void polygons.
 */
export function collectRegisteredStaircases(root: THREE.Object3D): IndexedStaircaseEntry[] {
  root.updateMatrixWorld(true);
  const entries: IndexedStaircaseEntry[] = [];
  const tmpVec = new THREE.Vector3();

  root.traverse((obj) => {
    const sampler = staircaseSamplerRegistry.get(obj);
    if (!sampler) return;

    const worldMat = obj.matrixWorld.clone();
    const invWorldMat = worldMat.clone().invert();
    const yOffset = worldMat.elements[13]!;
    const worldBottomY = sampler.bottomY + yOffset;
    const worldTopY = sampler.topY + yOffset;

    const worldVoidXZ: [number, number][] = sampler.voidLocalXZ
      ? sampler.voidLocalXZ.map(([lx, lz]) => {
          tmpVec.set(lx, 0, lz).applyMatrix4(worldMat);
          return [tmpVec.x, tmpVec.z];
        })
      : sampler.voidOpeningXZ.map(([wx, wz]) => [wx, wz]);

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (const [vx, vz] of worldVoidXZ) {
      if (vx < minX) minX = vx;
      if (vx > maxX) maxX = vx;
      if (vz < minZ) minZ = vz;
      if (vz > maxZ) maxZ = vz;
    }
    if (sampler.bounds && !sampler.bounds.isEmpty()) {
      for (const lx of [sampler.bounds.min.x, sampler.bounds.max.x]) {
        for (const ly of [sampler.bounds.min.y, sampler.bounds.max.y]) {
          for (const lz of [sampler.bounds.min.z, sampler.bounds.max.z]) {
            tmpVec.set(lx, ly, lz).applyMatrix4(worldMat);
            if (tmpVec.x < minX) minX = tmpVec.x;
            if (tmpVec.x > maxX) maxX = tmpVec.x;
            if (tmpVec.z < minZ) minZ = tmpVec.z;
            if (tmpVec.z > maxZ) maxZ = tmpVec.z;
          }
        }
      }
    }
    const worldBox = new THREE.Box3().setFromObject(obj);
    if (!worldBox.isEmpty()) {
      minX = Math.min(minX, worldBox.min.x);
      maxX = Math.max(maxX, worldBox.max.x);
      minZ = Math.min(minZ, worldBox.min.z);
      maxZ = Math.max(maxZ, worldBox.max.z);
    }

    const sampleLocal = sampler.sampleLocalWalkableY;
    const sampleProbe = new THREE.Vector3();
    const sampleWorldY = sampleLocal
      ? (worldX: number, worldZ: number): number | null => {
          sampleProbe.set(worldX, yOffset, worldZ).applyMatrix4(invWorldMat);
          const localY = sampleLocal(sampleProbe.x, sampleProbe.z);
          return localY === null ? null : localY + yOffset;
        }
      : (worldX: number, worldZ: number): number | null => sampler.sampleWalkableY(worldX, worldZ);

    entries.push({
      group: obj,
      sampler,
      worldBottomY,
      worldTopY,
      worldVoidXZ,
      minX: minX - 0.15,
      maxX: maxX + 0.15,
      minZ: minZ - 0.15,
      maxZ: maxZ + 0.15,
      sampleWorldY,
    });
  });

  return entries;
}

function countSceneNodesFast(root: THREE.Object3D): number {
  let count = 1;
  const children = root.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    count += 1 + child.children.length;
  }
  return count;
}

/**
 * Creates a lazily indexed, auto-composed walkthrough elevation solver for a house scene.
 */
export function createAutoWalkthroughElevationComposer(
  options: AutoWalkthroughElevationComposerOptions
): AutoWalkthroughElevationComposer {
  const maxStepUpM = options.maxStepUpM ?? 0.32;
  const sortedFloors = [...options.floors].sort((a, b) => a.elevationY - b.elevationY);
  const floorElevations = sortedFloors.map((f) => f.elevationY);
  const lowestFloorY = floorElevations[0] ?? 0;

  let indexedScene: THREE.Object3D | null = null;
  let indexedNodeSignature = -1;
  let indexedFromUnbatched = false;
  let indexedStairs: IndexedStaircaseEntry[] = [];
  const triangleGrid = new Map<number, WalkableTriangle[]>();

  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const triNormal = new THREE.Vector3();
  const tmpBox = new THREE.Box3();

  const indexMeshWalkableTriangles = (mesh: THREE.Mesh): void => {
    const geom = mesh.geometry;
    const pos = geom.getAttribute('position');
    if (!pos || pos.count < 3) return;

    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const isDoubleSide = mat?.side === THREE.DoubleSide;
    const index = geom.getIndex();
    const triCount = index ? Math.floor(index.count / 3) : Math.floor(pos.count / 3);
    const maxTris = mesh.userData?.isBatchedStaticMesh === true ? 32768 : 4096;
    if (triCount > maxTris) return;

    for (let t = 0; t < triCount; t++) {
      const i0 = index ? index.getX(t * 3) : t * 3;
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;

      vA.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld);
      vB.fromBufferAttribute(pos, i1).applyMatrix4(mesh.matrixWorld);
      vC.fromBufferAttribute(pos, i2).applyMatrix4(mesh.matrixWorld);

      e1.subVectors(vB, vA);
      e2.subVectors(vC, vA);
      triNormal.crossVectors(e1, e2);
      const area2 = triNormal.length();
      if (area2 < 1e-6) continue;
      triNormal.divideScalar(area2);

      if (isDoubleSide && triNormal.y < 0) {
        triNormal.negate();
      }
      if (triNormal.y < COS_MAX_WALKABLE_SLOPE) continue;

      const minX = Math.min(vA.x, vB.x, vC.x);
      const maxX = Math.max(vA.x, vB.x, vC.x);
      const minZ = Math.min(vA.z, vB.z, vC.z);
      const maxZ = Math.max(vA.z, vB.z, vC.z);
      if (maxX - minX < 0.04 && maxZ - minZ < 0.04) continue;

      const planeD = -(triNormal.x * vA.x + triNormal.y * vA.y + triNormal.z * vA.z);
      const tri: WalkableTriangle = {
        visibilityNode: mesh,
        ax: vA.x,
        az: vA.z,
        bx: vB.x,
        bz: vB.z,
        cx: vC.x,
        cz: vC.z,
        nx: triNormal.x,
        ny: triNormal.y,
        nz: triNormal.z,
        planeD,
        minX,
        maxX,
        minZ,
        maxZ,
      };

      const cMinX = Math.floor(minX * INV_CELL_SIZE);
      const cMaxX = Math.floor(maxX * INV_CELL_SIZE);
      const cMinZ = Math.floor(minZ * INV_CELL_SIZE);
      const cMaxZ = Math.floor(maxZ * INV_CELL_SIZE);
      for (let cx = cMinX; cx <= cMaxX; cx++) {
        for (let cz = cMinZ; cz <= cMaxZ; cz++) {
          const key = cellKey(cx, cz);
          let bucket = triangleGrid.get(key);
          if (!bucket) {
            bucket = [];
            triangleGrid.set(key, bucket);
          }
          bucket.push(tri);
        }
      }
    }
  };

  const hasBatchedStaticMeshes = (root: THREE.Object3D): boolean => {
    let found = false;
    root.traverse((obj) => {
      if (obj.userData?.isBatchedStaticMesh === true) {
        found = true;
      }
    });
    return found;
  };

  const ensureIndexed = (): void => {
    const scene = options.getScene();
    if (!scene) return;
    const sig = countSceneNodesFast(scene);
    if (scene === indexedScene && sig === indexedNodeSignature) return;

    const sceneIsBatched = hasBatchedStaticMeshes(scene);
    if (
      scene === indexedScene &&
      indexedFromUnbatched &&
      sceneIsBatched &&
      (triangleGrid.size > 0 || indexedStairs.length > 0)
    ) {
      // Preserve full-fidelity pre-batch walkable triangles & staircases after SceneBatchOptimizer
      // detaches original meshes into static batches.
      indexedNodeSignature = sig;
      return;
    }

    indexedScene = scene;
    indexedNodeSignature = sig;
    indexedFromUnbatched = !sceneIsBatched;
    triangleGrid.clear();
    indexedStairs = collectRegisteredStaircases(scene);

    const stairGroups = new Set<THREE.Object3D>(indexedStairs.map((s) => s.group));

    const visit = (
      node: THREE.Object3D,
      inSlabLayer: boolean,
      hasWalkableContainer: boolean
    ): void => {
      if (stairGroups.has(node)) return;
      const u = node.userData as Record<string, unknown> | undefined;
      if (
        u?.collisionRole === 'ignore' ||
        u?.ignoreWalkthroughCollision === true ||
        u?.isLightGlowPool === true ||
        u?.isFittingFx === true ||
        u?.isShadowPassHook === true ||
        u?.doorRole === 'pivot' ||
        u?.drawerRole === 'group'
      ) {
        return;
      }

      const name = typeof node.name === 'string' ? node.name : '';
      if (
        name === 'ceilingMeshGroup' ||
        name === 'groundFloorCeilingGroup' ||
        /\.ceiling$/i.test(name) ||
        name.endsWith('.contactShadow')
      ) {
        return;
      }

      const nodeIsSlabLayer =
        inSlabLayer ||
        /\.slab$/i.test(name) ||
        u?.isFloorSlab === true ||
        u?.walkableSurface === true ||
        u?.collisionRole === 'walkable';
      const isSolidPlane =
        u?.collisionRole === 'solidPlane' || u?.isWalkthroughSolidPlane === true;
      const nodeHasWalkableContainer =
        hasWalkableContainer ||
        (!(node instanceof THREE.Mesh) && WALKABLE_CONTAINER_NAME_RE.test(name));
      const leafHasWalkableName = WALKABLE_SURFACE_NAME_RE.test(name);

      if (
        node instanceof THREE.Mesh &&
        !(node instanceof THREE.InstancedMesh) &&
        (u?.isBatchedStaticMesh !== true || (sceneIsBatched && (nodeIsSlabLayer || nodeHasWalkableContainer)))
      ) {
        if (!FURNITURE_OR_FIXTURE_NAME_RE.test(name) || /bathFloor|showerTray/i.test(name)) {
          if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
          const gb = node.geometry.boundingBox;
          let sizeX = 0;
          let sizeY = 0;
          let sizeZ = 0;
          let topY = 0;
          if (gb && !gb.isEmpty()) {
            tmpBox.copy(gb).applyMatrix4(node.matrixWorld);
            sizeX = tmpBox.max.x - tmpBox.min.x;
            sizeY = tmpBox.max.y - tmpBox.min.y;
            sizeZ = tmpBox.max.z - tmpBox.min.z;
            topY = tmpBox.max.y;
          }
          let qualifies =
            nodeIsSlabLayer ||
            nodeHasWalkableContainer ||
            leafHasWalkableName ||
            (isSolidPlane && sizeY <= 0.45);
          if (!qualifies && !NON_WALKABLE_ANCESTOR_RE.test(name) && gb && !gb.isEmpty()) {
            const nearDeclaredFloor = floorElevations.some((fy) => Math.abs(topY - fy) <= 0.12);
            if (sizeY <= 0.45 && Math.min(sizeX, sizeZ) >= 1.6 && nearDeclaredFloor) {
              qualifies = true;
            }
          }
          if (qualifies) {
            indexMeshWalkableTriangles(node);
          }
        }
      }

      if (NON_WALKABLE_ANCESTOR_RE.test(name) && !nodeIsSlabLayer && !nodeHasWalkableContainer && !leafHasWalkableName) {
        return;
      }

      const children = node.children;
      for (let i = 0; i < children.length; i++) {
        visit(children[i]!, nodeIsSlabLayer, nodeHasWalkableContainer);
      }
    };

    visit(scene, false, false);
  };

  const isInsideUpperStairwellVoid = (
    x: number,
    z: number,
    floorElevationY: number,
    hasActualSlabTriangle = false
  ): boolean => {
    ensureIndexed();
    if (floorElevationY <= lowestFloorY + 0.35) return false;
    for (let i = 0; i < indexedStairs.length; i++) {
      const stair = indexedStairs[i]!;
      if (isVariationHiddenInHierarchy(stair.group)) continue;
      if (Math.abs(floorElevationY - stair.worldTopY) > 0.35) continue;
      if (x < stair.minX || x > stair.maxX || z < stair.minZ || z > stair.maxZ) continue;
      if (isStrictlyInsidePolygonXZ(x, z, stair.worldVoidXZ, 0.015)) {
        if (hasActualSlabTriangle) {
          const stairY = stair.sampleWorldY(x, z);
          if (stairY === null || floorElevationY - stairY >= 2.0) {
            continue;
          }
        }
        return true;
      }
    }
    return false;
  };

  const sampleRoomElevationWithVoidCutout = (
    x: number,
    refY: number,
    z: number,
    externalGetRoomMinYAt?: WalkthroughRoomMinYSampler
  ): number | null => {
    const regs = options.roomRegistrations;
    if (regs && regs.length > 0) {
      let bestY: number | null = null;
      let bestDist = Number.POSITIVE_INFINITY;
      for (let i = 0; i < regs.length; i++) {
        const reg = regs[i]!;
        if (reg.isInterior === false) continue;
        if (reg.excludedCutout?.(x, z)) continue;
        const b = reg.bounds;
        if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
        const walkY = reg.walkingFloorY ?? b.minY;
        if (isInsideUpperStairwellVoid(x, z, walkY)) continue;
        if (walkY > refY + maxStepUpM) continue;
        const dist = Math.abs(refY - walkY);
        if (bestY === null || walkY > bestY || (Math.abs(walkY - bestY) < 1e-4 && dist < bestDist)) {
          bestY = walkY;
          bestDist = dist;
        }
      }
      if (bestY !== null) return bestY;
    }

    if (externalGetRoomMinYAt) {
      const rmY = externalGetRoomMinYAt(x, refY, z);
      if (rmY !== null && !isInsideUpperStairwellVoid(x, z, rmY) && rmY <= refY + maxStepUpM) {
        return rmY;
      }
    }
    return null;
  };

  const sampleElevationY = (
    x: number,
    z: number,
    currentFootY: number,
    getRoomMinYAt?: WalkthroughRoomMinYSampler
  ): number => {
    if (options.customSampler) {
      const custom = options.customSampler(x, z, currentFootY);
      if (typeof custom === 'number' && Number.isFinite(custom)) {
        return custom;
      }
    }

    if (options.customWalkableSampler) {
      const fallbackRoomMinY: WalkthroughRoomMinYSampler =
        getRoomMinYAt ?? ((rx, ry, rz) => sampleRoomElevationWithVoidCutout(rx, ry, rz));
      return options.customWalkableSampler(x, currentFootY, z, fallbackRoomMinY);
    }

    ensureIndexed();

    // Evaluate registered staircases and walkable slab/step/terrace top triangles:
    //    choose the highest walkable surface at (x, z) within step-up reach (<= currentFootY + stairStepUpM),
    //    while excluding upper-floor slabs inside discovered stairwell void openings.
    const stairStepUpM = Math.max(maxStepUpM, 0.38);
    let bestSurfaceY: number | null = null;
    for (let i = 0; i < indexedStairs.length; i++) {
      const stair = indexedStairs[i]!;
      if (isVariationHiddenInHierarchy(stair.group)) continue;
      if (x < stair.minX || x > stair.maxX || z < stair.minZ || z > stair.maxZ) continue;
      const stairY = stair.sampleWorldY(x, z);
      if (stairY === null) continue;
      if (stairY > currentFootY + stairStepUpM) continue;
      if (bestSurfaceY === null || stairY > bestSurfaceY) {
        bestSurfaceY = stairY;
      }
    }

    // Evaluate walkable slab / step / terrace / landing top triangles within step-up reach
    const bucket = triangleGrid.get(
      cellKey(Math.floor(x * INV_CELL_SIZE), Math.floor(z * INV_CELL_SIZE))
    );
    if (bucket) {
      for (let i = 0; i < bucket.length; i++) {
        const tri = bucket[i]!;
        if (isVariationHiddenInHierarchy(tri.visibilityNode)) continue;
        if (x < tri.minX || x > tri.maxX || z < tri.minZ || z > tri.maxZ) continue;
        if (!pointInTriangleXZ(x, z, tri)) continue;
        const surfY = -(tri.nx * x + tri.nz * z + tri.planeD) / tri.ny;
        if (surfY > currentFootY + maxStepUpM) continue;
        if (isInsideUpperStairwellVoid(x, z, surfY, true)) continue;
        if (bestSurfaceY === null || surfY > bestSurfaceY) {
          bestSurfaceY = surfY;
        }
      }
    }

    // Evaluate declared room floor elevations (respecting stairwell void cutouts)
    const roomY = sampleRoomElevationWithVoidCutout(x, currentFootY, z, getRoomMinYAt);
    if (roomY !== null && (bestSurfaceY === null || roomY > bestSurfaceY)) {
      bestSurfaceY = roomY;
    }

    if (bestSurfaceY !== null) {
      return bestSurfaceY;
    }

    // Outdoors fallback to terrain sampler
    return evaluateTerrain(options.terrainSampler, x, z);
  };

  return {
    sampleElevationY,
    sampleWalkableElevation(x, refFootY, z, getRoomMinYAt) {
      return sampleElevationY(x, z, refFootY, getRoomMinYAt);
    },
    isInsideUpperStairwellVoid,
    getIndexedStaircases() {
      ensureIndexed();
      return indexedStairs;
    },
    invalidate() {
      indexedScene = null;
      indexedNodeSignature = -1;
      indexedFromUnbatched = false;
      indexedStairs = [];
      triangleGrid.clear();
    },
  };
}

/** Alias used by `defineHouse` to compose walkthrough hooks and stairwell cutouts. */
export const composeHouseWalkthroughElevation = createAutoWalkthroughElevationComposer;
