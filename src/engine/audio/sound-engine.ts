import type * as THREE from 'three';
import type { AcousticOcclusionState } from '../../core/types/acoustics.ts';
import { computeAcousticOcclusion } from './acoustic-occlusion.ts';

export interface AudioEngineSettings {
  readonly muted: boolean;
  readonly masterVolume: number;
  readonly ambientEnabled: boolean;
  readonly sfxEnabled: boolean;
}

export type SoundEngineSettings = AudioEngineSettings;

export interface UiSoundOptions {
  readonly gain?: number;
}

export interface SpatialSoundOptions {
  readonly dryGain?: number;
  readonly wetSend?: number;
  readonly refDistance?: number;
  readonly maxDistance?: number;
  readonly rolloffFactor?: number;
  readonly lowpassHz?: number;
}

export interface NoiseBurstSpec {
  readonly startTime: number;
  readonly duration: number;
  readonly filterType: BiquadFilterType;
  readonly freqStart: number;
  readonly freqEnd?: number;
  readonly q?: number;
  readonly gainPeak: number;
  readonly attackSec?: number;
}

export interface ToneBurstSpec {
  readonly startTime: number;
  readonly duration: number;
  readonly type: OscillatorType;
  readonly freqStart: number;
  readonly freqEnd?: number;
  readonly gainPeak: number;
  readonly attackSec?: number;
}

/**
 * Synthesis toolkit passed to each asset's procedural sound recipe.
 */
export interface SoundSynthToolkit {
  readonly ctx: AudioContext;
  readonly dest: AudioNode;
  readonly now: number;
  noiseBurst(spec: NoiseBurstSpec): void;
  tone(spec: ToneBurstSpec): void;
}

export interface ExteriorAmbientBus {
  readonly ctx: AudioContext;
  readonly ambientGain: GainNode;
  readonly exteriorInput: AudioNode;
  readonly pinkNoiseBuffer: AudioBuffer | null;
  readonly whiteNoiseBuffer: AudioBuffer | null;
  readonly occlusion: AcousticOcclusionState;
}

export interface SpatialSfxBus {
  readonly ctx: AudioContext;
  readonly sfxGain: GainNode;
  readonly reverbNode: ConvolverNode | null;
  readonly pinkNoiseBuffer: AudioBuffer | null;
  readonly whiteNoiseBuffer: AudioBuffer | null;
  readonly isInterior: boolean;
  readonly occlusion: AcousticOcclusionState;
}

interface TrackedVoiceSource {
  readonly source: AudioScheduledSourceNode;
  readonly endTime: number;
  readonly ownedNodes: readonly AudioNode[];
  ended: boolean;
}

class VoiceSourceTracker {
  public readonly entries: TrackedVoiceSource[] = [];
  public maxEndTime = -Infinity;
  public finalEntry: TrackedVoiceSource | null = null;

  public register(
    source: AudioScheduledSourceNode,
    endTime: number,
    ownedNodes: readonly AudioNode[]
  ): void {
    const entry: TrackedVoiceSource = {
      source,
      endTime,
      ownedNodes,
      ended: false,
    };
    this.entries.push(entry);
    if (endTime >= this.maxEndTime) {
      this.maxEndTime = endTime;
      this.finalEntry = entry;
    }
  }
}

const STORAGE_KEY = 'hus_audio_settings_v1';
const LEGACY_STORAGE_KEY = 'hus_legacy_sound_settings_v1';
const REVERB_IR_QUANT_STEP_SEC = 0.15;
const CUSTOM_RECIPE_FALLBACK_CLEANUP_MS = 4000;

