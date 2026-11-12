import {
  CircuitBus,
  defaultPlateGangSwitchId,
  type ElectricalRoomScene,
  type SwitchGangPose,
} from '../../core/electrical/index.ts';
import type {
  CircuitConfig,
  CircuitId,
  InboundKNXFrame,
  RoomMotionSensorId,
} from '../../core/types/knx.ts';
import type { RoomZoneId } from '../../core/types/topology.ts';
import type { KNXPropertyBusController } from './emulator.ts';
import type { KnxLightingZone, KnxProject, KnxPushButtonDevice } from './project.ts';

export interface KnxElectricalAdapterOptions {
  readonly bus?: CircuitBus;
  readonly project?: KnxProject;
}

export interface KnxElectricalAdapterConfig extends KnxElectricalAdapterOptions {
  readonly knx: KNXPropertyBusController;
}

export interface KnxSwitchGangPressInput {
  readonly switchPa: string;
  readonly gang?: number;
  readonly zoneId?: RoomZoneId | string;
  readonly direction: SwitchGangPose;
  readonly pressDurationMs?: number;
  readonly location?: string;
  readonly legacyKind?: 'kitchen' | 'courtyard' | 'utility';
}

const LEGACY_MASTER_OFF_ZONE_IDS: readonly RoomZoneId[] = [
  'kitchen',
  'sitting',
  'utility',
  'familyRoom',
  'courtyard',
];

function pctTo01(pct: number | undefined): number {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(1, pct / 100));
}

function level01ToPct(level01: number): number {
  if (!Number.isFinite(level01)) return 0;
  return Math.max(0, Math.min(100, Math.round(level01 * 100)));
}

/**
 * Optional smart-home adapter bridging a {@link KNXPropertyBusController}
 * onto the protocol-agnostic {@link CircuitBus}.
 */
export class KnxElectricalAdapter {
  public readonly knx: KNXPropertyBusController;
  public readonly bus: CircuitBus;
  private readonly project: KnxProject;
  private readonly knownCircuitIds = new Set<string>();
  private readonly pushButtonsByPa = new Map<string, KnxPushButtonDevice>();
  private readonly unsubscribeKnx: () => void;
  private readonly unsubscribeBus: () => void;

  private isSyncingFromKnx = false;
  private isWritingToKnx = false;

  public constructor(
    knxOrConfig: KNXPropertyBusController | KnxElectricalAdapterConfig,
    optionsOrBus?: KnxElectricalAdapterOptions | CircuitBus
  ) {
    if ('knx' in knxOrConfig) {
      this.knx = knxOrConfig.knx;
      this.bus = knxOrConfig.bus ?? new CircuitBus();
      this.project = knxOrConfig.project ?? this.knx.getProject();
    } else {
      this.knx = knxOrConfig;
      if (optionsOrBus instanceof CircuitBus) {
        this.bus = optionsOrBus;
        this.project = this.knx.getProject();
      } else {
        this.bus = optionsOrBus?.bus ?? new CircuitBus();
        this.project = optionsOrBus?.project ?? this.knx.getProject();
      }
    }

    this.populateTopology();
    this.syncLevelsFromKnx('target');
    this.syncIndicatorsFromKnx();

    this.unsubscribeKnx = this.knx.subscribe((event) => {
      if (this.isWritingToKnx) return;
      if (event.type === 'stateChange') {
        this.syncLevelsFromKnx('target');
        this.syncIndicatorsFromKnx();
      } else if (event.type === 'telegram' && event.telegram.direction === 'rx') {
        this.syncLevelsFromKnx('target');
        this.syncIndicatorsFromKnx();
      }
    });

    this.unsubscribeBus = this.bus.subscribe((event) => {
      if (
        this.isSyncingFromKnx ||
        event.source === 'knx-sync' ||
        event.type === 'rampStep' ||
        event.type === 'indicatorChange'
      ) {
        return;
      }
      if (event.changedCircuits.length === 0) {
        return;
      }

      this.writeCircuitChangesToKnx(event.changedCircuits);
    });
  }

  public dispose(): void {
    this.unsubscribeKnx();
    this.unsubscribeBus();
  }

  // -------------------------------------------------------------------------
  // KNX Push-Buttons
  // -------------------------------------------------------------------------

