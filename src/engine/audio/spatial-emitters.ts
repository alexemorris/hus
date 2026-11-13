import * as THREE from 'three';
import type {
  AcousticOcclusionState,
  AudioEmitterPreset,
  ContinuousAudioPreset,
  FoleyAudioPreset,
} from '../../core/types/acoustics.ts';
import type { SoundSynthToolkit, SpatialSoundOptions } from './sound-engine.ts';
import { soundEngine } from './sound-engine.ts';

export interface AudioEmitterOptions {
  readonly id?: string;
  readonly kind?: 'continuous' | 'oneshot';
  readonly preset?: AudioEmitterPreset;
  readonly url?: string;
  readonly volume?: number;
  readonly refDistance?: number;
  readonly maxDistance?: number;
  readonly rolloffFactor?: number;
  /** Optional 3D area emitter extent `[widthM, heightM, depthM]` (clamps listener distance to box surface!). */
  readonly areaSize?: readonly [number, number, number];
  readonly zoneId?: string;
  readonly isExterior?: boolean;
  readonly autoplay?: boolean;
  readonly recipe?: (toolkit: SoundSynthToolkit) => void;
}

export interface AudioEmitterEvaluation {
  readonly samplePoint: readonly [number, number, number];
  readonly distanceM: number;
  readonly effectiveGain: number;
  readonly lowpassHz: number;
}

export interface AudioEmitterHandle {
  readonly object3d: THREE.Object3D;
  readonly options: Readonly<AudioEmitterOptions>;
  trigger(): void;
  setActive(active: boolean): void;
  isActive(): boolean;
  setVolume(volume: number): void;
  getVolume(): number;
  /** Computes effective emitter gain & world sample point (closest point on `areaSize` box) for a listener & occlusion state. */
  evaluateAtListener(
    listenerPos: readonly [number, number, number],
    occlusion?: AcousticOcclusionState
  ): AudioEmitterEvaluation;
  update(
    dtSeconds: number,
    listenerPos?: readonly [number, number, number],
    occlusion?: AcousticOcclusionState
  ): void;
  dispose(): void;
}

const FOLEY_PRESETS: ReadonlySet<string> = new Set<FoleyAudioPreset>([
  'switchClick',
  'doorLatch',
  'drawerSlide',
  'gateLatch',
  'cisternFlush',
  'ovenDoorLatch',
  'espressoExtract',
  'sashWindowSlide',
  'tapValveTurn',
]);

const emitterRegistry = new WeakMap<THREE.Object3D, AudioEmitterHandle[]>();

const tmpWorldPos = new THREE.Vector3();
const tmpWorldQuat = new THREE.Quaternion();
const tmpInvWorldQuat = new THREE.Quaternion();
const tmpWorldScale = new THREE.Vector3();
const tmpLocalPoint = new THREE.Vector3();
const tmpSampleVec = new THREE.Vector3();

function isFoleyPreset(preset: AudioEmitterPreset | undefined): preset is FoleyAudioPreset {
  return preset !== undefined && FOLEY_PRESETS.has(preset);
}

