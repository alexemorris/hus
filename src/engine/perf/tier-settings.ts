import type { GraphicsTier, GraphicsTierSettings } from '../../core/types/twin-ux.ts';

/** Tiers ordered from cheapest to most expensive. */
export const GRAPHICS_TIER_ORDER: readonly GraphicsTier[] = ['low', 'medium', 'high', 'ultra'];

export function isGraphicsTier(value: unknown): value is GraphicsTier {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'ultra';
}

/** Returns the tier `delta` steps away from `tier`, clamped to the valid range. */
export function stepTier(tier: GraphicsTier, delta: number): GraphicsTier {
  const idx = GRAPHICS_TIER_ORDER.indexOf(tier);
  const next = Math.max(0, Math.min(GRAPHICS_TIER_ORDER.length - 1, idx + Math.round(delta)));
  return GRAPHICS_TIER_ORDER[next]!;
}

/** Signed comparison of two tiers (negative if `a` is cheaper than `b`). */
export function compareTiers(a: GraphicsTier, b: GraphicsTier): number {
  return GRAPHICS_TIER_ORDER.indexOf(a) - GRAPHICS_TIER_ORDER.indexOf(b);
}

export interface PixelRatioRange {
  readonly min: number;
  readonly max: number;
}

function sanitizeDpr(devicePixelRatio: number): number {
  return Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
}

