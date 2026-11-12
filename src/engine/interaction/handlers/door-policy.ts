/**
 * Per-home door behaviour keyed by stable door ids (see `device-ids.ts`), so the rules survive
 * zone modules adding/removing doors (legacy `door-N` numbers shift with build order).
 */
export interface DoorPolicy {
  /**
   * Doors (or bi-fold cupboards) whose open swing envelopes share the same pocket. Opening the
   * key closes every listed neighbour so leaves never intersect.
   */
  readonly conflicts: Readonly<Record<string, readonly string[]>>;
  /** Explicit open angles (radians) overriding the default swing heuristic. */
  readonly openAngles: Readonly<Record<string, number>>;
  /** Split (stable) door leaves that a walkthrough barge opens together. */
  readonly splitLeafPairs: readonly (readonly [string, string])[];
}

export const EMPTY_DOOR_POLICY: DoorPolicy = { conflicts: {}, openAngles: {}, splitLeafPairs: [] };

/** Builds a symmetric conflict table from groups of `[door, ...neighbours]`. */
export function symmetricConflicts(
  groups: readonly (readonly [string, readonly string[]])[]
): Readonly<Record<string, readonly string[]>> {
  const out: Record<string, string[]> = {};
  const add = (a: string, b: string): void => {
    const list = (out[a] ??= []);
    if (!list.includes(b)) list.push(b);
  };
  for (const [door, neighbours] of groups) {
    for (const n of neighbours) {
      add(door, n);
      add(n, door);
    }
  }
  return out;
}
