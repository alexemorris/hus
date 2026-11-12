import * as THREE from 'three';
import { type InteractionTarget } from '../../engine/geometry/mesh-traits.ts';
import { applyMetricBoxUVs } from '../../engine/textures/metric-masonry-uvs.ts';
import { getOrCreateCachedTexture } from '../../engine/textures/texture-registry.ts';
import {
  collectSeatClickableMeshes,
  SeatInteractable,
} from '../furniture/seating-interactions.ts';
import { prepGeo } from '../shared/scene-helpers.ts';
import {
  attachAssetMetadata,
  formatBrasswareFinishLabel,
  mmFromMetres,
  resolveBrasswareCode,
  wireCatalogHingedDoor,
  wireCatalogSlidingDrawer,
} from '../shared/catalog-smart-metadata.ts';
import type { InteractionRegistry } from '../../engine/interaction/interaction-registry.ts';
import {
  attachDrawerBoxBehindFront,
  buildHollowCabinetCarcass,
} from '../joinery/cabinet-interior.ts';
import { getBathroomBrassMaterials } from '../sanitaryware/bathroom-materials.ts';
import type {
  BrasswareFinishCode,
  KitchenTapSlotValue,
} from '../sanitaryware/bathroom-spec-types.ts';
import {
  buildKitchenTapFromSpec,
  isCustomTapObject3D,
  mountTapOnFixture,
  registerTapMountAnchor,
} from '../sanitaryware/perrin-rowe-taps.ts';
import {
  addCockBeadApertureTrim,
  addNamedBox,
  addNamedCyl,
  buildAgedBrassBarlowCupPull,
  buildAgedBrassMushroomKnob,
  buildShakerDoorAssembly,
  finalizeCatalogGroup,
  getAgedBrassMaterial,
  getBrushedStainlessCatalogMaterial,
  getBurnishedCopperCatalogMaterial,
  getCharacterOakMaterial,
  getClearArchitecturalGlassMaterial,
  getDarkAntiquedBrassMaterial,
  getEndGrainOakMaterial,
  getHeavyFireclayMaterial,
  getHonedCarraraCatalogMaterial,
  getMatteCastIronMaterial,
  getPaintedJoineryMaterial,
  getVitreousPorcelainLeverMaterial,
  getWarm2700kLedMaterial,
  deriveNormalAndRoughnessFromHeight,
  getTimberGrainMaps,
  getWovenFabricMaps,
  getZelligeTileMaps,
  makeRgbaDataTexture,
  type PbrDataMapBundle,
  seamlessFbm2D,
  seamlessValueNoise2D,
  sharedSphereGeometry,
  tagHighLod,
} from '../shared/neptune-and-georgian-materials.ts';

export type CatalogInteractionContext =
  | InteractionTarget
  | { readonly interactions?: InteractionRegistry | undefined }
  | null
  | undefined;

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

export type NeptuneCabinetCollection = 'chichester' | 'suffolk';
export type NeptuneCabinetElevation = 'base' | 'wall' | 'tall';

export interface NeptuneCabinetBaySpec {
  readonly kind:
    | 'singleDoor'
    | 'doubleDoor'
    | 'drawerBank3'
    | 'drawerBank4'
    | 'integratedDishwasher'
    | 'twinPullOutBin'
    | 'openShelves';
  /** Bay width in metres (default `0.60`). */
  readonly widthM?: number;
  /** Hinge side for `'singleDoor'` (default `'left'`). */
  readonly hingeSide?: 'left' | 'right';
}


function applyNeptuneHardwareFinish(
  group: THREE.Group,
  hardwareFinish?: BrasswareFinishCode
): THREE.Group {
  if (!hardwareFinish) return group;
  const pal = getBathroomBrassMaterials(hardwareFinish);
  group.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const m = child as THREE.Mesh;
      m.material =
        m.name.endsWith('.flange') || m.name.endsWith('.backplateRose')
          ? pal.darkShadow
          : pal.primary;
    }
  });
  return group;
}

export interface NeptuneInFrameCabinetRunOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  readonly collection?: NeptuneCabinetCollection;
  readonly elevation?: NeptuneCabinetElevation;
  /** Paint colour (default Neptune *Shingle* `#D5D4CA`). */
  readonly paintColor?: THREE.ColorRepresentation;
  /** Sequence of cabinet bays left-to-right (`-X` to `+X`), facing `+Z`. */
  readonly bays?: readonly NeptuneCabinetBaySpec[];
  /** Cabinet depth in metres (default `0.60` base/tall, `0.34` wall). */
  readonly depthM?: number;
  /** Total height including plinth/worktop in metres (default `0.90` base, `0.78` wall, `2.15` tall). */
  readonly heightM?: number;
  /** Include worktop & upstand on base runs (default `true` for `'base'`). */
  readonly includeMarbleWorktop?: boolean;
  readonly includeUpstand?: boolean;
  /** Worktop & upstand material (`'carrara'` 30 mm bullnose marble or `'paleOak'` 40 mm solid European oak + 75 mm oak upstand). */
  readonly worktopMaterial?: 'carrara' | 'paleOak';
  /** Hardware style (`'cupPullAndKnob'` default, or `'knobOnly'` Ø28 mm turned brass knobs on all drawers & doors). */
  readonly hardwareStyle?: 'cupPullAndKnob' | 'knobOnly';
  /** Coordinated metal hardware finish for Barlow cup pulls & Mushroom knobs (defaults to Aged Brass). */
  readonly hardwareFinish?: BrasswareFinishCode;
}

/**
 * Parametric Neptune *Chichester* (cock-beaded 28 mm face-frame + 110 mm ogee skirting plinth)
 * and *Suffolk* (clean square face-frame + recessed plinth) in-frame cabinet run.
 * Local origin `(0, 0, 0)` is centered along X at floor/bottom level (`y = 0`) and centered in Z (`[-depth/2, +depth/2]`), facing `+Z`.
 */
export function buildNeptuneInFrameCabinetRun(
  ctx: CatalogInteractionContext = null,
  opts: NeptuneInFrameCabinetRunOptions = {}
): THREE.Group {
  const namePrefix = opts.name ?? 'neptuneCabinetRun';
  const collection = opts.collection ?? 'chichester';
  const elevation = opts.elevation ?? 'base';
  const paintMat = getPaintedJoineryMaterial(
    opts.paintColor ?? 0xd5d4ca,
    0.52,
    `${namePrefix}.paint`
  );
  const carraraMat = getHonedCarraraCatalogMaterial();
  const oakMat = getCharacterOakMaterial();
  const stainlessMat = getBrushedStainlessCatalogMaterial();
  const registry = resolveRegistry(ctx);

  const bays: readonly NeptuneCabinetBaySpec[] = opts.bays ?? [
    { kind: 'drawerBank3', widthM: 0.8 },
    { kind: 'integratedDishwasher', widthM: 0.6 },
    { kind: 'doubleDoor', widthM: 0.9 },
    { kind: 'twinPullOutBin', widthM: 0.5 },
  ];

  const depthM = opts.depthM ?? (elevation === 'wall' ? 0.34 : 0.6);
  const worktopKind = opts.worktopMaterial ?? 'carrara';
  const hardwareStyle = opts.hardwareStyle ?? 'cupPullAndKnob';
  const includeWorktop = opts.includeMarbleWorktop ?? elevation === 'base';
  const includeUpstand = opts.includeUpstand ?? includeWorktop;
  const worktopH = includeWorktop ? (worktopKind === 'paleOak' ? 0.04 : 0.03) : 0;
  const totalH =
    opts.heightM ?? (elevation === 'wall' ? 0.78 : elevation === 'tall' ? 2.15 : 0.9);
  const plinthH = elevation === 'wall' ? 0 : 0.11;
  const carcassH = Math.max(0.32, totalH - worktopH);
  const frameStileW = 0.028;
  const frameThick = 0.024;
  const doorThick = 0.022;

  const totalW = bays.reduce((acc, b) => acc + (b.widthM ?? 0.6), 0) + frameStileW;
  const root = new THREE.Group();
  root.name = namePrefix;

  const frontZ = depthM * 0.5;
  const carcassDepth = depthM - frameThick;
  const carcassCenterZ = -frameThick * 0.5;

  // Chichester ogee skirting plinth along front + end returns (non-overlapping with recessed carcass kickboard)
  if (plinthH > 0 && collection === 'chichester') {
    const skirtT = 0.018;
    const skirtZ = frontZ - skirtT * 0.5 + 0.004;
    addNamedBox(
      root,
      `${namePrefix}.ogeePlinthFront`,
      totalW - 0.002,
      plinthH - 0.018,
      skirtT,
      0,
      (plinthH - 0.018) * 0.5,
      skirtZ,
      paintMat
    );
    const ogeeRoll = addNamedCyl(
      root,
      `${namePrefix}.ogeePlinthMoulding`,
      0.007,
      0.009,
      totalW - 0.002,
      12,
      0,
      plinthH - 0.009,
      skirtZ,
      paintMat,
      true
    );
    ogeeRoll.rotation.z = Math.PI * 0.5;
  }

  // Face-frame top & bottom rails across the full run (disjoint from vertical stiles)
  const frameBotY = plinthH;
  const frameTopY = carcassH;
  const frameH = frameTopY - frameBotY;
  const frameZ = frontZ - frameThick * 0.5;

  let cursorX = -totalW * 0.5;
  for (let i = 0; i <= bays.length; i++) {
    const stileCx = cursorX + frameStileW * 0.5;
    addNamedBox(
      root,
      `${namePrefix}.frameStile_${i + 1}`,
      frameStileW,
      frameH,
      frameThick,
      stileCx,
      frameBotY + frameH * 0.5,
      frameZ,
      paintMat
    );
    if (i < bays.length) {
      const bay = bays[i]!;
      const bayOuterW = bay.widthM ?? 0.6;
      const openW = Math.max(0.18, bayOuterW - frameStileW);
      const bayCx = cursorX + frameStileW + openW * 0.5;

      // Top and bottom face-frame rails for this bay
      addNamedBox(
        root,
        `${namePrefix}.bay_${i + 1}.railTop`,
        openW,
        frameStileW,
        frameThick,
        bayCx,
        frameTopY - frameStileW * 0.5,
        frameZ,
        paintMat
      );
      addNamedBox(
        root,
        `${namePrefix}.bay_${i + 1}.railBottom`,
        openW,
        frameStileW,
        frameThick,
        bayCx,
        frameBotY + frameStileW * 0.5,
        frameZ,
        paintMat
      );

      // Hollow cabinet carcass behind the face-frame
      const interiorStyle =
        bay.kind === 'integratedDishwasher'
          ? 'dishwasher'
          : bay.kind === 'twinPullOutBin'
            ? 'utility'
            : 'oak';
      const carcass = buildHollowCabinetCarcass(
        root,
        bayCx,
        0,
        carcassCenterZ,
        bayOuterW - 0.004,
        carcassH - 0.004,
        carcassDepth,
        '+z',
        paintMat,
        {
          plinthHeight: plinthH,
          interiorStyle,
          shelfCount: bay.kind === 'openShelves' ? 2 : 1,
          populateItems: bay.kind !== 'drawerBank3' && bay.kind !== 'drawerBank4',
        }
      );
      carcass.name = `${namePrefix}.bay_${i + 1}.carcass`;

      const apBotY = frameBotY + frameStileW;
      const apTopY = frameTopY - frameStileW;
      const apH = Math.max(0.16, apTopY - apBotY);
      const apCy = (apBotY + apTopY) * 0.5;
      const insetDoorZ = frontZ - doorThick * 0.5 - 0.001;

      if (bay.kind === 'drawerBank3' || bay.kind === 'drawerBank4') {
        const count = bay.kind === 'drawerBank4' ? 4 : 3;
        const railH = 0.022;
        const availH = apH - railH * (count - 1);
        const ratios =
          count === 3 ? [0.22, 0.37, 0.41] : [0.18, 0.24, 0.28, 0.3];
        let topCursor = apTopY;

        for (let dIdx = 0; dIdx < count; dIdx++) {
          const dH = availH * ratios[dIdx]!;
          const dCy = topCursor - dH * 0.5;
          if (collection === 'chichester') {
            addCockBeadApertureTrim(
              root,
              `${namePrefix}.bay_${i + 1}.drawerBead_${dIdx + 1}`,
              bayCx,
              dCy,
              frontZ,
              openW,
              dH,
              paintMat
            );
          }

          const drawerGroup = new THREE.Group();
          drawerGroup.name = `${namePrefix}.bay_${i + 1}.drawer_${dIdx + 1}`;
          drawerGroup.position.set(bayCx, dCy, insetDoorZ);
          root.add(drawerGroup);

          const frontPanel = buildShakerDoorAssembly(
            `${drawerGroup.name}.front`,
            openW - 0.008,
            dH - 0.008,
            doorThick,
            paintMat,
            0.044
          );
          drawerGroup.add(frontPanel);

          if (hardwareStyle === 'knobOnly') {
            if (openW >= 0.92) {
              for (const [pTag, px] of [
                ['leftKnob', -openW * 0.24],
                ['rightKnob', openW * 0.24],
              ] as const) {
                const knob = applyNeptuneHardwareFinish(buildAgedBrassMushroomKnob(`${drawerGroup.name}.${pTag}`), opts.hardwareFinish);
                knob.position.set(px, 0, doorThick * 0.5 + 0.001);
                drawerGroup.add(knob);
              }
            } else {
              const knob = applyNeptuneHardwareFinish(buildAgedBrassMushroomKnob(`${drawerGroup.name}.knob`), opts.hardwareFinish);
              knob.position.set(0, 0, doorThick * 0.5 + 0.001);
              drawerGroup.add(knob);
            }
          } else if (openW >= 0.72) {
            for (const [pTag, px] of [
              ['leftPull', -openW * 0.24],
              ['rightPull', openW * 0.24],
            ] as const) {
              const pull = applyNeptuneHardwareFinish(buildAgedBrassBarlowCupPull(`${drawerGroup.name}.${pTag}`), opts.hardwareFinish);
              pull.position.set(px, 0, doorThick * 0.5 + 0.001);
              drawerGroup.add(pull);
            }
          } else {
            const pull = applyNeptuneHardwareFinish(buildAgedBrassBarlowCupPull(`${drawerGroup.name}.cupPull`), opts.hardwareFinish);
            pull.position.set(0, 0, doorThick * 0.5 + 0.001);
            drawerGroup.add(pull);
          }

          attachDrawerBoxBehindFront(
            drawerGroup,
            openW - 0.044,
            dH - 0.012,
            Math.max(0.22, carcassDepth - 0.08),
            '+z',
            dIdx > 0
          );

          wireCatalogSlidingDrawer(registry, {
            drawer: drawerGroup,
            slideDelta: [0, 0, Math.min(0.42, carcassDepth * 0.72)],
            label: `Open Cabinet Drawer ${dIdx + 1}`,
          });

          topCursor -= dH;
          if (dIdx < count - 1) {
            addNamedBox(
              root,
              `${namePrefix}.bay_${i + 1}.midRail_${dIdx + 1}`,
              openW,
              railH,
              frameThick,
              bayCx,
              topCursor - railH * 0.5,
              frameZ,
              paintMat
            );
            topCursor -= railH;
          }
        }
      } else if (bay.kind === 'integratedDishwasher') {
        if (collection === 'chichester') {
          addCockBeadApertureTrim(
            root,
            `${namePrefix}.bay_${i + 1}.apertureBead`,
            bayCx,
            apCy,
            frontZ,
            openW,
            apH,
            paintMat
          );
        }
        const dwDoor = new THREE.Group();
        dwDoor.name = `${namePrefix}.bay_${i + 1}.dishwasherDoor`;
        dwDoor.position.set(bayCx, apCy, insetDoorZ);
        root.add(dwDoor);

        dwDoor.add(
          buildShakerDoorAssembly(
            `${dwDoor.name}.panel`,
            openW - 0.008,
            apH - 0.008,
            doorThick,
            paintMat
          )
        );
        // Top-edge stainless control strip visible when tilted down
        addNamedBox(
          dwDoor,
          `${dwDoor.name}.controlLip`,
          openW - 0.02,
          0.022,
          0.016,
          0,
          apH * 0.5 - 0.014,
          -doorThick * 0.5 - 0.009,
          stainlessMat,
          true
        );
        const pull = applyNeptuneHardwareFinish(
          hardwareStyle === 'knobOnly'
            ? buildAgedBrassMushroomKnob(`${dwDoor.name}.knob`)
            : buildAgedBrassBarlowCupPull(`${dwDoor.name}.cupPull`),
          opts.hardwareFinish
        );
        pull.position.set(0, apH * 0.5 - 0.065, doorThick * 0.5 + 0.001);
        dwDoor.add(pull);

        wireCatalogHingedDoor(registry, {
          parent: root,
          door: dwDoor,
          hingeOffset: [0, -apH * 0.5 + 0.015, 0],
          axis: 'x',
          openAngle: Math.PI * 0.44,
          label: 'Open Integrated Dishwasher',
        });
      } else if (bay.kind === 'twinPullOutBin') {
        if (collection === 'chichester') {
          addCockBeadApertureTrim(
            root,
            `${namePrefix}.bay_${i + 1}.apertureBead`,
            bayCx,
            apCy,
            frontZ,
            openW,
            apH,
            paintMat
          );
        }
        const binPullOut = new THREE.Group();
        binPullOut.name = `${namePrefix}.bay_${i + 1}.twinBinPullOut`;
        binPullOut.position.set(bayCx, apCy, insetDoorZ);
        root.add(binPullOut);

        binPullOut.add(
          buildShakerDoorAssembly(
            `${binPullOut.name}.front`,
            openW - 0.008,
            apH - 0.008,
            doorThick,
            paintMat
          )
        );
        const pull = applyNeptuneHardwareFinish(
          hardwareStyle === 'knobOnly'
            ? buildAgedBrassMushroomKnob(`${binPullOut.name}.knob`)
            : buildAgedBrassBarlowCupPull(`${binPullOut.name}.cupPull`),
          opts.hardwareFinish
        );
        pull.position.set(0, apH * 0.5 - 0.065, doorThick * 0.5 + 0.001);
        binPullOut.add(pull);

        // Twin recycling/general bins riding on oak carriage frame behind door
        const binMatA = getPaintedJoineryMaterial(0x3a3e40, 0.55, `${namePrefix}.binDark`);
        const binMatB = getPaintedJoineryMaterial(0x556257, 0.55, `${namePrefix}.binRecycle`);
        const carriageD = Math.max(0.34, carcassDepth - 0.08);
        addNamedBox(
          binPullOut,
          `${binPullOut.name}.carriageBase`,
          openW - 0.04,
          0.018,
          carriageD,
          0,
          -apH * 0.5 + 0.03,
          -doorThick * 0.5 - carriageD * 0.5 - 0.004,
          oakMat
        );
        const binH = Math.max(0.28, apH * 0.68);
        const binD = carriageD * 0.44;
        addNamedBox(
          binPullOut,
          `${binPullOut.name}.binFront`,
          openW - 0.07,
          binH,
          binD,
          0,
          -apH * 0.5 + 0.042 + binH * 0.5,
          -doorThick * 0.5 - binD * 0.5 - 0.016,
          binMatA
        );
        addNamedBox(
          binPullOut,
          `${binPullOut.name}.binRear`,
          openW - 0.07,
          binH,
          binD,
          0,
          -apH * 0.5 + 0.042 + binH * 0.5,
          -doorThick * 0.5 - binD * 1.5 - 0.032,
          binMatB
        );

        wireCatalogSlidingDrawer(registry, {
          drawer: binPullOut,
          slideDelta: [0, 0, Math.min(0.44, carcassDepth * 0.76)],
          label: 'Pull Out Recycling & Waste Bin',
        });
      } else if (bay.kind === 'doubleDoor') {
        if (collection === 'chichester') {
          addCockBeadApertureTrim(
            root,
            `${namePrefix}.bay_${i + 1}.apertureBead`,
            bayCx,
            apCy,
            frontZ,
            openW,
            apH,
            paintMat
          );
        }
        const leafW = (openW - 0.012) * 0.5;
        let leftPivot: THREE.Object3D | null = null;
        let rightPivot: THREE.Object3D | null = null;
        for (const [sideTag, sign] of [
          ['leftDoor', -1],
          ['rightDoor', 1],
        ] as const) {
          const leafCx = bayCx + sign * (leafW * 0.5 + 0.002);
          const leafGroup = new THREE.Group();
          leafGroup.name = `${namePrefix}.bay_${i + 1}.${sideTag}`;
          leafGroup.position.set(leafCx, apCy, insetDoorZ);
          root.add(leafGroup);

          leafGroup.add(
            buildShakerDoorAssembly(
              `${leafGroup.name}.panel`,
              leafW,
              apH - 0.008,
              doorThick,
              paintMat,
              0.048
            )
          );
          const knob = applyNeptuneHardwareFinish(buildAgedBrassMushroomKnob(`${leafGroup.name}.knob`), opts.hardwareFinish);
          const knobY = elevation === 'wall' ? -apH * 0.5 + 0.075 : apH * 0.5 - 0.075;
          knob.position.set(-sign * (leafW * 0.5 - 0.032), knobY, doorThick * 0.5 + 0.001);
          leafGroup.add(knob);

          const pivot = wireCatalogHingedDoor(registry, {
            parent: root,
            door: leafGroup,
            hingeOffset: [sign * (leafW * 0.5 - 0.008), 0, 0],
            axis: 'y',
            openAngle: sign < 0 ? -Math.PI * 0.58 : Math.PI * 0.58,
            label: 'Open Cupboard Doors',
            linkGroup: `bayDoubleDoor_${i + 1}`,
          });
          if (sign < 0) leftPivot = pivot;
          else rightPivot = pivot;
        }
        if (registry && leftPivot && rightPivot) {
          registry.linkDoorPair(leftPivot, rightPivot);
        }
      } else if (bay.kind === 'singleDoor') {
        if (collection === 'chichester') {
          addCockBeadApertureTrim(
            root,
            `${namePrefix}.bay_${i + 1}.apertureBead`,
            bayCx,
            apCy,
            frontZ,
            openW,
            apH,
            paintMat
          );
        }
        const hingeLeft = (bay.hingeSide ?? 'left') === 'left';
        const sign = hingeLeft ? -1 : 1;
        const doorGroup = new THREE.Group();
        doorGroup.name = `${namePrefix}.bay_${i + 1}.door`;
        doorGroup.position.set(bayCx, apCy, insetDoorZ);
        root.add(doorGroup);

        doorGroup.add(
          buildShakerDoorAssembly(
            `${doorGroup.name}.panel`,
            openW - 0.008,
            apH - 0.008,
            doorThick,
            paintMat
          )
        );
        const knob = applyNeptuneHardwareFinish(buildAgedBrassMushroomKnob(`${doorGroup.name}.knob`), opts.hardwareFinish);
        const knobY = elevation === 'wall' ? -apH * 0.5 + 0.075 : apH * 0.5 - 0.075;
        knob.position.set(-sign * (openW * 0.5 - 0.036), knobY, doorThick * 0.5 + 0.001);
        doorGroup.add(knob);

        wireCatalogHingedDoor(registry, {
          parent: root,
          door: doorGroup,
          hingeOffset: [sign * (openW * 0.5 - 0.01), 0, 0],
          axis: 'y',
          openAngle: sign < 0 ? -Math.PI * 0.58 : Math.PI * 0.58,
          label: 'Open Cupboard Door',
        });
      }

      cursorX += bayOuterW;
    }
  }

  // Wall/tall ogee cornice if wall or tall run
  if (elevation === 'wall' || elevation === 'tall') {
    const cornH = 0.046;
    addNamedBox(
      root,
      `${namePrefix}.crownCornice`,
      totalW + 0.056,
      cornH,
      depthM + 0.028,
      0,
      carcassH + cornH * 0.5,
      0.014,
      paintMat
    );
  }

  // Worktop + upstand (30 mm bullnose Honed Carrara Marble OR 40 mm solid Pale European Oak + 75 mm oak upstand)
  if (includeWorktop) {
    const wtMat = worktopKind === 'paleOak' ? getPaleEuropeanOakJoineryMaterial() : carraraMat;
    const overhangFront = 0.024;
    const overhangSide = 0.016;
    const slabW = totalW + overhangSide * 2;
    const slabD = depthM + overhangFront;
    const slabY = carcassH + worktopH * 0.5;
    const slabZ = overhangFront * 0.5;
    if (worktopKind === 'paleOak') {
      const geo = prepGeo(
        applyMetricBoxUVs(new THREE.BoxGeometry(slabW - 0.008, worktopH, slabD), {
          tileW: 0.9,
          tileH: 0.9,
          topTileV: 0.9,
        })
      );
      const wtMesh = new THREE.Mesh(geo, wtMat);
      wtMesh.name = `${namePrefix}.paleOakWorktop`;
      wtMesh.position.set(0, slabY, slabZ);
      wtMesh.castShadow = true;
      wtMesh.receiveShadow = true;
      root.add(wtMesh);
    } else {
      addNamedBox(
        root,
        `${namePrefix}.carraraWorktop`,
        slabW - 0.016,
        worktopH,
        slabD - 0.015,
        0,
        slabY,
        slabZ - 0.0075,
        wtMat
      );
      const bullnose = addNamedCyl(
        root,
        `${namePrefix}.carraraBullnoseFront`,
        worktopH * 0.5 - 0.0006,
        worktopH * 0.5 - 0.0006,
        slabW - 0.018,
        14,
        0,
        slabY,
        depthM * 0.5 + overhangFront - worktopH * 0.5,
        wtMat,
        true
      );
      bullnose.rotation.z = Math.PI * 0.5;
    }

    if (includeUpstand) {
      const upH = worktopKind === 'paleOak' ? 0.075 : 0.09;
      const upT = 0.02;
      const upW = slabW - (worktopKind === 'paleOak' ? 0.008 : 0.016);
      const upY = carcassH + worktopH + upH * 0.5 + 0.0005;
      const upZ = -depthM * 0.5 + upT * 0.5;
      if (worktopKind === 'paleOak') {
        const upGeo = prepGeo(
          applyMetricBoxUVs(new THREE.BoxGeometry(upW, upH, upT), {
            tileW: 0.9,
            tileH: 0.9,
            topTileV: 0.9,
          })
        );
        const upMesh = new THREE.Mesh(upGeo, wtMat);
        upMesh.name = `${namePrefix}.paleOakUpstand`;
        upMesh.position.set(0, upY, upZ);
        upMesh.castShadow = true;
        upMesh.receiveShadow = true;
        root.add(upMesh);
      } else {
        addNamedBox(
          root,
          `${namePrefix}.carraraUpstand`,
          upW,
          upH,
          upT,
          0,
          upY,
          upZ,
          wtMat
        );
      }
    }
  }

  const hwCode = resolveBrasswareCode(opts.hardwareFinish, 'AB');
  const colLabel = collection === 'suffolk' ? 'Suffolk' : 'Chichester';
  const out = finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
  return attachAssetMetadata(out, {
    name: `Neptune ${colLabel} In-Frame ${elevation === 'wall' ? 'Wall' : elevation === 'tall' ? 'Tall' : 'Base'} Cabinet Run`,
    brand: 'Neptune',
    collection: colLabel,
    sku: `NEP-${colLabel.slice(0, 3).toUpperCase()}-RUN-${bays.length}B-${hwCode}`,
    finish: `Painted Timber / ${formatBrasswareFinishLabel(hwCode)}`,
    category: 'joinery',
    dimensionsMm: mmFromMetres(totalW, depthM, totalH),
    productUrl: `https://www.neptune.com/uk/kitchens/${collection}/`,
    schematicUrl: `https://www.neptune.com/uk/kitchens/${collection}/design-specification.pdf`,
  });
}

