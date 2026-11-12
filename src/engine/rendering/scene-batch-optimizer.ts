import * as THREE from 'three';
import type { TimeOfDay } from '../../core/types/scene.ts';
import type { RoomLodController } from '../lod/lod-manager.ts';
import type { BatchOptimizerHooks } from '../viewer/property-scene-profile.ts';
import type { PropertySceneLayers, RoomSwitchLedBinding } from '../viewer/scene-content.ts';
import type {
  BifoldPanelRef,
  LightGroupMap,
  ZoneIndicatorMaterials,
} from '../viewer/scene-types.ts';
import {
  BatchRestorationStore,
  type DormantWarmupEntry,
} from './batching/batch-restoration-store.ts';
import { FastGeometryMerger } from './batching/fast-geometry-merger.ts';
import { MaterialTextureDeduplicator } from './batching/material-texture-deduplicator.ts';
import {
  ALWAYS_HOIST_LIGHT_FLAG,
  CARRIER_POINT_LIGHT_POOL_SIZE,
  getPointLightBudgetWeight,
  type ManagedPointLightEntry,
  notifyCircuitLevelsChanged,
  type PointLightBudgetAnchor,
  PointLightBudgetController,
  POINT_LIGHT_BUDGET_WEIGHT_KEY,
} from './batching/point-light-budget-controller.ts';
import {
  bindAdditionalInteriorLodGroups,
  collectMutableMaterials,
  collectProtectedObjects,
  collectVisibilityContainers,
  isMaterialRenderDynamic,
  resolveBatchHooks,
  SHADOW_PASS_HOOK_FLAG,
} from './batching/scene-batch-classification.ts';
import {
  batchContainerSubtree,
  batchRigidDynamicGroups,
} from './batching/static-container-batcher.ts';
import { accelerateStaticMeshRaycast, prebuildGeometryBvh } from './mesh-bvh.ts';

export {
  ALWAYS_HOIST_LIGHT_FLAG,
  CARRIER_POINT_LIGHT_POOL_SIZE,
  type DormantWarmupEntry,
  getPointLightBudgetWeight,
  type ManagedPointLightEntry,
  notifyCircuitLevelsChanged,
  type PointLightBudgetAnchor,
  POINT_LIGHT_BUDGET_WEIGHT_KEY,
  SHADOW_PASS_HOOK_FLAG,
};

export interface SceneBatchOptimizerOptions {
  readonly layers: PropertySceneLayers;
  readonly lodController: RoomLodController;
  readonly interactiveMeshes: THREE.Object3D[];
  readonly getExtraInteractiveMeshes?: () => readonly THREE.Object3D[];
  readonly bifoldPanels: readonly BifoldPanelRef[];
  readonly lightGroups: LightGroupMap;
  readonly indicatorMats: ZoneIndicatorMaterials;
  readonly roomSwitchLedMats: readonly RoomSwitchLedBinding[];
  readonly getDynamicObjects: () => Set<THREE.Object3D>;
  /** Home-specific batching rules; defaults to the hooks of the profile the scene was built from. */
  readonly batchHooks?: BatchOptimizerHooks;
  /** Called before any batch/unbatch mutation (e.g. to suspend trade-view material overlays). */
  readonly onBeforeBatchChange?: () => void;
  readonly onAfterBatchChange?: () => void;
}

/**
 * Runtime static-geometry batcher, material deduplicator, shadow-caster filter,
 * PointLight consolidator, and distance-LOD binder.
 *
 * Public orchestrator facade composing the modular sub-systems in `./batching/*`.
 */
export class SceneBatchOptimizer {
  private readonly options: SceneBatchOptimizerOptions;
  private readonly store = new BatchRestorationStore();
  private readonly merger = new FastGeometryMerger();
  private readonly deduplicator = new MaterialTextureDeduplicator();
  private readonly lightController: PointLightBudgetController;

  public constructor(options: SceneBatchOptimizerOptions) {
    this.options = options;
    this.lightController = new PointLightBudgetController({
      layers: options.layers,
      lodController: options.lodController,
      lightGroups: options.lightGroups,
      snapshotParentChildren: (parent) => this.store.snapshotParentChildren(parent),
    });
  }

