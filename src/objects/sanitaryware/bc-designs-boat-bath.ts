import * as THREE from 'three';
import { attachAssetMetadata, formatBrasswareFinishLabel, resolveBrasswareCode } from '../shared/catalog-smart-metadata.ts';
import {
  finalizeSanitaryGroup,
  getAcrymiteWhiteMaterial,
  getBathroomBrassMaterials,
  getBoatBathExteriorMaterials,
  getBurnishedCopperMaterials,
} from './bathroom-materials.ts';
import { prepGeo } from '../shared/scene-helpers.ts';
import type { BcDesignsCopperBoatBathOptions } from './bathroom-spec-types.ts';

/**
 * Double-Ended Moulded-Plinth Roll-Top Bateau Bath
 * (Gloss-White `Acrymite` / `Iso-Enamel` interior & overhanging bullnose rolled rim
 * over a warm burnished copper/bronze tapered body & tall 3-part moulded plinth,
 * paired with a `WAS050G` `Polished Brass (BR)` dome clicker waste & internal
 * circular perforated overflow rose).
 *
 * Local coordinate convention:
 * - `(0, 0, 0)` at plan centre on finished floor (`y = 0`)
 * - Bath length along `X` (`-lengthM/2 .. +lengthM/2`), width along `Z` (`-widthM/2 .. +widthM/2`)
 */

function signedPow(val: number, exp: number): number {
  return val < 0 ? -Math.pow(-val, exp) : Math.pow(val, exp);
}

/**
 * Unit rounded-stadium bateau plan `(cx, cz) ∈ [-1, 1]^2` for `theta ∈ [0, 2π]`.
 *
 * Uses asymmetric exponents (`pX = 0.54`, `pZ = 0.98`) so the long front/back walls
 * have a gentle cottage bateau bow while the two ends trace true smooth semicircles
 * (`R_end ≈ 0.90 * bMax`) without boxy superellipse corner shoulders.
 */
function boatPlanUnit(theta: number): { readonly cx: number; readonly cz: number } {
  return {
    cx: signedPow(Math.cos(theta), 0.54),
    cz: signedPow(Math.sin(theta), 0.98),
  };
}

/** Smoothly averages seam normals at `i = 0` and `i = radialSegs` on closed revolution/ring meshes. */
function healRingSeamNormals(
  geo: THREE.BufferGeometry,
  ringCount: number,
  radialSegs: number
): void {
  geo.computeVertexNormals();
  const nAttr = geo.attributes['normal'] as THREE.BufferAttribute | undefined;
  if (!nAttr) return;
  const stride = radialSegs + 1;
  for (let s = 0; s < ringCount; s++) {
    const i0 = s * stride;
    const iN = s * stride + radialSegs;
    const nx = nAttr.getX(i0) + nAttr.getX(iN);
    const ny = nAttr.getY(i0) + nAttr.getY(iN);
    const nz = nAttr.getZ(i0) + nAttr.getZ(iN);
    const len = Math.hypot(nx, ny, nz) || 1;
    nAttr.setXYZ(i0, nx / len, ny / len, nz / len);
    nAttr.setXYZ(iN, nx / len, ny / len, nz / len);
  }
  nAttr.needsUpdate = true;
}

interface RingSpec {
  readonly a: number;
  readonly b: number;
  /** Computes `y` for a vertex with normalized longitudinal coordinate `cx ∈ [-1, 1]`. */
  readonly yAt: (cx: number) => number;
  readonly vUv: number;
}

