import * as THREE from 'three';
import type { CutawayWallDescriptor } from 'husjs';
import { applyMetricBoxUVs } from 'husjs/materials';
import { attachAssetInteraction, attachAssetMetadata, prepGeo, tagCollisionRole, tagCutaway } from 'husjs/objects';
import type { LightCircuitGroup, SceneBuilderContext } from 'husjs/viewer';
import { addEamesDowelEiffelBase, addMesh, buildPlanarArtworkSlabGeo, makeLatheGeo, registerSeat } from './mcm-furniture.ts';
import type { McmMaterials } from './mcm-materials.ts';
import {
  bevelledBox,
  buildArchitecturalPotteryPlanterGeo,
  buildCushionWeltLoopGeo,
  buildEamesFiberglassBucketGeo,
  buildMoldedPlywoodShellGeo,
  buildTuftedCushionGeo,
} from './sculpted-geometry.ts';

/** Sweeps a bent 5-ply laminated wood ribbon (`plane`: 'xy' leg arch or 'zy' spine) with bevelled edges. */
function buildBentPlywoodRibbonGeo(
  pts2D: readonly [number, number][],
  width: number,
  thickness: number,
  plane: 'xy' | 'zy',
  curveSegs = 28
): THREE.BufferGeometry {
  const curve = new THREE.SplineCurve(pts2D.map(([x, y]) => new THREE.Vector2(x, y)));
  const pts = curve.getSpacedPoints(curveSegs);
  const halfT = thickness * 0.5;
  const topPts: THREE.Vector2[] = [];
  const botPts: THREE.Vector2[] = [];
  for (let i = 0; i <= curveSegs; i++) {
    const p0 = pts[Math.max(0, i - 1)]!;
    const p1 = pts[Math.min(curveSegs, i + 1)]!;
    const len = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
    const nx = -(p1.y - p0.y) / len;
    const ny = (p1.x - p0.x) / len;
    topPts.push(new THREE.Vector2(pts[i]!.x + nx * halfT, pts[i]!.y + ny * halfT));
    botPts.push(new THREE.Vector2(pts[i]!.x - nx * halfT, pts[i]!.y - ny * halfT));
  }
  const shape = new THREE.Shape(topPts);
  for (let i = botPts.length - 1; i >= 0; i--) shape.lineTo(botPts[i]!.x, botPts[i]!.y);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    steps: 2,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: 0.0022,
    bevelThickness: 0.0022,
  });
  geo.translate(0, 0, -width * 0.5);
  if (plane === 'zy') geo.rotateY(-Math.PI * 0.5);
  geo.computeVertexNormals();
  return prepGeo(applyMetricBoxUVs(geo, { tileW: 0.55, tileH: 0.55 }));
}

/** 24-segment turned George Nelson Thin-Edge conical satin-brass knob (`+Z` forward). */
function buildTurnedBrassKnobGeo(s = 1): THREE.BufferGeometry {
  const pts: readonly [number, number][] = [
    [0, 0], [0.0055 * s, 0], [0.005 * s, 0.008 * s], [0.0135 * s, 0.015 * s], [0.0145 * s, 0.0185 * s], [0.012 * s, 0.0205 * s], [0, 0.021 * s],
  ];
  const geo = makeLatheGeo(pts, 24);
  geo.rotateX(Math.PI * 0.5);
  return geo;
}

/** Adds a 24-segment tapered walnut leg with a turned satin-brass ferrule foot. */
function addTaperedWalnutLeg(
  parent: THREE.Object3D,
  mcm: McmMaterials,
  x: number,
  z: number,
  totalH: number,
  rTop = 0.017,
  rBot = 0.0105
): void {
  const ferruleH = Math.min(0.028, totalH * 0.16);
  const woodH = totalH - ferruleH - 0.001;
  const rMid = rBot + (rTop - rBot) * (ferruleH / totalH);
  addMesh(parent, prepGeo(new THREE.CylinderGeometry(rMid, rBot, ferruleH, 24)), mcm.satinBrass, [x, ferruleH * 0.5, z]);
  addMesh(parent, prepGeo(new THREE.CylinderGeometry(rTop, rMid, woodH, 24)), mcm.walnut, [x, ferruleH + 0.001 + woodH * 0.5, z], undefined, 'cast');
}

/**
 * Master Bedroom Suite (`stahlMasterSuite`) + Bedroom 2 (`stahlBedroom2`) Sculpted Mid-Century Furnishings:
 *  - Master cantilevered American walnut platform bed w/ floating nightstands, 40-seg cone lamps & crowned tufted bedding
 *  - Master floor-to-ceiling sliding walnut/Formica wardrobe, Thin-Edge 6-drawer lowboy dresser, shadow-box serigraph & Eames LCW
 *  - Bedroom 2 twin walnut platform beds w/ bevelled striped throws, George Nelson cantilevered desk + Eames DAW,
 *    floor-to-ceiling sliding wardrobe, and floating walnut wall shelves w/ books, Braun SK-2 radio & Nelson clock.
 */
