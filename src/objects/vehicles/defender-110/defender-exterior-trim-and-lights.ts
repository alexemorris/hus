import * as THREE from 'three';
import {
  createConformalDefenderPatchGeometry,
  createConformalLateralWindowOrPanelGeometry,
  createDefenderBonnetLetteringTexture,
  createUkNumberPlateTexture,
  type Defender110Materials,
  getPlanWrapShiftX,
  lerp,
  sampleDefenderHalfProfile,
  sampleFrontNoseSurfaceXAtYZ,
  sampleLateralSurfaceZAtXY,
  smoothstep,
} from './defender-materials-and-monocoque.ts';
import { tagHighLodDetail } from '../../shared/scene-helpers.ts';

/**
 * Builds a single-side conformal patch over the parametric Defender monocoque `(x, v)` domain
 * on either the left (`sideZ = -1`) or right (`sideZ = +1`) side.
 */
function createSingleSideConformalDefenderPatchGeometry(
  xStart: number,
  xEnd: number,
  vStartFunc: (x: number) => number,
  vEndFunc: (x: number) => number,
  segX: number,
  segV: number,
  outwardOffsetY: number,
  outwardOffsetZ: number,
  sideZ: -1 | 1
): THREE.BufferGeometry {
  const nv = 64;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let ix = 0; ix <= segX; ix++) {
    const tx = ix / segX;
    const x = lerp(xStart, xEnd, tx);
    const halfPts = sampleDefenderHalfProfile(x, nv);
    const v0 = vStartFunc(x);
    const v1 = vEndFunc(x);

    for (let iv = 0; iv <= segV; iv++) {
      const tv = iv / segV;
      const absV = Math.abs(lerp(v0, v1, tv));
      const fIdx = Math.min(nv - 1e-4, Math.max(0, absV * nv));
      const j0 = Math.floor(fIdx);
      const j1 = Math.min(nv, j0 + 1);
      const frac = fIdx - j0;

      const p0 = halfPts[j0]!;
      const p1 = halfPts[j1]!;
      const py = lerp(p0[0], p1[0], frac) + outwardOffsetY;
      const pz = sideZ * (lerp(p0[1], p1[1], frac) + outwardOffsetZ);
      const vx = x + getPlanWrapShiftX(x, pz);

      positions.push(vx, py, pz);
      uvs.push(tx, tv);
    }
  }

  const stride = segV + 1;
  for (let ix = 0; ix < segX; ix++) {
    for (let iv = 0; iv < segV; iv++) {
      const a = ix * stride + iv;
      const b = (ix + 1) * stride + iv;
      const c = (ix + 1) * stride + iv + 1;
      const d = ix * stride + iv + 1;
      if (sideZ > 0) {
        indices.push(a, b, c, a, c, d);
      } else {
        indices.push(a, c, b, a, d, c);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Builds the conformal L663 Shadow Atlas lower A-frame front skid pan curving smoothly
 * from the lower H-frame bumper (`y = 0.49m` at `x ≈ -2.37m`) around the front chin
 * (`x = -2.38m + getPlanWrapShiftX(-2.38, z), y = 0.325m`) and back underneath the monocoque
 * to `x = -2.02m, y = 0.265m` so it is 100% attached to the chin and chassis undertray.
 */
function createConformalFrontSkidPanGeometry(): THREE.BufferGeometry {
  const stations: readonly (readonly [number, number, number, number])[] = [
    // [tStation, y, halfWidthZ, forwardOutsetX]
    [0.0, 0.49, 0.50, -0.008],
    [0.25, 0.41, 0.54, -0.009],
    [0.50, 0.33, 0.57, -0.008],
    [0.75, 0.29, 0.56, 0.0],
    [1.0, 0.265, 0.52, 0.0],
  ];
  const segZ = 24;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let is = 0; is < stations.length; is++) {
    const [ts, py, halfW, xOut] = stations[is]!;
    for (let iz = 0; iz <= segZ; iz++) {
      const tz = iz / segZ;
      const u = tz * 2 - 1;
      const pz = u * halfW;
      let vx: number;
      if (ts <= 0.5) {
        vx = sampleFrontNoseSurfaceXAtYZ(py, pz) + xOut;
      } else {
        const subU = (ts - 0.5) / 0.5;
        const baseChinX = -2.38 + getPlanWrapShiftX(-2.38, pz) + xOut;
        const underRearX = -2.02 + getPlanWrapShiftX(-2.02, pz) * 0.25;
        vx = lerp(baseChinX, underRearX, subU);
      }
      positions.push(vx, py, pz);
      uvs.push(tz, ts);
    }
  }

  const stride = segZ + 1;
  for (let is = 0; is < stations.length - 1; is++) {
    for (let iz = 0; iz < segZ; iz++) {
      const a = is * stride + iz;
      const b = (is + 1) * stride + iz;
      const c = (is + 1) * stride + iz + 1;
      const d = is * stride + iz + 1;
      indices.push(a, b, c, a, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Builds the iconic L663 Defender signature exterior accessories:
 * - Floating C-Pillar "Signature Graphic" square panel (`x = +0.82m..+1.26m, y = 1.24m..1.85m`) & recessed square accessory port
 * - Alpine Light roof-edge windows (`landRoverDefender.alpineLight.left` / `.right`) along `x = +0.95m..+2.08m`,
 *   panoramic sliding glass sunroof, longitudinal roof rails & ClearSight fin
 * - Exterior side-mounted gear carrier box on the right rear quarter (`x = +1.36m..+1.92m`)
 * - Sleek, flush L663 gloss-black hood/fender intake trim (replacing any bulky A-pillar snorkel)
 * - Conformal louvred front fender side vents
 */
export function buildDefender110SignatureExteriorAccessories(
  defenderGroup: THREE.Group,
  mats: Defender110Materials,
  namePrefix = 'landRoverDefender'
): void {
  // A. Iconic L663 C-Pillar "Signature Graphic" Floating Square Panel (`landRoverDefender.signatureGraphicPanel`)
  //    on both left and right sides (`x = +0.82m..+1.26m, y = 1.24m..1.85m`) floating across the privacy glass
  //    over the rear wheel arch, with the recessed black square accessory port in its center.
  const signatureGraphicGroup = new THREE.Group();
  signatureGraphicGroup.name = `${namePrefix}.signatureGraphic`;
  defenderGroup.add(signatureGraphicGroup);

  // Chamfered metallic contrast perimeter reveal so the floating square graphic stands out crisply against the privacy glass
  const sigBezelGeo = createConformalLateralWindowOrPanelGeometry(
    0.805,
    1.275,
    () => 1.235,
    () => 1.855,
    14,
    12,
    0.013,
    [-1, 1]
  );
  const sigBezelMesh = new THREE.Mesh(sigBezelGeo, mats.magnesiumCrossBeamMat);
  sigBezelMesh.name = `${namePrefix}.signatureGraphic.bezelFrame`;
  signatureGraphicGroup.add(sigBezelMesh);

  // Body-coloured floating square Signature Graphic pillar panel (`x = +0.82m..+1.26m, y = 1.24m..1.85m`)
  const sigPanelGeo = createConformalLateralWindowOrPanelGeometry(
    0.82,
    1.26,
    () => 1.24,
    () => 1.85,
    14,
    12,
    0.018,
    [-1, 1]
  );
  const sigPanelMesh = new THREE.Mesh(sigPanelGeo, mats.santoriniBlackBodyMat);
  sigPanelMesh.name = `${namePrefix}.signatureGraphicPanel`;
  sigPanelMesh.castShadow = true;
  sigPanelMesh.receiveShadow = true;
  signatureGraphicGroup.add(sigPanelMesh);

  // Inner satin anthracite sculpted graphical square inlay
  const sigInlayGeo = createConformalLateralWindowOrPanelGeometry(
    0.848,
    1.232,
    () => 1.268,
    () => 1.822,
    12,
    10,
    0.023,
    [-1, 1]
  );
  const sigInlayMesh = new THREE.Mesh(sigInlayGeo, mats.satinAnthraciteMat);
  sigInlayMesh.name = `${namePrefix}.signatureGraphic`;
  signatureGraphicGroup.add(sigInlayMesh);

  // Recessed black square accessory port in the center of the Signature Graphic panel (`x = +1.04m, y = 1.545m`)
  for (const sideZ of [-1, 1] as const) {
    const zSurf = sampleLateralSurfaceZAtXY(1.04, 1.545);
    const zBoss = sideZ * (zSurf + 0.028);
    const xBoss = 1.04 + getPlanWrapShiftX(1.04, zBoss);
    const bossFrame = new THREE.Mesh(
      new THREE.BoxGeometry(0.135, 0.135, 0.008),
      mats.narvikGlossBlackMat
    );
    bossFrame.name = `${namePrefix}.signatureGraphic.mountBossFrame`;
    bossFrame.position.set(xBoss, 1.545, zBoss);
    bossFrame.rotation.x = -sideZ * 0.22;
    signatureGraphicGroup.add(bossFrame);

    const bossCap = new THREE.Mesh(
      new THREE.BoxGeometry(0.088, 0.088, 0.008),
      mats.satinAnthraciteMat
    );
    bossCap.name = `${namePrefix}.signatureGraphic.mountBossCap`;
    bossCap.position.set(xBoss, 1.545, zBoss + sideZ * 0.009);
    bossCap.rotation.x = -sideZ * 0.22;
    signatureGraphicGroup.add(bossCap);
  }

  // B. Iconic L663 Defender Alpine Light Roof-Edge Windows (`landRoverDefender.alpineLight.left` / `.right`)
  //    curved into the chamfered left and right upper roof cantrails (`x = +0.95m..+2.08m`),
  //    plus longitudinal black roof rails and panoramic sliding glass sunroof (`x = -0.32m..+1.35m, y = 1.965m`).
  const alpineLightGroup = new THREE.Group();
  alpineLightGroup.name = `${namePrefix}.alpineLight`;
  defenderGroup.add(alpineLightGroup);

  const alpineBezelGeo = createConformalDefenderPatchGeometry(
    0.93,
    2.10,
    () => 0.245,
    () => 0.335,
    24,
    8,
    0.0115,
    0.0115,
    true
  );
  const alpineBezelMesh = new THREE.Mesh(alpineBezelGeo, mats.narvikGlossBlackMat);
  alpineBezelMesh.name = `${namePrefix}.alpineLight.bezel`;
  alpineLightGroup.add(alpineBezelMesh);

  const alpineLeftGeo = createSingleSideConformalDefenderPatchGeometry(
    0.95,
    2.08,
    () => 0.252,
    () => 0.328,
    22,
    8,
    0.0165,
    0.0165,
    -1
  );
  const alpineLeftMesh = new THREE.Mesh(alpineLeftGeo, mats.tintedPrivacyGlassMat);
  alpineLeftMesh.name = `${namePrefix}.alpineLight.left`;
  alpineLightGroup.add(alpineLeftMesh);

  const alpineRightGeo = createSingleSideConformalDefenderPatchGeometry(
    0.95,
    2.08,
    () => 0.252,
    () => 0.328,
    22,
    8,
    0.0165,
    0.0165,
    1
  );
  const alpineRightMesh = new THREE.Mesh(alpineRightGeo, mats.tintedPrivacyGlassMat);
  alpineRightMesh.name = `${namePrefix}.alpineLight.right`;
  alpineLightGroup.add(alpineRightMesh);

  // Panoramic Sliding Glass Sunroof (`x = -0.32m..+1.35m, y = 1.965m`)
  const sunroofFrameGeo = createConformalDefenderPatchGeometry(
    -0.34,
    1.37,
    () => 0.0,
    () => 0.215,
    24,
    16,
    0.0115,
    0.006,
    false
  );
  const sunroofFrameMesh = new THREE.Mesh(sunroofFrameGeo, mats.narvikGlossBlackMat);
  sunroofFrameMesh.name = `${namePrefix}.sunroof.frame`;
  alpineLightGroup.add(sunroofFrameMesh);

  const sunroofGlassGeo = createConformalDefenderPatchGeometry(
    -0.32,
    1.35,
    () => 0.0,
    () => 0.202,
    24,
    16,
    0.0165,
    0.006,
    false
  );
  const sunroofGlassMesh = new THREE.Mesh(sunroofGlassGeo, mats.tintedPrivacyGlassMat);
  sunroofGlassMesh.name = `${namePrefix}.sunroof`;
  alpineLightGroup.add(sunroofGlassMesh);

  // Longitudinal Expedition Narvik Black Roof Rails (`x = -0.28m..+2.12m, y = 1.978m, z = ±0.56m`)
  for (const sideZ of [-1, 1] as const) {
    const railBar = new THREE.Mesh(
      new THREE.BoxGeometry(2.40, 0.024, 0.034),
      mats.narvikGlossBlackMat
    );
    railBar.name = `${namePrefix}.roofRail`;
    railBar.position.set(0.92, 1.978, sideZ * 0.56);
    railBar.castShadow = true;
    alpineLightGroup.add(railBar);

    for (const stanchionX of [-0.22, 0.90, 2.04] as const) {
      const stanchion = new THREE.Mesh(
        new THREE.BoxGeometry(0.10, 0.028, 0.040),
        mats.satinAnthraciteMat
      );
      stanchion.name = `${namePrefix}.roofRail.stanchion`;
      stanchion.position.set(stanchionX, 1.960, sideZ * 0.56);
      alpineLightGroup.add(stanchion);
    }
  }

  // Roof-Mounted Shark-Fin / ClearSight Rear-View Camera Antenna Pod (`x = +1.96m, y = 1.98m, z = 0`)
  const clearSightFin = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.056, 0.044),
    mats.narvikGlossBlackMat
  );
  clearSightFin.name = `${namePrefix}.clearSightAntennaPod`;
  clearSightFin.position.set(1.96, 1.978, 0);
  alpineLightGroup.add(clearSightFin);

  // C. Exterior Side-Mounted Gear Carrier Box (`landRoverDefender.sideGearCarrier`)
  //    on the right rear quarter glass behind the C-pillar Signature Graphic (`x = +1.36m..+1.92m, y = 1.34m..1.74m`)
  //    in aerodynamic gloss Santorini Black with Land Rover oval badge & latch.
  const gearCarrierGroup = new THREE.Group();
  gearCarrierGroup.name = `${namePrefix}.sideGearCarrier`;
  const carrierCenterZ = sampleLateralSurfaceZAtXY(1.64, 1.54) + 0.068;
  gearCarrierGroup.position.set(1.64 + getPlanWrapShiftX(1.64, carrierCenterZ), 1.54, carrierCenterZ);
  gearCarrierGroup.rotation.x = -0.18; // Follow tumblehome angle of rear quarter glazing
  defenderGroup.add(gearCarrierGroup);

  const carrierBracket = new THREE.Mesh(
    new THREE.BoxGeometry(0.48, 0.32, 0.064),
    mats.satinAnthraciteMat
  );
  carrierBracket.name = `${namePrefix}.sideGearCarrier.mountingBracket`;
  carrierBracket.position.set(0, 0, -0.048);
  gearCarrierGroup.add(carrierBracket);

  const carrierMainBox = new THREE.Mesh(
    new THREE.BoxGeometry(0.56, 0.40, 0.105),
    mats.santoriniBlackBodyMat
  );
  carrierMainBox.name = `${namePrefix}.sideGearCarrier`;
  carrierMainBox.castShadow = true;
  carrierMainBox.receiveShadow = true;
  gearCarrierGroup.add(carrierMainBox);

  const carrierOuterLid = new THREE.Mesh(
    new THREE.BoxGeometry(0.52, 0.36, 0.036),
    mats.narvikGlossBlackMat
  );
  carrierOuterLid.name = `${namePrefix}.sideGearCarrier.outerLid`;
  carrierOuterLid.position.set(0, 0, 0.052);
  carrierOuterLid.castShadow = true;
  gearCarrierGroup.add(carrierOuterLid);

  const carrierSpeedRib = new THREE.Mesh(
    new THREE.BoxGeometry(0.48, 0.028, 0.012),
    mats.satinAnthraciteMat
  );
  carrierSpeedRib.name = `${namePrefix}.sideGearCarrier.speedRib`;
  carrierSpeedRib.position.set(0, -0.035, 0.072);
  gearCarrierGroup.add(carrierSpeedRib);

  const carrierLatch = new THREE.Mesh(
    new THREE.BoxGeometry(0.058, 0.088, 0.014),
    mats.satinAnthraciteMat
  );
  carrierLatch.name = `${namePrefix}.sideGearCarrier.latch`;
  carrierLatch.position.set(-0.18, 0.018, 0.071);
  gearCarrierGroup.add(carrierLatch);

  const carrierBadge = new THREE.Mesh(
    new THREE.PlaneGeometry(0.064, 0.032),
    mats.landRoverBadgeMat
  );
  carrierBadge.name = `${namePrefix}.sideGearCarrier.badge`;
  carrierBadge.position.set(0.14, -0.09, 0.072);
  tagHighLodDetail(carrierBadge, 18);
  gearCarrierGroup.add(carrierBadge);

  // D. Sleek, Flush L663 Defender Gloss-Black Hood/Fender Intake Trim (`landRoverDefender.raisedAirIntake`)
  //    mounted flush on the upper fender/bonnet shoulder (`x = -1.24m..-0.96m`) so the A-pillar is clean and modern.
  const hoodIntakeGroup = new THREE.Group();
  hoodIntakeGroup.name = `${namePrefix}.raisedAirIntake`;
  defenderGroup.add(hoodIntakeGroup);

  const hoodIntakeBezelGeo = createConformalDefenderPatchGeometry(
    -1.24,
    -0.96,
    () => 0.44,
    () => 0.545,
    12,
    6,
    0.0032,
    0.0032,
    true
  );
  const hoodIntakeBezelMesh = new THREE.Mesh(hoodIntakeBezelGeo, mats.narvikGlossBlackMat);
  hoodIntakeBezelMesh.name = `${namePrefix}.raisedAirIntake`;
  hoodIntakeGroup.add(hoodIntakeBezelMesh);

  const hoodIntakeGrilleGeo = createConformalDefenderPatchGeometry(
    -1.21,
    -0.99,
    () => 0.46,
    () => 0.53,
    10,
    4,
    0.0045,
    0.0045,
    true
  );
  const hoodIntakeGrilleMesh = new THREE.Mesh(hoodIntakeGrilleGeo, mats.satinAnthraciteMat);
  hoodIntakeGrilleMesh.name = `${namePrefix}.raisedAirIntake.intakeGrille`;
  hoodIntakeGroup.add(hoodIntakeGrilleMesh);

  // E. Conformal Fender Side Vents behind the front wheel arches (`x = -1.04m..-0.88m, y = 0.96m..1.14m`)
  //    with flush vertical Narvik Black louvres
  const fenderVentFrameGeo = createConformalLateralWindowOrPanelGeometry(
    -1.04,
    -0.88,
    () => 0.96,
    () => 1.14,
    8,
    6,
    0.004,
    [-1, 1]
  );
  const fenderVentFrameMesh = new THREE.Mesh(fenderVentFrameGeo, mats.satinAnthraciteMat);
  fenderVentFrameMesh.name = `${namePrefix}.fenderSideVent.frame`;
  defenderGroup.add(fenderVentFrameMesh);

  for (const sideZ of [-1, 1] as const) {
    const fenderVentGroup = new THREE.Group();
    fenderVentGroup.name = `${namePrefix}.fenderSideVent`;
    const zVentSurf = sampleLateralSurfaceZAtXY(-0.96, 1.05);
    const pzVent = sideZ * (zVentSurf + 0.006);
    fenderVentGroup.position.set(-0.96 + getPlanWrapShiftX(-0.96, pzVent), 1.05, pzVent);
    defenderGroup.add(fenderVentGroup);

    for (const lx of [-0.042, 0.0, 0.042] as const) {
      const louvre = new THREE.Mesh(
        new THREE.BoxGeometry(0.016, 0.145, 0.008),
        mats.narvikGlossBlackMat
      );
      louvre.name = `${namePrefix}.fenderSideVent.louvre`;
      louvre.position.set(lx, 0, 0);
      fenderVentGroup.add(louvre);
    }
  }
}

/**
 * Builds the L663 front fascia, multi-slot Narvik Black front grille, DEFENDER bonnet lettering,
 * recessed Matrix LED semicircular "Halo" headlights, and conformal H-frame front bumper with Shadow Atlas A-frame skid pan.
 */
export function buildDefender110FrontFasciaAndHeadlights(
  defenderGroup: THREE.Group,
  mats: Defender110Materials,
  namePrefix = 'landRoverDefender'
): void {
  // A. Multi-Slot Narvik Black Front Grille (`landRoverDefender.frontGrille`)
  const frontGrilleGroup = new THREE.Group();
  frontGrilleGroup.name = `${namePrefix}.frontGrille`;
  defenderGroup.add(frontGrilleGroup);

  // Conformal recessed dark radiator grille surround on the nose (`x = -2.362m..-2.340m, v = -0.28..+0.28`)
  const grilleCavityGeo = createConformalDefenderPatchGeometry(
    -2.362,
    -2.340,
    () => 0.0,
    () => 0.28,
    12,
    20,
    0.0025,
    0.0025,
    false
  );
  const grilleCavity = new THREE.Mesh(grilleCavityGeo, mats.narvikGlossBlackMat);
  grilleCavity.name = `${namePrefix}.frontGrille`;
  frontGrilleGroup.add(grilleCavity);

  // Unscaled plan-curved horizontal intake bars flush with the nose surface (`y = 0.865m..1.03m`)
  for (const barY of [1.03, 0.975, 0.92, 0.865] as const) {
    const barPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 20; i++) {
      const u = (i / 20) * 2 - 1;
      const z = u * 0.47;
      const x = sampleFrontNoseSurfaceXAtYZ(barY, z) - 0.005;
      barPts.push(new THREE.Vector3(x, barY, z));
    }
    const barCurve = new THREE.CatmullRomCurve3(barPts);
    const barGeo = new THREE.TubeGeometry(barCurve, 24, 0.011, 8, false);
    barGeo.computeBoundingSphere();
    const barMesh = new THREE.Mesh(
      barGeo,
      barY === 0.975 ? mats.satinAnthraciteMat : mats.narvikGlossBlackMat
    );
    barMesh.name = `${namePrefix}.frontGrille.crossBar`;
    frontGrilleGroup.add(barMesh);
  }

  // Vertical grille dividers creating the signature Defender rectangular intake slots
  for (const divZ of [-0.46, -0.23, 0.0, 0.23, 0.46] as const) {
    const dx = sampleFrontNoseSurfaceXAtYZ(0.948, divZ) - 0.004;
    const divider = new THREE.Mesh(
      new THREE.BoxGeometry(0.016, 0.185, 0.016),
      mats.narvikGlossBlackMat
    );
    divider.name = `${namePrefix}.frontGrille.slotDivider`;
    divider.position.set(dx, 0.948, divZ);
    frontGrilleGroup.add(divider);
  }

  // Green/Black Land Rover Oval Badge on right side of front grille (`y = 0.975m, z = -0.34m`)
  const frontOvalBadge = new THREE.Mesh(
    new THREE.PlaneGeometry(0.084, 0.042),
    mats.landRoverBadgeMat
  );
  frontOvalBadge.name = `${namePrefix}.frontGrille.ovalBadge`;
  frontOvalBadge.position.set(
    sampleFrontNoseSurfaceXAtYZ(0.975, -0.34) - 0.012,
    0.975,
    -0.34
  );
  frontOvalBadge.rotation.y = -Math.PI / 2 - 0.08;
  tagHighLodDetail(frontOvalBadge, 18);
  frontGrilleGroup.add(frontOvalBadge);

  // Bold Satin Black `D E F E N D E R` Bonnet Edge Lettering (`CanvasTexture` flush on clamshell bonnet leading edge)
  const bonnetLetteringPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.66, 0.072),
    new THREE.MeshStandardMaterial({
      map: createDefenderBonnetLetteringTexture(),
      transparent: true,
      roughness: 0.28,
      metalness: 0.52,
    })
  );
  bonnetLetteringPlane.name = `${namePrefix}.bonnetLettering`;
  bonnetLetteringPlane.position.set(
    sampleFrontNoseSurfaceXAtYZ(1.095, 0) - 0.005,
    1.095,
    0
  );
  bonnetLetteringPlane.rotation.y = -Math.PI / 2;
  bonnetLetteringPlane.rotation.z = -0.36;
  tagHighLodDetail(bonnetLetteringPlane, 18);
  frontGrilleGroup.add(bonnetLetteringPlane);

  // B. Recessed L663 Matrix LED Headlight Pockets (`landRoverDefender.headlight`)
  //    Sitting flush inside recessed Narvik Black rectangular fascia pockets (`y ≈ 0.85m..1.04m, z = ±0.50m..±0.84m`)
  //    with glowing warm-white semicircular lower LED Halo ring + twin horizontal outer LED signature pips
  //    and conformal flush polycarbonate outer lens.
  for (const sideZ of [-1, 1] as const) {
    const hlGroup = new THREE.Group();
    hlGroup.name = `${namePrefix}.headlight`;
    defenderGroup.add(hlGroup);

    // Conformal recessed Narvik Black rectangular pocket surround flush with the monocoque fascia
    const pocketGeo = createSingleSideConformalDefenderPatchGeometry(
      -2.362,
      -2.340,
      () => 0.285,
      () => 0.535,
      10,
      12,
      0.0022,
      0.0022,
      sideZ
    );
    const pocketMesh = new THREE.Mesh(pocketGeo, mats.narvikGlossBlackMat);
    pocketMesh.name = `${namePrefix}.headlight.recessPocket`;
    hlGroup.add(pocketMesh);

    // Internal projector & LED Halo assembly recessed slightly inside the fascia pocket
    const internalPod = new THREE.Group();
    internalPod.name = `${namePrefix}.headlight.internalAssembly`;
    const hy = 0.948;
    const hz = sideZ * 0.67;
    const hx = sampleFrontNoseSurfaceXAtYZ(hy, hz) + 0.006;
    internalPod.position.set(hx, hy, hz);
    internalPod.rotation.y = sideZ * 0.25;
    internalPod.rotation.z = -0.05;
    hlGroup.add(internalPod);

    const innerBezel = new THREE.Mesh(
      new THREE.BoxGeometry(0.036, 0.165, 0.28),
      mats.satinAnthraciteMat
    );
    innerBezel.name = `${namePrefix}.headlight.innerBezel`;
    innerBezel.position.set(0.014, 0, 0);
    internalPod.add(innerBezel);

    // Central bi-LED projector lens sphere inside the halo ring
    const projectorDome = new THREE.Mesh(
      new THREE.SphereGeometry(0.046, 18, 14),
      mats.clearPolycarbonateLensMat
    );
    projectorDome.name = `${namePrefix}.headlight.projectorLens`;
    projectorDome.scale.set(0.45, 1.0, 1.0);
    projectorDome.position.set(-0.002, 0.006, -sideZ * 0.022);
    internalPod.add(projectorDome);

    // Unmistakable L663 Glowing Warm-White Semicircular Lower LED Halo Ring + Upper Cropped Brow Bar
    const haloSemiRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.064, 0.0085, 14, 32, Math.PI * 1.18),
      mats.ledHaloWhiteMat
    );
    haloSemiRing.name = `${namePrefix}.headlight`;
    haloSemiRing.rotation.y = -Math.PI / 2;
    haloSemiRing.rotation.x = Math.PI + 0.28;
    haloSemiRing.position.set(-0.006, 0.010, -sideZ * 0.022);
    internalPod.add(haloSemiRing);

    const haloUpperChordBar = new THREE.Mesh(
      new THREE.BoxGeometry(0.010, 0.010, 0.122),
      mats.ledHaloWhiteMat
    );
    haloUpperChordBar.name = `${namePrefix}.headlight.haloBrowBar`;
    haloUpperChordBar.position.set(-0.006, 0.038, -sideZ * 0.022);
    internalPod.add(haloUpperChordBar);

    // Twin Horizontal Outer LED Signature Pips flanking the halo ring
    for (const pipZOff of [0.068, 0.112] as const) {
      const ledPip = new THREE.Mesh(
        new THREE.BoxGeometry(0.010, 0.016, 0.030),
        mats.ledHaloWhiteMat
      );
      ledPip.name = `${namePrefix}.headlight.signaturePip`;
      ledPip.position.set(-0.006, 0.004, sideZ * pipZOff);
      internalPod.add(ledPip);
    }

    // Conformal clear polycarbonate outer headlight lens flush with the front fascia pocket
    const outerLensGeo = createSingleSideConformalDefenderPatchGeometry(
      -2.360,
      -2.342,
      () => 0.295,
      () => 0.525,
      10,
      12,
      0.0052,
      0.0052,
      sideZ
    );
    const outerClearLens = new THREE.Mesh(outerLensGeo, mats.clearPolycarbonateLensMat);
    outerClearLens.name = `${namePrefix}.headlight.outerLens`;
    hlGroup.add(outerClearLens);
  }

  // C. Signature L663 H-Frame Front Bumper Fascia & Shadow Atlas A-Frame Skid Pan (`landRoverDefender.frontBumper`)
  //    100% conformal and physically connected to the monocoque body shell from `x = -2.38m` seamlessly back into
  //    the front wheel-arch leading edges (`x = -1.96m`) with zero gap.
  const frontBumperGroup = new THREE.Group();
  frontBumperGroup.name = `${namePrefix}.frontBumper`;
  defenderGroup.add(frontBumperGroup);

  // 1. Conformal Central Lower Bumper Fascia across the nose (`x = -2.38m..-2.356m, v = -0.58..+0.58`)
  const noseBumperFasciaGeo = createConformalDefenderPatchGeometry(
    -2.38,
    -2.356,
    () => 0.0,
    () => 0.58,
    12,
    24,
    0.0032,
    0.0032,
    false
  );
  const noseBumperFasciaMesh = new THREE.Mesh(noseBumperFasciaGeo, mats.satinAnthraciteMat);
  noseBumperFasciaMesh.name = `${namePrefix}.frontBumper`;
  noseBumperFasciaMesh.castShadow = true;
  noseBumperFasciaMesh.receiveShadow = true;
  frontBumperGroup.add(noseBumperFasciaMesh);

  // 2. Conformal Wraparound Side Bumper Wings (`v = 0.58..0.96` across the nose `x = -2.38m..-1.96m`)
  //    connecting seamlessly into the leading edges of the front wheel arches with zero gap
  const wrapBumperWingGeo = createConformalDefenderPatchGeometry(
    -2.38,
    -1.96,
    (x) => lerp(0.56, 0.68, smoothstep(-2.34, -1.96, x)),
    () => 0.96,
    24,
    12,
    0.0035,
    0.0035,
    true
  );
  const wrapBumperWingMesh = new THREE.Mesh(wrapBumperWingGeo, mats.santoriniBlackBodyMat);
  wrapBumperWingMesh.name = `${namePrefix}.frontBumper.wraparoundWing`;
  wrapBumperWingMesh.castShadow = true;
  wrapBumperWingMesh.receiveShadow = true;
  frontBumperGroup.add(wrapBumperWingMesh);

  // Lower wraparound Shadow Atlas / Satin Anthracite bumper valence moulding (`v = 0.78..0.96`, `x = -2.38m..-1.96m`)
  const wrapBumperLowerMouldingGeo = createConformalDefenderPatchGeometry(
    -2.38,
    -1.96,
    () => 0.78,
    () => 0.96,
    24,
    8,
    0.0048,
    0.0048,
    true
  );
  const wrapBumperLowerMouldingMesh = new THREE.Mesh(
    wrapBumperLowerMouldingGeo,
    mats.satinAnthraciteMat
  );
  wrapBumperLowerMouldingMesh.name = `${namePrefix}.frontBumper.lowerMoulding`;
  frontBumperGroup.add(wrapBumperLowerMouldingMesh);

  // 3. Signature L663 H-Frame Crossbar & Twin Vertical Uprights (`mats.satinAnthraciteMat`)
  const hFrameCrossbarGeo = createConformalDefenderPatchGeometry(
    -2.370,
    -2.358,
    () => 0.0,
    () => 0.52,
    8,
    20,
    0.0055,
    0.0055,
    false
  );
  const hFrameCrossbarMesh = new THREE.Mesh(hFrameCrossbarGeo, mats.satinAnthraciteMat);
  hFrameCrossbarMesh.name = `${namePrefix}.frontBumper.hFrameCrossbar`;
  frontBumperGroup.add(hFrameCrossbarMesh);

  for (const sideZ of [-1, 1] as const) {
    const uz = sideZ * 0.48;
    const uy = 0.58;
    const ux = sampleFrontNoseSurfaceXAtYZ(uy, uz) - 0.005;
    const hFrameUpright = new THREE.Mesh(
      new THREE.BoxGeometry(0.018, 0.44, 0.056),
      mats.satinAnthraciteMat
    );
    hFrameUpright.name = `${namePrefix}.frontBumper.hFrameUpright`;
    hFrameUpright.position.set(ux, uy, uz);
    hFrameUpright.rotation.y = sideZ * 0.14;
    hFrameUpright.rotation.z = -0.05;
    frontBumperGroup.add(hFrameUpright);
  }

  // 4. Recessed Central Lower Air Dam Intake with Horizontal Vanes (`y = 0.46m..0.58m, z = -0.44m..+0.44m`)
  const lowerAirDamGeo = createConformalDefenderPatchGeometry(
    -2.374,
    -2.364,
    () => 0.0,
    () => 0.25,
    6,
    14,
    0.0042,
    0.0042,
    false
  );
  const lowerAirDamMesh = new THREE.Mesh(lowerAirDamGeo, mats.narvikGlossBlackMat);
  lowerAirDamMesh.name = `${namePrefix}.frontBumper.lowerIntake`;
  frontBumperGroup.add(lowerAirDamMesh);

  for (const vaneY of [0.48, 0.535] as const) {
    const vanePts: THREE.Vector3[] = [];
    for (let i = 0; i <= 16; i++) {
      const u = (i / 16) * 2 - 1;
      const z = u * 0.43;
      const x = sampleFrontNoseSurfaceXAtYZ(vaneY, z) - 0.005;
      vanePts.push(new THREE.Vector3(x, vaneY, z));
    }
    const vaneCurve = new THREE.CatmullRomCurve3(vanePts);
    const vaneGeo = new THREE.TubeGeometry(vaneCurve, 18, 0.0065, 6, false);
    vaneGeo.computeBoundingSphere();
    const vaneMesh = new THREE.Mesh(vaneGeo, mats.narvikGlossBlackMat);
    vaneMesh.name = `${namePrefix}.frontBumper.intakeVane`;
    frontBumperGroup.add(vaneMesh);
  }

  // 5. Flush Shadow Atlas Lower A-Frame Skid Pan (`landRoverDefender.frontBumper.skidPan`)
  //    Curving smoothly underneath from `x = -2.38m + getPlanWrapShiftX(-2.38, z)` back to `x = -2.02m`
  const frontSkidPanGeo = createConformalFrontSkidPanGeometry();
  const frontSkidPan = new THREE.Mesh(frontSkidPanGeo, mats.satinAnthraciteMat);
  frontSkidPan.name = `${namePrefix}.frontBumper.skidPan`;
  frontSkidPan.castShadow = true;
  frontSkidPan.receiveShadow = true;
  frontBumperGroup.add(frontSkidPan);

  for (const slotZ of [-0.36, -0.12, 0.12, 0.36] as const) {
    const sy = 0.39;
    const sx = sampleFrontNoseSurfaceXAtYZ(sy, slotZ) - 0.009;
    const bashSlot = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.052, 0.11),
      mats.narvikGlossBlackMat
    );
    bashSlot.name = `${namePrefix}.frontBumper.skidBashSlot`;
    bashSlot.position.set(sx, sy, slotZ);
    bashSlot.rotation.y = (slotZ < 0 ? -1 : 1) * 0.08;
    bashSlot.rotation.z = -0.08;
    frontBumperGroup.add(bashSlot);
  }

  // 6. Flush Front Bumper Attachments (Fog Lamps, Tow Eyes, Radar Module, UK Front Registration Plate)
  for (const sideZ of [-1, 1] as const) {
    const fz = sideZ * 0.70;
    const fy = 0.56;
    const fx = sampleFrontNoseSurfaceXAtYZ(fy, fz) - 0.004;
    const fogHousing = new THREE.Mesh(
      new THREE.BoxGeometry(0.018, 0.064, 0.135),
      mats.narvikGlossBlackMat
    );
    fogHousing.name = `${namePrefix}.frontBumper.fogHousing`;
    fogHousing.position.set(fx, fy, fz);
    fogHousing.rotation.y = sideZ * 0.25;
    frontBumperGroup.add(fogHousing);

    const fogLampLed = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.026, 0.084),
      mats.ledHaloWhiteMat
    );
    fogLampLed.name = `${namePrefix}.frontBumper.fogLampLed`;
    fogLampLed.position.set(fx - 0.005, fy, fz);
    fogLampLed.rotation.y = sideZ * 0.25;
    frontBumperGroup.add(fogLampLed);

    // Heavy-duty front recovery tow eye loop (`z = ±0.46m, y = 0.34m`) with exact plan-wrap shift
    const tz = sideZ * 0.46;
    const ty = 0.34;
    const tx = sampleFrontNoseSurfaceXAtYZ(ty, tz) - 0.008;
    const towEye = new THREE.Mesh(
      new THREE.TorusGeometry(0.028, 0.008, 10, 20),
      mats.narvikGlossBlackMat
    );
    towEye.name = `${namePrefix}.frontBumper.towRecoveryEye`;
    towEye.position.set(tx, ty, tz);
    frontBumperGroup.add(towEye);
  }

  // Central ACC Front Radar Module flush in the lower intake (`y = 0.50m, z = 0`)
  const frontRadarModule = new THREE.Mesh(
    new THREE.BoxGeometry(0.016, 0.078, 0.13),
    mats.narvikGlossBlackMat
  );
  frontRadarModule.name = `${namePrefix}.frontBumper.radarSensor`;
  frontRadarModule.position.set(sampleFrontNoseSurfaceXAtYZ(0.50, 0) - 0.006, 0.50, 0);
  frontBumperGroup.add(frontRadarModule);

  // White UK Front Registration Plate (`"DEF 110X"`, flush on the H-frame bumper crossbar at `y = 0.66m, z = 0`)
  const frontPlatePlinth = new THREE.Mesh(
    new THREE.BoxGeometry(0.014, 0.108, 0.46),
    mats.narvikGlossBlackMat
  );
  frontPlatePlinth.name = `${namePrefix}.frontBumper.numberPlatePlinth`;
  frontPlatePlinth.position.set(sampleFrontNoseSurfaceXAtYZ(0.66, 0) - 0.006, 0.66, 0);
  frontPlatePlinth.rotation.z = -0.05;
  frontBumperGroup.add(frontPlatePlinth);

  const frontUkPlate = new THREE.Mesh(
    new THREE.BoxGeometry(0.010, 0.095, 0.44),
    new THREE.MeshStandardMaterial({
      map: createUkNumberPlateTexture(false),
      roughness: 0.24,
    })
  );
  frontUkPlate.name = `${namePrefix}.frontNumberPlate`;
  frontUkPlate.position.set(sampleFrontNoseSurfaceXAtYZ(0.66, 0) - 0.012, 0.66, 0);
  frontUkPlate.rotation.z = -0.05;
  tagHighLodDetail(frontUkPlate, 18);
  frontBumperGroup.add(frontUkPlate);
}

