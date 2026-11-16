import type { CircuitId, ScenePreset, ZoneLightingMode } from '../../core/types/knx.ts';
import type { TimeOfDay } from '../../core/types/scene.ts';
import type { RoomZoneId } from '../../core/types/topology.ts';
import type { KNXPropertyBusController } from './emulator.ts';
import { createKnxNameResolver, tokeniseKnxName, type KnxNameResolver } from './name-resolver.ts';
import type {
  KnxCoverChannelConfig,
  KnxLightingZone,
  KnxMediaEndpointConfig,
  KnxPresenceDetectorDevice,
  KnxProject,
} from './project.ts';

/**
 * Natural-language KNX assistant (the "AI bridge" device on the bus).
 *
 * Everything the model sees — tool schema, circuit / zone / scene / cover / media lists,
 * live state, and prompt examples — is generated dynamically from the active {@link KnxProject}.
 */

/** Zone-level actuator objects (scene / night / full / off) the assistant drives. */
export interface KnxAssistantZoneBus {
  recallZoneScene(zoneId: RoomZoneId, sceneIndex: number, sourcePa?: string, location?: string): void;
  enterZoneNight(zoneId: RoomZoneId, sourcePa?: string, location?: string): void;
  setZoneFull(zoneId: RoomZoneId, sourcePa?: string, location?: string): void;
  setZoneOff(zoneId: RoomZoneId, sourcePa?: string): void;
  getZoneState(zoneId: RoomZoneId): { readonly mode: ZoneLightingMode; readonly sceneIndex: number | null };
}

/** The slice of the bus controller the assistant uses (plus the zone objects above). */
export type KnxAssistantBus = Pick<
  KNXPropertyBusController,
  | 'recallScene'
  | 'setCircuitLevel'
  | 'handleMasterFull'
  | 'handleMasterOff'
  | 'saveCurrentLevelsToActiveScene'
  | 'getScenes'
  | 'getActiveSceneIndex'
  | 'getAmbientLux'
  | 'setAmbientLux'
> &
  KnxAssistantZoneBus & {
    getTargetLevels(): Readonly<Partial<Record<CircuitId, number>>>;
    getPresenceState?(pa: string): { readonly detected: boolean };
    setPresence?(pa: string, detected: boolean): void;
    isCoverOpen?(id: string): boolean;
    getCoverStatusLabel?(id: string): string;
    setCoverOpen?(id: string, open: boolean, emitBus?: boolean, sourcePa?: string): boolean;
    isMediaEndpointActive?(id: string): boolean;
    getMediaEndpointItem?(id: string): string;
    cycleMediaEndpoint?(id: string, emitBus?: boolean, sourcePa?: string): void;
    setMediaEndpointIndex?(id: string, index: number, emitBus?: boolean, sourcePa?: string): void;
  };

/** A non-KNX scene device the assistant can trigger by name (e.g. a folding door or animated prop). */
export interface KnxAssistantDevice {
  /** Interactable id passed to {@link KnxAssistantEnvironment.triggerDevice}. */
  readonly id: string;
  readonly name: string;
  /** Phrases that trigger it. */
  readonly aliases: readonly string[];
}

/** Non-KNX simulator state the assistant may change (sky preset, scene devices). */
export interface KnxAssistantEnvironment {
  setTimeOfDay(timeOfDay: TimeOfDay): void;
  /** Scene devices with natural-language aliases (read lazily: they register as the scene builds). */
  listDevices?(): readonly KnxAssistantDevice[];
  /** Triggers a device's action (click equivalent). Returns false if it ignored the request. */
  triggerDevice?(id: string): boolean;
}

/** The parts of a {@link KnxProject} the assistant reads (a full project satisfies it). */
export type KnxAssistantProject = Pick<
  KnxProject,
  'name' | 'circuits' | 'zones' | 'rooms' | 'centralScenes' | 'centralPa'
> & {
  readonly presenceDetectors?: readonly KnxPresenceDetectorDevice[];
  readonly covers?: readonly KnxCoverChannelConfig[];
  readonly mediaEndpoints?: readonly KnxMediaEndpointConfig[];
};

export interface KNXToolParameterProperty {
  readonly type: 'NUMBER' | 'INTEGER' | 'STRING' | 'BOOLEAN' | 'ARRAY' | 'OBJECT';
  readonly description: string;
  readonly enum?: readonly string[];
  readonly items?: {
    readonly type: 'STRING';
    readonly enum?: readonly string[];
  };
  readonly properties?: Readonly<Record<string, KNXToolParameterProperty>>;
}

export interface KNXFunctionDeclaration {
  readonly name: string;
  readonly description: string;
  readonly parameters: {
    readonly type: 'OBJECT';
    readonly properties: Readonly<Record<string, KNXToolParameterProperty>>;
    readonly required?: readonly string[];
  };
}

export type CircuitLevelsPartial = Partial<Record<CircuitId, number>>;
export type ZoneModeCommand = 'full' | 'night' | 'off';

export type KNXToolCall =
  | {
      readonly name: 'recall_zone_scene';
      readonly args: {
        readonly zone: RoomZoneId;
        readonly sceneIndex: number;
        readonly sceneId: string;
        readonly reason?: string;
      };
    }
  | {
      readonly name: 'set_zone_mode';
      readonly args: { readonly zone: RoomZoneId; readonly mode: ZoneModeCommand; readonly reason?: string };
    }
  | {
      readonly name: 'set_circuit_levels';
      readonly args: { readonly levels: CircuitLevelsPartial; readonly reason?: string };
    }
  | {
      readonly name: 'adjust_circuit_levels';
      readonly args: { readonly circuits: readonly CircuitId[]; readonly deltaPct: number; readonly reason?: string };
    }
  | {
      readonly name: 'recall_scene';
      readonly args: { readonly sceneNumber: number; readonly reason?: string };
    }
  | {
      readonly name: 'set_master_state';
      readonly args: { readonly mode: 'all_full' | 'off'; readonly reason?: string };
    }
  | {
      readonly name: 'save_scene_preset';
      readonly args: { readonly sceneNumber?: number };
    }
  | {
      readonly name: 'control_cover';
      readonly args: { readonly cover: string; readonly open: boolean; readonly reason?: string };
    }
  | {
      readonly name: 'control_media_endpoint';
      readonly args: {
        readonly endpoint: string;
        readonly action: 'next' | 'select';
        readonly itemNumber?: number;
        readonly reason?: string;
      };
    }
  | {
      readonly name: 'set_environment';
      readonly args: {
        readonly timeOfDay?: TimeOfDay;
        readonly presence?: Readonly<Record<string, boolean>>;
      };
    }
  | {
      readonly name: 'trigger_device';
      readonly args: { readonly device: string; readonly reason?: string };
    };

