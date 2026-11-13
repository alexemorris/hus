import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { applyMetricBoxUVs } from 'husjs/materials';
import { prepGeo } from 'husjs/objects';

/**
 * High-segment bevelled/radiused architectural & furniture box with 1:1 metric UVs.
 * Replaces sharp `BoxGeometry` slabs across counters, cabinetry, concrete slabs, and frames.
 */
const BEVELLED_BOX_CACHE = new Map<string, THREE.BufferGeometry>();

export function bevelledBox(
  w: number,
  h: number,
  d: number,
  radius = 0.008,
  segments = 4,
  tileW = 0.85,
  tileH = 0.85
): THREE.BufferGeometry {
  const safeR = Math.max(0.0008, Math.min(radius, w * 0.42, h * 0.42, d * 0.42));
  const minDim = Math.min(w, h, d);
  const effSegs = minDim < 0.08 ? 1 : Math.min(2, Math.max(1, segments));
  const key = `${w.toFixed(4)}|${h.toFixed(4)}|${d.toFixed(4)}|${safeR.toFixed(4)}|${effSegs}|${tileW.toFixed(3)}|${tileH.toFixed(3)}`;
  const hit = BEVELLED_BOX_CACHE.get(key);
  if (hit) return hit;
  const geo = new RoundedBoxGeometry(w, h, d, effSegs, safeR);
  geo.computeVertexNormals();
  const prepped = prepGeo(applyMetricBoxUVs(geo, { tileW, tileH }));
  BEVELLED_BOX_CACHE.set(key, prepped);
  return prepped;
}

export interface TuftedCushionOptions {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly crown?: number;
  readonly cornerPower?: number;
  readonly tuftsX?: number;
  readonly tuftsZ?: number;
  readonly tuftDepth?: number;
  readonly tuftRadius?: number;
  readonly segX?: number;
  readonly segY?: number;
  readonly segZ?: number;
  readonly tileM?: number;
}

/**
 * Watertight superellipsoid / pillowed upholstery cushion with physical recessed
 * Gaussian button-tuft dimple wells, smooth bevelled edges (`bevelSegments >= 6`),
 * and world-metric UVs.
 */
export function buildTuftedCushionGeo(opts: TuftedCushionOptions): THREE.BufferGeometry {
  const {
    width,
    height,
    depth,
    crown = Math.min(0.026, height * 0.24),
    cornerPower = 0.24,
    tuftsX = 0,
    tuftsZ = 0,
    tuftDepth = Math.min(0.018, height * 0.2),
    tuftRadius = 0.055,
    segX = 16,
    segY = 6,
    segZ = 14,
    tileM = 0.55,
  } = opts;

  const geo = new THREE.BoxGeometry(1, 1, 1, segX, segY, segZ);
  const pos = geo.attributes.position as THREE.BufferAttribute;

  const tuftCoords: [number, number][] = [];
  if (tuftsX > 0 && tuftsZ > 0) {
    for (let ix = 0; ix < tuftsX; ix++) {
      const tx = ((ix + 1) / (tuftsX + 1) - 0.5) * width;
      for (let iz = 0; iz < tuftsZ; iz++) {
        const tz = ((iz + 1) / (tuftsZ + 1) - 0.5) * depth;
        tuftCoords.push([tx, tz]);
      }
    }
  }

  const hw = width * 0.5;
  const hh = height * 0.5;
  const hd = depth * 0.5;
  const invR2 = 1 / Math.max(1e-5, tuftRadius * tuftRadius);

  const sgnPow = (v: number, p: number): number => Math.sign(v) * Math.pow(Math.abs(v), 1 - p);

  for (let i = 0; i < pos.count; i++) {
    const nx = pos.getX(i) * 2; // -1..1
    const ny = pos.getY(i) * 2; // -1..1
    const nz = pos.getZ(i) * 2; // -1..1

    // Map cube onto rounded superellipsoid so corners & edges have >= 6 smooth bevel subdivisions
    const len2 = nx * nx + ny * ny + nz * nz;
    const sphereFactor = len2 > 1e-6 ? 1 / Math.sqrt(len2) : 1;
    const blend = 0.34;
    const rx = nx * (1 - blend) + nx * sphereFactor * blend * 1.18;
    const ry = ny * (1 - blend) + ny * sphereFactor * blend * 1.14;
    const rz = nz * (1 - blend) + nz * sphereFactor * blend * 1.18;

    let x = sgnPow(Math.max(-1, Math.min(1, rx)), cornerPower * 0.45) * hw;
    let y = sgnPow(Math.max(-1, Math.min(1, ry)), cornerPower * 0.65) * hh;
    let z = sgnPow(Math.max(-1, Math.min(1, rz)), cornerPower * 0.45) * hd;

    // Pillowed upholstery crown across top & bottom faces
    const dome = Math.max(0, 1 - nx * nx * 0.85) * Math.max(0, 1 - nz * nz * 0.85);
    y += Math.sign(ny) * Math.pow(Math.abs(ny), 0.7) * crown * dome;

    // Subtle outward cheek bulge at mid-height
    const midBulge = Math.max(0, 1 - ny * ny) * 0.012;
    x *= 1 + midBulge;
    z *= 1 + midBulge;

    // Physical recessed button-tuft dimples + radiating pleats on top/bottom cushion faces
    if (tuftCoords.length > 0 && Math.abs(ny) > 0.25) {
      let dimple = 0;
      for (let t = 0; t < tuftCoords.length; t++) {
        const dx = x - tuftCoords[t]![0];
        const dz = z - tuftCoords[t]![1];
        const d2 = dx * dx + dz * dz;
        const g = Math.exp(-d2 * invR2);
        // Subtle diamond pleat creases radiating at +-45 deg from button well
        const pleat = Math.exp(-d2 * invR2 * 0.22) * (Math.abs(dx) < 0.014 || Math.abs(dz) < 0.014 ? 0.16 : 0);
        dimple = Math.max(dimple, g + pleat);
      }
      const faceWeight = Math.min(1, (Math.abs(ny) - 0.25) / 0.75);
      y -= Math.sign(ny) * tuftDepth * dimple * faceWeight;
    }

    pos.setXYZ(i, x, y, z);
  }

  geo.computeVertexNormals();
  return prepGeo(applyMetricBoxUVs(geo, { tileW: tileM, tileH: tileM }));
}

