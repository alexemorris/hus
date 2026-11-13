import * as THREE from 'three';
import {
  CENTERLINE_Y_KNOTS,
  createConformalBodyPatchGeometry,
  createConformalEllipticalHeadlightPatch,
  createUkNumberPlateTexture,
  evalSpline,
  getPlanWrapShiftX,
  type Porsche992Materials,
  sampleLateralSurfaceZAtXY,
  sampleMonocoqueHalfProfile,
} from './porsche-materials-and-body.ts';
import { tagHighLodDetail } from '../../shared/scene-helpers.ts';

/**
 * Builds the 992.2 facelift front fascia:
 * - Twin sculpted outer cooling pods (`z = ±0.30..±0.72m`) with beveled dark-anthracite surrounds and
 *   5 thick vertical airfoil active cooling louvres per side,
 * - Body-colored diagonal aero struts separating the outer pods from the central lower radiator intake,
 * - Central lower radiator duct with ADAS radar dome and active PAA front chin splitter,
 * - Slim horizontal front fender side-marker light strips ahead of the front wheel arches,
 * - Conformal 4-Point HD-Matrix LED headlights with silver/gunmetal bezel ring, central projector optic,
 *   and 4-point + lower horizontal LED signature blades.
 */
export function buildPorsche992FrontFasciaAndHeadlights(
  carGroup: THREE.Group,
  mats: Porsche992Materials,
  namePrefix = 'porsche992TurboS'
): void {
  // Deployed PAA Front Chin Splitter (`porsche992TurboS.frontSpoiler`)
  const splitterPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 32; i++) {
    const u = (i / 32) * 2 - 1;
    const z = u * 0.81;
    const x = -2.248 + getPlanWrapShiftX(-2.24, z);
    const y = 0.130 + Math.abs(u) * 0.008;
    splitterPts.push(new THREE.Vector3(x, y, z));
  }
  const splitterCurve = new THREE.CatmullRomCurve3(splitterPts);
  const splitterGeo = new THREE.TubeGeometry(splitterCurve, 36, 0.019, 10, false);
  splitterGeo.computeBoundingSphere();
  const frontSplitter = new THREE.Mesh(splitterGeo, mats.satinBlackAeroMat);
  frontSplitter.scale.set(1.32, 0.62, 1.0);
  frontSplitter.position.set(2.248 * 0.32, 0.130 * 0.38, 0);
  frontSplitter.name = `${namePrefix}.frontSpoiler`;
  carGroup.add(frontSplitter);

  // 992.2 Three-Part Front Bumper Intake Architecture (`porsche992TurboS.frontActiveLouvres`)
  const frontIntakesGroup = new THREE.Group();
  frontIntakesGroup.name = `${namePrefix}.frontActiveLouvres`;
  carGroup.add(frontIntakesGroup);

  // Central Lower Radiator Intake (`z = -0.25..+0.25m, y = 0.155..0.245m`) below the number plate beam
  const centerIntakePts: THREE.Vector3[] = [];
  for (let i = 0; i <= 14; i++) {
    const u = (i / 14) * 2 - 1;
    const z = u * 0.25;
    const x = -2.228 + getPlanWrapShiftX(-2.22, z);
    centerIntakePts.push(new THREE.Vector3(x, 0.198, z));
  }
  const centerIntakeGeo = new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(centerIntakePts),
    16,
    0.044,
    8,
    false
  );
  centerIntakeGeo.computeBoundingSphere();
  const centerIntakeMesh = new THREE.Mesh(centerIntakeGeo, mats.glossBlackTrimMat);
  centerIntakeMesh.name = `${namePrefix}.frontActiveLouvres.centerRadiatorDuct`;
  centerIntakeMesh.scale.set(0.42, 0.95, 1.0);
  centerIntakeMesh.position.set(-2.228 * 0.58, 0, 0);
  frontIntakesGroup.add(centerIntakeMesh);

  // Central ADAS InnoDrive Radar Sensor Lens (`x = -2.238m, y = 0.198m, z = 0`)
  const radarSensor = new THREE.Mesh(
    new THREE.SphereGeometry(0.022, 16, 12),
    mats.glossBlackTrimMat
  );
  radarSensor.name = `${namePrefix}.frontActiveLouvres.radarSensor`;
  radarSensor.scale.set(0.45, 0.9, 1.0);
  radarSensor.position.set(-2.238, 0.198, 0);
  tagHighLodDetail(radarSensor, 18);
  frontIntakesGroup.add(radarSensor);

  // Left & Right Sculpted Outer Cooling Pods (`z = ±0.30..±0.72m, y = 0.16..0.33m`) with 5 Vertical Active Louvres per side
  for (const sideZ of [-1, 1] as const) {
    // Dark recessed cooling pod cavity
    const podPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const z = sideZ * THREE.MathUtils.lerp(0.30, 0.71, t);
      const x = -2.222 + getPlanWrapShiftX(-2.22, z);
      podPts.push(new THREE.Vector3(x, 0.238, z));
    }
    const podCurve = new THREE.CatmullRomCurve3(podPts);
    const podCavityGeo = new THREE.TubeGeometry(podCurve, 16, 0.072, 10, false);
    podCavityGeo.computeBoundingSphere();
    const podCavity = new THREE.Mesh(podCavityGeo, mats.glossBlackTrimMat);
    podCavity.name = `${namePrefix}.frontActiveLouvres.intakeRecess`;
    podCavity.scale.set(0.38, 1.05, 1.0);
    podCavity.position.set(-2.222 * 0.62, 0, 0);
    frontIntakesGroup.add(podCavity);

    // Sculpted satin-black outer bezel frame (top and bottom horizontal lip rails of the outer intake pod)
    for (const [railTag, ry, rRad] of [
      ['topLip', 0.308, 0.013],
      ['bottomLip', 0.168, 0.013],
    ] as const) {
      const railPts: THREE.Vector3[] = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const z = sideZ * THREE.MathUtils.lerp(0.29, 0.72, t);
        const x = -2.238 + getPlanWrapShiftX(-2.23, z);
        railPts.push(new THREE.Vector3(x, ry, z));
      }
      const railGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(railPts), 14, rRad, 8, false);
      railGeo.computeBoundingSphere();
      const railMesh = new THREE.Mesh(railGeo, mats.satinBlackAeroMat);
      railMesh.name = `${namePrefix}.frontActiveLouvres.${railTag}`;
      frontIntakesGroup.add(railMesh);
    }

    // Body-colored diagonal aero divider strut (`z = ±0.285m`) between center radiator and outer louvre pod
    const innerStrutZ = sideZ * 0.282;
    const innerStrutX = -2.236 + getPlanWrapShiftX(-2.23, innerStrutZ);
    const innerStrut = new THREE.Mesh(
      new THREE.BoxGeometry(0.032, 0.155, 0.028),
      mats.oceanBlueBodyMat
    );
    innerStrut.name = `${namePrefix}.frontActiveLouvres.aeroDividerStrut`;
    innerStrut.position.set(innerStrutX, 0.238, innerStrutZ);
    innerStrut.rotation.x = sideZ * 0.18;
    innerStrut.rotation.y = -sideZ * 0.14;
    frontIntakesGroup.add(innerStrut);

    // 5 prominent 992.2 vertical active aerodynamic cooling louvres per side
    for (let f = 0; f < 5; f++) {
      const fz = sideZ * (0.338 + f * 0.082);
      const fx = -2.234 + getPlanWrapShiftX(-2.22, fz);
      const flap = new THREE.Mesh(
        new THREE.BoxGeometry(0.038, 0.136, 0.016),
        mats.satinBlackAeroMat
      );
      flap.name = `${namePrefix}.frontActiveLouvres`;
      flap.position.set(fx, 0.238, fz);
      flap.rotation.y = -sideZ * (0.18 + f * 0.045);
      flap.rotation.x = -sideZ * 0.06;
      frontIntakesGroup.add(flap);

      // Subtle leading-edge Turbonite highlight strip on each vertical active vane
      const vaneEdge = new THREE.Mesh(
        new THREE.BoxGeometry(0.008, 0.132, 0.014),
        mats.turboniteMat
      );
      vaneEdge.name = `${namePrefix}.frontActiveLouvres.vaneLeadingEdge`;
      vaneEdge.position.set(fx - 0.016, 0.238, fz);
      vaneEdge.rotation.y = -sideZ * (0.18 + f * 0.045);
      tagHighLodDetail(vaneEdge, 18);
      frontIntakesGroup.add(vaneEdge);
    }

    // Slim horizontal front fender side-marker / indicator light bar ahead of the front wheel arch (`x = -1.63m, y = 0.545m`)
    const markerZ = sideZ * 0.882;
    const markerX = -1.63 + getPlanWrapShiftX(-1.63, markerZ);
    const sideMarker = new THREE.Mesh(
      new THREE.BoxGeometry(0.135, 0.014, 0.012),
      mats.ledDrlMat
    );
    sideMarker.name = `${namePrefix}.frontSideMarker`;
    sideMarker.position.set(markerX, 0.545, markerZ);
    sideMarker.rotation.y = -sideZ * 0.16;
    sideMarker.rotation.z = 0.08;
    tagHighLodDetail(sideMarker, 18);
    carGroup.add(sideMarker);
  }

  // Front UK Number Plate (`992 TBS` on white plate, mounted on the central bumper beam at `x = -2.244m, y = 0.305m`)
  const frontPlatePlinth = new THREE.Mesh(
    new THREE.BoxGeometry(0.016, 0.090, 0.392),
    mats.satinBlackAeroMat
  );
  frontPlatePlinth.name = `${namePrefix}.frontNumberPlate.plinth`;
  frontPlatePlinth.position.set(-2.238, 0.305, 0);
  tagHighLodDetail(frontPlatePlinth, 18);
  carGroup.add(frontPlatePlinth);

  const frontPlate = new THREE.Mesh(
    new THREE.BoxGeometry(0.01, 0.082, 0.38),
    new THREE.MeshStandardMaterial({
      map: createUkNumberPlateTexture(false),
      roughness: 0.25,
    })
  );
  frontPlate.name = `${namePrefix}.frontNumberPlate`;
  frontPlate.position.set(-2.245, 0.305, 0);
  tagHighLodDetail(frontPlate, 18);
  carGroup.add(frontPlate);

  // Stuttgart Porsche Crest on Front Hood Nose (`x = -2.02m, y = 0.534m, z = 0`)
  const hoodCrest = new THREE.Mesh(
    new THREE.PlaneGeometry(0.05, 0.062),
    mats.crestMat
  );
  hoodCrest.name = `${namePrefix}.hoodCrest`;
  hoodCrest.position.set(-2.02, 0.534, 0);
  hoodCrest.rotation.y = -Math.PI / 2;
  hoodCrest.rotation.z = -1.28;
  tagHighLodDetail(hoodCrest, 18);
  carGroup.add(hoodCrest);

  // Iconic Oval 992.2 HD-Matrix 4-Point LED Headlights (`porsche992TurboS.headlight`)
  for (const sideZ of [-1, 1] as const) {
    const hlGroup = new THREE.Group();
    hlGroup.name = `${namePrefix}.headlight`;
    carGroup.add(hlGroup);

    // Outer dark gunmetal conformal elliptical housing bezel
    const bezelGeo = createConformalEllipticalHeadlightPatch(-1.87, 0.485, 0.192, 0.098, 0.0022, sideZ);
    const bezelMesh = new THREE.Mesh(bezelGeo, mats.glossBlackTrimMat);
    bezelMesh.name = `${namePrefix}.headlight`;
    hlGroup.add(bezelMesh);

    // Machined silver/Turbonite inner reflector ring inside the headlight housing
    const silverRingGeo = createConformalEllipticalHeadlightPatch(-1.87, 0.485, 0.172, 0.086, 0.0032, sideZ);
    const silverRingMesh = new THREE.Mesh(silverRingGeo, mats.diamondCutAlloyMat);
    silverRingMesh.name = `${namePrefix}.headlight.chromeTrimRing`;
    hlGroup.add(silverRingMesh);

    // Deep dark internal projector bowl patch
    const innerGeo = createConformalEllipticalHeadlightPatch(-1.87, 0.485, 0.156, 0.078, 0.0040, sideZ);
    const innerReflectorMesh = new THREE.Mesh(innerGeo, mats.glossBlackTrimMat);
    innerReflectorMesh.name = `${namePrefix}.headlight.reflectorBowl`;
    hlGroup.add(innerReflectorMesh);

    // Central HD-Matrix Main Projector Pod + 4 Signature Porsche 4-Point Horizontal LED DRL Blades + Lower LED Bar
    const halfPtsMid = sampleMonocoqueHalfProfile(-1.87, 64);
    const basePt = halfPtsMid[Math.round(0.485 * 64)]!;
    const baseZ = sideZ * basePt[1];
    const baseX = -1.87 + getPlanWrapShiftX(-1.87, baseZ);
    const baseY = basePt[0];

    const mainProjectorPod = new THREE.Mesh(
      new THREE.BoxGeometry(0.056, 0.032, 0.048),
      mats.turboniteMat
    );
    mainProjectorPod.name = `${namePrefix}.headlight.matrixProjector`;
    mainProjectorPod.position.set(baseX + 0.005, baseY + 0.006, baseZ + sideZ * 0.004);
    mainProjectorPod.rotation.z = 0.44;
    mainProjectorPod.rotation.y = -sideZ * 0.22;
    tagHighLodDetail(mainProjectorPod, 18);
    hlGroup.add(mainProjectorPod);

    const projectorLens = new THREE.Mesh(
      new THREE.SphereGeometry(0.016, 14, 12),
      mats.ledDrlMat
    );
    projectorLens.name = `${namePrefix}.headlight.projectorLens`;
    projectorLens.scale.set(0.6, 0.85, 1.1);
    projectorLens.position.set(baseX - 0.012, baseY + 0.005, baseZ + sideZ * 0.007);
    tagHighLodDetail(projectorLens, 18);
    hlGroup.add(projectorLens);

    for (const [dx, dy, dz, lenX] of [
      [-0.048, -0.018, -0.038, 0.046],
      [-0.048, -0.014, 0.038, 0.046],
      [0.050, 0.024, -0.036, 0.046],
      [0.050, 0.028, 0.036, 0.046],
      [-0.015, -0.026, 0.004, 0.082], // Lower horizontal LED light strip
    ] as const) {
      const drlBar = new THREE.Mesh(
        new THREE.BoxGeometry(lenX, 0.009, 0.014),
        mats.ledDrlMat
      );
      drlBar.name = `${namePrefix}.headlight.drlBlade`;
      drlBar.position.set(baseX + dx, baseY + dy + 0.008, baseZ + sideZ * 0.009 + dz * sideZ);
      drlBar.rotation.z = 0.44;
      drlBar.rotation.y = -sideZ * 0.20;
      hlGroup.add(drlBar);
    }

    // Flush conformal clear polycarbonate headlight lens cover
    const lensGeo = createConformalEllipticalHeadlightPatch(-1.87, 0.485, 0.184, 0.093, 0.0072, sideZ);
    const lensMesh = new THREE.Mesh(lensGeo, mats.clearLensMat);
    lensMesh.name = `${namePrefix}.headlight.clearLens`;
    hlGroup.add(lensMesh);
  }
}

