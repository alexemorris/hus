import type { InteractiveUserData } from '../../../core/types/scene.ts';

/**
 * Pseudo interactable ids for devices whose state is owned outside the interaction registry
 * (KNX emulator / PropertyScene). Activating one must go through the same path as clicking the
 * device's mesh, so `PropertyScene.handleInteractableClick` forwards this synthetic userData to
 * its `onObjectInteraction` callback (keeping the KNX bus state in sync).
 */
const PSEUDO_DEVICE_USER_DATA: Readonly<Record<string, InteractiveUserData>> = {
  'car-gates': { isCarGate: true },
  'kitchen-bifolds': { isBifoldDoor: true },
  'frame-tv': { isFrameTV: true },
};

/** Registry-handled group id: toggles every overhead (up-and-over) garage door together. */
export const GARAGE_DOOR_GROUP_ID = 'garage-door';

export function getPseudoDeviceUserData(id: string): InteractiveUserData | null {
  return PSEUDO_DEVICE_USER_DATA[id] ?? null;
}

export function listPseudoDeviceIds(): readonly string[] {
  return Object.keys(PSEUDO_DEVICE_USER_DATA);
}