/**
 * Continuous closed perimeter welt/piping loop (`TubeGeometry`) for tailored MCM cushions.
 */
export function buildCushionWeltLoopGeo(
  width: number,
  depth: number,
  cornerRadius = 0.036,
  tubeRadius = 0.0048,
  tubularSegments = 64
): THREE.BufferGeometry {
  const hw = Math.max(0.02, width * 0.5);
  const hd = Math.max(0.02, depth * 0.5);
  const r = Math.min(cornerRadius, hw * 0.45, hd * 0.45);
  const pts: THREE.Vector3[] = [];
  const arcSteps = 5;
  const corners: readonly [number, number, number, number][] = [
    [hw - r, hd - r, 0, Math.PI * 0.5],
    [-(hw - r), hd - r, Math.PI * 0.5, Math.PI],
    [-(hw - r), -(hd - r), Math.PI, Math.PI * 1.5],
    [hw - r, -(hd - r), Math.PI * 1.5, Math.PI * 2],
  ];
  for (const [cx, cz, a0, a1] of corners) {
    for (let s = 0; s <= arcSteps; s++) {
      const a = a0 + ((a1 - a0) * s) / arcSteps;
      pts.push(new THREE.Vector3(cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r));
    }
  }
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.2);
  return prepGeo(new THREE.TubeGeometry(curve, tubularSegments, tubeRadius, 10, true));
}

/**
 * Adds covered domed upholstery buttons nestled cleanly into `buildTuftedCushionGeo` wells.
 */
export function addCushionTuftButtons(
  parent: THREE.Object3D,
  opts: {
    readonly width: number;
    readonly height: number;
    readonly depth: number;
    readonly crown?: number;
    readonly tuftsX: number;
    readonly tuftsZ: number;
    readonly tuftDepth?: number;
    readonly buttonRadius?: number;
    readonly material: THREE.Material;
    readonly bothSides?: boolean;
  }
): void {
  const {
    width,
    height,
    depth,
    crown = Math.min(0.026, height * 0.24),
    tuftsX,
    tuftsZ,
    tuftDepth = Math.min(0.018, height * 0.2),
    buttonRadius = 0.011,
    material,
    bothSides = false,
  } = opts;
  const btnGeo = prepGeo(new THREE.SphereGeometry(buttonRadius, 16, 10));
  btnGeo.scale(1, 0.45, 1);

  const hw = width * 0.5;
  const hd = depth * 0.5;
  for (let ix = 0; ix < tuftsX; ix++) {
    const tx = ((ix + 1) / (tuftsX + 1) - 0.5) * width;
    const nx = tx / hw;
    for (let iz = 0; iz < tuftsZ; iz++) {
      const tz = ((iz + 1) / (tuftsZ + 1) - 0.5) * depth;
      const nz = tz / hd;
      const dome = Math.max(0, 1 - nx * nx * 0.85) * Math.max(0, 1 - nz * nz * 0.85);
      const surfaceY = height * 0.5 + crown * dome - tuftDepth + buttonRadius * 0.48 + 0.0012;
      const topBtn = new THREE.Mesh(btnGeo, material);
      topBtn.position.set(tx, surfaceY, tz);
      parent.add(topBtn);
      if (bothSides) {
        const botBtn = new THREE.Mesh(btnGeo, material);
        botBtn.position.set(tx, -surfaceY, tz);
        parent.add(botBtn);
      }
    }
  }
}

