import * as THREE from 'three';
import { attachAssetInteraction, attachAssetMetadata, formatBrasswareFinishLabel, resolveBrasswareCode } from '../shared/catalog-smart-metadata.ts';
import type {
  BathroomMetalMaterialPalette,
  PerrinRoweDeco3HoleBasinMixerOptions,
  PerrinRoweDecoConcealedShowerSetOptions,
  PerrinRoweDecoPaperHolderOptions,
  PerrinRoweDecoRobeHookOptions,
} from './bathroom-spec-types.ts';
import {
  finalizeSanitaryGroup,
  getBathroomBrassMaterials,
  getVitreousChinaMaterial,
} from './bathroom-materials.ts';
import { prepGeo } from '../shared/scene-helpers.ts';

/**
 * Perrin & Rowe `Deco` Collection (`PF` Pewter — Hand-Brushed Nickel) 3D Builders.
 *
 * Modeled directly to official Perrin & Rowe UK CAD technical drawings (millimeter-accurate):
 * - `3142PF`: Deco 3-Hole Basin Mixer w/ Pop-Up Waste (200mm centres, 48mm AF octagonal valve
 *   plinths H=95mm, 61mm AF octagonal spout plinth, 130mm pop-up knob height, 135mm faceted spout reach)
 * - `5158PF` + `5193PF`: Deco Concealed Thermostatic Shower Mixer (200×200mm bevelled octagonal
 *   plate, 105mm projection) + Deco Concealed 2-Way Diverter (58mm AF octagonal rose, 95mm projection)
 * - `5184PF` + `5135PF`: Deco 410mm Wall Shower Arm (55mm AF × 60mm octagonal wall shroud, 130mm drop)
 *   + Deco 8" (Ø200 × 70mm H) Multi-Stepped Drum & Octagonal Crown Deluge Rose
 * - `5140PF` + `5195PF` + `5146PF`: Deco 600mm CRS Slide Rail (60mm AF octagonal brackets, 72mm rail
 *   projection, 135mm slider projection) + Ø75mm Stepped Deco Handshower & 1.5m Hose + 58mm AF × 70mm
 *   Octagonal Wall Outlet (50mm hose spigot offset)
 * - `6122PF`: Deco Twin-Prong Robe Hook (55mm AF octagonal backplate, 75mm wide, 48mm projection)
 * - `6148PF`: Deco Wall Toilet Roll Holder (55mm AF octagonal backplate, W160 × H100 × D75mm)
 *
 * Coordinate convention:
 * - Wall-mounted fixtures: `z = 0` is the finished wall plane; fixture projects into `+Z`; `+Y` is up.
 * - Deck-mounted fixtures: `y = 0` is the ceramic mounting deck; spout projects into `+Z`.
 */

/** Circumradius factor converting regular octagon flat-to-flat (`AF`) to corner-to-corner radius (`R = AF / (2 cos(π/8))`). */
const OCT_AF_TO_RADIUS = 1 / (2 * Math.cos(Math.PI / 8)); // ~0.5411961

/**
 * Builds a crisp non-indexed 8-faceted octagonal frustum aligned along `+Y` (`y in [-height/2, +height/2]`)
 * with flat faces orthogonal to `±X` and `±Z` (matching Perrin & Rowe Deco CAD plan/elevation views).
 */
function createOctagonalFrustumY(afBottomM: number, afTopM: number, heightM: number): THREE.BufferGeometry {
  const rBottom = afBottomM * OCT_AF_TO_RADIUS;
  const rTop = afTopM * OCT_AF_TO_RADIUS;
  const cyl = new THREE.CylinderGeometry(rTop, rBottom, heightM, 8, 1, false);
  cyl.rotateY(Math.PI / 8);
  const faceted = cyl.toNonIndexed();
  cyl.dispose();
  faceted.computeVertexNormals();
  return prepGeo(faceted);
}

/**
 * Builds a crisp non-indexed 8-faceted octagonal frustum aligned along `+Z` (`z in [0, depthM]`),
 * used for wall roses, octagonal shrouds, and wall brackets projecting from `z = 0` into `+Z`.
 */
function createOctagonalFrustumZ(afWallM: number, afFrontM: number, depthM: number): THREE.BufferGeometry {
  const geo = createOctagonalFrustumY(afWallM, afFrontM, depthM);
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0, depthM * 0.5);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Builds a bevelled 8-sided regular octagonal plate in the `XY` plane extruding from `z = 0` to `z = depthM`.
 */
function createBevelledOctagonWallPlateZ(afM: number, depthM: number, bevelM = 0.0025): THREE.BufferGeometry {
  const half = Math.max(0.004, afM * 0.5 - bevelM);
  const edge = half * Math.tan(Math.PI / 8); // half side length of regular octagon
  const shape = new THREE.Shape();
  shape.moveTo(-edge, -half);
  shape.lineTo(edge, -half);
  shape.lineTo(half, -edge);
  shape.lineTo(half, edge);
  shape.lineTo(edge, half);
  shape.lineTo(-edge, half);
  shape.lineTo(-half, edge);
  shape.lineTo(-half, -edge);
  shape.closePath();

  const bodyDepth = Math.max(0.002, depthM - bevelM);
  const ext = new THREE.ExtrudeGeometry(shape, {
    depth: bodyDepth,
    bevelEnabled: true,
    bevelThickness: bevelM,
    bevelSize: bevelM,
    bevelSegments: 2,
    curveSegments: 1,
  });
  ext.translate(0, 0, bevelM * 0.35);
  const faceted = ext.index ? ext.toNonIndexed() : ext;
  ext.dispose();
  faceted.computeVertexNormals();
  return prepGeo(faceted);
}

