import { render } from 'preact';
import { describe, expect, it, vi } from 'vitest';
import type { RoomVariationGroupInfo } from '../../core/types/variations.ts';
import type { TwinApi } from '../../core/types/twin-api.ts';
import { mountHusShell } from './mount-shell.tsx';

class MiniClassList {
  private readonly set = new Set<string>();
  public constructor(private readonly el: MiniEl) {}
  public add(...t: string[]): void { for (const x of t) if (x) this.set.add(x); this.sync(); }
  public remove(...t: string[]): void { for (const x of t) this.set.delete(x); this.sync(); }
  public toggle(t: string, f?: boolean): boolean {
    const n = f ?? !this.set.has(t);
    if (n) this.set.add(t); else this.set.delete(t);
    this.sync();
    return n;
  }
  public contains(t: string): boolean { return this.set.has(t); }
  public syncFrom(cls: string): void {
    this.set.clear();
    for (const p of cls.split(/\s+/)) if (p) this.set.add(p);
  }
  private sync(): void { this.el._cls = [...this.set].join(' '); }
}

class MiniText {
  public readonly nodeType = 3;
  public parentNode: MiniEl | null = null;
  public constructor(public data: string) {}
  public get nodeValue(): string { return this.data; }
  public set nodeValue(v: string) { this.data = String(v ?? ''); }
  public get textContent(): string { return this.data; }
  public set textContent(v: string) { this.data = String(v ?? ''); }
  public get nextSibling(): MiniEl | MiniText | null {
    if (!this.parentNode) return null;
    const i = this.parentNode.childNodes.indexOf(this);
    return i >= 0 ? (this.parentNode.childNodes[i + 1] ?? null) : null;
  }
  public remove(): void { this.parentNode?.removeChild(this); }
}

class MiniEl {
  public readonly nodeType = 1;
  public readonly tagName: string;
  public readonly style: Record<string, string> = {};
  public readonly attributes = new Map<string, string>();
  public readonly listeners = new Map<string, Set<(e: unknown) => void>>();
  public readonly childNodes: Array<MiniEl | MiniText> = [];
  public parentNode: MiniEl | null = null;
  public _cls = '';
  public readonly classList: MiniClassList;
  public id = '';
  public value = '';
  public disabled = false;

  public constructor(tag: string, public readonly ownerDocument: MiniDoc) {
    this.tagName = tag.toUpperCase();
    this.classList = new MiniClassList(this);
  }
  public get className(): string { return this._cls; }
  public set className(v: string) { this._cls = String(v ?? ''); this.classList.syncFrom(this._cls); }
  public get children(): MiniEl[] { return this.childNodes.filter((n): n is MiniEl => n.nodeType === 1); }
  public get firstChild(): MiniEl | MiniText | null { return this.childNodes[0] ?? null; }
  public get nextSibling(): MiniEl | MiniText | null {
    if (!this.parentNode) return null;
    const i = this.parentNode.childNodes.indexOf(this);
    return i >= 0 ? (this.parentNode.childNodes[i + 1] ?? null) : null;
  }
  public get textContent(): string { return this.childNodes.map((c) => c.textContent).join(''); }
  public set textContent(v: string) {
    this.childNodes.length = 0;
    if (v) { const t = new MiniText(String(v)); t.parentNode = this; this.childNodes.push(t); }
  }
  public appendChild<T extends MiniEl | MiniText>(c: T): T { return this.insertBefore(c, null); }
  public insertBefore<T extends MiniEl | MiniText>(c: T, ref: MiniEl | MiniText | null): T {
    c.parentNode?.removeChild(c);
    c.parentNode = this;
    if (ref) {
      const i = this.childNodes.indexOf(ref);
      if (i >= 0) { this.childNodes.splice(i, 0, c); return c; }
    }
    this.childNodes.push(c);
    return c;
  }
  public remove(): void { this.parentNode?.removeChild(this); }
  public removeChild<T extends MiniEl | MiniText>(c: T): T {
    const i = this.childNodes.indexOf(c);
    if (i >= 0) { this.childNodes.splice(i, 1); c.parentNode = null; }
    return c;
  }
  public setAttribute(k: string, v: string): void {
    this.attributes.set(k, String(v));
    if (k === 'class') this.className = String(v);
    if (k === 'id') this.id = String(v);
  }
  public getAttribute(k: string): string | null { return this.attributes.get(k) ?? null; }
  public removeAttribute(k: string): void { this.attributes.delete(k); }
  public addEventListener(t: string, fn: (e: unknown) => void): void {
    if (!this.listeners.has(t)) this.listeners.set(t, new Set());
    this.listeners.get(t)!.add(fn);
  }
  public removeEventListener(t: string, fn: (e: unknown) => void): void {
    this.listeners.get(t)?.delete(fn);
  }
  public dispatchClick(): void {
    const ev = { type: 'click', currentTarget: this, target: this, stopPropagation: () => {}, preventDefault: () => {} };
    for (const fn of [...(this.listeners.get('click') ?? [])]) fn.call(this, ev);
  }
  public querySelector(sel: string): MiniEl | null { return this.querySelectorAll(sel)[0] ?? null; }
  public querySelectorAll(sel: string): MiniEl[] {
    const out: MiniEl[] = [];
    const match = (el: MiniEl): boolean => sel.startsWith('.') ? el.classList.contains(sel.slice(1)) : el.tagName === sel.toUpperCase();
    const walk = (el: MiniEl): void => {
      for (const ch of el.children) { if (match(ch)) out.push(ch); walk(ch); }
    };
    walk(this);
    return out;
  }
}