export interface MoldedPlywoodShellOptions {
  readonly width: number;
  readonly depth: number;
  readonly sideCurl: number;
  readonly foreAftDish?: number;
  readonly frontLipDrop?: number;
  readonly cornerRound?: number;
  readonly thickness?: number;
  readonly segU?: number;
  readonly segV?: number;
  readonly tileM?: number;
}

/**
 * Watertight 3D compound-curved molded plywood veneer shell (`>= 32 x 22` grid)
 * for Eames 670/671 Lounge & Ottoman and Eames LCW chairs.
 * Features rounded planform corners, upward side bolsters, ergonomic fore-aft dish,
 * waterfall front lip, and thickened multi-ply rim.
 */
export function buildMoldedPlywoodShellGeo(opts: MoldedPlywoodShellOptions): THREE.BufferGeometry {
  const {
    width,
    depth,
    sideCurl,
    foreAftDish = 0.018,
    frontLipDrop = 0.024,
    cornerRound = 0.24,
    thickness = 0.013,
    segU = 32,
    segV = 22,
    tileM = 0.55,
  } = opts;

  return buildThickParametricSurfaceGeo(segU, segV, thickness, tileM, (u, v) => {
    const su = (u - 0.5) * 2; // -1..1 across width
    const sv = (v - 0.5) * 2; // -1..1 back..front
    // Rounded stadium-rectangle planform
    const cornerShrink = 1 - cornerRound * Math.pow(Math.abs(sv), 2.4);
    const x = su * width * 0.5 * cornerShrink;
    const z = sv * depth * 0.5;

    // Compound curvature: lateral wrap-up + fore-aft dish + waterfall front lip
    const lat = Math.pow(Math.abs(su), 2.15) * sideCurl;
    const dish = Math.pow(sv, 2) * foreAftDish;
    const lip = v > 0.72 ? -Math.pow((v - 0.72) / 0.28, 2.1) * frontLipDrop : 0;
    const y = lat + dish + lip;
    return new THREE.Vector3(x, y, z);
  });
}

/**
 * True 3D parametric Eames Molded Fiberglass `DSW` (side chair) & `DAW` (armchair)
 * organic bucket shell (`40 x 30` grid per face + continuous rolled rim).
 * Origin: seat center at `y = 0`, backrest rising at `-Z`, waterfall front lip at `+Z`.
 */
