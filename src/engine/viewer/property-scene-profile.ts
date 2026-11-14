import type { RoomVariationGroup, RoomVariationGroupInput } from "../variations/room-variation-controller.ts";
import type { RoomManifestEntry } from '../../core/types/twin-ux.ts';
import * as THREE from 'three';
import type {
  AccessPointEntityState,
  CctvCameraEntityState,
  RoomLodOptions,
  RoomZoneLodRegistration,
} from '../../core/entities.ts';
import type { CircuitId } from '../../core/types/knx.ts';
import type { SceneBuilderContext, ZoneIndicatorMaterials } from './scene-types.ts';
import type { FloorDefinition, FloorViewMode } from '../../core/types/scene.ts';
import type { RoomZoneId } from '../../core/types/topology.ts';
import type { DoorPolicy } from '../interaction/handlers/door-policy.ts';
import type { BifoldDoorAnimator } from '../interaction/bifold-animator.ts';
import type { InteractionRegistry } from '../interaction/interaction-registry.ts';
import type { TerrainSurfaceSampler } from '../../core/geo/terrain-modifiers.ts';
import type { SoundscapeDescriptor } from '../../core/types/acoustics.ts';
import type { HouseClimateInput, HouseEnvironmentInput } from '../../core/types/environment-hdri.ts';
import type { HouseLocation } from '../../core/types/solar-weather.ts';
import type { PortalVisibilitySolver } from '../lod/portal-visibility-solver.ts';
import type { HouseWalkthroughHooks } from '../walkthrough/walkthrough-controller.ts';
import type { SceneZoneRegistry } from './scene-zone-registry.ts';

export type UfhZoneId = 'ufhZone1' | 'ufhZone2' | 'ufhZone3' | 'ufhZone4';

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
  /** Fabric + infiltration heat-loss coefficient (W/K) for 1600s/1700s solid brick + double glazing */
  readonly heatLossWPerK: number;
  /** Effective thermal capacitance (Wh/K) of air + internal masonry skin + active screed/emitter */
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

/** Keys of `ZoneIndicatorMaterials` that represent multi-circuit wall switch LEDs. */
export type SwitchLedIndicatorKey = Extract<
  keyof ZoneIndicatorMaterials,
  'wallSwitchLedMat' | 'utilitySwitchLedMat' | 'courtyardSwitchLedMat'
>;

/**
 * A wall switch whose status LED lights when any of `circuits` is above 1%.
 * Rules are applied in array order.
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
  /** Meshes of a detached building, batched separately from the main house. */
  isDetachedBuildingMesh?(meshName: string, groupPrefix: string): boolean;
  /** Groups that move rigidly at runtime and are merged per group rather than per room. */
  isRigidDynamicGroup?(group: THREE.Group): boolean;
}

/**
 * Camera, orbit focus point and unit view direction on the XZ plane, expressed in the local frame
 * of the static cutaway wall container (`userData.containerOffset` / `containerRotationY`).
 */
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

/** `true` hides the corresponding `cutawayWallGroups` layer for the current view. */
export interface StaticCutawayGroupCuts {
  readonly southWest?: boolean;
  readonly west?: boolean;
  readonly north?: boolean;
  readonly east?: boolean;
}

export interface CutawayOptions {
  /**
   * Decides which of the four static camera-facing wall groups are cut away. Without it the
   * groups stay visible and only per-wall `userData.cutaway` descriptors are evaluated.
   */
  readonly evaluateStaticCutawayGroups?: (view: StaticCutawayView) => StaticCutawayGroupCuts;
}

export interface PortalSolverFactoryContext {
  readonly sceneRoot: THREE.Object3D;
  readonly lodRegistrations: readonly RoomZoneLodRegistration[];
  readonly interactions: InteractionRegistry;
  readonly bifolds: BifoldDoorAnimator;
}

/**
 * Everything the home-agnostic `PropertyScene` needs to know about a specific home.
 */
