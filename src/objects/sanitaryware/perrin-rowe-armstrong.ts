import * as THREE from 'three';
import { attachAssetInteraction, attachAssetMetadata, formatBrasswareFinishLabel, resolveBrasswareCode } from '../shared/catalog-smart-metadata.ts';
import {
  finalizeSanitaryGroup,
  getBathroomBrassMaterials,
  getCardboardCoreMaterial,
  getTissuePaperMaterial,
  getVitreousChinaMaterial,
} from './bathroom-materials.ts';
import { prepGeo } from '../shared/scene-helpers.ts';
import type {
  ArmstrongConcealedShowerSetOptions,
  ArmstrongDeck3HoleBasinMixerOptions,
  ArmstrongFreestandingBathMixerOptions,
  ArmstrongPaperHolderOptions,
  ArmstrongRobeHookOptions,
  ArmstrongWallBasinMixerOptions,
  BathroomMetalMaterialPalette,
  PerrinRoweCollectionStyle,
  PerrinRoweConcealedCisternLeverOptions,
  PerrinRoweTowelRingOptions,
} from './bathroom-spec-types.ts';

/**
 * Perrin & Rowe `Armstrong` Industrial-Heritage Brassware Collection:
 * - `3681` 2-hole wall-mounted single-lever basin mixer
 * - `5664` + `5684` + `5605` + `5640` + `5687` + `5646` concealed thermostatic shower set
 * - `3660` freestanding floor-mounted bath-shower mixer with handshower
 * - `6221` wall-mounted robe hook (`W53 × H46 × D46mm`)
 * - `6258` wall-mounted paper holder (`W147 × H98 × D46mm` + ivory roll)
 */

/**
 * Builds an exact straight + circular 90°-downturn `CurvePath` in the Y-Z plane (`x = 0`),
 * starting horizontally along `+Z` at `(0, startY, startZ)` and turning cleanly straight down
 * to `(0, endY, reachZ)`. Avoids spline overshoot on machined cylindrical spouts and arms.
 */
function buildHorizontalToDownwardArmCurve(
  startY: number,
  startZ: number,
  reachZ: number,
  bendRadius: number,
  endY: number
): THREE.CurvePath<THREE.Vector3> {
  const path = new THREE.CurvePath<THREE.Vector3>();
  const r = Math.min(
    bendRadius,
    Math.max(0.008, (reachZ - startZ) * 0.48),
    Math.max(0.008, (startY - endY) * 0.85)
  );
  const tangentZ = reachZ - r;
  const arcCenterY = startY - r;

  if (tangentZ > startZ + 0.001) {
    path.add(
      new THREE.LineCurve3(
        new THREE.Vector3(0, startY, startZ),
        new THREE.Vector3(0, startY, tangentZ)
      )
    );
  }

  // Approximate exact circular quarter-arc with two cubic Beziers (max radial error < 0.03%)
  const k = 0.5522847498 * r * 0.5;
  const midAngle = Math.PI * 0.25;
  const sin45 = Math.sin(midAngle);
  const cos45 = Math.cos(midAngle);
  const p0 = new THREE.Vector3(0, startY, tangentZ);
  const pMid = new THREE.Vector3(0, arcCenterY + r * cos45, tangentZ + r * sin45);
  const pEnd = new THREE.Vector3(0, arcCenterY, reachZ);

  // Tangent unit vectors along quarter-arc from top (0,+1) -> 45° (-sin45,+cos45) -> vertical (-1,0)
  const t45Y = -sin45;
  const t45Z = cos45;
  const bez1 = new THREE.CubicBezierCurve3(
    p0,
    new THREE.Vector3(0, startY, tangentZ + k * 0.92),
    new THREE.Vector3(0, pMid.y - t45Y * k * 0.92, pMid.z - t45Z * k * 0.92),
    pMid
  );
  const bez2 = new THREE.CubicBezierCurve3(
    pMid,
    new THREE.Vector3(0, pMid.y + t45Y * k * 0.92, pMid.z + t45Z * k * 0.92),
    new THREE.Vector3(0, arcCenterY + k * 0.92, reachZ),
    pEnd
  );
  path.add(bez1);
  path.add(bez2);

  if (arcCenterY > endY + 0.001) {
    path.add(
      new THREE.LineCurve3(
        new THREE.Vector3(0, arcCenterY, reachZ),
        new THREE.Vector3(0, endY, reachZ)
      )
    );
  }
  return path;
}

/**
 * Builds a stepped circular wall rose (back face at `y = 0`, front at `y = totalDepth` before rotation;
 * rotate `rotation.x = Math.PI / 2` to sit flush on `z = 0` projecting along `+Z`).
 */
function createSteppedCircularRoseGeometry(
  outerRadius: number,
  innerBossRadius: number,
  totalDepth: number
): THREE.LatheGeometry {
  const stepR = outerRadius * 0.80;
  const d1 = totalDepth * 0.46;
  const d2 = totalDepth * 0.56;
  const pts = [
    new THREE.Vector2(innerBossRadius * 0.85, 0),
    new THREE.Vector2(outerRadius, 0),
    new THREE.Vector2(outerRadius, d1 * 0.82),
    new THREE.Vector2(outerRadius - 0.0014, d1),
    new THREE.Vector2(stepR + 0.0012, d2),
    new THREE.Vector2(stepR, totalDepth * 0.90),
    new THREE.Vector2(stepR - 0.0012, totalDepth),
    new THREE.Vector2(innerBossRadius, totalDepth),
  ];
  return prepGeo(new THREE.LatheGeometry(pts, 32));
}

/**
 * Builds a rounded stadium / chamfered rectangular plate extruded along `+Z` (`z = 0 .. thickness`).
 */
function createRoundedRectPlateGeometry(
  width: number,
  height: number,
  thickness: number,
  cornerRadius: number,
  bevel = 0.0012
): THREE.ExtrudeGeometry {
  const hw = Math.max(0.004, width * 0.5 - bevel);
  const hh = Math.max(0.004, height * 0.5 - bevel);
  const r = Math.min(cornerRadius, hw * 0.95, hh * 0.95);

  const shape = new THREE.Shape();
  shape.moveTo(-hw + r, -hh);
  shape.lineTo(hw - r, -hh);
  shape.absarc(hw - r, -hh + r, r, -Math.PI * 0.5, 0, false);
  shape.lineTo(hw, hh - r);
  shape.absarc(hw - r, hh - r, r, 0, Math.PI * 0.5, false);
  shape.lineTo(-hw + r, hh);
  shape.absarc(-hw + r, hh - r, r, Math.PI * 0.5, Math.PI, false);
  shape.lineTo(-hw, -hh + r);
  shape.absarc(-hw + r, -hh + r, r, Math.PI, Math.PI * 1.5, false);

  const depthBody = Math.max(0.001, thickness - bevel);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: depthBody,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: 0,
    bevelSegments: 2,
    curveSegments: 10,
  });
  // Shift so back of bevel sits at exact z = 0 and total front reaches z = depthBody + 2*bevel
  geo.computeBoundingBox();
  if (geo.boundingBox) {
    geo.translate(0, 0, -geo.boundingBox.min.z);
  }
  return prepGeo(geo);
}

/**
 * Builds the reusable `5687` cylindrical Armstrong handshower wand in local wand space:
 * `(0, 0, 0)` is at the bottom hose union tip, wand axis rises along `+Y` (`L ≈ 0.205m`),
 * spray face aims along `+Z`.
 */
function buildArmstrongHandshowerWand5687(
  namePrefix: string,
  mats: BathroomMetalMaterialPalette,
  style: PerrinRoweCollectionStyle = 'armstrong'
): THREE.Group {
  const collarMat = style === 'armstrong' ? mats.knurled : mats.primary;
  const barrelMat = style === 'traditional' ? getVitreousChinaMaterial() : mats.primary;
  const wand = new THREE.Group();
  wand.name = namePrefix;

  // Conical threaded hose connector tailpiece (y = 0 .. 0.026)
  const unionMesh = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0115, 0.0095, 0.026, 20)),
    mats.primary
  );
  unionMesh.name = `${namePrefix}.hoseUnion`;
  unionMesh.position.y = 0.013;
  wand.add(unionMesh);

  // Lower signature knurled grip band (y = 0.026 .. 0.056)
  const lowerKnurl = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0145, 0.0145, 0.030, 24)),
    collarMat
  );
  lowerKnurl.name = `${namePrefix}.knurledGripRing`;
  lowerKnurl.position.y = 0.041;
  wand.add(lowerKnurl);

  // Sleek cylindrical handle barrel (y = 0.056 .. 0.156)
  const barrel = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0138, 0.0138, 0.100, 24)),
    barrelMat
  );
  barrel.name = `${namePrefix}.wandBarrel`;
  barrel.position.y = 0.106;
  wand.add(barrel);

  // Upper knurled neck collar below spray head (y = 0.156 .. 0.168)
  const upperKnurl = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0148, 0.0148, 0.012, 24)),
    collarMat
  );
  upperKnurl.name = `${namePrefix}.headKnurledCollar`;
  upperKnurl.position.y = 0.162;
  wand.add(upperKnurl);

  // Cylindrical/disc spray head facing +Z at top (y = 0.188)
  const sprayHead = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.021, 0.019, 0.024, 24)),
    mats.primary
  );
  sprayHead.name = `${namePrefix}.sprayHead`;
  sprayHead.rotation.x = Math.PI * 0.5;
  sprayHead.position.set(0, 0.186, 0.006);
  wand.add(sprayHead);

  const sprayFace = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0175, 0.0175, 0.002, 24)),
    mats.darkShadow
  );
  sprayFace.name = `${namePrefix}.sprayNozzleFace`;
  sprayFace.rotation.x = Math.PI * 0.5;
  sprayFace.position.set(0, 0.186, 0.0185);
  wand.add(sprayFace);

  return wand;
}

// ---------------------------------------------------------------------------
// 1. 3681 Wall-Mounted 2-Hole Single-Lever Basin Mixer
// ---------------------------------------------------------------------------

