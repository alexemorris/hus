import * as THREE from 'three';
import { PointsNodeMaterial } from 'three/webgpu';
import {
  cameraProjectionMatrix,
  clamp,
  dot,
  exp,
  float,
  instancedBufferAttribute,
  int,
  max,
  modelViewMatrix,
  normalize,
  screenDPR,
  select,
  smoothstep,
  uniform,
  uv,
  varying,
  vec3,
  vec4,
  viewportSize,
} from 'three/tsl';
import type { CircuitId } from '../../core/types/knx.ts';
import type { LightGroupMap } from '../viewer/scene-types.ts';
import { ALWAYS_HOIST_LIGHT_FLAG, SHADOW_PASS_HOOK_FLAG } from '../rendering/scene-batch-optimizer.ts';

/**
 * Runtime "looks ON" effects for KNX light fittings. Everything here is created once at runtime
 * from the built scene (never by room builders, so the content snapshot is unaffected) and is a
 * pure function of KNX level × time of day — never of the camera.
 *
 * - Emissive classification: every circuit emissive material is classified as an LED line source
 *   (strip / bar / batten / cove / plinth diffuser), a lamp core (bulb / filament / globe / lens /
 *   puck), a shade (translucent shade or glass lit from inside) or other. Cores and LEDs get a
 *   high HDR emissive gain and a whitened warm tint so they saturate to near-white and bloom.
 * - Halos: one additive soft-sprite point per lamp core (drawn as one `THREE.Points` per fitting
 *   parent and circuit) so fittings read ON even on the low tier without bloom.
 * - LED washes: one additive gradient decal per LED line source on the surface it lights
 *   (found by a short raycast away from its mounting surface) — a cheap line-source light pool.
 * - Fill lights: circuits with fittings but no real PointLight get one synthetic PointLight at
 *   their fittings' centroid so switching them on lights the room (managed by the light budget).
 */

export type FittingKind = 'led' | 'core' | 'shade' | 'other';

/** userData flag on every runtime fitting-effect object (halos, washes, fill lights). */
export const FITTING_FX_FLAG = 'isFittingFx';

const LED_NAME_RE = /led|strip|batten|cove|plinth|lightbar|diffuser|tape/i;
const INDICATOR_NAME_RE = /statusLed|indicator|wiringLed|fuelGauge|pip\b/i;
const CORE_NAME_RE = /bulb|filament|globe|lens|puck|mantle|emitter|candle|spot(?!light\b)|lamp$/i;
const SHADE_NAME_RE = /shade|cage|lantern|glass|diffuser|drum|bell|dome|cone|lining|innerGlow/i;
const UPWARD_NAME_RE = /above|cove|uplight|top|ceiling|pelmet/i;
/** Recessed / directional lamp cores: halo only visible from the side they emit towards. */
const DIRECTIONAL_CORE_RE = /lens|puck|spot|downlight|uplight/i;
const UPLIGHT_NAME_RE = /uplight/i;
/** Wall-mounted lamp cores (step lights, sconces): emission axis unknown, keep omni. */
const WALL_CORE_RE = /stepLight|wallLight|sconce|pictureLight/i;
const CLEAR_SHADE_RE = /glass|envelope|globe|cage|lantern/i;

/**
 * Single tuning knob for how hot lamp cores (bulbs, filaments, globes, lenses) look when ON:
 * scales both their emissive gain and their halo sprites. 1 = full "blown-out" look.
 */
export const BULB_GLOW_STRENGTH = 0.62;

/** Emissive gain applied on top of the builder/appearance max, per fitting kind. */
const KIND_EMISSIVE_GAIN: Readonly<Record<FittingKind, number>> = {
  led: 3.4,
  core: Math.max(1, 5.5 * BULB_GLOW_STRENGTH),
  shade: 1.35,
  other: 1,
};

/** How far each kind's emissive colour is pulled toward a warm white (hot core look). */
const KIND_WHITEN: Readonly<Record<FittingKind, number>> = {
  led: 0.6,
  core: 0.55,
  shade: 0.18,
  other: 0,
};

const WARM_WHITE = new THREE.Color(0xfff0d8);
/** Halo brightness multiplier (HDR) at 100 % level. */
const HALO_STRENGTH = 2.4 * BULB_GLOW_STRENGTH;
/** LED wash brightness multiplier (HDR) at 100 % level. */
const WASH_STRENGTH = 1.25;
/** Accent fittings that never get a synthetic fill light. */
const ACCENT_FITTING_RE = /picture|step|festoon|fairy|plinth|cove|shelf|strip|led|lampPost|lantern|wallWash|uplight/i;
/** A real PointLight within this plan radius / height of a fill position means the spot is lit. */
const FILL_SKIP_RADIUS = 3.2;
const FILL_SKIP_VERTICAL = 1.6;

