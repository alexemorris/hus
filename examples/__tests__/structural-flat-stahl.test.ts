if (typeof globalThis.document === 'undefined') {
  const noop = () => undefined;
  const grad = { addColorStop: noop };
  const ctx2d = new Proxy(
    {
      createLinearGradient: () => grad,
      createRadialGradient: () => grad,
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
      }),
      measureText: () => ({ width: 10 }),
    },
    { get: (target, prop) => (prop in target ? (target as Record<PropertyKey, unknown>)[prop] : noop) }
  );
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => ({
      width: 256,
      height: 256,
      getContext: () => ctx2d,
    }),
  };
}
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { HouseDefinition } from 'husjs';
import { assertNoZFighting, runArchitecturalAudit } from 'husjs/testing';
import {
  buildPropertySceneContent,
  createPropertySceneLayers,
  RoomLodController,
} from 'husjs/viewer';
import { simpleFlat } from '../simple-flat/index.ts';
import { stahlHouse } from '../stahl-house/index.ts';

function buildFullHouseScene(house: HouseDefinition) {
  const profile = house.createSceneProfile();
  const registry = profile.createZoneRegistry();
  const scene = new THREE.Scene();
  const layers = createPropertySceneLayers(scene, profile.floors);
  const lodController = new RoomLodController(profile.lodRegistrations);
  const built = buildPropertySceneContent(layers, {
    profile,
    registry,
    lodController,
    ceilingCutaway: false,
  });
  scene.updateMatrixWorld(true);
  return { scene, profile, built };
}

function worldBoxOf(root: THREE.Object3D, name: string): THREE.Box3 {
  const obj = root.getObjectByName(name);
  expect(obj, `Expected scene object "${name}" to exist`).toBeDefined();
  return new THREE.Box3().setFromObject(obj!);
}

