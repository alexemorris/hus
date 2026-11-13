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
import { box, type FloorId } from './architecture-materials.ts';
import {
  BOOT_GARDEN_DOOR,
  DOORS,
  DOOR_CLEAR_W,
  DRAWING_FRENCH_DOOR,
  FRENCH_DOOR,
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

/**
 * Georgian 3-panel folded shutter & splayed reveal lining flanking a Ground-Floor South sash window.
 * Positioned 2 mm clear of `Z = IN_Z` interior plaster (centered around `Z = IN_Z - 0.012`) and
 * 4 mm outside sash architraves (`±0.610`) / 2.5 mm above window board (`0.7045`) so 0 z-fight!
 */
function buildSouthSashShutterReveal(opts: {
  readonly id: string;
  readonly centerX: number;
  readonly zone: string;
  readonly material: THREE.Material;
  readonly cutaway: CutawayWallDescriptor;
}): THREE.Group {
  const { id, centerX, zone, material, cutaway } = opts;
  const group = new THREE.Group();
  group.name = `simpleHouse.trim.shutterReveal.${id}`;
  group.userData.zoneId = zone;

  const yBot = FFL_GROUND + 0.707;
  const yTop = FFL_GROUND + 2.5;
  const totalH = yTop - yBot; // 1.793 m
  const innerOff = 0.614;
  const outerOff = 0.754;
  const leafW = outerOff - innerOff; // 0.140 m
  const stileW = 0.026;
  const panelW = leafW - stileW * 2 - 0.002;
  const zFrame = IN_Z - 0.012; // 4.208 (z ∈ [4.198, 4.218], 2 mm clear of 4.220 plaster)
  const zPanel = IN_Z - 0.011; // 4.209 (z ∈ [4.203, 4.215], 2 mm recessed from frame faces)

  const railSpecs: readonly [string, number, number][] = [
    ['railBot', yBot, 0.085],
    ['railDado', yBot + 0.52, 0.068],
    ['railMid', yBot + 1.16, 0.058],
    ['railTop', yTop - 0.072, 0.072],
  ];
  const panelSpans: readonly [string, number, number][] = [
    ['panelLow', yBot + 0.087, yBot + 0.518],
    ['panelMid', yBot + 0.59, yBot + 1.158],
    ['panelHigh', yBot + 1.22, yTop - 0.074],
  ];

  for (const [sideTag, s] of [['west', -1], ['east', 1]] as const) {
    const cx = centerX + s * (innerOff + outerOff) * 0.5;
    const innerStileX = centerX + s * (innerOff + stileW * 0.5);
    const outerStileX = centerX + s * (outerOff - stileW * 0.5);
    box(group, `${group.name}.${sideTag}.stileInner`, [stileW, totalH, 0.02], [innerStileX, yBot + totalH * 0.5, zFrame], material);
    box(group, `${group.name}.${sideTag}.stileOuter`, [stileW, totalH, 0.02], [outerStileX, yBot + totalH * 0.5, zFrame], material);

    for (const [rTag, ry, rh] of railSpecs) {
      box(group, `${group.name}.${sideTag}.${rTag}`, [panelW, rh, 0.02], [cx, ry + rh * 0.5, zFrame], material);
    }
    for (const [pTag, py0, py1] of panelSpans) {
      const ph = py1 - py0;
      box(group, `${group.name}.${sideTag}.${pTag}`, [panelW, ph, 0.012], [cx, (py0 + py1) * 0.5, zPanel], material);
      box(group, `${group.name}.${sideTag}.${pTag}Field`, [panelW - 0.028, ph - 0.036, 0.004], [cx, (py0 + py1) * 0.5, zFrame - 0.008], material);
    }
  }

  tagCutaway(group, cutaway);
  return group;
}

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

  const pFace = HALL_PARTITION_X + SPINE_WALL_T * 0.5; // 1.89
  const hFace = HALL_PARTITION_X - SPINE_WALL_T * 0.5; // 1.65
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
  // Wrap Kitchen West skirting cleanly around engaged masonry nib pier kitchenRsjPierWest (`X ∈ [1.89, 2.08], Z ∈ [-0.306, -0.014]`)
  const kitchenSkirtingPath: [number, number][] = [
    [pFace, IN_Z],
    [IN_X, IN_Z],
    [IN_X, -IN_Z],
    [pFace, -IN_Z],
    [pFace, -0.308],
    [2.082, -0.308],
    [2.082, -0.012],
    [pFace, -0.012],
  ];
  const kitchenRectPath: [number, number][] = [
    [pFace, IN_Z],
    [IN_X, IN_Z],
    [IN_X, -IN_Z],
    [pFace, -IN_Z],
  ];
  const kitchenPierEastPath: [number, number][] = [
    [IN_X - 0.02, -0.032],
    [6.9, -0.032],
    [6.9, -0.288],
    [IN_X - 0.02, -0.288],
  ];
  const kitchenBreastPath: [number, number][] = [
    [IN_X - 0.118, -0.82],
    [6.392, -0.82],
    [6.392, -2.46],
    [IN_X - 0.118, -2.46],
  ];
  const bootLobbyPath: [number, number][] = [
    [-hFace, stairNorthFace],
    [-0.31, stairNorthFace],
    [-0.31, -IN_Z],
    [-hFace, -IN_Z],
  ];
  const cloakroomPath: [number, number][] = [
    [-0.19, stairNorthFace],
    [hFace, stairNorthFace],
    [hFace, -IN_Z],
    [-0.19, -IN_Z],
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
    [-4.45, -1.77],
    [-4.45, -IN_Z],
    [-IN_X, -IN_Z],
  ];
  const ensuitePath: [number, number][] = [
    [-4.33, -1.77],
    [-pFace, -1.77],
    [-pFace, -IN_Z],
    [-4.33, -IN_Z],
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
    [2.87, -IN_Z],
    [2.87, -1.53],
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
    [1.89, stairNorthFace],
    [1.89, -2.45],
    [2.75, -2.45],
    [2.75, -IN_Z],
    [-hFace, -IN_Z],
  ];

  const doorGap = (id: string, faceCoord: number) => {
    const d = DOORS.find((spec) => spec.id === id)!;
    const width = (d.clearWidth ?? DOOR_CLEAR_W) + 0.144;
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
      elevationY: floorY[opts.floor] + 0.0015,
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

  // Ground-floor skirtings, dado rail & Georgian shutter reveals
  addSkirting({
    name: 'simpleHouse.skirting.hall',
    floor: 'ground',
    zone: 'houseHall',
    path: hallPath,
    material: schemes.houseHall.trim,
    gaps: [
      { box: { minX: -0.58, maxX: 0.58, minZ: 4.1, maxZ: 4.35 }, cap: 'selfReturn' },
      { box: { minX: 0.49, maxX: 1.66, minZ: -0.66, maxZ: 3.08 }, cap: 'selfReturn' },
      doorGap('hallKitchen', hFace),
      doorGap('hallWc', stairSouthFace),
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
      { box: { minX: DRAWING_FRENCH_DOOR.x - 0.815, maxX: DRAWING_FRENCH_DOOR.x + 0.815, minZ: -4.34, maxZ: -4.1 }, cap: 'selfReturn' },
      { box: { minX: -7.15, maxX: -6.95, minZ: -4.23, maxZ: 4.23 } },
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
      { box: { minX: 6.95, maxX: 7.15, minZ: -2.47, maxZ: -0.81 }, cap: 'selfReturn' },
      { box: { minX: 6.95, maxX: 7.15, minZ: -0.29, maxZ: -0.03 } },
      { box: { minX: FRENCH_DOOR.x - 0.815, maxX: FRENCH_DOOR.x + 0.815, minZ: -4.34, maxZ: -4.1 }, cap: 'selfReturn' },
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
        { box: { minX: -5.35 - 0.77, maxX: -5.35 + 0.77, minZ: 4.1, maxZ: 4.32 }, cap: 'selfReturn' },
        { box: { minX: -2.95 - 0.77, maxX: -2.95 + 0.77, minZ: 4.1, maxZ: 4.32 }, cap: 'selfReturn' },
        { box: { minX: DRAWING_FRENCH_DOOR.x - 0.82, maxX: DRAWING_FRENCH_DOOR.x + 0.82, minZ: -4.32, maxZ: -4.1 }, cap: 'selfReturn' },
        { box: { minX: -2.95 - 0.71, maxX: -2.95 + 0.71, minZ: -4.32, maxZ: -4.1 }, cap: 'selfReturn' },
        { box: { minX: -7.15, maxX: -6.95, minZ: -4.23, maxZ: 4.23 } },
      ],
      cutawayWalls: groundNet.cutaways,
      floor: 'ground',
      zone: 'houseDrawing',
    })
  );

  // Georgian panelled shutter/reveal linings on all 4 Ground-Floor South front sash windows
  const southGroundCut = cut('south', 'ground');
  for (const sSpec of [
    { id: 'drawingSouthWest', centerX: -5.35, zone: 'houseDrawing', material: schemes.houseDrawing.trim },
    { id: 'drawingSouthEast', centerX: -2.95, zone: 'houseDrawing', material: schemes.houseDrawing.trim },
    { id: 'diningSouthWest', centerX: 2.95, zone: 'houseKitchenDiner', material: schemes.houseKitchenDiner.trim },
    { id: 'diningSouthEast', centerX: 5.35, zone: 'houseKitchenDiner', material: schemes.houseKitchenDiner.trim },
  ] as const) {
    groundGroup.add(buildSouthSashShutterReveal({ ...sSpec, cutaway: southGroundCut }));
  }

  addSkirting({
    name: 'simpleHouse.skirting.bootLobby',
    floor: 'ground',
    zone: 'houseBootLobby',
    path: bootLobbyPath,
    height: 0.135,
    thickness: 0.018,
    material: schemes.houseBootLobby.trim,
    gaps: [
      doorGap('hallBoot', stairNorthFace),
      { box: { minX: BOOT_GARDEN_DOOR.x - 0.5, maxX: BOOT_GARDEN_DOOR.x + 0.5, minZ: -4.34, maxZ: -4.1 }, cap: 'selfReturn' },
    ],
  });
  addSkirting({
    name: 'simpleHouse.skirting.cloakroom',
    floor: 'ground',
    zone: 'houseCloakroom',
    path: cloakroomPath,
    height: 0.135,
    thickness: 0.018,
    material: schemes.houseCloakroom.trim,
    gaps: [doorGap('hallWc', stairNorthFace)],
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
      doorGap('landingStudy', hFace),
      { box: { minX: 0.46, maxX: 1.66, minZ: -0.66, maxZ: 2.66 }, cap: 'selfReturn' },
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
      doorGap('principalEnsuite', -1.65),
      doorGap('principalDressing', -1.65),
      { box: { minX: -7.15, maxX: -6.95, minZ: PRINCIPAL_BREAST.minZ - 0.01, maxZ: PRINCIPAL_BREAST.maxZ + 0.01 } },
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
      { box: { minX: -7.15, maxX: -6.95, minZ: -4.18, maxZ: -1.84 }, cap: 'selfReturn' },
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
    gaps: [doorGap('principalEnsuite', -1.77)],
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
      { box: { minX: 6.95, maxX: 7.15, minZ: STUDY_BREAST.minZ - 0.01, maxZ: STUDY_BREAST.maxZ + 0.01 } },
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
    forceCutaway: cut('east', 'first'),
  });
  addSkirting({
    name: 'simpleHouse.skirting.bathroom',
    floor: 'first',
    zone: 'houseBathroom',
    path: [
      [1.89, -1.8],
      [1.89, -2.45],
    ],
    closed: false,
    height: 0.135,
    thickness: 0.016,
    material: schemes.houseBathroom.trim,
  });
  addSkirting({
    name: 'simpleHouse.skirting.bathroomNorth',
    floor: 'first',
    zone: 'houseBathroom',
    path: [
      [1.98, -IN_Z],
      [-1.62, -IN_Z],
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
    gaps: [{ box: { minX: 0.45, maxX: 1.66, minZ: -0.66, maxZ: 2.66 }, cap: 'selfReturn' }],
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
    gaps: [{ box: { minX: -7.15, maxX: -6.95, minZ: b.minZ - 0.01, maxZ: b.maxZ + 0.01 } }],
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
      { box: { minX: 6.95, maxX: 7.15, minZ: -2.47, maxZ: -0.81 } },
      { box: { minX: 6.88, maxX: 7.15, minZ: -0.295, maxZ: -0.025 }, cap: 'selfReturn' },
      { box: { minX: 1.8, maxX: 2.1, minZ: -0.315, maxZ: -0.005 }, cap: 'selfReturn' },
      { box: { minX: 1.8, maxX: 2.02, minZ: -1.7, maxZ: -1.48 }, cap: 'selfReturn' },
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
    gaps: [{ box: { minX: 6.3, maxX: 6.5, minZ: -1.7, maxZ: -1.48 }, cap: 'selfReturn' }],
    forceCutaway: cut('east', 'ground'),
  });
  addCornice({
    name: 'simpleHouse.cornice.bootLobby',
    floor: 'ground',
    zone: 'houseBootLobby',
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
    gaps: [{ box: { minX: -7.15, maxX: -6.95, minZ: PRINCIPAL_BREAST.minZ - 0.01, maxZ: PRINCIPAL_BREAST.maxZ + 0.01 } }],
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
    gaps: [{ box: { minX: 6.95, maxX: 7.15, minZ: STUDY_BREAST.minZ - 0.01, maxZ: STUDY_BREAST.maxZ + 0.01 } }],
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
    forceCutaway: cut('east', 'first'),
  });
  addCornice({ name: 'simpleHouse.cornice.bathroom', floor: 'first', zone: 'houseBathroom', path: bathroomPath, profile: 'cove', height: 0.095, projection: 0.09, material: schemes.houseBathroom.trim });

  // Ceiling roses & Georgian panel mouldings centered on 5.16 m wings
  const roses: readonly { id: string; floor: FloorId; xz: readonly [number, number] }[] = [
    { id: 'drawing', floor: 'ground', xz: [-4.47, 0] },
    { id: 'hall', floor: 'ground', xz: HALL_ROSE_XZ },
    { id: 'kitchenDining', floor: 'ground', xz: [4.47, 2.25] },
    { id: 'landing', floor: 'first', xz: LANDING_ROSE_XZ },
    { id: 'principal', floor: 'first', xz: [-4.47, 1.285] },
    { id: 'guest', floor: 'first', xz: [4.47, 2.06] },
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
      position: [-4.47, GROUND_CEILING_SOFFIT_Y, 0],
      widthM: 3.4,
      depthM: 6.2,
      zone: 'houseDrawing',
    })
  );
  firstCeilingGroup.add(
    buildGeorgianCeilingPanelMoulding({
      name: 'simpleHouse.ceilingPanel.principal',
      position: [-4.47, FIRST_CEILING_SOFFIT_Y, 1.285],
      widthM: 3.4,
      depthM: 4.0,
      zone: 'housePrincipalBed',
    })
  );
}
