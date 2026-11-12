import * as THREE from 'three';
import { soundEngine } from '../../audio/sound-engine.ts';
import { easeInOutCubic } from '../interaction-math.ts';
import type { HingedDoorState } from './hinged-doors.ts';
import { wrapInHingePivot } from './hinge-pivot.ts';
import { prepareFadeMaterialsForGroup, type SlidingDrawerState } from './sliding-drawers.ts';

/** Fixed interactable id of the Barn TrackMan golf simulator shot. */
export const GOLF_SIMULATOR_SHOT_ID = 'golf-simulator-shot';

export interface GolfSimulatorShotConfig {
  readonly clubSwingPivot: THREE.Group;
  readonly teedBall: THREE.Mesh;
  readonly screenMesh: THREE.Mesh;
  readonly launchStreakMesh: THREE.Mesh;
  readonly screenImpactRing: THREE.Mesh;
  readonly clickableTargets: readonly THREE.Object3D[];
  readonly matDoorId?: string;
  readonly onUpdateScreens: (shotIndex: number, flightProgress: number) => void;
}

export interface GolfSimulatorShotState {
  readonly id: string;
  readonly clubSwingPivot: THREE.Group;
  readonly teedBall: THREE.Mesh;
  readonly screenMesh: THREE.Mesh;
  readonly launchStreakMesh: THREE.Mesh;
  readonly screenImpactRing: THREE.Mesh;
  readonly bagStowPos: THREE.Vector3;
  readonly bagStowRot: THREE.Euler;
  readonly addressClubPos: THREE.Vector3;
  readonly baseBallPos: THREE.Vector3;
  readonly baseScreenPos: THREE.Vector3;
  readonly matDoorId?: string;
  readonly onUpdateScreens: (shotIndex: number, flightProgress: number) => void;
  isPlaying: boolean;
  elapsedSec: number;
  shotIndex: number;
  lastRenderedScreenProgress: number;
}

const GOLF_SHOT_SCREEN_IMPACTS: ReadonlyArray<{
  readonly yHit: number;
  readonly zHit: number;
  readonly clubName: string;
}> = [
  { yHit: 1.38, zHit: -0.06, clubName: '46° Pitching Wedge (138 yds)' },
  { yHit: 1.06, zHit: -0.05, clubName: 'Driver (308 yds)' },
  { yHit: 1.56, zHit: 0.02, clubName: '54° Wedge (122 yds)' },
  { yHit: 1.14, zHit: -0.14, clubName: '3-Wood (275 yds)' },
];

const tmpStreakStart = new THREE.Vector3();
const tmpStreakEnd = new THREE.Vector3();
const tmpStreakDir = new THREE.Vector3();
const tmpStreakUp = new THREE.Vector3(0, 1, 0);

export function createGolfSimulatorShotState(
  config: GolfSimulatorShotConfig
): GolfSimulatorShotState {
  return {
    id: GOLF_SIMULATOR_SHOT_ID,
    clubSwingPivot: config.clubSwingPivot,
    teedBall: config.teedBall,
    screenMesh: config.screenMesh,
    launchStreakMesh: config.launchStreakMesh,
    screenImpactRing: config.screenImpactRing,
    bagStowPos: config.clubSwingPivot.position.clone(),
    bagStowRot: config.clubSwingPivot.rotation.clone(),
    addressClubPos: new THREE.Vector3(0.174, 0.86, 0.34),
    baseBallPos: config.teedBall.position.clone(),
    baseScreenPos: config.screenMesh.position.clone(),
    matDoorId: config.matDoorId,
    onUpdateScreens: config.onUpdateScreens,
    isPlaying: false,
    elapsedSec: 0,
    shotIndex: 0,
    lastRenderedScreenProgress: 1,
  };
}

/**
 * Builds the track-mounted sliding golf simulator stance mat (as a hinged-door state with
 * `isFoldingFloorMat`) and the linked fade-out Callaway Tour golf bag (as a drawer state).
 * The mat pivot is added to `parent`; the caller registers both as clickable.
 */
