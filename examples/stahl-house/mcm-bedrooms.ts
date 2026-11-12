import * as THREE from 'three';
import type { CutawayWallDescriptor } from 'husjs';
import { createSculptedCushionGeometry } from 'husjs/catalog/furniture';
import {
  attachAssetInteraction,
  attachAssetMetadata,
  prepGeo,
  tagCollisionRole,
  tagCutaway,
} from 'husjs/objects';
import type { LightCircuitGroup, SceneBuilderContext } from 'husjs/viewer';
import { registerSeat } from './mcm-furniture.ts';
import { metricBox, type McmMaterials } from './mcm-materials.ts';
/**
 * Master Bedroom Suite (`stahlMasterSuite`) + Bedroom 2 (`stahlBedroom2`) Mid-Century Furnishings:
 *  - Master cantilevered American walnut platform bed w/ integrated floating nightstands, cone lamps & tailored bedding
 *  - Master floor-to-ceiling sliding walnut/Formica wardrobe, 6-drawer walnut lowboy dresser, framed serigraph & Eames LCW
 *  - Bedroom 2 twin walnut platform beds w/ striped geometric throws, George Nelson cantilevered desk + Eames DAW,
 *    floor-to-ceiling sliding wardrobe, and floating walnut wall shelves w/ books, Braun radio & Nelson clock.
 */
