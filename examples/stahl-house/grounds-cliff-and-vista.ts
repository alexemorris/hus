import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SkyWeatherSnapshot } from 'husjs';
import {
  applyMetricBoxUVs,
  boxDownsampleTexels,
  detectMobile,
  getOrCreateCachedTexture,
} from 'husjs/materials';
import { prepGeo, tagCollisionRole } from 'husjs/objects';
import { VEG_META_ATTR, VEG_PIVOT_ATTR, createShrub, createTree, createXerophyte } from 'husjs/vegetation';
import { getStonePbr1024, hashCell2D } from './pbr-textures.ts';
import {
  bevelledBox,
  buildSmoothGraniteBoulderGeo,
} from './sculpted-geometry.ts';
import { stahlTerrainSampler, X3, X4, Z0, Z1, Z2, Z3 } from './terrain.ts';

const STAHL_CITY_LIGHTS_GROUP_NAME = 'stahl.vista.laCityLights';

interface CityLightLayerBinding {
  readonly material: THREE.Material & { opacity: number };
  readonly maxOpacity: number;
}

function disablePickAndCollision(root: THREE.Object3D): void {
  root.traverse((obj) => {
    obj.userData.ignoreWalkthroughCollision = true;
    obj.userData.excludeFromPick = true;
    obj.userData.tradeViewIgnore = true;
    obj.userData.isShadowPassHook = true;
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
      obj.raycast = () => undefined;
    }
  });
}

/**
 * Computes normalized `[0..1]` illumination for the distant Los Angeles Basin street-lights grid:
 * - `0.00` in Daylight (`altitudeDeg >= 4.5°` and not canonical Dusk/Night preset)
 * - `0.82` in canonical Dusk (Julius Shulman cobalt-hour twilight)
 * - `1.00` at Night
 */
export function computeStahlCityLightsIntensity(
  snapshot?: Pick<SkyWeatherSnapshot, 'timeOfDay' | 'timeSlot'> & {
    readonly solar?: { readonly altitudeDeg: number };
  }
): number {
  if (!snapshot) return 0;
  if (snapshot.timeSlot === 'night' || snapshot.timeOfDay === 'night') return 1.0;
  const alt = snapshot.solar?.altitudeDeg ?? 45;
  const twilightCurve = 1 - THREE.MathUtils.smoothstep(alt, -6.5, 4.2);
  if (snapshot.timeOfDay === 'dusk' || snapshot.timeSlot === 'dusk') {
    return Math.max(0.82, twilightCurve);
  }
  if (snapshot.timeOfDay === 'day' && alt > 4.2) return 0;
  return Math.max(0, Math.min(1, twilightCurve));
}

/**
 * Updates the LA Basin city-lights grid & Sunset Strip arterial ribbons from the active sky/solar state.
 */
export function syncStahlCityLightsFromSky(
  sceneRoot: THREE.Object3D,
  snapshot?: SkyWeatherSnapshot
): void {
  const grp = sceneRoot.getObjectByName(STAHL_CITY_LIGHTS_GROUP_NAME);
  if (!grp) return;
  const intensity = computeStahlCityLightsIntensity(snapshot);
  const bindings =
    (grp.userData.cityLightBindings as readonly CityLightLayerBinding[] | undefined) ?? [];
  for (const b of bindings) {
    b.material.opacity = b.maxOpacity * intensity;
  }
}

