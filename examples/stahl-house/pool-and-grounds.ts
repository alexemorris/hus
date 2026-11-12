import * as THREE from 'three';
import { attachAudioEmitter, prepGeo, tagCollisionRole } from 'husjs/objects';
import type { LightCircuitGroup, SceneBuilderContext } from 'husjs/viewer';
import type { StahlMaterials } from './structure.ts';
import {
  CANTILEVER_M,
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
  X3,
  X4,
  Z0,
  Z1,
  Z2,
  Z3,
} from './terrain.ts';

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
        Math.min(1, 0.54 + (macro - 0.5) * 0.26 + (mid - 0.5) * 0.18 - fissure * 0.34 + (grit - 0.5) * 0.14 + (fine - 0.5) * 0.08)
      );
      heights[y * size + x] = h;

      // Natural Hollywood Hills decomposed-granite & iron-ochre sandstone (#b58e63, #9c7a54, #846648, #4e3b2b fissures)
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
      const rv = Math.round(rough * 255);
      roughData[idx] = rv;
      roughData[idx + 1] = rv;
      roughData[idx + 2] = rv;
      roughData[idx + 3] = 255;
    }
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;
      const ym = (y - 1 + size) % size;
      const yp = (y + 1) % size;
      const dx = (heights[y * size + xp] - heights[y * size + xm]) * 2.1;
      const dy = (heights[yp * size + x] - heights[ym * size + x]) * 2.1;
      const len = Math.hypot(dx, dy, 1);
      const nx = (-dx / len) * 0.5 + 0.5;
      const ny = (-dy / len) * 0.5 + 0.5;
      const nz = (1 / len) * 0.5 + 0.5;
      const idx = (y * size + x) * 4;
      normalData[idx] = Math.round(nx * 255);
      normalData[idx + 1] = Math.round(ny * 255);
      normalData[idx + 2] = Math.round(nz * 255);
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

    // Stratified sedimentary/granite fracture ledges + sharp angular ridge facets
    const n1 = fbm3D(ux * 1.9 + 3.1, uy * 2.6 + 1.7, uz * 1.9 + 5.3, seed);
    const ridge = 1 - Math.abs(valueNoise3D(ux * 3.1, uy * 3.8, uz * 3.1, seed + 17) * 2 - 1);
    const terrace = Math.floor((uy + 1.1) * 4.5) / 4.5;
    const strataStep = (uy + 1.1 - terrace) * 0.22;

    const radial = 0.72 + n1 * 0.36 + Math.pow(ridge, 2.1) * 0.18 - strataStep;
    // Flatten underside slightly and pinch crown into craggy weathered bluff ribs
    const px = ux * rx * radial;
    const py = uy * ry * (uy > 0 ? radial * 0.92 : radial * 1.05);
    const pz = uz * rz * radial;
    pos.setXYZ(i, px, py, pz);

    // Vertex color modulation: sun-warmed ochre crown (#c9a77d) to deep iron-crevice base (#6e543d)
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

/**
 * Builds a single multi-blade California deergrass (`Muhlenbergia rigens`) tussock clump geometry
 * of radiating, gracefully recurved 3D triangular-section blades (`~22` blades per clump) with
 * warm golden-ochre tips and olive-taupe bases.
 */
function buildDeergrassClumpGeometry(bladeCount = 22, seed = 701): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const baseCol = new THREE.Color(0x6e6335); // Olive-brown crown base
  const midCol = new THREE.Color(0xa68b46); // Dry golden-ochre mid blade
  const tipCol = new THREE.Color(0xcab067); // Sun-bleached straw tip
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

      // Left edge + center V-keel + right edge -> crisp 3D blade volume
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

/**
 * Builds a pale warm pinkish-tan California fountain grass (`Pennisetum setaceum`) plume clump,
 * visible along the upper cliff rim right beside the catwalk in `/tmp/stahl_cliff_ref.png`.
 */
function buildFountainPlumeClumpGeometry(plumeCount = 14, seed = 811): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const stalkCol = new THREE.Color(0x9d8652);
  const plumeCol = new THREE.Color(0xd8b89e); // Warm pale pinkish-buff plume
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
      // Plume swells softly in upper half (`t in [0.45..0.9]`)
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

