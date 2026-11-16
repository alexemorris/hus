import * as THREE from 'three';
import { soundEngine } from '../../audio/sound-engine.ts';
import { easeInOutCubic, stepProgress } from '../interaction-math.ts';
import { wrapInHingePivot } from './hinge-pivot.ts';

export interface SwingGatePairConfig {
  readonly id: string;
  readonly parent: THREE.Object3D;
  readonly leafA: THREE.Object3D;
  readonly hingeOffsetA: THREE.Vector3;
  readonly openAngleA: number;
  readonly leafB: THREE.Object3D;
  readonly hingeOffsetB: THREE.Vector3;
  readonly openAngleB: number;
  readonly travelDurationSec?: number;
  readonly label?: string;
  readonly aliases?: readonly string[];
  readonly clickableTargets?: readonly THREE.Object3D[];
  /** Optional override hook invoked on click/trigger (e.g. to route through a KNX cover channel). */
  readonly onToggle?: (nextOpen: boolean) => void;
}

/** Generic motorized or manual dual-leaf paired swing gate state. */
export interface SwingGatePairState {
  readonly id: string;
  readonly pivotA: THREE.Group;
  readonly pivotB: THREE.Group;
  readonly openAngleA: number;
  readonly openAngleB: number;
  isOpen: boolean;
  progress: number;
  readonly speed: number;
}

/** Wraps both leaves in hinge pivots (added to `parent`) and returns the paired swing-gate state. */
export function createSwingGatePair(config: SwingGatePairConfig): SwingGatePairState {
  const {
    id,
    parent,
    leafA,
    hingeOffsetA,
    openAngleA,
    leafB,
    hingeOffsetB,
    openAngleB,
    travelDurationSec = 10.0,
  } = config;
  const pivotA = wrapInHingePivot(parent, leafA, hingeOffsetA);
  parent.add(pivotA);
  const pivotB = wrapInHingePivot(parent, leafB, hingeOffsetB);
  parent.add(pivotB);
  return {
    id,
    pivotA,
    pivotB,
    openAngleA,
    openAngleB,
    isOpen: false,
    progress: 0,
    speed: 1.0 / Math.max(1.0, travelDurationSec),
  };
}

/** Steps the gate swing. Returns true if the leaves moved. */
export function stepSwingGatePair(gate: SwingGatePairState, dtSeconds: number): boolean {
  const target = gate.isOpen ? 1 : 0;
  if (gate.progress === target) return false;
  gate.progress = stepProgress(gate.progress, target, dtSeconds, gate.speed);
  const smooth = easeInOutCubic(gate.progress);
  gate.pivotA.rotation.y = gate.openAngleA * smooth;
  gate.pivotB.rotation.y = gate.openAngleB * smooth;
  gate.pivotA.updateMatrixWorld(true);
  gate.pivotB.updateMatrixWorld(true);
  return true;
}

const tmpGateSoundPos = new THREE.Vector3();

/** Synthesizes 3D dual-leaf gate latch clunk and actuator hum. */
export function playSwingGateSound(gate: SwingGatePairState): void {
  gate.pivotA.getWorldPosition(tmpGateSoundPos);
  soundEngine.playSpatial(
    tmpGateSoundPos,
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
        freqStart: gate.isOpen ? 78 : 88,
        freqEnd: gate.isOpen ? 86 : 72,
        gainPeak: 0.065,
      });
    },
    { dryGain: 0.55, wetSend: 0.08, refDistance: 3.5, maxDistance: 30 }
  );
}
