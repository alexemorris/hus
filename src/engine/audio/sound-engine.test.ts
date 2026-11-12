import { afterEach, describe, expect, it } from 'vitest';
import {
  classifyFloorSurface,
  playWalkthroughFootstep,
  playWalkthroughJump,
  playWalkthroughLand,
} from '../walkthrough/parts/walkthrough-footstep-audio.ts';
import { AudioEngine, SoundEngine } from './sound-engine.ts';
import { SoundscapeController } from './soundscape-controller.ts';

interface MockAudioParam {
  value: number;
  readonly kind: 'AudioParam';
  owner?: MockNode;
  paramName?: string;
  setValueAtTime(v: number, _t: number): void;
  setTargetAtTime(v: number, _t: number, _tc: number): void;
  linearRampToValueAtTime(v: number, _t: number): void;
  exponentialRampToValueAtTime(v: number, _t: number): void;
}

function createMockAudioParam(
  initialValue: number,
  owner?: MockNode,
  paramName?: string
): MockAudioParam {
  const param: MockAudioParam = {
    value: initialValue,
    kind: 'AudioParam',
    ...(owner ? { owner } : {}),
    ...(paramName ? { paramName } : {}),
    setValueAtTime(v: number) {
      param.value = v;
    },
    setTargetAtTime(v: number) {
      param.value = v;
    },
    linearRampToValueAtTime(v: number) {
      param.value = v;
    },
    exponentialRampToValueAtTime(v: number) {
      param.value = v;
    },
  };
  return param;
}

class MockNode {
  public readonly kind: string;
  public readonly connectedTargets = new Set<MockNode | MockAudioParam>();
  public readonly incomingSources = new Set<MockNode>();
  public disconnectCount = 0;

  public constructor(kind: string) {
    this.kind = kind;
  }

  public connect(target: MockNode | MockAudioParam): MockNode | undefined {
    this.connectedTargets.add(target);
    if (target instanceof MockNode) {
      target.incomingSources.add(this);
      return target;
    }
    return undefined;
  }

  public disconnect(target?: MockNode | MockAudioParam): void {
    this.disconnectCount += 1;
    if (target !== undefined) {
      this.connectedTargets.delete(target);
      if (target instanceof MockNode) {
        target.incomingSources.delete(this);
      }
      return;
    }
    for (const t of this.connectedTargets) {
      if (t instanceof MockNode) {
        t.incomingSources.delete(this);
      }
    }
    this.connectedTargets.clear();
  }
}

class MockGainNode extends MockNode {
  public readonly gain: MockAudioParam;
  public constructor() {
    super('GainNode');
    this.gain = createMockAudioParam(1, this, 'gain');
  }
}

class MockBiquadFilterNode extends MockNode {
  public type: BiquadFilterType = 'lowpass';
  public readonly frequency: MockAudioParam;
  public readonly Q: MockAudioParam;
  public readonly gain: MockAudioParam;

  public constructor() {
    super('BiquadFilterNode');
    this.frequency = createMockAudioParam(350, this, 'frequency');
    this.Q = createMockAudioParam(1, this, 'Q');
    this.gain = createMockAudioParam(0, this, 'gain');
  }
}

class MockOscillatorNode extends MockNode {
  public type: OscillatorType = 'sine';
  public readonly frequency: MockAudioParam;
  public startedAt: number | null = null;
  public stoppedAt: number | null = null;
  public stopped = false;
  public onended: (() => void) | null = null;

  public constructor() {
    super('OscillatorNode');
    this.frequency = createMockAudioParam(440, this, 'frequency');
  }

  public start(when = 0): void {
    this.startedAt = when;
  }

  public stop(when = 0): void {
    this.stoppedAt = when;
    this.stopped = true;
  }
}

class MockBufferSourceNode extends MockNode {
  public buffer: unknown = null;
  public loop = false;
  public readonly playbackRate: MockAudioParam;
  public startedAt: number | null = null;
  public stoppedAt: number | null = null;
  public stopped = false;
  public onended: (() => void) | null = null;

  public constructor() {
    super('AudioBufferSourceNode');
    this.playbackRate = createMockAudioParam(1, this, 'playbackRate');
  }

  public start(when = 0): void {
    this.startedAt = when;
  }

  public stop(when = 0): void {
    this.stoppedAt = when;
    this.stopped = true;
  }
}

