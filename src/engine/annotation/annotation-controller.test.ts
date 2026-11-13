import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createPropertySceneLayers } from '../viewer/scene-content.ts';
import { SceneAnnotationController } from './annotation-controller.ts';

function makeControllerHarness() {
  const scene = new THREE.Scene();
  const layers = createPropertySceneLayers(scene);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  camera.position.set(0, 1.5, 5);
  camera.lookAt(0, 1.5, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  const canvas = {
    style: { cursor: '' },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  } as unknown as HTMLCanvasElement;

  const orbitControls = { enabled: true } as unknown as OrbitControls;
  const raycaster = new THREE.Raycaster();
  const ensureUnbatchedForTransform = vi.fn();
  const ensureUnbatchedForTarget = vi.fn();

  const controller = new SceneAnnotationController({
    canvas,
    layers,
    orbitControls,
    getActiveCamera: () => camera,
    getCameraPose: () => ({ position: [0, 1.5, 5], target: [0, 1.5, 0], floorViewMode: 'ground', ceilingCutaway: true, isOrthographic: false }),
    setRayFromClient: () => {
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
      return raycaster;
    },
    isExcludedFromPicking: () => false,
    ensureUnbatchedForTransform,
    ensureUnbatchedForTarget,
    requestRender: vi.fn(),
    invalidateShadows: vi.fn(),
  });
  scene.add(...controller.getSceneObjects());
  return {
    scene,
    layers,
    camera,
    raycaster,
    controller,
    ensureUnbatchedForTransform,
    ensureUnbatchedForTarget,
  };
}

describe('SceneAnnotationController', () => {
  it('skips hidden floors and hidden cutaway subtrees during pin/measure raycasting', () => {
    const { scene, layers, raycaster, controller } = makeControllerHarness();
    const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc });

    // Closer hidden mesh inside firstFloorMeshGroup (visible = false)
    layers.firstFloorMeshGroup.visible = false;
    const hiddenWall = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 0.2), mat);
    hiddenWall.name = 'firstFloor.hiddenWall';
    hiddenWall.position.set(0, 1.5, 2);
    layers.firstFloorMeshGroup.add(hiddenWall);

    // Farther visible mesh in Ground Kitchen
    const visibleCounter = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 0.2), mat);
    visibleCounter.name = 'kitchen.island.counter';
    visibleCounter.position.set(0, 1.5, 0);
    scene.add(visibleCounter);
    scene.updateMatrixWorld(true);

    let pickedName = '';
    controller.setOnAnnotationPick((hit) => {
      pickedName = hit.meshInfo.meshName;
    });
    controller.setAnnotationMode(true);
    controller.setAnnotationToolMode('pin');

    raycaster.set(new THREE.Vector3(0, 1.5, 5), new THREE.Vector3(0, 0, -1));
    controller.handleClick(raycaster, { clientX: 400, clientY: 300, shiftKey: false } as PointerEvent);

    expect(pickedName).toBe('kitchen.island.counter');
  });

  it('uses subtree-scoped ensureUnbatchedForTarget on Move/Rotate object click instead of upfront unbatchAll', () => {
    const {
      scene,
      raycaster,
      controller,
      ensureUnbatchedForTransform,
      ensureUnbatchedForTarget,
    } = makeControllerHarness();
    const mat = new THREE.MeshStandardMaterial({ color: 0x996633 });

    const roomGroup = new THREE.Group();
    roomGroup.name = 'kitchen.island';
    const stoolGroup = new THREE.Group();
    stoolGroup.name = 'kitchen.island.stool';
    const seatMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), mat);
    seatMesh.name = 'kitchen.island.stool.seat';
    seatMesh.position.set(0, 1.5, 0);
    stoolGroup.add(seatMesh);
    roomGroup.add(stoolGroup);
    scene.add(roomGroup);
    scene.updateMatrixWorld(true);

    controller.setAnnotationToolMode('move');
    // Switching tool mode must NOT trigger upfront estate-wide unbatching!
    expect(ensureUnbatchedForTransform).not.toHaveBeenCalled();
    expect(ensureUnbatchedForTarget).not.toHaveBeenCalled();

    raycaster.set(new THREE.Vector3(0, 1.5, 5), new THREE.Vector3(0, 0, -1));
    controller.handleClick(raycaster, { clientX: 400, clientY: 300, shiftKey: false } as PointerEvent);

    expect(ensureUnbatchedForTarget).toHaveBeenCalledTimes(1);
    expect(ensureUnbatchedForTarget).toHaveBeenCalledWith(roomGroup);
    expect(ensureUnbatchedForTransform).not.toHaveBeenCalled();
  });
});

