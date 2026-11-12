import { render } from 'preact';
import { describe, expect, it, vi } from 'vitest';
import type { SceneAnnotationHit, SceneAnnotationRecord } from '../../core/types/scene.ts';
import type { TwinApi } from '../../core/types/twin-api.ts';
import {
  TERRAIN_SCULPT_DEFAULT_PATCH_ID,
  TERRAIN_SCULPT_DEFAULT_RADIUS_M,
  TERRAIN_SCULPT_DEFAULT_STRENGTH_M,
  type TerrainSculptSnapshot,
} from '../../core/geo/terrain-sculpt.ts';
import { getLoadingScreen, HUS_RIBBON_MARK_SVG } from './loading.ts';
import { mountHusShell } from './mount-shell.tsx';

class FakeClassList {
  private readonly set = new Set<string>();
  public constructor(private readonly owner: FakeElement) {}
  public add(...tokens: string[]): void {
    for (const t of tokens) if (t) this.set.add(t);
    this.sync();
  }
  public remove(...tokens: string[]): void {
    for (const t of tokens) this.set.delete(t);
    this.sync();
  }
  public toggle(token: string, force?: boolean): boolean {
    const next = force ?? !this.set.has(token);
    if (next) this.set.add(token);
    else this.set.delete(token);
    this.sync();
    return next;
  }
  public contains(token: string): boolean {
    return this.set.has(token);
  }
  public syncFromClassName(cls: string): void {
    this.set.clear();
    for (const part of cls.split(/\s+/)) {
      if (part) this.set.add(part);
    }
  }
  private sync(): void {
    this.owner._rawClassName = [...this.set].join(' ');
  }
}

class FakeElement {
  public readonly nodeType = 1;
  public readonly tagName: string;
  public readonly style: Record<string, string> = {};
  public readonly attributes = new Map<string, string>();
  public readonly listeners = new Map<string, Set<(e: unknown) => void>>();
  public readonly childNodes: Array<FakeElement | FakeText> = [];
  public parentNode: FakeElement | null = null;
  public ownerDocument: FakeDocument;
  public id = '';
  public _rawClassName = '';
  public readonly classList: FakeClassList;
  public hidden = false;
  public value = '';
  public checked = false;
  public disabled = false;
  public type = '';
  public title = '';

  public constructor(tagName: string, doc: FakeDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = doc;
    this.classList = new FakeClassList(this);
  }

  public get className(): string {
    return this._rawClassName;
  }

  public set className(val: string) {
    this._rawClassName = String(val ?? '');
    this.classList.syncFromClassName(this._rawClassName);
  }

  public get children(): FakeElement[] {
    return this.childNodes.filter((n): n is FakeElement => n.nodeType === 1);
  }

  public get firstChild(): FakeElement | FakeText | null {
    return this.childNodes[0] ?? null;
  }

  public get nextSibling(): FakeElement | FakeText | null {
    if (!this.parentNode) return null;
    const idx = this.parentNode.childNodes.indexOf(this);
    return idx >= 0 ? (this.parentNode.childNodes[idx + 1] ?? null) : null;
  }