  private get batchHooks(): BatchOptimizerHooks {
    return resolveBatchHooks(this.options.batchHooks, this.options.layers.scene);
  }

  public optimize(): void {
    if (this.store.isBatched()) {
      this.unbatchAll();
    }
    this.options.onBeforeBatchChange?.();

    const {
      layers,
      lodController,
      interactiveMeshes,
      bifoldPanels,
      lightGroups,
      indicatorMats,
      roomSwitchLedMats,
      getDynamicObjects,
      onAfterBatchChange,
    } = this.options;
    const { scene, firstFloorMeshGroup, groundFloorCeilingGroup, ceilingMeshGroup } = layers;
    const hooks = this.batchHooks;

    scene.updateMatrixWorld(true);
    lodController.clearRuntimeDistanceObjects();
    this.store.clearRegisteredBatchMeshes();
    this.store.snapshotSceneMeshes(scene);
    lodController.indexBuiltSceneHierarchy([scene, firstFloorMeshGroup], {
      deepBatchClassification: true,
    });

    if (!this.store.isExtraLodBound()) {
      bindAdditionalInteriorLodGroups(layers, lodController, hooks);
      this.store.markExtraLodBound();
    }

    const extraInteractive = this.options.getExtraInteractiveMeshes?.() ?? [];
    const interactiveSet = this.store.snapshotInteractiveMeshes(interactiveMeshes, extraInteractive);
    const protectedObjects = collectProtectedObjects(
      layers,
      bifoldPanels,
      getDynamicObjects,
      hooks
    );
    const mutableMaterials = collectMutableMaterials(
      layers,
      lightGroups,
      indicatorMats,
      roomSwitchLedMats,
      hooks
    );

    this.deduplicator.deduplicateMaterialsAndCullSmallShadows(scene, mutableMaterials, {
      lodController,
      store: this.store,
    });

    for (const child of ceilingMeshGroup.children) {
      if (child.userData?.isRoomContainer && !child.visible) child.visible = true;
    }
    for (const child of groundFloorCeilingGroup.children) {
      if (child.userData?.isRoomContainer && !child.visible) child.visible = true;
    }

    const { topContainers, allContainers } = collectVisibilityContainers(
      scene,
      layers,
      protectedObjects,
      hooks
    );

    const batchedOriginalMeshes = new Set<THREE.Object3D>();
    const newInteractiveMeshes: THREE.Object3D[] = [];

    for (const container of allContainers) {
      batchContainerSubtree(container, {
        topContainers,
        protectedObjects,
        mutableMaterials,
        interactiveSet,
        batchedOriginalMeshes,
        newInteractiveMeshes,
        lodController,
        indicatorMats,
        batchHooks: hooks,
        store: this.store,
        merger: this.merger,
      });
    }

    batchRigidDynamicGroups(scene, {
      bifoldPanels,
      indicatorMats,
      batchHooks: hooks,
      interactiveSet,
      batchedOriginalMeshes,
      newInteractiveMeshes,
      mutableMaterials,
      store: this.store,
      merger: this.merger,
    });

    const updatedInteractive: THREE.Object3D[] = [];
    const updatedSet = new Set<THREE.Object3D>();
    const candidateInteractive = extraInteractive.length > 0
      ? [...interactiveMeshes, ...extraInteractive]
      : interactiveMeshes;
    for (const obj of candidateInteractive) {
      if (updatedSet.has(obj)) continue;
      if (batchedOriginalMeshes.has(obj)) continue;
      if (
        obj instanceof THREE.Mesh &&
        (obj.userData?.isInteractiveRaycastExcluded === true ||
          hooks.isInteractiveRaycastExcluded?.(obj) === true)
      ) {
        continue;
      }
      updatedSet.add(obj);
      updatedInteractive.push(obj);
    }
    for (const merged of newInteractiveMeshes) {
      updatedInteractive.push(merged);
    }
    interactiveMeshes.length = 0;
    interactiveMeshes.push(...updatedInteractive);

    if (batchedOriginalMeshes.size > 0) {
      lodController.removeBatchedObjects(batchedOriginalMeshes);
    }

    this.lightController.consolidateAndHoistOnce();
    this.merger.canonicalizeUnmergedVertexLayouts(scene, this.store);

    scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh) || obj.userData?.[SHADOW_PASS_HOOK_FLAG]) return;
      if (obj.userData?.isBatchedStaticMesh) {
        prebuildGeometryBvh(obj.geometry, 64);
        return;
      }
      if (!obj.userData?.isGolfSimulatorDynamic) {
        if (accelerateStaticMeshRaycast(obj, 64)) {
          this.store.registerBvhAcceleratedMesh(obj);
        }
        prebuildGeometryBvh(obj.geometry, 64);
      }
    });

    this.store.pruneEmptyGroupsPostOrder(scene, topContainers, protectedObjects);
    this.store.markBatched();
    this.lightController.applyManagedLightIntensities();
    onAfterBatchChange?.();
  }

  public unbatchAll(): void {
    this.store.unbatchAll({
      layers: this.options.layers,
      lodController: this.options.lodController,
      interactiveMeshes: this.options.interactiveMeshes,
      onBeforeBatchChange: this.options.onBeforeBatchChange,
      onAfterBatchChange: this.options.onAfterBatchChange,
    });
  }

  public unbatchSubtree(targetRoot: THREE.Object3D): number {
    return this.store.unbatchSubtree(targetRoot, {
      lodController: this.options.lodController,
      interactiveMeshes: this.options.interactiveMeshes,
      toCanonicalGeo: (geo) => this.merger.toCanonicalVertexLayoutGeometry(geo),
      onBeforeBatchChange: this.options.onBeforeBatchChange,
      onAfterBatchChange: this.options.onAfterBatchChange,
    });
  }

  public isBatched(): boolean {
    return this.store.isBatched();
  }

  public hasSwappedGeometry(mesh: THREE.Mesh): boolean {
    return this.store.hasSwappedGeometry(mesh);
  }

  public hasPartialUnbatch(): boolean {
    return this.store.hasPartialUnbatch();
  }

  public setTimeOfDay(mode: TimeOfDay): void {
    this.lightController.setTimeOfDay(mode);
  }

  public enableCarrierPointLightPool(
    poolSize: number,
    initialCameraPos?: THREE.Vector3
  ): void {
    this.lightController.enableCarrierPointLightPool(poolSize, initialCameraPos);
  }

  public setPointLightBudget(n: number): boolean {
    return this.lightController.setPointLightBudget(n);
  }

  public getPointLightBudget(): number {
    return this.lightController.getPointLightBudget();
  }

  public setBudgetAnchorZone(anchor: PointLightBudgetAnchor): boolean {
    return this.lightController.setBudgetAnchorZone(anchor);
  }

  public stepFades(dtSeconds: number): boolean {
    return this.lightController.stepFades(dtSeconds);
  }

  public hasPendingFades(): boolean {
    return this.lightController.hasPendingFades();
  }

  public getManagedPointLights(): readonly ManagedPointLightEntry[] {
    return this.lightController.getManagedPointLights();
  }

  public syncPointLightVisibilityAndDistance(
    cameraPos: THREE.Vector3,
    firstFloorVisible: boolean
  ): boolean {
    return this.lightController.syncPointLightVisibilityAndDistance(cameraPos, firstFloorVisible);
  }

  public getMutableMaterials(): Set<THREE.Material> {
    const { layers, lightGroups, indicatorMats, roomSwitchLedMats } = this.options;
    return collectMutableMaterials(
      layers,
      lightGroups,
      indicatorMats,
      roomSwitchLedMats,
      this.batchHooks
    );
  }

  public isMaterialRenderDynamic(
    mat: THREE.Material | null | undefined,
    mutableMaterials: ReadonlySet<THREE.Material>
  ): boolean {
    return isMaterialRenderDynamic(mat, mutableMaterials, this.options.indicatorMats);
  }

  public forEachDormantMaterial(visitor: (mat: THREE.Material) => void): void {
    this.store.forEachDormantMaterial(visitor);
  }

  public getDormantWarmupEntries(): DormantWarmupEntry[] {
    return this.store.getDormantWarmupEntries((geo) =>
      this.merger.toCanonicalVertexLayoutGeometry(geo)
    );
  }
}
