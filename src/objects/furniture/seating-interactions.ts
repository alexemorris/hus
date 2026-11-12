import * as THREE from 'three';
import { soundEngine } from '../../engine/audio/sound-engine.ts';
import type {
  AnimatedInteractable,
  FirstPersonPoseSample,
} from '../../engine/interaction/handlers/animated-interactable.ts';

export type SeatUpholsteryMaterial = 'velvet' | 'linen' | 'leather' | 'timber' | 'beanbag';

export interface SeatPoseConfig {
  readonly id: string;
  readonly label: string;
  readonly aliases: readonly string[];
  readonly anchor: THREE.Object3D;
  readonly clickableTargets: readonly THREE.Object3D[];
  /** Seat cushion top center in `anchor` local coordinates `[x, y, z]`. */
  readonly localSeatPos: readonly [number, number, number];
  /** Dismount standing foot position in `anchor` local coordinates `[x, y, z]`. */
  readonly localFootOffset: readonly [number, number, number];
  /** Natural forward look direction in `anchor` local coordinates `[dx, dy, dz]`. */
  readonly localForward: readonly [number, number, number];
  /** Seated eye height above `localSeatPos[1]` in metres (default `0.72`). */
  readonly seatedEyeHeightM?: number;
  /** Initial seated pitch in radians (default `-0.04`). */
  readonly pitchRad?: number;
  /** Horizontal proximity trigger radius in metres (default `0.95`). */
  readonly proximityRadiusM?: number;
  readonly material: SeatUpholsteryMaterial;
}

const EXCLUDED_MICRO_MESH_NAME_RE =
  /piping|flange|welt|seam|pleat|kickPanel|ropeCord|caster|starLeg|ferrule|sabot|stud|button|zipper/i;

/**
 * Collects raycastable cushion, backrest, armrest, and frame meshes under `root`,
 * skipping ultra-fine piping/welt/cord detail meshes so raycasting stays fast.
 */
export function collectSeatClickableMeshes(
  root: THREE.Object3D,
  predicate?: (mesh: THREE.Mesh) => boolean
): THREE.Object3D[] {
  const meshes: THREE.Object3D[] = [];
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (EXCLUDED_MICRO_MESH_NAME_RE.test(obj.name)) return;
    if (predicate && !predicate(obj)) return;
    meshes.push(obj);
  });
  return meshes.length > 0 ? meshes : [root];
}

/**
 * Synthesizes a subtle, material-accurate sit-down or stand-up sound at `worldPos`
 * using the Web Audio API. Fully encapsulated inside `seating-interactions.ts`.
 */
function playSeatAudio(
  material: SeatUpholsteryMaterial,
  mode: 'sit' | 'stand',
  worldPos: THREE.Vector3
): void {
  try {
    soundEngine.playSpatial(worldPos, (tk) => {
      const { now } = tk;
      const isSit = mode === 'sit';

      // 1. Low-frequency cushion / frame compression thump
      const startFreq =
        material === 'timber'
          ? isSit
            ? 142
            : 118
          : material === 'leather'
            ? isSit
              ? 156
              : 128
            : material === 'beanbag'
              ? isSit
                ? 86
                : 98
              : isSit
                ? 98
                : 112;
      const endFreq =
        material === 'timber'
          ? 68
          : material === 'leather'
            ? 84
            : material === 'beanbag'
              ? 38
              : 44;
      const bodyDuration = isSit ? 0.22 : 0.15;

      tk.tone({
        startTime: now,
        duration: bodyDuration,
        type: material === 'leather' ? 'triangle' : 'sine',
        freqStart: startFreq,
        freqEnd: endFreq,
        gainPeak: isSit ? 0.055 : 0.032,
        attackSec: 0.022,
      });

      // 2. Filtered fabric / air-sigh / microbead / leather texture layer
      const noiseDuration =
        material === 'beanbag' ? (isSit ? 0.34 : 0.24) : isSit ? 0.25 : 0.17;
      const centerFreq =
        material === 'velvet'
          ? 440
          : material === 'linen'
            ? 660
            : material === 'leather'
              ? 380
              : material === 'beanbag'
                ? 880
                : 760;
      const peakNoiseGain =
        material === 'timber'
          ? 0.016
          : material === 'beanbag'
            ? 0.042
            : 0.028;

      tk.noiseBurst({
        startTime: now + 0.01,
        duration: noiseDuration,
        filterType: 'bandpass',
        freqStart: centerFreq,
        freqEnd: isSit ? centerFreq * 0.62 : centerFreq * 1.18,
        q: material === 'beanbag' ? 2.4 : 1.6,
        gainPeak: isSit ? peakNoiseGain : peakNoiseGain * 0.65,
        attackSec: 0.03,
      });
    });
  } catch {
    // Ignore Web Audio errors in headless test environments
  }
}

/**
 * Self-contained 1st-person seating interactable for a sofa, armchair, dining chair,
 * counter stool, bar stool, bench, beanbag, or pouffe.
 *
 * Clicking the seat in Orbit View or 1st-Person View (or pressing `F` while looking at
 * or standing near it in 1PV) smoothly transitions the camera onto the seat cushion facing
 * its natural viewing direction with full 360° free look (`allowFreeLook: true`).
 * Pressing `W`/`A`/`S`/`D`, Arrow keys, `Space`, or `F` (or clicking the seat again)
 * smoothly stands the player up to the clear floor spot in front of the seat.
 */