export interface ExecutedToolCallRecord {
  readonly call: KNXToolCall;
  readonly formatted: string;
}

export interface AIAssistantExecutionResult {
  readonly prompt: string;
  readonly modelUsed: string;
  readonly executedCalls: readonly ExecutedToolCallRecord[];
  readonly reply: string;
}

export type KnxAssistantModel = 'gemini-3.5-flash-lite' | 'gemini-3.5-flash';

interface VertexFunctionCallPart {
  readonly name?: string;
  readonly args?: Readonly<Record<string, unknown>>;
}

interface VertexContentPart {
  readonly text?: string;
  readonly functionCall?: VertexFunctionCallPart;
}

interface VertexGenerateContentResponse {
  readonly candidates?: readonly { readonly content?: { readonly parts?: readonly VertexContentPart[] } }[];
  readonly modelVersion?: string;
}

const ASSISTANT_LOCATION = 'AI Assistant';
const DEFAULT_RELATIVE_STEP_PCT = 20;

/** Ambient lux reported by the presence/lux sensor for each sky preset. */
const TIME_OF_DAY_LUX: Readonly<Record<TimeOfDay, number>> = { day: 480, dusk: 38, night: 5 };

/** Generic mood words mapped to common architectural lighting scene labels. */
const CENTRAL_SCENE_SYNONYMS: Readonly<Record<string, string>> = {
  romantic: 'wine',
  intimate: 'wine',
  drink: 'cocktail',
  dinner: 'dining',
  dine: 'dining',
  relax: 'lounge',
  cosy: 'lounge',
  cozy: 'lounge',
  bake: 'baking',
  cook: 'cooking',
};

/** Vite `BASE_URL` (sub-path deployments); typed locally so this module builds without vite/client. */
function appBaseUrl(): string {
  return (import.meta as ImportMeta & { readonly env?: { readonly BASE_URL?: string } }).env?.BASE_URL ?? '/';
}

function formatToolCallString(call: KNXToolCall): string {
  const cleanArgs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(call.args)) {
    if (k !== 'reason' && v !== undefined) cleanArgs[k] = v;
  }
  return `${call.name}(${JSON.stringify(cleanArgs)})`;
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function toNumber(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

function isRecord(raw: unknown): raw is Readonly<Record<string, unknown>> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

function parseZoneMode(raw: unknown): ZoneModeCommand | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  if (v === 'full' || v === 'on' || v === 'all_full' || v === 'max') return 'full';
  if (v === 'night' || v === 'nightlight' || v === 'night_mode' || v === 'dim') return 'night';
  if (v === 'off' || v === 'dark') return 'off';
  return null;
}

function buildDynamicExamples(project: KnxAssistantProject): string {
  const sampleCircuit = project.circuits[0]?.shortName.toLowerCase() ?? 'pendants';
  const sampleZoneA = project.zones[0]?.name.toLowerCase() ?? 'living room';
  const sampleZoneB = project.zones[1]?.name.toLowerCase() ?? 'hallway';
  return `"${sampleCircuit} to 40%", "${sampleZoneB} off", "${sampleZoneA} night mode"`;
}

