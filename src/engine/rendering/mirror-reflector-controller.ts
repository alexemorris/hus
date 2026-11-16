import * as THREE from 'three';
import {
  clamp,
  dot,
  float,
  max,
  mix,
  normalView,
  positionViewDirection,
  pow,
  reflector,
  vec3,
} from 'three/tsl';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import type { GraphicsTier } from '../../core/types/twin-ux.ts';
import { syncBakedLightCameraMatrix } from '../lighting/baked-light-volume.ts';
import { detectIOS, detectMobile } from '../perf/device-tier.ts';

export interface MirrorSurfaceOptions {
  readonly localNormal?: readonly [number, number, number];
  readonly localPoint?: readonly [number, number, number];
  readonly localOffset?: readonly [number, number, number];
  readonly zoneId?: string;
  readonly tint?: THREE.ColorRepresentation;
  readonly reflectance?: number;
}

export interface MirrorReflectorControllerOptions {
  readonly maxActiveMirrors?: number;
  readonly maxDistanceM?: number;
  readonly resolutionScale?: number;
  readonly graphicsTier?: GraphicsTier;
  readonly isConstrainedMobile?: boolean;
  readonly resolveZoneAtPoint?: (worldPoint: THREE.Vector3) => string | null;
}

const MIRROR_EXCLUDE_PART_RE =
  /frame|backing|backboard|clip|bracket|screw|bevelEdge|bevelPerimeter|bevelledMirrorBorder|bevelMirrorEdge|halo|led|strip|hinge|handle|pilaster|frieze|cornice|rim|rosette|seam|division|lip|pad|wingMirror|rearview/i;

const MIRROR_INCLUDE_NAME_RE =
  /mirrorGlass|mirrorPane|mirrorPlate|silveredMirror|silverMirror|lookingGlass|archedMirrorGlass|bevelledMirrorGlass|insideMirror|mirroredBackPanel|\.mirror\.glass$|\.mirror$/i;

const MIN_PLANAR_MAX_DIM_M = 0.18;
const MIN_PLANAR_MID_DIM_M = 0.14;
const MAX_PLANAR_THICKNESS_M = 0.06;

const DEFAULT_MAX_ACTIVE_MIRRORS = 2;
const DEFAULT_MAX_DISTANCE_M = 14.0;
const DEFAULT_RESOLUTION_SCALE = 0.5;

const _projScreenMatrix = new THREE.Matrix4();
const _frustum = new THREE.Frustum();
const _camPos = new THREE.Vector3();
const _worldPoint = new THREE.Vector3();
const _worldCenter = new THREE.Vector3();
const _worldNormal = new THREE.Vector3();
const _normalMatrix = new THREE.Matrix3();
const _toCam = new THREE.Vector3();
const _worldSphere = new THREE.Sphere();
const _xAxis = new THREE.Vector3();
const _yAxis = new THREE.Vector3();
const _upRef = new THREE.Vector3(0, 1, 0);
const _altUpRef = new THREE.Vector3(0, 0, 1);
const _invMeshWorld = new THREE.Matrix4();
const _sibBox = new THREE.Box3();
const _sibCenter = new THREE.Vector3();

function getPrimaryMaterial(
  mat: THREE.Material | THREE.Material[] | null | undefined
): THREE.Material | null {
  if (!mat) return null;
  if (Array.isArray(mat)) return mat[0] ?? null;
  return mat;
}

function isMetallicMirrorLikeMaterial(mat: THREE.Material | null): boolean {
  if (!mat) return false;
  if (mat.userData?.isMirrorMaterial === true) return true;
  const std = mat as THREE.MeshStandardMaterial;
  if (typeof std.metalness === 'number' && typeof std.roughness === 'number') {
    return std.metalness >= 0.85 && std.roughness <= 0.08;
  }
  return false;
}

