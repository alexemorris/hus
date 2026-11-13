import { sharedBoxGeometry, sharedCircleGeometry, sharedCylinderGeometry, sharedTorusGeometry } from '../../shared/geometry-cache.ts';
import * as THREE from 'three';
import {
  createConformalDefenderPatchGeometry,
  createConformalLateralWindowOrPanelGeometry,
  type Defender110Materials,
  sampleLateralSurfaceZAtXY,
} from './defender-materials-and-monocoque.ts';
import { tagHighLodDetail } from '../../shared/scene-helpers.ts';
/**
 * Builds a 22-Inch Land Rover Style 5098 5-Spoke Gloss Black Forged Alloy Wheel & Goodyear Wrangler
 * All-Terrain Adventure Tire (`tireR = 0.405m, width = 0.285m`).
 * Can be mounted on any of the 4 road corners (with 380mm ventilated brake rotor & 6-piston/4-piston
 * Xenon Blue V8 brake caliper) or on the rear tailgate spare wheel carrier (`isSpare = true`).
 */
export function buildDefenderStyle5098WheelAssembly(
  parent: THREE.Group,
  meshName: string,
  tireRadius: number,
  rimRadius: number,
  tireWidth: number,
  isLeft: boolean,
  isFront: boolean,
  isSpare: boolean,
  materials: {
    tireRubberMat: THREE.Material;
    tireSidewallMat: THREE.Material;
    narvikGlossBlackMat: THREE.Material;
    satinAnthraciteMat: THREE.Material;
    steelRotorMat: THREE.Material;
    xenonBlueCaliperMat: THREE.Material;
    chromeLugMat: THREE.Material;
    landRoverBadgeMat: THREE.Material;
  },
  namePrefix = 'landRoverDefender'
): THREE.Group {
  const signZ = isLeft ? -1 : 1;
  const wheelGroup = new THREE.Group();
  wheelGroup.name = meshName;
  parent.add(wheelGroup);

  // Goodyear Wrangler All-Terrain Adventure Tire Tread Cylinder (`openEnded = true` so wheel spokes & brakes are 100% visible)
  const treadW = tireWidth * 0.80;
  const treadCyl = new THREE.Mesh(
    sharedCylinderGeometry(tireRadius, tireRadius, treadW, 40, 1, true),
    materials.tireRubberMat
  );
  treadCyl.name = `${meshName}.tireTread`;
  treadCyl.rotation.x = Math.PI / 2;
  treadCyl.castShadow = true;
  treadCyl.receiveShadow = true;
  wheelGroup.add(treadCyl);

  // Sculpted 3D All-Terrain Shoulder Tread Blocks around both outer edges of the tire crown
  const numShoulderBlocks = 30;
  const blockRadius = tireRadius - 0.008;
  for (let i = 0; i < numShoulderBlocks; i++) {
    const ang = (i / numShoulderBlocks) * Math.PI * 2;
    const bx = Math.cos(ang) * blockRadius;
    const by = Math.sin(ang) * blockRadius;
    for (const side of [-1, 1] as const) {
      const lug = new THREE.Mesh(
        sharedBoxGeometry(0.036, 0.016, 0.048),
        materials.tireRubberMat
      );
      lug.name = `${meshName}.shoulderLug`;
      lug.position.set(bx, by, side * (treadW * 0.44));
      lug.rotation.z = ang + Math.PI / 2;
      tagHighLodDetail(lug, 18);
      wheelGroup.add(lug);
    }
  }

  // Moulded All-Terrain Sidewall Torus Rings (`rimRadius -> tireRadius`)
  const sidewallTubeR = (tireRadius - rimRadius) * 0.56;
  const sidewallMajorR = rimRadius + sidewallTubeR * 0.92;
  for (const side of [-1, 1] as const) {
    const sidewallTorus = new THREE.Mesh(
      sharedTorusGeometry(sidewallMajorR, sidewallTubeR, 16, 40),
      materials.tireSidewallMat
    );
    sidewallTorus.name = `${meshName}.tireSidewall`;
    sidewallTorus.scale.set(1, 1, 0.52);
    sidewallTorus.position.set(0, 0, side * (treadW * 0.46));
    wheelGroup.add(sidewallTorus);
  }

  // 22" Style 5098 Gloss Black Forged Alloy Wheel Barrel & Rim Flange
  const barrel = new THREE.Mesh(
    sharedCylinderGeometry(rimRadius, rimRadius * 0.95, tireWidth * 0.80, 36, 1, true),
    materials.narvikGlossBlackMat
  );
  barrel.name = `${meshName}.alloyBarrel`;
  barrel.rotation.x = Math.PI / 2;
  wheelGroup.add(barrel);

  const innerWheelBackDisk = new THREE.Mesh(
    sharedCircleGeometry(rimRadius * 0.94, 32),
    materials.satinAnthraciteMat
  );
  innerWheelBackDisk.name = `${meshName}.innerBackDisk`;
  innerWheelBackDisk.position.set(0, 0, -signZ * (tireWidth * 0.34));
  if (!isLeft) innerWheelBackDisk.rotation.y = Math.PI;
  wheelGroup.add(innerWheelBackDisk);

  const outerFaceZ = signZ * (tireWidth * 0.41);
  const rimLipRing = new THREE.Mesh(
    sharedTorusGeometry(rimRadius, 0.014, 14, 40),
    materials.narvikGlossBlackMat
  );
  rimLipRing.name = `${meshName}.rimLipFlange`;
  rimLipRing.scale.set(1, 1, 0.65);
  rimLipRing.position.set(0, 0, outerFaceZ);
  wheelGroup.add(rimLipRing);

  // 22" Land Rover Style 5098 5-Spoke Gloss Black Forged Alloy Spokes (5 sculpted split/chamfered spokes)
  const hubRadius = 0.072;
  const spokeLen = rimRadius - hubRadius - 0.006;
  const spokeMidR = hubRadius + spokeLen * 0.5;
  for (let s = 0; s < 5; s++) {
    const spokeAngle = (s / 5) * Math.PI * 2 + Math.PI / 10;
    const spokeGroup = new THREE.Group();
    spokeGroup.name = `${meshName}.spokeAssembly`;
    spokeGroup.position.set(
      Math.cos(spokeAngle) * spokeMidR,
      Math.sin(spokeAngle) * spokeMidR,
      outerFaceZ - signZ * 0.015
    );
    spokeGroup.rotation.z = spokeAngle - Math.PI / 2;
    spokeGroup.rotation.x = signZ * 0.09;
    wheelGroup.add(spokeGroup);

    // Central muscular spoke beam
    const mainBeam = new THREE.Mesh(
      sharedBoxGeometry(0.056, spokeLen, 0.026),
      materials.narvikGlossBlackMat
    );
    mainBeam.name = `${meshName}.spokeMainBeam`;
    spokeGroup.add(mainBeam);

    // Twin chamfered outer ribs flanking each Style 5098 spoke
    for (const ribSide of [-1, 1] as const) {
      const rib = new THREE.Mesh(
        sharedBoxGeometry(0.016, spokeLen * 0.94, 0.018),
        materials.satinAnthraciteMat
      );
      rib.name = `${meshName}.spokeChamferRib`;
      rib.position.set(ribSide * 0.038, 0, signZ * 0.008);
      rib.rotation.z = -ribSide * 0.045;
      spokeGroup.add(rib);
    }

    // Recessed central pocket groove along spoke face
    const spokePocket = new THREE.Mesh(
      sharedBoxGeometry(0.018, spokeLen * 0.72, 0.006),
      materials.narvikGlossBlackMat
    );
    spokePocket.name = `${meshName}.spokePocket`;
    spokePocket.position.set(0, 0, signZ * 0.017);
    spokeGroup.add(spokePocket);
  }

  // Center Hub, 5 Chrome Lug Bolts & Land Rover Oval Center Cap
  const hubCyl = new THREE.Mesh(
    sharedCylinderGeometry(hubRadius, hubRadius * 1.08, 0.048, 28),
    materials.narvikGlossBlackMat
  );
  hubCyl.name = `${meshName}.centerHub`;
  hubCyl.rotation.x = Math.PI / 2;
  hubCyl.position.set(0, 0, outerFaceZ - signZ * 0.024);
  wheelGroup.add(hubCyl);

  for (let b = 0; b < 5; b++) {
    const boltAng = (b / 5) * Math.PI * 2;
    const lugBolt = new THREE.Mesh(
      sharedCylinderGeometry(0.0085, 0.0085, 0.022, 10),
      materials.chromeLugMat
    );
    lugBolt.name = `${meshName}.lugBolt`;
    lugBolt.rotation.x = Math.PI / 2;
    lugBolt.position.set(
      Math.cos(boltAng) * 0.048,
      Math.sin(boltAng) * 0.048,
      outerFaceZ - signZ * 0.006
    );
    tagHighLodDetail(lugBolt, 18);
    wheelGroup.add(lugBolt);
  }

  const centerCap = new THREE.Mesh(
    sharedCylinderGeometry(0.034, 0.036, 0.016, 24),
    materials.narvikGlossBlackMat
  );
  centerCap.name = `${meshName}.centerCap`;
  centerCap.rotation.x = Math.PI / 2;
  centerCap.position.set(0, 0, outerFaceZ + signZ * 0.002);
  tagHighLodDetail(centerCap, 18);
  wheelGroup.add(centerCap);

  const badgeDisk = new THREE.Mesh(
    sharedCircleGeometry(0.028, 20),
    materials.landRoverBadgeMat
  );
  badgeDisk.name = `${meshName}.centerCapBadge`;
  badgeDisk.position.set(0, 0, outerFaceZ + signZ * 0.011);
  if (isLeft) badgeDisk.rotation.y = Math.PI;
  tagHighLodDetail(badgeDisk, 18);
  wheelGroup.add(badgeDisk);

  // Road-Corner Ventilated 380mm Steel Brake Disc Rotor + 6-Piston Front / 4-Piston Rear V8 Brake Caliper
  if (!isSpare) {
    const rotorR = isFront ? 0.195 : 0.185;
    const rotorMesh = new THREE.Mesh(
      sharedCylinderGeometry(rotorR, rotorR, 0.028, 36),
      materials.steelRotorMat
    );
    rotorMesh.name = `${namePrefix}.brakeRotor`;
    rotorMesh.rotation.x = Math.PI / 2;
    rotorMesh.position.set(0, 0, outerFaceZ - signZ * 0.068);
    tagHighLodDetail(rotorMesh, 18);
    wheelGroup.add(rotorMesh);

    const caliperAngle = isFront ? 0.35 : Math.PI - 0.35;
    const caliperR = rotorR - 0.028;
    const caliperGroup = new THREE.Group();
    caliperGroup.name = `${namePrefix}.brakeCaliper`;
    caliperGroup.position.set(
      Math.cos(caliperAngle) * caliperR,
      Math.sin(caliperAngle) * caliperR,
      outerFaceZ - signZ * 0.068
    );
    caliperGroup.rotation.z = caliperAngle;
    tagHighLodDetail(caliperGroup, 18);
    wheelGroup.add(caliperGroup);

    const caliperBody = new THREE.Mesh(
      sharedBoxGeometry(0.078, isFront ? 0.195 : 0.155, 0.072),
      materials.xenonBlueCaliperMat
    );
    caliperBody.name = `${namePrefix}.brakeCaliper`;
    tagHighLodDetail(caliperBody, 18);
    caliperGroup.add(caliperBody);

    const caliperBridge = new THREE.Mesh(
      sharedBoxGeometry(0.084, isFront ? 0.145 : 0.115, 0.082),
      materials.narvikGlossBlackMat
    );
    caliperBridge.name = `${namePrefix}.brakeCaliper.bridge`;
    caliperBridge.position.set(0.008, 0, 0);
    tagHighLodDetail(caliperBridge, 18);
    caliperGroup.add(caliperBridge);
  }

  return wheelGroup;
}

