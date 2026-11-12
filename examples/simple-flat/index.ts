import * as THREE from 'three';
import {
  defineHouse,
  gradePad,
  type CutawayWallDescriptor,
  type ElectricalSystemOptions,
  type FloorDefinition,
  type HouseDefinition,
  type RoomManifestEntry,
  type RoomZoneDefinition,
  type TwinRoomNavGroup,
} from 'husjs';
import {
  attachAudioEmitter,
  buildCastIronColumnRadiator,
  buildCorstonPowerSocket,
  buildCorstonToggleSwitch,
  buildHollowCabinetCarcass,
  buildHollowWardrobeInterior,
  createCorniceRun,
  createEngineeredOakFloorTextures,
  createSkirtingRun,
  extrudePlanarSolidWithHoles,
  mouldingPath,
  prepGeo,
  registerHingedDoor,
  tagCutaway,
} from 'husjs/objects';
import {
  buildCoxDanicaBed,
  createSculptedCushionGeometry,
} from 'husjs/catalog/furniture';
import {
  buildArmstrongConcealedShowerSet,
  buildLefroyBrooksCharterhouseWc,
  buildLefroyBrooksLissaDoonWashstand,
  getBathroomBrassMaterials,
  wallFacingToRotY,
} from 'husjs/catalog/sanitaryware';
import type {
  CameraPresetDefinition,
  LightCircuitGroup,
  SceneBuilderContext,
  SceneZoneModule,
} from 'husjs/viewer';

/**
 * Stage 4.3 — `examples/simple-flat` (~450 LOC)
 * 1-bedroom single-floor apartment (`8.4 × 6.8 m`, `level-0` only -> floor switcher auto-hides),
 * exercising conventional mains `ElectricalSystem` (2-way hallway travellers, 1-way rockers,
 * rotary living dimmer), `husjs/objects` CAD/joinery primitives, and `urban` soundscape occlusion.
 */

export const SIMPLE_FLAT_FLOORS: readonly FloorDefinition[] = [
  {
    id: 'level-0',
    label: 'Apartment',
    shortLabel: 'Flat',
    order: 0,
    elevationY: 0,
    elevationM: 0,
    ceilingCutawayY: 2.75,
  },
];

const WALL_H = 2.75;
const EXT_T = 0.24;
const INT_T = 0.12;

export const SIMPLE_FLAT_ELECTRICAL: ElectricalSystemOptions = {
  wallPlates: [
    {
      plateId: 'plate-hall-entry',
      name: 'Entrance Hall Switch',
      mountedInZoneId: 'flatHall',
      location: 'Entrance door jamb',
      gangs: [{ gang: 1, id: 'sw-hall-entry', zoneId: 'flatHall', label: 'Hall 2-Way A', initialPose: 'down' }],
    },
    {
      plateId: 'plate-hall-inner',
      name: 'Inner Hall Switch',
      mountedInZoneId: 'flatHall',
      location: 'Living/Bedroom junction',
      gangs: [{ gang: 1, id: 'sw-hall-inner', zoneId: 'flatHall', label: 'Hall 2-Way B', initialPose: 'up' }],
    },
    {
      plateId: 'plate-bedroom',
      name: 'Bedroom Rocker',
      mountedInZoneId: 'flatBedroom',
      location: 'Bedroom latch jamb',
      gangs: [{ gang: 1, id: 'sw-bedroom', zoneId: 'flatBedroom', label: 'Bedroom Pendant', initialPose: 'down' }],
    },
    {
      plateId: 'plate-bathroom',
      name: 'Bathroom Rocker',
      mountedInZoneId: 'flatHall',
      location: 'Outside bathroom jamb',
      gangs: [{ gang: 1, id: 'sw-bathroom', zoneId: 'flatBathroom', label: 'Bathroom Spots', initialPose: 'down' }],
    },
    {
      plateId: 'plate-kitchen',
      name: 'Kitchen Task Switch',
      mountedInZoneId: 'flatLivingKitchen',
      location: 'Kitchen splashback',
      gangs: [{ gang: 1, id: 'sw-kitchen-task', zoneId: 'flatLivingKitchen', label: 'Worktop Strip', initialPose: 'down' }],
    },
  ],
  dimmers: [
    { id: 'dimmer-living', zoneId: 'flatLivingKitchen', label: 'Living Rotary Dimmer', initialLevel: 0.78, minLevel: 0.08, enabled: true },
  ],
  circuits: [
    { id: 'flatHallPendant', name: 'Hallway Traveller Pendant', zoneId: 'flatHall', floorId: 'level-0', kind: 'pendants', dimmable: false, wiring: { kind: 'two-way', switches: ['sw-hall-entry', 'sw-hall-inner'] } },
    { id: 'flatLivingPendants', name: 'Living & Dining Pendants', zoneId: 'flatLivingKitchen', floorId: 'level-0', kind: 'pendants', dimmable: true, wiring: { kind: 'dimmer', dimmerId: 'dimmer-living' } },
    { id: 'flatKitchenTask', name: 'Kitchen Worktop Strip', zoneId: 'flatLivingKitchen', floorId: 'level-0', kind: 'task', dimmable: false, wiring: { kind: 'one-way', switchId: 'sw-kitchen-task' } },
    { id: 'flatBedroomPendant', name: 'Bedroom Linen Pendant', zoneId: 'flatBedroom', floorId: 'level-0', kind: 'pendants', dimmable: false, wiring: { kind: 'one-way', switchId: 'sw-bedroom' } },
    { id: 'flatBathroomSpots', name: 'Bathroom Downlights', zoneId: 'flatBathroom', floorId: 'level-0', kind: 'downlights', dimmable: false, wiring: { kind: 'one-way', switchId: 'sw-bathroom' } },
  ],
  zones: [
    {
      id: 'flatLivingKitchen',
      name: 'Open-Plan Living & Kitchen',
      circuits: ['flatLivingPendants', 'flatKitchenTask'],
      scenes: [
        { id: 'bright', label: 'Bright', levels: { flatLivingPendants: 1.0, flatKitchenTask: 1.0 } },
        { id: 'evening', label: 'Evening', levels: { flatLivingPendants: 0.42, flatKitchenTask: 1.0 } },
      ],
    },
    { id: 'flatHall', name: 'Entrance Hall', circuits: ['flatHallPendant'], scenes: [{ id: 'on', label: 'Welcome', levels: { flatHallPendant: 1.0 } }] },
    { id: 'flatBedroom', name: 'Bedroom', circuits: ['flatBedroomPendant'], scenes: [{ id: 'rest', label: 'Rest', levels: { flatBedroomPendant: 1.0 } }] },
    { id: 'flatBathroom', name: 'Shower Room', circuits: ['flatBathroomSpots'], scenes: [{ id: 'fresh', label: 'Fresh', levels: { flatBathroomSpots: 1.0 } }] },
  ],
};

