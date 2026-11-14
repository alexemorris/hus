/**
 * Public `husjs/materials` entrypoint for procedural PBR brick, cobblestone, sett,
 * flagstone, pea-gravel, dry-stone, sawn coping, Welsh slate, metric masonry UV helpers,
 * and the physical architectural paint & finish system.
 */
export {
  BRICK_BONDS,
  BRICK_PRESETS,
  createBrickMaterial,
  createBrickTextures,
  type BrickBond,
  type BrickMaterialOptions,
  type BrickPreset,
  type BrickWeatheringOptions,
  type ProceduralPbrMapBundle,
  type RgbTuple,
} from '../engine/textures/brick-materials.ts';

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

export {
  IRONSTONE_WALL_TILE_H_M,
  IRONSTONE_WALL_TILE_W_M,
  UK_BRICK_TILE_H_M,
  UK_BRICK_TILE_W_M,
  YORKSTONE_COPING_TILE_M,
  applyMetricBoxUVs,
  applyMetricCylinderUVs,
  applyMetricExtrudeUVs,
  applyMetricMasonryUVs,
  buildMetricWallRibbonGeo,
  type MetricCylinderUvOptions,
  type MetricMasonryUvOptions,
  type MetricUvOptions,
  type TerrainFollowingWallStation,
} from '../engine/textures/metric-masonry-uvs.ts';

export {
  derivePbrNormalAndRoughnessMaps,
  type PbrSurfaceMapOptions,
} from '../engine/textures/pbr-surface-maps.ts';

export { detectIOS, detectMobile } from '../engine/perf/device-tier.ts';

export {
  boxDownsampleTexels,
  type DownsampledTexelBuffer,
} from '../engine/textures/texture-downsample.ts';

export {
  clearTextureRegistryCache,
  createBrowserDataOrCanvasTexture,
  createSharedSourceTextureVariant,
  downsampleDataTextureForMobile,
  getOrCreateCachedCanvas,
  getOrCreateCachedCanvasPair,
  getOrCreateCachedTexture,
  isSnapshotRecordingCanvas,
  isRecordingCanvasStub,
  type SharedSourceTextureVariantOptions,
} from '../engine/textures/texture-registry.ts';

export {
  FINISH_SHEENS,
  clearFinishMaterialCache,
  createFinishMaterial,
  type FinishCategory,
  type FinishMaterialOptions,
  type FinishSheen,
  type FinishSheenDescriptor,
} from '../engine/textures/finish-materials.ts';

export {
  PAINT_SHEENS,
  clearPaintMaterialCache,
  computePaintLrv,
  computePaintSpecularResponse,
  createPaintMaterial,
  createRoomPaintScheme,
  getCachedPaintMaterial,
  getPaintMaterialInfo,
  getPaintSheenDescriptor,
  getPaintSwatch,
  listPaintSwatches,
  paintSpecFromSwatch,
  registerPaintSwatch,
  resolvePaintColor,
  type CustomPaintColorSpec,
  type PaintColorInput,
  type PaintMaterialOptions,
  type PaintMicroTextureKind,
  type PaintSheen,
  type PaintSheenDescriptor,
  type PaintSwatch,
  type PaintSwatchRegistration,
  type ResolvedPaintColor,
  type ResolvedPaintInfo,
  type RoomPaintKind,
  type RoomPaintScheme,
  type RoomPaintSchemeInfo,
  type RoomPaintSchemeOptions,
  type RoomPaintSurfaceSpec,
} from '../engine/textures/paint-system.ts';

export {
  createEvergreenFoliagePbrMaterial,
  createRollerMownStripedLawnMaterial,
} from '../objects/architectural/lawn-and-foliage-materials.ts';