export function buildArmstrongWallBasinMixer(
  opts: ArmstrongWallBasinMixerOptions
): THREE.Group {
  const p = opts.namePrefix;
  const mats = getBathroomBrassMaterials(opts.finish);
  const spoutReachM = opts.spoutReachM ?? 0.177;
  const leverOffsetXM = opts.leverOffsetXM ?? 0.105;

  const group = new THREE.Group();
  group.name = p;

  // --- Spout Assembly at (0, 0, 0) ---
  const spoutGroup = new THREE.Group();
  spoutGroup.name = `${p}.spoutTap`;
  group.add(spoutGroup);

  // Stepped Ø55mm circular wall rose (z = 0 .. 0.012m)
  const spoutRose = new THREE.Mesh(
    createSteppedCircularRoseGeometry(0.0275, 0.017, 0.012),
    mats.primary
  );
  spoutRose.name = `${p}.spoutTap.wallRose`;
  spoutRose.rotation.x = Math.PI * 0.5;
  spoutGroup.add(spoutRose);

  // Signature Ø34mm knurled collar barrel (z = 0.012 .. 0.030m)
  const spoutKnurl = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.017, 0.017, 0.018, 28)),
    mats.knurled
  );
  spoutKnurl.name = `${p}.spoutTap.knurledCollar`;
  spoutKnurl.rotation.x = Math.PI * 0.5;
  spoutKnurl.position.z = 0.021;
  spoutGroup.add(spoutKnurl);

  // Stepped transition bezel into Ø24mm spout tube (z = 0.030 .. 0.036m)
  const spoutStep = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0125, 0.0155, 0.006, 24)),
    mats.primary
  );
  spoutStep.name = `${p}.spoutTap.barrelShoulder`;
  spoutStep.rotation.x = Math.PI * 0.5;
  spoutStep.position.z = 0.033;
  spoutGroup.add(spoutStep);

  // Horizontal Ø24mm cylindrical spout tube curving 90° downward at z = spoutReachM
  const spoutCurve = buildHorizontalToDownwardArmCurve(0, 0.035, spoutReachM, 0.034, -0.034);
  const spoutTube = new THREE.Mesh(
    prepGeo(new THREE.TubeGeometry(spoutCurve, 28, 0.012, 20, false)),
    mats.primary
  );
  spoutTube.name = `${p}.spoutTap.spoutTube`;
  spoutGroup.add(spoutTube);

  // Stepped nozzle cuff + knurled aerator ring + recessed dark aerator at (0, -0.038, spoutReachM)
  const nozzleCuff = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0132, 0.0132, 0.007, 24)),
    mats.primary
  );
  nozzleCuff.name = `${p}.spoutTap.nozzleCuff`;
  nozzleCuff.position.set(0, -0.036, spoutReachM);
  spoutGroup.add(nozzleCuff);

  const nozzleKnurl = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0136, 0.0132, 0.006, 24)),
    mats.knurled
  );
  nozzleKnurl.name = `${p}.spoutTap.nozzleKnurledRing`;
  nozzleKnurl.position.set(0, -0.0425, spoutReachM);
  spoutGroup.add(nozzleKnurl);

  const aerator = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0095, 0.0095, 0.002, 20)),
    mats.darkShadow
  );
  aerator.name = `${p}.spoutTap.aerator`;
  aerator.position.set(0, -0.045, spoutReachM);
  spoutGroup.add(aerator);

  // --- Single-Lever Mixer Valve Assembly at (leverOffsetXM, 0, 0) ---
  const valveGroup = new THREE.Group();
  valveGroup.name = `${p}.mixerValve`;
  valveGroup.position.set(leverOffsetXM, 0, 0);
  group.add(valveGroup);

  // Stepped Ø46mm mixer wall rose (z = 0 .. 0.010m)
  const leverRose = new THREE.Mesh(
    createSteppedCircularRoseGeometry(0.023, 0.018, 0.010),
    mats.primary
  );
  leverRose.name = `${p}.mixerValve.wallRose`;
  leverRose.rotation.x = Math.PI * 0.5;
  valveGroup.add(leverRose);

  // Cylindrical Ø36mm mixer body (z = 0.010 .. 0.062m)
  const mixerBody = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.018, 0.018, 0.052, 28)),
    mats.primary
  );
  mixerBody.name = `${p}.mixerValve.body`;
  mixerBody.rotation.x = Math.PI * 0.5;
  mixerBody.position.z = 0.036;
  valveGroup.add(mixerBody);

  // Signature Ø39mm knurled collar ring around mixer body (z = 0.034 .. 0.050m)
  const mixerKnurl = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0194, 0.0194, 0.016, 28)),
    mats.knurled
  );
  mixerKnurl.name = `${p}.mixerValve.knurledCollar`;
  mixerKnurl.rotation.x = Math.PI * 0.5;
  mixerKnurl.position.z = 0.042;
  valveGroup.add(mixerKnurl);

  // Domed cartridge cap (z = 0.062 .. 0.072m)
  const capPts = [
    new THREE.Vector2(0.018, 0),
    new THREE.Vector2(0.0175, 0.005),
    new THREE.Vector2(0.013, 0.009),
    new THREE.Vector2(0, 0.010),
  ];
  const mixerCap = new THREE.Mesh(
    prepGeo(new THREE.LatheGeometry(capPts, 24)),
    mats.primary
  );
  mixerCap.name = `${p}.mixerValve.cartridgeCap`;
  mixerCap.rotation.x = Math.PI * 0.5;
  mixerCap.position.z = 0.062;
  valveGroup.add(mixerCap);

  // Turned industrial single-lever handle pointing right (+X) and gently forward (+Z)
  const handlePivot = new THREE.Group();
  handlePivot.name = `${p}.mixerValve.leverHandle`;
  handlePivot.position.set(0, 0, 0.055);
  handlePivot.rotation.y = -0.22; // angles lever tip slightly forward toward viewer (+Z)
  valveGroup.add(handlePivot);

  const leverBoss = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0065, 0.0075, 0.022, 16)),
    mats.primary
  );
  leverBoss.name = `${p}.mixerValve.leverHandle.stem`;
  leverBoss.rotation.z = -Math.PI * 0.5;
  leverBoss.position.x = 0.022;
  handlePivot.add(leverBoss);

  const leverGrip = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0058, 0.0052, 0.052, 18)),
    mats.primary
  );
  leverGrip.name = `${p}.mixerValve.leverHandle.grip`;
  leverGrip.rotation.z = -Math.PI * 0.5;
  leverGrip.position.x = 0.058;
  handlePivot.add(leverGrip);

  const leverTipKnurl = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0063, 0.0063, 0.010, 18)),
    mats.knurled
  );
  leverTipKnurl.name = `${p}.mixerValve.leverHandle.knurledTip`;
  leverTipKnurl.rotation.z = -Math.PI * 0.5;
  leverTipKnurl.position.x = 0.079 + (opts.tipCapOffsetM ?? 0);
  handlePivot.add(leverTipKnurl);
  attachAssetInteraction(group, {
    kind: 'toggle',
    label: 'Turn On Wall Basin Mixer',
    activeLabel: 'Turn Off Wall Basin Mixer',
    audio: { openPreset: 'tapValveTurn', closePreset: 'tapValveTurn', activeLoopPreset: 'waterTapFlow', volume: 0.65 },
  });
  const fCode = resolveBrasswareCode(opts.finish, 'AB');
  return attachAssetMetadata(finalizeSanitaryGroup(group, 'plumbing'), {
    name: 'Perrin & Rowe Armstrong 2-Hole Wall Basin Mixer',
    brand: 'Perrin & Rowe',
    collection: 'Armstrong',
    sku: `PR-3252-${fCode}`,
    finish: formatBrasswareFinishLabel(opts.finish, 'AB'),
    category: 'brassware',
    dimensionsMm: [220, 215, 95],
    productUrl: 'https://www.perrinandrowe.co.uk/bathroom/armstrong-collection/',
    schematicUrl: 'https://www.perrinandrowe.co.uk/downloads/spec-sheets/PR-3252-Spec.pdf',
  });
}

// ---------------------------------------------------------------------------
// 2. 5664 + 5684 + 5605 + 5640 + 5687 + 5646 Concealed Thermostatic Shower Set
// ---------------------------------------------------------------------------

