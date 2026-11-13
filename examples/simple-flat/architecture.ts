import * as THREE from 'three';
import type { CutawayWallDescriptor } from 'husjs';
import {
  createBrickMaterial,
  createPaintMaterial,
  createRoomPaintScheme,
  createSharedSourceTextureVariant,
  createStoneMasonryMaterial,
  type RoomPaintScheme,
} from 'husjs/materials';
import {
  createCorniceRun,
  createEngineeredOakFloorTextures,
  createParisianManoirCabochonTextures,
  createSkirtingRun,
  extrudePlanarSolidWithHoles,
  mouldingPath,
  prepGeo,
  projectWorldBoxUVs,
  registerHingedDoor,
  tagCutaway,
} from 'husjs/objects';
import {
  buildGeorgianCeilingRose,
  createHandmadeOliveMetroTileMaterial,
  createPaleOakHerringboneParquetMaterial,
  getPaleEuropeanOakJoineryMaterial,
} from 'husjs/catalog/architectural';
import { buildGeorgianCoachLantern } from 'husjs/catalog/lighting';
import { getBathroomBrassMaterials } from 'husjs/catalog/sanitaryware';
import type { SceneBuilderContext } from 'husjs/viewer';
import {
  BATH_HALL_X,
  BED_BATH_Z,
  EXT_T,
  IN_X,
  IN_Z,
  INT_T,
  SPINE_X,
  WALL_H,
} from './electrical-and-rooms.ts';
import {
  addDoorArchitravePortal,
  addFlatBox,
  buildCasementWindow,
  buildCourtyardGrounds,
  buildPanelledInteriorDoorLeaf,
  createArchitecturalGlassMaterial,
} from './grounds-and-openings.ts';

export interface SimpleFlatShell {
  readonly root: THREE.Group;
  readonly northCut: CutawayWallDescriptor;
  readonly southCut: CutawayWallDescriptor;
  readonly eastCut: CutawayWallDescriptor;
  readonly westCut: CutawayWallDescriptor;
  readonly schemes: {
    readonly living: RoomPaintScheme;
    readonly hall: RoomPaintScheme;
    readonly bedroom: RoomPaintScheme;
    readonly bathroom: RoomPaintScheme;
  };
  readonly trimMat: THREE.Material;
  readonly oakJoineryMat: THREE.Material;
  readonly brassMats: ReturnType<typeof getBathroomBrassMaterials>;
  readonly glassMat: THREE.MeshPhysicalMaterial;
}

