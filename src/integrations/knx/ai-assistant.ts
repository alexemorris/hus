import type { CircuitId, ScenePreset, ZoneLightingMode } from '../../core/types/knx.ts';
import type { TimeOfDay } from '../../core/types/scene.ts';
import type { RoomZoneId } from '../../core/types/topology.ts';
import { type KNXPropertyBusController, TV_ARTWORKS } from './emulator.ts';
import { createKnxNameResolver, tokeniseKnxName, type KnxNameResolver } from './name-resolver.ts';
import type { KnxLightingZone, KnxProject } from './project.ts';

/**
 * Natural-language KNX assistant (the "AI bridge" device on the bus).
 *
 * Everything the model sees — tool schema, circuit / zone / scene lists, live state — is generated
 * from the {@link KnxProject}, so new fittings, circuits and zones need no changes here. When the
 * Vertex proxy is unreachable an offline parser built on {@link createKnxNameResolver} handles the
 * common commands ("barn downlights 40%", "office off", "kitchen night mode").
 */

// -----------------------------------------------------------------------------
// Public contract
// -----------------------------------------------------------------------------

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
  | 'handleSwitchLongPressHoldUp'
  | 'handleSwitchLongPressHoldDown'
  | 'saveCurrentLevelsToActiveScene'
  | 'getScenes'
  | 'getActiveSceneIndex'
  | 'setTvArtIndex'
  | 'cycleTvArt'
  | 'getTvArtTitle'
  | 'getTvArtIndex'
  | 'isTvArtModeActive'
  | 'setCarGatesOpen'
  | 'getCarGatesStatusLabel'
  | 'getAmbientLux'
  | 'setAmbientLux'
  | 'getKitchenMotionDetected'
  | 'getUtilityMotionDetected'
  | 'setKitchenMotionDetected'
  | 'setUtilityMotionDetected'
> &
  KnxAssistantZoneBus & {
    getTargetLevels(): Readonly<Partial<Record<CircuitId, number>>>;
  };

/** A non-KNX scene device the assistant can trigger by name (e.g. the barn pool-table break). */
export interface KnxAssistantDevice {
  /** Interactable id passed to {@link KnxAssistantEnvironment.triggerDevice}. */
  readonly id: string;
  readonly name: string;
  /** Phrases that trigger it ("play pool", "rack the balls"). */
  readonly aliases: readonly string[];
}

/** Non-KNX simulator state the assistant may change (sky preset, bifold doors, scene devices). */
export interface KnxAssistantEnvironment {
  setTimeOfDay(timeOfDay: TimeOfDay): void;
  isBifoldsOpen(): boolean;
  toggleBifolds(): void;
  /** Scene devices with natural-language aliases (read lazily: they register as the scene builds). */
  listDevices?(): readonly KnxAssistantDevice[];
  /** Triggers a device's action (click equivalent). Returns false if it ignored the request. */
  triggerDevice?(id: string): boolean;
}

/** The parts of a {@link KnxProject} the assistant reads (a full project satisfies it). */
export type KnxAssistantProject = Pick<
  KnxProject,
  'name' | 'circuits' | 'zones' | 'rooms' | 'centralScenes' | 'centralPa'
