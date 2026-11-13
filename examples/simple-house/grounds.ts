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
import { buildWhiteCompanyAccessories } from 'husjs/catalog/furniture';
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
      width: 24.5,
      depth: 22.0,
      featherM: 4.0,
    }),
    gradePad({
      id: 'rear-terrace-pad',
      originX: 0,
      originZ: -6.5,
      elevationY: GROUNDS_LEVEL_Y,
      width: 16.4,
      depth: 4.8,
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
      minX: -12.6,
      maxX: 12.6,
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
  const x11 = c111 * ux + c011 * (1 - ux);
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
 * subtle multi-lobe billowing bays, and 3D FBM leaf-cluster surface displacement.
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
    const py = pos.getY(i) + halfH;
    const pz = pos.getZ(i);

    const uL = px / Math.max(halfL, 0.001);
    const vH = THREE.MathUtils.clamp(py / heightM, 0, 1);
    const wT = pz / Math.max(halfT, 0.001);

    const batter = 1.04 - 0.1 * vH;
    const crownRound = vH > 0.72 ? Math.cos(((vH - 0.72) / 0.28) * Math.PI * 0.42) : 1.0;
    const endRound = Math.abs(uL) > 0.92 ? Math.cos(((Math.abs(uL) - 0.92) / 0.08) * Math.PI * 0.36) : 1.0;

    const lobeWave =
      Math.sin(px * 2.15 + seed * 0.7) * 0.022 + Math.cos(px * 4.3 - seed * 1.1) * 0.012;
    const tuft = fbm3(px * 2.8, py * 3.1, pz * 2.8, seed) * 0.036;
    const basePin = Math.min(1, vH * 5.0);

    const outX = px * (0.985 + 0.015 * endRound) + tuft * 0.45 * basePin * Math.sign(uL || 1);
    const outZ =
      pz * batter * (0.78 + 0.22 * crownRound) * (0.85 + 0.15 * endRound) +
      (lobeWave + tuft) * basePin * Math.sign(wT || 1);
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
 * Multi-lobe FBM-displaced organic evergreen topiary, olive/bay tree crown, or billowing shrub mound.
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
    uv.setXY(
      i,
      (Math.atan2(nz, nx) / (Math.PI * 2) + 0.5) * ((rx + rz) * 2.2),
      (ny * 0.5 + 0.5) * (ry * 2.2)
    );
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

/**
 * Weathered character-oak outdoor dining table (`1.90 × 0.90 × 0.75 m`) & twin slatted garden benches
 * at `Z = -6.05` and `Z = -7.45`, dressed with twin White Company glass storm hurricanes.
 */
function buildTerraceDiningSet(parent: THREE.Object3D): THREE.Group {
  const group = new THREE.Group();
  group.name = 'simpleHouse.grounds.terraceDiningSet';
  group.position.set(2.15, REAR_TERRACE_TOP_Y + 0.002, -6.75);
  parent.add(group);

  const weatheredOakMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.grounds.weatheredCharacterOak',
    color: 0x8d7b67,
    roughness: 0.78,
  });
  const oakEndGrainMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.grounds.weatheredOakShadow',
    color: 0x766654,
    roughness: 0.84,
  });

  // Table (`1.90 × 0.90 × 0.75 m`): 5 slatted character-oak planks + breadboard ends + recessed frame & legs
  const tableW = 1.9;
  const tableD = 0.9;
  const tableH = 0.75;
  const topT = 0.042;
  const breadW = 0.09;
  const innerPlankSpanX = tableW - breadW * 2 - 0.008; // 1.712 m (4 mm gap to breadboard ends)
  const plankCount = 5;
  const plankGap = 0.006;
  const plankD = (tableD - plankGap * (plankCount - 1)) / plankCount;

  for (let p = 0; p < plankCount; p++) {
    const pz = -tableD * 0.5 + plankD * 0.5 + p * (plankD + plankGap);
    addMetricBox(group, `${group.name}.tablePlank_${p + 1}`, [innerPlankSpanX, topT, plankD], [0, tableH - topT * 0.5, pz], weatheredOakMat, 0.8);
  }
  for (const [eTag, s] of [
    ['west', -1],
    ['east', 1],
  ] as const) {
    addMetricBox(group, `${group.name}.tableBreadboard_${eTag}`, [breadW, topT, tableD], [s * (tableW * 0.5 - breadW * 0.5), tableH - topT * 0.5, 0], oakEndGrainMat, 0.8);
  }

  const legS = 0.082;
  const legH = tableH - topT - 0.002; // 2 mm below plank soffit so zero coplanar faces
  const legX = tableW * 0.5 - 0.14;
  const legZ = tableD * 0.5 - 0.11;
  for (const [lTag, sx, sz] of [
    ['nw', -1, -1],
    ['ne', 1, -1],
    ['sw', -1, 1],
    ['se', 1, 1],
  ] as const) {
    addMetricBox(group, `${group.name}.tableLeg_${lTag}`, [legS, legH, legS], [sx * legX, legH * 0.5, sz * legZ], oakEndGrainMat, 0.6);
  }

  const apronH = 0.074;
  const apronY = tableH - topT - 0.004 - apronH * 0.5;
  const longApronW = legX * 2 - legS - 0.006;
  const endApronD = legZ * 2 - legS - 0.006;
  for (const [aTag, sz] of [
    ['north', -1],
    ['south', 1],
  ] as const) {
    addMetricBox(group, `${group.name}.tableApron_${aTag}`, [longApronW, apronH, 0.028], [0, apronY, sz * legZ], weatheredOakMat, 0.8);
  }
  for (const [aTag, sx] of [
    ['west', -1],
    ['east', 1],
  ] as const) {
    addMetricBox(group, `${group.name}.tableEndApron_${aTag}`, [0.028, apronH, endApronD], [sx * legX, apronY, 0], weatheredOakMat, 0.8);
    addMetricBox(group, `${group.name}.tableEndStretcher_${aTag}`, [0.044, 0.048, endApronD], [sx * legX, 0.18, 0], oakEndGrainMat, 0.6);
  }
  addMetricBox(group, `${group.name}.tableCentreStretcher`, [legX * 2 - 0.05, 0.044, 0.054], [0, 0.18, 0], weatheredOakMat, 0.8);

  // Twin slatted character-oak garden benches at Z = -6.05 (+0.70 local) and Z = -7.45 (-0.70 local)
  const benchW = 1.66;
  const benchD = 0.38;
  const benchH = 0.45;
  const benchTopT = 0.036;
  const benchSlats = 3;
  const benchGap = 0.008;
  const benchSlatD = (benchD - benchGap * (benchSlats - 1)) / benchSlats;
  const benchLegH = benchH - benchTopT - 0.002;
  const benchLegX = benchW * 0.5 - 0.13;
  const benchLegZ = benchD * 0.5 - 0.065;

  for (const [bTag, bz] of [
    ['south', 0.7],
    ['north', -0.7],
  ] as const) {
    const bg = new THREE.Group();
    bg.name = `${group.name}.bench_${bTag}`;
    bg.position.set(0, 0, bz);
    group.add(bg);

    for (let s = 0; s < benchSlats; s++) {
      const sz = -benchD * 0.5 + benchSlatD * 0.5 + s * (benchSlatD + benchGap);
      addMetricBox(bg, `${bg.name}.slat_${s + 1}`, [benchW, benchTopT, benchSlatD], [0, benchH - benchTopT * 0.5, sz], weatheredOakMat, 0.7);
    }
    for (const [eTag, sx] of [
      ['west', -1],
      ['east', 1],
    ] as const) {
      for (const [zTag, sz] of [
        ['n', -1],
        ['s', 1],
      ] as const) {
        addMetricBox(bg, `${bg.name}.leg_${eTag}_${zTag}`, [0.058, benchLegH, 0.058], [sx * benchLegX, benchLegH * 0.5, sz * benchLegZ], oakEndGrainMat, 0.5);
      }
      addMetricBox(bg, `${bg.name}.trestleBar_${eTag}`, [0.038, 0.044, benchLegZ * 2 - 0.064], [sx * benchLegX, 0.14, 0], oakEndGrainMat, 0.5);
    }
    addMetricBox(bg, `${bg.name}.stretcher`, [benchLegX * 2 - 0.064, 0.038, 0.046], [0, 0.14, 0], weatheredOakMat, 0.7);
  }

  // Twin White Company glass storm hurricanes on tabletop (2 mm clear above Y = 0.750 top)
  for (const [hTag, hx] of [
    ['west', -0.42],
    ['east', 0.42],
  ] as const) {
    group.add(
      buildWhiteCompanyAccessories({
        kind: 'glassHurricane',
        name: `${group.name}.hurricane_${hTag}`,
        position: [hx, tableH + 0.002, 0],
      })
    );
  }

  return group;
}

