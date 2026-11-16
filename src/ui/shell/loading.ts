/**
 * Controls the startup loading overlay inside the mounted host container
 * (`#loading-screen` if pre-rendered, or dynamically created inside the host
 * so `<div id="app"></div>` and bare `<div>` mounts work with zero boilerplate).
 */
export interface LoadingScreen {
  setProgress(label: string, fraction: number): Promise<void>;
  fail(message: string): void;
  finish(): void;
  setTitle?(title: string): void;
}

export type StartupPhaseId =
  | 'preflight'
  | 'zones'
  | 'batching'
  | 'textures'
  | 'compile'
  | 'firstFrame';

export interface StartupPhaseRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Weighted real-work startup phase ranges:
 * - `preflight`:  0–6%   (UI shell, smart-home bus, GPU & active preview HDRI kick-off)
 * - `zones`:      6–48%  (zone & room construction proportional to zones/sub-steps completed)
 * - `batching`:   48–66% (bevels, colliders & static geometry batching proportional to groups merged)
 * - `textures`:   66–80% (active preview HDRI & scene texture GPU upload proportional to textures uploaded)
 * - `compile`:    80–96% (active-bucket WebGPU render & shadow pipeline compilation)
 * - `firstFrame`: 96–100% (initial frame render & overlay dissolve)
 */
export const STARTUP_PHASE_RANGES: Readonly<Record<StartupPhaseId, StartupPhaseRange>> = {
  preflight: { start: 0.0, end: 0.06 },
  zones: { start: 0.06, end: 0.48 },
  batching: { start: 0.48, end: 0.66 },
  textures: { start: 0.66, end: 0.8 },
  compile: { start: 0.8, end: 0.96 },
  firstFrame: { start: 0.96, end: 1.0 },
};

const MIN_PAINT_YIELD_INTERVAL_MS = 16;
export const DEFAULT_FRAME_BUDGET_MS = 14;
export const LOADING_DISSOLVE_MS = 320;

export interface FrameBudgetYielder {
  /** Yields via `requestAnimationFrame` only when `>= budgetMs` have elapsed since the last paint yield. */
  yieldIfNeeded(): Promise<boolean>;
  /** Timestamp (`performance.now()`) of the most recent paint yield. */
  getLastPaintTimeMs(): number;
  /** Cumulative number of cooperative paint yields performed. */
  getYieldCount(): number;
  /** Cumulative milliseconds spent waiting on `requestAnimationFrame` yields. */
  getTotalYieldOverheadMs(): number;
  /** Records that a `requestAnimationFrame` paint yield just completed at `nowMs`. */
  markPainted(nowMs?: number): void;
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      resolve();
    }
  });
}

let sharedFrameYieldLastPaintMs = -Infinity;

/**
 * Yields cooperatively to the browser's rendering pipeline via `requestAnimationFrame`
 * only when at least `budgetMs` (default `14 ms`, matching a 60 Hz frame budget) have
 * elapsed since the last paint yield.
 */
export async function yieldToFrameBudget(budgetMs = DEFAULT_FRAME_BUDGET_MS): Promise<boolean> {
  const start = nowMs();
  if (start - sharedFrameYieldLastPaintMs < Math.max(1, budgetMs)) {
    return false;
  }
  await nextAnimationFrame();
  sharedFrameYieldLastPaintMs = nowMs();
  return true;
}

export function createFrameBudgetYielder(
  budgetMs = DEFAULT_FRAME_BUDGET_MS,
  minPaintIntervalMs = MIN_PAINT_YIELD_INTERVAL_MS
): FrameBudgetYielder {
  const thresholdMs = Math.max(1, Math.min(budgetMs, minPaintIntervalMs));
  let lastPaintMs = nowMs();
  let yieldCount = 0;
  let totalOverheadMs = 0;

  return {
    async yieldIfNeeded(): Promise<boolean> {
      const t0 = nowMs();
      if (t0 - lastPaintMs < thresholdMs && t0 - lastPaintMs < MIN_PAINT_YIELD_INTERVAL_MS) {
        return false;
      }
      await nextAnimationFrame();
      const t1 = nowMs();
      lastPaintMs = t1;
      sharedFrameYieldLastPaintMs = t1;
      yieldCount += 1;
      totalOverheadMs += Math.max(0, t1 - t0);
      return true;
    },
    getLastPaintTimeMs(): number {
      return lastPaintMs;
    },
    getYieldCount(): number {
      return yieldCount;
    },
    getTotalYieldOverheadMs(): number {
      return totalOverheadMs;
    },
    markPainted(atMs?: number): void {
      const t = atMs ?? nowMs();
      lastPaintMs = t;
      sharedFrameYieldLastPaintMs = t;
    },
  };
}