function measureLocalGeometryBounds(geometry: THREE.BufferGeometry): THREE.Box3 | null {
  const posAttr = geometry.getAttribute('position');
  if (!posAttr || posAttr.count === 0) return null;
  if (!geometry.boundingBox) {
    geometry.computeBoundingBox();
  }
  return geometry.boundingBox;
}

function hasPlanarMirrorDimensions(bbox: THREE.Box3): boolean {
  const dx = bbox.max.x - bbox.min.x;
  const dy = bbox.max.y - bbox.min.y;
  const dz = bbox.max.z - bbox.min.z;
  const dims = [dx, dy, dz].sort((a, b) => a - b);
  const minThickness = dims[0]!;
  const middleDim = dims[1]!;
  const maxDim = dims[2]!;
  return (
    minThickness <= MAX_PLANAR_THICKNESS_M &&
    middleDim >= MIN_PLANAR_MID_DIM_M &&
    maxDim >= MIN_PLANAR_MAX_DIM_M
  );
}

/**
 * Shared predicate used by both `MirrorReflectorController` and `SceneBatchOptimizer`
 * so planar mirror panes remain discrete `THREE.Mesh` instances and are never merged
 * into room-wide static geometry batches.
 */
export function isLikelyMirrorGlassMesh(mesh: THREE.Mesh): boolean {
  if ((mesh as THREE.InstancedMesh).isInstancedMesh) return false;
  if (mesh.userData?.isMirror === true || mesh.userData?.mirror === true) {
    return true;
  }

  const mat = getPrimaryMaterial(mesh.material);
  if (mat?.userData?.isMirrorMaterial === true) {
    const bbox = measureLocalGeometryBounds(mesh.geometry);
    if (!bbox) return true;
    const meshName = mesh.name || '';
    if (MIRROR_EXCLUDE_PART_RE.test(meshName)) return false;
    return hasPlanarMirrorDimensions(bbox);
  }

  const meshName = mesh.name || '';
  const matName = mat?.name || '';
  const parentName = mesh.parent?.name || '';

  if (MIRROR_EXCLUDE_PART_RE.test(meshName) || MIRROR_EXCLUDE_PART_RE.test(matName)) {
    return false;
  }

  const nameMatches =
    MIRROR_INCLUDE_NAME_RE.test(meshName) ||
    MIRROR_INCLUDE_NAME_RE.test(matName) ||
    (/mirror/i.test(parentName) && /glass|pane|plate/i.test(meshName));

  if (!nameMatches) return false;
  if (!isMetallicMirrorLikeMaterial(mat)) return false;

  const bbox = measureLocalGeometryBounds(mesh.geometry);
  if (!bbox) return false;
  return hasPlanarMirrorDimensions(bbox);
}

/**
 * Marks a mirror glass `THREE.Mesh` (or locates planar mirror glass child meshes inside a
 * furniture/joinery `THREE.Object3D` assembly) for real-time planar reflection and protects
 * it from static geometry merging.
 */
export function markMirrorSurface<T extends THREE.Object3D>(
  object: T,
  options?: MirrorSurfaceOptions
): T {
  if (object instanceof THREE.Mesh) {
    object.userData.isMirror = true;
    if (options) {
      object.userData.mirrorConfig = {
        ...(object.userData.mirrorConfig as MirrorSurfaceOptions | undefined),
        ...options,
      };
      if (options.zoneId && !object.userData.zoneId) {
        object.userData.zoneId = options.zoneId;
      }
    }
    return object;
  }

  if (options?.zoneId && !object.userData.zoneId) {
    object.userData.zoneId = options.zoneId;
  }

  const matchedChildren: THREE.Mesh[] = [];
  object.traverse((child) => {
    if (child instanceof THREE.Mesh && isLikelyMirrorGlassMesh(child)) {
      matchedChildren.push(child);
    }
  });

  if (matchedChildren.length === 0) {
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      if (MIRROR_EXCLUDE_PART_RE.test(child.name || '')) return;
      const mat = getPrimaryMaterial(child.material);
      const bbox = measureLocalGeometryBounds(child.geometry);
      if (isMetallicMirrorLikeMaterial(mat) && bbox && hasPlanarMirrorDimensions(bbox)) {
        matchedChildren.push(child);
      }
    });
  }

  for (const child of matchedChildren) {
    child.userData.isMirror = true;
    if (options) {
      child.userData.mirrorConfig = {
        ...(child.userData.mirrorConfig as MirrorSurfaceOptions | undefined),
        ...options,
      };
      if (options.zoneId && !child.userData.zoneId) {
        child.userData.zoneId = options.zoneId;
      }
    }
  }

  return object;
}

