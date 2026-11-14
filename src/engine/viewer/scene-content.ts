import { VariationRegistry, type RoomVariationGroup } from "../variations/room-variation-controller.ts";
import * as THREE from 'three';
import { setRoomZoneRegistrations } from '../rooms/room-zone-registry.ts';
import type { RoomLodController } from '../lod/lod-manager.ts';
import type { CircuitId } from '../../core/types/knx.ts';
import type { RoomFinishSpec, RoomManifestEntry } from '../../core/types/twin-ux.ts';
import type { RoomZoneLodRegistration } from '../../core/entities.ts';
import type { FloorDefinition, Vec3Tuple } from '../../core/types/scene.ts';
import type {
  BifoldPanelRef,
  CutawayWallGroups,
  FloorBuilderScope,
  FloorLayerEntry,
  LightCircuitGroup,
  LightGroupMap,
  SceneBuilderContext,
  ZoneIndicatorMaterials,
} from './scene-types.ts';
import {
  createRadialGlowTexture,
  createTVArtGalleryTextures,
  createTVOffTexture,
} from '../textures/procedural-textures.ts';
import { bindSmartAssetsInScene } from '../assets/smart-asset.ts';
import { SceneInteractionManager } from '../interaction/interaction-manager.ts';
import {
  bindPropertySceneProfile,
  type PropertySceneProfile,
  type SecurityOverlay3D,
  type UfhSystemOverlay3D,
} from './property-scene-profile.ts';
import type { SceneZoneRegistry } from './scene-zone-registry.ts';

const groupFloorMap = new WeakMap<THREE.Object3D, string>();

const DEFAULT_LAYER_FLOORS: readonly FloorDefinition[] = [
  { id: 'ground', label: 'Ground Floor', elevationY: 0, ceilingHeight: 2.5 },
  { id: 'first', label: 'First Floor', elevationY: 2.5, ceilingHeight: 2.5 },
];

/**
 * Resolves the floor ID associated with a top-level floor layer group (including aliased
 * legacy groups such as `firstFloorMeshGroup` or `groundFloorCeilingGroup` whose `.userData`
 * is kept pristine for snapshot compatibility).
 */
export function getFloorIdForSceneGroup(obj: THREE.Object3D): string | undefined {
  return groupFloorMap.get(obj);
}

function createLazyMountedGroup(
  parent: THREE.Object3D,
  name: string,
  userData?: Record<string, unknown>
): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  if (userData) {
    g.userData = { ...userData };
  }
  g.add = function addLazy(...objs: THREE.Object3D[]): THREE.Group {
    if (!g.parent && objs.length > 0) {
      parent.add(g);
    }
    return THREE.Group.prototype.add.apply(g, objs);
  };
  return g;
}

export interface ScopedBuilderContextOptions {
  readonly name: string;
  readonly offset?: Vec3Tuple;
  readonly rotationY?: number;
}

/**
 * Creates a hierarchical child `SceneBuilderContext` whose scene, first-floor,
 * ground-floor ceiling, roof, site, N-storey floor, cutaway-wall, and glow-pool layers
 * are parented inside transformed `THREE.Group` containers. Every mesh or group added
 * to this context inherits the parent wing/room transform (`offset` and `rotationY`) automatically.
 */
