import type { BuildingId, FloorId, RoomZoneId } from './topology.ts';
import type { LightingLayerKind } from './knx-zones.ts';

/**
 * Strict TypeScript domain models for the Hus KNX TP1 / cEMI Bus & Digital Twin.
 */

export type KitchenSceneCircuitId =
  | 'islandPendants'
  | 'sittingPendants'
  | 'bifoldUplights'
  | 'spotlights'
  | 'underCabinet'
  | 'aboveCabinet';

export type OutdoorCircuitId = 'courtyardFestoons' | 'reclaimedLampPost';

export type RoomPendantCircuitId =
  | 'diningPendant'
  | 'bootLobbyPendant'
  | 'hallPendant'
  | 'frontRoomPendant'
  | 'entranceHallPendant'
  | 'livingRoomPendant'
  | 'studyPendant'
  | 'mainBedroomPendant'
  | 'familyBathroomPendant'
  | 'upperLandingPendant'
  | 'bedroom2Pendant'
  | 'bedroom3Pendant'
  | 'bedroom4Pendant'
  | 'hallStairLeds'
  | 'hallBeamLeds'
  | 'hallLamps5A'
  | 'walkInCupboardLeds'
  | 'livingRoomShelfLeds'
  | 'livingRoomTvBacklight'
  | 'livingRoomWallLights'
  | 'livingRoomDownlights'
  | 'sittingRoomLamps5A'
  | 'sittingRoomShelfLeds'
  | 'upperLandingSconces';

/** Room circuits switched automatically by a room PIR (see `MOTION_CIRCUIT_RULES`). */
export type MotionCircuitId = 'wineCellarLeds' | 'cloakroomWcLights';

/** Room PIR presence sensors handled by the generic room automation. */
export type RoomMotionSensorId = 'wineCellar' | 'cloakroomWc';

export type OutbuildingCircuitId =
  | 'gymSpotsAndBattens'
  | 'gymWallAndCoveLights'
  | 'garageHighBayLights'
  | 'garageBenchAndShower'
  | 'barnTrussAndSimHalo'
  | 'barnBarsAndLamps5A'
  | 'mezzanineSconcesAndAmbient'
  | 'mezzanineLamps5A'
  | 'stableOfficeSpotlights'
  | 'stableOfficeWallsAndLamps5A'
  | 'stableSuiteDownlights'
  | 'stableSuiteLamps5A'
  | 'gymMirrorBacklights'
  | 'gymCoveLeds'
  | 'gymTrussSpots'
  | 'garageShowerLights'
  | 'garageTrussSpots'
  | 'storeLoftLeds'
  | 'golfSimHalo'
  | 'barnCoveLeds'
  | 'barnWallSconces'
  | 'barnStairLeds'
  | 'barnPoolTableLight'
  | 'barnPictureLights'
  | 'mezzanineDownlights'
  | 'mezzanineBookcaseLight'
  | 'stableCloakroomLights'
  | 'stableOfficeLamps5A'
  | 'stableEnsuiteLights'
  | 'stableBalconyLights';

/** Exterior feature circuits outside the legacy kitchen scene `outdoorLevels`. */
export type ExteriorFeatureCircuitId = 'pergolaFestoons' | 'stableExternalWallLights';

export type CircuitId =
  | KitchenSceneCircuitId
  | 'utilitySpotlights'
  | 'familyRoomSpots'
  | 'diningPictureLight'
  | 'diningFairyLights'
  | RoomPendantCircuitId
  | MotionCircuitId
  | 'entranceHallUplights'
  | OutdoorCircuitId
  | ExteriorFeatureCircuitId
  | OutbuildingCircuitId;

export type SceneCircuitLevels = Record<KitchenSceneCircuitId, number>;
export type OutdoorCircuitLevels = Record<OutdoorCircuitId, number>;
export type CircuitLevels = Record<CircuitId, number>;

/** Lighting fitting type carried by a single circuit. */
/** Fitting type carried by one circuit — the same vocabulary the zone UI groups layers by. */
export type CircuitKind = LightingLayerKind;

