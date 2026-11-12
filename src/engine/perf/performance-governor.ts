import type {
  GraphicsMode,
  GraphicsTier,
  GraphicsTierSettings,
} from '../../core/types/twin-ux.ts';
import { detectMobile } from './device-tier.ts';
import {
  getTierPixelRatioRange,
  getTierSettings,
  stepTier,
  withPixelRatio,
} from './tier-settings.ts';

export const GRAPHICS_MODE_STORAGE_KEY = 'hus_graphics_mode_v1';
const MOBILE_GRAPHICS_MODE_STORAGE_KEY = 'hus_graphics_mode_mobile_v3';
export const QUALITY_REDUCED_TOAST = 'Graphics quality reduced for smoother navigation';

/** Rolling window length for moving-camera frame samples. */
const WINDOW_MS = 2000;
/** Minimum sample count before reporting p95 / fps or evaluating a slow window. */
const MIN_WINDOW_SAMPLES = 20;
/** Frames longer than this are treated as tab-switch / shader-compile hitches and ignored. */
const MAX_VALID_FRAME_MS = 250;
/** p95 frame time threshold (~30 FPS) above which a window counts as overloaded. */
const SLOW_WINDOW_P95_MS = 33;
/** Consecutive overloaded windows required before stepping down resolution / tier. */
const CONSECUTIVE_SLOW_WINDOWS_TO_STEP_DOWN = 2;
/** Resolution step-down increment within the current tier before dropping a full tier. */
const PIXEL_RATIO_STEP_DOWN = 0.15;
/** Throttle interval (ms) for p95 percentile sorting so recordFrame() allocates & sorts 0 arrays per frame. */
const P95_RECOMPUTE_INTERVAL_MS = 500;
/** Pre-allocated ring-buffer capacity (>= 2s @ 500 FPS). */
const SAMPLE_RING_CAPACITY = 1024;

export interface PerformanceGovernorOptions {
  readonly applyTier: (settings: GraphicsTierSettings) => void;
  readonly onToast?: (message: string) => void;
  /** Called when startup `auto` tier is updated (e.g. after `renderer.init()`). */
  readonly onAutoTierChange?: (tier: GraphicsTier) => void;
  readonly devicePixelRatio: number;
  readonly initialTier: GraphicsTier;
  /** Clock override (milliseconds) for deterministic unit tests. */
  readonly now?: () => number;
  /** Set `false` in unit tests to skip `localStorage`. Defaults to `true`. */
  readonly persistMode?: boolean;
  /** Enables runtime auto-downgrading (mobile only by default; passive telemetry on desktop). */
  readonly autoAdaptationEnabled?: boolean;
  readonly viewportWidth?: number;
  readonly viewportHeight?: number;
}

export interface PerformanceGovernorStats {
  readonly fps: number;
  readonly p95Ms: number;
  readonly tier: GraphicsTier;
  readonly pixelRatio: number;
}

// Pre-allocated typed-array ring buffer replaces per-frame FrameSample allocations & Array.sort().

/**
 * Estimates graphics quality at startup (or honours a user-pinned tier) and monitors
 * moving-camera p95 frame times in `auto` mode. When `p95Ms > 33 ms` across 2 consecutive
 * active 2 s windows, steps `pixelRatio` down toward `dpr.min`, then steps tier down
 * (`ultra -> high -> medium -> low`), without persisting temporary session step-downs to
 * `localStorage` so desktop sessions never lock into `'low'` across reloads.
 */
export class PerformanceGovernor {
  private readonly applyTierFn: (settings: GraphicsTierSettings) => void;
  private readonly onToast?: (message: string) => void;
  private readonly onAutoTierChange?: (tier: GraphicsTier) => void;
  private readonly now: () => number;
  private readonly persistMode: boolean;