export function createFoldingGolfMat(
  matDoorId: string,
  bagDrawerId: string,
  parent: THREE.Object3D,
  foldingMatObj: THREE.Object3D,
  hingeOffsetInParent: THREE.Vector3,
  bagGroup: THREE.Group,
  bagStowedDelta: THREE.Vector3,
  onStateChange: ((isFolded: boolean) => void) | undefined
): { readonly matPivot: THREE.Group; readonly door: HingedDoorState; readonly bag: SlidingDrawerState } {
  const matPivot = new THREE.Group();
  matPivot.name = 'outbuildings.barn.golfSimulator.turfMat.foldingPivot';
  wrapInHingePivot(parent, foldingMatObj, hingeOffsetInParent, matPivot);
  parent.add(matPivot);

  const door: HingedDoorState = {
    id: matDoorId,
    pivot: matPivot,
    axis: 'z',
    closedAngle: 0,
    openAngle: 0,
    isOpen: false,
    progress: 0,
    speed: 0.95,
    isFoldingFloorMat: true,
    closedPivotPos: matPivot.position.clone(),
    stowedPivotOffset:
      bagStowedDelta.lengthSq() > 0.001 ? bagStowedDelta.clone() : new THREE.Vector3(-1.96, 0.036, 0),
    linkedDrawerId: bagDrawerId,
    onStateChange,
  };

  const closedPos = bagGroup.position.clone();
  const openPos = closedPos.clone();
  const bag: SlidingDrawerState = {
    id: bagDrawerId,
    group: bagGroup,
    closedPos,
    openPos,
    isOpen: false,
    progress: 0,
    speed: 2.4,
    linkedDoorId: matDoorId,
    fadeOutWhenOpen: true,
    fadeMaterials: prepareFadeMaterialsForGroup(bagGroup),
  };
  return { matPivot, door, bag };
}

/**
 * Dishwasher-rack threshold ramp kinematics for the sliding golf mat:
 * - Both sets of floor tracks (`outsideTrack` in the limestone tiles & `insideTrack` in the inside mat) remain FIXED & FLUSH.
 * - During `p in [0..0.22]`, the front rollers roll up the 220mm (8°) sloped threshold ramp bridge at `x = 0` while the rear edge is lifted 35mm into its step-up roller detent.
 * - During `p in [0..1.00]`, the mat rolls smoothly along the fixed channels (`slideDistanceX = 1.98m`).
 */
export function applySlidingGolfMatKinematics(
  door: HingedDoorState,
  golfShot: GolfSimulatorShotState | null
): void {
  if (!door.closedPivotPos) {
    door.closedPivotPos = door.pivot.position.clone();
  }
  const p = door.progress;
  const rampEnd = 0.22;
  const rawMatLift = Math.min(1, Math.max(0, p / rampEnd));
  const matLiftSmooth = easeInOutCubic(rawMatLift);
  const slideSmooth = easeInOutCubic(p);
  const liftHeightY = 0.036;
  const slideDistanceX = 1.98;

  // Slight nose-up pitch (~0.8°) as the leading rollers climb the threshold ramp before the rear step-up rollers lock level
  const rampPitchZ = p < rampEnd ? Math.sin((p / rampEnd) * Math.PI) * -0.014 : 0;

  door.pivot.rotation.set(0, 0, rampPitchZ);
  door.pivot.position.set(
    door.closedPivotPos.x - slideSmooth * slideDistanceX,
    door.closedPivotPos.y + matLiftSmooth * liftHeightY,
    door.closedPivotPos.z
  );

  const rollerAngleZ = (slideSmooth * slideDistanceX) / 0.009;
  door.pivot.traverse((child) => {
    if (child.userData?.isGolfMatTrackRoller) {
      child.rotation.z = rollerAngleZ;
    }
  });
  if (golfShot && !golfShot.isPlaying) {
    golfShot.clubSwingPivot.visible = p < 0.08;
  }
}

/** Objects under the mat's parent that animate with the mat tracks (kept dynamic). */
export function collectGolfMatTrackDynamicObjects(
  matDoor: HingedDoorState,
  outSet: Set<THREE.Object3D>
): void {
  matDoor.pivot.parent?.traverse((c) => {
    if (
      c.userData?.isGolfOutsideTrackLiftGroup ||
      c.userData?.isGolfTrackCamLink ||
      c.userData?.isGolfTrackLiftLeverPivot ||
      c.name.includes('trackSystem')
    ) {
      c.traverse((sub) => outSet.add(sub));
    }
  });
}

