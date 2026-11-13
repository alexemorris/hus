import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type {
  AnnotationToolMode,
  GizmoTransformMode,
  LiveMeasurePreviewState,
  SceneAnnotationHit,
  SceneAnnotationRecord,
  SceneCameraPoseSnapshot,
  SceneObjectTransformAnnotation,
  Vec3Tuple,
} from '../../core/types/scene.ts';
import {
  buildAnnotationMarker3D,
  buildLiveMeasurePreview3D,
  extractSceneAnnotationHit,
  round3,
  toTuple3,
} from './annotation-system.ts';
import {
  clearGroupChildren,
  intersectVisibleObjects,
  isObjectVisibleInHierarchy,
} from '../util/object-utils.ts';
import type { PropertySceneLayers } from '../viewer/scene-content.ts';
import type { RigCamera } from '../camera/camera-rig.ts';

export interface MovableTargetCandidate {
  readonly uuid: string;
  readonly label: string;
  readonly kind: 'group' | 'mesh';
}

interface MovedObjectBaseline {
  readonly obj: THREE.Object3D;
  readonly baseHit: SceneAnnotationHit;
  readonly candidates: readonly MovableTargetCandidate[];
  readonly targetName: string;
  readonly targetPath: readonly string[];
  readonly targetKind: 'group' | 'mesh';
  readonly initialWorldCenter: THREE.Vector3;
  readonly initialWorldMatrix: THREE.Matrix4;
  readonly initialLocalPosition: THREE.Vector3;
  readonly initialLocalQuaternion: THREE.Quaternion;
  readonly initialLocalEulerDeg: Vec3Tuple;
  currentDeltaPos: THREE.Vector3;
  currentDeltaRotDeg: THREE.Vector3;
}

export type ObjectTransformChangeCallback = (
  baseHit: SceneAnnotationHit | null,
  transform: SceneObjectTransformAnnotation | null,
  candidates: readonly MovableTargetCandidate[],
  commitToStore: boolean
) => void;

export type MeasureCompleteCallback = (
  startHit: SceneAnnotationHit,
  endHit: SceneAnnotationHit,
  snappedEndPoint: Vec3Tuple
) => void;

/** Services the annotation controller needs from the owning scene. */
export interface AnnotationControllerHost {
  readonly canvas: HTMLCanvasElement;
  readonly layers: PropertySceneLayers;
  readonly orbitControls: OrbitControls;
  getActiveCamera(): RigCamera;
  getCameraPose(): SceneCameraPoseSnapshot;
  /** Points the shared raycaster through the given client pixel and returns it. */
  setRayFromClient(clientX: number, clientY: number): THREE.Raycaster;
  /** Extra meshes that must never be annotation targets (e.g. additive glow pools). */
  isExcludedFromPicking(mesh: THREE.Mesh): boolean;
  ensureUnbatchedForTransform?(): void;
  /** Unbatches only the picked subtree/zone instead of the entire estate. */
  ensureUnbatchedForTarget?(targetRoot: THREE.Object3D): void;
  requestRender(): void;
  invalidateShadows(): void;
}

/**
 * In-scene authoring tools: pin annotations, measure spans, and move/rotate
 * objects with a transform gizmo (with persisted per-object baselines).
 */
export class SceneAnnotationController {
  private readonly host: AnnotationControllerHost;
  private readonly scene: THREE.Scene;

  private readonly annotationMarkersGroup = new THREE.Group();
  private readonly liveMeasurePreviewGroup = new THREE.Group();
  private readonly transformPivot = new THREE.Object3D();
  private readonly gizmoRootGroup = new THREE.Group();
  private transformControls: TransformControls | null = null;
  private transformControlsPromise: Promise<TransformControls> | null = null;
  private readonly transformSelectionBox: THREE.BoxHelper;
  private wasDraggingGizmo = false;

  private annotationMode = false;
  private annotationToolMode: AnnotationToolMode = 'pin';
  private gizmoTransformMode: GizmoTransformMode = 'translate';
  private measureAxisSnap = false;
  private measureStartHit: SceneAnnotationHit | null = null;

  private readonly movedObjectBaselines = new Map<string, MovedObjectBaseline>();
  private readonly cachedWorldBounds = new WeakMap<THREE.Object3D, THREE.Box3>();
  private readonly scratchSize = new THREE.Vector3();
  private readonly scratchMeshBox = new THREE.Box3();
  private activeMovedUuid: string | null = null;

  private onAnnotationPick: ((hit: SceneAnnotationHit) => void) | null = null;
  private onAnnotationMarkerSelect: ((id: number) => void) | null = null;
  private onObjectTransformChange: ObjectTransformChangeCallback | null = null;
  private onMeasurePreviewChange: ((state: LiveMeasurePreviewState) => void) | null = null;
  private onMeasureComplete: MeasureCompleteCallback | null = null;