class MockPannerNode extends MockNode {
  public panningModel: PanningModelType = 'HRTF';
  public distanceModel: DistanceModelType = 'inverse';
  public refDistance = 1;
  public maxDistance = 10000;
  public rolloffFactor = 1;
  public readonly positionX = createMockAudioParam(0, this, 'positionX');
  public readonly positionY = createMockAudioParam(0, this, 'positionY');
  public readonly positionZ = createMockAudioParam(0, this, 'positionZ');

  public constructor() {
    super('PannerNode');
  }
}

class MockConvolverNode extends MockNode {
  public buffer: unknown = null;
  public constructor() {
    super('ConvolverNode');
  }
}

class MockAudioContext {
  public static instances: MockAudioContext[] = [];
  public static initialState: AudioContextState = 'running';

  public state: AudioContextState = MockAudioContext.initialState;
  public currentTime = 0;
  public readonly sampleRate = 48000;
  public readonly destination = new MockNode('AudioDestinationNode');
  public readonly listener = {
    positionX: createMockAudioParam(0),
    positionY: createMockAudioParam(0),
    positionZ: createMockAudioParam(0),
    forwardX: createMockAudioParam(0),
    forwardY: createMockAudioParam(0),
    forwardZ: createMockAudioParam(-1),
    upX: createMockAudioParam(0),
    upY: createMockAudioParam(1),
    upZ: createMockAudioParam(0),
  };

  public suspendCalls = 0;
  public resumeCalls = 0;
  public closeCalls = 0;

  public readonly gains: MockGainNode[] = [];
  public readonly filters: MockBiquadFilterNode[] = [];
  public readonly oscillators: MockOscillatorNode[] = [];
  public readonly bufferSources: MockBufferSourceNode[] = [];
  public readonly panners: MockPannerNode[] = [];
  public readonly convolvers: MockConvolverNode[] = [];

  public constructor() {
    MockAudioContext.instances.push(this);
  }

  public createGain(): GainNode {
    const node = new MockGainNode();
    this.gains.push(node);
    return node as unknown as GainNode;
  }

  public createBiquadFilter(): BiquadFilterNode {
    const node = new MockBiquadFilterNode();
    this.filters.push(node);
    return node as unknown as BiquadFilterNode;
  }

  public createOscillator(): OscillatorNode {
    const node = new MockOscillatorNode();
    this.oscillators.push(node);
    return node as unknown as OscillatorNode;
  }

  public createBufferSource(): AudioBufferSourceNode {
    const node = new MockBufferSourceNode();
    this.bufferSources.push(node);
    return node as unknown as AudioBufferSourceNode;
  }

  public createPanner(): PannerNode {
    const node = new MockPannerNode();
    this.panners.push(node);
    return node as unknown as PannerNode;
  }

  public createConvolver(): ConvolverNode {
    const node = new MockConvolverNode();
    this.convolvers.push(node);
    return node as unknown as ConvolverNode;
  }

  public createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
    const channelArrays = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: (ch: number) => channelArrays[ch]!,
    } as unknown as AudioBuffer;
  }

  public suspend(): Promise<void> {
    this.suspendCalls += 1;
    this.state = 'suspended';
    return Promise.resolve();
  }

  public resume(): Promise<void> {
    this.resumeCalls += 1;
    this.state = 'running';
    return Promise.resolve();
  }

  public close(): Promise<void> {
    this.closeCalls += 1;
    this.state = 'closed';
    return Promise.resolve();
  }
}

interface MockBrowserHarness {
  readonly storage: Map<string, string>;
  setDocumentHidden(hidden: boolean): void;
  dispatchWindow(type: string): void;
  dispatchDocument(type: string): void;
  teardown(): void;
}

