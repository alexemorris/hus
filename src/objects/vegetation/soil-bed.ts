import * as THREE from 'three';
import {
  Fn,
  clamp,
  float,
  mix,
  normalWorld,
  smoothstep,
  texture,
  uv,
  vec3,
  vertexColor,
} from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import type { AssetMetadata } from '../../core/assets/asset-metadata.ts';
import { getExposureEnvelope, type VegetationExposure } from '../../core/geo/climate-phenology.ts';
import { attachAssetMetadata } from '../../engine/assets/smart-asset.ts';
import { tagCollisionRole } from '../../engine/geometry/mesh-traits.ts';
import { detectMobile } from '../../engine/perf/device-tier.ts';
import {
  getOrCreateSoilTextures,
  type SoilSubstrate,
} from '../../engine/vegetation/soil-textures.ts';
import {
  SHARED_VEGETATION_UNIFORMS,
  type VegetationUniforms,
} from '../../engine/vegetation/vegetation-uniforms.ts';
import {
  OrganCollector,
  assembleBotanicalMeshes,
  createBotanicalRng,
  resolveReactivity,
} from './organ-geometry.ts';

export type { SoilSubstrate, SoilTextureSet } from '../../engine/vegetation/soil-textures.ts';
export { getOrCreateSoilTextures } from '../../engine/vegetation/soil-textures.ts';

export interface SoilMaterialOptions {
  readonly substrate?: SoilSubstrate;
  readonly exposure?: VegetationExposure;
  readonly uniforms?: VegetationUniforms;
  readonly wetnessBoost?: number;
  readonly name?: string;
}

export interface SoilBedPoint2D {
  readonly x: number;
  readonly z: number;
}

export type SoilBedPointInput = SoilBedPoint2D | readonly [number, number];

export interface SoilPlantingAnchor {
  readonly x: number;
  readonly z: number;
  readonly radius?: number;
  readonly stemRadius?: number;
  readonly moundRadius?: number;
  readonly moundHeight?: number;
}

export interface CreateSoilBedOptions {
  readonly substrate?: SoilSubstrate;
  readonly exposure?: VegetationExposure;
  /** Axis-aligned rectangle shorthand `[width, depth]` centered at `(0, 0)` (or offset by `center`). */
  readonly width?: number;
  readonly depth?: number;
  readonly center?: SoilBedPoint2D;
  /** Circular/elliptical disc shorthand (e.g. for round pots/tree pits). */
  readonly radius?: number;
  readonly radialSegments?: number;
  /** Arbitrary 2D polygon boundary in local `(x, z)` coordinates (convex or concave!). */
  readonly polygon?: readonly SoilBedPointInput[];
  /** Optional interior hole polygons in local `(x, z)`. */
  readonly holes?: readonly (readonly SoilBedPointInput[])[];
  /** Base datum Y at the perimeter lip (default `0`). */
  readonly baseY?: number;
  /** Optional underlying terrain elevation sampler `(x, z) => y` added to `baseY`. */
  readonly sampleBaseY?: (x: number, z: number) => number;
  /** Perimeter recess below `baseY` so soil sits neatly below kerb/planter lips (default `0.018` m; `0` when flush). */
  readonly edgeRecessM?: number;
  /** Crown/pillow height at the interior of the bed above the recessed edge (default `0.036` m). */
  readonly crownHeightM?: number;
  /** Furrow ridge amplitude for `'tilled-veg-earth'` raised beds (default `0.014` m when substrate is `'tilled-veg-earth'`, else `0`). */
  readonly furrowAmplitudeM?: number;
  readonly furrowSpacingM?: number;
  /** Grid resolution in metres for interior subdivision (default `0.22` m, clamped so vertex count stays lean `< 2,500` verts). */
  readonly gridStepM?: number;
  /** Optional stem positions to add subtle 3D root-collar mounds + dark basal contact AO around emerging stems. */
  readonly plantings?: readonly SoilPlantingAnchor[];
  /** Optional seasonal fallen-leaf / blossom-petal scatter on `'outdoor'` beds (default `false`). */
  readonly seasonalLitter?: boolean | 'autumn-leaves' | 'spring-petals';
  readonly seed?: number;
  readonly uniforms?: VegetationUniforms;
  readonly receiveShadow?: boolean;
  readonly castShadow?: boolean;
  readonly name?: string;
  readonly metadata?: Partial<AssetMetadata>;
}