function valueNoise2D(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hashCell2D(ix, iy, seed);
  const b = hashCell2D(ix + 1, iy, seed);
  const c = hashCell2D(ix, iy + 1, seed);
  const d = hashCell2D(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/**
 * Cached `1024 × 1024` procedural Los Angeles Basin street-lights carpet texture
 * strictly aligned to Koenig's N-S (`X`) and E-W (`Z`) structural steel grid.
 */
function createLaCityGridTexture(): THREE.DataTexture {
  return getOrCreateCachedTexture('stahl:vista:laCityGrid', () => {
    const size = 1024;
    const data = new Uint8Array(size * size * 4);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;
        const dxMajor = Math.min(x % 128, 128 - (x % 128));
        const dyMajor = Math.min(y % 128, 128 - (y % 128));
        const dxArterial = Math.min(x % 64, 64 - (x % 64));
        const dyArterial = Math.min(y % 64, 64 - (y % 64));
        const dxCollector = Math.min(x % 32, 32 - (x % 32));
        const dyCollector = Math.min(y % 32, 32 - (y % 32));
        const dxLocal = Math.min(x % 8, 8 - (x % 8));
        const dyLocal = Math.min(y % 8, 8 - (y % 8));

        const onMajorX = dxMajor <= 1;
        const onMajorY = dyMajor <= 1;
        const majorHalo = Math.max(0, 1 - Math.min(dxMajor, dyMajor) / 5.5);
        const onArterial = dxArterial <= 1 || dyArterial <= 1;
        const onCollector = dxCollector === 0 || dyCollector === 0;
        const onLocal = dxLocal === 0 || dyLocal === 0;

        const h1 = hashCell2D(x >> 1, y >> 1, 709);
        const h2 = hashCell2D(x, y, 727);
        const blockDensity =
          0.55 +
          0.45 *
            (valueNoise2D((x / size) * 7.0, (y / size) * 7.0, 739) * 0.65 +
              valueNoise2D((x / size) * 15.0, (y / size) * 15.0, 757) * 0.35);

        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;

        if (onMajorX && onMajorY) {
          r = 255;
          g = 242;
          b = 206;
          a = 255;
        } else if (onMajorX || onMajorY) {
          const pulse = 0.72 + 0.28 * h1;
          const headlight = h2 > 0.84;
          r = Math.round(255 * pulse);
          g = Math.round((headlight ? 228 : 186) * pulse);
          b = Math.round((headlight ? 185 : 98) * pulse);
          a = Math.round(248 * pulse);
        } else if (onArterial && h1 > 0.14) {
          const pulse = 0.64 + 0.36 * h2;
          r = Math.round(252 * pulse);
          g = Math.round(178 * pulse);
          b = Math.round(92 * pulse);
          a = Math.round(224 * pulse);
        } else if (onCollector && h1 > 0.28) {
          const pulse = 0.52 + 0.42 * h2;
          r = Math.round(240 * pulse);
          g = Math.round(172 * pulse);
          b = Math.round(98 * pulse);
          a = Math.round(188 * pulse);
        } else if (onLocal && h2 > 0.54 - blockDensity * 0.22) {
          const warm = h1 > 0.22;
          const pulse = 0.4 + 0.5 * h2;
          r = Math.round((warm ? 232 : 188) * pulse);
          g = Math.round((warm ? 176 : 210) * pulse);
          b = Math.round((warm ? 112 : 235) * pulse);
          a = Math.round(156 * pulse);
        } else if (h2 > 0.962 - blockDensity * 0.018) {
          if (h1 > 0.86) {
            r = 148;
            g = 216;
            b = 248;
            a = 185;
          } else if (h1 > 0.72) {
            r = 250;
            g = 112;
            b = 84;
            a = 175;
          } else {
            r = 246;
            g = 202;
            b = 138;
            a = 170;
          }
        }

        if (majorHalo > 0.02) {
          r = Math.min(255, Math.round(r + majorHalo * 68));
          g = Math.min(255, Math.round(g + majorHalo * 44));
          b = Math.min(255, Math.round(b + majorHalo * 18));
          a = Math.min(255, Math.round(Math.max(a, majorHalo * 92)));
        }

        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = a;
      }
    }

    // Phones/tablets upload a 512px box-filtered grid; alpha-weighted averaging keeps the
    // additive street-light energy of every road line identical to the 1024px source.
    const fit = detectMobile() ? boxDownsampleTexels(data, size, size, 4, 512) : null;
    const tex = new THREE.DataTexture(
      fit ? fit.data : data,
      fit ? fit.width : size,
      fit ? fit.height : size,
      THREE.RGBAFormat
    );
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    return tex;
  });
}

/**
 * Conformal Los Angeles Basin Night City-Lights Grid (`155 m` to `3,650 m` South, SE, East & SW),
 * draped cleanly above `stahlTerrainSampler.sampleCarvedMeshY(wx, wz)` (`0` PointLights).
 */
