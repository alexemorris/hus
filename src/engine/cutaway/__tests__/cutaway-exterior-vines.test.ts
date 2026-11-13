import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { CutawayWallDescriptor, FloorDefinition } from '../../../core/types/scene.ts';
import { RoomLodController } from '../../lod/lod-manager.ts';
import { createPropertySceneLayers } from '../../viewer/scene-content.ts';
import { SceneZoneRegistry } from '../../viewer/scene-zone-registry.ts';
import { CutawayController } from '../cutaway-controller.ts';

function buildTaggedVine(
  name: string,
  pos: readonly [number, number, number],
  size: readonly [number, number, number],
  descriptor: CutawayWallDescriptor
): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(pos[0], pos[1], pos[2]);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size[0], size[1], size[2]),
    new THREE.MeshStandardMaterial()
  );
  mesh.position.set(0, size[1] * 0.5, 0);
  group.add(mesh);
  group.userData['cutawayWall'] = descriptor;
  return group;
}

describe('CutawayController exterior wall vine hiding across scene & siteGroup containers', () => {
  const floors: readonly FloorDefinition[] = [
    { id: 'ground', elevationY: 0, ceilingHeight: 2.5 },
    { id: 'first', elevationY: 2.5, ceilingHeight: 2.4 },
  ];

  function buildTestRig() {
    const scene = new THREE.Scene();
    const layers = createPropertySceneLayers(scene);
    layers.ensureFloors?.(floors);
    const siteGroup = layers.siteGroup ?? new THREE.Group();
    if (!layers.siteGroup) {
      scene.add(siteGroup);
    }

    const zoneRegistry = new SceneZoneRegistry([]);
    zoneRegistry.addInteriorBounds([
      {
        minX: -6,
        maxX: 6,
        minY: 0,
        maxY: 2.5,
        minZ: -5,
        maxZ: 5,
      },
      {
        minX: -6,
        maxX: 6,
        minY: 2.5,
        maxY: 4.9,
        minZ: -5,
        maxZ: 5,
      },
    ]);
    const lodController = new RoomLodController([]);
    const controller = new CutawayController(layers, zoneRegistry, lodController, {
      floors,
      initialView: { floor: 'all', sectionCut: true },
    });

    // Place vines across all 4 exterior elevations in siteGroup, scene, and rotated wing containers
    const southVine = buildTaggedVine(
      'grounds.vine.southFacade',
      [0, 0, 5.04],
      [2.2, 2.2, 0.14],
      { axis: 'z', coord: 5.0, minSpan: -6, maxSpan: 6, outwardSide: 'south', floor: 'ground' }
    );
    siteGroup.add(southVine);

    const southUpperVine = buildTaggedVine(
      'grounds.vine.southFacadeUpper',
      [0, 2.5, 5.04],
      [2.0, 1.9, 0.14],
      { axis: 'z', coord: 5.0, minSpan: -6, maxSpan: 6, outwardSide: 'south', floor: 'first' }
    );
    siteGroup.add(southUpperVine);

    const northVine = buildTaggedVine(
      'grounds.vine.northFacade',
      [1.2, 0, -5.04],
      [1.8, 2.3, 0.14],
      { axis: 'z', coord: -5.0, minSpan: -6, maxSpan: 6, outwardSide: 'north', floor: 'ground' }
    );
    scene.add(northVine);

    const westVine = buildTaggedVine(
      'grounds.vine.westBayFacade',
      [-6.04, 0, 0.5],
      [0.14, 2.4, 2.6],
      { axis: 'x', coord: -6.0, minSpan: -5, maxSpan: 5, outwardSide: 'west', floor: 'ground' }
    );
    siteGroup.add(westVine);

    const westUpperVine = buildTaggedVine(
      'grounds.vine.westBayFacadeUpper',
      [-6.04, 2.5, 0.5],
      [0.14, 1.8, 2.4],
      { axis: 'x', coord: -6.0, minSpan: -5, maxSpan: 5, outwardSide: 'west', floor: 'first' }
    );
    scene.add(westUpperVine);

    const eastWingRoot = new THREE.Group();
    eastWingRoot.name = 'eastWingRoot';
    eastWingRoot.position.set(6.0, 0, 0);
    eastWingRoot.rotation.y = -0.18;
    eastWingRoot.userData = { containerOffset: [6.0, 0, 0], containerRotationY: -0.18 };
    siteGroup.add(eastWingRoot);

    const eastVine = buildTaggedVine(
      'grounds.vine.eastRotatedFacade',
      [0.05, 0, 0],
      [0.14, 2.2, 2.0],
      {
        axis: 'x',
        coord: 0.0,
        minSpan: -4,
        maxSpan: 4,
        outwardSide: 'east',
        floor: 'ground',
      }
    );
    eastWingRoot.add(eastVine);

    scene.updateMatrixWorld(true);
    controller.collectDynamicCutawayWalls();

    return {
      scene,
      controller,
      vines: {
        southVine,
        southUpperVine,
        northVine,
        westVine,
        westUpperVine,
        eastVine,
      },
    };
  }

  it('hides exterior wall vines on whichever elevation faces the cutaway camera (0 floating vines)', () => {
    const { controller, vines } = buildTestRig();
    const target = new THREE.Vector3(0, 1.1, 0);

    // Camera looking from South (+Z) -> South GF + 1F vines cut away, North/East/West stay visible
    controller.update({
      cameraPosition: new THREE.Vector3(0, 9.5, 16.5),
      target,
      isOrthographic: false,
      orthoZoom: 1,
    });
    expect(vines.southVine.visible).toBe(false);
    expect(vines.southUpperVine.visible).toBe(false);
    expect(vines.northVine.visible).toBe(true);
    expect(vines.westVine.visible).toBe(true);
    expect(vines.eastVine.visible).toBe(true);

    // Camera looking from West (-X) -> West GF + 1F vines cut away, South/North/East visible
    controller.update({
      cameraPosition: new THREE.Vector3(-17.5, 9.5, 0.5),
      target,
      isOrthographic: false,
      orthoZoom: 1,
    });
    expect(vines.westVine.visible).toBe(false);
    expect(vines.westUpperVine.visible).toBe(false);
    expect(vines.southVine.visible).toBe(true);
    expect(vines.northVine.visible).toBe(true);
    expect(vines.eastVine.visible).toBe(true);

    // Camera looking from North (-Z) -> North vine cuts away
    controller.update({
      cameraPosition: new THREE.Vector3(0, 9.5, -16.5),
      target,
      isOrthographic: false,
      orthoZoom: 1,
    });
    expect(vines.northVine.visible).toBe(false);
    expect(vines.southVine.visible).toBe(true);

    // Camera looking from East (+X) onto rotated eastWingRoot -> East vine cuts away
    controller.update({
      cameraPosition: new THREE.Vector3(18.5, 9.5, -1.5),
      target,
      isOrthographic: false,
      orthoZoom: 1,
    });
    expect(vines.eastVine.visible).toBe(false);
    expect(vines.westVine.visible).toBe(true);
  });

  it('hides upper-storey exterior vines in Ground Floor mode even when mounted on siteGroup or scene', () => {
    const { controller, vines } = buildTestRig();
    const target = new THREE.Vector3(0, 1.0, 0);

    // Ground-floor mode with cutaway OFF: all GF walls & GF vines stand tall, but 1F vines MUST hide with the 1st floor!
    controller.setViewState('ground', false);
    controller.update({
      cameraPosition: new THREE.Vector3(-15, 10, 15),
      target,
      isOrthographic: false,
      orthoZoom: 1,
    });

    expect(vines.southVine.visible).toBe(true);
    expect(vines.westVine.visible).toBe(true);
    expect(vines.southUpperVine.visible).toBe(false);
    expect(vines.westUpperVine.visible).toBe(false);

    // Ground-floor mode with cutaway ON from South-West: South & West GF vines ALSO cut away, North/East GF remain, 1F stays hidden
    controller.setViewState('ground', true);
    controller.update({
      cameraPosition: new THREE.Vector3(-14, 9.5, 14),
      target,
      isOrthographic: false,
      orthoZoom: 1,
    });
    expect(vines.southVine.visible).toBe(false);
    expect(vines.westVine.visible).toBe(false);
    expect(vines.southUpperVine.visible).toBe(false);
    expect(vines.westUpperVine.visible).toBe(false);
    expect(vines.northVine.visible).toBe(true);
    expect(vines.eastVine.visible).toBe(true);

    // Switching back to 'all' floors with cutaway OFF restores every upper-storey & ground-storey vine
    controller.setViewState('all', false);
    controller.update({
      cameraPosition: new THREE.Vector3(-15, 10, 15),
      target,
      isOrthographic: false,
      orthoZoom: 1,
    });
    expect(vines.southUpperVine.visible).toBe(true);
    expect(vines.westUpperVine.visible).toBe(true);
  });
});
