import { MathUtils } from 'three';
import type {
  AcousticOcclusionState,
  NormalizedSoundscapeDescriptor,
  SoundscapeChannelLayout,
  SoundscapeDescriptor,
} from '../../core/types/acoustics.ts';
import { normalizeSoundscapeDescriptor } from '../../core/types/acoustics.ts';
import type { TimeOfDay } from '../../core/types/scene.ts';
import { computeLegacyAcousticOcclusion } from './acoustic-occlusion.ts';
import { AudioEngine, audioEngine } from './sound-engine.ts';

export interface AmbientWeatherAudioState {
  /** 10m wind speed in km/h (modulates breeze filter & gust LFO). */
  readonly windSpeedKph: number;
  /** Active rain intensity in `[0, 1]` (`0` = dry, `1` = heavy storm). */
  readonly rainIntensity: number;
  /** Active snowfall intensity in `[0, 1]`. */
  readonly snowIntensity: number;
}

export interface TimeOfDayStemWeights {
  readonly day: number;
  readonly dusk: number;
  readonly night: number;
}

type StemSlot = 'day' | 'dusk' | 'night' | 'wind' | 'rain';

interface CustomStemRuntime {
  url: string;
  layout: SoundscapeChannelLayout;
  status: 'loading' | 'ready' | 'error';
  source: AudioBufferSourceNode | null;
  gain: GainNode | null;
  routingNodes: AudioNode[];
}

const DEFAULT_WEATHER_AUDIO: AmbientWeatherAudioState = {
  windSpeedKph: 12,
  rainIntensity: 0,
  snowIntensity: 0,
};

/**
 * Computes normalized `(day, dusk, night)` crossfade weights summing to `1.0` for either
 * discrete `TimeOfDay` modes or continuous 24-hour local solar/civil time (`0..24`).
 */
export function computeTimeOfDayStemWeights(
  civilHourOrMode: TimeOfDay | number
): TimeOfDayStemWeights {
  if (typeof civilHourOrMode === 'string') {
    if (civilHourOrMode === 'day') return { day: 1, dusk: 0, night: 0 };
    if (civilHourOrMode === 'dusk') return { day: 0, dusk: 1, night: 0 };
    return { day: 0, dusk: 0, night: 1 };
  }

  if (!Number.isFinite(civilHourOrMode)) {
    return { day: 1, dusk: 0, night: 0 };
  }

  const h = ((civilHourOrMode % 24) + 24) % 24;

  if (h < 4.5) {
    return { day: 0, dusk: 0, night: 1 };
  }
  if (h < 6.2) {
    const t = MathUtils.smoothstep(h, 4.5, 6.2);
    return { day: 0, dusk: t, night: 1 - t };
  }
  if (h < 8.5) {
    const t = MathUtils.smoothstep(h, 6.2, 8.5);
    return { day: t, dusk: 1 - t, night: 0 };
  }
  if (h < 16.5) {
    return { day: 1, dusk: 0, night: 0 };
  }
  if (h < 18.8) {
    const t = MathUtils.smoothstep(h, 16.5, 18.8);
    return { day: 1 - t, dusk: t, night: 0 };
  }
  if (h < 21.5) {
    const t = MathUtils.smoothstep(h, 18.8, 21.5);
    return { day: 0, dusk: 1 - t, night: t };
  }
  return { day: 0, dusk: 0, night: 1 };
}

/**
 * `0 Hz`-safe exterior ambient & weather soundscape controller supporting 5 procedural presets
 * (`'countryside'`, `'coastal'`, `'hills-city'`, `'urban'`, `'quiet'`) plus optional custom
 * time-of-day and weather stem URLs routed through `AudioEngine`'s indoor/portal occlusion bus.
 *
 * Uses native Web Audio `OscillatorNode` LFOs for wind gusts and bed swells so continuous
 * modulation runs on the Web Audio thread even while the 3D render loop sleeps at `0 Hz`.
 */
export class SoundscapeController {
  private readonly engine: AudioEngine;
  private readonly unsubscribeEngine: () => void;
  private descriptor: NormalizedSoundscapeDescriptor;

  private soundscapeMasterGain: GainNode | null = null;
  private windSource: AudioBufferSourceNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private windLfo1: OscillatorNode | null = null;
  private windLfo1Gain: GainNode | null = null;
  private windLfo2: OscillatorNode | null = null;
  private windLfo2Gain: GainNode | null = null;

  private rainSource: AudioBufferSourceNode | null = null;
  private rainFilter: BiquadFilterNode | null = null;
  private rainGain: GainNode | null = null;

