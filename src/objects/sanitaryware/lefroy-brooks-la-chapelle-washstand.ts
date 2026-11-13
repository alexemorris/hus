import * as THREE from 'three';
import { attachAssetMetadata, formatBrasswareFinishLabel, resolveBrasswareCode } from '../shared/catalog-smart-metadata.ts';
import {
  finalizeSanitaryGroup,
  getBathroomBrassMaterials,
  getVitreousChinaMaterial,
} from './bathroom-materials.ts';
import { prepGeo } from '../shared/scene-helpers.ts';
import { buildDeco3HoleBasinMixer3142 } from './perrin-rowe-deco.ts';
import {
  buildBasinTapFromSpec,
  isCustomTapObject3D,
  mountTapOnFixture,
  registerTapMountAnchor,
} from './perrin-rowe-taps.ts';
import type { LefroyBrooksLaChapelleWashstandOptions } from './bathroom-spec-types.ts';

/**
 * Lefroy Brooks `1910 La Chapelle` Narrow 3TH Basin + Ball-Jointed Tubular Console Stand
 * (`LB 7723` Ceramic Basin + `LB 3226BN` Silver Nickel Stand + `P&R Deco 3142PF` 3TH Mixer
 *  + `6800PF` Slotted Push Waste + `6303PF` Exposed Pewter Bottle Trap).
 *
 * Modeled millimeter-accurate to the official Lefroy Brooks & Perrin & Rowe UK CAD drawings:
 * - `LB 7723`: `W = 575mm` (`±0.2875m`), `D = 468mm` (`0.468m` bow-front centre; `0.424m` side shoulders),
 *   `H = 860mm` (`0.860m`) front/side rim, `895mm` (`0.895m`) stepped rear splashback upstand top,
 *   `770mm` (`0.770m`) leg flange seat (`758mm` lower stepped apron band), `653mm` (`0.653m`) waste boss bottom,
 *   3 tap holes at `200mm` centres (`z = 70mm`), left & right recessed rectangular soap dishes,
 *   smooth oval bowl with waste at `z = 191mm` (`0.191m`) and triple-slot ceramic rear overflow.
 * - `LB 3226BN` (`BN` Silver Nickel): `Ø25.4mm` (`1"`) vertical legs at `495mm` CRS (`x = ±0.2475m`),
 *   `z = 330mm` (`0.330m`) from rear wall, turned tapered acorn floor feet (`y = 0..85mm`), `Ø45mm` top
 *   support flanges (`y = 770mm`), spherical ball-joint collars at `y = 620mm` (`0.620m`) with rear
 *   horizontal wall stays into `Ø75mm` stepped wall flanges + continuous U-bowed `570mm`-wide (`±0.285m`)
 *   tubular towel rail bowing forward to `z = 438mm` (`0.438m`).
 */

function createSteppedWallEscutcheon(outerR: number, innerR: number, depth: number): THREE.LatheGeometry {
  const pts = [
    new THREE.Vector2(innerR * 0.9, 0),
    new THREE.Vector2(outerR, 0),
    new THREE.Vector2(outerR, depth * 0.42),
    new THREE.Vector2(outerR * 0.80, depth * 0.58),
    new THREE.Vector2(outerR * 0.76, depth * 0.88),
    new THREE.Vector2(innerR, depth),
  ];
  return prepGeo(new THREE.LatheGeometry(pts, 28));
}

/**
 * Samples the exact closed 2D plan contour `(x, z)` of `LB 7723`:
 * - Flat rear wall (`z = zBack`),
 * - Straight parallel sides (`x = ±hw`, advancing to `z = zShoulder - cornerR`),
 * - Rounded front corners (`zShoulder ≈ 424mm`) transitioning via an ogee S-curve into
 *   the signature `La Chapelle` central bow-front apron (`z = depthM = 468mm` at `x = 0`).
 * Ordered counter-clockwise in `(X, Z)` starting at `(0, zBack)`.
 */