export function createScopedBuilderContext(
  parentCtx: SceneBuilderContext,
  options: ScopedBuilderContextOptions
): SceneBuilderContext {
  const [dx, dy, dz] = options.offset ?? [0, 0, 0];
  const rotY = options.rotationY ?? 0;

  const makeLayerGroup = (
    parentLayer: THREE.Object3D,
    suffix: string,
    isArchShell = false,
    lazy = false
  ): THREE.Group => {
    const g = new THREE.Group();
    g.name = `${options.name}.${suffix}`;
    g.position.set(dx, dy, dz);
    g.rotation.y = rotY;
    g.userData = {
      isRoomContainer: true,
      containerOffset: [dx, dy, dz] as const,
      containerRotationY: rotY,
      ...(isArchShell ? { isArchitecturalShell: true } : {}),
    };
    if (lazy) {
      g.add = function addLazyScoped(...objs: THREE.Object3D[]): THREE.Group {
        if (!g.parent && objs.length > 0) {
          parentLayer.add(g);
        }
        return THREE.Group.prototype.add.apply(g, objs);
      };
    } else {
      parentLayer.add(g);
    }
    return g;
  };

  const scopedSceneGroup = makeLayerGroup(parentCtx.scene, 'scene');
  const scopedFirstFloorGroup = makeLayerGroup(parentCtx.firstFloorMeshGroup, 'firstFloor');
  const scopedGroundCeilingGroup = makeLayerGroup(
    parentCtx.groundFloorCeilingGroup,
    'groundCeiling',
    true
  );
  const scopedCeilingGroup = makeLayerGroup(parentCtx.ceilingMeshGroup, 'roof', true);
  const scopedCutawayWallGroups: CutawayWallGroups = {
    southWest: makeLayerGroup(parentCtx.cutawayWallGroups.southWest, 'cutaway.southWest', true),
    west: makeLayerGroup(parentCtx.cutawayWallGroups.west, 'cutaway.west', true),
    north: makeLayerGroup(parentCtx.cutawayWallGroups.north, 'cutaway.north', true),
    east: makeLayerGroup(parentCtx.cutawayWallGroups.east, 'cutaway.east', true),
  };

  const scopedSiteGroup = parentCtx.site
    ? makeLayerGroup(parentCtx.site, 'site', false, true)
    : undefined;

  const scopedFloorCache = new Map<string, FloorBuilderScope>();
  const scopedFloorFn = parentCtx.floor
    ? (floorId: string): FloorBuilderScope => {
        const cached = scopedFloorCache.get(floorId);
        if (cached) return cached;
        const parentFloor = parentCtx.floor!(floorId);
        const contentGroup =
          parentFloor.group === parentCtx.firstFloorMeshGroup
            ? scopedFirstFloorGroup
            : makeLayerGroup(parentFloor.group, `floor.${floorId}.content`, false, true);
        const slabGroup = makeLayerGroup(
          parentFloor.slabGroup,
          `floor.${floorId}.slab`,
          true,
          true
        );
        const ceilingGroup =
          parentFloor.ceilingGroup === parentCtx.groundFloorCeilingGroup
            ? scopedGroundCeilingGroup
            : makeLayerGroup(parentFloor.ceilingGroup, `floor.${floorId}.ceiling`, true, true);
        const scope: FloorBuilderScope = {
          id: parentFloor.id,
          elevationY: parentFloor.elevationY,
          ceilingHeight: parentFloor.ceilingHeight,
          group: contentGroup,
          slabGroup,
          ceilingGroup,
          add: (...objects: THREE.Object3D[]) => {
            contentGroup.add(...objects);
          },
        };
        scopedFloorCache.set(floorId, scope);
        return scope;
      }
    : undefined;

  const cosR = Math.cos(rotY);
  const sinR = Math.sin(rotY);

  return {
    ...parentCtx,
    scene: scopedSceneGroup as unknown as THREE.Scene,
    firstFloorMeshGroup: scopedFirstFloorGroup,
    groundFloorCeilingGroup: scopedGroundCeilingGroup,
    ceilingMeshGroup: scopedCeilingGroup,
    roof: scopedCeilingGroup,
    ...(scopedSiteGroup ? { site: scopedSiteGroup } : {}),
    ...(scopedFloorFn ? { floor: scopedFloorFn } : {}),
    cutawayWallGroups: scopedCutawayWallGroups,
    addGlowPool: (circuitId, x, y, z, radius, maxOpacity = 0.35, rotX = -Math.PI / 2) => {
      const wx = x * cosR + z * sinR + dx;
      const wy = y + dy;
      const wz = -x * sinR + z * cosR + dz;
      parentCtx.addGlowPool(circuitId, wx, wy, wz, radius, maxOpacity, rotX);
    },
  };
}

/**
 * Top-level visibility layers of a property scene. Each layer is toggled as a
 * whole by the cutaway controller (N-storey floor layers, roof, site and
 * the four camera-facing wall groups).
 */
