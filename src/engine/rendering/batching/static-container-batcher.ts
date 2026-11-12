import * as THREE from 'three';
import type { FloorId, RoomZoneId } from '../../../core/types/topology.ts';
import { getFloorIdForSceneGroup } from '../../viewer/scene-content.ts';
import type { RoomLodController } from '../../lod/lod-manager.ts';
import type { BatchOptimizerHooks } from '../../viewer/property-scene-profile.ts';
import type { BifoldPanelRef, ZoneIndicatorMaterials } from '../../viewer/scene-types.ts';
import { accelerateMergedBatchRaycast } from '../mesh-bvh.ts';
import type { BatchRestorationStore } from './batch-restoration-store.ts';
import type { FastGeometryMerger } from './fast-geometry-merger.ts';
import {
  buildInteractiveKey,
  isBatchableMesh,
  isBatchableMultiMaterialMesh,
} from './scene-batch-classification.ts';

/** Per-room / 10m x 10m XZ spatial cell size for frustum culling & front-to-back hardware Early-Z. */
const SPATIAL_BATCH_CELL_M = 10.0;

export interface StaticContainerBatchContext {
  readonly topContainers: ReadonlySet<THREE.Object3D>;
  readonly protectedObjects: ReadonlySet<THREE.Object3D>;
  readonly mutableMaterials: ReadonlySet<THREE.Material>;
  readonly interactiveSet: ReadonlySet<THREE.Object3D>;
  readonly batchedOriginalMeshes: Set<THREE.Object3D>;
  readonly newInteractiveMeshes: THREE.Object3D[];
  readonly lodController: RoomLodController;
  readonly indicatorMats: ZoneIndicatorMaterials | undefined;
  readonly batchHooks: BatchOptimizerHooks;
  readonly store: BatchRestorationStore;
  readonly merger: FastGeometryMerger;
}

export interface RigidDynamicBatchContext {
  readonly bifoldPanels: readonly BifoldPanelRef[];
  readonly indicatorMats: ZoneIndicatorMaterials | undefined;
  readonly batchHooks: BatchOptimizerHooks;
  readonly interactiveSet: ReadonlySet<THREE.Object3D>;
  readonly batchedOriginalMeshes: Set<THREE.Object3D>;
  readonly newInteractiveMeshes: THREE.Object3D[];
  readonly mutableMaterials: ReadonlySet<THREE.Material>;
  readonly store: BatchRestorationStore;
  readonly merger: FastGeometryMerger;
}

