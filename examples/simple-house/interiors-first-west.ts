import * as THREE from 'three';
import type { CircuitId, InteractiveUserData, RoomZoneId } from 'husjs';
import {
  addInteractiveShakerWardrobeDoor,
  buildCastIronColumnRadiator,
  buildCorstonPowerSocket,
  buildCorstonToggleSwitch,
  buildHollowWardrobeInterior,
  buildTraditionalWindowCurtains,
  buildWindowRomanBlind,
  sharedCylinderGeometry,
  tagCollisionRole,
  tagCutaway,
} from 'husjs/objects';
import { getPaleEuropeanOakJoineryMaterial } from 'husjs/catalog/architectural';
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
import { IN_X, IN_Z, type SimpleHouseShell } from './architecture.ts';
import { FFL_FIRST, FIRST_CEILING_SOFFIT_Y } from './electrical-and-rooms.ts';
import {
  NEPTUNE_SALT,
  addBox,
  buildPrincipalEndOfBedBench,
  buildWideChichesterBedsideChest,
  deconflictCurtainBrackets,
  deconflictRomanBlind,
  stripBuiltInDanicaBedding,
} from './interiors-first-furniture.ts';
import {
  buildFamilyPhotoGalleryCluster,
  buildFirstFloorRotaryDimmerPlate,
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

  // Principal Bedroom & Walk-In Dressing Room (housePrincipalBed)
  const principalGroup = new THREE.Group();
  principalGroup.name = 'simpleHouse.principalBedroom';
  principalGroup.userData.zoneId = 'housePrincipalBed';
  root.add(principalGroup);

  // Generous 3.0 x 3.8 m Cox Pebble Wool rug anchoring the South-West sleeping bay
  const principalRug = buildCuratedMirrorsArtAndRugs({
    kind: 'coxPebbleWool',
    name: 'simpleHouse.principal.pebbleWoolRug',
    widthM: 3.0,
    lengthM: 3.8,
    position: [-5.02, FFL_FIRST + 0.003, 2.38],
    rotationY: Math.PI / 2,
  });
  tagCollisionRole(principalRug, 'ignore');
  principalGroup.add(principalRug);

  // UK King Danica bed centered at Z = +2.38 against West wall (completely South of PRINCIPAL_BREAST)
  const principalBed = buildCoxDanicaBed(principalGroup, {
    name: 'simpleHouse.principal.danicaKingBed',
    zone: 'housePrincipalBed',
    size: 'ukKing',
    position: [-6.99, FFL_FIRST + 0.02, 2.38],
    rotationY: 0,
  });
  stripBuiltInDanicaBedding(principalBed);

  const whiteCoBedding = buildWhiteCompanyBedStyling({
    name: 'simpleHouse.principal.whiteCompanyBedding',
    size: 'king',
    mattressTopY: 0.452,
    position: [-5.855, FFL_FIRST + 0.02, 2.38],
    rotationY: Math.PI / 2,
  });
  principalGroup.add(whiteCoBedding);

  // Upholstered end-of-bed ottoman bench
  const endOfBedBench = buildPrincipalEndOfBedBench(ctx, {
    name: 'simpleHouse.principal.endOfBedBench',
    position: [-4.52, FFL_FIRST + 0.02, 2.38],
    rotationY: Math.PI / 2,
    oakMat,
    brassMat: brassMats.primary,
  });
  principalGroup.add(endOfBedBench);

  // Twin 640 mm Chichester bedside chests topped with turned-alabaster bedside reading lamps
  const bedsidePaintMat = shell.schemes.housePrincipalDressing.trim;
  const principalLampsCircuit = 'housePrincipalLamps' as CircuitId;
  for (const [tag, bz] of [
    ['north', 1.18],
    ['south', 3.58],
  ] as const) {
    const bedside = buildWideChichesterBedsideChest(ctx, {
      name: `simpleHouse.principal.bedside_${tag}`,
      position: [-6.78, FFL_FIRST + 0.019, bz],
      rotationY: Math.PI / 2,
      paintMat: bedsidePaintMat,
      brassMat: brassMats.primary,
    });
    const alabasterLamp = buildHeritageInteriorLighting(ctx, {
      kind: 'whiteCoAlabasterLamp',
      name: `simpleHouse.principal.alabasterLamp_${tag}`,
      position: [-6.78, FFL_FIRST + 0.69, bz],
      circuitId: principalLampsCircuit,
      createPointLight: false,
    });
    ctx.addGlowPool(principalLampsCircuit, -6.78, FFL_FIRST + 0.695, bz, 0.65, 0.32);
    principalGroup.add(bedside, alabasterLamp);
  }

  // Framed botanical watercolour study on PRINCIPAL_BREAST (X = -6.726, Z = 0.00 — never tagCutaway)
  const breastBotanicalArt = buildSingleBotanicalWatercolourFrame({
    name: 'simpleHouse.principal.chimneyBreastArt',
    position: [-6.726, FFL_FIRST + 1.48, 0.0],
    rotationY: Math.PI / 2,
    brassMat: brassMats.primary,
  });
  principalGroup.add(breastBotanicalArt);

  // George III bow-front mahogany chest against pN_east (safely East of principalEnsuite door at X = -3.82)
  const bowChest = buildGeorgianAntiqueCasework(ctx, {
    kind: 'bowFrontChest',
    name: 'simpleHouse.principal.bowFrontChest',
    position: [-2.58, FFL_FIRST + 0.001, -1.35],
    rotationY: 0,
  });
  const principalChestArt = buildCuratedMirrorsArtAndRugs({
    kind: 'constableLandscapeOil',
    name: 'simpleHouse.principal.chestPainting',
    widthM: 0.92,
    heightM: 0.66,
    position: [-2.58, FFL_FIRST + 1.24, -1.646],
    rotationY: 0,
  });
  const principalChestDiffuser = buildWhiteCompanyAccessories({
    kind: 'reedDiffuser',
    name: 'simpleHouse.principal.chestDiffuser',
    position: [-2.26, FFL_FIRST + 1.043, -1.35],
  });

  // Full-length oatmeal-linen curtains on principalSouthWest (-5.35) & principalSouthEast (-2.95)
  for (const [sTag, sx] of [
    ['SouthWest', -5.35],
    ['SouthEast', -2.95],
  ] as const) {
    const baseName = `simpleHouse.principal.curtains${sTag}`;
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
      poleX: 0.088,
      wallFaceX: 0,
      inwardSignX: 1,
      poleY: FFL_FIRST + 2.32,
      floorY: FFL_FIRST,
      tieBackY: FFL_FIRST + 0.96,
      mainColorHex: 0xe3dacb,
      shadowColorHex: 0xbcae98,
      trimColorHex: 0xcfc2ae,
      brassMat: brassMats.primary,
    });
    curtains.position.set(sx, 0, IN_Z);
    curtains.rotation.y = Math.PI / 2;
    deconflictCurtainBrackets(curtains, 1);
    tagCutaway(curtains, southCut);
    principalGroup.add(curtains);
  }

  const principalRadiator = buildCastIronColumnRadiator({
    name: 'simpleHouse.principal.radiator',
    zone: 'housePrincipalBed',
    cx: -2.95,
    floorY: FFL_FIRST + 0.001,
    cz: IN_Z - 0.12,
    width: 0.92,
    height: 0.54,
    rotationY: Math.PI / 2,
    brassMat: brassMats.primary,
  });
  tagCutaway(principalRadiator, southCut);

  principalGroup.add(bowChest, principalChestArt, principalChestDiffuser, principalRadiator);

  firstCeilingGroup.add(
    buildHeritageInteriorLighting(ctx, {
      kind: 'chandelier6Arm',
      name: 'simpleHouse.principal.chandelier',
      position: [-4.47, FIRST_CEILING_SOFFIT_Y - 0.028, 1.35],
      dropM: 0.38,
      circuitId: 'housePrincipalPendant' as CircuitId,
      createPointLight: true,
    })
  );

  // Walk-In Dressing Room (X in [-7.05, -4.45], Z in [-4.22, -1.77])
  const wardrobeMat = shell.schemes.housePrincipalDressing.trim;
  const wDoorBaseY = FFL_FIRST + 0.085;
  const wTopY = FIRST_CEILING_SOFFIT_Y - 0.12;
  const wDoorH = wTopY - 0.048 - wDoorBaseY;

  const westFrontX = -6.46;
  buildHollowWardrobeInterior({
    parent: principalGroup,
    namePrefix: 'simpleHouse.dressing.wardrobeWest',
    openFace: '+x',
    uMin: -4.16,
    uMax: -1.85,
    frontCoord: westFrontX,
    depth: 0.56,
    roomFloorY: FFL_FIRST + 0.001,
    carcassBaseY: FFL_FIRST + 0.001,
    doorBaseY: wDoorBaseY,
    getCarcassTopY: () => wTopY,
    exteriorMat: wardrobeMat,
    brassMat: brassMats.primary,
    interactions: ctx.interactions,
    bays: [
      { id: 'bay1', uMin: -4.14, uMax: -3.58, preset: 'doubleHang' },
      { id: 'bay2', uMin: -3.56, uMax: -3.0, preset: 'longHangAndDrawers', registerHeroDrawer: false },
      { id: 'bay3', uMin: -2.98, uMax: -2.42, preset: 'doubleHang', registerHeroDrawer: false },
      { id: 'bay4', uMin: -2.4, uMax: -1.87, preset: 'threeDrawerChestAndLinen', registerHeroDrawer: false },
    ],
  });
  for (const [dTag, u0, u1, handleSide] of [
    ['door_1', -4.14, -3.58, 'right'],
    ['door_2', -3.56, -3.0, 'left'],
    ['door_3', -2.98, -2.42, 'right'],
    ['door_4', -2.4, -1.87, 'left'],
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

  // Full-height arched brass mirror & Kubu laundry hamper against solid pDress East wall (X = -4.45)
  const archedMirror = buildCuratedMirrorsArtAndRugs({
    kind: 'coxArchedBrass',
    name: 'simpleHouse.dressing.archedBrassMirror',
    widthM: 0.68,
    heightM: 1.58,
    position: [-4.456, FFL_FIRST + 0.165, -2.95],
    rotationY: -Math.PI / 2,
  });

  const dressingHamper = buildWhiteCompanyAccessories({
    kind: 'kubuLaundryHamper',
    name: 'simpleHouse.dressing.kubuHamper',
    position: [-4.72, FFL_FIRST + 0.001, -3.85],
    rotationY: -Math.PI / 2,
  });

  const dressingPouffe = new THREE.Group();
  dressingPouffe.name = 'simpleHouse.dressing.bouclePouffe';
  dressingPouffe.position.set(-5.55, FFL_FIRST + 0.001, -3.25);
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

  deconflictRomanBlind(
    buildWindowRomanBlind(ctx.scene, tagCutaway, {
      name: 'simpleHouse.dressing.northRomanBlind',
      zone: 'housePrincipalBed',
      centerX: -5.35,
      width: 1.12,
      railY: FFL_FIRST + 2.24,
      bottomY: FFL_FIRST + 1.86,
      wallFaceZ: -IN_Z + 0.026,
      facingZ: 1,
      cutawayWall: northCut,
      parentGroup: principalGroup,
    }),
    1
  );

  firstCeilingGroup.add(
    buildHeritageInteriorLighting(ctx, {
      kind: 'coxFlutedPendant',
      name: 'simpleHouse.dressing.pendant',
      position: [-5.55, FIRST_CEILING_SOFFIT_Y - 0.015, -2.98],
      dropM: 0.34,
      circuitId: 'housePrincipalPendant' as CircuitId,
      createPointLight: false,
    })
  );

  principalGroup.add(archedMirror, dressingHamper, dressingPouffe);

  // Galleried First-Floor Landing Family Photo Gallery (houseLanding)
  //    (Runner, sconces, South blind, radiator & switches live in staircase-and-hall.ts)
  const landingGroup = new THREE.Group();
  landingGroup.name = 'simpleHouse.landingGallery';
  landingGroup.userData.zoneId = 'houseLanding';
  root.add(landingGroup);

  const landingFamilyPhotos = buildFamilyPhotoGalleryCluster({
    name: 'simpleHouse.landing.familyPhotoGallery',
    position: [-1.646, FFL_FIRST + 1.56, 1.1],
    rotationY: Math.PI / 2,
    brassMat: brassMats.primary,
  });
  landingGroup.add(landingFamilyPhotos);

  // Principal Ensuite (X in [-4.33, -1.89], Z in [-4.22, -1.77])
  const ensuiteGroup = new THREE.Group();
  ensuiteGroup.name = 'simpleHouse.principalEnsuite';
  ensuiteGroup.userData.zoneId = 'housePrincipalEnsuite';
  root.add(ensuiteGroup);

  // Tiled plumbing stud false-wall behind NW walk-in shower (clear of ensuiteNorth at X = -2.65)
  const showerPlumbingStud = addBox(
    ensuiteGroup,
    'simpleHouse.ensuite.showerPlumbingWall',
    [1.18, 2.52, 0.102],
    [-3.72, FFL_FIRST + 1.262, -IN_Z + 0.055],
    shell.schemes.housePrincipalEnsuite.walls
  );
  tagCutaway(showerPlumbingStud, northCut);

  const ensuiteShower = buildCrittallWalkInShowerAndTowelRail({
    name: 'simpleHouse.ensuite.crittallShower',
    screenWidthM: 0.72,
    trayDepthM: 0.78,
    frameFinish: 'agedBrass',
    towelWarmerVariant: 'traditionalColumn',
    brassFinish: 'SB',
    includeShowerValveSet: true,
    position: [-3.72, FFL_FIRST + 0.001, -IN_Z + 0.108],
    rotationY: 0,
  });
  const ensuiteTowelWarmer = ensuiteShower.getObjectByName(
    'simpleHouse.ensuite.crittallShower.heatedTowelWarmer'
  );
  if (ensuiteTowelWarmer) {
    // Mount on pDress West wall (X = -4.33) South of walk-in shower tray so ensuiteNorth frosted sash is 100% unobstructed
    ensuiteTowelWarmer.position.set(-0.606, 0, 1.24);
    ensuiteTowelWarmer.rotation.y = Math.PI * 0.5;
  }
  tagCutaway(ensuiteShower, northCut);

  // Neptune Chichester double vanity on East wall (X = -2.18, Z = -3.38, clear North of WC)
  const ensuiteVanity = buildNeptuneChichesterVanity(ctx, {
    name: 'simpleHouse.ensuite.chichesterDoubleVanity',
    variant: 'double',
    paintColor: NEPTUNE_SALT,
    brassFinish: 'SB',
    position: [-2.18, FFL_FIRST + 0.001, -3.20],
    rotationY: -Math.PI / 2,
  });
  const ensuiteMirror = buildCuratedMirrorsArtAndRugs({
    kind: 'coxRoundBrass',
    name: 'simpleHouse.ensuite.roundBrassMirror',
    widthM: 0.78,
    position: [-1.896, FFL_FIRST + 1.08, -3.20],
    rotationY: -Math.PI / 2,
  });

  // Twin IP44 fluted-glass & brass vanity sconces at face height (Y = FFL_FIRST + 1.60 m; 1 PointLight)
  const ensuiteSconceNorth = buildHeritageInteriorLighting(ctx, {
    kind: 'coxFlutedSconce',
    name: 'simpleHouse.ensuite.sconceNorth',
    position: [-1.896, FFL_FIRST + 1.6, -3.76],
    rotationY: -Math.PI / 2,
    circuitId: 'houseEnsuiteSconces' as CircuitId,
    createPointLight: true,
  });
  const ensuiteSconceSouth = buildHeritageInteriorLighting(ctx, {
    kind: 'coxFlutedSconce',
    name: 'simpleHouse.ensuite.sconceSouth',
    position: [-1.896, FFL_FIRST + 1.6, -2.64],
    rotationY: -Math.PI / 2,
    circuitId: 'houseEnsuiteSconces' as CircuitId,
    createPointLight: false,
  });

  // Charterhouse WC on South wall facing North (X = -3.12, completely clear of vanity doors/drawers & door swing)
  const ensuiteWc = buildLefroyBrooksCharterhouseWc({
    namePrefix: 'simpleHouse.ensuite.charterhouseWc',
    finish: 'SB',
    variant: 'closeCoupled',
  });
  ensuiteWc.position.set(-3.12, FFL_FIRST + 0.001, -1.78);
  ensuiteWc.rotation.y = Math.PI;

  deconflictRomanBlind(
    buildWindowRomanBlind(ctx.scene, tagCutaway, {
      name: 'simpleHouse.ensuite.romanBlind',
      zone: 'housePrincipalEnsuite',
      centerX: -2.65,
      width: 0.78,
      railY: FFL_FIRST + 2.16,
      bottomY: FFL_FIRST + 1.88,
      wallFaceZ: -IN_Z + 0.026,
      facingZ: 1,
      cutawayWall: northCut,
      parentGroup: ensuiteGroup,
    }),
    1
  );

  const ensuiteWcArt = buildSingleBotanicalWatercolourFrame({
    name: 'simpleHouse.ensuite.botanicalArt',
    position: [-3.12, FFL_FIRST + 1.44, -1.776],
    rotationY: Math.PI,
    brassMat: brassMats.primary,
  });
  const ensuitePaperHolder = buildArmstrongPaperHolder({
    namePrefix: 'simpleHouse.ensuite.paperHolder',
    finish: 'SB',
    style: 'traditional',
    coreClearanceM: 0.0008,
  });
  ensuitePaperHolder.position.set(-2.68, FFL_FIRST + 0.68, -1.78);
  ensuitePaperHolder.rotation.y = Math.PI;

  const ensuiteTowelRing = buildPerrinRoweTowelRing({
    namePrefix: 'simpleHouse.ensuite.towelRing',
    finish: 'SB',
  });
  ensuiteTowelRing.position.set(-1.898, FFL_FIRST + 1.08, -2.28);
  ensuiteTowelRing.rotation.y = -Math.PI / 2;

  ensuiteGroup.add(
    ensuiteShower,
    ensuiteVanity,
    ensuiteMirror,
    ensuiteSconceNorth,
    ensuiteSconceSouth,
    ensuiteWc,
    ensuiteWcArt,
    ensuitePaperHolder,
    ensuiteTowelRing
  );

  // Principal Suite Switches, Rotary Dimmer & Power Sockets
  const principalDoorSwitchIds: Record<number, string> = {
    1: 'sw-bed1-door',
    2: 'sw-bed1-lamps',
  };
  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.sw.principalDoor',
    switchPa: 'plate-principal-door',
    location: 'Principal bedroom latch jamb',
    x: -1.892,
    y: FFL_FIRST + 1.15,
    z: 2.86,
    facing: 'west',
    mountedInZoneId: 'housePrincipalBed' as RoomZoneId,
    parentGroup: principalGroup,
    extraUserDataForGang: (gang): InteractiveUserData => ({
      electricalSwitchId: principalDoorSwitchIds[gang],
    }),
    gangs: [
      {
        gang: 1,
        zoneId: 'housePrincipalBed' as RoomZoneId,
        label: 'Principal Chandelier 3-Way (Door)',
        circuitId: 'housePrincipalPendant' as CircuitId,
      },
      {
        gang: 2,
        zoneId: 'housePrincipalBed' as RoomZoneId,
        label: 'Alabaster Bedside Lamps',
        circuitId: principalLampsCircuit,
      },
    ],
  });

  buildFirstFloorRotaryDimmerPlate(ctx, {
    name: 'simpleHouse.dimmer.principalLamps',
    zoneId: 'housePrincipalBed' as RoomZoneId,
    x: -1.892,
    y: FFL_FIRST + 1.01,
    z: 2.86,
    facing: 'west',
    brassMat: brassMats.primary,
    knurledBrassMat: brassMats.knurled,
    dimmerId: 'dimmer-principal-lamps',
    circuitId: principalLampsCircuit,
    label: 'Principal Alabaster Bedside Dimmer',
    parent: principalGroup,
  });

  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.sw.principalLeft',
    switchPa: 'plate-principal-left',
    location: 'North Chichester bedside',
    x: -IN_X + 0.004,
    y: FFL_FIRST + 0.9,
    z: 1.44,
    facing: 'east',
    mountedInZoneId: 'housePrincipalBed' as RoomZoneId,
    parentGroup: principalGroup,
    cutawayWall: westCut,
    extraUserDataForGang: (): InteractiveUserData => ({ electricalSwitchId: 'sw-bed1-left' }),
    gangs: [
      {
        gang: 1,
        zoneId: 'housePrincipalBed' as RoomZoneId,
        label: 'Principal 3-Way (Left Bedside)',
        circuitId: 'housePrincipalPendant' as CircuitId,
      },
    ],
  });

  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.sw.principalRight',
    switchPa: 'plate-principal-right',
    location: 'South Chichester bedside',
    x: -IN_X + 0.004,
    y: FFL_FIRST + 0.9,
    z: 3.32,
    facing: 'east',
    mountedInZoneId: 'housePrincipalBed' as RoomZoneId,
    parentGroup: principalGroup,
    cutawayWall: westCut,
    extraUserDataForGang: (): InteractiveUserData => ({ electricalSwitchId: 'sw-bed1-right' }),
    gangs: [
      {
        gang: 1,
        zoneId: 'housePrincipalBed' as RoomZoneId,
        label: 'Principal 3-Way (Right Bedside)',
        circuitId: 'housePrincipalPendant' as CircuitId,
      },
    ],
  });

  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.sw.ensuite',
    switchPa: 'plate-ensuite',
    location: 'Principal ensuite latch jamb',
    x: -3.26,
    y: FFL_FIRST + 1.15,
    z: -1.774,
    facing: 'north',
    mountedInZoneId: 'housePrincipalEnsuite' as RoomZoneId,
    parentGroup: ensuiteGroup,
    extraUserDataForGang: (): InteractiveUserData => ({ electricalSwitchId: 'sw-ensuite' }),
    gangs: [
      {
        gang: 1,
        zoneId: 'housePrincipalEnsuite' as RoomZoneId,
        label: 'Principal Ensuite IP44 Sconces',
        circuitId: 'houseEnsuiteSconces' as CircuitId,
      },
    ],
  });

  principalGroup.add(
    buildCorstonPowerSocket(ctx, tagCutaway, {
      name: 'simpleHouse.socket.principalNorth',
      zone: 'housePrincipalBed',
      kind: 'double',
      x: -2.02,
      y: FFL_FIRST + 0.45,
      z: -1.647,
      facing: 'south',
    })
  );
}
