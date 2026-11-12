import * as THREE from 'three';
import {
  evaluateTerrainModifiers,
  type TerrainStamp,
  type TerrainSurfaceSampler,
} from '../../core/geo/terrain-modifiers.ts';
import {
  TerrainSculptSession,
  type TerrainSculptMode,
  type TerrainSculptSnapshot,
} from '../../core/geo/terrain-sculpt.ts';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SiteGround } from '../lighting/env/site-ground.ts';
import { Emitter } from '../util/emitter.ts';

export interface TerrainSculptControllerHost {
  readonly canvas: HTMLCanvasElement;
  readonly scene: THREE.Scene;
  readonly controls: OrbitControls;
  getSiteGround(): SiteGround | undefined;
  setRayFromClient(clientX: number, clientY: number): THREE.Raycaster;
  isWalkthroughActive(): boolean;
  deactivateAnnotations(): void;
  requestRender(): void;
}

const RING_SEGMENTS = 64;
const INNER_RING_SEGMENTS = 32;
const RING_SURFACE_LIFT_M = 0.045;

const MODE_RING_COLORS: Readonly<Record<TerrainSculptMode, number>> = {
  raise: 0x5eead4,
  lower: 0xfb923c,
  smooth: 0x93c5fd,
  flatten: 0xfacc15,
};

interface Aabb2D {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

function stampsAabb(stamps: readonly TerrainStamp[]): Aabb2D | undefined {
  if (stamps.length === 0) return undefined;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const s of stamps) {
    const r = Math.max(s.radiusX, s.radiusZ ?? s.radiusX);
    if (s.x - r < minX) minX = s.x - r;
    if (s.x + r > maxX) maxX = s.x + r;
    if (s.z - r < minZ) minZ = s.z - r;
    if (s.z + r > maxZ) maxZ = s.z + r;
  }
  return { minX, maxX, minZ, maxZ };
}

function mergeAabb(a: Aabb2D | undefined, b: Aabb2D | undefined): Aabb2D | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minZ: Math.min(a.minZ, b.minZ),
    maxZ: Math.max(a.maxZ, b.maxZ),
  };
}

/**
 * Interactive 3D terrain sculpt brush controller for `SiteGround`.
 *
 * Lazily creates its 3D conforming brush ring cursor ONLY when activated so default
 * startup scenes have zero extra Three.js nodes (preserving exact scene snapshots).
 */
export class TerrainSculptController {
  public readonly changed = new Emitter<[snapshot: TerrainSculptSnapshot]>();
  private readonly host: TerrainSculptControllerHost;
  private readonly session = new TerrainSculptSession();

  private active = false;
  private savedLeftMouseButton: THREE.MOUSE | null | undefined = undefined;
  private activePointerId: number | null = null;
  private hoverWorld: { x: number; z: number } | null = null;

  private cursorGroup: THREE.Group | null = null;
  private outerRing: THREE.LineLoop | null = null;
  private innerRing: THREE.LineLoop | null = null;
  private ringMaterial: THREE.LineBasicMaterial | null = null;
  private innerRingMaterial: THREE.LineBasicMaterial | null = null;

  private readonly rayHitsScratch: THREE.Intersection[] = [];

  public constructor(host: TerrainSculptControllerHost) {
    this.host = host;
    const { canvas } = host;
    canvas.addEventListener('pointerdown', this.onPointerDown, { capture: true });
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
  }

  public isAvailable(): boolean {
    return this.host.getSiteGround() !== undefined;
  }

  public isActive(): boolean {
    return this.active;
  }

  public getSnapshot(): TerrainSculptSnapshot {
    return {
      active: this.active,
      mode: this.session.getMode(),
      radiusM: this.session.getRadiusM(),
      strength: this.session.getStrength(),
      strokeCount: this.session.getStrokeCount(),
      stampCount: this.session.getStamps().length,
      canUndo: this.session.canUndo(),
      patchId: this.session.getPatchId(),
    };
  }

  private emitChanged(): void {
    this.changed.emit(this.getSnapshot());
  }

