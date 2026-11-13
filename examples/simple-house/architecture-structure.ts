import * as THREE from 'three';
import type { CutawayWallDescriptor } from 'husjs';
import type { RoomPaintScheme } from 'husjs/materials';
import { createWallNetwork, tagCutaway } from 'husjs/objects';
import { getBathStoneMaterial } from 'husjs/catalog/architectural';
import {
  FFL_FIRST,
  FIRST_CEILING_SOFFIT_Y,
  GROUND_CEILING_SOFFIT_Y,
} from './electrical-and-rooms.ts';
import {
  box,
  type FloorId,
  type Side,
  type SimpleHouseRoomSchemeKey,
} from './architecture-materials.ts';
import { IN_X } from './architecture-openings.ts';

/** Ground-floor Drawing Room chimney breast envelope (`West` stack). */
export const DRAWING_BREAST = { minX: -IN_X, maxX: -4.98, minZ: -0.95, maxZ: 0.95 } as const;
/** First-floor Principal Bedroom gathered flue chimney breast (`West` stack). */
export const PRINCIPAL_BREAST = { minX: -IN_X + 0.006, maxX: -5.1, minZ: -1.41, maxZ: -0.46 } as const;
/** First-floor Study chimney breast directly over Kitchen range Inglenook (`East` stack, `Z = -1.64`). */
export const STUDY_BREAST = { minX: 5.08, maxX: IN_X - 0.006, minZ: -2.34, maxZ: -0.94 } as const;

export interface TrimAndStructureContext {
  readonly groundGroup: THREE.Object3D;
  readonly groundCeilingGroup: THREE.Object3D;
  readonly firstGroup: THREE.Object3D;
  readonly firstCeilingGroup: THREE.Object3D;
  readonly floorGroups: Readonly<Record<FloorId, THREE.Object3D>>;
  readonly floorY: Readonly<Record<FloorId, number>>;
  readonly groundNet: ReturnType<typeof createWallNetwork>;
  readonly firstNet: ReturnType<typeof createWallNetwork>;
  readonly schemes: Readonly<Record<SimpleHouseRoomSchemeKey, RoomPaintScheme>>;
  readonly cut: (side: Side, floor: FloorId) => CutawayWallDescriptor;
}

function buildUniversalBeam(opts: {
  readonly name: string;
  readonly x0: number;
  readonly x1: number;
  readonly cz: number;
  readonly topY: number;
  readonly depthM: number;
  readonly flangeWidthM: number;
  readonly flangeThickM: number;
  readonly webThickM: number;
  readonly stiffenerXs: readonly number[];
  readonly steelMat: THREE.Material;
}): THREE.Group {
  const group = new THREE.Group();
  group.name = opts.name;

  const endPlateT = 0.012;
  const spanX = opts.x1 - opts.x0 - endPlateT * 2;
  const cx = (opts.x0 + opts.x1) * 0.5;
  const botY = opts.topY - opts.depthM;
  const webH = opts.depthM - opts.flangeThickM * 2;

  box(group, `${opts.name}.topFlange`, [spanX, opts.flangeThickM, opts.flangeWidthM], [cx, opts.topY - opts.flangeThickM * 0.5, opts.cz], opts.steelMat);
  box(group, `${opts.name}.bottomFlange`, [spanX, opts.flangeThickM, opts.flangeWidthM], [cx, botY + opts.flangeThickM * 0.5, opts.cz], opts.steelMat);
  box(group, `${opts.name}.web`, [spanX, webH, opts.webThickM], [cx, botY + opts.depthM * 0.5, opts.cz], opts.steelMat);

  // Full-depth welded web stiffeners on both sides of the web
  const stiffD = (opts.flangeWidthM - opts.webThickM) * 0.5 - 0.004;
  const stiffH = webH - 0.002;
  opts.stiffenerXs.forEach((sx, idx) => {
    for (const s of [-1, 1] as const) {
      box(
        group,
        `${opts.name}.stiffener_${idx + 1}_${s < 0 ? 'n' : 's'}`,
        [0.008, stiffH, stiffD],
        [sx, botY + opts.depthM * 0.5, opts.cz + s * (opts.webThickM * 0.5 + stiffD * 0.5 + 0.001)],
        opts.steelMat
      );
    }
  });

  // Bolted end-plates at West & East bearings
  for (const [tag, ex, boltSign] of [
    ['west', opts.x0 + endPlateT * 0.5, 1],
    ['east', opts.x1 - endPlateT * 0.5, -1],
  ] as const) {
    box(group, `${opts.name}.endPlate_${tag}`, [endPlateT, opts.depthM - 0.004, opts.flangeWidthM + 0.012], [ex, botY + opts.depthM * 0.5, opts.cz], opts.steelMat);
    for (const [bIdx, by, bz] of [
      [1, botY + 0.048, opts.cz - opts.flangeWidthM * 0.3],
      [2, botY + 0.048, opts.cz + opts.flangeWidthM * 0.3],
      [3, opts.topY - 0.048, opts.cz - opts.flangeWidthM * 0.3],
      [4, opts.topY - 0.048, opts.cz + opts.flangeWidthM * 0.3],
    ] as const) {
      box(group, `${opts.name}.bolt_${tag}_${bIdx}`, [0.01, 0.018, 0.018], [ex + boltSign * (endPlateT * 0.5 + 0.006), by, bz], opts.steelMat);
    }
  }

  return group;
}

