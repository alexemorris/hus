/**
 * Protocol-agnostic electrical system & circuit continuity bus.
 *
 * Models physical switches, multi-gang wall plates, conventional mains wiring
 * topologies (1-way SPST, 2-way traveller pairs, 3-way+ intermediate crossover
 * chains), series rotary/trailing-edge dimmers, bus-driven channels, and room
 * lighting zones/scenes in canonical [0..1] brightness units without requiring
 * KNX or any external smart-home protocol.
 */

export type SwitchGangPose = 'up' | 'down';

export type ElectricalLayerKind =
  | 'pendants'
  | 'downlights'
  | 'spots'
  | 'battens'
  | 'wall'
  | 'picture'
  | 'shelf'
  | 'cove'
  | 'strip'
  | 'step'
  | 'uplights'
  | 'task'
  | 'lamps'
  | 'feature'
  | 'exterior'
  | (string & {});

export type ElectricalChangeSource =
  | 'switch'
  | 'dimmer'
  | 'circuit'
  | 'room'
  | 'scene'
  | 'ramp'
  | 'knx-sync'
  | (string & {});

export interface ElectricalSwitchSpec {
  readonly id: string;
  readonly initialPose?: SwitchGangPose;
  readonly plateId?: string;
  readonly gang?: number;
  readonly zoneId?: string;
  readonly label?: string;
  readonly location?: string;
}

export interface ElectricalWallPlateGangSpec {
  readonly gang: number;
  readonly id?: string;
  readonly zoneId?: string;
  readonly label?: string;
  readonly initialPose?: SwitchGangPose;
}

export interface ElectricalWallPlateSpec {
  readonly plateId: string;
  readonly name?: string;
  readonly mountedInZoneId?: string;
  readonly location?: string;
  readonly gangs: readonly ElectricalWallPlateGangSpec[];
}

export interface ElectricalSwitchState {
  readonly id: string;
  readonly pose: SwitchGangPose;
  readonly plateId?: string;
  readonly gang?: number;
  readonly zoneId?: string;
  readonly label?: string;
  readonly location?: string;
  readonly indicatorOn: boolean;
}

export interface ElectricalWallPlateGangState {
  readonly gang: number;
  readonly switchId: string;
  readonly pose: SwitchGangPose;
  readonly zoneId?: string;
  readonly label?: string;
  readonly indicatorOn: boolean;
}

export interface ElectricalWallPlateState {
  readonly plateId: string;
  readonly name?: string;
  readonly mountedInZoneId?: string;
  readonly location?: string;
  readonly gangs: readonly ElectricalWallPlateGangState[];
}

export interface OneWayWiringTopology {
  readonly kind: 'one-way';
  readonly switchId: string;
  /** Pose that closes the circuit. Defaults to `'down'` (UK/Corston convention: `'up'` = OFF, `'down'` = ON). */
  readonly onPose?: SwitchGangPose;
}

export interface TwoWayWiringTopology {
  readonly kind: 'two-way';
  readonly switches: readonly [string, string];
  /**
   * When false (default), continuity is OFF when both switches share a pose (e.g. both `'up'`)
   * and ON when their poses differ, so flipping either switch strictly inverts continuity.
   */
  readonly closedWhenSamePose?: boolean;
}

export interface MultiWayWiringTopology {
  readonly kind: 'three-way' | 'multi-way';
  readonly endpoints: readonly [string, string];
  readonly intermediates: readonly string[];
  /**
   * Parity convention over the count of `'down'` switches across `[endpoints[0], ...intermediates, endpoints[1]]`.
   * Defaults to `false` (all `'up'` => 0 `'down'` => OFF; flipping ANY single switch inverts parity and continuity).
   */
  readonly closedWhenEvenDown?: boolean;
}

export interface DimmerWiringTopology {
  readonly kind: 'dimmer';
  readonly dimmerId: string;
  readonly switchId?: string;
  readonly onPose?: SwitchGangPose;
}

export interface BusWiringTopology {
  readonly kind: 'bus';
}

export type CircuitWiringTopology =
  | OneWayWiringTopology
  | TwoWayWiringTopology
  | MultiWayWiringTopology
  | DimmerWiringTopology
  | BusWiringTopology;

export interface ElectricalDimmerSpec {
  readonly id: string;
  readonly initialLevel?: number;
  readonly minLevel?: number;
  readonly enabled?: boolean;
  readonly rampSpeedPerSec?: number;
  readonly zoneId?: string;
  readonly label?: string;
}

export interface ElectricalDimmerState {
  readonly id: string;
  readonly level: number;
  readonly minLevel: number;
  readonly enabled: boolean;
  readonly rampSpeedPerSec: number;
  readonly zoneId?: string;
  readonly label?: string;
}

export interface ElectricalCircuitSpec {
  readonly id: string;
  readonly name: string;
  readonly shortName?: string;
  readonly zoneId: string;
  readonly floorId?: string;
  readonly buildingId?: string;
  readonly kind?: ElectricalLayerKind;
  readonly dimmable?: boolean;
  readonly defaultBrightness?: number;
  readonly wiring?: CircuitWiringTopology;
  readonly dimmerId?: string;
}

export interface ElectricalRoomScene {
  readonly id: string;
  /** Human-readable scene label. */
  readonly label: string;
  /** Canonical [0..1] circuit levels for this scene. */
  readonly levels: Readonly<Record<string, number>>;
}

export interface ElectricalZoneSpec {
  readonly id: string;
  readonly name?: string;
  readonly circuits?: readonly string[];
  readonly scenes?: readonly ElectricalRoomScene[];
  readonly nightLevels?: Readonly<Record<string, number>>;
}

export interface ElectricalZoneDescriptor {
  readonly id: string;
  readonly name: string;
  readonly circuits: readonly string[];
  readonly scenes: readonly ElectricalRoomScene[];
  readonly nightLevels?: Readonly<Record<string, number>>;
}

export interface ElectricalBusEvent {
  readonly type:
    | 'circuitChange'
    | 'switchChange'
    | 'dimmerChange'
    | 'zoneChange'
    | 'rampStep'
    | 'indicatorChange';
  readonly source: ElectricalChangeSource;
  readonly changedCircuits: readonly string[];
  readonly switchId?: string;
  readonly pose?: SwitchGangPose;
  readonly plateId?: string;
  readonly gang?: number;
  readonly dimmerId?: string;
  readonly dimmerLevel?: number;
  readonly zoneId?: string;
  readonly sceneId?: string;
}