export function buildMasterAndBedroom2Furnishings(
  ctx: SceneBuilderContext,
  parent: THREE.Object3D,
  mcm: McmMaterials,
  cuts: { readonly northWoodsCut: CutawayWallDescriptor; readonly westCarportCut: CutawayWallDescriptor },
  ceilingTopY: number
): void {
  // =========================================================================
  // 1. MASTER SUITE (`X in [-4.636, -0.06], Z in [-5.934, 0.000]`)
  // =========================================================================
  // Koenig North-Wall Furred-Down Storage Soffit + Buck Stahl's Vertical Walnut Slat & Mirror Headboard Feature Wall
  const masterHeaderWall = new THREE.Group();
  masterHeaderWall.name = 'stahl.master.slatMirrorWall';
  const soffit = new THREE.Mesh(metricBox(4.52, 0.36, 0.34, 0.9, 0.9), mcm.walnut);
  soffit.position.set(-2.35, ceilingTopY - 0.182, -5.76);
  masterHeaderWall.add(soffit);

  const slatH = ceilingTopY - 0.368 - 0.74;
  const slatMidY = 0.74 + slatH * 0.5;
  const slatGeo = metricBox(0.085, slatH, 0.022, 0.6, 0.9);
  const mirrorStripGeo = prepGeo(new THREE.BoxGeometry(0.038, slatH, 0.012));
  for (let i = -5; i <= 5; i++) {
    const sx = -2.35 + i * 0.145;
    const slat = new THREE.Mesh(slatGeo, mcm.walnut);
    slat.position.set(sx, slatMidY, -5.915);
    masterHeaderWall.add(slat);
    if (i < 5) {
      const mir = new THREE.Mesh(mirrorStripGeo, mcm.plateMirror);
      mir.position.set(sx + 0.0725, slatMidY, -5.920);
      masterHeaderWall.add(mir);
    }
  }
  tagCutaway(masterHeaderWall, cuts.northWoodsCut);
  parent.add(masterHeaderWall);

  const masterRug = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(2.85, 0.0025, 2.65)), mcm.berberOat);
  masterRug.name = 'stahl.master.berberRug';
  masterRug.position.set(-2.35, 0.00175, -4.35);
  masterRug.receiveShadow = true;
  tagCollisionRole(masterRug, 'ignore');
  parent.add(masterRug);

  const bedY = 0.0036;
  const masterBed = new THREE.Group();
  masterBed.name = 'stahl.master.platformBed';
  masterBed.position.set(-2.35, bedY, -5.88); // Faces +Z (South toward Pool & LA Skyline!)

  // Wide cantilevered walnut headboard (`2.76 m` wide, topping at `Y = 0.725 m` cleanly below `Y=0.78` bedside switches!)
  const hb = new THREE.Mesh(metricBox(2.76, 0.56, 0.044, 0.9, 0.9), mcm.walnut);
  hb.position.set(0, 0.44, 0.022);
  hb.castShadow = true;
  masterBed.add(hb);

  // Integrated floating walnut nightstands (`X = +-1.03 m`, `0.52 m` wide x `0.40 m` deep) + brass/opal cone reading lamps
  const masterLightGrp = (ctx.lightGroups as Record<string, LightCircuitGroup>).stahlMasterCones;
  for (const sx of [-1, 1]) {
    const ns = new THREE.Mesh(metricBox(0.52, 0.14, 0.40, 0.7, 0.7), mcm.walnut);
    ns.position.set(sx * 1.08, 0.41, 0.249);
    ns.castShadow = true;
    const nsFront = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.48, 0.105, 0.012)), mcm.formicaWhite);
    nsFront.position.set(sx * 1.08, 0.41, 0.458);
    const nsPull = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.09, 0.012, 0.016)), mcm.satinBrass);
    nsPull.position.set(sx * 1.08, 0.41, 0.464);

    // Mid-century brass base + tilted opal/brass cone reading lamp (offset outward clear of `X = +-1.00` wall switch)
    const lampX = sx * 1.19;
    const lampZ = 0.26;
    const lampBase = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.068, 0.074, 0.016, 16)), mcm.satinBrass);
    lampBase.position.set(lampX, 0.491, lampZ);
    const lampStem = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.008, 0.008, 0.21, 10)), mcm.satinBrass);
    lampStem.position.set(lampX, 0.607, lampZ);
    const coneShadeMat = new THREE.MeshStandardMaterial({
      color: 0xfff8ea,
      emissive: new THREE.Color(0xffd496),
      emissiveIntensity: 1.25,
      roughness: 0.35,
      side: THREE.DoubleSide,
    });
    const coneShade = new THREE.Mesh(prepGeo(new THREE.ConeGeometry(0.088, 0.165, 18, 1, true)), coneShadeMat);
    coneShade.position.set(lampX - sx * 0.025, 0.70, lampZ + 0.03);
    coneShade.rotation.z = sx * 0.22;
    if (masterLightGrp) masterLightGrp.emissives.push(coneShadeMat);
    masterBed.add(ns, nsFront, nsPull, lampBase, lampStem, coneShade);
  }

  // Recessed plinth + cantilevered walnut bed deck (`1.72 x 2.12 m`)
  const plinth = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(1.36, 0.166, 1.76)), mcm.blackenedSteel);
  plinth.position.set(0, 0.083, 1.08);
  const platform = new THREE.Mesh(metricBox(1.74, 0.085, 2.12, 0.9, 0.9), mcm.walnut);
  platform.position.set(0, 0.213, 1.110);
  platform.castShadow = platform.receiveShadow = true;

  // Tailored oat-bouclé mattress/bedspread + warm ochre/olive end throw + 4 pillows
  const mattress = new THREE.Mesh(
    prepGeo(createSculptedCushionGeometry(1.64, 0.21, 2.02, 16, 8, 16, 0.45, 'standard')),
    mcm.bedspreadOat
  );
  mattress.position.set(0, 0.355, 1.11);
  mattress.castShadow = mattress.receiveShadow = true;

  const ochreThrow = new THREE.Mesh(
    prepGeo(createSculptedCushionGeometry(1.68, 0.045, 0.62, 14, 4, 8, 0.42, 'standard')),
    mcm.throwOchre
  );
  ochreThrow.position.set(0, 0.472, 1.76);
  const oliveFold = new THREE.Mesh(
    prepGeo(createSculptedCushionGeometry(1.69, 0.032, 0.24, 14, 4, 6, 0.42, 'standard')),
    mcm.throwOlive
  );
  oliveFold.position.set(0, 0.502, 1.92);
  masterBed.add(plinth, platform, mattress, ochreThrow, oliveFold);

  const pillowGeo = prepGeo(createSculptedCushionGeometry(0.68, 0.14, 0.36, 10, 6, 8, 0.54, 'standard', true));
  const lumbarGeo = prepGeo(createSculptedCushionGeometry(0.56, 0.125, 0.32, 10, 6, 8, 0.54, 'standard', true));
  for (const px of [-0.41, 0.41]) {
    const pBack = new THREE.Mesh(pillowGeo, mcm.pillowLinen);
    pBack.position.set(px, 0.51, 0.25);
    pBack.rotation.x = 0.28;
    const pFront = new THREE.Mesh(lumbarGeo, mcm.throwOlive);
    pFront.position.set(px, 0.495, 0.58);
    pFront.rotation.x = 0.18;
    masterBed.add(pBack, pFront);
  }

  registerSeat(ctx, masterBed, {
    id: 'stahl.master.platformBed.seat',
    label: 'Rest on Master Walnut Platform Bed',
    aliases: ['stahl.master.platformBed', 'master bed'],
    localSeatPos: [0, 0.48, 1.35],
    localFootOffset: [1.12, 0, 1.35],
    localForward: [0, 0, 1],
    material: 'linen',
  });

  attachAssetMetadata(masterBed, {
    name: 'Koenig / George Nelson Cantilevered Walnut Platform Bed & Floating Nightstands',
    brand: 'Herman Miller Residential',
    collection: 'Thin Edge Mid-Century Bedroom',
    sku: 'HM-5450-KING-WAL',
    finish: 'Book-Matched American Black Walnut, Satin Brass & Tailored Oat/Ochre Bouclé',
    category: 'furniture',
    dimensionsMm: [2760, 2165, 730],
  });
  parent.add(masterBed);

  // Master Floor-to-Ceiling Interactive Sliding Wardrobe (`West wall`, `X in [-4.63, -4.06], Z in [-5.88, -3.50]`)
  buildFloorToCeilingSlidingWardrobe(parent, mcm, {
    name: 'stahl.master.wardrobe',
    xCenter: -4.345,
    zCenter: -4.69,
    widthM: 2.38,
    depthM: 0.57,
    heightM: ceilingTopY - 0.002,
    facing: '+x',
    doorMatA: mcm.walnut,
    doorMatB: mcm.formicaWhite,
    brandLabel: 'Master Dressing Suite Floor-to-Ceiling Sliding Wardrobe',
  });

  // Master 6-Drawer American Walnut Lowboy Dresser (`East wall`, `X = -0.30, Z = -4.40`) + Framed Serigraph
  const dresser = new THREE.Group();
  dresser.name = 'stahl.master.lowboyDresser';
  dresser.position.set(-0.30, 0.0006, -4.40);
  dresser.rotation.y = -Math.PI * 0.5; // Faces -X into Master Suite

  const drW = 1.56;
  const drD = 0.45;
  const drLegH = 0.20;
  const drBodyH = 0.56;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.016, 0.011, drLegH, 10)), mcm.walnut);
      leg.position.set(sx * (drW * 0.5 - 0.05), drLegH * 0.5, sz * (drD * 0.5 - 0.05));
      dresser.add(leg);
    }
  }
  const drCarcass = new THREE.Mesh(metricBox(drW, drBodyH, drD - 0.02, 0.85, 0.85), mcm.walnut);
  drCarcass.position.set(0, drLegH + drBodyH * 0.5, -0.01);
  drCarcass.castShadow = true;
  dresser.add(drCarcass);

  const dwW = (drW - 0.05) * 0.5;
  const dwH = (drBodyH - 0.05) / 3;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 2; col++) {
      const dx = (col === 0 ? -1 : 1) * (dwW * 0.5 + 0.006);
      const dy = drLegH + 0.02 + dwH * (row + 0.5) + row * 0.006;
      const dGrp = new THREE.Group();
      dGrp.name = `stahl.master.lowboy.drawer_${row}_${col}`;
      dGrp.position.set(dx, dy, drD * 0.5 - 0.008);
      const front = new THREE.Mesh(metricBox(dwW, dwH, 0.018, 0.7, 0.7), mcm.walnut);
      const pull = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.11, 0.012, 0.018)), mcm.satinBrass);
      pull.position.z = 0.016;
      dGrp.add(front, pull);
      if (row === 2) {
        attachAssetInteraction(dGrp, {
          kind: 'slide',
          id: `stahl-master-dresser-drawer-${col}`,
          label: 'Open Walnut Lowboy Top Drawer',
          slideDelta: [0, 0, 0.30],
          audio: { openPreset: 'drawerSlide', volume: 0.45 },
        });
      }
      dresser.add(dGrp);
    }
  }

  // Ceramic vase on lowboy top
  const drVase = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.042, 0.068, 0.24, 16)), mcm.ceramicTeal);
  drVase.position.set(0.46, drLegH + drBodyH + 0.121, -0.02);
  dresser.add(drVase);

  attachAssetMetadata(dresser, {
    name: 'George Nelson Thin-Edge 6-Drawer American Walnut Lowboy Dresser',
    brand: 'Herman Miller',
    collection: 'Thin Edge Casegoods (1954)',
    sku: 'HM-5206-WAL',
    finish: 'Book-Matched American Walnut & Satin Brass Linear Pulls',
    category: 'furniture',
    dimensionsMm: [1560, 450, 760],
  });
  parent.add(dresser);

  // Framed Hard-Edge California Geometric Serigraph on Master East `wingDivider` (`X = -0.072`)
  const artGroup = new THREE.Group();
  artGroup.name = 'stahl.master.serigraphArt';
  artGroup.position.set(-0.072, 1.56, -4.40);
  artGroup.rotation.y = -Math.PI * 0.5;
  const artFrame = new THREE.Mesh(metricBox(0.96, 0.74, 0.024, 0.6, 0.6), mcm.walnut);
  const artPrint = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.91, 0.69, 0.006)), mcm.serigraphMat);
  artPrint.position.z = 0.014;
  artGroup.add(artFrame, artPrint);
  parent.add(artGroup);

  // Eames Molded Plywood Lounge Chair (`LCW`) in Master SE pool-view corner (`-0.88, -2.35`)
  buildEamesLcwChair(ctx, parent, mcm, {
    name: 'stahl.master.eamesLcw',
    position: [-0.88, 0.0006, -2.35],
    rotationY: -Math.PI * 0.74,
  });

  // =========================================================================
  // 2. BEDROOM 2 / GUEST & STUDY (`X in [-12.11, -7.36], Z in [-5.93, 0.00]`)
  // =========================================================================
  const bed2Rug = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(3.45, 0.0025, 2.75)), mcm.berberOat);
  bed2Rug.name = 'stahl.bed2.berberRug';
  bed2Rug.position.set(-10.12, 0.00175, -4.25);
  bed2Rug.receiveShadow = true;
  tagCollisionRole(bed2Rug, 'ignore');
  parent.add(bed2Rug);

  // Twin American Walnut Platform Beds with Striped Mid-Century Geometric Throws (`X = -11.16` & `X = -9.08`)
  for (const [bIdx, bx] of [[1, -11.16], [2, -9.08]] as const) {
    const tBed = new THREE.Group();
    const tbName = `stahl.bed2.twinBed_${bIdx}`;
    tBed.name = tbName;
    tBed.position.set(bx, 0.0036, -5.88);

    const tHb = new THREE.Mesh(metricBox(1.06, 0.58, 0.038, 0.8, 0.8), mcm.walnut);
    tHb.position.set(0, 0.45, 0.019);
    const tFrame = new THREE.Mesh(metricBox(1.06, 0.08, 2.02, 0.8, 0.8), mcm.walnut);
    tFrame.position.set(0, 0.22, 1.054);
    for (const lx of [-0.46, 0.46]) {
      for (const lz of [0.16, 1.94]) {
        const leg = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.016, 0.011, 0.176, 10)), mcm.walnut);
        leg.position.set(lx, 0.088, lz);
        tBed.add(leg);
      }
    }
    const tMatt = new THREE.Mesh(
      prepGeo(createSculptedCushionGeometry(0.98, 0.19, 1.94, 12, 6, 14, 0.45, 'standard')),
      mcm.bedspreadOat
    );
    tMatt.position.set(0, 0.35, 1.03);
    tMatt.castShadow = tMatt.receiveShadow = true;

    const tThrow = new THREE.Mesh(
      prepGeo(createSculptedCushionGeometry(1.01, 0.038, 0.72, 12, 4, 8, 0.42, 'standard')),
      mcm.throwStriped
    );
    tThrow.position.set(0, 0.458, 1.56);

    const tPillow = new THREE.Mesh(
      prepGeo(createSculptedCushionGeometry(0.66, 0.13, 0.36, 10, 6, 8, 0.54, 'standard', true)),
      mcm.pillowLinen
    );
    tPillow.position.set(0, 0.49, 0.27);
    tPillow.rotation.x = 0.24;
    tBed.add(tHb, tFrame, tMatt, tThrow, tPillow);

    registerSeat(ctx, tBed, {
      id: `${tbName}.seat`,
      label: `Sit on Mid-Century Walnut Twin Bed ${bIdx}`,
      aliases: [tbName, 'twin bed'],
      localSeatPos: [0, 0.46, 1.25],
      localFootOffset: [0, 0, 2.35],
      localForward: [0, 0, 1],
      material: 'linen',
    });

    attachAssetMetadata(tBed, {
      name: 'Mid-Century American Walnut Twin Platform Bed',
      brand: 'Vista of California / Case Study Custom',
      collection: 'California Modern Bedroom 1960',
      sku: `VC-TWIN-WAL-${bIdx}`,
      finish: 'American Black Walnut & Woven Multi-Stripe Geometric Wool Throw',
      category: 'furniture',
      dimensionsMm: [1060, 2040, 740],
    });
    parent.add(tBed);
  }

  // Shared Walnut Nightstand + Cone Lamp between Twin Beds (`X = -10.12, Z = -5.64`)
  const denGrp = (ctx.lightGroups as Record<string, LightCircuitGroup>).stahlDenCones;
  const sharedNs = new THREE.Group();
  sharedNs.name = 'stahl.bed2.sharedNightstand';
  sharedNs.position.set(-10.12, 0.0036, -5.64);
  const sBox = new THREE.Mesh(metricBox(0.50, 0.22, 0.40, 0.6, 0.6), mcm.walnut);
  sBox.position.y = 0.38;
  const sDrawer = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.46, 0.17, 0.012)), mcm.formicaAqua);
  sDrawer.position.set(0, 0.38, 0.206);
  for (const lx of [-0.21, 0.21]) {
    for (const lz of [-0.16, 0.16]) {
      const leg = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.012, 0.009, 0.27, 8)), mcm.walnut);
      leg.position.set(lx, 0.135, lz);
      sharedNs.add(leg);
    }
  }
  const sLampMat = new THREE.MeshStandardMaterial({
    color: 0xfff8eb,
    emissive: new THREE.Color(0xffd59c),
    emissiveIntensity: 1.25,
    roughness: 0.35,
  });
  const sLampBase = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.06, 0.068, 0.016, 14)), mcm.satinBrass);
  sLampBase.position.y = 0.498;
  const sLampStem = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.008, 0.008, 0.18, 10)), mcm.satinBrass);
  sLampStem.position.y = 0.59;
  const sLampGlobe = new THREE.Mesh(prepGeo(new THREE.SphereGeometry(0.078, 16, 12)), sLampMat);
  sLampGlobe.position.y = 0.71;
  if (denGrp) denGrp.emissives.push(sLampMat);
  sharedNs.add(sBox, sDrawer, sLampBase, sLampStem, sLampGlobe);
  parent.add(sharedNs);

  // Bedroom 2 Floor-to-Ceiling Sliding Wardrobe (`East wall`, `X in [-7.93, -7.36], Z in [-5.88, -3.68]`)
  buildFloorToCeilingSlidingWardrobe(parent, mcm, {
    name: 'stahl.bed2.wardrobe',
    xCenter: -7.645,
    zCenter: -4.78,
    widthM: 2.20,
    depthM: 0.57,
    heightM: ceilingTopY - 0.002,
    facing: '-x',
    doorMatA: mcm.formicaMustard,
    doorMatB: mcm.walnut,
    brandLabel: 'Bedroom 2 Color-Blocked Formica & Walnut Sliding Wardrobe',
  });

  // George Nelson Cantilevered Walnut & Chrome Desk (`West wall`, `X = -11.62, Z = -2.05`) + Eames DAW Chair
  const desk = new THREE.Group();
  desk.name = 'stahl.bed2.nelsonDeskCabinet';
  desk.position.set(-11.62, 0.0006, -2.05);
  desk.rotation.y = Math.PI * 0.5; // Local +Z faces East into room

  const dkW = 1.32;
  const dkD = 0.66;
  const dkH = 0.74;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.022, dkH - 0.03, 0.022)), mcm.polishedChrome);
      leg.position.set(sx * (dkW * 0.5 - 0.04), (dkH - 0.03) * 0.5, sz * (dkD * 0.5 - 0.05));
      desk.add(leg);
    }
    const stretcher = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.02, 0.02, dkD - 0.12)), mcm.polishedChrome);
    stretcher.position.set(sx * (dkW * 0.5 - 0.04), 0.18, 0);
    desk.add(stretcher);
  }
  const dkTop = new THREE.Mesh(metricBox(dkW, 0.028, dkD, 0.85, 0.85), mcm.walnut);
  dkTop.position.y = dkH - 0.014;
  dkTop.castShadow = dkTop.receiveShadow = true;

  // Suspended right-hand walnut pedestal drawer box
  const pedBox = new THREE.Mesh(metricBox(0.42, 0.24, dkD - 0.08, 0.6, 0.6), mcm.walnut);
  pedBox.position.set(0.39, dkH - 0.155, -0.01);
  const dkDrawer = new THREE.Group();
  dkDrawer.name = 'stahl.bed2.nelsonDesk.drawer';
  dkDrawer.position.set(0.39, dkH - 0.155, dkD * 0.5 - 0.042);
  const dkDrFront = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.39, 0.20, 0.014)), mcm.formicaWhite);
  const dkDrPull = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.09, 0.012, 0.016)), mcm.polishedChrome);
  dkDrPull.position.z = 0.014;
  dkDrawer.add(dkDrFront, dkDrPull);
  attachAssetInteraction(dkDrawer, {
    kind: 'slide',
    id: 'stahl-nelson-desk-drawer',
    label: 'Open George Nelson Desk Drawer',
    slideDelta: [0, 0, 0.32],
    audio: { openPreset: 'drawerSlide', volume: 0.45 },
  });

  // Articulated Architect's Task Lamp + Open Notebook on Desk
  const dLampBase = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.075, 0.082, 0.018, 16)), mcm.blackenedSteel);
  dLampBase.position.set(-0.44, dkH + 0.009, -0.18);
  const dLampArm = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.007, 0.007, 0.36, 8)), mcm.satinBrass);
  dLampArm.position.set(-0.40, dkH + 0.18, -0.14);
  dLampArm.rotation.z = -0.22;
  const dLampCone = new THREE.Mesh(prepGeo(new THREE.ConeGeometry(0.075, 0.14, 16, 1, true)), mcm.formicaPersimmon);
  dLampCone.position.set(-0.34, dkH + 0.34, -0.10);
  dLampCone.rotation.z = -0.55;
  const notebook = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.28, 0.012, 0.21)), mcm.formicaWhite);
  notebook.position.set(-0.08, dkH + 0.007, 0.08);
  desk.add(dkTop, pedBox, dkDrawer, dLampBase, dLampArm, dLampCone, notebook);

  attachAssetMetadata(desk, {
    name: 'George Nelson Action Office / Home Cantilevered Walnut & Chrome Desk',
    brand: 'Herman Miller',
    collection: 'George Nelson Executive Home Study',
    sku: 'HM-4658-WAL',
    finish: 'American Black Walnut, Crisp White Formica Drawer & Polished Chrome Frame',
    category: 'furniture',
    dimensionsMm: [1320, 660, 740],
  });
  parent.add(desk);

  // Eames Molded Fiberglass `DAW` Armchair at Desk (`X = -10.88, Z = -2.05`, facing West `-X`)
  const daw = new THREE.Group();
  daw.name = 'stahl.bed2.eamesDawChair';
  daw.position.set(-10.88, 0.0006, -2.05);
  daw.rotation.y = -Math.PI * 0.5;
  const dawSeat = new THREE.Mesh(
    prepGeo(createSculptedCushionGeometry(0.56, 0.044, 0.46, 12, 4, 10, 0.52, 'standard')),
    mcm.fiberglassSeafoam
  );
  dawSeat.position.set(0, 0.44, 0.01);
  const dawBack = new THREE.Mesh(
    prepGeo(createSculptedCushionGeometry(0.56, 0.35, 0.038, 12, 8, 4, 0.52, 'standard')),
    mcm.fiberglassSeafoam
  );
  dawBack.position.set(0, 0.62, -0.20);
  dawBack.rotation.x = -0.15;
  for (const sx of [-1, 1]) {
    const dawArm = new THREE.Mesh(
      prepGeo(createSculptedCushionGeometry(0.075, 0.16, 0.36, 6, 4, 8, 0.5, 'standard')),
      mcm.fiberglassSeafoam
    );
    dawArm.position.set(sx * 0.265, 0.56, -0.02);
    daw.add(dawArm);
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.013, 0.009, 0.435, 10)), mcm.walnut);
      leg.position.set(sx * 0.18, 0.215, sz * 0.175);
      leg.rotation.z = -sx * 0.15;
      leg.rotation.x = sz * 0.15;
      daw.add(leg);
    }
  }
  daw.add(dawSeat, dawBack);
  registerSeat(ctx, daw, {
    id: 'stahl.bed2.eamesDawChair.seat',
    label: 'Sit in Eames Fiberglass DAW Study Armchair',
    aliases: ['stahl.bed2.eamesDawChair', 'study chair', 'daw chair'],
    localSeatPos: [0, 0.46, 0.02],
    localFootOffset: [0, 0, -0.62],
    localForward: [0, 0, 1],
    material: 'timber',
  });
  attachAssetMetadata(daw, {
    name: 'Eames Molded Fiberglass Dowel-Leg Armchair (DAW — Seafoam)',
    brand: 'Herman Miller',
    collection: 'Charles & Ray Eames Fiberglass Armchair Group',
    sku: 'HM-DAW-SFM',
    finish: 'Seafoam Green Fiberglass Arm Shell & American Walnut Dowel Base',
    category: 'furniture',
    dimensionsMm: [625, 600, 805],
  });
  parent.add(daw);

  // Floating Walnut Wall Shelves on West `carportWall` (`X = -12.11`, tagged with `cuts.westCarportCut`!)
  const shelves = new THREE.Group();
  shelves.name = 'stahl.bed2.floatingShelves';
  shelves.position.set(-11.98, 0, -2.05);

  for (const sy of [1.38, 1.76]) {
    const plank = new THREE.Mesh(metricBox(0.24, 0.026, 1.24, 0.7, 0.7), mcm.walnut);
    plank.position.set(0, sy, 0);
    plank.castShadow = true;
    shelves.add(plank);
  }

  // Hardcover mid-century design books on lower shelf
  const bookMats = [mcm.formicaAqua, mcm.formicaMustard, mcm.formicaPersimmon, mcm.formicaWhite, mcm.ceramicTeal];
  for (let i = 0; i < 7; i++) {
    const bh = 0.19 + (i % 3) * 0.025;
    const book = new THREE.Mesh(
      prepGeo(new THREE.BoxGeometry(0.17, bh, 0.026)),
      bookMats[i % bookMats.length]!
    );
    book.position.set(-0.01, 1.394 + bh * 0.5, -0.44 + i * 0.032);
    shelves.add(book);
  }

  // Vintage Dieter Rams / Braun SK-2 Table Radio + George Nelson Desk Clock
  const radio = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.11, 0.145, 0.23)), mcm.formicaWhite);
  radio.position.set(0.01, 1.394 + 0.0725, 0.28);
  const radioDial = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.024, 0.024, 0.012, 14)), mcm.formicaCharcoal);
  radioDial.rotation.z = Math.PI * 0.5;
  radioDial.position.set(0.068, 1.48, 0.33);

  const clockBody = new THREE.Mesh(metricBox(0.07, 0.13, 0.13, 0.4, 0.4), mcm.walnut);
  clockBody.position.set(0.01, 1.774 + 0.065, -0.18);
  const clockFace = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.048, 0.048, 0.008, 18)), mcm.satinBrass);
  clockFace.rotation.z = Math.PI * 0.5;
  clockFace.position.set(0.048, 1.839, -0.18);
  shelves.add(radio, radioDial, clockBody, clockFace);

  tagCutaway(shelves, cuts.westCarportCut);
  parent.add(shelves);
}

