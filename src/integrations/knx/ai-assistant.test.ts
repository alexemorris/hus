import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CircuitConfig, CircuitId, ScenePreset, ZoneLightingMode, ZoneScenePreset } from '../../core/types/knx.ts';
import type { TimeOfDay } from '../../core/types/scene.ts';
import type { RoomZoneDefinition, RoomZoneId } from '../../core/types/topology.ts';
import {
  KNXAIAssistant,
  buildKnxAiTools,
  type KnxAssistantBus,
  type KnxAssistantEnvironment,
  type KnxAssistantProject,
} from './ai-assistant.ts';
import type { KnxLightingZone } from './project.ts';

function circuit(id: CircuitId, zoneId: RoomZoneId, name: string, shortName: string, aliases?: readonly string[]): CircuitConfig {
  return {
    id,
    channel: 1,
    name,
    shortName,
    location: name,
    buildingId: 'house',
    floorId: 'ground',
    zoneId,
    actuatorPa: '1.1.10',
    gaSwitch: '1/1/1',
    gaValue: '1/2/1',
    gaStatus: '1/3/1',
    isSceneMember: false,
    ...(aliases ? { aliases } : {}),
  };
}

function room(id: RoomZoneId, name: string): RoomZoneDefinition {
  return {
    id,
    name,
    shortName: name,
    buildingId: 'house',
    floorId: 'ground',
    knxAreaLine: '1.1',
    isInterior: true,
    bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1 },
  };
}

function zone(
  id: RoomZoneId,
  name: string,
  circuits: readonly CircuitId[],
  scenes: readonly ZoneScenePreset[] = [],
  extra: Partial<Pick<KnxLightingZone, 'aliases' | 'usesCentralSceneTable'>> = {},
): KnxLightingZone {
  return {
    id,
    name,
    circuits,
    scenes,
    nightLevels: {},
    ga: { scene: '0/0/1', sceneStatus: '0/0/2', night: '0/0/3', full: '0/0/4', status: '0/0/5', dim: '0/0/6' },
    ...extra,
  };
}

function centralScene(number: number, name: string): ScenePreset {
  return {
    index: number - 1,
    number,
    code: `S${number}`,
    name,
    shortLabel: name,
    isSwitchScene: number <= 3,
    levels: { kitchenPendants: 50, kitchenSpots: 50 },
  };
}

const AI_PA = '1.1.2';

const PROJECT: KnxAssistantProject = {
  name: 'Simple House',
  circuits: [
    circuit('kitchenPendants', 'kitchen', 'Kitchen Counter Pendants', 'Counter Pendants'),
    circuit('kitchenSpots', 'kitchen', 'Kitchen Ceiling Spotlights', 'Kitchen Spots'),
    circuit('livingDownlights', 'livingRoom', 'Living Room Downlights', 'Living Downlights', ['lounge downlights']),
    circuit('livingCoveStrip', 'livingRoom', 'Living Room Cove Strip', 'Cove Strip'),
    circuit('bedroomLamps', 'bedroom1', 'Primary Bedroom Table Lamps', 'Bedroom Lamps'),
    circuit('officeSpotlights', 'homeOffice', 'Home Office Spotlights', 'Office Spots'),
    circuit('hallwayPendant', 'hallway', 'Entrance Hall Pendant', 'Hall Pendant'),
  ],
  zones: [
    zone('kitchen', 'Kitchen', ['kitchenPendants', 'kitchenSpots'], [], { usesCentralSceneTable: true }),
    zone('livingRoom', 'Living Room', ['livingDownlights', 'livingCoveStrip'], [
      { id: 'bright', label: 'Bright', levels: {} },
      { id: 'cinema', label: 'Cinema', levels: {} },
    ]),
    zone('bedroom1', 'Primary Bedroom', ['bedroomLamps']),
    zone('homeOffice', 'Home Office', ['officeSpotlights']),
    zone('hallway', 'Entrance Hall', ['hallwayPendant'], [], { aliases: ['foyer'] }),
  ],
  rooms: [
    room('kitchen', 'Kitchen'),
    room('livingRoom', 'Living Room'),
    room('bedroom1', 'Primary Bedroom'),
    room('homeOffice', 'Home Office'),
    room('hallway', 'Entrance Hall'),
  ],
  centralScenes: [
    centralScene(1, 'Cooking'),
    centralScene(2, 'Dining'),
    centralScene(3, 'Lounge'),
    centralScene(6, 'Wine & Intimate'),
  ],
  covers: [
    {
      id: 'driveway-gates',
      name: 'Driveway Gates',
      pa: '1.1.22',
      gaCommand: '1/5/1',
      gaPosition: '1/5/2',
      travelDurationSec: 10,
      aliases: ['gates', 'driveway'],
    },
  ],
  mediaEndpoints: [
    {
      id: 'display-gallery',
      name: 'Gallery Display',
      pa: '1.1.12',
      gaSelect: '1/4/4',
      items: ['Coastal Dawn', 'Abstract Ochre', 'Forest Mist'],
      aliases: ['display', 'gallery', 'painting'],
    },
  ],
  centralPa: {
    ipInterface: '1.1.1',
    aiBridge: AI_PA,
    centralActuator: '1.1.10',
    centralSwitch: '1.1.11',
  },
};

