import * as THREE from 'three';
import {
  attachAssetMetadata,
} from '../shared/catalog-smart-metadata.ts';
import { createBrickMaterial } from '../../engine/textures/brick-materials.ts';
import {
  addNamedBox,
  addNamedCyl,
  finalizeCatalogGroup,
  sharedTorusGeometry,
  tagHighLod,
} from '../shared/neptune-and-georgian-materials.ts';
import {
  addMetricMasonryBox,
  getBathStoneMaterial,
} from "./georgian-shared.ts";

export type GeorgianFacadeDressingKind =
  | 'cornerQuoins'
  | 'stringcourse'
  | 'eavesCornice'
  | 'chimneyStack'
  | 'rainwaterDownpipe'
  | 'completeEnsemble';

export interface GeorgianFacadeDressingsOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  readonly kind?: GeorgianFacadeDressingKind;
  /** Height for corner quoins or rainwater downpipe in metres (default `3.0`). */
  readonly heightM?: number;
  /** Horizontal length for stringcourse or modillion/dentil eaves cornice in metres (default `3.6`). */
  readonly lengthM?: number;
  /** Corner quoin orientation (`'left'` or `'right'`, default `'left'`). */
  readonly cornerSide?: 'left' | 'right';
}

/**
 * Parametric Georgian facade dressings:
 * - Alternating Bath-stone corner quoins (`450/225 x 215 x 22 mm` chamfered ashlar blocks wrapping a 90° corner)
 * - Bath-stone inter-floor stringcourse (`H 140 mm`)
 * - Modillion/dentil eaves cornice (`H 220 mm`)
 * - Symmetrical Flemish-brick chimney stacks (`900 x 550 mm` w/ oversailing brick corbels & paired `Ø240 x 450 mm` terracotta roll-top pots)
 * - Black cast-iron `Ø75 mm` rainwater downpipes + moulded hopper heads + eared pipe clips.
 */
