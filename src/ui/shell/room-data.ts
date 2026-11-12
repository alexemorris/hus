import type { FloorViewMode } from '../../core/types/scene.ts';
import type { TwinFloorInfo } from '../../core/types/twin-api.ts';

/** Property name shown when the twin does not report one. */
export const DEFAULT_PROPERTY_NAME = 'Digital Twin';

/** Fallback display name of the property (top bar, 'no room' label). */
export const PROPERTY_NAME = DEFAULT_PROPERTY_NAME;

/** Storeys assumed when the twin does not list any. */
export const DEFAULT_FLOORS: readonly TwinFloorInfo[] = [
  { id: 'ground', label: 'Ground' },
  { id: 'first', label: 'First' },
];

/** The slice of `TwinApi` the floor helpers read (both members optional for older twins). */
export interface FloorsSource {
  readonly floors: {
    list?(): readonly TwinFloorInfo[];
    propertyName?(): string;
  };
}

export function listFloors(api: FloorsSource): readonly TwinFloorInfo[] {
  return api.floors.list?.() ?? DEFAULT_FLOORS;
}

export function propertyNameOf(api: FloorsSource): string {
  return api.floors.propertyName?.() ?? DEFAULT_PROPERTY_NAME;
}

export interface FloorPill {
  readonly id: FloorViewMode;
  readonly label: string;
  /** Keyboard digit that selects the pill (`''` beyond the ninth). */
  readonly key: string;
}

const MAX_DIGIT_KEY = 9;

/**
 * Floor-switcher pills: one per storey plus `All`. A single-storey home has nothing to switch
 * between, so it gets no pills (and the switcher is hidden).
 */
export function buildFloorPills(floors: readonly TwinFloorInfo[]): readonly FloorPill[] {
  if (floors.length <= 1) return [];
  const modes: readonly { readonly id: FloorViewMode; readonly label: string }[] = [
    ...floors.map((f) => ({ id: f.id, label: f.label })),
    { id: 'all', label: 'All' },
  ];
  return modes.map((m, i) => ({ ...m, key: i < MAX_DIGIT_KEY ? String(i + 1) : '' }));
}

/** The floor mode a digit key (1-9) selects, or `null` when that digit is unassigned. */
export function floorModeForDigit(
  floors: readonly TwinFloorInfo[],
  digit: number
): FloorViewMode | null {
  if (!Number.isInteger(digit) || digit < 1 || digit > MAX_DIGIT_KEY) return null;
  return buildFloorPills(floors)[digit - 1]?.id ?? null;
}

function humanizeFloorId(id: string): string {
  const spaced = id
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Eyebrow text for a room's floor, e.g. `'First floor'`. */
export function floorEyebrowLabel(floors: readonly TwinFloorInfo[], floorId: string): string {
  if (floorId === 'exterior') return 'Outside';
  const label = floors.find((f) => f.id === floorId)?.label ?? humanizeFloorId(floorId);
  return /floor$/i.test(label) ? label : `${label} floor`;
}