  private bedSource: AudioBufferSourceNode | null = null;
  private bedFilter: BiquadFilterNode | null = null;
  private bedGain: GainNode | null = null;
  private bedLfo: OscillatorNode | null = null;
  private bedLfoGain: GainNode | null = null;

  private boundCtx: AudioContext | null = null;
  private accentTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  private lastTimeOfDay: TimeOfDay | number = 'day';
  private lastWeather: AmbientWeatherAudioState = DEFAULT_WEATHER_AUDIO;

  private stemEpoch = 0;
  private readonly customStems = new Map<StemSlot, CustomStemRuntime>();

  public constructor(descriptor?: SoundscapeDescriptor, engine?: AudioEngine);
  public constructor(engine: AudioEngine);
  public constructor(
    descriptorOrEngine?: SoundscapeDescriptor | AudioEngine,
    engine: AudioEngine = audioEngine
  ) {
    if (descriptorOrEngine instanceof AudioEngine) {
      this.descriptor = normalizeSoundscapeDescriptor(undefined);
      this.engine = descriptorOrEngine;
    } else {
      this.descriptor = normalizeSoundscapeDescriptor(descriptorOrEngine);
      this.engine = engine;
    }
    this.unsubscribeEngine = this.engine.onChanged(() => {
      this.syncAccentTimer();
    });
  }

  public static computeTimeOfDayStemWeights(
    civilHourOrMode: TimeOfDay | number
  ): TimeOfDayStemWeights {
    return computeTimeOfDayStemWeights(civilHourOrMode);
  }

  public computeTimeOfDayStemWeights(civilHourOrMode: TimeOfDay | number): TimeOfDayStemWeights {
    return computeTimeOfDayStemWeights(civilHourOrMode);
  }

  public hasActiveRainSource(): boolean {
    return this.rainSource !== null;
  }

  public setSoundscape(descriptor: SoundscapeDescriptor): void {
    const next = normalizeSoundscapeDescriptor(descriptor);
    const urlsChanged =
      next.dayUrl !== this.descriptor.dayUrl ||
      next.duskUrl !== this.descriptor.duskUrl ||
      next.nightUrl !== this.descriptor.nightUrl ||
      next.windUrl !== this.descriptor.windUrl ||
      next.rainUrl !== this.descriptor.rainUrl ||
      next.channelLayout !== this.descriptor.channelLayout;

    this.descriptor = next;

    if (next.preset === 'quiet') {
      this.stopRainSource();
    }

    if (urlsChanged) {
      this.stemEpoch += 1;
      this.stopRemovedOrChangedStems();
    }

    this.syncAccentTimer();
  }

  public getSoundscape(): NormalizedSoundscapeDescriptor {
    return this.descriptor;
  }

