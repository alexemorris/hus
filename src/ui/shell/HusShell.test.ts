import { render } from 'preact';
import { describe, expect, it, vi } from 'vitest';
import {
  LOADING_DISSOLVE_MS,
  STARTUP_PHASE_RANGES,
  StartupProgressMeter,
  createFrameBudgetYielder,
  getLoadingScreen,
} from './loading.ts';
import { mountHusShell } from './mount-shell.tsx';
import { createFakeTwinApi, flushMicrotasks, installFakeDom } from './shell-test-harness.ts';

describe('Self-contained <HusShell /> & dynamic loading screen (zero index.html boilerplate)', () => {
  it('mounts <HusShell />, Preact AnnotatorPanel, 60 Hz pins overlay, and TerrainSculptPanel cleanly into a bare <div> with zero pre-existing #annotator-panel or #hud-panel DOM', async () => {
    vi.useFakeTimers();
    const dom = installFakeDom();

    try {
      const bareDiv = dom.document.createElement('div');
      dom.document.body.appendChild(bareDiv);

      // Verify dynamic loading screen works on bareDiv without #loading-screen in index.html
      const loading = getLoadingScreen(
        bareDiv as unknown as HTMLElement,
        'Case Study House #22 (Stahl House)'
      );
      const loadingScreenEl = bareDiv.querySelector('.loading-screen');
      expect(loadingScreenEl).not.toBeNull();
      expect(bareDiv.querySelector('.loading-title')?.textContent).toBe(
        'Case Study House #22 (Stahl House)'
      );

      loading.fail('Test status');
      expect(bareDiv.querySelector('.loading-label')?.textContent).toBe('Test status');
      expect(loadingScreenEl?.classList.contains('is-error')).toBe(true);

      loading.finish();
      expect(loadingScreenEl?.classList.contains('is-done')).toBe(true);
      await vi.advanceTimersByTimeAsync(LOADING_DISSOLVE_MS);
      expect(bareDiv.querySelector('.loading-screen')).toBeNull();

      // Mount HusShell into a fresh bare shell root with ZERO #annotator-panel or #hud-panel
      const shellRoot = dom.document.createElement('div');
      bareDiv.appendChild(shellRoot);
      dom.document.getElementByIdCalls = [];

      const { api, triggerPick } = createFakeTwinApi();
      const ctl = mountHusShell(
        { api, bindKeyboard: false },
        shellRoot as unknown as HTMLElement
      );

      // Zero lookups for legacy #annotator-panel or #hud-panel
      expect(dom.document.getElementByIdCalls).not.toContain('annotator-panel');
      expect(dom.document.getElementByIdCalls).not.toContain('hud-panel');

      // Preact AnnotatorPanel, PinsOverlay, TerrainSculptPanel, and ToolDock are rendered inside shellRoot
      expect(shellRoot.querySelector('.annotator-panel')).not.toBeNull();
      expect(shellRoot.querySelector('.annotator-pins-overlay')).not.toBeNull();
      expect(shellRoot.querySelector('.terrain-sculpt-panel')).not.toBeNull();
      expect(shellRoot.textContent).toContain('Sculpt');

      // Activating Note tool & picking a 3D surface opens AnnotatorPanel and renders a 60 Hz screen pin
      ctl.setTool('note');
      await flushMicrotasks();
      expect(shellRoot.querySelector('.annotator-panel')?.classList.contains('is-open')).toBe(
        true
      );

      triggerPick({
        worldPoint: [2.5, 1.1, -3.2],
        worldNormal: [0, 1, 0],
        roomZoneId: 'kitchen',
        roomName: 'Kitchen',
        meshInfo: {
          meshName: 'island.counter',
          materialSummary: 'MeshStandardMaterial',
          geometrySummary: 'BoxGeometry',
          parentChain: ['scene', 'kitchen', 'island.counter'],
          meshWorldCenter: [2.5, 1.1, -3.2],
          meshBoundingBoxMin: [1.5, 0.65, -3.7],
          meshBoundingBoxMax: [3.5, 1.55, -2.7],
          meshBoundingBoxSize: [2, 0.9, 1],
        },
        cameraPose: api.camera.getPose(),
      });

      await flushMicrotasks();
      const pinEl = shellRoot.querySelector('.annotator-screen-pin');
      expect(pinEl).not.toBeNull();
      expect(pinEl?.textContent).toBe('#1');
      expect(shellRoot.textContent).toContain('PIN #1 · KITCHEN');

      // Switching to Terrain Sculpt tool opens TerrainSculptPanel and deactivates Annotator
      ctl.setTool('sculpt');
      await flushMicrotasks();
      expect(
        shellRoot.querySelector('.terrain-sculpt-panel')?.classList.contains('is-open')
      ).toBe(true);

      ctl.dispose();
      render(null, shellRoot as unknown as HTMLElement);
      await flushMicrotasks();
    } finally {
      vi.advanceTimersByTime(50);
      dom.restore();
      vi.useRealTimers();
    }
  });

  it('renders decluttered TopBar without redundant Exit walk button, moves View as & Help into SettingsModal, and supports ? shortcut', async () => {
    // Warm lazy overlay chunks before enabling fake timers so dynamic import() resolves via microtasks
    await Promise.all([import('./SettingsModal.tsx'), import('./HelpOverlay.tsx')]);

    vi.useFakeTimers();
    const dom = installFakeDom();

    try {
      const shellRoot = dom.document.createElement('div');
      dom.document.body.appendChild(shellRoot);

      const { api } = createFakeTwinApi();
      const ctl = mountHusShell(
        { api, bindKeyboard: true },
        shellRoot as unknown as HTMLElement
      );

      const topbar = shellRoot.querySelector('.shell-topbar');
      expect(topbar).not.toBeNull();

      // Default Owner mode renders zero View-as select and zero role pill in TopBar
      expect(topbar?.querySelector('select')).toBeNull();
      expect(topbar?.querySelector('.shell-role-pill')).toBeNull();

      // Help button is absent from TopBar; Share action and single drawer toggle are present
      const topbarBtns = topbar?.querySelectorAll('button') ?? [];
      expect(topbarBtns.find((b) => b.getAttribute('aria-label') === 'Help')).toBeUndefined();
      const shareBtn = topbarBtns.find((b) => b.getAttribute('aria-label') === 'Share view');
      expect(shareBtn).toBeDefined();

      const drawerToggles = shellRoot.querySelectorAll('button').filter(
        (b) => b.getAttribute('aria-label') === 'Toggle room controls'
      );
      expect(drawerToggles).toHaveLength(1);

      // Compact icon-only lighting pills have accessible aria-labels and zero visible text clutter
      const todBtns = topbar?.querySelectorAll('.shell-topbar-tod .shell-seg-btn') ?? [];
      expect(todBtns).toHaveLength(3);
      expect(todBtns.map((b) => b.getAttribute('aria-label'))).toEqual(['Day', 'Dusk', 'Night']);
      expect(todBtns.map((b) => b.textContent)).toEqual(['', '', '']);

      // Entering Walk mode adds zero redundant Exit walk button to TopBar, and clicking active Walk segment exits back to 3D
      const walkSegBtn = topbarBtns.find((b) => b.textContent === 'Walk');
      expect(walkSegBtn).toBeDefined();
      walkSegBtn!.dispatchClick();
      await flushMicrotasks();
      expect(ctl.isWalking()).toBe(true);
      expect(topbar?.textContent).not.toContain('Exit walk');

      // Clicking Walk while active exits back to 3D
      walkSegBtn!.dispatchClick();
      await flushMicrotasks();
      expect(ctl.isWalking()).toBe(false);

      // Opening SettingsModal exposes View as role selector and Help guide action
      const settingsBtn = topbarBtns.find((b) => b.getAttribute('aria-label') === 'Settings');
      expect(settingsBtn).toBeDefined();
      settingsBtn!.dispatchClick();
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(50);
      await flushMicrotasks();

      const modal = shellRoot.querySelector('.shell-modal');
      expect(modal).not.toBeNull();
      const viewAsSelect = modal?.querySelector('select');
      expect(viewAsSelect).not.toBeNull();
      expect(viewAsSelect?.getAttribute('aria-label')).toBe('View as');

      // Selecting Architect updates role and renders compact interactive role pill in TopBar
      viewAsSelect!.dispatchChange('architect');
      await flushMicrotasks();
      const rolePill = topbar?.querySelector('.shell-role-pill');
      expect(rolePill).not.toBeNull();
      expect(rolePill?.textContent).toContain('Architect');

      // Clicking Help guide inside Settings closes Settings and opens HelpOverlay
      const helpGuideBtn = modal?.querySelectorAll('button').find((b) => b.textContent.includes('Help guide'));
      expect(helpGuideBtn).toBeDefined();
      helpGuideBtn!.dispatchClick();
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(50);
      await flushMicrotasks();
      expect(shellRoot.querySelector('.shell-help-backdrop')).not.toBeNull();

      // Close HelpOverlay via Escape, then verify ? shortcut still opens HelpOverlay
      dom.window.dispatch('keydown', {
        key: 'Escape',
        code: 'Escape',
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        repeat: false,
      });
      await flushMicrotasks();
      expect(shellRoot.querySelector('.shell-help-backdrop')).toBeNull();

      dom.window.dispatch('keydown', {
        key: '?',
        code: 'Slash',
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        repeat: false,
      });
      await flushMicrotasks();
      expect(shellRoot.querySelector('.shell-help-backdrop')).not.toBeNull();

      // Clicking TopBar role pill resets trade view back to Owner and removes the pill
      rolePill!.dispatchClick();
      await flushMicrotasks();
      expect(api.trades.getView()).toBe('owner');
      expect(topbar?.querySelector('.shell-role-pill')).toBeNull();

      ctl.dispose();
      render(null, shellRoot as unknown as HTMLElement);
      await flushMicrotasks();
    } finally {
      vi.advanceTimersByTime(50);
      dom.restore();
      vi.useRealTimers();
    }
  });
});

