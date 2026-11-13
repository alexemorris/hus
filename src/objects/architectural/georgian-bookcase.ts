import * as THREE from 'three';
import {
  attachAssetMetadata,
  mmFromMetres,
  wireCatalogHingedDoor,
} from '../shared/catalog-smart-metadata.ts';
import type { InteractionRegistry } from '../../engine/interaction/interaction-registry.ts';
import {
  addCockBeadApertureTrim,
  addNamedBox,
  addNamedCyl,
  buildAgedBrassMushroomKnob,
  buildShakerDoorAssembly,
  finalizeCatalogGroup,
  getAgedBrassMaterial,
  getCharacterOakMaterial,
  getClearArchitecturalGlassMaterial,
  getPaintedJoineryMaterial,
  getWarm2700kLedMaterial,
} from '../shared/neptune-and-georgian-materials.ts';

export interface GeorgianAlcoveBookcaseOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  /** Paint colour (default Neptune *Old Chalk* `#D8D2C2`). */
  readonly paintColor?: THREE.ColorRepresentation;
  readonly widthM?: number;
  readonly baseDepthM?: number;
  readonly upperDepthM?: number;
  readonly heightM?: number;
  readonly interactions?: InteractionRegistry;
}

/**
 * `1180 x 420 x 2550 mm` Georgian fitted alcove bookcase:
 * cock-beaded 2-door Shaker base cupboard (`H 840 mm`, Neptune *Old Chalk* `#D8D2C2`) +
 * upper 4-shelf fluted-pilaster open bookcase (`D 310 mm`) with warm `2700K` shelf wash
 * and procedural leather/linen hardbacks, ceramic vessels & reed diffuser.
 */
