/**
 * Deterministic 2D pool-table physics for the barn pool table break animation.
 *
 * Pure (no three.js / DOM): balls move on the table plane (`x` along the table length, `z` across
 * it, both in metres in the table's local frame). The model is deliberately simple:
 * equal-mass ball–ball collisions with a restitution coefficient, cushion reflections, rolling
 * friction (constant deceleration plus a speed-proportional drag) and capture into pockets.
 * A whole break is pre-simulated with a fixed timestep, so the same inputs always give the same
 * trajectory, and the animator only plays the sampled frames back.
 */

/** A pocket mouth on the table plane. A ball whose centre comes within `captureRadius` drops. */
export interface PoolPocket {
  readonly x: number;
  readonly z: number;
  readonly captureRadius: number;
}

/** Playing-surface geometry. Ball centres stay within `±(halfLength - r)` × `±(halfWidth - r)`. */
export interface PoolTableSpec {
  /** Half the distance between the two end-cushion faces (along `x`). */
  readonly halfLength: number;
  /** Half the distance between the two side-cushion faces (along `z`). */
  readonly halfWidth: number;
  readonly ballRadius: number;
  readonly pockets: readonly PoolPocket[];
}

/**
 * Pocket layout of a 6-pocket table whose cushion faces are `halfLength` × `halfWidth`: corner
 * pockets sit just beyond each cushion corner, middle pockets just beyond the side cushions.
 */
export function createSixPocketTableSpec(halfLength: number, halfWidth: number, ballRadius: number): PoolTableSpec {
  const cornerInset = 0.025;
  const middleInset = 0.037;
  const corner = 0.085;
  const middle = 0.075;
  const pockets: PoolPocket[] = [];
  for (const sz of [-1, 1] as const) {
    pockets.push({ x: -(halfLength + cornerInset), z: sz * (halfWidth + cornerInset), captureRadius: corner });
    pockets.push({ x: 0, z: sz * (halfWidth + middleInset), captureRadius: middle });
    pockets.push({ x: halfLength + cornerInset, z: sz * (halfWidth + cornerInset), captureRadius: corner });
  }
  return { halfLength, halfWidth, ballRadius, pockets };
}

/** Point on the table plane. */
export interface PoolPoint {
  readonly x: number;
  readonly z: number;
}

/** The cue strike: which ball is hit, in which direction (normalised internally), how hard (m/s). */
export interface PoolShot {
  readonly cueBallIndex: number;
  readonly dirX: number;
  readonly dirZ: number;
  readonly speed: number;
}

/** Tunables; every field has a default suited to a 7ft English pool table. */
export interface PoolSimOptions {
  /** Integration step in seconds. */
  readonly stepSec?: number;
  /** Frames per second of the sampled output. */
  readonly sampleHz?: number;
  /** Hard stop: every ball is brought to rest by this time. */
  readonly maxDurationSec?: number;
  /** Constant rolling deceleration (m/s²). */
  readonly rollingDecel?: number;
  /** Speed-proportional drag (1/s). */
  readonly drag?: number;
  readonly ballRestitution?: number;
  readonly cushionRestitution?: number;
  /** Below this speed (m/s) a ball is considered at rest. */
  readonly restSpeed?: number;
}

/** A ball dropping into a pocket. */
export interface PoolPocketEvent {
  readonly ballIndex: number;
  readonly pocketIndex: number;
  readonly timeSec: number;
  /** Ball centre at the moment of capture. */
  readonly x: number;
  readonly z: number;
}

/** One sampled frame: ball centres; pocketed balls keep the position at which they were captured. */
export interface PoolFrame {
  readonly timeSec: number;
  readonly positions: readonly PoolPoint[];
  /** `true` while the ball is still on the table at this frame. */
  readonly onTable: readonly boolean[];
}

export interface PoolSimResult {
  readonly sampleHz: number;
  readonly frames: readonly PoolFrame[];
  readonly pocketEvents: readonly PoolPocketEvent[];
  /** Time at which the last ball came to rest (or the hard stop). */
  readonly restTimeSec: number;
}

const DEFAULTS: Required<PoolSimOptions> = {
  stepSec: 1 / 600,
  sampleHz: 60,
  maxDurationSec: 6,
  rollingDecel: 0.12,
  drag: 0.15,
  ballRestitution: 0.93,
  cushionRestitution: 0.78,
  restSpeed: 0.008,
};

/** Extra drag ramped in over the last `RAMP_SEC` before the hard stop, so balls glide to rest. */
const RAMP_SEC = 1.5;
const RAMP_EXTRA_DRAG = 2.2;

