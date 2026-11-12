import type { InteractiveUserData } from '../../../core/types/scene.ts';

/** Live state needed to phrase prompts for flag-tagged (non-registry) interactables. */
export interface FlagPromptState {
  readonly isBifoldsOpen: boolean;
  readonly isCarGatesOpen: boolean;
  golfPrompt(): string;
}

/**
 * Prompt for meshes identified by userData flags rather than a registry id: bifold patio doors,
 * car gates, KNX switches, Frame TV, sensors, UFH zones, UniFi cameras/readers.
 */
export function describeFlagInteractable(
  data: InteractiveUserData,
  state: FlagPromptState
): string {
  if (data.isGolfSimulatorShot) {
    return state.golfPrompt();
  }
  if (data.isBifoldDoor) {
    return `${state.isBifoldsOpen ? 'Close' : 'Open'} Bifold Patio Doors`;
  }
  if (data.isClimbableLadder) {
    return '';
  }
  if (data.isCarGate) {
    return `${state.isCarGatesOpen ? 'Close' : 'Open'} Courtyard Gates`;
  }
  if (data.isKNXSwitch || data.isCourtyardSwitch || data.isUtilitySwitch) {
    return data.switchDirection
      ? `Toggle Light Switch (${data.switchDirection === 'up' ? 'Up' : 'Down'})`
      : 'Toggle KNX Light Switch';
  }
  if (data.isFrameTV) {
    return 'Cycle Frame TV Artwork';
  }
  if (data.isKnxTempSensor) {
    return 'Inspect KNX Temperature Probe';
  }
  if (data.circuitId) {
    return 'Toggle Light Switch / Fixture';
  }
  if (data.ufhZoneId) {
    return 'Toggle Underfloor Heating Zone';
  }
  if (data.roomMotionSensorId || data.isKitchenMotionSensor || data.isUtilityMotionSensor) {
    return 'Trigger KNX Motion Sensor';
  }
  if (data.accessEntityId || data.isUniFiAccessReader) {
    return 'Unlock Gate Intercom';
  }
  if (data.cameraEntityId || data.isUniFiCamera) {
    return 'Trigger CCTV Smart Detection';
  }
  return 'Interact';
}
