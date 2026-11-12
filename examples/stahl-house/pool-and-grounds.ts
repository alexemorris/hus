import * as THREE from 'three';
import {
  smoothstep,
  type CutawayWallDescriptor,
  type SkyWeatherSnapshot,
} from 'husjs';
import {
  SeatInteractable,
  collectSeatClickableMeshes,
} from 'husjs/catalog/furniture';
import {
  attachAssetMetadata,
  attachAudioEmitter,
  prepGeo,
  tagCollisionRole,
  tagCutaway,
} from 'husjs/objects';
import type { LightCircuitGroup, SceneBuilderContext } from 'husjs/viewer';
import type { StahlMaterials } from './structure.ts';
import {
  CANTILEVER_M,
  CATWALK_WIDTH_M,
  CLEAR_CEILING_Y,
  POOL_FLOOR_Y,
  POOL_MAIN_MAX_X,
  POOL_MAX_X,
  POOL_MAX_Z,
  POOL_MIN_X,
  POOL_MIN_Z,
  POOL_WATER_Y,
  stahlTerrainSampler,
  X0,
  X1,
  X3,
  X4,
  Z0,
  Z1,
  Z2,
  Z3,
} from './terrain.ts';

const FIVE_FOOT_SCORE_M = 1.524; // 5'-0" scored concrete module (4 x 5' = 20'-0" steel bay)
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
 * - `0.80` in canonical Dusk (Julius Shulman cobalt-hour twilight)
 * - `1.00` at Night
 * - Smooth Hermite transition across golden hour -> civil/nautical twilight during continuous solar scrub.
 */
export function computeStahlCityLightsIntensity(
  snapshot?: Pick<SkyWeatherSnapshot, 'timeOfDay' | 'timeSlot'> & {
    readonly solar?: { readonly altitudeDeg: number };
  }
): number {
  if (!snapshot) return 0;
  if (snapshot.timeSlot === 'night' || snapshot.timeOfDay === 'night') {
    return 1.0;
  }
  const alt = snapshot.solar?.altitudeDeg ?? 45;
  const twilightCurve = 1 - smoothstep(-6.5, 4.2, alt);
  if (snapshot.timeOfDay === 'dusk' || snapshot.timeSlot === 'dusk') {
    return Math.max(0.82, twilightCurve);
  }
  if (snapshot.timeOfDay === 'day' && alt > 4.2) {
    return 0;
  }
  return Math.max(0, Math.min(1, twilightCurve));
}

/**
 * Updates the LA Basin city-lights grid & Sunset Strip arterial ribbons from the active sky/solar state.
 * Fades cleanly to `0` opacity in Daylight with zero visual artifacts and zero raycast/collision impact.
 */
export function syncStahlCityLightsFromSky(
  sceneRoot: THREE.Object3D,
  snapshot?: SkyWeatherSnapshot
): void {
  const grp = sceneRoot.getObjectByName(STAHL_CITY_LIGHTS_GROUP_NAME);
  if (!grp) return;
  const intensity = computeStahlCityLightsIntensity(snapshot);
  const bindings = (grp.userData.cityLightBindings as readonly CityLightLayerBinding[] | undefined) ?? [];
  for (const b of bindings) {
    b.material.opacity = b.maxOpacity * intensity;
  }
}

function hash2D(ix: number, iy: number, seed: number): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function valueNoise3D(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);

  const sample = (dx: number, dy: number, dz: number): number =>
    hash2D(ix + dx + Math.imul(iz + dz, 131), iy + dy + Math.imul(iz + dz, 977), seed);

  const c000 = sample(0, 0, 0);
  const c100 = sample(1, 0, 0);
  const c010 = sample(0, 1, 0);
  const c110 = sample(1, 1, 0);
  const c001 = sample(0, 0, 1);
  const c101 = sample(1, 0, 1);
  const c011 = sample(0, 1, 1);
  const c111 = sample(1, 1, 1);

  const x00 = c000 + (c100 - c000) * ux;
  const x10 = c010 + (c110 - c010) * ux;
  const x01 = c001 + (c101 - c001) * ux;
  const x11 = c011 + (c111 - c011) * ux;
  const y0 = x00 + (x10 - x00) * uy;
  const y1 = x01 + (x11 - x01) * uy;
  return y0 + (y1 - y0) * uz;
}

function fbm3D(x: number, y: number, z: number, seed: number): number {
  return (
    valueNoise3D(x, y, z, seed) * 0.55 +
    valueNoise3D(x * 2.13, y * 2.13, z * 2.13, seed + 29) * 0.30 +
    valueNoise3D(x * 4.41, y * 4.41, z * 4.41, seed + 71) * 0.15
  );
}

/**
 * Procedural PBR Watco-Dennis sealed cast-in-place concrete terrace material scored on an exact
 * `5'-0" × 5'-0"` (`1.524 × 1.524 m`) modular expansion-joint grid (`4 × 4` slabs per `20'-0"` tile)
 * with subtle slab-to-slab tonal variation, aggregate micro-speckle, and troweled joint normals.
 */
function createScoredConcreteTerraceMaterial(): THREE.MeshStandardMaterial {
  const size = 512;
  const cells = 4; // 1 tile = 4 x 1.524 m = 6.096 m (20'-0" structural bay)
  const colorData = new Uint8Array(size * size * 4);
  const normalData = new Uint8Array(size * size * 4);
  const roughData = new Uint8Array(size * size * 4);
  const heights = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const cu = u * cells;
      const cv = v * cells;
      const cellX = Math.floor(cu);
      const cellY = Math.floor(cv);
      const fu = cu - cellX;
      const fv = cv - cellY;

      const distU = Math.min(fu, 1 - fu);
      const distV = Math.min(fv, 1 - fv);
      const jointHalfW = 0.0085; // ~13 mm saw-cut / troweled score groove
      const grooveU = 1 - smoothstep(0.002, jointHalfW, distU);
      const grooveV = 1 - smoothstep(0.002, jointHalfW, distV);
      const groove = Math.max(grooveU, grooveV);

      const slabTone = (hash2D(cellX, cellY, 311) - 0.5) * 11.0;
      const trowel = fbm3D(u * 11.0, v * 11.0, 0.5, 317);
      const aggregate = valueNoise3D(u * 96.0, v * 96.0, 1.3, 331);
      const fine = valueNoise3D(u * 192.0, v * 192.0, 2.7, 347);

      const h =
        0.62 -
        groove * 0.48 +
        (trowel - 0.5) * 0.10 +
        (aggregate - 0.5) * 0.08 +
        (fine - 0.5) * 0.05;
      heights[y * size + x] = h;

      // Warm buff-grey California cast concrete (#C6C0B4) darkened cleanly inside expansion joints
      const baseR = 199 + slabTone + (trowel - 0.5) * 12 + (aggregate - 0.5) * 13 + (fine - 0.5) * 8;
      const baseG = 193 + slabTone * 0.96 + (trowel - 0.5) * 11 + (aggregate - 0.5) * 12 + (fine - 0.5) * 8;
      const baseB = 181 + slabTone * 0.90 + (trowel - 0.5) * 10 + (aggregate - 0.5) * 11 + (fine - 0.5) * 7;
      const jointShade = 1 - groove * 0.44;

      const idx = (y * size + x) * 4;
      colorData[idx] = Math.max(60, Math.min(238, Math.round(baseR * jointShade)));
      colorData[idx + 1] = Math.max(58, Math.min(232, Math.round(baseG * jointShade)));
      colorData[idx + 2] = Math.max(54, Math.min(220, Math.round(baseB * jointShade)));
      colorData[idx + 3] = 255;

      const rough = Math.max(
        0.64,
        Math.min(0.95, 0.76 + groove * 0.16 + (aggregate - 0.5) * 0.08 - (trowel - 0.5) * 0.05)
      );
      const rByte = Math.round(rough * 255);
      roughData[idx] = rByte;
      roughData[idx + 1] = rByte;
      roughData[idx + 2] = rByte;
      roughData[idx + 3] = 255;
    }
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const hL = heights[y * size + ((x - 1 + size) % size)];
      const hR = heights[y * size + ((x + 1) % size)];
      const hD = heights[((y - 1 + size) % size) * size + x];
      const hU = heights[((y + 1) % size) * size + x];
      const dx = (hL - hR) * 2.6;
      const dy = (hD - hU) * 2.6;
      const len = Math.hypot(dx, dy, 1);
      const idx = (y * size + x) * 4;
      normalData[idx] = Math.round(((dx / len) * 0.5 + 0.5) * 255);
      normalData[idx + 1] = Math.round(((dy / len) * 0.5 + 0.5) * 255);
      normalData[idx + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      normalData[idx + 3] = 255;
    }
  }

  const configureTex = (data: Uint8Array, srgb: boolean): THREE.DataTexture => {
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    return tex;
  };

  return new THREE.MeshStandardMaterial({
    name: 'stahl.scoredConcreteTerrace',
    map: configureTex(colorData, true),
    normalMap: configureTex(normalData, false),
    normalScale: new THREE.Vector2(0.75, 0.75),
    roughnessMap: configureTex(roughData, false),
    roughness: 1.0,
    metalness: 0.0,
  });
}

/**
 * Projects world-aligned `20'-0"` (`4 × 1.524 m`) UVs onto a horizontal concrete slab box so the
 * `5'-0" × 5'-0"` expansion joints line up continuously with Koenig's structural H-columns (`X3=0, Z1=0`).
 */
function buildWorldScoredSlabBox(
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  minZ: number,
  maxZ: number,
  mat: THREE.Material
): THREE.Mesh {
  const w = maxX - minX;
  const h = maxY - minY;
  const d = maxZ - minZ;
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const cz = (minZ + maxZ) * 0.5;

  const geo = new THREE.BoxGeometry(w, h, d);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const norm = geo.attributes.normal as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const tileM = FIVE_FOOT_SCORE_M * 4; // 6.096 m

  for (let i = 0; i < pos.count; i++) {
    const wx = cx + pos.getX(i);
    const wy = cy + pos.getY(i);
    const wz = cz + pos.getZ(i);
    const nx = Math.abs(norm.getX(i));
    const ny = Math.abs(norm.getY(i));
    if (ny > 0.5) {
      uv.setXY(i, wx / tileM, wz / tileM);
    } else if (nx > 0.5) {
      uv.setXY(i, wz / tileM, wy / tileM);
    } else {
      uv.setXY(i, wx / tileM, wy / tileM);
    }
  }

  const mesh = new THREE.Mesh(prepGeo(geo), mat);
  mesh.position.set(cx, cy, cz);
  mesh.receiveShadow = true;
  return mesh;
}

/** Glazed `1" × 1"` cobalt-cerulean mosaic waterline ceramic tile material (`Catalina Pool Co.`). */
function createWaterlineMosaicTileMaterial(): THREE.MeshStandardMaterial {
  const size = 256;
  const cellsX = 32;
  const cellsY = 8;
  const colorData = new Uint8Array(size * size * 4);
  const normalData = new Uint8Array(size * size * 4);
  const heights = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * cellsX;
      const v = (y / size) * cellsY;
      const ix = Math.floor(u);
      const iy = Math.floor(v);
      const fu = u - ix;
      const fv = v - iy;
      const edge = Math.min(fu, 1 - fu, fv, 1 - fv);
      const grout = 1 - smoothstep(0.04, 0.11, edge);
      const tileVar = hash2D(ix, iy, 613);

      heights[y * size + x] = 1 - grout * 0.65;

      // Rich cerulean-cobalt glazed mosaic tiles (#1F6E8E .. #3898B8) with crisp pale grout
      const tr = 28 + tileVar * 26;
      const tg = 112 + tileVar * 44;
      const tb = 148 + tileVar * 46;
      const idx = (y * size + x) * 4;
      colorData[idx] = Math.round(tr * (1 - grout) + 212 * grout);
      colorData[idx + 1] = Math.round(tg * (1 - grout) + 220 * grout);
      colorData[idx + 2] = Math.round(tb * (1 - grout) + 224 * grout);
      colorData[idx + 3] = 255;
    }
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const hL = heights[y * size + ((x - 1 + size) % size)];
      const hR = heights[y * size + ((x + 1) % size)];
      const hD = heights[((y - 1 + size) % size) * size + x];
      const hU = heights[((y + 1) % size) * size + x];
      const dx = (hL - hR) * 2.2;
      const dy = (hD - hU) * 2.2;
      const len = Math.hypot(dx, dy, 1);
      const idx = (y * size + x) * 4;
      normalData[idx] = Math.round(((dx / len) * 0.5 + 0.5) * 255);
      normalData[idx + 1] = Math.round(((dy / len) * 0.5 + 0.5) * 255);
      normalData[idx + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      normalData[idx + 3] = 255;
    }
  }

  const map = new THREE.DataTexture(colorData, size, size, THREE.RGBAFormat);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(9, 1);
  map.colorSpace = THREE.SRGBColorSpace;
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.needsUpdate = true;

  const normalMap = new THREE.DataTexture(normalData, size, size, THREE.RGBAFormat);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.repeat.set(9, 1);
  normalMap.generateMipmaps = true;
  normalMap.minFilter = THREE.LinearMipmapLinearFilter;
  normalMap.magFilter = THREE.LinearFilter;
  normalMap.needsUpdate = true;

  return new THREE.MeshStandardMaterial({
    name: 'stahl.pool.waterlineMosaicTile',
    map,
    normalMap,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughness: 0.16,
    metalness: 0.06,
    emissive: new THREE.Color(0x1689a8),
    emissiveIntensity: 0.22,
  });
}

/** Subtle procedural water ripple normal map for the pool surface. */
function createRippledWaterNormalMap(): THREE.DataTexture {
  const size = 256;
  const normalData = new Uint8Array(size * size * 4);
  const hField = new Float32Array(size * size);
  const tau = Math.PI * 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const w1 = Math.sin(u * tau * 5 + v * tau * 3) * 0.35;
      const w2 = Math.cos(u * tau * 8 - v * tau * 6) * 0.25;
      const w3 = Math.sin(u * tau * 13 + v * tau * 11) * 0.14;
      const n = fbm3D(u * 9.0, v * 9.0, 1.7, 521) * 0.45;
      hField[y * size + x] = w1 + w2 + w3 + n;
    }
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const hL = hField[y * size + ((x - 1 + size) % size)];
      const hR = hField[y * size + ((x + 1) % size)];
      const hD = hField[((y - 1 + size) % size) * size + x];
      const hU = hField[((y + 1) % size) * size + x];
      const dx = (hL - hR) * 0.55;
      const dy = (hD - hU) * 0.55;
      const len = Math.hypot(dx, dy, 1);
      const idx = (y * size + x) * 4;
      normalData[idx] = Math.round(((dx / len) * 0.5 + 0.5) * 255);
      normalData[idx + 1] = Math.round(((dy / len) * 0.5 + 0.5) * 255);
      normalData[idx + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      normalData[idx + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(normalData, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3.5, 2.6);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** Caustic turquoise underwater plaster glow texture (`0` extra PointLights). */
function createPoolCausticTexture(): THREE.DataTexture {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  const tau = Math.PI * 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const c1 = Math.abs(Math.sin(u * tau * 4 + Math.cos(v * tau * 3) * 1.4));
      const c2 = Math.abs(Math.cos(v * tau * 5 - Math.sin(u * tau * 4) * 1.3));
      const ridge = Math.pow(1 - Math.min(c1, c2), 3.2);
      const base = 0.52 + ridge * 0.48;
      const idx = (y * size + x) * 4;
      data[idx] = Math.min(255, Math.round(78 * base + ridge * 95));
      data[idx + 1] = Math.min(255, Math.round(196 * base + ridge * 58));
      data[idx + 2] = Math.min(255, Math.round(214 * base + ridge * 41));
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Procedural PBR material set (albedo + tangent normal + roughness DataTextures) for
 * iron-stained Hollywood Hills decomposed-granite & fractured sandstone cliff outcrops.
 */
function createDecomposedGraniteRockMaterial(): THREE.MeshStandardMaterial {
  const size = 256;
  const colorData = new Uint8Array(size * size * 4);
  const normalData = new Uint8Array(size * size * 4);
  const roughData = new Uint8Array(size * size * 4);
  const heights = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const macro = fbm3D(u * 5.0, v * 5.0, 0.7, 401);
      const mid = fbm3D(u * 13.0, v * 15.0, 1.9, 419);
      const crackA = 1 - Math.abs(valueNoise3D(u * 7.5 + macro * 1.4, v * 9.5 + mid * 1.1, 2.3, 431) * 2 - 1);
      const crackB = 1 - Math.abs(valueNoise3D(u * 16.0, v * 14.0 + macro * 0.9, 3.8, 443) * 2 - 1);
      const fissure = Math.max(Math.pow(crackA, 6.0), Math.pow(crackB, 7.0) * 0.75);
      const grit = valueNoise3D(u * 48, v * 48, 2.7, 457);
      const fine = valueNoise3D(u * 96, v * 96, 4.1, 463);

      const h = Math.max(
        0,
        Math.min(
          1,
          0.54 + (macro - 0.5) * 0.26 + (mid - 0.5) * 0.18 - fissure * 0.34 + (grit - 0.5) * 0.14 + (fine - 0.5) * 0.08
        )
      );
      heights[y * size + x] = h;

      const iron = fbm3D(u * 4.2 + 2.1, v * 4.2 + 5.7, 1.3, 479);
      let r = 166 + (iron - 0.5) * 36 + (mid - 0.5) * 22 + (grit - 0.5) * 20 + (fine - 0.5) * 12;
      let g = 131 + (iron - 0.5) * 26 + (mid - 0.5) * 18 + (grit - 0.5) * 16 + (fine - 0.5) * 10;
      let b = 92 + (iron - 0.5) * 16 + (mid - 0.5) * 14 + (grit - 0.5) * 13 + (fine - 0.5) * 8;

      const ao = 1 - fissure * 0.42;
      r *= ao;
      g *= ao;
      b *= ao;

      const idx = (y * size + x) * 4;
      colorData[idx] = Math.max(46, Math.min(224, Math.round(r)));
      colorData[idx + 1] = Math.max(36, Math.min(190, Math.round(g)));
      colorData[idx + 2] = Math.max(26, Math.min(146, Math.round(b)));
      colorData[idx + 3] = 255;

      const rough = Math.max(0.84, Math.min(0.99, 0.91 + fissure * 0.07 + (grit - 0.5) * 0.06));
      const rByte = Math.round(rough * 255);
      roughData[idx] = rByte;
      roughData[idx + 1] = rByte;
      roughData[idx + 2] = rByte;
      roughData[idx + 3] = 255;
    }
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const hL = heights[y * size + ((x - 1 + size) % size)];
      const hR = heights[y * size + ((x + 1) % size)];
      const hD = heights[((y - 1 + size) % size) * size + x];
      const hU = heights[((y + 1) % size) * size + x];
      const dx = (hL - hR) * 3.1;
      const dy = (hD - hU) * 3.1;
      const invLen = 1 / Math.hypot(dx, dy, 1);
      const idx = (y * size + x) * 4;
      normalData[idx] = Math.round(((dx * invLen) * 0.5 + 0.5) * 255);
      normalData[idx + 1] = Math.round(((dy * invLen) * 0.5 + 0.5) * 255);
      normalData[idx + 2] = Math.round(((invLen) * 0.5 + 0.5) * 255);
      normalData[idx + 3] = 255;
    }
  }

  const map = new THREE.DataTexture(colorData, size, size, THREE.RGBAFormat);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(2.0, 2.0);
  map.colorSpace = THREE.SRGBColorSpace;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;

  const normalMap = new THREE.DataTexture(normalData, size, size, THREE.RGBAFormat);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.repeat.set(2.0, 2.0);
  normalMap.magFilter = THREE.LinearFilter;
  normalMap.minFilter = THREE.LinearMipmapLinearFilter;
  normalMap.generateMipmaps = true;
  normalMap.needsUpdate = true;

  const roughnessMap = new THREE.DataTexture(roughData, size, size, THREE.RGBAFormat);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(2.0, 2.0);
  roughnessMap.magFilter = THREE.LinearFilter;
  roughnessMap.minFilter = THREE.LinearMipmapLinearFilter;
  roughnessMap.generateMipmaps = true;
  roughnessMap.needsUpdate = true;

  return new THREE.MeshStandardMaterial({
    name: 'stahl.decomposedGraniteRock',
    map,
    normalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughnessMap,
    roughness: 0.96,
    metalness: 0.0,
    vertexColors: true,
  });
}