function buildRingLoftGeometry(rings: readonly RingSpec[], radialSegs: number): THREE.BufferGeometry {
  const stride = radialSegs + 1;
  const vertCount = rings.length * stride;
  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const indices: number[] = [];

  // Compute true normalized perimeter arc-length uArc in [0, 1] so living-copper patina
  // clouds have 100% uniform texel scale around both long walls & semicircular ends, with
  // exact u=0 / u=1 periodic continuity at the theta=0 seam.
  const unitPts: Array<{ readonly cx: number; readonly cz: number }> = [];
  const cumArc = new Float64Array(radialSegs + 1);
  for (let i = 0; i <= radialSegs; i++) {
    const theta = (i / radialSegs) * Math.PI * 2;
    const pt = boatPlanUnit(theta);
    unitPts.push(pt);
    if (i > 0) {
      const prev = unitPts[i - 1]!;
      // Reference 1.70m x 0.74m half-axes ratio (0.85 : 0.37) for physical perimeter arc-length
      const dx = (pt.cx - prev.cx) * 0.85;
      const dz = (pt.cz - prev.cz) * 0.37;
      cumArc[i] = cumArc[i - 1]! + Math.hypot(dx, dz);
    }
  }
  const totalArc = cumArc[radialSegs]! || 1;

  for (let i = 0; i <= radialSegs; i++) {
    const { cx, cz } = unitPts[i]!;
    const uArc = i === radialSegs ? 1.0 : cumArc[i]! / totalArc;

    for (let s = 0; s < rings.length; s++) {
      const ring = rings[s]!;
      const idx = s * stride + i;
      positions[idx * 3] = ring.a * cx;
      positions[idx * 3 + 1] = ring.yAt(cx);
      positions[idx * 3 + 2] = ring.b * cz;

      uvs[idx * 2] = uArc;
      uvs[idx * 2 + 1] = ring.vUv;
    }
  }

  for (let s = 0; s < rings.length - 1; s++) {
    for (let i = 0; i < radialSegs; i++) {
      const i00 = s * stride + i;
      const i10 = (s + 1) * stride + i;
      const i01 = s * stride + (i + 1);
      const i11 = (s + 1) * stride + (i + 1);
      indices.push(i00, i10, i01, i01, i10, i11);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  healRingSeamNormals(geo, rings.length, radialSegs);
  return prepGeo(geo);
}

/**
 * Builds the circular perforated overflow faceplate with 6 perimeter holes around a
 * recessed central fixing screw aperture.
 */
function buildPerforatedOverflowPlateGeometry(): THREE.BufferGeometry {
  const outerR = 0.029;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outerR, 0, Math.PI * 2, false);

  const centerHole = new THREE.Path();
  centerHole.absarc(0, 0, 0.0040, 0, Math.PI * 2, true);
  shape.holes.push(centerHole);

  const ringHoleCount = 6;
  const ringR = 0.0150;
  const holeR = 0.0038;
  for (let i = 0; i < ringHoleCount; i++) {
    const ang = (i / ringHoleCount) * Math.PI * 2 + Math.PI / 6;
    const h = new THREE.Path();
    h.absarc(Math.cos(ang) * ringR, Math.sin(ang) * ringR, holeR, 0, Math.PI * 2, true);
    shape.holes.push(h);
  }

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.0024,
    bevelEnabled: true,
    bevelThickness: 0.0008,
    bevelSize: 0.0008,
    bevelSegments: 3,
    curveSegments: 32,
  });
  geo.rotateX(-Math.PI * 0.5);
  return prepGeo(geo);
}

