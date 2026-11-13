import * as THREE from 'three';
import type { CircuitId, InteractiveUserData, RoomZoneId } from 'husjs';
import {
  createPaintMaterial,
} from 'husjs/materials';
import {
  attachAudioEmitter,
  buildCastIronColumnRadiator,
  buildCorstonPowerSocket,
  buildCorstonToggleSwitch,
  buildTraditionalWindowCurtains,
  buildWindowRomanBlind,
  createDadoRun,
  prepGeo,
  sharedCylinderGeometry,
  tagCutaway,
} from 'husjs/objects';
import {
  buildGeorgianBolectionFireplace,
  buildNeptuneBootBenchAndPegRail,
  buildTongueAndGrooveDadoPanelling,
  getPaleEuropeanOakJoineryMaterial,
} from 'husjs/catalog/architectural';
import {
  buildCuratedMirrorsArtAndRugs,
  buildGeorgianAntiqueCasework,
  buildGeorgianFiresideSet,
  buildNeptuneArmchair,
  buildNeptuneOakTablesAndBedsides,
  buildNeptuneUpholsteredSofa,
  buildWhiteCompanyAccessories,
} from 'husjs/catalog/furniture';
import { buildHeritageInteriorLighting } from 'husjs/catalog/lighting';
import {
  buildArmstrongPaperHolder,
  buildPerrinRoweTowelRing,
  buildThomasCrapperLowLevelWc,
  getBathroomBrassMaterials,
  getHonedCarraraMarbleMaterial,
} from 'husjs/catalog/sanitaryware';
import type { SceneBuilderContext } from 'husjs/viewer';
import { DRAWING_BREAST, IN_X, IN_Z, type SimpleHouseShell } from './architecture.ts';
import { FFL_GROUND, GROUND_CEILING_SOFFIT_Y } from './electrical-and-rooms.ts';

/** Farrow & Ball *Pigeon No. 25* (`#969B90`) calm heritage stone-sage cabinetry palette (`estate-eggshell` 20% sheen). */

import {
  FB_GREEN_SMOKE,
  addBox,
  buildFullWidthGeorgianAlcoveBookcase,
  buildGeorgianCloakroomWashstand,
  deconflictCurtainBrackets,
  deconflictRomanBlind,
} from './interiors-ground-helpers.ts';

