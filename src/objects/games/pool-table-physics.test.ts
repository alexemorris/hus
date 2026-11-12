import { describe, expect, it } from 'vitest';
import {
  createSeededRandom,
  createSixPocketTableSpec,
  createTriangleRack,
  planBreakShot,
  samplePoolBreak,
  simulatePoolBreak,
  type PoolPoint,
  type PoolSimResult,
} from './pool-table-physics.ts';

const R = 0.0254;
const SPEC = createSixPocketTableSpec(0.93, 0.47, R);
const CUE: PoolPoint = { x: -0.48, z: 0.06 };
const APEX: PoolPoint = { x: 0.46, z: 0 };
const START: readonly PoolPoint[] = [CUE, ...createTriangleRack(APEX, R)];

function breakFor(seed: number, n: number): PoolSimResult {
  return simulatePoolBreak(SPEC, START, planBreakShot(0, CUE, APEX, seed, n));
}

describe('pool-table-physics', () => {
  it('seeded PRNG is reproducible and in [0, 1)', () => {
    const a = createSeededRandom(42);
    const b = createSeededRandom(42);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('the rack starts with no overlapping balls', () => {
    for (let i = 0; i < START.length; i++) {
      for (let j = i + 1; j < START.length; j++) {
        const d = Math.hypot(START[i]!.x - START[j]!.x, START[i]!.z - START[j]!.z);
        expect(d).toBeGreaterThanOrEqual(2 * R);
      }
    }
  });

  it('is deterministic for the same seed and break number, and differs between breaks', () => {
    const a = breakFor(7, 0);
    const b = breakFor(7, 0);
    const c = breakFor(7, 1);
    expect(b.frames.at(-1)).toEqual(a.frames.at(-1));
    expect(b.pocketEvents).toEqual(a.pocketEvents);
    expect(c.frames.at(-1)!.positions).not.toEqual(a.frames.at(-1)!.positions);
  });

  for (const [seed, n] of [
    [1, 0],
    [1, 1],
    [99, 0],
    [0xc0ffee, 3],
    [12345, 7],
  ] as const) {
    describe(`break seed=${seed} n=${n}`, () => {
      const result = breakFor(seed, n);

      it('conserves the ball count (on table + pocketed)', () => {
        const pocketed = new Set(result.pocketEvents.map((e) => e.ballIndex));
        expect(pocketed.size).toBe(result.pocketEvents.length);
        for (const f of result.frames) {
          expect(f.positions).toHaveLength(START.length);
          const onTable = f.onTable.filter(Boolean).length;
          const droppedSoFar = result.pocketEvents.filter((e) => e.timeSec <= f.timeSec).length;
          expect(onTable + droppedSoFar).toBe(START.length);
        }
      });

      it('keeps every ball on the table or in a pocket', () => {
        const eps = 1e-9;
        for (const f of result.frames) {
          f.positions.forEach((p, i) => {
            if (!f.onTable[i]) return;
            expect(Math.abs(p.x)).toBeLessThanOrEqual(SPEC.halfLength - R + eps);
            expect(Math.abs(p.z)).toBeLessThanOrEqual(SPEC.halfWidth - R + eps);
          });
        }
        for (const e of result.pocketEvents) {
          const pocket = SPEC.pockets[e.pocketIndex]!;
          expect(Math.hypot(e.x - pocket.x, e.z - pocket.z)).toBeLessThanOrEqual(pocket.captureRadius + 1e-9);
        }
      });

      it('comes to rest within 6 s, with the balls actually spread', () => {
        expect(result.restTimeSec).toBeLessThanOrEqual(6);
        expect(result.restTimeSec).toBeGreaterThan(2.5);
        const last = result.frames.at(-1)!;
        const first = result.frames[0]!;
        const moved = last.positions.filter(
          (p, i) => !last.onTable[i] || Math.hypot(p.x - first.positions[i]!.x, p.z - first.positions[i]!.z) > 0.1
        ).length;
        expect(moved).toBeGreaterThanOrEqual(8);
      });

      it('sampling is continuous and clamps to the simulated range', () => {
        const atEnd = samplePoolBreak(result, 99);
        expect(atEnd).toEqual(result.frames.at(-1)!.positions);
        const atStart = samplePoolBreak(result, -1);
        expect(atStart).toEqual(result.frames[0]!.positions);
      });
    });
  }
});
