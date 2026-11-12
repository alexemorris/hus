import * as THREE from 'three';
import type { CutawayWallDescriptor } from 'husjs';
import { createSculptedCushionGeometry } from 'husjs/catalog/furniture';
import {
  attachAssetInteraction,
  attachAssetMetadata,
  extrudePlanarSolidWithHoles,
  prepGeo,
  tagCollisionRole,
  tagCutaway,
} from 'husjs/objects';
import type { LightCircuitGroup, SceneBuilderContext } from 'husjs/viewer';
import { buildFloorToCeilingSlidingWardrobe } from './mcm-bedrooms.ts';
import { registerSeat } from './mcm-furniture.ts';
import { metricBox, type McmMaterials } from './mcm-materials.ts';

function sampleOvalLoop(
  cx: number,
  cz: number,
  rx: number,
  rz: number,
  segments = 24
): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i * Math.PI * 2) / segments;
    pts.push([cx + Math.cos(a) * rx, cz + Math.sin(a) * rz]);
  }
  return pts;
}

function addStubbyFloatingLegs(
  parent: THREE.Object3D,
  xs: readonly number[],
  zs: readonly number[],
  legH: number,
  mcm: McmMaterials
): void {
  const shaftH = legH - 0.014;
  const legGeo = prepGeo(new THREE.CylinderGeometry(0.015, 0.013, shaftH, 12));
  const footGeo = prepGeo(new THREE.CylinderGeometry(0.022, 0.022, 0.008, 12));
  for (const x of xs) {
    for (const z of zs) {
      const leg = new THREE.Mesh(legGeo, mcm.blackenedSteel);
      leg.position.set(x, 0.011 + shaftH * 0.5, z);
      const foot = new THREE.Mesh(footGeo, mcm.dieCastAlum);
      foot.position.set(x, 0.004, z);
      parent.add(leg, foot);
    }
  }
}

/**
 * Public Wing — North Kitchen Bay (`X in [0.75, 5.35], Z in [-5.88, -1.10]`):
 *  - Koenig's freestanding "floating" `Arcware` aluminum-framed American black walnut cabinetry on stubby steel legs
 *  - Color-blocked Formica sliding upper cabinet doors (`kind: 'slide'` in aqua, mustard, persimmon & crisp white)
 *  - Built-in Thermador brushed-stainless double wall oven (`kind: 'hinge'` drop-down doors) & stainless fridge column
 *  - Twin `Lyoncraft` inset stainless sink bowls + chrome swivel spout (`waterTapFlow` running water loop)
 *  - Peninsula breakfast bar w/ 4-burner stainless cooktop, stovetop espresso maker, & 3 chrome/leather counter stools
 *  - Dropped modular `Infinilite` luminous ceiling grid.
 */