export function collectGolfShotDynamicObjects(
  gs: GolfSimulatorShotState,
  outSet: Set<THREE.Object3D>
): void {
  gs.clubSwingPivot.traverse((c) => outSet.add(c));
  outSet.add(gs.teedBall);
  outSet.add(gs.screenMesh);
  outSet.add(gs.launchStreakMesh);
  outSet.add(gs.screenImpactRing);
  if (gs.launchStreakMesh.parent) {
    outSet.add(gs.launchStreakMesh.parent);
  }
}

/** Resets club, ball, screen and effects to rest; flushes the screen to the final frame. */
function resetGolfShotToRest(gs: GolfSimulatorShotState): void {
  gs.clubSwingPivot.position.copy(gs.bagStowPos);
  gs.clubSwingPivot.rotation.copy(gs.bagStowRot);
  gs.clubSwingPivot.updateMatrixWorld(true);
  gs.teedBall.position.copy(gs.baseBallPos);
  gs.teedBall.updateMatrixWorld(true);
  gs.screenMesh.position.copy(gs.baseScreenPos);
  gs.screenMesh.updateMatrixWorld(true);
  gs.launchStreakMesh.visible = false;
  gs.screenImpactRing.visible = false;
  if (gs.lastRenderedScreenProgress < 1) {
    gs.lastRenderedScreenProgress = 1;
    gs.onUpdateScreens(gs.shotIndex, 1);
  }
}

/** Aborts an in-flight shot (e.g. when the mat is stowed). */
export function cancelGolfSimulatorShot(gs: GolfSimulatorShotState): void {
  if (!gs.isPlaying) return;
  gs.isPlaying = false;
  resetGolfShotToRest(gs);
}

/**
 * Starts the next shot (bag grab -> address -> swing -> launch -> screen ripple -> trajectory ->
 * club return). Returns false when stowed or while the current shot is < 2.5s in.
 */
export function triggerGolfSimulatorShot(gs: GolfSimulatorShotState, isStowed: boolean): boolean {
  // When the golf simulator is stowed away, never trigger the shot animation
  if (isStowed) return false;

  // If a shot is already past the initial bag-grab, swing & ball launch (> 2.50s), allow re-triggering the next club
  if (gs.isPlaying && gs.elapsedSec < 2.5) return false;

  gs.shotIndex = (gs.shotIndex + 1) % GOLF_SHOT_SCREEN_IMPACTS.length;
  gs.isPlaying = true;
  gs.elapsedSec = 0;
  gs.lastRenderedScreenProgress = -1;
  gs.clubSwingPivot.visible = true;
  gs.teedBall.visible = true;
  gs.teedBall.position.copy(gs.baseBallPos);
  gs.teedBall.updateMatrixWorld(true);
  gs.onUpdateScreens(gs.shotIndex, 0);
  return true;
}

export function getGolfSimulatorPromptLabel(
  gs: GolfSimulatorShotState | null,
  isStowed: boolean
): string {
  if (isStowed) return '';
  if (!gs) return 'Grab Club from Golf Bag & Play Golf';
  const nextIdx = (gs.shotIndex + 1) % GOLF_SHOT_SCREEN_IMPACTS.length;
  const nextClub = GOLF_SHOT_SCREEN_IMPACTS[nextIdx]?.clubName ?? '7-Iron';
  if (gs.isPlaying && gs.elapsedSec < 2.5) {
    const currClub = GOLF_SHOT_SCREEN_IMPACTS[gs.shotIndex]?.clubName ?? 'Shot';
    return `TrackMan iO Tracking ${currClub}...`;
  }
  return `Grab ${nextClub} from Golf Bag & Swing`;
}

const tmpGolfSoundPos = new THREE.Vector3();

