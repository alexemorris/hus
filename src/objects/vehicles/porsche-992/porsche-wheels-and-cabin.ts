import { sharedBoxGeometry, sharedCircleGeometry, sharedCylinderGeometry, sharedSphereGeometry, sharedTorusGeometry } from '../../shared/geometry-cache.ts';
import * as THREE from 'three';
import {
  createConformalBodyPatchGeometry,
  createSideWindowDloGeometry,
  type Porsche992Materials,
} from './porsche-materials-and-body.ts';
import { tagHighLodDetail } from '../../shared/scene-helpers.ts';

/**
 * Builds the flush compound-curved glazing (windshield, fastback rear window, and iconic
 * 911 parabolic spear side windows with B-pillar & rear-quarter glass division) and the
 * high-detail 992.2 interior cabin.
 */
export function buildPorsche992GlazingAndInteriorCabin(
  carGroup: THREE.Group,
  mats: Porsche992Materials,
  namePrefix = 'porsche992TurboS'
): void {
  // Flush Compound-Curved Glazing (`porsche992TurboS.glazing`)
  const glazingGroup = new THREE.Group();
  glazingGroup.name = `${namePrefix}.glazing`;
  carGroup.add(glazingGroup);

  // Front Windshield (flush conformal patch with thin satin-black ceramic frit border)
  const windshieldBorderGeo = createConformalBodyPatchGeometry(
    -0.92,
    -0.26,
    () => 0.0,
    () => 0.295,
    24,
    24,
    0.0025,
    false
  );
  const windshieldBorderMesh = new THREE.Mesh(windshieldBorderGeo, mats.glossBlackTrimMat);
  windshieldBorderMesh.name = `${namePrefix}.glazing.windshieldBorder`;
  glazingGroup.add(windshieldBorderMesh);

  const windshieldGlassGeo = createConformalBodyPatchGeometry(
    -0.88,
    -0.30,
    () => 0.0,
    () => 0.275,
    24,
    24,
    0.0042,
    false
  );
  const windshieldGlassMesh = new THREE.Mesh(windshieldGlassGeo, mats.tintedGlassMat);
  windshieldGlassMesh.name = `${namePrefix}.glazing`;
  glazingGroup.add(windshieldGlassMesh);

  // Fastback Rear Window (`x = +0.46m .. +1.54m`)
  const rearGlassBorderGeo = createConformalBodyPatchGeometry(
    0.46,
    1.54,
    () => 0.0,
    () => 0.285,
    24,
    22,
    0.0025,
    false
  );
  const rearGlassBorderMesh = new THREE.Mesh(rearGlassBorderGeo, mats.glossBlackTrimMat);
  rearGlassBorderMesh.name = `${namePrefix}.glazing.rearWindowBorder`;
  glazingGroup.add(rearGlassBorderMesh);

  const rearGlassGeo = createConformalBodyPatchGeometry(
    0.50,
    1.50,
    () => 0.0,
    () => 0.265,
    24,
    22,
    0.0042,
    false
  );
  const rearGlassMesh = new THREE.Mesh(rearGlassGeo, mats.tintedGlassMat);
  rearGlassMesh.name = `${namePrefix}.glazing`;
  glazingGroup.add(rearGlassMesh);

  // Iconic Porsche 911 Teardrop Spear Side Windows (`DLO`)
  const sideWindowTrimGeo = createSideWindowDloGeometry(0.018, 0.014, 0.0028);
  const sideWindowTrimMesh = new THREE.Mesh(sideWindowTrimGeo, mats.glossBlackTrimMat);
  sideWindowTrimMesh.name = `${namePrefix}.glazing.sideWindowTrim`;
  glazingGroup.add(sideWindowTrimMesh);

  const sideWindowGlassGeo = createSideWindowDloGeometry(0.0, 0.0, 0.0045);
  const sideWindowGlassMesh = new THREE.Mesh(sideWindowGlassGeo, mats.tintedGlassMat);
  sideWindowGlassMesh.name = `${namePrefix}.glazing`;
  glazingGroup.add(sideWindowGlassMesh);

  // Gloss-black vertical B-pillar divider bar (`x = +0.26m`) between door window and rear quarter spear window
  for (const sideZ of [-1, 1] as const) {
    const bPillarBar = new THREE.Mesh(
      sharedBoxGeometry(0.032, 0.30, 0.012),
      mats.glossBlackTrimMat
    );
    bPillarBar.name = `${namePrefix}.glazing.bPillarDivider`;
    bPillarBar.position.set(0.26, 1.03, sideZ * 0.725);
    bPillarBar.rotation.x = sideZ * 0.52;
    bPillarBar.rotation.z = -0.18;
    glazingGroup.add(bPillarBar);
  }

  // Detailed 992.2 Interior Cabin (`porsche992TurboS.interior`)
  const interiorGroup = new THREE.Group();
  interiorGroup.name = `${namePrefix}.interior`;
  tagHighLodDetail(interiorGroup, 18);
  carGroup.add(interiorGroup);

  const dashCowling = new THREE.Mesh(
    sharedBoxGeometry(0.38, 0.16, 1.12),
    mats.slateLeatherMat
  );
  dashCowling.name = `${namePrefix}.interior.dashCowling`;
  dashCowling.position.set(-0.56, 0.80, 0);
  tagHighLodDetail(dashCowling, 18);
  interiorGroup.add(dashCowling);

  // Interior rearview mirror + ADAS camera pod at top center of windshield (`x = -0.38m, y = 1.17m, z = 0`)
  const rearViewMirror = new THREE.Mesh(
    sharedBoxGeometry(0.055, 0.038, 0.18),
    mats.glossBlackTrimMat
  );
  rearViewMirror.name = `${namePrefix}.interior.rearViewMirror`;
  rearViewMirror.position.set(-0.38, 1.165, 0);
  tagHighLodDetail(rearViewMirror, 18);
  interiorGroup.add(rearViewMirror);

  const chronoPod = new THREE.Mesh(
    sharedCylinderGeometry(0.036, 0.042, 0.055, 16),
    mats.slateLeatherMat
  );
  chronoPod.name = `${namePrefix}.interior.sportChronoPod`;
  chronoPod.rotation.z = Math.PI / 2;
  chronoPod.position.set(-0.52, 0.89, 0);
  tagHighLodDetail(chronoPod, 18);
  interiorGroup.add(chronoPod);

  // RHD GT Sport Steering Wheel (`z = +0.34m` for UK right-hand-drive)
  const steeringWheel = new THREE.Mesh(
    sharedTorusGeometry(0.155, 0.018, 12, 24),
    mats.slateLeatherMat
  );
  steeringWheel.name = `${namePrefix}.interior.steeringWheel`;
  steeringWheel.rotation.y = Math.PI / 2;
  steeringWheel.rotation.z = -0.32;
  steeringWheel.position.set(-0.32, 0.83, 0.34);
  tagHighLodDetail(steeringWheel, 18);
  interiorGroup.add(steeringWheel);

  // Two 18-Way Adaptive Sport Seats Plus with integrated sculpted headrests
  for (const seatZ of [-0.34, 0.34] as const) {
    const seatBase = new THREE.Mesh(
      sharedBoxGeometry(0.46, 0.11, 0.44),
      mats.slateLeatherMat
    );
    seatBase.name = `${namePrefix}.interior.seatBase`;
    seatBase.position.set(0.0, 0.46, seatZ);
    tagHighLodDetail(seatBase, 18);
    interiorGroup.add(seatBase);

    const seatBack = new THREE.Mesh(
      sharedBoxGeometry(0.11, 0.56, 0.42),
      mats.slateLeatherMat
    );
    seatBack.name = `${namePrefix}.interior.seatBackrest`;
    seatBack.position.set(0.22, 0.76, seatZ);
    seatBack.rotation.z = -0.22;
    tagHighLodDetail(seatBack, 18);
    interiorGroup.add(seatBack);

    const seatHeadrest = new THREE.Mesh(
      sharedSphereGeometry(0.095, 14, 12),
      mats.slateLeatherMat
    );
    seatHeadrest.name = `${namePrefix}.interior.seatHeadrest`;
    seatHeadrest.scale.set(0.58, 1.35, 1.15);
    seatHeadrest.position.set(0.285, 1.055, seatZ);
    seatHeadrest.rotation.z = -0.18;
    tagHighLodDetail(seatHeadrest, 18);
    interiorGroup.add(seatHeadrest);

    const seatCenterInsert = new THREE.Mesh(
      sharedBoxGeometry(0.018, 0.42, 0.26),
      mats.chalkLeatherMat
    );
    seatCenterInsert.name = `${namePrefix}.interior.seatInsert`;
    seatCenterInsert.position.set(
      0.22 - 0.068 * Math.cos(-0.22),
      0.74 - 0.068 * Math.sin(-0.22),
      seatZ
    );
    seatCenterInsert.rotation.z = -0.22;
    tagHighLodDetail(seatCenterInsert, 18);
    interiorGroup.add(seatCenterInsert);
  }
}

