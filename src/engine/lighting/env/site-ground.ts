import * as THREE from 'three';
import {
  Fn,
  abs,
  cameraViewMatrix,
  clamp,
  dot,
  float,
  fract,
  length,
  mix,
  normalLocal,
  normalize,
  positionWorld,
  pow,
  sin,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vertexColor,
} from 'three/tsl';
import {
  createTerrainSampler,
  resolveTerrainBiomeConfig,
  type ResolvedTerrainBiomeConfig,
  type TerrainBiomeInput,
  type TerrainSurfaceSampler,
} from '../../../core/geo/terrain-modifiers.ts';
import { DEFAULT_SITE_HAZE_FOOTPRINT, type SiteHazeFootprint } from './site-haze-fog.ts';

/** Legacy reference datum (−0.705 m); retained for consumers querying nominal plinth base. */
export const SITE_GROUND_Y = -0.705;

type SiteGroundSampler = Pick<
  TerrainSurfaceSampler,
  'sampleTerrainY' | 'sampleCarvedMeshY' | 'sampleNormal'
> & {
  readonly biome?: TerrainBiomeInput;
};

const DEFAULT_FLAT_SAMPLER = createTerrainSampler({ base: 'flat', flatElevationY: 0 });
const DEFAULT_SITE_TERRAIN_SAMPLER: SiteGroundSampler = {
  sampleTerrainY: DEFAULT_FLAT_SAMPLER.sampleTerrainY,
  sampleCarvedMeshY: DEFAULT_FLAT_SAMPLER.sampleCarvedMeshY,
  sampleNormal: DEFAULT_FLAT_SAMPLER.sampleNormal,
};

const meshTerrainSamplers = new WeakMap<THREE.Object3D, SiteGroundSampler>();

const VALLEY_HALF_EXTENT = 1750;
const TERRAIN_MIN_Y = -36.0;
const TERRAIN_MAX_Y = 46.0;
const FADE_START = 420;
const FADE_END = 1680;
const TEXTURE_SIZE = 256;
/** World metres covered by one tile of the fine English meadow/lawn detail texture. */
const TILE_METRES = 4.5;

interface TslCapableStandardMaterial {
  colorNode?: unknown;
  roughnessNode?: unknown;
  normalNode?: unknown;
}

// Reusable scratch objects for O(1) zero-allocation analytical heightfield ray-marching
const _rayInvMatrix = new THREE.Matrix4();
const _localRay = new THREE.Ray();
const _terrainBounds = new THREE.Box3(
  new THREE.Vector3(-VALLEY_HALF_EXTENT, TERRAIN_MIN_Y, -VALLEY_HALF_EXTENT),
  new THREE.Vector3(VALLEY_HALF_EXTENT, TERRAIN_MAX_Y, VALLEY_HALF_EXTENT)
);
const _boxEntry = new THREE.Vector3();
const _worldHit = new THREE.Vector3();
const _worldNormal = new THREE.Vector3();

/**
 * Fast `O(1)` analytical heightfield ray-march (`< 0.015 ms`) replacing Three.js's brute-force
 * `O(N)` triangle-soup `Mesh.prototype.raycast` on `environment.siteGround`.
 *
 * Clips the ray against the terrain slab (dynamically expanded for deep promontory cliffs), marches
 * in adaptive coarse steps querying `sampleCarvedMeshY(wx, wz)` until `(rayY - terrainY)` crosses
 * from `>= 0` to `<= 0`, then refines with 7 bisection iterations (`< 1.5 cm` precision).
 */
