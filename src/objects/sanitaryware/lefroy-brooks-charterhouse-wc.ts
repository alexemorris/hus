import * as THREE from 'three';
import { attachAssetInteraction, attachAssetMetadata, formatBrasswareFinishLabel, resolveBrasswareCode } from '../shared/catalog-smart-metadata.ts';
import {
  finalizeSanitaryGroup,
  getBathroomBrassMaterials,
  getVitreousChinaMaterial,
  getWcSeatMaterial,
  getWcWaterSealMaterial,
} from './bathroom-materials.ts';
import { prepGeo } from '../shared/scene-helpers.ts';
import { buildPerrinRoweConcealedCisternLever } from './perrin-rowe-armstrong.ts';
import type { LefroyBrooksCharterhouseWcOptions } from './bathroom-spec-types.ts';

/**
 * Lefroy Brooks Heritage Vitreous China WC Suite Builder:
 * - Collections:
 *   - `'charterhouse1900'` (default): `1900 Classic Charterhouse` stepped rectangular architectural cornice
 *     (`LB 7207` + `LB 7208` close-coupled; `LB 7209` + `LB 7212` low-level).
 *   - `'laChapelle1910'`: `1910 La Chapelle` 45°-chamfered stepped octagonal front corners (`LB 7707` + `LB 7708`).
 *   - `'lissaDoon'`: `Lissa Doon` softly rounded Edwardian contours (`LB 7507` + `LB 7508`).
 * - Includes true hollow recessed ceramic bowl + water seal plane, `LB 7241` contoured seat & bar hinges,
 *   signature `LB 1307` ceramic-paddle cistern lever, and rigid metal cold-water isolation pipework.
 *
 * Local coordinate convention:
 * - `(0, 0, 0)` at horizontal centre (`x = 0`), finished floor (`y = 0`), rear face against wall (`z = 0`),
 *   projecting forward along `+Z`.
 */

type WcCollection = 'charterhouse1900' | 'laChapelle1910' | 'lissaDoon' | 'acantoVortex' | 'gsiClassicSwirlflush';

/**
 * Builds an extruded horizontal cistern section (`y = 0 .. height`, `z = 0 .. depth`, `x = -width/2 .. +width/2`)
 * shaped according to the selected Lefroy Brooks collection profile.
 */
function createCisternTierGeometry(
  width: number,
  depth: number,
  height: number,
  collection: WcCollection,
  bevel = 0.002
): THREE.BufferGeometry {
  const hw = Math.max(0.04, width * 0.5 - bevel);
  const d = Math.max(0.03, depth - bevel);
  // Build in 2D (X, -Z) so extruding along +Z and rotating Rx(-90°) yields +Y height and z = 0..depth
  const shape = new THREE.Shape();

  if (collection === 'laChapelle1910') {
    const ch = Math.min(0.044, hw * 0.26, d * 0.34);
    shape.moveTo(-hw, 0);
    shape.lineTo(hw, 0);
    shape.lineTo(hw, -(d - ch));
    shape.lineTo(hw - ch, -d);
    shape.lineTo(-(hw - ch), -d);
    shape.lineTo(-hw, -(d - ch));
    shape.closePath();
  } else if ((collection === 'lissaDoon' || collection === 'acantoVortex' || collection === 'gsiClassicSwirlflush')) {
    const r = Math.min(0.038, hw * 0.25, d * 0.32);
    const bow = 0.008;
    shape.moveTo(-hw, 0);
    shape.lineTo(hw, 0);
    shape.lineTo(hw, -(d - r));
    shape.absarc(hw - r, -(d - r), r, 0, -Math.PI * 0.5, true);
    shape.quadraticCurveTo(0, -(d + bow), -(hw - r), -d);
    shape.absarc(-(hw - r), -(d - r), r, -Math.PI * 0.5, -Math.PI, true);
    shape.closePath();
  } else {
    const r = 0.006;
    shape.moveTo(-hw, 0);
    shape.lineTo(hw, 0);
    shape.lineTo(hw, -(d - r));
    shape.absarc(hw - r, -(d - r), r, 0, -Math.PI * 0.5, true);
    shape.lineTo(-(hw - r), -d);
    shape.absarc(-(hw - r), -(d - r), r, -Math.PI * 0.5, -Math.PI, true);
    shape.closePath();
  }

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.002, height - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: (collection === 'lissaDoon' || collection === 'acantoVortex' || collection === 'gsiClassicSwirlflush') ? 3 : 1,
    curveSegments: (collection === 'lissaDoon' || collection === 'acantoVortex' || collection === 'gsiClassicSwirlflush') ? 12 : 4,
  });
  geo.rotateX(-Math.PI * 0.5);
  geo.computeBoundingBox();
  if (geo.boundingBox) {
    geo.translate(0, -geo.boundingBox.min.y, -geo.boundingBox.min.z);
  }
  return prepGeo(geo);
}

/**
 * Samples a closed 2D plan contour `(x, z)` for the WC pan & hollow bowl loft.
 */