/**
 * Core 3D Web Audio runtime & procedural synthesis toolkit.
 *
 * Domain-agnostic: owns `AudioContext` lifecycle, user volume/mute persistence,
 * tab visibility suspend/resume, 3D `AudioListener` tracking, exterior portal
 * occlusion bus, stereo convolution room reverb, dry 2D UI clicks (`playUi`),
 * and 3D HRTF spatial foley (`playSpatial`, `triggerSpatialFoley`) with
 * zero-leak `onended` node teardown.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private exteriorLowpass: BiquadFilterNode | null = null;
  private exteriorHighShelf: BiquadFilterNode | null = null;
  private exteriorOcclusionGain: GainNode | null = null;
  private reverbNode: ConvolverNode | null = null;
  private reverbGain: GainNode | null = null;
  private reverbIrDecaySec = 0.32;

  private whiteNoiseBuffer: AudioBuffer | null = null;
  private pinkNoiseBuffer: AudioBuffer | null = null;

  private muted = false;
  private masterVolume = 0.75;
  private ambientEnabled = true;
  private sfxEnabled = true;
  private isInterior = true;
  private explicitOcclusionActive = false;
  private occlusionState: AcousticOcclusionState = computeAcousticOcclusion({
    listenerPos: [0, 1.5, 0],
    isInterior: true,
  });

  private userGestureUnlocked = false;
  private unlockInstalled = false;
  private lifecycleInstalled = false;
  private cleanupGestureListeners: (() => void) | null = null;
  private cleanupLifecycleListeners: (() => void) | null = null;
  private readonly fallbackTimers = new Set<ReturnType<typeof setTimeout>>();
  private readonly listeners = new Set<() => void>();

  public constructor() {
    this.loadSettings();
    this.installGestureUnlock();
    this.installLifecycleHandlers();
  }

  private loadSettings(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const raw =
        localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<AudioEngineSettings>;
      if (typeof parsed.muted === 'boolean') this.muted = parsed.muted;
      if (typeof parsed.masterVolume === 'number' && Number.isFinite(parsed.masterVolume)) {
        this.masterVolume = Math.max(0, Math.min(1, parsed.masterVolume));
      }
      if (typeof parsed.ambientEnabled === 'boolean') this.ambientEnabled = parsed.ambientEnabled;
      if (typeof parsed.sfxEnabled === 'boolean') this.sfxEnabled = parsed.sfxEnabled;
    } catch {
      // Ignore storage errors in restricted contexts
    }
  }

  private saveSettings(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const payload: AudioEngineSettings = {
        muted: this.muted,
        masterVolume: this.masterVolume,
        ambientEnabled: this.ambientEnabled,
        sfxEnabled: this.sfxEnabled,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage errors
    }
  }

  private isDocumentHidden(): boolean {
    return typeof document !== 'undefined' && Boolean(document.hidden);
  }

  private emitChanged(): void {
    for (const fn of this.listeners) {
      fn();
    }
  }

  public onChanged(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public hasUserGesture(): boolean {
    return this.userGestureUnlocked;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(muted: boolean): void {
    const changed = this.muted !== muted;
    this.muted = muted;
    if (changed) {
      this.saveSettings();
    }

    if (!muted) {
      this.userGestureUnlocked = true;
      const ctx = this.ensureContext();
      if (ctx && ctx.state === 'suspended' && !this.isDocumentHidden()) {
        ctx.resume().catch(() => {
          // Ignore autoplay restrictions
        });
      }
    } else if (this.ctx && this.ctx.state === 'running') {
      this.ctx.suspend().catch(() => {
        // Ignore suspend errors
      });
    }

    if (changed) {
      this.syncBusGains();
      this.emitChanged();
    }
  }

  public toggleMuted(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  public getMasterVolume(): number {
    return this.masterVolume;
  }

  public setMasterVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0.75));
    if (Math.abs(this.masterVolume - clamped) < 1e-4) return;
    this.masterVolume = clamped;
    this.saveSettings();
    this.syncBusGains();
    this.emitChanged();
  }

  public isAmbientEnabled(): boolean {
    return this.ambientEnabled;
  }

  public setAmbientEnabled(enabled: boolean): void {
    if (this.ambientEnabled === enabled) return;
    this.ambientEnabled = enabled;
    this.saveSettings();
    this.syncBusGains();
    this.emitChanged();
  }

  public isSfxEnabled(): boolean {
    return this.sfxEnabled;
  }

  public setSfxEnabled(enabled: boolean): void {
    if (this.sfxEnabled === enabled) return;
    this.sfxEnabled = enabled;
    this.saveSettings();
    this.syncBusGains();
    this.emitChanged();
  }

  private installGestureUnlock(): void {
    if (
      this.unlockInstalled ||
      typeof window === 'undefined' ||
      typeof window.addEventListener !== 'function'
    ) {
      return;
    }
    this.unlockInstalled = true;
    const removeUnlockListeners = (): void => {
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('pointerdown', onGesture);
        window.removeEventListener('keydown', onGesture);
        window.removeEventListener('touchstart', onGesture);
      }
      this.cleanupGestureListeners = null;
    };
    const onGesture = (): void => {
      this.userGestureUnlocked = true;
      if (!this.muted) {
        const ctx = this.ensureContext();
        if (ctx) {
          removeUnlockListeners();
        }
      }
    };
    this.cleanupGestureListeners = removeUnlockListeners;
    window.addEventListener('pointerdown', onGesture, { passive: true });
    window.addEventListener('keydown', onGesture, { passive: true });
    window.addEventListener('touchstart', onGesture, { passive: true });
  }

  private installLifecycleHandlers(): void {
    if (this.lifecycleInstalled) return;

    const hasDoc =
      typeof document !== 'undefined' && typeof document.addEventListener === 'function';
    const hasWin =
      typeof window !== 'undefined' && typeof window.addEventListener === 'function';
    if (!hasDoc && !hasWin) return;

    this.lifecycleInstalled = true;

    const suspendIfRunning = (): void => {
      if (this.ctx && this.ctx.state === 'running') {
        this.ctx.suspend().catch(() => {
          // Ignore suspend errors
        });
      }
      this.emitChanged();
    };

    const resumeIfEligible = (): void => {
      if (
        !this.muted &&
        this.userGestureUnlocked &&
        !this.isDocumentHidden() &&
        this.ctx &&
        this.ctx.state === 'suspended'
      ) {
        this.ctx.resume().catch(() => {
          // Ignore resume errors
        });
      }
      this.emitChanged();
    };

    const onVisibilityChange = (): void => {
      if (this.isDocumentHidden()) {
        suspendIfRunning();
      } else {
        resumeIfEligible();
      }
    };

    const onPageHide = (): void => {
      suspendIfRunning();
    };

    const onPageShow = (): void => {
      resumeIfEligible();
    };

    if (hasDoc) {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
    if (hasWin) {
      window.addEventListener('pagehide', onPageHide);
      window.addEventListener('pageshow', onPageShow);
    }

    this.cleanupLifecycleListeners = (): void => {
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('pagehide', onPageHide);
        window.removeEventListener('pageshow', onPageShow);
      }
      this.cleanupLifecycleListeners = null;
      this.lifecycleInstalled = false;
    };
  }

  public dispose(): void {
    this.cleanupGestureListeners?.();
    this.unlockInstalled = false;
    this.cleanupLifecycleListeners?.();
    for (const timer of this.fallbackTimers) {
      clearTimeout(timer);
    }
    this.fallbackTimers.clear();
    this.listeners.clear();

    if (this.ctx) {
      const ctx = this.ctx;
      this.ctx = null;
      this.masterGain = null;
      this.sfxGain = null;
      this.ambientGain = null;
      this.exteriorLowpass = null;
      this.exteriorHighShelf = null;
      this.exteriorOcclusionGain = null;
      this.reverbNode = null;
      this.reverbGain = null;
      if (typeof ctx.close === 'function') {
        ctx.close().catch(() => {
          // Ignore close errors
        });
      } else if (ctx.state === 'running' && typeof ctx.suspend === 'function') {
        ctx.suspend().catch(() => {
          // Ignore suspend errors
        });
      }
    }
  }

  public ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      try {
        const ctx = new AudioCtx();
        this.ctx = ctx;

        const masterGain = ctx.createGain();
        masterGain.gain.value = this.muted ? 0 : this.masterVolume;
        masterGain.connect(ctx.destination);
        this.masterGain = masterGain;

        const sfxGain = ctx.createGain();
        sfxGain.gain.value = this.sfxEnabled ? 1.0 : 0.0;
        sfxGain.connect(masterGain);
        this.sfxGain = sfxGain;

        const ambientGain = ctx.createGain();
        ambientGain.gain.value = this.ambientEnabled ? 1.0 : 0.0;
        ambientGain.connect(masterGain);
        this.ambientGain = ambientGain;

        this.buildExteriorFilterChain(ctx, ambientGain);
        this.buildNoiseBuffers(ctx);
        this.buildRoomReverb(ctx, sfxGain);
        this.cleanupGestureListeners?.();
      } catch {
        return null;
      }
    }
    if (this.ctx && this.ctx.state === 'suspended' && !this.muted && !this.isDocumentHidden()) {
      this.ctx.resume().catch(() => {
        // Ignore autoplay restrictions before user gesture
      });
    }
    return this.ctx;
  }

  private buildExteriorFilterChain(ctx: AudioContext, ambientGain: GainNode): void {
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = this.occlusionState.exteriorLowpassHz;
    lowpass.Q.value = 0.707;

    const highShelf = ctx.createBiquadFilter();
    highShelf.type = 'highshelf';
    highShelf.frequency.value = 2600;
    highShelf.gain.value = this.occlusionState.exteriorHighShelfDb;

    const occGain = ctx.createGain();
    occGain.gain.value = this.occlusionState.exteriorGainScale;

    lowpass.connect(highShelf);
    highShelf.connect(occGain);
    occGain.connect(ambientGain);

    this.exteriorLowpass = lowpass;
    this.exteriorHighShelf = highShelf;
    this.exteriorOcclusionGain = occGain;
  }

  private buildNoiseBuffers(ctx: AudioContext): void {
    const sampleRate = ctx.sampleRate;
    const whiteLen = Math.floor(sampleRate * 0.8);
    const whiteBuf = ctx.createBuffer(1, whiteLen, sampleRate);
    const whiteData = whiteBuf.getChannelData(0);
    for (let i = 0; i < whiteLen; i++) {
      whiteData[i] = Math.random() * 2 - 1;
    }
    this.whiteNoiseBuffer = whiteBuf;

    // Paul Kellet pink noise filter for natural ambient wind & room air
    const pinkLen = Math.floor(sampleRate * 1.25);
    const pinkBuf = ctx.createBuffer(1, pinkLen, sampleRate);
    const pinkData = pinkBuf.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    for (let i = 0; i < pinkLen; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      pinkData[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.045;
      b6 = white * 0.115926;
    }
    this.pinkNoiseBuffer = pinkBuf;
  }

  private buildReverbImpulseResponse(ctx: AudioContext, rt60Sec: number): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const clampedRt60 = Math.max(0.12, Math.min(2.4, rt60Sec));
    const duration = Math.max(0.16, Math.min(2.2, clampedRt60 * 0.85));
    const length = Math.max(64, Math.floor(sampleRate * duration));
    const decayRate = 6.907755 / clampedRt60;
    const normScale = 0.35 / Math.sqrt(Math.max(0.32, clampedRt60) / 0.32);

    const ir = ctx.createBuffer(2, length, sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / sampleRate;
        const early = t < 0.035 ? Math.sin(t * 950 * (ch + 1)) * 0.35 : 0;
        const tail = (Math.random() * 2 - 1) * Math.exp(-t * decayRate);
        data[i] = (early + tail) * normScale;
      }
    }
    return ir;
  }

  private buildRoomReverb(ctx: AudioContext, sfxGain: GainNode): void {
    try {
      const initialRt60 = this.explicitOcclusionActive
        ? this.occlusionState.reverbDecaySec
        : 0.32;
      const ir = this.buildReverbImpulseResponse(ctx, initialRt60);
      this.reverbIrDecaySec = initialRt60;
      const convolver = ctx.createConvolver();
      convolver.buffer = ir;
      const revGain = ctx.createGain();
      revGain.gain.value = this.explicitOcclusionActive
        ? this.occlusionState.reverbWetSend
        : 0.18;
      convolver.connect(revGain);
      revGain.connect(sfxGain);
      this.reverbNode = convolver;
      this.reverbGain = revGain;
    } catch {
      // Convolver optional
    }
  }

  private syncBusGains(): void {
    if (!this.ctx || !this.masterGain || !this.sfxGain || !this.ambientGain) return;
    const now = this.ctx.currentTime;
    const targetMaster = this.muted ? 0 : this.masterVolume;
    this.masterGain.gain.setTargetAtTime(targetMaster, now, 0.025);
    this.sfxGain.gain.setTargetAtTime(this.sfxEnabled ? 1.0 : 0.0, now, 0.025);
    this.ambientGain.gain.setTargetAtTime(this.ambientEnabled ? 1.0 : 0.0, now, 0.04);
  }

  /**
   * Smoothly updates exterior low-pass/high-shelf/gain occlusion filtering and Sabine room
   * reverb parameters on the active audio graph. Safe to call in headless environments.
   */
  public applyAcousticOcclusion(occlusion: AcousticOcclusionState): void {
    this.occlusionState = occlusion;
    this.isInterior = occlusion.isInterior;
    this.explicitOcclusionActive = true;

    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;

    if (this.exteriorLowpass) {
      const nyquist = this.ctx.sampleRate * 0.48;
      const targetFreq = Math.max(80, Math.min(nyquist, occlusion.exteriorLowpassHz));
      this.exteriorLowpass.frequency.setTargetAtTime(targetFreq, now, 0.1);
    }
    if (this.exteriorHighShelf) {
      const targetDb = Math.max(-24, Math.min(6, occlusion.exteriorHighShelfDb));
      this.exteriorHighShelf.gain.setTargetAtTime(targetDb, now, 0.1);
    }
    if (this.exteriorOcclusionGain) {
      const targetGain = Math.max(0, Math.min(1, occlusion.exteriorGainScale));
      this.exteriorOcclusionGain.gain.setTargetAtTime(targetGain, now, 0.1);
    }
    if (this.reverbGain) {
      const targetWet = Math.max(0, Math.min(0.6, occlusion.reverbWetSend));
      this.reverbGain.gain.setTargetAtTime(targetWet, now, 0.14);
    }
    if (
      this.reverbNode &&
      Math.abs(occlusion.reverbDecaySec - this.reverbIrDecaySec) >= REVERB_IR_QUANT_STEP_SEC
    ) {
      try {
        const quantized =
          Math.round(occlusion.reverbDecaySec / REVERB_IR_QUANT_STEP_SEC) *
          REVERB_IR_QUANT_STEP_SEC;
        const targetDecay = Math.max(0.12, Math.min(2.4, quantized));
        if (Math.abs(targetDecay - this.reverbIrDecaySec) >= REVERB_IR_QUANT_STEP_SEC) {
          this.reverbNode.buffer = this.buildReverbImpulseResponse(this.ctx, targetDecay);
          this.reverbIrDecaySec = targetDecay;
        }
      } catch {
        // Ignore impulse response allocation errors
      }
    }
  }

  /**
   * Returns the most recently applied acoustic occlusion state.
   */
  public getAcousticOcclusion(): AcousticOcclusionState {
    return this.occlusionState;
  }

  /**
   * Returns whether callers have explicitly pushed an `AcousticOcclusionState`.
   */
  public hasExplicitAcousticOcclusion(): boolean {
    return this.explicitOcclusionActive;
  }

  /**
   * Synchronizes the 3D Web Audio listener with the active camera and adjusts room
   * convolution reverb wetness (and optional portal occlusion) based on listener state.
   */
  public updateListener(
    camera: THREE.Camera,
    isInterior: boolean,
    occlusion?: AcousticOcclusionState
  ): void {
    if (occlusion) {
      this.applyAcousticOcclusion(occlusion);
    } else {
      this.isInterior = isInterior;
    }

    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;

    const listener = this.ctx.listener;
    const pos = camera.position;
    const el = camera.matrixWorld.elements;
    const fx = -el[8]!;
    const fy = -el[9]!;
    const fz = -el[10]!;
    const ux = el[4]!;
    const uy = el[5]!;
    const uz = el[6]!;

    if ('positionX' in listener && listener.positionX) {
      listener.positionX.setTargetAtTime(pos.x, now, 0.015);
      listener.positionY.setTargetAtTime(pos.y, now, 0.015);
      listener.positionZ.setTargetAtTime(pos.z, now, 0.015);
      listener.forwardX.setTargetAtTime(fx, now, 0.015);
      listener.forwardY.setTargetAtTime(fy, now, 0.015);
      listener.forwardZ.setTargetAtTime(fz, now, 0.015);
      listener.upX.setTargetAtTime(ux, now, 0.015);
      listener.upY.setTargetAtTime(uy, now, 0.015);
      listener.upZ.setTargetAtTime(uz, now, 0.015);
    } else {
      const legacy = listener as unknown as {
        setPosition?: (x: number, y: number, z: number) => void;
        setOrientation?: (
          fx: number,
          fy: number,
          fz: number,
          ux: number,
          uy: number,
          uz: number
        ) => void;
      };
      legacy.setPosition?.(pos.x, pos.y, pos.z);
      legacy.setOrientation?.(fx, fy, fz, ux, uy, uz);
    }

    if (!occlusion && this.reverbGain) {
      const targetWet =
        this.explicitOcclusionActive && this.occlusionState.isInterior === isInterior
          ? this.occlusionState.reverbWetSend
          : isInterior
            ? 0.22
            : 0.05;
      this.reverbGain.gain.setTargetAtTime(targetWet, now, 0.15);
    }
  }

  /**
   * Returns the active ambient bus and noise buffers when ambient audio is active and running.
   */
  public getAmbientBus(): {
    readonly ctx: AudioContext;
    readonly ambientGain: GainNode;
    readonly pinkNoiseBuffer: AudioBuffer | null;
  } | null {
    if (this.muted || !this.ambientEnabled) return null;
    if (!this.ctx || this.ctx.state !== 'running' || !this.ambientGain) return null;
    return {
      ctx: this.ctx,
      ambientGain: this.ambientGain,
      pinkNoiseBuffer: this.pinkNoiseBuffer,
    };
  }

  /**
   * Returns the active exterior ambient bus routed through `AudioEngine`'s indoor/portal
   * occlusion filter chain (`exteriorLowpass -> exteriorHighShelf -> exteriorOcclusionGain`).
   */
  public getExteriorAmbientBus(): ExteriorAmbientBus | null {
    if (this.muted || !this.ambientEnabled) return null;
    if (!this.ctx || this.ctx.state !== 'running' || !this.ambientGain) return null;
    return {
      ctx: this.ctx,
      ambientGain: this.ambientGain,
      exteriorInput: this.exteriorLowpass ?? this.ambientGain,
      pinkNoiseBuffer: this.pinkNoiseBuffer,
      whiteNoiseBuffer: this.whiteNoiseBuffer,
      occlusion: this.occlusionState,
    };
  }

  /**
   * Returns the active SFX & room reverb bus for continuous spatial object emitters.
   */
  public getSpatialBus(): SpatialSfxBus | null {
    if (this.muted || !this.sfxEnabled) return null;
    if (!this.ctx || this.ctx.state !== 'running' || !this.sfxGain) return null;
    return {
      ctx: this.ctx,
      sfxGain: this.sfxGain,
      reverbNode: this.reverbNode,
      pinkNoiseBuffer: this.pinkNoiseBuffer,
      whiteNoiseBuffer: this.whiteNoiseBuffer,
      isInterior: this.isInterior,
      occlusion: this.occlusionState,
    };
  }

  /**
   * Executes a dry 2D UI sound recipe routed directly to `sfxGain` WITHOUT a `PannerNode`
   * and WITHOUT any `ConvolverNode` reverb send, tearing down temporary nodes on `onended`.
   */
  public playUi(
    recipe: (toolkit: SoundSynthToolkit) => void,
    options?: UiSoundOptions
  ): void {
    if (this.muted || !this.sfxEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;

    const inputGain = ctx.createGain();
    inputGain.gain.value = options?.gain ?? 1.0;
    inputGain.connect(this.sfxGain);

    const voiceNodes: AudioNode[] = [inputGain];
    this.runTrackedVoiceRecipe(ctx, inputGain, voiceNodes, recipe);
  }

  /**
   * Executes a non-spatialized dry procedural sound recipe directly on the SFX bus.
   */
  public playDirect(recipe: (toolkit: SoundSynthToolkit) => void): void {
    this.playUi(recipe);
  }

  /**
   * Triggers 3D spatial foley when `worldPos` is defined, or dry 2D UI sound when `worldPos`
   * is `undefined`.
   */
  public triggerSpatialFoley(
    worldPos: { readonly x: number; readonly y: number; readonly z: number } | undefined,
    recipe: (toolkit: SoundSynthToolkit) => void,
    options?: SpatialSoundOptions
  ): void {
    if (worldPos !== undefined) {
      this.playSpatial(worldPos, recipe, options);
    } else {
      this.playUi(recipe, options?.dryGain !== undefined ? { gain: options.dryGain } : undefined);
    }
  }

  /**
   * Executes a procedural sound recipe routed through a 3D spatial `PannerNode` (when `worldPos`
   * is provided) and the room reverb send, disconnecting all per-voice nodes once the final
   * scheduled source (`maxEndTime`) fires `onended`.
   */
  public playSpatial(
    worldPos: { readonly x: number; readonly y: number; readonly z: number } | undefined,
    recipe: (toolkit: SoundSynthToolkit) => void,
    options?: SpatialSoundOptions
  ): void {
    if (this.muted || !this.sfxEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;

    const { dest, voiceNodes } = this.createBusNode(ctx, worldPos, options);
    this.runTrackedVoiceRecipe(ctx, dest, voiceNodes, recipe);
  }

  private runTrackedVoiceRecipe(
    ctx: AudioContext,
    dest: AudioNode,
    voiceNodes: readonly AudioNode[],
    recipe: (toolkit: SoundSynthToolkit) => void
  ): void {
    const tracker = new VoiceSourceTracker();
    const toolkit = this.createToolkit(ctx, dest, tracker);

    let voiceCleaned = false;
    const cleanupVoice = (): void => {
      if (voiceCleaned) return;
      voiceCleaned = true;
      for (const node of voiceNodes) {
        try {
          node.disconnect();
        } catch {
          // Ignore already disconnected node
        }
      }
    };

    try {
      recipe(toolkit);
    } catch (err) {
      cleanupVoice();
      throw err;
    }

    if (tracker.entries.length > 0) {
      const finalEntry = tracker.finalEntry;
      for (const entry of tracker.entries) {
        const isFinal = entry === finalEntry;
        entry.source.onended = () => {
          for (const node of entry.ownedNodes) {
            try {
              node.disconnect();
            } catch {
              // Ignore
            }
          }
          entry.ended = true;
          if (isFinal || tracker.entries.every((e) => e.ended)) {
            cleanupVoice();
          }
        };
      }
    } else {
      const timer = setTimeout(() => {
        this.fallbackTimers.delete(timer);
        cleanupVoice();
      }, CUSTOM_RECIPE_FALLBACK_CLEANUP_MS);
      (timer as unknown as { unref?: () => void })?.unref?.();
      this.fallbackTimers.add(timer);
    }
  }

  private createBusNode(
    ctx: AudioContext,
    worldPos: { readonly x: number; readonly y: number; readonly z: number } | undefined,
    options?: SpatialSoundOptions
  ): { readonly dest: AudioNode; readonly voiceNodes: readonly AudioNode[] } {
    const dryGain = options?.dryGain ?? 1.0;
    const wetSend =
      options?.wetSend ??
      (this.explicitOcclusionActive
        ? this.occlusionState.reverbWetSend
        : this.isInterior
          ? 0.22
          : 0.06);
    const refDistance = options?.refDistance ?? 2.2;
    const maxDistance = options?.maxDistance ?? 28;
    const rolloffFactor = options?.rolloffFactor ?? 1.15;

    const voiceNodes: AudioNode[] = [];
    const inputGain = ctx.createGain();
    inputGain.gain.value = dryGain;
    voiceNodes.push(inputGain);

    let stageOut: AudioNode = inputGain;
    if (options?.lowpassHz !== undefined && options.lowpassHz < 17500) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.max(80, Math.min(ctx.sampleRate * 0.48, options.lowpassHz));
      lp.Q.value = 0.707;
      inputGain.connect(lp);
      stageOut = lp;
      voiceNodes.push(lp);
    }

    if (worldPos && typeof ctx.createPanner === 'function') {
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = refDistance;
      panner.maxDistance = maxDistance;
      panner.rolloffFactor = rolloffFactor;
      const now = ctx.currentTime;
      if ('positionX' in panner && panner.positionX) {
        panner.positionX.setValueAtTime(worldPos.x, now);
        panner.positionY.setValueAtTime(worldPos.y, now);
        panner.positionZ.setValueAtTime(worldPos.z, now);
      } else {
        (
          panner as unknown as { setPosition?: (x: number, y: number, z: number) => void }
        ).setPosition?.(worldPos.x, worldPos.y, worldPos.z);
      }
      stageOut.connect(panner);
      panner.connect(this.sfxGain!);
      voiceNodes.push(panner);
      if (this.reverbNode && wetSend > 0.01) {
        const send = ctx.createGain();
        send.gain.value = wetSend;
        panner.connect(send);
        send.connect(this.reverbNode);
        voiceNodes.push(send);
      }
    } else {
      stageOut.connect(this.sfxGain!);
      if (this.reverbNode && wetSend > 0.01) {
        const send = ctx.createGain();
        send.gain.value = wetSend;
        stageOut.connect(send);
        send.connect(this.reverbNode);
        voiceNodes.push(send);
      }
    }
    return { dest: inputGain, voiceNodes };
  }

  private createToolkit(
    ctx: AudioContext,
    dest: AudioNode,
    tracker: VoiceSourceTracker
  ): SoundSynthToolkit {
    return {
      ctx,
      dest,
      now: ctx.currentTime,
      noiseBurst: (spec) => this.emitNoiseBurst(ctx, dest, spec, tracker),
      tone: (spec) => this.emitTone(ctx, dest, spec, tracker),
    };
  }

  private emitNoiseBurst(
    ctx: AudioContext,
    dest: AudioNode,
    spec: NoiseBurstSpec,
    tracker: VoiceSourceTracker
  ): void {
    if (!this.whiteNoiseBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = this.whiteNoiseBuffer;
    const offset =
      Math.random() * Math.max(0.05, this.whiteNoiseBuffer.duration - spec.duration - 0.05);

    const filter = ctx.createBiquadFilter();
    filter.type = spec.filterType;
    filter.frequency.setValueAtTime(Math.max(20, spec.freqStart), spec.startTime);
    if (spec.freqEnd !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(20, spec.freqEnd),
        spec.startTime + spec.duration
      );
    }
    filter.Q.value = spec.q ?? 1.0;

    const attack = spec.attackSec ?? 0.004;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, spec.startTime);
    env.gain.linearRampToValueAtTime(Math.max(0.0002, spec.gainPeak), spec.startTime + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, spec.startTime + spec.duration);

    src.connect(filter);
    filter.connect(env);
    env.connect(dest);

    const endTime = spec.startTime + spec.duration + 0.02;
    src.start(spec.startTime, offset, spec.duration + 0.02);
    src.stop(endTime);
    tracker.register(src, endTime, [src, filter, env]);
  }

  private emitTone(
    ctx: AudioContext,
    dest: AudioNode,
    spec: ToneBurstSpec,
    tracker: VoiceSourceTracker
  ): void {
    const osc = ctx.createOscillator();
    osc.type = spec.type;
    osc.frequency.setValueAtTime(Math.max(20, spec.freqStart), spec.startTime);
    if (spec.freqEnd !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(20, spec.freqEnd),
        spec.startTime + spec.duration
      );
    }

    const attack = spec.attackSec ?? 0.003;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, spec.startTime);
    env.gain.linearRampToValueAtTime(Math.max(0.0002, spec.gainPeak), spec.startTime + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, spec.startTime + spec.duration);

    osc.connect(env);
    env.connect(dest);

    const endTime = spec.startTime + spec.duration + 0.015;
    osc.start(spec.startTime);
    osc.stop(endTime);
    tracker.register(osc, endTime, [osc, env]);
  }
}

export { AudioEngine as SoundEngine };

export const audioEngine = new AudioEngine();
export const soundEngine = audioEngine;