/** Furthest a wash surface may be from its LED source. */
const WASH_MAX_DISTANCE = 0.38;

interface ClassifiedMesh {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.MeshStandardMaterial;
  readonly circuitId: CircuitId;
  readonly kind: FittingKind;
  readonly box: THREE.Box3;
}

interface HaloBatch {
  readonly circuitId: CircuitId;
  readonly material: PointsNodeMaterial;
  readonly intensityUniform: ReturnType<typeof uniform<number>>;
}

interface WashDecal {
  readonly circuitId: CircuitId;
  readonly material: THREE.MeshBasicMaterial;
  readonly baseColor: THREE.Color;
}

export interface FittingEffectsOptions {
  readonly lightGroups: LightGroupMap;
  /** Scene (or content root) to search for fitting meshes; defaults to the lights' root. */
  readonly sceneRoot?: THREE.Object3D;
}

/**
 * Builds an instanced WebGPU/TSL `PointsNodeMaterial` for a batch of lamp-core halos.
 * Rendered via `THREE.Sprite` with `sprite.count = instanceCount` so WebGPU draws
 * screen-aligned billboarded point quads (WebGPU `point-list` primitives are fixed at 1 px).
 */
function createHaloNodeMaterial(
  positions: readonly number[],
  sizes: readonly number[],
  colors: readonly number[],
  dirs: readonly number[],
  cones: readonly number[]
): {
  readonly material: PointsNodeMaterial;
  readonly intensityUniform: ReturnType<typeof uniform<number>>;
} {
  const aCenter = instancedBufferAttribute(
    new THREE.InstancedBufferAttribute(new Float32Array(positions), 3),
    'vec3'
  );
  const aSize = instancedBufferAttribute(
    new THREE.InstancedBufferAttribute(new Float32Array(sizes), 1),
    'float'
  );
  const aColor = instancedBufferAttribute(
    new THREE.InstancedBufferAttribute(new Float32Array(colors), 3),
    'vec3'
  );
  const aDir = instancedBufferAttribute(
    new THREE.InstancedBufferAttribute(new Float32Array(dirs), 3),
    'vec3'
  );
  const aCone = instancedBufferAttribute(
    new THREE.InstancedBufferAttribute(new Float32Array(cones), 1),
    'float'
  );
  const uIntensity = uniform(0);

  const mvPos = modelViewMatrix.mul(vec4(aCenter, 1.0)).xyz;
  const isOrtho = cameraProjectionMatrix.element(int(2)).element(int(3)).equal(0.0);
  const axis = normalize(modelViewMatrix.mul(vec4(aDir, 0.0)).xyz);
  const toCamera = select(isOrtho, vec3(0.0, 0.0, 1.0), normalize(mvPos.negate()));
  const coneFacing = smoothstep(aCone, aCone.add(0.35), dot(toCamera, axis));
  const facing = select(dot(aDir, aDir).greaterThan(0.0001), coneFacing, float(1.0));

  const projScale = cameraProjectionMatrix.element(int(1)).element(int(1)).mul(0.5).mul(viewportSize.y);
  const rawSize = select(
    isOrtho,
    aSize.mul(projScale),
    aSize.mul(projScale).div(max(float(0.05), mvPos.z.negate()))
  );
  const pixelSize = select(facing.greaterThan(0.001), clamp(rawSize, 0.0, 1024.0), float(0.0));
  const sizeNode = pixelSize.div(screenDPR);

  const vColor = varying(aColor.mul(facing), 'vHaloColor');
  const p = uv().mul(2.0).sub(1.0);
  const d2 = dot(p, p);
  const core = exp(d2.mul(-26.0));
  const glow = exp(d2.mul(-5.5)).mul(float(1.0).sub(d2));
  const radialProfile = core.mul(1.6).add(glow.mul(0.45));

  const material = new PointsNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: true,
    fog: false,
  });
  material.sizeAttenuation = false;
  material.alphaToCoverage = false;
  material.positionNode = aCenter;
  material.sizeNode = sizeNode;
  material.colorNode = vColor.mul(uIntensity).mul(radialProfile);
  material.opacityNode = select(d2.lessThan(1.0), float(1.0), float(0.0));
  material.visible = false;

  return { material, intensityUniform: uIntensity };
}