  public pressSwitchGang(input: KnxSwitchGangPressInput): void {
    const pb = this.pushButtonsByPa.get(input.switchPa);
    const gang = input.gang ?? pb?.gangs[0]?.gang ?? 1;
    const gangMeta = pb?.gangs.find((g) => g.gang === gang) ?? pb?.gangs[0];
    const resolvedLocation = input.location ?? pb?.location;

    // Update physical gang dolly pose on CircuitBus without triggering circuit write-back.
    this.bus.flipPlateGang(input.switchPa, gang, input.direction, {
      source: 'knx-sync',
      immediate: true,
    });

    const candidateZoneId = (input.zoneId ?? gangMeta?.zoneId) as RoomZoneId | undefined;
    const pressMs = input.pressDurationMs ?? 0;

    if (candidateZoneId && this.knx.getZone(candidateZoneId)) {
      this.knx.handleZoneSwitchGesture(
        candidateZoneId,
        input.direction,
        pressMs,
        input.switchPa,
        resolvedLocation
      );
    } else {
      this.dispatchLegacySwitchPress(input, pressMs, resolvedLocation);
    }

    this.syncLevelsFromKnx('target');
    this.syncIndicatorsFromKnx();
  }

  // -------------------------------------------------------------------------
  // Scene Recalls & Zone Modes
  // -------------------------------------------------------------------------

  public recallZoneScene(
    zoneId: RoomZoneId,
    sceneIndex: number,
    sourcePa?: string,
    location?: string
  ): void {
    this.knx.recallZoneScene(zoneId, sceneIndex, sourcePa, location);
    this.syncLevelsFromKnx('target');
    this.syncIndicatorsFromKnx();
  }

  public recallCentralScene(sceneIndex: number, sourcePa?: string, location?: string): void {
    this.knx.recallScene(sceneIndex, sourcePa, location);
    this.syncLevelsFromKnx('target');
    this.syncIndicatorsFromKnx();
  }

  public setZoneFull(zoneId: RoomZoneId, sourcePa?: string, location?: string): void {
    this.knx.setZoneFull(zoneId, sourcePa, location);
    this.syncLevelsFromKnx('target');
    this.syncIndicatorsFromKnx();
  }

  public enterZoneNight(zoneId: RoomZoneId, sourcePa?: string, location?: string): void {
    this.knx.enterZoneNight(zoneId, sourcePa, location);
    this.syncLevelsFromKnx('target');
    this.syncIndicatorsFromKnx();
  }

  public setZoneOff(zoneId: RoomZoneId, sourcePa?: string): void {
    this.knx.setZoneOff(zoneId, sourcePa);
    this.syncLevelsFromKnx('target');
    this.syncIndicatorsFromKnx();
  }

  public masterOff(sourcePa?: string, location?: string): void {
    const zones = this.knx.getZones();
    const hasLegacyZones = LEGACY_MASTER_OFF_ZONE_IDS.some(
      (id) => this.knx.getZone(id) !== undefined
    );
    if (hasLegacyZones) {
      this.knx.handleSwitchLongPressHoldDown(location, sourcePa);
    } else {
      for (const zone of zones) {
        this.knx.enterZoneNight(zone.id, sourcePa, location);
      }
    }
    this.syncLevelsFromKnx('target');
    this.syncIndicatorsFromKnx();
  }

  public masterFull(sourcePa?: string, location?: string): void {
    if (this.knx.getZone('kitchen')) {
      this.knx.handleSwitchLongPressHoldUp(location, sourcePa);
    } else {
      for (const zone of this.knx.getZones()) {
        this.knx.setZoneFull(zone.id, sourcePa, location);
      }
    }
    this.syncLevelsFromKnx('target');
    this.syncIndicatorsFromKnx();
  }

  // -------------------------------------------------------------------------
  // PIR Occupancy & Room Motion
  // -------------------------------------------------------------------------

  public setPresence(detectorPa: string, detected: boolean, simClockSec?: number): void {
    if (simClockSec !== undefined && Number.isFinite(simClockSec)) {
      const delta = simClockSec - this.knx.getSimTimeSec();
      if (delta > 0) {
        this.knx.stepDimming(delta);
      }
      if (detected) {
        this.knx.reportPresence(detectorPa);
      } else {
        this.knx.setPresence(detectorPa, false, true, true);
      }
    } else {
      this.knx.setPresence(detectorPa, detected);
    }
    this.syncLevelsFromKnx('target');
    this.syncIndicatorsFromKnx();
  }

