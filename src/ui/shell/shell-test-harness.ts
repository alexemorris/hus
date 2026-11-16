import { vi } from 'vitest';
import {
  TERRAIN_SCULPT_DEFAULT_PATCH_ID,
  TERRAIN_SCULPT_DEFAULT_RADIUS_M,
  TERRAIN_SCULPT_DEFAULT_STRENGTH_M,
  type TerrainSculptSnapshot,
} from '../../core/geo/terrain-sculpt.ts';
import type {
  FloorViewMode,
  SceneAnnotationHit,
  SceneAnnotationRecord,
  TimeOfDay,
} from '../../core/types/scene.ts';
import type { RoomZoneId } from '../../core/types/topology.ts';
import type {
  TwinApi,
  TwinCustomDeviceControl,
  TwinFloorInfo,
  TwinRoomNavGroup,
  TwinWalkthroughState,
} from '../../core/types/twin-api.ts';
import type { RoomManifestEntry, TradeView } from '../../core/types/twin-ux.ts';
import type { RoomVariationGroupInfo } from '../../core/types/variations.ts';

export type FakeEventListener = (event: unknown) => void;

export class FakeEventTarget {
  public readonly listeners = new Map<string, Set<FakeEventListener>>();

  public addEventListener(
    type: string,
    fn: FakeEventListener,
    options?: boolean | { readonly signal?: AbortSignal }
  ): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
    if (options && typeof options === 'object' && options.signal) {
      if (options.signal.aborted) {
        set.delete(fn);
        return;
      }
      options.signal.addEventListener(
        'abort',
        () => {
          this.removeEventListener(type, fn);
        },
        { once: true }
      );
    }
  }

  public removeEventListener(type: string, fn: FakeEventListener): void {
    this.listeners.get(type)?.delete(fn);
  }

  public dispatch(type: string, event: Record<string, unknown> = {}): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) {
      fn.call(this, {
        type,
        currentTarget: this,
        target: this,
        preventDefault: () => {},
        stopPropagation: () => {},
        ...event,
      });
    }
  }

  public countListeners(): number {
    let total = 0;
    for (const set of this.listeners.values()) {
      total += set.size;
    }
    return total;
  }
}

export class FakeClassList {
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

export class FakeText {
  public readonly nodeType = 3;
  public parentNode: FakeElement | null = null;
  public data: string;