type BusCall = readonly [string, ...unknown[]];

class FakeBus implements KnxAssistantBus {
  public readonly calls: BusCall[] = [];
  public levels: Partial<Record<CircuitId, number>> = { kitchenPendants: 50, livingCoveStrip: 90 };
  private readonly zoneStates = new Map<RoomZoneId, { mode: ZoneLightingMode; sceneIndex: number | null }>();

  public recallZoneScene(zoneId: RoomZoneId, sceneIndex: number, sourcePa?: string, location?: string): void {
    this.calls.push(['recallZoneScene', zoneId, sceneIndex, sourcePa, location]);
    this.zoneStates.set(zoneId, { mode: 'scene', sceneIndex });
  }
  public enterZoneNight(zoneId: RoomZoneId, sourcePa?: string): void {
    this.calls.push(['enterZoneNight', zoneId, sourcePa]);
  }
  public setZoneFull(zoneId: RoomZoneId, sourcePa?: string): void {
    this.calls.push(['setZoneFull', zoneId, sourcePa]);
  }
  public setZoneOff(zoneId: RoomZoneId, sourcePa?: string): void {
    this.calls.push(['setZoneOff', zoneId, sourcePa]);
  }
  public getZoneState(zoneId: RoomZoneId): { mode: ZoneLightingMode; sceneIndex: number | null } {
    return this.zoneStates.get(zoneId) ?? { mode: 'off', sceneIndex: null };
  }
  public recallScene(sceneIdx: number, sourcePa?: string): void {
    this.calls.push(['recallScene', sceneIdx, sourcePa]);
  }
  public setCircuitLevel(circuitId: CircuitId, pct: number, _emitBus?: boolean, sourcePa?: string): void {
    this.calls.push(['setCircuitLevel', circuitId, pct, sourcePa]);
    this.levels[circuitId] = pct;
  }
  public handleMasterFull(): void {
    this.calls.push(['masterFull']);
  }
  public handleMasterOff(): void {
    this.calls.push(['masterOff']);
  }
  public saveCurrentLevelsToActiveScene(targetSceneIdx?: number): void {
    this.calls.push(['save', targetSceneIdx]);
  }
  public getScenes(): readonly ScenePreset[] {
    return PROJECT.centralScenes;
  }
  public getActiveSceneIndex(): number {
    return 0;
  }
  public getTargetLevels(): Readonly<Partial<Record<CircuitId, number>>> {
    return this.levels;
  }
  public isCoverOpen(): boolean {
    return false;
  }
  public getCoverStatusLabel(): string {
    return 'Closed';
  }
  public setCoverOpen(id: string, open: boolean): boolean {
    this.calls.push(['setCoverOpen', id, open]);
    return true;
  }
  public isMediaEndpointActive(): boolean {
    return true;
  }
  public getMediaEndpointItem(): string {
    return 'Coastal Dawn';
  }
  public cycleMediaEndpoint(id: string): void {
    this.calls.push(['cycleMediaEndpoint', id]);
  }
  public setMediaEndpointIndex(id: string, index: number): void {
    this.calls.push(['setMediaEndpointIndex', id, index]);
  }
  public getAmbientLux(): number {
    return 5;
  }
  public setAmbientLux(lux: number): void {
    this.calls.push(['setAmbientLux', lux]);
  }
}

