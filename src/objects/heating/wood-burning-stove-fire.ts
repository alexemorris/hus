import * as THREE from 'three';
import { attachAudioEmitter } from '../../engine/audio/spatial-emitters.ts';
import { getOrCreateCachedPropTexture } from '../../engine/textures/texture-registry.ts';
import type { AnimatedInteractable } from '../../engine/interaction/handlers/animated-interactable.ts';
import { SHARED_CAMERA_WORLD_MATRIX } from '../../engine/lighting/baked-light-volume.ts';
import { createSharedGeo, tagHighLod } from '../shared/scene-helpers.ts';

/**
 * Builds a bottom-anchored (`y = 0 .. height`), organic S-curved flame tongue
 * `BufferGeometry` with a swollen teardrop base, pinched waist, and tapered whip tip.
 */
export function createSculptedFlameTongueGeometry(
  width: number,
  height: number,
  depth: number,
  sCurveX = 0.008,
  sCurveZ = 0.01
): THREE.BufferGeometry {
  const radialSegs = 12;
  const heightSegs = 10;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let iy = 0; iy <= heightSegs; iy++) {
    const v = iy / heightSegs; // 0 at base -> 1 at tip
    const y = v * height;
    // Teardrop flame envelope: swells rapidly above the log fissure, pinches slightly mid-flame, tapers to a point at v=1
    const baseEnvelope = Math.sin(Math.pow(v, 0.55) * Math.PI);
    const waistPinch = 1 - 0.18 * Math.sin(v * Math.PI * 2);
    const profile = Math.max(0.002, baseEnvelope * waistPinch * (1 - 0.25 * v));

    // Built-in organic S-curve undulation along the flame height
    const offsetX = sCurveX * Math.sin(v * Math.PI * 1.85) * Math.pow(v, 0.85);
    const offsetZ = sCurveZ * Math.sin(v * Math.PI * 2.35 + 0.6) * Math.pow(v, 0.9);
    const twistAngle = 0.45 * v;
    const cosT = Math.cos(twistAngle);
    const sinT = Math.sin(twistAngle);

    for (let ir = 0; ir <= radialSegs; ir++) {
      const u = ir / radialSegs;
      const theta = u * Math.PI * 2;
      // Organic lobing around the perimeter so cross-sections are licking sheets rather than circles
      const lobe = 1 + 0.16 * Math.sin(theta * 2 + v * 3.2) + 0.08 * Math.cos(theta * 3 - v * 2.4);
      const localX = Math.cos(theta) * (depth * 0.5) * profile * lobe;
      const localZ = Math.sin(theta) * (width * 0.5) * profile * lobe;

      const rx = localX * cosT - localZ * sinT + offsetX;
      const rz = localX * sinT + localZ * cosT + offsetZ;

      positions.push(rx, y, rz);
      uvs.push(u, v);
    }
  }

  const ringStride = radialSegs + 1;
  for (let iy = 0; iy < heightSegs; iy++) {
    for (let ir = 0; ir < radialSegs; ir++) {
      const a = iy * ringStride + ir;
      const b = a + ringStride;
      const c = b + 1;
      const d = a + 1;
      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Generates a procedural blackbody fire gradient texture (white-gold base -> bright yellow ->
 * incandescent orange -> crimson-amber feathered tip) for emissive flame tongues.
 */
function createFlameGradientTexture(isCore: boolean): THREE.CanvasTexture | null {
  return getOrCreateCachedPropTexture(`stove:flame:${isCore ? 1 : 0}`, () => {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Vertical blackbody gradient (y=128 is base v=0, y=0 is tip v=1)
  const grad = ctx.createLinearGradient(0, 128, 0, 0);
  if (isCore) {
    grad.addColorStop(0.0, '#ffffff');
    grad.addColorStop(0.22, '#fff9c4');
    grad.addColorStop(0.55, '#ffd54f');
    grad.addColorStop(0.84, '#ff8f00');
    grad.addColorStop(1.0, '#ff3d00');
  } else {
    grad.addColorStop(0.0, '#fff3b0');
    grad.addColorStop(0.18, '#ffd147');
    grad.addColorStop(0.46, '#ff7b00');
    grad.addColorStop(0.76, '#ff3300');
    grad.addColorStop(1.0, '#990f00');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 128);

  // Add bright vertical filament streaks inside the flame sheet
  for (let s = 0; s < 10; s++) {
    const sx = 6 + ((s * 17) % 52);
    const sw = 4 + (s % 4) * 2;
    const streakGrad = ctx.createLinearGradient(0, 128, 0, 16);
    streakGrad.addColorStop(0.0, 'rgba(255, 255, 240, 0.55)');
    streakGrad.addColorStop(0.5, 'rgba(255, 196, 64, 0.35)');
    streakGrad.addColorStop(1.0, 'rgba(255, 60, 0, 0.0)');
    ctx.fillStyle = streakGrad;
    ctx.fillRect(sx, 14, sw, 114);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
  });
}

/**
 * Generates a fissured glowing coal & ash bed texture with bright molten cracks.
 */
function createGlowingEmberBedTexture(): THREE.CanvasTexture | null {
  return getOrCreateCachedPropTexture('stove:ember-bed', () => {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#261008';
  ctx.fillRect(0, 0, 128, 128);

  // Glowing molten ember pockets across the bed
  const pockets: ReadonlyArray<readonly [number, number, number]> = [
    [28, 36, 26],
    [64, 58, 34],
    [98, 38, 28],
    [42, 92, 30],
    [88, 94, 32],
    [64, 24, 22],
    [22, 70, 24],
    [106, 68, 24],
  ];
  for (const [px, py, pr] of pockets) {
    const g = ctx.createRadialGradient(px, py, 2, px, py, pr);
    g.addColorStop(0.0, '#fff59d');
    g.addColorStop(0.32, '#ff9100');
    g.addColorStop(0.68, '#ff3d00');
    g.addColorStop(1.0, 'rgba(38, 16, 8, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
  });
}

/**
 * Generates a soft radial firelight glow texture for the hearth floor pool in front of the stove glass.
 */
function createHearthFirelightPoolTexture(): THREE.CanvasTexture | null {
  return getOrCreateCachedPropTexture('stove:hearth-pool', () => {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0.0, 'rgba(255, 168, 52, 0.85)');
  g.addColorStop(0.42, 'rgba(255, 106, 20, 0.45)');
  g.addColorStop(0.78, 'rgba(217, 56, 0, 0.14)');
  g.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
  });
}

interface AnimatedFlameTongueEntry {
  readonly outerMesh: THREE.Mesh;
  readonly coreMesh: THREE.Mesh;
  readonly outerMat: THREE.MeshStandardMaterial;
  readonly coreMat: THREE.MeshStandardMaterial;
  readonly baseX: number;
  readonly baseY: number;
  readonly baseZ: number;
  readonly baseTiltX: number;
  readonly baseTiltZ: number;
  readonly speed: number;
  readonly phase: number;
}

interface AnimatedSparkEntry {
  readonly mesh: THREE.Mesh;
  readonly baseX: number;
  readonly baseY: number;
  readonly baseZ: number;
  readonly riseHeight: number;
  readonly speed: number;
  readonly phase: number;
}

export interface WoodBurningStoveFireControllerConfig {
  readonly id: string;
  readonly label: string;
  readonly flameEntries: readonly AnimatedFlameTongueEntry[];
  readonly sparkEntries: readonly AnimatedSparkEntry[];
  readonly emberMeshes: readonly THREE.Mesh[];
  readonly logMeshes: readonly THREE.Mesh[];
  readonly emberMat: THREE.MeshStandardMaterial;
  readonly logMat: THREE.MeshStandardMaterial;
  readonly linerMat: THREE.MeshStandardMaterial;
  readonly glassMat: THREE.MeshStandardMaterial;
  readonly hearthGlowMesh: THREE.Mesh;
  readonly hearthGlowMat: THREE.MeshStandardMaterial;
  readonly cameraWorldMatrix?: THREE.Matrix4;
}

/** Target update rate (~28 Hz) when the firebox is visible and close to the camera. */
const FLAME_STEP_INTERVAL_SEC = 1 / 28;
/** Beyond 14 m (overview or distant rooms) the stove settles at 0 fps. */
const FLAME_MAX_DISTANCE_SQ = 14 * 14;
/** Minimum cos(angle) from camera forward axis once >1.2 m away (~78 deg half-angle cone). */
const FLAME_MIN_VIEW_COS = 0.2;

/**
 * Continuous per-frame turbulence & emissive flicker controller for a cast-iron
 * wood-burning stove's sculpted flames, inner white-hot cores, rising sparks,
 * glowing ember bed, charred logs, ceramic glass, and hearth firelight pool.
 */
export class WoodBurningStoveFireController implements AnimatedInteractable {
  public readonly id: string;
  public readonly label: string;
  public readonly aliases: readonly string[] = [];
  public readonly clickableTargets: readonly THREE.Object3D[] = [];
  public readonly isAmbientLoop = true;

  readonly #flames: readonly AnimatedFlameTongueEntry[];
  readonly #sparks: readonly AnimatedSparkEntry[];
  readonly #emberMeshes: readonly THREE.Mesh[];
  readonly #logMeshes: readonly THREE.Mesh[];
  readonly #emberMat: THREE.MeshStandardMaterial;
  readonly #logMat: THREE.MeshStandardMaterial;
  readonly #linerMat: THREE.MeshStandardMaterial;
  readonly #glassMat: THREE.MeshStandardMaterial;
  readonly #hearthGlowMesh: THREE.Mesh;
  readonly #hearthGlowMat: THREE.MeshStandardMaterial;
  readonly #cameraWorldMatrix: THREE.Matrix4;
  readonly #worldPosScratch = new THREE.Vector3();
  #timeSec = 0;
  #stepAccumSec = 0;

  public constructor(config: WoodBurningStoveFireControllerConfig) {
    this.id = config.id;
    this.label = config.label;
    this.#flames = config.flameEntries;
    this.#sparks = config.sparkEntries;
    this.#emberMeshes = config.emberMeshes;
    this.#logMeshes = config.logMeshes;
    this.#emberMat = config.emberMat;
    this.#logMat = config.logMat;
    this.#linerMat = config.linerMat;
    this.#glassMat = config.glassMat;
    this.#hearthGlowMesh = config.hearthGlowMesh;
    this.#hearthGlowMat = config.hearthGlowMat;
    this.#cameraWorldMatrix = config.cameraWorldMatrix ?? SHARED_CAMERA_WORLD_MATRIX;
  }

  public trigger(): boolean {
    return false;
  }

  public describe(): string {
    return '';
  }

  public collectDynamicObjects(out: Set<THREE.Object3D>): void {
    for (const f of this.#flames) {
      out.add(f.outerMesh);
      out.add(f.coreMesh);
    }
    for (const s of this.#sparks) {
      out.add(s.mesh);
    }
    for (const e of this.#emberMeshes) {
      out.add(e);
    }
    for (const l of this.#logMeshes) {
      out.add(l);
    }
    out.add(this.#hearthGlowMesh);
  }

  public collectBootPinnedDynamicObjects(out: Set<THREE.Object3D>): void {
    for (const f of this.#flames) {
      out.add(f.outerMesh);
      out.add(f.coreMesh);
    }
    for (const s of this.#sparks) {
      out.add(s.mesh);
    }
    out.add(this.#hearthGlowMesh);
  }

  #isVisibleAndInCameraRange(): boolean {
    const probe: THREE.Object3D = this.#flames[0]?.outerMesh ?? this.#hearthGlowMesh;
    for (let cur: THREE.Object3D | null = probe; cur !== null; cur = cur.parent) {
      if (!cur.visible) return false;
    }

    this.#hearthGlowMesh.updateWorldMatrix(true, false);
    this.#hearthGlowMesh.getWorldPosition(this.#worldPosScratch);
    const e = this.#cameraWorldMatrix.elements;
    const dx = this.#worldPosScratch.x - e[12]!;
    const dy = this.#worldPosScratch.y - e[13]!;
    const dz = this.#worldPosScratch.z - e[14]!;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq > FLAME_MAX_DISTANCE_SQ) {
      return false;
    }
    if (Math.abs(dy) > 3.2 && distSq > 9) {
      return false;
    }
    if (distSq > 1.44) {
      const fx = -e[8]!;
      const fy = -e[9]!;
      const fz = -e[10]!;
      const fLenSq = fx * fx + fy * fy + fz * fz;
      if (fLenSq > 1e-6) {
        const dot = dx * fx + dy * fy + dz * fz;
        if (dot < FLAME_MIN_VIEW_COS * Math.sqrt(distSq * fLenSq)) {
          return false;
        }
      }
    }
    return true;
  }

  public step(dtSeconds: number): boolean {
    if (dtSeconds <= 0) return false;
    if (!this.#isVisibleAndInCameraRange()) {
      this.#stepAccumSec = 0;
      return false;
    }
    this.#stepAccumSec += Math.min(dtSeconds, 0.1);
    if (this.#stepAccumSec < FLAME_STEP_INTERVAL_SEC) {
      return false;
    }
    const stepDt = this.#stepAccumSec;
    this.#stepAccumSec = 0;
    this.#timeSec += stepDt;
    const t = this.#timeSec;

    // Multi-frequency turbulence across all sculpted outer flame tongues & inner white-hot cores
    let totalFlameEnergy = 0;
    for (let i = 0; i < this.#flames.length; i++) {
      const f = this.#flames[i]!;
      const p = f.phase;
      const w1 = Math.sin(t * f.speed + p);
      const w2 = Math.sin(t * (f.speed * 1.77) + p * 2.13);
      const w3 = Math.cos(t * (f.speed * 2.63) - p * 1.41);
      const turbulence = 0.52 * w1 + 0.31 * w2 + 0.17 * w3; // -1..+1

      const scaleY = 1.0 + turbulence * 0.26;
      const scaleXZ = 1.0 - turbulence * 0.1 + 0.08 * w2;
      const swayZ = 0.007 * w1 + 0.004 * w3;
      const swayX = 0.004 * w2;

      f.outerMesh.scale.set(scaleXZ, scaleY, scaleXZ);
      f.outerMesh.position.set(f.baseX + swayX, f.baseY, f.baseZ + swayZ);
      f.outerMesh.rotation.set(
        f.baseTiltX + 0.15 * w1 + 0.07 * w3,
        0.22 * w2,
        f.baseTiltZ + 0.12 * w2
      );
      f.outerMesh.updateMatrixWorld();

      // Inner white-gold core dances slightly faster inside the outer tongue
      const coreScaleY = 1.0 + (0.45 * w2 + 0.55 * w3) * 0.28;
      const coreScaleXZ = 1.0 + 0.12 * w1;
      f.coreMesh.scale.set(coreScaleXZ, coreScaleY, coreScaleXZ);
      f.coreMesh.position.set(
        f.baseX - 0.006 + swayX * 0.7,
        f.baseY + 0.003,
        f.baseZ + swayZ * 0.75
      );
      f.coreMesh.rotation.set(
        f.baseTiltX * 0.75 + 0.12 * w2,
        -0.18 * w1,
        f.baseTiltZ * 0.75 + 0.1 * w3
      );
      f.coreMesh.updateMatrixWorld();

      f.outerMat.emissiveIntensity = 3.9 + turbulence * 1.15;
      f.coreMat.emissiveIntensity = 5.0 + (0.5 * w2 + 0.5 * w3) * 1.35;
      totalFlameEnergy += scaleY;
    }

    const avgEnergy = this.#flames.length > 0 ? totalFlameEnergy / this.#flames.length : 1;

    // Rising incandescent ember sparks drifting upward and spiralling inside the firebox
    for (let i = 0; i < this.#sparks.length; i++) {
      const s = this.#sparks[i]!;
      const cycle = (t * s.speed + s.phase) % 1;
      const y = s.baseY + cycle * s.riseHeight;
      const spiralX = s.baseX + Math.sin(cycle * Math.PI * 3 + s.phase) * 0.012;
      const spiralZ = s.baseZ + Math.cos(cycle * Math.PI * 2.5 + s.phase) * 0.018;
      // Spark swells quickly at ignition then shrinks as it burns out near the top baffle
      const sparkScale = Math.sin(cycle * Math.PI) * (1.15 - 0.35 * cycle);
      s.mesh.position.set(spiralX, y, spiralZ);
      s.mesh.scale.setScalar(Math.max(0.05, sparkScale));
      s.mesh.updateMatrixWorld();
    }

    // Synchronized emissive breath across the ember bed, logs, firebox liner, glass, and hearth pool
    const breath = Math.sin(t * 4.2) * 0.5 + Math.sin(t * 9.7 + 1.1) * 0.3 + (avgEnergy - 1) * 1.4;
    this.#emberMat.emissiveIntensity = 3.3 + breath * 0.65;
    this.#logMat.emissiveIntensity = 1.25 + breath * 0.32;
    this.#linerMat.emissiveIntensity = 1.45 + breath * 0.42;
    this.#glassMat.emissiveIntensity = 0.42 + breath * 0.14;
    this.#hearthGlowMat.emissiveIntensity = 1.75 + breath * 0.48;

    return true;
  }
}

export interface BuildHallStoveFireboxOptions {
  readonly stoveGroup: THREE.Group;
  readonly castIronMat: THREE.Material;
  readonly namePrefix?: string;
  readonly id?: string;
  readonly label?: string;
  readonly cameraWorldMatrix?: THREE.Matrix4;
}

/**
 * Populates a cast-iron wood-burning stove's recessed firebox with warm-lit vermiculite liners,
 * an incandescent fissured ember bed, glowing coals, crossed charred split hardwood logs,
 * 7 sculpted organic S-curve flame tongues + 7 white-hot inner cores, 6 rising sparks,
 * a clear heat-resistant ceramic glass door (`*.doorGlass`), and a warm radial firelight
 * glow pool on the hearth floor in front of the stove, returning its `WoodBurningStoveFireController`.
 */
export function buildHallWoodBurningStoveFirebox(
  options: BuildHallStoveFireboxOptions
): WoodBurningStoveFireController {
  const {
    stoveGroup,
    castIronMat,
    namePrefix = 'woodBurningStove',
    id = 'stove-fire-ambient',
    label = 'Wood-burning stove fire',
  } = options;

  const emberBedTex = createGlowingEmberBedTexture();
  const outerFlameTex = createFlameGradientTexture(false);
  const coreFlameTex = createFlameGradientTexture(true);
  const hearthGlowTex = createHearthFirelightPoolTexture();

  // Warm-lit vermiculite firebox back, top baffle & side liners inside the recessed cavity
  const fireboxLinerMat = new THREE.MeshStandardMaterial({
    color: 0x4a2210,
    emissive: 0xe85212,
    emissiveIntensity: 1.45,
    roughness: 0.85,
  });
  const fireboxBackLiner = new THREE.Mesh(
    createSharedGeo(new THREE.BoxGeometry(0.014, 0.236, 0.246), { computeBoundingBox: true }),
    fireboxLinerMat
  );
  fireboxBackLiner.name = `${namePrefix}.fireboxBack`;
  fireboxBackLiner.position.set(-0.058, 0.31, 0);
  stoveGroup.add(fireboxBackLiner);

  const fireboxSideLinerGeo = createSharedGeo(new THREE.BoxGeometry(0.105, 0.236, 0.012), { computeBoundingBox: true });
  for (const [sideTag, sz] of [
    ['north', -0.119],
    ['south', 0.119],
  ] as const) {
    const sideLiner = tagHighLod(new THREE.Mesh(fireboxSideLinerGeo, fireboxLinerMat));
    sideLiner.name = `${namePrefix}.fireboxLiner.${sideTag}`;
    sideLiner.position.set(-0.112, 0.31, sz);
    stoveGroup.add(sideLiner);
  }

  // Incandescent fissured glowing ember bed & glowing coal chunks on the firebox floor
  const emberMeshes: THREE.Mesh[] = [];
  const hallEmberGlowMat = new THREE.MeshStandardMaterial({
    color: 0xff6e22,
    emissive: 0xff4500,
    emissiveIntensity: 3.3,
    roughness: 0.52,
    ...(emberBedTex ? { map: emberBedTex, emissiveMap: emberBedTex } : {}),
  });
  const hallEmberBed = new THREE.Mesh(
    createSharedGeo(new THREE.BoxGeometry(0.094, 0.031, 0.225), { computeBoundingBox: true }),
    hallEmberGlowMat
  );
  hallEmberBed.name = `${namePrefix}.emberBed`;
  hallEmberBed.position.set(-0.1125, 0.2085, 0);
  stoveGroup.add(hallEmberBed);
  emberMeshes.push(hallEmberBed);

  const emberChunkGeo = createSharedGeo(new THREE.DodecahedronGeometry(0.018, 0), { computeBoundingBox: true });
  for (const [eIdx, [ex, ey, ez]] of (
    [
      [-0.138, 0.226, -0.075],
      [-0.128, 0.228, -0.025],
      [-0.135, 0.227, 0.032],
      [-0.13, 0.225, 0.082],
      [-0.096, 0.228, -0.05],
      [-0.092, 0.229, 0.048],
    ] as const
  ).entries()) {
    const emberChunk = tagHighLod(new THREE.Mesh(emberChunkGeo, hallEmberGlowMat));
    emberChunk.name = `${namePrefix}.ember.${eIdx + 1}`;
    emberChunk.position.set(ex, ey, ez);
    stoveGroup.add(emberChunk);
    emberMeshes.push(emberChunk);
  }

  // Cast-iron front log guard / riddle grate bar across the lower firebox opening
  const logGuardBar = tagHighLod(
    new THREE.Mesh(createSharedGeo(new THREE.BoxGeometry(0.012, 0.024, 0.244), { computeBoundingBox: true }), castIronMat)
  );
  logGuardBar.name = `${namePrefix}.logRetainer`;
  logGuardBar.position.set(-0.158, 0.21, 0);
  stoveGroup.add(logGuardBar);

  // Crossed charred split hardwood logs resting on the glowing ember bed with glowing fissures
  const logMeshes: THREE.Mesh[] = [];
  const hallCharredLogMat = new THREE.MeshStandardMaterial({
    color: 0x331c12,
    emissive: 0xc83800,
    emissiveIntensity: 1.25,
    roughness: 0.82,
    ...(emberBedTex ? { emissiveMap: emberBedTex } : {}),
  });
  const hallCharredLogGeo = createSharedGeo(new THREE.CylinderGeometry(0.025, 0.028, 0.165, 10), { computeBoundingBox: true });
  for (const [logIdx, [lx, ly, lz, rotX, rotZ]] of (
    [
      [-0.12, 0.244, -0.036, 1.38, 0.16],
      [-0.11, 0.252, 0.038, -1.34, -0.22],
      [-0.096, 0.268, 0.0, 1.52, 0.08],
    ] as const
  ).entries()) {
    const logMesh = tagHighLod(new THREE.Mesh(hallCharredLogGeo, hallCharredLogMat));
    logMesh.name = `${namePrefix}.charredLog.${logIdx + 1}`;
    logMesh.rotation.set(rotX, 0, rotZ);
    logMesh.position.set(lx, ly, lz);
    stoveGroup.add(logMesh);
    logMeshes.push(logMesh);
  }

  // 7 Sculpted Organic S-Curve Flame Tongues + 7 White-Hot Inner Flame Cores
  //    Each tongue has its own material instance so its `emissiveIntensity` flickers independently!
  const flameSpecs: ReadonlyArray<
    readonly [
      bx: number,
      by: number,
      bz: number,
      fh: number,
      fw: number,
      fd: number,
      tiltX: number,
      tiltZ: number,
      speed: number,
      phase: number,
    ]
  > = [
    [-0.132, 0.246, -0.068, 0.135, 0.056, 0.034, 0.09, 0.05, 6.8, 0.2],
    [-0.126, 0.252, -0.026, 0.162, 0.066, 0.038, 0.04, 0.04, 7.5, 1.4],
    [-0.118, 0.256, 0.008, 0.178, 0.072, 0.042, -0.03, 0.06, 6.2, 2.7],
    [-0.128, 0.25, 0.045, 0.148, 0.062, 0.036, -0.08, 0.04, 8.1, 3.9],
    [-0.134, 0.244, 0.078, 0.122, 0.052, 0.032, -0.11, 0.03, 7.2, 5.1],
    [-0.098, 0.264, -0.042, 0.142, 0.058, 0.035, 0.06, -0.04, 6.5, 0.9],
    [-0.096, 0.266, 0.036, 0.146, 0.06, 0.036, -0.05, -0.03, 7.8, 4.4],
  ];

  const flameEntries: AnimatedFlameTongueEntry[] = [];
  for (let i = 0; i < flameSpecs.length; i++) {
    const [bx, by, bz, fh, fw, fd, tiltX, tiltZ, speed, phase] = flameSpecs[i]!;
    const signCurve = i % 2 === 0 ? 1 : -1;
    const outerGeo = createSculptedFlameTongueGeometry(
      fw,
      fh,
      fd,
      0.008 * signCurve,
      0.011 * -signCurve
    );
    const coreGeo = createSculptedFlameTongueGeometry(
      fw * 0.64,
      fh * 0.78,
      fd * 0.68,
      0.005 * signCurve,
      0.007 * -signCurve
    );

    const outerMat = new THREE.MeshStandardMaterial({
      color: 0xffaa33,
      emissive: 0xff6a00,
      emissiveIntensity: 3.9,
      roughness: 0.14,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      side: THREE.DoubleSide,
      ...(outerFlameTex ? { map: outerFlameTex, emissiveMap: outerFlameTex } : {}),
    });

    const coreMat = new THREE.MeshStandardMaterial({
      color: 0xfffbe0,
      emissive: 0xffd24d,
      emissiveIntensity: 5.0,
      roughness: 0.08,
      transparent: true,
      opacity: 0.96,
      depthWrite: false,
      side: THREE.DoubleSide,
      ...(coreFlameTex ? { map: coreFlameTex, emissiveMap: coreFlameTex } : {}),
    });

    const outerMesh = tagHighLod(new THREE.Mesh(outerGeo, outerMat));
    outerMesh.name = `${namePrefix}.flame.${i + 1}`;
    outerMesh.position.set(bx, by, bz);
    outerMesh.rotation.set(tiltX, 0, tiltZ);
    stoveGroup.add(outerMesh);

    const coreMesh = tagHighLod(new THREE.Mesh(coreGeo, coreMat));
    coreMesh.name = `${namePrefix}.flameCore.${i + 1}`;
    coreMesh.position.set(bx - 0.006, by + 0.003, bz);
    coreMesh.rotation.set(tiltX * 0.75, 0, tiltZ * 0.75);
    stoveGroup.add(coreMesh);

    flameEntries.push({
      outerMesh,
      coreMesh,
      outerMat,
      coreMat,
      baseX: bx,
      baseY: by,
      baseZ: bz,
      baseTiltX: tiltX,
      baseTiltZ: tiltZ,
      speed,
      phase,
    });
  }

  // 6 Rising Incandescent Ember Sparks drifting up through the flames
  const sparkGeo = createSharedGeo(new THREE.OctahedronGeometry(0.0055, 0), { computeBoundingBox: true });
  const sparkMat = new THREE.MeshStandardMaterial({
    color: 0xfff3b0,
    emissive: 0xff9911,
    emissiveIntensity: 5.2,
    roughness: 0.1,
  });
  const sparkSpecs: ReadonlyArray<
    readonly [sx: number, sy: number, sz: number, riseH: number, speed: number, phase: number]
  > = [
    [-0.128, 0.255, -0.055, 0.145, 0.72, 0.1],
    [-0.118, 0.26, -0.015, 0.155, 0.85, 0.35],
    [-0.124, 0.258, 0.025, 0.15, 0.68, 0.6],
    [-0.13, 0.252, 0.062, 0.135, 0.79, 0.82],
    [-0.104, 0.265, -0.032, 0.14, 0.91, 0.22],
    [-0.102, 0.265, 0.038, 0.142, 0.76, 0.51],
  ];
  const sparkEntries: AnimatedSparkEntry[] = [];
  for (let i = 0; i < sparkSpecs.length; i++) {
    const [sx, sy, sz, riseH, speed, phase] = sparkSpecs[i]!;
    const sparkMesh = tagHighLod(new THREE.Mesh(sparkGeo, sparkMat));
    sparkMesh.name = `${namePrefix}.spark.${i + 1}`;
    sparkMesh.position.set(sx, sy + ((phase * riseH) % riseH), sz);
    stoveGroup.add(sparkMesh);
    sparkEntries.push({
      mesh: sparkMesh,
      baseX: sx,
      baseY: sy,
      baseZ: sz,
      riseHeight: riseH,
      speed,
      phase,
    });
  }

  // Clear heat-resistant ceramic glass viewing window (`*.doorGlass`) with warm firelight emissive tint
  const stoveCeramicGlassMat = new THREE.MeshStandardMaterial({
    color: 0xffdfba,
    emissive: 0xff6a1a,
    emissiveIntensity: 0.42,
    roughness: 0.05,
    metalness: 0.08,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
  });
  const stoveDoorGlass = tagHighLod(
    new THREE.Mesh(createSharedGeo(new THREE.BoxGeometry(0.012, 0.25, 0.26), { computeBoundingBox: true }), stoveCeramicGlassMat)
  );
  stoveDoorGlass.name = `${namePrefix}.doorGlass`;
  stoveDoorGlass.position.set(-0.178, 0.31, 0);
  stoveGroup.add(stoveDoorGlass);

  // Warm Emissive Firelight Glow Pool cast onto the brick hearth directly in front of the glass door
  const hearthGlowMat = new THREE.MeshStandardMaterial({
    color: 0xffa834,
    emissive: 0xff6a14,
    emissiveIntensity: 1.75,
    roughness: 0.4,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    ...(hearthGlowTex ? { map: hearthGlowTex, emissiveMap: hearthGlowTex } : {}),
  });
  const hearthGlowGeo = createSharedGeo(new THREE.PlaneGeometry(0.32, 0.46), { computeBoundingBox: true });
  hearthGlowGeo.rotateX(-Math.PI / 2);
  const hearthGlowMesh = tagHighLod(new THREE.Mesh(hearthGlowGeo, hearthGlowMat));
  hearthGlowMesh.name = `${namePrefix}.hearthFireGlow`;
  hearthGlowMesh.position.set(-0.245, 0.006, 0);
  stoveGroup.add(hearthGlowMesh);

  attachAudioEmitter(stoveGroup, {
    id: `${id}-audio`,
    kind: 'continuous',
    preset: 'woodStove',
    isExterior: false,
    refDistance: 1.8,
    maxDistance: 14,
    volume: 0.72,
  });

  return new WoodBurningStoveFireController({
    id,
    label,
    flameEntries,
    sparkEntries,
    emberMeshes,
    logMeshes,
    emberMat: hallEmberGlowMat,
    logMat: hallCharredLogMat,
    linerMat: fireboxLinerMat,
    glassMat: stoveCeramicGlassMat,
    hearthGlowMesh,
    hearthGlowMat,
    cameraWorldMatrix: options.cameraWorldMatrix,
  });
}