export function buildArmstrongConcealedShowerSet(
  opts: ArmstrongConcealedShowerSetOptions
): THREE.Group {
  const p = opts.namePrefix;
  const style: PerrinRoweCollectionStyle = opts.style ?? 'armstrong';
  const rawMats = getBathroomBrassMaterials(opts.finish);
  const mats: BathroomMetalMaterialPalette =
    style === 'armstrong'
      ? rawMats
      : { primary: rawMats.primary, knurled: rawMats.primary, darkShadow: rawMats.darkShadow };
  const valveCenterYM = opts.valveCenterYM ?? 1.08;
  const overheadArmYM = opts.overheadArmYM ?? 1.98;
  const overheadArmReachM = opts.overheadArmReachM ?? 0.400;
  const roseDiameterM = opts.roseDiameterM ?? 0.198;
  const slideRailOffsetXM = opts.slideRailOffsetXM ?? 0.26;
  const slideRailCenterYM = opts.slideRailCenterYM ?? 1.28;

  const group = new THREE.Group();
  group.name = p;

  // --- A. 5664 Concealed Thermostatic 2-Way Valve Plate (W90 × H200 × D8mm) ---
  const valvePlateGroup = new THREE.Group();
  valvePlateGroup.name = `${p}.thermostaticValve5664`;
  valvePlateGroup.position.set(0, valveCenterYM, 0);
  group.add(valvePlateGroup);

  const outerPlate = new THREE.Mesh(
    createRoundedRectPlateGeometry(0.090, 0.200, 0.0055, 0.005, 0.0012),
    mats.primary
  );
  outerPlate.name = `${p}.thermostaticValve5664.backplate`;
  valvePlateGroup.add(outerPlate);

  const innerStepPlate = new THREE.Mesh(
    createRoundedRectPlateGeometry(0.076, 0.186, 0.003, 0.0035, 0.0008),
    mats.primary
  );
  innerStepPlate.name = `${p}.thermostaticValve5664.steppedBorder`;
  innerStepPlate.position.z = 0.005;
  valvePlateGroup.add(innerStepPlate);

  // Upper 2-way diverter / flow control at y = +0.052m
  const diverterGroup = new THREE.Group();
  diverterGroup.name = `${p}.thermostaticValve5664.diverterControl`;
  diverterGroup.position.set(0, 0.052, 0.008);
  valvePlateGroup.add(diverterGroup);

  const divCollar = new THREE.Mesh(
    createSteppedCircularRoseGeometry(0.022, 0.015, 0.008),
    mats.primary
  );
  divCollar.name = `${p}.thermostaticValve5664.diverterControl.escutcheon`;
  divCollar.rotation.x = Math.PI * 0.5;
  diverterGroup.add(divCollar);

  const divKnurl = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0165, 0.0165, 0.014, 24)),
    mats.knurled
  );
  divKnurl.name = `${p}.thermostaticValve5664.diverterControl.knurledCollar`;
  divKnurl.rotation.x = Math.PI * 0.5;
  divKnurl.position.z = 0.015;
  diverterGroup.add(divKnurl);

  const divHub = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.014, 0.014, 0.032, 24)),
    mats.primary
  );
  divHub.name = `${p}.thermostaticValve5664.diverterControl.hub`;
  divHub.rotation.x = Math.PI * 0.5;
  divHub.position.z = 0.038;
  diverterGroup.add(divHub);

  // Industrial crosshead / T-bar diverter handle
  const divCrossBar = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0055, 0.0055, 0.068, 18)),
    mats.primary
  );
  divCrossBar.name = `${p}.thermostaticValve5664.diverterControl.crossHandle`;
  divCrossBar.rotation.z = Math.PI * 0.5;
  divCrossBar.position.z = 0.048;
  diverterGroup.add(divCrossBar);

  // Lower thermostatic temperature control at y = -0.048m
  const tempGroup = new THREE.Group();
  tempGroup.name = `${p}.thermostaticValve5664.tempControl`;
  tempGroup.position.set(0, -0.048, 0.008);
  valvePlateGroup.add(tempGroup);

  const tempIndexRing = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.026, 0.026, 0.004, 28)),
    mats.primary
  );
  tempIndexRing.name = `${p}.thermostaticValve5664.tempControl.indexRing`;
  tempIndexRing.rotation.x = Math.PI * 0.5;
  tempIndexRing.position.z = 0.002;
  tempGroup.add(tempIndexRing);

  const tempScaleGroove = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0263, 0.0263, 0.0012, 28)),
    mats.darkShadow
  );
  tempScaleGroove.name = `${p}.thermostaticValve5664.tempControl.calibrationGroove`;
  tempScaleGroove.rotation.x = Math.PI * 0.5;
  tempScaleGroove.position.z = 0.0040;
  tempGroup.add(tempScaleGroove);

  const tempBody = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.021, 0.021, 0.048, 28)),
    mats.primary
  );
  tempBody.name = `${p}.thermostaticValve5664.tempControl.body`;
  tempBody.rotation.x = Math.PI * 0.5;
  tempBody.position.z = 0.028;
  tempGroup.add(tempBody);

  const tempKnurl = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0225, 0.0225, 0.020, 28)),
    mats.knurled
  );
  tempKnurl.name = `${p}.thermostaticValve5664.tempControl.knurledWheel`;
  tempKnurl.rotation.x = Math.PI * 0.5;
  tempKnurl.position.z = 0.036;
  tempGroup.add(tempKnurl);

  const safetyOverride = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0038, 0.0038, 0.008, 14)),
    mats.knurled
  );
  safetyOverride.name = `${p}.thermostaticValve5664.tempControl.overrideStop38C`;
  safetyOverride.position.set(0, 0.023, 0.020);
  tempGroup.add(safetyOverride);

  const tempLever = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0055, 0.0050, 0.056, 18)),
    mats.primary
  );
  tempLever.name = `${p}.thermostaticValve5664.tempControl.leverHandle`;
  tempLever.rotation.z = -Math.PI * 0.5;
  tempLever.position.set(0.042, 0, 0.042);
  tempGroup.add(tempLever);

  // --- B. 5684 400mm Wall Shower Arm + 5605 8" (198mm) Overhead Rainfall Rose ---
  const overheadGroup = new THREE.Group();
  overheadGroup.name = `${p}.overheadShower`;
  group.add(overheadGroup);

  const armFlange = new THREE.Mesh(
    createSteppedCircularRoseGeometry(0.030, 0.016, 0.011),
    mats.primary
  );
  armFlange.name = `${p}.overheadShower.wallFlange`;
  armFlange.rotation.x = Math.PI * 0.5;
  armFlange.position.set(0, overheadArmYM, 0);
  overheadGroup.add(armFlange);

  const armKnurlNut = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.017, 0.017, 0.014, 24)),
    mats.knurled
  );
  armKnurlNut.name = `${p}.overheadShower.knurledWallNut`;
  armKnurlNut.rotation.x = Math.PI * 0.5;
  armKnurlNut.position.set(0, overheadArmYM, 0.018);
  overheadGroup.add(armKnurlNut);

  const armEndY = overheadArmYM - 0.055;
  const armCurve = buildHorizontalToDownwardArmCurve(
    overheadArmYM,
    0.024,
    overheadArmReachM,
    0.050,
    armEndY
  );
  const armTube = new THREE.Mesh(
    prepGeo(new THREE.TubeGeometry(armCurve, 32, 0.011, 20, false)),
    mats.primary
  );
  armTube.name = `${p}.overheadShower.arm5684`;
  overheadGroup.add(armTube);

  // Swivel ball joint & knurled locking collar at (0, armEndY, overheadArmReachM)
  const swivelBall = new THREE.Mesh(
    prepGeo(new THREE.SphereGeometry(0.0145, 20, 14)),
    mats.primary
  );
  swivelBall.name = `${p}.overheadShower.swivelBall`;
  swivelBall.position.set(0, armEndY - 0.006, overheadArmReachM);
  overheadGroup.add(swivelBall);

  const swivelKnurl = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0175, 0.0175, 0.011, 24)),
    mats.knurled
  );
  swivelKnurl.name = `${p}.overheadShower.swivelKnurledCollar`;
  swivelKnurl.position.set(0, armEndY - 0.015, overheadArmReachM);
  overheadGroup.add(swivelKnurl);

  // 5605 Stepped Ø198mm Armstrong Circular Rainfall Rose
  const roseR = roseDiameterM * 0.5;
  const roseBellPts = [
    new THREE.Vector2(roseR - 0.004, 0),
    new THREE.Vector2(roseR, 0.002),
    new THREE.Vector2(roseR, 0.011),
    new THREE.Vector2(roseR * 0.88, 0.014),
    new THREE.Vector2(roseR * 0.86, 0.020),
    new THREE.Vector2(roseR * 0.48, 0.027),
    new THREE.Vector2(0.022, 0.032),
    new THREE.Vector2(0.016, 0.038),
    new THREE.Vector2(0, 0.038),
  ];
  const roseBaseY = armEndY - 0.056;
  const roseDish = new THREE.Mesh(
    prepGeo(new THREE.LatheGeometry(roseBellPts, 40)),
    mats.primary
  );
  roseDish.name = `${p}.overheadShower.rainfallRose5605`;
  roseDish.position.set(0, roseBaseY, overheadArmReachM);
  overheadGroup.add(roseDish);

  const roseKnurlRim = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(roseR + 0.0008, roseR + 0.0008, 0.006, 40, 1, true)),
    mats.knurled
  );
  roseKnurlRim.name = `${p}.overheadShower.roseKnurledRim`;
  roseKnurlRim.position.set(0, roseBaseY + 0.0065, overheadArmReachM);
  overheadGroup.add(roseKnurlRim);

  const roseSprayPlate = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(roseR - 0.006, roseR - 0.006, 0.002, 36)),
    mats.darkShadow
  );
  roseSprayPlate.name = `${p}.overheadShower.sprayPlate`;
  roseSprayPlate.position.set(0, roseBaseY + 0.001, overheadArmReachM);
  overheadGroup.add(roseSprayPlate);

  // --- C. 5640 639mm Slide Rail + 5687 Handshower + 5646 Outlet Elbow + 1.5m Hose ---
  const railKitGroup = new THREE.Group();
  railKitGroup.name = `${p}.slideRailKit`;
  group.add(railKitGroup);

  const railSpanM = 0.639;
  const railZ = 0.062;
  const bracketOffsetFromCenter = railSpanM * 0.5 - 0.020; // finials extend 20mm past bracket centres -> exact 639mm rail

  for (const [tag, dir] of [
    ['topBracket', 1],
    ['bottomBracket', -1],
  ] as const) {
    const by = slideRailCenterYM + dir * bracketOffsetFromCenter;
    const brkRose = new THREE.Mesh(
      createSteppedCircularRoseGeometry(0.025, 0.013, 0.010),
      mats.primary
    );
    brkRose.name = `${p}.slideRailKit.${tag}.wallRose`;
    brkRose.rotation.x = Math.PI * 0.5;
    brkRose.position.set(slideRailOffsetXM, by, 0);
    railKitGroup.add(brkRose);

    const brkKnurl = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.014, 0.014, 0.012, 20)),
      mats.knurled
    );
    brkKnurl.name = `${p}.slideRailKit.${tag}.knurledCollar`;
    brkKnurl.rotation.x = Math.PI * 0.5;
    brkKnurl.position.set(slideRailOffsetXM, by, 0.016);
    railKitGroup.add(brkKnurl);

    const brkPost = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.0105, 0.0105, railZ - 0.020, 20)),
      mats.primary
    );
    brkPost.name = `${p}.slideRailKit.${tag}.standoff`;
    brkPost.rotation.x = Math.PI * 0.5;
    brkPost.position.set(slideRailOffsetXM, by, 0.022 + (railZ - 0.020) * 0.5);
    railKitGroup.add(brkPost);

    const brkClamp = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.0135, 0.0135, 0.026, 20)),
      mats.primary
    );
    brkClamp.name = `${p}.slideRailKit.${tag}.railBoss`;
    brkClamp.position.set(slideRailOffsetXM, by, railZ);
    railKitGroup.add(brkClamp);
  }

  // Ø18mm × 639mm vertical slide rail tube
  const slideRailTube = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.009, 0.009, railSpanM, 22)),
    mats.primary
  );
  slideRailTube.name = `${p}.slideRailKit.rail5640`;
  slideRailTube.position.set(slideRailOffsetXM, slideRailCenterYM, railZ);
  railKitGroup.add(slideRailTube);

  // Machined sliding parking bracket + knurled locking wheel
  const sliderY = slideRailCenterYM + 0.045;
  const sliderBody = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0145, 0.0145, 0.038, 22)),
    mats.primary
  );
  sliderBody.name = `${p}.slideRailKit.sliderClamp`;
  sliderBody.position.set(slideRailOffsetXM, sliderY, railZ);
  railKitGroup.add(sliderBody);

  const sliderWheel = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.015, 0.015, 0.014, 22)),
    mats.knurled
  );
  sliderWheel.name = `${p}.slideRailKit.sliderKnurledWheel`;
  sliderWheel.rotation.z = Math.PI * 0.5;
  sliderWheel.position.set(slideRailOffsetXM - 0.022, sliderY, railZ);
  railKitGroup.add(sliderWheel);

  const cradleSocket = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.016, 0.0135, 0.032, 20)),
    mats.primary
  );
  cradleSocket.name = `${p}.slideRailKit.parkingCradle`;
  cradleSocket.position.set(slideRailOffsetXM + 0.030, sliderY, railZ + 0.018);
  cradleSocket.rotation.x = 0.24;
  railKitGroup.add(cradleSocket);

  // 5687 Cylindrical Handshower Wand parked in cradle
  const wandBasePos = new THREE.Vector3(
    slideRailOffsetXM + 0.030,
    sliderY - 0.024,
    railZ + 0.012
  );
  const handWand = buildArmstrongHandshowerWand5687(`${p}.slideRailKit.handwand5687`, mats);
  handWand.position.copy(wandBasePos);
  handWand.rotation.x = 0.24;
  railKitGroup.add(handWand);

  // 5646 Wall Outlet Elbow (between 5664 valve and 5640 slide rail)
  const outletX = slideRailOffsetXM * 0.58;
  const outletY = Math.max(0.55, slideRailCenterYM - 0.32);
  const outletRose = new THREE.Mesh(
    createSteppedCircularRoseGeometry(0.025, 0.014, 0.010),
    mats.primary
  );
  outletRose.name = `${p}.slideRailKit.outletElbow5646.wallRose`;
  outletRose.rotation.x = Math.PI * 0.5;
  outletRose.position.set(outletX, outletY, 0);
  railKitGroup.add(outletRose);

  const outletBody = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.014, 0.014, 0.038, 20)),
    mats.primary
  );
  outletBody.name = `${p}.slideRailKit.outletElbow5646.body`;
  outletBody.rotation.x = Math.PI * 0.5;
  outletBody.position.set(outletX, outletY, 0.028);
  railKitGroup.add(outletBody);

  const outletDownNut = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.011, 0.010, 0.018, 20)),
    mats.knurled
  );
  outletDownNut.name = `${p}.slideRailKit.outletElbow5646.knurledHoseNut`;
  outletDownNut.position.set(outletX, outletY - 0.018, 0.036);
  railKitGroup.add(outletDownNut);

  // Smooth 1.5m catenary flexible metal shower hose linking 5646 outlet -> 5687 wand union
  const sagY = Math.max(0.28, Math.min(outletY, wandBasePos.y) - 0.26);
  const midX = (outletX + wandBasePos.x) * 0.5;
  const hoseCurve = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(outletX, outletY - 0.026, 0.036),
      new THREE.Vector3(outletX + (midX - outletX) * 0.35, (outletY + sagY) * 0.5, 0.048),
      new THREE.Vector3(midX, sagY, 0.068),
      new THREE.Vector3(wandBasePos.x - (wandBasePos.x - midX) * 0.32, (wandBasePos.y + sagY) * 0.5, 0.078),
      wandBasePos.clone(),
    ],
    false,
    'centripetal'
  );
  const hoseMesh = new THREE.Mesh(
    prepGeo(new THREE.TubeGeometry(hoseCurve, 36, 0.0072, 14, false)),
    mats.knurled
  );
  hoseMesh.name = `${p}.slideRailKit.flexibleShowerHose`;
  railKitGroup.add(hoseMesh);
  attachAssetInteraction(group, {
    kind: 'toggle',
    label: 'Turn On Armstrong Thermostatic Shower',
    activeLabel: 'Turn Off Armstrong Shower',
    audio: { openPreset: 'tapValveTurn', closePreset: 'tapValveTurn', activeLoopPreset: 'waterTapFlow', volume: 0.72 },
  });
  const fCode = resolveBrasswareCode(opts.finish, 'AB');
  return attachAssetMetadata(finalizeSanitaryGroup(group, 'sanitary'), {
    name: 'Perrin & Rowe Armstrong Concealed Thermostatic Rainfall Shower Set',
    brand: 'Perrin & Rowe',
    collection: 'Armstrong',
    sku: `PR-5268-${fCode}`,
    finish: formatBrasswareFinishLabel(opts.finish, 'AB'),
    category: 'brassware',
    dimensionsMm: [280, 480, 1150],
    productUrl: 'https://www.perrinandrowe.co.uk/bathroom/showers/armstrong-showers/',
    schematicUrl: 'https://www.perrinandrowe.co.uk/downloads/spec-sheets/PR-5268-Spec.pdf',
  });
}

