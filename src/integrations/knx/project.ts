import type {
  CircuitConfig,
  CircuitId,
  RoomMotionSensorId,
  ScenePreset,
  ZoneScenePreset,
} from '../../core/types/knx.ts';
import type {
  BuildingDefinition,
  BuildingId,
  FloorDefinition,
  FloorId,
  KNXPhysicalDeviceDefinition,
  RoomZoneDefinition,
  RoomZoneId,
} from '../../core/types/topology.ts';
import type { RoomAutomationConfig } from './room-automation.ts';

/**
 * Home-agnostic description of a KNX installation, in the shape an ETS project exports:
 * actuator channels (circuits), lighting zones with their stored scenes and central objects,
 * push-buttons, presence detectors, motorized covers/gates, and media endpoints.
 */

/** World-space XZ polygon + height band a presence detector can see (its detection field). */
export interface KnxCoverageVolume {
  /** Polygon vertices `[x, z]` in world metres (any winding). */
  readonly polygon: readonly (readonly [number, number])[];
  readonly minY: number;
  readonly maxY: number;
}

export interface KnxVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Group addresses of one lighting zone's central objects (all owned by the actuator). */
export interface KnxZoneGroupAddresses {
  /** Scene recall / learn (DPT 17.001 / 18.001). */
  readonly scene: string;
  /** Scene status feedback (DPT 17.001) — switch LEDs and visualisations read this. */
  readonly sceneStatus: string;
  /** Night object (DPT 1.001): 1 = night mode, 0 = leave night mode. */
  readonly night: string;
  /** Full-on object (DPT 1.001): 1 = all channels 100 %. */
  readonly full: string;
  /** Zone on/off status feedback (DPT 1.001) — any channel above 0 %. */
  readonly status: string;
  /** Relative dimming of the whole zone (DPT 3.007). */
  readonly dim: string;
}

/** Per-channel actuator parameters (ETS "channel" tab). */
export interface KnxActuatorChannelParams {
  readonly minLevel: number;
  readonly maxLevel: number;
  readonly softOnSec: number;
  readonly softOffSec: number;
}

/** A lighting zone: the actuator channels it groups, its stored scenes and night parameters. */
export interface KnxLightingZone {
  readonly id: RoomZoneId;
  readonly name: string;
  /** Extra natural-language names for the AI assistant resolver. */
  readonly aliases?: readonly string[];
  /** Channels recalled by the zone scenes / night / full objects. */
  readonly circuits: readonly CircuitId[];
  /** Scenes stepped by short presses, in order (index 0 = brightest / first). */
  readonly scenes: readonly ZoneScenePreset[];
  /** Night-object levels (3–5 %). Channels not listed go to 0 %. */
  readonly nightLevels: Partial<Record<CircuitId, number>>;
  readonly ga: KnxZoneGroupAddresses;
  /**
   * Zones whose wall toggles drive the central actuator scene table (`ScenePreset`s recalled on
   * `centralGa.centralScene`) instead of a per-zone scene list.
   */
  readonly usesCentralSceneTable?: boolean;
  /**
   * Optional short-press behaviour override:
   * - `'cycleScenes'` (default): steps through stored scenes
   * - `'toggleFirstNight'`: toggles between scene 0 (when off/night) and night mode (when lit)
   */
  readonly toggleMode?: 'cycleScenes' | 'toggleFirstNight';
  /** Additional linked zones driven to 100 % when this zone receives a hold-up gesture. */
  readonly holdUpLinkedZones?: readonly RoomZoneId[];
  /** When true, a hold-down gesture on this zone triggers central master-off across all zones. */
  readonly holdDownMasterOff?: boolean;
}

/** One gang (rocker / dolly) of a KNX push-button. */
export interface KnxPushButtonGang {
  /** 1-based gang index on the plate (left to right). */
  readonly gang: number;
  /** Zone whose scene / night / full objects this gang sends to. */
  readonly zoneId: RoomZoneId;
  readonly label: string;
}

export interface KnxPushButtonParams {
  /** Short / long press discrimination (ETS "time between short and long operation"). */
  readonly longPressMs: number;
}

/** A wall push-button (toggle switch on a KNX bus coupler) with 1–3 gangs. */
export interface KnxPushButtonDevice {
  readonly pa: string;
  readonly name: string;
  /** Room the plate is mounted in. */
  readonly mountedInZoneId: RoomZoneId;
  readonly location: string;
  readonly gangs: readonly KnxPushButtonGang[];
  readonly params: KnxPushButtonParams;
}