export function buildLaBasinCityLightsVista(root: THREE.Group): void {
  const vistaGroup = new THREE.Group();
  vistaGroup.name = STAHL_CITY_LIGHTS_GROUP_NAME;

  const minX = -2200;
  const maxX = 3500;
  const minZ = -420;
  const maxZ = 3650;
  const nx = 84;
  const nz = 76;

  const vertCount = (nx + 1) * (nz + 1);
  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const colors = new Float32Array(vertCount * 3);
  const indices: number[] = [];
  const gridTileM = 520.0;

  const sampleBasinElevationY = (wx: number, wz: number): number => {
    const clampedX = Math.max(-1745, Math.min(1745, wx));
    const clampedZ = Math.max(-1745, Math.min(1745, wz));
    return Math.min(-44.0, stahlTerrainSampler.sampleCarvedMeshY(clampedX, clampedZ) + 3.4);
  };

  for (let iz = 0; iz <= nz; iz++) {
    const wz = minZ + Math.pow(iz / nz, 1.35) * (maxZ - minZ);
    for (let ix = 0; ix <= nx; ix++) {
      const wx = minX + (ix / nx) * (maxX - minX);
      const vIdx = iz * (nx + 1) + ix;
      const dist = Math.hypot(wx, wz);
      const wy = sampleBasinElevationY(wx, wz);

      positions[vIdx * 3] = wx;
      positions[vIdx * 3 + 1] = wy;
      positions[vIdx * 3 + 2] = wz;
      uvs[vIdx * 2] = wx / gridTileM;
      uvs[vIdx * 2 + 1] = wz / gridTileM;

      const foothillsMask =
        THREE.MathUtils.smoothstep(dist, 155, 285) *
        (1 - THREE.MathUtils.smoothstep(wy, -62, -48)) *
        THREE.MathUtils.smoothstep(wz - Math.max(0, wx) * 0.18, 40, 195);
      const mask = foothillsMask * (1 - THREE.MathUtils.smoothstep(dist, 2650, 3620));

      colors[vIdx * 3] = mask * 1.15;
      colors[vIdx * 3 + 1] = mask * 1.06;
      colors[vIdx * 3 + 2] = mask * 0.96;
    }
  }

  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const a = iz * (nx + 1) + ix;
      const b = a + 1;
      const c = a + (nx + 1);
      indices.push(a, c, b, b, c, c + 1);
    }
  }

  const basinGeo = new THREE.BufferGeometry();
  basinGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  basinGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  basinGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  basinGeo.setIndex(indices);
  basinGeo.computeVertexNormals();

  const cityMat = new THREE.MeshBasicMaterial({
    name: 'stahl.vista.laCityGridMat',
    map: createLaCityGridTexture(),
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });

  const cityPlane = new THREE.Mesh(prepGeo(basinGeo), cityMat);
  cityPlane.name = 'stahl.vista.laCityGrid';
  cityPlane.renderOrder = 2;
  vistaGroup.add(cityPlane);

  const sparklePositions: number[] = [];
  const sparkleColors: number[] = [];
  const sparkleIndices: number[] = [];

  const pushLightQuad = (
    wx: number,
    wy: number,
    wz: number,
    hs: number,
    r: number,
    g: number,
    b: number
  ): void => {
    const base = sparklePositions.length / 3;
    sparklePositions.push(
      wx - hs, wy, wz - hs,
      wx + hs, wy, wz - hs,
      wx + hs, wy, wz + hs,
      wx - hs, wy, wz + hs,
      wx, wy + hs * 0.85, wz
    );
    for (let k = 0; k < 5; k++) {
      const boost = k === 4 ? 1.25 : 0.85;
      sparkleColors.push(r * boost, g * boost, b * boost);
    }
    sparkleIndices.push(
      base, base + 2, base + 1,
      base, base + 3, base + 2,
      base, base + 1, base + 4,
      base + 1, base + 2, base + 4,
      base + 2, base + 3, base + 4,
      base + 3, base, base + 4
    );
  };

  for (let i = 0; i < 160; i++) {
    const t = i / 159;
    const wx = -950 + t * 2650;
    const wz = 225 + Math.sin(t * Math.PI * 2.4) * 46 + t * 85;
    const wy = sampleBasinElevationY(wx, wz) + 1.1;
    const sz = 2.2 + hashCell2D(i, 17, 853) * 2.4;
    const isHeadlight = i % 5 === 0;
    pushLightQuad(wx, wy, wz, sz, 1.0, isHeadlight ? 0.94 : 0.74, isHeadlight ? 0.82 : 0.36);
  }

  const nsBoulevards = [-780, -520, -260, 0, 260, 520, 780, 1040, 1300, 1560];
  for (let bIdx = 0; bIdx < nsBoulevards.length; bIdx++) {
    const bx = nsBoulevards[bIdx]!;
    for (let s = 0; s < 38; s++) {
      const wz = 245 + s * 78;
      const wx = bx + (hashCell2D(bIdx, s, 863) - 0.5) * 3.0;
      const wy = sampleBasinElevationY(wx, wz) + 1.2;
      const white = s % 4 === 0;
      pushLightQuad(wx, wy, wz, 1.9 + (s / 38) * 3.2, 1.0, white ? 0.92 : 0.72, white ? 0.78 : 0.34);
    }
  }

  const ewBoulevards = [390, 650, 910, 1170, 1430, 1820, 2210];
  for (let bIdx = 0; bIdx < ewBoulevards.length; bIdx++) {
    const bz = ewBoulevards[bIdx]!;
    for (let s = 0; s < 42; s++) {
      const wx = -920 + s * 68;
      const wz = bz + (hashCell2D(s, bIdx, 877) - 0.5) * 3.0;
      const wy = sampleBasinElevationY(wx, wz) + 1.2;
      pushLightQuad(wx, wy, wz, 1.8 + (bz / 2200) * 3.0, 1.0, 0.76, 0.38);
    }
  }

  for (let t = 0; t < 56; t++) {
    const h1 = hashCell2D(t, 1, 887);
    const h2 = hashCell2D(t, 2, 887);
    const h3 = hashCell2D(t, 3, 887);
    const wx = 2150 + h1 * 560;
    const wz = 1180 + h2 * 480;
    const baseY = sampleBasinElevationY(wx, wz);
    const towerH = 18 + Math.pow(h3, 1.8) * 68;
    const floors = 3 + Math.floor(h3 * 5);
    for (let f = 1; f <= floors; f++) {
      pushLightQuad(wx, baseY + (f / floors) * towerH, wz, 3.2 + h1 * 2.2, 0.98, 0.86 + h2 * 0.1, 0.64 + h3 * 0.25);
    }
  }

  const jewelGeo = new THREE.BufferGeometry();
  jewelGeo.setAttribute('position', new THREE.Float32BufferAttribute(sparklePositions, 3));
  jewelGeo.setAttribute('color', new THREE.Float32BufferAttribute(sparkleColors, 3));
  jewelGeo.setIndex(sparkleIndices);
  jewelGeo.computeVertexNormals();

  const jewelMat = new THREE.MeshBasicMaterial({
    name: 'stahl.vista.laBoulevardJewelsMat',
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    opacity: 0,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide,
  });
  const jewelMesh = new THREE.Mesh(prepGeo(jewelGeo), jewelMat);
  jewelMesh.name = 'stahl.vista.laBoulevardJewels';
  jewelMesh.renderOrder = 3;
  vistaGroup.add(jewelMesh);

  vistaGroup.userData.cityLightBindings = [
    { material: cityMat, maxOpacity: 0.94 },
    { material: jewelMat, maxOpacity: 0.9 },
  ] satisfies readonly CityLightLayerBinding[];

  disablePickAndCollision(vistaGroup);
  root.add(vistaGroup);
}