let sharedWashTexture: THREE.DataTexture | null = null;

/** Soft elongated falloff (u = along the LED, v = away from it), stored as luminance in RGB. */
function getWashTexture(): THREE.DataTexture {
  if (sharedWashTexture) return sharedWashTexture;
  const w = 64;
  const h = 32;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    const across = Math.exp(-Math.pow((v - 0.5) * 2, 2) * 3.2) * (1 - Math.pow(Math.abs(v - 0.5) * 2, 4));
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const edge = Math.min(u, 1 - u) * 2;
      const along = THREE.MathUtils.smoothstep(edge, 0, 0.35);
      const value = Math.round(255 * Math.max(0, across * along));
      const i = (y * w + x) * 4;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  sharedWashTexture = tex;
  return tex;
}

function noRaycast(): void {
  // Runtime effects are never pickable or collidable.
}

function markFx(obj: THREE.Object3D): void {
  obj.userData[FITTING_FX_FLAG] = true;
  obj.userData[SHADOW_PASS_HOOK_FLAG] = true;
  obj.castShadow = false;
  obj.receiveShadow = false;
  obj.raycast = noRaycast;
}

function findRoot(groups: LightGroupMap): THREE.Object3D | null {
  for (const group of Object.values(groups)) {
    for (const light of group.lights) {
      let cur: THREE.Object3D = light;
      while (cur.parent) cur = cur.parent;
      if (cur !== light) return cur;
    }
  }
  return null;
}

function classify(mesh: THREE.Mesh, box: THREE.Box3): FittingKind {
  const name = mesh.name;
  if (INDICATOR_NAME_RE.test(name)) return 'other';
  const size = box.getSize(new THREE.Vector3());
  const dims = [size.x, size.y, size.z].sort((a, b) => b - a);
  const longest = dims[0] ?? 0;
  const second = Math.max(1e-4, dims[1] ?? 0);
  const elongated = longest >= 0.25 && longest / second >= 4;
  if (elongated && LED_NAME_RE.test(name)) return 'led';
  if (CORE_NAME_RE.test(name)) return 'core';
  if (SHADE_NAME_RE.test(name)) return 'shade';
  if (longest > 0 && longest <= 0.14) return 'core';
  return 'other';
}

function kindPriority(kind: FittingKind): number {
  return kind === 'led' ? 3 : kind === 'core' ? 2 : kind === 'shade' ? 1 : 0;
}

let sharedWashPlaneGeo: THREE.PlaneGeometry | null = null;
function getWashPlaneGeometry(): THREE.PlaneGeometry {
  if (!sharedWashPlaneGeo) {
    sharedWashPlaneGeo = new THREE.PlaneGeometry(1, 1);
  }
  return sharedWashPlaneGeo;
}

/**
 * Resolves the nearest visibility-toggled ancestor container for an effect attached to `mesh`,
 * allowing all always-visible ground-floor fittings on the same circuit to coalesce into a single
 * instanced halo cloud while preserving exact floor / ceiling / cutaway / LOD visibility gating.
 */
function resolveVisibilityContainer(mesh: THREE.Object3D, root: THREE.Object3D): THREE.Object3D {
  let cur: THREE.Object3D | null = mesh.parent;
  while (cur && cur !== root) {
    const u = cur.userData as Record<string, unknown> | undefined;
    if (
      !cur.visible ||
      u?.cutawayWall !== undefined ||
      Boolean(u?.isCutawayWall) ||
      u?.lodTier !== undefined ||
      u?.ufhZoneId !== undefined ||
      (cur.parent === root && !u?.isRoomContainer)
    ) {
      return cur;
    }
    cur = cur.parent;
  }
  return root;
}

/**
 * Deduplicates identical per-fitting material clones WITHIN each individual KNX `circuitId`
 * (never across distinct circuits), updating scene meshes and `group.emissives/cones/pools`
 * in-place so static bulbs, cones, and glow pools on the same circuit can batch together.
 */