  public constructor(host: AnnotationControllerHost) {
    this.host = host;
    this.scene = host.layers.scene;

    this.transformPivot.name = 'annotationTransformPivot';
    this.transformPivot.userData.isAnnotationGroup = true;
    this.gizmoRootGroup.name = 'annotationGizmoGroup';
    this.gizmoRootGroup.userData.isAnnotationGroup = true;

    this.transformSelectionBox = new THREE.BoxHelper(this.transformPivot, 0xffc44d);
    this.transformSelectionBox.visible = false;
    this.transformSelectionBox.userData.isAnnotationGroup = true;

    this.annotationMarkersGroup.name = 'annotationMarkersGroup';
    this.annotationMarkersGroup.userData.isAnnotationGroup = true;
    this.liveMeasurePreviewGroup.name = 'liveMeasurePreviewGroup';
    this.liveMeasurePreviewGroup.userData.isAnnotationGroup = true;
  }

  private ensureTransformControls(): Promise<TransformControls> {
    if (this.transformControls) return Promise.resolve(this.transformControls);
    if (!this.transformControlsPromise) {
      this.transformControlsPromise = import(
        'three/examples/jsm/controls/TransformControls.js'
      ).then(({ TransformControls: TransformControlsCtor }) => {
        const tc = new TransformControlsCtor(this.host.getActiveCamera(), this.host.canvas);
        tc.setSize(0.85);
        tc.setSpace('world');
        tc.setMode(this.gizmoTransformMode);
        tc.enabled = false;
        const tcHelper = tc.getHelper();
        tcHelper.userData.isAnnotationGroup = true;
        tcHelper.traverse((child) => {
          child.userData.isAnnotationGroup = true;
        });
        this.gizmoRootGroup.add(tcHelper);
        tc.addEventListener('change', () => {
          this.host.requestRender();
        });
        tc.addEventListener('dragging-changed', (event) => {
          const isDragging = Boolean(event.value);
          this.host.orbitControls.enabled = !isDragging;
          if (isDragging) {
            this.wasDraggingGizmo = true;
          } else {
            this.syncSelectedPivotToTargetObject(true);
            setTimeout(() => {
              this.wasDraggingGizmo = false;
            }, 40);
          }
          this.host.requestRender();
        });
        tc.addEventListener('objectChange', () => {
          this.syncSelectedPivotToTargetObject(true);
        });
        this.transformControls = tc;
        return tc;
      });
    }
    return this.transformControlsPromise;
  }

  /** Objects the owning scene must add to its root (in this order). */
  public getSceneObjects(): readonly THREE.Object3D[] {
    return [
      this.annotationMarkersGroup,
      this.liveMeasurePreviewGroup,
      this.transformPivot,
      this.gizmoRootGroup,
      this.transformSelectionBox,
    ];
  }

  /** Adds every per-frame-animated annotation object to `out` (excluded from matrix freezing). */
  public collectDynamicObjects(out: Set<THREE.Object3D>): void {
    out.add(this.annotationMarkersGroup);
    out.add(this.liveMeasurePreviewGroup);
    out.add(this.transformPivot);
    out.add(this.gizmoRootGroup);
    out.add(this.transformSelectionBox);
    this.gizmoRootGroup.traverse((child) => out.add(child));
  }

  public setCamera(camera: RigCamera): void {
    if (this.transformControls) {
      this.transformControls.camera = camera;
    }
  }

  /** Refreshes gizmo matrices immediately before a render. */
  public prepareForRender(): void {
    if (this.transformControls?.enabled) {
      this.transformPivot.updateMatrixWorld(true);
      this.transformControls.getHelper().updateMatrixWorld(true);
    }
  }

  public isAnnotationMode(): boolean {
    return this.annotationMode;
  }

  public setAnnotationMode(enabled: boolean): void {
    this.annotationMode = enabled;
    if (!enabled) {
      this.detachMoveGizmo();
      this.cancelActiveMeasurement();
    } else if (
      (this.annotationToolMode === 'move' || this.annotationToolMode === 'rotate') &&
      this.activeMovedUuid
    ) {
      this.attachGizmoToActiveBaseline();
    }
    this.host.canvas.style.cursor = enabled ? 'crosshair' : 'grab';
    this.host.requestRender();
  }

  public toggleAnnotationMode(): boolean {
    this.setAnnotationMode(!this.annotationMode);
    return this.annotationMode;
  }

  public getAnnotationToolMode(): AnnotationToolMode {
    return this.annotationToolMode;
  }

  public setAnnotationToolMode(tool: AnnotationToolMode): void {
    this.annotationToolMode = tool;
    if (tool === 'move' || tool === 'rotate') {
      void this.ensureTransformControls();
    }
    if (tool === 'move') {
      this.gizmoTransformMode = 'translate';
      this.transformControls?.setMode('translate');
    } else if (tool === 'rotate') {
      this.gizmoTransformMode = 'rotate';
      this.transformControls?.setMode('rotate');
    }
    if (!this.annotationMode) {
      this.setAnnotationMode(true);
    }
    if (tool !== 'measure') {
      this.cancelActiveMeasurement();
    }
    if (tool !== 'move' && tool !== 'rotate') {
      this.detachMoveGizmo();
    } else if (this.activeMovedUuid) {
      this.attachGizmoToActiveBaseline();
    }
    this.host.requestRender();
  }

