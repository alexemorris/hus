import type * as THREE from 'three';

/** True if `obj` and every ancestor are visible. */
export function isObjectVisibleInHierarchy(obj: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    if (!cur.visible) return false;
    cur = cur.parent;
  }
  return true;
}

const ascSort = (a: THREE.Intersection, b: THREE.Intersection): number => a.distance - b.distance;

/**
 * Raycasts only visible objects (and visible hierarchy branches when `recursive = true`),
 * pruning hidden floors, cutaway walls, overlays, and LOD-culled props before testing geometry.
 */
export function intersectVisibleObjects(
  raycaster: THREE.Raycaster,
  objects: readonly THREE.Object3D[],
  recursive: boolean,
  intersects: THREE.Intersection[] = []
): THREE.Intersection[] {
  if (recursive) {
    const visit = (obj: THREE.Object3D): void => {
      if (!obj.visible) return;
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
