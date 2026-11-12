import { options } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccessPointEntityState, CctvCameraEntityState, RoomLodDiagnostics } from '../../core/entities.ts';
import type { CircuitConfig, CircuitId } from '../../core/types/knx.ts';
import type { TwinApi } from '../../core/types/twin-api.ts';
import type { PropertyScene } from '../../engine/viewer/property-scene.ts';
import { KNXPropertyBusController } from '../../integrations/knx/index.ts';
import type { KnxProject } from '../../integrations/knx/project.ts';
import { SmartHomeHub } from '../../integrations/smart-home-hub.ts';
import { UniFiAccessController } from '../../integrations/unifi/access/adapter.ts';
import { UniFiProtectController } from '../../integrations/unifi/protect/adapter.ts';
import { devDrawerOpen, devMode, devTab, setDevMode } from '../../state/shell-store.ts';
import { ShellContext } from '../shell/shell-context.ts';
import type { ShellController } from '../shell/shell-controller.ts';
import { DevDrawerPanel } from './DevDrawerPanel.tsx';
import { subscribeLiveDeps } from './DevSmartHomePanel.tsx';
import { devStore } from './dev-store.ts';
import { devLodDiagnostics, mountDevToolsRuntime } from './dev-tools-runtime.ts';
import { devToolsDeps, devToolsMounted, mountDevTools, type DevToolsDeps } from './mount-dev-tools.ts';

interface HostNode {
  readonly tag: string;
  readonly props: Record<string, any>;
  readonly children: (HostNode | string)[];
}

type PreactHook = ((vnode: unknown) => void) | undefined;
const hooks = options as unknown as { __b: PreactHook; __r: PreactHook; diffed: PreactHook; unmount: PreactHook };

/**
 * Renders a component tree to plain host nodes in Node (no DOM): every function
 * component is evaluated through Preact's hook lifecycle with `ctl` provided as
 * the ShellContext value. Effects do not run.
 */
function renderToHostTree(type: (props: any) => unknown, ctl: ShellController): HostNode {
  const contextId = (ShellContext as unknown as { __c: string }).__c;

  const evaluate = (fn: (props: any) => unknown, props: Record<string, unknown>): unknown => {
    const component = {
      __H: { __: [], __h: [] },
      context: { [contextId]: { props: { value: ctl }, sub: () => {} } },
      props,
      setState: () => {},
      forceUpdate: () => {},
    };
    const vnode = { type: fn, props, __c: component };
    hooks.__b?.(vnode);
    hooks.__r?.(vnode);
    const out = fn(props);
    hooks.diffed?.(vnode);
    hooks.unmount?.(vnode);
    return out;
  };

  const walk = (node: unknown, into: (HostNode | string)[]): void => {
    if (node === null || node === undefined || typeof node === 'boolean') return;
    if (typeof node === 'string' || typeof node === 'number') {
      into.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) walk(child, into);
      return;
    }
    const vnode = node as { type: unknown; props: Record<string, unknown> };
    if (typeof vnode.type === 'function') {
      walk(evaluate(vnode.type as (props: any) => unknown, vnode.props), into);
      return;
    }
    const host: HostNode = { tag: String(vnode.type), props: vnode.props, children: [] };
    walk(vnode.props.children, host.children);
    into.push(host);
  };

  const roots: (HostNode | string)[] = [];
  walk(evaluate(type, {}), roots);
  const root = roots[0];
  if (roots.length !== 1 || root === undefined || typeof root === 'string') {
    throw new Error('expected a single host root element');
  }
  return root;
}

function textOf(node: HostNode | string): string {
  return typeof node === 'string' ? node : node.children.map(textOf).join('');
}

function findAll(node: HostNode, match: (n: HostNode) => boolean, found: HostNode[] = []): HostNode[] {
  if (match(node)) found.push(node);
  for (const child of node.children) {
    if (typeof child !== 'string') findAll(child, match, found);
  }
  return found;
}

function button(root: HostNode, label: string): HostNode {
  const hit = findAll(
    root,
    (n) => n.tag === 'button' && (n.props['aria-label'] === label || textOf(n).trim() === label)
  )[0];
  if (!hit) throw new Error(`no button labelled "${label}"`);
  return hit;
}

