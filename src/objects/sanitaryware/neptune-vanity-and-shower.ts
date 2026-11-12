import * as THREE from 'three';
import {
  attachAssetMetadata,
  formatBrasswareFinishLabel,
  mmFromMetres,
  resolveBrasswareCode,
  wireCatalogHingedDoor,
  wireCatalogSlidingDrawer,
} from '../shared/catalog-smart-metadata.ts';
import type { InteractionRegistry } from '../../engine/interaction/interaction-registry.ts';
import type { CatalogInteractionContext } from '../architectural/neptune-kitchen-joinery.ts';
import { createSculptedCushionGeometry } from '../furniture/barker-and-stonehouse-sofas.ts';
import { attachDrawerBoxBehindFront } from '../joinery/cabinet-interior.ts';
import {
  addCockBeadApertureTrim,
  addNamedBox,
  addNamedCyl,
  buildAgedBrassBarlowCupPull,
  buildAgedBrassMushroomKnob,
  buildShakerDoorAssembly,
  finalizeCatalogGroup,
  getAgedBrassMaterial,
  getCharacterOakMaterial,
  getClearArchitecturalGlassMaterial,
  getHeavyFireclayMaterial,
  getHonedCarraraCatalogMaterial,
  getMatteCastIronMaterial,
  getPaintedJoineryMaterial,
  getWarm2700kLedMaterial,
  getWovenFabricMaps,
  getZelligeTileMaps,
  sharedSphereGeometry,
  tagHighLod,
} from '../shared/neptune-and-georgian-materials.ts';
import { getBathroomBrassMaterials } from './bathroom-materials.ts';
import type {
  BasinTapSlotValue,
  BrasswareFinishCode,
} from './bathroom-spec-types.ts';
import {
  buildBasinTapFromSpec,
  isCustomTapObject3D,
  registerTapMountAnchor,
} from './perrin-rowe-taps.ts';
import {
  buildArmstrongConcealedShowerSet,
  buildArmstrongDeck3HoleBasinMixer,
} from './perrin-rowe-armstrong.ts';

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

export interface NeptuneChichesterVanityOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  /** `'single'` (`640 x 555 x 965 mm`) or `'double'` (`1240 x 555 x 965 mm`). Default `'double'`. */
  readonly variant?: 'single' | 'double';
  /** Paint colour (default Neptune *Shingle* `#D5D4CA` or *Old Chalk* `#D8D2C2`). */
  readonly paintColor?: THREE.ColorRepresentation;
  /** Perrin & Rowe brassware finish (`'SB'` Satin/Aged Brass default across all 9 finishes). */
  readonly brassFinish?: BrasswareFinishCode;
  /** Cabinet Mushroom knob & Barlow cup-pull hardware finish (defaults to Aged Brass when omitted, or any 9-finish `BrasswareFinishCode`). */
  readonly hardwareFinish?: BrasswareFinishCode;
  /** Slotted click-clack basin waste finish (defaults to `brassFinish` when specified, or Aged Brass). */
  readonly wasteFinish?: BrasswareFinishCode;
  /** Composable basin tap slot (`PerrinRoweBasinTapSpec`, custom `THREE.Object3D`, `'default'`, or `'none'` for wall-mounted mixers). */
  readonly tap?: BasinTapSlotValue;
}

/**
 * **Neptune *Chichester* Washstand Vanity** in `'single'` (`640 x 555 x 965 mm`) or `'double'` (`1240 x 555 x 965 mm`):
 * - Cock-beaded painted face-frame (`28 mm`) with ogee skirting plinth (`105 mm`), interactive inset Shaker cupboard doors
 *   (*Aged Brass Mushroom* knobs) and lower linen drawer(s) (*Barlow* cup pulls)
 * - `30 mm` bullnose Honed Carrara Marble worktop (`y = 845..875 mm`) + `90 mm` Carrara rear upstand (`y = 875..965 mm` -> total `H 965 mm`)
 *   with clean rectangular cutouts framing recessed glazed-ceramic undermount oval/rectangular basin bowl(s) (`0` z-fight!)
 * - **Perrin & Rowe Traditional / Armstrong 3-hole brass basin mixer(s)** (`200 mm` centres) + slotted brass click-clack waste(s).
 * Local origin `(0, 0, 0)` is at floor level (`y = 0`), centered in X and Z (`[-D/2 .. +D/2]`), facing `+Z`.
 */