  public setActive(nextActive: boolean): boolean {
    const want = nextActive && this.isAvailable();
    if (want === this.active) return this.active;

    if (want) {
      this.host.deactivateAnnotations();
      this.active = true;
      this.savedLeftMouseButton = this.host.controls.mouseButtons.LEFT;
      (this.host.controls.mouseButtons as { LEFT: THREE.MOUSE | null }).LEFT = null;
      this.ensureCursorGroup();
      this.host.canvas.style.cursor = 'crosshair';
    } else {
      if (this.session.isStrokeActive()) {
        this.session.endStroke();
      }
      this.activePointerId = null;
      this.hoverWorld = null;
      this.active = false;
      if (this.savedLeftMouseButton !== undefined) {
        (this.host.controls.mouseButtons as { LEFT: THREE.MOUSE | null }).LEFT =
          this.savedLeftMouseButton;
        this.savedLeftMouseButton = undefined;
      }
      if (this.cursorGroup) {
        this.cursorGroup.visible = false;
      }
      this.host.canvas.style.cursor = 'grab';
    }

    this.host.requestRender();
    this.emitChanged();
    return this.active;
  }

  public toggleActive(): boolean {
    return this.setActive(!this.active);
  }

  public getMode(): TerrainSculptMode {
    return this.session.getMode();
  }

  public setMode(mode: TerrainSculptMode): void {
    if (this.session.getMode() === mode) return;
    this.session.setMode(mode);
    this.syncRingColor();
    this.host.requestRender();
    this.emitChanged();
  }

  public getRadiusM(): number {
    return this.session.getRadiusM();
  }

  public setRadiusM(radiusM: number): number {
    const next = this.session.setRadiusM(radiusM);
    if (this.hoverWorld) {
      this.updateCursorGeometry(this.hoverWorld.x, this.hoverWorld.z);
      this.host.requestRender();
    }
    this.emitChanged();
    return next;
  }

  public getStrength(): number {
    return this.session.getStrength();
  }

  public setStrength(strength: number): number {
    const next = this.session.setStrength(strength);
    this.emitChanged();
    return next;
  }

  public getPatchId(): string {
    return this.session.getPatchId();
  }

  public setPatchId(id: string): void {
    this.session.setPatchId(id);
    this.emitChanged();
  }

  public getStamps(): readonly TerrainStamp[] {
    return this.session.getStamps();
  }

  public formatModifierJson(idOverride?: string): string {
    return this.session.formatModifierJson(idOverride);
  }

  public formatModifierTs(idOverride?: string): string {
    return this.session.formatModifierTs(idOverride);
  }

  public undo(): boolean {
    const prevBounds = stampsAabb(this.session.getStamps());
    const undone = this.session.undoLastStroke();
    if (!undone) return false;
    const nextBounds = stampsAabb(this.session.getStamps());
    this.applySessionToSiteGround(mergeAabb(prevBounds, nextBounds));
    this.emitChanged();
    return true;
  }

  public reset(): boolean {
    const prevBounds = stampsAabb(this.session.getStamps());
    const cleared = this.session.resetStrokes();
    if (!cleared) return false;
    this.applySessionToSiteGround(prevBounds);
    this.emitChanged();
    return true;
  }

  private pickSiteGroundPoint(clientX: number, clientY: number): THREE.Vector3 | null {
    const ground = this.host.getSiteGround();
    if (!ground || !ground.mesh.visible) return null;
    const raycaster = this.host.setRayFromClient(clientX, clientY);
    this.rayHitsScratch.length = 0;
    ground.mesh.raycast(raycaster, this.rayHitsScratch);
    const hit = this.rayHitsScratch[0];
    return hit ? hit.point : null;
  }

