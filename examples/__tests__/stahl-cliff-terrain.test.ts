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
import {
  createTerrainSampler,
  gradePad,
  resolveTerrainBiomeConfig,
  type TerrainBiomePreset,
} from 'husjs';
import { assertNoZFighting } from 'husjs/testing';
import {
  buildPropertySceneContent,
  buildTopographicSiteGroundGeometry,
  createPropertySceneLayers,
  createSiteGround,
  RoomLodController,
} from 'husjs/viewer';
import {
  STAHL_TERRAIN_CONFIG,
  stahlHouse,
  stahlTerrainSampler,
} from '../stahl-house/index.ts';

function buildStahlTestScene(): THREE.Scene {
  const profile = stahlHouse.createSceneProfile();
  const scene = new THREE.Scene();
  const layers = createPropertySceneLayers(scene, profile.floors);
  const registry = profile.createZoneRegistry();
  const lodController = new RoomLodController(profile.lodRegistrations);
  buildPropertySceneContent(layers, {
    profile,
    registry,
    lodController,
    ceilingCutaway: false,
  });
  return scene;
}

describe('Stage 4.12 — Slope-Driven Arid Terrain Biome & Stahl House Rocky Cliff Escarpment', () => {
  it('resolves TerrainBiomePreset defaults cleanly while keeping lush-meadow as the backwards-compatible default', () => {
    const defaultBiome = resolveTerrainBiomeConfig(undefined);
    expect(defaultBiome.preset).toBe('lush-meadow');
    expect(defaultBiome.triplanarScaleM).toBeGreaterThan(0);

    const presets: readonly TerrainBiomePreset[] = ['lush-meadow', 'arid-chaparral', 'rocky-bluff'];
    for (const preset of presets) {
      const cfg = resolveTerrainBiomeConfig(preset);
      expect(cfg.preset).toBe(preset);
      expect(cfg.cliffSlopeMinDeg).toBeGreaterThan(cfg.gentleSlopeMaxDeg);
    }

    const custom = resolveTerrainBiomeConfig({
      preset: 'rocky-bluff',
      gentleSlopeMaxDeg: 13,
      cliffSlopeMinDeg: 32,
      triplanarScaleM: 5.5,
    });
    expect(custom.preset).toBe('rocky-bluff');
    expect(custom.gentleSlopeMaxDeg).toBe(13);
    expect(custom.cliffSlopeMinDeg).toBe(32);
    expect(custom.triplanarScaleM).toBe(5.5);
  });

  it('wires slope + triplanar cliff TSL nodes (colorNode, roughnessNode, normalNode) for arid/rocky biomes without touching lush-meadow', () => {
    const footprint = { centerX: 0, centerZ: 0, radius: 25 };
    const lushSampler = createTerrainSampler({
      base: (x, z) => -0.02 * x - 0.01 * z,
      modifiers: [],
    });
    expect(lushSampler.biome).toBeUndefined();
    const lushGround = createSiteGround(footprint, lushSampler);
    const lushMat = lushGround.mesh.material as unknown as Record<string, unknown>;
    expect(lushMat.colorNode).toBeTruthy();
    expect(lushMat.roughnessNode).toBeFalsy();
    expect(lushMat.normalNode).toBeFalsy();
    lushGround.dispose();

    const rockyGround = createSiteGround(footprint, stahlTerrainSampler);
    const rockyMat = rockyGround.mesh.material as THREE.MeshStandardMaterial & Record<string, unknown>;
    expect(stahlTerrainSampler.biome).toBe('rocky-bluff');
    expect(rockyMat.colorNode).toBeTruthy();
    expect(rockyMat.roughnessNode).toBeTruthy();
    expect(rockyMat.normalNode).toBeTruthy();
    expect(rockyMat.vertexColors).toBe(false);
    expect(rockyMat.userData.terrainBiomePreset).toBe('rocky-bluff');

    const rockyGeo = buildTopographicSiteGroundGeometry(stahlTerrainSampler);
    const triCount = rockyGeo.index ? rockyGeo.index.count / 3 : 0;
    expect(triCount).toBeGreaterThan(4000);
    expect(triCount).toBeLessThan(10000);
    rockyGeo.dispose();

    // Analytical heightfield raycast works down the deep (-45 m+) Hollywood Hills cliff face
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(12, 40, 20),
      new THREE.Vector3(0, -1, 0),
      0.1,
      200
    );
    const hits: THREE.Intersection[] = [];
    rockyGround.mesh.raycast(raycaster, hits);
    expect(hits.length).toBe(1);
    expect(hits[0].point.y).toBeCloseTo(stahlTerrainSampler.sampleTerrainY(12, 20), 1);
    rockyGround.dispose();
  });

  it('grades the Stahl House promontory pad with a dusty NE nose and sharp >42° rocky bluff plunge beneath the cantilevered beams', () => {
    expect(STAHL_TERRAIN_CONFIG.biome).toBe('rocky-bluff');

    // Level compacted promontory pad under main floor / courtyard & pool basin carve
    expect(stahlTerrainSampler.sampleTerrainY(0, 0)).toBeCloseTo(-0.14, 2);
    expect(stahlTerrainSampler.sampleTerrainY(-12, 4)).toBeCloseTo(-0.14, 2);
    expect(stahlTerrainSampler.sampleTerrainY(-6, 4)).toBeCloseTo(-1.75, 2);

    // Real USGS 3DEP 1m LiDAR promontory relief: no artificial dome directly behind North wing,
    // gentle N-S Woods Drive approach ridge, and natural West canyon drop beyond carport
    expect(stahlTerrainSampler.sampleTerrainY(0, -16)).toBeLessThan(1.5);
    expect(stahlTerrainSampler.sampleTerrainY(0, -16)).toBeGreaterThan(-4.0);
    expect(stahlTerrainSampler.sampleTerrainY(-18.5, -32)).toBeGreaterThan(1.2);
    expect(stahlTerrainSampler.sampleTerrainY(-18.5, -32)).toBeLessThan(4.5);
    expect(stahlTerrainSampler.sampleTerrainY(-36, -14)).toBeLessThan(-10);

    // Dusty decomposed-granite promontory nose extending ~2.5 m past the NE glass corner
    const noseY = stahlTerrainSampler.sampleTerrainY(7.8, -3.6);
    expect(noseY).toBeGreaterThan(-0.6);
    expect(noseY).toBeLessThan(0.1);

    // Sharp cliff plunge directly beneath the cantilevered Living/Dining grade beams (X4 = 6.096, Z3 = 12.192)
    expect(stahlTerrainSampler.sampleTerrainY(6.1, 4.5)).toBeLessThan(-3.5);
    expect(stahlTerrainSampler.sampleTerrainY(4.5, 12.2)).toBeLessThan(-4.5);
    expect(stahlTerrainSampler.sampleTerrainY(0, 60)).toBeLessThan(-30);
    expect(stahlTerrainSampler.sampleTerrainY(60, 60)).toBeLessThan(-35);

    const eastCliffNormal = stahlTerrainSampler.sampleNormal(5.2, 4.0, 0.4);
    const eastCliffSlopeDeg = (Math.acos(Math.max(-1, Math.min(1, eastCliffNormal.ny))) * 180) / Math.PI;
    expect(eastCliffSlopeDeg).toBeGreaterThan(42);
    expect(eastCliffSlopeDeg).toBeLessThan(72);

    // Non-destructive modifier composition still works over Stahl's rocky-bluff config
    const customSampler = createTerrainSampler({
      ...STAHL_TERRAIN_CONFIG,
      modifiers: [
        ...(STAHL_TERRAIN_CONFIG.modifiers ?? []),
        gradePad({ id: 'test-bench', minX: 14, maxX: 16, minZ: 14, maxZ: 16, elevationY: -12 }),
      ],
    });
    expect(customSampler.sampleTerrainY(15, 15)).toBeCloseTo(-12, 2);
  });

  it('populates craggy decomposed-granite outcrops, deergrass tussocks, fountain plumes & Agave attenuata with 0 z-fighting overlaps', () => {
    const scene = buildStahlTestScene();

    const cliffGroup = scene.getObjectByName('stahl.cliffEscarpment');
    expect(cliffGroup).toBeTruthy();

    const outcrops = scene.getObjectByName('stahl.cliffOutcrops');
    expect(outcrops).toBeTruthy();
    expect(outcrops!.children.length).toBeGreaterThanOrEqual(12);

    const deergrass = scene.getObjectByName('stahl.chaparral.deergrassTussocks') as THREE.Mesh;
    expect(deergrass).toBeInstanceOf(THREE.Mesh);
    expect(deergrass.geometry.attributes.position.count).toBeGreaterThan(8000);

    const plumes = scene.getObjectByName('stahl.chaparral.fountainPlumes') as THREE.Mesh;
    expect(plumes).toBeInstanceOf(THREE.Mesh);
    expect(plumes.geometry.attributes.position.count).toBeGreaterThan(800);

    const agaves = scene.getObjectByName('stahl.chaparral.agaveRosettes') as THREE.Mesh;
    expect(agaves).toBeInstanceOf(THREE.Mesh);
    expect(agaves.geometry.attributes.position.count).toBeGreaterThan(400);

    cliffGroup!.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        expect(obj.userData.ignoreWalkthroughCollision).toBe(true);
      }
    });

    assertNoZFighting(scene, { epsilonM: 0.00035 });
  });
});