/**
 * Builds Perrin & Rowe `Deco`'s signature 4-spoke faceted Art Deco crosstop handle.
 * When `axis === 'Y'`, the handle stem sits at `y = 0` and spokes radiate in `XZ` (`±X`, `±Z`).
 * When `axis === 'Z'`, the handle sits at `z = 0` and spokes radiate in `XY` (`±X`, `±Y`).
 */
function buildDecoFourSpokeCrosstop(
  namePrefix: string,
  mats: BathroomMetalMaterialPalette,
  spanM: number,
  axis: 'Y' | 'Z'
): THREE.Group {
  const group = new THREE.Group();
  group.name = namePrefix;

  const core = new THREE.Group();
  core.name = `${namePrefix}.core`;

  // Stepped 8-faceted central hub
  const hubBase = new THREE.Mesh(createOctagonalFrustumY(0.024, 0.022, 0.016), mats.primary);
  hubBase.name = `${namePrefix}.hub`;
  core.add(hubBase);

  const hubCrown = new THREE.Mesh(createOctagonalFrustumY(0.020, 0.015, 0.006), mats.primary);
  hubCrown.name = `${namePrefix}.hubCrown`;
  hubCrown.position.y = 0.011;
  core.add(hubCrown);

  // Glazed Vitreous China index medallion inset into top of octagonal crown
  const indice = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0058, 0.0058, 0.0018, 16)),
    getVitreousChinaMaterial()
  );
  indice.name = `${namePrefix}.ceramicIndice`;
  indice.position.y = 0.0142;
  core.add(indice);

  // 4 orthogonal tapered 8-faceted Art Deco spokes + stepped end caps
  const spokeStartR = 0.010;
  const spokeHalfSpan = spanM * 0.5;
  const spokeLen = Math.max(0.016, spokeHalfSpan - spokeStartR - 0.003);
  const spokeGeo = createOctagonalFrustumY(0.0105, 0.0138, spokeLen);
  const capGeo = createOctagonalFrustumY(0.0138, 0.0095, 0.0035);

  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2;
    const arm = new THREE.Group();
    arm.name = `${namePrefix}.spoke.${i}`;
    arm.rotation.y = angle;

    const spoke = new THREE.Mesh(spokeGeo, mats.primary);
    spoke.name = `${namePrefix}.spokeShaft.${i}`;
    spoke.rotation.z = -Math.PI / 2;
    spoke.position.x = spokeStartR + spokeLen * 0.5;
    arm.add(spoke);

    const cap = new THREE.Mesh(capGeo, mats.primary);
    cap.name = `${namePrefix}.spokeCap.${i}`;
    cap.rotation.z = -Math.PI / 2;
    cap.position.x = spokeStartR + spokeLen + 0.0017;
    arm.add(cap);

    core.add(arm);
  }

  if (axis === 'Z') {
    core.rotation.x = Math.PI / 2;
  }
  group.add(core);
  return group;
}

// Perrin & Rowe `3142PF` Deco 3-Hole Basin Mixer w/ Pop-Up Waste

