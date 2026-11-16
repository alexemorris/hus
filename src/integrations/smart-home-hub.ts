import { KNXPropertyBusController } from './knx/index.ts';
import { UniFiAccessController } from './unifi/access/adapter.ts';
import { UniFiProtectController } from './unifi/protect/adapter.ts';
import type {
  AccessCredentialMethod,
  AccessPointEntityState,
  BinarySensorEntityState,
  CctvCameraEntityState,
  GateCoverEntityState,
  LightEntityState,
  NumericSensorEntityState,
  SmartDetectionType,
  SmartHomeBusEvent,
  SmartHomeEntity,
  SmartHomeHubListener,
} from '../core/entities.ts';

export interface SmartHomeAutomationRules {
  /** Optional home hook invoked when an access-control point unlocks or locks. */
  readonly onAccessUnlock?: (
    entry: AccessPointEntityState,
    shouldOpen: boolean,
    hub: SmartHomeHub
  ) => void;
  /** Optional home hook invoked when a CCTV camera emits a smart detection. */
  readonly onCameraDetection?: (
    camera: CctvCameraEntityState,
    detection: SmartDetectionType,
    hub: SmartHomeHub
  ) => void;
}

/**
 * Multi-Protocol Smart Home Hub.
 *
 * Unifies:
 * - KNX TP1 / cEMI Bus — lighting scenes, dimmers, PIR/Lux sensors, motorized cover/gate channels
 * - UniFi Protect CCTV — 3D camera frustums & Smart Detections
 * - UniFi Access — reader intercoms & door/gate access hubs
 */
export class SmartHomeHub {
  public readonly knx: KNXPropertyBusController;
  public readonly protect: UniFiProtectController;
  public readonly access: UniFiAccessController;
  private readonly rules: SmartHomeAutomationRules;

  private readonly listeners = new Set<SmartHomeHubListener>();
  private readonly unifiedEventLog: SmartHomeBusEvent[] = [];
  private isSyncingEntryState = false;

  public constructor(
    knx: KNXPropertyBusController,
    protect = new UniFiProtectController(),
    access = new UniFiAccessController(),
    rules: SmartHomeAutomationRules = {}
  ) {
    this.knx = knx;
    this.protect = protect;
    this.access = access;
    this.rules = rules;

    this.bindCrossProtocolSubscriptions();
  }

  private bindCrossProtocolSubscriptions(): void {
    // Mirror KNX bus events and cover/gate states into UniFi Access.
    this.knx.subscribe((ev) => {
      if (ev.type === 'telegram') {
        const tg = ev.telegram;
        const busEvent: SmartHomeBusEvent = {
          id: tg.id,
          timestamp: tg.timestamp,
          protocol: 'knx',
          sourceAddress: tg.src,
          targetAddress: tg.dst,
          eventType: tg.apci,
          summary: tg.summary,
        };
        this.recordBusEvent(busEvent);
        this.notify({ type: 'busEvent', busEvent });
      } else if (ev.type === 'stateChange') {
        if (!this.isSyncingEntryState) {
          this.isSyncingEntryState = true;
          for (const cover of this.knx.getCovers()) {
            const entryId = cover.targetEntry ?? cover.id;
            this.access.syncEntryState(
              entryId,
              this.knx.isCoverOpen(cover.id),
              this.knx.isCoverMoving(cover.id)
            );
          }
          this.isSyncingEntryState = false;
        }
        this.notify({ type: 'entityChanged' });
      }
    });

    // Bridge UniFi Access credential events to any matching KNX cover channel and home rules.
    this.access.subscribe((_points, busEvent, unlockedEntry) => {
      if (busEvent) {
        this.recordBusEvent(busEvent);
        this.notify({ type: 'busEvent', busEvent });
      }

      if (unlockedEntry && !this.isSyncingEntryState) {
        this.isSyncingEntryState = true;
        const shouldOpen = !unlockedEntry.isLocked;
        const matchingCover = this.knx
          .getCovers()
          .find(
            (c) =>
              c.targetEntry === unlockedEntry.targetEntry ||
              c.id === unlockedEntry.targetEntry
          );
        if (matchingCover) {
          this.knx.setCoverOpen(matchingCover.id, shouldOpen, true, matchingCover.pa);
        }
        this.rules.onAccessUnlock?.(unlockedEntry, shouldOpen, this);
        this.isSyncingEntryState = false;
      }

      this.notify({ type: 'entityChanged' });
    });

    // Forward UniFi Protect smart detections to the unified bus log.
    this.protect.subscribe((_cameras, busEvent) => {
      if (busEvent) {
        this.recordBusEvent(busEvent);
        this.notify({ type: 'busEvent', busEvent });
      }
      this.notify({ type: 'entityChanged' });
    });
  }

  private recordBusEvent(ev: SmartHomeBusEvent): void {
    this.unifiedEventLog.unshift(ev);
    if (this.unifiedEventLog.length > 100) {
      this.unifiedEventLog.pop();
    }
  }

