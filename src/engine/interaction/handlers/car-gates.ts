import * as THREE from 'three';
import { soundEngine } from '../../audio/sound-engine.ts';
import { easeInOutCubic, stepProgress } from '../interaction-math.ts';
import { wrapInHingePivot } from './hinge-pivot.ts';

/** Motorized dual-leaf front car entrance gates (KNX GA 1/5/1). */
export interface MotorizedCarGatePairState {
  northPivot: THREE.Group;
  southPivot: THREE.Group;
  readonly northOpenAngle: number;
  readonly southOpenAngle: number;
  isOpen: boolean;
  progress: number;
  readonly speed: number;
}

/** Wraps both leaves in hinge pivots (added to `parent`) and returns the gate pair state. */
export function createMotorizedCarGatePair(
  parent: THREE.Object3D,
  northLeaf: THREE.Object3D,
  northHingeOffset: THREE.Vector3,
  northOpenAngle: number,
  southLeaf: THREE.Object3D,
  southHingeOffset: THREE.Vector3,
  southOpenAngle: number,
  travelDurationSec: number
): MotorizedCarGatePairState {
  const northPivot = wrapInHingePivot(parent, northLeaf, northHingeOffset);
  parent.add(northPivot);
  const southPivot = wrapInHingePivot(parent, southLeaf, southHingeOffset);
  parent.add(southPivot);
  return {
    northPivot,
    southPivot,
    northOpenAngle,
    southOpenAngle,
    isOpen: false,
    progress: 0,
    speed: 1.0 / Math.max(1.0, travelDurationSec),
  };
}

/** Steps the gate swing. Returns true if the leaves moved. */
export function stepCarGates(cg: MotorizedCarGatePairState, dtSeconds: number): boolean {
  const target = cg.isOpen ? 1 : 0;
  if (cg.progress === target) return false;
  cg.progress = stepProgress(cg.progress, target, dtSeconds, cg.speed);
  const smooth = easeInOutCubic(cg.progress);
  cg.northPivot.rotation.y = cg.northOpenAngle * smooth;
  cg.southPivot.rotation.y = cg.southOpenAngle * smooth;
  cg.northPivot.updateMatrixWorld(true);
  cg.southPivot.updateMatrixWorld(true);
  return true;
}

const tmpCarGateSoundPos = new THREE.Vector3();

/** Synthesizes 3D dual-leaf motorized entrance gate latch clunk and hydraulic actuator hum. */
export function playCarGateSound(cg: MotorizedCarGatePairState): void {
  cg.northPivot.getWorldPosition(tmpCarGateSoundPos);
  soundEngine.playSpatial(
    tmpCarGateSoundPos,
    (tk) => {
      const { now } = tk;
      tk.tone({
        startTime: now,
        duration: 0.06,
        type: 'triangle',
        freqStart: 420,
        freqEnd: 180,
        gainPeak: 0.18,
      });
      tk.tone({
        startTime: now + 0.04,
        duration: 0.9,
        type: 'sawtooth',
        freqStart: cg.isOpen ? 78 : 88,
        freqEnd: cg.isOpen ? 86 : 72,
        gainPeak: 0.065,
      });
    },
    { dryGain: 0.55, wetSend: 0.08, refDistance: 3.5, maxDistance: 30 }
  );
}