const ROOM_ZONES: Readonly<Record<string, RoomZoneDefinition>> = {
  flatLivingKitchen: { id: 'flatLivingKitchen', name: 'Open-Plan Living & Kitchen', shortName: 'Living / Kitchen', buildingId: 'mainHouse', floorId: 'level-0', knxAreaLine: '1.1', isInterior: true, bounds: { minX: -0.6, maxX: 4.2, minY: 0, maxY: WALL_H, minZ: -3.4, maxZ: 3.4 }, floorSurface: 'wood', volumeM3: 88, primarySurface: 'timber' },
  flatHall: { id: 'flatHall', name: 'Entrance Hall', shortName: 'Hall', buildingId: 'mainHouse', floorId: 'level-0', knxAreaLine: '1.1', isInterior: true, bounds: { minX: -2.2, maxX: -0.6, minY: 0, maxY: WALL_H, minZ: 1.1, maxZ: 3.4 }, floorSurface: 'wood', volumeM3: 18, primarySurface: 'plaster' },
  flatBedroom: { id: 'flatBedroom', name: 'Bedroom', shortName: 'Bedroom', buildingId: 'mainHouse', floorId: 'level-0', knxAreaLine: '1.1', isInterior: true, bounds: { minX: -4.2, maxX: -0.6, minY: 0, maxY: WALL_H, minZ: -3.4, maxZ: 1.1 }, floorSurface: 'wood', volumeM3: 44, primarySurface: 'carpet' },
  flatBathroom: { id: 'flatBathroom', name: 'Shower Room', shortName: 'Bathroom', buildingId: 'mainHouse', floorId: 'level-0', knxAreaLine: '1.1', isInterior: true, bounds: { minX: -4.2, maxX: -2.2, minY: 0, maxY: WALL_H, minZ: 1.1, maxZ: 3.4 }, floorSurface: 'stone', volumeM3: 13, primarySurface: 'tile' },
};

const MANIFEST: readonly RoomManifestEntry[] = [
  { zoneId: 'flatLivingKitchen', label: 'Living & Kitchen', group: 'apartment', floor: 'level-0', lights: [{ circuitId: 'flatLivingPendants', label: 'Living Pendants (Dimmer)', dimmable: true }, { circuitId: 'flatKitchenTask', label: 'Kitchen Under-Cabinet', dimmable: false }], scenes: [], devices: [{ interactableId: 'flatBalconyDoor', label: 'Juliet Balcony Door' }] },
  { zoneId: 'flatHall', label: 'Entrance Hall', group: 'apartment', floor: 'level-0', lights: [{ circuitId: 'flatHallPendant', label: 'Hallway 2-Way Pendant', dimmable: false }], scenes: [], devices: [] },
  { zoneId: 'flatBedroom', label: 'Bedroom', group: 'apartment', floor: 'level-0', lights: [{ circuitId: 'flatBedroomPendant', label: 'Bedroom Pendant', dimmable: false }], scenes: [], devices: [{ interactableId: 'flatBedroomDoor', label: 'Bedroom Door' }] },
  { zoneId: 'flatBathroom', label: 'Shower Room', group: 'apartment', floor: 'level-0', lights: [{ circuitId: 'flatBathroomSpots', label: 'Shower Downlights', dimmable: false }], scenes: [], devices: [{ interactableId: 'flatBathroomDoor', label: 'Bathroom Door' }] },
];

const NAV_TREE: readonly TwinRoomNavGroup[] = [{ id: 'apartment', label: 'Apartment', rooms: MANIFEST }];