export interface PropertySceneLayers {
  readonly scene: THREE.Scene;
  readonly firstFloorMeshGroup: THREE.Group;
  readonly groundFloorCeilingGroup: THREE.Group;
  readonly ceilingMeshGroup: THREE.Group;
  readonly roofGroup: THREE.Group;
  readonly siteGroup: THREE.Group;
  readonly cutawayWallGroups: CutawayWallGroups;
  readonly floorLayers: readonly FloorLayerEntry[];
  getFloorLayer(floorId: string): FloorLayerEntry | undefined;
  ensureFloors(floors: readonly FloorDefinition[]): readonly FloorLayerEntry[];
  getFloorIdForGroup(group: THREE.Object3D): string | undefined;
}

export interface RoomSwitchLedBinding {
  readonly circuitId: CircuitId;
  readonly mat: THREE.MeshStandardMaterial;
}

/** Everything produced by building a home's zone modules into the scene layers. */
export interface PropertySceneContent<TSecurity extends SecurityOverlay3D> {
  readonly lightGroups: LightGroupMap;
  readonly glowPoolGeometry: THREE.PlaneGeometry;
  readonly bifoldPanels: readonly BifoldPanelRef[];
  readonly interactiveMeshes: THREE.Object3D[];
  readonly interactions: SceneInteractionManager;
  readonly roomSwitchLedMats: readonly RoomSwitchLedBinding[];
  readonly indicatorMats: ZoneIndicatorMaterials;
  readonly security: TSecurity;
  readonly ufhSystem: UfhSystemOverlay3D | null;
  readonly tvArtTextures: readonly THREE.CanvasTexture[];
  readonly tvOffTexture: THREE.CanvasTexture;
  readonly variations: readonly RoomVariationGroup[];
}

export interface BuildPropertySceneContentOptions<TSecurity extends SecurityOverlay3D> {
  readonly profile: PropertySceneProfile<TSecurity>;
  readonly registry: SceneZoneRegistry;
  readonly lodController: RoomLodController;
  readonly ceilingCutaway: boolean;
}

function normalizeAndSortFloors(
  floors: readonly FloorDefinition[] | undefined
): readonly { readonly id: string; readonly elevationY: number; readonly ceilingHeight: number }[] {
  const src = floors && floors.length > 0 ? floors : DEFAULT_LAYER_FLOORS;
  return [...src]
    .map((f) => {
      const elevationY = f.elevationY ?? f.elevationM ?? 0;
      const ceilingHeight =
        f.ceilingHeight ??
        (f.ceilingCutawayY !== undefined ? Math.max(0.5, f.ceilingCutawayY - elevationY) : 2.5);
      return { id: f.id, elevationY, ceilingHeight };
    })
    .sort((a, b) => a.elevationY - b.elevationY);
}

/**
 * Returns the mounted root groups to pass to `RoomLodController.indexBuiltSceneHierarchy`,
 * preserving exact `[scene, firstFloorMeshGroup]` ordering for 2-storey homes that do not mount
 * extra lazy floor layers.
 */
export function getMountedFloorLodRoots(layers: PropertySceneLayers): THREE.Object3D[] {
  const roots: THREE.Object3D[] = [layers.scene, layers.firstFloorMeshGroup];
  for (const fl of layers.floorLayers) {
    if (
      fl.contentGroup !== layers.firstFloorMeshGroup &&
      fl.contentGroup.parent !== null &&
      !roots.includes(fl.contentGroup)
    ) {
      roots.push(fl.contentGroup);
    }
  }
  return roots;
}

/**
 * Creates the top-level layer groups, tags them as architectural shell and adds
 * the core legacy shell groups to `scene` (first floor, ground ceiling, roof, then SW/W/N/E walls),
 * while lazily mounting any N-storey / site containers onto `scene` only when populated.
 */
