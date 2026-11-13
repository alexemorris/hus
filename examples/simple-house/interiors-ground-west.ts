import * as THREE from 'three';
import type { CircuitId, InteractiveUserData, RoomZoneId } from 'husjs';
import { createPaintMaterial } from 'husjs/materials';
import {
  attachAudioEmitter,
  buildCastIronColumnRadiator,
  buildCorstonPowerSocket,
  buildCorstonToggleSwitch,
  buildTraditionalWindowCurtains,
  buildWindowRomanBlind,
  createDadoRun,
  sharedCylinderGeometry,
  tagCollisionRole,
  tagCutaway,
} from 'husjs/objects';
import {
  buildGeorgianBolectionFireplace,
  buildNeptuneBootBenchAndPegRail,
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
import {
  buildFlutedBrassPictureLight,
  buildHeritageInteriorLighting,
} from 'husjs/catalog/lighting';
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
import {
  FB_GREEN_SMOKE,
  addBox,
  buildCorstonRotaryDimmerPlate,
  buildFullWidthGeorgianAlcoveBookcase,
  buildGeorgianCloakroomWashstand,
  buildRegencyMahoganyWritingDeskAndChair,
  createWarm2700kLedMaterial,
  deconflictCurtainBrackets,
  deconflictRomanBlind,
  registerCircuitEmissive,
} from './interiors-ground-helpers.ts';

function addCloakroomTgPanelSegment(
  parent: THREE.Object3D,
  name: string,
  axis: 'x' | 'z',
  spanM: number,
  center: readonly [number, number],
  paintMat: THREE.Material
): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  const botY = FFL_GROUND + 0.138;
  const topY = FFL_GROUND + 1.078;
  const h = topY - botY;
  const midY = (botY + topY) * 0.5;
  const nBoards = Math.max(3, Math.round(spanM / 0.095));
  const pitch = spanM / nBoards;

  for (let i = 0; i < nBoards; i++) {
    const offset = -spanM * 0.5 + (i + 0.5) * pitch;
    const size: [number, number, number] =
      axis === 'x' ? [pitch - 0.0035, h, 0.008] : [0.008, h, pitch - 0.0035];
    const pos: [number, number, number] =
      axis === 'x' ? [center[0] + offset, midY, center[1]] : [center[0], midY, center[1] + offset];
    const m = addBox(g, `${name}.board_${i + 1}`, size, pos, paintMat);
    m.castShadow = false;
  }
  parent.add(g);
  return g;
}

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
  const greenSmokeEggshellMat = createPaintMaterial({
    color: 'green-smoke',
    sheen: 'modern-eggshell',
  });
  const darkOakMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.joinery.vintageWalnutOakWest',
    color: 0x4b3524,
    roughness: 0.52,
  });

  const northCut = shell.cut('north', 'ground');
  const southCut = shell.cut('south', 'ground');
  const westCut = shell.cut('west', 'ground');

  // West Wing — Georgian Drawing Room (X ∈ [-7.05, -1.89], Z ∈ [-4.22, +4.22])
  const drawingGroup = new THREE.Group();
  drawingGroup.name = 'simpleHouse.drawingRoom';
  drawingGroup.userData.zoneId = 'houseDrawing';
  root.add(drawingGroup);

  // Masonry chimney breast cheeks & upper breast around Bath-stone bolection fireplace
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
    fenderWidthM: 1.48,
    fenderDepthM: 0.36,
    position: [-6.26, FFL_GROUND + 0.037, 0],
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

  // Full-width Georgian alcove bookcases w/ concealed 2700K LED wash on houseDrawingAccent (0 PointLights)
  const accentCircuit = 'houseDrawingAccent' as CircuitId;
  const bookcaseNorth = buildFullWidthGeorgianAlcoveBookcase(ctx, {
    name: 'simpleHouse.drawing.alcoveBookcaseNorth',
    widthM: 3.12,
    heightM: 2.69,
    baseDepthM: 0.43,
    upperDepthM: 0.31,
    paintMat: schoolHouseEggshellMat,
    oakMat: paleOakMat,
    brassMat: brassMats.primary,
    darkBrassMat: brassMats.darkShadow,
    accentCircuitId: accentCircuit,
    position: [-7.043, FFL_GROUND + 0.001, -2.575],
    rotationY: Math.PI / 2,
  });
  const bookcaseSouth = buildFullWidthGeorgianAlcoveBookcase(ctx, {
    name: 'simpleHouse.drawing.alcoveBookcaseSouth',
    widthM: 3.12,
    heightM: 2.69,
    baseDepthM: 0.43,
    upperDepthM: 0.31,
    paintMat: schoolHouseEggshellMat,
    oakMat: paleOakMat,
    brassMat: brassMats.primary,
    darkBrassMat: brassMats.darkShadow,
    accentCircuitId: accentCircuit,
    position: [-7.043, FFL_GROUND + 0.001, 2.575],
    rotationY: Math.PI / 2,
  });
  tagCutaway(bookcaseNorth, westCut);
  tagCutaway(bookcaseSouth, westCut);
  ctx.addGlowPool(accentCircuit, -6.70, FFL_GROUND + 0.90, -2.575, 0.85, 0.30);
  ctx.addGlowPool(accentCircuit, -6.70, FFL_GROUND + 0.90, 2.575, 0.85, 0.30);

  // 3.20 × 4.80 m antique Ziegler Oushak rug (tagged ignore for smooth first-person walkthrough)
  const drawingRug = buildCuratedMirrorsArtAndRugs({
    kind: 'zieglerOushak',
    name: 'simpleHouse.drawing.zieglerRug',
    widthM: 3.20,
    lengthM: 4.80,
    position: [-4.22, FFL_GROUND + 0.003, 0.15],
  });
  tagCollisionRole(drawingRug, 'ignore');
  const rugTopY = FFL_GROUND + 0.018;

  // Conversation square on rug: Long Island sofa + twin Olivia armchairs + Henley coffee table
  const sofa = buildNeptuneUpholsteredSofa({
    name: 'simpleHouse.drawing.longIslandSofa',
    model: 'longIsland',
    position: [-4.22, rugTopY, -1.45],
    rotationY: 0,
    interactions: ctx.interactions,
  });
  const armchairWest = buildNeptuneArmchair({
    name: 'simpleHouse.drawing.oliviaArmchairWest',
    model: 'olivia',
    position: [-5.08, rugTopY, 1.32],
    rotationY: Math.PI - 0.26,
    interactions: ctx.interactions,
  });
  const armchairEast = buildNeptuneArmchair({
    name: 'simpleHouse.drawing.oliviaArmchairEast',
    model: 'olivia',
    position: [-3.36, rugTopY, 1.32],
    rotationY: Math.PI + 0.26,
    interactions: ctx.interactions,
  });
  const coffeeTable = buildNeptuneOakTablesAndBedsides({
    name: 'simpleHouse.drawing.henleyCoffeeTable',
    kind: 'henleyCoffeeTable',
    position: [-4.22, rugTopY, 0.0],
    interactions: ctx.interactions,
  });
  const coffeeHurricane = buildWhiteCompanyAccessories({
    kind: 'glassHurricane',
    name: 'simpleHouse.drawing.coffeeHurricane',
    position: [-3.95, rugTopY + 0.452, 0.04],
  });

  // Weathered-oak side tables beside every seat + Portobello ceramic & turned-alabaster lamps (1 PointLight total)
  const lampsCircuit = 'houseDrawingLamps' as CircuitId;
  const sideTableSofaWest = buildNeptuneOakTablesAndBedsides({
    name: 'simpleHouse.drawing.sofaSideTableWest',
    kind: 'chichesterBedsideTable',
    paintColor: 0xdfd9cc,
    position: [-5.54, rugTopY, -1.45],
    interactions: ctx.interactions,
  });
  const sideTableSofaEast = buildNeptuneOakTablesAndBedsides({
    name: 'simpleHouse.drawing.sofaSideTableEast',
    kind: 'chichesterBedsideTable',
    paintColor: 0xdfd9cc,
    position: [-2.90, rugTopY, -1.45],
    interactions: ctx.interactions,
  });
  const sideTableArmchairsCenter = buildNeptuneOakTablesAndBedsides({
    name: 'simpleHouse.drawing.armchairSideTableCenter',
    kind: 'chichesterBedsideTable',
    paintColor: 0xdfd9cc,
    position: [-4.22, rugTopY, 1.44],
    rotationY: Math.PI,
    interactions: ctx.interactions,
  });
  const sideTableArmchairEast = buildNeptuneOakTablesAndBedsides({
    name: 'simpleHouse.drawing.armchairSideTableEast',
    kind: 'chichesterBedsideTable',
    paintColor: 0xdfd9cc,
    position: [-5.48, rugTopY, 0.55],
    rotationY: Math.PI / 2,
    interactions: ctx.interactions,
  });

  const lampSofaWest = buildHeritageInteriorLighting(ctx, {
    kind: 'whiteCoCeramicLamp',
    name: 'simpleHouse.drawing.sofaLampWest',
    position: [-5.54, rugTopY + 0.721, -1.45],
    circuitId: lampsCircuit,
    createPointLight: false,
  });
  const lampSofaEast = buildHeritageInteriorLighting(ctx, {
    kind: 'whiteCoCeramicLamp',
    name: 'simpleHouse.drawing.sofaLampEast',
    position: [-2.90, rugTopY + 0.721, -1.45],
    circuitId: lampsCircuit,
    createPointLight: false,
  });
  // Single central PointLight for the entire houseDrawingLamps 5A circuit
  const lampArmchairsCenter = buildHeritageInteriorLighting(ctx, {
    kind: 'whiteCoAlabasterLamp',
    name: 'simpleHouse.drawing.armchairAlabasterLampCenter',
    position: [-4.22, rugTopY + 0.721, 1.44],
    circuitId: lampsCircuit,
    createPointLight: true,
    pointLightIntensity: 1.4,
  });
  const lampArmchairEast = buildHeritageInteriorLighting(ctx, {
    kind: 'whiteCoAlabasterLamp',
    name: 'simpleHouse.drawing.armchairAlabasterLampEast',
    position: [-5.48, rugTopY + 0.721, 0.55],
    circuitId: lampsCircuit,
    createPointLight: false,
  });

  // Demi-lune flame-mahogany card table + alabaster lamp on East spine wall (clear of hallDrawing swing)
  const cardTable = buildGeorgianAntiqueCasework(ctx, {
    kind: 'demiLuneCardTable',
    name: 'simpleHouse.drawing.demiLuneCardTable',
    position: [-2.16, FFL_GROUND + 0.001, 1.45],
    rotationY: -Math.PI / 2,
  });
  const cardTableLamp = buildHeritageInteriorLighting(ctx, {
    kind: 'whiteCoAlabasterLamp',
    name: 'simpleHouse.drawing.cardTableLamp',
    position: [-2.14, FFL_GROUND + 0.747, 1.45],
    circuitId: lampsCircuit,
    createPointLight: false,
  });

  ctx.addGlowPool(lampsCircuit, -5.80, FFL_GROUND + 0.74, -1.45, 0.68, 0.34);
  ctx.addGlowPool(lampsCircuit, -3.10, FFL_GROUND + 0.74, -1.45, 0.68, 0.34);
  ctx.addGlowPool(lampsCircuit, -3.10, FFL_GROUND + 0.74, 2.04, 0.62, 0.30);
  ctx.addGlowPool(lampsCircuit, -2.14, FFL_GROUND + 0.75, 1.45, 0.62, 0.30);

  // Regency flame-mahogany writing desk & sabre-leg chair in rear North sash bay (X = -2.65)
  const writingDesk = buildRegencyMahoganyWritingDeskAndChair({
    name: 'simpleHouse.drawing.regencyWritingDesk',
    brassMat: brassMats.primary,
    darkBrassMat: brassMats.darkShadow,
    position: [-2.65, FFL_GROUND + 0.001, -3.45],
  });

  // Constable pastoral oil painting on East spine wall + fluted-brass picture light on houseDrawingAccent
  const constableOil = buildCuratedMirrorsArtAndRugs({
    kind: 'constableLandscapeOil',
    name: 'simpleHouse.drawing.constableOil',
    position: [-1.894, FFL_GROUND + 1.24, 0.0],
    rotationY: -Math.PI / 2,
  });
  const picLightGlowMat = createWarm2700kLedMaterial('simpleHouse.drawing.pictureLightGlow', 1.6);
  registerCircuitEmissive(ctx, accentCircuit, picLightGlowMat);
  const constablePictureLight = buildFlutedBrassPictureLight(
    {
      brass: brassMats.primary,
      darkBrass: brassMats.darkShadow,
      glow: picLightGlowMat,
    },
    {
      name: 'simpleHouse.drawing.constablePictureLight',
      zone: 'houseDrawing',
      shadeWidth: 0.56,
    }
  );
  constablePictureLight.position.set(-1.892, FFL_GROUND + 2.16, 0.0);
  constablePictureLight.rotation.y = -Math.PI / 2;
  ctx.addGlowPool(accentCircuit, -2.02, FFL_GROUND + 1.58, 0.0, 0.72, 0.36);

  const botanicalGrid = buildCuratedMirrorsArtAndRugs({
    kind: 'curtisBotanicalGrid',
    name: 'simpleHouse.drawing.curtisBotanicals',
    botanicalLayout: '2x2',
    position: [-1.894, FFL_GROUND + 1.24, -1.65],
    rotationY: -Math.PI / 2,
  });

  // Curtains on drawingSouthWest (-5.35), drawingSouthEast (-2.95) & drawingNorth (-2.65)
  for (const [idTag, cx] of [
    ['SouthWest', -5.35],
    ['SouthEast', -2.95],
  ] as const) {
    const base = `simpleHouse.drawing.curtains${idTag}`;
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
      mainColorHex: 0xd6d4ca,
      shadowColorHex: 0xadb0a4,
      trimColorHex: 0xc2c2b6,
      brassMat: brassMats.primary,
    });
    curt.position.set(cx, 0, IN_Z - 0.055);
    curt.rotation.y = Math.PI / 2;
    deconflictCurtainBrackets(curt, 1);
    tagCutaway(curt, southCut);
    drawingGroup.add(curt);
  }

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
    halfWindowSpanZ: 0.56,
    poleExtensionZ: 0.22,
    stackWidthZ: 0.26,
    stackInnerInsetZ: 0.04,
    poleX: 0.115,
    wallFaceX: 0.002,
    inwardSignX: 1,
    poleY: FFL_GROUND + 2.60,
    floorY: FFL_GROUND + 0.002,
    tieBackY: FFL_GROUND + 0.98,
    mainColorHex: 0xd6d4ca,
    shadowColorHex: 0xadb0a4,
    trimColorHex: 0xc2c2b6,
    brassMat: brassMats.primary,
  });
  drawingCurtainsNorth.position.set(-2.65, 0, -IN_Z);
  drawingCurtainsNorth.rotation.y = -Math.PI / 2;
  deconflictCurtainBrackets(drawingCurtainsNorth, 1);
  tagCutaway(drawingCurtainsNorth, northCut);

  const drawingRadSouth = buildCastIronColumnRadiator({
    name: 'simpleHouse.drawing.radiatorSouth',
    zone: 'houseDrawing',
    cx: -4.15,
    floorY: FFL_GROUND + 0.001,
    cz: IN_Z - 0.11,
    width: 0.82,
    rotationY: Math.PI / 2,
    brassMat: brassMats.primary,
  });
  tagCutaway(drawingRadSouth, southCut);

  const drawingRadNorth = buildCastIronColumnRadiator({
    name: 'simpleHouse.drawing.radiatorNorth',
    zone: 'houseDrawing',
    cx: -3.96,
    floorY: FFL_GROUND + 0.001,
    cz: -IN_Z + 0.11,
    width: 0.72,
    rotationY: -Math.PI / 2,
    brassMat: brassMats.primary,
  });
  tagCutaway(drawingRadNorth, northCut);

  drawingGroup.add(
    fireplace,
    clubFender,
    overmantel,
    bookcaseNorth,
    bookcaseSouth,
    drawingRug,
    sofa,
    armchairWest,
    armchairEast,
    coffeeTable,
    coffeeHurricane,
    sideTableSofaWest,
    sideTableSofaEast,
    sideTableArmchairsCenter,
    sideTableArmchairEast,
    lampSofaWest,
    lampSofaEast,
    lampArmchairsCenter,
    lampArmchairEast,
    cardTable,
    cardTableLamp,
    writingDesk,
    constableOil,
    constablePictureLight,
    botanicalGrid,
    drawingCurtainsNorth,
    drawingRadSouth,
    drawingRadNorth
  );

  groundCeilingGroup.add(
    buildHeritageInteriorLighting(ctx, {
      kind: 'chandelier6Arm',
      name: 'simpleHouse.drawing.chandelier',
      position: [-4.47, GROUND_CEILING_SOFFIT_Y - 0.032, 0],
      dropM: 0.48,
      circuitId: 'houseDrawingChandelier' as CircuitId,
      createPointLight: true,
      pointLightIntensity: 1.65,
    })
  );

  // Drawing Room 3-gang Corston toggle switch + 3-gang rotary dimmer plate (X = -1.892, Z = 2.86)
  const drawingSwitchIds: Record<number, string> = {
    1: 'sw-drawing-main',
    2: 'sw-drawing-lamps',
    3: 'sw-drawing-accent',
  };
  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.sw.drawing',
    switchPa: 'plate-drawing-door',
    location: 'Drawing room latch jamb',
    x: -1.892,
    y: FFL_GROUND + 1.15,
    z: 2.86,
    facing: 'west',
    mountedInZoneId: 'houseDrawing' as RoomZoneId,
    parentGroup: drawingGroup,
    extraUserDataForGang: (gang): InteractiveUserData => ({
      electricalSwitchId: drawingSwitchIds[gang],
    }),
    gangs: [
      { gang: 1, zoneId: 'houseDrawing' as RoomZoneId, label: 'Chandelier Master', circuitId: 'houseDrawingChandelier' as CircuitId },
      { gang: 2, zoneId: 'houseDrawing' as RoomZoneId, label: '5A Table Lamps', circuitId: 'houseDrawingLamps' as CircuitId },
      { gang: 3, zoneId: 'houseDrawing' as RoomZoneId, label: 'Picture Lights & Bookcase Wash', circuitId: 'houseDrawingAccent' as CircuitId },
    ],
  });

  buildCorstonRotaryDimmerPlate(ctx, {
    name: 'simpleHouse.dimmer.drawing',
    zoneId: 'houseDrawing' as RoomZoneId,
    x: -1.892,
    y: FFL_GROUND + 1.01,
    z: 2.86,
    facing: 'west',
    brassMat: brassMats.primary,
    knurledBrassMat: brassMats.knurled,
    parent: drawingGroup,
    dimmers: [
      { dimmerId: 'dimmer-house-drawing', circuitId: 'houseDrawingChandelier' as CircuitId, label: 'Drawing Room Chandelier Dimmer' },
      { dimmerId: 'dimmer-drawing-lamps', circuitId: 'houseDrawingLamps' as CircuitId, label: 'Drawing Room 5A Table Lamps Dimmer' },
      { dimmerId: 'dimmer-drawing-accent', circuitId: 'houseDrawingAccent' as CircuitId, label: 'Drawing Picture Lights & Bookcase Dimmer' },
    ],
  });

  drawingGroup.add(
    buildCorstonPowerSocket(ctx, tagCutaway, {
      name: 'simpleHouse.socket.drawingNorth',
      zone: 'houseDrawing',
      kind: 'double',
      x: -1.892,
      y: FFL_GROUND + 0.42,
      z: -2.95,
      facing: 'west',
    }),
    buildCorstonPowerSocket(ctx, tagCutaway, {
      name: 'simpleHouse.socket.drawingSouth',
      zone: 'houseDrawing',
      kind: 'double',
      x: -1.892,
      y: FFL_GROUND + 0.42,
      z: 2.45,
      facing: 'west',
    })
  );

  // Garden Boot & Mudroom Lobby (X ∈ [-1.65, -0.31], Z ∈ [-4.22, -1.77])
  const bootGroup = new THREE.Group();
  bootGroup.name = 'simpleHouse.bootLobbySuite';
  bootGroup.userData.zoneId = 'houseBootLobby';
  root.add(bootGroup);

  const bootBench = buildNeptuneBootBenchAndPegRail({
    name: 'simpleHouse.bootLobby.bootBench',
    widthM: 1.15,
    depthM: 0.42,
    paintColor: FB_GREEN_SMOKE,
    position: [-1.63, FFL_GROUND + 0.001, -2.98],
    rotationY: Math.PI / 2,
    interactions: ctx.interactions,
  });

  const bootBasket = buildWhiteCompanyAccessories({
    kind: 'kubuStorageBasket',
    name: 'simpleHouse.bootLobby.kubuBasket',
    position: [-1.42, FFL_GROUND + 0.002, -2.14],
  });

  const bootTrayGroup = new THREE.Group();
  bootTrayGroup.name = 'simpleHouse.bootLobby.slateBootTray';
  bootTrayGroup.position.set(-1.42, FFL_GROUND + 0.002, -3.86);
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
  addBox(bootTrayGroup, 'simpleHouse.bootLobby.slateBootTray.base', [0.34, 0.018, 0.50], [0, 0.009, 0], slateTrayMat);
  for (const [bIdx, bz, rot] of [
    [1, -0.11, 0.08],
    [2, 0.11, -0.06],
  ] as const) {
    const boot = new THREE.Group();
    boot.name = `simpleHouse.bootLobby.wellingtonBoot_${bIdx}`;
    boot.position.set(-0.02, 0.019, bz);
    boot.rotation.y = rot;
    addBox(boot, `${boot.name}.sole`, [0.23, 0.022, 0.092], [0.03, 0.011, 0], wellySoleMat);
    addBox(boot, `${boot.name}.vamp`, [0.21, 0.062, 0.086], [0.025, 0.054, 0], wellyMat);
    const shaft = new THREE.Mesh(sharedCylinderGeometry(0.05, 0.044, 0.31, 14), wellyMat);
    shaft.name = `${boot.name}.shaft`;
    shaft.position.set(-0.035, 0.215, 0);
    shaft.castShadow = true;
    boot.add(shaft);
    bootTrayGroup.add(boot);
  }

  const bootRadiator = buildCastIronColumnRadiator({
    name: 'simpleHouse.bootLobby.radiator',
    zone: 'houseBootLobby',
    cx: -0.42,
    floorY: FFL_GROUND + 0.001,
    cz: -2.98,
    width: 0.72,
    rotationY: 0,
    brassMat: brassMats.primary,
  });

  const bootCircuit = 'houseBootLantern' as CircuitId;
  const bootLobbySconce = buildHeritageInteriorLighting(ctx, {
    kind: 'coxFlutedSconce',
    name: 'simpleHouse.bootLobby.sconce',
    position: [-0.313, FFL_GROUND + 1.72, -2.98],
    rotationY: -Math.PI / 2,
    circuitId: bootCircuit,
    createPointLight: false,
  });
  ctx.addGlowPool(bootCircuit, -0.82, FFL_GROUND + 1.25, -2.98, 0.92, 0.40);

  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.sw.bootLobby',
    switchPa: 'plate-boot-lobby',
    location: 'Boot lobby door jamb',
    x: -0.46,
    y: FFL_GROUND + 1.15,
    z: -1.772,
    facing: 'north',
    mountedInZoneId: 'houseBootLobby' as RoomZoneId,
    parentGroup: bootGroup,
    extraUserDataForGang: (): InteractiveUserData => ({ electricalSwitchId: 'sw-boot-lobby' }),
    gangs: [
      { gang: 1, zoneId: 'houseBootLobby' as RoomZoneId, label: 'Boot Lobby Lantern', circuitId: bootCircuit },
    ],
  });

  bootGroup.add(bootBench, bootBasket, bootTrayGroup, bootRadiator, bootLobbySconce);

  // Guests' Powder Room (X ∈ [-0.19, +1.65], Z ∈ [-4.22, -1.77])
  const cloakGroup = new THREE.Group();
  cloakGroup.name = 'simpleHouse.cloakroomSuite';
  cloakGroup.userData.zoneId = 'houseCloakroom';
  root.add(cloakGroup);

  // Half-height F&B Green Smoke T&G panelling (cleanly above skirting & gapped for hallWc door)
  const tgNorth = addCloakroomTgPanelSegment(cloakGroup, 'simpleHouse.cloakroom.tgDadoNorth', 'x', 1.80, [0.73, -IN_Z + 0.006], greenSmokeEggshellMat);
  tagCutaway(tgNorth, northCut);
  addCloakroomTgPanelSegment(cloakGroup, 'simpleHouse.cloakroom.tgDadoEast', 'z', 2.41, [1.644, -2.995], greenSmokeEggshellMat);
  addCloakroomTgPanelSegment(cloakGroup, 'simpleHouse.cloakroom.tgDadoWest', 'z', 2.41, [-0.184, -2.995], greenSmokeEggshellMat);
  addCloakroomTgPanelSegment(cloakGroup, 'simpleHouse.cloakroom.tgDadoSouthEast', 'x', 0.84, [1.21, -1.776], greenSmokeEggshellMat);

  const cloakDadoRail = createDadoRun({
    name: 'simpleHouse.cloakroom.dadoRail',
    path: [
      [-0.19, -1.77],
      [1.65, -1.77],
      [1.65, -IN_Z],
      [-0.19, -IN_Z],
    ],
    closed: true,
    roomSide: 'left',
    floorY: FFL_GROUND,
    elevationY: 1.08,
    profile: 'astragal-dado',
    height: 0.048,
    projection: 0.018,
    material: greenSmokeEggshellMat,
    gaps: [
      { box: { minX: -0.18, maxX: 0.785, minZ: -1.86, maxZ: -1.68 }, cap: 'selfReturn' },
    ],
    cutawayWalls: [northCut],
    floor: 'ground',
    zone: 'houseCloakroom',
  });

  // Georgian Carrara marble washstand on East wall ([1.36, 0, -2.85]) + Cox round brass mirror
  const cloakWashstand = buildGeorgianCloakroomWashstand(
    'simpleHouse.cloakroom.washstand',
    brassMats.primary,
    carraraMat,
    darkOakMat
  );
  cloakWashstand.position.set(1.36, FFL_GROUND + 0.001, -2.85);
  cloakWashstand.rotation.y = -Math.PI / 2;

  const cloakMirror = buildCuratedMirrorsArtAndRugs({
    kind: 'coxRoundBrass',
    name: 'simpleHouse.cloakroom.coxRoundMirror',
    widthM: 0.56,
    position: [1.646, FFL_GROUND + 1.22, -2.85],
    rotationY: -Math.PI / 2,
  });

  // Twin IP44 fluted-glass & brass vanity sconces flanking mirror at face height (Y = 1.60 m, 1 PointLight only)
  const cloakCircuit = 'houseCloakroomSconces' as CircuitId;
  const cloakSconceNorth = buildHeritageInteriorLighting(ctx, {
    kind: 'coxFlutedSconce',
    name: 'simpleHouse.cloakroom.sconceNorth',
    position: [1.646, FFL_GROUND + 1.60, -3.28],
    rotationY: -Math.PI / 2,
    circuitId: cloakCircuit,
    createPointLight: true,
    pointLightIntensity: 1.35,
  });
  const cloakSconceSouth = buildHeritageInteriorLighting(ctx, {
    kind: 'coxFlutedSconce',
    name: 'simpleHouse.cloakroom.sconceSouth',
    position: [1.646, FFL_GROUND + 1.60, -2.42],
    rotationY: -Math.PI / 2,
    circuitId: cloakCircuit,
    createPointLight: false,
  });
  ctx.addGlowPool(cloakCircuit, 1.28, FFL_GROUND + 1.05, -2.85, 0.88, 0.34);

  // Thomas Crapper low-level WC on North wall ([0.85, 0, -4.21]) under frosted sash + Roman blind
  const crapperWc = buildThomasCrapperLowLevelWc({
    namePrefix: 'simpleHouse.cloakroom.thomasCrapperWc',
    finish: 'SB',
    seatFinish: 'darkOak',
    mitreBracketFlange: true,
  });
  crapperWc.position.set(0.85, FFL_GROUND + 0.001, -4.205);
  tagCutaway(crapperWc, northCut);

  deconflictRomanBlind(
    buildWindowRomanBlind(ctx.scene, tagCutaway, {
      name: 'simpleHouse.cloakroom.romanBlind',
      zone: 'houseCloakroom',
      centerX: 0.85,
      width: 0.74,
      railY: FFL_GROUND + 2.34,
      bottomY: FFL_GROUND + 2.02,
      wallFaceZ: -IN_Z + 0.028,
      facingZ: 1,
      cutawayWall: northCut,
      parentGroup: cloakGroup,
    }),
    1
  );

  const cloakTowelRing = buildPerrinRoweTowelRing({
    namePrefix: 'simpleHouse.cloakroom.towelRing',
    finish: 'SB',
  });
  cloakTowelRing.position.set(1.638, FFL_GROUND + 0.90, -2.42);
  cloakTowelRing.rotation.y = -Math.PI / 2;

  const paperHolder = buildArmstrongPaperHolder({
    namePrefix: 'simpleHouse.cloakroom.paperHolder',
    finish: 'SB',
    style: 'traditional',
    coreClearanceM: 0.0008,
  });
  paperHolder.position.set(1.638, FFL_GROUND + 0.68, -3.68);
  paperHolder.rotation.y = -Math.PI / 2;

  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.sw.cloakroom',
    switchPa: 'plate-cloakroom',
    location: 'Powder room latch jamb',
    x: 0.92,
    y: FFL_GROUND + 1.18,
    z: -1.772,
    facing: 'north',
    mountedInZoneId: 'houseCloakroom' as RoomZoneId,
    parentGroup: cloakGroup,
    extraUserDataForGang: (): InteractiveUserData => ({ electricalSwitchId: 'sw-cloakroom' }),
    gangs: [
      { gang: 1, zoneId: 'houseCloakroom' as RoomZoneId, label: 'Cloakroom Vanity Sconces', circuitId: cloakCircuit },
    ],
  });

  cloakGroup.add(
    cloakDadoRail,
    cloakWashstand,
    cloakMirror,
    cloakSconceNorth,
    cloakSconceSouth,
    crapperWc,
    cloakTowelRing,
    paperHolder
  );
}
