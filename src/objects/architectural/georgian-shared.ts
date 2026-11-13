import * as THREE from 'three';
import type { InteractionRegistry } from '../../engine/interaction/interaction-registry.ts';
import { applyMetricBoxUVs } from '../../engine/textures/metric-masonry-uvs.ts';
import { prepGeo } from '../shared/scene-helpers.ts';
import {
  getBathStoneMaps,
} from '../shared/neptune-and-georgian-materials.ts';
import type { CatalogInteractionContext } from './neptune-kitchen-joinery.ts';

export function resolveGeorgianRegistry(ctx: CatalogInteractionContext): InteractionRegistry | null {
  if (!ctx) return null;
  if ('registerHingedDoor' in ctx && typeof ctx.registerHingedDoor === 'function') {
    return ctx as InteractionRegistry;
  }
  if ('interactions' in ctx && ctx.interactions) {
    return ctx.interactions;
  }
  return null;
}

let cachedBathStoneMat: THREE.MeshStandardMaterial | null = null;
export function getBathStoneMaterial(): THREE.MeshStandardMaterial {
  if (!cachedBathStoneMat) {
    const maps = getBathStoneMaps();
    cachedBathStoneMat = new THREE.MeshStandardMaterial({
      name: 'catalog.bathStoneAshlar',
      color: 0xffffff,
      map: maps.colorMap,
      normalMap: maps.normalMap,
      normalScale: new THREE.Vector2(0.45, 0.45),
      roughnessMap: maps.roughnessMap,
      roughness: 0.78,
      metalness: 0.01,
    });
  }
  return cachedBathStoneMat;
}

export function addMetricMasonryBox(
  parent: THREE.Object3D,
  name: string,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  material: THREE.Material,
  worldOx = 0,
  worldOy = 0,
  worldOz = 0
): THREE.Mesh {
  const geo = prepGeo(
    applyMetricBoxUVs(new THREE.BoxGeometry(w, h, d), {
      tileW: 1.0,
      tileH: 1.0,
      ox: worldOx + x,
      oy: worldOy + y,
      oz: worldOz + z,
    })
  );
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