export function buildEamesFiberglassBucketGeo(
  variant: 'DSW' | 'DAW',
  segU = 40,
  segV = 30
): THREE.BufferGeometry {
  const isArm = variant === 'DAW';
  const thickness = 0.0075;

  return buildThickParametricSurfaceGeo(segU, segV, thickness, 0.45, (u, v) => {
    // u in [0, 1] left-to-right (-1..1), v in [0, 1] top-of-backrest -> front waterfall lip
    const su = (u - 0.5) * 2;
    const au = Math.abs(su);

    // v = 0..0.52 is backrest descending to seat crease; v = 0.52..1.0 is seat pan to front lip
    const backT = Math.max(0, Math.min(1, (0.54 - v) / 0.54)); // 1 at top of back, 0 at seat pan
    const seatT = Math.max(0, Math.min(1, (v - 0.46) / 0.54)); // 0 at back crease, 1 at front lip

    const seatHalfW = isArm ? 0.235 : 0.228;
    const topBackHalfW = isArm ? 0.215 : 0.205;
    const armFlare = isArm ? Math.sin(Math.pow(Math.max(0, 1 - Math.abs(v - 0.46) / 0.46), 1.4) * Math.PI * 0.5) * 0.078 : 0;

    // Rounded top backrest corners & rounded front seat corners
    const topRound = v < 0.14 ? Math.sqrt(Math.max(0.08, 1 - Math.pow((0.14 - v) / 0.14, 2) * 0.65)) : 1;
    const frontRound = v > 0.88 ? Math.sqrt(Math.max(0.12, 1 - Math.pow((v - 0.88) / 0.12, 2) * 0.55)) : 1;

    const halfW = (seatHalfW * (1 - backT * 0.12) + topBackHalfW * backT * 0.12 + armFlare) * topRound * frontRound;
    const x = su * halfW;

    // Z profile: backrest reclines to z = -0.245, seat crease at z = -0.14, front lip at z = +0.225
    const backReclineZ = -0.145 - Math.pow(backT, 1.25) * 0.105 + Math.sin(backT * Math.PI) * 0.016; // lumbar curve
    const seatPanZ = -0.145 + seatT * 0.37;
    // Wrap sides forward on DAW armrests / DSW side scoops
    const sideWrapZ = isArm
      ? Math.pow(au, 2.2) * (1 - backT * 0.55) * (1 - seatT * 0.45) * 0.16
      : Math.pow(au, 2.4) * (1 - backT * 0.65) * (1 - seatT * 0.7) * 0.055;
    const z = (v < 0.5 ? backReclineZ * (1 - v * 0.1) : seatPanZ) + sideWrapZ;

    // Y profile: backrest rises to +0.375 m, seat well dips -0.018 m, waterfall lip drops -0.032 m
    const backRiseY = Math.pow(backT, 1.08) * 0.375;
    const seatWellY = -Math.sin(seatT * Math.PI) * 0.018 * (1 - au * au * 0.7);
    const waterfallY = seatT > 0.78 ? -Math.pow((seatT - 0.78) / 0.22, 2) * 0.034 : 0;

    // Side bolsters / DAW armrests rise smoothly along edges
    const sideWallY = isArm
      ? Math.pow(au, 2.1) * Math.max(0, 1 - Math.pow((seatT - 0.22) / 0.78, 2)) * 0.195 * (1 - backT * 0.62)
      : Math.pow(au, 2.3) * (1 - seatT * 0.65) * (1 - backT * 0.7) * 0.068;
    // Outward rolled armrest lip on DAW
    const armRollY = isArm && au > 0.86 ? -Math.pow((au - 0.86) / 0.14, 2) * 0.014 : 0;

    const y = backRiseY + seatWellY + waterfallY + sideWallY + armRollY;
    return new THREE.Vector3(x, y, z);
  });
}

function buildThickParametricSurfaceGeo(
  segU: number,
  segV: number,
  thickness: number,
  tileM: number,
  evalPoint: (u: number, v: number) => THREE.Vector3
): THREE.BufferGeometry {
  const cols = segU + 1;
  const rows = segV + 1;
  const count = cols * rows;

  const midPts: THREE.Vector3[] = new Array(count);
  const normals: THREE.Vector3[] = new Array(count);

  for (let iv = 0; iv < rows; iv++) {
    const v = iv / segV;
    for (let iu = 0; iu < cols; iu++) {
      const u = iu / segU;
      midPts[iv * cols + iu] = evalPoint(u, v);
    }
  }

  const dU = new THREE.Vector3();
  const dV = new THREE.Vector3();
  for (let iv = 0; iv < rows; iv++) {
    const iv0 = Math.max(0, iv - 1);
    const iv1 = Math.min(segV, iv + 1);
    for (let iu = 0; iu < cols; iu++) {
      const iu0 = Math.max(0, iu - 1);
      const iu1 = Math.min(segU, iu + 1);
      dU.subVectors(midPts[iv * cols + iu1]!, midPts[iv * cols + iu0]!);
      dV.subVectors(midPts[iv1 * cols + iu]!, midPts[iv0 * cols + iu]!);
      const n = new THREE.Vector3().crossVectors(dV, dU);
      if (n.lengthSq() < 1e-10) n.set(0, 1, 0);
      else n.normalize();
      normals[iv * cols + iu] = n;
    }
  }

  // Vertices: [0..count-1] top face, [count..2*count-1] bottom face
  const positions = new Float32Array(count * 2 * 3);
  const uvs = new Float32Array(count * 2 * 2);
  const halfT = thickness * 0.5;

  for (let iv = 0; iv < rows; iv++) {
    const v = iv / segV;
    for (let iu = 0; iu < cols; iu++) {
      const u = iu / segU;
      const idx = iv * cols + iu;
      const p = midPts[idx]!;
      const n = normals[idx]!;

      positions[idx * 3] = p.x + n.x * halfT;
      positions[idx * 3 + 1] = p.y + n.y * halfT;
      positions[idx * 3 + 2] = p.z + n.z * halfT;

      const bIdx = count + idx;
      positions[bIdx * 3] = p.x - n.x * halfT;
      positions[bIdx * 3 + 1] = p.y - n.y * halfT;
      positions[bIdx * 3 + 2] = p.z - n.z * halfT;

      const uCoord = (u / Math.max(0.1, tileM)) * 0.65;
      const vCoord = (v / Math.max(0.1, tileM)) * 0.65;
      uvs[idx * 2] = uCoord;
      uvs[idx * 2 + 1] = vCoord;
      uvs[bIdx * 2] = uCoord;
      uvs[bIdx * 2 + 1] = vCoord;
    }
  }

  const indices: number[] = [];
  for (let iv = 0; iv < segV; iv++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = iv * cols + iu;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);

      const ba = count + a;
      const bb = count + b;
      const bc = count + c;
      const bd = count + d;
      indices.push(ba, bb, bc, bb, bd, bc);
    }
  }

  // Stitch perimeter rim cleanly around all 4 edges
  const stitchEdge = (i0: number, i1: number) => {
    indices.push(i0, count + i0, i1, i1, count + i0, count + i1);
  };
  for (let iu = 0; iu < segU; iu++) {
    stitchEdge(iu + 1, iu); // v = 0
    stitchEdge(segV * cols + iu, segV * cols + iu + 1); // v = segV
  }
  for (let iv = 0; iv < segV; iv++) {
    stitchEdge(iv * cols, (iv + 1) * cols); // u = 0
    stitchEdge((iv + 1) * cols + segU, iv * cols + segU); // u = segU
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return prepGeo(geo);
}

