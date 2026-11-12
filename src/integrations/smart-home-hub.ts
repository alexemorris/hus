import { KNXPropertyBusController } from './knx/index.ts';
import { UniFiAccessController } from './unifi/access/adapter.ts';
import { UniFiProtectController } from './unifi/protect/adapter.ts';
import type {
  AccessCredentialMethod,
  BinarySensorEntityState,
  GateCoverEntityState,
  LightEntityState,
  NumericSensorEntityState,
  SmartDetectionType,
  SmartHomeBusEvent,
  SmartHomeEntity,
  SmartHomeHubListener,
} from '../core/entities.ts';

/**
 * Multi-Protocol Smart Home Hub.
 *
 * Unifies:
 * 1. **KNX TP1 / cEMI Bus (`1.1.x` / `1.2.x`)** — lighting scenes, dimmers, PIR/Lux sensors, motorized gate controller
 * 2. **UniFi Protect CCTV (`192.168.10.2x`)** — 3D camera frustums, LPR & Smart Detections
 * 3. **UniFi Access (`192.168.10.3x`)** — G2 Reader Pro gate intercom & door access hubs
 *
 * Also executes cross-protocol Smart Home automations:
 * - **UniFi Access Gate Grant → KNX Gate Actuator (`1/5/1`) + Courtyard Night Welcome**
 * - **UniFi Protect Vehicle LPR / Person Detection → KNX Security Lighting Trigger**
 */
export class SmartHomeHub {
  public readonly knx: KNXPropertyBusController;
  public readonly protect: UniFiProtectController;
  public readonly access: UniFiAccessController;

  private readonly listeners = new Set<SmartHomeHubListener>();
  private readonly unifiedEventLog: SmartHomeBusEvent[] = [];
  private isSyncingGateState = false;

  public constructor(
    knx: KNXPropertyBusController,
    protect = new UniFiProtectController(),
    access = new UniFiAccessController()
  ) {
    this.knx = knx;
    this.protect = protect;
    this.access = access;

    this.bindCrossProtocolSubscriptions();
  }

  private bindCrossProtocolSubscriptions(): void {
    // 1. Listen to KNX Bus events and mirror gate state into UniFi Access
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
        if (!this.isSyncingGateState) {
          this.isSyncingGateState = true;
          this.access.syncGateStateFromKnx(
            this.knx.isCarGatesOpen(),
            this.knx.isCarGatesMoving()
          );
          this.isSyncingGateState = false;
        }
        this.notify({ type: 'entityChanged' });
      }
    });

    // 2. Listen to UniFi Access credential events -> bridge to KNX Gate Controller (1.1.22 / GA 1/5/1)
    this.access.subscribe((_points, busEvent, unlockedEntry) => {
      if (busEvent) {
        this.recordBusEvent(busEvent);
        this.notify({ type: 'busEvent', busEvent });
      }

      if (unlockedEntry && unlockedEntry.targetEntry === 'carGates' && !this.isSyncingGateState) {
        this.isSyncingGateState = true;
        const shouldOpen = !unlockedEntry.isLocked;
        this.knx.setCarGatesOpen(shouldOpen, true, '1.1.22');

        // Cross-protocol automation: if opening gates at Dusk/Night (< 100 lx), turn on Courtyard Lamp Post & Festoons
        if (
          shouldOpen &&
          this.knx.isBelowLuxThreshold() &&
          !this.knx.isCourtyardLightOn()
        ) {
          this.knx.setCircuitLevel('courtyardFestoons', 40, true, '1.1.2');
          this.knx.setCircuitLevel('reclaimedLampPost', 60, true, '1.1.2');
        }
        this.isSyncingGateState = false;
      }

      this.notify({ type: 'entityChanged' });
    });

    // 3. Listen to UniFi Protect Smart Detections -> optional LPR gate & courtyard security link
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
   * and executes cross-protocol KNX security/welcome actions when appropriate.
   */
  public triggerCameraSmartDetection(
    cameraEntityId: string,
    detection: SmartDetectionType
  ): void {
    const updated = this.protect.triggerSmartDetection(cameraEntityId, detection);
    if (!updated) return;

    // If Driveway AI Pro detects a known Vehicle (LPR match), trigger UniFi Access Gate Unlock -> KNX 1/5/1
    if (
      cameraEntityId === 'camera.unifi_driveway_gate' &&
      detection === 'vehicle' &&
      !this.knx.isCarGatesOpen()
    ) {
      this.access.triggerUnlockEvent(
        'access.front_split_gate_intercom',
        'License Plate (LPR)'
      );
    } else if (
      detection === 'person' &&
      this.knx.isBelowLuxThreshold() &&
      !this.knx.isCourtyardLightOn()
    ) {
      // Night security automation: bring up Reclaimed Courtyard Lamp Post to 60%
      this.knx.setCircuitLevel('reclaimedLampPost', 60, true, '1.1.2');
    }
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

    const sensorEntities: Array<BinarySensorEntityState | NumericSensorEntityState> = [
      {
        entityId: 'binary_sensor.knx_kitchen_occupancy',
        name: 'Kitchen Ceiling PIR Presence Sensor',
        shortName: 'Kitchen PIR',
        protocol: 'knx',
        buildingId: 'mainHouse',
        floorId: 'ground',
        zoneId: 'kitchen',
        hardwareAddress: '1.1.12 · 1/4/1',
        kind: 'binarySensor',
        deviceClass: 'occupancy',
        isDetected: this.knx.getKitchenMotionDetected(),
      },
      {
        entityId: 'binary_sensor.knx_utility_occupancy',
        name: 'Utility Room Ceiling PIR Presence Sensor',
        shortName: 'Utility PIR',
        protocol: 'knx',
        buildingId: 'mainHouse',
        floorId: 'ground',
        zoneId: 'utility',
        hardwareAddress: '1.1.13 · 1/4/3',
        kind: 'binarySensor',
        deviceClass: 'occupancy',
        isDetected: this.knx.getUtilityMotionDetected(),
      },
      {
        entityId: 'sensor.knx_kitchen_ambient_lux',
        name: 'Kitchen Ambient Illuminance Sensor',
        shortName: 'Kitchen Lux',
        protocol: 'knx',
        buildingId: 'mainHouse',
        floorId: 'ground',
        zoneId: 'kitchen',
        hardwareAddress: '1.1.12 · 1/4/2',
        kind: 'numericSensor',
        deviceClass: 'illuminance',
        value: this.knx.getAmbientLux(),
        unit: 'lx',
      },
    ];

    const gateEntity: GateCoverEntityState = {
      entityId: 'cover.knx_front_car_gates',
      name: 'Motorized Dual-Leaf Front Car Entrance Gates',
      shortName: 'Front Car Gates',
      protocol: 'knx',
      buildingId: 'courtyardGrounds',
      floorId: 'exterior',
      zoneId: 'courtyard',
      hardwareAddress: '1.1.22 · 1/5/1',
      kind: 'gate',
      isOpen: this.knx.isCarGatesOpen(),
      isMoving: this.knx.isCarGatesMoving(),
      positionPct: Math.round(this.knx.getCarGatesProgress() * 100),
      travelDurationSec: KNXPropertyBusController.CAR_GATE_TRAVEL_SEC,
    };

    return [
      ...lightEntities,
      ...sensorEntities,
      gateEntity,
      ...this.protect.getCameras(),
      ...this.access.getAccessPoints(),
    ];
  }
}
