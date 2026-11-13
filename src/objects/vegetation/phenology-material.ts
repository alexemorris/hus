export {
  FoliageLightingModel,
  PhenologyMaterial,
  VEG_META_ATTR,
  VEG_PIVOT_ATTR,
  getSharedPhenologyMaterial,
  type PhenologyMaterialOptions,
  type PhenologySurfaceKind,
} from '../../engine/vegetation/phenology-material.ts';

export {
  SHARED_VEGETATION_UNIFORMS,
  VegetationPhenologyController,
  createVegetationUniforms,
  type TslFloatUniformNode,
  type TslVec2UniformNode,
  type TslVec4UniformNode,
  type VegetationEnvironmentSyncInput,
  type VegetationPhenologySnapshot,
  type VegetationUniforms,
} from '../../engine/vegetation/vegetation-uniforms.ts';

export {
  getOrCreateBarkTextures,
  getOrCreateLeafVeinNormalMap,
  type BarkTextureSet,
  type BarkTextureStyle,
} from '../../engine/vegetation/vegetation-textures.ts';
