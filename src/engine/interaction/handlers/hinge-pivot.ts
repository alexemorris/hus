import * as THREE from 'three';
import type { CutawayWallDescriptor } from '../../../core/types/scene.ts';

export function findDescendantCutawayWall(root: THREE.Object3D): CutawayWallDescriptor | undefined {
  if (root.userData?.cutawayWall) {
    return root.userData.cutawayWall as CutawayWallDescriptor;
  }
  let found: CutawayWallDescriptor | undefined;
  root.traverse((child) => {
    if (!found && child !== root && child.userData?.cutawayWall) {
      found = child.userData.cutawayWall as CutawayWallDescriptor;
    }
  });
  return found;
}

/**
 * Re-parents `obj` (which must already have its local position set and be a child of `parent`)
 * under `pivot`, placing the pivot at `obj.position + hingeOffsetInParent` so rotating the pivot
 * swings `obj` about the hinge line. The caller adds the returned pivot to `parent`.
 */
export function wrapInHingePivot(
  parent: THREE.Object3D,
  obj: THREE.Object3D,
  hingeOffsetInParent: THREE.Vector3,
  pivot: THREE.Group = new THREE.Group()
): THREE.Group {
  pivot.position.copy(obj.position).add(hingeOffsetInParent);
  parent.remove(obj);
  obj.position.copy(hingeOffsetInParent).negate();
  pivot.add(obj);
  if (!pivot.userData?.cutawayWall) {
    const cutawayDesc = findDescendantCutawayWall(obj);
    if (cutawayDesc) {
      pivot.userData.isCutawayWall = true;
      pivot.userData.cutawayWall = cutawayDesc;
    }
  }
  return pivot;
}
