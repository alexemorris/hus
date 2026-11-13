import * as THREE from 'three';
import {
  carveBasin,
  createTerrainSampler,
  gradePad,
  splinePath,
  type TerrainConfig,
  type TerrainSurfaceSampler,
} from 'husjs';
import {
  applyMetricBoxUVs,
  createCobblestoneMaterial,
  createStoneMasonryMaterial,
} from 'husjs/materials';
import { extrudePlanarSolidWithHoles, prepGeo, tagCollisionRole } from 'husjs/objects';
import {
  buildGeorgianBrickRailingsAndGate,
  createEvergreenFoliagePbrMaterial,
  createRollerMownStripedLawnMaterial,
} from 'husjs/catalog/architectural';
import type { SceneBuilderContext } from 'husjs/viewer';

export const GROUNDS_LEVEL_Y = -0.18;
export const FORMAL_LAWN_TOP_Y = -0.16;
export const REAR_TERRACE_TOP_Y = -0.14;
export const AXIAL_WALK_TOP_Y = -0.155;
export const CARRIAGE_GRAVEL_TOP_Y = -0.168;

export const SIMPLE_HOUSE_TERRAIN_CONFIG: TerrainConfig = {
  base: (wx, wz) => -0.18 - 0.012 * Math.max(0, -wz - 9.0) + 0.03 * Math.sin(wx * 0.08),
  modifiers: [
    gradePad({
      id: 'forecourt-lawn-pad',
      elevationY: GROUNDS_LEVEL_Y,
      width: 22.0,
      depth: 22.0,
      featherM: 4.0,
    }),
    gradePad({
      id: 'rear-terrace-pad',
      originX: 0,
      originZ: -6.5,
      elevationY: GROUNDS_LEVEL_Y,
      width: 12.6,
      depth: 4.6,
      featherM: 1.8,
    }),
    splinePath({
      id: 'axial-walk',
      points: [
        [0, 13.0, -0.22],
        [0, 10.5, GROUNDS_LEVEL_Y],
        [0, 4.5, GROUNDS_LEVEL_Y],
      ],
      halfWidthM: 0.95,
      featherM: 1.0,
    }),
  ],
  // Depress the rendered SiteGround mesh beneath the walled & hedged curtilage so formal
  // striped lawns, gravel court, and footway never z-fight with the surrounding meadow mesh.
  meshCarveModifiers: [
    carveBasin({
      id: 'curtilage-subgrade',
      shape: 'box',
      minX: -11.4,
      maxX: 11.4,
      minZ: -17.0,
      maxZ: 12.2,
      bottomY: -0.38,
      featherM: 1.2,
      profile: 'flatBottom',
      mode: 'min',
    }),
  ],
};

export const simpleHouseTerrainSampler: TerrainSurfaceSampler = createTerrainSampler(
  SIMPLE_HOUSE_TERRAIN_CONFIG
);

function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + iz * 2147483647 + seed * 1597334677) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  const c000 = hash3(ix, iy, iz, seed);
  const c100 = hash3(ix + 1, iy, iz, seed);
  const c010 = hash3(ix, iy + 1, iz, seed);
  const c110 = hash3(ix + 1, iy + 1, iz, seed);
  const c001 = hash3(ix, iy, iz + 1, seed);
  const c101 = hash3(ix + 1, iy, iz + 1, seed);
  const c011 = hash3(ix, iy + 1, iz + 1, seed);
  const c111 = hash3(ix + 1, iy + 1, iz + 1, seed);
  const x00 = c000 + (c100 - c000) * ux;
  const x10 = c010 + (c110 - c010) * ux;
  const x01 = c001 + (c101 - c001) * ux;
  const x11 = c011 + (c111 - c011) * ux;
  const y0 = x00 + (x10 - x00) * uy;
  const y1 = x01 + (x11 - x01) * uy;
  return y0 + (y1 - y0) * uz;
}

function fbm3(x: number, y: number, z: number, seed: number): number {
  let sum = 0;
  let amp = 0.55;
  let freq = 1.0;
  let norm = 0;
  for (let o = 0; o < 3; o++) {
    sum += amp * (noise3(x * freq, y * freq, z * freq, seed + o * 101) - 0.5) * 2;
    norm += amp;
    amp *= 0.5;
    freq *= 2.15;
  }
  return sum / norm;
}

/**
 * Builds an organic clipped English Yew (`Taxus baccata`) hedge run with rounded top shoulders,
 * subtle multi-lobe billowing bays, and 3D FBM leaf-cluster surface displacement (never a flat box).
 * Local coordinates: length along `X ∈ [-L/2, +L/2]`, base `Y = 0` rising to `heightM`, thickness along `Z`.
 */