function createCraggyOutcropGeometry(
  rx: number,
  ry: number,
  rz: number,
  seed: number,
  detail = 3
): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    const ux = pos.getX(i);
    const uy = pos.getY(i);
    const uz = pos.getZ(i);

    const n1 = fbm3D(ux * 1.9 + 3.1, uy * 2.6 + 1.7, uz * 1.9 + 5.3, seed);
    const ridge = 1 - Math.abs(valueNoise3D(ux * 3.1, uy * 3.8, uz * 3.1, seed + 17) * 2 - 1);
    const terrace = Math.floor((uy + 1.1) * 4.5) / 4.5;
    const strataStep = (uy + 1.1 - terrace) * 0.22;

    const radial = 0.72 + n1 * 0.36 + Math.pow(ridge, 2.1) * 0.18 - strataStep;
    const px = ux * rx * radial;
    const py = uy * ry * (uy > 0 ? radial * 0.92 : radial * 1.05);
    const pz = uz * rz * radial;
    pos.setXYZ(i, px, py, pz);

    const shade = Math.max(0.54, Math.min(1.14, 0.80 + uy * 0.16 + (n1 - 0.5) * 0.24 + ridge * 0.10));
    const rust = valueNoise3D(ux * 2.5, uy * 2.5, uz * 2.5, seed + 53);
    colors[i * 3] = Math.min(1, shade * (0.98 + rust * 0.12));
    colors[i * 3 + 1] = Math.min(1, shade * (0.92 + rust * 0.05));
    colors[i * 3 + 2] = Math.min(1, shade * (0.84 - rust * 0.06));
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return prepGeo(geo);
}