// ---------------------------------------------------------------------------
// 3. 3660 Freestanding Bath-Shower Mixer (with Floor Shroud & 5687 Handshower)
// ---------------------------------------------------------------------------

export function buildArmstrongFreestandingBathMixer(
  opts: ArmstrongFreestandingBathMixerOptions
): THREE.Group {
  const p = opts.namePrefix;
  const style: PerrinRoweCollectionStyle = opts.style ?? 'armstrong';
  const mats = getBathroomBrassMaterials(opts.finish);
  const overallHeightM = opts.overallHeightM ?? 0.958;
  const spoutOutletHeightM = opts.spoutOutletHeightM ?? 0.827;
  const spoutReachM = opts.spoutReachM ?? 0.210;

  if (style === 'traditional') {
    const chinaMat = getVitreousChinaMaterial();
    const group = new THREE.Group();
    group.name = p;

    const legHalfSpread = 0.090; // 180mm c/c twin standpipe legs (3520/1BR)
    const bridgeY = spoutOutletHeightM - 0.035;

    for (const [legTag, signX] of [
      ['leftStandpipeLeg', -1],
      ['rightStandpipeLeg', 1],
    ] as const) {
      const lx = signX * legHalfSpread;
      const shroudPts = [
        new THREE.Vector2(0.046, 0),
        new THREE.Vector2(0.046, 0.008),
        new THREE.Vector2(0.036, 0.015),
        new THREE.Vector2(0.024, 0.028),
        new THREE.Vector2(0.016, 0.034),
      ];
      const shroud = new THREE.Mesh(prepGeo(new THREE.LatheGeometry(shroudPts, 28)), mats.primary);
      shroud.name = `${p}.${legTag}.floorShroud`;
      shroud.position.set(lx, 0, 0);
      group.add(shroud);

      const legH = bridgeY - 0.032;
      const legTube = new THREE.Mesh(
        prepGeo(new THREE.CylinderGeometry(0.015, 0.015, legH, 24)),
        mats.primary
      );
      legTube.name = `${p}.${legTag}.column`;
      legTube.position.set(lx, 0.032 + legH * 0.5, 0);
      group.add(legTube);

      const midRing = new THREE.Mesh(
        prepGeo(new THREE.TorusGeometry(0.0185, 0.004, 12, 24)),
        mats.primary
      );
      midRing.name = `${p}.${legTag}.balusterRing`;
      midRing.rotation.x = Math.PI * 0.5;
      midRing.position.set(lx, bridgeY * 0.52, 0);
      group.add(midRing);

      // Union nut + valve turret + white porcelain lever handle
      const union = new THREE.Mesh(
        prepGeo(new THREE.CylinderGeometry(0.022, 0.022, 0.024, 24)),
        mats.primary
      );
      union.name = `${p}.${legTag}.bridgeUnion`;
      union.position.set(lx, bridgeY, 0);
      group.add(union);

      const turret = new THREE.Mesh(
        prepGeo(new THREE.CylinderGeometry(0.016, 0.019, 0.048, 22)),
        mats.primary
      );
      turret.name = `${p}.${legTag}.valveBonnet`;
      turret.position.set(lx, bridgeY + 0.034, 0);
      group.add(turret);

      const leverBoss = new THREE.Mesh(
        prepGeo(new THREE.SphereGeometry(0.014, 16, 12)),
        mats.primary
      );
      leverBoss.name = `${p}.${legTag}.leverHub`;
      leverBoss.position.set(lx, bridgeY + 0.064, 0);
      group.add(leverBoss);

      const indexCap = new THREE.Mesh(
        prepGeo(new THREE.CylinderGeometry(0.008, 0.008, 0.004, 16)),
        chinaMat
      );
      indexCap.name = `${p}.${legTag}.porcelainIndex`;
      indexCap.position.set(lx, bridgeY + 0.077, 0);
      group.add(indexCap);

      // Outward white porcelain baluster lever handle
      const stem = new THREE.Mesh(
        prepGeo(new THREE.CylinderGeometry(0.005, 0.006, 0.022, 14)),
        mats.primary
      );
      stem.name = `${p}.${legTag}.leverStem`;
      stem.rotation.z = -signX * Math.PI * 0.5;
      stem.position.set(lx + signX * 0.018, bridgeY + 0.064, 0);
      group.add(stem);

      const porcPts = [
        new THREE.Vector2(0.0055, 0),
        new THREE.Vector2(0.0105, 0.010),
        new THREE.Vector2(0.0115, 0.032),
        new THREE.Vector2(0.0095, 0.048),
        new THREE.Vector2(0.0060, 0.054),
      ];
      const porcGrip = new THREE.Mesh(prepGeo(new THREE.LatheGeometry(porcPts, 20)), chinaMat);
      porcGrip.name = `${p}.${legTag}.porcelainLever`;
      porcGrip.rotation.z = -signX * Math.PI * 0.5;
      porcGrip.position.set(lx + signX * 0.028, bridgeY + 0.064, 0);
      group.add(porcGrip);

      const endPip = new THREE.Mesh(
        prepGeo(new THREE.SphereGeometry(0.006, 12, 10)),
        mats.primary
      );
      endPip.name = `${p}.${legTag}.leverFinial`;
      endPip.position.set(lx + signX * 0.084, bridgeY + 0.064, 0);
      group.add(endPip);
    }

    // Horizontal bridge crossbar & central diverter turret + telephone cradle
    const bridgeBar = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.017, 0.017, legHalfSpread * 2, 24)),
      mats.primary
    );
    bridgeBar.name = `${p}.bridgeCrossbar`;
    bridgeBar.rotation.z = Math.PI * 0.5;
    bridgeBar.position.set(0, bridgeY, 0);
    group.add(bridgeBar);

    const centerBody = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.024, 0.024, 0.056, 26)),
      mats.primary
    );
    centerBody.name = `${p}.centreDiverterBody`;
    centerBody.position.set(0, bridgeY + 0.014, 0);
    group.add(centerBody);

    // Porcelain-tipped diverter lever in front
    const divPorc = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.007, 0.0055, 0.036, 16)),
      chinaMat
    );
    divPorc.name = `${p}.diverterPorcelainLever`;
    divPorc.rotation.x = Math.PI * 0.5;
    divPorc.position.set(0, bridgeY + 0.018, 0.042);
    group.add(divPorc);

    // Rising cradle post + traditional telephone handshower resting horizontally across forks
    const cradlePostH = Math.max(0.08, overallHeightM - 0.045 - (bridgeY + 0.042));
    const cradlePost = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.009, 0.011, cradlePostH, 18)),
      mats.primary
    );
    cradlePost.name = `${p}.cradleRiserPost`;
    cradlePost.position.set(0, bridgeY + 0.042 + cradlePostH * 0.5, -0.008);
    group.add(cradlePost);

    const cradleY = overallHeightM - 0.042;
    const cradleCross = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.007, 0.007, 0.11, 16)),
      mats.primary
    );
    cradleCross.name = `${p}.cradleYoke`;
    cradleCross.rotation.z = Math.PI * 0.5;
    cradleCross.position.set(0, cradleY, -0.008);
    group.add(cradleCross);

    for (const [fTag, fx] of [
      ['leftCradleFork', -0.052],
      ['rightCradleFork', 0.052],
    ] as const) {
      const fork = new THREE.Mesh(
        prepGeo(new THREE.TorusGeometry(0.018, 0.0045, 10, 18, Math.PI)),
        mats.primary
      );
      fork.name = `${p}.${fTag}`;
      fork.rotation.z = Math.PI;
      fork.position.set(fx, cradleY + 0.016, -0.008);
      group.add(fork);
    }

    // Traditional porcelain-grip telephone handshower resting across cradle
    const wand = buildArmstrongHandshowerWand5687(`${p}.traditionalHandshower`, mats, 'traditional');
    wand.rotation.z = -Math.PI * 0.5;
    wand.position.set(-0.098, cradleY + 0.022, -0.008);
    group.add(wand);

    // Flexible hose loop from beneath bridge body up to left end of cradled handshower
    const hoseCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, bridgeY - 0.022, -0.010),
      new THREE.Vector3(-0.045, bridgeY - 0.145, -0.024),
      new THREE.Vector3(-0.095, bridgeY - 0.080, -0.020),
      new THREE.Vector3(-0.098, cradleY + 0.022, -0.008),
    ]);
    const hoseMesh = new THREE.Mesh(
      prepGeo(new THREE.TubeGeometry(hoseCurve, 28, 0.007, 14, false)),
      mats.primary
    );
    hoseMesh.name = `${p}.handshowerHose`;
    group.add(hoseMesh);

    // Sweeping Edwardian swan-neck bath spout reaching spoutReachM (0.210m) at spoutOutletHeightM (0.827m)
    const spoutPts = [
      new THREE.Vector3(0, bridgeY, 0.016),
      new THREE.Vector3(0, bridgeY + 0.055, 0.065),
      new THREE.Vector3(0, bridgeY + 0.095, spoutReachM * 0.62),
      new THREE.Vector3(0, spoutOutletHeightM + 0.038, spoutReachM * 0.94),
      new THREE.Vector3(0, spoutOutletHeightM, spoutReachM),
    ];
    const spoutCurve = new THREE.CatmullRomCurve3(spoutPts, false, 'centripetal');
    const spoutTube = new THREE.Mesh(
      prepGeo(new THREE.TubeGeometry(spoutCurve, 32, 0.014, 20, false)),
      mats.primary
    );
    spoutTube.name = `${p}.swanNeckBathSpout`;
    group.add(spoutTube);

    const spoutBell = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.016, 0.021, 0.016, 24)),
      mats.primary
    );
    spoutBell.name = `${p}.spoutBellNozzle`;
    spoutBell.position.set(0, spoutOutletHeightM - 0.004, spoutReachM);
    group.add(spoutBell);

    return finalizeSanitaryGroup(group, 'plumbing');
  }

  const group = new THREE.Group();
  group.name = p;

  // Stepped Ø130mm floor mounting shroud concealing 3440R manifold (y = 0 .. 0.028m)
  const basePts = [
    new THREE.Vector2(0.065, 0),
    new THREE.Vector2(0.065, 0.008),
    new THREE.Vector2(0.056, 0.012),
    new THREE.Vector2(0.054, 0.020),
    new THREE.Vector2(0.034, 0.028),
    new THREE.Vector2(0.021, 0.028),
  ];
  const floorFlange = new THREE.Mesh(
    prepGeo(new THREE.LatheGeometry(basePts, 36)),
    mats.primary
  );
  floorFlange.name = `${p}.floorManifoldFlange`;
  group.add(floorFlange);

  // Knurled base collar ring (y = 0.028 .. 0.046m)
  const baseKnurl = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.032, 0.032, 0.018, 28)),
    mats.knurled
  );
  baseKnurl.name = `${p}.baseKnurledCollar`;
  baseKnurl.position.y = 0.037;
  group.add(baseKnurl);

  // Stout Ø42mm vertical standpipe column rising to mixer valve body
  const valveBottomY = Math.max(0.68, spoutOutletHeightM - 0.055);
  const standpipeH = valveBottomY - 0.046;
  const standpipe = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.021, 0.021, standpipeH, 28)),
    mats.primary
  );
  standpipe.name = `${p}.standpipeColumn`;
  standpipe.position.y = 0.046 + standpipeH * 0.5;
  group.add(standpipe);

  // Lower knurled collar framing mixer valve body
  const lowerValveKnurl = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0255, 0.0255, 0.014, 28)),
    mats.knurled
  );
  lowerValveKnurl.name = `${p}.valveLowerKnurledCollar`;
  lowerValveKnurl.position.y = valveBottomY + 0.007;
  group.add(lowerValveKnurl);

  // Upper Ø48mm cylindrical mixer valve body
  const valveTopY = Math.max(valveBottomY + 0.11, overallHeightM - 0.056);
  const valveBodyH = valveTopY - (valveBottomY + 0.014);
  const valveBody = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.024, 0.024, valveBodyH, 28)),
    mats.primary
  );
  valveBody.name = `${p}.mixerValveBody`;
  valveBody.position.y = valveBottomY + 0.014 + valveBodyH * 0.5;
  group.add(valveBody);

  // Upper knurled bezel + domed valve cap
  const upperValveKnurl = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0255, 0.0255, 0.012, 28)),
    mats.knurled
  );
  upperValveKnurl.name = `${p}.valveUpperKnurledCollar`;
  upperValveKnurl.position.y = valveTopY + 0.006;
  group.add(upperValveKnurl);

  const domeCap = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.021, 0.024, 0.016, 28)),
    mats.primary
  );
  domeCap.name = `${p}.valveDomeCap`;
  domeCap.position.y = valveTopY + 0.020;
  group.add(domeCap);

  // Single-lever mixer handle rising to exact overallHeightM (0.958m)
  const capTopY = valveTopY + 0.028;
  const leverCurve = new THREE.LineCurve3(
    new THREE.Vector3(0.006, capTopY - 0.006, 0),
    new THREE.Vector3(0.052, overallHeightM - 0.0055, 0.012)
  );
  const leverStick = new THREE.Mesh(
    prepGeo(new THREE.TubeGeometry(leverCurve, 8, 0.0055, 16, false)),
    mats.primary
  );
  leverStick.name = `${p}.mixerLeverHandle`;
  group.add(leverStick);

  const leverTip = new THREE.Mesh(
    prepGeo(new THREE.SphereGeometry(0.0055, 14, 10)),
    mats.knurled
  );
  leverTip.name = `${p}.mixerLeverTip`;
  leverTip.position.set(0.052, overallHeightM - 0.0055, 0.012);
  group.add(leverTip);

  // Push/pull knurled bath-shower diverter knob on rear/side of valve body
  const diverterStem = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.006, 0.006, 0.020, 16)),
    mats.primary
  );
  diverterStem.name = `${p}.diverterStem`;
  diverterStem.rotation.x = -Math.PI * 0.5;
  diverterStem.position.set(0, spoutOutletHeightM + 0.005, -0.028);
  group.add(diverterStem);

  const diverterKnob = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 20)),
    mats.knurled
  );
  diverterKnob.name = `${p}.diverterKnurledKnob`;
  diverterKnob.rotation.x = -Math.PI * 0.5;
  diverterKnob.position.set(0, spoutOutletHeightM + 0.005, -0.041);
  group.add(diverterKnob);

  // Bath Spout reaching spoutReachM (0.210m) along +Z with outlet at spoutOutletHeightM (0.827m)
  const spoutBossY = spoutOutletHeightM + 0.048;
  const spoutBoss = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.017, 0.017, 0.014, 24)),
    mats.knurled
  );
  spoutBoss.name = `${p}.spoutKnurledBoss`;
  spoutBoss.rotation.x = Math.PI * 0.5;
  spoutBoss.position.set(0, spoutBossY, 0.026);
  group.add(spoutBoss);

  const spoutCurve = buildHorizontalToDownwardArmCurve(
    spoutBossY,
    0.030,
    spoutReachM,
    0.040,
    spoutOutletHeightM + 0.012
  );
  const spoutTube = new THREE.Mesh(
    prepGeo(new THREE.TubeGeometry(spoutCurve, 30, 0.013, 20, false)),
    mats.primary
  );
  spoutTube.name = `${p}.bathSpout`;
  group.add(spoutTube);

  const spoutNozzle = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.015, 0.0145, 0.012, 24)),
    mats.knurled
  );
  spoutNozzle.name = `${p}.bathSpoutNozzle`;
  spoutNozzle.position.set(0, spoutOutletHeightM + 0.006, spoutReachM);
  group.add(spoutNozzle);

  const spoutAerator = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.011, 0.011, 0.002, 20)),
    mats.darkShadow
  );
  spoutAerator.name = `${p}.bathSpoutAerator`;
  spoutAerator.position.set(0, spoutOutletHeightM + 0.001, spoutReachM);
  group.add(spoutAerator);

  // Side Handshower Parking Cradle & 5687 Handshower + Catenary Hose on +X
  const cradleY = spoutOutletHeightM - 0.062;
  const cradleArm = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.009, 0.009, 0.056, 18)),
    mats.primary
  );
  cradleArm.name = `${p}.handshowerCradleArm`;
  cradleArm.rotation.z = Math.PI * 0.5;
  cradleArm.position.set(0.046, cradleY, 0);
  group.add(cradleArm);

  const cradleHolder = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0165, 0.014, 0.032, 20)),
    mats.knurled
  );
  cradleHolder.name = `${p}.handshowerCradleCup`;
  cradleHolder.position.set(0.074, cradleY + 0.004, 0);
  cradleHolder.rotation.x = 0.14;
  group.add(cradleHolder);

  const wandUnionPos = new THREE.Vector3(0.074, cradleY - 0.022, -0.003);
  const bathWand = buildArmstrongHandshowerWand5687(`${p}.handwand5687`, mats);
  bathWand.position.copy(wandUnionPos);
  bathWand.rotation.x = 0.14;
  group.add(bathWand);

  // Underside hose outlet union & catenary hose loop
  const hoseStart = new THREE.Vector3(0.026, cradleY - 0.042, -0.004);
  const hoseLoopLowY = Math.max(0.28, cradleY - 0.36);
  const bathHoseCurve = new THREE.CatmullRomCurve3(
    [
      hoseStart,
      new THREE.Vector3(0.034, (cradleY + hoseLoopLowY) * 0.5, 0.012),
      new THREE.Vector3(0.055, hoseLoopLowY, 0.018),
      new THREE.Vector3(0.076, (cradleY + hoseLoopLowY) * 0.5, 0.008),
      wandUnionPos,
    ],
    false,
    'centripetal'
  );
  const bathHose = new THREE.Mesh(
    prepGeo(new THREE.TubeGeometry(bathHoseCurve, 34, 0.0072, 14, false)),
    mats.knurled
  );
  bathHose.name = `${p}.flexibleShowerHose`;
  group.add(bathHose);
  attachAssetInteraction(group, {
    kind: 'toggle',
    label: 'Turn On Bath Filler',
    activeLabel: 'Turn Off Bath Filler',
    audio: { openPreset: 'tapValveTurn', closePreset: 'tapValveTurn', activeLoopPreset: 'waterTapFlow', volume: 0.72 },
  });
  const fCode = resolveBrasswareCode(opts.finish, 'AB');
  return attachAssetMetadata(finalizeSanitaryGroup(group, 'plumbing'), {
    name: 'Perrin & Rowe Armstrong Floor-Standing Bath & Shower Mixer',
    brand: 'Perrin & Rowe',
    collection: 'Armstrong',
    sku: `PR-3288-${fCode}`,
    finish: formatBrasswareFinishLabel(opts.finish, 'AB'),
    category: 'brassware',
    dimensionsMm: [240, 290, 960],
    productUrl: 'https://www.perrinandrowe.co.uk/bathroom/bath-taps/armstrong-bath-shower-mixer/',
    schematicUrl: 'https://www.perrinandrowe.co.uk/downloads/spec-sheets/PR-3288-Spec.pdf',
  });
}

