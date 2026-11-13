import * as THREE from 'three';
import type { CircuitId, InteractiveUserData, RoomZoneId } from 'husjs';
import {
  applyMetricBoxUVs,
  createPaintMaterial,
} from 'husjs/materials';
import { createHouseplant } from 'husjs/vegetation';
import {
  buildCastIronColumnRadiator,
  buildCorstonPowerSocket,
  buildCorstonToggleSwitch,
  buildTraditionalWindowCurtains,
  buildWindowRomanBlind,
  prepGeo,
  tagCollisionRole,
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
  buildCuratedMirrorsArtAndRugs,
  buildNeptuneArundelDiningSet,
  buildNeptuneChichesterGlazedDresser,
} from 'husjs/catalog/furniture';
import { buildHeritageInteriorLighting } from 'husjs/catalog/lighting';
import { getBathroomBrassMaterials } from 'husjs/catalog/sanitaryware';
import { buildLacancheCluny1000Range } from 'husjs/catalog/appliances';
import type { SceneBuilderContext } from 'husjs/viewer';
import { IN_X, IN_Z, type SimpleHouseShell } from './architecture.ts';
import { FFL_GROUND, GROUND_CEILING_SOFFIT_Y } from './electrical-and-rooms.ts';
import {
  FB_PIGEON_CABINETRY,
  addArundelEndDiningChairs,
  addBox,
  applyEstateEggshellPaintToJoinery,
  buildCorstonRotaryDimmerPlate,
  createWarm2700kLedMaterial,
  customizeNeptuneInkPrepIsland,
  deconflictCurtainBrackets,
  deconflictRomanBlind,
  registerCircuitEmissive,
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
  const inkEggshellMat = createPaintMaterial({
    color: 0x28313b,
    sheen: 'estate-eggshell',
  });
  const darkOakMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.joinery.characterWalnutOak',
    color: 0x563d28,
    roughness: 0.5,
  });
  const stonewareMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.kitchen.whiteStoneware',
    color: 0xf1ece2,
    roughness: 0.3,
  });

  // East Wing — Chichester Kitchen & Dining (X ∈ [+1.89, +7.05], Z ∈ [-4.22, +4.22])
  const kitchenGroup = new THREE.Group();
  kitchenGroup.name = 'simpleHouse.kitchenDiner';
  kitchenGroup.userData.zoneId = 'houseKitchenDiner';
  root.add(kitchenGroup);

  const eastCut = shell.cut('east', 'ground');
  const northCut = shell.cut('north', 'ground');
  const southCut = shell.cut('south', 'ground');

  // East Inglenook & Flanking Pigeon Base Cabinetry (X = 7.05)
  const rangeChimneyBreast = buildPlasterRangeChimneyBreast({
    name: 'simpleHouse.kitchen.rangeChimneyBreast',
    widthM: 1.64,
    depthM: 0.66,
    ceilingHeightM: GROUND_CEILING_SOFFIT_Y,
    apertureWidthM: 1.04,
    apertureHeightM: 1.68,
    plasterMaterial: shell.schemes.houseKitchenDiner.walls,
    includeMantlePlatters: true,
    position: [7.043, FFL_GROUND + 0.001, -1.64],
    rotationY: -Math.PI / 2,
  });
  tagCutaway(rangeChimneyBreast, eastCut);

  const lacancheRange = buildLacancheCluny1000Range(ctx, {
    name: 'simpleHouse.kitchen.lacancheRange',
    finish: 'ivory',
    cookware: 'dutchOven',
    position: [6.70, FFL_GROUND + 0.001, -1.64],
    rotationY: -Math.PI / 2,
  });
  tagCutaway(lacancheRange, eastCut);

  const eastBaseNorth = buildNeptuneInFrameCabinetRun(ctx, {
    name: 'simpleHouse.kitchen.eastBaseNorth',
    collection: 'chichester',
    elevation: 'base',
    paintColor: FB_PIGEON_CABINETRY,
    worktopMaterial: 'carrara',
    hardwareStyle: 'cupPullAndKnob',
    depthM: 0.60,
    bays: [
      { kind: 'drawerBank3', widthM: 0.82 },
      { kind: 'singleDoor', widthM: 0.72, hingeSide: 'left' },
    ],
    position: [6.738, FFL_GROUND + 0.001, -3.32],
    rotationY: -Math.PI / 2,
  });
  applyEstateEggshellPaintToJoinery(eastBaseNorth, pigeonEggshellMat);
  tagCutaway(eastBaseNorth, eastCut);

  // South of Inglenook (`Z = -0.54`, safely clear of `kitchenRsjPierEast` at `Z = -0.288`)
  const eastBaseSouth = buildNeptuneInFrameCabinetRun(ctx, {
    name: 'simpleHouse.kitchen.eastBaseSouth',
    collection: 'chichester',
    elevation: 'base',
    paintColor: FB_PIGEON_CABINETRY,
    worktopMaterial: 'carrara',
    hardwareStyle: 'cupPullAndKnob',
    depthM: 0.60,
    bays: [{ kind: 'drawerBank3', widthM: 0.42 }],
    position: [6.738, FFL_GROUND + 0.001, -0.54],
    rotationY: -Math.PI / 2,
  });
  applyEstateEggshellPaintToJoinery(eastBaseSouth, pigeonEggshellMat);
  tagCutaway(eastBaseSouth, eastCut);

  // Corbelled shelves flanking Inglenook + stoneware pitchers/bowls & character-oak chopping boards
  const oliveCorbelShelf = buildPaintedCorbelKitchenShelf({
    name: 'simpleHouse.kitchen.oliveCorbelShelf',
    widthM: 1.36,
    paintColor: FB_PIGEON_CABINETRY,
    includeCrockery: true,
    position: [7.042, FFL_GROUND + 1.54, -3.32],
    rotationY: -Math.PI / 2,
  });
  applyEstateEggshellPaintToJoinery(oliveCorbelShelf, pigeonEggshellMat);
  tagCutaway(oliveCorbelShelf, eastCut);

  const southCorbelShelf = buildPaintedCorbelKitchenShelf({
    name: 'simpleHouse.kitchen.southCorbelShelf',
    widthM: 0.44,
    paintColor: FB_PIGEON_CABINETRY,
    includeCrockery: false,
    position: [7.042, FFL_GROUND + 1.54, -0.54],
    rotationY: -Math.PI / 2,
  });
  applyEstateEggshellPaintToJoinery(southCorbelShelf, pigeonEggshellMat);
  tagCutaway(southCorbelShelf, eastCut);

  const boardLarge = addBox(
    kitchenGroup,
    'simpleHouse.kitchen.leaningOakBoardLarge',
    [0.022, 0.42, 0.30],
    [6.98, FFL_GROUND + 1.115, -3.56],
    darkOakMat
  );
  boardLarge.rotation.z = 0.09;
  const boardSmallMesh = new THREE.Mesh(
    prepGeo(
      applyMetricBoxUVs(new THREE.BoxGeometry(0.02, 0.33, 0.24), {
        tileW: 0.85,
        tileH: 0.85,
        topTileV: 0.85,
      })
    ),
    paleOakMat
  );
  boardSmallMesh.name = 'simpleHouse.kitchen.leaningOakBoardSmall';
  boardSmallMesh.position.set(6.94, FFL_GROUND + 1.07, -3.48);
  boardSmallMesh.rotation.z = 0.12;
  boardSmallMesh.castShadow = true;
  kitchenGroup.add(boardSmallMesh);

  const pitcherNorth = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.048, 0.062, 0.19, 18)),
    stonewareMat
  );
  pitcherNorth.name = 'simpleHouse.kitchen.stonewarePitcherNorth';
  pitcherNorth.position.set(6.74, FFL_GROUND + 0.998, -3.02);
  pitcherNorth.castShadow = true;
  kitchenGroup.add(pitcherNorth);

  const bowlSouth = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.088, 0.052, 0.074, 18)),
    stonewareMat
  );
  bowlSouth.name = 'simpleHouse.kitchen.stonewareFruitBowlSouth';
  bowlSouth.position.set(6.72, FFL_GROUND + 0.94, -0.54);
  bowlSouth.castShadow = true;
  kitchenGroup.add(bowlSouth);
  for (const acc of [boardLarge, boardSmallMesh, pitcherNorth, bowlSouth]) {
    tagCutaway(acc, eastCut);
  }

  // North Belfast Sink Run (Z = -4.22, X ∈ [2.57, 4.48], centered on X = 3.62)
  const northBaseWest = buildNeptuneInFrameCabinetRun(ctx, {
    name: 'simpleHouse.kitchen.northWindowRunWest',
    collection: 'chichester',
    elevation: 'base',
    paintColor: FB_PIGEON_CABINETRY,
    worktopMaterial: 'carrara',
    hardwareStyle: 'cupPullAndKnob',
    depthM: 0.60,
    bays: [{ kind: 'singleDoor', widthM: 0.60, hingeSide: 'left' }],
    position: [2.89, FFL_GROUND + 0.001, -3.90],
    rotationY: 0,
  });
  const northSinkUnder = buildNeptuneInFrameCabinetRun(ctx, {
    name: 'simpleHouse.kitchen.northSinkUnderCabinet',
    collection: 'chichester',
    elevation: 'base',
    paintColor: FB_PIGEON_CABINETRY,
    heightM: 0.67,
    depthM: 0.58,
    includeMarbleWorktop: false,
    includeUpstand: false,
    hardwareStyle: 'knobOnly',
    bays: [{ kind: 'doubleDoor', widthM: 0.78 }],
    position: [3.62, FFL_GROUND + 0.001, -3.91],
    rotationY: 0,
  });
  const belfastSink = buildShawsBelfastSinkAndBridgeTap({
    name: 'simpleHouse.kitchen.belfastSink',
    includeCarraraDrainerDeck: false,
    includeRinseSpray: true,
    position: [3.62, FFL_GROUND + 0.671, -3.89],
    rotationY: 0,
  });
  const northBaseEast = buildNeptuneInFrameCabinetRun(ctx, {
    name: 'simpleHouse.kitchen.northWindowRunEast',
    collection: 'chichester',
    elevation: 'base',
    paintColor: FB_PIGEON_CABINETRY,
    worktopMaterial: 'carrara',
    hardwareStyle: 'cupPullAndKnob',
    depthM: 0.60,
    bays: [{ kind: 'twinPullOutBin', widthM: 0.42 }],
    position: [4.252, FFL_GROUND + 0.001, -3.90],
    rotationY: 0,
  });
  for (const run of [northBaseWest, northSinkUnder, northBaseEast]) {
    applyEstateEggshellPaintToJoinery(run, pigeonEggshellMat);
    tagCutaway(run, northCut);
  }
  tagCutaway(belfastSink, northCut);

  deconflictRomanBlind(
    buildWindowRomanBlind(ctx.scene, tagCutaway, {
      name: 'simpleHouse.kitchen.sinkRomanBlind',
      zone: 'houseKitchenDiner',
      centerX: 3.62,
      width: 1.08,
      railY: FFL_GROUND + 2.41,
      bottomY: FFL_GROUND + 2.06,
      wallFaceZ: -IN_Z + 0.028,
      facingZ: 1,
      cutawayWall: northCut,
      parentGroup: kitchenGroup,
    }),
    1
  );

  // West Kitchen Wall Larder Pantry (X = 2.24, Z = -2.45)
  const larderCabinetHost = new THREE.Group();
  larderCabinetHost.name = 'simpleHouse.kitchen.larderCabinetHost';
  const larderPantry = buildNeptuneLarderPantry(ctx, {
    name: 'simpleHouse.kitchen.larderPantry',
    paintColor: FB_PIGEON_CABINETRY,
    position: [2.24, FFL_GROUND + 0.001, -2.45],
    rotationY: Math.PI / 2,
  });
  applyEstateEggshellPaintToJoinery(larderPantry, pigeonEggshellMat);
  larderCabinetHost.add(larderPantry);

  // Central Neptune Ink (0x28313b) Prep Island & 3 Woven-Cord Stools
  const prepIsland = buildNeptuneOakPrepIslandTable({
    name: 'simpleHouse.kitchen.oakPrepIsland',
    widthM: 2.20,
    depthM: 1.08,
    heightM: 0.91,
    includeTabletopStyling: true,
    position: [4.25, FFL_GROUND + 0.001, -1.55],
    rotationY: Math.PI / 2,
  });
  customizeNeptuneInkPrepIsland(prepIsland, inkEggshellMat, paleOakMat);

  for (const [idx, sz] of [
    [1, -2.22],
    [2, -1.55],
    [3, -0.88],
  ] as const) {
    kitchenGroup.add(
      buildWovenCordOakCounterStool({
        name: `simpleHouse.kitchen.wovenCordStool_${idx}`,
        position: [3.52, FFL_GROUND + 0.001, sz],
        rotationY: Math.PI / 2,
        interactions: ctx.interactions,
      })
    );
  }

  // South Dining Zone (Braided Jute Rug, 2.40 m Arundel 8-Seat Set & Dresser)
  const juteRug = buildCuratedMirrorsArtAndRugs({
    name: 'simpleHouse.dining.braidedJuteRug',
    kind: 'coxBraidedJute',
    widthM: 3.10,
    lengthM: 3.60,
    position: [4.55, FFL_GROUND + 0.003, 2.05],
  });
  tagCollisionRole(juteRug, 'ignore');

  const diningSet = buildNeptuneArundelDiningSet({
    name: 'simpleHouse.dining.arundelSet',
    tableLengthM: 2.40,
    chairStyle: 'wardley',
    position: [4.55, FFL_GROUND + 0.018, 2.05],
    rotationY: Math.PI / 2,
    interactions: ctx.interactions,
  });
  addArundelEndDiningChairs(diningSet, 'simpleHouse.dining.arundelSet', 2.40);

  const welshDresser = buildNeptuneChichesterGlazedDresser(ctx, {
    name: 'simpleHouse.dining.chichesterDresser',
    paintColor: FB_PIGEON_CABINETRY,
    position: [2.16, FFL_GROUND + 0.001, 1.48],
    rotationY: Math.PI / 2,
  });
  applyEstateEggshellPaintToJoinery(welshDresser, pigeonEggshellMat);

  // Full-length oatmeal-linen curtains on diningSouthWest (+2.95), diningSouthEast (+5.35) & diningEast (+2.10)
  for (const [idTag, cx] of [
    ['SouthWest', 2.95],
    ['SouthEast', 5.35],
  ] as const) {
    const base = `simpleHouse.dining.curtains${idTag}`;
    const curt = buildTraditionalWindowCurtains({
      groupName: base,
      poleName: `${base}.pole`,
      finialName: `${base}.finial`,
      bracketName: `${base}.bracket`,
      panelName: `${base}.panel`,
      headerName: `${base}.header`,
      hemName: `${base}.hem`,
      tieBackName: `${base}.tieBack`,
      centerZ: 0,
      halfWindowSpanZ: 0.56,
      poleExtensionZ: 0.22,
      stackWidthZ: 0.26,
      stackInnerInsetZ: 0.04,
      poleX: 0.095,
      wallFaceX: 0,
      inwardSignX: 1,
      poleY: FFL_GROUND + 2.60,
      floorY: FFL_GROUND + 0.002,
      tieBackY: FFL_GROUND + 0.98,
      mainColorHex: 0xded3c1,
      shadowColorHex: 0xb9aa93,
      trimColorHex: 0xc8baa4,
      brassMat: brassMats.primary,
    });
    curt.position.set(cx, 0, IN_Z - 0.055);
    curt.rotation.y = Math.PI / 2;
    deconflictCurtainBrackets(curt, 1);
    tagCutaway(curt, southCut);
    kitchenGroup.add(curt);
  }

  const diningCurtainsEast = buildTraditionalWindowCurtains({
    groupName: 'simpleHouse.dining.curtainsEast',
    poleName: 'simpleHouse.dining.curtainsEast.pole',
    finialName: 'simpleHouse.dining.curtainsEast.finial',
    bracketName: 'simpleHouse.dining.curtainsEast.bracket',
    panelName: 'simpleHouse.dining.curtainsEast.panel',
    headerName: 'simpleHouse.dining.curtainsEast.header',
    hemName: 'simpleHouse.dining.curtainsEast.hem',
    tieBackName: 'simpleHouse.dining.curtainsEast.tieBack',
    centerZ: 2.10,
    halfWindowSpanZ: 0.56,
    poleExtensionZ: 0.22,
    stackWidthZ: 0.26,
    stackInnerInsetZ: 0.04,
    poleX: IN_X - 0.115,
    wallFaceX: IN_X - 0.002,
    inwardSignX: -1,
    poleY: FFL_GROUND + 2.60,
    floorY: FFL_GROUND + 0.002,
    tieBackY: FFL_GROUND + 0.98,
    mainColorHex: 0xded3c1,
    shadowColorHex: 0xb9aa93,
    trimColorHex: 0xc8baa4,
    brassMat: brassMats.primary,
  });
  deconflictCurtainBrackets(diningCurtainsEast, -1);
  tagCutaway(diningCurtainsEast, eastCut);

  const diningRadiator = buildCastIronColumnRadiator({
    name: 'simpleHouse.dining.radiator',
    zone: 'houseKitchenDiner',
    cx: 4.15,
    floorY: FFL_GROUND + 0.001,
    cz: IN_Z - 0.11,
    width: 0.82,
    rotationY: Math.PI / 2,
    brassMat: brassMats.primary,
  });
  tagCutaway(diningRadiator, southCut);

  kitchenGroup.add(
    rangeChimneyBreast,
    lacancheRange,
    eastBaseNorth,
    eastBaseSouth,
    oliveCorbelShelf,
    southCorbelShelf,
    northBaseWest,
    northSinkUnder,
    belfastSink,
    northBaseEast,
    larderCabinetHost,
    prepIsland,
    juteRug,
    diningSet,
    welshDresser,
    diningCurtainsEast,
    diningRadiator
  );

  // 3-Circuit Dimmable Kitchen-Diner Lighting & Corston Controls
  // Circuit 1: houseKitchenPendants (twin fluted-glass & brass pendants over 2.20 m Ink island)
  for (const [idx, pz] of [
    [1, -2.10],
    [2, -1.00],
  ] as const) {
    groundCeilingGroup.add(
      buildHeritageInteriorLighting(ctx, {
        kind: 'coxFlutedPendant',
        name: `simpleHouse.kitchen.islandPendant_${idx}`,
        position: [4.25, GROUND_CEILING_SOFFIT_Y - 0.003, pz],
        dropM: 0.88,
        circuitId: 'houseKitchenPendants' as CircuitId,
        createPointLight: idx === 1,
        pointLightIntensity: 1.5,
      })
    );
  }

  // Circuit 2: houseDiningPendant (6-arm brass chandelier hung low over 2.40 m Arundel table)
  groundCeilingGroup.add(
    buildHeritageInteriorLighting(ctx, {
      kind: 'chandelier6Arm',
      name: 'simpleHouse.dining.chandelier',
      position: [4.55, GROUND_CEILING_SOFFIT_Y - 0.032, 2.05],
      dropM: 0.62,
      circuitId: 'houseDiningPendant' as CircuitId,
      createPointLight: true,
      pointLightIntensity: 1.6,
    })
  );

  // Circuit 3: houseKitchenTask (0 PointLights — pure 2700K emissive LED bars + glow pools)
  const taskCircuit = 'houseKitchenTask' as CircuitId;
  const taskLedMat = createWarm2700kLedMaterial('simpleHouse.kitchen.taskLed2700k', 1.5);
  registerCircuitEmissive(ctx, taskCircuit, taskLedMat);

  const ledNorthShelf = addBox(
    kitchenGroup,
    'simpleHouse.kitchen.taskLed.northCorbelShelf',
    [0.012, 0.005, 1.22],
    [6.91, FFL_GROUND + 1.535, -3.32],
    taskLedMat
  );
  const ledSouthShelf = addBox(
    kitchenGroup,
    'simpleHouse.kitchen.taskLed.southCorbelShelf',
    [0.012, 0.005, 0.36],
    [6.91, FFL_GROUND + 1.535, -0.54],
    taskLedMat
  );
  const ledInglenookCanopy = addBox(
    kitchenGroup,
    'simpleHouse.kitchen.taskLed.inglenookCanopy',
    [0.024, 0.006, 0.88],
    [6.86, FFL_GROUND + 1.674, -1.64],
    taskLedMat
  );
  const ledWelshDresser = addBox(
    kitchenGroup,
    'simpleHouse.kitchen.taskLed.chichesterDresser',
    [0.012, 0.005, 1.04],
    [2.02, FFL_GROUND + 2.04, 1.48],
    taskLedMat
  );
  for (const bar of [ledNorthShelf, ledSouthShelf, ledInglenookCanopy]) {
    bar.castShadow = false;
    tagCutaway(bar, eastCut);
  }
  ledWelshDresser.castShadow = false;

  ctx.addGlowPool(taskCircuit, 6.76, FFL_GROUND + 0.92, -3.32, 0.62, 0.32);
  ctx.addGlowPool(taskCircuit, 6.76, FFL_GROUND + 0.92, -0.54, 0.38, 0.25);
  ctx.addGlowPool(taskCircuit, 6.70, FFL_GROUND + 0.95, -1.64, 0.68, 0.42);
  ctx.addGlowPool(taskCircuit, 2.22, FFL_GROUND + 0.90, 1.48, 0.56, 0.30);

  // Corston 3-gang toggle switch + 3-gang rotary dimmer plate on West pier North of hallKitchen door
  const kitchenSwitchIds: Record<number, string> = {
    1: 'sw-kitchen',
    2: 'sw-dining',
    3: 'sw-kitchen-task',
  };
  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.sw.kitchen',
    switchPa: 'plate-kitchen',
    location: 'Kitchen hallway jamb',
    x: 1.892,
    y: FFL_GROUND + 1.15,
    z: 2.86,
    facing: 'east',
    mountedInZoneId: 'houseKitchenDiner' as RoomZoneId,
    parentGroup: kitchenGroup,
    extraUserDataForGang: (gang): InteractiveUserData => ({
      electricalSwitchId: kitchenSwitchIds[gang],
    }),
    gangs: [
      { gang: 1, zoneId: 'houseKitchenDiner' as RoomZoneId, label: 'Island Fluted Pendants', circuitId: 'houseKitchenPendants' as CircuitId },
      { gang: 2, zoneId: 'houseKitchenDiner' as RoomZoneId, label: 'Arundel Dining Chandelier', circuitId: 'houseDiningPendant' as CircuitId },
      { gang: 3, zoneId: 'houseKitchenDiner' as RoomZoneId, label: 'Corbel, Range & Dresser Wash', circuitId: 'houseKitchenTask' as CircuitId },
    ],
  });

  buildCorstonRotaryDimmerPlate(ctx, {
    name: 'simpleHouse.dimmer.kitchen',
    zoneId: 'houseKitchenDiner' as RoomZoneId,
    x: 1.892,
    y: FFL_GROUND + 1.01,
    z: 2.86,
    facing: 'east',
    brassMat: brassMats.primary,
    knurledBrassMat: brassMats.knurled,
    parent: kitchenGroup,
    dimmers: [
      { dimmerId: 'dimmer-kitchen-island', circuitId: 'houseKitchenPendants' as CircuitId, label: 'Kitchen Island Pendants Dimmer' },
      { dimmerId: 'dimmer-dining-pendant', circuitId: 'houseDiningPendant' as CircuitId, label: 'Arundel Dining Chandelier Dimmer' },
      { dimmerId: 'dimmer-kitchen-task', circuitId: 'houseKitchenTask' as CircuitId, label: 'Kitchen Joinery & Dresser Task Dimmer' },
    ],
  });

  kitchenGroup.add(
    buildCorstonPowerSocket(ctx, tagCutaway, {
      name: 'simpleHouse.socket.kitchenWorktopNorth',
      zone: 'houseKitchenDiner',
      kind: 'double',
      x: 7.041,
      y: FFL_GROUND + 1.08,
      z: -2.85,
      facing: 'west',
      cutawayWall: eastCut,
    }),
    buildCorstonPowerSocket(ctx, tagCutaway, {
      name: 'simpleHouse.socket.kitchenWorktopSouth',
      zone: 'houseKitchenDiner',
      kind: 'double',
      x: 7.041,
      y: FFL_GROUND + 1.08,
      z: -0.54,
      facing: 'west',
      cutawayWall: eastCut,
    })
  );

  const diningFig = createHouseplant({
    species: 'fiddle-leaf-fig',
    height: 1.54,
    potStyle: 'stoneware',
    exposure: 'indoor',
    seed: 5101,
    name: 'simpleHouse.kitchen.fiddleLeafFig',
  });
  diningFig.position.set(6.55, FFL_GROUND + 0.002, 3.72);
  tagCutaway(diningFig, southCut);
  kitchenGroup.add(diningFig);

  const shelfTrailingIvy = createHouseplant({
    species: 'trailing-ivy',
    height: 0.30,
    potStyle: 'terracotta',
    exposure: 'indoor',
    seed: 5113,
    name: 'simpleHouse.kitchen.shelfTrailingIvy',
  });
  shelfTrailingIvy.position.set(6.83, FFL_GROUND + 1.574, -0.18);
  tagCutaway(shelfTrailingIvy, eastCut);
  kitchenGroup.add(shelfTrailingIvy);

  // West Drawing Room, Garden Boot Lobby & Guests' Powder Room
  buildSimpleHouseGroundWestAndCloakroom(ctx, shell, root, groundCeilingGroup);
}