export function buildMasterAndBedroom2Furnishings(
  ctx: SceneBuilderContext,
  parent: THREE.Object3D,
  mcm: McmMaterials,
  cuts: { readonly northWoodsCut: CutawayWallDescriptor; readonly westCarportCut: CutawayWallDescriptor },
  ceilingTopY: number
): void {
  const knobGeo = buildTurnedBrassKnobGeo(1);

  // =========================================================================
  // 1. MASTER SUITE (`X in [-4.636, -0.06], Z in [-5.934, 0.000]`)
  // =========================================================================
  const masterHeaderWall = new THREE.Group();
  masterHeaderWall.name = 'stahl.master.slatMirrorWall';
  addMesh(masterHeaderWall, bevelledBox(4.52, 0.36, 0.34, 0.006, 4, 0.9, 0.9), mcm.walnut, [-2.35, ceilingTopY - 0.182, -5.76]);

  const slatH = ceilingTopY - 0.37 - 0.74;
  const slatMidY = 0.74 + slatH * 0.5;
  const slatGeo = bevelledBox(0.085, slatH, 0.022, 0.0035, 3, 0.6, 0.9);
  const mirrorStripGeo = bevelledBox(0.056, slatH, 0.01, 0.0015, 2, 0.6, 0.9);
  for (let i = -5; i <= 5; i++) {
    const sx = -2.35 + i * 0.145;
    addMesh(masterHeaderWall, slatGeo, mcm.walnut, [sx, slatMidY, -5.914]);
    if (i < 5) {
      addMesh(masterHeaderWall, mirrorStripGeo, mcm.plateMirror, [sx + 0.0725, slatMidY, -5.922]);
    }
  }
  tagCutaway(masterHeaderWall, cuts.northWoodsCut);
  parent.add(masterHeaderWall);

  const masterRug = addMesh(parent, bevelledBox(2.85, 0.0032, 2.65, 0.0014, 2, 0.75, 0.75), mcm.berberOat, [-2.35, 0.002, -4.35]);
  masterRug.name = 'stahl.master.berberRug';
  masterRug.receiveShadow = true;
  tagCollisionRole(masterRug, 'ignore');

  const bedY = 0.0046;
  const masterBed = new THREE.Group();
  masterBed.name = 'stahl.master.platformBed';
  masterBed.position.set(-2.35, bedY, -5.88); // Faces +Z (South toward Pool & LA Skyline)

  // Wide cantilevered walnut headboard (`2.76 m` wide, topping at `Y = 0.725 m` below `Y = 0.78` bedside switches)
  addMesh(masterBed, bevelledBox(2.76, 0.56, 0.044, 0.007, 4, 0.9, 0.9), mcm.walnut, [0, 0.44, 0.022], undefined, 'cast');
  addMesh(masterBed, bevelledBox(2.78, 0.022, 0.052, 0.004, 3, 0.9, 0.9), mcm.walnut, [0, 0.732, 0.025], undefined, 'cast');

  // Floating walnut nightstands (`>= 1.5 mm` drawer/top clearances) + 40-seg brass/opal cone reading lamps
  const masterLightGrp = (ctx.lightGroups as Record<string, LightCircuitGroup>).stahlMasterCones;
  const nsCaseGeo = bevelledBox(0.52, 0.14, 0.40, 0.006, 4, 0.7, 0.7);
  const nsTopGeo = bevelledBox(0.524, 0.012, 0.404, 0.003, 3, 0.8, 0.8);
  const nsFrontGeo = bevelledBox(0.484, 0.104, 0.014, 0.003, 3, 0.6, 0.6);
  const lampBaseGeo = makeLatheGeo([[0, 0], [0.072, 0], [0.068, 0.012], [0.024, 0.022], [0.012, 0.028], [0, 0.028]], 40);
  const coneGeo = makeLatheGeo([[0.018, 0.165], [0.032, 0.14], [0.064, 0.07], [0.09, 0]], 40);

  for (const sx of [-1, 1]) {
    const nx = sx * 1.08;
    addMesh(masterBed, nsCaseGeo, mcm.walnut, [nx, 0.404, 0.246], undefined, 'cast');
    addMesh(masterBed, nsTopGeo, mcm.travertine, [nx, 0.4815, 0.246], undefined, true);
    addMesh(masterBed, nsFrontGeo, mcm.formicaWhite, [nx, 0.404, 0.4545]);
    addMesh(masterBed, knobGeo, mcm.satinBrass, [nx, 0.404, 0.463]);

    const lampX = sx * 1.19;
    const lampZ = 0.26;
    const lampSurfY = 0.489;
    addMesh(masterBed, lampBaseGeo, mcm.satinBrass, [lampX, lampSurfY, lampZ]);
    addMesh(masterBed, prepGeo(new THREE.CylinderGeometry(0.0075, 0.0085, 0.20, 24)), mcm.satinBrass, [lampX, lampSurfY + 0.12, lampZ]);
    const coneShadeMat = new THREE.MeshStandardMaterial({
      color: 0xfff8ea,
      normalMap: mcm.opalGlass.normalMap,
      normalScale: new THREE.Vector2(0.2, 0.2),
      emissive: new THREE.Color(0xffd496),
      emissiveIntensity: 1.25,
      roughness: 0.35,
      side: THREE.DoubleSide,
    });
    addMesh(masterBed, coneGeo, coneShadeMat, [lampX - sx * 0.024, lampSurfY + 0.095, lampZ + 0.02], [0.1, 0, sx * 0.22]);
    if (masterLightGrp) masterLightGrp.emissives.push(coneShadeMat);
  }

  // Recessed steel plinth + cantilevered walnut bed platform (`1.74 x 2.10 m`)
  addMesh(masterBed, bevelledBox(1.36, 0.164, 1.76, 0.005, 3, 0.7, 0.7), mcm.blackenedSteel, [0, 0.083, 1.08]);
  addMesh(masterBed, bevelledBox(1.74, 0.086, 2.10, 0.008, 4, 0.9, 0.9), mcm.walnut, [0, 0.21, 1.097], undefined, true);

  // Plump crowned oat-bouclé mattress (`y` peak `0.503`) + folded throws offset `>= 2.5 mm` clear (zero z-fighting)
  const kingMattGeo = buildTuftedCushionGeo({
    width: 1.64, height: 0.20, depth: 2.00, crown: 0.024, cornerPower: 0.22, segX: 36, segY: 12, segZ: 36, tileM: 0.55,
  });
  addMesh(masterBed, kingMattGeo, mcm.bedspreadOat, [0, 0.379, 1.08], undefined, true);

  // Tailored waterfall ochre throw (`bottom = 0.5055 >= 0.503 + 2.5 mm`; side drops `>= 3.2 mm` outside mattress cheeks)
  addMesh(masterBed, bevelledBox(1.68, 0.028, 0.58, 0.011, 5, 0.55, 0.55), mcm.throwOchre, [0, 0.5195, 1.68], undefined, true);
  const kingDropGeo = bevelledBox(0.026, 0.165, 0.58, 0.01, 4, 0.55, 0.55);
  for (const sx of [-1, 1]) {
    addMesh(masterBed, kingDropGeo, mcm.throwOchre, [sx * 0.846, 0.436, 1.68], undefined, 'cast');
  }
  addMesh(masterBed, bevelledBox(1.56, 0.024, 0.24, 0.009, 5, 0.55, 0.55), mcm.throwOlive, [0, 0.5475, 1.80], undefined, 'cast');

  // Plump sculpted sleeping & lumbar pillows with continuous equator welt piping
  const kingPillowGeo = buildTuftedCushionGeo({
    width: 0.66, height: 0.125, depth: 0.36, crown: 0.024, cornerPower: 0.34, segX: 28, segY: 10, segZ: 22, tileM: 0.5,
  });
  const kingPillowWelt = buildCushionWeltLoopGeo(0.66 * 1.016, 0.36 * 1.016, 0.046, 0.004, 52);
  const lumbarGeo = buildTuftedCushionGeo({
    width: 0.54, height: 0.11, depth: 0.31, crown: 0.022, cornerPower: 0.34, segX: 26, segY: 10, segZ: 20, tileM: 0.48,
  });
  const lumbarWelt = buildCushionWeltLoopGeo(0.54 * 1.016, 0.31 * 1.016, 0.042, 0.0038, 48);

  for (const px of [-0.41, 0.41]) {
    const pBack = new THREE.Group();
    pBack.position.set(px, 0.576, 0.27);
    pBack.rotation.x = 0.26;
    addMesh(pBack, kingPillowGeo, mcm.pillowLinen, undefined, undefined, 'cast');
    addMesh(pBack, kingPillowWelt, mcm.pillowLinen);

    const pFront = new THREE.Group();
    pFront.position.set(px, 0.562, 0.58);
    pFront.rotation.x = 0.16;
    addMesh(pFront, lumbarGeo, mcm.throwOlive, undefined, undefined, 'cast');
    addMesh(pFront, lumbarWelt, mcm.throwOlive);
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
    finish: 'Book-Matched American Black Walnut, Honed Travertine, Satin Brass & Oat/Ochre Bouclé',
    category: 'furniture',
    dimensionsMm: [2760, 2165, 730],
  });
  parent.add(masterBed);

  // Master Floor-to-Ceiling Interactive Sliding Wardrobe (`West wall`)
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

  // Master George Nelson Thin-Edge 6-Drawer American Walnut Lowboy Dresser (`East wall`, `X = -0.30, Z = -4.40`)
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
      addTaperedWalnutLeg(dresser, mcm, sx * (drW * 0.5 - 0.055), sz * (drD * 0.5 - 0.055), drLegH - 0.001, 0.017, 0.0105);
    }
  }
  // Thin-edge walnut carcass + radiused front stiles + honed travertine inlay top
  addMesh(dresser, bevelledBox(drW, drBodyH, drD - 0.022, 0.005, 4, 0.85, 0.85), mcm.walnut, [0, drLegH + drBodyH * 0.5, -0.011], undefined, 'cast');
  addMesh(dresser, bevelledBox(drW + 0.004, 0.016, drD + 0.004, 0.004, 4, 0.95, 0.95), mcm.travertine, [0, drLegH + drBodyH + 0.009, 0], undefined, true);
  const stileHGeo = bevelledBox(drW, 0.013, 0.02, 0.003, 3, 0.85, 0.85);
  addMesh(dresser, stileHGeo, mcm.walnut, [0, drLegH + 0.0065, drD * 0.5 - 0.01]);
  addMesh(dresser, stileHGeo, mcm.walnut, [0, drLegH + drBodyH - 0.0065, drD * 0.5 - 0.01]);
  const stileVGeo = bevelledBox(0.013, drBodyH - 0.028, 0.02, 0.003, 3, 0.85, 0.85);
  for (const sx of [-1, 1]) {
    addMesh(dresser, stileVGeo, mcm.walnut, [sx * (drW * 0.5 - 0.0065), drLegH + drBodyH * 0.5, drD * 0.5 - 0.01]);
  }

  const dwW = (drW - 0.028 - 0.009) * 0.5;
  const dwH = (drBodyH - 0.028 - 0.012) / 3;
  const dwFrontGeo = bevelledBox(dwW, dwH, 0.018, 0.0035, 3, 0.75, 0.75);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 2; col++) {
      const dx = (col === 0 ? -1 : 1) * (dwW * 0.5 + 0.0022);
      const dy = drLegH + 0.016 + dwH * (row + 0.5) + row * 0.0035;
      const dGrp = new THREE.Group();
      dGrp.name = `stahl.master.lowboy.drawer_${row}_${col}`;
      dGrp.position.set(dx, dy, drD * 0.5 - 0.009);
      addMesh(dGrp, dwFrontGeo, mcm.walnut, undefined, undefined, 'cast');
      addMesh(dGrp, knobGeo, mcm.satinBrass, [-dwW * 0.26, 0, 0.0102]);
      addMesh(dGrp, knobGeo, mcm.satinBrass, [dwW * 0.26, 0, 0.0102]);
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

  // 48-seg ceramic bottle vase + 44-seg stoneware catchall bowl (`>= 1.4 mm` clear of top)
  const drSurfY = drLegH + drBodyH + 0.0184;
  const drVaseGeo = makeLatheGeo(
    [[0, 0], [0.044, 0], [0.072, 0.068], [0.064, 0.158], [0.026, 0.205], [0.032, 0.242], [0.025, 0.242], [0.02, 0.20], [0, 0.20]],
    48
  );
  const drDishGeo = makeLatheGeo([[0, 0], [0.048, 0], [0.105, 0.026], [0.114, 0.044], [0.105, 0.044], [0.088, 0.024], [0, 0.01]], 44);
  addMesh(dresser, drVaseGeo, mcm.ceramicTeal, [0.46, drSurfY, -0.02], undefined, 'cast');
  addMesh(dresser, drDishGeo, mcm.stonewareWhite, [-0.42, drSurfY, 0.01], undefined, 'cast');

  attachAssetMetadata(dresser, {
    name: 'George Nelson Thin-Edge 6-Drawer American Walnut Lowboy Dresser',
    brand: 'Herman Miller',
    collection: 'Thin Edge Casegoods (1954)',
    sku: 'HM-5206-WAL',
    finish: 'Book-Matched American Walnut, Honed Travertine Top & Turned Satin Brass Knobs',
    category: 'furniture',
    dimensionsMm: [1560, 450, 778],
  });
  parent.add(dresser);

  // Framed Hard-Edge California Geometric Serigraph in Bevelled Walnut Shadow-Box Frame (`X = -0.072`)
  const artGroup = new THREE.Group();
  artGroup.name = 'stahl.master.serigraphArt';
  artGroup.position.set(-0.072, 1.56, -4.40);
  artGroup.rotation.y = -Math.PI * 0.5;
  const fw = 0.96;
  const fh = 0.74;
  const ft = 0.018;
  addMesh(artGroup, bevelledBox(fw - ft * 2, fh - ft * 2, 0.01, 0.002, 2, 0.6, 0.6), mcm.formicaWhite, [0, 0, -0.006]);
  const railHGeo = bevelledBox(fw, ft, 0.03, 0.003, 3, 0.6, 0.6);
  const railVGeo = bevelledBox(ft, fh - ft * 2 - 0.002, 0.03, 0.003, 3, 0.6, 0.6);
  addMesh(artGroup, railHGeo, mcm.walnut, [0, fh * 0.5 - ft * 0.5, 0], undefined, 'cast');
  addMesh(artGroup, railHGeo, mcm.walnut, [0, -fh * 0.5 + ft * 0.5, 0], undefined, 'cast');
  addMesh(artGroup, railVGeo, mcm.walnut, [-fw * 0.5 + ft * 0.5, 0, 0], undefined, 'cast');
  addMesh(artGroup, railVGeo, mcm.walnut, [fw * 0.5 - ft * 0.5, 0, 0], undefined, 'cast');
  addMesh(artGroup, buildPlanarArtworkSlabGeo(0.84, 0.62, 0.005, 0.0015, 'z'), mcm.serigraphMat, [0, 0, 0.003]);
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
  const bed2Rug = addMesh(parent, bevelledBox(3.45, 0.0032, 2.75, 0.0014, 2, 0.75, 0.75), mcm.berberOat, [-10.12, 0.002, -4.25]);
  bed2Rug.name = 'stahl.bed2.berberRug';
  bed2Rug.receiveShadow = true;
  tagCollisionRole(bed2Rug, 'ignore');

  // Twin American Walnut Platform Beds with Bevelled Striped Geometric Throws (`X = -11.16` & `X = -9.08`)
  const twinHbGeo = bevelledBox(1.06, 0.58, 0.038, 0.006, 4, 0.8, 0.8);
  const twinFrameGeo = bevelledBox(1.06, 0.08, 2.00, 0.007, 4, 0.8, 0.8);
  const twinMattGeo = buildTuftedCushionGeo({
    width: 0.98, height: 0.18, depth: 1.92, crown: 0.022, cornerPower: 0.22, segX: 30, segY: 10, segZ: 32, tileM: 0.55,
  });
  const twinThrowTopGeo = bevelledBox(1.01, 0.028, 0.68, 0.011, 5, 0.55, 0.55);
  const twinThrowDropGeo = bevelledBox(0.024, 0.14, 0.68, 0.009, 4, 0.55, 0.55);
  const twinPillowGeo = buildTuftedCushionGeo({
    width: 0.64, height: 0.12, depth: 0.35, crown: 0.022, cornerPower: 0.34, segX: 26, segY: 10, segZ: 20, tileM: 0.5,
  });
  const twinPillowWelt = buildCushionWeltLoopGeo(0.64 * 1.016, 0.35 * 1.016, 0.044, 0.0038, 48);

  for (const [bIdx, bx] of [[1, -11.16], [2, -9.08]] as const) {
    const tBed = new THREE.Group();
    const tbName = `stahl.bed2.twinBed_${bIdx}`;
    tBed.name = tbName;
    tBed.position.set(bx, 0.0046, -5.88);

    addMesh(tBed, twinHbGeo, mcm.walnut, [0, 0.45, 0.019], undefined, 'cast');
    addMesh(tBed, twinFrameGeo, mcm.walnut, [0, 0.22, 1.041], undefined, true);
    for (const lx of [-0.46, 0.46]) {
      for (const lz of [0.16, 1.94]) {
        addTaperedWalnutLeg(tBed, mcm, lx, lz, 0.1785, 0.0165, 0.0105);
      }
    }
    // Mattress peak `y = 0.374 + 0.112 = 0.486`; throw bottom `0.4885` (`2.5 mm` clear -> zero z-fighting!)
    addMesh(tBed, twinMattGeo, mcm.bedspreadOat, [0, 0.374, 1.04], undefined, true);
    addMesh(tBed, twinThrowTopGeo, mcm.throwStriped, [0, 0.5025, 1.54], undefined, true);
    for (const sx of [-1, 1]) {
      addMesh(tBed, twinThrowDropGeo, mcm.throwStriped, [sx * 0.511, 0.432, 1.54], undefined, 'cast');
    }

    const pGrp = new THREE.Group();
    pGrp.position.set(0, 0.552, 0.28);
    pGrp.rotation.x = 0.22;
    addMesh(pGrp, twinPillowGeo, mcm.pillowLinen, undefined, undefined, 'cast');
    addMesh(pGrp, twinPillowWelt, mcm.pillowLinen);
    tBed.add(pGrp);

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
      finish: 'American Black Walnut, Satin Brass Ferrules & Woven Multi-Stripe Geometric Wool Throw',
      category: 'furniture',
      dimensionsMm: [1060, 2040, 740],
    });
    parent.add(tBed);
  }

  // Shared Walnut Nightstand + Sculpted Ceramic/Opal Globe Lamp (`X = -10.12, Z = -5.64`)
  const denGrp = (ctx.lightGroups as Record<string, LightCircuitGroup>).stahlDenCones;
  const sharedNs = new THREE.Group();
  sharedNs.name = 'stahl.bed2.sharedNightstand';
  sharedNs.position.set(-10.12, 0.0046, -5.64);
  for (const lx of [-0.21, 0.21]) {
    for (const lz of [-0.16, 0.16]) {
      addTaperedWalnutLeg(sharedNs, mcm, lx, lz, 0.2685, 0.014, 0.0095);
    }
  }
  addMesh(sharedNs, bevelledBox(0.50, 0.22, 0.40, 0.006, 4, 0.65, 0.65), mcm.walnut, [0, 0.38, 0], undefined, 'cast');
  addMesh(sharedNs, bevelledBox(0.504, 0.012, 0.404, 0.003, 3, 0.75, 0.75), mcm.formicaWhite, [0, 0.4975, 0], undefined, true);
  addMesh(sharedNs, bevelledBox(0.462, 0.176, 0.014, 0.0035, 3, 0.6, 0.6), mcm.formicaAqua, [0, 0.38, 0.2085]);
  addMesh(sharedNs, knobGeo, mcm.satinBrass, [0, 0.38, 0.217]);

  const sLampMat = new THREE.MeshStandardMaterial({
    color: 0xfff8eb,
    normalMap: mcm.opalGlass.normalMap,
    normalScale: new THREE.Vector2(0.18, 0.18),
    emissive: new THREE.Color(0xffd59c),
    emissiveIntensity: 1.25,
    roughness: 0.35,
  });
  const nsLampBaseGeo = makeLatheGeo(
    [[0, 0], [0.056, 0], [0.072, 0.048], [0.062, 0.115], [0.024, 0.145], [0.018, 0.16], [0, 0.16]],
    44
  );
  addMesh(sharedNs, nsLampBaseGeo, mcm.ceramicTerracotta, [0, 0.505, 0], undefined, 'cast');
  addMesh(sharedNs, prepGeo(new THREE.CylinderGeometry(0.018, 0.022, 0.022, 28)), mcm.satinBrass, [0, 0.674, 0]);
  addMesh(sharedNs, prepGeo(new THREE.SphereGeometry(0.082, 36, 24)), sLampMat, [0, 0.756, 0]);
  if (denGrp) denGrp.emissives.push(sLampMat);
  parent.add(sharedNs);

  // Bedroom 2 Floor-to-Ceiling Sliding Wardrobe (`East wall`)
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

  // George Nelson Cantilevered Walnut & Chrome Desk (`West wall`, `X = -11.62, Z = -2.05`)
  const desk = new THREE.Group();
  desk.name = 'stahl.bed2.nelsonDeskCabinet';
  desk.position.set(-11.62, 0.0006, -2.05);
  desk.rotation.y = Math.PI * 0.5; // Local +Z faces East into room

  const dkW = 1.32;
  const dkD = 0.66;
  const dkH = 0.74;
  const dkLegH = dkH - 0.036;
  const dkLegGeo = bevelledBox(0.022, dkLegH, 0.022, 0.003, 3, 0.5, 0.5);
  const dkStretchGeo = bevelledBox(0.02, 0.02, dkD - 0.124, 0.0028, 3, 0.5, 0.5);
  const dkGlideGeo = prepGeo(new THREE.CylinderGeometry(0.011, 0.013, 0.006, 20));
  for (const sx of [-1, 1]) {
    const lx = sx * (dkW * 0.5 - 0.042);
    for (const sz of [-1, 1]) {
      const lz = sz * (dkD * 0.5 - 0.052);
      addMesh(desk, dkLegGeo, mcm.polishedChrome, [lx, 0.006 + dkLegH * 0.5, lz], undefined, 'cast');
      addMesh(desk, dkGlideGeo, mcm.blackenedSteel, [lx, 0.003, lz]);
    }
    addMesh(desk, dkStretchGeo, mcm.polishedChrome, [lx, 0.18, 0]);
  }
  addMesh(desk, bevelledBox(dkW - 0.11, 0.02, 0.02, 0.0028, 3, 0.5, 0.5), mcm.polishedChrome, [0, dkH - 0.042, -dkD * 0.5 + 0.052]);
  addMesh(desk, bevelledBox(dkW, 0.028, dkD, 0.005, 4, 0.85, 0.85), mcm.walnut, [0, dkH - 0.014, 0], undefined, true);

  // Suspended right-hand walnut pedestal drawer case (`>= 1.5 mm` drawer clearance)
  addMesh(desk, bevelledBox(0.42, 0.24, dkD - 0.09, 0.005, 4, 0.65, 0.65), mcm.walnut, [0.39, dkH - 0.156, -0.015], undefined, 'cast');
  const dkDrawer = new THREE.Group();
  dkDrawer.name = 'stahl.bed2.nelsonDesk.drawer';
  dkDrawer.position.set(0.39, dkH - 0.156, (dkD - 0.09) * 0.5 - 0.015 + 0.0095);
  addMesh(dkDrawer, bevelledBox(0.392, 0.206, 0.015, 0.0035, 3, 0.6, 0.6), mcm.formicaWhite);
  addMesh(dkDrawer, bevelledBox(0.096, 0.012, 0.016, 0.0025, 3, 0.4, 0.4), mcm.polishedChrome, [0, 0.04, 0.016]);
  attachAssetInteraction(dkDrawer, {
    kind: 'slide',
    id: 'stahl-nelson-desk-drawer',
    label: 'Open George Nelson Desk Drawer',
    slideDelta: [0, 0, 0.32],
    audio: { openPreset: 'drawerSlide', volume: 0.45 },
  });
  desk.add(dkDrawer);

  // Articulated Architect's Task Lamp (`40`-seg lathe base & spun cone) + bevelled notebook (`>= 1.5 mm` clear)
  const dkSurfY = dkH + 0.0016;
  const taskBaseGeo = makeLatheGeo([[0, 0], [0.082, 0], [0.076, 0.015], [0.022, 0.024], [0, 0.024]], 40);
  const taskConeGeo = makeLatheGeo([[0.018, 0.145], [0.028, 0.12], [0.056, 0.06], [0.08, 0]], 40);
  addMesh(desk, taskBaseGeo, mcm.blackenedSteel, [-0.44, dkSurfY, -0.18]);
  addMesh(desk, prepGeo(new THREE.CylinderGeometry(0.0065, 0.0075, 0.36, 24)), mcm.satinBrass, [-0.40, dkSurfY + 0.185, -0.14], [0, 0, -0.22]);
  addMesh(desk, taskConeGeo, mcm.formicaPersimmon, [-0.30, dkSurfY + 0.27, -0.10], [0.12, 0, -0.62]);
  addMesh(desk, bevelledBox(0.28, 0.014, 0.21, 0.0025, 3, 0.5, 0.5), mcm.formicaWhite, [-0.08, dkSurfY + 0.007, 0.08], [0, 0.05, 0]);
  const dkPotGeo = buildArchitecturalPotteryPlanterGeo(0.068, 0.052, 0.12, 0.008, 44);
  addMesh(desk, dkPotGeo, mcm.stonewareWhite, [0.44, dkSurfY, -0.17], undefined, 'cast');
  addMesh(desk, prepGeo(new THREE.SphereGeometry(0.046, 28, 18)), mcm.throwOlive, [0.44, dkSurfY + 0.105, -0.17]);

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

  // Eames Molded Fiberglass `DAW` Armchair (`40 x 30` organic bucket + `24`-seg dowels + Eiffel wire struts)
  const daw = new THREE.Group();
  daw.name = 'stahl.bed2.eamesDawChair';
  daw.position.set(-10.88, 0.0006, -2.05);
  daw.rotation.y = -Math.PI * 0.5;
  addMesh(daw, buildEamesFiberglassBucketGeo('DAW', 40, 30), mcm.fiberglassSeafoam, [0, 0.445, 0.01], undefined, true);
  addEamesDowelEiffelBase(daw, mcm);

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
    finish: 'Seafoam Green Fiberglass Arm Shell, American Walnut Dowels & Black Wire Cross-Struts',
    category: 'furniture',
    dimensionsMm: [625, 600, 805],
  });
  parent.add(daw);

  // Floating Walnut Wall Shelves on West `carportWall` (`X = -12.11`, tagged with `cuts.westCarportCut`)
  const shelves = new THREE.Group();
  shelves.name = 'stahl.bed2.floatingShelves';
  shelves.position.set(-11.98, 0, -2.05);

  const plankGeo = bevelledBox(0.24, 0.026, 1.24, 0.004, 4, 0.75, 0.75);
  const bracketGeo = bevelledBox(0.18, 0.014, 0.016, 0.002, 2, 0.4, 0.4);
  for (const sy of [1.38, 1.76]) {
    addMesh(shelves, plankGeo, mcm.walnut, [0, sy, 0], undefined, 'cast');
    for (const bz of [-0.42, 0.42]) {
      addMesh(shelves, bracketGeo, mcm.satinBrass, [-0.02, sy - 0.021, bz]);
    }
  }

  // Bevelled hardcover design books (`>= 1.5 mm` clear above shelf `y = 1.393`)
  const bookMats = [mcm.formicaAqua, mcm.formicaMustard, mcm.formicaPersimmon, mcm.formicaWhite, mcm.ceramicTeal];
  for (let i = 0; i < 7; i++) {
    const bh = 0.19 + (i % 3) * 0.024;
    const bGeo = bevelledBox(0.17, bh, 0.026, 0.0028, 3, 0.45, 0.45);
    addMesh(shelves, bGeo, bookMats[i % bookMats.length]!, [-0.01, 1.3946 + bh * 0.5, -0.44 + i * 0.032], undefined, 'cast');
  }

  // Dieter Rams / Braun SK-2 Table Radio + George Nelson Desk Clock + 44-seg Terracotta Vessel
  addMesh(shelves, bevelledBox(0.11, 0.145, 0.23, 0.006, 4, 0.4, 0.4), mcm.formicaWhite, [0.01, 1.3946 + 0.0725, 0.28], undefined, 'cast');
  addMesh(shelves, prepGeo(new THREE.CylinderGeometry(0.024, 0.024, 0.01, 24)), mcm.formicaCharcoal, [0.07, 1.485, 0.335], [0, 0, Math.PI * 0.5]);
  addMesh(shelves, prepGeo(new THREE.CylinderGeometry(0.015, 0.015, 0.01, 24)), mcm.formicaCharcoal, [0.07, 1.442, 0.335], [0, 0, Math.PI * 0.5]);

  addMesh(shelves, bevelledBox(0.072, 0.132, 0.132, 0.006, 4, 0.45, 0.45), mcm.walnut, [0.01, 1.7746 + 0.066, -0.18], undefined, 'cast');
  addMesh(shelves, prepGeo(new THREE.CylinderGeometry(0.048, 0.048, 0.008, 32)), mcm.satinBrass, [0.051, 1.8406, -0.18], [0, 0, Math.PI * 0.5]);
  const shelfPotGeo = makeLatheGeo(
    [[0, 0], [0.042, 0], [0.068, 0.055], [0.056, 0.125], [0.034, 0.155], [0.028, 0.155], [0.024, 0.12], [0, 0.12]],
    44
  );
  addMesh(shelves, shelfPotGeo, mcm.ceramicTerracotta, [0.01, 1.7746, 0.24], undefined, 'cast');

  tagCutaway(shelves, cuts.westCarportCut);
  parent.add(shelves);
}