export interface KnxPresenceDetectorParams {
  /** Presence hold time: presence object sends 0 after this long without movement. */
  readonly holdTimeSec: number;
  /** Below this lux a zone in "off" may be woken into night mode by presence. */
  readonly luxThreshold: number;
}

/** A ceiling presence detector (PIR + lux) with its detection field. */
export interface KnxPresenceDetectorDevice {
  readonly pa: string;
  readonly name: string;
  readonly zoneId: RoomZoneId;
  /** Presence output (DPT 1.018). */
  readonly gaPresence: string;
  /** Ceiling mount point (world). */
  readonly position: KnxVector3;
  readonly coverage: KnxCoverageVolume;
  readonly params: KnxPresenceDetectorParams;
  /** True when the detector boots in an initially occupied (latched) state. */
  readonly initiallyDetected?: boolean;
  /** Optional link to a room-automation PIR circuit rule. */
  readonly motionSensorId?: RoomMotionSensorId;
}

/** Motorized gate, blind, or shutter actuator channel on the KNX bus. */
export interface KnxCoverChannelConfig {
  readonly id: string;
  readonly entityId?: string;
  readonly name: string;
  readonly shortName?: string;
  readonly pa: string;
  readonly gaCommand: string;
  readonly gaPosition: string;
  readonly travelDurationSec: number;
  readonly buildingId?: BuildingId;
  readonly floorId?: FloorId;
  readonly zoneId?: RoomZoneId;
  /** Optional access-control target entry id bridged by `SmartHomeHub` / `UniFiAccessController`. */
  readonly targetEntry?: string;
  readonly aliases?: readonly string[];
}

/** Indexed media / display / scene endpoint on the KNX bus (DPT 17.001 item selector). */
export interface KnxMediaEndpointConfig {
  readonly id: string;
  readonly name: string;
  readonly pa: string;
  readonly gaSelect: string;
  readonly items: readonly string[];
  /** Optional automatic item rotation period in seconds while occupied. */
  readonly autoCycleIntervalSec?: number;
  /** Optional presence detector PA gating active state and auto-cycling. */
  readonly linkedPresencePa?: string;
  readonly aliases?: readonly string[];
}

/** One row of the ETS-style group address list. */
export interface KnxGroupAddressEntry {
  readonly address: string;
  readonly name: string;
  readonly dpt: string;
  readonly main: string;
  readonly middle: string;
  readonly description: string;
}

/** Central group addresses used by the bus controller. */
export interface KnxCentralGroupAddresses {
  readonly masterOff: string;
  readonly masterFull: string;
  readonly centralScene?: string;
  readonly ambientLux: string;
}

/** Central physical addresses of bus infrastructure devices. */
export interface KnxCentralDeviceAddresses {
  readonly ipInterface: string;
  readonly aiBridge: string;
  readonly centralActuator?: string;
  readonly centralSwitch?: string;
  readonly ambientLuxSensor?: string;
}

export interface KnxProject {
  readonly name: string;
  readonly buildings: Readonly<Record<BuildingId, BuildingDefinition>>;
  readonly floors: readonly FloorDefinition[];
  readonly rooms: readonly RoomZoneDefinition[];
  readonly circuits: readonly CircuitConfig[];
  /** Optional central scene table recalled via `centralGa.centralScene`. */
  readonly centralScenes: readonly ScenePreset[];
  readonly zones: readonly KnxLightingZone[];
  readonly pushButtons: readonly KnxPushButtonDevice[];
  readonly presenceDetectors: readonly KnxPresenceDetectorDevice[];
  readonly physicalDevices: readonly KNXPhysicalDeviceDefinition[];
  readonly roomAutomation: RoomAutomationConfig;
  readonly centralGa: KnxCentralGroupAddresses;
  readonly centralPa: KnxCentralDeviceAddresses;
  /** Optional motorized cover / gate channels. */
  readonly covers?: readonly KnxCoverChannelConfig[];
  /** Optional indexed media / display endpoints. */
  readonly mediaEndpoints?: readonly KnxMediaEndpointConfig[];
  /** Default presence hold time (seconds) when a detector does not override it. */
  readonly defaultPresenceHoldTimeSec: number;
  /** Full ETS-style GA list. */
  readonly groupAddresses: readonly KnxGroupAddressEntry[];
}

export function findZone(project: KnxProject, zoneId: RoomZoneId): KnxLightingZone | undefined {
  return project.zones.find((z) => z.id === zoneId);
}

export function findCircuit(project: KnxProject, circuitId: CircuitId): CircuitConfig | undefined {
  return project.circuits.find((c) => c.id === circuitId);
}
