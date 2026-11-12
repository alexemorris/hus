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
    buildingId: 'mainHouse',
    floorId: 'ground',
    zoneId,
    actuatorPa: '1.1.20',
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
    buildingId: 'mainHouse',
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
    levels: { islandPendants: 50, sittingPendants: 50, bifoldUplights: 50, spotlights: 50, underCabinet: 50, aboveCabinet: 50 },
  };
}

const AI_PA = '1.1.2';

const PROJECT: KnxAssistantProject = {
  name: 'Test Farm',
  circuits: [
    circuit('islandPendants', 'kitchen', 'Blue Island Pendants', 'Island Pendants'),
    circuit('spotlights', 'kitchen', 'Kitchen Ceiling Spotlights', 'Kitchen Spots'),
    circuit('barnTrussAndSimHalo', 'outbuildingBarn', 'Barn Truss Spotlights & Pool Light', 'Barn Truss', ['barn downlights']),
    circuit('golfSimHalo', 'outbuildingBarn', 'Golf Simulator LED Halo', 'Sim Halo'),
    circuit('mezzanineLamps5A', 'outbuildingMezzanine', 'Barn Mezzanine 5V/5A Lamp Sockets', 'Mezz Lamps'),
    circuit('stableOfficeSpotlights', 'outbuildingStableOffice', 'Stable Office Spotlights', 'Office Spots'),
    circuit('studyPendant', 'study', 'Plant Room Pendant', 'Plant Pendant'),
  ],
  zones: [
    zone('kitchen', 'Kitchen', ['islandPendants', 'spotlights'], [], { usesCentralSceneTable: true }),
    zone('outbuildingBarn', 'Barn', ['barnTrussAndSimHalo', 'golfSimHalo'], [
      { id: 'bright', label: 'Bright', levels: {} },
      { id: 'golf', label: 'Golf Sim', levels: {} },
    ]),
    zone('outbuildingMezzanine', 'Mezzanine', ['mezzanineLamps5A']),
    zone('outbuildingStableOffice', 'Stable Office', ['stableOfficeSpotlights']),
    zone('study', 'Plant Room', ['studyPendant'], [], { aliases: ['study'] }),
  ],
  rooms: [
    room('kitchen', 'Kitchen'),
    room('outbuildingBarn', 'Games Barn'),
    room('outbuildingMezzanine', 'Barn Mezzanine'),
    room('outbuildingStableOffice', 'Stable Office'),
    room('study', 'Plant Room'),
  ],
  centralScenes: [centralScene(1, 'Cooking'), centralScene(2, 'Dining'), centralScene(3, 'Lounge'), centralScene(6, 'Wine & Intimate')],
  centralPa: {
    ipInterface: '1.1.1',
    aiBridge: AI_PA,
    kitchenSwitchGroup: '1.1.10',
    kitchenPresence: '1.1.12',
    utilityPresence: '1.1.13',
    utilitySwitch: '1.1.11',
    courtyardSwitch: '1.1.14',
    kitchenActuator: '1.1.20',
    carGates: '1.1.22',
  },
};

type BusCall = readonly [string, ...unknown[]];