export interface NeptuneLarderPantryOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  /** Paint colour (default Neptune *Shingle* `#D5D4CA`). */
  readonly paintColor?: THREE.ColorRepresentation;
  readonly widthM?: number;
  readonly depthM?: number;
  readonly heightM?: number;
  /** Coordinated metal hardware finish for knobs, cup pulls & hinges (defaults to Aged Brass). */
  readonly hardwareFinish?: BrasswareFinishCode;
}

/**
 * `1200 x 650 x 2220 mm` Neptune *Suffolk/Chichester* double larder pantry:
 * linked interactive double doors (`±105°`) with 3-tier solid-oak spice racks on both door backs,
 * `30 mm` Honed Carrara cold-shelf at `H 885 mm` (`D 460 mm`), 4 oak dovetail drawers,
 * 2 Kubu wicker veg baskets, upper oak shelves stocked with Kilner jars, ogee crown cornice & warm `2700K` LED strip.
 */
export function buildNeptuneLarderPantry(
  ctx: CatalogInteractionContext = null,
  opts: NeptuneLarderPantryOptions = {}
): THREE.Group {
  const namePrefix = opts.name ?? 'neptuneLarderPantry';
  const w = opts.widthM ?? 1.2;
  const d = opts.depthM ?? 0.65;
  const h = opts.heightM ?? 2.22;
  const paintMat = getPaintedJoineryMaterial(
    opts.paintColor ?? 0xd5d4ca,
    0.52,
    `${namePrefix}.paint`
  );
  const oakMat = getCharacterOakMaterial();
  const carraraMat = getHonedCarraraCatalogMaterial();
  const glassMat = getClearArchitecturalGlassMaterial();
  const brassMat = getAgedBrassMaterial();
  const ledMat = getWarm2700kLedMaterial();
  const kubuMaps = getWovenFabricMaps('larder-kubu', 0x9b8367, 'kubu');
  const kubuMat = new THREE.MeshStandardMaterial({
    name: `${namePrefix}.kubuWicker`,
    map: kubuMaps.colorMap,
    normalMap: kubuMaps.normalMap,
    roughnessMap: kubuMaps.roughnessMap,
    roughness: 0.84,
  });

  const registry = resolveRegistry(ctx);
  const root = new THREE.Group();
  root.name = namePrefix;

  const plinthH = 0.11;
  const crownH = 0.068;
  const bodyH = h - crownH;
  const wallT = 0.024;
  const frameT = 0.026;
  const stileW = 0.036;
  const frontZ = d * 0.5;

  // Ogee skirting plinth
  addNamedBox(
    root,
    `${namePrefix}.plinthFront`,
    w + 0.012,
    plinthH,
    0.02,
    0,
    plinthH * 0.5,
    frontZ - 0.008,
    paintMat
  );
  for (const [sTag, sx] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    addNamedBox(
      root,
      `${namePrefix}.plinthReturn${sTag}`,
      0.018,
      plinthH,
      d - 0.03,
      sx * (w * 0.5 - 0.003),
      plinthH * 0.5,
      -0.012,
      paintMat
    );
  }

  // Outer carcass shell (disjoint panels, non-overlapping)
  const sideD = d - frameT;
  const sideZ = -frameT * 0.5;
  const cavBotY = plinthH;
  const cavH = bodyH - cavBotY;
  const cavMidY = cavBotY + cavH * 0.5;
  const innerW = w - wallT * 2;

  for (const [sTag, sx] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    addNamedBox(
      root,
      `${namePrefix}.carcassCheek${sTag}`,
      wallT * 0.65,
      cavH,
      sideD,
      sx * (w * 0.5 - wallT * 0.325),
      cavMidY,
      sideZ,
      paintMat
    );
    addNamedBox(
      root,
      `${namePrefix}.oakLining${sTag}`,
      wallT * 0.35,
      cavH - wallT * 2,
      sideD - wallT,
      sx * (w * 0.5 - wallT * 0.825),
      cavMidY,
      sideZ + wallT * 0.5,
      oakMat
    );
  }

  // Back T&G oak-lined panel + exterior back
  addNamedBox(
    root,
    `${namePrefix}.carcassBack`,
    innerW,
    cavH,
    wallT * 0.6,
    0,
    cavMidY,
    -d * 0.5 + wallT * 0.3,
    paintMat
  );
  addNamedBox(
    root,
    `${namePrefix}.oakBackLining`,
    innerW,
    cavH - wallT * 2,
    wallT * 0.4,
    0,
    cavMidY,
    -d * 0.5 + wallT * 0.8,
    oakMat
  );
  addNamedBox(
    root,
    `${namePrefix}.carcassFloor`,
    innerW,
    wallT,
    sideD - wallT,
    0,
    cavBotY + wallT * 0.5,
    sideZ + wallT * 0.5,
    oakMat
  );
  addNamedBox(
    root,
    `${namePrefix}.carcassCeiling`,
    innerW,
    wallT,
    sideD - wallT,
    0,
    bodyH - wallT * 0.5,
    sideZ + wallT * 0.5,
    oakMat
  );

  // Warm 2700K concealed vertical + header LED strip inside front frame
  addNamedBox(
    root,
    `${namePrefix}.ledHeaderStrip`,
    innerW - 0.08,
    0.006,
    0.012,
    0,
    bodyH - wallT - 0.004,
    frontZ - frameT - 0.025,
    ledMat,
    true
  );

  // Cock-beaded front face-frame
  const openW = w - stileW * 2;
  const openH = cavH - stileW * 2;
  const openCy = cavBotY + stileW + openH * 0.5;
  const frameZ = frontZ - frameT * 0.5;

  addNamedBox(
    root,
    `${namePrefix}.frameStileLeft`,
    stileW,
    cavH,
    frameT,
    -(w * 0.5 - stileW * 0.5),
    cavMidY,
    frameZ,
    paintMat
  );
  addNamedBox(
    root,
    `${namePrefix}.frameStileRight`,
    stileW,
    cavH,
    frameT,
    w * 0.5 - stileW * 0.5,
    cavMidY,
    frameZ,
    paintMat
  );
  addNamedBox(
    root,
    `${namePrefix}.frameRailTop`,
    openW,
    stileW,
    frameT,
    0,
    bodyH - stileW * 0.5,
    frameZ,
    paintMat
  );
  addNamedBox(
    root,
    `${namePrefix}.frameRailBottom`,
    openW,
    stileW,
    frameT,
    0,
    cavBotY + stileW * 0.5,
    frameZ,
    paintMat
  );
  addCockBeadApertureTrim(root, `${namePrefix}.cockBead`, 0, openCy, frontZ, openW, openH, paintMat);

  // Stepped ogee crown cornice at top
  addNamedBox(
    root,
    `${namePrefix}.crownFrieze`,
    w + 0.028,
    crownH * 0.52,
    d + 0.016,
    0,
    bodyH + crownH * 0.26,
    0.008,
    paintMat
  );
  addNamedBox(
    root,
    `${namePrefix}.crownOgeeCap`,
    w + 0.068,
    crownH * 0.48,
    d + 0.042,
    0,
    bodyH + crownH * 0.76,
    0.021,
    paintMat
  );

  // Interior joinery: 30 mm Honed Carrara cold-shelf at H 885 mm (D 460 mm from back)
  const coldShelfY = 0.885;
  const coldShelfD = Math.min(0.46, d - wallT - 0.16);
  const backInnerZ = -d * 0.5 + wallT + 0.002;
  const coldShelfZ = backInnerZ + coldShelfD * 0.5;
  addNamedBox(
    root,
    `${namePrefix}.carraraColdShelf`,
    innerW - 0.004,
    0.03,
    coldShelfD,
    0,
    coldShelfY - 0.015,
    coldShelfZ,
    carraraMat
  );

  // Center oak divider below the Carrara cold-shelf separating 2x2 oak dovetail drawers & 2 Kubu baskets
  const lowerTopY = coldShelfY - 0.031;
  const lowerBotY = cavBotY + wallT + 0.001;
  const lowerH = lowerTopY - lowerBotY;
  addNamedBox(
    root,
    `${namePrefix}.lowerDivider`,
    0.02,
    lowerH,
    coldShelfD - 0.01,
    0,
    lowerBotY + lowerH * 0.5,
    coldShelfZ - 0.003,
    oakMat
  );

  const colW = (innerW - 0.028) * 0.5;
  const basketRowTopY = lowerBotY + lowerH * 0.36;
  // Mid shelf above Kubu wicker veg baskets
  for (const [cTag, cx] of [
    ['Left', -(colW * 0.5 + 0.012)],
    ['Right', colW * 0.5 + 0.012],
  ] as const) {
    addNamedBox(
      root,
      `${namePrefix}.lowerShelf${cTag}`,
      colW,
      0.018,
      coldShelfD - 0.012,
      cx,
      basketRowTopY,
      coldShelfZ - 0.004,
      oakMat
    );

    // Kubu wicker veg basket on bottom tier
    const bH = basketRowTopY - lowerBotY - 0.024;
    addNamedBox(
      root,
      `${namePrefix}.kubuVegBasket${cTag}`,
      colW - 0.036,
      bH,
      coldShelfD - 0.05,
      cx,
      lowerBotY + bH * 0.5 + 0.004,
      coldShelfZ,
      kubuMat
    );

    // 2 oak dovetail drawers per column above the wicker baskets (total 4 drawers)
    const drAreaBot = basketRowTopY + 0.012;
    const drAreaH = lowerTopY - drAreaBot - 0.008;
    const singleDrH = (drAreaH - 0.012) * 0.5;
    for (let r = 0; r < 2; r++) {
      const drCy = drAreaBot + singleDrH * 0.5 + r * (singleDrH + 0.012);
      const drFrontZ = backInnerZ + coldShelfD - 0.014;
      const drGroup = new THREE.Group();
      drGroup.name = `${namePrefix}.oakDrawer_${cTag}_${r + 1}`;
      drGroup.position.set(cx, drCy, drFrontZ);
      root.add(drGroup);

      addNamedBox(
        drGroup,
        `${drGroup.name}.front`,
        colW - 0.012,
        singleDrH - 0.006,
        0.02,
        0,
        0,
        0,
        oakMat
      );
      // Routed scallop hand-pull notch crest + brass label frame
      const pull = applyNeptuneHardwareFinish(buildAgedBrassBarlowCupPull(`${drGroup.name}.pull`), opts.hardwareFinish);
      pull.position.set(0, 0, 0.011);
      drGroup.add(pull);

      attachDrawerBoxBehindFront(
        drGroup,
        colW - 0.024,
        singleDrH - 0.01,
        coldShelfD - 0.06,
        '+z',
        false
      );
      wireCatalogSlidingDrawer(registry, {
        drawer: drGroup,
        slideDelta: [0, 0, 0.28],
        label: 'Open Oak Larder Drawer',
      });
    }
  }

  // Upper 3 solid-oak shelves stocked with glass Kilner preserve/grain jars
  const shelfHeights = [1.22, 1.56, 1.88];
  const shelfD = Math.min(0.4, coldShelfD - 0.05);
  const shelfZ = backInnerZ + shelfD * 0.5;
  const grainMat = getPaintedJoineryMaterial(0xd7be93, 0.72, `${namePrefix}.oats`);
  const pastaMat = getPaintedJoineryMaterial(0xdfb15b, 0.65, `${namePrefix}.pasta`);

  shelfHeights.forEach((sy, sIdx) => {
    if (sy >= bodyH - 0.14) return;
    addNamedBox(
      root,
      `${namePrefix}.upperOakShelf_${sIdx + 1}`,
      innerW - 0.004,
      0.022,
      shelfD,
      0,
      sy,
      shelfZ,
      oakMat
    );
    const jarTopBaseY = sy + 0.011;
    for (let j = 0; j < 5; j++) {
      const jx = -innerW * 0.36 + j * (innerW * 0.18);
      const jH = 0.14 + (j % 2) * 0.04;
      addNamedCyl(
        root,
        `${namePrefix}.kilnerJar_${sIdx + 1}_${j + 1}`,
        0.046,
        0.046,
        jH,
        12,
        jx,
        jarTopBaseY + jH * 0.5 + 0.001,
        shelfZ + 0.02,
        glassMat,
        true
      );
      addNamedCyl(
        root,
        `${namePrefix}.kilnerContents_${sIdx + 1}_${j + 1}`,
        0.041,
        0.041,
        jH * 0.68,
        10,
        jx,
        jarTopBaseY + jH * 0.34 + 0.003,
        shelfZ + 0.02,
        j % 2 === 0 ? grainMat : pastaMat,
        true
      );
      addNamedCyl(
        root,
        `${namePrefix}.kilnerClipLid_${sIdx + 1}_${j + 1}`,
        0.048,
        0.048,
        0.014,
        12,
        jx,
        jarTopBaseY + jH + 0.008,
        shelfZ + 0.02,
        brassMat,
        true
      );
    }
  });

  // Linked interactive double doors (±105° = ±1.8326 rad) with 3-tier oak spice racks on door backs (D 115 mm)
  const doorThick = 0.024;
  const leafW = (openW - 0.012) * 0.5;
  const leafH = openH - 0.008;
  const doorZ = frontZ - doorThick * 0.5 - 0.001;
  let leftDoorPivot: THREE.Object3D | null = null;
  let rightDoorPivot: THREE.Object3D | null = null;

  for (const [sideTag, sign] of [
    ['leftDoor', -1],
    ['rightDoor', 1],
  ] as const) {
    const leafCx = sign * (leafW * 0.5 + 0.002);
    const doorGroup = new THREE.Group();
    doorGroup.name = `${namePrefix}.${sideTag}`;
    doorGroup.position.set(leafCx, openCy, doorZ);
    root.add(doorGroup);

    // 2-panel tall Shaker door (lower field + upper field separated by mid rail)
    doorGroup.add(
      buildShakerDoorAssembly(`${doorGroup.name}.panel`, leafW, leafH, doorThick, paintMat, 0.056)
    );
    addNamedBox(
      doorGroup,
      `${doorGroup.name}.midRail`,
      leafW - 0.114,
      0.056,
      doorThick + 0.001,
      0,
      -0.14,
      0,
      paintMat
    );

    const knob = applyNeptuneHardwareFinish(buildAgedBrassMushroomKnob(`${doorGroup.name}.knob`), opts.hardwareFinish);
    knob.position.set(-sign * (leafW * 0.5 - 0.034), -0.14, doorThick * 0.5 + 0.001);
    doorGroup.add(knob);

    // 3-tier solid-oak spice/jar rack on door back (D 115 mm)
    const rackD = 0.115;
    const rackW = leafW - 0.11;
    const rackBackZ = -doorThick * 0.5 - rackD * 0.5 - 0.002;
    const rackLevels = [-0.02, 0.28, 0.58];
    rackLevels.forEach((ry, rIdx) => {
      addNamedBox(
        doorGroup,
        `${doorGroup.name}.spiceRackBase_${rIdx + 1}`,
        rackW,
        0.014,
        rackD,
        0,
        ry,
        rackBackZ,
        oakMat,
        true
      );
      addNamedBox(
        doorGroup,
        `${doorGroup.name}.spiceRackGuardBar_${rIdx + 1}`,
        rackW,
        0.014,
        0.012,
        0,
        ry + 0.052,
        -doorThick * 0.5 - rackD + 0.006,
        oakMat,
        true
      );
      for (const [cSide, csx] of [
        ['L', -1],
        ['R', 1],
      ] as const) {
        addNamedBox(
          doorGroup,
          `${doorGroup.name}.spiceRackCheek_${rIdx + 1}_${cSide}`,
          0.014,
          0.072,
          rackD - 0.016,
          csx * (rackW * 0.5 - 0.007),
          ry + 0.044,
          rackBackZ + 0.004,
          oakMat,
          true
        );
      }

      // Stocked glass spice jars
      for (let sj = 0; sj < 4; sj++) {
        const sjx = -rackW * 0.34 + sj * (rackW * 0.225);
        addNamedCyl(
          doorGroup,
          `${doorGroup.name}.spiceJar_${rIdx + 1}_${sj + 1}`,
          0.022,
          0.022,
          0.088,
          10,
          sjx,
          ry + 0.052,
          rackBackZ,
          glassMat,
          true
        );
        addNamedCyl(
          doorGroup,
          `${doorGroup.name}.spiceLid_${rIdx + 1}_${sj + 1}`,
          0.023,
          0.023,
          0.012,
          10,
          sjx,
          ry + 0.102,
          rackBackZ,
          brassMat,
          true
        );
      }
    });

    const openAngleRad = (105 * Math.PI) / 180;
    const pivot = wireCatalogHingedDoor(registry, {
      parent: root,
      door: doorGroup,
      hingeOffset: [sign * (leafW * 0.5 - 0.01), 0, 0],
      axis: 'y',
      openAngle: sign < 0 ? -openAngleRad : openAngleRad,
      label: 'Open Double Larder Doors',
      linkGroup: 'larderDoubleDoors',
    });
    if (sign < 0) leftDoorPivot = pivot;
    else rightDoorPivot = pivot;
  }

  if (registry && leftDoorPivot && rightDoorPivot) {
    registry.linkDoorPair(leftDoorPivot, rightDoorPivot);
  }

  const hwCode = resolveBrasswareCode(opts.hardwareFinish, 'AB');
  const out = finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
  return attachAssetMetadata(out, {
    name: 'Neptune Chichester Double Larder Pantry',
    brand: 'Neptune',
    collection: 'Chichester',
    sku: `NEP-CHI-LRD-1200-${hwCode}`,
    finish: `Shingle Painted Timber, Character Oak & Honed Carrara / ${formatBrasswareFinishLabel(hwCode)}`,
    category: 'joinery',
    dimensionsMm: mmFromMetres(w, d, h),
    productUrl: 'https://www.neptune.com/uk/products/chichester-grand-larder/',
    schematicUrl: 'https://www.neptune.com/uk/products/chichester-grand-larder/specification.pdf',
  });
}

export interface NeptuneMantleCanopyHoodOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  readonly paintColor?: THREE.ColorRepresentation;
  readonly widthM?: number;
  readonly depthM?: number;
  readonly heightM?: number;
  /** Include 1000 x 750 mm handmade Moroccan Zellige splashback below the canopy (`y = -0.75..0`). Default `true`. */
  readonly includeZelligeSplashback?: boolean;
  /** Include Neptune *Ellington* 800 mm Aged Brass utensil rail w/ hanging copper & stainless pans. Default `true`. */
  readonly includeUtensilRail?: boolean;
  /** Coordinated metal finish for utensil rail & downlight bezels (defaults to Aged Brass). */
  readonly hardwareFinish?: BrasswareFinishCode;
}

/**
 * `1400 x 440 x 850 mm` Neptune painted *Shingle* in-frame panelled canopy hood breast
 * flanked by moulded corbel cheeks (`170 x 380 x 320 mm`), breakfront mantle shelf, ogee cornice,
 * concealed stainless baffle extractor + twin `2700K` hob downlights, optional `1000 x 750 mm`
 * Moroccan Zellige splashback (`#ECE8DF`) and *Ellington* `800 mm` Aged Brass utensil rail.
 * Local origin `(0, 0, 0)` sits at the rear wall plane (`z = 0`, projecting `+Z`) and bottom of canopy breast (`y = 0`).
 */
export function buildNeptuneMantleCanopyHood(
  opts: NeptuneMantleCanopyHoodOptions = {}
): THREE.Group {
  const namePrefix = opts.name ?? 'neptuneMantleCanopyHood';
  const w = opts.widthM ?? 1.4;
  const d = opts.depthM ?? 0.44;
  const h = opts.heightM ?? 0.85;
  const paintMat = getPaintedJoineryMaterial(
    opts.paintColor ?? 0xd5d4ca,
    0.52,
    `${namePrefix}.paint`
  );
  const stainlessMat = getBrushedStainlessCatalogMaterial();
  const brassMat = opts.hardwareFinish ? getBathroomBrassMaterials(opts.hardwareFinish).primary : getAgedBrassMaterial();
  const copperMat = getBurnishedCopperCatalogMaterial();
  const ledMat = getWarm2700kLedMaterial();

  const root = new THREE.Group();
  root.name = namePrefix;

  const corbelW = 0.17;
  const corbelD = Math.min(0.38, d - 0.04);
  const corbelH = 0.32;
  const breastW = w - corbelW * 2;
  const shelfY = corbelH;
  const shelfH = 0.044;
  const upperH = h - shelfY - shelfH - 0.056;

  // Flanked moulded corbel cheeks (`170 x 380 x 320 mm`, y = 0..0.32)
  for (const [sideTag, sign] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    const cx = sign * (w * 0.5 - corbelW * 0.5);
    addNamedBox(
      root,
      `${namePrefix}.corbelCheek${sideTag}`,
      corbelW,
      corbelH,
      corbelD,
      cx,
      corbelH * 0.5,
      corbelD * 0.5,
      paintMat
    );
    // Stepped ogee corbel scroll bracket under front nose
    addNamedBox(
      root,
      `${namePrefix}.corbelScroll${sideTag}`,
      corbelW - 0.028,
      corbelH * 0.58,
      0.036,
      cx,
      corbelH * 0.65,
      corbelD + 0.018,
      paintMat
    );
  }

  // Central extractor hood box strictly between corbel cheeks (`y = 0.16..0.32`) so tall pots clear underneath
  const hoodUnderY = 0.14;
  const hoodBoxH = shelfY - hoodUnderY;
  addNamedBox(
    root,
    `${namePrefix}.extractorSoffitBox`,
    breastW,
    hoodBoxH,
    d - 0.02,
    0,
    hoodUnderY + hoodBoxH * 0.5,
    (d - 0.02) * 0.5,
    paintMat
  );

  // Concealed stainless-steel commercial baffle filter cassette + twin 2700K hob downlights on underside
  addNamedBox(
    root,
    `${namePrefix}.extractorBaffleCassette`,
    breastW * 0.68,
    0.012,
    d * 0.56,
    0,
    hoodUnderY - 0.007,
    d * 0.48,
    stainlessMat,
    true
  );
  for (let b = -3; b <= 3; b++) {
    addNamedBox(
      root,
      `${namePrefix}.baffleLouver_${b + 4}`,
      breastW * 0.62,
      0.005,
      0.018,
      0,
      hoodUnderY - 0.016,
      d * 0.48 + b * 0.028,
      stainlessMat,
      true
    );
  }
  for (const [lTag, lx] of [
    ['Left', -breastW * 0.38],
    ['Right', breastW * 0.38],
  ] as const) {
    addNamedCyl(
      root,
      `${namePrefix}.hobDownlightBezel${lTag}`,
      0.034,
      0.034,
      0.006,
      16,
      lx,
      hoodUnderY - 0.004,
      d * 0.5,
      brassMat,
      true
    );
    addNamedCyl(
      root,
      `${namePrefix}.hobDownlightLens${lTag}`,
      0.024,
      0.024,
      0.004,
      16,
      lx,
      hoodUnderY - 0.009,
      d * 0.5,
      ledMat,
      true
    );
  }

  // Breakfront mantle shelf (`y = shelfY .. shelfY + shelfH`)
  addNamedBox(
    root,
    `${namePrefix}.breakfrontMantleShelf`,
    w + 0.056,
    shelfH,
    d + 0.038,
    0,
    shelfY + shelfH * 0.5,
    (d + 0.038) * 0.5,
    paintMat
  );

  // Upper in-frame panelled chimney breast (`y = shelfY + shelfH .. h - 0.056`)
  const breastBaseY = shelfY + shelfH;
  const breastD = d - 0.024;
  addNamedBox(
    root,
    `${namePrefix}.chimneyBreastCarcass`,
    w - 0.04,
    upperH,
    breastD - 0.024,
    0,
    breastBaseY + upperH * 0.5,
    (breastD - 0.024) * 0.5,
    paintMat
  );
  // Twin Shaker front field panels proud of the carcass front (non-coplanar!)
  const panelPanelW = (w - 0.14) * 0.5;
  for (const [pTag, px] of [
    ['Left', -(panelPanelW * 0.5 + 0.018)],
    ['Right', panelPanelW * 0.5 + 0.018],
  ] as const) {
    const shaker = buildShakerDoorAssembly(
      `${namePrefix}.breastFieldPanel${pTag}`,
      panelPanelW,
      upperH - 0.048,
      0.02,
      paintMat,
      0.048
    );
    shaker.position.set(px, breastBaseY + upperH * 0.5, breastD - 0.012);
    root.add(shaker);
  }

  // Top ogee cornice
  const cornY = breastBaseY + upperH;
  addNamedBox(
    root,
    `${namePrefix}.ogeeCornice`,
    w + 0.064,
    0.056,
    d + 0.04,
    0,
    cornY + 0.028,
    (d + 0.04) * 0.5,
    paintMat
  );

  // Optional 1000 x 750 mm Moroccan Zellige splashback + Ellington 800 mm Aged Brass utensil rail
  if (opts.includeZelligeSplashback ?? true) {
    const zMaps = getZelligeTileMaps();
    const zelligeMat = new THREE.MeshStandardMaterial({
      name: `${namePrefix}.moroccanZellige`,
      map: zMaps.colorMap,
      normalMap: zMaps.normalMap,
      normalScale: new THREE.Vector2(0.45, 0.45),
      roughnessMap: zMaps.roughnessMap,
      roughness: 0.18,
      metalness: 0.02,
    });
    addNamedBox(
      root,
      `${namePrefix}.zelligeSplashback`,
      1.0,
      0.75,
      0.012,
      0,
      -0.375,
      0.006,
      zelligeMat
    );
  }

  if (opts.includeUtensilRail ?? true) {
    const railW = 0.8;
    const railY = -0.22;
    const railZ = 0.052;
    const bar = addNamedCyl(
      root,
      `${namePrefix}.ellingtonRailBar`,
      0.007,
      0.007,
      railW,
      12,
      0,
      railY,
      railZ,
      brassMat,
      true
    );
    bar.rotation.z = Math.PI * 0.5;

    for (const [bTag, bx] of [
      ['Left', -railW * 0.44],
      ['Right', railW * 0.44],
    ] as const) {
      const rose = addNamedCyl(
        root,
        `${namePrefix}.ellingtonRose${bTag}`,
        0.02,
        0.02,
        0.008,
        14,
        bx,
        railY,
        0.016,
        brassMat,
        true
      );
      rose.rotation.x = Math.PI * 0.5;
      const arm = addNamedCyl(
        root,
        `${namePrefix}.ellingtonArm${bTag}`,
        0.006,
        0.006,
        0.036,
        10,
        bx,
        railY,
        0.034,
        brassMat,
        true
      );
      arm.rotation.x = Math.PI * 0.5;
    }

    // Hanging copper sauteuse pan, stainless ladle & slotted turner on S-hooks
    const hookXs = [-0.24, -0.04, 0.16, 0.28];
    hookXs.forEach((hx, idx) => {
      addNamedCyl(
        root,
        `${namePrefix}.utensilHook_${idx + 1}`,
        0.0025,
        0.0025,
        0.042,
        8,
        hx,
        railY - 0.022,
        railZ,
        brassMat,
        true
      );
    });
    // Hanging copper pan
    const copperPan = addNamedCyl(
      root,
      `${namePrefix}.hangingCopperPanBody`,
      0.095,
      0.09,
      0.044,
      18,
      -0.24,
      railY - 0.185,
      railZ + 0.008,
      copperMat,
      true
    );
    copperPan.rotation.x = Math.PI * 0.5;
    addNamedCyl(
      root,
      `${namePrefix}.hangingCopperPanHandle`,
      0.006,
      0.005,
      0.135,
      10,
      -0.24,
      railY - 0.095,
      railZ + 0.008,
      brassMat,
      true
    );
    // Stainless ladle & spatula
    addNamedCyl(
      root,
      `${namePrefix}.hangingLadleStem`,
      0.0035,
      0.0035,
      0.19,
      8,
      -0.04,
      railY - 0.135,
      railZ + 0.004,
      stainlessMat,
      true
    );
    const ladleCup = new THREE.Mesh(
      sharedSphereGeometry(0.034, 12, 8, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5),
      stainlessMat
    );
    ladleCup.name = `${namePrefix}.hangingLadleBowl`;
    ladleCup.position.set(-0.04, railY - 0.23, railZ + 0.022);
    tagHighLod(ladleCup);
    root.add(ladleCup);

    addNamedCyl(
      root,
      `${namePrefix}.hangingTurnerStem`,
      0.0035,
      0.0035,
      0.18,
      8,
      0.16,
      railY - 0.13,
      railZ + 0.004,
      stainlessMat,
      true
    );
    addNamedBox(
      root,
      `${namePrefix}.hangingTurnerBlade`,
      0.062,
      0.085,
      0.003,
      0.16,
      railY - 0.245,
      railZ + 0.006,
      stainlessMat,
      true
    );
  }

  const hwCode = resolveBrasswareCode(opts.hardwareFinish, 'AB');
  const out = finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
  return attachAssetMetadata(out, {
    name: 'Neptune Chichester Mantle Canopy Extractor Hood',
    brand: 'Neptune',
    collection: 'Chichester',
    sku: `NEP-CHI-MCH-1400-${hwCode}`,
    finish: `Shingle Painted Timber / ${formatBrasswareFinishLabel(hwCode)}`,
    category: 'joinery',
    dimensionsMm: mmFromMetres(w, d, h),
    productUrl: 'https://www.neptune.com/uk/kitchens/chichester/',
    schematicUrl: 'https://www.neptune.com/uk/kitchens/chichester/canopy-hood-spec.pdf',
  });
}

