import * as THREE from 'three';
import type { CircuitId, InteractiveUserData, RoomZoneId } from 'husjs';
import { createPaintMaterial } from 'husjs/materials';
import {
  attachAssetInteraction,
  attachAssetMetadata,
  attachAudioEmitter,
  buildCastIronColumnRadiator,
  buildCorstonPowerSocket,
  buildCorstonToggleSwitch,
  prepGeo,
  tagCollisionRole,
  tagCutaway,
} from 'husjs/objects';
import {
  buildNeptuneInFrameCabinetRun,
  buildNeptuneLarderPantry,
  buildPaintedCorbelKitchenShelf,
  buildShawsBelfastSinkAndBridgeTap,
  createHandmadeCreamMetroTileMaterial,
} from 'husjs/catalog/architectural';
import {
  buildCuratedMirrorsArtAndRugs,
  buildFiddleLeafFigPlanter,
  buildNeptuneArmchair,
  buildNeptuneArundelDiningSet,
  buildNeptuneOakTablesAndBedsides,
  buildNeptuneUpholsteredSofa,
  buildWhiteCompanyAccessories,
} from 'husjs/catalog/furniture';
import { buildHeritageInteriorLighting } from 'husjs/catalog/lighting';
import { getHonedCarraraMarbleMaterial } from 'husjs/catalog/sanitaryware';
import type { SceneBuilderContext } from 'husjs/viewer';
import { addFlatBox } from './grounds-and-openings.ts';
import type { SimpleFlatShell } from './architecture.ts';
import { BATH_HALL_X, BED_BATH_Z, IN_X, IN_Z, INT_T, SPINE_EAST_X, WALL_H } from './electrical-and-rooms.ts';
const FB_PIGEON_HEX = 0x969b90;

export function buildLinenCurtainPair(
  name: string,
  centerX: number,
  spanW: number,
  topY: number,
  bottomY: number,
  wallZ: number,
  inwardSignZ: 1 | -1,
  brassMat: THREE.Material,
  curtainMat: THREE.Material
): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  const poleLen = spanW + 0.36;
  const poleZ = wallZ + inwardSignZ * 0.075;
  const pole = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.015, 0.015, poleLen, 16)), brassMat);
  pole.name = `${name}.pole`;
  pole.rotation.z = Math.PI / 2;
  pole.position.set(centerX, topY, poleZ);
  g.add(pole);
  const dropH = topY - bottomY - 0.025;
  const midY = bottomY + dropH * 0.5 + 0.005;
  for (const [sideTag, sx] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    const stack = new THREE.Group();
    stack.name = `${name}.stack${sideTag}`;
    const baseCx = centerX + sx * (spanW * 0.5 + 0.06);
    for (let f = 0; f < 4; f++) {
      // Radius 0.026 m with 0.058 m center spacing -> 6 mm air gap between adjacent pleats (0 z-fighting!)
      const fold = new THREE.Mesh(
        prepGeo(new THREE.CylinderGeometry(0.024, 0.027, dropH, 14)),
        curtainMat
      );
      fold.name = `${name}.fold_${sideTag}_${f + 1}`;
      fold.position.set(baseCx + (f - 1.5) * 0.058, midY, poleZ + inwardSignZ * ((f % 2) * 0.008));
      fold.castShadow = true;
      stack.add(fold);
    }
    tagCollisionRole(stack, 'ignore');
    g.add(stack);
  }
  return g;
}