/**
 * Swept cast-aluminum 5-star (670 chair) or 4-star (671 ottoman) Eames spider base.
 */
export function buildSweptSpiderBaseGeo(
  arms: 4 | 5,
  radius: number,
  riseHeight: number,
  hubRadius = 0.036
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const hub = new THREE.CylinderGeometry(hubRadius * 0.85, hubRadius, riseHeight * 0.68, 28);
  hub.translate(0, riseHeight * 0.66, 0);
  parts.push(hub);

  for (let i = 0; i < arms; i++) {
    const ang = (i / arms) * Math.PI * 2;
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(cos * hubRadius * 0.55, riseHeight * 0.72, sin * hubRadius * 0.55),
      new THREE.Vector3(cos * radius * 0.45, riseHeight * 0.52, sin * radius * 0.45),
      new THREE.Vector3(cos * radius * 0.88, 0.024, sin * radius * 0.88),
      new THREE.Vector3(cos * radius, 0.012, sin * radius),
    ]);
    const arm = new THREE.TubeGeometry(curve, 20, 0.0125, 14, false);
    parts.push(arm);

    const glide = new THREE.CylinderGeometry(0.017, 0.02, 0.012, 20);
    glide.translate(cos * radius, 0.006, sin * radius);
    parts.push(glide);
  }

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  merged.computeVertexNormals();
  return prepGeo(merged);
}

/**
 * Eero Saarinen exponential-flare Tulip pedestal (`LatheGeometry`, 72 radial segments).
 */
export function buildSaarinenTulipPedestalGeo(
  baseRadius = 0.36,
  neckRadius = 0.052,
  topRadius = 0.24,
  height = 0.71,
  radialSegments = 72
): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [new THREE.Vector2(0, 0), new THREE.Vector2(baseRadius, 0)];
  const steps = 36;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = 0.006 + t * (height - 0.006);
    const baseFlare = (baseRadius - neckRadius) * Math.exp(-t * 10.5);
    const topFlare = (topRadius - neckRadius) * Math.pow(Math.max(0, (t - 0.52) / 0.48), 3.1);
    pts.push(new THREE.Vector2(neckRadius + baseFlare + topFlare, y));
  }
  pts.push(new THREE.Vector2(0, height));
  const geo = new THREE.LatheGeometry(pts, radialSegments);
  geo.computeVertexNormals();
  return prepGeo(geo);
}

/**
 * Saarinen knife-edge chamfered oval marble/travertine tabletop (`curveSegments >= 76, bevelSegments >= 7`).
 */
export function buildChamferedOvalSlabGeo(
  radiusX: number,
  radiusZ: number,
  thickness = 0.026,
  curveSegments = 80,
  bevelSegments = 7,
  tileM = 0.95
): THREE.BufferGeometry {
  // Build as a smooth profile lathe scaled elliptically in X/Z so the 35-deg chamfered
  // underside knife-edge has 100% uniform radial subdivision with zero Extrude artifacts!
  const pts: THREE.Vector2[] = [new THREE.Vector2(0, 0), new THREE.Vector2(0.86, 0)];
  for (let i = 0; i <= bevelSegments; i++) {
    const t = i / bevelSegments;
    const ang = -Math.PI * 0.42 + t * Math.PI * 0.92;
    const r = 0.86 + 0.14 * Math.sin(t * Math.PI * 0.5);
    const y = thickness * (0.15 + 0.85 * (0.5 + 0.5 * Math.sin(ang)));
    pts.push(new THREE.Vector2(Math.min(1, r), Math.min(thickness, Math.max(0, y))));
  }
  pts.push(new THREE.Vector2(0.985, thickness), new THREE.Vector2(0, thickness));
  const geo = new THREE.LatheGeometry(pts, curveSegments);
  geo.scale(radiusX, 1, radiusZ);
  geo.computeVertexNormals();
  return prepGeo(applyMetricBoxUVs(geo, { tileW: tileM, tileH: tileM }));
}

