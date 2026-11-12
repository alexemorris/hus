import * as THREE from 'three';
import {
  attachAssetMetadata,
  wireCatalogHingedDoor,
  wireCatalogSlidingDrawer,
} from '../shared/catalog-smart-metadata.ts';
import type { InteractionRegistry } from '../../engine/interaction/interaction-registry.ts';
import { attachDrawerBoxBehindFront } from '../joinery/cabinet-interior.ts';
import type { CatalogInteractionContext } from '../architectural/neptune-kitchen-joinery.ts';
import {
  addNamedBox,
  addNamedCyl,
  finalizeCatalogGroup,
  getAgedBrassMaterial,
  getBrushedStainlessCatalogMaterial,
  getBurnishedCopperCatalogMaterial,
  getDarkAntiquedBrassMaterial,
  getMatteCastIronMaterial,
  getVitreousEnamelMaterial,
  sharedSphereGeometry,
  sharedTorusGeometry,
  tagHighLod,
} from '../shared/neptune-and-georgian-materials.ts';

function resolveRegistry(ctx: CatalogInteractionContext): InteractionRegistry | null {
  if (!ctx) return null;
  if ('registerHingedDoor' in ctx && typeof ctx.registerHingedDoor === 'function') {
    return ctx as InteractionRegistry;
  }
  if ('interactions' in ctx && ctx.interactions) {
    return ctx.interactions;
  }
  return null;
}

export type LacancheEnamelFinish =
  | 'glossBlack'
  | 'frenchBlue'
  | 'ivory'
  | 'armorGreen';

const LACANCHE_FINISH_HEX: Record<LacancheEnamelFinish, number> = {
  glossBlack: 0x18191b,
  frenchBlue: 0x263b54,
  ivory: 0xefece3,
  armorGreen: 0x25382e,
};

export interface LacancheCluny1000RangeOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  /** Vitreous enamel finish (`'glossBlack'` `#18191B`, `'frenchBlue'` `#263B54`, `'ivory'` `#EFECE3`, `'armorGreen'` `#25382E`, or custom hex). */
  readonly finish?: LacancheEnamelFinish;
  readonly customColor?: THREE.ColorRepresentation;
  /** Optional cookware styling on the 5-burner gas hob (`'none'`, `'dutchOven'`, `'copperSaucepan'`, or `'both'`). Default `'both'`. */
  readonly cookware?: 'none' | 'dutchOven' | 'copperSaucepan' | 'both';
}

/**
 * **Lacanche *Cluny 1000 Classic* (`1000 x 650 x 900 mm`)** French Gastronome Range Cooker:
 * - Vitreous enamel chassis (`#18191B` Gloss Black, `#263B54` French Blue, `#EFECE3` Ivory, `#25382E` Armor Green)
 * - Aged Brass front towel/hand rail (`+55 mm` projection) with turned end finials & brackets
 * - 7 Aged Brass rotary control bezels & knurled dials across the bevelled control fascia
 * - 1-piece brushed stainless 5-burner gas hob with central `5 kW` solid-brass wok burner + 4 matte cast-iron pan grids
 * - Optional Le Creuset enamelled cast-iron Dutch oven & French tin-lined copper saucepan
 * - Twin interactive drop-down `51 L` oven doors (`axis: 'x'`) with interior oven cavities & wire racks over twin sliding warming drawers.
 * Local origin `(0, 0, 0)` is at floor level (`y = 0`), centered in X (`[-0.50..+0.50]`) and Z (`[-0.325..+0.325]`), facing `+Z`.
 */
