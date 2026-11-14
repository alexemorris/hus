import type { RoomVariationGroup, RoomVariationGroupInput } from "../engine/variations/room-variation-controller.ts";
import { createDefaultHouseRuntime } from './default-runtime.ts';
import { getLoadingScreen } from '../ui/shell/loading.ts';
import { CircuitBus, type ElectricalSystemOptions } from '../core/electrical/index.ts';
import type {
  AccessPointEntityState,
  CctvCameraEntityState,
  RoomLodOptions,
  RoomZoneLodRegistration,
} from '../core/entities.ts';
import {
  createTerrainSampler,
  type TerrainConfig,
  type TerrainSurfaceSampler,
} from '../core/geo/terrain-modifiers.ts';
import type { SoundscapeDescriptor } from '../core/types/acoustics.ts';
import type { KnxZoneScene } from '../core/types/knx-zones.ts';
import type { CircuitId, InboundKNXFrame } from '../core/types/knx.ts';
import type { FloorDefinition, FloorViewMode, InteractiveUserData, Vec3Tuple } from '../core/types/scene.ts';
import type { HouseClimateInput, HouseEnvironmentInput } from '../core/types/environment-hdri.ts';
import type { HouseLocation } from '../core/types/solar-weather.ts';
import type { RoomBoundingBox, RoomZoneDefinition, RoomZoneId } from '../core/types/topology.ts';
import type { TwinApi, TwinRoomNavGroup } from '../core/types/twin-api.ts';
import type { RoomManifestEntry, TradeView } from '../core/types/twin-ux.ts';
import { SceneAnnotationStore } from '../engine/annotation/annotation-system.ts';

import type { DoorPolicy } from '../engine/interaction/handlers/door-policy.ts';
import { FocusController, type FocusRoom } from '../engine/rooms/focus-controller.ts';
import type {
  BatchOptimizerHooks,
  BifoldTrackConfig,
  CircuitFixtureAppearance,
  CutawayOptions,
  PortalSolverFactoryContext,
  PropertySceneProfile,
  SecurityOverlay3D,
  SwitchLedIndicatorRule,
  UfhSystemOverlay3D,
} from '../engine/viewer/property-scene-profile.ts';
import { PropertyScene } from '../engine/viewer/property-scene.ts';
import { playCorstonSwitchSound } from '../objects/fixtures/corston-toggle-switch.ts';
import type { SceneBuilderContext, SceneZoneModule } from '../engine/viewer/scene-types.ts';
import { SceneZoneRegistry } from '../engine/viewer/scene-zone-registry.ts';
import type * as THREE from 'three';
import {
  composeHouseWalkthroughElevation,
  type AutoWalkthroughElevationComposer,
} from '../engine/walkthrough/auto-elevation-composer.ts';
import type { HouseWalkthroughHooks } from '../engine/walkthrough/walkthrough-controller.ts';

export {
  composeHouseWalkthroughElevation,
  createAutoWalkthroughElevationComposer,
  type AutoWalkthroughElevationComposer,
  type AutoWalkthroughElevationComposerOptions,
  type StairWalkableSampler,
} from '../engine/walkthrough/auto-elevation-composer.ts';

export interface HouseWalkthroughConfig extends HouseWalkthroughHooks {
  /**
   * Optional simplified walkable elevation hook `(x, z, currentFootY) => y | null | undefined`.
   * Returning `null` or `undefined` falls back to `composeHouseWalkthroughElevation`.
   */
  readonly sampleElevationY?: (
    x: number,
    z: number,
    currentFootY: number
  ) => number | null | undefined;
}
import {
  KNXPropertyBusController,
  LoopbackSimulationTransport,
  MotionPresenceBridge,
  WebSocketKNXGatewayTransport,
  type KnxProject,
} from '../integrations/knx/index.ts';
import { KnxElectricalAdapter } from '../integrations/knx/electrical-adapter.ts';
import { SmartHomeHub } from '../integrations/smart-home-hub.ts';
import { UniFiAccessController } from '../integrations/unifi/access/adapter.ts';
import { UniFiProtectController } from '../integrations/unifi/protect/adapter.ts';

export interface HouseRoomsConfig {
  readonly manifest: readonly RoomManifestEntry[];
  readonly navTree: readonly TwinRoomNavGroup[];
  readonly roomZones?: Readonly<Partial<Record<string, RoomZoneDefinition>>>;
  readonly levelScenes?: Readonly<Partial<Record<RoomZoneId, readonly KnxZoneScene[]>>>;
  readonly focusRooms?: readonly FocusRoom[];
  readonly legacyRoomIds?: readonly RoomZoneId[];
  getManifest?: (zoneId: RoomZoneId) => RoomManifestEntry | undefined;
  getLevelScenes?: (zoneId: RoomZoneId) => readonly KnxZoneScene[];
  getZoneName?: (zoneId: RoomZoneId) => string | undefined;
  getBounds?: (zoneId: RoomZoneId) => RoomBoundingBox | null;
  isInterior?: (zoneId: RoomZoneId) => boolean;
}

export interface HouseZonesConfig<TSecurity extends SecurityOverlay3D = SecurityOverlay3D> {
  readonly modules?: readonly SceneZoneModule[];
  /** Optional declarative room/design variation groups (or builder callback receiving `SceneBuilderContext`). */
  readonly variations?: readonly (RoomVariationGroup | RoomVariationGroupInput)[] | ((ctx: SceneBuilderContext) => readonly (RoomVariationGroup | RoomVariationGroupInput)[]);
  createZoneRegistry?: () => SceneZoneRegistry;
  readonly lodRegistrations?: readonly RoomZoneLodRegistration[];
  readonly lodOptions?: RoomLodOptions;
  readonly batchHooks?: BatchOptimizerHooks;
  readonly cutawayOptions?: CutawayOptions;
  readonly circuitMaxIntensity: Readonly<Record<string, number>>;
  readonly defaultFixtureAppearance?: CircuitFixtureAppearance;
  readonly fixtureAppearanceOverrides?: Readonly<Partial<Record<CircuitId, CircuitFixtureAppearance>>>;
  readonly switchLedRules?: readonly SwitchLedIndicatorRule[];
  readonly bifoldTrack?: BifoldTrackConfig;
  readonly doorPolicy?: DoorPolicy;
  buildSecurityOverlay?: (ctx: SceneBuilderContext) => TSecurity;
  buildUfhOverlay?: (ctx: SceneBuilderContext) => UfhSystemOverlay3D;
}