>;

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
      readonly name: 'control_tv_art';
      readonly args: { readonly action: 'next' | 'select'; readonly artNumber?: number };
    }
  | {
      readonly name: 'set_environment';
      readonly args: {
        readonly timeOfDay?: TimeOfDay;
        readonly kitchenMotion?: boolean;
        readonly utilityMotion?: boolean;
        readonly bifoldsOpen?: boolean;
        readonly carGatesOpen?: boolean;
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

// -----------------------------------------------------------------------------
// Internals
// -----------------------------------------------------------------------------

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

/** Mood words → words that appear in legacy central scene names. */
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

// -----------------------------------------------------------------------------
// Tool schema (generated from the project)
// -----------------------------------------------------------------------------

/** Builds the Gemini function declarations for a project. */
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
        description: `Recall a scene from the central (kitchen open-plan) actuator scene table: ${centralDesc}.`,
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

  tools.push(
    {
      name: 'set_master_state',
      description: 'Whole-house master objects: "all_full" = every circuit 100 %, "off" = master off (night-walk dim where occupied).',
      parameters: {
        type: 'OBJECT',
        properties: {
          mode: { type: 'STRING', enum: ['all_full', 'off'], description: 'Master mode.' },
          reason,
        },
        required: ['mode'],
      },
    },
    {
      name: 'control_tv_art',
      description: `Cycle or select the Frame TV artwork: ${TV_ARTWORKS.map((t, i) => `${i + 1}=${t}`).join(', ')}.`,
      parameters: {
        type: 'OBJECT',
        properties: {
          action: { type: 'STRING', enum: ['next', 'select'], description: '"next" cycles, "select" uses artNumber.' },
          artNumber: { type: 'INTEGER', description: `1-${TV_ARTWORKS.length}.` },
        },
        required: ['action'],
      },
    },
    {
      name: 'set_environment',
      description:
        'Simulator environment: time of day (ambient lux), kitchen / utility presence, bifold doors, motorised car gates.',
      parameters: {
        type: 'OBJECT',
        properties: {
          timeOfDay: {
            type: 'STRING',
            enum: ['day', 'dusk', 'night'],
            description: `day (${TIME_OF_DAY_LUX.day} lx), dusk (${TIME_OF_DAY_LUX.dusk} lx) or night (${TIME_OF_DAY_LUX.night} lx).`,
          },
          kitchenMotion: { type: 'BOOLEAN', description: 'Kitchen presence detector state.' },
          utilityMotion: { type: 'BOOLEAN', description: 'Utility presence detector state.' },
          bifoldsOpen: { type: 'BOOLEAN', description: 'Open (true) or close (false) the bifold doors.' },
          carGatesOpen: { type: 'BOOLEAN', description: 'Open (true) or close (false) the car gates.' },
        },
      },
    },
  );
  return tools;
}

// -----------------------------------------------------------------------------
// Assistant
// -----------------------------------------------------------------------------

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
      const scenes = z.usesCentralSceneTable
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
    lines.push(
      '',
      'ENVIRONMENT:',
      `- Ambient light ${this.bus.getAmbientLux()} lx`,
      `- Kitchen presence: ${this.bus.getKitchenMotionDetected() ? 'occupied' : 'vacant'}; utility presence: ${this.bus.getUtilityMotionDetected() ? 'occupied' : 'vacant'}`,
      `- Frame TV: ${this.bus.isTvArtModeActive() ? `Art mode "${this.bus.getTvArtTitle()}"` : 'standby'}`,
      `- Bifold doors: ${this.env.isBifoldsOpen() ? 'open' : 'closed'}; car gates: ${this.bus.getCarGatesStatusLabel()}`,
      '',
      'INSTRUCTIONS:',
      '1. Always call one or more tools to fulfil the request.',
      '2. For a whole room prefer recall_zone_scene (named moods) or set_zone_mode (full / night / off).',
      '3. For specific fittings use set_circuit_levels (absolute) or adjust_circuit_levels (relative).',
      '4. Switched-only circuits accept just 0 or 100.',
      '5. Populate `reason` with one short sentence.',
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
        reply:
          'Ready. Ask naturally (e.g. "barn downlights to 40%", "office off", "make the kitchen cosy and put the nocturne on the TV").',
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

  // --- Name coercion ---------------------------------------------------------------------------

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

      case 'control_tv_art': {
        const num = toNumber(rawArgs.artNumber);
        const artNumber = num !== null && num >= 1 && num <= TV_ARTWORKS.length ? Math.round(num) : undefined;
        const action = rawArgs.action === 'select' || artNumber !== undefined ? 'select' : 'next';
        return { name: 'control_tv_art', args: { action, ...(artNumber !== undefined ? { artNumber } : {}) } };
      }

      case 'set_environment': {
        const tod = rawArgs.timeOfDay;
        const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
        const args: {
          timeOfDay?: TimeOfDay;
          kitchenMotion?: boolean;
          utilityMotion?: boolean;
          bifoldsOpen?: boolean;
          carGatesOpen?: boolean;
        } = {};
        if (tod === 'day' || tod === 'dusk' || tod === 'night') args.timeOfDay = tod;
        const km = bool(rawArgs.kitchenMotion);
        if (km !== undefined) args.kitchenMotion = km;
        const um = bool(rawArgs.utilityMotion);
        if (um !== undefined) args.utilityMotion = um;
        const bo = bool(rawArgs.bifoldsOpen);
        if (bo !== undefined) args.bifoldsOpen = bo;
        const cg = bool(rawArgs.carGatesOpen);
        if (cg !== undefined) args.carGatesOpen = cg;
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

  // --- Execution -------------------------------------------------------------------------------

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
          this.bus.handleSwitchLongPressHoldUp(ASSISTANT_LOCATION, pa);
          return 'All lights → 100% Full';
        }
        this.bus.handleSwitchLongPressHoldDown(ASSISTANT_LOCATION, pa);
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

      case 'control_tv_art': {
        if (call.args.action === 'select' && call.args.artNumber !== undefined) {
          this.bus.setTvArtIndex(call.args.artNumber - 1, true, pa);
        } else {
          this.bus.cycleTvArt(true, pa);
        }
        return `TV Art → "${this.bus.getTvArtTitle()}"`;
      }

      case 'set_environment': {
        const notes: string[] = [];
        const { timeOfDay, kitchenMotion, utilityMotion, bifoldsOpen, carGatesOpen } = call.args;
        if (timeOfDay) {
          this.env.setTimeOfDay(timeOfDay);
          this.bus.setAmbientLux(TIME_OF_DAY_LUX[timeOfDay], true);
          notes.push(`Time → ${timeOfDay.toUpperCase()} (${TIME_OF_DAY_LUX[timeOfDay]} lx)`);
        }
        if (kitchenMotion !== undefined) {
          this.bus.setKitchenMotionDetected(kitchenMotion);
          notes.push(`Kitchen PIR → ${kitchenMotion ? 'Motion' : 'Vacant'}`);
        }
        if (utilityMotion !== undefined) {
          this.bus.setUtilityMotionDetected(utilityMotion);
          notes.push(`Utility PIR → ${utilityMotion ? 'Motion' : 'Vacant'}`);
        }
        if (bifoldsOpen !== undefined) {
          if (this.env.isBifoldsOpen() !== bifoldsOpen) this.env.toggleBifolds();
          notes.push(`Bifolds → ${bifoldsOpen ? 'Open' : 'Closed'}`);
        }
        if (carGatesOpen !== undefined) {
          this.bus.setCarGatesOpen(carGatesOpen, true, pa);
          notes.push(`Car gates → ${carGatesOpen ? 'Opening' : 'Closing'}`);
        }
        this.onEnvironmentChanged?.();
        return notes.join(', ');
      }

      case 'trigger_device': {
        const device = this.resolveDevice(call.args.device);
        const name = device?.name ?? call.args.device;
        const ok = this.env.triggerDevice?.(call.args.device) ?? false;
        return ok ? `${name} → triggered` : `${name} is busy`;
      }
    }
  }

  // --- Offline parser --------------------------------------------------------------------------

  /** Parses a prompt without the model; exposed for tests and offline use. */
  public parseLocally(prompt: string): KNXToolCall[] {
    const lower = prompt.toLowerCase();
    const has = (re: RegExp): boolean => re.test(lower);
    const calls: KNXToolCall[] = [];

    const device = this.matchDeviceInPrompt(lower);
    if (device) {
      calls.push({ name: 'trigger_device', args: { device: device.id } });
      return calls;
    }
    if (has(/\b(?:gate|gates|driveway)\b/)) {
      calls.push({ name: 'set_environment', args: { carGatesOpen: !has(/\b(?:close|shut|lock)\b/) } });
      return calls;
    }
    if (has(/\b(?:bifold|bifolds)\b/) && has(/\b(?:open|close|shut)\b/)) {
      calls.push({ name: 'set_environment', args: { bifoldsOpen: !has(/\b(?:close|shut)\b/) } });
      return calls;
    }
    if (has(/\b(?:tv|telly|artwork|painting|art)\b/)) {
      const queryTokens = new Set(tokeniseKnxName(prompt));
      const artIdx = TV_ARTWORKS.findIndex((title) => tokeniseKnxName(title).some((t) => queryTokens.has(t) && t.length > 3));
      calls.push({
        name: 'control_tv_art',
        args: artIdx >= 0 ? { action: 'select', artNumber: artIdx + 1 } : { action: 'next' },
      });
      return calls;
    }
    const tod = /\b(?:make it|set (?:it |the time )?to|switch to|time to)\s+(day|daytime|dusk|sunset|night|nighttime)\b/.exec(lower);
    if (tod) {
      const t = tod[1];
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
        'Offline: I couldn’t match that to a room, light or scene — try "kitchen full", "office off" or "barn downlights 40%".',
    };
  }
}

export { TV_ARTWORKS };

// -----------------------------------------------------------------------------
// Voice input (Web Speech API, strictly typed)
// -----------------------------------------------------------------------------

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