/**
 * Builds a single high-LOD 20"/21" Porsche 992.2 Turbo S Exclusive Design 10-Twin-Spoke (20-blade Y-spoke)
 * Forged Center-Lock Wheel in Dark Turbonite with Diamond-Turned Machined Front Faces,
 * Michelin Pilot Sport 4S tire, 420mm/390mm PCCB cross-drilled carbon-ceramic rotor with rotor bell & bobbins,
 * and curved 10-piston / 4-piston Porsche Speed Yellow monobloc brake caliper.
 */
export function buildPorscheTurboSWheelCorner(
  parent: THREE.Group,
  x: number,
  y: number,
  z: number,
  tireRadius: number,
  rimRadius: number,
  tireWidth: number,
  isLeft: boolean,
  isFront: boolean,
  materials: {
    tireRubberMat: THREE.Material;
    diamondCutAlloyMat: THREE.Material;
    turboniteBarrelMat: THREE.Material;
    pccbRotorMat: THREE.Material;
    pccbYellowCaliperMat: THREE.Material;
    centerLockMat: THREE.Material;
    crestMat: THREE.Material;
  },
  namePrefix = 'porsche992TurboS'
): void {
  const signZ = isLeft ? -1 : 1;
  const cornerGroup = new THREE.Group();
  cornerGroup.name = `${namePrefix}.wheel`;
  cornerGroup.position.set(x, y, z);
  parent.add(cornerGroup);

  // Michelin Pilot Sport 4S Tire Assembly (`openEnded = true` so wheel spokes & PCCB brakes are 100% unobstructed)
  const treadW = tireWidth * 0.84;
  const treadCyl = new THREE.Mesh(
    sharedCylinderGeometry(tireRadius, tireRadius, treadW, 40, 1, true),
    materials.tireRubberMat
  );
  treadCyl.name = `${namePrefix}.wheel.tireTread`;
  treadCyl.rotation.x = Math.PI / 2;
  treadCyl.castShadow = true;
  treadCyl.receiveShadow = true;
  cornerGroup.add(treadCyl);

  const sidewallTubeR = (tireRadius - rimRadius) * 0.56;
  const sidewallMajorR = tireRadius - sidewallTubeR;
  for (const side of [-1, 1] as const) {
    const shoulderTorus = new THREE.Mesh(
      sharedTorusGeometry(sidewallMajorR, sidewallTubeR, 18, 40),
      materials.tireRubberMat
    );
    shoulderTorus.name = `${namePrefix}.wheel.tireSidewall`;
    shoulderTorus.scale.set(1, 1, 0.54);
    shoulderTorus.position.set(0, 0, side * (treadW * 0.46));
    cornerGroup.add(shoulderTorus);
  }

  // Dark Turbonite Inner Alloy Wheel Barrel, Recessed Back-Plate & Outer Diamond-Turned Lip Flange
  const barrel = new THREE.Mesh(
    sharedCylinderGeometry(rimRadius, rimRadius * 0.96, tireWidth * 0.82, 36, 1, true),
    materials.turboniteBarrelMat
  );
  barrel.name = `${namePrefix}.wheel.alloyBarrel`;
  barrel.rotation.x = Math.PI / 2;
  cornerGroup.add(barrel);

  const innerWheelBackDisk = new THREE.Mesh(
    sharedCircleGeometry(rimRadius * 0.96, 32),
    materials.turboniteBarrelMat
  );
  innerWheelBackDisk.name = `${namePrefix}.wheel.innerBackDisk`;
  innerWheelBackDisk.position.set(0, 0, -signZ * (tireWidth * 0.36));
  if (!isLeft) innerWheelBackDisk.rotation.y = Math.PI;
  cornerGroup.add(innerWheelBackDisk);

  const outerFaceZ = signZ * (tireWidth * 0.42);
  const rimLipRing = new THREE.Mesh(
    sharedTorusGeometry(rimRadius, 0.0095, 14, 40),
    materials.diamondCutAlloyMat
  );
  rimLipRing.name = `${namePrefix}.wheel.rimLipFlange`;
  rimLipRing.scale.set(1, 1, 0.65);
  rimLipRing.position.set(0, 0, outerFaceZ);
  cornerGroup.add(rimLipRing);

  // Authentic 992.2 Turbo S Exclusive Design 10-Twin-Spoke (20-Blade Y-Spoke) Forged Wheel Face
  //    Multi-spoke dark-titanium + machined-face wheel design
  const hubRadius = 0.056;
  const spokeLen = rimRadius - hubRadius - 0.003;
  const spokeMidR = hubRadius + spokeLen * 0.5;
  const numSpokePairs = 10;
  for (let p = 0; p < numSpokePairs; p++) {
    const pairAngle = (p / numSpokePairs) * Math.PI * 2;
    for (const [bladeOffset, splayAngle] of [
      [-0.072, -0.055],
      [0.072, 0.055],
    ] as const) {
      const ang = pairAngle + bladeOffset;
      // Dark Turbonite structural spoke body
      const spokeBody = new THREE.Mesh(
        sharedBoxGeometry(0.0105, spokeLen, 0.022),
        materials.centerLockMat
      );
      spokeBody.name = `${namePrefix}.wheel.forgedSpoke`;
      spokeBody.position.set(
        Math.cos(ang) * spokeMidR,
        Math.sin(ang) * spokeMidR,
        outerFaceZ - signZ * 0.015
      );
      spokeBody.rotation.z = ang - Math.PI / 2 + splayAngle;
      spokeBody.rotation.x = signZ * 0.13;
      cornerGroup.add(spokeBody);

      // Razor-thin diamond-turned bright machined face on the outer edge of each spoke blade
      const spokeMachinedFace = new THREE.Mesh(
        sharedBoxGeometry(0.0065, spokeLen * 0.96, 0.004),
        materials.diamondCutAlloyMat
      );
      spokeMachinedFace.name = `${namePrefix}.wheel.spokeMachinedFace`;
      spokeMachinedFace.position.set(
        Math.cos(ang) * spokeMidR,
        Math.sin(ang) * spokeMidR,
        outerFaceZ - signZ * 0.004
      );
      spokeMachinedFace.rotation.z = ang - Math.PI / 2 + splayAngle;
      spokeMachinedFace.rotation.x = signZ * 0.13;
      tagHighLodDetail(spokeMachinedFace, 18);
      cornerGroup.add(spokeMachinedFace);
    }
  }

  // Forged Center-Lock Hub, RS-Style Center-Lock Nut & Colored Porsche Crest Cap
  const hubCyl = new THREE.Mesh(
    sharedCylinderGeometry(hubRadius, hubRadius * 1.12, 0.046, 28),
    materials.turboniteBarrelMat
  );
  hubCyl.name = `${namePrefix}.wheel.centerHub`;
  hubCyl.rotation.x = Math.PI / 2;
  hubCyl.position.set(0, 0, outerFaceZ - signZ * 0.026);
  cornerGroup.add(hubCyl);

  const centerLockNut = new THREE.Mesh(
    sharedCylinderGeometry(0.036, 0.041, 0.028, 16),
    materials.centerLockMat
  );
  centerLockNut.name = `${namePrefix}.wheel.centerLockNut`;
  centerLockNut.rotation.x = Math.PI / 2;
  centerLockNut.position.set(0, 0, outerFaceZ - signZ * 0.006);
  tagHighLodDetail(centerLockNut, 18);
  cornerGroup.add(centerLockNut);

  const crestCap = new THREE.Mesh(
    sharedCircleGeometry(0.022, 16),
    materials.crestMat
  );
  crestCap.name = `${namePrefix}.wheel.crestCenterCap`;
  crestCap.position.set(0, 0, outerFaceZ + signZ * 0.0085);
  if (isLeft) crestCap.rotation.y = Math.PI;
  tagHighLodDetail(crestCap, 18);
  cornerGroup.add(crestCap);

  // PCCB 420mm Front / 390mm Rear Cross-Drilled Carbon-Ceramic Brake Rotor, Aluminium Hat & Speed Yellow Caliper
  const rotorR = isFront ? 0.210 : 0.196;
  const rotorZ = outerFaceZ - signZ * 0.056;
  const rotorMesh = new THREE.Mesh(
    sharedCylinderGeometry(rotorR, rotorR, 0.026, 36),
    materials.pccbRotorMat
  );
  rotorMesh.name = `${namePrefix}.pccbRotor`;
  rotorMesh.rotation.x = Math.PI / 2;
  rotorMesh.position.set(0, 0, rotorZ);
  tagHighLodDetail(rotorMesh, 18);
  cornerGroup.add(rotorMesh);

  // Dark anodized aluminium rotor mounting hat/bell (`r = 0.105m`)
  const rotorHat = new THREE.Mesh(
    sharedCylinderGeometry(0.105, 0.105, 0.032, 24),
    materials.centerLockMat
  );
  rotorHat.name = `${namePrefix}.pccbRotor.bellHat`;
  rotorHat.rotation.x = Math.PI / 2;
  rotorHat.position.set(0, 0, rotorZ);
  tagHighLodDetail(rotorHat, 18);
  cornerGroup.add(rotorHat);

  // Curved 10-Piston Front / 4-Piston Rear Porsche Speed Yellow Monobloc Caliper
  // Positioned on the inboard axle side (`caliperAngle = 0.18` on front wheel = rear side `+x`, clearly visible through the spokes!)
  const caliperAngle = isFront ? 0.15 : Math.PI - 0.18;
  const caliperR = rotorR - 0.030;
  const caliperGroup = new THREE.Group();
  caliperGroup.name = `${namePrefix}.pccbCaliper`;
  caliperGroup.position.set(0, 0, outerFaceZ - signZ * 0.048);
  tagHighLodDetail(caliperGroup, 18);
  cornerGroup.add(caliperGroup);

  const arcSpan = isFront ? 1.08 : 0.78;
  const caliperSegs = 5;
  for (let s = 0; s < caliperSegs; s++) {
    const t = s / (caliperSegs - 1) - 0.5;
    const segAng = caliperAngle + t * arcSpan;
    const segMesh = new THREE.Mesh(
      sharedBoxGeometry(0.068, isFront ? 0.062 : 0.050, 0.072),
      materials.pccbYellowCaliperMat
    );
    segMesh.name = s === 2
      ? `${namePrefix}.pccbCaliper`
      : `${namePrefix}.pccbCaliper.segment`;
    segMesh.position.set(Math.cos(segAng) * caliperR, Math.sin(segAng) * caliperR, 0);
    segMesh.rotation.z = segAng;
    tagHighLodDetail(segMesh, 18);
    caliperGroup.add(segMesh);
  }
}