function buildDenseLaChapellePerimeter(
  widthM: number,
  depthM: number,
  insetM: number
): THREE.Vector2[] {
  const hw = Math.max(0.10, widthM * 0.5 - insetM);
  const zBack = Math.max(0, insetM * 0.45);
  // Central bow projects +44mm ahead of side-front shoulders (468mm vs 424mm on LB 7723 CAD plan)
  const bowAmp = Math.max(0.012, 0.044 - insetM * 0.18);
  const zShoulder = Math.max(zBack + 0.12, depthM - bowAmp - insetM);
  const cornerR = Math.min(0.042, hw * 0.25);

  const ogeeBow = (x: number): number => {
    const u = Math.min(1, Math.abs(x) / Math.max(1e-5, hw - cornerR * 0.6));
    // Smooth raised-cosine ogee bell (1 at x=0, 0 at side shoulders)
    return bowAmp * 0.5 * (1 + Math.cos(u * Math.PI));
  };

  const dense: THREE.Vector2[] = [];

  // Rear left half: (0, zBack) -> (-hw, zBack)
  const rearHalfSteps = 28;
  for (let i = 0; i <= rearHalfSteps; i++) {
    dense.push(new THREE.Vector2(-(hw * i) / rearHalfSteps, zBack));
  }

  // Left straight side: (-hw, zBack) -> (-hw, zShoulder - cornerR)
  const sideSteps = 28;
  for (let i = 1; i <= sideSteps; i++) {
    const z = zBack + ((zShoulder - cornerR - zBack) * i) / sideSteps;
    dense.push(new THREE.Vector2(-hw, z));
  }

  // Front-left rounded shoulder arc
  const arcSteps = 18;
  for (let i = 1; i <= arcSteps; i++) {
    const a = Math.PI - (i / arcSteps) * (Math.PI * 0.5);
    const x = -hw + cornerR + Math.cos(a) * cornerR;
    const zBase = zShoulder - cornerR + Math.sin(a) * cornerR;
    dense.push(new THREE.Vector2(x, zBase + ogeeBow(x) * (i / arcSteps)));
  }

  // Ogee S-curved bow-front apron: (-hw + cornerR) -> (+hw - cornerR), peaking at z = depthM - insetM at x = 0
  const frontSteps = 52;
  for (let i = 1; i < frontSteps; i++) {
    const t = i / frontSteps;
    const x = -hw + cornerR + 2 * (hw - cornerR) * t;
    dense.push(new THREE.Vector2(x, zShoulder + ogeeBow(x)));
  }

  // Front-right rounded shoulder arc
  for (let i = 0; i <= arcSteps; i++) {
    const a = Math.PI * 0.5 - (i / arcSteps) * (Math.PI * 0.5);
    const x = hw - cornerR + Math.cos(a) * cornerR;
    const zBase = zShoulder - cornerR + Math.sin(a) * cornerR;
    dense.push(new THREE.Vector2(x, zBase + ogeeBow(x) * (1 - i / arcSteps)));
  }

  // Right straight side: (+hw, zShoulder - cornerR) -> (+hw, zBack)
  for (let i = 1; i <= sideSteps; i++) {
    const z = zShoulder - cornerR - ((zShoulder - cornerR - zBack) * i) / sideSteps;
    dense.push(new THREE.Vector2(hw, z));
  }

  // Rear right half: (+hw, zBack) -> (0, zBack)
  for (let i = 1; i <= rearHalfSteps; i++) {
    dense.push(new THREE.Vector2(hw * (1 - i / rearHalfSteps), zBack));
  }

  return dense;
}

function sampleUniformContour(
  widthM: number,
  depthM: number,
  insetM: number,
  segmentCount = 68
): THREE.Vector2[] {
  const dense = buildDenseLaChapellePerimeter(widthM, depthM, insetM);
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

function sampleOuterContourAtAzimuths(
  widthM: number,
  depthM: number,
  insetM: number,
  originZ: number,
  azimuths: readonly number[]
): THREE.Vector2[] {
  const dense = buildDenseLaChapellePerimeter(widthM, depthM, insetM);
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < azimuths.length - 1; i++) {
    const theta = azimuths[i]!;
    const ux = Math.cos(theta);
    const uz = Math.sin(theta);
    let bestR = 0;
    for (let j = 0; j < dense.length - 1; j++) {
      const ax = dense[j]!.x;
      const az = dense[j]!.y - originZ;
      const bx = dense[j + 1]!.x;
      const bz = dense[j + 1]!.y - originZ;
      const dx = bx - ax;
      const dz = bz - az;
      const det = ux * dz - uz * dx;
      if (Math.abs(det) < 1e-12) continue;
      const t = (ux * az - uz * ax) / -det;
      if (t >= -1e-7 && t <= 1 + 1e-7) {
        const r = (ax * dz - az * dx) / det;
        if (r > bestR) bestR = r;
      }
    }
    out.push(new THREE.Vector2(bestR * ux, originZ + bestR * uz));
  }
  out.push(out[0]!.clone());
  return out;
}

function sampleOvalBowlAtAzimuths(
  azimuths: readonly number[],
  bowlHalfW: number,
  bowlHalfD: number,
  bowlCenterZ: number,
  poleCenterZ = bowlCenterZ
): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  const q = 2.15;
  for (let i = 0; i < azimuths.length - 1; i++) {
    const theta = azimuths[i]!;
    const ux = Math.cos(theta);
    const uz = Math.sin(theta);
    const denom =
      Math.pow(Math.abs(ux) / Math.max(1e-6, bowlHalfW), q) +
      Math.pow(Math.abs(uz) / Math.max(1e-6, bowlHalfD), q);
    const r = denom > 0 ? Math.pow(denom, -1 / q) : 0;
    out.push(new THREE.Vector2(r * ux, poleCenterZ + r * uz));
  }
  out.push(out[0]!.clone());
  return out;
}