  public getGizmoTransformMode(): GizmoTransformMode {
    return this.gizmoTransformMode;
  }

  public setGizmoTransformMode(mode: GizmoTransformMode): void {
    this.gizmoTransformMode = mode;
    if (this.annotationToolMode === 'move' || this.annotationToolMode === 'rotate') {
      this.annotationToolMode = mode === 'rotate' ? 'rotate' : 'move';
    }
    this.transformControls?.setMode(mode);
    this.host.requestRender();
  }

  public getMeasureAxisSnap(): boolean {
    return this.measureAxisSnap;
  }

  public setMeasureAxisSnap(enabled: boolean): void {
    this.measureAxisSnap = enabled;
  }

  public cancelActiveMeasurement(): void {
    this.measureStartHit = null;
    clearGroupChildren(this.liveMeasurePreviewGroup);
    this.onMeasurePreviewChange?.({
      active: false,
      startPoint: null,
      currentEndPoint: null,
      deltaXYZ: null,
      horizontalDistanceM: null,
      distanceM: null,
      axisSnapLocked: this.measureAxisSnap,
    });
    this.host.requestRender();
  }

  public setOnAnnotationPick(cb: ((hit: SceneAnnotationHit) => void) | null): void {
    this.onAnnotationPick = cb;
  }

  public setOnAnnotationMarkerSelect(cb: ((id: number) => void) | null): void {
    this.onAnnotationMarkerSelect = cb;
  }

  public setOnObjectTransformChange(cb: ObjectTransformChangeCallback | null): void {
    this.onObjectTransformChange = cb;
  }

  public setOnMeasurePreviewChange(
    cb: ((state: LiveMeasurePreviewState) => void) | null
  ): void {
    this.onMeasurePreviewChange = cb;
  }

  public setOnMeasureComplete(cb: MeasureCompleteCallback | null): void {
    this.onMeasureComplete = cb;
  }

  public syncAnnotationMarkers(
    records: readonly SceneAnnotationRecord[],
    selectedId: number | null
  ): void {
    clearGroupChildren(this.annotationMarkersGroup);

    for (const r of records) {
      const marker = buildAnnotationMarker3D(r, r.id === selectedId);
      this.annotationMarkersGroup.add(marker);
    }
    this.annotationMarkersGroup.updateMatrixWorld(true);
    this.host.requestRender();
  }

  /**
   * Reapplies saved `move` annotations from localStorage on initial load so previously
   * moved objects appear at their saved positions and can be further edited or reset.
   */
  public reapplySavedMoveAnnotations(records: readonly SceneAnnotationRecord[]): void {
    for (const r of records) {
      if (r.kind !== 'move' || !r.objectTransform) continue;
      const tf = r.objectTransform;
      let targetObj: THREE.Object3D | null =
        this.scene.getObjectByProperty('uuid', tf.targetUuid) ?? null;
      if (!targetObj && tf.targetName && tf.targetName !== '(unnamed mesh)') {
        targetObj = this.scene.getObjectByName(tf.targetName) ?? null;
      }
      if (!targetObj) continue;

      const baseline = this.ensureObjectBaseline(targetObj, r, [
        {
          uuid: targetObj.uuid,
          label: `${tf.targetKind === 'group' ? 'Group' : 'Mesh'}: ${tf.targetName}`,
          kind: tf.targetKind,
        },
      ]);
      baseline.currentDeltaPos.set(
        tf.deltaTranslation[0],
        tf.deltaTranslation[1],
        tf.deltaTranslation[2]
      );
      baseline.currentDeltaRotDeg.set(
        tf.deltaRotationDeg[0],
        tf.deltaRotationDeg[1],
        tf.deltaRotationDeg[2]
      );
      this.applyBaselineTransformToObject(baseline);
    }
    this.host.invalidateShadows();
    this.host.requestRender();
  }

  public detachMoveGizmo(): void {
    if (this.transformControls) {
      this.transformControls.detach();
      this.transformControls.enabled = false;
    }
    this.transformSelectionBox.visible = false;
    this.host.orbitControls.enabled = true;
    this.onObjectTransformChange?.(null, null, [], false);
    this.host.requestRender();
  }

  public switchSelectedMoveCandidate(targetUuid: string): void {
    if (!this.activeMovedUuid) return;
    const prevBaseline = this.movedObjectBaselines.get(this.activeMovedUuid);
    if (!prevBaseline) return;
    const targetObj = this.scene.getObjectByProperty('uuid', targetUuid);
    if (!targetObj) return;

    const nextBaseline = this.ensureObjectBaseline(
      targetObj,
      prevBaseline.baseHit,
      prevBaseline.candidates
    );
    this.activeMovedUuid = nextBaseline.obj.uuid;
    this.attachGizmoToActiveBaseline(false);
  }