export interface CircuitConfig {
  readonly id: CircuitId;
  readonly channel: number;
  readonly name: string;
  readonly shortName: string;
  readonly location: string;
  readonly buildingId: BuildingId;
  readonly floorId: FloorId;
  readonly zoneId: RoomZoneId;
  readonly actuatorPa: string;
  readonly gaSwitch: string;
  readonly gaValue: string;
  readonly gaStatus: string;
  readonly isSceneMember: boolean;
  /** Fitting type on this channel (one type per circuit) — drives UI grouping and audits. */
  readonly kind?: CircuitKind;
  /** False for switched-only channels (5 A lamp sockets on a relay, LED drivers without DALI). */
  readonly dimmable?: boolean;
  /** Level the actuator channel boots at (percent). Defaults to 85. */
  readonly defaultLevel?: number;
  /** Extra natural-language names ("island pendants", "barn downlights") for the AI resolver. */
  readonly aliases?: readonly string[];
}

/** A per-zone lighting scene stepped by the zone's wall toggles (Bright → … → Night). */
export interface ZoneScenePreset {
  readonly id: string;
  readonly label: string;
  readonly levels: Readonly<Partial<Record<CircuitId, number>>>;
}

/**
 * Lighting state of a zone as owned by its actuator channels:
 * - `scene`: a stored zone scene is active (`sceneIndex`)
 * - `full`: hold-up full brightness
 * - `night`: hold-down night object (very dim)
 * - `manual`: individual channels set from UI / AI / bus
 * - `off`: everything 0 % (e.g. night mode timed out on vacancy)
 */
export type ZoneLightingMode = 'scene' | 'full' | 'night' | 'manual' | 'off';

export interface AuxiliaryCircuitLevels {
  utilitySpotlights?: number;
  familyRoomSpots?: number;
}

export interface ScenePreset {
  readonly index: number;
  readonly number: number;
  readonly code: string;
  readonly name: string;
  readonly shortLabel: string;
  readonly isSwitchScene: boolean;
  levels: SceneCircuitLevels;
  outdoorLevels?: OutdoorCircuitLevels;
  auxiliaryLevels?: AuxiliaryCircuitLevels;
}

export type ShortPressMode = 'cycle3' | 'toggle13';
export type WakeBehavior = 'first' | 'last';

export interface DeviceParameters {
  holdThresholdMs: number;
  shortPressMode: ShortPressMode;
  wakeBehavior: WakeBehavior;
  rampSpeedSec: number;
  luxThreshold: number;
}

export interface TelegramEmitInput {
  readonly src: string;
  readonly dst: string;
  readonly isGroup?: boolean;
  readonly apci: string;
  readonly dpt: string;
  readonly summary: string;
  readonly payloadBytes: readonly number[];
  readonly fromExternalBus?: boolean;
}

export interface KNXTelegram {
  readonly id: number;
  readonly timestamp: string;
  readonly src: string;
  readonly dst: string;
  readonly isGroup: boolean;
  readonly apci: string;
  readonly dpt: string;
  readonly summary: string;
  readonly hex: string;
  readonly direction?: 'tx' | 'rx' | 'sim';
}

export type KNXTransportMode = 'simulation' | 'websocket-gateway';
export type KNXTransportStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

export interface InboundKNXFrame {
  readonly src?: string;
  readonly dst: string;
  readonly isGroup?: boolean;
  readonly apci?: string;
  readonly dpt?: string;
  readonly payloadBytes?: readonly number[];
  readonly hex?: string;
  readonly summary?: string;
}

export type KNXBusEvent =
  | { readonly type: 'telegram'; readonly telegram: KNXTelegram }
  | {
      readonly type: 'stateChange';
      readonly reason:
        | 'masterOff'
        | 'masterFull'
        | 'sceneRecall'
        | 'circuitLevel'
        | 'sensorChange'
        | 'carGateChange'
        | 'externalBusSync';
    }
  | { readonly type: 'eepromChanged' }
  | { readonly type: 'flashed'; readonly params: Readonly<DeviceParameters> }
  | {
      readonly type: 'transportStatus';
      readonly mode: KNXTransportMode;
      readonly status: KNXTransportStatus;
      readonly endpointUrl?: string;
    };

export type KNXEventListener = (event: KNXBusEvent) => void;
