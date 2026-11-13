import * as THREE from 'three';
import type { CircuitId, CutawayWallDescriptor } from 'husjs';
import { createBrickMaterial, createStoneMasonryMaterial, type RoomPaintScheme } from 'husjs/materials';
import {
  createFloorSlab,
  createGeorgianSashWindow,
  createHippedRoof,
  createWallNetwork,
  tagCollisionRole,
  tagCutaway,
} from 'husjs/objects';
import {
  buildChequerboardMarbleFloor,
  buildGeorgianFacadeDressings,
  buildGeorgianTuscanPorticoAndDoor,
  createHandmadeOliveMetroTileMaterial,
  getBathStoneMaterial,
} from 'husjs/catalog/architectural';
import { buildGeorgianCoachLantern } from 'husjs/catalog/lighting';
import { getBathroomBrassMaterials } from 'husjs/catalog/sanitaryware';
import type { SceneBuilderContext } from 'husjs/viewer';
import {
  EXT_WALL_T,
  FFL_FIRST,
  FFL_GROUND,
  FIRST_CEILING_SOFFIT_Y,
  GROUND_CEILING_SOFFIT_Y,
  HALF_D,
  HALF_W,
  INT_WALL_T,
} from './electrical-and-rooms.ts';
import {
  box,
  createSimpleHouseFloorMaterials,
  createSimpleHouseSchemes,
  type FloorId,
  type Side,
  type SimpleHouseRoomSchemeKey,
} from './architecture-materials.ts';
import {
  BOOT_GARDEN_DOOR,
  DOORS,
  DRAWING_FRENCH_DOOR,
  DRESSING_STANDOFF_M,
  FRENCH_DOOR,
  FRONT_DOOR,
  HALL_PARTITION_X,
  IN_X,
  IN_Z,
  PARTITIONS,
  STAIRWELL_CROSS_Z,
  WINDOWS,
  addFrenchDoors,
  addInteriorDoor,
  addRearGardenBootDoor as addRearBootGardenDoor,
  buildFrontDoorInteriorSurround,
  buildSplitRainwaterDownpipeSegment,
  partitionOpenings,
  placeOnFacade,
  wallOffset,
  windowOpenings,
} from './architecture-openings.ts';
import {
  DRAWING_BREAST,
  PRINCIPAL_BREAST,
  STUDY_BREAST,
  buildSimpleHouseStructureAndBreasts,
  type TrimAndStructureContext,
} from './architecture-structure.ts';
import { buildSimpleHouseTrim } from './architecture-trim.ts';
import type { SimpleHouseStair } from './staircase-and-hall.ts';

export {
  DRAWING_BREAST,
  HALL_PARTITION_X,
  IN_X,
  IN_Z,
  PRINCIPAL_BREAST,
  STAIRWELL_CROSS_Z,
  STUDY_BREAST,
  type SimpleHouseRoomSchemeKey,
};

/** Roof springs slightly above the masonry head so the slates sail over the stone eaves cornice. */
export const ROOF_EAVES_Y = 5.81;

/** Ground-floor walls & partitions share a single crisp Y = 2.83 m cutaway poché plane (0 mm step). */
const GROUND_WALL_H = GROUND_CEILING_SOFFIT_Y - FFL_GROUND; // 2.83
const GROUND_PARTITION_H = GROUND_CEILING_SOFFIT_Y - FFL_GROUND; // 2.83
/** Inter-floor exterior brick course spanning Y = 2.83..3.05 m inside `firstSlabGroup`. */
const INTERFLOOR_BAND_H = FFL_FIRST - GROUND_CEILING_SOFFIT_Y; // 0.22
const FIRST_WALL_H = 2.57;
const FIRST_PARTITION_H = FIRST_CEILING_SOFFIT_Y - FFL_FIRST - 0.002;

/**
 * Classical Georgian window-tax blind sash relief (`2 mm` stepped depth planes so 0 z-fight!)
 * balancing the East-flank sash windows without piercing interior West-flank alcove joinery.
 */
