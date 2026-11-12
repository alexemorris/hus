import type { CircuitConfig, CircuitId, CircuitLevels } from '../core/types/knx.ts';
import {
  isKnxZoneBus,
  LIGHTING_LAYER_LABELS,
  LIGHTING_LAYER_ORDER,
  type KnxZoneBus,
  type KnxZoneCircuit,
  type KnxZoneScene,
  type KnxZoneState,
  type LightingLayerKind,
} from '../core/types/knx-zones.ts';
import type { FloorViewMode, TimeOfDay, Vec3Tuple } from '../core/types/scene.ts';
import type { RoomZoneId } from '../core/types/topology.ts';
import type {
  TwinApi,
  TwinFloorInfo,
  TwinLightingLayer,
  TwinLightingZone,
  TwinPresenceDetector,
  TwinRoomHit,
  TwinUfhZone,
  TwinViewState,
  TwinWalkthroughState,
  TwinZoneCircuit,
  TwinZoneLightingApi,
  TwinZoneSwitch,
  Unsubscribe,
} from '../core/types/twin-api.ts';
import type { RoomManifestEntry, RoomSceneControl } from '../core/types/twin-ux.ts';
import { soundEngine } from '../engine/audio/sound-engine.ts';
import type { SecurityOverlay3D } from '../engine/viewer/property-scene-profile.ts';
import type { UfhZoneId, UfhZoneState } from './viewer.ts';
import type { KNXPropertyBusController } from './knx.ts';
import { playCorstonSwitchSound } from '../objects/fixtures/corston-toggle-switch.ts';
import { configureShareStateCodec } from '../state/url-state.ts';
import type { MountHouseRuntimeContext, MountHouseRuntimeHandle } from './house.ts';

const TIME_OF_DAY_LUX: Readonly<Record<TimeOfDay, number>> = {
  day: 480,
  dusk: 38,
  night: 5,
};

function luxToTimeOfDay(lux: number): TimeOfDay {
  return lux >= 200 ? 'day' : lux >= 20 ? 'dusk' : 'night';
}

