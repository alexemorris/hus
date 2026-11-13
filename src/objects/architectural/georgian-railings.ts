import * as THREE from 'three';
import {
  attachAssetMetadata,
  mmFromMetres,
  wireCatalogHingedDoor,
} from '../shared/catalog-smart-metadata.ts';
import { createBrickMaterial } from '../../engine/textures/brick-materials.ts';
import { createStoneMasonryMaterial } from '../../engine/textures/cobblestone-materials.ts';
import {
  addNamedBox,
  addNamedCyl,
  finalizeCatalogGroup,
  getAgedBrassMaterial,
  sharedSphereGeometry,
  sharedTorusGeometry,
  tagHighLod,
} from '../shared/neptune-and-georgian-materials.ts';
import type { CatalogInteractionContext } from './neptune-kitchen-joinery.ts';
import {
  addMetricMasonryBox,
  resolveGeorgianRegistry,
} from "./georgian-shared.ts";

export interface GeorgianBrickRailingsAndGateOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  /** Number of wrought-iron railing bays on each side of the central gate (default `1`). */
  readonly baysPerSide?: number;
  /** Width of each dwarf-brick + wrought-iron bay in metres (default `2.16`). */
  readonly bayWidthM?: number;
  /** Include the central linked double wrought-iron entrance gate (`2 x 610 x 1420 mm` leaves + overthrow). Default `true`. */
  readonly includeDoubleGate?: boolean;
}

/**
 * Flemish-bond dwarf brick garden wall (`H 450 mm` using `createBrickMaterial('heritage-red-flemish')`
 * + `65 x 275 mm` chamfered `'sawn-yorkstone-coping'`), stone-capped Flemish-brick piers
 * (`450 x 450 x 1680 mm` w/ stepped Yorkstone cap & `Ø220 mm` ball finial), F&B *Railings* (`#45494C`)
 * wrought-iron panels (`16 x 16 mm` verticals at `108 mm` c/c, `40 x 10 mm` rails, alternating `480 mm`
 * fleur-de-lis dog-bars & `115 mm` cast spearhead finials -> `H 1480 mm`), and an interactive
 * linked double wrought-iron entrance gate (`2 x 610 x 1420 mm` leaves w/ arched overthrow scroll).
 */