export function createPropertySceneLayers(
  scene: THREE.Scene,
  floors?: readonly FloorDefinition[]
): PropertySceneLayers {
  const firstFloorMeshGroup = new THREE.Group();
  const groundFloorCeilingGroup = new THREE.Group();
  const ceilingMeshGroup = new THREE.Group();
  const cutawayWallGroups: CutawayWallGroups = {
    southWest: new THREE.Group(),
    west: new THREE.Group(),
    north: new THREE.Group(),
    east: new THREE.Group(),
  };

  groundFloorCeilingGroup.userData.isArchitecturalShell = true;
  ceilingMeshGroup.userData.isArchitecturalShell = true;
  cutawayWallGroups.southWest.userData.isArchitecturalShell = true;
  cutawayWallGroups.west.userData.isArchitecturalShell = true;
  cutawayWallGroups.north.userData.isArchitecturalShell = true;
  cutawayWallGroups.east.userData.isArchitecturalShell = true;

  scene.add(firstFloorMeshGroup);
  scene.add(groundFloorCeilingGroup);
  scene.add(ceilingMeshGroup);
  scene.add(
    cutawayWallGroups.southWest,
    cutawayWallGroups.west,
    cutawayWallGroups.north,
    cutawayWallGroups.east
  );

  const siteGroup = createLazyMountedGroup(scene, 'site.grounds');

  let floorEntries: FloorLayerEntry[] = [];
  const floorById = new Map<string, FloorLayerEntry>();

  const ensureFloors = (nextFloors: readonly FloorDefinition[]): readonly FloorLayerEntry[] => {
    const normalized = normalizeAndSortFloors(nextFloors);
    if (
      floorEntries.length === normalized.length &&
      floorEntries.every(
        (e, idx) =>
          e.id === normalized[idx]!.id &&
          e.elevationY === normalized[idx]!.elevationY &&
          e.ceilingHeight === normalized[idx]!.ceilingHeight
      )
    ) {
      return floorEntries;
    }

    const prevById = new Map<string, FloorLayerEntry>(floorById);
    const rebuilt: FloorLayerEntry[] = [];
    floorById.clear();

    for (let i = 0; i < normalized.length; i++) {
      const spec = normalized[i]!;
      const prev = prevById.get(spec.id);

      let contentGroup: THREE.Group;
      if (i === 1) {
        contentGroup = firstFloorMeshGroup;
      } else if (
        prev &&
        prev.contentGroup !== firstFloorMeshGroup &&
        prev.contentGroup !== groundFloorCeilingGroup
      ) {
        contentGroup = prev.contentGroup;
      } else {
        contentGroup = createLazyMountedGroup(scene, `floor.${spec.id}.content`, {
          floorId: spec.id,
        });
      }

      const slabGroup =
        prev &&
        prev.slabGroup !== firstFloorMeshGroup &&
        prev.slabGroup !== groundFloorCeilingGroup
          ? prev.slabGroup
          : createLazyMountedGroup(scene, `floor.${spec.id}.slab`, {
              isArchitecturalShell: true,
              floorId: spec.id,
            });

      let ceilingGroup: THREE.Group;
      if (i === 0) {
        ceilingGroup = groundFloorCeilingGroup;
      } else if (
        prev &&
        prev.ceilingGroup !== groundFloorCeilingGroup &&
        prev.ceilingGroup !== firstFloorMeshGroup
      ) {
        ceilingGroup = prev.ceilingGroup;
      } else {
        ceilingGroup = createLazyMountedGroup(scene, `floor.${spec.id}.ceiling`, {
          isArchitecturalShell: true,
          floorId: spec.id,
        });
      }

      groupFloorMap.set(contentGroup, spec.id);
      groupFloorMap.set(slabGroup, spec.id);
      groupFloorMap.set(ceilingGroup, spec.id);

      const entry: FloorLayerEntry = {
        id: spec.id,
        elevationY: spec.elevationY,
        ceilingHeight: spec.ceilingHeight,
        contentGroup,
        slabGroup,
        ceilingGroup,
      };
      rebuilt.push(entry);
      floorById.set(spec.id, entry);
    }

    if (normalized.length < 2) {
      groupFloorMap.delete(firstFloorMeshGroup);
    }

    floorEntries = rebuilt;
    return floorEntries;
  };

  ensureFloors(floors ?? DEFAULT_LAYER_FLOORS);

  return {
    scene,
    firstFloorMeshGroup,
    groundFloorCeilingGroup,
    ceilingMeshGroup,
    roofGroup: ceilingMeshGroup,
    siteGroup,
    cutawayWallGroups,
    get floorLayers(): readonly FloorLayerEntry[] {
      return floorEntries;
    },
    getFloorLayer: (floorId: string) => floorById.get(floorId),
    ensureFloors,
    getFloorIdForGroup: (group: THREE.Object3D) => groupFloorMap.get(group),
  };
}