function floorLabelFromId(id: string): string {
  const spaced = id
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function toTuple(v: { readonly x: number; readonly y: number; readonly z: number }): Vec3Tuple {
  return [v.x, v.y, v.z];
}

function clampPct(pct: number): number {
  return Math.round(Math.max(0, Math.min(100, pct)));
}

function inferLayerKind(
  c: Pick<KnxZoneCircuit, 'id' | 'name' | 'shortName' | 'kind'>
): LightingLayerKind {
  if (c.kind) return c.kind;
  const t = `${c.id} ${c.name} ${c.shortName}`.toLowerCase();
  if (/festoon|lamp ?post|external|balcony|courtyard|garden/.test(t)) return 'exterior';
  if (/lamps?5a|5v lamp|5a lamp|\blamps?\b/.test(t)) return 'lamps';
  if (/picture/.test(t)) return 'picture';
  if (/pendant/.test(t)) return 'pendants';
  if (/uplight/.test(t)) return 'uplights';
  if (/sconce|wall/.test(t)) return 'wall';
  if (/cabinet|bench|task|desk/.test(t)) return 'task';
  if (/cove/.test(t)) return 'cove';
  if (/shelf|bookcase|joinery/.test(t)) return 'shelf';
  if (/batten|high ?bay|bays/.test(t)) return 'battens';
  if (/downlight/.test(t)) return 'downlights';
  if (/spot/.test(t)) return 'spots';
  if (/fairy|halo|ring|feature|pool table/.test(t)) return 'feature';
  if (/led|strip/.test(t)) return 'strip';
  return 'downlights';
}

function groupLayers(circuits: readonly TwinZoneCircuit[]): readonly TwinLightingLayer[] {
  const layers: TwinLightingLayer[] = [];
  for (const kind of LIGHTING_LAYER_ORDER) {
    const members = circuits.filter((c) => c.kind === kind);
    if (members.length > 0) {
      layers.push({ kind, label: LIGHTING_LAYER_LABELS[kind], circuits: members });
    }
  }
  return layers;
}

function stripScenePrefix(label: string): string {
  return label.replace(/^S\d+\s*/, '');
}

function buildDefaultZoneLightingApi(
  knx: KNXPropertyBusController | { getScenes(): readonly { index: number; levels: Readonly<Partial<Record<CircuitId, number>>> }[]; setCircuitLevel(id: CircuitId, pct: number): void; getTargetLevels(): Readonly<CircuitLevels>; recallScene(sceneNumber: number, pa?: string): void; subscribe(cb: (e: { type: string }) => void): Unsubscribe },
  deps: {
    readonly circuits: readonly CircuitConfig[];
    readonly manifest: readonly RoomManifestEntry[];
    getManifest(zoneId: RoomZoneId): RoomManifestEntry | undefined;
    getLevelScenes(zoneId: RoomZoneId): readonly KnxZoneScene[];
    roomLabel(zoneId: RoomZoneId): string;
    readonly uiSourcePa: string;
  }
): TwinZoneLightingApi {
  const subscribe = (listener: () => void): Unsubscribe =>
    knx.subscribe((event) => {
      if (event.type === 'stateChange') listener();
    });

  const dimmableMap = new Map<string, boolean>();
  for (const entry of deps.manifest) {
    for (const l of entry.lights) dimmableMap.set(l.circuitId, l.dimmable);
  }
  const toTwinCircuit = (c: KnxZoneCircuit): TwinZoneCircuit => ({
    id: c.id,
    label: c.shortName || c.name,
    kind: inferLayerKind(c),
    dimmable: c.dimmable ?? dimmableMap.get(c.id) ?? true,
  });

  if (isKnxZoneBus(knx)) {
    const bus: KnxZoneBus = knx;
    let cache: readonly TwinLightingZone[] | null = null;
    const zones = (): readonly TwinLightingZone[] => {
      if (cache) return cache;
      const byId = new Map(bus.getCircuits().map((c) => [c.id, c] as const));
      cache = bus.getZones().map((z) => {
        const circuits = z.circuits.flatMap((id) => {
          const c = byId.get(id);
          return c ? [toTwinCircuit(c)] : [];
        });
        return {
          id: z.id,
          name: z.name,
          circuitIds: z.circuits,
          layers: groupLayers(circuits),
          scenes: z.scenes.map((s, index) => ({
            index,
            id: s.id,
            label: stripScenePrefix(s.label),
          })),
        };
      });
      return cache;
    };
    const location = (zoneId: RoomZoneId): string => `${deps.roomLabel(zoneId)} (app)`;
    return {
      source: () => 'knx',
      list: zones,
      get: (zoneId) => zones().find((z) => z.id === zoneId),
      getState: (zoneId) => bus.getZoneState(zoneId),
      recallScene: (zoneId, index) =>
        bus.recallZoneScene(zoneId, index, deps.uiSourcePa, location(zoneId)),
      setFull: (zoneId) => bus.setZoneFull(zoneId, deps.uiSourcePa, location(zoneId)),
      setNight: (zoneId) => bus.enterZoneNight(zoneId, deps.uiSourcePa, location(zoneId)),
      setOff: (zoneId) => bus.setZoneOff(zoneId, deps.uiSourcePa),
      onStateChanged: subscribe,
      presenceDetectors: (zoneId) =>
        bus
          .getPresenceDetectors()
          .filter((d) => zoneId === undefined || d.zoneId === zoneId)
          .map((d): TwinPresenceDetector => {
            const st = bus.getPresenceState(d.pa);
            return {
              pa: d.pa,
              name: d.name,
              zoneId: d.zoneId,
              detected: st.detected,
              lastSeenSimSec: st.lastSeenSimSec,
            };
          }),
      switches: (zoneId) =>
        bus
          .getPushButtons()
          .filter((b) => zoneId === undefined || b.mountedInZoneId === zoneId)
          .map(
            (b): TwinZoneSwitch => ({
              pa: b.pa,
              name: b.name,
              location: b.location,
              mountedInZoneId: b.mountedInZoneId,
              gangs: b.gangs.map((g) => ({
                gang: g.gang,
                zoneId: g.zoneId,
                label: g.label,
                ledOn: bus.getZoneState(g.zoneId).mode !== 'off',
              })),
            })
          ),
    };
  }

  const centralScenes = knx.getScenes();
  const zoneOrder: RoomZoneId[] = [];
  const seen = new Set<RoomZoneId>();
  for (const e of deps.manifest) {
    if (!seen.has(e.zoneId)) {
      seen.add(e.zoneId);
      zoneOrder.push(e.zoneId);
    }
  }
  for (const c of deps.circuits) {
    if (!seen.has(c.zoneId)) {
      seen.add(c.zoneId);
      zoneOrder.push(c.zoneId);
    }
  }

  interface DerivedScene {
    readonly levels: Readonly<Partial<Record<CircuitId, number>>>;
    readonly central?: RoomSceneControl;
  }
  const derived = new Map<RoomZoneId, { zone: TwinLightingZone; scenes: readonly DerivedScene[] }>();
  for (const zoneId of zoneOrder) {
    const circuits = deps.circuits.filter((c) => c.zoneId === zoneId).map(toTwinCircuit);
    if (circuits.length === 0) continue;
    const entry = deps.getManifest(zoneId);
    const centralCtl = entry?.scenes ?? [];
    const scenes: DerivedScene[] = [];
    const labels: { id: string; label: string }[] = [];
    if (centralCtl.length > 0) {
      for (const ctl of centralCtl) {
        const preset = centralScenes.find((p: { readonly index: number }) => p.index === ctl.sceneNumber);
        scenes.push({ levels: preset?.levels ?? {}, central: ctl });
        labels.push({ id: ctl.id, label: ctl.label });
      }
    } else {
      for (const s of deps.getLevelScenes(zoneId)) {
        scenes.push({ levels: s.levels });
        labels.push({ id: s.id, label: stripScenePrefix(s.label) });
      }
    }
    derived.set(zoneId, {
      zone: {
        id: zoneId,
        name: deps.roomLabel(zoneId),
        circuitIds: circuits.map((c) => c.id),
        layers: groupLayers(circuits),
        scenes: labels.map((l, index) => ({ index, ...l })),
      },
      scenes,
    });
  }

  const zoneList: readonly TwinLightingZone[] = [...derived.values()].map((d) => d.zone);
  const applyZone = (zoneId: RoomZoneId, levelFor: (c: TwinZoneCircuit) => number): void => {
    const d = derived.get(zoneId);
    if (!d) return;
    for (const layer of d.zone.layers) {
      for (const c of layer.circuits) knx.setCircuitLevel(c.id, levelFor(c));
    }
  };

  const getState = (zoneId: RoomZoneId): KnxZoneState => {
    const d = derived.get(zoneId);
    if (!d) return { mode: 'off', sceneIndex: null };
    const target = knx.getTargetLevels();
    const values = d.zone.circuitIds.map((id) => target[id] ?? 0);
    if (values.every((v) => v <= 0)) return { mode: 'off', sceneIndex: null };
    if (values.every((v) => v >= 98.5)) return { mode: 'full', sceneIndex: null };
    if (values.every((v) => v <= 6.5)) return { mode: 'night', sceneIndex: null };
    return { mode: 'manual', sceneIndex: null };
  };

  return {
    source: () => 'derived',
    list: () => zoneList,
    get: (zoneId) => derived.get(zoneId)?.zone,
    getState,
    recallScene: (zoneId, index) => {
      const s = derived.get(zoneId)?.scenes[index];
      if (!s) return;
      if (s.central) {
        knx.recallScene(s.central.sceneNumber, s.central.pa);
        return;
      }
      applyZone(zoneId, (c) => Math.round(s.levels[c.id] ?? 0));
    },
    setFull: (zoneId) => applyZone(zoneId, () => 100),
    setNight: (zoneId) => applyZone(zoneId, (c) => (c.dimmable ? 5 : 0)),
    setOff: (zoneId) => applyZone(zoneId, () => 0),
    onStateChanged: subscribe,
    presenceDetectors: () => [],
    switches: () => [],
  };
}

/**
 * Built-in default runtime factory for `mountHouse(house, container)` when
 * `options.createRuntime` is omitted, enabling zero-boilerplate consumer mounts.
 */
export function createDefaultHouseRuntime<TSecurity extends SecurityOverlay3D = SecurityOverlay3D>(
  ctx: MountHouseRuntimeContext<TSecurity>
): MountHouseRuntimeHandle {
  const { scene, knx, annotations, home } = ctx;
  const gatePa = ctx.gatePa ?? '1.1.22';
  const kitchenScenePa = ctx.kitchenScenePa ?? '1.1.10';
  const courtyardSwitchPa = ctx.courtyardSwitchPa ?? '1.1.14';

  const knownCircuits = new Set<string>(knx.getCircuits().map((c) => c.id));
  const isKnownCircuit = (id: string): id is CircuitId => knownCircuits.has(id);
  const levelListeners = new Set<(levels: Readonly<CircuitLevels>) => void>();
  const deviceListeners = new Set<() => void>();
  const disposers: Unsubscribe[] = [];
  const footListeners = new Set<(pos: Vec3Tuple, zoneId: RoomZoneId | null) => void>();
  const FOOT_EMIT_INTERVAL_S = 0.2;
  let footEmitAccum = FOOT_EMIT_INTERVAL_S;
  if (ctx.onWalkthroughPresence) footListeners.add(ctx.onWalkthroughPresence);

  const stepFootPosition = (dtSeconds: number): void => {
    if (footListeners.size === 0 || !scene.isWalkthroughMode()) {
      footEmitAccum = FOOT_EMIT_INTERVAL_S;
      return;
    }
    footEmitAccum += dtSeconds;
    if (footEmitAccum < FOOT_EMIT_INTERVAL_S) return;
    footEmitAccum = 0;
    const foot = scene.getWalkthrough().getFootPosition();
    const pos = toTuple(foot);
    const zoneId = scene.getCurrentRoomId();
    for (const l of [...footListeners]) l(pos, zoneId);
  };

  const emitDevices = (): void => {
    for (const l of [...deviceListeners]) l();
  };
  const emitLevels = (): void => {
    const levels = knx.getLiveLevels();
    for (const l of [...levelListeners]) l(levels);
  };

  const syncDevicesFromKnx = (): void => {
    scene.setCarGatesOpen(knx.isCarGatesOpen());
    scene.setTVArtState(knx.isTvArtModeActive(), knx.getTvArtIndex());
    scene.setMotionSensorStates(knx.getKitchenMotionDetected(), knx.getUtilityMotionDetected());
  };

  disposers.push(
    knx.subscribe((event) => {
      if (event.type !== 'stateChange') return;
      syncDevicesFromKnx();
      scene.applyKNXLightLevels(knx.getLiveLevels());
      emitLevels();
      emitDevices();
    }),
    scene.onDeviceStateChanged(emitDevices)
  );
  const ufh = scene.getUfhSystem();
  if (ufh) disposers.push(ufh.subscribe(emitDevices));

  syncDevicesFromKnx();
  scene.applyKNXLightLevels(knx.getLiveLevels());

  const roomLabel = (zoneId: RoomZoneId): string =>
    home.getManifest(zoneId)?.label ?? home.getZoneName(zoneId) ?? zoneId;

  const floorInfos: readonly TwinFloorInfo[] = [...home.floors]
    .sort((a, b) => a.elevationY - b.elevationY)
    .map((f) => ({
      id: f.id,
      label: f.label ?? floorLabelFromId(f.id),
      elevationY: f.elevationY,
      ...(f.ceilingHeight !== undefined ? { ceilingHeight: f.ceilingHeight } : {}),
    }));
  const propertyName = home.name || scene.getPropertyName() || 'Digital Twin';

  configureShareStateCodec({
    ...(home.roomIds.length > 0 ? { allowedRooms: new Set<string>(home.roomIds) } : {}),
    floors: floorInfos.map((f) => f.id),
  });

  const floorForRoom = (zoneId: RoomZoneId): FloorViewMode => {
    const floor = home.getManifest(zoneId)?.floor;
    if (floor !== undefined && floorInfos.some((f) => f.id === floor)) return floor;
    return floorInfos[0]?.id ?? 'all';
  };

  const toUfhZone = (z: UfhZoneState): TwinUfhZone => {
    const estimate = ufh?.getZoneWarmupEstimate(z.id);
    return {
      id: z.id,
      name: z.name,
      shortName: z.shortName,
      manifoldLabel: z.manifoldLabel,
      roomZones: z.roomZones,
      heatingOn: z.heatingOn,
      targetTempC: z.targetTempC,
      ...(estimate ? { warmupLabel: estimate.formattedDuration } : {}),
    };
  };
  const isUfhZoneId = (id: string): id is UfhZoneId =>
    ufh?.getZones().some((z) => z.id === id) ?? false;

  const viewState = (): TwinViewState => {
    const v = scene.getViewState();
    return {
      cameraPosition: toTuple(v.cameraPosition),
      target: toTuple(v.target),
      isOrthographic: v.isOrthographic,
      orthoZoom: v.orthoZoom,
      floorViewMode: v.floorViewMode,
    };
  };

  const applyLevels = (levels: Readonly<Partial<Record<CircuitId, number>>>): void => {
    for (const c of knx.getCircuits()) {
      const level = levels[c.id];
      if (level !== undefined) knx.setCircuitLevel(c.id, clampPct(level));
    }
  };

  const baseZones = buildDefaultZoneLightingApi(knx, {
    circuits: knx.getCircuits(),
    manifest: home.manifest,
    getManifest: (zoneId) => home.getManifest(zoneId),
    getLevelScenes: (zoneId) => home.getLevelScenes(zoneId),
    roomLabel,
    uiSourcePa: kitchenScenePa,
  });

  const zones: TwinZoneLightingApi = {
    ...baseZones,
    recallScene: (zoneId, index) => {
      playCorstonSwitchSound('scene');
      baseZones.recallScene(zoneId, index);
    },
    setFull: (zoneId) => {
      playCorstonSwitchSound('switch');
      baseZones.setFull(zoneId);
    },
    setNight: (zoneId) => {
      playCorstonSwitchSound('switch');
      baseZones.setNight(zoneId);
    },
    setOff: (zoneId) => {
      playCorstonSwitchSound('switch');
      baseZones.setOff(zoneId);
    },
  };

  const walkState = (): TwinWalkthroughState => {
    const wt = scene.getWalkthrough();
    return {
      active: wt.isActive(),
      prompt: wt.getTargetedPrompt(),
      crouched: wt.isCrouched(),
      pointerLocked: wt.isPointerLocked(),
      fovDeg: wt.getBaseFov(),
    };
  };

  const api: TwinApi = {
    camera: {
      flyToPreset: (preset) => scene.flyToPreset(preset),
      flyToCameraPose: (pose) => scene.flyToCameraPose(pose),
      flyToRoom: (zoneId) => {
        scene.selectRoom(zoneId);
        const bounds = home.getBounds(zoneId);
        if (bounds) scene.flyToRoomBounds(bounds, floorForRoom(zoneId));
      },
      flyToBounds: (bounds, floor) => scene.flyToRoomBounds(bounds, floor),
      recenter: () => scene.recenterView(),
      getPose: () => scene.getCurrentCameraPoseSnapshot(),
      getViewState: viewState,
      onViewChanged: (listener) =>
        scene.onViewChanged((v) =>
          listener({
            cameraPosition: toTuple(v.cameraPosition),
            target: toTuple(v.target),
            isOrthographic: v.isOrthographic,
            orthoZoom: v.orthoZoom,
            floorViewMode: v.floorViewMode,
          })
        ),
      getCompassBearingDeg: () => scene.getCompassBearingDeg(),
      onCompassBearingChanged: (listener) => scene.onCompassBearingChanged(listener),
      onSurfaceDoubleClick: (listener) => scene.onSurfaceDoubleClick((p) => listener(toTuple(p))),
      projectToScreen: (p) => scene.projectToScreen(p[0], p[1], p[2]),
      setSingleFingerPan: (enabled) => scene.setSingleFingerPan(enabled),
      isSingleFingerPan: () => scene.isSingleFingerPan(),
    },

    floors: {
      list: () => floorInfos,
      propertyName: () => propertyName,
      getMode: () => scene.getFloorViewMode(),
      setMode: (mode) => scene.setFloorViewMode(mode),
      isCeilingCutaway: () => scene.isCeilingCutaway(),
      setCeilingCutaway: (cutaway) => {
        if (scene.isCeilingCutaway() !== cutaway) scene.toggleCeilingCutaway();
      },
      toggleCeilingCutaway: () => scene.toggleCeilingCutaway(),
    },

    rooms: {
      getCurrent: () => scene.getCurrentRoomId(),
      onChanged: (listener) => scene.onCurrentRoomChanged(listener),
      select: (zoneId) => scene.selectRoom(zoneId),
      highlight: (zoneId) => scene.highlightRoom(zoneId),
      list: () => home.manifest,
      navTree: () => home.navTree,
      getLevelScenes: (zoneId) => home.getLevelScenes(zoneId),
      isInterior: (zoneId) => home.isInterior(zoneId),
      getManifest: (zoneId) => home.getManifest(zoneId),
      getLabel: roomLabel,
      getBounds: (zoneId) => home.getBounds(zoneId),
      findAt: (point, floorId): TwinRoomHit | null => {
        const room = home.focus.findRoomAt(point[0], point[1], point[2], floorId);
        if (!room) return null;
        return {
          zoneId: room.zoneId,
          label: roomLabel(room.zoneId),
          floorId: room.floorId,
          bounds: room.bounds,
        };
      },
    },

    lighting: {
      zones,
      circuits: () => knx.getCircuits(),
      isKnownCircuit,
      getLiveLevels: () => knx.getLiveLevels(),
      getTargetLevels: () => knx.getTargetLevels(),
      toggleCircuit: (id) => {
        playCorstonSwitchSound('switch');
        knx.toggleCircuit(id);
      },
      setCircuitLevel: (id, pct) => knx.setCircuitLevel(id, clampPct(pct)),
      applyLevels,
      allOff: () => {
        playCorstonSwitchSound('switch');
        const live = knx.getLiveLevels();
        for (const c of knx.getCircuits()) {
          if ((live[c.id] ?? 0) > 0) knx.setCircuitLevel(c.id, 0);
        }
      },
      recallScene: (sceneNumber, pa = kitchenScenePa) => {
        playCorstonSwitchSound('scene');
        knx.recallScene(sceneNumber, pa);
      },
      scenes: () => knx.getScenes(),
      getActiveSceneIndex: () => knx.getActiveSceneIndex(),
      subscribe: (listener) => knx.subscribe(listener),
      onLevelsChanged: (listener) => {
        levelListeners.add(listener);
        return () => {
          levelListeners.delete(listener);
        };
      },
      getTimeOfDay: () => luxToTimeOfDay(knx.getAmbientLux()),
      setTimeOfDay: (tod) => {
        scene.setTimeOfDay(tod);
        if (luxToTimeOfDay(knx.getAmbientLux()) !== tod) {
          knx.setAmbientLux(TIME_OF_DAY_LUX[tod], true);
        }
      },
      getAmbientLux: () => knx.getAmbientLux(),
      setAmbientLux: (lux) => knx.setAmbientLux(lux, true),
      roomMotionSensors: () =>
        knx.getRoomMotionSensors().map((s) => ({
          id: s.id,
          label: s.name,
          occupied: knx.getRoomMotionDetected(s.id),
        })),
      toggleRoomMotion: (id) => knx.toggleRoomMotion(id),
      isRoomNightDimActive: (id) => knx.isRoomNightDimActive(id),
      pressZoneSwitch: (zoneId, direction, longPress = false) => {
        playCorstonSwitchSound('switch');
        const pa = knx
          .getPushButtons()
          .find((b) => b.gangs.some((g) => g.zoneId === zoneId))?.pa;
        const location = `${roomLabel(zoneId)} switch`;
        if (longPress) knx.handleZoneSwitchLongPressHold(zoneId, direction, pa, location);
        else knx.handleZoneSwitchShortPress(zoneId, direction, pa, location);
      },
      getTransport: () => ({ mode: knx.getTransportMode(), status: knx.getTransportStatus() }),
    },

    devices: {
      handleInteractable: (id) => scene.handleInteractableClick(id),
      onChanged: (listener) => {
        deviceListeners.add(listener);
        return () => {
          deviceListeners.delete(listener);
        };
      },
      isGatesOpen: () => knx.isCarGatesOpen(),
      isGatesMoving: () => knx.isCarGatesMoving(),
      getGatesStatusLabel: () => knx.getCarGatesStatusLabel(),
      toggleGates: () => knx.toggleCarGates(gatePa),
      isBifoldsOpen: () => scene.isBifoldsOpen(),
      toggleBifolds: () => scene.toggleBifolds(),
      isTvArtMode: () => knx.isTvArtModeActive(),
      getTvArtTitle: () => knx.getTvArtTitle(),
      cycleTvArt: () => {
        playCorstonSwitchSound('switch');
        knx.cycleTvArt(true, '1.1.12');
      },
      isCourtyardLightOn: () => knx.isCourtyardLightOn(),
      getCourtyardModeLabel: () => knx.getCourtyardModeLabel(),
      pressCourtyardSwitch: () => {
        playCorstonSwitchSound('switch');
        knx.handleCourtyardSwitchShortPress('up', courtyardSwitchPa);
      },
      hasUfh: () => ufh !== null,
      ufhZones: () => (ufh ? ufh.getZones().map(toUfhZone) : []),
      ufhZoneForRoom: (zoneId) => {
        const z = ufh?.getZoneForRoom(zoneId);
        return z ? toUfhZone(z) : undefined;
      },
      toggleUfhZone: (id) => (isUfhZoneId(id) ? scene.toggleUfhZone(id) : false),
      setAllUfhZones: (on) => scene.setAllUfhZones(on),
      isUfhLayerVisible: () => scene.isUfhLayerVisible(),
      setUfhLayerVisible: (visible) => scene.setUfhLayerVisible(visible),
      toggleUfhLayer: () => scene.toggleUfhLayer(),
    },

    graphics: {
      getMode: () => scene.getGraphicsMode(),
      setMode: (mode) => scene.setGraphicsMode(mode),
      getStats: () => scene.getGraphicsStats(),
      onToast: (listener) => scene.onGraphicsToast(listener),
      isSsaoEnabled: () => scene.isSsaoEnabled(),
      setSsaoEnabled: (enabled) => scene.setSsaoEnabled(enabled),
      isFxaaEnabled: () => scene.isFxaaEnabled(),
      setFxaaEnabled: (enabled) => scene.setFxaaEnabled(enabled),
      isMotionBlurEnabled: () => scene.isMotionBlurEnabled(),
      setMotionBlurEnabled: (enabled) => scene.setMotionBlurEnabled(enabled),
    },

    audio: {
      isMuted: () => soundEngine.isMuted(),
      setMuted: (muted) => soundEngine.setMuted(muted),
      toggleMuted: () => soundEngine.toggleMuted(),
      getVolume: () => soundEngine.getMasterVolume(),
      setVolume: (volume) => soundEngine.setMasterVolume(volume),
      isAmbientEnabled: () => soundEngine.isAmbientEnabled(),
      setAmbientEnabled: (enabled) => soundEngine.setAmbientEnabled(enabled),
      isSfxEnabled: () => soundEngine.isSfxEnabled(),
      setSfxEnabled: (enabled) => soundEngine.setSfxEnabled(enabled),
      onChanged: (listener) => soundEngine.onChanged(listener),
    },

    trades: {
      getView: () => scene.getTradeView(),
      setView: (view) => scene.setTradeView(view),
      onChanged: (listener) => scene.onTradeViewChanged(listener),
      exportServiceSchedule: (view) => scene.exportServiceSchedule(view),
    },

    walkthrough: {
      isActive: () => scene.isWalkthroughMode(),
      getState: walkState,
      onStateChanged: (listener) => scene.getWalkthrough().subscribe(() => listener(walkState())),
      interact: () => scene.getWalkthrough().triggerTargetedInteraction(),
      toggleCrouch: () => scene.getWalkthrough().toggleCrouched(),
      jump: () => scene.getWalkthrough().jump(),
      setTouchMove: (strafe, forward, sprint = false) =>
        scene.getWalkthrough().setTouchMoveVector(strafe, forward, sprint),
      setTouchLook: (yaw, pitch) => scene.getWalkthrough().setTouchLookVector(yaw, pitch),
      requestMouseLook: () => scene.getWalkthrough().requestMouseLock(),
      enter: (spawnId) => scene.setWalkthroughMode(true, spawnId),
      exit: () => {
        if (scene.isWalkthroughMode()) scene.setWalkthroughMode(false);
      },
      toggle: (spawnId) => scene.toggleWalkthroughMode(spawnId),
      spawns: () =>
        scene.getWalkthroughSpawns().map((s) => ({ id: s.id, label: s.label, zoneId: s.zoneId })),
      teleport: (spawnId) => scene.getWalkthrough().teleportToSpawn(spawnId),
      onChanged: (listener) => scene.getWalkthrough().subscribe(listener),
      onFootPositionChanged: (listener) => {
        footListeners.add(listener);
        return () => {
          footListeners.delete(listener);
        };
      },
    },

    notes: {
      isActive: () => scene.isAnnotationMode(),
      setActive: (enabled) => scene.setAnnotationMode(enabled),
      toggleActive: () => scene.toggleAnnotationMode(),
      getToolMode: () => scene.getAnnotationToolMode(),
      setToolMode: (tool) => scene.setAnnotationToolMode(tool),
      getGizmoMode: () => scene.getGizmoTransformMode(),
      setGizmoMode: (mode) => scene.setGizmoTransformMode(mode),
      getMeasureAxisSnap: () => scene.getMeasureAxisSnap(),
      setMeasureAxisSnap: (enabled) => scene.setMeasureAxisSnap(enabled),
      cancelMeasurement: () => scene.cancelActiveMeasurement(),
      onPick: (listener) => scene.onAnnotationPick(listener),
      onMarkerSelect: (listener) => scene.onAnnotationMarkerSelect(listener),
      onMeasurePreview: (listener) => scene.onMeasurePreviewChange(listener),
      onMeasureComplete: (listener) =>
        scene.onMeasureComplete((startHit, endHit, snappedEndPoint) =>
          listener({ startHit, endHit, snappedEndPoint })
        ),
      onObjectTransform: (listener) =>
        scene.onObjectTransformChange((baseHit, transform, candidates, commitToStore) =>
          listener({ baseHit, transform, candidates, commitToStore })
        ),
      syncMarkers: (records, selectedId) => scene.syncAnnotationMarkers(records, selectedId),
      reapplyMoves: (records) => scene.reapplySavedMoveAnnotations(records),
      detachGizmo: () => scene.detachMoveGizmo(),
      switchMoveCandidate: (uuid) => scene.switchSelectedMoveCandidate(uuid),
      selectMovedObject: (uuid) => scene.selectMovedObjectByUuid(uuid),
      nudgeSelected: (dx, dy, dz, dRotYDeg, dRotXDeg, dRotZDeg) =>
        scene.nudgeSelectedObject(dx, dy, dz, dRotYDeg, dRotXDeg, dRotZDeg),
      setSelectedDelta: (dx, dy, dz, dRotYDeg, dRotXDeg, dRotZDeg) =>
        scene.setSelectedObjectDeltaTransform(dx, dy, dz, dRotYDeg, dRotXDeg, dRotZDeg),
      resetMovedObject: (uuid) => scene.resetMovedObject(uuid),
      getRecords: () => annotations.getRecords(),
      getSelectedId: () => annotations.getSelectedId(),
      getSelectedRecord: () => annotations.getSelectedRecord(),
      subscribe: (listener) => annotations.subscribe(listener),
      select: (id) => annotations.selectAnnotation(id),
      add: (hit, note) => annotations.addAnnotation(hit, note),
      addMeasure: (startHit, endHit, snappedEndPoint, note) =>
        annotations.addMeasureAnnotation(startHit, endHit, snappedEndPoint, note),
      upsertMove: (baseHit, transform, cameraPose) =>
        annotations.upsertMoveAnnotation(baseHit, transform, cameraPose),
      updateTargetMeasurement: (id, target) => annotations.updateTargetMeasurement(id, target),
      updateNote: (id, note) => annotations.updateNote(id, note),
      remove: (id) => annotations.removeAnnotation(id),
      clearAll: () => annotations.clearAll(),
      formatForAgent: () => annotations.formatForAgent(),
    },

    dev: {
      getLodDiagnostics: () => scene.getLodDiagnostics(),
      getLodPolicyMode: () => scene.getLodPolicyMode(),
      setLodPolicyMode: (mode) => scene.setLodPolicyMode(mode),
      getFocusedRoomShortName: () => scene.getFocusedRoomShortName(),
      isMotionBlurEnabled: () => scene.isMotionBlurEnabled(),
      toggleMotionBlur: () => scene.toggleMotionBlur(),
    },

    sky: {
      getSnapshot: () => scene.getSkyWeatherSnapshot(),
      onChanged: (listener) => scene.onSkyWeatherChanged(listener),
      setSolarDateTime: (input) => scene.setSolarDateTime(input),
      setLiveClockSync: (enabled) => scene.setLiveClockSync(enabled),
      setSeason: (season) => scene.setSeason(season),
      getSeasonSelection: () => scene.getSeasonSelection(),
      setWeatherLiveFeed: (enabled) => scene.setWeatherLiveFeed(enabled),
      refreshLiveWeather: () => scene.refreshLiveWeather(),
      applyWeatherPreset: (preset) => scene.applyWeatherPreset(preset),
      setCloudLayer: (enabled, coverPct) => scene.setWeatherCloudLayer(enabled, coverPct),
      setPrecipitationLayer: (type, intensity) =>
        scene.setWeatherPrecipitationLayer(type, intensity),
      setFogLayer: (enabled, intensity) => scene.setWeatherFogLayer(enabled, intensity),
      beginInteractiveScrub: (holdUntilEnd) => scene.beginInteractiveScrub(holdUntilEnd),
      endInteractiveScrub: () => scene.endInteractiveScrub(),
      isInteractiveScrubbing: () => scene.isInteractiveScrubbing(),
    },

    terrainSculpt: {
      isAvailable: () => scene.terrainSculpt.isAvailable(),
      getSnapshot: () => scene.terrainSculpt.getSnapshot(),
      onChanged: (listener) => scene.terrainSculpt.changed.add(listener),
      isActive: () => scene.terrainSculpt.isActive(),
      setActive: (active) => scene.terrainSculpt.setActive(active),
      toggleActive: () => scene.terrainSculpt.toggleActive(),
      getMode: () => scene.terrainSculpt.getMode(),
      setMode: (mode) => scene.terrainSculpt.setMode(mode),
      getRadiusM: () => scene.terrainSculpt.getRadiusM(),
      setRadiusM: (radiusM) => scene.terrainSculpt.setRadiusM(radiusM),
      getStrength: () => scene.terrainSculpt.getStrength(),
      setStrength: (strength) => scene.terrainSculpt.setStrength(strength),
      getPatchId: () => scene.terrainSculpt.getPatchId(),
      setPatchId: (id) => scene.terrainSculpt.setPatchId(id),
      undo: () => scene.terrainSculpt.undo(),
      reset: () => scene.terrainSculpt.reset(),
      getStamps: () => scene.terrainSculpt.getStamps(),
      formatModifierJson: (idOverride) => scene.terrainSculpt.formatModifierJson(idOverride),
      formatModifierTs: (idOverride) => scene.terrainSculpt.formatModifierTs(idOverride),
    },

    assets: {
      isInspectMode: () => scene.assetInspector.isInspectMode(),
      setInspectMode: (active) => scene.assetInspector.setInspectMode(active),
      toggleInspectMode: () => scene.assetInspector.toggleInspectMode(),
      getInspected: () => {
        const snap = scene.assetInspector.getInspected();
        if (!snap) return null;
        return snap.roomZoneId && !snap.roomLabel
          ? { ...snap, roomLabel: roomLabel(snap.roomZoneId) }
          : snap;
      },
      onChanged: (listener) =>
        scene.assetInspector.changed.add((snap) => {
          if (!snap) {
            listener(null);
            return;
          }
          listener(
            snap.roomZoneId && !snap.roomLabel
              ? { ...snap, roomLabel: roomLabel(snap.roomZoneId) }
              : snap
          );
        }),
      inspectAtClient: (clientX, clientY) => {
        const snap = scene.assetInspector.inspectAtClient(clientX, clientY);
        if (!snap) return null;
        return snap.roomZoneId && !snap.roomLabel
          ? { ...snap, roomLabel: roomLabel(snap.roomZoneId) }
          : snap;
      },
      clear: () => scene.assetInspector.clear(),
      frameInspected: () => scene.assetInspector.frameInspected(),
      triggerAction: (actionId) => scene.assetInspector.triggerAction(actionId),
      playSound: () => scene.assetInspector.playSound(),
    },
  };

  let dimmingActive = false;

  return {
    api,
    tick: (dtSeconds) => {
      const wasDimmingActive = dimmingActive;
      dimmingActive = knx.stepDimming(dtSeconds);
      if (dimmingActive) {
        const stillFading = knx.hasPendingAnimations();
        scene.applyKNXLightLevels(knx.getLiveLevels(), stillFading);
        emitLevels();
      } else if (wasDimmingActive) {
        scene.applyKNXLightLevels(knx.getLiveLevels(), false);
        emitLevels();
      }
      scene.update(dtSeconds);
      stepFootPosition(dtSeconds);
    },
    isActive: () => dimmingActive || knx.hasPendingAnimations() || scene.hasActiveAnimations(),
    isStationaryPrecipitationOnly: () =>
      !dimmingActive && !knx.hasPendingAnimations() && scene.isStationaryPrecipitationOnly(),
    dispose: () => {
      for (const d of disposers.splice(0)) d();
      levelListeners.clear();
      deviceListeners.clear();
      footListeners.clear();
    },
  };
}