export interface SoilBedHandle {
  readonly group: THREE.Group;
  readonly soilMesh: THREE.Mesh;
  readonly substrate: SoilSubstrate;
  /** Evaluates exact local Y of the crowned soil surface at `(x, z)`. */
  sampleHeight(x: number, z: number): number;
  /** Recommended planting Y (`sampleHeight(x, z) - 0.02`) so stems anchor `-20 mm` into soil with zero floating gap. */
  samplePlantingY(x: number, z: number): number;
}

const sharedSoilMaterialCache = new Map<string, MeshStandardNodeMaterial>();

export function createSoilMaterial(options: SoilMaterialOptions = {}): MeshStandardNodeMaterial {
  const substrate = options.substrate ?? 'garden-loam';
  const exposure = options.exposure ?? 'outdoor';
  const isDefaultUniforms = !options.uniforms || options.uniforms === SHARED_VEGETATION_UNIFORMS;
  const canCache =
    isDefaultUniforms && options.wetnessBoost === undefined && options.name === undefined;
  const cacheKey = `${substrate}:${exposure}`;
  if (canCache) {
    const existing = sharedSoilMaterialCache.get(cacheKey);
    if (existing) return existing;
  }

  const texSet = getOrCreateSoilTextures(substrate);
  const u = options.uniforms ?? SHARED_VEGETATION_UNIFORMS;
  const env = getExposureEnvelope(exposure);
  const snowEnv = float(env.snowScale);
  const wetBoost = float(THREE.MathUtils.clamp(options.wetnessBoost ?? 0, 0, 1));

  const mat = new MeshStandardNodeMaterial({
    name: options.name ?? `husjs.vegetation.soil.${substrate}.${exposure}`,
    roughness: 0.9,
    metalness: 0.0,
    vertexColors: false,
  });
  mat.normalMap = texSet.normalMap;
  mat.normalScale = new THREE.Vector2(0.85, 0.85);

  mat.colorNode = Fn(() => {
    const uvCoord = uv();
    const albedoTex = texture(texSet.albedoMap, uvCoord).rgb;
    const roughTex = texture(texSet.roughnessMap, uvCoord).r;
    const baseCol = albedoTex.mul(vertexColor().rgb);
    const wetness = clamp(u.uRainWetness.mul(snowEnv).add(wetBoost), 0.0, 1.0);
    const wetDarkened = baseCol.mul(mix(float(1.0), float(0.58), wetness));
    const upAlign = smoothstep(0.32, 0.82, normalWorld.y);
    const creviceBias = mix(float(0.82), float(1.18), smoothstep(0.72, 0.96, roughTex));
    const snowCap = clamp(u.uSnowAmount.mul(snowEnv).mul(upAlign).mul(creviceBias), 0.0, 0.94);
    return clamp(mix(wetDarkened, vec3(0.92, 0.95, 0.98), snowCap), 0.0, 1.0);
  })();

  mat.roughnessNode = Fn(() => {
    const roughTex = texture(texSet.roughnessMap, uv()).r;
    const wetness = clamp(u.uRainWetness.mul(snowEnv).add(wetBoost), 0.0, 1.0);
    const wetRough = mix(roughTex, float(0.34), wetness.mul(0.85));
    const upAlign = smoothstep(0.32, 0.82, normalWorld.y);
    const snowCap = clamp(u.uSnowAmount.mul(snowEnv).mul(upAlign), 0.0, 0.92);
    return clamp(mix(wetRough, float(0.86), snowCap), 0.12, 0.99);
  })();

  mat.userData['isSoilMaterial'] = true;
  mat.userData['skipMaterialDedupe'] = true;
  mat.userData['vegetationExposure'] = exposure;
  if (exposure === 'outdoor') {
    mat.userData['excludeIndoorLighting'] = true;
  }

  if (canCache) sharedSoilMaterialCache.set(cacheKey, mat);
  return mat;
}