  public constructor(
    text: string,
    public readonly ownerDocument: FakeDocument
  ) {
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

export class FakeElement extends FakeEventTarget {
  public readonly nodeType = 1;
  public readonly tagName: string;
  public readonly style: Record<string, string> = {};
  public readonly attributes = new Map<string, string>();
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
  public clientWidth = 800;
  public clientHeight = 600;
  public width = 800;
  public height = 600;

  public constructor(tagName: string, doc: FakeDocument) {
    super();
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

  public get innerHTML(): string {
    return this.textContent;
  }

  public set innerHTML(val: string) {
    this.childNodes.length = 0;
    const tagMatches = [
      ...val.matchAll(/<([a-zA-Z0-9]+)([^>]*)>(.*?)<\/\1>|<([a-zA-Z0-9]+)([^>]*)\/>/gs),
    ];
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

  public getRootNode(): FakeDocument {
    return this.ownerDocument;
  }

  public getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight };
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
    if (name === 'title') this.title = v;
  }

  public getAttribute(name: string): string | null {
    if (name === 'id') return this.id || null;
    if (name === 'class') return this.className || null;
    if (name === 'title') return this.title || null;
    return this.attributes.get(name) ?? null;
  }

  public removeAttribute(name: string): void {
    this.attributes.delete(name);
    if (name === 'id') this.id = '';
    if (name === 'class') this.className = '';
    if (name === 'title') this.title = '';
  }

  public dispatchClick(): void {
    this.dispatch('click');
  }

  public dispatchChange(nextValue?: string): void {
    if (nextValue !== undefined) this.value = nextValue;
    this.dispatch('change');
  }

  public focus(): void {}
  public select(): void {}
  public blur(): void {}

  public querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
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

export class FakeCanvasElement extends FakeElement {
  public requestPointerLock: (() => Promise<void> | void) | undefined;

  public constructor(doc: FakeDocument) {
    super('canvas', doc);
  }

  public getContext(): null {
    return null;
  }
}

export class FakeDocument extends FakeEventTarget {
  public readonly body: FakeElement;
  public activeElement: FakeElement | null = null;
  public pointerLockElement: FakeElement | null = null;
  public exitPointerLock = vi.fn(() => {
    this.pointerLockElement = null;
  });
  public hidden = false;
  public title = '';
  public getElementByIdCalls: string[] = [];

  public constructor() {
    super();
    this.body = new FakeElement('body', this);
  }

  public createElement(tag: string): FakeElement {
    if (tag.toLowerCase() === 'canvas') {
      return new FakeCanvasElement(this);
    }
    return new FakeElement(tag, this);
  }

  public createElementNS(_ns: string, tag: string): FakeElement {
    return this.createElement(tag);
  }

  public createTextNode(text: string): FakeText {
    return new FakeText(text, this);
  }

  public getElementById(id: string): FakeElement | null {
    this.getElementByIdCalls.push(id);
    if (this.body.id === id) return this.body;
    return this.body.querySelector(`#${id}`);
  }
}

export class FakeWindow extends FakeEventTarget {
  public location: { search: string; href: string };
  public innerWidth: number;
  public innerHeight: number;
  public devicePixelRatio = 1;
  public navigator: Record<string, unknown> = {};
  public readonly visualViewport = new FakeEventTarget();
  public localStorage = {
    getItem: (): string | null => null,
    setItem: (): void => {},
    removeItem: (): void => {},
  };
  public readonly requestAnimationFrame: (cb: (now: number) => void) => number;
  public readonly cancelAnimationFrame: (id: number) => void;

  public constructor(options: {
    readonly search?: string;
    readonly href?: string;
    readonly innerWidth?: number;
    readonly innerHeight?: number;
    readonly requestAnimationFrame: (cb: (now: number) => void) => number;
    readonly cancelAnimationFrame: (id: number) => void;
  }) {
    super();
    this.location = {
      search: options.search ?? '',
      href: options.href ?? 'http://localhost/',
    };
    this.innerWidth = options.innerWidth ?? 1440;
    this.innerHeight = options.innerHeight ?? 900;
    this.requestAnimationFrame = options.requestAnimationFrame;
    this.cancelAnimationFrame = options.cancelAnimationFrame;
  }

  public setTimeout(
    handler: (...args: unknown[]) => void,
    timeout?: number,
    ...args: unknown[]
  ): ReturnType<typeof setTimeout> {
    return globalThis.setTimeout(handler, timeout, ...args);
  }

  public clearTimeout(id?: ReturnType<typeof setTimeout>): void {
    globalThis.clearTimeout(id);
  }

  public setInterval(
    handler: (...args: unknown[]) => void,
    timeout?: number,
    ...args: unknown[]
  ): ReturnType<typeof setInterval> {
    return globalThis.setInterval(handler, timeout, ...args);
  }

  public clearInterval(id?: ReturnType<typeof setInterval>): void {
    globalThis.clearInterval(id);
  }
}

export interface InstallFakeDomOptions {
  readonly search?: string;
  readonly href?: string;
  readonly innerWidth?: number;
  readonly innerHeight?: number;
}

export interface ResizeObserverStats {
  readonly observes: number;
  readonly disconnects: number;
}

export interface InstalledFakeDom {
  readonly document: FakeDocument;
  readonly window: FakeWindow;
  readonly visualViewport: FakeEventTarget;
  readonly pendingRafs: Map<number, ReturnType<typeof setTimeout>>;
  readonly resizeObserver: ResizeObserverStats;
  restore(): void;
}

const MANAGED_GLOBAL_KEYS = [
  'Document',
  'navigator',
  'document',
  'window',
  'HTMLElement',
  'HTMLCanvasElement',
  'ResizeObserver',
  'requestAnimationFrame',
  'cancelAnimationFrame',
] as const;

export function installFakeDom(options: InstallFakeDomOptions = {}): InstalledFakeDom {
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = new Map<string, { readonly existed: boolean; readonly value: unknown }>();
  for (const key of MANAGED_GLOBAL_KEYS) {
    saved.set(key, { existed: Object.prototype.hasOwnProperty.call(g, key), value: g[key] });
  }

  const doc = new FakeDocument();
  let nextRaf = 1;
  const pendingRafs = new Map<number, ReturnType<typeof setTimeout>>();

  const requestRaf = (cb: (now: number) => void): number => {
    const id = nextRaf++;
    const timer = globalThis.setTimeout(() => {
      pendingRafs.delete(id);
      cb(16);
    }, 0);
    pendingRafs.set(id, timer);
    return id;
  };

  const cancelRaf = (id: number): void => {
    const timer = pendingRafs.get(id);
    if (timer !== undefined) {
      globalThis.clearTimeout(timer);
      pendingRafs.delete(id);
    }
  };

  const win = new FakeWindow({
    search: options.search,
    href: options.href,
    innerWidth: options.innerWidth,
    innerHeight: options.innerHeight,
    requestAnimationFrame: requestRaf,
    cancelAnimationFrame: cancelRaf,
  });

  let resizeObserves = 0;
  let resizeDisconnects = 0;

  class FakeResizeObserver {
    public observe(): void {
      resizeObserves += 1;
    }
    public unobserve(): void {}
    public disconnect(): void {
      resizeDisconnects += 1;
    }
  }

  g.Document = FakeDocument;
  g.navigator = win.navigator;
  g.document = doc;
  g.window = win;
  g.HTMLElement = FakeElement;
  g.HTMLCanvasElement = FakeCanvasElement;
  g.ResizeObserver = FakeResizeObserver;
  g.requestAnimationFrame = requestRaf;
  g.cancelAnimationFrame = cancelRaf;

  const resizeObserver: ResizeObserverStats = {
    get observes() {
      return resizeObserves;
    },
    get disconnects() {
      return resizeDisconnects;
    },
  };

  return {
    document: doc,
    window: win,
    visualViewport: win.visualViewport,
    pendingRafs,
    resizeObserver,
    restore(): void {
      for (const timer of pendingRafs.values()) {
        globalThis.clearTimeout(timer);
      }
      pendingRafs.clear();
      for (const key of MANAGED_GLOBAL_KEYS) {
        const prev = saved.get(key);
        if (!prev) continue;
        if (prev.existed) {
          g[key] = prev.value;
        } else {
          delete g[key];
        }
      }
    },
  };
}

export async function flushMicrotasks(turns = 4): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
    await Promise.resolve();
  }
}

export interface FakeTwinApiOptions {
  readonly floors?: readonly TwinFloorInfo[];
  readonly floorViewMode?: FloorViewMode;
  readonly ceilingCutaway?: boolean;
  readonly propertyName?: string;
  readonly timeOfDay?: TimeOfDay;
  readonly ambientLux?: number;
  readonly customDevices?: readonly TwinCustomDeviceControl[];
  readonly rooms?: {
    readonly current?: RoomZoneId | null;
    readonly list?: readonly RoomManifestEntry[];
    readonly navTree?: readonly TwinRoomNavGroup[];
  };
  readonly trades?: {
    readonly initialView?: TradeView;
  };
  readonly walkthrough?: {
    readonly initialActive?: boolean;
  };
  readonly notes?: {
    readonly initialActive?: boolean;
    readonly initialToolMode?: 'pin' | 'move' | 'rotate' | 'measure';
    readonly initialRecords?: readonly SceneAnnotationRecord[];
  };
  readonly terrainSculpt?: false | Partial<TerrainSculptSnapshot>;
  readonly variations?: readonly RoomVariationGroupInfo[];
}

export interface FakeTwinApiHandle {
  readonly api: TwinApi;
  triggerPick(hit: SceneAnnotationHit): void;
  setActiveRoom(roomId: RoomZoneId | null): void;
}

const DEFAULT_CUSTOM_DEVICES: readonly TwinCustomDeviceControl[] = [
  {
    id: 'driveway-gates',
    label: 'Front gates',
    statusLabel: 'Closed',
    actionLabel: 'Open gates',
    active: false,
    icon: 'gate',
    showInWholeHouse: true,
  },
];

export function createFakeTwinApi(options: FakeTwinApiOptions = {}): FakeTwinApiHandle {
  const floorList: readonly TwinFloorInfo[] = options.floors ?? [
    { id: 'ground', label: 'Ground', elevationY: 0 },
  ];
  const floorViewMode: FloorViewMode = options.floorViewMode ?? 'all';
  const ceilingCutaway = options.ceilingCutaway ?? false;
  const propertyName = options.propertyName ?? 'Test House';
  const timeOfDay: TimeOfDay = options.timeOfDay ?? 'dusk';
  const ambientLux = options.ambientLux ?? 38;
  const customDevices = options.customDevices ?? DEFAULT_CUSTOM_DEVICES;

  let currentRoom: RoomZoneId | null = options.rooms?.current ?? null;
  const roomList: readonly RoomManifestEntry[] = options.rooms?.list ?? [];
  const roomNavTree: readonly TwinRoomNavGroup[] = options.rooms?.navTree ?? [];
  const roomSubs = new Set<(zoneId: RoomZoneId | null) => void>();

  let currentTrade: TradeView = options.trades?.initialView ?? 'owner';
  const tradeSubs = new Set<(view: TradeView) => void>();

  let walking = options.walkthrough?.initialActive ?? false;
  const walkSubs = new Set<(active: boolean) => void>();
  const walkStateSubs = new Set<(state: TwinWalkthroughState) => void>();
  const getWalkState = (): TwinWalkthroughState => ({
    active: walking,
    prompt: null,
    crouched: false,
    pointerLocked: false,
    fovDeg: 68,
  });
  const notifyWalk = (): void => {
    const st = getWalkState();
    for (const fn of walkSubs) fn(walking);
    for (const fn of walkStateSubs) fn(st);
  };

  let annotationActive = options.notes?.initialActive ?? false;
  let toolMode: 'pin' | 'move' | 'rotate' | 'measure' = options.notes?.initialToolMode ?? 'pin';
  let gizmoMode: 'translate' | 'rotate' = 'translate';
  let axisSnap = false;
  let records: SceneAnnotationRecord[] = [...(options.notes?.initialRecords ?? [])];
  let selectedId: number | null = null;
  const recordSubs = new Set<
    (recs: readonly SceneAnnotationRecord[], sel: number | null) => void
  >();
  const pickSubs = new Set<(hit: SceneAnnotationHit) => void>();
  const notifyRecords = (): void => {
    for (const sub of recordSubs) sub(records, selectedId);
  };

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
    ...(options.terrainSculpt && typeof options.terrainSculpt === 'object'
      ? options.terrainSculpt
      : {}),
  };