  public update(
    _dtSeconds: number,
    timeOfDay: TimeOfDay | number,
    isInterior: boolean,
    bifoldsOpen: boolean,
    weather: AmbientWeatherAudioState = DEFAULT_WEATHER_AUDIO,
    occlusion?: AcousticOcclusionState
  ): void {
    if (this.disposed) return;

    this.lastTimeOfDay = timeOfDay;
    this.lastWeather = weather;

    if (occlusion) {
      this.engine.applyAcousticOcclusion(occlusion);
    } else if (
      !this.engine.hasExplicitAcousticOcclusion() ||
      this.engine.getAcousticOcclusion().isInterior !== isInterior
    ) {
      this.engine.applyAcousticOcclusion(
        computeLegacyAcousticOcclusion(isInterior, bifoldsOpen)
      );
    }

    const rainStrength = Math.max(0, Math.min(1, weather.rainIntensity));
    if (rainStrength <= 0.01 || this.descriptor.preset === 'quiet') {
      this.stopRainSource();
    }

    const bus = this.engine.getExteriorAmbientBus();
    if (!bus || !bus.pinkNoiseBuffer) {
      this.cancelAccentTimer();
      if (this.boundCtx) {
        const t = this.boundCtx.currentTime;
        this.windGain?.gain.setTargetAtTime(0, t, 0.1);
        this.rainGain?.gain.setTargetAtTime(0, t, 0.1);
        this.bedGain?.gain.setTargetAtTime(0, t, 0.1);
        for (const stem of this.customStems.values()) {
          stem.gain?.gain.setTargetAtTime(0, t, 0.1);
        }
      }
      return;
    }

    const { ctx, exteriorInput, pinkNoiseBuffer } = bus;
    const now = ctx.currentTime;

    if (!this.windSource || this.boundCtx !== ctx) {
      this.teardownNodes();
      try {
        const masterGain = ctx.createGain();
        masterGain.gain.value = this.descriptor.gain;
        masterGain.connect(exteriorInput);

        const wSrc = ctx.createBufferSource();
        wSrc.buffer = pinkNoiseBuffer;
        wSrc.loop = true;

        const wFilter = ctx.createBiquadFilter();
        wFilter.type = 'lowpass';
        wFilter.frequency.value = 260;
        wFilter.Q.value = 0.7;

        const wGain = ctx.createGain();
        wGain.gain.value = 0.0;

        wSrc.connect(wFilter);
        wFilter.connect(wGain);
        wGain.connect(masterGain);
        wSrc.start(now);

        // Native 0 Hz-safe Web Audio LFOs for wind gusts (`0.07 Hz` & `0.03 Hz`)
        const wLfo1 = ctx.createOscillator();
        wLfo1.type = 'sine';
        wLfo1.frequency.value = 0.07;
        const wLfo1Gain = ctx.createGain();
        wLfo1Gain.gain.value = 0;
        wLfo1.connect(wLfo1Gain);
        wLfo1Gain.connect(wFilter.frequency);
        wLfo1.start(now);

        const wLfo2 = ctx.createOscillator();
        wLfo2.type = 'sine';
        wLfo2.frequency.value = 0.03;
        const wLfo2Gain = ctx.createGain();
        wLfo2Gain.gain.value = 0;
        wLfo2.connect(wLfo2Gain);
        wLfo2Gain.connect(wFilter.frequency);
        wLfo2.start(now);

        // Rain filter & gain chain (`rainSource` is started on-demand only when `rainIntensity > 0.01`)
        const rFilter = ctx.createBiquadFilter();
        rFilter.type = 'bandpass';
        rFilter.frequency.value = 1150;
        rFilter.Q.value = 0.65;

        const rGain = ctx.createGain();
        rGain.gain.value = 0.0;

        rFilter.connect(rGain);
        rGain.connect(masterGain);

        const bSrc = ctx.createBufferSource();
        bSrc.buffer = pinkNoiseBuffer;
        bSrc.loop = true;
        bSrc.playbackRate.value = 0.78;

        const bFilter = ctx.createBiquadFilter();
        bFilter.type = 'lowpass';
        bFilter.frequency.value = 220;
        bFilter.Q.value = 0.85;

        const bGain = ctx.createGain();
        bGain.gain.value = 0.0;

        bSrc.connect(bFilter);
        bFilter.connect(bGain);
        bGain.connect(masterGain);
        bSrc.start(now);

        // Native 0 Hz-safe Web Audio LFO (`0.11 Hz`) for coastal / hills-city / urban bed modulation
        const bLfo = ctx.createOscillator();
        bLfo.type = 'sine';
        bLfo.frequency.value = 0.11;
        const bLfoGain = ctx.createGain();
        bLfoGain.gain.value = 0;
        bLfo.connect(bLfoGain);
        bLfoGain.connect(bFilter.frequency);
        bLfo.start(now);

        this.soundscapeMasterGain = masterGain;
        this.windSource = wSrc;
        this.windFilter = wFilter;
        this.windGain = wGain;
        this.windLfo1 = wLfo1;
        this.windLfo1Gain = wLfo1Gain;
        this.windLfo2 = wLfo2;
        this.windLfo2Gain = wLfo2Gain;
        this.rainSource = null;
        this.rainFilter = rFilter;
        this.rainGain = rGain;
        this.bedSource = bSrc;
        this.bedFilter = bFilter;
        this.bedGain = bGain;
        this.bedLfo = bLfo;
        this.bedLfoGain = bLfoGain;
        this.boundCtx = ctx;
      } catch {
        return;
      }
    }

    if (this.soundscapeMasterGain) {
      this.soundscapeMasterGain.gain.setTargetAtTime(this.descriptor.gain, now, 0.15);
    }

    const weights = computeTimeOfDayStemWeights(timeOfDay);
    const windNorm = Math.max(0, Math.min(2.2, weather.windSpeedKph / 24.0));
    const snowStrength = Math.max(0, Math.min(1, weather.snowIntensity));
    const snowHush = 1.0 - snowStrength * 0.28;

    this.syncCustomStems(ctx, now, weights, windNorm, rainStrength);

    const hasWindStem = this.customStems.get('wind')?.status === 'ready';
    const hasRainStem = this.customStems.get('rain')?.status === 'ready';
    const hasTodStem =
      this.customStems.get('day')?.status === 'ready' ||
      this.customStems.get('dusk')?.status === 'ready' ||
      this.customStems.get('night')?.status === 'ready';

    const preset = this.descriptor.preset;
    const todBright = weights.day * 1.0 + weights.dusk * 0.55 + weights.night * 0.15;

    if (this.windFilter && this.windGain) {
      if (preset === 'quiet') {
        this.windFilter.frequency.setTargetAtTime(175, now, 0.35);
        this.windLfo1Gain?.gain.setTargetAtTime(0, now, 0.25);
        this.windLfo2Gain?.gain.setTargetAtTime(0, now, 0.25);
        this.windGain.gain.setTargetAtTime(hasWindStem ? 0 : 0.003, now, 0.35);
      } else {
        const baseCutByPreset =
          preset === 'coastal'
            ? 280 + todBright * 170 + windNorm * 240
            : preset === 'urban'
              ? 230 + todBright * 140 + windNorm * 180
              : preset === 'hills-city'
                ? 215 + todBright * 125 + windNorm * 185
                : 210 + todBright * 150 + windNorm * 210;
        const gustDepth = (preset === 'coastal' ? 60 : 45) + windNorm * 75;
        const targetBaseFreq = Math.max(85, baseCutByPreset);

        const baseWindGain =
          weights.day * 0.05 + weights.dusk * 0.04 + weights.night * 0.032;
        const presetWindScale =
          preset === 'coastal'
            ? 1.1
            : preset === 'urban'
              ? 0.72
              : preset === 'hills-city'
                ? 0.8
                : 1.0;
        const stemDuck = hasWindStem ? 0.12 : 1.0;
        const targetWindGain =
          (baseWindGain + windNorm * 0.045) * presetWindScale * snowHush * stemDuck;

        this.windFilter.frequency.setTargetAtTime(targetBaseFreq, now, 0.25);
        this.windLfo1Gain?.gain.setTargetAtTime(gustDepth, now, 0.25);
        this.windLfo2Gain?.gain.setTargetAtTime(gustDepth * 0.6, now, 0.25);
        this.windGain.gain.setTargetAtTime(targetWindGain, now, 0.35);
      }
    }

    if (this.bedFilter && this.bedGain) {
      const todDuck = hasTodStem ? 0.15 : 1.0;
      if (preset === 'coastal') {
        const swellBaseCut = 440 + windNorm * 95;
        const swellGain = 0.058 * snowHush * todDuck;
        this.bedFilter.type = 'lowpass';
        this.bedFilter.Q.setTargetAtTime(0.75, now, 0.25);
        this.bedFilter.frequency.setTargetAtTime(swellBaseCut, now, 0.28);
        this.bedLfoGain?.gain.setTargetAtTime(220, now, 0.28);
        this.bedGain.gain.setTargetAtTime(swellGain, now, 0.28);
      } else if (preset === 'hills-city') {
        const humFreq = 115 + weights.day * 22 + weights.dusk * 12;
        const humGain = (0.032 + weights.day * 0.014 + weights.dusk * 0.012) * todDuck;
        this.bedFilter.type = 'bandpass';
        this.bedFilter.Q.setTargetAtTime(1.15, now, 0.3);
        this.bedFilter.frequency.setTargetAtTime(humFreq, now, 0.35);
        this.bedLfoGain?.gain.setTargetAtTime(12, now, 0.35);
        this.bedGain.gain.setTargetAtTime(humGain, now, 0.35);
      } else if (preset === 'urban') {
        const cityFreq = 175 + weights.day * 85 + weights.dusk * 55;
        const cityGain =
          (0.022 + weights.day * 0.03 + weights.dusk * 0.022) * 0.88 * snowHush * todDuck;
        this.bedFilter.type = 'bandpass';
        this.bedFilter.Q.setTargetAtTime(0.7, now, 0.3);
        this.bedFilter.frequency.setTargetAtTime(cityFreq, now, 0.35);
        this.bedLfoGain?.gain.setTargetAtTime(28, now, 0.35);
        this.bedGain.gain.setTargetAtTime(cityGain, now, 0.35);
      } else {
        this.bedLfoGain?.gain.setTargetAtTime(0, now, 0.25);
        this.bedGain.gain.setTargetAtTime(0, now, 0.25);
      }
    }

    if (this.rainFilter && this.rainGain) {
      if (preset !== 'quiet' && rainStrength > 0.01 && !hasRainStem) {
        if (!this.rainSource) {
          const rSrc = ctx.createBufferSource();
          rSrc.buffer = pinkNoiseBuffer;
          rSrc.loop = true;
          rSrc.playbackRate.value = 1.35;
          rSrc.connect(this.rainFilter);
          rSrc.start(now);
          this.rainSource = rSrc;
        }
        const patterFreq = 1180 + rainStrength * 520;
        const targetRainGain = 0.025 + rainStrength * 0.095;
        this.rainFilter.frequency.setTargetAtTime(patterFreq, now, 0.22);
        this.rainFilter.Q.setTargetAtTime(0.6, now, 0.22);
        this.rainGain.gain.setTargetAtTime(targetRainGain, now, 0.3);
      } else {
        this.rainGain.gain.setTargetAtTime(0, now, 0.15);
        this.stopRainSource();
      }
    }

    this.syncAccentTimer();
  }