/**
 * George Nelson Saucer Bubble Pendant (`64 x 40` LatheGeometry).
 */
export function buildNelsonSaucerShadeGeo(
  radius = 0.34,
  height = 0.25,
  radialSegments = 64,
  profileSegments = 40
): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const throatR = radius * 0.24;
  for (let i = 0; i <= profileSegments; i++) {
    const t = i / profileSegments; // 0 bottom -> 1 top
    const phi = (t - 0.5) * Math.PI;
    const r = throatR + (radius - throatR) * Math.pow(Math.cos(phi), 0.78);
    const y = (t - 0.5) * height;
    pts.push(new THREE.Vector2(r, y));
  }
  const geo = new THREE.LatheGeometry(pts, radialSegments);
  geo.computeVertexNormals();
  return prepGeo(geo);
}

/**
 * Multi-harmonic floor-to-ceiling pinch-pleat sheer drapery mesh (`>= 76` horizontal segments).
 */
export function buildPinchPleatDraperyGeo(
  width: number,
  height: number,
  pleatDepth = 0.055,
  pleats = 11,
  segX = 80,
  segY = 20
): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(width, height, segX, segY);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const u = x / Math.max(1e-4, width) + 0.5;
    const vTop = 0.5 - y / Math.max(1e-4, height); // 0 at header, 1 at floor hem
    const primary = Math.sin(u * pleats * Math.PI * 2);
    // Triple-pinch harmonic at header relaxing into soft deep catenary folds toward hem
    const pinchWeight = Math.max(0, 1 - vTop * 1.45);
    const pinchHarmonic = Math.sin(u * pleats * Math.PI * 6) * 0.28 * pinchWeight;
    const secondary = Math.sin(u * pleats * Math.PI * 2 + vTop * 0.55) * 0.16 * vTop;
    const amp = pleatDepth * (0.62 + 0.38 * vTop);
    pos.setZ(i, (primary + pinchHarmonic + secondary) * amp);
  }
  geo.computeVertexNormals();
  return prepGeo(geo);
}

/**
 * Curved `TubeGeometry` chrome gooseneck or mid-century low-arc swivel faucet (`tubularSegments >= 44, radialSegments >= 18`).
 */
export function buildCurvedFaucetGeo(opts: {
  readonly reach: number;
  readonly rise: number;
  readonly style?: 'gooseneck' | 'swivel';
  readonly tubeRadius?: number;
  readonly tubularSegments?: number;
  readonly radialSegments?: number;
}): THREE.BufferGeometry {
  const {
    reach,
    rise,
    style = 'gooseneck',
    tubeRadius = 0.0095,
    tubularSegments = 48,
    radialSegments = 18,
  } = opts;

  const pts =
    style === 'gooseneck'
      ? [
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(0, rise * 0.55, 0),
          new THREE.Vector3(0, rise * 0.96, reach * 0.22),
          new THREE.Vector3(0, rise, reach * 0.62),
          new THREE.Vector3(0, rise * 0.78, reach * 0.94),
          new THREE.Vector3(0, rise * 0.56, reach),
        ]
      : [
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(0, rise * 0.45, 0),
          new THREE.Vector3(0, rise * 0.72, reach * 0.28),
          new THREE.Vector3(0, rise * 0.92, reach * 0.76),
          new THREE.Vector3(0, rise, reach * 0.96),
          new THREE.Vector3(0, rise * 0.84, reach),
        ];

  const curve = new THREE.CatmullRomCurve3(pts);
  const geo = new THREE.TubeGeometry(curve, tubularSegments, tubeRadius, radialSegments, false);
  geo.computeVertexNormals();
  return prepGeo(geo);
}

/**
 * Sculpted curved recessed sink basin bowl (`radialSegments >= 48`) with rolled rim flange & drain well.
 * Origin: top of rim at `y = 0`, bowl descending to `-bowlDepth`.
 */