export function buildStahlKitchenBay(
  ctx: SceneBuilderContext,
  parent: THREE.Object3D,
  mcm: McmMaterials
): THREE.Group {
  const kitchen = new THREE.Group();
  kitchen.name = 'stahl.kitchen.joinery';
  kitchen.position.y = 0.0006;

  const legH = 0.16; // Koenig's signature 6.3" floating clearance above concrete slab

  // 1. INTEGRATED STAINLESS REFRIGERATOR / FREEZER COLUMN (`X in [0.78, 1.66]`)
  const fridgeCol = new THREE.Group();
  fridgeCol.name = 'stahl.kitchen.fridgeAppliance';
  fridgeCol.position.set(1.22, 0, -5.54);
  addStubbyFloatingLegs(fridgeCol, [-0.38, 0.38], [-0.26, 0.26], legH, mcm);

  const colH = 2.02;
  const colD = 0.64;
  const fridgeCase = new THREE.Mesh(metricBox(0.88, colH, colD - 0.04, 0.9, 0.9), mcm.walnut);
  fridgeCase.position.set(0, legH + colH * 0.5, -0.02);
  fridgeCase.castShadow = true;
  const fridgeTrim = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.886, 0.018, colD + 0.004)), mcm.dieCastAlum);
  fridgeTrim.position.set(0, legH + colH + 0.009, 0);
  fridgeCol.add(fridgeCase, fridgeTrim);

  // Upper Brushed-Stainless Refrigerator Hinged Door
  const upperDoorH = 1.24;
  const fridgePivot = new THREE.Group();
  fridgePivot.name = 'stahl.kitchen.fridgeUpperDoor.pivot';
  fridgePivot.position.set(-0.425, legH + 0.75 + upperDoorH * 0.5, colD * 0.5 - 0.018);
  const fridgeLeaf = new THREE.Mesh(metricBox(0.85, upperDoorH, 0.028, 0.9, 0.9), mcm.brushedStainless);
  fridgeLeaf.position.set(0.425, 0, 0);
  fridgeLeaf.castShadow = true;
  const fridgeHandle = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.016, 0.42, 0.028)), mcm.polishedChrome);
  fridgeHandle.position.set(0.80, -0.12, 0.026);
  fridgePivot.add(fridgeLeaf, fridgeHandle);
  attachAssetInteraction(fridgePivot, {
    kind: 'hinge',
    id: 'stahl-fridge-door',
    label: 'Open Integrated Stainless Refrigerator',
    pivotOffset: [0, 0, 0],
    axis: 'y',
    openAngle: -1.18,
    audio: { openPreset: 'doorLatch', volume: 0.48 },
  });

  // Lower Brushed-Stainless Freezer Drawer
  const freezerDrawer = new THREE.Group();
  freezerDrawer.name = 'stahl.kitchen.freezerDrawer';
  freezerDrawer.position.set(0, legH + 0.365, colD * 0.5 - 0.018);
  const fzFront = new THREE.Mesh(metricBox(0.85, 0.71, 0.028, 0.9, 0.9), mcm.brushedStainless);
  const fzHandle = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.48, 0.016, 0.028)), mcm.polishedChrome);
  fzHandle.position.set(0, 0.26, 0.026);
  freezerDrawer.add(fzFront, fzHandle);
  attachAssetInteraction(freezerDrawer, {
    kind: 'slide',
    id: 'stahl-freezer-drawer',
    label: 'Pull Out Stainless Freezer Drawer',
    slideDelta: [0, 0, 0.42],
    audio: { openPreset: 'drawerSlide', volume: 0.48 },
  });
  fridgeCol.add(fridgePivot, freezerDrawer);

  attachAssetMetadata(fridgeCol, {
    name: 'Revco / General Electric Custom Built-In Brushed-Stainless Refrigerator-Freezer', brand: 'Revco Bilt-In', collection: 'Case Study House #22 Appliance Suite (1960)',
    sku: 'RV-1960-SS-880', finish: 'Brushed 304 Stainless Steel, Polished Chrome & Arcware Anodized Trim', category: 'appliance', dimensionsMm: [880, 640, 2180],
  });
  kitchen.add(fridgeCol);

  // 2. THERMADOR BRUSHED-STAINLESS DOUBLE WALL OVEN (`X in [1.68, 2.48]`)
  const ovenCol = new THREE.Group();
  ovenCol.name = 'stahl.kitchen.thermadorOvenAppliance';
  ovenCol.position.set(2.08, 0, -5.54);
  addStubbyFloatingLegs(ovenCol, [-0.34, 0.34], [-0.26, 0.26], legH, mcm);

  const ovenCase = new THREE.Mesh(metricBox(0.80, colH, colD - 0.04, 0.9, 0.9), mcm.walnut);
  ovenCase.position.set(0, legH + colH * 0.5, -0.02);
  ovenCase.castShadow = true;
  const ovenTopTrim = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.806, 0.018, colD + 0.004)), mcm.dieCastAlum);
  ovenTopTrim.position.set(0, legH + colH + 0.009, 0);

  // Lower walnut pan drawer + upper walnut storage fascia
  const ovenLowPanel = new THREE.Mesh(metricBox(0.76, 0.36, 0.022, 0.8, 0.8), mcm.walnut);
  ovenLowPanel.position.set(0, legH + 0.19, colD * 0.5 - 0.016);
  const ovenHighPanel = new THREE.Mesh(metricBox(0.76, 0.34, 0.022, 0.8, 0.8), mcm.walnut);
  ovenHighPanel.position.set(0, legH + colH - 0.18, colD * 0.5 - 0.016);
  ovenCol.add(ovenCase, ovenTopTrim, ovenLowPanel, ovenHighPanel);

  // Control fascia strip between/above double ovens
  const ctrlStrip = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.76, 0.11, 0.024)), mcm.brushedStainless);
  ctrlStrip.position.set(0, legH + 1.61, colD * 0.5 - 0.014);
  ovenCol.add(ctrlStrip);
  for (let k = -2; k <= 2; k++) {
    const dial = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.016, 0.018, 0.018, 12)), mcm.formicaCharcoal);
    dial.rotation.x = Math.PI * 0.5;
    dial.position.set(k * 0.12, legH + 1.61, colD * 0.5 + 0.004);
    ovenCol.add(dial);
  }

  // Stacked Upper & Lower Drop-Down Brushed-Stainless Oven Doors (`axis: 'x'`)
  for (const [tag, oy, label] of [
    ['upper', legH + 1.03, 'Open Thermador Upper Bake Oven'],
    ['lower', legH + 0.42, 'Open Thermador Lower Broil Oven'],
  ] as const) {
    const doorH = 0.52;
    const pivot = new THREE.Group();
    pivot.name = `stahl.kitchen.thermador.${tag}Door.pivot`;
    pivot.position.set(0, oy, colD * 0.5 - 0.016);

    const frame = new THREE.Mesh(metricBox(0.76, doorH, 0.028, 0.8, 0.8), mcm.brushedStainless);
    frame.position.set(0, doorH * 0.5, 0);
    const windowGlass = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.52, 0.24, 0.032)), mcm.formicaCharcoal);
    windowGlass.position.set(0, doorH * 0.52, 0);
    const barHandle = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.64, 0.018, 0.032)), mcm.polishedChrome);
    barHandle.position.set(0, doorH - 0.055, 0.026);
    pivot.add(frame, windowGlass, barHandle);

    attachAssetInteraction(pivot, {
      kind: 'hinge',
      id: `stahl-thermador-oven-${tag}`,
      label,
      pivotOffset: [0, 0, 0],
      axis: 'x',
      openAngle: 1.18,
      audio: { openPreset: 'ovenDoorLatch', volume: 0.55 },
    });
    ovenCol.add(pivot);
  }

  attachAssetMetadata(ovenCol, {
    name: 'Thermador Masterpiece Bilt-In Brushed-Stainless Double Electric Wall Oven', brand: 'Thermador Electrical Mfg. Co. (Los Angeles)', collection: 'Masterpiece Bilt-In Series (1960)',
    sku: 'TH-WO-242-SS', finish: 'Brushed 304 Stainless Steel, Tempered Viewing Glass & Chrome Bar Handles', category: 'appliance', dimensionsMm: [800, 640, 2180],
  });
  kitchen.add(ovenCol);

  // 3. NORTH SINK LOWER CABINETS + LYONCRAFT DOUBLE SINK (`X in [2.50, 5.36]`)
  const northRun = new THREE.Group();
  northRun.name = 'stahl.kitchen.northSinkCabinet';
  const nrW = 2.86;
  const nrD = 0.64;
  const nrX = 3.93;
  const nrZ = -5.54;
  northRun.position.set(nrX, 0, nrZ);
  addStubbyFloatingLegs(northRun, [-1.34, 0, 1.34], [-0.26, 0.26], legH, mcm);

  const baseBodyH = 0.72;
  const nrCarcass = new THREE.Mesh(metricBox(nrW, baseBodyH, nrD - 0.03, 0.9, 0.9), mcm.walnut);
  nrCarcass.position.set(0, legH + baseBodyH * 0.5, -0.015);
  nrCarcass.castShadow = true;
  northRun.add(nrCarcass);

  // Arcware satin anodized aluminum top & bottom horizontal edge extrusions + 4 book-matched walnut doors
  for (const ty of [legH + 0.01, legH + baseBodyH - 0.01]) {
    const alRail = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(nrW + 0.006, 0.02, 0.022)), mcm.dieCastAlum);
    alRail.position.set(0, ty, nrD * 0.5 - 0.01);
    northRun.add(alRail);
  }
  const lowDoorW = (nrW - 0.06) / 4;
  for (let i = 0; i < 4; i++) {
    const dx = -nrW * 0.5 + 0.03 + lowDoorW * (i + 0.5);
    const panel = new THREE.Mesh(metricBox(lowDoorW - 0.008, baseBodyH - 0.05, 0.018, 0.85, 0.85), mcm.walnut);
    panel.position.set(dx, legH + baseBodyH * 0.5, nrD * 0.5 - 0.008);
    const pull = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.09, 0.012, 0.016)), mcm.dieCastAlum);
    pull.position.set(dx, legH + baseBodyH - 0.08, nrD * 0.5 + 0.006);
    northRun.add(panel, pull);
  }

  // Crisp White Formica Countertop with Twin Rectangular Cutouts for Lyoncraft Double Stainless Sink
  const counterY = legH + baseBodyH; // 0.88 m
  const counterT = 0.034;
  const bowlHalfW = 0.175;
  const bowlHalfD = 0.19;
  const northCounter = new THREE.Mesh(
    extrudePlanarSolidWithHoles({
      outer: [
        [-nrW * 0.5 - 0.01, -nrD * 0.5 - 0.01],
        [nrW * 0.5 + 0.01, -nrD * 0.5 - 0.01],
        [nrW * 0.5 + 0.01, nrD * 0.5 + 0.02],
        [-nrW * 0.5 - 0.01, nrD * 0.5 + 0.02],
      ],
      holes: [
        [
          [-0.21 - bowlHalfW, -bowlHalfD],
          [-0.21 + bowlHalfW, -bowlHalfD],
          [-0.21 + bowlHalfW, bowlHalfD],
          [-0.21 - bowlHalfW, bowlHalfD],
        ],
        [
          [0.21 - bowlHalfW, -bowlHalfD],
          [0.21 + bowlHalfW, -bowlHalfD],
          [0.21 + bowlHalfW, bowlHalfD],
          [0.21 - bowlHalfW, bowlHalfD],
        ],
      ],
      origin: [0, counterY, 0],
      uAxis: [1, 0, 0],
      vAxis: [0, 0, 1],
      wAxis: [0, 1, 0],
      depthRange: [0.001, counterT],
    }),
    mcm.formicaWhite
  );
  northCounter.castShadow = northCounter.receiveShadow = true;
  northRun.add(northCounter);

  // Twin Lyoncraft Stainless Sink Tubs + Chrome Swivel Spout (`waterTapFlow` interactive!)
  const sinkSurfY = counterY + counterT;
  for (const bx of [-0.21, 0.21]) {
    const basinBottom = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.35, 0.012, 0.38)), mcm.brushedStainless);
    basinBottom.position.set(bx, counterY - 0.16, 0);
    const drain = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.036, 0.036, 0.006, 16)), mcm.polishedChrome);
    drain.position.set(bx, counterY - 0.151, 0);
    northRun.add(basinBottom, drain);
  }
  const sinkRim = new THREE.Mesh(
    extrudePlanarSolidWithHoles({
      outer: [[-0.43, -0.24], [0.43, -0.24], [0.43, 0.22], [-0.43, 0.22]],
      holes: [
        [[-0.385, -0.19], [-0.035, -0.19], [-0.035, 0.19], [-0.385, 0.19]],
        [[0.035, -0.19], [0.385, -0.19], [0.385, 0.19], [0.035, 0.19]],
      ],
      origin: [0, sinkSurfY + 0.0005, 0],
      uAxis: [1, 0, 0],
      vAxis: [0, 0, 1],
      wAxis: [0, 1, 0],
      depthRange: [0, 0.005],
    }),
    mcm.brushedStainless
  );
  northRun.add(sinkRim);

  const tapGroup = new THREE.Group();
  tapGroup.name = 'stahl.kitchen.lyoncraftTap';
  tapGroup.position.set(0, sinkSurfY + 0.005, -0.215);
  const escutcheon = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.18, 0.016, 0.048)), mcm.polishedChrome);
  escutcheon.position.y = 0.008;
  const spoutRiser = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.011, 0.013, 0.18, 12)), mcm.polishedChrome);
  spoutRiser.position.y = 0.10;
  const spoutArm = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.009, 0.009, 0.20, 12)), mcm.polishedChrome);
  spoutArm.rotation.x = Math.PI * 0.46;
  spoutArm.position.set(0, 0.185, 0.095);
  for (const hx of [-0.068, 0.068]) {
    const lever = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.014, 0.016, 0.036, 12)), mcm.polishedChrome);
    lever.position.set(hx, 0.034, 0);
    tapGroup.add(lever);
  }
  const streamMat = new THREE.MeshPhysicalMaterial({ color: 0xd8f3ff, transparent: true, opacity: 0.62, roughness: 0.05 });
  const waterStream = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.006, 0.008, 0.30, 10)), streamMat);
  waterStream.position.set(0.05, 0.02, 0.185);
  waterStream.visible = false;
  tapGroup.add(escutcheon, spoutRiser, spoutArm, waterStream);

  attachAssetInteraction(tapGroup, {
    kind: 'toggle',
    id: 'stahl-kitchen-sink-tap',
    label: 'Turn On Lyoncraft Kitchen Sink Faucet',
    activeLabel: 'Turn Off Kitchen Sink Faucet',
    onToggle: (active) => { waterStream.visible = active; },
    audio: { openPreset: 'switchClick', activeLoopPreset: 'waterTapFlow', volume: 0.45 },
  });
  northRun.add(tapGroup);

  // Countertop details: Walnut knife block + Trio of Koenig-hue ceramic canisters
  const knifeBlock = new THREE.Mesh(metricBox(0.12, 0.19, 0.17, 0.5, 0.5), mcm.walnut);
  knifeBlock.position.set(-1.05, sinkSurfY + 0.095, -0.08);
  knifeBlock.rotation.x = 0.22;
  northRun.add(knifeBlock);

  const canisterSpecs = [
    [0.86, 0.16, mcm.formicaAqua],
    [1.03, 0.135, mcm.formicaMustard],
    [1.19, 0.11, mcm.formicaPersimmon],
  ] as const;
  for (const [cx, ch, cmat] of canisterSpecs) {
    const body = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.058, 0.058, ch, 16)), cmat);
    body.position.set(cx, sinkSurfY + ch * 0.5 + 0.001, -0.10);
    const lid = new THREE.Mesh(metricBox(0.118, 0.016, 0.118, 0.4, 0.4), mcm.walnut);
    lid.position.set(cx, sinkSurfY + ch + 0.009, -0.10);
    northRun.add(body, lid);
  }

  // 4. COLOR-BLOCKED FORMICA SLIDING UPPER CABINETS (`Y in [1.44, 2.18]`)
  const upH = 0.74;
  const upD = 0.36;
  const upMidY = 1.44 + upH * 0.5;
  const upZ = -nrD * 0.5 + upD * 0.5;

  const upTop = new THREE.Mesh(metricBox(nrW, 0.02, upD, 0.9, 0.9), mcm.walnut);
  upTop.position.set(0, 1.44 + upH - 0.01, upZ);
  const upBot = new THREE.Mesh(metricBox(nrW, 0.02, upD, 0.9, 0.9), mcm.walnut);
  upBot.position.set(0, 1.44 + 0.01, upZ);
  const upBack = new THREE.Mesh(metricBox(nrW - 0.04, upH - 0.042, 0.016, 0.9, 0.9), mcm.walnut);
  upBack.position.set(0, upMidY, upZ - upD * 0.5 + 0.01);
  const upShelf = new THREE.Mesh(metricBox(nrW - 0.044, 0.016, upD - 0.06, 0.9, 0.9), mcm.walnut);
  upShelf.position.set(0, upMidY, upZ - 0.015);
  northRun.add(upTop, upBot, upBack, upShelf);

  for (const sx of [-1, 1]) {
    const upSide = new THREE.Mesh(metricBox(0.02, upH - 0.042, upD, 0.9, 0.9), mcm.walnut);
    upSide.position.set(sx * (nrW * 0.5 - 0.01), upMidY, upZ);
    northRun.add(upSide);
  }

  // 4 Color-Blocked Formica Glide-All Sliding Upper Panels (Aqua, Mustard, Persimmon, Crisp White)
  const formicaPanels: readonly {
    readonly mat: THREE.Material;
    readonly colorName: string;
    readonly trackOffsetZ: number;
    readonly slideSign: 1 | -1;
  }[] = [
    { mat: mcm.formicaAqua, colorName: 'Turquoise Aqua', trackOffsetZ: -0.012, slideSign: 1 },
    { mat: mcm.formicaMustard, colorName: 'Mustard Ochre', trackOffsetZ: 0.008, slideSign: -1 },
    { mat: mcm.formicaPersimmon, colorName: 'Persimmon Coral', trackOffsetZ: -0.012, slideSign: 1 },
    { mat: mcm.formicaWhite, colorName: 'Crisp White', trackOffsetZ: 0.008, slideSign: -1 },
  ];
  const upPanelW = (nrW - 0.04) / 4 + 0.016;
  formicaPanels.forEach((fp, idx) => {
    const px = -nrW * 0.5 + 0.02 + ((nrW - 0.04) / 4) * (idx + 0.5);
    const pGrp = new THREE.Group();
    pGrp.name = `stahl.kitchen.upperSlide_${idx + 1}`;
    pGrp.position.set(px, upMidY, upZ + upD * 0.5 - 0.02 + fp.trackOffsetZ);
    const leaf = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(upPanelW, upH - 0.046, 0.016)), fp.mat);
    const fingerCup = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.016, 0.016, 0.006, 14)), mcm.dieCastAlum);
    fingerCup.rotation.x = Math.PI * 0.5;
    fingerCup.position.set(fp.slideSign * (-upPanelW * 0.5 + 0.055), -0.18, 0.010);
    pGrp.add(leaf, fingerCup);

    attachAssetInteraction(pGrp, {
      kind: 'slide',
      id: `stahl-kitchen-upper-${idx + 1}`,
      label: `Slide ${fp.colorName} Formica Upper Cabinet Door`,
      slideDelta: [fp.slideSign * (upPanelW - 0.06), 0, 0],
      audio: { openPreset: 'drawerSlide', volume: 0.42 },
    });
    northRun.add(pGrp);
  });

  // Under-cabinet warm 3000K task light strip + Koenig recessed flip-down aluminum spice rack
  const underCabMat = new THREE.MeshStandardMaterial({ color: 0xfffaf0, emissive: new THREE.Color(0xffe6b8), emissiveIntensity: 1.35, roughness: 0.3 });
  const underCabStrip = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(nrW - 0.16, 0.012, 0.036)), underCabMat);
  underCabStrip.position.set(0, 1.432, upZ + 0.08);
  const spiceBox = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.68, 0.11, 0.14)), mcm.dieCastAlum);
  spiceBox.position.set(-0.78, 1.384, upZ - 0.06);
  northRun.add(underCabStrip, spiceBox);

  const lumGroup = (ctx.lightGroups as Record<string, LightCircuitGroup>).stahlKitchenLuminous;
  if (lumGroup) lumGroup.emissives.push(underCabMat);

  attachAssetMetadata(northRun, {
    name: 'Arcware Aluminum-Framed Walnut & Color-Blocked Formica Kitchen Wall Unit', brand: 'Arcware / Formica / Lyoncraft', collection: 'Case Study House #22 Prefabricated Kitchen System (1960)',
    sku: 'CSH22-ARC-2860', finish: 'Book-Matched American Black Walnut, Aqua/Mustard/Persimmon/White Formica & Satin Aluminum', category: 'joinery', dimensionsMm: [2860, 640, 2180],
  });
  kitchen.add(northRun);

  // 5. FLOATING PENINSULA / ISLAND WORKTOP, COOKTOP & 3 COUNTER STOOLS
  const island = new THREE.Group();
  island.name = 'stahl.kitchen.peninsulaCabinet';
  const isW = 3.24;
  const isCarcassD = 0.70;
  const isTopD = 1.04; // 0.34 m South breakfast bar knee overhang!
  island.position.set(3.30, 0, -2.20);
  addStubbyFloatingLegs(island, [-1.50, 0, 1.50], [-0.28, 0.28], legH, mcm);

  const isBody = new THREE.Mesh(metricBox(isW, baseBodyH - 0.046, isCarcassD, 0.9, 0.9), mcm.walnut);
  isBody.position.set(0, legH + baseBodyH * 0.5, 0);
  isBody.castShadow = true;
  const isAlTop = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(isW + 0.008, 0.02, isCarcassD + 0.008)), mcm.dieCastAlum);
  isAlTop.position.set(0, legH + baseBodyH - 0.01, 0);
  const isAlBot = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(isW + 0.008, 0.02, isCarcassD + 0.008)), mcm.dieCastAlum);
  isAlBot.position.set(0, legH + 0.01, 0);

  // Crisp White Formica Breakfast Bar Worktop + Brushed-Stainless Edge Trim
  const isTop = new THREE.Mesh(metricBox(isW + 0.04, counterT, isTopD, 0.95, 0.95), mcm.formicaWhite);
  isTop.position.set(0, counterY + 0.003 + counterT * 0.5, 0.16);
  isTop.castShadow = isTop.receiveShadow = true;
  island.add(isBody, isAlTop, isAlBot, isTop);

  // Thermador Brushed-Stainless 4-Burner Electric Cooktop (`X = -0.62` in island local space)
  const isSurfY = counterY + counterT;
  const cooktopPlate = new THREE.Mesh(metricBox(0.78, 0.012, 0.52, 0.7, 0.7), mcm.brushedStainless);
  cooktopPlate.position.set(-0.62, isSurfY + 0.006, 0.02);
  island.add(cooktopPlate);

  const burnerOffsets = [
    [-0.80, -0.11, 0.095],
    [-0.44, -0.11, 0.080],
    [-0.80, 0.15, 0.080],
    [-0.44, 0.15, 0.105],
  ] as const;
  for (const [bx, bz, br] of burnerOffsets) {
    const ring = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(br + 0.012, br + 0.014, 0.006, 20)), mcm.polishedChrome);
    ring.position.set(bx, isSurfY + 0.014, bz);
    const coil = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(br, br, 0.005, 20)), mcm.formicaCharcoal);
    coil.position.set(bx, isSurfY + 0.018, bz);
    island.add(ring, coil);
  }
  for (let k = 0; k < 4; k++) {
    const knob = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.014, 0.016, 0.014, 12)), mcm.polishedChrome);
    knob.position.set(-0.18, isSurfY + 0.019, -0.15 + k * 0.10);
    island.add(knob);
  }

  // Vintage Chrome Stovetop Moka Espresso Maker (`espressoExtract` interactive!) + Ceramic Fruit Bowl
  const moka = new THREE.Group();
  moka.name = 'stahl.kitchen.mokaEspressoMaker';
  moka.position.set(-0.44, isSurfY + 0.021, 0.15);
  const mokaBot = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.038, 0.052, 0.085, 8)), mcm.polishedChrome);
  mokaBot.position.y = 0.0425;
  const mokaTop = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.054, 0.036, 0.095, 8)), mcm.polishedChrome);
  mokaTop.position.y = 0.1325;
  const mokaKnob = new THREE.Mesh(prepGeo(new THREE.SphereGeometry(0.012, 10, 8)), mcm.formicaCharcoal);
  mokaKnob.position.y = 0.188;
  const mokaHandle = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.012, 0.075, 0.034)), mcm.formicaCharcoal);
  mokaHandle.position.set(0, 0.13, 0.058);
  moka.add(mokaBot, mokaTop, mokaKnob, mokaHandle);
  attachAssetInteraction(moka, {
    kind: 'toggle',
    id: 'stahl-moka-espresso',
    label: 'Brew Stovetop Moka Espresso',
    activeLabel: 'Turn Off Stovetop Espresso Maker',
    audio: { openPreset: 'espressoExtract', activeLoopPreset: 'espressoMachine', volume: 0.42 },
  });

  const fruitBowl = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.16, 0.085, 0.055, 20)),
    mcm.porcelainWhite
  );
  fruitBowl.position.set(0.78, isSurfY + 0.028, 0.16);
  for (const [ox, oz, fmat] of [
    [0.74, 0.14, mcm.formicaPersimmon],
    [0.82, 0.15, mcm.formicaMustard],
    [0.78, 0.20, mcm.formicaMustard],
  ] as const) {
    const citrus = new THREE.Mesh(prepGeo(new THREE.SphereGeometry(0.034, 12, 10)), fmat);
    citrus.position.set(ox, isSurfY + 0.068, oz);
    island.add(citrus);
  }
  island.add(moka, fruitBowl);

  attachAssetMetadata(island, {
    name: 'Koenig Floating Walnut & Formica Breakfast Peninsula with Thermador 4-Burner Cooktop', brand: 'Arcware / Thermador', collection: 'Case Study House #22 Kitchen Island (1960)',
    sku: 'CSH22-ISL-3240', finish: 'Book-Matched American Black Walnut, Crisp White Formica & Brushed Stainless Steel', category: 'joinery', dimensionsMm: [3280, 1040, 914],
  });
  kitchen.add(island);

  // 3 Mid-Century Chrome & Saddle-Leather / Walnut Counter Stools (`SeatInteractable`)
  for (const [sIdx, sx] of [[1, 2.25], [2, 3.30], [3, 4.35]] as const) {
    const stool = new THREE.Group();
    const sName = `stahl.kitchen.counterStool_${sIdx}`;
    stool.name = sName;
    stool.position.set(sx, 0, -1.28);
    stool.rotation.y = Math.PI; // Faces North (-Z) toward breakfast bar

    const seatH = 0.65;
    for (const lx of [-0.15, 0.15]) {
      for (const lz of [-0.15, 0.15]) {
        const leg = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.009, 0.008, seatH - 0.04, 10)), mcm.polishedChrome);
        leg.position.set(lx, (seatH - 0.04) * 0.5, lz);
        leg.rotation.z = -lx * 0.22;
        leg.rotation.x = lz * 0.22;
        stool.add(leg);
      }
    }
    const footRing = new THREE.Mesh(prepGeo(new THREE.TorusGeometry(0.175, 0.007, 8, 24)), mcm.polishedChrome);
    footRing.rotation.x = Math.PI * 0.5;
    footRing.position.y = 0.22;

    const walnutPan = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.185, 0.175, 0.022, 22)), mcm.walnut);
    walnutPan.position.y = seatH - 0.032;
    const leatherPad = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.178, 0.182, 0.042, 22)), mcm.saddleLeather);
    leatherPad.position.y = seatH;
    leatherPad.castShadow = true;
    const lowBack = new THREE.Mesh(metricBox(0.32, 0.11, 0.024, 0.5, 0.5), mcm.walnut);
    lowBack.position.set(0, seatH + 0.11, -0.165);
    const backPostL = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.007, 0.007, 0.13, 8)), mcm.polishedChrome);
    backPostL.position.set(-0.09, seatH + 0.045, -0.165);
    const backPostR = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.007, 0.007, 0.13, 8)), mcm.polishedChrome);
    backPostR.position.set(0.09, seatH + 0.045, -0.165);
    stool.add(footRing, walnutPan, leatherPad, lowBack, backPostL, backPostR);

    registerSeat(ctx, stool, {
      id: `${sName}.seat`,
      label: `Sit on Mid-Century Breakfast Bar Counter Stool ${sIdx}`,
      aliases: [sName, 'counter stool', 'bar stool'],
      localSeatPos: [0, seatH + 0.02, 0],
      localFootOffset: [0, 0, -0.56],
      localForward: [0, 0, 1],
      material: 'leather',
    });

    attachAssetMetadata(stool, {
    name: 'Mid-Century Chrome, Walnut & Saddle-Leather Counter Stool', brand: 'Van Keppel-Green / Laverne', collection: 'California Modern Bar Seating',
    sku: `VKG-STL-${sIdx}`, finish: 'Polished Tubular Chrome, Turned American Walnut & Saddle Tan Leather', category: 'furniture', dimensionsMm: [390, 390, 770],
  });
    kitchen.add(stool);
  }

  // 6. DROPPED MODULAR INFINILITE LUMINOUS CEILING GRID (`Y = 2.38 m`)
  const lumGrid = new THREE.Group();
  lumGrid.name = 'stahl.kitchen.luminousCeilingGrid';
  const gridW = 3.84;
  const gridD = 3.36;
  const gridX = 3.20;
  const gridZ = -3.72;
  const gridY = 2.38;

  const perimeterFrame = new THREE.Mesh(
    extrudePlanarSolidWithHoles({
      outer: [[-gridW * 0.5, -gridD * 0.5], [gridW * 0.5, -gridD * 0.5], [gridW * 0.5, gridD * 0.5], [-gridW * 0.5, gridD * 0.5]],
      holes: [[[-gridW * 0.5 + 0.045, -gridD * 0.5 + 0.045], [gridW * 0.5 - 0.045, -gridD * 0.5 + 0.045], [gridW * 0.5 - 0.045, gridD * 0.5 - 0.045], [-gridW * 0.5 + 0.045, gridD * 0.5 - 0.045]]],
      origin: [gridX, gridY, gridZ],
      uAxis: [1, 0, 0],
      vAxis: [0, 0, 1],
      wAxis: [0, 1, 0],
      depthRange: [-0.035, 0.055],
    }),
    mcm.walnut
  );
  lumGrid.add(perimeterFrame);

  const lumPanelMat = new THREE.MeshStandardMaterial({ color: 0xfffef8, emissive: new THREE.Color(0xfff1d2), emissiveIntensity: 1.45, roughness: 0.28 });
  if (lumGroup) lumGroup.emissives.push(lumPanelMat);

  const cols = 4;
  const rows = 3;
  const innerW = gridW - 0.09;
  const innerD = gridD - 0.09;
  const cellW = innerW / cols;
  const cellD = innerD / rows;
  const panelGeo = prepGeo(new THREE.BoxGeometry(cellW - 0.022, 0.016, cellD - 0.022));

  for (let ix = 0; ix < cols; ix++) {
    for (let iz = 0; iz < rows; iz++) {
      const px = gridX - innerW * 0.5 + cellW * (ix + 0.5);
      const pz = gridZ - innerD * 0.5 + cellD * (iz + 0.5);
      const panel = new THREE.Mesh(panelGeo, lumPanelMat);
      panel.position.set(px, gridY - 0.01, pz);
      lumGrid.add(panel);
    }
  }
  for (let ix = 1; ix < cols; ix++) {
    const tBarX = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.018, 0.022, innerD)), mcm.dieCastAlum);
    tBarX.position.set(gridX - innerW * 0.5 + cellW * ix, gridY - 0.012, gridZ);
    lumGrid.add(tBarX);
  }
  for (let iz = 1; iz < rows; iz++) {
    const tBarZ = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(innerW, 0.020, 0.018)), mcm.dieCastAlum);
    tBarZ.position.set(gridX, gridY - 0.014, gridZ - innerD * 0.5 + cellD * iz);
    lumGrid.add(tBarZ);
  }
  kitchen.add(lumGrid);

  parent.add(kitchen);
  return kitchen;
}