export function buildNeptuneChichesterVanity(
  ctx: CatalogInteractionContext = null,
  opts: NeptuneChichesterVanityOptions = {}
): THREE.Group {
  const variant = opts.variant ?? 'double';
  const namePrefix =
    opts.name ??
    (variant === 'double' ? 'neptuneChichesterDoubleVanity' : 'neptuneChichesterSingleVanity');
  const w = variant === 'double' ? 1.24 : 0.64;
  const d = 0.555;
  const deckTopY = 0.875;
  const slabT = 0.03;
  const carcassTopY = deckTopY - slabT; // 0.845 m
  const upstandH = 0.09; // -> 0.965 m overall height!
  const plinthH = 0.105;

  const paintMat = getPaintedJoineryMaterial(
    opts.paintColor ?? 0xd5d4ca,
    0.52,
    `${namePrefix}.paint`
  );
  const carraraMat = getHonedCarraraCatalogMaterial();
  const ceramicMat = getHeavyFireclayMaterial();
  const oakMat = getCharacterOakMaterial();
  const brassMat = getAgedBrassMaterial();
  const brassFinish = opts.brassFinish ?? 'SB';
  const wasteMat =
    opts.wasteFinish !== undefined
      ? getBathroomBrassMaterials(opts.wasteFinish).primary
      : opts.brassFinish !== undefined
        ? getBathroomBrassMaterials(opts.brassFinish).primary
        : brassMat;
  const hwPalette = opts.hardwareFinish ? getBathroomBrassMaterials(opts.hardwareFinish) : null;
  const applyHardwareFinish = (hwGroup: THREE.Group): THREE.Group => {
    if (!hwPalette) return hwGroup;
    hwGroup.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh;
        m.material = m.name.endsWith('.flange') || m.name.endsWith('.backplateRose')
          ? hwPalette.darkShadow
          : hwPalette.primary;
      }
    });
    return hwGroup;
  };
  const registry = resolveRegistry(ctx);

  const root = new THREE.Group();
  root.name = namePrefix;

  const frontZ = d * 0.5;
  const rearZ = -d * 0.5;
  const frameT = 0.024;
  const stileW = 0.036;
  const doorT = 0.022;
  const wallT = 0.02;

  // Ogee skirting plinth (`y = 0 .. plinthH`)
  addNamedBox(
    root,
    `${namePrefix}.ogeeSkirtingPlinth`,
    w - 0.008,
    plinthH,
    d - 0.018,
    0,
    plinthH * 0.5,
    -0.004,
    paintMat
  );

  // Carcass side cheeks, rear service panel & internal oak shelf (`y = plinthH .. carcassTopY`)
  const bodyH = carcassTopY - plinthH;
  const bodyMidY = plinthH + bodyH * 0.5;
  for (const [sTag, sign] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    addNamedBox(
      root,
      `${namePrefix}.sideCheek${sTag}`,
      wallT,
      bodyH,
      d - frameT - 0.012,
      sign * (w * 0.5 - wallT * 0.5 - 0.004),
      bodyMidY,
      -frameT * 0.5,
      paintMat
    );
  }
  addNamedBox(
    root,
    `${namePrefix}.rearPanel`,
    w - wallT * 2 - 0.01,
    bodyH,
    0.016,
    0,
    bodyMidY,
    rearZ + 0.014,
    oakMat
  );
  addNamedBox(
    root,
    `${namePrefix}.internalOakFloor`,
    w - wallT * 2 - 0.012,
    0.018,
    d - frameT - 0.04,
    0,
    plinthH + 0.21,
    -0.008,
    oakMat
  );

  // Cock-beaded face-frame (`1` bay on single, `2` bays on double)
  const bayCount = variant === 'double' ? 2 : 1;
  const fz = frontZ - 0.012 - frameT * 0.5;
  const doorFaceZ = frontZ - 0.012;
  const bayW = (w - 0.016 - stileW * (bayCount + 1)) / bayCount;

  for (let s = 0; s <= bayCount; s++) {
    const sx = -(w - 0.016) * 0.5 + stileW * 0.5 + s * (bayW + stileW);
    addNamedBox(
      root,
      `${namePrefix}.faceFrameStile_${s + 1}`,
      stileW,
      bodyH,
      frameT,
      sx,
      bodyMidY,
      fz,
      paintMat
    );
  }

  const lowerDrawerH = 0.165;
  const upperDoorH = bodyH - stileW * 3 - lowerDrawerH;
  const drawerCy = plinthH + stileW + lowerDrawerH * 0.5;
  const doorCy = plinthH + stileW * 2 + lowerDrawerH + upperDoorH * 0.5;

  const basinCentersX: number[] = [];

  for (let b = 0; b < bayCount; b++) {
    const bx = -(w - 0.016) * 0.5 + stileW + bayW * 0.5 + b * (bayW + stileW);
    basinCentersX.push(bx);

    addNamedBox(root, `${namePrefix}.railTop_${b + 1}`, bayW, stileW, frameT, bx, carcassTopY - stileW * 0.5, fz, paintMat);
    addNamedBox(root, `${namePrefix}.railMid_${b + 1}`, bayW, stileW, frameT, bx, plinthH + stileW + lowerDrawerH + stileW * 0.5, fz, paintMat);
    addNamedBox(root, `${namePrefix}.railBot_${b + 1}`, bayW, stileW, frameT, bx, plinthH + stileW * 0.5, fz, paintMat);

    // Lower interactive cock-beaded towel/toiletries drawer
    addCockBeadApertureTrim(root, `${namePrefix}.drawerBead_${b + 1}`, bx, drawerCy, doorFaceZ, bayW, lowerDrawerH, paintMat);
    const drGroup = new THREE.Group();
    drGroup.name = `${namePrefix}.lowerDrawer_${b + 1}`;
    drGroup.position.set(bx, drawerCy, doorFaceZ - doorT * 0.5 - 0.001);
    root.add(drGroup);

    drGroup.add(
      buildShakerDoorAssembly(`${drGroup.name}.front`, bayW - 0.008, lowerDrawerH - 0.008, doorT, paintMat, 0.036)
    );
    const cupPull = applyHardwareFinish(buildAgedBrassBarlowCupPull(`${drGroup.name}.cupPull`));
    cupPull.position.set(0, 0, doorT * 0.5 + 0.001);
    drGroup.add(cupPull);
    const drBoxHolder = new THREE.Group();
    drBoxHolder.name = `${drGroup.name}.boxHolder`;
    drBoxHolder.position.set(0, 0, -(doorT * 0.5 + 0.002));
    drGroup.add(drBoxHolder);
    attachDrawerBoxBehindFront(drBoxHolder, bayW - 0.044, lowerDrawerH - 0.014, d - 0.14, '+z', false);
    wireCatalogSlidingDrawer(registry, {
      drawer: drGroup,
      slideDelta: [0, 0, 0.34],
      label: 'Open Vanity Lower Drawer',
    });

    // Paired interactive cock-beaded Shaker doors per basin bay
    addCockBeadApertureTrim(root, `${namePrefix}.doorBead_${b + 1}`, bx, doorCy, doorFaceZ, bayW, upperDoorH, paintMat);
    const leafW = (bayW - 0.012) * 0.5;
    let leftPivot: THREE.Object3D | null = null;
    let rightPivot: THREE.Object3D | null = null;

    for (const [dSide, sign] of [
      ['L', -1],
      ['R', 1],
    ] as const) {
      const dg = new THREE.Group();
      dg.name = `${namePrefix}.door_${b + 1}_${dSide}`;
      dg.position.set(bx + sign * (leafW * 0.5 + 0.002), doorCy, doorFaceZ - doorT * 0.5 - 0.001);
      root.add(dg);

      dg.add(
        buildShakerDoorAssembly(`${dg.name}.panel`, leafW, upperDoorH - 0.008, doorT, paintMat, 0.042)
      );
      const knob = applyHardwareFinish(buildAgedBrassMushroomKnob(`${dg.name}.knob`));
      knob.position.set(-sign * (leafW * 0.5 - 0.024), upperDoorH * 0.5 - 0.055, doorT * 0.5 + 0.001);
      dg.add(knob);

      const pivot = wireCatalogHingedDoor(registry, {
        parent: root,
        door: dg,
        hingeOffset: [sign * (leafW * 0.5 - 0.01), 0, 0],
        axis: 'y',
        openAngle: sign < 0 ? -Math.PI * 0.58 : Math.PI * 0.58,
        label: 'Open Vanity Cupboard Doors',
        linkGroup: `vanityDoors_${b + 1}`,
      });
      if (sign < 0) leftPivot = pivot;
      else rightPivot = pivot;
    }
    if (registry && leftPivot && rightPivot) {
      registry.linkDoorPair(leftPivot, rightPivot);
    }
  }

  // 30 mm bullnose Honed Carrara Marble worktop (`w x d x 0.030 m`) segmented cleanly around undermount basin cutout(s) (`0` z-fight!)
  const bowlW = 0.42;
  const bowlD = 0.3;
  const bowlDepth = 0.155;
  const bowlCenterZ = 0.035;
  const rearStripD = bowlCenterZ - bowlD * 0.5 - rearZ; // ~0.1625 m tap deck
  const frontStripD = frontZ - (bowlCenterZ + bowlD * 0.5); // ~0.0925 m front bullnose rail
  const slabMidY = carcassTopY + slabT * 0.5;

  // Rear tap-deck Carrara strip & front bullnose Carrara strip across full width `w`
  addNamedBox(
    root,
    `${namePrefix}.carraraRearTapDeck`,
    w,
    slabT,
    rearStripD,
    0,
    slabMidY,
    rearZ + rearStripD * 0.5,
    carraraMat
  );
  addNamedBox(
    root,
    `${namePrefix}.carraraFrontBullnoseStrip`,
    w,
    slabT,
    frontStripD,
    0,
    slabMidY,
    frontZ - frontStripD * 0.5,
    carraraMat
  );

  // Side & center Carrara bridge piers strictly between `bowlCenterZ - bowlD/2` and `bowlCenterZ + bowlD/2`
  let xCursor = -w * 0.5;
  basinCentersX.forEach((bcx, idx) => {
    const holeLeft = bcx - bowlW * 0.5;
    const bridgeW = holeLeft - xCursor;
    if (bridgeW > 0.005) {
      addNamedBox(
        root,
        `${namePrefix}.carraraDeckBridge_${idx + 1}`,
        bridgeW,
        slabT,
        bowlD,
        xCursor + bridgeW * 0.5,
        slabMidY,
        bowlCenterZ,
        carraraMat
      );
    }
    xCursor = bcx + bowlW * 0.5;

    // Undermount glazed vitreous-ceramic basin bowl (`y = carcassTopY - bowlDepth .. carcassTopY`)
    const wallThick = 0.018;
    const bowlBotY = carcassTopY - bowlDepth;
    addNamedBox(
      root,
      `${namePrefix}.undermountBasinFloor_${idx + 1}`,
      bowlW + wallThick * 2,
      wallThick,
      bowlD + wallThick * 2,
      bcx,
      bowlBotY + wallThick * 0.5,
      bowlCenterZ,
      ceramicMat
    );
    addNamedBox(
      root,
      `${namePrefix}.undermountBasinFront_${idx + 1}`,
      bowlW + wallThick * 2,
      bowlDepth - wallThick,
      wallThick,
      bcx,
      bowlBotY + wallThick + (bowlDepth - wallThick) * 0.5,
      bowlCenterZ + bowlD * 0.5 + wallThick * 0.5,
      ceramicMat
    );
    addNamedBox(
      root,
      `${namePrefix}.undermountBasinRear_${idx + 1}`,
      bowlW + wallThick * 2,
      bowlDepth - wallThick,
      wallThick,
      bcx,
      bowlBotY + wallThick + (bowlDepth - wallThick) * 0.5,
      bowlCenterZ - bowlD * 0.5 - wallThick * 0.5,
      ceramicMat
    );
    for (const [bSide, sx] of [
      ['L', -1],
      ['R', 1],
    ] as const) {
      addNamedBox(
        root,
        `${namePrefix}.undermountBasinSide_${idx + 1}_${bSide}`,
        wallThick,
        bowlDepth - wallThick,
        bowlD,
        bcx + sx * (bowlW * 0.5 + wallThick * 0.5),
        bowlBotY + wallThick + (bowlDepth - wallThick) * 0.5,
        bowlCenterZ,
        ceramicMat
      );
    }

    // Slotted brass click-clack basin waste + rear overflow escutcheon
    addNamedCyl(
      root,
      `${namePrefix}.brassWasteFlange_${idx + 1}`,
      0.031,
      0.026,
      0.006,
      18,
      bcx,
      bowlBotY + wallThick + 0.0035,
      bowlCenterZ,
      wasteMat,
      true
    );
    addNamedCyl(
      root,
      `${namePrefix}.brassClickClackPlug_${idx + 1}`,
      0.022,
      0.022,
      0.006,
      16,
      bcx,
      bowlBotY + wallThick + 0.0095,
      bowlCenterZ,
      wasteMat,
      true
    );

    // Perrin & Rowe 3-hole brass deck basin mixer (`200 mm` centres) or composable tap mounted on the rear Carrara tap deck!
    const tapZ = bowlCenterZ - bowlD * 0.5 - 0.055;
    if (opts.tap === undefined || opts.tap === 'default') {
      const mixer = buildArmstrongDeck3HoleBasinMixer({
        namePrefix: `${namePrefix}.perrinRowe3HoleMixer_${idx + 1}`,
        finish: brassFinish,
        valveSpreadM: 0.2,
        style: 'traditional',
      });
      mixer.position.set(bcx, deckTopY + 0.0008, tapZ);
      root.add(mixer);
    } else if (opts.tap !== 'none') {
      if (isCustomTapObject3D(opts.tap)) {
        const tapInstance = idx === 0 ? opts.tap : opts.tap.clone(true);
        tapInstance.position.set(bcx, deckTopY + 0.0008, tapZ);
        root.add(tapInstance);
      } else {
        const resolvedMount = opts.tap.mount ?? '3-hole-deck';
        const tapObj = buildBasinTapFromSpec(
          opts.tap,
          brassFinish,
          resolvedMount,
          `${namePrefix}.basinTap_${idx + 1}`
        );
        if (resolvedMount === '2-hole-wall') {
          tapObj.position.set(bcx, deckTopY + upstandH + 0.085, rearZ);
        } else {
          tapObj.position.set(bcx, deckTopY + 0.0008, tapZ);
        }
        root.add(tapObj);
      }
    }
  });

  const rightBridgeW = w * 0.5 - xCursor;
  if (rightBridgeW > 0.005) {
    addNamedBox(
      root,
      `${namePrefix}.carraraDeckBridgeRight`,
      rightBridgeW,
      slabT,
      bowlD,
      xCursor + rightBridgeW * 0.5,
      slabMidY,
      bowlCenterZ,
      carraraMat
    );
  }

  // 90 x 20 mm Honed Carrara Marble rear splashback upstand (`y = 0.875 .. 0.965 m`)
  addNamedBox(
    root,
    `${namePrefix}.carraraUpstand`,
    w,
    upstandH,
    0.02,
    0,
    deckTopY + upstandH * 0.5 + 0.0005,
    rearZ + 0.01,
    carraraMat
  );

  const tapZAnchor = bowlCenterZ - bowlD * 0.5 - 0.055;
  const deckPositions = basinCentersX.map(
    (bcx) => [bcx, deckTopY + 0.0008, tapZAnchor] as const
  );
  const holeCount: 0 | 1 | 3 =
    opts.tap === 'none'
      ? 0
      : opts.tap !== undefined && opts.tap !== 'default' && !isCustomTapObject3D(opts.tap)
        ? opts.tap.mount === '2-hole-wall'
          ? 0
          : opts.tap.mount === 'monobloc-deck'
            ? 1
            : 3
        : 3;
  registerTapMountAnchor(root, {
    deckPosition: [basinCentersX[0] ?? 0, deckTopY + 0.0008, tapZAnchor],
    deckPositions,
    wallPosition: [basinCentersX[0] ?? 0, deckTopY + upstandH + 0.085, rearZ],
    wastePosition: [basinCentersX[0] ?? 0, carcassTopY - bowlDepth + 0.018, bowlCenterZ],
    holeCount,
    rotationY: 0,
  });

  const hwCode = resolveBrasswareCode(opts.hardwareFinish, 'AB');
  const out = finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
  return attachAssetMetadata(out, {
    name: `Neptune Chichester ${variant === 'double' ? 'Double' : 'Single'} Washstand Vanity`,
    brand: 'Neptune',
    collection: 'Chichester Bathroom',
    sku: `NEP-CHI-VAN-${variant.toUpperCase()}-${hwCode}`,
    finish: `Painted Timber & Honed Carrara / ${formatBrasswareFinishLabel(opts.hardwareFinish, 'AB')}`,
    category: 'sanitaryware',
    dimensionsMm: mmFromMetres(w, d, deckTopY + upstandH),
    productUrl: 'https://www.neptune.com/uk/bathroom/washstands/',
    schematicUrl: 'https://www.neptune.com/uk/bathroom/washstands/chichester-washstand-spec.pdf',
  });
}