class MiniDoc {
  public readonly body = new MiniEl('body', this);
  public createElement(t: string): MiniEl { return new MiniEl(t, this); }
  public createElementNS(_ns: string, t: string): MiniEl { return new MiniEl(t, this); }
  public createTextNode(t: string): MiniText { return new MiniText(t); }
  public addEventListener(): void {}
  public removeEventListener(): void {}
}

function makeBaseApi(groups: RoomVariationGroupInfo[]): {
  api: TwinApi;
  setActiveRoom(roomId: string | null): void;
} {
  let currentRoom: string | null = 'gallery';
  const roomSubs = new Set<(z: string | null) => void>();
  const varSubs = new Set<(g: readonly RoomVariationGroupInfo[]) => void>();
  let state = [...groups];

  const api: TwinApi = {
    camera: {
      flyToPreset: vi.fn(),
      flyToCameraPose: vi.fn(),
      flyToRoom: vi.fn(),
      flyToBounds: vi.fn(),
      recenter: vi.fn(),
      getPose: () => ({ position: [0, 2, 5], target: [0, 1, 0], floorViewMode: 'first', ceilingCutaway: true, isOrthographic: false }),
      getViewState: () => ({ cameraPosition: [0, 2, 5], target: [0, 1, 0], isOrthographic: false, orthoZoom: 1, floorViewMode: 'first' }),
      onViewChanged: () => () => {},
      getCompassBearingDeg: () => 90,
      onCompassBearingChanged: () => () => {},
      onSurfaceDoubleClick: () => () => {},
      projectToScreen: () => ({ x: 100, y: 100, visible: true }),
      setSingleFingerPan: vi.fn(),
      isSingleFingerPan: () => false,
    },
    floors: {
      list: () => [{ id: 'ground', label: 'Ground', elevationY: 0 }, { id: 'first', label: 'First', elevationY: 2.8 }],
      propertyName: () => 'Test House',
      getMode: () => 'first',
      setMode: vi.fn(),
      isCeilingCutaway: () => true,
      setCeilingCutaway: vi.fn(),
      toggleCeilingCutaway: () => true,
    },
    rooms: {
      getCurrent: () => currentRoom,
      onChanged: (fn) => { roomSubs.add(fn); return () => roomSubs.delete(fn); },
      select: (z) => { currentRoom = z; for (const fn of roomSubs) fn(z); },
      highlight: vi.fn(),
      list: () => [{ zoneId: 'gallery', label: 'Gallery', group: 'house-first', floor: 'first', lights: [], scenes: [], devices: [] }],
      navTree: () => [{ id: 'house-first', label: 'First Floor', rooms: [{ zoneId: 'gallery', label: 'Gallery', group: 'house-first', floor: 'first', lights: [], scenes: [], devices: [] }] }],
      getLevelScenes: () => [],
      isInterior: () => true,
      getManifest: (z) => z === 'gallery' ? { zoneId: 'gallery', label: 'Gallery', group: 'house-first', floor: 'first', lights: [], scenes: [], devices: [] } : undefined,
      getLabel: (z) => z === 'gallery' ? 'Gallery' : z,
      getBounds: () => null,
      findAt: () => null,
    },
    lighting: {
      zones: { source: () => 'derived', list: () => [], get: () => undefined, getState: () => ({ mode: 'off', sceneIndex: null }), recallScene: vi.fn(), setFull: vi.fn(), setNight: vi.fn(), setOff: vi.fn(), onStateChanged: () => () => {}, presenceDetectors: () => [], switches: () => [] },
      circuits: () => [],
      isKnownCircuit: (_id): _id is never => false,
      getLiveLevels: () => ({} as never),
      getTargetLevels: () => ({} as never),
      toggleCircuit: vi.fn(),
      setCircuitLevel: vi.fn(),
      applyLevels: vi.fn(),
      allOff: vi.fn(),
      recallScene: vi.fn(),
      scenes: () => [],
      getActiveSceneIndex: () => 0,
      subscribe: () => () => {},
      onLevelsChanged: () => () => {},
      getTimeOfDay: () => 'day',
      setTimeOfDay: vi.fn(),
      getAmbientLux: () => 50,
      setAmbientLux: vi.fn(),
      roomMotionSensors: () => [],
      toggleRoomMotion: () => false,
      isRoomNightDimActive: () => false,
      pressZoneSwitch: vi.fn(),
      getTransport: () => ({ mode: 'simulation' as const, status: 'connected' as const }),
    },
    devices: {
      handleInteractable: () => false, onChanged: () => () => {}, isGatesOpen: () => false, isGatesMoving: () => false,
      getGatesStatusLabel: () => 'Closed', toggleGates: () => false, isBifoldsOpen: () => false, toggleBifolds: () => false,
      isTvArtMode: () => false, getTvArtTitle: () => '', cycleTvArt: vi.fn(), isCourtyardLightOn: () => false,
      getCourtyardModeLabel: () => 'Off', pressCourtyardSwitch: vi.fn(), hasUfh: () => false, ufhZones: () => [],
      ufhZoneForRoom: () => undefined, toggleUfhZone: () => false, setAllUfhZones: vi.fn(), isUfhLayerVisible: () => false,
      setUfhLayerVisible: vi.fn(), toggleUfhLayer: () => false,
    },
    graphics: {
      getMode: () => 'auto', setMode: vi.fn(),
      getStats: () => ({ mode: 'auto', tier: 'high', fps: 60, frameMs: 16, p95Ms: 18, pixelRatio: 1, shadows: true, bloom: true, ssao: true, fxaa: true, motionBlur: false }),
      onToast: () => () => {}, isSsaoEnabled: () => true, setSsaoEnabled: vi.fn(), isFxaaEnabled: () => true, setFxaaEnabled: vi.fn(), isMotionBlurEnabled: () => false, setMotionBlurEnabled: vi.fn(),
    },
    audio: {
      isMuted: () => true, setMuted: vi.fn(), toggleMuted: () => true, getVolume: () => 0.5, setVolume: vi.fn(),
      isAmbientEnabled: () => false, setAmbientEnabled: vi.fn(), isSfxEnabled: () => true, setSfxEnabled: vi.fn(), onChanged: () => () => {},
    },
    trades: { getView: () => 'owner', setView: vi.fn(), onChanged: () => () => {}, exportServiceSchedule: () => '' },
    walkthrough: {
      isActive: () => false, getState: () => ({ active: false, prompt: null, crouched: false, pointerLocked: false, fovDeg: 68 }),
      onStateChanged: () => () => {}, interact: () => false, toggleCrouch: () => false, jump: vi.fn(), setTouchMove: vi.fn(), setTouchLook: vi.fn(), requestMouseLook: vi.fn(),
      enter: vi.fn(), exit: vi.fn(), toggle: () => false, spawns: () => [], teleport: () => false, onChanged: () => () => {}, onFootPositionChanged: () => () => {},
    },
    notes: {
      isActive: () => false, setActive: vi.fn(), toggleActive: () => false, getToolMode: () => 'pin', setToolMode: vi.fn(),
      getGizmoMode: () => 'translate', setGizmoMode: vi.fn(), getMeasureAxisSnap: () => false, setMeasureAxisSnap: vi.fn(),
      cancelMeasurement: vi.fn(), onPick: () => () => {}, onMarkerSelect: () => () => {}, onMeasurePreview: () => () => {}, onMeasureComplete: () => () => {},
      onObjectTransform: () => () => {}, syncMarkers: vi.fn(), reapplyMoves: vi.fn(), detachGizmo: vi.fn(), switchMoveCandidate: vi.fn(),
      selectMovedObject: () => false, nudgeSelected: vi.fn(), setSelectedDelta: vi.fn(), resetMovedObject: () => false,
      getRecords: () => [], getSelectedId: () => null, getSelectedRecord: () => null, subscribe: (fn) => { fn([], null); return () => {}; },
      select: vi.fn(), add: vi.fn(), addMeasure: vi.fn(), upsertMove: vi.fn(), updateTargetMeasurement: vi.fn(), updateNote: vi.fn(), remove: vi.fn(), clearAll: vi.fn(), formatForAgent: () => '',
    },
    dev: {
      getLodDiagnostics: () => ({ policyMode: 'auto', focusedZoneId: 'gallery', focusedZoneTier: 2, tierCounts: { 0: 0, 1: 0, 2: 1 }, rooms: [] }),
      getLodPolicyMode: () => 'auto', setLodPolicyMode: vi.fn(), getFocusedRoomShortName: () => 'Gallery', isMotionBlurEnabled: () => false, toggleMotionBlur: () => false,
    },
    variations: {
      list: () => state,
      forRoom: (z) => state.filter((g) => g.zoneId === z),
      getActiveOptionId: (id) => state.find((g) => g.id === id)?.activeOptionId,
      getSelections: () => Object.fromEntries(state.filter((g) => g.activeOptionId !== g.defaultOptionId).map((g) => [g.id, g.activeOptionId])),
      selectOption: (groupId, optionId) => {
        state = state.map((g) => (g.id === groupId ? { ...g, activeOptionId: optionId } : g));
        for (const fn of varSubs) fn(state);
        return true;
      },
      applySelections: vi.fn(() => true),
      cycleOption: (groupId, delta = 1) => {
        const g = state.find((x) => x.id === groupId);
        if (!g) return undefined;
        const idx = g.options.findIndex((o) => o.id === g.activeOptionId);
        const next = g.options[(idx + delta + g.options.length) % g.options.length]!;
        state = state.map((x) => (x.id === groupId ? { ...x, activeOptionId: next.id } : x));
        for (const fn of varSubs) fn(state);
        return next.id;
      },
      resetDefaults: () => {
        state = state.map((g) => ({ ...g, activeOptionId: g.defaultOptionId }));
        for (const fn of varSubs) fn(state);
        return true;
      },
      onChanged: (fn) => { varSubs.add(fn); return () => varSubs.delete(fn); },
    },
  };

  return {
    api,
    setActiveRoom: (r) => { currentRoom = r; for (const fn of roomSubs) fn(r); },
  };
}