  public get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join('');
  }

  public set textContent(val: string) {
    this.childNodes.length = 0;
    if (val) {
      const t = new FakeText(String(val), this.ownerDocument);
      t.parentNode = this;
      this.childNodes.push(t);
    }
  }

  public appendChild<T extends FakeElement | FakeText>(child: T): T {
    return this.insertBefore(child, null);
  }

  public append(...nodes: Array<FakeElement | FakeText>): void {
    for (const n of nodes) this.appendChild(n);
  }

  public insertBefore<T extends FakeElement | FakeText>(
    child: T,
    ref: FakeElement | FakeText | null
  ): T {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    if (ref) {
      const idx = this.childNodes.indexOf(ref);
      if (idx >= 0) {
        this.childNodes.splice(idx, 0, child);
        return child;
      }
    }
    this.childNodes.push(child);
    return child;
  }

  public removeChild<T extends FakeElement | FakeText>(child: T): T {
    const idx = this.childNodes.indexOf(child);
    if (idx >= 0) {
      this.childNodes.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  public remove(): void {
    this.parentNode?.removeChild(this);
  }

  public setAttribute(name: string, value: string): void {
    const v = String(value);
    this.attributes.set(name, v);
    if (name === 'id') this.id = v;
    if (name === 'class') this.className = v;
  }

  public getAttribute(name: string): string | null {
    if (name === 'id') return this.id || null;
    if (name === 'class') return this.className || null;
    return this.attributes.get(name) ?? null;
  }

  public removeAttribute(name: string): void {
    this.attributes.delete(name);
    if (name === 'id') this.id = '';
    if (name === 'class') this.className = '';
  }

  public addEventListener(type: string, fn: (e: unknown) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
  }

  public removeEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners.get(type)?.delete(fn);
  }

  public dispatchClick(): void {
    const ev = {
      type: 'click',
      currentTarget: this,
      target: this,
      stopPropagation: () => {},
      preventDefault: () => {},
    };
    for (const fn of this.listeners.get('click') ?? []) {
      fn(ev);
    }
  }

  public focus(): void {}
  public select(): void {}
  public blur(): void {}

  public querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  public get innerHTML(): string {
    return this.textContent;
  }

  public set innerHTML(val: string) {
    this.childNodes.length = 0;
    // Simple parser for basic SVG/HTML fragments created in UI helpers
    const tagMatches = [...val.matchAll(/<([a-zA-Z0-9]+)([^>]*)>(.*?)<\/\1>|<([a-zA-Z0-9]+)([^>]*)\/>/gs)];
    if (tagMatches.length === 0) {
      if (val) this.textContent = val;
      return;
    }
    for (const match of tagMatches) {
      const tagName = match[1] || match[4];
      const el = new FakeElement(tagName, this.ownerDocument);
      const inner = match[3];
      if (inner) {
        el.innerHTML = inner;
      }
      this.appendChild(el);
    }
  }

  public querySelectorAll(selector: string): FakeElement[] {
    if (selector.includes(' ')) {
      const parts = selector.split(/\s+/).filter(Boolean);
      let current: FakeElement[] = [this];
      for (const part of parts) {
        const next: FakeElement[] = [];
        for (const item of current) {
          next.push(...item.querySelectorAll(part));
        }
        current = next;
      }
      return current;
    }
    const out: FakeElement[] = [];
    const matches = (el: FakeElement): boolean => {
      if (selector.startsWith('#')) return el.id === selector.slice(1);
      if (selector.startsWith('.')) return el.classList.contains(selector.slice(1));
      return el.tagName === selector.toUpperCase();
    };
    const visit = (el: FakeElement): void => {
      for (const child of el.children) {
        if (matches(child)) out.push(child);
        visit(child);
      }
    };
    visit(this);
    return out;
  }
}

class FakeText {
  public readonly nodeType = 3;
  public parentNode: FakeElement | null = null;
  public data: string;
  public constructor(text: string, public readonly ownerDocument: FakeDocument) {
    this.data = text;
  }
  public get nodeValue(): string {
    return this.data;
  }
  public set nodeValue(v: string) {
    this.data = String(v ?? '');
  }
  public get textContent(): string {
    return this.data;
  }
  public set textContent(v: string) {
    this.data = String(v ?? '');
  }
  public get nextSibling(): FakeElement | FakeText | null {
    if (!this.parentNode) return null;
    const idx = this.parentNode.childNodes.indexOf(this);
    return idx >= 0 ? (this.parentNode.childNodes[idx + 1] ?? null) : null;
  }
  public remove(): void {
    this.parentNode?.removeChild(this);
  }
}

class FakeDocument {
  public readonly body: FakeElement;
  public activeElement: FakeElement | null = null;
  public hidden = false;
  public getElementByIdCalls: string[] = [];

  public constructor() {
    this.body = new FakeElement('body', this);
  }

  public createElement(tag: string): FakeElement {
    return new FakeElement(tag, this);
  }

  public createElementNS(_ns: string, tag: string): FakeElement {
    return new FakeElement(tag, this);
  }

  public createTextNode(text: string): FakeText {
    return new FakeText(text, this);
  }

  public getElementById(id: string): FakeElement | null {
    this.getElementByIdCalls.push(id);
    if (this.body.id === id) return this.body;
    return this.body.querySelector(`#${id}`);
  }

  public addEventListener(): void {}
  public removeEventListener(): void {}
}