export function buildDeco3HoleBasinMixer3142(
  opts: PerrinRoweDeco3HoleBasinMixerOptions
): THREE.Group {
  const {
    namePrefix,
    finish,
    valveSpreadM = 0.200, // 200mm centres (±100mm)
    spoutReachM = 0.135,  // 135mm horizontal reach
  } = opts;
  const mats = getBathroomBrassMaterials(finish);

  const root = new THREE.Group();
  root.name = namePrefix;

  // Central Faceted Art Deco Spout + Pop-Up Pull Rod (61mm AF base, H=130mm knob, 135mm reach)
  const spoutGroup = new THREE.Group();
  spoutGroup.name = `${namePrefix}.centralSpout`;

  // 61mm AF (66mm AC) stepped octagonal base plinth
  const plinthLower = new THREE.Mesh(createOctagonalFrustumY(0.061, 0.059, 0.010), mats.primary);
  plinthLower.name = `${namePrefix}.spoutPlinthLower`;
  plinthLower.position.y = 0.005;
  spoutGroup.add(plinthLower);

  const plinthStep = new THREE.Mesh(createOctagonalFrustumY(0.053, 0.049, 0.008), mats.primary);
  plinthStep.name = `${namePrefix}.spoutPlinthStep`;
  plinthStep.position.y = 0.014;
  spoutGroup.add(plinthStep);

  // Tapered 8-faceted vertical body rising to y = 0.094m
  const bodyColumn = new THREE.Mesh(createOctagonalFrustumY(0.045, 0.033, 0.076), mats.primary);
  bodyColumn.name = `${namePrefix}.spoutBodyColumn`;
  bodyColumn.position.y = 0.056;
  spoutGroup.add(bodyColumn);

  const topCap = new THREE.Mesh(createOctagonalFrustumY(0.034, 0.025, 0.010), mats.primary);
  topCap.name = `${namePrefix}.spoutTopCap`;
  topCap.position.y = 0.099;
  spoutGroup.add(topCap);

  // Faceted 8-sided Art Deco horizontal-to-downturned spout arm (projects +Z to spoutReachM = 0.135m)
  // Rises gently from y = 0.076m at column front to y = 0.082m shoulder, then steps down to y = 0.058m aerator
  const armHorizLen = spoutReachM - 0.014;
  const armBeam = new THREE.Mesh(createOctagonalFrustumY(0.027, 0.022, armHorizLen), mats.primary);
  armBeam.name = `${namePrefix}.facetedSpoutArm`;
  armBeam.rotation.x = Math.PI / 2 - 0.05; // crisp Deco slight upward pitch
  armBeam.position.set(0, 0.077, 0.014 + armHorizLen * 0.5);
  spoutGroup.add(armBeam);

  // Stepped octagonal nozzle elbow & downturned cuff at z = spoutReachM (0.135m), outlet at y = 0.058m
  const nozzleShoulder = new THREE.Mesh(createOctagonalFrustumY(0.024, 0.025, 0.016), mats.primary);
  nozzleShoulder.name = `${namePrefix}.nozzleShoulder`;
  nozzleShoulder.position.set(0, 0.074, spoutReachM);
  spoutGroup.add(nozzleShoulder);

  const nozzleCuff = new THREE.Mesh(createOctagonalFrustumY(0.022, 0.024, 0.010), mats.primary);
  nozzleCuff.name = `${namePrefix}.nozzleCuff`;
  nozzleCuff.position.set(0, 0.062, spoutReachM);
  spoutGroup.add(nozzleCuff);

  const aerator = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0085, 0.0085, 0.003, 16)),
    mats.darkShadow
  );
  aerator.name = `${namePrefix}.aerator`;
  aerator.position.set(0, 0.0575, spoutReachM);
  spoutGroup.add(aerator);

  // Rear pop-up waste pull rod & faceted octagonal finial reaching exact H = 130mm (0.130m)
  const pullRod = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0028, 0.0028, 0.044, 10)),
    mats.primary
  );
  pullRod.name = `${namePrefix}.popUpWasteRod`;
  pullRod.position.set(0, 0.098, -0.016);
  spoutGroup.add(pullRod);

  const pullFinial = new THREE.Mesh(createOctagonalFrustumY(0.011, 0.014, 0.014), mats.primary);
  pullFinial.name = `${namePrefix}.popUpWasteKnob`;
  pullFinial.position.set(0, 0.123, -0.016); // top at y = 0.130m (130mm exact!)
  spoutGroup.add(pullFinial);

  root.add(spoutGroup);

  // Left (Hot) & Right (Cold) Deco Side Valves (48mm AF plinth, H = 95mm overall, ±100mm CRS)
  const halfSpread = valveSpreadM * 0.5;
  for (const side of ['hotLeft', 'coldRight'] as const) {
    const xPos = side === 'hotLeft' ? -halfSpread : halfSpread;
    const vGroup = new THREE.Group();
    vGroup.name = `${namePrefix}.${side}Valve`;
    vGroup.position.set(xPos, 0, 0);

    // 48mm AF (52mm AC) stepped octagonal base plinth
    const vPlinth = new THREE.Mesh(createOctagonalFrustumY(0.048, 0.046, 0.009), mats.primary);
    vPlinth.name = `${vGroup.name}.plinth`;
    vPlinth.position.y = 0.0045;
    vGroup.add(vPlinth);

    const vStep = new THREE.Mesh(createOctagonalFrustumY(0.041, 0.038, 0.007), mats.primary);
    vStep.name = `${vGroup.name}.plinthStep`;
    vStep.position.y = 0.0125;
    vGroup.add(vStep);

    // Tapered 8-faceted octagonal bell shroud (36mm -> 24mm AF)
    const vShroud = new THREE.Mesh(createOctagonalFrustumY(0.036, 0.024, 0.042), mats.primary);
    vShroud.name = `${vGroup.name}.shroud`;
    vShroud.position.y = 0.037;
    vGroup.add(vShroud);

    // Stem neck rising to crosstop hub at y = 0.080m (overall top y = 0.095m = 95mm exact!)
    const vStem = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.0075, 0.0085, 0.018, 12)),
      mats.primary
    );
    vStem.name = `${vGroup.name}.stem`;
    vStem.position.y = 0.067;
    vGroup.add(vStem);

    const crosstop = buildDecoFourSpokeCrosstop(`${vGroup.name}.crosstop`, mats, 0.076, 'Y');
    crosstop.position.y = 0.080;
    vGroup.add(crosstop);

    root.add(vGroup);
  }

  attachAssetInteraction(root, {
    kind: 'toggle',
    label: 'Turn On Deco Basin Mixer',
    activeLabel: 'Turn Off Deco Basin Mixer',
    audio: { openPreset: 'tapValveTurn', closePreset: 'tapValveTurn', activeLoopPreset: 'waterTapFlow', volume: 0.65 },
  });
  const fCode = resolveBrasswareCode(opts.finish, 'NI');
  return attachAssetMetadata(finalizeSanitaryGroup(root, 'plumbing'), {
    name: 'Perrin & Rowe Deco 3-Hole Low-Spout Basin Mixer',
    brand: 'Perrin & Rowe',
    collection: 'Deco',
    sku: `PR-3142-${fCode}`,
    finish: formatBrasswareFinishLabel(opts.finish, 'NI'),
    category: 'sanitaryware',
    dimensionsMm: [240, 165, 138],
    productUrl: 'https://www.perrinandrowe.co.uk/bathroom/deco-collection/',
    schematicUrl: 'https://www.perrinandrowe.co.uk/downloads/spec-sheets/PR-3142-Spec.pdf',
  });
}

// Perrin & Rowe `DSS1PF` Deco Concealed Thermostatic Shower Set
//    (`5158PF` + `5193PF` + `5184PF` + `5135PF` + `5140PF` + `5195PF` + `5146PF`)

