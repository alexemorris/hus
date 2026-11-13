import * as THREE from 'three';
import {
  attachAssetInteraction,
  attachAssetMetadata,
} from '../shared/catalog-smart-metadata.ts';
import { createBrickMaterial } from '../../engine/textures/brick-materials.ts';
import {
  buildHallWoodBurningStoveFirebox,
  type WoodBurningStoveFireController,
} from '../heating/wood-burning-stove-fire.ts';
import {
  addNamedBox,
  addNamedCyl,
  finalizeCatalogGroup,
  getAgedBrassMaterial,
  getHonedCarraraCatalogMaterial,
  getMatteCastIronMaterial,
} from '../shared/neptune-and-georgian-materials.ts';
import type { CatalogInteractionContext } from './neptune-kitchen-joinery.ts';
import {
  addMetricMasonryBox,
  resolveGeorgianRegistry,
} from "./georgian-shared.ts";

export interface GeorgianBolectionFireplaceOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  readonly hearthStyle?: 'slate' | 'herringboneBrick';
  /** Include the Charnwood *C-Five* (`556 x 357 x 560 mm`) cast-iron stove + Ø125 mm flue & animated fire. Default `true`. */
  readonly includeStove?: boolean;
}

/**
 * `1420 x 210 x 1160 mm` George III Honed Carrara bolection marble fireplace surround,
 * herringbone firebrick chamber, honed slate / herringbone-brick hearth (`1520 x 480 x 35 mm`),
 * and **Charnwood *C-Five* (`556 x 357 x 560 mm`)** cast-iron wood-burning stove body + `Ø125 mm` flue pipe
 * (integrating `buildHallWoodBurningStoveFirebox` and registering its `WoodBurningStoveFireController` when `ctx` is supplied).
 * Local origin `(0, 0, 0)` is at floor level (`y = 0`) on the chimney-breast face (`z = 0`), with chamber recessed into `-Z` and hearth/surround projecting `+Z`.
 */