/**
 * Eames Molded Plywood Lounge Chair (`LCW`, 1946):
 * Compound-curved `buildMoldedPlywoodShellGeo` (`32 x 22`) walnut seat & back shells
 * on curved 5-ply laminated walnut leg arches & spine + rubber shock mounts.
 */
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

  // Continuous J-curved 5-ply laminated walnut spine & backrest upright (`zy` plane)
  const spineGeo = buildBentPlywoodRibbonGeo(
    [[0.165, 0.312], [0.02, 0.288], [-0.145, 0.268], [-0.228, 0.325], [-0.248, 0.445], [-0.268, 0.595]],
    0.076, 0.018, 'zy', 30
  );
  addMesh(g, spineGeo, mcm.walnut, undefined, undefined, 'cast');

  // Front & rear inverted-U bent-plywood leg arches (`xy` plane)
  const frontLegGeo = buildBentPlywoodRibbonGeo(
    [[-0.238, 0.004], [-0.224, 0.155], [-0.155, 0.278], [0, 0.304], [0.155, 0.278], [0.224, 0.155], [0.238, 0.004]], 0.052, 0.017, 'xy', 28
  );
  const rearLegGeo = buildBentPlywoodRibbonGeo(
    [[-0.226, 0.004], [-0.208, 0.14], [-0.145, 0.245], [0, 0.264], [0.145, 0.245], [0.208, 0.14], [0.226, 0.004]], 0.052, 0.017, 'xy', 28
  );
  addMesh(g, frontLegGeo, mcm.walnut, [0, 0, 0.135], [-0.08, 0, 0], 'cast');
  addMesh(g, rearLegGeo, mcm.walnut, [0, 0, -0.145], [0.16, 0, 0], 'cast');

  // Rubber shock mounts (`24`-seg neoprene pucks) isolating seat & back shells from laminated spine
  const shockGeo = prepGeo(new THREE.CylinderGeometry(0.024, 0.024, 0.016, 24));
  addMesh(g, shockGeo, mcm.formicaCharcoal, [0, 0.322, 0.12], [-0.14, 0, 0]);
  addMesh(g, shockGeo, mcm.formicaCharcoal, [0, 0.292, -0.10], [-0.14, 0, 0]);
  addMesh(g, shockGeo, mcm.formicaCharcoal, [0, 0.49, -0.242], [Math.PI * 0.5 - 0.18, 0, 0]);
  addMesh(g, shockGeo, mcm.formicaCharcoal, [0, 0.58, -0.258], [Math.PI * 0.5 - 0.18, 0, 0]);

  // Compound-curved `32 x 22` walnut seat & back shells
  const seatPanGeo = buildMoldedPlywoodShellGeo({
    width: 0.55, depth: 0.48, sideCurl: 0.056, foreAftDish: 0.024, frontLipDrop: 0.032, cornerRound: 0.24, thickness: 0.012, segU: 32, segV: 22,
  });
  const backPanGeo = buildMoldedPlywoodShellGeo({
    width: 0.51, depth: 0.31, sideCurl: 0.072, foreAftDish: 0.018, frontLipDrop: 0.008, cornerRound: 0.28, thickness: 0.011, segU: 32, segV: 22,
  });
  addMesh(g, seatPanGeo, mcm.walnut, [0, 0.342, 0.03], [-0.15, 0, 0], true);
  addMesh(g, backPanGeo, mcm.walnut, [0, 0.545, -0.228], [Math.PI * 0.5 - 0.18, 0, 0], true);

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
    finish: '5-Ply Molded American Black Walnut Veneer & Neoprene Rubber Shock Mounts',
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
  g.rotation.y = facing === '+z' ? 0 : facing === '-z' ? Math.PI : facing === '+x' ? Math.PI * 0.5 : -Math.PI * 0.5;

  const t = 0.024;
  const slabGeo = bevelledBox(widthM, t, depthM, 0.004, 3, 0.9, 0.9);
  addMesh(g, slabGeo, mcm.walnut, [0, heightM - t * 0.5, 0]);
  addMesh(g, slabGeo, mcm.walnut, [0, t * 0.5, 0]);
  addMesh(g, bevelledBox(widthM - t * 2 - 0.003, heightM - t * 2 - 0.003, 0.018, 0.003, 2, 0.9, 0.9), mcm.walnut, [0, heightM * 0.5, -depthM * 0.5 + 0.01]);
  addMesh(g, bevelledBox(widthM - t * 2 - 0.004, 0.02, depthM - 0.095, 0.0035, 3, 0.9, 0.9), mcm.walnut, [0, 1.92, -0.028]);
  addMesh(g, prepGeo(new THREE.CylinderGeometry(0.014, 0.014, widthM - t * 2 - 0.01, 24)), mcm.polishedChrome, [0, 1.78, -0.03], [0, 0, Math.PI * 0.5]);

  // Anodized aluminum upper/lower double bypass tracks (`>= 1.5 mm` clear of doors)
  const trackGeo = bevelledBox(widthM - t * 2 - 0.003, 0.008, 0.048, 0.002, 2, 0.5, 0.5);
  addMesh(g, trackGeo, mcm.dieCastAlum, [0, t + 0.0045, depthM * 0.5 - 0.03]);
  addMesh(g, trackGeo, mcm.dieCastAlum, [0, heightM - t - 0.0045, depthM * 0.5 - 0.03]);

  const sideGeo = bevelledBox(t, heightM - t * 2 - 0.003, depthM, 0.004, 3, 0.9, 0.9);
  for (const sx of [-1, 1]) {
    addMesh(g, sideGeo, mcm.walnut, [sx * (widthM * 0.5 - t * 0.5), heightM * 0.5, 0], undefined, 'cast');
  }

  // Two floor-to-ceiling bypass sliding doors (`>= 24 mm` Z plane separation + clear top/bottom track reveals)
  const doorW = (widthM - t * 2) * 0.5 + 0.028;
  const doorH = heightM - t * 2 - 0.022;
  const travel = doorW - 0.10;
  const doorLeafGeo = bevelledBox(doorW, doorH, 0.018, 0.0035, 3, 0.9, 0.9);
  const pullCupGeo = bevelledBox(0.018, 0.155, 0.008, 0.0025, 3, 0.4, 0.4);
  const pullRecessGeo = bevelledBox(0.01, 0.135, 0.004, 0.0015, 2, 0.3, 0.3);

  const doorA = new THREE.Group();
  doorA.name = `${name}.doorLeft`;
  doorA.position.set(-doorW * 0.5 + 0.014, heightM * 0.5, depthM * 0.5 - 0.042);
  addMesh(doorA, doorLeafGeo, doorMatA, undefined, undefined, 'cast');
  addMesh(doorA, pullCupGeo, mcm.dieCastAlum, [-doorW * 0.5 + 0.06, -0.12, 0.0105]);
  addMesh(doorA, pullRecessGeo, mcm.blackenedSteel, [-doorW * 0.5 + 0.06, -0.12, 0.0135]);
  attachAssetInteraction(doorA, {
    kind: 'slide',
    id: `${name}-slide-left`,
    label: `Slide ${brandLabel} Left Panel`,
    slideDelta: [travel, 0, 0],
    audio: { openPreset: 'drawerSlide', volume: 0.5 },
  });

  const doorB = new THREE.Group();
  doorB.name = `${name}.doorRight`;
  doorB.position.set(doorW * 0.5 - 0.014, heightM * 0.5, depthM * 0.5 - 0.016);
  addMesh(doorB, doorLeafGeo, doorMatB, undefined, undefined, 'cast');
  addMesh(doorB, pullCupGeo, mcm.dieCastAlum, [doorW * 0.5 - 0.06, -0.12, 0.0105]);
  addMesh(doorB, pullRecessGeo, mcm.blackenedSteel, [doorW * 0.5 - 0.06, -0.12, 0.0135]);
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
 * Florence Knoll American Walnut, Honed Travertine & Polished-Chrome Credenza (`1680 x 460 x 690 mm`)
 * with bevelled sliding Formica/walnut doors and a vintage Braun Hi-Fi turntable on top.
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

  // Bevelled polished-chrome T-angle base & 4 corner legs + leveling glides
  const glideH = 0.005;
  const legClearH = legH - glideH - 0.001;
  const legGeo = bevelledBox(0.022, legClearH, 0.022, 0.0028, 3, 0.5, 0.5);
  const glideGeo = prepGeo(new THREE.CylinderGeometry(0.011, 0.013, glideH, 20));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const lx = sx * (w * 0.5 - 0.026);
      const lz = sz * (d * 0.5 - 0.026);
      addMesh(g, legGeo, mcm.polishedChrome, [lx, glideH + legClearH * 0.5, lz], undefined, 'cast');
      addMesh(g, glideGeo, mcm.blackenedSteel, [lx, glideH * 0.5, lz]);
    }
  }
  const railXGeo = bevelledBox(w - 0.036, 0.02, 0.02, 0.0028, 3, 0.5, 0.5);
  const railZGeo = bevelledBox(0.02, 0.02, d - 0.076, 0.0028, 3, 0.5, 0.5);
  for (const sz of [-1, 1]) addMesh(g, railXGeo, mcm.polishedChrome, [0, legH + 0.01, sz * (d * 0.5 - 0.026)]);
  for (const sx of [-1, 1]) addMesh(g, railZGeo, mcm.polishedChrome, [sx * (w * 0.5 - 0.026), legH + 0.01, 0]);

  // Hollow book-matched American walnut carcass + bevelled honed Roman travertine top slab
  const baseY = legH + 0.0215;
  addMesh(g, bevelledBox(w, t, d, 0.004, 4, 0.85, 0.85), mcm.walnut, [0, baseY + t * 0.5, 0]);
  addMesh(g, bevelledBox(w + 0.004, 0.024, d + 0.004, 0.005, 4, 0.95, 0.95), mcm.travertine, [0, baseY + bodyH - 0.011, 0], undefined, true);
  addMesh(g, bevelledBox(w - t * 2 - 0.003, bodyH - t * 2 - 0.005, 0.016, 0.003, 3, 0.85, 0.85), mcm.walnut, [0, baseY + bodyH * 0.5, -d * 0.5 + 0.012]);
  addMesh(g, bevelledBox(w - t * 2 - 0.004, 0.016, d - 0.085, 0.003, 3, 0.85, 0.85), mcm.walnut, [0, baseY + bodyH * 0.5, -0.022]);

  const sideGeo = bevelledBox(t, bodyH - t * 2 - 0.004, d, 0.004, 4, 0.85, 0.85);
  for (const sx of [-1, 1]) {
    addMesh(g, sideGeo, mcm.walnut, [sx * (w * 0.5 - t * 0.5), baseY + bodyH * 0.5, 0], undefined, 'cast');
  }

  // Two interactive bypass sliding doors (`>= 22 mm` Z separation & `>= 2 mm` vertical track clearances)
  const doorW = (w - t * 2) * 0.5 + 0.02;
  const doorH = bodyH - t * 2 - 0.01;
  const doorY = baseY + bodyH * 0.5 - 0.001;
  const doorLeafGeo = bevelledBox(doorW, doorH, 0.016, 0.0035, 3, 0.8, 0.8);
  const pullGeo = bevelledBox(0.015, 0.095, 0.009, 0.0025, 3, 0.4, 0.4);

  const doorL = new THREE.Group();
  doorL.name = 'stahl.dining.credenza.doorLeft';
  doorL.position.set(-doorW * 0.5 + 0.01, doorY, d * 0.5 - 0.038);
  addMesh(doorL, doorLeafGeo, mcm.formicaWhite, undefined, undefined, 'cast');
  addMesh(doorL, pullGeo, mcm.polishedChrome, [-doorW * 0.5 + 0.048, 0, 0.01]);
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
  addMesh(doorR, doorLeafGeo, mcm.walnut, undefined, undefined, 'cast');
  addMesh(doorR, pullGeo, mcm.polishedChrome, [doorW * 0.5 - 0.048, 0, 0.01]);
  attachAssetInteraction(doorR, {
    kind: 'slide',
    id: 'stahl-credenza-door-right',
    label: 'Slide Florence Knoll Credenza Right Door',
    slideDelta: [-(doorW - 0.08), 0, 0],
    audio: { openPreset: 'drawerSlide', volume: 0.45 },
  });
  g.add(doorL, doorR);

  // Vintage Braun / Garrard Walnut & Aluminum Hi-Fi Turntable (`>= 1.5 mm` clear above travertine top)
  const surfY = baseY + bodyH + 0.0026;
  const ttGroup = new THREE.Group();
  ttGroup.name = 'stahl.dining.hifiTurntable';
  ttGroup.position.set(-0.42, surfY, 0);
  addMesh(ttGroup, bevelledBox(0.42, 0.056, 0.34, 0.005, 4, 0.6, 0.6), mcm.walnut, [0, 0.028, 0], undefined, 'cast');
  addMesh(ttGroup, bevelledBox(0.392, 0.007, 0.312, 0.002, 3, 0.5, 0.5), mcm.dieCastAlum, [0, 0.0608, 0]);
  const platter = addMesh(ttGroup, prepGeo(new THREE.CylinderGeometry(0.136, 0.138, 0.012, 48)), mcm.vinylRecord, [-0.03, 0.0715, 0]);
  const label = addMesh(ttGroup, prepGeo(new THREE.CylinderGeometry(0.046, 0.046, 0.0024, 36)), mcm.formicaPersimmon, [-0.03, 0.0798, 0]);
  addMesh(ttGroup, prepGeo(new THREE.CylinderGeometry(0.0035, 0.0035, 0.012, 16)), mcm.polishedChrome, [-0.03, 0.085, 0]);
  addMesh(ttGroup, prepGeo(new THREE.CylinderGeometry(0.014, 0.016, 0.024, 24)), mcm.polishedChrome, [0.135, 0.076, -0.085]);
  addMesh(ttGroup, prepGeo(new THREE.CylinderGeometry(0.0032, 0.0032, 0.215, 20)), mcm.polishedChrome, [0.105, 0.088, 0.01], [Math.PI * 0.5, 0, 0.24]);

  attachAssetInteraction(ttGroup, {
    kind: 'toggle',
    id: 'stahl-hifi-turntable',
    label: 'Play Dave Brubeck LP on Hi-Fi Turntable',
    activeLabel: 'Stop Hi-Fi Turntable',
    onStep: (dt, state) => {
      if (state.active) {
        platter.rotation.y += dt * 3.49; // 33 1/3 RPM
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

  // Jazz vinyl LP sleeve + 48-seg sculpted stoneware bowl on right end (`>= 1.5 mm` clear)
  addMesh(g, buildPlanarArtworkSlabGeo(0.315, 0.014, 0.315, 0.0022, 'y'), mcm.aaCoverMat, [0.22, surfY + 0.007, 0.02], [0, 0.11, 0], 'cast');
  const credBowlGeo = makeLatheGeo(
    [[0, 0], [0.056, 0], [0.128, 0.036], [0.146, 0.074], [0.136, 0.074], [0.114, 0.036], [0.044, 0.012], [0, 0.012]],
    48
  );
  addMesh(g, credBowlGeo, mcm.stonewareWhite, [0.58, surfY, -0.02], undefined, 'cast');

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