  public dispose(): void {
    this.disposed = true;
    this.cancelAccentTimer();
    this.unsubscribeEngine();
    this.stemEpoch += 1;
    this.stopAllCustomStems();
    this.teardownNodes();
  }

  private isDocumentHidden(): boolean {
    return typeof document !== 'undefined' && Boolean(document.hidden);
  }

  private computePrecipMute(): number {
    const rainStrength = Math.max(0, Math.min(1, this.lastWeather.rainIntensity));
    const snowStrength = Math.max(0, Math.min(1, this.lastWeather.snowIntensity));
    return Math.max(0, 1.0 - Math.max(rainStrength * 1.45, snowStrength * 1.25));
  }

  private hasReadyTodStem(): boolean {
    return (
      this.customStems.get('day')?.status === 'ready' ||
      this.customStems.get('dusk')?.status === 'ready' ||
      this.customStems.get('night')?.status === 'ready'
    );
  }

  private shouldRunAccentTimer(): boolean {
    if (this.disposed) return false;
    if (this.isDocumentHidden()) return false;
    if (this.engine.isMuted() || !this.engine.isAmbientEnabled()) return false;
    const bus = this.engine.getExteriorAmbientBus();
    if (!bus || !this.soundscapeMasterGain || this.boundCtx !== bus.ctx) return false;
    const preset = this.descriptor.preset;
    if (preset === 'quiet' || preset === 'urban') return false;
    if (this.hasReadyTodStem()) return false;
    if (this.computePrecipMute() <= 0.05) return false;
    return true;
  }