  public triggerRoomMotion(sensorId: RoomMotionSensorId, detected = true): void {
    this.knx.setRoomMotionDetected(sensorId, detected);
    this.syncLevelsFromKnx('target');
    this.syncIndicatorsFromKnx();
  }

  // -------------------------------------------------------------------------
  // External Bus Frames & Step
  // -------------------------------------------------------------------------

  public injectInboundFrame(frameOrHex: string | InboundKNXFrame): void {
    this.knx.ingestExternalFrame(frameOrHex);
    this.syncLevelsFromKnx('target');
    this.syncIndicatorsFromKnx();
  }

  /**
   * Advances KNX soft-dimming / presence hold timers by `dtSeconds` and mirrors
   * live actuator channel levels (`0..100`% -> `0..1`) onto `CircuitBus`.
   */
  public step(dtSeconds: number): boolean {
    const knxChanged = this.knx.stepDimming(dtSeconds);
    const busChanged = this.bus.step(dtSeconds);
    if (knxChanged) {
      this.syncLevelsFromKnx('live');
      this.syncIndicatorsFromKnx();
    }
    return knxChanged || busChanged;
  }

  // -------------------------------------------------------------------------
  // Internal synchronization
  // -------------------------------------------------------------------------

  private populateTopology(): void {
    const circuits: readonly CircuitConfig[] =
      this.knx.getCircuits().length > 0 ? this.knx.getCircuits() : this.project.circuits;
    const targetLevels = this.knx.getTargetLevels();

    for (const c of circuits) {
      this.knownCircuitIds.add(c.id);
      const initialPct = targetLevels[c.id] ?? c.defaultLevel ?? 0;
      this.bus.registerCircuit({
        id: c.id,
        name: c.name,
        shortName: c.shortName,
        zoneId: c.zoneId,
        floorId: c.floorId,
        buildingId: c.buildingId,
        kind: c.kind,
        dimmable: c.dimmable,
        defaultBrightness: pctTo01(initialPct),
        wiring: { kind: 'bus' },
      });
    }

    const zones: readonly KnxLightingZone[] =
      this.knx.getZones().length > 0 ? this.knx.getZones() : this.project.zones;

    for (const zone of zones) {
      const scenes: ElectricalRoomScene[] = zone.scenes.map((scene) => {
        const levels: Record<string, number> = {};
        for (const cid of zone.circuits) {
          levels[cid] = pctTo01(scene.levels[cid] ?? 0);
        }
        for (const [cid, val] of Object.entries(scene.levels)) {
          if (typeof val === 'number') {
            levels[cid] = pctTo01(val);
          }
        }
        return {
          id: scene.id,
          label: scene.label,
          levels,
        };
      });

      const nightLevels: Record<string, number> = {};
      for (const cid of zone.circuits) {
        nightLevels[cid] = pctTo01(zone.nightLevels?.[cid] ?? 0);
      }

      this.bus.registerZone({
        id: zone.id,
        name: zone.name,
        circuits: zone.circuits,
        scenes,
        nightLevels,
      });
    }

    const pushButtons: readonly KnxPushButtonDevice[] =
      this.knx.getPushButtons().length > 0 ? this.knx.getPushButtons() : this.project.pushButtons;

    for (const pb of pushButtons) {
      this.pushButtonsByPa.set(pb.pa, pb);
      this.bus.registerWallPlate({
        plateId: pb.pa,
        name: pb.name,
        mountedInZoneId: pb.mountedInZoneId,
        location: pb.location,
        gangs: pb.gangs.map((g) => ({
          gang: g.gang,
          id: defaultPlateGangSwitchId(pb.pa, g.gang),
          zoneId: g.zoneId,
          label: g.label,
          initialPose: 'up',
        })),
      });
    }
  }