export function buildGeorgianBolectionFireplace(
  ctx: CatalogInteractionContext = null,
  opts: GeorgianBolectionFireplaceOptions = {}
): THREE.Group {
  const namePrefix = opts.name ?? 'georgianBolectionFireplace';
  const carraraMat = getHonedCarraraCatalogMaterial();
  const slateMat = getMatteCastIronMaterial(0x272a2d);
  const firebrickMat = createBrickMaterial({
    preset: 'heritage-red-flemish',
    bond: 'herringbone-45',
    weathering: { sootLevel: 0.52, kilnFlash: 0.4 },
  });
  const castIronMat = getMatteCastIronMaterial(0x1f2124);
  const brassMat = getAgedBrassMaterial();
  const registry = resolveGeorgianRegistry(ctx);

  const root = new THREE.Group();
  root.name = namePrefix;

  const hearthW = 1.52;
  const hearthFrontD = 0.48;
  const chamberD = 0.42;
  const hearthH = 0.035;
  const hearthMat = (opts.hearthStyle ?? 'slate') === 'herringboneBrick' ? firebrickMat : slateMat;

  // Front hearth (`z = 0 .. +0.48`) + chamber hearth floor (`z = -0.42 .. 0`) as one continuous non-overlapping slab
  addMetricMasonryBox(
    root,
    `${namePrefix}.frontHearthSlab`,
    hearthW,
    hearthH,
    hearthFrontD,
    0,
    hearthH * 0.5,
    hearthFrontD * 0.5,
    hearthMat
  );

  const openW = 0.88;
  const openH = 0.86;
  const chamberWallT = 0.04;
  addMetricMasonryBox(
    root,
    `${namePrefix}.chamberHearthFloor`,
    openW + chamberWallT * 2,
    hearthH,
    chamberD,
    0,
    hearthH * 0.5,
    -chamberD * 0.5,
    hearthMat
  );

  // Herringbone firebrick chamber walls (`z = -chamberD .. 0`, strictly behind `z = 0`)
  addMetricMasonryBox(
    root,
    `${namePrefix}.chamberBackFirebrick`,
    openW,
    openH,
    chamberWallT,
    0,
    hearthH + openH * 0.5,
    -chamberD + chamberWallT * 0.5,
    firebrickMat
  );
  for (const [sTag, sign] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    addMetricMasonryBox(
      root,
      `${namePrefix}.chamberCheekFirebrick${sTag}`,
      chamberWallT,
      openH,
      chamberD - chamberWallT,
      sign * (openW * 0.5 + chamberWallT * 0.5),
      hearthH + openH * 0.5,
      -(chamberD - chamberWallT) * 0.5,
      firebrickMat
    );
  }
  addNamedBox(
    root,
    `${namePrefix}.chamberSoffitRegisterPlate`,
    openW + chamberWallT * 2,
    0.025,
    chamberD,
    0,
    hearthH + openH + 0.0125,
    -chamberD * 0.5,
    slateMat
  );

  // George III Honed Carrara bolection marble surround (`1420 x 210 x 1160 mm` above hearth)
  const surrW = 1.42;
  const surrTotalH = 1.16;
  const shelfH = 0.055;
  const surrD = 0.21;
  const legW = (surrW - openW) * 0.5;
  const legH = openH;
  const friezeH = surrTotalH - hearthH - legH - shelfH;
  const slipsD = 0.115;

  // Outer Carrara jamb legs & frieze header (`z = 0 .. slipsD`)
  for (const [sTag, sign] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    addNamedBox(
      root,
      `${namePrefix}.carraraJambFootBlock${sTag}`,
      legW + 0.024,
      0.13,
      slipsD + 0.02,
      sign * (openW * 0.5 + legW * 0.5),
      hearthH + 0.065,
      (slipsD + 0.02) * 0.5,
      carraraMat
    );
    addNamedBox(
      root,
      `${namePrefix}.carraraJambPilaster${sTag}`,
      legW,
      legH - 0.13,
      slipsD,
      sign * (openW * 0.5 + legW * 0.5),
      hearthH + 0.13 + (legH - 0.13) * 0.5,
      slipsD * 0.5,
      carraraMat
    );
  }

  addNamedBox(
    root,
    `${namePrefix}.carraraFriezeLintel`,
    surrW,
    friezeH,
    slipsD,
    0,
    hearthH + legH + friezeH * 0.5,
    slipsD * 0.5,
    carraraMat
  );

  // Central carved George III tablet plaque proud on the upper frieze above the bolection header roll (`z = slipsD + 0.001 .. slipsD + 0.019`)
  const upperFriezeH = Math.max(0.06, friezeH - 0.095 - 0.022);
  addNamedBox(
    root,
    `${namePrefix}.carraraCenterFriezeTablet`,
    0.44,
    upperFriezeH,
    0.018,
    0,
    hearthH + legH + 0.095 + (friezeH - 0.095) * 0.5,
    slipsD + 0.01,
    carraraMat
  );

  // Bold George III bolection cushion moulding framing the fireplace opening (`z = slipsD .. slipsD + 0.055`, strictly forward of jambs/frieze!)
  const bolW = 0.095;
  const bolD = 0.052;
  const bolZ = slipsD + bolD * 0.5;
  for (const [sTag, sign] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    addNamedBox(
      root,
      `${namePrefix}.bolectionVerticalRoll${sTag}`,
      bolW,
      legH - 0.13,
      bolD,
      sign * (openW * 0.5 + bolW * 0.5),
      hearthH + 0.13 + (legH - 0.13) * 0.5,
      bolZ,
      carraraMat
    );
  }
  addNamedBox(
    root,
    `${namePrefix}.bolectionHeaderRoll`,
    openW + bolW * 2,
    bolW,
    bolD,
    0,
    hearthH + legH + bolW * 0.5,
    bolZ,
    carraraMat
  );

  // Breakfront Honed Carrara mantle shelf (`1480 x 210 x 55 mm`)
  addNamedBox(
    root,
    `${namePrefix}.carraraMantleShelf`,
    surrW + 0.06,
    shelfH,
    surrD,
    0,
    hearthH + legH + friezeH + shelfH * 0.5,
    surrD * 0.5,
    carraraMat
  );

  // Charnwood *C-Five* (`556 W x 357 D x 560 H mm`) cast-iron wood-burning stove + Ø125 mm flue pipe
  let fireController: WoodBurningStoveFireController | undefined;
  if (opts.includeStove ?? true) {
    const stoveW = 0.556;
    const stoveD = 0.357;
    const stoveH = 0.56;
    const legStoveH = 0.125;

    const stoveOuter = new THREE.Group();
    stoveOuter.name = `${namePrefix}.charnwoodCFiveStove`;
    stoveOuter.position.set(0, hearthH, -0.15);
    root.add(stoveOuter);

    // 4 splayed Charnwood corner legs
    for (const [lTag, lx, lz] of [
      ['FL', -stoveW * 0.43, stoveD * 0.4],
      ['FR', stoveW * 0.43, stoveD * 0.4],
      ['BL', -stoveW * 0.43, -stoveD * 0.4],
      ['BR', stoveW * 0.43, -stoveD * 0.4],
    ] as const) {
      addNamedBox(
        stoveOuter,
        `${stoveOuter.name}.leg_${lTag}`,
        0.044,
        legStoveH,
        0.044,
        lx,
        legStoveH * 0.5,
        lz,
        castIronMat,
        true
      );
    }

    // Hollow cast-iron stove body shell around the recessed firebox so front glass reveals flames & embers!
    const bodyBotY = legStoveH;
    const bodyTopY = stoveH - 0.024;
    const bodyBoxH = bodyTopY - bodyBotY;
    const ashLipH = 0.055;
    const headerH = 0.075;
    const cheekW = 0.078;

    // Bottom ashpan floor & projecting ash-lip apron
    addNamedBox(
      stoveOuter,
      `${stoveOuter.name}.stoveFloorPlate`,
      stoveW,
      ashLipH,
      stoveD + 0.036,
      0,
      bodyBotY + ashLipH * 0.5,
      0.018,
      castIronMat
    );
    // Top convection plate (`556 x 357 x 24 mm`)
    addNamedBox(
      stoveOuter,
      `${stoveOuter.name}.stoveTopPlate`,
      stoveW + 0.016,
      0.024,
      stoveD + 0.016,
      0,
      stoveH - 0.012,
      0,
      castIronMat
    );
    // Back cast-iron wall
    const midWindowH = bodyBoxH - ashLipH - headerH;
    const midWindowCy = bodyBotY + ashLipH + midWindowH * 0.5;
    addNamedBox(
      stoveOuter,
      `${stoveOuter.name}.stoveRearWall`,
      stoveW,
      bodyBoxH - ashLipH,
      0.055,
      0,
      bodyBotY + ashLipH + (bodyBoxH - ashLipH) * 0.5,
      -stoveD * 0.5 + 0.0275,
      castIronMat
    );
    // Left & Right cast-iron side cheeks strictly between rear wall and front face
    for (const [cTag, sign] of [
      ['Left', -1],
      ['Right', 1],
    ] as const) {
      addNamedBox(
        stoveOuter,
        `${stoveOuter.name}.stoveSideCheek${cTag}`,
        cheekW,
        midWindowH,
        stoveD - 0.055,
        sign * (stoveW * 0.5 - cheekW * 0.5),
        midWindowCy,
        0.0275,
        castIronMat
      );
    }
    // Upper cast-iron lintel above ceramic glass window
    addNamedBox(
      stoveOuter,
      `${stoveOuter.name}.stoveHeaderBand`,
      stoveW,
      headerH,
      stoveD - 0.055,
      0,
      bodyTopY - headerH * 0.5,
      0.0275,
      castIronMat
    );
    // Cool-to-touch Charnwood turned handle & Quattro air-control pull rod
    addNamedCyl(
      stoveOuter,
      `${stoveOuter.name}.doorHandleGrip`,
      0.011,
      0.011,
      0.11,
      12,
      stoveW * 0.5 - 0.038,
      midWindowCy,
      stoveD * 0.5 + 0.026,
      brassMat,
      true
    );
    const airKnob = addNamedCyl(
      stoveOuter,
      `${stoveOuter.name}.quattroAirControl`,
      0.014,
      0.014,
      0.024,
      12,
      0,
      bodyBotY + 0.028,
      stoveD * 0.5 + 0.048,
      brassMat,
      true
    );
    airKnob.rotation.x = Math.PI * 0.5;

    // Ø125 mm matte cast-iron flue pipe rising cleanly into the register plate
    const flueH = Math.max(0.28, openH - stoveH + 0.02);
    addNamedCyl(
      stoveOuter,
      `${stoveOuter.name}.flueCollar`,
      0.074,
      0.078,
      0.036,
      18,
      0,
      stoveH + 0.018,
      -0.05,
      castIronMat,
      true
    );
    addNamedCyl(
      stoveOuter,
      `${stoveOuter.name}.fluePipe125`,
      0.0625,
      0.0625,
      flueH,
      20,
      0,
      stoveH + 0.036 + flueH * 0.5,
      -0.05,
      castIronMat
    );

    // Oriented inner firebox container: `buildHallWoodBurningStoveFirebox` faces `-X` in its own frame,
    // so rotating `-Math.PI / 2` around Y aims the ceramic door glass & hearth glow straight out `+Z`!
    const fireboxMount = new THREE.Group();
    fireboxMount.name = `${stoveOuter.name}.fireboxMount`;
    fireboxMount.rotation.y = -Math.PI * 0.5;
    fireboxMount.position.set(0, 0.002, 0.004);
    stoveOuter.add(fireboxMount);

    fireController = buildHallWoodBurningStoveFirebox({
      stoveGroup: fireboxMount,
      castIronMat,
      namePrefix: `${namePrefix}.firebox`,
      id: `stove-fire:${namePrefix}`,
      label: 'Charnwood C-Five Wood-Burning Stove',
    });

    if (registry) {
      registry.registerAnimatedInteractable(fireController);
    } else if (fireController) {
      const fc = fireController;
      attachAssetInteraction(root, {
        kind: 'custom',
        label: 'Light Charnwood C-Five Wood-Burning Stove',
        activeLabel: 'Extinguish Charnwood C-Five Stove',
        initialActive: true,
        audio: { activeLoopPreset: 'woodStove', volume: 0.6 },
        onToggle: () => {
          fc.trigger();
        },
        onStep: (dt) => fc.step(dt),
      });
    }
  }

  const finalized = finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
  if (fireController) {
    finalized.userData.stoveFireController = fireController;
  }
  return attachAssetMetadata(finalized, {
    name: 'Georgian Carrara Bolection Chimneypiece & Charnwood C-Five Stove',
    brand: 'Chesneys & Charnwood',
    collection: 'Georgian Marble Chimneypieces / C-Series',
    sku: 'CHES-BOL-CHARN-C5',
    finish: 'Honed Carrara Marble, Riven Welsh Slate & Matte Black Cast Iron',
    category: 'architectural',
    dimensionsMm: [1420, 480, 1220],
    productUrl: 'https://www.charnwood.com/range/stove/c-five/',
    schematicUrl: 'https://www.charnwood.com/wp-content/uploads/C-Five-Dimensions-Spec.pdf',
  });
}

