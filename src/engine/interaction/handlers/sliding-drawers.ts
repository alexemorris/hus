import * as THREE from 'three';
import { soundEngine } from '../../audio/sound-engine.ts';
import { easeInOutCubic, stepProgress } from '../interaction-math.ts';

/** Sliding pan/warming drawer, or a fade-out prop (golf bag) linked to a door. */
export interface SlidingDrawerState {
  readonly id: string;
  group: THREE.Group;
  readonly closedPos: THREE.Vector3;
  readonly openPos: THREE.Vector3;
  isOpen: boolean;
  progress: number;
  readonly speed: number;
  linkedDoorId?: string;
  fadeOutWhenOpen?: boolean;
  fadeMaterials?: THREE.Material[];
}

export function createSlidingDrawerState(
  id: string,
  drawerGroup: THREE.Group,
  slideDelta: THREE.Vector3
): SlidingDrawerState {
  const closedPos = drawerGroup.position.clone();
  const openPos = closedPos.clone().add(slideDelta);
  return {
    id,
    group: drawerGroup,
    closedPos,
    openPos,
    isOpen: false,
    progress: 0,
    speed: 2.8,
  };
}

/** Clones every material under `root` (once per source) so the group can fade independently. */
export function prepareFadeMaterialsForGroup(root: THREE.Object3D): THREE.Material[] {
  const clonedBySource = new Map<THREE.Material, THREE.Material>();
  const result: THREE.Material[] = [];
  const cloneOnce = (m: THREE.Material): THREE.Material => {
    let cloned = clonedBySource.get(m);
    if (!cloned) {
      cloned = m.clone();
      cloned.userData = { ...cloned.userData, isDynamicGolfBagMaterial: true };
      clonedBySource.set(m, cloned);
      result.push(cloned);
    }
    return cloned;
  };
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (Array.isArray(obj.material)) {
      obj.material = obj.material.map((m: THREE.Material) => cloneOnce(m));
    } else if (obj.material) {
      obj.material = cloneOnce(obj.material as THREE.Material);
    }
  });
  return result;
}

export function applyGroupFadeAlpha(
  group: THREE.Object3D,
  materials: readonly THREE.Material[] | undefined,
  alpha: number
): void {
  const clamped = Math.max(0, Math.min(1, alpha));
  group.visible = clamped > 0.005;
  if (materials) {
    for (const mat of materials) {
      mat.transparent = clamped < 0.999;
      mat.opacity = clamped;
      mat.depthWrite = clamped > 0.25;
      mat.needsUpdate = true;
    }
  }
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = clamped > 0.35;
    }
  });
}

function applyDrawerPose(dr: SlidingDrawerState): void {
  const smooth = easeInOutCubic(dr.progress);
  if (dr.fadeOutWhenOpen) {
    applyGroupFadeAlpha(dr.group, dr.fadeMaterials, 1 - smooth);
  } else {
    dr.group.position.lerpVectors(dr.closedPos, dr.openPos, smooth);
  }
}

/** Steps a drawer animation. Returns true if it moved. */
export function stepSlidingDrawer(dr: SlidingDrawerState, dtSeconds: number): boolean {
  const target = dr.isOpen ? 1 : 0;
  if (dr.progress === target) return false;
  dr.progress = stepProgress(dr.progress, target, dtSeconds, dr.speed);
  applyDrawerPose(dr);
  dr.group.updateMatrixWorld(true);
  return true;
}

const tmpDrawerSoundPos = new THREE.Vector3();

/** Synthesizes 3D soft-close drawer runner glide and timber stop thud. */
export function playSlidingDrawerSound(dr: SlidingDrawerState): void {
  dr.group.getWorldPosition(tmpDrawerSoundPos);
  soundEngine.playSpatial(
    tmpDrawerSoundPos,
    (tk) => {
      const { now } = tk;
      tk.noiseBurst({
        startTime: now,
        duration: 0.32,
        filterType: 'bandpass',
        freqStart: dr.isOpen ? 580 : 820,
        freqEnd: dr.isOpen ? 920 : 480,
        q: 1.6,
        gainPeak: 0.11,
        attackSec: 0.03,
      });
      tk.tone({
        startTime: now + 0.25,
        duration: 0.07,
        type: 'sine',
        freqStart: 138,
        freqEnd: 54,
        gainPeak: 0.14,
      });
    },
    { dryGain: 0.55, wetSend: 0.2, refDistance: 2.0, maxDistance: 20 }
  );
}