/**
 * Builds the tailgate-mounted full-size 22" 5-spoke spare wheel (`landRoverDefender.spareWheel`)
 * and all 4 road-corner 22" Style 5098 wheels, All-Terrain tires, and Xenon Blue V8 brake assemblies.
 */
export function buildDefender110WheelsAndSpare(
  defenderGroup: THREE.Group,
  mats: Defender110Materials,
  namePrefix = 'landRoverDefender'
): void {
  const wheelMatBundle = {
    tireRubberMat: mats.tireRubberMat,
    tireSidewallMat: mats.tireSidewallMat,
    narvikGlossBlackMat: mats.narvikGlossBlackMat,
    satinAnthraciteMat: mats.satinAnthraciteMat,
    steelRotorMat: mats.steelRotorMat,
    xenonBlueCaliperMat: mats.xenonBlueCaliperMat,
    chromeLugMat: mats.chromeLugMat,
    landRoverBadgeMat: mats.landRoverBadgeMat,
  };

  // Tailgate-Mounted Full-Size 22" 5-Spoke Gloss Black Spare Wheel (`landRoverDefender.spareWheel`)
  // centered at `(x = +2.49m, y = 1.06m, z = 0)` with axle along X (`rotation.y = Math.PI / 2`)
  const spareWheelMountBracket = new THREE.Mesh(
    sharedCylinderGeometry(0.11, 0.14, 0.14, 20),
    mats.narvikGlossBlackMat
  );
  spareWheelMountBracket.name = `${namePrefix}.spareWheel.mountBracket`;
  spareWheelMountBracket.rotation.z = Math.PI / 2;
  spareWheelMountBracket.position.set(2.39, 1.06, 0);
  defenderGroup.add(spareWheelMountBracket);

  const spareWheelGroup = buildDefenderStyle5098WheelAssembly(
    defenderGroup,
    `${namePrefix}.spareWheel`,
    0.405,
    0.282,
    0.285,
    false,
    false,
    true,
    wheelMatBundle,
    namePrefix
  );
  spareWheelGroup.position.set(2.49, 1.06, 0);
  spareWheelGroup.rotation.y = Math.PI / 2; // Outer 5-spoke face points rearward (+X)!

  // Gloss Black Land Rover Defender Spare Wheel Centre Hub Cover Disc
  const spareCenterCover = new THREE.Mesh(
    sharedCylinderGeometry(0.115, 0.122, 0.028, 28),
    mats.santoriniBlackBodyMat
  );
  spareCenterCover.name = `${namePrefix}.spareWheel.centerHubCover`;
  spareCenterCover.rotation.x = Math.PI / 2;
  spareCenterCover.position.set(0, 0, 0.122);
  spareWheelGroup.add(spareCenterCover);

  const spareCenterBadge = new THREE.Mesh(
    new THREE.PlaneGeometry(0.076, 0.038),
    mats.landRoverBadgeMat
  );
  spareCenterBadge.name = `${namePrefix}.spareWheel.centerBadge`;
  spareCenterBadge.position.set(0, 0, 0.137);
  tagHighLodDetail(spareCenterBadge, 18);
  spareWheelGroup.add(spareCenterBadge);

  // 4× 22-Inch Style 5098 5-Spoke Gloss Black Road Wheels, All-Terrain Tires & V8 Brakes
  // Front Left & Right (`x = -1.51m, y = 0.405m, z = ±0.86m`, `tireR = 0.405m, width = 0.285m`)
  const flWheel = buildDefenderStyle5098WheelAssembly(
    defenderGroup,
    `${namePrefix}.wheel`,
    0.405,
    0.282,
    0.285,
    true,
    true,
    false,
    wheelMatBundle,
    namePrefix
  );
  flWheel.position.set(-1.51, 0.405, -0.86);

  const frWheel = buildDefenderStyle5098WheelAssembly(
    defenderGroup,
    `${namePrefix}.wheel`,
    0.405,
    0.282,
    0.285,
    false,
    true,
    false,
    wheelMatBundle,
    namePrefix
  );
  frWheel.position.set(-1.51, 0.405, 0.86);

  // Rear Left & Right (`x = +1.51m, y = 0.405m, z = ±0.86m`, `tireR = 0.405m, width = 0.285m`)
  const rlWheel = buildDefenderStyle5098WheelAssembly(
    defenderGroup,
    `${namePrefix}.wheel`,
    0.405,
    0.282,
    0.285,
    true,
    false,
    false,
    wheelMatBundle,
    namePrefix
  );
  rlWheel.position.set(1.51, 0.405, -0.86);

  const rrWheel = buildDefenderStyle5098WheelAssembly(
    defenderGroup,
    `${namePrefix}.wheel`,
    0.405,
    0.282,
    0.285,
    false,
    false,
    false,
    wheelMatBundle,
    namePrefix
  );
  rrWheel.position.set(1.51, 0.405, 0.86);
}