/** Eames Molded Plywood Lounge Chair (`LCW`, 1946) in sculpted American walnut. */
function buildEamesLcwChair(
  ctx: SceneBuilderContext,
  parent: THREE.Object3D,
  mcm: McmMaterials,
  options: {
    readonly name: string;
    readonly position: readonly [number, number, number];
    readonly rotationY: number;
  }
): void {
  const { name, position, rotationY } = options;
  const g = new THREE.Group();
  g.name = name;
  g.position.set(position[0], position[1], position[2]);
  g.rotation.y = rotationY;

  const spine = new THREE.Mesh(metricBox(0.09, 0.022, 0.48, 0.6, 0.6), mcm.walnut);
  spine.position.set(0, 0.30, -0.02);
  spine.rotation.x = -0.14;
  const backPost = new THREE.Mesh(metricBox(0.085, 0.34, 0.022, 0.6, 0.6), mcm.walnut);
  backPost.position.set(0, 0.44, -0.23);
  backPost.rotation.x = -0.18;

  for (const [lz, lh, tilt] of [[0.18, 0.32, 0.16], [-0.18, 0.28, -0.20]] as const) {
    const legArch = new THREE.Mesh(metricBox(0.48, lh, 0.022, 0.6, 0.6), mcm.walnut);
    legArch.position.set(0, lh * 0.5, lz);
    legArch.rotation.x = tilt;
    g.add(legArch);
  }

  const seatPan = new THREE.Mesh(
    prepGeo(createSculptedCushionGeometry(0.55, 0.024, 0.47, 12, 4, 10, 0.48, 'standard')),
    mcm.walnut
  );
  seatPan.position.set(0, 0.355, 0.03);
  seatPan.rotation.x = -0.15;
  seatPan.castShadow = true;

  const backPan = new THREE.Mesh(
    prepGeo(createSculptedCushionGeometry(0.52, 0.31, 0.022, 12, 8, 4, 0.48, 'standard')),
    mcm.walnut
  );
  backPan.position.set(0, 0.55, -0.215);
  backPan.rotation.x = -0.18;
  backPan.castShadow = true;
  g.add(spine, backPost, seatPan, backPan);

  registerSeat(ctx, g, {
    id: `${name}.seat`,
    label: 'Sit in Eames Molded Plywood Lounge Chair (LCW)',
    aliases: [name, 'lcw chair', 'plywood chair'],
    localSeatPos: [0, 0.37, 0.03],
    localFootOffset: [0, 0, 0.64],
    localForward: [0, 0, 1],
    material: 'timber',
  });

  attachAssetMetadata(g, {
    name: 'Eames Molded Plywood Lounge Chair Wood (LCW)',
    brand: 'Herman Miller',
    collection: 'Charles & Ray Eames Molded Plywood Group (1946)',
    sku: 'HM-LCW-WAL',
    finish: '5-Ply Molded American Black Walnut Veneer & Rubber Shock Mounts',
    category: 'furniture',
    dimensionsMm: [560, 615, 675],
  });

  parent.add(g);
}

