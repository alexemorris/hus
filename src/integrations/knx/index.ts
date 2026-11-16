export {
  compileEEPROMBytes,
  encodeGroupAddress,
  encodePhysicalAddress,
  formatFrameHex,
  type CompileEEPROMOptions,
} from './addressing.ts';
export {
  KNXAIAssistant,
  VoiceRecognitionController,
  buildKnxAiTools,
  type AIAssistantExecutionResult,
  type ExecutedToolCallRecord,
  type KNXFunctionDeclaration,
  type KNXToolCall,
  type KnxAssistantBus,
  type KnxAssistantDevice,
  type KnxAssistantEnvironment,
  type KnxAssistantProject,
} from './ai-assistant.ts';
export { SWITCH_SCENE_COUNT } from './scene-table.ts';
export { exportDeviceCsv, exportGroupAddressCsv } from './ga-export.ts';
export { MotionPresenceBridge, isInsideCoverage, isPointInPolygonXZ } from './motion-presence.ts';
export { findCircuit, findZone } from './project.ts';
export type {
  KnxCoverChannelConfig,
  KnxCoverageVolume,
  KnxGroupAddressEntry,
  KnxLightingZone,
  KnxMediaEndpointConfig,
  KnxPresenceDetectorDevice,
  KnxProject,
  KnxPushButtonDevice,
  KnxPushButtonGang,
  KnxZoneGroupAddresses,
} from './project.ts';
export { ZoneLightingController } from './zone-lighting.ts';
export {
  buildTP1FrameHex,
  decodeDpt1,
  decodeDpt17Scene,
  decodeDpt18SceneControl,
  decodeDpt5Scaling,
  decodeDpt9Float,
  encodeDpt1,
  encodeDpt17Scene,
  encodeDpt18SceneControl,
  encodeDpt5Scaling,
  encodeDpt9Float,
  parseTP1FrameHex,
} from './dpt-codec.ts';
export {
  KNXPropertyBusController,
  type KnxPresenceState,
  type KnxZoneStateView,
} from './emulator.ts';
export {
  LoopbackSimulationTransport,
  WebSocketKNXGatewayTransport,
  type KNXBusTransport,
} from './transport.ts';