export function raycastTopographicSiteGround(
  this: THREE.Mesh,
  raycaster: THREE.Raycaster,
  intersects: THREE.Intersection[]
): void {
  if (!this.visible) return;

  _rayInvMatrix.copy(this.matrixWorld).invert();
  _localRay.copy(raycaster.ray).applyMatrix4(_rayInvMatrix);

  const ox = _localRay.origin.x;
  const oy = _localRay.origin.y;
  const oz = _localRay.origin.z;
  const dx = _localRay.direction.x;
  const dy = _localRay.direction.y;
  const dz = _localRay.direction.z;

  const geomBox = this.geometry.boundingBox;
  const minY =
    geomBox !== null ? Math.min(TERRAIN_MIN_Y, geomBox.min.y - 2.0) : TERRAIN_MIN_Y;
  const maxY =
    geomBox !== null ? Math.max(TERRAIN_MAX_Y, geomBox.max.y + 2.0) : TERRAIN_MAX_Y;

  // Slab intersection against terrain bounds to obtain tight [tMin, tMax]
  let tMin = Math.max(0, raycaster.near);
  let tMax = Number.isFinite(raycaster.far) ? raycaster.far : 5000;

  const clipAxis = (o: number, d: number, bMin: number, bMax: number): boolean => {
    if (Math.abs(d) < 1e-9) {
      return o >= bMin && o <= bMax;
    }
    const invD = 1 / d;
    let t0 = (bMin - o) * invD;
    let t1 = (bMax - o) * invD;
    if (t0 > t1) {
      const tmp = t0;
      t0 = t1;
      t1 = tmp;
    }
    if (t0 > tMin) tMin = t0;
    if (t1 < tMax) tMax = t1;
    return tMin <= tMax;
  };

  if (
    !clipAxis(ox, dx, _terrainBounds.min.x, _terrainBounds.max.x) ||
    !clipAxis(oy, dy, minY, maxY) ||
    !clipAxis(oz, dz, _terrainBounds.min.z, _terrainBounds.max.z)
  ) {
    return;
  }

  const activeSampler = meshTerrainSamplers.get(this) ?? DEFAULT_SITE_TERRAIN_SAMPLER;
  const sampleCarved = activeSampler.sampleCarvedMeshY;
  const sampleNorm = activeSampler.sampleNormal;

  const emitHit = (tLocal: number): void => {
    const lx = ox + dx * tLocal;
    const lz = oz + dz * tLocal;
    const ly = sampleCarved(lx, lz);
    _boxEntry.set(lx, ly, lz);
    _worldHit.copy(_boxEntry).applyMatrix4(this.matrixWorld);
    const worldDist = raycaster.ray.origin.distanceTo(_worldHit);
    if (worldDist < raycaster.near || worldDist > raycaster.far) return;

    const nrm = sampleNorm(lx, lz);
    _worldNormal.set(nrm.nx, nrm.ny, nrm.nz);
    intersects.push({
      distance: worldDist,
      point: _worldHit.clone(),
      object: this,
      face: {
        a: 0,
        b: 1,
        c: 2,
        normal: _worldNormal.clone(),
        materialIndex: 0,
      },
    });
  };

  const horizSpeed = Math.hypot(dx, dz);
  // Fast exact path for vertical / near-vertical rays (1 single heightfield sample!)
  if (horizSpeed < 1e-4) {
    if (dy >= -1e-7) return;
    const th = (sampleCarved(ox + dx * tMin, oz + dz * tMin) - oy) / dy;
    if (th >= tMin && th <= tMax) {
      emitHit(th);
    }
    return;
  }

  const deepCliffRelief = minY < -40.0;
  const maxSteps = deepCliffRelief ? 64 : 40;
  const baseStepM = deepCliffRelief ? 1.25 : 1.8;
  const stepGrowth = deepCliffRelief ? 0.13 : 0.16;

  // Adaptive coarse march: fine step near ray entry, growing smoothly into distant hills
  let tPrev = tMin;
  let hPrev = oy + dy * tPrev - sampleCarved(ox + dx * tPrev, oz + dz * tPrev);

  for (let step = 0; step < maxSteps && tPrev < tMax; step++) {
    const horizDist = horizSpeed * (tPrev - tMin);
    const dsHoriz = baseStepM + stepGrowth * horizDist;
    const dt = dsHoriz / horizSpeed;
    const tCurr = Math.min(tMax, tPrev + dt);
    const hCurr = oy + dy * tCurr - sampleCarved(ox + dx * tCurr, oz + dz * tCurr);

    // FrontSide crossing from above/on terrain (hPrev >= -1e-3) into terrain (hCurr <= 0)
    if (hPrev >= -1e-3 && hCurr <= 0) {
      let lo = tPrev;
      let hi = tCurr;
      for (let b = 0; b < 7; b++) {
        const mid = 0.5 * (lo + hi);
        const hMid = oy + dy * mid - sampleCarved(ox + dx * mid, oz + dz * mid);
        if (hMid > 0) {
          lo = mid;
        } else {
          hi = mid;
        }
      }
      emitHit(0.5 * (lo + hi));
      return;
    }

    tPrev = tCurr;
    hPrev = hCurr;
  }
}

/** Small seeded PRNG (mulberry32) so procedural terrain textures are deterministic on every load. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createPeriodicLatticeSampler(size: number, rand: () => number) {
  const buildLattice = (n: number): Float32Array => {
    const g = new Float32Array(n * n);
    for (let i = 0; i < g.length; i++) g[i] = rand();
    return g;
  };
  const sample = (g: Float32Array, n: number, x: number, y: number): number => {
    const fx = (((x % size) + size) % size / size) * n;
    const fy = (((y % size) + size) % size / size) * n;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const at = (ix: number, iy: number): number => g[((iy % n) * n + (ix % n)) % (n * n)]!;
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
  return { buildLattice, sample };
}

/**
 * Tileable English meadow & lawn albedo (sRGB bytes): three smooth periodic noise octaves plus
 * subtle blade micro-grain in natural temperate fescue/ryegrass greens (no harsh blotches).
 */
export function buildMeadowTextureData(size = TEXTURE_SIZE, seed = 1337): Uint8Array {
  const rand = mulberry32(seed);
  const lattice = (n: number): Float32Array => {
    const g = new Float32Array(n * n);
    for (let i = 0; i < g.length; i++) g[i] = rand();
    return g;
  };
  const n0 = 6;
  const n1 = 18;
  const n2 = 54;
  const g0 = lattice(n0);
  const g1 = lattice(n1);
  const g2 = lattice(n2);
  const sample = (g: Float32Array, n: number, x: number, y: number): number => {
    const fx = (x / size) * n;
    const fy = (y / size) * n;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const at = (ix: number, iy: number): number => g[((iy % n) * n + (ix % n)) % (n * n)]!;
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };

  const data = new Uint8Array(size * size * 4);
  const lush = [88, 114, 56];
  const warmClover = [108, 124, 64];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fbm =
        sample(g0, n0, x, y) * 0.45 +
        sample(g1, n1, x, y) * 0.35 +
        sample(g2, n2, x, y) * 0.20;
      const bladeGrain = (rand() - 0.5) * 0.08;
      const shade = 0.90 + fbm * 0.18 + bladeGrain;
      const warmMix = Math.max(0, Math.min(1, (fbm - 0.42) * 1.35));
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        const base = lush[c]! + (warmClover[c]! - lush[c]!) * warmMix;
        data[i + c] = Math.max(0, Math.min(255, Math.round(base * shade)));
      }
      data[i + 3] = 255;
    }
  }
  return data;
}

/**
 * Tileable decomposed-granite gravel & dusty sandy-loam detail texture (linear variation factors
 * centered around warm neutral buff, with coarse quartz/feldspar gravel grit & pebble pockets).
 */