function getFoleyRecipe(preset: FoleyAudioPreset): (toolkit: SoundSynthToolkit) => void {
  switch (preset) {
    case 'switchClick':
      return (tk) => {
        const { now } = tk;
        tk.tone({
          startTime: now,
          duration: 0.022,
          type: 'triangle',
          freqStart: 2850,
          freqEnd: 1620,
          gainPeak: 0.16,
        });
        tk.tone({
          startTime: now + 0.004,
          duration: 0.032,
          type: 'sine',
          freqStart: 720,
          freqEnd: 290,
          gainPeak: 0.12,
        });
      };

    case 'doorLatch':
      return (tk) => {
        const { now } = tk;
        tk.noiseBurst({
          startTime: now,
          duration: 0.045,
          filterType: 'bandpass',
          freqStart: 1450,
          freqEnd: 780,
          q: 2.2,
          gainPeak: 0.14,
          attackSec: 0.002,
        });
        tk.tone({
          startTime: now + 0.012,
          duration: 0.075,
          type: 'sine',
          freqStart: 155,
          freqEnd: 62,
          gainPeak: 0.16,
        });
      };

    case 'drawerSlide':
      return (tk) => {
        const { now } = tk;
        tk.noiseBurst({
          startTime: now,
          duration: 0.3,
          filterType: 'bandpass',
          freqStart: 600,
          freqEnd: 920,
          q: 1.6,
          gainPeak: 0.11,
          attackSec: 0.03,
        });
        tk.tone({
          startTime: now + 0.23,
          duration: 0.07,
          type: 'sine',
          freqStart: 138,
          freqEnd: 54,
          gainPeak: 0.14,
        });
      };

    case 'gateLatch':
      return (tk) => {
        const { now } = tk;
        tk.tone({
          startTime: now,
          duration: 0.065,
          type: 'triangle',
          freqStart: 420,
          freqEnd: 180,
          gainPeak: 0.18,
        });
        tk.noiseBurst({
          startTime: now + 0.008,
          duration: 0.085,
          filterType: 'bandpass',
          freqStart: 980,
          freqEnd: 520,
          q: 2.6,
          gainPeak: 0.12,
          attackSec: 0.004,
        });
      };

    case 'tapValveTurn':
      return (tk) => {
        const { now } = tk;
        tk.tone({
          startTime: now,
          duration: 0.028,
          type: 'triangle',
          freqStart: 2350,
          freqEnd: 1380,
          gainPeak: 0.13,
        });
        tk.noiseBurst({
          startTime: now + 0.004,
          duration: 0.036,
          filterType: 'bandpass',
          freqStart: 1650,
          freqEnd: 920,
          q: 2.4,
          gainPeak: 0.09,
          attackSec: 0.002,
        });
      };

    case 'cisternFlush':
      return (tk) => {
        const { now } = tk;
        // Solid brass ceramic cistern lever clink
        tk.tone({
          startTime: now,
          duration: 0.055,
          type: 'triangle',
          freqStart: 1920,
          freqEnd: 880,
          gainPeak: 0.17,
        });
        tk.tone({
          startTime: now + 0.015,
          duration: 0.08,
          type: 'sine',
          freqStart: 320,
          freqEnd: 140,
          gainPeak: 0.12,
        });
        // Ceramic bowl water cascade rush
        tk.noiseBurst({
          startTime: now + 0.06,
          duration: 1.85,
          filterType: 'bandpass',
          freqStart: 880,
          freqEnd: 460,
          q: 0.85,
          gainPeak: 0.22,
          attackSec: 0.14,
        });
        // Aerated swirl & cistern ball-valve refill hiss decay
        tk.noiseBurst({
          startTime: now + 0.35,
          duration: 2.6,
          filterType: 'bandpass',
          freqStart: 2250,
          freqEnd: 1650,
          q: 1.5,
          gainPeak: 0.11,
          attackSec: 0.32,
        });
      };

    case 'ovenDoorLatch':
      return (tk) => {
        const { now } = tk;
        // Heavy cast-iron / vitreous enamel oven door thud + spring roller catch
        tk.tone({
          startTime: now,
          duration: 0.11,
          type: 'sine',
          freqStart: 132,
          freqEnd: 44,
          gainPeak: 0.28,
        });
        tk.tone({
          startTime: now + 0.008,
          duration: 0.042,
          type: 'triangle',
          freqStart: 1480,
          freqEnd: 640,
          gainPeak: 0.16,
        });
        tk.noiseBurst({
          startTime: now + 0.005,
          duration: 0.085,
          filterType: 'bandpass',
          freqStart: 780,
          freqEnd: 340,
          q: 2.3,
          gainPeak: 0.15,
          attackSec: 0.003,
        });
      };

    case 'espressoExtract':
      return (tk) => {
        const { now } = tk;
        // Pre-infusion solenoid click + 15-bar Ulka vibratory pump hum + steam/crema hiss
        tk.tone({
          startTime: now,
          duration: 0.025,
          type: 'triangle',
          freqStart: 2600,
          freqEnd: 1450,
          gainPeak: 0.14,
        });
        tk.tone({
          startTime: now + 0.08,
          duration: 1.05,
          type: 'sawtooth',
          freqStart: 100,
          freqEnd: 98,
          gainPeak: 0.055,
          attackSec: 0.08,
        });
        tk.tone({
          startTime: now + 1.35,
          duration: 4.1,
          type: 'triangle',
          freqStart: 100,
          freqEnd: 96,
          gainPeak: 0.075,
          attackSec: 0.18,
        });
        tk.noiseBurst({
          startTime: now + 1.45,
          duration: 4.3,
          filterType: 'bandpass',
          freqStart: 2150,
          freqEnd: 2750,
          q: 1.35,
          gainPeak: 0.11,
          attackSec: 0.35,
        });
      };

    case 'sashWindowSlide':
      return (tk) => {
        const { now } = tk;
        // Waxed timber box-sash glide + brass axle pulley cord roll + meeting-rail settle
        tk.noiseBurst({
          startTime: now,
          duration: 0.42,
          filterType: 'bandpass',
          freqStart: 520,
          freqEnd: 780,
          q: 1.7,
          gainPeak: 0.12,
          attackSec: 0.04,
        });
        tk.tone({
          startTime: now + 0.04,
          duration: 0.34,
          type: 'sine',
          freqStart: 285,
          freqEnd: 340,
          gainPeak: 0.035,
          attackSec: 0.05,
        });
        tk.tone({
          startTime: now + 0.36,
          duration: 0.085,
          type: 'sine',
          freqStart: 118,
          freqEnd: 48,
          gainPeak: 0.16,
        });
      };
  }
}