export function buildLacancheCluny1000Range(
  ctx: CatalogInteractionContext = null,
  opts: LacancheCluny1000RangeOptions = {}
): THREE.Group {
  const namePrefix = opts.name ?? 'lacancheCluny1000';
  const finishHex =
    opts.customColor ?? LACANCHE_FINISH_HEX[opts.finish ?? 'glossBlack'];
  const enamelMat = getVitreousEnamelMaterial(finishHex, `${namePrefix}.enamel`);
  const brassMat = getAgedBrassMaterial();
  const darkBrassMat = getDarkAntiquedBrassMaterial();
  const stainlessMat = getBrushedStainlessCatalogMaterial();
  const castIronMat = getMatteCastIronMaterial(0x212326);
  const cavityDarkMat = getMatteCastIronMaterial(0x16181a);
  const copperMat = getBurnishedCopperCatalogMaterial();
  const registry = resolveRegistry(ctx);

  const root = new THREE.Group();
  root.name = namePrefix;

  const w = 1.0;
  const d = 0.65;
  const hobTopY = 0.9;
  const hobDeckT = 0.036;
  const legH = 0.095;
  const frontZ = d * 0.5;
  const rearZ = -d * 0.5;

  // 4 adjustable stainless cylinder levelling feet (`y = 0 .. 0.095`)
  for (const [fTag, fx, fz] of [
    ['FL', -w * 0.44, frontZ - 0.06],
    ['FR', w * 0.44, frontZ - 0.06],
    ['BL', -w * 0.44, rearZ + 0.06],
    ['BR', w * 0.44, rearZ + 0.06],
  ] as const) {
    addNamedCyl(
      root,
      `${namePrefix}.foot_${fTag}`,
      0.026,
      0.028,
      legH,
      14,
      fx,
      legH * 0.5,
      fz,
      stainlessMat,
      true
    );
  }
  // Recessed plinth kick shadow skirt
  addNamedBox(
    root,
    `${namePrefix}.recessedToeKick`,
    w - 0.16,
    legH - 0.004,
    d - 0.18,
    0,
    legH * 0.5,
    -0.01,
    cavityDarkMat
  );

  // Chassis side cheeks, rear wall, center mullion & horizontal rails (`y = legH .. hobTopY - hobDeckT`)
  const bodyBotY = legH;
  const bodyTopY = hobTopY - hobDeckT; // 0.864 m
  const bodyH = bodyTopY - bodyBotY;
  const fasciaH = 0.132;
  const drawerZoneH = 0.175;
  const ovenZoneH = bodyH - fasciaH - drawerZoneH - 0.036; // ~0.426 m
  const cheekT = 0.028;
  const doorThick = 0.032;
  const carcassDepth = d - doorThick;
  const carcassCenterZ = -doorThick * 0.5;

  for (const [sTag, sign] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    addNamedBox(
      root,
      `${namePrefix}.sideCheek${sTag}`,
      cheekT,
      bodyH,
      carcassDepth,
      sign * (w * 0.5 - cheekT * 0.5),
      bodyBotY + bodyH * 0.5,
      carcassCenterZ,
      enamelMat
    );
    // Front stile framing doors/drawers
    addNamedBox(
      root,
      `${namePrefix}.frontStile${sTag}`,
      cheekT,
      bodyH - fasciaH,
      doorThick - 0.004,
      sign * (w * 0.5 - cheekT * 0.5),
      bodyBotY + (bodyH - fasciaH) * 0.5,
      frontZ - doorThick * 0.5,
      enamelMat
    );
  }

  // Rear chassis wall & center vertical divider between left & right ovens
  const innerSpanW = w - cheekT * 2;
  addNamedBox(
    root,
    `${namePrefix}.rearPanel`,
    innerSpanW,
    bodyH,
    0.024,
    0,
    bodyBotY + bodyH * 0.5,
    rearZ + 0.012,
    cavityDarkMat
  );

  const midDividerW = 0.036;
  addNamedBox(
    root,
    `${namePrefix}.centerDividerStile`,
    midDividerW,
    bodyH - fasciaH,
    d - 0.028,
    0,
    bodyBotY + (bodyH - fasciaH) * 0.5,
    0.01,
    enamelMat
  );

  // Horizontal chassis rails separating warming drawers, ovens & control fascia
  const drawerBotY = bodyBotY + 0.008;
  const drawerTopY = drawerBotY + drawerZoneH;
  const midRailH = 0.02;
  const ovenBotY = drawerTopY + midRailH;
  const ovenTopY = ovenBotY + ovenZoneH;

  const bayW = (innerSpanW - midDividerW) * 0.5; // ~0.454 m per column

  for (const [colTag, sign] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    const colCx = sign * (midDividerW * 0.5 + bayW * 0.5);

    addNamedBox(
      root,
      `${namePrefix}.midRail${colTag}`,
      bayW,
      midRailH,
      d - 0.03,
      colCx,
      drawerTopY + midRailH * 0.5,
      0.01,
      enamelMat
    );

    // Interior 51 L enamelled oven cavity walls & chrome wire shelf visible when drop-down oven door opens!
    const cavD = carcassDepth - 0.04;
    const cavZ = rearZ + 0.024 + cavD * 0.5;
    addNamedBox(
      root,
      `${namePrefix}.ovenCavityFloor${colTag}`,
      bayW - 0.008,
      0.014,
      cavD,
      colCx,
      ovenBotY + 0.007,
      cavZ,
      cavityDarkMat
    );
    addNamedBox(
      root,
      `${namePrefix}.ovenCavityCeiling${colTag}`,
      bayW - 0.008,
      0.014,
      cavD,
      colCx,
      ovenTopY - 0.007,
      cavZ,
      cavityDarkMat
    );
    // Chrome wire oven rack inside cavity
    const rackY = ovenBotY + ovenZoneH * 0.44;
    addNamedBox(
      root,
      `${namePrefix}.ovenRackFrameFront${colTag}`,
      bayW - 0.024,
      0.005,
      0.006,
      colCx,
      rackY,
      cavZ + cavD * 0.42,
      stainlessMat,
      true
    );
    for (let bar = 0; bar < 6; bar++) {
      const bx = colCx - (bayW - 0.048) * 0.5 + (bar / 5) * (bayW - 0.048);
      addNamedBox(
        root,
        `${namePrefix}.ovenRackWire_${colTag}_${bar + 1}`,
        0.004,
        0.004,
        cavD - 0.04,
        bx,
        rackY,
        cavZ,
        stainlessMat,
        true
      );
    }

    // Interactive drop-down 51 L oven door (`axis: 'x'`, hinged along bottom edge)
    const doorW = bayW - 0.008;
    const doorH = ovenZoneH - 0.008;
    const doorCy = ovenBotY + ovenZoneH * 0.5;
    const doorZ = frontZ - doorThick * 0.5;

    const ovenDoor = new THREE.Group();
    ovenDoor.name = `${namePrefix}.ovenDoor${colTag}`;
    ovenDoor.position.set(colCx, doorCy, doorZ);
    root.add(ovenDoor);

    addNamedBox(
      ovenDoor,
      `${ovenDoor.name}.enamelSlab`,
      doorW,
      doorH,
      doorThick - 0.008,
      0,
      0,
      -0.002,
      enamelMat
    );
    // Bevelled front cushion trim plate + Aged Brass trim strip & cool-touch Lacanche bar handle
    addNamedBox(
      ovenDoor,
      `${ovenDoor.name}.frontBevelPlate`,
      doorW - 0.024,
      doorH - 0.024,
      0.006,
      0,
      0,
      (doorThick - 0.008) * 0.5 + 0.001,
      enamelMat,
      true
    );
    // Horizontal Aged Brass handle + twin turned standoff pillars
    const handleY = doorH * 0.5 - 0.052;
    const handleZ = doorThick * 0.5 + 0.036;
    const handleBar = addNamedCyl(
      ovenDoor,
      `${ovenDoor.name}.brassHandleBar`,
      0.0095,
      0.0095,
      doorW * 0.72,
      14,
      0,
      handleY,
      handleZ,
      brassMat,
      true
    );
    handleBar.rotation.z = Math.PI * 0.5;
    for (const [hSide, hsx] of [
      ['L', -doorW * 0.28],
      ['R', doorW * 0.28],
    ] as const) {
      const standoff = addNamedCyl(
        ovenDoor,
        `${ovenDoor.name}.handleStandoff_${hSide}`,
        0.008,
        0.011,
        0.034,
        12,
        hsx,
        handleY,
        doorThick * 0.5 + 0.018,
        brassMat,
        true
      );
      standoff.rotation.x = Math.PI * 0.5;
    }

    wireCatalogHingedDoor(registry, {
      parent: root,
      door: ovenDoor,
      hingeOffset: [0, -doorH * 0.5 + 0.014, 0],
      axis: 'x',
      openAngle: Math.PI * 0.45,
      label: colTag === 'Left' ? 'Open Left Oven Door' : 'Open Right Oven Door',
      audio: { openPreset: 'ovenDoorLatch', closePreset: 'ovenDoorLatch' },
    });

    // Twin sliding lower warming/simmer drawers
    const drW = bayW - 0.008;
    const drH = drawerZoneH - 0.008;
    const drCy = drawerBotY + drawerZoneH * 0.5;
    const warmingDrawer = new THREE.Group();
    warmingDrawer.name = `${namePrefix}.warmingDrawer${colTag}`;
    warmingDrawer.position.set(colCx, drCy, doorZ);
    root.add(warmingDrawer);

    addNamedBox(
      warmingDrawer,
      `${warmingDrawer.name}.front`,
      drW,
      drH,
      doorThick - 0.006,
      0,
      0,
      0,
      enamelMat
    );
    // Aged Brass turned drawer knob / bar pull
    const drBar = addNamedCyl(
      warmingDrawer,
      `${warmingDrawer.name}.brassHandle`,
      0.008,
      0.008,
      drW * 0.56,
      12,
      0,
      0.015,
      doorThick * 0.5 + 0.028,
      brassMat,
      true
    );
    drBar.rotation.z = Math.PI * 0.5;
    for (const [hSide, hsx] of [
      ['L', -drW * 0.21],
      ['R', drW * 0.21],
    ] as const) {
      const st = addNamedCyl(
        warmingDrawer,
        `${warmingDrawer.name}.standoff_${hSide}`,
        0.007,
        0.009,
        0.026,
        10,
        hsx,
        0.015,
        doorThick * 0.5 + 0.013,
        brassMat,
        true
      );
      st.rotation.x = Math.PI * 0.5;
    }

    attachDrawerBoxBehindFront(
      warmingDrawer,
      drW - 0.02,
      drH - 0.016,
      carcassDepth - 0.08,
      '+z',
      false
    );

    wireCatalogSlidingDrawer(registry, {
      drawer: warmingDrawer,
      slideDelta: [0, 0, 0.36],
      label: colTag === 'Left' ? 'Open Left Warming Drawer' : 'Open Right Warming Drawer',
    });
  }

  // Control fascia band (`y = bodyTopY - fasciaH .. bodyTopY`), Aged Brass Lacanche crest plaque & 7 brass rotary control bezels
  const fasciaCy = bodyTopY - fasciaH * 0.5;
  addNamedBox(
    root,
    `${namePrefix}.controlFascia`,
    w - cheekT * 2,
    fasciaH,
    doorThick,
    0,
    fasciaCy,
    frontZ - doorThick * 0.5,
    enamelMat
  );

  // Lacanche brass script badge in center of fascia
  addNamedBox(
    root,
    `${namePrefix}.lacancheCrestBadge`,
    0.105,
    0.022,
    0.004,
    0,
    fasciaCy + 0.032,
    frontZ + 0.002,
    brassMat,
    true
  );

  // 7 Aged Brass rotary control bezels & knurled dials (2 oven thermostats + 5 gas burner valves)
  const dialXs = [-0.41, -0.31, -0.19, -0.095, 0.095, 0.28, 0.4];
  dialXs.forEach((dx, dIdx) => {
    const bezel = addNamedCyl(
      root,
      `${namePrefix}.controlBezel_${dIdx + 1}`,
      0.023,
      0.025,
      0.006,
      18,
      dx,
      fasciaCy + 0.012,
      frontZ + 0.003,
      brassMat,
      true
    );
    bezel.rotation.x = Math.PI * 0.5;

    const knob = addNamedCyl(
      root,
      `${namePrefix}.controlKnob_${dIdx + 1}`,
      0.016,
      0.018,
      0.022,
      16,
      dx,
      fasciaCy + 0.012,
      frontZ + 0.017,
      darkBrassMat,
      true
    );
    knob.rotation.x = Math.PI * 0.5;
  });

  // Aged Brass front towel/hand rail (`+55 mm` projection from frontZ = `frontZ + 0.055`)
  const towelRailY = bodyTopY - fasciaH + 0.012;
  const towelRailZ = frontZ + 0.055;
  const towelBar = addNamedCyl(
    root,
    `${namePrefix}.agedBrassTowelRail`,
    0.011,
    0.011,
    w - 0.04,
    16,
    0,
    towelRailY,
    towelRailZ,
    brassMat,
    true
  );
  towelBar.rotation.z = Math.PI * 0.5;

  for (const [bTag, bx] of [
    ['Left', -(w * 0.5 - 0.048)],
    ['Center', 0],
    ['Right', w * 0.5 - 0.048],
  ] as const) {
    const bracket = addNamedCyl(
      root,
      `${namePrefix}.towelRailBracket${bTag}`,
      0.009,
      0.012,
      0.055,
      12,
      bx,
      towelRailY,
      frontZ + 0.0275,
      brassMat,
      true
    );
    bracket.rotation.x = Math.PI * 0.5;
  }
  for (const [fTag, sign] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    const finial = new THREE.Mesh(sharedSphereGeometry(0.016, 12, 10), brassMat);
    finial.name = `${namePrefix}.towelRailFinial${fTag}`;
    finial.position.set(sign * (w * 0.5 - 0.014), towelRailY, towelRailZ);
    tagHighLod(finial);
    root.add(finial);
  }

  // 1-piece brushed stainless-steel 5-burner gas hob top (`1000 x 650 x 36 mm` pressed tray + rear flue riser)
  addNamedBox(
    root,
    `${namePrefix}.stainlessHobDeck`,
    w + 0.004,
    hobDeckT,
    d + 0.004,
    0,
    hobTopY - hobDeckT * 0.5,
    0,
    stainlessMat
  );
  // Rear brushed stainless oven-vent upstand riser (`H 55 mm`) along back edge
  addNamedBox(
    root,
    `${namePrefix}.rearFlueVentUpstand`,
    w,
    0.055,
    0.052,
    0,
    hobTopY + 0.0275,
    rearZ + 0.026,
    stainlessMat
  );
  for (let v = -4; v <= 4; v++) {
    addNamedBox(
      root,
      `${namePrefix}.flueVentSlot_${v + 5}`,
      0.068,
      0.003,
      0.022,
      v * 0.095,
      hobTopY + 0.0565,
      rearZ + 0.026,
      cavityDarkMat,
      true
    );
  }

  // 5 gas burners: Central 5 kW solid-brass dual-ring wok burner + 4 surrounding solid-brass/cast-iron burners
  const burnerSpecs: readonly [string, number, number, number, boolean][] = [
    ['center5kWWok', 0, 0.02, 0.068, true],
    ['frontLeftRapid', -0.31, 0.145, 0.046, false],
    ['rearLeftSemiRapid', -0.31, -0.105, 0.038, false],
    ['frontRightSemiRapid', 0.31, 0.145, 0.038, false],
    ['rearRightSimmer', 0.31, -0.105, 0.029, false],
  ];
  for (const [bName, bx, bz, bRad, isWok] of burnerSpecs) {
    addNamedCyl(
      root,
      `${namePrefix}.${bName}_spreader`,
      bRad * 0.92,
      bRad,
      0.014,
      20,
      bx,
      hobTopY + 0.007,
      bz,
      brassMat,
      true
    );
    addNamedCyl(
      root,
      `${namePrefix}.${bName}_cap`,
      bRad * 0.96,
      bRad * 0.96,
      0.006,
      20,
      bx,
      hobTopY + 0.017,
      bz,
      isWok ? brassMat : castIronMat,
      true
    );
    if (isWok) {
      addNamedCyl(
        root,
        `${namePrefix}.${bName}_innerCrown`,
        0.026,
        0.026,
        0.005,
        16,
        bx,
        hobTopY + 0.023,
        bz,
        darkBrassMat,
        true
      );
    }
  }

  // 4 matte cast-iron pan support grids (`230 x 470 mm` / center wok ring) sitting cleanly at `hobTopY + 0.028`
  const grateZones = [-0.355, -0.125, 0.125, 0.355];
  const grateD = 0.46;
  const grateW = 0.215;
  const grateH = 0.022;
  const grateCy = hobTopY + grateH * 0.5 + 0.002;
  const grateCz = 0.02;

  grateZones.forEach((gx, gIdx) => {
    // Perimeter cast-iron frame + cross fingers (non-overlapping bars)
    for (const [eTag, ez] of [
      ['Front', grateCz + grateD * 0.5 - 0.006],
      ['Rear', grateCz - grateD * 0.5 + 0.006],
    ] as const) {
      addNamedBox(
        root,
        `${namePrefix}.panGrid_${gIdx + 1}_edge${eTag}`,
        grateW,
        grateH,
        0.012,
        gx,
        grateCy,
        ez,
        castIronMat,
        true
      );
    }
    for (const [sTag, sx] of [
      ['L', gx - grateW * 0.5 + 0.006],
      ['R', gx + grateW * 0.5 - 0.006],
    ] as const) {
      addNamedBox(
        root,
        `${namePrefix}.panGrid_${gIdx + 1}_side${sTag}`,
        0.012,
        grateH,
        grateD - 0.024,
        sx,
        grateCy,
        grateCz,
        castIronMat,
        true
      );
    }
    for (const [mTag, mz] of [
      ['Cross1', grateCz - 0.105],
      ['Cross2', grateCz + 0.02],
      ['Cross3', grateCz + 0.145],
    ] as const) {
      addNamedBox(
        root,
        `${namePrefix}.panGrid_${gIdx + 1}_${mTag}`,
        grateW - 0.024,
        grateH * 0.85,
        0.01,
        gx,
        grateCy + 0.001,
        mz,
        castIronMat,
        true
      );
    }
  });

  // Central cast-iron wok cradle ring over the 5 kW burner
  const wokCradle = new THREE.Mesh(sharedTorusGeometry(0.105, 0.008, 10, 24), castIronMat);
  wokCradle.name = `${namePrefix}.centralWokRing`;
  wokCradle.rotation.x = Math.PI * 0.5;
  wokCradle.position.set(0, hobTopY + grateH + 0.008, 0.02);
  tagHighLod(wokCradle);
  root.add(wokCradle);

  // Optional cookware: Le Creuset Dutch oven & French copper saucepan
  const cookware = opts.cookware ?? 'both';
  const panRestY = hobTopY + grateH + 0.004;

  if (cookware === 'dutchOven' || cookware === 'both') {
    const leCreusetMat = getVitreousEnamelMaterial(0x9e2b1c, `${namePrefix}.leCreusetCerise`);
    const potH = 0.115;
    const potX = -0.31;
    const potZ = 0.145;
    addNamedCyl(
      root,
      `${namePrefix}.leCreusetDutchOvenBody`,
      0.132,
      0.118,
      potH,
      22,
      potX,
      panRestY + potH * 0.5,
      potZ,
      leCreusetMat,
      true
    );
    addNamedCyl(
      root,
      `${namePrefix}.leCreusetDutchOvenLid`,
      0.125,
      0.134,
      0.018,
      22,
      potX,
      panRestY + potH + 0.009,
      potZ,
      leCreusetMat,
      true
    );
    addNamedCyl(
      root,
      `${namePrefix}.leCreusetBrassLidKnob`,
      0.022,
      0.014,
      0.016,
      14,
      potX,
      panRestY + potH + 0.026,
      potZ,
      brassMat,
      true
    );
    for (const [lSide, sign] of [
      ['L', -1],
      ['R', 1],
    ] as const) {
      const ear = new THREE.Mesh(sharedTorusGeometry(0.022, 0.0055, 8, 14, Math.PI), leCreusetMat);
      ear.name = `${namePrefix}.leCreusetLoopHandle_${lSide}`;
      ear.rotation.x = Math.PI * 0.5;
      ear.rotation.z = sign < 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
      ear.position.set(potX + sign * 0.128, panRestY + potH - 0.018, potZ);
      tagHighLod(ear);
      root.add(ear);
    }
  }

  if (cookware === 'copperSaucepan' || cookware === 'both') {
    const panH = 0.092;
    const panX = 0.31;
    const panZ = -0.105;
    addNamedCyl(
      root,
      `${namePrefix}.copperSaucepanBody`,
      0.095,
      0.092,
      panH,
      20,
      panX,
      panRestY + panH * 0.5,
      panZ,
      copperMat,
      true
    );
    addNamedCyl(
      root,
      `${namePrefix}.copperSaucepanTinLining`,
      0.089,
      0.088,
      0.006,
      20,
      panX,
      panRestY + panH - 0.002,
      panZ,
      stainlessMat,
      true
    );
    const panHandle = addNamedCyl(
      root,
      `${namePrefix}.copperSaucepanHandle`,
      0.0065,
      0.008,
      0.165,
      10,
      panX + 0.135,
      panRestY + panH - 0.005,
      panZ + 0.065,
      brassMat,
      true
    );
    panHandle.rotation.z = -Math.PI * 0.44;
    panHandle.rotation.y = -0.42;
  }

  const finishNameMap: Record<LacancheEnamelFinish, string> = {
    glossBlack: 'Gloss Black Enamel / Aged Brass',
    frenchBlue: 'French Blue Enamel / Aged Brass',
    ivory: 'Ivory Enamel / Aged Brass',
    armorGreen: 'Armor Green Enamel / Aged Brass',
  };
  const resolvedFinish = opts.finish ?? 'glossBlack';
  const out = finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
  return attachAssetMetadata(out, {
    name: 'Lacanche Cluny 1000 Classic Range Cooker',
    brand: 'Lacanche',
    collection: 'Classic Gastronome',
    sku: `LC-CLU1000C-${resolvedFinish.toUpperCase()}`,
    finish: finishNameMap[resolvedFinish],
    category: 'appliance',
    dimensionsMm: [1000, 650, 900],
    productUrl: 'https://www.lacanche.co.uk/classic-range/cluny-classic/',
    schematicUrl: 'https://www.lacanche.co.uk/wp-content/uploads/Cluny-1000-Classic-Spec-Sheet.pdf',
  });
}