export function buildAridSoilTextureData(size = TEXTURE_SIZE, seed = 4120): Uint8Array {
  const rand = mulberry32(seed);
  const { buildLattice, sample } = createPeriodicLatticeSampler(size, rand);
  const g0 = buildLattice(8);
  const g1 = buildLattice(24);
  const g2 = buildLattice(64);

  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const macro = sample(g0, 8, x, y);
      const mid = sample(g1, 24, x, y);
      const fine = sample(g2, 64, x, y);
      const pebble = rand();
      const speckle = pebble > 0.93 ? 0.14 : pebble < 0.06 ? -0.13 : (pebble - 0.5) * 0.08;
      const fbm = macro * 0.42 + mid * 0.35 + fine * 0.23;

      // Encode neutral-centered variation (128 = 1.0x multiplier in shader)
      const lum = Math.max(0.68, Math.min(1.32, 0.84 + fbm * 0.32 + speckle));
      const warmShift = (macro - 0.5) * 0.08;
      const i = (y * size + x) * 4;
      data[i] = Math.max(0, Math.min(255, Math.round((lum + warmShift) * 192)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(lum * 192)));
      data[i + 2] = Math.max(0, Math.min(255, Math.round((lum - warmShift * 0.9) * 192)));
      // Alpha stores fine gravel roughness variation
      data[i + 3] = Math.max(0, Math.min(255, Math.round((0.88 + (1 - fine) * 0.10) * 255)));
    }
  }
  return data;
}

export interface AridCliffRockTextureBundle {
  /** Linear RGBA rock strata & fracture pattern (`R`: strata tone, `G`: iron/ochre band, `B`: crevice AO, `A`: roughness). */
  readonly rockPattern: Uint8Array;
  /** Linear RGBA rock normal derivative & AO (`R`: `dH/dU`, `G`: `dH/dV`, `B`: fissure AO, `A`: quartz micro-roughness). */
  readonly rockDetail: Uint8Array;
}

/**
 * Tileable fractured decomposed-granite & iron-stained Hollywood Hills sandstone cliff maps:
 * combines tilted sedimentary strata bands, angular ridge-noise block joints, and deep fissure AO
 * with finite-difference surface derivatives (`dH/dU`, `dH/dV`) for triplanar normal perturbation.
 */
export function buildAridCliffRockTextureData(
  size = TEXTURE_SIZE,
  seed = 9069
): AridCliffRockTextureBundle {
  const rand = mulberry32(seed);
  const { buildLattice, sample } = createPeriodicLatticeSampler(size, rand);
  const gMacro = buildLattice(6);
  const gMid = buildLattice(16);
  const gJointA = buildLattice(12);
  const gJointB = buildLattice(28);
  const gFine = buildLattice(56);
  const gGrit = buildLattice(96);

  const heightField = new Float32Array(size * size);
  const creviceField = new Float32Array(size * size);
  const ironField = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const warpX = (sample(gMacro, 6, x, y) - 0.5) * 26.0;
      const warpY = (sample(gMid, 16, x + 37, y + 19) - 0.5) * 18.0;

      // Sub-horizontal sedimentary sandstone/granite bedding strata along Y (V axis in XY/ZY triplanar)
      const strataCoord = (y + warpY + (x / size) * 14.0) / size;
      const strataWave =
        0.5 +
        0.28 * Math.sin(strataCoord * Math.PI * 2 * 7.0) +
        0.14 * Math.sin(strataCoord * Math.PI * 2 * 19.0 + 1.1) +
        0.08 * Math.sin(strataCoord * Math.PI * 2 * 37.0 + 2.4);

      // Craggy angular block joints & vertical/diagonal fracture fissures (ridge noise: 1 - |2n - 1|)
      const jA = 1.0 - Math.abs(sample(gJointA, 12, x + warpX * 0.5, y * 0.75 + warpY * 0.35) * 2.0 - 1.0);
      const jB = 1.0 - Math.abs(sample(gJointB, 28, x * 1.15 - warpY * 0.4, y + warpX * 0.3) * 2.0 - 1.0);
      const fine = sample(gFine, 56, x, y);
      const grit = sample(gGrit, 96, x, y);

      // Sharp dark crevices where jA or jB peak near 1.0
      const fissureA = Math.pow(Math.max(0, jA - 0.38) / 0.62, 2.4);
      const fissureB = Math.pow(Math.max(0, jB - 0.46) / 0.54, 2.8);
      const strataLedge = Math.pow(Math.max(0, 1.0 - Math.abs(strataWave - 0.48) * 3.4), 2.1);
      const crevice = Math.min(1.0, fissureA * 0.78 + fissureB * 0.52 + strataLedge * 0.28);

      const blockFacet =
        strataWave * 0.38 +
        sample(gMid, 16, x + warpX * 0.25, y) * 0.30 +
        fine * 0.20 +
        grit * 0.12;
      const h = Math.max(0, Math.min(1, blockFacet - crevice * 0.52));

      const idx = y * size + x;
      heightField[idx] = h;
      creviceField[idx] = 1.0 - crevice * 0.78; // 0.22 in deep fissures .. 1.0 on exposed rock faces
      ironField[idx] = Math.max(
        0,
        Math.min(1, strataWave * 0.55 + sample(gMacro, 6, x + 71, y + 43) * 0.45)
      );
    }
  }

  const rockPattern = new Uint8Array(size * size * 4);
  const rockDetail = new Uint8Array(size * size * 4);
  const hAt = (ix: number, iy: number): number => {
    const wx = ((ix % size) + size) % size;
    const wy = ((iy % size) + size) % size;
    return heightField[wy * size + wx]!;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      const i4 = idx * 4;
      const h = heightField[idx]!;
      const ao = creviceField[idx]!;
      const iron = ironField[idx]!;
      const micro = (rand() - 0.5) * 0.06;

      // Central-difference height derivatives for crisp triplanar rock facets & overhangs
      const dHdU = (hAt(x + 1, y) - hAt(x - 1, y)) * 2.35;
      const dHdV = (hAt(x, y + 1) - hAt(x, y - 1)) * 2.65;

      rockPattern[i4] = Math.max(0, Math.min(255, Math.round(Math.max(0, Math.min(1, h + micro)) * 255)));
      rockPattern[i4 + 1] = Math.max(0, Math.min(255, Math.round(iron * 255)));
      rockPattern[i4 + 2] = Math.max(0, Math.min(255, Math.round(ao * 255)));
      const rough = Math.max(0.76, Math.min(0.99, 0.84 + (1.0 - ao) * 0.14 - h * 0.06));
      rockPattern[i4 + 3] = Math.round(rough * 255);

      rockDetail[i4] = Math.max(0, Math.min(255, Math.round((0.5 + Math.max(-0.48, Math.min(0.48, dHdU))) * 255)));
      rockDetail[i4 + 1] = Math.max(0, Math.min(255, Math.round((0.5 + Math.max(-0.48, Math.min(0.48, dHdV))) * 255)));
      rockDetail[i4 + 2] = rockPattern[i4 + 2]!;
      rockDetail[i4 + 3] = rockPattern[i4 + 3]!;
    }
  }

  return { rockPattern, rockDetail };
}

