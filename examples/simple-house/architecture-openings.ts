import * as THREE from 'three';
import type { CutawayWallDescriptor } from 'husjs';
import {
  prepGeo,
  registerHingedDoor,
  tagCollisionRole,
  tagCutaway,
} from 'husjs/objects';
import type { SceneBuilderContext } from 'husjs/viewer';
import {
  EXT_WALL_T,
  FFL_GROUND,
  HALF_D,
  HALF_W,
  INT_WALL_T,
  SPINE_WALL_T,
} from './electrical-and-rooms.ts';
import {
  box,
  type FloorId,
  type Side,
  type SimpleHouseRoomSchemeKey,
} from './architecture-materials.ts';

/** Interior faces of the 360 mm exterior masonry shell (`14.82 × 9.16 m` exterior -> `±7.05 × ±4.22 m` interior). */
export const IN_X = HALF_W - EXT_WALL_T; // 7.05
export const IN_Z = HALF_D - EXT_WALL_T; // 4.22
/** 240 mm load-bearing spine partition centreline (Hall/Landing clear faces at ±1.65 = 3.30 m wide; Wing faces at ±1.89 = 5.16 m wide). */
export const HALL_PARTITION_X = 1.65 + SPINE_WALL_T * 0.5; // 1.77
/** 240 mm stairwell cross-wall centreline (Hall/Stairwell face at Z = -1.53, North service/bathroom face at Z = -1.77). */
export const STAIRWELL_CROSS_Z = -1.53 - SPINE_WALL_T * 0.5; // -1.65

/** Twin Rear Garden French Doors opening from both Golden-Ratio reception wings onto the 15.0 m Yorkstone terrace. */
export const FRENCH_DOOR = { x: 5.35, width: 1.48, height: 2.25 } as const;
export const DRAWING_FRENCH_DOOR = { x: -5.35, width: 1.48, height: 2.25 } as const;
/** Half-glazed Georgian rear garden boot door leading directly from terrace into Boot & Mudroom Lobby. */
export const BOOT_GARDEN_DOOR = { x: -0.95, width: 0.86, height: 2.16 } as const;
export const FRONT_DOOR = { width: 0.98, height: 2.205, archRiseM: 0.47 } as const;
export const DOOR_CLEAR_W = 0.86;
export const DOOR_CLEAR_H = 2.07;
export const DRESSING_STANDOFF_M = 0.002;

export interface WindowSpec {
  readonly id: string;
  readonly label: string;
  readonly zone: string;
  readonly room: SimpleHouseRoomSchemeKey;
  readonly floor: FloorId;
  readonly side: Side;
  readonly at: number;
  readonly width: number;
  readonly height: number;
  readonly sillY: number;
  readonly topRows?: number;
  readonly frosted?: boolean;
}

const G = { width: 1.12, height: 1.82, sillY: 0.68, floor: 'ground' } as const;
const F = { width: 1.12, height: 1.54, sillY: 0.62, floor: 'first' } as const;

/**
 * Strict Palladian 5-Bay Front (`South`: `X = -5.35, -2.95, 0.00, +2.95, +5.35`)
 * and 100% Plumb Void-over-Void Rear (`North`: `X = -5.35, -2.65, -0.95, +0.85, +3.55, +5.35`)
 * & East Flank (`Z = +2.10`) fenestration.
 */