function circuit(id: CircuitId, channel: number): CircuitConfig {
  return {
    id,
    channel,
    name: id,
    shortName: id,
    location: id,
    buildingId: 'mainHouse',
    floorId: 'ground',
    zoneId: 'hall',
    actuatorPa: '1.1.20',
    gaSwitch: `1/1/${channel}`,
    gaValue: `1/2/${channel}`,
    gaStatus: `1/3/${channel}`,
    isSceneMember: false,
    dimmable: true,
    defaultLevel: 0,
  };
}

function makeProject(circuitIds: readonly CircuitId[]): KnxProject {
  const zoneLevels = (level: number) => Object.fromEntries(circuitIds.map((id) => [id, level]));
  return {
    name: 'Test house',
    buildings: {
      mainHouse: { id: 'mainHouse', name: 'House', knxArea: 1, description: '' },
      annex: { id: 'annex', name: 'Annex', knxArea: 2, description: '' },
      courtyardGrounds: { id: 'courtyardGrounds', name: 'Grounds', knxArea: 1, description: '' },
    },
    floors: [],
    rooms: [],
    circuits: circuitIds.map((id, i) => circuit(id, i + 1)),
    centralScenes: [],
    zones: [
      {
        id: 'hall',
        name: 'Hall',
        circuits: [...circuitIds],
        scenes: [
          { id: 'bright', label: 'Bright', levels: zoneLevels(100) },
          { id: 'evening', label: 'Evening', levels: zoneLevels(40) },
        ],
        nightLevels: zoneLevels(4),
        ga: { scene: '1/6/4', night: '1/6/5', full: '1/6/6', dim: '1/6/7', sceneStatus: '1/7/2', status: '1/7/3' },
      },
    ],
    pushButtons: [
      {
        pa: '1.1.17',
        name: 'Stair foot',
        mountedInZoneId: 'hall',
        location: 'Hall',
        gangs: [{ gang: 1, zoneId: 'hall', label: 'Hall' }],
        params: { longPressMs: 600 },
      },
    ],
    presenceDetectors: [],
    physicalDevices: [],
    roomAutomation: { nightWalkRules: [], motionCircuitRules: [], motionSensors: [] },
    centralGa: {
      masterOff: '1/0/0',
      centralScene: '1/0/1',
      masterFull: '1/0/2',
      kitchenPresence: '1/4/1',
      ambientLux: '1/4/2',
      utilityPresence: '1/4/3',
      tvArt: '1/4/4',
      carGatesCommand: '1/5/1',
      carGatesPosition: '1/5/2',
    },
    centralPa: {
      ipInterface: '1.1.1',
      aiBridge: '1.1.2',
      kitchenSwitchGroup: '1.1.10',
      kitchenPresence: '1.1.12',
      utilityPresence: '1.1.13',
      utilitySwitch: '1.1.11',
      courtyardSwitch: '1.1.14',
      kitchenActuator: '1.1.20',
      carGates: '1.1.22',
    },
    defaultPresenceHoldTimeSec: 60,
    groupAddresses: [],
  };
}

const CAMERA: CctvCameraEntityState = {
  entityId: 'camera.test_yard',
  name: 'Yard camera',
  shortName: 'Yard cam',
  protocol: 'unifi-protect',
  buildingId: 'mainHouse',
  floorId: 'ground',
  zoneId: 'hall',
  hardwareAddress: '00:11:22:33:44:55',
  kind: 'camera',
  model: 'UVC-G5-Pro',
  isRecording: true,
  irNightVisionActive: false,
  showFrustum3D: false,
  activeDetection: 'none',
  lastDetectionSummary: '',
  pose3D: { position: [0, 3, 0], lookAt: [0, 0, 5], horizontalFovDeg: 90, rangeMeters: 12 },
};

