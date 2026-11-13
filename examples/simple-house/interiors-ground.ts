import * as THREE from 'three';
import type { CircuitId } from 'husjs';
import {
  applyMetricBoxUVs,
  createPaintMaterial,
} from 'husjs/materials';
import {
  buildCastIronColumnRadiator,
  buildTraditionalWindowCurtains,
  buildWindowRomanBlind,
  prepGeo,
  tagCutaway,
} from 'husjs/objects';
import {
  buildNeptuneInFrameCabinetRun,
  buildNeptuneLarderPantry,
  buildNeptuneOakPrepIslandTable,
  buildPaintedCorbelKitchenShelf,
  buildPlasterRangeChimneyBreast,
  buildShawsBelfastSinkAndBridgeTap,
  buildWovenCordOakCounterStool,
  getPaleEuropeanOakJoineryMaterial,
} from 'husjs/catalog/architectural';
import {
  buildNeptuneArundelDiningSet,
  buildNeptuneChichesterGlazedDresser,
} from 'husjs/catalog/furniture';
import { buildHeritageInteriorLighting } from 'husjs/catalog/lighting';
import {
  getBathroomBrassMaterials,
} from 'husjs/catalog/sanitaryware';
import {
  buildLacancheCluny1000Range,
} from 'husjs/catalog/appliances';
import type { SceneBuilderContext } from 'husjs/viewer';
import { IN_X, IN_Z, type SimpleHouseShell } from './architecture.ts';
import { FFL_GROUND, GROUND_CEILING_SOFFIT_Y } from './electrical-and-rooms.ts';

/** Farrow & Ball *Pigeon No. 25* (`#969B90`) calm heritage stone-sage cabinetry palette (`estate-eggshell` 20% sheen). */

import {
  FB_PIGEON_CABINETRY,
  addBox,
  applyEstateEggshellPaintToJoinery,
  buildFramedBotanicalStemPrint,
  deconflictCurtainBrackets,
  deconflictRomanBlind,
} from './interiors-ground-helpers.ts';

import { buildSimpleHouseGroundWestAndCloakroom } from './interiors-ground-west.ts';