function getContinuousAccentRecipe(
  preset: ContinuousAudioPreset
): (toolkit: SoundSynthToolkit) => void {
  switch (preset) {
    case 'woodStove':
      return (tk) => {
        const { now } = tk;
        tk.noiseBurst({
          startTime: now,
          duration: 0.035 + Math.random() * 0.03,
          filterType: 'bandpass',
          freqStart: 1900 + Math.random() * 1400,
          freqEnd: 900,
          q: 2.8,
          gainPeak: 0.09 + Math.random() * 0.05,
          attackSec: 0.002,
        });
      };

    case 'espressoMachine':
      return (tk) => {
        const { now } = tk;
        tk.noiseBurst({
          startTime: now,
          duration: 0.45,
          filterType: 'bandpass',
          freqStart: 2200,
          freqEnd: 2800,
          q: 1.4,
          gainPeak: 0.12,
          attackSec: 0.06,
        });
        tk.tone({
          startTime: now,
          duration: 0.42,
          type: 'triangle',
          freqStart: 100,
          freqEnd: 96,
          gainPeak: 0.06,
        });
      };

    case 'piano':
      return (tk) => {
        const notes = [261.63, 329.63, 392.0, 493.88];
        for (let i = 0; i < notes.length; i++) {
          tk.tone({
            startTime: tk.now + i * 0.065,
            duration: 0.65,
            type: 'triangle',
            freqStart: notes[i]!,
            freqEnd: notes[i]! * 0.998,
            gainPeak: 0.065,
            attackSec: 0.012,
          });
        }
      };

    case 'waterFeature':
    case 'waterTapFlow':
      return (tk) => {
        const { now } = tk;
        if (preset === 'waterTapFlow') {
          tk.tone({
            startTime: now,
            duration: 0.026,
            type: 'triangle',
            freqStart: 2280,
            freqEnd: 1320,
            gainPeak: 0.12,
          });
        }
        tk.noiseBurst({
          startTime: now + (preset === 'waterTapFlow' ? 0.012 : 0),
          duration: 0.16,
          filterType: 'bandpass',
          freqStart: 1650,
          freqEnd: 1040,
          q: 1.7,
          gainPeak: 0.075,
          attackSec: 0.015,
        });
      };

    case 'fridgeHum':
    case 'mediaPlayback':
    case 'hvacHum':
      return (tk) => {
        tk.tone({
          startTime: tk.now,
          duration: 0.25,
          type: 'sine',
          freqStart: preset === 'fridgeHum' ? 100 : preset === 'hvacHum' ? 60 : 220,
          freqEnd: preset === 'fridgeHum' ? 100 : preset === 'hvacHum' ? 60 : 216,
          gainPeak: 0.04,
          attackSec: 0.04,
        });
      };
  }
}

interface ContinuousWebAudioGraph {
  ctx: AudioContext;
  panner: PannerNode | null;
  lowpass: BiquadFilterNode;
  gain: GainNode;
  wetSend: GainNode | null;
  sources: AudioScheduledSourceNode[];
  extraNodes: AudioNode[];
  modFilter?: BiquadFilterNode;
  urlLoaded?: boolean;
  urlLoading?: boolean;
}