function createLightGroups(maxIntensities: Readonly<Record<CircuitId, number>>): LightGroupMap {
  const groups: Partial<Record<CircuitId, LightCircuitGroup>> = {};
  for (const [circuitId, maxIntensity] of Object.entries(maxIntensities) as Array<
    [CircuitId, number]
  >) {
    groups[circuitId] = { lights: [], emissives: [], cones: [], pools: [], maxIntensity };
  }
  return groups as LightGroupMap;
}

/**
 * Builds every registered zone module (and the security overlay) into `layers`
 * and indexes the result for room LOD.
 *
 * This is the single code path used both by the runtime `PropertyScene` and by
 * the headless snapshot harness (`tools/snapshot`), so the snapshot exercises
 * exactly what ships.
 */

interface ResolvedRoomMetadata {
  readonly zoneId: string;
  readonly label?: string;
  readonly finishes?: RoomFinishSpec;
  readonly notes?: readonly string[];
  readonly center?: readonly [number, number, number];
}

function collectRoomMetadataMap(
  lodRegistrations: readonly RoomZoneLodRegistration[],
  roomManifest?: readonly RoomManifestEntry[]
): Map<string, ResolvedRoomMetadata> {
  const byZone = new Map<string, ResolvedRoomMetadata>();

  for (const reg of lodRegistrations) {
    const center: readonly [number, number, number] = [
      (reg.bounds.minX + reg.bounds.maxX) * 0.5,
      (reg.bounds.minY + reg.bounds.maxY) * 0.5,
      (reg.bounds.minZ + reg.bounds.maxZ) * 0.5,
    ];
    if (reg.finishes || (reg.notes && reg.notes.length > 0)) {
      byZone.set(reg.zoneId, {
        zoneId: reg.zoneId,
        ...(reg.finishes ? { finishes: reg.finishes } : {}),
        ...(reg.notes && reg.notes.length > 0 ? { notes: reg.notes } : {}),
        center,
      });
    } else {
      byZone.set(reg.zoneId, { zoneId: reg.zoneId, center });
    }
  }

  if (roomManifest) {
    for (const entry of roomManifest) {
      const prev = byZone.get(entry.zoneId);
      const finishes = entry.finishes ?? prev?.finishes;
      const mergedNotes = [
        ...(entry.finishes?.notes ?? []),
        ...(entry.notes ?? []),
        ...(prev?.notes ?? []),
      ];
      const dedupedNotes = Array.from(new Set(mergedNotes.map((n) => n.trim()).filter(Boolean)));
      byZone.set(entry.zoneId, {
        zoneId: entry.zoneId,
        label: entry.label,
        ...(finishes ? { finishes } : {}),
        ...(dedupedNotes.length > 0 ? { notes: dedupedNotes } : {}),
        ...(prev?.center ? { center: prev.center } : {}),
      });
    }
  }

  for (const [key, val] of byZone.entries()) {
    if (!val.finishes && (!val.notes || val.notes.length === 0)) {
      byZone.delete(key);
    }
  }
  return byZone;
}

function resolveExplicitGroupZoneId(obj: THREE.Object3D, knownZones: ReadonlySet<string>): string | undefined {
  if (!(obj instanceof THREE.Group)) return undefined;
  const udZone = obj.userData?.zoneId ?? obj.userData?.zone;
  if (typeof udZone === 'string' && knownZones.has(udZone)) {
    return udZone;
  }
  if (typeof obj.name === 'string' && obj.name.length > 0) {
    if (knownZones.has(obj.name)) return obj.name;
    if (obj.name.startsWith('room.')) {
      const stripped = obj.name.slice(5);
      if (knownZones.has(stripped)) return stripped;
    }
  }
  return undefined;
}