  private cancelAccentTimer(): void {
    if (this.accentTimer !== null) {
      clearTimeout(this.accentTimer);
      this.accentTimer = null;
    }
  }

  private syncAccentTimer(): void {
    if (!this.shouldRunAccentTimer()) {
      this.cancelAccentTimer();
      return;
    }
    if (this.accentTimer === null) {
      this.scheduleNextAccent(1.8);
    }
  }

  private scheduleNextAccent(delaySec: number): void {
    this.cancelAccentTimer();
    if (!this.shouldRunAccentTimer()) return;

    const delayMs = Math.max(250, Math.round(delaySec * 1000));
    const timer = setTimeout(() => {
      this.accentTimer = null;
      this.fireAccentAndReschedule();
    }, delayMs);
    (timer as unknown as { unref?: () => void })?.unref?.();
    this.accentTimer = timer;
  }

  private fireAccentAndReschedule(): void {
    if (!this.shouldRunAccentTimer()) {
      this.cancelAccentTimer();
      return;
    }

    const bus = this.engine.getExteriorAmbientBus();
    const eventDest = this.soundscapeMasterGain;
    if (!bus || !eventDest) {
      this.cancelAccentTimer();
      return;
    }

    const { ctx } = bus;
    const weights = computeTimeOfDayStemWeights(this.lastTimeOfDay);
    const preset = this.descriptor.preset;
    const precipMute = this.computePrecipMute();
    const dayActivity = weights.day + weights.dusk * 0.65;
    const nightActivity = weights.night + weights.dusk * 0.45;
    const outdoorScale = 0.85 * precipMute;

    let nextDelaySec: number;
    if (preset === 'coastal') {
      if (dayActivity >= nightActivity) {
        this.playGullCall(ctx, eventDest, outdoorScale * dayActivity * 0.72);
        nextDelaySec = 3.8 + Math.random() * 5.2;
      } else {
        nextDelaySec = 3.0 + Math.random() * 3.0;
      }
    } else if (preset === 'hills-city') {
      if (nightActivity > 0.35) {
        this.playNightCricket(ctx, eventDest, outdoorScale * nightActivity * 0.62);
        nextDelaySec = 1.8 + Math.random() * 3.2;
      } else {
        this.playBirdChirp(ctx, eventDest, outdoorScale * dayActivity * 0.45);
        nextDelaySec = 4.5 + Math.random() * 5.5;
      }
    } else {
      if (dayActivity >= nightActivity) {
        this.playBirdChirp(ctx, eventDest, outdoorScale * dayActivity);
        nextDelaySec =
          (weights.day > 0.5 ? 2.2 : 3.8) + Math.random() * (weights.day > 0.5 ? 3.5 : 5.2);
      } else {
        this.playNightCricket(ctx, eventDest, outdoorScale * nightActivity * 0.7);
        nextDelaySec = 1.4 + Math.random() * 2.8;
      }
    }

    this.scheduleNextAccent(nextDelaySec);
  }

