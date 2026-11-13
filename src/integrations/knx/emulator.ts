import type {
  CircuitConfig,
  CircuitId,
  CircuitLevels,
  DeviceParameters,
  InboundKNXFrame,
  KNXBusEvent,
  KNXEventListener,
  KNXTelegram,
  KNXTransportMode,
  KNXTransportStatus,
  RoomMotionSensorId,
  ScenePreset,
  TelegramEmitInput,
  ZoneLightingMode,
} from '../../core/types/knx.ts';
import type { RoomZoneId } from '../../core/types/topology.ts';
import { compileEEPROMBytes } from './addressing.ts';
import {
  buildTP1FrameHex,
  decodeDpt1,
  decodeDpt17Scene,
  decodeDpt18SceneControl,
  decodeDpt5Scaling,
  decodeDpt9Float,
  encodeDpt1,
  encodeDpt17Scene,
  encodeDpt18SceneControl,
  encodeDpt5Scaling,
  encodeDpt9Float,
  parseTP1FrameHex,
} from './dpt-codec.ts';
import type {
  KnxLightingZone,
  KnxPresenceDetectorDevice,
  KnxProject,
  KnxPushButtonDevice,
} from './project.ts';
import { RoomAutomation, type RoomMotionSensorConfig } from './room-automation.ts';
import { OUTDOOR_CIRCUIT_IDS, SCENE_CIRCUIT_IDS } from './scene-table.ts';
import {
  LoopbackSimulationTransport,
  WebSocketKNXGatewayTransport,
  type KNXBusTransport,
} from './transport.ts';
import { ZoneLightingController, type SwitchDirection, type ZoneLevels } from './zone-lighting.ts';
import type { KnxZoneBus } from '../../core/types/knx-zones.ts';

export const TV_ARTWORKS: readonly string[] = [
  'Pastoral Hills Sunset',
  'St Ives Modernist',
  'Botanical Meadow',
  'Nocturne in Blue & Gold',
];

/** Zone mode + active scene as exposed to UI / AI (`sceneIndex` null unless a scene is active). */
export interface KnxZoneStateView {
  readonly mode: ZoneLightingMode;
  readonly sceneIndex: number | null;
}

/** Presence object of one detector. `lastSeenSimSec` null = latched by a manual toggle. */
export interface KnxPresenceState {
  readonly detected: boolean;
  readonly lastSeenSimSec: number | null;
}

/** Central scene index reported while a zone is at full brightness (hold ▲). */
const ACTIVE_SCENE_FULL = 99;
/** Central scene index reported while the open-plan zone is lit but matches no stored scene. */
const ACTIVE_SCENE_CUSTOM = 98;

interface MutablePresence {
  detected: boolean;
  lastSeenSimSec: number | null;
}

type ZoneObject = 'scene' | 'night' | 'full' | 'dim';

/**
 * Generic KNX TP1 / cEMI bus controller & actuator emulator for a {@link KnxProject}.
 *
 * Every lighting zone shares one switch model (see {@link ZoneLightingController}):
 * short ▲/▼ steps the zone's stored scenes, hold ▲ = full, hold ▼ (≥ long-press time) =
 * night mode (3–5 % when dark, off in daylight). Presence detectors keep night zones lit
 * while occupied; once every detector of a night zone has been vacant for its hold time
 * the zone switches fully off, and presence in an off zone after dark restores night mode.
 *
 * Runs either against the in-browser loopback (`LoopbackSimulationTransport`) or a live
 * KNXnet/IP gateway (`WebSocketKNXGatewayTransport`).
 */
export class KNXPropertyBusController implements KnxZoneBus {
  public static readonly TV_ART_CYCLE_INTERVAL_SEC = 8.0;
  public static readonly CAR_GATE_TRAVEL_SEC = 10.0;

  private readonly project: KnxProject;
  private readonly circuitById = new Map<CircuitId, CircuitConfig>();
  private readonly zoneLighting: ZoneLightingController;
  private readonly pushButtonByPa = new Map<string, KnxPushButtonDevice>();
  private readonly detectorByPa = new Map<string, KnxPresenceDetectorDevice>();
  private readonly detectorByGa = new Map<string, KnxPresenceDetectorDevice>();
  private readonly zoneObjectByGa = new Map<
    string,
    { readonly zone: KnxLightingZone; readonly object: ZoneObject }
  >();
  private readonly presence = new Map<string, MutablePresence>();
  private readonly nightEnteredSimSec = new Map<RoomZoneId, number>();

  private transport: KNXBusTransport;
  private unsubscribeTransportRx: (() => void) | null = null;
  private unsubscribeTransportStatus: (() => void) | null = null;

  /** O(1) lookup tables mapping channel GAs (switch / value / status) to circuits. */
  private readonly gaSwitchToCircuit = new Map<string, CircuitConfig>();
  private readonly gaValueToCircuit = new Map<string, CircuitConfig>();
  private readonly gaStatusToCircuit = new Map<string, CircuitConfig>();

  private flashedParams: DeviceParameters = {
    holdThresholdMs: 600,
    shortPressMode: 'cycle3',
    wakeBehavior: 'first',
    rampSpeedSec: 0.9,
    luxThreshold: 100,
  };

  private isDirty = false;

  private readonly scenes: ScenePreset[];
  private activeSceneIndex = 0;
  private lastActiveSceneIndex = 0;

  private carGatesOpen = false;
  private carGatesProgress = 0;
  private carGatesLastNotifiedPct = 0;

  private ambientLux = 38; // Dusk default (< 100 lx threshold)
  private simTimeSec = 0;
  private presenceHoldOverrideSec: number | null = null;

  private tvArtIndex = 0;
  private tvArtSlideTimerSec = 0;

  private readonly targetLevels: CircuitLevels;
  private readonly liveLevels: CircuitLevels;

  /** PIR-driven circuits (wine cellar, cloakroom WC). */
  private readonly roomAutomation: RoomAutomation;

  private telegrams: KNXTelegram[] = [];
  private nextTelegramId = 1;
  private readonly listeners = new Set<KNXEventListener>();

  public constructor(project: KnxProject, initialTransport?: KNXBusTransport) {
    this.project = project;
    this.scenes = project.centralScenes.map((sc) => ({
      ...sc,
      levels: { ...sc.levels },
      ...(sc.outdoorLevels ? { outdoorLevels: { ...sc.outdoorLevels } } : {}),
      ...(sc.auxiliaryLevels ? { auxiliaryLevels: { ...sc.auxiliaryLevels } } : {}),
    }));
    this.zoneLighting = new ZoneLightingController(project.zones);
    this.roomAutomation = new RoomAutomation(project.roomAutomation);

    const initial: Partial<Record<CircuitId, number>> = {};
    for (const circuit of project.circuits) {
      this.circuitById.set(circuit.id, circuit);
      this.gaSwitchToCircuit.set(circuit.gaSwitch, circuit);
      this.gaValueToCircuit.set(circuit.gaValue, circuit);
      this.gaStatusToCircuit.set(circuit.gaStatus, circuit);
      initial[circuit.id] = this.clampForCircuit(circuit.id, circuit.defaultLevel ?? 85);
    }
    const firstScene = this.scenes[0];
    if (firstScene) {
      for (const id of SCENE_CIRCUIT_IDS) {
        initial[id] = firstScene.levels[id];
      }
    }
    for (const rule of project.roomAutomation.motionCircuitRules) {
      initial[rule.circuitId] = rule.onLevel;
    }
    // A project lists every circuit it drives; ids it omits read as undefined (treated as 0).
    this.targetLevels = initial as CircuitLevels;
    this.liveLevels = { ...this.targetLevels };

    for (const button of project.pushButtons) {
      this.pushButtonByPa.set(button.pa, button);
    }
    for (const detector of project.presenceDetectors) {
      this.detectorByPa.set(detector.pa, detector);
      this.detectorByGa.set(detector.gaPresence, detector);
      // Legacy behaviour: kitchen / utility / room PIRs start "occupied" (latched).
      const latchedOn = detector.legacy !== undefined;
      this.presence.set(detector.pa, { detected: latchedOn, lastSeenSimSec: null });
    }
    for (const zone of project.zones) {
      this.zoneObjectByGa.set(zone.ga.scene, { zone, object: 'scene' });
      this.zoneObjectByGa.set(zone.ga.night, { zone, object: 'night' });
      this.zoneObjectByGa.set(zone.ga.full, { zone, object: 'full' });
      this.zoneObjectByGa.set(zone.ga.dim, { zone, object: 'dim' });
      this.syncZoneModeFromLevels(zone.id);
    }
    this.refreshActiveCentralScene();

    this.transport = initialTransport ?? new LoopbackSimulationTransport();
    this.bindTransport(this.transport);
  }