function maxCliffStructuralCeilingY(x: number, z: number): number {
  if (!(x >= -18.5 && x <= 6.82 && z >= -6.35 && z <= 12.92)) return 12.0;
  const nearEWBeam =
    Math.abs(z - Z0) < 0.34 ||
    Math.abs(z - Z1) < 0.34 ||
    Math.abs(z - Z2) < 0.34 ||
    Math.abs(z - Z3) < 0.34;
  const nearNSBeam = Math.abs(x - X3) < 0.34 || Math.abs(x - X4) < 0.34;
  if (nearEWBeam || nearNSBeam) return -0.99;
  const underCatwalk =
    (x >= X4 - 0.1 && x <= 6.82 && z >= Z0 - 0.25 && z <= 12.92) ||
    (z >= Z3 - 0.1 && z <= 12.92 && x >= X3 - 0.55 && x <= 6.82);
  return underCatwalk ? -0.16 : -0.26;
}

function extractFoliageTemplate(group: THREE.Object3D): {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
} {
  let foundMesh: THREE.Mesh | null = null;
  group.traverse((obj) => {
    if (!foundMesh && obj instanceof THREE.Mesh && obj.name.endsWith('.foliage')) {
      foundMesh = obj;
    }
  });
  if (!foundMesh) {
    throw new Error(`Missing foliage mesh in ${group.name}`);
  }
  const mesh = foundMesh as THREE.Mesh;
  return {
    geometry: mesh.geometry,
    material: mesh.material as THREE.Material,
  };
}