function buildDeergrassClumpGeometry(bladeCount = 22, seed = 701): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const baseCol = new THREE.Color(0x6e6335);
  const midCol = new THREE.Color(0xa68b46);
  const tipCol = new THREE.Color(0xcab067);
  const tmpCol = new THREE.Color();

  const segs = 4;
  for (let b = 0; b < bladeCount; b++) {
    const az = (b / bladeCount) * Math.PI * 2 + (hash2D(b, 1, seed) - 0.5) * 0.38;
    const tilt = 0.24 + hash2D(b, 2, seed) * 0.68;
    const len = 0.52 + hash2D(b, 3, seed) * 0.44;
    const droop = 0.26 + hash2D(b, 4, seed) * 0.34;
    const baseR = 0.03 + hash2D(b, 5, seed) * 0.09;
    const halfW0 = 0.026 + hash2D(b, 6, seed) * 0.012;

    const dirX = Math.cos(az);
    const dirZ = Math.sin(az);
    const sideX = -dirZ;
    const sideZ = dirX;

    const baseVert = positions.length / 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const reach = baseR + Math.sin(t * Math.PI * 0.58) * len * (0.45 + tilt * 0.72);
      const height = Math.sin(t * Math.PI * 0.76) * len * (1.02 - tilt * 0.32) - t * t * droop;
      const cx = dirX * reach;
      const cy = Math.max(-0.04, height);
      const cz = dirZ * reach;

      const w = halfW0 * (1 - t * 0.88);
      const ridge = w * 0.45;

      tmpCol.copy(baseCol).lerp(midCol, Math.min(1, t * 1.5)).lerp(tipCol, Math.max(0, (t - 0.45) / 0.55));
      const tint = 0.90 + hash2D(b, 7, seed) * 0.20;
      const cr = Math.min(1, tmpCol.r * tint);
      const cg = Math.min(1, tmpCol.g * tint);
      const cb = Math.min(1, tmpCol.b * tint);

      positions.push(
        cx - sideX * w, cy, cz - sideZ * w,
        cx + dirX * ridge * 0.4, cy + ridge, cz + dirZ * ridge * 0.4,
        cx + sideX * w, cy, cz + sideZ * w
      );
      normals.push(
        -sideX * 0.5, 0.86, -sideZ * 0.5,
        dirX * 0.3, 0.95, dirZ * 0.3,
        sideX * 0.5, 0.86, sideZ * 0.5
      );
      colors.push(cr, cg, cb, cr * 1.04, cg * 1.04, cb * 1.02, cr, cg, cb);

      if (s < segs) {
        const r0 = baseVert + s * 3;
        const r1 = r0 + 3;
        indices.push(
          r0, r1, r0 + 1,
          r0 + 1, r1, r1 + 1,
          r0 + 1, r1 + 1, r0 + 2,
          r0 + 2, r1 + 1, r1 + 2
        );
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return prepGeo(geo);
}

function buildFountainPlumeClumpGeometry(plumeCount = 14, seed = 811): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const stalkCol = new THREE.Color(0x9d8652);
  const plumeCol = new THREE.Color(0xd8b89e);
  const plumeTip = new THREE.Color(0xead6c0);
  const tmpCol = new THREE.Color();

  const segs = 4;
  for (let p = 0; p < plumeCount; p++) {
    const az = (p / plumeCount) * Math.PI * 2 + (hash2D(p, 1, seed) - 0.5) * 0.45;
    const tilt = 0.22 + hash2D(p, 2, seed) * 0.48;
    const len = 0.68 + hash2D(p, 3, seed) * 0.32;
    const dirX = Math.cos(az);
    const dirZ = Math.sin(az);
    const sideX = -dirZ;
    const sideZ = dirX;

    const baseVert = positions.length / 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const reach = 0.03 + Math.pow(t, 1.15) * len * (0.36 + tilt * 0.65);
      const cy = t * len * (1.0 - tilt * 0.25) - t * t * t * 0.22;
      const cx = dirX * reach;
      const cz = dirZ * reach;
      const plumeSwell = t > 0.35 ? Math.sin(((t - 0.35) / 0.65) * Math.PI) * 0.036 : 0.010;
      const w = Math.max(0.005, plumeSwell);

      tmpCol.copy(stalkCol).lerp(plumeCol, Math.max(0, (t - 0.28) / 0.45)).lerp(plumeTip, Math.max(0, (t - 0.7) / 0.3));
      positions.push(
        cx - sideX * w, cy, cz - sideZ * w,
        cx + dirX * w * 0.7, cy + w * 0.85, cz + dirZ * w * 0.7,
        cx + sideX * w, cy, cz + sideZ * w
      );
      normals.push(-sideX, 0.6, -sideZ, dirX, 0.85, dirZ, sideX, 0.6, sideZ);
      colors.push(
        tmpCol.r, tmpCol.g, tmpCol.b,
        Math.min(1, tmpCol.r * 1.05), Math.min(1, tmpCol.g * 1.04), Math.min(1, tmpCol.b * 1.03),
        tmpCol.r, tmpCol.g, tmpCol.b
      );

      if (s < segs) {
        const r0 = baseVert + s * 3;
        const r1 = r0 + 3;
        indices.push(
          r0, r1, r0 + 1,
          r0 + 1, r1, r1 + 1,
          r0 + 1, r1 + 1, r0 + 2,
          r0 + 2, r1 + 1, r1 + 2
        );
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return prepGeo(geo);
}

function buildAgaveAttenuataGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const innerCol = new THREE.Color(0x829c70);
  const midCol = new THREE.Color(0x6c855e);
  const outerCol = new THREE.Color(0x586e4c);
  const tmpCol = new THREE.Color();

  const whorls: readonly { count: number; pitch: number; len: number; width: number; y0: number; phase: number }[] = [
    { count: 5, pitch: 1.18, len: 0.28, width: 0.055, y0: 0.11, phase: 0.1 },
    { count: 8, pitch: 0.78, len: 0.38, width: 0.078, y0: 0.08, phase: 0.48 },
    { count: 11, pitch: 0.36, len: 0.44, width: 0.092, y0: 0.04, phase: 0.92 },
  ];

  const segs = 4;
  for (let wIdx = 0; wIdx < whorls.length; wIdx++) {
    const whorl = whorls[wIdx];
    for (let i = 0; i < whorl.count; i++) {
      const az = whorl.phase + (i / whorl.count) * Math.PI * 2;
      const dirX = Math.cos(az);
      const dirZ = Math.sin(az);
      const sideX = -dirZ;
      const sideZ = dirX;

      const baseVert = positions.length / 3;
      for (let s = 0; s <= segs; s++) {
        const t = s / segs;
        const widthProfile = Math.sin(Math.pow(t, 0.72) * Math.PI) * 0.88 + (1 - t) * 0.28;
        const hw = whorl.width * widthProfile * (1 - t * 0.35);
        const thick = 0.018 * (1 - t * 0.72);

        const r = 0.03 + t * whorl.len * Math.cos(whorl.pitch * 0.65);
        const arch = Math.sin(t * Math.PI * 0.75) * whorl.len * Math.sin(whorl.pitch) - t * t * 0.09;
        const cx = dirX * r;
        const cy = whorl.y0 + arch;
        const cz = dirZ * r;

        tmpCol
          .copy(wIdx === 0 ? innerCol : wIdx === 1 ? midCol : outerCol)
          .offsetHSL(0, 0, (t - 0.4) * 0.06);

        positions.push(
          cx, cy + thick * 0.45, cz,
          cx - sideX * hw, cy + thick * 0.7, cz - sideZ * hw,
          cx, cy - thick * 0.85, cz,
          cx + sideX * hw, cy + thick * 0.7, cz + sideZ * hw
        );
        for (let k = 0; k < 4; k++) {
          const shade = k === 2 ? 0.82 : 1.0;
          colors.push(tmpCol.r * shade, tmpCol.g * shade, tmpCol.b * shade);
        }

        if (s < segs) {
          const r0 = baseVert + s * 4;
          const r1 = r0 + 4;
          for (let k = 0; k < 4; k++) {
            const kn = (k + 1) % 4;
            indices.push(r0 + k, r1 + k, r0 + kn, r0 + kn, r1 + k, r1 + kn);
          }
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return prepGeo(geo);
}

/**
 * Sculpts tropical mid-century *Strelitzia nicolai* (Giant Bird of Paradise) paddle foliage
 * or *Philodendron* split-leaf stems for the Architectural Pottery terrace planters.
 */
function buildTropicalPlanterFoliageGeometry(
  variant: 'strelitzia' | 'philodendron',
  seed = 733
): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const stemCol = new THREE.Color(0x3f5e32);
  const leafDark = new THREE.Color(variant === 'strelitzia' ? 0x2f5a31 : 0x295228);
  const leafBright = new THREE.Color(variant === 'strelitzia' ? 0x528246 : 0x4b7d3b);
  const tmpCol = new THREE.Color();

  const leafCount = variant === 'strelitzia' ? 9 : 11;
  const segs = 5;

  for (let i = 0; i < leafCount; i++) {
    const az = (i / leafCount) * Math.PI * 2 + (hash2D(i, 1, seed) - 0.5) * 0.42;
    const dirX = Math.cos(az);
    const dirZ = Math.sin(az);
    const sideX = -dirZ;
    const sideZ = dirX;

    const stemH = (variant === 'strelitzia' ? 0.42 : 0.26) + hash2D(i, 2, seed) * 0.24;
    const bladeLen = (variant === 'strelitzia' ? 0.52 : 0.36) + hash2D(i, 3, seed) * 0.16;
    const maxW = variant === 'strelitzia' ? 0.125 : 0.145;
    const pitch = (variant === 'strelitzia' ? 0.72 : 0.46) + hash2D(i, 4, seed) * 0.35;

    const baseVert = positions.length / 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const inBlade = Math.max(0, (t - 0.28) / 0.72);
      const r = 0.02 + t * (stemH * 0.35 + bladeLen * Math.cos(pitch * 0.75));
      const y =
        t * stemH * 0.85 +
        Math.sin(inBlade * Math.PI * 0.72) * bladeLen * Math.sin(pitch) -
        inBlade * inBlade * 0.11;

      const lobeMod =
        variant === 'philodendron' && inBlade > 0.15
          ? 0.72 + 0.28 * Math.abs(Math.sin(inBlade * Math.PI * 3.5))
          : 1.0;
      const hw =
        t < 0.26
          ? 0.014
          : maxW * Math.sin(Math.pow(inBlade, 0.68) * Math.PI) * lobeMod;
      const keel = t < 0.26 ? 0.012 : 0.018 * (1 - inBlade * 0.6);

      tmpCol.copy(t < 0.28 ? stemCol : leafDark).lerp(leafBright, inBlade * 0.75);

      const cx = dirX * r;
      const cz = dirZ * r;
      positions.push(
        cx - sideX * hw, y + keel * 0.5, cz - sideZ * hw,
        cx, y, cz,
        cx + sideX * hw, y + keel * 0.5, cz + sideZ * hw
      );
      colors.push(
        tmpCol.r, tmpCol.g, tmpCol.b,
        tmpCol.r * 0.84, tmpCol.g * 0.86, tmpCol.b * 0.82,
        tmpCol.r, tmpCol.g, tmpCol.b
      );

      if (s < segs) {
        const r0 = baseVert + s * 3;
        const r1 = r0 + 3;
        indices.push(
          r0, r1, r0 + 1,
          r0 + 1, r1, r1 + 1,
          r0 + 1, r1 + 1, r0 + 2,
          r0 + 2, r1 + 1, r1 + 2
        );
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return prepGeo(geo);
}

function maxCliffStructuralCeilingY(x: number, z: number): number {
  const inBuildingOrCatwalkPlan = x >= -18.5 && x <= 6.82 && z >= -6.35 && z <= 12.92;
  if (!inBuildingOrCatwalkPlan) {
    return 12.0;
  }
  const nearEWBeam =
    Math.abs(z - Z0) < 0.34 ||
    Math.abs(z - Z1) < 0.34 ||
    Math.abs(z - Z2) < 0.34 ||
    Math.abs(z - Z3) < 0.34;
  const nearNSBeam = Math.abs(x - X3) < 0.34 || Math.abs(x - X4) < 0.34;
  if (nearEWBeam || nearNSBeam) {
    return -0.99;
  }
  const underCatwalk =
    (x >= X4 - 0.1 && x <= 6.82 && z >= Z0 - 0.25 && z <= 12.92) ||
    (z >= Z3 - 0.1 && z <= 12.92 && x >= X3 - 0.55 && x <= 6.82);
  if (underCatwalk) {
    return -0.16;
  }
  return -0.26;
}

/**
 * Builds a high-resolution `1024 × 1024` procedural Los Angeles Basin street-lights carpet texture
 * strictly aligned to Koenig's N-S (`X`) and E-W (`Z`) structural steel grid:
 * - Warm `2200K–2700K` sodium-amber & incandescent boulevards (La Cienega, Fairfax, Highland, Vine;
 *   Santa Monica Blvd, Melrose, Beverly, Wilshire, Olympic, Pico)
 * - Crisp `4000K` white intersection signal nodes & headlight streaks
 * - Dense fine-grained residential & commercial block sparkles
 * (`0` PointLights — pure additive HDR emissive!).
 */
function createLaCityGridTexture(): THREE.DataTexture {
  const size = 1024;
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // Orthogonal LA grid hierarchy (1 tile = 640 m x 640 m -> 0.625 m/px; repeated across 5.6 km!)
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

      const h1 = hash2D(x >> 1, y >> 1, 709);
      const h2 = hash2D(x, y, 727);
      const blockDensity = 0.55 + 0.45 * fbm3D((x / size) * 7.0, (y / size) * 7.0, 0.9, 739);

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      if (onMajorX && onMajorY) {
        // Major boulevard intersection (warm white + signal amber)
        r = 255;
        g = 242;
        b = 206;
        a = 255;
      } else if (onMajorX || onMajorY) {
        // Primary LA Boulevard (Wilshire, Santa Monica, Fairfax, La Cienega, Highland)
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
        const pulse = 0.40 + 0.50 * h2;
        r = Math.round((warm ? 232 : 188) * pulse);
        g = Math.round((warm ? 176 : 210) * pulse);
        b = Math.round((warm ? 112 : 235) * pulse);
        a = Math.round(156 * pulse);
      } else if (h2 > 0.962 - blockDensity * 0.018) {
        // Commercial neon / window / pool / courtyard jewel sparkle inside blocks
        if (h1 > 0.86) {
          // Cool mercury-vapor / cyan pool / neon sign accent
          r = 148;
          g = 216;
          b = 248;
          a = 185;
        } else if (h1 > 0.72) {
          // Ruby tail-light / neon sign accent
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

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Builds the conformal Los Angeles Basin Night City-Lights Grid (`155 m` to `3,650 m` South, SE, East & SW),
 * draped cleanly above `stahlTerrainSampler.sampleCarvedMeshY(wx, wz)` inside the `1,750 m` terrain extent so
 * `environment.siteGround` never occludes the lights, with `fog: false` and `AdditiveBlending` so it fades to
 * `0` opacity in Daylight and blazes to the horizon at Dusk & Night!
 */
function buildLaBasinCityLightsVista(root: THREE.Group): void {
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

  const gridTileM = 520.0; // Orthogonal N-S & E-W boulevard cadence aligned with X/Z axes

  const sampleBasinElevationY = (wx: number, wz: number): number => {
    const clampedX = Math.max(-1745, Math.min(1745, wx));
    const clampedZ = Math.max(-1745, Math.min(1745, wz));
    const groundY = stahlTerrainSampler.sampleCarvedMeshY(clampedX, clampedZ);
    // Keep 3.4 m clear above siteGround inside [-1750..1750] so coarse far terrain triangles never clip the carpet
    return Math.min(-44.0, groundY + 3.4);
  };

  for (let iz = 0; iz <= nz; iz++) {
    const tz = iz / nz;
    // Concentrate mesh resolution near the 150..900 m foothills transition, stretching out to 3.65 km
    const wz = minZ + Math.pow(tz, 1.35) * (maxZ - minZ);
    for (let ix = 0; ix <= nx; ix++) {
      const tx = ix / nx;
      const wx = minX + tx * (maxX - minX);
      const vIdx = iz * (nx + 1) + ix;

      const dist = Math.hypot(wx, wz);
      const wy = sampleBasinElevationY(wx, wz);

      positions[vIdx * 3] = wx;
      positions[vIdx * 3 + 1] = wy;
      positions[vIdx * 3 + 2] = wz;

      // Exact orthogonal alignment with Koenig's 20' N-S & E-W steel beams!
      uvs[vIdx * 2] = wx / gridTileM;
      uvs[vIdx * 2 + 1] = wz / gridTileM;

      // Mask out the Hollywood Hills promontory & upper canyon ridges (`dist < 165 m` or high elevation `wy > -52 m` or North `wz < 75 m`)
      const foothillsMask =
        smoothstep(155, 285, dist) *
        smoothstep(-48, -62, wy) *
        smoothstep(40, 195, wz - Math.max(0, wx) * 0.18);
      const horizonFade = 1 - smoothstep(2650, 3620, dist);
      const mask = foothillsMask * horizonFade;

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
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const basinGeo = new THREE.BufferGeometry();
  basinGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  basinGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  basinGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  basinGeo.setIndex(indices);
  basinGeo.computeVertexNormals();

  const cityTex = createLaCityGridTexture();
  const cityMat = new THREE.MeshBasicMaterial({
    name: 'stahl.vista.laCityGridMat',
    map: cityTex,
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    opacity: 0, // Synced dynamically by syncStahlCityLightsFromSky (0 in Daylight, 0.82 Dusk, 1.0 Night)
    depthWrite: false,
    fog: false,
  });

  const cityPlane = new THREE.Mesh(prepGeo(basinGeo), cityMat);
  cityPlane.name = 'stahl.vista.laCityGrid';
  cityPlane.renderOrder = 2;
  vistaGroup.add(cityPlane);

  // Curving Sunset Strip arterial light ribbon winding along the base of the Hollywood Hills bluff
  // + orthogonal N-S boulevard light spines & Downtown LA East horizon cluster (merged micro-quads, 0 PointLights!)
  const sparklePositions: number[] = [];
  const sparkleColors: number[] = [];
  const sparkleIndices: number[] = [];

  const pushLightQuad = (
    wx: number,
    wy: number,
    wz: number,
    halfSize: number,
    r: number,
    g: number,
    b: number
  ): void => {
    const base = sparklePositions.length / 3;
    sparklePositions.push(
      wx - halfSize, wy, wz - halfSize,
      wx + halfSize, wy, wz - halfSize,
      wx + halfSize, wy, wz + halfSize,
      wx - halfSize, wy, wz + halfSize,
      wx, wy + halfSize * 0.85, wz
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

  // Sunset Strip winding E-W along the base of the promontory (`Z ~ 215..310 m`)
  for (let i = 0; i < 160; i++) {
    const t = i / 159;
    const wx = -950 + t * 2650;
    const wz = 225 + Math.sin(t * Math.PI * 2.4) * 46 + t * 85;
    const wy = sampleBasinElevationY(wx, wz) + 1.1;
    const h = hash2D(i, 17, 853);
    const sz = 2.2 + h * 2.4;
    const isHeadlight = i % 5 === 0;
    pushLightQuad(
      wx,
      wy,
      wz,
      sz,
      isHeadlight ? 1.0 : 1.0,
      isHeadlight ? 0.94 : 0.74,
      isHeadlight ? 0.82 : 0.36
    );
  }

  // Orthogonal N-S & E-W major boulevard jewels (La Cienega, Fairfax, Crescent Heights, Highland, Santa Monica, Melrose, Wilshire)
  const nsBoulevards = [-780, -520, -260, 0, 260, 520, 780, 1040, 1300, 1560];
  for (let bIdx = 0; bIdx < nsBoulevards.length; bIdx++) {
    const bx = nsBoulevards[bIdx];
    for (let s = 0; s < 38; s++) {
      const wz = 245 + s * 78;
      const wx = bx + (hash2D(bIdx, s, 863) - 0.5) * 3.0;
      const wy = sampleBasinElevationY(wx, wz) + 1.2;
      const sz = 1.9 + (s / 38) * 3.2;
      const white = s % 4 === 0;
      pushLightQuad(wx, wy, wz, sz, 1.0, white ? 0.92 : 0.72, white ? 0.78 : 0.34);
    }
  }

  const ewBoulevards = [390, 650, 910, 1170, 1430, 1820, 2210];
  for (let bIdx = 0; bIdx < ewBoulevards.length; bIdx++) {
    const bz = ewBoulevards[bIdx];
    for (let s = 0; s < 42; s++) {
      const wx = -920 + s * 68;
      const wz = bz + (hash2D(s, bIdx, 877) - 0.5) * 3.0;
      const wy = sampleBasinElevationY(wx, wz) + 1.2;
      const sz = 1.8 + (bz / 2200) * 3.0;
      pushLightQuad(wx, wy, wz, sz, 1.0, 0.76, 0.38);
    }
  }

  // Distant Downtown Los Angeles high-rise skyline cluster on the SE/East horizon (`X ~ 2150..2750, Z ~ 1150..1680`)
  for (let t = 0; t < 56; t++) {
    const h1 = hash2D(t, 1, 887);
    const h2 = hash2D(t, 2, 887);
    const h3 = hash2D(t, 3, 887);
    const wx = 2150 + h1 * 560;
    const wz = 1180 + h2 * 480;
    const baseY = sampleBasinElevationY(wx, wz);
    const towerH = 18 + Math.pow(h3, 1.8) * 68;
    const floors = 3 + Math.floor(h3 * 5);
    for (let f = 1; f <= floors; f++) {
      pushLightQuad(
        wx,
        baseY + (f / floors) * towerH,
        wz,
        3.2 + h1 * 2.2,
        0.98,
        0.86 + h2 * 0.1,
        0.64 + h3 * 0.25
      );
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

  const bindings: readonly CityLightLayerBinding[] = [
    { material: cityMat, maxOpacity: 0.94 },
    { material: jewelMat, maxOpacity: 0.90 },
  ];
  vistaGroup.userData.cityLightBindings = bindings;

  disablePickAndCollision(vistaGroup);
  root.add(vistaGroup);
}

/**
 * Hendrick Van Keppel-Green (VKG) 1960 Case Study House #22 corded tubular-steel sun chaise lounger
 * with square-tube charcoal-bronze frame, multi-band white & persimmon vinyl yacht-cord wrapping,
 * adjustable reclining backrest, `SeatInteractable`, and Smart Asset metadata.
 */
function addVanKeppelChaise(
  ctx: SceneBuilderContext,
  parent: THREE.Object3D,
  options: {
    readonly name: string;
    readonly x: number;
    readonly z: number;
    readonly rotY: number;
    readonly frameMat: THREE.Material;
    readonly cordMat: THREE.Material;
    readonly accentMat: THREE.Material;
    readonly floorY?: number;
  }
): void {
  const { name, x, z, rotY, frameMat, cordMat, accentMat, floorY = -0.01 } = options;
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, floorY, z);
  g.rotation.y = rotY;

  const w = 0.68;
  const seatY = 0.315;
  const tube = 0.024;

  // Square-tube steel side rails, cross stretchers & four vertical legs with rubber glides
  const railL = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(tube, tube, 1.92)), frameMat);
  railL.position.set(-w * 0.5 + tube * 0.5, seatY, 0.02);
  const railR = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(tube, tube, 1.92)), frameMat);
  railR.position.set(w * 0.5 - tube * 0.5, seatY, 0.02);
  railL.castShadow = railR.castShadow = true;
  g.add(railL, railR);

  for (const cz of [-0.92, -0.32, 0.96]) {
    const cross = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(w - 2 * tube - 0.002, tube * 0.88, tube)), frameMat);
    cross.position.set(0, seatY, cz);
    g.add(cross);
  }

  const legH = seatY - tube * 0.5 - 0.001;
  for (const sx of [-w * 0.5 + tube * 0.5, w * 0.5 - tube * 0.5]) {
    for (const sz of [-0.82, 0.84]) {
      const leg = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(tube, legH, tube)), frameMat);
      leg.position.set(sx, legH * 0.5 + 0.0005, sz);
      leg.castShadow = true;
      g.add(leg);
    }
  }

  // Wrapped vinyl yacht-cord seat deck (`Z in [-0.30 .. +0.94]`) — crisp multi-band corded panels
  const seatDeck = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(w - 2 * tube - 0.004, 0.026, 1.21)), cordMat);
  seatDeck.name = `${name}.seatDeck`;
  seatDeck.position.set(0, seatY + 0.004, 0.325);
  seatDeck.castShadow = seatDeck.receiveShadow = true;
  g.add(seatDeck);

  // Subtle transverse vinyl cord ribs proud above seatDeck (`0` coplanar overlap)
  const ribGeo = prepGeo(new THREE.BoxGeometry(w - 2 * tube + 0.002, 0.006, 0.032));
  for (let i = 0; i < 15; i++) {
    const rz = -0.24 + i * 0.082;
    const rib = new THREE.Mesh(ribGeo, i === 1 || i === 2 ? accentMat : cordMat);
    rib.name = `${name}.ropeCord_${i}`;
    rib.position.set(0, seatY + 0.0205, rz);
    g.add(rib);
  }

  // Reclining backrest frame & corded panel (`Z < -0.32`, pitched up at 32°)
  const backPivot = new THREE.Group();
  backPivot.position.set(0, seatY + 0.012, -0.32);
  backPivot.rotation.x = -0.58;

  const backLen = 0.66;
  const bStileL = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(tube * 0.9, tube * 0.9, backLen)), frameMat);
  bStileL.position.set(-w * 0.5 + tube * 0.5, 0, -backLen * 0.5);
  const bStileR = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(tube * 0.9, tube * 0.9, backLen)), frameMat);
  bStileR.position.set(w * 0.5 - tube * 0.5, 0, -backLen * 0.5);
  const bTop = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(w - 2 * tube - 0.002, tube * 0.9, tube * 0.9)), frameMat);
  bTop.position.set(0, 0, -backLen + tube * 0.45);

  const backCord = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(w - 2 * tube - 0.006, 0.024, backLen - 0.05)),
    cordMat
  );
  backCord.name = `${name}.backrest`;
  backCord.position.set(0, 0.002, -backLen * 0.5);
  backCord.castShadow = true;

  // Rolled persimmon-terracotta sun bolster cushion at headrest
  const bolster = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.055, 0.055, w - 0.14, 14)),
    accentMat
  );
  bolster.rotation.z = Math.PI / 2;
  bolster.position.set(0, 0.068, -backLen + 0.13);
  bolster.castShadow = true;

  backPivot.add(bStileL, bStileR, bTop, backCord, bolster);
  g.add(backPivot);

  attachAssetMetadata(g, {
    name: 'Van Keppel-Green Corded Steel Sun Chaise Lounge (1960)',
    brand: 'Van Keppel-Green',
    collection: 'Case Study House #22 Merit Specified',
    sku: 'VKG-CSH22-CHAISE',
    finish: 'Charcoal-Bronze Lacquered Square Steel & White Vinyl Yacht Cord',
    category: 'furniture',
    dimensionsMm: [680, 1940, 740],
    notes: 'Merit-specified by Pierre Koenig for Case Study House #22 (Arts & Architecture, June 1960, p. 30).',
  });

  parent.add(g);

  if (ctx.interactions) {
    ctx.interactions.registerAnimatedInteractable(
      new SeatInteractable({
        id: `${name}.seat`,
        label: 'Recline on Van Keppel-Green Sun Lounger',
        aliases: [name],
        anchor: g,
        clickableTargets: collectSeatClickableMeshes(g),
        localSeatPos: [0, 0.35, 0.12],
        localFootOffset: [0, 0, 1.15],
        localForward: [0, 0, 1],
        material: 'linen',
      })
    );
  }
}

/** Van Keppel-Green corded patio lounge chair with `SeatInteractable` & Smart Asset metadata. */
function addVanKeppelLoungeChair(
  ctx: SceneBuilderContext,
  parent: THREE.Object3D,
  options: {
    readonly name: string;
    readonly x: number;
    readonly z: number;
    readonly rotY: number;
    readonly frameMat: THREE.Material;
    readonly cordMat: THREE.Material;
    readonly floorY?: number;
  }
): void {
  const { name, x, z, rotY, frameMat, cordMat, floorY = -0.01 } = options;
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, floorY, z);
  g.rotation.y = rotY;

  const w = 0.62;
  const d = 0.62;
  const seatY = 0.37;
  const tube = 0.022;

  for (const sx of [-w * 0.5 + tube * 0.5, w * 0.5 - tube * 0.5]) {
    const armH = 0.54;
    const frontLeg = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(tube, armH, tube)), frameMat);
    frontLeg.position.set(sx, armH * 0.5 + 0.0005, d * 0.5 - tube * 0.5);
    const rearLeg = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(tube, armH + 0.22, tube)), frameMat);
    rearLeg.position.set(sx, (armH + 0.22) * 0.5 + 0.0005, -d * 0.5 + tube * 0.5);
    const arm = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(tube, tube * 0.85, d - 2 * tube - 0.002)), frameMat);
    arm.position.set(sx, armH - tube * 0.45, 0);
    const sideRail = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(tube, tube, d - 2 * tube - 0.002)), frameMat);
    sideRail.position.set(sx, seatY, 0);
    frontLeg.castShadow = rearLeg.castShadow = true;
    g.add(frontLeg, rearLeg, arm, sideRail);
  }

  const seat = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(w - 2 * tube - 0.004, 0.028, d - 0.06)), cordMat);
  seat.name = `${name}.seat`;
  seat.position.set(0, seatY + 0.004, 0.01);
  seat.castShadow = seat.receiveShadow = true;

  const back = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(w - 2 * tube - 0.004, 0.29, 0.026)), cordMat);
  back.name = `${name}.back`;
  back.position.set(0, seatY + 0.24, -d * 0.5 + 0.032);
  back.rotation.x = -0.18;
  back.castShadow = true;
  g.add(seat, back);

  attachAssetMetadata(g, {
    name: 'Van Keppel-Green Corded Steel Patio Lounge Chair',
    brand: 'Van Keppel-Green',
    collection: 'Case Study House #22',
    sku: 'VKG-CSH22-CHAIR',
    finish: 'Charcoal-Bronze Steel & White Vinyl Cord',
    category: 'furniture',
    dimensionsMm: [620, 620, 760],
  });

  parent.add(g);

  if (ctx.interactions) {
    ctx.interactions.registerAnimatedInteractable(
      new SeatInteractable({
        id: `${name}.seat`,
        label: 'Sit in Van Keppel-Green Patio Chair',
        aliases: [name],
        anchor: g,
        clickableTargets: collectSeatClickableMeshes(g),
        localSeatPos: [0, 0.40, 0.02],
        localFootOffset: [0, 0, 0.72],
        localForward: [0, 0, 1],
        material: 'linen',
      })
    );
  }
}

