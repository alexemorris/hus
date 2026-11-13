export {
  computeAnimationStepSeconds,
  defineHouse,
  mountHouse,
  type HouseDefinition,
  type HouseDefinitionConfig,
  type HouseLensesConfig,
  type HousePortalsConfig,
  type HouseRoomsConfig,
  type HouseSmartHomeAddresses,
  type HouseSmartHomeConfig,
  type HouseZonesConfig,
  type MountHouseOptions,
  type MountHouseRuntimeContext,
  type MountHouseRuntimeHandle,
  type MountedHouse,
} from './house.ts';

export * from '../core/electrical/index.ts';
export * from '../core/entities.ts';
export * from '../core/geo/climate-phenology.ts';
export * from '../core/geo/frame2d.ts';
export * from '../core/geo/terrain-modifiers.ts';
export * from '../core/geo/terrain-sculpt.ts';
export { createDefaultHouseRuntime } from './default-runtime.ts';
export {
  formatCivilHourHHMM,
  formatDayOfYearShort,
  formatDurationHoursHM,
  formatLatLonCoords,
  formatUtcOffsetLabel,
  forwardXZToTrueBearingDeg,
  projectCelestialOnCompassRose,
  weatherConditionShortLabel,
} from '../core/solar-weather-format.ts';
export * from '../core/types/acoustics.ts';
export type * from '../core/types/knx.ts';
export * from '../core/types/knx-zones.ts';
export * from '../core/types/scene.ts';
export * from '../core/types/environment-hdri.ts';
export * from '../core/types/solar-weather.ts';
export type {
  BuildingDefinition,
  BuildingId,
  FloorDefinition as TopologyFloorDefinition,
  FloorId,
  KNXDeviceRole,
  KNXPhysicalDeviceDefinition,
  NightWalkZoneRule,
  RoomBoundingBox,
  RoomZoneDefinition,
  RoomZoneId,
} from '../core/types/topology.ts';
export type * from '../core/types/twin-api.ts';
export * from '../core/types/twin-ux.ts';

export * from '../core/assets/asset-metadata.ts';

export { paintSpecFromSwatch } from '../engine/textures/paint-system.ts';
