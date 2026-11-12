import * as THREE from 'three';
import type { InteractiveUserData } from '../../../core/types/scene.ts';
import type { SceneAnnotationController } from '../../annotation/annotation-controller.ts';
import { intersectVisibleObjects } from '../../util/object-utils.ts';
import { Emitter } from '../../util/emitter.ts';
import type { WalkthroughController } from '../../walkthrough/walkthrough-controller.ts';
import type { UfhZoneId } from '../property-scene-profile.ts';
import type { CameraService } from './camera-service.ts';
import type { RenderInvalidator } from './viewer-types.ts';

export interface PointerInputHost {
  readonly canvas: HTMLCanvasElement;
  readonly camera: CameraService;
  readonly annotations: SceneAnnotationController;
  readonly invalidator: RenderInvalidator;
  /** Shared, live list of clickable device meshes. */
  readonly interactiveMeshes: THREE.Object3D[];
  getWalkthrough(): WalkthroughController;
  isTerrainSculptActive?(): boolean;
  isAssetInspectMode?(): boolean;
  hasInspectableAtClient?(clientX: number, clientY: number): boolean;
  inspectAssetAtClient?(clientX: number, clientY: number): boolean;
  getExtraInteractiveMeshes?(): readonly THREE.Object3D[];
  resolveSmartInteractableId?(obj: THREE.Object3D): string | undefined;
  handleInteractable(interactableId: string): boolean;
  toggleUfhZone(zoneId: UfhZoneId): void;
  /**
   * Home / integration hook for every device click (KNX switches, sensors, …).
   * `pressDurationMs` is how long the pointer was held (0 for walkthrough "E").
   */
  onObjectInteraction(
    data: InteractiveUserData,
    details?: {
      readonly pressDurationMs: number;
      readonly worldPosition?: { readonly x: number; readonly y: number; readonly z: number };
    }
  ): void;
}

/** Max pointer travel between down / up that still counts as a click (px). */
const CLICK_SLOP_PX = 6;
const HOVER_RAYCAST_MS = 50;
const MEASURE_PREVIEW_RAYCAST_MS = 24;

/**
 * Canvas pointer handling: hover cursors, click routing (annotation tools →
 * devices) and double-click surface focus.
 */
export class PointerInput {
  public readonly surfaceDoubleClick = new Emitter<[point: THREE.Vector3]>();
  private readonly host: PointerInputHost;
  private pointerDownPos = { x: 0, y: 0 };
  private pointerDownMs = 0;
  private pointerDownWasLocked = false;
  private lastHoverRaycastMs = 0;
  private lastTouchTapMs = 0;
  private lastTouchTapPos = { x: 0, y: 0 };
  private readonly scratchWorldPos = new THREE.Vector3();

  public constructor(host: PointerInputHost) {
    this.host = host;
    const { canvas } = host;
    canvas.addEventListener('pointerdown', (e) => {
      this.pointerDownPos = { x: e.clientX, y: e.clientY };
      this.pointerDownMs = performance.now();
      this.pointerDownWasLocked = document.pointerLockElement === canvas;
    });
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    canvas.addEventListener('contextmenu', (e) => this.onContextMenu(e));
  }

  /** Activates a device mesh (click or walkthrough "E" interaction). */
  public triggerInteractiveObject(
    mesh: THREE.Object3D,
    pressDurationMs = 0,
    hitPoint?: THREE.Vector3
  ): void {
    const { host } = this;
    const walkthrough = host.getWalkthrough();
    const data = mesh.userData as InteractiveUserData;
    if (data.isClimbableLadder && walkthrough.isActive()) {
      walkthrough.interactWithClimbableLadder();
      host.invalidator.requestRender();
      return;
    }
    const interactableId = data.interactableId ?? host.resolveSmartInteractableId?.(mesh);
    if (interactableId) host.handleInteractable(interactableId);
    if (data.ufhZoneId) host.toggleUfhZone(data.ufhZoneId);
    const pos = hitPoint ?? mesh.getWorldPosition(this.scratchWorldPos);
    host.onObjectInteraction(data, {
      pressDurationMs,
      worldPosition: { x: pos.x, y: pos.y, z: pos.z },
    });
    if (walkthrough.isActive()) walkthrough.refreshPrompt();
    host.invalidator.requestRender();
  }

  private firstVisibleDeviceHit(raycaster: THREE.Raycaster): THREE.Intersection | undefined {
    const extra = this.host.getExtraInteractiveMeshes?.() ?? [];
    const targets = extra.length > 0 ? [...this.host.interactiveMeshes, ...extra] : this.host.interactiveMeshes;
    const hits = intersectVisibleObjects(raycaster, targets, false);
    for (let i = 0; i < hits.length; i++) {
      const hit = hits[i]! as THREE.Intersection & { readonly originalMesh?: THREE.Mesh };
      if (!hit.originalMesh || hit.originalMesh.userData?.__isInteractiveTarget !== false) {
        return hit;
      }
    }
    return undefined;
  }