function stampRoomFinishMetadata(
  scene: THREE.Scene,
  lodController: RoomLodController,
  lodRegistrations: readonly RoomZoneLodRegistration[],
  roomManifest?: readonly RoomManifestEntry[]
): void {
  const metaByZone = collectRoomMetadataMap(lodRegistrations, roomManifest);
  if (metaByZone.size === 0) return;

  const knownZones = new Set<string>(metaByZone.keys());
  const sceneFinishesRecord: Record<string, RoomFinishSpec> = {};
  for (const [zoneId, meta] of metaByZone.entries()) {
    if (meta.finishes) {
      sceneFinishesRecord[zoneId] = meta.finishes;
    }
    const lodGroups = lodController.getRoomGroups(zoneId);
    if (lodGroups) {
      if (meta.finishes) lodGroups.shellGroup.userData.roomFinishes = meta.finishes;
      if (meta.notes && meta.notes.length > 0) lodGroups.shellGroup.userData.roomNotes = meta.notes;
    }
  }
  if (Object.keys(sceneFinishesRecord).length > 0) {
    scene.userData.roomFinishes = sceneFinishesRecord;
  }

  const stampedZones = new Set<string>();
  const walkAndStampTopLevelRoomGroups = (node: THREE.Object3D, inheritedZone?: string): void => {
    if (node.userData?.isRoomMetadataRoot) return;
    const matchedZone = resolveExplicitGroupZoneId(node, knownZones);
    if (matchedZone && matchedZone !== inheritedZone) {
      const meta = metaByZone.get(matchedZone);
      if (meta) {
        if (meta.finishes) node.userData.roomFinishes = meta.finishes;
        if (meta.notes && meta.notes.length > 0) node.userData.roomNotes = meta.notes;
        stampedZones.add(matchedZone);
      }
    }
    const nextInherited = matchedZone ?? inheritedZone;
    for (const child of node.children) {
      walkAndStampTopLevelRoomGroups(child, nextInherited);
    }
  };
  walkAndStampTopLevelRoomGroups(scene);

  // Ensure every room with finishes/notes also has a dedicated 3D room root anchor in the scene
  // so runtime scene traversal and .glb export carry per-room node metadata even for open-plan zones.
  const metadataRoot = new THREE.Group();
  metadataRoot.name = 'husjs.roomMetadata';
  metadataRoot.userData = {
    lodIgnore: true,
    isRoomMetadataRoot: true,
  };
  for (const [zoneId, meta] of metaByZone.entries()) {
    if (scene.getObjectByName(`room.${zoneId}`)) continue;
    const roomAnchor = new THREE.Group();
    roomAnchor.name = `room.${zoneId}`;
    if (meta.center) {
      roomAnchor.position.set(meta.center[0], meta.center[1], meta.center[2]);
    }
    roomAnchor.userData = {
      zoneId,
      ...(meta.label ? { roomLabel: meta.label } : {}),
      ...(meta.finishes ? { roomFinishes: meta.finishes } : {}),
      ...(meta.notes && meta.notes.length > 0 ? { roomNotes: meta.notes } : {}),
      lodIgnore: true,
    };
    metadataRoot.add(roomAnchor);
  }
  if (metadataRoot.children.length > 0) {
    scene.add(metadataRoot);
  }
}