function bakeMergedPhenologyInstances(
  templates: readonly THREE.BufferGeometry[],
  matrices: readonly THREE.Matrix4[],
  tints?: readonly THREE.Color[]
): THREE.BufferGeometry {
  let totalV = 0;
  let totalI = 0;
  for (let m = 0; m < matrices.length; m++) {
    const baseGeo = templates[m % templates.length]!;
    const vCount = (baseGeo.attributes.position as THREE.BufferAttribute).count;
    const iCount = baseGeo.index ? baseGeo.index.count : vCount;
    totalV += vCount;
    totalI += iCount;
  }

  const outPos = new Float32Array(totalV * 3);
  const outNorm = new Float32Array(totalV * 3);
  const outUv = new Float32Array(totalV * 2);
  const outCol = new Float32Array(totalV * 3);
  const outPivot = new Float32Array(totalV * 3);
  const outMeta = new Float32Array(totalV * 4);
  const outIdx = totalV > 65535 ? new Uint32Array(totalI) : new Uint16Array(totalI);

  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const piv = new THREE.Vector3();
  const normalMat = new THREE.Matrix3();
  let vBase = 0;
  let iBase = 0;

  for (let m = 0; m < matrices.length; m++) {
    const baseGeo = templates[m % templates.length]!;
    const mat = matrices[m]!;
    normalMat.getNormalMatrix(mat);
    const tint = tints ? tints[m] : undefined;

    const srcPos = baseGeo.attributes.position as THREE.BufferAttribute;
    const srcNorm = baseGeo.attributes.normal as THREE.BufferAttribute | undefined;
    const srcUv = baseGeo.attributes.uv as THREE.BufferAttribute | undefined;
    const srcCol = baseGeo.attributes.color as THREE.BufferAttribute | undefined;
    const srcPiv = baseGeo.attributes[VEG_PIVOT_ATTR] as THREE.BufferAttribute | undefined;
    const srcMeta = baseGeo.attributes[VEG_META_ATTR] as THREE.BufferAttribute | undefined;
    const srcIdx = baseGeo.index;

    const vCount = srcPos.count;
    const iCount = srcIdx ? srcIdx.count : vCount;
    const instanceJitter = (m * 0.61803398875) % 1;

    for (let i = 0; i < vCount; i++) {
      v.fromBufferAttribute(srcPos, i).applyMatrix4(mat);
      outPos[(vBase + i) * 3] = v.x;
      outPos[(vBase + i) * 3 + 1] = v.y;
      outPos[(vBase + i) * 3 + 2] = v.z;

      if (srcNorm) n.fromBufferAttribute(srcNorm, i).applyMatrix3(normalMat).normalize();
      else n.set(0, 1, 0);
      outNorm[(vBase + i) * 3] = n.x;
      outNorm[(vBase + i) * 3 + 1] = n.y;
      outNorm[(vBase + i) * 3 + 2] = n.z;

      outUv[(vBase + i) * 2] = srcUv ? srcUv.getX(i) : 0.5;
      outUv[(vBase + i) * 2 + 1] = srcUv ? srcUv.getY(i) : 0.5;

      const cr = srcCol ? srcCol.getX(i) : 1;
      const cg = srcCol ? srcCol.getY(i) : 1;
      const cb = srcCol ? srcCol.getZ(i) : 1;
      outCol[(vBase + i) * 3] = THREE.MathUtils.clamp(cr * (tint ? tint.r : 1), 0, 1);
      outCol[(vBase + i) * 3 + 1] = THREE.MathUtils.clamp(cg * (tint ? tint.g : 1), 0, 1);
      outCol[(vBase + i) * 3 + 2] = THREE.MathUtils.clamp(cb * (tint ? tint.b : 1), 0, 1);

      if (srcPiv) piv.fromBufferAttribute(srcPiv, i).applyMatrix4(mat);
      else piv.copy(v);
      outPivot[(vBase + i) * 3] = piv.x;
      outPivot[(vBase + i) * 3 + 1] = piv.y;
      outPivot[(vBase + i) * 3 + 2] = piv.z;

      outMeta[(vBase + i) * 4] = srcMeta ? srcMeta.getX(i) : 2;
      outMeta[(vBase + i) * 4 + 1] = srcMeta ? (srcMeta.getY(i) + instanceJitter) % 1 : instanceJitter;
      outMeta[(vBase + i) * 4 + 2] = srcMeta ? srcMeta.getZ(i) : 1;
      outMeta[(vBase + i) * 4 + 3] = srcMeta ? srcMeta.getW(i) : 0.5;
    }

    for (let k = 0; k < iCount; k++) {
      outIdx[iBase + k] = vBase + (srcIdx ? srcIdx.getX(k) : k);
    }
    vBase += vCount;
    iBase += iCount;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(outPos, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(outNorm, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(outUv, 2));
  merged.setAttribute('color', new THREE.BufferAttribute(outCol, 3));
  merged.setAttribute(VEG_PIVOT_ATTR, new THREE.BufferAttribute(outPivot, 3));
  merged.setAttribute(VEG_META_ATTR, new THREE.BufferAttribute(outMeta, 4));
  merged.setIndex(new THREE.BufferAttribute(outIdx, 1));
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

function buildScaledBoulderGeo(rx: number, ry: number, rz: number, seed: number, detail = 4): THREE.BufferGeometry {
  const raw = buildSmoothGraniteBoulderGeo(1, seed, Math.min(3, detail), 0.68);
  raw.scale(rx * 0.86, (ry / 0.68) * 0.86, rz * 0.86);
  const smooth = toCreasedNormals(raw, Math.PI * 0.85);
  raw.dispose();
  return prepGeo(applyMetricBoxUVs(smooth, { tileW: 1.4, tileH: 1.4 }));
}

export function buildStahlCliffOutcropsAndChaparral(root: THREE.Group): void {
  const cliffGroup = new THREE.Group();
  cliffGroup.name = 'stahl.cliffEscarpment';

  const granitePbr = getStonePbr1024('decomposedGranite');
  const rockMat = new THREE.MeshStandardMaterial({
    name: 'stahl.decomposedGraniteRock',
    map: granitePbr.map,
    normalMap: granitePbr.normalMap,
    normalScale: new THREE.Vector2(0.88, 0.88),
    roughnessMap: granitePbr.roughnessMap,
    roughness: 0.94,
    metalness: 0.0,
  });

  const outcropSpecs: readonly {
    x: number;
    z: number;
    yLift: number;
    rx: number;
    ry: number;
    rz: number;
    rotX: number;
    rotY: number;
    rotZ: number;
    seed: number;
  }[] = [
    { x: 4.95, z: 10.75, yLift: 0.12, rx: 1.55, ry: 1.45, rz: 1.65, rotX: 0.22, rotY: 0.42, rotZ: -0.28, seed: 101 },
    { x: 5.75, z: 12.15, yLift: 0.15, rx: 1.45, ry: 1.5, rz: 1.35, rotX: 0.26, rotY: -0.35, rotZ: -0.24, seed: 107 },
    { x: 3.55, z: 11.75, yLift: 0.08, rx: 1.6, ry: 1.35, rz: 1.45, rotX: 0.28, rotY: 0.18, rotZ: -0.08, seed: 113 },
    { x: 1.45, z: 11.55, yLift: 0.05, rx: 1.65, ry: 1.3, rz: 1.4, rotX: 0.3, rotY: -0.28, rotZ: 0.06, seed: 127 },
    { x: -1.15, z: 11.35, yLift: 0.02, rx: 1.7, ry: 1.25, rz: 1.45, rotX: 0.24, rotY: 0.51, rotZ: 0.09, seed: 131 },
    { x: -4.2, z: 11.2, yLift: -0.04, rx: 1.8, ry: 1.2, rz: 1.5, rotX: 0.2, rotY: -0.44, rotZ: -0.07, seed: 137 },
    { x: 5.25, z: 8.15, yLift: 0.1, rx: 1.4, ry: 1.4, rz: 1.65, rotX: 0.08, rotY: 0.64, rotZ: -0.32, seed: 149 },
    { x: 5.15, z: 4.65, yLift: 0.08, rx: 1.35, ry: 1.35, rz: 1.7, rotX: -0.06, rotY: 0.29, rotZ: -0.34, seed: 157 },
    { x: 5.05, z: 1.35, yLift: 0.04, rx: 1.35, ry: 1.3, rz: 1.55, rotX: -0.09, rotY: -0.52, rotZ: -0.28, seed: 163 },
    { x: 7.25, z: 13.45, yLift: -0.12, rx: 1.75, ry: 1.25, rz: 1.65, rotX: 0.26, rotY: 0.77, rotZ: -0.3, seed: 173 },
    { x: 7.65, z: 9.45, yLift: -0.15, rx: 1.65, ry: 1.2, rz: 1.8, rotX: 0.11, rotY: -0.61, rotZ: -0.34, seed: 181 },
    { x: 7.95, z: 4.85, yLift: -0.16, rx: 1.6, ry: 1.15, rz: 1.75, rotX: -0.05, rotY: 0.38, rotZ: -0.32, seed: 191 },
    { x: 8.35, z: 0.25, yLift: -0.18, rx: 1.55, ry: 1.15, rz: 1.6, rotX: -0.12, rotY: 0.94, rotZ: -0.26, seed: 197 },
    { x: 4.65, z: 14.65, yLift: -0.15, rx: 1.8, ry: 1.2, rz: 1.6, rotX: 0.32, rotY: -0.19, rotZ: -0.12, seed: 211 },
    { x: 0.85, z: 14.75, yLift: -0.18, rx: 1.85, ry: 1.15, rz: 1.55, rotX: 0.3, rotY: 0.43, rotZ: 0.08, seed: 223 },
    { x: 9.8, z: 15.4, yLift: -0.22, rx: 2.05, ry: 1.35, rz: 1.95, rotX: 0.28, rotY: 0.62, rotZ: -0.26, seed: 229 },
  ];

  const outcropsGroup = new THREE.Group();
  outcropsGroup.name = 'stahl.cliffOutcrops';
  const vRot = new THREE.Vector3();
  const euler = new THREE.Euler();

  for (let i = 0; i < outcropSpecs.length; i++) {
    const spec = outcropSpecs[i]!;
    const geo = buildScaledBoulderGeo(spec.rx, spec.ry, spec.rz, spec.seed, 4);
    euler.set(spec.rotX, spec.rotY, spec.rotZ);
    const posAttr = geo.attributes.position as THREE.BufferAttribute;
    let rotatedMaxY = 0;
    for (let vi = 0; vi < posAttr.count; vi += 4) {
      vRot.fromBufferAttribute(posAttr, vi).applyEuler(euler);
      if (vRot.y > rotatedMaxY) rotatedMaxY = vRot.y;
    }

    const terrainY = stahlTerrainSampler.sampleTerrainY(spec.x, spec.z);
    let safeCeil = maxCliffStructuralCeilingY(spec.x, spec.z);
    for (const dx of [-spec.rx * 0.8, 0, spec.rx * 0.8]) {
      for (const dz of [-spec.rz * 0.8, 0, spec.rz * 0.8]) {
        safeCeil = Math.min(safeCeil, maxCliffStructuralCeilingY(spec.x + dx, spec.z + dz));
      }
    }
    const centerY = Math.min(terrainY + spec.yLift, safeCeil - rotatedMaxY - 0.1);

    const rockMesh = new THREE.Mesh(geo, rockMat);
    rockMesh.name = `stahl.cliffOutcrop.${i}`;
    rockMesh.position.set(spec.x, centerY, spec.z);
    rockMesh.rotation.set(spec.rotX, spec.rotY, spec.rotZ);
    rockMesh.castShadow = rockMesh.receiveShadow = true;
    outcropsGroup.add(rockMesh);
  }
  cliffGroup.add(outcropsGroup);

  const noseGroup = new THREE.Group();
  noseGroup.name = 'stahl.promontoryGravelNose';

  const noseButtress = new THREE.Mesh(buildScaledBoulderGeo(1.75, 1.85, 2.25, 509, 4), rockMat);
  noseButtress.name = 'stahl.promontoryGravelNose.buttress';
  noseButtress.position.set(7.85, stahlTerrainSampler.sampleTerrainY(7.85, -2.95) - 1.32, -2.95);
  noseButtress.rotation.set(0.08, 0.24, -0.22);
  noseButtress.castShadow = noseButtress.receiveShadow = true;
  noseGroup.add(noseButtress);

  const cribMat = new THREE.MeshStandardMaterial({
    name: 'stahl.sandstoneCribbing',
    map: granitePbr.map,
    normalMap: granitePbr.normalMap,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughnessMap: granitePbr.roughnessMap,
    color: 0xc2ab8e,
    roughness: 0.93,
  });
  const cribSpecs: readonly { x: number; z: number; tier: number; w: number; h: number; d: number; rotY: number }[] = [
    { x: 7.22, z: -1.52, tier: 0, w: 0.46, h: 0.14, d: 0.34, rotY: 0.14 },
    { x: 7.72, z: -1.66, tier: 0, w: 0.46, h: 0.14, d: 0.34, rotY: 0.25 },
    { x: 8.2, z: -1.88, tier: 0, w: 0.44, h: 0.14, d: 0.34, rotY: 0.38 },
    { x: 7.42, z: -1.42, tier: 1, w: 0.5, h: 0.15, d: 0.38, rotY: 0.18 },
    { x: 7.94, z: -1.58, tier: 1, w: 0.5, h: 0.15, d: 0.38, rotY: 0.3 },
    { x: 8.4, z: -1.84, tier: 1, w: 0.46, h: 0.15, d: 0.38, rotY: 0.44 },
    { x: 7.64, z: -1.34, tier: 2, w: 0.54, h: 0.16, d: 0.42, rotY: 0.22 },
    { x: 8.18, z: -1.52, tier: 2, w: 0.52, h: 0.16, d: 0.42, rotY: 0.35 },
  ];
  for (let i = 0; i < cribSpecs.length; i++) {
    const c = cribSpecs[i]!;
    const rimGroundY = stahlTerrainSampler.sampleTerrainY(Math.min(c.x, 8.25), Math.min(c.z, -1.62));
    const block = new THREE.Mesh(bevelledBox(c.w, c.h, c.d, 0.014, 3, 1.2, 1.2), cribMat);
    block.position.set(c.x, rimGroundY - 0.04 - c.tier * 0.168, c.z);
    block.rotation.y = c.rotY;
    block.castShadow = block.receiveShadow = true;
    noseGroup.add(block);
  }

  const agaveTplA = extractFoliageTemplate(createXerophyte({ species: 'agave-attenuata', scale: 1.0, exposure: 'outdoor', seed: 701 }));
  const agaveTplB = extractFoliageTemplate(createXerophyte({ species: 'agave-attenuata', scale: 0.94, exposure: 'outdoor', seed: 719 }));
  const agavePlacements: readonly { x: number; z: number; scale: number; rotY: number }[] = [
    { x: 7.38, z: -2.18, scale: 1.18, rotY: 0.4 },
    { x: 7.88, z: -2.68, scale: 0.88, rotY: 1.9 },
    { x: 7.22, z: -2.42, scale: 0.76, rotY: 3.5 },
    { x: 7.82, z: -4.25, scale: 0.96, rotY: 2.6 },
    { x: 7.48, z: -3.48, scale: 1.04, rotY: 1.15 },
  ];
  const dummy = new THREE.Object3D();
  const agaveMats: THREE.Matrix4[] = [];
  for (let i = 0; i < agavePlacements.length; i++) {
    const p = agavePlacements[i]!;
    dummy.position.set(p.x, stahlTerrainSampler.sampleTerrainY(p.x, p.z) - 0.02, p.z);
    dummy.rotation.set(0.03 * (i % 3), p.rotY, -0.04);
    dummy.scale.setScalar(p.scale);
    dummy.updateMatrix();
    agaveMats.push(dummy.matrix.clone());
  }
  const agaveMesh = new THREE.Mesh(
    bakeMergedPhenologyInstances([agaveTplA.geometry, agaveTplB.geometry], agaveMats),
    agaveTplA.material
  );
  agaveMesh.name = 'stahl.chaparral.agaveRosettes';
  agaveMesh.castShadow = agaveMesh.receiveShadow = true;
  noseGroup.add(agaveMesh);
  cliffGroup.add(noseGroup);

  const deergrassTplA = extractFoliageTemplate(createXerophyte({ species: 'california-deergrass', scale: 1.0, exposure: 'outdoor', seed: 809 }));
  const deergrassTplB = extractFoliageTemplate(createXerophyte({ species: 'california-deergrass', scale: 0.92, exposure: 'outdoor', seed: 823 }));
  const tussockCoords: [number, number, number][] = [];
  const cliffRimSeeds: readonly [number, number][] = [
    [6.95, -1.05], [7.55, -0.45], [8.25, 0.35], [6.85, 1.15], [7.65, 2.05],
    [8.65, 2.85], [6.75, 3.45], [7.45, 4.35], [8.55, 5.15], [6.8, 5.95],
    [7.55, 6.85], [8.85, 7.55], [6.65, 8.25], [7.35, 9.15], [8.45, 9.95],
    [6.75, 10.65], [7.45, 11.45], [8.65, 11.95], [6.85, 12.65], [7.75, 13.25],
    [9.45, 1.45], [9.85, 3.85], [10.15, 6.45], [9.95, 8.95], [9.75, 11.35],
    [11.2, 2.6], [11.6, 5.5], [11.4, 8.4], [11.1, 11.6], [10.4, 13.9],
    [5.85, 13.05], [4.95, 13.25], [3.95, 12.95], [2.85, 13.15], [1.75, 12.95],
    [0.55, 13.1], [-0.75, 12.85], [-2.15, 12.45], [-3.65, 11.85], [-5.25, 11.45],
    [-6.95, 11.25], [-8.65, 11.35], [-10.2, 11.6],
    [6.35, 14.35], [4.85, 14.65], [3.25, 14.45], [1.55, 14.75], [-0.35, 14.55],
    [-2.45, 14.35], [-4.65, 14.15], [-6.85, 14.25], [-9.15, 14.55],
    [8.25, 15.65], [6.15, 16.45], [3.85, 16.85], [1.25, 16.95], [-1.65, 16.75],
    [-4.35, 16.65], [-7.25, 16.85], [9.85, 17.85], [5.25, 19.25], [0.45, 19.45],
    [6.15, 7.35], [6.25, 9.65], [6.1, 11.15], [4.45, 12.55], [2.35, 12.45],
  ];

  for (let i = 0; i < cliffRimSeeds.length; i++) {
    const [sx, sz] = cliffRimSeeds[i]!;
    tussockCoords.push([sx, sz, i]);
  }

  const deerMatrices: THREE.Matrix4[] = [];
  const deerTints: THREE.Color[] = [];
  for (let i = 0; i < tussockCoords.length; i++) {
    const [tx, tz, seed] = tussockCoords[i]!;
    const ty = stahlTerrainSampler.sampleTerrainY(tx, tz);
    const n = stahlTerrainSampler.sampleNormal(tx, tz, 0.5);
    const scale = 1.02 + hashCell2D(seed, 1, 919) * 0.52;
    const yPos = Math.min(ty + 0.04, maxCliffStructuralCeilingY(tx, tz) - 0.88 * scale);

    dummy.position.set(tx, yPos, tz);
    dummy.rotation.set(
      n.nz * 0.26 + (hashCell2D(seed, 2, 919) - 0.5) * 0.12,
      hashCell2D(seed, 3, 919) * Math.PI * 2,
      -n.nx * 0.26 + (hashCell2D(seed, 4, 919) - 0.5) * 0.12
    );
    dummy.scale.set(scale, scale * (0.9 + hashCell2D(seed, 5, 919) * 0.26), scale);
    dummy.updateMatrix();
    deerMatrices.push(dummy.matrix.clone());

    const warmth = hashCell2D(seed, 6, 919);
    deerTints.push(new THREE.Color(0.92 + warmth * 0.12, 0.94 + warmth * 0.08, 0.88 + (1 - warmth) * 0.1));
  }
  const deergrassMesh = new THREE.Mesh(
    bakeMergedPhenologyInstances([deergrassTplA.geometry, deergrassTplB.geometry], deerMatrices, deerTints),
    deergrassTplA.material
  );
  deergrassMesh.name = 'stahl.chaparral.deergrassTussocks';
  deergrassMesh.castShadow = deergrassMesh.receiveShadow = true;
  cliffGroup.add(deergrassMesh);

  const plumeTpl = extractFoliageTemplate(createXerophyte({ species: 'california-deergrass', scale: 1.16, exposure: 'outdoor', seed: 853 }));
  const plumeCoords: readonly [number, number][] = [
    [6.88, -1.35], [7.25, -0.85], [7.72, -0.35], [6.92, 0.45], [7.35, 1.35],
    [6.85, 2.55], [7.15, 4.05], [6.88, 6.35], [7.12, 8.65], [6.82, 10.95],
    [5.45, 12.95], [3.35, 12.88], [0.95, 12.92],
  ];
  const plumeMatrices: THREE.Matrix4[] = [];
  for (let i = 0; i < plumeCoords.length; i++) {
    const [px, pz] = plumeCoords[i]!;
    const py = stahlTerrainSampler.sampleTerrainY(px, pz);
    const sc = 1.08 + hashCell2D(i, 1, 941) * 0.36;
    dummy.position.set(px, Math.min(py + 0.04, maxCliffStructuralCeilingY(px, pz) - 0.98 * sc), pz);
    dummy.rotation.set(0.05 * ((i % 3) - 1), i * 1.7 + 0.3, -0.14);
    dummy.scale.setScalar(sc);
    dummy.updateMatrix();
    plumeMatrices.push(dummy.matrix.clone());
  }
  const plumeMesh = new THREE.Mesh(bakeMergedPhenologyInstances([plumeTpl.geometry], plumeMatrices), plumeTpl.material);
  plumeMesh.name = 'stahl.chaparral.fountainPlumes';
  plumeMesh.castShadow = true;
  cliffGroup.add(plumeMesh);

  const rosemaryTplA = extractFoliageTemplate(createShrub({ species: 'rosemary', radius: 0.72, height: 0.62, exposure: 'outdoor', seed: 977 }));
  const rosemaryTplB = extractFoliageTemplate(createShrub({ species: 'rosemary', radius: 0.68, height: 0.58, exposure: 'outdoor', seed: 983 }));
  const shrubCoords: readonly [number, number, number][] = [
    [9.4, -0.8, 1.25], [10.6, 1.2, 1.45], [11.8, 3.9, 1.55], [12.4, 7.2, 1.65],
    [11.9, 10.6, 1.5], [11.2, 13.8, 1.7], [9.5, 16.5, 1.6], [6.8, 18.2, 1.75],
    [3.4, 18.8, 1.65], [-0.8, 18.5, 1.55], [-4.9, 18.1, 1.7], [-8.8, 17.6, 1.6],
    [14.8, 5.8, 2.05], [15.4, 11.4, 2.15], [13.6, 17.4, 2.1], [8.2, 22.0, 2.25],
  ];
  const shrubMatrices: THREE.Matrix4[] = [];
  const shrubTints: THREE.Color[] = [];
  for (let i = 0; i < shrubCoords.length; i++) {
    const [sx, sz, sc] = shrubCoords[i]!;
    dummy.position.set(sx, stahlTerrainSampler.sampleTerrainY(sx, sz) - 0.04, sz);
    dummy.rotation.set((hashCell2D(i, 1, 991) - 0.5) * 0.14, i * 2.15, (hashCell2D(i, 2, 991) - 0.5) * 0.14);
    dummy.scale.set(sc, sc * (0.86 + hashCell2D(i, 3, 991) * 0.24), sc);
    dummy.updateMatrix();
    shrubMatrices.push(dummy.matrix.clone());
    const olive = hashCell2D(i, 4, 991);
    shrubTints.push(new THREE.Color(0.88 + olive * 0.14, 0.92 + olive * 0.1, 0.84 + olive * 0.12));
  }
  const shrubMesh = new THREE.Mesh(
    bakeMergedPhenologyInstances([rosemaryTplA.geometry, rosemaryTplB.geometry], shrubMatrices, shrubTints),
    rosemaryTplA.material
  );
  shrubMesh.name = 'stahl.chaparral.scrubShrubs';
  shrubMesh.castShadow = shrubMesh.receiveShadow = true;
  cliffGroup.add(shrubMesh);

  const cliffOlive = createTree({
    species: 'olive-tree',
    height: 3.35,
    spread: 2.65,
    exposure: 'outdoor',
    groundLitter: false,
    seed: 1962,
    name: 'stahl.chaparral.californiaOliveTree',
  });
  cliffOlive.position.set(8.65, stahlTerrainSampler.sampleTerrainY(8.65, -3.15) - 0.04, -3.15);
  cliffGroup.add(cliffOlive);

  tagCollisionRole(cliffGroup, 'ignore');
  cliffGroup.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.userData.ignoreWalkthroughCollision = true;
    }
  });
  root.add(cliffGroup);
}