/**
 * Builds the conformal glazing, exterior wing mirrors, flush door handles, tubular rock-slider
 * side steps, and high-LOD L663 4-door cabin interior (`landRoverDefender.interior`).
 */
export function buildDefender110GlazingTrimAndCabinInterior(
  defenderGroup: THREE.Group,
  mats: Defender110Materials,
  namePrefix = 'landRoverDefender'
): void {
  const glazingGroup = new THREE.Group();
  glazingGroup.name = `${namePrefix}.glazing`;
  defenderGroup.add(glazingGroup);

  // Conformal Flush Raked L663 Front Windshield (`x = -1.02m..-0.38m`) with Narvik Black A-Pillar Surround
  const windshieldBorderGeo = createConformalDefenderPatchGeometry(
    -1.03,
    -0.37,
    () => 0.0,
    () => 0.305,
    22,
    24,
    0.006,
    0.006,
    false
  );
  const windshieldBorderMesh = new THREE.Mesh(windshieldBorderGeo, mats.narvikGlossBlackMat);
  windshieldBorderMesh.name = `${namePrefix}.glazing.windshieldBorder`;
  glazingGroup.add(windshieldBorderMesh);

  const windshieldGlassGeo = createConformalDefenderPatchGeometry(
    -1.00,
    -0.40,
    () => 0.0,
    () => 0.285,
    22,
    24,
    0.011,
    0.011,
    false
  );
  const windshieldMesh = new THREE.Mesh(windshieldGlassGeo, mats.tintedPrivacyGlassMat);
  windshieldMesh.name = `${namePrefix}.glazing`;
  glazingGroup.add(windshieldMesh);

  // Conformal Flush Tumblehome Side Glazing (Front Door Window, Rear Door Window, and Rear Quarter Cargo Glass)
  //    with Gloss Black B/C/D Pillar Surround from `x = -0.96m` to `x = +2.30m`, `y = 1.22m..1.865m`
  const sidePillarSurroundGeo = createConformalLateralWindowOrPanelGeometry(
    -0.96,
    2.30,
    (x) => (x < -0.52 ? THREE.MathUtils.lerp(1.225, 1.22, (x - -0.96) / 0.44) : 1.22),
    (x) =>
      x < -0.38
        ? THREE.MathUtils.lerp(1.28, 1.865, Math.max(0, (x - -0.96) / 0.58))
        : 1.865,
    42,
    14,
    0.0065,
    [-1, 1]
  );
  const sidePillarSurroundMesh = new THREE.Mesh(sidePillarSurroundGeo, mats.narvikGlossBlackMat);
  sidePillarSurroundMesh.name = `${namePrefix}.glazing.pillarSurround`;
  glazingGroup.add(sidePillarSurroundMesh);

  // Front Door Windows (`x = -0.90m..-0.04m`)
  const frontDoorGlassGeo = createConformalLateralWindowOrPanelGeometry(
    -0.90,
    -0.04,
    () => 1.235,
    (x) =>
      x < -0.38
        ? THREE.MathUtils.lerp(1.30, 1.845, Math.max(0, (x - -0.90) / 0.52))
        : 1.845,
    18,
    12,
    0.0115,
    [-1, 1]
  );
  const frontDoorGlassMesh = new THREE.Mesh(frontDoorGlassGeo, mats.tintedPrivacyGlassMat);
  frontDoorGlassMesh.name = `${namePrefix}.glazing.frontDoorWindow`;
  glazingGroup.add(frontDoorGlassMesh);

  // Rear Passenger Door Windows (`x = +0.04m..+0.80m`, forward of the C-pillar Signature Graphic)
  const rearDoorGlassGeo = createConformalLateralWindowOrPanelGeometry(
    0.04,
    0.80,
    () => 1.235,
    () => 1.845,
    16,
    12,
    0.0115,
    [-1, 1]
  );
  const rearDoorGlassMesh = new THREE.Mesh(rearDoorGlassGeo, mats.tintedPrivacyGlassMat);
  rearDoorGlassMesh.name = `${namePrefix}.glazing.rearDoorWindow`;
  glazingGroup.add(rearDoorGlassMesh);

  // Rear Quarter Cargo Windows (`x = +1.28m..+2.26m`, behind the C-pillar Signature Graphic `x = +0.82m..+1.26m`)
  const rearQuarterGlassGeo = createConformalLateralWindowOrPanelGeometry(
    1.28,
    2.26,
    () => 1.235,
    () => 1.845,
    16,
    12,
    0.0115,
    [-1, 1]
  );
  const rearQuarterGlassMesh = new THREE.Mesh(rearQuarterGlassGeo, mats.tintedPrivacyGlassMat);
  rearQuarterGlassMesh.name = `${namePrefix}.glazing.rearQuarterWindow`;
  glazingGroup.add(rearQuarterGlassMesh);

  // Heated Rear Tailgate Window (`x = +2.28m..+2.35m, y = 1.24m..1.86m, z = -0.66m..+0.66m`)
  const rearTailgateGlass = new THREE.Mesh(
    sharedBoxGeometry(0.018, 0.58, 1.32),
    mats.tintedPrivacyGlassMat
  );
  rearTailgateGlass.name = `${namePrefix}.glazing`;
  rearTailgateGlass.position.set(2.332, 1.55, 0);
  rearTailgateGlass.rotation.z = 0.095;
  glazingGroup.add(rearTailgateGlass);

  // 4 Flush Body-Color Door Handles (`x = -0.18m` front doors, `x = +0.62m` rear doors) &
  //    Sculpted Twin-Arm Defender Wing Mirrors (`x = -0.76m, y = 1.22m`) with puddle-light housings
  for (const sideZ of [-1, 1] as const) {
    for (const handleX of [-0.18, 0.62] as const) {
      const handleY = 1.135;
      const zSurf = sampleLateralSurfaceZAtXY(handleX, handleY);
      const handleRecess = new THREE.Mesh(
        sharedBoxGeometry(0.175, 0.042, 0.012),
        mats.narvikGlossBlackMat
      );
      handleRecess.name = `${namePrefix}.doorHandle.recess`;
      handleRecess.position.set(handleX, handleY, sideZ * (zSurf + 0.002));
      defenderGroup.add(handleRecess);

      const handleBar = new THREE.Mesh(
        sharedBoxGeometry(0.165, 0.028, 0.024),
        mats.santoriniBlackBodyMat
      );
      handleBar.name = `${namePrefix}.doorHandle`;
      handleBar.position.set(handleX, handleY, sideZ * (zSurf + 0.012));
      handleBar.castShadow = true;
      defenderGroup.add(handleBar);
    }

    // Sculpted Twin-Arm L663 Wing Mirror (`x = -0.76m, y = 1.22m`) anchored flush into the door shoulder
    const mirrorGroup = new THREE.Group();
    mirrorGroup.name = `${namePrefix}.wingMirror`;
    const mirrorBaseZ = sampleLateralSurfaceZAtXY(-0.76, 1.22);
    mirrorGroup.position.set(-0.76, 1.22, sideZ * (mirrorBaseZ - 0.01));
    defenderGroup.add(mirrorGroup);

    for (const armY of [-0.018, 0.018] as const) {
      const twinArm = new THREE.Mesh(
        sharedBoxGeometry(0.068, 0.018, 0.095),
        mats.narvikGlossBlackMat
      );
      twinArm.name = `${namePrefix}.wingMirror.supportArm`;
      twinArm.position.set(0, armY, sideZ * 0.042);
      mirrorGroup.add(twinArm);
    }

    const mirrorHousing = new THREE.Mesh(
      sharedBoxGeometry(0.115, 0.145, 0.185),
      mats.santoriniBlackBodyMat
    );
    mirrorHousing.name = `${namePrefix}.wingMirror.housing`;
    mirrorHousing.position.set(0.02, 0.025, sideZ * 0.115);
    mirrorHousing.castShadow = true;
    mirrorGroup.add(mirrorHousing);

    const mirrorGlassFace = new THREE.Mesh(
      sharedBoxGeometry(0.012, 0.125, 0.165),
      mats.tintedPrivacyGlassMat
    );
    mirrorGlassFace.name = `${namePrefix}.wingMirror.glass`;
    mirrorGlassFace.position.set(0.088, 0.025, sideZ * 0.115);
    mirrorGroup.add(mirrorGlassFace);

    const puddleLight = new THREE.Mesh(
      sharedBoxGeometry(0.032, 0.008, 0.045),
      mats.ledHaloWhiteMat
    );
    puddleLight.name = `${namePrefix}.wingMirror.puddleLamp`;
    puddleLight.position.set(0.015, -0.052, sideZ * 0.085);
    mirrorGroup.add(puddleLight);
  }

  // D. Tubular Satin-Black Rock-Slider Side Steps (`x = -0.95m..+0.95m, y = 0.26m, z = ±0.96m`)
  //    with diamond chequer-plate step pads
  for (const sideZ of [-1, 1] as const) {
    const sideStepGroup = new THREE.Group();
    sideStepGroup.name = `${namePrefix}.sideStep`;
    defenderGroup.add(sideStepGroup);

    const sliderTube = new THREE.Mesh(
      sharedCylinderGeometry(0.032, 0.032, 1.90, 18),
      mats.satinAnthraciteMat
    );
    sliderTube.name = `${namePrefix}.sideStep.rockSliderTube`;
    sliderTube.rotation.z = Math.PI / 2;
    sliderTube.position.set(0.0, 0.26, sideZ * 0.975);
    sliderTube.castShadow = true;
    sideStepGroup.add(sliderTube);

    const stepPad = new THREE.Mesh(
      sharedBoxGeometry(1.82, 0.018, 0.11),
      mats.chequerPlateMat
    );
    stepPad.name = `${namePrefix}.sideStep.chequerStepPad`;
    stepPad.position.set(0.0, 0.305, sideZ * 0.945);
    stepPad.receiveShadow = true;
    sideStepGroup.add(stepPad);

    for (const bracketX of [-0.78, 0.0, 0.78] as const) {
      const bracket = new THREE.Mesh(
        sharedBoxGeometry(0.085, 0.045, 0.16),
        mats.narvikGlossBlackMat
      );
      bracket.name = `${namePrefix}.sideStep.mountBracket`;
      bracket.position.set(bracketX, 0.245, sideZ * 0.89);
      sideStepGroup.add(bracket);
    }
  }

  // E. Detailed L663 4-Door Cabin Interior (`landRoverDefender.interior`)
  const interiorGroup = new THREE.Group();
  interiorGroup.name = `${namePrefix}.interior`;
  tagHighLodDetail(interiorGroup, 18);
  defenderGroup.add(interiorGroup);

  // Cabin floor & center console tunnel
  const cabinFloor = new THREE.Mesh(
    sharedBoxGeometry(2.65, 0.04, 1.56),
    mats.narvikGlossBlackMat
  );
  cabinFloor.name = `${namePrefix}.interior.cabinFloor`;
  cabinFloor.position.set(0.45, 0.48, 0);
  tagHighLodDetail(cabinFloor, 18);
  interiorGroup.add(cabinFloor);

  const centerConsole = new THREE.Mesh(
    sharedBoxGeometry(1.15, 0.38, 0.34),
    mats.ebonyWindsorLeatherMat
  );
  centerConsole.name = `${namePrefix}.interior.centerConsole`;
  centerConsole.position.set(-0.26, 0.72, 0);
  tagHighLodDetail(centerConsole, 18);
  interiorGroup.add(centerConsole);

  // Signature L663 Exposed Magnesium Cross-Car Structural Dashboard Beam (`x = -0.64m, y = 1.18m, z = -0.78m..+0.78m`)
  // with `DEFENDER` debossed end caps & open storage shelf
  const dashUpperShelf = new THREE.Mesh(
    sharedBoxGeometry(0.36, 0.16, 1.52),
    mats.ebonyWindsorLeatherMat
  );
  dashUpperShelf.name = `${namePrefix}.interior.dashUpperShelf`;
  dashUpperShelf.position.set(-0.68, 1.18, 0);
  tagHighLodDetail(dashUpperShelf, 18);
  interiorGroup.add(dashUpperShelf);

  const magnesiumBeam = new THREE.Mesh(
    sharedBoxGeometry(0.085, 0.105, 1.58),
    mats.magnesiumCrossBeamMat
  );
  magnesiumBeam.name = `${namePrefix}.interior`;
  magnesiumBeam.position.set(-0.56, 1.16, 0);
  tagHighLodDetail(magnesiumBeam, 18);
  interiorGroup.add(magnesiumBeam);

  for (const sideZ of [-1, 1] as const) {
    const endCap = new THREE.Mesh(
      sharedBoxGeometry(0.11, 0.12, 0.024),
      mats.satinAnthraciteMat
    );
    endCap.name = `${namePrefix}.interior.crossBeamEndCap`;
    endCap.position.set(-0.56, 1.16, sideZ * 0.795);
    tagHighLodDetail(endCap, 18);
    interiorGroup.add(endCap);

    // Grab handle on cross-car beam
    const grabHandle = new THREE.Mesh(
      sharedBoxGeometry(0.045, 0.095, 0.032),
      mats.magnesiumCrossBeamMat
    );
    grabHandle.name = `${namePrefix}.interior.crossBeamGrabHandle`;
    grabHandle.position.set(-0.51, 1.18, sideZ * 0.68);
    tagHighLodDetail(grabHandle, 18);
    interiorGroup.add(grabHandle);
  }

  // 11.4" Curved Pivi Pro Central Touchscreen (`x = -0.58m, y = 1.22m, z = 0`)
  const piviScreenBezel = new THREE.Mesh(
    sharedBoxGeometry(0.026, 0.175, 0.295),
    mats.narvikGlossBlackMat
  );
  piviScreenBezel.name = `${namePrefix}.interior.piviScreenBezel`;
  piviScreenBezel.position.set(-0.54, 1.21, 0);
  piviScreenBezel.rotation.z = -0.18;
  tagHighLodDetail(piviScreenBezel, 18);
  interiorGroup.add(piviScreenBezel);

  const piviScreenDisplay = new THREE.Mesh(
    sharedBoxGeometry(0.012, 0.155, 0.275),
    new THREE.MeshStandardMaterial({
      color: 0x162436,
      emissive: new THREE.Color(0x0c2440),
      emissiveIntensity: 0.75,
      roughness: 0.1,
    })
  );
  piviScreenDisplay.name = `${namePrefix}.interior.piviScreenDisplay`;
  piviScreenDisplay.position.set(-0.525, 1.21, 0);
  piviScreenDisplay.rotation.z = -0.18;
  tagHighLodDetail(piviScreenDisplay, 18);
  interiorGroup.add(piviScreenDisplay);

  // Interactive Driver Display Cluster & RHD 4-Spoke Defender Steering Wheel (`z = +0.40m` for UK right-hand-drive)
  const driverCluster = new THREE.Mesh(
    sharedBoxGeometry(0.045, 0.14, 0.32),
    mats.narvikGlossBlackMat
  );
  driverCluster.name = `${namePrefix}.interior.driverCluster`;
  driverCluster.position.set(-0.55, 1.335, 0.40);
  tagHighLodDetail(driverCluster, 18);
  interiorGroup.add(driverCluster);

  const steeringColumn = new THREE.Mesh(
    sharedCylinderGeometry(0.042, 0.048, 0.24, 14),
    mats.narvikGlossBlackMat
  );
  steeringColumn.name = `${namePrefix}.interior.steeringColumn`;
  steeringColumn.rotation.z = Math.PI / 2 - 0.32;
  steeringColumn.position.set(-0.46, 1.18, 0.40);
  tagHighLodDetail(steeringColumn, 18);
  interiorGroup.add(steeringColumn);

  const steeringWheelGroup = new THREE.Group();
  steeringWheelGroup.name = `${namePrefix}.interior.steeringWheel`;
  steeringWheelGroup.position.set(-0.36, 1.22, 0.40);
  steeringWheelGroup.rotation.z = -0.32;
  tagHighLodDetail(steeringWheelGroup, 18);
  interiorGroup.add(steeringWheelGroup);

  const steeringRim = new THREE.Mesh(
    sharedTorusGeometry(0.185, 0.022, 12, 28),
    mats.ebonyWindsorLeatherMat
  );
  steeringRim.name = `${namePrefix}.interior.steeringRim`;
  steeringRim.rotation.y = Math.PI / 2;
  tagHighLodDetail(steeringRim, 18);
  steeringWheelGroup.add(steeringRim);

  const steeringHub = new THREE.Mesh(
    sharedCylinderGeometry(0.068, 0.068, 0.036, 18),
    mats.ebonyWindsorLeatherMat
  );
  steeringHub.name = `${namePrefix}.interior.steeringHub`;
  steeringHub.rotation.z = Math.PI / 2;
  tagHighLodDetail(steeringHub, 18);
  steeringWheelGroup.add(steeringHub);

  // 4-Spoke Magnesium Defender Steering Wheel Spokes
  for (const spokeAng of [-0.42, 0.42, Math.PI - 0.42, Math.PI + 0.42] as const) {
    const swSpoke = new THREE.Mesh(
      sharedBoxGeometry(0.022, 0.115, 0.028),
      mats.magnesiumCrossBeamMat
    );
    swSpoke.name = `${namePrefix}.interior.steeringSpoke`;
    swSpoke.position.set(0, Math.sin(spokeAng) * 0.11, Math.cos(spokeAng) * 0.11);
    swSpoke.rotation.x = -spokeAng + Math.PI / 2;
    tagHighLodDetail(swSpoke, 18);
    steeringWheelGroup.add(swSpoke);
  }

  // Ebony Windsor Leather Front Seats (`x = -0.22m, z = ±0.40m`)
  for (const seatZ of [-0.40, 0.40] as const) {
    const fSeatGroup = new THREE.Group();
    fSeatGroup.name = `${namePrefix}.interior.frontSeat`;
    fSeatGroup.position.set(-0.22, 0.68, seatZ);
    tagHighLodDetail(fSeatGroup, 18);
    interiorGroup.add(fSeatGroup);

    const seatCushion = new THREE.Mesh(
      sharedBoxGeometry(0.52, 0.14, 0.48),
      mats.ebonyWindsorLeatherMat
    );
    seatCushion.name = `${namePrefix}.interior.frontSeatCushion`;
    tagHighLodDetail(seatCushion, 18);
    fSeatGroup.add(seatCushion);

    const seatBackrest = new THREE.Mesh(
      sharedBoxGeometry(0.14, 0.64, 0.46),
      mats.ebonyWindsorLeatherMat
    );
    seatBackrest.name = `${namePrefix}.interior.frontSeatBackrest`;
    seatBackrest.position.set(0.20, 0.36, 0);
    seatBackrest.rotation.z = -0.18;
    tagHighLodDetail(seatBackrest, 18);
    fSeatGroup.add(seatBackrest);

    const headrest = new THREE.Mesh(
      sharedBoxGeometry(0.11, 0.21, 0.24),
      mats.ebonyWindsorLeatherMat
    );
    headrest.name = `${namePrefix}.interior.frontSeatHeadrest`;
    headrest.position.set(0.26, 0.76, 0);
    headrest.rotation.z = -0.12;
    tagHighLodDetail(headrest, 18);
    fSeatGroup.add(headrest);
  }

  // 60:40 Second-Row Ebony Windsor Leather Bench Seats (`x = +0.68m, z = -0.66m..+0.66m`)
  const secondRowGroup = new THREE.Group();
  secondRowGroup.name = `${namePrefix}.interior.secondRowBench`;
  secondRowGroup.position.set(0.68, 0.70, 0);
  tagHighLodDetail(secondRowGroup, 18);
  interiorGroup.add(secondRowGroup);

  // 60% Left-Center Bench Section (`z = -0.66m..+0.12m`) & 40% Right Section (`z = +0.14m..+0.66m`)
  for (const [secZ, secWidth] of [
    [-0.27, 0.78],
    [0.40, 0.52],
  ] as const) {
    const benchCushion = new THREE.Mesh(
      sharedBoxGeometry(0.48, 0.14, secWidth),
      mats.ebonyWindsorLeatherMat
    );
    benchCushion.name = `${namePrefix}.interior.secondRowCushion`;
    benchCushion.position.set(0, 0, secZ);
    tagHighLodDetail(benchCushion, 18);
    secondRowGroup.add(benchCushion);

    const benchBack = new THREE.Mesh(
      sharedBoxGeometry(0.13, 0.58, secWidth - 0.02),
      mats.ebonyWindsorLeatherMat
    );
    benchBack.name = `${namePrefix}.interior.secondRowBackrest`;
    benchBack.position.set(0.19, 0.32, secZ);
    benchBack.rotation.z = -0.16;
    tagHighLodDetail(benchBack, 18);
    secondRowGroup.add(benchBack);
  }

  for (const hrZ of [-0.46, 0.0, 0.46] as const) {
    const rearHeadrest = new THREE.Mesh(
      sharedBoxGeometry(0.10, 0.18, 0.22),
      mats.ebonyWindsorLeatherMat
    );
    rearHeadrest.name = `${namePrefix}.interior.secondRowHeadrest`;
    rearHeadrest.position.set(0.24, 0.68, hrZ);
    tagHighLodDetail(rearHeadrest, 18);
    secondRowGroup.add(rearHeadrest);
  }
}