export function buildDecoConcealedShowerSet(
  opts: PerrinRoweDecoConcealedShowerSetOptions
): THREE.Group {
  const {
    namePrefix,
    finish,
    valveCenterYM = 1.05,
    diverterOffsetYM = 0.195,
    overheadArmYM = 1.98,
    overheadArmReachM = 0.410, // 5184PF = 410mm reach
    roseDiameterM = 0.200,     // 5135PF / 5105PF = Ø200mm (8")
    slideRailOffsetXM = 0.26,
    slideRailCenterYM = 1.34,
  } = opts;
  const mats = getBathroomBrassMaterials(finish);

  const root = new THREE.Group();
  root.name = namePrefix;

  // `5158PF` Deco Concealed Thermostatic Mixer + `5193PF` Deco 2-Way Diverter
  // Grouped together under `thermostaticValve5158` so callers can mount both controls cleanly
  // on the South 150mm stud wetroom wall inside the 860mm arch!
  const valveGroup = new THREE.Group();
  valveGroup.name = `${namePrefix}.thermostaticValve5158`;
  valveGroup.position.set(0, valveCenterYM, 0);

  // `5158PF`: 200 × 200mm (0.200m AF) bevelled regular 8-sided octagonal backplate
  const mainPlate = new THREE.Mesh(
    createBevelledOctagonWallPlateZ(0.200, 0.008, 0.0025),
    mats.primary
  );
  mainPlate.name = `${valveGroup.name}.octagonalBackplate200`;
  valveGroup.add(mainPlate);

  // Inner stepped octagonal border relief (172mm AF)
  const innerBorder = new THREE.Mesh(
    createBevelledOctagonWallPlateZ(0.172, 0.0025, 0.0012),
    mats.primary
  );
  innerBorder.name = `${valveGroup.name}.innerOctagonalStep`;
  innerBorder.position.z = 0.0075;
  valveGroup.add(innerBorder);

  // 4 exposed octagonal fixing screw bosses near diagonal octagon facets
  const screwGeo = createOctagonalFrustumZ(0.009, 0.007, 0.0035);
  for (const [sx, sy] of [
    [-0.056, 0.068],
    [0.056, 0.068],
    [-0.056, -0.068],
    [0.056, -0.068],
  ] as const) {
    const screw = new THREE.Mesh(screwGeo, mats.primary);
    screw.name = `${valveGroup.name}.screwBoss`;
    screw.position.set(sx, sy, 0.0095);
    valveGroup.add(screw);
  }

  // Tapered 8-faceted octagonal thermostatic shroud + temperature ring + 38°C override button
  const thermoBaseCollar = new THREE.Mesh(createOctagonalFrustumZ(0.072, 0.066, 0.012), mats.primary);
  thermoBaseCollar.name = `${valveGroup.name}.baseCollar`;
  thermoBaseCollar.position.z = 0.009;
  valveGroup.add(thermoBaseCollar);

  const thermoShroud = new THREE.Mesh(createOctagonalFrustumZ(0.062, 0.044, 0.048), mats.primary);
  thermoShroud.name = `${valveGroup.name}.taperedOctagonalShroud`;
  thermoShroud.position.z = 0.021;
  valveGroup.add(thermoShroud);

  // 38°C safety override button on top facet of thermostatic shroud
  const overrideBtn = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0045, 0.0045, 0.008, 12)),
    mats.primary
  );
  overrideBtn.name = `${valveGroup.name}.safetyOverride38C`;
  overrideBtn.position.set(0, 0.027, 0.050);
  valveGroup.add(overrideBtn);

  const thermoStem = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.009, 0.009, 0.020, 12).rotateX(Math.PI / 2)),
    mats.primary
  );
  thermoStem.name = `${valveGroup.name}.stem`;
  thermoStem.position.z = 0.078;
  valveGroup.add(thermoStem);

  // 4-spoke faceted Deco crosstop at z = 0.091m (total projection = 105mm = 0.105m!)
  const thermoCrosstop = buildDecoFourSpokeCrosstop(
    `${valveGroup.name}.thermoCrosstop`,
    mats,
    0.086,
    'Z'
  );
  thermoCrosstop.position.z = 0.091;
  valveGroup.add(thermoCrosstop);

  // `5193PF`: Deco Concealed 2-Way Diverter & Flow Valve (+0.195m above `5158PF` centre)
  const diverterGroup = new THREE.Group();
  diverterGroup.name = `${valveGroup.name}.diverter5193`;
  diverterGroup.position.set(0, diverterOffsetYM, 0);

  // 58mm AF (65mm AC) stepped octagonal wall rose
  const divRose = new THREE.Mesh(createOctagonalFrustumZ(0.058, 0.054, 0.008), mats.primary);
  divRose.name = `${diverterGroup.name}.octagonalRose58`;
  diverterGroup.add(divRose);

  const divStep = new THREE.Mesh(createOctagonalFrustumZ(0.048, 0.044, 0.007), mats.primary);
  divStep.name = `${diverterGroup.name}.roseStep`;
  divStep.position.z = 0.008;
  diverterGroup.add(divStep);

  // Tapered 8-faceted octagonal cone (42mm -> 26mm AF)
  const divCone = new THREE.Mesh(createOctagonalFrustumZ(0.042, 0.026, 0.046), mats.primary);
  divCone.name = `${diverterGroup.name}.octagonalCone`;
  divCone.position.z = 0.015;
  diverterGroup.add(divCone);

  const divStem = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.008, 0.008, 0.020, 12).rotateX(Math.PI / 2)),
    mats.primary
  );
  divStem.name = `${diverterGroup.name}.stem`;
  divStem.position.z = 0.071;
  diverterGroup.add(divStem);

  // 4-spoke faceted Deco crosstop at z = 0.081m (total projection = 95mm = 0.095m!)
  const divCrosstop = buildDecoFourSpokeCrosstop(
    `${diverterGroup.name}.diverterCrosstop`,
    mats,
    0.078,
    'Z'
  );
  divCrosstop.position.z = 0.081;
  diverterGroup.add(divCrosstop);

  valveGroup.add(diverterGroup);
  root.add(valveGroup);

  // `5184PF` 410mm Deco Wall Arm + `5135PF` (`5105PF`) Ø200 × 70mm Stepped Deco Deluge Rose
  const overheadGroup = new THREE.Group();
  overheadGroup.name = `${namePrefix}.overheadShower`;
  overheadGroup.position.set(0, overheadArmYM, 0);

  // `5184PF`: 55mm AF (58mm AC) × 60mm long tapered 8-faceted octagonal wall shroud
  const armFlange = new THREE.Mesh(createOctagonalFrustumZ(0.055, 0.052, 0.009), mats.primary);
  armFlange.name = `${overheadGroup.name}.wallOctagonalFlange55`;
  overheadGroup.add(armFlange);

  const armShroud = new THREE.Mesh(createOctagonalFrustumZ(0.046, 0.030, 0.051), mats.primary);
  armShroud.name = `${overheadGroup.name}.taperedOctagonalShroud60`;
  armShroud.position.z = 0.009;
  overheadGroup.add(armShroud);

  // Ø22mm tubular wall arm projecting to z = 0.410m with smooth 90° downward sweep (130mm total drop to arm tip)
  const armDropM = 0.075;
  const armPath = new THREE.CurvePath<THREE.Vector3>();
  armPath.add(
    new THREE.LineCurve3(
      new THREE.Vector3(0, 0, 0.055),
      new THREE.Vector3(0, 0, overheadArmReachM - 0.055)
    )
  );
  armPath.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(0, 0, overheadArmReachM - 0.055),
      new THREE.Vector3(0, 0, overheadArmReachM),
      new THREE.Vector3(0, -0.050, overheadArmReachM)
    )
  );
  armPath.add(
    new THREE.LineCurve3(
      new THREE.Vector3(0, -0.050, overheadArmReachM),
      new THREE.Vector3(0, -armDropM, overheadArmReachM)
    )
  );
  const armTube = new THREE.Mesh(
    prepGeo(new THREE.TubeGeometry(armPath, 24, 0.011, 16, false)),
    mats.primary
  );
  armTube.name = `${overheadGroup.name}.arm5184`;
  overheadGroup.add(armTube);

  // `5135PF` (`5105PF`): 8" (Ø200mm × 70mm H) Multi-Stepped Art Deco Drum & Octagonal Crown Deluge Rose
  const roseGroup = new THREE.Group();
  roseGroup.name = `${overheadGroup.name}.decoRose5135`;
  roseGroup.position.set(0, -armDropM, overheadArmReachM);

  const roseR = roseDiameterM * 0.5; // 0.100m (Ø200mm)

  // Swivel ball joint & 8-faceted octagonal top union nut (y = -0.018..0)
  const topUnion = new THREE.Mesh(createOctagonalFrustumY(0.026, 0.024, 0.012), mats.primary);
  topUnion.name = `${roseGroup.name}.octagonalSwivelNut`;
  topUnion.position.y = -0.006;
  roseGroup.add(topUnion);

  const swivelBall = new THREE.Mesh(
    prepGeo(new THREE.SphereGeometry(0.013, 16, 12)),
    mats.primary
  );
  swivelBall.name = `${roseGroup.name}.swivelBall`;
  swivelBall.position.y = -0.016;
  roseGroup.add(swivelBall);

  // 8-faceted octagonal pyramidal Art Deco crown boss (y = -0.036..-0.020, tucked 2mm inside steppedDecoDrum with 0 coplanar cap)
  const octCrown = new THREE.Mesh(createOctagonalFrustumY(0.054, 0.030, 0.016), mats.primary);
  octCrown.name = `${roseGroup.name}.octagonalCrownBoss`;
  octCrown.position.y = -0.028;
  roseGroup.add(octCrown);

  // Multi-stepped circular Art Deco ziggurat tiers + tall drum body with open bottom recess (y = -0.063m, 0 coplanar disk!)
  const roseLathePts = [
    new THREE.Vector2(0.022, -0.034),
    new THREE.Vector2(roseR * 0.56, -0.036),
    new THREE.Vector2(roseR * 0.56, -0.042),
    new THREE.Vector2(roseR * 0.78, -0.043),
    new THREE.Vector2(roseR * 0.78, -0.049),
    new THREE.Vector2(roseR * 0.94, -0.050),
    new THREE.Vector2(roseR * 0.94, -0.062),
    new THREE.Vector2(roseR, -0.063),
    new THREE.Vector2(roseR, -0.070),
    new THREE.Vector2(roseR * 0.915, -0.070),
    new THREE.Vector2(roseR * 0.915, -0.063),
  ];
  const roseBody = new THREE.Mesh(
    prepGeo(new THREE.LatheGeometry(roseLathePts, 40)),
    mats.primary
  );
  roseBody.name = `${roseGroup.name}.steppedDecoDrum`;
  roseGroup.add(roseBody);

  // Dark recessed spray faceplate (y = -0.064..-0.068m) + proud concentric Deco nozzle rings (y = -0.0695m)
  const faceplate = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(roseR * 0.912, roseR * 0.912, 0.004, 32)),
    mats.darkShadow
  );
  faceplate.name = `${roseGroup.name}.nozzleFaceplate`;
  faceplate.position.y = -0.066;
  roseGroup.add(faceplate);

  for (const ringFrac of [0.32, 0.58, 0.82]) {
    const nozzleRing = new THREE.Mesh(
      prepGeo(new THREE.TorusGeometry(roseR * ringFrac, 0.0014, 8, 32).rotateX(Math.PI / 2)),
      mats.primary
    );
    nozzleRing.name = `${roseGroup.name}.nozzleRing`;
    nozzleRing.position.y = -0.0695;
    roseGroup.add(nozzleRing);
  }

  overheadGroup.add(roseGroup);
  root.add(overheadGroup);

  // `5140PF` 600mm CRS Deco Slide Rail + `5195PF` Deco Handshower + `5146PF` Wall Outlet
  const railGroup = new THREE.Group();
  railGroup.name = `${namePrefix}.slideRailAssembly`;
  railGroup.position.set(slideRailOffsetXM, slideRailCenterYM, 0);

  const railCentersM = 0.600; // 600mm CRS exact
  const halfRailCrs = railCentersM * 0.5;
  const railProjZ = 0.072;    // 72mm rail centre projection

  // Top & bottom `5140PF` 60mm AF (65mm AC) stepped octagonal wall brackets
  for (const [label, by] of [
    ['topBracket', halfRailCrs],
    ['bottomBracket', -halfRailCrs],
  ] as const) {
    const bGroup = new THREE.Group();
    bGroup.name = `${railGroup.name}.${label}`;
    bGroup.position.set(0, by, 0);

    const bRose = new THREE.Mesh(createOctagonalFrustumZ(0.060, 0.056, 0.008), mats.primary);
    bRose.name = `${bGroup.name}.octagonalFlange60`;
    bGroup.add(bRose);

    const bStep = new THREE.Mesh(createOctagonalFrustumZ(0.048, 0.044, 0.006), mats.primary);
    bStep.name = `${bGroup.name}.flangeStep`;
    bStep.position.z = 0.008;
    bGroup.add(bStep);

    const bPost = new THREE.Mesh(createOctagonalFrustumZ(0.036, 0.026, railProjZ - 0.014), mats.primary);
    bPost.name = `${bGroup.name}.octagonalArm`;
    bPost.position.z = 0.014;
    bGroup.add(bPost);

    const bClamp = new THREE.Mesh(createOctagonalFrustumY(0.028, 0.028, 0.032), mats.primary);
    bClamp.name = `${bGroup.name}.octagonalRailClamp`;
    bClamp.position.z = railProjZ;
    bGroup.add(bClamp);

    railGroup.add(bGroup);
  }

  // Vertical Ø19mm rail bar (660mm overall height with faceted octagonal end finials)
  const railBar = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0095, 0.0095, railCentersM + 0.056, 18)),
    mats.primary
  );
  railBar.name = `${railGroup.name}.rail5140`;
  railBar.position.set(0, 0, railProjZ);
  railGroup.add(railBar);

  for (const [fLabel, fy] of [
    ['topFinial', halfRailCrs + 0.032],
    ['bottomFinial', -halfRailCrs - 0.032],
  ] as const) {
    const finial = new THREE.Mesh(createOctagonalFrustumY(0.022, 0.015, 0.010), mats.primary);
    finial.name = `${railGroup.name}.${fLabel}`;
    finial.position.set(0, fy, railProjZ);
    railGroup.add(finial);
  }

  // Central octagonal slider carriage (135mm = 0.135m total projection) + faceted clamp handle
  const sliderY = 0.06;
  const sliderBody = new THREE.Mesh(createOctagonalFrustumY(0.032, 0.032, 0.044), mats.primary);
  sliderBody.name = `${railGroup.name}.sliderCarriage`;
  sliderBody.position.set(0, sliderY, railProjZ);
  railGroup.add(sliderBody);

  const sliderCradleArm = new THREE.Mesh(createOctagonalFrustumZ(0.026, 0.024, 0.063), mats.primary);
  sliderCradleArm.name = `${railGroup.name}.sliderCradleArm`;
  sliderCradleArm.position.set(0.030, sliderY, railProjZ);
  railGroup.add(sliderCradleArm);

  const sliderClampKnob = new THREE.Mesh(createOctagonalFrustumZ(0.022, 0.016, 0.026), mats.primary);
  sliderClampKnob.name = `${railGroup.name}.sliderClampKnob`;
  sliderClampKnob.rotation.y = -Math.PI / 2;
  sliderClampKnob.position.set(-0.016, sliderY, railProjZ);
  railGroup.add(sliderClampKnob);

  // `5195PF` (`5185PF`) Stepped Art Deco Handshower Wand (Ø75mm stepped head, faceted grip collars)
  const wandGroup = new THREE.Group();
  wandGroup.name = `${railGroup.name}.handshower5195`;
  wandGroup.position.set(0.052, sliderY - 0.01, 0.118);
  wandGroup.rotation.x = 0.16;

  // Faceted octagonal base hose union & grip collars + contoured Deco handle
  const wandBaseOct = new THREE.Mesh(createOctagonalFrustumY(0.022, 0.024, 0.018), mats.primary);
  wandBaseOct.name = `${wandGroup.name}.octagonalUnion`;
  wandBaseOct.position.y = -0.052;
  wandGroup.add(wandBaseOct);

  const wandGripPts = [
    new THREE.Vector2(0.011, -0.043),
    new THREE.Vector2(0.0145, -0.010),
    new THREE.Vector2(0.0155, 0.028),
    new THREE.Vector2(0.0125, 0.062),
    new THREE.Vector2(0.0105, 0.088),
  ];
  const wandGrip = new THREE.Mesh(
    prepGeo(new THREE.LatheGeometry(wandGripPts, 20)),
    mats.primary
  );
  wandGrip.name = `${wandGroup.name}.decoHandle`;
  wandGroup.add(wandGrip);

  const wandUpperCollar = new THREE.Mesh(createOctagonalFrustumY(0.026, 0.022, 0.014), mats.primary);
  wandUpperCollar.name = `${wandGroup.name}.octagonalNeckCollar`;
  wandUpperCollar.position.y = 0.092;
  wandGroup.add(wandUpperCollar);

  // Ø75mm (0.0375m radius) multi-stepped Art Deco handshower head facing +Z
  const wandHeadPts = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.018, 0.002),
    new THREE.Vector2(0.026, 0.008),
    new THREE.Vector2(0.032, 0.014),
    new THREE.Vector2(0.0375, 0.020),
    new THREE.Vector2(0.0375, 0.028),
    new THREE.Vector2(0.033, 0.028),
    new THREE.Vector2(0, 0.026),
  ];
  const wandHead = new THREE.Mesh(
    prepGeo(new THREE.LatheGeometry(wandHeadPts, 28).rotateX(Math.PI / 2)),
    mats.primary
  );
  wandHead.name = `${wandGroup.name}.steppedDecoHead75`;
  wandHead.position.set(0, 0.130, -0.006);
  wandGroup.add(wandHead);

  const wandFace = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.032, 0.032, 0.002, 24).rotateX(Math.PI / 2)),
    mats.darkShadow
  );
  wandFace.name = `${wandGroup.name}.sprayFace`;
  wandFace.position.set(0, 0.130, 0.022);
  wandGroup.add(wandFace);

  railGroup.add(wandGroup);

  // `5146PF`: Deco Wall Hose Outlet Elbow (58mm AF octagonal flange, 70mm projection, spigot at z=50mm)
  const elbowY = -halfRailCrs - 0.12;
  const elbowX = 0.052;
  const elbowGroup = new THREE.Group();
  elbowGroup.name = `${railGroup.name}.wallOutlet5146`;
  elbowGroup.position.set(elbowX, elbowY, 0);

  const elbowFlange = new THREE.Mesh(createOctagonalFrustumZ(0.058, 0.054, 0.008), mats.primary);
  elbowFlange.name = `${elbowGroup.name}.octagonalFlange58`;
  elbowGroup.add(elbowFlange);

  const elbowBody = new THREE.Mesh(createOctagonalFrustumZ(0.044, 0.030, 0.062), mats.primary);
  elbowBody.name = `${elbowGroup.name}.octagonalBody70`;
  elbowBody.position.z = 0.008;
  elbowGroup.add(elbowBody);

  const elbowSpigot = new THREE.Mesh(createOctagonalFrustumY(0.020, 0.024, 0.018), mats.primary);
  elbowSpigot.name = `${elbowGroup.name}.hoseSpigot50`;
  elbowSpigot.position.set(0, -0.020, 0.050);
  elbowGroup.add(elbowSpigot);

  railGroup.add(elbowGroup);

  // Smooth catenary 1.5m Pewter shower hose linking `5146PF` spigot to `5195PF` wand base
  const hoseCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(elbowX, elbowY - 0.028, 0.050),
    new THREE.Vector3(elbowX + 0.008, elbowY - 0.14, 0.068),
    new THREE.Vector3(elbowX + 0.018, elbowY - 0.19, 0.092),
    new THREE.Vector3(0.055, -0.18, 0.114),
    new THREE.Vector3(0.052, sliderY - 0.068, 0.110),
  ]);
  const hoseMesh = new THREE.Mesh(
    prepGeo(new THREE.TubeGeometry(hoseCurve, 28, 0.0072, 12, false)),
    mats.primary
  );
  hoseMesh.name = `${railGroup.name}.hose1500`;
  railGroup.add(hoseMesh);

  root.add(railGroup);
  attachAssetInteraction(root, {
    kind: 'toggle',
    label: 'Turn On Deco Thermostatic Shower',
    activeLabel: 'Turn Off Deco Shower',
    audio: { openPreset: 'tapValveTurn', closePreset: 'tapValveTurn', activeLoopPreset: 'waterTapFlow', volume: 0.72 },
  });
  const fCode = resolveBrasswareCode(opts.finish, 'NI');
  return attachAssetMetadata(finalizeSanitaryGroup(root, 'plumbing'), {
    name: 'Perrin & Rowe Deco Concealed Thermostatic Shower Set',
    brand: 'Perrin & Rowe',
    collection: 'Deco',
    sku: `PR-5378-${fCode}`,
    finish: formatBrasswareFinishLabel(opts.finish, 'NI'),
    category: 'sanitaryware',
    dimensionsMm: [260, 460, 1140],
    productUrl: 'https://www.perrinandrowe.co.uk/bathroom/deco-collection/',
    schematicUrl: 'https://www.perrinandrowe.co.uk/downloads/spec-sheets/PR-5378-Spec.pdf',
  });
}

