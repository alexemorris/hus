import type { RoomZoneId } from '../../core/types/topology.ts';
import type { KnxCoverageVolume, KnxPresenceDetectorDevice } from './project.ts';

/** World position of a person's feet, as an object or `[x, y, z]` tuple. */
export type FootPosition =
  | { readonly x: number; readonly y: number; readonly z: number }
  | readonly [number, number, number];

/** Detection field of one presence detector. */
export interface PresenceSensorFootprint {
  readonly pa: string;
  readonly zoneId: RoomZoneId;
  readonly coverage: KnxCoverageVolume;
}

/** Receives "movement seen now" events (implemented by `KNXPropertyBusController.reportPresence`). */
export interface PresenceSink {
  reportPresence(detectorPa: string): void;
}

/** Even-odd point-in-polygon test on the XZ plane. */
export function isPointInPolygonXZ(
  x: number,
  z: number,
  polygon: readonly (readonly [number, number])[]
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i]!;
    const [xj, zj] = polygon[j]!;
    const crosses = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Distance (m) from an XZ point to a polygon: 0 inside, otherwise to the nearest edge. */
export function distanceToPolygonXZ(
  x: number,
  z: number,
  polygon: readonly (readonly [number, number])[]
): number {
  if (isPointInPolygonXZ(x, z, polygon)) return 0;
  let best = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, az] = polygon[j]!;
    const [bx, bz] = polygon[i]!;
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return best;
}

export function isInsideCoverage(x: number, y: number, z: number, coverage: KnxCoverageVolume): boolean {
  return y >= coverage.minY && y <= coverage.maxY && isPointInPolygonXZ(x, z, coverage.polygon);
}

function toXyz(pos: FootPosition): readonly [number, number, number] {
  return 'x' in pos ? [pos.x, pos.y, pos.z] : pos;
}

/**
 * Pure bridge from a walking person (first-person / walkthrough camera) to KNX presence
 * detectors: each update finds every detector whose detection field contains the feet
 * position and reports movement to the sink. The detectors' own hold time (owned by the
 * bus controller) turns presence off again once the person has left.
 *
 * No rendering or engine dependencies — feed it world coordinates from any source.
 */
export class MotionPresenceBridge {
  private readonly sink: PresenceSink;
  private readonly sensors: readonly PresenceSensorFootprint[];
  private lastReported: readonly string[] = [];

  public constructor(
    sink: PresenceSink,
    sensors: readonly (PresenceSensorFootprint | KnxPresenceDetectorDevice)[]
  ) {
    this.sink = sink;
    this.sensors = sensors.map((s) => ({ pa: s.pa, zoneId: s.zoneId, coverage: s.coverage }));
  }

  /** Detectors whose detection field contains the given feet position. */
  public sensorsAt(pos: FootPosition): readonly PresenceSensorFootprint[] {
    const [x, y, z] = toXyz(pos);
    return this.sensors.filter((s) => isInsideCoverage(x, y, z, s.coverage));
  }

  /** Zone of the first detector covering the position, or null. */
  public zoneAt(pos: FootPosition): RoomZoneId | null {
    return this.sensorsAt(pos)[0]?.zoneId ?? null;
  }

  /**
   * Reports movement for every detector covering `pos` and returns their PAs. Call it for
   * every walkthrough position sample (throttling to a few Hz is fine — detector hold times
   * are tens of seconds).
   */
  public update(pos: FootPosition): readonly string[] {
    const hits = this.sensorsAt(pos).map((s) => s.pa);
    for (const pa of hits) {
      this.sink.reportPresence(pa);
    }
    this.lastReported = hits;
    return hits;
  }

  /** PAs reported by the most recent `update`. */
  public getLastReported(): readonly string[] {
    return this.lastReported;
  }
}