function bindPendant(ctx: SceneBuilderContext, parent: THREE.Object3D, circuitId: string, pos: readonly [number, number, number], hex: number, r = 0.16): void {
  const grp = (ctx.lightGroups as Record<string, LightCircuitGroup>)[circuitId];
  const mat = new THREE.MeshStandardMaterial({ color: 0xf7f2e8, emissive: new THREE.Color(hex), emissiveIntensity: 1.2, roughness: 0.4 });
  const cordTopY = WALL_H - 0.001;
  const cord = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.006, 0.006, cordTopY - pos[1], 8)), new THREE.MeshStandardMaterial({ color: 0x262626 }));
  cord.position.set(pos[0], (cordTopY + pos[1]) * 0.5, pos[2]);
  const shade = new THREE.Mesh(prepGeo(new THREE.SphereGeometry(r, 18, 12)), mat);
  shade.name = `fixture.${circuitId}`;
  shade.position.set(pos[0], pos[1], pos[2]);
  const pl = new THREE.PointLight(hex, 2.2, 7.5, 2);
  pl.position.set(pos[0], pos[1] - 0.08, pos[2]);
  parent.add(cord, shade, pl);
  if (grp) {
    grp.emissives.push(mat);
    grp.lights.push(pl);
  }
  ctx.addGlowPool(circuitId as never, pos[0], 0.008, pos[2], 1.2, 0.22);
}

function addWindow(parent: THREE.Object3D, name: string, cx: number, cy: number, cz: number, w: number, h: number, rotY: number, frameMat: THREE.Material, glassMat: THREE.Material, cutaway?: CutawayWallDescriptor): void {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(cx, cy, cz);
  g.rotation.y = rotY;
  const fw = w - 0.002;
  const fh = h - 0.002;
  const b = 0.048;
  const mullionW = b * 0.8;
  const innerH = fh - 2 * b - 0.001;
  for (const [pw, ph, px, py] of [
    [fw, b, 0, fh / 2 - b / 2],
    [fw, b, 0, -fh / 2 + b / 2],
    [b, innerH, -fw / 2 + b / 2, 0],
    [b, innerH, fw / 2 - b / 2, 0],
    [mullionW, innerH, 0, 0],
  ] as const) {
    const m = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(pw, ph, 0.09)), frameMat);
    m.position.set(px, py, 0);
    m.castShadow = true;
    g.add(m);
  }
  const paneW = (fw - 2 * b - mullionW) * 0.5 - 0.002;
  const paneH = innerH - 0.001;
  const paneOffsetX = mullionW * 0.5 + paneW * 0.5 + 0.001;
  const paneL = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(paneW, paneH, 0.014)), glassMat);
  paneL.name = `${name}.glass`;
  paneL.position.x = -paneOffsetX;
  const paneR = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(paneW, paneH, 0.014)), glassMat);
  paneR.name = `${name}.glassRight`;
  paneR.position.x = paneOffsetX;
  g.add(paneL, paneR);
  if (cutaway) tagCutaway(g, cutaway);
  parent.add(g);
}

