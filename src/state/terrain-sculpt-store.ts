import { signal, type Signal } from '@preact/signals';
import {
  TERRAIN_SCULPT_DEFAULT_PATCH_ID,
  TERRAIN_SCULPT_DEFAULT_RADIUS_M,
  TERRAIN_SCULPT_DEFAULT_STRENGTH_M,
  type TerrainSculptSnapshot,
} from '../core/geo/terrain-sculpt.ts';

export const DEFAULT_TERRAIN_SCULPT_SNAPSHOT: TerrainSculptSnapshot = {
  active: false,
  mode: 'raise',
  radiusM: TERRAIN_SCULPT_DEFAULT_RADIUS_M,
  strength: TERRAIN_SCULPT_DEFAULT_STRENGTH_M,
  strokeCount: 0,
  stampCount: 0,
  canUndo: false,
  patchId: TERRAIN_SCULPT_DEFAULT_PATCH_ID,
};

export const terrainSculptAvailable: Signal<boolean> = signal<boolean>(false);
export const terrainSculptSnapshot: Signal<TerrainSculptSnapshot> = signal<TerrainSculptSnapshot>(
  DEFAULT_TERRAIN_SCULPT_SNAPSHOT
);