function playGolfShotAudioCue(
  stage: 'draw' | 'whoosh' | 'impact' | 'screen' | 'drop',
  targetObj: THREE.Object3D
): void {
  targetObj.getWorldPosition(tmpGolfSoundPos);
  soundEngine.playSpatial(
    tmpGolfSoundPos,
    (tk) => {
      const { now } = tk;
      switch (stage) {
        case 'draw': {
          tk.noiseBurst({
            startTime: now,
            duration: 0.24,
            filterType: 'bandpass',
            freqStart: 1200,
            freqEnd: 2400,
            q: 1.6,
            gainPeak: 0.08,
            attackSec: 0.03,
          });
          tk.tone({
            startTime: now + 0.06,
            duration: 0.09,
            type: 'triangle',
            freqStart: 620,
            freqEnd: 480,
            gainPeak: 0.06,
          });
          break;
        }
        case 'whoosh': {
          tk.noiseBurst({
            startTime: now,
            duration: 0.19,
            filterType: 'bandpass',
            freqStart: 320,
            freqEnd: 1850,
            q: 2.1,
            gainPeak: 0.24,
            attackSec: 0.07,
          });
          break;
        }
        case 'impact': {
          tk.tone({
            startTime: now,
            duration: 0.14,
            type: 'sine',
            freqStart: 2680,
            freqEnd: 2540,
            gainPeak: 0.28,
          });
          tk.tone({
            startTime: now,
            duration: 0.095,
            type: 'triangle',
            freqStart: 4120,
            freqEnd: 3890,
            gainPeak: 0.18,
          });
          tk.tone({
            startTime: now,
            duration: 0.045,
            type: 'sine',
            freqStart: 480,
            freqEnd: 140,
            gainPeak: 0.34,
          });
          tk.noiseBurst({
            startTime: now,
            duration: 0.028,
            filterType: 'highpass',
            freqStart: 2200,
            freqEnd: 1200,
            q: 1.2,
            gainPeak: 0.26,
          });
          break;
        }
        case 'screen': {
          tk.tone({
            startTime: now,
            duration: 0.22,
            type: 'sine',
            freqStart: 128,
            freqEnd: 38,
            gainPeak: 0.38,
          });
          tk.noiseBurst({
            startTime: now,
            duration: 0.26,
            filterType: 'bandpass',
            freqStart: 780,
            freqEnd: 290,
            q: 1.3,
            gainPeak: 0.22,
            attackSec: 0.008,
          });
          tk.tone({
            startTime: now + 0.08,
            duration: 0.12,
            type: 'sine',
            freqStart: 1760,
            freqEnd: 1760,
            gainPeak: 0.055,
          });
          break;
        }
        case 'drop': {
          tk.tone({
            startTime: now,
            duration: 0.075,
            type: 'sine',
            freqStart: 145,
            freqEnd: 58,
            gainPeak: 0.16,
          });
          tk.tone({
            startTime: now + 0.19,
            duration: 0.06,
            type: 'sine',
            freqStart: 135,
            freqEnd: 54,
            gainPeak: 0.09,
          });
          break;
        }
      }
    },
    { dryGain: 0.65, wetSend: 0.24, refDistance: 2.5, maxDistance: 24 }
  );
}

/**
 * Steps a playing shot. Returns true while playing (the shot moved this frame).
 */
