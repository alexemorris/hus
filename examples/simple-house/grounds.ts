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
import {
  extrudePlanarSolidWithHoles,
  prepGeo,
  tagCollisionRole,
  tagCutaway,
} from 'husjs/objects';
import {
  createClimber,
  createFlowerBed,
  createHedge,
  createShrub,
  createTopiary,
  createTree,
} from 'husjs/vegetation';
import {
  buildGeorgianBrickRailingsAndGate,
  createRollerMownStripedLawnMaterial,
} from 'husjs/catalog/architectural';
import { buildWhiteCompanyAccessories } from 'husjs/catalog/furniture';
import type { SceneBuilderContext } from 'husjs/viewer';
import type { SimpleHouseShell } from './architecture.ts';

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

const HEDGE_COLLIDER_MAT = new THREE.MeshBasicMaterial({
  name: 'simpleHouse.grounds.hedgeColliderMat',
  visible: false,
});

function addMetricBox(
  parent: THREE.Object3D,
  name: string,
  size: readonly [number, number, number],
  pos: readonly [number, number, number],
  material: THREE.Material,
  uvMeters = 1.0,
  walkable = false
): THREE.Mesh {
  const geo = prepGeo(new THREE.BoxGeometry(size[0], size[1], size[2]));
  applyMetricBoxUVs(geo, { tileW: uvMeters, tileH: uvMeters });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = name;
  mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (walkable) {
    tagCollisionRole(mesh, 'solidPlane');
  }
  parent.add(mesh);
  return mesh;
}

function addHedgeRunWithCollider(
  parent: THREE.Object3D,
  name: string,
  path: readonly [number, number][],
  baseY: number,
  height: number,
  thickness: number,
  seed: number
): THREE.Group {
  const hedge = createHedge({
    species: 'yew',
    path,
    height,
    thickness,
    exposure: 'outdoor',
    seed,
    name,
  });
  hedge.position.y = baseY;
  parent.add(hedge);

  const [p0, p1] = [path[0]!, path[path.length - 1]!];
  const dx = p1[0] - p0[0];
  const dz = p1[1] - p0[1];
  const len = Math.hypot(dx, dz);
  const collider = new THREE.Mesh(
    prepGeo(new THREE.BoxGeometry(len, height, Math.max(0.28, thickness * 0.82))),
    HEDGE_COLLIDER_MAT
  );
  collider.name = `${name}.collider`;
  collider.position.set((p0[0] + p1[0]) * 0.5, height * 0.5, (p0[1] + p1[1]) * 0.5);
  collider.rotation.y = -Math.atan2(dz, dx);
  collider.castShadow = false;
  collider.receiveShadow = false;
  tagCollisionRole(collider, 'solidPlane');
  hedge.add(collider);

  return hedge;
}

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

  const tableW = 1.9;
  const tableD = 0.9;
  const tableH = 0.75;
  const topT = 0.042;
  const breadW = 0.09;
  const innerPlankSpanX = tableW - breadW * 2 - 0.008;
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
  const legH = tableH - topT - 0.002;
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

