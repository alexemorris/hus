import * as THREE from 'three';
import {
  attachAssetMetadata,
  mmFromMetres,
} from '../shared/catalog-smart-metadata.ts';
import type { InteractionRegistry } from '../../engine/interaction/interaction-registry.ts';
import {
  createSculptedCushionGeometry,
  createPerimeterWeltLoop,
} from '../furniture/barker-and-stonehouse-sofas.ts';
import {
  collectSeatClickableMeshes,
  SeatInteractable,
} from '../furniture/seating-interactions.ts';
import {
  addNamedBox,
  addNamedCyl,
  finalizeCatalogGroup,
  getAgedBrassMaterial,
  getCharacterOakMaterial,
  getPaintedJoineryMaterial,
  getWovenFabricMaps,
  tagHighLod,
} from '../shared/neptune-and-georgian-materials.ts';

export interface TongueAndGrooveDadoPanellingOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  /** Run length in metres (default `2.40`). */
  readonly lengthM?: number;
  /** Total height including skirting and bullnose dado rail (`1.05 - 1.20 m`, default `1.12`). */
  readonly heightM?: number;
  /** Vertical matchboard pitch in metres (default `0.10` = `100 mm`). */
  readonly boardPitchM?: number;
  /** Paint colour (default F&B *School House White* / *Shingle* `#DFDDD2`). */
  readonly paintColor?: THREE.ColorRepresentation;
}

/**
 * Parametric V-grooved tongue-and-groove matchboard dado panelling (`H 1050-1200 mm`,
 * `100 mm` board pitch, torus skirting base & bullnose dado rail), projecting `+Z` from `z = 0`.
 */
export function buildTongueAndGrooveDadoPanelling(
  opts: TongueAndGrooveDadoPanellingOptions = {}
): THREE.Group {
  const namePrefix = opts.name ?? 'tongueAndGrooveDado';
  const len = opts.lengthM ?? 2.4;
  const h = opts.heightM ?? 1.12;
  const pitch = opts.boardPitchM ?? 0.1;
  const paintMat = getPaintedJoineryMaterial(
    opts.paintColor ?? 0xdfddd2,
    0.54,
    `${namePrefix}.paint`
  );

  const root = new THREE.Group();
  root.name = namePrefix;

  const skirtH = 0.135;
  const dadoRailH = 0.052;
  const boardH = Math.max(0.4, h - skirtH - dadoRailH);
  const boardMidY = skirtH + boardH * 0.5;

  // Recessed shadow backing strip behind V-grooves (`z = 0..0.008`)
  addNamedBox(
    root,
    `${namePrefix}.battenBacking`,
    len,
    boardH,
    0.008,
    0,
    boardMidY,
    0.004,
    paintMat
  );

  // V-grooved vertical matchboards strictly in front of backing (`z = 0.008..0.020`)
  const nBoards = Math.max(3, Math.round(len / pitch));
  const actualPitch = len / nBoards;
  const grooveGap = 0.004;
  for (let i = 0; i < nBoards; i++) {
    const bx = -len * 0.5 + (i + 0.5) * actualPitch;
    addNamedBox(
      root,
      `${namePrefix}.matchboard_${i + 1}`,
      actualPitch - grooveGap,
      boardH,
      0.012,
      bx,
      boardMidY,
      0.014,
      paintMat
    );
  }

  // Moulded skirting board (`y = 0 .. skirtH`, `z = 0 .. 0.024`)
  addNamedBox(
    root,
    `${namePrefix}.skirtingPlinth`,
    len,
    skirtH,
    0.024,
    0,
    skirtH * 0.5,
    0.012,
    paintMat
  );

  // Bullnose dado rail cap (`y = skirtH + boardH .. h`, `z = 0 .. 0.036`)
  const railCy = skirtH + boardH + dadoRailH * 0.5;
  addNamedBox(
    root,
    `${namePrefix}.dadoRailCore`,
    len,
    dadoRailH,
    0.026,
    0,
    railCy,
    0.013,
    paintMat
  );
  const bullnose = addNamedCyl(
    root,
    `${namePrefix}.dadoBullnose`,
    0.014,
    0.014,
    len - 0.002,
    12,
    0,
    railCy + 0.004,
    0.028,
    paintMat,
    true
  );
  bullnose.rotation.z = Math.PI * 0.5;

  return finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
}

export interface NeptuneBootBenchAndPegRailOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  /** Paint colour (default F&B *Green Smoke* `#6F7B71`). */
  readonly paintColor?: THREE.ColorRepresentation;
  readonly widthM?: number;
  readonly depthM?: number;
  readonly heightM?: number;
  readonly interactions?: InteractionRegistry;
}

/**
 * `1350 x 460 x 1920 mm` Neptune boot-room bench & peg rail unit:
 * F&B *Green Smoke* (`#6F7B71`) joinery, `36 mm` Character Oak seat + piped oatmeal linen cushion (`SeatInteractable`),
 * 3 White Company Kubu rattan boot baskets below, T&G matchboard back, 5 aged-brass double coat hooks & hat shelf.
 */
export function buildNeptuneBootBenchAndPegRail(
  opts: NeptuneBootBenchAndPegRailOptions = {}
): THREE.Group {
  const namePrefix = opts.name ?? 'neptuneBootBench';
  const w = opts.widthM ?? 1.35;
  const d = opts.depthM ?? 0.46;
  const h = opts.heightM ?? 1.92;
  const paintMat = getPaintedJoineryMaterial(
    opts.paintColor ?? 0x6f7b71,
    0.52,
    `${namePrefix}.greenSmokePaint`
  );
  const oakMat = getCharacterOakMaterial();
  const brassMat = getAgedBrassMaterial();
  const kubuMaps = getWovenFabricMaps('boot-kubu', 0x998064, 'kubu');
  const kubuMat = new THREE.MeshStandardMaterial({
    name: `${namePrefix}.kubuRattan`,
    map: kubuMaps.colorMap,
    normalMap: kubuMaps.normalMap,
    roughnessMap: kubuMaps.roughnessMap,
    roughness: 0.85,
  });
  const linenMaps = getWovenFabricMaps('boot-seat-linen', 0xddd4c5, 'linen');
  const linenMat = new THREE.MeshStandardMaterial({
    name: `${namePrefix}.pipedLinen`,
    map: linenMaps.colorMap,
    normalMap: linenMaps.normalMap,
    roughnessMap: linenMaps.roughnessMap,
    roughness: 0.86,
  });

  const root = new THREE.Group();
  root.name = namePrefix;

  const plinthH = 0.085;
  const benchSeatTopY = 0.47;
  const oakSeatT = 0.036;
  const lowerBodyH = benchSeatTopY - oakSeatT - plinthH;
  const lowerMidY = plinthH + lowerBodyH * 0.5;
  const cheekT = 0.028;

  // Plinth & 3-cubby boot bench base (`z = 0 .. d`)
  addNamedBox(
    root,
    `${namePrefix}.benchPlinth`,
    w,
    plinthH,
    d - 0.025,
    0,
    plinthH * 0.5,
    (d - 0.025) * 0.5,
    paintMat
  );
  addNamedBox(
    root,
    `${namePrefix}.cubbyFloor`,
    w - cheekT * 2,
    0.02,
    d - 0.03,
    0,
    plinthH + 0.01,
    (d - 0.03) * 0.5 + 0.015,
    paintMat
  );

  // Outer bench cheeks + 2 internal cubby dividers -> 3 boot cubbies
  const dividerXs = [
    -(w * 0.5 - cheekT * 0.5),
    -(w - cheekT * 2) / 6,
    (w - cheekT * 2) / 6,
    w * 0.5 - cheekT * 0.5,
  ];
  dividerXs.forEach((dx, idx) => {
    const isOuter = idx === 0 || idx === 3;
    const innerDividerH = lowerBodyH - 0.02;
    addNamedBox(
      root,
      `${namePrefix}.benchCheek_${idx + 1}`,
      cheekT,
      isOuter ? h - plinthH - 0.055 : innerDividerH,
      isOuter ? 0.28 : d - 0.035,
      dx,
      isOuter ? plinthH + (h - plinthH - 0.055) * 0.5 : plinthH + 0.02 + innerDividerH * 0.5,
      isOuter ? 0.14 : (d - 0.035) * 0.5 + 0.02,
      paintMat
    );
    if (isOuter) {
      // Lower bench side extension forward of the upper side cheek (`z = 0.28 .. d - 0.015`, zero overlap!)
      addNamedBox(
        root,
        `${namePrefix}.benchLowerArmCheek_${idx + 1}`,
        cheekT,
        lowerBodyH,
        d - 0.295,
        dx,
        lowerMidY,
        0.28 + (d - 0.295) * 0.5,
        paintMat
      );
    }
  });

  // 3 White Company Kubu rattan boot baskets inside the 3 lower cubbies
  const cubbySpanW = (w - cheekT * 4) / 3;
  for (let c = 0; c < 3; c++) {
    const cx = (c - 1) * (cubbySpanW + cheekT);
    const basketH = lowerBodyH - 0.055;
    addNamedBox(
      root,
      `${namePrefix}.kubuBootBasket_${c + 1}`,
      cubbySpanW - 0.028,
      basketH,
      d - 0.085,
      cx,
      plinthH + 0.022 + basketH * 0.5,
      d * 0.5 + 0.005,
      kubuMat
    );
    // Cut-out hand-pull shadow slot on Kubu basket front
    addNamedBox(
      root,
      `${namePrefix}.kubuBasketHandleRim_${c + 1}`,
      0.095,
      0.024,
      0.008,
      cx,
      plinthH + 0.022 + basketH - 0.045,
      d * 0.5 + 0.005 + (d - 0.085) * 0.5 + 0.004,
      oakMat,
      true
    );
  }

  // 36 mm solid Character Oak bench seat (`y = benchSeatTopY - 0.036 .. benchSeatTopY`)
  addNamedBox(
    root,
    `${namePrefix}.characterOakSeatSlab`,
    w - cheekT * 2 + 0.004,
    oakSeatT,
    d - 0.02,
    0,
    benchSeatTopY - oakSeatT * 0.5,
    0.02 + (d - 0.02) * 0.5,
    oakMat
  );

  // Tailored piped oatmeal linen seat cushion (`H 55 mm`) resting on the oak seat
  const cushW = w - cheekT * 2 - 0.02;
  const cushH = 0.055;
  const cushD = d - 0.065;
  const cushZ = 0.035 + cushD * 0.5;
  const cushCy = benchSeatTopY + cushH * 0.5 + 0.001;
  const cushionMesh = new THREE.Mesh(
    createSculptedCushionGeometry(cushW, cushH, cushD, 8, 4, 6, 0.48, 'standard'),
    linenMat
  );
  cushionMesh.name = `${namePrefix}.seatCushion`;
  cushionMesh.position.set(0, cushCy, cushZ);
  cushionMesh.castShadow = true;
  cushionMesh.receiveShadow = true;
  root.add(cushionMesh);

  const weltTop = createPerimeterWeltLoop(
    cushW - 0.012,
    cushD - 0.012,
    0.0035,
    'XZ',
    linenMat,
    `${namePrefix}.seatCushionWelt`
  );
  weltTop.position.set(0, benchSeatTopY + cushH - 0.004, cushZ);
  tagHighLod(weltTop);
  root.add(weltTop);

  // Upper V-grooved T&G matchboard back panel (`y = benchSeatTopY .. h - 0.055`)
  const upperBackH = h - 0.055 - benchSeatTopY;
  const upperBackMidY = benchSeatTopY + upperBackH * 0.5;
  const innerBackW = w - cheekT * 2;
  const nBoards = Math.max(8, Math.round(innerBackW / 0.098));
  const bPitch = innerBackW / nBoards;
  for (let b = 0; b < nBoards; b++) {
    addNamedBox(
      root,
      `${namePrefix}.backMatchboard_${b + 1}`,
      bPitch - 0.003,
      upperBackH,
      0.018,
      -innerBackW * 0.5 + (b + 0.5) * bPitch,
      upperBackMidY,
      0.011,
      paintMat
    );
  }

  // Peg rail batten + 5 Aged Brass double coat & hat hooks + upper hat shelf & cornice
  const hookRailY = h - 0.34;
  addNamedBox(
    root,
    `${namePrefix}.pegRailBatten`,
    innerBackW,
    0.088,
    0.02,
    0,
    hookRailY,
    0.03,
    paintMat
  );

  for (let k = 0; k < 5; k++) {
    const hx = -innerBackW * 0.38 + k * (innerBackW * 0.19);
    addNamedBox(
      root,
      `${namePrefix}.coatHookBackplate_${k + 1}`,
      0.034,
      0.058,
      0.005,
      hx,
      hookRailY,
      0.043,
      brassMat,
      true
    );
    const upperProng = addNamedCyl(
      root,
      `${namePrefix}.coatHookUpperArm_${k + 1}`,
      0.0045,
      0.0055,
      0.078,
      10,
      hx,
      hookRailY + 0.024,
      0.076,
      brassMat,
      true
    );
    upperProng.rotation.x = Math.PI * 0.36;
    const lowerProng = addNamedCyl(
      root,
      `${namePrefix}.coatHookLowerArm_${k + 1}`,
      0.004,
      0.005,
      0.046,
      10,
      hx,
      hookRailY - 0.016,
      0.062,
      brassMat,
      true
    );
    lowerProng.rotation.x = Math.PI * 0.44;
  }

  // Hat shelf (`D 280 mm`) + ogee top cap
  const hatShelfY = h - 0.18;
  addNamedBox(
    root,
    `${namePrefix}.hatShelf`,
    innerBackW,
    0.024,
    0.26,
    0,
    hatShelfY,
    0.02 + 0.13,
    paintMat
  );
  addNamedBox(
    root,
    `${namePrefix}.crownHeader`,
    w + 0.044,
    0.055,
    0.31,
    0,
    h - 0.0275,
    0.155,
    paintMat
  );

  const seatInteractable = new SeatInteractable({
    id: `seat:${namePrefix}`,
    label: 'Neptune Boot Room Bench',
    aliases: ['sit on boot bench', 'boot room bench'],
    anchor: root,
    clickableTargets: collectSeatClickableMeshes(root),
    localSeatPos: [0, benchSeatTopY + cushH, cushZ],
    localFootOffset: [0, 0, d + 0.42],
    localForward: [0, 0, 1],
    seatedEyeHeightM: 0.72,
    proximityRadiusM: 1.05,
    material: 'linen',
  });
  root.userData.seatInteractable = seatInteractable;
  if (opts.interactions) {
    opts.interactions.registerAnimatedInteractable(seatInteractable);
  }

  const out = finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
  return attachAssetMetadata(out, {
    name: 'Neptune Boot-Room Bench, Peg Rail & Kubu Basket Unit',
    brand: 'Neptune',
    collection: 'Suffolk Boot Room',
    sku: 'NEP-SUF-BOOT-1350',
    finish: 'Farrow & Ball Green Smoke, Character Oak & Aged Brass',
    category: 'joinery',
    dimensionsMm: mmFromMetres(w, d, h),
    productUrl: 'https://www.neptune.com/uk/hallway/boot-room-furniture/',
    schematicUrl: 'https://www.neptune.com/uk/hallway/boot-room-furniture/boot-bench-spec.pdf',
  });
}

