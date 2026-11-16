import * as THREE from 'three';
import { createHouseplant } from '../vegetation/houseplants.ts';

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