/** Van Keppel-Green slatted patio side table styled with iced highballs, sunglasses & folded pool towel. */
function addVkgSideTableWithStyling(
  parent: THREE.Object3D,
  x: number,
  z: number,
  frameMat: THREE.Material,
  topMat: THREE.Material,
  accentMat: THREE.Material,
  glassMat: THREE.Material,
  floorY = -0.01
): void {
  const g = new THREE.Group();
  g.name = 'stahl.patio.vkgSideTable';
  g.position.set(x, floorY, z);

  const w = 0.54;
  const d = 0.54;
  const h = 0.42;
  const tube = 0.02;

  for (const sx of [-w * 0.5 + tube * 0.5, w * 0.5 - tube * 0.5]) {
    for (const sz of [-d * 0.5 + tube * 0.5, d * 0.5 - tube * 0.5]) {
      const leg = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(tube, h - 0.024, tube)), frameMat);
      leg.position.set(sx, (h - 0.024) * 0.5 + 0.0005, sz);
      leg.castShadow = true;
      g.add(leg);
    }
  }

  // Slatted Redwood / White-opal top
  const slatCount = 7;
  const slatW = (w - 0.04) / slatCount - 0.006;
  for (let i = 0; i < slatCount; i++) {
    const sx = -w * 0.5 + 0.02 + slatW * 0.5 + i * (slatW + 0.006);
    const slat = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(slatW, 0.018, d)), topMat);
    slat.position.set(sx, h - 0.009, 0);
    slat.castShadow = slat.receiveShadow = true;
    g.add(slat);
  }

  // Folded striped pool towel
  const towel = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.21, 0.032, 0.27)), accentMat);
  towel.position.set(-0.11, h + 0.017, 0.07);
  towel.rotation.y = 0.12;
  towel.castShadow = true;
  g.add(towel);

  // Pair of iced citrus highball glasses
  const drinkMat = new THREE.MeshStandardMaterial({ color: 0xf2a93b, roughness: 0.18, transparent: true, opacity: 0.85 });
  for (const [gx, gz] of [[0.12, -0.10], [0.16, 0.06]] as const) {
    const tumbler = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.032, 0.028, 0.11, 14)), glassMat);
    tumbler.position.set(gx, h + 0.056, gz);
    const liquid = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.027, 0.024, 0.078, 12)), drinkMat);
    liquid.position.set(gx, h + 0.046, gz);
    g.add(tumbler, liquid);
  }

  // Mid-century tortoiseshell sunglasses
  const frameTortoise = new THREE.MeshStandardMaterial({ color: 0x3b2416, roughness: 0.28 });
  const sgGroup = new THREE.Group();
  sgGroup.position.set(0.05, h + 0.011, -0.16);
  sgGroup.rotation.y = -0.45;
  for (const lx of [-0.032, 0.032]) {
    const rim = new THREE.Mesh(prepGeo(new THREE.TorusGeometry(0.022, 0.004, 8, 16)), frameTortoise);
    rim.rotation.x = Math.PI / 2;
    rim.position.x = lx;
    sgGroup.add(rim);
  }
  const bridge = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.022, 0.004, 0.005)), frameTortoise);
  sgGroup.add(bridge);
  g.add(sgGroup);

  attachAssetMetadata(g, {
    name: 'Van Keppel-Green Slatted Patio Side Table',
    brand: 'Van Keppel-Green',
    collection: 'Case Study House #22',
    sku: 'VKG-CSH22-SIDE',
    finish: 'Charcoal Steel & White Opal Slats',
    category: 'furniture',
    dimensionsMm: [540, 540, 420],
  });

  parent.add(g);
}

/** Architectural Pottery (1960 Merit-Specified) matte-white cylinder / cone planter on walnut/steel cross-stand. */
function addArchitecturalPotteryPlanter(
  parent: THREE.Object3D,
  options: {
    readonly name: string;
    readonly x: number;
    readonly z: number;
    readonly floorY?: number;
    readonly shape: 'cylinder' | 'cone';
    readonly species: 'strelitzia' | 'philodendron' | 'agave';
    readonly ceramicMat: THREE.Material;
    readonly standMat: THREE.Material;
    readonly soilMat: THREE.Material;
    readonly foliageMat: THREE.Material;
    readonly seed: number;
  }
): void {
  const { name, x, z, floorY = -0.01, shape, species, ceramicMat, standMat, soilMat, foliageMat, seed } = options;
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, floorY, z);

  const standH = 0.14;
  const potRTop = shape === 'cone' ? 0.25 : 0.22;
  const potRBot = shape === 'cone' ? 0.13 : 0.21;
  const potH = shape === 'cone' ? 0.36 : 0.38;

  // Walnut / charcoal steel cross-base legs (strictly non-overlapping split bars between inner leg faces!)
  const barW = potRTop * 2 + 0.05;
  const innerSpan = barW - 0.056;
  const bar1 = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(innerSpan, 0.024, 0.024)), standMat);
  bar1.position.set(0, standH * 0.55, 0);
  const halfArm = (innerSpan - 0.028) * 0.5;
  const armCenter = 0.014 + halfArm * 0.5;
  const bar2A = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.024, 0.024, halfArm)), standMat);
  bar2A.position.set(0, standH * 0.55, -armCenter);
  const bar2B = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.024, 0.024, halfArm)), standMat);
  bar2B.position.set(0, standH * 0.55, armCenter);
  g.add(bar1, bar2A, bar2B);

  for (const [lx, lz] of [
    [-barW * 0.5 + 0.013, 0],
    [barW * 0.5 - 0.013, 0],
    [0, -barW * 0.5 + 0.013],
    [0, barW * 0.5 - 0.013],
  ] as const) {
    const leg = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.026, standH + 0.18, 0.026)), standMat);
    leg.position.set(lx, (standH + 0.18) * 0.5 + 0.0005, lz);
    leg.castShadow = true;
    g.add(leg);
  }

  // Matte-white unglazed Architectural Pottery vessel
  const potY = standH + potH * 0.5 - 0.02;
  const vessel = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(potRTop, potRBot, potH, 24)),
    ceramicMat
  );
  vessel.position.y = potY;
  vessel.castShadow = vessel.receiveShadow = true;
  g.add(vessel);

  const soilY = potY + potH * 0.5 + 0.002;
  const soil = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(potRTop - 0.018, potRTop - 0.02, 0.012, 20)),
    soilMat
  );
  soil.position.y = soilY;
  g.add(soil);

  const plantGeo =
    species === 'agave'
      ? buildAgaveAttenuataGeometry()
      : buildTropicalPlanterFoliageGeometry(species, seed);
  const plant = new THREE.Mesh(plantGeo, foliageMat);
  plant.name = `${name}.foliage`;
  plant.position.y = soilY + 0.006;
  plant.rotation.y = (seed % 7) * 0.9;
  if (species === 'agave') {
    plant.scale.setScalar(0.76);
  }
  plant.castShadow = true;
  g.add(plant);

  attachAssetMetadata(g, {
    name: `Architectural Pottery Matte-White ${shape === 'cone' ? 'Conical' : 'Cylinder'} Planter (${
      species === 'strelitzia'
        ? 'Strelitzia nicolai'
        : species === 'philodendron'
          ? 'Split-Leaf Philodendron'
          : 'Agave attenuata'
    })`,
    brand: 'Architectural Pottery',
    collection: 'LaDa / Case Study Merit Specified (1960)',
    sku: shape === 'cone' ? 'AP-CSH22-CONE' : 'AP-CSH22-CYL',
    finish: 'Matte Off-White Bisque Ceramic & Walnut Cross-Stand',
    category: 'decor',
    dimensionsMm: [Math.round(potRTop * 2000), Math.round(potRTop * 2000), Math.round((potH + standH) * 1000)],
  });

  parent.add(g);
}

/**
 * Builds crisp 3D mid-century sans-serif brushed-aluminum house numerals `1 6 3 5`
 * mounted proud on the Woods Drive street-entry corrugated steel pier (`0` coplanar faces).
 */
function buildHouseNumerals1635(mat: THREE.Material): THREE.Group {
  const grp = new THREE.Group();
  grp.name = 'stahl.carport.houseNumbers1635';
  const d = 0.014;
  const stroke = 0.022;
  const h = 0.145;
  const w = 0.086;

  const bar = (bx: number, by: number, bw: number, bh: number): void => {
    const m = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(d, bh, bw)), mat);
    m.position.set(0, by, bx);
    m.castShadow = true;
    grp.add(m);
  };

  // Digit '1' at z = -0.21
  bar(-0.21, 0, stroke, h);
  bar(-0.228, h * 0.5 - stroke * 0.5, stroke * 0.85, stroke);

  // Digit '6' at z = -0.075 (non-overlapping horizontal & vertical segments)
  const z6 = -0.075;
  bar(z6 - w * 0.5 + stroke * 0.5, 0, stroke, h); // left spine
  bar(z6 + stroke * 0.5, h * 0.5 - stroke * 0.5, w - stroke - 0.001, stroke); // top bar
  bar(z6 + stroke * 0.5, -0.006, w - stroke - 0.001, stroke); // mid bar
  bar(z6 + stroke * 0.5, -h * 0.5 + stroke * 0.5, w - stroke - 0.001, stroke); // bottom bar
  bar(z6 + w * 0.5 - stroke * 0.5, -0.006 - (h * 0.5 - 0.006) * 0.5, stroke, h * 0.5 - 2 * stroke - 0.008); // lower right

  // Digit '3' at z = +0.065
  const z3 = 0.065;
  bar(z3 + w * 0.5 - stroke * 0.5, 0, stroke, h); // right spine
  bar(z3 - stroke * 0.5, h * 0.5 - stroke * 0.5, w - stroke - 0.001, stroke); // top
  bar(z3 - stroke * 0.3, 0, w - stroke * 1.4, stroke); // mid
  bar(z3 - stroke * 0.5, -h * 0.5 + stroke * 0.5, w - stroke - 0.001, stroke); // bottom

  // Digit '5' at z = +0.205
  const z5 = 0.205;
  bar(z5, h * 0.5 - stroke * 0.5, w, stroke); // top
  bar(z5 - w * 0.5 + stroke * 0.5, h * 0.25 - 0.002, stroke, h * 0.5 - 2 * stroke - 0.003); // upper left
  bar(z5, 0, w, stroke); // mid
  bar(z5 + w * 0.5 - stroke * 0.5, -h * 0.25 + 0.002, stroke, h * 0.5 - 2 * stroke - 0.003); // lower right
  bar(z5, -h * 0.5 + stroke * 0.5, w, stroke); // bottom

  return grp;
}

/**
 * Sculpts a sleek 1960 Mid-Century California Roadster (inspired by 1960 Corvette C1 / Mercedes 190SL)
 * parked in Bay 1 (North bay) of the 2-car carport, grounded cleanly at `Y = 0.000 m` on the slab:
 * - Sculpted Ermine-White / Silver-Blue cove-scalloped body shell (`Lathe` / lofted cross-sections)
 * - Chrome split bumpers, oval egg-crate front grille, round glass headlamps & ruby tail fins
 * - Wrap-around curved glass windshield with chrome frame & twin cockpit headrests
 * - Saddle-tan leather bucket seats, walnut 3-spoke steering wheel & chrome gear lever
 * - Four whitewall tires with chrome wire-spoke knock-off hubcaps (`0` z-fights!).
 */
