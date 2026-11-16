import type { RoomFinishSpec } from './twin-ux.ts';
import type { AcousticSurfaceMaterial, FloorSurfaceType } from './acoustics.ts';
import type { CircuitId } from './knx.ts';

/**
 * Multi-building, multi-floor, and multi-room spatial & KNX topology types
 * for any single-building or multi-building architectural digital twin.
 */

/** Building identifier defined by the active home. */
export type BuildingId = string;

/** Floor id (`'exterior'` marks grounds / outdoor zones). Any house-defined string id is accepted. */
export type FloorId = 'ground' | 'first' | 'attic' | 'exterior' | (string & {});

/** Room / zone identifier defined by the active home. */
export type RoomZoneId = string;

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
