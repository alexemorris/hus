import {
  carveBasin,
  createTerrainSampler,
  gradePad,
  sampleHusGridLayers,
  smoothstep,
  splinePath,
  type HusGridDocument,
  type TerrainConfig,
  type TerrainModifier,
} from 'husjs';
import stahlGridJson from '../../public/terrain/stahl-house.husgrid.json';

/**
 * Surveyed HABS CA-2702 Structural Module & Site Datum Constants
 * - 1635 Woods Drive, Hollywood Hills, Los Angeles, CA 90069 (`34.100437° N, 118.370152° W`)
 * - Structural steel grid module `M = 6.096 m` (`20'-0"`)
 *   - Grid columns X: `-18.288` (X0 West carport), `-12.192` (X1), `-6.096` (X2), `0.000` (X3), `+6.096` (X4 East cliff)
 *   - Grid columns Z: `-6.096` (Z0 North), `0.000` (Z1 Spine), `+6.096` (Z2), `+12.192` (Z3 South cliff)
 * - Finished Floor Level (FFL): `Y = 0.000 m` (`240.20 m` ASL)
 * - Clear Ceiling Soffit: `Y = 2.642 m` (`8'-8"`)
 */
export const MODULE_M = 6.096; // 20'-0"
export const X0 = -3 * MODULE_M; // -18.288 m (Woods Drive carport entry)
export const X1 = -2 * MODULE_M; // -12.192 m (Carport / Bedroom 2 line)
export const X2 = -1 * MODULE_M; // -6.096 m (Bedroom 2 / Master Suite line)
export const X3 = 0.0; // 0.000 m (Inner L-corner: Master / Kitchen & Dining / Pool)
export const X4 = MODULE_M; // +6.096 m (East promontory cliff column line)

export const Z0 = -MODULE_M; // -6.096 m (North perimeter along Woods Drive)
export const Z1 = 0.0; // 0.000 m (Private wing South glass / Kitchen-Dining junction)
export const Z2 = MODULE_M; // +6.096 m (Dining / Living fireplace line)
export const Z3 = 2 * MODULE_M; // +12.192 m (South promontory cliff column line)

export const CLEAR_CEILING_Y = 2.642; // 8'-8" clear ceiling
export const DECK_DEPTH_M = 0.127; // 5" 18-gauge fluted steel deck
export const GIRDER_DEPTH_M = 0.305; // 12" wide-flange I-beam girders
export const H_COL_SIZE_M = 0.102; // 4" x 4" wide-flange H-column
export const CANTILEVER_M = 2.286; // 7'-6" (within 7'-8' HABS overhang)
export const CATWALK_WIDTH_M = 0.52; // 500 mm exterior window-washer steel catwalk

/** Pool (`6.10 m x 7.92 m` / `20' x 26'`) tucked into the Southwest courtyard inside the L. */
export const POOL_MIN_X = -9.95;
export const POOL_MAX_X = -1.15; // Includes the two signature water inlets up to the living wing
export const POOL_MAIN_MAX_X = -2.03; // 7.92 m main pool length (-9.95 .. -2.03)
export const POOL_MIN_Z = 1.15;
export const POOL_MAX_Z = 7.25; // 6.10 m pool width (1.15 .. 7.25)
export const POOL_WATER_Y = -0.06;
export const POOL_FLOOR_Y = -1.65;

export const STAHL_HUSGRID = stahlGridJson as unknown as HusGridDocument;

/**
 * Sharpens the local 48°–62° decomposed-granite promontory bluff drop directly beneath the East (`+X`)
 * and South (`+Z`) cantilevered grade beams over the surveyed USGS 3DEP 1m LiDAR DEM, while keeping
 * the real N–S Hollywood Hills promontory spur, Woods Drive ridge, West canyon, and LA Basin relief intact.
 */