function build1960CaliforniaRoadster(
  parent: THREE.Object3D,
  x: number,
  z: number,
  rotY: number,
  chromeMat: THREE.Material,
  glassMat: THREE.Material
): void {
  const car = new THREE.Group();
  car.name = 'stahl.carport.roadster1960';
  car.position.set(x, 0, z);
  car.rotation.y = rotY;

  const paintMat = new THREE.MeshPhysicalMaterial({
    name: 'stahl.roadster.horizonWhitePaint',
    color: 0xeae6dc,
    roughness: 0.22,
    metalness: 0.12,
    clearcoat: 0.85,
    clearcoatRoughness: 0.14,
  });
  const coveAccentMat = new THREE.MeshPhysicalMaterial({
    name: 'stahl.roadster.silverBlueCove',
    color: 0x8da4b5,
    roughness: 0.26,
    metalness: 0.38,
    clearcoat: 0.75,
  });
  const chassisMat = new THREE.MeshStandardMaterial({ color: 0x1a1c1e, roughness: 0.78, metalness: 0.35 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x1e2022, roughness: 0.86 });
  const whitewallMat = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.55 });
  const leatherMat = new THREE.MeshStandardMaterial({ color: 0x8c4724, roughness: 0.52 });
  const headlampMat = new THREE.MeshStandardMaterial({
    color: 0xf4f8ff,
    emissive: new THREE.Color(0xdbe8ff),
    emissiveIntensity: 0.15,
    roughness: 0.12,
  });
  const rubyTailMat = new THREE.MeshStandardMaterial({
    color: 0xb81d18,
    emissive: new THREE.Color(0x7a0d0a),
    emissiveIntensity: 0.2,
    roughness: 0.2,
  });

  // Lofted monocoque roadster body along X (`-2.08 m` rear deck to `+2.12 m` front nose; `+X` = forward!)
  const stations: readonly {
    x: number;
    halfW: number;
    botY: number;
    beltY: number;
    crownY: number;
    cockpitDip: number;
  }[] = [
    { x: -2.08, halfW: 0.62, botY: 0.30, beltY: 0.64, crownY: 0.68, cockpitDip: 0 },
    { x: -1.82, halfW: 0.77, botY: 0.24, beltY: 0.72, crownY: 0.77, cockpitDip: 0 },
    { x: -1.32, halfW: 0.83, botY: 0.21, beltY: 0.76, crownY: 0.80, cockpitDip: 0 },
    { x: -0.78, halfW: 0.82, botY: 0.20, beltY: 0.75, crownY: 0.77, cockpitDip: 0.24 },
    { x: -0.15, halfW: 0.81, botY: 0.20, beltY: 0.74, crownY: 0.75, cockpitDip: 0.28 },
    { x: 0.38, halfW: 0.82, botY: 0.20, beltY: 0.77, crownY: 0.81, cockpitDip: 0.05 },
    { x: 0.96, halfW: 0.84, botY: 0.21, beltY: 0.79, crownY: 0.84, cockpitDip: 0 },
    { x: 1.54, halfW: 0.81, botY: 0.22, beltY: 0.75, crownY: 0.80, cockpitDip: 0 },
    { x: 1.98, halfW: 0.72, botY: 0.26, beltY: 0.66, crownY: 0.71, cockpitDip: 0 },
    { x: 2.12, halfW: 0.56, botY: 0.31, beltY: 0.56, crownY: 0.60, cockpitDip: 0 },
  ];

  // Cross-section profile parameter `u in [0..12]` around the closed loop (bottom-center -> right rocker -> right fender -> top deck -> left fender -> left rocker -> bottom-center)
  const ringPts = 12;
  const bodyPos: number[] = [];
  const bodyIdx: number[] = [];

  for (let s = 0; s < stations.length; s++) {
    const st = stations[s];
    for (let k = 0; k < ringPts; k++) {
      const ang = (k / ringPts) * Math.PI * 2; // 0 = bottom, pi/2 = +Z right, pi = top, 3pi/2 = -Z left
      const sinA = Math.sin(ang);
      const cosA = -Math.cos(ang); // -1 at bottom, +1 at top

      let pz = sinA * st.halfW;
      let py: number;
      if (cosA < -0.35) {
        py = st.botY;
        pz *= 0.82;
      } else if (cosA < 0.35) {
        const tSide = (cosA + 0.35) / 0.70;
        py = st.botY + tSide * (st.beltY - st.botY);
        // Sculpted fender swell
        pz = Math.sign(sinA) * st.halfW * (0.94 + Math.sin(tSide * Math.PI) * 0.08);
      } else {
        const tTop = (cosA - 0.35) / 0.65;
        const centerFactor = 1 - Math.abs(sinA);
        py = st.beltY + tTop * (st.crownY - st.beltY) - st.cockpitDip * centerFactor;
      }
      bodyPos.push(st.x, py, pz);
    }
  }

  // End caps at rear (`s = 0`) and front (`s = stations.length - 1`)
  const rearCenterIdx = bodyPos.length / 3;
  bodyPos.push(stations[0].x - 0.02, 0.50, 0);
  const frontCenterIdx = bodyPos.length / 3;
  bodyPos.push(stations[stations.length - 1].x + 0.02, 0.46, 0);

  for (let s = 0; s < stations.length - 1; s++) {
    const r0 = s * ringPts;
    const r1 = (s + 1) * ringPts;
    for (let k = 0; k < ringPts; k++) {
      const kn = (k + 1) % ringPts;
      bodyIdx.push(r0 + k, r1 + k, r0 + kn, r0 + kn, r1 + k, r1 + kn);
    }
  }
  for (let k = 0; k < ringPts; k++) {
    const kn = (k + 1) % ringPts;
    bodyIdx.push(rearCenterIdx, k, kn);
    const fBase = (stations.length - 1) * ringPts;
    bodyIdx.push(frontCenterIdx, fBase + kn, fBase + k);
  }

  const bodyGeo = new THREE.BufferGeometry();
  bodyGeo.setAttribute('position', new THREE.Float32BufferAttribute(bodyPos, 3));
  bodyGeo.setIndex(bodyIdx);
  bodyGeo.computeVertexNormals();

  const bodyShell = new THREE.Mesh(prepGeo(bodyGeo), paintMat);
  bodyShell.name = 'stahl.carport.roadster1960.body';
  bodyShell.castShadow = bodyShell.receiveShadow = true;
  car.add(bodyShell);

  // Signature Corvette-inspired silver-blue side coves & chrome moulding spears (`0` coplanar faces — proud by 8 mm)
  for (const side of [-1, 1] as const) {
    const cove = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(1.38, 0.21, 0.022)), coveAccentMat);
    cove.position.set(0.72, 0.50, side * 0.852);
    const spear = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.008, 0.005, 1.55, 8)), chromeMat);
    spear.rotation.z = Math.PI / 2;
    spear.position.set(0.66, 0.50, side * 0.868);
    car.add(cove, spear);
  }

  // Dark underbody chassis pan
  const underPan = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(3.45, 0.06, 1.24)), chassisMat);
  underPan.position.set(0.0, 0.175, 0);
  car.add(underPan);

  // Open-top saddle-tan leather cockpit tub, twin bucket seats & walnut steering wheel
  const cockpitFloor = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(1.12, 0.04, 1.18)), chassisMat);
  cockpitFloor.position.set(-0.34, 0.44, 0);
  car.add(cockpitFloor);

  for (const sz of [-0.34, 0.34] as const) {
    const cushion = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.46, 0.10, 0.44)), leatherMat);
    cushion.position.set(-0.42, 0.515, sz);
    const seatBack = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.11, 0.42, 0.42)), leatherMat);
    seatBack.position.set(-0.66, 0.68, sz);
    seatBack.rotation.z = 0.20;
    const fairing = new THREE.Mesh(prepGeo(new THREE.ConeGeometry(0.13, 0.46, 12)), paintMat);
    fairing.rotation.z = Math.PI / 2;
    fairing.position.set(-0.98, 0.79, sz);
    cushion.castShadow = seatBack.castShadow = true;
    car.add(cushion, seatBack, fairing);
  }

  // Steering wheel on left-hand drive (`z = -0.34`, since facing `+X` means `-Z` is driver's left!)
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x5c361d, roughness: 0.38 });
  const steerCol = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.016, 0.016, 0.34, 10)), chromeMat);
  steerCol.position.set(0.06, 0.69, -0.34);
  steerCol.rotation.z = 0.95;
  const steerRim = new THREE.Mesh(prepGeo(new THREE.TorusGeometry(0.155, 0.013, 10, 22)), wheelMat);
  steerRim.position.set(-0.08, 0.78, -0.34);
  steerRim.rotation.y = Math.PI / 2;
  steerRim.rotation.x = 0.62;
  const shifter = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.007, 0.007, 0.18, 8)), chromeMat);
  shifter.position.set(-0.18, 0.58, 0);
  car.add(steerCol, steerRim, shifter);

  // Wrap-around curved mid-century glass windshield & chrome header bow
  const wsArc = new THREE.CylinderGeometry(0.68, 0.72, 0.33, 24, 1, true, -Math.PI * 0.42, Math.PI * 0.84);
  const wsGlass = new THREE.Mesh(prepGeo(wsArc), glassMat);
  wsGlass.position.set(-0.22, 0.91, 0);
  wsGlass.rotation.y = Math.PI / 2;
  wsGlass.rotation.z = -0.36;
  const wsBow = new THREE.Mesh(
    prepGeo(new THREE.TorusGeometry(0.685, 0.012, 8, 24, Math.PI * 0.84)),
    chromeMat
  );
  wsBow.position.set(-0.28, 1.055, 0);
  wsBow.rotation.x = Math.PI / 2;
  wsBow.rotation.z = -Math.PI * 0.42;
  wsBow.rotation.y = 0.36;
  car.add(wsGlass, wsBow);

  // Front chrome egg-crate grille, split bumperettes & quad/dual round glass headlamps
  const grilleRim = new THREE.Mesh(prepGeo(new THREE.TorusGeometry(0.24, 0.022, 10, 24)), chromeMat);
  grilleRim.scale.set(1.85, 0.62, 1);
  grilleRim.rotation.y = Math.PI / 2;
  grilleRim.position.set(2.135, 0.44, 0);
  car.add(grilleRim);

  for (let t = -5; t <= 5; t++) {
    const tooth = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.022, 0.19, 0.012)), chromeMat);
    tooth.position.set(2.13, 0.44, t * 0.068);
    car.add(tooth);
  }

  for (const side of [-1, 1] as const) {
    // Round chrome headlamp bezel + glowing glass lens
    const bezel = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.105, 0.112, 0.07, 18)), chromeMat);
    bezel.rotation.z = Math.PI / 2;
    bezel.position.set(2.04, 0.63, side * 0.56);
    const lens = new THREE.Mesh(prepGeo(new THREE.SphereGeometry(0.092, 16, 12)), headlampMat);
    lens.scale.set(0.45, 1, 1);
    lens.position.set(2.08, 0.63, side * 0.56);

    // Front & rear chrome bumperettes
    const fBumper = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.036, 0.036, 0.44, 12)), chromeMat);
    fBumper.rotation.x = Math.PI / 2;
    fBumper.position.set(2.17, 0.32, side * 0.50);

    const rBumper = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.038, 0.038, 0.48, 12)), chromeMat);
    rBumper.rotation.x = Math.PI / 2;
    rBumper.position.set(-2.12, 0.34, side * 0.48);

    // Ruby bullet tail lamps & twin chrome exhaust tips
    const tailBezel = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.056, 0.062, 0.06, 14)), chromeMat);
    tailBezel.rotation.z = Math.PI / 2;
    tailBezel.position.set(-2.06, 0.60, side * 0.58);
    const tailLens = new THREE.Mesh(prepGeo(new THREE.ConeGeometry(0.048, 0.08, 14)), rubyTailMat);
    tailLens.rotation.z = Math.PI / 2;
    tailLens.position.set(-2.11, 0.60, side * 0.58);

    const exhaust = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.024, 0.024, 0.14, 10)), chromeMat);
    exhaust.rotation.z = Math.PI / 2;
    exhaust.position.set(-2.11, 0.24, side * 0.36);

    car.add(bezel, lens, fBumper, rBumper, tailBezel, tailLens, exhaust);
  }

  // Four grounded whitewall tires (`wheelR = 0.33 m`, bottom cleanly at `Y = 0.000 m`)
  const wheelR = 0.33;
  const wheelW = 0.20;
  const axles: readonly [number, number][] = [
    [1.30, -0.78],
    [1.30, 0.78],
    [-1.28, -0.78],
    [-1.28, 0.78],
  ];
  for (const [wx, wz] of axles) {
    const outSign = Math.sign(wz);
    const wGrp = new THREE.Group();
    wGrp.position.set(wx, wheelR, wz);

    const tire = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(wheelR, wheelR, wheelW, 24)), tireMat);
    tire.rotation.x = Math.PI / 2;
    tire.castShadow = true;

    const whitewall = new THREE.Mesh(
      prepGeo(new THREE.RingGeometry(0.185, 0.268, 24)),
      whitewallMat
    );
    whitewall.position.z = outSign * (wheelW * 0.5 + 0.0015);
    if (outSign < 0) whitewall.rotation.y = Math.PI;

    const hubcap = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.175, 0.185, 0.032, 20)), chromeMat);
    hubcap.rotation.x = Math.PI / 2;
    hubcap.position.z = outSign * (wheelW * 0.5 - 0.004);

    const spinner = new THREE.Mesh(prepGeo(new THREE.ConeGeometry(0.045, 0.065, 12)), chromeMat);
    spinner.rotation.x = outSign > 0 ? Math.PI / 2 : -Math.PI / 2;
    spinner.position.z = outSign * (wheelW * 0.5 + 0.032);

    wGrp.add(tire, whitewall, hubcap, spinner);
    car.add(wGrp);
  }

  attachAssetMetadata(car, {
    name: '1960 California Two-Seat Roadster (Ermine White / Silver-Blue Cove)',
    brand: 'Chevrolet / Case Study Period Classic',
    collection: '1960 Hollywood Hills Arrival',
    sku: 'CSH22-1960-ROADSTER',
    finish: 'Ermine White & Silver-Blue Lacquer with Saddle Leather & Whitewalls',
    category: 'vehicle',
    dimensionsMm: [4260, 1740, 1180],
    notes: 'Parked in North Bay 1 of Pierre Koenig’s sheltered 2-car carport off 1635 Woods Drive.',
  });

  parent.add(car);
}

/**
 * Builds the iconic painted off-white (`#EAE6DC`) `42"` (`1.00 m`) 2-rail tubular steel pipe safety
 * guardrail wrapping:
 * 1) The cantilevered East & South Living/Dining perimeter maintenance catwalk, bolted via steel
 *    stanchion brackets to the catwalk fascia (`0` coplanar faces!),
 * 2) The South & West pool-terrace cliff edges above the 240 m Hollywood Hills drop-off.
 */
function buildPerimeterPipeSafetyRailing(root: THREE.Group, steelBracketMat: THREE.Material): void {
  const railGroup = new THREE.Group();
  railGroup.name = 'stahl.balustrade.perimeterPipeRail';

  const pipeMat = new THREE.MeshStandardMaterial({
    name: 'stahl.balustrade.offWhitePipe',
    color: 0xece8de,
    roughness: 0.42,
    metalness: 0.24,
  });

  const pipeR = 0.019; // 38 mm (1.5") OD round steel pipe
  const jointR = 0.0235;

  const addHorizontalPipeRun = (x1: number, z1: number, x2: number, z2: number, y: number): void => {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const fullLen = Math.hypot(dx, dz);
    const trimLen = Math.max(0.05, fullLen - jointR * 1.4);
    const pipe = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(pipeR, pipeR, trimLen, 12)), pipeMat);
    pipe.position.set((x1 + x2) * 0.5, y, (z1 + z2) * 0.5);
    const dir = new THREE.Vector3(dx, 0, dz).normalize();
    pipe.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    pipe.castShadow = true;
    railGroup.add(pipe);
  };

  const addCornerElbow = (x: number, y: number, z: number): void => {
    const elbow = new THREE.Mesh(prepGeo(new THREE.SphereGeometry(jointR, 12, 10)), pipeMat);
    elbow.position.set(x, y, z);
    railGroup.add(elbow);
  };

  // --- 1. East & South Cantilevered Catwalk Guardrail ---
  // Catwalk outer fascia outer face is at `X4 + 0.585 + 0.024 = 6.705` (East) and `Z3 + 0.609 = 12.801` (South).
  // Mount stanchion centerlines 38 mm outboard (`eastRailX = 6.743`, `southRailZ = 12.839`) on steel L-brackets!
  const slatCount = 6;
  const slatW = 0.056;
  const innerOffset = 0.085;
  const slatPitch = (CATWALK_WIDTH_M - 0.04) / (slatCount - 1);
  const outerEdgeX = X4 + innerOffset + (slatCount - 1) * slatPitch + slatW * 0.5;
  const outerEdgeZ = Z3 + innerOffset + (slatCount - 1) * slatPitch + slatW * 0.5;
  const fasciaOuterX = outerEdgeX + 0.024;
  const fasciaOuterZ = outerEdgeZ + 0.024;

  const eastRailX = fasciaOuterX + 0.038;
  const southRailZ = fasciaOuterZ + 0.038;
  const catTopY = 0.99;
  const catMidY = 0.49;
  const catBotY = -0.085;
  const eastStartZ = Z0 - 0.08;
  const southStartX = X3 - 0.38;

  addHorizontalPipeRun(eastRailX, eastStartZ, eastRailX, southRailZ, catTopY);
  addHorizontalPipeRun(eastRailX, eastStartZ, eastRailX, southRailZ, catMidY);
  addHorizontalPipeRun(southStartX, southRailZ, eastRailX, southRailZ, catTopY);
  addHorizontalPipeRun(southStartX, southRailZ, eastRailX, southRailZ, catMidY);

  for (const ry of [catTopY, catMidY]) {
    addCornerElbow(eastRailX, ry, eastStartZ);
    addCornerElbow(eastRailX, ry, southRailZ);
    addCornerElbow(southStartX, ry, southRailZ);
  }

  const postH = catTopY - catBotY - 0.004;
  const postGeo = prepGeo(new THREE.CylinderGeometry(pipeR * 0.94, pipeR * 0.94, postH, 10));
  const bracketGeoEW = prepGeo(new THREE.BoxGeometry(0.034, 0.048, 0.036));
  const bracketGeoNS = prepGeo(new THREE.BoxGeometry(0.036, 0.048, 0.034));

  const eastPostsZ = [eastStartZ, Z0 + 1.95, Z1, Z1 + 2.03, Z1 + 4.06, Z2, Z2 + 2.03, Z2 + 4.06, Z3, southRailZ];
  for (const pz of eastPostsZ) {
    const post = new THREE.Mesh(postGeo, pipeMat);
    post.position.set(eastRailX, (catTopY + catBotY) * 0.5, pz);
    post.castShadow = true;
    railGroup.add(post);
    if (pz <= outerEdgeZ) {
      const brk = new THREE.Mesh(bracketGeoEW, steelBracketMat);
      brk.position.set(fasciaOuterX + 0.019, -0.056, pz);
      railGroup.add(brk);
    }
  }

  const southPostsX = [southStartX, X3 + 1.35, (X3 + X4) * 0.5, X4 - 1.35, X4];
  for (const px of southPostsX) {
    const post = new THREE.Mesh(postGeo, pipeMat);
    post.position.set(px, (catTopY + catBotY) * 0.5, southRailZ);
    post.castShadow = true;
    railGroup.add(post);
    const brk = new THREE.Mesh(bracketGeoNS, steelBracketMat);
    brk.position.set(px, -0.056, fasciaOuterZ + 0.019);
    railGroup.add(brk);
  }

  // --- 2. South & West Pool Terrace Cliff Perimeter Guardrail ---
  // Terrace deck top is at `Y = -0.010 m` (`X in [-13.75 .. -0.002]`, `Z in [0.002 .. 9.55]`).
  // Mount stanchion base flanges at `Y = -0.0085 m` along `Z = 9.44` (South cliff) & `X = -13.64` (West canyon).
  const poolRailSouthZ = 9.44;
  const poolRailWestX = -13.64;
  const poolRailEastX = -0.44; // Stops cleanly west of Living glass wall (`X3 = 0`)
  const poolRailNorthZ = 0.24; // Stops cleanly south of private wing (`Z1 = 0`)
  const deckBaseY = -0.0085;
  const deckTopY = 0.98;
  const deckMidY = 0.48;

  addHorizontalPipeRun(poolRailWestX, poolRailSouthZ, poolRailEastX, poolRailSouthZ, deckTopY);
  addHorizontalPipeRun(poolRailWestX, poolRailSouthZ, poolRailEastX, poolRailSouthZ, deckMidY);
  addHorizontalPipeRun(poolRailWestX, poolRailNorthZ, poolRailWestX, poolRailSouthZ, deckTopY);
  addHorizontalPipeRun(poolRailWestX, poolRailNorthZ, poolRailWestX, poolRailSouthZ, deckMidY);

  for (const ry of [deckTopY, deckMidY]) {
    addCornerElbow(poolRailWestX, ry, poolRailSouthZ);
    addCornerElbow(poolRailEastX, ry, poolRailSouthZ);
    addCornerElbow(poolRailWestX, ry, poolRailNorthZ);
  }

  const deckPostH = deckTopY - deckBaseY - 0.008;
  const deckPostGeo = prepGeo(new THREE.CylinderGeometry(pipeR * 0.94, pipeR * 0.94, deckPostH, 10));
  const flangeGeo = prepGeo(new THREE.CylinderGeometry(0.048, 0.052, 0.012, 12));

  const addDeckStanchion = (px: number, pz: number): void => {
    const post = new THREE.Mesh(deckPostGeo, pipeMat);
    post.position.set(px, deckBaseY + 0.006 + deckPostH * 0.5, pz);
    post.castShadow = true;
    const flange = new THREE.Mesh(flangeGeo, pipeMat);
    flange.position.set(px, deckBaseY + 0.006, pz);
    railGroup.add(post, flange);
  };

  for (let i = 0; i <= 7; i++) {
    const px = poolRailWestX + (i / 7) * (poolRailEastX - poolRailWestX);
    addDeckStanchion(px, poolRailSouthZ);
  }
  for (let j = 0; j < 5; j++) {
    const pz = poolRailNorthZ + (j / 5) * (poolRailSouthZ - poolRailNorthZ);
    addDeckStanchion(poolRailWestX, pz);
  }

  root.add(railGroup);
}