  private buildLiveSampler(
    baseSampler: Pick<TerrainSurfaceSampler, 'sampleTerrainY' | 'sampleCarvedMeshY' | 'sampleNormal'>
  ): Pick<TerrainSurfaceSampler, 'sampleTerrainY' | 'sampleCarvedMeshY' | 'sampleNormal'> {
    if (this.session.getStamps().length === 0) {
      return baseSampler;
    }
    const mod = this.session.toModifier();
    const sampleTerrainY = (wx: number, wz: number): number =>
      evaluateTerrainModifiers(baseSampler.sampleTerrainY(wx, wz), wx, wz, [mod]);
    const sampleCarvedMeshY = (wx: number, wz: number): number =>
      evaluateTerrainModifiers(baseSampler.sampleCarvedMeshY(wx, wz), wx, wz, [mod]);
    const sampleNormal = (
      wx: number,
      wz: number,
      eps = 0.5
    ): { nx: number; ny: number; nz: number } => {
      const safeEps = Math.max(1e-4, eps);
      const dydx =
        (sampleCarvedMeshY(wx + safeEps, wz) - sampleCarvedMeshY(wx - safeEps, wz)) /
        (2 * safeEps);
      const dydz =
        (sampleCarvedMeshY(wx, wz + safeEps) - sampleCarvedMeshY(wx, wz - safeEps)) /
        (2 * safeEps);
      const invLen = 1 / Math.hypot(dydx, 1, dydz);
      return {
        nx: -dydx * invLen,
        ny: invLen,
        nz: -dydz * invLen,
      };
    };
    return {
      sampleTerrainY,
      sampleCarvedMeshY,
      sampleNormal,
    };
  }

  private applySessionToSiteGround(dirtyBounds?: Aabb2D): void {
    const ground = this.host.getSiteGround();
    if (!ground) return;
    const baseSampler = ground.getBaseSampler();
    const liveSampler = this.buildLiveSampler(baseSampler);
    ground.updateSampler(liveSampler, dirtyBounds);
    if (this.hoverWorld && this.active) {
      this.updateCursorGeometry(this.hoverWorld.x, this.hoverWorld.z);
    }
    this.host.requestRender();
  }