/**
 * Builds all 4 staggered 20"/21" Turbo S Exclusive Design Center-Lock Wheels & PCCB Brakes.
 */
export function buildPorsche992WheelsAndBrakes(
  carGroup: THREE.Group,
  mats: Porsche992Materials,
  namePrefix = 'porsche992TurboS'
): void {
  const wheelMaterials = {
    tireRubberMat: mats.tireRubberMat,
    diamondCutAlloyMat: mats.diamondCutAlloyMat,
    turboniteBarrelMat: mats.satinBlackAeroMat,
    pccbRotorMat: mats.pccbRotorMat,
    pccbYellowCaliperMat: mats.pccbYellowCaliperMat,
    centerLockMat: mats.turboniteMat,
    crestMat: mats.crestMat,
  };

  // Front Left & Right (`255/35 ZR20`, `tireR = 0.338m, rimR = 0.258m, width = 0.265m` at `x = -1.25m, z = ±0.788m`)
  buildPorscheTurboSWheelCorner(carGroup, -1.25, 0.338, -0.788, 0.338, 0.258, 0.265, true, true, wheelMaterials, namePrefix);
  buildPorscheTurboSWheelCorner(carGroup, -1.25, 0.338, 0.788, 0.338, 0.258, 0.265, false, true, wheelMaterials, namePrefix);

  // Rear Left & Right (`315/30 ZR21`, `tireR = 0.356m, rimR = 0.274m, width = 0.325m` at `x = +1.20m, z = ±0.812m`)
  buildPorscheTurboSWheelCorner(carGroup, 1.20, 0.356, -0.812, 0.356, 0.274, 0.325, true, false, wheelMaterials, namePrefix);
  buildPorscheTurboSWheelCorner(carGroup, 1.20, 0.356, 0.812, 0.356, 0.274, 0.325, false, false, wheelMaterials, namePrefix);
}
