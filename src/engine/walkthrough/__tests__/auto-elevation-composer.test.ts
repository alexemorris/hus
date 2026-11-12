import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
// @ts-expect-error untyped Node CLI .mjs entrypoint outside tsconfig include
import { dispatchHusjsCli } from '../../../../bin/husjs.mjs';
import { createPropertySceneLayers } from '../../viewer/scene-content.ts';
import {
  composeHouseWalkthroughElevation,
  createAutoWalkthroughElevationComposer,
  getStaircaseWalkableSampler,
  registerStaircaseWalkableSampler,
} from '../auto-elevation-composer.ts';

function buildTestStraightStairGroup(options: {
  readonly bottomY: number;
  readonly topY: number;
  readonly originZ: number;
  readonly runM: number;
  readonly widthM: number;
}) {
  const { bottomY, topY, originZ, runM, widthM } = options;
  const halfW = widthM * 0.5;
  const minZ = originZ - runM;
  const maxZ = originZ;

  const group = new THREE.Group();
  group.name = 'testStaircase.group';
  const ramp = new THREE.Mesh(
    new THREE.BoxGeometry(widthM, 0.12, runM),
    new THREE.MeshStandardMaterial({ color: 0xbba482 })
  );
  ramp.name = 'staircase.tread_1';
  ramp.position.set(0, (bottomY + topY) * 0.5, (minZ + maxZ) * 0.5);
  group.add(ramp);
  group.updateMatrixWorld(true);

  const voidOpeningXZ: readonly (readonly [number, number])[] = [
    [-halfW, maxZ],
    [halfW, maxZ],
    [halfW, minZ],
    [-halfW, minZ],
  ];

  const bounds = new THREE.Box3(
    new THREE.Vector3(-halfW, bottomY, minZ),
    new THREE.Vector3(halfW, topY, maxZ)
  );

  registerStaircaseWalkableSampler(group, {
    bottomY,
    topY,
    voidOpeningXZ,
    bounds,
    sampleWalkableY(worldX: number, worldZ: number): number | null {
      if (Math.abs(worldX) > halfW || worldZ < minZ - 0.35 || worldZ > maxZ + 0.05) {
        return null;
      }
      if (worldZ < minZ) return topY;
      if (worldZ > maxZ) return bottomY;
      const t = (maxZ - worldZ) / runM;
      return bottomY + t * (topY - bottomY);
    },
  });

  return group;
}

