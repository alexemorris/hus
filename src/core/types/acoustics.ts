/**
 * Declarative acoustic, exterior soundscape, room occlusion, and spatial emitter types.
 *
 * Pure core domain types with zero renderer (`three`) or runtime dependencies.
 */

export type FloorSurfaceType = 'wood' | 'stone' | 'turf' | 'gravel' | 'stair' | 'ladder';

export type SoundscapePresetId =
  | 'countryside'
  | 'coastal'
  | 'hills-city'
  | 'urban'
  | 'quiet';

export type SoundscapeChannelLayout = 'stereo' | 'dual-mono' | 'foa' | 'quad';

export interface SoundscapeStems {
  readonly dayUrl?: string;
  readonly duskUrl?: string;
  readonly nightUrl?: string;
  readonly windUrl?: string;
  readonly rainUrl?: string;
  readonly channelLayout?: SoundscapeChannelLayout;
}

export interface SoundscapeDescriptorObject extends SoundscapeStems {
  readonly preset?: SoundscapePresetId;
  /** Master gain multiplier for this house's exterior soundscape (`0..2`, default `1`). */
  readonly gain?: number;
}

export type SoundscapeDescriptor = SoundscapePresetId | SoundscapeDescriptorObject;

export interface NormalizedSoundscapeDescriptor {
  readonly preset: SoundscapePresetId;
  readonly gain: number;
  readonly channelLayout: SoundscapeChannelLayout;
  readonly dayUrl?: string;
  readonly duskUrl?: string;
  readonly nightUrl?: string;
  readonly windUrl?: string;
  readonly rainUrl?: string;
}

const VALID_PRESETS: ReadonlySet<string> = new Set<SoundscapePresetId>([
  'countryside',
  'coastal',
  'hills-city',
  'urban',
  'quiet',
]);

const VALID_CHANNEL_LAYOUTS: ReadonlySet<string> = new Set<SoundscapeChannelLayout>([
  'stereo',
  'dual-mono',
  'foa',
  'quad',
]);

function normalizeStemUrl(url: string | undefined): string | undefined {
  if (typeof url !== 'string') return undefined;
  const trimmed = url.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Normalizes a shorthand preset string or partial soundscape descriptor object into a
 * complete, bounds-clamped descriptor with defaults (`preset: 'countryside'`, `gain: 1`,
 * `channelLayout: 'stereo'`).
 */
export function normalizeSoundscapeDescriptor(
  input?: SoundscapeDescriptor
): NormalizedSoundscapeDescriptor {
  if (input === undefined) {
    return {
      preset: 'countryside',
      gain: 1,
      channelLayout: 'stereo',
    };
  }

  if (typeof input === 'string') {
    const preset: SoundscapePresetId = VALID_PRESETS.has(input) ? input : 'countryside';
    return {
      preset,
      gain: 1,
      channelLayout: 'stereo',
    };
  }

  const preset: SoundscapePresetId =
    input.preset && VALID_PRESETS.has(input.preset) ? input.preset : 'countryside';
  const rawGain = typeof input.gain === 'number' && Number.isFinite(input.gain) ? input.gain : 1;
  const gain = Math.max(0, Math.min(2, rawGain));
  const channelLayout: SoundscapeChannelLayout =
    input.channelLayout && VALID_CHANNEL_LAYOUTS.has(input.channelLayout)
      ? input.channelLayout
      : 'stereo';

  const dayUrl = normalizeStemUrl(input.dayUrl);
  const duskUrl = normalizeStemUrl(input.duskUrl);
  const nightUrl = normalizeStemUrl(input.nightUrl);
  const windUrl = normalizeStemUrl(input.windUrl);
  const rainUrl = normalizeStemUrl(input.rainUrl);

  return {
    preset,
    gain,
    channelLayout,
    ...(dayUrl !== undefined ? { dayUrl } : {}),
    ...(duskUrl !== undefined ? { duskUrl } : {}),
    ...(nightUrl !== undefined ? { nightUrl } : {}),
    ...(windUrl !== undefined ? { windUrl } : {}),
    ...(rainUrl !== undefined ? { rainUrl } : {}),
  };
}

export type AcousticSurfaceMaterial =
  | 'stone'
  | 'timber'
  | 'plaster'
  | 'glass'
  | 'carpet'
  | 'tile';

export interface ExteriorPortalAcousticState {
  readonly id: string;
  readonly position: readonly [number, number, number];
  /** Clear opening area in m² when fully open (default `4.0`, e.g. large sliding glass wall = `8..18 m²`). */
  readonly areaM2?: number;
  /** Open fraction in `[0, 1]` (`0` = sealed shut, `1` = fully slid/folded open). */
  readonly openness: number;
}

export type AcousticPortalState = ExteriorPortalAcousticState;

export interface RoomAcousticProfile {
  readonly zoneId?: string;
  /** Approximate room volume in m³ (default `75`). */
  readonly volumeM3?: number;
  /** Dominant interior finish material (controls RT60 & HF damping). */
  readonly primarySurface?: AcousticSurfaceMaterial;
  /** Optional explicit average Sabine absorption coefficient `0.03..0.95`. */
  readonly absorptionCoeff?: number;
}

export interface AcousticOcclusionState {
  readonly isInterior: boolean;
  /** Distance- and area-weighted effective exterior portal openness `[0, 1]` (`1` when outdoors). */
  readonly effectiveOpenness: number;
  /** Exterior -> listener BiquadFilterNode low-pass cutoff in Hz (`~720 Hz` sealed indoors -> `~18000 Hz` outdoors). */
  readonly exteriorLowpassHz: number;
  /** Exterior -> listener high-shelf attenuation in dB (`-14 dB` sealed indoors -> `0 dB` outdoors). */
  readonly exteriorHighShelfDb: number;
  /** Linear gain multiplier `[0, 1]` applied to exterior soundscape & exterior object emitters. */
  readonly exteriorGainScale: number;
  /** Estimated room RT60 decay time in seconds (Sabine approximation, `0.12..2.2 s`). */
  readonly reverbDecaySec: number;
  /** ConvolverNode wet send gain (`0.05` outdoors -> `0.12..0.38` indoors depending on volume/absorption & open glass walls). */
  readonly reverbWetSend: number;
}

export type ContinuousAudioPreset =
  | 'woodStove'
  | 'espressoMachine'
  | 'fridgeHum'
  | 'waterFeature'
  | 'waterTapFlow'
  | 'mediaPlayback'
  | 'piano'
  | 'hvacHum';

export type FoleyAudioPreset =
  | 'switchClick'
  | 'doorLatch'
  | 'drawerSlide'
  | 'gateLatch'
  | 'cisternFlush'
  | 'ovenDoorLatch'
  | 'espressoExtract'
  | 'sashWindowSlide'
  | 'tapValveTurn';

export type AudioEmitterPreset = ContinuousAudioPreset | FoleyAudioPreset;