/**
 * Creates a physical silvered-glass fallback/base `MeshPhysicalMaterial` used when a mirror
 * is outside the active room budget, outside the view frustum, beyond `maxDistanceM`, or
 * running on mobile / low graphics tiers.
 */
export function createMirrorMaterial(options?: {
  readonly tint?: THREE.ColorRepresentation;
  readonly roughness?: number;
  readonly metalness?: number;
  readonly name?: string;
}): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    name: options?.name ?? 'mirrorGlass',
    color: options?.tint ?? 0xf4f7f6,
    metalness: options?.metalness ?? 0.96,
    roughness: options?.roughness ?? 0.018,
    envMapIntensity: 1.35,
    clearcoat: 0.45,
    clearcoatRoughness: 0.02,
  });
  mat.userData.isMirrorMaterial = true;
  return mat;
}

interface MirrorCandidate {
  readonly mesh: THREE.Mesh;
  readonly originalMaterial: THREE.Material | THREE.Material[];
  readonly localCoplanarPoint: THREE.Vector3;
  readonly localOutwardNormal: THREE.Vector3;
  readonly localCenter: THREE.Vector3;
  readonly localRadius: number;
  readonly halfThickness: number;
  readonly areaM2: number;
  readonly ambiguousNormalSign: boolean;
  zoneId: string | null;
}

interface ReflectorInternal {
  updateBefore: (frame: unknown) => unknown;
  renderTargets: Map<THREE.Camera, THREE.RenderTarget>;
  dispose: () => void;
}

interface ReflectorSlot {
  readonly index: number;
  readonly target: THREE.Object3D;
  readonly reflectorNode: ReturnType<typeof reflector>;
  readonly baseReflector: ReflectorInternal;
  readonly material: MeshPhysicalNodeMaterial;
  boundCandidate: MirrorCandidate | null;
}

interface ScoredCandidate {
  readonly candidate: MirrorCandidate;
  readonly score: number;
  readonly worldCoplanarPoint: THREE.Vector3;
  readonly worldNormal: THREE.Vector3;
}

function getComponent(v: THREE.Vector3, axis: 0 | 1 | 2): number {
  return axis === 0 ? v.x : axis === 1 ? v.y : v.z;
}

function setAxisUnit(out: THREE.Vector3, axis: 0 | 1 | 2, sign: 1 | -1): THREE.Vector3 {
  out.set(0, 0, 0);
  if (axis === 0) out.x = sign;
  else if (axis === 1) out.y = sign;
  else out.z = sign;
  return out;
}

export class MirrorReflectorController {
  private readonly scene: THREE.Object3D;
  private readonly maxActiveMirrors: number;
  private readonly maxDistanceM: number;
  private readonly resolutionScale: number;
  private readonly isConstrainedMobile: boolean;
  private readonly resolveZoneAtPoint?: (worldPoint: THREE.Vector3) => string | null;

  private graphicsTier: GraphicsTier;
  private readonly candidates: MirrorCandidate[] = [];
  private readonly candidateSet = new Set<THREE.Mesh>();
  private readonly slots: ReflectorSlot[] = [];
  private activeCandidates: MirrorCandidate[] = [];
  private disposed = false;