export const WINDOWS: readonly WindowSpec[] = [
  // Ground Floor South (5-Bay Palladian Front flanking central Tuscan portico at X = 0)
  { ...G, id: 'drawingSouthWest', label: 'Drawing Room Sash (South-West)', zone: 'houseDrawing', room: 'houseDrawing', side: 'south', at: -5.35 },
  { ...G, id: 'drawingSouthEast', label: 'Drawing Room Sash (South-East)', zone: 'houseDrawing', room: 'houseDrawing', side: 'south', at: -2.95 },
  { ...G, id: 'diningSouthWest', label: 'Dining Sash (South-West)', zone: 'houseKitchenDiner', room: 'houseKitchenDiner', side: 'south', at: 2.95 },
  { ...G, id: 'diningSouthEast', label: 'Dining Sash (South-East)', zone: 'houseKitchenDiner', room: 'houseKitchenDiner', side: 'south', at: 5.35 },

  // Ground Floor North (Rear Garden Elevation — flanked by twin French doors at X = ±5.35 & boot door at X = -0.95)
  { ...G, id: 'drawingNorth', label: 'Drawing Room Writing-Bay Sash (Garden)', zone: 'houseDrawing', room: 'houseDrawing', side: 'north', at: -2.65 },
  { id: 'cloakroomNorth', label: 'Powder Room Frosted Sash', zone: 'houseCloakroom', room: 'houseCloakroom', floor: 'ground', side: 'north', at: 0.85, width: 0.76, height: 1.15, sillY: 1.15, frosted: true },
  { id: 'kitchenSinkNorth', label: 'Kitchen Belfast Sink Sash', zone: 'houseKitchenDiner', room: 'houseKitchenDiner', floor: 'ground', side: 'north', at: 3.62, width: 1.12, height: 1.42, sillY: 1.02 },

  // Ground Floor East Flank
  { ...G, id: 'diningEast', label: 'Dining Sash (East)', zone: 'houseKitchenDiner', room: 'houseKitchenDiner', side: 'east', at: 2.1 },

  // First Floor South (Strict 5-Bay Plumb Void-over-Void)
  { ...F, id: 'principalSouthWest', label: 'Principal Bedroom Sash (South-West)', zone: 'housePrincipalBed', room: 'housePrincipalBed', side: 'south', at: -5.35 },
  { ...F, id: 'principalSouthEast', label: 'Principal Bedroom Sash (South-East)', zone: 'housePrincipalBed', room: 'housePrincipalBed', side: 'south', at: -2.95 },
  { ...F, id: 'landingSouth', label: 'Galleried Landing Sash (Centre Bay)', zone: 'houseLanding', room: 'houseLanding', side: 'south', at: 0 },
  { ...F, id: 'guestSouthWest', label: 'Guest Bedroom Sash (South-West)', zone: 'houseBedroom2', room: 'houseBedroom2', side: 'south', at: 2.95 },
  { ...F, id: 'guestSouthEast', label: 'Guest Bedroom Sash (South-East)', zone: 'houseBedroom2', room: 'houseBedroom2', side: 'south', at: 5.35 },

  // First Floor North (Strict Plumb Void-over-Void over GF North French doors, sashes & boot door)
  { ...F, id: 'dressingNorth', label: 'Walk-In Dressing Sash (North)', zone: 'housePrincipalBed', room: 'housePrincipalDressing', side: 'north', at: -5.35 },
  { id: 'ensuiteNorth', label: 'Principal Ensuite Frosted Sash', zone: 'housePrincipalEnsuite', room: 'housePrincipalEnsuite', floor: 'first', side: 'north', at: -2.65, width: 0.78, height: 0.94, sillY: 1.15, topRows: 1, frosted: true },
  { id: 'bathroomNorthWest', label: 'Family Bathroom Frosted Sash (West)', zone: 'houseBathroom', room: 'houseBathroom', floor: 'first', side: 'north', at: -0.95, width: 0.86, height: 1.54, sillY: 0.62, topRows: 1, frosted: true },
  { id: 'bathroomNorth', label: 'Family Bathroom Frosted Sash (East)', zone: 'houseBathroom', room: 'houseBathroom', floor: 'first', side: 'north', at: 0.85, width: 0.86, height: 1.54, sillY: 0.62, topRows: 1, frosted: true },
  { ...F, id: 'studyNorthWest', label: 'Library Sash (North-West)', zone: 'houseStudy', room: 'houseStudy', side: 'north', at: 3.62 },
  { ...F, id: 'studyNorth', label: 'Library Sash (North-East)', zone: 'houseStudy', room: 'houseStudy', side: 'north', at: 5.35 },

  // First Floor East Flank (Plumb over diningEast)
  { ...F, id: 'guestEast', label: 'Guest Bedroom Sash (East)', zone: 'houseBedroom2', room: 'houseBedroom2', side: 'east', at: 2.1 },
];

export interface DoorSpec {
  readonly id: string;
  readonly floor: FloorId;
  readonly wall: string;
  readonly plane: 'x' | 'z';
  readonly at: readonly [number, number];
  readonly openAngle: number;
  readonly hinge: -1 | 1;
  readonly leaf?: boolean;
  readonly clearWidth?: number;
  readonly wallThickness?: number;
  readonly backRoom: SimpleHouseRoomSchemeKey;
  readonly frontRoom: SimpleHouseRoomSchemeKey;
}

