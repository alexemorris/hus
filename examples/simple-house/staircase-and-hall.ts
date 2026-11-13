import * as THREE from 'three';
import type { CircuitId } from 'husjs';
import { applyMetricBoxUVs, createRoomPaintScheme } from 'husjs/materials';
import {
  buildCastIronColumnRadiator,
  buildWindowRomanBlind,
  createBalustradeRun,
  createStaircase,
  prepGeo,
  sharedCylinderGeometry,
  sharedSphereGeometry,
  tagCutaway,
} from 'husjs/objects';
import { createHeritageFloorFinishMaterial } from 'husjs/catalog/architectural';
import {
  buildCuratedMirrorsArtAndRugs,
  buildGeorgianAntiqueCasework,
  buildWhiteCompanyAccessories,
} from 'husjs/catalog/furniture';
import { buildHeritageInteriorLighting } from 'husjs/catalog/lighting';
import { getBathroomBrassMaterials } from 'husjs/catalog/sanitaryware';
import type { SceneBuilderContext } from 'husjs/viewer';
import { EXT_WALL_T, FFL_FIRST, FFL_GROUND, FIRST_CEILING_SOFFIT_Y, GROUND_CEILING_SOFFIT_Y, HALF_D, HALF_W } from './electrical-and-rooms.ts';

export type SimpleHouseStair = ReturnType<typeof createStaircase>;

/** Flight hugs the East hall partition (`X ∈ [0.09, 1.13]`) and climbs North from `Z = +3.00` to `Z = -0.60`. */
export const STAIR_ORIGIN_XZ: readonly [number, number] = [0.61, 3.0];
export const STAIR_WIDTH_M = 1.04;
export const STAIR_GOING_M = 0.24;
export const HALL_ROSE_XZ: readonly [number, number] = [0, 3.6];
export const LANDING_ROSE_XZ: readonly [number, number] = [0.61, 1.2];

let stairMaterials: {
  readonly tread: THREE.Material;
  readonly paint: THREE.Material;
  readonly mahogany: THREE.Material;
  readonly runner: THREE.Material;
  readonly border: THREE.Material;
} | null = null;