export class SeatInteractable implements AnimatedInteractable {
  public readonly id: string;
  public readonly label: string;
  public readonly aliases: readonly string[];
  public readonly clickableTargets: readonly THREE.Object3D[];

  private readonly anchor: THREE.Object3D;
  private readonly localSeatPos: THREE.Vector3;
  private readonly localFootOffset: THREE.Vector3;
  private readonly localForward: THREE.Vector3;
  private readonly seatedEyeHeightM: number;
  private readonly pitchRad: number;
  private readonly proximityRadiusM: number;
  private readonly material: SeatUpholsteryMaterial;

  private seated = false;
  private elapsedSec = 0;

  private readonly tmpSeatWorld = new THREE.Vector3();
  private readonly tmpFootWorld = new THREE.Vector3();
  private readonly tmpFwdWorld = new THREE.Vector3();
  private readonly tmpNormalMatrix = new THREE.Matrix3();

  public constructor(config: SeatPoseConfig) {
    this.id = config.id;
    this.label = config.label;
    this.aliases = config.aliases;
    this.anchor = config.anchor;
    this.clickableTargets = config.clickableTargets;
    this.localSeatPos = new THREE.Vector3(
      config.localSeatPos[0],
      config.localSeatPos[1],
      config.localSeatPos[2]
    );
    this.localFootOffset = new THREE.Vector3(
      config.localFootOffset[0],
      config.localFootOffset[1],
      config.localFootOffset[2]
    );
    this.localForward = new THREE.Vector3(
      config.localForward[0],
      config.localForward[1],
      config.localForward[2]
    ).normalize();
    this.seatedEyeHeightM = config.seatedEyeHeightM ?? 0.72;
    this.pitchRad = config.pitchRad ?? -0.04;
    this.proximityRadiusM = config.proximityRadiusM ?? 0.95;
    this.material = config.material;
  }

  private updateWorldVectors(): {
    readonly seatWorld: THREE.Vector3;
    readonly footWorld: THREE.Vector3;
    readonly yawRad: number;
  } {
    this.anchor.updateMatrixWorld(true);
    const mw = this.anchor.matrixWorld;
    this.tmpSeatWorld.copy(this.localSeatPos).applyMatrix4(mw);
    this.tmpFootWorld.copy(this.localFootOffset).applyMatrix4(mw);
    this.tmpNormalMatrix.getNormalMatrix(mw);
    this.tmpFwdWorld.copy(this.localForward).applyMatrix3(this.tmpNormalMatrix).normalize();
    const yawRad = Math.atan2(-this.tmpFwdWorld.x, -this.tmpFwdWorld.z);
    return {
      seatWorld: this.tmpSeatWorld,
      footWorld: this.tmpFootWorld,
      yawRad,
    };
  }

  public trigger(): boolean {
    this.seated = !this.seated;
    this.elapsedSec = 0;
    const { seatWorld } = this.updateWorldVectors();
    playSeatAudio(this.material, this.seated ? 'sit' : 'stand', seatWorld);
    return true;
  }

  public describe(): string {
    return this.seated ? `Stand Up from ${this.label}` : `Sit on ${this.label}`;
  }

  public step(dtSeconds: number): boolean {
    if (this.seated) {
      this.elapsedSec += dtSeconds;
    }
    return false;
  }

  public collectDynamicObjects(_out: Set<THREE.Object3D>): void {
    // Seat geometry does not move when sat on, keeping all sofa/chair meshes static-batchable.
  }

  public isFirstPersonActive(): boolean {
    return this.seated;
  }

  public sampleFirstPersonPose(): FirstPersonPoseSample | null {
    if (!this.seated) return null;
    const { seatWorld, footWorld, yawRad } = this.updateWorldVectors();
    const breathBobY = Math.sin(this.elapsedSec * 1.65) * 0.0035;
    return {
      poseId: this.id,
      eyePosition: [
        seatWorld.x,
        seatWorld.y + this.seatedEyeHeightM + breathBobY,
        seatWorld.z,
      ],
      footPosition: [footWorld.x, footWorld.y, footWorld.z],
      yawRad,
      pitchRad: this.pitchRad,
      allowFreeLook: true,
      activePrompt: `Stand Up from ${this.label}`,
    };
  }

  public cancelFirstPerson(): void {
    if (!this.seated) return;
    this.seated = false;
    this.elapsedSec = 0;
    const { seatWorld } = this.updateWorldVectors();
    playSeatAudio(this.material, 'stand', seatWorld);
  }

  public isPlayerInProximityZone(footX: number, footY: number, footZ: number): boolean {
    const { seatWorld, footWorld } = this.updateWorldVectors();
    if (this.seated) {
      const distFoot = Math.hypot(footX - footWorld.x, footZ - footWorld.z);
      const distSeat = Math.hypot(footX - seatWorld.x, footZ - seatWorld.z);
      return (
        Math.min(distFoot, distSeat) <= 1.85 &&
        Math.abs(footY - footWorld.y) <= 1.1
      );
    }
    const distToSeat = Math.hypot(footX - seatWorld.x, footZ - seatWorld.z);
    const distToDismount = Math.hypot(footX - footWorld.x, footZ - footWorld.z);
    return (
      (distToSeat <= this.proximityRadiusM || distToDismount <= this.proximityRadiusM * 0.78) &&
      Math.abs(footY - footWorld.y) <= 0.65
    );
  }
}