function deduplicatePerCircuitMaterials(
  root: THREE.Object3D,
  lightGroups: LightGroupMap,
  kindByMaterial: Map<THREE.Material, FittingKind>
): void {
  const replacements = new Map<THREE.Material, THREE.Material>();

  const dedupBasicList = (list: THREE.MeshBasicMaterial[]): void => {
    if (list.length <= 1) return;
    const bySig = new Map<string, THREE.MeshBasicMaterial>();
    const unique: THREE.MeshBasicMaterial[] = [];
    for (const m of list) {
      if (!m) continue;
      const sig = [
        m.type,
        m.color?.getHexString?.() ?? '',
        (m.opacity ?? 1).toFixed(4),
        m.transparent ? '1' : '0',
        m.blending,
        m.depthWrite ? '1' : '0',
        m.side,
        m.map?.uuid ?? '',
        m.alphaMap?.uuid ?? '',
      ].join('|');
      const canon = bySig.get(sig);
      if (canon) {
        if (m !== canon) replacements.set(m, canon);
      } else {
        bySig.set(sig, m);
        unique.push(m);
      }
    }
    list.length = 0;
    list.push(...unique);
  };

  for (const group of Object.values(lightGroups)) {
    if (!group) continue;
    dedupBasicList(group.cones);
    if (group.pools.length > 1) {
      const byPoolSig = new Map<string, (typeof group.pools)[number]>();
      const uniquePools: Array<(typeof group.pools)[number]> = [];
      for (const entry of group.pools) {
        const m = entry?.mat;
        if (!m) continue;
        const sig = [
          entry.maxOpacity.toFixed(4),
          m.type,
          m.color?.getHexString?.() ?? '',
          (m.opacity ?? 1).toFixed(4),
          m.transparent ? '1' : '0',
          m.blending,
          m.depthWrite ? '1' : '0',
          m.side,
          m.map?.uuid ?? '',
          m.alphaMap?.uuid ?? '',
        ].join('|');
        const canon = byPoolSig.get(sig);
        if (canon) {
          if (m !== canon.mat) replacements.set(m, canon.mat);
        } else {
          byPoolSig.set(sig, entry);
          uniquePools.push(entry);
        }
      }
      group.pools.length = 0;
      group.pools.push(...uniquePools);
    }

    if (group.emissives.length > 1) {
      const bySig = new Map<string, THREE.MeshStandardMaterial>();
      const unique: THREE.MeshStandardMaterial[] = [];
      for (const m of group.emissives) {
        if (!m) continue;
        const matU = m.userData as Record<string, unknown> | undefined;
        if (matU?.cutawayLightOpacity !== undefined) {
          unique.push(m);
          continue;
        }
        const kind = kindByMaterial.get(m) ?? 'other';
        const sig = [
          kind,
          m.type,
          m.color?.getHexString?.() ?? '',
          m.emissive?.getHexString?.() ?? '',
          (m.emissiveIntensity ?? 0).toFixed(4),
          (m.roughness ?? 0.5).toFixed(3),
          (m.metalness ?? 0).toFixed(3),
          (m.opacity ?? 1).toFixed(4),
          m.transparent ? '1' : '0',
          m.blending,
          m.depthWrite ? '1' : '0',
          m.side,
          m.map?.uuid ?? '',
          m.emissiveMap?.uuid ?? '',
          m.alphaMap?.uuid ?? '',
        ].join('|');
        const canon = bySig.get(sig);
        if (canon) {
          if (m !== canon) replacements.set(m, canon);
        } else {
          bySig.set(sig, m);
          unique.push(m);
        }
      }
      group.emissives.length = 0;
      group.emissives.push(...unique);
    }
  }

  if (replacements.size === 0) return;
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (Array.isArray(obj.material)) {
      let changed = false;
      const next = obj.material.map((m) => {
        const rep = replacements.get(m);
        if (rep) {
          changed = true;
          return rep;
        }
        return m;
      });
      if (changed) obj.material = next;
    } else if (obj.material) {
      const rep = replacements.get(obj.material);
      if (rep) obj.material = rep;
    }
  });
}

/** Moves a world-space transform under `parent` (handles parent rotation and scale). */
function attachWithWorldTransform(
  obj: THREE.Object3D,
  parent: THREE.Object3D,
  worldPos: THREE.Vector3,
  worldQuat: THREE.Quaternion,
  worldScale: THREE.Vector3
): void {
  parent.updateWorldMatrix(true, false);
  const world = new THREE.Matrix4().compose(worldPos, worldQuat, worldScale);
  const local = new THREE.Matrix4().copy(parent.matrixWorld).invert().multiply(world);
  local.decompose(obj.position, obj.quaternion, obj.scale);
  parent.add(obj);
  obj.updateMatrixWorld(true);
}

export class FittingEffects {
  private readonly kindByMaterial = new Map<THREE.Material, FittingKind>();
  private readonly halos: HaloBatch[] = [];
  private readonly washes: WashDecal[] = [];
  private readonly fillLights: THREE.PointLight[] = [];

