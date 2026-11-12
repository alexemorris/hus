import type * as THREE from 'three';
import type {
  LiveMeasurePreviewState,
  SceneAnnotationHit,
  SceneAnnotationRecord,
  SceneObjectTransformAnnotation,
  Vec3Tuple,
} from '../../../core/types/scene.ts';
import {
  SceneAnnotationController,
  type AnnotationControllerHost,
  type MovableTargetCandidate,
} from '../../annotation/annotation-controller.ts';
import { Emitter } from '../../util/emitter.ts';

export interface AnnotationServiceHost extends AnnotationControllerHost {
  /** True when static batching is allowed (e.g. in owner trade view). */
  canUseStaticBatching(): boolean;
  unbatchAll(): void;
  unbatchSubtree(targetRoot: THREE.Object3D): number;
  optimizeBatches(): void;
  freezeStaticMatrices(): void;
  captureFurnitureColliders(): void;
  invalidateObstacleCache(): void;
  /** Re-evaluates cutaways for the current view (force-notifying listeners). */
  refreshView(): void;
}

/**
 * Annotation authoring tools (pin / measure / move-rotate). Wraps the
 * `SceneAnnotationController` with multi-listener events and subtree-scoped
 * unbatching while objects are editable.
 */
export class AnnotationService {
  public readonly controller: SceneAnnotationController;
  public readonly pick = new Emitter<[hit: SceneAnnotationHit]>();
  public readonly markerSelect = new Emitter<[id: number]>();
  public readonly measurePreview = new Emitter<[state: LiveMeasurePreviewState]>();
  public readonly measureComplete = new Emitter<
    [startHit: SceneAnnotationHit, endHit: SceneAnnotationHit, snappedEndPoint: Vec3Tuple]
  >();
  public readonly objectTransform = new Emitter<
    [
      baseHit: SceneAnnotationHit | null,
      transform: SceneObjectTransformAnnotation | null,
      candidates: readonly MovableTargetCandidate[],
      commitToStore: boolean,
    ]
  >();
  private readonly host: AnnotationServiceHost;
  private unbatchedForTransform = false;

  public constructor(host: AnnotationServiceHost) {
    this.host = host;
    this.controller = new SceneAnnotationController({
      get canvas() {
        return host.canvas;
      },
      get layers() {
        return host.layers;
      },
      get orbitControls() {
        return host.orbitControls;
      },
      getActiveCamera: () => host.getActiveCamera(),
      getCameraPose: () => host.getCameraPose(),
      setRayFromClient: (x, y) => host.setRayFromClient(x, y),
      isExcludedFromPicking: (m) => host.isExcludedFromPicking(m),
      ensureUnbatchedForTransform: () => this.ensureUnbatchedForTransform(),
      ensureUnbatchedForTarget: (targetRoot) => this.ensureUnbatchedForTarget(targetRoot),
      requestRender: () => host.requestRender(),
      invalidateShadows: () => host.invalidateShadows(),
    });
    this.controller.setOnAnnotationPick((hit) => this.pick.emit(hit));
    this.controller.setOnAnnotationMarkerSelect((id) => this.markerSelect.emit(id));
    this.controller.setOnMeasurePreviewChange((state) => this.measurePreview.emit(state));
    this.controller.setOnMeasureComplete((a, b, p) => this.measureComplete.emit(a, b, p));
    this.controller.setOnObjectTransformChange((hit, t, candidates, commit) =>
      this.objectTransform.emit(hit, t, candidates, commit)
    );
  }

  public isActive(): boolean {
    return this.controller.isAnnotationMode();
  }

  /**
   * Unbatches only the picked subtree/zone when Move/Rotate selects an object,
   * keeping all other rooms batched for fast raycasting and low draw calls.
   */
  public ensureUnbatchedForTarget(targetRoot: THREE.Object3D): void {
    const dissolved = this.host.unbatchSubtree(targetRoot);
    if (dissolved > 0) {
      this.unbatchedForTransform = true;
      this.host.refreshView();
    }
  }

  /**
   * Fallback full-scene unbatch when a caller lacks a specific target subtree.
   */
  public ensureUnbatchedForTransform(): void {
    if (this.unbatchedForTransform) return;
    this.unbatchedForTransform = true;
    this.host.unbatchAll();
    this.host.refreshView();
    this.host.freezeStaticMatrices();
  }

  /**
   * Enables / disables authoring. Static batches remain intact on activation
   * (0 ms tool switch); Move/Rotate dissolves only the clicked object's subtree
   * on demand and re-batches cleanly on exit.
   */
  public setActive(enabled: boolean): void {
    const { host } = this;
    this.controller.setAnnotationMode(enabled);
    if (!enabled && this.unbatchedForTransform) {
      this.unbatchedForTransform = false;
      if (host.canUseStaticBatching()) {
        host.captureFurnitureColliders();
        host.optimizeBatches();
        host.refreshView();
        host.freezeStaticMatrices();
      }
      host.invalidateObstacleCache();
      host.invalidateShadows();
    }
    host.requestRender();
  }

  public toggleActive(): boolean {
    this.setActive(!this.controller.isAnnotationMode());
    return this.controller.isAnnotationMode();
  }

  /** Re-applies persisted move / rotate annotations to their target objects. */
  public reapplySavedMoves(records: readonly SceneAnnotationRecord[]): void {
    const moveRecords = records.filter((r) => r.kind === 'move' && Boolean(r.objectTransform));
    if (moveRecords.length === 0) return;
    const { host } = this;
    let dissolvedAny = false;
    for (const r of moveRecords) {
      const tf = r.objectTransform;
      if (!tf) continue;
      const target =
        host.layers.scene.getObjectByProperty('uuid', tf.targetUuid) ??
        (tf.targetName && tf.targetName !== '(unnamed mesh)'
          ? host.layers.scene.getObjectByName(tf.targetName)
          : undefined);
      if (target) {
        if (host.unbatchSubtree(target) > 0) dissolvedAny = true;
      } else {
        host.unbatchAll();
        dissolvedAny = true;
        break;
      }
    }
    this.controller.reapplySavedMoveAnnotations(records);
    if (dissolvedAny && !this.unbatchedForTransform && host.canUseStaticBatching()) {
      host.captureFurnitureColliders();
      host.optimizeBatches();
    }
    host.invalidateObstacleCache();
    host.freezeStaticMatrices();
  }
}
