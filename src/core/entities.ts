import type { RoomFinishSpec } from './types/twin-ux.ts';
import type { AcousticSurfaceMaterial, FloorSurfaceType } from './types/acoustics.ts';
import type { BuildingId, FloorId, RoomBoundingBox, RoomZoneId } from './types/topology.ts';

/**
 * Protocol-agnostic Smart Home Core Entity, LOD & Integration Contracts.
 *
 * The Smart Home layer sits at the foundation of the Digital Twin:
 * - Protocol adapters (`knx`, `unifi-protect`, `unifi-access`) bind physical hardware/buses to entities.
 * - 3D Catalog models and Property Room modules consume and visualize entity states.
 */

export type SmartHomeProtocol = 'knx' | 'unifi-protect' | 'unifi-access' | 'virtual';

/**
 * Semantic Room Level-of-Detail (LOD) Tiers:
 * - `0` (`LOD0` Shell): Structural walls, floor slab, windows, doors & ceiling only.
 * - `1` (`LOD1` Standard): Primary furniture, cabinetry exteriors, switches, cameras & main fixtures.
 * - `2` (`LOD2` Hero): Full high-detail props (crockery inside cabinets, table settings, books, logs),
 *   per-fixture shadow/point lights, and high-frequency canvas textures.
 */
export type RoomLodTier = 0 | 1 | 2;

export type LodPolicyMode = 'auto' | 'lod0' | 'lod1' | 'lod2';

export interface RoomLodStateSnapshot {
  readonly zoneId: RoomZoneId;
  readonly shortName: string;
  readonly floorId: FloorId;
  readonly tier: RoomLodTier;
  readonly isFocused: boolean;
  readonly distanceToTargetM: number;
  readonly standardObjectCount: number;
  readonly heroObjectCount: number;
}

export interface RoomLodDiagnostics {
  readonly policyMode: LodPolicyMode;
  readonly focusedZoneId: RoomZoneId;
  readonly focusedZoneTier: RoomLodTier;
  readonly tierCounts: Readonly<Record<RoomLodTier, number>>;
  readonly rooms: readonly RoomLodStateSnapshot[];
}

export interface SmartHomeEntityBase {
  readonly entityId: string;
  readonly name: string;
  readonly shortName: string;
  readonly protocol: SmartHomeProtocol;
  readonly buildingId: BuildingId;
  readonly floorId: FloorId;
  readonly zoneId: RoomZoneId;
  readonly hardwareAddress: string;
}

export interface LightEntityState extends SmartHomeEntityBase {
  readonly kind: 'light';
  readonly isOn: boolean;
  readonly brightnessPct: number;
  readonly groupAddressSwitch: string;
  readonly groupAddressValue: string;
}

export interface BinarySensorEntityState extends SmartHomeEntityBase {
  readonly kind: 'binarySensor';
  readonly deviceClass: 'occupancy' | 'motion' | 'door' | 'vehicle';
  readonly isDetected: boolean;
}

export interface NumericSensorEntityState extends SmartHomeEntityBase {
  readonly kind: 'numericSensor';
  readonly deviceClass: 'illuminance' | 'temperature';
  readonly value: number;
  readonly unit: 'lx' | '°C';
}

export interface GateCoverEntityState extends SmartHomeEntityBase {
  readonly kind: 'gate';
  readonly isOpen: boolean;
  readonly isMoving: boolean;
  readonly positionPct: number;
  readonly travelDurationSec: number;
}

export type UniFiCameraModel = 'UVC-AI-Pro' | 'UVC-G5-Pro' | 'UVC-G5-Dome';
export type SmartDetectionType = 'none' | 'person' | 'vehicle';

export interface CctvCameraPose3D {
  readonly position: readonly [number, number, number];
  readonly lookAt: readonly [number, number, number];
  readonly horizontalFovDeg: number;
  readonly rangeMeters: number;
}

export interface CctvCameraEntityState extends SmartHomeEntityBase {
  readonly kind: 'camera';
  readonly model: UniFiCameraModel;
  readonly isRecording: boolean;
  readonly irNightVisionActive: boolean;
  readonly showFrustum3D: boolean;
  readonly activeDetection: SmartDetectionType;
  readonly lastDetectionSummary: string;
  readonly pose3D: CctvCameraPose3D;
  readonly cameraPresetId?: string;
}

