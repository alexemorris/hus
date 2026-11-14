import type * as THREE from 'three';

/** True if `obj` or any ancestor is currently hidden as an inactive room/design variation. */
export function isVariationHiddenInHierarchy(obj: THREE.Object3D | null | undefined): boolean {
  let cur: THREE.Object3D | null | undefined = obj;
  while (cur) {
    if (cur.userData?.variationHidden === true) return true;
    cur = cur.parent;
  }
  return false;
}

/** Finds the nearest ancestor (including `obj`) tagged as a room variation option root, if any. */
export function findVariationOptionRoot(obj: THREE.Object3D | null | undefined): THREE.Object3D | null {
  let cur: THREE.Object3D | null | undefined = obj;
  while (cur) {
    if (cur.userData?.isVariationOptionRoot === true) return cur;
    cur = cur.parent;
  }
  return null;
}

/** True if `obj` and every ancestor are visible (and not hidden by an inactive room variation). */
export function isObjectVisibleInHierarchy(obj: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    if (!cur.visible || cur.userData?.variationHidden === true) return false;
    cur = cur.parent;
  }
  return true;
}

const ascSort = (a: THREE.Intersection, b: THREE.Intersection): number => a.distance - b.distance;

/**
 * Raycasts only visible objects (and visible hierarchy branches when `recursive = true`),
 * pruning hidden floors, cutaway walls, inactive room variations, overlays, and LOD-culled props
 * before testing geometry.
 */
export function intersectVisibleObjects(
  raycaster: THREE.Raycaster,
  objects: readonly THREE.Object3D[],
  recursive: boolean,
  intersects: THREE.Intersection[] = []
): THREE.Intersection[] {
  if (recursive) {
    const visit = (obj: THREE.Object3D): void => {
      if (!obj.visible || obj.userData?.variationHidden === true) return;
      if (obj.layers.test(raycaster.layers)) {
        obj.raycast(raycaster, intersects);
      }
      const children = obj.children;
      for (let i = 0, l = children.length; i < l; i++) {
        visit(children[i]!);
      }
    };
    for (let i = 0, l = objects.length; i < l; i++) {
      const root = objects[i]!;
      if (!isObjectVisibleInHierarchy(root)) continue;
      visit(root);
    }
  } else {
    for (let i = 0, l = objects.length; i < l; i++) {
      const obj = objects[i]!;
      if (!obj.visible || !isObjectVisibleInHierarchy(obj)) continue;
      if (obj.layers.test(raycaster.layers)) {
        obj.raycast(raycaster, intersects);
      }
    }
  }
  intersects.sort(ascSort);
  return intersects;
}

/** Removes all direct children of `group`. */
export function clearGroupChildren(group: THREE.Group): void {
  while (group.children.length > 0) {
    const child = group.children[0];
    if (child) {
      group.remove(child);
    }
  }
}