  private devicePixelRatio: number;
  private autoAdaptationEnabled: boolean;
  private viewportWidth?: number;
  private viewportHeight?: number;
  private mode: GraphicsMode = 'auto';
  private autoTier: GraphicsTier;
  private active: GraphicsTierSettings;
  private pending: GraphicsTierSettings | null = null;
  private pendingTierDropped = false;

  private readonly sampleTimes = new Float64Array(SAMPLE_RING_CAPACITY);
  private readonly sampleDts = new Float64Array(SAMPLE_RING_CAPACITY);
  private readonly sortScratch = new Float64Array(SAMPLE_RING_CAPACITY);
  private sampleHead = 0;
  private sampleCount = 0;
  private windowDtSum = 0;
  private lastP95ComputeTime: number | null = null;
  private lastWindowP95 = 0;
  private lastWindowAvg = 0;
  private evalWindowAnchorTime: number | null = null;
  private evalWindowFrameCount = 0;
  private consecutiveSlowWindows = 0;

  public constructor(opts: PerformanceGovernorOptions) {
    this.applyTierFn = opts.applyTier;
    this.onToast = opts.onToast;
    this.onAutoTierChange = opts.onAutoTierChange;
    this.devicePixelRatio = opts.devicePixelRatio > 0 ? opts.devicePixelRatio : 1;
    this.autoAdaptationEnabled = opts.autoAdaptationEnabled ?? detectMobile();
    this.viewportWidth = opts.viewportWidth;
    this.viewportHeight = opts.viewportHeight;
    this.autoTier = opts.initialTier;
    this.now =
      opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this.persistMode = opts.persistMode ?? true;

    const stored = this.readStoredMode();
    if (stored) this.mode = stored;

    const tier = this.mode === 'auto' ? this.autoTier : this.mode;
    this.active = getTierSettings(tier, this.devicePixelRatio, this.viewportWidth, this.viewportHeight);
    this.applyTierFn(this.active);
  }

  /** Switches between `auto` and a pinned tier. Applied immediately (explicit user action). */
  public setMode(mode: GraphicsMode): void {
    this.mode = mode;
    this.writeStoredMode(mode);
    this.resetMeasurements();

    const tier = mode === 'auto' ? this.autoTier : mode;
    this.commit(getTierSettings(tier, this.devicePixelRatio, this.viewportWidth, this.viewportHeight));
  }

  public getMode(): GraphicsMode {
    return this.mode;
  }

  public getActiveTier(): GraphicsTier {
    return this.active.tier;
  }

  public getActiveSettings(): GraphicsTierSettings {
    return this.active;
  }

  /**
   * Replaces the startup auto tier (e.g. after `await renderer.init()` exposes the real GPU adapter).
   * Applied immediately in `auto` mode; remembered for later in manual modes.
   */
  public setAutoTier(tier: GraphicsTier): void {
    this.autoTier = tier;
    this.onAutoTierChange?.(tier);
    if (this.mode !== 'auto' || tier === this.active.tier) return;
    this.resetMeasurements();
    this.commit(getTierSettings(tier, this.devicePixelRatio, this.viewportWidth, this.viewportHeight));
  }

  /** Updates the device DPR (e.g. window moved to another monitor) and re-applies the current tier. */
  public setDevicePixelRatio(devicePixelRatio: number): void {
    if (!(devicePixelRatio > 0) || devicePixelRatio === this.devicePixelRatio) return;
    this.devicePixelRatio = devicePixelRatio;
    this.pending = null;
    this.pendingTierDropped = false;
    this.commit(withPixelRatio(this.active, this.active.pixelRatio, devicePixelRatio));
  }

  private clearSampleRing(): void {
    this.sampleHead = 0;
    this.sampleCount = 0;
    this.windowDtSum = 0;
    this.lastP95ComputeTime = null;
  }