export interface PropertySceneProfile<TSecurity extends SecurityOverlay3D = SecurityOverlay3D> {
  /** Display name of the property. */
  readonly name?: string;
  /** The property's storeys. Homes that omit it get the two-storey `ground` / `first` default. */
  readonly floors?: readonly FloorDefinition[];
  /** Optional initial floor focus and section-cut state at boot. */
  readonly initialView?: {
    readonly floor?: FloorViewMode;
    readonly sectionCut?: boolean;
  };
  /** Geographic coordinates & orientation for solar/lunar ephemeris and Open-Meteo weather. */
  readonly location?: HouseLocation;
  /** Declarative 3D `(Season × TimeSlot × WeatherRegime)` HDRI panorama suite or preset id. */
  readonly environment?: HouseEnvironmentInput;
  /** Optional explicit climate zone / snow & seasonal foliage capability override. */
  readonly climate?: HouseClimateInput;
  /** Declarative exterior ambient soundscape preset or custom stems. */
  readonly soundscape?: SoundscapeDescriptor;
  /** Optional site terrain heightfield & carved ground mesh sampler. */
  readonly terrainSampler?: Pick<TerrainSurfaceSampler, 'sampleTerrainY' | 'sampleCarvedMeshY' | 'sampleNormal'>;
  /** First-person walkthrough hooks (spawns, elevation solver, climbables, cutscenes). */
  readonly walkthroughHooks?: HouseWalkthroughHooks;
  /** Optional entry spawns keyed by cutscene ID when triggered from orbit mode. */
  readonly cutsceneEntrySpawns?: Readonly<Record<string, { readonly position: readonly [number, number, number]; readonly yawDeg?: number }>>;
  createZoneRegistry(): SceneZoneRegistry;
  readonly lodRegistrations: readonly RoomZoneLodRegistration[];
  /** Optional declarative room manifest carrying per-room finishes, paint swatches & renovation notes. */
  readonly roomManifest?: readonly RoomManifestEntry[];
  /** Optional declarative room/design variations (or builder callback) for this property. */
  readonly variations?: readonly (RoomVariationGroup | RoomVariationGroupInput)[] | ((ctx: SceneBuilderContext) => readonly (RoomVariationGroup | RoomVariationGroupInput)[]);
  /** Scene-graph naming rules used to classify this home's hierarchy into room LOD tiers. */
  readonly lodOptions?: RoomLodOptions;
  /** Home-specific static-geometry batching rules. */
  readonly batchHooks?: BatchOptimizerHooks;
  /** Home-specific camera-facing wall cutaway rules. */
  readonly cutawayOptions?: CutawayOptions;
  /** Point-light intensity at 100% for every lighting circuit (key order is significant). */
  readonly circuitMaxIntensity: Readonly<Record<CircuitId, number>>;
  readonly defaultFixtureAppearance: CircuitFixtureAppearance;
  readonly fixtureAppearanceOverrides: Readonly<Partial<Record<CircuitId, CircuitFixtureAppearance>>>;
  readonly switchLedRules: readonly SwitchLedIndicatorRule[];
  readonly bifoldTrack: BifoldTrackConfig;
  /** Door conflict / open-angle / split-leaf rules keyed by stable door ids. */
  readonly doorPolicy?: DoorPolicy;
  buildSecurityOverlay(ctx: SceneBuilderContext): TSecurity;
  buildUfhOverlay?: (ctx: SceneBuilderContext) => UfhSystemOverlay3D;
  createPortalVisibilitySolver?: (ctx: PortalSolverFactoryContext) => PortalVisibilitySolver;
}

const boundProfiles = new WeakMap<THREE.Object3D, PropertySceneProfile>();

/**
 * Associates a built scene with the profile it was built from, so scene services constructed
 * without a profile reference can still find the home's hooks.
 */
export function bindPropertySceneProfile(scene: THREE.Object3D, profile: PropertySceneProfile): void {
  boundProfiles.set(scene, profile);
}

export function getBoundPropertySceneProfile(scene: THREE.Object3D): PropertySceneProfile | undefined {
  return boundProfiles.get(scene);
}