  public selectMovedObjectByUuid(targetUuid: string): boolean {
    const baseline = this.movedObjectBaselines.get(targetUuid);
    if (!baseline) return false;
    this.activeMovedUuid = targetUuid;
    if (
      this.annotationMode &&
      (this.annotationToolMode === 'move' || this.annotationToolMode === 'rotate')
    ) {
      this.attachGizmoToActiveBaseline(false);
    } else {
      const payload = this.buildTransformAnnotationPayload(baseline);
      this.onObjectTransformChange?.(baseline.baseHit, payload, baseline.candidates, false);
    }
    return true;
  }

  public nudgeSelectedObject(
    dx: number,
    dy: number,
    dz: number,
    dRotYDeg = 0,
    dRotXDeg = 0,
    dRotZDeg = 0
  ): void {
    if (!this.activeMovedUuid) return;
    const baseline = this.movedObjectBaselines.get(this.activeMovedUuid);
    if (!baseline) return;

    baseline.currentDeltaPos.x = round3(baseline.currentDeltaPos.x + dx);
    baseline.currentDeltaPos.y = round3(baseline.currentDeltaPos.y + dy);
    baseline.currentDeltaPos.z = round3(baseline.currentDeltaPos.z + dz);
    baseline.currentDeltaRotDeg.x = round3(baseline.currentDeltaRotDeg.x + dRotXDeg);
    baseline.currentDeltaRotDeg.y = round3(baseline.currentDeltaRotDeg.y + dRotYDeg);
    baseline.currentDeltaRotDeg.z = round3(baseline.currentDeltaRotDeg.z + dRotZDeg);

    this.applyBaselineTransformToObject(baseline);
    this.attachGizmoToActiveBaseline(true);
    this.host.invalidateShadows();
    this.host.requestRender();
  }

  public setSelectedObjectDeltaTransform(
    dx: number,
    dy: number,
    dz: number,
    dRotYDeg: number,
    dRotXDeg?: number,
    dRotZDeg?: number
  ): void {
    if (!this.activeMovedUuid) return;
    const baseline = this.movedObjectBaselines.get(this.activeMovedUuid);
    if (!baseline) return;

    baseline.currentDeltaPos.set(round3(dx), round3(dy), round3(dz));
    if (typeof dRotXDeg === 'number') {
      baseline.currentDeltaRotDeg.x = round3(dRotXDeg);
    }
    baseline.currentDeltaRotDeg.y = round3(dRotYDeg);
    if (typeof dRotZDeg === 'number') {
      baseline.currentDeltaRotDeg.z = round3(dRotZDeg);
    }

    this.applyBaselineTransformToObject(baseline);
    this.attachGizmoToActiveBaseline(true);
    this.host.invalidateShadows();
    this.host.requestRender();
  }

  public resetMovedObject(targetUuid?: string): void {
    const uuid = targetUuid ?? this.activeMovedUuid;
    if (!uuid) return;
    const baseline = this.movedObjectBaselines.get(uuid);
    if (!baseline) return;

    baseline.currentDeltaPos.set(0, 0, 0);
    baseline.currentDeltaRotDeg.set(0, 0, 0);
    this.applyBaselineTransformToObject(baseline);
    if (
      this.activeMovedUuid === uuid &&
      (this.annotationToolMode === 'move' || this.annotationToolMode === 'rotate')
    ) {
      this.attachGizmoToActiveBaseline(false);
    }
    this.host.invalidateShadows();
    this.host.requestRender();
  }

  public isGizmoDragging(): boolean {
    return this.transformControls?.dragging ?? false;
  }

  /** True while dragging or within the short grace period after a gizmo drag ends. */
  public isGizmoBusy(): boolean {
    return this.wasDraggingGizmo || (this.transformControls?.dragging ?? false);
  }

  public isAwaitingMeasureEnd(): boolean {
    return (
      this.annotationMode &&
      this.annotationToolMode === 'measure' &&
      this.measureStartHit !== null
    );
  }

  public getHoverCursor(): string {
    return this.annotationToolMode === 'move' || this.annotationToolMode === 'rotate'
      ? 'pointer'
      : 'crosshair';
  }

  public intersectMarkers(raycaster: THREE.Raycaster): THREE.Intersection[] {
    if (this.annotationMarkersGroup.children.length === 0) return [];
    return intersectVisibleObjects(raycaster, this.annotationMarkersGroup.children, true);
  }

