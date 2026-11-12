import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { RoomZoneLodRegistration } from '../../core/entities.ts';
import type { RoomZoneId } from '../../core/types/topology.ts';
import { RoomTracker } from './room-tracker.ts';

const REGISTRATIONS: readonly RoomZoneLodRegistration[] = [
  {
    zoneId: 'kitchen',
    shortName: 'Kitchen',
    floorId: 'ground',
    bounds: { minX: 0, maxX: 10, minY: 0, maxY: 2.5, minZ: 0, maxZ: 10 },
  },
  {
    zoneId: 'utility',
    shortName: 'Utility',
    floorId: 'ground',
    bounds: { minX: 6, maxX: 10, minY: 0, maxY: 2.5, minZ: 6, maxZ: 10 },
  },
  {
    zoneId: 'bedroom2',
    shortName: 'Bed 2',
    floorId: 'first',
    bounds: { minX: 0, maxX: 10, minY: 2.2, maxY: 5, minZ: 0, maxZ: 10 },
  },
  {
    zoneId: 'courtyard',
    shortName: 'Courtyard',
    floorId: 'exterior',
    bounds: { minX: -50, maxX: 50, minY: -1, maxY: 10, minZ: -50, maxZ: 50 },
  },
];

interface Harness {
  readonly tracker: RoomTracker;
  readonly changes: (RoomZoneId | null)[];
  /** Fires all pending timers. */
  flushTimers(): void;
  pendingTimers(): number;
}

function createHarness(dwellMs = 400): Harness {
  const changes: (RoomZoneId | null)[] = [];
  const timers = new Map<number, () => void>();
  let nextId = 1;
  const tracker = new RoomTracker({
    registrations: REGISTRATIONS,
    onChange: (z) => changes.push(z),
    dwellMs,
    getWalkingFloorY: (reg) => reg.bounds.minY,
    setTimer: (cb) => {
      const id = nextId;
      nextId += 1;
      timers.set(id, cb);
      return id;
    },
    clearTimer: (handle) => {
      if (typeof handle === 'number') timers.delete(handle);
    },
  });
  return {
    tracker,
    changes,
    flushTimers() {
      const cbs = [...timers.values()];
      timers.clear();
      for (const cb of cbs) cb();
    },
    pendingTimers: () => timers.size,
  };
}

describe('RoomTracker lookups', () => {
  const { tracker } = createHarness();

  it('picks the smallest interior room under the orbit pivot for the floor view', () => {
    expect(tracker.findOrbitRoom(2, 0, 2, 'ground')).toBe('kitchen');
    expect(tracker.findOrbitRoom(8, 0, 8, 'ground')).toBe('utility');
    expect(tracker.findOrbitRoom(2, 0, 2, 'first')).toBe('bedroom2');
    expect(tracker.findOrbitRoom(30, 0, 30, 'ground')).toBe('courtyard');
    expect(tracker.findOrbitRoom(30, 0, 30, 'first')).toBeNull();
    expect(tracker.findOrbitRoom(999, 0, 999, 'all')).toBeNull();
  });

  it('uses the pivot height when both floors are visible', () => {
    expect(tracker.findOrbitRoom(2, 3.5, 2, 'all')).toBe('bedroom2');
    expect(tracker.findOrbitRoom(2, 1.0, 2, 'all')).toBe('kitchen');
  });

  it('matches walkthrough feet to the room whose walking floor is closest', () => {
    expect(tracker.findWalkthroughRoom(2, 0, 2)).toBe('kitchen');
    expect(tracker.findWalkthroughRoom(2, 2.2, 2)).toBe('bedroom2');
    expect(tracker.findWalkthroughRoom(30, 0, 30)).toBe('courtyard');
    expect(tracker.findWalkthroughRoom(30, 5, 30)).toBeNull();
  });
});

