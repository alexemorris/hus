import * as THREE from 'three';
import type { CircuitId, InteractiveUserData, RoomZoneId } from 'husjs';
import { createPaintMaterial } from 'husjs/materials';
import {
  addInteractiveShakerWardrobeDoor,
  attachAssetInteraction,
  attachAssetMetadata,
  buildCastIronColumnRadiator,
  buildCorstonPowerSocket,
  buildCorstonToggleSwitch,
  buildHollowWardrobeInterior,
  prepGeo,
  tagCollisionRole,
  tagCutaway,
} from 'husjs/objects';
import {
  SeatInteractable,
  buildCoxDanicaBed,
  buildCuratedMirrorsArtAndRugs,
  buildNeptuneOakTablesAndBedsides,
  buildWhiteCompanyAccessories,
  buildWhiteCompanyBedStyling,
  collectSeatClickableMeshes,
} from 'husjs/catalog/furniture';
import { buildHeritageInteriorLighting } from 'husjs/catalog/lighting';
import {
  buildArmstrongConcealedShowerSet,
  buildArmstrongPaperHolder,
  buildLefroyBrooksCharterhouseWc,
  buildNeptuneChichesterVanity,
  getHonedCarraraMarbleMaterial,
} from 'husjs/catalog/sanitaryware';
import type { SceneBuilderContext } from 'husjs/viewer';
import { addFlatBox } from './grounds-and-openings.ts';
import { buildLinenCurtainPair } from './interiors-living-and-hall.ts';
import type { SimpleFlatShell } from './architecture.ts';
import { BATH_HALL_X, BED_BATH_Z, IN_X, IN_Z, INT_T, WALL_H } from './electrical-and-rooms.ts';

function stripBuiltInDanicaBedding(bedGroup: THREE.Group): void {
  const suffixes = [
    '.duvet',
    '.duvetTurnDown',
    '.footThrow',
    '.sleepingPillow_left',
    '.sleepingPillow_right',
    '.scatterPillow_left',
    '.scatterPillow_right',
  ];
  const toRemove: THREE.Object3D[] = [];
  bedGroup.traverse((child) => {
    if (suffixes.some((sfx) => child.name.endsWith(sfx))) {
      toRemove.push(child);
    }
  });
  for (const node of toRemove) {
    node.removeFromParent();
  }
}