  /** Live 3D measurement rubber-band line preview while waiting for point B. */
  public updateMeasurePreviewAt(clientX: number, clientY: number, shiftKey: boolean): void {
    const startHit = this.measureStartHit;
    if (!startHit) return;
    const rawPoint = this.raycastScenePointOnly(clientX, clientY);
    if (!rawPoint) return;

    const snapLocked = this.measureAxisSnap || shiftKey;
    const pA = startHit.worldPoint;
    const pB = this.computeSnappedMeasureEndPoint(pA, rawPoint, snapLocked);
    const dx = round3(pB[0] - pA[0]);
    const dy = round3(pB[1] - pA[1]);
    const dz = round3(pB[2] - pA[2]);
    const horizDist = round3(Math.hypot(dx, dz));
    const dist = round3(Math.hypot(dx, dy, dz));

    clearGroupChildren(this.liveMeasurePreviewGroup);
    const previewMesh = buildLiveMeasurePreview3D(pA, pB, snapLocked);
    this.liveMeasurePreviewGroup.add(previewMesh);
    this.liveMeasurePreviewGroup.updateMatrixWorld(true);
    this.host.requestRender();

    this.onMeasurePreviewChange?.({
      active: true,
      startPoint: pA,
      currentEndPoint: pB,
      deltaXYZ: [dx, dy, dz],
      horizontalDistanceM: horizDist,
      distanceM: dist,
      axisSnapLocked: snapLocked,
    });
  }

  /**
   * Handles a click (pointer-up without drag). `raycaster` must already be set
   * through the click position. Returns true if the click was consumed by an
   * annotation marker or an annotation tool.
   */
  public handleClick(raycaster: THREE.Raycaster, e: PointerEvent): boolean {
    // Check if clicking an existing 3D annotation marker (unless currently picking Measure Point B)
    if (!this.isAwaitingMeasureEnd()) {
      const firstMarker = this.intersectMarkers(raycaster)[0];
      if (firstMarker) {
        const annId = firstMarker.object.userData?.annotationId as number | undefined;
        if (typeof annId === 'number' && this.onAnnotationMarkerSelect) {
          this.onAnnotationMarkerSelect(annId);
          return true;
        }
      }
    }

    // If in Annotation Mode (or holding Shift), dispatch to the active tool ('pin' | 'move' | 'rotate' | 'measure')
    if (!this.annotationMode && !e.shiftKey) {
      return false;
    }

    const picked = this.raycastSceneMeshAndHit(e.clientX, e.clientY);
    if (!picked) return true;

    const effectiveTool: AnnotationToolMode = this.annotationMode
      ? this.annotationToolMode
      : 'pin';

    if (effectiveTool === 'move' || effectiveTool === 'rotate') {
      const subtreeRoot = this.resolveMovableSubtreeRoot(picked.mesh);
      if (this.host.ensureUnbatchedForTarget) {
        this.host.ensureUnbatchedForTarget(subtreeRoot);
      } else {
        this.host.ensureUnbatchedForTransform?.();
      }
      this.gizmoTransformMode = effectiveTool === 'rotate' ? 'rotate' : 'translate';
      const { defaultTarget, candidates } = this.collectMovableCandidatesForMesh(picked.mesh);
      const baseline = this.ensureObjectBaseline(defaultTarget, picked.hit, candidates);
      this.activeMovedUuid = baseline.obj.uuid;
      this.attachGizmoToActiveBaseline(false);
      return true;
    }

    if (effectiveTool === 'measure') {
      if (!this.measureStartHit) {
        // Set Start Point A
        this.measureStartHit = picked.hit;
        clearGroupChildren(this.liveMeasurePreviewGroup);
        const previewMesh = buildLiveMeasurePreview3D(
          picked.hit.worldPoint,
          null,
          this.measureAxisSnap || e.shiftKey
        );
        this.liveMeasurePreviewGroup.add(previewMesh);
        this.liveMeasurePreviewGroup.updateMatrixWorld(true);
        this.host.requestRender();
        this.onMeasurePreviewChange?.({
          active: true,
          startPoint: picked.hit.worldPoint,
          currentEndPoint: null,
          deltaXYZ: null,
          horizontalDistanceM: null,
          distanceM: null,
          axisSnapLocked: this.measureAxisSnap || e.shiftKey,
        });
      } else {
        // Complete span at End Point B
        const startHit = this.measureStartHit;
        const snapLocked = this.measureAxisSnap || e.shiftKey;
        const snappedEnd = this.computeSnappedMeasureEndPoint(
          startHit.worldPoint,
          picked.hit.worldPoint,
          snapLocked
        );
        this.cancelActiveMeasurement();
        this.onMeasureComplete?.(startHit, picked.hit, snappedEnd);
      }
      return true;
    }

    // Default 'pin' tool
    if (this.onAnnotationPick) {
      this.onAnnotationPick(picked.hit);
    }
    return true;
  }

  private isRootContainerGroup(obj: THREE.Object3D): boolean {
    const layers = this.host.layers;
    return (
      obj === this.scene ||
      obj === layers.firstFloorMeshGroup ||
      obj === layers.groundFloorCeilingGroup ||
      obj === layers.ceilingMeshGroup ||
      obj === layers.cutawayWallGroups.southWest ||
      obj === layers.cutawayWallGroups.west ||
      obj === layers.cutawayWallGroups.north ||
      obj === layers.cutawayWallGroups.east
    );
  }