function samplePanOuterContour(
  pointCount: number,
  rearZ: number,
  frontZ: number,
  halfWidth: number,
  collection: WcCollection,
  pedestalScale = 1.0
): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  const centerZ = (rearZ + frontZ) * 0.5;
  const halfLen = (frontZ - rearZ) * 0.5 * pedestalScale;
  const hw = halfWidth * pedestalScale;
  const rearFlatZ = rearZ + (1 - pedestalScale) * 0.05;

  for (let i = 0; i < pointCount; i++) {
    const u = i / (pointCount - 1);
    const theta = -Math.PI * 0.5 - u * Math.PI * 2; // starts at rear centre (-90°), goes CCW
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);

    let x: number;
    let z: number;

    if (collection === 'laChapelle1910') {
      // Faceted 8-sided octagonal-oval Edwardian/Art-Deco transition contour
      const snappedTheta = Math.round(theta / (Math.PI * 0.25)) * (Math.PI * 0.25);
      const blend = 0.55;
      const effCos = cosT * (1 - blend) + Math.cos(snappedTheta) * blend;
      const effSin = sinT * (1 - blend) + Math.sin(snappedTheta) * blend;
      x = hw * effCos;
      z = centerZ + halfLen * effSin;
    } else {
      const p = (collection === 'lissaDoon' || collection === 'acantoVortex' || collection === 'gsiClassicSwirlflush') ? 2 / 2.15 : 2 / 2.28;
      const spow = (v: number): number => (v < 0 ? -Math.pow(-v, p) : Math.pow(v, p));
      x = hw * spow(cosT);
      z = centerZ + halfLen * spow(sinT);
    }

    // Flatten back edge slightly at rear deck shelf so pan meets wall/boxing cleanly
    if (z < rearFlatZ) {
      z = rearFlatZ;
    }
    out.push(new THREE.Vector2(x, z));
  }
  out[pointCount - 1] = out[0]!.clone();
  return out;
}

function sampleOvalBowlInnerContour(
  pointCount: number,
  centerZ: number,
  halfW: number,
  halfLen: number
): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < pointCount; i++) {
    const u = i / (pointCount - 1);
    const theta = -Math.PI * 0.5 - u * Math.PI * 2;
    out.push(new THREE.Vector2(halfW * Math.cos(theta), centerZ + halfLen * Math.sin(theta)));
  }
  out[pointCount - 1] = out[0]!.clone();
  return out;
}

function buildLoftedPanGeometry(
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

/**
 * Builds the contoured oval toilet seat ring (`LB 7241`) with a genuine central opening.
 */
function createContouredToiletSeatGeometry(
  centerZ: number,
  outerHalfW: number,
  outerHalfLen: number,
  innerHalfW: number,
  innerHalfLen: number,
  thickness: number
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const segs = 40;
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const x = outerHalfW * Math.cos(a);
    const y = -(centerZ + outerHalfLen * Math.sin(a));
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  const hole = new THREE.Path();
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const x = innerHalfW * Math.cos(a);
    const y = -(centerZ + innerHalfLen * Math.sin(a));
    if (i === 0) hole.moveTo(x, y);
    else hole.lineTo(x, y);
  }
  shape.holes.push(hole);

  const bevel = 0.0045;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.003, thickness - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 24,
  });
  geo.rotateX(-Math.PI * 0.5);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  if (geo.boundingBox) {
    geo.translate(0, -geo.boundingBox.min.y, 0);
  }

  // Normalize ExtrudeGeometry meter-space UVs into tight front-to-back timber grain coordinates
  // so straight-grained smoked English oak runs cleanly along the seat without walnut-like stretching.
  const posAttr = geo.getAttribute('position');
  const normAttr = geo.getAttribute('normal');
  const uvAttr = geo.getAttribute('uv');
  if (posAttr && normAttr && uvAttr) {
    const grainScaleU = 3.8; // across width (X)
    const grainScaleV = 3.4; // along length (Z, front-to-back grain direction)
    for (let i = 0; i < posAttr.count; i++) {
      const px = posAttr.getX(i);
      const py = posAttr.getY(i);
      const pz = posAttr.getZ(i);
      const ny = Math.abs(normAttr.getY(i));
      const u = ny > 0.45 ? px * grainScaleU + 0.5 : (px + py * 1.4) * grainScaleU + 0.5;
      const v = (pz - centerZ) * grainScaleV + 0.5;
      uvAttr.setXY(i, u, v);
    }
    uvAttr.needsUpdate = true;
  }

  return prepGeo(geo);
}