export interface HousePortalsConfig {
  createPortalVisibilitySolver?: (
    ctx: PortalSolverFactoryContext
  ) => ReturnType<NonNullable<PropertySceneProfile['createPortalVisibilitySolver']>>;
}

export interface HouseSmartHomeAddresses {
  readonly gatePa?: string;
  readonly kitchenScenePa?: string;
  readonly courtyardSwitchPa?: string;
  readonly utilitySwitchPa?: string;
  readonly frameTvPa?: string;
}

export interface HouseSmartHomeConfig<TSecurity extends SecurityOverlay3D = SecurityOverlay3D> {
  readonly knxProject?: KnxProject;
  readonly presenceHoldTimeSec?: number;
  readonly unifiCameras?: readonly CctvCameraEntityState[];
  readonly unifiAccessPoints?: readonly AccessPointEntityState[];
  readonly addresses?: HouseSmartHomeAddresses;
  readonly initialSceneRecall?: { readonly sceneNumber: number; readonly sourcePa?: string };
  syncSecurity3D?: (
    scene: PropertyScene<TSecurity>,
    cameras: readonly CctvCameraEntityState[],
    accessPoints: readonly AccessPointEntityState[]
  ) => void;
}

export interface HouseLensesConfig {
  readonly enabledTrades?: readonly TradeView[];
  readonly defaultTrade?: TradeView;
}

export interface HouseDefinitionConfig<TSecurity extends SecurityOverlay3D = SecurityOverlay3D> {
  readonly id: string;
  readonly name: string;
  readonly location: HouseLocation;
  readonly environment?: HouseEnvironmentInput;
  readonly climate?: HouseClimateInput;
  readonly floors: readonly FloorDefinition[];
  readonly initialView?: {
    readonly floor?: FloorViewMode;
    readonly sectionCut?: boolean;
  };
  readonly terrain?: TerrainConfig | TerrainSurfaceSampler;
  readonly soundscape?: SoundscapeDescriptor;
  readonly rooms: HouseRoomsConfig;
  readonly zones: HouseZonesConfig<TSecurity>;
  /** Optional top-level room/design variation groups (merged with `zones.variations` and `ctx.variations`). */
  readonly variations?: readonly (RoomVariationGroup | RoomVariationGroupInput)[] | ((ctx: SceneBuilderContext) => readonly (RoomVariationGroup | RoomVariationGroupInput)[]);
  readonly portals?: HousePortalsConfig;
  readonly walkthrough?: HouseWalkthroughConfig;
  readonly cutsceneEntrySpawns?: Readonly<
    Record<string, { readonly position: readonly [number, number, number]; readonly yawDeg?: number }>
  >;
  readonly electrical?: ElectricalSystemOptions;
  readonly smartHome?: HouseSmartHomeConfig<TSecurity>;
  readonly lenses?: HouseLensesConfig;
  createScene?: (
    canvas: HTMLCanvasElement,
    onObjectInteraction: (
      data: InteractiveUserData,
      details?: {
        readonly pressDurationMs: number;
        readonly worldPosition?: { readonly x: number; readonly y: number; readonly z: number };
      }
    ) => void,
    profile: PropertySceneProfile<TSecurity>
  ) => PropertyScene<TSecurity>;
}

export interface HouseDefinition<TSecurity extends SecurityOverlay3D = SecurityOverlay3D>
  extends HouseDefinitionConfig<TSecurity> {
  readonly terrainSampler: TerrainSurfaceSampler;
  createSceneProfile(): PropertySceneProfile<TSecurity>;
}

function isTerrainSurfaceSampler(
  value: TerrainConfig | TerrainSurfaceSampler | undefined
): value is TerrainSurfaceSampler {
  return (
    typeof value === 'object' &&
    value !== null &&
    'sampleTerrainY' in value &&
    typeof value.sampleTerrainY === 'function'
  );
}

const DEFAULT_BIFOLD_TRACK: BifoldTrackConfig = {
  anchorRightX: 0,
  trackZ: 0,
  leafWidth: 0.85,
  maxFoldAngle: 1.4,
};

const EMPTY_SECURITY_OVERLAY: SecurityOverlay3D = {
  syncCameras: () => undefined,
  syncAccessPoints: () => undefined,
};

/**
 * Declares a self-contained `husjs` architectural digital twin (`id`, `name`,
 * zero-config `location`, `1..N` `floors`, non-destructive `terrain`, `soundscape`,
 * `rooms`, `zones`, `portals`, `walkthrough`, `electrical`, `smartHome`, `lenses`).
 */