  private ensureCursorGroup(): void {
    if (this.cursorGroup) return;

    const group = new THREE.Group();
    group.name = '__husjs_terrain_sculpt_cursor__';
    group.visible = false;
    group.userData = {
      isAnnotationGroup: true,
      excludeFromPick: true,
      tradeViewIgnore: true,
      lodIgnore: true,
    };

    const outerGeo = new THREE.BufferGeometry();
    outerGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(RING_SEGMENTS * 3), 3)
    );
    const outerMat = new THREE.LineBasicMaterial({
      color: MODE_RING_COLORS[this.session.getMode()],
      transparent: true,
      opacity: 0.92,
      depthTest: false,
    });
    const outerLoop = new THREE.LineLoop(outerGeo, outerMat);
    outerLoop.renderOrder = 999;
    outerLoop.frustumCulled = false;
    outerLoop.userData = { excludeFromPick: true, isAnnotationGroup: true };

    const innerGeo = new THREE.BufferGeometry();
    innerGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(INNER_RING_SEGMENTS * 3), 3)
    );
    const innerMat = new THREE.LineBasicMaterial({
      color: MODE_RING_COLORS[this.session.getMode()],
      transparent: true,
      opacity: 0.42,
      depthTest: false,
    });
    const innerLoop = new THREE.LineLoop(innerGeo, innerMat);
    innerLoop.renderOrder = 999;
    innerLoop.frustumCulled = false;
    innerLoop.userData = { excludeFromPick: true, isAnnotationGroup: true };

    group.add(outerLoop, innerLoop);
    this.host.scene.add(group);

    this.cursorGroup = group;
    this.outerRing = outerLoop;
    this.innerRing = innerLoop;
    this.ringMaterial = outerMat;
    this.innerRingMaterial = innerMat;
  }

  private syncRingColor(): void {
    const hex = MODE_RING_COLORS[this.session.getMode()];
    this.ringMaterial?.color.setHex(hex);
    this.innerRingMaterial?.color.setHex(hex);
  }

  private updateCursorGeometry(cx: number, cz: number): void {
    const ground = this.host.getSiteGround();
    if (!ground || !this.cursorGroup || !this.outerRing || !this.innerRing) return;

    const liveSampler = this.buildLiveSampler(ground.getBaseSampler());
    const radius = this.session.getRadiusM();
    const innerRadius = radius * 0.45;

    const outerPos = this.outerRing.geometry.getAttribute('position') as THREE.BufferAttribute;
    const outerArr = outerPos.array as Float32Array;
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const a = (i / RING_SEGMENTS) * Math.PI * 2;
      const wx = cx + Math.cos(a) * radius;
      const wz = cz + Math.sin(a) * radius;
      outerArr[i * 3] = wx;
      outerArr[i * 3 + 1] = liveSampler.sampleCarvedMeshY(wx, wz) + RING_SURFACE_LIFT_M;
      outerArr[i * 3 + 2] = wz;
    }
    outerPos.needsUpdate = true;
    this.outerRing.geometry.computeBoundingSphere();

    const innerPos = this.innerRing.geometry.getAttribute('position') as THREE.BufferAttribute;
    const innerArr = innerPos.array as Float32Array;
    for (let i = 0; i < INNER_RING_SEGMENTS; i++) {
      const a = (i / INNER_RING_SEGMENTS) * Math.PI * 2;
      const wx = cx + Math.cos(a) * innerRadius;
      const wz = cz + Math.sin(a) * innerRadius;
      innerArr[i * 3] = wx;
      innerArr[i * 3 + 1] = liveSampler.sampleCarvedMeshY(wx, wz) + RING_SURFACE_LIFT_M;
      innerArr[i * 3 + 2] = wz;
    }
    innerPos.needsUpdate = true;
    this.innerRing.geometry.computeBoundingSphere();

    this.cursorGroup.visible = true;
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (!this.active || this.host.isWalkthroughActive()) return;
    if (e.button !== 0 || e.altKey || e.ctrlKey || e.metaKey) return;

    const ground = this.host.getSiteGround();
    if (!ground) return;
    const hit = this.pickSiteGroundPoint(e.clientX, e.clientY);
    if (!hit) return;

    e.stopPropagation();
    this.activePointerId = e.pointerId;
    try {
      this.host.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointer events may not support capture.
    }

    this.hoverWorld = { x: hit.x, z: hit.z };
    const baseSampleY = (x: number, z: number): number =>
      ground.getBaseSampler().sampleCarvedMeshY(x, z);
    const stamp = this.session.beginStroke(hit.x, hit.z, baseSampleY);
    if (stamp) {
      this.applySessionToSiteGround(stampsAabb([stamp]));
      this.emitChanged();
    } else {
      this.updateCursorGeometry(hit.x, hit.z);
      this.host.requestRender();
    }
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.active || this.host.isWalkthroughActive()) return;
    const ground = this.host.getSiteGround();
    if (!ground) return;

    const hit = this.pickSiteGroundPoint(e.clientX, e.clientY);
    if (!hit) {
      if (this.activePointerId === null && this.cursorGroup?.visible) {
        this.cursorGroup.visible = false;
        this.host.requestRender();
      }
      return;
    }

    this.hoverWorld = { x: hit.x, z: hit.z };
    this.host.canvas.style.cursor = 'crosshair';

    if (this.activePointerId !== null && e.pointerId === this.activePointerId) {
      const baseSampleY = (x: number, z: number): number =>
        ground.getBaseSampler().sampleCarvedMeshY(x, z);
      const added = this.session.continueStroke(hit.x, hit.z, baseSampleY);
      if (added.length > 0) {
        this.applySessionToSiteGround(stampsAabb(added));
        this.emitChanged();
        return;
      }
    }

    this.updateCursorGeometry(hit.x, hit.z);
    this.host.requestRender();
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (!this.active) return;
    if (this.activePointerId !== null && e.pointerId === this.activePointerId) {
      if (this.host.canvas.hasPointerCapture?.(e.pointerId)) {
        try {
          this.host.canvas.releasePointerCapture(e.pointerId);
        } catch {
          // Ignore
        }
      }
      this.activePointerId = null;
      if (this.session.endStroke()) {
        this.emitChanged();
      }
    }
  };

  private readonly onPointerLeave = (): void => {
    if (!this.active || this.activePointerId !== null) return;
    this.hoverWorld = null;
    if (this.cursorGroup?.visible) {
      this.cursorGroup.visible = false;
      this.host.requestRender();
    }
  };

  public dispose(): void {
    if (this.active) {
      this.setActive(false);
    }
    const { canvas } = this.host;
    canvas.removeEventListener('pointerdown', this.onPointerDown, { capture: true });
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerUp);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    if (this.cursorGroup) {
      this.host.scene.remove(this.cursorGroup);
      this.outerRing?.geometry.dispose();
      this.innerRing?.geometry.dispose();
      this.ringMaterial?.dispose();
      this.innerRingMaterial?.dispose();
      this.cursorGroup = null;
      this.outerRing = null;
      this.innerRing = null;
      this.ringMaterial = null;
      this.innerRingMaterial = null;
    }
  }
}