// Perrin & Rowe `6122PF` Deco Twin-Prong Robe Hook (55mm AF, W75 × D48mm)

export function buildDecoRobeHook6122(opts: PerrinRoweDecoRobeHookOptions): THREE.Group {
  const { namePrefix, finish } = opts;
  const mats = getBathroomBrassMaterials(finish);

  const root = new THREE.Group();
  root.name = namePrefix;

  // 55mm AF (58mm AC) stepped 8-sided octagonal backplate
  const plate = new THREE.Mesh(createOctagonalFrustumZ(0.055, 0.051, 0.007), mats.primary);
  plate.name = `${namePrefix}.octagonalBackplate55`;
  root.add(plate);

  const step = new THREE.Mesh(createOctagonalFrustumZ(0.042, 0.038, 0.006), mats.primary);
  step.name = `${namePrefix}.backplateStep`;
  step.position.z = 0.007;
  root.add(step);

  // Tapered octagonal central boss projecting to z = 0.034m
  const boss = new THREE.Mesh(createOctagonalFrustumZ(0.030, 0.022, 0.021), mats.primary);
  boss.name = `${namePrefix}.octagonalBoss`;
  boss.position.z = 0.013;
  root.add(boss);

  // Twin upswept Art Deco robe prongs spanning W = 75mm (±0.034m) & projecting D = 48mm (0.048m)
  for (const [sideLabel, sign] of [
    ['leftProng', -1],
    ['rightProng', 1],
  ] as const) {
    const prongCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(sign * 0.006, -0.003, 0.028),
      new THREE.Vector3(sign * 0.020, -0.004, 0.040),
      new THREE.Vector3(sign * 0.0294, 0.012, 0.0422),
    ]);
    const prongTube = new THREE.Mesh(
      prepGeo(new THREE.TubeGeometry(prongCurve, 12, 0.0048, 10, false)),
      mats.primary
    );
    prongTube.name = `${namePrefix}.${sideLabel}`;
    root.add(prongTube);

    const finial = new THREE.Mesh(createOctagonalFrustumY(0.011, 0.014, 0.009), mats.primary);
    finial.name = `${namePrefix}.${sideLabel}Finial`;
    finial.position.set(sign * 0.0298, 0.0155, 0.0418);
    finial.rotation.z = -sign * 0.35;
    root.add(finial);
  }

  return finalizeSanitaryGroup(root, 'sanitary');
}