export interface ShawsBelfastSinkAndBridgeTapOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  /** Include surrounding worktop deck wings w/ routed drainer grooves left & right (`W 1.80 m`). Default `true`. */
  readonly includeCarraraDrainerDeck?: boolean;
  /** Surrounding drainer/tap deck material (`'carrara'` default or `'paleOak'` 40 mm solid European oak). */
  readonly worktopMaterial?: 'carrara' | 'paleOak';
  /** Include side brass rinse spray next to the Perrin & Rowe bridge mixer. Default `true`. */
  readonly includeRinseSpray?: boolean;
  /** Metal finish code across all 9 finishes for basket strainer wastes, overflows & default tap (defaults to Aged Brass). */
  readonly finish?: BrasswareFinishCode;
  /** Optional override finish specifically for the twin `90 mm` basket strainer wastes & overflows. */
  readonly wasteFinish?: BrasswareFinishCode;
  /** Composable kitchen tap slot (`PerrinRoweKitchenTapSpec`, custom `THREE.Object3D`, `'default'`, or `'none'`). */
  readonly tap?: KitchenTapSlotValue;
}

/**
 * `795 x 465 x 229 mm` Shaws *Classic Double 800* heavy fireclay apron sink (`#F6F5F0`, `38 mm` rim walls,
 * central lowered weir divider, twin `90 mm` Aged Brass basket strainer wastes), optional Honed Carrara
 * drainer deck w/ routed grooves left & right, and **Perrin & Rowe *Phoenician 4471* Aged Brass bridge mixer**
 * (`200 mm` centres, white porcelain levers, swan-neck spout) + side brass rinse spray.
 * Local origin `(0, 0, 0)` is at the underside of the sink (`y = 0`), centered in X and Z, apron facing `+Z`.
 */
export function buildShawsBelfastSinkAndBridgeTap(
  opts: ShawsBelfastSinkAndBridgeTapOptions = {}
): THREE.Group {
  const namePrefix = opts.name ?? 'shawsBelfastSink';
  const fireclayMat = getHeavyFireclayMaterial();
  const finishPal = opts.finish ? getBathroomBrassMaterials(opts.finish) : null;
  const wastePal = opts.wasteFinish ? getBathroomBrassMaterials(opts.wasteFinish) : finishPal;
  const brassMat = finishPal ? finishPal.primary : getAgedBrassMaterial();
  const darkBrassMat = finishPal ? finishPal.darkShadow : getDarkAntiquedBrassMaterial();
  const wasteBrassMat = wastePal ? wastePal.primary : brassMat;
  const wasteDarkMat = wastePal ? wastePal.darkShadow : darkBrassMat;
  const porcelainMat = getVitreousPorcelainLeverMaterial();
  const deckIsOak = opts.worktopMaterial === 'paleOak';
  const carraraMat = deckIsOak ? getPaleEuropeanOakJoineryMaterial() : getHonedCarraraCatalogMaterial();

  const root = new THREE.Group();
  root.name = namePrefix;

  const sinkW = 0.795;
  const sinkD = 0.465;
  const sinkH = 0.229;
  const wallT = 0.038;
  const baseT = 0.028;

  // Disjoint fireclay basin walls & floor (0 overlapping boxes!)
  addNamedBox(
    root,
    `${namePrefix}.fireclayBase`,
    sinkW,
    baseT,
    sinkD,
    0,
    baseT * 0.5,
    0,
    fireclayMat
  );
  const wallH = sinkH - baseT;
  const wallCy = baseT + wallH * 0.5;

  // Exposed front fluted/crowned apron wall (+Z)
  addNamedBox(
    root,
    `${namePrefix}.apronFrontWall`,
    sinkW,
    wallH,
    wallT,
    0,
    wallCy,
    sinkD * 0.5 - wallT * 0.5,
    fireclayMat
  );
  // Rear wall (-Z)
  addNamedBox(
    root,
    `${namePrefix}.rearWall`,
    sinkW,
    wallH,
    wallT,
    0,
    wallCy,
    -(sinkD * 0.5 - wallT * 0.5),
    fireclayMat
  );
  // Left & Right side walls strictly between front and rear walls
  const innerD = sinkD - wallT * 2;
  for (const [sTag, sx] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    addNamedBox(
      root,
      `${namePrefix}.sideWall${sTag}`,
      wallT,
      wallH,
      innerD,
      sx * (sinkW * 0.5 - wallT * 0.5),
      wallCy,
      0,
      fireclayMat
    );
  }
  // Central lowered weir divider (`32 mm` thick, `34 mm` lower than outer rim)
  const weirH = wallH - 0.034;
  addNamedBox(
    root,
    `${namePrefix}.centralWeirDivider`,
    0.032,
    weirH,
    innerD,
    0,
    baseT + weirH * 0.5,
    0,
    fireclayMat
  );

  // Shaws circular blue/gold ceramic heritage stamp badge on front apron
  const stamp = addNamedCyl(
    root,
    `${namePrefix}.shawsHeritageStamp`,
    0.016,
    0.016,
    0.002,
    16,
    0,
    sinkH * 0.54,
    sinkD * 0.5 + 0.0015,
    brassMat,
    true
  );
  stamp.rotation.x = Math.PI * 0.5;

  // Twin 90 mm Aged Brass basket strainer wastes & slotted overflows
  const bowlCxOffset = (sinkW - wallT * 2 - 0.032) * 0.25 + 0.016;
  for (const [bTag, bx] of [
    ['Left', -bowlCxOffset],
    ['Right', bowlCxOffset],
  ] as const) {
    addNamedCyl(
      root,
      `${namePrefix}.basketStrainerFlange${bTag}`,
      0.045,
      0.045,
      0.003,
      20,
      bx,
      baseT + 0.002,
      -0.025,
      wasteBrassMat,
      true
    );
    addNamedCyl(
      root,
      `${namePrefix}.basketStrainerPlug${bTag}`,
      0.028,
      0.024,
      0.006,
      16,
      bx,
      baseT + 0.006,
      -0.025,
      wasteDarkMat,
      true
    );
    addNamedBox(
      root,
      `${namePrefix}.overflowGrille${bTag}`,
      0.046,
      0.022,
      0.003,
      bx,
      sinkH - 0.048,
      -(sinkD * 0.5 - wallT - 0.002),
      wasteBrassMat,
      true
    );
  }

  // Optional Honed Carrara Marble worktop surround w/ routed drainer grooves left & right + rear tap deck
  const deckTopY = sinkH + 0.03;
  const tapDeckZ = -(sinkD * 0.5 + 0.068);
  const deckTotalD = sinkD + 0.135;

  if (opts.includeCarraraDrainerDeck ?? true) {
    const wingW = 0.48;
    // Rear tap-ledge bridge behind the Belfast sink
    addNamedBox(
      root,
      `${namePrefix}.carraraRearTapDeck`,
      sinkW,
      0.03,
      0.135,
      0,
      sinkH + 0.015,
      -(sinkD * 0.5 + 0.0675),
      carraraMat
    );
    for (const [wTag, sign] of [
      ['Left', -1],
      ['Right', 1],
    ] as const) {
      const wCx = sign * (sinkW * 0.5 + wingW * 0.5);
      // Drainer wing built around 5 routed drainer grooves: upper rib slats between grooves so 0 z-fight
      addNamedBox(
        root,
        `${namePrefix}.carraraWingBase${wTag}`,
        wingW,
        0.025,
        deckTotalD,
        wCx,
        sinkH + 0.0125,
        -0.0675,
        carraraMat
      );
      // Rear strip behind drainer grooves & front strip in front of drainer grooves (top 5 mm layer)
      addNamedBox(
        root,
        `${namePrefix}.carraraWingRearTop${wTag}`,
        wingW,
        0.005,
        0.155,
        wCx,
        sinkH + 0.0275,
        -(sinkD * 0.5 + 0.0575),
        carraraMat
      );
      addNamedBox(
        root,
        `${namePrefix}.carraraWingFrontTop${wTag}`,
        wingW,
        0.005,
        0.06,
        wCx,
        sinkH + 0.0275,
        sinkD * 0.5 - 0.03,
        carraraMat
      );
      // 6 raised flat lands creating 5 crisp 4 mm-deep routed drainer channels sloping toward sink
      const grooveZoneD = deckTotalD - 0.215;
      const grooveCount = 5;
      const grooveW = 0.01;
      const landD = (grooveZoneD - grooveCount * grooveW) / (grooveCount + 1);
      let gzCursor = -(sinkD * 0.5 - 0.02) + landD * 0.5;
      for (let g = 0; g <= grooveCount; g++) {
        addNamedBox(
          root,
          `${namePrefix}.carraraDrainerLand_${wTag}_${g + 1}`,
          wingW,
          0.005,
          landD,
          wCx,
          sinkH + 0.0275,
          gzCursor,
          carraraMat,
          true
        );
        gzCursor += landD + grooveW;
      }
    }
  } else {
    // Minimal tap mounting plinth if standalone without drainer wings
    if (deckIsOak) {
      const ledgeGeo = prepGeo(
        applyMetricBoxUVs(new THREE.BoxGeometry(0.34, 0.03, 0.11), {
          tileW: 0.9,
          tileH: 0.9,
          topTileV: 0.9,
        })
      );
      const ledge = new THREE.Mesh(ledgeGeo, carraraMat);
      ledge.name = `${namePrefix}.tapMountingLedge`;
      ledge.position.set(0, sinkH + 0.015, tapDeckZ);
      ledge.castShadow = true;
      ledge.receiveShadow = true;
      root.add(ledge);
    } else {
      addNamedBox(
        root,
        `${namePrefix}.tapMountingLedge`,
        0.34,
        0.03,
        0.11,
        0,
        sinkH + 0.015,
        tapDeckZ,
        carraraMat
      );
    }
  }

  const holeCount: 0 | 1 | 3 =
    opts.tap === 'none'
      ? 0
      : opts.tap !== undefined && opts.tap !== 'default' && !isCustomTapObject3D(opts.tap)
        ? opts.tap.model === 'wall-bridge' || opts.tap.mount === 'wall-bridge' || opts.tap.mount === '2-hole-wall'
          ? 0
          : opts.tap.model === 'monobloc-swan' || opts.tap.mount === 'monobloc-deck'
            ? 1
            : 3
        : 3;

  registerTapMountAnchor(root, {
    deckPosition: [0, deckTopY, tapDeckZ],
    wallPosition: [0, deckTopY + 0.165, -(sinkD * 0.5 + 0.135)],
    wastePosition: [-bowlCxOffset, baseT + 0.002, -0.025],
    holeCount,
    rotationY: 0,
  });

  if (opts.tap === undefined || opts.tap === 'default') {
    // Perrin & Rowe *Phoenician 4471* Aged Brass Bridge Mixer (200 mm centres, white porcelain levers, swan-neck spout)
    const tapGroup = new THREE.Group();
    tapGroup.name = `${namePrefix}.phoenician4471BridgeTap`;
    tapGroup.position.set(0, deckTopY, tapDeckZ);
    root.add(tapGroup);

    const pillarHalfSpan = 0.1; // 200 mm centres
    const bridgeY = 0.105;

    for (const [pTag, sign] of [
      ['Hot', -1],
      ['Cold', 1],
    ] as const) {
      const px = sign * pillarHalfSpan;
      addNamedCyl(
        tapGroup,
        `${tapGroup.name}.deckEscutcheon${pTag}`,
        0.026,
        0.029,
        0.012,
        16,
        px,
        0.006,
        0,
        brassMat,
        true
      );
      addNamedCyl(
        tapGroup,
        `${tapGroup.name}.pillarRiser${pTag}`,
        0.012,
        0.013,
        bridgeY - 0.012,
        14,
        px,
        0.012 + (bridgeY - 0.012) * 0.5,
        0,
        brassMat,
        true
      );
      addNamedSphereUnion(
        tapGroup,
        `${tapGroup.name}.valveUnion${pTag}`,
        0.018,
        px,
        bridgeY,
        0,
        brassMat
      );
      // Valve bonnet & white porcelain tapered lever handle pointing outward
      addNamedCyl(
        tapGroup,
        `${tapGroup.name}.valveBonnet${pTag}`,
        0.011,
        0.013,
        0.034,
        14,
        px,
        bridgeY + 0.028,
        0,
        brassMat,
        true
      );
      const leverBrass = addNamedCyl(
        tapGroup,
        `${tapGroup.name}.leverStem${pTag}`,
        0.004,
        0.004,
        0.022,
        10,
        px + sign * 0.016,
        bridgeY + 0.042,
        0,
        brassMat,
        true
      );
      leverBrass.rotation.z = Math.PI * 0.5;
      const porcelainGrip = addNamedCyl(
        tapGroup,
        `${tapGroup.name}.porcelainLever${pTag}`,
        0.0075,
        0.0055,
        0.056,
        14,
        px + sign * 0.054,
        bridgeY + 0.042,
        0,
        porcelainMat,
        true
      );
      porcelainGrip.rotation.z = sign * Math.PI * 0.5;
    }

    // Horizontal bridge bar connecting the 200 mm pillars
    const bridgeBar = addNamedCyl(
      tapGroup,
      `${tapGroup.name}.horizontalBridge`,
      0.011,
      0.011,
      pillarHalfSpan * 2 - 0.024,
      14,
      0,
      bridgeY,
      0,
      brassMat,
      true
    );
    bridgeBar.rotation.z = Math.PI * 0.5;
    addNamedSphereUnion(tapGroup, `${tapGroup.name}.centerTeeBoss`, 0.02, 0, bridgeY, 0, brassMat);

    // High swan-neck swivel spout curving forward over the sink bowls (`+Z` reach 225 mm)
    const spoutCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, bridgeY + 0.015, 0),
      new THREE.Vector3(0, bridgeY + 0.165, 0.015),
      new THREE.Vector3(0, bridgeY + 0.245, 0.095),
      new THREE.Vector3(0, bridgeY + 0.225, 0.185),
      new THREE.Vector3(0, bridgeY + 0.145, 0.225),
    ]);
    const spoutGeo = new THREE.TubeGeometry(spoutCurve, 24, 0.0105, 12, false);
    const spoutMesh = new THREE.Mesh(spoutGeo, brassMat);
    spoutMesh.name = `${tapGroup.name}.swanNeckSpout`;
    spoutMesh.castShadow = true;
    tagHighLod(spoutMesh);
    tapGroup.add(spoutMesh);

    addNamedCyl(
      tapGroup,
      `${tapGroup.name}.spoutNozzleTip`,
      0.013,
      0.0115,
      0.018,
      14,
      0,
      bridgeY + 0.136,
      0.225,
      brassMat,
      true
    );

    // Optional side brass rinse spray on deck right of the bridge tap
    if (opts.includeRinseSpray ?? true) {
      const rx = 0.21;
      addNamedCyl(
        tapGroup,
        `${tapGroup.name}.rinseDeckHolder`,
        0.02,
        0.023,
        0.028,
        14,
        rx,
        0.014,
        0,
        brassMat,
        true
      );
      addNamedCyl(
        tapGroup,
        `${tapGroup.name}.rinsePorcelainGrip`,
        0.012,
        0.01,
        0.072,
        14,
        rx,
        0.064,
        0,
        porcelainMat,
        true
      );
      addNamedCyl(
        tapGroup,
        `${tapGroup.name}.rinseSprayHead`,
        0.019,
        0.013,
        0.038,
        14,
        rx,
        0.119,
        0.006,
        brassMat,
        true
      );
      const trigger = addNamedBox(
        tapGroup,
        `${tapGroup.name}.rinseTriggerLever`,
        0.005,
        0.052,
        0.012,
        rx,
        0.088,
        0.018,
        brassMat,
        true
      );
      trigger.rotation.x = -0.18;
    }

  } else if (opts.tap !== 'none') {
    if (isCustomTapObject3D(opts.tap)) {
      mountTapOnFixture(root, opts.tap);
    } else {
      const defaultFinish: BrasswareFinishCode = opts.finish ?? 'AB';
      const isWall =
        opts.tap.model === 'wall-bridge' ||
        opts.tap.mount === 'wall-bridge' ||
        opts.tap.mount === '2-hole-wall';
      const tapSpec =
        opts.tap.includeRinseSpray === undefined && opts.includeRinseSpray !== undefined
          ? { ...opts.tap, includeRinseSpray: opts.includeRinseSpray }
          : opts.tap;
      const tapObj = buildKitchenTapFromSpec(
        tapSpec,
        defaultFinish,
        `${namePrefix}.kitchenTap`
      );
      mountTapOnFixture(root, tapObj, isWall ? 'wall' : 'deck');
    }
  }

  const hwCode = resolveBrasswareCode(opts.finish, 'AB');
  const out = finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
  return attachAssetMetadata(out, {
    name: 'Shaws Classic Double 800 Fireclay Belfast Sink & Bridge Mixer',
    brand: 'Shaws of Darwen',
    collection: 'Classic Double Bowl',
    sku: `SCDB800WH-${hwCode}`,
    finish: `White Heavy Fireclay / ${formatBrasswareFinishLabel(hwCode)}`,
    category: 'sanitaryware',
    dimensionsMm: [795, 465, 229],
    productUrl: 'https://www.shawsofdarwen.com/products/classic-double-800/',
    schematicUrl: 'https://www.shawsofdarwen.com/downloads/spec-sheets/Shaws-Classic-Double-800-CAD.pdf',
  });
}

function addNamedSphereUnion(
  parent: THREE.Object3D,
  name: string,
  r: number,
  x: number,
  y: number,
  z: number,
  mat: THREE.Material
): THREE.Mesh {
  const m = new THREE.Mesh(sharedSphereGeometry(r, 14, 10), mat);
  m.name = name;
  m.position.set(x, y, z);
  m.castShadow = true;
  tagHighLod(m);
  parent.add(m);
  return m;
}

export interface NeptuneKitchenIslandOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  /** Contrast paint colour (default Neptune *Ink* `#283142`). */
  readonly paintColor?: THREE.ColorRepresentation;
  /** Overall worktop width in metres (`1.80 - 1.95`, default `1.90`). */
  readonly widthM?: number;
  /** Overall worktop depth in metres (`0.98 - 1.00`, default `0.98`). */
  readonly depthM?: number;
  /** Overall height in metres (default `0.90`). */
  readonly heightM?: number;
  /** Coordinated metal hardware finish for Barlow cup pulls, end socket & brand plate (defaults to Aged Brass). */
  readonly hardwareFinish?: BrasswareFinishCode;
}

/**
 * `1800-1950 x 980-1000 x 900 mm` contrast-painted (Neptune *Ink* `#283142` default) cock-beaded
 * *Chichester* kitchen island:
 * - `30 mm` bullnose Honed Carrara slab + inset/stepped `70 mm` end-grain European oak butcher's block (`450 mm` wide)
 * - 2-tier solid-oak cookbook/pot end-shelf under the butcher's block end (`+X`)
 * - Twin 3-drawer pan banks on the chef side (`+Z`) with Aged Brass *Barlow* cup pulls
 * - V-grooved T&G panelled breakfast-bar seating back (`-Z`) with `290 mm` overhang
 * - Aged Brass double power socket on the `-X` end cheek.
 */
export function buildNeptuneKitchenIsland(
  ctx: CatalogInteractionContext = null,
  opts: NeptuneKitchenIslandOptions = {}
): THREE.Group {
  const namePrefix = opts.name ?? 'neptuneKitchenIsland';
  const totalW = opts.widthM ?? 1.9;
  const totalD = opts.depthM ?? 0.98;
  const totalH = opts.heightM ?? 0.9;
  const paintMat = getPaintedJoineryMaterial(
    opts.paintColor ?? 0x283142,
    0.48,
    `${namePrefix}.inkPaint`
  );
  const carraraMat = getHonedCarraraCatalogMaterial();
  const oakMat = getCharacterOakMaterial();
  const endGrainMat = getEndGrainOakMaterial();
  const brassMat = getAgedBrassMaterial();
  const darkBrassMat = getDarkAntiquedBrassMaterial();
  const castIronMat = getMatteCastIronMaterial(0x9b311e); // Le Creuset Flame/Cerise pot on shelf
  const registry = resolveRegistry(ctx);

  const root = new THREE.Group();
  root.name = namePrefix;

  const overhangBack = 0.29; // Seating side (-Z)
  const overhangFront = 0.025; // Chef side (+Z)
  const overhangSide = 0.022;
  const worktopH = 0.03;
  const carcassH = totalH - worktopH; // 0.87 m
  const plinthH = 0.11;
  const carcassW = totalW - overhangSide * 2;
  const carcassD = totalD - overhangBack - overhangFront; // ~0.665 m
  const carcassCenterZ = (overhangBack - overhangFront) * 0.5; // shifted toward +Z so -Z has 290mm knee overhang
  const chefFrontZ = carcassCenterZ + carcassD * 0.5;
  const seatingBackZ = carcassCenterZ - carcassD * 0.5;

  const butcherW = 0.45;
  const drawerZoneW = carcassW - butcherW;
  const drawerZoneStartX = -carcassW * 0.5;
  const butcherCenterX = carcassW * 0.5 - butcherW * 0.5;

  // Chichester ogee skirting plinth around carcass perimeter
  addNamedBox(
    root,
    `${namePrefix}.ogeePlinthBase`,
    carcassW + 0.012,
    plinthH,
    carcassD + 0.012,
    0,
    plinthH * 0.5,
    carcassCenterZ,
    paintMat
  );

  // Corner posts (`68 x 68 mm`) framing the island
  const postS = 0.064;
  const bodyH = carcassH - plinthH;
  const bodyMidY = plinthH + bodyH * 0.5;
  const postCoords: readonly [string, number, number][] = [
    ['FrontLeft', -carcassW * 0.5 + postS * 0.5, chefFrontZ - postS * 0.5],
    ['BackLeft', -carcassW * 0.5 + postS * 0.5, seatingBackZ + postS * 0.5],
    ['FrontMid', drawerZoneStartX + drawerZoneW - postS * 0.5, chefFrontZ - postS * 0.5],
    ['BackMid', drawerZoneStartX + drawerZoneW - postS * 0.5, seatingBackZ + postS * 0.5],
    ['FrontRight', carcassW * 0.5 - postS * 0.5, chefFrontZ - postS * 0.5],
    ['BackRight', carcassW * 0.5 - postS * 0.5, seatingBackZ + postS * 0.5],
  ];
  for (const [pTag, px, pz] of postCoords) {
    addNamedBox(root, `${namePrefix}.post${pTag}`, postS, bodyH, postS, px, bodyMidY, pz, paintMat);
  }

  // Left (-X) Shaker end cheek + Aged Brass twin switched socket
  const leftEndSpanD = carcassD - postS * 2;
  const leftPanel = buildShakerDoorAssembly(
    `${namePrefix}.leftEndPanel`,
    leftEndSpanD,
    bodyH - 0.01,
    0.022,
    paintMat,
    0.052
  );
  leftPanel.rotation.y = -Math.PI * 0.5;
  leftPanel.position.set(-carcassW * 0.5 + 0.014, bodyMidY, carcassCenterZ);
  root.add(leftPanel);

  // Aged Brass 2-gang end socket on `-X` cheek
  const sockY = carcassH - 0.14;
  addNamedBox(
    root,
    `${namePrefix}.endBrassSocketPlate`,
    0.005,
    0.086,
    0.146,
    -carcassW * 0.5 - 0.0025,
    sockY,
    carcassCenterZ,
    brassMat,
    true
  );
  for (const [gTag, gz] of [
    ['Left', -0.036],
    ['Right', 0.036],
  ] as const) {
    addNamedBox(
      root,
      `${namePrefix}.socketInsert${gTag}`,
      0.002,
      0.036,
      0.044,
      -carcassW * 0.5 - 0.006,
      sockY,
      carcassCenterZ + gz,
      darkBrassMat,
      true
    );
  }

  // Seating back (-Z) V-grooved tongue-and-groove matchboard panelling + corbel brackets for 290mm overhang
  const tgBoardPitch = 0.096;
  const tgZoneW = drawerZoneW - postS * 2;
  const nBoards = Math.max(4, Math.round(tgZoneW / tgBoardPitch));
  const actualBoardW = tgZoneW / nBoards;
  const tgStartX = drawerZoneStartX + postS;
  for (let b = 0; b < nBoards; b++) {
    addNamedBox(
      root,
      `${namePrefix}.seatingTgBoard_${b + 1}`,
      actualBoardW - 0.004,
      bodyH - 0.008,
      0.018,
      tgStartX + (b + 0.5) * actualBoardW,
      bodyMidY,
      seatingBackZ + 0.014,
      paintMat
    );
  }
  // Carved breakfast-bar support corbels under the 290 mm `-Z` overhang
  for (const [cTag, cx] of [
    ['Left', -carcassW * 0.5 + postS * 0.5],
    ['Mid', drawerZoneStartX + drawerZoneW - postS * 0.5],
    ['Right', carcassW * 0.5 - postS * 0.5],
  ] as const) {
    addNamedBox(
      root,
      `${namePrefix}.overhangCorbel${cTag}`,
      0.048,
      0.19,
      0.19,
      cx,
      carcassH - 0.096,
      seatingBackZ - 0.096,
      paintMat
    );
  }

  // Twin 3-drawer pan banks on the chef side (+Z)
  const bankInnerSpanW = drawerZoneW - postS * 2;
  const midStileW = 0.032;
  const singleBankW = (bankInnerSpanW - midStileW) * 0.5;
  const bankStartX = drawerZoneStartX + postS;
  const frameT = 0.024;
  const doorT = 0.022;

  addNamedBox(
    root,
    `${namePrefix}.chefCenterStile`,
    midStileW,
    bodyH,
    frameT,
    bankStartX + singleBankW + midStileW * 0.5,
    bodyMidY,
    chefFrontZ - frameT * 0.5,
    paintMat
  );

  // Carcass floor/ceiling/divider inside drawer section
  addNamedBox(
    root,
    `${namePrefix}.drawerSectionDivider`,
    0.02,
    bodyH - 0.02,
    carcassD - postS * 2,
    bankStartX + singleBankW + midStileW * 0.5,
    bodyMidY,
    carcassCenterZ,
    oakMat
  );

  for (let bIdx = 0; bIdx < 2; bIdx++) {
    const bCx = bankStartX + singleBankW * 0.5 + bIdx * (singleBankW + midStileW);
    addNamedBox(
      root,
      `${namePrefix}.bank_${bIdx + 1}.railTop`,
      singleBankW,
      0.028,
      frameT,
      bCx,
      carcassH - 0.014,
      chefFrontZ - frameT * 0.5,
      paintMat
    );
    addNamedBox(
      root,
      `${namePrefix}.bank_${bIdx + 1}.railBottom`,
      singleBankW,
      0.028,
      frameT,
      bCx,
      plinthH + 0.014,
      chefFrontZ - frameT * 0.5,
      paintMat
    );

    const apTop = carcassH - 0.028;
    const apBot = plinthH + 0.028;
    const railH = 0.022;
    const availH = apTop - apBot - railH * 2;
    const ratios = [0.22, 0.37, 0.41];
    let yTop = apTop;

    for (let dIdx = 0; dIdx < 3; dIdx++) {
      const dH = availH * ratios[dIdx]!;
      const dCy = yTop - dH * 0.5;
      addCockBeadApertureTrim(
        root,
        `${namePrefix}.bank_${bIdx + 1}.bead_${dIdx + 1}`,
        bCx,
        dCy,
        chefFrontZ,
        singleBankW,
        dH,
        paintMat
      );

      const drGroup = new THREE.Group();
      drGroup.name = `${namePrefix}.bank_${bIdx + 1}.panDrawer_${dIdx + 1}`;
      drGroup.position.set(bCx, dCy, chefFrontZ - doorT * 0.5 - 0.001);
      root.add(drGroup);

      drGroup.add(
        buildShakerDoorAssembly(
          `${drGroup.name}.front`,
          singleBankW - 0.008,
          dH - 0.008,
          doorT,
          paintMat,
          0.044
        )
      );
      for (const [pTag, px] of [
        ['leftPull', -singleBankW * 0.24],
        ['rightPull', singleBankW * 0.24],
      ] as const) {
        const pull = applyNeptuneHardwareFinish(buildAgedBrassBarlowCupPull(`${drGroup.name}.${pTag}`), opts.hardwareFinish);
        pull.position.set(px, 0, doorT * 0.5 + 0.001);
        drGroup.add(pull);
      }

      const drBoxHolder = new THREE.Group();
      drBoxHolder.name = `${drGroup.name}.boxHolder`;
      drBoxHolder.position.set(0, 0, -(doorT * 0.5 + 0.002));
      drGroup.add(drBoxHolder);
      attachDrawerBoxBehindFront(
        drBoxHolder,
        singleBankW - 0.044,
        dH - 0.012,
        Math.max(0.30, carcassD - 0.16),
        '+z',
        dIdx > 0
      );

      wireCatalogSlidingDrawer(registry, {
        drawer: drGroup,
        slideDelta: [0, 0, 0.38],
        label: `Open Island Pan Drawer ${dIdx + 1}`,
      });

      yTop -= dH;
      if (dIdx < 2) {
        addNamedBox(
          root,
          `${namePrefix}.bank_${bIdx + 1}.midRail_${dIdx + 1}`,
          singleBankW,
          railH,
          frameT,
          bCx,
          yTop - railH * 0.5,
          chefFrontZ - frameT * 0.5,
          paintMat
        );
        yTop -= railH;
      }
    }
  }

  // Right (+X) 2-tier solid-oak cookbook & pot end-shelf under the end-grain butcher's block
  const shelfSpanX = butcherW - postS - 0.006;
  const shelfSpanZ = carcassD - postS * 2 + 0.04;
  const shelfLevels = [plinthH + 0.03, plinthH + bodyH * 0.48];
  shelfLevels.forEach((sy, sIdx) => {
    // Slatted solid-oak rack shelves
    const nSlats = 6;
    const slatD = shelfSpanZ / nSlats;
    for (let s = 0; s < nSlats; s++) {
      addNamedBox(
        root,
        `${namePrefix}.oakEndShelf_${sIdx + 1}_slat_${s + 1}`,
        shelfSpanX,
        0.022,
        slatD - 0.008,
        butcherCenterX,
        sy,
        carcassCenterZ - shelfSpanZ * 0.5 + (s + 0.5) * slatD,
        oakMat
      );
    }
  });

  // Cookbooks on upper shelf + cast-iron casserole on lower shelf
  const bookColors = [0x8b3a2b, 0x2c4257, 0xd8d0c1, 0x4f614e, 0x6b5139];
  bookColors.forEach((bc, bIdx) => {
    const bMat = getPaintedJoineryMaterial(bc, 0.65, `${namePrefix}.cookbook_${bIdx + 1}`);
    addNamedBox(
      root,
      `${namePrefix}.cookbook_${bIdx + 1}`,
      0.21,
      0.26,
      0.032,
      butcherCenterX + 0.04,
      shelfLevels[1]! + 0.011 + 0.13 + 0.001,
      carcassCenterZ - 0.14 + bIdx * 0.036,
      bMat,
      true
    );
  });
  addNamedCyl(
    root,
    `${namePrefix}.endShelfDutchOven`,
    0.125,
    0.115,
    0.115,
    18,
    butcherCenterX + 0.02,
    shelfLevels[0]! + 0.011 + 0.058,
    carcassCenterZ + 0.04,
    castIronMat,
    true
  );
  addNamedCyl(
    root,
    `${namePrefix}.endShelfDutchOvenLid`,
    0.128,
    0.122,
    0.02,
    18,
    butcherCenterX + 0.02,
    shelfLevels[0]! + 0.011 + 0.126,
    carcassCenterZ + 0.04,
    castIronMat,
    true
  );

  // Worktop: 30 mm bullnose Honed Carrara slab across main section + 70 mm end-grain European oak butcher's block (`450 mm` wide) on `+X` end
  const marbleW = totalW - butcherW - 0.004;
  const marbleCx = -totalW * 0.5 + marbleW * 0.5;
  addNamedBox(
    root,
    `${namePrefix}.carraraIslandSlab`,
    marbleW,
    worktopH,
    totalD,
    marbleCx,
    carcassH + worktopH * 0.5 + 0.0005,
    0,
    carraraMat
  );

  const butcherBlockH = 0.07;
  const butcherSlabCx = totalW * 0.5 - butcherW * 0.5;
  // Stepped cleanly above `carcassH` (70 mm thick end-grain oak block, 40 mm proud above marble top)
  addNamedBox(
    root,
    `${namePrefix}.endGrainOakButcherBlock`,
    butcherW,
    butcherBlockH,
    totalD,
    butcherSlabCx,
    carcassH + butcherBlockH * 0.5 + 0.0005,
    0,
    endGrainMat
  );
  // Recessed brass finger-grip routing / strap plate on butcher block end
  addNamedBox(
    root,
    `${namePrefix}.butcherBrassBrandPlate`,
    0.003,
    0.02,
    0.088,
    totalW * 0.5 + 0.002,
    carcassH + butcherBlockH * 0.5,
    0,
    brassMat,
    true
  );

  const hwCode = resolveBrasswareCode(opts.hardwareFinish, 'AB');
  const out = finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
  return attachAssetMetadata(out, {
    name: 'Neptune Chichester Chef & Breakfast-Bar Kitchen Island',
    brand: 'Neptune',
    collection: 'Chichester',
    sku: `NEP-CHI-ISL-${Math.round(totalW * 1000)}-${hwCode}`,
    finish: `Ink Painted Timber, Honed Carrara & End-Grain Oak / ${formatBrasswareFinishLabel(hwCode)}`,
    category: 'joinery',
    dimensionsMm: mmFromMetres(totalW, totalD, totalH),
    productUrl: 'https://www.neptune.com/uk/kitchens/chichester/islands/',
    schematicUrl: 'https://www.neptune.com/uk/kitchens/chichester/island-specification.pdf',
  });
}


// =============================================================================
// Reusable Heritage Kitchen Architecture, Prep Island, Woven Stools & PBR Maps
// =============================================================================

