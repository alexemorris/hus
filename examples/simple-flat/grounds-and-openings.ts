import * as THREE from 'three';
import {
  carveBasin,
  createTerrainSampler,
  gradePad,
  type CutawayWallDescriptor,
  type TerrainConfig,
  type TerrainSurfaceSampler,
} from 'husjs';
import {
  applyMetricBoxUVs,
  createCobblestoneMaterial,
} from 'husjs/materials';
import {
  extrudePlanarSolidWithHoles,
  prepGeo,
  projectWorldBoxUVs,
  tagCollisionRole,
  tagCutaway,
} from 'husjs/objects';
import { createEvergreenFoliagePbrMaterial } from 'husjs/catalog/architectural';

export const COURTYARD_LEVEL_Y = -0.26;

export const SIMPLE_FLAT_TERRAIN_CONFIG: TerrainConfig = {
  base: 'flat',
  flatElevationY: COURTYARD_LEVEL_Y,
  modifiers: [
    gradePad({
      id: 'courtyard-pad',
      elevationY: COURTYARD_LEVEL_Y,
      width: 22,
      depth: 20,
      featherM: 2.5,
    }),
  ],
  meshCarveModifiers: [
    carveBasin({
      id: 'courtyard-subgrade',
      shape: 'box',
      minX: -8.4,
      maxX: 8.4,
      minZ: -6.4,
      maxZ: 9.2,
      bottomY: -0.44,
      featherM: 1.0,
      profile: 'flatBottom',
      mode: 'min',
    }),
  ],
};

export const simpleFlatTerrainSampler: TerrainSurfaceSampler = createTerrainSampler(
  SIMPLE_FLAT_TERRAIN_CONFIG
);