// ---------------------------------------------------------------------------
// 4. 6221 Robe Hook (W53 × H46 × D46mm)
// ---------------------------------------------------------------------------

export function buildArmstrongRobeHook(opts: ArmstrongRobeHookOptions): THREE.Group {
  const p = opts.namePrefix;
  const style: PerrinRoweCollectionStyle = opts.style ?? 'armstrong';
  const rawMats = getBathroomBrassMaterials(opts.finish);
  const mats: BathroomMetalMaterialPalette =
    style === 'armstrong'
      ? rawMats
      : { primary: rawMats.primary, knurled: rawMats.primary, darkShadow: rawMats.darkShadow };

  if (style !== 'armstrong') {
    const group = new THREE.Group();
    group.name = p;
    const rose = new THREE.Mesh(
      createSteppedCircularRoseGeometry(style === 'traditional' ? 0.027 : 0.025, 0.011, 0.011),
      mats.primary
    );
    rose.name = `${p}.wallRose`;
    rose.rotation.x = Math.PI * 0.5;
    group.add(rose);

    const stem = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.007, 0.0085, 0.032, 20)),
      mats.primary
    );
    stem.name = `${p}.hookStem`;
    stem.rotation.x = Math.PI * 0.5;
    stem.position.z = 0.024;
    group.add(stem);

    if (style === 'traditional') {
      const hookArc = new THREE.Mesh(
        prepGeo(new THREE.TorusGeometry(0.014, 0.0048, 12, 20, Math.PI * 0.85)),
        mats.primary
      );
      hookArc.name = `${p}.curvedHookProng`;
      hookArc.rotation.y = Math.PI * 0.5;
      hookArc.position.set(0, 0.012, 0.038);
      group.add(hookArc);

      const ballTip = new THREE.Mesh(
        prepGeo(new THREE.SphereGeometry(0.0068, 14, 12)),
        mats.primary
      );
      ballTip.name = `${p}.ballFinial`;
      ballTip.position.set(0, 0.025, 0.044);
      group.add(ballTip);
    } else {
      const disc = new THREE.Mesh(
        prepGeo(new THREE.CylinderGeometry(0.014, 0.014, 0.006, 24)),
        mats.primary
      );
      disc.name = `${p}.retentionDisc`;
      disc.rotation.x = Math.PI * 0.5;
      disc.position.z = 0.042;
      group.add(disc);
    }
    return finalizeSanitaryGroup(group, 'sanitary');
  }

  const group = new THREE.Group();
  group.name = p;

  // Stepped stadium backplate: exact W53mm × H46mm, z = 0 .. 0.007m
  const backplate = new THREE.Mesh(
    createRoundedRectPlateGeometry(0.053, 0.046, 0.007, 0.018, 0.001),
    mats.primary
  );
  backplate.name = `${p}.wallBackplate`;
  group.add(backplate);

  // Inner stepped boss plate (z = 0.007 .. 0.0095m)
  const stepPlate = new THREE.Mesh(
    createRoundedRectPlateGeometry(0.041, 0.034, 0.003, 0.013, 0.0006),
    mats.primary
  );
  stepPlate.name = `${p}.steppedEscutcheon`;
  stepPlate.position.z = 0.0068;
  group.add(stepPlate);

  // Fine knurled collar ring (Ø24mm, z = 0.0095 .. 0.0175m)
  const knurledRing = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.012, 0.012, 0.008, 24)),
    mats.knurled
  );
  knurledRing.name = `${p}.knurledCollar`;
  knurledRing.rotation.x = Math.PI * 0.5;
  knurledRing.position.z = 0.0135;
  group.add(knurledRing);

  // Cylindrical horizontal boss stem (Ø15mm, z = 0.0175 .. 0.040m)
  const stem = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0075, 0.0075, 0.0225, 22)),
    mats.primary
  );
  stem.name = `${p}.hookStem`;
  stem.rotation.x = Math.PI * 0.5;
  stem.position.z = 0.02875;
  group.add(stem);

  // Machined retention cap disc + upturned top lip reaching exact D46mm (z = 0.046m)
  const frontDisc = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0145, 0.0145, 0.006, 26)),
    mats.primary
  );
  frontDisc.name = `${p}.retentionDisc`;
  frontDisc.rotation.x = Math.PI * 0.5;
  frontDisc.position.z = 0.043;
  group.add(frontDisc);

  const upturnedPeg = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0045, 0.0055, 0.012, 16)),
    mats.knurled
  );
  upturnedPeg.name = `${p}.retentionPeg`;
  upturnedPeg.position.set(0, 0.014, 0.039);
  group.add(upturnedPeg);

  return finalizeSanitaryGroup(group, 'sanitary');
}

