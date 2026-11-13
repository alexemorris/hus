import * as THREE from 'three';
import type { CircuitId, InteractiveUserData, RoomZoneId } from 'husjs';
import { applyMetricBoxUVs, createRoomPaintScheme } from 'husjs/materials';
import { buildCastIronColumnRadiator, buildCorstonToggleSwitch, buildWindowRomanBlind, createBalustradeRun, createStaircase, prepGeo, registerHingedDoor, sharedCylinderGeometry, sharedSphereGeometry, tagCollisionRole, tagCutaway } from 'husjs/objects';
import { createHeritageFloorFinishMaterial, getPaleEuropeanOakJoineryMaterial } from 'husjs/catalog/architectural';
import { buildCuratedMirrorsArtAndRugs, buildGeorgianAntiqueCasework, buildWhiteCompanyAccessories } from 'husjs/catalog/furniture';
import { buildHeritageInteriorLighting } from 'husjs/catalog/lighting';
import { getBathroomBrassMaterials } from 'husjs/catalog/sanitaryware';
import type { SceneBuilderContext } from 'husjs/viewer';
import { EXT_WALL_T, FFL_FIRST, FFL_GROUND, FIRST_CEILING_SOFFIT_Y, GROUND_CEILING_SOFFIT_Y, HALF_D, HALF_W } from './electrical-and-rooms.ts';

export type SimpleHouseStair = ReturnType<typeof createStaircase>;

export interface SimpleHouseStairHallShellRef {
  readonly schemes?: {
    readonly houseHall?: { readonly trim: THREE.Material };
    readonly houseLanding?: { readonly trim: THREE.Material };
  };
}

/** Flight hugs the East hall spine wall (`X ∈ [0.53, 1.65]`) and climbs North from `Z = +3.00` to `Z = -0.60`. */
export const STAIR_ORIGIN_XZ: readonly [number, number] = [1.09, 3.0];
export const STAIR_WIDTH_M = 1.12;
export const STAIR_GOING_M = 0.24;
export const HALL_ROSE_XZ: readonly [number, number] = [-0.25, 3.52];
export const LANDING_ROSE_XZ: readonly [number, number] = [1.09, 1.15];

const WEST_HALL_X = -1.65;
const SOFFIT_SLOPE = 3.05 / 16 / STAIR_GOING_M; // 0.7942708

function stairSoffitBottomY(z: number): number {
  return (STAIR_ORIGIN_XZ[1] - z) * SOFFIT_SLOPE - 0.092;
}

let stairMaterials: {
  readonly tread: THREE.Material;
  readonly paint: THREE.Material;
  readonly mahogany: THREE.Material;
  readonly runner: THREE.Material;
  readonly border: THREE.Material;
} | null = null;

function getStairMaterials() {
  if (!stairMaterials) {
    const hallScheme = createRoomPaintScheme({ wallColor: 'slipper-satin', trimColor: 'wimborne-white', roomKind: 'hallway' });
    stairMaterials = {
      tread: new THREE.MeshStandardMaterial({ name: 'simpleHouse.stair.oakTread', color: 0xa88966, roughness: 0.54 }),
      paint: hallScheme.trim,
      mahogany: new THREE.MeshStandardMaterial({ name: 'simpleHouse.stair.flameMahogany', color: 0x4a2318, roughness: 0.32 }),
      runner: createHeritageFloorFinishMaterial('rogerOatesHerringboneRunner'),
      border: new THREE.MeshStandardMaterial({ name: 'simpleHouse.stair.oliveLinenBorder', color: 0x72775e, roughness: 0.9 }),
    };
  }
  return stairMaterials;
}

/**
 * Georgian cut-string staircase: 16 risers of 190.6 mm on a 240 mm going (`2R + G = 621 mm`),
 * curtail bottom step, two turned spindles per tread, mahogany handrail, open sloped plaster
 * soffit for the fitted cloak cupboard below, and 15 brass stair rods over a Roger Oates runner.
 */
export function createSimpleHouseStair(): SimpleHouseStair {
  const mats = getStairMaterials();
  return createStaircase({
    layout: 'straight',
    bottomY: FFL_GROUND,
    topY: FFL_FIRST,
    origin: STAIR_ORIGIN_XZ,
    direction: 'north',
    width: STAIR_WIDTH_M,
    targetRiserM: 0.19,
    goingM: STAIR_GOING_M,
    openSide: 'left',
    stringerStyle: 'cut',
    stringers: { left: 'cut', right: 'wall' },
    includeTreadBrackets: true,
    includeLandingApron: false,
    curtailBottomStep: 'left',
    spindlesPerTread: 2,
    newelCap: 'ball',
    spindleStyle: 'turned',
    spandrel: 'open-soffit',
    runner: { width: 0.68, material: mats.runner, borderMaterial: mats.border, borderWidth: 0.045, stairRods: true },
    treadMaterial: mats.tread,
    riserMaterial: mats.paint,
    stringerMaterial: mats.paint,
    balustradeMaterial: mats.paint,
    handrailMaterial: mats.mahogany,
    newelCapMaterial: mats.mahogany,
    soffitMaterial: mats.paint,
    zone: 'houseHall',
    name: 'simpleHouse.stair',
  });
}

let samplerStair: SimpleHouseStair | null = null;

/** Walkable flight elevation at a world `(x, z)`, or `null` when off the stair. */
export function sampleSimpleHouseStairY(x: number, z: number): number | null {
  if (!samplerStair) samplerStair = createSimpleHouseStair();
  return samplerStair.sampleWalkableY(x, z);
}

function addBox(
  parent: THREE.Object3D,
  name: string,
  size: readonly [number, number, number],
  pos: readonly [number, number, number],
  mat: THREE.Material,
  castShadow = true
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    prepGeo(applyMetricBoxUVs(new THREE.BoxGeometry(size[0], size[1], size[2]), { tileW: 1.0, tileH: 1.0 })),
    mat
  );
  mesh.name = name;
  mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Extrudes a 2D `(z, y)` polygon across `[xMin, xMax]` in world coordinates. */
function addZYPrism(
  parent: THREE.Object3D,
  name: string,
  pointsZY: readonly (readonly [number, number])[],
  xMin: number,
  xMax: number,
  mat: THREE.Material
): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(pointsZY[0]![0], pointsZY[0]![1]);
  for (let i = 1; i < pointsZY.length; i++) {
    shape.lineTo(pointsZY[i]![0], pointsZY[i]![1]);
  }
  shape.closePath();
  const depthX = xMax - xMin;
  const ext = new THREE.ExtrudeGeometry(shape, { depth: depthX, bevelEnabled: false });
  const pos = ext.attributes['position'] as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getX(i);
    const y = pos.getY(i);
    const x = xMin + pos.getZ(i);
    pos.setXYZ(i, x, y, z);
  }
  ext.computeVertexNormals();
  const mesh = new THREE.Mesh(prepGeo(ext), mat);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function deconflictRomanBlind(blind: THREE.Group, facingZ: 1 | -1): THREE.Group {
  for (const child of blind.children) {
    if (child.name.endsWith('.hemBar')) {
      child.position.y -= 0.0015;
      child.position.z += facingZ * 0.002;
    } else if (child.name.endsWith('.pleat')) {
      child.position.z += facingZ * 0.005;
    }
  }
  return blind;
}