export function addFlatBox(
  parent: THREE.Object3D,
  name: string,
  size: readonly [number, number, number],
  pos: readonly [number, number, number],
  material: THREE.Material,
  metricTileM?: number
): THREE.Mesh {
  const raw = new THREE.BoxGeometry(size[0], size[1], size[2]);
  if (metricTileM) {
    applyMetricBoxUVs(raw, { tileW: metricTileM, tileH: metricTileM, topTileV: metricTileM });
  }
  const mesh = new THREE.Mesh(prepGeo(raw), material);
  mesh.name = name;
  mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function createArchitecturalGlassMaterial(name: string): THREE.MeshPhysicalMaterial {
  // WebGL2 & WebGPU safe: transmission MUST remain 0 to prevent WebGL2 framebuffer feedback black-screen!
  return new THREE.MeshPhysicalMaterial({
    name,
    color: 0xdff0f5,
    transparent: true,
    opacity: 0.25,
    roughness: 0.06,
    metalness: 0.0,
    ior: 1.52,
    transmission: 0,
    depthWrite: false,
  });
}

export function buildCasementWindow(
  parent: THREE.Object3D,
  opts: {
    readonly name: string;
    readonly cx: number;
    readonly cy: number;
    readonly cz: number;
    readonly width: number;
    readonly height: number;
    readonly rotY: number;
    readonly frameMat: THREE.Material;
    readonly sillMat: THREE.Material;
    readonly stoneMat: THREE.Material;
    readonly glassMat: THREE.Material;
    readonly brassMat: THREE.Material;
    readonly includeExteriorSillAndLintel?: boolean;
    readonly includeInteriorBoard?: boolean;
    readonly panesCols?: 2 | 3;
    readonly cutaway?: CutawayWallDescriptor;
  }
): THREE.Group {
  const g = new THREE.Group();
  g.name = opts.name;
  g.position.set(opts.cx, opts.cy, opts.cz);
  g.rotation.y = opts.rotY;

  const fw = opts.width - 0.008;
  const fh = opts.height - 0.008;
  const frameT = 0.052;
  const frameD = 0.096;
  const innerH = fh - 2 * frameT - 0.002;

  addFlatBox(g, `${opts.name}.head`, [fw, frameT, frameD], [0, fh * 0.5 - frameT * 0.5, 0], opts.frameMat);
  addFlatBox(g, `${opts.name}.cillFrame`, [fw, frameT, frameD], [0, -fh * 0.5 + frameT * 0.5, 0], opts.frameMat);
  addFlatBox(g, `${opts.name}.jambL`, [frameT, innerH, frameD], [-fw * 0.5 + frameT * 0.5, 0, 0], opts.frameMat);
  addFlatBox(g, `${opts.name}.jambR`, [frameT, innerH, frameD], [fw * 0.5 - frameT * 0.5, 0, 0], opts.frameMat);

  const cols = opts.panesCols ?? 2;
  const mullionW = 0.038;
  const clearW = fw - 2 * frameT;
  const leafW = (clearW - (cols - 1) * mullionW) / cols;

  for (let c = 0; c < cols; c++) {
    const lx = -clearW * 0.5 + leafW * 0.5 + c * (leafW + mullionW);
    if (c > 0) {
      addFlatBox(
        g,
        `${opts.name}.mullion_${c}`,
        [mullionW, innerH, frameD - 0.006],
        [lx - (leafW + mullionW) * 0.5, 0, 0],
        opts.frameMat
      );
    }
    const paneW = leafW - 0.004;
    const paneH = innerH - 0.004;
    const glass = addFlatBox(
      g,
      c === 0 ? `${opts.name}.glass` : `${opts.name}.glass_${c + 1}`,
      [paneW, paneH, 0.012],
      [lx, 0, 0],
      opts.glassMat
    );
    glass.castShadow = false;
    glass.userData.isExteriorGlazedPortal = true;

    for (const [bIdx, frac] of [
      [1, -0.16],
      [2, 0.22],
    ] as const) {
      addFlatBox(g, `${opts.name}.astragalOut_${c}_${bIdx}`, [paneW - 0.002, 0.018, 0.008], [lx, innerH * frac, -0.011], opts.frameMat);
      addFlatBox(g, `${opts.name}.astragalIn_${c}_${bIdx}`, [paneW - 0.002, 0.018, 0.008], [lx, innerH * frac, 0.011], opts.frameMat);
    }

    addFlatBox(
      g,
      `${opts.name}.handle_${c + 1}`,
      [0.012, 0.072, 0.018],
      [lx + (c === 0 ? 1 : -1) * (leafW * 0.5 - 0.016), -0.08, frameD * 0.5 + 0.01],
      opts.brassMat
    );
  }

  const linerD = 0.068;
  const linerCz = frameD * 0.5 + linerD * 0.5 + 0.002;
  addFlatBox(g, `${opts.name}.revealTop`, [fw, 0.014, linerD], [0, fh * 0.5 - 0.007, linerCz], opts.sillMat);
  addFlatBox(g, `${opts.name}.revealL`, [0.014, fh - 0.032, linerD], [-fw * 0.5 + 0.007, 0, linerCz], opts.sillMat);
  addFlatBox(g, `${opts.name}.revealR`, [0.014, fh - 0.032, linerD], [fw * 0.5 - 0.007, 0, linerCz], opts.sillMat);

  if (opts.includeInteriorBoard !== false) {
    addFlatBox(
      g,
      `${opts.name}.windowBoard`,
      [opts.width + 0.09, 0.024, linerD + 0.036],
      [0, -opts.height * 0.5 - 0.014, linerCz + 0.02],
      opts.sillMat
    );
  }

  if (opts.includeExteriorSillAndLintel !== false) {
    addFlatBox(
      g,
      `${opts.name}.stoneSill`,
      [opts.width + 0.14, 0.058, 0.092],
      [0, -opts.height * 0.5 - 0.031, -0.145],
      opts.stoneMat,
      1.0
    );
    addFlatBox(
      g,
      `${opts.name}.stoneLintel`,
      [opts.width + 0.16, 0.135, 0.036],
      [0, opts.height * 0.5 + 0.07, -0.142],
      opts.stoneMat,
      1.0
    );
  }

  if (opts.cutaway) tagCutaway(g, opts.cutaway);
  parent.add(g);
  return g;
}

export function buildPanelledInteriorDoorLeaf(
  name: string,
  width: number,
  height: number,
  alongZ: boolean,
  trimMat: THREE.Material,
  brassMat: THREE.Material
): THREE.Group {
  const door = new THREE.Group();
  door.name = name;
  const leafT = 0.042;
  const panelT = 0.018;
  const stileW = 0.105;
  const topRailH = 0.115;
  const midRailH = 0.165;
  const botRailH = 0.21;
  const innerW = width - 2 * stileW - 0.002;
  const lowPanelH = 0.56;
  const midRailCy = botRailH + lowPanelH + midRailH * 0.5;
  const upPanelBot = botRailH + lowPanelH + midRailH;
  const upPanelH = height - upPanelBot - topRailH;

  const placePart = (partName: string, uSize: number, ySize: number, nSize: number, uPos: number, yPos: number, nPos = 0) => {
    const size: [number, number, number] = alongZ ? [nSize, ySize, uSize] : [uSize, ySize, nSize];
    const pos: [number, number, number] = alongZ ? [nPos, yPos, uPos] : [uPos, yPos, nPos];
    addFlatBox(door, `${name}.${partName}`, size, pos, trimMat);
  };

  placePart('stileL', stileW, height, leafT, -width * 0.5 + stileW * 0.5, 0);
  placePart('stileR', stileW, height, leafT, width * 0.5 - stileW * 0.5, 0);
  placePart('railBot', innerW, botRailH, leafT, 0, -height * 0.5 + botRailH * 0.5);
  placePart('railMid', innerW, midRailH, leafT, 0, -height * 0.5 + midRailCy);
  placePart('railTop', innerW, topRailH, leafT, 0, height * 0.5 - topRailH * 0.5);
  placePart('panelLower', innerW - 0.002, lowPanelH - 0.002, panelT, 0, -height * 0.5 + botRailH + lowPanelH * 0.5);
  placePart('panelUpper', innerW - 0.002, upPanelH - 0.002, panelT, 0, -height * 0.5 + upPanelBot + upPanelH * 0.5);

  const latchU = width * 0.5 - 0.056;
  const handleY = -height * 0.5 + 0.98;
  for (const side of [-1, 1] as const) {
    const rosePos: [number, number, number] = alongZ
      ? [side * (leafT * 0.5 + 0.005), handleY, latchU]
      : [latchU, handleY, side * (leafT * 0.5 + 0.005)];
    const rose = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.026, 0.026, 0.008, 16)), brassMat);
    rose.name = `${name}.rose_${side > 0 ? 'a' : 'b'}`;
    if (alongZ) rose.rotation.z = Math.PI * 0.5;
    else rose.rotation.x = Math.PI * 0.5;
    rose.position.set(rosePos[0], rosePos[1], rosePos[2]);
    door.add(rose);

    const leverSize: [number, number, number] = alongZ ? [0.042, 0.014, 0.105] : [0.105, 0.014, 0.042];
    const leverPos: [number, number, number] = alongZ
      ? [side * (leafT * 0.5 + 0.028), handleY, latchU - 0.038]
      : [latchU - 0.038, handleY, side * (leafT * 0.5 + 0.028)];
    addFlatBox(door, `${name}.lever_${side > 0 ? 'a' : 'b'}`, leverSize, leverPos, brassMat);
  }

  return door;
}