export type UniFiAccessDeviceModel = 'UA-G2-Pro' | 'UA-Hub-Gate' | 'UA-Hub-Door-Mini';
export type AccessCredentialMethod = 'NFC Card' | 'Face Unlock' | 'Intercom PIN' | 'License Plate (LPR)' | 'Mobile Tap';
export type AccessTargetEntry = 'carGates' | 'pedestrianGate' | 'frontDoor';

export interface AccessPointEntityState extends SmartHomeEntityBase {
  readonly kind: 'accessPoint';
  readonly model: UniFiAccessDeviceModel;
  readonly targetEntry: AccessTargetEntry;
  readonly isLocked: boolean;
  readonly doorPosition: 'closed' | 'open' | 'moving';
  readonly lastCredentialMethod: AccessCredentialMethod;
  readonly lastEventTimestamp: string;
  readonly position3D: readonly [number, number, number];
  readonly rotationY?: number;
}

export type SmartHomeEntity =
  | LightEntityState
  | BinarySensorEntityState
  | NumericSensorEntityState
  | GateCoverEntityState
  | CctvCameraEntityState
  | AccessPointEntityState;

export interface SmartHomeBusEvent {
  readonly id: number;
  readonly timestamp: string;
  readonly protocol: SmartHomeProtocol;
  readonly sourceAddress: string;
  readonly targetAddress: string;
  readonly eventType: string;
  readonly summary: string;
}

export type SmartHomeHubListener = (event: {
  readonly type: 'entityChanged' | 'busEvent' | 'lodChanged';
  readonly busEvent?: SmartHomeBusEvent;
}) => void;

export interface RoomZoneOrientedBounds {
  readonly bounds: RoomBoundingBox;
  readonly offset: readonly [number, number, number];
  readonly rotationY: number;
}

export interface RoomZoneLodRegistration {
  readonly zoneId: RoomZoneId;
  readonly shortName: string;
  readonly floorId: FloorId;
  /** `false` for open-air zones (courtyards, gardens, decks). Defaults to `true`. */
  readonly isInterior?: boolean;
  readonly obb?: RoomZoneOrientedBounds;
  readonly bounds: RoomBoundingBox;
  /** Rooms sharing one open-plan volume with this room (share hero LOD focus and light spill). */
  readonly linkedOpenPlanZones?: readonly RoomZoneId[];
  /** Rooms joined to this room by an open stair void (share light spill across floors). */
  readonly linkedStairwellZones?: readonly RoomZoneId[];
  /** Floor view modes (other than this room's own floor) in which its furniture stays visible. */
  readonly crossFloorVisibleOn?: readonly string[];
  /** Walking floor elevation (m) when it differs from `bounds.minY` (e.g. screed / cellar below). */
  readonly walkingFloorY?: number;
  /** Returns `true` for XZ points inside `bounds` that are not part of the room (L-shaped rooms). */
  readonly excludedCutout?: (x: number, z: number) => boolean;
  /** Returns `true` when a scene object name belongs to this room. Overrides the `<zoneId>.` prefix rule. */
  readonly lodNameMatcher?: (name: string) => boolean;
  /**
   * Scene paths of this room's exterior doors that count as glazed portals even though their
   * names carry no glazing term (`window`, `glassdoor`, ...).
   */
  readonly exteriorPortalNamePattern?: RegExp;
  readonly floorSurface?: FloorSurfaceType;
  readonly volumeM3?: number;
  readonly primarySurface?: AcousticSurfaceMaterial;
  readonly absorptionCoeff?: number;
  readonly finishes?: RoomFinishSpec;
  readonly notes?: readonly string[];
}

/** Scene-graph naming rules a home supplies so `RoomLodController` can classify its hierarchy. */
export interface RoomLodOptions {
  /** Named groups that are wing / floor / room containers and must be unwrapped, not classified whole. */
  readonly containerNamePattern?: RegExp;
  /** Named groups that are exterior grounds and must never be unwrapped as room containers. */
  readonly exteriorGroupPattern?: RegExp;
}