export function buildSimpleHouseGroundInteriors(
  ctx: SceneBuilderContext,
  shell: SimpleHouseShell
): void {
  const groundGroup = ctx.floor ? ctx.floor('ground').group : ctx.scene;
  const groundCeilingGroup = ctx.floor
    ? ctx.floor('ground').ceilingGroup
    : ctx.groundFloorCeilingGroup;

  const root = new THREE.Group();
  root.name = 'simpleHouse.interiors.ground';
  groundGroup.add(root);

  const brassMats = getBathroomBrassMaterials('SB');
  const paleOakMat = getPaleEuropeanOakJoineryMaterial();
  const pigeonEggshellMat = createPaintMaterial({
    color: 'pigeon',
    sheen: 'estate-eggshell',
  });
  const darkOakMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.joinery.vintageWalnutOak',
    color: 0x4b3524,
    roughness: 0.52,
  });

  // =========================================================================
  // 1. East Wing — Neptune Olive-Moss, Pale Oak & Carrara Kitchen-Diner
  // =========================================================================
  const kitchenGroup = new THREE.Group();
  kitchenGroup.name = 'simpleHouse.kitchenDiner';
  kitchenGroup.userData.zoneId = 'houseKitchenDiner';
  root.add(kitchenGroup);

  const eastCut = shell.cut('east', 'ground');
  const northCut = shell.cut('north', 'ground');

  // East wall left of chimney breast: Olive-Moss Chichester drawer bank + 40 mm pale oak worktop & leaning vintage breadboards
  const eastBaseNorth = buildNeptuneInFrameCabinetRun(ctx, {
    name: 'simpleHouse.kitchen.eastBaseNorth',
    collection: 'chichester',
    elevation: 'base',
    paintColor: FB_PIGEON_CABINETRY,
    worktopMaterial: 'paleOak',
    hardwareStyle: 'knobOnly',
    bays: [{ kind: 'drawerBank3', widthM: 0.94 }],
    position: [5.112, FFL_GROUND + 0.001, -2.99],
    rotationY: -Math.PI / 2,
  });
  tagCutaway(eastBaseNorth, eastCut);

  // Two leaning vintage dark-oak chopping boards & turned pepper mill on left pale-oak worktop
  const boardLarge = addBox(
    kitchenGroup,
    'simpleHouse.kitchen.leaningOakBoardLarge',
    [0.022, 0.44, 0.32],
    [5.35, FFL_GROUND + 1.12, -2.86],
    darkOakMat
  );
  boardLarge.rotation.z = 0.1;
  const boardSmall = new THREE.Mesh(
    prepGeo(
      applyMetricBoxUVs(new THREE.BoxGeometry(0.02, 0.34, 0.25), {
        tileW: 0.9,
        tileH: 0.9,
        topTileV: 0.9,
      })
    ),
    paleOakMat
  );
  boardSmall.name = 'simpleHouse.kitchen.leaningOakBoardSmall';
  boardSmall.position.set(5.31, FFL_GROUND + 1.07, -2.92);
  boardSmall.castShadow = true;
  boardSmall.receiveShadow = true;
  kitchenGroup.add(boardSmall);
  boardSmall.rotation.z = 0.13;
  tagCutaway(boardLarge, eastCut);
  tagCutaway(boardSmall, eastCut);

  // Full-height lime-plaster range chimney breast w/ glossy handmade cream metro tile Inglenook & leaning stoneware platters
  const rangeChimneyBreast = buildPlasterRangeChimneyBreast({
    name: 'simpleHouse.kitchen.rangeChimneyBreast',
    widthM: 1.64,
    depthM: 0.66,
    ceilingHeightM: GROUND_CEILING_SOFFIT_Y,
    apertureWidthM: 1.04,
    apertureHeightM: 1.68,
    plasterMaterial: shell.schemes.houseKitchenDiner.walls,
    includeMantlePlatters: true,
    position: [5.412, FFL_GROUND + 0.001, -1.64],
    rotationY: -Math.PI / 2,
  });
  tagCutaway(rangeChimneyBreast, eastCut);

  // Ivory Lacanche Cluny 1000 Classic range cooker recessed inside the metro-tiled Inglenook
  const lacancheRange = buildLacancheCluny1000Range(ctx, {
    name: 'simpleHouse.kitchen.lacancheRange',
    finish: 'ivory',
    cookware: 'dutchOven',
    position: [5.07, FFL_GROUND + 0.001, -1.64],
    rotationY: -Math.PI / 2,
  });
  tagCutaway(lacancheRange, eastCut);

  // East wall right of chimney breast: Olive-Moss drawer cabinet + brushed-stainless espresso machine + framed botanical print
  const eastBaseMid = buildNeptuneInFrameCabinetRun(ctx, {
    name: 'simpleHouse.kitchen.eastBaseMid',
    collection: 'chichester',
    elevation: 'base',
    paintColor: FB_PIGEON_CABINETRY,
    worktopMaterial: 'paleOak',
    hardwareStyle: 'knobOnly',
    bays: [{ kind: 'drawerBank3', widthM: 0.46 }],
    position: [5.112, FFL_GROUND + 0.001, -0.56],
    rotationY: -Math.PI / 2,
  });
  tagCutaway(eastBaseMid, eastCut);

  const sageEspresso = new THREE.Group();
  sageEspresso.name = 'simpleHouse.kitchen.stainlessEspressoMachine';
  sageEspresso.position.set(5.11, FFL_GROUND + 0.902, -0.55);
  sageEspresso.rotation.y = -Math.PI / 2;
  const ssMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.kitchen.espressoStainless',
    color: 0xd8dce0,
    roughness: 0.24,
    metalness: 0.88,
  });
  const blackTrimMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.kitchen.espressoBlack',
    color: 0x1e2022,
    roughness: 0.45,
    metalness: 0.15,
  });
  const hopperMat = new THREE.MeshPhysicalMaterial({
    name: 'simpleHouse.kitchen.espressoHopper',
    color: 0x3b332c,
    roughness: 0.18,
    transmission: 0,
    transparent: true,
    opacity: 0.82,
  });
  addBox(sageEspresso, 'simpleHouse.kitchen.espressoMachine.dripTray', [0.31, 0.042, 0.30], [0, 0.021, 0.01], ssMat);
  addBox(sageEspresso, 'simpleHouse.kitchen.espressoMachine.dripGrille', [0.27, 0.004, 0.11], [0, 0.045, 0.085], blackTrimMat);
  addBox(sageEspresso, 'simpleHouse.kitchen.espressoMachine.tower', [0.305, 0.195, 0.185], [0, 0.141, -0.047], ssMat);
  addBox(sageEspresso, 'simpleHouse.kitchen.espressoMachine.controlHead', [0.31, 0.092, 0.275], [0, 0.286, -0.002], ssMat);
  const gaugeBezel = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.026, 0.026, 0.008, 24)), blackTrimMat);
  gaugeBezel.name = 'simpleHouse.kitchen.espressoMachine.pressureGauge';
  gaugeBezel.rotation.x = Math.PI / 2;
  gaugeBezel.position.set(0, 0.286, 0.139);
  sageEspresso.add(gaugeBezel);
  const groupHead = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.036, 0.034, 0.034, 20)), blackTrimMat);
  groupHead.name = 'simpleHouse.kitchen.espressoMachine.groupHead';
  groupHead.position.set(0.02, 0.221, 0.068);
  sageEspresso.add(groupHead);
  const portafilter = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.011, 0.009, 0.125, 14)), blackTrimMat);
  portafilter.name = 'simpleHouse.kitchen.espressoMachine.portafilterHandle';
  portafilter.rotation.x = Math.PI / 2;
  portafilter.rotation.z = -0.18;
  portafilter.position.set(0.032, 0.208, 0.136);
  sageEspresso.add(portafilter);
  const milkJug = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.036, 0.042, 0.092, 20)), ssMat);
  milkJug.name = 'simpleHouse.kitchen.espressoMachine.milkPitcher';
  milkJug.position.set(-0.078, 0.094, 0.078);
  milkJug.castShadow = true;
  sageEspresso.add(milkJug);
  const beanHopper = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.062, 0.044, 0.068, 24)), hopperMat);
  beanHopper.name = 'simpleHouse.kitchen.espressoMachine.beanHopper';
  beanHopper.position.set(-0.055, 0.368, -0.01);
  sageEspresso.add(beanHopper);
  const hopperLid = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.064, 0.064, 0.008, 24)), blackTrimMat);
  hopperLid.name = 'simpleHouse.kitchen.espressoMachine.hopperLid';
  hopperLid.position.set(-0.055, 0.407, -0.01);
  sageEspresso.add(hopperLid);
  tagCutaway(sageEspresso, eastCut);

  const botanicalPrint = buildFramedBotanicalStemPrint(
    'simpleHouse.kitchen.botanicalPrint',
    darkOakMat
  );
  botanicalPrint.position.set(5.408, FFL_GROUND + 1.48, -0.55);
  botanicalPrint.rotation.y = -Math.PI / 2;
  tagCutaway(botanicalPrint, eastCut);

  // Under-sink Olive-Moss double cupboard + Shaws fireclay Belfast apron sink & Perrin & Rowe Aged Brass bridge mixer
  const eastSinkUnder = buildNeptuneInFrameCabinetRun(ctx, {
    name: 'simpleHouse.kitchen.eastSinkUnderCabinet',
    collection: 'chichester',
    elevation: 'base',
    paintColor: FB_PIGEON_CABINETRY,
    heightM: 0.67,
    depthM: 0.58,
    includeMarbleWorktop: false,
    includeUpstand: false,
    hardwareStyle: 'knobOnly',
    bays: [{ kind: 'doubleDoor', widthM: 0.8 }],
    position: [5.122, FFL_GROUND + 0.001, 0.42],
    rotationY: -Math.PI / 2,
  });
  const belfastSink = buildShawsBelfastSinkAndBridgeTap({
    name: 'simpleHouse.kitchen.belfastSink',
    includeCarraraDrainerDeck: false,
    worktopMaterial: 'paleOak',
    includeRinseSpray: false,
    position: [5.055, FFL_GROUND + 0.669, 0.42],
    rotationY: -Math.PI / 2,
  });
  const sinkRearOakUpstand = new THREE.Mesh(
    prepGeo(
      applyMetricBoxUVs(new THREE.BoxGeometry(0.02, 0.075, 0.76), {
        tileW: 0.9,
        tileH: 0.9,
        topTileV: 0.9,
        rotY: Math.PI * 0.5,
      })
    ),
    paleOakMat
  );
  sinkRearOakUpstand.name = 'simpleHouse.kitchen.sinkRearOakUpstand';
  sinkRearOakUpstand.position.set(5.401, FFL_GROUND + 0.938, 0.42);
  sinkRearOakUpstand.castShadow = true;
  sinkRearOakUpstand.receiveShadow = true;
  kitchenGroup.add(sinkRearOakUpstand);
  for (const obj of [eastSinkUnder, belfastSink, sinkRearOakUpstand]) {
    tagCutaway(obj, eastCut);
  }

  const eastBaseSouth = buildNeptuneInFrameCabinetRun(ctx, {
    name: 'simpleHouse.kitchen.eastBaseSouth',
    collection: 'chichester',
    elevation: 'base',
    paintColor: FB_PIGEON_CABINETRY,
    worktopMaterial: 'paleOak',
    hardwareStyle: 'knobOnly',
    bays: [{ kind: 'singleDoor', widthM: 0.56, hingeSide: 'right' }],
    position: [5.112, FFL_GROUND + 0.001, 1.14],
    rotationY: -Math.PI / 2,
  });
  tagCutaway(eastBaseSouth, eastCut);

  // Open painted Olive-Moss corbelled shelf stacked w/ white fluted stoneware bowls, plates & glass pitcher
  const corbelShelf = buildPaintedCorbelKitchenShelf({
    name: 'simpleHouse.kitchen.oliveCorbelShelf',
    widthM: 1.38,
    paintColor: FB_PIGEON_CABINETRY,
    includeCrockery: true,
    position: [5.41, FFL_GROUND + 1.54, 0.72],
    rotationY: -Math.PI / 2,
  });
  tagCutaway(corbelShelf, eastCut);

  kitchenGroup.add(
    eastBaseNorth,
    rangeChimneyBreast,
    lacancheRange,
    eastBaseMid,
    sageEspresso,
    botanicalPrint,
    eastSinkUnder,
    belfastSink,
    eastBaseSouth,
    corbelShelf
  );

  // North under-window Olive-Moss Chichester prep & dishwasher run (`Z = -4.22`, pale oak worktop)
  const northWindowRun = buildNeptuneInFrameCabinetRun(ctx, {
    name: 'simpleHouse.kitchen.northWindowRun',
    collection: 'chichester',
    elevation: 'base',
    paintColor: FB_PIGEON_CABINETRY,
    worktopMaterial: 'paleOak',
    hardwareStyle: 'knobOnly',
    depthM: 0.58,
    bays: [
      { kind: 'doubleDoor', widthM: 0.94 },
      { kind: 'twinPullOutBin', widthM: 0.54 },
    ],
    position: [2.65, FFL_GROUND + 0.001, -IN_Z + 0.296],
    rotationY: 0,
  });
  tagCutaway(northWindowRun, northCut);
  kitchenGroup.add(northWindowRun);

  // Neptune 1200 mm double larder pantry in Olive-Moss on the West partition
  const larderPantry = buildNeptuneLarderPantry(ctx, {
    name: 'simpleHouse.kitchen.larderPantry',
    paintColor: FB_PIGEON_CABINETRY,
    position: [1.719, FFL_GROUND + 0.001, -2.55],
    rotationY: Math.PI / 2,
  });
  kitchenGroup.add(larderPantry);

  // Central Freestanding Pale European Oak & Honed Carrara Marble Prep Island Table (`1.88 x 0.94 x 0.90 m`)
  const prepIsland = buildNeptuneOakPrepIslandTable({
    name: 'simpleHouse.kitchen.oakPrepIsland',
    widthM: 1.88,
    depthM: 0.94,
    heightM: 0.9,
    includeTabletopStyling: true,
    position: [3.38, FFL_GROUND + 0.001, -0.95],
    rotationY: -Math.PI / 2,
  });
  kitchenGroup.add(prepIsland);

  // 3 Woven Paper-Cord & Pale European Oak Counter Stools tucked along the open-leg West side of the island
  for (const [idx, sz] of [
    [1, -1.5],
    [2, -0.95],
    [3, -0.4],
  ] as const) {
    kitchenGroup.add(
      buildWovenCordOakCounterStool({
        name: `simpleHouse.kitchen.wovenCordStool_${idx}`,
        position: [2.78, FFL_GROUND + 0.001, sz],
        rotationY: Math.PI / 2,
        interactions: ctx.interactions,
      })
    );
  }

  // Twin Spun Aged-Brass Saucer Pendants (`Ø380 mm`) on oval brass link chain + exposed filament bulbs
  for (const [idx, pz] of [
    [1, -1.46],
    [2, -0.44],
  ] as const) {
    groundCeilingGroup.add(
      buildHeritageInteriorLighting(ctx, {
        kind: 'spunBrassSaucerPendant',
        name: `simpleHouse.kitchen.islandPendant_${idx}`,
        position: [3.38, GROUND_CEILING_SOFFIT_Y - 0.003, pz],
        dropM: 0.96,
        circuitId: 'houseKitchenPendants' as CircuitId,
        createPointLight: idx === 1,
      })
    );
  }

  // Dining zone: Arundel 2400 mm weathered oak dining table & chairs + Chichester 1320 mm glazed Welsh dresser in Olive-Moss
  const diningSet = buildNeptuneArundelDiningSet({
    name: 'simpleHouse.dining.arundelSet',
    tableLengthM: 2.4,
    chairStyle: 'wardley',
    position: [3.48, FFL_GROUND + 0.001, 2.35],
    rotationY: Math.PI / 2,
    interactions: ctx.interactions,
  });
  const welshDresser = buildNeptuneChichesterGlazedDresser(ctx, {
    name: 'simpleHouse.dining.chichesterDresser',
    paintColor: FB_PIGEON_CABINETRY,
    position: [1.639, FFL_GROUND + 0.001, 1.85],
    rotationY: Math.PI / 2,
  });
  const southCut = shell.cut('south', 'ground');

  // Tailored oatmeal-linen Roman blind over Kitchen Sink North sash window
  deconflictRomanBlind(buildWindowRomanBlind(ctx.scene, tagCutaway, {
    name: 'simpleHouse.kitchen.sinkRomanBlind',
    zone: 'houseKitchenDiner',
    centerX: 2.35,
    width: 1.18,
    railY: FFL_GROUND + 2.55,
    bottomY: FFL_GROUND + 2.16,
    wallFaceZ: -IN_Z + 0.026,
    facingZ: 1,
    cutawayWall: northCut,
    parentGroup: kitchenGroup,
  }), 1);

  // Full-length triple-pinch-pleat warm oatmeal linen curtains on aged-brass poles in Dining zone (East & South sashes)
  const diningCurtainsEast = buildTraditionalWindowCurtains({
    groupName: 'simpleHouse.dining.curtainsEast',
    poleName: 'simpleHouse.dining.curtainsEast.pole',
    finialName: 'simpleHouse.dining.curtainsEast.finial',
    bracketName: 'simpleHouse.dining.curtainsEast.bracket',
    panelName: 'simpleHouse.dining.curtainsEast.panel',
    headerName: 'simpleHouse.dining.curtainsEast.header',
    hemName: 'simpleHouse.dining.curtainsEast.hem',
    tieBackName: 'simpleHouse.dining.curtainsEast.tieBack',
    centerZ: 2.1,
    halfWindowSpanZ: 0.62,
    poleExtensionZ: 0.26,
    stackWidthZ: 0.3,
    stackInnerInsetZ: 0.04,
    poleX: IN_X - 0.085,
    wallFaceX: IN_X,
    inwardSignX: -1,
    poleY: FFL_GROUND + 2.6,
    floorY: FFL_GROUND,
    tieBackY: FFL_GROUND + 0.98,
    mainColorHex: 0xded3c1,
    shadowColorHex: 0xb9aa93,
    trimColorHex: 0xc8baa4,
    brassMat: brassMats.primary,
  });
  deconflictCurtainBrackets(diningCurtainsEast, -1);
  tagCutaway(diningCurtainsEast, eastCut);

  const diningCurtainsSouth = buildTraditionalWindowCurtains({
    groupName: 'simpleHouse.dining.curtainsSouth',
    poleName: 'simpleHouse.dining.curtainsSouth.pole',
    finialName: 'simpleHouse.dining.curtainsSouth.finial',
    bracketName: 'simpleHouse.dining.curtainsSouth.bracket',
    panelName: 'simpleHouse.dining.curtainsSouth.panel',
    headerName: 'simpleHouse.dining.curtainsSouth.header',
    hemName: 'simpleHouse.dining.curtainsSouth.hem',
    tieBackName: 'simpleHouse.dining.curtainsSouth.tieBack',
    centerZ: 0,
    halfWindowSpanZ: 0.62,
    poleExtensionZ: 0.26,
    stackWidthZ: 0.3,
    stackInnerInsetZ: 0.04,
    poleX: 0.085,
    wallFaceX: 0,
    inwardSignX: 1,
    poleY: FFL_GROUND + 2.6,
    floorY: FFL_GROUND,
    tieBackY: FFL_GROUND + 0.98,
    mainColorHex: 0xded3c1,
    shadowColorHex: 0xb9aa93,
    trimColorHex: 0xc8baa4,
    brassMat: brassMats.primary,
  });
  diningCurtainsSouth.position.set(3.35, 0, IN_Z);
  diningCurtainsSouth.rotation.y = Math.PI / 2;
  deconflictCurtainBrackets(diningCurtainsSouth, 1);
  tagCutaway(diningCurtainsSouth, southCut);

  const diningRadiator = buildCastIronColumnRadiator({
    name: 'simpleHouse.dining.radiator',
    zone: 'houseKitchenDiner',
    cx: 3.35,
    floorY: FFL_GROUND + 0.001,
    cz: IN_Z - 0.12,
    width: 0.92,
    rotationY: Math.PI / 2,
    brassMat: brassMats.primary,
  });
  tagCutaway(diningRadiator, southCut);

  kitchenGroup.add(diningSet, welshDresser, diningCurtainsEast, diningCurtainsSouth, diningRadiator);
  for (const cab of [
    eastBaseNorth,
    eastBaseMid,
    eastSinkUnder,
    eastBaseSouth,
    corbelShelf,
    northWindowRun,
    larderPantry,
    welshDresser,
  ]) {
    applyEstateEggshellPaintToJoinery(cab, pigeonEggshellMat);
  }

  groundCeilingGroup.add(
    buildHeritageInteriorLighting(ctx, {
      kind: 'chandelier6Arm',
      name: 'simpleHouse.dining.chandelier',
      position: [3.345, GROUND_CEILING_SOFFIT_Y - 0.04, 2.25],
      dropM: 0.44,
      circuitId: 'houseKitchenPendants' as CircuitId,
      createPointLight: true,
    })
  );

  buildSimpleHouseGroundWestAndCloakroom(ctx, shell, root, groundCeilingGroup);
}
