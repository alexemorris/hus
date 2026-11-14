import * as THREE from 'three';
import type { RoomLodController } from '../../lod/lod-manager.ts';
import { getMountedFloorLodRoots, type PropertySceneLayers } from '../../viewer/scene-content.ts';
import { restoreDefaultMeshRaycast } from '../mesh-bvh.ts';
import { SHADOW_PASS_HOOK_FLAG } from './scene-batch-classification.ts';

export interface BatchedGroupRecord {
  readonly parent: THREE.Object3D;
  readonly originalMeshes: readonly {
    readonly mesh: THREE.Mesh;
    readonly meshParent: THREE.Object3D;
  }[];
  readonly mergedMeshes: readonly THREE.Mesh[];
  readonly isRigidLocalBatch?: boolean;
}

export interface DormantWarmupEntry {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material | THREE.Material[];
  readonly castShadow: boolean;
  readonly receiveShadow: boolean;
  readonly frontFaceCW: boolean;
  readonly name: string;
}

export interface OriginalMeshProps {
  readonly material: THREE.Material | THREE.Material[];
  readonly geometry: THREE.BufferGeometry;
  readonly castShadow: boolean;
  readonly userData: Record<string, unknown>;
}

export interface UnbatchAllContext {
  readonly layers: PropertySceneLayers;
  readonly lodController: RoomLodController;
  readonly interactiveMeshes: THREE.Object3D[];
  readonly onBeforeBatchChange?: () => void;
  readonly onAfterBatchChange?: () => void;
}

export interface UnbatchSubtreeContext {
  readonly lodController: RoomLodController;
  readonly interactiveMeshes: THREE.Object3D[];
  readonly toCanonicalGeo: (geo: THREE.BufferGeometry) => THREE.BufferGeometry;
  readonly onBeforeBatchChange?: () => void;
  readonly onAfterBatchChange?: () => void;
}

/**
 * Owns reversible batch records, original mesh property & parent-order snapshots,
 * BVH raycast restoration, empty-group pruning state, and dormant warmup descriptors.
 */
export class BatchRestorationStore {
  private readonly batchRecords: BatchedGroupRecord[] = [];
  private readonly originalChildrenByParent = new Map<THREE.Object3D, THREE.Object3D[]>();
  private readonly originalMeshProps = new Map<THREE.Mesh, OriginalMeshProps>();
  private readonly recordsByOriginalMesh = new Map<THREE.Mesh, BatchedGroupRecord[]>();
  private readonly bvhAcceleratedMeshes = new Set<THREE.Mesh>();
  private readonly geometrySwappedMeshes = new Set<THREE.Mesh>();
  private readonly prunedEmptyGroups = new Set<THREE.Object3D>();
  private readonly allRegisteredBatchMeshes = new Set<THREE.Object3D>();
  private originalInteractiveMeshes: THREE.Object3D[] | null = null;
  private originalInteractiveSet = new Set<THREE.Object3D>();
  private hasEverUnbatched = false;
  private isCurrentlyBatched = false;
  private subtreeUnbatchCount = 0;
  private extraLodBound = false;

  public isBatched(): boolean {
    return this.isCurrentlyBatched;
  }

  public markBatched(): void {
    this.isCurrentlyBatched = true;
  }

  public hasSwappedGeometry(mesh: THREE.Mesh): boolean {
    return this.geometrySwappedMeshes.has(mesh);
  }

  public hasPartialUnbatch(): boolean {
    return this.subtreeUnbatchCount > 0;
  }

  public isExtraLodBound(): boolean {
    return this.extraLodBound;
  }

  public markExtraLodBound(): void {
    this.extraLodBound = true;
  }

  public clearRegisteredBatchMeshes(): void {
    this.allRegisteredBatchMeshes.clear();
  }

  public registerBatchedLodMesh(mesh: THREE.Object3D): void {
    this.allRegisteredBatchMeshes.add(mesh);
  }

  public registerBvhAcceleratedMesh(mesh: THREE.Mesh): void {
    this.bvhAcceleratedMeshes.add(mesh);
  }

  public snapshotMeshPropsIfAbsent(mesh: THREE.Mesh): void {
    if (!this.originalMeshProps.has(mesh)) {
      this.originalMeshProps.set(mesh, {
        material: mesh.material,
        geometry: mesh.geometry,
        castShadow: mesh.castShadow,
        userData: { ...mesh.userData },
      });
    }
  }

  public snapshotSceneMeshes(scene: THREE.Scene): void {
    scene.traverse((obj: THREE.Object3D) => {
      if (obj instanceof THREE.Mesh) {
        this.snapshotMeshPropsIfAbsent(obj);
      }
    });
  }

