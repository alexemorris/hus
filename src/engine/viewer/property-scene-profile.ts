import type { RoomVariationGroup, RoomVariationGroupInput } from '../variations/room-variation-controller.ts';
import type { RoomManifestEntry } from '../../core/types/twin-ux.ts';
import * as THREE from 'three';
import type {
  AccessPointEntityState,
  CctvCameraEntityState,
  RoomLodOptions,
  RoomZoneLodRegistration,
} from '../../core/entities.ts';
import type { CircuitId } from '../../core/types/knx.ts';
import type { SceneBuilderContext } from './scene-types.ts';
import type { FloorDefinition, FloorViewMode } from '../../core/types/scene.ts';
import type { RoomZoneId } from '../../core/types/topology.ts';
import type { DoorPolicy } from '../interaction/handlers/door-policy.ts';
import type { InteractionRegistry } from '../interaction/interaction-registry.ts';
import type { TerrainSurfaceSampler } from '../../core/geo/terrain-modifiers.ts';
import type { SoundscapeDescriptor } from '../../core/types/acoustics.ts';
import type { HouseClimateInput, HouseEnvironmentInput } from '../../core/types/environment-hdri.ts';
import type { HouseLocation } from '../../core/types/solar-weather.ts';
import type { PortalVisibilitySolver } from '../lod/portal-visibility-solver.ts';
import type { HouseWalkthroughHooks } from '../walkthrough/walkthrough-controller.ts';
import type { SceneZoneRegistry } from './scene-zone-registry.ts';

/** Underfloor heating zone identifier (defined per home). */
export type UfhZoneId = string;

export type HeatingStartMode = 'setback' | 'cold';

export interface HeatingEnvironmentConfig {
  readonly outdoorTempC: number;
  readonly startMode: HeatingStartMode;
}

export interface RoomThermalProfile {
  readonly roomZoneId: RoomZoneId;
  readonly roomName: string;
  readonly ufhZoneId: UfhZoneId;
  readonly emitterLabel: string;
  readonly constructionSummary: string;
  readonly floorAreaM2: number;
  readonly heatedAreaM2: number;
  readonly volumeM3: number;
  readonly emitterOutputW: number;
  readonly specificOutputWPerM2: number;
  /** Fabric + infiltration heat-loss coefficient (W/K) */
  readonly heatLossWPerK: number;
  /** Effective thermal capacitance (Wh/K) of air + internal envelope + active screed/emitter */
  readonly thermalCapacitanceWhPerK: number;
  /** Hydraulic + screed conduction dead-time lag before room air begins rising (minutes) */
  readonly emitterLagMinutes: number;
  readonly setbackStartTempC: number;
  readonly coldStartTempC: number;
  readonly targetTempC: number;
}

export interface ThermalWarmupEstimate {
  readonly startTempC: number;
  readonly targetTempC: number;
  readonly outdoorTempC: number;
  readonly emitterOutputW: number;
  readonly steadyHeatLossAtTargetW: number;
  readonly netBoostPowerAtStartW: number;
  readonly emitterLagMinutes: number;
  readonly initialHeatingRateCPerHr: number;
  readonly maxAchievableTempC: number;
  readonly totalWarmupMinutes: number | null;
  readonly formattedDuration: string;
}

export interface UfhZoneState {
  readonly id: UfhZoneId;
  readonly zoneNumber: number;
  readonly name: string;
  readonly shortName: string;
  readonly manifoldLabel: string;
  readonly roomZones: readonly RoomZoneId[];
  heatingOn: boolean;
  targetTempC: number;
}

/**
 * Contract for a home's 3D Underfloor Heating (UFH) sub-floor pipework layer and zone controller.
 */