export function defineHouse<TSecurity extends SecurityOverlay3D = SecurityOverlay3D>(
  config: HouseDefinitionConfig<TSecurity>
): HouseDefinition<TSecurity> {
  const terrainSampler = isTerrainSurfaceSampler(config.terrain)
    ? config.terrain
    : createTerrainSampler(config.terrain ?? { base: 'flat', flatElevationY: 0 });

  const normalizedFloors: readonly FloorDefinition[] = config.floors.map((f) => ({
    ...f,
    elevationY: f.elevationY ?? f.elevationM ?? 0,
    ...(f.ceilingHeight === undefined && f.ceilingCutawayY !== undefined
      ? { ceilingHeight: f.ceilingCutawayY - (f.elevationY ?? f.elevationM ?? 0) }
      : {}),
  }));

  const resolvedLodRegistrations: readonly RoomZoneLodRegistration[] =
    config.zones.lodRegistrations ??
    Object.values(config.rooms.roomZones ?? {})
      .filter((r): r is RoomZoneDefinition => r !== undefined)
      .map((r) => ({
        zoneId: r.id,
        shortName: r.shortName ?? r.name,
        floorId: r.floorId,
        bounds: r.bounds,
        isInterior: r.isInterior,
        ...(r.floorSurface !== undefined ? { floorSurface: r.floorSurface } : {}),
        ...(r.volumeM3 !== undefined ? { volumeM3: r.volumeM3 } : {}),
        ...(r.primarySurface !== undefined ? { primarySurface: r.primarySurface } : {}),
        ...(r.absorptionCoeff !== undefined ? { absorptionCoeff: r.absorptionCoeff } : {}),
        ...(r.finishes !== undefined ? { finishes: r.finishes } : {}),
        ...(r.notes !== undefined ? { notes: r.notes } : {}),
      }));

  const sortedFloors = [...normalizedFloors].sort((a, b) => a.elevationY - b.elevationY);
  const lowestFloorY = sortedFloors[0]?.elevationY ?? 0;
  const floorElevationById = new Map<string, number>(
    normalizedFloors.map((f) => [f.id, f.elevationY])
  );

  const resolveRootScene = (obj: THREE.Object3D): THREE.Object3D => {
    let cur = obj;
    while (cur.parent) {
      cur = cur.parent;
    }
    return cur;
  };

  const buildBaseZoneRegistry = (): SceneZoneRegistry => {
    const registry = config.zones.createZoneRegistry
      ? config.zones.createZoneRegistry()
      : new SceneZoneRegistry([...(config.zones.modules ?? [])]);
    if (registry.getInteriorBounds().length === 0 && resolvedLodRegistrations.length > 0) {
      registry.addInteriorBounds(
        resolvedLodRegistrations.filter((r) => r.isInterior !== false).map((r) => r.bounds)
      );
    }
    registry.ensureTopCameraPreset(
      normalizedFloors,
      resolvedLodRegistrations.map((r) => r.bounds)
    );
    return registry;
  };

  const createSceneProfile = (): PropertySceneProfile<TSecurity> => {
    let activeScene: THREE.Object3D | null = null;

    const elevationComposer: AutoWalkthroughElevationComposer = composeHouseWalkthroughElevation({
      floors: normalizedFloors,
      getScene: () => activeScene,
      terrainSampler,
      roomRegistrations: resolvedLodRegistrations,
      ...(config.walkthrough?.sampleElevationY
        ? { customSampler: config.walkthrough.sampleElevationY }
        : {}),
      ...(config.walkthrough?.sampleWalkableElevation
        ? { customWalkableSampler: config.walkthrough.sampleWalkableElevation }
        : {}),
    });

    const profileLodRegistrations: readonly RoomZoneLodRegistration[] =
      resolvedLodRegistrations.map((reg) => {
        const floorY =
          reg.walkingFloorY ?? floorElevationById.get(reg.floorId) ?? reg.bounds.minY;
        if (floorY <= lowestFloorY + 0.35) {
          return reg;
        }
        const prevCutout = reg.excludedCutout;
        return {
          ...reg,
          excludedCutout: (x: number, z: number): boolean => {
            if (prevCutout?.(x, z)) return true;
            return elevationComposer.isInsideUpperStairwellVoid(x, z, floorY);
          },
        };
      });

    const createProfileZoneRegistry = (): SceneZoneRegistry => {
      const registry = buildBaseZoneRegistry();
      const origBuildAll = registry.buildAllZones.bind(registry);
      registry.buildAllZones = (ctx: SceneBuilderContext) => {
        const res = origBuildAll(ctx);
        activeScene = resolveRootScene(ctx.scene);
        elevationComposer.invalidate();
        return res;
      };
      return registry;
    };

    const baseBuildSecurity = config.zones.buildSecurityOverlay;
    const buildSecurityOverlay = (ctx: SceneBuilderContext): TSecurity => {
      activeScene = resolveRootScene(ctx.scene);
      elevationComposer.invalidate();
      return baseBuildSecurity
        ? baseBuildSecurity(ctx)
        : (EMPTY_SECURITY_OVERLAY as TSecurity);
    };

    const composedWalkthroughHooks: HouseWalkthroughHooks = {
      ...config.walkthrough,
      sampleTerrainY:
        config.walkthrough?.sampleTerrainY ??
        ((x: number, z: number) => terrainSampler.sampleTerrainY(x, z)),
      sampleWalkableElevation: (x, refFootY, z, getRoomMinYAt) =>
        elevationComposer.sampleWalkableElevation(x, refFootY, z, getRoomMinYAt),
    };

    return {
      name: config.name,
      floors: normalizedFloors,
      ...(config.initialView ? { initialView: config.initialView } : {}),
      location: config.location,
      ...(config.environment !== undefined ? { environment: config.environment } : {}),
      ...(config.climate !== undefined ? { climate: config.climate } : {}),
      ...(config.soundscape !== undefined ? { soundscape: config.soundscape } : {}),
      terrainSampler,
      walkthroughHooks: composedWalkthroughHooks,
      ...(config.cutsceneEntrySpawns ? { cutsceneEntrySpawns: config.cutsceneEntrySpawns } : {}),
      createZoneRegistry: createProfileZoneRegistry,
      lodRegistrations: profileLodRegistrations,
      roomManifest: config.rooms.manifest,
      ...((config.zones.variations || config.variations)
        ? {
            variations: (ctx: SceneBuilderContext) => {
              const fromZones = typeof config.zones.variations === "function" ? config.zones.variations(ctx) : (config.zones.variations ?? []);
              const fromTop = typeof config.variations === "function" ? config.variations(ctx) : (config.variations ?? []);
              return [...fromZones, ...fromTop];
            },
          }
        : {}),
      ...(config.zones.lodOptions ? { lodOptions: config.zones.lodOptions } : {}),
      ...(config.zones.batchHooks ? { batchHooks: config.zones.batchHooks } : {}),
      ...(config.zones.cutawayOptions ? { cutawayOptions: config.zones.cutawayOptions } : {}),
      circuitMaxIntensity: config.zones.circuitMaxIntensity as Readonly<Record<CircuitId, number>>,
      defaultFixtureAppearance: config.zones.defaultFixtureAppearance ?? {
        emissiveMax: 2.8,
        coneOpacity: 0.2,
      },
      fixtureAppearanceOverrides: config.zones.fixtureAppearanceOverrides ?? {},
      switchLedRules: config.zones.switchLedRules ?? [],
      bifoldTrack: config.zones.bifoldTrack ?? DEFAULT_BIFOLD_TRACK,
      ...(config.zones.doorPolicy ? { doorPolicy: config.zones.doorPolicy } : {}),
      buildSecurityOverlay,
      ...(config.zones.buildUfhOverlay ? { buildUfhOverlay: config.zones.buildUfhOverlay } : {}),
      ...(config.portals?.createPortalVisibilitySolver
        ? { createPortalVisibilitySolver: config.portals.createPortalVisibilitySolver }
        : {}),
    };
  };

  return {
    ...config,
    floors: normalizedFloors,
    zones: {
      ...config.zones,
      lodRegistrations: resolvedLodRegistrations,
    },
    terrainSampler,
    createSceneProfile,
  };
}