/** Merges multiple transformed instances of a base BufferGeometry into one single-draw-call BufferGeometry. */
function bakeMergedInstances(
  baseGeo: THREE.BufferGeometry,
  matrices: readonly THREE.Matrix4[],
  tints?: readonly THREE.Color[]
): THREE.BufferGeometry {
  const srcPos = baseGeo.attributes.position as THREE.BufferAttribute;
  const srcNorm = baseGeo.attributes.normal as THREE.BufferAttribute | undefined;
  const srcCol = baseGeo.attributes.color as THREE.BufferAttribute | undefined;
  const srcIdx = baseGeo.index;

  const vCount = srcPos.count;
  const iCount = srcIdx ? srcIdx.count : vCount;
  const totalV = vCount * matrices.length;
  const totalI = iCount * matrices.length;

  const outPos = new Float32Array(totalV * 3);
  const outNorm = new Float32Array(totalV * 3);
  const outCol = new Float32Array(totalV * 3);
  const outIdx = totalV > 65535 ? new Uint32Array(totalI) : new Uint16Array(totalI);

  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const normalMat = new THREE.Matrix3();

  for (let m = 0; m < matrices.length; m++) {
    const mat = matrices[m];
    normalMat.getNormalMatrix(mat);
    const tint = tints ? tints[m] : undefined;
    const vBase = m * vCount;

    for (let i = 0; i < vCount; i++) {
      v.fromBufferAttribute(srcPos, i).applyMatrix4(mat);
      outPos[(vBase + i) * 3] = v.x;
      outPos[(vBase + i) * 3 + 1] = v.y;
      outPos[(vBase + i) * 3 + 2] = v.z;

      if (srcNorm) {
        n.fromBufferAttribute(srcNorm, i).applyMatrix3(normalMat).normalize();
      } else {
        n.set(0, 1, 0);
      }
      outNorm[(vBase + i) * 3] = n.x;
      outNorm[(vBase + i) * 3 + 1] = n.y;
      outNorm[(vBase + i) * 3 + 2] = n.z;

      const cr = srcCol ? srcCol.getX(i) : 1;
      const cg = srcCol ? srcCol.getY(i) : 1;
      const cb = srcCol ? srcCol.getZ(i) : 1;
      outCol[(vBase + i) * 3] = Math.min(1, cr * (tint ? tint.r : 1));
      outCol[(vBase + i) * 3 + 1] = Math.min(1, cg * (tint ? tint.g : 1));
      outCol[(vBase + i) * 3 + 2] = Math.min(1, cb * (tint ? tint.b : 1));
    }

    const iBase = m * iCount;
    if (srcIdx) {
      for (let k = 0; k < iCount; k++) {
        outIdx[iBase + k] = vBase + srcIdx.getX(k);
      }
    } else {
      for (let k = 0; k < iCount; k++) {
        outIdx[iBase + k] = vBase + k;
      }
    }
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(outPos, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(outNorm, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(outCol, 3));
  merged.setIndex(new THREE.BufferAttribute(outIdx, 1));
  return prepGeo(merged);
}

function buildStahlCliffOutcropsAndChaparral(root: THREE.Group): void {
  const cliffGroup = new THREE.Group();
  cliffGroup.name = 'stahl.cliffEscarpment';

  const rockMat = createDecomposedGraniteRockMaterial();

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
    { x: 5.75, z: 12.15, yLift: 0.15, rx: 1.45, ry: 1.50, rz: 1.35, rotX: 0.26, rotY: -0.35, rotZ: -0.24, seed: 107 },
    { x: 3.55, z: 11.75, yLift: 0.08, rx: 1.60, ry: 1.35, rz: 1.45, rotX: 0.28, rotY: 0.18, rotZ: -0.08, seed: 113 },
    { x: 1.45, z: 11.55, yLift: 0.05, rx: 1.65, ry: 1.30, rz: 1.40, rotX: 0.30, rotY: -0.28, rotZ: 0.06, seed: 127 },
    { x: -1.15, z: 11.35, yLift: 0.02, rx: 1.70, ry: 1.25, rz: 1.45, rotX: 0.24, rotY: 0.51, rotZ: 0.09, seed: 131 },
    { x: -4.20, z: 11.20, yLift: -0.04, rx: 1.80, ry: 1.20, rz: 1.50, rotX: 0.20, rotY: -0.44, rotZ: -0.07, seed: 137 },
    { x: 5.25, z: 8.15, yLift: 0.10, rx: 1.40, ry: 1.40, rz: 1.65, rotX: 0.08, rotY: 0.64, rotZ: -0.32, seed: 149 },
    { x: 5.15, z: 4.65, yLift: 0.08, rx: 1.35, ry: 1.35, rz: 1.70, rotX: -0.06, rotY: 0.29, rotZ: -0.34, seed: 157 },
    { x: 5.05, z: 1.35, yLift: 0.04, rx: 1.35, ry: 1.30, rz: 1.55, rotX: -0.09, rotY: -0.52, rotZ: -0.28, seed: 163 },
    { x: 7.25, z: 13.45, yLift: -0.12, rx: 1.75, ry: 1.25, rz: 1.65, rotX: 0.26, rotY: 0.77, rotZ: -0.30, seed: 173 },
    { x: 7.65, z: 9.45, yLift: -0.15, rx: 1.65, ry: 1.20, rz: 1.80, rotX: 0.11, rotY: -0.61, rotZ: -0.34, seed: 181 },
    { x: 7.95, z: 4.85, yLift: -0.16, rx: 1.60, ry: 1.15, rz: 1.75, rotX: -0.05, rotY: 0.38, rotZ: -0.32, seed: 191 },
    { x: 8.35, z: 0.25, yLift: -0.18, rx: 1.55, ry: 1.15, rz: 1.60, rotX: -0.12, rotY: 0.94, rotZ: -0.26, seed: 197 },
    { x: 4.65, z: 14.65, yLift: -0.15, rx: 1.80, ry: 1.20, rz: 1.60, rotX: 0.32, rotY: -0.19, rotZ: -0.12, seed: 211 },
    { x: 0.85, z: 14.75, yLift: -0.18, rx: 1.85, ry: 1.15, rz: 1.55, rotX: 0.30, rotY: 0.43, rotZ: 0.08, seed: 223 },
    { x: 9.8, z: 15.4, yLift: -0.22, rx: 2.05, ry: 1.35, rz: 1.95, rotX: 0.28, rotY: 0.62, rotZ: -0.26, seed: 229 },
  ];

  const outcropsGroup = new THREE.Group();
  outcropsGroup.name = 'stahl.cliffOutcrops';
  for (let i = 0; i < outcropSpecs.length; i++) {
    const spec = outcropSpecs[i];
    const geo = createCraggyOutcropGeometry(spec.rx, spec.ry, spec.rz, spec.seed, 3);
    geo.computeBoundingBox();
    const localMaxY = geo.boundingBox ? geo.boundingBox.max.y : spec.ry;

    const terrainY = stahlTerrainSampler.sampleTerrainY(spec.x, spec.z);
    let safeCeil = maxCliffStructuralCeilingY(spec.x, spec.z);
    for (const dx of [-spec.rx * 0.75, 0, spec.rx * 0.75]) {
      for (const dz of [-spec.rz * 0.75, 0, spec.rz * 0.75]) {
        safeCeil = Math.min(safeCeil, maxCliffStructuralCeilingY(spec.x + dx, spec.z + dz));
      }
    }
    const centerY = Math.min(terrainY + spec.yLift, safeCeil - localMaxY - 0.08);

    const rockMesh = new THREE.Mesh(geo, rockMat);
    rockMesh.name = `stahl.cliffOutcrop.${i}`;
    rockMesh.position.set(spec.x, centerY, spec.z);
    rockMesh.rotation.set(spec.rotX, spec.rotY, spec.rotZ);
    rockMesh.castShadow = true;
    rockMesh.receiveShadow = true;
    outcropsGroup.add(rockMesh);
  }
  cliffGroup.add(outcropsGroup);

  const noseGroup = new THREE.Group();
  noseGroup.name = 'stahl.promontoryGravelNose';

  const noseButtressGeo = createCraggyOutcropGeometry(1.75, 1.85, 2.25, 509, 3);
  const noseButtressY = stahlTerrainSampler.sampleTerrainY(7.85, -2.95) - 1.32;
  const noseButtress = new THREE.Mesh(noseButtressGeo, rockMat);
  noseButtress.name = 'stahl.promontoryGravelNose.buttress';
  noseButtress.position.set(7.85, noseButtressY, -2.95);
  noseButtress.rotation.set(0.08, 0.24, -0.22);
  noseButtress.castShadow = true;
  noseButtress.receiveShadow = true;
  noseGroup.add(noseButtress);

  const cribMat = new THREE.MeshStandardMaterial({
    name: 'stahl.sandstoneCribbing',
    map: rockMat.map,
    normalMap: rockMat.normalMap,
    normalScale: new THREE.Vector2(0.55, 0.55),
    color: 0xb79f80,
    roughness: 0.93,
  });
  const cribSpecs: readonly { x: number; z: number; tier: number; w: number; h: number; d: number; rotY: number }[] = [
    { x: 7.22, z: -1.52, tier: 0, w: 0.48, h: 0.14, d: 0.34, rotY: 0.14 },
    { x: 7.72, z: -1.66, tier: 0, w: 0.48, h: 0.14, d: 0.34, rotY: 0.25 },
    { x: 8.20, z: -1.88, tier: 0, w: 0.46, h: 0.14, d: 0.34, rotY: 0.38 },
    { x: 7.42, z: -1.42, tier: 1, w: 0.52, h: 0.15, d: 0.38, rotY: 0.18 },
    { x: 7.94, z: -1.58, tier: 1, w: 0.52, h: 0.15, d: 0.38, rotY: 0.30 },
    { x: 8.40, z: -1.84, tier: 1, w: 0.48, h: 0.15, d: 0.38, rotY: 0.44 },
    { x: 7.64, z: -1.34, tier: 2, w: 0.56, h: 0.16, d: 0.42, rotY: 0.22 },
    { x: 8.18, z: -1.52, tier: 2, w: 0.54, h: 0.16, d: 0.42, rotY: 0.35 },
  ];
  for (let i = 0; i < cribSpecs.length; i++) {
    const c = cribSpecs[i];
    const rimGroundY = stahlTerrainSampler.sampleTerrainY(Math.min(c.x, 8.25), Math.min(c.z, -1.62));
    const cy = rimGroundY - 0.04 - c.tier * 0.152;
    const block = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(c.w, c.h, c.d)), cribMat);
    block.position.set(c.x, cy, c.z);
    block.rotation.y = c.rotY;
    block.castShadow = block.receiveShadow = true;
    noseGroup.add(block);
  }

  const agaveGeo = buildAgaveAttenuataGeometry();
  const agaveMat = new THREE.MeshStandardMaterial({
    name: 'stahl.agaveAttenuata',
    vertexColors: true,
    roughness: 0.68,
    metalness: 0.0,
  });
  const agavePlacements: readonly { x: number; z: number; scale: number; rotY: number }[] = [
    { x: 7.38, z: -2.18, scale: 1.18, rotY: 0.4 },
    { x: 7.88, z: -2.68, scale: 0.88, rotY: 1.9 },
    { x: 7.22, z: -2.42, scale: 0.76, rotY: 3.5 },
    { x: 7.82, z: -4.25, scale: 0.96, rotY: 2.6 },
  ];
  const dummy = new THREE.Object3D();
  const agaveMats: THREE.Matrix4[] = [];
  for (let i = 0; i < agavePlacements.length; i++) {
    const p = agavePlacements[i];
    const py = stahlTerrainSampler.sampleTerrainY(p.x, p.z) - 0.02;
    dummy.position.set(p.x, py, p.z);
    dummy.rotation.set(0.03 * (i % 3), p.rotY, -0.04);
    dummy.scale.setScalar(p.scale);
    dummy.updateMatrix();
    agaveMats.push(dummy.matrix.clone());
  }
  const agaveMesh = new THREE.Mesh(bakeMergedInstances(agaveGeo, agaveMats), agaveMat);
  agaveMesh.name = 'stahl.chaparral.agaveRosettes';
  agaveMesh.castShadow = agaveMesh.receiveShadow = true;
  noseGroup.add(agaveMesh);
  cliffGroup.add(noseGroup);

  const deergrassGeo = buildDeergrassClumpGeometry(22, 701);
  const deergrassMat = new THREE.MeshStandardMaterial({
    name: 'stahl.chaparral.deergrassMat',
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.88,
    metalness: 0.0,
  });

  const tussockCoords: [number, number, number][] = [];
  const cliffRimSeeds: readonly [number, number][] = [
    [6.95, -1.05], [7.55, -0.45], [8.25, 0.35], [6.85, 1.15], [7.65, 2.05],
    [8.65, 2.85], [6.75, 3.45], [7.45, 4.35], [8.55, 5.15], [6.80, 5.95],
    [7.55, 6.85], [8.85, 7.55], [6.65, 8.25], [7.35, 9.15], [8.45, 9.95],
    [6.75, 10.65], [7.45, 11.45], [8.65, 11.95], [6.85, 12.65], [7.75, 13.25],
    [9.45, 1.45], [9.85, 3.85], [10.15, 6.45], [9.95, 8.95], [9.75, 11.35],
    [11.2, 2.6], [11.6, 5.5], [11.4, 8.4], [11.1, 11.6], [10.4, 13.9],
    [5.85, 13.05], [4.95, 13.25], [3.95, 12.95], [2.85, 13.15], [1.75, 12.95],
    [0.55, 13.10], [-0.75, 12.85], [-2.15, 12.45], [-3.65, 11.85], [-5.25, 11.45],
    [-6.95, 11.25], [-8.65, 11.35], [-10.2, 11.6],
    [6.35, 14.35], [4.85, 14.65], [3.25, 14.45], [1.55, 14.75], [-0.35, 14.55],
    [-2.45, 14.35], [-4.65, 14.15], [-6.85, 14.25], [-9.15, 14.55],
    [8.25, 15.65], [6.15, 16.45], [3.85, 16.85], [1.25, 16.95], [-1.65, 16.75],
    [-4.35, 16.65], [-7.25, 16.85], [9.85, 17.85], [5.25, 19.25], [0.45, 19.45],
    [6.15, 7.35], [6.25, 9.65], [6.10, 11.15], [4.45, 12.55], [2.35, 12.45],
  ];

  for (let i = 0; i < cliffRimSeeds.length; i++) {
    const [sx, sz] = cliffRimSeeds[i];
    tussockCoords.push([sx, sz, i]);
    const ox = sx + (hash2D(i, 11, 907) - 0.35) * 1.35;
    const oz = sz + (hash2D(i, 12, 907) - 0.35) * 1.35;
    tussockCoords.push([ox, oz, i + 200]);
  }

  const deerMatrices: THREE.Matrix4[] = [];
  const deerTints: THREE.Color[] = [];
  for (let i = 0; i < tussockCoords.length; i++) {
    const [tx, tz, seed] = tussockCoords[i];
    const ty = stahlTerrainSampler.sampleTerrainY(tx, tz);
    const n = stahlTerrainSampler.sampleNormal(tx, tz, 0.5);
    const scale = 1.08 + hash2D(seed, 1, 919) * 0.62;
    const safeTop = maxCliffStructuralCeilingY(tx, tz);
    const yPos = Math.min(ty + 0.06, safeTop - 0.88 * scale);

    dummy.position.set(tx, yPos, tz);
    dummy.rotation.set(
      n.nz * 0.26 + (hash2D(seed, 2, 919) - 0.5) * 0.12,
      hash2D(seed, 3, 919) * Math.PI * 2,
      -n.nx * 0.26 + (hash2D(seed, 4, 919) - 0.5) * 0.12
    );
    dummy.scale.set(scale, scale * (0.9 + hash2D(seed, 5, 919) * 0.28), scale);
    dummy.updateMatrix();
    deerMatrices.push(dummy.matrix.clone());

    const warmth = hash2D(seed, 6, 919);
    deerTints.push(
      new THREE.Color(
        0.94 + warmth * 0.14,
        0.91 + warmth * 0.10,
        0.80 + (1 - warmth) * 0.14
      )
    );
  }
  const deergrassMesh = new THREE.Mesh(
    bakeMergedInstances(deergrassGeo, deerMatrices, deerTints),
    deergrassMat
  );
  deergrassMesh.name = 'stahl.chaparral.deergrassTussocks';
  deergrassMesh.castShadow = true;
  deergrassMesh.receiveShadow = true;
  cliffGroup.add(deergrassMesh);

  const plumeGeo = buildFountainPlumeClumpGeometry(16, 811);
  const plumeMat = new THREE.MeshStandardMaterial({
    name: 'stahl.chaparral.fountainPlumeMat',
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.84,
    metalness: 0.0,
  });
  const plumeCoords: readonly [number, number][] = [
    [6.88, -1.35], [7.25, -0.85], [7.72, -0.35], [6.92, 0.45], [7.35, 1.35],
    [6.85, 2.55], [7.15, 4.05], [6.88, 6.35], [7.12, 8.65], [6.82, 10.95],
    [5.45, 12.95], [3.35, 12.88], [0.95, 12.92],
  ];
  const plumeMatrices: THREE.Matrix4[] = [];
  for (let i = 0; i < plumeCoords.length; i++) {
    const [px, pz] = plumeCoords[i];
    const py = stahlTerrainSampler.sampleTerrainY(px, pz);
    const sc = 1.15 + hash2D(i, 1, 941) * 0.42;
    const safeTop = maxCliffStructuralCeilingY(px, pz);
    dummy.position.set(px, Math.min(py + 0.06, safeTop - 0.98 * sc), pz);
    dummy.rotation.set(0.05 * ((i % 3) - 1), i * 1.7 + 0.3, -0.14);
    dummy.scale.setScalar(sc);
    dummy.updateMatrix();
    plumeMatrices.push(dummy.matrix.clone());
  }
  const plumeMesh = new THREE.Mesh(bakeMergedInstances(plumeGeo, plumeMatrices), plumeMat);
  plumeMesh.name = 'stahl.chaparral.fountainPlumes';
  plumeMesh.castShadow = true;
  cliffGroup.add(plumeMesh);

  const shrubGeo = createCraggyOutcropGeometry(1.15, 0.72, 1.10, 977, 2);
  const shrubMat = new THREE.MeshStandardMaterial({
    name: 'stahl.chaparral.scrubMoundMat',
    color: 0x4b5e38,
    roughness: 0.91,
    metalness: 0.0,
    vertexColors: true,
  });
  const shrubCoords: readonly [number, number, number][] = [
    [9.4, -0.8, 1.25], [10.6, 1.2, 1.45], [11.8, 3.9, 1.55], [12.4, 7.2, 1.65],
    [11.9, 10.6, 1.50], [11.2, 13.8, 1.70], [9.5, 16.5, 1.60], [6.8, 18.2, 1.75],
    [3.4, 18.8, 1.65], [-0.8, 18.5, 1.55], [-4.9, 18.1, 1.70], [-8.8, 17.6, 1.60],
    [14.8, 5.8, 2.05], [15.4, 11.4, 2.15], [13.6, 17.4, 2.10], [8.2, 22.0, 2.25],
  ];
  const shrubMatrices: THREE.Matrix4[] = [];
  const shrubTints: THREE.Color[] = [];
  for (let i = 0; i < shrubCoords.length; i++) {
    const [sx, sz, sc] = shrubCoords[i];
    const sy = stahlTerrainSampler.sampleTerrainY(sx, sz);
    dummy.position.set(sx, sy + 0.16 * sc, sz);
    dummy.rotation.set((hash2D(i, 1, 991) - 0.5) * 0.2, i * 2.15, (hash2D(i, 2, 991) - 0.5) * 0.2);
    dummy.scale.set(sc, sc * (0.78 + hash2D(i, 3, 991) * 0.3), sc);
    dummy.updateMatrix();
    shrubMatrices.push(dummy.matrix.clone());
    const olive = hash2D(i, 4, 991);
    shrubTints.push(new THREE.Color(0.84 + olive * 0.22, 0.90 + olive * 0.16, 0.78 + olive * 0.14));
  }
  const shrubMesh = new THREE.Mesh(
    bakeMergedInstances(shrubGeo, shrubMatrices, shrubTints),
    shrubMat
  );
  shrubMesh.name = 'stahl.chaparral.scrubShrubs';
  shrubMesh.castShadow = shrubMesh.receiveShadow = true;
  cliffGroup.add(shrubMesh);

  tagCollisionRole(cliffGroup, 'ignore');
  root.add(cliffGroup);
}

