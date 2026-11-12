import type { KitchenSceneCircuitId, OutdoorCircuitId } from '../../core/types/knx.ts';

/**
 * Channel layout of the legacy 8-slot central scene table (`ScenePreset`): the open-plan
 * scene channels, the outdoor channels and the number of slots a 2-way toggle cycles.
 * These are properties of the `ScenePreset` record shape (and the EEPROM image built from
 * it), not of any particular home.
 */
export const SCENE_CIRCUIT_IDS: readonly KitchenSceneCircuitId[] = [
  'islandPendants',
  'sittingPendants',
  'bifoldUplights',
  'spotlights',
  'underCabinet',
  'aboveCabinet',
];

export const OUTDOOR_CIRCUIT_IDS: readonly OutdoorCircuitId[] = [
  'courtyardFestoons',
  'reclaimedLampPost',
];

/** Central scenes reachable from a legacy 2-way toggle (slots 0..2). */
export const SWITCH_SCENE_COUNT = 3;