export interface MountHouseRuntimeContext<TSecurity extends SecurityOverlay3D = SecurityOverlay3D> {
  readonly scene: PropertyScene<TSecurity>;
  readonly knx: KNXPropertyBusController;
  readonly annotations: SceneAnnotationStore;
  readonly home: {
    readonly name: string;
    readonly floors: readonly FloorDefinition[];
    readonly roomIds: readonly RoomZoneId[];
    readonly manifest: readonly RoomManifestEntry[];
    readonly navTree: readonly TwinRoomNavGroup[];
    getManifest(zoneId: RoomZoneId): RoomManifestEntry | undefined;
    getLevelScenes(zoneId: RoomZoneId): readonly KnxZoneScene[];
    getZoneName(zoneId: RoomZoneId): string | undefined;
    getBounds(zoneId: RoomZoneId): RoomBoundingBox | null;
    isInterior(zoneId: RoomZoneId): boolean;
    readonly focus: FocusController;
  };
  readonly gatePa?: string;
  readonly kitchenScenePa?: string;
  readonly courtyardSwitchPa?: string;
  readonly onWalkthroughPresence?: (pos: Vec3Tuple, zoneId: RoomZoneId | null) => void;
}

export interface MountHouseRuntimeHandle {
  readonly api: TwinApi;
  tick(dtSeconds: number): void;
  isActive(): boolean;
  isStationaryPrecipitationOnly(): boolean;
  dispose(): void;
}

export interface MountHouseOptions<TSecurity extends SecurityOverlay3D = SecurityOverlay3D> {
  readonly canvas?: HTMLCanvasElement;
  readonly shellRoot?: HTMLElement;
  readonly createRuntime?: (ctx: MountHouseRuntimeContext<TSecurity>) => MountHouseRuntimeHandle;
  readonly mountDev?: boolean;
  readonly exposeWindowGlobal?: boolean;
}

export interface MountedHouse<TSecurity extends SecurityOverlay3D = SecurityOverlay3D> {
  readonly house: HouseDefinition<TSecurity>;
  readonly scene: PropertyScene<TSecurity>;
  readonly electrical: CircuitBus;
  readonly knx: KNXPropertyBusController;
  readonly knxAdapter: KnxElectricalAdapter | null;
  readonly hub: SmartHomeHub;
  readonly annotations: SceneAnnotationStore;
  readonly api: TwinApi;
  connectToGateway(wsEndpointUrl: string): Promise<void>;
  useSimulation(): void;
  injectTelegram(frameOrHex: string | InboundKNXFrame): void;
  dispose(): void;
}

/**
 * Computes a sanitized animation step in seconds within a single rAF clock domain.
 */
export function computeAnimationStepSeconds(
  nowMs: number,
  lastFrameTimeMs: number | null,
  maxStepSec = 0.1,
  wakeStepSec = 1 / 60
): number {
  if (!Number.isFinite(nowMs)) return 0;
  if (lastFrameTimeMs === null || !Number.isFinite(lastFrameTimeMs)) {
    return Math.min(maxStepSec, Math.max(0, wakeStepSec));
  }
  return Math.min(maxStepSec, Math.max(0, (nowMs - lastFrameTimeMs) / 1000));
}

function installMobileViewportZoomGuard(canvasId: string): void {
  const preventEvent = (e: Event): void => {
    e.preventDefault();
  };
  document.addEventListener('gesturestart', preventEvent, { passive: false });
  document.addEventListener('gesturechange', preventEvent, { passive: false });
  document.addEventListener('gestureend', preventEvent, { passive: false });

  document.addEventListener(
    'touchmove',
    (e: TouchEvent) => {
      const scaledEvent = e as TouchEvent & { readonly scale?: number };
      if (scaledEvent.scale !== undefined && scaledEvent.scale !== 1) {
        e.preventDefault();
        return;
      }
      if (e.touches.length > 1) {
        const target = e.target as HTMLElement | null;
        if (!target || target.id !== canvasId) {
          e.preventDefault();
        }
      }
    },
    { passive: false }
  );

  window.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      if (e.ctrlKey) {
        const target = e.target as HTMLElement | null;
        if (!target || target.id !== canvasId) {
          e.preventDefault();
        }
      }
    },
    { passive: false }
  );
}