  public snapshotInteractiveMeshes(
    interactiveMeshes: readonly THREE.Object3D[],
    extraInteractiveMeshes?: readonly THREE.Object3D[]
  ): ReadonlySet<THREE.Object3D> {
    const merged: THREE.Object3D[] = [...interactiveMeshes];
    if (extraInteractiveMeshes && extraInteractiveMeshes.length > 0) {
      const seen = new Set<THREE.Object3D>(merged);
      for (let i = 0; i < extraInteractiveMeshes.length; i++) {
        const m = extraInteractiveMeshes[i]!;
        if (!seen.has(m)) {
          seen.add(m);
          merged.push(m);
        }
      }
    }
    this.originalInteractiveMeshes = merged;
    this.originalInteractiveSet = new Set<THREE.Object3D>(merged);
    this.recordsByOriginalMesh.clear();
    this.subtreeUnbatchCount = 0;
    return this.originalInteractiveSet;
  }

  public snapshotParentChildren(parent: THREE.Object3D): void {
    if (!this.originalChildrenByParent.has(parent)) {
      this.originalChildrenByParent.set(parent, [...parent.children]);
    }
  }

  public markGeometrySwappedIfPostUnbatch(mesh: THREE.Mesh): void {
    if (this.hasEverUnbatched) {
      this.geometrySwappedMeshes.add(mesh);
    }
  }

  public registerBatchRecord(rec: BatchedGroupRecord): void {
    this.batchRecords.push(rec);
    for (let i = 0; i < rec.originalMeshes.length; i++) {
      const m = rec.originalMeshes[i]!.mesh;
      let list = this.recordsByOriginalMesh.get(m);
      if (!list) {
        list = [];
        this.recordsByOriginalMesh.set(m, list);
      }
      list.push(rec);
    }
  }

  /**
   * Restores all merged `THREE.Mesh` batches back to their original individual `THREE.Mesh` nodes
   * in their exact original `parent.children` order and with their original materials.
   *
   * Intentionally leaves consolidated & hoisted PointLights intact so `NUM_POINT_LIGHTS` never
   * changes and shaders never recompile.
   */
  public unbatchAll(ctx: UnbatchAllContext): void {
    if (!this.isCurrentlyBatched) return;

    ctx.onBeforeBatchChange?.();
    const { layers, lodController, interactiveMeshes, onAfterBatchChange } = ctx;
    lodController.clearRuntimeDistanceObjects();
    if (this.allRegisteredBatchMeshes.size > 0) {
      lodController.removeBatchedObjects(this.allRegisteredBatchMeshes);
      this.allRegisteredBatchMeshes.clear();
    }

    for (let i = this.batchRecords.length - 1; i >= 0; i--) {
      const rec = this.batchRecords[i]!;
      for (const merged of rec.mergedMeshes) {
        rec.parent.remove(merged);
        merged.geometry.dispose();
      }
      for (const { mesh, meshParent } of rec.originalMeshes) {
        if (mesh.userData) {
          delete mesh.userData.__batchOriginalParent;
        }
        meshParent.add(mesh);
      }
    }

    for (const [parent, origChildren] of this.originalChildrenByParent.entries()) {
      for (const child of origChildren) {
        if (child.parent !== parent) {
          parent.add(child);
        }
      }
      parent.children.length = 0;
      parent.children.push(...origChildren);
    }

    for (const g of this.prunedEmptyGroups) {
      delete g.userData.__prunedEmptyBatchGroup;
      g.visible = true;
    }
    this.prunedEmptyGroups.clear();

    for (const m of this.bvhAcceleratedMeshes) {
      restoreDefaultMeshRaycast(m);
    }
    this.bvhAcceleratedMeshes.clear();

    for (const [mesh, props] of this.originalMeshProps.entries()) {
      mesh.material = props.material;
      if (mesh.geometry !== props.geometry) {
        mesh.geometry = props.geometry;
        this.geometrySwappedMeshes.add(mesh);
      }
      mesh.castShadow = props.castShadow;
      mesh.userData = { ...props.userData };
      mesh.matrixAutoUpdate = true;
      (mesh as unknown as { static?: boolean }).static = false;
    }

    if (this.originalInteractiveMeshes !== null) {
      interactiveMeshes.length = 0;
      interactiveMeshes.push(...this.originalInteractiveMeshes);
      this.originalInteractiveMeshes = null;
      this.originalInteractiveSet.clear();
    }

    this.batchRecords.length = 0;
    this.recordsByOriginalMesh.clear();
    this.originalChildrenByParent.clear();
    this.originalMeshProps.clear();
    this.hasEverUnbatched = true;
    this.isCurrentlyBatched = false;
    this.subtreeUnbatchCount = 0;
    this.extraLodBound = false;

    lodController.indexBuiltSceneHierarchy(getMountedFloorLodRoots(layers));
    onAfterBatchChange?.();
  }