export interface CrittallWalkInShowerAndTowelRailOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  /** Glass screen width (`0.90–1.15 m`, default `1.05`). */
  readonly screenWidthM?: number;
  readonly screenHeightM?: number;
  readonly trayDepthM?: number;
  /** Frame finish (`'agedBrass'` default or `'crittallBlack'`). */
  readonly frameFinish?: 'agedBrass' | 'crittallBlack';
  /** Heated towel warmer style (`'traditionalColumn'` `675 x 235 x 950 mm` default, or `'ladder'` `550 x 120 x 1200 mm`). */
  readonly towelWarmerVariant?: 'traditionalColumn' | 'ladder';
  readonly brassFinish?: BrasswareFinishCode;
  readonly includeShowerValveSet?: boolean;
}

/**
 * **Aged-Brass / Crittall Walk-In Shower Enclosure + Heated Towel Warmer + White Company Hydrocotton Linen**:
 * - Framed 3-tier Crittall/Aged-Brass walk-in architectural glass screen (`900–1150 x 2000 x 8 mm`) + ceiling/wall stay bar
 * - Low-profile Honed Carrara / limestone shower tray (`H 35 mm`) with flush brass linear drain grille
 * - Recessed `2700K` warm-LED Zellige-tiled shower niche (`420 x 320 x 95 mm`) stocked w/ apothecary bottles
 * - Optional Perrin & Rowe concealed thermostatic shower valve, 8" deluge rose & handshower
 * - **Ball-jointed tubular brass & white-column heated towel warmer** (`675 x 235 x 950 mm`) or **aged-brass ladder rail** (`550 x 120 x 1200 mm`)
 *   draped with folded **The White Company 650 GSM Hydrocotton white bath sheets** & ribbed cotton bath mat (`600 x 900 mm`).
 * Local origin `(0, 0, 0)` is at floor level (`y = 0`), rear wall at `z = 0`, projecting into `+Z`.
 */