// Perrin & Rowe `6148PF` Deco Wall Toilet Roll Holder (W160 × H100 × D75mm)

export function buildDecoPaperHolder6148(opts: PerrinRoweDecoPaperHolderOptions): THREE.Group {
  const { namePrefix, finish, includePaperRoll = true } = opts;
  const mats = getBathroomBrassMaterials(finish);

  const root = new THREE.Group();
  root.name = namePrefix;

  // Mounted via 55mm AF stepped octagonal backplate at right side (`x = +0.052m, y = +0.022m`),
  // sweeping down and left across `W = 160mm × H = 100mm × D = 75mm` matching the `6148PF` CAD drawing!
  const mountX = 0.052;
  const mountY = 0.022;

  const rose = new THREE.Mesh(createOctagonalFrustumZ(0.055, 0.051, 0.007), mats.primary);
  rose.name = `${namePrefix}.octagonalBackplate55`;
  rose.position.set(mountX, mountY, 0);
  root.add(rose);

  const roseStep = new THREE.Mesh(createOctagonalFrustumZ(0.042, 0.038, 0.006), mats.primary);
  roseStep.name = `${namePrefix}.backplateStep`;
  roseStep.position.set(mountX, mountY, 0.007);
  root.add(roseStep);

  // Tapered octagonal post projecting to D = 75mm (z = 0.068m centreline)
  const post = new THREE.Mesh(createOctagonalFrustumZ(0.028, 0.020, 0.056), mats.primary);
  post.name = `${namePrefix}.octagonalPost75`;
  post.position.set(mountX, mountY, 0.013);
  root.add(post);

  const postCap = new THREE.Mesh(createOctagonalFrustumZ(0.022, 0.016, 0.007), mats.primary);
  postCap.name = `${namePrefix}.postCap`;
  postCap.position.set(mountX, mountY, 0.069);
  root.add(postCap);

  // Sweeping Deco U-loop open holder arm (from post down-right then horizontal roll bar at y = -0.032m)
  const armCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(mountX, mountY, 0.064),
    new THREE.Vector3(mountX + 0.020, mountY - 0.016, 0.066),
    new THREE.Vector3(mountX + 0.022, -0.026, 0.066),
    new THREE.Vector3(mountX, -0.034, 0.066),
    new THREE.Vector3(-0.072, -0.034, 0.066),
  ]);
  const armTube = new THREE.Mesh(
    prepGeo(new THREE.TubeGeometry(armCurve, 22, 0.0055, 12, false)),
    mats.primary
  );
  armTube.name = `${namePrefix}.holderLoopArm`;
  root.add(armTube);

  // Stepped octagonal retention finial at open left end (`x = -0.076m`)
  const endFinial = new THREE.Mesh(createOctagonalFrustumY(0.016, 0.020, 0.012), mats.primary);
  endFinial.name = `${namePrefix}.octagonalEndFinial`;
  endFinial.rotation.z = Math.PI / 2;
  endFinial.position.set(-0.075, -0.034, 0.066);
  root.add(endFinial);

  if (includePaperRoll) {
    const tissuePaperMat = getDecoTissuePaperMaterial();
    const rollShape = new THREE.Shape();
    rollShape.absarc(0, 0, 0.054, 0, Math.PI * 2, false);
    const coreHole = new THREE.Path();
    coreHole.absarc(0, 0, 0.020, 0, Math.PI * 2, true);
    rollShape.holes.push(coreHole);

    const rollGeo = new THREE.ExtrudeGeometry(rollShape, {
      depth: 0.104,
      bevelEnabled: true,
      bevelSegments: 2,
      steps: 1,
      bevelSize: 0.002,
      bevelThickness: 0.002,
      curveSegments: 28,
    });
    rollGeo.rotateY(Math.PI / 2);
    rollGeo.translate(-0.060, -0.034, 0.066);

    const roll = new THREE.Mesh(prepGeo(rollGeo), tissuePaperMat);
    roll.name = `${namePrefix}.tissueRoll`;
    root.add(roll);
  }

  return finalizeSanitaryGroup(root, 'sanitary');
}

let cachedDecoTissuePaperMat: THREE.MeshStandardMaterial | null = null;
function getDecoTissuePaperMaterial(): THREE.MeshStandardMaterial {
  if (!cachedDecoTissuePaperMat) {
    cachedDecoTissuePaperMat = new THREE.MeshStandardMaterial({
      name: 'Sanitaryware_TissuePaper_Ivory',
      color: 0xf7f5ef,
      roughness: 0.92,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
  }
  return cachedDecoTissuePaperMat;
}
