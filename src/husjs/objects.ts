export * from '../core/geo/frame2d.ts';
export * from '../engine/geometry/index.ts';
export * from '../engine/audio/spatial-emitters.ts';
export * from '../engine/textures/brick-materials.ts';
export {
  COBBLESTONE_PRESETS,
  STONE_MASONRY_PRESETS,
  createCobblestoneMaterial,
  createCobblestoneTextures,
  createStoneMasonryMaterial,
  createStoneMasonryTextures,
  type CobblestoneMaterialOptions,
  type CobblestonePreset,
  type StoneMasonryMaterialOptions,
  type StoneMasonryPreset,
} from '../engine/textures/cobblestone-materials.ts';
export * from '../engine/textures/metric-masonry-uvs.ts';
export * from '../engine/textures/pbr-surface-maps.ts';
export * from '../engine/textures/procedural-textures.ts';
export * from '../engine/textures/stone-and-tile-textures.ts';
export * from '../engine/textures/texture-registry.ts';
export {
  createBraidedCableTexture,
  createBrushedStainlessBumpTexture,
  createBrushedStainlessTexture,
  createDriftwoodTexture,
  createEngineeredOakFloorTextures,
  createPolishedChromeTexture,
  getLivingCopperPatinaMaps,
  type LivingCopperPatinaMaps,
} from '../engine/textures/timber-and-metal-textures.ts';
export * from '../engine/textures/vitoria-chequerboard-tiles.ts';
export * from '../objects/shared/geometry-cache.ts';
export {
  createSharedGeo,
  ensureNamedAddedChildren,
  prepGeo,
  tagHighLodDetail,
  type CreateSharedGeoOptions,
  type EnsureNamedAddedChildrenOptions,
} from '../objects/shared/scene-helpers.ts';
export * from '../objects/joinery/cabinet-interior.ts';
export * from '../objects/joinery/wardrobe-interior.ts';
export * from '../objects/decor/roman-blind.ts';
export * from '../objects/decor/traditional-window-curtains.ts';
export * from '../objects/heating/cast-iron-radiator.ts';
export * from '../objects/heating/wood-burning-stove-fire.ts';
export * from '../objects/fixtures/corston-power-sockets.ts';
export * from '../objects/fixtures/corston-toggle-switch.ts';
export * from '../objects/fixtures/fluted-brass-picture-light.ts';
export * from '../objects/fixtures/hydronic-manifold.ts';
export * from '../objects/cad/wall-mounting.ts';
export * from '../objects/cad/wall-openings.ts';
export * from '../objects/cad/wall-and-slab-builders.ts';
export * from '../objects/cad/skirting-run.ts';
export * from '../objects/cad/room-trim-and-panelling.ts';
export * from '../objects/architectural/staircase-and-balustrade.ts';
export * from '../objects/architectural/georgian-sash-window.ts';

export * from '../core/assets/asset-metadata.ts';
export * from '../engine/assets/smart-asset.ts';
export { detectMobile, isRealBrowserMobile } from '../engine/perf/device-tier.ts';