export function buildPropertySceneContent<TSecurity extends SecurityOverlay3D>(
  layers: PropertySceneLayers,
  options: BuildPropertySceneContentOptions<TSecurity>
): PropertySceneContent<TSecurity> {
  if (options.profile.floors && options.profile.floors.length > 0) {
    layers.ensureFloors(options.profile.floors);
  }
  setRoomZoneRegistrations(options.profile.lodRegistrations);
  const { scene } = layers;
  bindPropertySceneProfile(scene, options.profile);

  if (
    options.registry.getInteriorBounds().length === 0 &&
    options.profile.lodRegistrations.length > 0
  ) {
    options.registry.addInteriorBounds(
      options.profile.lodRegistrations
        .filter((r) => r.isInterior !== false)
        .map((r) => r.bounds)
    );
  }
  options.registry.ensureTopCameraPreset(
    options.profile.floors,
    options.profile.lodRegistrations.map((r) => r.bounds)
  );

  const radialGlowTex = createRadialGlowTexture();
  const glowPoolGeometry = new THREE.PlaneGeometry(1, 1);
  const lightGroups = createLightGroups(options.profile.circuitMaxIntensity);

  const bifoldPanels: BifoldPanelRef[] = [];
  const interactiveMeshes: THREE.Object3D[] = [];
  const interactions = new SceneInteractionManager(interactiveMeshes);
  if (options.profile.doorPolicy) interactions.setDoorPolicy(options.profile.doorPolicy);
  const roomSwitchLedMats: RoomSwitchLedBinding[] = [];
  const variationRegistry = new VariationRegistry();

  const floorScopeCache = new Map<string, FloorBuilderScope>();
  const resolveFloorScope = (floorId: string): FloorBuilderScope => {
    const cached = floorScopeCache.get(floorId);
    if (cached) return cached;
    const entry = layers.getFloorLayer(floorId);
    if (!entry) {
      const validIds = layers.floorLayers.map((f) => f.id).join(', ');
      throw new Error(
        `Unknown floorId "${floorId}" in ctx.floor(). Valid floor IDs: [${validIds}]`
      );
    }
    const scope: FloorBuilderScope = {
      id: entry.id,
      elevationY: entry.elevationY,
      ceilingHeight: entry.ceilingHeight,
      group: entry.contentGroup,
      slabGroup: entry.slabGroup,
      ceilingGroup: entry.ceilingGroup,
      add: (...objects: THREE.Object3D[]) => {
        entry.contentGroup.add(...objects);
      },
    };
    floorScopeCache.set(floorId, scope);
    return scope;
  };

  const ctx: SceneBuilderContext = {
    scene,
    firstFloorMeshGroup: layers.firstFloorMeshGroup,
    groundFloorCeilingGroup: layers.groundFloorCeilingGroup,
    ceilingMeshGroup: layers.ceilingMeshGroup,
    roof: layers.roofGroup,
    site: layers.siteGroup,
    floor: resolveFloorScope,
    ceilingCutaway: options.ceilingCutaway,
    cutawayWallGroups: layers.cutawayWallGroups,
    bifoldPanels,
    interactiveMeshes,
    interactions,
    lightGroups,
    variations: variationRegistry,
    registerVariation: (group) => variationRegistry.register(group),
    addGlowPool: (circuitId, x, y, z, radius, maxOpacity = 0.35, rotX = -Math.PI / 2) => {
      const mat = new THREE.MeshBasicMaterial({
        map: radialGlowTex,
        transparent: true,
        opacity: maxOpacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(glowPoolGeometry, mat);
      mesh.userData.isLightGlowPool = true;
      mesh.position.set(x, y, z);
      mesh.scale.set(radius * 2, radius * 2, 1);
      mesh.rotation.x = rotX;
      const floorLayers = layers.floorLayers;
      let targetFloorIdx = 0;
      for (let i = 1; i < floorLayers.length; i++) {
        if (y >= floorLayers[i]!.elevationY - 0.3) {
          targetFloorIdx = i;
        }
      }
      if (targetFloorIdx >= 1) {
        floorLayers[targetFloorIdx]!.contentGroup.add(mesh);
      } else if (floorLayers[0] && floorLayers[0].contentGroup.parent !== null) {
        floorLayers[0].contentGroup.add(mesh);
      } else {
        scene.add(mesh);
      }
      lightGroups[circuitId].pools.push({ mat, maxOpacity });
    },
    registerSwitchLedMaterial: (circuitId, mat) => {
      roomSwitchLedMats.push({ circuitId, mat });
    },
  };

  const tvArtTextures = createTVArtGalleryTextures();
  const tvOffTexture = createTVOffTexture();

  // Build all registered 3D zone modules across the property (main house, annex & grounds).
  const indicatorMats = options.registry.buildAllZones(ctx);
  const security = options.profile.buildSecurityOverlay(ctx);
  const ufhSystem = options.profile.buildUfhOverlay?.(ctx) ?? null;
  if (options.profile.variations) {
    const extraVars = typeof options.profile.variations === 'function' ? options.profile.variations(ctx) : options.profile.variations;
    variationRegistry.registerAll(extraVars);
  }
  bindSmartAssetsInScene(scene, interactions);

  // Stamp per-room finish swatches & architectural notes onto 3D room roots.
  stampRoomFinishMetadata(
    scene,
    options.lodController,
    options.profile.lodRegistrations,
    options.profile.roomManifest
  );

  // Index all room furniture (LOD1) and fine hero props (LOD2) across all storeys.
  options.lodController.configure(options.profile.lodOptions);
  options.lodController.indexBuiltSceneHierarchy(getMountedFloorLodRoots(layers));

  return {
    lightGroups,
    glowPoolGeometry,
    bifoldPanels,
    interactiveMeshes,
    interactions,
    roomSwitchLedMats,
    indicatorMats,
    security,
    ufhSystem,
    tvArtTextures,
    tvOffTexture,
    variations: variationRegistry.getGroups(),
  };
}