// ---------------------------------------------------------------------------
// 5. 6258 Paper Holder (W147 × H98 × D46mm bracket + optional ivory roll)
// ---------------------------------------------------------------------------

export function buildArmstrongPaperHolder(
  opts: ArmstrongPaperHolderOptions
): THREE.Group {
  const p = opts.namePrefix;
  const style: PerrinRoweCollectionStyle = opts.style ?? 'armstrong';
  const rawMats = getBathroomBrassMaterials(opts.finish);
  const mats: BathroomMetalMaterialPalette =
    style === 'armstrong'
      ? rawMats
      : { primary: rawMats.primary, knurled: rawMats.primary, darkShadow: rawMats.darkShadow };
  const includeRoll = opts.includePaperRoll !== false;

  const group = new THREE.Group();
  group.name = p;

  // Left mounting rose centered at x = -0.0475m (Ø52mm -> left edge -0.0735m)
  // Roll bar reaches x = +0.0735m -> exact 147mm metal span centered on x = 0!
  // Rose top at y = +0.023 + 0.026 = +0.049m; drop arm reaches y = -0.022m (98mm envelope with roll/arm).
  const postX = -0.0475;
  const roseY = 0.023;
  const barY = -0.018;
  const barZ = 0.068; // clears Ø110mm tissue roll (radius 0.055m) from z = 0 wall by 13mm!

  const wallRose = new THREE.Mesh(
    createSteppedCircularRoseGeometry(0.026, 0.014, 0.010),
    mats.primary
  );
  wallRose.name = `${p}.wallRose`;
  wallRose.rotation.x = Math.PI * 0.5;
  wallRose.position.set(postX, roseY, 0);
  group.add(wallRose);

  const knurledBoss = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.014, 0.014, 0.012, 24)),
    mats.knurled
  );
  knurledBoss.name = `${p}.knurledWallBoss`;
  knurledBoss.rotation.x = Math.PI * 0.5;
  knurledBoss.position.set(postX, roseY, 0.016);
  group.add(knurledBoss);

  // Horizontal standoff post along +Z (z = 0.022 .. barZ)
  const postLen = barZ - 0.022;
  const wallPost = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0085, 0.0085, postLen, 20)),
    mats.primary
  );
  wallPost.name = `${p}.standoffPost`;
  wallPost.rotation.x = Math.PI * 0.5;
  wallPost.position.set(postX, roseY, 0.022 + postLen * 0.5);
  group.add(wallPost);

  // Corner joint & vertical drop link down to barY (-0.018m) so holder frame has authentic 98mm drop
  const topJoint = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0105, 0.0105, 0.018, 20)),
    mats.primary
  );
  topJoint.name = `${p}.pivotJoint`;
  topJoint.rotation.z = Math.PI * 0.5;
  topJoint.position.set(postX, roseY, barZ);
  group.add(topJoint);

  const dropH = roseY - barY;
  const dropLink = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0075, 0.0075, dropH + 0.012, 18)),
    mats.primary
  );
  dropLink.name = `${p}.dropArm`;
  dropLink.position.set(postX, (roseY + barY) * 0.5, barZ);
  group.add(dropLink);

  // Horizontal cylindrical roll bar spanning x = -0.0475 .. +0.0685m + finial to +0.0735m (147mm total width)
  const barStartX = postX - 0.004;
  const barEndX = 0.0675;
  const barLen = barEndX - barStartX;
  const rollBar = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0075, 0.0075, barLen, 20)),
    mats.primary
  );
  rollBar.name = `${p}.holderBar`;
  rollBar.rotation.z = Math.PI * 0.5;
  rollBar.position.set((barStartX + barEndX) * 0.5, barY, barZ);
  group.add(rollBar);

  // Right-hand retention finial cap — or second wall post on 6960BR Traditional pivot holder!
  if (style === 'traditional') {
    const rightPostX = 0.0685;
    const rightRose = new THREE.Mesh(
      createSteppedCircularRoseGeometry(0.026, 0.014, 0.010),
      mats.primary
    );
    rightRose.name = `${p}.rightWallRose`;
    rightRose.rotation.x = Math.PI * 0.5;
    rightRose.position.set(rightPostX, roseY, 0);
    group.add(rightRose);

    const rightPost = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.0085, 0.0085, postLen + 0.012, 20)),
      mats.primary
    );
    rightPost.name = `${p}.rightStandoffPost`;
    rightPost.rotation.x = Math.PI * 0.5;
    rightPost.position.set(rightPostX, roseY, 0.010 + (postLen + 0.012) * 0.5);
    group.add(rightPost);

    const rightDrop = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.0075, 0.0075, dropH + 0.012, 18)),
      mats.primary
    );
    rightDrop.name = `${p}.rightPivotArm`;
    rightDrop.position.set(rightPostX, (roseY + barY) * 0.5, barZ);
    group.add(rightDrop);

    const rightBall = new THREE.Mesh(
      prepGeo(new THREE.SphereGeometry(0.011, 16, 12)),
      mats.primary
    );
    rightBall.name = `${p}.pivotFinial`;
    rightBall.position.set(rightPostX, barY, barZ);
    group.add(rightBall);
  } else {
    const endFinial = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.0125, 0.0125, 0.006, 22)),
      mats.knurled
    );
    endFinial.name = `${p}.retentionFinial`;
    endFinial.rotation.z = Math.PI * 0.5;
    endFinial.position.set(0.0705, barY, barZ);
    group.add(endFinial);
  }

  if (includeRoll) {
    // Hollow Ø110mm × W105mm ivory toilet tissue roll + inner cardboard core
    const rollWidth = 0.105;
    const outerR = 0.055;
    const innerR = 0.0205;
    const rollCenterX = 0.011;

    const rollPts = [
      new THREE.Vector2(innerR, -rollWidth * 0.5),
      new THREE.Vector2(outerR, -rollWidth * 0.5),
      new THREE.Vector2(outerR, rollWidth * 0.5),
      new THREE.Vector2(innerR, rollWidth * 0.5),
      new THREE.Vector2(innerR, -rollWidth * 0.5),
    ];
    const rollMesh = new THREE.Mesh(
      prepGeo(new THREE.LatheGeometry(rollPts, 36)),
      getTissuePaperMaterial()
    );
    rollMesh.name = `${p}.tissueRoll`;
    rollMesh.rotation.z = Math.PI * 0.5;
    rollMesh.position.set(rollCenterX, barY, barZ);
    group.add(rollMesh);

    const coreOuterR = innerR - (opts.coreClearanceM ?? 0);
    const corePts = [
      new THREE.Vector2(0.0185, -rollWidth * 0.5 - 0.001),
      new THREE.Vector2(coreOuterR, -rollWidth * 0.5 - 0.001),
      new THREE.Vector2(coreOuterR, rollWidth * 0.5 + 0.001),
      new THREE.Vector2(0.0185, rollWidth * 0.5 + 0.001),
      new THREE.Vector2(0.0185, -rollWidth * 0.5 - 0.001),
    ];
    const coreMesh = new THREE.Mesh(
      prepGeo(new THREE.LatheGeometry(corePts, 28)),
      getCardboardCoreMaterial()
    );
    coreMesh.name = `${p}.cardboardCore`;
    coreMesh.rotation.z = Math.PI * 0.5;
    coreMesh.position.set(rollCenterX, barY, barZ);
    group.add(coreMesh);

    // Subtle hanging front tissue sheet drape
    const tailShape = new THREE.PlaneGeometry(rollWidth - 0.001, 0.044, 1, 6);
    const posAttr = tailShape.attributes['position'] as THREE.BufferAttribute;
    for (let i = 0; i < posAttr.count; i++) {
      const ly = posAttr.getY(i); // -0.022 .. +0.022
      const t = (0.022 - ly) / 0.044; // 0 at top tangent, 1 at bottom edge
      posAttr.setY(i, -t * 0.044);
      posAttr.setZ(i, Math.sin(t * Math.PI) * 0.0025);
    }
    tailShape.computeVertexNormals();
    const tailSheet = new THREE.Mesh(prepGeo(tailShape), getTissuePaperMaterial());
    tailSheet.name = `${p}.tissueSheetTail`;
    tailSheet.position.set(rollCenterX, barY, barZ + outerR - 0.0005);
    group.add(tailSheet);
  }

  return finalizeSanitaryGroup(group, 'sanitary');
}