function buildGeorgianBlindSashRelief(opts: {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly trimMat: THREE.Material;
  readonly stoneMat: THREE.Material;
  readonly slateBlindMat: THREE.Material;
  readonly lintelBrickMat: THREE.Material;
}): THREE.Group {
  const { name, width, height, trimMat, stoneMat, slateBlindMat, lintelBrickMat } = opts;
  const group = new THREE.Group();
  group.name = name;

  // Local +Z projects outward from West brick face (`X = -HALF_W - 0.003` with `rotationY = -Math.PI / 2`)
  box(group, `${name}.yorkstoneSill`, [width + 0.14, 0.075, 0.068], [0, -0.0385, 0.034], stoneMat, 1.0);
  box(group, `${name}.flatArchLintel`, [width + 0.16, 0.21, 0.032], [0, height + 0.106, 0.016], lintelBrickMat, 1.0);
  box(group, `${name}.stoneKeystone`, [0.13, 0.23, 0.04], [0, height + 0.111, 0.022], stoneMat, 1.0);

  // Outer ovolo box frame: z ∈ [0.000, 0.024]
  const stileW = 0.058;
  const innerW = width - stileW * 2;
  const innerH = height - stileW * 2;
  box(group, `${name}.frameHead`, [width, stileW, 0.024], [0, height - stileW * 0.5, 0.012], trimMat);
  box(group, `${name}.frameSill`, [width, stileW, 0.024], [0, stileW * 0.5, 0.012], trimMat);
  for (const [tag, s] of [['left', -1], ['right', 1]] as const) {
    box(group, `${name}.frameStile_${tag}`, [stileW, innerH - 0.002, 0.024], [s * (width - stileW) * 0.5, height * 0.5, 0.012], trimMat);
  }

  // Dark Welsh-slate blind backing: z ∈ [0.004, 0.018] (front 0.018)
  box(group, `${name}.slateBacking`, [innerW - 0.004, innerH - 0.004, 0.014], [0, height * 0.5, 0.011], slateBlindMat);

  // Horizontal glazing bars: z ∈ [0.020, 0.028] (2 mm clear of slate 0.018)
  for (const [tag, sy] of [['bot', height * 0.26], ['top', height * 0.74]] as const) {
    box(group, `${name}.glazingBarH_${tag}`, [innerW - 0.006, 0.018, 0.008], [0, sy, 0.024], trimMat);
  }

  // Vertical glazing bars: z ∈ [0.030, 0.036] (2 mm proud of horizontal bars 0.028 -> 0 crossing z-fight)
  const colStep = innerW / 3;
  for (const [tag, sx] of [['a', -colStep * 0.5], ['b', colStep * 0.5]] as const) {
    box(group, `${name}.glazingBarV_${tag}`, [0.018, innerH - 0.006, 0.006], [sx, height * 0.5, 0.033], trimMat);
  }

  // Meeting rail: z ∈ [0.038, 0.046] (2 mm proud of vertical bars 0.036)
  box(group, `${name}.meetingRail`, [innerW - 0.002, 0.034, 0.008], [0, height * 0.5, 0.042], trimMat);

  return group;
}

export interface SimpleHouseShell {
  /** Whole-elevation cutaway descriptor for wall-hung fittings. */
  cut(side: Side, floor: FloorId): CutawayWallDescriptor;
  readonly plasterMat: THREE.Material;
  readonly trimMat: THREE.Material;
  readonly schemes: Readonly<Record<SimpleHouseRoomSchemeKey, RoomPaintScheme>>;
}