function buildOrganicYewHedgeGeometry(
  lengthM: number,
  heightM: number,
  thicknessM: number,
  seed: number
): THREE.BufferGeometry {
  const segX = Math.max(16, Math.round(lengthM * 4));
  const geo = new THREE.BoxGeometry(lengthM, heightM, thicknessM, segX, 8, 6);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const halfL = lengthM * 0.5;
  const halfH = heightM * 0.5;
  const halfT = thicknessM * 0.5;

  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i) + halfH; // [0..heightM]
    const pz = pos.getZ(i);

    const uL = px / Math.max(halfL, 0.001); // [-1..1]
    const vH = THREE.MathUtils.clamp(py / heightM, 0, 1); // [0..1]
    const wT = pz / Math.max(halfT, 0.001); // [-1..1]

    // Traditional batter (slightly wider at base, rounded crown shoulder at top)
    const batter = 1.04 - 0.1 * vH;
    const crownRound = vH > 0.72 ? Math.cos(((vH - 0.72) / 0.28) * Math.PI * 0.42) : 1.0;
    const endRound = Math.abs(uL) > 0.92 ? Math.cos(((Math.abs(uL) - 0.92) / 0.08) * Math.PI * 0.36) : 1.0;

    // Multi-lobe organic billowing along hedge run + fine 3D FBM foliage tufts
    const lobeWave =
      Math.sin(px * 2.15 + seed * 0.7) * 0.022 + Math.cos(px * 4.3 - seed * 1.1) * 0.012;
    const tuft = fbm3(px * 2.8, py * 3.1, pz * 2.8, seed) * 0.036;
    const basePin = Math.min(1, vH * 5.0);

    const outX = px * (0.985 + 0.015 * endRound) + tuft * 0.45 * basePin * Math.sign(uL || 1);
    const outZ = pz * batter * (0.78 + 0.22 * crownRound) * (0.85 + 0.15 * endRound) + (lobeWave + tuft) * basePin * Math.sign(wT || 1);
    const outY =
      py * (0.94 + 0.06 * endRound) +
      (vH > 0.15 ? (lobeWave * 0.8 + tuft * 0.85) * vH : 0) -
      (1 - crownRound) * Math.abs(wT) * 0.055;

    pos.setXYZ(i, outX, Math.max(0, outY), outZ);
  }
  applyMetricBoxUVs(geo, { tileW: 0.95, tileH: 0.95 });
  geo.computeVertexNormals();
  return prepGeo(geo);
}

/**
 * Multi-lobe FBM-displaced organic evergreen topiary or billowing shrub mound.
 */
function buildOrganicFoliageCrownGeometry(
  rx: number,
  ry: number,
  rz: number,
  seed: number,
  lobeStrength = 0.08
): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1.0, 22, 16);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const nx = pos.getX(i);
    const ny = pos.getY(i);
    const nz = pos.getZ(i);
    const lobe =
      1.0 +
      lobeStrength * Math.sin(nx * 3.6 + seed) * Math.cos(nz * 3.4 - seed * 0.6) +
      fbm3(nx * 2.7, ny * 2.7, nz * 2.7, seed) * (lobeStrength * 1.15);
    const flattenBase = ny < -0.55 ? 0.72 + 0.28 * ((ny + 1) / 0.45) : 1.0;
    const x = nx * rx * lobe;
    const y = ny * ry * lobe * flattenBase;
    const z = nz * rz * lobe;
    pos.setXYZ(i, x, y, z);
    uv.setXY(i, (Math.atan2(nz, nx) / (Math.PI * 2) + 0.5) * ((rx + rz) * 2.2), (ny * 0.5 + 0.5) * (ry * 2.2));
  }
  geo.computeVertexNormals();
  return prepGeo(geo);
}