  constructor(scene: THREE.Object3D, options: MirrorReflectorControllerOptions = {}) {
    this.scene = scene;
    this.maxActiveMirrors = Math.max(0, options.maxActiveMirrors ?? DEFAULT_MAX_ACTIVE_MIRRORS);
    this.maxDistanceM = options.maxDistanceM ?? DEFAULT_MAX_DISTANCE_M;
    this.resolutionScale = options.resolutionScale ?? DEFAULT_RESOLUTION_SCALE;
    this.graphicsTier = options.graphicsTier ?? 'high';
    this.isConstrainedMobile =
      options.isConstrainedMobile ?? (detectMobile() || detectIOS());
    this.resolveZoneAtPoint = options.resolveZoneAtPoint;
  }

  public getEffectiveMaxMirrors(): number {
    if (this.disposed || this.isConstrainedMobile || this.graphicsTier === 'low') {
      return 0;
    }
    if (this.graphicsTier === 'medium') {
      return Math.min(1, this.maxActiveMirrors);
    }
    return this.maxActiveMirrors;
  }

  public setGraphicsTier(tier: GraphicsTier): void {
    this.graphicsTier = tier;
    if (this.getEffectiveMaxMirrors() === 0) {
      this.deactivateAllMirrors();
    }
  }

  public getDiscoveredMirrorCount(): number {
    return this.candidates.length;
  }

  public getActiveMirrorCount(): number {
    return this.activeCandidates.length;
  }

  public getActiveMirrorMeshes(): readonly THREE.Mesh[] {
    return this.activeCandidates.map((c) => c.mesh);
  }

  public getAllocatedSlotCount(): number {
    return this.slots.length;
  }

