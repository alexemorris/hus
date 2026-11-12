import type { BathroomWallFacing } from './bathroom-spec-types.ts';

export type * from './bathroom-spec-types.ts';
export { ALL_BRASSWARE_FINISH_CODES } from './bathroom-spec-types.ts';

export {
  finalizeSanitaryGroup,
  getAcrymiteWhiteMaterial,
  getAntiqueWhiteCeramicMaterial,
  getArtDecoFlutedGlassMaterials,
  getBathroomBrassMaterials,
  getBathroomTextileMaterials,
  getBlackPorcelainMaterial,
  getBoatBathExteriorMaterials,
  getBurnishedCopperMaterials,
  getDarkOakVeneerMaterials,
  getHonedCarraraMarbleMaterial,
  getMirostoneQuartzMaterial,
  getOliveGreenVerticalMetroTileMaterial,
  getPaintedShakerCabinetMaterials,
  getVitreousChinaMaterial,
  getWcSeatMaterial,
  getZelligeCreamWallTileMaterial,
  resolveFixtureFinishToBrassCode,
} from './bathroom-materials.ts';

export {
  buildArmstrongConcealedShowerSet,
  buildArmstrongDeck3HoleBasinMixer,
  buildArmstrongFreestandingBathMixer,
  buildArmstrongPaperHolder,
  buildArmstrongRobeHook,
  buildArmstrongWallBasinMixer,
  buildPerrinRoweConcealedCisternLever,
  buildPerrinRoweTowelRing,
} from './perrin-rowe-armstrong.ts';

export {
  buildDeco3HoleBasinMixer3142,
  buildDecoConcealedShowerSet,
  buildDecoPaperHolder6148,
  buildDecoRobeHook6122,
} from './perrin-rowe-deco.ts';

export {
  buildBasinTapFromSpec,
  buildKitchenTapFromSpec,
  buildPerrinRoweBasinTap,
  buildPerrinRoweBasinWaste,
  buildPerrinRoweKitchenTap,
  getTapMountAnchor,
  mountTapOnFixture,
  registerTapMountAnchor,
} from './perrin-rowe-taps.ts';

export { buildBcDesignsCopperBoatBath } from './bc-designs-boat-bath.ts';
export { buildLefroyBrooksCharterhouseWc } from './lefroy-brooks-charterhouse-wc.ts';
export { buildLefroyBrooksLaChapellePedestalBasin } from './lefroy-brooks-la-chapelle-basin.ts';
export { buildLefroyBrooksLaChapelleWashstand } from './lefroy-brooks-la-chapelle-washstand.ts';
export { buildLefroyBrooksLissaDoonWashstand } from './lefroy-brooks-lissa-doon-washstand.ts';
export {
  buildThomasCrapperDownhamBasin,
  buildThomasCrapperLowLevelWc,
} from './thomas-crapper.ts';

export function wallFacingToRotY(facing: BathroomWallFacing): number {
  switch (facing) {
    case 'south':
      return 0;
    case 'east':
      return Math.PI / 2;
    case 'north':
      return Math.PI;
    case 'west':
      return -Math.PI / 2;
  }
}
