import { describe, expect, it } from 'vitest';
import type { GraphicsTier, GraphicsTierSettings } from '../../core/types/twin-ux.ts';
import { PerformanceGovernor, QUALITY_REDUCED_TOAST } from './performance-governor.ts';

interface Harness {
  readonly governor: PerformanceGovernor;
  readonly applied: GraphicsTierSettings[];
  readonly toasts: string[];
  readonly autoTiers: GraphicsTier[];
  /** Feeds `count` moving frames of `dtMs`, advancing the fake clock. */
  frames(count: number, dtMs: number, moving?: boolean): void;
  advance(ms: number): void;
}

function createHarness(initialTier: GraphicsTier, devicePixelRatio: number, autoAdaptationEnabled = false): Harness {
  let clock = 0;
  const applied: GraphicsTierSettings[] = [];
  const toasts: string[] = [];
  const tiersList: GraphicsTier[] = [];
  const governor = new PerformanceGovernor({
    applyTier: (s) => applied.push(s),
    onToast: (m) => toasts.push(m),
    onAutoTierChange: (t) => tiersList.push(t),
    devicePixelRatio,
    initialTier,
    now: () => clock,
    persistMode: false,
    autoAdaptationEnabled,
  });
  return {
    governor,
    applied,
    toasts,
    autoTiers: tiersList,
    frames(count, dtMs, moving = true) {
      for (let i = 0; i < count; i += 1) {
        clock += dtMs;
        governor.recordFrame(dtMs, moving);
      }
    },
    advance(ms) {
      clock += ms;
    },
  };
}

describe('PerformanceGovernor', () => {
  it('applies the initial tier immediately', () => {
    const h = createHarness('high', 2);
    expect(h.applied).toHaveLength(1);
    expect(h.applied[0]).toMatchObject({ tier: 'high', pixelRatio: 2 });
    expect(h.governor.getMode()).toBe('auto');
  });

  it('holds tier and pixel ratio constant when p95Ms <= 33 ms', () => {
    const h = createHarness('high', 2);
    h.frames(200, 30);
    expect(h.governor.hasPendingChange()).toBe(false);
    h.governor.notifyCameraIdle();
    expect(h.applied).toHaveLength(1);
    expect(h.governor.getActiveSettings()).toMatchObject({ tier: 'high', pixelRatio: 2 });
    expect(h.toasts).toEqual([]);

    h.frames(400, 8);
    expect(h.governor.hasPendingChange()).toBe(false);
    h.governor.notifyCameraIdle();
    expect(h.applied).toHaveLength(1);
    expect(h.governor.getActiveSettings()).toMatchObject({ tier: 'high', pixelRatio: 2 });
  });

  it('keeps passive telemetry on desktop (!isMobile) and never auto-downgrades tier or pixelRatio', () => {
    const h = createHarness('ultra', 2, false);
    h.frames(120, 48);
    expect(h.governor.hasPendingChange()).toBe(false);
    h.governor.notifyCameraIdle();
    expect(h.governor.getActiveSettings()).toMatchObject({ tier: 'ultra', pixelRatio: 2, postProcessing: true });
    expect(h.governor.getStats().p95Ms).toBe(48);
  });

  it('auto-steps pixelRatio down toward dpr.min and then steps tier down on mobile when p95Ms > 33 ms across 2 consecutive active windows', () => {
    const h = createHarness('medium', 2, true);
    expect(h.governor.getActiveSettings()).toMatchObject({ tier: 'medium', pixelRatio: 1.0 });

    // Window 1 (> 2000ms at 45ms = 45 frames): only 1 slow window so far
    h.frames(46, 45);
    expect(h.governor.hasPendingChange()).toBe(false);

    // Window 2 (> 2000ms at 45ms): 2nd consecutive slow window -> steps pixelRatio 1.0 -> 0.85 (dpr.min)
    h.frames(46, 45);
    expect(h.governor.hasPendingChange()).toBe(true);
    h.governor.notifyCameraIdle();
    expect(h.governor.getActiveSettings()).toMatchObject({ tier: 'medium', pixelRatio: 0.85 });
    expect(h.toasts).toEqual([]);

    // Next 2 consecutive slow windows at dpr.min -> drops tier medium -> low!
    h.frames(92, 45);
    expect(h.governor.hasPendingChange()).toBe(true);
    h.governor.notifyCameraIdle();
    expect(h.governor.getActiveSettings()).toMatchObject({ tier: 'low', pixelRatio: 1.0 });
    expect(h.toasts).toEqual([QUALITY_REDUCED_TOAST]);
    // Never calls onAutoTierChange for session runtime step-downs (no permanent localStorage lockout)
    expect(h.autoTiers).toEqual([]);
  });

  it('ignores frames while the camera is idle and hitch frames', () => {
    const h = createHarness('high', 2);
    h.frames(300, 50, false);
    h.frames(300, 400);
    expect(h.governor.hasPendingChange()).toBe(false);
    expect(h.governor.getStats().p95Ms).toBe(0);
  });

  it('never adapts in a pinned manual mode', () => {
    const h = createHarness('high', 2);
    h.governor.setMode('ultra');
    expect(h.governor.getActiveTier()).toBe('ultra');
    h.frames(300, 50);
    expect(h.governor.hasPendingChange()).toBe(false);
    h.governor.setMode('auto');
    expect(h.governor.getActiveTier()).toBe('high');
  });

  it('reports fps and p95 from the rolling window', () => {
    const h = createHarness('high', 2);
    h.frames(40, 16);
    const stats = h.governor.getStats();
    expect(stats.p95Ms).toBe(16);
    expect(stats.fps).toBeCloseTo(62.5, 5);
    expect(stats.tier).toBe('high');
  });

  it('re-applies the tier when the device pixel ratio changes', () => {
    const h = createHarness('ultra', 2);
    h.governor.setDevicePixelRatio(1);
    expect(h.governor.getActiveSettings()).toMatchObject({ tier: 'ultra', pixelRatio: 1 });
  });
});
