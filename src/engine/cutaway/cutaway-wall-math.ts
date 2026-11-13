import * as THREE from 'three';
import type {
  CutawayWallDescriptor,
  FloorDefinition,
  FloorViewMode,
} from '../../core/types/scene.ts';
import { SHADOW_PASS_HOOK_FLAG } from '../rendering/scene-batch-optimizer.ts';

export interface DynamicCutawayWallItem {
  readonly obj: THREE.Object3D;
  readonly descriptor: CutawayWallDescriptor;
  readonly offsetX: number;
  readonly offsetZ: number;
  readonly rotationY: number;
}

/**
 * Creates a zero-area, always-drawn shadow-casting mesh whose `onBeforeShadow` / `onAfterShadow`
 * callbacks bracket every shadow-map pass (Three.js renders shadow casters in scene-graph order).
 */
export function createShadowPassHook(name: string): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
  geo.boundingBox = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
  const mat = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.raycast = (): void => {};
  mesh.userData = {
    [SHADOW_PASS_HOOK_FLAG]: true,
    isAnnotationGroup: true,
    lodIgnore: true,
  };
  return mesh;
}

/**
 * Accumulates ancestor `userData.containerOffset` and `userData.containerRotationY` transforms
 * from scene root down to `obj` so dynamic cutaway descriptors inside rotated wings or batched
 * `siteGroup` containers resolve into accurate local XZ coordinates.
 */
export function resolveContainerTransformXZ(obj: THREE.Object3D): {
  readonly offsetX: number;
  readonly offsetZ: number;
  readonly rotationY: number;
} {
  const ancestors: THREE.Object3D[] = [];
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    ancestors.push(cur);
    cur = cur.parent;
  }

  let offsetX = 0;
  let offsetZ = 0;
  let rotationY = 0;
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const node = ancestors[i]!;
    const off = node.userData?.containerOffset as readonly [number, number, number] | undefined;
    const rot = node.userData?.containerRotationY as number | undefined;
    if (off || typeof rot === 'number') {
      const dx = off ? off[0] : 0;
      const dz = off ? off[2] : 0;
      if (rotationY === 0) {
        offsetX += dx;
        offsetZ += dz;
      } else {
        const c = Math.cos(rotationY);
        const s = Math.sin(rotationY);
        offsetX += dx * c + dz * s;
        offsetZ += -dx * s + dz * c;
      }
      if (typeof rot === 'number') {
        rotationY += rot;
      }
    }
  }
  return { offsetX, offsetZ, rotationY };
}

export function toContainerLocalXZ(
  wx: number,
  wz: number,
  offsetX: number,
  offsetZ: number,
  rotationY: number
): { readonly x: number; readonly z: number } {
  const dx = wx - offsetX;
  const dz = wz - offsetZ;
  if (rotationY === 0) {
    return { x: dx, z: dz };
  }
  const cosR = Math.cos(rotationY);
  const sinR = Math.sin(rotationY);
  return {
    x: dx * cosR - dz * sinR,
    z: dx * sinR + dz * cosR,
  };
}

/**
 * True when an object tagged with `descriptor.floor` belongs to an upper storey that is hidden
 * by the active floor isolation mode (even if the object was mounted on `siteGroup` or `scene`
 * rather than `firstFloorMeshGroup`, such as upper-storey exterior wall vines).
 */
export function isHiddenUpperFloorCutawayItem(
  descriptor: CutawayWallDescriptor,
  floors: readonly FloorDefinition[],
  viewedFloorIndex: number,
  cameraInsideHouse: boolean
): boolean {
  if (cameraInsideHouse || viewedFloorIndex < 0) {
    return false;
  }
  const itemFloorIndex = floors.findIndex((f) => f.id === descriptor.floor);
  return itemFloorIndex > viewedFloorIndex;
}

export function evaluateDynamicWallCut(
  descriptor: CutawayWallDescriptor,
  floorViewMode: FloorViewMode,
  camX: number,
  camZ: number,
  targetX: number,
  targetZ: number,
  vx: number,
  vz: number,
  isTopDownPlan: boolean,
  lowestFloorId: string,
  isUpperFloorMode: boolean
): boolean {
  const activeFloorMatch =
    floorViewMode === 'all' ||
    descriptor.floor === floorViewMode ||
    (Boolean(descriptor.includeInFirstFloorCutaway) &&
      descriptor.floor === lowestFloorId &&
      isUpperFloorMode);
  if (!activeFloorMatch || isTopDownPlan) {
    return false;
  }

  if (descriptor.axis === 'z') {
    const distZ = Math.abs(descriptor.coord - targetZ);
    const allowSouth = !descriptor.outwardSide || descriptor.outwardSide === 'south';
    const allowNorth = !descriptor.outwardSide || descriptor.outwardSide === 'north';
    const onSouthCamSide =
      allowSouth &&
      vz < -0.22 &&
      descriptor.coord > targetZ - 0.35 &&
      descriptor.coord <= camZ + 0.55;
    const onNorthCamSide =
      allowNorth &&
      vz > 0.22 &&
      descriptor.coord < targetZ + 0.35 &&
      descriptor.coord >= camZ - 0.55;

    if ((onSouthCamSide || onNorthCamSide) && distZ <= 6.2) {
      const tRay =
        Math.abs(targetZ - camZ) > 0.01
          ? THREE.MathUtils.clamp((descriptor.coord - camZ) / (targetZ - camZ), 0, 1.2)
          : 1;
      const rayX = camX + (targetX - camX) * tRay;
      return (
        (targetX >= descriptor.minSpan - 1.8 && targetX <= descriptor.maxSpan + 1.8) ||
        (rayX >= descriptor.minSpan - 1.5 && rayX <= descriptor.maxSpan + 1.5)
      );
    }
    return false;
  }

  const distX = Math.abs(descriptor.coord - targetX);
  const allowEast = !descriptor.outwardSide || descriptor.outwardSide === 'east';
  const allowWest = !descriptor.outwardSide || descriptor.outwardSide === 'west';
  const onEastCamSide =
    allowEast &&
    vx < -0.22 &&
    descriptor.coord > targetX - 0.35 &&
    descriptor.coord <= camX + 0.55;
  const onWestCamSide =
    allowWest &&
    vx > 0.22 &&
    descriptor.coord < targetX + 0.35 &&
    descriptor.coord >= camX - 0.55;

  if ((onEastCamSide || onWestCamSide) && distX <= 6.4) {
    const tRay =
      Math.abs(targetX - camX) > 0.01
        ? THREE.MathUtils.clamp((descriptor.coord - camX) / (targetX - camX), 0, 1.2)
        : 1;
    const rayZ = camZ + (targetZ - camZ) * tRay;
    return (
      (targetZ >= descriptor.minSpan - 1.8 && targetZ <= descriptor.maxSpan + 1.8) ||
      (rayZ >= descriptor.minSpan - 1.5 && rayZ <= descriptor.maxSpan + 1.5)
    );
  }
  return false;
}