describe('Stream S2 structural poché & exposed steel (simple-flat & stahl-house)', { timeout: 30_000 }, () => {
  it('simple-flat has solid 360 mm exterior walls, 240 mm load-bearing spine, and exposed living/kitchen UB RSJ', () => {
    const { scene, profile, built } = buildFullHouseScene(simpleFlat);

    // 1. 360 mm exterior London Stock masonry (IN_X = 4.20, IN_Z = 3.40 preserved; outer brick at +-4.56 / +-3.76)
    const northBrick = worldBoxOf(scene, 'simpleFlat.wall.northBrick');
    const southBrick = worldBoxOf(scene, 'simpleFlat.wall.southBrick');
    const eastBrick = worldBoxOf(scene, 'simpleFlat.wall.eastBrick');
    const westBrick = worldBoxOf(scene, 'simpleFlat.wall.westBrick');
    expect(northBrick.min.z).toBeCloseTo(-3.76, 3);
    expect(southBrick.max.z).toBeCloseTo(3.76, 3);
    expect(eastBrick.max.x).toBeCloseTo(4.56, 3);
    expect(westBrick.min.x).toBeCloseTo(-4.56, 3);

    // Zero 14 mm exterior hollow air trench between brick core and interior room plaster lining
    const northKitLining = worldBoxOf(scene, 'simpleFlat.wall.northKitchenLining');
    expect(northKitLining.min.z - northBrick.max.z).toBeLessThanOrEqual(0.002);

    // 2. 240 mm load-bearing central spine wall (X in [-0.78, -0.54]) with solid poché core & top cap
    const spineTopCap = worldBoxOf(scene, 'simpleFlat.wall.spineTopCap');
    expect(spineTopCap.min.x).toBeCloseTo(-0.7795, 3);
    expect(spineTopCap.max.x).toBeCloseTo(-0.5405, 3);
    const spineCore = worldBoxOf(scene, 'simpleFlat.wall.spineCore');
    expect(spineCore.max.x - spineCore.min.x).toBeGreaterThan(0.21);

    // 3. Exposed flanged 203 x 133 x 30 UB RSJ spanning Living/Kitchen at Z = -1.14 m on engaged piers & padstones
    const rsj = worldBoxOf(scene, 'flat.structure.livingKitchenRsj');
    expect(rsj.min.x).toBeLessThan(-0.53);
    expect(rsj.max.x).toBeGreaterThan(4.18);
    expect((rsj.min.z + rsj.max.z) * 0.5).toBeCloseTo(-1.14, 3);
    expect(rsj.min.y).toBeCloseTo(2.5225, 3);
    expect(rsj.max.y).toBeCloseTo(2.7485, 3);

    const pierWestMasonry = worldBoxOf(scene, 'flat.structure.rsjPierWest.masonry');
    const pierWestPadstone = worldBoxOf(scene, 'flat.structure.rsjPadstoneWest');
    const pierEastObj = scene.getObjectByName('flat.structure.rsjPierEast');
    expect(pierWestMasonry.max.x).toBeCloseTo(-0.36, 3);
    expect(pierWestPadstone.max.x).toBeCloseTo(-0.355, 3);
    expect(pierEastObj?.userData.cutawayWall).toBeDefined();

    const spinePortalSteel = worldBoxOf(scene, 'flat.structure.spinePortalSteel');
    expect(spinePortalSteel.min.z).toBeLessThan(1.43);
    expect(spinePortalSteel.max.z).toBeGreaterThan(2.47);

    assertNoZFighting(scene, { epsilonM: 0.00035 });
    const spawns = simpleFlat.walkthrough?.spawns ?? [];
    const report = runArchitecturalAudit(scene, {
      floors: profile.floors,
      roomZones: profile.lodRegistrations,
      interactions: built.interactions,
      doorPolicy: profile.doorPolicy,
      terrainSampler: profile.terrainSampler?.sampleTerrainY,
      ...(spawns[0] ? { entryPosition: spawns[0].position, entryZoneId: spawns[0].zoneId } : {}),
    });
    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(0);
  });

  it('stahl-house seals northPrivacyWall 109 mm trench and ties all 20ft WF H-columns with steel portal headers', () => {
    const { scene, profile, built } = buildFullHouseScene(stahlHouse);

    // 1. Solid structural steel-stud core bays & top closure caps inside stahl.northPrivacyWall
    const northGroup = scene.getObjectByName('stahl.northPrivacyWall');
    expect(northGroup?.userData.cutawayWall).toBeDefined();
    for (const bay of ['bay12', 'bay23', 'bay34'] as const) {
      const coreBox = worldBoxOf(scene, `stahl.northPrivacyWall.core_${bay}`);
      expect(coreBox.max.z - coreBox.min.z).toBeCloseTo(0.105, 3);
      expect(coreBox.max.y - coreBox.min.y).toBeGreaterThan(2.57);
      const capBox = worldBoxOf(scene, `stahl.northPrivacyWall.closureCap_${bay}`);
      expect(capBox.max.z - capBox.min.z).toBeGreaterThan(0.2);
    }

    // 2. Welded steelCharcoal moment-frame header / collar tie channels in root along the 20'x20' grid
    const portalHeaders = scene.getObjectByName('stahl.steel.portalHeaders');
    expect(portalHeaders).toBeDefined();
    expect(portalHeaders?.parent?.name).toBe('stahlHouse.root');
    expect(portalHeaders!.children.length).toBeGreaterThanOrEqual(18);

    const interiorTie = worldBoxOf(scene, 'stahl.steel.portalHeader.Z1_X3_X4');
    expect(interiorTie.min.y).toBeCloseTo(2.588, 3);
    expect(interiorTie.max.y).toBeCloseTo(2.6402, 3);

    const eastPerimeterTie = scene.getObjectByName('stahl.steel.portalHeader.X4_Z1_Z2');
    expect(eastPerimeterTie?.userData.cutawayWall).toBeDefined();

    assertNoZFighting(scene, { epsilonM: 0.00035 });
    const spawns = stahlHouse.walkthrough?.spawns ?? [];
    const report = runArchitecturalAudit(scene, {
      floors: profile.floors,
      roomZones: profile.lodRegistrations,
      interactions: built.interactions,
      doorPolicy: profile.doorPolicy,
      terrainSampler: profile.terrainSampler?.sampleTerrainY,
      ...(spawns[0] ? { entryPosition: spawns[0].position, entryZoneId: spawns[0].zoneId } : {}),
    });
    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(0);
  });
});
