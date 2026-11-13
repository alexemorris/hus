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
import { runArchitecturalAudit } from 'husjs/testing';
import {
  buildPropertySceneContent,
  createPropertySceneLayers,
  RoomLodController,
} from 'husjs/viewer';
import {
  PhenologyMaterial,
  VEG_META_ATTR,
  classifyClimateZone,
  evaluateOrganPhenology,
} from 'husjs/vegetation';
import { simpleFlat } from '../simple-flat/index.ts';
import { simpleHouse } from '../simple-house/index.ts';
import { stahlHouse } from '../stahl-house/index.ts';

describe('husjs Example Homes — husjs/vegetation migration & phenology', () => {
  it('equips simple-house, simple-flat, and stahl-house with indoor and outdoor PhenologyMaterial', () => {
    for (const [label, houseDef] of [
      ['simple-house', simpleHouse],
      ['simple-flat', simpleFlat],
      ['stahl-house', stahlHouse],
    ] as const) {
      const profile = houseDef.createSceneProfile();
      const registry = profile.createZoneRegistry();
      const scene = new THREE.Scene();
      const layers = createPropertySceneLayers(scene, profile.floors);
      const lod = new RoomLodController(profile.lodRegistrations);
      const built = buildPropertySceneContent(layers, {
        profile,
        registry,
        lodController: lod,
        ceilingCutaway: false,
      });
      scene.updateMatrixWorld(true);

      let indoorPhenologyMeshes = 0;
      let outdoorPhenologyMeshes = 0;
      scene.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        const mat = obj.material;
        if (mat instanceof PhenologyMaterial) {
          const meta = obj.geometry.getAttribute(VEG_META_ATTR);
          expect(meta, `${label}: ${obj.name} missing aVegMeta`).toBeDefined();
          if (mat.exposure === 'indoor') {
            indoorPhenologyMeshes++;
            expect(meta.getZ(0)).toBeCloseTo(0.06, 2);
          } else if (mat.exposure === 'outdoor') {
            outdoorPhenologyMeshes++;
            expect(meta.getZ(0)).toBeGreaterThan(0.5);
          }
        }
      });
      expect(indoorPhenologyMeshes, `${label} indoor PhenologyMaterial count`).toBeGreaterThanOrEqual(2);
      expect(outdoorPhenologyMeshes, `${label} outdoor PhenologyMaterial count`).toBeGreaterThanOrEqual(6);

      if (label === 'stahl-house') {
        const spawns = houseDef.walkthrough?.spawns ?? [];
        const audit = runArchitecturalAudit(scene, {
          floors: profile.floors,
          roomZones: profile.lodRegistrations,
          interactions: built.interactions,
          doorPolicy: profile.doorPolicy,
          terrainSampler: profile.terrainSampler?.sampleTerrainY,
          ...(spawns[0] ? { entryPosition: spawns[0].position, entryZoneId: spawns[0].zoneId } : {}),
        });
        expect(audit.errorCount, `${label} audit errors`).toBe(0);
        expect(audit.warningCount, `${label} audit warnings`).toBe(0);
      }
    }

    const stahlClimate = classifyClimateZone(stahlHouse.location);
    expect(stahlClimate).toBe('mediterranean');
    const coolSeasonGrass = evaluateOrganPhenology({
      organ: 'warm-season-grass',
      yearPhase: 45 / 365,
      climateZone: stahlClimate,
      exposure: 'outdoor',
    });
    const lateSummerGrass = evaluateOrganPhenology({
      organ: 'warm-season-grass',
      yearPhase: 235 / 365,
      climateZone: stahlClimate,
      exposure: 'outdoor',
    });
    expect(lateSummerGrass.autumnSenescence).toBeGreaterThan(coolSeasonGrass.autumnSenescence + 0.35);

    const houseClimate = classifyClimateZone(simpleHouse.location);
    const indoorWinterLeaf = evaluateOrganPhenology({
      organ: 'deciduous-leaf',
      yearPhase: 10 / 365,
      climateZone: houseClimate,
      exposure: 'indoor',
    });
    const outdoorWinterLeaf = evaluateOrganPhenology({
      organ: 'deciduous-leaf',
      yearPhase: 10 / 365,
      climateZone: houseClimate,
      exposure: 'outdoor',
    });
    expect(indoorWinterLeaf.organScale).toBeGreaterThan(0.93);
    expect(outdoorWinterLeaf.organScale).toBe(0);
  }, 30000);
});