export function addDoorArchitravePortal(
  parent: THREE.Object3D,
  opts: {
    readonly name: string;
    readonly plane: 'x' | 'z';
    readonly wallCenterCoord: number;
    readonly wallThickness: number;
    readonly clearMinU: number;
    readonly clearMaxU: number;
    readonly clearHeightY: number;
    readonly trimMat: THREE.Material;
    readonly thresholdMat?: THREE.Material;
  }
): void {
  const g = new THREE.Group();
  g.name = opts.name;
  const clearW = opts.clearMaxU - opts.clearMinU;
  const midU = (opts.clearMinU + opts.clearMaxU) * 0.5;
  const jambT = 0.018;
  const jambD = opts.wallThickness - 0.002;
  const archW = 0.068;
  const archT = 0.016;

  const addPart = (partName: string, uLen: number, yLen: number, nLen: number, uPos: number, yPos: number, nPos: number, mat = opts.trimMat) => {
    const size: [number, number, number] = opts.plane === 'x' ? [nLen, yLen, uLen] : [uLen, yLen, nLen];
    const pos: [number, number, number] =
      opts.plane === 'x' ? [opts.wallCenterCoord + nPos, yPos, uPos] : [uPos, yPos, opts.wallCenterCoord + nPos];
    return addFlatBox(g, `${opts.name}.${partName}`, size, pos, mat);
  };

  addPart('linerL', jambT, opts.clearHeightY - 0.002, jambD, opts.clearMinU - jambT * 0.5 - 0.001, opts.clearHeightY * 0.5 + 0.001, 0);
  addPart('linerR', jambT, opts.clearHeightY - 0.002, jambD, opts.clearMaxU + jambT * 0.5 + 0.001, opts.clearHeightY * 0.5 + 0.001, 0);
  addPart('linerHead', clearW + 2 * jambT + 0.002, jambT, jambD, midU, opts.clearHeightY + jambT * 0.5 + 0.001, 0);

  for (const s of [-1, 1] as const) {
    const nOffset = s * (opts.wallThickness * 0.5 + archT * 0.5 + 0.0015);
    const tag = s < 0 ? 'neg' : 'pos';
    addPart(`archL_${tag}`, archW, opts.clearHeightY + jambT + 0.002, archT, opts.clearMinU - jambT - archW * 0.5 + 0.01, (opts.clearHeightY + jambT) * 0.5 + 0.001, nOffset);
    addPart(`archR_${tag}`, archW, opts.clearHeightY + jambT + 0.002, archT, opts.clearMaxU + jambT + archW * 0.5 - 0.01, (opts.clearHeightY + jambT) * 0.5 + 0.001, nOffset);
    addPart(
      `archHead_${tag}`,
      clearW + 2 * (jambT + archW - 0.01),
      archW,
      archT,
      midU,
      opts.clearHeightY + jambT + archW * 0.5 + 0.003,
      nOffset
    );
  }

  if (opts.thresholdMat) {
    const thresh = addPart(
      'threshold',
      clearW - 0.004,
      0.004,
      opts.wallThickness - 0.01,
      midU,
      0.0018,
      0,
      opts.thresholdMat
    );
    tagCollisionRole(thresh, 'ignore');
  }

  parent.add(g);
}