class FakeEnv implements KnxAssistantEnvironment {
  public timeOfDay: TimeOfDay | null = null;
  public setTimeOfDay(t: TimeOfDay): void {
    this.timeOfDay = t;
  }
}

let bus: FakeBus;
let env: FakeEnv;
let assistant: KNXAIAssistant;

beforeEach(() => {
  bus = new FakeBus();
  env = new FakeEnv();
  assistant = new KNXAIAssistant(bus, PROJECT, env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('generated tool schema', () => {
  it('lists every circuit, zone, cover, and media endpoint from the project', () => {
    const tools = buildKnxAiTools(PROJECT);
    const setLevels = tools.find((t) => t.name === 'set_circuit_levels');
    const levelProps = setLevels?.parameters.properties.levels.properties ?? {};
    expect(Object.keys(levelProps).sort()).toEqual(PROJECT.circuits.map((c) => c.id).sort());
    const zoneMode = tools.find((t) => t.name === 'set_zone_mode');
    expect(zoneMode?.parameters.properties.zone.enum).toEqual(PROJECT.zones.map((z) => z.id));
    const recall = tools.find((t) => t.name === 'recall_zone_scene');
    expect(recall?.parameters.properties.zone.enum).toEqual(['livingRoom']);
    expect(recall?.description).toContain('2=Cinema');
    expect(tools.find((t) => t.name === 'recall_scene')?.description).toContain('6=Wine & Intimate');
    expect(tools.find((t) => t.name === 'control_cover')?.parameters.properties.cover?.enum).toEqual(['driveway-gates']);
    expect(tools.find((t) => t.name === 'control_media_endpoint')?.parameters.properties.endpoint?.enum).toEqual([
      'display-gallery',
    ]);
  });

  it('system prompt names zones, scenes and circuits with live levels', () => {
    const prompt = assistant.buildSystemPrompt();
    expect(prompt).toContain('Simple House');
    expect(prompt).toContain('livingRoom "Living Room": 1 "Bright", 2 "Cinema"');
    expect(prompt).toContain('livingCoveStrip "Living Room Cove Strip" [livingRoom] — 90%');
    expect(prompt).toContain('hallway "Entrance Hall" (aka foyer)');
  });
});

describe('coerceRawFunctionCall', () => {
  it('resolves zone and scene names', () => {
    expect(assistant.coerceRawFunctionCall('recall_zone_scene', { zone: 'living room', scene: 'cinema' })).toEqual({
      name: 'recall_zone_scene',
      args: { zone: 'livingRoom', sceneIndex: 1, sceneId: 'cinema' },
    });
    expect(assistant.coerceRawFunctionCall('recall_zone_scene', { zone: 'livingRoom', scene: 1 })).toMatchObject({
      args: { sceneIndex: 0 },
    });
  });

  it('routes central-table zones to the central scene table', () => {
    expect(assistant.coerceRawFunctionCall('recall_zone_scene', { zone: 'kitchen', scene: 'romantic' })).toEqual({
      name: 'recall_scene',
      args: { sceneNumber: 6 },
    });
  });

  it('accepts nested or flat level maps with fuzzy circuit keys', () => {
    expect(
      assistant.coerceRawFunctionCall('set_circuit_levels', {
        levels: { kitchenPendants: 140, 'lounge downlights': '40' },
      }),
    ).toEqual({ name: 'set_circuit_levels', args: { levels: { kitchenPendants: 100, livingDownlights: 40 } } });
    expect(assistant.coerceRawFunctionCall('set_circuit_levels', { livingCoveStrip: 10, reason: 'r' })).toEqual({
      name: 'set_circuit_levels',
      args: { levels: { livingCoveStrip: 10 }, reason: 'r' },
    });
    expect(assistant.coerceRawFunctionCall('set_circuit_levels', { nonsense: 10 })).toBeNull();
  });

  it('adjust falls back to all circuits of a zone', () => {
    expect(assistant.coerceRawFunctionCall('adjust_circuit_levels', { zone: 'living room', deltaPct: -10 })).toEqual({
      name: 'adjust_circuit_levels',
      args: { circuits: ['livingDownlights', 'livingCoveStrip'], deltaPct: -10 },
    });
  });

  it('normalises zone modes', () => {
    expect(assistant.coerceRawFunctionCall('set_zone_mode', { zone: 'office', mode: 'on' })).toEqual({
      name: 'set_zone_mode',
      args: { zone: 'homeOffice', mode: 'full' },
    });
    expect(assistant.coerceRawFunctionCall('set_zone_mode', { zone: 'office', mode: 'party' })).toBeNull();
  });
});

describe('invokeToolCall', () => {
  it('drives zone objects with the AI bridge PA', () => {
    assistant.invokeToolCall({
      name: 'recall_zone_scene',
      args: { zone: 'livingRoom', sceneIndex: 1, sceneId: 'cinema' },
    });
    assistant.invokeToolCall({ name: 'set_zone_mode', args: { zone: 'hallway', mode: 'night' } });
    assistant.invokeToolCall({ name: 'set_zone_mode', args: { zone: 'hallway', mode: 'off' } });
    assistant.invokeToolCall({ name: 'set_zone_mode', args: { zone: 'hallway', mode: 'full' } });
    expect(bus.calls).toEqual([
      ['recallZoneScene', 'livingRoom', 1, AI_PA, 'AI Assistant'],
      ['enterZoneNight', 'hallway', AI_PA],
      ['setZoneOff', 'hallway', AI_PA],
      ['setZoneFull', 'hallway', AI_PA],
    ]);
  });

  it('adjusts relative to target levels and clamps', () => {
    const summary = assistant.invokeToolCall({
      name: 'adjust_circuit_levels',
      args: { circuits: ['livingCoveStrip', 'kitchenPendants'], deltaPct: 20 },
    });
    expect(bus.levels).toMatchObject({ livingCoveStrip: 100, kitchenPendants: 70 });
    expect(summary).toBe('Cove Strip 100%, Counter Pendants 70%');
  });

  it('environment changes go through the environment and notify', () => {
    const onEnv = vi.fn();
    const a = new KNXAIAssistant(bus, PROJECT, env, onEnv);
    a.invokeToolCall({ name: 'set_environment', args: { timeOfDay: 'dusk' } });
    expect(env.timeOfDay).toBe('dusk');
    expect(bus.calls).toContainEqual(['setAmbientLux', 38]);
    expect(onEnv).toHaveBeenCalledOnce();
  });
});

describe('offline parser', () => {
  it.each<[string, unknown]>([
    ['lounge downlights 40%', { name: 'set_circuit_levels', args: { levels: { livingDownlights: 40 } } }],
    ['turn the bedroom lamps off', { name: 'set_circuit_levels', args: { levels: { bedroomLamps: 0 } } }],
    ['office off', { name: 'set_zone_mode', args: { zone: 'homeOffice', mode: 'off' } }],
    ['entrance hall night mode', { name: 'set_zone_mode', args: { zone: 'hallway', mode: 'night' } }],
    ['foyer lights on', { name: 'set_zone_mode', args: { zone: 'hallway', mode: 'full' } }],
    ['cinema scene in the living room', { name: 'recall_zone_scene', args: { zone: 'livingRoom', sceneIndex: 1, sceneId: 'cinema' } }],
    ['dim the cove strip', { name: 'adjust_circuit_levels', args: { circuits: ['livingCoveStrip'], deltaPct: -20 } }],
    ['kitchen dining', { name: 'recall_scene', args: { sceneNumber: 2 } }],
    ['something romantic', { name: 'recall_scene', args: { sceneNumber: 6 } }],
    ['open the gates', { name: 'control_cover', args: { cover: 'driveway-gates', open: true } }],
    ['good night', { name: 'set_master_state', args: { mode: 'off' } }],
    ['next painting on the display', { name: 'control_media_endpoint', args: { endpoint: 'display-gallery', action: 'next' } }],
    ['make it dusk', { name: 'set_environment', args: { timeOfDay: 'dusk' } }],
  ])('%s', (prompt, expected) => {
    expect(assistant.parseLocally(prompt)).toEqual([expected]);
  });

  it('does nothing for unmatched prompts', () => {
    expect(assistant.parseLocally('what is the weather')).toEqual([]);
  });

  it('executeCommand falls back offline when the proxy is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const result = await assistant.executeCommand('office off');
    expect(result.modelUsed).toBe('local-fallback');
    expect(bus.calls).toEqual([['setZoneOff', 'homeOffice', AI_PA]]);
    expect(result.reply).toBe('Home Office → Off');
  });
});

describe('executeCommand with model output', () => {
  it('coerces and executes model function calls', async () => {
    const body = {
      modelVersion: 'gemini-test',
      candidates: [
        {
          content: {
            parts: [
              { functionCall: { name: 'set_zone_mode', args: { zone: 'living room', mode: 'full', reason: 'Bright for reading.' } } },
              { functionCall: { name: 'set_circuit_levels', args: { levels: { 'bedroom lamps': 30 } } } },
              { functionCall: { name: 'bogus_tool', args: {} } },
            ],
          },
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) });
    vi.stubGlobal('fetch', fetchMock);
    const result = await assistant.executeCommand('living room bright, bedroom lamps 30');
    expect(result.modelUsed).toBe('gemini-test');
    expect(result.executedCalls.map((c) => c.formatted)).toEqual([
      'set_zone_mode({"zone":"livingRoom","mode":"full"})',
      'set_circuit_levels({"levels":{"bedroomLamps":30}})',
    ]);
    expect(result.reply).toBe('Bright for reading. (Living Room → Full · Bedroom Lamps 30%)');
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as {
      vertexRequest: { tools: { functionDeclarations: { name: string }[] }[] };
    };
    expect(sent.vertexRequest.tools[0].functionDeclarations.map((d) => d.name)).toContain('recall_zone_scene');
  });
});

describe('scene devices (trigger_device)', () => {
  class DeviceEnv extends FakeEnv {
    public readonly triggered: string[] = [];
    public listDevices(): readonly { id: string; name: string; aliases: readonly string[] }[] {
      return [{ id: 'record-player', name: 'Record player', aliases: ['spin vinyl', 'play record', 'turntable'] }];
    }
    public triggerDevice(id: string): boolean {
      this.triggered.push(id);
      return true;
    }
  }

  it('adds a trigger_device tool only when the environment has devices', () => {
    expect(assistant.getTools().map((t) => t.name)).not.toContain('trigger_device');
    const a = new KNXAIAssistant(bus, PROJECT, new DeviceEnv());
    const tool = a.getTools().find((t) => t.name === 'trigger_device');
    expect(tool?.parameters.properties.device?.enum).toEqual(['record-player']);
  });

  it.each(['play record', 'spin vinyl!', 'turntable please', 'record player'])(
    'offline parser: "%s" triggers the device',
    (prompt) => {
      const devEnv = new DeviceEnv();
      const a = new KNXAIAssistant(bus, PROJECT, devEnv);
      const calls = a.parseLocally(prompt);
      expect(calls).toEqual([{ name: 'trigger_device', args: { device: 'record-player' } }]);
      expect(a.invokeToolCall(calls[0]!)).toBe('Record player → triggered');
      expect(devEnv.triggered).toEqual(['record-player']);
    },
  );

  it('does not hijack lighting prompts', () => {
    const a = new KNXAIAssistant(bus, PROJECT, new DeviceEnv());
    expect(a.parseLocally('lounge downlights 40%').map((c) => c.name)).not.toContain('trigger_device');
  });

  it('coerces model calls by alias', () => {
    const a = new KNXAIAssistant(bus, PROJECT, new DeviceEnv());
    expect(a.coerceRawFunctionCall('trigger_device', { device: 'play record' })).toEqual({
      name: 'trigger_device',
      args: { device: 'record-player' },
    });
    expect(a.coerceRawFunctionCall('trigger_device', { device: 'jukebox' })).toBeNull();
  });
});