  public getActiveReflectorTargets(): readonly THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const candidate of this.activeCandidates) {
      const slot = this.slots.find((sl) => sl.boundCandidate === candidate);
      if (slot) out.push(slot.target);
    }
    return out;
  }

  public discoverMirrors(root: THREE.Object3D = this.scene): number {
    if (this.disposed) return 0;

    this.deactivateAllMirrors();
    this.candidates.length = 0;
    this.candidateSet.clear();

    root.updateMatrixWorld(true);

    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      if (this.candidateSet.has(obj)) return;
      if (!isLikelyMirrorGlassMesh(obj)) return;

      const candidate = this.buildCandidate(obj);
      if (!candidate) return;

      this.candidateSet.add(obj);
      this.candidates.push(candidate);
    });

    return this.candidates.length;
  }

  public update(camera: THREE.Camera, activeZoneId?: string | null): void {
    if (this.disposed) return;

    const budget = this.getEffectiveMaxMirrors();
    if (budget <= 0 || this.candidates.length === 0) {
      this.deactivateAllMirrors();
      return;
    }

    camera.updateMatrixWorld();
    _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projScreenMatrix);
    _camPos.setFromMatrixPosition(camera.matrixWorld);

    const scored: ScoredCandidate[] = [];

    for (let i = 0; i < this.candidates.length; i++) {
      const candidate = this.candidates[i]!;
      if (!this.isVisibleInHierarchy(candidate.mesh)) continue;

      _worldCenter.copy(candidate.localCenter).applyMatrix4(candidate.mesh.matrixWorld);
      const dist = _camPos.distanceTo(_worldCenter);
      if (dist > this.maxDistanceM || dist < 0.05) continue;

      const maxScale = this.extractMaxAxisScale(candidate.mesh.matrixWorld);
      _worldSphere.center.copy(_worldCenter);
      _worldSphere.radius = Math.max(0.05, candidate.localRadius * maxScale);
      if (!_frustum.intersectsSphere(_worldSphere)) continue;

      _normalMatrix.getNormalMatrix(candidate.mesh.matrixWorld);
      _worldNormal.copy(candidate.localOutwardNormal).applyMatrix3(_normalMatrix).normalize();

      _toCam.subVectors(_camPos, _worldCenter).normalize();
      let facing = _worldNormal.dot(_toCam);
      let normalSign = 1;

      if (facing <= 0.01 && candidate.ambiguousNormalSign && -facing > 0.01) {
        _worldNormal.negate();
        facing = -facing;
        normalSign = -1;
      }

      if (facing <= 0.01) continue;

      if (!candidate.zoneId && this.resolveZoneAtPoint) {
        candidate.zoneId = this.resolveZoneAtPoint(_worldCenter);
      }

      if (normalSign < 0) {
        _worldPoint
          .copy(candidate.localCenter)
          .addScaledVector(candidate.localOutwardNormal, -candidate.halfThickness)
          .applyMatrix4(candidate.mesh.matrixWorld);
      } else {
        _worldPoint.copy(candidate.localCoplanarPoint).applyMatrix4(candidate.mesh.matrixWorld);
      }

      const inActiveZoneBonus =
        activeZoneId && candidate.zoneId === activeZoneId ? 1000 : 0;
      const solidAngleScore =
        (candidate.areaM2 * maxScale * maxScale * facing) / Math.max(0.25, dist * dist);
      const score = inActiveZoneBonus + solidAngleScore * 100 - dist * 0.5;

      scored.push({
        candidate,
        score,
        worldCoplanarPoint: _worldPoint.clone(),
        worldNormal: _worldNormal.clone(),
      });
    }

    if (scored.length === 0) {
      this.deactivateAllMirrors();
      return;
    }

    scored.sort((a, b) => b.score - a.score);
    const winners = scored.slice(0, budget);
    const winnerSet = new Set<MirrorCandidate>(winners.map((w) => w.candidate));

    // Restore original material on any candidate not in the winning set
    for (let i = 0; i < this.candidates.length; i++) {
      const candidate = this.candidates[i]!;
      if (!winnerSet.has(candidate) && candidate.mesh.material !== candidate.originalMaterial) {
        candidate.mesh.material = candidate.originalMaterial;
      }
    }

    // Ensure enough pooled slots exist for the active winners
    while (this.slots.length < winners.length) {
      this.slots.push(this.createReflectorSlot(this.slots.length));
    }

    // Clear bindings on slots whose previous candidate is no longer a winner
    for (let s = 0; s < this.slots.length; s++) {
      const slot = this.slots[s]!;
      if (slot.boundCandidate && !winnerSet.has(slot.boundCandidate)) {
        slot.boundCandidate = null;
      }
    }

    // Keep stable slot assignments for continuing winners, then assign newly active winners
    const assignedSlotByCandidate = new Map<MirrorCandidate, ReflectorSlot>();
    const usedSlots = new Set<ReflectorSlot>();

    for (const w of winners) {
      for (let s = 0; s < winners.length; s++) {
        const slot = this.slots[s]!;
        if (slot.boundCandidate === w.candidate && !usedSlots.has(slot)) {
          assignedSlotByCandidate.set(w.candidate, slot);
          usedSlots.add(slot);
          break;
        }
      }
    }

    for (const w of winners) {
      if (assignedSlotByCandidate.has(w.candidate)) continue;
      for (let s = 0; s < winners.length; s++) {
        const slot = this.slots[s]!;
        if (!usedSlots.has(slot)) {
          slot.boundCandidate = w.candidate;
          assignedSlotByCandidate.set(w.candidate, slot);
          usedSlots.add(slot);
          break;
        }
      }
    }

    // Unbind any surplus slots above winners.length
    for (let s = winners.length; s < this.slots.length; s++) {
      this.slots[s]!.boundCandidate = null;
    }

    // Sync each active slot's target matrixWorld & material
    this.activeCandidates = winners.map((w) => w.candidate);
    for (const w of winners) {
      const slot = assignedSlotByCandidate.get(w.candidate)!;
      slot.boundCandidate = w.candidate;
      this.syncSlotTargetMatrix(slot.target, w.worldCoplanarPoint, w.worldNormal);
      if (w.candidate.mesh.material !== slot.material) {
        w.candidate.mesh.material = slot.material;
      }
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.deactivateAllMirrors();

    for (const slot of this.slots) {
      for (const rt of slot.baseReflector.renderTargets.values()) {
        rt.dispose();
      }
      slot.baseReflector.renderTargets.clear();
      slot.baseReflector.dispose();
      slot.reflectorNode.dispose();
      slot.material.dispose();
      slot.boundCandidate = null;
    }

    this.slots.length = 0;
    this.candidates.length = 0;
    this.candidateSet.clear();
  }

  private deactivateAllMirrors(): void {
    for (let i = 0; i < this.candidates.length; i++) {
      const candidate = this.candidates[i]!;
      if (candidate.mesh.material !== candidate.originalMaterial) {
        candidate.mesh.material = candidate.originalMaterial;
      }
    }
    for (let s = 0; s < this.slots.length; s++) {
      this.slots[s]!.boundCandidate = null;
    }
    this.activeCandidates = [];
  }

  private buildCandidate(mesh: THREE.Mesh): MirrorCandidate | null {
    const bbox = measureLocalGeometryBounds(mesh.geometry);
    if (!bbox) return null;

    const explicitlyMarked =
      mesh.userData?.isMirror === true || mesh.userData?.mirror === true;
    if (!explicitlyMarked && !hasPlanarMirrorDimensions(bbox)) {
      return null;
    }

    const config = mesh.userData?.mirrorConfig as MirrorSurfaceOptions | undefined;
    const localCenter = bbox.getCenter(new THREE.Vector3());
    const dx = bbox.max.x - bbox.min.x;
    const dy = bbox.max.y - bbox.min.y;
    const dz = bbox.max.z - bbox.min.z;

    let thinAxis: 0 | 1 | 2 = 2;
    let thickness = dz;
    if (dx <= dy && dx <= dz) {
      thinAxis = 0;
      thickness = dx;
    } else if (dy <= dx && dy <= dz) {
      thinAxis = 1;
      thickness = dy;
    }

    const localOutwardNormal = new THREE.Vector3();
    let ambiguousNormalSign = false;

    if (config?.localNormal) {
      localOutwardNormal
        .set(config.localNormal[0], config.localNormal[1], config.localNormal[2])
        .normalize();
      if (localOutwardNormal.lengthSq() < 0.5) {
        localOutwardNormal.set(0, 0, 1);
      }
    } else {
      const detected = this.detectLocalAxisSign(mesh, thinAxis, thickness, localCenter);
      setAxisUnit(localOutwardNormal, thinAxis, detected.sign);
      ambiguousNormalSign = detected.ambiguous;
    }

    const halfThickness =
      Math.abs(localOutwardNormal.x) * dx * 0.5 +
      Math.abs(localOutwardNormal.y) * dy * 0.5 +
      Math.abs(localOutwardNormal.z) * dz * 0.5;

    const localCoplanarPoint = new THREE.Vector3();
    const explicitPoint = config?.localPoint ?? config?.localOffset;
    if (explicitPoint) {
      localCoplanarPoint.set(explicitPoint[0], explicitPoint[1], explicitPoint[2]);
    } else {
      localCoplanarPoint
        .copy(localCenter)
        .addScaledVector(localOutwardNormal, halfThickness);
    }

    const dims = [dx, dy, dz].sort((a, b) => a - b);
    const areaM2 = Math.max(0.01, dims[1]! * dims[2]!);
    const localRadius = Math.max(0.05, Math.hypot(dx, dy, dz) * 0.5);

    const zoneId = this.resolveCandidateZoneId(mesh, config, localCenter);

    return {
      mesh,
      originalMaterial: mesh.material,
      localCoplanarPoint,
      localOutwardNormal,
      localCenter,
      localRadius,
      halfThickness,
      areaM2,
      ambiguousNormalSign,
      zoneId,
    };
  }

  private detectLocalAxisSign(
    mesh: THREE.Mesh,
    thinAxis: 0 | 1 | 2,
    thickness: number,
    localCenter: THREE.Vector3
  ): { readonly sign: 1 | -1; readonly ambiguous: boolean } {
    if (thickness < 1e-4) {
      const normalAttr = mesh.geometry.getAttribute('normal');
      if (normalAttr && normalAttr.count > 0) {
        const comp =
          thinAxis === 0
            ? normalAttr.getX(0)
            : thinAxis === 1
              ? normalAttr.getY(0)
              : normalAttr.getZ(0);
        return { sign: comp >= 0 ? 1 : -1, ambiguous: false };
      }
      return { sign: 1, ambiguous: false };
    }

    // Disambiguate wall/framed mirrors by comparing against backing/frame sibling centroid in parent
    const parent = mesh.parent;
    if (parent && parent !== this.scene) {
      _invMeshWorld.copy(mesh.matrixWorld).invert();
      let accum = 0;
      let weightSum = 0;
      let backingAccum = 0;
      let backingCount = 0;

      for (const sib of parent.children) {
        if (sib === mesh || !(sib instanceof THREE.Mesh)) continue;
        if (sib.userData?.isMirror === true) continue;
        const sibBounds = measureLocalGeometryBounds(sib.geometry);
        if (!sibBounds) continue;

        _sibBox.copy(sibBounds).applyMatrix4(sib.matrixWorld).applyMatrix4(_invMeshWorld);
        _sibBox.getCenter(_sibCenter);
        const coord = getComponent(_sibCenter, thinAxis);
        const sibName = sib.name || '';

        if (/backing|backboard|backDisc|carcass/i.test(sibName)) {
          backingAccum += coord;
          backingCount += 1;
        } else {
          accum += coord;
          weightSum += 1;
        }
      }

      const centerCoord = getComponent(localCenter, thinAxis);
      if (backingCount > 0) {
        const backingMean = backingAccum / backingCount;
        const diff = centerCoord - backingMean;
        if (Math.abs(diff) > 0.0004) {
          return { sign: diff >= 0 ? 1 : -1, ambiguous: false };
        }
      }
      if (weightSum > 0) {
        const sibMean = accum / weightSum;
        const diff = centerCoord - sibMean;
        if (Math.abs(diff) > 0.0015) {
          return { sign: diff >= 0 ? 1 : -1, ambiguous: false };
        }
      }
    }

    return { sign: 1, ambiguous: true };
  }

  private resolveCandidateZoneId(
    mesh: THREE.Mesh,
    config: MirrorSurfaceOptions | undefined,
    localCenter: THREE.Vector3
  ): string | null {
    if (config?.zoneId) return config.zoneId;

    let cur: THREE.Object3D | null = mesh;
    while (cur) {
      const u = cur.userData;
      if (u) {
        if (typeof u.zoneId === 'string' && u.zoneId.length > 0) return u.zoneId;
        if (typeof u.roomId === 'string' && u.roomId.length > 0) return u.roomId;
        if (typeof u.zone === 'string' && u.zone.length > 0) return u.zone;
      }
      cur = cur.parent;
    }

    if (this.resolveZoneAtPoint) {
      _worldCenter.copy(localCenter).applyMatrix4(mesh.matrixWorld);
      return this.resolveZoneAtPoint(_worldCenter);
    }

    return null;
  }

  private isVisibleInHierarchy(obj: THREE.Object3D): boolean {
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      if (!cur.visible) return false;
      if (cur === this.scene) break;
      cur = cur.parent;
    }
    return true;
  }

  private extractMaxAxisScale(m: THREE.Matrix4): number {
    const e = m.elements;
    const sx = e[0]! * e[0]! + e[1]! * e[1]! + e[2]! * e[2]!;
    const sy = e[4]! * e[4]! + e[5]! * e[5]! + e[6]! * e[6]!;
    const sz = e[8]! * e[8]! + e[9]! * e[9]! + e[10]! * e[10]!;
    return Math.sqrt(Math.max(sx, sy, sz));
  }

  private syncSlotTargetMatrix(
    target: THREE.Object3D,
    worldCoplanarPoint: THREE.Vector3,
    worldNormal: THREE.Vector3
  ): void {
    const up = Math.abs(worldNormal.y) < 0.99 ? _upRef : _altUpRef;
    _xAxis.crossVectors(up, worldNormal).normalize();
    _yAxis.crossVectors(worldNormal, _xAxis).normalize();

    target.matrixWorld.makeBasis(_xAxis, _yAxis, worldNormal);
    target.matrixWorld.setPosition(worldCoplanarPoint);
    target.matrixWorldNeedsUpdate = false;
  }

  private createReflectorSlot(index: number): ReflectorSlot {
    const target = new THREE.Object3D();
    target.name = `husMirrorReflectorTarget_${index}`;
    target.matrixAutoUpdate = false;

    const reflectorNode = reflector({
      target,
      resolutionScale: this.resolutionScale,
      bounces: false,
      generateMipmaps: false,
      samples: 0,
    });

    const silverTint = vec3(0.965, 0.973, 0.969);
    const cosTheta = max(float(0.0), dot(normalView, positionViewDirection));
    const fresnel = pow(clamp(float(1.0).sub(cosTheta), float(0.0), float(1.0)), float(5.0));
    const reflectance = mix(float(0.92), float(0.99), fresnel);

    const material = new MeshPhysicalNodeMaterial({
      name: `husActiveMirrorReflector_${index}`,
      roughness: 0.018,
      metalness: 0.0,
      clearcoat: 0.35,
      clearcoatRoughness: 0.02,
      envMapIntensity: 0.08,
    });
    material.colorNode = vec3(0.02, 0.024, 0.023);
    material.emissiveNode = reflectorNode.rgb.mul(silverTint).mul(reflectance);
    material.userData.isMirrorMaterial = true;
    material.userData.isActiveMirrorReflectorMaterial = true;

    const baseReflector = reflectorNode.reflector as unknown as ReflectorInternal;
    const origUpdateBefore = baseReflector.updateBefore.bind(baseReflector);

    const slot: ReflectorSlot = {
      index,
      target,
      reflectorNode,
      baseReflector,
      material,
      boundCandidate: null,
    };

    baseReflector.updateBefore = (frame: unknown) => {
      const selfMesh = slot.boundCandidate?.mesh ?? null;
      const wasSelfVisible = selfMesh ? selfMesh.visible : false;
      const swappedOthers: Array<{ mesh: THREE.Mesh; mat: THREE.Material | THREE.Material[] }> = [];

      if (selfMesh && wasSelfVisible) {
        selfMesh.visible = false;
      }

      // Swap any other active mirror to its fallback material during this virtual reflection pass
      for (const other of this.slots) {
        if (other !== slot && other.boundCandidate) {
          const otherMesh = other.boundCandidate.mesh;
          if (otherMesh.material === other.material) {
            swappedOthers.push({ mesh: otherMesh, mat: otherMesh.material });
            otherMesh.material = other.boundCandidate.originalMaterial;
          }
        }
      }

      const frameObj = frame as { camera?: THREE.Camera } | null | undefined;
      const mainCamera = frameObj?.camera ?? null;
      const getVirtualCam = (
        baseReflector as unknown as { getVirtualCamera?: (cam: THREE.Camera) => THREE.Camera }
      ).getVirtualCamera;
      if (mainCamera && typeof getVirtualCam === 'function') {
        const vCam = getVirtualCam.call(baseReflector, mainCamera);
        if (vCam) syncBakedLightCameraMatrix(vCam);
      }
      try {
        return origUpdateBefore(frame);
      } finally {
        if (mainCamera) {
          syncBakedLightCameraMatrix(mainCamera);
        }
        if (selfMesh && wasSelfVisible) {
          selfMesh.visible = true;
        }
        for (const entry of swappedOthers) {
          entry.mesh.material = entry.mat;
        }
      }
    };

    return slot;
  }
}