export function buildSimpleHouseArchitecture(
  ctx: SceneBuilderContext,
  _stair: SimpleHouseStair
): SimpleHouseShell {
  const groundGroup = ctx.floor ? ctx.floor('ground').group : ctx.scene;
  const groundSlabGroup = ctx.floor ? ctx.floor('ground').slabGroup : ctx.scene;
  const groundCeilingGroup = ctx.floor ? ctx.floor('ground').ceilingGroup : ctx.groundFloorCeilingGroup;
  const firstGroup = ctx.floor ? ctx.floor('first').group : ctx.firstFloorMeshGroup;
  const firstSlabGroup = ctx.floor ? ctx.floor('first').slabGroup : ctx.firstFloorMeshGroup;
  const firstCeilingGroup = ctx.floor ? ctx.floor('first').ceilingGroup : ctx.ceilingMeshGroup;
  const roofGroup = ctx.roof ?? ctx.ceilingMeshGroup;
  const floorGroups: Record<FloorId, THREE.Object3D> = { ground: groundGroup, first: firstGroup };
  const floorY: Record<FloorId, number> = { ground: FFL_GROUND, first: FFL_FIRST };

  const schemes = createSimpleHouseSchemes();
  const brickMat = createBrickMaterial({ preset: 'heritage-red-flemish', bond: 'flemish' });
  const slateMat = createStoneMasonryMaterial('welsh-slate-roof');
  const stoneMat = getBathStoneMaterial();
  const plasterMat = schemes.houseHall.walls;
  const ceilingMat = schemes.houseHall.ceiling;
  const trimMat = schemes.houseHall.trim;
  const panelMat = schemes.housePrincipalDressing.trim;
  const subBaseMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.floorSubBase',
    color: 0x6f685e,
    roughness: 0.94,
  });
  const pocheMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.sectionPoche',
    color: 0xe6e1d6,
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  pocheMat.userData.preserveDoubleSide = true;
  const steelMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.structure.railingsSteel',
    color: 0x383c3f,
    roughness: 0.44,
    metalness: 0.68,
  });
  const slateBlindMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.blindSash.welshSlate',
    color: 0x2b3036,
    roughness: 0.72,
    metalness: 0.04,
  });
  const brassMat = getBathroomBrassMaterials('AB').primary;
  const glassMat = new THREE.MeshPhysicalMaterial({
    name: 'simpleHouse.clearGlass',
    color: 0xecf3f5,
    transparent: true,
    opacity: 0.34,
    roughness: 0.08,
    ior: 1.52,
    clearcoat: 0.6,
    transmission: 0,
  });
  const frostedMat = new THREE.MeshPhysicalMaterial({
    name: 'simpleHouse.frostedGlass',
    color: 0xeef3f3,
    transparent: true,
    opacity: 0.62,
    roughness: 0.55,
    transmission: 0,
  });

  const {
    drawingHoneyOakFloorMat,
    kitchenHerringboneOakMat,
    bootTerracottaQuarryMat,
    wcVitoriaChequerMat,
    landingSmokedOakMat,
    principalOatmealCarpetMat,
    ensuiteParisianManoirMat,
    guestHoneySisalMat,
    studyFumedWalnutOakMat,
    bathroomCotswoldLimestoneMat,
  } = createSimpleHouseFloorMaterials();

  const cut = (side: Side, floor: FloorId): CutawayWallDescriptor => {
    const mid = EXT_WALL_T * 0.5;
    switch (side) {
      case 'south':
        return { axis: 'z', coord: HALF_D - mid, minSpan: -HALF_W, maxSpan: HALF_W, floor, outwardSide: side };
      case 'north':
        return { axis: 'z', coord: -HALF_D + mid, minSpan: -HALF_W, maxSpan: HALF_W, floor, outwardSide: side };
      case 'east':
        return { axis: 'x', coord: HALF_W - mid, minSpan: -HALF_D, maxSpan: HALF_D, floor, outwardSide: side };
      case 'west':
        return { axis: 'x', coord: -HALF_W + mid, minSpan: -HALF_D, maxSpan: HALF_D, floor, outwardSide: side };
    }
  };

  const corners: Record<Side, readonly [readonly [number, number], readonly [number, number]]> = {
    south: [[-HALF_W, HALF_D], [HALF_W, HALF_D]],
    east: [[HALF_W, HALF_D], [HALF_W, -HALF_D]],
    north: [[HALF_W, -HALF_D], [-HALF_W, -HALF_D]],
    west: [[-HALF_W, -HALF_D], [-HALF_W, HALF_D]],
  };
  const partitionFaces: Record<FloorId, Record<string, { exteriorMaterial?: THREE.Material; interiorMaterial?: THREE.Material }>> = {
    ground: {
      pW_south: { exteriorMaterial: schemes.houseHall.walls, interiorMaterial: schemes.houseDrawing.walls },
      pW_north: { exteriorMaterial: schemes.houseBootLobby.walls, interiorMaterial: schemes.houseDrawing.walls },
      pE_south: { exteriorMaterial: schemes.houseKitchenDiner.walls, interiorMaterial: schemes.houseHall.walls },
      pE_north: { exteriorMaterial: schemes.houseKitchenDiner.walls, interiorMaterial: schemes.houseCloakroom.walls },
      pZ: { exteriorMaterial: schemes.houseHall.walls, interiorMaterial: schemes.houseBootLobby.walls },
      pX: { exteriorMaterial: schemes.houseBootLobby.walls, interiorMaterial: schemes.houseCloakroom.walls },
    },
    first: {
      pW_south: { exteriorMaterial: schemes.houseLanding.walls, interiorMaterial: schemes.housePrincipalBed.walls },
      pW_north: { exteriorMaterial: schemes.houseBathroom.walls, interiorMaterial: schemes.housePrincipalEnsuite.walls },
      pN_west: { exteriorMaterial: schemes.housePrincipalBed.walls, interiorMaterial: schemes.housePrincipalDressing.walls },
      pN_east: { exteriorMaterial: schemes.housePrincipalBed.walls, interiorMaterial: schemes.housePrincipalEnsuite.walls },
      pDress: { exteriorMaterial: schemes.housePrincipalDressing.walls, interiorMaterial: schemes.housePrincipalEnsuite.walls },
      pE_south: { exteriorMaterial: schemes.houseBedroom2.walls, interiorMaterial: schemes.houseLanding.walls },
      pE_north: { exteriorMaterial: schemes.houseStudy.walls, interiorMaterial: schemes.houseLanding.walls },
      pZ_bath: { exteriorMaterial: schemes.houseLanding.walls, interiorMaterial: schemes.houseBathroom.walls },
      pZ_air: { exteriorMaterial: schemes.houseStudy.walls, interiorMaterial: schemes.houseBathroom.walls },
      pAirW: { exteriorMaterial: schemes.houseBathroom.walls, interiorMaterial: schemes.houseBathroom.walls },
      pAirS: { exteriorMaterial: schemes.houseBathroom.walls, interiorMaterial: schemes.houseBathroom.walls },
      pS: { exteriorMaterial: schemes.houseBathroom.walls, interiorMaterial: schemes.houseStudy.walls },
      pG: { exteriorMaterial: schemes.houseBedroom2.walls, interiorMaterial: schemes.houseStudy.walls },
    },
  };

  const buildNetwork = (floor: FloorId, height: number, partitionH: number) =>
    createWallNetwork({
      floor,
      baseY: floorY[floor],
      height,
      exteriorMaterial: brickMat,
      interiorMaterial: plasterMat,
      revealMaterial: trimMat,
      capMaterial: pocheMat,
      name: `simpleHouse.walls.${floor}`,
      walls: [
        ...(['south', 'east', 'north', 'west'] as const).map((side) => ({
          id: side,
          from: corners[side][0],
          to: corners[side][1],
          thickness: EXT_WALL_T,
          align: 'exterior' as const,
          kind: 'exterior' as const,
          outwardSide: side,
          openings: [
            ...windowOpenings(floor, side),
            ...(floor === 'ground' && side === 'south'
              ? [{ id: 'frontDoor', centerOffset: HALF_W, width: FRONT_DOOR.width, sillY: 0, height: FRONT_DOOR.height, archRiseM: FRONT_DOOR.archRiseM }]
              : []),
            ...(floor === 'ground' && side === 'north'
              ? [
                  { id: 'frenchDoors', centerOffset: wallOffset('north', FRENCH_DOOR.x), width: FRENCH_DOOR.width, sillY: 0, height: FRENCH_DOOR.height },
                  { id: 'drawingFrenchDoors', centerOffset: wallOffset('north', DRAWING_FRENCH_DOOR.x), width: DRAWING_FRENCH_DOOR.width, sillY: 0, height: DRAWING_FRENCH_DOOR.height },
                  { id: 'bootGardenDoor', centerOffset: wallOffset('north', BOOT_GARDEN_DOOR.x), width: BOOT_GARDEN_DOOR.width, sillY: 0, height: BOOT_GARDEN_DOOR.height },
                ]
              : []),
          ],
        })),
        ...PARTITIONS[floor].map((p) => ({
          id: p.id,
          from: p.from,
          to: p.to,
          thickness: p.thickness ?? INT_WALL_T,
          align: 'center' as const,
          kind: 'partition' as const,
          height: partitionH,
          openings: partitionOpenings(floor, p.id),
          ...(partitionFaces[floor][p.id] ?? {}),
        })),
      ],
    });

  const groundNet = buildNetwork('ground', GROUND_WALL_H, GROUND_PARTITION_H);
  const firstNet = buildNetwork('first', FIRST_WALL_H, FIRST_PARTITION_H);
  groundGroup.add(groundNet.group);
  firstGroup.add(firstNet.group);

  // Inter-floor exterior brick joist-band course (Y = 2.83..3.05 m) parented in `firstSlabGroup`
  const interfloorBandNet = createWallNetwork({
    floor: 'ground',
    baseY: GROUND_CEILING_SOFFIT_Y,
    height: INTERFLOOR_BAND_H,
    exteriorMaterial: brickMat,
    interiorMaterial: subBaseMat,
    revealMaterial: trimMat,
    capMaterial: pocheMat,
    name: 'simpleHouse.walls.interfloorBand',
    walls: (['south', 'east', 'north', 'west'] as const).map((side) => ({
      id: side,
      from: corners[side][0],
      to: corners[side][1],
      thickness: EXT_WALL_T,
      align: 'exterior' as const,
      kind: 'exterior' as const,
      outwardSide: side,
      openings: [],
    })),
  });
  firstSlabGroup.add(interfloorBandNet.group);

  // Opening-free interior wall linings in rooms whose exterior shell shares multiple rooms (1 mm clear of IN_X)
  const drawLiningN = box(groundGroup, 'simpleHouse.drawing.cromartyLiningNorthAlcove', [0.004, 2.675, 3.23], [-IN_X + 0.003, 0.145 + 2.675 * 0.5, -2.585], schemes.houseDrawing.walls);
  drawLiningN.castShadow = false;
  tagCutaway(drawLiningN, cut('west', 'ground'));

  const drawLiningS = box(groundGroup, 'simpleHouse.drawing.cromartyLiningSouthAlcove', [0.004, 2.675, 3.23], [-IN_X + 0.003, 0.145 + 2.675 * 0.5, 2.585], schemes.houseDrawing.walls);
  drawLiningS.castShadow = false;
  tagCutaway(drawLiningS, cut('west', 'ground'));

  // Split Kitchen East lining around kitchenRsjPierEast (`Z ∈ [-0.286, -0.034]`) & diningEast sash (`Z = +2.10`)
  const kitLiningENorth = box(groundGroup, 'simpleHouse.kitchen.joasWhiteLiningEastNorth', [0.004, 2.675, 3.89], [IN_X - 0.003, 0.145 + 2.675 * 0.5, -2.245], schemes.houseKitchenDiner.walls);
  kitLiningENorth.castShadow = false;
  tagCutaway(kitLiningENorth, cut('east', 'ground'));
  const kitLiningESouth = box(groundGroup, 'simpleHouse.kitchen.joasWhiteLiningEastSouth', [0.004, 2.675, 0.91], [IN_X - 0.003, 0.145 + 2.675 * 0.5, 0.435], schemes.houseKitchenDiner.walls);
  kitLiningESouth.castShadow = false;
  tagCutaway(kitLiningESouth, cut('east', 'ground'));

  // Principal Bedroom West lining split around PRINCIPAL_BREAST (`Z ∈ [-0.65, 0.65]`)
  const prinLiningWSouth = box(firstGroup, 'simpleHouse.principal.skimmingStoneLiningWest', [0.004, 2.395, 3.53], [-IN_X + 0.003, FFL_FIRST + 0.145 + 2.395 * 0.5, 2.435], schemes.housePrincipalBed.walls);
  prinLiningWSouth.castShadow = false;
  tagCutaway(prinLiningWSouth, cut('west', 'first'));
  const prinLiningWNorth = box(firstGroup, 'simpleHouse.principal.skimmingStoneLiningWestNorth', [0.004, 2.395, 0.96], [-IN_X + 0.003, FFL_FIRST + 0.145 + 2.395 * 0.5, -1.15], schemes.housePrincipalBed.walls);
  prinLiningWNorth.castShadow = false;
  tagCutaway(prinLiningWNorth, cut('west', 'first'));

  // Study East lining split around STUDY_BREAST (`Z ∈ [-2.34, -0.94]`)
  const studyLiningENorth = box(firstGroup, 'simpleHouse.study.cardRoomGreenLiningEastNorth', [0.004, 2.395, 1.84], [IN_X - 0.003, FFL_FIRST + 0.145 + 2.395 * 0.5, -3.28], schemes.houseStudy.walls);
  studyLiningENorth.castShadow = false;
  tagCutaway(studyLiningENorth, cut('east', 'first'));
  const studyLiningESouth = box(firstGroup, 'simpleHouse.study.cardRoomGreenLiningEastSouth', [0.004, 2.395, 0.68], [IN_X - 0.003, FFL_FIRST + 0.145 + 2.395 * 0.5, -0.58], schemes.houseStudy.walls);
  studyLiningESouth.castShadow = false;
  tagCutaway(studyLiningESouth, cut('east', 'first'));

  // Family Bathroom Wet-Zone Handmade Olive Metro Tiles (`X ∈ [2.01, 2.75], Z ∈ [-4.22, -2.45]`, 2 mm inset from plaster faces so 0 z-fight)
  const oliveMetroMat = createHandmadeOliveMetroTileMaterial();
  const wetAlcoveH = 2.18;
  const wetAlcoveCy = FFL_FIRST + wetAlcoveH * 0.5 + 0.002;
  const northWetTile = box(firstGroup, 'simpleHouse.bathroom.wetZoneOliveMetroNorth', [0.736, wetAlcoveH, 0.01], [2.38, wetAlcoveCy, -IN_Z + 0.007], oliveMetroMat, 1.0);
  northWetTile.castShadow = false;
  tagCutaway(northWetTile, cut('north', 'first'));
  box(firstGroup, 'simpleHouse.bathroom.wetZoneOliveMetroEast', [0.01, wetAlcoveH, 1.742], [2.743, wetAlcoveCy, -3.335], oliveMetroMat, 1.0).castShadow = false;
  box(firstGroup, 'simpleHouse.bathroom.wetZoneOliveMetroSouth', [0.724, wetAlcoveH, 0.01], [2.374, wetAlcoveCy, -2.457], oliveMetroMat, 1.0).castShadow = false;

  // Floors & ceilings
  const rect = (x0: number, x1: number, z0: number, z1: number): [number, number][] => [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ];
  const groundSlab = (name: string, zone: string, polygon: [number, number][], floorMaterial: THREE.Material) =>
    createFloorSlab({
      polygon,
      insetM: 0,
      elevationY: FFL_GROUND,
      thickness: 0.16,
      finishThickness: 0.02,
      ceilingThickness: 0,
      floorMaterial,
      deckMaterial: subBaseMat,
      floor: { slabGroup: groundSlabGroup as THREE.Group },
      zone,
      name,
    });

  groundSlab('simpleHouse.floor.drawingOak', 'houseDrawing', rect(-7.048, -1.892, -4.218, 4.218), drawingHoneyOakFloorMat);
  groundSlab('simpleHouse.floor.kitchenHerringbone', 'houseKitchenDiner', rect(1.892, 7.048, -4.218, 4.218), kitchenHerringboneOakMat);
  groundSlab('simpleHouse.floor.bootTerracotta', 'houseBootLobby', rect(-1.648, -0.312, -4.218, -1.772), bootTerracottaQuarryMat);
  groundSlab('simpleHouse.floor.wcVitoriaChequer', 'houseCloakroom', rect(-0.188, 1.648, -4.218, -1.772), wcVitoriaChequerMat);

  // `buildChequerboardMarbleFloor` builds local y ∈ [0, thicknessM], so `FFL_GROUND - 0.02` aligns top finished face at `Y = FFL_GROUND`
  const hallFloor = buildChequerboardMarbleFloor({
    name: 'simpleHouse.floor.hallChequer',
    position: [0, FFL_GROUND - 0.02, (-1.53 + 4.22) * 0.5],
    widthM: 3.296,
    depthM: 5.746,
    thicknessM: 0.02,
  });
  tagCollisionRole(hallFloor, 'solidPlane');
  groundSlabGroup.add(hallFloor);
  box(groundSlabGroup, 'simpleHouse.floor.hallSubBase', [3.76, 0.1385, 5.99], [0, -0.09075, 1.22], subBaseMat).castShadow = false;

  const stairVoidDeckXZ: [number, number][] = [
    [0.475, -0.62],
    [1.65, -0.62],
    [1.65, 2.62],
    [0.475, 2.62],
  ];
  const stairVoidLandingFinishXZ: [number, number][] = [
    [0.473, -0.622],
    [1.65, -0.622],
    [1.65, 2.622],
    [0.473, 2.622],
  ];

  createFloorSlab({
    wallNetwork: firstNet,
    voids: [stairVoidDeckXZ],
    elevationY: FFL_FIRST - 0.022,
    thickness: 0.198,
    finishThickness: 0,
    ceilingThickness: 0.015,
    floorMaterial: subBaseMat,
    deckMaterial: subBaseMat,
    ceilingMaterial: ceilingMat,
    floor: { slabGroup: firstSlabGroup as THREE.Group },
    lowerFloor: { ceilingGroup: groundCeilingGroup },
    name: 'simpleHouse.floor.firstDeck',
  });

  const firstRoomFinishSlab = (
    name: string,
    zone: string,
    polygon: [number, number][],
    floorMaterial: THREE.Material,
    voids?: [number, number][][]
  ) =>
    createFloorSlab({
      polygon,
      ...(voids ? { voids } : {}),
      insetM: 0,
      elevationY: FFL_FIRST,
      thickness: 0.02,
      finishThickness: 0.008,
      ceilingThickness: 0,
      floorMaterial,
      deckMaterial: subBaseMat,
      floor: { slabGroup: firstSlabGroup as THREE.Group },
      zone,
      name,
    });

  firstRoomFinishSlab('simpleHouse.floor.principalOatmealCarpet', 'housePrincipalBed', rect(-7.048, -1.892, -1.648, 4.218), principalOatmealCarpetMat);
  firstRoomFinishSlab('simpleHouse.floor.dressingOatmealCarpet', 'housePrincipalBed', rect(-7.048, -4.452, -4.218, -1.772), principalOatmealCarpetMat);
  firstRoomFinishSlab('simpleHouse.floor.ensuiteParisianManoir', 'housePrincipalEnsuite', rect(-4.328, -1.892, -4.218, -1.772), ensuiteParisianManoirMat);
  firstRoomFinishSlab('simpleHouse.floor.landingSmokedOak', 'houseLanding', rect(-1.648, 1.648, -1.528, 4.218), landingSmokedOakMat, [stairVoidLandingFinishXZ]);
  firstRoomFinishSlab('simpleHouse.floor.guestHoneySisal', 'houseBedroom2', rect(1.892, 7.048, -0.098, 4.218), guestHoneySisalMat);

  const studyPolygon: [number, number][] = [
    [1.892, -0.222],
    [7.048, -0.222],
    [7.048, -4.218],
    [2.872, -4.218],
    [2.872, -1.528],
    [1.892, -1.528],
  ];
  firstRoomFinishSlab('simpleHouse.floor.studyFumedWalnutOak', 'houseStudy', studyPolygon, studyFumedWalnutOakMat);

  const bathroomPolygon: [number, number][] = [
    [-1.648, -1.772],
    [1.888, -1.772],
    [1.888, -2.452],
    [2.748, -2.452],
    [2.748, -4.218],
    [-1.648, -4.218],
  ];
  firstRoomFinishSlab('simpleHouse.floor.bathroomLimestone', 'houseBathroom', bathroomPolygon, bathroomCotswoldLimestoneMat);
  firstRoomFinishSlab('simpleHouse.floor.airingCupboardOak', 'houseBathroom', rect(2.012, 2.748, -2.328, -1.652), landingSmokedOakMat);

  createFloorSlab({
    wallNetwork: firstNet,
    elevationY: FIRST_CEILING_SOFFIT_Y + 0.018,
    thickness: 0.018,
    finishThickness: 0.004,
    ceilingThickness: 0.012,
    floorMaterial: subBaseMat,
    ceilingMaterial: ceilingMat,
    floor: { slabGroup: firstCeilingGroup },
    lowerFloor: { ceilingGroup: firstCeilingGroup },
    name: 'simpleHouse.ceiling.first',
  });

  // Roof & vertically continuous masonry chimney stacks
  const roof = createHippedRoof({
    footprint: { minX: -HALF_W, maxX: HALF_W, minZ: -HALF_D, maxZ: HALF_D },
    eavesY: ROOF_EAVES_Y,
    pitchDeg: 33,
    overhangM: 0.28,
    outerMaterial: slateMat,
    name: 'simpleHouse.roof',
  });
  roofGroup.add(roof.group);

  // Align roof stacks directly over West (Drawing/Principal, Z = 0.00) & East (Kitchen Range/Study, Z = -1.64) breasts
  roofGroup.add(
    buildGeorgianFacadeDressings({
      kind: 'chimneyStack',
      name: 'simpleHouse.chimney.west',
      position: [-6.87, 6.05, 0.0],
      rotationY: Math.PI / 2,
    }),
    buildGeorgianFacadeDressings({
      kind: 'chimneyStack',
      name: 'simpleHouse.chimney.east',
      position: [6.87, 6.05, -1.64],
      rotationY: Math.PI / 2,
    })
  );

  // Facade dressings
  const sides: readonly Side[] = ['south', 'north', 'east', 'west'];
  const facadeLen: Record<Side, number> = {
    south: HALF_W * 2,
    north: HALF_W * 2,
    east: HALF_D * 2,
    west: HALF_D * 2,
  };
  for (const side of sides) {
    const len = facadeLen[side];
    const isLong = side === 'south' || side === 'north';

    const plinthSpans: readonly (readonly [number, number])[] =
      side === 'south'
        ? [
            [-HALF_W - 0.042, -1.085],
            [1.085, HALF_W + 0.042],
          ]
        : side === 'north'
          ? [
              [-HALF_W - 0.042, DRAWING_FRENCH_DOOR.x - 0.76],
              [DRAWING_FRENCH_DOOR.x + 0.76, BOOT_GARDEN_DOOR.x - 0.45],
              [BOOT_GARDEN_DOOR.x + 0.45, FRENCH_DOOR.x - 0.76],
              [FRENCH_DOOR.x + 0.76, HALF_W + 0.042],
            ]
          : [[-HALF_D, HALF_D]];
    plinthSpans.forEach(([a, b], i) => {
      const holder = new THREE.Group();
      holder.name = `simpleHouse.plinth.${side}_${i}`;
      box(holder, `${holder.name}.course`, [b - a, 0.338, 0.04], [0, -0.151, 0.02], stoneMat, 1.0);
      placeOnFacade(holder, side, (a + b) * 0.5, 0);
      tagCutaway(holder, cut(side, 'ground'));
      groundGroup.add(holder);
    });

    // Inter-floor Bath-stone stringcourse placed in `firstSlabGroup` at Y = 2.85 m so it hides cleanly in GF cutaway
    const stringcourse = buildGeorgianFacadeDressings({
      kind: 'stringcourse',
      name: `simpleHouse.stringcourse.${side}`,
      lengthM: len - 0.94,
    });
    placeOnFacade(stringcourse, side, 0, 2.85);
    tagCutaway(stringcourse, cut(side, 'ground'));
    firstSlabGroup.add(stringcourse);

    const cornice = buildGeorgianFacadeDressings({
      kind: 'eavesCornice',
      name: `simpleHouse.eavesCornice.${side}`,
      lengthM: isLong ? len + 0.42 : len - 0.05,
    });
    placeOnFacade(cornice, side, 0, 5.44);
    tagCutaway(cornice, cut(side, 'first'));
    firstGroup.add(cornice);
  }

  const quoinCorners: readonly {
    side: 'south' | 'north';
    returnSide: 'west' | 'east';
    cornerSide: 'left' | 'right';
    x: number;
  }[] = [
    { side: 'south', returnSide: 'west', cornerSide: 'left', x: -HALF_W - DRESSING_STANDOFF_M },
    { side: 'south', returnSide: 'east', cornerSide: 'right', x: HALF_W + DRESSING_STANDOFF_M },
    { side: 'north', returnSide: 'east', cornerSide: 'left', x: HALF_W + DRESSING_STANDOFF_M },
    { side: 'north', returnSide: 'west', cornerSide: 'right', x: -HALF_W - DRESSING_STANDOFF_M },
  ];
  for (const q of quoinCorners) {
    for (const floor of ['ground', 'first'] as const) {
      const quoins = buildGeorgianFacadeDressings({
        kind: 'cornerQuoins',
        name: `simpleHouse.quoins.${q.side}.${q.cornerSide}.${floor}`,
        heightM: 2.75,
        cornerSide: q.cornerSide,
      });
      placeOnFacade(quoins, q.side, q.x, floor === 'ground' ? 0.02 : 2.72);
      quoins.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        if (child.name.includes('.frontBlock_')) {
          tagCutaway(child, cut(q.side, floor));
        } else if (child.name.includes('.returnBlock_')) {
          tagCutaway(child, cut(q.returnSide, floor));
        }
      });
      floorGroups[floor].add(quoins);
    }
  }

  const downpipeCastIronMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.downpipe.castIron',
    color: 0x1e2124,
    roughness: 0.42,
    metalness: 0.72,
  });
  for (const side of ['east', 'west'] as const) {
    const groundPipe = buildSplitRainwaterDownpipeSegment(`simpleHouse.downpipe.${side}.ground`, 'ground', downpipeCastIronMat);
    placeOnFacade(groundPipe, side, -3.85, 0.02);
    tagCutaway(groundPipe, cut(side, 'ground'));
    groundGroup.add(groundPipe);

    const firstPipe = buildSplitRainwaterDownpipeSegment(`simpleHouse.downpipe.${side}.first`, 'first', downpipeCastIronMat);
    placeOnFacade(firstPipe, side, -3.85, 2.83);
    tagCutaway(firstPipe, cut(side, 'first'));
    firstGroup.add(firstPipe);
  }

  // Classical Georgian Blind Sash Windows on West Flank (`Z = +2.10`) balancing `diningEast` & `guestEast`
  for (const spec of [
    { id: 'westGround', floor: 'ground' as const, y: FFL_GROUND + 0.68, height: 1.82, width: 1.12 },
    { id: 'westFirst', floor: 'first' as const, y: FFL_FIRST + 0.62, height: 1.54, width: 1.12 },
  ]) {
    const blindSash = buildGeorgianBlindSashRelief({
      name: `simpleHouse.blindSash.${spec.id}`,
      width: spec.width,
      height: spec.height,
      trimMat: schemes.houseHall.trim,
      stoneMat,
      slateBlindMat,
      lintelBrickMat: brickMat,
    });
    blindSash.position.set(-HALF_W - 0.003, spec.y, 2.1);
    blindSash.rotation.y = -Math.PI / 2;
    tagCutaway(blindSash, cut('west', spec.floor));
    floorGroups[spec.floor].add(blindSash);
  }

  // Entrance & Rear Garden Coach Lanterns
  const portico = buildGeorgianTuscanPorticoAndDoor(ctx, {
    name: 'simpleHouse.portico',
    position: [0, FFL_GROUND - 0.3, HALF_D + 0.004],
  });
  tagCutaway(portico, cut('south', 'ground'));
  groundGroup.add(portico);
  groundGroup.add(
    buildFrontDoorInteriorSurround(
      schemes.houseHall.trim,
      groundNet.getWallCutaway('south', HALF_W) ?? cut('south', 'ground')
    )
  );
  for (const s of [-1, 1] as const) {
    const lantern = buildGeorgianCoachLantern(ctx, {
      name: `simpleHouse.porticoLantern.${s < 0 ? 'west' : 'east'}`,
      position: [s * 1.48, 1.95, HALF_D + 0.006],
      circuitId: 'housePorticoLanterns' as CircuitId,
      createPointLight: s > 0,
    });
    tagCutaway(lantern, cut('south', 'ground'));
    groundGroup.add(lantern);
  }

  // 4 Rear Garden Brass Coach Lanterns (`houseExteriorGarden` circuit) flanking twin French doors; 1 point light for budget
  const gardenLanternSpecs: readonly { tag: string; x: number; light: boolean }[] = [
    { tag: 'drawingWest', x: -6.32, light: false },
    { tag: 'drawingEast', x: -4.38, light: false },
    { tag: 'kitchenWest', x: 4.38, light: true },
    { tag: 'kitchenEast', x: 6.32, light: false },
  ];
  for (const lSpec of gardenLanternSpecs) {
    const gardenLantern = buildGeorgianCoachLantern(ctx, {
      name: `simpleHouse.gardenLantern.${lSpec.tag}`,
      position: [lSpec.x, 1.95, -HALF_D - 0.006],
      rotationY: Math.PI,
      circuitId: 'houseExteriorGarden' as CircuitId,
      createPointLight: lSpec.light,
    });
    tagCutaway(gardenLantern, cut('north', 'ground'));
    groundGroup.add(gardenLantern);
  }

  // Sash windows, Twin French Doors & Rear Boot Garden Door
  for (const w of WINDOWS) {
    const net = w.floor === 'ground' ? groundNet : firstNet;
    const y = floorY[w.floor] + w.sillY;
    const mid = EXT_WALL_T * 0.5;
    const placement: Record<Side, { position: [number, number, number]; rotationY: number }> = {
      south: { position: [w.at, y, HALF_D - mid], rotationY: Math.PI },
      north: { position: [w.at, y, -HALF_D + mid], rotationY: 0 },
      east: { position: [HALF_W - mid, y, w.at], rotationY: -Math.PI / 2 },
      west: { position: [-HALF_W + mid, y, w.at], rotationY: Math.PI / 2 },
    };
    const sash = createGeorgianSashWindow({
      id: `simpleHouse.sash.${w.id}`,
      label: w.label,
      zone: w.zone,
      width: w.width,
      height: w.height,
      wallThickness: EXT_WALL_T,
      panesCols: w.width < 0.9 ? 2 : 3,
      panesTopRows: w.topRows ?? 2,
      panesBottomRows: 2,
      lintel: 'gauged-brick-jack-arch',
      sill: 'yorkstone',
      frameMaterial: schemes[w.room].trim,
      architraveMaterial: schemes[w.room].trim,
      cutawayWall: net.getWallCutaway(w.side, wallOffset(w.side, w.at)) ?? cut(w.side, w.floor),
      interactions: ctx.interactions,
      ...(w.frosted ? { glassMaterial: frostedMat } : {}),
      ...placement[w.side],
    });
    floorGroups[w.floor].add(sash.group);
  }

  addFrenchDoors(
    ctx,
    groundGroup,
    groundNet.getWallCutaway('north', wallOffset('north', FRENCH_DOOR.x)) ?? cut('north', 'ground'),
    schemes.houseKitchenDiner.trim,
    glassMat,
    brassMat,
    stoneMat,
    steelMat,
    FRENCH_DOOR,
    'simpleHouse.frenchDoors'
  );
  const kitchenFrenchGroup = groundGroup.getObjectByName('simpleHouse.frenchDoors');
  if (kitchenFrenchGroup) kitchenFrenchGroup.userData.zoneId = 'houseKitchenDiner';

  addFrenchDoors(
    ctx,
    groundGroup,
    groundNet.getWallCutaway('north', wallOffset('north', DRAWING_FRENCH_DOOR.x)) ?? cut('north', 'ground'),
    schemes.houseDrawing.trim,
    glassMat,
    brassMat,
    stoneMat,
    steelMat,
    DRAWING_FRENCH_DOOR,
    'simpleHouse.drawingFrenchDoors'
  );
  const drawingFrenchGroup = groundGroup.getObjectByName('simpleHouse.drawingFrenchDoors');
  if (drawingFrenchGroup) drawingFrenchGroup.userData.zoneId = 'houseDrawing';

  addRearBootGardenDoor(
    ctx,
    groundGroup,
    groundNet.getWallCutaway('north', wallOffset('north', BOOT_GARDEN_DOOR.x)) ?? cut('north', 'ground'),
    schemes.houseBootLobby.trim,
    schemes.houseBootLobby.trim,
    glassMat,
    brassMat,
    stoneMat
  );
  const bootDoorGroup = groundGroup.getObjectByName('simpleHouse.bootGardenDoor');
  if (bootDoorGroup) bootDoorGroup.userData.zoneId = 'houseBootLobby';
  const bootBarV = groundGroup.getObjectByName('simpleHouse.bootGardenDoor.leaf.glazingBarV');
  if (bootBarV) bootBarV.scale.z = 34 / 30;

  // Interior doors
  for (const d of DOORS) {
    addInteriorDoor(
      ctx,
      floorGroups[d.floor],
      d,
      floorY[d.floor],
      schemes[d.backRoom].trim,
      schemes[d.frontRoom].trim,
      schemes[d.frontRoom].trim,
      panelMat,
      brassMat,
      bathroomCotswoldLimestoneMat
    );
  }

  // Structural steel UB RSJs, nib piers, padstones, chimney breasts & joinery trim
  const trimAndStructureCtx: TrimAndStructureContext = {
    groundGroup,
    groundCeilingGroup,
    firstGroup,
    firstCeilingGroup,
    floorGroups,
    floorY,
    groundNet,
    firstNet,
    schemes,
    cut,
  };
  buildSimpleHouseStructureAndBreasts(trimAndStructureCtx, steelMat);
  buildSimpleHouseTrim(trimAndStructureCtx);

  return { cut, plasterMat, trimMat, schemes };
}
