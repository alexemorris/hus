import * as THREE from 'three';
import type { CircuitId, InteractiveUserData, RoomZoneId } from 'husjs';
import {
  buildCastIronColumnRadiator,
  buildCorstonPowerSocket,
  buildCorstonToggleSwitch,
  buildTraditionalWindowCurtains,
  buildWindowRomanBlind,
  createDadoRun,
  tagCollisionRole,
  tagCutaway,
} from 'husjs/objects';
import {
  buildTongueAndGrooveDadoPanelling,
  getPaleEuropeanOakJoineryMaterial,
} from 'husjs/catalog/architectural';
import {
  buildCoxDanicaBed,
  buildCoxNivalaDesk,
  buildCuratedMirrorsArtAndRugs,
  buildGeorgianAntiqueCasework,
  buildNeptuneOakTablesAndBedsides,
} from 'husjs/catalog/furniture';
import {
  buildFlutedBrassPictureLight,
  buildHeritageInteriorLighting,
} from 'husjs/catalog/lighting';
import {
  buildArmstrongConcealedShowerSet,
  buildArmstrongFreestandingBathMixer,
  buildArmstrongPaperHolder,
  buildArmstrongRobeHook,
  buildBcDesignsCopperBoatBath,
  buildLefroyBrooksCharterhouseWc,
  buildLefroyBrooksLissaDoonWashstand,
  getBathroomBrassMaterials,
  getHonedCarraraMarbleMaterial,
} from 'husjs/catalog/sanitaryware';
import type { SceneBuilderContext } from 'husjs/viewer';
import { IN_X, IN_Z, type SimpleHouseShell } from './architecture.ts';
import { FFL_FIRST, FIRST_CEILING_SOFFIT_Y } from './electrical-and-rooms.ts';
import {
  FB_MIZZLE,
  addBox,
  buildEnglishLibraryLoveseat,
  buildWalnutLibrarySideTableAndLamp,
  createWarm2700kLedMaterial,
  deconflictCurtainBrackets,
  deconflictRomanBlind,
  registerCircuitEmissive,
} from './interiors-first-furniture.ts';
import {
  buildAiringCupboardFittings,
  buildAntiquarianMapDiptych,
  buildArticulatedBrassDeskLamp,
  buildSingleBotanicalWatercolourFrame,
} from './interiors-first-art.ts';
import { buildSimpleHouseFirstWestAndLanding } from './interiors-first-west.ts';