/**
 * Private West Wing Breezeway Linen Closet + Authentic 1960 Koenig Central Bathroom Core:
 *  - Breezeway floor-to-ceiling sliding walnut & aqua-Formica linen closet (`kind: 'slide'`)
 *  - Mosaic Tile Co. glazed light-blue & sand-granite ceramic tile floor & wainscot
 *  - 2.16 m floating Formica & American walnut double-basin vanity (`extrudePlanarSolidWithHoles` twin oval basins)
 *    with twin chrome mid-century faucets (`waterTapFlow`), full-width frameless plate mirror & chrome/opal bar light
 *  - Tiled sunken/curbed Roman tub & walk-in shower combo w/ sliding fluted-glass bypass doors (`kind: 'slide'`)
 *    and chrome thermostatic shower set (`waterTapFlow`)
 *  - Low-profile 1960 one-piece white vitreous china WC (`cisternFlush`).
 */
export function buildBreezewayAndCentralBathCore(
  ctx: SceneBuilderContext,
  parent: THREE.Object3D,
  mcm: McmMaterials,
  cuts: { readonly northWoodsCut: CutawayWallDescriptor },
  ceilingTopY: number
): void {
  // 1. Breezeway Floor-to-Ceiling Sliding Linen & Utility Storage (`X in [-7.22, -5.86], Z in [-1.58, -1.24]`)
  buildFloorToCeilingSlidingWardrobe(parent, mcm, {
    name: 'stahl.breezeway.linenClosetCabinet',
    xCenter: -6.54,
    zCenter: -1.41,
    widthM: 1.36,
    depthM: 0.34,
    heightM: ceilingTopY - 0.002,
    facing: '+z',
    doorMatA: mcm.formicaAqua,
    doorMatB: mcm.walnut,
    brandLabel: 'Breezeway Color-Blocked Formica & Walnut Linen Closet',
  });

  // 2. Central Bathroom Core (`X in [-7.23, -4.76], Z in [-5.92, -1.72]`)
  const bath = new THREE.Group();
  bath.name = 'stahl.bathCore.interior';

  // Light-blue Mosaic Tile floor (`2 mm` thick, `tagCollisionRole(..., 'ignore')`)
  const tileFloor = new THREE.Mesh(metricBox(2.44, 0.002, 4.18, 0.81, 0.81), mcm.mosaicBlue);
  tileFloor.name = 'stahl.bath.mosaicFloor';
  tileFloor.position.set(-5.996, 0.0018, -3.82);
  tileFloor.receiveShadow = true;
  tagCollisionRole(tileFloor, 'ignore');
  bath.add(tileFloor);

  // Speckled sand-granite Mosaic Tile side-wall wainscots (`2 mm` proud of East/West partitions)
  const wainscotH = 2.18;
  const westTileWall = new THREE.Mesh(metricBox(0.004, wainscotH, 3.08, 0.81, 0.81), mcm.mosaicSand);
  westTileWall.position.set(-7.232, 0.004 + wainscotH * 0.5, -3.28);
  const eastTileWall = new THREE.Mesh(metricBox(0.004, wainscotH, 3.08, 0.81, 0.81), mcm.mosaicSand);
  eastTileWall.position.set(-4.760, 0.004 + wainscotH * 0.5, -3.28);
  bath.add(westTileWall, eastTileWall);

  // A. TILED ROMAN TUB / WALK-IN SHOWER COMBO (`North end`, `Z in [-5.90, -4.88]`)
  const romanTub = new THREE.Group();
  romanTub.name = 'stahl.bath.romanTubShowerCabinet';
  romanTub.position.set(-5.996, 0, -5.40);

  // North feature wall in light-blue Mosaic Tile (tagged with `northWoodsCut`!)
  const northBlueTile = new THREE.Mesh(metricBox(2.44, wainscotH, 0.012, 0.81, 0.81), mcm.mosaicBlue);
  northBlueTile.position.set(-5.996, 0.004 + wainscotH * 0.5, -5.922);
  tagCutaway(northBlueTile, cuts.northWoodsCut);
  bath.add(northBlueTile);

  // Tiled Roman soaking curb (`Z = -4.90`), recessed tiled soaking deck & East tiled seat ledge
  const curb = new THREE.Mesh(metricBox(2.44, 0.34, 0.14, 0.81, 0.81), mcm.mosaicBlue);
  curb.position.set(0, 0.174, 0.50);
  curb.castShadow = true;
  const tubBench = new THREE.Mesh(metricBox(0.42, 0.38, 0.86, 0.81, 0.81), mcm.mosaicBlue);
  tubBench.position.set(-1.014, 0.194, -0.02);
  const tubDrain = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.045, 0.045, 0.005, 16)), mcm.polishedChrome);
  tubDrain.position.set(0.196, 0.006, -0.02);
  romanTub.add(curb, tubBench, tubDrain);

  // Anodized Aluminum Header/Track + Translucent Fluted-Glass Sliding Bypass Doors (`kind: 'slide'`)
  const trackTopY = 2.06;
  const glassH = trackTopY - 0.34 - 0.036;
  const glassMidY = 0.34 + 0.018 + glassH * 0.5;
  const topTrack = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(2.43, 0.028, 0.056)), mcm.dieCastAlum);
  topTrack.position.set(0, trackTopY - 0.014, 0.50);
  const botTrack = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(2.43, 0.016, 0.052)), mcm.dieCastAlum);
  botTrack.position.set(0, 0.355, 0.50);
  romanTub.add(topTrack, botTrack);

  const gPanelW = 1.25;
  for (const [idx, gx, gzOff, dir, label] of [
    [1, -0.584, -0.012, 1, 'Slide Roman Shower Left Fluted-Glass Door'],
    [2, 0.586, 0.012, -1, 'Slide Roman Shower Right Fluted-Glass Door'],
  ] as const) {
    const gp = new THREE.Group();
    gp.name = `stahl.bath.showerGlassDoor_${idx}`;
    gp.position.set(gx, glassMidY + 0.004, 0.50 + gzOff);
    const pane = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(gPanelW - 0.050, glassH - 0.012, 0.012)), mcm.flutedGlass);
    const stileL = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.022, glassH - 0.012, 0.018)), mcm.dieCastAlum);
    stileL.position.x = -gPanelW * 0.5 + 0.011;
    const stileR = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.022, glassH - 0.012, 0.018)), mcm.dieCastAlum);
    stileR.position.x = gPanelW * 0.5 - 0.011;
    const towelBar = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.46, 0.016, 0.036)), mcm.polishedChrome);
    towelBar.position.set(0, -0.06, idx === 2 ? 0.024 : -0.024);
    gp.add(pane, stileL, stileR, towelBar);

    attachAssetInteraction(gp, {
      kind: 'slide',
      id: `stahl-bath-shower-door-${idx}`,
      label,
      slideDelta: [dir * 1.05, 0, 0],
      audio: { openPreset: 'drawerSlide', volume: 0.48 },
    });
    romanTub.add(gp);
  }

  // Chrome Mid-Century Thermostatic Shower Valve, Tub Spout & Cone Overhead Rose (`East shower wall`)
  const showerFixture = new THREE.Group();
  showerFixture.name = 'stahl.bath.thermostaticShower';
  showerFixture.position.set(1.226, 0, -0.02);
  const valvePlate = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.075, 0.075, 0.014, 18)), mcm.polishedChrome);
  valvePlate.rotation.z = Math.PI * 0.5;
  valvePlate.position.set(-0.008, 1.16, 0);
  const valveDial = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.028, 0.032, 0.038, 14)), mcm.polishedChrome);
  valveDial.rotation.z = Math.PI * 0.5;
  valveDial.position.set(-0.028, 1.16, 0);
  const tubFiller = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.15, 0.028, 0.038)), mcm.polishedChrome);
  tubFiller.position.set(-0.075, 0.56, 0);
  const showerArm = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.011, 0.011, 0.34, 12)), mcm.polishedChrome);
  showerArm.rotation.z = Math.PI * 0.38;
  showerArm.position.set(-0.15, 1.98, 0);
  const showerCone = new THREE.Mesh(prepGeo(new THREE.ConeGeometry(0.068, 0.095, 18)), mcm.polishedChrome);
  showerCone.rotation.z = -0.32;
  showerCone.position.set(-0.30, 1.90, 0);

  const showerSprayMat = new THREE.MeshPhysicalMaterial({ color: 0xdaf4ff, transparent: true, opacity: 0.38, roughness: 0.08 });
  const showerSpray = new THREE.Mesh(prepGeo(new THREE.ConeGeometry(0.22, 1.78, 16, 1, true)), showerSprayMat);
  showerSpray.position.set(-0.46, 0.98, 0);
  showerSpray.visible = false;
  showerFixture.add(valvePlate, valveDial, tubFiller, showerArm, showerCone, showerSpray);

  attachAssetInteraction(showerFixture, {
    kind: 'toggle',
    id: 'stahl-roman-shower-valve',
    label: 'Turn On Roman Tub & Thermostatic Shower',
    activeLabel: 'Turn Off Roman Shower',
    onToggle: (active) => { showerSpray.visible = active; },
    audio: { openPreset: 'switchClick', activeLoopPreset: 'waterTapFlow', volume: 0.5 },
  });
  romanTub.add(showerFixture);

  attachAssetMetadata(romanTub, {
    name: 'Koenig Mosaic-Tiled Sunken Roman Tub & Fluted-Glass Walk-In Shower', brand: 'Mosaic Tile Co. / American Standard', collection: 'Case Study House #22 Master Bath (1960)',
    sku: 'CSH22-ROMAN-2440', finish: 'Horizon Blue Glazed Ceramic Mosaic Tile, Fluted Architectural Glass & Chrome', category: 'sanitaryware', dimensionsMm: [2440, 1020, 2060],
  });
  bath.add(romanTub);

  // B. FLOATING 2.16 M DOUBLE-BASIN WALNUT & FORMICA VANITY (`West wall`)
  const vanity = new THREE.Group();
  vanity.name = 'stahl.bath.doubleVanityCabinet';
  // Spans Z in [-4.72, -2.56] (center Z = -3.64, completely clear of South bathDoor swing Z > -2.46!)
  const vLen = 2.16;
  const vDepth = 0.56;
  vanity.position.set(-6.94, 0, -3.64); // Local X = depth (+X into room), Local Z = length

  const vBaseY = 0.20; // Floating 200 mm off mosaic floor!
  const vBodyH = 0.62;
  const vTopY = vBaseY + vBodyH; // 0.82 m
  const vTopT = 0.032;

  const vCarcass = new THREE.Mesh(metricBox(vDepth - 0.03, vBodyH, vLen, 0.85, 0.85), mcm.walnut);
  vCarcass.position.set(-0.015, vBaseY + vBodyH * 0.5, 0);
  vCarcass.castShadow = true;
  const vAlRailTop = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.02, 0.018, vLen + 0.004)), mcm.dieCastAlum);
  vAlRailTop.position.set(vDepth * 0.5 - 0.01, vTopY - 0.009, 0);
  const vAlRailBot = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.02, 0.018, vLen + 0.004)), mcm.dieCastAlum);
  vAlRailBot.position.set(vDepth * 0.5 - 0.01, vBaseY + 0.009, 0);
  vanity.add(vCarcass, vAlRailTop, vAlRailBot);

  // Two interactive sliding Formica/walnut vanity doors
  const vDoorW = (vLen - 0.05) * 0.5 + 0.02;
  for (const [idx, dz, xOff, dir, mat] of [
    [1, -vDoorW * 0.5 + 0.01, -0.014, 1, mcm.walnut],
    [2, vDoorW * 0.5 - 0.01, 0.006, -1, mcm.formicaWhite],
  ] as const) {
    const vd = new THREE.Group();
    vd.name = `stahl.bath.vanitySlide_${idx}`;
    vd.position.set(vDepth * 0.5 - 0.01 + xOff, vBaseY + vBodyH * 0.5, dz);
    const leaf = new THREE.Mesh(metricBox(0.016, vBodyH - 0.044, vDoorW, 0.8, 0.8), mat);
    const pull = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.014, 0.09, 0.014)), mcm.polishedChrome);
    pull.position.set(0.012, 0.14, dir * (-vDoorW * 0.5 + 0.055));
    vd.add(leaf, pull);
    attachAssetInteraction(vd, {
      kind: 'slide',
      id: `stahl-bath-vanity-door-${idx}`,
      label: `Slide Double Vanity Cabinet Panel ${idx}`,
      slideDelta: [0, 0, dir * (vDoorW - 0.08)],
      audio: { openPreset: 'drawerSlide', volume: 0.44 },
    });
    vanity.add(vd);
  }

  // Crisp White Formica Countertop with Twin Oval Cutouts (`Z = -0.56` and `Z = +0.56`)
  const vCounter = new THREE.Mesh(
    extrudePlanarSolidWithHoles({
      outer: [
        [-vDepth * 0.5, -vLen * 0.5 - 0.01],
        [vDepth * 0.5 + 0.02, -vLen * 0.5 - 0.01],
        [vDepth * 0.5 + 0.02, vLen * 0.5 + 0.01],
        [-vDepth * 0.5, vLen * 0.5 + 0.01],
      ],
      holes: [
        sampleOvalLoop(0.03, -0.56, 0.165, 0.225, 24),
        sampleOvalLoop(0.03, 0.56, 0.165, 0.225, 24),
      ],
      origin: [0, vTopY, 0],
      uAxis: [1, 0, 0],
      vAxis: [0, 0, 1],
      wAxis: [0, 1, 0],
      depthRange: [0.001, vTopT],
    }),
    mcm.formicaWhite
  );
  vCounter.castShadow = vCounter.receiveShadow = true;
  vanity.add(vCounter);

  // Twin Drop-In White Porcelain Oval Basins + Chrome Mid-Century Taps (`waterTapFlow`!)
  const vSurfY = vTopY + vTopT;
  const basinWellPts = [
    new THREE.Vector2(0.001, -0.155),
    new THREE.Vector2(0.095, -0.155),
    new THREE.Vector2(0.165, -0.065),
    new THREE.Vector2(0.180, 0.003),
    new THREE.Vector2(0.162, 0.003),
    new THREE.Vector2(0.150, -0.060),
    new THREE.Vector2(0.085, -0.142),
    new THREE.Vector2(0.001, -0.142),
  ];
  const basinWellGeo = prepGeo(new THREE.LatheGeometry(basinWellPts, 24));

  for (const [bIdx, bz] of [[1, -0.56], [2, 0.56]] as const) {
    const basin = new THREE.Mesh(basinWellGeo, mcm.porcelainWhite);
    basin.position.set(0.03, vSurfY, bz);
    basin.scale.set(1.0, 1.0, 1.34);
    const chromeDrain = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.026, 0.026, 0.005, 14)), mcm.polishedChrome);
    chromeDrain.position.set(0.03, vSurfY - 0.14, bz);
    vanity.add(basin, chromeDrain);

    const bTap = new THREE.Group();
    bTap.name = `stahl.bath.vanityTap_${bIdx}`;
    bTap.position.set(-0.185, vSurfY + 0.002, bz);
    const base = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.045, 0.014, 0.15)), mcm.polishedChrome);
    base.position.y = 0.007;
    const body = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.012, 0.015, 0.085, 12)), mcm.polishedChrome);
    body.position.y = 0.048;
    const spout = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.008, 0.009, 0.13, 12)), mcm.polishedChrome);
    spout.rotation.z = -Math.PI * 0.42;
    spout.position.set(0.06, 0.082, 0);
    for (const hz of [-0.052, 0.052]) {
      const knob = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.013, 0.015, 0.028, 12)), mcm.polishedChrome);
      knob.position.set(0, 0.028, hz);
      bTap.add(knob);
    }
    const vStream = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.005, 0.007, 0.21, 10)),
      new THREE.MeshPhysicalMaterial({ color: 0xd8f3ff, transparent: true, opacity: 0.6, roughness: 0.05 })
    );
    vStream.position.set(0.115, -0.03, 0);
    vStream.visible = false;
    bTap.add(base, body, spout, vStream);

    attachAssetInteraction(bTap, {
      kind: 'toggle',
      id: `stahl-bath-vanity-tap-${bIdx}`,
      label: `Turn On Master Bath Basin Faucet ${bIdx}`,
      activeLabel: `Turn Off Master Bath Basin Faucet ${bIdx}`,
      onToggle: (active) => { vStream.visible = active; },
      audio: { openPreset: 'switchClick', activeLoopPreset: 'waterTapFlow', volume: 0.42 },
    });
    vanity.add(bTap);
  }

  // Stack of folded plush terry bath towels between the twin basins (`Z = 0`)
  for (const [ti, ty, tmat] of [
    [0, 0.018, mcm.pillowLinen],
    [1, 0.054, mcm.throwOchre],
    [2, 0.088, mcm.formicaAqua],
  ] as const) {
    const towel = new THREE.Mesh(
      prepGeo(createSculptedCushionGeometry(0.24 - ti * 0.01, 0.034, 0.32 - ti * 0.01, 8, 4, 8, 0.45, 'standard')),
      tmat
    );
    towel.position.set(0.02, vSurfY + ty, 0);
    vanity.add(towel);
  }

  // Full-Width Frameless Plate Mirror (`2.12 m x 1.06 m`) + Chrome & Opal-Glass Linear Vanity Bar Luminaire
  const mirrorBack = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.008, 1.06, 2.12)), mcm.dieCastAlum);
  mirrorBack.position.set(-vDepth * 0.5 + 0.006, 1.54, 0);
  const mirrorGlass = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.006, 1.04, 2.10)), mcm.plateMirror);
  mirrorGlass.position.set(-vDepth * 0.5 + 0.014, 1.54, 0);

  const barBackplate = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.024, 0.056, 2.04)), mcm.polishedChrome);
  barBackplate.position.set(-vDepth * 0.5 + 0.018, 2.15, 0);
  const barDiffuserMat = new THREE.MeshStandardMaterial({ color: 0xfffcf4, emissive: new THREE.Color(0xffe9c4), emissiveIntensity: 1.4, roughness: 0.28 });
  const barDiffuser = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.024, 0.024, 1.98, 16)), barDiffuserMat);
  barDiffuser.rotation.x = Math.PI * 0.5;
  barDiffuser.position.set(-vDepth * 0.5 + 0.052, 2.15, 0);
  vanity.add(mirrorBack, mirrorGlass, barBackplate, barDiffuser);

  const bathLightGrp = (ctx.lightGroups as Record<string, LightCircuitGroup>).stahlBathVanity;
  if (bathLightGrp) bathLightGrp.emissives.push(barDiffuserMat);

  attachAssetMetadata(vanity, {
    name: 'Koenig Floating Walnut & White Formica Double-Basin Master Vanity & Plate Mirror', brand: 'Arcware / Formica / American Standard', collection: 'Case Study House #22 Master Bath (1960)',
    sku: 'CSH22-VAN-2160', finish: 'Book-Matched American Walnut, Crisp White Formica, Vitreous China & Chrome', category: 'sanitaryware', dimensionsMm: [2160, 560, 2180],
  });
  bath.add(vanity);

  // C. LOW-PROFILE 1960 ONE-PIECE WHITE CERAMIC WC (`East wall`, `Z = -3.35`)
  // Half-height walnut privacy screen separating WC from shower threshold (`Z = -3.86`)
  const wcScreen = new THREE.Mesh(metricBox(0.58, 1.18, 0.032, 0.7, 0.7), mcm.walnut);
  wcScreen.position.set(-5.05, 0.594, -3.86);
  bath.add(wcScreen);

  const wc = new THREE.Group();
  wc.name = 'stahl.bath.midCenturyWc';
  wc.position.set(-5.08, 0.004, -3.32); // Against East wall (`X = -4.76`), extending `-X` to `-5.45`

  // Sculpted 1960 American Standard one-piece low-boy vitreous china pedestal, elongated bowl & low tank
  const wcPedestal = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.13, 0.145, 0.24, 18)), mcm.porcelainWhite);
  wcPedestal.scale.set(1.35, 1, 0.92);
  wcPedestal.position.set(-0.03, 0.12, 0);

  const wcBowl = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.195, 0.135, 0.18, 22)), mcm.porcelainWhite);
  wcBowl.scale.set(1.38, 1, 0.96);
  wcBowl.position.set(-0.07, 0.30, 0);
  wcBowl.castShadow = true;

  const wcSeatLid = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.198, 0.198, 0.024, 22)), mcm.porcelainWhite);
  wcSeatLid.scale.set(1.36, 1, 0.95);
  wcSeatLid.position.set(-0.08, 0.404, 0);

  // Signature 1960 low-profile integrated tank (`top Y = 0.62 m`) + chrome side trip lever
  const wcTank = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.21, 0.36, 0.48)), mcm.porcelainWhite);
  wcTank.position.set(0.20, 0.42, 0);
  wcTank.castShadow = true;
  const wcTankLid = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.224, 0.024, 0.494)), mcm.porcelainWhite);
  wcTankLid.position.set(0.20, 0.613, 0);

  const flushHandle = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.018, 0.018, 0.068)), mcm.polishedChrome);
  flushHandle.position.set(0.088, 0.55, 0.16);
  wc.add(wcPedestal, wcBowl, wcSeatLid, wcTank, wcTankLid, flushHandle);

  attachAssetInteraction(wc, {
    kind: 'toggle',
    id: 'stahl-bath-wc-flush',
    label: 'Flush Mid-Century One-Piece WC',
    activeLabel: 'Reset WC Cistern',
    onToggle: (active) => { flushHandle.rotation.z = active ? 0.38 : 0; },
    audio: { openPreset: 'cisternFlush', volume: 0.6 },
  });

  attachAssetMetadata(wc, {
    name: 'American Standard Master One-Piece Low-Profile Vitreous China Water Closet (1960)', brand: 'American-Standard', collection: 'Case Study House #22 Sanitaryware Specification',
    sku: 'AS-2000-1PC-WHT', finish: 'Glazed White Vitreous China & Polished Chrome Trip Lever', category: 'sanitaryware', dimensionsMm: [690, 495, 625],
  });
  bath.add(wc);

  parent.add(bath);
}