export function buildGeorgianAlcoveBookcase(
  opts: GeorgianAlcoveBookcaseOptions = {}
): THREE.Group {
  const namePrefix = opts.name ?? 'georgianAlcoveBookcase';
  const w = opts.widthM ?? 1.18;
  const baseD = opts.baseDepthM ?? 0.42;
  const upperD = opts.upperDepthM ?? 0.31;
  const totalH = opts.heightM ?? 2.55;
  const paintMat = getPaintedJoineryMaterial(
    opts.paintColor ?? 0xd8d2c2,
    0.54,
    `${namePrefix}.oldChalkPaint`
  );
  const oakMat = getCharacterOakMaterial();
  const brassMat = getAgedBrassMaterial();
  const glassMat = getClearArchitecturalGlassMaterial();
  const ledMat = getWarm2700kLedMaterial();

  const root = new THREE.Group();
  root.name = namePrefix;

  const plinthH = 0.1;
  const counterH = 0.028;
  const baseH = 0.84;
  const carcassH = baseH - counterH;
  const stileW = 0.036;
  const frameT = 0.024;
  const baseFrontZ = baseD;

  // Base plinth (`z = 0 .. baseD - 0.02`)
  addNamedBox(
    root,
    `${namePrefix}.basePlinth`,
    w,
    plinthH,
    baseD - 0.02,
    0,
    plinthH * 0.5,
    (baseD - 0.02) * 0.5,
    paintMat
  );

  // Base carcass walls (`z = 0 .. baseD - frameT`)
  const baseBodyH = carcassH - plinthH;
  const baseBodyMidY = plinthH + baseBodyH * 0.5;
  const wallT = 0.022;
  for (const [sTag, sign] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    addNamedBox(
      root,
      `${namePrefix}.baseSide${sTag}`,
      wallT,
      baseBodyH,
      baseD - frameT,
      sign * (w * 0.5 - wallT * 0.5),
      baseBodyMidY,
      (baseD - frameT) * 0.5,
      paintMat
    );
  }
  addNamedBox(
    root,
    `${namePrefix}.baseBack`,
    w - wallT * 2,
    baseBodyH,
    0.018,
    0,
    baseBodyMidY,
    0.009,
    paintMat
  );
  addNamedBox(
    root,
    `${namePrefix}.baseInnerShelf`,
    w - wallT * 2 - 0.004,
    0.02,
    baseD - frameT - 0.04,
    0,
    baseBodyMidY,
    (baseD - frameT) * 0.5,
    oakMat
  );

  // Cock-beaded 2-door Shaker base face-frame
  const openW = w - stileW * 2;
  const openH = baseBodyH - stileW * 2;
  const openCy = plinthH + stileW + openH * 0.5;
  const fz = baseFrontZ - frameT * 0.5;

  for (const [sTag, sign] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    addNamedBox(
      root,
      `${namePrefix}.baseFrameStile${sTag}`,
      stileW,
      baseBodyH,
      frameT,
      sign * (w * 0.5 - stileW * 0.5),
      baseBodyMidY,
      fz,
      paintMat
    );
  }
  addNamedBox(
    root,
    `${namePrefix}.baseFrameRailTop`,
    openW,
    stileW,
    frameT,
    0,
    carcassH - stileW * 0.5,
    fz,
    paintMat
  );
  addNamedBox(
    root,
    `${namePrefix}.baseFrameRailBottom`,
    openW,
    stileW,
    frameT,
    0,
    plinthH + stileW * 0.5,
    fz,
    paintMat
  );
  addCockBeadApertureTrim(root, `${namePrefix}.baseBead`, 0, openCy, baseFrontZ, openW, openH, paintMat);

  const leafW = (openW - 0.012) * 0.5;
  let leftDoorPivot: THREE.Object3D | null = null;
  let rightDoorPivot: THREE.Object3D | null = null;
  for (const [dTag, sign] of [
    ['leftDoor', -1],
    ['rightDoor', 1],
  ] as const) {
    const dGroup = new THREE.Group();
    dGroup.name = `${namePrefix}.${dTag}`;
    dGroup.position.set(sign * (leafW * 0.5 + 0.002), openCy, baseFrontZ - 0.012);
    root.add(dGroup);

    dGroup.add(
      buildShakerDoorAssembly(`${dGroup.name}.panel`, leafW, openH - 0.008, 0.022, paintMat, 0.05)
    );
    const knob = buildAgedBrassMushroomKnob(`${dGroup.name}.knob`);
    knob.position.set(-sign * (leafW * 0.5 - 0.034), openH * 0.5 - 0.075, 0.012);
    dGroup.add(knob);

    const pivot = wireCatalogHingedDoor(opts.interactions, {
      parent: root,
      door: dGroup,
      hingeOffset: [sign * (leafW * 0.5 - 0.01), 0, 0],
      axis: 'y',
      openAngle: sign < 0 ? -Math.PI * 0.56 : Math.PI * 0.56,
      label: 'Open Bookcase Base Cupboard',
      linkGroup: 'alcoveBookcaseBaseDoors',
    });
    if (sign < 0) leftDoorPivot = pivot;
    else rightDoorPivot = pivot;
  }
  if (opts.interactions && leftDoorPivot && rightDoorPivot) {
    opts.interactions.linkDoorPair(leftDoorPivot, rightDoorPivot);
  }

  // Stepped solid counter shelf at `H 840 mm`
  addNamedBox(
    root,
    `${namePrefix}.counterLedge`,
    w + 0.024,
    counterH,
    baseD + 0.02,
    0,
    carcassH + counterH * 0.5,
    (baseD + 0.02) * 0.5,
    paintMat
  );

  // Upper 4-shelf fluted-pilaster open bookcase (`y = baseH .. totalH`, `D = upperD`)
  const crownH = 0.085;
  const upperBodyH = totalH - baseH - crownH;
  const upperMidY = baseH + upperBodyH * 0.5;
  const pilasterW = 0.076;
  const innerUpperW = w - pilasterW * 2;

  // T&G matchboard back lining (`z = 0..0.018`)
  const nBackBoards = Math.max(8, Math.round(innerUpperW / 0.098));
  const bPitch = innerUpperW / nBackBoards;
  for (let b = 0; b < nBackBoards; b++) {
    addNamedBox(
      root,
      `${namePrefix}.upperTgBack_${b + 1}`,
      bPitch - 0.003,
      upperBodyH,
      0.018,
      -innerUpperW * 0.5 + (b + 0.5) * bPitch,
      upperMidY,
      0.009,
      paintMat
    );
  }

  // Left & Right side cheeks + fluted classical pilasters on front stiles
  for (const [sTag, sign] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    const px = sign * (w * 0.5 - pilasterW * 0.5);
    addNamedBox(
      root,
      `${namePrefix}.upperCheek${sTag}`,
      0.024,
      upperBodyH,
      upperD - 0.032,
      sign * (w * 0.5 - 0.012),
      upperMidY,
      (upperD - 0.032) * 0.5,
      paintMat
    );
    addNamedBox(
      root,
      `${namePrefix}.flutedPilasterBase${sTag}`,
      pilasterW,
      0.095,
      0.032,
      px,
      baseH + 0.0475,
      upperD - 0.012,
      paintMat
    );
    addNamedBox(
      root,
      `${namePrefix}.flutedPilasterCapital${sTag}`,
      pilasterW + 0.008,
      0.085,
      0.036,
      px,
      baseH + upperBodyH - 0.0425,
      upperD - 0.012,
      paintMat
    );
    // Fluted pilaster shaft built as 4 raised vertical reed strips over recessed core (0 z-fighting!)
    const fluteShaftH = upperBodyH - 0.18;
    const fluteMidY = baseH + 0.095 + fluteShaftH * 0.5;
    addNamedBox(
      root,
      `${namePrefix}.flutedPilasterCore${sTag}`,
      pilasterW,
      fluteShaftH,
      0.022,
      px,
      fluteMidY,
      upperD - 0.015,
      paintMat
    );
    for (let f = 0; f < 4; f++) {
      const fx = px - pilasterW * 0.36 + f * (pilasterW * 0.24);
      addNamedBox(
        root,
        `${namePrefix}.pilasterReed_${sTag}_${f + 1}`,
        0.008,
        fluteShaftH - 0.03,
        0.006,
        fx,
        fluteMidY,
        upperD - 0.001,
        paintMat,
        true
      );
    }
  }

  // Top frieze & classical cornice
  addNamedBox(
    root,
    `${namePrefix}.upperCeilingSoffit`,
    innerUpperW,
    0.022,
    upperD - 0.048,
    0,
    baseH + upperBodyH - 0.011,
    0.019 + (upperD - 0.048) * 0.5,
    paintMat
  );
  addNamedBox(
    root,
    `${namePrefix}.crownCorniceFrieze`,
    w + 0.02,
    crownH * 0.48,
    upperD + 0.016,
    0,
    totalH - crownH + crownH * 0.24,
    (upperD + 0.016) * 0.5,
    paintMat
  );
  addNamedBox(
    root,
    `${namePrefix}.crownCorniceCap`,
    w + 0.068,
    crownH * 0.52,
    upperD + 0.048,
    0,
    totalH - crownH * 0.26,
    (upperD + 0.048) * 0.5,
    paintMat
  );

  // 4 adjustable shelves with warm 2700K LED wash strips & curated leather/linen books, ceramic vessel & reed diffuser
  const bookPalette = [0x6e2c22, 0x26394a, 0x455342, 0xcabfa9, 0x7b5638, 0x3b3531, 0xdfd7c6];
  const shelfDepth = upperD - 0.042;
  const shelfCenterZ = 0.018 + shelfDepth * 0.5;

  for (let s = 0; s < 4; s++) {
    const sy = baseH + ((s + 1) / 5) * (upperBodyH - 0.08);
    addNamedBox(
      root,
      `${namePrefix}.bookShelf_${s + 1}`,
      innerUpperW,
      0.026,
      shelfDepth,
      0,
      sy,
      shelfCenterZ,
      paintMat
    );
    // Warm 2700K recessed LED wash bar under front lip
    addNamedBox(
      root,
      `${namePrefix}.shelfLedWash_${s + 1}`,
      innerUpperW - 0.06,
      0.005,
      0.01,
      0,
      sy - 0.016,
      upperD - 0.045,
      ledMat,
      true
    );

    const surfaceY = sy + 0.0135;
    if (s % 2 === 0) {
      // Leather/linen hardback cluster on left + ceramic vase or reed diffuser on right
      let bx = -innerUpperW * 0.42;
      for (let k = 0; k < 8; k++) {
        const bt = 0.028 + ((k * 7 + s * 3) % 4) * 0.007;
        const bh = 0.2 + ((k * 5 + s) % 4) * 0.024;
        const bd = 0.165 + (k % 2) * 0.018;
        const bMat = getPaintedJoineryMaterial(
          bookPalette[(k + s * 2) % bookPalette.length]!,
          0.62,
          `${namePrefix}.book_${s + 1}_${k + 1}`
        );
        addNamedBox(
          root,
          `${namePrefix}.hardback_${s + 1}_${k + 1}`,
          bt - 0.001,
          bh,
          bd,
          bx + bt * 0.5,
          surfaceY + bh * 0.5,
          0.03 + bd * 0.5,
          bMat,
          true
        );
        bx += bt + 0.002;
      }

      if (s === 0) {
        // Apothecary glass reed diffuser on shelf 1 right
        const dx = innerUpperW * 0.28;
        addNamedCyl(
          root,
          `${namePrefix}.shelfDiffuserBottle`,
          0.036,
          0.038,
          0.11,
          14,
          dx,
          surfaceY + 0.055,
          shelfCenterZ,
          glassMat,
          true
        );
        addNamedCyl(
          root,
          `${namePrefix}.shelfDiffuserCollar`,
          0.016,
          0.018,
          0.02,
          12,
          dx,
          surfaceY + 0.12,
          shelfCenterZ,
          brassMat,
          true
        );
        for (let r = 0; r < 5; r++) {
          const reed = addNamedCyl(
            root,
            `${namePrefix}.shelfDiffuserReed_${r + 1}`,
            0.0018,
            0.0018,
            0.21,
            6,
            dx + (r - 2) * 0.005,
            surfaceY + 0.15,
            shelfCenterZ + ((r % 2) - 0.5) * 0.006,
            oakMat,
            true
          );
          reed.rotation.z = (r - 2) * 0.09;
        }
      } else {
        // Turned stoneware ceramic vessel on shelf 3 right
        const ceramicMat = getPaintedJoineryMaterial(0xe9e4da, 0.46, `${namePrefix}.stoneware`);
        addNamedCyl(
          root,
          `${namePrefix}.ceramicVessel_${s + 1}`,
          0.048,
          0.068,
          0.19,
          16,
          innerUpperW * 0.26,
          surfaceY + 0.095,
          shelfCenterZ,
          ceramicMat,
          true
        );
      }
    } else {
      // Horizontal stacked art monographs on left + upright books on right
      for (let st = 0; st < 3; st++) {
        const bMat = getPaintedJoineryMaterial(
          bookPalette[(st + 3) % bookPalette.length]!,
          0.58,
          `${namePrefix}.monograph_${s + 1}_${st + 1}`
        );
        addNamedBox(
          root,
          `${namePrefix}.monograph_${s + 1}_${st + 1}`,
          0.25,
          0.032,
          0.19,
          -innerUpperW * 0.24,
          surfaceY + 0.016 + st * 0.033,
          shelfCenterZ,
          bMat,
          true
        );
      }
      let bx = 0.04;
      for (let k = 0; k < 7; k++) {
        const bt = 0.03 + (k % 3) * 0.006;
        const bh = 0.21 + ((k + s) % 3) * 0.02;
        const bMat = getPaintedJoineryMaterial(
          bookPalette[(k * 2 + 1) % bookPalette.length]!,
          0.64,
          `${namePrefix}.rightBook_${s + 1}_${k + 1}`
        );
        addNamedBox(
          root,
          `${namePrefix}.rightBook_${s + 1}_${k + 1}`,
          bt - 0.001,
          bh,
          0.175,
          bx + bt * 0.5,
          surfaceY + bh * 0.5,
          shelfCenterZ,
          bMat,
          true
        );
        bx += bt + 0.002;
      }
    }
  }

  const out = finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
  return attachAssetMetadata(out, {
    name: 'Georgian Fluted-Pilaster Fitted Alcove Bookcase',
    brand: 'Neptune',
    collection: 'Chichester Library Joinery',
    sku: 'NEP-LIB-ALC-1180',
    finish: 'Old Chalk Painted Timber & Character Oak',
    category: 'joinery',
    dimensionsMm: mmFromMetres(w, baseD, totalH),
    productUrl: 'https://www.neptune.com/uk/living/bookcases-and-shelving/',
    schematicUrl: 'https://www.neptune.com/uk/living/bookcases-and-shelving/alcove-joinery-spec.pdf',
  });
}