export type ElectricalEventListener = (event: ElectricalBusEvent) => void;

export interface ElectricalSystemOptions {
  readonly switches?: readonly ElectricalSwitchSpec[];
  readonly wallPlates?: readonly ElectricalWallPlateSpec[];
  readonly dimmers?: readonly ElectricalDimmerSpec[];
  readonly circuits?: readonly ElectricalCircuitSpec[];
  readonly zones?: readonly ElectricalZoneSpec[];
}

export interface ElectricalMutationOptions {
  readonly source?: ElectricalChangeSource;
  /** When true, skips ramp and snaps live brightness straight to target brightness. */
  readonly immediate?: boolean;
}

interface SwitchRecord {
  id: string;
  pose: SwitchGangPose;
  plateId?: string;
  gang?: number;
  zoneId?: string;
  label?: string;
  location?: string;
  indicatorOverride?: boolean;
}

interface WallPlateRecord {
  plateId: string;
  name?: string;
  mountedInZoneId?: string;
  location?: string;
  gangSwitchIds: Map<number, string>;
}

interface DimmerRecord {
  id: string;
  level: number;
  lastNonZeroLevel: number;
  minLevel: number;
  enabled: boolean;
  rampSpeedPerSec: number;
  zoneId?: string;
  label?: string;
}

interface CircuitRecord {
  spec: ElectricalCircuitSpec;
  targetBrightness: number;
  liveBrightness: number;
  directBrightness: number;
  lastNonZeroBrightness: number;
}

interface ZoneRecord {
  id: string;
  name: string;
  explicitCircuits: string[];
  scenes: ElectricalRoomScene[];
  nightLevels?: Readonly<Record<string, number>>;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function invertPose(pose: SwitchGangPose): SwitchGangPose {
  return pose === 'up' ? 'down' : 'up';
}

function toPct(value01: number): number {
  return Math.round(clamp01(value01) * 1_000_000) / 10_000;
}

export function defaultPlateGangSwitchId(plateId: string, gang: number): string {
  return `${plateId}:g${gang}`;
}

// ---------------------------------------------------------------------------
// Wiring topology builders
// ---------------------------------------------------------------------------

export function wireOneWay(
  switchId: string,
  options?: { readonly onPose?: SwitchGangPose }
): OneWayWiringTopology {
  return options?.onPose !== undefined
    ? { kind: 'one-way', switchId, onPose: options.onPose }
    : { kind: 'one-way', switchId };
}

export function wireTwoWay(
  switches: readonly [string, string],
  options?: { readonly closedWhenSamePose?: boolean }
): TwoWayWiringTopology;
export function wireTwoWay(
  switchA: string,
  switchB: string,
  options?: { readonly closedWhenSamePose?: boolean }
): TwoWayWiringTopology;
export function wireTwoWay(
  first: readonly [string, string] | string,
  second?: { readonly closedWhenSamePose?: boolean } | string,
  third?: { readonly closedWhenSamePose?: boolean }
): TwoWayWiringTopology {
  const switches: readonly [string, string] =
    typeof first === 'string' ? [first, second as string] : first;
  const opts = (typeof first === 'string' ? third : second) as
    | { readonly closedWhenSamePose?: boolean }
    | undefined;
  return opts?.closedWhenSamePose !== undefined
    ? { kind: 'two-way', switches, closedWhenSamePose: opts.closedWhenSamePose }
    : { kind: 'two-way', switches };
}

export function wireThreeWay(
  endpoints: readonly [string, string],
  intermediate: string | readonly string[],
  options?: { readonly closedWhenEvenDown?: boolean }
): MultiWayWiringTopology;
export function wireThreeWay(
  endpointA: string,
  intermediate: string,
  endpointB: string,
  options?: { readonly closedWhenEvenDown?: boolean }
): MultiWayWiringTopology;
export function wireThreeWay(
  first: readonly [string, string] | string,
  second: string | readonly string[],
  third?: { readonly closedWhenEvenDown?: boolean } | string,
  fourth?: { readonly closedWhenEvenDown?: boolean }
): MultiWayWiringTopology {
  let endpoints: readonly [string, string];
  let intermediates: readonly string[];
  let opts: { readonly closedWhenEvenDown?: boolean } | undefined;

  if (typeof first === 'string') {
    endpoints = [first, third as string];
    intermediates = [second as string];
    opts = fourth;
  } else {
    endpoints = first;
    intermediates = typeof second === 'string' ? [second] : [...second];
    opts = third as { readonly closedWhenEvenDown?: boolean } | undefined;
  }

  return opts?.closedWhenEvenDown !== undefined
    ? { kind: 'three-way', endpoints, intermediates, closedWhenEvenDown: opts.closedWhenEvenDown }
    : { kind: 'three-way', endpoints, intermediates };
}

export function wireMultiWay(
  endpoints: readonly [string, string],
  intermediates: readonly string[],
  options?: { readonly closedWhenEvenDown?: boolean }
): MultiWayWiringTopology {
  return options?.closedWhenEvenDown !== undefined
    ? {
        kind: 'multi-way',
        endpoints,
        intermediates: [...intermediates],
        closedWhenEvenDown: options.closedWhenEvenDown,
      }
    : { kind: 'multi-way', endpoints, intermediates: [...intermediates] };
}

export function wireDimmer(
  dimmerId: string,
  options?: string | { readonly switchId?: string; readonly onPose?: SwitchGangPose }
): DimmerWiringTopology {
  const opts = typeof options === 'string' ? { switchId: options } : options;
  return {
    kind: 'dimmer',
    dimmerId,
    ...(opts?.switchId !== undefined ? { switchId: opts.switchId } : {}),
    ...(opts?.onPose !== undefined ? { onPose: opts.onPose } : {}),
  };
}

// ---------------------------------------------------------------------------
// CircuitBus / ElectricalSystem
// ---------------------------------------------------------------------------

export class CircuitBus {
  private readonly switches = new Map<string, SwitchRecord>();
  private readonly wallPlates = new Map<string, WallPlateRecord>();
  private readonly plateGangToSwitchId = new Map<string, string>();
  private readonly dimmers = new Map<string, DimmerRecord>();
  private readonly circuits = new Map<string, CircuitRecord>();
  private readonly zones = new Map<string, ZoneRecord>();
  private readonly listeners = new Set<ElectricalEventListener>();