/**
 * Sculpts a fleshy *Agave attenuata* (Foxtail Agave) succulent rosette (`#6f8762` glaucous sage-green)
 * for the dusty decomposed-granite promontory nose seen in `/tmp/stahl_cliff_ref.png`.
 */
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
        // Broad oblanceolate succulent leaf tapering to a soft spineless point
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

        // 4-vertex closed diamond leaf cross-section (top cup, left margin, bottom keel, right margin)
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
 * Computes a safe ceiling Y at `(x, z)` so rocky outcrops & chaparral tussocks under the
 * cantilevered concrete grade beams (`beamBotY = -0.944 m`), floor slab (`-0.18 m`), and
 * slatted catwalk (`-0.097 m`) maintain crisp air clearance (`0` z-fighting overlaps!).
 */
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
    return -0.99; // Below 762 mm grade beam underside (-0.944 m)
  }
  const underCatwalk =
    (x >= X4 - 0.1 && x <= 6.82 && z >= Z0 - 0.25 && z <= 12.92) ||
    (z >= Z3 - 0.1 && z <= 12.92 && x >= X3 - 0.55 && x <= 6.82);
  if (underCatwalk) {
    return -0.16; // Below catwalk slats & trim (-0.097 m)
  }
  return -0.26; // Below cantilevered concrete floor slab (-0.18 m)
}

/** Builds a procedural Los Angeles Basin twilight city-lights grid texture (`0` PointLights!). */
function createLaCityGridTexture(): THREE.DataTexture {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const majorBoulevard = x % 32 === 0 || y % 32 === 0;
      const arterial = x % 16 === 0 || y % 16 === 0;
      const blockStreet = x % 6 === 0 || y % 6 === 0;
      const hash = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      const sparkle = (hash % 100) / 100;

      let r = 8;
      let g = 9;
      let b = 14;
      let a = 175;
      if (majorBoulevard && sparkle > 0.14) {
        r = 255;
        g = 198;
        b = 115;
        a = 245;
      } else if (arterial && sparkle > 0.25) {
        r = 245;
        g = 180;
        b = 102;
        a = 220;
      } else if (blockStreet && sparkle > 0.52) {
        r = 215;
        g = 175;
        b = 128;
        a = 190;
      } else if (sparkle > 0.96) {
        r = 165;
        g = 210;
        b = 245;
        a = 210;
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
  tex.repeat.set(16, 16);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Van Keppel-Green style corded charcoal-iron mid-century poolside chaise lounge. */
function addVanKeppelChaise(parent: THREE.Object3D, x: number, z: number, rotY: number, frameMat: THREE.Material, floorY = -0.01): void {
  const g = new THREE.Group();
  g.position.set(x, floorY, z);
  g.rotation.y = rotY;
  const cordMat = new THREE.MeshStandardMaterial({ color: 0xebe6da, roughness: 0.72 });
  const bed = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.66, 0.035, 1.38)), cordMat);
  bed.position.set(0, 0.32, 0.24);
  const back = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.656, 0.035, 0.68)), cordMat);
  back.position.set(0, 0.5, -0.68);
  back.rotation.x = 0.56;
  for (const sx of [-0.31, 0.31]) {
    for (const sz of [-0.72, 0.78]) {
      const leg = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.013, 0.013, 0.301, 8)), frameMat);
      leg.position.set(sx, 0.1515, sz);
      g.add(leg);
    }
  }
  bed.castShadow = back.castShadow = true;
  g.add(bed, back);
  parent.add(g);
}