export function buildSimpleHouseFirstInteriors(
  ctx: SceneBuilderContext,
  shell: SimpleHouseShell,
  firstCeilingGroupArg?: THREE.Object3D
): THREE.Group {
  const firstGroup = ctx.floor ? ctx.floor('first').group : ctx.firstFloorMeshGroup;
  const firstCeilingGroup =
    firstCeilingGroupArg ?? (ctx.floor ? ctx.floor('first').ceilingGroup : ctx.ceilingMeshGroup);

  const root = new THREE.Group();
  root.name = 'simpleHouse.interiors.first';
  firstGroup.add(root);

  const brassMats = getBathroomBrassMaterials('AB');
  const polishedBrassMats = getBathroomBrassMaterials('BR');
  const oakMat = getPaleEuropeanOakJoineryMaterial();
  const carraraMat = getHonedCarraraMarbleMaterial();

  const eastCut = shell.cut('east', 'first');
  const northCut = shell.cut('north', 'first');
  const southCut = shell.cut('south', 'first');

  // Principal Bedroom, Walk-In Dressing, Landing Gallery & Principal Ensuite
  buildSimpleHouseFirstWestAndLanding(ctx, shell, root, firstCeilingGroup);

  // Guest Bedroom 2 (X in [+1.89, +7.05], Z in [-0.10, +4.22])
  const guestGroup = new THREE.Group();
  guestGroup.name = 'simpleHouse.guestBedroom';
  guestGroup.userData.zoneId = 'houseBedroom2';
  root.add(guestGroup);

  const guestRug = buildCuratedMirrorsArtAndRugs({
    kind: 'zieglerOushak',
    name: 'simpleHouse.guest.zieglerRug',
    widthM: 2.4,
    lengthM: 2.9,
    position: [4.47, FFL_FIRST + 0.003, 1.65],
  });
  tagCollisionRole(guestRug, 'ignore');
  guestGroup.add(guestRug);

  // Double Danica bed (headboard back at Z = -0.08 against North partition pG Z = -0.10, center at Z = +0.97)
  buildCoxDanicaBed(guestGroup, {
    name: 'simpleHouse.guest.danicaDoubleBed',
    zone: 'houseBedroom2',
    size: 'ukDouble',
    position: [4.47, FFL_FIRST + 0.02, -0.08],
    rotationY: -Math.PI / 2,
  });

  // Twin Chichester bedsides topped with Portobello ceramic bedside lamps on houseBed2Lamps
  const bed2LampsCircuit = 'houseBed2Lamps' as CircuitId;
  for (const [tag, bx] of [
    ['west', 3.32],
    ['east', 5.62],
  ] as const) {
    const bedside = buildNeptuneOakTablesAndBedsides({
      name: `simpleHouse.guest.bedside_${tag}`,
      kind: 'chichesterBedsideTable',
      position: [bx, FFL_FIRST + 0.001, 0.18],
      rotationY: 0,
      interactions: ctx.interactions,
    });
    const gourdLamp = buildHeritageInteriorLighting(ctx, {
      kind: 'whiteCoCeramicLamp',
      name: `simpleHouse.guest.portobelloLamp_${tag}`,
      position: [bx, FFL_FIRST + 0.722, 0.18],
      circuitId: bed2LampsCircuit,
      createPointLight: false,
    });
    ctx.addGlowPool(bed2LampsCircuit, bx, FFL_FIRST + 0.726, 0.18, 0.62, 0.3);
    guestGroup.add(bedside, gourdLamp);
  }

  // George III bow-front mahogany chest on East wall South of guestEast sash (Z = +2.10)
  const guestBowChest = buildGeorgianAntiqueCasework(ctx, {
    kind: 'bowFrontChest',
    name: 'simpleHouse.guest.bowFrontChest',
    position: [6.75, FFL_FIRST + 0.001, 3.45],
    rotationY: -Math.PI / 2,
  });
  guestGroup.add(guestBowChest);

  const guestHeadboardArt = buildSingleBotanicalWatercolourFrame({
    name: 'simpleHouse.guest.headboardBotanicalArt',
    position: [4.47, FFL_FIRST + 1.48, -0.096],
    rotationY: 0,
    brassMat: brassMats.primary,
  });
  const guestBotanicals = buildCuratedMirrorsArtAndRugs({
    kind: 'curtisBotanicalGrid',
    name: 'simpleHouse.guest.botanicalPrints',
    botanicalLayout: '1x4',
    position: [1.894, FFL_FIRST + 1.34, 1.35],
    rotationY: Math.PI / 2,
  });
  guestGroup.add(guestHeadboardArt, guestBotanicals);

  // Full-length blush-oatmeal curtains on guestSouthWest (+2.95), guestSouthEast (+5.35) & guestEast (Z = +2.10)
  for (const [sTag, sx] of [
    ['SouthWest', 2.95],
    ['SouthEast', 5.35],
  ] as const) {
    const baseName = `simpleHouse.guest.curtains${sTag}`;
    const curtains = buildTraditionalWindowCurtains({
      groupName: baseName,
      poleName: `${baseName}.pole`,
      finialName: `${baseName}.finial`,
      bracketName: `${baseName}.bracket`,
      panelName: `${baseName}.panel`,
      headerName: `${baseName}.header`,
      hemName: `${baseName}.hem`,
      tieBackName: `${baseName}.tieBack`,
      centerZ: 0,
      halfWindowSpanZ: 0.58,
      poleExtensionZ: 0.22,
      stackWidthZ: 0.26,
      stackInnerInsetZ: 0.04,
      poleX: 0.086,
      wallFaceX: 0,
      inwardSignX: 1,
      poleY: FFL_FIRST + 2.32,
      floorY: FFL_FIRST,
      tieBackY: FFL_FIRST + 0.96,
      mainColorHex: 0xe4d7cc,
      shadowColorHex: 0xbdaea2,
      trimColorHex: 0xd1c2b5,
      brassMat: brassMats.primary,
    });
    curtains.position.set(sx, 0, IN_Z);
    curtains.rotation.y = Math.PI / 2;
    deconflictCurtainBrackets(curtains, 1);
    tagCutaway(curtains, southCut);
    guestGroup.add(curtains);
  }

  const guestCurtainsEast = buildTraditionalWindowCurtains({
    groupName: 'simpleHouse.guest.curtainsEast',
    poleName: 'simpleHouse.guest.curtainsEast.pole',
    finialName: 'simpleHouse.guest.curtainsEast.finial',
    bracketName: 'simpleHouse.guest.curtainsEast.bracket',
    panelName: 'simpleHouse.guest.curtainsEast.panel',
    headerName: 'simpleHouse.guest.curtainsEast.header',
    hemName: 'simpleHouse.guest.curtainsEast.hem',
    tieBackName: 'simpleHouse.guest.curtainsEast.tieBack',
    centerZ: 2.1,
    halfWindowSpanZ: 0.58,
    poleExtensionZ: 0.2,
    stackWidthZ: 0.24,
    stackInnerInsetZ: 0.04,
    poleX: IN_X - 0.086,
    wallFaceX: IN_X,
    inwardSignX: -1,
    poleY: FFL_FIRST + 2.32,
    floorY: FFL_FIRST,
    tieBackY: FFL_FIRST + 0.96,
    mainColorHex: 0xe4d7cc,
    shadowColorHex: 0xbdaea2,
    trimColorHex: 0xd1c2b5,
    brassMat: brassMats.primary,
  });
  deconflictCurtainBrackets(guestCurtainsEast, -1);
  tagCutaway(guestCurtainsEast, eastCut);

  const guestRadiator = buildCastIronColumnRadiator({
    name: 'simpleHouse.guest.radiator',
    zone: 'houseBedroom2',
    cx: 2.95,
    floorY: FFL_FIRST + 0.001,
    cz: IN_Z - 0.12,
    width: 0.92,
    height: 0.54,
    rotationY: Math.PI / 2,
    brassMat: brassMats.primary,
  });
  tagCutaway(guestRadiator, southCut);

  guestGroup.add(guestCurtainsEast, guestRadiator);

  firstCeilingGroup.add(
    buildHeritageInteriorLighting(ctx, {
      kind: 'coxFlutedPendant',
      name: 'simpleHouse.guest.pendant',
      position: [4.47, FIRST_CEILING_SOFFIT_Y - 0.028, 2.05],
      dropM: 0.46,
      circuitId: 'houseBed2Pendant' as CircuitId,
      createPointLight: true,
    })
  );

  // English Library & Study (houseStudy)
  const studyGroup = new THREE.Group();
  studyGroup.name = 'simpleHouse.study';
  studyGroup.userData.zoneId = 'houseStudy';
  root.add(studyGroup);

  const studyTaskCircuit = 'houseStudyTask' as CircuitId;

  const studyRug = buildCuratedMirrorsArtAndRugs({
    kind: 'zieglerOushak',
    name: 'simpleHouse.study.zieglerLibraryRug',
    widthM: 2.2,
    lengthM: 2.8,
    position: [4.55, FFL_FIRST + 0.003, -2.15],
  });
  tagCollisionRole(studyRug, 'ignore');

  // Cox Nivala oak desk facing North between studyNorthWest (+3.62) & studyNorth (+5.35)
  buildCoxNivalaDesk(studyGroup, {
    name: 'simpleHouse.study.nivalaDesk',
    zone: 'houseStudy',
    position: [4.48, FFL_FIRST + 0.02, -3.72],
    rotationY: Math.PI,
    interactions: ctx.interactions,
    includeChair: true,
    insetJoineryButtJoints: true,
  });

  const deskLamp = buildArticulatedBrassDeskLamp(
    ctx,
    'simpleHouse.study.brassDeskLamp',
    brassMats.primary,
    studyTaskCircuit,
    [4.88, FFL_FIRST + 0.771, -3.8],
    -0.35
  );
  ctx.addGlowPool(studyTaskCircuit, 4.88, FFL_FIRST + 0.775, -3.8, 0.55, 0.3);

  // George III astragal-glazed mahogany bureau bookcase on South partition (clear of landingStudy swing)
  const bureauBookcase = buildGeorgianAntiqueCasework(ctx, {
    kind: 'astragalBureauBookcase',
    name: 'simpleHouse.study.bureauBookcase',
    position: [4.48, FFL_FIRST + 0.001, -0.5],
    rotationY: Math.PI,
  });

  // Tailored English library loveseat in front of STUDY_BREAST + walnut side table & reading lamp
  const libraryLoveseat = buildEnglishLibraryLoveseat(ctx, {
    name: 'simpleHouse.study.libraryLoveseat',
    position: [5.85, FFL_FIRST + 0.02, -1.64],
    rotationY: -Math.PI / 2,
    brassMat: brassMats.primary,
  });

  const walnutSideTable = buildWalnutLibrarySideTableAndLamp(ctx, {
    name: 'simpleHouse.study.walnutSideTable',
    position: [6.05, FFL_FIRST + 0.001, -2.75],
    brassMat: brassMats.primary,
    circuitId: studyTaskCircuit,
  });
  ctx.addGlowPool(studyTaskCircuit, 6.05, FFL_FIRST + 0.61, -2.75, 0.58, 0.28);

  // Antiquarian map diptych on STUDY_BREAST (X = 6.706, Z = -1.64 — never tagCutaway)
  const studyMapPrints = buildAntiquarianMapDiptych({
    name: 'simpleHouse.study.antiquarianMapPrints',
    position: [6.706, FFL_FIRST + 1.46, -1.64],
    rotationY: -Math.PI / 2,
    brassMat: brassMats.primary,
  });

  const pictureLightGlowMat = createWarm2700kLedMaterial(
    'simpleHouse.study.pictureLight.glow',
    1.35
  );
  registerCircuitEmissive(ctx, studyTaskCircuit, pictureLightGlowMat);
  const studyPictureLight = buildFlutedBrassPictureLight(
    {
      brass: brassMats.primary,
      darkBrass: brassMats.darkShadow,
      glow: pictureLightGlowMat,
    },
    {
      name: 'simpleHouse.study.breastPictureLight',
      zone: 'houseStudy',
      shadeWidth: 0.54,
      finish: 'AB',
    }
  );
  studyPictureLight.position.set(6.706, FFL_FIRST + 1.78, -1.64);
  studyPictureLight.rotation.y = -Math.PI / 2;
  ctx.addGlowPool(studyTaskCircuit, 6.62, FFL_FIRST + 1.46, -1.64, 0.65, 0.34);

  // Roman blinds on both studyNorthWest (+3.62) & studyNorth (+5.35)
  for (const [bName, bx] of [
    ['simpleHouse.study.northWestRomanBlind', 3.62],
    ['simpleHouse.study.northRomanBlind', 5.35],
  ] as const) {
    deconflictRomanBlind(
      buildWindowRomanBlind(ctx.scene, tagCutaway, {
        name: bName,
        zone: 'houseStudy',
        centerX: bx,
        width: 1.12,
        railY: FFL_FIRST + 2.24,
        bottomY: FFL_FIRST + 1.86,
        wallFaceZ: -IN_Z + 0.026,
        facingZ: 1,
        cutawayWall: northCut,
        parentGroup: studyGroup,
      }),
      1
    );
  }

  const studyRadiator = buildCastIronColumnRadiator({
    name: 'simpleHouse.study.radiator',
    zone: 'houseStudy',
    cx: 2.99,
    floorY: FFL_FIRST + 0.001,
    cz: -3.25,
    width: 0.86,
    height: 0.54,
    rotationY: 0,
    brassMat: brassMats.primary,
  });

  studyGroup.add(
    studyRug,
    deskLamp,
    bureauBookcase,
    libraryLoveseat,
    walnutSideTable,
    studyMapPrints,
    studyPictureLight,
    studyRadiator
  );

  firstCeilingGroup.add(
    buildHeritageInteriorLighting(ctx, {
      kind: 'coxFlutedPendant',
      name: 'simpleHouse.study.pendant',
      position: [4.55, FIRST_CEILING_SOFFIT_Y - 0.028, -2.15],
      dropM: 0.46,
      circuitId: 'houseStudyPendant' as CircuitId,
      createPointLight: true,
    })
  );

  // Family Bathroom & Airing Cupboard (houseBathroom)
  const bathroomGroup = new THREE.Group();
  bathroomGroup.name = 'simpleHouse.familyBathroom';
  bathroomGroup.userData.zoneId = 'houseBathroom';
  root.add(bathroomGroup);

  const copperCylinderMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.airingCupboard.copperJacket',
    color: 0xb97748,
    roughness: 0.42,
    metalness: 0.65,
  });
  buildAiringCupboardFittings(bathroomGroup, oakMat, copperCylinderMat);

  // Half-height F&B Mizzle T&G dado panelling (cleanly gapped for landingBathroom door & wet-zone alcove)
  const bathDadoWest = buildTongueAndGrooveDadoPanelling({
    name: 'simpleHouse.bathroom.mizzleDadoWest',
    lengthM: 2.32,
    heightM: 1.08,
    paintColor: FB_MIZZLE,
    position: [-1.644, FFL_FIRST + 0.001, -2.99],
    rotationY: Math.PI / 2,
  });
  const bathDadoSouth = buildTongueAndGrooveDadoPanelling({
    name: 'simpleHouse.bathroom.mizzleDadoSouth',
    lengthM: 2.3,
    heightM: 1.08,
    paintColor: FB_MIZZLE,
    position: [0.68, FFL_FIRST + 0.001, -1.776],
    rotationY: Math.PI,
  });

  const bathNorthWainscot = addBox(
    bathroomGroup,
    'simpleHouse.bathroom.mizzleWainscotNorth',
    [3.42, 0.46, 0.006],
    [0.12, FFL_FIRST + 0.145 + 0.46 * 0.5, -IN_Z + 0.004],
    shell.schemes.houseBathroom.trim
  );
  bathNorthWainscot.castShadow = false;
  tagCutaway(bathNorthWainscot, northCut);

  const bathNorthDadoRail = createDadoRun({
    name: 'simpleHouse.bathroom.mizzleDadoRailNorth',
    path: [
      [1.86, -IN_Z],
      [-1.62, -IN_Z],
    ],
    closed: false,
    roomSide: 'left',
    floorY: FFL_FIRST,
    elevationY: 1.045,
    profile: 'astragal-dado',
    height: 0.048,
    projection: 0.02,
    material: shell.schemes.houseBathroom.trim,
    gaps: [
      { box: { minX: -1.44, maxX: -0.46, minZ: -4.3, maxZ: -4.14 }, cap: 'selfReturn' },
      { box: { minX: 0.36, maxX: 1.34, minZ: -4.3, maxZ: -4.14 }, cap: 'selfReturn' },
    ],
    cutawayWalls: [northCut],
    floor: 'first',
    zone: 'houseBathroom',
  });

  // Freestanding BC Designs copper boat bath centered between bathroomNorthWest (-0.95) & bathroomNorth (+0.85)
  const copperBath = buildBcDesignsCopperBoatBath({
    namePrefix: 'simpleHouse.bathroom.copperBoatBath',
    brassFinish: 'BR',
  });
  copperBath.position.set(-0.05, FFL_FIRST + 0.001, -3.72);
  tagCutaway(copperBath, northCut);

  const bathMixer = buildArmstrongFreestandingBathMixer({
    namePrefix: 'simpleHouse.bathroom.freestandingBathMixer',
    finish: 'BR',
    style: 'traditional',
  });
  bathMixer.position.set(0.88, FFL_FIRST + 0.001, -3.72);
  bathMixer.rotation.y = -Math.PI / 2;

  const bathCaddy = new THREE.Group();
  bathCaddy.name = 'simpleHouse.bathroom.oakBathCaddy';
  bathCaddy.position.set(-0.05, FFL_FIRST + 0.655, -3.72);
  addBox(bathCaddy, 'simpleHouse.bathroom.oakBathCaddy.railWest', [0.038, 0.018, 0.76], [-0.11, 0.009, 0], oakMat);
  addBox(bathCaddy, 'simpleHouse.bathroom.oakBathCaddy.railEast', [0.038, 0.018, 0.76], [0.11, 0.009, 0], oakMat);
  for (let s = -3; s <= 3; s++) {
    addBox(bathCaddy, `simpleHouse.bathroom.oakBathCaddy.slat_${s + 4}`, [0.18, 0.012, 0.046], [0, 0.016, s * 0.078], oakMat);
  }
  tagCutaway(bathCaddy, northCut);

  for (const [bName, bx] of [
    ['simpleHouse.bathroom.northWestRomanBlind', -0.95],
    ['simpleHouse.bathroom.northRomanBlind', 0.85],
  ] as const) {
    deconflictRomanBlind(
      buildWindowRomanBlind(ctx.scene, tagCutaway, {
        name: bName,
        zone: 'houseBathroom',
        centerX: bx,
        width: 0.86,
        railY: FFL_FIRST + 2.24,
        bottomY: FFL_FIRST + 1.88,
        wallFaceZ: -IN_Z + 0.026,
        facingZ: 1,
        cutawayWall: northCut,
        parentGroup: bathroomGroup,
      }),
      1
    );
  }

  // Lefroy Brooks Lissa Doon washstand on South wall (zLocal = 0 against South Mizzle dado face Z = -1.792)
  const lissaWashstand = buildLefroyBrooksLissaDoonWashstand({
    namePrefix: 'simpleHouse.bathroom.lissaDoonWashstand',
    finish: 'BR',
    mixerStyle: 'traditional',
  });
  lissaWashstand.position.set(0.55, FFL_FIRST + 0.001, -1.794);
  lissaWashstand.rotation.y = Math.PI;

  const bathMirror = buildCuratedMirrorsArtAndRugs({
    kind: 'coxRoundBrass',
    name: 'simpleHouse.bathroom.roundBrassMirror',
    widthM: 0.65,
    position: [0.55, FFL_FIRST + 1.18, -1.776],
    rotationY: Math.PI,
  });

  // Twin IP44 fluted-glass & brass vanity sconces at face height (Y = FFL_FIRST + 1.60 m; 1 PointLight)
  const bathSconceWest = buildHeritageInteriorLighting(ctx, {
    kind: 'coxFlutedSconce',
    name: 'simpleHouse.bathroom.sconceWest',
    position: [0.06, FFL_FIRST + 1.6, -1.776],
    rotationY: Math.PI,
    circuitId: 'houseBathSpots' as CircuitId,
    createPointLight: true,
  });
  const bathSconceEast = buildHeritageInteriorLighting(ctx, {
    kind: 'coxFlutedSconce',
    name: 'simpleHouse.bathroom.sconceEast',
    position: [1.04, FFL_FIRST + 1.6, -1.776],
    rotationY: Math.PI,
    circuitId: 'houseBathSpots' as CircuitId,
    createPointLight: false,
  });

  // Charterhouse WC on South-East wall facing North (zLocal = 0 against South dado face)
  const bathWc = buildLefroyBrooksCharterhouseWc({
    namePrefix: 'simpleHouse.bathroom.charterhouseWc',
    finish: 'BR',
    variant: 'closeCoupled',
  });
  bathWc.position.set(1.48, FFL_FIRST + 0.001, -1.794);
  bathWc.rotation.y = Math.PI;

  const bathWcArt = buildSingleBotanicalWatercolourFrame({
    name: 'simpleHouse.bathroom.wcBotanicalArt',
    position: [1.48, FFL_FIRST + 1.44, -1.776],
    rotationY: Math.PI,
    brassMat: polishedBrassMats.primary,
  });
  const bathPaperHolder = buildArmstrongPaperHolder({
    namePrefix: 'simpleHouse.bathroom.paperHolder',
    finish: 'BR',
    style: 'traditional',
    coreClearanceM: 0.0008,
  });
  bathPaperHolder.position.set(1.06, FFL_FIRST + 0.68, -1.794);
  bathPaperHolder.rotation.y = Math.PI;

  const bathRobeHook = buildArmstrongRobeHook({
    namePrefix: 'simpleHouse.bathroom.robeHook',
    finish: 'BR',
    style: 'traditional',
  });
  bathRobeHook.position.set(1.886, FFL_FIRST + 1.56, -2.18);
  bathRobeHook.rotation.y = -Math.PI / 2;

  // Wet-Zone Shower Alcove (X in [2.01, 2.75], Z in [-4.22, -2.45])
  const wetAlcoveGroup = new THREE.Group();
  wetAlcoveGroup.name = 'simpleHouse.bathroom.wetZoneShower';
  addBox(
    wetAlcoveGroup,
    'simpleHouse.bathroom.wetZoneShower.stoneTray',
    [0.72, 0.034, 1.72],
    [2.38, FFL_FIRST + 0.018, -3.35],
    carraraMat
  );
  const glassMat = new THREE.MeshPhysicalMaterial({
    name: 'simpleHouse.bathroom.wetZoneGlass',
    color: 0xecf4f5,
    transparent: true,
    opacity: 0.34,
    roughness: 0.08,
    ior: 1.52,
    clearcoat: 0.65,
    transmission: 0,
  });
  addBox(
    wetAlcoveGroup,
    'simpleHouse.bathroom.wetZoneShower.crittallScreen',
    [0.012, 1.98, 0.84],
    [2.02, FFL_FIRST + 1.025, -3.77],
    glassMat
  );
  addBox(
    wetAlcoveGroup,
    'simpleHouse.bathroom.wetZoneShower.brassPost',
    [0.02, 1.98, 0.02],
    [2.02, FFL_FIRST + 1.025, -3.34],
    polishedBrassMats.primary
  );
  const wetShowerValve = buildArmstrongConcealedShowerSet({
    namePrefix: 'simpleHouse.bathroom.wetZoneShower.valveSet',
    finish: 'BR',
    style: 'traditional',
    overheadArmYM: 1.96,
    valveCenterYM: 1.12,
  });
  wetShowerValve.position.set(2.735, FFL_FIRST + 0.036, -3.35);
  wetShowerValve.rotation.y = -Math.PI / 2;
  wetAlcoveGroup.add(wetShowerValve);

  bathroomGroup.add(
    bathDadoWest,
    bathDadoSouth,
    bathNorthDadoRail,
    copperBath,
    bathCaddy,
    bathMixer,
    lissaWashstand,
    bathMirror,
    bathSconceWest,
    bathSconceEast,
    bathWc,
    bathWcArt,
    bathPaperHolder,
    bathRobeHook,
    wetAlcoveGroup
  );

  // East-Wing & Bathroom Corston Toggle Switches & Power Sockets
  const bed2SwitchIds: Record<number, string> = {
    1: 'sw-bed2',
    2: 'sw-bed2-lamps',
  };
  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.sw.bed2',
    switchPa: 'plate-bed2',
    location: 'Guest bedroom latch jamb',
    x: 1.892,
    y: FFL_FIRST + 1.15,
    z: 2.86,
    facing: 'east',
    mountedInZoneId: 'houseBedroom2' as RoomZoneId,
    parentGroup: guestGroup,
    extraUserDataForGang: (gang): InteractiveUserData => ({
      electricalSwitchId: bed2SwitchIds[gang],
    }),
    gangs: [
      {
        gang: 1,
        zoneId: 'houseBedroom2' as RoomZoneId,
        label: 'Guest Bedroom Pendant',
        circuitId: 'houseBed2Pendant' as CircuitId,
      },
      {
        gang: 2,
        zoneId: 'houseBedroom2' as RoomZoneId,
        label: 'Portobello Bedside Lamps',
        circuitId: bed2LampsCircuit,
      },
    ],
  });

  const studySwitchIds: Record<number, string> = {
    1: 'sw-study',
    2: 'sw-study-task',
  };
  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.sw.study',
    switchPa: 'plate-study',
    location: 'Study latch jamb',
    x: 1.892,
    y: FFL_FIRST + 1.15,
    z: -1.41,
    facing: 'east',
    mountedInZoneId: 'houseStudy' as RoomZoneId,
    parentGroup: studyGroup,
    extraUserDataForGang: (gang): InteractiveUserData => ({
      electricalSwitchId: studySwitchIds[gang],
    }),
    gangs: [
      {
        gang: 1,
        zoneId: 'houseStudy' as RoomZoneId,
        label: 'Library Pendant',
        circuitId: 'houseStudyPendant' as CircuitId,
      },
      {
        gang: 2,
        zoneId: 'houseStudy' as RoomZoneId,
        label: 'Picture Light & Reading Lamps',
        circuitId: studyTaskCircuit,
      },
    ],
  });

  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.sw.bathroom',
    switchPa: 'plate-bath',
    location: 'Family bathroom latch jamb',
    x: -0.42,
    y: FFL_FIRST + 1.15,
    z: -1.774,
    facing: 'north',
    mountedInZoneId: 'houseBathroom' as RoomZoneId,
    parentGroup: bathroomGroup,
    extraUserDataForGang: (): InteractiveUserData => ({ electricalSwitchId: 'sw-bath' }),
    gangs: [
      {
        gang: 1,
        zoneId: 'houseBathroom' as RoomZoneId,
        label: 'Family Bathroom IP44 Sconces',
        circuitId: 'houseBathSpots' as CircuitId,
      },
    ],
  });

  root.add(
    buildCorstonPowerSocket(ctx, tagCutaway, {
      name: 'simpleHouse.socket.studyDesk',
      zone: 'houseStudy',
      kind: 'double',
      x: 4.48,
      y: FFL_FIRST + 0.45,
      z: -IN_Z + 0.003,
      facing: 'south',
      cutawayWall: northCut,
    }),
    buildCorstonPowerSocket(ctx, tagCutaway, {
      name: 'simpleHouse.socket.guestWest',
      zone: 'houseBedroom2',
      kind: 'double',
      x: 1.893,
      y: FFL_FIRST + 0.45,
      z: 2.1,
      facing: 'east',
    })
  );

  return root;
}