export function buildCrittallWalkInShowerAndTowelRail(
  opts: CrittallWalkInShowerAndTowelRailOptions = {}
): THREE.Group {
  const namePrefix = opts.name ?? 'crittallWalkInShowerSuite';
  const screenW = opts.screenWidthM ?? 1.05;
  const screenH = opts.screenHeightM ?? 2.0;
  const trayD = opts.trayDepthM ?? 0.9;
  const isCrittallBlack = (opts.frameFinish ?? 'agedBrass') === 'crittallBlack';
  const warmerVariant = opts.towelWarmerVariant ?? 'traditionalColumn';

  const customBrass = opts.brassFinish ? getBathroomBrassMaterials(opts.brassFinish).primary : null;
  const frameMat = isCrittallBlack ? getMatteCastIronMaterial(0x1f2124) : (customBrass ?? getAgedBrassMaterial());
  const brassMat = customBrass ?? getAgedBrassMaterial();
  const carraraMat = getHonedCarraraCatalogMaterial();
  const glassMat = getClearArchitecturalGlassMaterial();
  const ledMat = getWarm2700kLedMaterial();
  const radiatorWhiteMat = getPaintedJoineryMaterial(0xf7f5ef, 0.24, `${namePrefix}.columnEnamel`);

  const zelligeMaps = getZelligeTileMaps();
  const zelligeMat = new THREE.MeshPhysicalMaterial({
    name: `${namePrefix}.zelligeNicheTile`,
    map: zelligeMaps.colorMap,
    normalMap: zelligeMaps.normalMap,
    roughnessMap: zelligeMaps.roughnessMap,
    roughness: 0.22,
    clearcoat: 0.65,
    clearcoatRoughness: 0.16,
  });

  const hydrocottonMaps = getWovenFabricMaps('whiteco-hydrocotton-650gsm', 0xf7f5f0, 'hydrocotton');
  const hydrocottonMat = new THREE.MeshStandardMaterial({
    name: `${namePrefix}.whiteCoHydrocotton650gsm`,
    map: hydrocottonMaps.colorMap,
    normalMap: hydrocottonMaps.normalMap,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: hydrocottonMaps.roughnessMap,
    roughness: 0.92,
  });

  const root = new THREE.Group();
  root.name = namePrefix;

  // Low-profile Honed Carrara stone shower tray (`W = screenW + 0.45`, `D = trayD`, `H = 0.035 m`)
  const trayW = screenW + 0.45;
  const trayH = 0.035;
  const trayCx = 0;
  const trayCz = trayD * 0.5;
  addNamedBox(
    root,
    `${namePrefix}.stoneShowerTray`,
    trayW,
    trayH,
    trayD,
    trayCx,
    trayH * 0.5,
    trayCz,
    carraraMat
  );
  // Linear brass waste channel proud by `0.8 mm` on tray near `-X` wet end
  addNamedBox(
    root,
    `${namePrefix}.linearBrassDrainGrate`,
    0.068,
    0.002,
    trayD - 0.18,
    -trayW * 0.5 + 0.14,
    trayH + 0.0012,
    trayCz,
    brassMat,
    true
  );

  // Walk-in Crittall / Aged-Brass 8 mm toughened glass screen (`screenW x screenH x 0.008 m`) along front edge of tray (`z = trayD - 0.02`)
  const screenZ = trayD - 0.022;
  const screenLeftX = -trayW * 0.5 + 0.02;
  const screenCx = screenLeftX + screenW * 0.5;
  const barS = 0.018;
  const glassT = 0.008;
  const screenBotY = trayH;

  // Perimeter Crittall/Brass frame bars (strictly disjoint) + 8 mm glass pane + 2 horizontal glazing transoms
  addNamedBox(root, `${namePrefix}.screenPostWall`, barS, screenH, barS, screenLeftX + barS * 0.5, screenBotY + screenH * 0.5, screenZ, frameMat);
  addNamedBox(root, `${namePrefix}.screenPostFree`, barS, screenH, barS, screenLeftX + screenW - barS * 0.5, screenBotY + screenH * 0.5, screenZ, frameMat);
  const innerGlassW = screenW - barS * 2;
  const innerGlassH = screenH - barS * 2;
  addNamedBox(root, `${namePrefix}.screenRailTop`, innerGlassW, barS, barS, screenCx, screenBotY + screenH - barS * 0.5, screenZ, frameMat);
  addNamedBox(root, `${namePrefix}.screenRailBottom`, innerGlassW, barS, barS, screenCx, screenBotY + barS * 0.5, screenZ, frameMat);

  addNamedBox(
    root,
    `${namePrefix}.toughenedGlass8mm`,
    innerGlassW,
    innerGlassH,
    glassT,
    screenCx,
    screenBotY + screenH * 0.5,
    screenZ,
    glassMat
  );

  // 2 horizontal Crittall glazing transoms (`z`-proud of 8mm glass via front/back glazing beads so zero coplanar faces!)
  for (const [tIdx, frac] of [
    [1, 0.34],
    [2, 0.68],
  ] as const) {
    const ty = screenBotY + screenH * frac;
    addNamedBox(root, `${namePrefix}.crittallTransomFront_${tIdx}`, innerGlassW, 0.014, 0.005, screenCx, ty, screenZ + glassT * 0.5 + 0.0026, frameMat, true);
    addNamedBox(root, `${namePrefix}.crittallTransomBack_${tIdx}`, innerGlassW, 0.014, 0.005, screenCx, ty, screenZ - glassT * 0.5 - 0.0026, frameMat, true);
  }

  // Horizontal wall-to-glass stabilising stay bar (`z = 0 .. screenZ - barS/2`)
  addNamedCyl(
    root,
    `${namePrefix}.screenStabiliserStayBar`,
    0.009,
    0.009,
    screenZ - barS,
    14,
    screenLeftX + screenW - barS * 0.5,
    screenBotY + screenH - 0.035,
    (screenZ - barS) * 0.5,
    frameMat
  ).rotation.x = Math.PI * 0.5;

  // Recessed 2700K LED Zellige-tiled shower niche (`420 x 320 x 95 mm`) on rear wall (`z = -0.095 .. 0`)
  const nicheW = 0.42;
  const nicheH = 0.32;
  const nicheD = 0.095;
  const nicheX = -0.08;
  const nicheCy = 1.22;
  const nFrame = 0.014;

  addNamedBox(root, `${namePrefix}.nicheRearZellige`, nicheW, nicheH, 0.012, nicheX, nicheCy, -nicheD + 0.006, zelligeMat);
  addNamedBox(root, `${namePrefix}.nicheSillCarrara`, nicheW + 0.02, 0.018, nicheD + 0.014, nicheX, nicheCy - nicheH * 0.5 - 0.009, -nicheD * 0.5 + 0.007, carraraMat);
  addNamedBox(root, `${namePrefix}.nicheSoffit`, nicheW, 0.014, nicheD, nicheX, nicheCy + nicheH * 0.5 + 0.007, -nicheD * 0.5, zelligeMat);
  for (const [nSide, sx] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    addNamedBox(
      root,
      `${namePrefix}.nicheReveal${nSide}`,
      nFrame,
      nicheH,
      nicheD,
      nicheX + sx * (nicheW * 0.5 + nFrame * 0.5),
      nicheCy,
      -nicheD * 0.5,
      zelligeMat
    );
  }
  // Concealed 2700K warm LED strip recessed in top reveal of niche + 2 amber glass apothecary shower bottles
  addNamedBox(
    root,
    `${namePrefix}.niche2700kLedStrip`,
    nicheW - 0.024,
    0.005,
    0.012,
    nicheX,
    nicheCy + nicheH * 0.5 - 0.003,
    -0.022,
    ledMat,
    true
  );
  const amberBottleMat = new THREE.MeshPhysicalMaterial({
    name: `${namePrefix}.amberApothecaryGlass`,
    color: 0x6e3a16,
    roughness: 0.12,
    clearcoat: 0.7,
  });
  for (const [bIdx, bx] of [
    [1, nicheX - 0.085],
    [2, nicheX - 0.01],
  ] as const) {
    addNamedCyl(root, `${namePrefix}.apothecaryBottle_${bIdx}`, 0.028, 0.028, 0.135, 16, bx, nicheCy - nicheH * 0.5 + 0.068, -0.048, amberBottleMat, true);
    addNamedCyl(root, `${namePrefix}.apothecaryPump_${bIdx}`, 0.008, 0.01, 0.028, 12, bx, nicheCy - nicheH * 0.5 + 0.149, -0.048, brassMat, true);
  }

  // Optional Perrin & Rowe concealed thermostatic shower set on the wet end (`-X` wall, facing `+X`)
  if (opts.includeShowerValveSet ?? true) {
    const showerSet = buildArmstrongConcealedShowerSet({
      namePrefix: `${namePrefix}.perrinRoweShowerSet`,
      finish: opts.brassFinish ?? 'SB',
      style: 'traditional',
      overheadArmYM: 1.96,
      valveCenterYM: 1.12,
    });
    showerSet.rotation.y = Math.PI * 0.5;
    showerSet.position.set(-trayW * 0.5 + 0.01, trayH, trayCz);
    root.add(showerSet);
  }

  // White Company 600 x 900 mm ribbed Hydrocotton bath mat placed cleanly outside the walk-in opening (`+Z` of tray)
  const matW = 0.9;
  const matD = 0.6;
  const matMesh = new THREE.Mesh(
    createSculptedCushionGeometry(matW, 0.012, matD, 8, 2, 6, 0.38, 'standard'),
    hydrocottonMat
  );
  matMesh.name = `${namePrefix}.whiteCoRibbedBathMat`;
  matMesh.position.set(trayW * 0.5 - matW * 0.5, 0.007, trayD + matD * 0.5 + 0.08);
  matMesh.receiveShadow = true;
  root.add(matMesh);

  // Heated Towel Warmer mounted on rear wall (`z = 0`) to the right (`+X`) of the walk-in shower tray,
  // draped with folded White Company 650 GSM Hydrocotton white bath sheets!
  const warmerGroup = new THREE.Group();
  warmerGroup.name = `${namePrefix}.heatedTowelWarmer`;
  warmerGroup.position.set(trayW * 0.5 + 0.48, 0, 0);
  root.add(warmerGroup);

  if (warmerVariant === 'traditionalColumn') {
    // Ball-jointed tubular Aged Brass & white-column floor-standing heated towel warmer (`675 x 235 x 950 mm`)
    const rw = 0.675;
    const rd = 0.235;
    const rh = 0.95;
    const pipeR = 0.016;
    const ballR = 0.024;
    const frontPipeZ = rd - ballR;

    // 2 floor-standing tubular brass uprights + turned floor flanges + wall stay brackets + ball joints
    for (const [sTag, sign] of [
      ['Left', -1],
      ['Right', 1],
    ] as const) {
      const ux = sign * (rw * 0.5 - ballR);
      addNamedCyl(warmerGroup, `${warmerGroup.name}.floorFlange${sTag}`, 0.034, 0.038, 0.018, 16, ux, 0.009, frontPipeZ, brassMat, true);
      addNamedCyl(warmerGroup, `${warmerGroup.name}.uprightTube${sTag}`, pipeR, pipeR, rh - 0.04, 16, ux, 0.018 + (rh - 0.04) * 0.5, frontPipeZ, brassMat);

      // Angled traditional radiator valves at base
      addNamedCyl(warmerGroup, `${warmerGroup.name}.valveWheel${sTag}`, 0.022, 0.022, 0.012, 14, ux + sign * 0.036, 0.095, frontPipeZ, brassMat, true).rotation.z = Math.PI * 0.5;

      // Top & upper-mid wall stay tubes (`z = 0 .. frontPipeZ`) + ball joints
      for (const [jTag, jy] of [
        ['Bottom', 0.16],
        ['Mid', 0.68],
        ['Top', rh - ballR],
      ] as const) {
        const ball = new THREE.Mesh(sharedSphereGeometry(ballR, 14, 12), brassMat);
        ball.name = `${warmerGroup.name}.ballJoint_${sTag}_${jTag}`;
        ball.position.set(ux, jy, frontPipeZ);
        tagHighLod(ball);
        warmerGroup.add(ball);

        if (jTag !== 'Mid') {
          const stayLen = frontPipeZ - ballR - 0.011;
          const wallStay = addNamedCyl(
            warmerGroup,
            `${warmerGroup.name}.wallStay_${sTag}_${jTag}`,
            0.012,
            0.012,
            stayLen,
            12,
            ux,
            jy,
            0.011 + stayLen * 0.5,
            brassMat,
            true
          );
          wallStay.rotation.x = Math.PI * 0.5;
          addNamedCyl(
            warmerGroup,
            `${warmerGroup.name}.wallRose_${sTag}_${jTag}`,
            0.028,
            0.028,
            0.01,
            14,
            ux,
            jy,
            0.005,
            brassMat,
            true
          ).rotation.x = Math.PI * 0.5;
        }
      }
    }

    // Horizontal brass towel rails connecting the ball joints (`span = rw - ballR*4`)
    const railSpan = rw - ballR * 4;
    for (const [rTag, ry] of [
      ['Bottom', 0.16],
      ['Mid', 0.68],
      ['Top', rh - ballR],
    ] as const) {
      addNamedCyl(warmerGroup, `${warmerGroup.name}.brassCrossRail${rTag}`, pipeR, pipeR, railSpan, 16, 0, ry, frontPipeZ, brassMat).rotation.z = Math.PI * 0.5;
    }

    // Inset white enamelled cast-iron heating column radiator core (`y = 0.21 .. 0.63`, `z = 0.085`)
    const colCoreW = rw - 0.19;
    const colCoreH = 0.42;
    const colCoreY = 0.42;
    const colCoreZ = 0.095;
    addNamedBox(warmerGroup, `${warmerGroup.name}.columnHeaderTop`, colCoreW, 0.036, 0.068, 0, colCoreY + colCoreH * 0.5 - 0.018, colCoreZ, radiatorWhiteMat);
    addNamedBox(warmerGroup, `${warmerGroup.name}.columnHeaderBottom`, colCoreW, 0.036, 0.068, 0, colCoreY - colCoreH * 0.5 + 0.018, colCoreZ, radiatorWhiteMat);
    const nFins = 8;
    for (let f = 0; f < nFins; f++) {
      const fx = -(colCoreW * 0.5 - 0.03) + (f / (nFins - 1)) * (colCoreW - 0.06);
      addNamedBox(
        warmerGroup,
        `${warmerGroup.name}.whiteHeatingColumn_${f + 1}`,
        0.028,
        colCoreH - 0.072,
        0.064,
        fx,
        colCoreY,
        colCoreZ,
        radiatorWhiteMat
      );
    }

    // Folded White Company 650 GSM Hydrocotton white bath sheet draped cleanly over top rail (`y = rh - ballR`)
    const towelW = 0.34;
    const topRailY = rh - ballR;
    const towelCrown = new THREE.Mesh(
      createSculptedCushionGeometry(towelW, 0.026, 0.064, 6, 2, 4, 0.45, 'standard'),
      hydrocottonMat
    );
    towelCrown.name = `${warmerGroup.name}.hydrocottonBathSheetCrown`;
    towelCrown.position.set(0.06, topRailY + pipeR + 0.014, frontPipeZ);
    towelCrown.castShadow = true;
    warmerGroup.add(towelCrown);

    const towelFrontHang = new THREE.Mesh(
      createSculptedCushionGeometry(towelW, 0.44, 0.022, 6, 6, 2, 0.42, 'standard'),
      hydrocottonMat
    );
    towelFrontHang.name = `${warmerGroup.name}.hydrocottonBathSheetFrontFold`;
    towelFrontHang.position.set(0.06, topRailY - 0.21, frontPipeZ + 0.028);
    towelFrontHang.castShadow = true;
    warmerGroup.add(towelFrontHang);

    const towelRearHang = new THREE.Mesh(
      createSculptedCushionGeometry(towelW, 0.38, 0.02, 6, 6, 2, 0.42, 'standard'),
      hydrocottonMat
    );
    towelRearHang.name = `${warmerGroup.name}.hydrocottonBathSheetRearFold`;
    towelRearHang.position.set(0.06, topRailY - 0.18, frontPipeZ - 0.028);
    towelRearHang.castShadow = true;
    warmerGroup.add(towelRearHang);
  } else {
    // 'ladder': Wall-mounted Aged Brass ladder towel warmer (`550 x 120 x 1200 mm`, `y = 0.55 .. 1.75`)
    const lw = 0.55;
    const ld = 0.12;
    const lh = 1.2;
    const botY = 0.55;
    const pipeR = 0.016;
    const pipeZ = ld - pipeR;

    for (const [sTag, sign] of [
      ['Left', -1],
      ['Right', 1],
    ] as const) {
      const ux = sign * (lw * 0.5 - pipeR);
      addNamedCyl(warmerGroup, `${warmerGroup.name}.ladderUpright${sTag}`, pipeR, pipeR, lh, 16, ux, botY + lh * 0.5, pipeZ, brassMat);
      for (const [bTag, by] of [
        ['Top', botY + lh - 0.08],
        ['Bot', botY + 0.08],
      ] as const) {
        addNamedCyl(warmerGroup, `${warmerGroup.name}.wallBracket_${sTag}_${bTag}`, 0.011, 0.011, pipeZ - pipeR, 12, ux, by, (pipeZ - pipeR) * 0.5, brassMat, true).rotation.x = Math.PI * 0.5;
      }
    }

    const rungSpan = lw - pipeR * 4;
    for (let r = 0; r < 10; r++) {
      const ry = botY + 0.08 + (r / 9) * (lh - 0.16);
      addNamedCyl(warmerGroup, `${warmerGroup.name}.ladderRung_${r + 1}`, 0.011, 0.011, rungSpan, 14, 0, ry, pipeZ, brassMat, true).rotation.z = Math.PI * 0.5;
    }

    // Draped White Company 650 GSM Hydrocotton bath sheet over upper rung
    const hangY = botY + lh - 0.21;
    const towelFront = new THREE.Mesh(
      createSculptedCushionGeometry(0.32, 0.48, 0.022, 6, 6, 2, 0.42, 'standard'),
      hydrocottonMat
    );
    towelFront.name = `${warmerGroup.name}.hydrocottonBathSheet`;
    towelFront.position.set(0, hangY - 0.22, pipeZ + 0.026);
    towelFront.castShadow = true;
    warmerGroup.add(towelFront);
  }

  const hwCode = resolveBrasswareCode(opts.brassFinish, 'AB');
  const out = finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
  return attachAssetMetadata(out, {
    name: 'Crittall Fluted Walk-In Shower Screen & Traditional Heated Towel Warmer',
    brand: 'Vogue UK & Crittall',
    collection: 'Ballerina Traditional & Heritage Screens',
    sku: `VOG-LG003-CRIT-${hwCode}`,
    finish: `Fluted Architectural Glass & ${formatBrasswareFinishLabel(opts.brassFinish, 'AB')}`,
    category: 'sanitaryware',
    dimensionsMm: mmFromMetres(screenW, 0.25, screenH),
    productUrl: 'https://www.vogueuk.co.uk/products/traditional/ballerina/',
    schematicUrl: 'https://www.vogueuk.co.uk/downloads/technical/LG003-Ballerina-Spec.pdf',
  });
}