function hashGrid2D(ix: number, iz: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function valueNoise2D(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const sx = THREE.MathUtils.smoothstep(x - ix, 0, 1);
  const sz = THREE.MathUtils.smoothstep(z - iz, 0, 1);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(hashGrid2D(ix, iz, seed), hashGrid2D(ix + 1, iz, seed), sx),
    THREE.MathUtils.lerp(hashGrid2D(ix, iz + 1, seed), hashGrid2D(ix + 1, iz + 1, seed), sx),
    sz
  );
}

function clodFbm2D(x: number, z: number, seed: number): number {
  const f =
    valueNoise2D(x * 3.4, z * 3.4, seed) * 0.55 +
    valueNoise2D(x * 7.8, z * 7.8, seed + 53) * 0.3 +
    valueNoise2D(x * 15.2, z * 15.2, seed + 113) * 0.15;
  return f * 2 - 1;
}

function cleanRing(pts: readonly SoilBedPointInput[]): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const raw = pts[i]!;
    const px = Array.isArray(raw) ? raw[0] : (raw as SoilBedPoint2D).x;
    const pz = Array.isArray(raw) ? raw[1] : (raw as SoilBedPoint2D).z;
    if (!Number.isFinite(px) || !Number.isFinite(pz)) continue;
    const prev = out[out.length - 1];
    if (prev && Math.hypot(px - prev.x, pz - prev.y) < 1e-5) continue;
    out.push(new THREE.Vector2(px, pz));
  }
  if (out.length > 2 && Math.hypot(out[0]!.x - out[out.length - 1]!.x, out[0]!.y - out[out.length - 1]!.y) < 1e-5) {
    out.pop();
  }
  return out;
}

function pointInRing(px: number, pz: number, ring: readonly THREE.Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]!.x;
    const zi = ring[i]!.y;
    const xj = ring[j]!.x;
    const zj = ring[j]!.y;
    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function minRingEdgeDist(px: number, pz: number, ring: readonly THREE.Vector2[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const dx = b.x - a.x;
    const dz = b.y - a.y;
    const lenSq = dx * dx + dz * dz;
    const t = lenSq < 1e-10 ? 0 : THREE.MathUtils.clamp(((px - a.x) * dx + (pz - a.y) * dz) / lenSq, 0, 1);
    const d = Math.hypot(px - (a.x + t * dx), pz - (a.y + t * dz));
    if (d < best) best = d;
  }
  return best;
}

interface Mesh2DTopology {
  readonly xs: number[];
  readonly zs: number[];
  readonly tris: number[];
}

function pushUpwardTri(
  xs: readonly number[],
  zs: readonly number[],
  a: number,
  b: number,
  c: number,
  out: number[]
): void {
  const cross = (xs[b]! - xs[a]!) * (zs[c]! - zs[a]!) - (zs[b]! - zs[a]!) * (xs[c]! - xs[a]!);
  if (Math.abs(cross) < 1e-12) return;
  if (cross > 0) out.push(a, c, b);
  else out.push(a, b, c);
}