export function batchContainerSubtree(
  container: THREE.Object3D,
  ctx: StaticContainerBatchContext
): void {
  const {
    topContainers,
    protectedObjects,
    mutableMaterials,
    interactiveSet,
    batchedOriginalMeshes,
    newInteractiveMeshes,
    lodController,
    indicatorMats,
    batchHooks,
    store,
    merger,
  } = ctx;

  interface CutawaySpec {
    readonly floor: FloorId;
    readonly axis: 'x' | 'z';
    readonly coord: number;
    readonly minSpan: number;
    readonly maxSpan: number;
    readonly outwardSide?: 'north' | 'south' | 'east' | 'west';
    readonly includeInFirstFloorCutaway?: boolean;
  }

  interface BucketItem {
    readonly floorId: FloorId | undefined;
    readonly mesh: THREE.Mesh;
    readonly meshParent: THREE.Object3D;
    readonly material: THREE.Material;
    readonly indexRange?: { readonly start: number; readonly count: number };
    readonly lodTier: 1 | 2 | undefined;
    readonly zoneId: RoomZoneId | undefined;
    readonly runtimeMaxDist: number;
    readonly isInteractive: boolean;
    readonly inheritedUserData: Record<string, unknown>;
    readonly groupPrefix: string;
    readonly cutawayWall: CutawaySpec | undefined;
    readonly offsetX: number;
    readonly offsetZ: number;
    readonly rotationY: number;
    readonly worldX: number;
    readonly worldZ: number;
  }

  const buckets = new Map<string, BucketItem[]>();
  const multiMatExpectedGroups = new Map<THREE.Mesh, number>();
  const subtreeAllCandidate = new Set<THREE.Object3D>();
  const worldCenter = new THREE.Vector3();

  const rootU = container.userData as Record<string, unknown> | undefined;
  const rootTier =
    rootU?.lodTier === 1 || rootU?.lodTier === 2 ? (rootU.lodTier as 1 | 2) : undefined;
  const rootZone = (rootU?.zoneId ?? rootU?.zone) as RoomZoneId | undefined;
  const rootFloorId: FloorId | undefined =
    getFloorIdForSceneGroup(container) ??
    (typeof rootU?.floorId === 'string' ? (rootU.floorId as FloorId) : undefined);

  let baseOffsetX = 0;
  let baseOffsetZ = 0;
  let baseRotY = 0;
  let anc: THREE.Object3D | null = container;
  while (anc) {
    const cOff = anc.userData?.containerOffset as readonly [number, number, number] | undefined;
    if (cOff) {
      baseOffsetX += cOff[0];
      baseOffsetZ += cOff[2];
    }
    const cRot = anc.userData?.containerRotationY as number | undefined;
    if (typeof cRot === 'number') {
      baseRotY += cRot;
    }
    anc = anc.parent;
  }

  const visit = (
    node: THREE.Object3D,
    inheritedTier: 1 | 2 | undefined,
    inheritedZone: RoomZoneId | undefined,
    inheritedFloorId: FloorId | undefined,
    inheritedRuntimeMaxDist: number,
    inheritedUserData: Record<string, unknown>,
    groupPrefix: string,
    inheritedCutaway: CutawaySpec | undefined,
    offsetX: number,
    offsetZ: number,
    rotationY: number
  ): void => {
    if ((node !== container && !node.visible) || protectedObjects.has(node)) return;
    if (node !== container && topContainers.has(node)) return;

    const u = (node.userData ?? {}) as Record<string, unknown>;
    let nextOffsetX = offsetX;
    let nextOffsetZ = offsetZ;
    let nextRotY = rotationY;
    if (node !== container) {
      const cOff = u.containerOffset as readonly [number, number, number] | undefined;
      if (cOff) {
        nextOffsetX += cOff[0];
        nextOffsetZ += cOff[2];
      }
      const cRot = u.containerRotationY as number | undefined;
      if (typeof cRot === 'number') {
        nextRotY += cRot;
      }
    }

    const nextCutaway = (u.cutawayWall as CutawaySpec | undefined) ?? inheritedCutaway;

    const nextZone: RoomZoneId | undefined =
      ((u.zoneId ?? u.zone) as RoomZoneId | undefined) ??
      lodController.inferZoneFromName(node.name) ??
      inheritedZone;
    const nextFloorId: FloorId | undefined =
      getFloorIdForSceneGroup(node) ??
      (typeof u.floorId === 'string' ? (u.floorId as FloorId) : undefined) ??
      nextCutaway?.floor ??
      (nextZone ? lodController.getRoomFloorId(nextZone) : undefined) ??
      inheritedFloorId;
    let nextTier: 1 | 2 | undefined =
      u.lodTier === 1 || u.lodTier === 2
        ? (u.lodTier as 1 | 2)
        : u.lodTier === 'high' && nextZone && !lodController.isExteriorZone(nextZone)
          ? 2
          : inheritedTier;

    const isGlowOrFxNode = Boolean(u.isFittingFx) || Boolean(u.isLightGlowPool);
    const isLightingNode =
      isGlowOrFxNode ||
      u.circuitId !== undefined ||
      (node instanceof THREE.Mesh &&
        (Array.isArray(node.material)
          ? node.material.some((m) => mutableMaterials.has(m))
          : mutableMaterials.has(node.material)));
    if (isGlowOrFxNode) {
      nextTier = undefined;
    } else if (
      isLightingNode &&
      nextTier === undefined &&
      nextZone &&
      !lodController.isExteriorZone(nextZone) &&
      !(node instanceof THREE.Mesh && node.castShadow)
    ) {
      nextTier = 1;
    }
    const isInteriorZoneNode = Boolean(nextZone && !lodController.isExteriorZone(nextZone));
    let nextRuntimeMaxDist = isGlowOrFxNode ? 0 : inheritedRuntimeMaxDist;
    if (isInteriorZoneNode && (nextTier === 1 || nextTier === 2)) {
      // Interior room LOD1/LOD2 meshes stay bound to per-room RoomLodController & PortalVisibilitySolver
      nextRuntimeMaxDist = 0;
    } else if (!isGlowOrFxNode && u.lodTier === 'high') {
      nextRuntimeMaxDist = 28;
    }

    let nextUserData = inheritedUserData;
    if (
      u.interactableId !== undefined ||
      u.circuitId !== undefined ||
      u.ufhZoneId !== undefined ||
      u.applianceId !== undefined ||
      u.switchPa !== undefined ||
      u.switchLocation !== undefined ||
      u.switchDirection !== undefined ||
      u.zoneSceneSwitchZoneId !== undefined ||
      u.presenceDetectorPa !== undefined ||
      u.roomMotionSensorId !== undefined ||
      u.accessEntityId !== undefined ||
      u.isClimbableLadder !== undefined ||
      u.isKNXSwitch !== undefined ||
      u.isKnxTempSensor !== undefined ||
      u.isCourtyardSwitch !== undefined ||
      u.isUtilitySwitch !== undefined ||
      u.isKitchenMotionSensor !== undefined ||
      u.isUtilityMotionSensor !== undefined ||
      u.isFrameTV !== undefined ||
      u.isUniFiCamera !== undefined ||
      u.isUniFiAccessReader !== undefined
    ) {
      nextUserData = { ...inheritedUserData, ...u };
    }

    const nextPrefix =
      node !== container && typeof node.name === 'string' && node.name.length > 0 && !groupPrefix
        ? node.name.split('.').slice(0, 2).join('.')
        : groupPrefix;

    let allChildrenCandidates = true;
    for (const child of node.children) {
      visit(
        child,
        nextTier,
        nextZone,
        nextFloorId,
        nextRuntimeMaxDist,
        nextUserData,
        nextPrefix,
        nextCutaway,
        nextOffsetX,
        nextOffsetZ,
        nextRotY
      );
      if (!subtreeAllCandidate.has(child)) {
        allChildrenCandidates = false;
      }
    }

    if (
      !(node instanceof THREE.Mesh) &&
      !(node instanceof THREE.Light) &&
      allChildrenCandidates &&
      node.children.length > 0 &&
      !protectedObjects.has(node)
    ) {
      subtreeAllCandidate.add(node);
    }

    if (node instanceof THREE.Mesh && node.parent) {
      const singleBatchable = isBatchableMesh(
        node,
        protectedObjects,
        mutableMaterials,
        indicatorMats,
        allChildrenCandidates
      );
      const multiBatchable =
        !singleBatchable &&
        isBatchableMultiMaterialMesh(
          node,
          protectedObjects,
          mutableMaterials,
          indicatorMats,
          allChildrenCandidates
        );
      if (
        !singleBatchable &&
        !multiBatchable &&
        !protectedObjects.has(node) &&
        !u.isLightGlowPool &&
        !u.isFittingFx &&
        !node.castShadow &&
        nextZone &&
        !lodController.isExteriorZone(nextZone) &&
        rootTier === undefined
      ) {
        lodController.registerObjectWithTier(nextZone, node, 1);
      }
      if (singleBatchable || multiBatchable) {
        if (!node.geometry.boundingSphere) {
          node.geometry.computeBoundingSphere();
        }
        const sphere = node.geometry.boundingSphere;
        const maxScale = Math.max(
          Math.abs(node.scale.x),
          Math.abs(node.scale.y),
          Math.abs(node.scale.z)
        );
        // Allow architectural walls, roofs, beams, and slabs up to 24m radius to batch cleanly,
        // leaving only vast >24m terrain/paddock ground planes unmerged.
        if (!sphere || sphere.radius * maxScale <= 24.0) {
          if (sphere) {
            worldCenter.copy(sphere.center).applyMatrix4(node.matrixWorld);
          } else {
            worldCenter.setFromMatrixPosition(node.matrixWorld);
          }

          const isInteractive =
            interactiveSet.has(node) ||
            Boolean(nextUserData.interactableId) ||
            Boolean(nextUserData.circuitId) ||
            Boolean(nextUserData.ufhZoneId) ||
            Boolean(nextUserData.applianceId) ||
            Boolean(nextUserData.zoneSceneSwitchZoneId) ||
            Boolean(nextUserData.presenceDetectorPa) ||
            Boolean(nextUserData.roomMotionSensorId) ||
            Boolean(nextUserData.isKNXSwitch) ||
            Boolean(nextUserData.isCourtyardSwitch) ||
            Boolean(nextUserData.isUtilitySwitch) ||
            Boolean(nextUserData.isKitchenMotionSensor) ||
            Boolean(nextUserData.isUtilityMotionSensor) ||
            Boolean(nextUserData.isClimbableLadder) ||
            Boolean(nextUserData.isFrameTV) ||
            Boolean(nextUserData.isUniFiCamera) ||
            Boolean(nextUserData.isUniFiAccessReader) ||
            Boolean(nextUserData.accessEntityId);

          // Partition static .batch merges by room zoneId + 10m x 10m XZ spatial cell so hardware frustum
          // culling + PortalVisibilitySolver cull off-frustum & occluded rooms and sort front-to-back for Early-Z!
          const spatialCellKey = `${Math.floor(worldCenter.x / SPATIAL_BATCH_CELL_M)},${Math.floor(worldCenter.z / SPATIAL_BATCH_CELL_M)}`;
          const isInteriorRoomScope = Boolean(
            nextZone && !lodController.isExteriorZone(nextZone)
          );
          let normCutaway = nextCutaway;
          let normOffX = nextOffsetX;
          let normOffZ = nextOffsetZ;
          if (nextCutaway && Math.abs(nextRotY - baseRotY) < 1e-4 && Math.abs(baseRotY) < 1e-4) {
            const dX = nextOffsetX - baseOffsetX;
            const dZ = nextOffsetZ - baseOffsetZ;
            if (Math.abs(dX) > 1e-4 || Math.abs(dZ) > 1e-4) {
              normCutaway =
                nextCutaway.axis === 'z'
                  ? {
                      ...nextCutaway,
                      coord: nextCutaway.coord + dZ,
                      minSpan: nextCutaway.minSpan + dX,
                      maxSpan: nextCutaway.maxSpan + dX,
                    }
                  : {
                      ...nextCutaway,
                      coord: nextCutaway.coord + dX,
                      minSpan: nextCutaway.minSpan + dZ,
                      maxSpan: nextCutaway.maxSpan + dZ,
                    };
              normOffX = baseOffsetX;
              normOffZ = baseOffsetZ;
            }
          }
          const cutSpanCell = normCutaway
            ? Math.floor(((normCutaway.minSpan + normCutaway.maxSpan) * 0.5) / 6.0)
            : 0;
          const cutKey = normCutaway
            ? `cut:${normCutaway.floor}:${normCutaway.axis}:${Math.round(normCutaway.coord * 20)}:${cutSpanCell}:${normCutaway.outwardSide ?? 'none'}:${normCutaway.includeInFirstFloorCutaway ? 1 : 0}:${Math.round(normOffX * 100)}:${Math.round(normOffZ * 100)}:${Math.round(nextRotY * 1000)}`
            : '';
          const cellKey = cutKey
            ? cutKey
            : nextTier !== undefined && nextZone
              ? isInteriorRoomScope
                ? `T${nextTier}:${nextZone}`
                : `T${nextTier}:${nextZone}:${spatialCellKey}`
              : nextRuntimeMaxDist > 0
                ? `D${nextRuntimeMaxDist}:${spatialCellKey}`
                : isInteriorRoomScope
                  ? `S:${nextZone}:${spatialCellKey}`
                  : `S:${spatialCellKey}`;
          const intKey = buildInteractiveKey(nextUserData, isInteractive);
          const meshShadowKey = nextTier === 2 ? 'n' : node.castShadow ? 'c' : 'n';
          const floorKey = nextFloorId ? `F:${nextFloorId}|` : '';

          if (singleBatchable) {
            const mat = node.material as THREE.Material;
            const shadowKey = meshShadowKey;
            const key = `${floorKey}${mat.uuid}|${shadowKey}|${nextRuntimeMaxDist}|${intKey}|${cellKey}`;
            let list = buckets.get(key);
            if (!list) {
              list = [];
              buckets.set(key, list);
            }
            list.push({
              floorId: nextFloorId,
              mesh: node,
              meshParent: node.parent,
              material: mat,
              lodTier: nextTier,
              zoneId: nextZone,
              runtimeMaxDist: nextRuntimeMaxDist,
              isInteractive,
              inheritedUserData: nextUserData,
              groupPrefix: nextPrefix,
              cutawayWall: normCutaway,
              offsetX: normOffX,
              offsetZ: normOffZ,
              rotationY: nextRotY,
              worldX: worldCenter.x,
              worldZ: worldCenter.z,
            });
            if (allChildrenCandidates) subtreeAllCandidate.add(node);
          } else {
            const mats = node.material as THREE.Material[];
            const groups = node.geometry.groups;
            multiMatExpectedGroups.set(node, groups.length);
            for (let gIdx = 0; gIdx < groups.length; gIdx++) {
              const grp = groups[gIdx]!;
              const mat = mats[grp.materialIndex ?? 0]!;
              const shadowKey = meshShadowKey;
              const key = `${floorKey}${mat.uuid}|${shadowKey}|${nextRuntimeMaxDist}|${intKey}|${cellKey}`;
              let list = buckets.get(key);
              if (!list) {
                list = [];
                buckets.set(key, list);
              }
              list.push({
                floorId: nextFloorId,
                mesh: node,
                meshParent: node.parent,
                material: mat,
                indexRange: { start: grp.start, count: grp.count },
                lodTier: nextTier,
                zoneId: nextZone,
                runtimeMaxDist: nextRuntimeMaxDist,
                isInteractive,
                inheritedUserData: nextUserData,
                groupPrefix: nextPrefix,
                cutawayWall: normCutaway,
                offsetX: normOffX,
                offsetZ: normOffZ,
                rotationY: nextRotY,
                worldX: worldCenter.x,
                worldZ: worldCenter.z,
              });
            }
            if (allChildrenCandidates) subtreeAllCandidate.add(node);
          }
        }
      }
    }
  };

  visit(
    container,
    rootTier,
    rootZone,
    rootFloorId,
    0,
    {},
    container.name || '',
    rootU?.cutawayWall as CutawaySpec | undefined,
    baseOffsetX,
    baseOffsetZ,
    baseRotY
  );

  // Coalesce singletons across floor quadrants (when lodTier is undefined) or within the same LOD tier + zone
  const byMaterialAndScope = new Map<string, BucketItem[][]>();
  for (const list of buckets.values()) {
    const first = list[0]!;
    const mat = first.material;
    const intKey = buildInteractiveKey(first.inheritedUserData, first.isInteractive);
    const cutKey = first.cutawayWall
      ? `cut:${first.cutawayWall.floor}:${first.cutawayWall.axis}:${Math.round(first.cutawayWall.coord * 20)}:${first.cutawayWall.outwardSide ?? 'none'}:${first.cutawayWall.includeInFirstFloorCutaway ? 1 : 0}:${Math.round(first.offsetX * 100)}:${Math.round(first.offsetZ * 100)}:${Math.round(first.rotationY * 1000)}:${Math.floor(((first.cutawayWall.minSpan + first.cutawayWall.maxSpan) * 0.5) / 6.0)}`
      : '';
    const scopeKey =
      first.runtimeMaxDist > 0
        ? `D${first.runtimeMaxDist}`
        : first.lodTier !== undefined
          ? `T${first.lodTier}:${first.zoneId ?? ''}`
          : '';
    const bldgDomain = batchHooks.isDetachedBuildingMesh?.(first.mesh.name, first.groupPrefix)
      ? 'ob'
      : 'mh';
    const baseShadowKey = bldgDomain === 'ob' ? (first.mesh.castShadow ? 'c' : 'n') : 's';
    const baseKey = `${first.floorId ?? ''}|${mat.uuid}|${bldgDomain}|${baseShadowKey}|${intKey}|${cutKey}|${scopeKey}`;
    let groupLists = byMaterialAndScope.get(baseKey);
    if (!groupLists) {
      groupLists = [];
      byMaterialAndScope.set(baseKey, groupLists);
    }
    groupLists.push(list);
  }

  const itemVerts = (it: BucketItem): number =>
    it.mesh.geometry.getAttribute('position')?.count ?? 0;

  const finalBuckets: BucketItem[][] = [];
  for (const groupLists of byMaterialAndScope.values()) {
    if (groupLists.length === 1) {
      finalBuckets.push(groupLists[0]!);
      continue;
    }
    const maxSpanM = 48.0;
    const mergedChunks: Array<{
      items: BucketItem[];
      verts: number;
      minX: number;
      maxX: number;
      minZ: number;
      maxZ: number;
    }> = [];

    for (const l of groupLists) {
      let lVerts = 0;
      let lMinX = Infinity;
      let lMaxX = -Infinity;
      let lMinZ = Infinity;
      let lMaxZ = -Infinity;
      for (let i = 0; i < l.length; i++) {
        const it = l[i]!;
        lVerts += itemVerts(it);
        if (it.worldX < lMinX) lMinX = it.worldX;
        if (it.worldX > lMaxX) lMaxX = it.worldX;
        if (it.worldZ < lMinZ) lMinZ = it.worldZ;
        if (it.worldZ > lMaxZ) lMaxZ = it.worldZ;
      }
      let placed = false;
      for (let cIdx = 0; cIdx < mergedChunks.length; cIdx++) {
        const ch = mergedChunks[cIdx]!;
        const nxMin = Math.min(ch.minX, lMinX);
        const nxMax = Math.max(ch.maxX, lMaxX);
        const nzMin = Math.min(ch.minZ, lMinZ);
        const nzMax = Math.max(ch.maxZ, lMaxZ);
        if (
          ch.verts + lVerts <= 65000 &&
          nxMax - nxMin <= maxSpanM &&
          nzMax - nzMin <= maxSpanM
        ) {
          ch.items.push(...l);
          ch.verts += lVerts;
          ch.minX = nxMin;
          ch.maxX = nxMax;
          ch.minZ = nzMin;
          ch.maxZ = nzMax;
          placed = true;
          break;
        }
      }
      if (!placed) {
        mergedChunks.push({
          items: [...l],
          verts: lVerts,
          minX: lMinX,
          maxX: lMaxX,
          minZ: lMinZ,
          maxZ: lMaxZ,
        });
      }
    }

    for (let cIdx = 0; cIdx < mergedChunks.length; cIdx++) {
      finalBuckets.push(mergedChunks[cIdx]!.items);
    }
  }

  // All-or-nothing integrity check for split multi-material meshes: only split a multi-material
  // mesh into batches when ALL of its consolidated material groups belong to buckets of length >= 2;
  // otherwise leave that mesh in-place with its consolidated multi-group geometry.
  if (multiMatExpectedGroups.size > 0) {
    let changed = true;
    const rejectedMultiMeshes = new Set<THREE.Mesh>();
    while (changed) {
      changed = false;
      const activeCounts = new Map<THREE.Mesh, number>();
      for (let i = 0; i < finalBuckets.length; i++) {
        const list = finalBuckets[i]!;
        if (list.length < 2) continue;
        for (let j = 0; j < list.length; j++) {
          const m = list[j]!.mesh;
          if (multiMatExpectedGroups.has(m)) {
            activeCounts.set(m, (activeCounts.get(m) ?? 0) + 1);
          }
        }
      }
      for (const [m, expected] of multiMatExpectedGroups.entries()) {
        if (rejectedMultiMeshes.has(m)) continue;
        if ((activeCounts.get(m) ?? 0) < expected) {
          rejectedMultiMeshes.add(m);
          changed = true;
        }
      }
      if (changed) {
        for (let i = 0; i < finalBuckets.length; i++) {
          finalBuckets[i] = finalBuckets[i]!.filter((item) => !rejectedMultiMeshes.has(item.mesh));
        }
      }
    }
  }

  {
    let parentChanged = true;
    while (parentChanged) {
      parentChanged = false;
      const willMergeMeshes = new Set<THREE.Mesh>();
      for (let i = 0; i < finalBuckets.length; i++) {
        const list = finalBuckets[i]!;
        if (list.length < 2) continue;
        for (let j = 0; j < list.length; j++) {
          willMergeMeshes.add(list[j]!.mesh);
        }
      }
      const hasUnmergedDescendant = (obj: THREE.Object3D): boolean => {
        for (let k = 0; k < obj.children.length; k++) {
          const c = obj.children[k]!;
          if (c instanceof THREE.Mesh && !willMergeMeshes.has(c)) return true;
          if (c.children.length > 0 && hasUnmergedDescendant(c)) return true;
        }
        return false;
      };
      const evictedParents = new Set<THREE.Mesh>();
      for (const m of willMergeMeshes) {
        if (m.children.length > 0 && hasUnmergedDescendant(m)) {
          evictedParents.add(m);
        }
      }
      if (evictedParents.size > 0) {
        parentChanged = true;
        for (let i = 0; i < finalBuckets.length; i++) {
          finalBuckets[i] = finalBuckets[i]!.filter((item) => !evictedParents.has(item.mesh));
        }
      }
    }
  }

  const invContainerWorld = container.matrixWorld.clone().invert();
  const relMatrix = new THREE.Matrix4();
  const tmpSphereCenter = new THREE.Vector3();

  for (const list of finalBuckets) {
    if (list.length < 2) {
      const single = list[0];
      if (single && !single.indexRange && single.runtimeMaxDist > 0) {
        const s = single.mesh.geometry.boundingSphere;
        if (s) {
          tmpSphereCenter.copy(s.center).applyMatrix4(single.mesh.matrixWorld);
        } else {
          tmpSphereCenter.setFromMatrixPosition(single.mesh.matrixWorld);
        }
        lodController.registerRuntimeDistanceObject(
          single.mesh,
          tmpSphereCenter.x,
          tmpSphereCenter.y,
          tmpSphereCenter.z,
          single.runtimeMaxDist,
          single.mesh.castShadow,
          Boolean(single.zoneId && !lodController.isExteriorZone(single.zoneId))
        );
      }
      continue;
    }

    const firstItem = list[0]!;
    const template = firstItem.mesh;
    const mergedGeo = merger.mergeMeshListFast(list, invContainerWorld, relMatrix);
    if (!mergedGeo) continue;
    if (!mergedGeo.boundingSphere) {
      mergedGeo.computeBoundingSphere();
    }
    const batchLocalCenter = new THREE.Vector3();
    if (mergedGeo.boundingSphere) {
      batchLocalCenter.copy(mergedGeo.boundingSphere.center);
      const cx = batchLocalCenter.x;
      const cy = batchLocalCenter.y;
      const cz = batchLocalCenter.z;
      if (cx * cx + cy * cy + cz * cz > 1e-6) {
        const posAttr = mergedGeo.getAttribute('position') as THREE.BufferAttribute;
        const posArr = posAttr.array as Float32Array;
        for (let p = 0; p < posArr.length; p += 3) {
          posArr[p] = posArr[p]! - cx;
          posArr[p + 1] = posArr[p + 1]! - cy;
          posArr[p + 2] = posArr[p + 2]! - cz;
        }
        posAttr.needsUpdate = true;
        const subBounds = mergedGeo.userData?.subBounds as Float32Array | undefined;
        if (subBounds) {
          for (let b = 0; b < subBounds.length; b += 6) {
            subBounds[b] = subBounds[b]! - cx;
            subBounds[b + 1] = subBounds[b + 1]! - cy;
            subBounds[b + 2] = subBounds[b + 2]! - cz;
            subBounds[b + 3] = subBounds[b + 3]! - cx;
            subBounds[b + 4] = subBounds[b + 4]! - cy;
            subBounds[b + 5] = subBounds[b + 5]! - cz;
          }
        }
        if (mergedGeo.boundingBox) {
          mergedGeo.boundingBox.min.sub(batchLocalCenter);
          mergedGeo.boundingBox.max.sub(batchLocalCenter);
        }
        mergedGeo.boundingSphere.center.set(0, 0, 0);
      } else {
        batchLocalCenter.set(0, 0, 0);
      }
    }

    let anyReceiveShadow = false;
    let anyCastShadow = false;
    let anyInteractive = false;
    let allInteractive = true;
    for (let i = 0; i < list.length; i++) {
      const it = list[i]!;
      if (it.mesh.receiveShadow) anyReceiveShadow = true;
      if (it.mesh.castShadow) anyCastShadow = true;
      if (it.isInteractive) anyInteractive = true;
      else allInteractive = false;
    }

    const mergedMesh = new THREE.Mesh(mergedGeo, firstItem.material);
    const mergedMat = firstItem.material as THREE.MeshStandardMaterial;
    if (mergedMat.blending === THREE.AdditiveBlending && mergedMat.depthWrite === false) {
      mergedMesh.raycast = (): void => {};
    } else {
      accelerateMergedBatchRaycast(mergedMesh);
    }
    const baseName = firstItem.groupPrefix || container.name || 'scene';
    mergedMesh.name = `${baseName}.batch`;
    mergedMesh.castShadow = firstItem.lodTier === 2 ? false : anyCastShadow;
    mergedMesh.receiveShadow = anyReceiveShadow;
    mergedMesh.position.copy(batchLocalCenter);
    mergedMesh.updateMatrix();
    mergedMesh.matrixWorld.multiplyMatrices(container.matrixWorld, mergedMesh.matrix);

    let mergedCutaway: CutawaySpec | undefined;
    if (firstItem.cutawayWall) {
      let minS = firstItem.cutawayWall.minSpan;
      let maxS = firstItem.cutawayWall.maxSpan;
      for (let i = 1; i < list.length; i++) {
        const cw = list[i]!.cutawayWall;
        if (cw) {
          if (cw.minSpan < minS) minS = cw.minSpan;
          if (cw.maxSpan > maxS) maxS = cw.maxSpan;
        }
      }
      mergedCutaway = {
        ...firstItem.cutawayWall,
        minSpan: minS,
        maxSpan: maxS,
      };
    }

    const relOffX = firstItem.offsetX - baseOffsetX;
    const relOffZ = firstItem.offsetZ - baseOffsetZ;
    const relRotY = firstItem.rotationY - baseRotY;

    let sharedZoneId = firstItem.zoneId;
    if (firstItem.lodTier === undefined && sharedZoneId !== undefined) {
      for (let i = 1; i < list.length; i++) {
        if (list[i]!.zoneId !== sharedZoneId) {
          sharedZoneId = undefined;
          break;
        }
      }
    }

    mergedMesh.userData = {
      ...container.userData,
      ...(allInteractive ? template.userData : {}),
      ...(allInteractive ? firstItem.inheritedUserData : {}),
      ...(firstItem.lodTier !== undefined
        ? { lodTier: firstItem.lodTier }
        : { lodTier: undefined }),
      ...(firstItem.floorId !== undefined && typeof container.userData?.floorId !== 'string'
        ? { floorId: firstItem.floorId }
        : {}),
      ...(sharedZoneId !== undefined ? { zoneId: sharedZoneId } : {}),
      ...(mergedCutaway !== undefined ? { cutawayWall: mergedCutaway } : {}),
      ...(Math.abs(relOffX) > 1e-4 || Math.abs(relOffZ) > 1e-4
        ? { containerOffset: [relOffX, 0, relOffZ] }
        : {}),
      ...(Math.abs(relRotY) > 1e-4 ? { containerRotationY: relRotY } : {}),
      isBatchedStaticMesh: true,
    };

    if (firstItem.runtimeMaxDist > 0 && mergedGeo.boundingSphere) {
      tmpSphereCenter
        .copy(mergedGeo.boundingSphere.center)
        .applyMatrix4(mergedMesh.matrixWorld);
      lodController.registerRuntimeDistanceObject(
        mergedMesh,
        tmpSphereCenter.x,
        tmpSphereCenter.y,
        tmpSphereCenter.z,
        firstItem.runtimeMaxDist,
        mergedMesh.castShadow,
        Boolean(sharedZoneId && !lodController.isExteriorZone(sharedZoneId))
      );
    } else if (
      rootTier === undefined &&
      firstItem.zoneId &&
      (firstItem.lodTier === 1 || firstItem.lodTier === 2)
    ) {
      lodController.registerObjectWithTier(
        firstItem.zoneId,
        mergedMesh,
        firstItem.lodTier
      );
      store.registerBatchedLodMesh(mergedMesh);
    }

    if (anyInteractive) {
      newInteractiveMeshes.push(mergedMesh);
    }

    const batchOriginalMeshes: Array<{
      readonly mesh: THREE.Mesh;
      readonly meshParent: THREE.Object3D;
    }> = [];
    const seenInThisBatch = new Set<THREE.Mesh>();

    for (const item of list) {
      if (!seenInThisBatch.has(item.mesh)) {
        seenInThisBatch.add(item.mesh);
        batchOriginalMeshes.push({ mesh: item.mesh, meshParent: item.meshParent });
      }
      if (!batchedOriginalMeshes.has(item.mesh)) {
        store.snapshotMeshPropsIfAbsent(item.mesh);
        store.snapshotParentChildren(item.meshParent);
        if (item.isInteractive && Object.keys(item.inheritedUserData).length > 0) {
          item.mesh.userData = { ...item.inheritedUserData, ...item.mesh.userData };
        }
        if (anyInteractive) {
          item.mesh.userData.__isInteractiveTarget = item.isInteractive;
        }
        item.mesh.userData.__batchOriginalParent = item.meshParent;
        item.meshParent.remove(item.mesh);
        batchedOriginalMeshes.add(item.mesh);
      }
    }

    store.snapshotParentChildren(container);
    container.add(mergedMesh);
    mergedMesh.updateMatrix();
    mergedMesh.matrixWorld.multiplyMatrices(container.matrixWorld, mergedMesh.matrix);

    store.registerBatchRecord({
      parent: container,
      originalMeshes: batchOriginalMeshes,
      mergedMeshes: [mergedMesh],
    });
  }
}