export interface UfhSystemOverlay3D {
  readonly rootGroup: THREE.Group;
  isLayerVisible(): boolean;
  setLayerVisible(visible: boolean): void;
  toggleLayerVisible(): boolean;
  getZones(): readonly UfhZoneState[];
  getZone(zoneId: UfhZoneId): UfhZoneState | undefined;
  getZoneForRoom(roomZoneId: RoomZoneId): UfhZoneState | undefined;
  isZoneOn(zoneId: UfhZoneId): boolean;
  setZoneOn(zoneId: UfhZoneId, on: boolean): void;
  toggleZone(zoneId: UfhZoneId): boolean;
  setAllZones(on: boolean): void;
  getEnvironment(): HeatingEnvironmentConfig;
  setOutdoorTempC(tempC: number): void;
  setStartMode(mode: HeatingStartMode): void;
  getZoneWarmupEstimate(zoneId: UfhZoneId): ThermalWarmupEstimate | undefined;
  getRoomThermalProfile(roomZoneId: RoomZoneId): RoomThermalProfile | undefined;
  getRoomWarmupEstimate(roomZoneId: RoomZoneId): ThermalWarmupEstimate | undefined;
  subscribe(listener: () => void): () => void;
}

/**
 * Minimal contract for a home's 3D security overlay (CCTV cameras + access readers).
 */
export interface SecurityOverlay3D {
  syncCameras(states: readonly CctvCameraEntityState[]): void;
  syncAccessPoints(states: readonly AccessPointEntityState[]): void;
}

/** Identifier key into `ZoneIndicatorMaterials.switchLedMats`. */
export type SwitchLedIndicatorKey = string;

/**
 * A wall switch whose status LED lights when any of `circuits` is above 1%.
 * Rules are applied in array order against `ZoneIndicatorMaterials.switchLedMats[material]`.
 */
export interface SwitchLedIndicatorRule {
  readonly material: SwitchLedIndicatorKey;
  readonly circuits: readonly CircuitId[];
}

/** Emissive / light-cone appearance of a circuit's fixtures at 100%. */
export interface CircuitFixtureAppearance {
  readonly emissiveMax: number;
  readonly coneOpacity: number;
}

/** Geometry of a concertina bifold door track (all in metres / radians). */
export interface BifoldTrackConfig {
  /** X of the fixed (right-hand) post the leaves fold against. */
  readonly anchorRightX: number;
  /** Z of the track centre line. */
  readonly trackZ: number;
  /** Width of a single leaf. */
  readonly leafWidth: number;
  /** Fold angle of each leaf when fully open. */
  readonly maxFoldAngle: number;
}

/**
 * Home-specific rules for the static-geometry batcher. Every hook is optional; the engine's
 * generic `userData` traits (`isBatchSubContainer`, `isInteractiveRaycastExcluded`,
 * `isUfhProtectedFloor`, `isDynamicMaterial`, `isRigidDynamicGroup`) are honoured alongside them.
 */
export interface BatchOptimizerHooks {
  /** Groups that are batched as their own container instead of merging into their parent. */
  isBatchSubContainer?(group: THREE.Group): boolean;
  /** Unbatched meshes that are dropped from the interactive raycast list after batching. */
  isInteractiveRaycastExcluded?(mesh: THREE.Mesh): boolean;
  /** Named groups registered with a room at a fixed LOD tier (applied in array order). */
  readonly explicitLodGroups?: ReadonlyArray<
    readonly [name: string, zoneId: RoomZoneId, tier: 1 | 2]
  >;
  /** Room for an untiered group that should be registered at LOD1 (e.g. soft furnishings). */
  resolveGroupLodZone?(group: THREE.Group): RoomZoneId | undefined;
  /** Room for a named moving / animated assembly that should be registered at LOD1. */
  resolveDynamicInteriorZone?(name: string): RoomZoneId | undefined;
  /** Floor finishes that stay unbatched so heating overlays can restyle them individually. */
  isUfhProtectedFloor?(mesh: THREE.Mesh): boolean;
  /** Meshes whose materials are mutated at runtime and must not be deduplicated or merged. */
  isDynamicMaterialMesh?(mesh: THREE.Mesh): boolean;
  /** Meshes of a detached building, batched separately from the primary building. */
  isDetachedBuildingMesh?(meshName: string, groupPrefix: string): boolean;
  /** Groups that move rigidly at runtime and are merged per group rather than per room. */
  isRigidDynamicGroup?(group: THREE.Group): boolean;
}

