import * as THREE from 'three';
import { attachAssetInteraction, attachAssetMetadata } from '../shared/catalog-smart-metadata.ts';
import { prepGeo } from '../shared/scene-helpers.ts';
import { getSageMaterialSuite } from './sage-barista-express-materials.ts';

export interface SageBaristaExpressOptions {
  /** Scene-graph node name prefix. Default 'sageBaristaExpress'. */
  readonly namePrefix?: string;
  /** Optional owning room zone identifier for LOD tiering. */
  readonly zoneId?: string;
  /** Enable shadow casting on major housing and accessory meshes. Default true. */
  readonly castShadow?: boolean;
  /** Include two ceramic espresso cups on the top cup-warming tray. Default true. */
  readonly withTopCups?: boolean;
  /** Include the brushed stainless milk frothing jug on the drip tray. Default true. */
  readonly withMilkPitcher?: boolean;
}

/**
 * Smooth 2D rounded-corner bow-front rectangle contour in plan (X, -Z).
 */
function createRoundedBowRectShape(
  halfW: number,
  zBack: number,
  zFrontSide: number,
  frontBow: number,
  rBack: number,
  rFront: number
): THREE.Shape {
  const s = new THREE.Shape();
  const yTop = -zBack;
  const yBotSide = -zFrontSide;
  const yBotMid = -(zFrontSide + frontBow);

  s.moveTo(-halfW + rBack, yTop);
  s.lineTo(halfW - rBack, yTop);
  s.absarc(halfW - rBack, yTop - rBack, rBack, Math.PI * 0.5, 0, true);
  s.lineTo(halfW, yBotSide + rFront);
  s.absarc(halfW - rFront, yBotSide + rFront, rFront, 0, -Math.PI * 0.5, true);

  if (Math.abs(frontBow) > 1e-4) {
    s.bezierCurveTo(
      halfW * 0.42,
      yBotMid,
      -halfW * 0.42,
      yBotMid,
      -halfW + rFront,
      yBotSide
    );
  } else {
    s.lineTo(-halfW + rFront, yBotSide);
  }

  s.absarc(
    -halfW + rFront,
    yBotSide + rFront,
    rFront,
    -Math.PI * 0.5,
    -Math.PI,
    true
  );
  s.lineTo(-halfW, yTop - rBack);
  s.absarc(-halfW + rBack, yTop - rBack, rBack, Math.PI, Math.PI * 0.5, true);
  s.closePath();
  return s;
}

/**
 * Sample a perimeter contour in (X, Z) plan with rounded front/back corners and gentle bow.
 */
function samplePlanContour(
  halfW: number,
  zBack: number,
  zFrontSide: number,
  frontBow: number,
  rBack: number,
  rFront: number,
  segmentsPerCorner = 10,
  frontCurveSegs = 16
): Array<{ x: number; z: number }> {
  const pts: Array<{ x: number; z: number }> = [];

  for (let i = 0; i <= segmentsPerCorner; i++) {
    const a = -Math.PI * 0.5 + (i / segmentsPerCorner) * (Math.PI * 0.5);
    pts.push({
      x: halfW - rBack + Math.cos(a) * rBack,
      z: zBack + rBack + Math.sin(a) * rBack,
    });
  }

  for (let i = 0; i <= segmentsPerCorner; i++) {
    const a = (i / segmentsPerCorner) * (Math.PI * 0.5);
    pts.push({
      x: halfW - rFront + Math.cos(a) * rFront,
      z: zFrontSide - rFront + Math.sin(a) * rFront,
    });
  }

  const xStart = halfW - rFront;
  const xEnd = -halfW + rFront;
  for (let i = 1; i < frontCurveSegs; i++) {
    const t = i / frontCurveSegs;
    const x = xStart + (xEnd - xStart) * t;
    const bowFactor = Math.sin(t * Math.PI);
    pts.push({
      x,
      z: zFrontSide + frontBow * bowFactor,
    });
  }

  for (let i = 0; i <= segmentsPerCorner; i++) {
    const a = Math.PI * 0.5 + (i / segmentsPerCorner) * (Math.PI * 0.5);
    pts.push({
      x: -halfW + rFront + Math.cos(a) * rFront,
      z: zFrontSide - rFront + Math.sin(a) * rFront,
    });
  }

  for (let i = 0; i <= segmentsPerCorner; i++) {
    const a = Math.PI + (i / segmentsPerCorner) * (Math.PI * 0.5);
    pts.push({
      x: -halfW + rBack + Math.cos(a) * rBack,
      z: zBack + rBack + Math.sin(a) * rBack,
    });
  }

  return pts;
}

interface LoftSlice {
  y: number;
  pts: Array<{ x: number; z: number }>;
}

/**
 * Build a seamless watertight lofted sheet-metal geometry across horizontal slices,
 * with continuous horizontal-wrap UVs so brushed stainless grain flows uninterrupted
 * around every curved corner without vertical box+cylinder seams.
 */