describe('auto-elevation-composer & defineHouse stairwell integration', () => {
  it('registers staircase samplers in a WeakMap with zero userData mutations', () => {
    const stairGroup = buildTestStraightStairGroup({
      bottomY: 0,
      topY: 2.8,
      originZ: 3.0,
      runM: 3.2,
      widthM: 0.96,
    });

    expect(Object.keys(stairGroup.userData)).toEqual([]);
    const sampler = getStaircaseWalkableSampler(stairGroup);
    expect(sampler).toBeDefined();
    expect(sampler?.bottomY).toBe(0);
    expect(sampler?.topY).toBe(2.8);
    expect(sampler?.sampleWalkableY(0, 3.0)).toBeCloseTo(0, 5);
    expect(sampler?.sampleWalkableY(0, 1.4)).toBeCloseTo(1.4, 5);
    expect(sampler?.sampleWalkableY(0, -0.2)).toBeCloseTo(2.8, 5);
  });

  it('auto-composes exterior portico steps, split-level slabs, staircase flights, stairwell void transitions, custom overrides, and outdoor terrain fallback', () => {
    const scene = new THREE.Scene();
    const layers = createPropertySceneLayers(scene, [
      { id: 'ground', label: 'Ground Floor', elevationY: 0.36, ceilingHeight: 2.64 },
      { id: 'first', label: 'First Floor', elevationY: 3.0, ceilingHeight: 2.5 },
    ]);

    const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc });

    // Exterior portico steps ascending from terrain (0.0 m) -> step 1 (0.18 m) -> ground slab (0.36 m)
    const step1 = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.18, 0.4), mat);
    step1.name = 'portico.step_1';
    step1.position.set(0, 0.09, 4.4);
    scene.add(step1);

    const step2 = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.36, 0.4), mat);
    step2.name = 'portico.step_2';
    step2.position.set(0, 0.18, 4.0);
    scene.add(step2);

    // Main ground slab at Y = 0.36 m (z in [-4 .. 3.8], x in [-4 .. 4])
    const groundSlab = new THREE.Mesh(new THREE.BoxGeometry(8.0, 0.2, 7.8), mat);
    groundSlab.name = 'ground.slab';
    groundSlab.position.set(0, 0.26, -0.1);
    layers.getFloorLayer('ground')!.slabGroup.add(groundSlab);

    // Sunken snug split-level slab at Y = 0.16 m (x in [4 .. 7], z in [-3 .. 3])
    const sunkenSlab = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.2, 6.0), mat);
    sunkenSlab.name = 'snug.floor';
    sunkenSlab.position.set(5.5, 0.06, 0);
    layers.getFloorLayer('ground')!.slabGroup.add(sunkenSlab);

    // Straight staircase from Y = 0.36 m at (0, 2.5) north (-Z) over 3.2 m run to Y = 3.0 m
    const totalRun = 3.2;
    const stairGroup = buildTestStraightStairGroup({
      bottomY: 0.36,
      topY: 3.0,
      originZ: 2.5,
      runM: totalRun,
      widthM: 1.0,
    });
    scene.add(stairGroup);

    // Upper floor slab covering [-4 .. 4] x [-4 .. 3.8] (stairwell voidOpeningXZ cuts it out automatically!)
    const firstSlab = new THREE.Mesh(new THREE.BoxGeometry(8.0, 0.24, 7.8), mat);
    firstSlab.name = 'first.slab';
    firstSlab.position.set(0, 3.0 - 0.12, -0.1);
    layers.getFloorLayer('first')!.slabGroup.add(firstSlab);

    scene.updateMatrixWorld(true);

    const composer = createAutoWalkthroughElevationComposer({
      floors: [
        { id: 'ground', elevationY: 0.36 },
        { id: 'first', elevationY: 3.0 },
      ],
      getScene: () => scene,
      terrainSampler: (x, z) => -0.05 * Math.max(0, z - 5.0) + (Math.abs(x) > 10 ? -0.2 : 0),
    });

    // Outdoors on graded terrain
    expect(composer.sampleElevationY(0, 7.0, 0)).toBeCloseTo(-0.1, 4);

    // Ascending portico steps
    const yStep1 = composer.sampleElevationY(0, 4.4, 0.0);
    expect(yStep1).toBeCloseTo(0.18, 4);
    const yStep2 = composer.sampleElevationY(0, 4.0, yStep1);
    expect(yStep2).toBeCloseTo(0.36, 4);

    // Ground floor & split-level sunken snug
    expect(composer.sampleElevationY(-2.0, 1.0, 0.36)).toBeCloseTo(0.36, 4);
    expect(composer.sampleElevationY(5.5, 0.0, 0.36)).toBeCloseTo(0.16, 4);

    // Ascending the staircase monotonically from 0.36 m to 3.0 m
    let footY = 0.36;
    for (let i = 0; i <= 16; i++) {
      const z = 2.5 - (i / 16) * totalRun;
      const nextY = composer.sampleElevationY(0, z, footY);
      expect(nextY).toBeGreaterThanOrEqual(footY - 1e-5);
      footY = nextY;
    }
    expect(footY).toBeCloseTo(3.0, 4);

    // Upper landing outside the stairwell void stays at 3.0 m
    expect(composer.sampleElevationY(-2.0, 1.0, 3.0)).toBeCloseTo(3.0, 4);

    // Stepping into the stairwell void from the top landing transitions smoothly onto the upper treads
    const upperTreadZ = 2.5 - totalRun * 0.85;
    const yEnteringStairDown = composer.sampleElevationY(0, upperTreadZ, 3.0);
    expect(yEnteringStairDown).toBeLessThan(2.85);
    expect(yEnteringStairDown).toBeGreaterThan(2.4);

    // Walking on the ground floor underneath the high upper treads stays on groundSlab (0.36 m)
    expect(composer.sampleElevationY(0, upperTreadZ, 0.36)).toBeCloseTo(0.36, 4);
    expect(composer.isInsideUpperStairwellVoid(0, 2.5 - totalRun * 0.5, 3.0)).toBe(true);

    // Custom hook takes precedence when supplied
    const withCustom = composeHouseWalkthroughElevation({
      floors: [{ id: 'ground', elevationY: 0.36 }],
      getScene: () => scene,
      customSampler: (x, _z, currentFootY) => (x > 20 ? 9.25 : currentFootY < -50 ? 0 : null),
    });
    expect(withCustom.sampleWalkableElevation(25, 0, 0, () => null)).toBe(9.25);
  });

  it('wires createStaircase WeakMap, defineHouse auto-walkthrough, and husjs/materials end-to-end via husjs audit CLI', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'husjs-auto-walk-'));
    const houseFile = join(tmpDir, 'two-storey-house.ts');
    writeFileSync(
      houseFile,
      `
import * as THREE from 'three';
import { defineHouse } from '${"hus" + "js"}';
import { createFinishMaterial } from '${"hus" + "js/materials"}';
import { createStaircase, extrudePlanarSolidWithHoles, prepGeo } from '${"hus" + "js/objects"}';

export const testHouse = defineHouse({
  id: 'two-storey-auto-cli',
  name: 'Two-Storey Auto Walkthrough House',
  location: { lat: 51.5, lon: -0.12 },
  floors: [
    { id: 'ground', label: 'Ground', elevationY: 0, ceilingHeight: 2.7 },
    { id: 'first', label: 'First', elevationY: 2.7, ceilingHeight: 2.5 },
  ],
  terrain: { base: 'flat', flatElevationY: -0.2 },
  rooms: {
    manifest: [],
    navTree: [],
    roomZones: {
      groundHall: {
        id: 'groundHall',
        name: 'Ground Hall',
        shortName: 'Hall',
        buildingId: 'mainHouse',
        floorId: 'ground',
        knxAreaLine: '1.1',
        isInterior: true,
        bounds: { minX: -3.5, maxX: 3.5, minY: 0, maxY: 2.7, minZ: -3.5, maxZ: 3.5 },
      },
      upperLanding: {
        id: 'upperLanding',
        name: 'Upper Landing',
        shortName: 'Landing',
        buildingId: 'mainHouse',
        floorId: 'first',
        knxAreaLine: '1.1',
        isInterior: true,
        bounds: { minX: -3.5, maxX: 3.5, minY: 2.7, maxY: 5.2, minZ: -3.5, maxZ: 3.5 },
      },
    },
  },
  zones: {
    circuitMaxIntensity: {},
    modules: [
      {
        id: 'shell',
        name: 'Shell',
        buildingId: 'mainHouse',
        floorId: 'ground',
        zoneIds: ['groundHall', 'upperLanding'],
        build(ctx) {
          const oak = createFinishMaterial('oiled-oak');
          const stair = createStaircase({
            layout: 'straight',
            bottomY: 0,
            topY: 2.7,
            origin: [0, 2.2],
            direction: 'north',
            width: 1.0,
            includeLandingApron: false,
            balustradeSide: 'none',
          });
          if (Object.keys(stair.group.userData).length > 0) {
            throw new Error('createStaircase mutated userData!');
          }
          ctx.scene.add(stair.group);

          const groundSlab = new THREE.Mesh(prepGeo(new THREE.BoxGeometry(7.2, 0.2, 7.2)), oak);
          groundSlab.name = 'ground.slab';
          groundSlab.position.set(0, -0.102, 0);
          ctx.floor?.('ground').slabGroup.add(groundSlab);

          const upperSlab = new THREE.Mesh(
            extrudePlanarSolidWithHoles({
              outer: [[-3.6, -3.6], [3.6, -3.6], [3.6, 3.6], [-3.6, 3.6]],
              holes: [[...stair.voidOpeningXZ]],
              origin: [0, 2.7, 0],
              uAxis: [1, 0, 0],
              vAxis: [0, 0, 1],
              wAxis: [0, 1, 0],
              depthRange: [-0.22, -0.002],
            }),
            oak
          );
          upperSlab.name = 'first.slab';
          ctx.floor?.('first').slabGroup.add(upperSlab);
          return {};
        },
      },
    ],
  },
});
`,
      'utf8'
    );

    try {
      const logs: string[] = [];
      const errors: string[] = [];
      const code = await dispatchHusjsCli(
        ['audit', '--house', houseFile, '--strict', '--json'],
        { log: (m: string) => logs.push(m), error: (m: string) => errors.push(m) }
      );
      expect(errors).toEqual([]);
      expect(code).toBe(0);
      const report = JSON.parse(logs.join('\n'));
      expect(report.passed).toBe(true);
      expect(report.checks.walkthrough.status).toBe('pass');
      expect(report.checks.zFighting.status).toBe('pass');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 25000);
});
