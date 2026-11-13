import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { RoomLodController } from '../../lod/lod-manager.ts';
import { SceneBatchOptimizer } from '../../rendering/scene-batch-optimizer.ts';
import { createPropertySceneLayers } from '../../viewer/scene-content.ts';
import { clearFinishMaterialCache, createFinishMaterial } from '../finish-materials.ts';
import {
  MICRO_SURFACE_MAP_SIZE,
  createThinFabricShadeMaterial,
  getMicroSurfaceDetailMaps,
} from '../micro-surface-detail.ts';

describe('micro-surface-detail & finish batching', () => {
  beforeEach(() => {
    clearFinishMaterialCache();
  });

  it('generates deterministic 256x256 tileable detail maps in under 15 ms and shares 1 pair per surface class', () => {
    getMicroSurfaceDetailMaps('woven-fabric');
    clearFinishMaterialCache();
    const t0 = performance.now();
    const plaster = getMicroSurfaceDetailMaps('plaster-stipple');
    const singleClassMs = performance.now() - t0;
    const stone = getMicroSurfaceDetailMaps('honed-stone');
    const timber = getMicroSurfaceDetailMaps('timber-pore');
    const metal = getMicroSurfaceDetailMaps('brushed-metal');

    expect(singleClassMs).toBeLessThan(15);
    for (const pair of [plaster, stone, timber, metal]) {
      expect(pair.roughnessMap.image.width).toBe(MICRO_SURFACE_MAP_SIZE);
      expect(pair.roughnessMap.image.height).toBe(MICRO_SURFACE_MAP_SIZE);
      expect(pair.normalMap.image.width).toBe(MICRO_SURFACE_MAP_SIZE);
      expect(pair.normalMap.wrapS).toBe(THREE.RepeatWrapping);
      expect(pair.normalMap.wrapT).toBe(THREE.RepeatWrapping);
    }

    const limeWall = createFinishMaterial('lime-wash', '#EAE4D7', { microGrain: true });
    const eggshellTrim = createFinishMaterial('eggshell', '#EDEAE2', { microGrain: true });
    expect(limeWall.normalMap).toBe(plaster.normalMap);
    expect(eggshellTrim.normalMap).toBe(plaster.normalMap);
    expect(limeWall.normalScale.x).toBeGreaterThanOrEqual(0.04);
    expect(limeWall.normalScale.x).toBeLessThanOrEqual(0.1);

    const brass = createFinishMaterial('aged-brass', undefined, { microGrain: true });
    expect(brass.normalMap).toBe(metal.normalMap);
  });

  it('preserves SceneBatchOptimizer draw-call merging across matching micro-grained finishes', () => {
    const scene = new THREE.Scene();
    const layers = createPropertySceneLayers(scene);
    const wallGroup = new THREE.Group();
    wallGroup.name = 'outbuildings.groundShell';
    scene.add(wallGroup);

    const wallMat = createFinishMaterial('estate-emulsion', '#EFECE4', { microGrain: true });
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2.4, 0.12), wallMat);
      mesh.position.x = i * 1.2;
      wallGroup.add(mesh);
    }
    type OptimizerDeps = ConstructorParameters<typeof SceneBatchOptimizer>[0];
    const optimizer = new SceneBatchOptimizer({
      layers,
      lodController: new RoomLodController([]),
      interactiveMeshes: [],
      bifoldPanels: [],
      lightGroups: {} as OptimizerDeps['lightGroups'],
      indicatorMats: {} as OptimizerDeps['indicatorMats'],
      roomSwitchLedMats: [],
      getDynamicObjects: () => new Set<THREE.Object3D>(),
    });
    scene.updateMatrixWorld(true);
    optimizer.optimize();
    let visibleMeshCount = 0;
    scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh && obj.visible) visibleMeshCount++;
    });
    expect(visibleMeshCount).toBe(1);
  });

  it('creates cached thin-walled fabric shade physical materials with woven micro-detail', () => {
    const shadeA = createThinFabricShadeMaterial({ color: '#F5EFE2', transmission: 0.28 });
    const shadeB = createThinFabricShadeMaterial({ color: '#f5efe2', transmission: 0.28 });
    expect(shadeA).toBe(shadeB);
    expect(shadeA.transmission).toBeCloseTo(0.28, 3);
    expect(shadeA.sheen).toBeGreaterThan(0.4);
    expect(shadeA.normalMap).toBe(getMicroSurfaceDetailMaps('woven-fabric').normalMap);
  });
});