export function buildBcDesignsCopperBoatBath(
  opts: BcDesignsCopperBoatBathOptions
): THREE.Group {
  const p = opts.namePrefix;
  const lengthM = opts.lengthM ?? 1.700;
  const widthM = opts.widthM ?? 0.740;
  const rawCenterHeightM = opts.centerHeightM ?? 0.640;
  const rawEndHeightM = opts.endHeightM ?? 0.676;
  const rawRise = Math.max(0, rawEndHeightM - rawCenterHeightM);
  // Gentle, serene cottage roll-top bateau sweep (~36mm soft rise toward the two rounded ends,
  // nearly level across the middle ~60%). If legacy steep saddle heights (e.g. 605..715mm) are
  // passed, preserve the true ~640mm mid-body soaking stature (matching BC Designs BAC070 CAD).
  const sheerRise = Math.min(0.036, rawRise);
  const centerRimY =
    rawRise > 0.055 ? rawCenterHeightM + (rawRise - sheerRise) * 0.47 : rawCenterHeightM;
  const brassFinish = opts.brassFinish ?? 'BR';

  const copperMats =
    opts.exteriorFinish === undefined || opts.exteriorFinish === 'copper'
      ? getBurnishedCopperMaterials()
      : getBoatBathExteriorMaterials(opts.exteriorFinish, opts.exteriorPaintColor);
  const acrymiteMat = getAcrymiteWhiteMaterial();
  const brassMats = getBathroomBrassMaterials(brassFinish);

  const group = new THREE.Group();
  group.name = p;

  const aMax = lengthM * 0.5;
  const bMax = widthM * 0.5;

  // Continuous, kink-free gentle bateau curve: nearly level across the central ~60% (u^2.6)
  // and rounding smoothly to horizontal right at the semicircular ends (df/du = 0 at u = 1)
  // so neither side elevation has an S-bump nor end elevation has a pointed gable arch.
  const yRimAt = (cx: number): number => {
    const u = Math.min(1, Math.abs(cx));
    const uPow = Math.pow(u, 2.55);
    const smoothEnd = uPow * (1.85 - 0.85 * uPow);
    return centerRimY + sheerRise * smoothEnd;
  };

  const radialSegs = 104;

  const scaleX = lengthM / 1.700;
  const scaleZ = widthM / 0.740;

  // Overhanging gloss-white bullnose rolled rim (~52mm end overhang, ~46mm side overhang, 47mm vertical bullnose)
  const rimOverhangA = 0.052 * scaleX;
  const rimOverhangB = 0.046 * scaleZ;
  const rimBullHalfH = 0.0235; // 47mm thick exterior white bullnose rolled rim

  const aBodyTop = aMax - rimOverhangA; // 0.798m on 1.70m bath
  const bBodyTop = bMax - rimOverhangB; // 0.324m on 0.74m bath

  // Tailored cottage frustum rake (~15.5° inward rake at rounded ends -> 1336mm waist matching UK 1342mm CAD,
  //    ~8.0° inward rake along front/back walls -> 536mm waist width)
  const waistY = centerRimY * 0.332; // ~0.212m (~33% of center height — tall signature cottage moulded plinth)
  const endBodyRake = 0.130 * scaleX;
  const sideBodyRake = 0.056 * scaleZ;

  const aWaist = aBodyTop - endBodyRake; // 0.668m (1336mm waist length)
  const bWaist = bBodyTop - sideBodyRake; // 0.268m (536mm waist width)

  // Tall 3-Part Architectural Moulded Plinth / Skirt (y = 0 .. waistY)
  // Burnished-bronze plinth silhouette:
  // - Upper cambered collar moulding (top 44mm of plinth): steps crisply +16mm/+14mm proud at waistY,
  //   cants gently down to +11mm/+10mm, then steps inward into a natural shadow throat (+4mm/+3.5mm)
  // - Tall smooth inward-canted plinth skirt band (118mm tall): tapers from +4mm/+3.5mm down to -8mm/-6mm
  // - Flared stepped ogee cove & rounded bullnose base foot (bottom 48mm): flares +24mm/+21mm proud of lower skirt
  const collarTopA = 0.016 * scaleX;
  const collarTopB = 0.014 * scaleZ;
  const collarBotA = 0.011 * scaleX;
  const collarBotB = 0.0095 * scaleZ;

  const aSkirtTop = aWaist + 0.0035 * scaleX;
  const bSkirtTop = bWaist + 0.0030 * scaleZ;
  const aSkirtBot = aWaist - 0.0095 * scaleX;
  const bSkirtBot = bWaist - 0.0075 * scaleZ;

  const footFlareA = 0.024 * scaleX;
  const footFlareB = 0.021 * scaleZ;

  const collarBotY = waistY - 0.044; // ~0.168m
  const skirtTopY = collarBotY - 0.006; // ~0.162m
  const skirtBotY = 0.048;

  const plinthRings: RingSpec[] = [
    // Closed floor pad & dark recessed floor-contact shadow pad
    { a: 0, b: 0, yAt: () => 0.0, vUv: 0.0 },
    { a: aSkirtBot + footFlareA - 0.016, b: bSkirtBot + footFlareB - 0.016, yAt: () => 0.0, vUv: 0.05 },
    { a: aSkirtBot + footFlareA - 0.013, b: bSkirtBot + footFlareB - 0.013, yAt: () => 0.0025, vUv: 0.07 },
    // Substantial rounded bullnose base foot (y = 0.003 .. 0.026m)
    { a: aSkirtBot + footFlareA * 0.78, b: bSkirtBot + footFlareB * 0.78, yAt: () => 0.005, vUv: 0.10 },
    { a: aSkirtBot + footFlareA * 0.96, b: bSkirtBot + footFlareB * 0.96, yAt: () => 0.010, vUv: 0.13 },
    { a: aSkirtBot + footFlareA, b: bSkirtBot + footFlareB, yAt: () => 0.016, vUv: 0.16 },
    { a: aSkirtBot + footFlareA * 0.92, b: bSkirtBot + footFlareB * 0.92, yAt: () => 0.023, vUv: 0.19 },
    // Smooth concave ogee / cove transition into skirt base fillet (y = 0.026 .. 0.048m)
    { a: aSkirtBot + footFlareA * 0.65, b: bSkirtBot + footFlareB * 0.65, yAt: () => 0.030, vUv: 0.23 },
    { a: aSkirtBot + footFlareA * 0.34, b: bSkirtBot + footFlareB * 0.34, yAt: () => 0.037, vUv: 0.27 },
    { a: aSkirtBot + footFlareA * 0.10, b: bSkirtBot + footFlareB * 0.10, yAt: () => 0.043, vUv: 0.31 },
    { a: aSkirtBot, b: bSkirtBot, yAt: () => skirtBotY - 0.001, vUv: 0.33 },
    { a: aSkirtBot, b: bSkirtBot, yAt: () => skirtBotY + 0.001, vUv: 0.34 },
    // Tall smooth slightly inward-canted plinth skirt band (y = 0.049 .. 0.162m, ~114mm tall)
    {
      a: aSkirtBot + (aSkirtTop - aSkirtBot) * 0.34,
      b: bSkirtBot + (bSkirtTop - bSkirtBot) * 0.34,
      yAt: () => skirtBotY + (skirtTopY - skirtBotY) * 0.34,
      vUv: 0.48,
    },
    {
      a: aSkirtBot + (aSkirtTop - aSkirtBot) * 0.68,
      b: bSkirtBot + (bSkirtTop - bSkirtBot) * 0.68,
      yAt: () => skirtBotY + (skirtTopY - skirtBotY) * 0.68,
      vUv: 0.62,
    },
    { a: aSkirtTop, b: bSkirtTop, yAt: () => skirtTopY - 0.001, vUv: 0.74 },
    // Natural stepped-in shadow throat where upper collar overhangs the skirt band (~7.5mm overhang!)
    { a: aSkirtTop, b: bSkirtTop, yAt: () => skirtTopY + 0.0008, vUv: 0.75 },
    {
      a: aWaist + collarBotA * 0.62,
      b: bWaist + collarBotB * 0.62,
      yAt: () => collarBotY - 0.0025,
      vUv: 0.77,
    },
    {
      a: aWaist + collarBotA,
      b: bWaist + collarBotB,
      yAt: () => collarBotY + 0.001,
      vUv: 0.79,
    },
    // Substantial 44mm-tall softly cambered & upward-flaring waist collar moulding
    {
      a: aWaist + collarBotA + (collarTopA - collarBotA) * 0.38 + 0.0012,
      b: bWaist + collarBotB + (collarTopB - collarBotB) * 0.38 + 0.0010,
      yAt: () => collarBotY + (waistY - collarBotY) * 0.34,
      vUv: 0.85,
    },
    {
      a: aWaist + collarBotA + (collarTopA - collarBotA) * 0.76 + 0.0015,
      b: bWaist + collarBotB + (collarTopB - collarBotB) * 0.76 + 0.0012,
      yAt: () => collarBotY + (waistY - collarBotY) * 0.68,
      vUv: 0.91,
    },
    {
      a: aWaist + collarTopA,
      b: bWaist + collarTopB,
      yAt: () => waistY - 0.0055,
      vUv: 0.94,
    },
    // Crisp rounded upper collar shoulder & horizontal step-in ledge into waist shadow rebate
    {
      a: aWaist + collarTopA * 0.88,
      b: bWaist + collarTopB * 0.88,
      yAt: () => waistY - 0.0020,
      vUv: 0.96,
    },
    {
      a: aWaist + collarTopA * 0.45,
      b: bWaist + collarTopB * 0.45,
      yAt: () => waistY - 0.0004,
      vUv: 0.98,
    },
    { a: aWaist - 0.006, b: bWaist - 0.006, yAt: () => waistY, vUv: 0.99 },
    { a: aWaist - 0.010, b: bWaist - 0.010, yAt: () => waistY + 0.003, vUv: 1.0 },
  ];

  const plinthMesh = new THREE.Mesh(
    buildRingLoftGeometry(plinthRings, radialSegs),
    copperMats.plinth
  );
  plinthMesh.name = `${p}.copperPlinth`;
  group.add(plinthMesh);

  // Subtle recessed dark shadow seam tucked right inside the waist rebate joint
  const seamRings: RingSpec[] = [
    { a: aWaist - 0.003, b: bWaist - 0.003, yAt: () => waistY - 0.0003, vUv: 0 },
    { a: aWaist + 0.0012, b: bWaist + 0.0012, yAt: () => waistY + 0.0010, vUv: 0.5 },
    { a: aWaist - 0.0025, b: bWaist - 0.0025, yAt: () => waistY + 0.0026, vUv: 1 },
  ];
  const waistSeamMesh = new THREE.Mesh(
    buildRingLoftGeometry(seamRings, radialSegs),
    brassMats.darkShadow
  );
  waistSeamMesh.name = `${p}.waistShadowSeam`;
  group.add(waistSeamMesh);

  // Inward-Tapering Burnished Copper/Bronze Body (y = waistY .. underside of white rolled rim)
  const hullSteps = 12;
  const hullRings: RingSpec[] = [
    { a: aWaist - 0.005, b: bWaist - 0.005, yAt: () => waistY - 0.0005, vUv: 0.0 },
    { a: aWaist, b: bWaist, yAt: () => waistY + 0.0022, vUv: 0.02 },
  ];

  for (let k = 1; k <= hullSteps; k++) {
    const t = k / hullSteps;
    const rFrac = 0.96 * t + 0.04 * (t * t * (3 - 2 * t));
    const a = aWaist + (aBodyTop - aWaist) * rFrac;
    const b = bWaist + (bBodyTop - bWaist) * rFrac;
    hullRings.push({
      a,
      b,
      yAt: (cx) => {
        const topNeckY = yRimAt(cx) - rimBullHalfH * 2 + 0.003;
        return waistY + 0.0022 + (topNeckY - (waistY + 0.0022)) * t;
      },
      vUv: 0.02 + t * 0.94,
    });
  }
  hullRings.push({
    a: aBodyTop - 0.005,
    b: bBodyTop - 0.005,
    yAt: (cx) => yRimAt(cx) - rimBullHalfH * 2 + 0.008,
    vUv: 1.0,
  });

  const copperShellMesh = new THREE.Mesh(
    buildRingLoftGeometry(hullRings, radialSegs),
    copperMats.shell
  );
  copperShellMesh.name = `${p}.copperOuterShell`;
  group.add(copperShellMesh);

  // Gloss-White Overhanging Bullnose Roll-Top Rim & Double-Ended Interior Bowl
  const rimTotalWidthA = 0.074 * scaleX;
  const rimTotalWidthB = 0.066 * scaleZ;
  const innerLipDrop = 0.018;
  const floorWellY = 0.168;

  const aInnerTop = aMax - rimTotalWidthA;
  const bInnerTop = bMax - rimTotalWidthB;
  const aInnerFloor = aInnerTop - 0.220 * scaleX;
  const bInnerFloor = bInnerTop - 0.078 * scaleZ;

  const innerRings: RingSpec[] = [
    // Underside soffit tucking cleanly from copper body neck outward to bottom of bullnose drip lip
    {
      a: aBodyTop - 0.004,
      b: bBodyTop - 0.004,
      yAt: (cx) => yRimAt(cx) - rimBullHalfH * 2 + 0.005,
      vUv: 0.0,
    },
    {
      a: aBodyTop + 0.001,
      b: bBodyTop + 0.001,
      yAt: (cx) => yRimAt(cx) - rimBullHalfH * 2 + 0.0025,
      vUv: 0.02,
    },
    {
      a: aMax - rimBullHalfH * 1.10,
      b: bMax - rimBullHalfH * 1.10,
      yAt: (cx) => yRimAt(cx) - rimBullHalfH * 2 + 0.0008,
      vUv: 0.05,
    },
  ];

  // Plump semicircular exterior bullnose roll: bottom lip (-π/2) -> outer equator (0) -> upper roll crest (+π/2)
  const outerBullSegs = 12;
  for (let k = 0; k <= outerBullSegs; k++) {
    const phi = -Math.PI * 0.5 + (k / outerBullSegs) * Math.PI;
    const rOut = rimBullHalfH * (1 - Math.cos(phi));
    const yOff = -rimBullHalfH * (1 - Math.sin(phi));
    innerRings.push({
      a: aMax - rOut,
      b: bMax - rOut,
      yAt: (cx) => yRimAt(cx) + yOff,
      vUv: 0.06 + (k / outerBullSegs) * 0.14,
    });
  }

  // Gently crowned top rim deck curving smoothly over inner lip into interior bowl
  const innerLipSegs = 6;
  for (let k = 1; k <= innerLipSegs; k++) {
    const s = k / innerLipSegs;
    const phi = s * Math.PI * 0.5;
    const easeR = Math.sin(phi);
    const drop = innerLipDrop * (1 - Math.cos(phi));
    innerRings.push({
      a: aMax - rimBullHalfH - (rimTotalWidthA - rimBullHalfH) * easeR,
      b: bMax - rimBullHalfH - (rimTotalWidthB - rimBullHalfH) * easeR,
      yAt: (cx) => yRimAt(cx) - drop,
      vUv: 0.20 + s * 0.08,
    });
  }

  // Ergonomic sloped interior backrests & side walls descending via smooth cove to floor well
  const bowlSteps = 16;
  const wallExpR = 1.24;
  const wallExpY = 1.48;
  for (let k = 1; k <= bowlSteps; k++) {
    const t = k / bowlSteps;
    const wallRFrac = Math.pow(1 - t, wallExpR);
    const yDropFrac = 1 - Math.pow(1 - t, wallExpY);
    const a = aInnerFloor + (aInnerTop - aInnerFloor) * wallRFrac;
    const b = bInnerFloor + (bInnerTop - bInnerFloor) * wallRFrac;
    innerRings.push({
      a,
      b,
      yAt: (cx) => {
        const startY = yRimAt(cx) - innerLipDrop;
        return startY + (floorWellY - startY) * yDropFrac;
      },
      vUv: 0.28 + t * 0.54,
    });
  }

  // Flat bathing floor well closing into central recessed WAS050G waste sump
  innerRings.push(
    { a: aInnerFloor * 0.55, b: bInnerFloor * 0.55, yAt: () => floorWellY - 0.0015, vUv: 0.90 },
    { a: 0.038, b: 0.038, yAt: () => floorWellY - 0.0025, vUv: 0.95 },
    { a: 0.034, b: 0.034, yAt: () => floorWellY - 0.0050, vUv: 0.98 },
    { a: 0, b: 0, yAt: () => floorWellY - 0.0050, vUv: 1.0 }
  );

  const innerBowlMesh = new THREE.Mesh(
    buildRingLoftGeometry(innerRings, radialSegs),
    acrymiteMat
  );
  innerBowlMesh.name = `${p}.acrymiteInnerBowl`;
  group.add(innerBowlMesh);

  // WAS050G Polished Brass Center Dome Clicker Waste & Internal Circular Perforated Overflow Rose
  const wasteGroup = new THREE.Group();
  wasteGroup.name = `${p}.wasteAndOverflow`;
  group.add(wasteGroup);

  const wasteFlange = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.035, 0.034, 0.0035, 36)),
    brassMats.primary
  );
  wasteFlange.name = `${p}.wasteAndOverflow.wasteFlange`;
  wasteFlange.position.set(0, floorWellY - 0.0032, 0);
  wasteGroup.add(wasteFlange);

  const wasteGap = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0285, 0.0285, 0.004, 32)),
    brassMats.darkShadow
  );
  wasteGap.name = `${p}.wasteAndOverflow.wasteDrainSlot`;
  wasteGap.position.set(0, floorWellY - 0.0020, 0);
  wasteGroup.add(wasteGap);

  const clickPlugPts = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.026, 0),
    new THREE.Vector2(0.026, 0.0032),
    new THREE.Vector2(0.022, 0.0062),
    new THREE.Vector2(0.013, 0.0084),
    new THREE.Vector2(0, 0.0092),
  ];
  const wastePlug = new THREE.Mesh(
    prepGeo(new THREE.LatheGeometry(clickPlugPts, 36)),
    brassMats.primary
  );
  wastePlug.name = `${p}.wasteAndOverflow.clickClackPlug`;
  wastePlug.position.set(0, floorWellY - 0.0005, 0);
  wasteGroup.add(wastePlug);

  // Internal circular perforated overflow rose centered on the back (-Z / North) inner bowl wall
  // just below the white rolled rim (x = 0, cz = -1), aligned under the floorstanding bath mixer.
  const overflowY = centerRimY - 0.105;
  const startCenterY = centerRimY - innerLipDrop;
  const yDropTarget = (overflowY - startCenterY) / (floorWellY - startCenterY);
  const oneMinusT = Math.pow(Math.max(0.02, 1 - yDropTarget), 1 / wallExpY);
  const wallRFracOv = Math.pow(oneMinusT, wallExpR);
  const zInnerAbs = bInnerFloor + (bInnerTop - bInnerFloor) * wallRFracOv;

  const dyDt = -(floorWellY - startCenterY) * wallExpY * Math.pow(oneMinusT, wallExpY - 1);
  const dbDt = -(bInnerTop - bInnerFloor) * wallExpR * Math.pow(oneMinusT, wallExpR - 1);
  const sideWallTiltX = Math.atan2(Math.abs(dbDt), Math.abs(dyDt));

  const internalOverflowGroup = new THREE.Group();
  internalOverflowGroup.name = `${p}.wasteAndOverflow.internalOverflowRose`;
  internalOverflowGroup.position.set(0, overflowY, -(zInnerAbs - 0.0006));
  internalOverflowGroup.rotation.x = Math.PI * 0.5 - sideWallTiltX;
  wasteGroup.add(internalOverflowGroup);

  const ovSlotShadow = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0235, 0.0235, 0.0022, 32)),
    brassMats.darkShadow
  );
  ovSlotShadow.name = `${p}.wasteAndOverflow.internalOverflowRose.slotShadow`;
  ovSlotShadow.position.y = 0.0004;
  internalOverflowGroup.add(ovSlotShadow);

  const ovOuterRing = new THREE.Mesh(
    prepGeo(new THREE.TorusGeometry(0.0295, 0.0016, 12, 36)),
    brassMats.primary
  );
  ovOuterRing.name = `${p}.wasteAndOverflow.internalOverflowRose.bezelRing`;
  ovOuterRing.rotation.x = Math.PI * 0.5;
  ovOuterRing.position.y = 0.0015;
  internalOverflowGroup.add(ovOuterRing);

  const ovPerforatedPlate = new THREE.Mesh(
    buildPerforatedOverflowPlateGeometry(),
    brassMats.primary
  );
  ovPerforatedPlate.name = `${p}.wasteAndOverflow.internalOverflowRose.perforatedPlate`;
  ovPerforatedPlate.position.y = 0.0008;
  internalOverflowGroup.add(ovPerforatedPlate);

  const ovCenterScrew = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0023, 0.0023, 0.0018, 18)),
    brassMats.knurled
  );
  ovCenterScrew.name = `${p}.wasteAndOverflow.internalOverflowRose.centerFixing`;
  ovCenterScrew.position.y = 0.0012;
  internalOverflowGroup.add(ovCenterScrew);

  const fCode = resolveBrasswareCode(opts.brassFinish, 'AB');
  return attachAssetMetadata(finalizeSanitaryGroup(group, 'sanitary'), {
    name: 'BC Designs Boat Roll-Top Freestanding Bath',
    brand: 'BC Designs',
    collection: 'Cian & Metal Boat Baths',
    sku: `BCD-BAB022-${fCode}`,
    finish: `${opts.exteriorFinish ?? 'Hammered Burnished Copper'} / ${formatBrasswareFinishLabel(opts.brassFinish, 'AB')}`,
    category: 'sanitaryware',
    dimensionsMm: [1700, 750, 710],
    productUrl: 'https://www.bcdesigns.co.uk/baths/copper-and-metal-baths/copper-boat-bath/',
    schematicUrl: 'https://www.bcdesigns.co.uk/downloads/technical/BAB022-Boat-Bath-Spec.pdf',
  });
}