  private stopRainSource(): void {
    if (!this.rainSource) return;
    const src = this.rainSource;
    this.rainSource = null;
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

  private teardownNodes(): void {
    this.cancelAccentTimer();
    this.stopRainSource();

    for (const src of [
      this.windSource,
      this.bedSource,
      this.windLfo1,
      this.windLfo2,
      this.bedLfo,
    ]) {
      try {
        src?.stop();
      } catch {
        // Ignore already stopped sources
      }
      try {
        src?.disconnect();
      } catch {
        // Ignore
      }
    }
    for (const node of [
      this.windLfo1Gain,
      this.windLfo2Gain,
      this.bedLfoGain,
      this.windFilter,
      this.windGain,
      this.rainFilter,
      this.rainGain,
      this.bedFilter,
      this.bedGain,
      this.soundscapeMasterGain,
    ]) {
      try {
        node?.disconnect();
      } catch {
        // Ignore
      }
    }
    this.windSource = null;
    this.windFilter = null;
    this.windGain = null;
    this.windLfo1 = null;
    this.windLfo1Gain = null;
    this.windLfo2 = null;
    this.windLfo2Gain = null;
    this.rainFilter = null;
    this.rainGain = null;
    this.bedSource = null;
    this.bedFilter = null;
    this.bedGain = null;
    this.bedLfo = null;
    this.bedLfoGain = null;
    this.soundscapeMasterGain = null;
    this.boundCtx = null;
  }

  private desiredStemUrl(slot: StemSlot): string | undefined {
    switch (slot) {
      case 'day':
        return this.descriptor.dayUrl;
      case 'dusk':
        return this.descriptor.duskUrl;
      case 'night':
        return this.descriptor.nightUrl;
      case 'wind':
        return this.descriptor.windUrl;
      case 'rain':
        return this.descriptor.rainUrl;
    }
  }

  private stopStemRuntime(runtime: CustomStemRuntime): void {
    try {
      runtime.source?.stop();
    } catch {
      // Ignore already stopped source
    }
    try {
      runtime.source?.disconnect();
    } catch {
      // Ignore
    }
    for (const node of runtime.routingNodes) {
      try {
        node.disconnect();
      } catch {
        // Ignore
      }
    }
    try {
      runtime.gain?.disconnect();
    } catch {
      // Ignore
    }
  }

  private stopAllCustomStems(): void {
    for (const runtime of this.customStems.values()) {
      this.stopStemRuntime(runtime);
    }
    this.customStems.clear();
  }

  private stopRemovedOrChangedStems(): void {
    const slots: readonly StemSlot[] = ['day', 'dusk', 'night', 'wind', 'rain'];
    for (const slot of slots) {
      const existing = this.customStems.get(slot);
      if (!existing) continue;
      const desiredUrl = this.desiredStemUrl(slot);
      if (existing.url !== desiredUrl || existing.layout !== this.descriptor.channelLayout) {
        this.stopStemRuntime(existing);
        this.customStems.delete(slot);
      }
    }
  }

  private syncCustomStems(
    ctx: AudioContext,
    now: number,
    weights: TimeOfDayStemWeights,
    windNorm: number,
    rainStrength: number
  ): void {
    if (!this.soundscapeMasterGain) return;
    const slots: readonly StemSlot[] = ['day', 'dusk', 'night', 'wind', 'rain'];

    for (const slot of slots) {
      const url = this.desiredStemUrl(slot);
      const existing = this.customStems.get(slot);
      if (!url) {
        if (existing) {
          this.stopStemRuntime(existing);
          this.customStems.delete(slot);
        }
        continue;
      }

      if (!existing || existing.url !== url || existing.layout !== this.descriptor.channelLayout) {
        if (existing) {
          this.stopStemRuntime(existing);
        }
        const runtime: CustomStemRuntime = {
          url,
          layout: this.descriptor.channelLayout,
          status: 'loading',
          source: null,
          gain: null,
          routingNodes: [],
        };
        this.customStems.set(slot, runtime);
        this.loadCustomStem(ctx, slot, runtime, this.stemEpoch);
      }
    }

    const hasDuskStem = Boolean(this.descriptor.duskUrl);
    const dayWeight = hasDuskStem ? weights.day : weights.day + weights.dusk * 0.5;
    const nightWeight = hasDuskStem ? weights.night : weights.night + weights.dusk * 0.5;
    const duskWeight = hasDuskStem ? weights.dusk : 0;

    const targetGains: Record<StemSlot, number> = {
      day: dayWeight * 0.38,
      dusk: duskWeight * 0.38,
      night: nightWeight * 0.38,
      wind: Math.min(0.6, 0.08 + windNorm * 0.24),
      rain: rainStrength > 0.01 ? 0.06 + rainStrength * 0.34 : 0,
    };

    for (const slot of slots) {
      const runtime = this.customStems.get(slot);
      if (runtime?.status === 'ready' && runtime.gain) {
        runtime.gain.gain.setTargetAtTime(targetGains[slot], now, 0.35);
      }
    }
  }

  private loadCustomStem(
    ctx: AudioContext,
    slot: StemSlot,
    runtime: CustomStemRuntime,
    epoch: number
  ): void {
    if (typeof fetch !== 'function') {
      runtime.status = 'error';
      return;
    }

    fetch(runtime.url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      .then((buf) => ctx.decodeAudioData(buf))
      .then((decoded) => {
        if (
          this.disposed ||
          epoch !== this.stemEpoch ||
          this.customStems.get(slot) !== runtime ||
          this.boundCtx !== ctx ||
          !this.soundscapeMasterGain
        ) {
          return;
        }

        const src = ctx.createBufferSource();
        src.buffer = decoded;
        src.loop = true;

        const gain = ctx.createGain();
        gain.gain.value = 0.0;

        const routingNodes = this.connectStemWithLayout(
          ctx,
          src,
          gain,
          runtime.layout,
          decoded.numberOfChannels
        );
        gain.connect(this.soundscapeMasterGain);
        src.start(ctx.currentTime);

        runtime.source = src;
        runtime.gain = gain;
        runtime.routingNodes = routingNodes;
        runtime.status = 'ready';

        if (slot === 'rain') {
          this.stopRainSource();
        }
        this.syncAccentTimer();
      })
      .catch(() => {
        runtime.status = 'error';
      });
  }

  private connectStemWithLayout(
    ctx: AudioContext,
    src: AudioBufferSourceNode,
    dest: GainNode,
    layout: SoundscapeChannelLayout,
    channels: number
  ): AudioNode[] {
    if (
      layout === 'foa' &&
      channels >= 4 &&
      typeof ctx.createChannelSplitter === 'function' &&
      typeof ctx.createChannelMerger === 'function'
    ) {
      // First-Order Ambisonics (ACN/SN3D W, Y, Z, X) -> stereo virtual cardioid pair
      const splitter = ctx.createChannelSplitter(4);
      const merger = ctx.createChannelMerger(2);
      const wGain = ctx.createGain();
      wGain.gain.value = 0.707;
      const yLeftGain = ctx.createGain();
      yLeftGain.gain.value = 0.5;
      const yRightGain = ctx.createGain();
      yRightGain.gain.value = -0.5;

      src.connect(splitter);
      splitter.connect(wGain, 0);
      splitter.connect(yLeftGain, 1);
      splitter.connect(yRightGain, 1);

      wGain.connect(merger, 0, 0);
      wGain.connect(merger, 0, 1);
      yLeftGain.connect(merger, 0, 0);
      yRightGain.connect(merger, 0, 1);
      merger.connect(dest);
      return [splitter, wGain, yLeftGain, yRightGain, merger];
    }

    if (
      layout === 'quad' &&
      channels >= 4 &&
      typeof ctx.createChannelSplitter === 'function' &&
      typeof ctx.createChannelMerger === 'function'
    ) {
      // 4-channel quad (FL, FR, RL, RR) -> balanced stereo fold-down
      const splitter = ctx.createChannelSplitter(4);
      const merger = ctx.createChannelMerger(2);
      const rearLeft = ctx.createGain();
      rearLeft.gain.value = 0.707;
      const rearRight = ctx.createGain();
      rearRight.gain.value = 0.707;

      src.connect(splitter);
      splitter.connect(merger, 0, 0);
      splitter.connect(merger, 1, 1);
      splitter.connect(rearLeft, 2);
      splitter.connect(rearRight, 3);
      rearLeft.connect(merger, 0, 0);
      rearRight.connect(merger, 0, 1);
      merger.connect(dest);
      return [splitter, rearLeft, rearRight, merger];
    }

    if (
      layout === 'dual-mono' &&
      channels === 1 &&
      typeof ctx.createChannelMerger === 'function'
    ) {
      const merger = ctx.createChannelMerger(2);
      src.connect(merger, 0, 0);
      src.connect(merger, 0, 1);
      merger.connect(dest);
      return [merger];
    }

    src.connect(dest);
    return [];
  }

  private playBirdChirp(ctx: AudioContext, dest: AudioNode, scale: number): void {
    if (scale <= 0.02) return;
    const now = ctx.currentTime;
    const notes = 2 + Math.floor(Math.random() * 3);
    const baseFreq = 2200 + Math.random() * 1400;

    let panNode: AudioNode = dest;
    let ownedPanner: AudioNode | null = null;
    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime((Math.random() * 2 - 1) * 0.75, now);
      panner.connect(dest);
      panNode = panner;
      ownedPanner = panner;
    }

    for (let i = 0; i < notes; i++) {
      const isLast = i === notes - 1;
      const t0 = now + i * (0.085 + Math.random() * 0.04);
      const dur = 0.055 + Math.random() * 0.035;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const fStart = baseFreq * (1 + (Math.random() - 0.5) * 0.18);
      const fEnd = fStart * (1.12 + (Math.random() - 0.4) * 0.22);
      osc.frequency.setValueAtTime(fStart, t0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(400, fEnd), t0 + dur);

      const peak = 0.014 * scale;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(peak, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      osc.connect(gain);
      gain.connect(panNode);
      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
          if (isLast) ownedPanner?.disconnect();
        } catch {
          // Ignore
        }
      };
      osc.start(t0);
      osc.stop(t0 + dur + 0.01);
    }
  }

