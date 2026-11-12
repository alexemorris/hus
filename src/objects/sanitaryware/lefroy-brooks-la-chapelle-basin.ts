import * as THREE from 'three';
import { attachAssetMetadata, formatBrasswareFinishLabel, resolveBrasswareCode } from '../shared/catalog-smart-metadata.ts';
import {
  buildBasinTapFromSpec,
  isCustomTapObject3D,
  mountTapOnFixture,
  registerTapMountAnchor,
} from './perrin-rowe-taps.ts';
import {
  finalizeSanitaryGroup,
  getBathroomBrassMaterials,
  getVitreousChinaMaterial,
} from './bathroom-materials.ts';
import { prepGeo } from '../shared/scene-helpers.ts';
import type { LefroyBrooksLaChapellePedestalBasinOptions } from './bathroom-spec-types.ts';

/**
 * Lefroy Brooks `1910 La Chapelle` Vitreous China Pedestal Basin:
 * - Stepped octagonal/chamfered pedestal foot (`y = 0..0.11m`), tapered 8-faceted ceramic column
 *   (`y = 0.11..0.67m`), and stepped flared capital (`y = 0.67..0.725m`).
 * - Generous `680mm W × 535mm D` 45°-chamfered octagonal ceramic apron (`0 tap holes`),
 *   multi-stepped perimeter rim moulding at `y = rimHeightM` (`0.860m`), low stepped rear
 *   splashback upstand (`y = 0.860..0.905m`), deep sculpted recessed ceramic bowl, rear overflow
 *   slot trim, and `6800` click-clack dome waste in `opts.finish`.
 */

function sampleChamferedFrontContour(
  widthM: number,
  depthM: number,
  insetM: number
): THREE.Vector2[] {
  const hw = Math.max(0.08, widthM * 0.5 - insetM);
  const zBack = Math.max(0, insetM * 0.4);
  const zFront = Math.max(zBack + 0.08, depthM - insetM);
  const ch = Math.min(0.115, hw * 0.42, (zFront - zBack) * 0.42);

  // 12-vertex counter-clockwise loop (subdivided along edges so lofting to octagonal bowl is crisp)
  return [
    new THREE.Vector2(hw, zBack),
    new THREE.Vector2(hw * 0.45, zBack),
    new THREE.Vector2(-hw * 0.45, zBack),
    new THREE.Vector2(-hw, zBack),
    new THREE.Vector2(-hw, (zBack + zFront - ch) * 0.5),
    new THREE.Vector2(-hw, zFront - ch),
    new THREE.Vector2(-hw + ch * 0.5, zFront - ch * 0.5),
    new THREE.Vector2(-hw + ch, zFront),
    new THREE.Vector2(0, zFront),
    new THREE.Vector2(hw - ch, zFront),
    new THREE.Vector2(hw - ch * 0.5, zFront - ch * 0.5),
    new THREE.Vector2(hw, zFront - ch),
    new THREE.Vector2(hw, (zBack + zFront - ch) * 0.5),
    new THREE.Vector2(hw, zBack),
  ];
}

function sampleOctagonalBowlContour(
  halfW: number,
  halfD: number,
  centerZ: number
): THREE.Vector2[] {
  const chX = halfW * 0.36;
  const chZ = halfD * 0.36;
  const zB = centerZ - halfD;
  const zF = centerZ + halfD;
  // 14 points matching `sampleChamferedFrontContour` vertex count & orientation
  return [
    new THREE.Vector2(halfW - chX * 0.5, zB + chZ * 0.5),
    new THREE.Vector2(halfW - chX, zB),
    new THREE.Vector2(-(halfW - chX), zB),
    new THREE.Vector2(-(halfW - chX * 0.5), zB + chZ * 0.5),
    new THREE.Vector2(-halfW, centerZ - halfD * 0.25),
    new THREE.Vector2(-halfW, zF - chZ),
    new THREE.Vector2(-(halfW - chX * 0.5), zF - chZ * 0.5),
    new THREE.Vector2(-(halfW - chX), zF),
    new THREE.Vector2(0, zF),
    new THREE.Vector2(halfW - chX, zF),
    new THREE.Vector2(halfW - chX * 0.5, zF - chZ * 0.5),
    new THREE.Vector2(halfW, zF - chZ),
    new THREE.Vector2(halfW, centerZ - halfD * 0.25),
    new THREE.Vector2(halfW - chX * 0.5, zB + chZ * 0.5),
  ];
}

function buildLoftedFacetedRings(
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
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return prepGeo(geo);
}

