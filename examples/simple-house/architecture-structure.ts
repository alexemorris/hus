import * as THREE from 'three';
import type { CutawayWallDescriptor } from 'husjs';
import { applyMetricBoxUVs, type RoomPaintScheme } from 'husjs/materials';
import { createWallNetwork, prepGeo, tagCutaway } from 'husjs/objects';
import {
  getBathStoneMaterial,
  getPaleEuropeanOakJoineryMaterial,
} from 'husjs/catalog/architectural';
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

/** Ground-floor Drawing Room chimney breast envelope (`West` stack, centered at `Z = 0.00`). */
export const DRAWING_BREAST = { minX: -IN_X, maxX: -6.61, minZ: -0.95, maxZ: 0.95 } as const;
/** First-floor Principal Bedroom gathered flue chimney breast (`West` stack, centered at `Z = 0.00`, vertically continuous!). */
export const PRINCIPAL_BREAST = { minX: -IN_X + 0.006, maxX: -6.73, minZ: -0.65, maxZ: 0.65 } as const;
/** First-floor Study chimney breast directly over Kitchen range Inglenook (`East` stack, centered at `Z = -1.64`). */
export const STUDY_BREAST = { minX: 6.71, maxX: IN_X - 0.006, minZ: -2.34, maxZ: -0.94 } as const;

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

/**
 * Wraps a structural steel UB RSJ in weathered character-oak flitch beam cladding
 * with subtle forged-iron/aged-brass strap & bolted flitch plates (zero z-fight!).
 */
function addCharacterOakFlitchCladding(
  parent: THREE.Object3D,
  name: string,
  x0: number,
  x1: number,
  cz: number,
  topY: number,
  beamDepthM: number,
  cladWidthM: number,
  oakMat: THREE.Material,
  ironStrapMat: THREE.Material,
  strapXs: readonly number[]
): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  const spanX = x1 - x0;
  const cx = (x0 + x1) * 0.5;
  const sideBoardT = 0.022;
  const soffitBoardT = 0.022;
  const sideH = beamDepthM;
  const soffitY = topY - sideH - soffitBoardT * 0.5 - 0.001;

  const addOakBoard = (part: string, size: [number, number, number], pos: [number, number, number]) => {
    const geo = prepGeo(applyMetricBoxUVs(new THREE.BoxGeometry(size[0], size[1], size[2]), { tileW: 1.4, tileH: 0.35 }));
    const m = new THREE.Mesh(geo, oakMat);
    m.name = `${name}.${part}`;
    m.position.set(pos[0], pos[1], pos[2]);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  };

  for (const [tag, s] of [['northCheek', -1], ['southCheek', 1]] as const) {
    addOakBoard(tag, [spanX, sideH, sideBoardT], [cx, topY - sideH * 0.5, cz + s * (cladWidthM * 0.5 - sideBoardT * 0.5)]);
  }
  addOakBoard('soffitPlank', [spanX, soffitBoardT, cladWidthM + 0.006], [cx, soffitY, cz]);

  // Forged blackened-iron flitch U-straps & square coach bolts
  const strapW = 0.044;
  const strapT = 0.005;
  const totalCladH = sideH + soffitBoardT + 0.002;
  strapXs.forEach((sx, idx) => {
    const sTag = `flitchStrap_${idx + 1}`;
    box(group, `${name}.${sTag}.soffit`, [strapW, strapT, cladWidthM + 0.018], [sx, topY - totalCladH - strapT * 0.5 - 0.0008, cz], ironStrapMat);
    for (const [fTag, s] of [['n', -1], ['s', 1]] as const) {
      const fz = cz + s * (cladWidthM * 0.5 + strapT * 0.5 + 0.0008);
      box(group, `${name}.${sTag}.cheek_${fTag}`, [strapW, totalCladH - 0.014, strapT], [sx, topY - (totalCladH + 0.014) * 0.5, fz], ironStrapMat);
      for (const [bIdx, by] of [[1, topY - 0.065], [2, topY - totalCladH + 0.055]] as const) {
        box(group, `${name}.${sTag}.bolt_${fTag}_${bIdx}`, [0.016, 0.016, 0.008], [sx, by, fz + s * (strapT * 0.5 + 0.0045)], ironStrapMat);
      }
    }
  });

  parent.add(group);
  return group;
}

