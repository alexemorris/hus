import * as THREE from 'three';
import { soundEngine } from '../../audio/sound-engine.ts';
import { easeInOutCubic, stepProgress } from '../interaction-math.ts';

/** 2-leaf concertina bi-fold cupboard door pair (e.g. the upper pantry doors). */
export interface BifoldCupboardState {
  readonly id: string;
  outerPivot: THREE.Group;
  innerLeaf: THREE.Group;
  readonly sideSign: -1 | 1; // -1 = left folding pair, +1 = right folding pair
  readonly leafWidth: number;
  readonly closedOuterX: number;
  readonly closedInnerX: number;
  readonly faceZ: number;
  isOpen: boolean;
  progress: number;
  readonly speed: number;
}

/** Concertina fold angle at full open (~79°). */
const BIFOLD_CUPBOARD_MAX_ANGLE = 1.38;

/**
 * Wraps `outerLeaf` in a pivot on its outer hinge edge (added to `parent`) and returns the state.
 * The caller registers both the pivot and `innerLeaf` as clickable.
 */
export function createBifoldCupboardPair(
  id: string,
  parent: THREE.Object3D,
  outerLeaf: THREE.Group,
  innerLeaf: THREE.Group,
  sideSign: -1 | 1,
  leafWidth: number,
  faceZ: number
): BifoldCupboardState {
  const closedOuterX = outerLeaf.position.x;
  const closedInnerX = innerLeaf.position.x;

  // Outer hinge is on the outer edge of outerLeaf:
  const outerHingeX = closedOuterX + sideSign * (leafWidth * 0.5);
  const outerPivot = new THREE.Group();
  outerPivot.position.set(outerHingeX, outerLeaf.position.y, faceZ);

  parent.remove(outerLeaf);
  outerLeaf.position.set(-sideSign * (leafWidth * 0.5), 0, 0);
  outerPivot.add(outerLeaf);
  parent.add(outerPivot);

  return {
    id,
    outerPivot,
    innerLeaf,
    sideSign,
    leafWidth,
    closedOuterX,
    closedInnerX,
    faceZ,
    isOpen: false,
    progress: 0,
    speed: 2.4,
  };
}

/** Steps a bi-fold cupboard animation. Returns true if it moved. */
export function stepBifoldCupboard(bf: BifoldCupboardState, dtSeconds: number): boolean {
  const target = bf.isOpen ? 1 : 0;
  if (bf.progress === target) return false;
  bf.progress = stepProgress(bf.progress, target, dtSeconds, bf.speed);
  const smooth = easeInOutCubic(bf.progress);
  const theta = smooth * BIFOLD_CUPBOARD_MAX_ANGLE;

  // Outer leaf pivots outward around its outer hinge
  bf.outerPivot.rotation.y = bf.sideSign * theta;
  bf.outerPivot.updateMatrixWorld(true);

  // Inner leaf travels with the knuckle joint and counter-rotates
  const outerHingeX = bf.closedOuterX + bf.sideSign * (bf.leafWidth * 0.5);
  const knuckleX = outerHingeX - bf.sideSign * bf.leafWidth * Math.cos(theta);
  const knuckleZ = bf.faceZ + bf.leafWidth * Math.sin(theta);

  bf.innerLeaf.position.x = knuckleX - bf.sideSign * (bf.leafWidth * 0.5) * Math.cos(theta);
  bf.innerLeaf.position.z = knuckleZ - bf.leafWidth * 0.5 * Math.sin(theta);
  bf.innerLeaf.rotation.y = -bf.sideSign * theta;
  bf.innerLeaf.updateMatrixWorld(true);
  return true;
}

const tmpBifoldSoundPos = new THREE.Vector3();

/** Synthesizes 3D concertina roller track glide + knuckle hinge clicks for bifold doors. */
export function playBifoldSound(anchor: THREE.Object3D | undefined, isOpening: boolean): void {
  const worldPos = anchor ? anchor.getWorldPosition(tmpBifoldSoundPos) : undefined;
  soundEngine.playSpatial(
    worldPos,
    (tk) => {
      const { now } = tk;
      tk.noiseBurst({
        startTime: now,
        duration: 0.42,
        filterType: 'bandpass',
        freqStart: isOpening ? 480 : 720,
        freqEnd: isOpening ? 780 : 390,
        q: 1.9,
        gainPeak: 0.14,
        attackSec: 0.04,
      });
      tk.tone({
        startTime: now + 0.02,
        duration: 0.045,
        type: 'triangle',
        freqStart: 1350,
        freqEnd: 720,
        gainPeak: 0.1,
      });
      tk.tone({
        startTime: now + 0.34,
        duration: 0.08,
        type: 'sine',
        freqStart: 145,
        freqEnd: 58,
        gainPeak: 0.16,
      });
    },
    { dryGain: 0.55, wetSend: 0.22, refDistance: 2.0, maxDistance: 22 }
  );
}