  private bindTransport(nextTransport: KNXBusTransport): void {
    this.unsubscribeTransportRx?.();
    this.unsubscribeTransportStatus?.();
    this.transport = nextTransport;

    this.unsubscribeTransportRx = this.transport.onReceiveFrame((frameOrHex) => {
      this.ingestExternalFrame(frameOrHex);
    });

    this.unsubscribeTransportStatus = this.transport.onStatusChange((status, mode, endpointUrl) => {
      this.notify({
        type: 'transportStatus',
        mode,
        status,
        ...(endpointUrl ? { endpointUrl } : {}),
      });
    });

    void this.transport.connect();
  }

  /** Connects to a live WebSocket KNXnet/IP gateway (e.g. `ws://localhost:8765/knx`). */
  public async connectToGateway(endpointUrl: string): Promise<void> {
    this.transport.disconnect();
    this.bindTransport(new WebSocketKNXGatewayTransport(endpointUrl));
  }

  /** Switches back to the in-browser KNX TP1 simulation transport. */
  public useSimulationTransport(): void {
    this.transport.disconnect();
    this.bindTransport(new LoopbackSimulationTransport());
  }

  public getTransportMode(): KNXTransportMode {
    return this.transport.mode;
  }

  public getTransportStatus(): KNXTransportStatus {
    return this.transport.status;
  }

  public getProject(): KnxProject {
    return this.project;
  }

  public getCircuits(): readonly CircuitConfig[] {
    return this.project.circuits;
  }

  public getZones(): readonly KnxLightingZone[] {
    return this.project.zones;
  }

  public getZone(zoneId: RoomZoneId): KnxLightingZone | undefined {
    return this.zoneLighting.getZone(zoneId);
  }

  public getPushButtons(): readonly KnxPushButtonDevice[] {
    return this.project.pushButtons;
  }

  public getPresenceDetectors(): readonly KnxPresenceDetectorDevice[] {
    return this.project.presenceDetectors;
  }

  public getSimTimeSec(): number {
    return this.simTimeSec;
  }

