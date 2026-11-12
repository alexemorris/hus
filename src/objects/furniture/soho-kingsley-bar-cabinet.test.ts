import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { InteractionRegistry } from '../../engine/interaction/interaction-registry.ts';
import { clearTextureRegistryCache } from '../../engine/textures/texture-registry.ts';
import type { SceneBuilderContext } from '../../engine/viewer/scene-types.ts';
import { buildSohoKingsleyBarCabinet } from './soho-kingsley-bar-cabinet.ts';

function installMinimalCanvasDomStub(): () => void {
  const prevDoc = (globalThis as Record<string, unknown>).document;
  const noop = (): void => {};
  const makeGrad = () => ({ addColorStop: noop });
  const makeCtx = () =>
    new Proxy(
      {
        createLinearGradient: makeGrad,
        createRadialGradient: makeGrad,
        createPattern: () => ({}),
        measureText: () => ({ width: 10 }),
        getImageData: (_x: number, _y: number, w: number, h: number) => ({
          width: w,
          height: h,
          data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
        }),
        createImageData: (w: number, h: number) => ({
          width: w,
          height: h,
          data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
        }),
        putImageData: noop,
      },
      {
        get(target, prop) {
          if (prop in target) return (target as Record<string | symbol, unknown>)[prop];
          return noop;
        },
        set() {
          return true;
        },
      }
    );
  (globalThis as Record<string, unknown>).document = {
    createElement(tag: string) {
      if (tag === 'canvas') {
        const ctx = makeCtx();
        return {
          width: 64,
          height: 64,
          getContext: () => ctx,
          toDataURL: () => '',
        };
      }
      return {};
    },
  };
  return () => {
    if (prevDoc === undefined) {
      delete (globalThis as Record<string, unknown>).document;
    } else {
      (globalThis as Record<string, unknown>).document = prevDoc;
    }
  };
}

function createTestCabinetContext() {
  const scene = new THREE.Scene();
  const interactiveMeshes: THREE.Object3D[] = [];
  const interactions = new InteractionRegistry(interactiveMeshes);
  const ctx = {
    scene,
    interactiveMeshes,
    interactions,
    lightGroups: {
      walkInCupboardLeds: { lights: [], emissives: [], glowPools: [] },
    },
    addGlowPool: () => {},
  } as unknown as SceneBuilderContext;
  return { scene, interactiveMeshes, interactions, ctx };
}