function buildPolygonTopology(
  outerRing: THREE.Vector2[],
  holeRings: THREE.Vector2[][],
  maxEdge: number,
  maxVerts: number
): Mesh2DTopology {
  const contour = outerRing.map((v) => v.clone());
  if (!THREE.ShapeUtils.isClockWise(contour)) contour.reverse();
  const holes = holeRings.map((h) => {
    const copy = h.map((v) => v.clone());
    if (THREE.ShapeUtils.isClockWise(copy)) copy.reverse();
    return copy;
  });

  const rawFaces = THREE.ShapeUtils.triangulateShape(contour, holes);
  const allPts: THREE.Vector2[] = [...contour];
  for (let i = 0; i < holes.length; i++) allPts.push(...holes[i]!);

  const xs = allPts.map((p) => p.x);
  const zs = allPts.map((p) => p.y);
  let tris: number[] = [];
  for (let i = 0; i < rawFaces.length; i++) {
    const f = rawFaces[i]!;
    if (f.length >= 3) pushUpwardTri(xs, zs, f[0]!, f[1]!, f[2]!, tris);
  }

  const edgeKey = (u: number, v: number): number => (u < v ? u * 65536 + v : v * 65536 + u);

  for (let pass = 0; pass < 8; pass++) {
    if (xs.length >= maxVerts) break;
    const splitEdges = new Map<number, number>();
    const consider = (u: number, v: number): void => {
      if (xs.length >= maxVerts) return;
      const key = edgeKey(u, v);
      if (splitEdges.has(key)) return;
      if (Math.hypot(xs[u]! - xs[v]!, zs[u]! - zs[v]!) > maxEdge) {
        const midIdx = xs.length;
        xs.push((xs[u]! + xs[v]!) * 0.5);
        zs.push((zs[u]! + zs[v]!) * 0.5);
        splitEdges.set(key, midIdx);
      }
    };

    for (let t = 0; t < tris.length; t += 3) {
      consider(tris[t]!, tris[t + 1]!);
      consider(tris[t + 1]!, tris[t + 2]!);
      consider(tris[t + 2]!, tris[t]!);
    }
    if (splitEdges.size === 0) break;

    const nextTris: number[] = [];
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t]!;
      const b = tris[t + 1]!;
      const c = tris[t + 2]!;
      const mab = splitEdges.get(edgeKey(a, b));
      const mbc = splitEdges.get(edgeKey(b, c));
      const mca = splitEdges.get(edgeKey(c, a));
      const cnt = (mab !== undefined ? 1 : 0) + (mbc !== undefined ? 1 : 0) + (mca !== undefined ? 1 : 0);

      if (cnt === 0) {
        nextTris.push(a, b, c);
      } else if (cnt === 3) {
        nextTris.push(a, mab!, mca!, mab!, b, mbc!, mca!, mbc!, c, mab!, mbc!, mca!);
      } else if (cnt === 1) {
        const [u, v, w, m] =
          mab !== undefined
            ? [a, b, c, mab]
            : mbc !== undefined
              ? [b, c, a, mbc]
              : [c, a, b, mca!];
        nextTris.push(u, m, w, m, v, w);
      } else {
        const [u, v, w, m1, m2] =
          mca === undefined
            ? [a, b, c, mab!, mbc!]
            : mab === undefined
              ? [b, c, a, mbc!, mca!]
              : [c, a, b, mca!, mab!];
        nextTris.push(m1, v, m2);
        const d1 = Math.hypot(xs[u]! - xs[m2]!, zs[u]! - zs[m2]!);
        const d2 = Math.hypot(xs[w]! - xs[m1]!, zs[w]! - zs[m1]!);
        if (d1 <= d2) nextTris.push(u, m1, m2, u, m2, w);
        else nextTris.push(u, m1, w, m1, m2, w);
      }
    }
    tris = nextTris;
  }

  return { xs, zs, tris };
}

function buildDiscTopology(
  cx: number,
  cz: number,
  radius: number,
  radialSegs: number,
  step: number
): Mesh2DTopology {
  const rings = Math.max(2, Math.min(22, Math.ceil(radius / step)));
  const segs = Math.max(8, Math.min(96, radialSegs));
  const xs: number[] = [cx];
  const zs: number[] = [cz];
  const tris: number[] = [];

  for (let ir = 1; ir <= rings; ir++) {
    const r = (ir / rings) * radius;
    for (let is = 0; is < segs; is++) {
      const theta = (is / segs) * Math.PI * 2;
      xs.push(cx + Math.cos(theta) * r);
      zs.push(cz + Math.sin(theta) * r);
    }
  }
  for (let is = 0; is < segs; is++) {
    pushUpwardTri(xs, zs, 0, 1 + ((is + 1) % segs), 1 + is, tris);
  }
  for (let ir = 1; ir < rings; ir++) {
    const r0 = 1 + (ir - 1) * segs;
    const r1 = 1 + ir * segs;
    for (let is = 0; is < segs; is++) {
      const isNext = (is + 1) % segs;
      pushUpwardTri(xs, zs, r0 + is, r1 + isNext, r1 + is, tris);
      pushUpwardTri(xs, zs, r0 + is, r0 + isNext, r1 + isNext, tris);
    }
  }
  return { xs, zs, tris };
}