  public constructor(options?: ElectricalSystemOptions) {
    if (options?.switches) {
      for (const sw of options.switches) this.registerSwitch(sw);
    }
    if (options?.wallPlates) {
      for (const plate of options.wallPlates) this.registerWallPlate(plate);
    }
    if (options?.dimmers) {
      for (const dimmer of options.dimmers) this.registerDimmer(dimmer);
    }
    if (options?.zones) {
      for (const zone of options.zones) this.registerZone(zone);
    }
    if (options?.circuits) {
      for (const circuit of options.circuits) this.registerCircuit(circuit);
    }
  }

  public subscribe(listener: ElectricalEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // -------------------------------------------------------------------------
  // Switches & multi-gang wall plates
  // -------------------------------------------------------------------------

  public registerSwitch(spec: ElectricalSwitchSpec): ElectricalSwitchState {
    const existing = this.switches.get(spec.id);
    const pose: SwitchGangPose = spec.initialPose ?? existing?.pose ?? 'up';
    const record: SwitchRecord = {
      id: spec.id,
      pose,
      plateId: spec.plateId ?? existing?.plateId,
      gang: spec.gang ?? existing?.gang,
      zoneId: spec.zoneId ?? existing?.zoneId,
      label: spec.label ?? existing?.label,
      location: spec.location ?? existing?.location,
      indicatorOverride: existing?.indicatorOverride,
    };
    this.switches.set(spec.id, record);

    if (record.plateId !== undefined && record.gang !== undefined) {
      this.bindPlateGang(record.plateId, record.gang, record.id);
    }

    this.recomputeAllCircuits(true);
    return this.toSwitchState(record);
  }

  public registerWallPlate(spec: ElectricalWallPlateSpec): ElectricalWallPlateState {
    let plate = this.wallPlates.get(spec.plateId);
    if (!plate) {
      plate = {
        plateId: spec.plateId,
        name: spec.name,
        mountedInZoneId: spec.mountedInZoneId,
        location: spec.location,
        gangSwitchIds: new Map<number, string>(),
      };
      this.wallPlates.set(spec.plateId, plate);
    } else {
      plate.name = spec.name ?? plate.name;
      plate.mountedInZoneId = spec.mountedInZoneId ?? plate.mountedInZoneId;
      plate.location = spec.location ?? plate.location;
    }

    for (const gangSpec of spec.gangs) {
      const switchId = gangSpec.id ?? defaultPlateGangSwitchId(spec.plateId, gangSpec.gang);
      const existing = this.switches.get(switchId);
      const record: SwitchRecord = {
        id: switchId,
        pose: gangSpec.initialPose ?? existing?.pose ?? 'up',
        plateId: spec.plateId,
        gang: gangSpec.gang,
        zoneId: gangSpec.zoneId ?? existing?.zoneId ?? spec.mountedInZoneId,
        label: gangSpec.label ?? existing?.label,
        location: spec.location ?? existing?.location,
        indicatorOverride: existing?.indicatorOverride,
      };
      this.switches.set(switchId, record);
      this.bindPlateGang(spec.plateId, gangSpec.gang, switchId);
    }

    this.recomputeAllCircuits(true);
    return this.getWallPlate(spec.plateId)!;
  }

  public getSwitch(id: string): ElectricalSwitchState | undefined {
    const sw = this.switches.get(id);
    return sw ? this.toSwitchState(sw) : undefined;
  }

  public getSwitches(): readonly ElectricalSwitchState[] {
    return [...this.switches.values()].map((sw) => this.toSwitchState(sw));
  }

  public getSwitchPose(id: string): SwitchGangPose | undefined {
    return this.switches.get(id)?.pose;
  }

  public getPlateGangSwitchId(plateId: string, gang: number): string | undefined {
    return this.plateGangToSwitchId.get(this.plateGangKey(plateId, gang));
  }

  public getPlateGangPose(plateId: string, gang: number): SwitchGangPose | undefined {
    const switchId = this.getPlateGangSwitchId(plateId, gang);
    return switchId ? this.switches.get(switchId)?.pose : undefined;
  }

  public getWallPlate(plateId: string): ElectricalWallPlateState | undefined {
    const plate = this.wallPlates.get(plateId);
    if (!plate) return undefined;
    const gangs: ElectricalWallPlateGangState[] = [...plate.gangSwitchIds.entries()]
      .sort(([a], [b]) => a - b)
      .map(([gang, switchId]) => {
        const sw = this.switches.get(switchId)!;
        return {
          gang,
          switchId,
          pose: sw.pose,
          ...(sw.zoneId !== undefined ? { zoneId: sw.zoneId } : {}),
          ...(sw.label !== undefined ? { label: sw.label } : {}),
          indicatorOn: this.computeSwitchIndicator(sw),
        };
      });
    return {
      plateId: plate.plateId,
      ...(plate.name !== undefined ? { name: plate.name } : {}),
      ...(plate.mountedInZoneId !== undefined ? { mountedInZoneId: plate.mountedInZoneId } : {}),
      ...(plate.location !== undefined ? { location: plate.location } : {}),
      gangs,
    };
  }

  public getWallPlates(): readonly ElectricalWallPlateState[] {
    return [...this.wallPlates.keys()].map((id) => this.getWallPlate(id)!);
  }

  public getSwitchIndicator(id: string): boolean {
    const sw = this.switches.get(id);
    return sw ? this.computeSwitchIndicator(sw) : false;
  }

  public getPlateGangIndicator(plateId: string, gang: number): boolean {
    const switchId = this.getPlateGangSwitchId(plateId, gang);
    return switchId ? this.getSwitchIndicator(switchId) : false;
  }

  public setSwitchIndicator(
    id: string,
    indicatorOn: boolean | undefined,
    options?: ElectricalMutationOptions
  ): void {
    const sw = this.switches.get(id);
    if (!sw) return;
    const prev = this.computeSwitchIndicator(sw);
    sw.indicatorOverride = indicatorOn;
    const next = this.computeSwitchIndicator(sw);
    if (prev !== next) {
      this.emit({
        type: 'indicatorChange',
        source: options?.source ?? 'switch',
        changedCircuits: [],
        switchId: sw.id,
        pose: sw.pose,
        ...(sw.plateId !== undefined ? { plateId: sw.plateId } : {}),
        ...(sw.gang !== undefined ? { gang: sw.gang } : {}),
      });
    }
  }

  public setPlateGangIndicator(
    plateId: string,
    gang: number,
    indicatorOn: boolean | undefined,
    options?: ElectricalMutationOptions
  ): void {
    const switchId = this.getPlateGangSwitchId(plateId, gang);
    if (switchId) {
      this.setSwitchIndicator(switchId, indicatorOn, options);
    }
  }

  public flipSwitch(
    id: string,
    pose?: SwitchGangPose,
    options?: ElectricalMutationOptions
  ): SwitchGangPose {
    const sw = this.ensureSwitch(id);
    const nextPose = pose ?? invertPose(sw.pose);
    const poseChanged = sw.pose !== nextPose;
    sw.pose = nextPose;

    const changedCircuits = this.recomputeAllCircuits(options?.immediate ?? false);
    if (poseChanged || changedCircuits.length > 0) {
      this.emit({
        type: 'switchChange',
        source: options?.source ?? 'switch',
        changedCircuits,
        switchId: sw.id,
        pose: sw.pose,
        ...(sw.plateId !== undefined ? { plateId: sw.plateId } : {}),
        ...(sw.gang !== undefined ? { gang: sw.gang } : {}),
        ...(sw.zoneId !== undefined ? { zoneId: sw.zoneId } : {}),
      });
    }
    return sw.pose;
  }

  public flipPlateGang(
    plateId: string,
    gang: number,
    pose?: SwitchGangPose,
    options?: ElectricalMutationOptions
  ): SwitchGangPose {
    let switchId = this.getPlateGangSwitchId(plateId, gang);
    if (!switchId) {
      switchId = defaultPlateGangSwitchId(plateId, gang);
      this.registerWallPlate({
        plateId,
        gangs: [{ gang, id: switchId }],
      });
    }
    return this.flipSwitch(switchId, pose, options);
  }

  // -------------------------------------------------------------------------
  // Rotary / trailing-edge dimmers
  // -------------------------------------------------------------------------

  public registerDimmer(spec: ElectricalDimmerSpec): ElectricalDimmerState {
    const minLevel = clamp01(spec.minLevel ?? 0);
    const rawInitial = spec.initialLevel !== undefined ? clamp01(spec.initialLevel) : 1;
    const level = rawInitial > 0 ? Math.max(minLevel, rawInitial) : minLevel;
    const rampSpeedPerSec =
      spec.rampSpeedPerSec !== undefined &&
      Number.isFinite(spec.rampSpeedPerSec) &&
      spec.rampSpeedPerSec > 0
        ? spec.rampSpeedPerSec
        : 0;

    const record: DimmerRecord = {
      id: spec.id,
      level,
      lastNonZeroLevel: level > 0 ? level : Math.max(minLevel, 1),
      minLevel,
      enabled: spec.enabled ?? true,
      rampSpeedPerSec,
      zoneId: spec.zoneId,
      label: spec.label,
    };
    this.dimmers.set(spec.id, record);
    this.recomputeAllCircuits(true);
    return this.toDimmerState(record);
  }

  public getDimmer(dimmerId: string): ElectricalDimmerState | undefined {
    const d = this.dimmers.get(dimmerId);
    return d ? this.toDimmerState(d) : undefined;
  }

  public getDimmers(): readonly ElectricalDimmerState[] {
    return [...this.dimmers.values()].map((d) => this.toDimmerState(d));
  }

  public setDimmerLevel(
    dimmerId: string,
    level01: number,
    options?: ElectricalMutationOptions
  ): number {
    const dimmer = this.ensureDimmer(dimmerId);
    const nextLevel = this.clampDimmerKnob(dimmer, level01);
    const levelChanged = Math.abs(dimmer.level - nextLevel) > 1e-9;
    dimmer.level = nextLevel;
    if (nextLevel > 0) {
      dimmer.lastNonZeroLevel = nextLevel;
    }
    const changedCircuits = this.recomputeAllCircuits(options?.immediate ?? false);
    if (levelChanged || changedCircuits.length > 0) {
      this.emit({
        type: 'dimmerChange',
        source: options?.source ?? 'dimmer',
        changedCircuits,
        dimmerId: dimmer.id,
        dimmerLevel: dimmer.level,
      });
    }
    return dimmer.level;
  }

  public adjustDimmerLevel(
    dimmerId: string,
    delta01: number,
    options?: ElectricalMutationOptions
  ): number {
    const dimmer = this.ensureDimmer(dimmerId);
    const delta = Number.isFinite(delta01) ? delta01 : 0;
    return this.setDimmerLevel(dimmerId, dimmer.level + delta, options);
  }

  public setDimmerEnabled(
    dimmerId: string,
    enabled: boolean,
    options?: ElectricalMutationOptions
  ): boolean {
    const dimmer = this.ensureDimmer(dimmerId);
    const changed = dimmer.enabled !== enabled;
    dimmer.enabled = enabled;
    if (enabled && dimmer.level <= 0) {
      dimmer.level = Math.max(dimmer.minLevel, dimmer.lastNonZeroLevel || 1);
    }
    const changedCircuits = this.recomputeAllCircuits(options?.immediate ?? false);
    if (changed || changedCircuits.length > 0) {
      this.emit({
        type: 'dimmerChange',
        source: options?.source ?? 'dimmer',
        changedCircuits,
        dimmerId: dimmer.id,
        dimmerLevel: dimmer.enabled ? dimmer.level : 0,
      });
    }
    return dimmer.enabled;
  }

  /** Push-on / push-off rotary dimmer toggle (preserves rotary level across off/on cycles). */
  public toggleDimmer(dimmerId: string, options?: ElectricalMutationOptions): boolean {
    const dimmer = this.ensureDimmer(dimmerId);
    const nextEnabled = !(dimmer.enabled && dimmer.level > 0);
    return this.setDimmerEnabled(dimmerId, nextEnabled, options);
  }

  // -------------------------------------------------------------------------
  // Circuits
  // -------------------------------------------------------------------------

  public registerCircuit(spec: ElectricalCircuitSpec): void {
    this.ensureTopologyDevices(spec);
    const defaultB = this.quantizeForCircuit(
      spec,
      spec.defaultBrightness !== undefined ? clamp01(spec.defaultBrightness) : 0
    );

    const record: CircuitRecord = {
      spec,
      targetBrightness: 0,
      liveBrightness: 0,
      directBrightness: defaultB,
      lastNonZeroBrightness: defaultB > 0 ? defaultB : 1,
    };

    const computed = this.computeCircuitTarget(record);
    record.targetBrightness = computed;
    record.liveBrightness = computed;
    if (computed > 0) {
      record.lastNonZeroBrightness = computed;
    }

    this.circuits.set(spec.id, record);
    this.ensureImplicitZone(spec.zoneId);
  }

  public getCircuit(circuitId: string): ElectricalCircuitSpec | undefined {
    return this.circuits.get(circuitId)?.spec;
  }

  public getCircuits(): readonly ElectricalCircuitSpec[] {
    return [...this.circuits.values()].map((c) => c.spec);
  }

  /** Canonical live circuit brightness in [0..1]. */
  public getCircuitBrightness(circuitId: string): number {
    return this.circuits.get(circuitId)?.liveBrightness ?? 0;
  }

  /** Canonical target circuit brightness in [0..1] (differs from live only mid-ramp). */
  public getCircuitTargetBrightness(circuitId: string): number {
    return this.circuits.get(circuitId)?.targetBrightness ?? 0;
  }

  public isCircuitSwitchPathClosed(circuitId: string): boolean {
    const record = this.circuits.get(circuitId);
    return record ? this.evaluateSwitchPath(record.spec.wiring) : false;
  }

  public getLiveLevels01(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, c] of this.circuits) {
      out[id] = c.liveBrightness;
    }
    return out;
  }