const SIMPLE_FLAT_MODULE: SceneZoneModule = {
  id: 'simple-flat-shell',
  name: 'Copenhagen Urban Flat',
  buildingId: 'mainHouse',
  floorId: 'level-0',
  zoneIds: ['flatLivingKitchen', 'flatHall', 'flatBedroom', 'flatBathroom'],
  interiorBounds: Object.values(ROOM_ZONES).map((r) => r.bounds),
  cameraPresets: [
    { id: 'overview', label: 'Apartment Cutaway', buildingId: 'mainHouse', floorViewMode: 'level-0', pos: new THREE.Vector3(7.4, 7.6, 8.6), target: new THREE.Vector3(0.2, 1.0, 0.0) },
    { id: 'livingRoom', label: 'Living & Kitchen', buildingId: 'mainHouse', zoneId: 'flatLivingKitchen', floorViewMode: 'level-0', pos: new THREE.Vector3(0.2, 1.65, 2.7), target: new THREE.Vector3(2.2, 1.15, -0.9) },
    { id: 'mainBedroom', label: 'Bedroom', buildingId: 'mainHouse', zoneId: 'flatBedroom', floorViewMode: 'level-0', pos: new THREE.Vector3(-1.1, 1.6, 0.6), target: new THREE.Vector3(-3.1, 0.95, -2.0) },
  ] satisfies readonly CameraPresetDefinition[],
  build(ctx: SceneBuilderContext) {
    const root = new THREE.Group();
    root.name = 'simpleFlat.root';
    ctx.scene.add(root);

    const oakTex = createEngineeredOakFloorTextures();
    const plasterMat = new THREE.MeshStandardMaterial({ color: 0xf2eee6, roughness: 0.86 });
    const facadeMat = new THREE.MeshStandardMaterial({ color: 0xd9cfc1, roughness: 0.78 });
    const oakMat = new THREE.MeshStandardMaterial({ map: oakTex.colorMap, bumpMap: oakTex.bumpMap, bumpScale: 0.004, roughness: 0.56 });
    const tileMat = new THREE.MeshStandardMaterial({ color: 0xd9deda, roughness: 0.42 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x26292c, roughness: 0.4, metalness: 0.5 });
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xdff0f5, transparent: true, opacity: 0.26, roughness: 0.06, transmission: 0.72 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0xf7f5f0, roughness: 0.55 });
    const brassMats = getBathroomBrassMaterials('SB');

    const plinth = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(9.2, 0.218, 7.6)), new THREE.MeshStandardMaterial({ color: 0x8a8780, roughness: 0.9 }));
    plinth.position.set(0, -0.151, 0);
    plinth.receiveShadow = true;
    const floor = new THREE.Mesh(
      extrudePlanarSolidWithHoles({
        outer: [[-4.2, -3.4], [4.2, -3.4], [4.2, 3.4], [-2.199, 3.4], [-2.199, 1.099], [-4.2, 1.099]],
        origin: [0, 0, 0],
        uAxis: [1, 0, 0],
        vAxis: [0, 0, 1],
        wAxis: [0, 1, 0],
        depthRange: [-0.04, -0.0006],
      }),
      oakMat
    );
    floor.receiveShadow = true;
    const bathFloor = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(1.999, 0.0394, 2.299)), tileMat);
    bathFloor.position.set(-3.2005, -0.0203, 2.2505);
    bathFloor.receiveShadow = true;
    root.add(plinth, floor, bathFloor);

    const ceiling = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(8.6, 0.14, 7.0)), plasterMat);
    ceiling.position.set(0, WALL_H + 0.071, 0);
    ctx.ceilingMeshGroup.add(ceiling);

    // Exterior cutaway walls via extrudePlanarSolidWithHoles
    const wallBaseY = 0.0005;
    const extMaxX = 4.2 + EXT_T;
    const northCut: CutawayWallDescriptor = { axis: 'z', coord: -3.4, minSpan: -extMaxX, maxSpan: extMaxX, floor: 'level-0', outwardSide: 'north' };
    const northWall = new THREE.Mesh(
      extrudePlanarSolidWithHoles({
        outer: [[-extMaxX, wallBaseY], [extMaxX, wallBaseY], [extMaxX, WALL_H], [-extMaxX, WALL_H]],
        holes: [[[-3.3, 0.85], [-1.5, 0.85], [-1.5, 2.25], [-3.3, 2.25]], [[0.8, 0.95], [2.9, 0.95], [2.9, 2.25], [0.8, 2.25]]],
        origin: [0, 0, -3.4],
        depthRange: [-EXT_T, 0],
      }),
      plasterMat
    );
    northWall.castShadow = true;
    tagCutaway(northWall, northCut);
    root.add(northWall);
    addWindow(root, 'flat.win.bedN', -2.4, 1.55, -3.52, 1.8, 1.4, 0, darkMat, glassMat, northCut);
    addWindow(root, 'flat.win.kitN', 1.85, 1.6, -3.52, 2.1, 1.3, 0, darkMat, glassMat, northCut);

    const southCut: CutawayWallDescriptor = { axis: 'z', coord: 3.4, minSpan: -extMaxX, maxSpan: extMaxX, floor: 'level-0', outwardSide: 'south' };
    const southWall = new THREE.Mesh(
      extrudePlanarSolidWithHoles({
        outer: [
          [-extMaxX, wallBaseY], [-1.95, wallBaseY], [-1.95, 2.15], [-1.0, 2.15], [-1.0, wallBaseY],
          [0.85, wallBaseY], [0.85, 2.3], [2.65, 2.3], [2.65, wallBaseY], [extMaxX, wallBaseY],
          [extMaxX, WALL_H], [-extMaxX, WALL_H],
        ],
        origin: [0, 0, 3.4],
        depthRange: [0, EXT_T],
      }),
      facadeMat
    );
    southWall.castShadow = true;
    tagCutaway(southWall, southCut);
    root.add(southWall);

    // Interactive glazed Juliet balcony door (exterior acoustic portal)
    const balconyLeaf = new THREE.Group();
    balconyLeaf.name = 'flatBalconyDoor';
    const doorW = 0.896;
    const doorH = 2.26;
    const doorFrameW = 0.068;
    const doorRailH = 0.105;
    const doorStileL = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(doorFrameW, doorH, 0.055)), darkMat);
    doorStileL.position.set(-doorW * 0.5 + doorFrameW * 0.5, doorH * 0.5, 0);
    const doorStileR = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(doorFrameW, doorH, 0.055)), darkMat);
    doorStileR.position.set(doorW * 0.5 - doorFrameW * 0.5, doorH * 0.5, 0);
    const innerDoorW = doorW - 2 * doorFrameW - 0.001;
    const doorRailTop = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(innerDoorW, doorRailH, 0.055)), darkMat);
    doorRailTop.position.set(0, doorH - doorRailH * 0.5, 0);
    const doorRailBot = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(innerDoorW, doorRailH, 0.055)), darkMat);
    doorRailBot.position.set(0, doorRailH * 0.5, 0);
    const bGlass = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(innerDoorW - 0.001, doorH - 2 * doorRailH - 0.002, 0.02)), glassMat);
    bGlass.name = 'flatBalconyDoor.glass';
    bGlass.position.y = doorH * 0.5;
    balconyLeaf.add(doorStileL, doorStileR, doorRailTop, doorRailBot, bGlass);
    balconyLeaf.position.set(1.3, 0.02, 3.44);
    tagCutaway(balconyLeaf, southCut);
    root.add(balconyLeaf);
    registerHingedDoor(ctx, { parent: root, door: balconyLeaf, hingeOffset: [-0.45, 0, 0], axis: 'y', openAngle: -1.45 });
    addWindow(root, 'flat.win.balconyFixed', 2.2, 1.15, 3.44, 0.896, 2.28, 0, darkMat, glassMat, southCut);

    const entryDoor = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.93, 2.13, 0.05)), new THREE.MeshStandardMaterial({ color: 0x3b4a43, roughness: 0.48 }));
    entryDoor.position.set(-1.475, 1.075, 3.45);
    tagCutaway(entryDoor, southCut);
    root.add(entryDoor);

    const eastCut: CutawayWallDescriptor = { axis: 'x', coord: 4.2, minSpan: -3.5, maxSpan: 3.5, floor: 'level-0', outwardSide: 'east' };
    const eastWall = new THREE.Mesh(
      extrudePlanarSolidWithHoles({
        outer: [[-3.3995, wallBaseY], [3.3995, wallBaseY], [3.3995, WALL_H], [-3.3995, WALL_H]],
        holes: [[[-0.9, 0.75], [1.6, 0.75], [1.6, 2.25], [-0.9, 2.25]]],
        origin: [4.2, 0, 0],
        uAxis: [0, 0, 1],
        vAxis: [0, 1, 0],
        wAxis: [1, 0, 0],
        depthRange: [0, EXT_T],
      }),
      plasterMat
    );
    eastWall.castShadow = true;
    tagCutaway(eastWall, eastCut);
    root.add(eastWall);
    addWindow(root, 'flat.win.east', 4.32, 1.5, 0.35, 2.5, 1.5, Math.PI / 2, darkMat, glassMat, eastCut);

    const westCut: CutawayWallDescriptor = { axis: 'x', coord: -4.2, minSpan: -3.5, maxSpan: 3.5, floor: 'level-0', outwardSide: 'west' };
    const westWall = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(EXT_T, WALL_H - wallBaseY, 6.799)), plasterMat);
    westWall.position.set(-4.2 - EXT_T / 2, (WALL_H + wallBaseY) * 0.5, 0);
    westWall.castShadow = true;
    tagCutaway(westWall, westCut);
    root.add(westWall);

    // Interior walls + hinged bedroom/bathroom doors
    const spine = new THREE.Mesh(
      extrudePlanarSolidWithHoles({
        outer: [
          [-3.3995, wallBaseY], [1.45, wallBaseY], [1.45, 2.15], [2.45, 2.15],
          [2.45, wallBaseY], [3.3995, wallBaseY], [3.3995, WALL_H], [-3.3995, WALL_H],
        ],
        origin: [-0.6, 0, 0],
        uAxis: [0, 0, 1],
        vAxis: [0, 1, 0],
        wAxis: [1, 0, 0],
        depthRange: [-INT_T / 2, INT_T / 2],
      }),
      plasterMat
    );
    const bedPartMaxX = -0.6 - INT_T / 2 - 0.0005;
    const bedPart = new THREE.Mesh(
      extrudePlanarSolidWithHoles({
        outer: [
          [-4.1995, wallBaseY], [-1.75, wallBaseY], [-1.75, 2.1], [-0.9, 2.1],
          [-0.9, wallBaseY], [bedPartMaxX, wallBaseY], [bedPartMaxX, WALL_H], [-4.1995, WALL_H],
        ],
        origin: [0, 0, 1.1],
        depthRange: [-INT_T / 2, INT_T / 2],
      }),
      plasterMat
    );
    const bathPartMinZ = 1.1 + INT_T / 2 + 0.0005;
    const bathPart = new THREE.Mesh(
      extrudePlanarSolidWithHoles({
        outer: [
          [bathPartMinZ, wallBaseY], [1.45, wallBaseY], [1.45, 2.1], [2.2, 2.1],
          [2.2, wallBaseY], [3.3995, wallBaseY], [3.3995, WALL_H], [bathPartMinZ, WALL_H],
        ],
        origin: [-2.2, 0, 0],
        uAxis: [0, 0, 1],
        vAxis: [0, 1, 0],
        wAxis: [1, 0, 0],
        depthRange: [-INT_T / 2, INT_T / 2],
      }),
      plasterMat
    );
    spine.castShadow = bedPart.castShadow = bathPart.castShadow = true;
    root.add(spine, bedPart, bathPart);

    const livingPath = () =>
      mouldingPath
        .startAt(-0.6 + INT_T / 2, -3.4, { y: 0.001, roomSide: 'right' })
        .lineTo(4.2, -3.4)
        .lineTo(4.2, 3.4)
        .lineTo(-0.6 + INT_T / 2, 3.4)
        .close();
    const hallPts: readonly (readonly [number, number])[] = [
      [-2.2 + INT_T / 2, 1.1 + INT_T / 2],
      [-0.6 - INT_T / 2, 1.1 + INT_T / 2],
      [-0.6 - INT_T / 2, 3.4],
      [-2.2 + INT_T / 2, 3.4],
    ];
    const bedroomPts: readonly (readonly [number, number])[] = [
      [-4.2, -3.4],
      [-0.6 - INT_T / 2, -3.4],
      [-0.6 - INT_T / 2, 1.1 - INT_T / 2],
      [-4.2, 1.1 - INT_T / 2],
    ];
    const bathroomPts: readonly (readonly [number, number])[] = [
      [-4.2, 1.1 + INT_T / 2],
      [-2.2 - INT_T / 2, 1.1 + INT_T / 2],
      [-2.2 - INT_T / 2, 3.4],
      [-4.2, 3.4],
    ];

    root.add(
      createSkirtingRun({
        name: 'flat.living.skirting',
        zone: 'flatLivingKitchen',
        path: livingPath(),
        profile: 'chamfered',
        height: 0.105,
        thickness: 0.018,
        material: trimMat,
        gaps: [
          { box: { minX: -0.16, maxX: 3.67, minZ: -3.5, maxZ: -3.3 }, cap: 'selfReturn' },
          { box: { minX: 0.83, maxX: 2.67, minZ: 3.3, maxZ: 3.5 }, cap: 'selfReturn' },
          { box: { minX: -0.64, maxX: -0.44, minZ: 1.43, maxZ: 2.47 }, cap: 'selfReturn' },
        ],
        cutawayWalls: [northCut, eastCut, southCut],
        floor: 'level-0',
      }),
      createSkirtingRun({
        name: 'flat.hall.skirting',
        zone: 'flatHall',
        points: hallPts,
        closed: true,
        roomSide: 'right',
        elevationY: 0.001,
        profile: 'chamfered',
        height: 0.105,
        thickness: 0.016,
        material: trimMat,
        gaps: [
          { box: { minX: -1.78, maxX: -0.88, minZ: 1.06, maxZ: 1.24 }, cap: 'selfReturn' },
          { box: { minX: -0.74, maxX: -0.58, minZ: 1.43, maxZ: 2.47 }, cap: 'selfReturn' },
          { box: { minX: -1.97, maxX: -0.98, minZ: 3.3, maxZ: 3.5 }, cap: 'selfReturn' },
          { box: { minX: -2.22, maxX: -2.06, minZ: 1.42, maxZ: 2.23 }, cap: 'selfReturn' },
        ],
        cutawayWalls: [southCut],
        floor: 'level-0',
      }),
      createSkirtingRun({
        name: 'flat.bedroom.skirting',
        zone: 'flatBedroom',
        points: bedroomPts,
        closed: true,
        roomSide: 'right',
        elevationY: 0.001,
        profile: 'chamfered',
        height: 0.105,
        thickness: 0.018,
        material: trimMat,
        gaps: [
          { box: { minX: -3.92, maxX: -2.28, minZ: -3.5, maxZ: -3.3 }, cap: 'selfReturn' },
          { box: { minX: -1.78, maxX: -0.88, minZ: 0.96, maxZ: 1.12 }, cap: 'selfReturn' },
        ],
        cutawayWalls: [northCut, westCut],
        floor: 'level-0',
      }),
      createSkirtingRun({
        name: 'flat.bathroom.skirting',
        zone: 'flatBathroom',
        points: bathroomPts,
        closed: true,
        roomSide: 'right',
        elevationY: 0.001,
        profile: 'chamfered',
        height: 0.095,
        thickness: 0.015,
        material: trimMat,
        gaps: [
          { box: { minX: -4.28, maxX: -2.95, minZ: 1.08, maxZ: 1.95 }, cap: 'selfReturn' },
          { box: { minX: -2.34, maxX: -2.18, minZ: 1.42, maxZ: 2.23 }, cap: 'selfReturn' },
          { box: { minX: -3.76, maxX: -3.34, minZ: 3.3, maxZ: 3.5 }, cap: 'selfReturn' },
          { box: { minX: -4.28, maxX: -4.1, minZ: 2.13, maxZ: 2.77 }, cap: 'selfReturn' },
        ],
        cutawayWalls: [southCut, westCut],
        floor: 'level-0',
      })
    );

    ctx.ceilingMeshGroup.add(
      createCorniceRun({
        name: 'flat.living.cornice',
        zone: 'flatLivingKitchen',
        points: [
          [-0.6 + INT_T / 2, -3.4],
          [4.2, -3.4],
          [4.2, 3.4],
          [-0.6 + INT_T / 2, 3.4],
        ],
        closed: true,
        roomSide: 'right',
        ceilingY: WALL_H,
        profile: 'georgian-cyma',
        height: 0.095,
        projection: 0.09,
        material: trimMat,
        cutawayWalls: [northCut, eastCut, southCut],
        floor: 'level-0',
      }),
      createCorniceRun({
        name: 'flat.hall.cornice',
        zone: 'flatHall',
        points: hallPts,
        closed: true,
        roomSide: 'right',
        ceilingY: WALL_H,
        profile: 'cove',
        height: 0.085,
        projection: 0.08,
        material: trimMat,
        cutawayWalls: [southCut],
        floor: 'level-0',
      }),
      createCorniceRun({
        name: 'flat.bedroom.cornice',
        zone: 'flatBedroom',
        points: bedroomPts,
        closed: true,
        roomSide: 'right',
        ceilingY: WALL_H,
        profile: 'georgian-cyma',
        height: 0.09,
        projection: 0.085,
        material: trimMat,
        cutawayWalls: [northCut, westCut],
        floor: 'level-0',
      }),
      createCorniceRun({
        name: 'flat.bathroom.cornice',
        zone: 'flatBathroom',
        points: bathroomPts,
        closed: true,
        roomSide: 'right',
        ceilingY: WALL_H,
        profile: 'cove',
        height: 0.08,
        projection: 0.075,
        material: trimMat,
        cutawayWalls: [southCut, westCut],
        floor: 'level-0',
      })
    );

    const bedDoor = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.83, 2.08, 0.042)), trimMat);
    bedDoor.name = 'flatBedroomDoor';
    bedDoor.position.set(-1.325, 1.045, 1.1);
    root.add(bedDoor);
    registerHingedDoor(ctx, { parent: root, door: bedDoor, hingeOffset: [-0.415, -1.045, 0], axis: 'y', openAngle: 1.42 });

    const bathDoor = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.042, 2.08, 0.73)), trimMat);
    bathDoor.name = 'flatBathroomDoor';
    bathDoor.position.set(-2.2, 1.045, 1.825);
    root.add(bathDoor);
    registerHingedDoor(ctx, { parent: root, door: bathDoor, hingeOffset: [0, -1.045, -0.365], axis: 'y', openAngle: -1.38 });

    // Kitchen joinery, worktop & fridge emitter
    buildHollowCabinetCarcass(root, 2.1, 0.45, -3.05, 3.1, 0.9, 0.62, '+z', trimMat, {
      plinthH: 0.1,
      dividers: 3,
      shelfCount: 1,
      interiorStyle: 'oak',
      populateItems: true,
    });
    const worktop = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(3.16, 0.036, 0.65)), new THREE.MeshStandardMaterial({ color: 0xeae6dd, roughness: 0.28 }));
    worktop.position.set(2.1, 0.919, -3.04);
    const fridge = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.64, 2.05, 0.64)), new THREE.MeshStandardMaterial({ color: 0x394442, roughness: 0.46 }));
    fridge.name = 'flat.kitchen.fridge';
    fridge.position.set(0.18, 1.025, -3.04);
    root.add(worktop, fridge);
    attachAudioEmitter(fridge, { id: 'flat-fridge-hum', preset: 'fridgeHum', zoneId: 'flatLivingKitchen', volume: 0.22, refDistance: 1.2, maxDistance: 7.0 });

    // Living sofa, dining table, bedroom bed + wardrobe, sanitaryware
    const sofaMat = new THREE.MeshStandardMaterial({ color: 0x6f7c73, roughness: 0.85 });
    const sofa = new THREE.Group();
    const sBase = new THREE.Mesh(prepGeo(createSculptedCushionGeometry(2.15, 0.26, 0.88, 16, 8, 12, 0.5, 'standard')), sofaMat);
    sBase.position.y = 0.3;
    const sBack = new THREE.Mesh(prepGeo(createSculptedCushionGeometry(2.15, 0.44, 0.22, 16, 8, 8, 0.5, 'standard')), sofaMat);
    sBack.position.set(0, 0.62, -0.34);
    sofa.add(sBase, sBack);
    sofa.position.set(2.35, 0, 1.35);
    sofa.rotation.y = Math.PI;
    root.add(sofa);

    const dTop = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.58, 0.58, 0.032, 24)), oakMat);
    dTop.position.set(0.65, 0.75, -0.55);
    const dPed = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.08, 0.22, 0.733, 18)), darkMat);
    dPed.position.set(0.65, 0.3665, -0.55);
    root.add(dTop, dPed);

    buildCoxDanicaBed(root, { name: 'flat.bedroom.bed', zone: 'flatBedroom', position: [-4.12, 0, -1.35], rotationY: 0, size: 'ukDouble' });
    buildHollowWardrobeInterior({
      parent: root,
      namePrefix: 'flat.bedroom.wardrobe',
      openFace: '+z',
      uMin: -3.9,
      uMax: -2.3,
      frontCoord: -2.75,
      depth: 0.6,
      roomFloorY: 0,
      carcassBaseY: 0,
      doorBaseY: 0.09,
      getCarcassTopY: () => 2.35,
      exteriorMat: trimMat,
      brassMat: brassMats.primary,
      interactions: ctx.interactions,
      bays: [
        { id: 'bay1', uMin: -3.86, uMax: -3.12, preset: 'doubleHang' },
        { id: 'bay2', uMin: -3.08, uMax: -2.34, preset: 'longHangAndDrawers' },
      ],
    });

    root.add(buildCastIronColumnRadiator({ name: 'flat.living.radiator', zone: 'flatLivingKitchen', cx: 4.05, floorY: 0, cz: -1.6, width: 0.95, rotationY: -Math.PI / 2, brassMat: brassMats.primary, cutawayDesc: eastCut, tagCutawayWall: tagCutaway }));

    const wc = buildLefroyBrooksCharterhouseWc({ namePrefix: 'flat.bathroom.wc', finish: 'SB', variant: 'closeCoupled' });
    wc.position.set(-3.55, 0, 3.32);
    wc.rotation.y = wallFacingToRotY('north');
    const washstand = buildLefroyBrooksLissaDoonWashstand({ namePrefix: 'flat.bathroom.washstand', finish: 'SB', widthM: 0.62 });
    washstand.position.set(-4.16, 0, 2.45);
    washstand.rotation.y = wallFacingToRotY('east');
    const shower = buildArmstrongConcealedShowerSet({ namePrefix: 'flat.bathroom.shower', finish: 'SB' });
    shower.position.set(-3.45, 0, 1.18);
    shower.rotation.y = wallFacingToRotY('south');
    root.add(wc, washstand, shower);

    // Wall switches (2-way hall travellers, 1-way rockers, rotary living dimmer) & power socket
    buildCorstonToggleSwitch(ctx, { name: 'flat.sw.hallA', switchPa: 'plate-hall-entry', location: 'Entrance door jamb', x: -0.82, y: 1.15, z: 3.36, facing: 'north', mountedInZoneId: 'flatHall', parentGroup: root, cutawayWall: southCut, gangs: [{ gang: 1, zoneId: 'flatHall', label: 'Hall 2-Way A' }] });
    buildCorstonToggleSwitch(ctx, { name: 'flat.sw.hallB', switchPa: 'plate-hall-inner', location: 'Inner hall junction', x: -0.68, y: 1.15, z: 1.28, facing: 'west', mountedInZoneId: 'flatHall', parentGroup: root, gangs: [{ gang: 1, zoneId: 'flatHall', label: 'Hall 2-Way B' }] });
    buildCorstonToggleSwitch(ctx, { name: 'flat.sw.bed', switchPa: 'plate-bedroom', location: 'Bedroom latch', x: -0.78, y: 1.15, z: 1.02, facing: 'north', mountedInZoneId: 'flatBedroom', parentGroup: root, gangs: [{ gang: 1, zoneId: 'flatBedroom', label: 'Bedroom' }] });
    buildCorstonToggleSwitch(ctx, { name: 'flat.sw.bath', switchPa: 'plate-bathroom', location: 'Bathroom jamb', x: -2.12, y: 1.15, z: 2.35, facing: 'east', mountedInZoneId: 'flatHall', parentGroup: root, gangs: [{ gang: 1, zoneId: 'flatBathroom', label: 'Bathroom' }] });
    buildCorstonToggleSwitch(ctx, { name: 'flat.sw.kit', switchPa: 'plate-kitchen', location: 'Kitchen splashback', x: 3.85, y: 1.12, z: -3.38, facing: 'south', mountedInZoneId: 'flatLivingKitchen', parentGroup: root, cutawayWall: northCut, gangs: [{ gang: 1, zoneId: 'flatLivingKitchen', label: 'Worktop' }] });

    const dimmerPlateMat = new THREE.MeshStandardMaterial({ color: 0xc59b57, metalness: 0.82, roughness: 0.28 });
    const dimmerGroup = new THREE.Group();
    dimmerGroup.position.set(-0.52, 1.15, 1.25);
    dimmerGroup.rotation.y = Math.PI / 2;
    const dBack = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(0.086, 0.086, 0.006)), dimmerPlateMat);
    const dKnob = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.018, 0.02, 0.018, 18)), dimmerPlateMat);
    dKnob.rotation.x = Math.PI / 2;
    dKnob.position.z = 0.011;
    dKnob.name = 'flat.dimmer.living';
    dKnob.userData = { electricalDimmerId: 'dimmer-living', zoneId: 'flatLivingKitchen' };
    dimmerGroup.add(dBack, dKnob);
    ctx.interactiveMeshes.push(dKnob);
    root.add(dimmerGroup);

    root.add(buildCorstonPowerSocket(ctx, tagCutaway, { name: 'flat.socket.living', zone: 'flatLivingKitchen', kind: 'double', x: 4.18, y: 0.45, z: 2.1, facing: 'west', cutawayWall: eastCut }));

    // Light fixtures
    bindPendant(ctx, root, 'flatHallPendant', [-1.4, 2.38, 2.25], 0xffd5a0, 0.14);
    bindPendant(ctx, root, 'flatLivingPendants', [2.1, 2.22, 0.4], 0xffd29a, 0.2);
    bindPendant(ctx, root, 'flatBedroomPendant', [-2.6, 2.28, -1.2], 0xffcfa0, 0.19);
    bindPendant(ctx, root, 'flatBathroomSpots', [-3.2, 2.66, 2.1], 0xfff0d6, 0.08);

    const taskGroup = (ctx.lightGroups as Record<string, LightCircuitGroup>).flatKitchenTask;
    const stripMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: new THREE.Color(0xffe1b5), emissiveIntensity: 1.8 });
    const strip = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(2.6, 0.015, 0.03)), stripMat);
    strip.position.set(2.1, 1.42, -3.28);
    tagCutaway(strip, northCut);
    const taskLight = new THREE.PointLight(0xffe1b5, 1.4, 4.2, 2);
    taskLight.position.set(2.1, 1.32, -3.0);
    root.add(strip, taskLight);
    if (taskGroup) {
      taskGroup.emissives.push(stripMat);
      taskGroup.lights.push(taskLight);
    }
    return {};
  },
};