  private recomputeP95Now(t: number): void {
    const count = this.sampleCount;
    if (count <= 0) {
      this.lastWindowP95 = 0;
      return;
    }
    const cap = SAMPLE_RING_CAPACITY;
    const head = this.sampleHead;
    const dts = this.sampleDts;
    const scratch = this.sortScratch;
    let sum = 0;
    for (let i = 0; i < count; i++) {
      const v = dts[(head + i) & (cap - 1)]!;
      scratch[i] = v;
      sum += v;
    }
    this.windowDtSum = sum;
    this.lastWindowAvg = sum / count;
    const view = scratch.subarray(0, count);
    view.sort();
    const idx = Math.min(count - 1, Math.max(0, Math.ceil(0.95 * count) - 1));
    this.lastWindowP95 = view[idx]!;
    this.lastP95ComputeTime = t;
  }

  /** Records one rendered frame for FPS / p95 telemetry and evaluates runtime auto-step-down. */
  public recordFrame(dtMs: number, cameraMoving: boolean): void {
    if (!cameraMoving || !(dtMs > 0) || dtMs > MAX_VALID_FRAME_MS) return;

    const t = this.now();
    const cap = SAMPLE_RING_CAPACITY;
    const mask = cap - 1;
    const cutoff = t - WINDOW_MS;

    while (this.sampleCount > 0 && this.sampleTimes[this.sampleHead]! < cutoff) {
      this.windowDtSum -= this.sampleDts[this.sampleHead]!;
      this.sampleHead = (this.sampleHead + 1) & mask;
      this.sampleCount -= 1;
    }

    if (this.sampleCount === cap) {
      this.windowDtSum -= this.sampleDts[this.sampleHead]!;
      this.sampleHead = (this.sampleHead + 1) & mask;
      this.sampleCount -= 1;
    }

    const tail = (this.sampleHead + this.sampleCount) & mask;
    this.sampleTimes[tail] = t;
    this.sampleDts[tail] = dtMs;
    this.sampleCount += 1;
    this.windowDtSum += dtMs;

    if (this.evalWindowAnchorTime === null) {
      this.evalWindowAnchorTime = t - dtMs;
      this.evalWindowFrameCount = 0;
    }
    this.evalWindowFrameCount += 1;

    if (this.sampleCount < MIN_WINDOW_SAMPLES) return;

    this.lastWindowAvg = this.windowDtSum / this.sampleCount;

    const evalWindowReady =
      this.mode === 'auto' &&
      this.autoAdaptationEnabled &&
      t - this.evalWindowAnchorTime >= WINDOW_MS &&
      this.evalWindowFrameCount >= MIN_WINDOW_SAMPLES;

    if (
      this.lastP95ComputeTime === null ||
      t - this.lastP95ComputeTime >= P95_RECOMPUTE_INTERVAL_MS ||
      evalWindowReady
    ) {
      this.recomputeP95Now(t);
    }

    if (!evalWindowReady) return;

    this.evalWindowAnchorTime = t;
    this.evalWindowFrameCount = 0;

    if (this.lastWindowP95 > SLOW_WINDOW_P95_MS) {
      this.consecutiveSlowWindows += 1;
      if (this.consecutiveSlowWindows >= CONSECUTIVE_SLOW_WINDOWS_TO_STEP_DOWN) {
        this.consecutiveSlowWindows = 0;
        this.scheduleOrApplyStepDown();
      }
    } else {
      this.consecutiveSlowWindows = 0;
    }
  }

  /** Applies any queued auto-step-down once camera motion pauses (avoiding mid-gesture stutter). */
  public notifyCameraIdle(): void {
    if (!this.pending) return;
    const next = this.pending;
    const droppedTier = this.pendingTierDropped;
    this.pending = null;
    this.pendingTierDropped = false;
    this.clearSampleRing();
    this.evalWindowAnchorTime = null;
    this.evalWindowFrameCount = 0;
    this.consecutiveSlowWindows = 0;
    this.commit(next);
    if (droppedTier) {
      this.onToast?.(QUALITY_REDUCED_TOAST);
    }
  }