function buildRectTopology(
  cx: number,
  cz: number,
  width: number,
  depth: number,
  step: number,
  maxVerts: number
): Mesh2DTopology {
  let nx = Math.max(2, Math.ceil(width / step));
  let nz = Math.max(2, Math.ceil(depth / step));
  if ((nx + 1) * (nz + 1) > maxVerts) {
    const scale = Math.sqrt((maxVerts - 40) / ((nx + 1) * (nz + 1)));
    nx = Math.max(2, Math.floor(nx * scale));
    nz = Math.max(2, Math.floor(nz * scale));
  }
  const xs: number[] = [];
  const zs: number[] = [];
  const tris: number[] = [];
  const x0 = cx - width * 0.5;
  const z0 = cz - depth * 0.5;

  for (let iz = 0; iz <= nz; iz++) {
    const z = z0 + (iz / nz) * depth;
    for (let ix = 0; ix <= nx; ix++) {
      xs.push(x0 + (ix / nx) * width);
      zs.push(z);
    }
  }
  const stride = nx + 1;
  for (let iz = 0; iz < nz; iz++) {
    const r0 = iz * stride;
    const r1 = r0 + stride;
    for (let ix = 0; ix < nx; ix++) {
      pushUpwardTri(xs, zs, r0 + ix, r1 + ix, r1 + ix + 1, tris);
      pushUpwardTri(xs, zs, r0 + ix, r1 + ix + 1, r0 + ix + 1, tris);
    }
  }
  return { xs, zs, tris };
}