export const simpleFlat: HouseDefinition = defineHouse({
  id: 'simple-flat',
  name: 'Vesterbro Courtyard Apartment',
  location: { lat: 55.6692, lon: 12.5518, elevationM: 14, northOffsetDeg: 8, timezone: 'Europe/Copenhagen', label: 'Copenhagen · Vesterbro' },
  floors: SIMPLE_FLAT_FLOORS,
  terrain: {
    base: 'flat',
    flatElevationY: -0.26,
    modifiers: [gradePad({ id: 'courtyard-pad', elevationY: -0.26, width: 22, depth: 20, featherM: 2.5 })],
  },
  soundscape: { preset: 'urban', gain: 0.9 },
  electrical: SIMPLE_FLAT_ELECTRICAL,
  rooms: { manifest: MANIFEST, navTree: NAV_TREE, roomZones: ROOM_ZONES },
  zones: {
    modules: [SIMPLE_FLAT_MODULE],
    circuitMaxIntensity: { flatHallPendant: 2.2, flatLivingPendants: 2.8, flatKitchenTask: 1.6, flatBedroomPendant: 2.2, flatBathroomSpots: 2.0 },
  },
  walkthrough: {
    spawns: [
      { id: 'hall-entry', label: 'Entrance Hall', zoneId: 'flatHall', position: [-1.45, 0, 2.65], yawDeg: 45 },
      { id: 'living', label: 'Living & Kitchen', zoneId: 'flatLivingKitchen', position: [1.5, 0, 1.9], yawDeg: 180 },
    ],
  },
  lenses: { enabledTrades: ['owner', 'architect', 'electrician'], defaultTrade: 'owner' },
});

export default simpleFlat;