export function buildSimpleHouseGroundWestAndCloakroom(
  ctx: SceneBuilderContext,
  shell: SimpleHouseShell,
  root: THREE.Group,
  groundCeilingGroup: THREE.Object3D
): void {
  const brassMats = getBathroomBrassMaterials('SB');
  const carraraMat = getHonedCarraraMarbleMaterial();
  const paleOakMat = getPaleEuropeanOakJoineryMaterial();
  const schoolHouseEggshellMat = createPaintMaterial({
    color: 'school-house-white',
    sheen: 'estate-eggshell',
  });
  const darkOakMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.joinery.vintageWalnutOakWest',
    color: 0x4b3524,
    roughness: 0.52,
  });
  const eastCut = shell.cut('east', 'ground');
  const northCut = shell.cut('north', 'ground');
  const southCut = shell.cut('south', 'ground');

  // =========================================================================
  // 2. West Wing — Georgian Drawing Room (houseDrawing: F&B Cromarty + School House White)
  // =========================================================================
  const drawingGroup = new THREE.Group();
  drawingGroup.name = 'simpleHouse.drawingRoom';
  drawingGroup.userData.zoneId = 'houseDrawing';
  root.add(drawingGroup);

  const westCut = shell.cut('west', 'ground');

  const breastGroup = new THREE.Group();
  breastGroup.name = 'simpleHouse.drawing.chimneyBreast';
  const breastD = DRAWING_BREAST.maxX - (-IN_X + 0.004);
  const breastCx = (-IN_X + 0.004 + DRAWING_BREAST.maxX) * 0.5;
  const cheekW = 0.95 - 0.484;
  addBox(
    breastGroup,
    'simpleHouse.drawing.chimneyBreastNorthCheek',
    [breastD, 0.923, cheekW],
    [breastCx, 0.4635, -(0.484 + cheekW * 0.5)],
    shell.schemes.houseDrawing.walls
  );
  addBox(
    breastGroup,
    'simpleHouse.drawing.chimneyBreastSouthCheek',
    [breastD, 0.923, cheekW],
    [breastCx, 0.4635, 0.484 + cheekW * 0.5],
    shell.schemes.houseDrawing.walls
  );
  addBox(
    breastGroup,
    'simpleHouse.drawing.chimneyBreastUpper',
    [breastD, GROUND_CEILING_SOFFIT_Y - 0.929, 1.9],
    [breastCx, 0.925 + (GROUND_CEILING_SOFFIT_Y - 0.929) * 0.5, 0],
    shell.schemes.houseDrawing.walls
  );
  tagCutaway(breastGroup, westCut);
  drawingGroup.add(breastGroup);

  const fireplace = buildGeorgianBolectionFireplace(ctx, {
    name: 'simpleHouse.drawing.bolectionFireplace',
    hearthStyle: 'slate',
    includeStove: true,
    position: [DRAWING_BREAST.maxX + 0.002, FFL_GROUND + 0.001, 0],
    rotationY: Math.PI / 2,
  });
  attachAudioEmitter(fireplace, {
    id: 'simpleHouse.drawing.woodStoveAudio',
    preset: 'woodStove',
    zoneId: 'houseDrawing',
    isExterior: false,
    volume: 0.65,
    refDistance: 1.6,
    maxDistance: 9.0,
  });
  tagCutaway(fireplace, westCut);

  const clubFender = buildGeorgianFiresideSet({
    name: 'simpleHouse.drawing.clubFender',
    fenderWidthM: 1.38,
    fenderDepthM: 0.38,
    position: [-4.20, FFL_GROUND + 0.001, 0],
    rotationY: Math.PI / 2,
    interactions: ctx.interactions,
  });

  const overmantel = buildCuratedMirrorsArtAndRugs({
    kind: 'regencyGiltOvermantel',
    name: 'simpleHouse.drawing.overmantelMirror',
    widthM: 1.32,
    heightM: 1.14,
    position: [DRAWING_BREAST.maxX + 0.004, FFL_GROUND + 1.22, 0],
    rotationY: Math.PI / 2,
  });

  const bookcaseNorth = buildFullWidthGeorgianAlcoveBookcase(ctx, {
    name: 'simpleHouse.drawing.alcoveBookcaseNorth',
    widthM: 3.264,
    heightM: 2.702,
    baseDepthM: 0.435,
    upperDepthM: 0.312,
    paintMat: schoolHouseEggshellMat,
    oakMat: paleOakMat,
    brassMat: brassMats.primary,
    darkBrassMat: brassMats.darkShadow,
    position: [-IN_X + 0.005, FFL_GROUND + 0.001, -2.585],
    rotationY: Math.PI / 2,
  });
  const bookcaseSouth = buildFullWidthGeorgianAlcoveBookcase(ctx, {
    name: 'simpleHouse.drawing.alcoveBookcaseSouth',
    widthM: 3.264,
    heightM: 2.702,
    baseDepthM: 0.435,
    upperDepthM: 0.312,
    paintMat: schoolHouseEggshellMat,
    oakMat: paleOakMat,
    brassMat: brassMats.primary,
    darkBrassMat: brassMats.darkShadow,
    position: [-IN_X + 0.005, FFL_GROUND + 0.001, 2.585],
    rotationY: Math.PI / 2,
  });
  tagCutaway(bookcaseNorth, westCut);
  tagCutaway(bookcaseSouth, westCut);
  ctx.addGlowPool('houseDrawingChandelier' as CircuitId, -5.05, FFL_GROUND + 0.88, -2.585, 0.75, 0.25);
  ctx.addGlowPool('houseDrawingChandelier' as CircuitId, -5.05, FFL_GROUND + 0.88, 2.585, 0.75, 0.25);

  drawingGroup.add(fireplace, clubFender, overmantel, bookcaseNorth, bookcaseSouth);

  const drawingRug = buildCuratedMirrorsArtAndRugs({
    kind: 'zieglerOushak',
    name: 'simpleHouse.drawing.zieglerRug',
    widthM: 2.4,
    lengthM: 3.9,
    position: [-2.95, FFL_GROUND + 0.002, 0],
  });
  const rugTopY = FFL_GROUND + 0.018;

  const sofa = buildNeptuneUpholsteredSofa({
    name: 'simpleHouse.drawing.longIslandSofa',
    model: 'longIsland',
    position: [-3.0, rugTopY, -1.35],
    rotationY: 0,
    interactions: ctx.interactions,
  });
  const armchairWest = buildNeptuneArmchair({
    name: 'simpleHouse.drawing.oliviaArmchairWest',
    model: 'olivia',
    position: [-3.52, rugTopY, 1.32],
    rotationY: Math.PI - 0.22,
    interactions: ctx.interactions,
  });
  const armchairEast = buildNeptuneArmchair({
    name: 'simpleHouse.drawing.oliviaArmchairEast',
    model: 'olivia',
    position: [-2.42, rugTopY, 1.32],
    rotationY: Math.PI + 0.22,
    interactions: ctx.interactions,
  });
  const coffeeTable = buildNeptuneOakTablesAndBedsides({
    name: 'simpleHouse.drawing.henleyCoffeeTable',
    kind: 'henleyCoffeeTable',
    position: [-3.0, rugTopY, 0.0],
    interactions: ctx.interactions,
  });

  const cardTable = buildGeorgianAntiqueCasework(ctx, {
    kind: 'demiLuneCardTable',
    name: 'simpleHouse.drawing.demiLuneCardTable',
    position: [-1.66, FFL_GROUND + 0.001, 2.75],
    rotationY: -Math.PI / 2,
  });
  const constableOil = buildCuratedMirrorsArtAndRugs({
    kind: 'constableLandscapeOil',
    name: 'simpleHouse.drawing.constableOil',
    position: [-1.394, FFL_GROUND + 1.36, 2.75],
    rotationY: -Math.PI / 2,
  });
  const botanicalGrid = buildCuratedMirrorsArtAndRugs({
    kind: 'curtisBotanicalGrid',
    name: 'simpleHouse.drawing.curtisBotanicals',
    botanicalLayout: '2x2',
    position: [-1.394, FFL_GROUND + 1.24, -2.15],
    rotationY: -Math.PI / 2,
  });
  const drawingRadiator = buildCastIronColumnRadiator({
    name: 'simpleHouse.drawing.radiator',
    zone: 'houseDrawing',
    cx: -3.35,
    floorY: FFL_GROUND + 0.001,
    cz: -IN_Z + 0.12,
    width: 0.95,
    rotationY: -Math.PI / 2,
    brassMat: brassMats.primary,
  });
  tagCutaway(drawingRadiator, northCut);

  // Full-length interlined sage-oatmeal triple-pinch-pleat linen curtains on aged-brass poles (South & North Drawing Room sashes)
  const drawingCurtainsSouth = buildTraditionalWindowCurtains({
    groupName: 'simpleHouse.drawing.curtainsSouth',
    poleName: 'simpleHouse.drawing.curtainsSouth.pole',
    finialName: 'simpleHouse.drawing.curtainsSouth.finial',
    bracketName: 'simpleHouse.drawing.curtainsSouth.bracket',
    panelName: 'simpleHouse.drawing.curtainsSouth.panel',
    headerName: 'simpleHouse.drawing.curtainsSouth.header',
    hemName: 'simpleHouse.drawing.curtainsSouth.hem',
    tieBackName: 'simpleHouse.drawing.curtainsSouth.tieBack',
    centerZ: 0,
    halfWindowSpanZ: 0.62,
    poleExtensionZ: 0.28,
    stackWidthZ: 0.32,
    stackInnerInsetZ: 0.04,
    poleX: 0.088,
    wallFaceX: 0,
    inwardSignX: 1,
    poleY: FFL_GROUND + 2.6,
    floorY: FFL_GROUND,
    tieBackY: FFL_GROUND + 0.98,
    mainColorHex: 0xd6d4ca,
    shadowColorHex: 0xadb0a4,
    trimColorHex: 0xc2c2b6,
    brassMat: brassMats.primary,
  });
  drawingCurtainsSouth.position.set(-3.35, 0, IN_Z);
  drawingCurtainsSouth.rotation.y = Math.PI / 2;
  deconflictCurtainBrackets(drawingCurtainsSouth, 1);
  tagCutaway(drawingCurtainsSouth, southCut);

  const drawingCurtainsNorth = buildTraditionalWindowCurtains({
    groupName: 'simpleHouse.drawing.curtainsNorth',
    poleName: 'simpleHouse.drawing.curtainsNorth.pole',
    finialName: 'simpleHouse.drawing.curtainsNorth.finial',
    bracketName: 'simpleHouse.drawing.curtainsNorth.bracket',
    panelName: 'simpleHouse.drawing.curtainsNorth.panel',
    headerName: 'simpleHouse.drawing.curtainsNorth.header',
    hemName: 'simpleHouse.drawing.curtainsNorth.hem',
    tieBackName: 'simpleHouse.drawing.curtainsNorth.tieBack',
    centerZ: 0,
    halfWindowSpanZ: 0.62,
    poleExtensionZ: 0.28,
    stackWidthZ: 0.32,
    stackInnerInsetZ: 0.04,
    poleX: 0.088,
    wallFaceX: 0,
    inwardSignX: 1,
    poleY: FFL_GROUND + 2.6,
    floorY: FFL_GROUND,
    tieBackY: FFL_GROUND + 0.98,
    mainColorHex: 0xd6d4ca,
    shadowColorHex: 0xadb0a4,
    trimColorHex: 0xc2c2b6,
    brassMat: brassMats.primary,
  });
  drawingCurtainsNorth.position.set(-3.35, 0, -IN_Z);
  drawingCurtainsNorth.rotation.y = -Math.PI / 2;
  deconflictCurtainBrackets(drawingCurtainsNorth, 1);
  tagCutaway(drawingCurtainsNorth, northCut);

  const drawingCardLamp = buildHeritageInteriorLighting(ctx, {
    kind: 'whiteCoCeramicLamp',
    name: 'simpleHouse.drawing.cardTableLamp',
    position: [-1.64, FFL_GROUND + 0.747, 2.75],
    circuitId: 'houseDrawingChandelier' as CircuitId,
    createPointLight: false,
  });
  const coffeeHurricane = buildWhiteCompanyAccessories({
    kind: 'glassHurricane',
    name: 'simpleHouse.drawing.coffeeHurricane',
    position: [-2.82, rugTopY + 0.452, 0.04],
  });

  drawingGroup.add(
    drawingRug,
    sofa,
    armchairWest,
    armchairEast,
    coffeeTable,
    cardTable,
    constableOil,
    botanicalGrid,
    drawingRadiator,
    drawingCurtainsSouth,
    drawingCurtainsNorth,
    drawingCardLamp,
    coffeeHurricane
  );

  groundCeilingGroup.add(
    buildHeritageInteriorLighting(ctx, {
      kind: 'chandelier6Arm',
      name: 'simpleHouse.drawing.chandelier',
      position: [-3.345, GROUND_CEILING_SOFFIT_Y - 0.04, 0],
      dropM: 0.44,
      circuitId: 'houseDrawingChandelier' as CircuitId,
      createPointLight: true,
    })
  );

  // =========================================================================
  // 3. Rear Boot Lobby & Cloakroom WC (houseCloakroom)
  // =========================================================================
  const cloakGroup = new THREE.Group();
  cloakGroup.name = 'simpleHouse.cloakroomSuite';
  cloakGroup.userData.zoneId = 'houseCloakroom';
  root.add(cloakGroup);

  const dadoWest = buildTongueAndGrooveDadoPanelling({
    name: 'simpleHouse.bootLobby.dadoWest',
    lengthM: 2.36,
    heightM: 1.12,
    paintColor: FB_GREEN_SMOKE,
    position: [-1.146, FFL_GROUND + 0.001, -2.995],
    rotationY: Math.PI / 2,
  });
  const dadoNorth = buildTongueAndGrooveDadoPanelling({
    name: 'simpleHouse.bootLobby.dadoNorth',
    lengthM: 1.0,
    heightM: 1.12,
    paintColor: FB_GREEN_SMOKE,
    position: [-0.6, FFL_GROUND + 0.001, -IN_Z + 0.004],
    rotationY: 0,
  });
  tagCutaway(dadoNorth, northCut);

  const bootBench = buildNeptuneBootBenchAndPegRail({
    name: 'simpleHouse.bootLobby.bootBench',
    widthM: 1.24,
    depthM: 0.44,
    paintColor: FB_GREEN_SMOKE,
    position: [-1.114, FFL_GROUND + 0.001, -3.45],
    rotationY: Math.PI / 2,
    interactions: ctx.interactions,
  });

  const bootLobbySconce = buildHeritageInteriorLighting(ctx, {
    kind: 'coxFlutedSconce',
    name: 'simpleHouse.bootLobby.sconce',
    position: [-0.6, FFL_GROUND + 1.72, -IN_Z + 0.004],
    rotationY: 0,
    circuitId: 'houseCloakroomSconces' as CircuitId,
    createPointLight: false,
  });
  tagCutaway(bootLobbySconce, northCut);

  const crapperWc = buildThomasCrapperLowLevelWc({
    namePrefix: 'simpleHouse.cloakroom.thomasCrapperWc',
    finish: 'SB',
    seatFinish: 'darkOak',
    mitreBracketFlange: true,
  });
  crapperWc.position.set(0.64, FFL_GROUND + 0.001, -IN_Z + 0.004);
  tagCutaway(crapperWc, northCut);

  const cloakWashstand = buildGeorgianCloakroomWashstand(
    'simpleHouse.cloakroom.washstand',
    brassMats.primary,
    carraraMat,
    darkOakMat
  );
  cloakWashstand.position.set(1.138, FFL_GROUND + 0.001, -3.05);
  cloakWashstand.rotation.y = -Math.PI / 2;

  const cloakMirror = buildCuratedMirrorsArtAndRugs({
    kind: 'scallopedBrass',
    name: 'simpleHouse.cloakroom.scallopedMirror',
    widthM: 0.5,
    heightM: 0.72,
    position: [1.138, FFL_GROUND + 1.12, -3.05],
    rotationY: -Math.PI / 2,
  });

  const paperHolder = buildArmstrongPaperHolder({
    namePrefix: 'simpleHouse.cloakroom.paperHolder',
    finish: 'SB',
    style: 'traditional',
    coreClearanceM: 0.0008,
  });
  paperHolder.position.set(1.138, FFL_GROUND + 0.68, -3.72);
  paperHolder.rotation.y = -Math.PI / 2;

  const cloakSconce = buildHeritageInteriorLighting(ctx, {
    kind: 'coxFlutedSconce',
    name: 'simpleHouse.cloakroom.sconce',
    position: [1.138, FFL_GROUND + 1.56, -2.55],
    rotationY: -Math.PI / 2,
    circuitId: 'houseCloakroomSconces' as CircuitId,
    createPointLight: true,
  });

  // Boot Lobby accessories: Welsh slate boot tray + pair of olive heritage wellington boots + Kubu storage basket
  const bootTrayGroup = new THREE.Group();
  bootTrayGroup.name = 'simpleHouse.bootLobby.slateBootTray';
  bootTrayGroup.position.set(-0.34, FFL_GROUND + 0.002, -3.92);
  bootTrayGroup.rotation.y = -Math.PI / 2;
  tagCutaway(bootTrayGroup, northCut);
  const slateTrayMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.bootLobby.slateMat',
    color: 0x35393c,
    roughness: 0.78,
  });
  const wellyMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.bootLobby.oliveRubberMat',
    color: 0x3b4a3a,
    roughness: 0.44,
  });
  const wellySoleMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.bootLobby.rubberSoleMat',
    color: 0x222422,
    roughness: 0.82,
  });
  addBox(bootTrayGroup, 'simpleHouse.bootLobby.slateBootTray.base', [0.36, 0.018, 0.56], [0, 0.009, 0], slateTrayMat);
  for (const [bIdx, bz, rot] of [
    [1, -0.13, 0.08],
    [2, 0.11, -0.06],
  ] as const) {
    const boot = new THREE.Group();
    boot.name = `simpleHouse.bootLobby.wellingtonBoot_${bIdx}`;
    boot.position.set(-0.02, 0.019, bz);
    boot.rotation.y = rot;
    addBox(boot, `${boot.name}.sole`, [0.24, 0.022, 0.095], [0.03, 0.011, 0], wellySoleMat);
    addBox(boot, `${boot.name}.vamp`, [0.22, 0.064, 0.088], [0.025, 0.055, 0], wellyMat);
    const shaft = new THREE.Mesh(sharedCylinderGeometry(0.052, 0.045, 0.32, 14), wellyMat);
    shaft.name = `${boot.name}.shaft`;
    shaft.position.set(-0.035, 0.22, 0);
    shaft.castShadow = true;
    boot.add(shaft);
    bootTrayGroup.add(boot);
  }
  const bootBasket = buildWhiteCompanyAccessories({
    kind: 'kubuStorageBasket',
    name: 'simpleHouse.bootLobby.kubuBasket',
    position: [-0.9, FFL_GROUND + 0.055, -3.45],
  });

  // Cloakroom WC: Crisp Wimborne White dado rail around Hague Blue walls + lower wainscot panels + Roman blind + brass towel ring
  const cloakDadoRail = createDadoRun({
    name: 'simpleHouse.cloakroom.dadoRail',
    path: [
      [0.06, -1.77],
      [1.15, -1.77],
      [1.15, -IN_Z],
      [0.06, -IN_Z],
    ],
    closed: true,
    roomSide: 'left',
    floorY: FFL_GROUND,
    elevationY: 0.98,
    profile: 'astragal-dado',
    height: 0.048,
    projection: 0.018,
    material: shell.schemes.houseCloakroom.trim,
    gaps: [
      { box: { minX: -0.02, maxX: 0.14, minZ: -2.85, maxZ: -1.85 }, cap: 'selfReturn' },
      { box: { minX: 0.42, maxX: 0.9, minZ: -4.3, maxZ: -4.14 }, cap: 'selfReturn' },
    ],
    cutawayWalls: [northCut],
    floor: 'ground',
    zone: 'houseCloakroom',
  });
  const cloakWainscotEast = addBox(
    cloakGroup,
    'simpleHouse.cloakroom.wainscotEast',
    [0.005, 0.81, 2.42],
    [1.1465, FFL_GROUND + 0.14 + 0.81 * 0.5, -2.995],
    shell.schemes.houseCloakroom.trim
  );
  cloakWainscotEast.castShadow = false;
  const cloakWainscotSouth = addBox(
    cloakGroup,
    'simpleHouse.cloakroom.wainscotSouth',
    [1.06, 0.81, 0.005],
    [0.6, FFL_GROUND + 0.14 + 0.81 * 0.5, -1.7735],
    shell.schemes.houseCloakroom.trim
  );
  cloakWainscotSouth.castShadow = false;

  const cloakTowelRing = buildPerrinRoweTowelRing({
    namePrefix: 'simpleHouse.cloakroom.towelRing',
    finish: 'SB',
  });
  cloakTowelRing.position.set(1.138, FFL_GROUND + 0.88, -2.62);
  cloakTowelRing.rotation.y = -Math.PI / 2;

  deconflictRomanBlind(buildWindowRomanBlind(ctx.scene, tagCutaway, {
    name: 'simpleHouse.cloakroom.romanBlind',
    zone: 'houseCloakroom',
    centerX: 0.66,
    width: 0.68,
    railY: FFL_GROUND + 2.42,
    bottomY: FFL_GROUND + 2.1,
    wallFaceZ: -IN_Z + 0.026,
    facingZ: 1,
    cutawayWall: northCut,
    parentGroup: cloakGroup,
  }), 1);

  cloakGroup.add(
    dadoWest,
    dadoNorth,
    bootBench,
    bootTrayGroup,
    bootBasket,
    bootLobbySconce,
    crapperWc,
    cloakWashstand,
    cloakMirror,
    paperHolder,
    cloakTowelRing,
    cloakDadoRail,
    cloakSconce
  );

  // =========================================================================
  // 4. Ground-Floor Corston Toggle Switches, Rotary Dimmer & Power Sockets
  // =========================================================================
  const hallSwitchIds: Record<number, string> = {
    1: 'sw-stair-bottom',
    2: 'sw-hall-lantern',
    3: 'sw-portico-lanterns',
  };
  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.sw.hallBottom',
    switchPa: 'plate-hall-bottom',
    location: 'Entrance hall foot of stairs',
    x: -1.147,
    y: FFL_GROUND + 1.15,
    z: 1.75,
    facing: 'east',
    mountedInZoneId: 'houseHall' as RoomZoneId,
    parentGroup: root,
    extraUserDataForGang: (gang): InteractiveUserData => ({
      electricalSwitchId: hallSwitchIds[gang],
    }),
    gangs: [
      { gang: 1, zoneId: 'houseLanding' as RoomZoneId, label: 'Stairwell 2-Way', circuitId: 'houseStairPendant' as CircuitId },
      { gang: 2, zoneId: 'houseHall' as RoomZoneId, label: 'Hallway Lantern', circuitId: 'houseHallLantern' as CircuitId },
      { gang: 3, zoneId: 'houseHall' as RoomZoneId, label: 'Portico Lanterns', circuitId: 'housePorticoLanterns' as CircuitId },
    ],
  });

  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.sw.drawing',
    switchPa: 'plate-drawing-door',
    location: 'Drawing room latch jamb',
    x: -1.393,
    y: FFL_GROUND + 1.15,
    z: 0.25,
    facing: 'west',
    mountedInZoneId: 'houseDrawing' as RoomZoneId,
    parentGroup: root,
    extraUserDataForGang: (): InteractiveUserData => ({ electricalSwitchId: 'sw-drawing' }),
    gangs: [
      { gang: 1, zoneId: 'houseDrawing' as RoomZoneId, label: 'Drawing Room Chandelier', circuitId: 'houseDrawingChandelier' as CircuitId },
    ],
  });

  const dimmerGroup = new THREE.Group();
  dimmerGroup.name = 'simpleHouse.dimmer.drawing';
  dimmerGroup.position.set(-1.393, FFL_GROUND + 1.15, 0.12);
  root.add(dimmerGroup);
  addBox(dimmerGroup, 'simpleHouse.dimmer.drawing.plate', [0.004, 0.088, 0.088], [-0.002, 0, 0], brassMats.primary);
  const dimmerKnob = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.019, 0.021, 0.02, 18)),
    brassMats.knurled
  );
  dimmerKnob.name = 'simpleHouse.dimmer.drawing.knob';
  dimmerKnob.rotation.z = Math.PI * 0.5;
  dimmerKnob.position.set(-0.015, 0, 0);
  dimmerKnob.userData = {
    electricalDimmerId: 'dimmer-house-drawing',
    zoneId: 'houseDrawing',
  };
  ctx.interactiveMeshes.push(dimmerKnob);
  dimmerGroup.add(dimmerKnob);

  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.sw.kitchen',
    switchPa: 'plate-kitchen',
    location: 'Kitchen hallway jamb',
    x: 1.393,
    y: FFL_GROUND + 1.15,
    z: 2.94,
    facing: 'east',
    mountedInZoneId: 'houseKitchenDiner' as RoomZoneId,
    parentGroup: root,
    extraUserDataForGang: (): InteractiveUserData => ({ electricalSwitchId: 'sw-kitchen' }),
    gangs: [
      { gang: 1, zoneId: 'houseKitchenDiner' as RoomZoneId, label: 'Kitchen & Dining Pendants', circuitId: 'houseKitchenPendants' as CircuitId },
    ],
  });

  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.sw.cloakroom',
    switchPa: 'plate-cloakroom',
    location: 'Boot lobby wall',
    x: -0.063,
    y: FFL_GROUND + 1.15,
    z: -2.95,
    facing: 'west',
    mountedInZoneId: 'houseCloakroom' as RoomZoneId,
    parentGroup: root,
    extraUserDataForGang: (): InteractiveUserData => ({ electricalSwitchId: 'sw-cloakroom' }),
    gangs: [
      { gang: 1, zoneId: 'houseCloakroom' as RoomZoneId, label: 'Cloakroom & Boot Lobby', circuitId: 'houseCloakroomSconces' as CircuitId },
    ],
  });

  root.add(
    buildCorstonPowerSocket(ctx, tagCutaway, {
      name: 'simpleHouse.socket.drawingNorth',
      zone: 'houseDrawing',
      kind: 'double',
      x: -1.393,
      y: FFL_GROUND + 0.45,
      z: -3.2,
      facing: 'west',
    }),
    buildCorstonPowerSocket(ctx, tagCutaway, {
      name: 'simpleHouse.socket.drawingSouth',
      zone: 'houseDrawing',
      kind: 'double',
      x: -1.393,
      y: FFL_GROUND + 0.45,
      z: 3.55,
      facing: 'west',
    }),
    buildCorstonPowerSocket(ctx, tagCutaway, {
      name: 'simpleHouse.socket.kitchenWorktop',
      zone: 'houseKitchenDiner',
      kind: 'double',
      x: 5.409,
      y: FFL_GROUND + 1.08,
      z: 0.95,
      facing: 'west',
      cutawayWall: eastCut,
    })
  );
}
