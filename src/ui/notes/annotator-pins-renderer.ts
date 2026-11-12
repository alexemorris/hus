import type { TwinCameraApi, Unsubscribe } from '../../core/types/twin-api.ts';
import type { AnnotationKind, SceneAnnotationRecord } from '../../core/types/scene.ts';
import type { ProjectedPinScreenCoord } from './annotator-types.ts';

/**
 * Direct 60 Hz GPU-composited `translate3d(x, y, 0)` screen-space pin projector.
 * Bypasses VDOM diffing during camera orbit/walkthrough by mutating element
 * `style.transform` directly inside a Preact-owned host element (`zero getElementById`).
 */
export class AnnotatorPinsOverlayRenderer {
  private readonly camera: TwinCameraApi;
  private readonly onSelectPin: (id: number) => void;
  private overlayEl: HTMLElement | null = null;
  private readonly pinElements = new Map<number, HTMLButtonElement>();
  private readonly unsubCamera: Unsubscribe;

  private records: readonly SceneAnnotationRecord[] = [];
  private selectedId: number | null = null;

  private readonly onResize = (): void => {
    if (this.records.length > 0) {
      this.projectPinsToScreen();
    }
  };

  public constructor(
    camera: TwinCameraApi,
    onSelectPin: (id: number) => void,
    initialHost?: HTMLElement | null
  ) {
    this.camera = camera;
    this.onSelectPin = onSelectPin;
    if (initialHost) {
      this.setHostElement(initialHost);
    }

    this.unsubCamera = this.camera.onViewChanged(() => {
      if (this.records.length > 0) {
        this.projectPinsToScreen();
      }
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.onResize);
    }
  }

  public setHostElement(host: HTMLElement | null): void {
    if (this.overlayEl === host) return;
    for (const el of this.pinElements.values()) {
      el.remove();
    }
    this.pinElements.clear();
    this.overlayEl = host;
    if (host) {
      this.syncRecords(this.records, this.selectedId);
    }
  }

  public syncRecords(
    records: readonly SceneAnnotationRecord[],
    selectedId: number | null
  ): void {
    this.records = records;
    this.selectedId = selectedId;

    const host = this.overlayEl;
    if (!host) return;

    const activeIds = new Set<number>();
    for (const rec of records) {
      activeIds.add(rec.id);
      let btn = this.pinElements.get(rec.id);
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.addEventListener('click', (e: MouseEvent) => {
          e.stopPropagation();
          this.onSelectPin(rec.id);
        });
        this.pinElements.set(rec.id, btn);
        host.appendChild(btn);
      }

      const kind: AnnotationKind = rec.kind ?? 'pin';
      const isSelected = rec.id === selectedId;
      btn.className = `annotator-screen-pin kind-${kind}${isSelected ? ' is-selected' : ''}`;
      if (kind === 'measure' && rec.measurement) {
        btn.textContent = `#${rec.id} · ${rec.measurement.distanceM.toFixed(2)}m`;
      } else if (kind === 'move' && rec.objectTransform) {
        btn.textContent = `#${rec.id} · ${rec.objectTransform.targetName}`;
      } else {
        btn.textContent = `#${rec.id}`;
      }
      btn.title = rec.note.trim() || `${rec.roomName} (#${rec.id})`;
    }

    for (const [id, el] of this.pinElements.entries()) {
      if (!activeIds.has(id)) {
        el.remove();
        this.pinElements.delete(id);
      }
    }

    if (records.length > 0) {
      this.projectPinsToScreen();
    }
  }

  public projectPinsToScreen(): readonly ProjectedPinScreenCoord[] {
    const results: ProjectedPinScreenCoord[] = [];
    if (!this.overlayEl) return results;

    for (const rec of this.records) {
      const btn = this.pinElements.get(rec.id);
      if (!btn) continue;

      let [wx, wy, wz] = rec.worldPoint;
      if (rec.kind === 'measure' && rec.measurement) {
        const { startPoint, endPoint } = rec.measurement;
        wx = (startPoint[0] + endPoint[0]) * 0.5;
        wy = (startPoint[1] + endPoint[1]) * 0.5;
        wz = (startPoint[2] + endPoint[2]) * 0.5;
      } else if (rec.kind === 'move' && rec.objectTransform) {
        [wx, wy, wz] = rec.objectTransform.newWorldCenter;
      }
      const { x: screenX, y: screenY, visible } = this.camera.projectToScreen([wx, wy, wz]);

      btn.hidden = !visible;
      if (visible) {
        btn.style.transform = `translate3d(${screenX.toFixed(1)}px, ${screenY.toFixed(1)}px, 0)`;
      }

      results.push({
        id: rec.id,
        kind: rec.kind ?? 'pin',
        x: screenX,
        y: screenY,
        visible,
      });
    }

    return results;
  }

  public getSelectedPinId(): number | null {
    return this.selectedId;
  }

  public dispose(): void {
    this.unsubCamera();
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.onResize);
    }
    this.setHostElement(null);
  }
}