export const DOORS: readonly DoorSpec[] = [
  // Ground floor: Bilaterally symmetric paired Hall reception doors at Z = +3.52 (South of stair curtail step)
  { id: 'hallDrawing', floor: 'ground', wall: 'pW_south', plane: 'x', at: [-HALL_PARTITION_X, 3.52], openAngle: -1.45, hinge: 1, wallThickness: SPINE_WALL_T, backRoom: 'houseDrawing', frontRoom: 'houseHall' },
  { id: 'hallKitchen', floor: 'ground', wall: 'pE_south', plane: 'x', at: [HALL_PARTITION_X, 3.52], openAngle: 1.45, hinge: 1, wallThickness: SPINE_WALL_T, backRoom: 'houseHall', frontRoom: 'houseKitchenDiner' },
  // Separate Boot Lobby door (swings South into empty North-West Hall corner) & DIRECT Guests' Powder Room WC door
  { id: 'hallBoot', floor: 'ground', wall: 'pZ', plane: 'z', at: [-1.08, STAIRWELL_CROSS_Z], openAngle: -1.4, hinge: -1, clearWidth: 0.78, wallThickness: SPINE_WALL_T, backRoom: 'houseBootLobby', frontRoom: 'houseHall' },
  { id: 'hallWc', floor: 'ground', wall: 'pZ', plane: 'z', at: [0.32, STAIRWELL_CROSS_Z], openAngle: 1.4, hinge: -1, clearWidth: 0.78, wallThickness: SPINE_WALL_T, backRoom: 'houseCloakroom', frontRoom: 'houseHall' },

  // First floor: Bilaterally symmetric Principal & Guest suite doors at Z = +3.48 + Non-blocking Direct Ensuite door
  { id: 'landingPrincipal', floor: 'first', wall: 'pW_south', plane: 'x', at: [-HALL_PARTITION_X, 3.48], openAngle: -1.45, hinge: 1, wallThickness: SPINE_WALL_T, backRoom: 'housePrincipalBed', frontRoom: 'houseLanding' },
  { id: 'principalDressing', floor: 'first', wall: 'pN_west', plane: 'z', at: [-5.55, -1.71], openAngle: 0, hinge: 1, leaf: false, clearWidth: 0.94, backRoom: 'housePrincipalDressing', frontRoom: 'housePrincipalBed' },
  { id: 'principalEnsuite', floor: 'first', wall: 'pN_east', plane: 'z', at: [-3.82, -1.71], openAngle: 1.4, hinge: -1, clearWidth: 0.80, backRoom: 'housePrincipalEnsuite', frontRoom: 'housePrincipalBed' },
  { id: 'landingGuest', floor: 'first', wall: 'pE_south', plane: 'x', at: [HALL_PARTITION_X, 3.48], openAngle: 1.45, hinge: 1, wallThickness: SPINE_WALL_T, backRoom: 'houseLanding', frontRoom: 'houseBedroom2' },
  { id: 'landingStudy', floor: 'first', wall: 'pE_north', plane: 'x', at: [HALL_PARTITION_X, -0.84], openAngle: -1.38, hinge: -1, clearWidth: 0.82, wallThickness: SPINE_WALL_T, backRoom: 'houseLanding', frontRoom: 'houseStudy' },
  { id: 'landingBathroom', floor: 'first', wall: 'pZ_bath', plane: 'z', at: [-1.05, STAIRWELL_CROSS_Z], openAngle: 1.4, hinge: -1, clearWidth: 0.84, wallThickness: SPINE_WALL_T, backRoom: 'houseBathroom', frontRoom: 'houseLanding' },
  { id: 'airingCupboard', floor: 'first', wall: 'pZ_air', plane: 'z', at: [2.38, -1.59], openAngle: 1.38, hinge: 1, clearWidth: 0.68, backRoom: 'houseBathroom', frontRoom: 'houseStudy' },
];

export interface PartitionSpec {
  readonly id: string;
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
  readonly thickness?: number;
}

export const PARTITIONS: Readonly<Record<FloorId, readonly PartitionSpec[]>> = {
  ground: [
    { id: 'pW_south', from: [-HALL_PARTITION_X, IN_Z], to: [-HALL_PARTITION_X, STAIRWELL_CROSS_Z], thickness: SPINE_WALL_T },
    { id: 'pW_north', from: [-HALL_PARTITION_X, STAIRWELL_CROSS_Z], to: [-HALL_PARTITION_X, -IN_Z], thickness: SPINE_WALL_T },
    { id: 'pE_south', from: [HALL_PARTITION_X, IN_Z], to: [HALL_PARTITION_X, 0.28], thickness: SPINE_WALL_T },
    { id: 'pE_north', from: [HALL_PARTITION_X, 0.28], to: [HALL_PARTITION_X, -IN_Z], thickness: SPINE_WALL_T },
    { id: 'pZ', from: [-HALL_PARTITION_X, STAIRWELL_CROSS_Z], to: [HALL_PARTITION_X, STAIRWELL_CROSS_Z], thickness: SPINE_WALL_T },
    { id: 'pX', from: [-0.25, -IN_Z], to: [-0.25, STAIRWELL_CROSS_Z] },
  ],
  first: [
    { id: 'pW_south', from: [-HALL_PARTITION_X, IN_Z], to: [-HALL_PARTITION_X, STAIRWELL_CROSS_Z], thickness: SPINE_WALL_T },
    { id: 'pW_north', from: [-HALL_PARTITION_X, STAIRWELL_CROSS_Z], to: [-HALL_PARTITION_X, -IN_Z], thickness: SPINE_WALL_T },
    { id: 'pN_west', from: [-IN_X, -1.71], to: [-4.39, -1.71] },
    { id: 'pN_east', from: [-4.39, -1.71], to: [-1.89, -1.71] },
    { id: 'pDress', from: [-4.39, -IN_Z], to: [-4.39, -1.71] },
    { id: 'pE_south', from: [HALL_PARTITION_X, IN_Z], to: [HALL_PARTITION_X, -0.16], thickness: SPINE_WALL_T },
    { id: 'pE_north', from: [HALL_PARTITION_X, -0.16], to: [HALL_PARTITION_X, STAIRWELL_CROSS_Z], thickness: SPINE_WALL_T },
    { id: 'pZ_bath', from: [-HALL_PARTITION_X, STAIRWELL_CROSS_Z], to: [1.89, STAIRWELL_CROSS_Z], thickness: SPINE_WALL_T },
    { id: 'pZ_air', from: [1.89, -1.59], to: [2.81, -1.59] },
    { id: 'pAirW', from: [1.95, -1.59], to: [1.95, -2.39] },
    { id: 'pAirS', from: [1.95, -2.39], to: [2.81, -2.39] },
    { id: 'pS', from: [2.81, -IN_Z], to: [2.81, -1.59] },
    { id: 'pG', from: [HALL_PARTITION_X, -0.16], to: [IN_X, -0.16] },
  ],
};

