import { batch } from '@preact/signals';
import type { TwinApi, Unsubscribe } from '../../core/types/twin-api.ts';
import type {
  AnnotationToolMode,
  SceneAnnotationRecord,
} from '../../core/types/scene.ts';
import {
  activeTransformState,
  annotationTool,
  annotationsList,
  annotatorActive,
  annotatorGizmoMode,
  liveMeasureState,
  measureAxisSnap,
  requestAnnotatorFieldFocus,
  selectedAnnotationId,
} from '../../state/notes-store.ts';
import { devMode } from '../../state/shell-store.ts';
import {
  copyTextWithFallback,
  downloadNotesJson,
} from './notes-export.ts';
import { AnnotatorPinsOverlayRenderer } from './annotator-pins-renderer.ts';
import {
  createScopedTwinApi,
  resolveHouseIdentity,
  type ScopedNotesOptions,
  type ScopedTwinNotesApi,
} from './scoped-annotations.ts';

/**
 * Headless notes / measure / move-object controller.
 *
 * Bridges per-house scoped `TwinApi.notes` & `TwinApi.camera` with reactive
 * `@preact/signals` in `src/state/notes-store.ts` so `<AnnotatorPanel />` and
 * `<AnnotatorPinsOverlay />` render inside `<HusShell />` with zero cross-house bleed.
 */
export class AnnotatorController {
  private readonly api: TwinApi;
  private readonly notes: ScopedTwinNotesApi;
  private readonly pinsOverlay: AnnotatorPinsOverlayRenderer;
  private readonly disposers: Unsubscribe[] = [];

  private readonly onWindowKeyDown = (e: KeyboardEvent): void => {
    if (this.api.walkthrough.isActive() || !this.notes.isActive()) return;
    const tag = document.activeElement?.tagName ?? '';
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const key = e.key.toLowerCase();
    if (key === 'p') {
      e.preventDefault();
      this.selectTool('pin', true);
    } else if (key === 'r') {
      e.preventDefault();
      this.selectTool('measure', true);
    } else if (key === 'e' && devMode.value) {
      e.preventDefault();
      this.selectTool('rotate', true);
    } else if (e.key === 'Escape') {
      if (liveMeasureState.value?.active) {
        this.notes.cancelMeasurement();
        liveMeasureState.value = null;
      } else {
        this.notes.setActive(false);
        this.syncModeSignals();
      }
    }
  };

  private readonly onPopState = (): void => {
    const next = resolveHouseIdentity(this.api);
    if (next.houseId !== this.notes.getHouseId()) {
      this.setActiveHouse(next.houseId, next.houseName);
    }
  };

