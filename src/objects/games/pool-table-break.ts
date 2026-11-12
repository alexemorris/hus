import * as THREE from 'three';
import { soundEngine } from '../../engine/audio/sound-engine.ts';
import type {
  AnimatedInteractable,
  FirstPersonPoseSample,
} from '../../engine/interaction/handlers/animated-interactable.ts';
import {
  planBreakShot,
  samplePoolBreak,
  simulatePoolBreak,
  type PoolPoint,
  type PoolSimResult,
  type PoolTableSpec,
} from './pool-table-physics.ts';

/** Fixed interactable id of the barn pool-table break. */
export const POOL_TABLE_BREAK_ID = 'pool-table-break';

export interface PoolTableBreakConfig {
  /** Ball meshes in the table's local frame; index 0 is the cue ball. All share one parent. */
  readonly balls: readonly THREE.Mesh[];
  /** The cue that strikes (its build pose is its resting pose on the rail). */
  readonly cue: THREE.Object3D;
  /** Cue length in metres (the mesh's local +Y axis runs butt → tip). */
  readonly cueLength: number;
  readonly clickableTargets: readonly THREE.Object3D[];
  readonly spec: PoolTableSpec;
  /** PRNG seed for the break jitter (each successive break uses the next break number). */
  readonly seed?: number;
  readonly label?: string;
  readonly aliases?: readonly string[];
}

type Phase = 'racked' | 'breaking' | 'broken' | 'racking';

// Break timeline (seconds from the click).
const CUE_ADDRESS_END = 0.6;
const CUE_DRAW_END = 1.0;
const CUE_IMPACT = 1.08;
const CUE_FOLLOW_END = 1.2;
const CUE_RETURN_START = 1.9;
const CUE_RETURN_END = 2.7;
const CUE_DRAW_BACK = 0.16;
const CUE_FOLLOW_THROUGH = 0.07;
const CUE_TIP_GAP = 0.03;
/** Cue elevation: the tip sits lower than the butt so it clears the head rail. */
const CUE_ELEVATION_RAD = 0.1;
const POCKET_DROP_SEC = 0.22;
const POCKET_DROP_DEPTH = 0.07;
const RACK_SEC = 0.9;
const RACK_LIFT = 0.04;
const MAX_STEP_SEC = 0.05;
const STANDING_EYE_HEIGHT = 1.67;

const UP = new THREE.Vector3(0, 1, 0);

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const u = clamp01((x - edge0) / Math.max(1e-5, edge1 - edge0));
  return u * u * (3 - 2 * u);
}

/**
 * First-person and 3D click-to-break animation for the 7ft Barn pool table:
 * - When triggered in `racked` state, transitions the 1PV camera into a low shooter bridge stance
 *   over the polished oak head rail sighting down the tapered ash cue at the white cue ball and
 *   15-ball red/yellow triangle rack, feathers & draws the cue back, delivers an explosive break
 *   stroke with an impact FOV punch, and rises to watch the balls scatter and drop into the
 *   saddle-leather pockets.
 * - When triggered in `broken` state, leans in toward the table as the pocketed and scattered
 *   balls re-assemble into the 5-row triangle rack and D-zone, ready for the next break.
 */
export class PoolTableBreakController implements AnimatedInteractable {
  public readonly id = POOL_TABLE_BREAK_ID;
  public readonly label: string;
  public readonly aliases: readonly string[];
  public readonly clickableTargets: readonly THREE.Object3D[];

  readonly #balls: readonly THREE.Mesh[];
  readonly #cue: THREE.Object3D;
  readonly #cueLength: number;
  readonly #spec: PoolTableSpec;
  readonly #seed: number;
  readonly #rack: readonly PoolPoint[];
  readonly #ballY: number;
  readonly #cueRestPos: THREE.Vector3;
  readonly #cueRestQuat: THREE.Quaternion;
  readonly #cueAddressPos = new THREE.Vector3();
  readonly #cueAddressQuat = new THREE.Quaternion();
  readonly #cueAxis = new THREE.Vector3();
  readonly #rackFrom: THREE.Vector3[];
  readonly #samples: PoolPoint[] = [];
  readonly #tmp = new THREE.Vector3();
  readonly #tmpWorldFoot = new THREE.Vector3();
  readonly #tmpWorldEye = new THREE.Vector3();
  readonly #tmpWorldLook = new THREE.Vector3();
  readonly #tmpLocalFoot = new THREE.Vector3();
  readonly #invTableMatrix = new THREE.Matrix4();

