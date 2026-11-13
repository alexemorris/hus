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
  evaluateSeasonalTurfPhenology,
  getExposureEnvelope,
} from '../../../core/geo/climate-phenology.ts';
import {
  PhenologyMaterial,
  VEG_META_ATTR,
  VEG_PIVOT_ATTR,
  VegetationPhenologyController,
  createClimber,
  createFlowerBed,
  createGrassPatch,
  createHedge,
  createLawnTurf,
  createSoilBed,
  createSoilMaterial,
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

  it('retains full canopy in late September, 85-95% in October, 55-80% in mid-November with rich autumn pigmentation, and bare branches in mid-January', () => {
    const baseGreen: readonly [number, number, number] = [0.22, 0.42, 0.16];
    const evalTree = (day: number, variantParam = 0.5) =>
      evaluateOrganPhenology({
        organ: 'deciduous-leaf',
        yearPhase: computeYearPhase(day, 52.2),
        climateZone: 'temperate-maritime',
        exposure: 'outdoor',
        baseColorRgb: baseGreen,
        variantParam,
      });

    // Late September (day 270): > 0.92 full lush green canopy
    const lateSept = evalTree(270, 0.32);
    expect(lateSept.organScale).toBeGreaterThan(0.92);
    expect(lateSept.colorRgb[1]).toBeGreaterThan(lateSept.colorRgb[0]);

    // Mid-October (day 290): > 0.85 canopy retained with progressive autumn transition
    const midOct = evalTree(290, 0.32);
    expect(midOct.organScale).toBeGreaterThan(0.85);
    expect(midOct.autumnSenescence).toBeGreaterThan(0.35);

    // Mid-November (13 Nov = day 317): 0.50 .. 0.85 canopy retained with warm autumn pigmentation
    const midNovDefault = evalTree(317, 0.5);
    const midNovBirch = evalTree(317, 0.08);
    const midNovOak = evalTree(317, 0.32);
    const midNovCherry = evalTree(317, 0.72);
    for (const s of [midNovDefault, midNovBirch, midNovOak, midNovCherry]) {
      expect(s.organScale).toBeGreaterThanOrEqual(0.50);
      expect(s.organScale).toBeLessThanOrEqual(0.85);
      expect(s.autumnSenescence).toBeGreaterThan(0.65);
      expect(s.colorRgb[0]).toBeGreaterThan(s.colorRgb[1]);
    }
    // English Oak holds slightly more russet foliage in mid-Nov than early-dropping Virginia Creeper
    const octCreeper = evalTree(286, 0.92);
    const midNovCreeper = evalTree(317, 0.92);
    expect(octCreeper.autumnSenescence).toBeGreaterThan(0.75);
    expect(octCreeper.colorRgb[0]).toBeGreaterThan(octCreeper.colorRgb[1] * 1.6);
    expect(midNovOak.organScale).toBeGreaterThan(midNovCreeper.organScale);

    // Mid-December (day 350) & Mid-January (day 15): < 0.05 bare deciduous branches
    const midDec = evalTree(352, 0.5);
    const midJan = evalTree(15, 0.5);
    expect(midDec.organScale).toBeLessThan(0.05);
    expect(midJan.organScale).toBeLessThan(0.05);

    // Copper Beech marcescent leaves retain ~75% bronze canopy all winter
    const midJanBeech = evaluateOrganPhenology({
      organ: 'marcescent-leaf',
      yearPhase: computeYearPhase(15, 52.2),
      climateZone: 'temperate-maritime',
      exposure: 'outdoor',
      baseColorRgb: [0.29, 0.13, 0.17],
    });
    expect(midJanBeech.organScale).toBeCloseTo(0.75, 2);
  });

  it('produces dense species-distinct climbers, lush summer pergola grapes, natural British hedgerows, 3D grass tufts & crowned soil beds', () => {
    const ivyStd = createClimber({ species: 'english-ivy', width: 2.0, height: 2.2, density: 1.0, seed: 41 });
    const ivyLush = createClimber({ species: 'english-ivy', width: 2.0, height: 2.2, density: 2.2, seed: 41 });
    const countVerts = (root: THREE.Object3D): number => {
      let n = 0;
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          n += o.geometry.getAttribute('position')?.count ?? 0;
        }
      });
      return n;
    };
    expect(countVerts(ivyLush)).toBeGreaterThan(countVerts(ivyStd) * 1.45);

    // Summer pergola grapevine has plump 100% fruit scale from June solstice (d172) through October (d280)
    const grapeJune = evaluateOrganPhenology({
      organ: 'fruit',
      yearPhase: computeYearPhase(172, 52.0),
      climateZone: 'temperate-maritime',
      exposure: 'outdoor',
      variantParam: 0.25,
    });
    const grapeSept = evaluateOrganPhenology({
      organ: 'fruit',
      yearPhase: computeYearPhase(255, 52.0),
      climateZone: 'temperate-maritime',
      exposure: 'outdoor',
      variantParam: 0.25,
    });
    expect(grapeJune.organScale).toBeGreaterThan(0.92);
    expect(grapeSept.organScale).toBeGreaterThan(0.95);

    const pergolaGrape = createClimber({
      species: 'grapevine',
      support: 'pergola-wire',
      width: 2.6,
      height: 2.4,
      depth: 1.4,
      density: 1.8,
      seed: 77,
    });
    expect(countVerts(pergolaGrape)).toBeGreaterThan(2200);

    // Natural country hedgerows & mulch strips
    for (const hSpecies of ['mixed-field-hedgerow', 'blackthorn-sloe', 'bramble'] as const) {
      const h = createHedge({ species: hSpecies, length: 3.2, mulchStrip: true, seed: 91 });
      expect(h.children.length).toBeGreaterThanOrEqual(2);
    }
    for (const sSpecies of ['blackthorn-sloe', 'bramble'] as const) {
      expect(createShrub({ species: sSpecies, seed: 97 }).children.length).toBeGreaterThan(0);
    }

    // Continuous seasonal turf phenology (UK verdant autumn vs Mediterranean golden summer dormancy)
    const ukSpringTurf = evaluateSeasonalTurfPhenology({
      yearPhase: computeYearPhase(125, 52.2),
      climateZone: 'temperate-maritime',
    });
    const ukNovTurf = evaluateSeasonalTurfPhenology({
      yearPhase: computeYearPhase(317, 52.2),
      climateZone: 'temperate-maritime',
    });
    const medAugTurf = evaluateSeasonalTurfPhenology({
      yearPhase: computeYearPhase(225, 34.1),
      climateZone: 'mediterranean',
    });
    expect(ukSpringTurf.tintRgb[1]).toBeGreaterThan(ukSpringTurf.tintRgb[0]);
    expect(ukNovTurf.tintRgb[1]).toBeGreaterThan(0.95);
    expect(medAugTurf.summerDormancyMix).toBeGreaterThan(0.7);
    expect(medAugTurf.tintRgb[0]).toBeGreaterThan(medAugTurf.tintRgb[1]);

    // 3D grass tufts & clover/daisy lawn turf exclude raycast & walkthrough collision
    const turf = createLawnTurf({
      style: 'clover-daisy-turf',
      width: 1.8,
      depth: 0.5,
      density: 1.2,
      seed: 123,
    });
    const ribbonGrass = createGrassPatch({
      style: 'meadow-verge',
      ribbonPath: [
        [-1.5, 0],
        [1.5, 0.4],
      ],
      ribbonWidth: 0.35,
      seed: 131,
    });
    expect(turf.userData['excludeFromRaycast']).toBe(true);
    expect(turf.userData['ignoreWalkthroughCollision']).toBe(true);
    expect(countVerts(ribbonGrass)).toBeGreaterThan(150);

    // Physical Soil & Planting Bed System: crowned profile, concave polygon containment & stem grounding
    for (const substrate of [
      'garden-loam',
      'bark-mulch',
      'tilled-veg-earth',
      'potting-compost',
      'gravel-mulch',
      'decomposed-granite',
    ] as const) {
      const mat = createSoilMaterial({ substrate, exposure: 'outdoor' });
      expect(mat.userData['isSoilMaterial']).toBe(true);
    }

    const lPolygon: readonly [number, number][] = [
      [-2.0, -1.0],
      [2.0, -1.0],
      [2.0, 0.0],
      [0.0, 0.0],
      [0.0, 1.5],
      [-2.0, 1.5],
    ];
    const soilBed = createSoilBed({
      polygon: lPolygon,
      crownHeightM: 0.038,
      edgeRecessM: 0.018,
      substrate: 'garden-loam',
      plantings: [{ x: -1.0, z: 0.25, radius: 0.4 }],
      seed: 311,
    });
    expect(soilBed.sampleHeight(-1.0, 0.25)).toBeGreaterThan(soilBed.sampleHeight(-1.98, -0.98));
    expect(soilBed.samplePlantingY(-1.0, 0.25)).toBeCloseTo(soilBed.sampleHeight(-1.0, 0.25) - 0.02, 4);

    // Verify zero triangles cross into the concave notch (x > 0.02 && z > 0.02)
    soilBed.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const pos = o.geometry.getAttribute('position') as THREE.BufferAttribute;
      const idx = o.geometry.getIndex();
      const triCount = idx ? idx.count / 3 : pos.count / 3;
      for (let t = 0; t < triCount; t++) {
        const i0 = idx ? idx.getX(t * 3) : t * 3;
        const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
        const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
        const cx = (pos.getX(i0) + pos.getX(i1) + pos.getX(i2)) / 3;
        const cz = (pos.getZ(i0) + pos.getZ(i1) + pos.getZ(i2)) / 3;
        expect(cx > 0.02 && cz > 0.02).toBe(false);
      }
    });
  });
});
