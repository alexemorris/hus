import * as THREE from 'three';
import type { CircuitId, InteractiveUserData, RoomZoneId } from 'husjs';
import {
  buildCastIronColumnRadiator,
  buildCorstonPowerSocket,
  buildCorstonToggleSwitch,
  buildTraditionalWindowCurtains,
  buildWindowRomanBlind,
  createDadoRun,
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
  buildWhiteCompanyAccessories,
} from 'husjs/catalog/furniture';
import { buildHeritageInteriorLighting } from 'husjs/catalog/lighting';
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
  deconflictCurtainBrackets,
  deconflictRomanBlind,
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
  shell: SimpleHouseShell
): void {
  const firstGroup = ctx.floor ? ctx.floor('first').group : ctx.firstFloorMeshGroup;
  const firstCeilingGroup = ctx.floor ? ctx.floor('first').ceilingGroup : ctx.ceilingMeshGroup;

  const root = new THREE.Group();
  root.name = 'simpleHouse.interiors.first';
  firstGroup.add(root);

  const brassMats = getBathroomBrassMaterials('SB');
  const polishedBrassMats = getBathroomBrassMaterials('BR');
  const carraraMat = getHonedCarraraMarbleMaterial();
  const oakMat = getPaleEuropeanOakJoineryMaterial();
  const westCut = shell.cut('west', 'first');
  const northCut = shell.cut('north', 'first');
  const eastCut = shell.cut('east', 'first');
  const southCut = shell.cut('south', 'first');

  buildSimpleHouseFirstWestAndLanding(ctx, shell, root, firstCeilingGroup);

  // =========================================================================
  // 4. Guest Double Bedroom (houseBedroom2: F&B Setting Plaster + Honey Sisal)
  // =========================================================================
  const guestGroup = new THREE.Group();
  guestGroup.name = 'simpleHouse.guestBedroom';
  guestGroup.userData.zoneId = 'houseBedroom2';
  root.add(guestGroup);

  const guestRug = buildCuratedMirrorsArtAndRugs({
    kind: 'zieglerOushak',
    name: 'simpleHouse.guest.zieglerRug',
    widthM: 2.3,
    lengthM: 1.65,
    position: [3.35, FFL_FIRST + 0.002, 1.12],
    rotationY: Math.PI / 2,
  });
  guestGroup.add(guestRug);

  buildCoxDanicaBed(guestGroup, {
    name: 'simpleHouse.guest.danicaDoubleBed',
    zone: 'houseBedroom2',
    size: 'ukDouble',
    position: [3.35, FFL_FIRST + 0.019, -0.09],
    rotationY: -Math.PI / 2,
  });

  for (const [tag, bx] of [
    ['west', 2.2],
    ['east', 4.5],
  ] as const) {
    const bedside = buildNeptuneOakTablesAndBedsides({
      name: `simpleHouse.guest.bedside_${tag}`,
      kind: 'chichesterBedsideTable',
      position: [bx, FFL_FIRST + 0.001, 0.16],
      rotationY: 0,
      interactions: ctx.interactions,
    });
    const gourdLamp = buildHeritageInteriorLighting(ctx, {
      kind: 'whiteCoCeramicLamp',
      name: `simpleHouse.guest.portobelloLamp_${tag}`,
      position: [bx, FFL_FIRST + 0.722, 0.16],
      circuitId: 'houseBed2Pendant' as CircuitId,
      createPointLight: false,
    });
    guestGroup.add(bedside, gourdLamp);
  }

  const guestBotanicals = buildCuratedMirrorsArtAndRugs({
    kind: 'curtisBotanicalGrid',
    name: 'simpleHouse.guest.botanicalPrints',
    botanicalLayout: '1x4',
    position: [1.394, FFL_FIRST + 1.32, 1.55],
    rotationY: Math.PI / 2,
  });
  guestGroup.add(guestBotanicals);

  // Pin #26: Framed botanical watercolour study centered above the Guest Bed headboard on `pG` South face (`Z = -0.100 m`)
  const guestHeadboardArt = buildSingleBotanicalWatercolourFrame({
    name: 'simpleHouse.guest.headboardBotanicalArt',
    position: [3.35, FFL_FIRST + 1.48, -0.096],
    rotationY: 0,
    brassMat: brassMats.primary,
  });
  guestGroup.add(guestHeadboardArt);

  // Pin #27: Full-length Cox & Cox arched aged-brass pier mirror on South exterior wall SE pier (`Z = +4.212 m`),
  // facing `-Z` North into Guest Bedroom and tagged with First-Floor South `cutawayWall`!
  const guestArchedMirror = buildCuratedMirrorsArtAndRugs({
    kind: 'coxArchedBrass',
    name: 'simpleHouse.guest.archedBrassMirror',
    widthM: 0.64,
    heightM: 1.58,
    position: [4.72, FFL_FIRST + 0.165, IN_Z - 0.006],
    rotationY: Math.PI,
  });
  tagCutaway(guestArchedMirror, southCut);

  // Full-length blush-oatmeal pinch-pleat linen curtains on Guest Bedroom South & East sashes + cast-iron radiator
  const guestCurtainsSouth = buildTraditionalWindowCurtains({
    groupName: 'simpleHouse.guest.curtainsSouth',
    poleName: 'simpleHouse.guest.curtainsSouth.pole',
    finialName: 'simpleHouse.guest.curtainsSouth.finial',
    bracketName: 'simpleHouse.guest.curtainsSouth.bracket',
    panelName: 'simpleHouse.guest.curtainsSouth.panel',
    headerName: 'simpleHouse.guest.curtainsSouth.header',
    hemName: 'simpleHouse.guest.curtainsSouth.hem',
    tieBackName: 'simpleHouse.guest.curtainsSouth.tieBack',
    centerZ: 0,
    halfWindowSpanZ: 0.62,
    poleExtensionZ: 0.25,
    stackWidthZ: 0.29,
    stackInnerInsetZ: 0.04,
    poleX: 0.086,
    wallFaceX: 0,
    inwardSignX: 1,
    poleY: FFL_FIRST + 2.34,
    floorY: FFL_FIRST,
    tieBackY: FFL_FIRST + 0.96,
    mainColorHex: 0xe4d7cc,
    shadowColorHex: 0xbdaea2,
    trimColorHex: 0xd1c2b5,
    brassMat: brassMats.primary,
  });
  guestCurtainsSouth.position.set(3.35, 0, IN_Z);
  guestCurtainsSouth.rotation.y = Math.PI / 2;
  deconflictCurtainBrackets(guestCurtainsSouth, 1);
  tagCutaway(guestCurtainsSouth, southCut);

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
    halfWindowSpanZ: 0.62,
    poleExtensionZ: 0.26,
    stackWidthZ: 0.3,
    stackInnerInsetZ: 0.04,
    poleX: IN_X - 0.086,
    wallFaceX: IN_X,
    inwardSignX: -1,
    poleY: FFL_FIRST + 2.34,
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
    cx: 3.35,
    floorY: FFL_FIRST + 0.001,
    cz: IN_Z - 0.12,
    width: 0.92,
    height: 0.54,
    rotationY: Math.PI / 2,
    brassMat: brassMats.primary,
  });
  tagCutaway(guestRadiator, southCut);

  guestGroup.add(guestArchedMirror, guestCurtainsSouth, guestCurtainsEast, guestRadiator);

  firstCeilingGroup.add(
    buildHeritageInteriorLighting(ctx, {
      kind: 'coxFlutedPendant',
      name: 'simpleHouse.guest.pendant',
      position: [3.345, FIRST_CEILING_SOFFIT_Y - 0.04, 2.06],
      dropM: 0.48,
      circuitId: 'houseBed2Pendant' as CircuitId,
      createPointLight: true,
    })
  );

  // =========================================================================
  // 5. English Country Study / Library (houseStudy: F&B Drop Cloth + Honey-Smoked Oak)
  // =========================================================================
  const studyGroup = new THREE.Group();
  studyGroup.name = 'simpleHouse.study';
  studyGroup.userData.zoneId = 'houseStudy';
  root.add(studyGroup);

  // Pin #15: Warm faded terracotta & indigo Ziegler Oushak library rug anchoring the study seating & desk zone
  const studyRug = buildCuratedMirrorsArtAndRugs({
    kind: 'zieglerOushak',
    name: 'simpleHouse.study.zieglerLibraryRug',
    widthM: 1.85,
    lengthM: 2.35,
    position: [3.85, FFL_FIRST + 0.002, -2.05],
  });

  // Cox & Cox Nivala honeyed-oak desk + bouclé desk chair + articulated brass task lamp at North sash window
  const nivalaDesk = buildCoxNivalaDesk(studyGroup, {
    name: 'simpleHouse.study.nivalaDesk',
    zone: 'houseStudy',
    position: [3.95, FFL_FIRST + 0.001, -3.82],
    rotationY: Math.PI,
    interactions: ctx.interactions,
    includeChair: true,
    insetJoineryButtJoints: true,
  });
  tagCutaway(nivalaDesk, northCut);

  const deskLamp = buildArticulatedBrassDeskLamp(
    'simpleHouse.study.brassDeskLamp',
    brassMats.primary,
    [4.34, FFL_FIRST + 0.752, -3.9],
    -0.35
  );
  tagCutaway(deskLamp, northCut);

  // Pin #14: Tailored 2-seater English library loveseat replacing the oversized Chichester daybed
  const libraryLoveseat = buildEnglishLibraryLoveseat(ctx, {
    name: 'simpleHouse.study.libraryLoveseat',
    position: [4.54, FFL_FIRST + 0.001, -1.64],
    rotationY: -Math.PI / 2,
    brassMat: brassMats.primary,
  });

  // Turned walnut & brass circular library side table + reading lamp beside the loveseat
  const walnutSideTable = buildWalnutLibrarySideTableAndLamp(ctx, {
    name: 'simpleHouse.study.walnutSideTable',
    position: [4.92, FFL_FIRST + 0.001, -2.82],
    brassMat: brassMats.primary,
    circuitId: 'houseStudyPendant' as CircuitId,
  });
  tagCutaway(walnutSideTable, eastCut);

  // George III astragal-glazed mahogany bureau bookcase with leather-bound volumes against South partition `pG`
  // (`X = 3.55 m` -> `X in [3.04, 4.06]`, keeping all Study furniture east of `X = 1.95 m` with generous walkthrough!)
  const bureauBookcase = buildGeorgianAntiqueCasework(ctx, {
    kind: 'astragalBureauBookcase',
    name: 'simpleHouse.study.bureauBookcase',
    position: [3.55, FFL_FIRST + 0.001, -0.5],
    rotationY: Math.PI,
  });

  // Framed pair of 18th-century antiquarian English county survey maps above the library loveseat
  const studyMapPrints = buildAntiquarianMapDiptych({
    name: 'simpleHouse.study.antiquarianMapPrints',
    position: [5.075, FFL_FIRST + 1.48, -1.64],
    rotationY: -Math.PI / 2,
    brassMat: brassMats.primary,
  });
  const studyBotanicalEast = buildSingleBotanicalWatercolourFrame({
    name: 'simpleHouse.study.botanicalEast',
    position: [IN_X - 0.005, FFL_FIRST + 1.48, -3.12],
    rotationY: -Math.PI / 2,
    brassMat: brassMats.primary,
  });
  tagCutaway(studyBotanicalEast, eastCut);
  studyGroup.add(studyBotanicalEast);

  deconflictRomanBlind(buildWindowRomanBlind(ctx.scene, tagCutaway, {
    name: 'simpleHouse.study.northRomanBlind',
    zone: 'houseStudy',
    centerX: 3.95,
    width: 1.12,
    railY: FFL_FIRST + 2.28,
    bottomY: FFL_FIRST + 1.88,
    wallFaceZ: -IN_Z + 0.026,
    facingZ: 1,
    cutawayWall: northCut,
    parentGroup: studyGroup,
  }), 1);

  const studyRadiator = buildCastIronColumnRadiator({
    name: 'simpleHouse.study.radiator',
    zone: 'houseStudy',
    cx: 2.59,
    floorY: FFL_FIRST + 0.001,
    cz: -3.2,
    width: 0.86,
    height: 0.54,
    rotationY: 0,
    brassMat: brassMats.primary,
  });

  studyGroup.add(
    studyRug,
    deskLamp,
    libraryLoveseat,
    walnutSideTable,
    bureauBookcase,
    studyMapPrints,
    studyRadiator
  );

  firstCeilingGroup.add(
    buildHeritageInteriorLighting(ctx, {
      kind: 'coxFlutedPendant',
      name: 'simpleHouse.study.pendant',
      position: [3.95, FIRST_CEILING_SOFFIT_Y - 0.003, -2.22],
      dropM: 0.46,
      circuitId: 'houseStudyPendant' as CircuitId,
      createPointLight: true,
    })
  );

  // =========================================================================
  // 6. Re-Proportioned Family Bathroom & Airing Cupboard (houseBathroom)
  // =========================================================================
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

  // F&B Mizzle (#C0C6B8) tongue-and-groove dado panelling along the West & South dry walls
  const bathDadoWest = buildTongueAndGrooveDadoPanelling({
    name: 'simpleHouse.bathroom.mizzleDadoWest',
    lengthM: 2.30,
    heightM: 1.08,
    paintColor: FB_MIZZLE,
    position: [-1.144, FFL_FIRST + 0.001, -2.99],
    rotationY: Math.PI / 2,
  });
  const bathDadoSouth = buildTongueAndGrooveDadoPanelling({
    name: 'simpleHouse.bathroom.mizzleDadoSouth',
    lengthM: 1.22,
    heightM: 1.08,
    paintColor: FB_MIZZLE,
    position: [0.68, FFL_FIRST + 0.001, -1.776],
    rotationY: Math.PI,
  });

  const copperBath = buildBcDesignsCopperBoatBath({
    namePrefix: 'simpleHouse.bathroom.copperBoatBath',
    brassFinish: 'BR',
  });
  copperBath.position.set(0.18, FFL_FIRST + 0.001, -3.74);
  tagCutaway(copperBath, northCut);

  const bathMixer = buildArmstrongFreestandingBathMixer({
    namePrefix: 'simpleHouse.bathroom.freestandingBathMixer',
    finish: 'BR',
    style: 'traditional',
  });
  bathMixer.position.set(-0.78, FFL_FIRST + 0.001, -3.74);
  bathMixer.rotation.y = Math.PI / 2;

  const lissaWashstand = buildLefroyBrooksLissaDoonWashstand({
    namePrefix: 'simpleHouse.bathroom.lissaDoonWashstand',
    finish: 'BR',
    mixerStyle: 'traditional',
  });
  lissaWashstand.position.set(-1.124, FFL_FIRST + 0.001, -2.68);
  lissaWashstand.rotation.y = Math.PI / 2;

  const bathMirror = buildCuratedMirrorsArtAndRugs({
    kind: 'coxRoundBrass',
    name: 'simpleHouse.bathroom.roundBrassMirror',
    widthM: 0.65,
    position: [-1.142, FFL_FIRST + 1.14, -2.68],
    rotationY: Math.PI / 2,
  });

  const bathSconceNorth = buildHeritageInteriorLighting(ctx, {
    kind: 'coxFlutedSconce',
    name: 'simpleHouse.bathroom.sconceNorth',
    position: [-1.142, FFL_FIRST + 1.52, -3.14],
    rotationY: Math.PI / 2,
    circuitId: 'houseBathSpots' as CircuitId,
    createPointLight: true,
  });
  const bathSconceSouth = buildHeritageInteriorLighting(ctx, {
    kind: 'coxFlutedSconce',
    name: 'simpleHouse.bathroom.sconceSouth',
    position: [-1.142, FFL_FIRST + 1.52, -2.22],
    rotationY: Math.PI / 2,
    circuitId: 'houseBathSpots' as CircuitId,
    createPointLight: false,
  });

  const bathWc = buildLefroyBrooksCharterhouseWc({
    namePrefix: 'simpleHouse.bathroom.charterhouseWc',
    finish: 'BR',
    variant: 'closeCoupled',
  });
  bathWc.position.set(1.382, FFL_FIRST + 0.001, -2.10);
  bathWc.rotation.y = -Math.PI / 2;

  // Stud-nibbed olive-metro-tiled wet-zone shower alcove (`X in [1.45, 2.35], Z in [-4.22, -2.45]`)
  const wetAlcoveGroup = new THREE.Group();
  wetAlcoveGroup.name = 'simpleHouse.bathroom.wetZoneShower';
  addBox(
    wetAlcoveGroup,
    'simpleHouse.bathroom.wetZoneShower.stoneTray',
    [0.80, 0.034, 0.92],
    [1.93, FFL_FIRST + 0.018, -3.73],
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
    [0.50, 1.98, 0.01],
    [2.08, FFL_FIRST + 1.025, -3.27],
    glassMat
  );
  addBox(
    wetAlcoveGroup,
    'simpleHouse.bathroom.wetZoneShower.brassPost',
    [0.018, 1.98, 0.018],
    [1.83, FFL_FIRST + 1.025, -3.27],
    polishedBrassMats.primary
  );
  const wetShowerValve = buildArmstrongConcealedShowerSet({
    namePrefix: 'simpleHouse.bathroom.wetZoneShower.valveSet',
    finish: 'BR',
    style: 'traditional',
    overheadArmYM: 1.96,
    valveCenterYM: 1.12,
  });
  wetShowerValve.position.set(1.93, FFL_FIRST + 0.036, -IN_Z + 0.02);
  tagCutaway(wetShowerValve, northCut);
  wetAlcoveGroup.add(wetShowerValve);

  const laundryHamper = buildWhiteCompanyAccessories({
    kind: 'kubuLaundryHamper',
    name: 'simpleHouse.bathroom.kubuHamper',
    position: [2.06, FFL_FIRST + 0.001, -2.74],
    rotationY: -Math.PI / 2,
  });

  // Extend F&B Mizzle wainscot & dado rail behind the freestanding copper boat bath on the North dry wall
  const bathNorthWainscot = addBox(
    bathroomGroup,
    'simpleHouse.bathroom.mizzleWainscotNorth',
    [2.52, 0.88, 0.006],
    [0.16, FFL_FIRST + 0.14 + 0.88 * 0.5, -IN_Z + 0.004],
    shell.schemes.houseBathroom.trim
  );
  bathNorthWainscot.castShadow = false;
  tagCutaway(bathNorthWainscot, northCut);

  const bathNorthDadoRail = createDadoRun({
    name: 'simpleHouse.bathroom.mizzleDadoRailNorth',
    path: [
      [1.43, -IN_Z],
      [-1.1, -IN_Z],
    ],
    closed: false,
    roomSide: 'left',
    floorY: FFL_FIRST,
    elevationY: 1.045,
    profile: 'astragal-dado',
    height: 0.048,
    projection: 0.02,
    material: shell.schemes.houseBathroom.trim,
    gaps: [{ box: { minX: -0.52, maxX: 0.82, minZ: -4.3, maxZ: -4.14 }, cap: 'selfReturn' }],
    cutawayWalls: [northCut],
    floor: 'first',
    zone: 'houseBathroom',
  });

  deconflictRomanBlind(buildWindowRomanBlind(ctx.scene, tagCutaway, {
    name: 'simpleHouse.bathroom.northRomanBlind',
    zone: 'houseBathroom',
    centerX: 0.15,
    width: 1.12,
    railY: FFL_FIRST + 2.28,
    bottomY: FFL_FIRST + 1.92,
    wallFaceZ: -IN_Z + 0.026,
    facingZ: 1,
    cutawayWall: northCut,
    parentGroup: bathroomGroup,
  }), 1);

  // Slatted European oak bath caddy across the copper boat bath + apothecary diffuser
  const bathCaddy = new THREE.Group();
  bathCaddy.name = 'simpleHouse.bathroom.oakBathCaddy';
  bathCaddy.position.set(0.28, FFL_FIRST + 0.655, -3.74);
  addBox(bathCaddy, 'simpleHouse.bathroom.oakBathCaddy.railWest', [0.038, 0.018, 0.76], [-0.11, 0.009, 0], oakMat);
  addBox(bathCaddy, 'simpleHouse.bathroom.oakBathCaddy.railEast', [0.038, 0.018, 0.76], [0.11, 0.009, 0], oakMat);
  for (let s = -3; s <= 3; s++) {
    addBox(bathCaddy, `simpleHouse.bathroom.oakBathCaddy.slat_${s + 4}`, [0.18, 0.012, 0.046], [0, 0.016, s * 0.078], oakMat);
  }
  tagCutaway(bathCaddy, northCut);

  const bathWcArt = buildSingleBotanicalWatercolourFrame({
    name: 'simpleHouse.bathroom.wcBotanicalArt',
    position: [1.386, FFL_FIRST + 1.44, -2.10],
    rotationY: -Math.PI / 2,
    brassMat: polishedBrassMats.primary,
  });
  const bathPaperHolder = buildArmstrongPaperHolder({
    namePrefix: 'simpleHouse.bathroom.paperHolder',
    finish: 'BR',
    style: 'traditional',
    coreClearanceM: 0.0008,
  });
  bathPaperHolder.position.set(0.95, FFL_FIRST + 0.68, -1.818);
  bathPaperHolder.rotation.y = Math.PI;

  const bathRobeHook = buildArmstrongRobeHook({
    namePrefix: 'simpleHouse.bathroom.robeHook',
    finish: 'BR',
    style: 'traditional',
  });
  bathRobeHook.position.set(1.386, FFL_FIRST + 1.56, -2.38);
  bathRobeHook.rotation.y = -Math.PI / 2;

  bathroomGroup.add(
    bathDadoWest,
    bathDadoSouth,
    bathNorthDadoRail,
    copperBath,
    bathCaddy,
    bathMixer,
    lissaWashstand,
    bathMirror,
    bathSconceNorth,
    bathSconceSouth,
    bathWc,
    bathWcArt,
    bathPaperHolder,
    bathRobeHook,
    wetAlcoveGroup,
    laundryHamper
  );

  // =========================================================================
  // 7. First-Floor Corston Toggle Switches & Power Sockets
  // =========================================================================
  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.sw.landingTop',
    switchPa: 'plate-landing-top',
    location: 'Galleried landing head of stairs',
    x: 1.147,
    y: FFL_FIRST + 1.15,
    z: -0.35,
    facing: 'west',
    mountedInZoneId: 'houseLanding' as RoomZoneId,
    parentGroup: root,
    extraUserDataForGang: (): InteractiveUserData => ({ electricalSwitchId: 'sw-stair-top' }),
    gangs: [
      { gang: 1, zoneId: 'houseLanding' as RoomZoneId, label: 'Stairwell 2-Way (Top)', circuitId: 'houseStairPendant' as CircuitId },
    ],
  });

  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.sw.principalDoor',
    switchPa: 'plate-principal-door',
    location: 'Principal bedroom latch jamb',
    x: -1.393,
    y: FFL_FIRST + 1.15,
    z: 0.65,
    facing: 'west',
    mountedInZoneId: 'housePrincipalBed' as RoomZoneId,
    parentGroup: root,
    extraUserDataForGang: (): InteractiveUserData => ({ electricalSwitchId: 'sw-bed1-door' }),
    gangs: [
      { gang: 1, zoneId: 'housePrincipalBed' as RoomZoneId, label: 'Principal 3-Way (Door)', circuitId: 'housePrincipalPendant' as CircuitId },
    ],
  });

  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.sw.principalLeft',
    switchPa: 'plate-principal-left',
    location: 'Left Chichester bedside',
    x: -IN_X + 0.007,
    y: FFL_FIRST + 0.92,
    z: 0.04,
    facing: 'east',
    mountedInZoneId: 'housePrincipalBed' as RoomZoneId,
    parentGroup: root,
    cutawayWall: westCut,
    extraUserDataForGang: (): InteractiveUserData => ({ electricalSwitchId: 'sw-bed1-left' }),
    gangs: [
      { gang: 1, zoneId: 'housePrincipalBed' as RoomZoneId, label: 'Principal 3-Way (Left)', circuitId: 'housePrincipalPendant' as CircuitId },
    ],
  });

  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.sw.principalRight',
    switchPa: 'plate-principal-right',
    location: 'Right Chichester bedside',
    x: -IN_X + 0.007,
    y: FFL_FIRST + 0.92,
    z: 2.53,
    facing: 'east',
    mountedInZoneId: 'housePrincipalBed' as RoomZoneId,
    parentGroup: root,
    cutawayWall: westCut,
    extraUserDataForGang: (): InteractiveUserData => ({ electricalSwitchId: 'sw-bed1-right' }),
    gangs: [
      { gang: 1, zoneId: 'housePrincipalBed' as RoomZoneId, label: 'Principal 3-Way (Right)', circuitId: 'housePrincipalPendant' as CircuitId },
    ],
  });

  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.sw.ensuite',
    switchPa: 'plate-ensuite',
    location: 'Dressing room outside principal ensuite',
    x: -3.593,
    y: FFL_FIRST + 1.15,
    z: -2.25,
    facing: 'west',
    mountedInZoneId: 'housePrincipalBed' as RoomZoneId,
    parentGroup: root,
    extraUserDataForGang: (): InteractiveUserData => ({ electricalSwitchId: 'sw-ensuite' }),
    gangs: [
      { gang: 1, zoneId: 'housePrincipalEnsuite' as RoomZoneId, label: 'Principal Ensuite Sconces', circuitId: 'houseEnsuiteSconces' as CircuitId },
    ],
  });

  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.sw.bed2',
    switchPa: 'plate-bed2',
    location: 'Guest bedroom door jamb',
    x: 1.393,
    y: FFL_FIRST + 1.15,
    z: 2.85,
    facing: 'east',
    mountedInZoneId: 'houseBedroom2' as RoomZoneId,
    parentGroup: root,
    extraUserDataForGang: (): InteractiveUserData => ({ electricalSwitchId: 'sw-bed2' }),
    gangs: [
      { gang: 1, zoneId: 'houseBedroom2' as RoomZoneId, label: 'Guest Bedroom Pendant', circuitId: 'houseBed2Pendant' as CircuitId },
    ],
  });

  // Pin #24 coordination: mounted on Study side of South partition `pG` (`Z = -0.223 m`, facing North `-Z` into Study)
  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.sw.study',
    switchPa: 'plate-study',
    location: 'Study door jamb',
    x: 1.72,
    y: FFL_FIRST + 1.15,
    z: -0.223,
    facing: 'north',
    mountedInZoneId: 'houseStudy' as RoomZoneId,
    parentGroup: root,
    extraUserDataForGang: (): InteractiveUserData => ({ electricalSwitchId: 'sw-study' }),
    gangs: [
      { gang: 1, zoneId: 'houseStudy' as RoomZoneId, label: 'Study Pendant', circuitId: 'houseStudyPendant' as CircuitId },
    ],
  });

  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.sw.bath',
    switchPa: 'plate-bath',
    location: 'Landing outside family bathroom',
    x: 0.06,
    y: FFL_FIRST + 1.15,
    z: -1.527,
    facing: 'south',
    mountedInZoneId: 'houseLanding' as RoomZoneId,
    parentGroup: root,
    extraUserDataForGang: (): InteractiveUserData => ({ electricalSwitchId: 'sw-bath' }),
    gangs: [
      { gang: 1, zoneId: 'houseBathroom' as RoomZoneId, label: 'Family Bathroom Sconces', circuitId: 'houseBathSpots' as CircuitId },
    ],
  });

  root.add(
    buildCorstonPowerSocket(ctx, tagCutaway, {
      name: 'simpleHouse.socket.principalNorth',
      zone: 'housePrincipalBed',
      kind: 'double',
      x: -1.75,
      y: FFL_FIRST + 0.45,
      z: -1.647,
      facing: 'south',
    }),
    buildCorstonPowerSocket(ctx, tagCutaway, {
      name: 'simpleHouse.socket.studyDesk',
      zone: 'houseStudy',
      kind: 'double',
      x: 4.55,
      y: FFL_FIRST + 0.45,
      z: -IN_Z + 0.003,
      facing: 'south',
      cutawayWall: northCut,
    }),
    buildCorstonPowerSocket(ctx, tagCutaway, {
      name: 'simpleHouse.socket.guestWest',
      zone: 'houseBedroom2',
      kind: 'double',
      x: 1.393,
      y: FFL_FIRST + 0.45,
      z: 0.75,
      facing: 'east',
    })
  );
}