describe('Soho Home Kingsley Bar Cabinet, Grey Emperador (SKU 74564715)', () => {
  let restoreDom: (() => void) | null = null;
  beforeEach(() => {
    clearTextureRegistryCache();
    restoreDom = installMinimalCanvasDomStub();
  });
  afterEach(() => {
    restoreDom?.();
    restoreDom = null;
    clearTextureRegistryCache();
  });

  it('matches official 1.10m H × 0.95m W × 0.51m D tearsheet bounds and stocks 24+ wine bottles', () => {
    const { scene, ctx } = createTestCabinetContext();
    const { cabinetGroup, leftDoorPivot, rightDoorPivot, drawerGroup } = buildSohoKingsleyBarCabinet(ctx, {
      namePrefix: 'familyRoom.kingsleyBarCabinet',
      zoneId: 'familyRoom',
      position: [0, 0, 0],
      rotationY: 0,
      includeTopServingTray: true,
    });

    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(cabinetGroup);
    const size = box.getSize(new THREE.Vector3());

    expect(size.y).toBeCloseTo(1.1, 2);
    expect(size.x).toBeCloseTo(0.95, 2);
    expect(size.z).toBeCloseTo(0.51, 2);
    expect(box.min.y).toBeCloseTo(0, 3);
    expect(box.max.y).toBeCloseTo(1.1, 2);

    const wineBottles: string[] = [];
    cabinetGroup.traverse((obj) => {
      if (obj instanceof THREE.Group && obj.name.toLowerCase().includes('winebottle')) {
        wineBottles.push(obj.name);
      }
    });
    expect(wineBottles.length).toBeGreaterThanOrEqual(24);

    let leftDoorBottles = 0;
    let rightDoorBottles = 0;
    leftDoorPivot.traverse((obj) => {
      if (obj instanceof THREE.Group && obj.name.toLowerCase().includes('winebottle')) leftDoorBottles += 1;
    });
    rightDoorPivot.traverse((obj) => {
      if (obj instanceof THREE.Group && obj.name.toLowerCase().includes('winebottle')) rightDoorBottles += 1;
    });
    expect(leftDoorBottles).toBe(4);
    expect(rightDoorBottles).toBe(4);
    expect(drawerGroup.name).toBe('familyRoom.kingsleyBarCabinet.slidingOakDrawer');
  });

  it('synchronizes both linked box doors to ±1.85 rad (±106°) with Open/Close Kingsley Bar Cabinet prompt and toggles internal sliding drawer', () => {
    const { scene, interactions, ctx } = createTestCabinetContext();
    const { leftDoorPivot, rightDoorPivot, drawerGroup } = buildSohoKingsleyBarCabinet(ctx, {
      namePrefix: 'familyRoom.kingsleyBarCabinet',
      zoneId: 'familyRoom',
      position: [-9.28, 0, -1.55],
      rotationY: Math.PI / 2,
      includeTopServingTray: true,
    });
    scene.updateMatrixWorld(true);

    let rightHandleMesh: THREE.Object3D | null = null;
    let doorBottleMesh: THREE.Object3D | null = null;
    rightDoorPivot.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.userData.interactableId) {
        if (obj.name.toLowerCase().includes('handle')) rightHandleMesh = obj;
        if (obj.name.toLowerCase().includes('winebottle')) doorBottleMesh = obj;
      }
    });
    expect(rightHandleMesh).not.toBeNull();
    expect(doorBottleMesh).not.toBeNull();
    expect(interactions.describeInteractable(rightHandleMesh!)).toBe('Open Kingsley Bar Cabinet');
    expect(interactions.describeInteractable(doorBottleMesh!)).toBe('Open Kingsley Bar Cabinet');

    expect(
      interactions.handleInteractableClick('door:familyRoom.kingsleyBarCabinet.rightDoor')
    ).toBe(true);
    for (let step = 0; step < 60; step++) {
      interactions.update(0.05);
    }
    expect(leftDoorPivot.rotation.y).toBeCloseTo(-1.85, 2);
    expect(rightDoorPivot.rotation.y).toBeCloseTo(1.85, 2);
    expect(interactions.describeInteractable(rightHandleMesh!)).toBe('Close Kingsley Bar Cabinet');

    const closedDrawerZ = drawerGroup.position.z;
    expect(
      interactions.handleInteractableClick('drawer:familyRoom.kingsleyBarCabinet.slidingOakDrawer')
    ).toBe(true);
    for (let step = 0; step < 40; step++) {
      interactions.update(0.05);
    }
    expect(drawerGroup.position.z - closedDrawerZ).toBeCloseTo(0.22, 3);

    expect(
      interactions.handleInteractableClick('drawer:familyRoom.kingsleyBarCabinet.slidingOakDrawer')
    ).toBe(true);
    for (let step = 0; step < 40; step++) {
      interactions.update(0.05);
    }
    expect(drawerGroup.position.z).toBeCloseTo(closedDrawerZ, 3);

    expect(
      interactions.handleInteractableClick('door:familyRoom.kingsleyBarCabinet.leftDoor')
    ).toBe(true);
    for (let step = 0; step < 60; step++) {
      interactions.update(0.05);
    }
    expect(leftDoorPivot.rotation.y).toBeCloseTo(0, 3);
    expect(rightDoorPivot.rotation.y).toBeCloseTo(0, 3);
    expect(interactions.describeInteractable(rightHandleMesh!)).toBe('Open Kingsley Bar Cabinet');
  });
});