  private onPointerMove(e: PointerEvent): void {
    if (e.pointerType === 'touch') return;
    const { host } = this;
    const annotations = host.annotations;
    if (host.getWalkthrough().isActive() || host.isTerrainSculptActive?.() || annotations.isGizmoDragging()) return;

    // Live 3D measurement rubber-band line preview when waiting for Point B
    if (annotations.isAwaitingMeasureEnd() && e.buttons === 0) {
      const now = performance.now();
      if (now - this.lastHoverRaycastMs < MEASURE_PREVIEW_RAYCAST_MS) return;
      this.lastHoverRaycastMs = now;
      annotations.updateMeasurePreviewAt(e.clientX, e.clientY, e.shiftKey);
      host.canvas.style.cursor = 'crosshair';
      return;
    }

    if (e.buttons !== 0) return;
    if (annotations.isAnnotationMode() || e.shiftKey) {
      host.canvas.style.cursor = annotations.getHoverCursor();
      return;
    }
    const now = performance.now();
    if (now - this.lastHoverRaycastMs < HOVER_RAYCAST_MS) return;
    this.lastHoverRaycastMs = now;

    if (host.isAssetInspectMode?.() || e.altKey) {
      host.canvas.style.cursor = host.hasInspectableAtClient?.(e.clientX, e.clientY)
        ? 'pointer'
        : 'crosshair';
      return;
    }
    const raycaster = host.camera.setRayFromClient(e.clientX, e.clientY);
    if (annotations.intersectMarkers(raycaster).length > 0) {
      host.canvas.style.cursor = 'pointer';
      return;
    }
    host.canvas.style.cursor = this.firstVisibleDeviceHit(raycaster) ? 'pointer' : 'grab';
  }

  private onContextMenu(e: MouseEvent): void {
    const { host } = this;
    if (host.getWalkthrough().isActive() || host.isTerrainSculptActive?.() || host.annotations.isAnnotationMode()) {
      return;
    }
    const dist = Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y);
    if (dist > CLICK_SLOP_PX) return;
    if (host.inspectAssetAtClient?.(e.clientX, e.clientY)) {
      e.preventDefault();
    }
  }

  private onPointerUp(e: PointerEvent): void {
    const { host } = this;
    if (e.button !== 0) return;
    if (host.isTerrainSculptActive?.()) return;
    if (this.pointerDownWasLocked && host.getWalkthrough().isActive()) return;
    if (host.annotations.isGizmoBusy()) return;
    const slop = e.pointerType === 'touch' ? 14 : CLICK_SLOP_PX;
    const dist = Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y);
    if (dist > slop) return;

    const raycaster = host.camera.setRayFromClient(e.clientX, e.clientY);

    // Smart Asset Inspector mode or Alt+Click quick-inspect
    if (host.isAssetInspectMode?.() || e.altKey) {
      host.inspectAssetAtClient?.(e.clientX, e.clientY);
      return;
    }

    // Annotation markers and annotation tools take precedence.
    if (host.annotations.handleClick(raycaster, e)) return;

    // Normal interactive object click (doors, switches, lights, gates, etc.)
    const firstHit = this.firstVisibleDeviceHit(raycaster);
    if (firstHit) {
      this.lastTouchTapMs = 0;
      const targetObj =
        (firstHit as THREE.Intersection & { readonly originalMesh?: THREE.Mesh }).originalMesh ??
        firstHit.object;
      this.triggerInteractiveObject(targetObj, performance.now() - this.pointerDownMs, firstHit.point);
      return;
    }

    // Touch double-tap surface focus / walkthrough glide (since touch-action: none suppresses native dblclick)
    if (e.pointerType === 'touch') {
      const now = performance.now();
      const tapDist = Math.hypot(e.clientX - this.lastTouchTapPos.x, e.clientY - this.lastTouchTapPos.y);
      if (now - this.lastTouchTapMs <= 340 && tapDist <= 32) {
        this.lastTouchTapMs = 0;
        this.handleDoubleTapAt(e.clientX, e.clientY, false);
        return;
      }
      this.lastTouchTapMs = now;
      this.lastTouchTapPos = { x: e.clientX, y: e.clientY };
    }
  }

  private onDoubleClick(e: MouseEvent): void {
    this.handleDoubleTapAt(e.clientX, e.clientY, e.shiftKey);
  }

  private handleDoubleTapAt(clientX: number, clientY: number, shiftKey: boolean): void {
    const { host } = this;
    if (host.annotations.isAnnotationMode() || host.isTerrainSculptActive?.() || shiftKey) return;
    // Devices (switches, doors, gates…) already act on single click; skip full-scene pick if hit.
    const raycaster = host.camera.setRayFromClient(clientX, clientY);
    if (this.firstVisibleDeviceHit(raycaster) !== undefined) return;
    const point = host.camera.pickVisibleSurfacePoint(clientX, clientY);
    if (!point) return;
    const walkthrough = host.getWalkthrough();
    if (walkthrough.isActive()) {
      walkthrough.glideToWorldPoint(point);
    } else {
      this.surfaceDoubleClick.emit(point);
    }
  }
}
