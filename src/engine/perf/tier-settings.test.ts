import { describe, expect, it } from 'vitest';
import {
  GRAPHICS_TIER_ORDER,
  MAX_RENDER_PIXELS_BY_TIER,
  clampPixelRatioForTier,
  clampPixelRatioForViewport,
  compareTiers,
  getPointLightBudget,
  getTierPixelRatioRange,
  getTierSettings,
  isGraphicsTier,
  stepTier,
  withPixelRatio,
} from './tier-settings.ts';

describe('tier-settings', () => {
  it('orders and steps tiers with clamping', () => {
    expect(GRAPHICS_TIER_ORDER).toEqual(['low', 'medium', 'high', 'ultra']);
    expect(stepTier('low', -1)).toBe('low');
    expect(stepTier('low', 1)).toBe('medium');
    expect(stepTier('high', 5)).toBe('ultra');
    expect(compareTiers('low', 'ultra')).toBeLessThan(0);
    expect(compareTiers('high', 'high')).toBe(0);
    expect(isGraphicsTier('medium')).toBe(true);
    expect(isGraphicsTier('auto')).toBe(false);
  });

  it('derives pixel-ratio ranges from the device pixel ratio', () => {
    expect(getTierPixelRatioRange('low', 3)).toEqual({ min: 0.7, max: 1 });
    expect(getTierPixelRatioRange('medium', 3)).toEqual({ min: 0.85, max: 1 });
    expect(getTierPixelRatioRange('high', 3)).toEqual({ min: 1, max: 2 });
    expect(getTierPixelRatioRange('ultra', 3)).toEqual({ min: 1.25, max: 2 });
    expect(getTierPixelRatioRange('ultra', 1)).toEqual({ min: 1, max: 1 });
    // Invalid DPR falls back to 1.
    expect(getTierPixelRatioRange('high', Number.NaN)).toEqual({ min: 1, max: 1 });
  });

  it('builds tier settings at the top of the range and targets 0.85 DPR on high-DPR low tier', () => {
    const low = getTierSettings('low', 2);
    expect(low).toMatchObject({ tier: 'low', pixelRatio: 1, postProcessing: false, shadowMapSize: 1024 });
    const lowFoldable = getTierSettings('low', 2.5);
    expect(lowFoldable).toMatchObject({ tier: 'low', pixelRatio: 0.85, postProcessing: false });
    const ultra = getTierSettings('ultra', 2);
    expect(ultra).toMatchObject({ tier: 'ultra', pixelRatio: 2, bloom: true, shadowMapSize: 4096 });
  });

  it('clamps pixel ratios into the tier range', () => {
    expect(clampPixelRatioForTier('high', 3, 2)).toBe(2);
    expect(clampPixelRatioForTier('high', 0.2, 2)).toBe(1);
    const lowered = withPixelRatio(getTierSettings('ultra', 2), 1.4, 2);
    expect(lowered.pixelRatio).toBe(1.4);
    expect(lowered.tier).toBe('ultra');
  });

  it('uses 0 point lights on low tier and gives higher tiers a larger fixed point-light budget', () => {
    expect(getPointLightBudget('low')).toBe(0);
    const budgets = GRAPHICS_TIER_ORDER.map(getPointLightBudget);
    expect([...budgets].sort((a, b) => a - b)).toEqual(budgets);
    expect(new Set(budgets).size).toBe(budgets.length);
  });

  it("caps super-4K internal physical pixel counts to each tier pixel budget", () => {
    for (const tier of GRAPHICS_TIER_ORDER) {
      const pr = clampPixelRatioForViewport(tier, 1.5, 3840, 2160);
      const px = Math.round(3840 * pr) * Math.round(2160 * pr);
      expect(px).toBeLessThanOrEqual(MAX_RENDER_PIXELS_BY_TIER[tier]);
    }
    const ultra4k = clampPixelRatioForViewport("ultra", 1.5, 3840, 2160);
    expect(Math.round(3840 * ultra4k)).toBe(3840);
    expect(Math.round(2160 * ultra4k)).toBe(2160);
    // Native 4K on desktop 'high' is uncapped up to 8.3 MP (3840x2160), while super-4K clamps cleanly.
    expect(getTierSettings('high', 2, 3840, 2160).pixelRatio).toBeCloseTo(1, 3);
    expect(clampPixelRatioForViewport("high", 1.5, 1600, 900)).toBe(1.5);
  });
});