/**
 * Builds the vertical Kamm tailgate, exterior hinges, rear UK registration plate,
 * Carpathian V8 badge, recessed smoked quad-square LED taillights, high-mounted third
 * brake light, conformal rear Shadow Atlas bumper & skid diffuser, and quad V8 exhaust tailpipes.
 */
export function buildDefender110TailgateTaillightsAndExhaust(
  defenderGroup: THREE.Group,
  mats: Defender110Materials,
  namePrefix = 'landRoverDefender'
): void {
  const rearTailgateGroup = new THREE.Group();
  rearTailgateGroup.name = `${namePrefix}.tailgate`;
  defenderGroup.add(rearTailgateGroup);

  // Exposed Heavy-Duty Right-Side Exterior Tailgate Hinges (`x = +2.362m, z = +0.66m, y = 0.88m & 1.18m`)
  for (const hingeY of [0.88, 1.18] as const) {
    const hx = 2.356 + getPlanWrapShiftX(2.356, 0.64);
    const hingeBlock = new THREE.Mesh(
      new THREE.BoxGeometry(0.042, 0.056, 0.145),
      mats.narvikGlossBlackMat
    );
    hingeBlock.name = `${namePrefix}.tailgate.hingeBlock`;
    hingeBlock.position.set(hx, hingeY, 0.64);
    rearTailgateGroup.add(hingeBlock);

    const hingePin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.014, 0.072, 12),
      mats.satinAnthraciteMat
    );
    hingePin.name = `${namePrefix}.tailgate.hingePin`;
    hingePin.position.set(hx + 0.016, hingeY, 0.70);
    rearTailgateGroup.add(hingePin);
  }

  // Left-Side Tailgate Handle, Recessed Yellow UK Rear Number Plate (`"DEF 110X"`) & Red/Black `V8` Badge
  const tailgateGrabHandle = new THREE.Mesh(
    new THREE.BoxGeometry(0.032, 0.038, 0.165),
    mats.narvikGlossBlackMat
  );
  tailgateGrabHandle.name = `${namePrefix}.tailgate.grabHandle`;
  tailgateGrabHandle.position.set(2.362 + getPlanWrapShiftX(2.36, -0.56), 0.96, -0.56);
  rearTailgateGroup.add(tailgateGrabHandle);

  const rearPlateX = 2.358 + getPlanWrapShiftX(2.358, -0.44);
  const rearPlatePlinth = new THREE.Mesh(
    new THREE.BoxGeometry(0.022, 0.135, 0.48),
    mats.narvikGlossBlackMat
  );
  rearPlatePlinth.name = `${namePrefix}.tailgate.numberPlatePlinth`;
  rearPlatePlinth.position.set(rearPlateX, 0.75, -0.44);
  rearTailgateGroup.add(rearPlatePlinth);

  const rearUkPlate = new THREE.Mesh(
    new THREE.BoxGeometry(0.014, 0.095, 0.44),
    new THREE.MeshStandardMaterial({
      map: createUkNumberPlateTexture(true),
      roughness: 0.24,
    })
  );
  rearUkPlate.name = `${namePrefix}.rearNumberPlate`;
  rearUkPlate.position.set(rearPlateX + 0.012, 0.75, -0.44);
  tagHighLodDetail(rearUkPlate, 18);
  rearTailgateGroup.add(rearUkPlate);

  // Carpathian Edition Red-Accented `V8` Rear Tailgate Badge (`x = +2.36m, y = 0.60m, z = -0.58m`)
  const v8BadgeX = 2.36 + getPlanWrapShiftX(2.36, -0.58);
  const v8BadgeBack = new THREE.Mesh(
    new THREE.BoxGeometry(0.012, 0.036, 0.082),
    mats.ledCrimsonRedMat
  );
  v8BadgeBack.name = `${namePrefix}.tailgate.v8BadgeBacking`;
  v8BadgeBack.position.set(v8BadgeX, 0.60, -0.58);
  tagHighLodDetail(v8BadgeBack, 18);
  rearTailgateGroup.add(v8BadgeBack);

  const v8BadgeFace = new THREE.Mesh(
    new THREE.BoxGeometry(0.015, 0.028, 0.072),
    mats.narvikGlossBlackMat
  );
  v8BadgeFace.name = `${namePrefix}.tailgate.v8Badge`;
  v8BadgeFace.position.set(v8BadgeX + 0.002, 0.60, -0.58);
  tagHighLodDetail(v8BadgeFace, 18);
  rearTailgateGroup.add(v8BadgeFace);

  // C. Signature L663 Recessed Smoked Quad-Square LED Taillights (`landRoverDefender.taillight`)
  //    (`x = +2.35m, y = 0.88m..1.20m, z = ±0.83m`): stacked twin glowing crimson-red square LED ring cubes
  //    (`emissive: 0xff161c, emissiveIntensity: 2.4`) + outer vertical indicator pips per side.
  for (const sideZ of [-1, 1] as const) {
    const tlGroup = new THREE.Group();
    tlGroup.name = `${namePrefix}.taillight`;
    const tz = sideZ * 0.82;
    const tx = 2.345 + getPlanWrapShiftX(2.35, tz);
    tlGroup.position.set(tx, 1.04, tz);
    tlGroup.rotation.y = -sideZ * 0.16;
    defenderGroup.add(tlGroup);

    // Recessed Narvik Black vertical taillight bezel pocket (`y = 0.87m..1.21m`, height `0.34m`)
    const bezelPocket = new THREE.Mesh(
      new THREE.BoxGeometry(0.042, 0.34, 0.16),
      mats.narvikGlossBlackMat
    );
    bezelPocket.name = `${namePrefix}.taillight`;
    tlGroup.add(bezelPocket);

    // Stacked Twin Glowing Crimson-Red Square LED Ring Cubes (`yOff = -0.076m` lower cube, `+0.076m` upper cube)
    for (const yCubeOff of [-0.076, 0.076] as const) {
      const cubeGroup = new THREE.Group();
      cubeGroup.name = `${namePrefix}.taillight.quadCube`;
      cubeGroup.position.set(0.016, yCubeOff, -sideZ * 0.018);
      tlGroup.add(cubeGroup);

      // 4 glowing red bars forming the rounded-square L663 3D taillight ring
      const ringHalf = 0.036;
      const barThick = 0.011;
      for (const barY of [-ringHalf, ringHalf] as const) {
        const hBar = new THREE.Mesh(
          new THREE.BoxGeometry(0.016, barThick, ringHalf * 2 + barThick),
          mats.ledCrimsonRedMat
        );
        hBar.name = `${namePrefix}.taillight`;
        hBar.position.set(0, barY, 0);
        cubeGroup.add(hBar);
      }
      for (const barZ of [-ringHalf, ringHalf] as const) {
        const vBar = new THREE.Mesh(
          new THREE.BoxGeometry(0.016, ringHalf * 2 - barThick, barThick),
          mats.ledCrimsonRedMat
        );
        vBar.name = `${namePrefix}.taillight`;
        vBar.position.set(0, 0, barZ);
        cubeGroup.add(vBar);
      }

      // Smoked dark inner cube core + flush smoked polycarbonate lens
      const innerCore = new THREE.Mesh(
        new THREE.BoxGeometry(0.012, 0.052, 0.052),
        mats.narvikGlossBlackMat
      );
      innerCore.name = `${namePrefix}.taillight.cubeCore`;
      cubeGroup.add(innerCore);

      const cubeLens = new THREE.Mesh(
        new THREE.BoxGeometry(0.008, 0.092, 0.092),
        mats.smokedLensMat
      );
      cubeLens.name = `${namePrefix}.taillight.smokedLens`;
      cubeLens.position.set(0.016, 0, 0);
      cubeGroup.add(cubeLens);
    }

    // Outer Vertical Indicator & Reverse LED Pips flanking the quad-square taillight cubes
    for (const pipYOff of [-0.076, 0.0, 0.076] as const) {
      const pipMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.016, 0.044, 0.022),
        pipYOff === 0.0 ? mats.ledAmberPipMat : mats.ledCrimsonRedMat
      );
      pipMesh.name = `${namePrefix}.taillight.indicatorPip`;
      pipMesh.position.set(0.016, pipYOff, sideZ * 0.056);
      tlGroup.add(pipMesh);
    }
  }

  // High-Mounted Third LED Brake Light Strip above rear tailgate glass (`x = +2.29m, y = 1.91m, z = 0`)
  const chmslStrip = new THREE.Mesh(
    new THREE.BoxGeometry(0.018, 0.018, 0.42),
    mats.ledCrimsonRedMat
  );
  chmslStrip.name = `${namePrefix}.highMountStopLamp`;
  chmslStrip.position.set(2.295, 1.912, 0);
  defenderGroup.add(chmslStrip);

  // D. Defender V8 Quad Exhaust Tailpipes & Conformal Rear Shadow Atlas Bumper (`landRoverDefender.exhaust`)
  const exhaustGroup = new THREE.Group();
  exhaustGroup.name = `${namePrefix}.exhaust`;
  defenderGroup.add(exhaustGroup);

  // Conformal wraparound rear corner bumper wings (`x = +1.98m..+2.36m, v = 0.72..0.96`)
  const rearWrapBumperGeo = createConformalDefenderPatchGeometry(
    1.98,
    2.36,
    () => 0.72,
    () => 0.96,
    18,
    8,
    0.0038,
    0.0038,
    true
  );
  const rearWrapBumperMesh = new THREE.Mesh(rearWrapBumperGeo, mats.satinAnthraciteMat);
  rearWrapBumperMesh.name = `${namePrefix}.exhaust.rearBumperCorner`;
  rearWrapBumperMesh.castShadow = true;
  exhaustGroup.add(rearWrapBumperMesh);

  // Unscaled plan-curved rear Shadow Atlas bumper crossbeam (`x = +2.35m, y = 0.46m, z = -0.86m..+0.86m`)
  const rBumperPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 28; i++) {
    const u = (i / 28) * 2 - 1;
    const z = u * 0.86;
    const x = 2.348 + getPlanWrapShiftX(2.35, z);
    rBumperPts.push(new THREE.Vector3(x, 0.46, z));
  }
  const rBumperCurve = new THREE.CatmullRomCurve3(rBumperPts);
  const rBumperGeo = new THREE.TubeGeometry(rBumperCurve, 32, 0.068, 12, false);
  rBumperGeo.computeBoundingSphere();
  const rBumperBeam = new THREE.Mesh(rBumperGeo, mats.satinAnthraciteMat);
  rBumperBeam.name = `${namePrefix}.exhaust.rearBumperBeam`;
  rBumperBeam.castShadow = true;
  exhaustGroup.add(rBumperBeam);

  const rearSkidDiffuser = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.16, 1.06),
    mats.satinAnthraciteMat
  );
  rearSkidDiffuser.name = `${namePrefix}.exhaust.rearSkidDiffuser`;
  rearSkidDiffuser.position.set(2.28, 0.36, 0);
  rearSkidDiffuser.rotation.z = -0.35;
  exhaustGroup.add(rearSkidDiffuser);

  // Heavy-Duty Rear Recovery Tow Loop (`x = +2.36m, y = 0.35m, z = 0`)
  const rearTowMount = new THREE.Mesh(
    new THREE.BoxGeometry(0.065, 0.065, 0.14),
    mats.narvikGlossBlackMat
  );
  rearTowMount.name = `${namePrefix}.exhaust.rearTowMount`;
  rearTowMount.position.set(2.345, 0.36, 0);
  exhaustGroup.add(rearTowMount);

  const rearTowLoop = new THREE.Mesh(
    new THREE.TorusGeometry(0.036, 0.011, 12, 22),
    mats.narvikGlossBlackMat
  );
  rearTowLoop.name = `${namePrefix}.exhaust.rearTowLoop`;
  rearTowLoop.position.set(2.382, 0.345, 0);
  exhaustGroup.add(rearTowLoop);

  // Defender V8 Quad Exhaust Tailpipes (`z = ±0.54m & ±0.63m` centered at `x = +2.32m, y = 0.34m`)
  for (const sideZ of [-1, 1] as const) {
    for (const pipeZ of [0.535, 0.625] as const) {
      const pz = sideZ * pipeZ;
      const px = 2.32 + getPlanWrapShiftX(2.34, pz);
      const outerTip = new THREE.Mesh(
        new THREE.CylinderGeometry(0.038, 0.04, 0.12, 24, 1, true),
        mats.satinAnthraciteMat
      );
      outerTip.name = `${namePrefix}.exhaust`;
      outerTip.rotation.z = Math.PI / 2 - 0.08;
      outerTip.position.set(px, 0.34, pz);
      exhaustGroup.add(outerTip);

      const innerCore = new THREE.Mesh(
        new THREE.CylinderGeometry(0.032, 0.032, 0.095, 20),
        mats.narvikGlossBlackMat
      );
      innerCore.name = `${namePrefix}.exhaust.tailpipeCore`;
      innerCore.rotation.z = Math.PI / 2 - 0.08;
      innerCore.position.set(px - 0.008, 0.34, pz);
      exhaustGroup.add(innerCore);
    }
  }
}