export function buildBedroomAndBathroomInteriors(
  ctx: SceneBuilderContext,
  shell: SimpleFlatShell
): void {
  const floorGroup = ctx.floor ? ctx.floor('level-0').group : ctx.scene;
  const bedGroup = new THREE.Group();
  bedGroup.name = 'simpleFlat.zone.flatBedroom';
  bedGroup.userData.zoneId = 'flatBedroom';
  floorGroup.add(bedGroup);

  const bathGroup = new THREE.Group();
  bathGroup.name = 'simpleFlat.zone.flatBathroom';
  bathGroup.userData.zoneId = 'flatBathroom';
  floorGroup.add(bathGroup);

  const carraraMat = getHonedCarraraMarbleMaterial();
  const wardrobePaintMat = createPaintMaterial({
    color: 'farrow-ball:shaded-white',
    sheen: 'estate-eggshell',
  });

  // =========================================================================
  // 1. DOUBLE BEDROOM (`flatBedroom`: `x in [-4.188, -0.66], z in [-3.388, 1.04]`)
  // =========================================================================
  const bedRug = buildCuratedMirrorsArtAndRugs({
    name: 'simpleFlat.bedroom.pebbleWoolRug',
    kind: 'coxPebbleWool',
    widthM: 2.4,
    lengthM: 2.1,
    position: [-2.85, 0.002, -1.35],
    rotationY: 0,
  });
  tagCollisionRole(bedRug, 'ignore');
  bedGroup.add(bedRug);

  const bedFrame = buildCoxDanicaBed(bedGroup, {
    name: 'simpleFlat.bedroom.coxDanicaBed',
    zone: 'flatBedroom' as RoomZoneId,
    size: 'ukDouble',
    position: [-4.18, 0.002, -1.35],
    rotationY: 0,
  });
  stripBuiltInDanicaBedding(bedFrame);
  tagCutaway(bedFrame, shell.westCut);

  const bedStyling = buildWhiteCompanyBedStyling({
    name: 'simpleFlat.bedroom.savoyBedLinens',
    size: 'double',
    mattressTopY: 0.452,
    position: [-3.13, 0.002, -1.35],
    rotationY: Math.PI / 2,
  });
  tagCutaway(bedStyling, shell.westCut);
  bedGroup.add(bedStyling);

  ctx.interactions.registerAnimatedInteractable(
    new SeatInteractable({
      id: 'flat.bedroom.bedSeat',
      label: 'Sit on Double Bed',
      aliases: ['simpleFlat.bedroom.coxDanicaBed'],
      anchor: bedFrame,
      clickableTargets: collectSeatClickableMeshes(bedFrame),
      localSeatPos: [1.4, 0.56, 0],
      localFootOffset: [2.25, 0, 0],
      localForward: [1, 0, 0],
      material: 'linen',
    })
  );

  for (const [sideTag, bz] of [
    ['Left', -2.34],
    ['Right', -0.36],
  ] as const) {
    const bedside = buildNeptuneOakTablesAndBedsides({
      name: `simpleFlat.bedroom.bedside${sideTag}`,
      kind: 'chichesterBedsideTable',
      paintColor: 0xd9d2c5,
      position: [-3.96, 0, bz],
      rotationY: Math.PI / 2,
    });
    const lamp = buildHeritageInteriorLighting(ctx, {
      name: `simpleFlat.bedroom.bedsideLamp${sideTag}`,
      kind: 'whiteCoCeramicLamp',
      position: [-3.96, 0.652, bz],
      circuitId: 'flatBedroomPendant' as CircuitId,
      createPointLight: false,
    });
    tagCutaway(bedside, shell.westCut);
    tagCutaway(lamp, shell.westCut);
    bedGroup.add(bedside, lamp);
  }

  // Full-height scribed Shaker double wardrobe along East spine partition (`x in [-1.26, -0.66], z in [-3.32, -1.80]`)
  // Scribed bulkhead & crown extend cleanly to `WALL_H = 2.75` (`0` dust gap!)
  const wUmin = -3.32;
  const wUmax = -1.8;
  const wFrontX = -1.24;
  const wDoorBaseY = 0.088;
  const wBodyTopY = 2.28;
  const wDoorH = wBodyTopY - 0.048 - wDoorBaseY;
  const wMidU = (wUmin + wUmax) * 0.5;
  const wardrobe = buildHollowWardrobeInterior({
    parent: bedGroup,
    namePrefix: 'simpleFlat.bedroom.scribedWardrobe',
    openFace: '-x',
    uMin: wUmin,
    uMax: wUmax,
    frontCoord: wFrontX,
    depth: 0.575,
    roomFloorY: 0.001,
    carcassBaseY: 0.001,
    doorBaseY: wDoorBaseY,
    getCarcassTopY: () => wBodyTopY,
    exteriorMat: wardrobePaintMat,
    brassMat: shell.brassMats.primary,
    interactions: ctx.interactions,
    bays: [
      { id: 'bay1', uMin: wUmin + 0.02, uMax: wMidU - 0.01, preset: 'doubleHang' },
      { id: 'bay2', uMin: wMidU + 0.01, uMax: wUmax - 0.02, preset: 'longHangAndDrawers', registerHeroDrawer: false },
    ],
  });

  for (const [dTag, u0, u1, handleSide] of [
    ['doorNorth', wUmin + 0.02, wMidU - 0.01, 'right'],
    ['doorSouth', wMidU + 0.01, wUmax - 0.02, 'left'],
  ] as const) {
    addInteractiveShakerWardrobeDoor(bedGroup, {
      name: `simpleFlat.bedroom.wardrobe.${dTag}`,
      x: wFrontX - 0.015,
      yBot: wDoorBaseY,
      z: (u0 + u1) * 0.5,
      width: u1 - u0 - 0.006,
      heightLeft: wDoorH,
      heightRight: wDoorH,
      alongZ: true,
      normalSign: -1,
      handleSide,
      doorMat: wardrobePaintMat,
      brassMat: shell.brassMats.primary,
      interactions: ctx.interactions,
    });
  }

  const wWidth = wUmax - wUmin;
  const friezeH = WALL_H - wBodyTopY - 0.004;
  addFlatBox(
    bedGroup,
    'simpleFlat.bedroom.wardrobeBulkheadFront',
    [0.024, friezeH, wWidth],
    [wFrontX + 0.012, wBodyTopY + friezeH * 0.5 + 0.001, wMidU],
    wardrobePaintMat
  );
  addFlatBox(
    bedGroup,
    'simpleFlat.bedroom.wardrobeBulkheadSideSouth',
    [0.54, friezeH, 0.022],
    [-0.935, wBodyTopY + friezeH * 0.5 + 0.001, wUmax - 0.011],
    wardrobePaintMat
  );
  addFlatBox(
    bedGroup,
    'simpleFlat.bedroom.wardrobeCrownMoulding',
    [0.044, 0.068, wWidth + 0.028],
    [wFrontX - 0.012, WALL_H - 0.036, wMidU + 0.012],
    shell.trimMat
  );
  attachAssetMetadata(wardrobe, {
    name: 'Full-Height Scribed Shaker Double Wardrobe',
    brand: 'Neptune',
    collection: 'Chichester',
    finish: 'Farrow & Ball Shaded White No. 201 / Character Oak Interior / Aged Brass',
    category: 'joinery',
    dimensionsMm: [1520, 580, 2750],
  });

  const bedCurtains = buildLinenCurtainPair(
    'simpleFlat.bedroom.windowCurtains',
    -2.4,
    1.8,
    2.44,
    0.01,
    -IN_Z + 0.015,
    1,
    shell.brassMats.primary,
    new THREE.MeshStandardMaterial({ name: 'simpleFlat.bedroom.linenDrapery', color: 0xd9cfc0, roughness: 0.9 })
  );
  tagCutaway(bedCurtains, shell.northCut);
  bedGroup.add(bedCurtains);

  const bedRad = buildCastIronColumnRadiator({
    name: 'flat.bedroom.radiator',
    zone: 'flatBedroom' as RoomZoneId,
    cx: -2.4,
    cz: -IN_Z + 0.115,
    floorY: 0,
    width: 1.05,
    height: 0.62,
    rotationY: Math.PI / 2,
    brassMat: shell.brassMats.primary,
    cutawayDesc: shell.northCut,
    tagCutawayWall: tagCutaway,
  });
  bedGroup.add(bedRad);

  const bedArt = buildCuratedMirrorsArtAndRugs({
    name: 'simpleFlat.bedroom.botanicalGrid',
    kind: 'curtisBotanicalGrid',
    widthM: 0.96,
    heightM: 1.08,
    position: [-2.95, 1.54, BED_BATH_Z - INT_T * 0.5 - 0.002],
    rotationY: Math.PI,
  });
  bedGroup.add(bedArt);

  const hamper = buildWhiteCompanyAccessories({
    name: 'simpleFlat.bedroom.kubuHamper',
    kind: 'kubuLaundryHamper',
    position: [-3.88, 0, -3.05],
    rotationY: 0.35,
  });
  tagCutaway(hamper, shell.westCut);
  bedGroup.add(hamper);

  const bedPendant = buildHeritageInteriorLighting(ctx, {
    name: 'simpleFlat.bedroom.flutedPendant',
    kind: 'coxFlutedPendant',
    position: [-2.55, WALL_H - 0.04, -1.35],
    dropM: 0.58,
    circuitId: 'flatBedroomPendant' as CircuitId,
    createPointLight: true,
    pointLightIntensity: 2.2,
  });
  bedGroup.add(bedPendant);

  buildCorstonToggleSwitch(ctx, {
    name: 'flat.sw.bedroomDoor',
    switchPa: 'plate-bedroom-door',
    location: 'Bedroom door jamb',
    x: -0.78,
    y: 1.15,
    z: BED_BATH_Z - INT_T * 0.5 - 0.001,
    facing: 'north',
    mountedInZoneId: 'flatBedroom' as RoomZoneId,
    parentGroup: bedGroup,
    extraUserDataForGang: (): InteractiveUserData => ({ electricalSwitchId: 'sw-bedroom' }),
    gangs: [
      { gang: 1, zoneId: 'flatBedroom' as RoomZoneId, label: 'Bedroom Pendant & Lamps (3-Way)', circuitId: 'flatBedroomPendant' as CircuitId },
    ],
  });

  for (const [tag, plateId, swId, sz] of [
    ['Left', 'plate-bedroom-left', 'sw-bedroom-left', -2.34],
    ['Right', 'plate-bedroom-right', 'sw-bedroom-right', -0.36],
  ] as const) {
    buildCorstonToggleSwitch(ctx, {
      name: `flat.sw.bedroom${tag}`,
      switchPa: plateId,
      location: `${tag} bedside`,
      x: -IN_X + 0.013,
      y: 0.86,
      z: sz,
      facing: 'east',
      mountedInZoneId: 'flatBedroom' as RoomZoneId,
      parentGroup: bedGroup,
      cutawayWall: shell.westCut,
      extraUserDataForGang: (): InteractiveUserData => ({ electricalSwitchId: swId }),
      gangs: [
        { gang: 1, zoneId: 'flatBedroom' as RoomZoneId, label: 'Bedroom Pendant & Lamps (3-Way)', circuitId: 'flatBedroomPendant' as CircuitId },
      ],
    });
    bedGroup.add(
      buildCorstonPowerSocket(ctx, tagCutaway, {
        name: `flat.sock.bedroom${tag}`,
        zone: 'flatBedroom' as RoomZoneId,
        kind: 'double',
        x: -IN_X + 0.013,
        y: 0.28,
        z: sz,
        facing: 'east',
        cutawayWall: shell.westCut,
      })
    );
  }

  // =========================================================================
  // 2. SHOWER BATHROOM (`flatBathroom`: `x in [-4.188, -2.26], z in [1.16, 3.388]`)
  // =========================================================================
  const showerEnclosure = new THREE.Group();
  showerEnclosure.name = 'simpleFlat.bathroom.walkInShower';
  addFlatBox(showerEnclosure, 'simpleFlat.bathroom.showerTray', [0.86, 0.036, 1.05], [-3.754, 0.0185, 1.692], carraraMat, 0.9);
  addFlatBox(showerEnclosure, 'simpleFlat.bathroom.showerDrainGrate', [0.46, 0.004, 0.058], [-3.754, 0.0385, 1.24], shell.brassMats.primary);

  const screenGlass = addFlatBox(showerEnclosure, 'simpleFlat.bathroom.showerScreenGlass', [0.012, 2.04, 0.6], [-3.335, 1.058, 1.472], shell.glassMat);
  screenGlass.castShadow = false;
  addFlatBox(showerEnclosure, 'simpleFlat.bathroom.screenChannelWall', [0.024, 2.05, 0.022], [-3.335, 1.062, 1.174], shell.brassMats.primary);
  addFlatBox(showerEnclosure, 'simpleFlat.bathroom.screenChannelBot', [0.024, 0.02, 0.57], [-3.335, 0.047, 1.474], shell.brassMats.primary);
  addFlatBox(showerEnclosure, 'simpleFlat.bathroom.screenEdgeStile', [0.022, 2.05, 0.022], [-3.335, 1.062, 1.776], shell.brassMats.primary);
  addFlatBox(showerEnclosure, 'simpleFlat.bathroom.screenStayBar', [0.84, 0.016, 0.016], [-3.76, 2.075, 1.776], shell.brassMats.primary);

  addFlatBox(showerEnclosure, 'simpleFlat.bathroom.showerShelf', [0.13, 0.02, 0.42], [-4.118, 1.16, 1.72], carraraMat, 0.6);
  const bottleMat = new THREE.MeshStandardMaterial({ color: 0x3b2c1e, roughness: 0.24 });
  for (const [bi, bz] of [
    [1, 1.62],
    [2, 1.74],
  ] as const) {
    const btl = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.026, 0.026, 0.13, 14)), bottleMat);
    btl.name = `simpleFlat.bathroom.apothecaryBottle_${bi}`;
    btl.position.set(-4.11, 1.236, bz);
    showerEnclosure.add(btl);
  }
  attachAssetMetadata(showerEnclosure, {
    name: 'Aged Brass Walk-In Wet-Room Screen & Honed Carrara Tray',
    brand: 'Matki',
    collection: 'EauZone Plus',
    finish: 'Aged Brass / 10mm Toughened Clear Glass / Honed Carrara',
    category: 'sanitaryware',
    dimensionsMm: [860, 1050, 2080],
  });
  bathGroup.add(showerEnclosure);

  const showerSet = buildArmstrongConcealedShowerSet({
    namePrefix: 'simpleFlat.bathroom.armstrongShower',
    finish: 'SB',
  });
  showerSet.position.set(-3.75, 0, BED_BATH_Z + INT_T * 0.5 + 0.002);
  attachAssetMetadata(showerSet, {
    name: 'Perrin & Rowe Armstrong Concealed Thermostatic Rain & Hand Shower',
    brand: 'Perrin & Rowe',
    collection: 'Armstrong',
    sku: 'US-PR-5885-SB',
    finish: 'Aged Brass',
    category: 'sanitaryware',
  });
  attachAssetInteraction(showerSet, {
    id: 'flat.bathroom.showerValve',
    kind: 'toggle',
    label: 'Turn On Thermostatic Rain Shower',
    activeLabel: 'Turn Off Thermostatic Rain Shower',
    audio: { activeLoopPreset: 'waterTapFlow', volume: 0.5 },
  });
  bathGroup.add(showerSet);

  const vanity = buildNeptuneChichesterVanity(ctx, {
    name: 'simpleFlat.bathroom.chichesterVanity',
    variant: 'single',
    paintColor: 0xc8c7bd,
    hardwareFinish: 'SB',
    position: [-3.74, 0.001, IN_Z - 0.295],
    rotationY: Math.PI,
  });
  tagCutaway(vanity, shell.southCut);
  bathGroup.add(vanity);

  const bathMirror = buildCuratedMirrorsArtAndRugs({
    name: 'simpleFlat.bathroom.roundBrassMirror',
    kind: 'coxRoundBrass',
    widthM: 0.62,
    heightM: 0.62,
    position: [-3.74, 1.16, IN_Z - 0.014],
    rotationY: Math.PI,
  });
  tagCutaway(bathMirror, shell.southCut);
  bathGroup.add(bathMirror);

  for (const [idx, sx, withPt] of [
    [1, -4.1, false],
    [2, -3.38, true],
  ] as const) {
    const sconce = buildHeritageInteriorLighting(ctx, {
      name: `simpleFlat.bathroom.flutedSconce_${idx}`,
      kind: 'coxFlutedSconce',
      position: [sx, 1.54, IN_Z - 0.014],
      rotationY: Math.PI,
      circuitId: 'flatBathroomSpots' as CircuitId,
      createPointLight: withPt,
      pointLightIntensity: 2.0,
    });
    tagCutaway(sconce, shell.southCut);
    bathGroup.add(sconce);
  }

  const wc = buildLefroyBrooksCharterhouseWc({
    namePrefix: 'simpleFlat.bathroom.laChapelleWc',
    collection: 'laChapelle1910',
    finish: 'SB',
    seatFinish: 'glossWhite',
    variant: 'closeCoupled',
  });
  wc.position.set(-2.76, 0.001, IN_Z - 0.015);
  wc.rotation.y = Math.PI;
  attachAssetMetadata(wc, {
    name: 'Lefroy Brooks La Chapelle 1910 Close-Coupled WC',
    brand: 'Lefroy Brooks',
    collection: 'La Chapelle 1910',
    finish: 'Vitreous China / Aged Brass Lever',
    category: 'sanitaryware',
  });
  attachAssetInteraction(wc, {
    id: 'flat.bathroom.wcFlush',
    kind: 'toggle',
    label: 'Flush Cistern',
    audio: { openPreset: 'cisternFlush', volume: 0.55 },
  });
  tagCutaway(wc, shell.southCut);
  bathGroup.add(wc);

  const paperHolder = buildArmstrongPaperHolder({
    namePrefix: 'simpleFlat.bathroom.paperHolder',
    finish: 'SB',
    includePaperRoll: false,
  });
  paperHolder.position.set(BATH_HALL_X - INT_T * 0.5 - 0.002, 0.68, 2.98);
  paperHolder.rotation.y = -Math.PI / 2;
  bathGroup.add(paperHolder);

  const towelRail = new THREE.Group();
  towelRail.name = 'simpleFlat.bathroom.heatedTowelWarmer';
  towelRail.position.set(BATH_HALL_X - INT_T * 0.5 - 0.002, 0, 2.58);
  const railOutX = -0.075;
  for (const [sideTag, rz] of [
    ['N', -0.22],
    ['S', 0.22],
  ] as const) {
    addFlatBox(towelRail, `simpleFlat.bathroom.towelPost_${sideTag}`, [0.024, 0.92, 0.024], [railOutX, 1.24, rz], shell.brassMats.primary);
    addFlatBox(towelRail, `simpleFlat.bathroom.towelBracketTop_${sideTag}`, [0.072, 0.022, 0.022], [-0.036, 1.62, rz], shell.brassMats.primary);
    addFlatBox(towelRail, `simpleFlat.bathroom.towelBracketBot_${sideTag}`, [0.072, 0.022, 0.022], [-0.036, 0.86, rz], shell.brassMats.primary);
  }
  for (let r = 0; r < 6; r++) {
    addFlatBox(
      towelRail,
      `simpleFlat.bathroom.towelCrossbar_${r + 1}`,
      [0.018, 0.018, 0.416],
      [railOutX, 0.88 + r * 0.145, 0],
      shell.brassMats.primary
    );
  }
  const towelMat = new THREE.MeshStandardMaterial({
    name: 'simpleFlat.bathroom.whiteCottonTowel',
    color: 0xf4f0e7,
    roughness: 0.91,
  });
  addFlatBox(towelRail, 'simpleFlat.bathroom.drapedBathSheet', [0.044, 0.42, 0.34], [railOutX - 0.004, 1.13, 0], towelMat);
  attachAssetMetadata(towelRail, {
    name: 'Aged Brass Heated Towel Warmer & Egyptian Cotton Bath Sheet',
    brand: 'Vogue UK',
    collection: 'Ballerina',
    finish: 'Aged Brass',
    category: 'sanitaryware',
    dimensionsMm: [465, 95, 920],
  });
  bathGroup.add(towelRail);
}