/** Mulberry32: small, fast, seedable PRNG returning floats in [0, 1). */
export function createSeededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Plans the `breakNumber`-th break from `cueBall` towards `apex`, with a small seeded jitter in
 * aim (±0.7°) and power (6.2–7.4 m/s), so every break differs but is reproducible.
 */
export function planBreakShot(
  cueBallIndex: number,
  cueBall: PoolPoint,
  apex: PoolPoint,
  seed: number,
  breakNumber: number
): PoolShot {
  const rand = createSeededRandom((seed ^ Math.imul(breakNumber + 1, 0x9e3779b1)) >>> 0);
  const baseAngle = Math.atan2(apex.z - cueBall.z, apex.x - cueBall.x);
  const angle = baseAngle + (rand() * 2 - 1) * ((0.7 * Math.PI) / 180);
  const speed = 6.2 + rand() * 1.2;
  return { cueBallIndex, dirX: Math.cos(angle), dirZ: Math.sin(angle), speed };
}

/**
 * Standard triangle rack: apex ball on `apex`, rows growing along `+x`. Returns 15 positions,
 * row by row, with a small `gap` so no two balls start in contact.
 */
export function createTriangleRack(apex: PoolPoint, ballRadius: number, gap = 0.0002): PoolPoint[] {
  const out: PoolPoint[] = [];
  const d = ballRadius * 2 + gap;
  const rowStep = d * Math.sqrt(3) * 0.5;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col <= row; col++) {
      out.push({ x: apex.x + row * rowStep, z: apex.z + (col - row * 0.5) * d });
    }
  }
  return out;
}

interface Body {
  x: number;
  z: number;
  vx: number;
  vz: number;
  onTable: boolean;
}