function getFullStavePaleEuropeanOakMaps(): PbrDataMapBundle {
  return getOrCreateCachedTexture('catalog:timber:full-stave-pale-oak-1024:v1', () => {
    const size = 1024;
    // Warm honey-biscuit Scandinavian / Neptune washed European oak (#C9AE87 - #B99B72)
    const br = 195;
    const bg = 167;
    const bb = 126;
    const color = new Uint8Array(size * size * 4);
    const height = new Float32Array(size * size);
    const rough = new Float32Array(size * size);

    const hashP = (ix: number, iy: number, px: number, py: number, seed: number): number => {
      const wx = ((ix % px) + px) % px;
      const wy = ((iy % py) + py) % py;
      let h = (wx * 374761393 + wy * 668265263 + seed * 1442695041) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      h ^= h >>> 16;
      return (h >>> 0) / 4294967295;
    };
    const buildGrid = (gw: number, gh: number, seed: number): Float32Array => {
      const g = new Float32Array(gw * gh);
      for (let iy = 0; iy < gh; iy++) {
        for (let ix = 0; ix < gw; ix++) {
          g[iy * gw + ix] = hashP(ix, iy, gw, gh, seed);
        }
      }
      return g;
    };
    const sampleG = (g: Float32Array, gw: number, gh: number, u: number, v: number): number => {
      const uf = u - Math.floor(u);
      const vf = v - Math.floor(v);
      const x = uf * gw;
      const y = vf * gh;
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const x1 = (x0 + 1) % gw;
      const y1 = (y0 + 1) % gh;
      const tx = x - x0;
      const ty = y - y0;
      const fx = tx * tx * (3 - 2 * tx);
      const fy = ty * ty * (3 - 2 * ty);
      const n00 = g[y0 * gw + x0]!;
      const n10 = g[y0 * gw + x1]!;
      const n01 = g[y1 * gw + x0]!;
      const n11 = g[y1 * gw + x1]!;
      return (n00 + (n10 - n00) * fx) * (1 - fy) + (n01 + (n11 - n01) * fx) * fy;
    };

    const gMacro = buildGrid(6, 12, 8101);
    const gMid = buildGrid(14, 28, 8117);
    const gFiber = buildGrid(32, 160, 8147);
    const gPore = buildGrid(64, 384, 8171);
    const gRay = buildGrid(96, 36, 8191);

    // 18 full-length solid oak staves across 0.90 m metric tile -> exact 50 mm stave width!
    const nStaves = 18;
    for (let y = 0; y < size; y++) {
      const v = y / size;
      const staveF = v * nStaves;
      const sIdx = Math.floor(staveF);
      const fv = staveF - sIdx;
      const staveTone = (hashP(sIdx, 0, nStaves, 1, 8209) - 0.5) * 14.5;
      const staveWarmth = (hashP(sIdx, 1, nStaves, 2, 8219) - 0.5) * 4.5;
      const stavePhase = hashP(sIdx, 2, nStaves, 3, 8231) * 7.0;
      const staveUShift = hashP(sIdx, 3, nStaves, 4, 8243);
      const isQuarter = hashP(sIdx, 4, nStaves, 5, 8263) > 0.42;
      const crownCenter = 0.28 + hashP(sIdx, 5, nStaves, 6, 8273) * 0.44;
      const seamDist = Math.min(fv, 1 - fv);
      const seam = seamDist < 0.022 ? 1 - seamDist / 0.022 : 0;

      for (let x = 0; x < size; x++) {
        const u = x / size;
        const us = u + staveUShift;
        const idx = y * size + x;
        const o = idx * 4;

        // Organic multi-octave anisotropic grain running along U (worktop length)
        const warp =
          (sampleG(gMacro, 6, 12, us, v * 0.6 + stavePhase * 0.08) - 0.5) * 0.95 +
          (sampleG(gMid, 14, 28, us * 2, v + stavePhase * 0.13) - 0.5) * 0.36 +
          (sampleG(gFiber, 32, 160, us * 2, v) - 0.5) * 0.12;

        const dv = (fv - crownCenter) * (isQuarter ? 2.5 : 1.65);
        const arch = Math.hypot(dv, warp * 0.68) * (isQuarter ? 3.4 : 2.3) + stavePhase;
        const ringF = arch - Math.floor(arch);
        const latewood = Math.exp(-Math.pow((ringF - 0.76) * 5.0, 2));
        const fiber = sampleG(gFiber, 32, 160, us * 3, v) - 0.5;
        const poreSample = sampleG(gPore, 64, 384, us * 2, v);
        const openPore = poreSample < 0.22 ? (0.22 - poreSample) / 0.22 : 0;
        const raySample = sampleG(gRay, 96, 36, us * 2, v * 2);
        const medRay = isQuarter && raySample > 0.77 ? (raySample - 0.77) / 0.23 : 0;

        const d =
          staveTone -
          latewood * 11.5 +
          fiber * 5.2 -
          openPore * 8.4 +
          medRay * 7.6 -
          seam * 7.5;

        const rVal = br + d + staveWarmth * 0.7;
        const gVal = bg + d * 0.87 + staveWarmth * 0.35;
        const bVal = bb + d * 0.73 - staveWarmth * 0.25;
        color[o] = rVal <= 0 ? 0 : rVal >= 255 ? 255 : Math.round(rVal);
        color[o + 1] = gVal <= 0 ? 0 : gVal >= 255 ? 255 : Math.round(gVal);
        color[o + 2] = bVal <= 0 ? 0 : bVal >= 255 ? 255 : Math.round(bVal);
        color[o + 3] = 255;

        height[idx] =
          0.54 - openPore * 0.13 - latewood * 0.028 + fiber * 0.022 + medRay * 0.014 - seam * 0.085;
        // Natural matte-satin Osmo Polyx raw/washed oil sheen (roughness ~0.42)
        rough[idx] = Math.max(
          0.26,
          Math.min(0.68, 0.42 + openPore * 0.08 + latewood * 0.02 - medRay * 0.045 + seam * 0.07)
        );
      }
    }

    const derived = deriveNormalAndRoughnessFromHeight(
      height,
      rough,
      size,
      size,
      1.55,
      'catalog.fullStavePaleOak'
    );
    return {
      colorMap: makeRgbaDataTexture(color, size, size, 'catalog.fullStavePaleOak.color', true),
      normalMap: derived.normalMap,
      roughnessMap: derived.roughnessMap,
    };
  });
}

let cachedPaleEuropeanOakJoineryMat: THREE.MeshStandardMaterial | null = null;
export function getPaleEuropeanOakJoineryMaterial(): THREE.MeshStandardMaterial {
  if (!cachedPaleEuropeanOakJoineryMat) {
    const maps = getFullStavePaleEuropeanOakMaps();
    cachedPaleEuropeanOakJoineryMat = new THREE.MeshStandardMaterial({
      name: 'catalog.paleEuropeanOakJoinery',
      color: 0xffffff,
      map: maps.colorMap,
      normalMap: maps.normalMap,
      normalScale: new THREE.Vector2(0.34, 0.34),
      roughnessMap: maps.roughnessMap,
      roughness: 0.42,
      metalness: 0.0,
    });
  }
  return cachedPaleEuropeanOakJoineryMat;
}

let cachedHandmadeCreamMetroTileMat: THREE.MeshPhysicalMaterial | null = null;
export function createHandmadeCreamMetroTileMaterial(): THREE.MeshPhysicalMaterial {
  if (cachedHandmadeCreamMetroTileMat) return cachedHandmadeCreamMetroTileMat;
  const W = 256;
  const H = 256;
  const albedo = new Uint8Array(W * H * 4);
  const heightF = new Float32Array(W * H);
  const roughF = new Float32Array(W * H);
  // 1 UV = 1.0 m -> 5 horizontal stretcher courses (200 mm) x 13 vertical courses (~77 mm)
  const cols = 5;
  const rows = 13;
  for (let y = 0; y < H; y++) {
    const v = y / H;
    const rowF = v * rows;
    const rowIdx = Math.floor(rowF);
    const fy = rowF - rowIdx;
    const stagger = (rowIdx % 2) * 0.5;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const colF = u * cols + stagger;
      const colIdx = Math.floor(colF);
      const fx = colF - colIdx;

      const groutX = Math.min(fx, 1 - fx) * (1 / cols);
      const groutY = Math.min(fy, 1 - fy) * (1 / rows);
      const edgeDist = Math.min(groutX, groutY);
      const isGrout = edgeDist < 0.0022;

      const tileSeed = ((rowIdx * 73 + colIdx * 37) & 255) / 255;
      const ripple = seamlessFbm2D(u * 3.0 + tileSeed, v * 3.0, 4, 3, 913);
      const idx = y * W + x;
      const o = idx * 4;

      if (isGrout) {
        albedo[o] = 216;
        albedo[o + 1] = 208;
        albedo[o + 2] = 193;
        albedo[o + 3] = 255;
        heightF[idx] = 0.18;
        roughF[idx] = 0.84;
      } else {
        const pillow = Math.min(1, edgeDist / 0.009);
        const shade = (tileSeed - 0.5) * 11 + (ripple - 0.5) * 9;
        albedo[o] = Math.max(0, Math.min(255, Math.round(237 + shade)));
        albedo[o + 1] = Math.max(0, Math.min(255, Math.round(229 + shade * 0.95)));
        albedo[o + 2] = Math.max(0, Math.min(255, Math.round(211 + shade * 0.85)));
        albedo[o + 3] = 255;
        heightF[idx] = 0.55 + 0.32 * pillow + 0.12 * ripple;
        roughF[idx] = 0.16 + 0.06 * (1 - ripple);
      }
    }
  }
  const map = makeRgbaDataTexture(albedo, W, H, 'catalog.handmadeCreamMetro.albedo', true, 1, 1);
  const nr = deriveNormalAndRoughnessFromHeight(
    heightF,
    roughF,
    W,
    H,
    3.2,
    'catalog.handmadeCreamMetro',
    1,
    1
  );
  cachedHandmadeCreamMetroTileMat = new THREE.MeshPhysicalMaterial({
    name: 'catalog.handmadeCreamMetroTile',
    color: 0xffffff,
    map,
    normalMap: nr.normalMap,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: nr.roughnessMap,
    roughness: 0.22,
    clearcoat: 0.72,
    clearcoatRoughness: 0.14,
    ior: 1.52,
  });
  return cachedHandmadeCreamMetroTileMat;
}

let cachedOliveMetroTileMat: THREE.MeshPhysicalMaterial | null = null;
export function createHandmadeOliveMetroTileMaterial(): THREE.MeshPhysicalMaterial {
  if (cachedOliveMetroTileMat) return cachedOliveMetroTileMat;
  const W = 256;
  const H = 256;
  const albedo = new Uint8Array(W * H * 4);
  const heightF = new Float32Array(W * H);
  const roughF = new Float32Array(W * H);
  const cols = 5;
  const rows = 13;
  for (let y = 0; y < H; y++) {
    const v = y / H;
    const rowF = v * rows;
    const rowIdx = Math.floor(rowF);
    const fy = rowF - rowIdx;
    const stagger = (rowIdx % 2) * 0.5;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const colF = u * cols + stagger;
      const colIdx = Math.floor(colF);
      const fx = colF - colIdx;

      const groutX = Math.min(fx, 1 - fx) * (1 / cols);
      const groutY = Math.min(fy, 1 - fy) * (1 / rows);
      const edgeDist = Math.min(groutX, groutY);
      const isGrout = edgeDist < 0.0022;

      const tileSeed = ((rowIdx * 89 + colIdx * 53) & 255) / 255;
      const ripple = seamlessFbm2D(u * 3.0 + tileSeed, v * 3.0, 4, 3, 947);
      const idx = y * W + x;
      const o = idx * 4;

      if (isGrout) {
        albedo[o] = 224;
        albedo[o + 1] = 219;
        albedo[o + 2] = 207;
        albedo[o + 3] = 255;
        heightF[idx] = 0.16;
        roughF[idx] = 0.85;
      } else {
        const pillow = Math.min(1, edgeDist / 0.009);
        const shade = (tileSeed - 0.5) * 16 + (ripple - 0.5) * 12;
        albedo[o] = Math.max(0, Math.min(255, Math.round(138 + shade)));
        albedo[o + 1] = Math.max(0, Math.min(255, Math.round(148 + shade)));
        albedo[o + 2] = Math.max(0, Math.min(255, Math.round(118 + shade * 0.85)));
        albedo[o + 3] = 255;
        heightF[idx] = 0.55 + 0.32 * pillow + 0.13 * ripple;
        roughF[idx] = 0.17 + 0.07 * (1 - ripple);
      }
    }
  }
  const map = makeRgbaDataTexture(albedo, W, H, 'catalog.handmadeOliveMetro.albedo', true, 1, 1);
  const nr = deriveNormalAndRoughnessFromHeight(
    heightF,
    roughF,
    W,
    H,
    3.2,
    'catalog.handmadeOliveMetro',
    1,
    1
  );
  cachedOliveMetroTileMat = new THREE.MeshPhysicalMaterial({
    name: 'catalog.handmadeOliveMetroTile',
    color: 0xffffff,
    map,
    normalMap: nr.normalMap,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: nr.roughnessMap,
    roughness: 0.22,
    clearcoat: 0.72,
    clearcoatRoughness: 0.14,
    ior: 1.52,
  });
  return cachedOliveMetroTileMat;
}

let cachedPaleOakHerringboneMat: THREE.MeshStandardMaterial | null = null;
/**
 * 512x512 procedural 45-degree Blonde/Pale European Oak Herringbone Parquet PBR material
 * (`albedo + normalMap + roughnessMap`, natural block-to-block tonal variation & micro-bevel V-grooves).
 */
export function createPaleOakHerringboneParquetMaterial(): THREE.MeshStandardMaterial {
  if (cachedPaleOakHerringboneMat) return cachedPaleOakHerringboneMat;
  const N = 512;
  const albedo = new Uint8Array(N * N * 4);
  const heightF = new Float32Array(N * N);
  const roughF = new Float32Array(N * N);

  // Rotate UV by 45 degrees with integer period (k = 4 -> 4*(u+v), 4*(u-v) is periodic on [0,1]^2!)
  // Block ratio L : W = 4 : 1 in rotated lattice units
  const K = 4; // 4 herringbone periods across 1 tile (~1.35 m)
  const RATIO = 4;

  for (let py = 0; py < N; py++) {
    const v = py / N;
    for (let px = 0; px < N; px++) {
      const u = px / N;
      // Lattice coords in block-width units: (a, b) with period K*RATIO = 16 along both axes
      const a = (u + v) * K * RATIO;
      const b = (u - v + 1.0) * K * RATIO;
      const ia = Math.floor(a);
      const ib = Math.floor(b);
      const fa = a - ia;
      const fb = b - ib;

      // Standard herringbone tiling on unit square grid:
      // Stepped diagonal staircase: parity = ((ia - ib) mod 2*RATIO)
      const diag = ((ia - ib) % (2 * RATIO) + 2 * RATIO) % (2 * RATIO);
      const horizontal = diag < RATIO;

      let blockI: number;
      let blockJ: number;
      let along: number;
      let across: number;
      if (horizontal) {
        // Block spans RATIO cells along +a: start is ia - diag
        const aStart = ia - diag;
        blockI = aStart;
        blockJ = ib;
        along = (diag + fa) / RATIO;
        across = fb;
      } else {
        // Block spans RATIO cells along -b: offset d2 = diag - RATIO -> ib + d2 - (RATIO - 1)
        const d2 = diag - RATIO;
        const bStart = ib + d2 - (RATIO - 1);
        blockI = ia;
        blockJ = bStart * 3 + 1;
        along = (RATIO - 1 - d2 + fb) / RATIO;
        across = fa;
      }

      // Periodic block hash so tile wraps seamlessly
      const pI = ((blockI % 16) + 16) % 16;
      const pJ = ((blockJ % 48) + 48) % 48;
      const h1 = Math.sin(pI * 127.1 + pJ * 311.7) * 43758.5453;
      const seedA = h1 - Math.floor(h1);
      const h2 = Math.sin(pI * 269.5 + pJ * 183.3) * 24634.6345;
      const seedB = h2 - Math.floor(h2);

      const bevelAlong = Math.min(along, 1 - along) * RATIO;
      const bevelAcross = Math.min(across, 1 - across);
      const edge = Math.min(bevelAlong, bevelAcross);
      const isGroove = edge < 0.038;

      // Fine oak cathedral & medullary grain along block length
      const grainU = ((along + seedA) % 1 + 1) % 1;
      const grainV = ((across + seedB) % 1 + 1) % 1;
      const fineGrain = seamlessValueNoise2D(grainU, grainV, 6, 42, 401);
      const cathedral = Math.sin((grainV * 3.14159 + fineGrain * 0.45) * 3.0) * 0.5 + 0.5;
      const pore = seamlessValueNoise2D(grainU, grainV, 18, 96, 577);

      const idx = py * N + px;
      const o = idx * 4;

      if (isGroove) {
        albedo[o] = 148;
        albedo[o + 1] = 123;
        albedo[o + 2] = 94;
        albedo[o + 3] = 255;
        heightF[idx] = 0.15;
        roughF[idx] = 0.85;
      } else {
        const tone = (seedA - 0.5) * 26 + (cathedral - 0.5) * 13 + (fineGrain - 0.5) * 10 - (pore > 0.78 ? 7 : 0);
        // Warm blonde / pale European oak (#CBB08B .. #DFC8A7)
        albedo[o] = Math.max(0, Math.min(255, Math.round(211 + tone)));
        albedo[o + 1] = Math.max(0, Math.min(255, Math.round(184 + tone * 0.91)));
        albedo[o + 2] = Math.max(0, Math.min(255, Math.round(147 + tone * 0.78)));
        albedo[o + 3] = 255;
        const chamfer = Math.min(1, edge / 0.09);
        heightF[idx] = 0.48 + 0.36 * chamfer + 0.1 * fineGrain - (pore > 0.78 ? 0.06 : 0);
        roughF[idx] = 0.52 + (seedB - 0.5) * 0.1 + (1 - fineGrain) * 0.08;
      }
    }
  }

  const rx = 0.85;
  const ry = 0.85;
  const map = makeRgbaDataTexture(albedo, N, N, 'catalog.paleOakHerringbone.albedo', true, rx, ry);
  const nr = deriveNormalAndRoughnessFromHeight(
    heightF,
    roughF,
    N,
    N,
    2.6,
    'catalog.paleOakHerringbone',
    rx,
    ry
  );
  cachedPaleOakHerringboneMat = new THREE.MeshStandardMaterial({
    name: 'catalog.paleOakHerringboneParquet',
    color: 0xffffff,
    map,
    normalMap: nr.normalMap,
    normalScale: new THREE.Vector2(0.45, 0.45),
    roughnessMap: nr.roughnessMap,
    roughness: 0.58,
    metalness: 0.0,
  });
  return cachedPaleOakHerringboneMat;
}

let cachedRollerMownLawnMat: THREE.MeshStandardMaterial | null = null;
/**
 * 512x512 procedural PBR Roller-Mown Striped English Lawn material (`1 UV = 1.80 m` -> `900 mm` mowing stripes,
 * fine fescue blade micro-grain, organic stripe boundary feathering, normal & roughness variation).
 */
export function createRollerMownStripedLawnMaterial(): THREE.MeshStandardMaterial {
  if (cachedRollerMownLawnMat) return cachedRollerMownLawnMat;
  const N = 512;
  const albedo = new Uint8Array(N * N * 4);
  const heightF = new Float32Array(N * N);
  const roughF = new Float32Array(N * N);

  for (let py = 0; py < N; py++) {
    const v = py / N;
    for (let px = 0; px < N; px++) {
      const u = px / N;
      const wobble = (seamlessFbm2D(u, v, 4, 3, 211) - 0.5) * 0.045;
      // Smooth alternating roller-mower stripe wave along U (1 full light+dark pair per 1.0 UV)
      const rawWave = Math.sin((u + wobble) * Math.PI * 2);
      const stripe = 0.5 + 0.5 * Math.tanh(rawWave * 3.1);

      const turfPatch = seamlessFbm2D(u, v, 6, 4, 307);
      const bladeA = seamlessValueNoise2D(u, v, 96, 128, 419);
      const bladeB = seamlessValueNoise2D(u, v, 160, 96, 523);
      const blades = bladeA * 0.6 + bladeB * 0.4;

      // Rich natural English fescue & perennial ryegrass (light bent-away vs dark bent-toward blades)
      const rBase = 58 + stripe * 21 + (turfPatch - 0.5) * 14 + (blades - 0.5) * 18;
      const gBase = 92 + stripe * 26 + (turfPatch - 0.5) * 16 + (blades - 0.5) * 20;
      const bBase = 41 + stripe * 13 + (turfPatch - 0.5) * 9 + (blades - 0.5) * 11;

      const idx = py * N + px;
      const o = idx * 4;
      albedo[o] = Math.max(0, Math.min(255, Math.round(rBase)));
      albedo[o + 1] = Math.max(0, Math.min(255, Math.round(gBase)));
      albedo[o + 2] = Math.max(0, Math.min(255, Math.round(bBase)));
      albedo[o + 3] = 255;

      heightF[idx] = 0.35 + blades * 0.48 + turfPatch * 0.17;
      // Roller-bent-away blades catch slightly more specular sheen than upright/toward blades
      roughF[idx] = 0.94 - stripe * 0.08 + (0.5 - blades) * 0.06;
    }
  }

  const map = makeRgbaDataTexture(albedo, N, N, 'catalog.rollerMownLawn.albedo', true, 1, 1);
  const nr = deriveNormalAndRoughnessFromHeight(
    heightF,
    roughF,
    N,
    N,
    2.8,
    'catalog.rollerMownLawn',
    1,
    1
  );
  cachedRollerMownLawnMat = new THREE.MeshStandardMaterial({
    name: 'catalog.rollerMownStripedLawn',
    color: 0xffffff,
    map,
    normalMap: nr.normalMap,
    normalScale: new THREE.Vector2(0.65, 0.65),
    roughnessMap: nr.roughnessMap,
    roughness: 0.92,
    metalness: 0.0,
  });
  return cachedRollerMownLawnMat;
}