  private playGullCall(ctx: AudioContext, dest: AudioNode, scale: number): void {
    if (scale <= 0.02) return;
    const now = ctx.currentTime;
    const cries = 2 + Math.floor(Math.random() * 2);

    let panNode: AudioNode = dest;
    let ownedPanner: AudioNode | null = null;
    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime((Math.random() * 2 - 1) * 0.85, now);
      panner.connect(dest);
      panNode = panner;
      ownedPanner = panner;
    }

    for (let i = 0; i < cries; i++) {
      const isLast = i === cries - 1;
      const t0 = now + i * (0.28 + Math.random() * 0.08);
      const dur = 0.21 + Math.random() * 0.07;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const fStart = 1150 + Math.random() * 260;
      const fPeak = fStart * 1.18;
      const fEnd = fStart * 0.68;
      osc.frequency.setValueAtTime(fStart, t0);
      osc.frequency.exponentialRampToValueAtTime(fPeak, t0 + dur * 0.28);
      osc.frequency.exponentialRampToValueAtTime(fEnd, t0 + dur);

      const peak = 0.012 * scale;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(peak, t0 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      osc.connect(gain);
      gain.connect(panNode);
      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
          if (isLast) ownedPanner?.disconnect();
        } catch {
          // Ignore
        }
      };
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }
  }

  private playNightCricket(ctx: AudioContext, dest: AudioNode, scale: number): void {
    if (scale <= 0.02) return;
    const now = ctx.currentTime;
    const pulses = 3 + Math.floor(Math.random() * 2);
    const carrierFreq = 4150 + (Math.random() - 0.5) * 180;

    let panNode: AudioNode = dest;
    let ownedPanner: AudioNode | null = null;
    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime((Math.random() * 2 - 1) * 0.8, now);
      panner.connect(dest);
      panNode = panner;
      ownedPanner = panner;
    }

    for (let i = 0; i < pulses; i++) {
      const isLast = i === pulses - 1;
      const t0 = now + i * 0.042;
      const dur = 0.026;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(carrierFreq, t0);

      const peak = 0.009 * scale;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(peak, t0 + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      osc.connect(gain);
      gain.connect(panNode);
      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
          if (isLast) ownedPanner?.disconnect();
        } catch {
          // Ignore
        }
      };
      osc.start(t0);
      osc.stop(t0 + dur + 0.005);
    }
  }
}

export { SoundscapeController as AmbientSoundscape };