class FakeBus implements KnxAssistantBus {
  public readonly calls: BusCall[] = [];
  public levels: Partial<Record<CircuitId, number>> = { islandPendants: 50, golfSimHalo: 90 };
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
  public handleSwitchLongPressHoldUp(): void {
    this.calls.push(['holdUp']);
  }
  public handleSwitchLongPressHoldDown(): void {
    this.calls.push(['holdDown']);
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
  public setTvArtIndex(index: number): void {
    this.calls.push(['setTvArtIndex', index]);
  }
  public cycleTvArt(): void {
    this.calls.push(['cycleTvArt']);
  }
  public getTvArtTitle(): string {
    return 'Nocturne';
  }
  public getTvArtIndex(): number {
    return 0;
  }
  public isTvArtModeActive(): boolean {
    return false;
  }
  public setCarGatesOpen(open: boolean): boolean {
    this.calls.push(['setCarGatesOpen', open]);
    return true;
  }
  public getCarGatesStatusLabel(): string {
    return 'Closed';
  }
  public getAmbientLux(): number {
    return 5;
  }
  public setAmbientLux(lux: number): void {
    this.calls.push(['setAmbientLux', lux]);
  }
  public getKitchenMotionDetected(): boolean {
    return false;
  }
  public getUtilityMotionDetected(): boolean {
    return false;
  }
  public setKitchenMotionDetected(detected: boolean): void {
    this.calls.push(['kitchenMotion', detected]);
  }
  public setUtilityMotionDetected(detected: boolean): void {
    this.calls.push(['utilityMotion', detected]);
  }
}

class FakeEnv implements KnxAssistantEnvironment {
  public bifolds = false;
  public timeOfDay: TimeOfDay | null = null;
  public setTimeOfDay(t: TimeOfDay): void {
    this.timeOfDay = t;
  }
  public isBifoldsOpen(): boolean {
    return this.bifolds;
  }
  public toggleBifolds(): void {
    this.bifolds = !this.bifolds;
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
  it('lists every circuit and zone from the project', () => {
    const tools = buildKnxAiTools(PROJECT);
    const setLevels = tools.find((t) => t.name === 'set_circuit_levels');
    const levelProps = setLevels?.parameters.properties.levels.properties ?? {};
    expect(Object.keys(levelProps).sort()).toEqual(PROJECT.circuits.map((c) => c.id).sort());
    const zoneMode = tools.find((t) => t.name === 'set_zone_mode');
    expect(zoneMode?.parameters.properties.zone.enum).toEqual(PROJECT.zones.map((z) => z.id));
    const recall = tools.find((t) => t.name === 'recall_zone_scene');
    expect(recall?.parameters.properties.zone.enum).toEqual(['outbuildingBarn']);
    expect(recall?.description).toContain('2=Golf Sim');
    expect(tools.find((t) => t.name === 'recall_scene')?.description).toContain('6=Wine & Intimate');
  });

  it('system prompt names zones, scenes and circuits with live levels', () => {
    const prompt = assistant.buildSystemPrompt();
    expect(prompt).toContain('Test Farm');
    expect(prompt).toContain('outbuildingBarn "Barn": 1 "Bright", 2 "Golf Sim"');
    expect(prompt).toContain('golfSimHalo "Golf Simulator LED Halo" [outbuildingBarn] — 90%');
    expect(prompt).toContain('study "Plant Room" (aka study)');
  });
});

describe('coerceRawFunctionCall', () => {
  it('resolves zone and scene names', () => {
    expect(assistant.coerceRawFunctionCall('recall_zone_scene', { zone: 'games barn', scene: 'golf sim' })).toEqual({
      name: 'recall_zone_scene',
      args: { zone: 'outbuildingBarn', sceneIndex: 1, sceneId: 'golf' },
    });
    expect(assistant.coerceRawFunctionCall('recall_zone_scene', { zone: 'outbuildingBarn', scene: 1 })).toMatchObject({
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
      assistant.coerceRawFunctionCall('set_circuit_levels', { levels: { islandPendants: 140, 'barn downlights': '40' } }),
    ).toEqual({ name: 'set_circuit_levels', args: { levels: { islandPendants: 100, barnTrussAndSimHalo: 40 } } });
    expect(assistant.coerceRawFunctionCall('set_circuit_levels', { golfSimHalo: 10, reason: 'r' })).toEqual({
      name: 'set_circuit_levels',
      args: { levels: { golfSimHalo: 10 }, reason: 'r' },
    });
    expect(assistant.coerceRawFunctionCall('set_circuit_levels', { nonsense: 10 })).toBeNull();
  });

  it('adjust falls back to all circuits of a zone', () => {
    expect(assistant.coerceRawFunctionCall('adjust_circuit_levels', { zone: 'barn', deltaPct: -10 })).toEqual({
      name: 'adjust_circuit_levels',
      args: { circuits: ['barnTrussAndSimHalo', 'golfSimHalo'], deltaPct: -10 },
    });
  });

  it('normalises zone modes', () => {
    expect(assistant.coerceRawFunctionCall('set_zone_mode', { zone: 'office', mode: 'on' })).toEqual({
      name: 'set_zone_mode',
      args: { zone: 'outbuildingStableOffice', mode: 'full' },
    });
    expect(assistant.coerceRawFunctionCall('set_zone_mode', { zone: 'office', mode: 'party' })).toBeNull();
  });
});

describe('invokeToolCall', () => {
  it('drives zone objects with the AI bridge PA', () => {
    assistant.invokeToolCall({ name: 'recall_zone_scene', args: { zone: 'outbuildingBarn', sceneIndex: 1, sceneId: 'golf' } });
    assistant.invokeToolCall({ name: 'set_zone_mode', args: { zone: 'study', mode: 'night' } });
    assistant.invokeToolCall({ name: 'set_zone_mode', args: { zone: 'study', mode: 'off' } });
    assistant.invokeToolCall({ name: 'set_zone_mode', args: { zone: 'study', mode: 'full' } });
    expect(bus.calls).toEqual([
      ['recallZoneScene', 'outbuildingBarn', 1, AI_PA, 'AI Assistant'],
      ['enterZoneNight', 'study', AI_PA],
      ['setZoneOff', 'study', AI_PA],
      ['setZoneFull', 'study', AI_PA],
    ]);
  });

  it('adjusts relative to target levels and clamps', () => {
    const summary = assistant.invokeToolCall({
      name: 'adjust_circuit_levels',
      args: { circuits: ['golfSimHalo', 'islandPendants'], deltaPct: 20 },
    });
    expect(bus.levels).toMatchObject({ golfSimHalo: 100, islandPendants: 70 });
    expect(summary).toBe('Sim Halo 100%, Island Pendants 70%');
  });

  it('environment changes go through the environment and notify', () => {
    const onEnv = vi.fn();
    const a = new KNXAIAssistant(bus, PROJECT, env, onEnv);
    a.invokeToolCall({ name: 'set_environment', args: { timeOfDay: 'dusk', bifoldsOpen: true } });
    expect(env.timeOfDay).toBe('dusk');
    expect(env.bifolds).toBe(true);
    expect(bus.calls).toContainEqual(['setAmbientLux', 38]);
    expect(onEnv).toHaveBeenCalledOnce();
  });
});

describe('offline parser', () => {
  it.each<[string, unknown]>([
    ['barn downlights 40%', { name: 'set_circuit_levels', args: { levels: { barnTrussAndSimHalo: 40 } } }],
    ['turn the mezzanine lamps off', { name: 'set_circuit_levels', args: { levels: { mezzanineLamps5A: 0 } } }],
    ['office off', { name: 'set_zone_mode', args: { zone: 'outbuildingStableOffice', mode: 'off' } }],
    ['plant room night mode', { name: 'set_zone_mode', args: { zone: 'study', mode: 'night' } }],
    ['study lights on', { name: 'set_zone_mode', args: { zone: 'study', mode: 'full' } }],
    ['golf sim scene in the barn', { name: 'recall_zone_scene', args: { zone: 'outbuildingBarn', sceneIndex: 1, sceneId: 'golf' } }],
    ['dim the golf sim', { name: 'adjust_circuit_levels', args: { circuits: ['golfSimHalo'], deltaPct: -20 } }],
    ['kitchen dining', { name: 'recall_scene', args: { sceneNumber: 2 } }],
    ['something romantic', { name: 'recall_scene', args: { sceneNumber: 6 } }],
    ['open the gates', { name: 'set_environment', args: { carGatesOpen: true } }],
    ['good night', { name: 'set_master_state', args: { mode: 'off' } }],
    ['next painting on the tv', { name: 'control_tv_art', args: { action: 'next' } }],
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
    expect(bus.calls).toEqual([['setZoneOff', 'outbuildingStableOffice', AI_PA]]);
    expect(result.reply).toBe('Stable Office → Off');
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
              { functionCall: { name: 'set_zone_mode', args: { zone: 'barn', mode: 'full', reason: 'Bright for games.' } } },
              { functionCall: { name: 'set_circuit_levels', args: { levels: { 'mezzanine lamps': 30 } } } },
              { functionCall: { name: 'bogus_tool', args: {} } },
            ],
          },
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) });
    vi.stubGlobal('fetch', fetchMock);
    const result = await assistant.executeCommand('barn bright, mezzanine lamps 30');
    expect(result.modelUsed).toBe('gemini-test');
    expect(result.executedCalls.map((c) => c.formatted)).toEqual([
      'set_zone_mode({"zone":"outbuildingBarn","mode":"full"})',
      'set_circuit_levels({"levels":{"mezzanineLamps5A":30}})',
    ]);
    expect(result.reply).toBe('Bright for games. (Barn → Full · Mezz Lamps 30%)');
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
      return [{ id: 'pool-table-break', name: 'Pool table', aliases: ['break', 'play pool', 'rack the balls'] }];
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
    expect(tool?.parameters.properties.device?.enum).toEqual(['pool-table-break']);
  });

  it.each(['play pool', 'Break!', 'rack the balls please', 'pool table'])('offline parser: "%s" triggers the pool table', (prompt) => {
    const devEnv = new DeviceEnv();
    const a = new KNXAIAssistant(bus, PROJECT, devEnv);
    const calls = a.parseLocally(prompt);
    expect(calls).toEqual([{ name: 'trigger_device', args: { device: 'pool-table-break' } }]);
    expect(a.invokeToolCall(calls[0]!)).toBe('Pool table → triggered');
    expect(devEnv.triggered).toEqual(['pool-table-break']);
  });

  it('does not hijack lighting prompts', () => {
    const a = new KNXAIAssistant(bus, PROJECT, new DeviceEnv());
    expect(a.parseLocally('barn downlights 40%').map((c) => c.name)).not.toContain('trigger_device');
  });

  it('coerces model calls by alias', () => {
    const a = new KNXAIAssistant(bus, PROJECT, new DeviceEnv());
    expect(a.coerceRawFunctionCall('trigger_device', { device: 'play pool' })).toEqual({
      name: 'trigger_device',
      args: { device: 'pool-table-break' },
    });
    expect(a.coerceRawFunctionCall('trigger_device', { device: 'jukebox' })).toBeNull();
  });
});
