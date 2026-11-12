import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CameraTweenState } from '../viewer/scene-types.ts';
import { GrabPanController, type SurfacePicker } from './navigation/grab-pan-controller.ts';
import {
  SITE_PIVOT_BOUNDS,
  clampPivot as computeClampedPivot,
  clampPointToBounds,
  computeFramingPose,
  type NavigationBounds,
} from './navigation/pivot-math.ts';

export type RigCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;
export type { NavigationBounds, SurfacePicker };

const ORTHO_HALF_HEIGHT = 5.6;
/** Damping factor tuned for 60 fps; rescaled per frame by `update(dt)`. */
const BASE_DAMPING_FACTOR = 0.08;
/** Longest frame step fed to damping (avoids lurches after tab switches). */
const MAX_DAMPING_DT = 0.1;
/** Duration of the corrective translation when the pivot leaves the site bounds off-axis. */
const PIVOT_CORRECTION_DURATION = 0.35;
const FRAME_ELEVATION_DEG = 52;

interface OrthoZoomTween {
  readonly start: number;
  readonly end: number;
}

/**
 * Perspective + orthographic cameras, orbit controls (rotate/zoom-to-cursor),
 * grab-and-drag panning, pivot sanity clamping and eased camera fly-tos.
 */
export class CameraRig {
  public readonly perspCamera: THREE.PerspectiveCamera;
  public readonly orthoCamera: THREE.OrthographicCamera;
  public readonly controls: OrbitControls;

  private activeCamera: RigCamera;
  private cameraTween: CameraTweenState | null = null;
  private orthoZoomTween: OrthoZoomTween | null = null;
  /** True while the current tween is itself a pivot correction (prevents loops). */
  private correctionTween = false;
  private readonly onActiveCameraChanged: (camera: RigCamera) => void;
  private readonly grabPan: GrabPanController;
  private readonly onControlsEnd = (): void => {
    this.clampPivotInternal('tween');
  };