/** Simulates a break from `start` (one entry per ball) and returns the sampled trajectory. */
export function simulatePoolBreak(
  spec: PoolTableSpec,
  start: readonly PoolPoint[],
  shot: PoolShot,
  options: PoolSimOptions = {}
): PoolSimResult {
  const o: Required<PoolSimOptions> = { ...DEFAULTS, ...options };
  const r = spec.ballRadius;
  const minX = -spec.halfLength + r;
  const maxX = spec.halfLength - r;
  const minZ = -spec.halfWidth + r;
  const maxZ = spec.halfWidth - r;
  const contact = 2 * r;
  const contactSq = contact * contact;

  const bodies: Body[] = start.map((p) => ({
    x: clamp(p.x, minX, maxX),
    z: clamp(p.z, minZ, maxZ),
    vx: 0,
    vz: 0,
    onTable: true,
  }));
  const cue = bodies[shot.cueBallIndex];
  if (cue) {
    const len = Math.hypot(shot.dirX, shot.dirZ) || 1;
    cue.vx = (shot.dirX / len) * shot.speed;
    cue.vz = (shot.dirZ / len) * shot.speed;
  }

  const frames: PoolFrame[] = [];
  const pocketEvents: PoolPocketEvent[] = [];
  const sampleEvery = Math.max(1, Math.round(1 / (o.sampleHz * o.stepSec)));
  const totalSteps = Math.ceil(o.maxDurationSec / o.stepSec);
  const snapshot = (timeSec: number): void => {
    frames.push({
      timeSec,
      positions: bodies.map((b) => ({ x: b.x, z: b.z })),
      onTable: bodies.map((b) => b.onTable),
    });
  };
  snapshot(0);

  let restTimeSec = o.maxDurationSec;
  for (let step = 1; step <= totalSteps; step++) {
    const t = step * o.stepSec;
    const dt = o.stepSec;
    const rampU = clamp((t - (o.maxDurationSec - RAMP_SEC)) / RAMP_SEC, 0, 1);
    const drag = o.drag + RAMP_EXTRA_DRAG * rampU * rampU;

    // 1. Integrate with rolling friction.
    for (const b of bodies) {
      if (!b.onTable) continue;
      const speed = Math.hypot(b.vx, b.vz);
      if (speed === 0) continue;
      const next = speed - (o.rollingDecel + drag * speed) * dt;
      if (next <= o.restSpeed * 0.5) {
        b.vx = 0;
        b.vz = 0;
        continue;
      }
      const k = next / speed;
      b.vx *= k;
      b.vz *= k;
      b.x += b.vx * dt;
      b.z += b.vz * dt;
    }

    // 2. Pockets (checked before cushions so a ball heading into a mouth drops instead of bouncing).
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]!;
      if (!b.onTable) continue;
      for (let p = 0; p < spec.pockets.length; p++) {
        const pocket = spec.pockets[p]!;
        const dx = b.x - pocket.x;
        const dz = b.z - pocket.z;
        if (dx * dx + dz * dz <= pocket.captureRadius * pocket.captureRadius) {
          b.onTable = false;
          b.vx = 0;
          b.vz = 0;
          pocketEvents.push({ ballIndex: i, pocketIndex: p, timeSec: t, x: b.x, z: b.z });
          break;
        }
      }
    }

    // 3. Cushions.
    for (const b of bodies) {
      if (!b.onTable) continue;
      if (b.x < minX) {
        b.x = Math.min(maxX, minX + (minX - b.x) * o.cushionRestitution);
        b.vx = Math.abs(b.vx) * o.cushionRestitution;
        b.vz *= 0.96;
      } else if (b.x > maxX) {
        b.x = Math.max(minX, maxX - (b.x - maxX) * o.cushionRestitution);
        b.vx = -Math.abs(b.vx) * o.cushionRestitution;
        b.vz *= 0.96;
      }
      if (b.z < minZ) {
        b.z = Math.min(maxZ, minZ + (minZ - b.z) * o.cushionRestitution);
        b.vz = Math.abs(b.vz) * o.cushionRestitution;
        b.vx *= 0.96;
      } else if (b.z > maxZ) {
        b.z = Math.max(minZ, maxZ - (b.z - maxZ) * o.cushionRestitution);
        b.vz = -Math.abs(b.vz) * o.cushionRestitution;
        b.vx *= 0.96;
      }
    }

    // 4. Ball–ball collisions (equal masses).
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i]!;
      if (!a.onTable) continue;
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j]!;
        if (!b.onTable) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const distSq = dx * dx + dz * dz;
        if (distSq >= contactSq) continue;
        const dist = Math.sqrt(distSq);
        // Coincident centres: separate along x deterministically.
        const nx = dist > 1e-9 ? dx / dist : 1;
        const nz = dist > 1e-9 ? dz / dist : 0;
        const push = (contact - dist) * 0.5;
        a.x -= nx * push;
        a.z -= nz * push;
        b.x += nx * push;
        b.z += nz * push;
        const approach = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
        if (approach > 0) {
          const impulse = approach * (1 + o.ballRestitution) * 0.5;
          a.vx -= impulse * nx;
          a.vz -= impulse * nz;
          b.vx += impulse * nx;
          b.vz += impulse * nz;
        }
      }
    }
    // Separation can nudge a ball past a cushion line: clamp back onto the playing surface.
    for (const b of bodies) {
      if (!b.onTable) continue;
      b.x = clamp(b.x, minX, maxX);
      b.z = clamp(b.z, minZ, maxZ);
    }

    const moving = bodies.some((b) => b.onTable && Math.hypot(b.vx, b.vz) > o.restSpeed);
    if (step % sampleEvery === 0 || !moving || step === totalSteps) {
      if (!moving || step === totalSteps) {
        for (const b of bodies) {
          b.vx = 0;
          b.vz = 0;
        }
        restTimeSec = t;
        snapshot(t);
        break;
      }
      snapshot(t);
    }
  }

  return { sampleHz: o.sampleHz, frames, pocketEvents, restTimeSec };
}

/** Interpolated ball centres at `timeSec` (clamped to the simulated range). */
export function samplePoolBreak(result: PoolSimResult, timeSec: number, out: PoolPoint[] = []): PoolPoint[] {
  const frames = result.frames;
  const first = frames[0];
  if (!first) return out;
  const last = frames[frames.length - 1]!;
  const t = clamp(timeSec, 0, last.timeSec);
  // Frames are uniformly spaced except the final rest frame: binary search keeps this exact.
  let lo = 0;
  let hi = frames.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid]!.timeSec <= t) lo = mid;
    else hi = mid;
  }
  const a = frames[lo]!;
  const b = frames[hi]!;
  const span = b.timeSec - a.timeSec;
  const u = span > 0 ? clamp((t - a.timeSec) / span, 0, 1) : 0;
  out.length = a.positions.length;
  for (let i = 0; i < a.positions.length; i++) {
    const pa = a.positions[i]!;
    const pb = b.onTable[i] ? b.positions[i]! : pa;
    out[i] = { x: pa.x + (pb.x - pa.x) * u, z: pa.z + (pb.z - pa.z) * u };
  }
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