export function buildLivingKitchenAndHallInteriors(
  ctx: SceneBuilderContext,
  shell: SimpleFlatShell
): void {
  const floorGroup = ctx.floor ? ctx.floor('level-0').group : ctx.scene;
  const hallGroup = new THREE.Group();
  hallGroup.name = 'simpleFlat.zone.flatHall';
  hallGroup.userData.zoneId = 'flatHall';
  floorGroup.add(hallGroup);
  const livGroup = new THREE.Group();
  livGroup.name = 'simpleFlat.zone.flatLivingKitchen';
  livGroup.userData.zoneId = 'flatLivingKitchen';
  floorGroup.add(livGroup);
  const carraraMat = getHonedCarraraMarbleMaterial();
  const zelligeTileMat = createHandmadeCreamMetroTileMaterial();
  const shakerJoineryPaint = createPaintMaterial({
    color: 'farrow-ball:pigeon',
    sheen: 'estate-eggshell',
  });
  const curtainMat = new THREE.MeshStandardMaterial({
    name: 'simpleFlat.living.linenDrapery',
    color: 0xddd3c1,
    roughness: 0.9,
  });

  // =========================================================================
  // 1. ENTRANCE HALL (`flatHall`: `x in [-2.14, -0.66], z in [1.16, 3.388]`)
  // =========================================================================
  const hallRunner = buildCuratedMirrorsArtAndRugs({
    name: 'simpleFlat.hall.runnerRug',
    kind: 'rogerOatesRunnerSwatch',
    widthM: 0.82,
    lengthM: 1.78,
    position: [-1.46, 0.002, 2.26],
    rotationY: 0,
  });
  tagCollisionRole(hallRunner, 'ignore');
  hallGroup.add(hallRunner);
  const pegConsole = new THREE.Group();
  pegConsole.name = 'simpleFlat.hall.shakerPegConsole';
  pegConsole.position.set(BATH_HALL_X + INT_T * 0.5 + 0.002, 0, 2.8);
  addFlatBox(pegConsole, 'simpleFlat.hall.consoleShelf', [0.18, 0.028, 0.84], [0.098, 0.86, 0], shell.oakJoineryMat);
  addFlatBox(pegConsole, 'simpleFlat.hall.consoleBackRail', [0.018, 0.095, 0.86], [0.01, 0.795, 0], shakerJoineryPaint);
  addFlatBox(pegConsole, 'simpleFlat.hall.corbelL', [0.13, 0.13, 0.026], [0.088, 0.78, -0.34], shakerJoineryPaint);
  addFlatBox(pegConsole, 'simpleFlat.hall.corbelR', [0.13, 0.13, 0.026], [0.088, 0.78, 0.34], shakerJoineryPaint);
  const keyBowl = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.068, 0.044, 0.032, 20)),
    shell.brassMats.primary
  );
  keyBowl.name = 'simpleFlat.hall.brassKeyBowl';
  keyBowl.position.set(0.104, 0.892, -0.18);
  pegConsole.add(keyBowl);
  const hallDiffuser = buildWhiteCompanyAccessories({
    name: 'simpleFlat.hall.reedDiffuser',
    kind: 'reedDiffuser',
    scent: 'seychelles',
    position: [0.104, 0.876, 0.2],
  });
  pegConsole.add(hallDiffuser);

  // Upper Shaker coat-hook peg rail at `y = 1.84` (cleanly above arched mirror `y in [1.02, 1.68]`)
  addFlatBox(pegConsole, 'simpleFlat.hall.coatRailBoard', [0.018, 0.084, 0.84], [0.01, 1.84, 0], shakerJoineryPaint);
  for (let i = 0; i < 4; i++) {
    const hz = -0.3 + i * 0.2;
    addFlatBox(pegConsole, `simpleFlat.hall.coatHookStem_${i + 1}`, [0.052, 0.012, 0.012], [0.048, 1.84, hz], shell.brassMats.primary);
    const tip = new THREE.Mesh(prepGeo(new THREE.SphereGeometry(0.011, 10, 8)), shell.brassMats.primary);
    tip.name = `simpleFlat.hall.coatHookTip_${i + 1}`;
    tip.position.set(0.078, 1.848, hz);
    pegConsole.add(tip);
  }
  attachAssetMetadata(pegConsole, {
    name: 'Shaker Entrance Console Shelf & Brass Coat Rail',
    brand: 'Neptune',
    collection: 'Chichester',
    finish: 'Farrow & Ball Pigeon No. 25 / Character Oak / Aged Brass',
    category: 'joinery',
    dimensionsMm: [860, 185, 1880],
  });
  hallGroup.add(pegConsole);
  const hallMirror = buildCuratedMirrorsArtAndRugs({
    name: 'simpleFlat.hall.archedMirror',
    kind: 'coxArchedBrass',
    widthM: 0.54,
    heightM: 0.66,
    position: [BATH_HALL_X + INT_T * 0.5 + 0.004, 1.02, 2.8],
    rotationY: Math.PI / 2,
  });
  hallGroup.add(hallMirror);
  const hallLantern = buildHeritageInteriorLighting(ctx, {
    name: 'simpleFlat.hall.bellJarLantern',
    kind: 'hallLantern',
    position: [-1.46, WALL_H - 0.04, 2.28],
    dropM: 0.42,
    circuitId: 'flatHallPendant' as CircuitId,
    createPointLight: true,
    pointLightIntensity: 2.0,
  });
  hallGroup.add(hallLantern);
  const hallEntrySwitchIds: Record<number, string> = {
    1: 'sw-hall-entry',
    2: 'sw-entry-lantern',
  };
  buildCorstonToggleSwitch(ctx, {
    name: 'flat.sw.hallEntry',
    switchPa: 'plate-hall-entry',
    location: 'Entrance door jamb',
    x: -0.89,
    y: 1.15,
    z: IN_Z - 0.013,
    facing: 'north',
    mountedInZoneId: 'flatHall' as RoomZoneId,
    parentGroup: hallGroup,
    cutawayWall: shell.southCut,
    extraUserDataForGang: (gang): InteractiveUserData => ({
      electricalSwitchId: hallEntrySwitchIds[gang],
    }),
    gangs: [
      { gang: 1, zoneId: 'flatHall' as RoomZoneId, label: 'Hallway Lantern (2-Way)', circuitId: 'flatHallPendant' as CircuitId },
      { gang: 2, zoneId: 'flatHall' as RoomZoneId, label: 'Courtyard Coach Lantern', circuitId: 'flatEntryLantern' as CircuitId },
    ],
  });

  buildCorstonToggleSwitch(ctx, {
    name: 'flat.sw.hallInner',
    switchPa: 'plate-hall-inner',
    location: 'Inner hall by bedroom door',
    x: -0.842,
    y: 1.15,
    z: BED_BATH_Z + INT_T * 0.5 + 0.001,
    facing: 'south',
    mountedInZoneId: 'flatHall' as RoomZoneId,
    parentGroup: hallGroup,
    extraUserDataForGang: (): InteractiveUserData => ({ electricalSwitchId: 'sw-hall-inner' }),
    gangs: [
      { gang: 1, zoneId: 'flatHall' as RoomZoneId, label: 'Hallway Lantern (2-Way)', circuitId: 'flatHallPendant' as CircuitId },
    ],
  });

  buildCorstonToggleSwitch(ctx, {
    name: 'flat.sw.bathroomOutside',
    switchPa: 'plate-bathroom',
    location: 'Hallway outside shower room',
    x: BATH_HALL_X + INT_T * 0.5 + 0.001,
    y: 1.15,
    z: 2.34,
    facing: 'east',
    mountedInZoneId: 'flatHall' as RoomZoneId,
    parentGroup: hallGroup,
    extraUserDataForGang: (): InteractiveUserData => ({ electricalSwitchId: 'sw-bathroom' }),
    gangs: [
      { gang: 1, zoneId: 'flatBathroom' as RoomZoneId, label: 'Shower Room Vanity Sconces', circuitId: 'flatBathroomSpots' as CircuitId },
    ],
  });

  // =========================================================================
  // 2. CHICHESTER IN-FRAME SHAKER KITCHEN & DINING (`flatLivingKitchen`)
  // =========================================================================
  const splashBelowWin = addFlatBox(
    livGroup,
    'simpleFlat.kitchen.zelligeSplashUnderWindow',
    [3.24, 0.11, 0.012],
    [2.3, 0.96, -IN_Z + 0.019],
    zelligeTileMat,
    0.75
  );
  const splashRightPier = addFlatBox(
    livGroup,
    'simpleFlat.kitchen.zelligeSplashRightPier',
    [1.15, 0.53, 0.012],
    [3.345, 1.286, -IN_Z + 0.019],
    zelligeTileMat,
    0.75
  );
  tagCutaway(splashBelowWin, shell.northCut);
  tagCutaway(splashRightPier, shell.northCut);
  const larder = buildNeptuneLarderPantry(ctx, {
    name: 'simpleFlat.kitchen.chichesterLarder',
    paintColor: FB_PIGEON_HEX,
    widthM: 1.1,
    depthM: 0.62,
    heightM: 2.24,
    hardwareFinish: 'SB',
    position: [0.072, 0.001, -3.07],
    rotationY: 0,
  });
  attachAudioEmitter(larder, {
    kind: 'continuous',
    preset: 'fridgeHum',
    volume: 0.18,
    refDistance: 1.2,
    maxDistance: 6,
  });
  tagCutaway(larder, shell.northCut);
  livGroup.add(larder);

  // Adjacent Shaker cabinet runs separated by 6 mm clearance -> zero frameStile coplanarity!
  const baseLeft = buildNeptuneInFrameCabinetRun(ctx, {
    name: 'simpleFlat.kitchen.baseLeft',
    collection: 'chichester',
    elevation: 'base',
    paintColor: FB_PIGEON_HEX,
    worktopMaterial: 'carrara',
    hardwareFinish: 'SB',
    bays: [{ kind: 'drawerBank3', widthM: 0.72 }],
    position: [1.015, 0.001, -3.08],
    rotationY: 0,
  });
  const hobGlassMat = new THREE.MeshStandardMaterial({
    name: 'simpleFlat.kitchen.inductionHobGlass',
    color: 0x151719,
    roughness: 0.12,
    metalness: 0.25,
  });
  const hobPlate = addFlatBox(livGroup, 'simpleFlat.kitchen.inductionHob', [0.56, 0.006, 0.48], [1.032, 0.906, -3.08], hobGlassMat);
  for (const [ri, rx, rz] of [
    [1, 0.902, -3.19],
    [2, 1.162, -3.19],
    [3, 0.902, -2.97],
    [4, 1.162, -2.97],
  ] as const) {
    const ring = new THREE.Mesh(
      prepGeo(new THREE.RingGeometry(0.064, 0.072, 24)),
      shell.brassMats.primary
    );
    ring.name = `simpleFlat.kitchen.hobZone_${ri}`;
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(rx, 0.911, rz);
    livGroup.add(ring);
    tagCutaway(ring, shell.northCut);
  }
  tagCutaway(baseLeft, shell.northCut);
  tagCutaway(hobPlate, shell.northCut);
  livGroup.add(baseLeft);
  const sinkUnder = buildNeptuneInFrameCabinetRun(ctx, {
    name: 'simpleFlat.kitchen.sinkUnderCabinet',
    collection: 'chichester',
    elevation: 'base',
    paintColor: FB_PIGEON_HEX,
    heightM: 0.67,
    depthM: 0.58,
    includeMarbleWorktop: false,
    includeUpstand: false,
    hardwareFinish: 'SB',
    bays: [{ kind: 'doubleDoor', widthM: 0.8 }],
    position: [1.8, 0.001, -3.09],
    rotationY: 0,
  });
  const belfastSink = buildShawsBelfastSinkAndBridgeTap({
    name: 'simpleFlat.kitchen.shawsBelfastSink',
    includeCarraraDrainerDeck: false,
    includeRinseSpray: true,
    position: [1.8, 0.672, -3.04],
    rotationY: 0,
  });
  attachAssetInteraction(belfastSink, {
    id: 'flat.kitchen.belfastTap',
    kind: 'toggle',
    label: 'Turn On Kitchen Bridge Mixer',
    activeLabel: 'Turn Off Kitchen Bridge Mixer',
    audio: { activeLoopPreset: 'waterTapFlow', volume: 0.45 },
  });
  tagCutaway(sinkUnder, shell.northCut);
  tagCutaway(belfastSink, shell.northCut);
  livGroup.add(sinkUnder, belfastSink);
  const baseRight = buildNeptuneInFrameCabinetRun(ctx, {
    name: 'simpleFlat.kitchen.baseRight',
    collection: 'chichester',
    elevation: 'base',
    paintColor: FB_PIGEON_HEX,
    worktopMaterial: 'carrara',
    hardwareFinish: 'SB',
    bays: [
      { kind: 'integratedDishwasher', widthM: 0.6 },
      { kind: 'drawerBank3', widthM: 1.12 },
    ],
    position: [3.085, 0.001, -3.08],
    rotationY: 0,
  });
  tagCutaway(baseRight, shell.northCut);
  livGroup.add(baseRight);

  // Clean zero-z-fight brushed stainless & brass Italian Espresso Station (`espressoExtract` interactive!)
  const espresso = new THREE.Group();
  espresso.name = 'simpleFlat.kitchen.espressoStation';
  espresso.position.set(3.46, 0.904, -3.06);
  const steelMat = new THREE.MeshStandardMaterial({
    name: 'simpleFlat.kitchen.brushedSteel',
    color: 0xc8ccd0,
    roughness: 0.26,
    metalness: 0.85,
  });
  const darkTrimMat = new THREE.MeshStandardMaterial({
    name: 'simpleFlat.kitchen.espressoDark',
    color: 0x1c1e21,
    roughness: 0.42,
  });
  addFlatBox(espresso, 'simpleFlat.kitchen.espresso.dripBase', [0.29, 0.036, 0.3], [0, 0.019, 0], steelMat);
  addFlatBox(espresso, 'simpleFlat.kitchen.espresso.dripGrate', [0.23, 0.004, 0.092], [0, 0.041, 0.092], darkTrimMat);
  addFlatBox(espresso, 'simpleFlat.kitchen.espresso.towerBody', [0.268, 0.22, 0.184], [0, 0.148, -0.052], steelMat);
  addFlatBox(espresso, 'simpleFlat.kitchen.espresso.upperHead', [0.28, 0.075, 0.28], [0, 0.295, -0.002], steelMat);
  const hopper = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.068, 0.048, 0.076, 18)), darkTrimMat);
  hopper.name = 'simpleFlat.kitchen.espresso.beanHopper';
  hopper.position.set(-0.055, 0.374, -0.02);
  espresso.add(hopper);
  const groupHead = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.036, 0.034, 0.034, 16)), shell.brassMats.primary);
  groupHead.name = 'simpleFlat.kitchen.espresso.groupHead';
  groupHead.position.set(0, 0.238, 0.075);
  espresso.add(groupHead);
  addFlatBox(espresso, 'simpleFlat.kitchen.espresso.portafilterHandle', [0.018, 0.018, 0.11], [0, 0.228, 0.145], darkTrimMat);
  const gauge = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.022, 0.022, 0.008, 16)), shell.brassMats.primary);
  gauge.name = 'simpleFlat.kitchen.espresso.pressureGauge';
  gauge.rotation.x = Math.PI / 2;
  gauge.position.set(0.075, 0.295, 0.144);
  espresso.add(gauge);
  attachAssetMetadata(espresso, {
    name: 'Sage Barista Express Brushed-Steel Espresso Machine',
    brand: 'Sage Appliances',
    sku: 'BES875UK',
    finish: 'Brushed Stainless Steel & Aged Brass',
    category: 'appliance',
    dimensionsMm: [310, 330, 410],
  });
  attachAssetInteraction(espresso, {
    id: 'flat.kitchen.espresso',
    kind: 'toggle',
    label: 'Pull Espresso Shot',
    activeLabel: 'Stop Extraction',
    audio: { openPreset: 'espressoExtract', volume: 0.45 },
  });
  tagCutaway(espresso, shell.northCut);
  livGroup.add(espresso);

  // Painted corbelled crockery shelf on solid North-East pier (`x = 3.36, y = 1.58`, clear of window `x <= 2.75`!)
  // with integrated warm 2700K LED under-shelf task strip (`flatKitchenTask`) — NEVER floating across window glass!
  const corbelShelf = buildPaintedCorbelKitchenShelf({
    name: 'simpleFlat.kitchen.corbelCrockeryShelf',
    widthM: 1.1,
    paintColor: FB_PIGEON_HEX,
    position: [3.36, 1.58, -IN_Z + 0.026],
    rotationY: 0,
  });
  const taskStripMat = new THREE.MeshStandardMaterial({
    name: 'simpleFlat.kitchen.taskLedMat',
    color: 0xfff5e4,
    emissive: new THREE.Color(0xffbe73),
    emissiveIntensity: 0,
    roughness: 0.28,
  });
  const taskStripBar = addFlatBox(
    livGroup,
    'flat.kitchen.taskStrip',
    [0.92, 0.012, 0.024],
    [3.36, 1.564, -3.22],
    taskStripMat
  );
  const taskLight = new THREE.PointLight(0xffcb8a, 0, 3.8, 2);
  taskLight.position.set(3.36, 1.51, -3.14);
  livGroup.add(taskLight);
  const kitCircuit = ctx.lightGroups['flatKitchenTask' as CircuitId];
  if (kitCircuit) {
    kitCircuit.lights.push(taskLight);
    kitCircuit.emissives.push(taskStripMat);
  }
  tagCutaway(corbelShelf, shell.northCut);
  tagCutaway(taskStripBar, shell.northCut);
  livGroup.add(corbelShelf);

  buildCorstonToggleSwitch(ctx, {
    name: 'flat.sw.kitchenTask',
    switchPa: 'plate-kitchen-task',
    location: 'Kitchen splashback right',
    x: 2.92,
    y: 1.14,
    z: -IN_Z + 0.034,
    facing: 'south',
    mountedInZoneId: 'flatLivingKitchen' as RoomZoneId,
    parentGroup: livGroup,
    cutawayWall: shell.northCut,
    extraUserDataForGang: (): InteractiveUserData => ({ electricalSwitchId: 'sw-kitchen-task' }),
    gangs: [
      { gang: 1, zoneId: 'flatLivingKitchen' as RoomZoneId, label: 'Under-Shelf Task LED', circuitId: 'flatKitchenTask' as CircuitId },
    ],
  });
  livGroup.add(
    buildCorstonPowerSocket(ctx, tagCutaway, {
      name: 'flat.sock.kitchenSplash',
      zone: 'flatLivingKitchen' as RoomZoneId,
      kind: 'double',
      x: 3.16,
      y: 1.14,
      z: -IN_Z + 0.034,
      facing: 'south',
      cutawayWall: shell.northCut,
    })
  );

  // Café-style brass pole & linen side curtains framing North kitchen window
  const kitCurtains = buildLinenCurtainPair(
    'simpleFlat.kitchen.windowCurtains',
    1.775,
    1.95,
    2.36,
    0.96,
    -IN_Z + 0.015,
    1,
    shell.brassMats.primary,
    curtainMat
  );
  tagCutaway(kitCurtains, shell.northCut);
  livGroup.add(kitCurtains);

  // Neptune Arundel Character Oak dining table (`tableLengthM = 1.90` so trestle foot bearers have generous clearance around all 6 chairs!)
  const diningSet = buildNeptuneArundelDiningSet({
    name: 'simpleFlat.dining.arundelSet',
    tableLengthM: 1.88,
    tableWidthM: 0.88,
    chairStyle: 'wardley',
    includeChairs: true,
    interactions: ctx.interactions,
    position: [0.65, 0, -0.55],
    rotationY: 0,
  });
  livGroup.add(diningSet);
  const diningPendant = buildHeritageInteriorLighting(ctx, {
    name: 'simpleFlat.dining.saucerPendant',
    kind: 'spunBrassSaucerPendant',
    position: [0.65, WALL_H - 0.04, -0.55],
    dropM: 0.68,
    circuitId: 'flatLivingPendants' as CircuitId,
    createPointLight: false,
  });
  livGroup.add(diningPendant);

  // =========================================================================
  // 3. LIVING LOUNGE (`x in [1.45, 4.18], z in [0.55, 3.38]`)
  // =========================================================================
  const livingRug = buildCuratedMirrorsArtAndRugs({
    name: 'simpleFlat.living.oushakRug',
    kind: 'zieglerOushak',
    widthM: 2.55,
    lengthM: 2.0,
    position: [2.62, 0.002, 1.88],
    rotationY: 0,
  });
  tagCollisionRole(livingRug, 'ignore');
  livGroup.add(livingRug);
  const sofa = buildNeptuneUpholsteredSofa({
    name: 'simpleFlat.living.georgeSofa',
    model: 'george',
    fabricColor: 0xd9d1c3,
    position: [2.62, 0, 1.32],
    rotationY: 0,
    interactions: ctx.interactions,
  });
  livGroup.add(sofa);
  const coffeeTable = buildNeptuneOakTablesAndBedsides({
    name: 'simpleFlat.living.henleyCoffeeTable',
    kind: 'henleyCoffeeTable',
    position: [2.62, 0, 2.28],
    rotationY: 0,
  });
  livGroup.add(coffeeTable);
  const armchair = buildNeptuneArmchair({
    name: 'simpleFlat.living.caseyArmchair',
    model: 'casey',
    fabricColor: 0x7d8573,
    position: [3.64, 0, 2.38],
    rotationY: -2.35,
    interactions: ctx.interactions,
  });
  livGroup.add(armchair);

  // Bespoke Shaker bookcase with 3 mm non-overlapping joinery clearances (`0` z-fight!)
  const bookcase = new THREE.Group();
  bookcase.name = 'simpleFlat.living.bespokeBookcase';
  bookcase.position.set(3.55, 0, IN_Z - 0.195);
  addFlatBox(bookcase, 'simpleFlat.living.bookcase.plinth', [1.0, 0.084, 0.34], [0, 0.043, 0], shakerJoineryPaint);
  addFlatBox(bookcase, 'simpleFlat.living.bookcase.carcassLow', [1.02, 0.616, 0.36], [0, 0.396, 0], shakerJoineryPaint);
  addFlatBox(bookcase, 'simpleFlat.living.bookcase.carraraDeck', [1.05, 0.026, 0.38], [0, 0.72, -0.008], carraraMat, 0.9);
  addFlatBox(bookcase, 'simpleFlat.living.bookcase.upperBack', [0.972, 1.474, 0.018], [0, 1.474, 0.162], shakerJoineryPaint);
  addFlatBox(bookcase, 'simpleFlat.living.bookcase.sideL', [0.028, 1.474, 0.296], [-0.504, 1.474, 0.002], shakerJoineryPaint);
  addFlatBox(bookcase, 'simpleFlat.living.bookcase.sideR', [0.028, 1.474, 0.296], [0.504, 1.474, 0.002], shakerJoineryPaint);
  addFlatBox(bookcase, 'simpleFlat.living.bookcase.crown', [1.08, 0.054, 0.34], [0, 2.242, 0.005], shakerJoineryPaint);
  for (const [si, sy] of [
    [1, 1.15],
    [2, 1.56],
    [3, 1.95],
  ] as const) {
    addFlatBox(bookcase, `simpleFlat.living.bookcase.shelf_${si}`, [0.972, 0.024, 0.28], [0, sy, 0.002], shell.oakJoineryMat);
    for (let b = 0; b < 5; b++) {
      const bookMat = new THREE.MeshStandardMaterial({
        color: [0x7a3e2e, 0x3b4d3e, 0xc8bca8, 0x2c3b4d, 0x8d6e4a][(si + b) % 5]!,
        roughness: 0.78,
      });
      addFlatBox(
        bookcase,
        `simpleFlat.living.bookcase.book_${si}_${b + 1}`,
        [0.032, 0.21 + (b % 3) * 0.022, 0.18],
        [-0.36 + b * 0.042 + (si % 2) * 0.26, sy + 0.12 + (b % 3) * 0.011, -0.02],
        bookMat
      );
    }
  }
  attachAssetMetadata(bookcase, {
    name: 'Bespoke Shaker Library & Media Cabinet',
    brand: 'Neptune',
    collection: 'Chichester',
    finish: 'Farrow & Ball Pigeon No. 25 / Honed Carrara / Character Oak',
    category: 'joinery',
    dimensionsMm: [1050, 380, 2270],
  });
  tagCutaway(bookcase, shell.southCut);
  livGroup.add(bookcase);
  const julietCurtains = buildLinenCurtainPair(
    'simpleFlat.living.julietCurtains',
    1.75,
    1.84,
    2.48,
    0.01,
    IN_Z - 0.015,
    -1,
    shell.brassMats.primary,
    curtainMat
  );
  tagCutaway(julietCurtains, shell.southCut);
  livGroup.add(julietCurtains);
  const figTree = buildFiddleLeafFigPlanter(livGroup, {
    namePrefix: 'simpleFlat.living.fiddleLeafFig',
    zone: 'flatLivingKitchen',
    position: [3.74, 0, -2.05],
  });
  tagCutaway(figTree, shell.eastCut);
  const galleryArt = buildCuratedMirrorsArtAndRugs({
    name: 'simpleFlat.living.constablePainting',
    kind: 'constableLandscapeOil',
    widthM: 1.08,
    heightM: 0.78,
    position: [SPINE_EAST_X + 0.002, 1.54, 0.35],
    rotationY: Math.PI / 2,
  });
  livGroup.add(galleryArt);
  const livingRad = buildCastIronColumnRadiator({
    name: 'flat.living.radiator',
    zone: 'flatLivingKitchen' as RoomZoneId,
    cx: IN_X - 0.115,
    cz: -1.86,
    floorY: 0,
    width: 0.92,
    height: 0.66,
    rotationY: 0,
    brassMat: shell.brassMats.primary,
    cutawayDesc: shell.eastCut,
    tagCutawayWall: tagCutaway,
  });
  livGroup.add(livingRad);
  const livingChandelier = buildHeritageInteriorLighting(ctx, {
    name: 'simpleFlat.living.chandelier',
    kind: 'chandelier6Arm',
    position: [2.65, WALL_H - 0.04, 1.45],
    dropM: 0.54,
    circuitId: 'flatLivingPendants' as CircuitId,
    createPointLight: true,
    pointLightIntensity: 2.8,
  });
  livGroup.add(livingChandelier);
  const dimmerGroup = new THREE.Group();
  dimmerGroup.name = 'flat.dimmer.living';
  dimmerGroup.position.set(SPINE_EAST_X + 0.001, 1.15, 1.24);
  livGroup.add(dimmerGroup);
  addFlatBox(dimmerGroup, 'flat.dimmer.living.plate', [0.004, 0.088, 0.088], [0.002, 0, 0], shell.brassMats.primary);
  const dimmerKnob = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.019, 0.021, 0.02, 18)),
    shell.brassMats.knurled
  );
  dimmerKnob.name = 'flat.dimmer.living.knob';
  dimmerKnob.rotation.z = Math.PI * 0.5;
  dimmerKnob.position.set(0.015, 0, 0);
  dimmerKnob.userData = {
    electricalDimmerId: 'dimmer-living',
    zoneId: 'flatLivingKitchen',
  };
  ctx.interactiveMeshes.push(dimmerKnob);
  dimmerGroup.add(dimmerKnob);
  livGroup.add(
    buildCorstonPowerSocket(ctx, tagCutaway, {
      name: 'flat.sock.livingSpine',
      zone: 'flatLivingKitchen' as RoomZoneId,
      kind: 'double',
      x: SPINE_EAST_X + 0.001,
      y: 0.3,
      z: 0.45,
      facing: 'east',
    })
  );
}