export function wallOffset(side: Side, at: number): number {
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

export function placeOnFacade(
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

function doorOffset(spec: DoorSpec): number {
  const wall = PARTITIONS[spec.floor].find((p) => p.id === spec.wall)!;
  return Math.hypot(spec.at[0] - wall.from[0], spec.at[1] - wall.from[1]);
}

export function partitionOpenings(floor: FloorId, wallId: string) {
  return DOORS.filter((d) => d.floor === floor && d.wall === wallId).map((d) => ({
    id: d.id,
    centerOffset: doorOffset(d),
    width: d.clearWidth ?? DOOR_CLEAR_W,
    sillY: 0,
    height: DOOR_CLEAR_H,
  }));
}

export function windowOpenings(floor: FloorId, side: Side) {
  return WINDOWS.filter((w) => w.floor === floor && w.side === side).map((w) => ({
    id: w.id,
    centerOffset: wallOffset(side, w.at),
    width: w.width,
    sillY: w.sillY,
    height: w.height,
  }));
}

export function addInteriorDoor(
  ctx: SceneBuilderContext,
  parent: THREE.Object3D,
  spec: DoorSpec,
  floorY: number,
  backTrimMat: THREE.Material,
  frontTrimMat: THREE.Material,
  leafMat: THREE.Material,
  panelMat: THREE.Material,
  brassMat: THREE.Material,
  thresholdMat: THREE.Material | null
): void {
  const clearW = spec.clearWidth ?? DOOR_CLEAR_W;
  const half = clearW * 0.5;
  const wallT = spec.wallThickness ?? INT_WALL_T;
  const wallHalf = wallT * 0.5;
  const root = new THREE.Group();
  root.name = `simpleHouse.door.${spec.id}`;
  root.position.set(spec.at[0], floorY, spec.at[1]);
  root.rotation.y = spec.plane === 'x' ? Math.PI / 2 : 0;
  parent.add(root);

  const jambInner = half - 0.022;
  const liningT = 0.022;
  for (const faceSign of [-1, 1] as const) {
    const faceMat = faceSign < 0 ? backTrimMat : frontTrimMat;
    const faceTag = faceSign < 0 ? 'back' : 'front';
    const sliceD = wallHalf - 0.0015;
    const sliceCz = faceSign * (sliceD * 0.5 + 0.0005);
    for (const s of [-1, 1] as const) {
      box(
        root,
        `${root.name}.jamb_${faceTag}_${s < 0 ? 'a' : 'b'}`,
        [liningT, 2.064, sliceD],
        [s * (jambInner + liningT * 0.5), 0.002 + 2.064 * 0.5, sliceCz],
        faceMat
      );
      if (wallT > 0.16) {
        box(
          root,
          `${root.name}.liningField_${faceTag}_${s < 0 ? 'a' : 'b'}`,
          [0.003, 1.82, sliceD - 0.036],
          [s * (jambInner - 0.002), 0.12 + 1.82 * 0.5, sliceCz],
          faceMat
        );
      }
    }
    box(
      root,
      `${root.name}.headJamb_${faceTag}`,
      [clearW - 0.002, liningT, sliceD],
      [0, 2.067 + liningT * 0.5, sliceCz],
      faceMat
    );

    const plinthH = spec.floor === 'ground' ? 0.178 : 0.156;
    const archInner = jambInner + 0.004;
    const archOuter = half + 0.068;
    const archW = archOuter - archInner;
    const archCx = (archInner + archOuter) * 0.5;
    const plinthD = 0.024;
    const plinthCz = faceSign * (wallHalf + plinthD * 0.5 + 0.001);
    for (const s of [-1, 1] as const) {
      box(
        root,
        `${root.name}.architravePlinth_${faceTag}_${s < 0 ? 'a' : 'b'}`,
        [archW + 0.002, plinthH, plinthD],
        [s * archCx, 0.002 + plinthH * 0.5, plinthCz],
        faceMat
      );
      const legBotY = 0.003 + plinthH;
      const legTopY = 2.072;
      const legH = legTopY - legBotY;
      const baseD = 0.014;
      box(
        root,
        `${root.name}.architraveLeg_${faceTag}_${s < 0 ? 'a' : 'b'}`,
        [archW, legH, baseD],
        [s * archCx, legBotY + legH * 0.5, faceSign * (wallHalf + baseD * 0.5 + 0.001)],
        faceMat
      );
      const backbandW = 0.024;
      const bbD = 0.006;
      box(
        root,
        `${root.name}.architraveBackband_${faceTag}_${s < 0 ? 'a' : 'b'}`,
        [backbandW, legH, bbD],
        [s * (archOuter - backbandW * 0.5), legBotY + legH * 0.5, faceSign * (wallHalf + baseD + bbD * 0.5 + 0.0015)],
        faceMat
      );
    }

    const headH = archW;
    const headBaseD = 0.015;
    const headBotY = 2.073;
    box(
      root,
      `${root.name}.architraveHead_${faceTag}`,
      [archOuter * 2, headH, headBaseD],
      [0, headBotY + headH * 0.5, faceSign * (wallHalf + headBaseD * 0.5 + 0.001)],
      faceMat
    );
    const crownD = 0.007;
    box(
      root,
      `${root.name}.architraveCrown_${faceTag}`,
      [archOuter * 2 + 0.012, 0.024, crownD],
      [0, headBotY + headH - 0.012, faceSign * (wallHalf + headBaseD + crownD * 0.5 + 0.0015)],
      faceMat
    );
  }

  if (thresholdMat) {
    const sill = box(root, `${root.name}.threshold`, [clearW - 0.002, 0.02, wallT + 0.002], [0, -0.0108, 0], thresholdMat, 1.0);
    sill.castShadow = false;
    tagCollisionRole(sill, 'solidPlane');
  }

  if (spec.leaf === false) return;

  const actualSwingSign = Math.sign(spec.hinge * Math.sin(spec.openAngle)) || 1;
  const leafZ = wallT > 0.16 ? actualSwingSign * (wallHalf - 0.045) : 0;

  const leafW = jambInner * 2 - 0.006;
  const leafH = 2.03;
  const leaf = new THREE.Group();
  leaf.name = `${root.name}.leaf`;
  box(leaf, `${leaf.name}.slab`, [leafW, leafH, 0.04], [0, 0.008 + leafH * 0.5, 0], leafMat);
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
  leaf.position.z = leafZ;
  root.add(leaf);
  registerHingedDoor(ctx, {
    parent: root,
    door: leaf,
    hingeOffset: [spec.hinge * leafW * 0.5, 0, leafZ],
    axis: 'y',
    openAngle: spec.openAngle,
  });
}

export function addFrenchDoors(
  ctx: SceneBuilderContext,
  parent: THREE.Object3D,
  cutaway: CutawayWallDescriptor,
  trimMat: THREE.Material,
  glassMat: THREE.Material,
  brassMat: THREE.Material,
  stoneMat: THREE.Material,
  steelMat: THREE.Material,
  doorSpec: { readonly x: number; readonly width: number; readonly height: number } = FRENCH_DOOR,
  name = 'simpleHouse.frenchDoors'
): void {
  const half = doorSpec.width * 0.5;
  const outerRebate = 0.125;
  const root = new THREE.Group();
  root.name = name;
  root.position.set(doorSpec.x, FFL_GROUND, -HALF_D + outerRebate);
  parent.add(root);

  for (const s of [-1, 1] as const) {
    box(root, `${root.name}.jamb_${s < 0 ? 'w' : 'e'}`, [0.06, 2.199, 0.1], [s * (half - 0.02), 1.1005, 0], trimMat);
  }
  box(root, `${root.name}.head`, [doorSpec.width + 0.028, 0.07, 0.104], [0, 2.225, 0], trimMat);

  box(
    root,
    `${root.name}.bathStoneLintel`,
    [doorSpec.width + 0.3, 0.215, 0.115],
    [0, doorSpec.height + 0.109, -outerRebate + 0.0575 - 0.002],
    stoneMat,
    1.0
  );
  const steelFlangeD = EXT_WALL_T - outerRebate - 0.06;
  box(
    root,
    `${root.name}.steelRevealLintelFlange`,
    [doorSpec.width - 0.008, 0.012, steelFlangeD],
    [0, doorSpec.height - 0.007, 0.056 + steelFlangeD * 0.5],
    steelMat
  );

  const sillDepth = EXT_WALL_T + 0.061;
  const sill = box(
    root,
    `${root.name}.stoneThreshold`,
    [doorSpec.width - 0.004, 0.05, sillDepth],
    [0, -0.0258, -outerRebate + EXT_WALL_T * 0.5 - 0.0295],
    stoneMat,
    1.0
  );
  tagCollisionRole(sill, 'solidPlane');

  const leafW = half - 0.052;
  const leafH = 2.17;
  const y0 = 0.012;
  let westPivot: THREE.Group | null = null;
  let eastPivot: THREE.Group | null = null;
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
    const pivot = registerHingedDoor(ctx, {
      parent: root,
      door: leaf,
      hingeOffset: [s * (0.001 + leafW), 0, 0],
      axis: 'y',
      openAngle: -s * 1.35,
    });
    if (s < 0) westPivot = pivot;
    else eastPivot = pivot;
  }
  if (westPivot && eastPivot) {
    ctx.interactions?.linkDoorPair(westPivot, eastPivot);
  }

  const intWallZ = EXT_WALL_T - outerRebate;
  const revealD = intWallZ - 0.056;
  const revealCz = 0.054 + revealD * 0.5;
  for (const s of [-1, 1] as const) {
    box(
      root,
      `${root.name}.interiorReveal_${s < 0 ? 'w' : 'e'}`,
      [0.018, 2.222, revealD],
      [s * (half - 0.01), 0.002 + 2.222 * 0.5, revealCz],
      trimMat
    );
  }
  box(
    root,
    `${root.name}.interiorHeadReveal`,
    [doorSpec.width - 0.004, 0.018, revealD],
    [0, 2.231, revealCz],
    trimMat
  );
  const fPlinthH = 0.165;
  const fArchInner = half - 0.012;
  const fArchOuter = half + 0.068;
  const fArchW = fArchOuter - fArchInner;
  const fArchCx = (fArchInner + fArchOuter) * 0.5;
  for (const s of [-1, 1] as const) {
    const tag = s < 0 ? 'w' : 'e';
    box(
      root,
      `${root.name}.architravePlinth_${tag}`,
      [fArchW + 0.002, fPlinthH, 0.024],
      [s * fArchCx, 0.002 + fPlinthH * 0.5, intWallZ + 0.013],
      trimMat
    );
    const legBotY = 0.003 + fPlinthH;
    const legH = 2.248 - legBotY;
    box(
      root,
      `${root.name}.architraveLeg_${tag}`,
      [fArchW, legH, 0.015],
      [s * fArchCx, legBotY + legH * 0.5, intWallZ + 0.0085],
      trimMat
    );
    box(
      root,
      `${root.name}.architraveBackband_${tag}`,
      [0.024, legH, 0.006],
      [s * (fArchOuter - 0.012), legBotY + legH * 0.5, intWallZ + 0.0195],
      trimMat
    );
  }
  box(
    root,
    `${root.name}.architraveHead`,
    [fArchOuter * 2, fArchW, 0.016],
    [0, 2.249 + fArchW * 0.5, intWallZ + 0.009],
    trimMat
  );
  box(
    root,
    `${root.name}.architraveCrown`,
    [fArchOuter * 2 + 0.014, 0.024, 0.007],
    [0, 2.249 + fArchW - 0.012, intWallZ + 0.021],
    trimMat
  );

  tagCutaway(root, cutaway);
}

/** Half-glazed Georgian rear garden boot door (`simpleHouse.bootGardenDoor`) opening outward onto the Yorkstone terrace. */
export function addRearGardenBootDoor(
  ctx: SceneBuilderContext,
  parent: THREE.Object3D,
  cutaway: CutawayWallDescriptor,
  trimMat: THREE.Material,
  doorExteriorMat: THREE.Material,
  glassMat: THREE.Material,
  brassMat: THREE.Material,
  stoneMat: THREE.Material
): void {
  const half = BOOT_GARDEN_DOOR.width * 0.5;
  const outerRebate = 0.125;
  const root = new THREE.Group();
  root.name = 'simpleHouse.bootGardenDoor';
  root.position.set(BOOT_GARDEN_DOOR.x, FFL_GROUND, -HALF_D + outerRebate);
  parent.add(root);

  for (const s of [-1, 1] as const) {
    box(root, `${root.name}.jamb_${s < 0 ? 'w' : 'e'}`, [0.052, 2.115, 0.096], [s * (half - 0.018), 1.059, 0], trimMat);
  }
  box(root, `${root.name}.head`, [BOOT_GARDEN_DOOR.width + 0.024, 0.062, 0.1], [0, 2.138, 0], trimMat);
  box(
    root,
    `${root.name}.bathStoneLintel`,
    [BOOT_GARDEN_DOOR.width + 0.24, 0.195, 0.115],
    [0, BOOT_GARDEN_DOOR.height + 0.099, -outerRebate + 0.055],
    stoneMat,
    1.0
  );
  const sill = box(
    root,
    `${root.name}.stoneThreshold`,
    [BOOT_GARDEN_DOOR.width - 0.004, 0.05, EXT_WALL_T + 0.061],
    [0, -0.0258, -outerRebate + EXT_WALL_T * 0.5 - 0.0295],
    stoneMat,
    1.0
  );
  tagCollisionRole(sill, 'solidPlane');

  const leafW = BOOT_GARDEN_DOOR.width - 0.092;
  const leafH = 2.09;
  const leaf = new THREE.Group();
  leaf.name = `${root.name}.leaf`;
  const stile = 0.072;
  box(leaf, `${leaf.name}.stileW`, [stile, leafH, 0.044], [-(leafW - stile) * 0.5, 0.012 + leafH * 0.5, 0], doorExteriorMat);
  box(leaf, `${leaf.name}.stileE`, [stile, leafH, 0.044], [(leafW - stile) * 0.5, 0.012 + leafH * 0.5, 0], doorExteriorMat);
  const railW = leafW - stile * 2;
  box(leaf, `${leaf.name}.railBot`, [railW, 0.22, 0.044], [0, 0.122, 0], doorExteriorMat);
  box(leaf, `${leaf.name}.lowerPanel`, [railW - 0.008, 0.62, 0.032], [0, 0.545, 0], doorExteriorMat);
  box(leaf, `${leaf.name}.lockRail`, [railW, 0.12, 0.044], [0, 0.918, 0], doorExteriorMat);
  box(leaf, `${leaf.name}.railTop`, [railW, 0.075, 0.044], [0, 0.012 + leafH - 0.0375, 0], doorExteriorMat);
  const glassH = leafH - 1.055;
  const glassCy = 0.98 + glassH * 0.5;
  const glass = box(leaf, `${leaf.name}.glass`, [railW + 0.008, glassH + 0.008, 0.006], [0, glassCy, 0], glassMat);
  glass.castShadow = false;
  glass.userData.isExteriorGlazedPortal = true;
  box(leaf, `${leaf.name}.glazingBarV`, [0.018, glassH, 0.03], [0, glassCy, 0], doorExteriorMat);
  box(leaf, `${leaf.name}.glazingBarH`, [railW, 0.018, 0.03], [0, glassCy, 0], doorExteriorMat);
  for (const s of [-1, 1] as const) {
    const knob = new THREE.Mesh(prepGeo(new THREE.SphereGeometry(0.024, 14, 10)), brassMat);
    knob.name = `${leaf.name}.knob_${s < 0 ? 'ext' : 'int'}`;
    knob.position.set(leafW * 0.5 - 0.055, 0.96, s * 0.044);
    leaf.add(knob);
  }
  root.add(leaf);
  tagCutaway(leaf, cutaway);
  // Hinged on West (-X) jamb, opening outward (-Z) onto rear terrace so 0 interior mudroom clash
  registerHingedDoor(ctx, {
    parent: root,
    door: leaf,
    hingeOffset: [-leafW * 0.5, 0, -0.02],
    axis: 'y',
    openAngle: 1.38,
  });

  const intWallZ = EXT_WALL_T - outerRebate;
  const revealD = intWallZ - 0.054;
  for (const s of [-1, 1] as const) {
    box(root, `${root.name}.interiorReveal_${s < 0 ? 'w' : 'e'}`, [0.016, 2.138, revealD], [s * (half - 0.009), 1.071, 0.052 + revealD * 0.5], trimMat);
    box(root, `${root.name}.architraveLeg_${s < 0 ? 'w' : 'e'}`, [0.068, 2.155, 0.016], [s * (half + 0.024), 1.08, intWallZ + 0.009], trimMat);
  }
  box(root, `${root.name}.interiorHeadReveal`, [BOOT_GARDEN_DOOR.width - 0.004, 0.016, revealD], [0, 2.148, 0.052 + revealD * 0.5], trimMat);
  box(root, `${root.name}.architraveHead`, [BOOT_GARDEN_DOOR.width + 0.12, 0.068, 0.016], [0, 2.192, intWallZ + 0.009], trimMat);

  tagCutaway(root, cutaway);
}

/** Classical Georgian window-tax architectural blind sash relief for the West Flank (`X = -HALF_W`). */
export function buildGeorgianBlindSashRelief(
  name: string,
  width: number,
  height: number,
  trimMat: THREE.Material,
  stoneMat: THREE.Material,
  slateBlindMat: THREE.Material
): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  // Local frame placed on facade via `placeOnFacade(group, 'west', along, y)`: +Z projects outward
  box(group, `${name}.yorkstoneSill`, [width + 0.14, 0.075, 0.068], [0, -0.038, 0.034], stoneMat, 1.0);
  box(group, `${name}.stoneKeystoneLintel`, [width + 0.18, 0.21, 0.036], [0, height + 0.106, 0.018], stoneMat, 1.0);
  box(group, `${name}.boxFrameOuter`, [width, height, 0.028], [0, height * 0.5, 0.014], trimMat);
  box(group, `${name}.blindSlateRecess`, [width - 0.12, height - 0.12, 0.016], [0, height * 0.5, 0.022], slateBlindMat);
  box(group, `${name}.meetingRail`, [width - 0.1, 0.034, 0.026], [0, height * 0.5, 0.028], trimMat);
  for (const sx of [-width / 6 + 0.02, width / 6 - 0.02] as const) {
    box(group, `${name}.muntinV_${sx < 0 ? 'a' : 'b'}`, [0.018, height - 0.12, 0.022], [sx, height * 0.5, 0.026], trimMat);
  }
  for (const sy of [height * 0.25, height * 0.75] as const) {
    box(group, `${name}.muntinH_${sy < height * 0.5 ? 'bot' : 'top'}`, [width - 0.12, 0.018, 0.022], [0, sy, 0.026], trimMat);
  }
  return group;
}