function buildStairwellSteelTrimmer(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'simpleHouse.structure.stairwellTrimmer';

  const steelMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.structure.pfcSteel',
    color: 0x383c3f,
    roughness: 0.46,
    metalness: 0.68,
  });

  // 200 x 90 PFC parallel flange channel lining the stairwell void South apron (Z = 2.565)
  // Spans X in [0.475, 1.646] from the cantilevered landing newel pocket to the East spine wall.
  const x0 = 0.475;
  const x1 = 1.646;
  const lenX = x1 - x0;
  const cx = (x0 + x1) * 0.5;
  const pfcH = 0.2;
  const flangeW = 0.09;
  const flangeT = 0.012;
  const webT = 0.0085;
  const yBot = FFL_FIRST - 0.226;
  const zBack = 2.562; // 3 mm clear inside Z = 2.565 void apron face

  addBox(group, `${group.name}.web`, [lenX, pfcH - flangeT * 2, webT], [cx, yBot + pfcH * 0.5, zBack - webT * 0.5], steelMat);
  addBox(group, `${group.name}.bottomFlange`, [lenX, flangeT, flangeW], [cx, yBot + flangeT * 0.5, zBack - flangeW * 0.5], steelMat);
  addBox(group, `${group.name}.topFlange`, [lenX, flangeT, flangeW], [cx, yBot + pfcH - flangeT * 0.5, zBack - flangeW * 0.5], steelMat);

  const stiffD = flangeW - webT - 0.004;
  const stiffH = pfcH - flangeT * 2 - 0.002;
  for (const [idx, sx] of [[1, 0.56], [2, 1.06], [3, 1.56]] as const) {
    addBox(group, `${group.name}.stiffener_${idx}`, [0.008, stiffH, stiffD], [sx, yBot + pfcH * 0.5, zBack - webT - stiffD * 0.5 - 0.001], steelMat);
  }
  addBox(group, `${group.name}.eastEndPlate`, [0.01, pfcH - 0.008, flangeW - 0.004], [x1 - 0.006, yBot + pfcH * 0.5, zBack - flangeW * 0.5], steelMat);

  return group;
}

/**
 * Georgian moulded dado rail (`Y = 0.92 m`) + lower recessed fielded wainscot panelling
 * along a `+X`-facing West wall (`wallX = -1.65`), sitting cleanly above existing floor skirting.
 */
function buildWestWallWainscotDado(opts: {
  readonly name: string;
  readonly zone: RoomZoneId;
  readonly floorY: number;
  readonly skirtingTopY: number;
  readonly zStart: number;
  readonly zEnd: number;
  readonly bayCount: number;
  readonly trimMat: THREE.Material;
}): THREE.Group {
  const { name, zone, floorY, skirtingTopY, zStart, zEnd, bayCount, trimMat } = opts;
  const group = new THREE.Group();
  group.name = name;
  group.userData.zoneId = zone;

  const spanZ = zEnd - zStart;
  const cz = (zStart + zEnd) * 0.5;
  const yDadoCenter = floorY + 0.92;
  const dadoCapH = 0.044;
  const dadoNosH = 0.018;

  // Moulded Georgian dado rail at Y = 0.92 m (X in [-1.646, -1.618], 4 mm East of -1.650 plaster)
  addBox(group, `${name}.dadoBackband`, [0.018, dadoCapH, spanZ], [WEST_HALL_X + 0.013, yDadoCenter, cz], trimMat);
  addBox(group, `${name}.dadoNosing`, [0.008, dadoNosH, spanZ + 0.004], [WEST_HALL_X + 0.028, yDadoCenter + 0.004, cz], trimMat);

  // Lower wainscot framing between existing skirting top (+6 mm) and dado rail bottom (-5 mm)
  const yPanelBot = skirtingTopY + 0.006;
  const yPanelTop = yDadoCenter - dadoCapH * 0.5 - 0.005;
  const railH = 0.056;
  const stileW = 0.068;
  const frameX = WEST_HALL_X + 0.01; // X in [-1.646, -1.634]

  addBox(group, `${name}.bottomRail`, [0.012, railH, spanZ], [frameX, yPanelBot + railH * 0.5, cz], trimMat, false);
  addBox(group, `${name}.topRail`, [0.012, railH, spanZ], [frameX, yPanelTop - railH * 0.5, cz], trimMat, false);

  const innerH = yPanelTop - yPanelBot - railH * 2 - 0.008;
  const innerCy = (yPanelBot + yPanelTop) * 0.5;
  const usableZ = spanZ - stileW;
  const stepZ = usableZ / bayCount;

  for (let i = 0; i <= bayCount; i++) {
    const sz = zStart + stileW * 0.5 + i * stepZ;
    addBox(group, `${name}.stile_${i + 1}`, [0.012, innerH, stileW], [frameX, innerCy, sz], trimMat, false);
  }

  for (let b = 0; b < bayCount; b++) {
    const bz0 = zStart + stileW + b * stepZ + 0.018;
    const bz1 = zStart + (b + 1) * stepZ - 0.018;
    const bw = bz1 - bz0;
    if (bw <= 0.12) continue;
    const bcz = (bz0 + bz1) * 0.5;
    // Recessed backing + proud bevelled fielded centre panel (2.5 mm layer offsets -> 0 z-fight)
    addBox(group, `${name}.panelField_${b + 1}`, [0.006, innerH - 0.036, bw], [WEST_HALL_X + 0.02, innerCy, bcz], trimMat, false);
    addBox(group, `${name}.panelRaise_${b + 1}`, [0.005, innerH - 0.092, bw - 0.056], [WEST_HALL_X + 0.0275, innerCy, bcz], trimMat, false);
  }

  tagCollisionRole(group, 'ignore');
  return group;
}

/**
 * Fitted, interactive Georgian under-stairs cloak & boot cupboard
 * (`X ∈ [0.53, 1.645], Z ∈ [-0.60, +2.88]`) beneath the open sloped stair soffit.
 */