const cachedFoliageMaterials = new Map<string, THREE.MeshStandardMaterial>();
/**
 * 512x512 procedural evergreen leaf-cluster PBR material (`albedo + normalMap + roughnessMap`)
 * for Taxus baccata (English Yew) hedging & Buxus sempervirens (Boxwood) topiary.
 */
export function createEvergreenFoliagePbrMaterial(
  species: 'englishYew' | 'boxwoodBuxus' | 'herbaceousBorder' = 'englishYew'
): THREE.MeshStandardMaterial {
  const hit = cachedFoliageMaterials.get(species);
  if (hit) return hit;

  const N = 512;
  const albedo = new Uint8Array(N * N * 4);
  const heightF = new Float32Array(N * N);
  const roughF = new Float32Array(N * N);

  const palette =
    species === 'englishYew'
      ? { r: 36, g: 59, b: 34, tipR: 58, tipG: 88, tipB: 46, seed: 613 }
      : species === 'boxwoodBuxus'
        ? { r: 52, g: 84, b: 39, tipR: 86, tipG: 124, tipB: 54, seed: 727 }
        : { r: 58, g: 82, b: 54, tipR: 118, tipG: 108, tipB: 138, seed: 839 };

  for (let py = 0; py < N; py++) {
    const v = py / N;
    for (let px = 0; px < N; px++) {
      const u = px / N;
      const clump = seamlessFbm2D(u, v, 8, 4, palette.seed);
      const leafA = seamlessValueNoise2D(u, v, 44, 52, palette.seed + 31);
      const leafB = seamlessValueNoise2D(u, v, 88, 76, palette.seed + 67);
      const needle = leafA * 0.55 + leafB * 0.45;
      // Deep interior shadow pockets between leaf clusters
      const pocket = needle < 0.34 ? 0.52 : 1.0;
      const shoot = Math.max(0, (needle - 0.58) / 0.42) * clump;

      const r = (palette.r * (1 - shoot) + palette.tipR * shoot + (clump - 0.5) * 14) * pocket;
      const g = (palette.g * (1 - shoot) + palette.tipG * shoot + (clump - 0.5) * 18) * pocket;
      const b = (palette.b * (1 - shoot) + palette.tipB * shoot + (clump - 0.5) * 12) * pocket;

      const idx = py * N + px;
      const o = idx * 4;
      albedo[o] = Math.max(0, Math.min(255, Math.round(r)));
      albedo[o + 1] = Math.max(0, Math.min(255, Math.round(g)));
      albedo[o + 2] = Math.max(0, Math.min(255, Math.round(b)));
      albedo[o + 3] = 255;

      heightF[idx] = pocket < 1 ? 0.12 + needle * 0.3 : 0.45 + needle * 0.42 + clump * 0.13;
      // Waxy evergreen cuticle on outer leaves, matte in recessed twig pockets
      roughF[idx] = pocket < 1 ? 0.96 : 0.68 + (1 - shoot) * 0.16;
    }
  }

  const rep = species === 'boxwoodBuxus' ? 2.4 : 1.6;
  const map = makeRgbaDataTexture(albedo, N, N, `catalog.foliage.${species}.albedo`, true, rep, rep);
  const nr = deriveNormalAndRoughnessFromHeight(
    heightF,
    roughF,
    N,
    N,
    3.6,
    `catalog.foliage.${species}`,
    rep,
    rep
  );
  const mat = new THREE.MeshStandardMaterial({
    name: `catalog.foliage.${species}`,
    color: 0xffffff,
    map,
    normalMap: nr.normalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughnessMap: nr.roughnessMap,
    roughness: 0.82,
    metalness: 0.0,
  });
  cachedFoliageMaterials.set(species, mat);
  return mat;
}

const cachedTextileFloorMats = new Map<string, THREE.MeshStandardMaterial>();
/**
 * Procedural PBR woven floor materials (`albedo + normalMap + roughnessMap`) for
 * oatmeal loop-pile wool broadloom carpet, honey woven sisal bouclé, Roger Oates runner & fumed walnut-oak.
 */
export function createHeritageFloorFinishMaterial(
  preset: 'oatmealLoopWoolCarpet' | 'honeySisalBoucle' | 'rogerOatesHerringboneRunner' | 'fumedWalnutOakPlank'
): THREE.MeshStandardMaterial {
  const hit = cachedTextileFloorMats.get(preset);
  if (hit) return hit;

  if (preset === 'fumedWalnutOakPlank') {
    const maps = getTimberGrainMaps('fumed-walnut-oak-plank', 0x563d29, 28, 0.52);
    const mat = new THREE.MeshStandardMaterial({
      name: 'catalog.floor.fumedWalnutOakPlank',
      color: 0xffffff,
      map: maps.colorMap,
      normalMap: maps.normalMap,
      normalScale: new THREE.Vector2(0.5, 0.5),
      roughnessMap: maps.roughnessMap,
      roughness: 0.52,
      metalness: 0.0,
    });
    cachedTextileFloorMats.set(preset, mat);
    return mat;
  }

  const N = 256;
  const albedo = new Uint8Array(N * N * 4);
  const heightF = new Float32Array(N * N);
  const roughF = new Float32Array(N * N);

  for (let py = 0; py < N; py++) {
    const v = py / N;
    for (let px = 0; px < N; px++) {
      const u = px / N;
      const idx = py * N + px;
      const o = idx * 4;

      if (preset === 'oatmealLoopWoolCarpet') {
        const loopX = Math.sin(u * Math.PI * 2 * 64) * 0.5 + 0.5;
        const loopY = Math.sin(v * Math.PI * 2 * 48 + ((Math.floor(u * 64) % 2) * Math.PI)) * 0.5 + 0.5;
        const loop = loopX * 0.45 + loopY * 0.55;
        const fleck = seamlessValueNoise2D(u, v, 32, 32, 641);
        const macro = seamlessFbm2D(u, v, 4, 3, 643);
        const shade = (loop - 0.5) * 16 + (fleck - 0.5) * 18 + (macro - 0.5) * 8;
        albedo[o] = Math.max(0, Math.min(255, Math.round(212 + shade)));
        albedo[o + 1] = Math.max(0, Math.min(255, Math.round(201 + shade * 0.95)));
        albedo[o + 2] = Math.max(0, Math.min(255, Math.round(183 + shade * 0.9)));
        albedo[o + 3] = 255;
        heightF[idx] = 0.35 + loop * 0.5 + fleck * 0.15;
        roughF[idx] = 0.91 + (1 - loop) * 0.06;
      } else if (preset === 'honeySisalBoucle') {
        const rib = Math.sin(v * Math.PI * 2 * 36) * 0.5 + 0.5;
        const chev = Math.sin((u * 28 + (Math.floor(v * 36) % 2 === 0 ? v * 14 : -v * 14)) * Math.PI * 2) * 0.5 + 0.5;
        const fiber = seamlessValueNoise2D(u, v, 48, 24, 751);
        const weave = rib * 0.55 + chev * 0.45;
        const shade = (weave - 0.5) * 26 + (fiber - 0.5) * 16;
        albedo[o] = Math.max(0, Math.min(255, Math.round(188 + shade)));
        albedo[o + 1] = Math.max(0, Math.min(255, Math.round(161 + shade * 0.9)));
        albedo[o + 2] = Math.max(0, Math.min(255, Math.round(122 + shade * 0.78)));
        albedo[o + 3] = 255;
        heightF[idx] = 0.25 + weave * 0.6 + fiber * 0.15;
        roughF[idx] = 0.88 + (1 - weave) * 0.08;
      } else {
        // Roger Oates striped flatweave herringbone wool runner (warm olive-oatmeal stripes & border)
        const chevron = Math.sin((v * 44 + Math.abs(((u * 12) % 2) - 1) * 2.2) * Math.PI * 2) * 0.5 + 0.5;
        const borderBand = u < 0.11 || u > 0.89;
        const pinStripe = Math.abs(u - 0.16) < 0.018 || Math.abs(u - 0.84) < 0.018 || Math.abs(u - 0.5) < 0.022;
        const wool = seamlessValueNoise2D(u, v, 36, 64, 859);
        const baseR = borderBand ? 114 : pinStripe ? 92 : 168;
        const baseG = borderBand ? 119 : pinStripe ? 98 : 160;
        const baseB = borderBand ? 94 : pinStripe ? 78 : 140;
        const shade = (chevron - 0.5) * 16 + (wool - 0.5) * 12;
        albedo[o] = Math.max(0, Math.min(255, Math.round(baseR + shade)));
        albedo[o + 1] = Math.max(0, Math.min(255, Math.round(baseG + shade)));
        albedo[o + 2] = Math.max(0, Math.min(255, Math.round(baseB + shade * 0.9)));
        albedo[o + 3] = 255;
        heightF[idx] = 0.35 + chevron * 0.5 + wool * 0.15;
        roughF[idx] = 0.92 + (1 - chevron) * 0.05;
      }
    }
  }

  const rep = preset === 'rogerOatesHerringboneRunner' ? 1.0 : 1.6;
  const map = makeRgbaDataTexture(albedo, N, N, `catalog.floor.${preset}.albedo`, true, rep, rep);
  const nr = deriveNormalAndRoughnessFromHeight(
    heightF,
    roughF,
    N,
    N,
    3.0,
    `catalog.floor.${preset}`,
    rep,
    rep
  );
  const mat = new THREE.MeshStandardMaterial({
    name: `catalog.floor.${preset}`,
    color: 0xffffff,
    map,
    normalMap: nr.normalMap,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: nr.roughnessMap,
    roughness: 0.9,
    metalness: 0.0,
  });
  cachedTextileFloorMats.set(preset, mat);
  return mat;
}

export interface PlasterRangeChimneyBreastOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  /** Total chimney breast width in metres (default `1.64`). */
  readonly widthM?: number;
  /** Total chimney breast projection depth in metres (default `0.66`). */
  readonly depthM?: number;
  /** Floor-to-ceiling height in metres (default `2.83`). */
  readonly ceilingHeightM?: number;
  /** Clear cooking Inglenook aperture width in metres (default `1.04` for a `1000 mm` Lacanche). */
  readonly apertureWidthM?: number;
  /** Clear Inglenook soffit height in metres (default `1.68`). */
  readonly apertureHeightM?: number;
  /** Plaster material override (defaults to warm putty lime-plaster). */
  readonly plasterMaterial?: THREE.Material;
  /** Moulded mantle shelf & stoneware platter styling (default `true`). */
  readonly includeMantlePlatters?: boolean;
}

/**
 * Full-height plastered Georgian / Neptune range-cooker chimney breast with a recessed cooking Inglenook
 * lined in glossy warm-cream handmade running-bond metro tiles, stepped moulded plaster mantle shelf,
 * and two leaning stoneware platters on the shelf.
 * Local origin `(0, 0, 0)` is on the rear masonry wall (`z = 0`), floor level (`y = 0`), centered in `X`, projecting `+Z`.
 */
export function buildPlasterRangeChimneyBreast(
  opts: PlasterRangeChimneyBreastOptions = {}
): THREE.Group {
  const namePrefix = opts.name ?? 'plasterRangeChimneyBreast';
  const totalW = opts.widthM ?? 1.64;
  const totalD = opts.depthM ?? 0.66;
  const ceilH = opts.ceilingHeightM ?? 2.83;
  const apW = opts.apertureWidthM ?? 1.04;
  const apH = opts.apertureHeightM ?? 1.68;

  const plasterMat =
    opts.plasterMaterial ??
    getPaintedJoineryMaterial(0xe5decb, 0.88, `${namePrefix}.puttyPlaster`);
  const shelfMat = getPaintedJoineryMaterial(0xede7d8, 0.72, `${namePrefix}.mantleShelf`);
  const metroTileMat = createHandmadeCreamMetroTileMaterial();
  const platterMatA = getPaintedJoineryMaterial(0xe8e4dc, 0.34, `${namePrefix}.stonewarePlatterA`);
  const platterMatB = getPaintedJoineryMaterial(0xdcd4c6, 0.38, `${namePrefix}.stonewarePlatterB`);

  const root = new THREE.Group();
  root.name = namePrefix;

  const cheekW = Math.max(0.18, (totalW - apW) * 0.5);
  // Left & right full-depth plaster piers flanking the range Inglenook (`y = 0 .. apH`)
  for (const [tag, sign] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    const cx = sign * (apW * 0.5 + cheekW * 0.5);
    addNamedBox(
      root,
      `${namePrefix}.pier${tag}`,
      cheekW,
      apH,
      totalD,
      cx,
      apH * 0.5,
      totalD * 0.5,
      plasterMat
    );
  }

  // Upper chimney hood breast (`y = apH .. ceilH - 0.002`)
  const upperH = Math.max(0.4, ceilH - apH - 0.002);
  addNamedBox(
    root,
    `${namePrefix}.upperBreast`,
    totalW,
    upperH,
    totalD,
    0,
    apH + upperH * 0.5,
    totalD * 0.5,
    plasterMat
  );

  // Glossy handmade warm-cream metro tile lining on the Inglenook back wall & inner side cheeks (`y = 0.88 .. apH - 0.004`)
  const tileBotY = 0.88;
  const tileH = apH - tileBotY - 0.004;
  const tileCy = tileBotY + tileH * 0.5;
  const backTileGeo = prepGeo(
    applyMetricBoxUVs(new THREE.BoxGeometry(apW - 0.028, tileH, 0.012), {
      tileW: 1.0,
      tileH: 1.0,
    })
  );
  const backTile = new THREE.Mesh(backTileGeo, metroTileMat);
  backTile.name = `${namePrefix}.inglenookMetroBack`;
  backTile.position.set(0, tileCy, 0.008);
  backTile.receiveShadow = true;
  root.add(backTile);

  for (const [tag, sign] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    const cheekTileGeo = prepGeo(
      applyMetricBoxUVs(new THREE.BoxGeometry(0.012, tileH, totalD - 0.03), {
        tileW: 1.0,
        tileH: 1.0,
      })
    );
    const cheekTile = new THREE.Mesh(cheekTileGeo, metroTileMat);
    cheekTile.name = `${namePrefix}.inglenookMetroCheek${tag}`;
    cheekTile.position.set(sign * (apW * 0.5 - 0.007), tileCy, totalD * 0.5 + 0.005);
    cheekTile.receiveShadow = true;
    root.add(cheekTile);
  }

  // Stepped architectural moulded mantle cornice & shelf wrapping the front + side returns (`y = apH - 0.02 .. apH + 0.165`)
  const mantleBandH = 0.115;
  const mantleBandY = apH + mantleBandH * 0.5 + 0.004;
  // Front frieze & side return friezes (strictly disjoint from upperBreast by projecting forward/sideways)
  addNamedBox(
    root,
    `${namePrefix}.mantleFriezeFront`,
    totalW + 0.056,
    mantleBandH,
    0.042,
    0,
    mantleBandY,
    totalD + 0.022,
    shelfMat
  );
  for (const [tag, sign] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    addNamedBox(
      root,
      `${namePrefix}.mantleFriezeSide${tag}`,
      0.028,
      mantleBandH,
      totalD,
      sign * (totalW * 0.5 + 0.015),
      mantleBandY,
      totalD * 0.5,
      shelfMat
    );
  }
  // Stepped top cornice shelf (`42 mm` thick, wrapping front & sides)
  const shelfTopH = 0.042;
  const shelfY = apH + mantleBandH + shelfTopH * 0.5 + 0.006;
  addNamedBox(
    root,
    `${namePrefix}.mantleTopFront`,
    totalW + 0.128,
    shelfTopH,
    0.082,
    0,
    shelfY,
    totalD + 0.042,
    shelfMat
  );
  for (const [tag, sign] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    addNamedBox(
      root,
      `${namePrefix}.mantleTopSide${tag}`,
      0.064,
      shelfTopH,
      totalD,
      sign * (totalW * 0.5 + 0.033),
      shelfY,
      totalD * 0.5,
      shelfMat
    );
  }

  // Two leaning stoneware platters resting on the mantle shelf against the upper plaster breast
  if (opts.includeMantlePlatters ?? true) {
    const deckY = shelfY + shelfTopH * 0.5;
    for (const [pTag, px, radius, mat] of [
      ['LargePlatter', 0.11, 0.175, platterMatA],
      ['MediumPlatter', 0.43, 0.135, platterMatB],
    ] as const) {
      const platter = new THREE.Group();
      platter.name = `${namePrefix}.${pTag}`;
      platter.position.set(px, deckY + radius * 0.96, totalD + 0.036);
      platter.rotation.x = -0.18;
      root.add(platter);

      const disc = addNamedCyl(platter, `${platter.name}.plate`, radius, radius * 0.82, 0.018, 28, 0, 0, 0, mat);
      disc.rotation.x = Math.PI * 0.5;
      const rim = new THREE.Mesh(
        prepGeo(new THREE.TorusGeometry(radius - 0.008, 0.007, 10, 28)),
        mat
      );
      rim.name = `${platter.name}.rim`;
      rim.position.set(0, 0, 0.007);
      platter.add(rim);
    }
  }

  return finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
}

export interface NeptuneOakPrepIslandTableOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  readonly widthM?: number;
  readonly depthM?: number;
  readonly heightM?: number;
  readonly includeTabletopStyling?: boolean;
}

/**
 * Freestanding solid Pale European Oak & Honed Carrara Marble architectural prep island table
 * (`1850 x 950 x 900 mm`): `35 mm` bullnose Honed Carrara marble top overhanging a natural-oak
 * mortise-and-tenon apron frame and 4 tapered square oak legs with open knee-space underneath,
 * styled on top with a thick oak chopping board, white ceramic bowl, artisan crusty bread & folded broadsheet.
 * Local origin `(0, 0, 0)` is centered in `X` and `Z` at floor level (`y = 0`), stool-seating front at `+Z`.
 */