export function buildSculptedBasinGeo(opts: {
  readonly width: number;
  readonly depth: number;
  readonly bowlDepth: number;
  readonly rimWidth?: number;
  readonly radialSegments?: number;
}): THREE.BufferGeometry {
  const { width, depth, bowlDepth, rimWidth = 0.018, radialSegments = 48 } = opts;
  const outerRX = width * 0.5;
  const outerRZ = depth * 0.5;
  const innerR = Math.max(0.45, 1 - rimWidth / Math.max(0.06, Math.min(outerRX, outerRZ)));

  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.055, -bowlDepth - 0.004),
    new THREE.Vector2(0.18, -bowlDepth),
  ];
  const steps = 16;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const r = 0.18 + (innerR - 0.18) * Math.sin(t * Math.PI * 0.5);
    const y = -bowlDepth * Math.cos(t * Math.PI * 0.5);
    pts.push(new THREE.Vector2(r, y));
  }
  // Rolled rim lip
  pts.push(
    new THREE.Vector2(innerR + (1 - innerR) * 0.35, 0.0035),
    new THREE.Vector2(1.0, 0.0015),
    new THREE.Vector2(1.0, -0.006)
  );

  const geo = new THREE.LatheGeometry(pts, radialSegments);
  geo.scale(outerRX, 1, outerRZ);
  geo.computeVertexNormals();
  return prepGeo(geo);
}

/**
 * Architectural Pottery (Gainey / Malcolm Leland 1958) stoneware cylinder-belly planter (`LatheGeometry`, 56 radial segs).
 * Origin: base at `y = 0`, rim at `y = height`.
 */
export function buildArchitecturalPotteryPlanterGeo(
  radiusTop: number,
  radiusBase: number,
  height: number,
  wallThickness = 0.016,
  radialSegments = 56
): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [new THREE.Vector2(0, 0), new THREE.Vector2(radiusBase * 0.92, 0)];
  const extSteps = 18;
  for (let i = 0; i <= extSteps; i++) {
    const t = i / extSteps;
    const belly = Math.sin(t * Math.PI) * 0.014;
    const footCurve = t < 0.12 ? Math.sin((t / 0.12) * Math.PI * 0.5) : 1;
    const r = radiusBase * (0.92 + 0.08 * footCurve) + (radiusTop - radiusBase) * t + belly;
    pts.push(new THREE.Vector2(r, t * height));
  }
  // Thick rolled stoneware rim into interior soil recess
  pts.push(
    new THREE.Vector2(radiusTop - wallThickness * 0.25, height + 0.003),
    new THREE.Vector2(radiusTop - wallThickness, height - 0.002),
    new THREE.Vector2(radiusTop - wallThickness * 1.05, height * 0.78),
    new THREE.Vector2(0, height * 0.78)
  );
  const geo = new THREE.LatheGeometry(pts, radialSegments);
  geo.computeVertexNormals();
  return prepGeo(geo);
}

/**
 * Multi-frond *Agave attenuata* (Foxtail Agave) rosette (`>= 24` fleshy leaves with true double curvature
 * + central furled bud cone). Origin at rosette crown `y = 0`.
 */
export function buildAgaveAttenuataRosetteGeo(leafCount = 24, scale = 1.0): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const goldenAngle = 2.39996323; // 137.508 deg phyllotaxis

  // Central furled bud cone
  const bud = new THREE.ConeGeometry(0.052 * scale, 0.28 * scale, 18, 4);
  bud.translate(0, 0.16 * scale, 0);
  bud.deleteAttribute('normal');
  bud.deleteAttribute('uv');
  parts.push(bud);

  const lenSegs = 10;
  const widSegs = 6; // 7 cross-section vertices per leaf

  for (let i = 0; i < leafCount; i++) {
    const rank = i / Math.max(1, leafCount - 1); // 0 = inner upright leaves, 1 = outer recurved leaves
    const azimuth = i * goldenAngle;
    const leafLen = (0.34 + rank * 0.26) * scale;
    const maxHalfW = (0.044 + rank * 0.026) * scale;
    const pitch0 = 1.24 - rank * 0.88; // inner upright, outer gracefully arching
    const archDroop = (0.14 + rank * 0.34) * scale;

    const cols = widSegs + 1;
    const rows = lenSegs + 1;
    const positions = new Float32Array(cols * rows * 3);
    const indices: number[] = [];

    for (let il = 0; il < rows; il++) {
      const s = il / lenSegs; // 0 base -> 1 tip
      // Spoon-shaped Agave attenuata blade width: narrow neck -> wide mid-blade -> soft acuminate tip
      const widthEnv =
        s < 0.18
          ? 0.45 + (s / 0.18) * 0.32
          : Math.sin(Math.pow(Math.max(0, 1 - (s - 0.18) / 0.82), 0.72) * Math.PI * 0.5) * 1.05;
      const hw = maxHalfW * Math.max(0.015, widthEnv);

      // Spine curve in local radial-vertical plane
      const rDist = (0.032 * scale + s * leafLen * Math.cos(pitch0 * 0.55)) * (1 + rank * 0.08);
      const ySpine =
        0.04 * scale +
        s * leafLen * Math.sin(pitch0) -
        Math.pow(s, 2.25) * archDroop;

      const cosA = Math.cos(azimuth);
      const sinA = Math.sin(azimuth);

      for (let iw = 0; iw < cols; iw++) {
        const u = (iw / widSegs - 0.5) * 2; // -1..1 across leaf blade
        // Double curvature: concave upper channel + fleshy keel thickness
        const cup = Math.pow(Math.abs(u), 1.85) * 0.014 * scale * (1 - s * 0.65);
        const fleshy = (1 - u * u) * 0.008 * scale * (1 - s * 0.75);
        const lateral = u * hw;

        const wx = cosA * rDist - sinA * lateral;
        const wz = sinA * rDist + cosA * lateral;
        const wy = ySpine + cup + fleshy;

        const vIdx = (il * cols + iw) * 3;
        positions[vIdx] = wx;
        positions[vIdx + 1] = wy;
        positions[vIdx + 2] = wz;
      }
    }

    for (let il = 0; il < lenSegs; il++) {
      for (let iw = 0; iw < widSegs; iw++) {
        const a = il * cols + iw;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
        // Backface for thick fleshy double-sided shading
        indices.push(a, b, c, b, d, c);
      }
    }

    const leafGeo = new THREE.BufferGeometry();
    leafGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    leafGeo.setIndex(indices);
    parts.push(leafGeo);
  }

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  merged.computeVertexNormals();
  return prepGeo(merged);
}