export function buildSimpleHouseStructureAndBreasts(
  tc: TrimAndStructureContext,
  steelMat: THREE.Material
): void {
  const { groundGroup, firstGroup, schemes, cut } = tc;
  const padstoneMat = getBathStoneMaterial();
  const eastCutGround = cut('east', 'ground');

  // Primary Open-Plan Knock-Through Steel Beam: 254 x 146 x 37 UB at Z = -0.16 m
  const spineRsjTopY = GROUND_CEILING_SOFFIT_Y - 0.001; // 2.829
  const spineRsjBotY = spineRsjTopY - 0.254; // 2.575
  const kitchenSpineRsj = buildUniversalBeam({
    name: 'simpleHouse.structure.kitchenSpineRsj',
    x0: 1.394,
    x1: 5.412,
    cz: -0.16,
    topY: spineRsjTopY,
    depthM: 0.254,
    flangeWidthM: 0.146,
    flangeThickM: 0.0109,
    webThickM: 0.0063,
    stiffenerXs: [1.51, 2.74, 4.07, 5.31],
    steelMat,
  });
  groundGroup.add(kitchenSpineRsj);

  // Engaged load-bearing masonry nib piers + tooled Bath-stone padstones under 254 x 146 UB
  const pierWest = new THREE.Group();
  pierWest.name = 'simpleHouse.structure.kitchenRsjPierWest';
  const padH = 0.115;
  const pierTopY = spineRsjBotY - padH - 0.004; // 2.456
  box(pierWest, `${pierWest.name}.masonryShaft`, [0.178, pierTopY - 0.002, 0.28], [1.392 + 0.089, 0.002 + (pierTopY - 0.002) * 0.5, -0.16], schemes.houseKitchenDiner.walls);
  box(pierWest, `${pierWest.name}.padstone`, [0.186, padH, 0.292], [1.392 + 0.093, spineRsjBotY - 0.002 - padH * 0.5, -0.16], padstoneMat, 1.0);
  groundGroup.add(pierWest);

  const pierEast = new THREE.Group();
  pierEast.name = 'simpleHouse.structure.kitchenRsjPierEast';
  box(pierEast, `${pierEast.name}.masonryShaft`, [0.134, pierTopY - 0.002, 0.24], [5.414 - 0.067, 0.002 + (pierTopY - 0.002) * 0.5, -0.16], schemes.houseKitchenDiner.walls);
  box(pierEast, `${pierEast.name}.padstone`, [0.142, padH, 0.252], [5.414 - 0.071, spineRsjBotY - 0.002 - padH * 0.5, -0.16], padstoneMat, 1.0);
  tagCutaway(pierEast, eastCutGround);
  groundGroup.add(pierEast);

  // Secondary Structural Steel Beam: 203 x 133 x 25 UB at Z = -1.59 m (X in [1.394, 4.748])
  const northRsjTopY = GROUND_CEILING_SOFFIT_Y - 0.001; // 2.829
  const northRsjBotY = northRsjTopY - 0.203; // 2.626
  const kitchenNorthRsj = buildUniversalBeam({
    name: 'simpleHouse.structure.kitchenNorthRsj',
    x0: 1.394,
    x1: 4.748,
    cz: -1.59,
    topY: northRsjTopY,
    depthM: 0.203,
    flangeWidthM: 0.133,
    flangeThickM: 0.0078,
    webThickM: 0.0058,
    stiffenerXs: [1.49, 2.41, 3.58, 4.66],
    steelMat,
  });
  groundGroup.add(kitchenNorthRsj);

  const northPadH = 0.105;
  box(groundGroup, 'simpleHouse.structure.kitchenNorthPadstoneWest', [0.11, northPadH, 0.21], [1.392 + 0.055, northRsjBotY - 0.002 - northPadH * 0.5, -1.59], padstoneMat, 1.0);
  box(groundGroup, 'simpleHouse.structure.kitchenNorthPadstoneEast', [0.095, northPadH, 0.21], [4.75 - 0.0475, northRsjBotY - 0.002 - northPadH * 0.5, -1.59], padstoneMat, 1.0);

  // Vertically Continuous First-Floor Masonry Chimney Breasts (solid closed volumes)
  const ffBreastH = FIRST_CEILING_SOFFIT_Y - FFL_FIRST - 0.004;
  const ffBreastCy = FFL_FIRST + 0.002 + ffBreastH * 0.5;

  const studyBreastGroup = new THREE.Group();
  studyBreastGroup.name = 'simpleHouse.study.chimneyBreast';
  studyBreastGroup.userData.zoneId = 'houseStudy';
  box(
    studyBreastGroup,
    'simpleHouse.study.chimneyBreast.masonry',
    [STUDY_BREAST.maxX - STUDY_BREAST.minX, ffBreastH, STUDY_BREAST.maxZ - STUDY_BREAST.minZ],
    [(STUDY_BREAST.minX + STUDY_BREAST.maxX) * 0.5, ffBreastCy, (STUDY_BREAST.minZ + STUDY_BREAST.maxZ) * 0.5],
    schemes.houseStudy.walls
  );
  firstGroup.add(studyBreastGroup);

  const principalBreastGroup = new THREE.Group();
  principalBreastGroup.name = 'simpleHouse.principal.chimneyBreast';
  principalBreastGroup.userData.zoneId = 'housePrincipalBed';
  box(
    principalBreastGroup,
    'simpleHouse.principal.chimneyBreast.masonry',
    [PRINCIPAL_BREAST.maxX - PRINCIPAL_BREAST.minX, ffBreastH, PRINCIPAL_BREAST.maxZ - PRINCIPAL_BREAST.minZ],
    [(PRINCIPAL_BREAST.minX + PRINCIPAL_BREAST.maxX) * 0.5, ffBreastCy, (PRINCIPAL_BREAST.minZ + PRINCIPAL_BREAST.maxZ) * 0.5],
    schemes.housePrincipalBed.walls
  );
  tagCutaway(principalBreastGroup, cut('west', 'first'));
  firstGroup.add(principalBreastGroup);
}
