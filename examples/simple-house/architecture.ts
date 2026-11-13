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
  SPINE_WALL_T,
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
  DOORS,
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

export interface SimpleHouseShell {
  /** Whole-elevation cutaway descriptor for wall-hung fittings. */
  cut(side: Side, floor: FloorId): CutawayWallDescriptor;
  readonly plasterMat: THREE.Material;
  readonly trimMat: THREE.Material;
  readonly schemes: Readonly<Record<SimpleHouseRoomSchemeKey, RoomPaintScheme>>;
}

export function buildSimpleHouseArchitecture(
  ctx: SceneBuilderContext,
  stair: SimpleHouseStair
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
              ? [{ id: 'frenchDoors', centerOffset: wallOffset('north', FRENCH_DOOR.x), width: FRENCH_DOOR.width, sillY: 0, height: FRENCH_DOOR.height }]
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
  // so `Ground Floor` cutaway exposes a level Y = 2.83 m poché plane, while `All` view is 100% seamless!
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
      openings:
        side === 'south'
          ? [
              // Subtract top of semicircular fanlight arch rising to Y = 2.675 < 2.83 (none needed),
              // keep solid continuous Flemish brick band behind portico pediment & Bath-stone stringcourse
            ]
          : [],
    })),
  });
  firstSlabGroup.add(interfloorBandNet.group);

  // Opening-free interior wall linings in rooms whose exterior shell shares multiple rooms
  const drawLiningN = box(groundGroup, 'simpleHouse.drawing.cromartyLiningNorthAlcove', [0.004, 2.675, 3.23], [-IN_X + 0.002, 0.145 + 2.675 * 0.5, -2.585], schemes.houseDrawing.walls);
  drawLiningN.castShadow = false;
  tagCutaway(drawLiningN, cut('west', 'ground'));

  const drawLiningS = box(groundGroup, 'simpleHouse.drawing.cromartyLiningSouthAlcove', [0.004, 2.675, 3.23], [-IN_X + 0.002, 0.145 + 2.675 * 0.5, 2.585], schemes.houseDrawing.walls);
  drawLiningS.castShadow = false;
  tagCutaway(drawLiningS, cut('west', 'ground'));

  // Split Kitchen East lining around kitchenRsjPierEast (`Z in [-0.28, -0.04]`)
  const kitLiningENorth = box(groundGroup, 'simpleHouse.kitchen.joasWhiteLiningEastNorth', [0.004, 2.675, 3.89], [IN_X - 0.002, 0.145 + 2.675 * 0.5, -2.245], schemes.houseKitchenDiner.walls);
  kitLiningENorth.castShadow = false;
  tagCutaway(kitLiningENorth, cut('east', 'ground'));
  const kitLiningESouth = box(groundGroup, 'simpleHouse.kitchen.joasWhiteLiningEastSouth', [0.004, 2.675, 0.91], [IN_X - 0.002, 0.145 + 2.675 * 0.5, 0.435], schemes.houseKitchenDiner.walls);
  kitLiningESouth.castShadow = false;
  tagCutaway(kitLiningESouth, cut('east', 'ground'));

  const prinLiningW = box(firstGroup, 'simpleHouse.principal.skimmingStoneLiningWest', [0.004, 2.395, 4.65], [-IN_X + 0.002, FFL_FIRST + 0.145 + 2.395 * 0.5, 1.875], schemes.housePrincipalBed.walls);
  prinLiningW.castShadow = false;
  tagCutaway(prinLiningW, cut('west', 'first'));

  const studyLiningENorth = box(firstGroup, 'simpleHouse.study.cardRoomGreenLiningEastNorth', [0.004, 2.395, 1.83], [IN_X - 0.002, FFL_FIRST + 0.145 + 2.395 * 0.5, -3.265], schemes.houseStudy.walls);
  studyLiningENorth.castShadow = false;
  tagCutaway(studyLiningENorth, cut('east', 'first'));
  const studyLiningESouth = box(firstGroup, 'simpleHouse.study.cardRoomGreenLiningEastSouth', [0.004, 2.395, 0.7], [IN_X - 0.002, FFL_FIRST + 0.145 + 2.395 * 0.5, -0.58], schemes.houseStudy.walls);
  studyLiningESouth.castShadow = false;
  tagCutaway(studyLiningESouth, cut('east', 'first'));

  // Family Bathroom Wet-Zone Handmade Olive Metro Tile Alcove (`X in [1.51, 2.35], Z in [-4.22, -2.45]`)
  const oliveMetroMat = createHandmadeOliveMetroTileMaterial();
  const wetAlcoveH = 2.18;
  const wetAlcoveCy = FFL_FIRST + wetAlcoveH * 0.5 + 0.002;
  const northWetTile = box(firstGroup, 'simpleHouse.bathroom.wetZoneOliveMetroNorth', [0.832, wetAlcoveH, 0.01], [1.93, wetAlcoveCy, -IN_Z + 0.006], oliveMetroMat, 1.0);
  northWetTile.castShadow = false;
  tagCutaway(northWetTile, cut('north', 'first'));
  box(firstGroup, 'simpleHouse.bathroom.wetZoneOliveMetroEast', [0.01, wetAlcoveH, 1.756], [2.344, wetAlcoveCy, -3.332], oliveMetroMat, 1.0).castShadow = false;
  box(firstGroup, 'simpleHouse.bathroom.wetZoneOliveMetroSouth', [0.832, wetAlcoveH, 0.01], [1.93, wetAlcoveCy, -2.456], oliveMetroMat, 1.0).castShadow = false;

  // --- Floors & ceilings ---------------------------------------------------------------------
  const wingX0 = HALL_PARTITION_X + SPINE_WALL_T * 0.5 + 0.002; // 1.392
  const hallX = HALL_PARTITION_X - SPINE_WALL_T * 0.5 - 0.002; // 1.148
  const stairNorthZ = STAIRWELL_CROSS_Z - SPINE_WALL_T * 0.5 - 0.002; // -1.772
  const stairSouthZ = STAIRWELL_CROSS_Z + SPINE_WALL_T * 0.5 + 0.002; // -1.528
  const inX = IN_X - 0.002; // 5.418
  const inZ = IN_Z - 0.002; // 4.218
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

  groundSlab('simpleHouse.floor.drawingOak', 'houseDrawing', rect(-inX, -wingX0, -inZ, inZ), drawingHoneyOakFloorMat);
  groundSlab('simpleHouse.floor.kitchenHerringbone', 'houseKitchenDiner', rect(wingX0, inX, -inZ, inZ), kitchenHerringboneOakMat);
  groundSlab('simpleHouse.floor.bootTerracotta', 'houseCloakroom', rect(-hallX, -0.062, -inZ, stairNorthZ), bootTerracottaQuarryMat);
  groundSlab('simpleHouse.floor.wcVitoriaChequer', 'houseCloakroom', rect(0.062, hallX, -inZ, stairNorthZ), wcVitoriaChequerMat);

  const hallFloor = buildChequerboardMarbleFloor({
    name: 'simpleHouse.floor.hallChequer',
    position: [0, FFL_GROUND - 0.02, 1.345],
    widthM: 2.29,
    depthM: 5.74,
    thicknessM: 0.02,
  });
  tagCollisionRole(hallFloor, 'solidPlane');
  groundSlabGroup.add(hallFloor);
  box(groundSlabGroup, 'simpleHouse.floor.hallSubBase', [2.78, 0.1385, 5.99], [0, -0.09075, 1.22], subBaseMat).castShadow = false;

  const trimmedStairVoidXZ: [number, number][] = stair.voidOpeningXZ.map(([vx, vz]) => [
    vx,
    Math.min(vz, 2.565),
  ]);

  createFloorSlab({
    wallNetwork: firstNet,
    voids: [trimmedStairVoidXZ],
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

  firstRoomFinishSlab('simpleHouse.floor.principalOatmealCarpet', 'housePrincipalBed', rect(-inX, -wingX0, -1.648, inZ), principalOatmealCarpetMat);
  firstRoomFinishSlab('simpleHouse.floor.dressingOatmealCarpet', 'housePrincipalBed', rect(-inX, -3.592, -inZ, -1.772), principalOatmealCarpetMat);
  firstRoomFinishSlab('simpleHouse.floor.ensuiteParisianManoir', 'housePrincipalEnsuite', rect(-3.468, -wingX0, -inZ, -1.772), ensuiteParisianManoirMat);
  firstRoomFinishSlab('simpleHouse.floor.landingSmokedOak', 'houseLanding', rect(-hallX, hallX, stairSouthZ, inZ), landingSmokedOakMat, [trimmedStairVoidXZ]);
  firstRoomFinishSlab('simpleHouse.floor.guestHoneySisal', 'houseBedroom2', rect(wingX0, inX, -0.098, inZ), guestHoneySisalMat);

  const studyPolygon: [number, number][] = [
    [2.472, -inZ],
    [inX, -inZ],
    [inX, -0.222],
    [wingX0, -0.222],
    [wingX0, -1.528],
    [2.472, -1.528],
  ];
  firstRoomFinishSlab('simpleHouse.floor.studyFumedWalnutOak', 'houseStudy', studyPolygon, studyFumedWalnutOakMat);
  firstRoomFinishSlab('simpleHouse.floor.bathroomLimestone', 'houseBathroom', rect(-hallX, 1.388, -inZ, stairNorthZ), bathroomCotswoldLimestoneMat);
  firstRoomFinishSlab('simpleHouse.floor.bathroomWetAlcoveLimestone', 'houseBathroom', rect(1.512, 2.348, -inZ, -2.452), bathroomCotswoldLimestoneMat);
  firstRoomFinishSlab('simpleHouse.floor.airingCupboardOak', 'houseBathroom', rect(1.512, 2.348, -2.328, -1.652), landingSmokedOakMat);

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

  // --- Roof & vertically continuous masonry chimney stacks -----------------------------------
  const roof = createHippedRoof({
    footprint: { minX: -HALF_W, maxX: HALF_W, minZ: -HALF_D, maxZ: HALF_D },
    eavesY: ROOF_EAVES_Y,
    pitchDeg: 33,
    overhangM: 0.28,
    outerMaterial: slateMat,
    name: 'simpleHouse.roof',
  });
  roofGroup.add(roof.group);

  // Align roof stacks directly over West (Drawing/Principal) & East (Kitchen Range/Study, Z = -1.64) breasts
  roofGroup.add(
    buildGeorgianFacadeDressings({
      kind: 'chimneyStack',
      name: 'simpleHouse.chimney.west',
      position: [-5.24, 6.05, -1.05],
      rotationY: Math.PI / 2,
    }),
    buildGeorgianFacadeDressings({
      kind: 'chimneyStack',
      name: 'simpleHouse.chimney.east',
      position: [5.24, 6.05, -1.64],
      rotationY: Math.PI / 2,
    })
  );

  // --- Facade dressings ----------------------------------------------------------------------
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
              [-HALF_W - 0.042, FRENCH_DOOR.x - 0.76],
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

  // --- Entrance ------------------------------------------------------------------------------
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

  // --- Sash windows & French doors -----------------------------------------------------------
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
    steelMat
  );

  // --- Interior doors ------------------------------------------------------------------------
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

  // --- Structural steel UB RSJs, nib piers, padstones, chimney breasts & joinery trim ---------
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