function buildUnderstairsCloakCupboard(
  ctx: SceneBuilderContext,
  trimMat: THREE.Material,
  mahoganyMat: THREE.Material,
  brassMat: THREE.Material,
  darkBrassMat: THREE.Material
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'simpleHouse.hall.understairsCupboard';
  root.userData.zoneId = 'houseHall';

  const oakMat = getPaleEuropeanOakJoineryMaterial();
  const oliveWaxMat = new THREE.MeshStandardMaterial({ name: 'simpleHouse.cupboard.waxedOliveCoat', color: 0x3f4a36, roughness: 0.72 });
  const corduroyCollarMat = new THREE.MeshStandardMaterial({ name: 'simpleHouse.cupboard.corduroyCollar', color: 0x4b3626, roughness: 0.85 });
  const charcoalWoolMat = new THREE.MeshStandardMaterial({ name: 'simpleHouse.cupboard.charcoalWoolCoat', color: 0x2c3036, roughness: 0.88 });
  const umbrellaGreenMat = new THREE.MeshStandardMaterial({ name: 'simpleHouse.cupboard.umbrellaCanopy', color: 0x1f3629, roughness: 0.68 });
  const wellingtonGreenMat = new THREE.MeshStandardMaterial({ name: 'simpleHouse.cupboard.wellingtonRubber', color: 0x243b2b, roughness: 0.38 });
  const bootSoleMat = new THREE.MeshStandardMaterial({ name: 'simpleHouse.cupboard.rubberSole', color: 0x1d1c1a, roughness: 0.82 });
  const tanBrogueMat = new THREE.MeshStandardMaterial({ name: 'simpleHouse.cupboard.tanCalfLeather', color: 0x8b5229, roughness: 0.42 });
  const ivoryLinenMat = new THREE.MeshStandardMaterial({ name: 'simpleHouse.cupboard.ivoryLinen', color: 0xf1ece1, roughness: 0.9 });
  const sagePipingMat = new THREE.MeshStandardMaterial({ name: 'simpleHouse.cupboard.linenRibbon', color: 0xc8c2b2, roughness: 0.86 });

  // Exterior Georgian Spandrel Joinery (X ≈ 0.53 face) & Skirting (X = 0.522)
  // Doorway clear opening: Z ∈ [0.02, 0.76] (W = 0.74 m), H = 1.72 m
  const doorZ0 = 0.02;
  const doorZ1 = 0.76;
  const doorH = 1.72;

  // Wrapped 165 mm Wimborne White skirting plinth along X = 0.522, gapped cleanly at doorway
  addBox(root, `${root.name}.skirtingNorth`, [0.014, 0.165, 0.562], [0.522, FFL_GROUND + 0.0845, -0.319], trimMat);
  addBox(root, `${root.name}.skirtingSouth`, [0.014, 0.165, 1.92], [0.522, FFL_GROUND + 0.0845, 1.778], trimMat);
  addBox(root, `${root.name}.skirtingNorthReturn`, [1.124, 0.165, 0.014], [1.08, FFL_GROUND + 0.0845, -0.609], trimMat);

  // Moulded door architrave framing Z ∈ [0.02, 0.76] (X ∈ [0.514, 0.527], 3 mm clear of 0.530 stringer/soffit)
  const archW = 0.05;
  addBox(root, `${root.name}.architraveNorth`, [0.013, doorH + 0.002, archW], [0.5205, (doorH + 0.002) * 0.5 + 0.002, doorZ0 - archW * 0.5 - 0.002], trimMat);
  addBox(root, `${root.name}.architraveSouth`, [0.013, doorH + 0.002, archW], [0.5205, (doorH + 0.002) * 0.5 + 0.002, doorZ1 + archW * 0.5 + 0.002], trimMat);
  addBox(root, `${root.name}.architraveHead`, [0.013, archW, doorZ1 - doorZ0 + archW * 2 + 0.008], [0.5205, doorH + 0.006 + archW * 0.5, (doorZ0 + doorZ1) * 0.5], trimMat);

  // Planted door stops (X ∈ [0.529, 0.543], 3 mm East of door leaf East face 0.526)
  addBox(root, `${root.name}.doorStopNorth`, [0.014, doorH - 0.02, 0.016], [0.536, doorH * 0.5, doorZ0 + 0.01], trimMat, false);
  addBox(root, `${root.name}.doorStopSouth`, [0.014, 1.65, 0.016], [0.536, 0.83, doorZ1 - 0.01], trimMat, false);

  // North spandrel wall polygon: Z ∈ [-0.596, -0.036] up to sloped stair soffit - 10 mm
  const zN0 = -0.596;
  const zN1 = -0.036;
  addZYPrism(root, `${root.name}.spandrelNorthWall`, [[zN0, 0.004], [zN1, 0.004], [zN1, stairSoffitBottomY(zN1) - 0.01], [zN0, Math.min(2.705, stairSoffitBottomY(zN0) - 0.01)]], 0.533, 0.549, trimMat);
  // Fielded Georgian panels on North spandrel pier (X ∈ [0.525, 0.530], 3 mm West of 0.533 wall)
  addBox(root, `${root.name}.spandrelNorthLowerPanel`, [0.005, 0.64, 0.38], [0.5275, 0.54, -0.316], trimMat, false);
  addBox(root, `${root.name}.spandrelNorthUpperPanel`, [0.005, 1.12, 0.38], [0.5275, 1.54, -0.316], trimMat, false);

  // Triangular over-door transom spandrel: Z ∈ [-0.032, 0.62] above head architrave (Y >= 1.762)
  addZYPrism(root, `${root.name}.spandrelOverDoor`, [[-0.032, 1.762], [0.62, 1.762], [0.62, stairSoffitBottomY(0.62) - 0.01], [-0.032, stairSoffitBottomY(-0.032) - 0.01]], 0.533, 0.549, trimMat);

  // South raked spandrel wall: Z ∈ [0.816, 2.815] (stops 20 mm clear of footNewel at Z = 2.835)
  const zS0 = 0.816;
  const zS1 = 2.815;
  addZYPrism(root, `${root.name}.spandrelSouthWall`, [[zS0, 0.004], [zS1, 0.004], [zS1, Math.max(0.035, stairSoffitBottomY(zS1) - 0.01)], [zS0, stairSoffitBottomY(zS0) - 0.01]], 0.533, 0.549, trimMat);
  // Three raked Georgian fielded spandrel panels stepping down Southward (X ∈ [0.525, 0.530])
  for (const [idx, pz0, pz1] of [[1, 0.88, 1.38], [2, 1.46, 1.96], [3, 2.04, 2.48]] as const) {
    const yTop0 = stairSoffitBottomY(pz0) - 0.085;
    const yTop1 = stairSoffitBottomY(pz1) - 0.085;
    if (yTop1 > 0.24) {
      addZYPrism(root, `${root.name}.spandrelSouthField_${idx}`, [[pz0, 0.215], [pz1, 0.215], [pz1, yTop1], [pz0, yTop0]], 0.525, 0.53, trimMat);
    }
  }

  // North end (Z = -0.60) painted vertical matchboard back panel (X ∈ [0.534, 1.644])
  const northBackH = 2.7; // 19 mm below topNewel_left base (2.719 m)
  addBox(root, `${root.name}.northMatchboardBack`, [1.11, northBackH - 0.004, 0.016], [1.089, (northBackH + 0.004) * 0.5, -0.59], trimMat);
  for (let b = 0; b < 8; b++) {
    const bx = 0.6 + b * 0.14;
    addBox(root, `${root.name}.northMatchboardBatten_${b + 1}`, [0.095, northBackH - 0.19, 0.004], [bx, 0.178 + (northBackH - 0.19) * 0.5, -0.601], trimMat, false);
  }

  // Interactive hinged 4-panel Georgian cupboard door (W = 0.734 m, H = 1.712 m, X ∈ [0.502, 0.526])
  const leafW = 0.734;
  const leafH = 1.712;
  const leafT = 0.024;
  const doorLeaf = new THREE.Group();
  doorLeaf.name = 'simpleHouse.hall.understairsCupboard.door';
  doorLeaf.position.set(0.514, FFL_GROUND + 0.005, (doorZ0 + doorZ1) * 0.5);
  doorLeaf.userData = {
    id: 'simpleHouse.hall.understairsCupboard.door',
    label: 'Under-Stairs Cloak Cupboard',
    zoneId: 'houseHall',
  };

  // Perimeter stiles & rails + recessed core so 4 fielded panels sit 2.5 mm proud without z-fighting
  const dStile = 0.088;
  addBox(doorLeaf, `${doorLeaf.name}.stileNorth`, [leafT, leafH, dStile], [0, leafH * 0.5, -leafW * 0.5 + dStile * 0.5], trimMat);
  addBox(doorLeaf, `${doorLeaf.name}.stileSouth`, [leafT, leafH, dStile], [0, leafH * 0.5, leafW * 0.5 - dStile * 0.5], trimMat);
  const innerDoorZ = leafW - dStile * 2 - 0.004;
  addBox(doorLeaf, `${doorLeaf.name}.railBottom`, [leafT, 0.145, innerDoorZ], [0, 0.0725, 0], trimMat);
  addBox(doorLeaf, `${doorLeaf.name}.railLock`, [leafT, 0.11, innerDoorZ], [0, 0.82, 0], trimMat);
  addBox(doorLeaf, `${doorLeaf.name}.railTop`, [leafT, 0.095, innerDoorZ], [0, leafH - 0.0475, 0], trimMat);
  addBox(doorLeaf, `${doorLeaf.name}.muntinLower`, [leafT, 0.614, 0.072], [0, 0.455, 0], trimMat);
  addBox(doorLeaf, `${doorLeaf.name}.muntinUpper`, [leafT, 0.736, 0.072], [0, 1.245, 0], trimMat);
  addBox(doorLeaf, `${doorLeaf.name}.panelWeb`, [0.008, leafH - 0.26, innerDoorZ - 0.004], [0, leafH * 0.5 + 0.02, 0], trimMat, false);

  const pColW = (innerDoorZ - 0.072) * 0.5 - 0.022;
  const pColOff = 0.036 + 0.011 + pColW * 0.5;
  for (const [rTag, py, ph] of [['lower', 0.455, 0.56], ['upper', 1.245, 0.68]] as const) {
    for (const [cTag, czSign] of [['North', -1], ['South', 1]] as const) {
      addBox(doorLeaf, `${doorLeaf.name}.fieldedPanel_${rTag}${cTag}`, [0.015, ph, pColW], [0, py, czSign * pColOff], trimMat, false);
    }
  }

  // Aged-brass knob & keyhole escutcheon on South latch stile (2 mm clear of leaf West face -0.012)
  const latchZ = leafW * 0.5 - 0.044;
  const rose = new THREE.Mesh(sharedCylinderGeometry(0.022, 0.024, 0.005, 16), brassMat);
  rose.name = `${doorLeaf.name}.knobRose`;
  rose.rotation.z = Math.PI * 0.5;
  rose.position.set(-leafT * 0.5 - 0.0035, 0.86, latchZ);
  const spindle = new THREE.Mesh(sharedCylinderGeometry(0.007, 0.007, 0.022, 12), darkBrassMat);
  spindle.name = `${doorLeaf.name}.knobNeck`;
  spindle.rotation.z = Math.PI * 0.5;
  spindle.position.set(-leafT * 0.5 - 0.017, 0.86, latchZ);
  const knobBall = new THREE.Mesh(sharedSphereGeometry(0.021, 16, 12), brassMat);
  knobBall.name = `${doorLeaf.name}.knob`;
  knobBall.scale.set(0.76, 1, 1);
  knobBall.position.set(-leafT * 0.5 - 0.034, 0.86, latchZ);
  const escutcheon = addBox(doorLeaf, `${doorLeaf.name}.escutcheon`, [0.003, 0.036, 0.018], [-leafT * 0.5 - 0.0025, 0.785, latchZ], brassMat, false);
  doorLeaf.add(rose, spindle, knobBall, escutcheon);

  const doorPivot = registerHingedDoor(ctx, { parent: root, door: doorLeaf, hingeOffset: [-leafT * 0.5, 0, -leafW * 0.5 + 0.006], axis: 'y', openAngle: -(78 * Math.PI) / 180 });
  doorPivot.name = 'simpleHouse.hall.understairsCupboard.doorPivot';
  doorPivot.userData = {
    ...doorPivot.userData,
    id: 'simpleHouse.hall.understairsCupboard.door',
    label: 'Under-Stairs Cloak Cupboard',
    zoneId: 'houseHall',
  };

  // Fitted Interior (X ∈ [0.56, 1.64], Z ∈ [-0.56, +2.75])
  // Painted vertical T&G matchboard rear lining along X = 1.636 (8 mm West of 1.650 spine wall)
  const plankCount = 18;
  const zLiningStart = -0.56;
  const zLiningEnd = 2.68;
  const plankPitch = (zLiningEnd - zLiningStart) / plankCount;
  for (let p = 0; p < plankCount; p++) {
    const pz0 = zLiningStart + p * plankPitch;
    const pz1 = pz0 + plankPitch - 0.005;
    const maxH = Math.min(2.68, stairSoffitBottomY(pz1) - 0.022);
    if (maxH > 0.08) {
      addBox(root, `${root.name}.rearTgPlank_${p + 1}`, [0.012, maxH - 0.004, plankPitch - 0.005], [1.636, (maxH + 0.004) * 0.5, (pz0 + pz1) * 0.5], trimMat, false);
    }
  }

  // Solid English oak threshold strip across cupboard doorway (Z ∈ [0.024, 0.756], X = 0.556)
  addBox(root, `${root.name}.oakThreshold`, [0.044, 0.012, 0.732], [0.556, FFL_GROUND + 0.008, 0.39], oakMat);

  // Solid English oak peg rail on East interior wall (X = 1.61, Y = 1.52, Z ∈ [-0.45, +0.75])
  addBox(root, `${root.name}.oakPegRail`, [0.022, 0.092, 1.18], [1.614, 1.52, 0.14], oakMat);
  addBox(root, `${root.name}.oakPegRailCap`, [0.034, 0.018, 1.2], [1.608, 1.576, 0.14], oakMat);

  const hookZs = [-0.26, 0.12, 0.5] as const;
  for (let h = 0; h < hookZs.length; h++) {
    const hz = hookZs[h]!;
    const plate = new THREE.Mesh(sharedCylinderGeometry(0.018, 0.018, 0.005, 12), brassMat);
    plate.name = `${root.name}.coatHookPlate_${h + 1}`;
    plate.rotation.z = Math.PI * 0.5;
    plate.position.set(1.599, 1.52, hz);
    const stem = new THREE.Mesh(sharedCylinderGeometry(0.005, 0.006, 0.055, 10), brassMat);
    stem.name = `${root.name}.coatHookStem_${h + 1}`;
    stem.rotation.z = Math.PI * 0.42;
    stem.position.set(1.572, 1.528, hz);
    const tip = new THREE.Mesh(sharedSphereGeometry(0.009, 10, 8), brassMat);
    tip.name = `${root.name}.coatHookTip_${h + 1}`;
    tip.position.set(1.546, 1.54, hz);
    root.add(plate, stem, tip);
  }

  // (a) Sculpted waxed olive country coat hanging at Z = -0.26
  const oliveCoat = new THREE.Group();
  oliveCoat.name = `${root.name}.waxedOliveCoat`;
  oliveCoat.position.set(1.5, 0, -0.26);
  addBox(oliveCoat, `${oliveCoat.name}.collar`, [0.075, 0.07, 0.14], [0.02, 1.48, 0], corduroyCollarMat);
  addBox(oliveCoat, `${oliveCoat.name}.shoulders`, [0.11, 0.14, 0.34], [0, 1.38, 0], oliveWaxMat);
  const oliveBody = new THREE.Mesh(sharedCylinderGeometry(0.085, 0.135, 0.74, 14), oliveWaxMat);
  oliveBody.name = `${oliveCoat.name}.drapedBody`;
  oliveBody.scale.set(0.62, 1, 1.25);
  oliveBody.position.set(-0.005, 0.98, 0);
  oliveBody.castShadow = true;
  oliveCoat.add(oliveBody);
  for (const [sTag, sz] of [['North', -0.145], ['South', 0.145]] as const) {
    const sleeve = new THREE.Mesh(sharedCylinderGeometry(0.036, 0.03, 0.54, 10), oliveWaxMat);
    sleeve.name = `${oliveCoat.name}.sleeve${sTag}`;
    sleeve.rotation.x = sz < 0 ? 0.08 : -0.08;
    sleeve.position.set(-0.01, 1.12, sz);
    oliveCoat.add(sleeve);
    addBox(oliveCoat, `${oliveCoat.name}.bellowsPocket${sTag}`, [0.018, 0.13, 0.11], [-0.068, 0.82, sz * 0.65], oliveWaxMat);
  }
  root.add(oliveCoat);

  // (b) Sculpted charcoal wool overcoat hanging at Z = +0.12
  const woolCoat = new THREE.Group();
  woolCoat.name = `${root.name}.charcoalOvercoat`;
  woolCoat.position.set(1.49, 0, 0.12);
  addBox(woolCoat, `${woolCoat.name}.collar`, [0.07, 0.065, 0.13], [0.02, 1.485, 0], charcoalWoolMat);
  addBox(woolCoat, `${woolCoat.name}.tailoredShoulders`, [0.105, 0.15, 0.35], [0, 1.38, 0], charcoalWoolMat);
  const woolSkirt = new THREE.Mesh(sharedCylinderGeometry(0.082, 0.13, 0.86, 14), charcoalWoolMat);
  woolSkirt.name = `${woolCoat.name}.skirt`;
  woolSkirt.scale.set(0.58, 1, 1.28);
  woolSkirt.position.set(-0.005, 0.92, 0);
  woolSkirt.castShadow = true;
  woolCoat.add(woolSkirt);
  for (const [sTag, sz] of [['North', -0.15], ['South', 0.15]] as const) {
    const sleeve = new THREE.Mesh(sharedCylinderGeometry(0.034, 0.028, 0.58, 10), charcoalWoolMat);
    sleeve.name = `${woolCoat.name}.sleeve${sTag}`;
    sleeve.rotation.x = sz < 0 ? 0.07 : -0.07;
    sleeve.position.set(-0.008, 1.1, sz);
    woolCoat.add(sleeve);
  }
  root.add(woolCoat);

  // (c) Furled umbrella with curved timber J-handle hanging on South hook (Z = +0.50)
  const umbrella = new THREE.Group();
  umbrella.name = `${root.name}.furledUmbrella`;
  umbrella.position.set(1.545, 0.65, 0.5);
  const uShaft = new THREE.Mesh(sharedCylinderGeometry(0.007, 0.005, 0.82, 10), mahoganyMat);
  uShaft.name = `${umbrella.name}.shaft`;
  uShaft.position.y = 0.41;
  const uCanopy = new THREE.Mesh(sharedCylinderGeometry(0.032, 0.011, 0.54, 12), umbrellaGreenMat);
  uCanopy.name = `${umbrella.name}.canopy`;
  uCanopy.position.y = 0.38;
  const uFerrule = new THREE.Mesh(sharedCylinderGeometry(0.005, 0.003, 0.06, 8), brassMat);
  uFerrule.name = `${umbrella.name}.ferrule`;
  uFerrule.position.y = 0.03;
  const crookCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.81, 0),
    new THREE.Vector3(0, 0.885, 0),
    new THREE.Vector3(0.028, 0.905, 0),
    new THREE.Vector3(0.052, 0.875, 0),
    new THREE.Vector3(0.048, 0.835, 0),
  ]);
  const uHandle = new THREE.Mesh(prepGeo(new THREE.TubeGeometry(crookCurve, 14, 0.009, 10, false)), mahoganyMat);
  uHandle.name = `${umbrella.name}.curvedTimberHandle`;
  umbrella.add(uShaft, uCanopy, uFerrule, uHandle);
  root.add(umbrella);

  // Two-tier slatted solid-oak boot & shoe rack (X ∈ [0.95, 1.55], Z ∈ [-0.45, +0.45])
  const bootRack = new THREE.Group();
  bootRack.name = `${root.name}.oakBootRack`;
  for (const [pxTag, px] of [['West', 0.97], ['East', 1.53]] as const) {
    for (const [pzTag, pz] of [['North', -0.43], ['South', 0.43]] as const) {
      addBox(bootRack, `${bootRack.name}.post_${pxTag}${pzTag}`, [0.032, 0.38, 0.032], [px, 0.193, pz], oakMat);
    }
    addBox(bootRack, `${bootRack.name}.railLower_${pxTag}`, [0.024, 0.028, 0.82], [px, 0.085, 0], oakMat);
    addBox(bootRack, `${bootRack.name}.railUpper_${pxTag}`, [0.024, 0.028, 0.82], [px, 0.315, 0], oakMat);
  }
  for (const [tTag, ty] of [['lower', 0.104], ['upper', 0.334]] as const) {
    for (let s = 0; s < 5; s++) {
      const sx = 1.03 + s * 0.11;
      addBox(bootRack, `${bootRack.name}.${tTag}Slat_${s + 1}`, [0.056, 0.012, 0.88], [sx, ty, 0], oakMat);
    }
  }
  root.add(bootRack);

  // Pair of dark-green Wellington boots on upper forward rack (X = 1.13, Z = -0.26 & -0.10)
  for (const [bIdx, bz] of [[1, -0.26], [2, -0.1]] as const) {
    const welly = new THREE.Group();
    welly.name = `${root.name}.wellingtonBoot_${bIdx}`;
    welly.position.set(1.13, 0.342, bz);
    addBox(welly, `${welly.name}.sole`, [0.245, 0.02, 0.092], [-0.02, 0.01, 0], bootSoleMat);
    const vamp = new THREE.Mesh(sharedCylinderGeometry(0.044, 0.046, 0.18, 12), wellingtonGreenMat);
    vamp.name = `${welly.name}.footVamp`;
    vamp.rotation.z = Math.PI * 0.5;
    vamp.position.set(-0.03, 0.05, 0);
    const shaft = new THREE.Mesh(sharedCylinderGeometry(0.054, 0.045, 0.31, 14), wellingtonGreenMat);
    shaft.name = `${welly.name}.calfShaft`;
    shaft.position.set(0.035, 0.185, 0);
    addBox(welly, `${welly.name}.buckleStrap`, [0.016, 0.018, 0.112], [0.035, 0.31, 0], brassMat, false);
    welly.add(vamp, shaft);
    root.add(welly);
  }

  // Pair of tan leather brogues on lower rack (X = 1.18, Z = +0.12 & +0.26)
  for (const [sIdx, sz] of [[1, 0.12], [2, 0.26]] as const) {
    const brogue = new THREE.Group();
    brogue.name = `${root.name}.tanBrogue_${sIdx}`;
    brogue.position.set(1.18, 0.112, sz);
    addBox(brogue, `${brogue.name}.weltSole`, [0.255, 0.016, 0.088], [0, 0.008, 0], bootSoleMat);
    addBox(brogue, `${brogue.name}.heel`, [0.068, 0.012, 0.084], [0.088, 0.021, 0], bootSoleMat);
    const upper = new THREE.Mesh(sharedCylinderGeometry(0.038, 0.042, 0.22, 12), tanBrogueMat);
    upper.name = `${brogue.name}.leatherUpper`;
    upper.rotation.z = Math.PI * 0.5;
    upper.position.set(-0.005, 0.046, 0);
    const collar = new THREE.Mesh(sharedCylinderGeometry(0.04, 0.042, 0.058, 12), tanBrogueMat);
    collar.name = `${brogue.name}.ankleQuarter`;
    collar.position.set(0.055, 0.064, 0);
    brogue.add(upper, collar);
    root.add(brogue);
  }

  // Stepped solid-oak spandrel shelves (Z ∈ [0.85, 2.35]) + 2 Kubu rattan baskets + folded ivory linens
  // Upper spandrel shelf: Z ∈ [0.86, 1.58], Y = 0.58 m (soffit at Z = 1.58 is 1.036 m -> 440 mm clear)
  addBox(root, `${root.name}.spandrelShelfUpper`, [0.98, 0.026, 0.72], [1.11, 0.58, 1.22], oakMat);
  addBox(root, `${root.name}.spandrelCleatUpper`, [0.026, 0.036, 0.7], [1.61, 0.546, 1.22], oakMat, false);

  // Lower spandrel shelf: Z ∈ [0.86, 2.32], Y = 0.18 m (soffit at Z = 2.32 is 0.448 m)
  addBox(root, `${root.name}.spandrelShelfLower`, [0.98, 0.026, 1.46], [1.11, 0.18, 1.59], oakMat);
  addBox(root, `${root.name}.spandrelCleatLower`, [0.026, 0.036, 1.42], [1.61, 0.146, 1.59], oakMat, false);

  const basketUpper = buildWhiteCompanyAccessories({ kind: 'kubuStorageBasket', name: `${root.name}.kubuBasketUpper`, position: [1.08, 0.596, 1.1] });
  const basketLower = buildWhiteCompanyAccessories({ kind: 'kubuStorageBasket', name: `${root.name}.kubuBasketLower`, position: [1.08, 0.196, 1.14] });
  root.add(basketUpper, basketLower);

  // Neatly stacked folded ivory household linens on both oak spandrel shelves
  for (const [sTag, baseY, lz, count] of [['upper', 0.596, 1.44, 3], ['lower', 0.196, 1.76, 4]] as const) {
    const stack = new THREE.Group();
    stack.name = `${root.name}.foldedLinens_${sTag}`;
    for (let k = 0; k < count; k++) {
      const ly = baseY + 0.018 + k * 0.038;
      addBox(stack, `${stack.name}.towel_${k + 1}`, [0.34 - k * 0.008, 0.032, 0.24 - k * 0.006], [1.12, ly, lz], ivoryLinenMat);
    }
    addBox(stack, `${stack.name}.cottonRibbon`, [0.346, count * 0.038 + 0.004, 0.026], [1.12, baseY + (count * 0.038) * 0.5, lz], sagePipingMat, false);
    root.add(stack);
  }

  // Ribbed-glass & aged-brass bulkhead courtesy light at (X = 1.58, Y = 1.98, Z = 0.25)
  const bulkhead = new THREE.Group();
  bulkhead.name = `${root.name}.bulkheadCourtesyLight`;
  bulkhead.position.set(1.58, 1.98, 0.25);

  const bulkheadGlowMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.cupboard.bulkheadRibbedGlass',
    color: 0xfff6e3,
    roughness: 0.28,
    emissive: new THREE.Color(0xffcf87),
    emissiveIntensity: 0,
  });
  bulkheadGlowMat.userData.baseEmissiveIntensity = 1.6;
  const maybeRegisterEmissive = (
    ctx as { registerEmissive?: (c: CircuitId, m: THREE.MeshStandardMaterial, maxIntensity?: number) => void }
  ).registerEmissive;
  if (typeof maybeRegisterEmissive === 'function') {
    maybeRegisterEmissive.call(ctx, 'houseHallLantern' as CircuitId, bulkheadGlowMat, 1.6);
  } else {
    ctx.lightGroups['houseHallLantern' as CircuitId]?.emissives.push(bulkheadGlowMat);
  }

  addBox(bulkhead, `${bulkhead.name}.brassBase`, [0.018, 0.11, 0.17], [0.032, -0.02, 0], darkBrassMat);
  const diffuserDome = new THREE.Mesh(sharedCylinderGeometry(0.042, 0.042, 0.13, 14), bulkheadGlowMat);
  diffuserDome.name = `${bulkhead.name}.ribbedGlassDiffuser`;
  diffuserDome.rotation.x = Math.PI * 0.5;
  diffuserDome.scale.set(0.68, 1, 1.05);
  diffuserDome.position.set(0.004, -0.02, 0);
  bulkhead.add(diffuserDome);
  for (const [gIdx, gz] of [[1, -0.042], [2, 0], [3, 0.042]] as const) {
    addBox(bulkhead, `${bulkhead.name}.cageGuard_${gIdx}`, [0.006, 0.094, 0.007], [-0.028, -0.02, gz], brassMat, false);
  }
  addBox(bulkhead, `${bulkhead.name}.longitudinalGuard`, [0.006, 0.007, 0.156], [-0.036, -0.02, 0], brassMat, false);
  root.add(bulkhead);

  return root;
}

