import * as THREE from 'three';
import type { CircuitId } from 'husjs';
import {
  addInteractiveShakerWardrobeDoor,
  buildCastIronColumnRadiator,
  buildHollowWardrobeInterior,
  buildTraditionalWindowCurtains,
  buildWindowRomanBlind,
  sharedCylinderGeometry,
  tagCutaway,
} from 'husjs/objects';
import {
  getPaleEuropeanOakJoineryMaterial,
} from 'husjs/catalog/architectural';
import {
  buildCoxDanicaBed,
  buildCuratedMirrorsArtAndRugs,
  buildGeorgianAntiqueCasework,
  buildWhiteCompanyAccessories,
  buildWhiteCompanyBedStyling,
} from 'husjs/catalog/furniture';
import { buildHeritageInteriorLighting } from 'husjs/catalog/lighting';
import {
  buildArmstrongPaperHolder,
  buildCrittallWalkInShowerAndTowelRail,
  buildLefroyBrooksCharterhouseWc,
  buildNeptuneChichesterVanity,
  buildPerrinRoweTowelRing,
  getBathroomBrassMaterials,
} from 'husjs/catalog/sanitaryware';
import type { SceneBuilderContext } from 'husjs/viewer';
import { IN_Z, type SimpleHouseShell } from './architecture.ts';
import { FFL_FIRST, FIRST_CEILING_SOFFIT_Y } from './electrical-and-rooms.ts';


import {
  NEPTUNE_SALT,
  addBox,
  buildCompactPleatedBedsideLamp,
  buildPrincipalEndOfBedBench,
  buildWideChichesterBedsideChest,
  deconflictCurtainBrackets,
  deconflictRomanBlind,
  stripBuiltInDanicaBedding,
} from './interiors-first-furniture.ts';
import {
  buildFamilyPhotoGalleryCluster,
  buildSingleBotanicalWatercolourFrame,
} from './interiors-first-art.ts';