// ---------------------------------------------------------------------------
// 6. 3606 Deck-Mounted 3-Hole Basin Mixer w/ Pop-Up Waste Rod
// ---------------------------------------------------------------------------

export function buildArmstrongDeck3HoleBasinMixer(
  opts: ArmstrongDeck3HoleBasinMixerOptions
): THREE.Group {
  const p = opts.namePrefix;
  const style: PerrinRoweCollectionStyle = opts.style ?? 'armstrong';
  const rawMats = getBathroomBrassMaterials(opts.finish);
  const mats: BathroomMetalMaterialPalette =
    style === 'armstrong'
      ? rawMats
      : { primary: rawMats.primary, knurled: rawMats.primary, darkShadow: rawMats.darkShadow };
  const chinaMat = getVitreousChinaMaterial();
  const spreadM = opts.valveSpreadM ?? 0.200;
  const halfSpread = spreadM * 0.5;

  const group = new THREE.Group();
  group.name = p;

  // --- Centre High-Arc Swan-Neck Spout + Pop-Up Waste Lift Rod at (0, 0, 0) ---
  const spoutGroup = new THREE.Group();
  spoutGroup.name = `${p}.centreSpout`;
  group.add(spoutGroup);

  // Stepped Ø52mm circular deck base plinth (y = 0 .. 0.012m)
  const spoutPlinth = new THREE.Mesh(
    createSteppedCircularRoseGeometry(0.026, 0.017, 0.012),
    mats.primary
  );
  spoutPlinth.name = `${p}.centreSpout.deckPlinth`;
  spoutGroup.add(spoutPlinth);

  // Fine knurled collar ring (Ø34mm, y = 0.012 .. 0.028m)
  const spoutKnurl = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.017, 0.017, 0.016, 28)),
    mats.knurled
  );
  spoutKnurl.name = `${p}.centreSpout.knurledCollar`;
  spoutKnurl.position.y = 0.020;
  spoutGroup.add(spoutKnurl);

  // Stepped collar shoulder (y = 0.028 .. 0.034m)
  const spoutShoulder = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.012, 0.0155, 0.006, 24)),
    mats.primary
  );
  spoutShoulder.name = `${p}.centreSpout.shoulder`;
  spoutShoulder.position.y = 0.031;
  spoutGroup.add(spoutShoulder);

  // High-arc swan-neck cylindrical spout (height ~0.195m, forward reach ~0.135m along +Z)
  const swanPts: THREE.Vector3[] = [
    new THREE.Vector3(0, 0.033, 0),
    new THREE.Vector3(0, 0.095, 0),
    new THREE.Vector3(0, 0.145, 0.004),
    new THREE.Vector3(0, 0.180, 0.028),
    new THREE.Vector3(0, 0.194, 0.068),
    new THREE.Vector3(0, 0.180, 0.108),
    new THREE.Vector3(0, 0.146, 0.130),
    new THREE.Vector3(0, 0.122, 0.135),
  ];
  const swanCurve = new THREE.CatmullRomCurve3(swanPts, false, 'centripetal');
  const swanTube = new THREE.Mesh(
    prepGeo(new THREE.TubeGeometry(swanCurve, 36, 0.011, 20, false)),
    mats.primary
  );
  swanTube.name = `${p}.centreSpout.swanNeckTube`;
  spoutGroup.add(swanTube);

  // Aerated nozzle angled gently (+14°) toward bowl centre
  const nozzlePivot = new THREE.Group();
  nozzlePivot.name = `${p}.centreSpout.nozzle`;
  nozzlePivot.position.set(0, 0.122, 0.135);
  nozzlePivot.rotation.x = -0.22;
  spoutGroup.add(nozzlePivot);

  const nozzleBezel = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0128, 0.0124, 0.011, 24)),
    mats.knurled
  );
  nozzleBezel.name = `${p}.centreSpout.nozzle.knurledBezel`;
  nozzleBezel.position.y = -0.004;
  nozzlePivot.add(nozzleBezel);

  const nozzleAerator = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0092, 0.0092, 0.002, 20)),
    mats.darkShadow
  );
  nozzleAerator.name = `${p}.centreSpout.nozzle.aerator`;
  nozzleAerator.position.y = -0.0095;
  nozzlePivot.add(nozzleAerator);

  // Pop-up waste operating rod & turned knob tucked behind spout stem (z = -0.022m)
  const rodZ = -0.022;
  const rodGuide = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.006, 0.007, 0.016, 16)),
    mats.primary
  );
  rodGuide.name = `${p}.centreSpout.popUpRodGuide`;
  rodGuide.position.set(0, 0.016, rodZ);
  spoutGroup.add(rodGuide);

  const liftRod = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0028, 0.0028, 0.068, 14)),
    mats.primary
  );
  liftRod.name = `${p}.centreSpout.popUpLiftRod`;
  liftRod.position.set(0, 0.054, rodZ);
  spoutGroup.add(liftRod);

  const liftKnob = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0075, 0.0055, 0.014, 18)),
    mats.knurled
  );
  liftKnob.name = `${p}.centreSpout.popUpLiftKnob`;
  liftKnob.position.set(0, 0.091, rodZ);
  spoutGroup.add(liftKnob);

  // --- Left Hot (-halfSpread) & Right Cold (+halfSpread) Deck Valves ---
  for (const [tag, signX] of [
    ['hotValve', -1],
    ['coldValve', 1],
  ] as const) {
    const vGroup = new THREE.Group();
    vGroup.name = `${p}.${tag}`;
    vGroup.position.set(signX * halfSpread, 0, 0);
    group.add(vGroup);

    // Stepped Ø50mm circular deck escutcheon (y = 0 .. 0.011m)
    const escutcheon = new THREE.Mesh(
      createSteppedCircularRoseGeometry(0.025, 0.017, 0.011),
      mats.primary
    );
    escutcheon.name = `${p}.${tag}.deckEscutcheon`;
    vGroup.add(escutcheon);

    // Cylindrical valve body (Ø34mm, y = 0.011 .. 0.056m)
    const body = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.017, 0.017, 0.045, 26)),
      mats.primary
    );
    body.name = `${p}.${tag}.body`;
    body.position.y = 0.0335;
    vGroup.add(body);

    // Signature Armstrong knurled collar ring (Ø37mm, y = 0.032 .. 0.048m)
    const knurlRing = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.0186, 0.0186, 0.016, 28)),
      mats.knurled
    );
    knurlRing.name = `${p}.${tag}.knurledCollar`;
    knurlRing.position.y = 0.040;
    vGroup.add(knurlRing);

    // Domed top cap (y = 0.056 .. 0.066m) + porcelain Hot/Cold index medallion on Traditional 3705
    const capPts = [
      new THREE.Vector2(0.017, 0),
      new THREE.Vector2(0.016, 0.005),
      new THREE.Vector2(0.011, 0.009),
      new THREE.Vector2(0, 0.010),
    ];
    const cap = new THREE.Mesh(prepGeo(new THREE.LatheGeometry(capPts, 22)), mats.primary);
    cap.name = `${p}.${tag}.topCap`;
    cap.position.y = 0.056;
    vGroup.add(cap);

    if (style === 'traditional') {
      const indexDisc = new THREE.Mesh(
        prepGeo(new THREE.CylinderGeometry(0.0078, 0.0082, 0.0022, 20)),
        chinaMat
      );
      indexDisc.name = `${p}.${tag}.porcelainIndexCap`;
      indexDisc.position.y = 0.0662;
      vGroup.add(indexDisc);
    }

    // Horizontal lever handle (~72mm outward along -X / +X; sculpted white porcelain baluster on Traditional 3705)
    const leverStem = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.0058, 0.0072, 0.020, 16)),
      mats.primary
    );
    leverStem.name = `${p}.${tag}.leverStem`;
    leverStem.rotation.z = -signX * Math.PI * 0.5;
    leverStem.position.set(signX * 0.022, 0.048, 0);
    vGroup.add(leverStem);

    const leverGeo =
      style === 'traditional'
        ? prepGeo(
            new THREE.LatheGeometry(
              [
                new THREE.Vector2(0.0055, -0.024),
                new THREE.Vector2(0.0078, -0.016),
                new THREE.Vector2(0.0102, -0.002),
                new THREE.Vector2(0.0108, 0.010),
                new THREE.Vector2(0.0092, 0.020),
                new THREE.Vector2(0.0058, 0.024),
              ],
              22
            )
          )
        : prepGeo(new THREE.CylinderGeometry(0.0056, 0.0050, 0.048, 18));
    const leverBar = new THREE.Mesh(leverGeo, style === 'traditional' ? chinaMat : mats.primary);
    leverBar.name = `${p}.${tag}.leverHandle`;
    leverBar.rotation.z = -signX * Math.PI * 0.5;
    leverBar.position.set(signX * 0.054, 0.048, 0);
    vGroup.add(leverBar);

    const leverTip = new THREE.Mesh(
      prepGeo(
        style === 'traditional'
          ? new THREE.SphereGeometry(0.0056, 16, 12)
          : new THREE.CylinderGeometry(0.0062, 0.0062, 0.009, 18)
      ),
      mats.knurled
    );
    leverTip.name = `${p}.${tag}.leverKnurledTip`;
    leverTip.rotation.z = -signX * Math.PI * 0.5;
    leverTip.position.set(signX * (style === 'traditional' ? 0.080 : 0.076), 0.048, 0);
    vGroup.add(leverTip);
  }
  attachAssetInteraction(group, {
    kind: 'toggle',
    label: 'Turn On Armstrong Basin Mixer',
    activeLabel: 'Turn Off Armstrong Basin Mixer',
    audio: { openPreset: 'tapValveTurn', closePreset: 'tapValveTurn', activeLoopPreset: 'waterTapFlow', volume: 0.65 },
  });
  const fCode = resolveBrasswareCode(opts.finish, 'AB');
  return attachAssetMetadata(finalizeSanitaryGroup(group, 'plumbing'), {
    name: 'Perrin & Rowe Armstrong 3-Hole Deck Basin Mixer',
    brand: 'Perrin & Rowe',
    collection: 'Armstrong',
    sku: `PR-3231-${fCode}`,
    finish: formatBrasswareFinishLabel(opts.finish, 'AB'),
    category: 'sanitaryware',
    dimensionsMm: [240, 175, 195],
    productUrl: 'https://www.perrinandrowe.co.uk/bathroom/armstrong-collection/',
    schematicUrl: 'https://www.perrinandrowe.co.uk/downloads/spec-sheets/PR-3231-Spec.pdf',
  });
}