function resolveSamplePoint(
  object3d: THREE.Object3D,
  listenerPos: readonly [number, number, number],
  areaSize?: readonly [number, number, number]
): { readonly samplePoint: readonly [number, number, number]; readonly distanceM: number } {
  object3d.updateWorldMatrix(true, false);
  object3d.matrixWorld.decompose(tmpWorldPos, tmpWorldQuat, tmpWorldScale);

  if (!areaSize) {
    const sx = tmpWorldPos.x;
    const sy = tmpWorldPos.y;
    const sz = tmpWorldPos.z;
    const dist = Math.hypot(listenerPos[0] - sx, listenerPos[1] - sy, listenerPos[2] - sz);
    return { samplePoint: [sx, sy, sz], distanceM: dist };
  }

  const hw = Math.abs(areaSize[0]) * 0.5;
  const hh = Math.abs(areaSize[1]) * 0.5;
  const hd = Math.abs(areaSize[2]) * 0.5;

  tmpLocalPoint.set(
    listenerPos[0] - tmpWorldPos.x,
    listenerPos[1] - tmpWorldPos.y,
    listenerPos[2] - tmpWorldPos.z
  );
  tmpInvWorldQuat.copy(tmpWorldQuat).invert();
  tmpLocalPoint.applyQuaternion(tmpInvWorldQuat);

  const inside =
    Math.abs(tmpLocalPoint.x) <= hw &&
    Math.abs(tmpLocalPoint.y) <= hh &&
    Math.abs(tmpLocalPoint.z) <= hd;

  if (inside) {
    return {
      samplePoint: [listenerPos[0], listenerPos[1], listenerPos[2]],
      distanceM: 0,
    };
  }

  tmpSampleVec.set(
    THREE.MathUtils.clamp(tmpLocalPoint.x, -hw, hw),
    THREE.MathUtils.clamp(tmpLocalPoint.y, -hh, hh),
    THREE.MathUtils.clamp(tmpLocalPoint.z, -hd, hd)
  );
  tmpSampleVec.applyQuaternion(tmpWorldQuat).add(tmpWorldPos);

  const sx = tmpSampleVec.x;
  const sy = tmpSampleVec.y;
  const sz = tmpSampleVec.z;
  const dist = Math.hypot(listenerPos[0] - sx, listenerPos[1] - sy, listenerPos[2] - sz);
  return { samplePoint: [sx, sy, sz], distanceM: dist };
}

/**
 * Attaches a declarative 3D point or box-area spatial audio emitter to a `THREE.Object3D`.
 *
 * Supports both continuous procedural beds (`'woodStove'`, `'espressoMachine'`, `'fridgeHum'`,
 * `'waterFeature'`, `'mediaPlayback'`, `'piano'`, `'hvacHum'`, or looping `url`) and one-shot
 * interactive foley (`'switchClick'`, `'doorLatch'`, `'drawerSlide'`, `'gateLatch'`, or custom
 * `recipe`). Fully headless-safe when Web Audio is unavailable.
 */