  let variationState: RoomVariationGroupInfo[] = options.variations ? [...options.variations] : [];
  const variationSubs = new Set<(groups: readonly RoomVariationGroupInfo[]) => void>();

  const terrainSculptApi: TwinApi['terrainSculpt'] =
    options.terrainSculpt === false
      ? undefined
      : {
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
        };

  const variationsApi: TwinApi['variations'] =
    options.variations === undefined
      ? undefined
      : {
          list: () => variationState,
          forRoom: (zoneId) => variationState.filter((g) => g.zoneId === zoneId),
          getActiveOptionId: (id) => variationState.find((g) => g.id === id)?.activeOptionId,
          getSelections: () =>
            Object.fromEntries(
              variationState
                .filter((g) => g.activeOptionId !== g.defaultOptionId)
                .map((g) => [g.id, g.activeOptionId])
            ),
          selectOption: (groupId, optionId) => {
            variationState = variationState.map((g) =>
              g.id === groupId ? { ...g, activeOptionId: optionId } : g
            );
            for (const fn of variationSubs) fn(variationState);
            return true;
          },
          applySelections: vi.fn(() => true),
          cycleOption: (groupId, delta = 1) => {
            const g = variationState.find((x) => x.id === groupId);
            if (!g) return undefined;
            const idx = g.options.findIndex((o) => o.id === g.activeOptionId);
            const next = g.options[(idx + delta + g.options.length) % g.options.length]!;
            variationState = variationState.map((x) =>
              x.id === groupId ? { ...x, activeOptionId: next.id } : x
            );
            for (const fn of variationSubs) fn(variationState);
            return next.id;
          },
          resetDefaults: () => {
            variationState = variationState.map((g) => ({
              ...g,
              activeOptionId: g.defaultOptionId,
            }));
            for (const fn of variationSubs) fn(variationState);
            return true;
          },
          onChanged: (fn) => {
            variationSubs.add(fn);
            return () => variationSubs.delete(fn);
          },
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
        floorViewMode,
        ceilingCutaway,
        isOrthographic: false,
      }),
      getViewState: () => ({
        cameraPosition: [10, 8, 12],
        target: [0, 1, 0],
        isOrthographic: false,
        orthoZoom: 1,
        floorViewMode,
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
      list: () => floorList,
      propertyName: () => propertyName,
      getMode: () => floorViewMode,
      setMode: vi.fn(),
      isCeilingCutaway: () => true,
      setCeilingCutaway: vi.fn(),
      toggleCeilingCutaway: () => ceilingCutaway,
    },
    rooms: {
      getCurrent: () => currentRoom,
      onChanged: (fn) => {
        roomSubs.add(fn);
        return () => roomSubs.delete(fn);
      },
      select: vi.fn((z: RoomZoneId) => {
        currentRoom = z;
        for (const fn of roomSubs) fn(z);
      }),
      highlight: vi.fn(),
      list: () => roomList,
      navTree: () => roomNavTree,
      getLevelScenes: () => [],
      isInterior: () => true,
      getManifest: (z) => roomList.find((r) => r.zoneId === z),
      getLabel: (z) => roomList.find((r) => r.zoneId === z)?.label ?? z,
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
      getTimeOfDay: () => timeOfDay,
      setTimeOfDay: vi.fn(),
      getAmbientLux: () => ambientLux,
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
      customDevices: () => customDevices,
      triggerCustomDevice: () => false,
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
        tier: 'high',
        fps: 60,
        p95Ms: 18.0,
        pixelRatio: 1,
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
      getView: () => currentTrade,
      setView: vi.fn((next: TradeView) => {
        currentTrade = next;
        for (const fn of tradeSubs) fn(currentTrade);
      }),
      onChanged: (fn) => {
        tradeSubs.add(fn);
        return () => tradeSubs.delete(fn);
      },
      exportServiceSchedule: () => '',
    },
    walkthrough: {
      isActive: () => walking,
      getState: getWalkState,
      onStateChanged: (fn) => {
        walkStateSubs.add(fn);
        return () => walkStateSubs.delete(fn);
      },
      interact: () => false,
      toggleCrouch: () => false,
      jump: vi.fn(),
      setTouchMove: vi.fn(),
      setTouchLook: vi.fn(),
      requestMouseLook: vi.fn(),
      enter: vi.fn(() => {
        walking = true;
        notifyWalk();
      }),
      exit: vi.fn(() => {
        walking = false;
        notifyWalk();
      }),
      toggle: () => {
        walking = !walking;
        notifyWalk();
        return walking;
      },
      spawns: () => [],
      teleport: () => false,
      onChanged: (fn) => {
        walkSubs.add(fn);
        return () => walkSubs.delete(fn);
      },
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
      getLodDiagnostics: () => ({
        policyMode: 'auto',
        focusedZoneId: currentRoom ?? '',
        focusedZoneTier: currentRoom ? 2 : 0,
        tierCounts: { 0: 0, 1: 0, 2: currentRoom ? 1 : 0 },
        rooms: [],
      }),
      getLodPolicyMode: () => 'auto',
      setLodPolicyMode: vi.fn(),
      getFocusedRoomShortName: () =>
        currentRoom ? (roomList.find((r) => r.zoneId === currentRoom)?.label ?? currentRoom) : '',
      isMotionBlurEnabled: () => false,
      toggleMotionBlur: () => false,
    },
    ...(terrainSculptApi ? { terrainSculpt: terrainSculptApi } : {}),
    ...(variationsApi ? { variations: variationsApi } : {}),
  };

  return {
    api,
    triggerPick: (hit) => {
      for (const fn of pickSubs) fn(hit);
    },
    setActiveRoom: (roomId) => {
      currentRoom = roomId;
      for (const fn of roomSubs) fn(roomId);
    },
  };
}