function installMockBrowserEnvironment(
  initialState: AudioContextState = 'running'
): MockBrowserHarness {
  MockAudioContext.instances = [];
  MockAudioContext.initialState = initialState;

  const winListeners = new Map<string, Set<() => void>>();
  const docListeners = new Map<string, Set<() => void>>();
  const storage = new Map<string, string>();
  let docHidden = false;

  const mockWindow = {
    AudioContext: MockAudioContext,
    addEventListener(type: string, fn: () => void) {
      let set = winListeners.get(type);
      if (!set) {
        set = new Set();
        winListeners.set(type, set);
      }
      set.add(fn);
    },
    removeEventListener(type: string, fn: () => void) {
      winListeners.get(type)?.delete(fn);
    },
  };

  const mockDocument = {
    get hidden() {
      return docHidden;
    },
    addEventListener(type: string, fn: () => void) {
      let set = docListeners.get(type);
      if (!set) {
        set = new Set();
        docListeners.set(type, set);
      }
      set.add(fn);
    },
    removeEventListener(type: string, fn: () => void) {
      docListeners.get(type)?.delete(fn);
    },
  };

  const mockLocalStorage = {
    getItem(key: string) {
      return storage.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      storage.set(key, value);
    },
    removeItem(key: string) {
      storage.delete(key);
    },
    clear() {
      storage.clear();
    },
  };

  const g = globalThis as Record<string, unknown>;
  g.window = mockWindow;
  g.document = mockDocument;
  g.localStorage = mockLocalStorage;

  return {
    storage,
    setDocumentHidden(hidden: boolean) {
      docHidden = hidden;
    },
    dispatchWindow(type: string) {
      for (const fn of [...(winListeners.get(type) ?? [])]) {
        fn();
      }
    },
    dispatchDocument(type: string) {
      for (const fn of [...(docListeners.get(type) ?? [])]) {
        fn();
      }
    },
    teardown() {
      delete g.window;
      delete g.document;
      delete g.localStorage;
      MockAudioContext.instances = [];
      MockAudioContext.initialState = 'running';
    },
  };
}

let activeHarness: MockBrowserHarness | null = null;
afterEach(() => {
  activeHarness?.teardown();
  activeHarness = null;
});