describe('Viewer Variations UI (<TopBarVariationsButton />, <VariationsPopover />, <RoomVariationsSection />)', () => {
  it('renders nothing when house has 0 variations, and renders TopBar button, popover & inline RoomPanel pills when variations > 0', async () => {
    const prevDoc = globalThis.document;
    const prevWin = globalThis.window;
    const prevEl = globalThis.HTMLElement;
    const doc = new MiniDoc();
    const win = {
      location: { search: '', href: 'http://localhost/' },
      innerWidth: 1440,
      innerHeight: 900,
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      addEventListener: () => {},
      removeEventListener: () => {},
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      requestAnimationFrame: (cb: () => void) => setTimeout(cb, 0),
    };

    try {
      (globalThis as unknown as Record<string, unknown>).document = doc;
      (globalThis as unknown as Record<string, unknown>).window = win;
      (globalThis as unknown as Record<string, unknown>).HTMLElement = MiniEl;

      // Case 1: 0 variations -> renders zero variation controls anywhere
      const rootEmpty = doc.createElement('div');
      doc.body.appendChild(rootEmpty);
      const { api: emptyApi } = makeBaseApi([]);
      mountHusShell({ api: emptyApi, bindKeyboard: false }, rootEmpty as unknown as HTMLElement);
      expect(rootEmpty.querySelector('.shell-var-topbar-btn')).toBeNull();
      expect(rootEmpty.querySelector('.shell-card-variations')).toBeNull();
      expect(rootEmpty.querySelector('.shell-nav-var')).toBeNull();
      render(null, rootEmpty as unknown as HTMLElement);

      // Case 2: 1 variation group linked to 'gallery'
      const rootWithVars = doc.createElement('div');
      doc.body.appendChild(rootWithVars);
      const { api: varApi } = makeBaseApi([
        {
          id: 'gallery-east-wall',
          label: 'Gallery — East Wall',
          zoneId: 'gallery',
          defaultOptionId: 'shelves',
          activeOptionId: 'shelves',
          options: [
            { id: 'shelves', label: 'Open Shelves', description: 'Floating oak shelves' },
            { id: 'cupboards', label: 'Full Cupboards', description: 'Flush panelled cupboards' },
          ],
        },
      ]);
      mountHusShell({ api: varApi, bindKeyboard: false }, rootWithVars as unknown as HTMLElement);

      // TopBar variations button, RoomNavigator badge, and inline RoomPanel card all render
      const topBtn = rootWithVars.querySelector('.shell-var-topbar-btn');
      expect(topBtn).not.toBeNull();
      expect(rootWithVars.querySelector('.shell-nav-var')).not.toBeNull();
      const inlineCard = rootWithVars.querySelector('.shell-card-variations');
      expect(inlineCard).not.toBeNull();
      expect(inlineCard?.textContent).toContain('Open Shelves');
      expect(inlineCard?.textContent).toContain('Full Cupboards');

      // Clicking "Full Cupboards" pill updates active variation option
      const pills = inlineCard?.querySelectorAll('.shell-var-pill') ?? [];
      expect(pills).toHaveLength(2);
      pills[1]!.dispatchClick();
      await new Promise((r) => setTimeout(r, 0));
      expect(varApi.variations?.getActiveOptionId('gallery-east-wall')).toBe('cupboards');
      expect(topBtn?.textContent).toContain('Full Cupboards');

      // Clicking TopBar button opens popover
      topBtn!.dispatchClick();
      await new Promise((r) => setTimeout(r, 0));
      expect(rootWithVars.querySelector('.shell-var-popover')).not.toBeNull();

      render(null, rootWithVars as unknown as HTMLElement);
    } finally {
      (globalThis as unknown as Record<string, unknown>).document = prevDoc;
      (globalThis as unknown as Record<string, unknown>).window = prevWin;
      (globalThis as unknown as Record<string, unknown>).HTMLElement = prevEl;
    }
  });
});
