import * as THREE from 'three';
import type { CutawayWallDescriptor, Vec3Tuple } from '../../core/types/scene.ts';
import { InteractionRegistry } from '../interaction/interaction-registry.ts';

export type CollisionRole = 'ignore' | 'solidPlane' | 'climbable';

export interface MeshTraitTraversalOptions {
  readonly recursive?: boolean;
}

export type InteractionTarget =
  | InteractionRegistry
  | { readonly interactions: InteractionRegistry };

export interface RegisterHingedDoorOptions {
  readonly parent: THREE.Object3D;
  readonly door: THREE.Object3D;
  readonly hingeOffset: THREE.Vector3 | Vec3Tuple;
  readonly axis: 'x' | 'y' | 'z';
  readonly openAngle: number;
  readonly initialAngle?: number;
}

export type RegisterSlidingDrawerOptions = (
  | { readonly drawer: THREE.Group; readonly group?: undefined }
  | { readonly group: THREE.Group; readonly drawer?: undefined }
) & {
  readonly slideDelta: THREE.Vector3 | Vec3Tuple;
};

function resolveInteractionRegistry(target: InteractionTarget): InteractionRegistry {
  if (target instanceof InteractionRegistry) {
    return target;
  }
  return target.interactions;
}

function toThreeVector3(v: THREE.Vector3 | Vec3Tuple): THREE.Vector3 {
  return v instanceof THREE.Vector3 ? v : new THREE.Vector3(v[0], v[1], v[2]);
}

function applyCollisionRoleOnObject(target: THREE.Object3D, role: CollisionRole): void {
  delete target.userData.ignoreWalkthroughCollision;
  delete target.userData.isWalkthroughSolidPlane;
  delete target.userData.isClimbableLadder;

  if (role === 'ignore') {
    target.userData.ignoreWalkthroughCollision = true;
  } else if (role === 'solidPlane') {
    target.userData.isWalkthroughSolidPlane = true;
  } else {
    target.userData.isClimbableLadder = true;
  }
}

/**
 * Tags `obj` (and descendant `THREE.Mesh`es when `options?.recursive !== false`) as a cutaway
 * wall with `userData.isCutawayWall = true` and `userData.cutawayWall = descriptor`.
 */
export function tagCutaway<T extends THREE.Object3D>(
  obj: T,
  descriptor: CutawayWallDescriptor,
  options?: MeshTraitTraversalOptions
): T {
  obj.userData.isCutawayWall = true;
  obj.userData.cutawayWall = descriptor;
  if (options?.recursive !== false) {
    obj.traverse((child) => {
      if (child !== obj && child instanceof THREE.Mesh) {
        child.userData.isCutawayWall = true;
        child.userData.cutawayWall = descriptor;
      }
    });
  }
  return obj;
}

/**
 * Tags `obj` (and descendant `THREE.Mesh`es when `options?.recursive !== false`) with
 * walkthrough collision metadata (`'ignore' | 'solidPlane' | 'climbable'`), clearing any
 * conflicting collision role flags.
 */
export function tagCollisionRole<T extends THREE.Object3D>(
  obj: T,
  role: CollisionRole,
  options?: MeshTraitTraversalOptions
): T {
  applyCollisionRoleOnObject(obj, role);
  if (options?.recursive !== false) {
    obj.traverse((child) => {
      if (child !== obj && child instanceof THREE.Mesh) {
        applyCollisionRoleOnObject(child, role);
      }
    });
  }
  return obj;
}

/**
 * Excludes `obj` (and descendant `THREE.Mesh`es when `options?.recursive !== false`) from
 * static geometry batching via `userData.isDynamicBatchExcluded = true` and ensures
 * `matrixAutoUpdate = true`.
 */
export function tagDynamicBatch<T extends THREE.Object3D>(
  obj: T,
  options?: MeshTraitTraversalOptions
): T {
  obj.userData.isDynamicBatchExcluded = true;
  obj.matrixAutoUpdate = true;
  if (options?.recursive !== false) {
    obj.traverse((child) => {
      if (child !== obj) {
        child.matrixAutoUpdate = true;
        if (child instanceof THREE.Mesh) {
          child.userData.isDynamicBatchExcluded = true;
        }
      }
    });
  }
  return obj;
}

/**
 * Marks a fine-detail object as `'high'` LOD tier with a maximum draw distance (metres).
 */
export function tagHighLod<T extends THREE.Object3D>(obj: T, maxDistance = 12): T {
  obj.userData.lodTier = 'high';
  obj.userData.lodMaxDistance = maxDistance;
  return obj;
}

/**
 * Registers a hinged door on an `InteractionRegistry` or `SceneBuilderContext`, supporting
 * either options-object or positional arguments.
 */
export function registerHingedDoor(
  target: InteractionTarget,
  options: RegisterHingedDoorOptions
): THREE.Group;
export function registerHingedDoor(
  target: InteractionTarget,
  parent: THREE.Object3D,
  door: THREE.Object3D,
  hingeOffset: THREE.Vector3 | Vec3Tuple,
  axis: 'x' | 'y' | 'z',
  openAngle: number,
  initialAngle?: number
): THREE.Group;
export function registerHingedDoor(
  target: InteractionTarget,
  parentOrOptions: THREE.Object3D | RegisterHingedDoorOptions,
  doorArg?: THREE.Object3D,
  hingeOffsetArg?: THREE.Vector3 | Vec3Tuple,
  axisArg?: 'x' | 'y' | 'z',
  openAngleArg?: number,
  initialAngleArg = 0
): THREE.Group {
  const registry = resolveInteractionRegistry(target);
  if (parentOrOptions instanceof THREE.Object3D) {
    return registry.registerHingedDoor(
      parentOrOptions,
      doorArg!,
      toThreeVector3(hingeOffsetArg!),
      axisArg!,
      openAngleArg!,
      initialAngleArg
    );
  }
  return registry.registerHingedDoor(
    parentOrOptions.parent,
    parentOrOptions.door,
    toThreeVector3(parentOrOptions.hingeOffset),
    parentOrOptions.axis,
    parentOrOptions.openAngle,
    parentOrOptions.initialAngle ?? 0
  );
}

/**
 * Registers a sliding drawer on an `InteractionRegistry` or `SceneBuilderContext`, supporting
 * either options-object or positional arguments and returning the drawer group.
 */
export function registerSlidingDrawer(
  target: InteractionTarget,
  options: RegisterSlidingDrawerOptions
): THREE.Group;
export function registerSlidingDrawer(
  target: InteractionTarget,
  drawerGroup: THREE.Group,
  slideDelta: THREE.Vector3 | Vec3Tuple
): THREE.Group;
export function registerSlidingDrawer(
  target: InteractionTarget,
  drawerOrOptions: THREE.Group | RegisterSlidingDrawerOptions,
  slideDeltaArg?: THREE.Vector3 | Vec3Tuple
): THREE.Group {
  const registry = resolveInteractionRegistry(target);
  if (drawerOrOptions instanceof THREE.Group) {
    registry.registerSlidingDrawer(drawerOrOptions, toThreeVector3(slideDeltaArg!));
    return drawerOrOptions;
  }
  const group = drawerOrOptions.drawer ?? drawerOrOptions.group;
  registry.registerSlidingDrawer(group, toThreeVector3(drawerOrOptions.slideDelta));
  return group;
}