export function buildCourtyardGrounds(
  parent: THREE.Object3D,
  stoneMat: THREE.Material,
  brickMat: THREE.Material
): void {
  const grounds = new THREE.Group();
  grounds.name = 'simpleFlat.grounds';
  grounds.userData.isEnvironmentGround = true;

  const gravelMat = createCobblestoneMaterial({ preset: 'pea-gravel' });
  const yorkstoneMat = createCobblestoneMaterial({ preset: 'riven-yorkstone' });
  const cobbleMat = createCobblestoneMaterial({ preset: 'courtyard-cobble' });
  const hedgeMat = createEvergreenFoliagePbrMaterial();
  const terracottaMat = new THREE.MeshStandardMaterial({
    name: 'simpleFlat.grounds.terracotta',
    color: 0xb55c3e,
    roughness: 0.72,
  });

  const gravelGeo = extrudePlanarSolidWithHoles({
    outer: [
      [-8.1, -6.1],
      [8.1, -6.1],
      [8.1, 8.9],
      [-8.1, 8.9],
    ],
    holes: [
      [
        [-4.506, -3.706],
        [4.506, -3.706],
        [4.506, 3.706],
        [-4.506, 3.706],
      ],
    ],
    origin: [0, 0, 0],
    uAxis: [1, 0, 0],
    vAxis: [0, 0, 1],
    wAxis: [0, 1, 0],
    depthRange: [-0.286, -0.262],
  });
  projectWorldBoxUVs(gravelGeo, undefined, 1.4);
  const gravelMesh = new THREE.Mesh(gravelGeo, gravelMat);
  gravelMesh.name = 'simpleFlat.grounds.gravelApron';
  gravelMesh.receiveShadow = true;
  grounds.add(gravelMesh);

  const terraceGeo = extrudePlanarSolidWithHoles({
    outer: [
      [-5.6, 3.715],
      [5.6, 3.715],
      [5.6, 7.8],
      [-5.6, 7.8],
    ],
    origin: [0, 0, 0],
    uAxis: [1, 0, 0],
    vAxis: [0, 0, 1],
    wAxis: [0, 1, 0],
    depthRange: [-0.26, -0.238],
  });
  projectWorldBoxUVs(terraceGeo, undefined, 1.2);
  const terraceMesh = new THREE.Mesh(terraceGeo, yorkstoneMat);
  terraceMesh.name = 'simpleFlat.grounds.yorkstoneTerrace';
  terraceMesh.receiveShadow = true;
  grounds.add(terraceMesh);

  const walkGeo = extrudePlanarSolidWithHoles({
    outer: [
      [-2.25, 4.54],
      [-0.7, 4.54],
      [-0.7, 8.85],
      [-2.25, 8.85],
    ],
    origin: [0, 0, 0],
    uAxis: [1, 0, 0],
    vAxis: [0, 0, 1],
    wAxis: [0, 1, 0],
    depthRange: [-0.236, -0.228],
  });
  projectWorldBoxUVs(walkGeo, undefined, 1.0);
  const walkMesh = new THREE.Mesh(walkGeo, cobbleMat);
  walkMesh.name = 'simpleFlat.grounds.cobbleWalk';
  walkMesh.receiveShadow = true;
  grounds.add(walkMesh);

  addFlatBox(grounds, 'simpleFlat.grounds.stepLower', [1.5, 0.11, 0.8], [-1.475, -0.181, 4.12], stoneMat, 1.0);
  addFlatBox(grounds, 'simpleFlat.grounds.stepUpper', [1.24, 0.114, 0.52], [-1.475, -0.065, 3.91], stoneMat, 1.0);

  for (const [tag, x0, x1] of [
    ['west', -7.8, -2.56],
    ['east', -0.39, 7.8],
  ] as const) {
    const wLen = x1 - x0;
    const cx = (x0 + x1) * 0.5;
    addFlatBox(grounds, `simpleFlat.grounds.gardenWall_${tag}`, [wLen, 0.62, 0.24], [cx, 0.05, 8.65], brickMat, 0.9);
    addFlatBox(grounds, `simpleFlat.grounds.gardenCoping_${tag}`, [wLen + 0.04, 0.055, 0.3], [cx, 0.39, 8.65], stoneMat, 1.0);
  }
  for (const [pTag, px] of [
    ['pierL', -2.35],
    ['pierR', -0.6],
  ] as const) {
    addFlatBox(grounds, `simpleFlat.grounds.${pTag}`, [0.38, 0.88, 0.38], [px, 0.18, 8.65], brickMat, 0.9);
    addFlatBox(grounds, `simpleFlat.grounds.${pTag}Cap`, [0.44, 0.07, 0.44], [px, 0.658, 8.65], stoneMat, 1.0);
  }

  addFlatBox(grounds, 'simpleFlat.grounds.hedgeWest', [0.65, 1.25, 14.2], [-7.75, 0.365, 1.3], hedgeMat, 1.2);
  addFlatBox(grounds, 'simpleFlat.grounds.hedgeEast', [0.65, 1.25, 14.2], [7.75, 0.365, 1.3], hedgeMat, 1.2);
  addFlatBox(grounds, 'simpleFlat.grounds.hedgeNorth', [14.8, 1.25, 0.65], [0, 0.365, -5.75], hedgeMat, 1.2);

  for (const [idx, px, pz] of [
    [1, -2.54, 3.96],
    [2, -0.41, 3.96],
    [3, 0.55, 3.96],
    [4, 2.95, 3.96],
  ] as const) {
    const pot = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.22, 0.16, 0.42, 18)), terracottaMat);
    pot.name = `simpleFlat.grounds.planterPot_${idx}`;
    pot.position.set(px, -0.026, pz);
    pot.castShadow = true;
    grounds.add(pot);

    const trunk = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.022, 0.028, 0.46, 10)),
      new THREE.MeshStandardMaterial({ color: 0x5c4632, roughness: 0.88 })
    );
    trunk.name = `simpleFlat.grounds.planterStem_${idx}`;
    trunk.position.set(px, 0.38, pz);
    grounds.add(trunk);

    const crown = new THREE.Mesh(prepGeo(new THREE.SphereGeometry(0.27, 16, 12)), hedgeMat);
    crown.name = `simpleFlat.grounds.planterCrown_${idx}`;
    crown.position.set(px, 0.72, pz);
    crown.castShadow = true;
    grounds.add(crown);
  }

  parent.add(grounds);
}