  private resolveMovableSubtreeRoot(mesh: THREE.Mesh): THREE.Object3D {
    let top: THREE.Object3D = mesh;
    let cur: THREE.Object3D | null = mesh;
    while (cur && !this.isRootContainerGroup(cur)) {
      top = cur;
      const storedParent = cur.userData?.__batchOriginalParent as THREE.Object3D | undefined;
      cur = cur.parent ?? storedParent ?? null;
    }
    return top;
  }

  private invalidateCachedBounds(obj: THREE.Object3D): void {
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      this.cachedWorldBounds.delete(cur);
      cur = cur.parent;
    }
  }

  private getCachedWorldBox(obj: THREE.Object3D): THREE.Box3 {
    const cached = this.cachedWorldBounds.get(obj);
    if (cached) return cached;
    const box = new THREE.Box3();
    if (obj instanceof THREE.Mesh) {
      if (!obj.geometry.boundingBox) {
        obj.geometry.computeBoundingBox();
      }
      if (obj.geometry.boundingBox) {
        this.scratchMeshBox.copy(obj.geometry.boundingBox).applyMatrix4(obj.matrixWorld);
        box.union(this.scratchMeshBox);
      }
    }
    for (let i = 0; i < obj.children.length; i++) {
      const childBox = this.getCachedWorldBox(obj.children[i]!);
      if (!childBox.isEmpty()) {
        box.union(childBox);
      }
    }
    this.cachedWorldBounds.set(obj, box);
    return box;
  }

  private collectMovableCandidatesForMesh(mesh: THREE.Mesh): {
    readonly defaultTarget: THREE.Object3D;
    readonly candidates: readonly MovableTargetCandidate[];
  } {
    const chain: THREE.Object3D[] = [];
    let cur: THREE.Object3D | null = mesh;
    while (cur && !this.isRootContainerGroup(cur)) {
      chain.unshift(cur);
      cur = cur.parent;
    }

    const candidates: MovableTargetCandidate[] = [];
    let defaultTarget: THREE.Object3D = mesh;
    let foundDefault = false;

    for (const item of chain) {
      const isGroup = !(item instanceof THREE.Mesh);
      const kind: 'group' | 'mesh' = isGroup ? 'group' : 'mesh';
      const box = this.getCachedWorldBox(item);
      const size = box.isEmpty() ? this.scratchSize.set(0, 0, 0) : box.getSize(this.scratchSize);
      const diag = size.length();
      const rawName =
        item.name ||
        (typeof item.userData?.interactableId === 'string'
          ? item.userData.interactableId
          : isGroup
            ? `Group (${round3(size.x)}×${round3(size.z)}m)`
            : `Mesh (${round3(size.x)}×${round3(size.y)}×${round3(size.z)}m)`);
      candidates.push({
        uuid: item.uuid,
        label: `${isGroup ? 'Group' : 'Mesh'}: ${rawName}`,
        kind,
      });

      // Prefer the outermost semantic furniture/fixture group whose bounding box diagonal is <= 8.5m
      if (!foundDefault && diag <= 8.5) {
        defaultTarget = item;
        foundDefault = true;
      }
    }

    return { defaultTarget, candidates };
  }

  private describeObjectTargetPath(obj: THREE.Object3D): {
    readonly targetName: string;
    readonly targetPath: readonly string[];
    readonly targetKind: 'group' | 'mesh';
  } {
    const targetKind: 'group' | 'mesh' = obj instanceof THREE.Mesh ? 'mesh' : 'group';
    const path: string[] = [];
    let cur: THREE.Object3D | null = obj;
    while (cur && cur !== this.scene) {
      if (cur.name) {
        path.unshift(cur.name);
      }
      cur = cur.parent;
    }
    const targetName =
      obj.name ||
      path[path.length - 1] ||
      (targetKind === 'group' ? '(unnamed group)' : '(unnamed mesh)');
    return { targetName, targetPath: path, targetKind };
  }

  private ensureObjectBaseline(
    targetObj: THREE.Object3D,
    baseHit: SceneAnnotationHit,
    candidates: readonly MovableTargetCandidate[]
  ): MovedObjectBaseline {
    const existing = this.movedObjectBaselines.get(targetObj.uuid);
    if (existing) {
      return existing;
    }

    targetObj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(targetObj);
    const initialWorldCenter = box.getCenter(new THREE.Vector3());
    const initialEuler = new THREE.Euler().setFromQuaternion(targetObj.quaternion, 'YXZ');
    const initialLocalEulerDeg: Vec3Tuple = [
      round3(THREE.MathUtils.radToDeg(initialEuler.x)),
      round3(THREE.MathUtils.radToDeg(initialEuler.y)),
      round3(THREE.MathUtils.radToDeg(initialEuler.z)),
    ];
    const { targetName, targetPath, targetKind } = this.describeObjectTargetPath(targetObj);

    const baseline: MovedObjectBaseline = {
      obj: targetObj,
      baseHit,
      candidates,
      targetName,
      targetPath,
      targetKind,
      initialWorldCenter,
      initialWorldMatrix: targetObj.matrixWorld.clone(),
      initialLocalPosition: targetObj.position.clone(),
      initialLocalQuaternion: targetObj.quaternion.clone(),
      initialLocalEulerDeg,
      currentDeltaPos: new THREE.Vector3(0, 0, 0),
      currentDeltaRotDeg: new THREE.Vector3(0, 0, 0),
    };
    this.movedObjectBaselines.set(targetObj.uuid, baseline);
    return baseline;
  }

  private applyBaselineTransformToObject(baseline: MovedObjectBaseline): void {
    const c0 = baseline.initialWorldCenter;
    const dp = baseline.currentDeltaPos;
    const dr = baseline.currentDeltaRotDeg;

    const deltaQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        THREE.MathUtils.degToRad(dr.x),
        THREE.MathUtils.degToRad(dr.y),
        THREE.MathUtils.degToRad(dr.z),
        'YXZ'
      )
    );

    const tNegC0 = new THREE.Matrix4().makeTranslation(-c0.x, -c0.y, -c0.z);
    const rDelta = new THREE.Matrix4().makeRotationFromQuaternion(deltaQuat);
    const tNewC = new THREE.Matrix4().makeTranslation(c0.x + dp.x, c0.y + dp.y, c0.z + dp.z);

    const newWorldMatrix = new THREE.Matrix4()
      .multiplyMatrices(tNewC, rDelta)
      .multiply(tNegC0)
      .multiply(baseline.initialWorldMatrix);

    const parent = baseline.obj.parent;
    if (parent) {
      parent.updateMatrixWorld(true);
      const parentInv = parent.matrixWorld.clone().invert();
      const newLocalMatrix = parentInv.multiply(newWorldMatrix);
      newLocalMatrix.decompose(baseline.obj.position, baseline.obj.quaternion, baseline.obj.scale);
      baseline.obj.rotation.setFromQuaternion(baseline.obj.quaternion, 'YXZ');
    }
    baseline.obj.updateMatrix();
    baseline.obj.updateMatrixWorld(true);
    this.invalidateCachedBounds(baseline.obj);
  }

  private buildTransformAnnotationPayload(
    baseline: MovedObjectBaseline
  ): SceneObjectTransformAnnotation {
    const newCenter = baseline.initialWorldCenter.clone().add(baseline.currentDeltaPos);
    const curEuler = new THREE.Euler().setFromQuaternion(baseline.obj.quaternion, 'YXZ');
    const newRotationDeg: Vec3Tuple = [
      round3(THREE.MathUtils.radToDeg(curEuler.x)),
      round3(THREE.MathUtils.radToDeg(curEuler.y)),
      round3(THREE.MathUtils.radToDeg(curEuler.z)),
    ];

    return {
      targetUuid: baseline.obj.uuid,
      targetName: baseline.targetName,
      targetPath: baseline.targetPath,
      targetKind: baseline.targetKind,
      initialWorldCenter: toTuple3(baseline.initialWorldCenter),
      newWorldCenter: toTuple3(newCenter),
      deltaTranslation: toTuple3(baseline.currentDeltaPos),
      initialObjectPosition: toTuple3(baseline.initialLocalPosition),
      newObjectPosition: toTuple3(baseline.obj.position),
      initialRotationDeg: baseline.initialLocalEulerDeg,
      newRotationDeg,
      deltaRotationDeg: toTuple3(baseline.currentDeltaRotDeg),
    };
  }

  private attachGizmoToActiveBaseline(commitToStore = false): void {
    if (!this.activeMovedUuid) {
      this.detachMoveGizmo();
      return;
    }
    const baseline = this.movedObjectBaselines.get(this.activeMovedUuid);
    if (!baseline) {
      this.detachMoveGizmo();
      return;
    }

    this.transformPivot.position.copy(baseline.initialWorldCenter).add(baseline.currentDeltaPos);
    this.transformPivot.quaternion.setFromEuler(
      new THREE.Euler(
        THREE.MathUtils.degToRad(baseline.currentDeltaRotDeg.x),
        THREE.MathUtils.degToRad(baseline.currentDeltaRotDeg.y),
        THREE.MathUtils.degToRad(baseline.currentDeltaRotDeg.z),
        'YXZ'
      )
    );
    this.transformPivot.updateMatrix();
    this.transformPivot.updateMatrixWorld(true);

    const attachControls = (tc: TransformControls): void => {
      if (this.activeMovedUuid !== baseline.obj.uuid) return;
      tc.camera = this.host.getActiveCamera();
      tc.setMode(this.gizmoTransformMode);
      tc.enabled = true;
      tc.attach(this.transformPivot);
      tc.getHelper().updateMatrixWorld(true);
      this.host.requestRender();
    };
    if (this.transformControls) {
      attachControls(this.transformControls);
    } else {
      void this.ensureTransformControls().then(attachControls);
    }

    this.transformSelectionBox.setFromObject(baseline.obj);
    this.transformSelectionBox.visible = true;
    this.transformSelectionBox.updateMatrixWorld(true);

    const payload = this.buildTransformAnnotationPayload(baseline);
    this.onObjectTransformChange?.(baseline.baseHit, payload, baseline.candidates, commitToStore);
    this.host.requestRender();
  }

  private syncSelectedPivotToTargetObject(commitToStore: boolean): void {
    if (!this.activeMovedUuid) return;
    const baseline = this.movedObjectBaselines.get(this.activeMovedUuid);
    if (!baseline) return;

    baseline.currentDeltaPos.copy(this.transformPivot.position).sub(baseline.initialWorldCenter);
    const euler = new THREE.Euler().setFromQuaternion(this.transformPivot.quaternion, 'YXZ');
    baseline.currentDeltaRotDeg.set(
      round3(THREE.MathUtils.radToDeg(euler.x)),
      round3(THREE.MathUtils.radToDeg(euler.y)),
      round3(THREE.MathUtils.radToDeg(euler.z))
    );

    this.applyBaselineTransformToObject(baseline);
    this.transformSelectionBox.setFromObject(baseline.obj);
    this.transformSelectionBox.updateMatrixWorld(true);
    this.host.invalidateShadows();
    this.host.requestRender();

    const payload = this.buildTransformAnnotationPayload(baseline);
    this.onObjectTransformChange?.(baseline.baseHit, payload, baseline.candidates, commitToStore);
  }

  private isInsideAnnotationGroup(obj: THREE.Object3D): boolean {
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      if (
        cur === this.annotationMarkersGroup ||
        cur === this.liveMeasurePreviewGroup ||
        cur === this.transformPivot ||
        cur === this.gizmoRootGroup ||
        cur === this.transformSelectionBox ||
        cur.userData?.isAnnotationGroup
      ) {
        return true;
      }
      cur = cur.parent;
    }
    return false;
  }

  private isAnnotatableSceneMesh(obj: THREE.Object3D): obj is THREE.Mesh {
    if (!(obj instanceof THREE.Mesh)) return false;
    if (!isObjectVisibleInHierarchy(obj)) return false;
    if (this.isInsideAnnotationGroup(obj)) return false;
    if (this.host.isExcludedFromPicking(obj)) return false;

    const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    if (mat) {
      if (mat.blending === THREE.AdditiveBlending) return false;
      if (mat.transparent && mat.opacity < 0.15) return false;
    }
    return true;
  }

  private raycastScenePointOnly(clientX: number, clientY: number): Vec3Tuple | null {
    const raycaster = this.host.setRayFromClient(clientX, clientY);
    const hits = intersectVisibleObjects(raycaster, this.scene.children, true);
    const validHit = hits.find((h) => this.isAnnotatableSceneMesh(h.object));
    if (!validHit) return null;
    return toTuple3(validHit.point);
  }

  private raycastSceneMeshAndHit(
    clientX: number,
    clientY: number
  ): { readonly mesh: THREE.Mesh; readonly hit: SceneAnnotationHit } | null {
    const raycaster = this.host.setRayFromClient(clientX, clientY);
    const hits = intersectVisibleObjects(raycaster, this.scene.children, true);
    const validHit = hits.find((h) => this.isAnnotatableSceneMesh(h.object));
    if (!validHit || !(validHit.object instanceof THREE.Mesh)) {
      return null;
    }

    const resolvedMesh =
      (validHit as THREE.Intersection & { readonly originalMesh?: THREE.Mesh }).originalMesh ??
      validHit.object;

    const layers = this.host.layers;
    const hit = extractSceneAnnotationHit(
      validHit,
      resolvedMesh,
      this.scene,
      {
        firstFloorMeshGroup: layers.firstFloorMeshGroup,
        groundFloorCeilingGroup: layers.groundFloorCeilingGroup,
        ceilingMeshGroup: layers.ceilingMeshGroup,
        southWestWallGroup: layers.cutawayWallGroups.southWest,
        westWallGroup: layers.cutawayWallGroups.west,
        northWallGroup: layers.cutawayWallGroups.north,
        eastWallGroup: layers.cutawayWallGroups.east,
      },
      this.host.getCameraPose()
    );
    return { mesh: resolvedMesh, hit };
  }

  private computeSnappedMeasureEndPoint(
    startPoint: Vec3Tuple,
    rawEndPoint: Vec3Tuple,
    snapAxis: boolean
  ): Vec3Tuple {
    if (!snapAxis) return rawEndPoint;
    const dx = Math.abs(rawEndPoint[0] - startPoint[0]);
    const dy = Math.abs(rawEndPoint[1] - startPoint[1]);
    const dz = Math.abs(rawEndPoint[2] - startPoint[2]);
    if (dx >= dy && dx >= dz) {
      return [rawEndPoint[0], startPoint[1], startPoint[2]];
    }
    if (dz >= dx && dz >= dy) {
      return [startPoint[0], startPoint[1], rawEndPoint[2]];
    }
    return [startPoint[0], rawEndPoint[1], startPoint[2]];
  }
}
