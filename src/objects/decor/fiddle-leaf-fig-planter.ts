import * as THREE from 'three';
import { createHouseplant } from '../vegetation/houseplants.ts';
import { OrganCollector } from '../vegetation/organ-geometry.ts';

/**
 * Constructs a sculpted lyrate (`Ficus lyrata`) leaf blade `BufferGeometry`
 * with baked `aVegPivot` and `aVegMeta` phenology attributes.
 */
export function createFiddleLeafGeometry(
  length: number,
  maxWidth: number,
  archDrop: number,
  cupDepth: number
): THREE.BufferGeometry {
  const collector = new OrganCollector();
  collector.addCuppedLeafBlade({
    pivot: new THREE.Vector3(0, 0, 0),
    direction: new THREE.Vector3(0, 0, 1),
    upHint: new THREE.Vector3(0, 1, 0),
    length,
    width: maxWidth,
    archDrop,
    cupDepth,
    shape: 'lyrate-fiddle',
    segsLength: 8,
    segsWidth: 4,
    color: new THREE.Color(0x2d5a27),
    meta: {
      organ: 'evergreen-leaf',
      jitter: 0.35,
      reactivity: 0.06,
      variant: 0.15,
    },
  });
  return collector.toBufferGeometry('husjs.catalog.fiddleLeafBladeGeo');
}

export interface FiddleLeafFigPlanterOptions {
  readonly namePrefix?: string;
  readonly zone?: string;
  readonly position?: readonly [number, number, number];
}

/**
 * Builds an indoor Fiddle-Leaf Fig (`Ficus lyrata`) floor planter backed by
 * `husjs/vegetation` (`PhenologyMaterial` subsurface translucency and `exposure: 'indoor'`).
 */
export function buildFiddleLeafFigPlanter(
  parent: THREE.Object3D,
  options: FiddleLeafFigPlanterOptions = {}
): THREE.Group {
  const {
    namePrefix = 'fiddleLeafFigPlanter',
    zone,
    position = [0, 0, 0],
  } = options;

  const plantGroup = createHouseplant({
    species: 'fiddle-leaf-fig',
    height: 1.62,
    potStyle: 'stoneware',
    exposure: 'indoor',
    name: namePrefix,
  });
  if (zone !== undefined) {
    plantGroup.userData.zone = zone;
  }
  plantGroup.position.set(position[0], position[1], position[2]);
  parent.add(plantGroup);
  return plantGroup;
}