  #phase: Phase = 'racked';
  #elapsed = 0;
  #breakNumber = 0;
  #sim: PoolSimResult | null = null;
  #activeShot: ReturnType<typeof planBreakShot> = { cueBallIndex: 0, dirX: 1, dirZ: 0, speed: 5.2 };
  /** Pocket drop per ball for the current break (sim time + pocket centre), or null. */
  #drops: ({ readonly timeSec: number; readonly x: number; readonly z: number } | null)[] = [];

  public constructor(config: PoolTableBreakConfig) {
    this.label = config.label ?? 'Pool table';
    this.aliases = config.aliases ?? [];
    this.clickableTargets = config.clickableTargets;
    this.#balls = config.balls;
    this.#cue = config.cue;
    this.#cueLength = config.cueLength;
    this.#spec = config.spec;
    this.#seed = config.seed ?? 0xc0ffee;
    this.#rack = config.balls.map((b) => ({ x: b.position.x, z: b.position.z }));
    this.#ballY = config.balls[0]?.position.y ?? 0;
    this.#cueRestPos = config.cue.position.clone();
    this.#cueRestQuat = config.cue.quaternion.clone();
    this.#rackFrom = config.balls.map((b) => b.position.clone());
  }

  /** Current phase, for tests / diagnostics. */
  public get phase(): Phase {
    return this.#phase;
  }

  public trigger(): boolean {
    if (this.#phase === 'racked') {
      this.#startBreak();
      return true;
    }
    if (this.#phase === 'broken') {
      this.#startRack();
      return true;
    }
    if (this.#phase === 'breaking' || this.#phase === 'racking') {
      this.cancelFirstPerson();
      return true;
    }
    return false;
  }

  public describe(): string {
    switch (this.#phase) {
      case 'racked':
        return 'Break Pool Table';
      case 'broken':
        return 'Re-Rack Pool Balls';
      case 'breaking':
        return 'Finish Break Shot';
      case 'racking':
        return 'Finish Re-Racking';
    }
  }

  public isFirstPersonActive(): boolean {
    return this.#phase === 'breaking' || this.#phase === 'racking';
  }

