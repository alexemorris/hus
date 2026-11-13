import * as THREE from 'three';
import type { CutawayWallDescriptor } from 'husjs';
import {
  createCorniceRun,
  createDadoRun,
  createSkirtingRun,
  tagCutaway,
} from 'husjs/objects';
import {
  buildGeorgianCeilingPanelMoulding,
  buildGeorgianCeilingRose,
} from 'husjs/catalog/architectural';
import {
  FFL_GROUND,
  FIRST_CEILING_SOFFIT_Y,
  GROUND_CEILING_SOFFIT_Y,
  SPINE_WALL_T,
} from './electrical-and-rooms.ts';
import type { FloorId } from './architecture-materials.ts';
import {
  DOORS,
  DOOR_CLEAR_W,
  HALL_PARTITION_X,
  IN_X,
  IN_Z,
  STAIRWELL_CROSS_Z,
} from './architecture-openings.ts';
import {
  DRAWING_BREAST,
  PRINCIPAL_BREAST,
  STUDY_BREAST,
  type TrimAndStructureContext,
} from './architecture-structure.ts';
import { HALL_ROSE_XZ, LANDING_ROSE_XZ } from './staircase-and-hall.ts';

export function buildSimpleHouseTrim(tc: TrimAndStructureContext): void {
  const {
    groundGroup,
    groundCeilingGroup,
    firstCeilingGroup,
    floorGroups,
    floorY,
    groundNet,
    firstNet,
    schemes,
    cut,
  } = tc;

  const pFace = HALL_PARTITION_X + SPINE_WALL_T * 0.5; // 1.39
  const hFace = HALL_PARTITION_X - SPINE_WALL_T * 0.5; // 1.15
  const stairSouthFace = STAIRWELL_CROSS_Z + SPINE_WALL_T * 0.5; // -1.53
  const stairNorthFace = STAIRWELL_CROSS_Z - SPINE_WALL_T * 0.5; // -1.77
  const b = DRAWING_BREAST;

  const hallPath: [number, number][] = [
    [-hFace, IN_Z],
    [hFace, IN_Z],
    [hFace, stairSouthFace],
    [-hFace, stairSouthFace],
  ];
  const drawingRectPath: [number, number][] = [
    [-IN_X, IN_Z],
    [-pFace, IN_Z],
    [-pFace, -IN_Z],
    [-IN_X, -IN_Z],
  ];
  const drawingBreastPath: [number, number][] = [
    [-IN_X + 0.118, b.minZ],
    [b.maxX, b.minZ],
    [b.maxX, b.maxZ],
    [-IN_X + 0.118, b.maxZ],
  ];
  // Wrap Kitchen West skirting cleanly around engaged masonry nib pier kitchenRsjPierWest
  const kitchenSkirtingPath: [number, number][] = [
    [pFace, IN_Z],
    [IN_X, IN_Z],
    [IN_X, -IN_Z],
    [pFace, -IN_Z],
    [pFace, -0.302],
    [1.572, -0.302],
    [1.572, -0.018],
    [pFace, -0.018],
  ];
  const kitchenRectPath: [number, number][] = [
    [pFace, IN_Z],
    [IN_X, IN_Z],
    [IN_X, -IN_Z],
    [pFace, -IN_Z],
  ];
  const kitchenPierEastPath: [number, number][] = [
    [IN_X - 0.02, -0.038],
    [5.278, -0.038],
    [5.278, -0.282],
    [IN_X - 0.02, -0.282],
  ];
  const kitchenBreastPath: [number, number][] = [
    [IN_X - 0.118, -0.82],
    [4.752, -0.82],
    [4.752, -2.46],
    [IN_X - 0.118, -2.46],
  ];
  const bootLobbyPath: [number, number][] = [
    [-hFace, stairNorthFace],
    [-0.06, stairNorthFace],
    [-0.06, -IN_Z],
    [-hFace, -IN_Z],
  ];
  const cloakroomPath: [number, number][] = [
    [0.06, stairNorthFace],
    [hFace, stairNorthFace],
    [hFace, -IN_Z],
    [0.06, -IN_Z],
  ];
  const principalPath: [number, number][] = [
    [-IN_X, IN_Z],
    [-pFace, IN_Z],
    [-pFace, -1.65],
    [-IN_X, -1.65],
  ];
  const principalBreastPath: [number, number][] = [
    [-IN_X + 0.118, PRINCIPAL_BREAST.minZ],
    [PRINCIPAL_BREAST.maxX, PRINCIPAL_BREAST.minZ],
    [PRINCIPAL_BREAST.maxX, PRINCIPAL_BREAST.maxZ],
    [-IN_X + 0.118, PRINCIPAL_BREAST.maxZ],
  ];
  const dressingPath: [number, number][] = [
    [-IN_X, -1.77],
    [-3.59, -1.77],
    [-3.59, -IN_Z],
    [-IN_X, -IN_Z],
  ];
  const ensuitePath: [number, number][] = [
    [-3.47, -1.77],
    [-pFace, -1.77],
    [-pFace, -IN_Z],
    [-3.47, -IN_Z],
  ];
  const guestPath: [number, number][] = [
    [pFace, IN_Z],
    [IN_X, IN_Z],
    [IN_X, -0.1],
    [pFace, -0.1],
  ];
  const studyPath: [number, number][] = [
    [pFace, -0.22],
    [IN_X, -0.22],
    [IN_X, -IN_Z],
    [2.47, -IN_Z],
    [2.47, -1.53],
    [pFace, -1.53],
  ];
  const studyBreastPath: [number, number][] = [
    [IN_X - 0.118, STUDY_BREAST.maxZ],
    [STUDY_BREAST.minX, STUDY_BREAST.maxZ],
    [STUDY_BREAST.minX, STUDY_BREAST.minZ],
    [IN_X - 0.118, STUDY_BREAST.minZ],
  ];
  const bathroomPath: [number, number][] = [
    [-hFace, stairNorthFace],
    [1.39, stairNorthFace],
    [1.39, -2.45],
    [2.35, -2.45],
    [2.35, -IN_Z],
    [-hFace, -IN_Z],
  ];

  const doorGap = (id: string, faceCoord: number) => {
    const d = DOORS.find((spec) => spec.id === id)!;
    const width = (d.clearWidth ?? DOOR_CLEAR_W) + 0.14;
    return {
      at: [d.plane === 'x' ? faceCoord : d.at[0], d.plane === 'z' ? faceCoord : d.at[1]] as [number, number],
      width,
      cap: 'selfReturn' as const,
    };
  };

  const addSkirting = (opts: {
    name: string;
    floor: FloorId;
    zone: string;
    path: [number, number][];
    closed?: boolean;
    material: THREE.Material;
    height?: number;
    thickness?: number;
    gaps?: NonNullable<Parameters<typeof createSkirtingRun>[0]['gaps']>;
    forceCutaway?: CutawayWallDescriptor;
  }) => {
    const run = createSkirtingRun({
      path: opts.path,
      closed: opts.closed ?? true,
      roomSide: 'left',
      elevationY: floorY[opts.floor] + 0.001,
      profile: 'ogee',
      height: opts.height ?? (opts.floor === 'ground' ? 0.165 : 0.142),
      thickness: opts.thickness ?? 0.018,
      material: opts.material,
      gaps: opts.gaps ?? [],
      cutawayWalls: opts.forceCutaway ? [] : (opts.floor === 'ground' ? groundNet : firstNet).cutaways,
      floor: opts.floor,
      zone: opts.zone,
      name: opts.name,
    });
    if (opts.forceCutaway) tagCutaway(run, opts.forceCutaway);
    floorGroups[opts.floor].add(run);
  };

  const addCornice = (opts: {
    name: string;
    floor: FloorId;
    zone: string;
    path: [number, number][];
    closed?: boolean;
    profile?: 'georgian-cyma' | 'georgian-dentil' | 'cove' | 'stepped';
    height?: number;
    projection?: number;
    material: THREE.Material;
    gaps?: NonNullable<Parameters<typeof createCorniceRun>[0]['gaps']>;
    forceCutaway?: CutawayWallDescriptor;
  }) => {
    const group = createCorniceRun({
      name: opts.name,
      path: opts.path,
      closed: opts.closed ?? true,
      roomSide: 'left',
      ceilingY: opts.floor === 'ground' ? GROUND_CEILING_SOFFIT_Y : FIRST_CEILING_SOFFIT_Y,
      profile: opts.profile ?? 'georgian-cyma',
      height: opts.height ?? 0.115,
      projection: opts.projection ?? 0.11,
      material: opts.material,
      gaps: opts.gaps ?? [],
      cutawayWalls: opts.forceCutaway ? [] : (opts.floor === 'ground' ? groundNet : firstNet).cutaways,
      floor: opts.floor,
      zone: opts.zone,
    });
    if (opts.forceCutaway) tagCutaway(group, opts.forceCutaway);
    (opts.floor === 'ground' ? groundCeilingGroup : firstCeilingGroup).add(group);
  };

  // Ground-floor skirtings
  addSkirting({
    name: 'simpleHouse.skirting.hall',
    floor: 'ground',
    zone: 'houseHall',
    path: hallPath,
    material: schemes.houseHall.trim,
    gaps: [
      { box: { minX: -0.58, maxX: 0.58, minZ: 4.1, maxZ: 4.35 }, cap: 'selfReturn' },
      { box: { minX: 1.05, maxX: 1.25, minZ: -0.72, maxZ: 3.95 }, cap: 'selfReturn' },
      doorGap('hallBoot', stairSouthFace),
      doorGap('hallDrawing', -hFace),
    ],
  });
  addSkirting({
    name: 'simpleHouse.skirting.drawing',
    floor: 'ground',
    zone: 'houseDrawing',
    path: drawingRectPath,
    height: 0.17,
    thickness: 0.02,
    material: schemes.houseDrawing.trim,
    gaps: [
      doorGap('hallDrawing', -pFace),
      { box: { minX: -5.5, maxX: -5.3, minZ: -4.23, maxZ: 4.23 } },
    ],
  });
  addSkirting({
    name: 'simpleHouse.skirting.drawingBreast',
    floor: 'ground',
    zone: 'houseDrawing',
    path: drawingBreastPath,
    closed: false,
    height: 0.17,
    thickness: 0.02,
    material: schemes.houseDrawing.trim,
    gaps: [{ at: [b.maxX, 0], width: 1.62, cap: 'selfReturn' }],
    forceCutaway: cut('west', 'ground'),
  });
  addSkirting({
    name: 'simpleHouse.skirting.kitchenDiner',
    floor: 'ground',
    zone: 'houseKitchenDiner',
    path: kitchenSkirtingPath,
    height: 0.142,
    thickness: 0.018,
    material: schemes.houseKitchenDiner.trim,
    gaps: [
      { box: { minX: 5.3, maxX: 5.5, minZ: -3.5, maxZ: -0.28 }, cap: 'selfReturn' },
      { box: { minX: 5.3, maxX: 5.5, minZ: -0.285, maxZ: -0.035 } },
      { box: { minX: 5.3, maxX: 5.5, minZ: 0.02, maxZ: 1.44 }, cap: 'selfReturn' },
      { box: { minX: 1.88, maxX: 3.42, minZ: -4.32, maxZ: -4.12 }, cap: 'selfReturn' },
      { box: { minX: 3.44, maxX: 5.06, minZ: -4.32, maxZ: -4.12 }, cap: 'selfReturn' },
      { box: { minX: 1.3, maxX: 1.48, minZ: -3.2, maxZ: -1.9 }, cap: 'selfReturn' },
      { box: { minX: 1.3, maxX: 1.48, minZ: 1.15, maxZ: 2.55 }, cap: 'selfReturn' },
      doorGap('hallKitchen', pFace),
    ],
  });
  addSkirting({
    name: 'simpleHouse.skirting.kitchenPierEast',
    floor: 'ground',
    zone: 'houseKitchenDiner',
    path: kitchenPierEastPath,
    closed: false,
    height: 0.142,
    thickness: 0.018,
    material: schemes.houseKitchenDiner.trim,
    forceCutaway: cut('east', 'ground'),
  });

  groundGroup.add(
    createDadoRun({
      name: 'simpleHouse.dadoRail.drawing',
      path: drawingRectPath,
      closed: true,
      roomSide: 'left',
      floorY: FFL_GROUND,
      elevationY: 0.9,
      profile: 'astragal-dado',
      height: 0.056,
      projection: 0.022,
      material: schemes.houseDrawing.trim,
      gaps: [
        doorGap('hallDrawing', -pFace),
        { box: { minX: -4.06, maxX: -2.64, minZ: 4.1, maxZ: 4.32 }, cap: 'selfReturn' },
        { box: { minX: -4.06, maxX: -2.64, minZ: -4.32, maxZ: -4.1 }, cap: 'selfReturn' },
        { box: { minX: -5.5, maxX: -5.3, minZ: -4.23, maxZ: 4.23 } },
      ],
      cutawayWalls: groundNet.cutaways,
      floor: 'ground',
      zone: 'houseDrawing',
    })
  );

  addSkirting({
    name: 'simpleHouse.skirting.bootLobby',
    floor: 'ground',
    zone: 'houseCloakroom',
    path: [
      [-1.12, stairNorthFace],
      [-0.06, stairNorthFace],
      [-0.06, -4.185],
    ],
    closed: false,
    height: 0.135,
    thickness: 0.018,
    material: schemes.houseBootLobby.trim,
    gaps: [doorGap('hallBoot', stairNorthFace), doorGap('bootWc', -0.06)],
  });
  addSkirting({
    name: 'simpleHouse.skirting.cloakroom',
    floor: 'ground',
    zone: 'houseCloakroom',
    path: cloakroomPath,
    height: 0.135,
    thickness: 0.018,
    material: schemes.houseCloakroom.trim,
    gaps: [doorGap('bootWc', 0.06)],
  });

  // First-floor skirtings
  addSkirting({
    name: 'simpleHouse.skirting.landing',
    floor: 'first',
    zone: 'houseLanding',
    path: hallPath,
    material: schemes.houseLanding.trim,
    gaps: [
      doorGap('landingGuest', hFace),
      { box: { minX: 1.05, maxX: 1.25, minZ: -1.37, maxZ: 2.675 }, cap: 'selfReturn' },
      doorGap('landingBathroom', stairSouthFace),
      doorGap('landingPrincipal', -hFace),
    ],
  });
  addSkirting({
    name: 'simpleHouse.skirting.principal',
    floor: 'first',
    zone: 'housePrincipalBed',
    path: principalPath,
    material: schemes.housePrincipalBed.trim,
    gaps: [
      doorGap('landingPrincipal', -pFace),
      doorGap('principalDressing', -1.65),
      { box: { minX: -5.5, maxX: -5.3, minZ: PRINCIPAL_BREAST.minZ - 0.004, maxZ: PRINCIPAL_BREAST.maxZ + 0.004 } },
    ],
  });
  addSkirting({
    name: 'simpleHouse.skirting.principalBreast',
    floor: 'first',
    zone: 'housePrincipalBed',
    path: principalBreastPath,
    closed: false,
    material: schemes.housePrincipalBed.trim,
    forceCutaway: cut('west', 'first'),
  });
  addSkirting({
    name: 'simpleHouse.skirting.dressing',
    floor: 'first',
    zone: 'housePrincipalBed',
    path: dressingPath,
    thickness: 0.016,
    material: schemes.housePrincipalDressing.trim,
    gaps: [
      doorGap('principalDressing', -1.77),
      doorGap('dressingEnsuite', -3.59),
      { box: { minX: -5.5, maxX: -5.32, minZ: -4.17, maxZ: -1.85 }, cap: 'selfReturn' },
    ],
  });
  addSkirting({
    name: 'simpleHouse.skirting.ensuite',
    floor: 'first',
    zone: 'housePrincipalEnsuite',
    path: ensuitePath,
    height: 0.125,
    thickness: 0.016,
    material: schemes.housePrincipalEnsuite.trim,
    gaps: [
      { box: { minX: -2.75, maxX: -1.49, minZ: -1.86, maxZ: -1.68 }, cap: 'selfReturn' },
      { box: { minX: -1.48, maxX: -1.3, minZ: -3.36, maxZ: -2.88 }, cap: 'selfReturn' },
      { box: { minX: -3.55, maxX: -2.18, minZ: -4.3, maxZ: -2.64 }, cap: 'selfReturn' },
      doorGap('dressingEnsuite', -3.47),
    ],
  });
  addSkirting({
    name: 'simpleHouse.skirting.guest',
    floor: 'first',
    zone: 'houseBedroom2',
    path: guestPath,
    thickness: 0.012,
    material: schemes.houseBedroom2.trim,
    gaps: [doorGap('landingGuest', pFace)],
  });
  addSkirting({
    name: 'simpleHouse.skirting.study',
    floor: 'first',
    zone: 'houseStudy',
    path: studyPath,
    thickness: 0.014,
    material: schemes.houseStudy.trim,
    gaps: [
      doorGap('landingStudy', pFace),
      doorGap('airingCupboard', -1.53),
      { box: { minX: 5.3, maxX: 5.5, minZ: STUDY_BREAST.minZ - 0.004, maxZ: STUDY_BREAST.maxZ + 0.004 } },
    ],
  });
  addSkirting({
    name: 'simpleHouse.skirting.studyBreast',
    floor: 'first',
    zone: 'houseStudy',
    path: studyBreastPath,
    closed: false,
    thickness: 0.014,
    material: schemes.houseStudy.trim,
  });
  addSkirting({
    name: 'simpleHouse.skirting.bathroom',
    floor: 'first',
    zone: 'houseBathroom',
    path: [
      [1.39, -1.8],
      [1.39, -2.45],
    ],
    closed: false,
    height: 0.135,
    thickness: 0.016,
    material: schemes.houseBathroom.trim,
    gaps: [{ box: { minX: 1.3, maxX: 1.48, minZ: -2.32, maxZ: -1.84 }, cap: 'selfReturn' }],
  });
  addSkirting({
    name: 'simpleHouse.skirting.bathroomNorth',
    floor: 'first',
    zone: 'houseBathroom',
    path: [
      [1.44, -IN_Z],
      [-1.11, -IN_Z],
    ],
    closed: false,
    height: 0.135,
    thickness: 0.016,
    material: schemes.houseBathroom.trim,
  });

  // Ground-floor ceiling cornices
  addCornice({
    name: 'simpleHouse.cornice.hall',
    floor: 'ground',
    zone: 'houseHall',
    path: hallPath,
    profile: 'georgian-cyma',
    material: schemes.houseHall.trim,
    gaps: [{ box: { minX: 1.02, maxX: 1.25, minZ: -0.72, maxZ: 2.6 }, cap: 'selfReturn' }],
  });
  addCornice({
    name: 'simpleHouse.cornice.drawing',
    floor: 'ground',
    zone: 'houseDrawing',
    path: drawingRectPath,
    profile: 'georgian-dentil',
    height: 0.12,
    projection: 0.115,
    material: schemes.houseDrawing.trim,
    gaps: [{ box: { minX: -5.5, maxX: -5.3, minZ: b.minZ - 0.003, maxZ: b.maxZ + 0.003 } }],
  });
  addCornice({
    name: 'simpleHouse.cornice.drawingBreast',
    floor: 'ground',
    zone: 'houseDrawing',
    path: drawingBreastPath,
    closed: false,
    profile: 'georgian-dentil',
    height: 0.12,
    projection: 0.115,
    material: schemes.houseDrawing.trim,
    forceCutaway: cut('west', 'ground'),
  });
  addCornice({
    name: 'simpleHouse.cornice.kitchen',
    floor: 'ground',
    zone: 'houseKitchenDiner',
    path: kitchenRectPath,
    profile: 'georgian-cyma',
    height: 0.12,
    projection: 0.115,
    material: schemes.houseKitchenDiner.trim,
    gaps: [
      { box: { minX: 5.3, maxX: 5.5, minZ: -2.463, maxZ: -0.817 } },
      { box: { minX: 5.25, maxX: 5.5, minZ: -0.29, maxZ: -0.03 }, cap: 'selfReturn' },
      { box: { minX: 1.3, maxX: 1.6, minZ: -0.31, maxZ: -0.01 }, cap: 'selfReturn' },
      { box: { minX: 1.3, maxX: 1.52, minZ: -1.68, maxZ: -1.5 }, cap: 'selfReturn' },
    ],
  });
  addCornice({
    name: 'simpleHouse.cornice.kitchenBreast',
    floor: 'ground',
    zone: 'houseKitchenDiner',
    path: kitchenBreastPath,
    closed: false,
    profile: 'georgian-cyma',
    height: 0.12,
    projection: 0.115,
    material: schemes.houseKitchenDiner.trim,
    gaps: [{ box: { minX: 4.65, maxX: 4.86, minZ: -1.68, maxZ: -1.5 }, cap: 'selfReturn' }],
    forceCutaway: cut('east', 'ground'),
  });
  addCornice({
    name: 'simpleHouse.cornice.bootLobby',
    floor: 'ground',
    zone: 'houseCloakroom',
    path: bootLobbyPath,
    profile: 'cove',
    height: 0.095,
    projection: 0.09,
    material: schemes.houseBootLobby.trim,
  });
  addCornice({
    name: 'simpleHouse.cornice.cloakroom',
    floor: 'ground',
    zone: 'houseCloakroom',
    path: cloakroomPath,
    profile: 'cove',
    height: 0.095,
    projection: 0.09,
    material: schemes.houseCloakroom.trim,
  });

  // First-floor ceiling cornices
  addCornice({ name: 'simpleHouse.cornice.landing', floor: 'first', zone: 'houseLanding', path: hallPath, profile: 'georgian-cyma', material: schemes.houseLanding.trim });
  addCornice({
    name: 'simpleHouse.cornice.principal',
    floor: 'first',
    zone: 'housePrincipalBed',
    path: principalPath,
    profile: 'georgian-dentil',
    height: 0.12,
    projection: 0.115,
    material: schemes.housePrincipalBed.trim,
    gaps: [{ box: { minX: -5.5, maxX: -5.3, minZ: PRINCIPAL_BREAST.minZ - 0.004, maxZ: PRINCIPAL_BREAST.maxZ + 0.004 } }],
  });
  addCornice({
    name: 'simpleHouse.cornice.principalBreast',
    floor: 'first',
    zone: 'housePrincipalBed',
    path: principalBreastPath,
    closed: false,
    profile: 'georgian-dentil',
    height: 0.12,
    projection: 0.115,
    material: schemes.housePrincipalBed.trim,
    forceCutaway: cut('west', 'first'),
  });
  addCornice({ name: 'simpleHouse.cornice.dressing', floor: 'first', zone: 'housePrincipalBed', path: dressingPath, profile: 'georgian-cyma', height: 0.11, projection: 0.105, material: schemes.housePrincipalDressing.trim });
  addCornice({ name: 'simpleHouse.cornice.ensuite', floor: 'first', zone: 'housePrincipalEnsuite', path: ensuitePath, profile: 'cove', height: 0.095, projection: 0.09, material: schemes.housePrincipalEnsuite.trim });
  addCornice({ name: 'simpleHouse.cornice.guest', floor: 'first', zone: 'houseBedroom2', path: guestPath, profile: 'georgian-cyma', material: schemes.houseBedroom2.trim });
  addCornice({
    name: 'simpleHouse.cornice.study',
    floor: 'first',
    zone: 'houseStudy',
    path: studyPath,
    profile: 'georgian-cyma',
    height: 0.11,
    projection: 0.105,
    material: schemes.houseStudy.trim,
    gaps: [{ box: { minX: 5.3, maxX: 5.5, minZ: STUDY_BREAST.minZ - 0.004, maxZ: STUDY_BREAST.maxZ + 0.004 } }],
  });
  addCornice({
    name: 'simpleHouse.cornice.studyBreast',
    floor: 'first',
    zone: 'houseStudy',
    path: studyBreastPath,
    closed: false,
    profile: 'georgian-cyma',
    height: 0.11,
    projection: 0.105,
    material: schemes.houseStudy.trim,
  });
  addCornice({ name: 'simpleHouse.cornice.bathroom', floor: 'first', zone: 'houseBathroom', path: bathroomPath, profile: 'cove', height: 0.095, projection: 0.09, material: schemes.houseBathroom.trim });

  const roses: readonly { id: string; floor: FloorId; xz: readonly [number, number] }[] = [
    { id: 'drawing', floor: 'ground', xz: [-3.39, 0] },
    { id: 'hall', floor: 'ground', xz: HALL_ROSE_XZ },
    { id: 'kitchenDining', floor: 'ground', xz: [3.39, 2.25] },
    { id: 'landing', floor: 'first', xz: LANDING_ROSE_XZ },
    { id: 'principal', floor: 'first', xz: [-3.39, 1.285] },
    { id: 'guest', floor: 'first', xz: [3.39, 2.06] },
  ];
  for (const r of roses) {
    const ceilY = r.floor === 'ground' ? GROUND_CEILING_SOFFIT_Y : FIRST_CEILING_SOFFIT_Y;
    (r.floor === 'ground' ? groundCeilingGroup : firstCeilingGroup).add(
      buildGeorgianCeilingRose({
        name: `simpleHouse.ceilingRose.${r.id}`,
        position: [r.xz[0], ceilY, r.xz[1]],
        diameterM: 0.64,
      })
    );
  }
  groundCeilingGroup.add(
    buildGeorgianCeilingPanelMoulding({
      name: 'simpleHouse.ceilingPanel.drawing',
      position: [-3.16, GROUND_CEILING_SOFFIT_Y, 0],
      widthM: 2.4,
      depthM: 5.6,
      zone: 'houseDrawing',
    })
  );
  firstCeilingGroup.add(
    buildGeorgianCeilingPanelMoulding({
      name: 'simpleHouse.ceilingPanel.principal',
      position: [-3.39, FIRST_CEILING_SOFFIT_Y, 1.285],
      widthM: 2.5,
      depthM: 3.8,
      zone: 'housePrincipalBed',
    })
  );
}