export function sampleStahlPromontoryBaseY(wx: number, wz: number): number {
  const demY = sampleHusGridLayers(STAHL_HUSGRID.grids, wx, wz, 0);

  // Subtle multi-frequency geological ridge/gully undulation on lower cliff slopes (0 at crest)
  const ridgeUndulation =
    0.36 * Math.sin(wx * 0.31 + wz * 0.47) +
    0.22 * Math.cos(wx * 0.73 - wz * 0.59) +
    0.14 * Math.sin((wx + wz) * 1.28);

  // East & South-East escarpment (`X > 3.30 m`):
  // North of `Z = -1.05 m`, the NE decomposed-granite promontory nose & dry-stacked sandstone
  // cribbing extend out to `X ~ 8.85 m` before plunging into Laurel/Sunset canyon.
  // South of `Z = 0.25 m` (under the Dining & Living East glass bays and catwalk), the rocky
  // bluff drops immediately from the `X = 3.30 m` caisson crest line at ~50°–60°.
  const noseBulgeEast =
    (1 - smoothstep(-0.75, 0.55, wz)) * smoothstep(-8.8, -6.3, wz) * 5.65;
  const eastCrestX = 3.30 + noseBulgeEast;
  const dxEast = wx - eastCrestX;

  // South escarpment:
  // Under the pool terrace (`X < -0.15`), the engineered concrete pool-terrace retaining wall sits
  // along `Z = 9.48`, while under the cantilevered Living wing (`X >= 0`), the bluff drops from `Z = 9.26`.
  const poolTerraceBulgeSouth = (1 - smoothstep(-0.6, 0.4, wx)) * 0.36;
  const southCrestZ = 9.26 + poolTerraceBulgeSouth;
  const dzSouth = wz - southCrestZ;

  let cliffDropY = demY;
  if (dxEast > -0.5 || dzSouth > -0.5) {
    const posE = Math.max(0, dxEast);
    const posS = Math.max(0, dzSouth);
    const outDist = Math.hypot(posE, posS);

    // Mask out West canyon flank (`X < -15.5`) and North ridge (`Z < -12`) so real 1m LiDAR governs
    const eastActive = smoothstep(-16.5, -12.5, wx) * smoothstep(-16.0, -9.0, wz);
    if (outDist > 0 && eastActive > 0) {
      const steepNear = 1.26 * Math.min(outDist, 9.5);
      const midSlope = 0.76 * Math.max(0, Math.min(outDist - 9.5, 24.0));
      const basinRunout = 0.34 * Math.max(0, Math.min(outDist - 33.5, 75.0));
      // Keep crest line clean (0 undulation within 1.4 m of retaining/grade-beam crest)
      const gullyNoise = ridgeUndulation * smoothstep(1.4, 4.5, outDist);
      const targetCliffY = -0.92 - steepNear - midSlope - basinRunout + gullyNoise;
      const w = smoothstep(0.0, 1.25, outDist) * eastActive;
      cliffDropY = Math.min(demY, demY * (1 - w) + targetCliffY * w);
    }
  }

  return cliffDropY;
}

/**
 * Non-destructive `TerrainModifier[]` stack over the USGS 3DEP 1m LiDAR Hollywood Hills promontory:
 * - L-shaped compacted promontory pads (`Y = -0.14 m`) matching the North bedroom/carport wing and
 *   Southwest pool terrace, terminating cleanly at the `X = 3.18 m` / `Z = 9.18 m` caisson crest
 *   while feathering naturally into the West canyon flank without boxy artificial shelves.
 * - Grounded NE decomposed-granite promontory nose (`X = 5.8..8.68, Z = -6.15..-1.22`, `Y = -0.24 m`)
 *   retaining the *Agave attenuata* planting bed and dry-stacked sandstone cribbing.
 * - Real N–S Woods Drive ridge approach (`Z = -46..-3, X = -17.6..-19.6`) following the surveyed
 *   1m LiDAR ridge spine instead of cutting across the West canyon.
 * - Carved `20' x 26'` swimming pool basin (`bottomY = -1.75 m`).
 */
export const STAHL_TERRAIN_MODIFIERS: readonly TerrainModifier[] = [
  gradePad({
    id: 'promontory-north-carport-pad',
    minX: -20.85,
    maxX: 3.18,
    minZ: -6.95,
    maxZ: 0.45,
    elevationY: -0.14,
    featherM: 2.1,
    featherSide: 'outside',
  }),
  gradePad({
    id: 'promontory-compacted-pad',
    minX: -13.85,
    maxX: 3.18, // Terminates at caisson/retaining line -> 2.92 m East cliff cantilever to X4!
    minZ: -0.45,
    maxZ: 9.54, // Supports pool terrace slab while leaving Living wing cantilevered to Z3 (12.192)!
    elevationY: -0.14,
    featherM: 1.55,
    featherSide: 'outside',
  }),
  gradePad({
    id: 'ne-decomposed-granite-promontory-nose',
    minX: 5.65,
    maxX: 8.75,
    minZ: -6.15,
    maxZ: -0.92,
    elevationY: -0.24,
    slopeX: -0.04,
    slopeZ: -0.025,
    featherM: 0.95,
    featherSide: 'outside',
  }),
  splinePath({
    id: 'woods-drive-approach',
    points: [
      [-17.6, -46.0, 3.85],
      [-18.2, -32.0, 2.05],
      [-19.1, -18.0, 0.72],
      [-19.6, -8.5, 0.06],
      [-19.5, -3.05, -0.08],
    ],
    halfWidthM: 2.9,
    featherM: 3.4,
  }),
  carveBasin({
    id: 'stahl-pool-basin',
    shape: 'box',
    minX: POOL_MIN_X - 0.15,
    maxX: POOL_MAX_X + 0.15,
    minZ: POOL_MIN_Z - 0.15,
    maxZ: POOL_MAX_Z + 0.15,
    bottomY: POOL_FLOOR_Y - 0.1,
    wallSlopeM: 0.18,
    featherM: 0.35,
    profile: 'flatBottom',
  }),
];

export const STAHL_TERRAIN_CONFIG: TerrainConfig = {
  base: sampleStahlPromontoryBaseY,
  biome: 'rocky-bluff',
  modifiers: STAHL_TERRAIN_MODIFIERS,
};

export const stahlTerrainSampler = createTerrainSampler(STAHL_TERRAIN_CONFIG);