/** Builds the Gemini function declarations dynamically for a project. */
export function buildKnxAiTools(project: KnxAssistantProject): KNXFunctionDeclaration[] {
  const roomName = new Map(project.rooms.map((r) => [r.id, r.name]));
  const zoneIds = project.zones.map((z) => z.id);
  const circuitIds = project.circuits.map((c) => c.id);
  const sceneZones = project.zones.filter((z) => z.scenes.length > 0);

  const zoneSceneDesc = sceneZones
    .map((z) => `${z.id}: ${z.scenes.map((s, i) => `${i + 1}=${s.label}`).join(', ')}`)
    .join('; ');

  const levelProps: Record<string, KNXToolParameterProperty> = {};
  for (const c of project.circuits) {
    levelProps[c.id] = {
      type: 'INTEGER',
      description: `${c.name} (${roomName.get(c.zoneId) ?? c.zoneId})${c.dimmable === false ? ', switched only: 0 or 100' : ''} — 0-100 %`,
    };
  }

  const reason: KNXToolParameterProperty = {
    type: 'STRING',
    description: 'Short friendly 1-sentence explanation of the choice.',
  };

  const tools: KNXFunctionDeclaration[] = [
    {
      name: 'recall_zone_scene',
      description: `Recall a stored lighting scene in one room zone (zone scene object, DPT 17.001). Scenes per zone: ${zoneSceneDesc || 'none'}.`,
      parameters: {
        type: 'OBJECT',
        properties: {
          zone: { type: 'STRING', enum: sceneZones.map((z) => z.id), description: 'Zone id.' },
          scene: { type: 'STRING', description: 'Scene label or 1-based scene number within the zone.' },
          reason,
        },
        required: ['zone', 'scene'],
      },
    },
    {
      name: 'set_zone_mode',
      description:
        'Switch a whole room zone: "full" = every channel 100 %, "night" = night-light levels (3–5 %), "off" = all channels 0 %.',
      parameters: {
        type: 'OBJECT',
        properties: {
          zone: { type: 'STRING', enum: zoneIds, description: 'Zone id.' },
          mode: { type: 'STRING', enum: ['full', 'night', 'off'], description: 'Zone mode.' },
          reason,
        },
        required: ['zone', 'mode'],
      },
    },
    {
      name: 'set_circuit_levels',
      description:
        'Set absolute dimming levels (0-100 %) for any combination of individual lighting circuits (actuator channels). Use for specific fittings or custom moods.',
      parameters: {
        type: 'OBJECT',
        properties: {
          levels: { type: 'OBJECT', description: 'Map of circuit id → percent.', properties: levelProps },
          reason,
        },
        required: ['levels'],
      },
    },
    {
      name: 'adjust_circuit_levels',
      description:
        'Relatively brighten (+deltaPct) or dim (-deltaPct) circuits from their current level. Give `circuits`, or `zone` to adjust every circuit in that zone.',
      parameters: {
        type: 'OBJECT',
        properties: {
          circuits: {
            type: 'ARRAY',
            description: 'Circuit ids to adjust.',
            items: { type: 'STRING', enum: circuitIds },
          },
          zone: { type: 'STRING', enum: zoneIds, description: 'Adjust all circuits of this zone.' },
          deltaPct: { type: 'INTEGER', description: 'Signed delta, -100..+100 (e.g. -25 dims by 25 %).' },
          reason,
        },
        required: ['deltaPct'],
      },
    },
  ];

  if (project.centralScenes.length > 0) {
    const centralDesc = project.centralScenes.map((s) => `${s.number}=${s.name}`).join(', ');
    tools.push(
      {
        name: 'recall_scene',
        description: `Recall a scene from the central actuator scene table: ${centralDesc}.`,
        parameters: {
          type: 'OBJECT',
          properties: {
            sceneNumber: { type: 'INTEGER', description: `Scene number: ${centralDesc}.` },
            reason,
          },
          required: ['sceneNumber'],
        },
      },
      {
        name: 'save_scene_preset',
        description: 'Store the current central-table circuit levels into a central scene slot.',
        parameters: {
          type: 'OBJECT',
          properties: {
            sceneNumber: { type: 'INTEGER', description: `Target scene number 1-${project.centralScenes.length}.` },
          },
        },
      },
    );
  }

  tools.push({
    name: 'set_master_state',
    description: 'Whole-property master objects: "all_full" = every circuit 100 %, "off" = master off (night-walk dim where occupied).',
    parameters: {
      type: 'OBJECT',
      properties: {
        mode: { type: 'STRING', enum: ['all_full', 'off'], description: 'Master mode.' },
        reason,
      },
      required: ['mode'],
    },
  });

  const covers = project.covers ?? [];
  if (covers.length > 0) {
    const coverDesc = covers.map((c) => `${c.id} (${c.name})`).join(', ');
    tools.push({
      name: 'control_cover',
      description: `Open or close a motorized cover, blind, or gate channel: ${coverDesc}.`,
      parameters: {
        type: 'OBJECT',
        properties: {
          cover: { type: 'STRING', enum: covers.map((c) => c.id), description: 'Cover channel id.' },
          open: { type: 'BOOLEAN', description: 'True to open, false to close.' },
          reason,
        },
        required: ['cover', 'open'],
      },
    });
  }

  const mediaEndpoints = project.mediaEndpoints ?? [];
  if (mediaEndpoints.length > 0) {
    const mediaDesc = mediaEndpoints
      .map((m) => `${m.id} (${m.name}): ${m.items.map((it, i) => `${i + 1}=${it}`).join(', ')}`)
      .join('; ');
    tools.push({
      name: 'control_media_endpoint',
      description: `Cycle or select an item on a configured media / display endpoint: ${mediaDesc}.`,
      parameters: {
        type: 'OBJECT',
        properties: {
          endpoint: {
            type: 'STRING',
            enum: mediaEndpoints.map((m) => m.id),
            description: 'Media endpoint id.',
          },
          action: {
            type: 'STRING',
            enum: ['next', 'select'],
            description: '"next" cycles, "select" uses itemNumber.',
          },
          itemNumber: { type: 'INTEGER', description: '1-based item index.' },
          reason,
        },
        required: ['endpoint', 'action'],
      },
    });
  }

  const presenceProps: Record<string, KNXToolParameterProperty> = {};
  for (const d of project.presenceDetectors ?? []) {
    presenceProps[d.pa] = {
      type: 'BOOLEAN',
      description: `${d.name} (${d.zoneId}) presence state.`,
    };
  }

  const envProps: Record<string, KNXToolParameterProperty> = {
    timeOfDay: {
      type: 'STRING',
      enum: ['day', 'dusk', 'night'],
      description: `day (${TIME_OF_DAY_LUX.day} lx), dusk (${TIME_OF_DAY_LUX.dusk} lx) or night (${TIME_OF_DAY_LUX.night} lx).`,
    },
  };
  if (Object.keys(presenceProps).length > 0) {
    envProps.presence = {
      type: 'OBJECT',
      description: 'Map of presence detector PA → occupied boolean.',
      properties: presenceProps,
    };
  }

  tools.push({
    name: 'set_environment',
    description: 'Simulator environment: time of day (ambient lux) and optional presence detector states.',
    parameters: {
      type: 'OBJECT',
      properties: envProps,
    },
  });

  return tools;
}

export class KNXAIAssistant {
  private readonly bus: KnxAssistantBus;
  private readonly project: KnxAssistantProject;
  private readonly env: KnxAssistantEnvironment;
  private readonly onEnvironmentChanged?: () => void;
  private readonly resolver: KnxNameResolver;
  private readonly tools: readonly KNXFunctionDeclaration[];
  private readonly zoneById: ReadonlyMap<RoomZoneId, KnxLightingZone>;
  private readonly circuitIds: ReadonlySet<string>;
  private readonly roomName: ReadonlyMap<RoomZoneId, string>;
  private readonly sourcePa: string;
  private selectedModel: KnxAssistantModel = 'gemini-3.5-flash-lite';

  public constructor(
    bus: KnxAssistantBus,
    project: KnxAssistantProject,
    env: KnxAssistantEnvironment,
    onEnvironmentChanged?: () => void,
  ) {
    this.bus = bus;
    this.project = project;
    this.env = env;
    this.onEnvironmentChanged = onEnvironmentChanged;
    this.resolver = createKnxNameResolver(project);
    this.tools = buildKnxAiTools(project);
    this.zoneById = new Map(project.zones.map((z) => [z.id, z]));
    this.circuitIds = new Set(project.circuits.map((c) => c.id));
    this.roomName = new Map(project.rooms.map((r) => [r.id, r.name]));
    this.sourcePa = project.centralPa.aiBridge;
  }

  public getSelectedModel(): string {
    return this.selectedModel;
  }

  public setSelectedModel(model: KnxAssistantModel): void {
    this.selectedModel = model;
  }

  /** The generated function declarations sent to the model (plus `trigger_device` when devices exist). */
  public getTools(): readonly KNXFunctionDeclaration[] {
    const devices = this.listDevices();
    if (devices.length === 0) return this.tools;
    return [
      ...this.tools,
      {
        name: 'trigger_device',
        description: `Trigger a scene device's action (like clicking it): ${devices
          .map((d) => `${d.id} = ${d.name}${d.aliases.length > 0 ? ` (${d.aliases.join(', ')})` : ''}`)
          .join('; ')}.`,
        parameters: {
          type: 'OBJECT',
          properties: {
            device: { type: 'STRING', enum: devices.map((d) => d.id), description: 'Device id.' },
            reason: { type: 'STRING', description: 'Short friendly 1-sentence explanation of the choice.' },
          },
          required: ['device'],
        },
      },
    ];
  }