export interface StaticCutawayView {
  readonly floorViewMode: FloorViewMode;
  readonly isTopDownPlan: boolean;
  readonly camX: number;
  readonly camZ: number;
  readonly targetX: number;
  readonly targetZ: number;
  readonly dirX: number;
  readonly dirZ: number;
}

export interface StaticCutawayGroupCuts {
  readonly southWest?: boolean;
  readonly west?: boolean;
  readonly north?: boolean;
  readonly east?: boolean;
}

export interface CutawayOptions {
  readonly evaluateStaticCutawayGroups?: (view: StaticCutawayView) => StaticCutawayGroupCuts;
}

export interface PortalSolverFactoryContext {
  readonly sceneRoot: THREE.Object3D;
  readonly lodRegistrations: readonly RoomZoneLodRegistration[];
  readonly interactions: InteractionRegistry;
}

/**
 * Everything the home-agnostic `PropertyScene` needs to know about a specific home.
 */
export interface PropertySceneProfile<TSecurity extends SecurityOverlay3D = SecurityOverlay3D> {
  readonly name?: string;
  readonly floors?: readonly FloorDefinition[];
  readonly initialView?: {
    readonly floor?: FloorViewMode;
    readonly sectionCut?: boolean;
  };
  readonly location?: HouseLocation;
  readonly environment?: HouseEnvironmentInput;
  readonly climate?: HouseClimateInput;
  readonly soundscape?: SoundscapeDescriptor;
  readonly terrainSampler?: Pick<TerrainSurfaceSampler, 'sampleTerrainY' | 'sampleCarvedMeshY' | 'sampleNormal'>;
  readonly walkthroughHooks?: HouseWalkthroughHooks;
  readonly cutsceneEntrySpawns?: Readonly<Record<string, { readonly position: readonly [number, number, number]; readonly yawDeg?: number }>>;
  createZoneRegistry(): SceneZoneRegistry;
  readonly lodRegistrations: readonly RoomZoneLodRegistration[];
  readonly roomManifest?: readonly RoomManifestEntry[];
  readonly variations?:
    | readonly (RoomVariationGroup | RoomVariationGroupInput)[]
    | ((ctx: SceneBuilderContext) => readonly (RoomVariationGroup | RoomVariationGroupInput)[]);
  readonly lodOptions?: RoomLodOptions;
  readonly batchHooks?: BatchOptimizerHooks;
  readonly cutawayOptions?: CutawayOptions;
  readonly circuitMaxIntensity: Readonly<Record<CircuitId, number>>;
  /** Optional per-circuit physical-decay intensity multiplier overrides. */
  readonly circuitIntensityMultipliers?: Readonly<Record<CircuitId, number>>;
  readonly defaultFixtureAppearance: CircuitFixtureAppearance;
  readonly fixtureAppearanceOverrides: Readonly<Partial<Record<CircuitId, CircuitFixtureAppearance>>>;
  readonly switchLedRules: readonly SwitchLedIndicatorRule[];
  readonly doorPolicy?: DoorPolicy;
  buildSecurityOverlay(ctx: SceneBuilderContext): TSecurity;
  buildUfhOverlay?: (ctx: SceneBuilderContext) => UfhSystemOverlay3D;
  createPortalVisibilitySolver?: (ctx: PortalSolverFactoryContext) => PortalVisibilitySolver;
}

const boundProfiles = new WeakMap<THREE.Object3D, PropertySceneProfile>();

export function bindPropertySceneProfile(scene: THREE.Object3D, profile: PropertySceneProfile): void {
  boundProfiles.set(scene, profile);
}

export function getBoundPropertySceneProfile(scene: THREE.Object3D): PropertySceneProfile | undefined {
  return boundProfiles.get(scene);
}