/**
 * Smooth high-subdivision FBM-sculpted decomposed-granite outcrop boulder (`IcosahedronGeometry(radius, 4)` = 5,120 tris).
 * Eliminates spiky low-poly polyhedra and projects clean world-metric box UVs.
 */
export function buildSmoothGraniteBoulderGeo(
  radius: number,
  seed: number,
  detail = 4,
  squashY = 0.68
): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(radius, detail);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const p1 = seed * 1.713;
  const p2 = seed * 2.937;
  const p3 = seed * 4.319;

  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    const vz = pos.getZ(i);
    const len = Math.hypot(vx, vy, vz) || 1;
    const nx = vx / len;
    const ny = vy / len;
    const nz = vz / len;

    // Smooth 3-octave continuous spherical FBM + subtle weathered bedding strata
    const o1 = Math.sin(nx * 2.3 + p1) * Math.cos(ny * 2.1 - p2) + Math.sin(nz * 2.5 + p3) * 0.65;
    const o2 = Math.sin((nx * 4.7 + nz * 3.9) + p2) * Math.cos(ny * 4.3 + p1) * 0.34;
    const o3 = Math.sin(nx * 9.1 - ny * 7.8 + p3) * Math.cos(nz * 8.6 - p1) * 0.12;
    const strata = Math.sin(ny * 7.5 + o1 * 1.1) * 0.045;

    const disp = 1 + o1 * 0.16 + o2 * 0.1 + o3 * 0.04 + strata;
    pos.setXYZ(i, vx * disp, vy * disp * squashY, vz * disp);
  }

  geo.computeVertexNormals();
  return prepGeo(applyMetricBoxUVs(geo, { tileW: 1.4, tileH: 1.4 }));
}

/**
 * Natural curved & split ceramic gas-hearth log (`28 x 18` segments) for Koenig's 4-sided fireplace.
 */
export function buildSplitCeramicLogGeo(
  length: number,
  radius: number,
  bend = 0.028,
  seed = 1
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-length * 0.5, 0, -bend * 0.4),
    new THREE.Vector3(-length * 0.16, bend * 0.45, bend * 0.5),
    new THREE.Vector3(length * 0.18, bend * 0.25, -bend * 0.35),
    new THREE.Vector3(length * 0.5, -bend * 0.15, bend * 0.3),
  ]);
  const geo = new THREE.TubeGeometry(curve, 28, radius, 18, false);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ang = Math.atan2(y, z);
    // Bark ridge & split-face modulation
    const bark = 1 + Math.sin(ang * 7 + x * 18 + seed * 3.1) * 0.08 + Math.cos(ang * 3 - x * 9) * 0.05;
    const split = ang > 0.7 && ang < 2.2 ? 0.82 : 1.0;
    pos.setXYZ(i, x, y * bark * split, z * bark * split);
  }
  geo.computeVertexNormals();
  return prepGeo(applyMetricBoxUVs(geo, { tileW: 0.35, tileH: 0.35 }));
}