describe('RoomTracker registration data', () => {
  const noop = (): void => undefined;

  it("takes the walking floor from the registration, else the bottom of its bounds", () => {
    const tracker = new RoomTracker({
      registrations: [
        {
          zoneId: 'sunkenLounge',
          shortName: 'Lounge',
          floorId: 'ground',
          bounds: { minX: 0, maxX: 10, minY: -1, maxY: 2.5, minZ: 0, maxZ: 10 },
          walkingFloorY: -0.6,
        },
        {
          zoneId: 'gallery',
          shortName: 'Gallery',
          floorId: 'first',
          bounds: { minX: 0, maxX: 10, minY: 2.2, maxY: 5, minZ: 0, maxZ: 10 },
        },
      ],
      onChange: noop,
    });
    expect(tracker.findWalkthroughRoom(2, -0.6, 2)).toBe('sunkenLounge');
    // 0.9 m above the declared floor (in tolerance) but 1.3 m above the bounds' bottom (out).
    expect(tracker.findWalkthroughRoom(2, 0.3, 2)).toBe('sunkenLounge');
    // 1.0 m below the declared floor (out) though only 0.6 m below the bounds' bottom.
    expect(tracker.findWalkthroughRoom(2, -1.6, 2)).toBeNull();
    expect(tracker.findWalkthroughRoom(2, 2.2, 2)).toBe('gallery');
  });

  it('leaves a registration-declared cutout out of the room', () => {
    const tracker = new RoomTracker({
      registrations: [
        {
          zoneId: 'landing',
          shortName: 'Landing',
          floorId: 'first',
          bounds: { minX: 0, maxX: 10, minY: 2.2, maxY: 5, minZ: 0, maxZ: 10 },
          excludedCutout: (x, z) => x > 5 && z > 5,
        },
      ],
      onChange: noop,
    });
    expect(tracker.findOrbitRoom(2, 3, 2, 'first')).toBe('landing');
    expect(tracker.findOrbitRoom(8, 3, 8, 'first')).toBeNull();
    expect(tracker.findOrbitRoom(8, 3, 2, 'first')).toBe('landing');
    expect(tracker.findWalkthroughRoom(8, 2.2, 8)).toBeNull();
  });

  it('treats isInterior: false as exterior whatever its floor id', () => {
    const tracker = new RoomTracker({
      registrations: [
        REGISTRATIONS[0]!,
        {
          zoneId: 'poolDeck',
          shortName: 'Pool deck',
          floorId: 'ground',
          isInterior: false,
          bounds: { minX: -50, maxX: 50, minY: -1, maxY: 10, minZ: -50, maxZ: 50 },
        },
      ],
      onChange: noop,
    });
    expect(tracker.findOrbitRoom(2, 1, 2, 'all')).toBe('kitchen');
    expect(tracker.findOrbitRoom(30, 1, 30, 'ground')).toBe('poolDeck');
    expect(tracker.findWalkthroughRoom(30, 5, 30)).toBeNull();
  });

  it('supports three custom floors, grouping the exterior with the lowest', () => {
    const level = (zoneId: string, floorId: string, minY: number): RoomZoneLodRegistration => ({
      zoneId,
      shortName: zoneId,
      floorId,
      bounds: { minX: 0, maxX: 10, minY, maxY: minY + 2.8, minZ: 0, maxZ: 10 },
    });
    const tracker = new RoomTracker({
      registrations: [
        level('lobby', 'level1', 0),
        level('studio', 'level2', 3),
        level('penthouse', 'level3', 6),
        {
          zoneId: 'plaza',
          shortName: 'Plaza',
          floorId: 'exterior',
          bounds: { minX: -50, maxX: 50, minY: -1, maxY: 20, minZ: -50, maxZ: 50 },
        },
      ],
      onChange: noop,
      floors: [
        { id: 'level3', elevationY: 6 },
        { id: 'level1', elevationY: 0 },
        { id: 'level2', elevationY: 3 },
      ],
    });
    expect(tracker.findOrbitRoom(2, 0, 2, 'level1')).toBe('lobby');
    expect(tracker.findOrbitRoom(2, 0, 2, 'level2')).toBe('studio');
    expect(tracker.findOrbitRoom(2, 0, 2, 'level3')).toBe('penthouse');
    expect(tracker.findOrbitRoom(30, 0, 30, 'level1')).toBe('plaza');
    expect(tracker.findOrbitRoom(30, 0, 30, 'level2')).toBeNull();
    expect(tracker.findOrbitRoom(30, 0, 30, 'level3')).toBeNull();
    expect(tracker.findOrbitRoom(2, 7, 2, 'all')).toBe('penthouse');
    expect(tracker.findOrbitRoom(2, 4, 2, 'all')).toBe('studio');
    expect(tracker.findWalkthroughRoom(2, 6, 2)).toBe('penthouse');
  });
});

