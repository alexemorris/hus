import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  CircuitBus,
  defineHouse,
  gradePad,
  normalizeSoundscapeDescriptor,
  wireTwoWay,
  type RoomManifestEntry,
} from 'husjs';
import {
  AudioEngine,
  SoundscapeController,
  attachAudioEmitter,
  computeAcousticOcclusion,
  computeSabineRt60,
  type AcousticPortalState,
  type FloorSurfaceType,
} from 'husjs/audio';
import { Frame2D } from 'husjs/objects';

describe('husjs public API (defineHouse, CircuitBus, Frame2D, acoustics)', () => {
  it('defines a 1-floor house with zero-config location, modifiable terrain, soundscape, and 2-way mains wiring', () => {
    const livingEntry: RoomManifestEntry = {
      zoneId: 'living',
      label: 'Living Pavilion',
      group: 'house-ground',
      floor: 'ground',
      lights: [],
      scenes: [],
      devices: [],
    };

    const floorSurface: FloorSurfaceType = 'stone';

    const house = defineHouse({
      id: 'stahl-case-study-22',
      name: 'Stahl House (Case Study House #22)',
      location: { lat: 34.1003, lon: -118.3698, label: 'Hollywood Hills · Los Angeles' },
      floors: [{ id: 'ground', label: 'Main Level', elevationY: 0, ceilingHeight: 2.75 }],
      terrain: {
        base: 'flat',
        flatElevationY: -4.0,
        modifiers: [gradePad({ minX: -12, maxX: 12, minZ: -8, maxZ: 8, elevationY: 0, featherM: 3 })],
      },
      soundscape: 'hills-city',
      rooms: {
        manifest: [livingEntry],
        navTree: [{ id: 'main', label: 'Pavilion', rooms: [livingEntry] }],
      },
      zones: {
        modules: [],
        lodRegistrations: [
          {
            zoneId: 'living',
            shortName: 'Living',
            floorId: 'ground',
            isInterior: true,
            floorSurface,
            volumeM3: 110,
            primarySurface: 'glass',
            bounds: { minX: -8, maxX: 8, minY: 0, maxY: 2.8, minZ: -5, maxZ: 5 },
          },
        ],
        circuitMaxIntensity: { livingSoffit: 6.5 },
      },
      electrical: {
        circuits: [
          {
            id: 'livingSoffit',
            name: 'Living Soffit',
            zoneId: 'living',
            wiring: wireTwoWay('swEntry', 'swHall'),
          },
        ],
        switches: [
          { id: 'swEntry', initialPose: 'up' },
          { id: 'swHall', initialPose: 'up' },
        ],
      },
    });

    expect(house.floors).toHaveLength(1);
    expect(house.terrainSampler.sampleTerrainY(0, 0)).toBeCloseTo(0, 5);
    expect(house.terrainSampler.sampleTerrainY(30, 30)).toBeCloseTo(-4.0, 5);
    expect(normalizeSoundscapeDescriptor(house.soundscape)?.preset).toBe('hills-city');

    const profile = house.createSceneProfile();
    expect(profile.name).toBe('Stahl House (Case Study House #22)');
    expect(profile.location?.lat).toBeCloseTo(34.1003, 5);
    expect(profile.soundscape).toBe('hills-city');

    const bus = new CircuitBus(house.electrical);
    const initial = bus.getCircuitBrightness('livingSoffit');
    bus.flipSwitch('swEntry');
    expect(bus.getCircuitBrightness('livingSoffit')).toBe(initial > 0 ? 0 : 1);
    bus.flipSwitch('swHall');
    expect(bus.getCircuitBrightness('livingSoffit')).toBe(initial);

    const frame = Frame2D.fromOriginAndAngle(2, 3, Math.PI / 2);
    const [wx, wz] = frame.toWorldXZ(1, 0);
    expect(wx).toBeCloseTo(2, 6);
    expect(wz).toBeCloseTo(2, 6);

    const speaker = new THREE.Group();
    const emitter = attachAudioEmitter(speaker, { kind: 'continuous', preset: 'waterFeature' });
    expect(emitter.isActive()).toBe(true);
    emitter.dispose();

    const portal: AcousticPortalState = {
      id: 'sliding-wall',
      position: [0, 1.4, 5],
      areaM2: 12,
      openness: 0.75,
    };
    const rt60 = computeSabineRt60({ volumeM3: 110, primarySurface: 'glass', openPortalAreaM2: 0 });
    const occlusion = computeAcousticOcclusion({
      listenerPos: [0, 1.5, 2],
      isInterior: true,
      room: { volumeM3: 110, primarySurface: 'glass' },
      exteriorPortals: [portal],
    });
    expect(occlusion.reverbDecaySec).toBeLessThan(rt60);
    expect(occlusion.effectiveOpenness).toBeGreaterThan(0.5);

    const engine = new AudioEngine();
    const controller = new SoundscapeController(engine);
    controller.setSoundscape('hills-city');
    expect(controller.getSoundscape().preset).toBe('hills-city');
    controller.dispose();
    engine.dispose();
  });
});

