import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EnvironmentLighting } from '../../../engine/lighting/environment-lighting.ts';
import { RoomLodController } from '../../../engine/lod/lod-manager.ts';
import { SceneBatchOptimizer } from '../../../engine/rendering/scene-batch-optimizer.ts';
import { classifyObject } from '../../../engine/trade-views/trade-classifier.ts';
import { createPropertySceneLayers } from '../../../engine/viewer/scene-content.ts';
import {
  classifyClimateZone,
  computeYearPhase,
  evaluateOrganPhenology,
  getExposureEnvelope,
} from '../../../core/geo/climate-phenology.ts';
import {
  PhenologyMaterial,
  VEG_META_ATTR,
  VEG_PIVOT_ATTR,
  VegetationPhenologyController,
  createClimber,
  createFlowerBed,
  createHedge,
  createHouseplant,
  createShrub,
  createTopiary,
  createTree,
  createXerophyte,
  type ClimberSpecies,
  type FlowerBedStyle,
  type HedgeSpecies,
  type HouseplantSpecies,
  type ShrubSpecies,
  type TopiaryForm,
  type TreeSpecies,
  type XerophyteSpecies,
} from '../index.ts';

type OptimizerDeps = ConstructorParameters<typeof SceneBatchOptimizer>[0];

describe('husjs/vegetation climate classification, seasonal phenology & batching', () => {
  it('classifies global architectural climate zones and respects climateOverride', () => {
    expect(classifyClimateZone({ lat: 52.63, lon: -1.13 })).toBe('temperate-maritime');
    expect(classifyClimateZone({ lat: 51.51, lon: -0.13 })).toBe('temperate-maritime');
    expect(classifyClimateZone({ lat: 34.1, lon: -118.37, elevationM: 220 })).toBe('mediterranean');
    expect(classifyClimateZone({ lat: 33.83, lon: -116.54, elevationM: 145 })).toBe('arid');
    expect(classifyClimateZone({ lat: 25.76, lon: -80.19, elevationM: 4 })).toBe('subtropical');
    expect(classifyClimateZone({ lat: 46.81, lon: 9.84, elevationM: 1560 })).toBe('continental');
    expect(
      classifyClimateZone({
        lat: 51.51,
        lon: -0.13,
        climateOverride: 'mediterranean',
      })
    ).toBe('mediterranean');
  });

  it('computes continuous yearPhase landmarks and flips +0.5 in the Southern Hemisphere', () => {
    const springN = computeYearPhase(80, 51.8);
    const summerN = computeYearPhase(172, 51.8);
    const autumnN = computeYearPhase(265, 51.8);
    const winterN = computeYearPhase(355, 51.8);

    expect(springN).toBeCloseTo((80 - 1) / 365, 4);
    expect(summerN).toBeCloseTo((172 - 1) / 365, 4);
    expect(autumnN).toBeCloseTo((265 - 1) / 365, 4);
    expect(winterN).toBeCloseTo((355 - 1) / 365, 4);

    const sydneyDec = computeYearPhase(355, -33.87);
    expect(sydneyDec).toBeCloseTo(((355 - 1) / 365 + 0.5) % 1, 4);
    const sydneyOakDec = evaluateOrganPhenology({
      organ: 'deciduous-leaf',
      yearPhase: sydneyDec,
      climateZone: 'temperate-maritime',
      exposure: 'outdoor',
    });
    expect(sydneyOakDec.organScale).toBeGreaterThan(0.95);
  });

  it('separates outdoor, greenhouse, and indoor exposure envelopes cleanly', () => {
    const outEnv = getExposureEnvelope('outdoor');
    const ghEnv = getExposureEnvelope('greenhouse');
    const inEnv = getExposureEnvelope('indoor');

    expect(outEnv.reactivity).toBe(1.0);
    expect(ghEnv.reactivity).toBeCloseTo(0.3, 3);
    expect(ghEnv.windScale).toBe(0);
    expect(ghEnv.snowScale).toBe(0);
    expect(inEnv.reactivity).toBeCloseTo(0.06, 3);
    expect(inEnv.windScale).toBe(0);
    expect(inEnv.snowScale).toBe(0);
    expect(inEnv.leafDropAllowed).toBe(false);
    expect(inEnv.senescenceScale).toBe(0);

    const winterPhase = computeYearPhase(355, 52.0);
    const outdoorWinterLeaf = evaluateOrganPhenology({
      organ: 'deciduous-leaf',
      yearPhase: winterPhase,
      climateZone: 'temperate-maritime',
      exposure: 'outdoor',
    });
    const greenhouseWinterLeaf = evaluateOrganPhenology({
      organ: 'deciduous-leaf',
      yearPhase: winterPhase,
      climateZone: 'temperate-maritime',
      exposure: 'greenhouse',
    });
    const indoorWinterLeaf = evaluateOrganPhenology({
      organ: 'deciduous-leaf',
      yearPhase: winterPhase,
      climateZone: 'temperate-maritime',
      exposure: 'indoor',
    });

    expect(outdoorWinterLeaf.organScale).toBe(0);
    expect(greenhouseWinterLeaf.organScale).toBeGreaterThan(0.75);
    expect(indoorWinterLeaf.organScale).toBeGreaterThan(0.93);

    const autumnPhase = computeYearPhase(274, 52.0);
    const outdoorAutumn = evaluateOrganPhenology({
      organ: 'deciduous-leaf',
      yearPhase: autumnPhase,
      climateZone: 'temperate-maritime',
      exposure: 'outdoor',
      baseColorRgb: [0.22, 0.42, 0.16],
      variantParam: 0.9,
    });
    const indoorAutumn = evaluateOrganPhenology({
      organ: 'deciduous-leaf',
      yearPhase: autumnPhase,
      climateZone: 'temperate-maritime',
      exposure: 'indoor',
      baseColorRgb: [0.22, 0.42, 0.16],
      variantParam: 0.9,
    });
    expect(outdoorAutumn.autumnSenescence).toBeGreaterThan(0.6);
    expect(outdoorAutumn.colorRgb[0]).toBeGreaterThan(outdoorAutumn.colorRgb[1]);
    expect(indoorAutumn.autumnSenescence).toBe(0);
    expect(indoorAutumn.colorRgb[1]).toBeGreaterThan(indoorAutumn.colorRgb[0]);
  });

  it('models multi-organ seasonal curves: spring blossom, marcescent beech, summer rose, fruit & chaparral grass', () => {
    const springPhase = computeYearPhase(88, 52.0);
    const summerPhase = computeYearPhase(185, 52.0);
    const autumnPhase = computeYearPhase(245, 52.0);
    const winterPhase = computeYearPhase(355, 52.0);

    const blossomSpring = evaluateOrganPhenology({
      organ: 'spring-blossom',
      yearPhase: springPhase,
      climateZone: 'temperate-maritime',
      exposure: 'outdoor',
    });
    const blossomSummer = evaluateOrganPhenology({
      organ: 'spring-blossom',
      yearPhase: summerPhase,
      climateZone: 'temperate-maritime',
      exposure: 'outdoor',
    });
    expect(blossomSpring.organScale).toBeGreaterThan(0.7);
    expect(blossomSummer.organScale).toBe(0);

    const beechWinter = evaluateOrganPhenology({
      organ: 'marcescent-leaf',
      yearPhase: winterPhase,
      climateZone: 'temperate-maritime',
      exposure: 'outdoor',
      baseColorRgb: [0.29, 0.13, 0.17],
    });
    expect(beechWinter.organScale).toBeCloseTo(0.75, 2);

    const appleAutumn = evaluateOrganPhenology({
      organ: 'fruit',
      yearPhase: autumnPhase,
      climateZone: 'temperate-maritime',
      exposure: 'outdoor',
      variantParam: 0.2,
    });
    const hollyWinter = evaluateOrganPhenology({
      organ: 'fruit',
      yearPhase: winterPhase,
      climateZone: 'temperate-maritime',
      exposure: 'outdoor',
      variantParam: 0.85,
    });
    expect(appleAutumn.organScale).toBeGreaterThan(0.5);
    expect(hollyWinter.organScale).toBeGreaterThan(0.85);

    const deergrassSpring = evaluateOrganPhenology({
      organ: 'warm-season-grass',
      yearPhase: computeYearPhase(85, 34.1),
      climateZone: 'mediterranean',
      exposure: 'outdoor',
      baseColorRgb: [0.33, 0.48, 0.23],
    });
    const deergrassLateSummer = evaluateOrganPhenology({
      organ: 'warm-season-grass',
      yearPhase: computeYearPhase(235, 34.1),
      climateZone: 'mediterranean',
      exposure: 'outdoor',
      baseColorRgb: [0.33, 0.48, 0.23],
    });
    expect(deergrassSpring.colorRgb[1]).toBeGreaterThan(deergrassSpring.colorRgb[0]);
    expect(deergrassLateSummer.colorRgb[0]).toBeGreaterThan(deergrassLateSummer.colorRgb[1]);
  });

  it('builds all procedural species presets with baked aVegPivot/aVegMeta attributes and O(1) uniform updates', () => {
    const trees: readonly TreeSpecies[] = [
      'english-oak',
      'silver-birch',
      'weeping-willow',
      'flowering-cherry',
      'magnolia',
      'orchard-apple',
      'orchard-pear',
      'orchard-plum',
      'fig-tree',
      'olive-tree',
      'lemon-tree',
      'holly-tree',
      'scots-pine',
      'italian-cypress',
    ];
    for (const species of trees) {
      const g = createTree({ species });
      expect(g.children.length).toBeGreaterThanOrEqual(2);
      expect(classifyObject(g)).toBe('external');
    }

    const topiaries: readonly TopiaryForm[] = [
      'bay-standard',
      'buxus-ball',
      'buxus-cone',
      'buxus-spiral',
      'olive-planter',
    ];
    for (const form of topiaries) {
      expect(createTopiary({ form }).children.length).toBeGreaterThan(0);
    }

    const hedges: readonly HedgeSpecies[] = ['yew', 'boxwood', 'copper-beech', 'privet', 'laurel'];
    for (const species of hedges) {
      expect(createHedge({ species, length: 2.4 }).children.length).toBeGreaterThan(0);
    }

    const climbers: readonly ClimberSpecies[] = [
      'english-ivy',
      'virginia-creeper',
      'climbing-rose',
      'wisteria',
      'star-jasmine',
      'grapevine',
    ];
    for (const species of climbers) {
      expect(createClimber({ species, support: 'wall-plane' }).children.length).toBeGreaterThan(0);
    }

    const shrubs: readonly ShrubSpecies[] = [
      'english-rose-shrub',
      'hydrangea',
      'lavender',
      'rosemary',
      'rhododendron',
    ];
    for (const species of shrubs) {
      expect(createShrub({ species }).children.length).toBeGreaterThan(0);
    }

    const beds: readonly FlowerBedStyle[] = [
      'cottage-perennial-border',
      'spring-bulb-drift',
      'kitchen-garden-bed',
    ];
    for (const style of beds) {
      expect(createFlowerBed({ style }).children.length).toBeGreaterThan(0);
    }

    const xerophytes: readonly XerophyteSpecies[] = [
      'agave-attenuata',
      'california-deergrass',
      'barrel-cactus',
      'aloe',
    ];
    for (const species of xerophytes) {
      expect(createXerophyte({ species }).children.length).toBeGreaterThan(0);
    }

    const houseplants: readonly HouseplantSpecies[] = [
      'fiddle-leaf-fig',
      'monstera-deliciosa',
      'calathea-pothos',
      'olive-indoor',
      'sansevieria',
      'kentia-palm',
      'boston-fern',
      'trailing-ivy',
    ];
    for (const species of houseplants) {
      const hp = createHouseplant({ species });
      expect(hp.userData['vegetationExposure']).toBe('indoor');
      expect(classifyObject(hp)).toBe('decor');
    }

    const ctl = new VegetationPhenologyController();
    const cherry = createTree({ species: 'flowering-cherry', uniforms: ctl.uniforms });
    const foliageMesh = cherry.children.find(
      (c): c is THREE.Mesh => c instanceof THREE.Mesh && c.name.endsWith('.foliage')
    )!;
    const geoBefore = foliageMesh.geometry;
    const posArrayBefore = geoBefore.getAttribute('position').array;
    ctl.syncFromEnvironment({
      location: { lat: 52.2, lon: -1.5 },
      dayOfYear: 95,
    });
    ctl.syncFromEnvironment({
      location: { lat: 52.2, lon: -1.5 },
      dayOfYear: 275,
    });
    expect(foliageMesh.geometry).toBe(geoBefore);
    expect(foliageMesh.geometry.getAttribute('position').array).toBe(posArrayBefore);
  });

  it('transforms aVegPivot by world matrix during SceneBatchOptimizer / FastGeometryMerger merging', () => {
    const scene = new THREE.Scene();
    const layers = createPropertySceneLayers(scene);
    const lodController = new RoomLodController([]);
    const interactiveMeshes: THREE.Mesh[] = [];
    const dynamicSet = new Set<THREE.Object3D>();
    const optimizer = new SceneBatchOptimizer({
      layers,
      lodController,
      interactiveMeshes,
      bifoldPanels: [],
      lightGroups: {} as OptimizerDeps['lightGroups'],
      indicatorMats: {} as OptimizerDeps['indicatorMats'],
      roomSwitchLedMats: [],
      getDynamicObjects: () => dynamicSet,
    });

    const gardenGroup = new THREE.Group();
    gardenGroup.name = 'garden.orchard';
    // Place both trees inside the same 10m spatial cell so they merge into one combined foliage batch mesh
    const treeA = createTree({ species: 'orchard-apple', seed: 11 });
    treeA.position.set(22, 0, -14);
    const treeB = createTree({ species: 'flowering-cherry', seed: 22 });
    treeB.position.set(26, 1.5, -17);
    treeB.rotation.y = Math.PI * 0.5;
    gardenGroup.add(treeA, treeB);
    scene.add(gardenGroup);
    scene.updateMatrixWorld(true);

    optimizer.optimize();

    const batchedMeshes: THREE.Mesh[] = [];
    scene.traverse((obj) => {
      if (
        obj instanceof THREE.Mesh &&
        obj.userData['isBatchedStaticMesh'] === true &&
        obj.material instanceof PhenologyMaterial &&
        obj.material.surfaceKind === 'foliage'
      ) {
        batchedMeshes.push(obj);
      }
    });

    expect(batchedMeshes.length).toBe(1);
    const mergedMesh = batchedMeshes[0]!;
    const mergedGeo = mergedMesh.geometry;
    const pos = mergedGeo.getAttribute('position') as THREE.BufferAttribute;
    const piv = mergedGeo.getAttribute(VEG_PIVOT_ATTR) as THREE.BufferAttribute;
    const meta = mergedGeo.getAttribute(VEG_META_ATTR) as THREE.BufferAttribute;

    expect(piv).toBeDefined();
    expect(meta).toBeDefined();
    expect(piv.count).toBe(pos.count);
    expect(meta.count).toBe(pos.count);

    // Every transformed leaf vertex must remain within organ-scale distance (< 0.65m) of its world-space twig pivot!
    // If aVegPivot were NOT transformed by mesh.matrixWorld, vertices at (22..26, -14..-17) would be >25m from local (0,0,0)!
    let maxDist = 0;
    let foundTranslatedTreeA = false;
    let foundTranslatedTreeB = false;
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - piv.getX(i);
      const dy = pos.getY(i) - piv.getY(i);
      const dz = pos.getZ(i) - piv.getZ(i);
      const d = Math.hypot(dx, dy, dz);
      if (d > maxDist) maxDist = d;
      const worldPivX = piv.getX(i) + mergedMesh.position.x;
      const worldPivZ = piv.getZ(i) + mergedMesh.position.z;
      if (worldPivX < 23.5 && worldPivZ > -15.5) foundTranslatedTreeA = true;
      if (worldPivX > 24.5 && worldPivZ < -15.5) foundTranslatedTreeB = true;
    }
    expect(maxDist).toBeLessThan(0.65);
    expect(foundTranslatedTreeA).toBe(true);
    expect(foundTranslatedTreeB).toBe(true);
  });

  it('supports fractional dayOfYear scrubbing and ~750ms smooth season easing in EnvironmentLighting', () => {
    const scene = new THREE.Scene();
    const fakeRenderer = {} as ConstructorParameters<typeof EnvironmentLighting>[1];
    const env = new EnvironmentLighting(scene, fakeRenderer, undefined, {
      lat: 52.0,
      lon: -1.5,
    });
    env.setTimeOfDay('day', { animate: false });

    const snapA = env.setSolarDateTime({ civilHour: 13, dayOfYear: 110.25, year: 2026 });
    const phaseA = env.vegetationPhenology.uniforms.uYearPhase.value;
    const snapB = env.setSolarDateTime({ civilHour: 13, dayOfYear: 110.75, year: 2026 });
    const phaseB = env.vegetationPhenology.uniforms.uYearPhase.value;
    expect(snapA.solar.dayOfYear).toBeCloseTo(110.25, 3);
    expect(snapB.solar.dayOfYear).toBeCloseTo(110.75, 3);
    expect(phaseB).toBeGreaterThan(phaseA);

    env.setSeason('autumn', { animate: true });
    expect(env.isTransitioning()).toBe(true);

    env.stepTransition(0.375);
    const midDoy = env.getSkyWeatherSnapshot().solar.dayOfYear;
    expect(midDoy).toBeGreaterThan(130);
    expect(midDoy).toBeLessThan(255);
    expect(env.isTransitioning()).toBe(true);

    env.stepTransition(0.45);
    for (let i = 0; i < 6 && env.isTransitioning(); i++) {
      env.stepTransition(0.25);
    }
    expect(env.getSkyWeatherSnapshot().solar.dayOfYear).toBeCloseTo(288, 1);
    expect(env.isTransitioning()).toBe(false);
  });
});