const SIDE_GATE: AccessPointEntityState = {
  entityId: 'access.test_side_gate',
  name: 'Side gate reader',
  shortName: 'Side gate',
  protocol: 'unifi-access',
  buildingId: 'mainHouse',
  floorId: 'ground',
  zoneId: 'hall',
  hardwareAddress: '66:77:88:99:AA:BB',
  kind: 'accessPoint',
  model: 'UA-Hub-Door-Mini',
  targetEntry: 'pedestrianGate',
  isLocked: true,
  doorPosition: 'closed',
  lastCredentialMethod: 'NFC Card',
  lastEventTimestamp: '',
  position3D: [0, 1, 0],
};

const LOD_DIAGNOSTICS: RoomLodDiagnostics = {
  policyMode: 'auto',
  focusedZoneId: 'hall',
  focusedZoneTier: 2,
  tierCounts: { 0: 1, 1: 0, 2: 1 },
  rooms: [
    { zoneId: 'hall', shortName: 'Hall', floorId: 'ground', tier: 2, isFocused: true, distanceToTargetM: 0, standardObjectCount: 4, heroObjectCount: 9 },
    { zoneId: 'kitchen', shortName: 'Kitchen', floorId: 'ground', tier: 0, isFocused: false, distanceToTargetM: 14, standardObjectCount: 6, heroObjectCount: 12 },
  ],
};

interface Harness {
  readonly deps: DevToolsDeps;
  readonly ctl: ShellController;
  readonly activateObjectTool: ReturnType<typeof vi.fn>;
  readonly state: { floorMode: string; cutaway: boolean; walking: boolean; lodMode: string; blur: boolean; ufhLayer: boolean };
  emitLod(diagnostics: RoomLodDiagnostics): void;
  emitWalkthrough(active: boolean): void;
}

function makeHarness(circuitIds: readonly CircuitId[], withUnifi = true): Harness {
  const knx = new KNXPropertyBusController(makeProject(circuitIds));
  const hub = withUnifi
    ? new SmartHomeHub(knx, new UniFiProtectController([CAMERA]), new UniFiAccessController([SIDE_GATE]))
    : new SmartHomeHub(knx);
  const state = { floorMode: 'ground', cutaway: false, walking: false, lodMode: 'auto', blur: false, ufhLayer: false };
  const walkListeners = new Set<(active: boolean) => void>();
  const deviceListeners = new Set<() => void>();
  let lodListener: (diagnostics: RoomLodDiagnostics) => void = () => {};

  const listen = <T>(set: Set<T>) => (listener: T) => {
    set.add(listener);
    return () => set.delete(listener);
  };
  const api = {
    lighting: {
      getTransport: () => ({ mode: knx.getTransportMode(), status: knx.getTransportStatus() }),
      getAmbientLux: () => knx.getAmbientLux(),
      getTimeOfDay: () => 'day',
      roomMotionSensors: () => [{ id: 'hallPir', label: 'Hall PIR', occupied: false }],
      toggleRoomMotion: vi.fn(() => true),
      allOff: vi.fn(),
      pressZoneSwitch: vi.fn(),
    },
    devices: {
      onChanged: listen(deviceListeners),
      isGatesOpen: () => false,
      getGatesStatusLabel: () => 'Closed',
      toggleGates: vi.fn(() => true),
      isBifoldsOpen: () => false,
      toggleBifolds: vi.fn(() => true),
      isTvArtMode: () => false,
      getTvArtTitle: () => '',
      cycleTvArt: vi.fn(),
      getCourtyardModeLabel: () => 'Off',
      pressCourtyardSwitch: vi.fn(),
      hasUfh: () => true,
      ufhZones: () => [{ id: 'ufh-hall', name: 'Hall loop', shortName: 'Hall', roomZones: ['hall'], heatingOn: false, targetTempC: 21 }],
      toggleUfhZone: vi.fn(() => true),
      isUfhLayerVisible: () => state.ufhLayer,
      setUfhLayerVisible: (visible: boolean) => {
        state.ufhLayer = visible;
      },
      toggleUfhLayer: () => (state.ufhLayer = !state.ufhLayer),
    },
    floors: {
      list: () => [
        { id: 'ground', label: 'Ground' },
        { id: 'first', label: 'First' },
      ],
      getMode: () => state.floorMode,
      setMode: (mode: string) => {
        state.floorMode = mode;
      },
      isCeilingCutaway: () => state.cutaway,
      toggleCeilingCutaway: () => (state.cutaway = !state.cutaway),
    },
    walkthrough: {
      isActive: () => state.walking,
      toggle: () => (state.walking = !state.walking),
      onChanged: listen(walkListeners),
      onFootPositionChanged: () => () => {},
    },
    camera: { onViewChanged: () => () => {} },
    graphics: { getStats: () => ({ fps: 60 }) },
    dev: {
      getLodDiagnostics: () => LOD_DIAGNOSTICS,
      getLodPolicyMode: () => state.lodMode,
      setLodPolicyMode: (mode: string) => {
        state.lodMode = mode;
      },
      getFocusedRoomShortName: () => 'Hall',
      isMotionBlurEnabled: () => state.blur,
      toggleMotionBlur: () => (state.blur = !state.blur),
    },
  } as unknown as TwinApi;

  const scene = {
    getLodController: () => ({
      setOnLodChanged: (listener: (diagnostics: RoomLodDiagnostics) => void) => {
        lodListener = listener;
      },
    }),
  } as unknown as PropertyScene;

  const activateObjectTool = vi.fn();
  return {
    deps: { scene, knx, hub, api },
    ctl: { api, activateObjectTool } as unknown as ShellController,
    activateObjectTool,
    state,
    emitLod: (diagnostics) => lodListener(diagnostics),
    emitWalkthrough: (active) => {
      for (const listener of walkListeners) listener(active);
    },
  };
}

