export * from '../integrations/knx/index.ts';
export * from '../integrations/knx/electrical-adapter.ts';
export { distanceToPolygonXZ } from '../integrations/knx/motion-presence.ts';
export type {
  KnxCentralDeviceAddresses,
  KnxCentralGroupAddresses,
  KnxPresenceLegacyBinding,
} from '../integrations/knx/project.ts';
export type { RoomAutomationConfig } from '../integrations/knx/room-automation.ts';
export { SmartHomeHub } from '../integrations/smart-home-hub.ts';
export type * from '../core/types/knx.ts';
export * from '../core/types/knx-zones.ts';
export type {
  BuildingDefinition,
  BuildingId,
  FloorDefinition as KnxFloorDefinition,
  FloorId,
  KNXDeviceRole,
  KNXPhysicalDeviceDefinition,
  NightWalkZoneRule,
  RoomBoundingBox,
  RoomZoneDefinition,
  RoomZoneId,
} from '../core/types/topology.ts';