/**
 * Monotonic weighted real-work progress tracker mapping each startup phase's
 * actual completed work units `[0..1]` onto the unified `[0..1]` progress bar.
 */
export class StartupProgressMeter {
  private readonly loading: LoadingScreen;
  private readonly yielder: FrameBudgetYielder;
  private currentFraction = 0;
  private currentLabel = 'Preparing architectural scene';

  public constructor(
    loading: LoadingScreen,
    options?: { readonly frameBudgetMs?: number }
  ) {
    this.loading = loading;
    this.yielder = createFrameBudgetYielder(
      options?.frameBudgetMs ?? DEFAULT_FRAME_BUDGET_MS,
      MIN_PAINT_YIELD_INTERVAL_MS
    );
  }

  public getFraction(): number {
    return this.currentFraction;
  }

  public getLabel(): string {
    return this.currentLabel;
  }

  public getYielder(): FrameBudgetYielder {
    return this.yielder;
  }

  public mapPhaseFraction(phase: StartupPhaseId, phaseProgress01: number): number {
    const range = STARTUP_PHASE_RANGES[phase];
    const clampedLocal = Number.isFinite(phaseProgress01)
      ? Math.max(0, Math.min(1, phaseProgress01))
      : 0;
    return range.start + (range.end - range.start) * clampedLocal;
  }

  /**
   * Advances a weighted phase by `completed / total` real work units (monotonic)
   * and yields to `requestAnimationFrame` only when the frame budget has elapsed.
   */
  public async advancePhase(
    phase: StartupPhaseId,
    phaseProgress01: number,
    label?: string
  ): Promise<void> {
    const mapped = this.mapPhaseFraction(phase, phaseProgress01);
    await this.setOverall(mapped, label);
  }

  public async advanceWorkUnits(
    phase: StartupPhaseId,
    completed: number,
    total: number,
    label?: string
  ): Promise<void> {
    const ratio = total > 0 ? completed / total : 1;
    await this.advancePhase(phase, ratio, label);
  }

  public async setOverall(fraction: number, label?: string): Promise<void> {
    const clamped = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
    if (clamped > this.currentFraction) {
      this.currentFraction = clamped;
    }
    if (label && label.trim().length > 0) {
      this.currentLabel = label;
    }
    await this.loading.setProgress(this.currentLabel, this.currentFraction);
  }

  /** Cooperative yield check inside tight synchronous loops without changing the phase fraction. */
  public async yieldIfNeeded(label?: string): Promise<void> {
    if (label && label.trim().length > 0 && label !== this.currentLabel) {
      this.currentLabel = label;
    }
    const elapsed = nowMs() - this.yielder.getLastPaintTimeMs();
    if (elapsed >= MIN_PAINT_YIELD_INTERVAL_MS) {
      await this.loading.setProgress(this.currentLabel, this.currentFraction);
      this.yielder.markPainted();
    }
  }
}