interface AxisBandSpec {
  readonly end: number;
  readonly steps: number;
  readonly power?: number;
}

function buildSegmentedAxisCoords(start: number, bands: readonly AxisBandSpec[]): Float32Array {
  const coords: number[] = [start];
  let cur = start;
  for (const band of bands) {
    const span = band.end - cur;
    const p = band.power ?? 1.0;
    for (let i = 1; i <= band.steps; i++) {
      const t = i / band.steps;
      const u = p === 1.0 ? t : p < 0 ? 1 - Math.pow(1 - t, -p) : Math.pow(t, p);
      coords.push(cur + u * span);
    }
    cur = band.end;
  }
  return new Float32Array(coords);
}

function smoothBand(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Builds the continuous 3-tier site & valley topography `BufferGeometry`
 * (`3.5 km × 3.5 km`, 1 draw call, `< 10,000` triangles, zero T-junctions).
 *
 * When `sampler.biome` is `'lush-meadow'` (default), preserves the exact temperate estate
 * grid & lawn-to-meadow vertex colors (deterministic subdivision).
 * When `sampler.biome` is `'arid-chaparral'` or `'rocky-bluff'`, concentrates sub-metre vertex
 * density across the promontory crest & steep cliff escarpments (`< 10,000` triangles).
 */
export function buildTopographicSiteGroundGeometry(
  sampler: Pick<TerrainSurfaceSampler, 'sampleCarvedMeshY'> & {
    readonly biome?: TerrainBiomeInput;
  } = DEFAULT_SITE_TERRAIN_SAMPLER
): THREE.BufferGeometry {
  const resolvedBiome = resolveTerrainBiomeConfig(sampler.biome);
  const isAridBiome = resolvedBiome.preset !== 'lush-meadow';

  // Lush-meadow: 86 * 55 * 2 = 9,460 triangles (standard meadow grid).
  // Arid/rocky-bluff: 69 * 69 * 2 = 9,522 triangles (< 10,000 tris) with ~0.55m cliff-crest fidelity!
  const xs = isAridBiome
    ? buildSegmentedAxisCoords(-VALLEY_HALF_EXTENT, [
        { end: -220, steps: 3, power: -2.1 },
        { end: -85, steps: 3, power: -1.4 },
        { end: -18, steps: 18, power: -1.25 }, // ~2.2-4.5m across West canyon flank & Woods Dr ridge
        { end: 2.0, steps: 12 }, // ~1.67m across courtyard, pool & house pad
        { end: 13.5, steps: 19 }, // ~0.61m across East cantilever crest, NE gravel nose & upper cliff!
        { end: 38, steps: 8 }, // ~3.06m across mid-cliff escarpment
        { end: 180, steps: 3, power: 1.5 },
        { end: VALLEY_HALF_EXTENT, steps: 3, power: 2.1 },
      ])
    : buildSegmentedAxisCoords(-VALLEY_HALF_EXTENT, [
        { end: -165, steps: 4, power: -2.1 },
        { end: -44, steps: 4 },
        { end: -22.5, steps: 8 }, // ~2.69m across Main Street & front verge right up to West wall
        { end: 11.5, steps: 38 }, // ~0.89m across House, Courtyard & Outbuilding walls
        { end: 24, steps: 7 }, // ~1.79m across Walled Garden
        { end: 96, steps: 18 }, // 4.00m across deep back garden & sloped paddock
        { end: 165, steps: 3 },
        { end: VALLEY_HALF_EXTENT, steps: 4, power: 2.1 },
      ]);
  const zs = isAridBiome
    ? buildSegmentedAxisCoords(-VALLEY_HALF_EXTENT, [
        { end: -220, steps: 3, power: -2.1 },
        { end: -95, steps: 3, power: -1.4 },
        { end: -10.0, steps: 18, power: -1.35 }, // ~2.4-6m across North Woods Dr ridge & saddle (no 38m facets!)
        { end: 7.5, steps: 16 }, // ~1.09m across North wing, NE gravel promontory nose & pool
        { end: 19.5, steps: 19 }, // ~0.63m across South cantilever crest & upper cliff!
        { end: 48, steps: 6 }, // ~4.75m across South hillside talus
        { end: 180, steps: 2, power: 1.5 },
        { end: VALLEY_HALF_EXTENT, steps: 2, power: 2.1 },
      ])
    : buildSegmentedAxisCoords(-VALLEY_HALF_EXTENT, [
        { end: -165, steps: 4, power: -2.1 },
        { end: -20, steps: 4 },
        { end: -3.55, steps: 5 }, // ~3.29m north lawn collar right up to North wall
        { end: 21.3, steps: 28 }, // ~0.89m across House, Courtyard, Driveway Apron & Outbuilding
        { end: 51, steps: 7 }, // ~4.2m south paddock collar
        { end: 165, steps: 4 },
        { end: VALLEY_HALF_EXTENT, steps: 3, power: 2.1 },
      ]);
  const nx = xs.length;
  const nz = zs.length;
  const vertCount = nx * nz;

  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const colors = new Float32Array(vertCount * 3);

  const uvSpan = VALLEY_HALF_EXTENT * 2;

  for (let rz = 0; rz < nz; rz++) {
    const wz = zs[rz]!;
    for (let cx = 0; cx < nx; cx++) {
      const wx = xs[cx]!;
      const idx = rz * nx + cx;
      const hy = sampler.sampleCarvedMeshY(wx, wz);

      positions[idx * 3] = wx;
      positions[idx * 3 + 1] = hy;
      positions[idx * 3 + 2] = wz;
      uvs[idx * 2] = (wx + VALLEY_HALF_EXTENT) / uvSpan;
      uvs[idx * 2 + 1] = (wz + VALLEY_HALF_EXTENT) / uvSpan;

      if (isAridBiome) {
        colors[idx * 3] = 1.0;
        colors[idx * 3 + 1] = 1.0;
        colors[idx * 3 + 2] = 1.0;
      } else {
        // Clean, natural English lawn-to-meadow tonal transition (extended across deep back garden)
        const distHouse = Math.hypot((wx - 8.0) * 0.72, wz - 9.0);
        const wLawn = 1 - smoothBand(24.0, 52.0, distHouse);
        const distFar = Math.hypot(wx, wz);
        const wFar = smoothBand(160.0, 520.0, distFar);

        let mr = 1.0 * (1 - wLawn) + 0.95 * wLawn;
        let mg = 1.0 * (1 - wLawn) + 1.03 * wLawn;
        let mb = 1.0 * (1 - wLawn) + 0.94 * wLawn;

        mr = mr * (1 - wFar) + 0.98 * wFar;
        mg = mg * (1 - wFar) + 0.99 * wFar;
        mb = mb * (1 - wFar) + 0.93 * wFar;

        colors[idx * 3] = mr;
        colors[idx * 3 + 1] = mg;
        colors[idx * 3 + 2] = mb;
      }
    }
  }

  const quadCount = (nx - 1) * (nz - 1);
  const indices = new Uint32Array(quadCount * 6);
  let ptr = 0;
  for (let rz = 0; rz < nz - 1; rz++) {
    const row0 = rz * nx;
    const row1 = (rz + 1) * nx;
    for (let cx = 0; cx < nx - 1; cx++) {
      const i00 = row0 + cx;
      const i10 = row0 + cx + 1;
      const i01 = row1 + cx;
      const i11 = row1 + cx + 1;
      const y00 = positions[i00 * 3 + 1]!;
      const y10 = positions[i10 * 3 + 1]!;
      const y01 = positions[i01 * 3 + 1]!;
      const y11 = positions[i11 * 3 + 1]!;
      if (y00 + y11 < y01 + y10) {
        indices[ptr++] = i00;
        indices[ptr++] = i01;
        indices[ptr++] = i11;
        indices[ptr++] = i00;
        indices[ptr++] = i11;
        indices[ptr++] = i10;
      } else {
        indices[ptr++] = i00;
        indices[ptr++] = i01;
        indices[ptr++] = i10;
        indices[ptr++] = i10;
        indices[ptr++] = i01;
        indices[ptr++] = i11;
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function configureRepeatDataTexture(
  data: Uint8Array,
  size: number,
  colorSpace: THREE.ColorSpace
): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = colorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function configureAridCliffSiteMaterial(
  material: THREE.MeshStandardMaterial,
  biomeCfg: ResolvedTerrainBiomeConfig,
  footprint: SiteHazeFootprint,
  uHorizonNode: ReturnType<typeof uniform>
): readonly THREE.DataTexture[] {
  const soilTex = configureRepeatDataTexture(
    buildAridSoilTextureData(),
    TEXTURE_SIZE,
    THREE.NoColorSpace
  );
  const { rockPattern, rockDetail } = buildAridCliffRockTextureData();
  const rockTex = configureRepeatDataTexture(rockPattern, TEXTURE_SIZE, THREE.NoColorSpace);
  const detailTex = configureRepeatDataTexture(rockDetail, TEXTURE_SIZE, THREE.NoColorSpace);

  const uSiteCenterNode = vec2(footprint.centerX, footprint.centerZ);
  const uFlatPrimary = uniform(new THREE.Color(biomeCfg.flatSoilPrimaryHex));
  const uFlatSecondary = uniform(new THREE.Color(biomeCfg.flatSoilSecondaryHex));
  const uFlatScrub = uniform(new THREE.Color(biomeCfg.flatScrubHex));
  const uMidTalus = uniform(new THREE.Color(biomeCfg.midSlopeTalusHex));
  const uMidOchre = uniform(new THREE.Color(biomeCfg.midSlopeOchreHex));
  const uCliffPrimary = uniform(new THREE.Color(biomeCfg.cliffRockPrimaryHex));
  const uCliffSecondary = uniform(new THREE.Color(biomeCfg.cliffRockSecondaryHex));
  const uCliffHighlight = uniform(new THREE.Color(biomeCfg.cliffRockHighlightHex));
  const uCliffCrevice = uniform(new THREE.Color(biomeCfg.cliffCreviceHex));

  const gentleSlopeCutoff = Math.max(0.005, 1.0 - Math.cos((biomeCfg.gentleSlopeMaxDeg * Math.PI) / 180));
  const cliffSlopeCutoff = Math.max(
    gentleSlopeCutoff + 0.03,
    1.0 - Math.cos((biomeCfg.cliffSlopeMinDeg * Math.PI) / 180)
  );
  const uGentleCutoff = float(gentleSlopeCutoff);
  const uCliffCutoff = float(cliffSlopeCutoff);
  const uInvRockScale = float(1.0 / biomeCfg.triplanarScaleM);
  const uInvFineRockScale = float(3.45 / biomeCfg.triplanarScaleM);
  const uInvSoilScale = float(1.0 / 3.4);
  const uInvMacroSoilScale = float(1.0 / 17.5);
  const uNormalStrength = float(biomeCfg.normalPerturbStrength);

  // Continuous multi-octave world-space geological breakup (eliminates ruler-straight slope bands)
  const sampleGeologicalFbm = Fn(() => {
    const p = positionWorld.xyz;
    const n1 = sin(dot(p, vec3(0.173, 0.241, 0.197))).mul(0.5).add(0.5);
    const n2 = sin(dot(p, vec3(0.517, -0.683, 0.439)).add(1.7)).mul(0.5).add(0.5);
    const n3 = fract(sin(dot(sin(p.mul(0.48)).mul(2.5), vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
    return n1.mul(0.48).add(n2.mul(0.36)).add(n3.mul(0.16));
  });

  const tslMaterial = material as unknown as TslCapableStandardMaterial;

  tslMaterial.colorNode = Fn(() => {
    const nGeom = normalize(normalLocal);
    const rawSlope = clamp(float(1.0).sub(nGeom.y), 0.0, 1.0);
    const geoFbm = sampleGeologicalFbm();
    const erodedSlope = clamp(rawSlope.add(geoFbm.sub(0.5).mul(0.125)), 0.0, 1.0);

    // Triplanar projection weights from world normal |N|
    const absN = pow(abs(nGeom), vec3(4.0));
    const triW = absN.div(absN.x.add(absN.y).add(absN.z).add(1e-5));

    // World-space UVs for XY (South/North cliff), ZY (East/West cliff), and XZ (promontory pad/ledges)
    const uvXY = vec2(positionWorld.x, positionWorld.y).mul(uInvRockScale);
    const uvZY = vec2(positionWorld.z, positionWorld.y).mul(uInvRockScale);
    const uvXZ = vec2(positionWorld.x, positionWorld.z).mul(uInvRockScale);

    const uvXYFine = vec2(positionWorld.x, positionWorld.y).mul(uInvFineRockScale);
    const uvZYFine = vec2(positionWorld.z, positionWorld.y).mul(uInvFineRockScale);
    const uvXZFine = vec2(positionWorld.x, positionWorld.z).mul(uInvFineRockScale);

    // Band 1: Flat / Gentle Promontory (< ~16 deg) — dusty decomposed-granite soil & patchy dry scrub
    const soilFine = texture(soilTex, positionWorld.xz.mul(uInvSoilScale));
    const soilMacro = texture(soilTex, positionWorld.xz.mul(uInvMacroSoilScale));
    const soilMottle = clamp(soilMacro.r.mul(0.62).add(geoFbm.mul(0.38)), 0.0, 1.0);
    const dgBase = mix(uFlatSecondary, uFlatPrimary, smoothstep(0.3, 0.72, soilMottle));
    // Keep compacted promontory pad & gravel nose predominantly dusty decomposed granite; mottle dry scrub away from pad
    const padDist = length(positionWorld.xz.sub(vec2(-2.0, 1.5)));
    const outerScrubMask = smoothstep(9.5, 22.0, padDist).mul(
      smoothstep(0.58, 0.84, soilMacro.g.mul(0.65).add(geoFbm.mul(0.35)))
    );
    const gentleAlbedo = mix(dgBase, uFlatScrub, outerScrubMask.mul(0.52)).mul(
      soilFine.rgb.mul(0.72).add(0.46)
    );

    // Band 2: Mid Slopes (16..36 deg) — eroded canyon talus & warm golden-ochre dry grass/earth
    const rillNoise = sin(positionWorld.x.mul(1.35).add(positionWorld.z.mul(1.15)).add(geoFbm.mul(4.2)))
      .mul(0.5)
      .add(0.5);
    const talusBase = mix(
      uMidOchre,
      uMidTalus,
      smoothstep(0.24, 0.78, rillNoise.mul(0.58).add(soilMacro.r.mul(0.42)))
    );
    const midAlbedo = talusBase.mul(soilFine.rgb.mul(0.58).add(0.56));

    // Band 3: Steep Cliff Escarpments (> 36 deg) — triplanar fractured decomposed-granite & sandstone rock
    const rockMacro = texture(rockTex, uvZY)
      .mul(triW.x)
      .add(texture(rockTex, uvXZ).mul(triW.y))
      .add(texture(rockTex, uvXY).mul(triW.z));
    const rockFine = texture(rockTex, uvZYFine)
      .mul(triW.x)
      .add(texture(rockTex, uvXZFine).mul(triW.y))
      .add(texture(rockTex, uvXYFine).mul(triW.z));

    const rockFacet = clamp(rockMacro.r.mul(0.64).add(rockFine.r.mul(0.36)), 0.0, 1.0);
    const ironBand = clamp(rockMacro.g.mul(0.72).add(geoFbm.mul(0.28)), 0.0, 1.0);
    const creviceAo = clamp(rockMacro.b.mul(rockFine.b.mul(0.45).add(0.58)), 0.16, 1.0);

    const sandstoneBody = mix(uCliffSecondary, uCliffPrimary, smoothstep(0.16, 0.68, ironBand));
    const sunlitStrata = mix(
      sandstoneBody,
      uCliffHighlight,
      smoothstep(0.42, 0.82, rockFacet)
    );
    const cliffAlbedo = mix(
      uCliffCrevice,
      sunlitStrata,
      smoothstep(0.24, 0.78, creviceAo)
    );

    const midBlend = smoothstep(
      uGentleCutoff.mul(0.55),
      uGentleCutoff.mul(1.45).add(0.032),
      erodedSlope
    );
    const cliffBlend = smoothstep(
      uCliffCutoff.mul(0.68),
      uCliffCutoff.mul(1.22).add(0.055),
      erodedSlope
    );

    const terrainRgb = mix(mix(gentleAlbedo, midAlbedo, midBlend), cliffAlbedo, cliffBlend);

    const distFromCenter = length(positionWorld.xz.sub(uSiteCenterNode));
    const horizonBlend = smoothstep(FADE_START, FADE_END, distFromCenter).mul(0.9);
    return mix(terrainRgb, uHorizonNode, horizonBlend);
  })();

  tslMaterial.roughnessNode = Fn(() => {
    const nGeom = normalize(normalLocal);
    const rawSlope = clamp(float(1.0).sub(nGeom.y), 0.0, 1.0);
    const absN = pow(abs(nGeom), vec3(4.0));
    const triW = absN.div(absN.x.add(absN.y).add(absN.z).add(1e-5));

    const uvXY = vec2(positionWorld.x, positionWorld.y).mul(uInvRockScale);
    const uvZY = vec2(positionWorld.z, positionWorld.y).mul(uInvRockScale);
    const soilSample = texture(soilTex, positionWorld.xz.mul(uInvSoilScale));
    const rockSample = texture(detailTex, uvZY).mul(triW.x).add(texture(detailTex, uvXY).mul(triW.z));

    const cliffBlend = smoothstep(uGentleCutoff, uCliffCutoff.add(0.05), rawSlope);
    const gentleRough = clamp(float(0.91).add(soilSample.a.sub(0.88).mul(0.5)), 0.9, 0.97);
    const cliffRough = clamp(rockSample.a.mul(0.96).add(0.02), 0.76, 0.97);
    return mix(gentleRough, cliffRough, cliffBlend);
  })();

  tslMaterial.normalNode = Fn(() => {
    const nGeom = normalize(normalLocal);
    const rawSlope = clamp(float(1.0).sub(nGeom.y), 0.0, 1.0);
    const absN = pow(abs(nGeom), vec3(4.0));
    const triW = absN.div(absN.x.add(absN.y).add(absN.z).add(1e-5));

    const uvXY = vec2(positionWorld.x, positionWorld.y).mul(uInvRockScale);
    const uvZY = vec2(positionWorld.z, positionWorld.y).mul(uInvRockScale);
    const uvXZ = positionWorld.xz.mul(uInvSoilScale);
    const uvXYFine = vec2(positionWorld.x, positionWorld.y).mul(uInvFineRockScale);
    const uvZYFine = vec2(positionWorld.z, positionWorld.y).mul(uInvFineRockScale);

    const detZY = texture(detailTex, uvZY).rg.sub(0.5).mul(1.35).add(
      texture(detailTex, uvZYFine).rg.sub(0.5).mul(0.65)
    );
    const detXY = texture(detailTex, uvXY).rg.sub(0.5).mul(1.35).add(
      texture(detailTex, uvXYFine).rg.sub(0.5).mul(0.65)
    );
    const detXZ = texture(detailTex, uvXZ).rg.sub(0.5).mul(0.55);

    const perturbZY = vec3(0.0, detZY.y, detZY.x).mul(triW.x);
    const perturbXZ = vec3(detXZ.x, 0.0, detXZ.y).mul(triW.y);
    const perturbXY = vec3(detXY.x, detXY.y, 0.0).mul(triW.z);

    const cliffStrength = mix(
      float(0.11),
      uNormalStrength,
      smoothstep(uGentleCutoff.mul(0.7), uCliffCutoff.add(0.04), rawSlope)
    );
    const distAtten = float(1.0).sub(
      smoothstep(85.0, 340.0, length(positionWorld.xz.sub(uSiteCenterNode))).mul(0.75)
    );
    const worldN = normalize(
      nGeom.add(perturbZY.add(perturbXZ).add(perturbXY).mul(cliffStrength).mul(distAtten))
    );
    return cameraViewMatrix.transformDirection(worldN);
  })();

  return [soilTex, rockTex, detailTex];
}

/** Live handle to the site ground: update the horizon tint or live-sculpted terrain sampler. */
export interface SiteGround {
  readonly mesh: THREE.Mesh;
  /** Returns the base terrain sampler this site ground was originally built from. */
  getBaseSampler(): SiteGroundSampler;
  /** Updates vertex elevations, normals, bounds, and analytical raycast sampler in-place. */
  updateSampler(
    nextSampler: SiteGroundSampler,
    dirtyBounds?: {
      readonly minX: number;
      readonly maxX: number;
      readonly minZ: number;
      readonly maxZ: number;
    }
  ): void;
  /** Linear radiance the far valley fades into (the HDR's horizon ground × background intensity). */
  setHorizonColor(color: THREE.Color): void;
  /** Updates seasonal meadow grass tint (`[r, g, b]`) and winter snow dusting (`0..1`). */
  setSeasonalStyle(tintRgb: readonly [number, number, number], snowCover: number): void;
  /** Current seasonal tint & snow cover applied to the meadow shader. */
  getSeasonalStyle(): { readonly tintRgb: readonly [number, number, number]; readonly snowCover: number };
  dispose(): void;
}

/**
 * Continuous 3-tier surveyed estate, promontory & valley topography (`3.5 km × 3.5 km`,
 * single draw call, `< 10,000` triangles, `O(1)` `< 0.02 ms` analytical heightfield raycast).
 */
export function createSiteGround(
  footprint: SiteHazeFootprint = DEFAULT_SITE_HAZE_FOOTPRINT,
  sampler: SiteGroundSampler = DEFAULT_SITE_TERRAIN_SAMPLER
): SiteGround {
  const biomeCfg = resolveTerrainBiomeConfig(sampler.biome);
  const isAridBiome = biomeCfg.preset !== 'lush-meadow';

  const ownedTextures: THREE.DataTexture[] = [];
  let material: THREE.MeshStandardMaterial;
  const horizonColor = new THREE.Color(isAridBiome ? 0x8f826d : 0x3c4d28);
  const seasonTintColor = new THREE.Color(1, 1, 1);
  const snowAlbedoColor = new THREE.Color(0xdbe3ee);
  let currentTintTuple: readonly [number, number, number] = [1, 1, 1];
  let currentSnowCover = 0;

  const uHorizonNode = uniform(horizonColor);
  const uSeasonTintNode = uniform(seasonTintColor);
  const uSnowAlbedoNode = uniform(snowAlbedoColor);
  const uSnowCoverNode = uniform(0);

  if (isAridBiome) {
    // Also attach a tileable sRGB decomposed-granite fallback `map` for clean GLB export
    const exportMap = configureRepeatDataTexture(
      buildAridSoilTextureData(),
      TEXTURE_SIZE,
      THREE.SRGBColorSpace
    );
    const tileRepeat = (VALLEY_HALF_EXTENT * 2) / 5.5;
    exportMap.repeat.set(tileRepeat, tileRepeat);
    ownedTextures.push(exportMap);

    material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(biomeCfg.flatSoilPrimaryHex),
      map: exportMap,
      vertexColors: false,
      roughness: 0.93,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 4,
    });
    const aridTextures = configureAridCliffSiteMaterial(material, biomeCfg, footprint, uHorizonNode);
    ownedTextures.push(...aridTextures);
    material.userData['terrainBiomePreset'] = biomeCfg.preset;
  } else {
    const tex = new THREE.DataTexture(buildMeadowTextureData(), TEXTURE_SIZE, TEXTURE_SIZE);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 8;
    const tileRepeat = (VALLEY_HALF_EXTENT * 2) / TILE_METRES;
    tex.repeat.set(tileRepeat, tileRepeat);
    tex.needsUpdate = true;
    ownedTextures.push(tex);

    material = new THREE.MeshStandardMaterial({
      map: tex,
      vertexColors: true,
      roughness: 0.94,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 4,
    });
    const uSiteCenterNode = vec2(footprint.centerX, footprint.centerZ);

    const tslMaterial = material as unknown as TslCapableStandardMaterial;
    tslMaterial.colorNode = Fn(() => {
      const baseGrass = texture(tex, uv().mul(tileRepeat)).rgb.mul(vertexColor().rgb);
      const tintedGrass = baseGrass.mul(uSeasonTintNode);
      const snowVariation = clamp(baseGrass.g.mul(2.4).add(0.38), 0.58, 1.0);
      const snowMix = clamp(uSnowCoverNode.mul(snowVariation), 0.0, 0.92);
      const surfaceAlbedo = mix(tintedGrass, uSnowAlbedoNode, snowMix);
      const distFromCenter = length(positionWorld.xz.sub(uSiteCenterNode));
      const horizonBlend = smoothstep(FADE_START, FADE_END, distFromCenter).mul(0.9);
      return mix(surfaceAlbedo, uHorizonNode, horizonBlend);
    })();
  }

  material.userData['excludeIndoorLighting'] = true;

  const geometry = buildTopographicSiteGroundGeometry(sampler);
  const mesh = new THREE.Mesh(geometry, material);
  meshTerrainSamplers.set(mesh, sampler);
  mesh.name = 'environment.siteGround';
  mesh.position.set(0, 0, 0);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.raycast = raycastTopographicSiteGround;
  mesh.userData['isEnvironmentGround'] = true;
  mesh.userData['skipWalkthroughObstacle'] = true;
  mesh.updateMatrix();
  mesh.updateMatrixWorld(true);
  mesh.matrixAutoUpdate = false;

  const baseSampler = sampler;
  return {
    mesh,
    getBaseSampler: () => baseSampler,
    updateSampler: (nextSampler, dirtyBounds) => {
      meshTerrainSamplers.set(mesh, nextSampler);
      const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (!posAttr) return;
      const arr = posAttr.array as Float32Array;
      const count = posAttr.count;
      const pad = 2.0;
      const hasBounds = dirtyBounds !== undefined;
      const bMinX = hasBounds ? dirtyBounds.minX - pad : -Infinity;
      const bMaxX = hasBounds ? dirtyBounds.maxX + pad : Infinity;
      const bMinZ = hasBounds ? dirtyBounds.minZ - pad : -Infinity;
      const bMaxZ = hasBounds ? dirtyBounds.maxZ + pad : Infinity;
      let changed = false;
      for (let i = 0; i < count; i++) {
        const wx = arr[i * 3]!;
        const wz = arr[i * 3 + 2]!;
        if (wx < bMinX || wx > bMaxX || wz < bMinZ || wz > bMaxZ) continue;
        const nextY = nextSampler.sampleCarvedMeshY(wx, wz);
        if (Math.abs(arr[i * 3 + 1]! - nextY) > 1e-6) {
          arr[i * 3 + 1] = nextY;
          changed = true;
        }
      }
      if (changed) {
        posAttr.needsUpdate = true;
        geometry.computeVertexNormals();
        const normAttr = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
        if (normAttr) normAttr.needsUpdate = true;
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
      }
    },
    setHorizonColor: (nextColor) => {
      horizonColor.copy(nextColor);
    },
    setSeasonalStyle: (tintRgb, snowCover) => {
      const r = Number.isFinite(tintRgb[0]) ? tintRgb[0] : 1;
      const g = Number.isFinite(tintRgb[1]) ? tintRgb[1] : 1;
      const b = Number.isFinite(tintRgb[2]) ? tintRgb[2] : 1;
      const clampedSnow = Math.max(0, Math.min(1, Number.isFinite(snowCover) ? snowCover : 0));
      currentTintTuple = [r, g, b];
      currentSnowCover = clampedSnow;
      seasonTintColor.setRGB(r, g, b, THREE.LinearSRGBColorSpace);
      uSnowCoverNode.value = clampedSnow;
      material.roughness = THREE.MathUtils.lerp(0.94, 0.84, clampedSnow);
    },
    getSeasonalStyle: () => ({
      tintRgb: currentTintTuple,
      snowCover: currentSnowCover,
    }),
    dispose: () => {
      geometry.dispose();
      material.dispose();
      for (const t of ownedTextures) {
        t.dispose();
      }
    },
  };
}