function createFakeTwinApi(): {
  api: TwinApi;
  triggerPick(hit: SceneAnnotationHit): void;
} {
  let annotationActive = false;
  let toolMode: 'pin' | 'move' | 'rotate' | 'measure' = 'pin';
  let gizmoMode: 'translate' | 'rotate' = 'translate';
  let axisSnap = false;
  let records: SceneAnnotationRecord[] = [];
  let selectedId: number | null = null;
  const recordSubs = new Set<
    (recs: readonly SceneAnnotationRecord[], sel: number | null) => void
  >();
  const pickSubs = new Set<(hit: SceneAnnotationHit) => void>();
  const sculptSubs = new Set<(snap: TerrainSculptSnapshot) => void>();

  let sculptSnap: TerrainSculptSnapshot = {
    active: false,
    mode: 'raise',
    radiusM: TERRAIN_SCULPT_DEFAULT_RADIUS_M,
    strength: TERRAIN_SCULPT_DEFAULT_STRENGTH_M,
    strokeCount: 0,
    stampCount: 0,
    canUndo: false,
    patchId: TERRAIN_SCULPT_DEFAULT_PATCH_ID,
  };

  const notifyRecords = (): void => {
    for (const sub of recordSubs) sub(records, selectedId);
  };

  const api: TwinApi = {
    camera: {
      flyToPreset: vi.fn(),
      flyToCameraPose: vi.fn(),
      flyToRoom: vi.fn(),
      flyToBounds: vi.fn(),
      recenter: vi.fn(),
      getPose: () => ({
        position: [10, 8, 12],
        target: [0, 1, 0],
        floorViewMode: 'all',
        ceilingCutaway: false,
        isOrthographic: false,
      }),
      getViewState: () => ({
        cameraPosition: [10, 8, 12],
        target: [0, 1, 0],
        isOrthographic: false,
        orthoZoom: 1,
        floorViewMode: 'all',
      }),
      onViewChanged: () => () => {},
      getCompassBearingDeg: () => 90,
      onCompassBearingChanged: () => () => {},
      onSurfaceDoubleClick: () => () => {},
      projectToScreen: () => ({ x: 240, y: 180, visible: true }),
      setSingleFingerPan: vi.fn(),
      isSingleFingerPan: () => false,
    },
    floors: {
      list: () => [{ id: 'ground', label: 'Ground', elevationY: 0 }],
      propertyName: () => 'Test House',
      getMode: () => 'all',
      setMode: vi.fn(),
      isCeilingCutaway: () => true,
      setCeilingCutaway: vi.fn(),
      toggleCeilingCutaway: () => false,
    },
    rooms: {
      getCurrent: () => null,
      onChanged: () => () => {},
      select: vi.fn(),
      highlight: vi.fn(),
      list: () => [],
      navTree: () => [],
      getLevelScenes: () => [],
      isInterior: () => true,
      getManifest: () => undefined,
      getLabel: (z) => z,
      getBounds: () => null,
      findAt: () => null,
    },
    lighting: {
      zones: {
        source: () => 'derived',
        list: () => [],
        get: () => undefined,
        getState: () => ({ mode: 'off', sceneIndex: null }),
        recallScene: vi.fn(),
        setFull: vi.fn(),
        setNight: vi.fn(),
        setOff: vi.fn(),
        onStateChanged: () => () => {},
        presenceDetectors: () => [],
        switches: () => [],
      },
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
      getTimeOfDay: () => 'dusk',
      setTimeOfDay: vi.fn(),
      getAmbientLux: () => 38,
      setAmbientLux: vi.fn(),
      roomMotionSensors: () => [],
      toggleRoomMotion: () => false,
      isRoomNightDimActive: () => false,
      pressZoneSwitch: vi.fn(),
      getTransport: () => ({ mode: 'simulation' as const, status: 'connected' as const }),
    },
    devices: {
      handleInteractable: () => false,
      onChanged: () => () => {},
      isGatesOpen: () => false,
      isGatesMoving: () => false,
      getGatesStatusLabel: () => 'Closed',
      toggleGates: () => false,
      isBifoldsOpen: () => false,
      toggleBifolds: () => false,
      isTvArtMode: () => false,
      getTvArtTitle: () => '',
      cycleTvArt: vi.fn(),
      isCourtyardLightOn: () => false,
      getCourtyardModeLabel: () => 'Off',
      pressCourtyardSwitch: vi.fn(),
      hasUfh: () => false,
      ufhZones: () => [],
      ufhZoneForRoom: () => undefined,
      toggleUfhZone: () => false,
      setAllUfhZones: vi.fn(),
      isUfhLayerVisible: () => false,
      setUfhLayerVisible: vi.fn(),
      toggleUfhLayer: () => false,
    },
    graphics: {
      getMode: () => 'auto',
      setMode: vi.fn(),
      getStats: () => ({
        mode: 'auto',
        tier: 'high',
        fps: 60,
        frameMs: 16.6,
        p95Ms: 18.0,
        pixelRatio: 1,
        shadows: true,
        bloom: true,
        ssao: true,
        fxaa: true,
        motionBlur: false,
      }),
      onToast: () => () => {},
      isSsaoEnabled: () => true,
      setSsaoEnabled: vi.fn(),
      isFxaaEnabled: () => true,
      setFxaaEnabled: vi.fn(),
      isMotionBlurEnabled: () => false,
      setMotionBlurEnabled: vi.fn(),
    },
    audio: {
      isMuted: () => true,
      setMuted: vi.fn(),
      toggleMuted: () => true,
      getVolume: () => 0.5,
      setVolume: vi.fn(),
      isAmbientEnabled: () => false,
      setAmbientEnabled: vi.fn(),
      isSfxEnabled: () => true,
      setSfxEnabled: vi.fn(),
      onChanged: () => () => {},
    },
    trades: {
      getView: () => 'owner',
      setView: vi.fn(),
      onChanged: () => () => {},
      exportServiceSchedule: () => '',
    },
    walkthrough: {
      isActive: () => false,
      getState: () => ({
        active: false,
        prompt: null,
        crouched: false,
        pointerLocked: false,
        fovDeg: 68,
      }),
      onStateChanged: () => () => {},
      interact: () => false,
      toggleCrouch: () => false,
      jump: vi.fn(),
      setTouchMove: vi.fn(),
      setTouchLook: vi.fn(),
      requestMouseLook: vi.fn(),
      enter: vi.fn(),
      exit: vi.fn(),
      toggle: () => false,
      spawns: () => [],
      teleport: () => false,
      onChanged: () => () => {},
      onFootPositionChanged: () => () => {},
    },
    notes: {
      isActive: () => annotationActive,
      setActive: (v) => {
        annotationActive = v;
      },
      toggleActive: () => {
        annotationActive = !annotationActive;
        return annotationActive;
      },
      getToolMode: () => toolMode,
      setToolMode: (t) => {
        toolMode = t;
      },
      getGizmoMode: () => gizmoMode,
      setGizmoMode: (m) => {
        gizmoMode = m;
      },
      getMeasureAxisSnap: () => axisSnap,
      setMeasureAxisSnap: (v) => {
        axisSnap = v;
      },
      cancelMeasurement: vi.fn(),
      onPick: (fn) => {
        pickSubs.add(fn);
        return () => pickSubs.delete(fn);
      },
      onMarkerSelect: () => () => {},
      onMeasurePreview: () => () => {},
      onMeasureComplete: () => () => {},
      onObjectTransform: () => () => {},
      syncMarkers: vi.fn(),
      reapplyMoves: vi.fn(),
      detachGizmo: vi.fn(),
      switchMoveCandidate: vi.fn(),
      selectMovedObject: () => false,
      nudgeSelected: vi.fn(),
      setSelectedDelta: vi.fn(),
      resetMovedObject: () => false,
      getRecords: () => records,
      getSelectedId: () => selectedId,
      getSelectedRecord: () => records.find((r) => r.id === selectedId) ?? null,
      subscribe: (fn) => {
        recordSubs.add(fn);
        fn(records, selectedId);
        return () => recordSubs.delete(fn);
      },
      select: (id) => {
        selectedId = id;
        notifyRecords();
      },
      add: (hit, note = '') => {
        const rec: SceneAnnotationRecord = {
          id: records.length + 1,
          createdAt: '2026-06-21T12:00:00Z',
          kind: 'pin',
          note,
          worldPoint: hit.worldPoint,
          worldNormal: hit.worldNormal,
          roomZoneId: hit.roomZoneId ?? 'exterior',
          roomName: hit.roomName,
          meshInfo: hit.meshInfo,
          cameraPose: hit.cameraPose,
        };
        records = [...records, rec];
        selectedId = rec.id;
        notifyRecords();
        return rec;
      },
      addMeasure: vi.fn(),
      upsertMove: vi.fn(),
      updateTargetMeasurement: vi.fn(),
      updateNote: (id, note) => {
        records = records.map((r) => (r.id === id ? { ...r, note } : r));
        notifyRecords();
      },
      remove: (id) => {
        records = records.filter((r) => r.id !== id);
        if (selectedId === id) selectedId = null;
        notifyRecords();
      },
      clearAll: () => {
        records = [];
        selectedId = null;
        notifyRecords();
      },
      formatForAgent: () => '# Exported Notes\n',
    },
    dev: {
      getLodDiagnostics: () => ({ policyMode: 'auto', activeRoomId: null, rooms: [] } as unknown as ReturnType<TwinApi['dev']['getLodDiagnostics']>),
      getLodPolicyMode: () => 'auto',
      setLodPolicyMode: vi.fn(),
      getFocusedRoomShortName: () => '',
      isMotionBlurEnabled: () => false,
      toggleMotionBlur: () => false,
    },
    terrainSculpt: {
      isAvailable: () => true,
      getSnapshot: () => sculptSnap,
      onChanged: (fn) => {
        sculptSubs.add(fn);
        return () => sculptSubs.delete(fn);
      },
      isActive: () => sculptSnap.active,
      setActive: (active) => {
        sculptSnap = { ...sculptSnap, active };
        for (const fn of sculptSubs) fn(sculptSnap);
        return sculptSnap.active;
      },
      toggleActive: () => {
        sculptSnap = { ...sculptSnap, active: !sculptSnap.active };
        for (const fn of sculptSubs) fn(sculptSnap);
        return sculptSnap.active;
      },
      getMode: () => sculptSnap.mode,
      setMode: (mode) => {
        sculptSnap = { ...sculptSnap, mode };
        for (const fn of sculptSubs) fn(sculptSnap);
      },
      getRadiusM: () => sculptSnap.radiusM,
      setRadiusM: (radiusM) => {
        sculptSnap = { ...sculptSnap, radiusM };
        for (const fn of sculptSubs) fn(sculptSnap);
        return radiusM;
      },
      getStrength: () => sculptSnap.strength,
      setStrength: (strength) => {
        sculptSnap = { ...sculptSnap, strength };
        for (const fn of sculptSubs) fn(sculptSnap);
        return strength;
      },
      getPatchId: () => sculptSnap.patchId,
      setPatchId: (patchId) => {
        sculptSnap = { ...sculptSnap, patchId };
        for (const fn of sculptSubs) fn(sculptSnap);
      },
      undo: () => false,
      reset: () => false,
      getStamps: () => [],
      formatModifierJson: () => '{"kind":"sculptStamps","id":"site-sculpt-patch","stamps":[]}',
      formatModifierTs: () => "sculptStamps({ id: 'site-sculpt-patch', stamps: [] })",
    },
  };

  return {
    api,
    triggerPick: (hit) => {
      for (const fn of pickSubs) fn(hit);
    },
  };
}

