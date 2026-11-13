import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig } from '../camera-rig.ts';
import {
  PIVOT_MAX_DISTANCE,
  SITE_PIVOT_BOUNDS,
  clampPivot,
  clampPointToBounds,
  computeFramingPose,
} from './pivot-math.ts';
import type { NavigationBounds } from './pivot-math.ts';

const BOX: NavigationBounds = { minX: -10, maxX: 10, minY: 0, maxY: 5, minZ: -10, maxZ: 10 };

interface ListenerEntry {
  readonly fn: (event: Record<string, unknown>) => void;
  readonly capture: boolean;
}

/** Deterministic headless canvas stub supporting capture + bubble listeners for OrbitControls & GrabPanController. */
function createMockCanvas(width = 1200, height = 800): HTMLCanvasElement & {
  emit(type: string, init?: Record<string, unknown>): void;
} {
  const listeners = new Map<string, ListenerEntry[]>();
  const capturedPointers = new Set<number>();

  const canvas = {
    clientWidth: width,
    clientHeight: height,
    width,
    height,
    style: { touchAction: '' },
    ownerDocument: {
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    getRootNode: () => ({
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
    addEventListener(
      type: string,
      fn: (event: Record<string, unknown>) => void,
      options?: boolean | { capture?: boolean }
    ) {
      const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
      const list = listeners.get(type) ?? [];
      list.push({ fn, capture });
      listeners.set(type, list);
    },
    removeEventListener(
      type: string,
      fn: (event: Record<string, unknown>) => void,
      options?: boolean | { capture?: boolean }
    ) {
      const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
      const list = listeners.get(type);
      if (!list) return;
      listeners.set(
        type,
        list.filter((entry) => !(entry.fn === fn && entry.capture === capture))
      );
    },
    setPointerCapture(pointerId: number) {
      capturedPointers.add(pointerId);
    },
    releasePointerCapture(pointerId: number) {
      capturedPointers.delete(pointerId);
    },
    hasPointerCapture(pointerId: number) {
      return capturedPointers.has(pointerId);
    },
    emit(type: string, init: Record<string, unknown> = {}) {
      const event: Record<string, unknown> = {
        type,
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        buttons: 1,
        clientX: width / 2,
        clientY: height / 2,
        pageX: init.clientX ?? width / 2,
        pageY: init.clientY ?? height / 2,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        deltaMode: 0,
        deltaX: 0,
        deltaY: 0,
        preventDefault: () => {},
        stopPropagation: () => {},
        ...init,
      };
      event.pageX = event.clientX;
      event.pageY = event.clientY;
      const snapshot = [...(listeners.get(type) ?? [])];
      for (const entry of snapshot) {
        if (entry.capture) entry.fn(event);
      }
      for (const entry of snapshot) {
        if (!entry.capture) entry.fn(event);
      }
    },
  };

  return canvas as unknown as HTMLCanvasElement & {
    emit(type: string, init?: Record<string, unknown>): void;
  };
}

describe('clampPivot', () => {
  it('leaves a valid pivot untouched', () => {
    const cam = new THREE.Vector3(0, 3, 8);
    const pivot = new THREE.Vector3(1, 1, 1);
    const r = clampPivot(cam, pivot, BOX, 25);
    expect(r.changed).toBe(false);
    expect(r.onViewRay).toBe(true);
    expect(r.pivot.equals(pivot)).toBe(true);
    expect(r.pivot).not.toBe(pivot);
  });

  it('slides a too-distant pivot along the view ray', () => {
    const cam = new THREE.Vector3(0, 1, 0);
    // Site bounds extend to x = 65, so the 44 m distance cap binds first.
    const pivot = new THREE.Vector3(100, 1, 0);
    const r = clampPivot(cam, pivot, SITE_PIVOT_BOUNDS, PIVOT_MAX_DISTANCE);
    expect(r.changed).toBe(true);
    expect(r.onViewRay).toBe(true);
    expect(r.pivot.distanceTo(cam)).toBeCloseTo(PIVOT_MAX_DISTANCE, 6);
    expect(r.pivot.z).toBeCloseTo(0, 6);
    expect(r.pivot.y).toBeCloseTo(1, 6);
  });

  it('leaves a 44 m max-zoom site pivot untouched across the site bounds', () => {
    const pivot = new THREE.Vector3(38, 1.05, -28);
    const cam = pivot.clone().add(new THREE.Vector3(0, 31.1, 31.12)); // ~44.0 m
    const r = clampPivot(cam, pivot, SITE_PIVOT_BOUNDS, PIVOT_MAX_DISTANCE, 0.8);
    expect(r.changed).toBe(false);
    expect(r.onViewRay).toBe(true);
    expect(r.pivot.equals(pivot)).toBe(true);
  });

  it('pulls an out-of-bounds pivot back to where the ray exits the box', () => {
    const cam = new THREE.Vector3(0, 1, 0);
    const r = clampPivot(cam, new THREE.Vector3(20, 1, 0), BOX, 100);
    expect(r.onViewRay).toBe(true);
    expect(r.pivot.x).toBeCloseTo(10, 6);
  });

  it('hard-clamps when the view ray never enters the valid region', () => {
    const cam = new THREE.Vector3(0, 50, 0);
    const pivot = new THREE.Vector3(0, 60, 0);
    const r = clampPivot(cam, pivot, BOX, 100);
    expect(r.onViewRay).toBe(false);
    expect(r.changed).toBe(true);
    expect(r.pivot.y).toBe(BOX.maxY);
  });

  it('treats a pivot at the camera position as unchanged', () => {
    const p = new THREE.Vector3(1, 1, 1);
    expect(clampPivot(p, p.clone(), BOX).changed).toBe(false);
  });

  it('clampPointToBounds clamps each axis independently', () => {
    const clamped = clampPointToBounds(new THREE.Vector3(-99, 25, 12), BOX);
    expect(clamped.toArray()).toEqual([-10, 5, 10]);
  });
});

describe('computeFramingPose', () => {
  const opts = {
    currentTarget: new THREE.Vector3(0, 0, 0),
    elevationDeg: 45,
    minDistance: 2,
    maxDistance: 200,
    orthoHalfHeight: 20,
    minZoom: 0.2,
    maxZoom: 8,
  };

  it('targets the box centre and keeps the current azimuth (perspective)', () => {
    const camera = new THREE.PerspectiveCamera(50, 1.5, 0.1, 1000);
    camera.position.set(0, 10, 30);
    const pose = computeFramingPose(BOX, { ...opts, camera });
    expect(pose.target.toArray()).toEqual([0, 2.5, 0]);
    const offset = pose.position.clone().sub(pose.target);
    expect(offset.x).toBeCloseTo(0, 6);
    expect(offset.z).toBeGreaterThan(0);
    // 45° elevation: vertical rise equals horizontal run.
    expect(offset.y).toBeCloseTo(Math.hypot(offset.x, offset.z), 6);
    expect(offset.length()).toBeGreaterThanOrEqual(opts.minDistance);
    expect(offset.length()).toBeLessThanOrEqual(opts.maxDistance);
    expect(pose.orthoZoom).toBe(1);
  });

  it('computes a clamped zoom for orthographic cameras', () => {
    const camera = new THREE.OrthographicCamera(-30, 30, 20, -20, 0.1, 1000);
    camera.position.set(30, 10, 0);
    const pose = computeFramingPose(BOX, { ...opts, camera });
    expect(pose.orthoZoom).toBeGreaterThanOrEqual(opts.minZoom);
    expect(pose.orthoZoom).toBeLessThanOrEqual(opts.maxZoom);
    expect(pose.position.x - pose.target.x).toBeGreaterThan(0);
  });
});

describe('CameraRig + GrabPanController zoomed-out pan stability', () => {
  it('pans smoothly across the site at maxDistance (44 m) after wheel zoom-out with 0.0 bounce-back', () => {
    const canvas = createMockCanvas(1200, 800);
    const rig = new CameraRig(canvas, () => {});
    rig.update(1 / 60);

    // Zoom all the way out to maxDistance (44.0 m) via off-centre wheel ticks (and past maxDistance).
    for (let i = 0; i < 40; i += 1) {
      canvas.emit('wheel', { clientX: 860, clientY: 220, deltaY: 240 });
      rig.update(1 / 60);
    }
    expect(rig.perspCamera.position.distanceTo(rig.controls.target)).toBeCloseTo(
      rig.controls.maxDistance,
      3
    );

    const startCam = rig.perspCamera.position.clone();
    const startTarget = rig.controls.target.clone();

    // Right-button pan diagonally across the viewport (both horizontal and vertical screen motion).
    canvas.emit('pointerdown', { button: 2, buttons: 2, clientX: 600, clientY: 400 });
    const steps = 15;
    for (let step = 1; step <= steps; step += 1) {
      const u = step / steps;
      canvas.emit('pointermove', {
        button: 2,
        buttons: 2,
        clientX: 600 - 320 * u,
        clientY: 400 + 210 * u,
      });
      rig.update(1 / 60);
    }
    canvas.emit('pointerup', { button: 2, buttons: 0, clientX: 280, clientY: 610 });

    const pannedCam = rig.perspCamera.position.clone();
    const pannedTarget = rig.controls.target.clone();

    // Must have translated meaningfully across the site with zero altitude drift and no corrective tween.
    expect(pannedTarget.distanceTo(startTarget)).toBeGreaterThan(10);
    expect(pannedCam.distanceTo(startCam)).toBeCloseTo(pannedTarget.distanceTo(startTarget), 6);
    expect(pannedTarget.y).toBeCloseTo(startTarget.y, 6);
    expect(rig.isTweening()).toBe(false);

    // Advance 90 frames (1.5 s > 0.35 s correction duration): zero elastic bounce-back!
    for (let frame = 0; frame < 90; frame += 1) {
      rig.update(1 / 60);
    }
    expect(rig.perspCamera.position.distanceTo(pannedCam)).toBeLessThan(1e-9);
    expect(rig.controls.target.distanceTo(pannedTarget)).toBeLessThan(1e-9);

    rig.dispose();
  });

  it('maintains 0.0 bounce-back when starting past maxDistance and panning via Shift/Cmd+drag & middle-drag', () => {
    const canvas = createMockCanvas(1200, 800);
    const rig = new CameraRig(canvas, () => {});

    // Place camera past maxDistance (58 m > 44 m) looking down at the property site.
    rig.controls.target.set(0, 1.05, 0);
    const dirFromTarget = new THREE.Vector3(0.32, 0.68, 0.66).normalize();
    rig.perspCamera.position.copy(rig.controls.target).addScaledVector(dirFromTarget, 58);

    // Multi-frame Shift + left-drag pan while OrbitControls clamps distance to 44.0 m.
    canvas.emit('pointerdown', {
      pointerId: 1,
      button: 0,
      buttons: 1,
      shiftKey: true,
      clientX: 600,
      clientY: 420,
    });
    for (let step = 1; step <= 12; step += 1) {
      const u = step / 12;
      canvas.emit('pointermove', {
        pointerId: 1,
        button: 0,
        buttons: 1,
        shiftKey: true,
        clientX: 600 + 260 * u,
        clientY: 420 - 180 * u,
      });
      rig.update(1 / 60);
    }
    canvas.emit('pointerup', {
      pointerId: 1,
      button: 0,
      buttons: 0,
      shiftKey: true,
      clientX: 860,
      clientY: 240,
    });

    const afterShiftCam = rig.perspCamera.position.clone();
    const afterShiftTarget = rig.controls.target.clone();
    expect(afterShiftTarget.distanceTo(new THREE.Vector3(0, 1.05, 0))).toBeGreaterThan(8);
    expect(afterShiftCam.distanceTo(afterShiftTarget)).toBeCloseTo(rig.controls.maxDistance, 4);
    expect(rig.isTweening()).toBe(false);

    for (let frame = 0; frame < 60; frame += 1) {
      rig.update(1 / 60);
    }
    expect(rig.perspCamera.position.distanceTo(afterShiftCam)).toBeLessThan(1e-9);
    expect(rig.controls.target.distanceTo(afterShiftTarget)).toBeLessThan(1e-9);

    // Follow up with Cmd/Meta + left-drag and middle-drag (when MIDDLE is mapped to PAN).
    canvas.emit('pointerdown', {
      pointerId: 2,
      button: 0,
      buttons: 1,
      metaKey: true,
      clientX: 500,
      clientY: 450,
    });
    for (let step = 1; step <= 10; step += 1) {
      canvas.emit('pointermove', {
        pointerId: 2,
        button: 0,
        buttons: 1,
        metaKey: true,
        clientX: 500 - 20 * step,
        clientY: 450 - 15 * step,
      });
      rig.update(1 / 60);
    }
    canvas.emit('pointerup', {
      pointerId: 2,
      button: 0,
      buttons: 0,
      metaKey: true,
      clientX: 300,
      clientY: 300,
    });

    const afterMetaCam = rig.perspCamera.position.clone();
    const afterMetaTarget = rig.controls.target.clone();
    for (let frame = 0; frame < 60; frame += 1) {
      rig.update(1 / 60);
    }
    expect(rig.perspCamera.position.distanceTo(afterMetaCam)).toBeLessThan(1e-9);
    expect(rig.controls.target.distanceTo(afterMetaTarget)).toBeLessThan(1e-9);

    rig.controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
    canvas.emit('pointerdown', {
      pointerId: 3,
      button: 1,
      buttons: 4,
      clientX: 400,
      clientY: 350,
    });
    for (let step = 1; step <= 8; step += 1) {
      canvas.emit('pointermove', {
        pointerId: 3,
        button: 1,
        buttons: 4,
        clientX: 400 + 25 * step,
        clientY: 350 + 15 * step,
      });
      rig.update(1 / 60);
    }
    canvas.emit('pointerup', {
      pointerId: 3,
      button: 1,
      buttons: 0,
      clientX: 600,
      clientY: 470,
    });

    const afterMiddleCam = rig.perspCamera.position.clone();
    const afterMiddleTarget = rig.controls.target.clone();
    for (let frame = 0; frame < 60; frame += 1) {
      rig.update(1 / 60);
    }
    expect(rig.perspCamera.position.distanceTo(afterMiddleCam)).toBeLessThan(1e-9);
    expect(rig.controls.target.distanceTo(afterMiddleTarget)).toBeLessThan(1e-9);

    rig.dispose();
  });

  it('pans horizontally without bounce-back on touch two-finger pan at maxDistance (44 m)', () => {
    const canvas = createMockCanvas(1200, 800);
    const rig = new CameraRig(canvas, () => {});
    rig.controls.target.set(0, 1.05, 0);
    rig.perspCamera.position.set(0, 31.5, 31.8);
    rig.update(1 / 60);
    // Snap to exact 44.0 m maxDistance.
    const offset = rig.perspCamera.position.clone().sub(rig.controls.target).setLength(44.0);
    rig.perspCamera.position.copy(rig.controls.target).add(offset);
    rig.update(1 / 60);

    const initialTarget = rig.controls.target.clone();

    canvas.emit('pointerdown', { pointerType: 'touch', pointerId: 10, clientX: 550, clientY: 400 });
    canvas.emit('pointerdown', { pointerType: 'touch', pointerId: 11, clientX: 650, clientY: 400 });
    for (let step = 1; step <= 12; step += 1) {
      const dx = -18 * step;
      const dy = 14 * step;
      canvas.emit('pointermove', {
        pointerType: 'touch',
        pointerId: 10,
        clientX: 550 + dx,
        clientY: 400 + dy,
      });
      canvas.emit('pointermove', {
        pointerType: 'touch',
        pointerId: 11,
        clientX: 650 + dx,
        clientY: 400 + dy,
      });
      rig.update(1 / 60);
    }
    canvas.emit('pointerup', { pointerType: 'touch', pointerId: 10, clientX: 334, clientY: 568 });
    canvas.emit('pointerup', { pointerType: 'touch', pointerId: 11, clientX: 434, clientY: 568 });

    expect(rig.isTweening()).toBe(false);
    const releaseDisplacement = rig.controls.target.clone().sub(initialTarget);
    expect(releaseDisplacement.length()).toBeGreaterThan(5);
    expect(rig.controls.target.y).toBeCloseTo(initialTarget.y, 5);

    // Let OrbitControls damping settle completely and verify zero reversal / bounce-back.
    for (let frame = 0; frame < 240; frame += 1) {
      rig.update(1 / 60);
      expect(rig.isTweening()).toBe(false);
    }
    const settledTarget = rig.controls.target.clone();
    const settledCam = rig.perspCamera.position.clone();
    const settledDisplacement = settledTarget.clone().sub(initialTarget);
    // Damping only glides forward in the pan direction, never reversing back toward initialTarget.
    expect(settledDisplacement.dot(releaseDisplacement)).toBeGreaterThanOrEqual(
      releaseDisplacement.lengthSq() - 1e-6
    );
    rig.update(1 / 60);
    expect(rig.controls.target.distanceTo(settledTarget)).toBeLessThan(1e-7);
    expect(rig.perspCamera.position.distanceTo(settledCam)).toBeLessThan(1e-7);

    rig.dispose();
  });

  it('softly clamps pan at SITE_PIVOT_BOUNDS without bounce-back or reverse dead-zone', () => {
    const canvas = createMockCanvas(1200, 800);
    const rig = new CameraRig(canvas, () => {});
    rig.controls.target.set(58, 1.05, 0);
    rig.perspCamera.position.set(58, 32.0, 31.0); // ~44 m zoom near +X site edge (65 m)
    rig.update(1 / 60);

    // Drag right-button far left on screen (pushing target +X well past maxX = 65).
    canvas.emit('pointerdown', { pointerId: 7, button: 2, buttons: 2, clientX: 900, clientY: 400 });
    for (let step = 1; step <= 10; step += 1) {
      canvas.emit('pointermove', {
        pointerId: 7,
        button: 2,
        buttons: 2,
        clientX: 900 - 70 * step,
        clientY: 400,
      });
      rig.update(1 / 60);
    }
    expect(rig.controls.target.x).toBeCloseTo(SITE_PIVOT_BOUNDS.maxX, 5);

    // Reversing drag direction by even a small step responds immediately (zero dead-zone).
    canvas.emit('pointermove', { pointerId: 7, button: 2, buttons: 2, clientX: 240, clientY: 400 });
    rig.update(1 / 60);
    expect(rig.controls.target.x).toBeLessThan(SITE_PIVOT_BOUNDS.maxX - 0.5);

    // Push back to boundary and release: 0.0 bounce-back!
    canvas.emit('pointermove', { pointerId: 7, button: 2, buttons: 2, clientX: 100, clientY: 400 });
    canvas.emit('pointerup', { pointerId: 7, button: 2, buttons: 0, clientX: 100, clientY: 400 });
    const releaseCam = rig.perspCamera.position.clone();
    const releaseTarget = rig.controls.target.clone();
    expect(rig.isTweening()).toBe(false);
    for (let frame = 0; frame < 60; frame += 1) {
      rig.update(1 / 60);
    }
    expect(rig.perspCamera.position.distanceTo(releaseCam)).toBeLessThan(1e-9);
    expect(rig.controls.target.distanceTo(releaseTarget)).toBeLessThan(1e-9);

    rig.dispose();
  });

  it('translates camera + target rigidly without twisting view direction if clamped off-axis', () => {
    const canvas = createMockCanvas(1200, 800);
    const rig = new CameraRig(canvas, () => {});
    rig.controls.target.set(90, 1.0, 80); // Outside SITE_PIVOT_BOUNDS
    rig.perspCamera.position.set(90, 32.0, 111.0); // ~43.86 m away, ray misses SITE_PIVOT_BOUNDS
    rig.update(1 / 60);

    const forwardBefore = rig.perspCamera.getWorldDirection(new THREE.Vector3()).clone();
    rig.clampPivot();
    expect(rig.isTweening()).toBe(true);

    for (let frame = 0; frame < 40; frame += 1) {
      rig.update(1 / 60);
    }
    expect(rig.isTweening()).toBe(false);
    const forwardAfter = rig.perspCamera.getWorldDirection(new THREE.Vector3()).clone();
    expect(forwardBefore.dot(forwardAfter)).toBeCloseTo(1, 5);
    expect(rig.controls.target.x).toBeCloseTo(SITE_PIVOT_BOUNDS.maxX, 5);
    expect(rig.controls.target.z).toBeCloseTo(SITE_PIVOT_BOUNDS.maxZ, 5);

    rig.dispose();
  });
});