function createEmptyKnxProject(
  house: HouseDefinition<SecurityOverlay3D>,
  electrical?: CircuitBus
): KnxProject {
  const defaultFloorId = (house.floors[0]?.id ?? "ground") as "ground";
  const defaultZoneId = (house.rooms.manifest[0]?.zoneId ?? "kitchen") as RoomZoneId;
  const manifestByCircuit = new Map<string, { label: string; zoneId: RoomZoneId; floorId: string; dimmable: boolean }>();
  for (const room of house.rooms.manifest) {
    for (const light of room.lights) {
      manifestByCircuit.set(light.circuitId, {
        label: light.label,
        zoneId: room.zoneId,
        floorId: room.floor,
        dimmable: light.dimmable,
      });
    }
  }
  const allIds = [
    ...new Set<string>([
      ...Object.keys(house.zones.circuitMaxIntensity),
      ...(electrical ? electrical.getCircuits().map((c) => c.id) : []),
    ]),
  ];
  const circuits = allIds.map((id, idx) => {
    const spec = electrical?.getCircuit(id);
    const meta = manifestByCircuit.get(id);
    const targetPct = electrical
      ? Math.round(electrical.getCircuitTargetBrightness(id) * 100)
      : 85;
    return {
      id: id as CircuitId,
      channel: idx + 1,
      name: spec?.name ?? meta?.label ?? id,
      shortName: spec?.shortName ?? spec?.name ?? meta?.label ?? id,
      location: house.name,
      buildingId: (spec?.buildingId ?? "mainHouse") as "mainHouse",
      floorId: (spec?.floorId ?? meta?.floorId ?? defaultFloorId) as "ground",
      zoneId: (spec?.zoneId ?? meta?.zoneId ?? defaultZoneId) as RoomZoneId,
      actuatorPa: "1.1.20",
      gaSwitch: `1/1/${idx + 1}`,
      gaValue: `1/2/${idx + 1}`,
      gaStatus: `1/3/${idx + 1}`,
      isSceneMember: false,
      ...(spec?.kind ? { kind: spec.kind as KnxProject["circuits"][number]["kind"] } : {}),
      dimmable: spec?.dimmable ?? meta?.dimmable ?? true,
      defaultLevel: targetPct,
    };
  });
  const zones: KnxProject["zones"] = electrical
    ? electrical.getZones().map((z, zIdx) => ({
        id: z.id as RoomZoneId,
        name: z.name,
        circuits: z.circuits as readonly CircuitId[],
        scenes: z.scenes.map((sc) => {
          const pctLevels: Partial<Record<CircuitId, number>> = {};
          for (const [cid, lvl01] of Object.entries(sc.levels)) {
            pctLevels[cid as CircuitId] = Math.round(lvl01 * 100);
          }
          return { id: sc.id, label: sc.label, levels: pctLevels };
        }),
        nightLevels: {},
        ga: {
          scene: `2/0/${zIdx + 1}`,
          sceneStatus: `2/1/${zIdx + 1}`,
          night: `2/2/${zIdx + 1}`,
          full: `2/3/${zIdx + 1}`,
          status: `2/4/${zIdx + 1}`,
          dim: `2/5/${zIdx + 1}`,
        },
      }))
    : [];
  return {
    name: house.name,
    buildings: {} as KnxProject["buildings"],
    floors: [],
    rooms: [],
    physicalDevices: [],
    circuits,
    centralScenes: [],
    zones,
    pushButtons: [],
    presenceDetectors: [],
    roomAutomation: {
      nightWalkRules: [],
      motionCircuitRules: [],
      motionSensors: [],
    },
    centralPa: {
      ipInterface: "1.1.1",
      aiBridge: "1.1.2",
      kitchenSwitchGroup: "1.1.10",
      kitchenPresence: "1.1.30",
      utilityPresence: "1.1.31",
      utilitySwitch: "1.1.11",
      courtyardSwitch: "1.1.14",
      kitchenActuator: "1.1.20",
      carGates: "1.1.22",
    },
    centralGa: {
      masterOff: "0/0/1",
      centralScene: "1/0/1",
      masterFull: "0/0/2",
      kitchenPresence: "3/1/1",
      ambientLux: "3/0/1",
      utilityPresence: "3/1/2",
      tvArt: "4/0/3",
      carGatesCommand: "5/0/1",
      carGatesPosition: "5/0/2",
    },
    defaultPresenceHoldTimeSec: 120,
    groupAddresses: [],
  };
}

function resolveContainerElements(
  container: HTMLElement | Document,
  options?: { readonly canvas?: HTMLCanvasElement; readonly shellRoot?: HTMLElement }
): { hostEl: HTMLElement; canvasEl: HTMLCanvasElement; shellRoot: HTMLElement } {
  const hostEl =
    container instanceof Document
      ? ((container.getElementById('app') as HTMLElement | null) ?? container.body)
      : container;
  if (!hostEl) {
    throw new Error('Mount container element not found');
  }

  let canvasEl =
    options?.canvas ?? (hostEl.querySelector('#three-canvas') as HTMLCanvasElement | null);
  if (!canvasEl) {
    canvasEl = hostEl.ownerDocument.createElement('canvas');
    canvasEl.id = 'three-canvas';
    hostEl.appendChild(canvasEl);
  }
  if (!(canvasEl instanceof HTMLCanvasElement)) {
    throw new Error('Element #three-canvas not found');
  }

  let shellRoot =
    options?.shellRoot ?? (hostEl.querySelector('#shell-root') as HTMLElement | null);
  if (!shellRoot) {
    shellRoot = hostEl.ownerDocument.createElement('div');
    shellRoot.id = 'shell-root';
    hostEl.appendChild(shellRoot);
  }
  if (!(shellRoot instanceof HTMLElement)) {
    throw new Error('Element #shell-root not found');
  }
  return { hostEl, canvasEl, shellRoot };
}

