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
  const box = new THREE.Box3().setFromObject(obj!);
  expect(box.isEmpty(), `Expected "${name}" to have non-empty bounds`).toBe(false);
  for (const coord of [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z]) {
    expect(Number.isFinite(coord), `Expected finite bounds for "${name}"`).toBe(true);
  }
  return box;
}

describe('Structural poché & exposed steel (simple-flat & stahl-house)', { timeout: 30_000 }, () => {
  it('simple-flat has solid exterior walls, load-bearing spine, and exposed living/kitchen UB RSJ', () => {
    const { scene, profile, built } = buildFullHouseScene(simpleFlat);
    const cutawayY = profile.floors?.[0]?.ceilingCutawayY ?? 2.75;

    // Exterior masonry shell encloses the apartment footprint with solid wall depth
    const northBrick = worldBoxOf(scene, 'simpleFlat.wall.northBrick');
    const southBrick = worldBoxOf(scene, 'simpleFlat.wall.southBrick');
    const eastBrick = worldBoxOf(scene, 'simpleFlat.wall.eastBrick');
    const westBrick = worldBoxOf(scene, 'simpleFlat.wall.westBrick');
    expect(eastBrick.max.x - westBrick.min.x).toBeGreaterThan(8.5);
    expect(southBrick.max.z - northBrick.min.z).toBeGreaterThan(7.0);
    expect(northBrick.max.z - northBrick.min.z).toBeGreaterThan(0.25);
    expect(northBrick.max.z - northBrick.min.z).toBeLessThan(0.45);
    expect(eastBrick.max.x - eastBrick.min.x).toBeGreaterThan(0.25);
    expect(eastBrick.max.x - eastBrick.min.x).toBeLessThan(0.45);

    // Interior plaster lining sits flush against the exterior masonry core without an air trench
    const northKitLining = worldBoxOf(scene, 'simpleFlat.wall.northKitchenLining');
    expect(northKitLining.min.z - northBrick.max.z).toBeLessThanOrEqual(0.01);

    // Load-bearing central spine wall has solid poché thickness and top cap at the cutaway plane
    const spineTopCap = worldBoxOf(scene, 'simpleFlat.wall.spineTopCap');
    const spineCapWidth = spineTopCap.max.x - spineTopCap.min.x;
    expect(spineCapWidth).toBeGreaterThan(0.2);
    expect(spineCapWidth).toBeLessThan(0.3);
    expect(spineTopCap.max.y).toBeGreaterThan(cutawayY - 0.1);
    expect(spineTopCap.max.y).toBeLessThanOrEqual(cutawayY + 0.02);

    const spineCore = worldBoxOf(scene, 'simpleFlat.wall.spineCore');
    const spineCoreWidth = spineCore.max.x - spineCore.min.x;
    expect(spineCoreWidth).toBeGreaterThan(0.2);
    expect(spineCoreWidth).toBeLessThan(0.3);

    // Exposed flanged UB RSJ spans the living/kitchen opening and bears on piers and padstones
    const rsj = worldBoxOf(scene, 'flat.structure.livingKitchenRsj');
    const rsjDepth = rsj.max.y - rsj.min.y;
    expect(rsj.min.x).toBeLessThan(spineCore.max.x + 0.05);
    expect(rsj.max.x).toBeGreaterThan(eastBrick.min.x - 0.05);
    expect(rsj.max.x - rsj.min.x).toBeGreaterThan(4.5);
    expect(rsjDepth).toBeGreaterThan(0.15);
    expect(rsjDepth).toBeLessThan(0.35);
    expect(rsj.max.y).toBeLessThanOrEqual(cutawayY + 0.02);

    const pierWestMasonry = worldBoxOf(scene, 'flat.structure.rsjPierWest.masonry');
    const pierWestPadstone = worldBoxOf(scene, 'flat.structure.rsjPadstoneWest');
    const pierEastPadstone = worldBoxOf(scene, 'flat.structure.rsjPadstoneEast');
    const pierEastObj = scene.getObjectByName('flat.structure.rsjPierEast');
    expect(pierWestPadstone.min.y).toBeGreaterThanOrEqual(pierWestMasonry.max.y - 0.02);
    expect(rsj.min.x).toBeLessThan(pierWestPadstone.max.x);
    expect(rsj.max.x).toBeGreaterThan(pierEastPadstone.min.x);
    expect(rsj.min.y).toBeGreaterThanOrEqual(pierWestPadstone.max.y - 0.02);
    expect(pierEastObj?.userData.cutawayWall).toBeDefined();

    // Steel portal lintel spans across the hall-to-living spine opening
    const spinePortalSteel = worldBoxOf(scene, 'flat.structure.spinePortalSteel');
    expect(spinePortalSteel.max.z - spinePortalSteel.min.z).toBeGreaterThan(1.0);
    expect(spinePortalSteel.max.y - spinePortalSteel.min.y).toBeGreaterThan(0.08);

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

  it('stahl-house seals northPrivacyWall core bays and ties H-columns with steel portal headers', () => {
    const { scene, profile, built } = buildFullHouseScene(stahlHouse);
    const ceilingY = profile.floors?.[0]?.ceilingCutawayY ?? 2.642;

    // Solid structural steel-stud core bays & top closure caps inside stahl.northPrivacyWall
    const northGroup = scene.getObjectByName('stahl.northPrivacyWall');
    expect(northGroup?.userData.cutawayWall).toBeDefined();
    for (const bay of ['bay12', 'bay23', 'bay34'] as const) {
      const coreBox = worldBoxOf(scene, `stahl.northPrivacyWall.core_${bay}`);
      const coreThickness = coreBox.max.z - coreBox.min.z;
      expect(coreThickness).toBeGreaterThan(0.06);
      expect(coreThickness).toBeLessThan(0.2);
      expect(coreBox.max.y - coreBox.min.y).toBeGreaterThan(2.0);
      expect(coreBox.max.y).toBeLessThan(ceilingY);

      const capBox = worldBoxOf(scene, `stahl.northPrivacyWall.closureCap_${bay}`);
      expect(capBox.max.z - capBox.min.z).toBeGreaterThan(coreThickness);
      expect(capBox.min.y).toBeGreaterThanOrEqual(coreBox.max.y - 0.01);
      expect(capBox.max.y).toBeLessThan(ceilingY);
    }

    // Welded steel moment-frame header / collar tie channels in root along the structural grid
    const portalHeaders = scene.getObjectByName('stahl.steel.portalHeaders');
    expect(portalHeaders).toBeDefined();
    expect(portalHeaders?.parent?.name).toBe('stahlHouse.root');
    expect(portalHeaders!.children.length).toBeGreaterThanOrEqual(18);

    const interiorTie = worldBoxOf(scene, 'stahl.steel.portalHeader.Z1_X3_X4');
    const tieHeight = interiorTie.max.y - interiorTie.min.y;
    expect(tieHeight).toBeGreaterThan(0.03);
    expect(tieHeight).toBeLessThan(0.15);
    expect(interiorTie.max.y).toBeLessThanOrEqual(ceilingY);
    expect(interiorTie.min.y).toBeGreaterThan(ceilingY - 0.2);

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