  /**
   * Unbatches only the merged batch meshes that contain at least one constituent `THREE.Mesh`
   * inside `targetRoot` (transitively including any partner batch for split multi-material walls),
   * keeping all other rooms/zones batched for fast raycasting and low draw calls.
   * Returns the number of merged batch meshes dissolved.
   */
  public unbatchSubtree(targetRoot: THREE.Object3D, ctx: UnbatchSubtreeContext): number {
    if (!this.isCurrentlyBatched || this.batchRecords.length === 0) return 0;

    const isInsideTarget = (mesh: THREE.Object3D): boolean => {
      let cur: THREE.Object3D | null = mesh;
      while (cur) {
        if (cur === targetRoot) return true;
        const savedParent = cur.userData?.__batchOriginalParent as THREE.Object3D | undefined;
        cur = savedParent ?? cur.parent;
      }
      return false;
    };

    const recordsToDissolve = new Set<BatchedGroupRecord>();
    const queue: BatchedGroupRecord[] = [];

    for (let i = 0; i < this.batchRecords.length; i++) {
      const rec = this.batchRecords[i]!;
      if (rec.isRigidLocalBatch && isInsideTarget(rec.parent)) {
        for (const merged of rec.mergedMeshes) {
          merged.matrixAutoUpdate = true;
          (merged as unknown as { static?: boolean }).static = false;
        }
        continue;
      }
      for (let j = 0; j < rec.originalMeshes.length; j++) {
        if (isInsideTarget(rec.originalMeshes[j]!.mesh)) {
          recordsToDissolve.add(rec);
          queue.push(rec);
          break;
        }
      }
    }

    if (queue.length === 0) return 0;

    // Transitive closure for multi-material meshes whose faces span 2+ merged batch records
    while (queue.length > 0) {
      const rec = queue.pop()!;
      for (let j = 0; j < rec.originalMeshes.length; j++) {
        const linked = this.recordsByOriginalMesh.get(rec.originalMeshes[j]!.mesh);
        if (!linked) continue;
        for (let k = 0; k < linked.length; k++) {
          const partner = linked[k]!;
          if (!recordsToDissolve.has(partner)) {
            recordsToDissolve.add(partner);
            queue.push(partner);
          }
        }
      }
    }

    ctx.onBeforeBatchChange?.();
    const { lodController, interactiveMeshes, toCanonicalGeo, onAfterBatchChange } = ctx;

    const dissolvedMergedSet = new Set<THREE.Object3D>();
    const liveInteractiveSet = new Set<THREE.Object3D>(interactiveMeshes);
    const touchedParents = new Set<THREE.Object3D>();
    let dissolvedMergedCount = 0;

    for (let i = this.batchRecords.length - 1; i >= 0; i--) {
      const rec = this.batchRecords[i]!;
      if (!recordsToDissolve.has(rec)) continue;
      this.batchRecords.splice(i, 1);

      for (const merged of rec.mergedMeshes) {
        rec.parent.remove(merged);
        merged.geometry.dispose();
        dissolvedMergedSet.add(merged);
        this.allRegisteredBatchMeshes.delete(merged);
        dissolvedMergedCount++;
      }

      for (const { mesh, meshParent } of rec.originalMeshes) {
        this.recordsByOriginalMesh.delete(mesh);
        if (mesh.userData) {
          delete mesh.userData.__batchOriginalParent;
        }
        const props = this.originalMeshProps.get(mesh);
        if (props) {
          mesh.material = props.material;
          const restoredGeo = toCanonicalGeo(props.geometry);
          if (mesh.geometry !== restoredGeo) {
            mesh.geometry = restoredGeo;
            this.geometrySwappedMeshes.add(mesh);
          }
          mesh.castShadow = props.castShadow;
          mesh.userData = { ...props.userData };
        }
        mesh.matrixAutoUpdate = true;
        (mesh as unknown as { static?: boolean }).static = false;
        if (mesh.parent !== meshParent) {
          meshParent.add(mesh);
        }
        touchedParents.add(meshParent);
        if (this.originalInteractiveSet.has(mesh) && !liveInteractiveSet.has(mesh)) {
          interactiveMeshes.push(mesh);
          liveInteractiveSet.add(mesh);
        }
      }
    }

    if (dissolvedMergedSet.size > 0) {
      lodController.removeBatchedObjects(dissolvedMergedSet);
      for (let i = interactiveMeshes.length - 1; i >= 0; i--) {
        if (dissolvedMergedSet.has(interactiveMeshes[i]!)) {
          interactiveMeshes.splice(i, 1);
        }
      }
    }

    for (const p of touchedParents) {
      p.matrixAutoUpdate = true;
      p.updateMatrixWorld(true);
    }
    targetRoot.matrixAutoUpdate = true;
    targetRoot.updateMatrixWorld(true);

    const unpruneAncestors = (start: THREE.Object3D | null): void => {
      for (let cur = start; cur !== null; cur = cur.parent) {
        if (this.prunedEmptyGroups.has(cur)) {
          delete cur.userData.__prunedEmptyBatchGroup;
          cur.visible = true;
          this.prunedEmptyGroups.delete(cur);
        }
      }
    };
    unpruneAncestors(targetRoot);
    for (const p of touchedParents) {
      unpruneAncestors(p);
    }
    for (const g of [...this.prunedEmptyGroups]) {
      if (isInsideTarget(g) || touchedParents.has(g)) {
        delete g.userData.__prunedEmptyBatchGroup;
        g.visible = true;
        this.prunedEmptyGroups.delete(g);
      }
    }

    for (const m of [...this.bvhAcceleratedMeshes]) {
      if (isInsideTarget(m)) {
        restoreDefaultMeshRaycast(m);
        this.bvhAcceleratedMeshes.delete(m);
      }
    }
    this.subtreeUnbatchCount += dissolvedMergedCount;
    onAfterBatchChange?.();
    return dissolvedMergedCount;
  }