export const HUS_RIBBON_MARK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 64 64"><defs><linearGradient id="g" gradientUnits="userSpaceOnUse"/><linearGradient id="r" x1="22" y1="6" x2="58" y2="36" href="#g"><stop stop-color="#FFB482"/><stop offset=".38" stop-color="#F25A2E"/><stop offset="1" stop-color="#B8260B"/></linearGradient><linearGradient id="w" x1="40" y1="26" x2="58" y2="56" href="#g"><stop stop-color="#9E220B"/><stop offset="1" stop-color="#611003"/></linearGradient><linearGradient id="i" x1="10" y1="18" x2="36" y2="52" href="#g"><stop stop-color="#C43B14"/><stop offset="1" stop-color="#7D1906"/></linearGradient><linearGradient id="l" x1="18" y1="40" x2="52" y2="56" href="#g"><stop stop-color="#FFE694"/><stop offset="1" stop-color="#EB8123"/></linearGradient><linearGradient id="f" x1="6" y1="14" x2="46" y2="58" href="#g"><stop stop-color="#FFD688"/><stop offset=".52" stop-color="#F59438"/><stop offset="1" stop-color="#DB5B1C"/></linearGradient></defs><path d="M9 55.57L23.8 47.07A1 1 0 0 0 24.3 46.2L24.3 26.4A3.9 3.9 0 0 1 25.44 23.64L37.08 12L24.6 18.2L7.5 34.5L7.5 54.8Z" fill="url(#i)"/><path d="M19.1 53.13L33.9 44.63A1 1 0 0 1 34.4 44.5L42.5 44.5L42.5 55L19.8 55Z" fill="url(#l)"/><path d="M57.25 19.75A9.4 9.4 0 0 1 60 26.4L60 40.8A9.2 9.2 0 0 1 55.38 48.78L40.58 57.28L38.5 55.5L43.2 49L43.2 31Z" fill="url(#w)"/><path d="M20.23 15.2L35.03 6.7A8.77 8.77 0 0 1 45.6 8.1L57.25 19.75A9.4 9.4 0 0 1 59.71 24.1L44.91 32.6L43.2 33.2L30 18.2L22.5 17.5Z" fill="url(#r)"/><path d="M5 55.7A1 1 0 0 1 4 54.7L4 34.9A9.4 9.4 0 0 1 6.75 28.25L18.4 16.6A8.77 8.77 0 0 1 30.8 16.6L42.45 28.25A9.4 9.4 0 0 1 45.2 34.9L45.2 49.3A9.2 9.2 0 0 1 36 58.5L19.6 58.5A1 1 0 0 1 18.6 57.5L18.6 54A1 1 0 0 1 19.6 53L36.1 53A3.7 3.7 0 0 0 39.8 49.3L39.8 34.9A3.9 3.9 0 0 0 38.66 32.14L27.02 20.5A3.35 3.35 0 0 0 22.28 20.5L10.64 32.14A3.9 3.9 0 0 0 9.5 34.9L9.5 54.7A1 1 0 0 1 8.5 55.7Z" fill="url(#f)"/></svg>';

const PREBOOT_HOUSE_TITLES: Readonly<Record<string, string>> = {
  'stahl-house': 'Stahl House (Case Study #22)',
  'simple-flat': 'Pied-à-terre Apartment',
  'simple-house': 'Georgian Country House',
};

/**
 * Maps verbose internal house definition names to balanced display titles when
 * `#loading-screen` was pre-seeded by `index.html`, preventing title flash on boot.
 */
function resolveDisplayTitle(root: HTMLElement | null, incomingTitle: string): string {
  const prebootHouse = root?.getAttribute('data-preboot-house');
  if (!prebootHouse) return incomingTitle;

  const lower = incomingTitle.trim().toLowerCase();
  if (lower.includes('georgian')) return PREBOOT_HOUSE_TITLES['simple-house'];
  if (lower.includes('stahl') || lower.includes('case study')) {
    return PREBOOT_HOUSE_TITLES['stahl-house'];
  }
  if (lower.includes('simple flat') || lower.includes('pied')) {
    return PREBOOT_HOUSE_TITLES['simple-flat'];
  }
  return incomingTitle;
}

function cleanStageLabel(raw: string): string {
  const cleaned = raw.trim().replace(/(?:\.\.\.|…)+$/u, '').trim();
  return cleaned || 'Loading scene';
}

function renderStageAndPercentage(labelEl: HTMLElement, stageText: string, pct: number): void {
  const doc = labelEl.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
  if (!doc) {
    labelEl.textContent = `${cleanStageLabel(stageText)} · ${pct}%`;
    return;
  }
  let stageSpan = labelEl.querySelector('.loading-stage') as HTMLElement | null;
  let pctSpan = labelEl.querySelector('.loading-pct') as HTMLElement | null;
  if (!stageSpan || !pctSpan) {
    labelEl.textContent = '';
    stageSpan = doc.createElement('span');
    stageSpan.className = 'loading-stage';

    const sepSpan = doc.createElement('span');
    sepSpan.className = 'loading-sep';
    sepSpan.setAttribute('aria-hidden', 'true');
    sepSpan.textContent = ' · ';

    pctSpan = doc.createElement('span');
    pctSpan.className = 'loading-pct';

    labelEl.append(stageSpan, sepSpan, pctSpan);
  }
  const nextStage = cleanStageLabel(stageText);
  if (stageSpan.textContent !== nextStage) {
    stageSpan.textContent = nextStage;
  }
  const nextPct = `${pct}%`;
  if (pctSpan.textContent !== nextPct) {
    pctSpan.textContent = nextPct;
  }
}