/**
 * Sculpted multi-stem olive or bay tree in weathered-lead or heritage terracotta planter.
 */
function buildTerraceTreePlanter(
  parent: THREE.Object3D,
  id: string,
  x: number,
  z: number,
  vesselMat: THREE.Material,
  soilMat: THREE.Material,
  trunkMat: THREE.Material,
  foliageMat: THREE.Material,
  isOlive: boolean,
  seed: number
): THREE.Group {
  const g = new THREE.Group();
  g.name = `simpleHouse.grounds.terracePlanter.${id}`;
  g.position.set(x, REAR_TERRACE_TOP_Y + 0.002, z);
  parent.add(g);

  const potW = 0.54;
  const potH = 0.46;
  addMetricBox(g, `${g.name}.plinth`, [potW + 0.028, 0.036, potW + 0.028], [0, 0.018, 0], vesselMat, 0.5);
  addMetricBox(g, `${g.name}.body`, [potW, potH - 0.072, potW], [0, 0.038 + (potH - 0.072) * 0.5, 0], vesselMat, 0.5);
  addMetricBox(g, `${g.name}.rim`, [potW + 0.044, 0.036, potW + 0.044], [0, potH - 0.014, 0], vesselMat, 0.5);
  addMetricBox(g, `${g.name}.soil`, [potW - 0.05, 0.026, potW - 0.05], [0, potH - 0.036, 0], soilMat, 0.4);

  // Multi-stem gnarled olive / bay trunks rising from soil bed into clustered FBM foliage lobes
  const stemSpecs: readonly {
    tag: string;
    ox: number;
    oz: number;
    tx: number;
    tz: number;
    len: number;
    cr: readonly [number, number, number];
  }[] = isOlive
    ? [
        { tag: 'main', ox: -0.02, oz: 0.01, tx: -0.11, tz: 0.08, len: 0.72, cr: [0.36, 0.3, 0.34] },
        { tag: 'east', ox: 0.04, oz: -0.02, tx: 0.16, tz: -0.1, len: 0.66, cr: [0.31, 0.27, 0.3] },
        { tag: 'north', ox: -0.03, oz: -0.04, tx: -0.08, tz: -0.16, len: 0.62, cr: [0.29, 0.25, 0.28] },
      ]
    : [
        { tag: 'main', ox: 0.0, oz: 0.0, tx: 0.03, tz: 0.02, len: 0.76, cr: [0.34, 0.42, 0.34] },
        { tag: 'west', ox: -0.03, oz: 0.02, tx: -0.12, tz: 0.09, len: 0.64, cr: [0.26, 0.31, 0.26] },
        { tag: 'east', ox: 0.03, oz: -0.02, tx: 0.11, tz: -0.09, len: 0.62, cr: [0.25, 0.3, 0.25] },
      ];

  stemSpecs.forEach((st, idx) => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(st.ox, potH - 0.02, st.oz),
      new THREE.Vector3((st.ox + st.tx) * 0.5 + (idx - 1) * 0.025, potH + st.len * 0.48, (st.oz + st.tz) * 0.5),
      new THREE.Vector3(st.tx, potH + st.len, st.tz),
    ]);
    const stemMesh = new THREE.Mesh(prepGeo(new THREE.TubeGeometry(curve, 10, 0.026 - idx * 0.004, 8, false)), trunkMat);
    stemMesh.name = `${g.name}.trunk_${st.tag}`;
    stemMesh.castShadow = true;
    g.add(stemMesh);

    const lobe = new THREE.Mesh(
      buildOrganicFoliageCrownGeometry(st.cr[0], st.cr[1], st.cr[2], seed + idx * 31, isOlive ? 0.11 : 0.075),
      foliageMat
    );
    lobe.name = `${g.name}.crown_${st.tag}`;
    lobe.position.set(st.tx * 1.15, potH + st.len + st.cr[1] * 0.58, st.tz * 1.15);
    lobe.castShadow = true;
    lobe.receiveShadow = true;
    g.add(lobe);
  });

  return g;
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
  const terracottaPlanterMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.grounds.agedTerracotta',
    color: 0xa75d43,
    roughness: 0.82,
  });
  const oliveFoliageMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.grounds.silveryOliveFoliage',
    color: 0x6c7c5e,
    roughness: 0.86,
  });
  const oliveTrunkMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.grounds.gnarledOliveBark',
    color: 0x5c5144,
    roughness: 0.9,
  });
  const soilMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.grounds.mulchSoil',
    color: 0x382d23,
    roughness: 0.96,
  });

  // Sub-plinth earth bed well clear below the -0.320 m facade stone plinths (`14.82 × 9.16 m` house)
  addMetricBox(root, 'simpleHouse.grounds.subPlinthEarth', [15.16, 0.08, 9.36], [0, -0.365, 0], soilMat, 2.0).castShadow = false;

  // Front boundary at Z = +10.50 m: 6-bay Flemish-brick dwarf wall, stone-capped piers & linked double wrought-iron gate
  const frontRailings = buildGeorgianBrickRailingsAndGate(ctx, {
    name: 'simpleHouse.grounds.frontRailingsAndGate',
    position: [0, GROUNDS_LEVEL_Y, 10.5],
    baysPerSide: 3,
    bayWidthM: 2.12,
    includeDoubleGate: true,
  });
  root.add(frontRailings);

  // Granite-setts footway apron beneath the front boundary piers/wall (top Y = -0.184 m, 4 mm below pier bases)
  addMetricBox(root, 'simpleHouse.grounds.frontBoundaryFootway', [23.4, 0.07, 1.85], [0, -0.219, 11.18], settsMat, 1.0, true).castShadow = false;

  // Axial riven-Yorkstone flagstone walk: Z in [+4.63, +10.42], X in [-0.85, +0.85], top Y = -0.155 m
  const walkThick = 0.065;
  addMetricBox(root, 'simpleHouse.grounds.axialYorkstoneWalk', [1.7, walkThick, 5.79], [0, AXIAL_WALK_TOP_Y - walkThick * 0.5, (4.63 + 10.42) * 0.5], yorkstoneMat, 1.0, true);

  // Flanking pea-gravel carriage court widened to X ∈ [0.87, 7.36] & [-7.36, -0.87] with outerSettKerb at ±7.48
  const gravelThick = 0.06;
  const gravelWidth = 7.36 - 0.87;
  const gravelDepth = 10.24 - 4.66;
  const gravelCenterZ = (4.66 + 10.24) * 0.5;
  for (const [sideTag, sign] of [
    ['west', -1],
    ['east', 1],
  ] as const) {
    addMetricBox(root, `simpleHouse.grounds.carriageGravel.${sideTag}`, [gravelWidth, gravelThick, gravelDepth], [sign * (0.87 + gravelWidth * 0.5), CARRIAGE_GRAVEL_TOP_Y - gravelThick * 0.5, gravelCenterZ], gravelMat, 1.0, true).castShadow = false;

    addMetricBox(root, `simpleHouse.grounds.walkSettKerb.${sideTag}`, [0.016, 0.06, 4.14], [sign * 0.86, -0.152 - 0.03, (6.07 + 10.21) * 0.5], settsMat, 1.0);

    addMetricBox(root, `simpleHouse.grounds.outerSettKerb.${sideTag}`, [0.2, 0.065, gravelDepth], [sign * 7.48, -0.152 - 0.0325, gravelCenterZ], settsMat, 1.0);
  }

  // Continuous extruded roller-mown striped English formal lawn slab (`X ∈ [-11.35, +11.35], Z ∈ [-14.08, +10.24]`)
  // stepping cleanly around the outer sett kerb (`±7.586`), `14.82 m` house (`±7.49, ±4.63`),
  // and full-width `15.10 m` rear Yorkstone terrace (`X ∈ [-7.55, +7.55], Z ∈ [-8.55, -4.63]`).
  const lawnThick = 0.06;
  const formalLawnOuter: readonly [number, number][] = [
    [-11.35, -14.08],
    [11.35, -14.08],
    [11.35, 10.24],
    [7.586, 10.24],
    [7.586, 4.63],
    [7.49, 4.63],
    [7.49, -4.624],
    [7.556, -4.624],
    [7.556, -8.556],
    [-7.556, -8.556],
    [-7.556, -4.624],
    [-7.49, -4.624],
    [-7.49, 4.63],
    [-7.586, 4.63],
    [-7.586, 10.24],
    [-11.35, 10.24],
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

  // Buxus boxwood topiary domes along axial walk and framing the 5-bay front piers (`X = ±2.15, ±4.15, ±6.35`)
  const axialZPositions = [9.55, 8.2, 6.85];
  const axialDiameters = [0.48, 0.53, 0.58];
  const plinthXPositions = [2.15, 4.15, 6.35];
  const plinthDiameters = [0.62, 0.65, 0.68];

  const addTopiary = (
    id: string,
    x: number,
    z: number,
    diameterM: number,
    baseTopY: number,
    seed: number
  ) => {
    const g = new THREE.Group();
    g.name = `simpleHouse.grounds.topiary.${id}`;
    g.position.set(x, baseTopY + 0.002, z);
    root.add(g);

    const potW = diameterM * 0.62;
    const potH = 0.28;
    addMetricBox(g, `${g.name}.leadPot`, [potW, potH, potW], [0, potH * 0.5, 0], leadPlanterMat, 0.5);
    addMetricBox(g, `${g.name}.potRim`, [potW + 0.032, 0.026, potW + 0.032], [0, potH + 0.013, 0], leadPlanterMat, 0.5);
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

  // Full-width 15.10 m rear riven-Yorkstone garden terrace: X in [-7.55, +7.55], Z in [-8.55, -4.63], top Y = -0.14 m
  const terraceThick = 0.08;
  addMetricBox(root, 'simpleHouse.grounds.rearYorkstoneTerrace', [15.1, terraceThick, 3.92], [0, REAR_TERRACE_TOP_Y - terraceThick * 0.5, (-8.55 - 4.63) * 0.5], yorkstoneMat, 1.0, true);

  // Yorkstone threshold steps (`walkable = true`) at ALL THREE rear garden doors:
  // Kitchen French doors (`X = +5.35`), Drawing Room French doors (`X = -5.35`), and Boot Lobby door (`X = -0.95`)
  for (const stepSpec of [
    { prefix: 'frenchDoor', x: 5.35, lowerW: 1.76, upperW: 1.64 },
    { prefix: 'drawingFrenchDoor', x: -5.35, lowerW: 1.76, upperW: 1.64 },
    { prefix: 'bootDoor', x: -0.95, lowerW: 1.14, upperW: 1.04 },
  ] as const) {
    addMetricBox(root, `simpleHouse.grounds.${stepSpec.prefix}LowerStep`, [stepSpec.lowerW, 0.044, 0.36], [stepSpec.x, REAR_TERRACE_TOP_Y + 0.024, -5.04], copingMat, 1.0, true);
    addMetricBox(root, `simpleHouse.grounds.${stepSpec.prefix}UpperStep`, [stepSpec.upperW, 0.044, 0.21], [stepSpec.x, REAR_TERRACE_TOP_Y + 0.07, -4.75], copingMat, 1.0, true);
  }

  // Dressed rear Yorkstone terrace outdoor dining vignette + olive & bay tree planters
  buildTerraceDiningSet(root);
  buildTerraceTreePlanter(
    root,
    'westOlive',
    -6.75,
    -7.85,
    leadPlanterMat,
    soilMat,
    oliveTrunkMat,
    oliveFoliageMat,
    true,
    1511
  );
  buildTerraceTreePlanter(
    root,
    'eastOlive',
    6.75,
    -7.85,
    leadPlanterMat,
    soilMat,
    oliveTrunkMat,
    oliveFoliageMat,
    true,
    1619
  );
  buildTerraceTreePlanter(
    root,
    'centreWestBay',
    -2.85,
    -7.85,
    terracottaPlanterMat,
    soilMat,
    oliveTrunkMat,
    buxusMat,
    false,
    1723
  );

  // Organic multi-lobe FBM-displaced English Yew perimeter hedges (`Taxus baccata`) at X = ±11.62
  const hedgeBaseY = FORMAL_LAWN_TOP_Y - 0.008;
  const hedgeH = 1.44;
  const hedgeT = 0.5;

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
    sideHedge.position.set(sign * 11.62, hedgeBaseY, (-14.65 + 10.5) * 0.5);
    sideHedge.castShadow = true;
    sideHedge.receiveShadow = true;
    root.add(sideHedge);

    // Front wing hedges connecting outer railing pier (`±8.88`) to `±11.45`
    const frontWingStart = 8.88;
    const frontWingW = 11.45 - frontWingStart;
    const frontHedge = new THREE.Mesh(
      buildOrganicYewHedgeGeometry(frontWingW, 1.36, 0.48, sign < 0 ? 733 : 839),
      yewHedgeMat
    );
    frontHedge.name = `simpleHouse.grounds.yewHedge.front_${sideTag}`;
    frontHedge.position.set(sign * (frontWingStart + frontWingW * 0.5), GROUNDS_LEVEL_Y + 0.004, 10.5);
    frontHedge.castShadow = true;
    frontHedge.receiveShadow = true;
    root.add(frontHedge);
  }

  const northHedge = new THREE.Mesh(
    buildOrganicYewHedgeGeometry(22.6, hedgeH, hedgeT, 953),
    yewHedgeMat
  );
  northHedge.name = 'simpleHouse.grounds.yewHedge.north';
  northHedge.position.set(0, hedgeBaseY - 0.004, -14.38);
  northHedge.castShadow = true;
  northHedge.receiveShadow = true;
  root.add(northHedge);

  // Billowing organic shrub & boxwood border mounds framing the forecourt & rear lawn borders
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
    { id: 'frontBorderWest_1', x: -10.35, z: 9.45, rx: 0.54, ry: 0.42, rz: 0.48, mat: herbaceousMat, seed: 1101 },
    { id: 'frontBorderWest_2', x: -9.35, z: 9.58, rx: 0.44, ry: 0.36, rz: 0.42, mat: buxusMat, seed: 1109 },
    { id: 'frontBorderEast_1', x: 10.35, z: 9.45, rx: 0.54, ry: 0.42, rz: 0.48, mat: herbaceousMat, seed: 1201 },
    { id: 'frontBorderEast_2', x: 9.35, z: 9.58, rx: 0.44, ry: 0.36, rz: 0.42, mat: buxusMat, seed: 1209 },
    { id: 'rearTerraceWest_1', x: -8.35, z: -8.05, rx: 0.52, ry: 0.4, rz: 0.48, mat: herbaceousMat, seed: 1301 },
    { id: 'rearTerraceEast_1', x: 8.35, z: -8.05, rx: 0.52, ry: 0.4, rz: 0.48, mat: herbaceousMat, seed: 1401 },
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