export function buildGeorgianFacadeDressings(
  opts: GeorgianFacadeDressingsOptions = {}
): THREE.Group {
  const namePrefix = opts.name ?? 'georgianFacadeDressings';
  const kind = opts.kind ?? 'completeEnsemble';
  const bathStoneMat = getBathStoneMaterial();
  const brickMat = createBrickMaterial({
    preset: 'heritage-red-flemish',
    bond: 'flemish',
  });
  const castIronMat = new THREE.MeshStandardMaterial({
    name: `${namePrefix}.castIronBlack`,
    color: 0x222528,
    roughness: 0.4,
    metalness: 0.72,
  });
  const terracottaMat = new THREE.MeshStandardMaterial({
    name: `${namePrefix}.terracottaPot`,
    color: 0xb55a3c,
    roughness: 0.72,
    metalness: 0.03,
  });

  const root = new THREE.Group();
  root.name = namePrefix;

  const heightM = opts.heightM ?? 3.0;
  const lengthM = opts.lengthM ?? 3.6;

  if (kind === 'cornerQuoins' || kind === 'completeEnsemble') {
    const qGroup = new THREE.Group();
    qGroup.name = `${namePrefix}.cornerQuoins`;
    if (kind === 'completeEnsemble') {
      qGroup.position.set(-lengthM * 0.5, 0, 0);
    }
    root.add(qGroup);

    const sign = (opts.cornerSide ?? 'left') === 'left' ? 1 : -1;
    const quoinH = 0.215;
    const jointH = 0.01;
    const pitchY = quoinH + jointH;
    const reliefT = 0.022;
    const count = Math.max(2, Math.floor(heightM / pitchY));

    for (let i = 0; i < count; i++) {
      const isLongFront = i % 2 === 0;
      const frontLen = isLongFront ? 0.45 : 0.225;
      const returnLen = isLongFront ? 0.225 : 0.45;
      const cy = i * pitchY + quoinH * 0.5;

      // Front face quoin (`+Z` relief `0..22 mm`)
      addNamedBox(
        qGroup,
        `${qGroup.name}.frontBlock_${i + 1}`,
        frontLen,
        quoinH,
        reliefT,
        sign * (frontLen * 0.5),
        cy,
        reliefT * 0.5,
        bathStoneMat
      );
      // 90° return face quoin along `-Z` strictly behind `z = 0` so zero overlap at the corner arris
      addNamedBox(
        qGroup,
        `${qGroup.name}.returnBlock_${i + 1}`,
        reliefT,
        quoinH,
        returnLen,
        -sign * (reliefT * 0.5),
        cy,
        -returnLen * 0.5,
        bathStoneMat
      );
    }
  }

  if (kind === 'stringcourse' || kind === 'completeEnsemble') {
    const sGroup = new THREE.Group();
    sGroup.name = `${namePrefix}.stringcourse`;
    const scLen = kind === 'completeEnsemble' ? Math.max(0.6, lengthM - 0.46) : lengthM;
    if (kind === 'completeEnsemble') {
      sGroup.position.set(0.23, heightM * 0.5, 0);
    }
    root.add(sGroup);

    // H 140 mm weathered Bath-stone inter-floor stringcourse (`lower fillet 45 mm` + `projecting drip band 95 mm`)
    addNamedBox(
      sGroup,
      `${sGroup.name}.lowerFillet`,
      scLen,
      0.045,
      0.042,
      0,
      0.0225,
      0.021,
      bathStoneMat
    );
    addNamedBox(
      sGroup,
      `${sGroup.name}.upperWeatheredBand`,
      scLen,
      0.095,
      0.068,
      0,
      0.045 + 0.0475,
      0.034,
      bathStoneMat
    );
  }

  if (kind === 'eavesCornice' || kind === 'completeEnsemble') {
    const cGroup = new THREE.Group();
    cGroup.name = `${namePrefix}.eavesCornice`;
    if (kind === 'completeEnsemble') {
      cGroup.position.set(0, heightM, 0);
    }
    root.add(cGroup);

    // H 220 mm classical Georgian dentil/modillion eaves cornice
    addNamedBox(
      cGroup,
      `${cGroup.name}.bedMould`,
      lengthM,
      0.055,
      0.075,
      0,
      0.0275,
      0.0375,
      bathStoneMat
    );
    // Dentil / modillion bracket course (`y = 0.055 .. 0.135`, backing frieze + projecting modillions)
    addNamedBox(
      cGroup,
      `${cGroup.name}.dentilBacking`,
      lengthM,
      0.08,
      0.065,
      0,
      0.095,
      0.0325,
      bathStoneMat
    );
    const modPitch = 0.18;
    const nMods = Math.max(4, Math.floor((lengthM - 0.12) / modPitch));
    const modStart = -((nMods - 1) * modPitch) * 0.5;
    for (let m = 0; m < nMods; m++) {
      addNamedBox(
        cGroup,
        `${cGroup.name}.modillion_${m + 1}`,
        0.072,
        0.072,
        0.105,
        modStart + m * modPitch,
        0.095,
        0.065 + 0.0525,
        bathStoneMat,
        true
      );
    }
    // Projecting corona & cyma-recta crown (`y = 0.135 .. 0.220`)
    addNamedBox(
      cGroup,
      `${cGroup.name}.coronaCrown`,
      lengthM + 0.04,
      0.085,
      0.21,
      0,
      0.135 + 0.0425,
      0.105,
      bathStoneMat
    );
  }

  if (kind === 'chimneyStack' || kind === 'completeEnsemble') {
    const chGroup = new THREE.Group();
    chGroup.name = `${namePrefix}.chimneyStack`;
    if (kind === 'completeEnsemble') {
      chGroup.position.set(0, heightM + 0.22, -0.45);
    }
    root.add(chGroup);

    const stackW = 0.9;
    const stackD = 0.55;
    const shaftH = 1.15;
    // Flemish-brick chimney shaft
    addMetricMasonryBox(
      chGroup,
      `${chGroup.name}.flemishBrickShaft`,
      stackW,
      shaftH,
      stackD,
      0,
      shaftH * 0.5,
      0,
      brickMat
    );
    // 2 oversailing brick corbel courses + Bath-stone necking band
    addMetricMasonryBox(
      chGroup,
      `${chGroup.name}.oversailingCorbelLower`,
      stackW + 0.08,
      0.075,
      stackD + 0.08,
      0,
      shaftH + 0.0375,
      0,
      brickMat
    );
    addMetricMasonryBox(
      chGroup,
      `${chGroup.name}.oversailingCorbelUpper`,
      stackW + 0.15,
      0.075,
      stackD + 0.15,
      0,
      shaftH + 0.075 + 0.0375,
      0,
      brickMat
    );
    addMetricMasonryBox(
      chGroup,
      `${chGroup.name}.stoneFlaunchingCap`,
      stackW + 0.12,
      0.055,
      stackD + 0.12,
      0,
      shaftH + 0.15 + 0.0275,
      0,
      bathStoneMat
    );

    // Paired Ø240 x 450 mm terracotta roll-top chimney pots
    const potBaseY = shaftH + 0.205;
    const potH = 0.45;
    for (const [pTag, px] of [
      ['Left', -0.22],
      ['Right', 0.22],
    ] as const) {
      addNamedCyl(
        chGroup,
        `${chGroup.name}.terracottaPot${pTag}`,
        0.105,
        0.12,
        potH,
        18,
        px,
        potBaseY + potH * 0.5,
        0,
        terracottaMat
      );
      const rollRim = new THREE.Mesh(sharedTorusGeometry(0.108, 0.018, 10, 18), terracottaMat);
      rollRim.name = `${chGroup.name}.terracottaRollTop${pTag}`;
      rollRim.rotation.x = Math.PI * 0.5;
      rollRim.position.set(px, potBaseY + potH, 0);
      tagHighLod(rollRim);
      chGroup.add(rollRim);
    }
  }

  if (kind === 'rainwaterDownpipe' || kind === 'completeEnsemble') {
    const dpGroup = new THREE.Group();
    dpGroup.name = `${namePrefix}.rainwaterDownpipe`;
    if (kind === 'completeEnsemble') {
      dpGroup.position.set(lengthM * 0.5 - 0.18, 0, 0);
    }
    root.add(dpGroup);

    const pipeR = 0.0375; // Ø75 mm cast-iron downpipe
    const pipeZ = 0.062;
    const hopperH = 0.21;
    const hopperTopY = heightM - 0.04;
    const shoeH = 0.14;
    const pipeLen = Math.max(0.6, hopperTopY - hopperH - shoeH - 0.04);

    // Moulded Georgian cast-iron rainwater hopper head
    addNamedBox(
      dpGroup,
      `${dpGroup.name}.hopperLowerBowl`,
      0.19,
      hopperH * 0.55,
      0.14,
      0,
      hopperTopY - hopperH * 0.725,
      0.07,
      castIronMat,
      true
    );
    addNamedBox(
      dpGroup,
      `${dpGroup.name}.hopperMouldedRim`,
      0.25,
      hopperH * 0.45,
      0.175,
      0,
      hopperTopY - hopperH * 0.225,
      0.0875,
      castIronMat
    );

    // Main Ø75 mm cast-iron pipe stack
    addNamedCyl(
      dpGroup,
      `${dpGroup.name}.castIronPipeShaft`,
      pipeR,
      pipeR,
      pipeLen,
      16,
      0,
      shoeH + 0.04 + pipeLen * 0.5,
      pipeZ,
      castIronMat
    );

    // Eared pipe socket clips every ~0.95 m
    const clipCount = Math.max(2, Math.floor(pipeLen / 0.95) + 1);
    for (let c = 0; c < clipCount; c++) {
      const cy = shoeH + 0.12 + (c / Math.max(1, clipCount - 1)) * (pipeLen - 0.16);
      addNamedCyl(
        dpGroup,
        `${dpGroup.name}.pipeSocketCollar_${c + 1}`,
        pipeR + 0.008,
        pipeR + 0.008,
        0.048,
        16,
        0,
        cy,
        pipeZ,
        castIronMat,
        true
      );
      addNamedBox(
        dpGroup,
        `${dpGroup.name}.pipeEarBracket_${c + 1}`,
        0.165,
        0.036,
        0.016,
        0,
        cy,
        0.01,
        castIronMat,
        true
      );
    }

    // Angled bottom discharge shoe above gully
    const shoe = addNamedCyl(
      dpGroup,
      `${dpGroup.name}.bottomDischargeShoe`,
      pipeR + 0.003,
      pipeR + 0.005,
      shoeH,
      16,
      0,
      0.04 + shoeH * 0.5,
      pipeZ + 0.025,
      castIronMat,
      true
    );
    shoe.rotation.x = 0.36;
  }

  const out = finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
  return attachAssetMetadata(out, {
    name: `Georgian Bath-Stone & Cast-Iron Facade Dressings (${kind})`,
    brand: 'Haddonstone',
    collection: 'Georgian Architectural Dressings',
    sku: `HAD-GEO-${kind.toUpperCase()}`,
    finish: 'Bath Limestone Ashlar & Heritage Cast Iron',
    category: 'architectural',
    productUrl: 'https://www.haddonstone.com/en-gb/architectural-cast-stone/',
    schematicUrl: 'https://www.haddonstone.com/en-gb/technical-library/quoins-and-cornices.pdf',
  });
}

