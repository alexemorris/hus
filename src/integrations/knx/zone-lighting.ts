import type { CircuitId, ZoneLightingMode } from '../../core/types/knx.ts';
import type { RoomZoneId } from '../../core/types/topology.ts';
import type { KnxLightingZone } from './project.ts';

export type ZoneLevels = Partial<Record<CircuitId, number>>;

export interface ZoneLightingState {
  readonly mode: ZoneLightingMode;
  /** Last recalled zone scene (kept while in full / night / off so "down" can resume it). */
  readonly sceneIndex: number;
}

export type SwitchDirection = 'up' | 'down';

/**
 * Pure model of the actuator-side zone objects every KNX lighting zone shares:
 * stored scenes stepped by short presses, a full-on object (hold up) and a night object
 * (hold down). It decides levels and modes; the bus controller applies the levels to its
 * channels and sends the telegrams.
 *
 * Gesture model (identical for every toggle in the house):
 * - short ▲ / ▼  → next / previous stored scene (wraps); from off / night / full / manual,
 *                  ▲ wakes into scene 1 and ▼ into the last used scene
 * - hold ▲       → full brightness (all zone channels 100 %)
 * - hold ▼       → night mode: night levels (3–5 %) when dark, otherwise off
 */
export class ZoneLightingController {
  private readonly zones = new Map<RoomZoneId, KnxLightingZone>();
  private readonly state = new Map<RoomZoneId, ZoneLightingState>();

  public constructor(zones: readonly KnxLightingZone[]) {
    for (const zone of zones) {
      this.zones.set(zone.id, zone);
      this.state.set(zone.id, { mode: 'scene', sceneIndex: 0 });
    }
  }

  public getZone(zoneId: RoomZoneId): KnxLightingZone | undefined {
    return this.zones.get(zoneId);
  }

  public getZones(): readonly KnxLightingZone[] {
    return [...this.zones.values()];
  }

  public getState(zoneId: RoomZoneId): ZoneLightingState {
    return this.state.get(zoneId) ?? { mode: 'off', sceneIndex: 0 };
  }

  /** Zones whose channel list includes `circuitId` (zones may overlap, e.g. open-plan kitchen). */
  public zonesForCircuit(circuitId: CircuitId): readonly KnxLightingZone[] {
    return [...this.zones.values()].filter((z) => z.circuits.includes(circuitId));
  }

  public setState(zoneId: RoomZoneId, next: ZoneLightingState): void {
    if (this.zones.has(zoneId)) {
      this.state.set(zoneId, next);
    }
  }

  /** Index of the scene a short press in `direction` selects, given whether the zone is lit. */
  public nextSceneIndex(zoneId: RoomZoneId, direction: SwitchDirection, anyOn: boolean): number {
    const zone = this.zones.get(zoneId);
    const count = zone?.scenes.length ?? 0;
    if (count === 0) return 0;
    const current = this.getState(zoneId);
    const steppable = anyOn && current.mode === 'scene';
    if (!steppable) {
      if (direction === 'up') return 0;
      return current.mode === 'off' || current.mode === 'night' || !anyOn
        ? count - 1
        : clampIndex(current.sceneIndex, count);
    }
    const step = direction === 'up' ? 1 : -1;
    return (clampIndex(current.sceneIndex, count) + step + count) % count;
  }

  /** Levels for every zone channel in scene `index` (channels the scene omits go to 0 %). */
  public sceneLevels(zoneId: RoomZoneId, index: number): ZoneLevels {
    const zone = this.zones.get(zoneId);
    const levels: ZoneLevels = {};
    const scene = zone?.scenes[index];
    if (!zone || !scene) return levels;
    for (const id of zone.circuits) {
      levels[id] = clampPct(scene.levels[id] ?? 0);
    }
    return levels;
  }

  public fullLevels(zoneId: RoomZoneId): ZoneLevels {
    return this.uniformLevels(zoneId, 100);
  }

  public offLevels(zoneId: RoomZoneId): ZoneLevels {
    return this.uniformLevels(zoneId, 0);
  }

  /** Night-object levels when dark; all-off in daylight (night mode never lights a bright room). */
  public nightLevels(zoneId: RoomZoneId, isDark: boolean): ZoneLevels {
    const zone = this.zones.get(zoneId);
    const levels: ZoneLevels = {};
    if (!zone) return levels;
    for (const id of zone.circuits) {
      levels[id] = isDark ? clampPct(zone.nightLevels[id] ?? 0) : 0;
    }
    return levels;
  }

  public markScene(zoneId: RoomZoneId, index: number): void {
    this.setState(zoneId, { mode: 'scene', sceneIndex: index });
  }

  public markMode(zoneId: RoomZoneId, mode: ZoneLightingMode): void {
    const prev = this.getState(zoneId);
    this.setState(zoneId, { mode, sceneIndex: prev.sceneIndex });
  }

  /** Records a manual channel change: the zone becomes `manual`, or `off` when nothing is lit. */
  public noteManual(zoneId: RoomZoneId, anyOn: boolean): void {
    this.markMode(zoneId, anyOn ? 'manual' : 'off');
  }

  private uniformLevels(zoneId: RoomZoneId, pct: number): ZoneLevels {
    const zone = this.zones.get(zoneId);
    const levels: ZoneLevels = {};
    if (!zone) return levels;
    for (const id of zone.circuits) {
      levels[id] = pct;
    }
    return levels;
  }
}

function clampIndex(index: number, count: number): number {
  return Math.max(0, Math.min(count - 1, index));
}

function clampPct(pct: number): number {
  return Math.max(0, Math.min(100, Math.round(pct)));
}