import { vi } from 'vitest';
import '../state/shell-store.ts';
import { mountHouse } from 'husjs';
import { CameraRig, PropertyScene, WalkthroughController } from 'husjs/viewer';

type ListenerFn = (ev: unknown) => void;

class LifecycleEventTarget {
  public readonly listeners = new Map<string, Set<ListenerFn>>();

  public addEventListener(
    type: string,
    fn: ListenerFn,
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

  public removeEventListener(type: string, fn: ListenerFn): void {
    this.listeners.get(type)?.delete(fn);
  }

  public dispatch(type: string, event: Record<string, unknown> = {}): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) {
      fn({
        type,
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

class FakeTextNode {
  public readonly nodeType = 3;
  public parentNode: FakeDomElement | null = null;
  public data: string;
  public constructor(text: string, public readonly ownerDocument: FakeDomDocument) {
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
  public get nextSibling(): FakeDomElement | FakeTextNode | null {
    if (!this.parentNode) return null;
    const idx = this.parentNode.childNodes.indexOf(this);
    return idx >= 0 ? (this.parentNode.childNodes[idx + 1] ?? null) : null;
  }
  public remove(): void {
    this.parentNode?.removeChild(this);
  }
}

class FakeDomClassList {
  private readonly tokens = new Set<string>();
  public add(...items: string[]): void {
    for (const t of items) if (t) this.tokens.add(t);
  }
  public remove(...items: string[]): void {
    for (const t of items) this.tokens.delete(t);
  }
  public toggle(token: string, force?: boolean): boolean {
    const next = force ?? !this.tokens.has(token);
    if (next) this.tokens.add(token);
    else this.tokens.delete(token);
    return next;
  }
  public contains(token: string): boolean {
    return this.tokens.has(token);
  }
}

class FakeDomElement extends LifecycleEventTarget {
  public readonly nodeType = 1;
  public readonly tagName: string;
  public readonly style: Record<string, string> = {};
  public readonly attributes = new Map<string, string>();
  public readonly childNodes: Array<FakeDomElement | FakeTextNode> = [];
  public readonly classList = new FakeDomClassList();
  public parentNode: FakeDomElement | null = null;
  public ownerDocument: FakeDomDocument;
  public id = '';
  public className = '';
  public clientWidth = 800;
  public clientHeight = 600;
  public width = 800;
  public height = 600;

  public constructor(tagName: string, doc: FakeDomDocument) {
    super();
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = doc;
  }

  public get children(): FakeDomElement[] {
    return this.childNodes.filter((n): n is FakeDomElement => n.nodeType === 1);
  }

  public get firstChild(): FakeDomElement | FakeTextNode | null {
    return this.childNodes[0] ?? null;
  }

  public get nextSibling(): FakeDomElement | FakeTextNode | null {
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
      const t = new FakeTextNode(String(val), this.ownerDocument);
      t.parentNode = this;
      this.childNodes.push(t);
    }
  }

  public set innerHTML(val: string) {
    this.textContent = val;
  }

  public get innerHTML(): string {
    return this.textContent;
  }

  public getRootNode(): FakeDomDocument {
    return this.ownerDocument;
  }

  public getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight };
  }

  public appendChild<T extends FakeDomElement | FakeTextNode>(child: T): T {
    return this.insertBefore(child, null);
  }

  public append(...nodes: Array<FakeDomElement | FakeTextNode>): void {
    for (const n of nodes) this.appendChild(n);
  }

  public insertBefore<T extends FakeDomElement | FakeTextNode>(
    child: T,
    ref: FakeDomElement | FakeTextNode | null
  ): T {
    if (child.parentNode) child.parentNode.removeChild(child);
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

  public removeChild<T extends FakeDomElement | FakeTextNode>(child: T): T {
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
    this.attributes.set(name, String(value));
    if (name === 'id') this.id = String(value);
    if (name === 'class') this.className = String(value);
  }

  public getAttribute(name: string): string | null {
    if (name === 'id') return this.id || null;
    if (name === 'class') return this.className || null;
    return this.attributes.get(name) ?? null;
  }

  public removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  public querySelector(selector: string): FakeDomElement | null {
    const matches = (el: FakeDomElement): boolean => {
      if (selector.startsWith('#')) return el.id === selector.slice(1);
      if (selector.startsWith('.')) {
        const cls = selector.slice(1);
        return el.className.split(/\s+/).includes(cls) || el.classList.contains(cls);
      }
      return el.tagName === selector.toUpperCase();
    };
    const visit = (root: FakeDomElement): FakeDomElement | null => {
      for (const child of root.children) {
        if (matches(child)) return child;
        const found = visit(child);
        if (found) return found;
      }
      return null;
    };
    return visit(this);
  }
}

class FakeCanvasElement extends FakeDomElement {
  public requestPointerLock: (() => Promise<void> | void) | undefined;
  public getContext(): null {
    return null;
  }
  public constructor(doc: FakeDomDocument) {
    super('canvas', doc);
  }
}

class FakeDomDocument extends LifecycleEventTarget {
  public readonly body: FakeDomElement;
  public activeElement: FakeDomElement | null = null;
  public pointerLockElement: FakeDomElement | null = null;
  public exitPointerLock = vi.fn(() => {
    this.pointerLockElement = null;
  });
  public hidden = false;
  public title = '';

  public constructor() {
    super();
    this.body = new FakeDomElement('body', this);
  }

  public createElement(tag: string): FakeDomElement {
    if (tag.toLowerCase() === 'canvas') {
      return new FakeCanvasElement(this);
    }
    return new FakeDomElement(tag, this);
  }

  public createElementNS(_ns: string, tag: string): FakeDomElement {
    return this.createElement(tag);
  }

  public createTextNode(text: string): FakeTextNode {
    return new FakeTextNode(text, this);
  }

  public getElementById(id: string): FakeDomElement | null {
    if (this.body.id === id) return this.body;
    return this.body.querySelector(`#${id}`);
  }
}

describe('mountHouse, PropertyScene & WalkthroughController lifecycle & async safety', () => {
  it('tears down Preact shell, DOM/window/canvas listeners, ResizeObserver, rAF handles, and mid-await warmup cleanly and idempotently', async () => {
    const prevGlobals = {
      Document: globalThis.Document,
      navigator: globalThis.navigator,
      document: globalThis.document,
      window: globalThis.window,
      HTMLElement: globalThis.HTMLElement,
      HTMLCanvasElement: globalThis.HTMLCanvasElement,
      ResizeObserver: globalThis.ResizeObserver,
      requestAnimationFrame: globalThis.requestAnimationFrame,
      cancelAnimationFrame: globalThis.cancelAnimationFrame,
    };

    const fakeDoc = new FakeDomDocument();
    const hostDiv = fakeDoc.createElement('div');
    hostDiv.id = 'app';
    fakeDoc.body.appendChild(hostDiv);

    let nextRaf = 1;
    const pendingRafs = new Map<number, ReturnType<typeof setTimeout>>();
    const requestRaf = (cb: (now: number) => void): number => {
      const id = nextRaf++;
      const timer = setTimeout(() => {
        pendingRafs.delete(id);
        cb(16);
      }, 0);
      pendingRafs.set(id, timer);
      return id;
    };
    const cancelRaf = (id: number): void => {
      const timer = pendingRafs.get(id);
      if (timer !== undefined) {
        clearTimeout(timer);
        pendingRafs.delete(id);
      }
    };

    const visualViewport = new LifecycleEventTarget();
    const fakeWin = Object.assign(new LifecycleEventTarget(), {
      location: { search: '', href: 'http://localhost/' },
      innerWidth: 1440,
      innerHeight: 900,
      devicePixelRatio: 1,
      navigator: {},
      visualViewport,
      localStorage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      },
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      requestAnimationFrame: requestRaf,
      cancelAnimationFrame: cancelRaf,
    });

    let resizeDisconnects = 0;
    let resizeObserves = 0;
    class FakeResizeObserver {
      public observe(): void {
        resizeObserves++;
      }
      public unobserve(): void {}
      public disconnect(): void {
        resizeDisconnects++;
      }
    }

    try {
      const g = globalThis as unknown as Record<string, unknown>;
      g.Document = FakeDomDocument;
      g.navigator = fakeWin.navigator;
      g.document = fakeDoc;
      g.window = fakeWin;
      g.HTMLElement = FakeDomElement;
      g.HTMLCanvasElement = FakeCanvasElement;
      g.ResizeObserver = FakeResizeObserver;
      g.requestAnimationFrame = requestRaf;
      g.cancelAnimationFrame = cancelRaf;

      const livingEntry: RoomManifestEntry = {
        zoneId: 'living',
        label: 'Living',
        group: 'house-ground',
        floor: 'ground',
        lights: [],
        scenes: [],
        devices: [],
      };

      let createdScene: PropertyScene | null = null;
      const house = defineHouse({
        id: 'lifecycle-test-house',
        name: 'Lifecycle Test House',
        location: { lat: 34.1, lon: -118.37, label: 'Test Hills' },
        floors: [{ id: 'ground', label: 'Ground', elevationY: 0, ceilingHeight: 2.7 }],
        terrain: { base: 'flat', flatElevationY: 0 },
        rooms: {
          manifest: [livingEntry],
          navTree: [{ id: 'main', label: 'Main', rooms: [livingEntry] }],
        },
        zones: {
          modules: [],
          circuitMaxIntensity: {},
          lodRegistrations: [
            {
              zoneId: 'living',
              shortName: 'Living',
              floorId: 'ground',
              isInterior: true,
              bounds: { minX: -4, maxX: 4, minY: 0, maxY: 2.7, minZ: -4, maxZ: 4 },
            },
          ],
        },
        createScene: (canvas, onInteract, profile) => {
          const ps = new PropertyScene(canvas, onInteract, profile);
          // Skip WebGPU device init in headless Node while keeping real PropertyScene teardown
          vi.spyOn(ps, 'warmUpForStartup').mockResolvedValue(undefined);
          createdScene = ps;
          return ps;
        },
      });

      const mounted = await mountHouse(house, hostDiv as unknown as HTMLElement);

      const shellRoot = hostDiv.querySelector('#shell-root')!;
      const canvasEl = hostDiv.querySelector('#three-canvas') as FakeCanvasElement;
      expect(createdScene).not.toBeNull();
      expect(shellRoot.children.length).toBeGreaterThan(0);
      expect(resizeObserves).toBe(1);
      expect(fakeWin.countListeners()).toBeGreaterThan(0);
      expect(fakeDoc.countListeners()).toBeGreaterThan(0);
      expect(canvasEl.countListeners()).toBeGreaterThan(0);
      expect(visualViewport.countListeners()).toBe(1);
      expect(pendingRafs.size).toBeGreaterThan(0);

      // Dispose mounted house and verify idempotent full teardown
      mounted.dispose();
      mounted.dispose();

      expect(shellRoot.children).toHaveLength(0);
      expect(resizeDisconnects).toBe(1);
      expect(pendingRafs.size).toBe(0);
      expect(fakeWin.countListeners()).toBe(0);
      expect(fakeDoc.countListeners()).toBe(0);
      expect(visualViewport.countListeners()).toBe(0);
      expect(canvasEl.countListeners()).toBe(0);
      expect(createdScene!.renderer.isDisposed()).toBe(true);
      expect((fakeWin as unknown as Record<string, unknown>)['__HUSJS_MOUNTED__']).toBeUndefined();

      // Also verify mid-await disposal of PropertyScene.warmUpForStartup() prevents post-dispose continuation
      const midCanvas = fakeDoc.createElement('canvas') as FakeCanvasElement;
      const midScene = new PropertyScene(midCanvas as unknown as HTMLCanvasElement, () => {}, house.createSceneProfile());
      let resolveInit!: () => void;
      vi.spyOn(midScene.renderer, 'init').mockImplementation(
        () =>
          new Promise<void>((r) => {
            resolveInit = r;
          })
      );
      const preloadSpy = vi.spyOn(midScene.environment, 'preloadActiveHdr');
      const progressCalls: number[] = [];

      const warmPromise = midScene.warmUpForStartup((_label, frac) => {
        progressCalls.push(frac);
      });
      midScene.dispose();
      resolveInit();
      await warmPromise;

      expect(progressCalls).toEqual([]);
      expect(preloadSpy).not.toHaveBeenCalled();
    } finally {
      const g = globalThis as unknown as Record<string, unknown>;
      g.Document = prevGlobals.Document;
      g.navigator = prevGlobals.navigator;
      g.document = prevGlobals.document;
      g.window = prevGlobals.window;
      g.HTMLElement = prevGlobals.HTMLElement;
      g.HTMLCanvasElement = prevGlobals.HTMLCanvasElement;
      g.ResizeObserver = prevGlobals.ResizeObserver;
      g.requestAnimationFrame = prevGlobals.requestAnimationFrame;
      g.cancelAnimationFrame = prevGlobals.cancelAnimationFrame;
    }
  });

  it('catches async SecurityError rejections from canvas.requestPointerLock() without unhandled rejections', async () => {
    const prevDoc = globalThis.document;
    const prevWin = globalThis.window;
    const prevHtmlEl = globalThis.HTMLElement;

    const fakeDoc = new FakeDomDocument();
    const fakeWin = new LifecycleEventTarget();
    const canvas = fakeDoc.createElement('canvas') as FakeCanvasElement;
    let pointerLockCalls = 0;
    canvas.requestPointerLock = () => {
      pointerLockCalls++;
      return Promise.reject(new Error('SecurityError: The user has exited the lock before this request was completed.'));
    };

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);

    try {
      const g = globalThis as unknown as Record<string, unknown>;
      g.document = fakeDoc;
      g.window = fakeWin;
      g.HTMLElement = FakeDomElement;

      const scene = new THREE.Scene();
      const rig = new CameraRig(canvas as unknown as HTMLCanvasElement, () => {});
      const walkthrough = new WalkthroughController({
        canvas: canvas as unknown as HTMLCanvasElement,
        scene,
        rig,
        getRoomMinYAt: () => 0,
        getInteractiveMeshes: () => [],
        describeInteractable: () => '',
        onInteractWithMesh: () => {},
        onStateChanged: () => {},
        onPoseUpdated: () => {},
        hooks: {
          spawns: [{ id: 'entry', zoneId: 'living', label: 'Entry', position: [0, 0, 0], yawDeg: 0 }],
        },
      });

      walkthrough.enter({
        position: [0, 2, 5],
        target: [0, 1, 0],
        floorViewMode: 'ground',
        ceilingCutaway: false,
        isOrthographic: false,
      });
      walkthrough.requestMouseLock();
      canvas.dispatch('pointerdown', {
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
        clientX: 100,
        clientY: 100,
      });

      await new Promise((r) => setTimeout(r, 20));
      expect(pointerLockCalls).toBe(2);
      expect(unhandled).toHaveLength(0);

      fakeDoc.pointerLockElement = canvas;
      walkthrough.dispose();
      expect(fakeDoc.exitPointerLock).toHaveBeenCalled();
      expect(fakeWin.countListeners()).toBe(0);
      expect(fakeDoc.listeners.get("pointerlockchange")?.size ?? 0).toBe(0);
      rig.dispose();
      expect(fakeDoc.countListeners()).toBe(0);
      expect(canvas.countListeners()).toBe(0);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      const g = globalThis as unknown as Record<string, unknown>;
      g.document = prevDoc;
      g.window = prevWin;
      g.HTMLElement = prevHtmlEl;
    }
  });
});