export function buildFrontDoorInteriorSurround(
  trimMat: THREE.Material,
  cutaway: CutawayWallDescriptor
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'simpleHouse.hall.frontDoorArchitrave';
  const half = FRONT_DOOR.width * 0.5;
  const archInner = half - 0.006;
  const archOuter = 0.576;
  const archW = archOuter - archInner;
  const archCx = (archInner + archOuter) * 0.5;
  const plinthH = 0.182;

  const revealD = EXT_WALL_T - 0.08;
  const revealCz = IN_Z + 0.002 + revealD * 0.5;
  for (const s of [-1, 1] as const) {
    const tag = s < 0 ? 'west' : 'east';
    box(
      group,
      `${group.name}.revealLining_${tag}`,
      [0.016, FRONT_DOOR.height - 0.008, revealD],
      [s * (half - 0.009), FFL_GROUND + 0.002 + (FRONT_DOOR.height - 0.008) * 0.5, revealCz],
      trimMat
    );
    box(
      group,
      `${group.name}.plinth_${tag}`,
      [archW + 0.002, plinthH, 0.024],
      [s * archCx, FFL_GROUND + 0.002 + plinthH * 0.5, IN_Z - 0.013],
      trimMat
    );
    const legBotY = FFL_GROUND + 0.003 + plinthH;
    const legTopY = FRONT_DOOR.height - 0.043;
    const legH = legTopY - legBotY;
    box(
      group,
      `${group.name}.pilaster_${tag}`,
      [archW, legH, 0.016],
      [s * archCx, legBotY + legH * 0.5, IN_Z - 0.009],
      trimMat
    );
    box(
      group,
      `${group.name}.backband_${tag}`,
      [0.024, legH, 0.006],
      [s * (archOuter - 0.012), legBotY + legH * 0.5, IN_Z - 0.0205],
      trimMat
    );
  }

  box(
    group,
    `${group.name}.transomBar`,
    [archOuter * 2 + 0.012, 0.046, 0.022],
    [0, FRONT_DOOR.height - 0.018, IN_Z - 0.012],
    trimMat
  );

  const springY = FRONT_DOOR.height + 0.006;
  const rise = FRONT_DOOR.archRiseM - 0.006;
  const ringW = 0.033;
  const shape = new THREE.Shape();
  const segs = 28;
  for (let i = 0; i <= segs; i++) {
    const t = Math.PI * (1 - i / segs);
    const x = Math.cos(t) * (archInner + ringW + 0.024);
    const y = springY + Math.sin(t) * (rise + ringW);
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  for (let i = segs; i >= 0; i--) {
    const t = Math.PI * (1 - i / segs);
    const x = Math.cos(t) * archInner;
    const y = springY + Math.sin(t) * rise;
    shape.lineTo(x, y);
  }
  shape.closePath();
  const archGeo = prepGeo(
    new THREE.ExtrudeGeometry(shape, { depth: 0.016, bevelEnabled: false })
  );
  const archMesh = new THREE.Mesh(archGeo, trimMat);
  archMesh.name = `${group.name}.fanlightArchivolt`;
  archMesh.position.set(0, 0, IN_Z - 0.017);
  archMesh.castShadow = true;
  archMesh.receiveShadow = true;
  group.add(archMesh);

  tagCutaway(group, cutaway);
  return group;
}

export function buildSplitRainwaterDownpipeSegment(
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
    const shoeH = 0.14;
    const shoe = addCyl(`${name}.bottomDischargeShoe`, pipeR + 0.003, pipeR + 0.005, shoeH, 0.04 + shoeH * 0.5, pipeZ + 0.025);
    shoe.rotation.x = 0.36;
    const shaftLen = 2.628;
    addCyl(`${name}.castIronPipeShaft`, pipeR, pipeR, shaftLen, 0.18 + shaftLen * 0.5, pipeZ);
    [0.32, 1.48, 2.61].forEach((cy, idx) => {
      addCyl(`${name}.pipeSocketCollar_${idx + 1}`, pipeR + 0.008, pipeR + 0.008, 0.048, cy, pipeZ);
      box(group, `${name}.pipeEarBracket_${idx + 1}`, [0.165, 0.036, 0.016], [0, cy, 0.01], castIronMat);
    });
  } else {
    const shaftLen = 2.32;
    addCyl(`${name}.castIronPipeShaft`, pipeR, pipeR, shaftLen, shaftLen * 0.5, pipeZ);
    [0.07, 1.14, 2.20].forEach((cy, idx) => {
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