export function buildLefroyBrooksCharterhouseWc(
  opts: LefroyBrooksCharterhouseWcOptions
): THREE.Group {
  const p = opts.namePrefix;
  const collection: WcCollection = opts.collection ?? 'charterhouse1900';
  const variant = opts.variant ?? 'closeCoupled';
  const seatFinish = opts.seatFinish ?? 'glossWhite';

  const chinaMat = getVitreousChinaMaterial();
  const metalMats = getBathroomBrassMaterials(opts.finish);
  const seatMat = getWcSeatMaterial(seatFinish);
  const waterMat = getWcWaterSealMaterial();

  const group = new THREE.Group();
  group.name = p;

  const isLaChapelle = collection === 'laChapelle1910';
  const panRimY = isLaChapelle ? 0.403 : 0.410; // LB 7707 = 403mm; LB 7207 = 410mm
  const cisternOverallW = isLaChapelle ? 0.515 : 0.465; // LB 7708 = 515mm cornice lid; LB 7208 = 465mm
  const cisternOverallD = isLaChapelle ? 0.205 : 0.195; // LB 7708 = 205mm cornice depth; LB 7208 = 195mm

  const isLowLevel = variant === 'lowLevel';
  const isBtwVortex = variant === 'backToWallVortex';
  const lowBoxDepth =
    isLowLevel || isBtwVortex
      ? opts.lowBoxingDepthM && opts.lowBoxingDepthM > 0
        ? opts.lowBoxingDepthM
        : isLowLevel
          ? 0.19
          : 0.0
      : 0;
  const panRearZ = isLowLevel || isBtwVortex ? lowBoxDepth : 0.0;
  const panFrontZ = isBtwVortex
    ? lowBoxDepth + (collection === 'acantoVortex' ? 0.530 : 0.550)
    : isLowLevel
      ? lowBoxDepth + 0.560
      : isLaChapelle
        ? 0.685 // LB 7707 + LB 7708 close-coupled = 685mm overall projection
        : 0.725;
  const bowlCenterZ = panFrontZ - (isLaChapelle ? 0.232 : 0.240);
  const panHalfW = isLaChapelle ? 0.180 : 0.184; // LB 7707 = 360mm bowl width; LB 7207 = 368mm

  // --- 1. Vitreous China Pan (`LB 7207` / `LB 7209` / `LB 7707` / `LB 7507`) with Hollow Bowl ---
  const panGroup = new THREE.Group();
  panGroup.name = `${p}.toiletPan`;
  group.add(panGroup);

  const nPts = 49;
  const bowlInnerHalfW = 0.142;
  const bowlInnerHalfL = 0.176;
  const waterSealY = 0.205;
  const trapThroatY = 0.165;

  const footRearOffset = isBtwVortex ? 0.0 : isLaChapelle ? 0.123 : 0.02; // LB 7707 foot starts 123mm forward of wall
  const footFrontInset = isBtwVortex ? 0.065 : isLaChapelle ? 0.102 : 0.11; // LB 7707 foot L = 460mm (z = 0.123..0.583m)
  const footHalfWRatio = isBtwVortex ? 0.90 : isLaChapelle ? 0.722 : 0.74;   // LB 7707 foot W = 260mm (±0.130m)
  const panRings = [
    // Closed floor contact & flared Edwardian/Deco pedestal foot (y = 0 .. 0.034m)
    { pts: sampleOvalBowlInnerContour(nPts, bowlCenterZ - 0.03, 0.01, 0.01), y: 0.0, vUv: 0.0 },
    { pts: samplePanOuterContour(nPts, panRearZ + footRearOffset, panFrontZ - footFrontInset, panHalfW * footHalfWRatio, collection, 1.0), y: 0.0, vUv: 0.08 },
    { pts: samplePanOuterContour(nPts, panRearZ + footRearOffset, panFrontZ - (isBtwVortex ? 0.060 : footFrontInset), panHalfW * (isBtwVortex ? 0.91 : footHalfWRatio), collection, 1.0), y: 0.024, vUv: 0.13 },
    // Stepped pedestal waist / shrouded vortex skirt (y = 0.036 .. 0.185m)
    { pts: samplePanOuterContour(nPts, panRearZ + (isBtwVortex ? 0.0 : footRearOffset + 0.012), panFrontZ - (isBtwVortex ? 0.052 : footFrontInset + 0.024), panHalfW * (isBtwVortex ? 0.92 : 0.63), collection, 1.0), y: 0.042, vUv: 0.18 },
    { pts: samplePanOuterContour(nPts, panRearZ + (isBtwVortex ? 0.0 : footRearOffset * 0.65), panFrontZ - (isBtwVortex ? 0.040 : footFrontInset + 0.015), panHalfW * (isBtwVortex ? 0.94 : 0.65), collection, 1.0), y: 0.175, vUv: 0.30 },
    // Outward-flaring ceramic bowl belly (y = 0.185 .. 0.378m)
    { pts: samplePanOuterContour(nPts, panRearZ + 0.008, panFrontZ - 0.040, panHalfW * 0.88, collection, 1.0), y: 0.295, vUv: 0.42 },
    { pts: samplePanOuterContour(nPts, panRearZ, panFrontZ - 0.008, panHalfW * 0.96, collection, 1.0), y: 0.376, vUv: 0.50 },
    // Flared Edwardian boxed flushing rim (y = 0.382 .. 0.410m)
    { pts: samplePanOuterContour(nPts, panRearZ, panFrontZ, panHalfW, collection, 1.0), y: 0.388, vUv: 0.54 },
    { pts: samplePanOuterContour(nPts, panRearZ, panFrontZ, panHalfW, collection, 1.0), y: panRimY - 0.003, vUv: 0.58 },
    { pts: samplePanOuterContour(nPts, panRearZ + 0.008, panFrontZ - 0.008, panHalfW - 0.008, collection, 1.0), y: panRimY, vUv: 0.61 },
    // Hollow recessed ceramic bowl interior funnel descending from rim (0.410m) down to trap throat (0.165m)
    { pts: sampleOvalBowlInnerContour(nPts, bowlCenterZ, bowlInnerHalfW, bowlInnerHalfL), y: panRimY - 0.004, vUv: 0.68 },
    { pts: sampleOvalBowlInnerContour(nPts, bowlCenterZ, bowlInnerHalfW * 0.94, bowlInnerHalfL * 0.93), y: 0.350, vUv: 0.76 },
    { pts: sampleOvalBowlInnerContour(nPts, bowlCenterZ - 0.012, bowlInnerHalfW * 0.68, bowlInnerHalfL * 0.66), y: 0.255, vUv: 0.86 },
    { pts: sampleOvalBowlInnerContour(nPts, bowlCenterZ - 0.024, 0.056, 0.064), y: trapThroatY, vUv: 0.95 },
    { pts: sampleOvalBowlInnerContour(nPts, bowlCenterZ - 0.024, 0.002, 0.002), y: trapThroatY, vUv: 1.0 },
  ];

  const panMesh = new THREE.Mesh(buildLoftedPanGeometry(panRings), chinaMat);
  panMesh.name = `${p}.toiletPan.vitreousBowl`;
  panGroup.add(panMesh);

  // Rear ceramic deck platform supporting close-coupled cistern or flush-pipe horn
  const rearDeckDepth = Math.max(0.11, bowlCenterZ - bowlInnerHalfL - panRearZ + 0.025);
  const rearDeck = new THREE.Mesh(
    createCisternTierGeometry(panHalfW * (isBtwVortex ? 1.50 : 1.82), rearDeckDepth, 0.042, collection, 0.003),
    chinaMat
  );
  rearDeck.name = `${p}.toiletPan.rearDeck`;
  rearDeck.position.set(0, panRimY - 0.042, panRearZ);
  panGroup.add(rearDeck);

  // Glistening translucent water seal plane inside the hollow ceramic bowl
  const waterDisc = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.072, 0.072, 0.003, 28)),
    waterMat
  );
  waterDisc.name = `${p}.toiletPan.waterSeal`;
  waterDisc.scale.set(1.0, 1.0, 1.14);
  waterDisc.position.set(0, waterSealY, bowlCenterZ - 0.018);
  panGroup.add(waterDisc);

  // Floor fixing bolt dome caps on left/right of pedestal foot
  for (const [sideTag, sx] of [
    ['left', -0.108],
    ['right', 0.108],
  ] as const) {
    const boltCap = new THREE.Mesh(
      prepGeo(new THREE.SphereGeometry(0.009, 14, 10)),
      metalMats.primary
    );
    boltCap.name = `${p}.toiletPan.${sideTag}FloorBoltCap`;
    boltCap.position.set(sx, 0.024, bowlCenterZ - 0.04);
    panGroup.add(boltCap);
  }

  // Horizontal P-trap ceramic soil outlet spigot at rear (`y = 0.190m`)
  const spigotStartZ = isLowLevel ? panRearZ + 0.016 : panRearZ;
  const spigotEndZ = bowlCenterZ - 0.06;
  if (spigotEndZ > spigotStartZ + 0.01) {
    const spigotLen = spigotEndZ - spigotStartZ;
    const soilSpigot = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.054, 0.054, spigotLen, 24)),
      chinaMat
    );
    soilSpigot.name = `${p}.toiletPan.soilOutletSpigot`;
    soilSpigot.rotation.x = Math.PI * 0.5;
    soilSpigot.position.set(0, 0.190, spigotStartZ + spigotLen * 0.5);
    panGroup.add(soilSpigot);

    if (isLowLevel) {
      const boxingCollar = new THREE.Mesh(
        prepGeo(new THREE.CylinderGeometry(0.068, 0.068, 0.016, 26)),
        chinaMat
      );
      boxingCollar.name = `${p}.toiletPan.soilBoxingCollar`;
      boxingCollar.rotation.x = Math.PI * 0.5;
      boxingCollar.position.set(0, 0.190, panRearZ + 0.008);
      panGroup.add(boxingCollar);
    }
  }

  if (isBtwVortex) {
    // Back-to-wall Vortex WC (Geberit Acanto TurboFlush 502.719.00.1 / GSI Classic Swirlflush 871411)
    // with concealed cistern & wall-mounted Perrin & Rowe solid-brass extended cistern lever (6772 / 6797)
    const seatGroup = new THREE.Group();
    seatGroup.name = `${p}.vortexSeat`;
    group.add(seatGroup);

    const seatRing = new THREE.Mesh(
      createContouredToiletSeatGeometry(
        bowlCenterZ,
        panHalfW - 0.004,
        0.228,
        bowlInnerHalfW - 0.010,
        bowlInnerHalfL - 0.012,
        0.020
      ),
      seatMat
    );
    seatRing.name = `${p}.vortexSeat.seatRing`;
    seatRing.position.y = panRimY + 0.003;
    seatGroup.add(seatRing);

    const hingeZ = bowlCenterZ - 0.205;
    const hingeSpan = 0.165;
    for (const [sideTag, hx] of [
      ['leftHingePillar', -hingeSpan * 0.5],
      ['rightHingePillar', hingeSpan * 0.5],
    ] as const) {
      const pillar = new THREE.Mesh(
        prepGeo(new THREE.CylinderGeometry(0.011, 0.014, 0.020, 18)),
        metalMats.primary
      );
      pillar.name = `${p}.vortexSeat.${sideTag}`;
      pillar.position.set(hx, panRimY + 0.010, hingeZ);
      seatGroup.add(pillar);
    }
    const hingeBar = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.006, 0.006, hingeSpan + 0.032, 20)),
       opts.leverStyle === 'armstrong' || !opts.leverStyle ? metalMats.knurled : metalMats.primary
    );
    hingeBar.name = `${p}.vortexSeat.hingeBar`;
    hingeBar.rotation.z = Math.PI * 0.5;
    hingeBar.position.set(0, panRimY + 0.017, hingeZ);
    seatGroup.add(hingeBar);

    const wallLever = buildPerrinRoweConcealedCisternLever({
      namePrefix: `${p}.concealedCisternLever`,
      finish: opts.finish,
      style: opts.leverStyle ?? 'armstrong',
    });
    wallLever.position.set(opts.concealedLeverXM ?? 0.135, opts.concealedLeverYM ?? 0.86, panRearZ);
    group.add(wallLever);
    {
    attachAssetInteraction(group, {
      kind: 'toggle',
      label: 'Flush Lefroy Brooks Charterhouse WC',
      activeLabel: 'Flushing Cistern…',
      autoResetAfterSec: 2.6,
      audio: { openPreset: 'cisternFlush', volume: 0.72 },
    });
    const fCode = resolveBrasswareCode(opts.finish, 'NI');
    return attachAssetMetadata(finalizeSanitaryGroup(group, 'sanitary'), {
      name: 'Lefroy Brooks Charterhouse Back-to-Wall WC',
      brand: 'Lefroy Brooks',
      collection: 'Charterhouse',
      sku: 'CHA250-' + fCode,
      finish: 'White Vitreous China / ' + formatBrasswareFinishLabel(opts.finish, 'NI'),
      category: 'sanitaryware',
      dimensionsMm: [385, 550, 415],
      productUrl: 'https://uk.lefroybrooks.com/products/wcs/charterhouse-wcs',
      schematicUrl: 'https://uk.lefroybrooks.com/downloads/technical/CHA250-dimensioned.pdf',
    });
  }
  }

  // --- 2. Stepped / Chamfered / Edwardian Cistern (`LB 7208` / `LB 7212` / `LB 7708` / `LB 7508`) ---
  const cisternGroup = new THREE.Group();
  cisternGroup.name = `${p}.cistern`;
  group.add(cisternGroup);

  const cisternBottomY = isLowLevel
    ? Math.max(0.58, (opts.lowBoxingHeightM ?? 0.382) + 0.20)
    : panRimY; // LB 7707: 0.403m + 0.417m = exact 0.820m (820mm) overall height!
  const cisternTotalH = isLowLevel ? 0.320 : isLaChapelle ? 0.417 : 0.350;
  const cisternTopY = cisternBottomY + cisternTotalH;

  const tankBaseW = isLaChapelle ? 0.494 : 0.442;
  const tankBaseD = isLaChapelle ? 0.194 : 0.184;
  const tankBodyW = isLaChapelle ? 0.485 : 0.432; // LB 7708 = 485mm tank body width
  const tankBodyD = isLaChapelle ? 0.188 : 0.178;

  // Stepped base moulding (H = 26mm)
  const cistBase = new THREE.Mesh(
    createCisternTierGeometry(tankBaseW, tankBaseD, 0.026, collection, 0.003),
    chinaMat
  );
  cistBase.name = `${p}.cistern.baseMoulding`;
  cistBase.position.y = cisternBottomY;
  cisternGroup.add(cistBase);

  // Main cistern tank body (recessed slightly so perimeter tablet frame casts authentic shadow)
  const bodyH = cisternTotalH - 0.068;
  const cistBodyCore = new THREE.Mesh(
    createCisternTierGeometry(tankBodyW, tankBodyD, bodyH, collection, 0.003),
    chinaMat
  );
  cistBodyCore.name = `${p}.cistern.tankBody`;
  cistBodyCore.position.y = cisternBottomY + 0.024;
  cisternGroup.add(cistBodyCore);

  // Raised architectural front border stiles & rails framing recessed front tablet panel
  const panelFrameZ = tankBodyD - 0.002;
  const panelCenterY = cisternBottomY + 0.024 + bodyH * 0.5;
  const frameW = isLaChapelle ? 0.345 : 0.360;
  const frameH = bodyH - 0.044;
  const railThick = 0.024;
  const railDepth = 0.0055;

  for (const [tag, dy] of [
    ['topPanelRail', (frameH - railThick) * 0.5],
    ['bottomPanelRail', -(frameH - railThick) * 0.5],
  ] as const) {
    const rail = new THREE.Mesh(
      prepGeo(new THREE.BoxGeometry(frameW, railThick, railDepth)),
      chinaMat
    );
    rail.name = `${p}.cistern.${tag}`;
    rail.position.set(0, panelCenterY + dy, panelFrameZ);
    cisternGroup.add(rail);
  }
  for (const [tag, dx] of [
    ['leftPanelStile', -(frameW - railThick) * 0.5],
    ['rightPanelStile', (frameW - railThick) * 0.5],
  ] as const) {
    const stile = new THREE.Mesh(
      prepGeo(new THREE.BoxGeometry(railThick, frameH - railThick * 2, railDepth)),
      chinaMat
    );
    stile.name = `${p}.cistern.${tag}`;
    stile.position.set(dx, panelCenterY, panelFrameZ);
    cisternGroup.add(stile);
  }

  // Multi-tier stepped architectural cornice lid flaring to exact W515×D205mm (LB 7708) or W465×D195mm (LB 7208)
  const lowerCornice = new THREE.Mesh(
    createCisternTierGeometry(isLaChapelle ? 0.500 : 0.450, isLaChapelle ? 0.197 : 0.188, 0.018, collection, 0.003),
    chinaMat
  );
  lowerCornice.name = `${p}.cistern.lidLowerStep`;
  lowerCornice.position.y = cisternTopY - 0.044;
  cisternGroup.add(lowerCornice);

  const upperCornice = new THREE.Mesh(
    createCisternTierGeometry(
      cisternOverallW,
      cisternOverallD,
      0.020,
      collection,
      (collection === 'lissaDoon' || collection === 'acantoVortex' || collection === 'gsiClassicSwirlflush') ? 0.006 : 0.003
    ),
    chinaMat
  );
  upperCornice.name = `${p}.cistern.lidCornice`;
  upperCornice.position.y = cisternTopY - 0.027;
  cisternGroup.add(upperCornice);

  const lidCrown = new THREE.Mesh(
    createCisternTierGeometry(isLaChapelle ? 0.456 : 0.415, isLaChapelle ? 0.178 : 0.168, 0.008, collection, 0.0025),
    chinaMat
  );
  lidCrown.name = `${p}.cistern.lidCrown`;
  lidCrown.position.y = cisternTopY - 0.008;
  cisternGroup.add(lidCrown);

  // --- 3. Signature `LB 1307` Ceramic-Paddle Cistern Lever (LB 7708: 220mm above cistern base) ---
  const leverY = isLaChapelle ? cisternBottomY + 0.220 : cisternTopY - 0.095;
  const leverX = isLaChapelle ? 0.158 : 0.148;
  const leverZ = tankBodyD + 0.003;

  const leverGroup = new THREE.Group();
  leverGroup.name = `${p}.cistern.paddleLeverLB1307`;
  leverGroup.position.set(leverX, leverY, leverZ);
  cisternGroup.add(leverGroup);

  const fulcrumRose = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.019, 0.021, 0.010, 24)),
    metalMats.primary
  );
  fulcrumRose.name = `${p}.cistern.paddleLeverLB1307.fulcrumRose`;
  fulcrumRose.rotation.x = Math.PI * 0.5;
  fulcrumRose.position.z = 0.004;
  leverGroup.add(fulcrumRose);

  const fulcrumKnurl = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.013, 0.013, 0.012, 20)),
    isLaChapelle ? metalMats.primary : metalMats.knurled
  );
  fulcrumKnurl.name = `${p}.cistern.paddleLeverLB1307.knurledBoss`;
  fulcrumKnurl.rotation.x = Math.PI * 0.5;
  fulcrumKnurl.position.z = 0.014;
  leverGroup.add(fulcrumKnurl);

  const leverCrank = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.005, 0.005, 0.032, 16)),
    metalMats.primary
  );
  leverCrank.name = `${p}.cistern.paddleLeverLB1307.metalArm`;
  leverCrank.rotation.z = -Math.PI * 0.42;
  leverCrank.position.set(0.015, -0.004, 0.020);
  leverGroup.add(leverCrank);

  // Turned white Vitreous China ceramic baluster paddle handle
  const paddlePts = [
    new THREE.Vector2(0.0055, 0),
    new THREE.Vector2(0.0095, 0.008),
    new THREE.Vector2(0.0115, 0.026),
    new THREE.Vector2(0.0105, 0.044),
    new THREE.Vector2(0.0065, 0.052),
  ];
  const ceramicPaddle = new THREE.Mesh(
    prepGeo(new THREE.LatheGeometry(paddlePts, 22)),
    chinaMat
  );
  ceramicPaddle.name = `${p}.cistern.paddleLeverLB1307.ceramicPaddle`;
  ceramicPaddle.rotation.z = -Math.PI * 0.42;
  ceramicPaddle.position.set(0.028, -0.007, 0.020);
  leverGroup.add(ceramicPaddle);

  const paddleEndPip = new THREE.Mesh(
    prepGeo(new THREE.SphereGeometry(0.006, 14, 10)),
    metalMats.primary
  );
  paddleEndPip.name = `${p}.cistern.paddleLeverLB1307.endFinial`;
  paddleEndPip.position.set(0.079, -0.020, 0.020);
  leverGroup.add(paddleEndPip);

  // --- 4. Contoured Seat & Pillar/Bar Hinge Assembly (`LB 7241`) ---
  const seatGroup = new THREE.Group();
  seatGroup.name = `${p}.seatLB7241`;
  group.add(seatGroup);

  const seatRing = new THREE.Mesh(
    createContouredToiletSeatGeometry(
      bowlCenterZ,
      panHalfW - 0.004,
      0.228,
      bowlInnerHalfW - 0.010,
      bowlInnerHalfL - 0.012,
      0.020
    ),
    seatMat
  );
  seatRing.name = `${p}.seatLB7241.seatRing`;
  seatRing.position.y = panRimY + 0.003;
  seatGroup.add(seatRing);

  const hingeZ = bowlCenterZ - 0.205;
  const hingeSpan = 0.165;
  for (const [sideTag, hx] of [
    ['leftPillar', -hingeSpan * 0.5],
    ['rightPillar', hingeSpan * 0.5],
  ] as const) {
    const pillar = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.011, 0.014, 0.022, 18)),
      metalMats.primary
    );
    pillar.name = `${p}.seatLB7241.${sideTag}`;
    pillar.position.set(hx, panRimY + 0.011, hingeZ);
    seatGroup.add(pillar);
  }
  const hingeBar = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0065, 0.0065, hingeSpan + 0.036, 20)),
    isLaChapelle ? metalMats.primary : metalMats.knurled
  );
  hingeBar.name = `${p}.seatLB7241.hingeBar`;
  hingeBar.rotation.z = Math.PI * 0.5;
  hingeBar.position.set(0, panRimY + 0.018, hingeZ);
  seatGroup.add(hingeBar);

  // --- 5. Low-Level Flush Pipe & Wall Brackets (when `variant === 'lowLevel'`) + Cold Supply ---
  const pipeGroup = new THREE.Group();
  pipeGroup.name = `${p}.pipework`;
  group.add(pipeGroup);

  if (isLowLevel) {
    // Pair of cast Edwardian metal wall brackets under LB 7212 cistern
    for (const [bTag, bx] of [
      ['leftWallBracket', -0.155],
      ['rightWallBracket', 0.155],
    ] as const) {
      const wallPlate = new THREE.Mesh(
        prepGeo(new THREE.BoxGeometry(0.024, 0.125, 0.008)),
        metalMats.primary
      );
      wallPlate.name = `${p}.pipework.${bTag}.wallLeg`;
      wallPlate.position.set(bx, cisternBottomY - 0.062, 0.004);
      pipeGroup.add(wallPlate);

      const topArm = new THREE.Mesh(
        prepGeo(new THREE.BoxGeometry(0.022, 0.010, 0.142)),
        metalMats.primary
      );
      topArm.name = `${p}.pipework.${bTag}.supportArm`;
      topArm.position.set(bx, cisternBottomY - 0.005, 0.079);
      pipeGroup.add(topArm);

      const scrollStrut = new THREE.Mesh(
        prepGeo(new THREE.CylinderGeometry(0.0055, 0.0055, 0.165, 14)),
        metalMats.primary
      );
      scrollStrut.name = `${p}.pipework.${bTag}.diagonalBrace`;
      scrollStrut.rotation.x = Math.atan2(0.135, 0.110);
      scrollStrut.position.set(bx, cisternBottomY - 0.062, 0.072);
      pipeGroup.add(scrollStrut);
    }

    // Exposed Ø38mm (r = 0.019m) brass L-bend flush pipe from cistern bottom into pan rear flush horn
    const flushPipeZ = 0.095;
    const hornY = panRimY - 0.020; // 0.390m
    const panHornZ = panRearZ + 0.032;
    const bendR = Math.min(0.055, Math.max(0.020, (panHornZ - flushPipeZ) * 0.7));

    const flushPath = new THREE.CurvePath<THREE.Vector3>();
    flushPath.add(
      new THREE.LineCurve3(
        new THREE.Vector3(0, cisternBottomY, flushPipeZ),
        new THREE.Vector3(0, hornY + bendR, flushPipeZ)
      )
    );
    flushPath.add(
      new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(0, hornY + bendR, flushPipeZ),
        new THREE.Vector3(0, hornY, flushPipeZ),
        new THREE.Vector3(0, hornY, flushPipeZ + bendR)
      )
    );
    if (panHornZ > flushPipeZ + bendR + 0.002) {
      flushPath.add(
        new THREE.LineCurve3(
          new THREE.Vector3(0, hornY, flushPipeZ + bendR),
          new THREE.Vector3(0, hornY, panHornZ + 0.018)
        )
      );
    }

    const flushPipeMesh = new THREE.Mesh(
      prepGeo(new THREE.TubeGeometry(flushPath, 24, 0.019, 20, false)),
      metalMats.primary
    );
    flushPipeMesh.name = `${p}.pipework.lowLevelFlushPipe`;
    pipeGroup.add(flushPipeMesh);

    const topFlushNut = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.026, 0.026, 0.018, 24)),
      metalMats.knurled
    );
    topFlushNut.name = `${p}.pipework.cisternFlushSlipNut`;
    topFlushNut.position.set(0, cisternBottomY - 0.009, flushPipeZ);
    pipeGroup.add(topFlushNut);

    const panFlushCone = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.026, 0.030, 0.022, 24)),
      metalMats.knurled
    );
    panFlushCone.name = `${p}.pipework.panFlushHornCollar`;
    panFlushCone.rotation.x = Math.PI * 0.5;
    panFlushCone.position.set(0, hornY, panHornZ + 0.006);
    pipeGroup.add(panFlushCone);
  }

  // Rigid Ø15mm cold-water feed pipe & inline isolation stop valve entering right base of cistern
  const feedX = isLowLevel ? 0.115 : 0.145;
  const feedZ = 0.085;
  const feedFloorOrWallY = isLowLevel ? Math.max(0.42, cisternBottomY - 0.16) : 0.18;
  const inletNutBotY = cisternBottomY - 0.014;
  const feedVertLen = Math.max(0.06, inletNutBotY - feedFloorOrWallY);

  const feedVertPipe = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0075, 0.0075, feedVertLen, 16)),
    metalMats.primary
  );
  feedVertPipe.name = `${p}.pipework.coldWaterFeedPipe`;
  feedVertPipe.position.set(feedX, feedFloorOrWallY + feedVertLen * 0.5, feedZ);
  pipeGroup.add(feedVertPipe);

  const feedWallRoseThick = 0.008;
  const feedStubLen = Math.max(0.01, feedZ - feedWallRoseThick);
  const feedWallStub = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0075, 0.0075, feedStubLen, 16)),
    metalMats.primary
  );
  feedWallStub.name = `${p}.pipework.coldWaterWallStub`;
  feedWallStub.rotation.x = Math.PI * 0.5;
  feedWallStub.position.set(feedX, feedFloorOrWallY, feedWallRoseThick + feedStubLen * 0.5);
  pipeGroup.add(feedWallStub);

  const feedWallRose = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.022, 0.024, feedWallRoseThick, 20)),
    metalMats.primary
  );
  feedWallRose.name = `${p}.pipework.coldWaterWallRose`;
  feedWallRose.rotation.x = Math.PI * 0.5;
  feedWallRose.position.set(feedX, feedFloorOrWallY, feedWallRoseThick * 0.5);
  pipeGroup.add(feedWallRose);

  const stopValve = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.012, 0.012, 0.028, 18)),
    metalMats.knurled
  );
  stopValve.name = `${p}.pipework.isolationValve`;
  stopValve.position.set(feedX, feedFloorOrWallY + feedVertLen * 0.45, feedZ);
  pipeGroup.add(stopValve);

  const inletNut = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.014, 0.014, 0.013, 18)),
    metalMats.knurled
  );
  inletNut.name = `${p}.pipework.cisternInletNut`;
  inletNut.position.set(feedX, inletNutBotY + 0.0065, feedZ);
  pipeGroup.add(inletNut);
  {
    attachAssetInteraction(group, {
      kind: 'toggle',
      label: 'Flush Lefroy Brooks Charterhouse WC',
      activeLabel: 'Flushing Cistern…',
      autoResetAfterSec: 2.6,
      audio: { openPreset: 'cisternFlush', volume: 0.72 },
    });
    const fCode = resolveBrasswareCode(opts.finish, 'NI');
    return attachAssetMetadata(finalizeSanitaryGroup(group, 'sanitary'), {
      name: 'Lefroy Brooks Charterhouse Low-Level Cistern WC',
      brand: 'Lefroy Brooks',
      collection: 'Charterhouse',
      sku: 'CHA202-' + fCode,
      finish: 'White Vitreous China / ' + formatBrasswareFinishLabel(opts.finish, 'NI'),
      category: 'sanitaryware',
      dimensionsMm: [510, 710, 1020],
      productUrl: 'https://uk.lefroybrooks.com/products/wcs/charterhouse-wcs',
      schematicUrl: 'https://uk.lefroybrooks.com/downloads/technical/CHA202-dimensioned.pdf',
    });
  }
}
