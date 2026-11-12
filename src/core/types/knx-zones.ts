/**
 * Structural contract for a KNX controller that models per-room lighting
 * ZONES (stored zone scenes, Full / Night / Off central objects, push-buttons
 * and presence detectors).
 *
 * It mirrors the methods `KNXPropertyBusController` gains on the knx-lighting
 * branch, so the app layer can feature-detect them with {@link isKnxZoneBus}
 * and fall back to a derived zone model on controllers that predate them.
 * Only plain data and ids — no engine or integration imports.
 */
import type { CircuitId } from './knx.ts';
import type { RoomZoneId } from './topology.ts';

/** Fitting type carried by one circuit (one type per circuit) — drives UI grouping. */
export type LightingLayerKind =
  | 'pendants'
  | 'downlights'
  | 'spots'
  | 'battens'
  | 'wall'
  | 'picture'
  | 'shelf'
  | 'cove'
  | 'strip'
  | 'step'
  | 'uplights'
  | 'task'
  | 'lamps'
  | 'feature'
  | 'exterior';

/** Every layer kind in the order rooms present them (ambient → accent → plug-in → exterior). */
export const LIGHTING_LAYER_ORDER: readonly LightingLayerKind[] = [
  'pendants',
  'downlights',
  'spots',
  'battens',
  'uplights',
  'wall',
  'picture',
  'shelf',
  'cove',
  'strip',
  'step',
  'task',
  'feature',
  'lamps',
  'exterior',
];

export const LIGHTING_LAYER_LABELS: Readonly<Record<LightingLayerKind, string>> = {
  pendants: 'Pendants',
  downlights: 'Downlights',
  spots: 'Spotlights',
  battens: 'Battens',
  wall: 'Wall lights',
  picture: 'Picture lights',
  shelf: 'Shelf & joinery',
  cove: 'Cove',
  strip: 'LED strips',
  step: 'Step lights',
  uplights: 'Uplights',
  task: 'Task',
  lamps: 'Lamps (5 A)',
  feature: 'Feature',
  exterior: 'Exterior',
};

/**
 * Lighting state of a zone as owned by its actuator channels:
 * `scene` (stored zone scene `sceneIndex`), `full` (hold-up), `night`
 * (hold-down night object), `manual` (channels set individually), `off`.
 */
export type KnxZoneMode = 'scene' | 'full' | 'night' | 'manual' | 'off';

export interface KnxZoneState {
  readonly mode: KnxZoneMode;
  readonly sceneIndex: number | null;
}

/** A stored zone scene (levels for the zone's channels; omitted channels go to 0 %). */
export interface KnxZoneScene {
  readonly id: string;
  readonly label: string;
  readonly levels: Readonly<Partial<Record<CircuitId, number>>>;
}

/** The subset of a lighting zone the UI needs. `id` is the room's zone id (1 zone per room). */
export interface KnxZoneDescriptor {
  readonly id: RoomZoneId;
  readonly name: string;
  readonly circuits: readonly CircuitId[];
  readonly scenes: readonly KnxZoneScene[];
}

/** The subset of `CircuitConfig` the zone UI needs (a full `CircuitConfig` satisfies it). */
export interface KnxZoneCircuit {
  readonly id: CircuitId;
  readonly name: string;
  /** Friendly label. */
  readonly shortName: string;
  readonly zoneId: RoomZoneId;
  readonly kind?: LightingLayerKind;
  /** `undefined` = dimmable. */
  readonly dimmable?: boolean;
}

export interface KnxZonePushButtonGang {
  readonly gang: number;
  readonly zoneId: RoomZoneId;
  readonly label: string;
}

export interface KnxZonePushButton {
  readonly pa: string;
  readonly name: string;
  readonly mountedInZoneId: RoomZoneId;
  readonly location: string;
  readonly gangs: readonly KnxZonePushButtonGang[];
}

export interface KnxZonePresenceDetector {
  readonly pa: string;
  readonly name: string;
  readonly zoneId: RoomZoneId;
}

export interface KnxZonePresenceState {
  readonly detected: boolean;
  readonly lastSeenSimSec: number | null;
}

/** Zone-model methods of a KNX bus controller (see file comment). */
export interface KnxZoneBus {
  getZones(): readonly KnxZoneDescriptor[];
  getZoneState(zoneId: RoomZoneId): KnxZoneState;
  recallZoneScene(zoneId: RoomZoneId, sceneIndex: number, sourcePa?: string, location?: string): void;
  setZoneFull(zoneId: RoomZoneId, sourcePa?: string, location?: string): void;
  enterZoneNight(zoneId: RoomZoneId, sourcePa?: string, location?: string): void;
  setZoneOff(zoneId: RoomZoneId, sourcePa?: string): void;
  handleZoneSwitchGesture(
    zoneId: RoomZoneId,
    direction: 'up' | 'down',
    pressDurationMs: number,
    sourcePa?: string,
    location?: string
  ): void;
  getPushButtons(): readonly KnxZonePushButton[];
  getPresenceDetectors(): readonly KnxZonePresenceDetector[];
  getPresenceState(pa: string): KnxZonePresenceState;
  getCircuits(): readonly KnxZoneCircuit[];
}

const KNX_ZONE_BUS_METHODS = [
  'getZones',
  'getZoneState',
  'recallZoneScene',
  'setZoneFull',
  'enterZoneNight',
  'setZoneOff',
  'handleZoneSwitchGesture',
  'getPushButtons',
  'getPresenceDetectors',
  'getPresenceState',
  'getCircuits',
] as const satisfies readonly (keyof KnxZoneBus)[];

/** True when `bus` implements every {@link KnxZoneBus} method. */
export function isKnxZoneBus(bus: object): bus is KnxZoneBus {
  return KNX_ZONE_BUS_METHODS.every((m) => typeof Reflect.get(bus, m) === 'function');
}
