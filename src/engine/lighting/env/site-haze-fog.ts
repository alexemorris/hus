/** Horizontal footprint (world XZ) inside which the site is haze-free. */
export interface SiteHazeFootprint {
  readonly centerX: number;
  readonly centerZ: number;
  /** Radius (m) of the haze-free disc around the site centre. */
  readonly radius: number;
}

/**
 * Default footprint fitted to the navigable site (`SITE_PIVOT_BOUNDS`: x −40..30, z −20..35):
 * the buildings, courtyard and garden stay crisp, the surrounding fields fade into aerial haze.
 */
export const DEFAULT_SITE_HAZE_FOOTPRINT: SiteHazeFootprint = { centerX: -5, centerZ: 7.5, radius: 38 };
