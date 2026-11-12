import type { RoomZoneLodRegistration } from '../../core/entities.ts';

/**
 * Active home's room zones (bounds + short names) for engine helpers that
 * classify world positions into rooms outside a `PropertyScene` instance
 * (e.g. annotation room lookup).
 *
 * Populated from `PropertySceneProfile.lodRegistrations` when scene content is
 * built (`buildPropertySceneContent`), which every runtime and tool path calls
 * before using these helpers.
 */
let activeRegistrations: readonly RoomZoneLodRegistration[] = [];

export function setRoomZoneRegistrations(registrations: readonly RoomZoneLodRegistration[]): void {
  activeRegistrations = registrations;
}

export function getRoomZoneRegistrations(): readonly RoomZoneLodRegistration[] {
  return activeRegistrations;
}
