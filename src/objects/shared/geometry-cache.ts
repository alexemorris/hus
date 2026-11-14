import * as THREE from 'three';

/**
 * Shared immutable primitive `BufferGeometry` caches keyed by exact constructor arguments.
 *
 * IMPORTANT: Never mutate returned geometries in-place (`.translate()`, `.rotate*()`, `.scale()`,
 * or custom UV rewrites). Always apply transforms on the owning `THREE.Mesh` / `THREE.Group`.
 */

const boxCache = new Map<string, THREE.BoxGeometry>();
const cylinderCache = new Map<string, THREE.CylinderGeometry>();
const sphereCache = new Map<string, THREE.SphereGeometry>();
const torusCache = new Map<string, THREE.TorusGeometry>();
const circleCache = new Map<string, THREE.CircleGeometry>();

function argsKey(args: readonly unknown[]): string {
  return args.map((a) => (a === undefined ? 'u' : String(a))).join(':');
}

export function sharedBoxGeometry(
  ...args: ConstructorParameters<typeof THREE.BoxGeometry>
): THREE.BoxGeometry {
  const key = argsKey(args);
  let geo = boxCache.get(key);
  if (!geo) {
    geo = new THREE.BoxGeometry(...args);
    geo.userData.isSharedPrimitive = true;
    geo.computeBoundingSphere();
    boxCache.set(key, geo);
  }
  return geo;
}

export function sharedCylinderGeometry(
  ...args: ConstructorParameters<typeof THREE.CylinderGeometry>
): THREE.CylinderGeometry {
  const key = argsKey(args);
  let geo = cylinderCache.get(key);
  if (!geo) {
    geo = new THREE.CylinderGeometry(...args);
    geo.userData.isSharedPrimitive = true;
    geo.computeBoundingSphere();
    cylinderCache.set(key, geo);
  }
  return geo;
}

export function sharedSphereGeometry(
  ...args: ConstructorParameters<typeof THREE.SphereGeometry>
): THREE.SphereGeometry {
  const key = argsKey(args);
  let geo = sphereCache.get(key);
  if (!geo) {
    geo = new THREE.SphereGeometry(...args);
    geo.userData.isSharedPrimitive = true;
    geo.computeBoundingSphere();
    sphereCache.set(key, geo);
  }
  return geo;
}

export function sharedTorusGeometry(
  ...args: ConstructorParameters<typeof THREE.TorusGeometry>
): THREE.TorusGeometry {
  const key = argsKey(args);
  let geo = torusCache.get(key);
  if (!geo) {
    geo = new THREE.TorusGeometry(...args);
    geo.userData.isSharedPrimitive = true;
    geo.computeBoundingSphere();
    torusCache.set(key, geo);
  }
  return geo;
}

export function sharedCircleGeometry(
  ...args: ConstructorParameters<typeof THREE.CircleGeometry>
): THREE.CircleGeometry {
  const key = argsKey(args);
  let geo = circleCache.get(key);
  if (!geo) {
    geo = new THREE.CircleGeometry(...args);
    geo.userData.isSharedPrimitive = true;
    geo.computeBoundingSphere();
    circleCache.set(key, geo);
  }
  return geo;
}
