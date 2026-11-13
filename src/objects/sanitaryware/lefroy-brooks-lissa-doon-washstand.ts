import * as THREE from 'three';
import { attachAssetMetadata, formatBrasswareFinishLabel, resolveBrasswareCode } from '../shared/catalog-smart-metadata.ts';
import {
  finalizeSanitaryGroup,
  getBathroomBrassMaterials,
  getVitreousChinaMaterial,
} from './bathroom-materials.ts';
import { prepGeo } from '../shared/scene-helpers.ts';
import { buildArmstrongDeck3HoleBasinMixer } from './perrin-rowe-armstrong.ts';
import {
  buildBasinTapFromSpec,
  isCustomTapObject3D,
  mountTapOnFixture,
  registerTapMountAnchor,
} from './perrin-rowe-taps.ts';
import type { LefroyBrooksLissaDoonWashstandOptions } from './bathroom-spec-types.ts';

/**
 * Lefroy Brooks `Lissa Doon` Console Washstand (`LB 7503`):
 * - Softly rounded Edwardian Vitreous China basin (`W700 × D540 × H850mm` rim) with rolled
 *   bullnose perimeter rim, low cambered rear upstand curb, flattened rear 3TH ceramic tap deck,
 *   deep sculpted sunken ceramic bowl + underbelly, and integrated waste plug.
 * - Open tubular metal console frame (`'SB'`, `'PF'`, `'BR'`) with front vertical legs,
 *   turned Edwardian spherical ball-joint nodes, side wall stays, front & side tubular towel rails,
 *   and lower stability cross-rail.
 * - Exposed matching `6303` cylindrical metal bottle trap & wall waste pipe + rigid Ø15mm
 *   hot/cold metal supply pipes with inline isolation valves underneath.
 * - Optional mounted Perrin & Rowe `3606` Armstrong 3-hole deck basin mixer w/ pop-up waste.
 */

function createWallEscutcheonGeometry(outerR: number, innerR: number, depth: number): THREE.LatheGeometry {
  const pts = [
    new THREE.Vector2(innerR * 0.9, 0),
    new THREE.Vector2(outerR, 0),
    new THREE.Vector2(outerR, depth * 0.45),
    new THREE.Vector2(outerR * 0.78, depth * 0.62),
    new THREE.Vector2(outerR * 0.76, depth * 0.92),
    new THREE.Vector2(innerR, depth),
  ];
  return prepGeo(new THREE.LatheGeometry(pts, 28));
}

/**
 * Samples the closed 2D plan contour `(x, z)` of the softly rounded Edwardian `LB 7503`
 * console basin: flat rear wall (`z = 0`), rounded front corners, and subtle gentle bow-front
 * curve reaching `z = depthM` at `x = 0`. Ordered counter-clockwise in `(X, Z)` so extruding/lofting
 * upward along `+Y` faces outward.
 */
function buildDenseEdwardianBasinPerimeter(
  widthM: number,
  depthM: number,
  insetM: number
): THREE.Vector2[] {
  const hw = Math.max(0.08, widthM * 0.5 - insetM);
  const zBack = Math.max(0, insetM * 0.5);
  const bowAmp = Math.max(0, 0.014 - insetM * 0.08);
  const zFrontCorner = Math.max(zBack + 0.08, depthM - bowAmp - insetM);
  const cornerR = Math.min(0.068, hw * 0.35, (zFrontCorner - zBack) * 0.42);

  const dense: THREE.Vector2[] = [];
  // Start at rear centre (0, zBack) and proceed counter-clockwise in (X, Z) so lofted normals
  // point upward (+Y) on the deck, outward on the exterior apron, and inward/upward inside the bowl.
  const rearHalfSteps = 32;
  for (let i = 0; i <= rearHalfSteps; i++) {
    const x = -(hw * i) / rearHalfSteps;
    dense.push(new THREE.Vector2(x, zBack));
  }

  // Left side (-hw) advancing forward to front-left rounded corner
  const sideSteps = 32;
  for (let i = 1; i <= sideSteps; i++) {
    const z = zBack + ((zFrontCorner - cornerR - zBack) * i) / sideSteps;
    dense.push(new THREE.Vector2(-hw, z));
  }

  // Front-left quarter-arc: (-hw, zFrontCorner - cornerR) -> (-hw + cornerR, zFrontCorner)
  const arcSteps = 24;
  for (let i = 1; i <= arcSteps; i++) {
    const a = Math.PI - (i / arcSteps) * (Math.PI * 0.5);
    const x = -hw + cornerR + Math.cos(a) * cornerR;
    const zBase = zFrontCorner - cornerR + Math.sin(a) * cornerR;
    const bow = bowAmp * Math.max(0, 1 - (x / hw) * (x / hw));
    dense.push(new THREE.Vector2(x, zBase + bow));
  }

  // Softly bowed Edwardian front apron from left (-hw + cornerR) -> right (+hw - cornerR)
  const frontSteps = 48;
  for (let i = 1; i < frontSteps; i++) {
    const t = i / frontSteps;
    const x = -hw + cornerR + 2 * (hw - cornerR) * t;
    const bow = bowAmp * (1 - (x / hw) * (x / hw));
    dense.push(new THREE.Vector2(x, zFrontCorner + bow));
  }

  // Front-right quarter-arc: (+hw - cornerR, zFrontCorner) -> (+hw, zFrontCorner - cornerR)
  for (let i = 0; i <= arcSteps; i++) {
    const a = Math.PI * 0.5 - (i / arcSteps) * (Math.PI * 0.5);
    const x = hw - cornerR + Math.cos(a) * cornerR;
    const zBase = zFrontCorner - cornerR + Math.sin(a) * cornerR;
    const bow = bowAmp * Math.max(0, 1 - (x / hw) * (x / hw));
    dense.push(new THREE.Vector2(x, zBase + bow));
  }

  // Right side (+hw) returning back to (+hw, zBack)
  for (let i = 1; i <= sideSteps; i++) {
    const z = zFrontCorner - cornerR - ((zFrontCorner - cornerR - zBack) * i) / sideSteps;
    dense.push(new THREE.Vector2(hw, z));
  }

  // Rear right half returning from (+hw, zBack) back to (0, zBack)
  for (let i = 1; i <= rearHalfSteps; i++) {
    const x = hw * (1 - i / rearHalfSteps);
    dense.push(new THREE.Vector2(x, zBack));
  }

  return dense;
}