export function buildGeorgianBrickRailingsAndGate(
  ctx: CatalogInteractionContext = null,
  opts: GeorgianBrickRailingsAndGateOptions = {}
): THREE.Group {
  const namePrefix = opts.name ?? 'georgianBrickRailings';
  const baysPerSide = Math.max(1, opts.baysPerSide ?? 1);
  const bayW = opts.bayWidthM ?? 2.16;
  const includeGate = opts.includeDoubleGate ?? true;
  const registry = resolveGeorgianRegistry(ctx);

  const brickMat = createBrickMaterial({
    preset: 'heritage-red-flemish',
    bond: 'flemish',
  });
  const copingMat = createStoneMasonryMaterial('sawn-yorkstone-coping');
  const ironMat = new THREE.MeshStandardMaterial({
    name: `${namePrefix}.farrowBallRailings`,
    color: 0x45494c,
    roughness: 0.36,
    metalness: 0.78,
  });
  const brassMat = getAgedBrassMaterial();

  const root = new THREE.Group();
  root.name = namePrefix;

  const pierW = 0.45;
  const pierMasonryH = 1.46; // + 0.22 stepped cap + Ø220 ball finial -> pier masonry/cap 1.68 m + finial
  const dwarfBrickH = 0.45;
  const dwarfBrickD = 0.225;
  const copingH = 0.065;
  const copingD = 0.275;
  const gateClearW = 1.24; // 2 x 610 mm leaves + latch/hinge clearances

  const buildPier = (pierId: string, cx: number): void => {
    const pg = new THREE.Group();
    pg.name = `${namePrefix}.${pierId}`;
    pg.position.set(cx, 0, 0);
    root.add(pg);

    // Brick plinth & Flemish-bond pier shaft (1 UV = 1.0 m -> exact 75 mm courses & 225 mm stretchers)
    addMetricMasonryBox(
      pg,
      `${pg.name}.plinthCourse`,
      pierW + 0.036,
      0.15,
      pierW + 0.036,
      0,
      0.075,
      0,
      brickMat,
      cx,
      0,
      0
    );
    addMetricMasonryBox(
      pg,
      `${pg.name}.brickShaft`,
      pierW,
      pierMasonryH - 0.15,
      pierW,
      0,
      0.15 + (pierMasonryH - 0.15) * 0.5,
      0,
      brickMat,
      cx,
      0,
      0
    );
    // Stepped Yorkstone pier cap (`1.46 .. 1.68 m`) + Ø220 mm ball finial on necking socle
    addMetricMasonryBox(
      pg,
      `${pg.name}.yorkstoneCapLower`,
      pierW + 0.09,
      0.11,
      pierW + 0.09,
      0,
      pierMasonryH + 0.055,
      0,
      copingMat,
      cx,
      0,
      0
    );
    addMetricMasonryBox(
      pg,
      `${pg.name}.yorkstoneCapUpper`,
      pierW - 0.02,
      0.11,
      pierW - 0.02,
      0,
      pierMasonryH + 0.165,
      0,
      copingMat,
      cx,
      0,
      0
    );
    addNamedCyl(
      pg,
      `${pg.name}.finialSocle`,
      0.072,
      0.092,
      0.055,
      16,
      0,
      1.68 + 0.0275,
      0,
      copingMat,
      true
    );
    const ball = new THREE.Mesh(sharedSphereGeometry(0.11, 18, 14), copingMat);
    ball.name = `${pg.name}.ballFinial`;
    ball.position.set(0, 1.68 + 0.055 + 0.105, 0);
    ball.castShadow = true;
    pg.add(ball);
  };

  const buildRailingBay = (bayId: string, cx: number, spanW: number): void => {
    const bg = new THREE.Group();
    bg.name = `${namePrefix}.${bayId}`;
    bg.position.set(cx, 0, 0);
    root.add(bg);

    // Flemish-bond dwarf brick garden wall (H 450 mm: 150 mm plinth course between pier plinths + 300 mm upper wall)
    addMetricMasonryBox(
      bg,
      `${bg.name}.dwarfBrickPlinth`,
      spanW - 0.038,
      0.15,
      dwarfBrickD + 0.016,
      0,
      0.075,
      0,
      brickMat,
      cx,
      0,
      0
    );
    addMetricMasonryBox(
      bg,
      `${bg.name}.dwarfBrickWall`,
      spanW,
      dwarfBrickH - 0.15,
      dwarfBrickD,
      0,
      0.15 + (dwarfBrickH - 0.15) * 0.5,
      0,
      brickMat,
      cx,
      0,
      0
    );
    addMetricMasonryBox(
      bg,
      `${bg.name}.yorkstoneCoping`,
      spanW,
      copingH,
      copingD,
      0,
      dwarfBrickH + copingH * 0.5,
      0,
      copingMat,
      cx,
      0,
      0
    );

    // Wrought-iron railings rising above coping (`copingTop = 0.515` -> spearhead tip `1.48 m`)
    const copingTopY = dwarfBrickH + copingH;
    const bottomRailY = copingTopY + 0.055;
    const topRailY = 1.355;
    const railThickY = 0.01;
    const railDepthZ = 0.04;

    addNamedBox(
      bg,
      `${bg.name}.bottomIronRail`,
      spanW,
      railThickY,
      railDepthZ,
      0,
      bottomRailY,
      0,
      ironMat
    );
    addNamedBox(
      bg,
      `${bg.name}.topIronRail`,
      spanW,
      railThickY,
      railDepthZ,
      0,
      topRailY,
      0,
      ironMat
    );

    // Alternating 16 x 16 mm square main verticals (`H -> 1.48 m` w/ 115 mm spearhead) and intermediate 480 mm fleur-de-lis dog-bars at 108 mm c/c
    const pitch = 0.108;
    const nBars = Math.max(3, Math.floor((spanW - 0.08) / pitch));
    const startX = -((nBars - 1) * pitch) * 0.5;

    for (let i = 0; i < nBars; i++) {
      const bx = startX + i * pitch;
      const isDogBar = i % 2 === 1;
      if (!isDogBar) {
        const barBot = copingTopY + 0.002;
        const barTop = 1.365;
        const barH = barTop - barBot;
        addNamedBox(
          bg,
          `${bg.name}.verticalBar_${i + 1}`,
          0.016,
          barH,
          0.016,
          bx,
          barBot + barH * 0.5,
          0,
          ironMat,
          true
        );
        // 115 mm cast spearhead finial (`1.365 .. 1.480 m`)
        addNamedCyl(
          bg,
          `${bg.name}.spearCollar_${i + 1}`,
          0.015,
          0.012,
          0.02,
          8,
          bx,
          1.375,
          0,
          ironMat,
          true
        );
        addNamedCyl(
          bg,
          `${bg.name}.spearPoint_${i + 1}`,
          0.002,
          0.017,
          0.095,
          6,
          bx,
          1.385 + 0.0475,
          0,
          ironMat,
          true
        );
      } else {
        // 480 mm intermediate dog-bar w/ small fleur-de-lis finial
        const dogH = 0.44;
        addNamedBox(
          bg,
          `${bg.name}.dogBar_${i + 1}`,
          0.014,
          dogH,
          0.014,
          bx,
          bottomRailY + 0.006 + dogH * 0.5,
          0,
          ironMat,
          true
        );
        addNamedCyl(
          bg,
          `${bg.name}.dogFleurFinial_${i + 1}`,
          0.003,
          0.013,
          0.042,
          6,
          bx,
          bottomRailY + 0.006 + dogH + 0.021,
          0,
          ironMat,
          true
        );
      }
    }
  };

  if (includeGate) {
    const gateLeftPierX = -(gateClearW * 0.5 + pierW * 0.5);
    const gateRightPierX = gateClearW * 0.5 + pierW * 0.5;
    buildPier('gatePierLeft', gateLeftPierX);
    buildPier('gatePierRight', gateRightPierX);

    for (let b = 0; b < baysPerSide; b++) {
      const bayOffset = gateRightPierX + pierW * 0.5 + bayW * 0.5 + b * (bayW + pierW);
      const outerPierX = bayOffset + bayW * 0.5 + pierW * 0.5;
      buildRailingBay(`railingBayLeft_${b + 1}`, -bayOffset, bayW);
      buildPier(`endPierLeft_${b + 1}`, -outerPierX);
      buildRailingBay(`railingBayRight_${b + 1}`, bayOffset, bayW);
      buildPier(`endPierRight_${b + 1}`, outerPierX);
    }

    // Arched wrought-iron overthrow scroll spanning between the two gate piers above the gate leaves
    const archSpanR = gateClearW * 0.5 + 0.02;
    const overthrowArch = new THREE.Mesh(
      sharedTorusGeometry(archSpanR, 0.014, 10, 26, Math.PI),
      ironMat
    );
    overthrowArch.name = `${namePrefix}.gateOverthrowArch`;
    overthrowArch.position.set(0, 1.48, 0);
    root.add(overthrowArch);

    const innerScroll = new THREE.Mesh(
      sharedTorusGeometry(archSpanR - 0.085, 0.01, 8, 24, Math.PI),
      ironMat
    );
    innerScroll.name = `${namePrefix}.gateOverthrowInnerArch`;
    innerScroll.position.set(0, 1.48, 0);
    root.add(innerScroll);

    // Central lantern/crest finial ring at apex of overthrow
    const crestRing = new THREE.Mesh(sharedTorusGeometry(0.085, 0.009, 8, 18), ironMat);
    crestRing.name = `${namePrefix}.gateOverthrowCrest`;
    crestRing.position.set(0, 1.48 + archSpanR - 0.042, 0);
    tagHighLod(crestRing);
    root.add(crestRing);

    addNamedCyl(
      root,
      `${namePrefix}.gateOverthrowApexSpear`,
      0.003,
      0.018,
      0.12,
      6,
      0,
      1.48 + archSpanR + 0.065,
      0,
      brassMat,
      true
    );

    // Interactive linked double wrought-iron entrance gate (`2 x 610 x 1420 mm` leaves)
    const leafW = 0.61;
    const leafH = 1.42;
    const groundClearY = 0.05;
    let leftGatePivot: THREE.Object3D | null = null;
    let rightGatePivot: THREE.Object3D | null = null;

    for (const [gTag, sign] of [
      ['leftGateLeaf', -1],
      ['rightGateLeaf', 1],
    ] as const) {
      const leafCx = sign * (leafW * 0.5 + 0.005);
      const leafGroup = new THREE.Group();
      leafGroup.name = `${namePrefix}.${gTag}`;
      leafGroup.position.set(leafCx, groundClearY + leafH * 0.5, 0);
      root.add(leafGroup);

      // Outer hinge & meeting stiles (30 x 30 mm)
      addNamedBox(
        leafGroup,
        `${leafGroup.name}.hingeStile`,
        0.03,
        leafH,
        0.03,
        sign * (leafW * 0.5 - 0.015),
        0,
        0,
        ironMat
      );
      addNamedBox(
        leafGroup,
        `${leafGroup.name}.meetingStile`,
        0.026,
        leafH - 0.06,
        0.026,
        -sign * (leafW * 0.5 - 0.013),
        -0.03,
        0,
        ironMat
      );
      // Top, mid-lock, and bottom horizontal rails strictly between stiles
      const innerLeafW = leafW - 0.056;
      for (const [rName, ry] of [
        ['bottomRail', -leafH * 0.5 + 0.06],
        ['midDogRail', -leafH * 0.5 + 0.5],
        ['topRail', leafH * 0.5 - 0.14],
      ] as const) {
        addNamedBox(
          leafGroup,
          `${leafGroup.name}.${rName}`,
          innerLeafW,
          0.014,
          0.036,
          0,
          ry,
          0,
          ironMat
        );
      }

      // 5 vertical bars w/ spearhead finials + 4 dog-bars
      const nGateBars = 5;
      const gPitch = innerLeafW / (nGateBars + 0.5);
      for (let k = 0; k < nGateBars; k++) {
        const kx = -innerLeafW * 0.5 + (k + 0.75) * gPitch;
        const vBarH = leafH - 0.2;
        addNamedBox(
          leafGroup,
          `${leafGroup.name}.picket_${k + 1}`,
          0.016,
          vBarH,
          0.016,
          kx,
          -0.04,
          0,
          ironMat,
          true
        );
        addNamedCyl(
          leafGroup,
          `${leafGroup.name}.spear_${k + 1}`,
          0.002,
          0.016,
          0.095,
          6,
          kx,
          leafH * 0.5 - 0.14 + 0.055,
          0,
          ironMat,
          true
        );
      }

      // Decorative C-scroll rings in lower dog-bar panel + aged brass drop-ring latch on left meeting stile
      const ring = new THREE.Mesh(sharedTorusGeometry(0.052, 0.007, 8, 16), ironMat);
      ring.name = `${leafGroup.name}.scrollMedallion`;
      ring.position.set(0, -leafH * 0.5 + 0.28, 0);
      tagHighLod(ring);
      leafGroup.add(ring);

      if (sign < 0) {
        const latchRing = new THREE.Mesh(sharedTorusGeometry(0.032, 0.006, 8, 16), brassMat);
        latchRing.name = `${leafGroup.name}.brassGateRingLatch`;
        latchRing.position.set(leafW * 0.5 - 0.035, 0.08, 0.026);
        tagHighLod(latchRing);
        leafGroup.add(latchRing);
      }

      const pivot = wireCatalogHingedDoor(registry, {
        parent: root,
        door: leafGroup,
        hingeOffset: [sign * (leafW * 0.5 - 0.015), 0, 0],
        axis: 'y',
        openAngle: sign < 0 ? Math.PI * 0.5 : -Math.PI * 0.5,
        label: 'Open Wrought-Iron Forecourt Gates',
        linkGroup: 'forecourtDoubleGate',
        audio: { openPreset: 'gateLatch', closePreset: 'gateLatch', isExterior: true },
      });
      if (sign < 0) leftGatePivot = pivot;
      else rightGatePivot = pivot;
    }

    if (registry && leftGatePivot && rightGatePivot) {
      registry.linkDoorPair(leftGatePivot, rightGatePivot);
    }
  } else {
    buildPier('pierLeft', -(bayW * 0.5 + pierW * 0.5));
    buildRailingBay('railingBay_1', 0, bayW);
    buildPier('pierRight', bayW * 0.5 + pierW * 0.5);
  }

  const out = finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
  return attachAssetMetadata(out, {
    name: 'Georgian Flemish-Brick Dwarf Wall, Wrought-Iron Railings & Double Gate',
    brand: 'British Spirals & Castings',
    collection: 'Georgian Heritage Ironwork',
    sku: `BSC-GEO-GATE-${baysPerSide * 2}B`,
    finish: 'Heritage Flemish Red Brick, Sawn Yorkstone & Farrow & Ball Railings (#45494C)',
    category: 'architectural',
    dimensionsMm: mmFromMetres(baysPerSide * 2 * bayW + 1.8, 0.45, 1.92),
    productUrl: 'https://www.britishsc.co.uk/cast-iron-railings-and-gates/',
    schematicUrl: 'https://www.britishsc.co.uk/technical/georgian-railing-and-gate-elevation.pdf',
  });
}