export function attachAudioEmitter(
  object3d: THREE.Object3D,
  options: AudioEmitterOptions
): AudioEmitterHandle {
  const kind: 'continuous' | 'oneshot' =
    options.kind ?? (isFoleyPreset(options.preset) ? 'oneshot' : 'continuous');
  const frozenOptions: Readonly<AudioEmitterOptions> = Object.freeze({
    ...options,
    kind,
  });

  const initialVolume = options.volume ?? 1.0;
  let volume = Number.isFinite(initialVolume) ? THREE.MathUtils.clamp(initialVolume, 0, 2) : 0;
  let active = kind === 'continuous' ? (options.autoplay ?? true) : (options.autoplay ?? false);
  let disposed = false;
  let graph: ContinuousWebAudioGraph | null = null;
  let crackleTimerSec = 0.6 + Math.random() * 1.1;
  let oneshotUrlBuffer: AudioBuffer | null = null;
  let oneshotUrlRequested = false;

  const evaluateAtListener = (
    listenerPos: readonly [number, number, number],
    occlusion?: AcousticOcclusionState
  ): AudioEmitterEvaluation => {
    const { samplePoint, distanceM } = resolveSamplePoint(object3d, listenerPos, options.areaSize);

    const refDistance = Math.max(0.05, options.refDistance ?? 2.0);
    const maxDistance = Math.max(refDistance + 0.1, options.maxDistance ?? 28.0);
    const rolloffFactor = Math.max(0, options.rolloffFactor ?? 1.15);

    let distGain: number;
    if (distanceM <= refDistance) {
      distGain = 1.0;
    } else if (distanceM >= maxDistance) {
      distGain = 0.0;
    } else {
      const inverse = refDistance / (refDistance + rolloffFactor * (distanceM - refDistance));
      const fadeZone = Math.max(1.0, maxDistance * 0.2);
      const edgeFade = THREE.MathUtils.clamp((maxDistance - distanceM) / fadeZone, 0, 1);
      distGain = inverse * edgeFade;
    }

    let occlusionGain = 1.0;
    let lowpassHz = 18000;
    if (occlusion) {
      if (options.isExterior === true && occlusion.isInterior) {
        occlusionGain = occlusion.exteriorGainScale;
        lowpassHz = occlusion.exteriorLowpassHz;
      } else if (options.isExterior === false && !occlusion.isInterior) {
        occlusionGain = 0.45;
        lowpassHz = 2800;
      }
    }

    const activeScale = kind === 'continuous' ? (active ? 1 : 0) : 1;
    const rawEffectiveGain = volume * activeScale * distGain * occlusionGain;
    const effectiveGain = Number.isFinite(rawEffectiveGain) ? THREE.MathUtils.clamp(rawEffectiveGain, 0, 2) : 0;

    return {
      samplePoint,
      distanceM,
      effectiveGain,
      lowpassHz,
    };
  };

  const teardownGraph = (): void => {
    if (!graph) return;
    for (const src of graph.sources) {
      try {
        src.stop();
      } catch {
        // Ignore already stopped source
      }
      try {
        src.disconnect();
      } catch {
        // Ignore
      }
    }
    for (const node of graph.extraNodes) {
      try {
        node.disconnect();
      } catch {
        // Ignore
      }
    }
    try {
      graph.lowpass.disconnect();
      graph.gain.disconnect();
      graph.panner?.disconnect();
      graph.wetSend?.disconnect();
    } catch {
      // Ignore
    }
    graph = null;
  };

  const ensureContinuousGraph = (): ContinuousWebAudioGraph | null => {
    const bus = soundEngine.getSpatialBus();
    if (!bus) return null;
    if (graph && graph.ctx === bus.ctx) return graph;
    teardownGraph();

    const { ctx, sfxGain, reverbNode, pinkNoiseBuffer } = bus;
    const now = ctx.currentTime;

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 18000;
    lowpass.Q.value = 0.707;

    const gain = ctx.createGain();
    gain.gain.value = 0;

    let panner: PannerNode | null = null;
    if (typeof ctx.createPanner === 'function') {
      panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = Math.max(0.05, options.refDistance ?? 2.0);
      panner.maxDistance = Math.max(panner.refDistance + 0.1, options.maxDistance ?? 28.0);
      panner.rolloffFactor = Math.max(0, options.rolloffFactor ?? 1.15);
    }

    lowpass.connect(gain);
    let wetSend: GainNode | null = null;
    if (panner) {
      gain.connect(panner);
      panner.connect(sfxGain);
      if (reverbNode) {
        wetSend = ctx.createGain();
        wetSend.gain.value = options.isExterior ? 0.06 : 0.18;
        panner.connect(wetSend);
        wetSend.connect(reverbNode);
      }
    } else {
      gain.connect(sfxGain);
      if (reverbNode) {
        wetSend = ctx.createGain();
        wetSend.gain.value = options.isExterior ? 0.06 : 0.18;
        gain.connect(wetSend);
        wetSend.connect(reverbNode);
      }
    }

    const sources: AudioScheduledSourceNode[] = [];
    const extraNodes: AudioNode[] = [];
    let modFilter: BiquadFilterNode | undefined;

    const built: ContinuousWebAudioGraph = {
      ctx,
      panner,
      lowpass,
      gain,
      wetSend,
      sources,
      extraNodes,
    };

    if (options.url && typeof fetch === 'function') {
      built.urlLoading = true;
      fetch(options.url)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.arrayBuffer();
        })
        .then((buf) => ctx.decodeAudioData(buf))
        .then((decoded) => {
          if (disposed || graph !== built) return;
          const src = ctx.createBufferSource();
          src.buffer = decoded;
          src.loop = true;
          src.connect(lowpass);
          src.start(ctx.currentTime);
          built.sources.push(src);
          built.urlLoaded = true;
          built.urlLoading = false;
        })
        .catch(() => {
          built.urlLoading = false;
        });
    } else {
      const preset = options.preset;
      if (preset === 'woodStove' && pinkNoiseBuffer) {
        const src = ctx.createBufferSource();
        src.buffer = pinkNoiseBuffer;
        src.loop = true;
        const bp = ctx.createBiquadFilter();
        bp.type = 'lowpass';
        bp.frequency.value = 185;
        bp.Q.value = 0.8;
        const bedGain = ctx.createGain();
        bedGain.gain.value = 0.075;
        src.connect(bp);
        bp.connect(bedGain);
        bedGain.connect(lowpass);
        src.start(now);
        sources.push(src);
        extraNodes.push(bp, bedGain);
        modFilter = bp;
      } else if (preset === 'espressoMachine' && pinkNoiseBuffer) {
        const src = ctx.createBufferSource();
        src.buffer = pinkNoiseBuffer;
        src.loop = true;
        const steam = ctx.createBiquadFilter();
        steam.type = 'bandpass';
        steam.frequency.value = 2350;
        steam.Q.value = 1.4;
        const steamGain = ctx.createGain();
        steamGain.gain.value = 0.045;
        src.connect(steam);
        steam.connect(steamGain);
        steamGain.connect(lowpass);
        src.start(now);

        const pump = ctx.createOscillator();
        pump.type = 'triangle';
        pump.frequency.value = 100;
        const pumpGain = ctx.createGain();
        pumpGain.gain.value = 0.025;
        pump.connect(pumpGain);
        pumpGain.connect(lowpass);
        pump.start(now);

        sources.push(src, pump);
        extraNodes.push(steam, steamGain, pumpGain);
      } else if (preset === 'fridgeHum') {
        const o1 = ctx.createOscillator();
        o1.type = 'sine';
        o1.frequency.value = 50;
        const o2 = ctx.createOscillator();
        o2.type = 'triangle';
        o2.frequency.value = 100;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 240;
        const subGain = ctx.createGain();
        subGain.gain.value = 0.024;
        o1.connect(lp);
        o2.connect(lp);
        lp.connect(subGain);
        subGain.connect(lowpass);
        o1.start(now);
        o2.start(now);
        sources.push(o1, o2);
        extraNodes.push(lp, subGain);
      } else if (preset === 'waterFeature' && pinkNoiseBuffer) {
        const bodySrc = ctx.createBufferSource();
        bodySrc.buffer = pinkNoiseBuffer;
        bodySrc.loop = true;
        const bodyFilter = ctx.createBiquadFilter();
        bodyFilter.type = 'bandpass';
        bodyFilter.frequency.value = 480;
        bodyFilter.Q.value = 0.75;
        const bodyGain = ctx.createGain();
        bodyGain.gain.value = 0.065;
        bodySrc.connect(bodyFilter);
        bodyFilter.connect(bodyGain);
        bodyGain.connect(lowpass);
        bodySrc.start(now);

        const sparkleSrc = ctx.createBufferSource();
        sparkleSrc.buffer = pinkNoiseBuffer;
        sparkleSrc.loop = true;
        sparkleSrc.playbackRate.value = 1.4;
        const sparkleFilter = ctx.createBiquadFilter();
        sparkleFilter.type = 'bandpass';
        sparkleFilter.frequency.value = 1650;
        sparkleFilter.Q.value = 1.1;
        const sparkleGain = ctx.createGain();
        sparkleGain.gain.value = 0.04;
        sparkleSrc.connect(sparkleFilter);
        sparkleFilter.connect(sparkleGain);
        sparkleGain.connect(lowpass);
        sparkleSrc.start(now);

        sources.push(bodySrc, sparkleSrc);
        extraNodes.push(bodyFilter, bodyGain, sparkleFilter, sparkleGain);
        modFilter = sparkleFilter;
      } else if (preset === 'waterTapFlow' && pinkNoiseBuffer) {
        // Aerated tap stream + ceramic/fireclay basin resonance
        const streamSrc = ctx.createBufferSource();
        streamSrc.buffer = pinkNoiseBuffer;
        streamSrc.loop = true;
        streamSrc.playbackRate.value = 1.25;
        const streamFilter = ctx.createBiquadFilter();
        streamFilter.type = 'bandpass';
        streamFilter.frequency.value = 2150;
        streamFilter.Q.value = 0.95;
        const streamGain = ctx.createGain();
        streamGain.gain.value = 0.085;
        streamSrc.connect(streamFilter);
        streamFilter.connect(streamGain);
        streamGain.connect(lowpass);
        streamSrc.start(now);

        const basinSrc = ctx.createBufferSource();
        basinSrc.buffer = pinkNoiseBuffer;
        basinSrc.loop = true;
        const basinFilter = ctx.createBiquadFilter();
        basinFilter.type = 'bandpass';
        basinFilter.frequency.value = 640;
        basinFilter.Q.value = 1.85;
        const basinGain = ctx.createGain();
        basinGain.gain.value = 0.055;
        basinSrc.connect(basinFilter);
        basinFilter.connect(basinGain);
        basinGain.connect(lowpass);
        basinSrc.start(now);

        sources.push(streamSrc, basinSrc);
        extraNodes.push(streamFilter, streamGain, basinFilter, basinGain);
        modFilter = basinFilter;
      } else if (preset === 'hvacHum' && pinkNoiseBuffer) {
        const src = ctx.createBufferSource();
        src.buffer = pinkNoiseBuffer;
        src.loop = true;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 175;
        const airGain = ctx.createGain();
        airGain.gain.value = 0.045;
        src.connect(lp);
        lp.connect(airGain);
        airGain.connect(lowpass);
        src.start(now);

        const fan = ctx.createOscillator();
        fan.type = 'sine';
        fan.frequency.value = 60;
        const fanGain = ctx.createGain();
        fanGain.gain.value = 0.012;
        fan.connect(fanGain);
        fanGain.connect(lowpass);
        fan.start(now);

        sources.push(src, fan);
        extraNodes.push(lp, airGain, fanGain);
      } else if ((preset === 'mediaPlayback' || preset === 'piano') && pinkNoiseBuffer) {
        const src = ctx.createBufferSource();
        src.buffer = pinkNoiseBuffer;
        src.loop = true;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = preset === 'piano' ? 520 : 380;
        bp.Q.value = preset === 'piano' ? 2.2 : 1.0;
        const bedGain = ctx.createGain();
        bedGain.gain.value = 0.03;
        src.connect(bp);
        bp.connect(bedGain);
        bedGain.connect(lowpass);
        src.start(now);
        sources.push(src);
        extraNodes.push(bp, bedGain);
        modFilter = bp;
      }
    }

    built.modFilter = modFilter;
    graph = built;
    return built;
  };

  const trigger = (): void => {
    if (disposed) return;
    object3d.updateWorldMatrix(true, false);
    object3d.getWorldPosition(tmpWorldPos);
    const occ = soundEngine.getAcousticOcclusion();
    const isExtOccluded = options.isExterior === true && occ.isInterior;
    const spatialOptions: SpatialSoundOptions = {
      dryGain: volume * (isExtOccluded ? occ.exteriorGainScale : 1.0),
      refDistance: options.refDistance ?? 2.0,
      maxDistance: options.maxDistance ?? 28.0,
      rolloffFactor: options.rolloffFactor ?? 1.15,
      ...(isExtOccluded ? { lowpassHz: occ.exteriorLowpassHz } : {}),
    };

    if (options.recipe) {
      soundEngine.playSpatial(tmpWorldPos, options.recipe, spatialOptions);
      return;
    }

    if (options.url && kind === 'oneshot') {
      const bus = soundEngine.getSpatialBus();
      if (!bus) return;
      if (oneshotUrlBuffer) {
        soundEngine.playSpatial(
          tmpWorldPos,
          (tk) => {
            const src = tk.ctx.createBufferSource();
            src.buffer = oneshotUrlBuffer;
            src.connect(tk.dest);
            src.start(tk.now);
          },
          spatialOptions
        );
        return;
      }
      if (!oneshotUrlRequested && typeof fetch === 'function') {
        oneshotUrlRequested = true;
        fetch(options.url)
          .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`HTTP ${res.status}`))))
          .then((buf) => bus.ctx.decodeAudioData(buf))
          .then((decoded) => {
            if (disposed) return;
            oneshotUrlBuffer = decoded;
            soundEngine.playSpatial(
              tmpWorldPos,
              (tk) => {
                const src = tk.ctx.createBufferSource();
                src.buffer = decoded;
                src.connect(tk.dest);
                src.start(tk.now);
              },
              spatialOptions
            );
          })
          .catch(() => {
            oneshotUrlRequested = false;
          });
      }
      return;
    }

    if (isFoleyPreset(options.preset)) {
      soundEngine.playSpatial(tmpWorldPos, getFoleyRecipe(options.preset), spatialOptions);
    } else if (options.preset) {
      soundEngine.playSpatial(
        tmpWorldPos,
        getContinuousAccentRecipe(options.preset),
        spatialOptions
      );
    }
  };

  const setActive = (nextActive: boolean): void => {
    if (disposed) return;
    active = nextActive;
    if (!active && graph) {
      graph.gain.gain.setTargetAtTime(0, graph.ctx.currentTime, 0.08);
    }
  };

  const isActive = (): boolean => active;

  const setVolume = (nextVolume: number): void => {
    volume = Number.isFinite(nextVolume) ? THREE.MathUtils.clamp(nextVolume, 0, 2) : 0;
  };

  const getVolume = (): number => volume;

  const update = (
    dtSeconds: number,
    listenerPos?: readonly [number, number, number],
    occlusion?: AcousticOcclusionState
  ): void => {
    if (disposed || kind !== 'continuous') return;

    const bus = soundEngine.getSpatialBus();
    if (!bus) return;

    if (!active) {
      if (graph) {
        graph.gain.gain.setTargetAtTime(0, bus.ctx.currentTime, 0.08);
      }
      return;
    }

    const activeGraph = ensureContinuousGraph();
    if (!activeGraph) return;

    const activeOcclusion = occlusion ?? bus.occlusion;
    const effectiveListener: readonly [number, number, number] = listenerPos ?? [0, 1.5, 0];
    const evalState = evaluateAtListener(effectiveListener, activeOcclusion);
    const now = activeGraph.ctx.currentTime;

    if (activeGraph.panner) {
      const [sx, sy, sz] = evalState.samplePoint;
      if ('positionX' in activeGraph.panner && activeGraph.panner.positionX) {
        activeGraph.panner.positionX.setTargetAtTime(sx, now, 0.03);
        activeGraph.panner.positionY.setTargetAtTime(sy, now, 0.03);
        activeGraph.panner.positionZ.setTargetAtTime(sz, now, 0.03);
      } else {
        (
          activeGraph.panner as unknown as { setPosition?: (x: number, y: number, z: number) => void }
        ).setPosition?.(sx, sy, sz);
      }
    }

    const occlusionGain =
      options.isExterior === true && activeOcclusion.isInterior
        ? activeOcclusion.exteriorGainScale
        : options.isExterior === false && !activeOcclusion.isInterior
          ? 0.45
          : 1.0;

    const rawTargetGain = volume * occlusionGain;
    const targetGain = Number.isFinite(rawTargetGain) ? THREE.MathUtils.clamp(rawTargetGain, 0, 2) : 0;
    activeGraph.gain.gain.setTargetAtTime(targetGain, now, 0.12);
    activeGraph.lowpass.frequency.setTargetAtTime(
      Math.max(80, Math.min(activeGraph.ctx.sampleRate * 0.48, evalState.lowpassHz)),
      now,
      0.12
    );

    if (activeGraph.wetSend) {
      const wet = options.isExterior ? 0.05 : activeOcclusion.reverbWetSend;
      activeGraph.wetSend.gain.setTargetAtTime(wet, now, 0.15);
    }

    if (activeGraph.modFilter) {
      if (options.preset === 'waterFeature') {
        const ripple = 1600 + Math.sin(now * 2.1) * 260 + Math.cos(now * 0.85) * 140;
        activeGraph.modFilter.frequency.setTargetAtTime(ripple, now, 0.15);
      } else if (options.preset === 'waterTapFlow') {
        const swirl = 640 + Math.sin(now * 3.4) * 95 + Math.cos(now * 1.6) * 55;
        activeGraph.modFilter.frequency.setTargetAtTime(swirl, now, 0.1);
      } else if (options.preset === 'woodStove') {
        const draft = 185 + Math.sin(now * 0.9) * 35;
        activeGraph.modFilter.frequency.setTargetAtTime(draft, now, 0.2);
      }
    }

    if (options.preset === 'woodStove') {
      crackleTimerSec -= Math.max(0, Math.min(0.25, dtSeconds));
      if (crackleTimerSec <= 0) {
        crackleTimerSec = 0.45 + Math.random() * 1.65;
        soundEngine.playSpatial(
          {
            x: evalState.samplePoint[0],
            y: evalState.samplePoint[1],
            z: evalState.samplePoint[2],
          },
          getContinuousAccentRecipe('woodStove'),
          {
            dryGain: targetGain * 0.55,
            refDistance: options.refDistance ?? 2.0,
            maxDistance: options.maxDistance ?? 22.0,
            lowpassHz: evalState.lowpassHz,
          }
        );
      }
    }
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    active = false;
    teardownGraph();

    const list = emitterRegistry.get(object3d);
    if (list) {
      const idx = list.indexOf(handle);
      if (idx >= 0) {
        list.splice(idx, 1);
      }
      if (list.length === 0) {
        emitterRegistry.delete(object3d);
      }
    }
  };

  const handle: AudioEmitterHandle = {
    object3d,
    options: frozenOptions,
    trigger,
    setActive,
    isActive,
    setVolume,
    getVolume,
    evaluateAtListener,
    update,
    dispose,
  };

  let list = emitterRegistry.get(object3d);
  if (!list) {
    list = [];
    emitterRegistry.set(object3d, list);
  }
  list.push(handle);

  return handle;
}

/**
 * Returns all active `AudioEmitterHandle` instances attached to `root` and any of its descendants.
 */
export function getAttachedAudioEmitters(root: THREE.Object3D): readonly AudioEmitterHandle[] {
  const result: AudioEmitterHandle[] = [];
  root.traverse((obj) => {
    const list = emitterRegistry.get(obj);
    if (list && list.length > 0) {
      for (let i = 0; i < list.length; i++) {
        result.push(list[i]!);
      }
    }
  });
  return result;
}

/**
 * Plays a built-in one-shot spatial foley preset at the world position of `object3d`.
 * Headless-safe when Web Audio is unavailable.
 */
export function playFoleyAtObject(
  object3d: THREE.Object3D,
  preset: FoleyAudioPreset,
  options?: SpatialSoundOptions
): void {
  object3d.updateWorldMatrix(true, false);
  object3d.getWorldPosition(tmpWorldPos);
  soundEngine.playSpatial(tmpWorldPos, getFoleyRecipe(preset), options);
}