  private dispatchLegacySwitchPress(
    input: KnxSwitchGangPressInput,
    pressMs: number,
    location?: string
  ): void {
    const centralPa = this.project.centralPa;
    const holdThreshold = this.knx.getFlashedParams().holdThresholdMs;
    const isLongPress = pressMs >= holdThreshold;

    if (input.legacyKind === 'utility' || input.switchPa === centralPa.utilitySwitch) {
      this.knx.handleUtilitySwitchToggle(input.switchPa);
      return;
    }

    if (input.legacyKind === 'courtyard' || input.switchPa === centralPa.courtyardSwitch) {
      if (isLongPress) {
        if (input.direction === 'up') {
          this.knx.handleCourtyardSwitchLongPressHoldUp(input.switchPa);
        } else {
          this.knx.handleCourtyardSwitchLongPressHoldDown(input.switchPa);
        }
      } else {
        this.knx.handleCourtyardSwitchShortPress(input.direction, input.switchPa);
      }
      return;
    }

    if (isLongPress) {
      if (input.direction === 'up') {
        this.knx.handleSwitchLongPressHoldUp(location, input.switchPa);
      } else {
        this.knx.handleSwitchLongPressHoldDown(location, input.switchPa);
      }
    } else {
      this.knx.handleSwitchShortPress(input.direction, location);
    }
  }

  private syncLevelsFromKnx(mode: 'target' | 'live'): void {
    if (this.isSyncingFromKnx) return;
    this.isSyncingFromKnx = true;
    try {
      const sourceLevels = mode === 'live' ? this.knx.getLiveLevels() : this.knx.getTargetLevels();
      const updates: Record<string, number> = {};

      for (const circuitId of this.knownCircuitIds) {
        const next01 = pctTo01(sourceLevels[circuitId as CircuitId] ?? 0);
        const current01 = this.bus.getCircuitBrightness(circuitId);
        if (Math.abs(next01 - current01) > 1e-6) {
          updates[circuitId] = next01;
        }
      }

      if (Object.keys(updates).length > 0) {
        this.bus.setCircuitLevels01(updates, {
          source: 'knx-sync',
          immediate: true,
        });
      }
    } finally {
      this.isSyncingFromKnx = false;
    }
  }

  private syncIndicatorsFromKnx(): void {
    this.isSyncingFromKnx = true;
    try {
      for (const pb of this.pushButtonsByPa.values()) {
        for (const gang of pb.gangs) {
          const zoneExists = this.knx.getZone(gang.zoneId) !== undefined;
          const indicatorOn = zoneExists
            ? this.knx.getZoneState(gang.zoneId).mode !== 'off'
            : this.bus.isRoomOn(gang.zoneId);
          this.bus.setPlateGangIndicator(pb.pa, gang.gang, indicatorOn, {
            source: 'knx-sync',
          });
        }
      }
    } finally {
      this.isSyncingFromKnx = false;
    }
  }

  private writeCircuitChangesToKnx(changedCircuits: readonly string[]): void {
    if (this.isWritingToKnx) return;
    this.isWritingToKnx = true;
    try {
      const knxTargets = this.knx.getTargetLevels();
      for (const circuitId of changedCircuits) {
        if (!this.knownCircuitIds.has(circuitId)) continue;
        const desiredPct = level01ToPct(this.bus.getCircuitTargetBrightness(circuitId));
        const currentPct = Math.round(knxTargets[circuitId as CircuitId] ?? 0);
        if (desiredPct !== currentPct) {
          this.knx.setCircuitLevel(circuitId as CircuitId, desiredPct);
        }
      }
    } finally {
      this.isWritingToKnx = false;
    }

    // Reconcile any actuator-side relay clamping (e.g. non-dimmable channel 40% -> 100%) and LEDs.
    this.syncLevelsFromKnx('target');
    this.syncIndicatorsFromKnx();
  }
}

export function createKnxElectricalAdapter(
  knx: KNXPropertyBusController,
  options?: KnxElectricalAdapterOptions
): KnxElectricalAdapter {
  return new KnxElectricalAdapter(knx, options);
}

/**
 * Creates a {@link CircuitBus} populated from and bidirectionally bound to a
 * {@link KNXPropertyBusController}.
 */
export function createCircuitBusFromKnx(
  knx: KNXPropertyBusController,
  project?: KnxProject
): CircuitBus {
  const adapter = new KnxElectricalAdapter(knx, project ? { project } : undefined);
  return adapter.bus;
}
