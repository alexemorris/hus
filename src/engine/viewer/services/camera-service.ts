import * as THREE from 'three';
import type { CameraPresetName, FloorViewMode, SceneCameraPoseSnapshot } from '../../../core/types/scene.ts';
import { forwardXZToTrueBearingDeg } from '../../../core/solar-weather-format.ts';
import { DEFAULT_HUS_PLUS_X_BEARING_DEG } from '../../../core/types/solar-weather.ts';
import { round3 } from '../../annotation/annotation-system.ts';
import { CameraRig, type RigCamera } from '../../camera/camera-rig.ts';
import type { CutawayController } from '../../cutaway/cutaway-controller.ts';
import type { RoomLodController } from '../../lod/lod-manager.ts';
import { intersectVisibleObjects } from '../../util/object-utils.ts';
import { Emitter } from '../../util/emitter.ts';
import type { WalkthroughController } from '../../walkthrough/walkthrough-controller.ts';
import type { SceneZoneRegistry } from '../scene-zone-registry.ts';
import type { ViewerRenderer } from './viewer-renderer.ts';
import type { PropertySceneViewState, RoomFramingBounds, ScreenPoint } from './viewer-types.ts';

export interface CameraServiceHost {
  readonly canvas: HTMLCanvasElement;
  readonly scene: THREE.Scene;
  readonly renderer: ViewerRenderer;
  readonly zoneRegistry: SceneZoneRegistry;
  readonly lodController: RoomLodController;
  /** Called whenever the rig switches between perspective and orthographic cameras. */
  onActiveCameraChanged(camera: RigCamera): void;
  getCutaways(): CutawayController;
  getWalkthrough(): WalkthroughController;
  getEnvironment?(): { getPlusXTrueBearingDeg(): number };
  /** Meshes ignored by surface picking (glow pools, helpers). */
  isPickExcluded(mesh: THREE.Mesh): boolean;
  /** Re-evaluates cutaways / room tracking / view listeners after a camera change. */
  refreshView(): void;
}

/** Minimum interval between view notifications while walking (ms). */
const WALKTHROUGH_VIEW_NOTIFY_MS = 150;

/**
 * Orbit / ortho camera rig, fly-to tweens, pose snapshots, view listeners,
 * screen projection and pointer ray / surface picking.
 */
export class CameraService {
  public readonly rig: CameraRig;
  public readonly viewChanged = new Emitter<[view: PropertySceneViewState]>();
  public readonly compassBearingChanged = new Emitter<[bearingDeg: number]>();
  public readonly raycaster = new THREE.Raycaster();
  private readonly host: CameraServiceHost;
  private readonly pointer = new THREE.Vector2();
  private readonly projectScratch = new THREE.Vector3();
  private readonly forwardScratch = new THREE.Vector3();
  private lastWalkthroughNotifyMs = 0;
  private lastEmittedCompassBearingDeg = Number.NaN;
  private readonly sharedViewState: {
    cameraPosition: THREE.Vector3;
    target: THREE.Vector3;
    isOrthographic: boolean;
    orthoZoom: number;
    floorViewMode: FloorViewMode;
  } = {
    cameraPosition: new THREE.Vector3(),
    target: new THREE.Vector3(),
    isOrthographic: false,
    orthoZoom: 1,
    floorViewMode: 'all',
  };

  public constructor(host: CameraServiceHost) {
    this.host = host;
    this.rig = new CameraRig(host.canvas, (camera) => host.onActiveCameraChanged(camera));
  }

  public getActiveCamera(): RigCamera {
    return this.rig.getActiveCamera();
  }

  public getTarget(): THREE.Vector3 {
    return this.rig.controls.target;
  }

  // ---------------------------------------------------------------------------
  // Fly-to
  // ---------------------------------------------------------------------------

  public flyToPreset(presetName: CameraPresetName | string): void {
    const walkthrough = this.host.getWalkthrough();
    if (walkthrough.isActive()) walkthrough.exit();
    const p = this.host.zoneRegistry.getCameraPreset(presetName);
    if (!p) return;

    const cutaways = this.host.getCutaways();
    this.host.renderer.resetHistory();
    if (p.floorViewMode) {
      cutaways.setFloorViewMode(p.floorViewMode);
    } else if (presetName === 'top' && !cutaways.isCeilingCutaway()) {
      cutaways.setViewState(cutaways.getFloorViewMode(), true);
    }
    if (p.zoneId) {
      this.host.lodController.setFocusedZoneId(p.zoneId, p.pos, p.target, cutaways.getFloorViewMode());
    }

    if (p.useOrthographic) {
      this.rig.useCamera(true);
      this.rig.orthoCamera.zoom = p.orthoZoom ?? 1.08;
      this.rig.orthoCamera.updateProjectionMatrix();
    } else {
      this.rig.useCamera(false);
    }

    this.rig.startTween(p.pos, p.target, 0.7);
    this.host.refreshView();
    this.host.renderer.requestRender();
  }