/**
 * Mounts a `defineHouse(...)` digital twin into `container`, initializing its
 * electrical/smart-home runtime, 3D scene, UI shell, warmup pipeline, and demand-driven rAF loop.
 */
export async function mountHouse<TSecurity extends SecurityOverlay3D = SecurityOverlay3D>(
  house: HouseDefinition<TSecurity>,
  container: HTMLElement | Document,
  options: MountHouseOptions<TSecurity> = {}
): Promise<MountedHouse<TSecurity>> {
  const { hostEl, canvasEl, shellRoot } = resolveContainerElements(container, options);
  installMobileViewportZoomGuard(canvasEl.id || 'three-canvas');
  const loading = getLoadingScreen(hostEl, house.name);
  if (typeof document !== 'undefined' && typeof document.title === 'string') {
    document.title = `${house.name} — Digital Twin`;
  }
  const [
    { DevDrawer, mountDevTools },
    { mountAppShell },
    { hasSeenHelp, openHelp },
  ] = await Promise.all([
    import('../ui/dev/mount-dev-tools.ts'),
    import('../ui/shell/mount-shell.tsx'),
    import('../state/shell-store.ts'),
  ]);

  await loading.setProgress('Connecting to the smart-home bus…', 0.1);

  const smartHome = house.smartHome;
  const addresses = smartHome?.addresses ?? {};
  const gatePa = addresses.gatePa ?? '1.1.22';
  const courtyardSwitchPa = addresses.courtyardSwitchPa ?? '1.1.14';
  const kitchenScenePa = addresses.kitchenScenePa ?? '1.1.10';
  const utilitySwitchPa = addresses.utilitySwitchPa ?? '1.1.11';
  const frameTvPa = addresses.frameTvPa ?? '1.1.12';

  const liveGatewayUrl =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('knxWs')
      : null;

  const preElectrical = house.electrical ? new CircuitBus(house.electrical) : null;
  const knxProject =
    smartHome?.knxProject ??
    createEmptyKnxProject(
      house as unknown as HouseDefinition<SecurityOverlay3D>,
      preElectrical ?? undefined
    );
  const knx = new KNXPropertyBusController(
    knxProject,
    liveGatewayUrl ? new WebSocketKNXGatewayTransport(liveGatewayUrl) : new LoopbackSimulationTransport()
  );
  if (smartHome?.presenceHoldTimeSec !== undefined) {
    knx.setPresenceHoldTimeOverride(smartHome.presenceHoldTimeSec);
  }

  const electrical =
    preElectrical ??
    new CircuitBus({
      circuits: knx.getCircuits().map((c) => ({
        id: c.id,
        name: c.name,
        zoneId: c.zoneId,
        dimmable: c.dimmable,
      })),
    });
  const knxAdapter = smartHome?.knxProject ? new KnxElectricalAdapter({ knx, bus: electrical }) : null;
  const isConventionalElectrical = !smartHome?.knxProject && Boolean(house.electrical);
  let syncingConventionalBus = false;

  const presenceBridge = new MotionPresenceBridge(knx, knx.getPresenceDetectors());
  const hub = new SmartHomeHub(
    knx,
    new UniFiProtectController(smartHome?.unifiCameras ?? []),
    new UniFiAccessController(smartHome?.unifiAccessPoints ?? [])
  );
  const annotations = new SceneAnnotationStore();

  await loading.setProgress(`Building ${house.name}…`, 0.25);

  const profile = house.createSceneProfile();
  let scene!: PropertyScene<TSecurity>;

  const syncUniFi = (): void => {
    if (smartHome?.syncSecurity3D) {
      smartHome.syncSecurity3D(scene, hub.protect.getCameras(), hub.access.getAccessPoints());
    } else {
      scene.syncUniFiSecurity3D(hub.protect.getCameras(), hub.access.getAccessPoints());
    }
  };

  const syncConventionalToKnx = (): void => {
    if (!isConventionalElectrical || syncingConventionalBus) return;
    syncingConventionalBus = true;
    try {
      const pcts = electrical.getTargetLevelsPct();
      for (const [cid, pct] of Object.entries(pcts)) {
        knx.setCircuitLevel(cid as CircuitId, pct, false);
      }
      knx.stepDimming(10);
      if (scene) {
        scene.applyKNXLightLevels(pcts as Record<CircuitId, number>);
      }
    } finally {
      syncingConventionalBus = false;
    }
  };

  if (isConventionalElectrical) {
    knx.subscribe((ev) => {
      if (syncingConventionalBus || ev.type !== 'stateChange') return;
      syncingConventionalBus = true;
      try {
        const target = knx.getTargetLevels();
        const updates01: Record<string, number> = {};
        for (const c of electrical.getCircuits()) {
          const v = (target as Record<string, number | undefined>)[c.id];
          if (typeof v === 'number') {
            updates01[c.id] = v / 100;
          }
        }
        electrical.setCircuitLevels01(updates01, { immediate: true, source: 'knx-sync' });
        if (scene) {
          scene.applyKNXLightLevels(electrical.getLiveLevelsPct() as Record<CircuitId, number>);
        }
      } finally {
        syncingConventionalBus = false;
      }
    });
  }

  const onObjectInteraction = (
    userData: InteractiveUserData,
    details?: {
      readonly pressDurationMs: number;
      readonly worldPosition?: { readonly x: number; readonly y: number; readonly z: number };
    }
  ): void => {
    if (userData.zoneSceneSwitchZoneId) {
      playCorstonSwitchSound('scene', details?.worldPosition);
      knx.handleZoneSwitchGesture(
        userData.zoneSceneSwitchZoneId,
        userData.switchDirection ?? 'up',
        details?.pressDurationMs ?? 0,
        userData.switchPa,
        userData.switchLocation
      );
    } else if (userData.presenceDetectorPa) {
      playCorstonSwitchSound('switch', details?.worldPosition);
      knx.togglePresence(userData.presenceDetectorPa);
    } else if (isConventionalElectrical && userData.electricalDimmerId) {
      playCorstonSwitchSound('switch', details?.worldPosition);
      const dim = electrical.getDimmer(userData.electricalDimmerId);
      if (dim) {
        if (!dim.enabled || dim.level >= 0.95) {
          if (!dim.enabled) {
            electrical.setDimmerEnabled(userData.electricalDimmerId, true);
            electrical.setDimmerLevel(userData.electricalDimmerId, 0.4, { immediate: true });
          } else {
            electrical.setDimmerEnabled(userData.electricalDimmerId, false, { immediate: true });
          }
        } else {
          const next = dim.level < 0.65 ? 0.75 : 1.0;
          electrical.setDimmerLevel(userData.electricalDimmerId, next, { immediate: true });
        }
        syncConventionalToKnx();
      }
    } else if (isConventionalElectrical && userData.electricalSwitchId) {
      playCorstonSwitchSound('switch', details?.worldPosition);
      electrical.flipSwitch(userData.electricalSwitchId, undefined, { immediate: true });
      syncConventionalToKnx();
    } else if (isConventionalElectrical && userData.isKNXSwitch && userData.switchPa) {
      playCorstonSwitchSound('switch', details?.worldPosition);
      electrical.flipPlateGang(
        userData.switchPa,
        userData.switchGang ?? 1,
        undefined,
        { immediate: true }
      );
      syncConventionalToKnx();
    } else if (userData.isKNXSwitch) {
      playCorstonSwitchSound('switch', details?.worldPosition);
      knx.handleSwitchShortPress(userData.switchDirection ?? 'up', userData.switchLocation);
    } else if (userData.isCourtyardSwitch) {
      playCorstonSwitchSound('switch', details?.worldPosition);
      knx.handleCourtyardSwitchShortPress(
        userData.switchDirection ?? 'up',
        userData.switchPa ?? courtyardSwitchPa
      );
    } else if (userData.isUtilitySwitch) {
      playCorstonSwitchSound('switch', details?.worldPosition);
      knx.handleUtilitySwitchToggle(userData.switchPa ?? utilitySwitchPa);
    } else if (userData.isKitchenMotionSensor) {
      playCorstonSwitchSound('switch', details?.worldPosition);
      knx.toggleKitchenMotion();
    } else if (userData.isUtilityMotionSensor) {
      playCorstonSwitchSound('switch', details?.worldPosition);
      knx.toggleUtilityMotion();
    } else if (userData.roomMotionSensorId) {
      playCorstonSwitchSound('switch', details?.worldPosition);
      knx.toggleRoomMotion(userData.roomMotionSensorId);
    } else if (userData.isFrameTV) {
      playCorstonSwitchSound('switch', details?.worldPosition);
      knx.cycleTvArt(true, frameTvPa);
    } else if (userData.isBifoldDoor) {
      scene.toggleBifolds();
    } else if (userData.isCarGate) {
      knx.toggleCarGates(gatePa);
    } else if (userData.isUniFiCamera) {
      hub.protect.toggleAllFrustums();
    } else if (userData.isUniFiAccessReader && userData.accessEntityId) {
      hub.triggerAccessUnlock(userData.accessEntityId, 'NFC Card');
    } else if (userData.circuitId) {
      playCorstonSwitchSound('switch', details?.worldPosition);
      if (isConventionalElectrical) {
        electrical.toggleCircuit(userData.circuitId, { immediate: true });
        syncConventionalToKnx();
      } else {
        knx.toggleCircuit(
          userData.circuitId as CircuitId,
          userData.switchPa,
          userData.switchLocation,
          userData.switchDirection
        );
      }
    }
  };

  scene = house.createScene
    ? house.createScene(canvasEl, onObjectInteraction, profile)
    : new PropertyScene<TSecurity>(canvasEl, onObjectInteraction, profile);

  const hubUnsub = hub.subscribe((ev) => {
    if (ev.type === 'entityChanged') syncUniFi();
  });
  syncUniFi();

  const byZoneId = new Map(house.rooms.manifest.map((e) => [e.zoneId, e] as const));
  const focusRooms: readonly FocusRoom[] =
    house.rooms.focusRooms ??
    (house.zones.lodRegistrations ?? []).map((r) => ({
      zoneId: r.zoneId,
      floorId: r.floorId,
      bounds: r.bounds,
      isInterior: r.isInterior !== false,
    }));

  const homeData = {
    name: house.name,
    floors: house.floors,
    roomIds: [
      ...new Set<RoomZoneId>([
        ...house.rooms.manifest.map((e) => e.zoneId),
        ...focusRooms.map((r) => r.zoneId),
        ...(house.rooms.legacyRoomIds ?? []),
      ]),
    ],
    manifest: house.rooms.manifest,
    navTree: house.rooms.navTree,
    getManifest: house.rooms.getManifest ?? ((zoneId: RoomZoneId) => byZoneId.get(zoneId)),
    getLevelScenes:
      house.rooms.getLevelScenes ??
      ((zoneId: RoomZoneId) => house.rooms.levelScenes?.[zoneId] ?? []),
    getZoneName:
      house.rooms.getZoneName ??
      ((zoneId: RoomZoneId) =>
        house.rooms.roomZones?.[zoneId]?.name ?? byZoneId.get(zoneId)?.label),
    getBounds:
      house.rooms.getBounds ??
      ((zoneId: RoomZoneId) =>
        house.rooms.roomZones?.[zoneId]?.bounds ??
        focusRooms.find((r) => r.zoneId === zoneId)?.bounds ??
        null),
    isInterior:
      house.rooms.isInterior ??
      ((zoneId: RoomZoneId) =>
        house.rooms.roomZones?.[zoneId]?.isInterior ??
        focusRooms.find((r) => r.zoneId === zoneId)?.isInterior ??
        false),
    focus: new FocusController(focusRooms, undefined, house.floors),
  };

  const createRuntime: (ctx: MountHouseRuntimeContext<TSecurity>) => MountHouseRuntimeHandle = options.createRuntime ?? createDefaultHouseRuntime;
  const runtime = createRuntime({
    scene,
    knx,
    annotations,
    home: homeData,
    gatePa,
    kitchenScenePa,
    courtyardSwitchPa,
    onWalkthroughPresence: (pos) => {
      presenceBridge.update(pos);
    },
  });
  const { api } = runtime;

  await loading.setProgress('Preparing controls…', 0.52);

  if (options.mountDev !== false) {
    mountDevTools({ scene, knx, hub, api });
  }
  const shell = mountAppShell(
    { api, ...(options.mountDev !== false ? { devDrawer: DevDrawer } : {}) },
    shellRoot
  );

  if (smartHome?.initialSceneRecall) {
    knx.recallScene(
      smartHome.initialSceneRecall.sceneNumber,
      smartHome.initialSceneRecall.sourcePa ?? kitchenScenePa
    );
    knx.stepDimming(10);
    scene.applyKNXLightLevels(knx.getLiveLevels());
  } else if (isConventionalElectrical) {
    syncConventionalToKnx();
  }

  try {
    await scene.warmUpForStartup((label, fraction) => loading.setProgress(label, fraction));
    runtime.tick(0.016);
  } catch (err) {
    console.error('[husjs/mountHouse] warmUpForStartup error (continuing boot):', err);
  }
  loading.finish();
  if (!hasSeenHelp()) {
    window.requestAnimationFrame(() => openHelp(0));
  }

  const IDLE_TICKS_BEFORE_SLEEP = 3;
  const PRECIP_PACE_INTERVAL_MS = 33;
  let lastFrameTime: number | null = null;
  let rafId = 0;
  let paceTimerId = 0;
  let consecutiveIdleTicks = 0;
  let inAnimateTick = false;
  let disposed = false;

  const scheduleNextFrame = (): void => {
    if (!disposed && rafId === 0 && !document.hidden) {
      rafId = requestAnimationFrame(animate);
    }
  };

  const wakeLoop = (): void => {
    if (disposed) return;
    consecutiveIdleTicks = 0;
    if (paceTimerId !== 0) {
      clearTimeout(paceTimerId);
      paceTimerId = 0;
    }
    if (inAnimateTick) return;
    if (rafId === 0 && !document.hidden) {
      lastFrameTime = null;
      scheduleNextFrame();
    }
  };

  const animate = (now: number): void => {
    rafId = 0;
    if (disposed || document.hidden) {
      lastFrameTime = null;
      return;
    }
    const dt = computeAnimationStepSeconds(now, lastFrameTime);
    lastFrameTime = Number.isFinite(now) ? now : null;
    inAnimateTick = true;
    try {
      runtime.tick(dt);
    } finally {
      inAnimateTick = false;
    }

    if (runtime.isActive()) {
      consecutiveIdleTicks = 0;
      if (runtime.isStationaryPrecipitationOnly()) {
        if (paceTimerId === 0 && rafId === 0) {
          paceTimerId = window.setTimeout(() => {
            paceTimerId = 0;
            scheduleNextFrame();
          }, PRECIP_PACE_INTERVAL_MS);
        }
      } else {
        scheduleNextFrame();
      }
    } else {
      consecutiveIdleTicks += 1;
      if (consecutiveIdleTicks < IDLE_TICKS_BEFORE_SLEEP) {
        scheduleNextFrame();
      }
    }
  };

  scene.renderer.addRequestRenderListener(wakeLoop);
  const knxUnsub = knx.subscribe(() => wakeLoop());
  const elecUnsub = electrical.subscribe(() => wakeLoop());

  const onVisibilityChange = (): void => {
    if (document.hidden) {
      if (paceTimerId !== 0) {
        clearTimeout(paceTimerId);
        paceTimerId = 0;
      }
      if (rafId !== 0) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      return;
    }
    scene.renderer.requestRender();
    wakeLoop();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  wakeLoop();

  const mountedHandle: MountedHouse<TSecurity> = {
    house,
    scene,
    electrical,
    knx,
    knxAdapter,
    hub,
    annotations,
    api,
    connectToGateway: (wsEndpointUrl: string) => knx.connectToGateway(wsEndpointUrl),
    useSimulation: () => knx.useSimulationTransport(),
    injectTelegram: (frameOrHex: string | InboundKNXFrame) => knx.ingestExternalFrame(frameOrHex),
    dispose: () => {
      disposed = true;
      if (paceTimerId !== 0) clearTimeout(paceTimerId);
      if (rafId !== 0) cancelAnimationFrame(rafId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      hubUnsub();
      knxUnsub();
      elecUnsub();
      knxAdapter?.dispose();
      void shell;
      runtime.dispose();
      if (typeof window !== 'undefined') {
        const win = window as unknown as Record<string, unknown>;
        if (win['__HUSJS_MOUNTED__'] === mountedHandle) {
          delete win['__HUSJS_MOUNTED__'];
          delete win['__HUSJS_EXPORT_GLB__'];
        }
      }
    },
  };
  if (options.exposeWindowGlobal !== false && typeof window !== 'undefined') {
    const win = window as unknown as Record<string, unknown>;
    win['__HUSJS_MOUNTED__'] = mountedHandle;
    win['__HUSJS_EXPORT_GLB__'] = async (exportOpts?: Record<string, unknown>) => {
      const { exportPropertySceneToGlb } = await import('../engine/export/glb-scene-exporter.ts');
      return exportPropertySceneToGlb(scene, exportOpts as never);
    };
  }
  return mountedHandle;
}