/**
 * Resamples the closed 2D plan contour uniformly by arc-length into `segmentCount`
 * equal perimeter intervals (`segmentCount + 1` closed vertices, including dense
 * evenly spaced vertices along the flat rear `620mm`-`700mm` edge).
 */
function sampleEdwardianBasinOuterContour(
  widthM: number,
  depthM: number,
  insetM: number,
  segmentCount = 64
): THREE.Vector2[] {
  const dense = buildDenseEdwardianBasinPerimeter(widthM, depthM, insetM);
  const cumLen = new Float64Array(dense.length);
  for (let i = 1; i < dense.length; i++) {
    cumLen[i] = cumLen[i - 1]! + dense[i]!.distanceTo(dense[i - 1]!);
  }
  const totalLen = cumLen[dense.length - 1]!;
  const out: THREE.Vector2[] = [];
  let segIdx = 0;
  for (let k = 0; k < segmentCount; k++) {
    const target = (totalLen * k) / segmentCount;
    while (segIdx < dense.length - 2 && cumLen[segIdx + 1]! < target) {
      segIdx++;
    }
    const l0 = cumLen[segIdx]!;
    const l1 = cumLen[segIdx + 1]!;
    const alpha = l1 > l0 ? (target - l0) / (l1 - l0) : 0;
    out.push(dense[segIdx]!.clone().lerp(dense[segIdx + 1]!, alpha));
  }
  out.push(out[0]!.clone());
  return out;
}

/**
 * Samples an inset outer contour along the exact radial azimuth rays `azimuths` originating
 * at `(0, bowlCenterZ)`, guaranteeing 0.0 deg twist across every outer apron/rim ring as well.
 */
function sampleEdwardianOuterContourAtAzimuths(
  widthM: number,
  depthM: number,
  insetM: number,
  bowlCenterZ: number,
  azimuths: readonly number[]
): THREE.Vector2[] {
  const dense = buildDenseEdwardianBasinPerimeter(widthM, depthM, insetM);
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < azimuths.length - 1; i++) {
    const theta = azimuths[i]!;
    const ux = Math.cos(theta);
    const uz = Math.sin(theta);
    let bestR = 0;
    for (let j = 0; j < dense.length - 1; j++) {
      const ax = dense[j]!.x;
      const az = dense[j]!.y - bowlCenterZ;
      const bx = dense[j + 1]!.x;
      const bz = dense[j + 1]!.y - bowlCenterZ;
      const dx = bx - ax;
      const dz = bz - az;
      // Solve r * (ux, uz) = (ax, az) + t * (dx, dz), t in [0, 1], r > 0
      const det = ux * dz - uz * dx;
      if (Math.abs(det) < 1e-12) continue;
      const t = (ux * az - uz * ax) / -det;
      if (t >= -1e-7 && t <= 1 + 1e-7) {
        const r = (ax * dz - az * dx) / det;
        if (r > bestR) bestR = r;
      }
    }
    out.push(new THREE.Vector2(bestR * ux, bowlCenterZ + bestR * uz));
  }
  out.push(out[0]!.clone());
  return out;
}

/**
 * Samples the closed superellipse bowl contour around `(0, bowlCenterZ)` along the EXACT
 * radial azimuths `theta_i = atan2(outer[i].z - bowlCenterZ, outer[i].x)` so every bridge
 * quad `outer[i] <-> bowl[i]` on both the top ceramic deck and underside apron has 0.0 deg twist.
 */
function sampleBowlContourAtAzimuths(
  azimuths: readonly number[],
  bowlHalfW: number,
  bowlHalfD: number,
  bowlCenterZ: number
): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  const q = 2.25;
  for (let i = 0; i < azimuths.length - 1; i++) {
    const theta = azimuths[i]!;
    const ux = Math.cos(theta);
    const uz = Math.sin(theta);
    const denom =
      Math.pow(Math.abs(ux) / Math.max(1e-6, bowlHalfW), q) +
      Math.pow(Math.abs(uz) / Math.max(1e-6, bowlHalfD), q);
    const r = denom > 0 ? Math.pow(denom, -1 / q) : 0;
    out.push(new THREE.Vector2(r * ux, bowlCenterZ + r * uz));
  }
  out.push(out[0]!.clone());
  return out;
}

