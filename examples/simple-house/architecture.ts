import * as THREE from 'three';
import type { CircuitId, CutawayWallDescriptor } from 'husjs';
import {
  applyMetricBoxUVs,
  createBrickMaterial,
  createRoomPaintScheme,
  createSharedSourceTextureVariant,
  createStoneMasonryMaterial,
  type RoomPaintScheme,
} from 'husjs/materials';
import {
  VITORIA_CHEQUER_REPEAT_M,
  createEngineeredOakFloorTextures,
  createFloorSlab,
  createGeorgianSashWindow,
  createHerringboneTerracottaQuarryTileTextures,
  createHippedRoof,
  createParisianManoirCabochonTextures,
  createSkirtingRun,
  createTumbledLimestoneFlagstoneTextures,
  createVitoriaRossoChequerboardTextures,
  createWallNetwork,
  prepGeo,
  registerHingedDoor,
  tagCollisionRole,
  tagCutaway,
} from 'husjs/objects';
import {
  buildChequerboardMarbleFloor,
  buildGeorgianCeilingCornice,
  buildGeorgianCeilingPanelMoulding,
  buildGeorgianCeilingRose,
  buildGeorgianFacadeDressings,
  buildGeorgianTuscanPorticoAndDoor,
  createHandmadeOliveMetroTileMaterial,
  createHeritageFloorFinishMaterial,
  createPaleOakHerringboneParquetMaterial,
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
import { HALL_ROSE_XZ, LANDING_ROSE_XZ, type SimpleHouseStair } from './staircase-and-hall.ts';

type Side = 'north' | 'south' | 'east' | 'west';
type FloorId = 'ground' | 'first';

/** Interior faces of the exterior shell. */
export const IN_X = HALF_W - EXT_WALL_T;
export const IN_Z = HALF_D - EXT_WALL_T;
/** Partition centrelines. */
export const HALL_PARTITION_X = 1.21;
/** Drawing-room chimney breast (built by the ground interiors alongside the fireplace). */
export const DRAWING_BREAST = { minX: -IN_X, maxX: -4.98, minZ: -0.95, maxZ: 0.95 } as const;
/** Roof springs slightly above the masonry head so the slates sail over the stone eaves cornice. */
export const ROOF_EAVES_Y = 5.81;

const GROUND_WALL_H = FFL_FIRST - FFL_GROUND;
const GROUND_PARTITION_H = GROUND_CEILING_SOFFIT_Y - FFL_GROUND - 0.002;
const FIRST_WALL_H = 2.57;
const FIRST_PARTITION_H = FIRST_CEILING_SOFFIT_Y - FFL_FIRST - 0.002;
const DRESSING_STANDOFF_M = 0.002;

export type SimpleHouseRoomSchemeKey =
  | 'houseHall'
  | 'houseDrawing'
  | 'houseKitchenDiner'
  | 'houseBootLobby'
  | 'houseCloakroom'
  | 'houseLanding'
  | 'housePrincipalBed'
  | 'housePrincipalDressing'
  | 'housePrincipalEnsuite'
  | 'houseBedroom2'
  | 'houseStudy'
  | 'houseBathroom';

export interface SimpleHouseShell {
  /** Whole-elevation cutaway descriptor for wall-hung fittings. */
  cut(side: Side, floor: FloorId): CutawayWallDescriptor;
  readonly plasterMat: THREE.Material;
  readonly trimMat: THREE.Material;
  readonly schemes: Readonly<Record<SimpleHouseRoomSchemeKey, RoomPaintScheme>>;
}

interface WindowSpec {
  readonly id: string;
  readonly label: string;
  readonly zone: string;
  readonly floor: FloorId;
  readonly side: Side;
  /** World X (north/south elevations) or world Z (east/west elevations) of the opening centre. */
  readonly at: number;
  readonly width: number;
  readonly height: number;
  readonly sillY: number;
  readonly topRows?: number;
  readonly frosted?: boolean;
}

const G = { width: 1.12, height: 1.82, sillY: 0.68, floor: 'ground' } as const;
const F = { width: 1.12, height: 1.54, sillY: 0.62, floor: 'first' } as const;

const WINDOWS: readonly WindowSpec[] = [
  { ...G, id: 'drawingSouth', label: 'Drawing Room Sash (Front)', zone: 'houseDrawing', side: 'south', at: -3.35 },
  { ...G, id: 'diningSouth', label: 'Dining Sash (Front)', zone: 'houseKitchenDiner', side: 'south', at: 3.35 },
  { ...G, id: 'drawingNorth', label: 'Drawing Room Sash (Garden)', zone: 'houseDrawing', side: 'north', at: -3.35 },
  { id: 'cloakroomNorth', label: 'Cloakroom Frosted Sash', zone: 'houseCloakroom', floor: 'ground', side: 'north', at: 0.66, width: 0.68, height: 1.15, sillY: 1.15, frosted: true },
  { id: 'kitchenSinkNorth', label: 'Kitchen Sink Sash', zone: 'houseKitchenDiner', floor: 'ground', side: 'north', at: 2.35, width: 1.18, height: 1.42, sillY: 1.02 },
  { ...G, id: 'diningEast', label: 'Dining Sash (East)', zone: 'houseKitchenDiner', side: 'east', at: 2.1 },
  { ...F, id: 'principalSouth', label: 'Principal Bedroom Sash', zone: 'housePrincipalBed', side: 'south', at: -3.35 },
  { ...F, id: 'landingSouth', label: 'Landing Sash', zone: 'houseLanding', side: 'south', at: 0 },
  { ...F, id: 'guestSouth', label: 'Guest Bedroom Sash (Front)', zone: 'houseBedroom2', side: 'south', at: 3.35 },
  { id: 'ensuiteNorth', label: 'Ensuite Frosted Sash', zone: 'housePrincipalEnsuite', floor: 'first', side: 'north', at: -1.72, width: 0.68, height: 0.94, sillY: 1.15, topRows: 1, frosted: true },
  { ...F, id: 'bathroomNorth', label: 'Family Bathroom Sash', zone: 'houseBathroom', side: 'north', at: 0.15, topRows: 1, frosted: true },
  { ...F, id: 'studyNorth', label: 'Study Sash', zone: 'houseStudy', side: 'north', at: 3.95 },
  { ...F, id: 'guestEast', label: 'Guest Bedroom Sash (East)', zone: 'houseBedroom2', side: 'east', at: 2.1 },
];

const FRENCH_DOOR = { x: 4.25, width: 1.48, height: 2.25 } as const;
const FRONT_DOOR = { width: 0.98, height: 2.205, archRiseM: 0.47 } as const;

interface DoorSpec {
  readonly id: string;
  readonly floor: FloorId;
  readonly wall: string;
  /** `'x'`: wall runs along Z at a fixed X; `'z'`: wall runs along X at a fixed Z. */
  readonly plane: 'x' | 'z';
  readonly at: readonly [number, number];
  readonly openAngle: number;
  readonly hinge: -1 | 1;
  readonly leaf?: boolean;
  readonly clearWidth?: number;
}

const DOOR_CLEAR_W = 0.86;
const DOOR_CLEAR_H = 2.07;

const DOORS: readonly DoorSpec[] = [
  // Ground floor
  { id: 'hallDrawing', floor: 'ground', wall: 'pW_south', plane: 'x', at: [-HALL_PARTITION_X, 0.9], openAngle: -1.45, hinge: -1 },
  { id: 'hallKitchen', floor: 'ground', wall: 'pE_south', plane: 'x', at: [HALL_PARTITION_X, 3.45], openAngle: 1.45, hinge: 1 },
  { id: 'hallBoot', floor: 'ground', wall: 'pZ', plane: 'z', at: [-0.6, -1.59], openAngle: 1.45, hinge: -1 },
  { id: 'bootWc', floor: 'ground', wall: 'pX', plane: 'x', at: [0, -2.35], openAngle: 1.45, hinge: 1 },
  // First floor
  { id: 'landingPrincipal', floor: 'first', wall: 'pW_south', plane: 'x', at: [-HALL_PARTITION_X, 1.3], openAngle: -1.45, hinge: -1 },
  { id: 'principalDressing', floor: 'first', wall: 'pN_west', plane: 'z', at: [-4.48, -1.71], openAngle: 0, hinge: 1, leaf: false, clearWidth: 0.88 },
  { id: 'dressingEnsuite', floor: 'first', wall: 'pDress', plane: 'x', at: [-3.53, -2.85], openAngle: 1.4, hinge: 1, clearWidth: 0.82 },
  { id: 'landingGuest', floor: 'first', wall: 'pE_south', plane: 'x', at: [HALL_PARTITION_X, 3.45], openAngle: 1.45, hinge: 1 },
  { id: 'landingStudy', floor: 'first', wall: 'pE_north', plane: 'x', at: [HALL_PARTITION_X, -0.88], openAngle: 1.38, hinge: 1 },
  { id: 'landingBathroom', floor: 'first', wall: 'pZ_bath', plane: 'z', at: [-0.55, -1.59], openAngle: 1.45, hinge: 1 },
  { id: 'airingCupboard', floor: 'first', wall: 'pZ_air', plane: 'z', at: [1.9, -1.59], openAngle: -1.4, hinge: -1, clearWidth: 0.72 },
];

/**
 * Partition centrelines per floor; segmented cleanly at room junctions so
 * `THREE.ShapeUtils.triangulateShape` never cuts diagonal triangles across doorways
 * and each room receives its own Farrow & Ball paint scheme on both faces.
 */
const PARTITIONS: Readonly<
  Record<FloorId, readonly { id: string; from: readonly [number, number]; to: readonly [number, number] }[]>
> = {
  ground: [
    { id: 'pW_south', from: [-HALL_PARTITION_X, IN_Z], to: [-HALL_PARTITION_X, -1.59] },
    { id: 'pW_north', from: [-HALL_PARTITION_X, -1.59], to: [-HALL_PARTITION_X, -IN_Z] },
    { id: 'pE_south', from: [HALL_PARTITION_X, IN_Z], to: [HALL_PARTITION_X, 0.28] },
    { id: 'pE_north', from: [HALL_PARTITION_X, 0.28], to: [HALL_PARTITION_X, -IN_Z] },
    { id: 'pZ', from: [-HALL_PARTITION_X, -1.59], to: [HALL_PARTITION_X, -1.59] },
    { id: 'pX', from: [0, -IN_Z], to: [0, -1.59] },
  ],
  first: [
    { id: 'pW_south', from: [-HALL_PARTITION_X, IN_Z], to: [-HALL_PARTITION_X, -1.71] },
    { id: 'pW_north', from: [-HALL_PARTITION_X, -1.71], to: [-HALL_PARTITION_X, -IN_Z] },
    { id: 'pN_west', from: [-IN_X, -1.71], to: [-3.53, -1.71] },
    { id: 'pN_east', from: [-3.53, -1.71], to: [-HALL_PARTITION_X, -1.71] },
    { id: 'pDress', from: [-3.53, -IN_Z], to: [-3.53, -1.71] },
    { id: 'pE_south', from: [HALL_PARTITION_X, IN_Z], to: [HALL_PARTITION_X, -0.16] },
    { id: 'pE_north', from: [HALL_PARTITION_X, -0.16], to: [HALL_PARTITION_X, -1.59] },
    { id: 'pZ_bath', from: [-HALL_PARTITION_X, -1.59], to: [HALL_PARTITION_X, -1.59] },
    { id: 'pZ_bath_east', from: [HALL_PARTITION_X, -1.59], to: [1.39, -1.59] },
    { id: 'pZ_air', from: [1.39, -1.59], to: [2.41, -1.59] },
    { id: 'pAirW', from: [1.39, -1.59], to: [1.39, -2.39] },
    { id: 'pAirS', from: [1.39, -2.39], to: [2.41, -2.39] },
    { id: 'pS', from: [2.41, -IN_Z], to: [2.41, -1.59] },
    { id: 'pG', from: [HALL_PARTITION_X, -0.16], to: [IN_X, -0.16] },
  ],
};

function wallOffset(side: Side, at: number): number {
  switch (side) {
    case 'south':
      return at + HALF_W;
    case 'north':
      return HALF_W - at;
    case 'east':
      return HALF_D - at;
    case 'west':
      return at + HALF_D;
  }
}

/** Places a `+Z`-projecting facade element on an elevation, `standoff` metres clear of the brick face. */
function placeOnFacade(
  obj: THREE.Object3D,
  side: Side,
  along: number,
  y: number,
  standoff = DRESSING_STANDOFF_M
): void {
  switch (side) {
    case 'south':
      obj.position.set(along, y, HALF_D + standoff);
      obj.rotation.y = 0;
      break;
    case 'north':
      obj.position.set(along, y, -HALF_D - standoff);
      obj.rotation.y = Math.PI;
      break;
    case 'east':
      obj.position.set(HALF_W + standoff, y, along);
      obj.rotation.y = Math.PI / 2;
      break;
    case 'west':
      obj.position.set(-HALF_W - standoff, y, along);
      obj.rotation.y = -Math.PI / 2;
      break;
  }
}

function box(
  parent: THREE.Object3D,
  name: string,
  size: readonly [number, number, number],
  center: readonly [number, number, number],
  mat: THREE.Material,
  metricTileM?: number
): THREE.Mesh {
  const rawGeo = new THREE.BoxGeometry(size[0], size[1], size[2]);
  if (metricTileM !== undefined) {
    applyMetricBoxUVs(rawGeo, { tileW: metricTileM, tileH: metricTileM });
  }
  const mesh = new THREE.Mesh(prepGeo(rawGeo), mat);
  mesh.name = name;
  mesh.position.set(center[0], center[1], center[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function doorOffset(spec: DoorSpec): number {
  const wall = PARTITIONS[spec.floor].find((p) => p.id === spec.wall)!;
  return Math.hypot(spec.at[0] - wall.from[0], spec.at[1] - wall.from[1]);
}

function partitionOpenings(floor: FloorId, wallId: string) {
  return DOORS.filter((d) => d.floor === floor && d.wall === wallId).map((d) => ({
    id: d.id,
    centerOffset: doorOffset(d),
    width: d.clearWidth ?? DOOR_CLEAR_W,
    sillY: 0,
    height: DOOR_CLEAR_H,
  }));
}

function windowOpenings(floor: FloorId, side: Side) {
  return WINDOWS.filter((w) => w.floor === floor && w.side === side).map((w) => ({
    id: w.id,
    centerOffset: wallOffset(side, w.at),
    width: w.width,
    sillY: w.sillY,
    height: w.height,
  }));
}

/**
 * Painted six-panel door in a lining + architrave frame.
 */
function addInteriorDoor(
  ctx: SceneBuilderContext,
  parent: THREE.Object3D,
  spec: DoorSpec,
  floorY: number,
  trimMat: THREE.Material,
  panelMat: THREE.Material,
  brassMat: THREE.Material,
  thresholdMat: THREE.Material | null
): void {
  const clearW = spec.clearWidth ?? DOOR_CLEAR_W;
  const half = clearW * 0.5;
  const root = new THREE.Group();
  root.name = `simpleHouse.door.${spec.id}`;
  root.position.set(spec.at[0], floorY, spec.at[1]);
  root.rotation.y = spec.plane === 'x' ? Math.PI / 2 : 0;
  parent.add(root);

  const jambW = 0.072;
  const jambInner = half - 0.022;
  const frameD = INT_WALL_T + 0.036;
  for (const s of [-1, 1] as const) {
    box(
      root,
      `${root.name}.jamb_${s < 0 ? 'a' : 'b'}`,
      [jambW, 2.099, frameD],
      [s * (jambInner + jambW * 0.5), 1.0505, 0],
      trimMat
    );
  }
  box(root, `${root.name}.head`, [(jambInner + jambW) * 2 + 0.008, 0.08, frameD + 0.004], [0, 2.085, 0], trimMat);

  if (thresholdMat) {
    const sill = box(root, `${root.name}.threshold`, [clearW - 0.002, 0.02, 0.122], [0, -0.0108, 0], thresholdMat, 1.0);
    sill.castShadow = false;
    tagCollisionRole(sill, 'solidPlane');
  }

  if (spec.leaf === false) return;

  const leafW = jambInner * 2 - 0.006;
  const leafH = 2.03;
  const leaf = new THREE.Group();
  leaf.name = `${root.name}.leaf`;
  box(leaf, `${leaf.name}.slab`, [leafW, leafH, 0.04], [0, 0.008 + leafH * 0.5, 0], trimMat);
  const colX = leafW * 0.235;
  const panelW = leafW * 0.33;
  const rows: readonly (readonly [number, number])[] = [
    [0.47, 0.52],
    [1.13, 0.62],
    [1.74, 0.36],
  ];
  rows.forEach(([cy, h], r) => {
    for (const s of [-1, 1] as const) {
      box(leaf, `${leaf.name}.panel_${r}_${s < 0 ? 'a' : 'b'}`, [panelW, h, 0.046], [s * colX, cy, 0], panelMat);
    }
  });
  for (const s of [-1, 1] as const) {
    const knob = new THREE.Mesh(prepGeo(new THREE.SphereGeometry(0.026, 14, 10)), brassMat);
    knob.name = `${leaf.name}.knob_${s < 0 ? 'a' : 'b'}`;
    knob.position.set(-spec.hinge * (leafW * 0.5 - 0.07), 1.0, s * 0.05);
    leaf.add(knob);
  }
  root.add(leaf);
  registerHingedDoor(ctx, {
    parent: root,
    door: leaf,
    hingeOffset: [spec.hinge * leafW * 0.5, 0, 0],
    axis: 'y',
    openAngle: spec.openAngle,
  });
}

/** Glazed Georgian French doors onto the rear terrace (two outward-opening leaves in a painted frame). */
function addFrenchDoors(
  ctx: SceneBuilderContext,
  parent: THREE.Object3D,
  cutaway: CutawayWallDescriptor,
  trimMat: THREE.Material,
  glassMat: THREE.Material,
  brassMat: THREE.Material,
  stoneMat: THREE.Material
): void {
  const half = FRENCH_DOOR.width * 0.5;
  const root = new THREE.Group();
  root.name = 'simpleHouse.frenchDoors';
  root.position.set(FRENCH_DOOR.x, FFL_GROUND, -HALF_D + 0.045);
  parent.add(root);

  for (const s of [-1, 1] as const) {
    box(root, `${root.name}.jamb_${s < 0 ? 'w' : 'e'}`, [0.06, 2.199, 0.1], [s * (half - 0.02), 1.1005, 0], trimMat);
  }
  box(root, `${root.name}.head`, [FRENCH_DOOR.width + 0.028, 0.07, 0.104], [0, 2.225, 0], trimMat);
  const sill = box(
    root,
    `${root.name}.stoneThreshold`,
    [FRENCH_DOOR.width - 0.004, 0.05, 0.341],
    [0, -0.0258, 0.0655],
    stoneMat,
    1.0
  );
  tagCollisionRole(sill, 'solidPlane');

  const leafW = half - 0.052;
  const leafH = 2.17;
  const y0 = 0.012;
  for (const s of [-1, 1] as const) {
    const tag = s < 0 ? 'west' : 'east';
    const leaf = new THREE.Group();
    leaf.name = `${root.name}.${tag}Leaf`;
    const cx = s * (0.001 + leafW * 0.5);
    const stile = 0.07;
    box(leaf, `${leaf.name}.stileOuter`, [stile, leafH, 0.045], [cx + s * (leafW - stile) * 0.5, y0 + leafH * 0.5, 0], trimMat);
    box(leaf, `${leaf.name}.stileMeeting`, [stile, leafH, 0.045], [cx - s * (leafW - stile) * 0.5, y0 + leafH * 0.5, 0], trimMat);
    const railW = leafW - stile * 2;
    box(leaf, `${leaf.name}.railTop`, [railW, 0.07, 0.043], [cx, y0 + leafH - 0.035, 0], trimMat);
    box(leaf, `${leaf.name}.railBottom`, [railW, 0.2, 0.043], [cx, y0 + 0.1, 0], trimMat);
    const glassH = leafH - 0.27;
    const glassY = y0 + 0.2 + glassH * 0.5;
    const glass = box(leaf, `${leaf.name}.glass`, [railW + 0.01, glassH + 0.01, 0.006], [cx, glassY, 0], glassMat);
    glass.castShadow = false;
    glass.userData.isExteriorGlazedPortal = true;
    box(leaf, `${leaf.name}.barVertical`, [0.02, glassH, 0.034], [cx, glassY, 0], trimMat);
    for (let i = 1; i <= 3; i++) {
      box(leaf, `${leaf.name}.barHorizontal_${i}`, [railW, 0.02, 0.03], [cx, y0 + 0.2 + (glassH * i) / 4, 0], trimMat);
    }
    const knob = new THREE.Mesh(prepGeo(new THREE.SphereGeometry(0.024, 14, 10)), brassMat);
    knob.name = `${leaf.name}.knob`;
    knob.position.set(s * 0.036, 1.02, 0.04);
    leaf.add(knob);
    root.add(leaf);
    tagCutaway(leaf, cutaway);
    registerHingedDoor(ctx, {
      parent: root,
      door: leaf,
      hingeOffset: [s * (0.001 + leafW), 0, 0],
      axis: 'y',
      openAngle: -s * 1.35,
    });
  }
  tagCutaway(root, cutaway);
}

/**
 * Builds a metric-UV-scaled PBR floor material from a cached procedural map bundle
 * using `createSharedSourceTextureVariant` so shared cached textures are never mutated.
 */
function buildMetricScaledFloorMaterial(
  name: string,
  maps: {
    readonly map?: THREE.Texture;
    readonly colorMap?: THREE.Texture;
    readonly normalMap?: THREE.Texture;
    readonly roughnessMap?: THREE.Texture;
    readonly bumpMap?: THREE.Texture;
  },
  repeatPerMeter: readonly [number, number],
  roughness = 0.62,
  normalScale = 0.45
): THREE.MeshStandardMaterial {
  const baseColor = maps.map ?? maps.colorMap!;
  const map = createSharedSourceTextureVariant(baseColor, {
    repeat: repeatPerMeter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
  });
  const normalMap = maps.normalMap
    ? createSharedSourceTextureVariant(maps.normalMap, {
        repeat: repeatPerMeter,
        wrapS: THREE.RepeatWrapping,
        wrapT: THREE.RepeatWrapping,
      })
    : undefined;
  const roughnessMap = maps.roughnessMap
    ? createSharedSourceTextureVariant(maps.roughnessMap, {
        repeat: repeatPerMeter,
        wrapS: THREE.RepeatWrapping,
        wrapT: THREE.RepeatWrapping,
      })
    : undefined;
  const bumpMap =
    !normalMap && maps.bumpMap
      ? createSharedSourceTextureVariant(maps.bumpMap, {
          repeat: repeatPerMeter,
          wrapS: THREE.RepeatWrapping,
          wrapT: THREE.RepeatWrapping,
        })
      : undefined;
  return new THREE.MeshStandardMaterial({
    name,
    color: 0xffffff,
    map,
    ...(normalMap
      ? { normalMap, normalScale: new THREE.Vector2(normalScale, normalScale) }
      : {}),
    ...(roughnessMap ? { roughnessMap } : {}),
    ...(bumpMap ? { bumpMap, bumpScale: 0.012 } : {}),
    roughness,
    metalness: 0.0,
  });
}

/**
 * Bespoke 1024x1024 procedural PBR English Honey-Oak Wide-Plank & Chevron/Herringbone Parquet
 * material for the Drawing Room (warm golden-brown aged English oak planks with plank-to-plank
 * tonal variation, cathedral grain & medullary rays, micro-bevelled dark joints, waxed satin sheen).
 */
let cachedDrawingHoneyOakParquetMat: THREE.MeshStandardMaterial | null = null;
function createDrawingHoneyOakParquetMaterial(): THREE.MeshStandardMaterial {
  if (cachedDrawingHoneyOakParquetMat) return cachedDrawingHoneyOakParquetMat;

  const N = 1024;
  const albedo = new Uint8Array(N * N * 4);
  const heightF = new Float32Array(N * N);
  const roughByte = new Uint8Array(N * N * 4);

  const hash2 = (ix: number, iy: number, seed: number): number => {
    const h = Math.sin(ix * 127.1 + iy * 311.7 + seed * 74.7) * 43758.5453;
    return h - Math.floor(h);
  };
  const valueNoisePeriodic = (u: number, v: number, pU: number, pV: number, seed: number): number => {
    const x = u * pU;
    const y = v * pV;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const x0 = ((ix % pU) + pU) % pU;
    const x1 = (x0 + 1) % pU;
    const y0 = ((iy % pV) + pV) % pV;
    const y1 = (y0 + 1) % pV;
    const c00 = hash2(x0, y0, seed);
    const c10 = hash2(x1, y0, seed);
    const c01 = hash2(x0, y1, seed);
    const c11 = hash2(x1, y1, seed);
    const a = c00 + (c10 - c00) * sx;
    const b = c01 + (c11 - c01) * sx;
    return a + (b - a) * sy;
  };

  // Classic Georgian English honey-oak herringbone parquet (K = 3 periods per 1.65 m tile, 4:1 stave ratio)
  const K = 3;
  const RATIO = 4;
  const GRID = K * RATIO; // 12

  for (let py = 0; py < N; py++) {
    const v = py / N;
    for (let px = 0; px < N; px++) {
      const u = px / N;
      const a = (u + v) * GRID;
      const b = (u - v + 1.0) * GRID;
      const ia = Math.floor(a);
      const ib = Math.floor(b);
      const fa = a - ia;
      const fb = b - ib;

      const diag = (((ia - ib) % (2 * RATIO)) + 2 * RATIO) % (2 * RATIO);
      const horizontal = diag < RATIO;

      let blockI: number;
      let blockJ: number;
      let along: number;
      let across: number;
      if (horizontal) {
        blockI = ia - diag;
        blockJ = ib;
        along = (diag + fa) / RATIO;
        across = fb;
      } else {
        const d2 = diag - RATIO;
        blockI = ia;
        blockJ = (ib + d2 - (RATIO - 1)) * 3 + 1;
        along = (RATIO - 1 - d2 + fb) / RATIO;
        across = fa;
      }

      const pI = ((blockI % 12) + 12) % 12;
      const pJ = ((blockJ % 36) + 36) % 36;
      const seedA = hash2(pI, pJ, 17);
      const seedB = hash2(pI, pJ, 53);
      const seedC = hash2(pI, pJ, 97);

      const bevelAlong = Math.min(along, 1 - along) * RATIO;
      const bevelAcross = Math.min(across, 1 - across);
      const edge = Math.min(bevelAlong, bevelAcross);
      const isGroove = edge < 0.028;

      const gU = ((along + seedA) % 1 + 1) % 1;
      const gV = ((across + seedB) % 1 + 1) % 1;
      const fine = valueNoisePeriodic(gU, gV, 8, 48, 311);
      const micro = valueNoisePeriodic(gU, gV, 24, 96, 619);
      const ray = valueNoisePeriodic(gU, gV, 32, 10, 887);
      const ringArg = (gV - 0.5) * (2.6 + seedC * 1.4) + (fine - 0.5) * 0.55 + Math.sin(gU * Math.PI * 2) * 0.18;
      const cathedral = 0.5 + 0.5 * Math.sin(ringArg * Math.PI * 4.0);
      const medullary = ray > 0.76 ? (ray - 0.76) * 4.1 : 0;

      const idx = py * N + px;
      const o = idx * 4;

      if (isGroove) {
        // Crisp dark wax-filled micro-bevel joint (#4B311C)
        albedo[o] = 75;
        albedo[o + 1] = 49;
        albedo[o + 2] = 28;
        albedo[o + 3] = 255;
        heightF[idx] = 0.12;
        const rb = Math.round(0.76 * 255);
        roughByte[o] = rb;
        roughByte[o + 1] = rb;
        roughByte[o + 2] = rb;
        roughByte[o + 3] = 255;
      } else {
        const plankTone = (seedA - 0.5) * 28;
        const grainDelta = (cathedral - 0.5) * 18 + (fine - 0.5) * 11 + (micro - 0.5) * 7 + medullary * 14;
        const poreDip = micro > 0.8 ? -9 : 0;
        const d = plankTone + grainDelta + poreDip;
        // Rich warm golden-brown English honey oak (#B9854C .. #CE9B60)
        albedo[o] = Math.max(0, Math.min(255, Math.round(188 + d)));
        albedo[o + 1] = Math.max(0, Math.min(255, Math.round(138 + d * 0.84)));
        albedo[o + 2] = Math.max(0, Math.min(255, Math.round(84 + d * 0.66)));
        albedo[o + 3] = 255;

        const chamfer = Math.min(1, edge / 0.085);
        heightF[idx] = 0.5 + 0.34 * chamfer + 0.09 * cathedral + 0.06 * fine + (micro > 0.8 ? -0.05 : 0);
        const rVal = Math.max(0.24, Math.min(0.54, 0.38 + (seedB - 0.5) * 0.07 + (0.5 - cathedral) * 0.05 - medullary * 0.05));
        const rb = Math.round(rVal * 255);
        roughByte[o] = rb;
        roughByte[o + 1] = rb;
        roughByte[o + 2] = rb;
        roughByte[o + 3] = 255;
      }
    }
  }

  const normalBytes = new Uint8Array(N * N * 4);
  const strength = 2.4;
  for (let y = 0; y < N; y++) {
    const ym = (y - 1 + N) % N;
    const yp = (y + 1) % N;
    for (let x = 0; x < N; x++) {
      const xm = (x - 1 + N) % N;
      const xp = (x + 1) % N;
      const dx = (heightF[y * N + xp]! - heightF[y * N + xm]!) * strength;
      const dy = (heightF[yp * N + x]! - heightF[ym * N + x]!) * strength;
      const nx = -dx;
      const ny = -dy;
      const nz = 1.0;
      const invLen = 1 / Math.hypot(nx, ny, nz);
      const o = (y * N + x) * 4;
      normalBytes[o] = Math.round((nx * invLen * 0.5 + 0.5) * 255);
      normalBytes[o + 1] = Math.round((ny * invLen * 0.5 + 0.5) * 255);
      normalBytes[o + 2] = Math.round((nz * invLen * 0.5 + 0.5) * 255);
      normalBytes[o + 3] = 255;
    }
  }

  const repeatScale = 1 / 1.65;
  const configTex = (tex: THREE.DataTexture, name: string, srgb: boolean): THREE.DataTexture => {
    tex.name = name;
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatScale, repeatScale);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    return tex;
  };

  const map = configTex(new THREE.DataTexture(albedo, N, N, THREE.RGBAFormat), 'simpleHouse.drawingHoneyOakParquet.albedo', true);
  const normalMap = configTex(new THREE.DataTexture(normalBytes, N, N, THREE.RGBAFormat), 'simpleHouse.drawingHoneyOakParquet.normal', false);
  const roughnessMap = configTex(new THREE.DataTexture(roughByte, N, N, THREE.RGBAFormat), 'simpleHouse.drawingHoneyOakParquet.roughness', false);

  cachedDrawingHoneyOakParquetMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.floorMat.drawingHoneyOak',
    color: 0xffffff,
    map,
    normalMap,
    normalScale: new THREE.Vector2(0.42, 0.42),
    roughnessMap,
    roughness: 0.38,
    metalness: 0.0,
  });
  return cachedDrawingHoneyOakParquetMat;
}

/**
 * Builds a storey-scoped cast-iron rainwater downpipe segment so ground-floor cutaway
 * never leaves a full-height 5.4 m pipe + upper hopper floating above Y = 2.85 m.
 */
function buildSplitRainwaterDownpipeSegment(
  name: string,
  segment: 'ground' | 'first',
  castIronMat: THREE.Material
): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  const pipeR = 0.0375;
  const pipeZ = 0.062;

  const addCyl = (
    partName: string,
    rTop: number,
    rBot: number,
    h: number,
    cy: number,
    cz: number
  ): THREE.Mesh => {
    const m = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(rTop, rBot, h, 16)), castIronMat);
    m.name = partName;
    m.position.set(0, cy, cz);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };

  if (segment === 'ground') {
    // Placed at Y = 0.02 -> spans Y = 0.02..2.848 m (2 mm clear below Y = 2.85 m first-floor split)
    const shoeH = 0.14;
    const shoe = addCyl(`${name}.bottomDischargeShoe`, pipeR + 0.003, pipeR + 0.005, shoeH, 0.04 + shoeH * 0.5, pipeZ + 0.025);
    shoe.rotation.x = 0.36;
    const shaftLen = 2.648;
    addCyl(`${name}.castIronPipeShaft`, pipeR, pipeR, shaftLen, 0.18 + shaftLen * 0.5, pipeZ);
    [0.32, 1.48, 2.64].forEach((cy, idx) => {
      addCyl(`${name}.pipeSocketCollar_${idx + 1}`, pipeR + 0.008, pipeR + 0.008, 0.048, cy, pipeZ);
      box(group, `${name}.pipeEarBracket_${idx + 1}`, [0.165, 0.036, 0.016], [0, cy, 0.01], castIronMat);
    });
  } else {
    // Placed at Y = 2.85 -> spans Y = 2.85..5.36 m with Georgian moulded hopper head under eaves
    const shaftLen = 2.3;
    addCyl(`${name}.castIronPipeShaft`, pipeR, pipeR, shaftLen, shaftLen * 0.5, pipeZ);
    [0.05, 1.12, 2.18].forEach((cy, idx) => {
      addCyl(`${name}.pipeSocketCollar_${idx + 1}`, pipeR + 0.008, pipeR + 0.008, 0.048, cy, pipeZ);
      box(group, `${name}.pipeEarBracket_${idx + 1}`, [0.165, 0.036, 0.016], [0, cy, 0.01], castIronMat);
    });
    const hopperH = 0.21;
    const hopperTopY = shaftLen + hopperH;
    box(group, `${name}.hopperLowerBowl`, [0.19, hopperH * 0.55, 0.14], [0, hopperTopY - hopperH * 0.725, 0.07], castIronMat);
    box(group, `${name}.hopperMouldedRim`, [0.25, hopperH * 0.45, 0.175], [0, hopperTopY - hopperH * 0.225, 0.0875], castIronMat);
  }
  return group;
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

  // =========================================================================
  // 10-Room Farrow & Ball Architectural Paint Consultation (`createRoomPaintScheme`)
  // =========================================================================
  const schemes: Readonly<Record<SimpleHouseRoomSchemeKey, RoomPaintScheme>> = {
    houseHall: createRoomPaintScheme({
      wallColor: 'slipper-satin',
      trimColor: 'wimborne-white',
      roomKind: 'hallway',
    }),
    houseDrawing: createRoomPaintScheme({
      wallColor: 'cromarty',
      trimColor: 'school-house-white',
      roomKind: 'drawing-room',
    }),
    houseKitchenDiner: createRoomPaintScheme({
      wallColor: 'joas-white',
      trimColor: 'pointing',
      ceilingColor: 'pointing',
      wallSheen: 'estate-emulsion',
      roomKind: 'kitchen',
    }),
    houseBootLobby: createRoomPaintScheme({
      wallColor: 'shaded-white',
      trimColor: 'green-smoke',
      roomKind: 'boot-room',
    }),
    houseCloakroom: createRoomPaintScheme({
      wallColor: 'hague-blue',
      trimColor: 'wimborne-white',
      roomKind: 'wc',
    }),
    houseLanding: createRoomPaintScheme({
      wallColor: 'slipper-satin',
      trimColor: 'wimborne-white',
      roomKind: 'landing',
    }),
    housePrincipalBed: createRoomPaintScheme({
      wallColor: 'skimming-stone',
      trimColor: 'wimborne-white',
      roomKind: 'bedroom',
    }),
    housePrincipalDressing: createRoomPaintScheme({
      wallColor: 'skimming-stone',
      trimColor: 'pointing',
      roomKind: 'dressing-room',
    }),
    housePrincipalEnsuite: createRoomPaintScheme({
      wallColor: 'wevet',
      trimColor: 'all-white',
      roomKind: 'ensuite',
    }),
    houseBedroom2: createRoomPaintScheme({
      wallColor: 'setting-plaster',
      trimColor: 'school-house-white',
      roomKind: 'bedroom',
    }),
    houseStudy: createRoomPaintScheme({
      wallColor: 'drop-cloth',
      trimColor: 'shaded-white',
      roomKind: 'study',
    }),
    houseBathroom: createRoomPaintScheme({
      wallColor: 'pointing',
      trimColor: 'mizzle',
      roomKind: 'bathroom',
    }),
  };

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

  // =========================================================================
  // 10 Distinct PBR Floorings across all 10 Rooms (1 UV = 1.0 m on slabs)
  // =========================================================================
  // 1. Hall: Honed Carrara & Nero Marquina chequerboard marble (`buildChequerboardMarbleFloor`)
  // 2. Drawing Room: Bespoke 1024x1024 Georgian English Honey-Oak Herringbone Parquet
  const drawingHoneyOakFloorMat = createDrawingHoneyOakParquetMaterial();
  // 3. Kitchen & Dining: Blonde/Pale European Oak 45° Herringbone Parquet
  const kitchenHerringboneOakMat = createPaleOakHerringboneParquetMaterial();
  // 4a. Boot Lobby: Herringbone Terracotta Quarry Tiles (`124 mm` blocks)
  const bootTerracottaQuarryMat = buildMetricScaledFloorMaterial(
    'simpleHouse.floorMat.bootTerracottaQuarry',
    createHerringboneTerracottaQuarryTileTextures(),
    [1 / 1.05, 1 / 1.05],
    0.72,
    0.5
  );
  // 4b. Cloakroom WC: Vitoria Rosso Diagonal Chequerboard Encaustic Tiles (`300 x 300 mm`)
  const wcVitoriaChequerMat = buildMetricScaledFloorMaterial(
    'simpleHouse.floorMat.wcVitoriaChequer',
    createVitoriaRossoChequerboardTextures(),
    [1 / VITORIA_CHEQUER_REPEAT_M, 1 / VITORIA_CHEQUER_REPEAT_M],
    0.46,
    0.42
  );
  // 5. Galleried Landing: Pale Smoked Oak Boards (+ Roger Oates herringbone wool runner)
  const landingSmokedOakMat = buildMetricScaledFloorMaterial(
    'simpleHouse.floorMat.landingSmokedOak',
    createEngineeredOakFloorTextures(),
    [1 / 3.8, 1 / 1.52],
    0.58,
    0.42
  );
  landingSmokedOakMat.color.setHex(0xdfd3c3);
  // 6. Principal Bedroom & Walk-In Dressing: Plush Oatmeal Loop-Pile Wool Broadloom Carpet
  const principalOatmealCarpetMat = createHeritageFloorFinishMaterial('oatmealLoopWoolCarpet');
  // 7. Principal Ensuite: Parisian Manoir Octagon-and-Cabochon Tumbled Marble (`406 mm` octagons)
  const ensuiteParisianManoirMat = buildMetricScaledFloorMaterial(
    'simpleHouse.floorMat.ensuiteParisianManoir',
    createParisianManoirCabochonTextures(),
    [1 / 1.218, 1 / 1.218],
    0.42,
    0.45
  );
  // 8. Guest Bedroom 2: Natural Honey Sisal Bouclé Woven Carpet
  const guestHoneySisalMat = createHeritageFloorFinishMaterial('honeySisalBoucle');
  // 9. Study / Bedroom 3: Warm Honey-Smoked Engineered Oak Wide-Board Floor
  const studyFumedWalnutOakMat = buildMetricScaledFloorMaterial(
    'simpleHouse.floorMat.studyHoneySmokedOak',
    createEngineeredOakFloorTextures(),
    [1 / 4.0, 1 / 1.6],
    0.48,
    0.44
  );
  studyFumedWalnutOakMat.color.setHex(0xd8c3a8);
  // 10. Family Bathroom: Tumbled Cotswold Limestone Flagstones (`400 x 560 mm`)
  const bathroomCotswoldLimestoneMat = buildMetricScaledFloorMaterial(
    'simpleHouse.floorMat.bathroomCotswoldLimestone',
    createTumbledLimestoneFlagstoneTextures(),
    [1 / 1.6, 1 / 1.6],
    0.64,
    0.52
  );

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

  // --- Masonry shell + Farrow & Ball room-paired partitions ---------------------------------
  // Note: for partition walls `from -> to`, `exteriorMaterial` is on `nRight = (-tz, tx)` and
  // `interiorMaterial` is on `-nRight = (tz, -tx)`:
  // - South -> North (`tz = -1`): `exteriorMaterial` = +X (East), `interiorMaterial` = -X (West)
  // - North -> South (`tz = +1`): `exteriorMaterial` = -X (West), `interiorMaterial` = +X (East)
  // - West  -> East  (`tx = +1`): `exteriorMaterial` = +Z (South), `interiorMaterial` = -Z (North)
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
      // pX runs North -> South (-4.22 -> -1.59): exterior = West (Boot Lobby), interior = East (Cloakroom WC)
      pX: { exteriorMaterial: schemes.houseBootLobby.walls, interiorMaterial: schemes.houseCloakroom.walls },
    },
    first: {
      pW_south: { exteriorMaterial: schemes.houseLanding.walls, interiorMaterial: schemes.housePrincipalBed.walls },
      pW_north: { exteriorMaterial: schemes.houseBathroom.walls, interiorMaterial: schemes.housePrincipalEnsuite.walls },
      pN_west: { exteriorMaterial: schemes.housePrincipalBed.walls, interiorMaterial: schemes.housePrincipalDressing.walls },
      pN_east: { exteriorMaterial: schemes.housePrincipalBed.walls, interiorMaterial: schemes.housePrincipalEnsuite.walls },
      // pDress runs North -> South (-4.22 -> -1.71): exterior = West (Dressing), interior = East (Ensuite)
      pDress: { exteriorMaterial: schemes.housePrincipalDressing.walls, interiorMaterial: schemes.housePrincipalEnsuite.walls },
      pE_south: { exteriorMaterial: schemes.houseBedroom2.walls, interiorMaterial: schemes.houseLanding.walls },
      pE_north: { exteriorMaterial: schemes.houseStudy.walls, interiorMaterial: schemes.houseLanding.walls },
      pZ_bath: { exteriorMaterial: schemes.houseLanding.walls, interiorMaterial: schemes.houseBathroom.walls },
      pZ_bath_east: { exteriorMaterial: schemes.houseStudy.walls, interiorMaterial: schemes.houseBathroom.walls },
      pZ_air: { exteriorMaterial: schemes.houseStudy.walls, interiorMaterial: schemes.houseBathroom.walls },
      // pAirW runs South -> North (-1.59 -> -2.39): exterior = East (Airing), interior = West (Bathroom)
      pAirW: { exteriorMaterial: schemes.houseBathroom.walls, interiorMaterial: schemes.houseBathroom.walls },
      // pAirS runs West -> East (1.39 -> 2.41): exterior = South (Airing), interior = North (Bathroom wet zone)
      pAirS: { exteriorMaterial: schemes.houseBathroom.walls, interiorMaterial: schemes.houseBathroom.walls },
      // pS runs North -> South (-4.22 -> -0.16): exterior = West (Bathroom/Airing/Lobby), interior = East (Study)
      pS: { exteriorMaterial: schemes.houseBathroom.walls, interiorMaterial: schemes.houseStudy.walls },
      // pG runs West -> East (1.21 -> 5.42): exterior = South (Guest Bed), interior = North (Lobby/Study)
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
          thickness: INT_WALL_T,
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

  // Opening-free interior wall linings in rooms whose exterior shell shares multiple rooms:
  // - Drawing Room West wall alcoves & Kitchen Joa's White / Study Card Room Green / Guest Setting Plaster
  const drawLiningN = box(
    groundGroup,
    'simpleHouse.drawing.cromartyLiningNorthAlcove',
    [0.004, 2.675, 3.23],
    [-IN_X + 0.002, 0.145 + 2.675 * 0.5, -2.585],
    schemes.houseDrawing.walls
  );
  drawLiningN.castShadow = false;
  tagCutaway(drawLiningN, cut('west', 'ground'));

  const drawLiningS = box(
    groundGroup,
    'simpleHouse.drawing.cromartyLiningSouthAlcove',
    [0.004, 2.675, 3.23],
    [-IN_X + 0.002, 0.145 + 2.675 * 0.5, 2.585],
    schemes.houseDrawing.walls
  );
  drawLiningS.castShadow = false;
  tagCutaway(drawLiningS, cut('west', 'ground'));

  const kitLiningE = box(
    groundGroup,
    'simpleHouse.kitchen.joasWhiteLiningEast',
    [0.004, 2.675, 5.08],
    [IN_X - 0.002, 0.145 + 2.675 * 0.5, -1.65],
    schemes.houseKitchenDiner.walls
  );
  kitLiningE.castShadow = false;
  tagCutaway(kitLiningE, cut('east', 'ground'));

  const prinLiningW = box(
    firstGroup,
    'simpleHouse.principal.skimmingStoneLiningWest',
    [0.004, 2.395, 5.82],
    [-IN_X + 0.002, FFL_FIRST + 0.145 + 2.395 * 0.5, 1.29],
    schemes.housePrincipalBed.walls
  );
  prinLiningW.castShadow = false;
  tagCutaway(prinLiningW, cut('west', 'first'));

  const studyLiningE = box(
    firstGroup,
    'simpleHouse.study.cardRoomGreenLiningEast',
    [0.004, 2.395, 3.94],
    [IN_X - 0.002, FFL_FIRST + 0.145 + 2.395 * 0.5, -2.21],
    schemes.houseStudy.walls
  );
  studyLiningE.castShadow = false;
  tagCutaway(studyLiningE, cut('east', 'first'));

  // Family Bathroom Wet-Zone Handmade Olive Metro Tile Alcove (`X in [1.45, 2.35], Z in [-4.22, -2.45]`)
  const oliveMetroMat = createHandmadeOliveMetroTileMaterial();
  const wetAlcoveH = 2.18;
  const wetAlcoveCy = FFL_FIRST + wetAlcoveH * 0.5 + 0.002;
  const northWetTile = box(
    firstGroup,
    'simpleHouse.bathroom.wetZoneOliveMetroNorth',
    [0.892, wetAlcoveH, 0.01],
    [1.9, wetAlcoveCy, -IN_Z + 0.006],
    oliveMetroMat,
    1.0
  );
  northWetTile.castShadow = false;
  tagCutaway(northWetTile, cut('north', 'first'));
  box(
    firstGroup,
    'simpleHouse.bathroom.wetZoneOliveMetroEast',
    [0.01, wetAlcoveH, 1.756],
    [2.344, wetAlcoveCy, -3.332],
    oliveMetroMat,
    1.0
  ).castShadow = false;
  box(
    firstGroup,
    'simpleHouse.bathroom.wetZoneOliveMetroSouth',
    [0.892, wetAlcoveH, 0.01],
    [1.9, wetAlcoveCy, -2.456],
    oliveMetroMat,
    1.0
  ).castShadow = false;

  // --- Floors & ceilings (10 distinct PBR floorings, zero overlap!) --------------------------
  const wingX0 = HALL_PARTITION_X + INT_WALL_T * 0.5 + 0.002; // 1.272
  const inX = IN_X - 0.002; // 5.418
  const inZ = IN_Z - 0.002; // 4.218
  const rect = (x0: number, x1: number, z0: number, z1: number): [number, number][] => [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ];
  const groundSlab = (
    name: string,
    zone: string,
    polygon: [number, number][],
    floorMaterial: THREE.Material
  ) =>
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

  // Ground floor slabs (5 distinct finishes: Hall marble, Drawing honey oak, Kitchen pale herringbone oak, Boot terracotta quarry, WC Vitoria Rosso)
  groundSlab('simpleHouse.floor.drawingOak', 'houseDrawing', rect(-inX, -wingX0, -inZ, inZ), drawingHoneyOakFloorMat);
  groundSlab('simpleHouse.floor.kitchenHerringbone', 'houseKitchenDiner', rect(wingX0, inX, -inZ, inZ), kitchenHerringboneOakMat);
  groundSlab('simpleHouse.floor.bootTerracotta', 'houseCloakroom', rect(-1.148, -0.062, -inZ, -1.652), bootTerracottaQuarryMat);
  groundSlab('simpleHouse.floor.wcVitoriaChequer', 'houseCloakroom', rect(0.062, 1.148, -inZ, -1.652), wcVitoriaChequerMat);

  const hallFloor = buildChequerboardMarbleFloor({
    name: 'simpleHouse.floor.hallChequer',
    position: [0, FFL_GROUND - 0.02, 1.345],
    widthM: 2.29,
    depthM: 5.74,
    thicknessM: 0.02,
  });
  tagCollisionRole(hallFloor, 'solidPlane');
  groundSlabGroup.add(hallFloor);
  box(groundSlabGroup, 'simpleHouse.floor.hallSubBase', [2.543, 0.1385, 5.869], [0, -0.09075, 1.283], subBaseMat).castShadow = false;

  // Trim stairwell void South edge to Z = 2.565 m (>= 2.43 m stair headroom below, and supports
  // the shortened landingGuard South return at Z = 2.62 m with >= 320 mm pier before landingGuest door!)
  const trimmedStairVoidXZ: [number, number][] = stair.voidOpeningXZ.map(([vx, vz]) => [
    vx,
    Math.min(vz, 2.565),
  ]);

  // First floor structural deck + ground-floor ceiling soffit (`finishThickness: 0` at `FFL_FIRST - 0.022`,
  // topped by 6 disjoint per-room 20 mm finish slabs at `FFL_FIRST` -> 0 coplanar faces!)
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

  // 6. Principal Bedroom + Walk-In Dressing: Oatmeal Loop-Pile Wool Broadloom Carpet
  firstRoomFinishSlab(
    'simpleHouse.floor.principalOatmealCarpet',
    'housePrincipalBed',
    rect(-inX, -wingX0, -1.648, inZ),
    principalOatmealCarpetMat
  );
  firstRoomFinishSlab(
    'simpleHouse.floor.dressingOatmealCarpet',
    'housePrincipalBed',
    rect(-inX, -3.592, -inZ, -1.772),
    principalOatmealCarpetMat
  );
  // 7. Principal Ensuite: Parisian Manoir Octagon & Cabochon Marble
  firstRoomFinishSlab(
    'simpleHouse.floor.ensuiteParisianManoir',
    'housePrincipalEnsuite',
    rect(-3.468, -wingX0, -inZ, -1.772),
    ensuiteParisianManoirMat
  );
  // 5. Galleried Landing: Crisp Classical Rectangular Gallery in Pale Smoked Oak Boards (with trimmed stair void)
  firstRoomFinishSlab(
    'simpleHouse.floor.landingSmokedOak',
    'houseLanding',
    rect(-1.148, 1.148, -1.528, inZ),
    landingSmokedOakMat,
    [trimmedStairVoidXZ]
  );
  // 8. Guest Bedroom 2: Natural Honey Sisal Bouclé
  firstRoomFinishSlab(
    'simpleHouse.floor.guestHoneySisal',
    'houseBedroom2',
    rect(wingX0, inX, -0.098, inZ),
    guestHoneySisalMat
  );
  // 9. Study / Bedroom 3: Warm Honey-Smoked Oak Wide-Board (incorporating former lobby east of pE_north)
  const studyPolygon: [number, number][] = [
    [2.472, -inZ],
    [inX, -inZ],
    [inX, -0.222],
    [wingX0, -0.222],
    [wingX0, -1.528],
    [2.472, -1.528],
  ];
  firstRoomFinishSlab(
    'simpleHouse.floor.studyFumedWalnutOak',
    'houseStudy',
    studyPolygon,
    studyFumedWalnutOakMat
  );
  // 10. Family Bathroom + Airing Cupboard: Tumbled Cotswold Limestone Flagstones
  firstRoomFinishSlab(
    'simpleHouse.floor.bathroomLimestone',
    'houseBathroom',
    rect(-1.148, 1.328, -inZ, -1.652),
    bathroomCotswoldLimestoneMat
  );
  firstRoomFinishSlab(
    'simpleHouse.floor.bathroomWetAlcoveLimestone',
    'houseBathroom',
    rect(1.452, 2.348, -inZ, -2.452),
    bathroomCotswoldLimestoneMat
  );
  firstRoomFinishSlab(
    'simpleHouse.floor.airingCupboardOak',
    'houseBathroom',
    rect(1.452, 2.348, -2.328, -1.652),
    landingSmokedOakMat
  );

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

  // --- Roof & chimneys (metric Flemish brick UVs on chimney stacks) --------------------------
  const roof = createHippedRoof({
    footprint: { minX: -HALF_W, maxX: HALF_W, minZ: -HALF_D, maxZ: HALF_D },
    eavesY: ROOF_EAVES_Y,
    pitchDeg: 33,
    overhangM: 0.28,
    outerMaterial: slateMat,
    name: 'simpleHouse.roof',
  });
  roofGroup.add(roof.group);
  for (const s of [-1, 1] as const) {
    roofGroup.add(
      buildGeorgianFacadeDressings({
        kind: 'chimneyStack',
        name: `simpleHouse.chimney.${s < 0 ? 'west' : 'east'}`,
        position: [s * 4.65, 6.05, 0],
        rotationY: Math.PI / 2,
      })
    );
  }

  // --- Facade dressings (2 mm clear of the brick, metric 1 UV = 1.0 m on stone plinths) ------
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

    const stringcourse = buildGeorgianFacadeDressings({
      kind: 'stringcourse',
      name: `simpleHouse.stringcourse.${side}`,
      lengthM: len - 0.94,
    });
    placeOnFacade(stringcourse, side, 0, 2.98);
    tagCutaway(stringcourse, cut(side, 'ground'));
    groundGroup.add(stringcourse);

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
    const groundPipe = buildSplitRainwaterDownpipeSegment(
      `simpleHouse.downpipe.${side}.ground`,
      'ground',
      downpipeCastIronMat
    );
    placeOnFacade(groundPipe, side, -3.85, 0.02);
    tagCutaway(groundPipe, cut(side, 'ground'));
    groundGroup.add(groundPipe);

    const firstPipe = buildSplitRainwaterDownpipeSegment(
      `simpleHouse.downpipe.${side}.first`,
      'first',
      downpipeCastIronMat
    );
    placeOnFacade(firstPipe, side, -3.85, 2.85);
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

  // --- Sash windows & French doors -------------------------------------------------------------
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
    stoneMat
  );

  // --- Interior doors (with continuous threshold bridge strips across every doorway) ----------
  for (const d of DOORS) {
    addInteriorDoor(
      ctx,
      floorGroups[d.floor],
      d,
      floorY[d.floor],
      trimMat,
      panelMat,
      brassMat,
      bathroomCotswoldLimestoneMat
    );
  }

  // --- Skirting, cornices, ceiling roses & panel mouldings -------------------------------------
  const pFace = HALL_PARTITION_X + INT_WALL_T * 0.5;
  const b = DRAWING_BREAST;
  const drawingPath: [number, number][] = [
    [-IN_X, IN_Z],
    [-pFace, IN_Z],
    [-pFace, -IN_Z],
    [-IN_X, -IN_Z],
    [-IN_X, b.minZ],
    [b.maxX, b.minZ],
    [b.maxX, b.maxZ],
    [-IN_X, b.maxZ],
  ];
  const principalPath: [number, number][] = [
    [-IN_X, IN_Z],
    [-pFace, IN_Z],
    [-pFace, -1.65],
    [-IN_X, -1.65],
  ];
  const guestPath: [number, number][] = [
    [pFace, IN_Z],
    [IN_X, IN_Z],
    [IN_X, -0.1],
    [pFace, -0.1],
  ];
  const kitchenPath: [number, number][] = [
    [pFace, IN_Z],
    [IN_X, IN_Z],
    [IN_X, -IN_Z],
    [pFace, -IN_Z],
  ];
  const doorGap = (id: string, faceX: number) => {
    const d = DOORS.find((spec) => spec.id === id)!;
    return { at: [d.plane === 'x' ? faceX : d.at[0], d.at[1]] as [number, number], width: 1.02 };
  };

  const skirting = (
    name: string,
    floor: FloorId,
    zone: string,
    path: [number, number][],
    closed: boolean,
    material: THREE.Material,
    gaps: { at: [number, number]; width: number }[]
  ) => {
    const run = createSkirtingRun({
      path,
      closed,
      roomSide: 'left',
      elevationY: floorY[floor] + 0.001,
      profile: 'ogee',
      height: 0.17,
      thickness: 0.02,
      material,
      gaps,
      cutawayWalls: (floor === 'ground' ? groundNet : firstNet).cutaways,
      floor,
      zone,
      name,
    });
    floorGroups[floor].add(run);
  };
  skirting('simpleHouse.skirting.drawing', 'ground', 'houseDrawing', drawingPath, true, schemes.houseDrawing.trim, [
    doorGap('hallDrawing', -pFace),
    { at: [b.maxX, 0], width: 1.62 },
    { at: [-IN_X, 2.585], width: 3.27 },
    { at: [-IN_X, -2.585], width: 3.27 },
  ]);
  skirting(
    'simpleHouse.skirting.dining',
    'ground',
    'houseKitchenDiner',
    [
      [pFace + 0.6, IN_Z],
      [IN_X, IN_Z],
      [IN_X, 0.4],
    ],
    false,
    schemes.houseKitchenDiner.trim,
    []
  );
  skirting('simpleHouse.skirting.guest', 'first', 'houseBedroom2', guestPath, true, schemes.houseBedroom2.trim, [
    doorGap('landingGuest', pFace),
  ]);

  const cornice = (name: string, floor: FloorId, zone: string, path: [number, number][]) => {
    const group = buildGeorgianCeilingCornice({
      name,
      path,
      closed: true,
      roomSide: 'left',
      ceilingY: floor === 'ground' ? GROUND_CEILING_SOFFIT_Y : FIRST_CEILING_SOFFIT_Y,
      cutawayWalls: (floor === 'ground' ? groundNet : firstNet).cutaways,
      floor,
      zone,
    });
    (floor === 'ground' ? groundCeilingGroup : firstCeilingGroup).add(group);
  };
  cornice('simpleHouse.cornice.drawing', 'ground', 'houseDrawing', drawingPath);
  cornice('simpleHouse.cornice.kitchen', 'ground', 'houseKitchenDiner', kitchenPath);
  cornice('simpleHouse.cornice.principal', 'first', 'housePrincipalBed', principalPath);
  cornice('simpleHouse.cornice.guest', 'first', 'houseBedroom2', guestPath);

  const roses: readonly { id: string; floor: FloorId; xz: readonly [number, number] }[] = [
    { id: 'drawing', floor: 'ground', xz: [-3.345, 0] },
    { id: 'hall', floor: 'ground', xz: HALL_ROSE_XZ },
    { id: 'kitchenDining', floor: 'ground', xz: [3.345, 2.25] },
    { id: 'landing', floor: 'first', xz: LANDING_ROSE_XZ },
    { id: 'principal', floor: 'first', xz: [-3.345, 1.285] },
    { id: 'guest', floor: 'first', xz: [3.345, 2.06] },
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
      position: [-3.1, GROUND_CEILING_SOFFIT_Y, 0],
      widthM: 2.5,
      depthM: 5.6,
      zone: 'houseDrawing',
    })
  );
  firstCeilingGroup.add(
    buildGeorgianCeilingPanelMoulding({
      name: 'simpleHouse.ceilingPanel.principal',
      position: [-3.345, FIRST_CEILING_SOFFIT_Y, 1.285],
      widthM: 2.6,
      depthM: 3.8,
      zone: 'housePrincipalBed',
    })
  );

  return { cut, plasterMat, trimMat, schemes };
}