function promoteDeferredStylesheets(): void {
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') {
    return;
  }
  const links = document.querySelectorAll('link[rel="stylesheet"][data-hus-async-css]');
  for (let i = 0; i < links.length; i++) {
    const link = links[i] as HTMLLinkElement;
    if (link.media && link.media !== 'all') {
      link.media = 'all';
    }
  }
}

function resolveOrCreateLoadingElements(
  host?: HTMLElement | Document,
  titleText?: string
): {
  root: HTMLElement | null;
  label: HTMLElement | null;
  bar: HTMLElement | null;
  titleEl: HTMLElement | null;
} {
  if (typeof document === 'undefined') {
    return { root: null, label: null, bar: null, titleEl: null };
  }

  const queryScope =
    host instanceof HTMLElement
      ? host
      : (document.getElementById('app') ?? document.body);

  let root =
    (queryScope?.querySelector('.loading-screen') as HTMLElement | null) ??
    document.getElementById('loading-screen');

  if (!root && queryScope) {
    root = document.createElement('div');
    root.className = 'loading-screen';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');

    const card = document.createElement('div');
    card.className = 'loading-card';

    const mark = document.createElement('div');
    mark.className = 'loading-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.innerHTML = HUS_RIBBON_MARK_SVG;

    const eyebrow = document.createElement('div');
    eyebrow.className = 'loading-eyebrow';
    eyebrow.textContent = 'HUS · ARCHITECTURAL TWIN';

    const title = document.createElement('div');
    title.className = 'loading-title';
    title.textContent = titleText ?? 'Architectural Twin';

    const labelEl = document.createElement('div');
    labelEl.className = 'loading-label';
    renderStageAndPercentage(labelEl, 'Preparing architectural scene', 0);

    const barTrack = document.createElement('div');
    barTrack.className = 'loading-bar';
    barTrack.setAttribute('aria-hidden', 'true');

    const barFill = document.createElement('div');
    barFill.className = 'loading-bar-fill';
    barTrack.appendChild(barFill);

    card.append(mark, eyebrow, title, labelEl, barTrack);
    root.appendChild(card);
    queryScope.appendChild(root);
  }

  const titleEl = root?.querySelector('.loading-title') as HTMLElement | null;
  if (titleEl && titleText) {
    titleEl.textContent = resolveDisplayTitle(root, titleText);
  }

  const label =
    (root?.querySelector('.loading-label') as HTMLElement | null) ??
    document.getElementById('loading-label');
  const bar =
    (root?.querySelector('.loading-bar-fill') as HTMLElement | null) ??
    document.getElementById('loading-bar-fill');

  return { root, label, bar, titleEl };
}

export function getLoadingScreen(
  host?: HTMLElement | Document,
  title?: string
): LoadingScreen {
  const { root, label, bar, titleEl } = resolveOrCreateLoadingElements(host, title);
  let lastPaintTimeMs = -Infinity;
  let highWaterFraction = 0;

  return {
    async setProgress(text: string, fraction: number): Promise<void> {
      const rawClamped = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
      if (rawClamped > highWaterFraction) {
        highWaterFraction = rawClamped;
      }
      const effective = highWaterFraction;
      const pct = Math.round(effective * 100);
      if (label) {
        renderStageAndPercentage(label, text, pct);
      }
      if (bar) {
        const widthPct = Math.max(2, Math.round(effective * 1000) / 10);
        bar.style.width = `${widthPct}%`;
      }
      const t0 = nowMs();
      if (t0 - lastPaintTimeMs >= MIN_PAINT_YIELD_INTERVAL_MS) {
        await nextAnimationFrame();
        const t1 = nowMs();
        lastPaintTimeMs = t1;
        sharedFrameYieldLastPaintMs = t1;
      }
    },
    fail(message: string): void {
      if (label) label.textContent = message;
      root?.classList.add('is-error');
    },
    finish(): void {
      promoteDeferredStylesheets();
      if (!root) return;
      if (bar) {
        bar.style.width = '100%';
      }
      if (label) {
        const stageText =
          (label.querySelector('.loading-stage') as HTMLElement | null)?.textContent ??
          'Ready';
        renderStageAndPercentage(label, stageText, 100);
      }
      root.classList.add('is-done');
      if (typeof window !== 'undefined') {
        window.setTimeout(() => root.remove(), LOADING_DISSOLVE_MS);
      } else {
        root.remove();
      }
    },
    setTitle(newTitle: string): void {
      if (titleEl) {
        titleEl.textContent = resolveDisplayTitle(root, newTitle);
      }
    },
  };
}