/** Shared builder for floor-to-ceiling mid-century sliding walnut & Formica wardrobes. */
export function buildFloorToCeilingSlidingWardrobe(
  parent: THREE.Object3D,
  mcm: McmMaterials,
  options: {
    readonly name: string;
    readonly xCenter: number;
    readonly zCenter: number;
    readonly widthM: number;
    readonly depthM: number;
    readonly heightM: number;
    readonly facing: '+x' | '-x' | '+z' | '-z';
    readonly doorMatA: THREE.Material;
    readonly doorMatB: THREE.Material;
    readonly brandLabel: string;
  }
): THREE.Group {
  const { name, xCenter, zCenter, widthM, depthM, heightM, facing, doorMatA, doorMatB, brandLabel } = options;
  const g = new THREE.Group();
  g.name = name;
  g.position.set(xCenter, 0.0006, zCenter);
  g.rotation.y =
    facing === '+z' ? 0 : facing === '-z' ? Math.PI : facing === '+x' ? Math.PI * 0.5 : -Math.PI * 0.5;

  const t = 0.024;
  // Carcass shell + internal chrome hanging rod & luggage shelf
  const top = new THREE.Mesh(metricBox(widthM, t, depthM, 0.9, 0.9), mcm.walnut);
  top.position.y = heightM - t * 0.5;
  const bot = new THREE.Mesh(metricBox(widthM, t, depthM, 0.9, 0.9), mcm.walnut);
  bot.position.y = t * 0.5;
  const back = new THREE.Mesh(metricBox(widthM - t * 2 - 0.002, heightM - t * 2 - 0.002, 0.018, 0.9, 0.9), mcm.walnut);
  back.position.set(0, heightM * 0.5, -depthM * 0.5 + 0.01);
  const luggageShelf = new THREE.Mesh(metricBox(widthM - t * 2 - 0.004, 0.02, depthM - 0.09, 0.9, 0.9), mcm.walnut);
  luggageShelf.position.set(0, 1.92, -0.025);
  const rail = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.014, 0.014, widthM - t * 2 - 0.01, 12)), mcm.polishedChrome);
  rail.rotation.z = Math.PI * 0.5;
  rail.position.set(0, 1.78, -0.03);
  g.add(top, bot, back, luggageShelf, rail);

  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(metricBox(t, heightM - t * 2 - 0.002, depthM, 0.9, 0.9), mcm.walnut);
    side.position.set(sx * (widthM * 0.5 - t * 0.5), heightM * 0.5, 0);
    side.castShadow = true;
    g.add(side);
  }

  // Two floor-to-ceiling bypass sliding doors on anodized aluminum tracks
  const doorW = (widthM - t * 2) * 0.5 + 0.03;
  const doorH = heightM - t * 2 - 0.008;
  const travel = doorW - 0.10;

  const doorA = new THREE.Group();
  doorA.name = `${name}.doorLeft`;
  doorA.position.set(-doorW * 0.5 + 0.015, heightM * 0.5, depthM * 0.5 - 0.038);
  const leafA = new THREE.Mesh(metricBox(doorW, doorH, 0.02, 0.9, 0.9), doorMatA);
  const pullA = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.016, 0.16, 0.012)), mcm.dieCastAlum);
  pullA.position.set(-doorW * 0.5 + 0.06, -0.12, 0.015);
  doorA.add(leafA, pullA);
  attachAssetInteraction(doorA, {
    kind: 'slide',
    id: `${name}-slide-left`,
    label: `Slide ${brandLabel} Left Panel`,
    slideDelta: [travel, 0, 0],
    audio: { openPreset: 'drawerSlide', volume: 0.5 },
  });

  const doorB = new THREE.Group();
  doorB.name = `${name}.doorRight`;
  doorB.position.set(doorW * 0.5 - 0.015, heightM * 0.5, depthM * 0.5 - 0.014);
  const leafB = new THREE.Mesh(metricBox(doorW, doorH, 0.02, 0.9, 0.9), doorMatB);
  const pullB = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.016, 0.16, 0.012)), mcm.dieCastAlum);
  pullB.position.set(doorW * 0.5 - 0.06, -0.12, 0.015);
  doorB.add(leafB, pullB);
  attachAssetInteraction(doorB, {
    kind: 'slide',
    id: `${name}-slide-right`,
    label: `Slide ${brandLabel} Right Panel`,
    slideDelta: [-travel, 0, 0],
    audio: { openPreset: 'drawerSlide', volume: 0.5 },
  });
  g.add(doorA, doorB);

  attachAssetMetadata(g, {
    name: brandLabel,
    brand: 'Pierre Koenig / Case Study House #22 Architectural Millwork',
    collection: 'CSH #22 Built-In Storage System',
    sku: `CSH22-WRD-${Math.round(widthM * 100)}`,
    finish: 'Book-Matched American Black Walnut, Formica Laminate & Anodized Aluminum Track',
    category: 'joinery',
    dimensionsMm: [Math.round(widthM * 1000), Math.round(depthM * 1000), Math.round(heightM * 1000)],
  });

  parent.add(g);
  return g;
}