function openDrawer(tab: 'smart-home' | 'diagnostics' = 'smart-home'): void {
  setDevMode(true);
  devDrawerOpen.value = true;
  devTab.value = tab;
}

/** Installs a `document` whose lookups are recorded, so any legacy DOM adoption is caught. */
function stubDocument(): { readonly getElementById: ReturnType<typeof vi.fn>; readonly querySelector: ReturnType<typeof vi.fn> } {
  const doc = { getElementById: vi.fn(() => null), querySelector: vi.fn(() => null), activeElement: null };
  vi.stubGlobal('document', doc);
  return doc;
}

const disposers: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.unstubAllGlobals();
  setDevMode(false);
  devDrawerOpen.value = false;
  devTab.value = 'smart-home';
  devToolsDeps.value = null;
  devStore.syncKnxState({ telegramCount: 0, recentTelegrams: [] });
});

describe('<DevDrawerPanel /> self-contained Preact dev HUD', () => {
  it('renders with devMode + devDrawerOpen and never looks up #hud-panel in the document', () => {
    const doc = stubDocument();
    const h = makeHarness(['hallPendant', 'hallStairLeds', 'hallLamps5A']);
    devToolsDeps.value = h.deps;
    openDrawer();
    expect(devMode.value).toBe(true);

    const root = renderToHostTree(DevDrawerPanel, h.ctl);

    expect(root.tag).toBe('aside');
    expect(root.props.hidden).toBe(false);
    expect(findAll(root, (n) => n.props.id !== undefined)).toEqual([]);
    expect(doc.getElementById).not.toHaveBeenCalled();
    expect(doc.querySelector).not.toHaveBeenCalled();
    expect(findAll(root, (n) => n.props.className === 'twin-status-badge')).toHaveLength(1);
    expect(textOf(root)).toContain('Simulation');
    for (const title of ['Scenes & switches', 'Live circuits & dimmers', 'Viewport, LOD & UFH', 'UniFi Protect & Access', 'KNX bus & EEPROM inspector']) {
      expect(textOf(root)).toContain(title);
    }
  });

  it('shows a fallback instead of the smart-home panel when no dev deps were mounted', () => {
    const h = makeHarness(['hallPendant', 'hallStairLeds']);
    openDrawer();

    const root = renderToHostTree(DevDrawerPanel, h.ctl);

    expect(textOf(root)).toContain('Smart home tools are unavailable');
    expect(findAll(root, (n) => n.props.className === 'twin-status-badge')).toHaveLength(1);
    expect(findAll(root, (n) => n.tag === 'input')).toEqual([]);
  });

  it('stays hidden while developer mode is off', () => {
    const h = makeHarness(['hallPendant', 'hallStairLeds']);
    devToolsDeps.value = h.deps;
    devDrawerOpen.value = true;

    const root = renderToHostTree(DevDrawerPanel, h.ctl);

    expect(root.props.hidden).toBe(true);
    expect(textOf(root)).not.toContain('Live circuits & dimmers');
  });

  it('keeps the Tools tab working: object move / rotate and camera motion blur', () => {
    const h = makeHarness(['hallPendant', 'hallStairLeds']);
    openDrawer('diagnostics');

    const root = renderToHostTree(DevDrawerPanel, h.ctl);
    button(root, 'Move object').props.onClick();
    button(root, 'Rotate object').props.onClick();
    const blur = button(root, 'Camera motion blur');
    expect(blur.props['aria-checked']).toBe(false);
    blur.props.onClick();

    expect(h.activateObjectTool.mock.calls).toEqual([['move'], ['rotate']]);
    expect(h.state.blur).toBe(true);
    expect(textOf(root)).not.toContain('Live circuits & dimmers');
  });

  it('lists a dimmer row per circuit for any house and drives the KNX bus from it', () => {
    const small = makeHarness(['hallPendant', 'hallStairLeds']);
    devToolsDeps.value = small.deps;
    openDrawer();
    expect(findAll(renderToHostTree(DevDrawerPanel, small.ctl), (n) => n.props.type === 'range')).toHaveLength(2);

    const h = makeHarness(['hallPendant', 'hallStairLeds', 'hallLamps5A']);
    devToolsDeps.value = h.deps;
    const { knx } = h.deps;
    let root = renderToHostTree(DevDrawerPanel, h.ctl);
    const sliders = findAll(root, (n) => n.props.type === 'range');
    expect(sliders).toHaveLength(3);
    expect(sliders.map((s) => [s.props.min, s.props.max])).toEqual([[0, 100], [0, 100], [0, 100]]);

    const pendant = sliders.find((s) => s.props['aria-label'] === 'hallPendant dimmer');
    pendant?.props.onInput({ currentTarget: { value: '42' } });
    expect(knx.getTargetLevels().hallPendant).toBe(42);
    expect(knx.getTelegrams()).toHaveLength(0);
    pendant?.props.onChange({ currentTarget: { value: '42' } });
    expect(knx.getTelegrams().length).toBeGreaterThan(0);

    button(root, 'Toggle hallStairLeds').props.onClick();
    expect(knx.getTargetLevels().hallStairLeds).toBeGreaterThan(0);

    root = renderToHostTree(DevDrawerPanel, h.ctl);
    expect(textOf(root)).toContain('42%');
    expect(textOf(root)).toContain('2/3 on');
  });

  it('wires scenes, switches, viewport, LOD, UFH and UniFi controls to the injected deps', () => {
    const h = makeHarness(['hallPendant', 'hallStairLeds', 'hallLamps5A']);
    devToolsDeps.value = h.deps;
    openDrawer();
    const { api, hub } = h.deps;
    let root = renderToHostTree(DevDrawerPanel, h.ctl);

    button(root, 'All Off').props.onClick();
    expect(api.lighting.allOff).toHaveBeenCalledTimes(1);
    button(root, 'Hall switch: short press up').props.onClick();
    expect(api.lighting.pressZoneSwitch).toHaveBeenCalledWith('hall', 'up');
    button(root, 'Front gates: Open').props.onClick();
    expect(api.devices.toggleGates).toHaveBeenCalledTimes(1);
    button(root, 'Bifolds: Open').props.onClick();
    expect(api.devices.toggleBifolds).toHaveBeenCalledTimes(1);
    button(root, 'Frame TV art: Next art').props.onClick();
    expect(api.devices.cycleTvArt).toHaveBeenCalledTimes(1);
    button(root, 'Hall PIR: Clear').props.onClick();
    expect(api.lighting.toggleRoomMotion).toHaveBeenCalledWith('hallPir');

    expect(['Ground', 'First', 'All'].map((label) => button(root, label).props['aria-pressed'])).toEqual([true, false, false]);
    button(root, 'All').props.onClick();
    expect(h.state.floorMode).toBe('all');
    expect(devStore.floorViewMode.value).toBe('all');
    button(root, 'Ceiling cutaway').props.onClick();
    expect(devStore.ceilingCutaway.value).toBe(true);
    button(root, 'Walkthrough').props.onClick();
    expect(h.state.walking).toBe(true);
    button(root, 'LOD1').props.onClick();
    expect(h.state.lodMode).toBe('lod1');
    expect(textOf(root)).toContain('Focus Hall · LOD2 · 1 rooms detailed · 1 culled to shell');
    button(root, 'UFH X-ray pipes').props.onClick();
    expect(h.state.ufhLayer).toBe(true);
    button(root, 'Hall · Off').props.onClick();
    expect(api.devices.toggleUfhZone).toHaveBeenCalledWith('ufh-hall');

    expect(textOf(root)).toContain('1 cameras · 1 access points');
    button(root, '3D CCTV frustums').props.onClick();
    expect(hub.protect.areFrustumsVisible()).toBe(true);
    button(root, 'Side gate: NFC unlock').props.onClick();
    expect(hub.access.getAccessPoints()[0]?.isLocked).toBe(false);
    button(root, 'Yard cam: simulate LPR vehicle').props.onClick();
    expect(hub.protect.getCameras()[0]?.activeDetection).toBe('vehicle');

    root = renderToHostTree(DevDrawerPanel, h.ctl);
    expect(button(root, 'LOD1').props['aria-pressed']).toBe(true);
    expect(button(root, '3D CCTV frustums').props['aria-checked']).toBe(true);
    expect(textOf(root)).toContain('Unlocked · NFC Card');
  });

  it('omits the UniFi card for a house without cameras or access points', () => {
    const h = makeHarness(['hallPendant', 'hallStairLeds'], false);
    devToolsDeps.value = h.deps;
    openDrawer();

    const text = textOf(renderToHostTree(DevDrawerPanel, h.ctl));

    expect(text).not.toContain('UniFi Protect & Access');
    expect(text).toContain('Live circuits & dimmers');
  });

  it('shows the live telegram log with Clear and the EEPROM hex image', () => {
    const h = makeHarness(['hallPendant', 'hallStairLeds', 'hallLamps5A']);
    devToolsDeps.value = h.deps;
    openDrawer();
    const { knx } = h.deps;
    disposers.push(mountDevToolsRuntime(h.deps));
    knx.setCircuitLevel('hallPendant', 55);
    const latest = knx.getTelegrams()[0];
    expect(latest).toBeDefined();

    let root = renderToHostTree(DevDrawerPanel, h.ctl);
    const rows = findAll(root, (n) => n.props.class === 'telegram-row').map(textOf);
    expect(rows[0]).toContain(`${latest?.src} → ${latest?.dst}`);
    expect(rows[0]).toContain(latest?.apci);
    expect(rows[0]).toContain(latest?.timestamp);
    const hex = findAll(root, (n) => n.tag === 'pre')[0];
    expect(hex && textOf(hex)).toMatch(/^0x4000: ([0-9A-F]{2} ){16}0x4010: /);
    expect(findAll(root, (n) => n.tag === 'details' && textOf(n).includes('EEPROM image · 64 bytes'))).toHaveLength(1);

    button(root, 'Clear').props.onClick();
    expect(knx.getTelegrams()).toHaveLength(0);
    root = renderToHostTree(DevDrawerPanel, h.ctl);
    expect(findAll(root, (n) => n.props.class === 'telegram-row').map(textOf)).toEqual(['No telegrams yet']);
  });
});