  public flyToCameraPose(pose: SceneCameraPoseSnapshot): void {
    const walkthrough = this.host.getWalkthrough();
    if (walkthrough.isActive()) walkthrough.exit();
    this.host.renderer.resetHistory();
    this.host.getCutaways().setViewState(pose.floorViewMode, pose.ceilingCutaway);

    if (pose.isOrthographic) {
      this.rig.useCamera(true);
      this.rig.orthoCamera.updateProjectionMatrix();
    } else {
      this.rig.useCamera(false);
    }

    this.rig.startTween(
      new THREE.Vector3(pose.position[0], pose.position[1], pose.position[2]),
      new THREE.Vector3(pose.target[0], pose.target[1], pose.target[2]),
      0.6
    );
    this.host.refreshView();
    this.host.renderer.requestRender();
  }

  /**
   * Flies the perspective camera to frame a room, keeping the current viewing
   * direction (so the move feels like a zoom-in rather than a jump).
   */
  public flyToRoomBounds(bounds: RoomFramingBounds, floorViewMode: FloorViewMode): void {
    const walkthrough = this.host.getWalkthrough();
    if (walkthrough.isActive()) walkthrough.exit();
    this.host.renderer.resetHistory();
    this.host.getCutaways().setFloorViewMode(floorViewMode);
    this.rig.useCamera(false);

    const target = new THREE.Vector3(
      (bounds.minX + bounds.maxX) / 2,
      bounds.minY + 0.9,
      (bounds.minZ + bounds.maxZ) / 2
    );
    const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
    const distance = THREE.MathUtils.clamp(span * 0.9 + 2.5, 5.0, 8.0);

    const cam = this.rig.getActiveCamera().position;
    const currentTarget = this.rig.controls.target;
    const horiz = new THREE.Vector3(cam.x - currentTarget.x, 0, cam.z - currentTarget.z);
    if (horiz.lengthSq() < 1e-4) horiz.set(0.35, 0, 1);
    horiz.normalize();
    const elevation = THREE.MathUtils.degToRad(52);
    const endPos = target
      .clone()
      .addScaledVector(horiz, distance * Math.cos(elevation))
      .add(new THREE.Vector3(0, distance * Math.sin(elevation), 0));

    this.rig.startTween(endPos, target, 0.7);
    this.host.refreshView();
    this.host.renderer.requestRender();
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  public getPoseSnapshot(): SceneCameraPoseSnapshot {
    const pos = this.rig.getActiveCamera().position;
    const tgt = this.rig.controls.target;
    const cutaways = this.host.getCutaways();
    return {
      position: [round3(pos.x), round3(pos.y), round3(pos.z)],
      target: [round3(tgt.x), round3(tgt.y), round3(tgt.z)],
      floorViewMode: cutaways.getFloorViewMode(),
      ceilingCutaway: cutaways.isCeilingCutaway(),
      isOrthographic: this.rig.isOrthographic(),
    };
  }

  public getCameraCompassBearingDeg(): number {
    const camera = this.rig.getActiveCamera();
    camera.updateMatrixWorld();
    camera.getWorldDirection(this.forwardScratch);
    let fx = this.forwardScratch.x;
    let fz = this.forwardScratch.z;
    // In top-down orthographic plan view looking straight down -Y, use camera screen-up (+Y column)
    if (fx * fx + fz * fz < 1e-4) {
      const m = camera.matrixWorld.elements;
      fx = m[4] ?? 1;
      fz = m[6] ?? 0;
    }
    const bearing = forwardXZToTrueBearingDeg(
      fx,
      fz,
      this.host.getEnvironment?.().getPlusXTrueBearingDeg() ?? DEFAULT_HUS_PLUS_X_BEARING_DEG
    );
    return Math.round(bearing * 10) / 10;
  }

  private computeFloorViewMode(camPos: THREE.Vector3, isWalkthrough: boolean): FloorViewMode {
    if (!isWalkthrough) {
      return this.host.getCutaways().getFloorViewMode();
    }
    const floors = this.host.getCutaways().getFloors();
    let active: FloorViewMode = floors[0]?.id ?? 'ground';
    for (let i = 1; i < floors.length; i++) {
      if (camPos.y >= floors[i]!.elevationY - 0.35) {
        active = floors[i]!.id;
      }
    }
    return active;
  }

  public getViewState(): PropertySceneViewState {
    const camPos = this.rig.getActiveCamera().position;
    const isWalkthrough = this.host.getWalkthrough().isActive();
    return {
      cameraPosition: camPos,
      target: isWalkthrough ? camPos : this.rig.controls.target,
      isOrthographic: this.rig.isOrthographic(),
      orthoZoom: this.rig.orthoCamera.zoom,
      floorViewMode: this.computeFloorViewMode(camPos, isWalkthrough),
    };
  }

  /** Forces the next walkthrough view notification through the throttle. */
  public resetViewNotifyThrottle(): void {
    this.lastWalkthroughNotifyMs = 0;
  }

  private notifyCompassBearing(force: boolean): void {
    if (!this.compassBearingChanged.hasListeners()) return;
    const bearing = this.getCameraCompassBearingDeg();
    if (
      !force &&
      !Number.isNaN(this.lastEmittedCompassBearingDeg) &&
      Math.abs(bearing - this.lastEmittedCompassBearingDeg) < 0.25
    ) {
      return;
    }
    this.lastEmittedCompassBearingDeg = bearing;
    this.compassBearingChanged.emit(bearing);
  }

  /** Publishes the view to listeners with zero heap allocations per orbit frame. */
  public notifyView(force: boolean): void {
    this.notifyCompassBearing(force);
    if (!this.viewChanged.hasListeners()) return;
    const isWalkthrough = this.host.getWalkthrough().isActive();
    if (isWalkthrough && !force) {
      const now = performance.now();
      if (now - this.lastWalkthroughNotifyMs < WALKTHROUGH_VIEW_NOTIFY_MS) return;
      this.lastWalkthroughNotifyMs = now;
    }
    const camPos = this.rig.getActiveCamera().position;
    const s = this.sharedViewState;
    s.cameraPosition = camPos;
    s.target = isWalkthrough ? camPos : this.rig.controls.target;
    s.isOrthographic = this.rig.isOrthographic();
    s.orthoZoom = this.rig.orthoCamera.zoom;
    s.floorViewMode = this.computeFloorViewMode(camPos, isWalkthrough);
    this.viewChanged.emit(s);
  }

  // ---------------------------------------------------------------------------
  // Projection & picking
  // ---------------------------------------------------------------------------

  /** Projects a world point with the active camera to CSS px relative to the canvas. */
  public projectToScreen(x: number, y: number, z: number): ScreenPoint {
    const camera = this.rig.getActiveCamera();
    camera.updateMatrixWorld();
    const v = this.projectScratch.set(x, y, z).project(camera);
    const visible = v.z > -1 && v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
    return {
      x: ((v.x + 1) / 2) * this.host.canvas.clientWidth,
      y: ((1 - v.y) / 2) * this.host.canvas.clientHeight,
      visible,
    };
  }

  /** Sets the shared raycaster from a client position (screen centre when pointer-locked). */
  public setRayFromClient(clientX: number, clientY: number): THREE.Raycaster {
    const walkthrough = this.host.getWalkthrough();
    if (walkthrough.isActive() && walkthrough.isPointerLocked()) {
      this.pointer.set(0, 0);
    } else {
      const rect = this.host.canvas.getBoundingClientRect();
      this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    }
    const camera: RigCamera = this.rig.getActiveCamera();
    camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.pointer, camera);
    return this.raycaster;
  }

  public pickVisibleSurfacePoint(clientX: number, clientY: number): THREE.Vector3 | null {
    return this.firstVisibleSurfaceHit(this.setRayFromClient(clientX, clientY));
  }

  public pickVisibleSurfacePointNdc(ndcX: number, ndcY: number): THREE.Vector3 | null {
    const camera = this.rig.getActiveCamera();
    camera.updateMatrixWorld();
    this.pointer.set(ndcX, ndcY);
    this.raycaster.setFromCamera(this.pointer, camera);
    return this.firstVisibleSurfaceHit(this.raycaster);
  }

  private firstVisibleSurfaceHit(raycaster: THREE.Raycaster): THREE.Vector3 | null {
    const hits = intersectVisibleObjects(raycaster, this.host.scene.children, true);
    const hit = hits.find(
      (h) =>
        h.object instanceof THREE.Mesh &&
        !this.host.isPickExcluded(h.object) &&
        !h.object.userData?.isAnnotationGroup
    );
    return hit ? hit.point.clone() : null;
  }
}