function buildLoftedSheetMetalGeometry(
  slices: LoftSlice[],
  capBottom = true,
  capTop = true
): THREE.BufferGeometry {
  const ringLen = slices[0].pts.length;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const arcU: number[] = [0];
  let totalPerim = 0;
  const refPts = slices[Math.floor(slices.length * 0.5)].pts;
  for (let i = 1; i <= ringLen; i++) {
    const p0 = refPts[i - 1];
    const p1 = refPts[i % ringLen];
    totalPerim += Math.hypot(p1.x - p0.x, p1.z - p0.z);
    arcU.push(totalPerim);
  }
  const uScale = 2.2 / Math.max(0.2, totalPerim);
  const vScale = 3.2;

  for (let s = 0; s < slices.length; s++) {
    const { y, pts } = slices[s];
    for (let i = 0; i <= ringLen; i++) {
      const p = pts[i % ringLen];
      positions.push(p.x, y, p.z);
      uvs.push(arcU[i] * uScale, y * vScale);
    }
  }

  const stride = ringLen + 1;
  for (let s = 0; s < slices.length - 1; s++) {
    const row0 = s * stride;
    const row1 = (s + 1) * stride;
    for (let i = 0; i < ringLen; i++) {
      const a = row0 + i;
      const b = row0 + i + 1;
      const c = row1 + i;
      const d = row1 + i + 1;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  if (capBottom) {
    const botSlice = slices[0];
    let cx = 0;
    let cz = 0;
    for (const p of botSlice.pts) {
      cx += p.x;
      cz += p.z;
    }
    cx /= ringLen;
    cz /= ringLen;
    const centerIdx = positions.length / 3;
    positions.push(cx, botSlice.y, cz);
    uvs.push(0.5, 0.5);
    const ringStart = positions.length / 3;
    for (let i = 0; i < ringLen; i++) {
      const p = botSlice.pts[i];
      positions.push(p.x, botSlice.y, p.z);
      uvs.push(p.x * 2.5 + 0.5, p.z * 2.5 + 0.5);
    }
    for (let i = 0; i < ringLen; i++) {
      const n = (i + 1) % ringLen;
      indices.push(centerIdx, ringStart + i, ringStart + n);
    }
  }

  if (capTop) {
    const topSlice = slices[slices.length - 1];
    let cx = 0;
    let cz = 0;
    for (const p of topSlice.pts) {
      cx += p.x;
      cz += p.z;
    }
    cx /= ringLen;
    cz /= ringLen;
    const centerIdx = positions.length / 3;
    positions.push(cx, topSlice.y, cz);
    uvs.push(0.5, 0.5);
    const ringStart = positions.length / 3;
    for (let i = 0; i < ringLen; i++) {
      const p = topSlice.pts[i];
      positions.push(p.x, topSlice.y, p.z);
      uvs.push(p.x * 2.5 + 0.5, p.z * 2.5 + 0.5);
    }
    for (let i = 0; i < ringLen; i++) {
      const n = (i + 1) % ringLen;
      indices.push(centerIdx, ringStart + n, ringStart + i);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return prepGeo(geo);
}

/**
 * Reassign horizontal brushed-stainless UVs on extruded/bevelled solids positioned in X/Y/Z.
 */
function applyHorizontalBrushedUVs(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  geo.computeVertexNormals();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const norm = geo.attributes.normal as THREE.BufferAttribute;
  const uvArr = new Float32Array(pos.count * 2);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ny = Math.abs(norm.getY(i));
    if (ny > 0.72) {
      uvArr[i * 2] = x * 3.0 + 0.5;
      uvArr[i * 2 + 1] = z * 3.0 + 0.5;
    } else {
      const u = (x + z * 0.65) * 2.6 + 0.5;
      const v = y * 3.2;
      uvArr[i * 2] = u;
      uvArr[i * 2 + 1] = v;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
  return prepGeo(geo);
}

/**
 * Rounded-squircle ring for the squat bean hopper & lid.
 */
function sampleSquircleRing(
  rx: number,
  rz: number,
  cornerRatio: number,
  segments = 48
): Array<{ x: number; z: number }> {
  const pts: Array<{ x: number; z: number }> = [];
  const exp = 2.0 / Math.max(0.35, Math.min(1.0, cornerRatio));
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const x = Math.sign(ca) * Math.pow(Math.abs(ca), 2 / exp) * rx;
    const z = Math.sign(sa) * Math.pow(Math.abs(sa), 2 / exp) * rz;
    pts.push({ x, z });
  }
  return pts;
}

/**
 * Build a 1:1 procedural 3D model of the **Sage Barista Express (BES875BSS)**
 * in Brushed Stainless Steel, sculpted from official studio orthographics and real dimensions:
 * - Width:  ~318 mm (X in [-0.159, +0.159])
 * - Depth:  ~351 mm (Z in [-0.160, +0.191] including locked 54 mm portafilter)
 * - Height: ~404 mm (Y in [0.000, +0.404] including squat integrated bean hopper)
 *
 * Local origin `(0, 0, 0)` sits at the bottom-center of the rubber feet (`y = 0`),
 * facing `+Z`. Contains zero scene lights (`PointLight` / `SpotLight`).
 */
export function buildSageBaristaExpress(
  options: SageBaristaExpressOptions = {}
): THREE.Group {
  const {
    namePrefix = 'sageBaristaExpress',
    zoneId,
    castShadow = true,
    withTopCups = true,
    withMilkPitcher = true,
  } = options;

  const root = new THREE.Group();
  root.name = namePrefix;
  root.userData = zoneId !== undefined ? { ...root.userData, lodTier: 1, zoneId } : { ...root.userData, lodTier: 1 };

  const applyShadow = (mesh: THREE.Mesh, receive = true): THREE.Mesh => {
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receive;
    return mesh;
  };

  // Physical Material Suite

  const {
    matBrushedSS,
    matFasciaBrushedSS,
    matSpunButtonCap,
    matPolishedChrome,
    matCastAlloy,
    matMatteBlack,
    matGlossBlackHandle,
    matSmokedHopper,
    matRearTankClear,
    matWaterTint,
    matLedRingIdle,
    matLedPowerOn,
    matLedWarmDot,
    matEspressoBean,
    matDripSump,
    matFloatIndicator,
    matDripGrille,
    matStoneware,
    matFasciaLegend,
    matGaugeShadowSleeve,
    matGaugeDialDisc,
    matGaugeNeedle,
    matGaugeGlass,
    matPitcherBadge,
    matTempStrip,
  } = getSageMaterialSuite();

  // NON-SLIP FEET, LOWER CHASSIS PLINTH & CURVED DRIP TRAY (y = 0..0.060 m)
  const baseGroup = new THREE.Group();
  baseGroup.name = `${namePrefix}.baseAndDripTray`;
  root.add(baseGroup);

  const footGeo = prepGeo(new THREE.CylinderGeometry(0.017, 0.015, 0.006, 20));
  const footCoords: Array<[number, number]> = [
    [-0.124, -0.126],
    [0.124, -0.126],
    [-0.124, 0.088],
    [0.124, 0.088],
  ];
  for (const [fx, fz] of footCoords) {
    const foot = new THREE.Mesh(footGeo, matMatteBlack);
    foot.position.set(fx, 0.003, fz);
    applyShadow(foot);
    baseGroup.add(foot);
  }

  // Lower main chassis plinth supporting brew column & rear water tank
  const rearPlinthSlices: LoftSlice[] = [
    {
      y: 0.005,
      pts: samplePlanContour(0.146, -0.156, 0.02, 0.0, 0.022, 0.014),
    },
    {
      y: 0.011,
      pts: samplePlanContour(0.150, -0.159, 0.022, 0.0, 0.024, 0.016),
    },
    {
      y: 0.112,
      pts: samplePlanContour(0.150, -0.159, 0.022, 0.0, 0.024, 0.016),
    },
    {
      y: 0.116,
      pts: samplePlanContour(0.147, -0.156, 0.02, 0.0, 0.022, 0.014),
    },
  ];
  const rearPlinthMesh = new THREE.Mesh(
    buildLoftedSheetMetalGeometry(rearPlinthSlices, true, true),
    matBrushedSS
  );
  applyShadow(rearPlinthMesh);
  baseGroup.add(rearPlinthMesh);

  // Slide-out curved-front stainless drip tray (y = 0.005..0.058 m, z = -0.005..+0.128 m)
  const dripTraySlices: LoftSlice[] = [
    {
      y: 0.005,
      pts: samplePlanContour(0.146, -0.006, 0.114, 0.008, 0.012, 0.026),
    },
    {
      y: 0.010,
      pts: samplePlanContour(0.151, -0.006, 0.119, 0.009, 0.012, 0.028),
    },
    {
      y: 0.052,
      pts: samplePlanContour(0.151, -0.006, 0.119, 0.009, 0.012, 0.028),
    },
    {
      y: 0.0575,
      pts: samplePlanContour(0.148, -0.006, 0.116, 0.008, 0.012, 0.026),
    },
  ];
  const dripTrayBody = new THREE.Mesh(
    buildLoftedSheetMetalGeometry(dripTraySlices, true, true),
    matBrushedSS
  );
  applyShadow(dripTrayBody);
  baseGroup.add(dripTrayBody);

  // Recessed dark finger-pull arch at bottom-center of drip tray skirt
  const fingerPullShape = new THREE.Shape();
  fingerPullShape.moveTo(-0.048, 0.005);
  fingerPullShape.quadraticCurveTo(0, 0.015, 0.048, 0.005);
  fingerPullShape.lineTo(-0.048, 0.005);
  const fingerPullGeo = prepGeo(
    new THREE.ExtrudeGeometry(fingerPullShape, {
      depth: 0.016,
      bevelEnabled: false,
      curveSegments: 16,
    })
  );
  const fingerPullMesh = new THREE.Mesh(fingerPullGeo, matMatteBlack);
  fingerPullMesh.position.set(0, 0.0005, 0.114);
  baseGroup.add(fingerPullMesh);

  // Dark sump pan under the die-cast slotted grille
  const sumpShape = createRoundedBowRectShape(
    0.136,
    0.004,
    0.106,
    0.007,
    0.01,
    0.02
  );
  const sumpGeo = prepGeo(
    new THREE.ExtrudeGeometry(sumpShape, { depth: 0.003, bevelEnabled: false })
  );
  sumpGeo.rotateX(-Math.PI * 0.5);
  const sumpMesh = new THREE.Mesh(
    sumpGeo,
    matDripSump
  );
  sumpMesh.position.y = 0.055;
  baseGroup.add(sumpMesh);

  // Red "Empty Me!" float indicator visible inside left-rear grille window
  const floatIndicator = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(0.026, 0.004, 0.009)),
    matFloatIndicator
  );
  floatIndicator.position.set(-0.098, 0.0568, 0.021);
  baseGroup.add(floatIndicator);

  // Recessed die-cast stainless slotted drip-tray grille plate
  const grilleW = 0.270;
  const grilleD = 0.102;
  const grilleGeo = prepGeo(new THREE.PlaneGeometry(grilleW, grilleD));
  grilleGeo.rotateX(-Math.PI * 0.5);
  const grilleMesh = new THREE.Mesh(grilleGeo, matDripGrille);
  grilleMesh.position.set(0, 0.0585, 0.056);
  grilleMesh.receiveShadow = true;
  baseGroup.add(grilleMesh);

  // Raised cast-alloy perimeter rim framing the drip-tray grille
  const rimOuter = createRoundedBowRectShape(
    0.141,
    0.002,
    0.109,
    0.007,
    0.012,
    0.022
  );
  const rimInner = createRoundedBowRectShape(
    0.132,
    0.009,
    0.101,
    0.006,
    0.009,
    0.017
  );
  rimOuter.holes.push(rimInner);
  const rimGeo = prepGeo(
    new THREE.ExtrudeGeometry(rimOuter, {
      depth: 0.0024,
      bevelEnabled: true,
      bevelThickness: 0.0008,
      bevelSize: 0.0008,
      bevelSegments: 2,
      curveSegments: 20,
    })
  );
  rimGeo.rotateX(-Math.PI * 0.5);
  const rimMesh = new THREE.Mesh(rimGeo, matCastAlloy);
  rimMesh.position.y = 0.0575;
  applyShadow(rimMesh);
  baseGroup.add(rimMesh);

  // SEAMLESS MONOCOQUE TOWER, BREW BAY & REAR TANK (y = 0.056..0.336 m)
  const housingGroup = new THREE.Group();
  housingGroup.name = `${namePrefix}.housing`;
  root.add(housingGroup);

  // Mid tower / brew-bay splashback + continuous wrapped side cheeks (y = 0.055..0.242 m)
  const midColumnSlices: LoftSlice[] = [
    {
      y: 0.055,
      pts: samplePlanContour(0.147, -0.106, 0.008, -0.003, 0.020, 0.022),
    },
    {
      y: 0.072,
      pts: samplePlanContour(0.146, -0.106, -0.006, -0.004, 0.020, 0.020),
    },
    {
      y: 0.214,
      pts: samplePlanContour(0.146, -0.106, -0.006, -0.004, 0.020, 0.020),
    },
    {
      y: 0.232,
      pts: samplePlanContour(0.148, -0.106, 0.044, 0.002, 0.022, 0.026),
    },
    {
      y: 0.242,
      pts: samplePlanContour(0.149, -0.106, 0.084, 0.0, 0.022, 0.028),
    },
  ];
  const midColumnMesh = new THREE.Mesh(
    buildLoftedSheetMetalGeometry(midColumnSlices, false, false),
    matBrushedSS
  );
  applyShadow(midColumnMesh);
  housingGroup.add(midColumnMesh);

  // Smooth C-frame rounded side bolster cheeks with curved bottom fillet meeting drip tray
  const cheekShape = new THREE.Shape();
  cheekShape.moveTo(-0.008, 0.056);
  cheekShape.quadraticCurveTo(0.036, 0.057, 0.038, 0.064);
  cheekShape.quadraticCurveTo(0.020, 0.070, 0.018, 0.092);
  cheekShape.lineTo(0.015, 0.212);
  cheekShape.quadraticCurveTo(0.018, 0.228, 0.068, 0.236);
  cheekShape.lineTo(-0.026, 0.236);
  cheekShape.lineTo(-0.026, 0.056);
  cheekShape.closePath();

  const cheekExtrude = new THREE.ExtrudeGeometry(cheekShape, {
    depth: 0.014,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.004,
    bevelSegments: 4,
    curveSegments: 20,
  });
  cheekExtrude.rotateY(Math.PI * 0.5);
  applyHorizontalBrushedUVs(cheekExtrude);

  for (const sideSign of [-1, 1]) {
    const cheek = new THREE.Mesh(cheekExtrude, matBrushedSS);
    cheek.position.set(
      sideSign * 0.138 - (sideSign > 0 ? 0.007 : 0.007),
      0,
      0
    );
    applyShadow(cheek);
    housingGroup.add(cheek);
  }

  // Upper cantilevered control head (y = 0.236..0.335 m) with ~12.5 deg upward-tilted front.
  // Crucially, the front center bows slightly INWARD (-0.006 m) so the recessed fascia panel
  // and deep circular Pressure Gauge tunnel sit completely clear of the internal head shell!
  const tiltRad = (12.5 * Math.PI) / 180;
  const zHeadBotSide = 0.095;
  const zHeadTopSide = zHeadBotSide - (0.333 - 0.236) * Math.tan(tiltRad);

  const upperHeadSlices: LoftSlice[] = [
    {
      y: 0.234,
      pts: samplePlanContour(0.146, -0.104, 0.085, -0.004, 0.020, 0.026),
    },
    {
      y: 0.243,
      pts: samplePlanContour(
        0.150,
        -0.106,
        zHeadBotSide,
        -0.006,
        0.022,
        0.028
      ),
    },
    {
      y: 0.286,
      pts: samplePlanContour(
        0.150,
        -0.106,
        (zHeadBotSide + zHeadTopSide) * 0.5,
        -0.006,
        0.022,
        0.028
      ),
    },
    {
      y: 0.328,
      pts: samplePlanContour(
        0.150,
        -0.106,
        zHeadTopSide,
        -0.005,
        0.022,
        0.027
      ),
    },
    {
      y: 0.3345,
      pts: samplePlanContour(
        0.145,
        -0.103,
        zHeadTopSide - 0.005,
        -0.004,
        0.019,
        0.024
      ),
    },
  ];
  const upperHeadMesh = new THREE.Mesh(
    buildLoftedSheetMetalGeometry(upperHeadSlices, true, true),
    matBrushedSS
  );
  applyShadow(upperHeadMesh);
  housingGroup.add(upperHeadMesh);

  // Rear removable 2.0 L smoked-translucent water tank (z = -0.158..-0.105 m, y = 0.115..0.334 m)
  const tankGroup = new THREE.Group();
  tankGroup.name = `${namePrefix}.rearWaterTank`;
  housingGroup.add(tankGroup);

  const tankShape = createRoundedBowRectShape(
    0.144,
    -0.157,
    -0.106,
    0.0,
    0.020,
    0.008
  );
  const tankGeo = prepGeo(
    new THREE.ExtrudeGeometry(tankShape, {
      depth: 0.214,
      bevelEnabled: true,
      bevelThickness: 0.002,
      bevelSize: 0.002,
      bevelSegments: 2,
      curveSegments: 18,
    })
  );
  tankGeo.rotateX(-Math.PI * 0.5);
  const tankMesh = new THREE.Mesh(tankGeo, matRearTankClear);
  tankMesh.position.y = 0.116;
  tankGroup.add(tankMesh);

  const waterShape = createRoundedBowRectShape(
    0.138,
    -0.152,
    -0.110,
    0.0,
    0.016,
    0.006
  );
  const waterGeo = prepGeo(
    new THREE.ExtrudeGeometry(waterShape, { depth: 0.155, bevelEnabled: false })
  );
  waterGeo.rotateX(-Math.PI * 0.5);
  const waterMesh = new THREE.Mesh(waterGeo, matWaterTint);
  waterMesh.position.y = 0.120;
  tankGroup.add(waterMesh);

  const tankLidGeo = prepGeo(
    new THREE.ExtrudeGeometry(tankShape, {
      depth: 0.005,
      bevelEnabled: true,
      bevelThickness: 0.001,
      bevelSize: 0.001,
      bevelSegments: 2,
    })
  );
  tankLidGeo.rotateX(-Math.PI * 0.5);
  const tankLid = new THREE.Mesh(tankLidGeo, matMatteBlack);
  tankLid.position.y = 0.330;
  applyShadow(tankLid);
  tankGroup.add(tankLid);

  // TOP CUP-WARMING DECK & CERAMIC DEMITASSE CUPS (y = 0.334..0.382 m)
  const topDeckGroup = new THREE.Group();
  topDeckGroup.name = `${namePrefix}.topCupWarmingDeck`;
  root.add(topDeckGroup);

  const deckRimOuter = createRoundedBowRectShape(
    0.143,
    -0.100,
    zHeadTopSide - 0.006,
    -0.003,
    0.018,
    0.022
  );
  const deckRimInner = createRoundedBowRectShape(
    0.130,
    -0.090,
    zHeadTopSide - 0.016,
    -0.003,
    0.013,
    0.016
  );
  deckRimOuter.holes.push(deckRimInner);
  const deckRimGeo = prepGeo(
    new THREE.ExtrudeGeometry(deckRimOuter, {
      depth: 0.0022,
      bevelEnabled: true,
      bevelThickness: 0.001,
      bevelSize: 0.001,
      bevelSegments: 2,
      curveSegments: 20,
    })
  );
  deckRimGeo.rotateX(-Math.PI * 0.5);
  const deckRimMesh = new THREE.Mesh(deckRimGeo, matPolishedChrome);
  deckRimMesh.position.y = 0.3342;
  applyShadow(deckRimMesh);
  topDeckGroup.add(deckRimMesh);

  const trayPlateGeo = prepGeo(
    new THREE.ExtrudeGeometry(deckRimInner, {
      depth: 0.0012,
      bevelEnabled: false,
      curveSegments: 18,
    })
  );
  trayPlateGeo.rotateX(-Math.PI * 0.5);
  const trayPlateMesh = new THREE.Mesh(trayPlateGeo, matBrushedSS);
  trayPlateMesh.position.y = 0.334;
  topDeckGroup.add(trayPlateMesh);

  const ribGeo = prepGeo(new THREE.BoxGeometry(0.112, 0.0016, 0.0022));
  for (let i = 0; i < 6; i++) {
    const rib = new THREE.Mesh(ribGeo, matPolishedChrome);
    rib.position.set(0.068, 0.3358, -0.072 + i * 0.024);
    topDeckGroup.add(rib);
  }

  if (withTopCups) {
    const cupProf = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.019, 0.0),
      new THREE.Vector2(0.022, 0.006),
      new THREE.Vector2(0.028, 0.044),
      new THREE.Vector2(0.0275, 0.046),
      new THREE.Vector2(0.025, 0.045),
      new THREE.Vector2(0.019, 0.006),
      new THREE.Vector2(0.0, 0.005),
    ];
    const cupLathe = prepGeo(new THREE.LatheGeometry(cupProf, 28));
    const handleTorus = prepGeo(
      new THREE.TorusGeometry(0.011, 0.0028, 10, 20, Math.PI * 1.15)
    );

    const cupSpecs: Array<{ x: number; z: number; rotY: number }> = [
      { x: 0.052, z: -0.008, rotY: 0.42 },
      { x: 0.104, z: -0.046, rotY: -0.58 },
    ];
    for (const cs of cupSpecs) {
      const cupGrp = new THREE.Group();
      cupGrp.position.set(cs.x, 0.3355, cs.z);
      cupGrp.rotation.y = cs.rotY;
      const cupBody = new THREE.Mesh(cupLathe, matStoneware);
      applyShadow(cupBody);
      cupGrp.add(cupBody);

      const cupHandle = new THREE.Mesh(handleTorus, matStoneware);
      cupHandle.position.set(0.026, 0.025, 0);
      cupHandle.rotation.z = -Math.PI * 0.5;
      applyShadow(cupHandle);
      cupGrp.add(cupHandle);
      topDeckGroup.add(cupGrp);
    }
  }

  // SQUAT BEAN HOPPER WITH VERTICAL THROAT COLLAR & FINE ESPRESSO BEANS
  const hopperGroup = new THREE.Group();
  hopperGroup.name = `${namePrefix}.beanHopper`;
  hopperGroup.position.set(-0.056, 0, 0.004);
  root.add(hopperGroup);

  const collarGeo = prepGeo(
    new THREE.CylinderGeometry(0.044, 0.046, 0.005, 36)
  );
  const collarMesh = new THREE.Mesh(collarGeo, matMatteBlack);
  collarMesh.position.y = 0.3365;
  hopperGroup.add(collarMesh);

  const burrHub = new THREE.Mesh(
    prepGeo(new THREE.ConeGeometry(0.020, 0.026, 24)),
    matCastAlloy
  );
  burrHub.position.y = 0.350;
  hopperGroup.add(burrHub);

  // Authentic BES875BSS hopper profile: distinct 15 mm cylindrical smoked throat (0.336..0.351)
  // flaring cleanly into a squat, rounded-squircle bowl (0.357..0.397)
  const hopperSlices: LoftSlice[] = [
    { y: 0.336, pts: sampleSquircleRing(0.042, 0.041, 0.98, 48) },
    { y: 0.351, pts: sampleSquircleRing(0.043, 0.042, 0.96, 48) },
    { y: 0.358, pts: sampleSquircleRing(0.065, 0.060, 0.62, 48) },
    { y: 0.378, pts: sampleSquircleRing(0.069, 0.064, 0.58, 48) },
    { y: 0.397, pts: sampleSquircleRing(0.071, 0.066, 0.56, 48) },
  ];
  const hopperBowlMesh = new THREE.Mesh(
    buildLoftedSheetMetalGeometry(hopperSlices, false, false),
    matSmokedHopper
  );
  applyShadow(hopperBowlMesh, false);
  hopperGroup.add(hopperBowlMesh);

  // Dark espresso bean core + organic roasted coffee beans strictly inside the smoked SAN wall
  const beanCoreSlices: LoftSlice[] = [
    { y: 0.344, pts: sampleSquircleRing(0.036, 0.035, 0.96, 32) },
    { y: 0.359, pts: sampleSquircleRing(0.056, 0.052, 0.62, 32) },
    { y: 0.384, pts: sampleSquircleRing(0.060, 0.055, 0.58, 32) },
    { y: 0.390, pts: sampleSquircleRing(0.046, 0.042, 0.66, 32) },
  ];
  const beanCoreMesh = new THREE.Mesh(
    buildLoftedSheetMetalGeometry(beanCoreSlices, true, true),
    matEspressoBean
  );
  hopperGroup.add(beanCoreMesh);

  const singleBeanGeo = prepGeo(new THREE.SphereGeometry(0.0035, 9, 7));
  singleBeanGeo.scale(1.38, 0.78, 0.95);

  let beanSeed = 90210;
  const nextBeanRand = (): number => {
    beanSeed = (beanSeed * 1664525 + 1013904223) >>> 0;
    return beanSeed / 0xffffffff;
  };

  for (let layer = 0; layer < 4; layer++) {
    const baseBy = 0.361 + layer * 0.0078;
    const rxLayer = 0.0555 + layer * 0.0016;
    const rzLayer = 0.0510 + layer * 0.0014;
    const count = 30;
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + (nextBeanRand() - 0.5) * 0.18;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const radialIn = 0.92 + nextBeanRand() * 0.08;
      const bx = Math.sign(ca) * Math.pow(Math.abs(ca), 0.58) * rxLayer * radialIn;
      const bz = Math.sign(sa) * Math.pow(Math.abs(sa), 0.58) * rzLayer * radialIn;
      const bean = new THREE.Mesh(singleBeanGeo, matEspressoBean);
      bean.position.set(bx, baseBy + (nextBeanRand() - 0.5) * 0.0045, bz);
      bean.rotation.set(
        nextBeanRand() * Math.PI,
        ang + nextBeanRand() * 0.8,
        nextBeanRand() * Math.PI
      );
      hopperGroup.add(bean);
    }
  }
  for (let i = 0; i < 30; i++) {
    const ang = i * 2.39996;
    const rad = Math.sqrt((i + 0.5) / 30) * 0.058;
    const bean = new THREE.Mesh(singleBeanGeo, matEspressoBean);
    bean.position.set(
      Math.cos(ang) * rad,
      0.389 + (1 - rad / 0.062) * 0.0035,
      Math.sin(ang) * rad * 0.92
    );
    bean.rotation.set(i * 0.7, ang, i * 0.4);
    hopperGroup.add(bean);
  }

  // Sleek matte-black elastomer seal lid rim (y = 0.396..0.404 m) + central lock knob
  const lidRimSlices: LoftSlice[] = [
    { y: 0.3958, pts: sampleSquircleRing(0.0715, 0.0665, 0.56, 48) },
    { y: 0.3998, pts: sampleSquircleRing(0.0726, 0.0675, 0.56, 48) },
    { y: 0.4028, pts: sampleSquircleRing(0.0705, 0.0655, 0.56, 48) },
  ];
  const lidRimMesh = new THREE.Mesh(
    buildLoftedSheetMetalGeometry(lidRimSlices, false, true),
    matMatteBlack
  );
  applyShadow(lidRimMesh);
  hopperGroup.add(lidRimMesh);

  const lockDialKnob = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.014, 0.015, 0.003, 24)),
    matPolishedChrome
  );
  lockDialKnob.position.y = 0.4024;
  hopperGroup.add(lockDialKnob);

  // TILTED FRONT CONTROL FASCIA, UNOBSTRUCTED PRESSURE GAUGE & SIDE DIALS
  const controlsGroup = new THREE.Group();
  controlsGroup.name = `${namePrefix}.frontControlFascia`;
  root.add(controlsGroup);

  const fasciaMidY = 0.285;
  // Sits 6-8 mm proud of upperHeadMesh's inward-stepped front center -> zero Z-overlap!
  const fasciaMidZ =
    (zHeadBotSide + zHeadTopSide) * 0.5 + 0.0035;
  const sinT = Math.sin(tiltRad);
  const cosT = Math.cos(tiltRad);

  const placeOnFascia = (
    obj: THREE.Object3D,
    x: number,
    y: number,
    nOffset = 0
  ): void => {
    const dy = y - fasciaMidY;
    const baseZ = fasciaMidZ - dy * Math.tan(tiltRad);
    obj.position.set(x, y + nOffset * sinT, baseZ + nOffset * cosT);
    obj.rotation.x = -tiltRad;
  };

  const createSculptedFasciaShape = (
    hw: number,
    topH: number,
    sideBotY: number,
    midBellyY: number,
    rCorner: number
  ): THREE.Shape => {
    const s = new THREE.Shape();
    s.moveTo(-hw + rCorner, topH);
    s.lineTo(hw - rCorner, topH);
    s.absarc(hw - rCorner, topH - rCorner, rCorner, Math.PI * 0.5, 0, true);
    s.lineTo(hw, sideBotY + rCorner);
    s.absarc(hw - rCorner, sideBotY + rCorner, rCorner, 0, -Math.PI * 0.5, true);
    s.lineTo(0.044, sideBotY);
    s.bezierCurveTo(0.028, sideBotY, 0.026, midBellyY, 0.0, midBellyY);
    s.bezierCurveTo(-0.026, midBellyY, -0.028, sideBotY, -0.044, sideBotY);
    s.lineTo(-hw + rCorner, sideBotY);
    s.absarc(
      -hw + rCorner,
      sideBotY + rCorner,
      rCorner,
      -Math.PI * 0.5,
      -Math.PI,
      true
    );
    s.lineTo(-hw, topH - rCorner);
    s.absarc(
      -hw + rCorner,
      topH - rCorner,
      rCorner,
      Math.PI,
      Math.PI * 0.5,
      true
    );
    s.closePath();
    return s;
  };

  // Raised polished-chrome perimeter bezel framing the control panel
  const fasciaInnerShape = createSculptedFasciaShape(
    0.135,
    0.037,
    -0.038,
    -0.048,
    0.009
  );
  const fasciaBezelShape = createSculptedFasciaShape(
    0.141,
    0.042,
    -0.043,
    -0.053,
    0.013
  );
  fasciaBezelShape.holes.push(fasciaInnerShape);

  const bezelGeo = prepGeo(
    new THREE.ExtrudeGeometry(fasciaBezelShape, {
      depth: 0.0032,
      bevelEnabled: true,
      bevelThickness: 0.0014,
      bevelSize: 0.0014,
      bevelSegments: 3,
      curveSegments: 24,
    })
  );
  const bezelMesh = new THREE.Mesh(bezelGeo, matPolishedChrome);
  placeOnFascia(bezelMesh, 0, fasciaMidY, 0.0);
  applyShadow(bezelMesh);
  controlsGroup.add(bezelMesh);

  // Brushed-stainless recessed control panel with circular cutout hole for Pressure Gauge
  const gaugeCenterY = 0.270;
  const gaugeLocalY = gaugeCenterY - fasciaMidY;
  const fasciaPanelShape = createSculptedFasciaShape(
    0.136,
    0.038,
    -0.039,
    -0.049,
    0.010
  );
  const gaugeCutoutHole = new THREE.Path();
  gaugeCutoutHole.absarc(0, gaugeLocalY, 0.0252, 0, Math.PI * 2, true);
  fasciaPanelShape.holes.push(gaugeCutoutHole);

  const fasciaPanelGeo = prepGeo(
    new THREE.ExtrudeGeometry(fasciaPanelShape, {
      depth: 0.0018,
      bevelEnabled: false,
      curveSegments: 28,
    })
  );
  applyHorizontalBrushedUVs(fasciaPanelGeo);
  const fasciaPanelMesh = new THREE.Mesh(fasciaPanelGeo, matFasciaBrushedSS);
  placeOnFascia(fasciaPanelMesh, 0, fasciaMidY, 0.0);
  fasciaPanelMesh.receiveShadow = true;
  controlsGroup.add(fasciaPanelMesh);

  // Silk-screened charcoal fascia legends + embossed Sage wordmark overlay
  const legendPlaneGeo = prepGeo(new THREE.PlaneGeometry(0.280, 0.090));
  const legendMesh = new THREE.Mesh(
    legendPlaneGeo,
    matFasciaLegend
  );
  placeOnFascia(legendMesh, 0, 0.282, 0.0022);
  controlsGroup.add(legendMesh);

  // Helper to construct BES875BSS recessed LED-halo collar + spun-metal push button
  const addPushButton = (
    bx: number,
    by: number,
    radius: number,
    activeGlow = false
  ): void => {
    const grp = new THREE.Group();
    placeOnFascia(grp, bx, by, 0.0020);

    const recessRing = new THREE.Mesh(
      prepGeo(new THREE.RingGeometry(radius * 0.96, radius * 1.28, 32)),
      matMatteBlack
    );
    recessRing.position.z = 0.0002;
    grp.add(recessRing);

    const haloGeo = prepGeo(
      new THREE.TorusGeometry(radius * 1.11, 0.0011, 10, 28)
    );
    const halo = new THREE.Mesh(
      haloGeo,
      activeGlow ? matLedPowerOn : matLedRingIdle
    );
    halo.position.z = 0.0007;
    grp.add(halo);

    const bezelCollar = new THREE.Mesh(
      prepGeo(
        new THREE.CylinderGeometry(radius * 1.03, radius * 1.08, 0.0024, 28)
      ),
      matPolishedChrome
    );
    bezelCollar.rotation.x = Math.PI * 0.5;
    bezelCollar.position.z = 0.0012;
    grp.add(bezelCollar);

    const btnCap = new THREE.Mesh(
      prepGeo(
        new THREE.CylinderGeometry(radius * 0.88, radius * 0.94, 0.0040, 28)
      ),
      matSpunButtonCap
    );
    btnCap.rotation.x = Math.PI * 0.5;
    btnCap.position.z = 0.0025;
    applyShadow(btnCap);
    grp.add(btnCap);

    controlsGroup.add(grp);
  };

  // Left-to-right BES875BSS fascia controls (aligned at y = 0.292 m):
  // POWER button (x = -0.120)
  addPushButton(-0.120, 0.292, 0.0076, true);

  // GRIND AMOUNT rotary knurled dial (x = -0.087, Ø26 mm)
  const grindAmountGroup = new THREE.Group();
  placeOnFascia(grindAmountGroup, -0.087, 0.292, 0.0020);
  controlsGroup.add(grindAmountGroup);

  const gaSkirt = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0132, 0.0144, 0.004, 32)),
    matPolishedChrome
  );
  gaSkirt.rotation.x = Math.PI * 0.5;
  gaSkirt.position.z = 0.002;
  grindAmountGroup.add(gaSkirt);

  const gaKnob = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0114, 0.0122, 0.011, 36)),
    matSpunButtonCap
  );
  gaKnob.rotation.x = Math.PI * 0.5;
  gaKnob.position.z = 0.0068;
  applyShadow(gaKnob);
  grindAmountGroup.add(gaKnob);

  const gaPointer = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(0.0065, 0.0017, 0.0016)),
    matMatteBlack
  );
  gaPointer.position.set(0.0048, 0.0018, 0.0126);
  gaPointer.rotation.z = 0.32;
  grindAmountGroup.add(gaPointer);

  // FILTER SIZE button (x = -0.051) + SINGLE / DOUBLE LEDs
  addPushButton(-0.051, 0.292, 0.0066, false);

  const ledPinGeo = prepGeo(
    new THREE.CylinderGeometry(0.0017, 0.0019, 0.0015, 14)
  );
  ledPinGeo.rotateX(Math.PI * 0.5);

  for (const [lx, lit] of [
    [-0.060, false],
    [-0.042, true],
  ] as Array<[number, boolean]>) {
    const led = new THREE.Mesh(
      ledPinGeo,
      lit ? matLedWarmDot : matLedRingIdle
    );
    placeOnFascia(led, lx, 0.264, 0.0022);
    controlsGroup.add(led);
  }

  // CENTRAL RECESSED Ø56 mm ESPRESSO PRESSURE GAUGE (x = 0.000, y = 0.270)
  // Completely unobstructed in front of upperHeadMesh (-0.006 m bow)!
  const gaugeGroup = new THREE.Group();
  placeOnFascia(gaugeGroup, 0.0, gaugeCenterY, 0.0015);
  controlsGroup.add(gaugeGroup);

  const bezelLathePts = [
    new THREE.Vector2(0.0238, -0.0042),
    new THREE.Vector2(0.0242, 0.0022),
    new THREE.Vector2(0.0262, 0.0052),
    new THREE.Vector2(0.0290, 0.0048),
    new THREE.Vector2(0.0298, 0.0008),
    new THREE.Vector2(0.0298, -0.0012),
  ];
  const gaugeBezelGeo = prepGeo(new THREE.LatheGeometry(bezelLathePts, 48));
  gaugeBezelGeo.rotateX(Math.PI * 0.5);
  const gaugeBezelMesh = new THREE.Mesh(gaugeBezelGeo, matPolishedChrome);
  applyShadow(gaugeBezelMesh);
  gaugeGroup.add(gaugeBezelMesh);

  // Dark inner gauge barrel shadow liner for crisp 3D depth from straight-on & 3/4 views
  const gaugeShadowSleeve = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0241, 0.0241, 0.0062, 48, 1, true)),
    matGaugeShadowSleeve
  );
  gaugeShadowSleeve.rotation.x = Math.PI * 0.5;
  gaugeShadowSleeve.position.z = -0.0004;
  gaugeGroup.add(gaugeShadowSleeve);

  // Recessed 512x512 Espresso Pressure Gauge dial disc (matte printed dial card — zero glare blowout!)
  const dialDisc = new THREE.Mesh(
    prepGeo(new THREE.CircleGeometry(0.0242, 48)),
    matGaugeDialDisc
  );
  dialDisc.position.z = -0.0034;
  gaugeGroup.add(dialDisc);

  // 3D tapered crimson gauge needle resting at 7:30 ready position
  const needleShape = new THREE.Shape();
  needleShape.moveTo(-0.0048, -0.0014);
  needleShape.lineTo(0.0185, -0.0005);
  needleShape.lineTo(0.0196, 0);
  needleShape.lineTo(0.0185, 0.0005);
  needleShape.lineTo(-0.0048, 0.0014);
  needleShape.closePath();
  const needleGeo = prepGeo(
    new THREE.ExtrudeGeometry(needleShape, { depth: 0.0008, bevelEnabled: false })
  );
  const needleMesh = new THREE.Mesh(
    needleGeo,
    matGaugeNeedle
  );
  needleMesh.position.z = -0.0020;
  needleMesh.rotation.z = (-132 * Math.PI) / 180;
  gaugeGroup.add(needleMesh);

  const needleBoss = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0033, 0.0036, 0.0020, 20)),
    matPolishedChrome
  );
  needleBoss.rotation.x = Math.PI * 0.5;
  needleBoss.position.z = -0.0012;
  gaugeGroup.add(needleBoss);

  // Subtle curved watch-glass specular lens
  const gaugeGlass = new THREE.Mesh(
    prepGeo(
      new THREE.SphereGeometry(0.056, 32, 16, 0, Math.PI * 2, 0, 0.42)
    ),
    matGaugeGlass
  );
  gaugeGlass.rotation.x = Math.PI * 0.5;
  gaugeGlass.scale.set(1, 1, 0.25);
  gaugeGlass.position.z = -0.010;
  gaugeGroup.add(gaugeGlass);

  // PROGRAM button (x = +0.051) + CLEAN/DESCALE & STEAM LEDs
  addPushButton(0.051, 0.292, 0.0066, false);

  for (const lx of [0.041, 0.062]) {
    const led = new THREE.Mesh(ledPinGeo, matLedRingIdle);
    placeOnFascia(led, lx, 0.264, 0.0022);
    controlsGroup.add(led);
  }

  // 1 CUP (x = +0.087) & 2 CUP (x = +0.120) volumetric shot buttons
  addPushButton(0.087, 0.292, 0.0080, true);
  addPushButton(0.120, 0.292, 0.0080, true);

  // Left side cheek: Recessed GRIND SIZE knurled thumbwheel (x = -0.150, y = 0.286, z = 0.014)
  const grindWheelGroup = new THREE.Group();
  grindWheelGroup.position.set(-0.150, 0.286, 0.014);
  controlsGroup.add(grindWheelGroup);

  const wheelSlotRecess = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(0.005, 0.046, 0.022)),
    matMatteBlack
  );
  grindWheelGroup.add(wheelSlotRecess);

  const grindWheel = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.020, 0.020, 0.009, 32)),
    matCastAlloy
  );
  grindWheel.rotation.z = Math.PI * 0.5;
  grindWheel.position.x = -0.0015;
  grindWheelGroup.add(grindWheel);

  // Right side cheek: Prominent STEAM / HOT WATER cylindrical rotary dial (x = +0.150..+0.1588 m)
  const steamDialGroup = new THREE.Group();
  steamDialGroup.position.set(0.150, 0.286, 0.006);
  controlsGroup.add(steamDialGroup);

  const steamEscutcheon = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.023, 0.024, 0.005, 36)),
    matPolishedChrome
  );
  steamEscutcheon.rotation.z = -Math.PI * 0.5;
  steamEscutcheon.position.x = 0.0015;
  steamDialGroup.add(steamEscutcheon);

  const steamDialDrum = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0195, 0.0205, 0.009, 36)),
    matBrushedSS
  );
  steamDialDrum.rotation.z = -Math.PI * 0.5;
  steamDialDrum.position.x = 0.0045;
  applyShadow(steamDialDrum);
  steamDialGroup.add(steamDialDrum);

  const steamGripBlade = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(0.007, 0.036, 0.0065)),
    matPolishedChrome
  );
  steamGripBlade.position.x = 0.0058;
  applyShadow(steamGripBlade);
  steamDialGroup.add(steamGripBlade);

  // BREW BAY HARDWARE: TAMPER (-0.118), OPEN CRADLE (-0.054),
  //    CHROME 54mm GROUP HEAD (+0.036), PORTAFILTER, HOT WATER & STEAM WAND (+0.115)
  const brewBayGroup = new THREE.Group();
  brewBayGroup.name = `${namePrefix}.brewBay`;
  root.add(brewBayGroup);

  // Magnetic docked 54 mm tamper on far-left underside (x = -0.118, z = 0.050)
  const tamperGroup = new THREE.Group();
  tamperGroup.name = 'MagneticTamper';
  tamperGroup.position.set(-0.118, 0.236, 0.050);
  brewBayGroup.add(tamperGroup);

  const tamperSocket = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.020, 0.018, 0.008, 24)),
    matMatteBlack
  );
  tamperGroup.add(tamperSocket);

  const tamperProfile = [
    new THREE.Vector2(0.017, -0.029),
    new THREE.Vector2(0.012, -0.017),
    new THREE.Vector2(0.016, -0.003),
    new THREE.Vector2(0.0, 0.0),
  ];
  const tamperBaseDisc = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0268, 0.0268, 0.007, 32)),
    matPolishedChrome
  );
  tamperBaseDisc.position.y = -0.0365;
  applyShadow(tamperBaseDisc);
  tamperGroup.add(tamperBaseDisc);

  const tamperGripLathe = new THREE.Mesh(
    prepGeo(new THREE.LatheGeometry(tamperProfile, 28)),
    matMatteBlack
  );
  applyShadow(tamperGripLathe);
  tamperGroup.add(tamperGripLathe);

  // Grinder outlet collar + open two-prong black dosing fork cradle (x = -0.054, z = 0.044)
  const cradleGroup = new THREE.Group();
  cradleGroup.name = 'GrinderDosingCradle';
  cradleGroup.position.set(-0.054, 0.235, 0.044);
  brewBayGroup.add(cradleGroup);

  const grinderCollar = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.025, 0.022, 0.018, 32)),
    matPolishedChrome
  );
  grinderCollar.position.y = -0.008;
  applyShadow(grinderCollar);
  cradleGroup.add(grinderCollar);

  const grinderChuteInner = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.014, 0.011, 0.012, 20)),
    matMatteBlack
  );
  grinderChuteInner.position.y = -0.016;
  cradleGroup.add(grinderChuteInner);

  const cradleBridge = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(0.046, 0.007, 0.012)),
    matMatteBlack
  );
  cradleBridge.position.set(0, -0.020, -0.012);
  cradleGroup.add(cradleBridge);

  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(
      prepGeo(new THREE.BoxGeometry(0.0055, 0.022, 0.010)),
      matMatteBlack
    );
    post.position.set(side * 0.022, -0.029, -0.010);
    cradleGroup.add(post);

    const prong = new THREE.Mesh(
      prepGeo(new THREE.BoxGeometry(0.006, 0.0055, 0.038)),
      matMatteBlack
    );
    prong.position.set(side * 0.023, -0.038, 0.008);
    applyShadow(prong);
    cradleGroup.add(prong);
  }

  const triggerPaddle = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(0.014, 0.022, 0.0025)),
    matMatteBlack
  );
  triggerPaddle.position.set(0, -0.032, -0.010);
  triggerPaddle.rotation.x = 0.14;
  cradleGroup.add(triggerPaddle);

  // Polished-Chrome 54 mm Brew Group Head Collar ("LOCK TIGHT") & Locked Portafilter (x = +0.036, z = 0.046)
  const groupHeadGroup = new THREE.Group();
  groupHeadGroup.name = 'GroupHeadAndPortafilter';
  groupHeadGroup.position.set(0.036, 0.236, 0.046);
  brewBayGroup.add(groupHeadGroup);

  const ghChromeShroud = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.043, 0.041, 0.022, 36)),
    matPolishedChrome
  );
  ghChromeShroud.position.y = -0.010;
  applyShadow(ghChromeShroud);
  groupHeadGroup.add(ghChromeShroud);

  const ghInnerGasket = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.036, 0.035, 0.005, 32)),
    matMatteBlack
  );
  ghInnerGasket.position.y = -0.0215;
  groupHeadGroup.add(ghInnerGasket);

  // Sculpted 54 mm portafilter locked at a natural slight barista angle (-14 deg)
  const portafilter = new THREE.Group();
  portafilter.name = 'Portafilter54mm';
  portafilter.position.y = -0.024;
  portafilter.rotation.y = -0.22;
  groupHeadGroup.add(portafilter);

  const pfBasketProfile = [
    new THREE.Vector2(0.0, -0.025),
    new THREE.Vector2(0.018, -0.025),
    new THREE.Vector2(0.026, -0.019),
    new THREE.Vector2(0.031, -0.008),
    new THREE.Vector2(0.033, 0.002),
    new THREE.Vector2(0.029, 0.003),
  ];
  const pfBowl = new THREE.Mesh(
    prepGeo(new THREE.LatheGeometry(pfBasketProfile, 36)),
    matPolishedChrome
  );
  applyShadow(pfBowl);
  portafilter.add(pfBowl);

  for (const earSign of [-1, 1]) {
    const ear = new THREE.Mesh(
      prepGeo(new THREE.BoxGeometry(0.008, 0.004, 0.018)),
      matPolishedChrome
    );
    ear.position.set(earSign * 0.032, 0.0, 0);
    portafilter.add(ear);
  }

  const spoutManifold = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.011, 0.009, 0.009, 20)),
    matPolishedChrome
  );
  spoutManifold.position.y = -0.028;
  portafilter.add(spoutManifold);

  for (const sSign of [-1, 1]) {
    const spoutCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(sSign * 0.004, -0.030, 0),
      new THREE.Vector3(sSign * 0.011, -0.035, 0.002),
      new THREE.Vector3(sSign * 0.014, -0.042, 0.003),
    ]);
    const spoutTube = new THREE.Mesh(
      prepGeo(new THREE.TubeGeometry(spoutCurve, 12, 0.0034, 12, false)),
      matPolishedChrome
    );
    applyShadow(spoutTube);
    portafilter.add(spoutTube);
  }

  const handleAxis = new THREE.Group();
  handleAxis.position.set(0, -0.009, 0.0225);
  handleAxis.rotation.x = 0.14;
  portafilter.add(handleAxis);

  const pfNeck = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0085, 0.0108, 0.028, 24)),
    matPolishedChrome
  );
  pfNeck.rotation.x = Math.PI * 0.5;
  pfNeck.position.z = 0.012;
  applyShadow(pfNeck);
  handleAxis.add(pfNeck);

  const pfHandleProfile = [
    new THREE.Vector2(0.0092, 0.024),
    new THREE.Vector2(0.0108, 0.044),
    new THREE.Vector2(0.0138, 0.078),
    new THREE.Vector2(0.0150, 0.102),
    new THREE.Vector2(0.0138, 0.111),
  ];
  const pfGrip = new THREE.Mesh(
    prepGeo(new THREE.LatheGeometry(pfHandleProfile, 28)),
    matGlossBlackHandle
  );
  pfGrip.rotation.x = Math.PI * 0.5;
  applyShadow(pfGrip);
  handleAxis.add(pfGrip);

  const pfPommelProfile = [
    new THREE.Vector2(0.0138, 0.111),
    new THREE.Vector2(0.0140, 0.116),
    new THREE.Vector2(0.0112, 0.120),
    new THREE.Vector2(0.0, 0.121),
  ];
  const pfPommel = new THREE.Mesh(
    prepGeo(new THREE.LatheGeometry(pfPommelProfile, 24)),
    matPolishedChrome
  );
  pfPommel.rotation.x = Math.PI * 0.5;
  applyShadow(pfPommel);
  handleAxis.add(pfPommel);

  // Dedicated Hot Water Spout nozzle (x = +0.084, y = 0.228, z = 0.036)
  const hotWaterNozzle = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0065, 0.0045, 0.018, 18)),
    matPolishedChrome
  );
  hotWaterNozzle.position.set(0.084, 0.228, 0.036);
  hotWaterNozzle.rotation.x = 0.08;
  brewBayGroup.add(hotWaterNozzle);

  // 360-deg Ball-Joint Stainless Steam Wand + Iconic Circular Finger-Loop Grip (x = +0.115, z = 0.050)
  const steamWandGroup = new THREE.Group();
  steamWandGroup.name = 'BallJointSteamWand';
  steamWandGroup.position.set(0.109, 0.233, 0.050);
  brewBayGroup.add(steamWandGroup);

  const wandSocket = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.011, 0.0095, 0.012, 20)),
    matPolishedChrome
  );
  steamWandGroup.add(wandSocket);

  const swivelBall = new THREE.Mesh(
    prepGeo(new THREE.SphereGeometry(0.0072, 18, 14)),
    matPolishedChrome
  );
  swivelBall.position.y = -0.006;
  steamWandGroup.add(swivelBall);

  const wandCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.0, -0.006, 0.0),
    new THREE.Vector3(-0.002, -0.036, 0.006),
    new THREE.Vector3(0.012, -0.056, 0.018),
    new THREE.Vector3(0.025, -0.106, 0.030),
    new THREE.Vector3(0.032, -0.138, 0.036),
  ]);
  const wandTube = new THREE.Mesh(
    prepGeo(new THREE.TubeGeometry(wandCurve, 28, 0.0034, 14, false)),
    matPolishedChrome
  );
  applyShadow(wandTube);
  steamWandGroup.add(wandTube);

  const wandTip = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0044, 0.0038, 0.012, 18)),
    matPolishedChrome
  );
  wandTip.position.set(0.032, -0.139, 0.036);
  wandTip.rotation.z = 0.22;
  wandTip.rotation.x = -0.16;
  steamWandGroup.add(wandTip);

  const wandGripGroup = new THREE.Group();
  wandGripGroup.position.set(0.012, -0.056, 0.018);
  wandGripGroup.rotation.set(-0.18, 0.34, -0.42);
  steamWandGroup.add(wandGripGroup);

  const wandSleeve = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0056, 0.0056, 0.024, 16)),
    matMatteBlack
  );
  wandGripGroup.add(wandSleeve);

  const loopBridge = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(0.010, 0.0065, 0.0055)),
    matMatteBlack
  );
  loopBridge.position.set(0.008, 0.002, 0);
  wandGripGroup.add(loopBridge);

  const fingerLoop = new THREE.Mesh(
    prepGeo(new THREE.TorusGeometry(0.0115, 0.0034, 12, 28)),
    matMatteBlack
  );
  fingerLoop.position.set(0.020, 0.004, 0);
  applyShadow(fingerLoop);
  wandGripGroup.add(fingerLoop);

  // 480 ml SAGE BRUSHED STAINLESS MILK PITCHER WITH TEMP STRIP
  if (withMilkPitcher) {
    const pitcherGroup = new THREE.Group();
    pitcherGroup.name = `${namePrefix}.milkPitcher`;
    pitcherGroup.position.set(0.088, 0.0588, 0.084);
    pitcherGroup.rotation.y = -0.34;
    root.add(pitcherGroup);

    const pitcherProfile = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.036, 0.0),
      new THREE.Vector2(0.041, 0.010),
      new THREE.Vector2(0.040, 0.044),
      new THREE.Vector2(0.036, 0.084),
      new THREE.Vector2(0.038, 0.104),
      new THREE.Vector2(0.0368, 0.105),
      new THREE.Vector2(0.0345, 0.084),
      new THREE.Vector2(0.037, 0.012),
      new THREE.Vector2(0.0, 0.004),
    ];
    const pitcherGeo = prepGeo(new THREE.LatheGeometry(pitcherProfile, 36));
    const pPos = pitcherGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pPos.count; i++) {
      const py = pPos.getY(i);
      const px = pPos.getX(i);
      const pz = pPos.getZ(i);
      if (py > 0.084 && pz > 0.022 && Math.abs(px) < 0.016) {
        const t = (py - 0.084) / 0.021;
        const pinch = 1 - Math.abs(px) / 0.016;
        pPos.setZ(i, pz + t * pinch * 0.0055);
        pPos.setY(i, py + t * pinch * 0.0018);
      }
    }
    pitcherGeo.computeVertexNormals();
    applyHorizontalBrushedUVs(pitcherGeo);

    const pitcherBody = new THREE.Mesh(pitcherGeo, matBrushedSS);
    applyShadow(pitcherBody);
    pitcherGroup.add(pitcherBody);

    const strapCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.094, -0.036),
      new THREE.Vector3(0, 0.092, -0.056),
      new THREE.Vector3(0, 0.058, -0.060),
      new THREE.Vector3(0, 0.028, -0.046),
      new THREE.Vector3(0, 0.026, -0.039),
    ]);
    const strapGeo = prepGeo(
      new THREE.TubeGeometry(strapCurve, 22, 0.0038, 10, false)
    );
    strapGeo.scale(1.85, 1.0, 0.65);
    const strapHandle = new THREE.Mesh(strapGeo, matPolishedChrome);
    applyShadow(strapHandle);
    pitcherGroup.add(strapHandle);

    const badgeCylinder = new THREE.Mesh(
      prepGeo(
        new THREE.CylinderGeometry(
          0.0372,
          0.0384,
          0.014,
          20,
          1,
          true,
          -0.36,
          0.72
        )
      ),
      matPitcherBadge
    );
    badgeCylinder.position.y = 0.052;
    pitcherGroup.add(badgeCylinder);

    const tempStripGeo = prepGeo(
      new THREE.CylinderGeometry(
        0.0406,
        0.0412,
        0.012,
        24,
        1,
        true,
        -0.44,
        0.88
      )
    );
    const tempStripMesh = new THREE.Mesh(
      tempStripGeo,
      matTempStrip
    );
    tempStripMesh.position.y = 0.022;
    pitcherGroup.add(tempStripMesh);
  }

  attachAssetInteraction(root, {
    kind: 'toggle',
    label: 'Pull Double Espresso Shot',
    activeLabel: 'Stop Espresso Extraction',
    autoResetAfterSec: 4.5,
    audio: {
      openPreset: 'espressoExtract',
      activeLoopPreset: 'espressoMachine',
      volume: 0.72,
    },
  });
  return attachAssetMetadata(root, {
    name: 'Sage the Barista Express Espresso Machine',
    brand: 'Sage Appliances',
    collection: 'Barista Series',
    sku: 'SES875BSS',
    finish: 'Brushed Stainless Steel',
    category: 'appliance',
    dimensionsMm: [318, 351, 404],
    productUrl: 'https://www.sageappliances.com/uk/en/products/espresso/bes875.html',
    schematicUrl: 'https://www.sageappliances.com/content/dam/breville-brands/sage/uk/en/support/manuals/SES875_IB.pdf',
  });
}
