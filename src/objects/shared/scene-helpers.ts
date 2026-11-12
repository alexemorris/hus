import * as THREE from 'three';

export interface CreateSharedGeoOptions {
  readonly computeBoundingBox?: boolean;
}

/**
 * Computes `boundingSphere` (and optionally `boundingBox`) on a shared `BufferGeometry`
 * and returns it for inline mesh construction.
 */
export function createSharedGeo<T extends THREE.BufferGeometry>(
  geo: T,
  options?: CreateSharedGeoOptions
): T {
  if (options?.computeBoundingBox) {
    geo.computeBoundingBox();
  }
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Ensures vertex normals and `boundingSphere` are populated on a `BufferGeometry`.
 */
export function prepGeo<T extends THREE.BufferGeometry>(geo: T): T {
  if (!geo.attributes['normal']) {
    geo.computeVertexNormals();
  }
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Marks a fine-detail object as `'high'` LOD tier with a maximum draw distance.
 */
export function tagHighLod<T extends THREE.Object3D>(obj: T, maxDistance = 12): T {
  obj.userData.lodTier = 'high';
  obj.userData.lodMaxDistance = maxDistance;
  return obj;
}

/**
 * Marks a fine-detail mesh or group as `'high'` LOD tier (alias used by first-floor & vehicle builders).
 */
export function tagHighLodDetail<T extends THREE.Object3D>(obj: T, maxDistance = 12): T {
  obj.userData.lodTier = 'high';
  obj.userData.lodMaxDistance = maxDistance;
  return obj;
}

export interface EnsureNamedAddedChildrenOptions {
  readonly tagSmallDetails?: boolean;
  readonly namingStyle?: 'typed' | 'part';
}

/**
 * Traverses children added to `parent` starting at `startIdx`, assigning deterministic
 * hierarchical names to any unnamed `Mesh`/`Group` nodes, ensuring geometry bounding spheres,
 * and optionally tagging sub-8cm detail meshes as high-LOD.
 */
export function ensureNamedAddedChildren(
  parent: THREE.Object3D,
  startIdx: number,
  prefix: string,
  tagSmallDetailsOrOptions: boolean | EnsureNamedAddedChildrenOptions = false
): void {
  const tagSmallDetails =
    typeof tagSmallDetailsOrOptions === 'boolean'
      ? tagSmallDetailsOrOptions
      : (tagSmallDetailsOrOptions.tagSmallDetails ?? false);
  const namingStyle =
    typeof tagSmallDetailsOrOptions === 'boolean'
      ? 'typed'
      : (tagSmallDetailsOrOptions.namingStyle ?? 'typed');

  if (namingStyle === 'part') {
    let subIdx = 0;
    for (let i = startIdx; i < parent.children.length; i++) {
      parent.children[i]!.traverse((obj) => {
        if ((obj instanceof THREE.Mesh || obj instanceof THREE.Group) && !obj.name) {
          subIdx++;
          obj.name = subIdx === 1 ? prefix : `${prefix}.part_${subIdx}`;
        }
        if (obj instanceof THREE.Mesh && obj.geometry && !obj.geometry.boundingSphere) {
          obj.geometry.computeBoundingSphere();
        }
      });
    }
    return;
  }

  let meshCount = 0;
  let groupCount = 0;
  for (let i = startIdx; i < parent.children.length; i++) {
    const child = parent.children[i]!;
    child.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        if (!node.name) {
          meshCount += 1;
          node.name = `${prefix}.mesh_${meshCount}`;
        }
        const geo = node.geometry as THREE.BufferGeometry | undefined;
        if (geo && !geo.boundingSphere) {
          geo.computeBoundingSphere();
        }
        if (
          tagSmallDetails &&
          !node.userData?.isArchitecturalShell &&
          !node.userData?.isCutawayWall &&
          geo?.boundingSphere &&
          geo.boundingSphere.radius < 0.08
        ) {
          node.userData.lodTier = 'high';
          node.userData.lodMaxDistance = 12;
        }
      } else if (node instanceof THREE.Group && !node.name) {
        groupCount += 1;
        node.name = groupCount === 1 && node === child ? prefix : `${prefix}.group_${groupCount}`;
      }
    });
  }
}