/**
 * Batches static child meshes inside rigid-body dynamic assemblies:
 * - Sliding drawers (`drawerRole === 'group'`, excluding fade-out golf bag materials)
 * - Hinged multi-panel doors (`doorRole === 'pivot'`)
 * - Bifold door leaves (`bifoldPanels[i].group`)
 * - Rigid dining-table sub-groups (`chair.*`, `placeSetting.*`, `extendedSeats`)
 */
export function batchRigidDynamicGroups(
  scene: THREE.Scene,
  ctx: RigidDynamicBatchContext
): void {
  const {
    bifoldPanels,
    indicatorMats,
    batchHooks,
    interactiveSet,
    batchedOriginalMeshes,
    newInteractiveMeshes,
    store,
    merger,
  } = ctx;

  const rigidRootsSet = new Set<THREE.Object3D>();
  for (const panel of bifoldPanels) {
    rigidRootsSet.add(panel.group);
  }

  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Group)) return;
    const u = obj.userData;
    if (
      u?.drawerRole === 'group' ||
      u?.doorRole === 'pivot' ||
      typeof u?.isCarGate === 'boolean' ||
      u?.northPivot === true ||
      u?.southPivot === true ||
      u?.bifoldRole === 'outerPivot' ||
      u?.bifoldRole === 'innerLeaf' ||
      u?.pulleyMaidRole === 'rackMovingGroup' ||
      u?.isRigidDynamicGroup === true ||
      batchHooks.isRigidDynamicGroup?.(obj) === true
    ) {
      rigidRootsSet.add(obj);
    } else if (
      typeof obj.name === 'string' &&
      (obj.name.includes('splitGate.leaf') ||
        obj.name.includes('.doorPivot') ||
        obj.name.endsWith('.domeLid.pivot'))
    ) {
      rigidRootsSet.add(obj);
    }
  });

  interface RigidBucketItem {
    readonly mesh: THREE.Mesh;
    readonly meshParent: THREE.Object3D;
    readonly material: THREE.Material;
    readonly indexRange?: { readonly start: number; readonly count: number };
    readonly isInteractive: boolean;
    readonly inheritedUserData: Record<string, unknown>;
  }

  for (const root of rigidRootsSet) {
    if (!root.userData?.cutawayWall) {
      let hoistedCutaway: unknown;
      const findDescendantCutaway = (node: THREE.Object3D): void => {
        if (hoistedCutaway !== undefined) return;
        if (node !== root && rigidRootsSet.has(node)) return;
        if (node.userData?.cutawayWall) {
          hoistedCutaway = node.userData.cutawayWall;
          return;
        }
        for (let i = 0; i < node.children.length; i++) {
          findDescendantCutaway(node.children[i]!);
        }
      };
      findDescendantCutaway(root);
      if (hoistedCutaway !== undefined) {
        root.userData = {
          ...root.userData,
          isCutawayWall: true,
          cutawayWall: hoistedCutaway,
        };
      }
    }
    const buckets = new Map<string, RigidBucketItem[]>();
    const multiMatExpected = new Map<THREE.Mesh, number>();
    const rootU = (root.userData ?? {}) as Record<string, unknown>;

    // Explicit recursion that halts at nested rigid pivot boundaries (unlike Object3D.traverse).
    const visitRigid = (
      node: THREE.Object3D,
      inheritedUserData: Record<string, unknown>
    ): void => {
      if (node !== root && rigidRootsSet.has(node)) return;
      if (!node.visible) return;

      const u = (node.userData ?? {}) as Record<string, unknown>;
      if (
        u.isGolfSimulatorDynamic ||
        u.pulleyMaidRole === 'pulleyWheel' ||
        u.pulleyMaidRole === 'vertRope'
      ) {
        return;
      }

      let nextUserData = inheritedUserData;
      if (
        u.interactableId !== undefined ||
        u.circuitId !== undefined ||
        u.applianceId !== undefined ||
        u.isBifoldDoor !== undefined ||
        u.isCarGate !== undefined
      ) {
        nextUserData = { ...inheritedUserData, ...u };
      }

      if (
        node instanceof THREE.Mesh &&
        node.parent &&
        !batchedOriginalMeshes.has(node) &&
        node.children.length === 0
      ) {
        const posAttr = node.geometry.getAttribute('position');
        if (posAttr && posAttr.count > 0) {
          const isInt =
            interactiveSet.has(node) ||
            Boolean(nextUserData.interactableId) ||
            Boolean(nextUserData.isBifoldDoor) ||
            Boolean(nextUserData.isCarGate);
          const intKey = buildInteractiveKey(nextUserData, isInt);

          if (!Array.isArray(node.material) && node.material) {
            const mat = node.material;
            if (
              !mat.transparent &&
              mat !== indicatorMats?.tvScreenMat &&
              !Boolean(
                (mat.userData as Record<string, unknown> | undefined)?.isDynamicGolfScreen
              ) &&
              !Boolean(
                (mat.userData as Record<string, unknown> | undefined)?.isDynamicGolfStatusLight
              )
            ) {
              const key = `${mat.uuid}|${intKey}`;
              let list = buckets.get(key);
              if (!list) {
                list = [];
                buckets.set(key, list);
              }
              list.push({
                mesh: node,
                meshParent: node.parent,
                material: mat,
                isInteractive: isInt,
                inheritedUserData: nextUserData,
              });
            }
          } else if (
            Array.isArray(node.material) &&
            node.material.length >= 2 &&
            node.geometry.index &&
            node.geometry.groups.length >= 2
          ) {
            const mats = node.material;
            const groups = node.geometry.groups;
            let allValid = true;
            for (let gIdx = 0; gIdx < groups.length; gIdx++) {
              const grp = groups[gIdx]!;
              const m = mats[grp.materialIndex ?? 0];
              if (
                !m ||
                grp.count <= 0 ||
                m.transparent ||
                m === indicatorMats?.tvScreenMat ||
                Boolean(
                  (m.userData as Record<string, unknown> | undefined)?.isDynamicGolfScreen
                ) ||
                Boolean(
                  (m.userData as Record<string, unknown> | undefined)?.isDynamicGolfStatusLight
                )
              ) {
                allValid = false;
                break;
              }
            }
            if (allValid) {
              multiMatExpected.set(node, groups.length);
              for (let gIdx = 0; gIdx < groups.length; gIdx++) {
                const grp = groups[gIdx]!;
                const mat = mats[grp.materialIndex ?? 0]!;
                const key = `${mat.uuid}|${intKey}`;
                let list = buckets.get(key);
                if (!list) {
                  list = [];
                  buckets.set(key, list);
                }
                list.push({
                  mesh: node,
                  meshParent: node.parent,
                  material: mat,
                  indexRange: { start: grp.start, count: grp.count },
                  isInteractive: isInt,
                  inheritedUserData: nextUserData,
                });
              }
            }
          }
        }
      }

      for (const child of node.children) {
        visitRigid(child, nextUserData);
      }
    };

    visitRigid(root, rootU);

    const rigidLists = [...buckets.values()];
    if (multiMatExpected.size > 0) {
      let changed = true;
      const rejected = new Set<THREE.Mesh>();
      while (changed) {
        changed = false;
        const counts = new Map<THREE.Mesh, number>();
        for (let i = 0; i < rigidLists.length; i++) {
          const l = rigidLists[i]!;
          if (l.length < 2) continue;
          for (let j = 0; j < l.length; j++) {
            const m = l[j]!.mesh;
            if (multiMatExpected.has(m)) counts.set(m, (counts.get(m) ?? 0) + 1);
          }
        }
        for (const [m, exp] of multiMatExpected.entries()) {
          if (!rejected.has(m) && (counts.get(m) ?? 0) < exp) {
            rejected.add(m);
            changed = true;
          }
        }
        if (changed) {
          for (let i = 0; i < rigidLists.length; i++) {
            rigidLists[i] = rigidLists[i]!.filter((it) => !rejected.has(it.mesh));
          }
        }
      }
    }

    const invRootWorld = root.matrixWorld.clone().invert();
    const relMatrix = new THREE.Matrix4();
    const fallbackLabel =
      root.name ||
      root.children.find((c) => typeof c.name === 'string' && c.name.length > 0)?.name ||
      (typeof rootU.interactableId === 'string' ? rootU.interactableId : 'rigid');

    for (const list of rigidLists) {
      if (list.length < 2) continue;
      const first = list[0]!;
      const mergedGeo = merger.mergeMeshListFast(list, invRootWorld, relMatrix);
      if (!mergedGeo) continue;

      let anyCastShadow = false;
      let anyReceiveShadow = false;
      let anyInteractive = false;
      for (let i = 0; i < list.length; i++) {
        const it = list[i]!;
        if (it.mesh.castShadow) anyCastShadow = true;
        if (it.mesh.receiveShadow) anyReceiveShadow = true;
        if (it.isInteractive) anyInteractive = true;
      }

      const mergedMesh = new THREE.Mesh(mergedGeo, first.material);
      accelerateMergedBatchRaycast(mergedMesh);
      mergedMesh.name = `${fallbackLabel}.batch`;
      mergedMesh.castShadow = anyCastShadow;
      mergedMesh.receiveShadow = anyReceiveShadow;
      let allInteractiveRigid = true;
      for (let i = 0; i < list.length; i++) {
        if (!list[i]!.isInteractive) {
          allInteractiveRigid = false;
          break;
        }
      }
      mergedMesh.userData = {
        ...rootU,
        ...(allInteractiveRigid ? first.mesh.userData : {}),
        ...(allInteractiveRigid ? first.inheritedUserData : {}),
        isBatchedStaticMesh: true,
      };
      delete mergedMesh.userData.lodTier;
      delete mergedMesh.userData.lodMaxDistance;

      if (anyInteractive) {
        newInteractiveMeshes.push(mergedMesh);
      }

      const batchOriginalMeshes: Array<{
        readonly mesh: THREE.Mesh;
        readonly meshParent: THREE.Object3D;
      }> = [];
      const seenInBatch = new Set<THREE.Mesh>();

      for (const item of list) {
        if (!seenInBatch.has(item.mesh)) {
          seenInBatch.add(item.mesh);
          batchOriginalMeshes.push({ mesh: item.mesh, meshParent: item.meshParent });
        }
        if (!batchedOriginalMeshes.has(item.mesh)) {
          store.snapshotMeshPropsIfAbsent(item.mesh);
          store.snapshotParentChildren(item.meshParent);
          if (item.isInteractive && Object.keys(item.inheritedUserData).length > 0) {
            item.mesh.userData = { ...item.inheritedUserData, ...item.mesh.userData };
          }
          if (anyInteractive) {
            item.mesh.userData.__isInteractiveTarget = item.isInteractive;
          }
          item.mesh.userData.__batchOriginalParent = item.meshParent;
          item.meshParent.remove(item.mesh);
          batchedOriginalMeshes.add(item.mesh);
        }
      }

      store.snapshotParentChildren(root);
      root.add(mergedMesh);
      mergedMesh.matrixWorld.copy(root.matrixWorld);

      store.registerBatchRecord({
        parent: root,
        originalMeshes: batchOriginalMeshes,
        mergedMeshes: [mergedMesh],
        isRigidLocalBatch: true,
      });
    }
  }
}