export function stepGolfSimulatorShot(gs: GolfSimulatorShotState, dtSeconds: number): boolean {
  if (!gs.isPlaying) return false;
  const prevT = gs.elapsedSec;
  gs.elapsedSec += Math.min(0.08, dtSeconds);
  const t = gs.elapsedSec;

  if (prevT < 0.04 && t >= 0.04) playGolfShotAudioCue('draw', gs.clubSwingPivot);
  if (prevT < 1.32 && t >= 1.32) playGolfShotAudioCue('whoosh', gs.clubSwingPivot);
  if (prevT < 1.48 && t >= 1.48) playGolfShotAudioCue('impact', gs.teedBall);
  if (prevT < 1.63 && t >= 1.63) playGolfShotAudioCue('screen', gs.screenMesh);
  if (prevT < 1.97 && t >= 1.97) playGolfShotAudioCue('drop', gs.teedBall);

  const impactCfg =
    GOLF_SHOT_SCREEN_IMPACTS[gs.shotIndex % GOLF_SHOT_SCREEN_IMPACTS.length]!;
  const addrPos = gs.addressClubPos;
  const bagPos = gs.bagStowPos;
  const bagRot = gs.bagStowRot;

  // 1. 3D Golf Club Bag-Grab, Address, Swing & Return Kinematics (`0.00s -> 4.50s`)
  //    - Phase 1A (`0.00s -> 0.28s`): Grab club inside Callaway Tour Bag & pull straight up out of the top divider cuff
  //    - Phase 1B (`0.28s -> 0.72s`): Carry club from above the golf bag across to the Golfer Address Stance behind the teed ball
  //    - Phase 1C (`0.72s -> 1.28s`): Takeaway & Full Backswing (`+z` / `+x` away from screen)
  //    - Phase 1D (`1.28s -> 1.48s`): High-Speed Downswing accelerating through ball impact at `t = 1.48s` (`rz = 0`)
  //    - Phase 1E (`1.48s -> 1.92s`): Follow-Through whipping toward the impact screen (`-z` / `-x`) into high tour finish
  //    - Phase 1F (`1.92s -> 3.45s`): Hold high finish pose while watching projected ball flight
  //    - Phase 1G (`3.45s -> 4.10s`): Carry club back to above the Callaway Tour Bag opening
  //    - Phase 1H (`4.10s -> 4.50s`): Slide grip & shaft smoothly down into the golf bag divider cuff
  const pullOutX = -0.02;
  const pullOutY = 0.48;
  const pullOutZ = 1.48;
  const pullOutRx = 1.65;
  const pullOutRy = 0.25;
  const pullOutRz = -0.12;

  if (t <= 0.28) {
    const u = easeInOutCubic(Math.max(0, Math.min(1, t / 0.28)));
    gs.clubSwingPivot.position.set(
      bagPos.x + (pullOutX - bagPos.x) * u,
      bagPos.y + (pullOutY - bagPos.y) * u,
      bagPos.z + (pullOutZ - bagPos.z) * u
    );
    gs.clubSwingPivot.rotation.set(
      bagRot.x + (pullOutRx - bagRot.x) * u,
      bagRot.y + (pullOutRy - bagRot.y) * u,
      bagRot.z + (pullOutRz - bagRot.z) * u
    );
  } else if (t <= 0.72) {
    const u = easeInOutCubic(Math.max(0, Math.min(1, (t - 0.28) / 0.44)));
    const carryArcY = Math.sin(u * Math.PI) * 0.14;
    gs.clubSwingPivot.position.set(
      pullOutX + (addrPos.x - pullOutX) * u,
      pullOutY + (addrPos.y - pullOutY) * u + carryArcY,
      pullOutZ + (addrPos.z - pullOutZ) * u
    );
    gs.clubSwingPivot.rotation.set(
      pullOutRx * (1 - u),
      pullOutRy * (1 - u),
      pullOutRz * (1 - u)
    );
  } else if (t <= 1.28) {
    const u = easeInOutCubic(Math.max(0, Math.min(1, (t - 0.72) / 0.56)));
    gs.clubSwingPivot.rotation.set(-u * 0.16, -u * 0.42, u * 2.18);
    gs.clubSwingPivot.position.set(
      addrPos.x + u * 0.14,
      addrPos.y + u * 0.26,
      addrPos.z + u * 0.06
    );
  } else if (t <= 1.48) {
    const u = Math.max(0, Math.min(1, (t - 1.28) / 0.2));
    const accel = Math.pow(u, 2.15);
    const rem = 1 - accel;
    gs.clubSwingPivot.rotation.set(-rem * 0.16, -rem * 0.42, rem * 2.18);
    gs.clubSwingPivot.position.set(
      addrPos.x + rem * 0.14,
      addrPos.y + rem * 0.26,
      addrPos.z + rem * 0.06
    );
  } else if (t <= 1.92) {
    const u = Math.max(0, Math.min(1, (t - 1.48) / 0.44));
    const ft = 1 - Math.pow(1 - u, 3);
    gs.clubSwingPivot.rotation.set(ft * 0.22, ft * 0.58, -ft * 2.32);
    gs.clubSwingPivot.position.set(
      addrPos.x - ft * 0.18,
      addrPos.y + ft * 0.28,
      addrPos.z - ft * 0.08
    );
  } else if (t <= 3.45) {
    const breathe = Math.sin((t - 1.92) * 2.6) * 0.025;
    gs.clubSwingPivot.rotation.set(0.22, 0.58, -2.32 + breathe);
    gs.clubSwingPivot.position.set(
      addrPos.x - 0.18,
      addrPos.y + 0.28,
      addrPos.z - 0.08
    );
  } else if (t <= 4.1) {
    const u = easeInOutCubic(Math.max(0, Math.min(1, (t - 3.45) / 0.65)));
    const startX = addrPos.x - 0.18;
    const startY = addrPos.y + 0.28;
    const startZ = addrPos.z - 0.08;
    const startRx = 0.22;
    const startRy = 0.58;
    const startRz = -2.32;
    gs.clubSwingPivot.position.set(
      startX + (pullOutX - startX) * u,
      startY + (pullOutY - startY) * u + Math.sin(u * Math.PI) * 0.1,
      startZ + (pullOutZ - startZ) * u
    );
    gs.clubSwingPivot.rotation.set(
      startRx + (pullOutRx - startRx) * u,
      startRy + (pullOutRy - startRy) * u,
      startRz + (pullOutRz - startRz) * u
    );
  } else if (t <= 4.5) {
    const u = easeInOutCubic(Math.max(0, Math.min(1, (t - 4.1) / 0.4)));
    gs.clubSwingPivot.position.set(
      pullOutX + (bagPos.x - pullOutX) * u,
      pullOutY + (bagPos.y - pullOutY) * u,
      pullOutZ + (bagPos.z - pullOutZ) * u
    );
    gs.clubSwingPivot.rotation.set(
      pullOutRx + (bagRot.x - pullOutRx) * u,
      pullOutRy + (bagRot.y - pullOutRy) * u,
      pullOutRz + (bagRot.z - pullOutRz) * u
    );
  } else {
    gs.clubSwingPivot.position.copy(bagPos);
    gs.clubSwingPivot.rotation.copy(bagRot);
  }
  gs.clubSwingPivot.updateMatrixWorld(true);

  // 2. Physical 3D Golf Ball Launch to Screen (`1.48s -> 1.63s`),
  //    Screen Fabric Ripple & Turf Rebound/Roll (`1.63s -> 3.47s`)
  const x0 = gs.baseBallPos.x; // +0.138m inside foldingMatGroup
  const y0 = gs.baseBallPos.y; // +0.036m inside foldingMatGroup
  const z0 = gs.baseBallPos.z; // 0.0m
  const xHitLocal = -2.98; // Just in front of screenMesh (-3.002m in foldingMatGroup coords)
  const yHitLocal = impactCfg.yHit;
  const zHitLocal = impactCfg.zHit;

  const streakMat = gs.launchStreakMesh.material as THREE.MeshBasicMaterial;
  const ringMat = gs.screenImpactRing.material as THREE.MeshBasicMaterial;

  if (t < 1.48) {
    gs.teedBall.position.copy(gs.baseBallPos);
    gs.launchStreakMesh.visible = false;
    gs.screenImpactRing.visible = false;
    gs.screenMesh.position.copy(gs.baseScreenPos);
  } else if (t <= 1.63) {
    // High-speed 3D ball launch from tee to impact screen!
    const f = Math.max(0, Math.min(1, (t - 1.48) / 0.15));
    const bx = x0 + (xHitLocal - x0) * f;
    const by = y0 + (yHitLocal - y0) * f + Math.sin(f * Math.PI) * 0.045;
    const bz = z0 + (zHitLocal - z0) * f;
    gs.teedBall.position.set(bx, by, bz);

    // Position & orient glowing TrackMan launch streak in simGroup coordinates (`foldingMatGroup` is at `+0.982, +0.017, 0`)
    tmpStreakStart.set(0.982 + x0, 0.017 + y0, z0);
    tmpStreakEnd.set(0.982 + bx, 0.017 + by, bz);
    tmpStreakDir.subVectors(tmpStreakEnd, tmpStreakStart);
    const streakLen = tmpStreakDir.length();
    if (streakLen > 0.04) {
      gs.launchStreakMesh.visible = true;
      gs.launchStreakMesh.position
        .addVectors(tmpStreakStart, tmpStreakEnd)
        .multiplyScalar(0.5);
      tmpStreakDir.divideScalar(streakLen);
      gs.launchStreakMesh.quaternion.setFromUnitVectors(tmpStreakUp, tmpStreakDir);
      gs.launchStreakMesh.scale.set(1, streakLen, 1);
      streakMat.opacity = 0.82;
      gs.launchStreakMesh.updateMatrixWorld(true);
    }
    gs.screenImpactRing.visible = false;
  } else if (t <= 3.47) {
    // Ball has struck the impact screen at t = 1.63s!
    const postImpact = t - 1.63;

    // Fade out launch streak rapidly after screen impact (`1.63s -> 1.80s`)
    if (postImpact < 0.17) {
      gs.launchStreakMesh.visible = true;
      streakMat.opacity = (1 - postImpact / 0.17) * 0.75;
    } else {
      gs.launchStreakMesh.visible = false;
    }

    // Expanding glowing impact ring on the screen (`1.63s -> 2.20s`)
    if (postImpact < 0.57) {
      const ru = postImpact / 0.57;
      gs.screenImpactRing.visible = true;
      gs.screenImpactRing.position.set(
        gs.baseScreenPos.x + 0.008,
        0.017 + yHitLocal,
        zHitLocal
      );
      const ringScale = 0.65 + ru * 3.4;
      gs.screenImpactRing.scale.set(ringScale, ringScale, 1);
      ringMat.opacity = (1 - ru) * 0.88;
      gs.screenImpactRing.updateMatrixWorld(true);
    } else {
      gs.screenImpactRing.visible = false;
    }

    // Damped harmonic fabric deflection on the impact screen (`1.63s -> 2.14s`)
    if (postImpact < 0.51) {
      const deflectX =
        Math.exp(-postImpact * 9.5) * Math.sin(postImpact * 42.0) * 0.055;
      gs.screenMesh.position.x = gs.baseScreenPos.x - deflectX;
      gs.screenMesh.updateMatrixWorld(true);
    } else {
      gs.screenMesh.position.copy(gs.baseScreenPos);
      gs.screenMesh.updateMatrixWorld(true);
    }

    // Physical ball drops from screen impact point (`yHitLocal`) onto forward turf (`y = 0.034`), bounces twice, and rolls back
    const dropDur = 0.34;
    if (postImpact <= dropDur) {
      const du = postImpact / dropDur;
      const bx = xHitLocal + du * 0.42;
      const by = yHitLocal * (1 - du * du) + 0.034 * (du * du);
      const bz = zHitLocal * (1 - du * 0.25);
      gs.teedBall.position.set(bx, by, bz);
    } else {
      const rollT = Math.min(1, (postImpact - dropDur) / 1.5);
      const rollEase = 1 - Math.pow(1 - rollT, 2.4);
      const bx = xHitLocal + 0.42 + rollEase * 1.38;
      const bounceEnv = Math.exp(-rollT * 5.2);
      const by = 0.034 + Math.abs(Math.sin(rollT * Math.PI * 3.2)) * 0.14 * bounceEnv;
      const bz = zHitLocal * (0.75 - rollEase * 0.55);
      gs.teedBall.position.set(bx, by, bz);
    }
  } else {
    // Re-tee fresh golf ball smoothly (`3.47s -> 3.92s`)
    gs.launchStreakMesh.visible = false;
    gs.screenImpactRing.visible = false;
    gs.screenMesh.position.copy(gs.baseScreenPos);
    gs.screenMesh.updateMatrixWorld(true);
    const reTeeU = easeInOutCubic(Math.max(0, Math.min(1, (t - 3.47) / 0.45)));
    gs.teedBall.position.set(
      gs.baseBallPos.x,
      gs.baseBallPos.y - (1 - reTeeU) * 0.018,
      gs.baseBallPos.z
    );
  }
  gs.teedBall.updateMatrixWorld(true);

  // 3. Live Projected Ball Trajectory on Widescreen Impact Screen & 27" Control Monitor (`1.62s -> 4.27s`)
  if (t >= 1.62) {
    const rawFlight = Math.max(0, Math.min(1, (t - 1.62) / 2.65));
    // Ease-out curve so the ball rockets off the screen face and settles smoothly on the green
    const flightProgress = 1 - Math.pow(1 - rawFlight, 1.85);
    if (
      Math.abs(flightProgress - gs.lastRenderedScreenProgress) >= 0.014 ||
      (rawFlight >= 1 && gs.lastRenderedScreenProgress < 1)
    ) {
      gs.lastRenderedScreenProgress = rawFlight >= 1 ? 1 : flightProgress;
      gs.onUpdateScreens(gs.shotIndex, gs.lastRenderedScreenProgress);
    }
  }

  if (t >= 4.55) {
    gs.isPlaying = false;
    resetGolfShotToRest(gs);
  }

  return true;
}
