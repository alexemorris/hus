import type { FloorSurfaceType } from '../../../core/types/acoustics.ts';
import { soundEngine } from '../../audio/sound-engine.ts';

export type { FloorSurfaceType };

/**
 * House-agnostic floor-surface fallback for first-person footsteps: ladders sound like ladders,
 * explicit object/room acoustic surfaces win when present, open ground is turf, and any other
 * room defaults to timber. Houses can refine this via `HouseWalkthroughHooks.classifyFloorSurface`.
 */
export function classifyFloorSurface(
  roomId: string | null,
  _x: number,
  _y: number,
  _z: number,
  onLadder = false,
  roomFloorSurface?: FloorSurfaceType,
  objectAcousticSurface?: FloorSurfaceType
): FloorSurfaceType {
  if (onLadder) return 'ladder';
  if (objectAcousticSurface) return objectAcousticSurface;
  if (roomFloorSurface) return roomFloorSurface;
  return roomId ? 'wood' : 'turf';
}

/**
 * Warms up the Web Audio context when entering walkthrough ONLY after a real user gesture.
 */
export function warmUpWalkthroughFootstepAudio(): void {
  if (!soundEngine.isMuted() && soundEngine.hasUserGesture()) {
    soundEngine.ensureContext();
  }
}

export function playWalkthroughFootstep(
  surface: FloorSurfaceType,
  worldPos: { readonly x: number; readonly y: number; readonly z: number },
  isSprinting = false
): void {
  const velScale = isSprinting ? 1.28 : 0.92;
  const pitchJitter = 0.92 + Math.random() * 0.16;

  soundEngine.playSpatial(
    worldPos,
    (tk) => {
      const { now } = tk;
      switch (surface) {
        case 'wood': {
          tk.tone({
            startTime: now,
            duration: 0.085,
            type: 'sine',
            freqStart: 135 * pitchJitter,
            freqEnd: 58 * pitchJitter,
            gainPeak: 0.18 * velScale,
          });
          tk.noiseBurst({
            startTime: now + 0.012,
            duration: 0.055,
            filterType: 'bandpass',
            freqStart: 950 * pitchJitter,
            freqEnd: 620,
            q: 2.2,
            gainPeak: 0.065 * velScale,
          });
          break;
        }
        case 'stone': {
          tk.tone({
            startTime: now,
            duration: 0.055,
            type: 'triangle',
            freqStart: 195 * pitchJitter,
            freqEnd: 82 * pitchJitter,
            gainPeak: 0.14 * velScale,
          });
          tk.noiseBurst({
            startTime: now + 0.008,
            duration: 0.042,
            filterType: 'bandpass',
            freqStart: 2450 * pitchJitter,
            freqEnd: 1650,
            q: 3.1,
            gainPeak: 0.095 * velScale,
          });
          break;
        }
        case 'turf': {
          tk.tone({
            startTime: now,
            duration: 0.075,
            type: 'sine',
            freqStart: 98 * pitchJitter,
            freqEnd: 46,
            gainPeak: 0.13 * velScale,
          });
          tk.noiseBurst({
            startTime: now + 0.005,
            duration: 0.09,
            filterType: 'bandpass',
            freqStart: 1850 * pitchJitter,
            freqEnd: 1100,
            q: 1.4,
            gainPeak: 0.055 * velScale,
          });
          break;
        }
        case 'gravel': {
          tk.noiseBurst({
            startTime: now,
            duration: 0.065,
            filterType: 'bandpass',
            freqStart: 2800 * pitchJitter,
            freqEnd: 1900,
            q: 1.8,
            gainPeak: 0.11 * velScale,
          });
          tk.noiseBurst({
            startTime: now + 0.028,
            duration: 0.075,
            filterType: 'highpass',
            freqStart: 3400 * pitchJitter,
            freqEnd: 2400,
            q: 1.2,
            gainPeak: 0.085 * velScale,
          });
          break;
        }
        case 'stair': {
          tk.tone({
            startTime: now,
            duration: 0.095,
            type: 'sine',
            freqStart: 148 * pitchJitter,
            freqEnd: 62 * pitchJitter,
            gainPeak: 0.21 * velScale,
          });
          tk.tone({
            startTime: now + 0.015,
            duration: 0.07,
            type: 'triangle',
            freqStart: 520 * pitchJitter,
            freqEnd: 390 * pitchJitter,
            gainPeak: 0.04 * velScale,
          });
          break;
        }
        case 'ladder': {
          tk.tone({
            startTime: now,
            duration: 0.09,
            type: 'triangle',
            freqStart: 310 * pitchJitter,
            freqEnd: 175 * pitchJitter,
            gainPeak: 0.16 * velScale,
          });
          tk.noiseBurst({
            startTime: now,
            duration: 0.04,
            filterType: 'bandpass',
            freqStart: 1650 * pitchJitter,
            freqEnd: 1200,
            q: 3.5,
            gainPeak: 0.07 * velScale,
          });
          break;
        }
      }
    },
    { dryGain: 0.35, wetSend: 0.12, refDistance: 1.5, maxDistance: 12 }
  );
}

/** Synthesizes a 3D jump push-off sound at `worldPos`. */
export function playWalkthroughJump(worldPos: {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}): void {
  soundEngine.playSpatial(
    worldPos,
    (tk) => {
      const { now } = tk;
      tk.tone({
        startTime: now,
        duration: 0.11,
        type: 'sine',
        freqStart: 95,
        freqEnd: 165,
        gainPeak: 0.18,
      });
      tk.noiseBurst({
        startTime: now,
        duration: 0.08,
        filterType: 'bandpass',
        freqStart: 680,
        freqEnd: 1250,
        q: 1.5,
        gainPeak: 0.065,
      });
    },
    { dryGain: 0.4, wetSend: 0.1, refDistance: 1.5, maxDistance: 12 }
  );
}

/** Synthesizes a 3D landing thud + surface footstep at `worldPos`. */
export function playWalkthroughLand(
  surface: FloorSurfaceType,
  worldPos: { readonly x: number; readonly y: number; readonly z: number }
): void {
  playWalkthroughFootstep(surface, worldPos, true);
  soundEngine.playSpatial(
    worldPos,
    (tk) => {
      tk.tone({
        startTime: tk.now + 0.015,
        duration: 0.12,
        type: 'sine',
        freqStart: 110,
        freqEnd: 42,
        gainPeak: 0.24,
      });
    },
    { dryGain: 0.45, wetSend: 0.14, refDistance: 1.5, maxDistance: 14 }
  );
}