/**
 * Builds the sculpted side mirrors, flush pop-out door handles with recessed pockets,
 * door shut-lines, and the signature swept C-shaped 992.2 Turbo S rear quarter side intercooler intake scoops.
 */
export function buildPorsche992SideMirrorsHandlesAndIntakes(
  carGroup: THREE.Group,
  mats: Porsche992Materials,
  namePrefix = 'porsche992TurboS'
): void {
  for (const sideZ of [-1, 1] as const) {
    // Sculpted 992.2 Aerodynamic Door Mirror (`x = -0.46m, y = 0.855m, z = ±0.855m`)
    const mirrorGroup = new THREE.Group();
    mirrorGroup.name = `${namePrefix}.wingMirror`;
    mirrorGroup.position.set(-0.46, 0.855, sideZ * 0.855);
    carGroup.add(mirrorGroup);

    // Swept satin-black door pedestal stalk
    const mirrorStalk = new THREE.Mesh(
      new THREE.BoxGeometry(0.088, 0.036, 0.078),
      mats.satinBlackAeroMat
    );
    mirrorStalk.name = `${namePrefix}.wingMirror.stalk`;
    mirrorStalk.position.set(0.005, 0.012, sideZ * 0.032);
    mirrorStalk.rotation.x = sideZ * 0.38;
    mirrorStalk.rotation.y = -sideZ * 0.24;
    mirrorGroup.add(mirrorStalk);

    // Sculpted Ocean Blue upper aerodynamic mirror shell
    const mirrorCap = new THREE.Mesh(
      new THREE.SphereGeometry(0.058, 20, 16),
      mats.oceanBlueBodyMat
    );
    mirrorCap.name = `${namePrefix}.wingMirror.cap`;
    mirrorCap.scale.set(1.52, 0.62, 1.18);
    mirrorCap.position.set(0.024, 0.038, sideZ * 0.076);
    mirrorCap.rotation.y = -sideZ * 0.18;
    mirrorGroup.add(mirrorCap);

    // Satin-black lower mirror bezel & LED indicator strip
    const mirrorLowerCup = new THREE.Mesh(
      new THREE.SphereGeometry(0.054, 16, 12),
      mats.satinBlackAeroMat
    );
    mirrorLowerCup.name = `${namePrefix}.wingMirror.lowerBezel`;
    mirrorLowerCup.scale.set(1.46, 0.45, 1.14);
    mirrorLowerCup.position.set(0.026, 0.026, sideZ * 0.076);
    mirrorLowerCup.rotation.y = -sideZ * 0.18;
    tagHighLodDetail(mirrorLowerCup, 18);
    mirrorGroup.add(mirrorLowerCup);

    const mirrorGlass = new THREE.Mesh(
      new THREE.CircleGeometry(0.044, 16),
      mats.diamondCutAlloyMat
    );
    mirrorGlass.name = `${namePrefix}.wingMirror.glass`;
    mirrorGlass.scale.set(1.25, 0.72, 1.0);
    mirrorGlass.position.set(0.068, 0.035, sideZ * 0.076);
    mirrorGlass.rotation.y = Math.PI / 2 - sideZ * 0.16;
    tagHighLodDetail(mirrorGlass, 18);
    mirrorGroup.add(mirrorGlass);

    // Recessed Door Handle Pocket & Flush Pop-Out Door Handle (`x = +0.16m, y = 0.782m`)
    const handleZ = sampleLateralSurfaceZAtXY(0.16, 0.782);
    const handlePocket = new THREE.Mesh(
      new THREE.BoxGeometry(0.155, 0.042, 0.008),
      mats.glossBlackTrimMat
    );
    handlePocket.name = `${namePrefix}.doorHandle.recessPocket`;
    handlePocket.position.set(0.16, 0.782, sideZ * (handleZ - 0.001));
    handlePocket.rotation.y = sideZ * 0.03;
    tagHighLodDetail(handlePocket, 18);
    carGroup.add(handlePocket);

    const doorHandle = new THREE.Mesh(
      new THREE.BoxGeometry(0.148, 0.022, 0.012),
      mats.oceanBlueBodyMat
    );
    doorHandle.name = `${namePrefix}.doorHandle`;
    doorHandle.position.set(0.16, 0.785, sideZ * (handleZ + 0.004));
    doorHandle.rotation.y = sideZ * 0.03;
    carGroup.add(doorHandle);

    // Sculpted Swept 992.2 Turbo S Side Intercooler Air Intake Scoop (`porsche992TurboS.sideIntake`)
    //    Tall, curved C-shaped gloss/satin black aero cowl scoop set into the
    //    leading flare of the widebody rear haunch (`x = 0.62..0.90m, y = 0.54..0.81m`), tilted forward at the top!
    const sideIntakeGroup = new THREE.Group();
    sideIntakeGroup.name = `${namePrefix}.sideIntake`;
    carGroup.add(sideIntakeGroup);

    // Deep dark conformal intake throat patch (`x = 0.60..0.90m, v = 0.58..0.82`)
    const throatPatchGeo = createConformalBodyPatchGeometry(
      0.60,
      0.90,
      () => 0.58,
      () => 0.80,
      10,
      8,
      -0.012,
      false
    );
    if (sideZ === 1) {
      // Only add the symmetric throat once using mirrorBothSides=true below
      throatPatchGeo.dispose();
    }

    // Curved C-shaped outer aerodynamic scoop cowling along the rear fender flare (`y = 0.545..0.815m`)
    const cowlPts: THREE.Vector3[] = [];
    const numCowlPts = 16;
    for (let i = 0; i <= numCowlPts; i++) {
      const t = i / numCowlPts; // 0 = bottom sill end, 0.5 = rear arc, 1.0 = upper shoulder tip
      const py = THREE.MathUtils.lerp(0.545, 0.812, t);
      // Sweeps rearward in the middle and forward at the top and bottom
      const px = THREE.MathUtils.lerp(0.76, 0.66, t) + Math.sin(t * Math.PI) * 0.115;
      const zSurf = sampleLateralSurfaceZAtXY(px, py);
      const pz = sideZ * (zSurf + 0.014);
      cowlPts.push(new THREE.Vector3(px, py, pz));
    }
    const cowlCurve = new THREE.CatmullRomCurve3(cowlPts);
    const cowlLipGeo = new THREE.TubeGeometry(cowlCurve, 20, 0.022, 10, false);
    cowlLipGeo.computeBoundingSphere();
    const cowlLipMesh = new THREE.Mesh(cowlLipGeo, mats.glossBlackTrimMat);
    cowlLipMesh.name = `${namePrefix}.sideIntake`;
    cowlLipMesh.scale.set(1.35, 1.0, 0.85);
    cowlLipMesh.position.set(-0.74 * 0.35, 0, sideZ * 0.92 * 0.15);
    sideIntakeGroup.add(cowlLipMesh);

    // Leading edge satin-black intake ramp + internal horizontal splitter vane
    const rampZ = sampleLateralSurfaceZAtXY(0.72, 0.678);
    const intakeCavity = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.235, 0.048),
      mats.glossBlackTrimMat
    );
    intakeCavity.name = `${namePrefix}.sideIntake.throatCavity`;
    intakeCavity.position.set(0.735, 0.678, sideZ * (rampZ - 0.012));
    intakeCavity.rotation.y = sideZ * 0.22;
    intakeCavity.rotation.z = 0.34;
    sideIntakeGroup.add(intakeCavity);

    for (const vaneOffY of [-0.038, 0.038] as const) {
      const intakeSplitterVane = new THREE.Mesh(
        new THREE.BoxGeometry(0.165, 0.010, 0.052),
        mats.satinBlackAeroMat
      );
      intakeSplitterVane.name = `${namePrefix}.sideIntake.splitterVane`;
      intakeSplitterVane.position.set(0.735 - vaneOffY * 0.28, 0.678 + vaneOffY, sideZ * (rampZ - 0.004));
      intakeSplitterVane.rotation.y = sideZ * 0.22;
      sideIntakeGroup.add(intakeSplitterVane);
    }
  }
}

