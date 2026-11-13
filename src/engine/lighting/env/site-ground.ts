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
  max,
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
import { buildContinuousTurfShadingNodes } from '../../vegetation/turf-phenology-node.ts';
import { SHARED_VEGETATION_UNIFORMS } from '../../vegetation/vegetation-uniforms.ts';
import { DEFAULT_SITE_HAZE_FOOTPRINT, type SiteHazeFootprint } from './site-haze-fog.ts';
import {
  type AridCliffRockTextureBundle,
  SITE_GROUND_TEXTURE_SIZE,
  buildAridCliffRockTextureData,
  buildAridSoilTextureData,
  buildMeadowBladeDetailTextureData,
  buildMeadowTextureData,
  configureRepeatDataTexture,
} from './site-ground-textures.ts';

export {
  type AridCliffRockTextureBundle,
  buildAridCliffRockTextureData,
  buildAridSoilTextureData,
  buildMeadowBladeDetailTextureData,
  buildMeadowTextureData,
};

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
const TEXTURE_SIZE = SITE_GROUND_TEXTURE_SIZE;
/** World metres covered by one tile of the fine English meadow/lawn detail texture. */
const TILE_METRES = 4.5;

interface TslCapableStandardMaterial {
  colorNode?: unknown;
  roughnessNode?: unknown;
  normalNode?: unknown;
}

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
    !clipAxis(ox, dx, -VALLEY_HALF_EXTENT, VALLEY_HALF_EXTENT) ||
    !clipAxis(oy, dy, minY, maxY) ||
    !clipAxis(oz, dz, -VALLEY_HALF_EXTENT, VALLEY_HALF_EXTENT)
  ) {
    return;
  }

  _terrainBounds.min.y = minY;
  _terrainBounds.max.y = maxY;
  if (_localRay.intersectBox(_terrainBounds, _boxEntry) === null && !_terrainBounds.containsPoint(_localRay.origin)) {
    return;
  }

  const sampler = meshTerrainSamplers.get(this) ?? DEFAULT_SITE_TERRAIN_SAMPLER;
  const sampleCarved = sampler.sampleCarvedMeshY;
  const emitHit = (tHit: number): void => {
    const lx = ox + dx * tHit;
    const ly = oy + dy * tHit;
    const lz = oz + dz * tHit;
    _worldHit.set(lx, ly, lz).applyMatrix4(this.matrixWorld);
    const dist = raycaster.ray.origin.distanceTo(_worldHit);
    if (dist < raycaster.near || dist > raycaster.far) return;

    const { nx, ny, nz } = sampler.sampleNormal(lx, lz);
    _worldNormal.set(nx, ny, nz);

    const uvSpan = VALLEY_HALF_EXTENT * 2;
    intersects.push({
      distance: dist,
      point: _worldHit.clone(),
      object: this,
      faceIndex: 0,
      uv: new THREE.Vector2((lx + VALLEY_HALF_EXTENT) / uvSpan, (lz + VALLEY_HALF_EXTENT) / uvSpan),
      normal: _worldNormal.clone(),
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
  if (horizSpeed < 1e-5) {
    if (dy >= 0) return;
    const groundY = sampleCarved(ox, oz);
    const tHit = (groundY - oy) / dy;
    if (tHit >= tMin && tHit <= tMax) {
      emitHit(tHit);
    }
    return;
  }

  let tPrev = tMin;
  let hPrev = oy + dy * tPrev - sampleCarved(ox + dx * tPrev, oz + dz * tPrev);
  if (Math.abs(hPrev) <= 1e-3 && dy <= 0) {
    emitHit(tPrev);
    return;
  }

  const maxSteps = 220;
  const baseStepM = 0.65;
  const stepGrowth = 0.032;

  for (let step = 0; step < maxSteps && tPrev < tMax; step++) {
    const horizDist = tPrev * horizSpeed;
    const dsHoriz = baseStepM + stepGrowth * horizDist;
    const dt = dsHoriz / horizSpeed;
    const tCurr = Math.min(tMax, tPrev + dt);
    const hCurr = oy + dy * tCurr - sampleCarved(ox + dx * tCurr, oz + dz * tCurr);

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
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Builds the continuous 3-tier site & valley topography `BufferGeometry`
 * (`3.5 km × 3.5 km`, 1 draw call, `< 10,000` triangles, zero T-junctions).
 */
export function buildTopographicSiteGroundGeometry(
  sampler: Pick<TerrainSurfaceSampler, 'sampleCarvedMeshY'> & {
    readonly biome?: TerrainBiomeInput;
  } = DEFAULT_SITE_TERRAIN_SAMPLER
): THREE.BufferGeometry {
  const resolvedBiome = resolveTerrainBiomeConfig(sampler.biome);
  const isAridBiome = resolvedBiome.preset !== 'lush-meadow';

  const xs = isAridBiome
    ? buildSegmentedAxisCoords(-VALLEY_HALF_EXTENT, [
        { end: -220, steps: 3, power: -2.1 },
        { end: -85, steps: 3, power: -1.4 },
        { end: -18, steps: 18, power: -1.25 },
        { end: 2.0, steps: 12 },
        { end: 13.5, steps: 19 },
        { end: 38, steps: 8 },
        { end: 180, steps: 3, power: 1.5 },
        { end: VALLEY_HALF_EXTENT, steps: 3, power: 2.1 },
      ])
    : buildSegmentedAxisCoords(-VALLEY_HALF_EXTENT, [
        { end: -165, steps: 4, power: -2.1 },
        { end: -44, steps: 4 },
        { end: -22.5, steps: 8 },
        { end: 11.5, steps: 38 },
        { end: 24, steps: 7 },
        { end: 96, steps: 18 },
        { end: 165, steps: 3 },
        { end: VALLEY_HALF_EXTENT, steps: 4, power: 2.1 },
      ]);
  const zs = isAridBiome
    ? buildSegmentedAxisCoords(-VALLEY_HALF_EXTENT, [
        { end: -220, steps: 3, power: -1.4 },
        { end: -95, steps: 3, power: -1.4 },
        { end: -10.0, steps: 18, power: -1.35 },
        { end: 7.5, steps: 16 },
        { end: 19.5, steps: 19 },
        { end: 48, steps: 6 },
        { end: 180, steps: 2, power: 1.5 },
        { end: VALLEY_HALF_EXTENT, steps: 2, power: 2.1 },
      ])
    : buildSegmentedAxisCoords(-VALLEY_HALF_EXTENT, [
        { end: -165, steps: 4, power: -2.1 },
        { end: -20, steps: 4 },
        { end: -3.55, steps: 5 },
        { end: 21.3, steps: 28 },
        { end: 51, steps: 7 },
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

    const absN = pow(abs(nGeom), vec3(4.0));
    const triW = absN.div(absN.x.add(absN.y).add(absN.z).add(1e-5));

    const uvXY = vec2(positionWorld.x, positionWorld.y).mul(uInvRockScale);
    const uvZY = vec2(positionWorld.z, positionWorld.y).mul(uInvRockScale);
    const uvXZ = vec2(positionWorld.x, positionWorld.z).mul(uInvRockScale);
    const uvXYFine = vec2(positionWorld.x, positionWorld.y).mul(uInvFineRockScale);
    const uvZYFine = vec2(positionWorld.z, positionWorld.y).mul(uInvFineRockScale);
    const uvXZFine = vec2(positionWorld.x, positionWorld.z).mul(uInvFineRockScale);

    // Continuous Mediterranean / arid winter-spring green flush vs golden-buff summer dormancy
    const yearP = fract(fract(float(SHARED_VEGETATION_UNIFORMS.uYearPhase)).add(1.0));
    const winterDist = abs(fract(yearP.sub(0.14).add(0.5)).sub(0.5));
    const winterSpringGreen = float(1.0)
      .sub(smoothstep(0.14, 0.25, winterDist))
      .mul(SHARED_VEGETATION_UNIFORMS.uClimateCurves.w);
    const summerDist = abs(fract(yearP.sub(0.62).add(0.5)).sub(0.5));
    const summerBleach = float(1.0)
      .sub(smoothstep(0.13, 0.24, summerDist))
      .mul(SHARED_VEGETATION_UNIFORMS.uClimateCurves.w);
    const rainWet = clamp(float(SHARED_VEGETATION_UNIFORMS.uRainWetness), 0.0, 1.0);

    const seasonalScrub = mix(
      mix(uFlatScrub, vec3(0.24, 0.36, 0.14), winterSpringGreen.mul(0.75)),
      vec3(0.56, 0.46, 0.27),
      summerBleach.mul(0.68)
    );

    const soilFine = texture(soilTex, positionWorld.xz.mul(uInvSoilScale));
    const soilMacro = texture(soilTex, positionWorld.xz.mul(uInvMacroSoilScale));
    const soilMottle = clamp(soilMacro.r.mul(0.62).add(geoFbm.mul(0.38)), 0.0, 1.0);
    const dgBase = mix(uFlatSecondary, uFlatPrimary, smoothstep(0.3, 0.72, soilMottle));
    const padDist = length(positionWorld.xz.sub(vec2(-2.0, 1.5)));
    const outerScrubMask = smoothstep(9.5, 22.0, padDist).mul(
      smoothstep(0.52, 0.82, soilMacro.g.mul(0.65).add(geoFbm.mul(0.35)))
    );
    const gentleAlbedo = mix(
      dgBase,
      seasonalScrub,
      outerScrubMask.mul(mix(float(0.52), float(0.72), winterSpringGreen))
    ).mul(soilFine.rgb.mul(0.72).add(0.46));

    const rillNoise = sin(positionWorld.x.mul(1.35).add(positionWorld.z.mul(1.15)).add(geoFbm.mul(4.2)))
      .mul(0.5)
      .add(0.5);
    const seasonalMidOchre = mix(
      mix(uMidOchre, vec3(0.28, 0.38, 0.16), winterSpringGreen.mul(0.58)),
      vec3(0.62, 0.50, 0.30),
      summerBleach.mul(0.55)
    );
    const talusBase = mix(
      seasonalMidOchre,
      uMidTalus,
      smoothstep(0.24, 0.78, rillNoise.mul(0.58).add(soilMacro.r.mul(0.42)))
    );
    const midAlbedo = talusBase.mul(soilFine.rgb.mul(0.58).add(0.56));

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
    const sunlitStrata = mix(sandstoneBody, uCliffHighlight, smoothstep(0.42, 0.82, rockFacet));
    const cliffAlbedo = mix(uCliffCrevice, sunlitStrata, smoothstep(0.24, 0.78, creviceAo));

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

    const dryTerrainRgb = mix(mix(gentleAlbedo, midAlbedo, midBlend), cliffAlbedo, cliffBlend);
    const terrainRgb = dryTerrainRgb.mul(mix(float(1.0), float(0.80), rainWet));

    const distFromCenter = length(positionWorld.xz.sub(uSiteCenterNode));
    const horizonBlend = smoothstep(FADE_START, FADE_END, distFromCenter).mul(0.9);
    return mix(terrainRgb, uHorizonNode, horizonBlend);
  })();

  tslMaterial.roughnessNode = Fn(() => {
    const nGeom = normalize(normalLocal);
    const rawSlope = clamp(float(1.0).sub(nGeom.y), 0.0, 1.0);
    const absN = pow(abs(nGeom), vec3(4.0));
    const triW = absN.div(absN.x.add(absN.y).add(absN.z).add(1e-5));
    const rainWet = clamp(float(SHARED_VEGETATION_UNIFORMS.uRainWetness), 0.0, 1.0);

    const uvXY = vec2(positionWorld.x, positionWorld.y).mul(uInvRockScale);
    const uvZY = vec2(positionWorld.z, positionWorld.y).mul(uInvRockScale);
    const soilSample = texture(soilTex, positionWorld.xz.mul(uInvSoilScale));
    const rockSample = texture(detailTex, uvZY).mul(triW.x).add(texture(detailTex, uvXY).mul(triW.z));

    const cliffBlend = smoothstep(uGentleCutoff, uCliffCutoff.add(0.05), rawSlope);
    const gentleRough = clamp(float(0.91).add(soilSample.a.sub(0.88).mul(0.5)), 0.9, 0.97);
    const cliffRough = clamp(rockSample.a.mul(0.96).add(0.02), 0.76, 0.97);
    return mix(mix(gentleRough, cliffRough, cliffBlend), float(0.58), rainWet.mul(0.75));
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
  getBaseSampler(): SiteGroundSampler;
  updateSampler(
    nextSampler: SiteGroundSampler,
    dirtyBounds?: {
      readonly minX: number;
      readonly maxX: number;
      readonly minZ: number;
      readonly maxZ: number;
    }
  ): void;
  setHorizonColor(color: THREE.Color): void;
  setSeasonalStyle(tintRgb: readonly [number, number, number], snowCover: number): void;
  getSeasonalStyle(): { readonly tintRgb: readonly [number, number, number]; readonly snowCover: number };
  dispose(): void;
}

/**
 * Continuous 3-tier surveyed estate, promontory & valley topography (`3.5 km × 3.5 km`,
 * single draw call, `< 10,000` triangles, `O(1)` `< 0.02 ms` analytical heightfield raycast,
 * and continuous `uYearPhase` + `ClimateZone` + `rainWetness` + `snowAmount` TSL grass shading).
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
    const tex = configureRepeatDataTexture(
      buildMeadowTextureData(),
      TEXTURE_SIZE,
      THREE.SRGBColorSpace
    );
    const tileRepeat = (VALLEY_HALF_EXTENT * 2) / TILE_METRES;
    tex.repeat.set(tileRepeat, tileRepeat);
    ownedTextures.push(tex);

    const bladeDetailTex = configureRepeatDataTexture(
      buildMeadowBladeDetailTextureData(),
      TEXTURE_SIZE,
      THREE.NoColorSpace
    );
    ownedTextures.push(bladeDetailTex);

    material = new THREE.MeshStandardMaterial({
      map: tex,
      vertexColors: true,
      roughness: 0.91,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 4,
    });
    const uSiteCenterNode = vec2(footprint.centerX, footprint.centerZ);
    const uFineBladeInvM = float(1.0 / 1.35);
    const uMidBladeInvM = float(1.0 / 5.8);
    const uMacroPatchInvM = float(1.0 / 16.5);

    const tslMaterial = material as unknown as TslCapableStandardMaterial;
    tslMaterial.colorNode = Fn(() => {
      const distFromCenter = length(positionWorld.xz.sub(uSiteCenterNode));
      const detailWeight = float(1.0).sub(smoothstep(28.0, 140.0, distFromCenter));

      const fineAlbedo = texture(tex, positionWorld.xz.mul(uFineBladeInvM)).rgb;
      const midAlbedo = texture(tex, uv().mul(tileRepeat)).rgb;
      const baseGrass = mix(midAlbedo, fineAlbedo.mul(0.45).add(midAlbedo.mul(0.55)), detailWeight).mul(
        vertexColor().rgb
      );

      const bladeFine = texture(bladeDetailTex, positionWorld.xz.mul(uFineBladeInvM));
      const bladeMid = texture(bladeDetailTex, positionWorld.xz.mul(uMidBladeInvM));
      const macroPatch = texture(bladeDetailTex, positionWorld.xz.mul(uMacroPatchInvM)).b;
      const bladeHeight = mix(bladeMid.b, bladeFine.b.mul(0.65).add(bladeMid.b.mul(0.35)), detailWeight);

      const turf = buildContinuousTurfShadingNodes({
        baseGrassRgb: baseGrass.mul(uSeasonTintNode),
        bladeHeight,
        patchNoise: macroPatch,
        baseRoughness: mix(bladeMid.a, bladeFine.a, detailWeight),
        detailWeight,
      });

      const extraSnow = clamp(
        max(float(uSnowCoverNode).sub(float(SHARED_VEGETATION_UNIFORMS.uSnowAmount)), float(0.0)).mul(
          float(1.0).sub(bladeHeight.mul(0.45))
        ),
        0.0,
        0.92
      );
      const surfaceAlbedo = mix(turf.colorRgb, uSnowAlbedoNode, extraSnow);
      const horizonBlend = smoothstep(FADE_START, FADE_END, distFromCenter).mul(0.9);
      return mix(surfaceAlbedo, uHorizonNode, horizonBlend);
    })();

    tslMaterial.roughnessNode = Fn(() => {
      const distFromCenter = length(positionWorld.xz.sub(uSiteCenterNode));
      const detailWeight = float(1.0).sub(smoothstep(28.0, 140.0, distFromCenter));
      const bladeFine = texture(bladeDetailTex, positionWorld.xz.mul(uFineBladeInvM));
      const bladeMid = texture(bladeDetailTex, positionWorld.xz.mul(uMidBladeInvM));
      const bladeHeight = mix(bladeMid.b, bladeFine.b.mul(0.65).add(bladeMid.b.mul(0.35)), detailWeight);
      const turf = buildContinuousTurfShadingNodes({
        baseGrassRgb: vec3(0.25, 0.35, 0.18),
        bladeHeight,
        patchNoise: bladeMid.b,
        baseRoughness: mix(bladeMid.a, bladeFine.a, detailWeight),
        detailWeight,
      });
      return turf.roughness;
    })();

    tslMaterial.normalNode = Fn(() => {
      const nGeom = normalize(normalLocal);
      const distFromCenter = length(positionWorld.xz.sub(uSiteCenterNode));
      const detailAtten = float(1.0).sub(smoothstep(24.0, 115.0, distFromCenter).mul(0.82));
      const snowDampen = float(1.0).sub(
        clamp(max(float(SHARED_VEGETATION_UNIFORMS.uSnowAmount), float(uSnowCoverNode)), 0.0, 1.0).mul(0.62)
      );
      const detFine = texture(bladeDetailTex, positionWorld.xz.mul(uFineBladeInvM)).rg.sub(0.5);
      const detMid = texture(bladeDetailTex, positionWorld.xz.mul(uMidBladeInvM)).rg.sub(0.5);
      const dXZ = detFine.mul(0.72).add(detMid.mul(0.44)).mul(0.52).mul(detailAtten).mul(snowDampen);
      const worldN = normalize(nGeom.add(vec3(dXZ.x, 0.0, dXZ.y)));
      return cameraViewMatrix.transformDirection(worldN);
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
      const clampedSnow = THREE.MathUtils.clamp(Number.isFinite(snowCover) ? snowCover : 0, 0, 1);
      currentTintTuple = [r, g, b];
      currentSnowCover = clampedSnow;
      seasonTintColor.setRGB(r, g, b, THREE.LinearSRGBColorSpace);
      uSnowCoverNode.value = clampedSnow;
      material.roughness = THREE.MathUtils.lerp(0.91, 0.84, clampedSnow);
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