/**
 * Florence Knoll American Walnut & Brushed-Chrome Credenza (`1680 x 460 x 680 mm`)
 * with interactive sliding Formica/walnut doors and a vintage Braun Hi-Fi turntable on top.
 */
export function buildFlorenceKnollCredenza(
  parent: THREE.Object3D,
  mcm: McmMaterials,
  position: readonly [number, number, number],
  rotationY = 0
): THREE.Group {
  const g = new THREE.Group();
  g.name = 'stahl.dining.knollCredenzaCabinet';
  g.position.set(position[0], position[1], position[2]);
  g.rotation.y = rotationY;

  const w = 1.68;
  const d = 0.46;
  const legH = 0.22;
  const bodyH = 0.45;
  const t = 0.022;

  // Polished chrome T-angle base & 4 corner legs
  const legGeo = prepGeo(new THREE.BoxGeometry(0.022, legH, 0.022));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, mcm.polishedChrome);
      leg.position.set(sx * (w * 0.5 - 0.025), legH * 0.5, sz * (d * 0.5 - 0.025));
      leg.castShadow = true;
      g.add(leg);
    }
  }
  const railGeo = prepGeo(new THREE.BoxGeometry(w - 0.04, 0.02, 0.02));
  for (const sz of [-1, 1]) {
    const r = new THREE.Mesh(railGeo, mcm.polishedChrome);
    r.position.set(0, legH + 0.01, sz * (d * 0.5 - 0.025));
    g.add(r);
  }

  // Hollow book-matched American walnut carcass + honed travertine top slab
  const baseY = legH + 0.021;
  const botPanel = new THREE.Mesh(metricBox(w, t, d, 0.85, 0.85), mcm.walnut);
  botPanel.position.set(0, baseY + t * 0.5, 0);
  const topPanel = new THREE.Mesh(metricBox(w, t, d, 0.85, 0.85), mcm.travertine);
  topPanel.position.set(0, baseY + bodyH - t * 0.5, 0);
  topPanel.castShadow = topPanel.receiveShadow = true;
  const backPanel = new THREE.Mesh(metricBox(w - t * 2 - 0.002, bodyH - t * 2 - 0.002, 0.016, 0.85, 0.85), mcm.walnut);
  backPanel.position.set(0, baseY + bodyH * 0.5, -d * 0.5 + 0.012);
  const shelf = new THREE.Mesh(metricBox(w - t * 2 - 0.004, 0.016, d - 0.08, 0.85, 0.85), mcm.walnut);
  shelf.position.set(0, baseY + bodyH * 0.5, -0.02);
  g.add(botPanel, topPanel, backPanel, shelf);

  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(metricBox(t, bodyH - t * 2 - 0.002, d, 0.85, 0.85), mcm.walnut);
    side.position.set(sx * (w * 0.5 - t * 0.5), baseY + bodyH * 0.5, 0);
    side.castShadow = true;
    g.add(side);
  }

  // Two interactive sliding doors (parchment Formica left, book-matched walnut right)
  const doorW = (w - t * 2) * 0.5 + 0.02;
  const doorH = bodyH - t * 2 - 0.006;
  const doorY = baseY + bodyH * 0.5;

  const doorL = new THREE.Group();
  doorL.name = 'stahl.dining.credenza.doorLeft';
  doorL.position.set(-doorW * 0.5 + 0.01, doorY, d * 0.5 - 0.036);
  const leafL = new THREE.Mesh(metricBox(doorW, doorH, 0.016, 0.8, 0.8), mcm.formicaWhite);
  const pullL = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.014, 0.09, 0.012)), mcm.polishedChrome);
  pullL.position.set(-doorW * 0.5 + 0.045, 0, 0.012);
  doorL.add(leafL, pullL);
  attachAssetInteraction(doorL, {
    kind: 'slide',
    id: 'stahl-credenza-door-left',
    label: 'Slide Florence Knoll Credenza Left Door',
    slideDelta: [doorW - 0.08, 0, 0],
    audio: { openPreset: 'drawerSlide', volume: 0.45 },
  });

  const doorR = new THREE.Group();
  doorR.name = 'stahl.dining.credenza.doorRight';
  doorR.position.set(doorW * 0.5 - 0.01, doorY, d * 0.5 - 0.016);
  const leafR = new THREE.Mesh(metricBox(doorW, doorH, 0.016, 0.8, 0.8), mcm.walnut);
  const pullR = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.014, 0.09, 0.012)), mcm.polishedChrome);
  pullR.position.set(doorW * 0.5 - 0.045, 0, 0.012);
  doorR.add(leafR, pullR);
  attachAssetInteraction(doorR, {
    kind: 'slide',
    id: 'stahl-credenza-door-right',
    label: 'Slide Florence Knoll Credenza Right Door',
    slideDelta: [-(doorW - 0.08), 0, 0],
    audio: { openPreset: 'drawerSlide', volume: 0.45 },
  });
  g.add(doorL, doorR);

  // Vintage Braun / Garrard Walnut & Aluminum Hi-Fi Turntable on top (`mediaPlayback` toggle!)
  const surfY = baseY + bodyH + 0.0008;
  const ttGroup = new THREE.Group();
  ttGroup.name = 'stahl.dining.hifiTurntable';
  ttGroup.position.set(-0.42, surfY, 0);
  const plinth = new THREE.Mesh(metricBox(0.42, 0.056, 0.34, 0.6, 0.6), mcm.walnut);
  plinth.position.y = 0.028;
  const deckPlate = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.39, 0.006, 0.31)), mcm.dieCastAlum);
  deckPlate.position.y = 0.059;
  const platter = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.135, 0.135, 0.012, 24)), mcm.vinylRecord);
  platter.position.set(-0.03, 0.068, 0);
  const label = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.045, 0.045, 0.002, 16)), mcm.formicaPersimmon);
  label.position.set(-0.03, 0.075, 0);
  const tonearm = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.003, 0.003, 0.21, 8)), mcm.polishedChrome);
  tonearm.rotation.x = Math.PI * 0.5;
  tonearm.rotation.z = 0.24;
  tonearm.position.set(0.11, 0.082, 0.01);
  ttGroup.add(plinth, deckPlate, platter, label, tonearm);

  attachAssetInteraction(ttGroup, {
    kind: 'toggle',
    id: 'stahl-hifi-turntable',
    label: 'Play Dave Brubeck LP on Hi-Fi Turntable',
    activeLabel: 'Stop Hi-Fi Turntable',
    onStep: (dt, state) => {
      if (state.active) {
        platter.rotation.y += dt * 3.49; // 33 1/3 RPM!
        label.rotation.y = platter.rotation.y;
        return true;
      }
      return false;
    },
    audio: {
      openPreset: 'switchClick',
      activeLoopPreset: 'mediaPlayback',
      volume: 0.42,
    },
  });
  g.add(ttGroup);

  // Stack of mid-century jazz vinyl LP sleeves + brass sculptural object on right end
  const lpSleeve = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.315, 0.018, 0.315)), mcm.aaCoverMat);
  lpSleeve.position.set(0.32, surfY + 0.009, 0.02);
  lpSleeve.rotation.y = 0.11;
  g.add(lpSleeve);

  attachAssetMetadata(g, {
    name: 'Florence Knoll Model 121 Walnut & Travertine Credenza',
    brand: 'Knoll Associates',
    collection: 'Florence Knoll Executive & Residential Casegoods',
    sku: 'KN-121-WAL-TRV',
    finish: 'Book-Matched American Walnut, Honed Roman Travertine & Polished Chrome',
    category: 'furniture',
    dimensionsMm: [1680, 460, 690],
  });

  parent.add(g);
  return g;
}