function buildLoftedClosedContours(
  rings: readonly { readonly pts: readonly THREE.Vector2[]; readonly y: number; readonly vUv: number }[]
): THREE.BufferGeometry {
  const stride = rings[0]!.pts.length;
  const positions = new Float32Array(rings.length * stride * 3);
  const uvs = new Float32Array(rings.length * stride * 2);
  const indices: number[] = [];

  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r]!;
    for (let i = 0; i < stride; i++) {
      const pt = ring.pts[i]!;
      const idx = r * stride + i;
      positions[idx * 3] = pt.x;
      positions[idx * 3 + 1] = ring.y;
      positions[idx * 3 + 2] = pt.y;
      uvs[idx * 2] = i / Math.max(1, stride - 1);
      uvs[idx * 2 + 1] = ring.vUv;
    }
  }

  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < stride - 1; i++) {
      const i00 = r * stride + i;
      const i10 = (r + 1) * stride + i;
      const i01 = r * stride + (i + 1);
      const i11 = (r + 1) * stride + (i + 1);
      indices.push(i00, i01, i10, i01, i11, i10);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  // Smooth closed-seam normals (i = 0 and i = stride - 1) and clean vertical normals at poles
  const normAttr = geo.getAttribute("normal") as THREE.BufferAttribute;
  for (let r = 0; r < rings.length; r++) {
    if (r === 0) {
      for (let i = 0; i < stride; i++) normAttr.setXYZ(r * stride + i, 0, -1, 0);
      continue;
    }
    if (r === rings.length - 1) {
      for (let i = 0; i < stride; i++) normAttr.setXYZ(r * stride + i, 0, 1, 0);
      continue;
    }
    const i0 = r * stride;
    const iLast = r * stride + (stride - 1);
    const nx = normAttr.getX(i0) + normAttr.getX(iLast);
    const ny = normAttr.getY(i0) + normAttr.getY(iLast);
    const nz = normAttr.getZ(i0) + normAttr.getZ(iLast);
    const len = Math.hypot(nx, ny, nz) || 1;
    normAttr.setXYZ(i0, nx / len, ny / len, nz / len);
    normAttr.setXYZ(iLast, nx / len, ny / len, nz / len);
  }
  normAttr.needsUpdate = true;

  return prepGeo(geo);
}