  public pruneEmptyGroupsPostOrder(
    scene: THREE.Scene,
    topContainers: ReadonlySet<THREE.Object3D>,
    protectedObjects: ReadonlySet<THREE.Object3D>
  ): void {
    const visit = (node: THREE.Object3D): boolean => {
      const anyNode = node as THREE.Object3D & {
        isMesh?: boolean;
        isLight?: boolean;
        isLine?: boolean;
        isPoints?: boolean;
        isSprite?: boolean;
        isCamera?: boolean;
      };
      let hasActiveContent = Boolean(
        anyNode.isMesh ||
          anyNode.isLight ||
          anyNode.isLine ||
          anyNode.isPoints ||
          anyNode.isSprite ||
          anyNode.isCamera ||
          node.userData?.[SHADOW_PASS_HOOK_FLAG]
      );
      for (let i = 0; i < node.children.length; i++) {
        if (visit(node.children[i]!)) {
          hasActiveContent = true;
        }
      }
      if (
        !hasActiveContent &&
        node !== scene &&
        !topContainers.has(node as THREE.Group) &&
        !protectedObjects.has(node) &&
        node.userData?.isVariationOptionRoot !== true &&
        node.visible
      ) {
        node.userData.__prunedEmptyBatchGroup = true;
        node.visible = false;
        this.prunedEmptyGroups.add(node);
      }
      return hasActiveContent || protectedObjects.has(node);
    };
    visit(scene);
  }

  /**
   * Visits materials of original meshes currently absorbed into static batches without
   * allocating transient `THREE.Mesh` objects.
   */
  public forEachDormantMaterial(visitor: (mat: THREE.Material) => void): void {
    const seen = new Set<THREE.Material>();
    for (const [mesh, props] of this.originalMeshProps.entries()) {
      if (!this.recordsByOriginalMesh.has(mesh)) continue;
      const mat = props.material;
      if (Array.isArray(mat)) {
        for (let i = 0; i < mat.length; i++) {
          const m = mat[i];
          if (m && !seen.has(m)) {
            seen.add(m);
            visitor(m);
          }
        }
      } else if (mat && !seen.has(mat)) {
        seen.add(mat);
        visitor(mat);
      }
    }
  }

  /**
   * Returns lightweight warmup descriptors for original meshes currently absorbed into
   * static batches so `warmUpForStartup()` pre-compiles their exact GPURenderPipelines
   * without allocating ~30,000 transient `THREE.Mesh` objects.
   */
  public getDormantWarmupEntries(
    toCanonicalGeo: (geo: THREE.BufferGeometry) => THREE.BufferGeometry
  ): DormantWarmupEntry[] {
    const dormant: DormantWarmupEntry[] = [];
    for (const [mesh, props] of this.originalMeshProps.entries()) {
      if (!this.recordsByOriginalMesh.has(mesh)) continue;
      const canonGeo = toCanonicalGeo(props.geometry);
      dormant.push({
        geometry: canonGeo,
        material: props.material,
        castShadow: props.castShadow,
        receiveShadow: mesh.receiveShadow,
        frontFaceCW: mesh.matrixWorld.determinant() < 0,
        name: mesh.name || mesh.type,
      });
    }
    return dormant;
  }
}