  public cancelFirstPerson(): void {
    if (this.#phase === 'breaking') {
      const sim = this.#sim;
      if (sim) {
        const finalPositions = samplePoolBreak(sim, sim.restTimeSec + POCKET_DROP_SEC, this.#samples);
        for (let i = 0; i < this.#balls.length; i++) {
          const ball = this.#balls[i]!;
          const p = finalPositions[i];
          const drop = this.#drops[i];
          if (drop) {
            ball.visible = false;
          } else if (p) {
            ball.visible = true;
            ball.position.set(p.x, this.#ballY, p.z);
          }
          ball.updateMatrixWorld(true);
        }
      }
      this.#cue.position.copy(this.#cueRestPos);
      this.#cue.quaternion.copy(this.#cueRestQuat);
      this.#cue.updateMatrixWorld(true);
      this.#phase = 'broken';
    } else if (this.#phase === 'racking') {
      for (let i = 0; i < this.#balls.length; i++) {
        const ball = this.#balls[i]!;
        const to = this.#rack[i]!;
        ball.visible = true;
        ball.position.set(to.x, this.#ballY, to.z);
        ball.updateMatrixWorld(true);
      }
      this.#sim = null;
      this.#phase = 'racked';
    }
  }

  public isPlayerInProximityZone(footX: number, footY: number, footZ: number): boolean {
    const tableGroup = this.#cue.parent ?? this.#balls[0]?.parent ?? null;
    if (tableGroup) {
      tableGroup.updateWorldMatrix(true, false);
      this.#invTableMatrix.copy(tableGroup.matrixWorld).invert();
      this.#tmpLocalFoot.set(footX, footY, footZ).applyMatrix4(this.#invTableMatrix);
    } else {
      this.#tmpLocalFoot.set(footX, footY, footZ);
    }
    return (
      Math.abs(this.#tmpLocalFoot.y) <= 0.65 &&
      this.#tmpLocalFoot.x >= -2.15 &&
      this.#tmpLocalFoot.x <= 1.95 &&
      this.#tmpLocalFoot.z >= -1.55 &&
      this.#tmpLocalFoot.z <= 1.55
    );
  }

  public sampleFirstPersonPose(): FirstPersonPoseSample | null {
    if (!this.isFirstPersonActive()) return null;

    const cueBallRack = this.#rack[0] ?? { x: -0.48, z: 0.06 };
    const shot = this.#activeShot;
    const dirX = shot.dirX;
    const dirZ = shot.dirZ;
    // Right-hand perpendicular in table local XZ
    const perpX = -dirZ;
    const perpZ = dirX;

    let footLocalX = -1.45;
    let footLocalZ = cueBallRack.z - dirZ * 0.95;
    let eyeLocalX = -1.45;
    let eyeLocalY = STANDING_EYE_HEIGHT;
    let eyeLocalZ = footLocalZ;
    let lookLocalX = 0.25;
    let lookLocalY = this.#ballY;
    let lookLocalZ = 0;
    let rollRad = 0;
    let fovBoostDeg = 0;

    if (this.#phase === 'breaking') {
      const t = this.#elapsed;
      const totalDur = this.#getBreakDurationSec();
      const standFootX = cueBallRack.x - dirX * 1.02;
      const standFootZ = cueBallRack.z - dirZ * 1.02;
      const bridgeFootX = cueBallRack.x - dirX * 0.92;
      const bridgeFootZ = cueBallRack.z - dirZ * 0.92;
      // Sight right over the ash cue shaft behind the bridge hand (`~0.66m` behind cue ball)
      const bridgeEyeX = cueBallRack.x - dirX * 0.66 + perpX * 0.015;
      const bridgeEyeZ = cueBallRack.z - dirZ * 0.66 + perpZ * 0.015;
      const bridgeEyeY = this.#ballY + 0.18;
      const aimLookX = cueBallRack.x + dirX * 0.62;
      const aimLookZ = cueBallRack.z + dirZ * 0.62;

      if (t <= CUE_ADDRESS_END) {
        // Stage 1 (0.00s -> 0.60s): Step into shooter stance behind head rail & lean down onto bridge hand
        const u = easeInOutCubic(clamp01(t / CUE_ADDRESS_END));
        footLocalX = THREE.MathUtils.lerp(standFootX - dirX * 0.14, bridgeFootX, u);
        footLocalZ = THREE.MathUtils.lerp(standFootZ - perpZ * 0.12, bridgeFootZ, u);
        eyeLocalX = THREE.MathUtils.lerp(standFootX, bridgeEyeX, u);
        eyeLocalZ = THREE.MathUtils.lerp(standFootZ, bridgeEyeZ, u);
        eyeLocalY = THREE.MathUtils.lerp(STANDING_EYE_HEIGHT, bridgeEyeY, u);
        lookLocalX = THREE.MathUtils.lerp(0.15, aimLookX, u);
        lookLocalZ = THREE.MathUtils.lerp(0, aimLookZ, u);
        lookLocalY = this.#ballY;
        rollRad = 0.016 * u;
        fovBoostDeg = -1.2 * u;
      } else if (t <= CUE_DRAW_END) {
        // Stage 2 (0.60s -> 1.00s): Smooth cue draw-back & razor-sharp aim down the shaft
        const u = easeInOutCubic(clamp01((t - CUE_ADDRESS_END) / (CUE_DRAW_END - CUE_ADDRESS_END)));
        footLocalX = bridgeFootX;
        footLocalZ = bridgeFootZ;
        eyeLocalX = bridgeEyeX - dirX * (0.012 * u);
        eyeLocalZ = bridgeEyeZ - dirZ * (0.012 * u);
        eyeLocalY = bridgeEyeY - 0.012 * u;
        lookLocalX = aimLookX;
        lookLocalZ = aimLookZ;
        lookLocalY = this.#ballY - 0.004 * u;
        rollRad = 0.016 + 0.004 * u;
        fovBoostDeg = -1.2 - 1.4 * u; // -2.6 deg focused aim zoom at full draw
      } else if (t <= CUE_FOLLOW_END) {
        // Stage 3 (1.00s -> 1.20s): Explosive forward break stroke & cue-ball impact at 1.08s
        const strokeU = clamp01((t - CUE_DRAW_END) / (CUE_FOLLOW_END - CUE_DRAW_END));
        const impactPulse = t >= CUE_IMPACT
          ? Math.sin(clamp01((t - CUE_IMPACT) / (CUE_FOLLOW_END - CUE_IMPACT)) * Math.PI * 0.5)
          : 0;
        footLocalX = bridgeFootX;
        footLocalZ = bridgeFootZ;
        eyeLocalX = bridgeEyeX + dirX * (0.022 * strokeU);
        eyeLocalZ = bridgeEyeZ + dirZ * (0.022 * strokeU);
        eyeLocalY = bridgeEyeY - 0.012 + 0.018 * impactPulse;
        lookLocalX = THREE.MathUtils.lerp(aimLookX, 0.46, impactPulse);
        lookLocalZ = THREE.MathUtils.lerp(aimLookZ, 0, impactPulse);
        lookLocalY = this.#ballY + 0.014 * impactPulse;
        rollRad = 0.020 * (1 - 0.35 * impactPulse);
        fovBoostDeg = THREE.MathUtils.lerp(-2.6, 3.8, strokeU);
      } else {
        // Stage 4 (1.20s -> end): Rise smoothly from low bridge stance and watch the pack scatter across the baize
        const riseU = easeInOutCubic(clamp01((t - CUE_FOLLOW_END) / 0.78));
        const settleU = smoothstep(Math.max(CUE_FOLLOW_END + 0.8, totalDur - 0.65), totalDur, t);
        footLocalX = THREE.MathUtils.lerp(bridgeFootX, standFootX, riseU);
        footLocalZ = THREE.MathUtils.lerp(bridgeFootZ, standFootZ * (1 - settleU), riseU);

        const watchEyeX = THREE.MathUtils.lerp(bridgeEyeX + dirX * 0.022, standFootX + 0.08, riseU);
        const watchEyeZ = THREE.MathUtils.lerp(bridgeEyeZ + dirZ * 0.022, standFootZ * (1 - settleU), riseU);
        eyeLocalX = THREE.MathUtils.lerp(watchEyeX, standFootX, settleU);
        eyeLocalZ = watchEyeZ;
        eyeLocalY = THREE.MathUtils.lerp(
          bridgeEyeY + 0.006,
          STANDING_EYE_HEIGHT,
          easeInOutCubic(clamp01((t - CUE_FOLLOW_END) / 0.95))
        );

        // Track the live center of action of the scattering balls on the table
        let sumX = 0;
        let sumZ = 0;
        let count = 0;
        for (let i = 0; i < this.#balls.length; i++) {
          const b = this.#balls[i]!;
          if (b.visible) {
            const weight = i === 0 ? 1.5 : 1.0;
            sumX += b.position.x * weight;
            sumZ += b.position.z * weight;
            count += weight;
          }
        }
        const packX = count > 0 ? sumX / count : 0.22;
        const packZ = count > 0 ? sumZ / count : 0;
        const trackedLookX = THREE.MathUtils.lerp(0.46, packX * 0.65 + 0.12, riseU);
        const trackedLookZ = THREE.MathUtils.lerp(0, packZ * 0.55, riseU);

        lookLocalX = THREE.MathUtils.lerp(trackedLookX, 0.18, settleU);
        lookLocalZ = THREE.MathUtils.lerp(trackedLookZ, 0, settleU);
        lookLocalY = this.#ballY + 0.014 * (1 - riseU);
        rollRad = 0.013 * (1 - riseU);
        fovBoostDeg = 3.8 * (1 - riseU);
      }
    } else {
      // Phase === 'racking' (0.00s -> 0.90s): Lean in to watch the 15-ball triangle re-rack, then step back to head of table
      const u = clamp01(this.#elapsed / RACK_SEC);
      const sinU = Math.sin(u * Math.PI);
      const arch = sinU * sinU;
      const standX = cueBallRack.x - 1.02;
      footLocalX = THREE.MathUtils.lerp(standX, -0.95, arch);
      footLocalZ = THREE.MathUtils.lerp(0, -0.32, arch);
      eyeLocalX = THREE.MathUtils.lerp(standX, -0.72, arch);
      eyeLocalZ = THREE.MathUtils.lerp(0, -0.26, arch);
      eyeLocalY = THREE.MathUtils.lerp(STANDING_EYE_HEIGHT, 1.38, arch);
      lookLocalX = THREE.MathUtils.lerp(0.18, 0.42, arch);
      lookLocalZ = 0;
      lookLocalY = this.#ballY;
      rollRad = -0.012 * arch;
      fovBoostDeg = 1.2 * arch;
    }

    const tableGroup = this.#cue.parent ?? this.#balls[0]?.parent ?? null;
    if (tableGroup) {
      tableGroup.updateWorldMatrix(true, false);
      this.#tmpWorldFoot.set(footLocalX, 0, footLocalZ).applyMatrix4(tableGroup.matrixWorld);
      this.#tmpWorldEye.set(eyeLocalX, eyeLocalY, eyeLocalZ).applyMatrix4(tableGroup.matrixWorld);
      this.#tmpWorldLook.set(lookLocalX, lookLocalY, lookLocalZ).applyMatrix4(tableGroup.matrixWorld);
    } else {
      this.#tmpWorldFoot.set(footLocalX, 0, footLocalZ);
      this.#tmpWorldEye.set(eyeLocalX, eyeLocalY, eyeLocalZ);
      this.#tmpWorldLook.set(lookLocalX, lookLocalY, lookLocalZ);
    }

    const dx = this.#tmpWorldLook.x - this.#tmpWorldEye.x;
    const dy = this.#tmpWorldLook.y - this.#tmpWorldEye.y;
    const dz = this.#tmpWorldLook.z - this.#tmpWorldEye.z;
    const horizDist = Math.max(1e-4, Math.hypot(dx, dz));
    const yawRad = Math.atan2(-dx, -dz);
    const pitchRad = THREE.MathUtils.clamp(Math.atan2(dy, horizDist), -1.2, 1.2);

    return {
      eyePosition: [this.#tmpWorldEye.x, this.#tmpWorldEye.y, this.#tmpWorldEye.z],
      footPosition: [this.#tmpWorldFoot.x, this.#tmpWorldFoot.y, this.#tmpWorldFoot.z],
      yawRad,
      pitchRad,
      rollRad,
      fovBoostDeg,
    };
  }

  public collectDynamicObjects(out: Set<THREE.Object3D>): void {
    for (const ball of this.#balls) out.add(ball);
    this.#cue.traverse((c) => out.add(c));
  }

  public step(dtSeconds: number): boolean {
    if (this.#phase === 'racked' || this.#phase === 'broken') return false;
    const prevElapsed = this.#elapsed;
    this.#elapsed += Math.min(MAX_STEP_SEC, Math.max(0, dtSeconds));
    if (this.#phase === 'breaking') {
      if (prevElapsed < CUE_IMPACT && this.#elapsed >= CUE_IMPACT) {
        this.#playStrikeSound();
      }
      if (prevElapsed < CUE_IMPACT + 0.045 && this.#elapsed >= CUE_IMPACT + 0.045) {
        this.#playBreakScatterSound();
      }
      const prevSimT = prevElapsed - CUE_IMPACT;
      const currSimT = this.#elapsed - CUE_IMPACT;
      for (let i = 0; i < this.#drops.length; i++) {
        const drop = this.#drops[i];
        if (drop && prevSimT < drop.timeSec && currSimT >= drop.timeSec) {
          this.#playPocketDropSound(drop.x, drop.z);
        }
      }
      this.#stepBreak(this.#elapsed);
    } else {
      this.#stepRack(this.#elapsed);
    }
    return true;
  }

  #getBreakDurationSec(): number {
    const simRest = this.#sim ? CUE_IMPACT + this.#sim.restTimeSec + POCKET_DROP_SEC : CUE_RETURN_END;
    return Math.max(CUE_RETURN_END, simRest);
  }

  // --- Break -------------------------------------------------------------------------------

  #startBreak(): void {
    const cueBall = this.#rack[0]!;
    // Aim at the apex of the triangle: the object ball nearest the cue ball.
    let apex = this.#rack[1] ?? { x: cueBall.x + 1, z: cueBall.z };
    let best = Number.POSITIVE_INFINITY;
    for (let i = 1; i < this.#rack.length; i++) {
      const p = this.#rack[i]!;
      const d = Math.hypot(p.x - cueBall.x, p.z - cueBall.z);
      if (d < best) {
        best = d;
        apex = p;
      }
    }
    const shot = planBreakShot(0, cueBall, apex, this.#seed, this.#breakNumber);
    this.#activeShot = shot;
    this.#breakNumber += 1;
    this.#sim = simulatePoolBreak(this.#spec, this.#rack, shot);
    this.#drops = this.#balls.map(() => null);
    for (const e of this.#sim.pocketEvents) {
      const pocket = this.#spec.pockets[e.pocketIndex];
      if (pocket) this.#drops[e.ballIndex] = { timeSec: e.timeSec, x: pocket.x, z: pocket.z };
    }

    // Cue address pose: tip just behind the cue ball along the shot line, butt raised.
    const r = this.#spec.ballRadius;
    const cosE = Math.cos(CUE_ELEVATION_RAD);
    this.#cueAxis.set(shot.dirX * cosE, -Math.sin(CUE_ELEVATION_RAD), shot.dirZ * cosE).normalize();
    this.#cueAddressQuat.setFromUnitVectors(UP, this.#cueAxis);
    this.#tipToCentre(
      cueBall.x - shot.dirX * (r + CUE_TIP_GAP),
      cueBall.z - shot.dirZ * (r + CUE_TIP_GAP),
      0,
      this.#cueAddressPos
    );

    this.#phase = 'breaking';
    this.#elapsed = 0;
  }

  /** Cue mesh centre for a tip at (`tipX`, ballY, `tipZ`) moved `along` metres along the cue axis. */
  #tipToCentre(tipX: number, tipZ: number, along: number, out: THREE.Vector3): THREE.Vector3 {
    return out
      .set(tipX, this.#ballY, tipZ)
      .addScaledVector(this.#cueAxis, along - this.#cueLength * 0.5);
  }

  #stepBreak(t: number): void {
    this.#poseCue(t);
    const sim = this.#sim;
    if (!sim) return;
    const simT = t - CUE_IMPACT;
    const positions = samplePoolBreak(sim, Math.max(0, simT), this.#samples);
    for (let i = 0; i < this.#balls.length; i++) {
      const ball = this.#balls[i]!;
      const p = positions[i];
      if (!p) continue;
      const drop = this.#drops[i];
      if (drop && simT >= drop.timeSec) {
        const u = clamp01((simT - drop.timeSec) / POCKET_DROP_SEC);
        if (u >= 1) {
          ball.visible = false;
        } else {
          ball.visible = true;
          ball.position.set(
            p.x + (drop.x - p.x) * u,
            this.#ballY - POCKET_DROP_DEPTH * u * u,
            p.z + (drop.z - p.z) * u
          );
        }
      } else {
        ball.visible = true;
        ball.position.set(p.x, this.#ballY, p.z);
      }
      ball.updateMatrixWorld(true);
    }
    const ballsDone = simT >= sim.restTimeSec + POCKET_DROP_SEC;
    if (ballsDone && t >= CUE_RETURN_END) {
      this.#cue.position.copy(this.#cueRestPos);
      this.#cue.quaternion.copy(this.#cueRestQuat);
      this.#cue.updateMatrixWorld(true);
      this.#phase = 'broken';
    }
  }

  #poseCue(t: number): void {
    const cue = this.#cue;
    if (t <= CUE_ADDRESS_END) {
      const u = easeInOutCubic(clamp01(t / CUE_ADDRESS_END));
      cue.position.lerpVectors(this.#cueRestPos, this.#cueAddressPos, u);
      // Lift the cue off the rail in a small arc while it swings round to the shot line.
      cue.position.y += Math.sin(u * Math.PI) * 0.12;
      cue.quaternion.slerpQuaternions(this.#cueRestQuat, this.#cueAddressQuat, u);
    } else if (t <= CUE_DRAW_END) {
      const u = easeInOutCubic(clamp01((t - CUE_ADDRESS_END) / (CUE_DRAW_END - CUE_ADDRESS_END)));
      cue.quaternion.copy(this.#cueAddressQuat);
      cue.position.copy(this.#cueAddressPos).addScaledVector(this.#cueAxis, -CUE_DRAW_BACK * u);
    } else if (t <= CUE_IMPACT) {
      const u = clamp01((t - CUE_DRAW_END) / (CUE_IMPACT - CUE_DRAW_END));
      const travel = CUE_DRAW_BACK + CUE_TIP_GAP;
      cue.quaternion.copy(this.#cueAddressQuat);
      cue.position.copy(this.#cueAddressPos).addScaledVector(this.#cueAxis, -CUE_DRAW_BACK + travel * u * u);
    } else if (t <= CUE_FOLLOW_END) {
      const u = clamp01((t - CUE_IMPACT) / (CUE_FOLLOW_END - CUE_IMPACT));
      cue.quaternion.copy(this.#cueAddressQuat);
      cue.position
        .copy(this.#cueAddressPos)
        .addScaledVector(this.#cueAxis, CUE_TIP_GAP + CUE_FOLLOW_THROUGH * (1 - (1 - u) * (1 - u)));
    } else if (t <= CUE_RETURN_START) {
      // Hold the follow-through, lifted slightly clear of the moving balls.
      const u = clamp01((t - CUE_FOLLOW_END) / 0.3);
      cue.quaternion.copy(this.#cueAddressQuat);
      cue.position
        .copy(this.#cueAddressPos)
        .addScaledVector(this.#cueAxis, CUE_TIP_GAP + CUE_FOLLOW_THROUGH - 0.25 * easeInOutCubic(u));
      cue.position.y += 0.05 * easeInOutCubic(u);
    } else {
      const u = easeInOutCubic(clamp01((t - CUE_RETURN_START) / (CUE_RETURN_END - CUE_RETURN_START)));
      const from = this.#tmp
        .copy(this.#cueAddressPos)
        .addScaledVector(this.#cueAxis, CUE_TIP_GAP + CUE_FOLLOW_THROUGH - 0.25);
      from.y += 0.05;
      cue.position.lerpVectors(from, this.#cueRestPos, u);
      cue.position.y += Math.sin(u * Math.PI) * 0.08;
      cue.quaternion.slerpQuaternions(this.#cueAddressQuat, this.#cueRestQuat, u);
    }
    cue.updateMatrixWorld(true);
  }

  // --- Re-rack -----------------------------------------------------------------------------

  #startRack(): void {
    for (let i = 0; i < this.#balls.length; i++) {
      const ball = this.#balls[i]!;
      const from = this.#rackFrom[i]!;
      if (ball.visible) {
        from.copy(ball.position);
      } else {
        // Pocketed: rise out of the pocket it dropped into.
        const drop = this.#drops[i];
        from.set(drop?.x ?? ball.position.x, this.#ballY - POCKET_DROP_DEPTH, drop?.z ?? ball.position.z);
        ball.position.copy(from);
        ball.visible = true;
      }
    }
    this.#phase = 'racking';
    this.#elapsed = 0;
    this.#playRackSound();
  }

  #stepRack(t: number): void {
    const n = this.#balls.length;
    let done = true;
    for (let i = 0; i < n; i++) {
      const ball = this.#balls[i]!;
      const from = this.#rackFrom[i]!;
      const to = this.#rack[i]!;
      // Stagger the balls slightly so the rack assembles rather than snapping at once.
      const delay = (i / Math.max(1, n - 1)) * 0.25;
      const raw = clamp01((t - delay) / (RACK_SEC - 0.25));
      if (raw < 1) done = false;
      const u = easeInOutCubic(raw);
      ball.position.set(
        from.x + (to.x - from.x) * u,
        from.y + (this.#ballY - from.y) * u + Math.sin(u * Math.PI) * RACK_LIFT,
        from.z + (to.z - from.z) * u
      );
      ball.updateMatrixWorld(true);
    }
    if (done) {
      for (let i = 0; i < n; i++) {
        const ball = this.#balls[i]!;
        const to = this.#rack[i]!;
        ball.position.set(to.x, this.#ballY, to.z);
        ball.updateMatrixWorld(true);
      }
      this.#sim = null;
      this.#phase = 'racked';
    }
  }

  // --- Encapsulated 3D Pool Table Audio ----------------------------------------------------

  #getTableWorldPoint(localX: number, localZ: number, out: THREE.Vector3): THREE.Vector3 {
    const tableGroup = this.#cue.parent ?? this.#balls[0]?.parent ?? null;
    if (tableGroup) {
      tableGroup.updateWorldMatrix(true, false);
      return out.set(localX, this.#ballY, localZ).applyMatrix4(tableGroup.matrixWorld);
    }
    return out.set(localX, this.#ballY, localZ);
  }

  #playStrikeSound(): void {
    const cueBall = this.#rack[0] ?? { x: -0.48, z: 0 };
    const worldPos = this.#getTableWorldPoint(cueBall.x, cueBall.z, this.#tmp);
    soundEngine.playSpatial(
      worldPos,
      (tk) => {
        const { now } = tk;
        tk.tone({
          startTime: now,
          duration: 0.045,
          type: 'sine',
          freqStart: 1950,
          freqEnd: 920,
          gainPeak: 0.28,
        });
        tk.tone({
          startTime: now,
          duration: 0.032,
          type: 'triangle',
          freqStart: 3450,
          freqEnd: 2100,
          gainPeak: 0.16,
        });
        tk.noiseBurst({
          startTime: now,
          duration: 0.025,
          filterType: 'bandpass',
          freqStart: 2200,
          freqEnd: 1100,
          q: 3.0,
          gainPeak: 0.14,
        });
      },
      { dryGain: 0.65, wetSend: 0.2, refDistance: 2.2, maxDistance: 22 }
    );
  }

  #playBreakScatterSound(): void {
    const worldPos = this.#getTableWorldPoint(0.32, 0, this.#tmp);
    soundEngine.playSpatial(
      worldPos,
      (tk) => {
        const { now } = tk;
        for (let i = 0; i < 11; i++) {
          const dt = i * 0.018 + Math.random() * 0.025;
          const f0 = 2650 + Math.random() * 1450;
          const decay = Math.pow(0.84, i);
          tk.tone({
            startTime: now + dt,
            duration: 0.038,
            type: 'sine',
            freqStart: f0,
            freqEnd: f0 * 0.82,
            gainPeak: 0.22 * decay,
          });
          tk.tone({
            startTime: now + dt,
            duration: 0.024,
            type: 'triangle',
            freqStart: f0 * 1.62,
            freqEnd: f0 * 1.4,
            gainPeak: 0.11 * decay,
          });
        }
        // Slate bed & wool baize rolling rumble + rubber cushion thuds
        tk.noiseBurst({
          startTime: now + 0.04,
          duration: 0.72,
          filterType: 'bandpass',
          freqStart: 420,
          freqEnd: 165,
          q: 1.4,
          gainPeak: 0.085,
        });
        for (let c = 0; c < 4; c++) {
          const cTime = now + 0.16 + c * 0.14 + Math.random() * 0.05;
          tk.tone({
            startTime: cTime,
            duration: 0.075,
            type: 'sine',
            freqStart: 138,
            freqEnd: 56,
            gainPeak: 0.12 * Math.pow(0.78, c),
          });
        }
      },
      { dryGain: 0.68, wetSend: 0.22, refDistance: 2.2, maxDistance: 22 }
    );
  }

  #playPocketDropSound(pocketX: number, pocketZ: number): void {
    const worldPos = this.#getTableWorldPoint(pocketX, pocketZ, this.#tmp);
    soundEngine.playSpatial(
      worldPos,
      (tk) => {
        const { now } = tk;
        tk.tone({
          startTime: now,
          duration: 0.14,
          type: 'sine',
          freqStart: 165,
          freqEnd: 62,
          gainPeak: 0.26,
        });
        tk.tone({
          startTime: now + 0.055,
          duration: 0.065,
          type: 'triangle',
          freqStart: 880,
          freqEnd: 460,
          gainPeak: 0.12,
        });
        tk.noiseBurst({
          startTime: now + 0.02,
          duration: 0.11,
          filterType: 'bandpass',
          freqStart: 920,
          freqEnd: 420,
          q: 2.2,
          gainPeak: 0.09,
        });
      },
      { dryGain: 0.62, wetSend: 0.2, refDistance: 2.0, maxDistance: 20 }
    );
  }

  #playRackSound(): void {
    const worldPos = this.#getTableWorldPoint(0.28, 0, this.#tmp);
    soundEngine.playSpatial(
      worldPos,
      (tk) => {
        const { now } = tk;
        for (let i = 0; i < 8; i++) {
          const dt = i * 0.065 + Math.random() * 0.025;
          const f0 = 2400 + Math.random() * 1100;
          tk.tone({
            startTime: now + dt,
            duration: 0.032,
            type: 'sine',
            freqStart: f0,
            freqEnd: f0 * 0.85,
            gainPeak: 0.11,
          });
        }
        tk.noiseBurst({
          startTime: now,
          duration: 0.65,
          filterType: 'bandpass',
          freqStart: 560,
          freqEnd: 280,
          q: 1.5,
          gainPeak: 0.065,
        });
      },
      { dryGain: 0.58, wetSend: 0.2, refDistance: 2.2, maxDistance: 20 }
    );
  }
}