export function buildSimpleHouseGrounds(
  ctx: SceneBuilderContext,
  shell?: SimpleHouseShell
): THREE.Group {
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
  const soilMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.grounds.mulchSoil',
    color: 0x382d23,
    roughness: 0.96,
  });

  addMetricBox(root, 'simpleHouse.grounds.subPlinthEarth', [15.16, 0.08, 9.36], [0, -0.365, 0], soilMat, 2.0).castShadow = false;

  const frontRailings = buildGeorgianBrickRailingsAndGate(ctx, {
    name: 'simpleHouse.grounds.frontRailingsAndGate',
    position: [0, GROUNDS_LEVEL_Y, 10.5],
    baysPerSide: 3,
    bayWidthM: 2.12,
    includeDoubleGate: true,
  });
  root.add(frontRailings);

  addMetricBox(root, 'simpleHouse.grounds.frontBoundaryFootway', [23.4, 0.07, 1.85], [0, -0.219, 11.18], settsMat, 1.0, true).castShadow = false;

  const walkThick = 0.065;
  addMetricBox(root, 'simpleHouse.grounds.axialYorkstoneWalk', [1.7, walkThick, 5.79], [0, AXIAL_WALK_TOP_Y - walkThick * 0.5, (4.63 + 10.42) * 0.5], yorkstoneMat, 1.0, true);

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

  const axialZPositions = [9.55, 8.2, 6.85] as const;
  const axialRadii = [0.24, 0.265, 0.29] as const;
  const plinthXPositions = [2.15, 4.15, 6.35] as const;
  const plinthRadii = [0.31, 0.325, 0.34] as const;

  for (const [sideTag, sign] of [
    ['west', -1],
    ['east', 1],
  ] as const) {
    axialZPositions.forEach((z, idx) => {
      const r = axialRadii[idx]!;
      const topiary = createTopiary({
        form: 'buxus-ball',
        planter: 'lead-cube',
        radius: r,
        height: 0.42 + r * 1.45,
        exposure: 'outdoor',
        seed: (sign < 0 ? 100 : 200) + idx * 17,
        name: `simpleHouse.grounds.topiary.${sideTag}_walk_${idx + 1}`,
      });
      topiary.position.set(sign * 1.32, CARRIAGE_GRAVEL_TOP_Y + 0.002, z);
      root.add(topiary);
    });
    plinthXPositions.forEach((px, idx) => {
      const r = plinthRadii[idx]!;
      const topiary = createTopiary({
        form: idx === 0 ? 'buxus-cone' : 'buxus-ball',
        planter: 'lead-cube',
        radius: r,
        height: idx === 0 ? 1.05 : 0.46 + r * 1.45,
        exposure: 'outdoor',
        seed: (sign < 0 ? 300 : 400) + idx * 23,
        name: `simpleHouse.grounds.topiary.${sideTag}_plinth_${idx + 1}`,
      });
      topiary.position.set(sign * px, CARRIAGE_GRAVEL_TOP_Y + 0.002, 5.13);
      root.add(topiary);
    });
  }

  const terraceThick = 0.08;
  addMetricBox(root, 'simpleHouse.grounds.rearYorkstoneTerrace', [15.1, terraceThick, 3.92], [0, REAR_TERRACE_TOP_Y - terraceThick * 0.5, (-8.55 - 4.63) * 0.5], yorkstoneMat, 1.0, true);

  for (const stepSpec of [
    { prefix: 'frenchDoor', x: 5.35, lowerW: 1.76, upperW: 1.64 },
    { prefix: 'drawingFrenchDoor', x: -5.35, lowerW: 1.76, upperW: 1.64 },
    { prefix: 'bootDoor', x: -0.95, lowerW: 1.14, upperW: 1.04 },
  ] as const) {
    addMetricBox(root, `simpleHouse.grounds.${stepSpec.prefix}LowerStep`, [stepSpec.lowerW, 0.044, 0.36], [stepSpec.x, REAR_TERRACE_TOP_Y + 0.024, -5.04], copingMat, 1.0, true);
    addMetricBox(root, `simpleHouse.grounds.${stepSpec.prefix}UpperStep`, [stepSpec.upperW, 0.044, 0.21], [stepSpec.x, REAR_TERRACE_TOP_Y + 0.07, -4.75], copingMat, 1.0, true);
  }

  buildTerraceDiningSet(root);

  for (const spec of [
    { id: 'westOlive', x: -6.75, form: 'olive-planter' as const, planter: 'lead-cube' as const, height: 1.56, radius: 0.42, seed: 1511 },
    { id: 'eastOlive', x: 6.75, form: 'olive-planter' as const, planter: 'lead-cube' as const, height: 1.56, radius: 0.42, seed: 1619 },
    { id: 'centreWestBay', x: -2.85, form: 'bay-standard' as const, planter: 'terracotta' as const, height: 1.52, radius: 0.34, seed: 1723 },
  ]) {
    const planter = createTopiary({
      form: spec.form,
      planter: spec.planter,
      height: spec.height,
      radius: spec.radius,
      exposure: 'outdoor',
      seed: spec.seed,
      name: `simpleHouse.grounds.terracePlanter.${spec.id}`,
    });
    planter.position.set(spec.x, REAR_TERRACE_TOP_Y + 0.002, -7.85);
    root.add(planter);
  }

  const hedgeBaseY = FORMAL_LAWN_TOP_Y - 0.008;
  for (const [sideTag, sign] of [
    ['west', -1],
    ['east', 1],
  ] as const) {
    addHedgeRunWithCollider(
      root,
      `simpleHouse.grounds.yewHedge.${sideTag}`,
      [
        [sign * 11.62, -14.65],
        [sign * 11.62, 10.5],
      ],
      hedgeBaseY,
      1.44,
      0.5,
      sign < 0 ? 511 : 617
    );
    addHedgeRunWithCollider(
      root,
      `simpleHouse.grounds.yewHedge.front_${sideTag}`,
      [
        [sign * 8.88, 10.5],
        [sign * 11.24, 10.5],
      ],
      GROUNDS_LEVEL_Y + 0.004,
      1.36,
      0.48,
      sign < 0 ? 733 : 839
    );
  }

  addHedgeRunWithCollider(
    root,
    'simpleHouse.grounds.yewHedge.north',
    [
      [-11.3, -14.38],
      [11.3, -14.38],
    ],
    hedgeBaseY - 0.004,
    1.44,
    0.5,
    953
  );

  const bedY = FORMAL_LAWN_TOP_Y + 0.002;
  for (const bedSpec of [
    { id: 'rearBorderWest', style: 'cottage-perennial-border' as const, x: -9.35, z: -7.15, width: 2.6, depth: 1.15, seed: 2101 },
    { id: 'rearBorderEast', style: 'cottage-perennial-border' as const, x: 9.35, z: -7.15, width: 2.6, depth: 1.15, seed: 2117 },
    { id: 'forecourtBulbsWest', style: 'spring-bulb-drift' as const, x: -9.55, z: 8.65, width: 2.2, depth: 0.95, seed: 2131 },
    { id: 'forecourtBulbsEast', style: 'spring-bulb-drift' as const, x: 9.55, z: 8.65, width: 2.2, depth: 0.95, seed: 2143 },
  ]) {
    const bed = createFlowerBed({
      style: bedSpec.style,
      width: bedSpec.width,
      depth: bedSpec.depth,
      exposure: 'outdoor',
      seed: bedSpec.seed,
      name: `simpleHouse.grounds.flowerBed.${bedSpec.id}`,
    });
    bed.position.set(bedSpec.x, bedY, bedSpec.z);
    root.add(bed);
  }

  for (const s of [
    { id: 'frontBorderWest_1', species: 'english-rose-shrub' as const, x: -10.35, z: 9.55, r: 0.52, h: 0.72, seed: 1101 },
    { id: 'frontBorderWest_2', species: 'lavender' as const, x: -9.25, z: 9.62, r: 0.4, h: 0.48, seed: 1109 },
    { id: 'frontBorderEast_1', species: 'english-rose-shrub' as const, x: 10.35, z: 9.55, r: 0.52, h: 0.72, seed: 1201 },
    { id: 'frontBorderEast_2', species: 'lavender' as const, x: 9.25, z: 9.62, r: 0.4, h: 0.48, seed: 1209 },
    { id: 'rearTerraceWest_1', species: 'hydrangea' as const, x: -8.35, z: -8.25, r: 0.56, h: 0.78, seed: 1301 },
    { id: 'rearTerraceEast_1', species: 'hydrangea' as const, x: 8.35, z: -8.25, r: 0.56, h: 0.78, seed: 1401 },
    { id: 'rearRoseWest', species: 'english-rose-shrub' as const, x: -8.45, z: -5.55, r: 0.48, h: 0.68, seed: 1423 },
    { id: 'rearRoseEast', species: 'english-rose-shrub' as const, x: 8.45, z: -5.55, r: 0.48, h: 0.68, seed: 1439 },
  ]) {
    const shrub = createShrub({
      species: s.species,
      radius: s.r,
      height: s.h,
      exposure: 'outdoor',
      seed: s.seed,
      name: `simpleHouse.grounds.shrub.${s.id}`,
    });
    shrub.position.set(s.x, FORMAL_LAWN_TOP_Y, s.z);
    root.add(shrub);
  }

  for (const treeSpec of [
    { id: 'forecourtMagnolia', species: 'magnolia' as const, x: -9.55, z: 6.45, height: 4.1, spread: 3.1, seed: 3101 },
    { id: 'eastLawnCherry', species: 'flowering-cherry' as const, x: 9.65, z: -4.2, height: 4.5, spread: 3.5, seed: 3203 },
    { id: 'orchardAppleEast', species: 'orchard-apple' as const, x: 5.1, z: -11.65, height: 3.85, spread: 3.1, seed: 3307 },
    { id: 'orchardAppleWest', species: 'orchard-apple' as const, x: -9.35, z: -11.55, height: 3.7, spread: 2.95, seed: 3413 },
    { id: 'northEastSilverBirch', species: 'silver-birch' as const, x: 9.55, z: -11.75, height: 6.6, spread: 3.4, seed: 3517 },
  ]) {
    const tree = createTree({
      species: treeSpec.species,
      height: treeSpec.height,
      spread: treeSpec.spread,
      exposure: 'outdoor',
      groundLitter: true,
      seed: treeSpec.seed,
      name: `simpleHouse.grounds.tree.${treeSpec.id}`,
    });
    tree.position.set(treeSpec.x, FORMAL_LAWN_TOP_Y, treeSpec.z);
    root.add(tree);
  }

  if (shell) {
    const groundFloorGroup = ctx.floor?.('ground')?.group ?? root;

    const rearWisteria = createClimber({
      species: 'wisteria',
      support: 'wall-plane',
      width: 1.32,
      height: 2.72,
      exposure: 'outdoor',
      seed: 4101,
      name: 'simpleHouse.grounds.climber.rearWisteria',
    });
    rearWisteria.position.set(2.14, REAR_TERRACE_TOP_Y + 0.002, -4.585);
    rearWisteria.rotation.y = Math.PI;
    tagCutaway(rearWisteria, shell.cut('north', 'ground'));
    groundFloorGroup.add(rearWisteria);

    const rearClimbingRose = createClimber({
      species: 'climbing-rose',
      support: 'wall-plane',
      width: 0.78,
      height: 2.62,
      exposure: 'outdoor',
      seed: 4207,
      name: 'simpleHouse.grounds.climber.rearClimbingRose',
    });
    rearClimbingRose.position.set(-3.78, REAR_TERRACE_TOP_Y + 0.002, -4.585);
    rearClimbingRose.rotation.y = Math.PI;
    tagCutaway(rearClimbingRose, shell.cut('north', 'ground'));
    groundFloorGroup.add(rearClimbingRose);

    const westGableIvy = createClimber({
      species: 'english-ivy',
      support: 'wall-plane',
      width: 2.1,
      height: 2.72,
      exposure: 'outdoor',
      seed: 4311,
      name: 'simpleHouse.grounds.climber.westGableIvy',
    });
    westGableIvy.position.set(-7.415, FORMAL_LAWN_TOP_Y + 0.002, -1.1);
    westGableIvy.rotation.y = -Math.PI * 0.5;
    tagCutaway(westGableIvy, shell.cut('west', 'ground'));
    groundFloorGroup.add(westGableIvy);
  }

  return root;
}