/**
 * Builds the conformal 992.2 rear engine decklid grille, sculpted active Turbo S rear wing
 * with upturned side winglets,
 * wrap-around recessed taillight visor, rear intercooler air-outlet vents,
 * conformal rear valance/diffuser, rear UK number plate, and oval titanium exhaust tailpipes.
 */
export function buildPorsche992RearAeroTaillightAndDiffuser(
  carGroup: THREE.Group,
  mats: Porsche992Materials,
  namePrefix = 'porsche992TurboS'
): void {
  // Conformal Slatted Rear Engine Decklid Grille (`porsche992TurboS.rearDecklidGrille`, `x = 1.54..1.86m`)
  const decklidGrilleGroup = new THREE.Group();
  decklidGrilleGroup.name = `${namePrefix}.rearDecklidGrille`;
  carGroup.add(decklidGrilleGroup);

  const decklidBaseGeo = createConformalBodyPatchGeometry(
    1.54,
    1.86,
    () => 0.0,
    () => 0.255,
    12,
    18,
    0.0028,
    false
  );
  const decklidBaseMesh = new THREE.Mesh(decklidBaseGeo, mats.glossBlackTrimMat);
  decklidBaseMesh.name = `${namePrefix}.rearDecklidGrille`;
  decklidGrilleGroup.add(decklidBaseMesh);

  for (let s = -5; s <= 5; s++) {
    if (s === 0) continue;
    const isBrakeStrip = Math.abs(s) === 1;
    const zPos = isBrakeStrip ? s * 0.022 : s * 0.068;
    const yStart = evalSpline(1.56, CENTERLINE_Y_KNOTS) + 0.008;
    const yEnd = evalSpline(1.84, CENTERLINE_Y_KNOTS) + 0.008;
    const slatLen = Math.hypot(1.84 - 1.56, yEnd - yStart);
    const slatPitch = Math.atan2(yEnd - yStart, 1.84 - 1.56);
    const slat = new THREE.Mesh(
      new THREE.BoxGeometry(slatLen, isBrakeStrip ? 0.012 : 0.01, isBrakeStrip ? 0.008 : 0.006),
      isBrakeStrip ? mats.crimsonTaillightMat : mats.turboniteMat
    );
    slat.name = isBrakeStrip
      ? `${namePrefix}.rearDecklidGrille.thirdBrakeStrip`
      : `${namePrefix}.rearDecklidGrille.slat`;
    slat.position.set(1.70, (yStart + yEnd) * 0.5, zPos);
    slat.rotation.z = slatPitch;
    decklidGrilleGroup.add(slat);
  }

  // Authentic 992.2 Turbo S Deployed Active Rear Wing with Upturned Side Winglets (`porsche992TurboS.rearWing`)
  //    Elevated slightly higher (`yBase = 0.875m`) with pronounced upturned outer side winglets so the wing profile
  //    sits proud above the rear haunch from a front-3/4 angle
  const rearWingGroup = new THREE.Group();
  rearWingGroup.name = `${namePrefix}.rearWing`;
  carGroup.add(rearWingGroup);

  {
    const spanSegs = 40;
    const chordSegs = 14;
    const halfSpanZ = 0.70;
    const wingPositions: number[] = [];
    const wingIndices: number[] = [];

    for (let iz = 0; iz <= spanSegs; iz++) {
      const tz = (iz / spanSegs) * 2 - 1;
      const z = tz * halfSpanZ;
      const absTz = Math.abs(tz);

      const chord = THREE.MathUtils.lerp(0.23, 0.175, absTz * absTz);
      const xLead = 1.84 + getPlanWrapShiftX(2.02, z) + absTz * absTz * 0.045;
      const wingletKick = THREE.MathUtils.smoothstep(absTz, 0.82, 1.0) * 0.038;
      const yBase = 0.872 - absTz * absTz * 0.024 + wingletKick;

      for (let ic = 0; ic <= chordSegs; ic++) {
        const theta = (ic / chordSegs) * Math.PI * 2;
        const cFrac = 0.5 - 0.5 * Math.cos(theta);
        const isUpper = theta <= Math.PI;
        const thickness = 0.024 * Math.sin(Math.pow(cFrac, 0.65) * Math.PI);
        const camberPitch = -cFrac * 0.015 + Math.sin(cFrac * Math.PI) * 0.010;

        const px = xLead + cFrac * chord;
        const py = yBase + camberPitch + (isUpper ? thickness * 0.65 : -thickness * 0.35);
        wingPositions.push(px, py, z);
      }
    }

    const cStride = chordSegs + 1;
    for (let iz = 0; iz < spanSegs; iz++) {
      for (let ic = 0; ic < chordSegs; ic++) {
        const a = iz * cStride + ic;
        const b = (iz + 1) * cStride + ic;
        const c = (iz + 1) * cStride + ic + 1;
        const d = iz * cStride + ic + 1;
        wingIndices.push(a, c, b, a, d, c);
      }
    }

    const wingUvs = new Float32Array((wingPositions.length / 3) * 2);
    for (let i = 0, vi = 0; i < wingPositions.length; i += 3, vi += 2) {
      wingUvs[vi] = wingPositions[i]! * 0.5;
      wingUvs[vi + 1] = wingPositions[i + 2]! * 0.5 + 0.5;
    }
    const wingGeo = new THREE.BufferGeometry();
    wingGeo.setAttribute('position', new THREE.Float32BufferAttribute(wingPositions, 3));
    wingGeo.setAttribute('uv', new THREE.BufferAttribute(wingUvs, 2));
    wingGeo.setIndex(wingIndices);
    wingGeo.computeVertexNormals();
    wingGeo.computeBoundingSphere();

    const wingBladeMesh = new THREE.Mesh(wingGeo, mats.oceanBlueBodyMat);
    wingBladeMesh.name = `${namePrefix}.rearWing`;
    wingBladeMesh.castShadow = true;
    wingBladeMesh.receiveShadow = true;
    rearWingGroup.add(wingBladeMesh);

    for (const sideZ of [-1, 1] as const) {
      const ram = new THREE.Mesh(
        new THREE.CylinderGeometry(0.016, 0.020, 0.068, 12),
        mats.satinBlackAeroMat
      );
      ram.name = `${namePrefix}.rearWing.hydraulicRam`;
      ram.position.set(1.94, 0.832, sideZ * 0.36);
      rearWingGroup.add(ram);
    }
  }

  // Full-Width Wrap-Around Recessed 992.2 LED Taillight Visor & Lightbar (`porsche992TurboS.taillightBar`)
  const taillightGroup = new THREE.Group();
  taillightGroup.name = `${namePrefix}.taillightBar`;
  carGroup.add(taillightGroup);

  const tailCurvePts: THREE.Vector3[] = [];
  for (let i = 0; i <= 32; i++) {
    const u = (i / 32) * 2 - 1;
    const z = u * 0.79;
    const x = 2.155 + getPlanWrapShiftX(2.15, z) - Math.pow(Math.abs(u), 2.2) * 0.045;
    const y = 0.722 - u * u * 0.012;
    tailCurvePts.push(new THREE.Vector3(x, y, z));
  }
  const tailCurve = new THREE.CatmullRomCurve3(tailCurvePts);

  const tailVisorSlotGeo = new THREE.TubeGeometry(tailCurve, 36, 0.028, 12, false);
  tailVisorSlotGeo.computeBoundingSphere();
  const tailVisorSlot = new THREE.Mesh(tailVisorSlotGeo, mats.glossBlackTrimMat);
  tailVisorSlot.name = `${namePrefix}.taillightBar.visorChannel`;
  tailVisorSlot.scale.set(1.0, 0.78, 1.0);
  taillightGroup.add(tailVisorSlot);

  const tailLedBladeGeo = new THREE.TubeGeometry(tailCurve, 40, 0.0095, 10, false);
  tailLedBladeGeo.computeBoundingSphere();
  const tailLedBlade = new THREE.Mesh(tailLedBladeGeo, mats.crimsonTaillightMat);
  tailLedBlade.name = `${namePrefix}.taillightBar`;
  tailLedBlade.position.set(0.016, 0.004, 0);
  taillightGroup.add(tailLedBlade);

  for (const sideZ of [-1, 1] as const) {
    for (const zOff of [0.63, 0.71] as const) {
      const bz = sideZ * zOff;
      const uNorm = bz / 0.79;
      const bx = 2.155 + getPlanWrapShiftX(2.15, bz) - Math.pow(Math.abs(uNorm), 2.2) * 0.045 + 0.018;
      const by = 0.722 - uNorm * uNorm * 0.012 - 0.012;
      const brakeSeg = new THREE.Mesh(
        new THREE.BoxGeometry(0.018, 0.008, 0.048),
        mats.crimsonTaillightMat
      );
      brakeSeg.name = `${namePrefix}.taillightBar.brakeSegment`;
      brakeSeg.position.set(bx, by, bz);
      brakeSeg.rotation.y = sideZ * 0.34;
      taillightGroup.add(brakeSeg);
    }
  }

  const tailSmokedLensGeo = new THREE.TubeGeometry(tailCurve, 36, 0.021, 12, false);
  tailSmokedLensGeo.computeBoundingSphere();
  const tailSmokedLens = new THREE.Mesh(tailSmokedLensGeo, mats.smokedRedLensMat);
  tailSmokedLens.name = `${namePrefix}.taillightBar.smokedLens`;
  tailSmokedLens.scale.set(1.0, 0.75, 1.0);
  tailSmokedLens.position.set(0.01, 0, 0);
  taillightGroup.add(tailSmokedLens);

  // D. 992.2 Turbo S Outer Rear Bumper Intercooler Air-Outlet Vents (`z = ±0.71m, y = 0.42m`)
  for (const sideZ of [-1, 1] as const) {
    const vz = sideZ * 0.705;
    const vx = 2.215 + getPlanWrapShiftX(2.22, vz);
    const outletGroup = new THREE.Group();
    outletGroup.name = `${namePrefix}.rearIntercoolerOutlet`;
    outletGroup.position.set(vx, 0.43, vz);
    outletGroup.rotation.y = sideZ * 0.42;
    carGroup.add(outletGroup);

    const outletRecess = new THREE.Mesh(
      new THREE.BoxGeometry(0.032, 0.135, 0.095),
      mats.glossBlackTrimMat
    );
    outletRecess.name = `${namePrefix}.rearIntercoolerOutlet.recess`;
    outletGroup.add(outletRecess);

    for (const vaneY of [-0.035, 0.0, 0.035] as const) {
      const vane = new THREE.Mesh(
        new THREE.BoxGeometry(0.038, 0.008, 0.088),
        mats.satinBlackAeroMat
      );
      vane.name = `${namePrefix}.rearIntercoolerOutlet.vane`;
      vane.position.set(0.003, vaneY, 0);
      outletGroup.add(vane);
    }
  }

  // E. Conformal Lower Rear Valance / Venturi Diffuser, Recessed UK Number Plate & Oval Titanium Exhaust (`porsche992TurboS.exhaust`)
  const exhaustGroup = new THREE.Group();
  exhaustGroup.name = `${namePrefix}.exhaust`;
  carGroup.add(exhaustGroup);

  {
    const dCols = 28;
    const dRows = 8;
    const dPos: number[] = [];
    const dIdx: number[] = [];
    for (let r = 0; r <= dRows; r++) {
      const ty = r / dRows;
      const py = THREE.MathUtils.lerp(0.195, 0.415, ty);
      const baseX = THREE.MathUtils.lerp(2.195, 2.242, Math.sin(ty * Math.PI * 0.65));
      const halfW = THREE.MathUtils.lerp(0.65, 0.58, ty);
      for (let c = 0; c <= dCols; c++) {
        const tz = (c / dCols) * 2 - 1;
        const pz = tz * halfW;
        const px = baseX + getPlanWrapShiftX(2.22, pz) + 0.004;
        dPos.push(px, py, pz);
      }
    }
    const dStride = dCols + 1;
    for (let r = 0; r < dRows; r++) {
      for (let c = 0; c < dCols; c++) {
        const a = r * dStride + c;
        const b = (r + 1) * dStride + c;
        const d = (r + 1) * dStride + c + 1;
        const e = r * dStride + c + 1;
        dIdx.push(a, d, b, a, e, d);
      }
    }
    const valanceGeo = new THREE.BufferGeometry();
    valanceGeo.setAttribute('position', new THREE.Float32BufferAttribute(dPos, 3));
    valanceGeo.setIndex(dIdx);
    valanceGeo.computeVertexNormals();
    valanceGeo.computeBoundingSphere();
    const valanceMesh = new THREE.Mesh(valanceGeo, mats.satinBlackAeroMat);
    valanceMesh.name = `${namePrefix}.exhaust.rearValanceDiffuser`;
    exhaustGroup.add(valanceMesh);
  }

  const rearPlate = new THREE.Mesh(
    new THREE.BoxGeometry(0.012, 0.086, 0.39),
    new THREE.MeshStandardMaterial({
      map: createUkNumberPlateTexture(true),
      roughness: 0.24,
    })
  );
  rearPlate.name = `${namePrefix}.rearNumberPlate`;
  rearPlate.position.set(2.246, 0.35, 0);
  tagHighLodDetail(rearPlate, 18);
  carGroup.add(rearPlate);

  for (const sz of [-0.26, -0.09, 0.09, 0.26] as const) {
    const sx = 2.205 + getPlanWrapShiftX(2.22, sz);
    const strake = new THREE.Mesh(
      new THREE.BoxGeometry(0.085, 0.095, 0.012),
      mats.satinBlackAeroMat
    );
    strake.name = `${namePrefix}.exhaust.diffuserStrake`;
    strake.position.set(sx, 0.225, sz);
    exhaustGroup.add(strake);
  }

  for (const sideZ of [-1, 1] as const) {
    const ez = sideZ * 0.48;
    const ex = 2.212 + getPlanWrapShiftX(2.22, ez);
    const tailpipeOuter = new THREE.Mesh(
      new THREE.CylinderGeometry(0.052, 0.054, 0.09, 24, 1, true),
      mats.titaniumExhaustMat
    );
    tailpipeOuter.name = `${namePrefix}.exhaust`;
    tailpipeOuter.rotation.z = Math.PI / 2;
    tailpipeOuter.rotation.y = sideZ * 0.18;
    tailpipeOuter.scale.set(0.74, 1.0, 1.38);
    tailpipeOuter.position.set(ex, 0.255, ez);
    exhaustGroup.add(tailpipeOuter);

    const tailpipeCore = new THREE.Mesh(
      new THREE.CylinderGeometry(0.046, 0.046, 0.075, 20),
      mats.glossBlackTrimMat
    );
    tailpipeCore.name = `${namePrefix}.exhaust.tailpipeCore`;
    tailpipeCore.rotation.z = Math.PI / 2;
    tailpipeCore.rotation.y = sideZ * 0.18;
    tailpipeCore.scale.set(0.72, 1.0, 1.34);
    tailpipeCore.position.set(ex - 0.006, 0.255, ez);
    exhaustGroup.add(tailpipeCore);
  }
}