export function buildSimpleHouseStaircaseAndHall(
  ctx: SceneBuilderContext,
  stair: SimpleHouseStair,
  shell?: SimpleHouseStairHallShellRef
): void {
  const groundGroup = ctx.floor ? ctx.floor('ground').group : ctx.scene;
  const groundCeilingGroup = ctx.floor ? ctx.floor('ground').ceilingGroup : ctx.groundFloorCeilingGroup;
  const firstGroup = ctx.floor ? ctx.floor('first').group : ctx.firstFloorMeshGroup;
  const firstCeilingGroup = ctx.floor ? ctx.floor('first').ceilingGroup : ctx.ceilingMeshGroup;

  const mats = getStairMaterials();
  const hallTrimMat = shell?.schemes?.houseHall?.trim ?? mats.paint;
  const landingTrimMat = shell?.schemes?.houseLanding?.trim ?? mats.paint;
  const brassPalette = getBathroomBrassMaterials('BR');
  const brass = brassPalette.primary;

  groundGroup.add(stair.group);
  groundGroup.add(buildStairwellSteelTrimmer());

  // Fitted, interactive Georgian under-stairs cloak & boot cupboard
  groundGroup.add(
    buildUnderstairsCloakCupboard(ctx, hallTrimMat, mats.mahogany, brass, brassPalette.darkShadow)
  );

  // Galleried landing guard: runs down the open West edge of the stairwell and returns across its South end.
  const guard = createBalustradeRun({
    points: [[0.475, -0.47], [0.475, 2.62], [1.6, 2.62]],
    elevationY: FFL_FIRST,
    height: 0.92,
    newelCap: 'ball',
    spindleStyle: 'turned',
    includeStartNewel: false,
    includeEndNewel: true,
    includeTrimmerFascia: false,
    balustradeMaterial: landingTrimMat,
    handrailMaterial: mats.mahogany,
    newelCapMaterial: mats.mahogany,
    zone: 'houseLanding',
    name: 'simpleHouse.landingGuard',
  });
  firstGroup.add(guard.group);

  // Continuous Roger Oates flatweave herringbone wool runner along the 2.18 m galleried landing walkway
  const landingRunnerGeo = prepGeo(
    applyMetricBoxUVs(new THREE.BoxGeometry(0.94, 0.004, 5.05), { tileW: 0.94, tileH: 1.0 })
  );
  const landingRunner = new THREE.Mesh(landingRunnerGeo, mats.runner);
  landingRunner.name = 'simpleHouse.landing.rogerOatesRunner';
  landingRunner.position.set(-0.56, FFL_FIRST + 0.004, 1.15);
  landingRunner.receiveShadow = true;
  tagCollisionRole(landingRunner, 'ignore');
  firstGroup.add(landingRunner);

  // Classical Georgian moulded dado rail (Y = 0.92 m) & lower fielded wainscot panelling on West Hall & Landing walls
  groundGroup.add(
    buildWestWallWainscotDado({ name: 'simpleHouse.hall.westWainscotDado', zone: 'houseHall', floorY: FFL_GROUND, skirtingTopY: FFL_GROUND + 0.1665, zStart: -1.45, zEnd: 3.02, bayCount: 6, trimMat: hallTrimMat })
  );
  firstGroup.add(
    buildWestWallWainscotDado({ name: 'simpleHouse.landing.westWainscotDado', zone: 'houseLanding', floorY: FFL_FIRST, skirtingTopY: FFL_FIRST + 0.1435, zStart: -1.45, zEnd: 2.97, bayCount: 6, trimMat: landingTrimMat })
  );

  // Regency console table + gilt pier mirror centered on West Hall wall at Z = +1.05
  const consoleTable = buildGeorgianAntiqueCasework(ctx, { kind: 'serpentineConsole', name: 'simpleHouse.hall.console', position: [-1.39, FFL_GROUND + 0.002, 1.05], rotationY: Math.PI / 2 });
  const pierMirror = buildCuratedMirrorsArtAndRugs({ kind: 'regencyGiltPierMirror', name: 'simpleHouse.hall.pierMirror', position: [-1.646, FFL_GROUND + 0.96, 1.05], rotationY: Math.PI / 2 });
  const hurricane = buildWhiteCompanyAccessories({ kind: 'glassHurricane', name: 'simpleHouse.hall.hurricane', position: [-1.39, FFL_GROUND + 0.759, 0.78] });
  const diffuser = buildWhiteCompanyAccessories({ kind: 'reedDiffuser', name: 'simpleHouse.hall.diffuser', position: [-1.39, FFL_GROUND + 0.759, 1.32] });

  // Entrance coir threshold mat inside front door + aged-brass umbrella stand
  const coirMat = new THREE.MeshStandardMaterial({ name: 'simpleHouse.hall.coirDoormatMat', color: 0x9d8362, roughness: 0.95 });
  const coirBorderMat = new THREE.MeshStandardMaterial({ name: 'simpleHouse.hall.coirBorderMat', color: 0x3b352e, roughness: 0.9 });
  const doormatGroup = new THREE.Group();
  doormatGroup.name = 'simpleHouse.hall.coirDoormat';
  const dmOuter = addBox(doormatGroup, 'simpleHouse.hall.coirDoormat.border', [0.86, 0.006, 0.54], [0, FFL_GROUND + 0.005, 3.84], coirBorderMat, false);
  const dmPile = addBox(doormatGroup, 'simpleHouse.hall.coirDoormat.pile', [0.78, 0.004, 0.46], [0, FFL_GROUND + 0.011, 3.84], coirMat, false);
  dmOuter.receiveShadow = true;
  dmPile.receiveShadow = true;
  tagCollisionRole(doormatGroup, 'ignore');

  const umbrellaStand = new THREE.Group();
  umbrellaStand.name = 'simpleHouse.hall.brassUmbrellaStand';
  umbrellaStand.position.set(-1.34, FFL_GROUND + 0.002, 3.92);
  const standBase = new THREE.Mesh(sharedCylinderGeometry(0.125, 0.135, 0.028, 18), brass);
  standBase.name = 'simpleHouse.hall.brassUmbrellaStand.dripBase';
  standBase.position.y = 0.014;
  standBase.castShadow = true;
  const standTopRing = new THREE.Mesh(prepGeo(new THREE.TorusGeometry(0.118, 0.009, 10, 20)), brass);
  standTopRing.name = 'simpleHouse.hall.brassUmbrellaStand.topRing';
  standTopRing.rotation.x = Math.PI * 0.5;
  standTopRing.position.y = 0.54;
  umbrellaStand.add(standBase, standTopRing);
  for (let u = 0; u < 4; u++) {
    const ang = (u * Math.PI) / 2 + Math.PI * 0.25;
    const upright = new THREE.Mesh(sharedCylinderGeometry(0.007, 0.007, 0.51, 10), brass);
    upright.name = `simpleHouse.hall.brassUmbrellaStand.upright_${u + 1}`;
    upright.position.set(Math.cos(ang) * 0.112, 0.28, Math.sin(ang) * 0.112);
    umbrellaStand.add(upright);
  }
  const umbrellaCanopyMat = new THREE.MeshStandardMaterial({ name: 'simpleHouse.hall.umbrellaSilk', color: 0x28382f, roughness: 0.72 });
  for (const [idx, ox, oz, tiltX, tiltZ] of [[1, -0.03, -0.02, 0.09, -0.08], [2, 0.035, 0.025, -0.07, 0.1]] as const) {
    const stick = new THREE.Group();
    stick.name = `simpleHouse.hall.umbrella_${idx}`;
    stick.position.set(ox, 0.03, oz);
    stick.rotation.set(tiltX, 0, tiltZ);
    const shaft = new THREE.Mesh(sharedCylinderGeometry(0.008, 0.006, 0.76, 10), mats.mahogany);
    shaft.name = `${stick.name}.shaft`;
    shaft.position.y = 0.38;
    const canopy = new THREE.Mesh(sharedCylinderGeometry(0.032, 0.012, 0.46, 12), umbrellaCanopyMat);
    canopy.name = `${stick.name}.furl`;
    canopy.position.y = 0.36;
    const pommel = new THREE.Mesh(sharedSphereGeometry(0.017, 12, 10), brass);
    pommel.name = `${stick.name}.pommel`;
    pommel.position.y = 0.77;
    stick.add(shaft, canopy, pommel);
    umbrellaStand.add(stick);
  }

  groundGroup.add(consoleTable, pierMirror, hurricane, diffuser, doormatGroup, umbrellaStand);

  // West Hall radiator at Z = -0.55
  groundGroup.add(
    buildCastIronColumnRadiator({ name: 'simpleHouse.hall.radiator', zone: 'houseHall', cx: -1.48, floorY: FFL_GROUND + 0.002, cz: -0.55, width: 0.85, rotationY: 0, brassMat: brass })
  );

  // Galleried Landing South sash window (X = 0.00, W = 1.12) Roman blind & radiator
  const landingSouthCut = { axis: 'z' as const, coord: HALF_D - EXT_WALL_T * 0.5, minSpan: -HALF_W, maxSpan: HALF_W, floor: 'first' as const, outwardSide: 'south' as const };
  deconflictRomanBlind(
    buildWindowRomanBlind(ctx.scene, tagCutaway, {
      name: 'simpleHouse.landing.southRomanBlind',
      zone: 'houseLanding',
      centerX: 0,
      width: 1.12,
      railY: FFL_FIRST + 2.28,
      bottomY: FFL_FIRST + 1.88,
      wallFaceZ: HALF_D - EXT_WALL_T - 0.026,
      facingZ: -1,
      cutawayWall: landingSouthCut,
      parentGroup: firstGroup,
    }),
    -1
  );
  const landingRadiator = buildCastIronColumnRadiator({ name: 'simpleHouse.landing.radiator', zone: 'houseLanding', cx: 0, floorY: FFL_FIRST + 0.002, cz: HALF_D - EXT_WALL_T - 0.135, width: 0.96, height: 0.54, rotationY: Math.PI / 2, brassMat: brass });
  tagCutaway(landingRadiator, landingSouthCut);
  firstGroup.add(landingRadiator);

  // Twin fluted aged-brass wall sconces flanking console on West Hall wall (Z = +0.35, +1.75)
  for (const [tag, sz] of [['North', 0.35], ['South', 1.75]] as const) {
    groundGroup.add(
      buildHeritageInteriorLighting(ctx, { kind: 'coxFlutedSconce', name: `simpleHouse.hall.sconce${tag}`, position: [-1.646, FFL_GROUND + 1.68, sz], rotationY: Math.PI / 2, circuitId: 'houseHallSconces' as CircuitId, createPointLight: false })
    );
    ctx.addGlowPool('houseHallSconces' as CircuitId, -1.42, FFL_GROUND + 0.006, sz, 0.75, 0.22);
  }

  // Twin matching wall sconces on First-Floor Galleried Landing West wall (Z = +0.25, +1.95)
  for (const [tag, sz] of [['North', 0.25], ['South', 1.95]] as const) {
    firstGroup.add(
      buildHeritageInteriorLighting(ctx, { kind: 'coxFlutedSconce', name: `simpleHouse.landing.sconce${tag}`, position: [-1.646, FFL_FIRST + 1.65, sz], rotationY: Math.PI / 2, circuitId: 'houseHallSconces' as CircuitId, createPointLight: false })
    );
    ctx.addGlowPool('houseHallSconces' as CircuitId, -1.42, FFL_FIRST + 0.01, sz, 0.75, 0.22);
  }

  // Glazed aged-brass Hall & Landing hanging lanterns
  groundCeilingGroup.add(
    buildHeritageInteriorLighting(ctx, {
      kind: 'hallLantern',
      name: 'simpleHouse.hall.hangingLantern',
      position: [HALL_ROSE_XZ[0], GROUND_CEILING_SOFFIT_Y - 0.028, HALL_ROSE_XZ[1]],
      dropM: 0.42,
      circuitId: 'houseHallLantern' as CircuitId,
      createPointLight: true,
    })
  );
  firstCeilingGroup.add(
    buildHeritageInteriorLighting(ctx, {
      kind: 'hallLantern',
      name: 'simpleHouse.landing.hangingLantern',
      position: [LANDING_ROSE_XZ[0], FIRST_CEILING_SOFFIT_Y - 0.028, LANDING_ROSE_XZ[1]],
      dropM: 0.85,
      circuitId: 'houseStairPendant' as CircuitId,
      createPointLight: true,
    })
  );

  // Corston 4-gang switch plate + rotary sconce dimmer on West Hall pier (X = -1.648, Z = 2.75)
  const hallGangSwitchIds: Record<number, string> = { 1: 'sw-stair-bottom', 2: 'sw-hall-lantern', 3: 'sw-portico-lanterns', 4: 'sw-garden-lanterns' };
  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.hall.switchPlateBottom',
    switchPa: 'plate-hall-bottom',
    location: 'Entrance hall west pier',
    x: -1.648,
    y: FFL_GROUND + 1.15,
    z: 2.75,
    facing: 'east',
    mountedInZoneId: 'houseHall' as RoomZoneId,
    parentGroup: groundGroup,
    extraUserDataForGang: (gang): InteractiveUserData => ({ electricalSwitchId: hallGangSwitchIds[gang] }),
    gangs: [
      { gang: 1, zoneId: 'houseLanding' as RoomZoneId, label: 'Stairwell 2-Way (Bottom)', circuitId: 'houseStairPendant' as CircuitId },
      { gang: 2, zoneId: 'houseHall' as RoomZoneId, label: 'Hall Lantern & Cloak Cupboard', circuitId: 'houseHallLantern' as CircuitId },
      { gang: 3, zoneId: 'houseHall' as RoomZoneId, label: 'Portico Coach Lanterns', circuitId: 'housePorticoLanterns' as CircuitId },
      { gang: 4, zoneId: 'houseHall' as RoomZoneId, label: 'Rear Terrace Coach Lanterns', circuitId: 'houseGardenLanterns' as CircuitId },
    ],
  });

  const hallDimmer = new THREE.Group();
  hallDimmer.name = 'simpleHouse.hall.sconcesDimmer';
  hallDimmer.position.set(-1.648, FFL_GROUND + 1.02, 2.75);
  groundGroup.add(hallDimmer);
  addBox(hallDimmer, `${hallDimmer.name}.plate`, [0.005, 0.086, 0.086], [0.005, 0, 0], brass, false);
  const dimmerKnob = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.019, 0.021, 0.02, 18)),
    brassPalette.knurled
  );
  dimmerKnob.name = 'dimmer-hall-sconces';
  dimmerKnob.rotation.z = Math.PI * 0.5;
  dimmerKnob.position.set(0.018, 0, 0);
  dimmerKnob.userData = {
    type: 'dimmer',
    electricalDimmerId: 'dimmer-hall-sconces',
    zoneId: 'houseHall' as RoomZoneId,
    circuitId: 'houseHallSconces' as CircuitId,
  };
  ctx.interactiveMeshes.push(dimmerKnob);
  hallDimmer.add(dimmerKnob);

  // Corston 2-gang switch plate on Galleried Landing West wall (X = -1.648, Z = -1.15)
  const landingGangSwitchIds: Record<number, string> = { 1: 'sw-stair-top', 2: 'sw-hall-sconces' };
  buildCorstonToggleSwitch(ctx, {
    name: 'simpleHouse.landing.switchPlateTop',
    switchPa: 'plate-landing-top',
    location: 'Galleried landing head of stairs',
    x: -1.648,
    y: FFL_FIRST + 1.15,
    z: -1.15,
    facing: 'east',
    mountedInZoneId: 'houseLanding' as RoomZoneId,
    parentGroup: firstGroup,
    extraUserDataForGang: (gang): InteractiveUserData => ({ electricalSwitchId: landingGangSwitchIds[gang] }),
    gangs: [
      { gang: 1, zoneId: 'houseLanding' as RoomZoneId, label: 'Stairwell 2-Way (Top)', circuitId: 'houseStairPendant' as CircuitId },
      { gang: 2, zoneId: 'houseHall' as RoomZoneId, label: 'Hall & Landing Silk Sconces', circuitId: 'houseHallSconces' as CircuitId },
    ],
  });
}