describe('dev tools runtime', () => {
  it('syncs devStore from the KNX bus, floors, walkthrough and LOD without any DOM', () => {
    const doc = stubDocument();
    const h = makeHarness(['hallPendant', 'hallStairLeds', 'hallLamps5A']);
    h.state.floorMode = 'first';
    disposers.push(mountDevToolsRuntime(h.deps));

    expect(devStore.totalCircuitsCount.value).toBe(3);
    expect(devStore.activeCircuitsCount.value).toBe(0);
    expect(devStore.floorViewMode.value).toBe('first');
    expect(devStore.formattedSunTime.value).toBe('13:30');
    expect(devLodDiagnostics.value).toBe(LOD_DIAGNOSTICS);

    h.deps.knx.setCircuitLevel('hallPendant', 70);
    expect(devStore.activeCircuitsCount.value).toBe(1);
    expect(devStore.knxDeviceStates.value.hallPendant).toBe(70);
    expect(devStore.telegramCount.value).toBe(h.deps.knx.getTelegrams().length);
    expect(devStore.recentTelegrams.value[0]).toBe(h.deps.knx.getTelegrams()[0]);

    h.emitWalkthrough(true);
    expect(devStore.walkthroughActive.value).toBe(true);
    h.emitLod({ ...LOD_DIAGNOSTICS, focusedZoneId: 'kitchen' });
    expect(devStore.activeRoomId.value).toBe('kitchen');
    expect(doc.getElementById).not.toHaveBeenCalled();
  });

  it('is cleanup-safe: remounting replaces the previous runtime and its keyboard shortcuts', () => {
    const added: [string, unknown][] = [];
    const removed: [string, unknown][] = [];
    vi.stubGlobal('window', {
      addEventListener: (type: string, fn: unknown) => added.push([type, fn]),
      removeEventListener: (type: string, fn: unknown) => removed.push([type, fn]),
    });
    const first = makeHarness(['hallPendant', 'hallStairLeds', 'hallLamps5A']);
    const second = makeHarness(['hallPendant', 'hallStairLeds']);

    const disposeFirst = mountDevToolsRuntime(first.deps);
    expect(added.map(([type]) => type)).toEqual(['keydown', 'keyup']);
    const disposeSecond = mountDevToolsRuntime(second.deps);
    expect(removed).toEqual(added.slice(0, 2));
    expect(devStore.totalCircuitsCount.value).toBe(2);

    first.deps.knx.setCircuitLevel('hallLamps5A', 100);
    expect(devStore.totalCircuitsCount.value).toBe(2);
    disposeFirst();
    expect(devLodDiagnostics.value).toBe(LOD_DIAGNOSTICS);

    disposeSecond();
    expect(removed).toEqual(added);
    expect(devLodDiagnostics.value).toBeNull();
    second.deps.knx.setCircuitLevel('hallPendant', 100);
    expect(devStore.activeCircuitsCount.value).toBe(0);
  });

  it('mountDevTools publishes deps and starts the runtime once developer mode is on', async () => {
    const first = makeHarness(['hallPendant', 'hallStairLeds', 'hallLamps5A']);
    const second = makeHarness(['hallPendant', 'hallStairLeds']);

    mountDevTools(first.deps);
    expect(devToolsDeps.value).toBe(first.deps);
    expect(devToolsMounted.value).toBe(false);

    setDevMode(true);
    await vi.waitFor(() => expect(devToolsMounted.value).toBe(true));
    expect(devStore.totalCircuitsCount.value).toBe(3);

    mountDevTools(second.deps);
    expect(devToolsDeps.value).toBe(second.deps);
    await vi.waitFor(() => expect(devToolsMounted.value).toBe(true));
    expect(devStore.totalCircuitsCount.value).toBe(2);
  });

  it('subscribeLiveDeps reports state changes (not telegram traffic) until unsubscribed', () => {
    const h = makeHarness(['hallPendant', 'hallStairLeds', 'hallLamps5A']);
    const onChange = vi.fn();
    const unsubscribe = subscribeLiveDeps(h.deps, onChange);
    expect(onChange).not.toHaveBeenCalled();

    h.deps.knx.setCircuitLevel('hallPendant', 30);
    expect(onChange).toHaveBeenCalled();
    onChange.mockClear();
    devStore.syncViewportState({ ceilingCutaway: !devStore.ceilingCutaway.value });
    expect(onChange).toHaveBeenCalledTimes(1);
    h.emitWalkthrough(true);
    expect(onChange).toHaveBeenCalledTimes(2);

    unsubscribe();
    onChange.mockClear();
    h.deps.knx.setCircuitLevel('hallPendant', 80);
    h.emitWalkthrough(false);
    expect(onChange).not.toHaveBeenCalled();
  });
});