function getStairMaterials() {
  if (!stairMaterials) {
    const hallScheme = createRoomPaintScheme({
      wallColor: 'slipper-satin',
      trimColor: 'wimborne-white',
      roomKind: 'hallway',
    });
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
 * curtail bottom step, two turned spindles per tread, mahogany handrail, understairs cupboard
 * spandrel and a Roger Oates flatweave herringbone wool runner held by 15 brass stair rods.
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
    curtailBottomStep: 'left',
    spindlesPerTread: 2,
    newelCap: 'ball',
    spindleStyle: 'turned',
    spandrel: 'cupboard',
    runner: {
      width: 0.64,
      material: mats.runner,
      borderMaterial: mats.border,
      borderWidth: 0.045,
      stairRods: true,
    },
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

export function buildSimpleHouseStaircaseAndHall(ctx: SceneBuilderContext, stair: SimpleHouseStair): void {
  const groundGroup = ctx.floor ? ctx.floor('ground').group : ctx.scene;
  const groundCeilingGroup = ctx.floor ? ctx.floor('ground').ceilingGroup : ctx.groundFloorCeilingGroup;
  const firstGroup = ctx.floor ? ctx.floor('first').group : ctx.firstFloorMeshGroup;
  const firstCeilingGroup = ctx.floor ? ctx.floor('first').ceilingGroup : ctx.ceilingMeshGroup;
  const mats = getStairMaterials();
  const brass = getBathroomBrassMaterials('BR').primary;

  groundGroup.add(stair.group);

  // Galleried landing guard: runs down the open West edge of the stairwell and returns across its South end.
  const guard = createBalustradeRun({
    points: [
      [0.035, -0.47],
      [0.035, 2.62],
      [1.1, 2.62],
    ],
    elevationY: FFL_FIRST,
    height: 0.92,
    newelCap: 'ball',
    spindleStyle: 'turned',
    includeStartNewel: false,
    includeEndNewel: true,
    includeTrimmerFascia: false,
    balustradeMaterial: mats.paint,
    handrailMaterial: mats.mahogany,
    newelCapMaterial: mats.mahogany,
    zone: 'houseLanding',
    name: 'simpleHouse.landingGuard',
  });
  firstGroup.add(guard.group);

  // Continuous Roger Oates flatweave herringbone wool runner along the galleried landing walkway (West of stair void)
  const landingRunnerGeo = prepGeo(
    applyMetricBoxUVs(new THREE.BoxGeometry(0.68, 0.006, 4.95), {
      tileW: 0.68,
      tileH: 1.0,
    })
  );
  const landingRunner = new THREE.Mesh(landingRunnerGeo, mats.runner);
  landingRunner.name = 'simpleHouse.landing.rogerOatesRunner';
  landingRunner.position.set(-0.56, FFL_FIRST + 0.004, 1.15);
  landingRunner.receiveShadow = true;
  firstGroup.add(landingRunner);

  // Hall furnishings along the West wall (interior face X = -1.15).
  const consoleTable = buildGeorgianAntiqueCasework(ctx, {
    kind: 'serpentineConsole',
    name: 'simpleHouse.hall.console',
    position: [-0.9, FFL_GROUND, 2.65],
    rotationY: Math.PI / 2,
  });
  const pierMirror = buildCuratedMirrorsArtAndRugs({
    kind: 'regencyGiltPierMirror',
    name: 'simpleHouse.hall.pierMirror',
    position: [-1.146, FFL_GROUND + 0.96, 2.65],
    rotationY: Math.PI / 2,
  });
  const hurricane = buildWhiteCompanyAccessories({
    kind: 'glassHurricane',
    name: 'simpleHouse.hall.hurricane',
    position: [-0.9, FFL_GROUND + 0.756, 2.4],
  });
  const diffuser = buildWhiteCompanyAccessories({
    kind: 'reedDiffuser',
    name: 'simpleHouse.hall.diffuser',
    position: [-0.9, FFL_GROUND + 0.756, 2.92],
  });
  // Entrance coir threshold mat inside front door + aged-brass umbrella stand & heritage walking sticks
  const coirMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.hall.coirDoormatMat',
    color: 0x9d8362,
    roughness: 0.95,
  });
  const coirBorderMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.hall.coirBorderMat',
    color: 0x3b352e,
    roughness: 0.9,
  });
  const doormatGroup = new THREE.Group();
  doormatGroup.name = 'simpleHouse.hall.coirDoormat';
  const dmOuter = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.86, 0.008, 0.54)), coirBorderMat);
  dmOuter.name = 'simpleHouse.hall.coirDoormat.border';
  dmOuter.position.set(0, FFL_GROUND + 0.004, 3.84);
  dmOuter.receiveShadow = true;
  const dmPile = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.78, 0.004, 0.46)), coirMat);
  dmPile.name = 'simpleHouse.hall.coirDoormat.pile';
  dmPile.position.set(0, FFL_GROUND + 0.009, 3.84);
  dmPile.receiveShadow = true;
  doormatGroup.add(dmOuter, dmPile);

  const umbrellaStand = new THREE.Group();
  umbrellaStand.name = 'simpleHouse.hall.brassUmbrellaStand';
  umbrellaStand.position.set(-0.88, FFL_GROUND + 0.001, 3.74);
  const standBase = new THREE.Mesh(sharedCylinderGeometry(0.125, 0.135, 0.028, 18), brass);
  standBase.name = 'simpleHouse.hall.brassUmbrellaStand.dripBase';
  standBase.position.y = 0.014;
  standBase.castShadow = true;
  const standTopRing = new THREE.Mesh(
    prepGeo(new THREE.TorusGeometry(0.118, 0.009, 10, 20)),
    brass
  );
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
  const umbrellaCanopyMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.hall.umbrellaSilk',
    color: 0x28382f,
    roughness: 0.72,
  });
  for (const [idx, ox, oz, tiltX, tiltZ] of [
    [1, -0.03, -0.02, 0.09, -0.08],
    [2, 0.035, 0.025, -0.07, 0.1],
  ] as const) {
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

  // Tailored oatmeal-linen Roman blind on Galleried Landing South sash window
  const landingSouthCut = {
    axis: 'z' as const,
    coord: HALF_D - EXT_WALL_T * 0.5,
    minSpan: -HALF_W,
    maxSpan: HALF_W,
    floor: 'first' as const,
    outwardSide: 'south' as const,
  };
  deconflictRomanBlind(buildWindowRomanBlind(ctx.scene, tagCutaway, {
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
  }), -1);

  groundGroup.add(consoleTable, pierMirror, hurricane, diffuser, doormatGroup, umbrellaStand);

  groundGroup.add(
    buildCastIronColumnRadiator({
      name: 'simpleHouse.hall.radiator',
      zone: 'houseHall',
      cx: -1.035,
      floorY: FFL_GROUND,
      cz: -0.45,
      width: 0.85,
      rotationY: 0,
      brassMat: brass,
    })
  );

  groundCeilingGroup.add(
    buildHeritageInteriorLighting(ctx, {
      kind: 'hallLantern',
      name: 'simpleHouse.hall.lantern',
      position: [HALL_ROSE_XZ[0], GROUND_CEILING_SOFFIT_Y - 0.04, HALL_ROSE_XZ[1]],
      dropM: 0.42,
      circuitId: 'houseHallLantern' as CircuitId,
    })
  );
  firstCeilingGroup.add(
    buildHeritageInteriorLighting(ctx, {
      kind: 'hallLantern',
      name: 'simpleHouse.landing.lantern',
      position: [LANDING_ROSE_XZ[0], FIRST_CEILING_SOFFIT_Y - 0.04, LANDING_ROSE_XZ[1]],
      dropM: 0.85,
      circuitId: 'houseStairPendant' as CircuitId,
    })
  );
}