export function buildStahlPoolAndGrounds(
  ctx: SceneBuilderContext,
  root: THREE.Group,
  mats: StahlMaterials
): void {
  // 1. Scored 5'-0" x 5'-0" (1.524 m) Cast-in-Place Concrete Pool Terrace, East Entry Strip & Carport Apron
  const terraceGroup = new THREE.Group();
  terraceGroup.name = 'stahl.poolTerrace';

  const scoredTerraceMat = createScoredConcreteTerraceMaterial();
  const copingMat = new THREE.MeshStandardMaterial({
    name: 'stahl.pool.bullnoseCoping',
    color: 0xd8d3c8,
    roughness: 0.62,
    metalness: 0.0,
  });
  const stainlessMat = new THREE.MeshStandardMaterial({
    name: 'stahl.pool.polishedStainless',
    color: 0xdfe4e8,
    roughness: 0.14,
    metalness: 0.94,
  });

  const deckMinX = -13.75;
  const deckMaxX = X3 - 0.002;
  const poolOuterMinX = POOL_MIN_X - 0.14;
  const poolOuterMinZ = POOL_MIN_Z - 0.14;
  const poolOuterMaxZ = POOL_MAX_Z + 0.14;

  const northBreezeway = buildWorldScoredSlabBox(
    deckMinX,
    deckMaxX,
    -0.15,
    -0.01,
    Z1 + 0.002,
    poolOuterMinZ - 0.001,
    scoredTerraceMat
  );
  northBreezeway.name = 'stahl.poolTerrace.northBreezeway';

  const westDeck = buildWorldScoredSlabBox(
    deckMinX,
    poolOuterMinX - 0.001,
    -0.15,
    -0.01,
    poolOuterMinZ + 0.001,
    poolOuterMaxZ - 0.001,
    scoredTerraceMat
  );
  westDeck.name = 'stahl.poolTerrace.westDeck';

  const southDeck = buildWorldScoredSlabBox(
    deckMinX,
    deckMaxX,
    -0.15,
    -0.01,
    poolOuterMaxZ + 0.001,
    9.55,
    scoredTerraceMat
  );
  southDeck.name = 'stahl.poolTerrace.southDeck';

  // Narrow East threshold slab strip between the pool inlets (`POOL_MAX_X + 0.14 = -1.01`) and Living/Dining glass (`X3 = 0`)
  const eastThreshold = buildWorldScoredSlabBox(
    POOL_MAX_X + 0.142,
    deckMaxX,
    -0.15,
    -0.01,
    poolOuterMinZ + 0.001,
    poolOuterMaxZ - 0.001,
    scoredTerraceMat
  );
  eastThreshold.name = 'stahl.poolTerrace.eastThreshold';

  const carportApron = buildWorldScoredSlabBox(
    -20.8,
    X0 - 0.002,
    -0.14,
    -0.001,
    Z0,
    Z1,
    scoredTerraceMat
  );
  carportApron.name = 'stahl.poolTerrace.carportApron';

  // Woods Drive dark asphalt roadway transition & concrete curb gutter (`X in [-24.4 .. -20.804]`)
  const asphaltMat = new THREE.MeshStandardMaterial({
    name: 'stahl.woodsDrive.asphalt',
    color: 0x343638,
    roughness: 0.90,
  });
  const woodsDriveApron = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(3.58, 0.13, Z1 - Z0 + 2.4)),
    asphaltMat
  );
  woodsDriveApron.name = 'stahl.poolTerrace.woodsDriveAsphalt';
  woodsDriveApron.position.set(-22.60, -0.075, (Z0 + Z1) * 0.5 - 0.4);
  woodsDriveApron.receiveShadow = true;

  const curbGutter = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(0.18, 0.142, Z1 - Z0 + 0.6)),
    copingMat
  );
  curbGutter.position.set(-20.895, -0.070, (Z0 + Z1) * 0.5);
  curbGutter.receiveShadow = true;

  terraceGroup.add(westDeck, southDeck, northBreezeway, eastThreshold, carportApron, woodsDriveApron, curbGutter);

  // 2. Catalina Pool Co. 20' x 26' Pool Basin, 6" Cobalt Mosaic Waterline Tile, Bullnose Coping,
  //    Twin Floating Bridge Pads on Recessed Piers, Skimmer/Returns/Drains & Curved Stainless Ladder
  const plasterCausticTex = createPoolCausticTexture();
  const plasterTileMat = new THREE.MeshStandardMaterial({
    name: 'stahl.pool.plasterShell',
    color: 0x62c4d2,
    map: plasterCausticTex,
    emissive: new THREE.Color(0x1bd4e8),
    emissiveMap: plasterCausticTex,
    emissiveIntensity: 0.42,
    roughness: 0.30,
  });
  const mosaicTileMat = createWaterlineMosaicTileMaterial();

  const poolW = POOL_MAX_X - POOL_MIN_X;
  const poolD = POOL_MAX_Z - POOL_MIN_Z;
  const poolCenterX = (POOL_MIN_X + POOL_MAX_X) * 0.5;
  const poolCenterZ = (POOL_MIN_Z + POOL_MAX_Z) * 0.5;

  // Lower plaster walls (`Y in [POOL_FLOOR_Y - 0.07 .. -0.166]`) + upper 152 mm glazed waterline tile band (`[-0.164 .. -0.012]`)
  const plasterTopY = -0.166;
  const poolWallBotY = POOL_FLOOR_Y - 0.07;
  const plasterH = plasterTopY - poolWallBotY;
  const plasterMidY = poolWallBotY + plasterH * 0.5;

  const tileBotY = -0.164;
  const tileTopY = -0.012;
  const tileH = tileTopY - tileBotY;
  const tileMidY = (tileBotY + tileTopY) * 0.5;

  const poolFloor = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(poolW, 0.14, poolD)), plasterTileMat);
  poolFloor.position.set(poolCenterX, POOL_FLOOR_Y, poolCenterZ);

  const wallN = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(poolW + 0.28, plasterH, 0.139)), plasterTileMat);
  wallN.position.set(poolCenterX, plasterMidY, POOL_MIN_Z - 0.0705);
  const wallS = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(poolW + 0.28, plasterH, 0.139)), plasterTileMat);
  wallS.position.set(poolCenterX, plasterMidY, POOL_MAX_Z + 0.0705);
  const wallW = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.139, plasterH, poolD)), plasterTileMat);
  wallW.position.set(POOL_MIN_X - 0.0705, plasterMidY, poolCenterZ);
  const wallE = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.139, plasterH, poolD)), plasterTileMat);
  wallE.position.set(POOL_MAX_X + 0.0705, plasterMidY, poolCenterZ);

  // 6" (152 mm) glazed cobalt-turquoise waterline mosaic tile band around all 4 basin walls (non-overlapping mitres!)
  const tileN = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(poolW + 0.28, tileH, 0.139)), mosaicTileMat);
  tileN.position.set(poolCenterX, tileMidY, POOL_MIN_Z - 0.0705);
  const tileS = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(poolW + 0.28, tileH, 0.139)), mosaicTileMat);
  tileS.position.set(poolCenterX, tileMidY, POOL_MAX_Z + 0.0705);
  const tileW = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.139, tileH, poolD - 0.002)), mosaicTileMat);
  tileW.position.set(POOL_MIN_X - 0.0705, tileMidY, poolCenterZ);
  const tileE = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.139, tileH, poolD - 0.002)), mosaicTileMat);
  tileE.position.set(POOL_MAX_X + 0.0705, tileMidY, poolCenterZ);

  // Bullnose concrete perimeter pool coping (`320 mm` wide, `Y in [-0.0085 .. +0.020 m]`, non-overlapping mitres)
  const copY = 0.00575;
  const copH = 0.0285;
  const copW = 0.32;
  const copWest = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(copW, copH, poolD + copW * 2 - 0.04)),
    copingMat
  );
  copWest.position.set(POOL_MIN_X - copW * 0.5 + 0.02, copY, poolCenterZ);
  const copNorth = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(poolW + copW - 0.04, copH, copW)),
    copingMat
  );
  copNorth.position.set((POOL_MIN_X + 0.022 + POOL_MAX_X + copW - 0.02) * 0.5, copY, POOL_MIN_Z - copW * 0.5 + 0.02);
  const copSouth = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(poolW + copW - 0.04, copH, copW)),
    copingMat
  );
  copSouth.position.set((POOL_MIN_X + 0.022 + POOL_MAX_X + copW - 0.02) * 0.5, copY, POOL_MAX_Z + copW * 0.5 - 0.02);
  const copEast = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(copW - 0.04, copH, poolD - 0.044)),
    copingMat
  );
  copEast.position.set(POOL_MAX_X + (copW - 0.04) * 0.5 - 0.02, copY, poolCenterZ);
  copWest.receiveShadow = copNorth.receiveShadow = copSouth.receiveShadow = copEast.receiveShadow = true;

  // Central concrete pier separating the two East water inlets (`X in [-2.05..-1.151]`, `Z in [3.425..4.975]`)
  const dividerMinX = -2.05;
  const dividerMaxX = POOL_MAX_X - 0.001;
  const dividerBotY = POOL_FLOOR_Y + 0.071;
  const dividerTopY = -0.011;
  const dividerH = dividerTopY - dividerBotY;
  const inletDivider = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(dividerMaxX - dividerMinX, dividerH, 1.55)),
    mats.concreteSlab
  );
  inletDivider.position.set((dividerMinX + dividerMaxX) * 0.5, dividerBotY + dividerH * 0.5, poolCenterZ);

  const capMinX = dividerMinX - 0.025;
  const capMaxX = POOL_MAX_X - 0.022;
  const dividerCap = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(capMaxX - capMinX, copH, 1.60)),
    copingMat
  );
  dividerCap.position.set((capMinX + capMaxX) * 0.5, copY, poolCenterZ);
  dividerCap.receiveShadow = true;

  // Twin Cast-Concrete Stepping-Stone Bridge Pads (`1.45 x 1.35 m`, `walkY === 0.05`) on recessed piers
  // Note: bridge pads sit at `Y in [0.022 .. 0.076]` so they float cleanly 2 mm above `copEast` (`0.020`)!
  const bridgeNorth = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(1.45, 0.054, 1.35)), copingMat);
  bridgeNorth.name = 'stahl.pool.bridgeNorth';
  bridgeNorth.position.set(-1.35, 0.049, 2.35);
  bridgeNorth.castShadow = bridgeNorth.receiveShadow = true;

  const bridgeSouth = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(1.45, 0.054, 1.35)), copingMat);
  bridgeSouth.name = 'stahl.pool.bridgeSouth';
  bridgeSouth.position.set(-1.35, 0.049, 6.05);
  bridgeSouth.castShadow = bridgeSouth.receiveShadow = true;

  const bridgePierH = 0.020 - (POOL_FLOOR_Y + 0.071);
  const bridgePierGeo = prepGeo(new THREE.BoxGeometry(0.46, bridgePierH, 0.22));
  for (const bz of [1.88, 2.82, 5.58, 6.52]) {
    const pier = new THREE.Mesh(bridgePierGeo, mats.concreteSlab);
    pier.position.set(-1.56, POOL_FLOOR_Y + 0.071 + bridgePierH * 0.5, bz);
    terraceGroup.add(pier);
  }

  // Stainless skimmer throat, return jets & dual main drains
  const skimmerDarkMat = new THREE.MeshStandardMaterial({ color: 0x0e2a34, roughness: 0.4 });
  const skimmerBezel = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.28, 0.12, 0.018)), stainlessMat);
  skimmerBezel.position.set(-7.15, -0.078, POOL_MIN_Z + 0.010);
  const skimmerThroat = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.22, 0.078, 0.008)), skimmerDarkMat);
  skimmerThroat.position.set(-7.15, -0.078, POOL_MIN_Z + 0.021);
  const skimmerLid = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.115, 0.115, 0.005, 18)), stainlessMat);
  skimmerLid.position.set(-7.15, 0.023, POOL_MIN_Z - 0.15);
  terraceGroup.add(skimmerBezel, skimmerThroat, skimmerLid);

  const jetGeo = prepGeo(new THREE.CylinderGeometry(0.032, 0.032, 0.016, 12));
  for (const [jx, jz, rotZ, rotX] of [
    [POOL_MIN_X + 0.009, 2.8, Math.PI / 2, 0],
    [POOL_MIN_X + 0.009, 5.6, Math.PI / 2, 0],
    [-5.4, POOL_MAX_Z - 0.009, 0, Math.PI / 2],
  ] as const) {
    const jet = new THREE.Mesh(jetGeo, stainlessMat);
    jet.position.set(jx, -0.38, jz);
    jet.rotation.set(rotX, 0, rotZ);
    terraceGroup.add(jet);
  }

  const drainGeo = prepGeo(new THREE.CylinderGeometry(0.12, 0.13, 0.016, 16));
  for (const dz of [3.55, 4.85]) {
    const drain = new THREE.Mesh(drainGeo, stainlessMat);
    drain.position.set(-8.15, POOL_FLOOR_Y + 0.079, dz);
    terraceGroup.add(drain);
  }

  // Curved Polished-Stainless 2-Rail Tubular Pool Ladder (`38 mm` rails + 3 non-slip treads on SW coping)
  const ladderGroup = new THREE.Group();
  ladderGroup.name = 'stahl.pool.stainlessLadder';
  const ladderCenterX = -8.25;
  const railSpanHalf = 0.25;
  const ladderCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.021, POOL_MAX_Z + 0.20),
    new THREE.Vector3(0, 0.44, POOL_MAX_Z + 0.20),
    new THREE.Vector3(0, 0.56, POOL_MAX_Z + 0.04),
    new THREE.Vector3(0, 0.42, POOL_MAX_Z - 0.14),
    new THREE.Vector3(0, 0.04, POOL_MAX_Z - 0.16),
    new THREE.Vector3(0, -0.94, POOL_MAX_Z - 0.16),
  ]);
  const ladderTubeGeo = prepGeo(new THREE.TubeGeometry(ladderCurve, 28, 0.019, 10, false));
  for (const sx of [-railSpanHalf, railSpanHalf]) {
    const rail = new THREE.Mesh(ladderTubeGeo, stainlessMat);
    rail.position.x = ladderCenterX + sx;
    rail.castShadow = true;
    const escutcheon = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.044, 0.048, 0.012, 14)), stainlessMat);
    escutcheon.position.set(ladderCenterX + sx, 0.0265, POOL_MAX_Z + 0.20);
    const bumper = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.026, 0.026, 0.024, 10)), stainlessMat);
    bumper.rotation.x = Math.PI / 2;
    bumper.position.set(ladderCenterX + sx, -0.90, POOL_MAX_Z - 0.02);
    ladderGroup.add(rail, escutcheon, bumper);
  }
  const treadGeo = prepGeo(new THREE.BoxGeometry(railSpanHalf * 2 - 0.038, 0.022, 0.088));
  for (const ty of [-0.26, -0.54, -0.82]) {
    const tread = new THREE.Mesh(treadGeo, stainlessMat);
    tread.position.set(ladderCenterX, ty, POOL_MAX_Z - 0.16);
    ladderGroup.add(tread);
  }
  terraceGroup.add(ladderGroup);

  // Rippled / Caustic Physical Water Surface + Spatialized Water Lap Emitter
  const waterNormalMap = createRippledWaterNormalMap();
  const waterMat = new THREE.MeshPhysicalMaterial({
    name: 'stahl.pool.waterSurface',
    color: 0x35cbe0,
    emissive: new THREE.Color(0x10a8be),
    emissiveIntensity: 0.30,
    normalMap: waterNormalMap,
    normalScale: new THREE.Vector2(0.28, 0.28),
    transparent: true,
    opacity: 0.74,
    roughness: 0.06,
    metalness: 0.04,
    clearcoat: 0.9,
    clearcoatRoughness: 0.08,
    transmission: 0,
    ior: 1.333,
  });
  const waterMesh = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(poolW - 0.004, 0.032, poolD - 0.004)), waterMat);
  waterMesh.name = 'stahl.pool.water';
  waterMesh.position.set(poolCenterX, POOL_WATER_Y, poolCenterZ);
  attachAudioEmitter(waterMesh, {
    id: 'stahl-pool-water-lap',
    preset: 'waterFeature',
    zoneId: 'stahlPoolTerrace',
    volume: 0.26,
    refDistance: 2.4,
    maxDistance: 15.0,
  });

  terraceGroup.add(
    poolFloor,
    wallN,
    wallS,
    wallW,
    wallE,
    tileN,
    tileS,
    tileW,
    tileE,
    copWest,
    copNorth,
    copSouth,
    copEast,
    inletDivider,
    dividerCap,
    bridgeNorth,
    bridgeSouth,
    waterMesh
  );
  root.add(terraceGroup);

  // Bind underwater pool circuit (`stahlPoolUnderwater` — 2-way switched, strict 1 PointLight budget!)
  const poolGrp = (ctx.lightGroups as Record<string, LightCircuitGroup>).stahlPoolUnderwater;
  const nicheMat = new THREE.MeshStandardMaterial({
    name: 'stahl.pool.underwaterNicheLens',
    color: 0xe6feff,
    emissive: new THREE.Color(0x42e8f5),
    emissiveIntensity: 2.6,
    roughness: 0.15,
  });
  for (const [nx, nz, rotZ, rotX] of [
    [POOL_MAIN_MAX_X - 0.015, 2.55, Math.PI / 2, 0],
    [POOL_MAIN_MAX_X - 0.015, 5.85, Math.PI / 2, 0],
    [-6.2, POOL_MAX_Z - 0.015, 0, Math.PI / 2],
  ] as const) {
    const ring = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.135, 0.135, 0.022, 18)), stainlessMat);
    ring.rotation.set(rotX, 0, rotZ);
    ring.position.set(nx, -0.68, nz);
    const lens = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.102, 0.102, 0.032, 16)), nicheMat);
    lens.rotation.set(rotX, 0, rotZ);
    lens.position.set(nx, -0.68, nz);
    terraceGroup.add(ring, lens);
  }
  const poolLight = new THREE.PointLight(0x3be6f8, 3.6, 14.0, 2);
  poolLight.position.set(-5.6, -0.35, poolCenterZ);
  terraceGroup.add(poolLight);
  if (poolGrp) {
    poolGrp.emissives.push(nicheMat, plasterTileMat, mosaicTileMat, waterMat);
    poolGrp.lights.push(poolLight);
  }

  // Cantilever overhang soffit wash (`stahlCantileverSoffit` — strict 1 PointLight budget!)
  const soffitGrp = (ctx.lightGroups as Record<string, LightCircuitGroup>).stahlCantileverSoffit;
  const soffitStripMat = new THREE.MeshStandardMaterial({
    color: 0xfff8ea,
    emissive: new THREE.Color(0xffdca8),
    emissiveIntensity: 1.6,
  });
  const soffitBar = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.06, 0.03, Z3 - Z1)), soffitStripMat);
  soffitBar.position.set(X3 - CANTILEVER_M * 0.6, CLEAR_CEILING_Y - 0.054, (Z1 + Z3) * 0.5);
  const soffitLight = new THREE.PointLight(0xffdca8, 2.2, 10.5, 2);
  soffitLight.position.set(X3 - 1.0, 2.35, 6.1);
  root.add(soffitBar, soffitLight);
  if (soffitGrp) {
    soffitGrp.emissives.push(soffitStripMat);
    soffitGrp.lights.push(soffitLight);
  }

  // 3. Van Keppel-Green Patio Furnishings & Architectural Pottery Mid-Century Planters
  const vkgCordMat = new THREE.MeshStandardMaterial({
    name: 'stahl.vkg.whiteVinylCord',
    color: 0xf0ece0,
    roughness: 0.58,
  });
  const vkgPersimmonMat = new THREE.MeshStandardMaterial({
    name: 'stahl.vkg.persimmonCord',
    color: 0xd16838,
    roughness: 0.62,
  });
  const vkgOpalSlatMat = new THREE.MeshStandardMaterial({
    name: 'stahl.vkg.whiteOpalLacquer',
    color: 0xece8dc,
    roughness: 0.42,
    metalness: 0.14,
  });

  // Pair of VKG Sun Loungers on West Pool Deck (`X = -12.30`, leaving `[-10.8, 0, 5.2]` spawn & poolside walk clear!)
  addVanKeppelChaise(ctx, root, {
    name: 'stahl.patio.vkgLounger_1',
    x: -12.32,
    z: 2.75,
    rotY: Math.PI / 2,
    frameMat: mats.steelCharcoal,
    cordMat: vkgCordMat,
    accentMat: vkgPersimmonMat,
  });
  addVanKeppelChaise(ctx, root, {
    name: 'stahl.patio.vkgLounger_2',
    x: -12.32,
    z: 5.95,
    rotY: Math.PI / 2,
    frameMat: mats.steelCharcoal,
    cordMat: vkgCordMat,
    accentMat: vkgPersimmonMat,
  });
  addVkgSideTableWithStyling(
    root,
    -12.38,
    4.35,
    mats.steelCharcoal,
    vkgOpalSlatMat,
    vkgPersimmonMat,
    mats.plateGlass
  );

  // South Pool Terrace VKG Conversation Set (`Z ~ 8.45`, facing NE toward the cantilevered glass pavilion & LA skyline)
  const patioTableGroup = new THREE.Group();
  patioTableGroup.name = 'stahl.patio.vkgRoundTable';
  patioTableGroup.position.set(-5.15, -0.01, 8.48);
  const roundTop = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.46, 0.46, 0.022, 28)), vkgOpalSlatMat);
  roundTop.position.y = 0.52;
  roundTop.castShadow = roundTop.receiveShadow = true;
  const roundStem = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.022, 0.022, 0.495, 12)), mats.steelCharcoal);
  roundStem.position.y = 0.258;
  const roundBase = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.24, 0.25, 0.012, 20)), mats.steelCharcoal);
  roundBase.position.y = 0.0065;
  patioTableGroup.add(roundTop, roundStem, roundBase);
  attachAssetMetadata(patioTableGroup, {
    name: 'Van Keppel-Green Circular Patio Cocktail Table',
    brand: 'Van Keppel-Green',
    collection: 'Case Study House #22',
    sku: 'VKG-CSH22-ROUND920',
    finish: 'White Opal Top & Charcoal Steel Pedestal',
    category: 'furniture',
    dimensionsMm: [920, 920, 530],
  });
  root.add(patioTableGroup);

  addVanKeppelLoungeChair(ctx, root, {
    name: 'stahl.patio.vkgChair_1',
    x: -6.12,
    z: 8.42,
    rotY: Math.PI * 0.64,
    frameMat: mats.steelCharcoal,
    cordMat: vkgCordMat,
  });
  addVanKeppelLoungeChair(ctx, root, {
    name: 'stahl.patio.vkgChair_2',
    x: -4.18,
    z: 8.42,
    rotY: -Math.PI * 0.56,
    frameMat: mats.steelCharcoal,
    cordMat: vkgCordMat,
  });

  // Matte-White Architectural Pottery Cylinder & Cone Planters around Breezeway & Pool Terrace
  const ceramicWhiteMat = new THREE.MeshStandardMaterial({
    name: 'stahl.planter.architecturalPotteryWhite',
    color: 0xf4f1e8,
    roughness: 0.72,
    metalness: 0.0,
  });
  const pottingSoilMat = new THREE.MeshStandardMaterial({ color: 0x3b2d22, roughness: 0.95 });
  const tropicalLeafMat = new THREE.MeshStandardMaterial({
    name: 'stahl.planter.tropicalFoliage',
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.56,
  });

  addArchitecturalPotteryPlanter(root, {
    name: 'stahl.planter.breezewayWest',
    x: -12.98,
    z: 0.72,
    shape: 'cylinder',
    species: 'strelitzia',
    ceramicMat: ceramicWhiteMat,
    standMat: mats.walnutWood,
    soilMat: pottingSoilMat,
    foliageMat: tropicalLeafMat,
    seed: 101,
  });
  addArchitecturalPotteryPlanter(root, {
    name: 'stahl.planter.breezewayInnerCorner',
    x: -6.12,
    z: 0.74,
    shape: 'cylinder',
    species: 'philodendron',
    ceramicMat: ceramicWhiteMat,
    standMat: mats.walnutWood,
    soilMat: pottingSoilMat,
    foliageMat: tropicalLeafMat,
    seed: 203,
  });
  addArchitecturalPotteryPlanter(root, {
    name: 'stahl.planter.southWestCorner',
    x: -12.95,
    z: 8.75,
    shape: 'cone',
    species: 'agave',
    ceramicMat: ceramicWhiteMat,
    standMat: mats.steelCharcoal,
    soilMat: pottingSoilMat,
    foliageMat: tropicalLeafMat,
    seed: 307,
  });
  addArchitecturalPotteryPlanter(root, {
    name: 'stahl.planter.southLivingThreshold',
    x: -1.18,
    z: 8.72,
    shape: 'cone',
    species: 'strelitzia',
    ceramicMat: ceramicWhiteMat,
    standMat: mats.walnutWood,
    soilMat: pottingSoilMat,
    foliageMat: tropicalLeafMat,
    seed: 409,
  });

  // 4. 2-Car Carport, 1635 Woods Drive Street Entry Pier, Storage Lockers, Utility Meter & 1960 Roadster
  const carportGroup = new THREE.Group();
  carportGroup.name = 'stahl.carport.details';

  // Street-side vertical Robertson fluted steel entry pier at NW Woods Drive corner (`X = X0`, `Z in [Z0+0.07..Z0+1.34]`)
  // Placed outside `northWoodsCut` (`minSpan = X1 - 0.2`) so it never triggers cutaway warnings and frames `1635`!
  const pierGroup = new THREE.Group();
  pierGroup.name = 'stahl.carport.streetEntryPier1635';
  const pierMinZ = Z0 + 0.08;
  const pierMaxZ = Z0 + 1.34;
  const pierH = CLEAR_CEILING_Y - 0.04;
  const pierPuttyMat = new THREE.MeshStandardMaterial({
    name: 'stahl.robertsonDeckingPutty',
    color: 0xd0cabd,
    roughness: 0.58,
    metalness: 0.22,
  });
  const pierCore = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(0.09, pierH, pierMaxZ - pierMinZ)),
    pierPuttyMat
  );
  pierCore.position.set(X0 - 0.11, pierH * 0.5 + 0.001, (pierMinZ + pierMaxZ) * 0.5);
  pierCore.castShadow = pierCore.receiveShadow = true;
  pierGroup.add(pierCore);

  // Vertical trapezoidal/box ribs along the West street-facing face
  const vRibGeo = prepGeo(new THREE.BoxGeometry(0.022, pierH, 0.068));
  for (let rz = pierMinZ + 0.06; rz <= pierMaxZ - 0.06; rz += 0.16) {
    const vRib = new THREE.Mesh(vRibGeo, pierPuttyMat);
    vRib.position.set(X0 - 0.168, pierH * 0.5 + 0.001, rz);
    vRib.castShadow = true;
    pierGroup.add(vRib);
  }

  // Charcoal architectural address plaque + brushed-aluminum `1 6 3 5` numerals facing Woods Drive (`-X`)
  const addressPlaque = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(0.016, 0.24, 0.64)),
    mats.steelCharcoal
  );
  addressPlaque.position.set(X0 - 0.189, 1.56, (pierMinZ + pierMaxZ) * 0.5);
  pierGroup.add(addressPlaque);

  const numerals = buildHouseNumerals1635(mats.anodizedAlum);
  numerals.position.set(X0 - 0.206, 1.56, (pierMinZ + pierMaxZ) * 0.5);
  pierGroup.add(numerals);
  carportGroup.add(pierGroup);

  // Architectural Cedar/Walnut & Charcoal-Steel Carport Storage Lockers + Utility Meter Cabinet on `carportWall` (`X1 = -12.192`)
  // Tagged with `westCarportCut` so they cut away cleanly with `carportWall` (`0` cutaway warnings),
  // and positioned in `Z in [-5.84 .. -1.68]` leaving `stahl.sw.carport` (`Z = -1.2`) & breezeway walk clear!
  const westCarportCut: CutawayWallDescriptor = {
    axis: 'x',
    coord: X1,
    minSpan: Z0,
    maxSpan: Z1,
    floor: 'ground',
     outwardSide: 'west',
  };

  const lockerGroup = new THREE.Group();
  lockerGroup.name = 'stahl.carport.storageLockers';
  const cedarMat = new THREE.MeshStandardMaterial({
    name: 'stahl.carport.westernRedCedar',
    color: 0x7d4e31,
    roughness: 0.54,
  });

  const lockerMinZ = -5.84;
  const lockerMaxZ = -2.36;
  const lockerW = lockerMaxZ - lockerMinZ;
  const lockerDepth = 0.32;
  const lockerH = 2.28;
  const lockerWallX = X1 - 0.082; // West face of carportWall is X1 - 0.080

  const lockerCarcass = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(lockerDepth, lockerH, lockerW)),
    mats.steelCharcoal
  );
  lockerCarcass.position.set(lockerWallX - lockerDepth * 0.5, lockerH * 0.5 + 0.06, (lockerMinZ + lockerMaxZ) * 0.5);
  lockerCarcass.castShadow = lockerCarcass.receiveShadow = true;
  lockerGroup.add(lockerCarcass);

  // Recessed steel plinth kickplate
  const lockerPlinth = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(lockerDepth - 0.04, 0.058, lockerW - 0.02)),
    mats.matteBlackHood
  );
  lockerPlinth.position.set(lockerWallX - (lockerDepth - 0.04) * 0.5, 0.03, (lockerMinZ + lockerMaxZ) * 0.5);
  lockerGroup.add(lockerPlinth);

  // 4 flush full-height cedar storage locker doors with brushed-aluminum vertical pulls
  const doorCount = 4;
  const doorSpan = (lockerW - 0.04) / doorCount;
  for (let i = 0; i < doorCount; i++) {
    const dz = lockerMinZ + 0.02 + doorSpan * (i + 0.5);
    const doorPanel = new THREE.Mesh(
      prepGeo(new THREE.BoxGeometry(0.018, lockerH - 0.05, doorSpan - 0.014)),
      cedarMat
    );
    doorPanel.position.set(lockerWallX - lockerDepth - 0.010, lockerH * 0.5 + 0.06, dz);
    doorPanel.castShadow = true;

    const pull = new THREE.Mesh(
      prepGeo(new THREE.BoxGeometry(0.016, 0.19, 0.014)),
      mats.anodizedAlum
    );
    const pullOff = i % 2 === 0 ? doorSpan * 0.36 : -doorSpan * 0.36;
    pull.position.set(lockerWallX - lockerDepth - 0.028, 1.12, dz + pullOff);
    lockerGroup.add(doorPanel, pull);
  }

  // Brushed-steel electrical & utility meter cabinet (`Z in [-2.24 .. -1.68]`)
  const meterBox = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(0.16, 0.68, 0.52)),
    pierPuttyMat
  );
  meterBox.position.set(lockerWallX - 0.08, 1.38, -1.96);
  meterBox.castShadow = true;
  const meterDial = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.078, 0.078, 0.045, 18)),
    mats.plateGlass
  );
  meterDial.rotation.z = Math.PI / 2;
  meterDial.position.set(lockerWallX - 0.184, 1.48, -1.96);
  const meterRim = new THREE.Mesh(
    prepGeo(new THREE.TorusGeometry(0.078, 0.009, 8, 18)),
    stainlessMat
  );
  meterRim.rotation.y = Math.PI / 2;
  meterRim.position.set(lockerWallX - 0.185, 1.48, -1.96);
  const conduit = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.016, 0.016, 0.88, 10)),
    stainlessMat
  );
  conduit.position.set(lockerWallX - 0.06, 2.16, -1.96);
  lockerGroup.add(meterBox, meterDial, meterRim, conduit);

  tagCutaway(lockerGroup, westCarportCut);
  attachAssetMetadata(lockerGroup, {
    name: 'Koenig Carport Cedar Storage Lockers & Utility Meter Enclosure',
    brand: 'Case Study House #22 Custom Millwork',
    sku: 'CSH22-CARPORT-LOCKERS',
    finish: 'Western Red Cedar, Charcoal Steel & Brushed Aluminum',
    category: 'joinery',
    dimensionsMm: [340, 3480, 2340],
  });
  carportGroup.add(lockerGroup);

  // Precast concrete wheel stops in Bay 1 (North) and Bay 2 (South)
  for (const wz of [-4.58, -1.65]) {
    const wheelStop = new THREE.Mesh(
      prepGeo(new THREE.BoxGeometry(0.15, 0.095, 1.68)),
      copingMat
    );
    wheelStop.position.set(-13.25, 0.048, wz);
    wheelStop.castShadow = wheelStop.receiveShadow = true;
    tagCollisionRole(wheelStop, 'ignore');
    carportGroup.add(wheelStop);
  }

  root.add(carportGroup);

  // Park the 1960 Mid-Century California Roadster in Bay 1 (North bay: `X = -15.38, Z = -4.58`),
  // keeping Bay 2 (`[-15.2, 0, -2.5]` `carport-arrival` spawn & pedestrian breezeway) 100% clear!
  build1960CaliforniaRoadster(root, -15.38, -4.58, 0, stainlessMat, mats.plateGlass);

  // 5. Iconic Off-White 42" Tubular Steel Pipe Safety Railing around Catwalk & Pool Cliff Rim
  buildPerimeterPipeSafetyRailing(root, mats.steelCharcoal);

  // 6. Rocky decomposed-granite cliff outcrops, NE gravel nose + Agave attenuata, and chaparral tussocks
  buildStahlCliffOutcropsAndChaparral(root);

  // 7. Orthogonal Los Angeles Basin Night City-Lights Grid + Sunset Strip + Downtown LA Skyline
  buildLaBasinCityLightsVista(root);
}