import type { SceneAnnotationHit, SceneCameraPoseSnapshot } from '../../core/types/scene.ts';
import { SceneAnnotationStore } from './annotation-system.ts';

function makeSampleHit(meshName: string, worldPoint: [number, number, number]): SceneAnnotationHit {
  const cameraPose: SceneCameraPoseSnapshot = {
    position: [1, 2, 3],
    target: [0, 1, 0],
    floorViewMode: 'ground',
    ceilingCutaway: true,
    isOrthographic: false,
  };
  return {
    worldPoint,
    worldNormal: [0, 1, 0],
    roomZoneId: 'kitchen',
    roomName: 'Kitchen',
    meshInfo: {
      meshName,
      parentChain: ['Scene', 'kitchen', meshName],
      geometrySummary: 'BoxGeometry(1, 0.9, 2)',
      materialSummary: 'MeshStandardMaterial(#ffffff)',
      meshWorldCenter: worldPoint,
      meshBoundingBoxSize: [1, 0.9, 2],
      meshBoundingBoxMin: [worldPoint[0] - 0.5, worldPoint[1] - 0.45, worldPoint[2] - 1],
      meshBoundingBoxMax: [worldPoint[0] + 0.5, worldPoint[1] + 0.45, worldPoint[2] + 1],
    },
    cameraPose,
  };
}

describe('SceneAnnotationStore.formatForAgent', () => {
  it('formats pin, move, and measure annotations as clean Markdown summary + JSON payload', () => {
    const store = new SceneAnnotationStore();
    store.clearAll();
    expect(store.formatForAgent()).toBe('No 3D annotations recorded.');

    const pinHit = makeSampleHit('kitchen.island.counter', [1.2, 0.9, -0.5]);
    store.addAnnotation(pinHit, 'Check overhang alignment');

    const moveHit = makeSampleHit('kitchen.island.stool', [1.5, 0.45, -0.2]);
    store.upsertMoveAnnotation(
      moveHit,
      {
        targetName: 'kitchen.island.stool',
        targetKind: 'group',
        targetUuid: 'stool-uuid',
        targetPath: ['Scene', 'kitchen.island', 'kitchen.island.stool'],
        initialWorldCenter: [1.5, 0.45, -0.2],
        newWorldCenter: [1.75, 0.45, -0.2],
        deltaTranslation: [0.25, 0, 0],
        initialObjectPosition: [0, 0, 0],
        newObjectPosition: [0.25, 0, 0],
        initialRotationDeg: [0, 0, 0],
        newRotationDeg: [0, 15, 0],
        deltaRotationDeg: [0, 15, 0],
      },
      moveHit.cameraPose
    );

    const endHit = makeSampleHit('kitchen.northRun.counter', [1.2, 0.9, -1.7]);
    const measureRec = store.addMeasureAnnotation(pinHit, endHit, [1.2, 0.9, -1.7], 'Aisle width');
    store.updateTargetMeasurement(measureRec.id, '1.25 m');

    const formatted = store.formatForAgent();
    expect(formatted).toContain('# Hus 3D Scene Annotations (3)');
    expect(formatted).toContain('## Issue #1: Check overhang alignment');
    expect(formatted).toContain('## Issue #2 [OBJECT MOVE / ROTATE]:');
    expect(formatted).toContain('## Issue #3 [MEASUREMENT SPAN]: Aisle width');
    expect(formatted).toContain('- **Target / Real-World Measurement**: `1.25 m`');
    expect(formatted).not.toContain('USD Prim Path');
    expect(formatted).not.toContain('OpenUSD');
    expect(formatted).not.toContain('```usda');

    const jsonMatch = /```json\n([\s\S]+)\n```$/.exec(formatted);
    expect(jsonMatch).not.toBeNull();
    const parsed = JSON.parse(jsonMatch![1]!);
    expect(parsed).toHaveLength(3);
    expect(parsed.map((r: { kind: string }) => r.kind)).toEqual(['pin', 'move', 'measure']);
  });
});
