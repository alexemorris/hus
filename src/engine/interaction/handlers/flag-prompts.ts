import type { InteractiveUserData } from '../../../core/types/scene.ts';

/**
 * Prompt for meshes identified by generic `InteractiveUserData` traits rather than a registry id:
 * custom prompt labels, KNX switches, sensors, lighting circuits, UFH zones, CCTV cameras, and access readers.
 */
export function describeFlagInteractable(data: InteractiveUserData): string {
  if (data.interactionPromptLabel) {
    return data.interactionPromptLabel;
  }
  if (data.isClimbableLadder) {
    return '';
  }
  if (data.isKNXSwitch || data.zoneSceneSwitchZoneId) {
    return data.switchDirection
      ? `Toggle Light Switch (${data.switchDirection === 'up' ? 'Up' : 'Down'})`
      : 'Toggle KNX Light Switch';
  }
  if (data.isKnxTempSensor) {
    return 'Inspect KNX Temperature Probe';
  }
  if (data.circuitId || data.electricalSwitchId || data.electricalDimmerId) {
    return 'Toggle Light Switch / Fixture';
  }
  if (data.ufhZoneId) {
    return 'Toggle Underfloor Heating Zone';
  }
  if (data.roomMotionSensorId || data.presenceDetectorPa) {
    return 'Trigger KNX Motion Sensor';
  }
  if (data.accessEntityId || data.isUniFiAccessReader) {
    return 'Unlock Access Reader';
  }
  if (data.cameraEntityId || data.isUniFiCamera) {
    return 'Trigger CCTV Smart Detection';
  }
  return 'Interact';
}