  public setAutoAdaptationEnabled(enabled: boolean): void {
    this.autoAdaptationEnabled = enabled;
    if (!enabled) {
      this.pending = null;
      this.pendingTierDropped = false;
      this.consecutiveSlowWindows = 0;
    }
  }

  /** Stores the viewport-clamped effective render pixelRatio without re-triggering applyTier. */
  public syncEffectivePixelRatio(effectivePixelRatio: number): void {
    if (!(effectivePixelRatio > 0) || !Number.isFinite(effectivePixelRatio)) return;
    const rounded = Math.round(effectivePixelRatio * 100) / 100;
    if (this.active.pixelRatio !== rounded) {
      this.active = { ...this.active, pixelRatio: rounded };
    }
  }

  public hasPendingChange(): boolean {
    return this.pending !== null;
  }

  public getStats(): PerformanceGovernorStats {
    return {
      fps: this.lastWindowAvg > 0 ? 1000 / this.lastWindowAvg : 0,
      p95Ms: this.lastWindowP95,
      tier: this.active.tier,
      pixelRatio: this.active.pixelRatio,
    };
  }

  private scheduleOrApplyStepDown(): void {
    const base = this.pending ?? this.active;
    const range = getTierPixelRatioRange(base.tier, this.devicePixelRatio);
    let nextSettings: GraphicsTierSettings | null = null;
    let tierDropped = false;

    if (base.pixelRatio > range.min + 1e-3) {
      const loweredRatio = Math.max(range.min, base.pixelRatio - PIXEL_RATIO_STEP_DOWN);
      nextSettings = withPixelRatio(base, loweredRatio, this.devicePixelRatio);
    } else if (base.tier !== 'low') {
      const lowerTier = stepTier(base.tier, -1);
      nextSettings = getTierSettings(lowerTier, this.devicePixelRatio);
      tierDropped = true;
    }

    if (!nextSettings) return;

    // Pixel-ratio reductions within the same tier are cheap and safe to apply immediately if
    // a previous step-down is already pending during continuous walkthrough/orbit; tier drops
    // wait for notifyCameraIdle() unless another slow pair accumulates while still moving.
    if (this.pending !== null) {
      const shouldToast = this.pendingTierDropped || tierDropped;
      this.pending = null;
      this.pendingTierDropped = false;
      this.clearSampleRing();
      this.commit(nextSettings);
      if (shouldToast) {
        this.onToast?.(QUALITY_REDUCED_TOAST);
      }
      return;
    }

    this.pending = nextSettings;
    this.pendingTierDropped = tierDropped;
  }

  private commit(settings: GraphicsTierSettings): void {
    this.active = settings;
    this.applyTierFn(settings);
  }

  private resetMeasurements(): void {
    this.clearSampleRing();
    this.pending = null;
    this.pendingTierDropped = false;
    this.evalWindowAnchorTime = null;
    this.evalWindowFrameCount = 0;
    this.consecutiveSlowWindows = 0;
  }

  private readStoredMode(): GraphicsMode | null {
    if (!this.persistMode) return null;
    try {
      const key = detectMobile() ? MOBILE_GRAPHICS_MODE_STORAGE_KEY : GRAPHICS_MODE_STORAGE_KEY;
      const raw = localStorage.getItem(key);
      return isGraphicsMode(raw) ? raw : null;
    } catch {
      return null;
    }
  }

  private writeStoredMode(mode: GraphicsMode): void {
    if (!this.persistMode) return;
    try {
      const key = detectMobile() ? MOBILE_GRAPHICS_MODE_STORAGE_KEY : GRAPHICS_MODE_STORAGE_KEY;
      localStorage.setItem(key, mode);
    } catch {
      // Storage unavailable; mode lasts for this session only.
    }
  }
}

function isGraphicsMode(v: string | null): v is GraphicsMode {
  return v === 'auto' || v === 'low' || v === 'medium' || v === 'high' || v === 'ultra';
}