/**
 * Builds the craggy decomposed-granite rocky cliff escarpment outcrops, NE decomposed-granite
 * gravel promontory nose with dry-stacked stone cribbing & *Agave attenuata*, and dry golden-ochre
 * California deergrass & chaparral scrub across the East, South-East, and South bluff.
 */

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

  // 1. 3D Craggy Decomposed-Granite Cliff Outcrops & Fractured Sandstone Ledges
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
    // Exposed fractured decomposed-granite bluff ribs emerging organically under the SE & South cantilevered grade beams
    { x: 4.95, z: 10.75, yLift: 0.12, rx: 1.55, ry: 1.45, rz: 1.65, rotX: 0.22, rotY: 0.42, rotZ: -0.28, seed: 101 },
    { x: 5.75, z: 12.15, yLift: 0.15, rx: 1.45, ry: 1.50, rz: 1.35, rotX: 0.26, rotY: -0.35, rotZ: -0.24, seed: 107 },
    { x: 3.55, z: 11.75, yLift: 0.08, rx: 1.60, ry: 1.35, rz: 1.45, rotX: 0.28, rotY: 0.18, rotZ: -0.08, seed: 113 },
    { x: 1.45, z: 11.55, yLift: 0.05, rx: 1.65, ry: 1.30, rz: 1.40, rotX: 0.30, rotY: -0.28, rotZ: 0.06, seed: 127 },
    { x: -1.15, z: 11.35, yLift: 0.02, rx: 1.70, ry: 1.25, rz: 1.45, rotX: 0.24, rotY: 0.51, rotZ: 0.09, seed: 131 },
    { x: -4.20, z: 11.20, yLift: -0.04, rx: 1.80, ry: 1.20, rz: 1.50, rotX: 0.20, rotY: -0.44, rotZ: -0.07, seed: 137 },
    // Steep East cliff escarpment rock ribs under the Living & Dining cantilevered beams
    { x: 5.25, z: 8.15, yLift: 0.10, rx: 1.40, ry: 1.40, rz: 1.65, rotX: 0.08, rotY: 0.64, rotZ: -0.32, seed: 149 },
    { x: 5.15, z: 4.65, yLift: 0.08, rx: 1.35, ry: 1.35, rz: 1.70, rotX: -0.06, rotY: 0.29, rotZ: -0.34, seed: 157 },
    { x: 5.05, z: 1.35, yLift: 0.04, rx: 1.35, ry: 1.30, rz: 1.55, rotX: -0.09, rotY: -0.52, rotZ: -0.28, seed: 163 },
    // Mid-slope craggy sandstone ledges breaking the cliff silhouette
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
    // Guarantee every vertex stays below any nearby concrete grade beam / slab / catwalk!
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

  // 2. NE Dusty Decomposed-Granite Gravel Promontory Nose + Dry-Stacked Stone Cribbing + Agave attenuata
  //    Grounded directly into the graded NE promontory nose terrain (zero floating discs or blocks!)
  const noseGroup = new THREE.Group();
  noseGroup.name = 'stahl.promontoryGravelNose';

  // Craggy decomposed-granite bedrock buttress anchoring the NE promontory nose into the East cliff
  const noseButtressGeo = createCraggyOutcropGeometry(1.75, 1.85, 2.25, 509, 3);
  const noseButtressY = stahlTerrainSampler.sampleTerrainY(7.85, -2.95) - 1.32;
  const noseButtress = new THREE.Mesh(noseButtressGeo, rockMat);
  noseButtress.name = 'stahl.promontoryGravelNose.buttress';
  noseButtress.position.set(7.85, noseButtressY, -2.95);
  noseButtress.rotation.set(0.08, 0.24, -0.22);
  noseButtress.castShadow = true;
  noseButtress.receiveShadow = true;
  noseGroup.add(noseButtress);

  // Stepped dry-stacked weathered sandstone cribbing blocks seated directly into the graded nose rim
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
    // Anchor each course directly to the graded promontory crest elevation so every block is embedded in earth
    const rimGroundY = stahlTerrainSampler.sampleTerrainY(Math.min(c.x, 8.25), Math.min(c.z, -1.62));
    const cy = rimGroundY - 0.04 - c.tier * 0.152;
    const block = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(c.w, c.h, c.d)), cribMat);
    block.position.set(c.x, cy, c.z);
    block.rotation.y = c.rotY;
    block.castShadow = block.receiveShadow = true;
    noseGroup.add(block);
  }

  // Sculpted Agave attenuata rosettes planted directly on sampleTerrainY(x, z) of the NE promontory nose
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

  // 3. Instanced Dry Golden-Ochre California Deergrass (`Muhlenbergia rigens`) Tussocks
  const deergrassGeo = buildDeergrassClumpGeometry(22, 701);
  const deergrassMat = new THREE.MeshStandardMaterial({
    name: 'stahl.chaparral.deergrassMat',
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.88,
    metalness: 0.0,
  });

  const tussockCoords: [number, number, number][] = [];
  // Dense organic clusters clinging to the steep East, SE & South cliff face right outside & below the catwalk
  const cliffRimSeeds: readonly [number, number][] = [
    // East bluff rim & slope (Z = -1.6 .. 12.8, X = 6.3 .. 14.5)
    [6.95, -1.05], [7.55, -0.45], [8.25, 0.35], [6.85, 1.15], [7.65, 2.05],
    [8.65, 2.85], [6.75, 3.45], [7.45, 4.35], [8.55, 5.15], [6.80, 5.95],
    [7.55, 6.85], [8.85, 7.55], [6.65, 8.25], [7.35, 9.15], [8.45, 9.95],
    [6.75, 10.65], [7.45, 11.45], [8.65, 11.95], [6.85, 12.65], [7.75, 13.25],
    [9.45, 1.45], [9.85, 3.85], [10.15, 6.45], [9.95, 8.95], [9.75, 11.35],
    [11.2, 2.6], [11.6, 5.5], [11.4, 8.4], [11.1, 11.6], [10.4, 13.9],
    // Under & beside SE / South cantilever (Z = 10.8 .. 19.5, X = -10.5 .. 9.0)
    [5.85, 13.05], [4.95, 13.25], [3.95, 12.95], [2.85, 13.15], [1.75, 12.95],
    [0.55, 13.10], [-0.75, 12.85], [-2.15, 12.45], [-3.65, 11.85], [-5.25, 11.45],
    [-6.95, 11.25], [-8.65, 11.35], [-10.2, 11.6],
    [6.35, 14.35], [4.85, 14.65], [3.25, 14.45], [1.55, 14.75], [-0.35, 14.55],
    [-2.45, 14.35], [-4.65, 14.15], [-6.85, 14.25], [-9.15, 14.55],
    [8.25, 15.65], [6.15, 16.45], [3.85, 16.85], [1.25, 16.95], [-1.65, 16.75],
    [-4.35, 16.65], [-7.25, 16.85], [9.85, 17.85], [5.25, 19.25], [0.45, 19.45],
    // Tucked onto ledges just beneath the East/SE catwalk (`X = 5.6..6.5, Z = 7.0..12.6`)
    [6.15, 7.35], [6.25, 9.65], [6.10, 11.15], [4.45, 12.55], [2.35, 12.45],
  ];

  for (let i = 0; i < cliffRimSeeds.length; i++) {
    const [sx, sz] = cliffRimSeeds[i];
    tussockCoords.push([sx, sz, i]);
    // Add a companion smaller tuft offset organically along the contour
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

  // 4. Pale Warm Pinkish-Tan Fountain Grass Plumes along the NE/East bluff rim (as seen in /tmp/stahl_cliff_ref.png!)
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

  // 5. Lower-Slope Dark Mediterranean Chaparral Scrub (Ceanothus / Laurel Sumac mounds)
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
  // Aggregate concrete pool terrace deck & carport apron partitioned cleanly without overlaps
  const terraceGroup = new THREE.Group();
  terraceGroup.name = 'stahl.poolTerrace';

  const deckMinX = -13.75;
  const deckMaxX = X3 - 0.002;
  const poolOuterMinX = POOL_MIN_X - 0.14;
  const poolOuterMinZ = POOL_MIN_Z - 0.14;
  const poolOuterMaxZ = POOL_MAX_Z + 0.14;

  const northBreezewayMinZ = Z1 + 0.002;
  const northBreezewayMaxZ = poolOuterMinZ - 0.001;
  const northBreezeway = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(deckMaxX - deckMinX, 0.14, northBreezewayMaxZ - northBreezewayMinZ)),
    mats.aggregateDeck
  );
  northBreezeway.position.set((deckMinX + deckMaxX) * 0.5, -0.08, (northBreezewayMinZ + northBreezewayMaxZ) * 0.5);
  northBreezeway.receiveShadow = true;

  const westDeckMaxX = poolOuterMinX - 0.001;
  const westDeckMinZ = poolOuterMinZ + 0.001;
  const westDeckMaxZ = poolOuterMaxZ - 0.001;
  const westDeck = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(westDeckMaxX - deckMinX, 0.14, westDeckMaxZ - westDeckMinZ)),
    mats.aggregateDeck
  );
  westDeck.position.set((deckMinX + westDeckMaxX) * 0.5, -0.08, (westDeckMinZ + westDeckMaxZ) * 0.5);
  westDeck.receiveShadow = true;

  const southDeckMinZ = poolOuterMaxZ + 0.001;
  const southDeckMaxZ = 9.55;
  const southDeck = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(deckMaxX - deckMinX, 0.14, southDeckMaxZ - southDeckMinZ)),
    mats.aggregateDeck
  );
  southDeck.position.set((deckMinX + deckMaxX) * 0.5, -0.08, (southDeckMinZ + southDeckMaxZ) * 0.5);
  southDeck.receiveShadow = true;

  const apronMinX = -20.8;
  const apronMaxX = X0 - 0.002;
  const carportApron = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(apronMaxX - apronMinX, 0.139, Z1 - Z0)),
    mats.aggregateDeck
  );
  carportApron.position.set((apronMinX + apronMaxX) * 0.5, -0.0705, (Z0 + Z1) * 0.5);
  carportApron.receiveShadow = true;
  terraceGroup.add(westDeck, southDeck, northBreezeway, carportApron);

  // 20' x 26' Swimming Pool + Two Signature Water Inlets + Cast-Concrete Stepping Bridge Pads
  const plasterTileMat = new THREE.MeshStandardMaterial({
    color: 0x56b9c8,
    emissive: new THREE.Color(0x1bd4e8),
    emissiveIntensity: 0.35,
    roughness: 0.32,
  });
  const poolW = POOL_MAX_X - POOL_MIN_X;
  const poolD = POOL_MAX_Z - POOL_MIN_Z;
  const poolCenterX = (POOL_MIN_X + POOL_MAX_X) * 0.5;
  const poolCenterZ = (POOL_MIN_Z + POOL_MAX_Z) * 0.5;
  const poolWallTopY = -0.01;
  const poolWallBotY = POOL_FLOOR_Y - 0.07;
  const poolWallH = poolWallTopY - poolWallBotY;
  const poolWallMidY = poolWallBotY + poolWallH * 0.5;

  const poolFloor = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(poolW, 0.14, poolD)), plasterTileMat);
  poolFloor.position.set(poolCenterX, POOL_FLOOR_Y, poolCenterZ);
  const wallN = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(poolW + 0.28, poolWallH, 0.139)), plasterTileMat);
  wallN.position.set(poolCenterX, poolWallMidY, POOL_MIN_Z - 0.0705);
  const wallS = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(poolW + 0.28, poolWallH, 0.139)), plasterTileMat);
  wallS.position.set(poolCenterX, poolWallMidY, POOL_MAX_Z + 0.0705);
  const wallW = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.139, poolWallH, poolD)), plasterTileMat);
  wallW.position.set(POOL_MIN_X - 0.0705, poolWallMidY, poolCenterZ);
  const wallE = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.139, poolWallH, poolD)), plasterTileMat);
  wallE.position.set(POOL_MAX_X + 0.0705, poolWallMidY, poolCenterZ);

  // Central concrete pier separating the two East water inlets (`X in [-2.05..-1.151]`)
  const dividerMinX = -2.05;
  const dividerMaxX = POOL_MAX_X - 0.001;
  const dividerBotY = POOL_FLOOR_Y + 0.071;
  const dividerTopY = 0.01;
  const dividerH = dividerTopY - dividerBotY;
  const inletDivider = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(dividerMaxX - dividerMinX, dividerH, 1.55)),
    mats.concreteSlab
  );
  inletDivider.position.set((dividerMinX + dividerMaxX) * 0.5, dividerBotY + dividerH * 0.5, poolCenterZ);

  // Two signature cast-concrete stepping bridge pads spanning the North & South water inlets
  const bridgeNorth = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(1.45, 0.064, 1.35)), mats.concreteSlab);
  bridgeNorth.name = 'stahl.pool.bridgeNorth';
  bridgeNorth.position.set(-1.35, 0.024, 2.35);
  bridgeNorth.castShadow = bridgeNorth.receiveShadow = true;

  const bridgeSouth = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(1.45, 0.064, 1.35)), mats.concreteSlab);
  bridgeSouth.name = 'stahl.pool.bridgeSouth';
  bridgeSouth.position.set(-1.35, 0.024, 6.05);
  bridgeSouth.castShadow = bridgeSouth.receiveShadow = true;

  // Translucent cyan-turquoise water surface
  const waterMat = new THREE.MeshPhysicalMaterial({
    color: 0x39c9dc,
    emissive: new THREE.Color(0x10a8be),
    emissiveIntensity: 0.28,
    transparent: true,
    opacity: 0.72,
    roughness: 0.08,
    transmission: 0,
    ior: 1.333,
  });
  const waterMesh = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(poolW, 0.04, poolD)), waterMat);
  waterMesh.name = 'stahl.pool.water';
  waterMesh.position.set(poolCenterX, POOL_WATER_Y, poolCenterZ);
  attachAudioEmitter(waterMesh, {
    id: 'stahl-pool-water-lap',
    preset: 'waterFeature',
    zoneId: 'stahlPoolTerrace',
    volume: 0.25,
    refDistance: 2.2,
    maxDistance: 14.0,
  });

  terraceGroup.add(poolFloor, wallN, wallS, wallW, wallE, inletDivider, bridgeNorth, bridgeSouth, waterMesh);
  root.add(terraceGroup);

  // Bind underwater pool circuit (`stahlPoolUnderwater` — 2-way switched!)
  const poolGrp = (ctx.lightGroups as Record<string, LightCircuitGroup>).stahlPoolUnderwater;
  const nicheMat = new THREE.MeshStandardMaterial({
    color: 0xdffcff,
    emissive: new THREE.Color(0x3af0ff),
    emissiveIntensity: 2.2,
  });
  for (const z of [2.6, 5.8]) {
    const niche = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.11, 0.11, 0.04, 16)), nicheMat);
    niche.rotation.z = Math.PI / 2;
    niche.position.set(POOL_MAIN_MAX_X - 0.1, -0.65, z);
    terraceGroup.add(niche);
  }
  const poolLight = new THREE.PointLight(0x3be6f8, 3.6, 13.0, 2);
  poolLight.position.set(-5.6, -0.35, poolCenterZ);
  terraceGroup.add(poolLight);
  if (poolGrp) {
    poolGrp.emissives.push(nicheMat, plasterTileMat, waterMat);
    poolGrp.lights.push(poolLight);
  }

  // Cantilever overhang soffit wash (`stahlCantileverSoffit`)
  const soffitGrp = (ctx.lightGroups as Record<string, LightCircuitGroup>).stahlCantileverSoffit;
  const soffitStripMat = new THREE.MeshStandardMaterial({
    color: 0xfff8ea,
    emissive: new THREE.Color(0xffdca8),
    emissiveIntensity: 1.5,
  });
  const soffitBar = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.06, 0.03, Z3 - Z1)), soffitStripMat);
  soffitBar.position.set(X3 - CANTILEVER_M * 0.6, CLEAR_CEILING_Y - 0.054, (Z1 + Z3) * 0.5);
  const soffitLight = new THREE.PointLight(0xffdca8, 2.2, 10.0, 2);
  soffitLight.position.set(X3 - 1.0, 2.35, 6.1);
  root.add(soffitBar, soffitLight);
  if (soffitGrp) {
    soffitGrp.emissives.push(soffitStripMat);
    soffitGrp.lights.push(soffitLight);
  }

  // Van Keppel-Green poolside lounge chaises
  addVanKeppelChaise(root, -11.4, 3.2, Math.PI / 2, mats.steelCharcoal);
  addVanKeppelChaise(root, -11.4, 5.2, Math.PI / 2, mats.steelCharcoal);

  // Rocky decomposed-granite cliff outcrops, NE gravel nose + Agave attenuata, and dry golden-ochre chaparral tussocks
  buildStahlCliffOutcropsAndChaparral(root);

  // Subtle Los Angeles Basin Twilight City-Lights Vista Grid below the 125 ft cliff (`0` extra PointLights)
  const cityTex = createLaCityGridTexture();
  const cityMat = new THREE.MeshBasicMaterial({
    map: cityTex,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
  });
  const cityPlane = new THREE.Mesh(prepGeo(new THREE.PlaneGeometry(1800, 1800)), cityMat);
  cityPlane.name = 'stahl.vista.laCityGrid';
  cityPlane.rotation.x = -Math.PI / 2;
  // Positioned 58 m below the promontory FFL to the East & South across the LA Basin
  cityPlane.position.set(520, -58.0, 560);
  cityPlane.userData.ignoreWalkthroughCollision = true;
  root.add(cityPlane);

  // Sunset Strip / Hollywood Boulevard arterial light ribbon at cliff base (`0` PointLights)
  const stripMat = new THREE.MeshBasicMaterial({ color: 0xffc675, transparent: true, opacity: 0.65 });
  const sunsetRibbon = new THREE.Mesh(prepGeo(new THREE.PlaneGeometry(1400, 14)), stripMat);
  sunsetRibbon.rotation.x = -Math.PI / 2;
  sunsetRibbon.rotation.z = -0.18;
  sunsetRibbon.position.set(220, -56.5, 210);
  sunsetRibbon.userData.ignoreWalkthroughCollision = true;
  root.add(sunsetRibbon);
}