  public subscribe(fn: SmartHomeHubListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private notify(event: {
    readonly type: 'entityChanged' | 'busEvent' | 'lodChanged';
    readonly busEvent?: SmartHomeBusEvent;
  }): void {
    for (const fn of this.listeners) {
      fn(event);
    }
  }

  public getUnifiedEvents(): readonly SmartHomeBusEvent[] {
    return this.unifiedEventLog;
  }

  /**
   * Simulates a UniFi Protect Smart Detection (`person` | `vehicle` | `none`) on a camera,
   * and executes any home-configured cross-protocol automation rules.
   */
  public triggerCameraSmartDetection(
    cameraEntityId: string,
    detection: SmartDetectionType
  ): void {
    const updated = this.protect.triggerSmartDetection(cameraEntityId, detection);
    if (!updated) return;
    this.rules.onCameraDetection?.(updated, detection, this);
  }

  public triggerAccessUnlock(
    accessEntityId: string,
    method: AccessCredentialMethod = 'NFC Card'
  ): void {
    this.access.triggerUnlockEvent(accessEntityId, method);
  }

  /**
   * Returns a complete snapshot of all Smart Home Entities across KNX, UniFi Protect, and UniFi Access.
   */
  public getAllEntities(): readonly SmartHomeEntity[] {
    const targetLevels = this.knx.getTargetLevels();

    const lightEntities: LightEntityState[] = this.knx.getCircuits().map((c) => {
      const pct = Math.round(targetLevels[c.id] ?? 0);
      return {
        entityId: `light.knx_${c.id}`,
        name: c.name,
        shortName: c.shortName,
        protocol: 'knx',
        buildingId: c.buildingId,
        floorId: c.floorId,
        zoneId: c.zoneId,
        hardwareAddress: `${c.actuatorPa} · ${c.gaValue}`,
        kind: 'light',
        isOn: pct > 0,
        brightnessPct: pct,
        groupAddressSwitch: c.gaSwitch,
        groupAddressValue: c.gaValue,
      };
    });

    const project = this.knx.getProject();
    const defaultBuildingId =
      project.rooms[0]?.buildingId ?? Object.keys(project.buildings)[0] ?? 'default';
    const defaultFloorId = project.rooms[0]?.floorId ?? project.floors[0]?.id ?? 'ground';
    const defaultZoneId = project.rooms[0]?.id ?? 'exterior';
    const roomById = new Map(project.rooms.map((r) => [r.id, r]));
    const detectors = this.knx.getPresenceDetectors();

    const occupancyEntities: BinarySensorEntityState[] = detectors.map((detector) => {
      const room = roomById.get(detector.zoneId);
      const slug = detector.pa.replace(/[^a-zA-Z0-9]+/g, '_');
      return {
        entityId: `binary_sensor.knx_${detector.zoneId}_${slug}`,
        name: detector.name,
        shortName: detector.name,
        protocol: 'knx',
        buildingId: room?.buildingId ?? defaultBuildingId,
        floorId: room?.floorId ?? defaultFloorId,
        zoneId: detector.zoneId,
        hardwareAddress: `${detector.pa} · ${detector.gaPresence}`,
        kind: 'binarySensor',
        deviceClass: 'occupancy',
        isDetected: this.knx.getPresenceState(detector.pa).detected,
      };
    });

    const primaryZoneId = detectors[0]?.zoneId ?? defaultZoneId;
    const primaryRoom = roomById.get(primaryZoneId);
    const primaryLuxPa =
      project.centralPa.ambientLuxSensor ?? detectors[0]?.pa ?? project.centralPa.ipInterface;
    const sensorEntities: Array<BinarySensorEntityState | NumericSensorEntityState> = [
      ...occupancyEntities,
      {
        entityId: 'sensor.knx_ambient_lux',
        name: 'Ambient Illuminance Sensor',
        shortName: 'Ambient Lux',
        protocol: 'knx',
        buildingId: primaryRoom?.buildingId ?? defaultBuildingId,
        floorId: primaryRoom?.floorId ?? defaultFloorId,
        zoneId: primaryZoneId,
        hardwareAddress: `${primaryLuxPa} · ${project.centralGa.ambientLux}`,
        kind: 'numericSensor',
        deviceClass: 'illuminance',
        value: this.knx.getAmbientLux(),
        unit: 'lx',
      },
    ];

    const coverEntities: GateCoverEntityState[] = this.knx.getCovers().map((cover) => ({
      entityId: cover.entityId ?? `cover.knx_${cover.id.replace(/[^a-zA-Z0-9]+/g, '_')}`,
      name: cover.name,
      shortName: cover.shortName ?? cover.name,
      protocol: 'knx',
      buildingId: cover.buildingId ?? defaultBuildingId,
      floorId: cover.floorId ?? 'exterior',
      zoneId: cover.zoneId ?? defaultZoneId,
      hardwareAddress: `${cover.pa} · ${cover.gaCommand}`,
      kind: 'gate',
      isOpen: this.knx.isCoverOpen(cover.id),
      isMoving: this.knx.isCoverMoving(cover.id),
      positionPct: Math.round(this.knx.getCoverProgress(cover.id) * 100),
      travelDurationSec: cover.travelDurationSec,
    }));

    return [
      ...lightEntities,
      ...sensorEntities,
      ...coverEntities,
      ...this.protect.getCameras(),
      ...this.access.getAccessPoints(),
    ];
  }
}
