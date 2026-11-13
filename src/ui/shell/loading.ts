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

const MIN_PAINT_YIELD_INTERVAL_MS = 250;
export const LOADING_DISSOLVE_MS = 320;

export const HUS_RIBBON_MARK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 64 64"><defs><linearGradient id="g" gradientUnits="userSpaceOnUse"/><linearGradient id="r" x1="22" y1="6" x2="58" y2="36" href="#g"><stop stop-color="#FFB482"/><stop offset=".38" stop-color="#F25A2E"/><stop offset="1" stop-color="#B8260B"/></linearGradient><linearGradient id="w" x1="40" y1="26" x2="58" y2="56" href="#g"><stop stop-color="#9E220B"/><stop offset="1" stop-color="#611003"/></linearGradient><linearGradient id="i" x1="10" y1="18" x2="36" y2="52" href="#g"><stop stop-color="#C43B14"/><stop offset="1" stop-color="#7D1906"/></linearGradient><linearGradient id="l" x1="18" y1="40" x2="52" y2="56" href="#g"><stop stop-color="#FFE694"/><stop offset="1" stop-color="#EB8123"/></linearGradient><linearGradient id="f" x1="6" y1="14" x2="46" y2="58" href="#g"><stop stop-color="#FFD688"/><stop offset=".52" stop-color="#F59438"/><stop offset="1" stop-color="#DB5B1C"/></linearGradient></defs><path d="M9.5 55.7L9.5 34.9A3.9 3.9 0 0 1 10.6 32.2L22.3 20.5L37.1 11.9L25.4 23.6A3.9 3.9 0 0 0 24.2 26.4L24.2 47.2Z" fill="url(#i)"/><path d="M36.1 53L18.6 53L33.4 44.5L50.8 44.5Z" fill="url(#l)"/><path d="M44.9 32.6A9.4 9.4 0 0 1 45.2 34.9L45.2 49.3A9.2 9.2 0 0 1 40.6 57.2L55.4 48.7A9.2 9.2 0 0 0 60 40.8L60 26.4A9.4 9.4 0 0 0 59.7 24.1Z" fill="url(#w)" stroke="url(#w)" stroke-width=".2"/><path d="M20.2 15.2A8.7 8.7 0 0 1 30.8 16.6L42.5 28.3A9.4 9.4 0 0 1 44.9 32.6L59.7 24.1A9.4 9.4 0 0 0 57.3 19.8L45.6 8.1A8.7 8.7 0 0 0 35 6.7Z" fill="url(#r)"/><path d="M5 55.7A1 1 0 0 1 4 54.7L4 34.9A9.4 9.4 0 0 1 6.7 28.3L18.4 16.6A8.7 8.7 0 0 1 30.8 16.6L42.5 28.3A9.4 9.4 0 0 1 45.2 34.9L45.2 49.3A9.2 9.2 0 0 1 36.1 58.5L19.6 58.5A1 1 0 0 1 18.6 57.5L18.6 54A1 1 0 0 1 19.6 53L36.1 53A3.7 3.7 0 0 0 39.8 49.3L39.8 34.9A3.9 3.9 0 0 0 38.6 32.2L26.9 20.5A3.3 3.3 0 0 0 22.3 20.5L10.6 32.2A3.9 3.9 0 0 0 9.5 34.9L9.5 54.7A1 1 0 0 1 8.5 55.7Z" fill="url(#f)"/></svg>';

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
  stageSpan.textContent = cleanStageLabel(stageText);
  pctSpan.textContent = `${pct}%`;
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      resolve();
    }
  });
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
  let lastYieldMs = -Infinity;

  return {
    async setProgress(text: string, fraction: number): Promise<void> {
      const clamped = Math.max(0, Math.min(1, fraction));
      const pct = Math.round(clamped * 100);
      if (label) {
        renderStageAndPercentage(label, text, pct);
      }
      if (bar) {
        bar.style.width = `${Math.max(2, pct)}%`;
      }
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      if (now - lastYieldMs >= MIN_PAINT_YIELD_INTERVAL_MS) {
        lastYieldMs = now;
        await nextAnimationFrame();
      }
    },
    fail(message: string): void {
      if (label) label.textContent = message;
      root?.classList.add('is-error');
    },
    finish(): void {
      if (!root) return;
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