  public constructor(api: TwinApi, options?: ScopedNotesOptions) {
    const scoped = createScopedTwinApi(api, options);
    this.api = scoped.api;
    this.notes = scoped.notes;

    this.pinsOverlay = new AnnotatorPinsOverlayRenderer(this.api.camera, (id) => {
      this.handleMarkerOrPinSelect(id);
    });

    // Reapply any saved object moves/rotations for this house from localStorage before syncing markers
    this.notes.reapplyMoves(this.notes.getRecords());

    this.bindEngineEvents();

    const onRecords = (
      records: readonly SceneAnnotationRecord[],
      selectedId: number | null
    ): void => {
      this.notes.syncMarkers(records, selectedId);
      this.pinsOverlay.syncRecords(records, selectedId);
      batch(() => {
        annotatorActive.value = this.notes.isActive();
        annotationTool.value = this.notes.getToolMode();
        annotatorGizmoMode.value = this.notes.getGizmoMode();
        measureAxisSnap.value = this.notes.getMeasureAxisSnap();
        annotationsList.value = [...records];
        selectedAnnotationId.value = selectedId;
      });
    };
    this.disposers.push(this.notes.subscribe(onRecords));

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onWindowKeyDown);
      window.addEventListener('popstate', this.onPopState);
    }
  }

  /** Returns the `TwinApi` decorated with per-house scoped `notes`. */
  public getScopedApi(): TwinApi {
    return this.api;
  }

  public getHouseId(): string {
    return this.notes.getHouseId();
  }

  public getHouseName(): string {
    return this.notes.getHouseName();
  }

  /** Switches the active house at runtime, reloading scoped annotations and 3D pins. */
  public setActiveHouse(houseId: string, houseName?: string): void {
    activeTransformState.value = null;
    liveMeasureState.value = null;
    this.notes.setActiveHouse(houseId, houseName);
  }

  public attachPinsHost(host: HTMLElement | null): () => void {
    this.pinsOverlay.setHostElement(host);
    return () => {
      this.pinsOverlay.setHostElement(null);
    };
  }

  public syncModeSignals(): void {
    batch(() => {
      annotatorActive.value = this.notes.isActive();
      annotationTool.value = this.notes.getToolMode();
      annotatorGizmoMode.value = this.notes.getGizmoMode();
      measureAxisSnap.value = this.notes.getMeasureAxisSnap();
    });
  }

  private handleMarkerOrPinSelect(id: number): void {
    this.notes.select(id);
    const rec = this.notes.getSelectedRecord();
    if (rec) {
      this.api.camera.flyToCameraPose(rec.cameraPose);
      if (rec.kind === 'move' && rec.objectTransform) {
        this.notes.selectMovedObject(rec.objectTransform.targetUuid);
      }
      requestAnnotatorFieldFocus(rec.kind === 'measure' ? 'target' : 'note');
    }
  }

  public closeInspector(): void {
    this.notes.select(null);
    this.activateTool(null);
  }

  public toggleAnnotateMode(): void {
    this.notes.toggleActive();
    this.syncModeSignals();
  }

  /**
   * Activates an annotation tool from the shell tool dock, or returns to plain
   * orbit navigation when `tool` is null.
   */
  public activateTool(tool: AnnotationToolMode | null): void {
    if (tool === null) {
      if (this.notes.isActive()) {
        this.notes.cancelMeasurement();
        this.notes.setActive(false);
      }
      liveMeasureState.value = null;
      this.syncModeSignals();
      return;
    }
    this.selectTool(tool, true);
  }

  public selectTool(tool: AnnotationToolMode, enableAnnotateMode = true): void {
    if (enableAnnotateMode && !this.notes.isActive()) {
      this.notes.setActive(true);
    }
    this.notes.setToolMode(tool);
    this.syncModeSignals();
  }

  /** Selects a record, flies to its saved camera pose and focuses its note field. */
  public focusRecord(id: number): void {
    this.handleMarkerOrPinSelect(id);
  }

  /** Selects a record and flies to its saved camera pose without stealing focus. */
  public flyToRecord(id: number): void {
    this.notes.select(id);
    const rec = this.notes.getSelectedRecord();
    if (!rec) return;
    this.api.camera.flyToCameraPose(rec.cameraPose);
    if (rec.kind === 'move' && rec.objectTransform) {
      this.notes.selectMovedObject(rec.objectTransform.targetUuid);
    }
  }

  /** Removes a record, undoing any object move it carried. */
  public removeRecord(id: number): void {
    const rec = this.notes.getRecords().find((r) => r.id === id);
    if (!rec) return;
    if (rec.kind === 'move' && rec.objectTransform) {
      this.notes.resetMovedObject(rec.objectTransform.targetUuid);
      this.notes.detachGizmo();
      if (activeTransformState.value?.transform.targetUuid === rec.objectTransform.targetUuid) {
        activeTransformState.value = null;
      }
    }
    this.notes.remove(id);
  }

  public switchMoveCandidate(targetUuid: string): void {
    if (!targetUuid) return;
    this.notes.switchMoveCandidate(targetUuid);
  }

  public setSelectedDelta(dx: number, dy: number, dz: number, dRotYDeg: number): void {
    this.notes.setSelectedDelta(dx, dy, dz, dRotYDeg);
  }

  public nudgeSelected(dx: number, dy: number, dz: number, dRotYDeg: number): void {
    this.notes.nudgeSelected(dx, dy, dz, dRotYDeg);
  }

  public resetSelectedMove(): void {
    const targetUuid =
      activeTransformState.value?.transform.targetUuid ??
      this.notes.getSelectedRecord()?.objectTransform?.targetUuid;
    if (!targetUuid) return;
    this.notes.resetMovedObject(targetUuid);
    const existingRec = this.notes
      .getRecords()
      .find((r) => r.kind === 'move' && r.objectTransform?.targetUuid === targetUuid);
    if (existingRec) {
      this.notes.remove(existingRec.id);
    }
    activeTransformState.value = null;
  }

  public setMeasureAxisSnap(enabled: boolean): void {
    this.notes.setMeasureAxisSnap(enabled);
    measureAxisSnap.value = this.notes.getMeasureAxisSnap();
  }

  public cancelMeasurement(): void {
    this.notes.cancelMeasurement();
    liveMeasureState.value = null;
  }

  public updateTargetMeasurement(id: number, value: string): void {
    this.notes.updateTargetMeasurement(id, value);
  }

  public updateNote(id: number, note: string): void {
    this.notes.updateNote(id, note);
  }

  public async copyForAgent(): Promise<boolean> {
    const formatted = this.notes.formatForAgent();
    return copyTextWithFallback(formatted);
  }

  public exportJson(): void {
    downloadNotesJson(this.notes, {
      houseId: this.notes.getHouseId(),
      houseName: this.notes.getHouseName(),
    });
  }

  public clearAll(): void {
    for (const r of this.notes.getRecords()) {
      if (r.kind === 'move' && r.objectTransform) {
        this.notes.resetMovedObject(r.objectTransform.targetUuid);
      }
    }
    this.notes.detachGizmo();
    this.notes.cancelMeasurement();
    activeTransformState.value = null;
    liveMeasureState.value = null;
    this.notes.clearAll();
  }

  private bindEngineEvents(): void {
    this.disposers.push(
      this.notes.onPick((hit) => {
        this.notes.add(hit, '');
        this.syncModeSignals();
        requestAnnotatorFieldFocus('note');
      }),

      this.notes.onObjectTransform(({ baseHit, transform, candidates, commitToStore }) => {
        this.syncModeSignals();
        if (!baseHit || !transform) {
          activeTransformState.value = null;
          return;
        }

        activeTransformState.value = { baseHit, transform, candidates };

        if (commitToStore) {
          const [dx, dy, dz] = transform.deltaTranslation;
          const [drx, dry, drz] = transform.deltaRotationDeg;
          const hasNonZeroDelta =
            Math.hypot(dx, dy, dz) >= 0.002 ||
            Math.abs(drx) >= 0.1 ||
            Math.abs(dry) >= 0.1 ||
            Math.abs(drz) >= 0.1;

          if (hasNonZeroDelta) {
            this.notes.upsertMove(baseHit, transform, this.api.camera.getPose());
          }
        } else {
          const existingRec = this.notes
            .getRecords()
            .find((r) => r.kind === 'move' && r.objectTransform?.targetUuid === transform.targetUuid);
          if (existingRec) {
            this.notes.select(existingRec.id);
          }
        }
      }),

      this.notes.onMeasurePreview((state) => {
        liveMeasureState.value = state;
        if (state.axisSnapLocked !== undefined) {
          measureAxisSnap.value = state.axisSnapLocked;
        }
      }),

      this.notes.onMeasureComplete(({ startHit, endHit, snappedEndPoint }) => {
        liveMeasureState.value = null;
        this.notes.addMeasure(startHit, endHit, snappedEndPoint, '');
        this.syncModeSignals();
        requestAnnotatorFieldFocus('target');
      }),

      this.notes.onMarkerSelect((id) => {
        this.handleMarkerOrPinSelect(id);
      })
    );
  }

  public dispose(): void {
    for (const d of this.disposers.splice(0)) {
      d();
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onWindowKeyDown);
      window.removeEventListener('popstate', this.onPopState);
    }
    this.pinsOverlay.dispose();
  }
}