  private listDevices(): readonly KnxAssistantDevice[] {
    return this.env.triggerDevice ? (this.env.listDevices?.() ?? []) : [];
  }

  /** Device whose id, name or alias matches `raw` exactly (case-insensitive). */
  private resolveDevice(raw: unknown): KnxAssistantDevice | null {
    if (typeof raw !== 'string') return null;
    const q = raw.trim().toLowerCase();
    if (!q) return null;
    return (
      this.listDevices().find(
        (d) => d.id === raw || d.name.toLowerCase() === q || d.aliases.some((a) => a.toLowerCase() === q)
      ) ?? null
    );
  }

  /** Longest device alias / name that appears as whole words in `lower`. */
  private matchDeviceInPrompt(lower: string): KnxAssistantDevice | null {
    let best: KnxAssistantDevice | null = null;
    let bestLen = 0;
    for (const d of this.listDevices()) {
      for (const phrase of [d.name, ...d.aliases]) {
        const p = phrase.trim().toLowerCase();
        if (p.length <= bestLen) continue;
        const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
        if (new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`).test(lower)) {
          best = d;
          bestLen = p.length;
        }
      }
    }
    return best;
  }

  private resolveCover(raw: unknown): KnxCoverChannelConfig | null {
    if (typeof raw !== 'string') return null;
    const q = raw.trim().toLowerCase();
    if (!q) return null;
    return (
      (this.project.covers ?? []).find(
        (c) =>
          c.id === raw ||
          c.name.toLowerCase() === q ||
          c.shortName?.toLowerCase() === q ||
          (c.aliases ?? []).some((a) => a.toLowerCase() === q)
      ) ?? null
    );
  }

  private matchCoverInPrompt(lower: string): KnxCoverChannelConfig | null {
    for (const c of this.project.covers ?? []) {
      const phrases = [c.name, ...(c.shortName ? [c.shortName] : []), ...(c.aliases ?? [])];
      for (const phrase of phrases) {
        const p = phrase.trim().toLowerCase();
        if (!p) continue;
        const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
        if (new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`).test(lower)) {
          return c;
        }
      }
    }
    return null;
  }

  private resolveMediaEndpoint(raw: unknown): KnxMediaEndpointConfig | null {
    if (typeof raw !== 'string') return null;
    const q = raw.trim().toLowerCase();
    if (!q) return null;
    return (
      (this.project.mediaEndpoints ?? []).find(
        (m) =>
          m.id === raw ||
          m.name.toLowerCase() === q ||
          (m.aliases ?? []).some((a) => a.toLowerCase() === q)
      ) ?? null
    );
  }

  private matchMediaEndpointInPrompt(
    prompt: string,
    lower: string
  ): { readonly endpoint: KnxMediaEndpointConfig; readonly itemIndex: number } | null {
    const queryTokens = new Set(tokeniseKnxName(prompt));
    for (const endpoint of this.project.mediaEndpoints ?? []) {
      const phrases = [endpoint.name, ...(endpoint.aliases ?? [])];
      const matchesAlias = phrases.some((phrase) => {
        const p = phrase.trim().toLowerCase();
        if (!p) return false;
        const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
        return new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`).test(lower);
      });
      const itemIndex = endpoint.items.findIndex((title) =>
        tokeniseKnxName(title).some((t) => queryTokens.has(t) && t.length > 3)
      );
      if (matchesAlias || itemIndex >= 0) {
        return { endpoint, itemIndex };
      }
    }
    return null;
  }

  public getResolver(): KnxNameResolver {
    return this.resolver;
  }

  private zoneLabel(zoneId: RoomZoneId): string {
    return this.zoneById.get(zoneId)?.name ?? this.roomName.get(zoneId) ?? zoneId;
  }

  private circuitLabel(circuitId: CircuitId): string {
    return this.project.circuits.find((c) => c.id === circuitId)?.shortName ?? circuitId;
  }

  private describeZoneState(zone: KnxLightingZone): string {
    const state = this.bus.getZoneState(zone.id);
    if (state.mode === 'scene' && state.sceneIndex !== null) {
      const scene = zone.scenes[state.sceneIndex];
      return `scene ${state.sceneIndex + 1}${scene ? ` "${scene.label}"` : ''}`;
    }
    return state.mode;
  }

  public buildSystemPrompt(): string {
    const levels = this.bus.getTargetLevels();
    const lines: string[] = [
      `You are the KNX smart-home lighting assistant (IP bridge PA ${this.sourcePa}) for ${this.project.name}.`,
      'Use ONLY the zone ids, circuit ids and scenes listed below.',
      '',
      'LIGHTING ZONES (id "name": scenes — current state):',
    ];
    for (const z of this.project.zones) {
      const aliases = z.aliases && z.aliases.length > 0 ? ` (aka ${z.aliases.join(', ')})` : '';
      const scenes = z.usesCentralSceneTable && z.scenes.length === 0
        ? 'central scene table (recall_scene)'
        : z.scenes.map((s, i) => `${i + 1} "${s.label}"`).join(', ') || 'no scenes';
      lines.push(`- ${z.id} "${z.name}"${aliases}: ${scenes} — ${this.describeZoneState(z)}`);
    }
    lines.push('', 'CIRCUITS (id "name" [zone] — live %):');
    for (const c of this.project.circuits) {
      const aliases = c.aliases && c.aliases.length > 0 ? ` (aka ${c.aliases.join(', ')})` : '';
      const switched = c.dimmable === false ? ' switched-only' : '';
      lines.push(`- ${c.id} "${c.name}"${aliases} [${c.zoneId}]${switched} — ${levels[c.id] ?? 0}%`);
    }
    if (this.project.centralScenes.length > 0) {
      const idx = this.bus.getActiveSceneIndex();
      const active = this.bus.getScenes()[idx];
      lines.push(
        '',
        'CENTRAL SCENE TABLE (recall_scene):',
        ...this.project.centralScenes.map((s) => `- ${s.number} "${s.name}"`),
        `Active central scene: ${active ? `${active.number} "${active.name}"` : idx === 99 ? 'All full' : 'none / custom'}`,
      );
    }
    lines.push('', 'ENVIRONMENT:', `- Ambient light ${this.bus.getAmbientLux()} lx`);
    if (this.bus.getPresenceState && (this.project.presenceDetectors?.length ?? 0) > 0) {
      for (const d of this.project.presenceDetectors ?? []) {
        const occupied = this.bus.getPresenceState(d.pa).detected;
        lines.push(`- ${d.name} (${d.pa}): ${occupied ? 'occupied' : 'vacant'}`);
      }
    }
    for (const cover of this.project.covers ?? []) {
      const status = this.bus.getCoverStatusLabel?.(cover.id) ?? 'unknown';
      lines.push(`- ${cover.name} (${cover.id}): ${status}`);
    }
    for (const media of this.project.mediaEndpoints ?? []) {
      const active = this.bus.isMediaEndpointActive?.(media.id) ?? false;
      const item = this.bus.getMediaEndpointItem?.(media.id) ?? '';
      lines.push(`- ${media.name} (${media.id}): ${active ? `"${item}"` : 'standby'}`);
    }
    lines.push(
      '',
      'INSTRUCTIONS:',
      'Always call one or more tools to fulfil the request.',
      'For a whole room prefer recall_zone_scene (named moods) or set_zone_mode (full / night / off).',
      'For specific fittings use set_circuit_levels (absolute) or adjust_circuit_levels (relative).',
      'Switched-only circuits accept just 0 or 100.',
      'Populate `reason` with one short sentence.',
    );
    return lines.join('\n');
  }

  /**
   * Sends the prompt to Gemini via the Vite proxy (`/api/knx-ai`) with native function calling;
   * falls back to the offline parser when the proxy is unreachable.
   */
  public async executeCommand(rawPrompt: string): Promise<AIAssistantExecutionResult> {
    const prompt = rawPrompt.trim();
    if (!prompt) {
      return {
        prompt: '',
        modelUsed: this.selectedModel,
        executedCalls: [],
        reply: `Ready. Ask naturally (e.g. ${buildDynamicExamples(this.project)}).`,
      };
    }

    let data: VertexGenerateContentResponse;
    try {
      const resp = await fetch(`${appBaseUrl()}api/knx-ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.selectedModel,
          vertexRequest: {
            systemInstruction: { parts: [{ text: this.buildSystemPrompt() }] },
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            tools: [{ functionDeclarations: this.getTools() }],
            generationConfig: { temperature: 0.2, thinkingConfig: { thinkingBudget: 0 } },
          },
        }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      data = (await resp.json()) as VertexGenerateContentResponse;
    } catch {
      return this.executeFallbackLocalParser(prompt);
    }

    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const calls: KNXToolCall[] = [];
    const textParts: string[] = [];
    const reasonParts: string[] = [];
    for (const part of parts) {
      if (typeof part.text === 'string' && part.text.trim()) textParts.push(part.text.trim());
      if (part.functionCall && typeof part.functionCall.name === 'string') {
        const coerced = this.coerceRawFunctionCall(part.functionCall.name, part.functionCall.args ?? {});
        if (coerced) {
          calls.push(coerced);
          if ('reason' in coerced.args && typeof coerced.args.reason === 'string') {
            reasonParts.push(coerced.args.reason);
          }
        }
      }
    }
    const { executedCalls, summaries } = this.runCalls(calls);
    const explanation = textParts.join(' ') || reasonParts.join(' ');
    const reply = explanation
      ? summaries.length > 0
        ? `${explanation} (${summaries.join(' · ')})`
        : explanation
      : summaries.join(' · ') || 'No lighting changes needed.';
    return { prompt, modelUsed: data.modelVersion ?? this.selectedModel, executedCalls, reply };
  }

  private runCalls(calls: readonly KNXToolCall[]): {
    executedCalls: ExecutedToolCallRecord[];
    summaries: string[];
  } {
    const executedCalls: ExecutedToolCallRecord[] = [];
    const summaries: string[] = [];
    for (const call of calls) {
      const summary = this.invokeToolCall(call);
      executedCalls.push({ call, formatted: formatToolCallString(call) });
      if (summary) summaries.push(summary);
    }
    return { executedCalls, summaries };
  }

  private resolveZoneId(raw: unknown): RoomZoneId | null {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    const exact = this.project.zones.find((z) => z.id === raw);
    if (exact) return exact.id;
    return this.resolver.resolveZone(raw)?.id ?? null;
  }

  private resolveCircuitId(raw: string): CircuitId | null {
    const exact = this.project.circuits.find((c) => c.id === raw);
    if (exact) return exact.id;
    return this.resolver.resolveCircuit(raw)?.id ?? null;
  }

  /** Matches a central scene by number, code, name or mood word; returns its 1-based number. */
  private resolveCentralSceneNumber(raw: unknown): number | null {
    const scenes = this.project.centralScenes;
    const n = toNumber(raw);
    if (n !== null) {
      const num = Math.round(n);
      return scenes.some((s) => s.number === num) ? num : null;
    }
    if (typeof raw !== 'string') return null;
    const query = new Set(tokeniseKnxName(raw).map((t) => CENTRAL_SCENE_SYNONYMS[t] ?? t));
    let best: ScenePreset | null = null;
    let bestScore = 0;
    for (const s of scenes) {
      const code = s.code.toLowerCase();
      if (raw.trim().toLowerCase() === code) return s.number;
      const tokens = tokeniseKnxName(`${s.name} ${s.shortLabel}`);
      const hits = tokens.filter((t) => query.has(t)).length;
      const score = tokens.length > 0 ? hits / tokens.length : 0;
      if (hits > 0 && score > bestScore) {
        best = s;
        bestScore = score;
      }
    }
    return best ? best.number : null;
  }

  private circuitsOfZone(zoneId: RoomZoneId): CircuitId[] {
    const zone = this.zoneById.get(zoneId);
    if (zone && zone.circuits.length > 0) return [...zone.circuits];
    return this.project.circuits.filter((c) => c.zoneId === zoneId).map((c) => c.id);
  }

  public coerceRawFunctionCall(name: string, rawArgs: Readonly<Record<string, unknown>>): KNXToolCall | null {
    const reasonArg = typeof rawArgs.reason === 'string' ? { reason: rawArgs.reason } : {};

    switch (name) {
      case 'recall_zone_scene': {
        const zone = this.resolveZoneId(rawArgs.zone);
        if (!zone) return null;
        const rawScene = rawArgs.scene ?? rawArgs.sceneNumber ?? rawArgs.sceneIndex ?? rawArgs.sceneId;
        const zoneDef = this.zoneById.get(zone);
        if (zoneDef?.usesCentralSceneTable && zoneDef.scenes.length === 0) {
          const sceneNumber = this.resolveCentralSceneNumber(rawScene);
          return sceneNumber === null ? null : { name: 'recall_scene', args: { sceneNumber, ...reasonArg } };
        }
        const sceneText = typeof rawScene === 'number' ? String(rawScene) : typeof rawScene === 'string' ? rawScene : '';
        const match = this.resolver.resolveScene(zone, sceneText);
        if (!match) return null;
        return { name: 'recall_zone_scene', args: { zone, sceneIndex: match.index, sceneId: match.id, ...reasonArg } };
      }

      case 'set_zone_mode': {
        const zone = this.resolveZoneId(rawArgs.zone);
        const mode = parseZoneMode(rawArgs.mode);
        if (!zone || !mode) return null;
        return { name: 'set_zone_mode', args: { zone, mode, ...reasonArg } };
      }

      case 'set_circuit_levels': {
        const source = isRecord(rawArgs.levels) ? rawArgs.levels : rawArgs;
        const levels: CircuitLevelsPartial = {};
        for (const [key, rawVal] of Object.entries(source)) {
          if (key === 'reason') continue;
          const pct = toNumber(rawVal);
          const id = pct === null ? null : this.resolveCircuitId(key);
          if (id !== null && pct !== null && levels[id] === undefined) levels[id] = clampPct(pct);
        }
        if (Object.keys(levels).length === 0) return null;
        return { name: 'set_circuit_levels', args: { levels, ...reasonArg } };
      }

      case 'adjust_circuit_levels': {
        const circuits: CircuitId[] = [];
        const rawCircuits = Array.isArray(rawArgs.circuits) ? rawArgs.circuits : [];
        for (const c of rawCircuits) {
          const id = typeof c === 'string' ? this.resolveCircuitId(c) : null;
          if (id && !circuits.includes(id)) circuits.push(id);
        }
        if (circuits.length === 0) {
          const zone = this.resolveZoneId(rawArgs.zone);
          if (zone) circuits.push(...this.circuitsOfZone(zone));
        }
        if (circuits.length === 0) return null;
        const delta = toNumber(rawArgs.deltaPct);
        return {
          name: 'adjust_circuit_levels',
          args: { circuits, deltaPct: Math.round(delta ?? -DEFAULT_RELATIVE_STEP_PCT), ...reasonArg },
        };
      }

      case 'recall_scene': {
        const sceneNumber = this.resolveCentralSceneNumber(rawArgs.sceneNumber ?? rawArgs.scene);
        return sceneNumber === null ? null : { name: 'recall_scene', args: { sceneNumber, ...reasonArg } };
      }

      case 'set_master_state': {
        const mode = rawArgs.mode === 'all_full' || rawArgs.mode === 'full' ? 'all_full' : 'off';
        return { name: 'set_master_state', args: { mode, ...reasonArg } };
      }

      case 'save_scene_preset': {
        const sceneNumber = this.resolveCentralSceneNumber(rawArgs.sceneNumber);
        return { name: 'save_scene_preset', args: sceneNumber === null ? {} : { sceneNumber } };
      }

      case 'control_cover': {
        const cover = this.resolveCover(rawArgs.cover ?? rawArgs.id) ?? (this.project.covers ?? [])[0] ?? null;
        if (!cover || typeof rawArgs.open !== 'boolean') return null;
        return { name: 'control_cover', args: { cover: cover.id, open: rawArgs.open, ...reasonArg } };
      }

      case 'control_media_endpoint': {
        const endpoint =
          this.resolveMediaEndpoint(rawArgs.endpoint ?? rawArgs.id) ??
          (this.project.mediaEndpoints ?? [])[0] ??
          null;
        if (!endpoint) return null;
        const num = toNumber(rawArgs.itemNumber);
        const itemNumber =
          num !== null && num >= 1 && num <= endpoint.items.length ? Math.round(num) : undefined;
        const action = rawArgs.action === 'select' || itemNumber !== undefined ? 'select' : 'next';
        return {
          name: 'control_media_endpoint',
          args: {
            endpoint: endpoint.id,
            action,
            ...(itemNumber !== undefined ? { itemNumber } : {}),
            ...reasonArg,
          },
        };
      }

      case 'set_environment': {
        const tod = rawArgs.timeOfDay;
        const args: {
          timeOfDay?: TimeOfDay;
          presence?: Readonly<Record<string, boolean>>;
        } = {};
        if (tod === 'day' || tod === 'dusk' || tod === 'night') args.timeOfDay = tod;
        if (isRecord(rawArgs.presence)) {
          const presence: Record<string, boolean> = {};
          for (const [k, v] of Object.entries(rawArgs.presence)) {
            if (typeof v === 'boolean') presence[k] = v;
          }
          if (Object.keys(presence).length > 0) args.presence = presence;
        }
        return { name: 'set_environment', args };
      }

      case 'trigger_device': {
        const device = this.resolveDevice(rawArgs.device ?? rawArgs.id ?? rawArgs.name);
        return device ? { name: 'trigger_device', args: { device: device.id, ...reasonArg } } : null;
      }

      default:
        return null;
    }
  }

  public invokeToolCall(call: KNXToolCall): string {
    const pa = this.sourcePa;
    switch (call.name) {
      case 'recall_zone_scene': {
        const { zone, sceneIndex } = call.args;
        this.bus.recallZoneScene(zone, sceneIndex, pa, ASSISTANT_LOCATION);
        const label = this.zoneById.get(zone)?.scenes[sceneIndex]?.label ?? `Scene ${sceneIndex + 1}`;
        return `${this.zoneLabel(zone)} → ${label}`;
      }

      case 'set_zone_mode': {
        const { zone, mode } = call.args;
        if (mode === 'full') this.bus.setZoneFull(zone, pa, ASSISTANT_LOCATION);
        else if (mode === 'night') this.bus.enterZoneNight(zone, pa, ASSISTANT_LOCATION);
        else this.bus.setZoneOff(zone, pa);
        return `${this.zoneLabel(zone)} → ${mode === 'full' ? 'Full' : mode === 'night' ? 'Night' : 'Off'}`;
      }

      case 'set_circuit_levels': {
        const changes: string[] = [];
        for (const [id, pct] of Object.entries(call.args.levels)) {
          if (!this.circuitIds.has(id) || typeof pct !== 'number') continue;
          const circuitId = this.project.circuits.find((c) => c.id === id)?.id;
          if (!circuitId) continue;
          const clamped = clampPct(pct);
          this.bus.setCircuitLevel(circuitId, clamped, true, pa);
          changes.push(`${this.circuitLabel(circuitId)} ${clamped}%`);
        }
        return changes.join(', ');
      }

      case 'adjust_circuit_levels': {
        const current = this.bus.getTargetLevels();
        const changes: string[] = [];
        for (const id of call.args.circuits) {
          const next = clampPct((current[id] ?? 0) + call.args.deltaPct);
          this.bus.setCircuitLevel(id, next, true, pa);
          changes.push(`${this.circuitLabel(id)} ${next}%`);
        }
        return changes.join(', ');
      }

      case 'recall_scene': {
        const scenes = this.bus.getScenes();
        const idx = scenes.findIndex((s) => s.number === call.args.sceneNumber);
        const sceneIdx = idx >= 0 ? idx : call.args.sceneNumber - 1;
        this.bus.recallScene(sceneIdx, pa, ASSISTANT_LOCATION);
        const sc = scenes[sceneIdx];
        return sc ? `Recalled ${sc.code} (${sc.name})` : `Recalled Scene ${call.args.sceneNumber}`;
      }

      case 'set_master_state': {
        if (call.args.mode === 'all_full') {
          this.bus.handleMasterFull(ASSISTANT_LOCATION, pa);
          return 'All lights → 100% Full';
        }
        this.bus.handleMasterOff(ASSISTANT_LOCATION, pa);
        return 'Master off (night-walk dim where occupied)';
      }

      case 'save_scene_preset': {
        const scenes = this.bus.getScenes();
        const targetIdx =
          call.args.sceneNumber !== undefined
            ? scenes.findIndex((s) => s.number === call.args.sceneNumber)
            : undefined;
        const idx = targetIdx !== undefined && targetIdx >= 0 ? targetIdx : undefined;
        this.bus.saveCurrentLevelsToActiveScene(idx, pa);
        const saved = scenes[idx ?? Math.max(0, this.bus.getActiveSceneIndex())];
        return `Stored ${saved ? `${saved.code} (${saved.name})` : 'Scene'}`;
      }

      case 'control_cover': {
        const cover = this.resolveCover(call.args.cover);
        const label = cover?.shortName ?? cover?.name ?? call.args.cover;
        this.bus.setCoverOpen?.(call.args.cover, call.args.open, true, pa);
        this.onEnvironmentChanged?.();
        return `${label} → ${call.args.open ? 'Opening' : 'Closing'}`;
      }

      case 'control_media_endpoint': {
        const endpoint = this.resolveMediaEndpoint(call.args.endpoint);
        const label = endpoint?.name ?? call.args.endpoint;
        if (call.args.action === 'select' && call.args.itemNumber !== undefined) {
          this.bus.setMediaEndpointIndex?.(call.args.endpoint, call.args.itemNumber - 1, true, pa);
        } else {
          this.bus.cycleMediaEndpoint?.(call.args.endpoint, true, pa);
        }
        this.onEnvironmentChanged?.();
        const item = this.bus.getMediaEndpointItem?.(call.args.endpoint) ?? '';
        return item ? `${label} → "${item}"` : `${label} → updated`;
      }

      case 'set_environment': {
        const notes: string[] = [];
        const { timeOfDay, presence } = call.args;
        if (timeOfDay) {
          this.env.setTimeOfDay(timeOfDay);
          this.bus.setAmbientLux(TIME_OF_DAY_LUX[timeOfDay], true);
          notes.push(`Time → ${timeOfDay.toUpperCase()} (${TIME_OF_DAY_LUX[timeOfDay]} lx)`);
        }
        if (presence && this.bus.setPresence) {
          for (const [detectorPa, detected] of Object.entries(presence)) {
            this.bus.setPresence(detectorPa, detected);
            notes.push(`PIR ${detectorPa} → ${detected ? 'Motion' : 'Vacant'}`);
          }
        }
        this.onEnvironmentChanged?.();
        return notes.join(', ');
      }

      case 'trigger_device': {
        const device = this.resolveDevice(call.args.device);
        const name = device?.name ?? call.args.device;
        const ok = this.env.triggerDevice?.(call.args.device) ?? false;
        this.onEnvironmentChanged?.();
        return ok ? `${name} → triggered` : `${name} is busy`;
      }
    }
  }

  /** Parses a prompt without the model; exposed for tests and offline use. */
  public parseLocally(prompt: string): KNXToolCall[] {
    const lower = prompt.toLowerCase();
    const has = (re: RegExp): boolean => re.test(lower);
    const calls: KNXToolCall[] = [];

    const cover = this.matchCoverInPrompt(lower);
    if (cover) {
      calls.push({
        name: 'control_cover',
        args: { cover: cover.id, open: !has(/\b(?:close|shut|lock)\b/) },
      });
      return calls;
    }

    const mediaMatch = this.matchMediaEndpointInPrompt(prompt, lower);
    if (mediaMatch) {
      calls.push({
        name: 'control_media_endpoint',
        args:
          mediaMatch.itemIndex >= 0
            ? {
                endpoint: mediaMatch.endpoint.id,
                action: 'select',
                itemNumber: mediaMatch.itemIndex + 1,
              }
            : { endpoint: mediaMatch.endpoint.id, action: 'next' },
      });
      return calls;
    }

    const device = this.matchDeviceInPrompt(lower);
    if (device) {
      calls.push({ name: 'trigger_device', args: { device: device.id } });
      return calls;
    }

    const tod = /\b(?:make it|set (?:it |the time )?to|switch to|time to)\s+(day|daytime|dusk|sunset|night|nighttime)\b/.exec(lower);
    if (tod) {
      const t = tod[1] ?? 'dusk';
      calls.push({
        name: 'set_environment',
        args: { timeOfDay: t.startsWith('day') ? 'day' : t === 'dusk' || t === 'sunset' ? 'dusk' : 'night' },
      });
      return calls;
    }

    const pctMatch = /(\d{1,3})\s*(?:%|percent)/.exec(lower);
    const pct = pctMatch ? clampPct(Number(pctMatch[1])) : null;
    const wantsOff = has(/\b(?:off|dark)\b/);
    const wantsNight = has(/\bnight\s*(?:mode|light|lights)?\b/) && !wantsOff;
    const wantsFull = has(/\b(?:full|max|maximum|brightest|on)\b/);
    const relative = has(/\b(?:brighter|brighten|lighter|increase|raise|more)\b/)
      ? DEFAULT_RELATIVE_STEP_PCT
      : has(/\b(?:dim|dimmer|darker|lower|decrease|less|too bright)\b/)
        ? -DEFAULT_RELATIVE_STEP_PCT
        : 0;

    const zoneMatch = this.resolver.resolveZone(prompt);
    const circuitMatch = this.resolver.resolveCircuit(prompt);
    const queryTokens = new Set(tokeniseKnxName(prompt));
    const circuitFullyNamed =
      circuitMatch !== null && circuitMatch.matched.split(' ').every((t) => queryTokens.has(t));
    const preferCircuit =
      circuitMatch !== null &&
      (zoneMatch === null ||
        (circuitFullyNamed && circuitMatch.matched.split(' ').length > zoneMatch.matched.split(' ').length) ||
        circuitMatch.score > zoneMatch.score + 0.1);

    if (preferCircuit && circuitMatch) {
      const id = circuitMatch.id;
      if (pct !== null) calls.push({ name: 'set_circuit_levels', args: { levels: { [id]: pct } } });
      else if (wantsOff) calls.push({ name: 'set_circuit_levels', args: { levels: { [id]: 0 } } });
      else if (relative !== 0) calls.push({ name: 'adjust_circuit_levels', args: { circuits: [id], deltaPct: relative } });
      else calls.push({ name: 'set_circuit_levels', args: { levels: { [id]: 100 } } });
      return calls;
    }

    if (zoneMatch) {
      const zoneId = zoneMatch.id;
      const zone = this.zoneById.get(zoneId);
      if (pct !== null) {
        const levels: CircuitLevelsPartial = {};
        for (const id of this.circuitsOfZone(zoneId)) levels[id] = pct;
        calls.push({ name: 'set_circuit_levels', args: { levels } });
      } else if (wantsOff) {
        calls.push({ name: 'set_zone_mode', args: { zone: zoneId, mode: 'off' } });
      } else if (wantsNight) {
        calls.push({ name: 'set_zone_mode', args: { zone: zoneId, mode: 'night' } });
      } else if (relative !== 0) {
        calls.push({ name: 'adjust_circuit_levels', args: { circuits: this.circuitsOfZone(zoneId), deltaPct: relative } });
      } else {
        const scene = zone && zone.scenes.length > 0 ? this.resolver.resolveScene(zoneId, prompt) : null;
        const central = zone?.usesCentralSceneTable ? this.resolveCentralSceneNumber(prompt) : null;
        if (scene && !wantsFull) {
          calls.push({ name: 'recall_zone_scene', args: { zone: zoneId, sceneIndex: scene.index, sceneId: scene.id } });
        } else if (central !== null && !wantsFull) {
          calls.push({ name: 'recall_scene', args: { sceneNumber: central } });
        } else {
          calls.push({ name: 'set_zone_mode', args: { zone: zoneId, mode: 'full' } });
        }
      }
      return calls;
    }

    if (has(/\b(?:all\s+off|everything\s+off|good\s*night|lights\s+off|off)\b/)) {
      calls.push({ name: 'set_master_state', args: { mode: 'off' } });
      return calls;
    }
    if (has(/\b(?:all\s+on|everything\s+on|full\s+on|all\s+full)\b/)) {
      calls.push({ name: 'set_master_state', args: { mode: 'all_full' } });
      return calls;
    }
    const central = this.resolveCentralSceneNumber(prompt);
    if (central !== null) calls.push({ name: 'recall_scene', args: { sceneNumber: central } });
    return calls;
  }

  private executeFallbackLocalParser(prompt: string): AIAssistantExecutionResult {
    const calls = this.parseLocally(prompt);
    const { executedCalls, summaries } = this.runCalls(calls);
    return {
      prompt,
      modelUsed: 'local-fallback',
      executedCalls,
      reply:
        summaries.join(' · ') ||
        `Offline: I couldn’t match that to a room, light or scene — try ${buildDynamicExamples(this.project)}.`,
    };
  }
}