describe('StartupProgressMeter & frame-budget yielder', () => {
  it('maps weighted phases monotonically across 0..100% and yields on >=16ms frame intervals', async () => {
    const prevRaf = globalThis.requestAnimationFrame;
    const prevPerf = globalThis.performance;
    let fakeNow = 1000;
    let rafCalls = 0;
    (globalThis as unknown as { performance: { now: () => number } }).performance = {
      now: () => fakeNow,
    };
    (globalThis as unknown as { requestAnimationFrame: (cb: FrameRequestCallback) => number }).requestAnimationFrame =
      (cb) => {
        rafCalls += 1;
        fakeNow += 4;
        cb(fakeNow);
        return rafCalls;
      };
    try {
      const recorded: Array<{ label: string; fraction: number }> = [];
      let lastYieldMs = -Infinity;
      const loading = {
        async setProgress(label: string, fraction: number): Promise<void> {
          recorded.push({ label, fraction });
          if (fakeNow - lastYieldMs >= 16) {
            await new Promise<void>((res) => globalThis.requestAnimationFrame(() => res()));
            lastYieldMs = fakeNow;
          }
        },
        fail(): void {},
        finish(): void {},
      };
      const meter = new StartupProgressMeter(loading);

      expect(STARTUP_PHASE_RANGES.preflight).toEqual({ start: 0, end: 0.06 });
      expect(STARTUP_PHASE_RANGES.zones).toEqual({ start: 0.06, end: 0.48 });
      expect(STARTUP_PHASE_RANGES.batching).toEqual({ start: 0.48, end: 0.66 });
      expect(STARTUP_PHASE_RANGES.textures).toEqual({ start: 0.66, end: 0.8 });
      expect(STARTUP_PHASE_RANGES.compile).toEqual({ start: 0.8, end: 0.96 });
      expect(STARTUP_PHASE_RANGES.firstFrame).toEqual({ start: 0.96, end: 1 });

      const fractions: number[] = [];
      for (const [phase, step] of [
        ['preflight', 0.5],
        ['zones', 0.25],
        ['zones', 0.1],
        ['zones', 0.75],
        ['batching', 0.5],
        ['textures', 0.5],
        ['compile', 0.5],
        ['firstFrame', 1.0],
      ] as const) {
        fakeNow += 18;
        await meter.advancePhase(phase, step, `Stage ${phase}`);
        fractions.push(meter.getFraction());
      }

      for (let i = 1; i < fractions.length; i++) {
        expect(fractions[i]!).toBeGreaterThanOrEqual(fractions[i - 1]!);
      }
      expect(fractions[fractions.length - 1]).toBe(1);
      expect(rafCalls).toBeGreaterThanOrEqual(7);

      const yielder = createFrameBudgetYielder(14);
      expect(await yielder.yieldIfNeeded()).toBe(false);
      fakeNow += 17;
      expect(await yielder.yieldIfNeeded()).toBe(true);
      expect(yielder.getYieldCount()).toBe(1);
    } finally {
      (globalThis as unknown as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame = prevRaf;
      (globalThis as unknown as { performance: Performance }).performance = prevPerf;
    }
  });
});

describe('beforeinstallprompt handling', () => {
  it('does not register a beforeinstallprompt preventDefault() listener in shell-store', async () => {
    const registeredTypes: string[] = [];
    const prevWindow = (globalThis as { window?: unknown }).window;
    const prevNavigator = (globalThis as { navigator?: unknown }).navigator;
    const fakeWindow = new EventTarget() as unknown as Window & typeof globalThis;
    (fakeWindow as unknown as { navigator: { standalone: boolean } }).navigator = { standalone: false };
    const origAdd = fakeWindow.addEventListener.bind(fakeWindow);
    fakeWindow.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions) => {
      registeredTypes.push(type);
      return origAdd(type, listener, opts);
    }) as typeof fakeWindow.addEventListener;
    (globalThis as { window?: unknown }).window = fakeWindow;
    (globalThis as { navigator?: unknown }).navigator = { standalone: false };
    try {
      vi.resetModules();
      await import('../../state/shell-store.ts');
      expect(registeredTypes).not.toContain('beforeinstallprompt');
      const ev = new Event('beforeinstallprompt', { cancelable: true });
      fakeWindow.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false);
    } finally {
      (globalThis as { window?: unknown }).window = prevWindow;
      (globalThis as { navigator?: unknown }).navigator = prevNavigator;
    }
  });
});
