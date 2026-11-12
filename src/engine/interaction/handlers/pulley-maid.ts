import * as THREE from 'three';
import { soundEngine } from '../../audio/sound-engine.ts';
import { easeInOutCubic, stepProgress } from '../interaction-math.ts';

/** Fixed interactable id of the Utility Room pulley maid airer. */
export const PULLEY_MAID_ID = 'pulley-maid';

export interface PulleyMaidConfig {
  readonly clickRoot: THREE.Object3D;
  readonly rackMovingGroup: THREE.Group;
  readonly vertRopes: readonly THREE.Mesh[];
  readonly pulleyWheels: readonly THREE.Mesh[];
  readonly wallHaulRope: THREE.Mesh;
  readonly baseRopeLength: number;
  readonly pulleyCeilingY: number;
  readonly baseRackEyeY: number;
  readonly baseWallRopeLength: number;
  readonly wallPulleyY: number;
  readonly dropDistance?: number;
}

export interface PulleyMaidState {
  readonly id: string;
  rackMovingGroup: THREE.Group;
  vertRopes: readonly THREE.Mesh[];
  pulleyWheels: readonly THREE.Mesh[];
  wallHaulRope: THREE.Mesh;
  readonly baseRopeLength: number;
  readonly pulleyCeilingY: number;
  readonly baseRackEyeY: number;
  readonly baseWallRopeLength: number;
  readonly wallPulleyY: number;
  readonly dropDistance: number;
  isLowered: boolean;
  progress: number;
  readonly speed: number;
}

/** Tags the moving parts with `pulleyMaidRole` userData for static batching exclusion and scene fingerprinting. */
export function tagPulleyMaidRoles(config: PulleyMaidConfig): void {
  config.rackMovingGroup.userData = {
    ...config.rackMovingGroup.userData,
    pulleyMaidRole: 'rackMovingGroup',
  };
  config.vertRopes.forEach((rope, idx) => {
    rope.userData = { ...rope.userData, pulleyMaidRole: 'vertRope', pulleyMaidIndex: idx };
  });
  config.pulleyWheels.forEach((wheel, idx) => {
    wheel.userData = { ...wheel.userData, pulleyMaidRole: 'pulleyWheel', pulleyMaidIndex: idx };
  });
  config.wallHaulRope.userData = { ...config.wallHaulRope.userData, pulleyMaidRole: 'wallHaulRope' };
}

export function createPulleyMaidState(config: PulleyMaidConfig): PulleyMaidState {
  return {
    id: PULLEY_MAID_ID,
    rackMovingGroup: config.rackMovingGroup,
    vertRopes: config.vertRopes,
    pulleyWheels: config.pulleyWheels,
    wallHaulRope: config.wallHaulRope,
    baseRopeLength: config.baseRopeLength,
    pulleyCeilingY: config.pulleyCeilingY,
    baseRackEyeY: config.baseRackEyeY,
    baseWallRopeLength: config.baseWallRopeLength,
    wallPulleyY: config.wallPulleyY,
    dropDistance: config.dropDistance ?? 0.84,
    isLowered: false,
    progress: 0,
    speed: 1.65,
  };
}

/** Steps the airer lowering/raising animation. Returns true if it moved. */
export function stepPulleyMaid(pm: PulleyMaidState, dtSeconds: number): boolean {
  const target = pm.isLowered ? 1 : 0;
  if (pm.progress === target) return false;
  pm.progress = stepProgress(pm.progress, target, dtSeconds, pm.speed);
  const smooth = easeInOutCubic(pm.progress);
  const drop = smooth * pm.dropDistance;

  pm.rackMovingGroup.position.y = -drop;
  pm.rackMovingGroup.updateMatrixWorld(true);

  const newEyeY = pm.baseRackEyeY - drop;
  const newRopeLen = Math.max(0.1, pm.pulleyCeilingY - newEyeY);
  const ropeCenterY = (pm.pulleyCeilingY + newEyeY) * 0.5;
  const scaleY = newRopeLen / pm.baseRopeLength;

  for (const rope of pm.vertRopes) {
    rope.scale.y = scaleY;
    rope.position.y = ropeCenterY;
    rope.updateMatrixWorld(true);
  }

  for (const wheel of pm.pulleyWheels) {
    wheel.rotation.z = smooth * Math.PI * 6;
    wheel.updateMatrixWorld(true);
  }

  // As the rack lowers by `drop`, rope is paid out from the wall cleat so the slack loop on the wall shortens slightly
  const newWallLen = Math.max(0.7, pm.baseWallRopeLength - drop * 0.45);
  pm.wallHaulRope.scale.y = newWallLen / pm.baseWallRopeLength;
  pm.wallHaulRope.position.y = pm.wallPulleyY - newWallLen * 0.5;
  pm.wallHaulRope.updateMatrixWorld(true);
  return true;
}

export function collectPulleyMaidDynamicObjects(
  pm: PulleyMaidState,
  outSet: Set<THREE.Object3D>
): void {
  pm.rackMovingGroup.traverse((c) => outSet.add(c));
  for (const rope of pm.vertRopes) outSet.add(rope);
  for (const wheel of pm.pulleyWheels) outSet.add(wheel);
  outSet.add(pm.wallHaulRope);
}

const tmpPulleySoundPos = new THREE.Vector3();

/** Synthesizes rhythmic cast-iron ceiling pulley wheel squeaks and cotton rope draw. */
export function playPulleyMaidSound(pm: PulleyMaidState): void {
  pm.rackMovingGroup.getWorldPosition(tmpPulleySoundPos);
  soundEngine.playSpatial(
    tmpPulleySoundPos,
    (tk) => {
      const { now } = tk;
      for (let i = 0; i < 4; i++) {
        const t0 = now + i * 0.11;
        tk.tone({
          startTime: t0,
          duration: 0.08,
          type: 'sine',
          freqStart: 1380 + i * 65,
          freqEnd: 1120 + i * 50,
          gainPeak: 0.055,
        });
      }
      tk.noiseBurst({
        startTime: now,
        duration: 0.46,
        filterType: 'bandpass',
        freqStart: 640,
        freqEnd: 480,
        q: 1.5,
        gainPeak: 0.09,
        attackSec: 0.04,
      });
    },
    { dryGain: 0.55, wetSend: 0.22, refDistance: 2.0, maxDistance: 20 }
  );
}