  public constructor(options: FittingEffectsOptions) {
    const root = options.sceneRoot ?? findRoot(options.lightGroups);
    if (!root) return;
    root.updateMatrixWorld(true);

    const circuitByMaterial = new Map<THREE.Material, CircuitId>();
    for (const [circuitId, group] of Object.entries(options.lightGroups) as Array<
      [CircuitId, LightGroupMap[CircuitId]]
    >) {
      for (const mat of group.emissives) {
        if (!circuitByMaterial.has(mat)) circuitByMaterial.set(mat, circuitId);
      }
    }
    if (circuitByMaterial.size === 0) return;

    const classified: ClassifiedMesh[] = [];
    const surfaceCandidates: Array<{ readonly mesh: THREE.Mesh; readonly box: THREE.Box3 }> = [];
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh) || obj.userData[FITTING_FX_FLAG]) return;
      const box = new THREE.Box3().setFromObject(obj);
      if (box.isEmpty()) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      let fitting = false;
      for (const m of mats) {
        const circuitId = circuitByMaterial.get(m);
        if (!circuitId || !(m instanceof THREE.MeshStandardMaterial)) continue;
        classified.push({ mesh: obj, mat: m, circuitId, kind: classify(obj, box), box });
        fitting = true;
      }
      if (!fitting && obj.visible) {
        const m0 = mats[0];
        if (m0 && !m0.transparent) surfaceCandidates.push({ mesh: obj, box });
      }
    });

    // Material kind = highest-priority kind among the meshes that use it.
    for (const c of classified) {
      const prev = this.kindByMaterial.get(c.mat);
      if (!prev || kindPriority(c.kind) > kindPriority(prev)) this.kindByMaterial.set(c.mat, c.kind);
    }
    for (const [mat, kind] of this.kindByMaterial) {
      const m = mat as THREE.MeshStandardMaterial;
      const whiten = KIND_WHITEN[kind];
      if (whiten > 0) m.emissive.lerp(WARM_WHITE, whiten);
    }

    deduplicatePerCircuitMaterials(root, options.lightGroups, this.kindByMaterial);
    this.buildHalos(classified, root);
    this.buildWashes(classified, surfaceCandidates, root);
    this.buildFillLights(options.lightGroups, classified, root);
  }

  /** Emissive multiplier for a circuit material (1 for unclassified materials). */
  public getEmissiveGain(mat: THREE.Material): number {
    const kind = this.kindByMaterial.get(mat);
    return kind ? KIND_EMISSIVE_GAIN[kind] : 1;
  }

  public getKind(mat: THREE.Material): FittingKind | undefined {
    return this.kindByMaterial.get(mat);
  }

  public getFillLights(): readonly THREE.PointLight[] {
    return this.fillLights;
  }

  /** Applies one circuit's level (0..1) × time-of-day emissive scale to its halos and washes. */
  public applyLevels(levelFor: (circuitId: CircuitId) => number, emissiveScale: number): void {
    for (const halo of this.halos) {
      const k = levelFor(halo.circuitId) * emissiveScale;
      halo.intensityUniform.value = HALO_STRENGTH * k;
      halo.material.visible = k > 0.002;
    }
    for (const wash of this.washes) {
      const k = levelFor(wash.circuitId) * emissiveScale;
      wash.material.color.copy(wash.baseColor).multiplyScalar(WASH_STRENGTH * k);
      wash.material.visible = k > 0.002;
    }
  }

  private buildHalos(classified: readonly ClassifiedMesh[], root: THREE.Object3D): void {
    const byKey = new Map<string, { parent: THREE.Object3D; circuitId: CircuitId; items: ClassifiedMesh[] }>();
    for (const c of classified) {
      if (c.kind !== 'core' || !c.mesh.parent) continue;
      const container = resolveVisibilityContainer(c.mesh, root);
      const key = `${container.uuid}|${c.circuitId}`;
      let entry = byKey.get(key);
      if (!entry) {
        entry = { parent: container, circuitId: c.circuitId, items: [] };
        byKey.set(key, entry);
      }
      entry.items.push(c);
    }
    // Opaque shades per immediate fitting parent: a bulb inside one is only visible from below the shade opening.
    const opaqueShadeParents = new Set<THREE.Object3D>();
    for (const c of classified) {
      if (c.kind === 'shade' && c.mesh.parent && !CLEAR_SHADE_RE.test(c.mesh.name)) {
        opaqueShadeParents.add(c.mesh.parent);
      }
    }
    const centre = new THREE.Vector3();
    const size = new THREE.Vector3();
    const down = new THREE.Vector3(0, -1, 0);
    const up = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3();
    const parentQuatInv = new THREE.Quaternion();
    for (const { parent, circuitId, items } of byKey.values()) {
      parent.updateWorldMatrix(true, false);
      const inv = new THREE.Matrix4().copy(parent.matrixWorld).invert();
      parent.getWorldQuaternion(parentQuatInv).invert();
      const positions: number[] = [];
      const sizes: number[] = [];
      const colors: number[] = [];
      const dirs: number[] = [];
      const cones: number[] = [];
      for (const c of items) {
        c.box.getCenter(centre);
        c.box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        centre.applyMatrix4(inv);
        positions.push(centre.x, centre.y, centre.z);
        sizes.push(THREE.MathUtils.clamp(maxDim * 4, 0.14, 0.55));
        colors.push(c.mat.emissive.r, c.mat.emissive.g, c.mat.emissive.b);
        let cone = 0;
        if (WALL_CORE_RE.test(c.mesh.name)) {
          dir.set(0, 0, 0);
        } else if (DIRECTIONAL_CORE_RE.test(c.mesh.name)) {
          dir.copy(UPLIGHT_NAME_RE.test(c.mesh.name) ? up : down);
          cone = 0.12;
        } else if (c.mesh.parent && opaqueShadeParents.has(c.mesh.parent)) {
          dir.copy(down);
          cone = -0.25;
        } else {
          dir.set(0, 0, 0);
        }
        if (dir.lengthSq() > 0) dir.applyQuaternion(parentQuatInv);
        dirs.push(dir.x, dir.y, dir.z);
        cones.push(cone);
      }
      const { material, intensityUniform } = createHaloNodeMaterial(
        positions,
        sizes,
        colors,
        dirs,
        cones
      );
      const points = new THREE.Sprite(material);
      points.count = items.length;
      points.name = `fx.halo.${circuitId}`;
      points.userData.isFittingHaloCloud = true;
      points.frustumCulled = false;
      points.renderOrder = 10;
      markFx(points);
      parent.add(points);
      this.halos.push({ circuitId, material, intensityUniform });
    }
  }

  private buildWashes(
    classified: readonly ClassifiedMesh[],
    candidates: ReadonlyArray<{ readonly mesh: THREE.Mesh; readonly box: THREE.Box3 }>,
    root: THREE.Object3D
  ): void {
    const washMatByKey = new Map<string, WashDecal>();
    const washBuckets = new Map<
      string,
      { container: THREE.Object3D; material: THREE.MeshBasicMaterial; matrices: THREE.Matrix4[] }
    >();
    const raycaster = new THREE.Raycaster();
    const ray = new THREE.Ray();
    const centre = new THREE.Vector3();
    const size = new THREE.Vector3();
    const reach = new THREE.Box3();

    const castFrom = (
      origin: THREE.Vector3,
      dir: THREE.Vector3,
      self: THREE.Mesh
    ): THREE.Intersection | null => {
      ray.set(origin, dir);
      reach.makeEmpty().expandByPoint(origin).expandByPoint(origin.clone().addScaledVector(dir, WASH_MAX_DISTANCE));
      const near: THREE.Mesh[] = [];
      for (const c of candidates) {
        if (c.mesh === self || !c.box.intersectsBox(reach)) continue;
        if (ray.intersectsBox(c.box)) near.push(c.mesh);
      }
      if (near.length === 0) return null;
      raycaster.set(origin, dir);
      raycaster.near = 0;
      raycaster.far = WASH_MAX_DISTANCE;
      const hits = raycaster.intersectObjects(near, false);
      return hits[0] ?? null;
    };

    for (const c of classified) {
      if (c.kind !== 'led' || !c.mesh.parent) continue;
      // Exclude luminaire face diffusers and portal rings that are not grazing wall/cabinetry strips
      if (/pictureLight|portalInner|taskBarDiffuser|ledLightBar|mirrorLedHalo/i.test(c.mesh.name)) continue;
      if (!c.mesh.geometry.boundingBox) c.mesh.geometry.computeBoundingBox();
      const localBox = c.mesh.geometry.boundingBox;
      if (localBox) {
        localBox.getCenter(centre).applyMatrix4(c.mesh.matrixWorld);
        localBox.getSize(size);
      } else {
        c.box.getCenter(centre);
        c.box.getSize(size);
      }
      const worldScale = new THREE.Vector3();
      const worldQuat = new THREE.Quaternion();
      c.mesh.matrixWorld.decompose(new THREE.Vector3(), worldQuat, worldScale);
      const axes = [
        { axis: new THREE.Vector3(1, 0, 0).applyQuaternion(worldQuat).normalize(), len: Math.abs(size.x * worldScale.x) },
        { axis: new THREE.Vector3(0, 1, 0).applyQuaternion(worldQuat).normalize(), len: Math.abs(size.y * worldScale.y) },
        { axis: new THREE.Vector3(0, 0, 1).applyQuaternion(worldQuat).normalize(), len: Math.abs(size.z * worldScale.z) },
      ].sort((a, b) => a.len - b.len);
      const thin = axes[0]!;
      const mid = axes[1]!;
      const long = axes[2]!;
      if (mid.len > 0.24) continue;
      const half = thin.len * 0.5;
      const plus = castFrom(centre, thin.axis.clone(), c.mesh);
      const minus = castFrom(centre, thin.axis.clone().negate(), c.mesh);
      const mountGap = half + 0.035;
      const plusMount = plus !== null && plus.distance <= mountGap;
      const minusMount = minus !== null && minus.distance <= mountGap;
      let hit: THREE.Intersection | null = null;
      if (plusMount && !minusMount) hit = minus;
      else if (minusMount && !plusMount) hit = plus;
      else if (!plusMount && !minusMount) {
        const preferPlus = thin.axis.y === 1 ? UPWARD_NAME_RE.test(c.mesh.name) : (plus?.distance ?? 99) < (minus?.distance ?? 99);
        hit = preferPlus ? (plus ?? minus) : (minus ?? plus);
      }
      if (!hit || !hit.face) continue;
      // The wash is a flat decal, so only keep it when the lit surface is flat and continuous
      // along the LED (worktop, floor, wall, ceiling) — not a curved hob lid or a small object.
      const castDir = hit.point.clone().sub(centre).normalize();
      let consistent = 0;
      const samples = 5;
      for (let k = 0; k < samples; k++) {
        const u = (k / (samples - 1) - 0.5) * long.len * 0.9;
        const origin = centre.clone().addScaledVector(long.axis, u);
        const sampleHit = castFrom(origin, castDir, c.mesh);
        if (sampleHit && Math.abs(sampleHit.distance - hit.distance) < 0.04) consistent++;
      }
      if (consistent < samples - 1) continue;

      const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
      const toSource = centre.clone().sub(hit.point);
      if (normal.dot(toSource) < 0) normal.negate();
      const distance = hit.distance;
      const xAxis = long.axis.clone().addScaledVector(normal, -long.axis.dot(normal));
      if (xAxis.lengthSq() < 1e-6) continue;
      xAxis.normalize();
      const yAxis = new THREE.Vector3().crossVectors(normal, xAxis).normalize();
      const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, normal);
      const quat = new THREE.Quaternion().setFromRotationMatrix(basis);
      const spread = THREE.MathUtils.clamp(0.18 + distance * 0.75, 0.18, 0.42);
      const length = long.len + spread * 0.7;
      const pos = hit.point.clone().addScaledVector(normal, 0.006);

      const baseColor = c.mat.emissive.clone();
      const matKey = `${c.circuitId}|${baseColor.getHexString()}`;
      let washEntry = washMatByKey.get(matKey);
      if (!washEntry) {
        const material = new THREE.MeshBasicMaterial({
          color: 0x000000,
          map: getWashTexture(),
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
          fog: false,
        });
        material.visible = false;
        washEntry = { circuitId: c.circuitId, material, baseColor };
        washMatByKey.set(matKey, washEntry);
        this.washes.push(washEntry);
      }
      const container = resolveVisibilityContainer(c.mesh, root);
      const bucketKey = `${container.uuid}|${matKey}`;
      let bucket = washBuckets.get(bucketKey);
      if (!bucket) {
        bucket = { container, material: washEntry.material, matrices: [] };
        washBuckets.set(bucketKey, bucket);
      }
      bucket.matrices.push(new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(length, spread, 1)));
    }

    const basePlane = getWashPlaneGeometry();
    const basePos = basePlane.getAttribute('position') as THREE.BufferAttribute;
    const baseUv = basePlane.getAttribute('uv') as THREE.BufferAttribute;
    const baseIdx = basePlane.getIndex();
    const vTmp = new THREE.Vector3();
    for (const { container, material, matrices } of washBuckets.values()) {
      container.updateWorldMatrix(true, false);
      const invContainer = new THREE.Matrix4().copy(container.matrixWorld).invert();
      const n = matrices.length;
      const posArr = new Float32Array(n * 4 * 3);
      const uvArr = new Float32Array(n * 4 * 2);
      const idxArr = new Uint16Array(n * 6);
      const localMat = new THREE.Matrix4();
      for (let i = 0; i < n; i++) {
        localMat.copy(invContainer).multiply(matrices[i]!);
        for (let v = 0; v < 4; v++) {
          vTmp.fromBufferAttribute(basePos, v).applyMatrix4(localMat);
          const pOff = (i * 4 + v) * 3;
          posArr[pOff] = vTmp.x;
          posArr[pOff + 1] = vTmp.y;
          posArr[pOff + 2] = vTmp.z;
          const uOff = (i * 4 + v) * 2;
          uvArr[uOff] = baseUv.getX(v);
          uvArr[uOff + 1] = baseUv.getY(v);
        }
        if (baseIdx) {
          for (let k = 0; k < 6; k++) {
            idxArr[i * 6 + k] = i * 4 + baseIdx.getX(k);
          }
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
      geo.setIndex(new THREE.BufferAttribute(idxArr, 1));
      geo.computeBoundingSphere();
      const decal = new THREE.Mesh(geo, material);
      decal.name = 'fx.ledWash.batch';
      decal.renderOrder = 9;
      markFx(decal);
      container.add(decal);
    }
  }

  private buildFillLights(
    groups: LightGroupMap,
    classified: readonly ClassifiedMesh[],
    root: THREE.Object3D
  ): void {
    // Real lights already in the scene: a fill is skipped when one already lights that spot.
    const realLights: THREE.Vector3[] = [];
    root.traverse((obj) => {
      if (obj instanceof THREE.PointLight && !obj.userData[FITTING_FX_FLAG]) {
        realLights.push(obj.getWorldPosition(new THREE.Vector3()));
      }
    });
    const byCircuit = new Map<CircuitId, ClassifiedMesh[]>();
    for (const c of classified) {
      const list = byCircuit.get(c.circuitId) ?? [];
      list.push(c);
      byCircuit.set(c.circuitId, list);
    }
    const centre = new THREE.Vector3();
    for (const [circuitId, items] of byCircuit) {
      const group = groups[circuitId];
      if (!group || group.lights.length > 0) continue;
      // Only lamp-type circuits (pendants, lamps, downlights) get a stand-in light; accent kinds
      // (LED strips, coves, shelves, step / picture lights, festoons) stay emissive-only.
      const lamps = items.filter(
        (c) => (c.kind === 'core' || c.kind === 'shade') && !ACCENT_FITTING_RE.test(c.mesh.name)
      );
      const sources = lamps;
      const anchor = sources[0]?.mesh.parent;
      if (!anchor) continue;
      const sum = new THREE.Vector3();
      let minY = Infinity;
      for (const s of sources) {
        s.box.getCenter(centre);
        sum.add(centre);
        minY = Math.min(minY, s.box.min.y);
      }
      sum.divideScalar(sources.length);
      // Just below the fittings so pendants light the room below rather than the ceiling.
      sum.y = Math.min(sum.y, minY) - 0.2;
      const alreadyLit = realLights.some(
        (p) => Math.abs(p.y - sum.y) < FILL_SKIP_VERTICAL && Math.hypot(p.x - sum.x, p.z - sum.z) < FILL_SKIP_RADIUS
      );
      if (alreadyLit) continue;
      const light = new THREE.PointLight(
        sources[0]!.mat.emissive.clone().lerp(WARM_WHITE, 0.3),
        0,
        THREE.MathUtils.clamp(2.6 + group.maxIntensity * 0.32, 3, 7),
        1.6
      );
      light.name = `fx.fillLight.${circuitId}`;
      light.castShadow = false;
      light.userData[FITTING_FX_FLAG] = true;
      light.userData[ALWAYS_HOIST_LIGHT_FLAG] = true;
      // Modest: a stand-in for the fittings' own light, never a second room fill.
      light.userData.baseIntensity = group.maxIntensity * (lamps.length > 0 ? 0.65 : 0.4);
      attachWithWorldTransform(light, anchor, sum, new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      group.lights.push(light);
      this.fillLights.push(light);
    }
  }
}