export function buildSimpleFlatArchitecture(ctx: SceneBuilderContext): SimpleFlatShell {
  const root = new THREE.Group();
  root.name = 'simpleFlat.root';
  ctx.scene.add(root);
  const schemes = {
    living: createRoomPaintScheme({
      wallColor: "school-house-white",
      trimColor: "wimborne-white",
      ceilingColor: "wimborne-white",
      wallSheen: "estate-emulsion",
      roomKind: "kitchen",
    }),
    hall: createRoomPaintScheme({
      wallColor: "slipper-satin",
      trimColor: "wimborne-white",
      ceilingColor: "wimborne-white",
      roomKind: "hallway",
    }),
    bedroom: createRoomPaintScheme({
      wallColor: "skimming-stone",
      trimColor: "wimborne-white",
      ceilingColor: "wimborne-white",
      roomKind: "bedroom",
    }),
    bathroom: createRoomPaintScheme({
      wallColor: "mizzle",
      trimColor: "wimborne-white",
      ceilingColor: "wimborne-white",
      wallSheen: "modern-emulsion",
      roomKind: "bathroom",
    }),
  };
  const trimMat = schemes.living.trim;
  const exteriorWindowMat = createPaintMaterial({ color: 'farrow-ball:railings', sheen: 'exterior-eggshell' });
  const frontDoorMat = createPaintMaterial({ color: 'farrow-ball:green-smoke', sheen: 'exterior-eggshell' });
  const brickMat = createBrickMaterial({ preset: 'yellow-london-stock', bond: 'flemish' });
  const stoneMat = createStoneMasonryMaterial({ preset: 'sawn-yorkstone-coping' });
  const roofSlateMat = new THREE.MeshStandardMaterial({
    name: 'simpleFlat.leadRoofMat',
    color: 0x565b60,
    roughness: 0.62,
    metalness: 0.22,
  });
  const wetTileMat = createHandmadeOliveMetroTileMaterial();
  const oakJoineryMat = getPaleEuropeanOakJoineryMaterial();
  const brassMats = getBathroomBrassMaterials('SB');
  const glassMat = createArchitecturalGlassMaterial('simpleFlat.clearGlass');
  const castIronMat = new THREE.MeshStandardMaterial({
    name: 'simpleFlat.wroughtIron',
    color: 0x222629,
    roughness: 0.38,
    metalness: 0.76,
  });

  buildCourtyardGrounds(root, stoneMat, brickMat);

  addFlatBox(root, 'simpleFlat.plinth.base', [9.0, 0.218, 7.4], [0, -0.151, 0], stoneMat, 1.0);
  const plinthCollarGeo = extrudePlanarSolidWithHoles({
    outer: [[-4.5, -3.7], [4.5, -3.7], [4.5, 3.7], [-4.5, 3.7]],
    holes: [[[-4.202, -3.402], [4.202, -3.402], [4.202, 3.402], [-4.202, 3.402]]],
    origin: [0, 0, 0],
    uAxis: [1, 0, 0],
    vAxis: [0, 0, 1],
    wAxis: [0, 1, 0],
    depthRange: [-0.041, -0.0005],
  });
  projectWorldBoxUVs(plinthCollarGeo, undefined, 1.0);
  const plinthCollar = new THREE.Mesh(plinthCollarGeo, stoneMat);
  plinthCollar.name = 'simpleFlat.plinth.collar';
  plinthCollar.receiveShadow = true;
  root.add(plinthCollar);

  const parquetMat = createPaleOakHerringboneParquetMaterial();
  const oakTex = createEngineeredOakFloorTextures();
  const bedroomOakMat = new THREE.MeshStandardMaterial({
    name: 'simpleFlat.floor.bedroomWideOak',
    map: createSharedSourceTextureVariant(oakTex.colorMap, { repeat: [1.0, 1.0] }),
    bumpMap: createSharedSourceTextureVariant(oakTex.bumpMap, { repeat: [1.0, 1.0] }),
    bumpScale: 0.004,
    roughness: 0.54,
  });
  const cabochonTex = createParisianManoirCabochonTextures();
  const bathCabochonMat = new THREE.MeshStandardMaterial({
    name: 'simpleFlat.floor.parisianCabochon',
    map: createSharedSourceTextureVariant(cabochonTex.colorMap, { repeat: [1.1, 1.1] }),
    normalMap: createSharedSourceTextureVariant(cabochonTex.normalMap, { repeat: [1.1, 1.1] }),
    roughnessMap: createSharedSourceTextureVariant(cabochonTex.roughnessMap, { repeat: [1.1, 1.1] }),
    roughness: 0.36,
  });
  const addFloorPoly = (name: string, outer: readonly [number, number][], mat: THREE.Material, uvScale: number) => {
    const geo = extrudePlanarSolidWithHoles({
      outer,
      origin: [0, 0, 0],
      uAxis: [1, 0, 0],
      vAxis: [0, 0, 1],
      wAxis: [0, 1, 0],
      depthRange: [-0.04, -0.0006],
    });
    projectWorldBoxUVs(geo, undefined, uvScale);
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.receiveShadow = true;
    root.add(m);
  };

  addFloorPoly(
    'simpleFlat.floor.livingAndHallParquet',
    [[-0.598, -3.4], [4.2, -3.4], [4.2, 3.4], [-2.198, 3.4], [-2.198, 1.102], [-0.598, 1.102]],
    parquetMat,
    0.74
  );
  addFloorPoly('simpleFlat.floor.bedroomOak', [[-4.2, -3.4], [-0.602, -3.4], [-0.602, 1.098], [-4.2, 1.098]], bedroomOakMat, 0.85);
  addFloorPoly('simpleFlat.floor.bathroomCabochon', [[-4.2, 1.102], [-2.202, 1.102], [-2.202, 3.4], [-4.2, 3.4]], bathCabochonMat, 0.85);

  const ceilingSoffit = addFlatBox(ctx.ceilingMeshGroup, 'simpleFlat.ceiling.soffit', [8.86, 0.13, 7.26], [0, WALL_H + 0.066, 0], schemes.living.ceiling);
  ceilingSoffit.castShadow = false;
  addFlatBox(ctx.ceilingMeshGroup, 'simpleFlat.roof.deck', [8.56, 0.045, 6.96], [0, WALL_H + 0.155, 0], roofSlateMat, 1.2);
  const parapetGeo = extrudePlanarSolidWithHoles({
    outer: [[-4.45, -3.65], [4.45, -3.65], [4.45, 3.65], [-4.45, 3.65]],
    holes: [[[-4.26, -3.46], [4.26, -3.46], [4.26, 3.46], [-4.26, 3.46]]],
    origin: [0, 0, 0],
    uAxis: [1, 0, 0],
    vAxis: [0, 0, 1],
    wAxis: [0, 1, 0],
    depthRange: [WALL_H + 0.198, WALL_H + 0.44],
  });
  projectWorldBoxUVs(parapetGeo, undefined, 0.9);
  const parapetBrick = new THREE.Mesh(parapetGeo, brickMat);
  parapetBrick.name = 'simpleFlat.roof.parapetBrick';
  parapetBrick.castShadow = true;
  ctx.ceilingMeshGroup.add(parapetBrick);
  const copingGeo = extrudePlanarSolidWithHoles({
    outer: [[-4.52, -3.72], [4.52, -3.72], [4.52, 3.72], [-4.52, 3.72]],
    holes: [[[-4.22, -3.42], [4.22, -3.42], [4.22, 3.42], [-4.22, 3.42]]],
    origin: [0, 0, 0],
    uAxis: [1, 0, 0],
    vAxis: [0, 0, 1],
    wAxis: [0, 1, 0],
    depthRange: [WALL_H + 0.442, WALL_H + 0.505],
  });
  projectWorldBoxUVs(copingGeo, undefined, 1.0);
  const parapetCoping = new THREE.Mesh(copingGeo, stoneMat);
  parapetCoping.name = 'simpleFlat.roof.parapetCoping';
  parapetCoping.castShadow = true;
  ctx.ceilingMeshGroup.add(parapetCoping);

  for (const [rName, rx, rz, diam] of [
    ['simpleFlat.rose.hall', -1.4, 2.28, 0.44],
    ['simpleFlat.rose.living', 2.65, 1.45, 0.58],
    ['simpleFlat.rose.dining', 0.52, -0.62, 0.46],
    ['simpleFlat.rose.bedroom', -2.55, -1.35, 0.52],
  ] as const) {
    const rose = buildGeorgianCeilingRose({ name: rName, diameterM: diam });
    rose.position.set(rx, WALL_H - 0.001, rz);
    ctx.ceilingMeshGroup.add(rose);
  }

  const wallBaseY = 0.0005;
  const wallTopY = WALL_H - 0.0005;
  const extMaxX = IN_X + EXT_T;
  const northCut: CutawayWallDescriptor = { axis: 'z', coord: -IN_Z, minSpan: -extMaxX, maxSpan: extMaxX, floor: 'level-0', outwardSide: 'north' };
  const southCut: CutawayWallDescriptor = { axis: 'z', coord: IN_Z, minSpan: -extMaxX, maxSpan: extMaxX, floor: 'level-0', outwardSide: 'south' };
  const eastCut: CutawayWallDescriptor = { axis: 'x', coord: IN_X, minSpan: -3.65, maxSpan: 3.65, floor: 'level-0', outwardSide: 'east' };
  const westCut: CutawayWallDescriptor = { axis: 'x', coord: -IN_X, minSpan: -3.65, maxSpan: 3.65, floor: 'level-0', outwardSide: 'west' };

  const northBrickGeo = extrudePlanarSolidWithHoles({
    outer: [[-extMaxX, wallBaseY], [extMaxX, wallBaseY], [extMaxX, wallTopY], [-extMaxX, wallTopY]],
    holes: [
      [[-3.3, 0.85], [-1.5, 0.85], [-1.5, 2.25], [-3.3, 2.25]],
      [[0.8, 1.02], [2.75, 1.02], [2.75, 2.25], [0.8, 2.25]],
    ],
    origin: [0, 0, -IN_Z],
    depthRange: [-EXT_T, -0.014],
  });
  projectWorldBoxUVs(northBrickGeo, undefined, 0.9);
  const northBrick = new THREE.Mesh(northBrickGeo, brickMat);
  northBrick.name = 'simpleFlat.wall.northBrick';
  northBrick.castShadow = true;
  northBrick.receiveShadow = true;
  tagCutaway(northBrick, northCut);
  root.add(northBrick);
  const northBedLining = new THREE.Mesh(
    extrudePlanarSolidWithHoles({
      outer: [[-IN_X + 0.014, wallBaseY], [SPINE_X - INT_T * 0.5 - 0.002, wallBaseY], [SPINE_X - INT_T * 0.5 - 0.002, wallTopY], [-IN_X + 0.014, wallTopY]],
      holes: [[[-3.3, 0.85], [-1.5, 0.85], [-1.5, 2.25], [-3.3, 2.25]]],
      origin: [0, 0, -IN_Z],
      depthRange: [0, 0.012],
    }),
    schemes.bedroom.walls
  );
  northBedLining.name = 'simpleFlat.wall.northBedroomLining';
  northBedLining.receiveShadow = true;
  tagCutaway(northBedLining, northCut);
  root.add(northBedLining);
  const northKitLining = new THREE.Mesh(
    extrudePlanarSolidWithHoles({
      outer: [[SPINE_X + INT_T * 0.5 + 0.002, wallBaseY], [IN_X - 0.014, wallBaseY], [IN_X - 0.014, wallTopY], [SPINE_X + INT_T * 0.5 + 0.002, wallTopY]],
      holes: [[[0.8, 1.02], [2.75, 1.02], [2.75, 2.25], [0.8, 2.25]]],
      origin: [0, 0, -IN_Z],
      depthRange: [0, 0.012],
    }),
    schemes.living.walls
  );
  northKitLining.name = 'simpleFlat.wall.northKitchenLining';
  northKitLining.receiveShadow = true;
  tagCutaway(northKitLining, northCut);
  root.add(northKitLining);

  buildCasementWindow(root, {
    name: 'flat.win.bedN', cx: -2.4, cy: 1.55, cz: -3.52, width: 1.8, height: 1.4, rotY: 0,
    frameMat: exteriorWindowMat, sillMat: trimMat, stoneMat, glassMat, brassMat: brassMats.primary, panesCols: 3, cutaway: northCut,
  });
  buildCasementWindow(root, {
    name: 'flat.win.kitN', cx: 1.775, cy: 1.635, cz: -3.52, width: 1.95, height: 1.23, rotY: 0,
    frameMat: exteriorWindowMat, sillMat: trimMat, stoneMat, glassMat, brassMat: brassMats.primary, panesCols: 3, cutaway: northCut,
  });

  const southBrickGeo = extrudePlanarSolidWithHoles({
    outer: [
      [-extMaxX, wallBaseY], [-1.95, wallBaseY], [-1.95, 2.22], [-1.0, 2.22], [-1.0, wallBaseY],
      [0.85, wallBaseY], [0.85, 2.34], [2.65, 2.34], [2.65, wallBaseY], [extMaxX, wallBaseY], [extMaxX, wallTopY], [-extMaxX, wallTopY],
    ],
    origin: [0, 0, IN_Z],
    depthRange: [0.014, EXT_T],
  });
  projectWorldBoxUVs(southBrickGeo, undefined, 0.9);
  const southBrick = new THREE.Mesh(southBrickGeo, brickMat);
  southBrick.name = 'simpleFlat.wall.southBrick';
  southBrick.castShadow = true;
  southBrick.receiveShadow = true;
  tagCutaway(southBrick, southCut);
  root.add(southBrick);
  const southBathLining = new THREE.Mesh(
    extrudePlanarSolidWithHoles({
      outer: [[-IN_X + 0.014, wallBaseY], [BATH_HALL_X - INT_T * 0.5 - 0.002, wallBaseY], [BATH_HALL_X - INT_T * 0.5 - 0.002, wallTopY], [-IN_X + 0.014, wallTopY]],
      origin: [0, 0, IN_Z],
      depthRange: [-0.012, 0],
    }),
    schemes.bathroom.walls
  );
  southBathLining.name = 'simpleFlat.wall.southBathroomLining';
  southBathLining.receiveShadow = true;
  tagCutaway(southBathLining, southCut);
  root.add(southBathLining);
  const southHallLining = new THREE.Mesh(
    extrudePlanarSolidWithHoles({
      outer: [
        [BATH_HALL_X + INT_T * 0.5 + 0.002, wallBaseY], [-1.95, wallBaseY], [-1.95, 2.22], [-1.0, 2.22], [-1.0, wallBaseY],
        [SPINE_X - INT_T * 0.5 - 0.002, wallBaseY], [SPINE_X - INT_T * 0.5 - 0.002, wallTopY], [BATH_HALL_X + INT_T * 0.5 + 0.002, wallTopY],
      ],
      origin: [0, 0, IN_Z],
      depthRange: [-0.012, 0],
    }),
    schemes.hall.walls
  );
  southHallLining.name = 'simpleFlat.wall.southHallLining';
  southHallLining.receiveShadow = true;
  tagCutaway(southHallLining, southCut);
  root.add(southHallLining);
  const southLivingLining = new THREE.Mesh(
    extrudePlanarSolidWithHoles({
      outer: [
        [SPINE_X + INT_T * 0.5 + 0.002, wallBaseY], [0.85, wallBaseY], [0.85, 2.34], [2.65, 2.34], [2.65, wallBaseY],
        [IN_X - 0.014, wallBaseY], [IN_X - 0.014, wallTopY], [SPINE_X + INT_T * 0.5 + 0.002, wallTopY],
      ],
      origin: [0, 0, IN_Z],
      depthRange: [-0.012, 0],
    }),
    schemes.living.walls
  );
  southLivingLining.name = 'simpleFlat.wall.southLivingLining';
  southLivingLining.receiveShadow = true;
  tagCutaway(southLivingLining, southCut);
  root.add(southLivingLining);

  const entryGroup = new THREE.Group();
  entryGroup.name = 'simpleFlat.entryDoorEnsemble';
  entryGroup.position.set(-1.475, 0, IN_Z + 0.12);
  addFlatBox(entryGroup, 'simpleFlat.entry.stoneLintel', [1.14, 0.14, 0.04], [0, 2.3, 0.142], stoneMat, 1.0);
  addFlatBox(entryGroup, 'simpleFlat.entry.frameL', [0.048, 2.21, 0.236], [-0.449, 1.11, 0], trimMat);
  addFlatBox(entryGroup, 'simpleFlat.entry.frameR', [0.048, 2.21, 0.236], [0.449, 1.11, 0], trimMat);
  addFlatBox(entryGroup, 'simpleFlat.entry.frameTop', [0.848, 0.048, 0.236], [0, 2.192, 0], trimMat);
  addFlatBox(entryGroup, 'simpleFlat.entry.transom', [0.848, 0.042, 0.095], [0, 1.88, 0], trimMat);
  const fanlightGlass = addFlatBox(entryGroup, 'simpleFlat.entry.fanlightGlass', [0.84, 0.26, 0.012], [0, 2.035, 0], glassMat);
  fanlightGlass.castShadow = false;
  fanlightGlass.userData.isExteriorGlazedPortal = true;
  const entryLeaf = buildPanelledInteriorDoorLeaf('simpleFlat.entry.leaf', 0.842, 1.85, false, frontDoorMat, brassMats.primary);
  entryLeaf.position.set(0, 0.93, 0);
  addFlatBox(entryLeaf, 'simpleFlat.entry.letterplate', [0.22, 0.062, 0.012], [0, -0.06, 0.028], brassMats.primary);
  addFlatBox(entryLeaf, 'simpleFlat.entry.knocker', [0.036, 0.11, 0.018], [0, 0.34, 0.031], brassMats.primary);
  entryGroup.add(entryLeaf);
  tagCutaway(entryGroup, southCut);
  root.add(entryGroup);
  const coachLantern = buildGeorgianCoachLantern(ctx, {
    name: 'simpleFlat.entry.coachLantern',
    position: [-0.74, 1.86, IN_Z + EXT_T + 0.002],
    rotationY: 0,
    circuitId: 'flatEntryLantern' as never,
    createPointLight: false,
  });
  tagCutaway(coachLantern, southCut);
  root.add(coachLantern);

  const balconyFrame = new THREE.Group();
  balconyFrame.name = 'simpleFlat.julietBalconyFrame';
  addFlatBox(balconyFrame, 'simpleFlat.balcony.stoneLintel', [2.02, 0.145, 0.04], [1.75, 2.42, IN_Z + EXT_T + 0.022], stoneMat, 1.0);
  addFlatBox(balconyFrame, 'simpleFlat.balcony.stoneThreshold', [1.96, 0.052, 0.34], [1.75, -0.027, IN_Z + 0.165], stoneMat, 1.0);
  addFlatBox(balconyFrame, 'simpleFlat.balcony.jambL', [0.048, 2.33, 0.236], [0.876, 1.17, IN_Z + 0.12], exteriorWindowMat);
  addFlatBox(balconyFrame, 'simpleFlat.balcony.jambR', [0.048, 2.33, 0.236], [2.624, 1.17, IN_Z + 0.12], exteriorWindowMat);
  addFlatBox(balconyFrame, 'simpleFlat.balcony.head', [1.696, 0.048, 0.236], [1.75, 2.312, IN_Z + 0.12], exteriorWindowMat);
  const railZ = IN_Z + EXT_T + 0.11;
  const railW = 1.92;
  addFlatBox(balconyFrame, 'simpleFlat.balcony.topRail', [railW, 0.032, 0.038], [1.75, 1.06, railZ], castIronMat);
  addFlatBox(balconyFrame, 'simpleFlat.balcony.botRail', [railW, 0.028, 0.032], [1.75, 0.12, railZ], castIronMat);
  addFlatBox(balconyFrame, 'simpleFlat.balcony.brassTopCap', [railW + 0.02, 0.012, 0.044], [1.75, 1.084, railZ], brassMats.primary);
  for (const sx of [-1, 1] as const) {
    const endX = 1.75 + sx * (railW * 0.5 - 0.014);
    addFlatBox(balconyFrame, `simpleFlat.balcony.returnTop_${sx}`, [0.028, 0.028, 0.092], [endX, 1.06, railZ - 0.066], castIronMat);
    addFlatBox(balconyFrame, `simpleFlat.balcony.returnBot_${sx}`, [0.026, 0.026, 0.092], [endX, 0.12, railZ - 0.066], castIronMat);
  }
  for (let i = 0; i < 15; i++) {
    const bx = 1.75 - (railW - 0.12) * 0.5 + (i / 14) * (railW - 0.12);
    addFlatBox(balconyFrame, `simpleFlat.balcony.spindle_${i + 1}`, [0.016, 0.908, 0.016], [bx, 0.59, railZ], castIronMat);
    if (i % 2 === 1) {
      const ring = new THREE.Mesh(prepGeo(new THREE.TorusGeometry(0.044, 0.008, 8, 18)), castIronMat);
      ring.name = `simpleFlat.balcony.scrollRing_${i}`;
      ring.position.set(bx - (railW - 0.12) / 28, 0.94, railZ);
      balconyFrame.add(ring);
    }
  }
  tagCutaway(balconyFrame, southCut);
  root.add(balconyFrame);
  const balconyLeaf = new THREE.Group();
  balconyLeaf.name = 'flatBalconyDoor';
  const bDoorW = 0.842;
  const bDoorH = 2.27;
  const bStileW = 0.068;
  const bTopRail = 0.085;
  const bBotRail = 0.185;
  const bInnerW = bDoorW - 2 * bStileW - 0.002;
  const bGlassH = bDoorH - bTopRail - bBotRail - 0.004;
  addFlatBox(balconyLeaf, 'flatBalconyDoor.stileL', [bStileW, bDoorH, 0.052], [-bDoorW * 0.5 + bStileW * 0.5, bDoorH * 0.5, 0], exteriorWindowMat);
  addFlatBox(balconyLeaf, 'flatBalconyDoor.stileR', [bStileW, bDoorH, 0.052], [bDoorW * 0.5 - bStileW * 0.5, bDoorH * 0.5, 0], exteriorWindowMat);
  addFlatBox(balconyLeaf, 'flatBalconyDoor.railTop', [bInnerW, bTopRail, 0.052], [0, bDoorH - bTopRail * 0.5, 0], exteriorWindowMat);
  addFlatBox(balconyLeaf, 'flatBalconyDoor.railBot', [bInnerW, bBotRail, 0.052], [0, bBotRail * 0.5, 0], exteriorWindowMat);
  const bGlass = addFlatBox(balconyLeaf, 'flatBalconyDoor.glass', [bInnerW - 0.002, bGlassH, 0.014], [0, bBotRail + bGlassH * 0.5, 0], glassMat);
  bGlass.castShadow = false;
  bGlass.userData.isExteriorGlazedPortal = true;
  for (const frac of [0.33, 0.67] as const) {
    addFlatBox(balconyLeaf, `flatBalconyDoor.barOut_${frac}`, [bInnerW - 0.004, 0.018, 0.008], [0, bBotRail + bGlassH * frac, 0.012], exteriorWindowMat);
    addFlatBox(balconyLeaf, `flatBalconyDoor.barIn_${frac}`, [bInnerW - 0.004, 0.018, 0.008], [0, bBotRail + bGlassH * frac, -0.012], exteriorWindowMat);
  }
  addFlatBox(balconyLeaf, 'flatBalconyDoor.brassHandle', [0.016, 0.11, 0.036], [bDoorW * 0.5 - 0.034, 1.02, -0.044], brassMats.primary);
  balconyLeaf.position.set(1.324, 0.012, IN_Z + 0.09);
  tagCutaway(balconyLeaf, southCut);
  root.add(balconyLeaf);
  registerHingedDoor(ctx, { parent: root, door: balconyLeaf, hingeOffset: [-bDoorW * 0.5, 0, 0], axis: 'y', openAngle: 1.24 });

  buildCasementWindow(root, {
    name: 'flat.win.balconyFixed', cx: 2.176, cy: 1.147, cz: IN_Z + 0.09, width: 0.848, height: 2.278, rotY: Math.PI,
    frameMat: exteriorWindowMat, sillMat: trimMat, stoneMat, glassMat, brassMat: brassMats.primary,
    includeExteriorSillAndLintel: false, includeInteriorBoard: false, panesCols: 2, cutaway: southCut,
  });

  const eastBrickGeo = extrudePlanarSolidWithHoles({
    outer: [[-IN_Z + 0.001, wallBaseY], [IN_Z - 0.001, wallBaseY], [IN_Z - 0.001, wallTopY], [-IN_Z + 0.001, wallTopY]],
    holes: [[[-0.9, 0.78], [1.6, 0.78], [1.6, 2.25], [-0.9, 2.25]]],
    origin: [IN_X, 0, 0], uAxis: [0, 0, 1], vAxis: [0, 1, 0], wAxis: [1, 0, 0], depthRange: [0.014, EXT_T],
  });
  projectWorldBoxUVs(eastBrickGeo, undefined, 0.9);
  const eastBrick = new THREE.Mesh(eastBrickGeo, brickMat);
  eastBrick.name = 'simpleFlat.wall.eastBrick';
  eastBrick.castShadow = true;
  eastBrick.receiveShadow = true;
  tagCutaway(eastBrick, eastCut);
  root.add(eastBrick);
  const eastLivingLining = new THREE.Mesh(
    extrudePlanarSolidWithHoles({
      outer: [[-IN_Z + 0.014, wallBaseY], [IN_Z - 0.014, wallBaseY], [IN_Z - 0.014, wallTopY], [-IN_Z + 0.014, wallTopY]],
      holes: [[[-0.9, 0.78], [1.6, 0.78], [1.6, 2.25], [-0.9, 2.25]]],
      origin: [IN_X, 0, 0], uAxis: [0, 0, 1], vAxis: [0, 1, 0], wAxis: [1, 0, 0], depthRange: [-0.012, 0],
    }),
    schemes.living.walls
  );
  eastLivingLining.name = 'simpleFlat.wall.eastLivingLining';
  eastLivingLining.receiveShadow = true;
  tagCutaway(eastLivingLining, eastCut);
  root.add(eastLivingLining);

  buildCasementWindow(root, {
    name: 'flat.win.east', cx: IN_X + 0.12, cy: 1.515, cz: 0.35, width: 2.5, height: 1.47, rotY: -Math.PI / 2,
    frameMat: exteriorWindowMat, sillMat: trimMat, stoneMat, glassMat, brassMat: brassMats.primary, panesCols: 3, cutaway: eastCut,
  });

  const westBrick = addFlatBox(root, 'simpleFlat.wall.westBrick', [EXT_T - 0.014, wallTopY - wallBaseY, (IN_Z - 0.001) * 2], [-IN_X - (EXT_T + 0.014) * 0.5, (wallTopY + wallBaseY) * 0.5, 0], brickMat, 0.9);
  tagCutaway(westBrick, westCut);
  const westBedLining = addFlatBox(root, 'simpleFlat.wall.westBedroomLining', [0.012, wallTopY - wallBaseY, BED_BATH_Z - INT_T * 0.5 + IN_Z - 0.016], [-IN_X + 0.006, (wallTopY + wallBaseY) * 0.5, (-IN_Z + 0.014 + BED_BATH_Z - INT_T * 0.5 - 0.002) * 0.5], schemes.bedroom.walls);
  tagCutaway(westBedLining, westCut);
  const westBathTile = addFlatBox(root, 'simpleFlat.wall.westBathroomWetTile', [0.012, wallTopY - wallBaseY, 2.24 - 1.162], [-IN_X + 0.006, (wallTopY + wallBaseY) * 0.5, (1.162 + 2.24) * 0.5], wetTileMat, 0.85);
  tagCutaway(westBathTile, westCut);
  const westBathPlaster = addFlatBox(root, 'simpleFlat.wall.westBathroomPlaster', [0.012, wallTopY - wallBaseY, IN_Z - 0.014 - 2.244], [-IN_X + 0.006, (wallTopY + wallBaseY) * 0.5, (2.244 + IN_Z - 0.014) * 0.5], schemes.bathroom.walls);
  tagCutaway(westBathPlaster, westCut);

  const spineArchMinZ = 1.43;
  const spineArchMaxZ = 2.47;
  const spineArchTopY = 2.202;
  const spineEastLiving = new THREE.Mesh(
    extrudePlanarSolidWithHoles({
      outer: [
        [-IN_Z + 0.014, wallBaseY], [spineArchMinZ, wallBaseY], [spineArchMinZ, spineArchTopY],
        [spineArchMaxZ, spineArchTopY], [spineArchMaxZ, wallBaseY], [IN_Z - 0.014, wallBaseY], [IN_Z - 0.014, wallTopY], [-IN_Z + 0.014, wallTopY],
      ],
      origin: [SPINE_X, 0, 0], uAxis: [0, 0, 1], vAxis: [0, 1, 0], wAxis: [1, 0, 0], depthRange: [0.001, INT_T * 0.5],
    }),
    schemes.living.walls
  );
  spineEastLiving.name = 'simpleFlat.wall.spineLiving';
  spineEastLiving.castShadow = true;
  spineEastLiving.receiveShadow = true;
  root.add(spineEastLiving);
  addFlatBox(
    root, 'simpleFlat.wall.spineBedroom',
    [INT_T * 0.5 - 0.001, wallTopY - wallBaseY, BED_BATH_Z - INT_T * 0.5 + IN_Z - 0.016],
    [SPINE_X - (INT_T * 0.5 + 0.001) * 0.5, (wallTopY + wallBaseY) * 0.5, (-IN_Z + 0.014 + BED_BATH_Z - INT_T * 0.5 - 0.002) * 0.5],
    schemes.bedroom.walls
  );
  const spineWestHall = new THREE.Mesh(
    extrudePlanarSolidWithHoles({
      outer: [
        [BED_BATH_Z + INT_T * 0.5 + 0.002, wallBaseY], [spineArchMinZ, wallBaseY], [spineArchMinZ, spineArchTopY],
        [spineArchMaxZ, spineArchTopY], [spineArchMaxZ, wallBaseY], [IN_Z - 0.014, wallBaseY], [IN_Z - 0.014, wallTopY], [BED_BATH_Z + INT_T * 0.5 + 0.002, wallTopY],
      ],
      origin: [SPINE_X, 0, 0], uAxis: [0, 0, 1], vAxis: [0, 1, 0], wAxis: [1, 0, 0], depthRange: [-INT_T * 0.5, -0.001],
    }),
    schemes.hall.walls
  );
  spineWestHall.name = 'simpleFlat.wall.spineHall';
  spineWestHall.castShadow = true;
  spineWestHall.receiveShadow = true;
  root.add(spineWestHall);

  addDoorArchitravePortal(root, {
    name: 'simpleFlat.portal.hallToLiving', plane: 'x', wallCenterCoord: SPINE_X, wallThickness: INT_T,
    clearMinU: 1.45, clearMaxU: 2.45, clearHeightY: 2.18, trimMat,
  });
  const bedDoorHoleMinX = -1.77;
  const bedDoorHoleMaxX = -0.88;
  const bedDoorHoleTopY = 2.122;
  const bedPartMaxX = SPINE_X - INT_T * 0.5 - 0.002;
  const bedPartNorth = new THREE.Mesh(
    extrudePlanarSolidWithHoles({
      outer: [
        [-IN_X + 0.014, wallBaseY], [bedDoorHoleMinX, wallBaseY], [bedDoorHoleMinX, bedDoorHoleTopY],
        [bedDoorHoleMaxX, bedDoorHoleTopY], [bedDoorHoleMaxX, wallBaseY], [bedPartMaxX, wallBaseY], [bedPartMaxX, wallTopY], [-IN_X + 0.014, wallTopY],
      ],
      origin: [0, 0, BED_BATH_Z], depthRange: [-INT_T * 0.5, -0.001],
    }),
    schemes.bedroom.walls
  );
  bedPartNorth.name = 'simpleFlat.wall.bedPartitionNorth';
  bedPartNorth.castShadow = true;
  bedPartNorth.receiveShadow = true;
  root.add(bedPartNorth);
  const bedPartSouthHall = new THREE.Mesh(
    extrudePlanarSolidWithHoles({
      outer: [
        [BATH_HALL_X + INT_T * 0.5 + 0.002, wallBaseY], [bedDoorHoleMinX, wallBaseY], [bedDoorHoleMinX, bedDoorHoleTopY],
        [bedDoorHoleMaxX, bedDoorHoleTopY], [bedDoorHoleMaxX, wallBaseY], [bedPartMaxX, wallBaseY], [bedPartMaxX, wallTopY], [BATH_HALL_X + INT_T * 0.5 + 0.002, wallTopY],
      ],
      origin: [0, 0, BED_BATH_Z], depthRange: [0.001, INT_T * 0.5],
    }),
    schemes.hall.walls
  );
  bedPartSouthHall.name = 'simpleFlat.wall.bedPartitionHall';
  bedPartSouthHall.castShadow = true;
  bedPartSouthHall.receiveShadow = true;
  root.add(bedPartSouthHall);
  addFlatBox(
    root, 'simpleFlat.wall.bathNorthWetTile',
    [-3.28 - (-IN_X + 0.014), wallTopY - wallBaseY, INT_T * 0.5 - 0.001],
    [(-IN_X + 0.014 - 3.28) * 0.5, (wallTopY + wallBaseY) * 0.5, BED_BATH_Z + (INT_T * 0.5 + 0.001) * 0.5],
    wetTileMat, 0.85
  );
  addFlatBox(
    root, 'simpleFlat.wall.bathNorthPlaster',
    [BATH_HALL_X - INT_T * 0.5 - 0.002 - -3.276, wallTopY - wallBaseY, INT_T * 0.5 - 0.001],
    [(-3.276 + BATH_HALL_X - INT_T * 0.5 - 0.002) * 0.5, (wallTopY + wallBaseY) * 0.5, BED_BATH_Z + (INT_T * 0.5 + 0.001) * 0.5],
    schemes.bathroom.walls
  );

  for (const [sideName, dRange, mat] of [
    ['simpleFlat.wall.bathPartitionWest', [-INT_T * 0.5, -0.001] as const, schemes.bathroom.walls],
    ['simpleFlat.wall.bathPartitionHall', [0.001, INT_T * 0.5] as const, schemes.hall.walls],
  ] as const) {
    const m = new THREE.Mesh(
      extrudePlanarSolidWithHoles({
        outer: [
          [BED_BATH_Z + INT_T * 0.5 + 0.002, wallBaseY], [1.43, wallBaseY], [1.43, 2.122],
          [2.22, 2.122], [2.22, wallBaseY], [IN_Z - 0.014, wallBaseY], [IN_Z - 0.014, wallTopY], [BED_BATH_Z + INT_T * 0.5 + 0.002, wallTopY],
        ],
        origin: [BATH_HALL_X, 0, 0], uAxis: [0, 0, 1], vAxis: [0, 1, 0], wAxis: [1, 0, 0], depthRange: dRange,
      }),
      mat
    );
    m.name = sideName;
    m.castShadow = true;
    m.receiveShadow = true;
    root.add(m);
  }

  addDoorArchitravePortal(root, {
    name: 'simpleFlat.portal.bedroomDoor', plane: 'z', wallCenterCoord: BED_BATH_Z, wallThickness: INT_T,
    clearMinU: -1.75, clearMaxU: -0.9, clearHeightY: 2.1, trimMat, thresholdMat: brassMats.primary,
  });
  const bedDoor = buildPanelledInteriorDoorLeaf('flatBedroomDoor', 0.824, 2.078, false, trimMat, brassMats.primary);
  bedDoor.position.set(-1.325, 1.044, BED_BATH_Z - INT_T * 0.5 - 0.024);
  root.add(bedDoor);
  registerHingedDoor(ctx, { parent: root, door: bedDoor, hingeOffset: [-0.412, -1.044, -0.021], axis: 'y', openAngle: 1.38 });

  addDoorArchitravePortal(root, {
    name: 'simpleFlat.portal.bathroomDoor', plane: 'x', wallCenterCoord: BATH_HALL_X, wallThickness: INT_T,
    clearMinU: 1.45, clearMaxU: 2.2, clearHeightY: 2.1, trimMat, thresholdMat: brassMats.primary,
  });
  const bathDoor = buildPanelledInteriorDoorLeaf('flatBathroomDoor', 0.724, 2.078, true, trimMat, brassMats.primary);
  bathDoor.position.set(BATH_HALL_X - INT_T * 0.5 - 0.024, 1.044, 1.825);
  root.add(bathDoor);
  registerHingedDoor(ctx, { parent: root, door: bathDoor, hingeOffset: [-0.021, -1.044, -0.362], axis: 'y', openAngle: -1.32 });

  const inEastX = IN_X - 0.012;
  const inWestX = -IN_X + 0.012;
  const inNorthZ = -IN_Z + 0.012;
  const inSouthZ = IN_Z - 0.012;
  const livingPts: readonly (readonly [number, number])[] = [
    [SPINE_X + INT_T * 0.5, inNorthZ], [inEastX, inNorthZ], [inEastX, inSouthZ], [SPINE_X + INT_T * 0.5, inSouthZ],
  ];
  const hallPts: readonly (readonly [number, number])[] = [
    [BATH_HALL_X + INT_T * 0.5, BED_BATH_Z + INT_T * 0.5], [SPINE_X - INT_T * 0.5, BED_BATH_Z + INT_T * 0.5],
    [SPINE_X - INT_T * 0.5, inSouthZ], [BATH_HALL_X + INT_T * 0.5, inSouthZ],
  ];
  const bedroomPts: readonly (readonly [number, number])[] = [
    [inWestX, inNorthZ], [SPINE_X - INT_T * 0.5, inNorthZ], [SPINE_X - INT_T * 0.5, BED_BATH_Z - INT_T * 0.5], [inWestX, BED_BATH_Z - INT_T * 0.5],
  ];
  const bathroomPts: readonly (readonly [number, number])[] = [
    [inWestX, BED_BATH_Z + INT_T * 0.5], [BATH_HALL_X - INT_T * 0.5, BED_BATH_Z + INT_T * 0.5],
    [BATH_HALL_X - INT_T * 0.5, inSouthZ], [inWestX, inSouthZ],
  ];
  root.add(
    createSkirtingRun({
      name: 'flat.living.skirting', zone: 'flatLivingKitchen',
      path: mouldingPath.startAt(livingPts[0]![0], livingPts[0]![1], { y: 0.001, roomSide: 'right' })
        .lineTo(livingPts[1]![0], livingPts[1]![1]).lineTo(livingPts[2]![0], livingPts[2]![1]).lineTo(livingPts[3]![0], livingPts[3]![1]).close(),
      profile: 'ogee', height: 0.125, thickness: 0.018, material: trimMat,
      gaps: [
        { box: { minX: -0.56, maxX: 3.92, minZ: -3.5, maxZ: -3.3 }, cap: 'selfReturn' },
        { box: { minX: 0.83, maxX: 2.67, minZ: 3.3, maxZ: 3.5 }, cap: 'selfReturn' },
        { box: { minX: 2.98, maxX: 4.1, minZ: 3.3, maxZ: 3.5 }, cap: 'selfReturn' },
        { box: { minX: -0.62, maxX: -0.46, minZ: 1.35, maxZ: 2.55 }, cap: 'selfReturn' },
      ],
      cutawayWalls: [northCut, eastCut, southCut], floor: 'level-0',
    }),
    createSkirtingRun({
      name: 'flat.hall.skirting', zone: 'flatHall', points: hallPts, closed: true, roomSide: 'right',
      elevationY: 0.001, profile: 'ogee', height: 0.125, thickness: 0.018, material: trimMat,
      gaps: [
        { box: { minX: -1.85, maxX: -0.8, minZ: 1.08, maxZ: 1.24 }, cap: 'selfReturn' },
        { box: { minX: -0.74, maxX: -0.58, minZ: 1.35, maxZ: 2.55 }, cap: 'selfReturn' },
        { box: { minX: -1.98, maxX: -0.97, minZ: 3.3, maxZ: 3.5 }, cap: 'selfReturn' },
        { box: { minX: -2.22, maxX: -2.06, minZ: 1.35, maxZ: 2.3 }, cap: 'selfReturn' },
      ],
      cutawayWalls: [southCut], floor: 'level-0',
    }),
    createSkirtingRun({
      name: 'flat.bedroom.skirting', zone: 'flatBedroom', points: bedroomPts, closed: true, roomSide: 'right',
      elevationY: 0.001, profile: 'ogee', height: 0.125, thickness: 0.018, material: trimMat,
      gaps: [
        { box: { minX: -0.78, maxX: -0.6, minZ: -3.4, maxZ: -1.78 }, cap: 'selfReturn' },
        { box: { minX: -1.85, maxX: -0.8, minZ: 0.96, maxZ: 1.1 }, cap: 'selfReturn' },
      ],
      cutawayWalls: [northCut, westCut], floor: 'level-0',
    }),
    createSkirtingRun({
      name: 'flat.bathroom.skirting', zone: 'flatBathroom', points: bathroomPts, closed: true, roomSide: 'right',
      elevationY: 0.001, profile: 'chamfered', height: 0.105, thickness: 0.016, material: trimMat,
      gaps: [
        { box: { minX: -4.24, maxX: -3.27, minZ: 1.1, maxZ: 2.25 }, cap: 'selfReturn' },
        { box: { minX: -2.34, maxX: -2.18, minZ: 1.35, maxZ: 2.3 }, cap: 'selfReturn' },
        { box: { minX: -4.08, maxX: -3.4, minZ: 3.3, maxZ: 3.5 }, cap: 'selfReturn' },
        { box: { minX: -3.02, maxX: -2.5, minZ: 3.3, maxZ: 3.5 }, cap: 'selfReturn' },
      ],
      cutawayWalls: [southCut, westCut], floor: 'level-0',
    })
  );

  ctx.ceilingMeshGroup.add(
    createCorniceRun({
      name: 'flat.living.cornice', zone: 'flatLivingKitchen', points: livingPts, closed: true, roomSide: 'right',
      ceilingY: WALL_H - 0.001, profile: 'georgian-cyma', height: 0.098, projection: 0.092, material: trimMat,
      cutawayWalls: [northCut, eastCut, southCut], floor: 'level-0',
    }),
    createCorniceRun({
      name: 'flat.hall.cornice', zone: 'flatHall', points: hallPts, closed: true, roomSide: 'right',
      ceilingY: WALL_H - 0.001, profile: 'cove', height: 0.085, projection: 0.08, material: trimMat,
      cutawayWalls: [southCut], floor: 'level-0',
    }),
    createCorniceRun({
      name: 'flat.bedroom.cornice', zone: 'flatBedroom', points: bedroomPts, closed: true, roomSide: 'right',
      ceilingY: WALL_H - 0.001, profile: 'georgian-cyma', height: 0.095, projection: 0.088, material: trimMat,
      gaps: [{ box: { minX: -0.78, maxX: -0.6, minZ: -3.4, maxZ: -1.78 }, cap: 'selfReturn' }],
      cutawayWalls: [northCut, westCut], floor: 'level-0',
    }),
    createCorniceRun({
      name: 'flat.bathroom.cornice', zone: 'flatBathroom', points: bathroomPts, closed: true, roomSide: 'right',
      ceilingY: WALL_H - 0.001, profile: 'cove', height: 0.082, projection: 0.076, material: trimMat,
      cutawayWalls: [southCut, westCut], floor: 'level-0',
    })
  );

  return {
    root, northCut, southCut, eastCut, westCut, schemes, trimMat, oakJoineryMat, brassMats, glassMat,
  };
}