function buildOctagonalPedestalGeometry(
  topCapitalY: number,
  pedCenterZ: number
): THREE.BufferGeometry {
  // Regular 8-sided faceted rings centered on (0, pedCenterZ), rotated π/8 so flat faces face +Z & ±X
  const stations: readonly [number, number, number][] = [
    // [radiusX, radiusZ, y]
    [0.01, 0.01, 0.0],
    [0.142, 0.130, 0.0],
    [0.142, 0.130, 0.032],
    [0.124, 0.114, 0.040],
    [0.124, 0.114, 0.072],
    [0.106, 0.098, 0.084],
    [0.104, 0.096, 0.110],
    // Tapered 8-faceted ceramic column (y = 0.11 .. topCapitalY - 0.055)
    [0.086, 0.080, topCapitalY - 0.055],
    // Stepped flared octagonal capital
    [0.102, 0.096, topCapitalY - 0.042],
    [0.102, 0.096, topCapitalY - 0.022],
    [0.126, 0.118, topCapitalY - 0.012],
    [0.126, 0.118, topCapitalY],
  ];

  const rings = stations.map(([rx, rz, y], idx) => {
    const pts: THREE.Vector2[] = [];
    for (let k = 0; k <= 8; k++) {
      const a = -Math.PI * 0.375 - (k / 8) * Math.PI * 2;
      pts.push(new THREE.Vector2(Math.cos(a) * rx, pedCenterZ + Math.sin(a) * rz));
    }
    return { pts, y, vUv: idx / (stations.length - 1) };
  });

  return buildLoftedFacetedRings(rings);
}