// ---------------------------------------------------------------------------
// 7. 6235 Wall-Mounted Towel Ring (Ø180mm ring + stepped rose & pivot collar)
// ---------------------------------------------------------------------------

export function buildPerrinRoweTowelRing(
  opts: PerrinRoweTowelRingOptions
): THREE.Group {
  const p = opts.namePrefix;
  const style: PerrinRoweCollectionStyle = opts.style ?? 'armstrong';
  const rawMats = getBathroomBrassMaterials(opts.finish);
  const collarMat = style === 'armstrong' ? rawMats.knurled : rawMats.primary;

  const group = new THREE.Group();
  group.name = p;

  const rose = new THREE.Mesh(
    createSteppedCircularRoseGeometry(0.027, 0.014, 0.011),
    rawMats.primary
  );
  rose.name = `${p}.wallRose`;
  rose.rotation.x = Math.PI * 0.5;
  group.add(rose);

  const collar = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.014, 0.014, 0.012, 24)),
    collarMat
  );
  collar.name = `${p}.bossCollar`;
  collar.rotation.x = Math.PI * 0.5;
  collar.position.z = 0.016;
  group.add(collar);

  const post = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.009, 0.009, 0.028, 20)),
    rawMats.primary
  );
  post.name = `${p}.standoffPost`;
  post.rotation.x = Math.PI * 0.5;
  post.position.z = 0.034;
  group.add(post);

  const pivotSleeve = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0105, 0.0105, 0.026, 20)),
    collarMat
  );
  pivotSleeve.name = `${p}.pivotSleeve`;
  pivotSleeve.rotation.z = Math.PI * 0.5;
  pivotSleeve.position.set(0, 0, 0.048);
  group.add(pivotSleeve);

  // Ø180mm (radius 0.090m) solid-brass circular towel ring hanging cleanly below pivot at z = 0.048m
  const ringRadius = 0.090;
  const ring = new THREE.Mesh(
    prepGeo(new THREE.TorusGeometry(ringRadius, 0.0055, 16, 42)),
    rawMats.primary
  );
  ring.name = `${p}.towelRing`;
  ring.position.set(0, -ringRadius + 0.004, 0.048);
  group.add(ring);

  return finalizeSanitaryGroup(group, 'sanitary');
}

// ---------------------------------------------------------------------------
// 8. 6772 / 6797 Extended Concealed Cistern Wall Flush Lever
// ---------------------------------------------------------------------------

export function buildPerrinRoweConcealedCisternLever(
  opts: PerrinRoweConcealedCisternLeverOptions
): THREE.Group {
  const p = opts.namePrefix;
  const style: PerrinRoweCollectionStyle = opts.style ?? 'armstrong';
  const rawMats = getBathroomBrassMaterials(opts.finish);
  const collarMat = style === 'armstrong' ? rawMats.knurled : rawMats.primary;
  const handleMat = style === 'traditional' ? getVitreousChinaMaterial() : rawMats.primary;

  const group = new THREE.Group();
  group.name = p;

  const wallRose = new THREE.Mesh(
    createSteppedCircularRoseGeometry(0.028, 0.015, 0.010),
    rawMats.primary
  );
  wallRose.name = `${p}.wallEscutcheon`;
  wallRose.rotation.x = Math.PI * 0.5;
  group.add(wallRose);

  const spindleBoss = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.014, 0.014, 0.018, 22)),
    collarMat
  );
  spindleBoss.name = `${p}.spindleBoss`;
  spindleBoss.rotation.x = Math.PI * 0.5;
  spindleBoss.position.z = 0.018;
  group.add(spindleBoss);

  const crankArm = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0055, 0.0055, 0.028, 16)),
    rawMats.primary
  );
  crankArm.name = `${p}.crankArm`;
  crankArm.rotation.z = -Math.PI * 0.44;
  crankArm.position.set(0.014, -0.003, 0.026);
  group.add(crankArm);

  const paddlePts = [
    new THREE.Vector2(0.0055, 0),
    new THREE.Vector2(style === 'traditional' ? 0.0105 : 0.0075, 0.010),
    new THREE.Vector2(style === 'traditional' ? 0.0115 : 0.0080, 0.032),
    new THREE.Vector2(style === 'traditional' ? 0.0095 : 0.0075, 0.048),
    new THREE.Vector2(0.0055, 0.054),
  ];
  const paddle = new THREE.Mesh(prepGeo(new THREE.LatheGeometry(paddlePts, 22)), handleMat);
  paddle.name = `${p}.flushPaddle`;
  paddle.rotation.z = -Math.PI * 0.44;
  paddle.position.set(0.026, -0.005, 0.026);
  group.add(paddle);

  const endPip = new THREE.Mesh(
    prepGeo(new THREE.SphereGeometry(0.006, 14, 10)),
    rawMats.primary
  );
  endPip.name = `${p}.endFinial`;
  endPip.position.set(0.080, -0.016, 0.026);
  group.add(endPip);

  return finalizeSanitaryGroup(group, 'sanitary');
}