  public subscribe(fn: KNXEventListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private notify(event: KNXBusEvent): void {
    for (const fn of this.listeners) {
      fn(event);
    }
  }

  private emitTelegram(input: TelegramEmitInput): KNXTelegram {
    const isGroup = input.isGroup ?? true;
    const hex = buildTP1FrameHex(input.src, input.dst, isGroup, input.payloadBytes);

    const now = new Date();
    const timePart = now.toTimeString().split(' ')[0] ?? '00:00:00';
    const timestamp = `${timePart}.${String(now.getMilliseconds()).padStart(3, '0')}`;

    const direction: 'tx' | 'rx' | 'sim' = input.fromExternalBus
      ? 'rx'
      : this.transport.mode === 'websocket-gateway'
        ? 'tx'
        : 'sim';

    const telegram: KNXTelegram = {
      id: this.nextTelegramId++,
      timestamp,
      src: input.src,
      dst: input.dst,
      isGroup,
      apci: input.apci,
      dpt: input.dpt,
      summary: input.summary,
      hex,
      direction,
    };

    this.telegrams.unshift(telegram);
    if (this.telegrams.length > 80) {
      this.telegrams.pop();
    }

    if (!input.fromExternalBus) {
      this.transport.sendTelegram(telegram, input.payloadBytes);
    }

    this.notify({ type: 'telegram', telegram });
    return telegram;
  }

  public getFlashedParams(): Readonly<DeviceParameters> {
    return this.flashedParams;
  }

  public getIsDirty(): boolean {
    return this.isDirty;
  }

  public getScenes(): readonly ScenePreset[] {
    return this.scenes;
  }

  public getActiveSceneIndex(): number {
    return this.activeSceneIndex;
  }

  public getTargetLevels(): Readonly<CircuitLevels> {
    return this.targetLevels;
  }

  public getLiveLevels(): Readonly<CircuitLevels> {
    return this.liveLevels;
  }

  public getTelegrams(): readonly KNXTelegram[] {
    return this.telegrams;
  }

  public clearTelegrams(): void {
    this.telegrams = [];
  }

  public getAmbientLux(): number {
    return this.ambientLux;
  }

  public isBelowLuxThreshold(): boolean {
    return this.ambientLux < this.flashedParams.luxThreshold;
  }

  private isAnyKitchenLightOn(): boolean {
    return SCENE_CIRCUIT_IDS.some((id) => this.targetLevels[id] > 0);
  }

  public isCourtyardLightOn(): boolean {
    return OUTDOOR_CIRCUIT_IDS.some((id) => this.targetLevels[id] > 0);
  }

  public getCourtyardModeLabel(): string {
    const f = this.targetLevels.courtyardFestoons;
    const lp = this.targetLevels.reclaimedLampPost;
    const state = this.getZoneState('courtyard');
    const mode = state.mode === 'scene' ? this.getZoneSceneLabel('courtyard') : state.mode;
    if (f > 0 && lp > 0) return `${mode} · Festoons ${f}% + Lamp Post ${lp}%`;
    if (f > 0) return `${mode} · Festoons ${f}%`;
    if (lp > 0) return `${mode} · Lamp Post ${lp}%`;
    return 'OFF (0%)';
  }

  public getZoneState(zoneId: RoomZoneId): KnxZoneStateView {
    const state = this.zoneLighting.getState(zoneId);
    return { mode: state.mode, sceneIndex: state.mode === 'scene' ? state.sceneIndex : null };
  }

  public getZoneSceneLabel(zoneId: RoomZoneId): string {
    const zone = this.zoneLighting.getZone(zoneId);
    const state = this.zoneLighting.getState(zoneId);
    if (!zone) return '';
    switch (state.mode) {
      case 'scene':
        return zone.scenes[state.sceneIndex]?.label ?? 'Scene';
      case 'full':
        return 'Full';
      case 'night':
        return 'Night';
      case 'manual':
        return 'Custom';
      case 'off':
        return 'Off';
    }
  }

  /** Recalls stored zone scene `sceneIndex` (zone scene object, DPT 17.001). */
  public recallZoneScene(
    zoneId: RoomZoneId,
    sceneIndex: number,
    sourcePa = this.project.centralPa.ipInterface,
    location?: string
  ): void {
    const zone = this.zoneLighting.getZone(zoneId);
    const scene = zone?.scenes[sceneIndex];
    if (!zone || !scene) return;
    this.applyLevels(this.zoneLighting.sceneLevels(zoneId, sceneIndex));
    this.zoneLighting.markScene(zoneId, sceneIndex);
    this.nightEnteredSimSec.delete(zoneId);
    this.syncOverlappingZones(zone);
    this.refreshActiveCentralScene();
    this.emitTelegram({
      src: sourcePa,
      dst: zone.ga.scene,
      isGroup: true,
      apci: 'A_GroupValue_Write',
      dpt: '17.001',
      summary: `${this.prefix(sourcePa, location)}${zone.name} → Scene ${sceneIndex + 1} "${scene.label}"`,
      payloadBytes: encodeDpt17Scene(sceneIndex),
    });
    this.notify({ type: 'stateChange', reason: 'sceneRecall' });
  }

  /** Hold ▲: every zone channel to 100 % (zone full-on object). */
  public setZoneFull(
    zoneId: RoomZoneId,
    sourcePa = this.project.centralPa.ipInterface,
    location?: string
  ): void {
    const zone = this.zoneLighting.getZone(zoneId);
    if (!zone) return;
    this.applyLevels(this.zoneLighting.fullLevels(zoneId));
    this.zoneLighting.markMode(zoneId, 'full');
    this.nightEnteredSimSec.delete(zoneId);
    this.syncOverlappingZones(zone);
    this.refreshActiveCentralScene();
    this.emitTelegram({
      src: sourcePa,
      dst: zone.ga.full,
      isGroup: true,
      apci: 'A_GroupValue_Write',
      dpt: '1.001',
      summary: `${this.prefix(sourcePa, location)}${zone.name} → Full brightness (100%)`,
      payloadBytes: encodeDpt1(true),
    });
    this.notify({ type: 'stateChange', reason: 'masterFull' });
  }

  /**
   * Hold ▼: night mode — the zone's night levels (3–5 %) when dark, all off in daylight.
   * Switches fully off once the zone's detectors have been vacant for the hold time.
   */
  public enterZoneNight(
    zoneId: RoomZoneId,
    sourcePa = this.project.centralPa.ipInterface,
    location?: string
  ): void {
    const zone = this.zoneLighting.getZone(zoneId);
    if (!zone) return;
    const dark = this.isBelowLuxThreshold();
    this.applyLevels(this.zoneLighting.nightLevels(zoneId, dark));
    this.zoneLighting.markMode(zoneId, 'night');
    this.nightEnteredSimSec.set(zoneId, this.simTimeSec);
    this.syncOverlappingZones(zone);
    this.refreshActiveCentralScene();
    const levels = Object.entries(this.zoneLighting.nightLevels(zoneId, dark))
      .filter(([, v]) => (v ?? 0) > 0)
      .map(([id, v]) => `${this.circuitById.get(id as CircuitId)?.shortName ?? id} ${v}%`)
      .join(', ');
    this.emitTelegram({
      src: sourcePa,
      dst: zone.ga.night,
      isGroup: true,
      apci: 'A_GroupValue_Write',
      dpt: '1.001',
      summary: `${this.prefix(sourcePa, location)}${zone.name} → Night mode${
        dark ? (levels ? ` (${levels})` : '') : ` (${this.ambientLux}lx daylight → off)`
      }`,
      payloadBytes: encodeDpt1(true),
    });
    this.notify({ type: 'stateChange', reason: 'masterOff' });
  }

  /** Everything in the zone to 0 % (night-mode vacancy, UI "Off"). */
  public setZoneOff(zoneId: RoomZoneId, sourcePa = this.project.centralPa.ipInterface): void {
    const zone = this.zoneLighting.getZone(zoneId);
    if (!zone) return;
    this.applyLevels(this.zoneLighting.offLevels(zoneId));
    this.zoneLighting.markMode(zoneId, 'off');
    this.nightEnteredSimSec.delete(zoneId);
    this.syncOverlappingZones(zone);
    this.refreshActiveCentralScene();
    const vacancy = this.detectorByPa.has(sourcePa);
    this.emitTelegram({
      src: sourcePa,
      dst: zone.ga.full,
      isGroup: true,
      apci: 'A_GroupValue_Write',
      dpt: '1.001',
      summary: vacancy
        ? `${zone.name} vacant (${this.detectorByPa.get(sourcePa)?.name ?? sourcePa}) → Night mode off (0%)`
        : `${this.prefix(sourcePa)}${zone.name} → Off (0%)`,
      payloadBytes: encodeDpt1(false),
    });
    this.notify({ type: 'stateChange', reason: 'circuitLevel' });
  }

  /** Short ▲ / ▼: next / previous stored zone scene (wraps; wakes from off / night). */
  public handleZoneSwitchShortPress(
    zoneId: RoomZoneId,
    direction: SwitchDirection = 'up',
    sourcePa = this.project.centralPa.ipInterface,
    switchLocation?: string
  ): void {
    const zone = this.zoneLighting.getZone(zoneId);
    if (!zone || zone.scenes.length === 0) return;
    this.notePushButtonPresence(sourcePa);
    const next = this.zoneLighting.nextSceneIndex(zoneId, direction, this.isZoneLit(zoneId));
    this.recallZoneScene(zoneId, next, sourcePa, this.locationTag(switchLocation, direction));
  }

  /** Hold ▲ = full brightness; hold ▼ = night mode. */
  public handleZoneSwitchLongPressHold(
    zoneId: RoomZoneId,
    direction: SwitchDirection = 'down',
    sourcePa = this.project.centralPa.ipInterface,
    switchLocation?: string
  ): void {
    this.notePushButtonPresence(sourcePa);
    const tag = switchLocation ? `${switchLocation} ${direction === 'up' ? '▲' : '▼'} hold` : undefined;
    if (direction === 'up') {
      this.setZoneFull(zoneId, sourcePa, tag);
    } else {
      this.enterZoneNight(zoneId, sourcePa, tag);
    }
  }

  /**
   * One toggle gesture as a push-button interface reports it: presses shorter than the
   * device's long-press time step scenes, longer presses trigger full / night.
   */
  public handleZoneSwitchGesture(
    zoneId: RoomZoneId,
    direction: SwitchDirection,
    pressDurationMs: number,
    sourcePa = this.project.centralPa.ipInterface,
    switchLocation?: string
  ): void {
    const threshold =
      this.pushButtonByPa.get(sourcePa)?.params.longPressMs ?? this.flashedParams.holdThresholdMs;
    if (pressDurationMs >= threshold) {
      this.handleZoneSwitchLongPressHold(zoneId, direction, sourcePa, switchLocation);
    } else {
      this.handleZoneSwitchShortPress(zoneId, direction, sourcePa, switchLocation);
    }
  }

  public getPresenceState(pa: string): KnxPresenceState {
    const p = this.presence.get(pa);
    return p ? { detected: p.detected, lastSeenSimSec: p.lastSeenSimSec } : { detected: false, lastSeenSimSec: null };
  }

  /** Effective hold time of a detector (override → detector parameter → project default). */
  private getPresenceHoldTimeSec(pa?: string): number {
    if (this.presenceHoldOverrideSec !== null) return this.presenceHoldOverrideSec;
    const detector = pa ? this.detectorByPa.get(pa) : undefined;
    return detector?.params.holdTimeSec ?? this.project.defaultPresenceHoldTimeSec;
  }

  /** Overrides every detector's hold time (e.g. 12 s for demos); `null` restores parameters. */
  public setPresenceHoldTimeOverride(seconds: number | null): void {
    this.presenceHoldOverrideSec = seconds === null ? null : Math.max(1, seconds);
    this.notify({ type: 'stateChange', reason: 'sensorChange' });
  }

  /**
   * Movement seen by detector `pa` now (e.g. the walkthrough camera inside its coverage).
   * Re-triggers the hold timer; sends presence ON on the vacant → occupied transition.
   */
  public reportPresence(pa: string): void {
    const p = this.presence.get(pa);
    if (!p) return;
    p.lastSeenSimSec = this.simTimeSec;
    if (!p.detected) {
      this.setPresence(pa, true, true, true);
    }
  }

  /** Sets a detector's presence object (manual toggles latch until toggled again). */
  public setPresence(pa: string, detected: boolean, emitBus = true, fromMovement = false): void {
    const detector = this.detectorByPa.get(pa);
    const p = this.presence.get(pa);
    if (!detector || !p) return;
    const changed = p.detected !== detected;
    p.detected = detected;
    if (!fromMovement) {
      p.lastSeenSimSec = null;
    }
    if (!changed && !detected) return;

    const reaction = changed ? this.applyPresenceReaction(detector, detected) : '';
    this.applyLegacyPresence(detector, detected, changed);

    if (emitBus && changed) {
      this.emitTelegram({
        src: detector.pa,
        dst: detector.gaPresence,
        isGroup: true,
        apci: 'A_GroupValue_Write',
        dpt: '1.018',
        summary: `${detector.name} (${detector.pa}) → ${detected ? 'Presence' : 'Vacant'}${reaction}`,
        payloadBytes: encodeDpt1(detected),
      });
    }
    this.notify({ type: 'stateChange', reason: 'sensorChange' });
  }

  public togglePresence(pa: string): boolean {
    const next = !this.getPresenceState(pa).detected;
    this.setPresence(pa, next);
    return next;
  }

  private isZoneOccupied(zoneId: RoomZoneId): boolean {
    return this.project.presenceDetectors.some(
      (d) => d.zoneId === zoneId && (this.presence.get(d.pa)?.detected ?? false)
    );
  }

  private applyPresenceReaction(detector: KnxPresenceDetectorDevice, detected: boolean): string {
    const zoneId = detector.zoneId;
    const state = this.zoneLighting.getState(zoneId);
    if (detected) {
      if (state.mode === 'off' && this.isBelowLuxThreshold()) {
        this.applyLevels(this.zoneLighting.nightLevels(zoneId, true));
        this.zoneLighting.markMode(zoneId, 'night');
        this.nightEnteredSimSec.set(zoneId, this.simTimeSec);
        this.refreshActiveCentralScene();
        return ' → night mode restored';
      }
      return '';
    }
    if (state.mode === 'night' && !this.isZoneOccupied(zoneId)) {
      this.applyLevels(this.zoneLighting.offLevels(zoneId));
      this.zoneLighting.markMode(zoneId, 'off');
      this.nightEnteredSimSec.delete(zoneId);
      this.refreshActiveCentralScene();
      return ' → night mode off (0%)';
    }
    return '';
  }

  private applyLegacyPresence(
    detector: KnxPresenceDetectorDevice,
    detected: boolean,
    changed: boolean
  ): void {
    const legacy = detector.legacy;
    if (!legacy) return;
    if (legacy.kind === 'kitchen') {
      this.tvArtSlideTimerSec = 0;
      if (detected && changed) {
        this.tvArtIndex = (this.tvArtIndex + 1) % TV_ARTWORKS.length;
      }
    } else if (legacy.kind === 'room') {
      this.roomAutomation.setMotionDetected(legacy.sensorId, detected);
      this.applyLevels(this.roomAutomation.computeMotionCircuitLevels(legacy.sensorId));
    }
  }

  private notePushButtonPresence(sourcePa: string): void {
    const button = this.pushButtonByPa.get(sourcePa);
    if (!button) return;
    for (const detector of this.project.presenceDetectors) {
      if (detector.zoneId === button.mountedInZoneId) {
        const p = this.presence.get(detector.pa);
        if (p && (p.detected ? p.lastSeenSimSec !== null : true)) {
          this.reportPresence(detector.pa);
        }
      }
    }
  }

  private legacyDetector(kind: 'kitchen' | 'utility'): KnxPresenceDetectorDevice | undefined {
    return this.project.presenceDetectors.find((d) => d.legacy?.kind === kind);
  }

  private roomDetector(sensorId: RoomMotionSensorId): KnxPresenceDetectorDevice | undefined {
    return this.project.presenceDetectors.find(
      (d) => d.legacy?.kind === 'room' && d.legacy.sensorId === sensorId
    );
  }

  public getKitchenMotionDetected(): boolean {
    const d = this.legacyDetector('kitchen');
    return d ? this.getPresenceState(d.pa).detected : false;
  }

  public getUtilityMotionDetected(): boolean {
    const d = this.legacyDetector('utility');
    return d ? this.getPresenceState(d.pa).detected : false;
  }

  public setKitchenMotionDetected(detected: boolean): void {
    const d = this.legacyDetector('kitchen');
    if (d) this.setPresence(d.pa, detected);
  }

  public setUtilityMotionDetected(detected: boolean): void {
    const d = this.legacyDetector('utility');
    if (d) this.setPresence(d.pa, detected);
  }

  public toggleKitchenMotion(): boolean {
    this.setKitchenMotionDetected(!this.getKitchenMotionDetected());
    return this.getKitchenMotionDetected();
  }

  public toggleUtilityMotion(): boolean {
    this.setUtilityMotionDetected(!this.getUtilityMotionDetected());
    return this.getUtilityMotionDetected();
  }

  private isUtilitySwitchOn(): boolean {
    const mode = this.zoneLighting.getState('utility').mode;
    return mode === 'scene' || mode === 'full' || mode === 'manual';
  }

  /** True when a zone containing `circuitId` idles in night mode with the circuit lit. */
  public isRoomNightDimActive(circuitId: CircuitId): boolean {
    return (
      this.targetLevels[circuitId] > 0 &&
      this.zoneLighting
        .zonesForCircuit(circuitId)
        .some((z) => this.zoneLighting.getState(z.id).mode === 'night')
    );
  }

  public getRoomMotionSensors(): readonly RoomMotionSensorConfig[] {
    return this.roomAutomation.getMotionSensors();
  }

  public getRoomMotionDetected(sensorId: RoomMotionSensorId): boolean {
    return this.roomAutomation.isMotionDetected(sensorId);
  }

  public setRoomMotionDetected(sensorId: RoomMotionSensorId, detected: boolean, emitBus = true): void {
    const d = this.roomDetector(sensorId);
    if (d) {
      this.setPresence(d.pa, detected, emitBus);
      return;
    }
    this.roomAutomation.setMotionDetected(sensorId, detected);
    this.applyLevels(this.roomAutomation.computeMotionCircuitLevels(sensorId));
    this.notify({ type: 'stateChange', reason: 'sensorChange' });
  }

  public toggleRoomMotion(sensorId: RoomMotionSensorId): boolean {
    const next = !this.roomAutomation.isMotionDetected(sensorId);
    this.setRoomMotionDetected(sensorId, next);
    return next;
  }

  /** Legacy kitchen toggle short press (kitchen zone). */
  public handleSwitchShortPress(direction: SwitchDirection = 'up', switchLocation?: string): void {
    this.handleZoneSwitchShortPress(
      'kitchen',
      direction,
      this.project.centralPa.kitchenSwitchGroup,
      switchLocation
    );
  }

  /** Legacy kitchen hold ▲: open-plan kitchen + sitting area full. */
  public handleSwitchLongPressHoldUp(
    switchLocation?: string,
    sourcePa = this.project.centralPa.kitchenSwitchGroup
  ): void {
    this.handleZoneSwitchLongPressHold('kitchen', 'up', sourcePa, switchLocation);
    this.setZoneFull('sitting', sourcePa, switchLocation);
    this.activeSceneIndex = ACTIVE_SCENE_FULL;
  }

  /** Central master-off object (hold ▼): places every registered zone into night mode. */
  public handleSwitchLongPressHoldDown(
    switchLocation?: string,
    sourcePa = this.project.centralPa.kitchenSwitchGroup
  ): void {
    if (this.activeSceneIndex >= 0 && this.activeSceneIndex <= 2) {
      this.lastActiveSceneIndex = this.activeSceneIndex;
    }
    for (const zone of this.project.zones) {
      this.enterZoneNightSilently(zone.id);
    }
    this.refreshActiveCentralScene();
    const loc = switchLocation
      ? sourcePa === this.project.centralPa.aiBridge
        ? switchLocation
        : `Switch (${switchLocation} ▼ Hold)`
      : 'Hold ▼ Down';
    this.emitTelegram({
      src: sourcePa,
      dst: this.project.centralGa.masterOff,
      isGroup: true,
      apci: 'A_GroupValue_Write',
      dpt: '1.001',
      summary: `${loc} → All zones OFF → night mode${
        this.isBelowLuxThreshold() ? '' : ` (${this.ambientLux}lx daylight → off)`
      }`,
      payloadBytes: encodeDpt1(false),
    });
    this.notify({ type: 'stateChange', reason: 'masterOff' });
  }

  public handleCourtyardSwitchShortPress(
    direction: SwitchDirection = 'up',
    sourcePa = this.project.centralPa.courtyardSwitch
  ): void {
    this.handleZoneSwitchShortPress('courtyard', direction, sourcePa, 'Courtyard');
  }

  public handleCourtyardSwitchLongPressHoldUp(sourcePa = this.project.centralPa.courtyardSwitch): void {
    this.handleZoneSwitchLongPressHold('courtyard', 'up', sourcePa, 'Courtyard');
  }

  public handleCourtyardSwitchLongPressHoldDown(
    sourcePa = this.project.centralPa.courtyardSwitch
  ): void {
    this.handleZoneSwitchLongPressHold('courtyard', 'down', sourcePa, 'Courtyard');
  }

  /** Legacy utility toggle: lit → night mode, otherwise → first utility scene. */
  public handleUtilitySwitchToggle(sourcePa = this.project.centralPa.utilitySwitch): void {
    this.notePushButtonPresence(sourcePa);
    if (this.isUtilitySwitchOn()) {
      this.enterZoneNight('utility', sourcePa, 'Utility');
    } else {
      this.recallZoneScene('utility', 0, sourcePa, 'Utility');
    }
  }

  private enterZoneNightSilently(zoneId: RoomZoneId): void {
    this.applyLevels(this.zoneLighting.nightLevels(zoneId, this.isBelowLuxThreshold()));
    this.zoneLighting.markMode(zoneId, 'night');
    this.nightEnteredSimSec.set(zoneId, this.simTimeSec);
  }

  public isTvArtModeActive(): boolean {
    return this.getKitchenMotionDetected();
  }

  public getTvArtIndex(): number {
    return this.tvArtIndex;
  }

  public getTvArtTitle(): string {
    return TV_ARTWORKS[this.tvArtIndex] ?? TV_ARTWORKS[0] ?? '';
  }

  public cycleTvArt(emitBus = true, sourcePa = this.project.centralPa.kitchenPresence): void {
    if (!this.getKitchenMotionDetected()) {
      // Interacting with the TV while the room is marked vacant means someone is there.
      this.setKitchenMotionDetected(true);
      return;
    }
    this.tvArtIndex = (this.tvArtIndex + 1) % TV_ARTWORKS.length;
    this.tvArtSlideTimerSec = 0;
    if (emitBus) this.emitTvArt(sourcePa);
    this.notify({ type: 'stateChange', reason: 'sensorChange' });
  }

  public setTvArtIndex(index: number, emitBus = true, sourcePa = this.project.centralPa.aiBridge): void {
    const count = TV_ARTWORKS.length;
    this.tvArtIndex = ((index % count) + count) % count;
    this.tvArtSlideTimerSec = 0;
    if (!this.getKitchenMotionDetected()) {
      const d = this.legacyDetector('kitchen');
      const p = d ? this.presence.get(d.pa) : undefined;
      if (p) p.detected = true;
    }
    if (emitBus) this.emitTvArt(sourcePa);
    this.notify({ type: 'stateChange', reason: 'sensorChange' });
  }

  private emitTvArt(sourcePa: string): void {
    this.emitTelegram({
      src: sourcePa,
      dst: this.project.centralGa.tvArt,
      isGroup: true,
      apci: 'A_GroupValue_Write',
      dpt: '17.001',
      summary: `Frame TV Art Mode → Art ${this.tvArtIndex + 1}/${TV_ARTWORKS.length}: "${this.getTvArtTitle()}"`,
      payloadBytes: encodeDpt17Scene(this.tvArtIndex),
    });
  }

  public isCarGatesOpen(): boolean {
    return this.carGatesOpen;
  }

  public getCarGatesProgress(): number {
    return this.carGatesProgress;
  }

  public isCarGatesMoving(): boolean {
    const target = this.carGatesOpen ? 1 : 0;
    return Math.abs(target - this.carGatesProgress) > 0.001;
  }

  public getCarGatesStatusLabel(): string {
    const pct = Math.round(this.carGatesProgress * 100);
    if (this.isCarGatesMoving()) {
      return this.carGatesOpen ? `OPENING · ${pct}% (10s)` : `CLOSING · ${pct}% (10s)`;
    }
    return this.carGatesOpen ? 'OPEN · 100%' : 'CLOSED · 0%';
  }

  public setCarGatesOpen(open: boolean, emitBus = true, sourcePa = this.project.centralPa.carGates): boolean {
    this.carGatesOpen = open;
    if (emitBus) {
      const prefix = sourcePa === this.project.centralPa.aiBridge ? 'AI Gateway → ' : '';
      this.emitTelegram({
        src: sourcePa,
        dst: this.project.centralGa.carGatesCommand,
        isGroup: true,
        apci: 'A_GroupValue_Write',
        dpt: '1.001',
        summary: `${prefix}Front Car Gates (Dual-Leaf) → ${
          open ? 'OPENING (10.0s travel)' : 'CLOSING (10.0s travel)'
        }`,
        payloadBytes: encodeDpt1(open),
      });
    }
    this.notify({ type: 'stateChange', reason: 'carGateChange' });
    return this.carGatesOpen;
  }

  public toggleCarGates(sourcePa = this.project.centralPa.carGates): boolean {
    return this.setCarGatesOpen(!this.carGatesOpen, true, sourcePa);
  }

  public setAmbientLux(lux: number, emitBus = true): void {
    const wasDark = this.isBelowLuxThreshold();
    this.ambientLux = Math.max(0, Math.round(lux));
    const dark = this.isBelowLuxThreshold();
    if (dark !== wasDark) {
      // Night objects follow daylight: dim when dark, off in daylight.
      for (const zone of this.project.zones) {
        if (this.zoneLighting.getState(zone.id).mode === 'night') {
          this.applyLevels(this.zoneLighting.nightLevels(zone.id, dark));
        }
      }
    }
    if (emitBus) {
      this.emitTelegram({
        src: this.project.centralPa.kitchenPresence,
        dst: this.project.centralGa.ambientLux,
        isGroup: true,
        apci: 'A_GroupValue_Write',
        dpt: '9.004',
        summary: `Lux Sensor → ${this.ambientLux} lx (${
          dark
            ? `< ${this.flashedParams.luxThreshold}lx · night mode dims`
            : `≥ ${this.flashedParams.luxThreshold}lx · night mode off`
        })`,
        payloadBytes: encodeDpt9Float(this.ambientLux),
      });
    }
    this.notify({ type: 'stateChange', reason: 'sensorChange' });
  }

  public recallScene(sceneIdx: number, sourcePa = this.project.centralPa.kitchenSwitchGroup, switchLocation?: string): void {
    const scene = this.scenes[sceneIdx];
    if (!scene) return;
    this.applyCentralScene(scene);
    this.activeSceneIndex = sceneIdx;
    if (sceneIdx >= 0 && sceneIdx <= 2) {
      this.lastActiveSceneIndex = sceneIdx;
    }
    const locPrefix = switchLocation
      ? sourcePa === this.project.centralPa.aiBridge
        ? `${switchLocation} → `
        : `Switch (${switchLocation}) → `
      : '';
    const sceneTierTag = scene.isSwitchScene ? '' : ' [Extended AI/UI Scene]';
    this.emitTelegram({
      src: sourcePa,
      dst: this.project.centralGa.centralScene,
      isGroup: true,
      apci: 'A_GroupValue_Write',
      dpt: '17.001',
      summary: `${locPrefix}Recall ${scene.code}: "${scene.name}"${sceneTierTag}`,
      payloadBytes: encodeDpt17Scene(sceneIdx),
    });
    this.notify({ type: 'stateChange', reason: 'sceneRecall' });
  }

  private applyCentralScene(scene: ScenePreset): void {
    const levels: ZoneLevels = {};
    for (const id of SCENE_CIRCUIT_IDS) {
      levels[id] = scene.levels[id];
    }
    if (scene.outdoorLevels) {
      levels.courtyardFestoons = scene.outdoorLevels.courtyardFestoons;
      levels.reclaimedLampPost = scene.outdoorLevels.reclaimedLampPost;
    }
    if (scene.auxiliaryLevels) {
      for (const [id, v] of Object.entries(scene.auxiliaryLevels)) {
        if (typeof v === 'number') levels[id as CircuitId] = v;
      }
    }
    this.applyLevels(levels);
    for (const id of Object.keys(levels) as CircuitId[]) {
      for (const zone of this.zoneLighting.zonesForCircuit(id)) {
        this.nightEnteredSimSec.delete(zone.id);
        this.syncZoneModeFromLevels(zone.id);
      }
    }
  }

  public saveCurrentLevelsToActiveScene(
    targetSceneIdx?: number,
    sourcePa = this.project.centralPa.ipInterface
  ): void {
    const idx =
      targetSceneIdx !== undefined
        ? targetSceneIdx
        : this.activeSceneIndex >= 0 && this.activeSceneIndex <= 7
          ? this.activeSceneIndex
          : this.lastActiveSceneIndex;
    const scene = this.scenes[idx];
    if (!scene) return;

    for (const id of SCENE_CIRCUIT_IDS) {
      scene.levels[id] = this.targetLevels[id];
    }
    scene.outdoorLevels = {
      courtyardFestoons: this.targetLevels.courtyardFestoons,
      reclaimedLampPost: this.targetLevels.reclaimedLampPost,
    };
    scene.auxiliaryLevels = {
      utilitySpotlights: this.targetLevels.utilitySpotlights,
      familyRoomSpots: this.targetLevels.familyRoomSpots,
    };
    this.isDirty = true;

    this.emitTelegram({
      src: sourcePa,
      dst: this.project.centralGa.centralScene,
      isGroup: true,
      apci: 'A_GroupValue_Write',
      dpt: '18.001',
      summary: `Store Scene ${scene.number} ("${scene.name}") into Actuator ${this.project.centralPa.kitchenActuator}`,
      payloadBytes: encodeDpt18SceneControl(idx, true),
    });
    this.notify({ type: 'eepromChanged' });
  }

  public setCircuitLevel(
    circuitId: CircuitId,
    pct: number,
    emitBus = true,
    sourcePa = this.project.centralPa.ipInterface,
    switchLocation?: string
  ): void {
    const level = this.clampForCircuit(circuitId, pct);
    this.targetLevels[circuitId] = level;
    this.roomAutomation.noteManualLevel(circuitId, level);
    for (const zone of this.zoneLighting.zonesForCircuit(circuitId)) {
      this.zoneLighting.noteManual(zone.id, this.isZoneLit(zone.id));
      this.nightEnteredSimSec.delete(zone.id);
    }
    this.refreshActiveCentralScene();

    const circuit = this.circuitById.get(circuitId);
    if (circuit && emitBus) {
      const prefix =
        sourcePa === this.project.centralPa.aiBridge
          ? 'AI Gateway → '
          : switchLocation
            ? `Switch (${switchLocation}) → `
            : '';
      this.emitTelegram({
        src: sourcePa,
        dst: circuit.gaValue,
        isGroup: true,
        apci: 'A_GroupValue_Write',
        dpt: '5.001',
        summary: `${prefix}${circuit.shortName} → ${level}%`,
        payloadBytes: encodeDpt5Scaling(level),
      });
    }
    this.notify({ type: 'stateChange', reason: 'circuitLevel' });
  }

  /** On ↔ off for one channel; "on" restores the zone's current scene level (or default). */
  public toggleCircuit(
    circuitId: CircuitId,
    sourcePa?: string,
    switchLocation?: string,
    direction?: SwitchDirection
  ): void {
    const circuit = this.circuitById.get(circuitId);
    if (!circuit) return;
    const resolvedPa = sourcePa ?? this.defaultSwitchPaForZone(circuit.zoneId);
    if (resolvedPa) this.notePushButtonPresence(resolvedPa);
    const locLabel =
      switchLocation && direction
        ? `${switchLocation} ${direction === 'up' ? '▲' : '▼'}`
        : switchLocation;
    const current = this.targetLevels[circuitId];
    if (current > 0) {
      this.setCircuitLevel(circuitId, 0, true, resolvedPa, locLabel);
      return;
    }
    this.setCircuitLevel(circuitId, this.restoreLevel(circuit), true, resolvedPa, locLabel);
  }

  private restoreLevel(circuit: CircuitConfig): number {
    for (const zone of this.zoneLighting.zonesForCircuit(circuit.id)) {
      const state = this.zoneLighting.getState(zone.id);
      const v = zone.scenes[state.sceneIndex]?.levels[circuit.id] ?? zone.scenes[0]?.levels[circuit.id];
      if (v !== undefined && v > 0) return v;
    }
    const d = circuit.defaultLevel ?? 85;
    return d > 0 ? d : 85;
  }

  private defaultSwitchPaForZone(zoneId: RoomZoneId): string {
    const button =
      this.project.pushButtons.find((b) => b.mountedInZoneId === zoneId && b.gangs.some((g) => g.zoneId === zoneId)) ??
      this.project.pushButtons.find((b) => b.gangs.some((g) => g.zoneId === zoneId));
    return button?.pa ?? this.project.centralPa.ipInterface;
  }

  /**
   * Ingests a raw KNX TP1/cEMI hex frame or structured frame received from the physical bus
   * (or injected via developer tools) and updates the twin's live state.
   */
  public ingestExternalFrame(frameOrHex: string | InboundKNXFrame): void {
    let src = this.project.centralPa.ipInterface;
    let dst = '';
    let isGroup = true;
    let apci = 'A_GroupValue_Write';
    let payloadBytes: readonly number[] = [0x00, 0x80];
    let dptHint: string | undefined;
    let summaryHint: string | undefined;

    if (typeof frameOrHex === 'string') {
      const parsed = parseTP1FrameHex(frameOrHex);
      if (!parsed) return;
      src = parsed.src;
      dst = parsed.dst;
      isGroup = parsed.isGroup;
      apci = parsed.apci;
      payloadBytes = parsed.payloadBytes;
    } else {
      src = frameOrHex.src ?? src;
      dst = frameOrHex.dst;
      isGroup = frameOrHex.isGroup ?? true;
      apci = frameOrHex.apci ?? 'A_GroupValue_Write';
      payloadBytes = frameOrHex.payloadBytes ?? [0x00, 0x80];
      dptHint = frameOrHex.dpt;
      summaryHint = frameOrHex.summary;
    }

    const rx = (dpt: string, summary: string): void => {
      this.emitTelegram({
        src,
        dst,
        isGroup,
        apci,
        dpt: dptHint ?? dpt,
        summary: summaryHint ?? `[RX Bus] ${summary}`,
        payloadBytes,
        fromExternalBus: true,
      });
      this.notify({ type: 'stateChange', reason: 'externalBusSync' });
    };

    if (!isGroup) {
      this.emitTelegram({
        src,
        dst,
        isGroup: false,
        apci,
        dpt: dptHint ?? 'Mgmt',
        summary: summaryHint ?? `External P2P Frame (${apci})`,
        payloadBytes,
        fromExternalBus: true,
      });
      return;
    }

    const valCircuit = this.gaValueToCircuit.get(dst) ?? this.gaStatusToCircuit.get(dst);
    if (valCircuit) {
      const pct = decodeDpt5Scaling(payloadBytes);
      this.setCircuitLevel(valCircuit.id, pct, false);
      rx('5.001', `${valCircuit.shortName} → ${pct}%`);
      return;
    }

    const swCircuit = this.gaSwitchToCircuit.get(dst);
    if (swCircuit) {
      const isOn = decodeDpt1(payloadBytes);
      this.setCircuitLevel(swCircuit.id, isOn ? 100 : 0, false);
      rx('1.001', `${swCircuit.shortName} Switch → ${isOn ? 'ON' : 'OFF'}`);
      return;
    }

    const zoneObject = this.zoneObjectByGa.get(dst);
    if (zoneObject) {
      const { zone, object } = zoneObject;
      if (object === 'scene') {
        const { store, sceneIndex } = decodeDpt18SceneControl(payloadBytes);
        if (!store && zone.scenes[sceneIndex]) {
          this.applyLevels(this.zoneLighting.sceneLevels(zone.id, sceneIndex));
          this.zoneLighting.markScene(zone.id, sceneIndex);
          this.nightEnteredSimSec.delete(zone.id);
        }
        rx('17.001', `${zone.name} scene ${sceneIndex + 1}`);
      } else if (object === 'full') {
        const on = decodeDpt1(payloadBytes);
        this.applyLevels(on ? this.zoneLighting.fullLevels(zone.id) : this.zoneLighting.offLevels(zone.id));
        this.zoneLighting.markMode(zone.id, on ? 'full' : 'off');
        this.nightEnteredSimSec.delete(zone.id);
        rx('1.001', `${zone.name} ${on ? 'full' : 'off'}`);
      } else if (object === 'night') {
        if (decodeDpt1(payloadBytes)) this.enterZoneNightSilently(zone.id);
        rx('1.001', `${zone.name} night mode`);
      } else {
        rx('3.007', `${zone.name} relative dim`);
      }
      this.refreshActiveCentralScene();
      return;
    }

    const detector = this.detectorByGa.get(dst);
    if (detector) {
      const detected = decodeDpt1(payloadBytes);
      this.setPresence(detector.pa, detected, false);
      rx('1.018', `${detector.name} → ${detected ? 'Presence' : 'Vacant'}`);
      return;
    }

    const ga = this.project.centralGa;
    if (dst === ga.masterOff) {
      for (const zone of this.project.zones) {
        this.enterZoneNightSilently(zone.id);
      }
      this.refreshActiveCentralScene();
      rx('1.001', 'Master Off → night mode');
      return;
    }
    if (dst === ga.centralScene) {
      const { store, sceneIndex } = decodeDpt18SceneControl(payloadBytes);
      if (store) {
        this.saveCurrentLevelsToActiveScene(sceneIndex, src);
        return;
      }
      const scene = this.scenes[sceneIndex];
      if (scene) {
        this.applyCentralScene(scene);
        this.activeSceneIndex = sceneIndex;
        rx('17.001', `Recall ${scene.code}: "${scene.name}"`);
      }
      return;
    }
    if (dst === ga.masterFull) {
      this.applyLevels(this.zoneLighting.fullLevels('kitchen'));
      this.zoneLighting.markMode('kitchen', 'full');
      this.activeSceneIndex = ACTIVE_SCENE_FULL;
      rx('5.001', 'Master Full On (100%)');
      return;
    }
    if (dst === ga.ambientLux) {
      this.setAmbientLux(decodeDpt9Float(payloadBytes), false);
      rx('9.004', `Ambient Lux → ${this.ambientLux} lx`);
      return;
    }
    if (dst === ga.tvArt) {
      this.tvArtIndex = decodeDpt17Scene(payloadBytes) % TV_ARTWORKS.length;
      rx('17.001', `Frame TV Art → "${this.getTvArtTitle()}"`);
      return;
    }
    if (dst === ga.carGatesCommand) {
      this.carGatesOpen = decodeDpt1(payloadBytes);
      rx('1.001', `Front Car Gates → ${this.carGatesOpen ? 'OPENING' : 'CLOSING'}`);
      return;
    }
    if (dst === ga.carGatesPosition) {
      const pct = decodeDpt5Scaling(payloadBytes);
      this.carGatesOpen = pct >= 50;
      rx('5.001', `Front Car Gates Position → ${pct}%`);
    }
  }

  public compileEEPROMImage(_useStaged = true): Uint8Array {
    return compileEEPROMBytes(this.flashedParams, this.scenes);
  }

  /** True while any soft-dim channel ramp or motorized car-gate travel has not yet reached its target. */
  public hasPendingAnimations(): boolean {
    const gateTarget = this.carGatesOpen ? 1 : 0;
    if (this.carGatesProgress !== gateTarget) return true;
    for (const c of this.project.circuits) {
      if (Math.abs((this.targetLevels[c.id] ?? 0) - (this.liveLevels[c.id] ?? 0)) > 1e-4) {
        return true;
      }
    }
    return false;
  }

  /** Advances sim time: presence hold timers, TV art, gate travel and channel soft-dim ramps. */
  public stepDimming(dtSeconds: number): boolean {
    const dt = Number.isFinite(dtSeconds) ? Math.max(0, dtSeconds) : 0;
    if (dt <= 0) {
      return false;
    }

    this.simTimeSec += dt;
    this.stepPresence();

    if (this.getKitchenMotionDetected()) {
      this.tvArtSlideTimerSec += dt;
      if (this.tvArtSlideTimerSec >= KNXPropertyBusController.TV_ART_CYCLE_INTERVAL_SEC) {
        this.tvArtSlideTimerSec = 0;
        this.cycleTvArt(true, this.project.centralPa.kitchenPresence);
      }
    }

    const gateTarget = this.carGatesOpen ? 1 : 0;
    if (this.carGatesProgress !== gateTarget) {
      const gateStep = dt / KNXPropertyBusController.CAR_GATE_TRAVEL_SEC;
      if (this.carGatesProgress < gateTarget) {
        this.carGatesProgress = Math.min(1, this.carGatesProgress + gateStep);
      } else {
        this.carGatesProgress = Math.max(0, this.carGatesProgress - gateStep);
      }
      const pct = Math.round(this.carGatesProgress * 100);
      if (this.carGatesProgress === gateTarget) {
        this.carGatesLastNotifiedPct = pct;
        this.emitTelegram({
          src: this.project.centralPa.carGates,
          dst: this.project.centralGa.carGatesPosition,
          isGroup: true,
          apci: 'A_GroupValue_Write',
          dpt: '5.001',
          summary: `Front Car Gates Status → ${pct}% (${this.carGatesOpen ? 'FULLY OPEN' : 'FULLY CLOSED'})`,
          payloadBytes: encodeDpt5Scaling(pct),
        });
        this.notify({ type: 'stateChange', reason: 'carGateChange' });
      } else if (Math.abs(pct - this.carGatesLastNotifiedPct) >= 5) {
        this.carGatesLastNotifiedPct = pct;
        this.notify({ type: 'stateChange', reason: 'carGateChange' });
      }
    }

    const ramp = Math.max(0.15, this.flashedParams.rampSpeedSec);
    const rate = (100 / ramp) * dt;
    let changed = false;
    for (const c of this.project.circuits) {
      const target = Math.max(0, Math.min(100, this.targetLevels[c.id] ?? 0));
      const rawCurrent = this.liveLevels[c.id] ?? 0;
      const current = Number.isFinite(rawCurrent) ? Math.max(0, Math.min(100, rawCurrent)) : target;
      if (Math.abs(target - current) > 0.05) {
        const next = current < target ? Math.min(target, current + rate) : Math.max(target, current - rate);
        this.liveLevels[c.id] = Math.max(0, Math.min(100, next));
        changed = true;
      } else if (current !== target || rawCurrent !== target) {
        this.liveLevels[c.id] = target;
        changed = true;
      }
    }
    return changed;
  }

  private stepPresence(): void {
    for (const detector of this.project.presenceDetectors) {
      const p = this.presence.get(detector.pa);
      if (!p || !p.detected || p.lastSeenSimSec === null) continue;
      if (this.simTimeSec - p.lastSeenSimSec >= this.getPresenceHoldTimeSec(detector.pa)) {
        this.setPresence(detector.pa, false, true, true);
      }
    }
    // Night zones entered while nobody is detected switch off after the hold time.
    for (const [zoneId, since] of this.nightEnteredSimSec) {
      if (this.zoneLighting.getState(zoneId).mode !== 'night') {
        this.nightEnteredSimSec.delete(zoneId);
        continue;
      }
      if (this.isZoneOccupied(zoneId)) continue;
      const hasDetector = this.project.presenceDetectors.some((d) => d.zoneId === zoneId);
      if (!hasDetector) continue;
      if (this.simTimeSec - since >= this.getPresenceHoldTimeSec()) {
        const zone = this.zoneLighting.getZone(zoneId);
        const detector = this.project.presenceDetectors.find((d) => d.zoneId === zoneId);
        if (zone && detector) this.setZoneOff(zoneId, detector.pa);
      }
    }
  }

  private clampForCircuit(circuitId: CircuitId, pct: number): number {
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    const circuit = this.circuitById.get(circuitId);
    // Switched-only channels (relays): any level > 0 means fully on.
    if (circuit?.dimmable === false && clamped > 0) return 100;
    return clamped;
  }

  private applyLevels(levels: ZoneLevels): void {
    for (const [id, v] of Object.entries(levels)) {
      if (typeof v === 'number' && this.circuitById.has(id as CircuitId)) {
        this.targetLevels[id as CircuitId] = this.clampForCircuit(id as CircuitId, v);
      }
    }
  }

  private isZoneLit(zoneId: RoomZoneId): boolean {
    const zone = this.zoneLighting.getZone(zoneId);
    return zone ? zone.circuits.some((id) => this.targetLevels[id] > 0) : false;
  }

  /** Zones sharing channels with `changed` (open-plan overlap) are re-derived from levels. */
  private syncOverlappingZones(changed: KnxLightingZone): void {
    for (const zone of this.project.zones) {
      if (zone.id === changed.id) continue;
      if (zone.circuits.some((id) => changed.circuits.includes(id))) {
        this.syncZoneModeFromLevels(zone.id);
      }
    }
  }

  /** Infers a zone's mode from its channel levels (stored scene match, full, off or manual). */
  private syncZoneModeFromLevels(zoneId: RoomZoneId): void {
    const zone = this.zoneLighting.getZone(zoneId);
    if (!zone) return;
    if (!this.isZoneLit(zoneId)) {
      const mode = this.zoneLighting.getState(zoneId).mode;
      if (mode !== 'night') this.zoneLighting.markMode(zoneId, 'off');
      return;
    }
    const matches = (levels: ZoneLevels): boolean =>
      zone.circuits.every((id) => this.targetLevels[id] === this.clampForCircuit(id, levels[id] ?? 0));
    const sceneIdx = zone.scenes.findIndex((_, i) => matches(this.zoneLighting.sceneLevels(zoneId, i)));
    if (sceneIdx >= 0) {
      this.zoneLighting.markScene(zoneId, sceneIdx);
    } else if (matches(this.zoneLighting.fullLevels(zoneId))) {
      this.zoneLighting.markMode(zoneId, 'full');
    } else {
      this.zoneLighting.markMode(zoneId, 'manual');
    }
  }

  /** Keeps the legacy central-scene index in step with the open-plan channels. */
  private refreshActiveCentralScene(): void {
    if (!this.isAnyKitchenLightOn() || this.zoneLighting.getState('kitchen').mode === 'night') {
      this.activeSceneIndex = -1;
      return;
    }
    if (this.zoneLighting.getState('kitchen').mode === 'full') {
      this.activeSceneIndex = ACTIVE_SCENE_FULL;
      return;
    }
    const idx = this.scenes.findIndex((scene) =>
      SCENE_CIRCUIT_IDS.every((id) => scene.levels[id] === this.targetLevels[id])
    );
    this.activeSceneIndex = idx >= 0 ? idx : ACTIVE_SCENE_CUSTOM;
    if (idx >= 0 && idx <= 2) this.lastActiveSceneIndex = idx;
  }

  private prefix(sourcePa: string, location?: string): string {
    if (sourcePa === this.project.centralPa.aiBridge) return 'AI Gateway → ';
    if (location) return `Switch (${location}) → `;
    const button = this.pushButtonByPa.get(sourcePa);
    return button ? `${button.name} (${button.pa}) → ` : '';
  }

  private locationTag(location: string | undefined, direction: SwitchDirection): string | undefined {
    return location ? `${location} ${direction === 'up' ? '▲' : '▼'}` : undefined;
  }
}