describe('Self-contained <HusShell /> & dynamic loading screen (zero index.html boilerplate)', () => {
  it('mounts <HusShell />, Preact AnnotatorPanel, 60 Hz pins overlay, and TerrainSculptPanel cleanly into a bare <div> with zero pre-existing #annotator-panel or #hud-panel DOM', async () => {
    const prevDoc = globalThis.document;
    const prevWin = globalThis.window;
    const prevEl = globalThis.HTMLElement;

    const fakeDoc = new FakeDocument();
    const bareDiv = fakeDoc.createElement('div');
    fakeDoc.body.appendChild(bareDiv);

    const fakeWin = {
      location: { search: '', href: 'http://localhost/' },
      innerWidth: 1440,
      innerHeight: 900,
      localStorage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      },
      addEventListener: () => {},
      removeEventListener: () => {},
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      requestAnimationFrame: (cb: () => void) => setTimeout(cb, 0),
    };

    try {
      (globalThis as unknown as Record<string, unknown>).document = fakeDoc;
      (globalThis as unknown as Record<string, unknown>).window = fakeWin;
      (globalThis as unknown as Record<string, unknown>).HTMLElement = FakeElement;

      // Verify dynamic loading screen works on bareDiv without #loading-screen in index.html
      const loading = getLoadingScreen(
        bareDiv as unknown as HTMLElement,
        'Case Study House #22 — Stahl House'
      );
      const loadingScreenEl = bareDiv.querySelector('.loading-screen');
      expect(loadingScreenEl).not.toBeNull();
      expect(bareDiv.querySelector('.loading-card')).not.toBeNull();
      expect(bareDiv.querySelector('.loading-mark svg')).not.toBeNull();
      expect(HUS_RIBBON_MARK_SVG).toContain('viewBox="0 0 64 64"');
      expect(HUS_RIBBON_MARK_SVG).toContain('stop-color="#F25A2E"');
      expect(bareDiv.querySelector('.loading-title')?.textContent).toBe(
        'Case Study House #22 — Stahl House'
      );
      // Verify .loading-label is rendered before .loading-bar in .loading-card
      const cardChildren = bareDiv.querySelector('.loading-card')?.children ?? [];
      const labelIndex = cardChildren.findIndex((c) => c.className.includes('loading-label'));
      const barIndex = cardChildren.findIndex((c) => c.className.includes('loading-bar'));
      expect(labelIndex).toBeGreaterThanOrEqual(0);
      expect(barIndex).toBeGreaterThan(labelIndex);

      loading.fail('Test status');
      expect(bareDiv.querySelector('.loading-label')?.textContent).toBe('Test status');
      expect(loadingScreenEl?.classList.contains('is-error')).toBe(true);

      loading.finish();
      expect(loadingScreenEl?.classList.contains('is-done')).toBe(true);
      // Advance timer for remove
      await new Promise((r) => setTimeout(r, 360));
      expect(bareDiv.querySelector('.loading-screen')).toBeNull();

      // Mount HusShell into a fresh bare shell root with ZERO #annotator-panel or #hud-panel
      const shellRoot = fakeDoc.createElement('div');
      bareDiv.appendChild(shellRoot);
      fakeDoc.getElementByIdCalls = [];

      const { api, triggerPick } = createFakeTwinApi();
      const ctl = mountHusShell(
        { api, bindKeyboard: false },
        shellRoot as unknown as HTMLElement
      );

      // Zero lookups for legacy #annotator-panel or #hud-panel
      expect(fakeDoc.getElementByIdCalls).not.toContain('annotator-panel');
      expect(fakeDoc.getElementByIdCalls).not.toContain('hud-panel');

      // Preact AnnotatorPanel, PinsOverlay, TerrainSculptPanel, and ToolDock are rendered inside shellRoot
      expect(shellRoot.querySelector('.shell-brand .shell-brand-mark')).not.toBeNull();
      expect(shellRoot.querySelector('.annotator-panel')).not.toBeNull();
      expect(shellRoot.querySelector('.annotator-pins-overlay')).not.toBeNull();
      expect(shellRoot.querySelector('.terrain-sculpt-panel')).not.toBeNull();
      expect(shellRoot.textContent).toContain('Sculpt');

      // Activating Note tool & picking a 3D surface opens AnnotatorPanel and renders a 60 Hz screen pin
      ctl.setTool('note');
      await new Promise((r) => setTimeout(r, 0));
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

      await new Promise((r) => setTimeout(r, 0));
      const pinEl = shellRoot.querySelector('.annotator-screen-pin');
      expect(pinEl).not.toBeNull();
      expect(pinEl?.textContent).toBe('#1');
      expect(shellRoot.textContent).toContain('PIN #1 · KITCHEN');

      // Switching to Terrain Sculpt tool opens TerrainSculptPanel and deactivates Annotator
      ctl.setTool('sculpt');
      await new Promise((r) => setTimeout(r, 0));
      expect(
        shellRoot.querySelector('.terrain-sculpt-panel')?.classList.contains('is-open')
      ).toBe(true);

      render(null, shellRoot as unknown as HTMLElement);
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      (globalThis as unknown as Record<string, unknown>).document = prevDoc;
      (globalThis as unknown as Record<string, unknown>).window = prevWin;
      (globalThis as unknown as Record<string, unknown>).HTMLElement = prevEl;
    }
  });
});