export function buildSimpleHouseStructureAndBreasts(
  tc: TrimAndStructureContext,
  steelMat: THREE.Material
): void {
  const { groundGroup, firstGroup, schemes, cut } = tc;
  const padstoneMat = getBathStoneMaterial();
  const characterOakMat = getPaleEuropeanOakJoineryMaterial();
  const forgedIronMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.structure.forgedFlitchIron',
    color: 0x2a2c2e,
    roughness: 0.48,
    metalness: 0.76,
  });
  const eastCutGround = cut('east', 'ground');

  // Primary Open-Plan Knock-Through Steel Beam: 254 x 146 x 37 UB at Z = -0.16 m (`X ∈ [1.894, 7.042]`)
  const spineRsjTopY = GROUND_CEILING_SOFFIT_Y - 0.001; // 2.829
  const spineRsjBotY = spineRsjTopY - 0.254; // 2.575
  const kitchenSpineRsj = buildUniversalBeam({
    name: 'simpleHouse.structure.kitchenSpineRsj',
    x0: 1.894,
    x1: 7.042,
    cz: -0.16,
    topY: spineRsjTopY,
    depthM: 0.254,
    flangeWidthM: 0.146,
    flangeThickM: 0.0109,
    webThickM: 0.0063,
    stiffenerXs: [2.05, 3.35, 4.58, 5.82, 6.91],
    steelMat,
  });
  addCharacterOakFlitchCladding(
    kitchenSpineRsj,
    'simpleHouse.structure.kitchenSpineOakCladding',
    1.896,
    7.040,
    -0.16,
    spineRsjTopY - 0.001,
    0.256,
    0.214,
    characterOakMat,
    forgedIronMat,
    [2.55, 3.82, 5.10, 6.38]
  );
  groundGroup.add(kitchenSpineRsj);

  // Engaged load-bearing masonry nib piers + tooled Bath-stone padstones under 254 x 146 UB
  const pierWest = new THREE.Group();
  pierWest.name = 'simpleHouse.structure.kitchenRsjPierWest';
  const padH = 0.115;
  const pierBotH = spineRsjBotY - 0.025 - padH - 0.006; // clear below oak soffit
  box(pierWest, `${pierWest.name}.masonryShaft`, [0.178, pierBotH, 0.28], [1.892 + 0.089, 0.002 + pierBotH * 0.5, -0.16], schemes.houseKitchenDiner.walls);
  box(pierWest, `${pierWest.name}.padstone`, [0.186, padH, 0.292], [1.892 + 0.093, 0.003 + pierBotH + padH * 0.5, -0.16], padstoneMat, 1.0);
  groundGroup.add(pierWest);

  const pierEast = new THREE.Group();
  pierEast.name = 'simpleHouse.structure.kitchenRsjPierEast';
  box(pierEast, `${pierEast.name}.masonryShaft`, [0.134, pierBotH, 0.24], [7.044 - 0.067, 0.002 + pierBotH * 0.5, -0.16], schemes.houseKitchenDiner.walls);
  box(pierEast, `${pierEast.name}.padstone`, [0.142, padH, 0.252], [7.044 - 0.071, 0.003 + pierBotH + padH * 0.5, -0.16], padstoneMat, 1.0);
  tagCutaway(pierEast, eastCutGround);
  groundGroup.add(pierEast);

  // Secondary Structural Steel Beam: 203 x 133 x 25 UB at Z = -1.59 m (`X ∈ [1.894, 6.378]` to Inglenook breast)
  const northRsjTopY = GROUND_CEILING_SOFFIT_Y - 0.001; // 2.829
  const northRsjBotY = northRsjTopY - 0.203; // 2.626
  const kitchenNorthRsj = buildUniversalBeam({
    name: 'simpleHouse.structure.kitchenNorthRsj',
    x0: 1.894,
    x1: 6.378,
    cz: -1.59,
    topY: northRsjTopY,
    depthM: 0.203,
    flangeWidthM: 0.133,
    flangeThickM: 0.0078,
    webThickM: 0.0058,
    stiffenerXs: [2.04, 3.18, 4.26, 5.34, 6.26],
    steelMat,
  });
  addCharacterOakFlitchCladding(
    kitchenNorthRsj,
    'simpleHouse.structure.kitchenNorthOakCladding',
    1.896,
    6.376,
    -1.59,
    northRsjTopY - 0.001,
    0.205,
    0.194,
    characterOakMat,
    forgedIronMat,
    [2.65, 4.14, 5.62]
  );
  groundGroup.add(kitchenNorthRsj);

  const northPadH = 0.105;
  const northPadCy = northRsjBotY - 0.025 - northPadH * 0.5 - 0.003;
  box(groundGroup, 'simpleHouse.structure.kitchenNorthPadstoneWest', [0.11, northPadH, 0.22], [1.892 + 0.055, northPadCy, -1.59], padstoneMat, 1.0);
  box(groundGroup, 'simpleHouse.structure.kitchenNorthPadstoneEast', [0.095, northPadH, 0.22], [6.38 - 0.0475, northPadCy, -1.59], padstoneMat, 1.0);

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
  tagCutaway(studyBreastGroup, cut('east', 'first'));
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