function buildLoftedShell(
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

  const normAttr = geo.getAttribute('normal') as THREE.BufferAttribute;
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

export function buildLefroyBrooksLaChapelleWashstand(
  opts: LefroyBrooksLaChapelleWashstandOptions
): THREE.Group {
  const p = opts.namePrefix;
  const standFinish = opts.standFinish ?? 'BN';         // LB 3226BN Silver Nickel
  const brasswareFinish = opts.brasswareFinish ?? 'PF'; // P&R Deco 3142PF + 6800PF + 6303PF Pewter
  const widthM = opts.widthM ?? 0.575;                  // 575mm exact
  const depthM = opts.depthM ?? 0.468;                  // 468mm exact
  const rimHeightM = opts.rimHeightM ?? 0.860;          // 860mm front/side rim exact
  const upstandTopHeightM = opts.upstandTopHeightM ?? 0.895; // 895mm rear upstand top exact

  const chinaMat = getVitreousChinaMaterial();
  const standMats = getBathroomBrassMaterials(standFinish);
  const brassMats = getBathroomBrassMaterials(brasswareFinish);
  const wasteMats = opts.wasteFinish ? getBathroomBrassMaterials(opts.wasteFinish) : brassMats;

  const root = new THREE.Group();
  root.name = p;

  // Exact CAD vertical elevations (metres above y = 0 floor):
  const legSeatY = rimHeightM - 0.090;      // 0.770m (770mm leg flange bearing seat)
  const lowerApronStepY = legSeatY - 0.012; // 0.758m (20mm lower stepped La Chapelle apron band)
  const bowlFloorY = rimHeightM - 0.168;    // 0.692m interior waste well floor
  const wasteBossBottomY = 0.653;           // 0.653m (895 - 242 = 653mm CAD waste boss bottom)

  // Exact CAD horizontal Z coordinates from rear wall (z = 0):
  const deckTapZ = 0.070;   // 70mm tap hole centreline
  const wasteZ = 0.191;     // 191mm waste & bottle trap centreline
  const bowlRearZ = 0.128;
  const bowlFrontZ = depthM - 0.064; // 0.404m
  const bowlCenterZ = (bowlRearZ + bowlFrontZ) * 0.5; // 0.266m
  const bowlHalfD = (bowlFrontZ - bowlRearZ) * 0.5;   // 0.138m
  const bowlHalfW = widthM * 0.5 - 0.074;             // 0.2135m (427mm interior bowl width)

  // `LB 7723` Vitreous China `1910 La Chapelle` 3TH Basin (575 × 468 × 895mm)
  const basinGroup = new THREE.Group();
  basinGroup.name = `${p}.laChapelleBasin7723`;
  root.add(basinGroup);

  const cRimOuter = sampleUniformContour(widthM, depthM, 0.0, 68);
  const azimuths = cRimOuter.map((pt) => Math.atan2(pt.y - bowlCenterZ, pt.x));

  // Stepped architectural La Chapelle exterior apron & moulded bullnose rim profiles
  const cLowerStepBot = sampleOuterContourAtAzimuths(widthM, depthM, 0.024, bowlCenterZ, azimuths);
  const cLowerStepOut = sampleOuterContourAtAzimuths(widthM, depthM, 0.018, bowlCenterZ, azimuths);
  const cApronMain = sampleOuterContourAtAzimuths(widthM, depthM, 0.012, bowlCenterZ, azimuths);
  const cRimNeck = sampleOuterContourAtAzimuths(widthM, depthM, 0.008, bowlCenterZ, azimuths);
  const cRimCrest = sampleOuterContourAtAzimuths(widthM, depthM, 0.008, bowlCenterZ, azimuths);

  const cBowlRim = sampleOvalBowlAtAzimuths(azimuths, bowlHalfW, bowlHalfD, bowlCenterZ);
  const cBowlUpper = sampleOvalBowlAtAzimuths(azimuths, bowlHalfW * 0.94, bowlHalfD * 0.93, bowlCenterZ);
  const cBowlMid = sampleOvalBowlAtAzimuths(azimuths, bowlHalfW * 0.78, bowlHalfD * 0.76, bowlCenterZ, bowlCenterZ * 0.72 + wasteZ * 0.28);
  const cBowlCove = sampleOvalBowlAtAzimuths(azimuths, bowlHalfW * 0.52, bowlHalfD * 0.50, bowlCenterZ, bowlCenterZ * 0.35 + wasteZ * 0.65);
  const cBowlWell = sampleOvalBowlAtAzimuths(azimuths, 0.036, 0.036, bowlCenterZ, wasteZ);
  const cWastePole = sampleOvalBowlAtAzimuths(azimuths, 0.0005, 0.0005, bowlCenterZ, wasteZ);

  const basinShellGeo = buildLoftedShell([
    { pts: cWastePole, y: wasteBossBottomY, vUv: 0.0 },
    { pts: sampleOvalBowlAtAzimuths(azimuths, 0.048, 0.048, bowlCenterZ, wasteZ), y: wasteBossBottomY + 0.004, vUv: 0.06 },
    { pts: sampleOvalBowlAtAzimuths(azimuths, bowlHalfW * 0.66, bowlHalfD * 0.64, bowlCenterZ, bowlCenterZ * 0.6 + wasteZ * 0.4), y: wasteBossBottomY + 0.026, vUv: 0.14 },
    { pts: sampleOvalBowlAtAzimuths(azimuths, bowlHalfW * 0.90, bowlHalfD * 0.88, bowlCenterZ), y: lowerApronStepY + 0.004, vUv: 0.22 },
    { pts: cLowerStepBot, y: lowerApronStepY, vUv: 0.28 },
    { pts: cLowerStepOut, y: legSeatY, vUv: 0.34 },
    { pts: cApronMain, y: legSeatY + 0.004, vUv: 0.38 },
    { pts: cApronMain, y: rimHeightM - 0.024, vUv: 0.45 },
    { pts: cRimNeck, y: rimHeightM - 0.018, vUv: 0.48 },
    { pts: cRimOuter, y: rimHeightM - 0.009, vUv: 0.52 },
    { pts: cRimCrest, y: rimHeightM, vUv: 0.56 },
    { pts: cBowlRim, y: rimHeightM - 0.002, vUv: 0.64 },
    { pts: cBowlUpper, y: rimHeightM - 0.038, vUv: 0.72 },
    { pts: cBowlMid, y: rimHeightM - 0.104, vUv: 0.82 },
    { pts: cBowlCove, y: bowlFloorY + 0.015, vUv: 0.90 },
    { pts: cBowlWell, y: bowlFloorY, vUv: 0.97 },
    { pts: cWastePole, y: bowlFloorY, vUv: 1.0 },
  ]);
  const basinShell = new THREE.Mesh(basinShellGeo, chinaMat);
  basinShell.name = `${basinGroup.name}.shell`;
  basinGroup.add(basinShell);

  // Integral Stepped `1910 La Chapelle` Rear Splashback Upstand (`y = 0.860..0.895m`, `+35mm` high)
  // Full rear width (`575mm`) with stepped central architectural crest and sloped corner returns
  const upstandBevel = 0.003;
  const upstandH = Math.max(0.017, upstandTopHeightM - rimHeightM - upstandBevel); // +3mm bevel = exact 35mm (895mm top)
  const upstandHalfW = widthM * 0.5 - 0.003;
  const crestHalfW = upstandHalfW - 0.058;
  const upstandShape = new THREE.Shape();
  upstandShape.moveTo(-upstandHalfW, -0.004);
  upstandShape.lineTo(-upstandHalfW, upstandH * 0.58);
  upstandShape.lineTo(-crestHalfW - 0.016, upstandH * 0.74);
  upstandShape.lineTo(-crestHalfW, upstandH);
  upstandShape.lineTo(crestHalfW, upstandH);
  upstandShape.lineTo(crestHalfW + 0.016, upstandH * 0.74);
  upstandShape.lineTo(upstandHalfW, upstandH * 0.58);
  upstandShape.lineTo(upstandHalfW, -0.004);
  upstandShape.closePath();

  const upstandGeo = prepGeo(
    new THREE.ExtrudeGeometry(upstandShape, {
      depth: 0.024,
      bevelEnabled: true,
      bevelSegments: 2,
      bevelSize: 0.003,
      bevelThickness: 0.003,
      steps: 1,
    })
  );
  const upstandMesh = new THREE.Mesh(upstandGeo, chinaMat);
  upstandMesh.name = `${basinGroup.name}.steppedSplashbackUpstand`;
  upstandMesh.position.set(0, rimHeightM, 0.003);
  basinGroup.add(upstandMesh);

  // Stepped top cornice moulding beading along the central splashback crest (`y = 0.895m`)
  const crestBead = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(crestHalfW * 2 + 0.006, 0.006, 0.031)),
    chinaMat
  );
  crestBead.name = `${basinGroup.name}.upstandCorniceBead`;
  crestBead.position.set(0, upstandTopHeightM - 0.003, 0.0155);
  basinGroup.add(crestBead);

  // Left & right moulded rectangular soap dish recesses on rear ceramic deck (`x = ±0.198m, z = 0.078m`)
  for (const [sLabel, sx] of [
    ['soapDishLeft', -0.198],
    ['soapDishRight', 0.198],
  ] as const) {
    const dishRimShape = new THREE.Shape();
    dishRimShape.moveTo(-0.044, -0.024);
    dishRimShape.lineTo(0.044, -0.024);
    dishRimShape.lineTo(0.044, 0.024);
    dishRimShape.lineTo(-0.044, 0.024);
    dishRimShape.closePath();

    const dishWell = new THREE.Path();
    dishWell.moveTo(-0.036, -0.017);
    dishWell.lineTo(-0.036, 0.017);
    dishWell.lineTo(0.036, 0.017);
    dishWell.lineTo(0.036, -0.017);
    dishWell.closePath();
    dishRimShape.holes.push(dishWell);

    const dishGeo = prepGeo(
      new THREE.ExtrudeGeometry(dishRimShape, {
        depth: 0.0035,
        bevelEnabled: true,
        bevelSegments: 2,
        bevelSize: 0.0015,
        bevelThickness: 0.0015,
      }).rotateX(Math.PI / 2)
    );
    const dishMesh = new THREE.Mesh(dishGeo, chinaMat);
    dishMesh.name = `${basinGroup.name}.${sLabel}`;
    dishMesh.position.set(sx, rimHeightM + 0.0028, 0.078);
    basinGroup.add(dishMesh);

    // Subtle draining ribs inside soap dish
    for (const rx of [-0.016, 0, 0.016]) {
      const rib = new THREE.Mesh(
        prepGeo(new THREE.BoxGeometry(0.003, 0.002, 0.024)),
        chinaMat
      );
      rib.name = `${basinGroup.name}.${sLabel}Rib`;
      rib.position.set(sx + rx, rimHeightM + 0.001, 0.078);
      basinGroup.add(rib);
    }
  }

  // Triple-slot ceramic rear overflow on interior rear bowl wall (`z = bowlRearZ + 0.004m`)
  for (const [slotIdx, ox] of [
    [0, -0.013],
    [1, 0],
    [2, 0.013],
  ] as const) {
    const slot = new THREE.Mesh(
      prepGeo(new THREE.BoxGeometry(0.0055, 0.018, 0.004)),
      brassMats.darkShadow
    );
    slot.name = `${basinGroup.name}.overflowSlot.${slotIdx}`;
    slot.position.set(ox, rimHeightM - 0.044, bowlRearZ + 0.005);
    slot.rotation.x = 0.22;
    basinGroup.add(slot);
  }

  // `6800PF` Ø70mm Domed Slotted Push Waste in Bowl Floor (`z = 0.191m` exact CAD waste position)
  const wasteBezel = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.035, 0.031, 0.004, 28)),
    wasteMats.primary
  );
  wasteBezel.name = `${basinGroup.name}.wasteBezel6800`;
  wasteBezel.position.set(0, bowlFloorY + 0.002, wasteZ);
  basinGroup.add(wasteBezel);

  const wasteGap = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.027, 0.027, 0.0045, 24)),
    wasteMats.darkShadow
  );
  wasteGap.name = `${basinGroup.name}.wasteShadowGap`;
  wasteGap.position.set(0, bowlFloorY + 0.0024, wasteZ);
  basinGroup.add(wasteGap);

  const wasteCapPts = [
    new THREE.Vector2(0, 0.0065),
    new THREE.Vector2(0.016, 0.0060),
    new THREE.Vector2(0.025, 0.0038),
    new THREE.Vector2(0.025, 0.0005),
    new THREE.Vector2(0, 0.0005),
  ];
  const wasteCap = new THREE.Mesh(
    prepGeo(new THREE.LatheGeometry(wasteCapPts, 28)),
    wasteMats.primary
  );
  wasteCap.name = `${basinGroup.name}.wasteDomedCap6800`;
  wasteCap.position.set(0, bowlFloorY + 0.003, wasteZ);
  basinGroup.add(wasteCap);

  // `LB 3226BN` (`BN` Silver Nickel) Ball-Jointed Tubular Console Stand
  const standGroup = new THREE.Group();
  standGroup.name = `${p}.consoleStand3226BN`;
  root.add(standGroup);

  const legHalfCrsX = 0.2475; // 495mm leg centres (±247.5mm exact)
  const legZ = 0.330;         // 330mm from rear wall exact
  const legR = 0.0127;        // Ø25.4mm (1") vertical leg tube
  const railY = 0.620;        // 620mm ball-joint & towel-rail centreline exact
  const ballR = 0.021;        // Ø42mm spherical ball-joint collar

  const acornFootPts = [
    new THREE.Vector2(0.007, 0),
    new THREE.Vector2(0.017, 0.004),
    new THREE.Vector2(0.019, 0.012),
    new THREE.Vector2(0.014, 0.024),
    new THREE.Vector2(0.017, 0.048),
    new THREE.Vector2(0.015, 0.072),
    new THREE.Vector2(legR, 0.085),
  ];
  const acornFootGeo = prepGeo(new THREE.LatheGeometry(acornFootPts, 24));
  const ballJointGeo = prepGeo(new THREE.SphereGeometry(ballR, 20, 16));
  const collarRingGeo = prepGeo(new THREE.TorusGeometry(legR * 1.18, 0.0032, 10, 24).rotateX(Math.PI / 2));
  const topFlangeGeo = prepGeo(new THREE.CylinderGeometry(0.0225, 0.018, 0.014, 24)); // Ø45mm support flange
  const wallStayFlangeGeo = createSteppedWallEscutcheon(0.0375, 0.011, 0.014).rotateX(Math.PI / 2); // Ø75mm wall flange

  for (const [sideName, sx] of [
    ['leftLeg', -legHalfCrsX],
    ['rightLeg', legHalfCrsX],
  ] as const) {
    // Turned tapered acorn floor foot (`y = 0..0.085m`)
    const foot = new THREE.Mesh(acornFootGeo, standMats.primary);
    foot.name = `${standGroup.name}.${sideName}AcornFoot`;
    foot.position.set(sx, 0, legZ);
    standGroup.add(foot);

    // Main Ø25.4mm vertical tubular leg (`y = 0.085..legSeatY`)
    const legH = legSeatY - 0.085;
    const legTube = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(legR, legR, legH, 22)),
      standMats.primary
    );
    legTube.name = `${standGroup.name}.${sideName}Shaft`;
    legTube.position.set(sx, 0.085 + legH * 0.5, legZ);
    standGroup.add(legTube);

    // Top Ø45mm stepped basin-support flange at `y = 0.770m`
    const topFlange = new THREE.Mesh(topFlangeGeo, standMats.primary);
    topFlange.name = `${standGroup.name}.${sideName}TopFlange45`;
    topFlange.position.set(sx, legSeatY - 0.006, legZ);
    standGroup.add(topFlange);

    // Spherical ball-joint node + turned collars at `y = 0.620m`
    const ball = new THREE.Mesh(ballJointGeo, standMats.primary);
    ball.name = `${standGroup.name}.${sideName}BallJoint`;
    ball.position.set(sx, railY, legZ);
    standGroup.add(ball);

    for (const dy of [-0.023, 0.023]) {
      const ring = new THREE.Mesh(collarRingGeo, standMats.primary);
      ring.name = `${standGroup.name}.${sideName}Collar`;
      ring.position.set(sx, railY + dy, legZ);
      standGroup.add(ring);
    }

    // Horizontal rear wall-stay tube (`z = 0.010..legZ` at `y = 0.620m`) + Ø75mm wall flange at `z = 0`
    const stayLen = legZ - 0.010;
    const stayTube = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.011, 0.011, stayLen, 18).rotateX(Math.PI / 2)),
      standMats.primary
    );
    stayTube.name = `${standGroup.name}.${sideName}WallStay`;
    stayTube.position.set(sx, railY, 0.010 + stayLen * 0.5);
    standGroup.add(stayTube);

    const wallFlange = new THREE.Mesh(wallStayFlangeGeo, standMats.primary);
    wallFlange.name = `${standGroup.name}.${sideName}WallFlange75`;
    wallFlange.position.set(sx, railY, 0);
    standGroup.add(wallFlange);

    // Lateral tie spigots connecting leg ball-joint (`|x| = 0.2475m`) outward to towel rail (`|x| = 0.276m`)
    const lateralSpigot = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.0085, 0.0085, 0.032, 14).rotateZ(Math.PI / 2)),
      standMats.primary
    );
    lateralSpigot.name = `${standGroup.name}.${sideName}RailSpigot`;
    lateralSpigot.position.set(sx + Math.sign(sx) * 0.016, railY, legZ);
    standGroup.add(lateralSpigot);
  }

  // Continuous U-bowed tubular towel rail (`570mm` outer width -> `x = ±0.276m` centreline + `9mm` radius = `±0.285m`,
  // running along both sides from rear stays and bowing smoothly across the front to `z = 0.438m` at `x = 0`)
  const railHalfCenterX = 0.276; // + 9mm tube radius = exact ±0.285m (570mm outer width, inside 575mm basin)
  const towelRailCurve = new THREE.CurvePath<THREE.Vector3>();
  towelRailCurve.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-legHalfCrsX, railY, 0.072),
      new THREE.Vector3(-railHalfCenterX, railY, 0.074),
      new THREE.Vector3(-railHalfCenterX, railY, 0.110)
    )
  );
  towelRailCurve.add(
    new THREE.LineCurve3(
      new THREE.Vector3(-railHalfCenterX, railY, 0.110),
      new THREE.Vector3(-railHalfCenterX, railY, 0.355)
    )
  );
  towelRailCurve.add(
    new THREE.CubicBezierCurve3(
      new THREE.Vector3(-railHalfCenterX, railY, 0.355),
      new THREE.Vector3(-railHalfCenterX, railY, 0.415),
      new THREE.Vector3(-0.145, railY, 0.429),
      new THREE.Vector3(0, railY, 0.429)
    )
  );
  towelRailCurve.add(
    new THREE.CubicBezierCurve3(
      new THREE.Vector3(0, railY, 0.429),
      new THREE.Vector3(0.145, railY, 0.429),
      new THREE.Vector3(railHalfCenterX, railY, 0.415),
      new THREE.Vector3(railHalfCenterX, railY, 0.355)
    )
  );
  towelRailCurve.add(
    new THREE.LineCurve3(
      new THREE.Vector3(railHalfCenterX, railY, 0.355),
      new THREE.Vector3(railHalfCenterX, railY, 0.110)
    )
  );
  towelRailCurve.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(railHalfCenterX, railY, 0.110),
      new THREE.Vector3(railHalfCenterX, railY, 0.074),
      new THREE.Vector3(legHalfCrsX, railY, 0.072)
    )
  );
  const towelRailMesh = new THREE.Mesh(
    prepGeo(new THREE.TubeGeometry(towelRailCurve, 56, 0.009, 16, false)),
    standMats.primary
  );
  towelRailMesh.name = `${standGroup.name}.bowedTowelRail570`;
  standGroup.add(towelRailMesh);

  // `6303PF` Exposed Pewter Bottle Trap + Rigid Ø15mm Supply Pipes
  const plumbingGroup = new THREE.Group();
  plumbingGroup.name = `${p}.exposedPlumbing6303PF`;
  root.add(plumbingGroup);

  // Vertical waste tailpipe at `z = 0.191m` descending into `6303PF` Ø50 × 134mm bottle cylinder
  const tailpipe = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.016, 0.016, 0.068, 20)),
    brassMats.primary
  );
  tailpipe.name = `${plumbingGroup.name}.wasteTailpipe`;
  tailpipe.position.set(0, wasteBossBottomY - 0.022, wasteZ);
  plumbingGroup.add(tailpipe);

  const trapNut = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.022, 0.022, 0.014, 8)),
    brassMats.primary
  );
  trapNut.name = `${plumbingGroup.name}.trapSlipNut`;
  trapNut.position.set(0, 0.614, wasteZ);
  plumbingGroup.add(trapNut);

  // `6303PF` Ø50 × 134mm cylindrical bottle trap body (`y = 0.478..0.612m`, `z = 0.191m`)
  const trapBody = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.025, 0.025, 0.134, 28)),
    brassMats.primary
  );
  trapBody.name = `${plumbingGroup.name}.bottleTrap6303`;
  trapBody.position.set(0, 0.545, wasteZ);
  plumbingGroup.add(trapBody);

  const trapBaseCap = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0265, 0.024, 0.012, 28)),
    brassMats.primary
  );
  trapBaseCap.name = `${plumbingGroup.name}.bottleTrapBaseCap`;
  trapBaseCap.position.set(0, 0.481, wasteZ);
  plumbingGroup.add(trapBaseCap);

  // Horizontal Ø35mm waste outlet pipe (`z = 0.010..0.191m` at `y = 0.562m`) + Ø70 × 12mm wall flange
  const outletLen = wasteZ - 0.010;
  const outletPipe = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0175, 0.0175, outletLen, 20).rotateX(Math.PI / 2)),
    brassMats.primary
  );
  outletPipe.name = `${plumbingGroup.name}.wallWastePipe35`;
  outletPipe.position.set(0, 0.562, 0.010 + outletLen * 0.5);
  plumbingGroup.add(outletPipe);

  const wasteFlange = new THREE.Mesh(
    createSteppedWallEscutcheon(0.035, 0.018, 0.012).rotateX(Math.PI / 2),
    brassMats.primary
  );
  wasteFlange.name = `${plumbingGroup.name}.wasteWallFlange70`;
  wasteFlange.position.set(0, 0.562, 0);
  plumbingGroup.add(wasteFlange);

  const isWallTap =
    opts.tap === 'none' ||
    (opts.tap !== undefined &&
      opts.tap !== 'default' &&
      !isCustomTapObject3D(opts.tap) &&
      opts.tap.mount === '2-hole-wall');
  const holeCount: 0 | 1 | 3 = isWallTap
    ? 0
    : opts.tap !== undefined &&
        opts.tap !== 'default' &&
        !isCustomTapObject3D(opts.tap) &&
        opts.tap.mount === 'monobloc-deck'
      ? 1
      : 3;

  registerTapMountAnchor(root, {
    deckPosition: [0, rimHeightM + 0.0005, deckTapZ],
    wallPosition: [0, upstandTopHeightM + 0.125, 0],
    wastePosition: [0, bowlFloorY, wasteZ],
    holeCount,
    rotationY: 0,
  });

  // Rigid Ø15mm Pewter hot/cold supply risers (`x = ±0.100m`, `z = 0.070m`) from wall isolation valves
  if (!isWallTap) {
    const supplySpreadHalf =
      opts.tap !== undefined &&
      opts.tap !== 'default' &&
      !isCustomTapObject3D(opts.tap) &&
      opts.tap.holeSpreadM !== undefined
        ? opts.tap.holeSpreadM * 0.5
        : 0.100;
    const supplyWallY = 0.530;
    const supplyRiserTopY = legSeatY + 0.008;
    const supplyRoseGeo = createSteppedWallEscutcheon(0.024, 0.008, 0.010).rotateX(Math.PI / 2);
    for (const [sName, sx] of [
      ['hotSupplyLeft', -supplySpreadHalf],
      ['coldSupplyRight', supplySpreadHalf],
    ] as const) {
      const sRose = new THREE.Mesh(supplyRoseGeo, brassMats.primary);
      sRose.name = `${plumbingGroup.name}.${sName}Rose`;
      sRose.position.set(sx, supplyWallY, 0);
      plumbingGroup.add(sRose);

      const sPath = new THREE.CurvePath<THREE.Vector3>();
      sPath.add(
        new THREE.LineCurve3(
          new THREE.Vector3(sx, supplyWallY, 0.008),
          new THREE.Vector3(sx, supplyWallY, deckTapZ - 0.022)
        )
      );
      sPath.add(
        new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(sx, supplyWallY, deckTapZ - 0.022),
          new THREE.Vector3(sx, supplyWallY, deckTapZ),
          new THREE.Vector3(sx, supplyWallY + 0.024, deckTapZ)
        )
      );
      sPath.add(
        new THREE.LineCurve3(
          new THREE.Vector3(sx, supplyWallY + 0.024, deckTapZ),
          new THREE.Vector3(sx, supplyRiserTopY, deckTapZ)
        )
      );
      const sTube = new THREE.Mesh(
        prepGeo(new THREE.TubeGeometry(sPath, 18, 0.0075, 12, false)),
        brassMats.primary
      );
      sTube.name = `${plumbingGroup.name}.${sName}Pipe`;
      plumbingGroup.add(sTube);
    }
  }

  // Perrin & Rowe `Deco` `3142PF` 3TH Basin Mixer (`200mm` CRS at `z = 70mm`) or Composable Tap
  if (opts.tap === undefined || opts.tap === 'default') {
    const mixer = buildDeco3HoleBasinMixer3142({
      namePrefix: `${p}.deco3HoleMixer3142`,
      finish: brasswareFinish,
      valveSpreadM: 0.200,
      spoutReachM: 0.135,
    });
    mixer.position.set(0, rimHeightM - 0.001, deckTapZ);
    root.add(mixer);
  } else if (opts.tap !== 'none') {
    if (isCustomTapObject3D(opts.tap)) {
      mountTapOnFixture(root, opts.tap);
    } else {
      const resolvedMount = opts.tap.mount ?? '3-hole-deck';
      const tapObj = buildBasinTapFromSpec(
        opts.tap,
        brasswareFinish,
        resolvedMount,
        `${p}.basinTap`
      );
      mountTapOnFixture(root, tapObj, resolvedMount === '2-hole-wall' ? 'wall' : 'deck');
    }
  }

  const fCode = resolveBrasswareCode(brasswareFinish, 'NI');
  return attachAssetMetadata(finalizeSanitaryGroup(root, 'sanitary'), {
    name: 'Lefroy Brooks La Chapelle Double Console Washstand',
    brand: 'Lefroy Brooks',
    collection: 'La Chapelle',
    sku: `LCB240-${fCode}`,
    finish: `Vitreous China & Honed Carrara / ${formatBrasswareFinishLabel(brasswareFinish, 'NI')}`,
    category: 'sanitaryware',
    dimensionsMm: [1380, 565, 895],
    productUrl: 'https://uk.lefroybrooks.com/products/washstands/la-chapelle-double-washstand',
    schematicUrl: 'https://uk.lefroybrooks.com/downloads/technical/LCB240-dimensioned.pdf',
  });
}