  public constructor(
    canvas: HTMLCanvasElement,
    onActiveCameraChanged: (camera: RigCamera) => void
  ) {
    this.onActiveCameraChanged = onActiveCameraChanged;

    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    this.perspCamera = new THREE.PerspectiveCamera(42, aspect, 0.15, 110);
    this.perspCamera.position.set(0.4, 7.8, 10.6);

    this.orthoCamera = new THREE.OrthographicCamera(
      -ORTHO_HALF_HEIGHT * aspect,
      ORTHO_HALF_HEIGHT * aspect,
      ORTHO_HALF_HEIGHT,
      -ORTHO_HALF_HEIGHT,
      -55,
      120
    );
    this.orthoCamera.position.set(9.2, 9.4, 9.4);
    this.orthoCamera.zoom = 1.08;
    this.orthoCamera.updateProjectionMatrix();

    this.activeCamera = this.perspCamera;

    this.controls = new OrbitControls(this.activeCamera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = BASE_DAMPING_FACTOR;
    this.controls.target.set(-1.2, 1.05, 0.2);
    this.controls.maxPolarAngle = Math.PI * 0.485;
    this.controls.minDistance = 0.8;
    this.controls.maxDistance = 44.0;
    this.controls.minZoom = 0.28;
    this.controls.maxZoom = 3.2;
    // Panning is done by GrabPanController (cursor-anchored); zoom follows the cursor.
    this.controls.enablePan = false;
    this.controls.zoomToCursor = true;
    this.controls.addEventListener('end', this.onControlsEnd);

    this.grabPan = new GrabPanController(
      {
        controls: this.controls,
        getActiveCamera: () => this.activeCamera,
        cancelTween: () => this.cancelTween(),
      },
      canvas
    );
  }

  public getActiveCamera(): RigCamera {
    return this.activeCamera;
  }

  public isOrthographic(): boolean {
    return this.activeCamera === this.orthoCamera;
  }

  /** Current orbit pivot (copy). */
  public getPivot(): THREE.Vector3 {
    return this.controls.target.clone();
  }

  /**
   * Installs the raycast used for grab-pan / orbit-pivot / zoom picking. It receives
   * NDC coordinates and returns the first visible surface hit, or null.
   */
  public setSurfacePicker(picker: SurfacePicker | null): void {
    this.grabPan.setSurfacePicker(picker);
  }

  public setSingleFingerPan(enabled: boolean): void {
    this.grabPan.setSingleFingerPan(enabled);
  }

  public isSingleFingerPan(): boolean {
    return this.grabPan.isSingleFingerPan();
  }

  /**
   * Switches to the orthographic or perspective camera (carrying over the
   * current position). No-op if that camera is already active.
   */
  public useCamera(orthographic: boolean): void {
    const next = orthographic ? this.orthoCamera : this.perspCamera;
    if (this.activeCamera === next) return;
    next.position.copy(this.activeCamera.position);
    this.activeCamera = next;
    this.controls.object = next;
    this.controls.enableRotate = !orthographic;
    this.controls.touches.ONE = orthographic || this.grabPan.isSingleFingerPan() ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
    this.onActiveCameraChanged(next);
  }

  public startTween(endPos: THREE.Vector3, endTarget: THREE.Vector3, duration: number): void {
    this.cameraTween = {
      startPos: this.activeCamera.position.clone(),
      endPos,
      startTarget: this.controls.target.clone(),
      endTarget,
      elapsed: 0,
      duration,
    };
    this.orthoZoomTween = null;
    this.correctionTween = false;
  }

  public isTweening(): boolean {
    return this.cameraTween !== null;
  }

  /** Abandons any in-flight fly-to where it is (the pivot is re-sanitised). */
  public cancelTween(): void {
    if (!this.cameraTween) return;
    this.cameraTween = null;
    this.orthoZoomTween = null;
    this.correctionTween = false;
    this.clampPivotInternal('onRayOnly');
  }

  /** Advances any active fly-to. Returns true if the camera moved. */
  public updateTween(dtSeconds: number): boolean {
    const tween = this.cameraTween;
    if (!tween) return false;
    tween.elapsed += dtSeconds;
    const t = tween.duration > 0 ? Math.min(1, tween.elapsed / tween.duration) : 1;
    const ease = 1 - Math.pow(1 - t, 3);
    this.activeCamera.position.lerpVectors(tween.startPos, tween.endPos, ease);
    this.controls.target.lerpVectors(tween.startTarget, tween.endTarget, ease);
    const zoomTween = this.orthoZoomTween;
    if (zoomTween && this.activeCamera === this.orthoCamera) {
      this.orthoCamera.zoom = THREE.MathUtils.lerp(zoomTween.start, zoomTween.end, ease);
      this.orthoCamera.updateProjectionMatrix();
    }
    if (t >= 1) {
      const wasCorrection = this.correctionTween;
      this.cameraTween = null;
      this.orthoZoomTween = null;
      this.correctionTween = false;
      this.clampPivotInternal(wasCorrection ? 'instant' : 'tween');
    }
    return true;
  }

  /**
   * Per-frame update: advances fly-tos and OrbitControls with frame-rate independent
   * damping. Returns true if the camera moved (caller should re-render).
   */
  public update(dtSeconds: number): boolean {
    const dt = THREE.MathUtils.clamp(Number.isFinite(dtSeconds) ? dtSeconds : 0, 0, MAX_DAMPING_DT);
    const tweened = this.updateTween(dt);
    // OrbitControls (r180) only uses deltaTime for auto-rotate; its damping is a fixed
    // per-call factor. Rescale it so the decay per second matches 60 fps behaviour.
    const base = this.controls.dampingFactor;
    this.controls.dampingFactor = 1 - Math.pow(1 - base, dt * 60);
    const controlsMoved = this.controls.update(dt);
    this.controls.dampingFactor = base;
    return tweened || controlsMoved;
  }

  /**
   * Keeps the pivot inside `SITE_PIVOT_BOUNDS` and within `[minDistance, maxDistance]`
   * of the camera. Corrections along the view axis apply instantly (no visible change);
   * off-axis corrections translate `(camera, target)` together without twisting the view.
   * No-op while a fly-to is running (it clamps itself on completion).
   */
  public clampPivot(): void {
    this.clampPivotInternal('tween');
  }

  /**
   * Flies to frame `bounds`, keeping the current view azimuth at ~52° elevation.
   */
  public frameBounds(bounds: NavigationBounds, durationSec = 0.7): void {
    const pose = computeFramingPose(bounds, {
      camera: this.activeCamera,
      currentTarget: this.controls.target,
      elevationDeg: FRAME_ELEVATION_DEG,
      minDistance: this.controls.minDistance,
      maxDistance: this.controls.maxDistance,
      orthoHalfHeight: ORTHO_HALF_HEIGHT,
      minZoom: this.controls.minZoom,
      maxZoom: this.controls.maxZoom,
    });
    this.startTween(pose.position, pose.target, durationSec);
    if (this.activeCamera === this.orthoCamera) {
      this.orthoZoomTween = { start: this.orthoCamera.zoom, end: pose.orthoZoom };
    }
  }

  public resize(width: number, height: number): void {
    const aspect = width / height;
    this.perspCamera.aspect = aspect;
    this.perspCamera.updateProjectionMatrix();

    this.orthoCamera.left = -ORTHO_HALF_HEIGHT * aspect;
    this.orthoCamera.right = ORTHO_HALF_HEIGHT * aspect;
    this.orthoCamera.top = ORTHO_HALF_HEIGHT;
    this.orthoCamera.bottom = -ORTHO_HALF_HEIGHT;
    this.orthoCamera.updateProjectionMatrix();
  }

  public dispose(): void {
    this.controls.removeEventListener('end', this.onControlsEnd);
    this.grabPan.dispose();
    this.controls.dispose();
  }

  /**
   * @param offAxis How to apply a correction that is not on the view axis: translate
   *     the camera + pivot pair over a short tween, snap instantly, or leave it alone.
   */
  private clampPivotInternal(offAxis: 'tween' | 'instant' | 'onRayOnly'): void {
    if (this.cameraTween) return;
    const camPos = this.activeCamera.position;
    const target = this.controls.target;

    // OrbitControls.update() owns clamping camera-to-target distance to [minDistance, maxDistance]
    // by moving `camPos` along the view ray while keeping `target` anchored. When `target` is
    // already inside `SITE_PIVOT_BOUNDS`, do not pull `target` off the ground toward an unclamped
    // `camPos` if an 'end' event fires before `controls.update()` runs.
    const currentDist = camPos.distanceTo(target);
    const targetInBounds =
      target.x >= SITE_PIVOT_BOUNDS.minX &&
      target.x <= SITE_PIVOT_BOUNDS.maxX &&
      target.y >= SITE_PIVOT_BOUNDS.minY &&
      target.y <= SITE_PIVOT_BOUNDS.maxY &&
      target.z >= SITE_PIVOT_BOUNDS.minZ &&
      target.z <= SITE_PIVOT_BOUNDS.maxZ;
    const effectiveMaxDistance = targetInBounds
      ? Math.max(this.controls.maxDistance, currentDist)
      : this.controls.maxDistance;

    const result = computeClampedPivot(
      camPos,
      target,
      SITE_PIVOT_BOUNDS,
      effectiveMaxDistance,
      this.controls.minDistance
    );
    if (!result.changed) return;
    if (result.onViewRay) {
      target.copy(result.pivot);
      return;
    }
    if (offAxis === 'onRayOnly') return;

    const endTarget = clampPointToBounds(target, SITE_PIVOT_BOUNDS);
    const offset = camPos.clone().sub(target);
    const dist = offset.length();
    if (dist > 1e-6) {
      const clampedDist = THREE.MathUtils.clamp(
        dist,
        this.controls.minDistance,
        this.controls.maxDistance
      );
      offset.multiplyScalar(clampedDist / dist);
    }
    const endPos = endTarget.clone().add(offset);

    if (offAxis === 'instant') {
      camPos.copy(endPos);
      target.copy(endTarget);
      return;
    }
    this.startTween(endPos, endTarget, PIVOT_CORRECTION_DURATION);
    this.correctionTween = true;
  }
}