export function createSoilBed(options: CreateSoilBedOptions = {}): SoilBedHandle {
  const substrate = options.substrate ?? 'garden-loam';
  const exposure = options.exposure ?? 'outdoor';
  const seed = Math.round((options.seed ?? 409) * 1000) | 0;
  const baseY = options.baseY ?? 0;
  const edgeRecessM = options.edgeRecessM ?? 0.018;
  const crownHeightM = options.crownHeightM ?? 0.036;
  const furrowAmp = options.furrowAmplitudeM ?? (substrate === 'tilled-veg-earth' ? 0.014 : 0);
  const furrowSpacing = Math.max(0.08, options.furrowSpacingM ?? 0.24);
  const mobileSoil = detectMobile();
  const step = THREE.MathUtils.clamp(options.gridStepM ?? (mobileSoil ? 0.34 : 0.22), 0.04, 1.5);
  const maxVerts = mobileSoil ? 900 : 2400;

  const plantings = (options.plantings ?? []).map((p) => {
    const stemR = Math.max(0.008, p.stemRadius ?? 0.03);
    const moundR = Math.max(stemR * 1.4, p.moundRadius ?? p.radius ?? Math.max(0.14, stemR * 3.8));
    return { x: p.x, z: p.z, stemR, moundR, moundH: p.moundHeight ?? 0.022 };
  });

  const cx = options.center?.x ?? 0;
  const cz = options.center?.z ?? 0;

  let topology: Mesh2DTopology;
  let minX = 0;
  let maxX = 0;
  let minZ = 0;
  let maxZ = 0;
  let minSpan = 0.8;
  let evalEdgeDist: (x: number, z: number) => number;

  const cleanedPoly = options.polygon ? cleanRing(options.polygon) : [];
  if (cleanedPoly.length >= 3) {
    const cleanedHoles = (options.holes ?? [])
      .map((h) => cleanRing(h))
      .filter((h) => h.length >= 3);
    minX = Number.POSITIVE_INFINITY;
    maxX = Number.NEGATIVE_INFINITY;
    minZ = Number.POSITIVE_INFINITY;
    maxZ = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < cleanedPoly.length; i++) {
      const p = cleanedPoly[i]!;
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.y);
      maxZ = Math.max(maxZ, p.y);
    }
    minSpan = Math.max(0.08, Math.min(maxX - minX, maxZ - minZ));
    const effectiveStep = Math.max(step, Math.sqrt(((maxX - minX) * (maxZ - minZ)) / (maxVerts * 0.72)));
    topology = buildPolygonTopology(cleanedPoly, cleanedHoles, effectiveStep, maxVerts);

    evalEdgeDist = (x: number, z: number): number => {
      let d = minRingEdgeDist(x, z, cleanedPoly);
      for (let i = 0; i < cleanedHoles.length; i++) {
        d = Math.min(d, minRingEdgeDist(x, z, cleanedHoles[i]!));
      }
      if (d < 1e-4 || !pointInRing(x, z, cleanedPoly)) return 0;
      for (let i = 0; i < cleanedHoles.length; i++) {
        if (pointInRing(x, z, cleanedHoles[i]!)) return 0;
      }
      return d;
    };
  } else if (typeof options.radius === 'number' && options.radius > 0) {
    const r = options.radius;
    const radSegs = options.radialSegments ?? Math.max(16, Math.round((Math.PI * 2 * r) / Math.min(step, 0.16)));
    minX = cx - r;
    maxX = cx + r;
    minZ = cz - r;
    maxZ = cz + r;
    minSpan = Math.max(0.06, r * 2);
    topology = buildDiscTopology(cx, cz, r, radSegs, Math.min(step, Math.max(0.05, r * 0.35)));
    evalEdgeDist = (x: number, z: number): number => Math.max(0, r - Math.hypot(x - cx, z - cz));
  } else {
    const w = Math.max(0.08, options.width ?? 1.2);
    const d = Math.max(0.08, options.depth ?? 0.8);
    minX = cx - w * 0.5;
    maxX = cx + w * 0.5;
    minZ = cz - d * 0.5;
    maxZ = cz + d * 0.5;
    minSpan = Math.min(w, d);
    topology = buildRectTopology(cx, cz, w, d, step, maxVerts);
    evalEdgeDist = (x: number, z: number): number =>
      Math.max(0, Math.min(x - minX, maxX - x, z - minZ, maxZ - z));
  }

  const crownRampM = Math.max(0.015, Math.min(0.28, minSpan * 0.42));
  const aoRampM = Math.max(0.012, Math.min(0.16, crownRampM));

  const sampleHeightWithEdge = (x: number, z: number, dEdge: number): number => {
    const baseSurf = baseY + (options.sampleBaseY ? options.sampleBaseY(x, z) : 0);
    const crownT = THREE.MathUtils.smoothstep(dEdge, 0, crownRampM);
    const clod = clodFbm2D(x, z, seed) * 0.006 * crownT;
    const furrow = furrowAmp !== 0 ? Math.sin((x / furrowSpacing) * Math.PI * 2) * furrowAmp * crownT : 0;
    let mound = 0;
    for (let i = 0; i < plantings.length; i++) {
      const p = plantings[i]!;
      const dx = x - p.x;
      const dz = z - p.z;
      mound += p.moundH * Math.exp(-(dx * dx + dz * dz) / (p.moundR * p.moundR));
    }
    return baseSurf - edgeRecessM + crownT * crownHeightM + clod + furrow + mound;
  };

  const sampleHeight = (x: number, z: number): number => sampleHeightWithEdge(x, z, evalEdgeDist(x, z));
  const samplePlantingY = (x: number, z: number): number => sampleHeight(x, z) - 0.02;

  const invTile = 1 / getOrCreateSoilTextures(substrate).tileMetres;
  const vCount = topology.xs.length;
  const positions = new Float32Array(vCount * 3);
  const uvs = new Float32Array(vCount * 2);
  const colors = new Float32Array(vCount * 3);

  for (let i = 0; i < vCount; i++) {
    const x = topology.xs[i]!;
    const z = topology.zs[i]!;
    const dEdge = evalEdgeDist(x, z);
    positions[i * 3] = x;
    positions[i * 3 + 1] = sampleHeightWithEdge(x, z, dEdge);
    positions[i * 3 + 2] = z;
    uvs[i * 2] = x * invTile;
    uvs[i * 2 + 1] = z * invTile;

    const edgeAo = THREE.MathUtils.lerp(0.8, 1.0, THREE.MathUtils.smoothstep(dEdge, 0, aoRampM));
    let stemAo = 1.0;
    for (let pIdx = 0; pIdx < plantings.length; pIdx++) {
      const p = plantings[pIdx]!;
      const t = THREE.MathUtils.smoothstep(Math.hypot(x - p.x, z - p.z), p.stemR, p.moundR * 1.35);
      stemAo = Math.min(stemAo, THREE.MathUtils.lerp(0.62, 1.0, t));
    }
    const ao = THREE.MathUtils.clamp(edgeAo * stemAo, 0, 1);
    colors[i * 3] = ao;
    colors[i * 3 + 1] = ao;
    colors[i * 3 + 2] = ao;
  }

  const namePrefix = options.name ?? `husjs.vegetation.soilBed.${substrate}`;
  const geo = new THREE.BufferGeometry();
  geo.name = `${namePrefix}.geo`;
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(topology.tris);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  const soilMesh = new THREE.Mesh(
    geo,
    createSoilMaterial({ substrate, exposure, uniforms: options.uniforms })
  );
  soilMesh.name = `${namePrefix}.soil`;
  soilMesh.receiveShadow = options.receiveShadow ?? true;
  soilMesh.castShadow = options.castShadow ?? false;
  soilMesh.userData['excludeFromRaycast'] = true;
  soilMesh.userData['vegetationExposure'] = exposure;
  tagCollisionRole(soilMesh, 'ignore');

  const group = new THREE.Group();
  group.name = namePrefix;
  group.userData['vegetationExposure'] = exposure;
  group.userData['tradeCategory'] = exposure === 'indoor' ? 'decor' : 'external';
  group.add(soilMesh);

  if (options.seasonalLitter && exposure === 'outdoor') {
    const rng = createBotanicalRng((options.seed ?? 409) + 73);
    const isAutumn = options.seasonalLitter !== 'spring-petals';
    const litterCol = new THREE.Color(isAutumn ? 0x9c551f : 0xf6dce3);
    const litterCollector = new OrganCollector();
    const reactivity = resolveReactivity(exposure);
    const area = Math.max(0.15, (maxX - minX) * (maxZ - minZ));
    const targetFlakes = THREE.MathUtils.clamp(Math.round(area * 14), 8, 96);
    let placed = 0;

    for (let attempt = 0; attempt < targetFlakes * 4 && placed < targetFlakes; attempt++) {
      const lx = rng.range(minX + 0.03, maxX - 0.03);
      const lz = rng.range(minZ + 0.03, maxZ - 0.03);
      if (evalEdgeDist(lx, lz) < 0.03) continue;
      placed++;
      const yaw = rng.range(0, Math.PI * 2);
      const dir = new THREE.Vector3(Math.cos(yaw), rng.range(0.02, 0.12), Math.sin(yaw)).normalize();
      const flakeSize = isAutumn ? rng.range(0.035, 0.062) : rng.range(0.018, 0.032);
      const jit = rng.signed();
      const col = litterCol
        .clone()
        .offsetHSL(jit * (isAutumn ? 0.045 : 0.015), jit * 0.06, jit * 0.05);
      litterCollector.addCuppedLeafBlade({
        pivot: new THREE.Vector3(lx, sampleHeight(lx, lz) + 0.003, lz),
        direction: dir,
        length: flakeSize,
        width: flakeSize * rng.range(0.62, 0.92),
        archDrop: 0.0025,
        cupDepth: 0.0025,
        segsLength: 2,
        segsWidth: 2,
        color: col,
        meta: {
          organ: 'ground-litter',
          jitter: rng.next(),
          reactivity,
          variant: isAutumn ? 0.8 : 0.2,
        },
      });
    }

    if (!litterCollector.isEmpty()) {
      assembleBotanicalMeshes({
        group,
        namePrefix: `${namePrefix}.litter`,
        exposure,
        foliageCollector: litterCollector,
        uniforms: options.uniforms,
        castCanopyShadow: false,
      });
      group.traverse((child) => {
        if (child instanceof THREE.Mesh && child !== soilMesh) {
          child.userData['excludeFromRaycast'] = true;
          tagCollisionRole(child, 'ignore');
        }
      });
    }
  }

  tagCollisionRole(group, 'ignore');

  if (options.metadata) {
    attachAssetMetadata(group, {
      category: 'vegetation',
      name: options.metadata.name ?? `Soil Bed (${substrate})`,
      dimensionsMm: [
        Math.round((maxX - minX) * 1000),
        Math.round((maxZ - minZ) * 1000),
        Math.round(Math.max(0.02, crownHeightM + edgeRecessM) * 1000),
      ],
      ...options.metadata,
    });
  }

  return { group, soilMesh, substrate, sampleHeight, samplePlantingY };
}