describe('RoomTracker state machine', () => {
  it('commits walkthrough rooms immediately', () => {
    const h = createHarness();
    h.tracker.updateFromWalkthrough(new Vector3(2, 0, 2));
    h.tracker.updateFromWalkthrough(new Vector3(8, 0, 8));
    expect(h.changes).toEqual(['kitchen', 'utility']);
    expect(h.tracker.getCurrent()).toBe('utility');
  });

  it('waits out the orbit dwell before committing (via tick or timer)', () => {
    const h = createHarness(400);
    h.tracker.updateFromOrbit(new Vector3(2, 0, 2), 'ground', 0);
    expect(h.changes).toEqual([]);
    h.tracker.updateFromOrbit(new Vector3(2.5, 0, 2), 'ground', 200);
    expect(h.changes).toEqual([]);
    h.tracker.updateFromOrbit(new Vector3(3, 0, 2), 'ground', 450);
    expect(h.changes).toEqual(['kitchen']);

    h.tracker.updateFromOrbit(new Vector3(8, 0, 8), 'ground', 500);
    expect(h.pendingTimers()).toBe(1);
    h.flushTimers();
    expect(h.changes).toEqual(['kitchen', 'utility']);
  });

  it('cancels a pending room when the pivot returns to the current room', () => {
    const h = createHarness(400);
    h.tracker.setExplicit('kitchen');
    h.tracker.clearExplicit();
    h.tracker.updateFromOrbit(new Vector3(8, 0, 8), 'ground', 0);
    h.tracker.updateFromOrbit(new Vector3(2, 0, 2), 'ground', 100);
    expect(h.pendingTimers()).toBe(0);
    h.tracker.tick(10_000);
    expect(h.changes).toEqual(['kitchen']);
  });

  it('commits immediately with a zero dwell', () => {
    const h = createHarness(0);
    h.tracker.updateFromOrbit(new Vector3(2, 0, 2), 'ground', 0);
    expect(h.changes).toEqual(['kitchen']);
  });

  it('pins an explicit selection until the tracked point moves away', () => {
    const h = createHarness(0);
    h.tracker.setExplicit('bedroom2', new Vector3(2, 0, 2));
    expect(h.tracker.isExplicit()).toBe(true);
    h.tracker.updateFromOrbit(new Vector3(3, 0, 2), 'ground', 0);
    expect(h.tracker.getCurrent()).toBe('bedroom2');
    h.tracker.updateFromOrbit(new Vector3(8, 0, 8), 'ground', 10);
    expect(h.tracker.isExplicit()).toBe(false);
    expect(h.tracker.getCurrent()).toBe('utility');
    expect(h.changes).toEqual(['bedroom2', 'utility']);
  });

  it('takes the anchor from the next update when none is given', () => {
    const h = createHarness(0);
    h.tracker.setExplicit('bedroom2');
    h.tracker.updateFromWalkthrough(new Vector3(30, 0, 30));
    expect(h.tracker.getCurrent()).toBe('bedroom2');
    h.tracker.updateFromWalkthrough(new Vector3(31, 0, 30));
    expect(h.tracker.getCurrent()).toBe('bedroom2');
    h.tracker.updateFromWalkthrough(new Vector3(2, 0, 2));
    expect(h.tracker.getCurrent()).toBe('kitchen');
  });

  it('clears timers on dispose', () => {
    const h = createHarness(400);
    h.tracker.updateFromOrbit(new Vector3(2, 0, 2), 'ground', 0);
    expect(h.pendingTimers()).toBe(1);
    h.tracker.dispose();
    expect(h.pendingTimers()).toBe(0);
  });
});