export function buildNeptuneOakPrepIslandTable(
  opts: NeptuneOakPrepIslandTableOptions = {}
): THREE.Group {
  const namePrefix = opts.name ?? 'neptuneOakPrepIslandTable';
  const totalW = opts.widthM ?? 1.85;
  const totalD = opts.depthM ?? 0.95;
  const totalH = opts.heightM ?? 0.9;
  const slabH = 0.035;
  const frameTopY = totalH - slabH;

  const carraraMat = getHonedCarraraCatalogMaterial();
  const oakMat = getPaleEuropeanOakJoineryMaterial();
  const boardOakMat = getCharacterOakMaterial();
  const ceramicMat = getHeavyFireclayMaterial();
  const crustMat = getPaintedJoineryMaterial(0xb98246, 0.78, `${namePrefix}.breadCrust`);
  const crumbMat = getPaintedJoineryMaterial(0xe8d9b8, 0.88, `${namePrefix}.breadCrumb`);
  const paperMat = getPaintedJoineryMaterial(0xeae3d5, 0.86, `${namePrefix}.broadsheet`);

  const root = new THREE.Group();
  root.name = namePrefix;

  // Honed Carrara marble slab (`35 mm` thick)
  addNamedBox(
    root,
    `${namePrefix}.carraraMarbleTop`,
    totalW,
    slabH,
    totalD,
    0,
    frameTopY + slabH * 0.5,
    0,
    carraraMat
  );

  // 4 tapered square solid-oak legs inset cleanly under marble overhang (`68 mm -> 48 mm`)
  const insetX = 0.065;
  const insetZ = 0.065;
  const legTopW = 0.068;
  const legBotW = 0.048;
  const legCx = totalW * 0.5 - insetX - legTopW * 0.5;
  const legCz = totalD * 0.5 - insetZ - legTopW * 0.5;

  for (const [xTag, sx] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    for (const [zTag, sz] of [
      ['Rear', -1],
      ['Front', 1],
    ] as const) {
      const legGeo = prepGeo(
        new THREE.CylinderGeometry(
          legTopW * Math.SQRT1_2,
          legBotW * Math.SQRT1_2,
          frameTopY - 0.002,
          4
        )
      );
      legGeo.rotateY(Math.PI * 0.25);
      const leg = new THREE.Mesh(legGeo, oakMat);
      leg.name = `${namePrefix}.oakLeg_${xTag}_${zTag}`;
      leg.position.set(sx * legCx, (frameTopY - 0.002) * 0.5, sz * legCz);
      leg.castShadow = true;
      leg.receiveShadow = true;
      root.add(leg);
    }
  }

  // Solid-oak perimeter apron rails (front/rear `115 mm` deep, end modesty aprons `220 mm` deep matching inspo photo!)
  const longRailW = legCx * 2 - legTopW - 0.004;
  const longRailH = 0.115;
  const railT = 0.026;
  for (const [zTag, sz] of [
    ['Rear', -1],
    ['Front', 1],
  ] as const) {
    const apronGeo = prepGeo(
      applyMetricBoxUVs(new THREE.BoxGeometry(longRailW, longRailH, railT), {
        tileW: 0.9,
        tileH: 0.9,
        topTileV: 0.9,
      })
    );
    const apronMesh = new THREE.Mesh(apronGeo, oakMat);
    apronMesh.name = `${namePrefix}.oakApron${zTag}`;
    apronMesh.position.set(0, frameTopY - longRailH * 0.5 - 0.003, sz * legCz);
    apronMesh.castShadow = true;
    apronMesh.receiveShadow = true;
    root.add(apronMesh);
  }
  const endApronD = legCz * 2 - legTopW - 0.004;
  const endApronH = 0.215;
  for (const [xTag, sx] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    const endGeo = prepGeo(
      applyMetricBoxUVs(new THREE.BoxGeometry(railT, endApronH, endApronD), {
        tileW: 0.9,
        tileH: 0.9,
        topTileV: 0.9,
      })
    );
    const endMesh = new THREE.Mesh(endGeo, oakMat);
    endMesh.name = `${namePrefix}.oakEndPanel${xTag}`;
    endMesh.position.set(sx * legCx, frameTopY - endApronH * 0.5 - 0.003, 0);
    endMesh.castShadow = true;
    endMesh.receiveShadow = true;
    root.add(endMesh);
  }
  // Inner recessed oak backer panel visible under the stool-side knee space (gives warm oak shadow depth like inspo photo)
  addNamedBox(
    root,
    `${namePrefix}.oakUnderTopSpine`,
    longRailW,
    0.19,
    0.022,
    0,
    frameTopY - 0.098,
    -0.08,
    boardOakMat
  );

  // Tabletop editorial styling matching /tmp/neptune_kitchen_inspo.png
  if (opts.includeTabletopStyling ?? true) {
    const topY = totalH + 0.0005;
    // Right-centre: thick end-grain oak chopping board (`540 x 360 x 32 mm`) + white ceramic bowl + crusty artisan loaf
    addNamedBox(
      root,
      `${namePrefix}.oakChoppingBoard`,
      0.54,
      0.032,
      0.36,
      0.34,
      topY + 0.016,
      0.05,
      boardOakMat
    );
    const bowlPts = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.038, 0.0),
      new THREE.Vector2(0.068, 0.036),
      new THREE.Vector2(0.078, 0.072),
      new THREE.Vector2(0.072, 0.072),
      new THREE.Vector2(0.061, 0.038),
      new THREE.Vector2(0.032, 0.008),
      new THREE.Vector2(0.0, 0.008),
    ];
    const bowl = new THREE.Mesh(prepGeo(new THREE.LatheGeometry(bowlPts, 24)), ceramicMat);
    bowl.name = `${namePrefix}.ceramicPrepBowl`;
    bowl.position.set(0.28, topY + 0.033, 0.14);
    bowl.castShadow = true;
    root.add(bowl);

    // Crusty golden-baked artisan boule / baguette on chopping board
    const loaf = new THREE.Mesh(prepGeo(new THREE.SphereGeometry(0.115, 18, 14)), crustMat);
    loaf.name = `${namePrefix}.artisanCrustyLoaf`;
    loaf.scale.set(1.35, 0.62, 0.85);
    loaf.position.set(0.45, topY + 0.068, 0.01);
    loaf.rotation.y = 0.28;
    loaf.castShadow = true;
    root.add(loaf);
    const tear = new THREE.Mesh(prepGeo(new THREE.SphereGeometry(0.055, 12, 10)), crumbMat);
    tear.name = `${namePrefix}.artisanLoafCrumb`;
    tear.scale.set(1.1, 0.55, 0.8);
    tear.position.set(0.38, topY + 0.075, 0.035);
    root.add(tear);

    // Left-front: folded weekend broadsheet newspaper / open magazine
    const paperLeft = addNamedBox(
      root,
      `${namePrefix}.broadsheetLeftPage`,
      0.24,
      0.012,
      0.31,
      -0.46,
      topY + 0.007,
      0.16,
      paperMat
    );
    paperLeft.rotation.y = 0.12;
    const paperRight = addNamedBox(
      root,
      `${namePrefix}.broadsheetRightPage`,
      0.23,
      0.014,
      0.3,
      -0.25,
      topY + 0.009,
      0.14,
      paperMat
    );
    paperRight.rotation.y = 0.08;
    paperRight.rotation.z = -0.04;
  }

  const out = finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
  return attachAssetMetadata(out, {
    name: 'Neptune Solid Pale Oak & Honed Carrara Architectural Prep Island Table',
    brand: 'Neptune',
    collection: 'Chichester / Arundel',
    sku: 'NEP-PREP-ISL-1850',
    finish: 'Pale European Oak & Honed Carrara Marble',
    category: 'joinery',
    dimensionsMm: mmFromMetres(totalW, totalD, totalH),
    productUrl: 'https://www.neptune.com/uk/kitchens/chichester/islands/',
  });
}

export interface WovenCordOakCounterStoolOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  readonly seatHeightM?: number;
  readonly interactions?: CatalogInteractionContext;
}

let cachedWovenPaperCordMat: THREE.MeshStandardMaterial | null = null;
function getWovenPaperCordMaterial(): THREE.MeshStandardMaterial {
  if (cachedWovenPaperCordMat) return cachedWovenPaperCordMat;
  const maps = getWovenFabricMaps('danish-paper-cord', 0xbfa072, 'kubu');
  cachedWovenPaperCordMat = new THREE.MeshStandardMaterial({
    name: 'catalog.wovenDanishPaperCord',
    color: 0xffffff,
    map: maps.colorMap,
    normalMap: maps.normalMap,
    normalScale: new THREE.Vector2(0.75, 0.75),
    roughnessMap: maps.roughnessMap,
    roughness: 0.88,
    metalness: 0.0,
  });
  return cachedWovenPaperCordMat;
}

/**
 * Solid Pale European Oak counter stool (`440 x 450 x 940 mm`, `650 mm` seat height) with
 * woven natural Danish paper-cord seat and 3-panel checkered woven paper-cord backrest (`SeatInteractable`).
 * Local origin `(0, 0, 0)` is centered at floor level (`y = 0`), facing `+Z` (backrest at `-Z`).
 */
export function buildWovenCordOakCounterStool(
  opts: WovenCordOakCounterStoolOptions = {}
): THREE.Group {
  const namePrefix = opts.name ?? 'wovenCordOakCounterStool';
  const seatH = opts.seatHeightM ?? 0.65;
  const backTopY = seatH + 0.29;
  const w = 0.43;
  const d = 0.43;
  const halfW = w * 0.5 - 0.022;
  const halfD = d * 0.5 - 0.022;

  const oakMat = getPaleEuropeanOakJoineryMaterial();
  const cordMat = getWovenPaperCordMaterial();
  const brassMat = getAgedBrassMaterial();

  const root = new THREE.Group();
  root.name = namePrefix;

  // Front legs (`y = 0 .. seatH`) & full-height slightly raked rear stiles (`y = 0 .. backTopY`)
  for (const [sTag, sx] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    addNamedCyl(
      root,
      `${namePrefix}.frontLeg${sTag}`,
      0.017,
      0.014,
      seatH,
      14,
      sx * halfW,
      seatH * 0.5,
      halfD,
      oakMat
    );
    const rearStile = addNamedCyl(
      root,
      `${namePrefix}.rearStile${sTag}`,
      0.018,
      0.014,
      backTopY,
      14,
      sx * halfW,
      backTopY * 0.5,
      -halfD,
      oakMat
    );
    rearStile.rotation.x = -0.025;
  }

  // Seat rails (`y = seatH - 0.024`) + woven Danish paper-cord envelope seat
  const railW = halfW * 2 - 0.024;
  const railD = halfD * 2 - 0.024;
  for (const [zTag, sz] of [
    ['Rear', -1],
    ['Front', 1],
  ] as const) {
    addNamedBox(root, `${namePrefix}.seatRail${zTag}`, railW, 0.028, 0.024, 0, seatH - 0.038, sz * halfD, oakMat);
  }
  for (const [xTag, sx] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    addNamedBox(root, `${namePrefix}.seatSideRail${xTag}`, 0.024, 0.028, railD, sx * halfW, seatH - 0.038, 0, oakMat);
  }
  // Woven cord seat pad wrapping cleanly over the rails
  addNamedBox(
    root,
    `${namePrefix}.wovenCordSeat`,
    w - 0.036,
    0.036,
    d - 0.028,
    0,
    seatH - 0.004,
    0.004,
    cordMat
  );

  // Perimeter footrest & side stretchers (`front footrest` at y = 0.22 with aged-brass kick wear strip)
  const frontFootY = 0.22;
  const sideFootY = 0.25;
  const frontRung = addNamedCyl(root, `${namePrefix}.frontFootrest`, 0.011, 0.011, railW, 12, 0, frontFootY, halfD, oakMat);
  frontRung.rotation.z = Math.PI * 0.5;
  addNamedBox(root, `${namePrefix}.brassKickPlate`, railW * 0.72, 0.003, 0.014, 0, frontFootY + 0.011, halfD, brassMat, true);
  const rearRung = addNamedCyl(root, `${namePrefix}.rearStretcher`, 0.011, 0.011, railW, 12, 0, frontFootY, -halfD, oakMat);
  rearRung.rotation.z = Math.PI * 0.5;
  for (const [xTag, sx] of [
    ['Left', -1],
    ['Right', 1],
  ] as const) {
    const sideRung = addNamedCyl(root, `${namePrefix}.sideStretcher${xTag}`, 0.011, 0.011, railD, 12, sx * halfW, sideFootY, 0, oakMat);
    sideRung.rotation.x = Math.PI * 0.5;
  }

  // Woven 3-panel checkered Danish paper-cord backrest (`y = seatH + 0.11 .. backTopY - 0.018`, matching inspo photo!)
  const backBandH = 0.145;
  const backBandCy = backTopY - 0.02 - backBandH * 0.5;
  const backZ = -halfD - 0.012;
  // Core backrest rail + 3 woven vertical/horizontal cord blocks for authentic checkered webbing relief
  addNamedBox(
    root,
    `${namePrefix}.wovenCordBackCore`,
    railW + 0.008,
    backBandH - 0.012,
    0.024,
    0,
    backBandCy,
    backZ,
    cordMat
  );
  const blockW = (railW - 0.016) / 3;
  for (let bi = 0; bi < 3; bi++) {
    const bx = -railW * 0.5 + 0.008 + (bi + 0.5) * blockW;
    const block = addNamedBox(
      root,
      `${namePrefix}.wovenBackPanel_${bi + 1}`,
      blockW - 0.006,
      backBandH,
      0.032,
      bx,
      backBandCy,
      backZ,
      cordMat
    );
    if (bi === 1) {
      // Subtle grain orientation contrast on middle woven block
      block.scale.y = 0.96;
    }
  }

  const out = finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
  const registry = resolveRegistry(opts.interactions);
  if (registry) {
    const seatInteractable = new SeatInteractable({
      id: `${namePrefix}.seat`,
      label: 'Woven Paper-Cord & Oak Counter Stool',
      aliases: [namePrefix],
      anchor: out,
      clickableTargets: collectSeatClickableMeshes(out),
      localSeatPos: [0, seatH + 0.018, 0.01],
      localFootOffset: [0, 0, 0.48],
      localForward: [0, 0, 1],
      seatedEyeHeightM: 0.72,
      proximityRadiusM: 0.85,
      material: 'linen',
    });
    out.userData.seatInteractable = seatInteractable;
    registry.registerAnimatedInteractable(seatInteractable);
  }

  return attachAssetMetadata(out, {
    name: 'Neptune / Cox & Cox Woven Paper-Cord & Pale Oak Counter Stool',
    brand: 'Neptune',
    collection: 'Arundel / Wardley',
    sku: 'NEP-CORD-STL-650',
    finish: 'Pale European Oak & Natural Woven Paper Cord',
    category: 'furniture',
    dimensionsMm: mmFromMetres(w, d, backTopY),
    productUrl: 'https://www.neptune.com/uk/furniture/dining-chairs-and-stools/bar-and-counter-stools/',
  });
}

export interface PaintedCorbelKitchenShelfOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  readonly widthM?: number;
  readonly depthM?: number;
  readonly paintColor?: THREE.ColorRepresentation;
  readonly includeCrockery?: boolean;
}

/**
 * Open painted timber wall shelf on shaped Georgian corbel brackets, styled with
 * stacked white fluted stoneware bowls, dinner plates & blown-glass water pitcher.
 * Local origin `(0, 0, 0)` is on the wall (`z = 0`) at shelf-underside level (`y = 0`), centered in `X`, projecting `+Z`.
 */
export function buildPaintedCorbelKitchenShelf(
  opts: PaintedCorbelKitchenShelfOptions = {}
): THREE.Group {
  const namePrefix = opts.name ?? 'paintedCorbelKitchenShelf';
  const w = opts.widthM ?? 1.42;
  const d = opts.depthM ?? 0.24;
  const shelfT = 0.032;

  const paintMat = getPaintedJoineryMaterial(
    opts.paintColor ?? 0x92978b,
    0.52,
    `${namePrefix}.paint`
  );
  const ceramicMat = getHeavyFireclayMaterial();
  const glassMat = getClearArchitecturalGlassMaterial();

  const root = new THREE.Group();
  root.name = namePrefix;

  addNamedBox(root, `${namePrefix}.shelfPlank`, w, shelfT, d, 0, shelfT * 0.5, d * 0.5, paintMat);

  // Shaped timber corbel brackets (`y = -0.18 .. 0`)
  const bracketOffset = w * 0.5 - 0.14;
  for (const [bTag, bx] of [
    ['Left', -bracketOffset],
    ['Right', bracketOffset],
  ] as const) {
    addNamedBox(root, `${namePrefix}.corbelBack${bTag}`, 0.034, 0.18, 0.026, bx, -0.09, 0.013, paintMat);
    addNamedBox(root, `${namePrefix}.corbelTopArm${bTag}`, 0.032, 0.026, d - 0.055, bx, -0.014, 0.027 + (d - 0.055) * 0.5, paintMat);
    const strut = addNamedBox(root, `${namePrefix}.corbelBrace${bTag}`, 0.028, 0.17, 0.026, bx, -0.088, 0.088, paintMat);
    strut.rotation.x = 0.72;
  }

  if (opts.includeCrockery ?? true) {
    const topY = shelfT + 0.0005;
    // Left stack of 4 dinner plates
    for (let pi = 0; pi < 4; pi++) {
      addNamedCyl(
        root,
        `${namePrefix}.plateLeft_${pi + 1}`,
        0.115,
        0.092,
        0.013,
        22,
        -w * 0.34,
        topY + 0.007 + pi * 0.014,
        d * 0.52,
        ceramicMat
      );
    }
    // Centre-left stack of 3 fluted soup/cereal bowls
    for (let bi = 0; bi < 3; bi++) {
      addNamedCyl(
        root,
        `${namePrefix}.flutedBowl_${bi + 1}`,
        0.082 + bi * 0.003,
        0.056,
        0.038,
        20,
        -w * 0.11,
        topY + 0.019 + bi * 0.026,
        d * 0.52,
        ceramicMat
      );
    }
    // Centre-right stack of 4 side plates
    for (let pi = 0; pi < 4; pi++) {
      addNamedCyl(
        root,
        `${namePrefix}.sidePlate_${pi + 1}`,
        0.098,
        0.078,
        0.012,
        20,
        w * 0.13,
        topY + 0.006 + pi * 0.013,
        d * 0.52,
        ceramicMat
      );
    }
    // Right blown-glass water pitcher
    const jugPts = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.048, 0.0),
      new THREE.Vector2(0.064, 0.065),
      new THREE.Vector2(0.052, 0.145),
      new THREE.Vector2(0.058, 0.185),
      new THREE.Vector2(0.054, 0.185),
      new THREE.Vector2(0.048, 0.145),
      new THREE.Vector2(0.059, 0.065),
      new THREE.Vector2(0.042, 0.006),
      new THREE.Vector2(0.0, 0.006),
    ];
    const pitcher = new THREE.Mesh(prepGeo(new THREE.LatheGeometry(jugPts, 22)), glassMat);
    pitcher.name = `${namePrefix}.glassPitcher`;
    pitcher.position.set(w * 0.34, topY, d * 0.52);
    root.add(pitcher);
  }

  return finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
}