describe('sound-engine & soundscape-controller', () => {
  it('classifies floor surfaces with the house-agnostic fallback', () => {
    expect(classifyFloorSurface('anyRoom', 0, 0, 0, false)).toBe('wood');
    expect(classifyFloorSurface(null, 0, 0, 0, false)).toBe('turf');
    expect(classifyFloorSurface('anyRoom', 0, 0, 0, true)).toBe('ladder');
    expect(classifyFloorSurface(null, 0, 0, 0, true)).toBe('ladder');
  });

  it('manages mute, volume, ambient, and sfx state cleanly in headless environments', () => {
    const engine = new SoundEngine();
    expect(engine.isMuted()).toBe(false);
    expect(engine.getMasterVolume()).toBeCloseTo(0.75, 2);

    let notifications = 0;
    const unsub = engine.onChanged(() => {
      notifications += 1;
    });

    engine.setMuted(true);
    expect(engine.isMuted()).toBe(true);
    expect(engine.toggleMuted()).toBe(false);
    expect(engine.isMuted()).toBe(false);

    engine.setMasterVolume(0.45);
    expect(engine.getMasterVolume()).toBeCloseTo(0.45, 2);

    engine.setAmbientEnabled(false);
    expect(engine.isAmbientEnabled()).toBe(false);

    engine.setSfxEnabled(false);
    expect(engine.isSfxEnabled()).toBe(false);
    expect(notifications).toBeGreaterThanOrEqual(5);

    expect(() =>
      engine.playSpatial({ x: 0, y: 0, z: 0 }, (s) =>
        s.tone({
          startTime: s.now,
          duration: 0.1,
          type: 'sine',
          freqStart: 440,
          freqEnd: 220,
          gainPeak: 0.1,
        })
      )
    ).not.toThrow();
    expect(() =>
      engine.playDirect((s) =>
        s.noiseBurst({
          startTime: s.now,
          duration: 0.05,
          filterType: 'bandpass',
          freqStart: 1200,
          q: 2,
          gainPeak: 0.1,
        })
      )
    ).not.toThrow();
    expect(() => playWalkthroughFootstep('wood', { x: 0, y: 0, z: 0 }, false)).not.toThrow();
    expect(() => playWalkthroughJump({ x: 0, y: 0, z: 0 })).not.toThrow();
    expect(() => playWalkthroughLand('stone', { x: 0, y: 0, z: 0 })).not.toThrow();

    unsub();
    engine.dispose();
  });

  it('migrates legacy hus_legacy_sound_settings_v1 settings to hus_audio_settings_v1', () => {
    activeHarness = installMockBrowserEnvironment();
    activeHarness.storage.set(
      'hus_legacy_sound_settings_v1',
      JSON.stringify({
        muted: true,
        masterVolume: 0.42,
        ambientEnabled: false,
        sfxEnabled: true,
      })
    );

    const engine = new AudioEngine();
    expect(engine.isMuted()).toBe(true);
    expect(engine.getMasterVolume()).toBeCloseTo(0.42, 3);
    expect(engine.isAmbientEnabled()).toBe(false);
    expect(engine.isSfxEnabled()).toBe(true);

    engine.setMasterVolume(0.6);
    expect(activeHarness.storage.has('hus_audio_settings_v1')).toBe(true);
    const saved = JSON.parse(activeHarness.storage.get('hus_audio_settings_v1')!) as {
      masterVolume: number;
    };
    expect(saved.masterVolume).toBeCloseTo(0.6, 3);
    engine.dispose();
  });

  it('unlocks/resumes AudioContext on setMuted(false) and suspends AudioContext on setMuted(true)', () => {
    activeHarness = installMockBrowserEnvironment('suspended');
    activeHarness.storage.set(
      'hus_audio_settings_v1',
      JSON.stringify({
        muted: true,
        masterVolume: 0.8,
        ambientEnabled: true,
        sfxEnabled: true,
      })
    );

    const engine = new AudioEngine();
    expect(engine.isMuted()).toBe(true);
    expect(engine.hasUserGesture()).toBe(false);
    expect(MockAudioContext.instances).toHaveLength(0);

    // Unmuting acts as a user gesture: creates AudioContext and resumes it
    engine.setMuted(false);
    expect(engine.hasUserGesture()).toBe(true);
    expect(MockAudioContext.instances).toHaveLength(1);
    const ctx = MockAudioContext.instances[0]!;
    expect(ctx.resumeCalls).toBeGreaterThanOrEqual(1);
    expect(ctx.state).toBe('running');

    // Muting suspends the running AudioContext so 0 audio-thread CPU is used
    engine.setMuted(true);
    expect(ctx.suspendCalls).toBe(1);
    expect(ctx.state).toBe('suspended');

    // Unmuting again resumes the existing AudioContext
    engine.setMuted(false);
    expect(ctx.state).toBe('running');

    engine.dispose();
  });

  it('auto-suspends on visibilitychange (document.hidden) & pagehide and auto-resumes on focus when unmuted and unlocked', () => {
    activeHarness = installMockBrowserEnvironment('running');
    const engine = new AudioEngine();

    // Simulate user pointerdown gesture to unlock and create AudioContext
    activeHarness.dispatchWindow('pointerdown');
    expect(engine.hasUserGesture()).toBe(true);
    expect(MockAudioContext.instances).toHaveLength(1);
    const ctx = MockAudioContext.instances[0]!;
    expect(ctx.state).toBe('running');

    // Tab becomes hidden -> suspends
    activeHarness.setDocumentHidden(true);
    activeHarness.dispatchDocument('visibilitychange');
    expect(ctx.suspendCalls).toBe(1);
    expect(ctx.state).toBe('suspended');

    // Tab becomes visible again -> resumes because unmuted & userGestureUnlocked
    activeHarness.setDocumentHidden(false);
    activeHarness.dispatchDocument('visibilitychange');
    expect(ctx.resumeCalls).toBe(1);
    expect(ctx.state).toBe('running');

    // pagehide -> suspends; pageshow -> resumes
    activeHarness.dispatchWindow('pagehide');
    expect(ctx.suspendCalls).toBe(2);
    expect(ctx.state).toBe('suspended');

    activeHarness.dispatchWindow('pageshow');
    expect(ctx.resumeCalls).toBe(2);
    expect(ctx.state).toBe('running');

    // If muted while hidden, returning to visible does NOT resume
    engine.setMuted(true);
    expect(ctx.state).toBe('suspended');
    activeHarness.setDocumentHidden(true);
    activeHarness.dispatchDocument('visibilitychange');
    activeHarness.setDocumentHidden(false);
    activeHarness.dispatchDocument('visibilitychange');
    expect(ctx.state).toBe('suspended');

    engine.dispose();
  });

  it('disconnects PannerNode and GainNodes on maxEndTime onended in playSpatial while routing playUi dry without PannerNode or ConvolverNode', () => {
    activeHarness = installMockBrowserEnvironment('running');
    const engine = new AudioEngine();
    engine.ensureContext();
    const ctx = MockAudioContext.instances[0]!;

    // Locate engine bus nodes created during ensureContext()
    const sfxGain = ctx.gains[1]!;
    const reverbConvolver = ctx.convolvers[0]!;
    const baselinePannerCount = ctx.panners.length;
    const baselineGainCount = ctx.gains.length;

    // 1. Dry 2D UI click via playUi: zero PannerNode, zero ConvolverNode wet send
    engine.playUi(
      (tk) => {
        tk.tone({
          startTime: tk.now,
          duration: 0.04,
          type: 'sine',
          freqStart: 880,
          gainPeak: 0.2,
        });
      },
      { gain: 0.5 }
    );

    expect(ctx.panners).toHaveLength(baselinePannerCount);
    expect(reverbConvolver.incomingSources.size).toBe(0);
    expect(sfxGain.incomingSources.size).toBe(2); // reverbGain + UI voice inputGain

    const uiOsc = ctx.oscillators[ctx.oscillators.length - 1]!;
    uiOsc.onended?.();
    // Temporary UI inputGain disconnected from sfxGain (only persistent reverbGain remains)
    expect(sfxGain.incomingSources.size).toBe(1);

    // 2. Spatial 3D foley with multiple overlapping sources: disconnects voice only after maxEndTime source ends
    const oscStartIdx = ctx.oscillators.length;
    const bufSrcStartIdx = ctx.bufferSources.length;

    engine.playSpatial(
      { x: 2, y: 1.2, z: -3 },
      (tk) => {
        // Short burst ending around t = 0.07s
        tk.noiseBurst({
          startTime: tk.now,
          duration: 0.05,
          filterType: 'bandpass',
          freqStart: 1200,
          gainPeak: 0.15,
        });
        // Longer tail tone ending around t = 0.265s (`maxEndTime`)
        tk.tone({
          startTime: tk.now + 0.05,
          duration: 0.2,
          type: 'triangle',
          freqStart: 240,
          freqEnd: 120,
          gainPeak: 0.25,
        });
      },
      { dryGain: 0.8, wetSend: 0.25, lowpassHz: 2400 }
    );

    expect(ctx.panners).toHaveLength(baselinePannerCount + 1);
    const panner = ctx.panners[ctx.panners.length - 1]!;
    expect(sfxGain.incomingSources.has(panner)).toBe(true);
    expect(reverbConvolver.incomingSources.size).toBe(1);

    const shortBurst = ctx.bufferSources[bufSrcStartIdx]!;
    const finalTone = ctx.oscillators[oscStartIdx]!;
    expect(ctx.gains.length).toBeGreaterThan(baselineGainCount);

    // Early source ends first -> cleans its own filter/env, but panner stays connected until maxEndTime
    shortBurst.onended?.();
    expect(sfxGain.incomingSources.has(panner)).toBe(true);
    expect(reverbConvolver.incomingSources.size).toBe(1);

    // Final (`maxEndTime`) source ends -> panner, lowpass, inputGain & wetSendGain all disconnect (0 leaks)
    finalTone.onended?.();
    expect(sfxGain.incomingSources.has(panner)).toBe(false);
    expect(sfxGain.incomingSources.size).toBe(1); // Only persistent reverbGain remains
    expect(reverbConvolver.incomingSources.size).toBe(0);
    expect(panner.connectedTargets.size).toBe(0);

    // 3. triggerSpatialFoley routes spatial when worldPos defined and dry UI when undefined
    engine.triggerSpatialFoley(undefined, (tk) => {
      tk.tone({
        startTime: tk.now,
        duration: 0.03,
        type: 'sine',
        freqStart: 600,
        gainPeak: 0.1,
      });
    });
    expect(ctx.panners).toHaveLength(baselinePannerCount + 1);
    ctx.oscillators[ctx.oscillators.length - 1]!.onended?.();

    engine.triggerSpatialFoley({ x: 1, y: 1, z: 1 }, (tk) => {
      tk.tone({
        startTime: tk.now,
        duration: 0.03,
        type: 'sine',
        freqStart: 600,
        gainPeak: 0.1,
      });
    });
    expect(ctx.panners).toHaveLength(baselinePannerCount + 2);
    ctx.oscillators[ctx.oscillators.length - 1]!.onended?.();
    expect(sfxGain.incomingSources.size).toBe(1);

    engine.dispose();
  });

  it('wires 0 Hz native Web Audio OscillatorNode LFOs (0.07 Hz & 0.03 Hz) through GainNodes to windFilter.frequency', () => {
    activeHarness = installMockBrowserEnvironment('running');
    const engine = new AudioEngine();
    engine.ensureContext();
    const ctx = MockAudioContext.instances[0]!;

    const soundscape = new SoundscapeController('coastal', engine);
    soundscape.update(0.016, 'day', false, true, {
      windSpeedKph: 20,
      rainIntensity: 0,
      snowIntensity: 0,
    });

    const lfo07 = ctx.oscillators.find((o) => Math.abs(o.frequency.value - 0.07) < 1e-6);
    const lfo03 = ctx.oscillators.find((o) => Math.abs(o.frequency.value - 0.03) < 1e-6);
    const lfoBed = ctx.oscillators.find((o) => Math.abs(o.frequency.value - 0.11) < 1e-6);

    expect(lfo07).toBeDefined();
    expect(lfo03).toBeDefined();
    expect(lfoBed).toBeDefined();
    expect(lfo07!.type).toBe('sine');
    expect(lfo03!.type).toBe('sine');
    expect(lfo07!.startedAt).not.toBeNull();
    expect(lfo03!.startedAt).not.toBeNull();

    // Verify LFO -> GainNode -> windFilter.frequency AudioParam routing
    const lfo1Gain = [...lfo07!.connectedTargets][0] as MockGainNode;
    const lfo2Gain = [...lfo03!.connectedTargets][0] as MockGainNode;
    expect(lfo1Gain).toBeInstanceOf(MockGainNode);
    expect(lfo2Gain).toBeInstanceOf(MockGainNode);
    expect(lfo1Gain.gain.value).toBeGreaterThan(40);
    expect(lfo2Gain.gain.value).toBeCloseTo(lfo1Gain.gain.value * 0.6, 4);

    const freqTarget1 = [...lfo1Gain.connectedTargets][0] as MockAudioParam;
    const freqTarget2 = [...lfo2Gain.connectedTargets][0] as MockAudioParam;
    expect(freqTarget1.kind).toBe('AudioParam');
    expect(freqTarget1.paramName).toBe('frequency');
    expect(freqTarget1).toBe(freqTarget2);
    expect(freqTarget1.owner).toBeInstanceOf(MockBiquadFilterNode);

    soundscape.dispose();
    expect(lfo07!.stopped).toBe(true);
    expect(lfo03!.stopped).toBe(true);
    expect(lfoBed!.stopped).toBe(true);
    engine.dispose();
  });

  it('starts rainSource only when rainIntensity > 0 and stops + disconnects it when rainIntensity === 0', () => {
    activeHarness = installMockBrowserEnvironment('running');
    const engine = new AudioEngine();
    engine.ensureContext();
    const ctx = MockAudioContext.instances[0]!;

    const soundscape = new SoundscapeController('countryside', engine);

    // Dry weather: windSource + bedSource created, but zero active rainSource
    soundscape.update(0.016, 'day', false, true, {
      windSpeedKph: 12,
      rainIntensity: 0,
      snowIntensity: 0,
    });
    expect(soundscape.hasActiveRainSource()).toBe(false);
    expect(ctx.bufferSources).toHaveLength(2);

    // Rain starts -> rainSource allocated and started
    soundscape.update(0.016, 'day', false, true, {
      windSpeedKph: 18,
      rainIntensity: 0.65,
      snowIntensity: 0,
    });
    expect(soundscape.hasActiveRainSource()).toBe(true);
    expect(ctx.bufferSources).toHaveLength(3);
    const rainSrc = ctx.bufferSources[2]!;
    expect(rainSrc.startedAt).not.toBeNull();
    expect(rainSrc.stopped).toBe(false);

    // Rain stops -> rainSource stopped, disconnected, and cleared
    soundscape.update(0.016, 'day', false, true, {
      windSpeedKph: 12,
      rainIntensity: 0,
      snowIntensity: 0,
    });
    expect(soundscape.hasActiveRainSource()).toBe(false);
    expect(rainSrc.stopped).toBe(true);
    expect(rainSrc.disconnectCount).toBeGreaterThanOrEqual(1);
    expect(rainSrc.connectedTargets.size).toBe(0);

    soundscape.dispose();
    engine.dispose();
  });
});
