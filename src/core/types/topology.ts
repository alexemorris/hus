import type { RoomFinishSpec } from './twin-ux.ts';
import type { AcousticSurfaceMaterial, FloorSurfaceType } from './acoustics.ts';
import type { CircuitId } from './knx.ts';

/**
 * Multi-building, multi-floor, and multi-room spatial & KNX topology types
 * designed to scale from the Kitchen/Utility/Courtyard wing to the entire
 * a multi-building architectural estate.
 */

/**
 * Building id. The literals keep IDE autocomplete for the reference home; any other
 * house-defined string id is accepted.
 */
export type BuildingId = 'mainHouse' | 'annex' | 'courtyardGrounds' | (string & {});

/** Floor id (`'exterior'` marks grounds / outdoor zones). Any house-defined string id is accepted. */
export type FloorId = 'ground' | 'first' | 'attic' | 'exterior' | (string & {});

/** Room zone id. Any house-defined string id is accepted alongside the known literals. */
export type RoomZoneId =
  | 'kitchen'
  | 'sitting'
  | 'utility'
  | 'familyRoom'
  | 'bootLobby'
  | 'hall'
  | 'livingRoom'
  | 'entranceHall'
  | 'sittingRoom'
  | 'study'
  | 'mainBedroom'
  | 'familyBathroom'
  | 'upperLanding'
  | 'bedroom2'
  | 'bedroom3'
  | 'bedroom4'
  | 'courtyard'
  | 'hallway'
  | 'diningRoom'
  | 'snug'
  | 'masterBedroom'
  | 'annexLiving'
  | 'annexBedroom'
  | 'outbuildingGym'
  | 'outbuildingGarage'
  | 'outbuildingStore'
  | 'outbuildingBarn'
  | 'outbuildingMezzanine'
  | 'outbuildingStableOffice'
  | 'outbuildingStableSuite'
  | (string & {});

export interface RoomBoundingBox {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface NightWalkZoneRule {
  readonly sensorGa: string;
  readonly levels: Readonly<Partial<Record<CircuitId, number>>>;
}

export interface BuildingDefinition {
  readonly id: BuildingId;
  readonly name: string;
  readonly knxArea: number;
  readonly description: string;
}

export interface FloorDefinition {
  readonly id: FloorId;
  readonly buildingId: BuildingId;
  readonly name: string;
  readonly elevationY: number;
  readonly ceilingHeight: number;
  readonly knxLine: string;
}

export interface RoomZoneDefinition {
  readonly id: RoomZoneId;
  readonly name: string;
  readonly shortName: string;
  readonly buildingId: BuildingId;
  readonly floorId: FloorId;
  readonly knxAreaLine: string;
  readonly isInterior: boolean;
  readonly bounds: RoomBoundingBox;
  readonly nightWalkRule?: NightWalkZoneRule;
  readonly floorSurface?: FloorSurfaceType;
  readonly volumeM3?: number;
  readonly primarySurface?: AcousticSurfaceMaterial;
  readonly absorptionCoeff?: number;
  readonly finishes?: RoomFinishSpec;
  readonly notes?: readonly string[];
}

export type KNXDeviceRole =
  | 'ipGateway'
  | 'aiBridge'
  | 'wallSwitch'
  | 'pirLuxSensor'
  | 'dimmingActuator'
  | 'mediaEndpoint'
  | 'gateController';

export interface KNXPhysicalDeviceDefinition {
  readonly pa: string;
  readonly name: string;
  readonly buildingId: BuildingId;
  readonly floorId: FloorId;
  readonly zoneId: RoomZoneId;
  readonly role: KNXDeviceRole;
  readonly maskVersion: string;
  readonly description: string;
}