interface SpeechRecognitionAlternativeLike {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechRecognitionAlternativeLike | undefined;
}

interface SpeechRecognitionResultListLike {
  readonly length: number;
  readonly [index: number]: SpeechRecognitionResultLike | undefined;
}

interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
  readonly message?: string;
}

interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

interface WindowWithSpeechRecognition {
  readonly SpeechRecognition?: SpeechRecognitionConstructor;
  readonly webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

export class VoiceRecognitionController {
  private recognition: SpeechRecognitionInstance | null = null;
  private isListening = false;

  public constructor(
    onInterimTranscript: (text: string) => void,
    onFinalTranscript: (text: string) => void,
    onStateChange: (listening: boolean, errorMsg?: string) => void
  ) {
    const win = window as unknown as WindowWithSpeechRecognition;
    const Ctor = win.SpeechRecognition ?? win.webkitSpeechRecognition;
    if (!Ctor) {
      return;
    }

    const rec = new Ctor();
    rec.lang = 'en-GB';
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = (): void => {
      this.isListening = true;
      onStateChange(true);
    };

    rec.onend = (): void => {
      this.isListening = false;
      onStateChange(false);
    };

    rec.onerror = (event: SpeechRecognitionErrorEventLike): void => {
      this.isListening = false;
      onStateChange(false, event.error);
    };

    rec.onresult = (event: SpeechRecognitionEventLike): void => {
      let interim = '';
      let finalStr = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const alt = res ? res[0] : undefined;
        if (!res || !alt) continue;
        if (res.isFinal) {
          finalStr += alt.transcript;
        } else {
          interim += alt.transcript;
        }
      }

      if (interim) {
        onInterimTranscript(interim);
      }
      if (finalStr.trim()) {
        onFinalTranscript(finalStr.trim());
      }
    };

    this.recognition = rec;
  }

  public isSupported(): boolean {
    return this.recognition !== null;
  }

  public getIsListening(): boolean {
    return this.isListening;
  }

  public toggle(): void {
    if (!this.recognition) return;
    if (this.isListening) {
      this.recognition.stop();
    } else {
      try {
        this.recognition.start();
      } catch {
        // Already started
      }
    }
  }
}