export function buildSimpleHouseFirstWestAndLanding(
  ctx: SceneBuilderContext,
  shell: SimpleHouseShell,
  root: THREE.Group,
  firstCeilingGroup: THREE.Object3D
): void {
  const brassMats = getBathroomBrassMaterials('AB');
  const oakMat = getPaleEuropeanOakJoineryMaterial();
  const westCut = shell.cut('west', 'first');
  const northCut = shell.cut('north', 'first');
  const southCut = shell.cut('south', 'first');

  // =========================================================================
  // 1. Principal Bedroom & Walk-In Dressing Room (housePrincipalBed)
  // =========================================================================
  const principalGroup = new THREE.Group();
  principalGroup.name = 'simpleHouse.principalBedroom';
  principalGroup.userData.zoneId = 'housePrincipalBed';
  root.add(principalGroup);

  const principalRug = buildCuratedMirrorsArtAndRugs({
    kind: 'coxPebbleWool',
    name: 'simpleHouse.principal.pebbleWoolRug',
    widthM: 2.65,
    lengthM: 2.25,
    position: [-3.95, FFL_FIRST + 0.002, 1.285],
  });
  principalGroup.add(principalRug);

  const principalBed = buildCoxDanicaBed(principalGroup, {
    name: 'simpleHouse.principal.danicaKingBed',
    zone: 'housePrincipalBed',
    size: 'ukKing',
    position: [-5.375, FFL_FIRST + 0.022, 1.285],
    rotationY: 0,
  });
  stripBuiltInDanicaBedding(principalBed);

  const whiteCoBedding = buildWhiteCompanyBedStyling({
    name: 'simpleHouse.principal.whiteCompanyBedding',
    size: 'king',
    mattressTopY: 0.452,
    position: [-4.24, FFL_FIRST + 0.022, 1.285],
    rotationY: Math.PI / 2,
  });
  principalGroup.add(whiteCoBedding);

  // Pin #18: Tailored deep-buttoned Belgian linen & turned-oak end-of-bed ottoman bench
  const endOfBedBench = buildPrincipalEndOfBedBench(ctx, {
    name: 'simpleHouse.principal.endOfBedBench',
    position: [-2.86, FFL_FIRST + 0.002, 1.285],
    rotationY: Math.PI / 2,
    oakMat,
    brassMat: brassMats.primary,
  });
  principalGroup.add(endOfBedBench);

  // Pin #19: Wider 2-drawer Georgian / Neptune Chichester bedside chests (`650 W x 440 D x 670 H mm`)
  // paired with delicate `385 mm`-tall turned veined-alabaster bedside lamps (`Ø242 mm` empire linen shades)
  const bedsidePaintMat = shell.schemes.housePrincipalDressing.trim;
  for (const [tag, bz] of [
    ['north', 0.04],
    ['south', 2.53],
  ] as const) {
    const bedside = buildWideChichesterBedsideChest(ctx, {
      name: `simpleHouse.principal.bedside_${tag}`,
      position: [-5.18, FFL_FIRST + 0.001, bz],
      rotationY: Math.PI / 2,
      paintMat: bedsidePaintMat,
      brassMat: brassMats.primary,
    });
    const alabasterLamp = buildCompactPleatedBedsideLamp(ctx, {
      name: `simpleHouse.principal.alabasterLamp_${tag}`,
      position: [-5.18, FFL_FIRST + 0.671, bz],
      brassMat: brassMats.primary,
      circuitId: 'housePrincipalPendant' as CircuitId,
      alabasterBase: true,
    });
    tagCutaway(bedside, westCut);
    tagCutaway(alabasterLamp, westCut);
    principalGroup.add(bedside, alabasterLamp);
  }

  // George III bow-front mahogany chest on North wall of bedroom (`pN_east`, Z = -1.65)
  const bowChest = buildGeorgianAntiqueCasework(ctx, {
    kind: 'bowFrontChest',
    name: 'simpleHouse.principal.bowFrontChest',
    position: [-2.45, FFL_FIRST + 0.001, -1.33],
    rotationY: 0,
  });
  // Framed landscape painting centered above the George III bow-front chest + diffuser vignette
  const principalChestArt = buildCuratedMirrorsArtAndRugs({
    kind: 'constableLandscapeOil',
    name: 'simpleHouse.principal.chestPainting',
    widthM: 0.92,
    heightM: 0.66,
    position: [-2.45, FFL_FIRST + 1.24, -1.646],
    rotationY: 0,
  });
  const principalChestDiffuser = buildWhiteCompanyAccessories({
    kind: 'reedDiffuser',
    name: 'simpleHouse.principal.chestDiffuser',
    position: [-2.12, FFL_FIRST + 1.043, -1.33],
  });

  // Full-length oatmeal-linen triple-pinch-pleat curtains & cast-iron column radiator on Principal Bedroom South sash
  const principalCurtainsSouth = buildTraditionalWindowCurtains({
    groupName: 'simpleHouse.principal.curtainsSouth',
    poleName: 'simpleHouse.principal.curtainsSouth.pole',
    finialName: 'simpleHouse.principal.curtainsSouth.finial',
    bracketName: 'simpleHouse.principal.curtainsSouth.bracket',
    panelName: 'simpleHouse.principal.curtainsSouth.panel',
    headerName: 'simpleHouse.principal.curtainsSouth.header',
    hemName: 'simpleHouse.principal.curtainsSouth.hem',
    tieBackName: 'simpleHouse.principal.curtainsSouth.tieBack',
    centerZ: 0,
    halfWindowSpanZ: 0.62,
    poleExtensionZ: 0.28,
    stackWidthZ: 0.32,
    stackInnerInsetZ: 0.04,
    poleX: 0.088,
    wallFaceX: 0,
    inwardSignX: 1,
    poleY: FFL_FIRST + 2.34,
    floorY: FFL_FIRST,
    tieBackY: FFL_FIRST + 0.96,
    mainColorHex: 0xe3dacb,
    shadowColorHex: 0xbcae98,
    trimColorHex: 0xcfc2ae,
    brassMat: brassMats.primary,
  });
  principalCurtainsSouth.position.set(-3.35, 0, IN_Z);
  principalCurtainsSouth.rotation.y = Math.PI / 2;
  deconflictCurtainBrackets(principalCurtainsSouth, 1);
  tagCutaway(principalCurtainsSouth, southCut);

  const principalRadiator = buildCastIronColumnRadiator({
    name: 'simpleHouse.principal.radiator',
    zone: 'housePrincipalBed',
    cx: -3.35,
    floorY: FFL_FIRST + 0.001,
    cz: IN_Z - 0.12,
    width: 0.92,
    height: 0.54,
    rotationY: Math.PI / 2,
    brassMat: brassMats.primary,
  });
  tagCutaway(principalRadiator, southCut);

  principalGroup.add(bowChest, principalChestArt, principalChestDiffuser, principalCurtainsSouth, principalRadiator);

  // Dedicated Walk-In Dressing Room (`X in [-5.42, -3.59], Z in [-4.22, -1.77]`)
  // Pin #16: West full-height Shaker wardrobe bank retained; cramped `wardrobeEastNorth` removed!
  const wardrobeMat = shell.schemes.housePrincipalDressing.trim;
  const wDoorBaseY = FFL_FIRST + 0.085;
  const wTopY = FIRST_CEILING_SOFFIT_Y - 0.12;
  const wDoorH = wTopY - 0.048 - wDoorBaseY;

  const westFrontX = -4.92;
  buildHollowWardrobeInterior({
    parent: principalGroup,
    namePrefix: 'simpleHouse.dressing.wardrobeWest',
    openFace: '+x',
    uMin: -4.16,
    uMax: -1.86,
    frontCoord: westFrontX,
    depth: 0.485,
    roomFloorY: FFL_FIRST + 0.001,
    carcassBaseY: FFL_FIRST + 0.001,
    doorBaseY: wDoorBaseY,
    getCarcassTopY: () => wTopY,
    exteriorMat: wardrobeMat,
    brassMat: brassMats.primary,
    interactions: ctx.interactions,
    bays: [
      { id: 'bay1', uMin: -4.14, uMax: -3.4, preset: 'doubleHang' },
      { id: 'bay2', uMin: -3.38, uMax: -2.64, preset: 'longHangAndDrawers', registerHeroDrawer: false },
      { id: 'bay3', uMin: -2.62, uMax: -1.88, preset: 'threeDrawerChestAndLinen', registerHeroDrawer: false },
    ],
  });
  for (const [dTag, u0, u1, handleSide] of [
    ['door_1', -4.14, -3.4, 'left'],
    ['door_2', -3.38, -2.64, 'left'],
    ['door_3', -2.62, -1.88, 'right'],
  ] as const) {
    addInteractiveShakerWardrobeDoor(principalGroup, {
      name: `simpleHouse.dressing.wardrobeWest.${dTag}`,
      x: westFrontX + 0.015,
      yBot: wDoorBaseY,
      z: (u0 + u1) * 0.5,
      width: u1 - u0 - 0.006,
      heightLeft: wDoorH,
      heightRight: wDoorH,
      alongZ: true,
      normalSign: 1,
      handleSide,
      doorMat: wardrobeMat,
      brassMat: brassMats.primary,
      interactions: ctx.interactions,
    });
  }

  // Pin #17: Full-length Cox & Cox arched brass dressing mirror centered horizontally on the open
  // North Dressing Room wall between `wardrobeWest` front (`X = -4.905`) and `pDress` (`X = -3.590`)!
  const archedMirror = buildCuratedMirrorsArtAndRugs({
    kind: 'coxArchedBrass',
    name: 'simpleHouse.dressing.archedBrassMirror',
    widthM: 0.68,
    heightM: 1.58,
    position: [-4.248, FFL_FIRST + 0.165, -IN_Z + 0.006],
    rotationY: 0,
  });
  tagCutaway(archedMirror, northCut);

  // Dressing Room upholstered bouclé dressing stool/pouffe, framed botanical study & brass ceiling pendant (0 extra PointLights)
  const dressingPouffe = new THREE.Group();
  dressingPouffe.name = 'simpleHouse.dressing.bouclePouffe';
  dressingPouffe.position.set(-4.24, FFL_FIRST + 0.001, -3.55);
  const pouffePlinth = new THREE.Mesh(sharedCylinderGeometry(0.22, 0.225, 0.036, 22), brassMats.primary);
  pouffePlinth.name = 'simpleHouse.dressing.bouclePouffe.brassPlinth';
  pouffePlinth.position.y = 0.018;
  const pouffeMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.dressing.boucleMat',
    color: 0xe5ddd0,
    roughness: 0.9,
  });
  const pouffeBody = new THREE.Mesh(sharedCylinderGeometry(0.23, 0.23, 0.34, 24), pouffeMat);
  pouffeBody.name = 'simpleHouse.dressing.bouclePouffe.body';
  pouffeBody.position.y = 0.208;
  pouffeBody.castShadow = true;
  pouffeBody.receiveShadow = true;
  const pouffeCrown = new THREE.Mesh(sharedCylinderGeometry(0.215, 0.23, 0.055, 24), pouffeMat);
  pouffeCrown.name = 'simpleHouse.dressing.bouclePouffe.crown';
  pouffeCrown.position.y = 0.408;
  pouffeCrown.castShadow = true;
  dressingPouffe.add(pouffePlinth, pouffeBody, pouffeCrown);

  const dressingArt = buildSingleBotanicalWatercolourFrame({
    name: 'simpleHouse.dressing.botanicalPrint',
    position: [-3.594, FFL_FIRST + 1.48, -3.65],
    rotationY: -Math.PI / 2,
    brassMat: brassMats.primary,
  });

  firstCeilingGroup.add(
    buildHeritageInteriorLighting(ctx, {
      kind: 'coxFlutedPendant',
      name: 'simpleHouse.dressing.pendant',
      position: [-4.25, FIRST_CEILING_SOFFIT_Y - 0.01, -2.98],
      dropM: 0.34,
      circuitId: 'housePrincipalPendant' as CircuitId,
      createPointLight: false,
    })
  );

  principalGroup.add(archedMirror, dressingPouffe, dressingArt);

  firstCeilingGroup.add(
    buildHeritageInteriorLighting(ctx, {
      kind: 'chandelier6Arm',
      name: 'simpleHouse.principal.chandelier',
      position: [-3.345, FIRST_CEILING_SOFFIT_Y - 0.04, 1.285],
      dropM: 0.38,
      circuitId: 'housePrincipalPendant' as CircuitId,
      createPointLight: true,
    })
  );

  // =========================================================================
  // 2. Galleried First-Floor Landing Art & Family Photo Gallery (houseLanding)
  // =========================================================================
  const landingGroup = new THREE.Group();
  landingGroup.name = 'simpleHouse.landingGallery';
  landingGroup.userData.zoneId = 'houseLanding';
  root.add(landingGroup);

  // Pin #20: Framed Constable pastoral landscape oil painting on `pW_south` Landing (+X) face (`X = -1.150 m`)
  const landingPaintingSouth = buildCuratedMirrorsArtAndRugs({
    kind: 'constableLandscapeOil',
    name: 'simpleHouse.landing.constablePaintingSouth',
    widthM: 1.02,
    heightM: 0.74,
    position: [-1.146, FFL_FIRST + 1.07, 3.02],
    rotationY: Math.PI / 2,
  });

  // Pin #21: Companion framed heritage English landscape oil painting on `pW_south` North pier (`Z = -0.36 m`)
  const landingPaintingNorth = buildCuratedMirrorsArtAndRugs({
    kind: 'constableLandscapeOil',
    name: 'simpleHouse.landing.heritagePaintingNorth',
    widthM: 0.94,
    heightM: 0.7,
    position: [-1.146, FFL_FIRST + 1.09, -0.36],
    rotationY: Math.PI / 2,
  });

  // Pin #22: Symmetrical/organic 6-frame dark walnut & brushed-brass family photo gallery on `pE_south` (-X face, `X = +1.150 m`)
  const landingFamilyPhotos = buildFamilyPhotoGalleryCluster({
    name: 'simpleHouse.landing.familyPhotoGallery',
    position: [1.146, FFL_FIRST + 1.43, 1.35],
    rotationY: -Math.PI / 2,
    brassMat: brassMats.primary,
  });

  landingGroup.add(landingPaintingSouth, landingPaintingNorth, landingFamilyPhotos);

  // =========================================================================
  // 3. Jewel-Box Principal Ensuite (`2.20 x 2.45 m = 5.39 m²`, housePrincipalEnsuite)
  // =========================================================================
  const ensuiteGroup = new THREE.Group();
  ensuiteGroup.name = 'simpleHouse.principalEnsuite';
  ensuiteGroup.userData.zoneId = 'housePrincipalEnsuite';
  root.add(ensuiteGroup);

  // Tiled plumbing stud false-wall (`102 mm` deep) behind shower so recessed Zellige LED niche never penetrates North exterior wall
  const showerPlumbingStud = addBox(
    ensuiteGroup,
    'simpleHouse.ensuite.showerPlumbingWall',
    [1.26, 2.52, 0.102],
    [-2.82, FFL_FIRST + 1.262, -IN_Z + 0.055],
    shell.schemes.housePrincipalEnsuite.walls
  );
  tagCutaway(showerPlumbingStud, northCut);

  const ensuiteShower = buildCrittallWalkInShowerAndTowelRail({
    name: 'simpleHouse.ensuite.crittallShower',
    screenWidthM: 0.78,
    trayDepthM: 0.78,
    frameFinish: 'agedBrass',
    towelWarmerVariant: 'traditionalColumn',
    brassFinish: 'SB',
    includeShowerValveSet: true,
    position: [-2.82, FFL_FIRST + 0.001, -IN_Z + 0.108],
    rotationY: 0,
  });
  // Seat the floor-standing heated towel warmer's rear wall-stay roses (`X = -1.725 m`, east of the `1.26 m` plumbing stud)
  // flush against the North interior masonry wall (`Z = -IN_Z`) below the `sillY = 1.15 m` frosted sash window!
  const ensuiteTowelWarmer = ensuiteShower.getObjectByName('simpleHouse.ensuite.crittallShower.heatedTowelWarmer');
  if (ensuiteTowelWarmer) {
    ensuiteTowelWarmer.position.z = -0.106;
  }
  tagCutaway(ensuiteShower, northCut);

  const ensuiteVanity = buildNeptuneChichesterVanity(ctx, {
    name: 'simpleHouse.ensuite.chichesterDoubleVanity',
    variant: 'double',
    paintColor: NEPTUNE_SALT,
    brassFinish: 'SB',
    position: [-2.12, FFL_FIRST + 0.001, -2.055],
    rotationY: Math.PI,
  });
  const ensuiteMirror = buildCuratedMirrorsArtAndRugs({
    kind: 'coxRoundBrass',
    name: 'simpleHouse.ensuite.roundBrassMirror',
    widthM: 0.8,
    position: [-2.12, FFL_FIRST + 1.06, -1.776],
    rotationY: Math.PI,
  });
  const ensuiteSconceWest = buildHeritageInteriorLighting(ctx, {
    kind: 'coxFlutedSconce',
    name: 'simpleHouse.ensuite.sconceWest',
    position: [-2.64, FFL_FIRST + 1.48, -1.776],
    rotationY: Math.PI,
    circuitId: 'houseEnsuiteSconces' as CircuitId,
    createPointLight: true,
  });
  const ensuiteSconceEast = buildHeritageInteriorLighting(ctx, {
    kind: 'coxFlutedSconce',
    name: 'simpleHouse.ensuite.sconceEast',
    position: [-1.6, FFL_FIRST + 1.48, -1.776],
    rotationY: Math.PI,
    circuitId: 'houseEnsuiteSconces' as CircuitId,
    createPointLight: false,
  });

  const ensuiteWc = buildLefroyBrooksCharterhouseWc({
    namePrefix: 'simpleHouse.ensuite.charterhouseWc',
    finish: 'SB',
    variant: 'closeCoupled',
  });
  ensuiteWc.position.set(-1.398, FFL_FIRST + 0.001, -3.12);
  ensuiteWc.rotation.y = -Math.PI / 2;

  deconflictRomanBlind(buildWindowRomanBlind(ctx.scene, tagCutaway, {
    name: 'simpleHouse.ensuite.romanBlind',
    zone: 'housePrincipalEnsuite',
    centerX: -1.72,
    width: 0.68,
    railY: FFL_FIRST + 2.28,
    bottomY: FFL_FIRST + 1.98,
    wallFaceZ: -IN_Z + 0.026,
    facingZ: 1,
    cutawayWall: northCut,
    parentGroup: ensuiteGroup,
  }), 1);

  const ensuiteWcArt = buildSingleBotanicalWatercolourFrame({
    name: 'simpleHouse.ensuite.botanicalArt',
    position: [-1.394, FFL_FIRST + 1.42, -3.12],
    rotationY: -Math.PI / 2,
    brassMat: brassMats.primary,
  });
  const ensuitePaperHolder = buildArmstrongPaperHolder({
    namePrefix: 'simpleHouse.ensuite.paperHolder',
    finish: 'SB',
    style: 'traditional',
    coreClearanceM: 0.0008,
  });
  ensuitePaperHolder.position.set(-1.398, FFL_FIRST + 0.68, -2.68);
  ensuitePaperHolder.rotation.y = -Math.PI / 2;

  const ensuiteTowelRing = buildPerrinRoweTowelRing({
    namePrefix: 'simpleHouse.ensuite.towelRing',
    finish: 'SB',
  });
  ensuiteTowelRing.position.set(-1.398, FFL_FIRST + 1.05, -2.18);
  ensuiteTowelRing.rotation.y = -Math.PI / 2;

  ensuiteGroup.add(
    ensuiteShower,
    ensuiteVanity,
    ensuiteMirror,
    ensuiteSconceWest,
    ensuiteSconceEast,
    ensuiteWc,
    ensuiteWcArt,
    ensuitePaperHolder,
    ensuiteTowelRing
  );

}