  public getTargetLevels01(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, c] of this.circuits) {
      out[id] = c.targetBrightness;
    }
    return out;
  }

  public getLiveLevelsPct(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, c] of this.circuits) {
      out[id] = toPct(c.liveBrightness);
    }
    return out;
  }

  public getTargetLevelsPct(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, c] of this.circuits) {
      out[id] = toPct(c.targetBrightness);
    }
    return out;
  }

  /**
   * Sets a circuit's brightness in [0..1].
   * On switch-wired circuits, automatically flips the primary switch when needed
   * so physical switch pose and circuit continuity stay consistent, and updates
   * any attached series dimmer.
   */
  public setCircuitBrightness(
    circuitId: string,
    level01: number,
    options?: ElectricalMutationOptions
  ): number {
    const record = this.circuits.get(circuitId);
    if (!record) return 0;

    const source = options?.source ?? 'circuit';
    const immediate = options?.immediate ?? false;
    const requested = this.quantizeForCircuit(record.spec, clamp01(level01));
    const changedSet = new Set<string>();

    const applyDirectOrWired = (): void => {
      const wiring = record.spec.wiring;
      if (!wiring || wiring.kind === 'bus') {
        record.directBrightness = requested;
        if (requested > 0) {
          record.lastNonZeroBrightness = requested;
        }
        for (const id of this.recomputeAllCircuits(immediate)) {
          changedSet.add(id);
        }
        return;
      }

      const dimmerId = this.resolveCircuitDimmerId(record.spec);
      const primarySwitchId = this.resolvePrimarySwitchId(wiring);
      const pathClosed = this.evaluateSwitchPath(wiring);

      if (requested > 0) {
        if (dimmerId) {
          const dimmer = this.ensureDimmer(dimmerId);
          dimmer.enabled = true;
          const nextKnob = this.clampDimmerKnob(dimmer, requested);
          dimmer.level = nextKnob;
          dimmer.lastNonZeroLevel = nextKnob;
        }
        if (primarySwitchId && !pathClosed) {
          const sw = this.ensureSwitch(primarySwitchId);
          sw.pose = invertPose(sw.pose);
        }
      } else {
        if (primarySwitchId) {
          if (pathClosed) {
            const sw = this.ensureSwitch(primarySwitchId);
            sw.pose = invertPose(sw.pose);
          }
        } else if (dimmerId) {
          const dimmer = this.ensureDimmer(dimmerId);
          dimmer.enabled = false;
        }
      }

      for (const id of this.recomputeAllCircuits(immediate)) {
        changedSet.add(id);
      }
    };

    applyDirectOrWired();

    if (changedSet.size > 0) {
      this.emit({
        type: 'circuitChange',
        source,
        changedCircuits: [...changedSet],
        zoneId: record.spec.zoneId,
      });
    }

    return record.liveBrightness;
  }

  /** Batch-updates multiple circuit levels in [0..1] with a single subscriber notification. */
  public setCircuitLevels01(
    levels: Readonly<Record<string, number>>,
    options?: ElectricalMutationOptions
  ): readonly string[] {
    const source = options?.source ?? 'circuit';
    const immediate = options?.immediate ?? false;
    const changedSet = new Set<string>();

    for (const [circuitId, rawLevel] of Object.entries(levels)) {
      const record = this.circuits.get(circuitId);
      if (!record || typeof rawLevel !== 'number') continue;
      const requested = this.quantizeForCircuit(record.spec, clamp01(rawLevel));
      const wiring = record.spec.wiring;

      if (!wiring || wiring.kind === 'bus') {
        record.directBrightness = requested;
        if (requested > 0) {
          record.lastNonZeroBrightness = requested;
        }
      } else {
        const dimmerId = this.resolveCircuitDimmerId(record.spec);
        const primarySwitchId = this.resolvePrimarySwitchId(wiring);
        const pathClosed = this.evaluateSwitchPath(wiring);
        if (requested > 0) {
          if (dimmerId) {
            const dimmer = this.ensureDimmer(dimmerId);
            dimmer.enabled = true;
            const nextKnob = this.clampDimmerKnob(dimmer, requested);
            dimmer.level = nextKnob;
            dimmer.lastNonZeroLevel = nextKnob;
          }
          if (primarySwitchId && !pathClosed) {
            const sw = this.ensureSwitch(primarySwitchId);
            sw.pose = invertPose(sw.pose);
          }
        } else if (primarySwitchId) {
          if (pathClosed) {
            const sw = this.ensureSwitch(primarySwitchId);
            sw.pose = invertPose(sw.pose);
          }
        } else if (dimmerId) {
          this.ensureDimmer(dimmerId).enabled = false;
        }
      }
    }

    for (const id of this.recomputeAllCircuits(immediate)) {
      changedSet.add(id);
    }

    const changedCircuits = [...changedSet];
    if (changedCircuits.length > 0) {
      this.emit({
        type: 'circuitChange',
        source,
        changedCircuits,
      });
    }
    return changedCircuits;
  }

  public toggleCircuit(circuitId: string, options?: ElectricalMutationOptions): number {
    const record = this.circuits.get(circuitId);
    if (!record) return 0;

    if (record.targetBrightness > 0) {
      return this.setCircuitBrightness(circuitId, 0, options);
    }

    const dimmerId = this.resolveCircuitDimmerId(record.spec);
    if (dimmerId) {
      const dimmer = this.ensureDimmer(dimmerId);
      const restore = dimmer.level > 0 ? dimmer.level : dimmer.lastNonZeroLevel || 1;
      return this.setCircuitBrightness(circuitId, restore, options);
    }

    const wiring = record.spec.wiring;
    if (!wiring || wiring.kind === 'bus') {
      const restore =
        record.lastNonZeroBrightness > 0
          ? record.lastNonZeroBrightness
          : record.spec.defaultBrightness && record.spec.defaultBrightness > 0
            ? clamp01(record.spec.defaultBrightness)
            : 1;
      return this.setCircuitBrightness(circuitId, restore, options);
    }

    return this.setCircuitBrightness(circuitId, 1, options);
  }

  // -------------------------------------------------------------------------
  // Room / Zone helpers & scenes
  // -------------------------------------------------------------------------

  public registerZone(spec: ElectricalZoneSpec): ElectricalZoneDescriptor {
    const existing = this.zones.get(spec.id);
    const record: ZoneRecord = {
      id: spec.id,
      name: spec.name ?? existing?.name ?? spec.id,
      explicitCircuits: spec.circuits ? [...spec.circuits] : existing?.explicitCircuits ?? [],
      scenes: spec.scenes ? [...spec.scenes] : existing?.scenes ?? [],
      nightLevels: spec.nightLevels ?? existing?.nightLevels,
    };
    this.zones.set(spec.id, record);
    return this.toZoneDescriptor(record);
  }

  public registerRoomScenes(
    zoneId: string,
    scenes: readonly ElectricalRoomScene[],
    name?: string
  ): ElectricalZoneDescriptor {
    const existing = this.zones.get(zoneId);
    return this.registerZone({
      id: zoneId,
      name: name ?? existing?.name ?? zoneId,
      circuits: existing?.explicitCircuits,
      scenes,
      nightLevels: existing?.nightLevels,
    });
  }

  public getZones(): readonly ElectricalZoneDescriptor[] {
    const seen = new Set<string>();
    const list: ElectricalZoneDescriptor[] = [];
    for (const z of this.zones.values()) {
      seen.add(z.id);
      list.push(this.toZoneDescriptor(z));
    }
    for (const c of this.circuits.values()) {
      if (!seen.has(c.spec.zoneId)) {
        seen.add(c.spec.zoneId);
        list.push(this.toZoneDescriptor(this.ensureImplicitZone(c.spec.zoneId)));
      }
    }
    return list;
  }

  public getZone(zoneId: string): ElectricalZoneDescriptor | undefined {
    const z = this.zones.get(zoneId);
    if (z) return this.toZoneDescriptor(z);
    const hasCircuits = [...this.circuits.values()].some((c) => c.spec.zoneId === zoneId);
    return hasCircuits ? this.toZoneDescriptor(this.ensureImplicitZone(zoneId)) : undefined;
  }

  public getRoomCircuits(zoneId: string): readonly ElectricalCircuitSpec[] {
    const ids = this.resolveZoneCircuitIds(zoneId);
    const specs: ElectricalCircuitSpec[] = [];
    for (const id of ids) {
      const c = this.circuits.get(id);
      if (c) specs.push(c.spec);
    }
    return specs;
  }

  public isRoomOn(zoneId: string): boolean {
    const ids = this.resolveZoneCircuitIds(zoneId);
    return ids.some((id) => {
      const c = this.circuits.get(id);
      return c !== undefined && (c.targetBrightness > 0 || c.liveBrightness > 0);
    });
  }

  public setRoomFull(zoneId: string, options?: ElectricalMutationOptions): void {
    const ids = this.resolveZoneCircuitIds(zoneId);
    const levels: Record<string, number> = {};
    for (const id of ids) levels[id] = 1;
    const changed = this.setCircuitLevels01(levels, {
      source: options?.source ?? 'room',
      immediate: options?.immediate,
    });
    if (changed.length === 0 && ids.length > 0) {
      // Already full; no-op.
      return;
    }
  }

  public setRoomOff(zoneId: string, options?: ElectricalMutationOptions): void {
    const ids = this.resolveZoneCircuitIds(zoneId);
    const levels: Record<string, number> = {};
    for (const id of ids) levels[id] = 0;
    this.setCircuitLevels01(levels, {
      source: options?.source ?? 'room',
      immediate: options?.immediate,
    });
  }

  public recallRoomScene(
    zoneId: string,
    sceneIndexOrId: number | string,
    options?: ElectricalMutationOptions
  ): boolean {
    const zone = this.zones.get(zoneId);
    if (!zone || zone.scenes.length === 0) return false;

    const scene =
      typeof sceneIndexOrId === 'number'
        ? zone.scenes[sceneIndexOrId]
        : zone.scenes.find((s) => s.id === sceneIndexOrId);
    if (!scene) return false;

    const levels: Record<string, number> = {};
    for (const id of this.resolveZoneCircuitIds(zoneId)) {
      levels[id] = clamp01(scene.levels[id] ?? 0);
    }
    for (const [id, val] of Object.entries(scene.levels)) {
      if (typeof val === 'number' && this.circuits.has(id)) {
        levels[id] = clamp01(val);
      }
    }

    const changed = this.setCircuitLevels01(levels, {
      source: options?.source ?? 'scene',
      immediate: options?.immediate,
    });
    if (changed.length === 0) {
      this.emit({
        type: 'zoneChange',
        source: options?.source ?? 'scene',
        changedCircuits: [],
        zoneId,
        sceneId: scene.id,
      });
    }
    return true;
  }

  public toggleRoom(zoneId: string, options?: ElectricalMutationOptions): boolean {
    if (this.isRoomOn(zoneId)) {
      this.setRoomOff(zoneId, options);
      return false;
    }
    const zone = this.zones.get(zoneId);
    if (zone && zone.scenes.length > 0) {
      const firstScene = zone.scenes[0];
      const hasLitChannel =
        firstScene !== undefined && Object.values(firstScene.levels).some((v) => (v ?? 0) > 0);
      if (hasLitChannel) {
        this.recallRoomScene(zoneId, 0, options);
        return true;
      }
    }
    this.setRoomFull(zoneId, options);
    return true;
  }

  // -------------------------------------------------------------------------
  // Trailing-edge dimmer ramp stepping
  // -------------------------------------------------------------------------

  public hasPendingRamps(): boolean {
    for (const c of this.circuits.values()) {
      if (Math.abs(c.targetBrightness - c.liveBrightness) > 1e-6) {
        return true;
      }
    }
    return false;
  }

  /**
   * Steps any active trailing-edge dimmer ramps by `dtSeconds`.
   * Returns `true` when at least one circuit's live brightness advanced.
   */
  public step(dtSeconds: number): boolean {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) {
      return false;
    }

    const changedCircuits: string[] = [];
    for (const [id, c] of this.circuits) {
      const diff = c.targetBrightness - c.liveBrightness;
      if (Math.abs(diff) <= 1e-6) {
        if (c.liveBrightness !== c.targetBrightness) {
          c.liveBrightness = c.targetBrightness;
          changedCircuits.push(id);
        }
        continue;
      }

      const speed = this.resolveRampSpeed(c.spec);
      if (speed <= 0) {
        c.liveBrightness = c.targetBrightness;
        changedCircuits.push(id);
        continue;
      }

      const maxDelta = speed * dtSeconds;
      if (Math.abs(diff) <= maxDelta) {
        c.liveBrightness = c.targetBrightness;
      } else {
        c.liveBrightness = clamp01(c.liveBrightness + Math.sign(diff) * maxDelta);
      }
      changedCircuits.push(id);
    }

    if (changedCircuits.length > 0) {
      this.emit({
        type: 'rampStep',
        source: 'ramp',
        changedCircuits,
      });
      return true;
    }

    return false;
  }

  // -------------------------------------------------------------------------
  // Internal continuity evaluation
  // -------------------------------------------------------------------------

  private plateGangKey(plateId: string, gang: number): string {
    return `${plateId}::${gang}`;
  }

  private bindPlateGang(plateId: string, gang: number, switchId: string): void {
    this.plateGangToSwitchId.set(this.plateGangKey(plateId, gang), switchId);
    let plate = this.wallPlates.get(plateId);
    if (!plate) {
      plate = {
        plateId,
        gangSwitchIds: new Map<number, string>(),
      };
      this.wallPlates.set(plateId, plate);
    }
    plate.gangSwitchIds.set(gang, switchId);
  }

  private ensureSwitch(id: string): SwitchRecord {
    let sw = this.switches.get(id);
    if (!sw) {
      sw = { id, pose: 'up' };
      this.switches.set(id, sw);
    }
    return sw;
  }

  private ensureDimmer(id: string): DimmerRecord {
    let dimmer = this.dimmers.get(id);
    if (!dimmer) {
      dimmer = {
        id,
        level: 1,
        lastNonZeroLevel: 1,
        minLevel: 0,
        enabled: true,
        rampSpeedPerSec: 0,
      };
      this.dimmers.set(id, dimmer);
    }
    return dimmer;
  }

  private ensureImplicitZone(zoneId: string): ZoneRecord {
    let z = this.zones.get(zoneId);
    if (!z) {
      z = {
        id: zoneId,
        name: zoneId,
        explicitCircuits: [],
        scenes: [],
      };
      this.zones.set(zoneId, z);
    }
    return z;
  }

  private ensureTopologyDevices(spec: ElectricalCircuitSpec): void {
    if (spec.dimmerId) {
      this.ensureDimmer(spec.dimmerId);
    }
    const wiring = spec.wiring;
    if (!wiring || wiring.kind === 'bus') return;
    switch (wiring.kind) {
      case 'one-way':
        this.ensureSwitch(wiring.switchId);
        break;
      case 'two-way':
        this.ensureSwitch(wiring.switches[0]);
        this.ensureSwitch(wiring.switches[1]);
        break;
      case 'three-way':
      case 'multi-way':
        this.ensureSwitch(wiring.endpoints[0]);
        for (const mid of wiring.intermediates) this.ensureSwitch(mid);
        this.ensureSwitch(wiring.endpoints[1]);
        break;
      case 'dimmer':
        this.ensureDimmer(wiring.dimmerId);
        if (wiring.switchId) this.ensureSwitch(wiring.switchId);
        break;
    }
  }

  private resolveCircuitDimmerId(spec: ElectricalCircuitSpec): string | undefined {
    if (spec.dimmerId) return spec.dimmerId;
    if (spec.wiring?.kind === 'dimmer') return spec.wiring.dimmerId;
    return undefined;
  }

  private resolvePrimarySwitchId(wiring: CircuitWiringTopology | undefined): string | undefined {
    if (!wiring) return undefined;
    switch (wiring.kind) {
      case 'one-way':
        return wiring.switchId;
      case 'two-way':
        return wiring.switches[0];
      case 'three-way':
      case 'multi-way':
        return wiring.endpoints[0];
      case 'dimmer':
        return wiring.switchId;
      case 'bus':
        return undefined;
    }
  }

  private evaluateSwitchPath(wiring: CircuitWiringTopology | undefined): boolean {
    if (!wiring || wiring.kind === 'bus') {
      return true;
    }
    switch (wiring.kind) {
      case 'one-way': {
        const pose = this.switches.get(wiring.switchId)?.pose ?? 'up';
        const onPose = wiring.onPose ?? 'down';
        return pose === onPose;
      }
      case 'two-way': {
        const poseA = this.switches.get(wiring.switches[0])?.pose ?? 'up';
        const poseB = this.switches.get(wiring.switches[1])?.pose ?? 'up';
        const same = poseA === poseB;
        return (wiring.closedWhenSamePose ?? false) ? same : !same;
      }
      case 'three-way':
      case 'multi-way': {
        const chain = [wiring.endpoints[0], ...wiring.intermediates, wiring.endpoints[1]];
        let downCount = 0;
        for (const swId of chain) {
          if ((this.switches.get(swId)?.pose ?? 'up') === 'down') {
            downCount += 1;
          }
        }
        const isEvenDown = downCount % 2 === 0;
        return (wiring.closedWhenEvenDown ?? false) ? isEvenDown : !isEvenDown;
      }
      case 'dimmer': {
        if (!wiring.switchId) return true;
        const pose = this.switches.get(wiring.switchId)?.pose ?? 'up';
        const onPose = wiring.onPose ?? 'down';
        return pose === onPose;
      }
    }
  }

  private computeCircuitTarget(record: CircuitRecord): number {
    const { spec } = record;
    const wiring = spec.wiring;

    if (!wiring || wiring.kind === 'bus') {
      const dimmerId = spec.dimmerId;
      if (dimmerId) {
        const dimmer = this.ensureDimmer(dimmerId);
        const val = record.directBrightness > 0 && dimmer.enabled ? dimmer.level * record.directBrightness : 0;
        return this.quantizeForCircuit(spec, val);
      }
      return this.quantizeForCircuit(spec, record.directBrightness);
    }

    const isClosed = this.evaluateSwitchPath(wiring);
    if (!isClosed) {
      return 0;
    }

    const dimmerId = this.resolveCircuitDimmerId(spec);
    if (dimmerId) {
      const dimmer = this.ensureDimmer(dimmerId);
      const raw = dimmer.enabled ? dimmer.level : 0;
      return this.quantizeForCircuit(spec, raw);
    }

    return 1;
  }

  private quantizeForCircuit(spec: ElectricalCircuitSpec, level01: number): number {
    const clamped = clamp01(level01);
    if (spec.dimmable === false) {
      return clamped > 0 ? 1 : 0;
    }
    return clamped;
  }

  private clampDimmerKnob(dimmer: DimmerRecord, level01: number): number {
    const clamped = clamp01(level01);
    if (dimmer.minLevel > 0) {
      return Math.max(dimmer.minLevel, clamped);
    }
    return clamped;
  }

  private resolveRampSpeed(spec: ElectricalCircuitSpec): number {
    const dimmerId = this.resolveCircuitDimmerId(spec);
    if (!dimmerId) return 0;
    return this.dimmers.get(dimmerId)?.rampSpeedPerSec ?? 0;
  }

  private recomputeAllCircuits(forceImmediate: boolean): string[] {
    const changed: string[] = [];
    for (const [id, record] of this.circuits) {
      const nextTarget = this.computeCircuitTarget(record);
      const prevTarget = record.targetBrightness;
      const prevLive = record.liveBrightness;

      record.targetBrightness = nextTarget;
      if (nextTarget > 0) {
        record.lastNonZeroBrightness = nextTarget;
      }

      const speed = forceImmediate ? 0 : this.resolveRampSpeed(record.spec);
      if (speed <= 0) {
        record.liveBrightness = nextTarget;
      }

      if (
        Math.abs(record.targetBrightness - prevTarget) > 1e-9 ||
        Math.abs(record.liveBrightness - prevLive) > 1e-9
      ) {
        changed.push(id);
      }
    }
    return changed;
  }

  private resolveZoneCircuitIds(zoneId: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    const zone = this.zones.get(zoneId);
    if (zone) {
      for (const id of zone.explicitCircuits) {
        if (this.circuits.has(id) && !seen.has(id)) {
          seen.add(id);
          out.push(id);
        }
      }
    }
    for (const [id, c] of this.circuits) {
      if (c.spec.zoneId === zoneId && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    return out;
  }

  private switchReferencesCircuit(switchId: string, wiring: CircuitWiringTopology | undefined): boolean {
    if (!wiring || wiring.kind === 'bus') return false;
    switch (wiring.kind) {
      case 'one-way':
        return wiring.switchId === switchId;
      case 'two-way':
        return wiring.switches[0] === switchId || wiring.switches[1] === switchId;
      case 'three-way':
      case 'multi-way':
        return (
          wiring.endpoints[0] === switchId ||
          wiring.endpoints[1] === switchId ||
          wiring.intermediates.includes(switchId)
        );
      case 'dimmer':
        return wiring.switchId === switchId;
    }
  }

  private computeSwitchIndicator(sw: SwitchRecord): boolean {
    if (sw.indicatorOverride !== undefined) {
      return sw.indicatorOverride;
    }
    let hasWiredCircuit = false;
    for (const c of this.circuits.values()) {
      if (this.switchReferencesCircuit(sw.id, c.spec.wiring)) {
        hasWiredCircuit = true;
        if (c.targetBrightness > 0 || c.liveBrightness > 0) {
          return true;
        }
      }
    }
    if (hasWiredCircuit) {
      return false;
    }
    if (sw.zoneId) {
      return this.isRoomOn(sw.zoneId);
    }
    return sw.pose === 'down';
  }

  private toSwitchState(sw: SwitchRecord): ElectricalSwitchState {
    return {
      id: sw.id,
      pose: sw.pose,
      ...(sw.plateId !== undefined ? { plateId: sw.plateId } : {}),
      ...(sw.gang !== undefined ? { gang: sw.gang } : {}),
      ...(sw.zoneId !== undefined ? { zoneId: sw.zoneId } : {}),
      ...(sw.label !== undefined ? { label: sw.label } : {}),
      ...(sw.location !== undefined ? { location: sw.location } : {}),
      indicatorOn: this.computeSwitchIndicator(sw),
    };
  }

  private toDimmerState(d: DimmerRecord): ElectricalDimmerState {
    return {
      id: d.id,
      level: d.level,
      minLevel: d.minLevel,
      enabled: d.enabled,
      rampSpeedPerSec: d.rampSpeedPerSec,
      ...(d.zoneId !== undefined ? { zoneId: d.zoneId } : {}),
      ...(d.label !== undefined ? { label: d.label } : {}),
    };
  }

  private toZoneDescriptor(z: ZoneRecord): ElectricalZoneDescriptor {
    return {
      id: z.id,
      name: z.name,
      circuits: this.resolveZoneCircuitIds(z.id),
      scenes: [...z.scenes],
      ...(z.nightLevels !== undefined ? { nightLevels: { ...z.nightLevels } } : {}),
    };
  }

  private emit(event: ElectricalBusEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

export { CircuitBus as ElectricalSystem };

export function createElectricalSystem(options?: ElectricalSystemOptions): CircuitBus {
  return new CircuitBus(options);
}