export function buildLefroyBrooksLaChapellePedestalBasin(
  opts: LefroyBrooksLaChapellePedestalBasinOptions
): THREE.Group {
  const p = opts.namePrefix;
  const widthM = opts.widthM ?? 0.680;
  const depthM = opts.depthM ?? 0.535;
  const rimHeightM = opts.rimHeightM ?? 0.860;

  const chinaMat = getVitreousChinaMaterial();
  const metalMats = getBathroomBrassMaterials(opts.finish);
  const wasteMats = opts.wasteFinish ? getBathroomBrassMaterials(opts.wasteFinish) : metalMats;

  const group = new THREE.Group();
  group.name = p;

  const pedCapitalTopY = rimHeightM - 0.135; // 0.725m
  const pedCenterZ = Math.min(depthM * 0.44, 0.235);

  // 1. Stepped 8-Faceted Octagonal Pedestal Foot, Column & Capital
  const pedestalMesh = new THREE.Mesh(
    buildOctagonalPedestalGeometry(pedCapitalTopY + 0.008, pedCenterZ),
    chinaMat
  );
  pedestalMesh.name = `${p}.octagonalPedestal`;
  group.add(pedestalMesh);

  // 2. Stepped 45°-Chamfered Octagonal Ceramic Basin Apron, Multi-Stepped Rim & Sunken Bowl (0TH)
  const apronBotY = rimHeightM - 0.135; // 0.725m
  const bowlFloorY = rimHeightM - 0.155; // 0.705m
  const bowlCenterZ = depthM * 0.52;
  const bowlHalfW = Math.max(0.18, widthM * 0.5 - 0.095);
  const bowlHalfD = Math.max(0.13, depthM * 0.5 - 0.095);

  const basinRings = [
    { pts: sampleOctagonalBowlContour(0.01, 0.01, pedCenterZ), y: apronBotY - 0.005, vUv: 0.0 },
    { pts: sampleChamferedFrontContour(widthM, depthM, 0.052), y: apronBotY, vUv: 0.14 },
    { pts: sampleChamferedFrontContour(widthM, depthM, 0.032), y: rimHeightM - 0.056, vUv: 0.30 },
    { pts: sampleChamferedFrontContour(widthM, depthM, 0.016), y: rimHeightM - 0.042, vUv: 0.38 },
    { pts: sampleChamferedFrontContour(widthM, depthM, 0.014), y: rimHeightM - 0.022, vUv: 0.45 },
    { pts: sampleChamferedFrontContour(widthM, depthM, 0.0), y: rimHeightM - 0.016, vUv: 0.50 },
    { pts: sampleChamferedFrontContour(widthM, depthM, 0.0), y: rimHeightM - 0.004, vUv: 0.54 },
    { pts: sampleChamferedFrontContour(widthM, depthM, 0.012), y: rimHeightM, vUv: 0.58 },
    { pts: sampleOctagonalBowlContour(bowlHalfW, bowlHalfD, bowlCenterZ), y: rimHeightM - 0.003, vUv: 0.66 },
    { pts: sampleOctagonalBowlContour(bowlHalfW * 0.90, bowlHalfD * 0.88, bowlCenterZ), y: rimHeightM - 0.048, vUv: 0.76 },
    { pts: sampleOctagonalBowlContour(bowlHalfW * 0.70, bowlHalfD * 0.68, bowlCenterZ), y: bowlFloorY + 0.016, vUv: 0.88 },
    { pts: sampleOctagonalBowlContour(0.032, 0.032, bowlCenterZ), y: bowlFloorY, vUv: 0.97 },
    { pts: sampleOctagonalBowlContour(0.001, 0.001, bowlCenterZ), y: bowlFloorY, vUv: 1.0 },
  ];
  const basinMesh = new THREE.Mesh(buildLoftedFacetedRings(basinRings), chinaMat);
  basinMesh.name = `${p}.octagonalBasinBowl`;
  group.add(basinMesh);

  // 3. Low Stepped Integral Rear Splashback Upstand (y = rimHeightM .. rimHeightM + 0.045m, 0.860..0.905m)
  const upstandBase = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(widthM - 0.016, 0.028, 0.032)),
    chinaMat
  );
  upstandBase.name = `${p}.rearSplashbackUpstandBase`;
  upstandBase.position.set(0, rimHeightM + 0.013, 0.016);
  group.add(upstandBase);

  const upstandCrown = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(widthM - 0.090, 0.019, 0.026)),
    chinaMat
  );
  upstandCrown.name = `${p}.rearSplashbackUpstandCrown`;
  upstandCrown.position.set(0, rimHeightM + 0.037, 0.0135);
  group.add(upstandCrown);

  // 4. Rear Overflow Slot Trim & 6800 Click-Clack Dome Waste
  const rearWallZ = bowlCenterZ - bowlHalfD;
  const ovBezel = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(0.044, 0.012, 0.005)),
    metalMats.primary
  );
  ovBezel.name = `${p}.overflowBezel`;
  ovBezel.position.set(0, rimHeightM - 0.040, rearWallZ + 0.005);
  ovBezel.rotation.x = 0.16;
  group.add(ovBezel);

  const ovSlot = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(0.034, 0.005, 0.006)),
    metalMats.darkShadow
  );
  ovSlot.name = `${p}.overflowSlot`;
  ovSlot.position.set(0, rimHeightM - 0.040, rearWallZ + 0.0062);
  ovSlot.rotation.x = 0.16;
  group.add(ovSlot);

  const wasteFlange = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.032, 0.032, 0.003, 28)),
    wasteMats.primary
  );
  wasteFlange.name = `${p}.wasteFlange6800`;
  wasteFlange.position.set(0, bowlFloorY + 0.001, bowlCenterZ);
  group.add(wasteFlange);

  const wastePlugPts = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.022, 0),
    new THREE.Vector2(0.022, 0.0035),
    new THREE.Vector2(0.015, 0.0065),
    new THREE.Vector2(0, 0.008),
  ];
  const wastePlug = new THREE.Mesh(
    prepGeo(new THREE.LatheGeometry(wastePlugPts, 28)),
    wasteMats.primary
  );
  wastePlug.name = `${p}.wasteClickClackPlug6800`;
  wastePlug.position.set(0, bowlFloorY + 0.0025, bowlCenterZ);
  group.add(wastePlug);

  const deckTapZ = 0.068;
  const holeCount: 0 | 1 | 3 =
    opts.tap === 'default'
      ? 3
      : opts.tap && typeof opts.tap === 'object' && !isCustomTapObject3D(opts.tap)
        ? opts.tap.mount === '2-hole-wall'
          ? 0
          : opts.tap.mount === 'monobloc-deck'
            ? 1
            : 3
        : 0;

  registerTapMountAnchor(group, {
    deckPosition: [0, rimHeightM + 0.0005, deckTapZ],
    wallPosition: [0, rimHeightM + 0.145, 0],
    wastePosition: [0, bowlFloorY, bowlCenterZ],
    holeCount,
    rotationY: 0,
  });

  if (opts.tap !== undefined && opts.tap !== 'none') {
    if (opts.tap === 'default') {
      const tapObj = buildBasinTapFromSpec(
        { collection: 'deco', mount: '3-hole-deck', finish: opts.finish },
        opts.finish,
        '3-hole-deck',
        `${p}.basinTap`
      );
      mountTapOnFixture(group, tapObj, 'deck');
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
  }

  const fCode = resolveBrasswareCode(opts.finish, 'NI');
  return attachAssetMetadata(finalizeSanitaryGroup(group, 'sanitary'), {
    name: 'Lefroy Brooks La Chapelle Pedestal Basin',
    brand: 'Lefroy Brooks',
    collection: 'La Chapelle',
    sku: `LCB101-${fCode}`,
    finish: `Vitreous China & Honed Carrara / ${formatBrasswareFinishLabel(opts.finish, 'NI')}`,
    category: 'sanitaryware',
    dimensionsMm: [680, 535, 895],
    productUrl: 'https://uk.lefroybrooks.com/products/basins/la-chapelle-pedestal-basin',
    schematicUrl: 'https://uk.lefroybrooks.com/downloads/technical/LCB101-dimensioned.pdf',
  });
}