function roundRatio(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Allowed render pixel-ratio range for a tier. The runtime governor lowers resolution in 0.1 steps
 * within this range before dropping a whole tier.
 *
 * | Tier   | min                | max            |
 * | :----- | :----------------- | :------------- |
 * | low    | 0.7                | min(DPR, 1.0)  |
 * | medium | 0.85               | 1.0            |
 * | high   | 1.0                | min(DPR, 2.0)  |
 * | ultra  | min(max, 1.25)     | min(DPR, 2.0)  |
 */
export function getTierPixelRatioRange(
  tier: GraphicsTier,
  devicePixelRatio: number
): PixelRatioRange {
  const dpr = sanitizeDpr(devicePixelRatio);
  switch (tier) {
    case 'low': {
      const max = Math.max(0.7, Math.min(dpr, 1.0));
      return { min: 0.7, max: roundRatio(max) };
    }
    case 'medium':
      return { min: 0.85, max: 1.0 };
    case 'high': {
      const max = Math.max(1.0, Math.min(dpr, 2.0));
      return { min: 1.0, max: roundRatio(max) };
    }
    case 'ultra': {
      const max = Math.max(1.0, Math.min(dpr, 2.0));
      return { min: roundRatio(Math.min(max, 1.25)), max: roundRatio(max) };
    }
  }
}

/** Clamps a pixel ratio into the tier's allowed range. */
export function clampPixelRatioForTier(
  tier: GraphicsTier,
  pixelRatio: number,
  devicePixelRatio: number
): number {
  const range = getTierPixelRatioRange(tier, devicePixelRatio);
  return roundRatio(Math.max(range.min, Math.min(range.max, pixelRatio)));
}

interface TierFeatureRow {
  readonly postProcessing: boolean;
  readonly ambientOcclusion: boolean;
  readonly bloom: boolean;
  readonly sharpen: boolean;
  readonly shadowMapSize: 1024 | 2048 | 4096;
  readonly lodDistanceScale: number;
  readonly highDetailMaxDistance: number;
  readonly pointLightBudget: number;
}

/** Plan section 2.2 tier table. Lighting intensities are intentionally absent. */
const TIER_TABLE: Readonly<Record<GraphicsTier, TierFeatureRow>> = {
  low: {
    postProcessing: false,
    ambientOcclusion: false,
    bloom: false,
    sharpen: false,
    shadowMapSize: 1024,
    lodDistanceScale: 0.6,
    highDetailMaxDistance: 6,
    pointLightBudget: 0,
  },
  medium: {
    postProcessing: true,
    ambientOcclusion: true,
    bloom: false,
    sharpen: true,
    shadowMapSize: 2048,
    lodDistanceScale: 0.85,
    highDetailMaxDistance: 10,
    pointLightBudget: 12,
  },
  high: {
    postProcessing: true,
    ambientOcclusion: true,
    bloom: true,
    sharpen: true,
    shadowMapSize: 4096,
    lodDistanceScale: 1.0,
    highDetailMaxDistance: 12,
    pointLightBudget: 16,
  },
  ultra: {
    postProcessing: true,
    ambientOcclusion: true,
    bloom: true,
    sharpen: true,
    shadowMapSize: 4096,
    lodDistanceScale: 1.3,
    highDetailMaxDistance: 18,
    pointLightBudget: 20,
  },
};

/**
 * Concrete render settings for `tier`. `pixelRatio` is the top of the tier's range (or `0.85`
 * on high-DPR `>= 2.25` `'low'`-tier mobile/foldable screens); the governor may lower it via {@link withPixelRatio}.
 */
export function getTierSettings(
  tier: GraphicsTier,
  devicePixelRatio: number,
  viewportWidth?: number,
  viewportHeight?: number
): GraphicsTierSettings {
  const row = TIER_TABLE[tier];
  const dpr = sanitizeDpr(devicePixelRatio);
  const rawPixelRatio =
    tier === 'low' && dpr >= 2.25
      ? clampPixelRatioForTier('low', 0.85, devicePixelRatio)
      : getTierPixelRatioRange(tier, devicePixelRatio).max;
  const pixelRatio =
    typeof viewportWidth === 'number' &&
    viewportWidth > 0 &&
    typeof viewportHeight === 'number' &&
    viewportHeight > 0
      ? clampPixelRatioForViewport(tier, rawPixelRatio, viewportWidth, viewportHeight)
      : rawPixelRatio;
  return {
    tier,
    pixelRatio,
    postProcessing: row.postProcessing,
    ambientOcclusion: row.ambientOcclusion,
    bloom: row.bloom,
    sharpen: row.sharpen,
    shadowMapSize: row.shadowMapSize,
    lodDistanceScale: row.lodDistanceScale,
    highDetailMaxDistance: row.highDetailMaxDistance,
  };
}

/** Returns a copy of `settings` with the pixel ratio clamped into the tier's range. */
export function withPixelRatio(
  settings: GraphicsTierSettings,
  pixelRatio: number,
  devicePixelRatio: number
): GraphicsTierSettings {
  return {
    ...settings,
    pixelRatio: clampPixelRatioForTier(settings.tier, pixelRatio, devicePixelRatio),
  };
}

/**
 * Fixed number of shadow-free point lights the batch optimizer may keep active for a tier.
 * The budget is a fixed count per tier (never adapted per-frame) so lighting stays consistent.
 */
export function getPointLightBudget(tier: GraphicsTier): number {
  return TIER_TABLE[tier].pointLightBudget;
}

/**
 * Maximum internal physical render pixel budget (`rtWidth * rtHeight`) per tier.
 * Prevents super-4K MSAA HDR64 buffer explosion on 4K desktops running >1.0 OS scaling
 * (e.g. `3840x2160 @ 1.5x` = `5760x3240` `18.66 MP` -> clamped to native 4K `<= 8.3 MP`).
 */
export const MAX_RENDER_PIXELS_BY_TIER: Readonly<Record<GraphicsTier, number>> = {
  low: 450_000,
  medium: 2_100_000,
  high: 8_300_000,
  ultra: 8_300_000,
};

/**
 * Clamps `pixelRatio` so `Math.round(cssWidth * ratio) * Math.round(cssHeight * ratio)`
 * never exceeds {@link MAX_RENDER_PIXELS_BY_TIER} for `tier`.
 */
export function clampPixelRatioForViewport(
  tier: GraphicsTier,
  pixelRatio: number,
  cssWidth: number,
  cssHeight: number
): number {
  const safeRatio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  const w = Math.max(1, cssWidth);
  const h = Math.max(1, cssHeight);
  const maxPixels = MAX_RENDER_PIXELS_BY_TIER[tier];
  const requestedPixels = w * safeRatio * (h * safeRatio);
  if (requestedPixels <= maxPixels) {
    return safeRatio;
  }
  let capped = Math.sqrt(maxPixels / (w * h));
  while (
    capped > 0.1 &&
    Math.max(1, Math.round(w * capped)) * Math.max(1, Math.round(h * capped)) > maxPixels
  ) {
    capped = Math.max(0.1, capped - 0.0001);
  }
  return Math.max(0.1, Math.floor(capped * 10000) / 10000);
}