export function buildLefroyBrooksLissaDoonWashstand(
  opts: LefroyBrooksLissaDoonWashstandOptions
): THREE.Group {
  const p = opts.namePrefix;
  const widthM = opts.widthM ?? 0.700;
  const depthM = opts.depthM ?? 0.540;
  const rimHeightM = opts.rimHeightM ?? 0.850;
  const effectiveTapHoles: 0 | 1 | 3 =
    opts.tap === 'none'
      ? opts.tapHoles ?? 0
      : opts.tap !== undefined && opts.tap !== 'default' && !isCustomTapObject3D(opts.tap)
        ? opts.tap.mount === '2-hole-wall'
          ? 0
          : opts.tap.mount === 'monobloc-deck'
            ? 1
            : 3
        : opts.tapHoles ?? 3;
  const tapHoles: 0 | 3 = effectiveTapHoles === 3 ? 3 : 0;
  const includeDeckMixer = opts.includeDeckMixer ?? tapHoles !== 0;
  const mountVariant = opts.mountVariant ?? "consoleLegs";

  const chinaMat = getVitreousChinaMaterial();
  const rawMetalMats = getBathroomBrassMaterials(opts.finish);
  const smoothCollars = opts.mixerStyle === "langbourn" || opts.mixerStyle === "traditional";
  const metalMats = smoothCollars
    ? { primary: rawMetalMats.primary, knurled: rawMetalMats.primary, darkShadow: rawMetalMats.darkShadow }
    : rawMetalMats;

  const wasteMats = opts.wasteFinish ? getBathroomBrassMaterials(opts.wasteFinish) : metalMats;
  const group = new THREE.Group();
  group.name = p;

  const apronBottomY = rimHeightM - 0.112; // 0.738m
  const bowlDepthDrop = 0.152;
  const bowlFloorY = rimHeightM - bowlDepthDrop; // 0.698m
  const bowlUnderbellyY = bowlFloorY - 0.018; // 0.680m

  // Rear tap deck occupies z = 0.030 .. 0.145m (tap hole centre line at z = 0.088m);
  // Sunken oval bowl occupies z = 0.148 .. depthM - 0.068m.
  const deckTapZ = 0.088;
  const bowlFrontMargin = 0.068;
  const bowlRearZ = 0.148;
  const bowlFrontZ = Math.max(bowlRearZ + 0.20, depthM - bowlFrontMargin);
  const bowlCenterZ = (bowlRearZ + bowlFrontZ) * 0.5;
  const bowlHalfD = (bowlFrontZ - bowlRearZ) * 0.5;
  const bowlHalfW = Math.max(0.18, widthM * 0.5 - 0.085);

  // Vitreous China Edwardian Console Basin (`LB 7503`)
  const basinGroup = new THREE.Group();
  basinGroup.name = `${p}.ceramicBasin`;
  group.add(basinGroup);

  const cRimOuter = sampleEdwardianBasinOuterContour(widthM, depthM, 0.0, 64);
  const radialAzimuths = cRimOuter.map((pt) => Math.atan2(pt.y - bowlCenterZ, pt.x));
  const cApronBot = sampleEdwardianOuterContourAtAzimuths(widthM, depthM, 0.016, bowlCenterZ, radialAzimuths);
  const cApronMid = sampleEdwardianOuterContourAtAzimuths(widthM, depthM, 0.012, bowlCenterZ, radialAzimuths);
  const cRimUnder = sampleEdwardianOuterContourAtAzimuths(widthM, depthM, 0.004, bowlCenterZ, radialAzimuths);
  const cRimCrest = sampleEdwardianOuterContourAtAzimuths(widthM, depthM, 0.010, bowlCenterZ, radialAzimuths);

  const cBowlRim = sampleBowlContourAtAzimuths(radialAzimuths, bowlHalfW, bowlHalfD, bowlCenterZ);
  const cBowlUpper = sampleBowlContourAtAzimuths(radialAzimuths, bowlHalfW * 0.94, bowlHalfD * 0.93, bowlCenterZ);
  const cBowlMid = sampleBowlContourAtAzimuths(radialAzimuths, bowlHalfW * 0.80, bowlHalfD * 0.78, bowlCenterZ);
  const cBowlCove = sampleBowlContourAtAzimuths(radialAzimuths, bowlHalfW * 0.58, bowlHalfD * 0.56, bowlCenterZ);
  const cBowlWell = sampleBowlContourAtAzimuths(radialAzimuths, 0.032, 0.032, bowlCenterZ);
  const cBowlCenter = sampleBowlContourAtAzimuths(radialAzimuths, 0.0005, 0.0005, bowlCenterZ);

  // Sculpted ceramic shell: underside of apron -> bullnose rolled rim -> flat tap/side deck -> sunken interior bowl!
  const basinShellGeo = buildLoftedClosedContours([
    { pts: cBowlCenter, y: bowlUnderbellyY, vUv: 0.0 },
    { pts: sampleBowlContourAtAzimuths(radialAzimuths, bowlHalfW * 0.70, bowlHalfD * 0.68, bowlCenterZ), y: bowlUnderbellyY, vUv: 0.10 },
    { pts: sampleBowlContourAtAzimuths(radialAzimuths, bowlHalfW * 0.88, bowlHalfD * 0.88, bowlCenterZ), y: apronBottomY + 0.008, vUv: 0.22 },
    { pts: cApronBot, y: apronBottomY, vUv: 0.30 },
    { pts: cApronMid, y: rimHeightM - 0.032, vUv: 0.42 },
    { pts: cRimUnder, y: rimHeightM - 0.024, vUv: 0.46 },
    { pts: cRimOuter, y: rimHeightM - 0.011, vUv: 0.50 },
    { pts: cRimCrest, y: rimHeightM, vUv: 0.55 },
    { pts: cBowlRim, y: rimHeightM - 0.002, vUv: 0.64 },
    { pts: cBowlUpper, y: rimHeightM - 0.036, vUv: 0.72 },
    { pts: cBowlMid, y: rimHeightM - 0.098, vUv: 0.82 },
    { pts: cBowlCove, y: bowlFloorY + 0.014, vUv: 0.90 },
    { pts: cBowlWell, y: bowlFloorY, vUv: 0.97 },
    { pts: cBowlCenter, y: bowlFloorY, vUv: 1.0 },
  ]);
  const basinShellMesh = new THREE.Mesh(basinShellGeo, chinaMat);
  basinShellMesh.name = `${p}.ceramicBasin.shell`;
  basinGroup.add(basinShellMesh);

  // Low cambered integral Edwardian rear ceramic splashback upstand curb (z = 0 .. 0.030m, clearing 3TH mixer!)
  const upstandSegs = 20;
  const upstandShape = new THREE.Shape();
  const upstandHalfW = widthM * 0.5 - 0.008;
  upstandShape.moveTo(-upstandHalfW, 0);
  for (let i = 0; i <= upstandSegs; i++) {
    const u = i / upstandSegs;
    const x = -upstandHalfW + 2 * upstandHalfW * u;
    const arch = Math.sin(u * Math.PI);
    const h = 0.026 + 0.018 * arch; // 26mm at ends rising gracefully to 44mm at x = 0
    upstandShape.lineTo(x, h);
  }
  upstandShape.lineTo(upstandHalfW, 0);
  upstandShape.closePath();

  const upstandGeo = new THREE.ExtrudeGeometry(upstandShape, {
    depth: 0.026,
    bevelEnabled: true,
    bevelThickness: 0.003,
    bevelSize: 0.003,
    bevelSegments: 2,
  });
  upstandGeo.computeBoundingBox();
  if (upstandGeo.boundingBox) {
    upstandGeo.translate(0, 0, -upstandGeo.boundingBox.min.z);
  }
  const upstandMesh = new THREE.Mesh(prepGeo(upstandGeo), chinaMat);
  upstandMesh.name = `${p}.ceramicBasin.rearSplashbackCurb`;
  upstandMesh.position.set(0, rimHeightM - 0.002, 0);
  basinGroup.add(upstandMesh);

  // Rear overflow slot bezel on upper rear interior bowl wall
  const overflowBezel = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(0.044, 0.012, 0.005)),
    metalMats.primary
  );
  overflowBezel.name = `${p}.ceramicBasin.overflowBezel`;
  overflowBezel.position.set(0, rimHeightM - 0.042, bowlRearZ + 0.006);
  overflowBezel.rotation.x = 0.18;
  basinGroup.add(overflowBezel);

  const overflowSlot = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(0.034, 0.005, 0.0045)),
    metalMats.darkShadow
  );
  overflowSlot.name = `${p}.ceramicBasin.overflowSlot`;
  overflowSlot.position.set(0, rimHeightM - 0.042, bowlRearZ + 0.0072);
  overflowSlot.rotation.x = 0.18;
  basinGroup.add(overflowSlot);

  // Integrated pop-up / click-clack waste flange & dome plug in bowl floor
  const wasteFlange = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.031, 0.031, 0.003, 28)),
    wasteMats.primary
  );
  wasteFlange.name = `${p}.ceramicBasin.wasteFlange`;
  wasteFlange.position.set(0, bowlFloorY + 0.001, bowlCenterZ);
  basinGroup.add(wasteFlange);

  const wasteShadow = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.024, 0.024, 0.003, 24)),
    wasteMats.darkShadow
  );
  wasteShadow.name = `${p}.ceramicBasin.wasteAnnulus`;
  wasteShadow.position.set(0, bowlFloorY + 0.0018, bowlCenterZ);
  basinGroup.add(wasteShadow);

  const wastePlugPts = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.021, 0),
    new THREE.Vector2(0.021, 0.0035),
    new THREE.Vector2(0.015, 0.0065),
    new THREE.Vector2(0, 0.0078),
  ];
  const wastePlug = new THREE.Mesh(
    prepGeo(new THREE.LatheGeometry(wastePlugPts, 28)),
    wasteMats.primary
  );
  wastePlug.name = `${p}.ceramicBasin.popUpWastePlug`;
  wastePlug.position.set(0, bowlFloorY + 0.0025, bowlCenterZ);
  basinGroup.add(wastePlug);

  // Deck-Mounted Perrin & Rowe 3-Hole Basin Mixer (`3606`) or Composable Tap
  const valveSpreadM = 0.200;
  registerTapMountAnchor(group, {
    deckPosition: [0, rimHeightM + 0.0005, deckTapZ],
    wallPosition: [0, rimHeightM + 0.145, 0],
    wastePosition: [0, bowlFloorY, bowlCenterZ],
    holeCount: effectiveTapHoles,
    rotationY: 0,
  });

  if (opts.tap !== undefined && opts.tap !== 'default') {
    if (opts.tap === 'none') {
      if (opts.tapHoles === 3) {
        for (const [idx, hx] of [
          ['left', -valveSpreadM * 0.5],
          ['centre', 0],
          ['right', valveSpreadM * 0.5],
        ] as const) {
          const hole = new THREE.Mesh(
            prepGeo(new THREE.CylinderGeometry(0.015, 0.015, 0.003, 20)),
            metalMats.darkShadow
          );
          hole.name = `${p}.ceramicBasin.tapHole.${idx}`;
          hole.position.set(hx, rimHeightM, deckTapZ);
          basinGroup.add(hole);
        }
      }
    } else if (isCustomTapObject3D(opts.tap)) {
      mountTapOnFixture(group, opts.tap);
    } else {
      const resolvedMount = opts.tap.mount ?? '3-hole-deck';
      const tapObj = buildBasinTapFromSpec(
        opts.tap,
        opts.finish,
        resolvedMount,
        `${p}.basinTap`
      );
      mountTapOnFixture(group, tapObj, resolvedMount === '2-hole-wall' ? 'wall' : 'deck');
    }
  } else if (tapHoles === 3 && includeDeckMixer) {
    const deckMixer = buildArmstrongDeck3HoleBasinMixer({
      namePrefix: `${p}.deck3HoleMixer`,
      finish: opts.finish,
      valveSpreadM,
      style: opts.mixerStyle ?? 'langbourn',
    });
    deckMixer.position.set(0, rimHeightM - 0.001, deckTapZ);
    group.add(deckMixer);
  } else if (tapHoles === 3) {
    for (const [idx, hx] of [
      ['left', -valveSpreadM * 0.5],
      ['centre', 0],
      ['right', valveSpreadM * 0.5],
    ] as const) {
      const hole = new THREE.Mesh(
        prepGeo(new THREE.CylinderGeometry(0.015, 0.015, 0.003, 20)),
        metalMats.darkShadow
      );
      hole.name = `${p}.ceramicBasin.tapHole.${idx}`;
      hole.position.set(hx, rimHeightM, deckTapZ);
      basinGroup.add(hole);
    }
  }

  // Open Metal Support: Wall-Mounted Cast Brackets OR Open Tubular Console Stand (`opts.finish`)
  const standGroup = new THREE.Group();
  standGroup.name = `${p}.consoleStand`;
  group.add(standGroup);

  if (mountVariant === 'wallMountedBrackets') {
    const bracketX = Math.max(0.15, widthM * 0.5 - 0.085);
    const armReach = Math.max(0.24, depthM - 0.105);
    const bracketTopY = apronBottomY - 0.004;
    const bracketDropH = 0.215;

    for (const [sideTag, signX] of [
      ['left', -1],
      ['right', 1],
    ] as const) {
      const bx = signX * bracketX;

      const wallPlate = new THREE.Mesh(
        prepGeo(new THREE.BoxGeometry(0.032, bracketDropH, 0.010)),
        metalMats.primary
      );
      wallPlate.name = `${p}.consoleStand.${sideTag}WallBracketPlate`;
      wallPlate.position.set(bx, bracketTopY - bracketDropH * 0.5, 0.005);
      standGroup.add(wallPlate);

      const topArm = new THREE.Mesh(
        prepGeo(new THREE.BoxGeometry(0.026, 0.012, armReach)),
        metalMats.primary
      );
      topArm.name = `${p}.consoleStand.${sideTag}SupportArm`;
      topArm.position.set(bx, bracketTopY - 0.006, 0.010 + armReach * 0.5);
      standGroup.add(topArm);

      const frontFinial = new THREE.Mesh(
        prepGeo(new THREE.SphereGeometry(0.012, 16, 12)),
        metalMats.primary
      );
      frontFinial.name = `${p}.consoleStand.${sideTag}ArmFinial`;
      frontFinial.position.set(bx, bracketTopY - 0.006, 0.010 + armReach + 0.004);
      standGroup.add(frontFinial);

      const diagLen = Math.hypot(bracketDropH - 0.035, armReach - 0.035);
      const diagStrut = new THREE.Mesh(
        prepGeo(new THREE.CylinderGeometry(0.007, 0.007, diagLen, 16)),
        metalMats.primary
      );
      diagStrut.name = `${p}.consoleStand.${sideTag}ScrollBrace`;
      diagStrut.rotation.x = Math.atan2(armReach - 0.035, bracketDropH - 0.035);
      diagStrut.position.set(
        bx,
        bracketTopY - (bracketDropH - 0.015) * 0.5,
        0.012 + (armReach - 0.035) * 0.5
      );
      standGroup.add(diagStrut);
    }
  } else {

  const legX = Math.max(0.18, widthM * 0.5 - 0.055);
  const legZ = Math.max(0.28, depthM - 0.065);
  const topSupportY = apronBottomY - 0.016;
  const towelRailY = apronBottomY - 0.118; // ~118mm below ceramic apron
  const lowerCrossRailY = 0.195;

  const legFootGeo = createWallEscutcheonGeometry(0.031, 0.015, 0.018);
  const wallRoseGeo = createWallEscutcheonGeometry(0.028, 0.013, 0.011);
  const ballJointGeo = prepGeo(new THREE.SphereGeometry(0.021, 22, 16));
  const collarRingGeo = prepGeo(new THREE.CylinderGeometry(0.0165, 0.0165, 0.008, 22));

  for (const [sideTag, signX] of [
    ['left', -1],
    ['right', 1],
  ] as const) {
    const lx = signX * legX;

    // Stepped circular floor foot (y = 0 .. 0.018m)
    const floorFoot = new THREE.Mesh(legFootGeo, metalMats.primary);
    floorFoot.name = `${p}.consoleStand.${sideTag}FloorFoot`;
    floorFoot.position.set(lx, 0, legZ);
    standGroup.add(floorFoot);

    const ankleCollar = new THREE.Mesh(collarRingGeo, metalMats.knurled);
    ankleCollar.name = `${p}.consoleStand.${sideTag}AnkleCollar`;
    ankleCollar.position.set(lx, 0.023, legZ);
    standGroup.add(ankleCollar);

    // Vertical Ø28mm front tubular leg rising to ceramic underside capital
    const legH = apronBottomY - 0.018;
    const legTube = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.014, 0.014, legH, 24)),
      metalMats.primary
    );
    legTube.name = `${p}.consoleStand.${sideTag}FrontLeg`;
    legTube.position.set(lx, 0.018 + legH * 0.5, legZ);
    standGroup.add(legTube);

    // Top basin support capital + spherical corner joint
    const topCapital = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.026, 0.016, 0.016, 24)),
      metalMats.primary
    );
    topCapital.name = `${p}.consoleStand.${sideTag}BasinMountCapital`;
    topCapital.position.set(lx, apronBottomY - 0.006, legZ);
    standGroup.add(topCapital);

    const topBall = new THREE.Mesh(ballJointGeo, metalMats.primary);
    topBall.name = `${p}.consoleStand.${sideTag}UpperSupportBall`;
    topBall.position.set(lx, topSupportY, legZ);
    standGroup.add(topBall);

    // Horizontal Ø25mm upper side return stay tube back to wall rose at z = 0
    const stayLen = legZ - 0.010;
    const upperStay = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.0125, 0.0125, stayLen, 20)),
      metalMats.primary
    );
    upperStay.name = `${p}.consoleStand.${sideTag}UpperWallStay`;
    upperStay.rotation.x = Math.PI * 0.5;
    upperStay.position.set(lx, topSupportY, 0.010 + stayLen * 0.5);
    standGroup.add(upperStay);

    const upperWallRose = new THREE.Mesh(wallRoseGeo, metalMats.primary);
    upperWallRose.name = `${p}.consoleStand.${sideTag}UpperWallRose`;
    upperWallRose.rotation.x = Math.PI * 0.5;
    upperWallRose.position.set(lx, topSupportY, 0);
    standGroup.add(upperWallRose);

    // Turned spherical ball-joint node at towel-rail level (~118mm below ceramic apron)
    const towelBall = new THREE.Mesh(ballJointGeo, metalMats.primary);
    towelBall.name = `${p}.consoleStand.${sideTag}TowelRailBallJoint`;
    towelBall.position.set(lx, towelRailY, legZ);
    standGroup.add(towelBall);

    // Side Ø19mm tubular towel rail running back to stepped circular wall rose at z = 0
    const sideTowelRail = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.0095, 0.0095, stayLen, 20)),
      metalMats.primary
    );
    sideTowelRail.name = `${p}.consoleStand.${sideTag}SideTowelRail`;
    sideTowelRail.rotation.x = Math.PI * 0.5;
    sideTowelRail.position.set(lx, towelRailY, 0.010 + stayLen * 0.5);
    standGroup.add(sideTowelRail);

    const towelWallRose = new THREE.Mesh(wallRoseGeo, metalMats.primary);
    towelWallRose.name = `${p}.consoleStand.${sideTag}TowelWallRose`;
    towelWallRose.rotation.x = Math.PI * 0.5;
    towelWallRose.position.set(lx, towelRailY, 0);
    standGroup.add(towelWallRose);

    // Lower stability cross-rail spherical ball joint
    const lowerBall = new THREE.Mesh(ballJointGeo, metalMats.primary);
    lowerBall.name = `${p}.consoleStand.${sideTag}LowerBallJoint`;
    lowerBall.position.set(lx, lowerCrossRailY, legZ);
    standGroup.add(lowerBall);
  }

  // Front Ø19mm tubular towel rail spanning between left & right ball joints
  const frontRailSpan = legX * 2;
  const frontTowelRail = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0095, 0.0095, frontRailSpan, 22)),
    metalMats.primary
  );
  frontTowelRail.name = `${p}.consoleStand.frontTowelRail`;
  frontTowelRail.rotation.z = Math.PI * 0.5;
  frontTowelRail.position.set(0, towelRailY, legZ);
  standGroup.add(frontTowelRail);

  // Lower Ø19mm cross-rail between legs for Edwardian console stability
  const lowerCrossRail = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0095, 0.0095, frontRailSpan, 22)),
    metalMats.primary
  );
  lowerCrossRail.name = `${p}.consoleStand.lowerCrossRail`;
  lowerCrossRail.rotation.z = Math.PI * 0.5;
  lowerCrossRail.position.set(0, lowerCrossRailY, legZ);
  standGroup.add(lowerCrossRail);
  }

  // Exposed `6303` Bottle Trap + Wall Waste Pipe + Hot/Cold Rigid Ø15mm Supply Pipes
  const plumbingGroup = new THREE.Group();
  plumbingGroup.name = `${p}.exposedPlumbing6303`;
  group.add(plumbingGroup);

  const trapBodyCenterY = rimHeightM - 0.285; // ~0.565m
  const trapBodyH = 0.108;
  const trapTopY = trapBodyCenterY + trapBodyH * 0.5;

  // Threaded brass basin waste backnut + vertical tailpipe into 6303 bottle trap
  const basinBacknut = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.024, 0.024, 0.012, 20)),
    metalMats.knurled
  );
  basinBacknut.name = `${p}.exposedPlumbing6303.wasteBacknut`;
  basinBacknut.position.set(0, bowlUnderbellyY - 0.006, bowlCenterZ);
  plumbingGroup.add(basinBacknut);

  const tailpipeBotY = trapTopY + 0.014;
  const tailpipeTopY = bowlUnderbellyY - 0.012;
  const tailpipeLen = Math.max(0.01, tailpipeTopY - tailpipeBotY);
  const wasteTailpipe = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.016, 0.016, tailpipeLen, 22)),
    metalMats.primary
  );
  wasteTailpipe.name = `${p}.exposedPlumbing6303.wasteTailpipe`;
  wasteTailpipe.position.set(0, tailpipeBotY + tailpipeLen * 0.5, bowlCenterZ);
  plumbingGroup.add(wasteTailpipe);

  const slipNut = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.022, 0.022, 0.014, 24)),
    metalMats.knurled
  );
  slipNut.name = `${p}.exposedPlumbing6303.trapSlipNut`;
  slipNut.position.set(0, trapTopY + 0.007, bowlCenterZ);
  plumbingGroup.add(slipNut);

  // Machined cylindrical Ø52mm `6303` bottle trap body + stepped clean-out base cap
  const bottleBody = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.026, 0.026, trapBodyH, 28)),
    metalMats.primary
  );
  bottleBody.name = `${p}.exposedPlumbing6303.bottleTrapBody`;
  bottleBody.position.set(0, trapBodyCenterY, bowlCenterZ);
  plumbingGroup.add(bottleBody);

  const bottleBottomCap = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0275, 0.025, 0.012, 28)),
    metalMats.knurled
  );
  bottleBottomCap.name = `${p}.exposedPlumbing6303.bottleCleanoutCap`;
  bottleBottomCap.position.set(0, trapBodyCenterY - trapBodyH * 0.5 - 0.004, bowlCenterZ);
  plumbingGroup.add(bottleBottomCap);

  // Horizontal Ø32mm waste outlet pipe running straight back (-Z) to wall flange at z = 0
  const wasteWallY = trapBodyCenterY + 0.020;
  const outletUnionNut = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.021, 0.021, 0.014, 22)),
    metalMats.knurled
  );
  outletUnionNut.name = `${p}.exposedPlumbing6303.outletCompressionNut`;
  outletUnionNut.rotation.x = Math.PI * 0.5;
  outletUnionNut.position.set(0, wasteWallY, bowlCenterZ - 0.030);
  plumbingGroup.add(outletUnionNut);

  const wastePipeLen = bowlCenterZ - 0.010;
  const wallWastePipe = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.016, 0.016, wastePipeLen, 22)),
    metalMats.primary
  );
  wallWastePipe.name = `${p}.exposedPlumbing6303.wallWastePipe`;
  wallWastePipe.rotation.x = Math.PI * 0.5;
  wallWastePipe.position.set(0, wasteWallY, 0.010 + wastePipeLen * 0.5);
  plumbingGroup.add(wallWastePipe);

  const wasteWallFlange = new THREE.Mesh(
    createWallEscutcheonGeometry(0.034, 0.017, 0.012),
    metalMats.primary
  );
  wasteWallFlange.name = `${p}.exposedPlumbing6303.wasteWallEscutcheon`;
  wasteWallFlange.rotation.x = Math.PI * 0.5;
  wasteWallFlange.position.set(0, wasteWallY, 0);
  plumbingGroup.add(wasteWallFlange);

  // Two neat vertical/wall-return rigid Ø15mm metal supply pipes w/ isolation valves under 3TH taps
  if (tapHoles === 3) {
    const supplyDeckBottomY = apronBottomY + 0.036;
    const supplyReturnY = rimHeightM - 0.235;
    const supplyWallRoseGeo = createWallEscutcheonGeometry(0.024, 0.009, 0.010);

    for (const [feedTag, sx] of [
      ['hotSupplyPipe', -valveSpreadM * 0.5],
      ['coldSupplyPipe', valveSpreadM * 0.5],
    ] as const) {
      const vertDrop = supplyDeckBottomY - supplyReturnY;
      const supplyCurve = new THREE.CurvePath<THREE.Vector3>();
      const bendR = 0.022;
      supplyCurve.add(
        new THREE.LineCurve3(
          new THREE.Vector3(sx, supplyDeckBottomY, deckTapZ),
          new THREE.Vector3(sx, supplyReturnY + bendR, deckTapZ)
        )
      );
      supplyCurve.add(
        new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(sx, supplyReturnY + bendR, deckTapZ),
          new THREE.Vector3(sx, supplyReturnY, deckTapZ),
          new THREE.Vector3(sx, supplyReturnY, deckTapZ - bendR)
        )
      );
      supplyCurve.add(
        new THREE.LineCurve3(
          new THREE.Vector3(sx, supplyReturnY, deckTapZ - bendR),
          new THREE.Vector3(sx, supplyReturnY, 0.008)
        )
      );

      const supplyPipe = new THREE.Mesh(
        prepGeo(new THREE.TubeGeometry(supplyCurve, 20, 0.0075, 16, false)),
        metalMats.primary
      );
      supplyPipe.name = `${p}.exposedPlumbing6303.${feedTag}`;
      plumbingGroup.add(supplyPipe);

      // Inline machined isolation valve with compression nuts & service screw
      const isoY = supplyReturnY + vertDrop * 0.45;
      const isoBody = new THREE.Mesh(
        prepGeo(new THREE.CylinderGeometry(0.0115, 0.0115, 0.028, 18)),
        metalMats.knurled
      );
      isoBody.name = `${p}.exposedPlumbing6303.${feedTag}.isolationValve`;
      isoBody.position.set(sx, isoY, deckTapZ);
      plumbingGroup.add(isoBody);

      const isoScrew = new THREE.Mesh(
        prepGeo(new THREE.CylinderGeometry(0.0055, 0.0055, 0.008, 14)),
        metalMats.primary
      );
      isoScrew.name = `${p}.exposedPlumbing6303.${feedTag}.isolationScrew`;
      isoScrew.rotation.x = Math.PI * 0.5;
      isoScrew.position.set(sx, isoY, deckTapZ + 0.013);
      plumbingGroup.add(isoScrew);

      const supplyRose = new THREE.Mesh(supplyWallRoseGeo, metalMats.primary);
      supplyRose.name = `${p}.exposedPlumbing6303.${feedTag}.wallEscutcheon`;
      supplyRose.rotation.x = Math.PI * 0.5;
      supplyRose.position.set(sx, supplyReturnY, 0);
      plumbingGroup.add(supplyRose);
    }
  }

  const fCode = resolveBrasswareCode(opts.finish, 'NI');
  return attachAssetMetadata(finalizeSanitaryGroup(group, 'sanitary'), {
    name: 'Lefroy Brooks Mackintosh Lissa Doon Marble Console Washstand',
    brand: 'Lefroy Brooks',
    collection: 'Mackintosh',
    sku: `MAC195-${fCode}`,
    finish: `Vitreous China & Honed Carrara / ${formatBrasswareFinishLabel(opts.finish, 'NI')}`,
    category: 'sanitaryware',
    dimensionsMm: [800, 560, 880],
    productUrl: 'https://uk.lefroybrooks.com/products/washstands/mackintosh-marble-washstand',
    schematicUrl: 'https://uk.lefroybrooks.com/downloads/technical/MAC195-dimensioned.pdf',
  });
}