function addMetricBox(
  parent: THREE.Object3D,
  name: string,
  size: readonly [number, number, number],
  center: readonly [number, number, number],
  material: THREE.Material,
  tileSizeM = 1.0,
  walkable = false
): THREE.Mesh {
  const geo = new THREE.BoxGeometry(size[0], size[1], size[2]);
  applyMetricBoxUVs(geo, { tileW: tileSizeM, tileH: tileSizeM });
  const mesh = new THREE.Mesh(prepGeo(geo), material);
  mesh.name = name;
  mesh.position.set(center[0], center[1], center[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (walkable) {
    tagCollisionRole(mesh, 'solidPlane');
  }
  parent.add(mesh);
  return mesh;
}

export function buildSimpleHouseGrounds(ctx: SceneBuilderContext): THREE.Group {
  const siteParent = ctx.site ?? ctx.scene;
  const root = new THREE.Group();
  root.name = 'simpleHouse.grounds';
  siteParent.add(root);

  const yorkstoneMat = createCobblestoneMaterial({
    preset: 'riven-yorkstone',
    worldMetersPerUv: 1.0,
  });
  const gravelMat = createCobblestoneMaterial({
    preset: 'pea-gravel',
    worldMetersPerUv: 1.0,
  });
  const settsMat = createCobblestoneMaterial({
    preset: 'granite-setts',
    worldMetersPerUv: 1.0,
  });
  const copingMat = createStoneMasonryMaterial('sawn-yorkstone-coping');
  const stripedLawnMat = createRollerMownStripedLawnMaterial();
  const yewHedgeMat = createEvergreenFoliagePbrMaterial('englishYew');
  const buxusMat = createEvergreenFoliagePbrMaterial('boxwoodBuxus');
  const herbaceousMat = createEvergreenFoliagePbrMaterial('herbaceousBorder');

  const leadPlanterMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.grounds.weatheredLead',
    color: 0x3c4043,
    roughness: 0.56,
    metalness: 0.52,
  });
  const soilMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.grounds.mulchSoil',
    color: 0x382d23,
    roughness: 0.96,
  });

  // Sub-plinth earth bed well clear below the -0.320 m facade stone plinths
  addMetricBox(
    root,
    'simpleHouse.grounds.subPlinthEarth',
    [11.96, 0.08, 9.36],
    [0, -0.365, 0],
    soilMat,
    2.0
  ).castShadow = false;

  // Front boundary at Z = +10.50 m: metric Flemish-brick dwarf wall, stone-capped piers & linked double wrought-iron gate
  const frontRailings = buildGeorgianBrickRailingsAndGate(ctx, {
    name: 'simpleHouse.grounds.frontRailingsAndGate',
    position: [0, GROUNDS_LEVEL_Y, 10.5],
    baysPerSide: 2,
    bayWidthM: 2.35,
    includeDoubleGate: true,
  });
  root.add(frontRailings);

  // Granite-setts footway apron beneath the front boundary piers/wall (top Y = -0.184 m, 4 mm below pier bases)
  addMetricBox(
    root,
    'simpleHouse.grounds.frontBoundaryFootway',
    [21.2, 0.07, 1.85],
    [0, -0.219, 11.18],
    settsMat,
    1.0,
    true
  ).castShadow = false;

  // Axial riven-Yorkstone flagstone walk: Z in [+4.63, +10.42], X in [-0.85, +0.85], top Y = -0.155 m
  const walkThick = 0.065;
  addMetricBox(
    root,
    'simpleHouse.grounds.axialYorkstoneWalk',
    [1.7, walkThick, 5.79],
    [0, AXIAL_WALK_TOP_Y - walkThick * 0.5, (4.63 + 10.42) * 0.5],
    yorkstoneMat,
    1.0,
    true
  );

  // Flanking pea-gravel carriage court split cleanly left & right of the axial walk (top Y = -0.168 m)
  const gravelThick = 0.06;
  const gravelWidth = 5.68 - 0.87;
  const gravelDepth = 10.24 - 4.66;
  const gravelCenterZ = (4.66 + 10.24) * 0.5;
  for (const [sideTag, sign] of [
    ['west', -1],
    ['east', 1],
  ] as const) {
    addMetricBox(
      root,
      `simpleHouse.grounds.carriageGravel.${sideTag}`,
      [gravelWidth, gravelThick, gravelDepth],
      [sign * (0.87 + gravelWidth * 0.5), CARRIAGE_GRAVEL_TOP_Y - gravelThick * 0.5, gravelCenterZ],
      gravelMat,
      1.0,
      true
    ).castShadow = false;

    // Granite-setts edging kerbs flanking the axial walk
    addMetricBox(
      root,
      `simpleHouse.grounds.walkSettKerb.${sideTag}`,
      [0.016, 0.06, 4.14],
      [sign * 0.86, -0.152 - 0.03, (6.07 + 10.21) * 0.5],
      settsMat,
      1.0
    );

    // Outer granite-setts kerbs bordering the formal front lawns
    addMetricBox(
      root,
      `simpleHouse.grounds.outerSettKerb.${sideTag}`,
      [0.2, 0.065, gravelDepth],
      [sign * 5.8, -0.152 - 0.0325, gravelCenterZ],
      settsMat,
      1.0
    );
  }

  // Continuous extruded roller-mown striped English formal lawn slab (top Y = -0.160 m, 60 mm thick,
  // zero internal seams/gaps, and true world-metric (wx / 1.8, wz / 1.8) mowing-stripe UVs!)
  const lawnThick = 0.06;
  const formalLawnOuter: readonly [number, number][] = [
    [-10.25, -14.08],
    [10.25, -14.08],
    [10.25, 10.24],
    [5.902, 10.24],
    [5.902, 4.622],
    [5.824, 4.622],
    [5.824, -4.622],
    [5.782, -4.622],
    [5.782, -8.482],
    [-5.782, -8.482],
    [-5.782, -4.622],
    [-5.824, -4.622],
    [-5.824, 4.622],
    [-5.902, 4.622],
    [-5.902, 10.24],
    [-10.25, 10.24],
  ];
  const formalLawnGeo = prepGeo(
    extrudePlanarSolidWithHoles({
      outer: formalLawnOuter,
      origin: [0, FORMAL_LAWN_TOP_Y - lawnThick, 0],
      uAxis: [1, 0, 0],
      vAxis: [0, 0, 1],
      wAxis: [0, 1, 0],
      depth: lawnThick,
      uvScale: 1 / 1.8,
    })
  );
  const formalLawn = new THREE.Mesh(formalLawnGeo, stripedLawnMat);
  formalLawn.name = 'simpleHouse.grounds.formalLawn';
  formalLawn.castShadow = false;
  formalLawn.receiveShadow = true;
  tagCollisionRole(formalLawn, 'solidPlane');
  root.add(formalLawn);

  // 2 x 5 graduated organic FBM-displaced Buxus boxwood topiary domes in weathered lead planters
  const axialZPositions = [9.55, 8.2, 6.85];
  const axialDiameters = [0.48, 0.53, 0.58];
  const plinthXPositions = [2.45, 4.35];
  const plinthDiameters = [0.63, 0.68];

  const addTopiary = (id: string, x: number, z: number, diameterM: number, baseTopY: number, seed: number) => {
    const g = new THREE.Group();
    g.name = `simpleHouse.grounds.topiary.${id}`;
    g.position.set(x, baseTopY + 0.002, z);
    root.add(g);

    const potW = diameterM * 0.62;
    const potH = 0.28;
    addMetricBox(g, `${g.name}.leadPot`, [potW, potH, potW], [0, potH * 0.5, 0], leadPlanterMat, 0.5);
    addMetricBox(
      g,
      `${g.name}.potRim`,
      [potW + 0.032, 0.026, potW + 0.032],
      [0, potH + 0.013, 0],
      leadPlanterMat,
      0.5
    );
    const stem = new THREE.Mesh(prepGeo(new THREE.CylinderGeometry(0.018, 0.022, 0.14, 10)), soilMat);
    stem.name = `${g.name}.stem`;
    stem.position.set(0, potH + 0.095, 0);
    g.add(stem);

    const r = diameterM * 0.5;
    const crown = new THREE.Mesh(
      buildOrganicFoliageCrownGeometry(r, r * 1.03, r, seed, 0.055),
      buxusMat
    );
    crown.name = `${g.name}.buxusSphere`;
    crown.position.set(0, potH + 0.14 + r * 0.96, 0);
    crown.castShadow = true;
    crown.receiveShadow = true;
    g.add(crown);
  };

  for (const [sideTag, sign] of [
    ['west', -1],
    ['east', 1],
  ] as const) {
    axialZPositions.forEach((z, idx) => {
      addTopiary(
        `${sideTag}_walk_${idx + 1}`,
        sign * 1.32,
        z,
        axialDiameters[idx]!,
        CARRIAGE_GRAVEL_TOP_Y,
        (sign < 0 ? 100 : 200) + idx * 17
      );
    });
    plinthXPositions.forEach((px, idx) => {
      addTopiary(
        `${sideTag}_plinth_${idx + 1}`,
        sign * px,
        5.13,
        plinthDiameters[idx]!,
        CARRIAGE_GRAVEL_TOP_Y,
        (sign < 0 ? 300 : 400) + idx * 23
      );
    });
  }

  // Rear riven-Yorkstone garden terrace: X in [-5.78, +5.78], Z in [-8.48, -4.63], top Y = -0.14 m
  const terraceThick = 0.08;
  addMetricBox(
    root,
    'simpleHouse.grounds.rearYorkstoneTerrace',
    [11.56, terraceThick, 3.85],
    [0, REAR_TERRACE_TOP_Y - terraceThick * 0.5, (-8.48 - 4.63) * 0.5],
    yorkstoneMat,
    1.0,
    true
  );

  // Two Yorkstone steps rising from the rear terrace (-0.14 m) to the kitchen French doors (X = 4.25)
  addMetricBox(
    root,
    'simpleHouse.grounds.frenchDoorLowerStep',
    [1.76, 0.044, 0.36],
    [4.25, REAR_TERRACE_TOP_Y + 0.024, -5.04],
    copingMat,
    1.0,
    true
  );
  addMetricBox(
    root,
    'simpleHouse.grounds.frenchDoorUpperStep',
    [1.64, 0.044, 0.21],
    [4.25, REAR_TERRACE_TOP_Y + 0.07, -4.75],
    copingMat,
    1.0,
    true
  );

  // Organic multi-lobe FBM-displaced English Yew perimeter hedges (`Taxus baccata`)
  const hedgeBaseY = FORMAL_LAWN_TOP_Y - 0.008;
  const hedgeH = 1.44;
  const hedgeT = 0.62;

  for (const [sideTag, sign] of [
    ['west', -1],
    ['east', 1],
  ] as const) {
    const sideHedge = new THREE.Mesh(
      buildOrganicYewHedgeGeometry(25.15, hedgeH, hedgeT, sign < 0 ? 511 : 617),
      yewHedgeMat
    );
    sideHedge.name = `simpleHouse.grounds.yewHedge.${sideTag}`;
    sideHedge.rotation.y = Math.PI * 0.5;
    sideHedge.position.set(sign * 10.52, hedgeBaseY, (-14.65 + 10.5) * 0.5);
    sideHedge.castShadow = true;
    sideHedge.receiveShadow = true;
    root.add(sideHedge);

    const frontWingW = 10.35 - 6.76;
    const frontHedge = new THREE.Mesh(
      buildOrganicYewHedgeGeometry(frontWingW, 1.36, 0.56, sign < 0 ? 733 : 839),
      yewHedgeMat
    );
    frontHedge.name = `simpleHouse.grounds.yewHedge.front_${sideTag}`;
    frontHedge.position.set(sign * (6.76 + frontWingW * 0.5), GROUNDS_LEVEL_Y + 0.004, 10.5);
    frontHedge.castShadow = true;
    frontHedge.receiveShadow = true;
    root.add(frontHedge);
  }

  const northHedge = new THREE.Mesh(
    buildOrganicYewHedgeGeometry(21.04, hedgeH, hedgeT, 953),
    yewHedgeMat
  );
  northHedge.name = 'simpleHouse.grounds.yewHedge.north';
  northHedge.position.set(0, hedgeBaseY - 0.004, -14.34);
  northHedge.castShadow = true;
  northHedge.receiveShadow = true;
  root.add(northHedge);

  // Billowing organic shrub & boxwood border mounds framing the forecourt & rear terrace corners
  const shrubClusters: readonly {
    id: string;
    x: number;
    z: number;
    rx: number;
    ry: number;
    rz: number;
    mat: THREE.Material;
    seed: number;
  }[] = [
    { id: 'frontBorderWest_1', x: -9.35, z: 9.45, rx: 0.54, ry: 0.42, rz: 0.48, mat: herbaceousMat, seed: 1101 },
    { id: 'frontBorderWest_2', x: -8.35, z: 9.58, rx: 0.44, ry: 0.36, rz: 0.42, mat: buxusMat, seed: 1109 },
    { id: 'frontBorderEast_1', x: 9.35, z: 9.45, rx: 0.54, ry: 0.42, rz: 0.48, mat: herbaceousMat, seed: 1201 },
    { id: 'frontBorderEast_2', x: 8.35, z: 9.58, rx: 0.44, ry: 0.36, rz: 0.42, mat: buxusMat, seed: 1209 },
    { id: 'rearTerraceWest_1', x: -6.35, z: -8.05, rx: 0.52, ry: 0.4, rz: 0.48, mat: herbaceousMat, seed: 1301 },
    { id: 'rearTerraceEast_1', x: 6.35, z: -8.05, rx: 0.52, ry: 0.4, rz: 0.48, mat: herbaceousMat, seed: 1401 },
  ];
  for (const s of shrubClusters) {
    const mound = new THREE.Mesh(
      buildOrganicFoliageCrownGeometry(s.rx, s.ry, s.rz, s.seed, 0.12),
      s.mat
    );
    mound.name = `simpleHouse.grounds.shrub.${s.id}`;
    mound.position.set(s.x, FORMAL_LAWN_TOP_Y + s.ry * 0.72, s.z);
    mound.castShadow = true;
    mound.receiveShadow = true;
    root.add(mound);
  }

  return root;
}
