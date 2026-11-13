import * as THREE from 'three';
import { getFloorIdForSceneGroup } from '../viewer/scene-content.ts';
import { getStaircaseWalkableSampler } from '../walkthrough/auto-elevation-composer.ts';
import type { FloorViewMode } from '../../core/types/scene.ts';
import type { FloorId, RoomBoundingBox, RoomZoneId } from '../../core/types/topology.ts';
import type {
  LodPolicyMode,
  RoomLodDiagnostics,
  RoomLodOptions,
  RoomLodStateSnapshot,
  RoomLodTier,
  RoomZoneLodRegistration,
} from '../../core/entities.ts';
import type { PortalVisibilitySolver } from './portal-visibility-solver.ts';

interface ManagedLodObject {
  readonly object: THREE.Object3D;
  readonly tier: 1 | 2;
}

interface RuntimeDistanceLodItem {
  readonly object: THREE.Object3D;
  readonly centerX: number;
  readonly centerY: number;
  readonly centerZ: number;
  readonly maxDistanceM: number;
  readonly isInterior: boolean;
  visible: boolean;
}

interface ManagedRoomLodEntry {
  readonly zoneId: RoomZoneId;
  readonly shortName: string;
  readonly floorId: FloorId;
  readonly isInterior: boolean;
  readonly linkedOpenPlanZones?: readonly RoomZoneId[];
  readonly crossFloorVisibleOn?: readonly string[];
  readonly excludedCutout?: (x: number, z: number) => boolean;
  readonly lodNameMatcher?: (name: string) => boolean;
  readonly bounds: RoomBoundingBox;
  readonly center: THREE.Vector3;
  readonly shellGroup: THREE.Group;
  readonly standardGroup: THREE.Group;
  readonly heroGroup: THREE.Group;
  readonly managedObjects: ManagedLodObject[];
  currentTier: RoomLodTier;
  unoccludedTier: RoomLodTier;
  portalOccluded: boolean;
  lastDistanceM: number;
}

export interface RoomLodGroups {
  readonly shellGroup: THREE.Group;
  readonly standardGroup: THREE.Group;
  readonly heroGroup: THREE.Group;
}

export interface LodEvaluationOptions {
  readonly camera?: THREE.Camera;
  readonly isWalkthrough?: boolean;
  readonly roofCutawayOpen?: boolean;
  readonly zoomedOutClosedShell?: boolean;
}

/**
 * Semantic Room Level-of-Detail (LOD) Controller.
 *
 * Manages per-room detail tiers across the entire property:
 * - `LOD0` (Shell): Architectural shell only (walls, windows, doors, slabs, switches).
 * - `LOD1` (Standard): Primary furniture, cabinetry carcasses, appliances & light fixtures.
 * - `LOD2` (Hero): High-detail interior props (cabinet interior crockery, books, tableware,
 *   logs, small decor) and full per-room lighting detail.
 */
export class RoomLodController {
  private static readonly AUTO_HERO_RADIUS_M = 14.0;
  private static readonly HERO_PROP_MAX_DIM_M = 0.34;
  private static readonly SHELL_STRUCTURAL_MIN_DIM_M = 1.95;

  private readonly rooms = new Map<RoomZoneId, ManagedRoomLodEntry>();
  private readonly runtimeDistanceItems: RuntimeDistanceLodItem[] = [];
  private policyMode: LodPolicyMode = 'auto';
  private focusedZoneId: RoomZoneId | null = null;
  private containerNamePattern: RegExp | null = null;
  private exteriorGroupPattern: RegExp | null = null;
  private portalSolver: PortalVisibilitySolver | null = null;
  private lastEvalShadowsDirty = false;
  /** Perf-governor multiplier applied to every distance threshold (hero radius + runtime items). */
  private distanceScale = 1.0;
  /** Base radius (m) inside which rooms get LOD2 Hero detail in `auto` mode. */
  private highDetailMaxDistanceM = RoomLodController.AUTO_HERO_RADIUS_M;
  private onLodChangeCallback?: (diagnostics: RoomLodDiagnostics) => void;

  public constructor(
    registrations: readonly RoomZoneLodRegistration[] = [],
    options?: RoomLodOptions
  ) {
    for (const reg of registrations) {
      this.registerRoom(reg);
    }
    this.focusedZoneId =
      registrations.find((r) => r.isInterior !== false)?.zoneId ?? registrations[0]?.zoneId ?? null;
    this.configure(options);
  }

  /** Applies a home's scene-graph naming rules. Must run before `indexBuiltSceneHierarchy`. */
  public configure(options: RoomLodOptions | undefined): void {
    if (!options) return;
    if (options.containerNamePattern) this.containerNamePattern = options.containerNamePattern;
    if (options.exteriorGroupPattern) this.exteriorGroupPattern = options.exteriorGroupPattern;
  }

  public isExteriorZone(zoneId: RoomZoneId): boolean {
    return this.rooms.get(zoneId)?.isInterior === false;
  }

  public setPortalVisibilitySolver(solver: PortalVisibilitySolver | null): void {
    this.portalSolver = solver;
  }

  public getPortalVisibilitySolver(): PortalVisibilitySolver | null {
    return this.portalSolver;
  }

  /**
   * Yields every primary `LOD1` shadow-casting group/object currently hidden solely by
   * `PortalVisibilitySolver`, so `CutawayController`'s shadow-pass bracket hooks can
   * keep sun shadows 100% invariant across all camera positions without rebuilding shadow maps.
   */
  public forEachPortalCulledObject(fn: (obj: THREE.Object3D) => void): void {
    for (const room of this.rooms.values()) {
      if (!room.portalOccluded) continue;
      fn(room.standardGroup);
      for (let i = 0; i < room.managedObjects.length; i++) {
        const item = room.managedObjects[i]!;
        if (item.tier === 1) {
          fn(item.object);
        }
      }
    }
  }

  public registerRoom(reg: RoomZoneLodRegistration): RoomLodGroups {
    const existing = this.rooms.get(reg.zoneId);
    if (existing) {
      return {
        shellGroup: existing.shellGroup,
        standardGroup: existing.standardGroup,
        heroGroup: existing.heroGroup,
      };
    }

    const center = new THREE.Vector3(
      (reg.bounds.minX + reg.bounds.maxX) * 0.5,
      (reg.bounds.minY + reg.bounds.maxY) * 0.5,
      (reg.bounds.minZ + reg.bounds.maxZ) * 0.5
    );

    const shellGroup = new THREE.Group();
    shellGroup.name = `room-lod0-shell-${reg.zoneId}`;

    const standardGroup = new THREE.Group();
    standardGroup.name = `room-lod1-standard-${reg.zoneId}`;

    const heroGroup = new THREE.Group();
    heroGroup.name = `room-lod2-hero-${reg.zoneId}`;

    const entry: ManagedRoomLodEntry = {
      zoneId: reg.zoneId,
      shortName: reg.shortName,
      floorId: reg.floorId,
      isInterior: reg.isInterior !== false,
      linkedOpenPlanZones: reg.linkedOpenPlanZones,
      crossFloorVisibleOn: reg.crossFloorVisibleOn,
      excludedCutout: reg.excludedCutout,
      lodNameMatcher: reg.lodNameMatcher,
      bounds: reg.bounds,
      center,
      shellGroup,
      standardGroup,
      heroGroup,
      managedObjects: [],
      currentTier: 2,
      unoccludedTier: 2,
      portalOccluded: false,
      lastDistanceM: 0,
    };

    this.rooms.set(reg.zoneId, entry);
    return { shellGroup, standardGroup, heroGroup };
  }

  public setOnLodChanged(cb: (diagnostics: RoomLodDiagnostics) => void): void {
    this.onLodChangeCallback = cb;
  }

  public getRoomGroups(zoneId: RoomZoneId): RoomLodGroups | undefined {
    const entry = this.rooms.get(zoneId);
    if (!entry) return undefined;
    return {
      shellGroup: entry.shellGroup,
      standardGroup: entry.standardGroup,
      heroGroup: entry.heroGroup,
    };
  }

  public registerObjectWithTier(
    zoneId: RoomZoneId,
    object: THREE.Object3D,
    tier: 1 | 2
  ): void {
    const room = this.rooms.get(zoneId);
    if (!room) return;
    object.userData = { ...object.userData, lodTier: tier, zoneId };
    object.visible = room.currentTier >= tier;
    room.managedObjects.push({ object, tier });
    if (tier === 2) {
      RoomLodController.disableShadowCasting(object);
    }
  }

  /**
   * Registers a distance-culled micro-detail object. Distance culling never changes the set of
   * shadow casters: the object is made permanently non-shadow-casting (these are small props),
   * so the `_castsShadow` argument is ignored and kept only for call-site compatibility.
   */
  public registerRuntimeDistanceObject(
    object: THREE.Object3D,
    centerX: number,
    centerY: number,
    centerZ: number,
    maxDistanceM: number,
    _castsShadow = false,
    isInterior = false
  ): void {
    RoomLodController.disableShadowCasting(object);
    this.runtimeDistanceItems.push({
      object,
      centerX,
      centerY,
      centerZ,
      maxDistanceM,
      isInterior,
      visible: object.visible,
    });
  }

  /**
   * High-detail (LOD2 / distance-culled) props are fixed as non-shadow-casting at load so LOD
   * switching driven by the camera can never add or remove sun/point-light shadow casters.
   */
  private static disableShadowCasting(object: THREE.Object3D): void {
    object.traverse((node) => {
      if (node instanceof THREE.Mesh && node.castShadow) {
        node.castShadow = false;
      }
    });
  }

  /**
   * Perf-governor hook: scales every LOD distance threshold (hero radius and runtime
   * distance-culled items). `1` = default; `<1` hides detail sooner. Takes effect on the next
   * `evaluateLod`. Never affects lighting or shadow casters.
   */
  public setDistanceScale(scale: number): void {
    this.distanceScale = Number.isFinite(scale) && scale > 0 ? scale : 1.0;
  }

  public getDistanceScale(): number {
    return this.distanceScale;
  }

  /** Perf-governor hook: base radius (m, before `distanceScale`) for LOD2 Hero rooms in `auto` mode. */
  public setHighDetailMaxDistance(m: number): void {
    this.highDetailMaxDistanceM =
      Number.isFinite(m) && m >= 0 ? m : RoomLodController.AUTO_HERO_RADIUS_M;
  }

  public getHighDetailMaxDistance(): number {
    return this.highDetailMaxDistanceM;
  }

  /** World-space centre of a registered room (used e.g. as the point-light budget anchor). */
  public getRoomCenter(zoneId: RoomZoneId): THREE.Vector3 | undefined {
    return this.rooms.get(zoneId)?.center;
  }

  /** Floor id of a registered room zone, if known. */
  public getRoomFloorId(zoneId: RoomZoneId): FloorId | undefined {
    return this.rooms.get(zoneId)?.floorId;
  }

  public clearRuntimeDistanceObjects(): void {
    for (let i = 0; i < this.runtimeDistanceItems.length; i++) {
      const item = this.runtimeDistanceItems[i]!;
      item.object.visible = true;
      item.visible = true;
    }
    this.runtimeDistanceItems.length = 0;
  }

  public removeBatchedObjects(objectsToRemove?: ReadonlySet<THREE.Object3D>): void {
    for (const room of this.rooms.values()) {
      for (let i = room.managedObjects.length - 1; i >= 0; i--) {
        const obj = room.managedObjects[i]!.object;
        const shouldRemove =
          objectsToRemove !== undefined
            ? objectsToRemove.has(obj)
            : Boolean(obj.userData?.isBatchedStaticMesh);
        if (shouldRemove) {
          room.managedObjects.splice(i, 1);
        }
      }
    }
  }

  public didLastEvalChangeShadows(): boolean {
    return this.lastEvalShadowsDirty;
  }

  /**
   * Scans built scene root groups and binds interior furniture (`LOD1`) and fine props (`LOD2`)
   * to their enclosing `RoomZoneId` so every room supports dynamic `LOD0` / `LOD1` / `LOD2` switching.
   */
  public indexBuiltSceneHierarchy(roots: readonly THREE.Object3D[], options?: { readonly deepBatchClassification?: boolean }): void {
    const deep = Boolean(options?.deepBatchClassification);
    for (const room of this.rooms.values()) {
      for (const item of room.managedObjects) {
        item.object.visible = true;
      }
      room.shellGroup.visible = true;
      room.standardGroup.visible = true;
      room.heroGroup.visible = true;
      room.currentTier = 2;
      room.unoccludedTier = 2;
      room.portalOccluded = false;
      room.managedObjects.length = 0;
    }

    const rootSet = new Set<THREE.Object3D>(roots);
    const box = new THREE.Box3();
    for (const room of this.rooms.values()) {
      RoomLodController.disableShadowCasting(room.heroGroup);
    }
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();

    for (const root of roots) {
      root.updateMatrixWorld(true);
      const mappedRootFloor = getFloorIdForSceneGroup(root);
      const floorFilter: FloorId | undefined =
        typeof root.userData?.floorId === 'string'
          ? (root.userData.floorId as FloorId)
          : root.name === 'firstFloorMeshGroup'
            ? 'first'
            : mappedRootFloor !== undefined && mappedRootFloor !== 'first'
              ? mappedRootFloor
              : undefined;
      for (const child of root.children) {
        if (rootSet.has(child)) continue;
        if (child instanceof THREE.Group && typeof child.userData?.floorId === 'string') {
          if (child.userData?.isArchitecturalShell || !child.visible) continue;
          const childFloor = child.userData.floorId as FloorId;
          for (const sub of child.children) {
            if (rootSet.has(sub)) continue;
            this.classifySceneBranch(sub, box, size, center, childFloor, deep);
          }
          continue;
        }
        this.classifySceneBranch(child, box, size, center, floorFilter, deep);
      }
    }
  }

  private classifySceneBranch(
    obj: THREE.Object3D,
    box: THREE.Box3,
    size: THREE.Vector3,
    center: THREE.Vector3,
    floorFilter?: FloorId,
    deep = false
  ): void {
    // Skip lights, cameras, and helper planes, as well as state-toggled hidden subtrees (e.g. extended dining table seats)
    if (obj instanceof THREE.Light || obj instanceof THREE.Camera || !obj.visible || obj.userData?.lodIgnore) {
      return;
    }

    // Transparently unwrap hierarchical Wing / Room / Wall-Frame container groups
    // so their child meshes and furniture groups are classified identically to top-level scene children.
    if (obj.userData?.isRoomContainer) {
      for (const sub of obj.children) {
        this.classifySceneBranch(sub, box, size, center, floorFilter, deep);
      }
      return;
    }

    // Never classify dynamic cutaway wall segments, architectural shell groups, windows, doors, floors, skirtings, or stairs as LOD1/LOD2 furniture
    const isStructuralShellName =
      typeof obj.name === 'string' &&
      /floor|stairs|architrave|doorwaycasing|skirting|chimneybreast|gable|skeiling|collar/i.test(
        obj.name
      ) &&
      (!deep || !/turfmat|foldingfloor/i.test(obj.name));
    const isCrossFloorStair =
      getStaircaseWalkableSampler(obj) !== undefined ||
      Boolean(obj.userData?.crossFloorStair) ||
      Array.isArray(obj.userData?.visibleOnFloors);
    if (
      obj.userData?.isCutawayWall ||
      obj.userData?.isArchitecturalShell ||
      isCrossFloorStair ||
      isStructuralShellName
    ) {
      return;
    }

    if (!deep && this.containsCriticalInteractive(obj, false)) {
      return;
    }

    const rawTier = obj.userData?.lodTier;
    const explicitTier: RoomLodTier | undefined =
      typeof rawTier === 'number' ? (rawTier as RoomLodTier) : undefined;
    const explicitZone = ((obj.userData?.zoneId ?? obj.userData?.zone) as
      | RoomZoneId
      | undefined) ?? (deep ? this.inferZoneFromName(obj.name) : undefined);

    if (explicitTier !== undefined && explicitZone !== undefined) {
      if ((!deep || !this.containsCriticalInteractive(obj, true)) && (explicitTier === 1 || explicitTier === 2)) {
        const room = this.rooms.get(explicitZone);
        if (room) {
          if (deep) obj.visible = room.currentTier >= explicitTier;
          room.managedObjects.push({ object: obj, tier: explicitTier });
          if (explicitTier === 2) {
            RoomLodController.disableShadowCasting(obj);
          }
        }
      }
      return;
    }

    box.setFromObject(obj);
    if (box.isEmpty()) return;

    box.getSize(size);
    box.getCenter(center);

    const maxDim = Math.max(size.x, size.y, size.z);
    const minHorizontalDim = Math.min(size.x, size.z);
    const isArchitecturalSubstructureName =
      typeof obj.name === 'string' &&
      /wall|ceiling|roof|window|sill|lintel|beam|joist|rafter|purlin|truss|brick|plaster|cladding|fascia|soffit|gutter|downpipe|casement|glazing|mullion|frame|threshold|plinth|doorheader/i.test(
        obj.name
      ) &&
      !/sideboard|wardrobe|cabinet|cupboard|bookcase|shelf|shelving|sofa|bed|table|island|piano|roland|golf|pooltable|stove|radiator|curtain|rug|tv|mirror|picture|art|lamp|chandelier|pendant/i.test(
        obj.name
      );

    if (deep) {
      const isMultiItemWingOrRoomContainer =
        obj instanceof THREE.Group &&
        obj.children.length > 1 &&
        maxDim < 75.0 &&
        !this.exteriorGroupPattern?.test(obj.name) &&
        (maxDim >= 5.4 ||
          this.containsCriticalInteractive(obj, true) ||
          Boolean(this.containerNamePattern?.test(obj.name)));

      if (
        isMultiItemWingOrRoomContainer &&
        !(explicitZone && !this.isExteriorZone(explicitZone) && maxDim < 6.0 && !this.containsCriticalInteractive(obj, true))
      ) {
        for (const sub of obj.children) {
          this.classifySceneBranch(sub, box, size, center, floorFilter, deep);
        }
        return;
      }

      if (this.containsCriticalInteractive(obj, true)) {
        return;
      }

      if (isArchitecturalSubstructureName) {
        return;
      }

      if (explicitZone && !this.isExteriorZone(explicitZone) && maxDim < 6.5) {
        const room = this.rooms.get(explicitZone);
        if (room) {
          const tier: 1 | 2 =
            maxDim <= RoomLodController.HERO_PROP_MAX_DIM_M ? 2 : 1;
          obj.userData = { ...obj.userData, lodTier: tier, zoneId: room.zoneId };
          room.managedObjects.push({ object: obj, tier });
          if (tier === 2) {
            RoomLodController.disableShadowCasting(obj);
          }
          return;
        }
      }

      const isNamedInteriorFurnitureGroup =
        obj instanceof THREE.Group &&
        obj.name.length > 0 &&
        !isArchitecturalSubstructureName &&
        maxDim < 5.4;

      if (!isNamedInteriorFurnitureGroup && maxDim >= RoomLodController.SHELL_STRUCTURAL_MIN_DIM_M) {
        return;
      }
    } else {
      if (
        isArchitecturalSubstructureName &&
        !(obj instanceof THREE.Group && obj.children.length > 1 && maxDim >= RoomLodController.SHELL_STRUCTURAL_MIN_DIM_M)
      ) {
        return;
      }

      if (explicitZone && !this.isExteriorZone(explicitZone) && maxDim < 6.0) {
        const room = this.rooms.get(explicitZone);
        if (room) {
          const tier: 1 | 2 =
            maxDim <= RoomLodController.HERO_PROP_MAX_DIM_M ? 2 : 1;
          obj.userData = { ...obj.userData, lodTier: tier, zoneId: room.zoneId };
          room.managedObjects.push({ object: obj, tier });
          if (tier === 2) {
            RoomLodController.disableShadowCasting(obj);
          }
          return;
        }
      }

      if (maxDim >= RoomLodController.SHELL_STRUCTURAL_MIN_DIM_M) {
        if (obj instanceof THREE.Group && obj.children.length > 1 && maxDim < 18.0) {
          for (const sub of obj.children) {
            this.classifySceneBranch(sub, box, size, center, floorFilter, false);
          }
        }
        return;
      }
    }

    // Thin vertical wall/window panels on the perimeter stay in LOD0 Shell
    if (size.y >= 1.8 && minHorizontalDim <= 0.28) {
      return;
    }

    // Named furniture/radiator groups can sit flush against interior walls (-0.15m inset),
    // while unnamed meshes require a +0.05m inset so exterior window/wall details stay in LOD0.
    const isNamedGroup = obj instanceof THREE.Group && obj.name.length > 0;
    const room = this.findContainingRoom(
      center.x,
      center.y,
      center.z,
      isNamedGroup ? -0.15 : 0.05,
      floorFilter
    );
    if (!room) return;

    const tier: 1 | 2 =
      maxDim <= RoomLodController.HERO_PROP_MAX_DIM_M ? 2 : 1;

    obj.userData = { ...obj.userData, lodTier: tier, zoneId: room.zoneId };
    room.managedObjects.push({ object: obj, tier });
    if (tier === 2) {
      RoomLodController.disableShadowCasting(obj);
    }
  }

  private containsCriticalInteractive(obj: THREE.Object3D, deep: boolean): boolean {
    let found = false;
    obj.traverse((node) => {
      if (found) return;
      const u = node.userData;
      if (deep) {
        if (
          u?.isArchitecturalShell ||
          u?.isCutawayWall ||
          u?.isCourtyardSwitch ||
          u?.isBifoldDoor ||
          u?.isCarGate ||
          u?.isUniFiCamera ||
          u?.isUniFiAccessReader ||
          u?.isFittingFx ||
          u?.isLightGlowPool ||
          (typeof u?.interactableId === 'string' &&
            /frontdoor|stabledoor|frenchdoor|garagedoor|courtyard|extdoor/i.test(
              `${u.interactableId}|${node.name}`
            ))
        ) {
          found = true;
        }
      } else if (
        typeof u?.interactableId === 'string' ||
        u?.isArchitecturalShell ||
        u?.isCutawayWall ||
        u?.isKNXSwitch ||
        u?.switchPa ||
        u?.isKnxTempSensor ||
        u?.isCourtyardSwitch ||
        u?.isUtilitySwitch ||
        u?.isKitchenMotionSensor ||
        u?.isUtilityMotionSensor ||
        u?.roomMotionSensorId ||
        u?.isBifoldDoor ||
        u?.isCarGate ||
        u?.isUniFiCamera ||
        u?.isUniFiAccessReader ||
        u?.circuitId !== undefined ||
        u?.isFittingFx ||
        u?.isLightGlowPool
      ) {
        found = true;
      }
    });
    return found;
  }

  /**
   * Resolves the room a named scene object belongs to: the first registered room whose
   * `lodNameMatcher` accepts the name, else a room without a matcher whose `zoneId` equals the
   * name's first dot-separated segment (`<zoneId>.<part>`).
   */
  public inferZoneFromName(name: string | undefined): RoomZoneId | undefined {
    if (!name) return undefined;
    for (const room of this.rooms.values()) {
      if (room.lodNameMatcher?.(name)) return room.zoneId;
    }
    const dot = name.indexOf('.');
    if (dot <= 0) return undefined;
    const prefixRoom = this.rooms.get(name.slice(0, dot));
    return prefixRoom && !prefixRoom.lodNameMatcher ? prefixRoom.zoneId : undefined;
  }

  private findContainingRoom(
    x: number,
    y: number,
    z: number,
    horizontalInsetM = -0.15,
    floorFilter?: FloorId
  ): ManagedRoomLodEntry | undefined {
    for (const room of this.rooms.values()) {
      if (!room.isInterior) continue;
      if (floorFilter && room.floorId !== floorFilter) continue;
      if (room.excludedCutout?.(x, z)) continue;
      const b = room.bounds;
      const maxYLimit = room.floorId === 'ground' ? b.maxY : b.maxY + 0.1;
      if (
        x >= b.minX + horizontalInsetM &&
        x <= b.maxX - horizontalInsetM &&
        y >= b.minY - 0.1 &&
        y <= maxYLimit &&
        z >= b.minZ + horizontalInsetM &&
        z <= b.maxZ - horizontalInsetM
      ) {
        return room;
      }
    }
    return undefined;
  }

  public getPolicyMode(): LodPolicyMode {
    return this.policyMode;
  }

  public setPolicyMode(
    mode: LodPolicyMode,
    cameraPos: THREE.Vector3,
    cameraTarget: THREE.Vector3,
    floorViewMode: FloorViewMode
  ): boolean {
    this.policyMode = mode;
    return this.evaluateLod(cameraPos, cameraTarget, floorViewMode, true);
  }

  public getFocusedZoneId(): RoomZoneId | null {
    return this.focusedZoneId;
  }

  public getFocusedRoomShortName(): string {
    if (!this.focusedZoneId) {
      for (const room of this.rooms.values()) {
        if (!room.isInterior) return room.shortName;
      }
      return 'Exterior';
    }
    const focusedEntry = this.rooms.get(this.focusedZoneId);
    return focusedEntry?.shortName ?? this.focusedZoneId;
  }

  public setFocusedZoneId(
    zoneId: RoomZoneId,
    cameraPos: THREE.Vector3,
    cameraTarget: THREE.Vector3,
    floorViewMode: FloorViewMode
  ): boolean {
    this.focusedZoneId = zoneId;
    return this.evaluateLod(cameraPos, cameraTarget, floorViewMode, true);
  }

  /**
   * Evaluates and applies the target LOD tier (`0`, `1`, or `2`) for every registered room.
   * Returns `true` if any room's LOD tier changed (requiring a re-render).
   */
  public evaluateLod(
    cameraPos: THREE.Vector3,
    cameraTarget: THREE.Vector3,
    floorViewMode: FloorViewMode,
    forceNotify = false,
    options?: LodEvaluationOptions
  ): boolean {
    let anyChanged = false;
    let roomTierChanged = false;
    let shadowsDirty = false;

    const targetRoom = this.findContainingRoom(
      cameraTarget.x,
      cameraTarget.y,
      cameraTarget.z
    );
    if (this.policyMode === 'auto' && targetRoom) {
      this.focusedZoneId = targetRoom.zoneId;
    }

    const usePortalCulling =
      this.policyMode === 'auto' &&
      this.portalSolver !== null &&
      options?.camera !== undefined &&
      (floorViewMode === 'all' || Boolean(options.isWalkthrough));

    if (usePortalCulling && this.portalSolver && options?.camera) {
      this.portalSolver.solveVisibleInteriorRooms(options.camera, 'all', {
        roofCutawayOpen: options.roofCutawayOpen,
      });
    }

    const effectiveFloorMode: FloorViewMode =
      options?.isWalkthrough ? 'all' : floorViewMode;

    for (const room of this.rooms.values()) {
      const verticalWeight = effectiveFloorMode === 'all' ? 1.6 : 0.45;
      const distToTarget = Math.hypot(
        room.center.x - cameraTarget.x,
        (room.center.y - cameraTarget.y) * verticalWeight,
        room.center.z - cameraTarget.z
      );
      const distToCam = Math.hypot(
        room.center.x - cameraPos.x,
        (room.center.y - cameraPos.y) * 0.4,
        room.center.z - cameraPos.z
      );
      const zoomedOutFloorDist =
        !options?.isWalkthrough && distToCam > 16.0 ? (distToCam - 6.0) * 0.85 : 0;
      const effectiveDist = Math.max(zoomedOutFloorDist, Math.min(distToTarget, distToCam * 0.85));
      room.lastDistanceM = Math.round(effectiveDist * 10) / 10;

      const unoccludedTier = this.computeDesiredTierForRoom(
        room,
        effectiveDist,
        effectiveFloorMode
      );

      const portalOccluded =
        usePortalCulling &&
        room.isInterior &&
        unoccludedTier >= 1 &&
        !this.portalSolver!.isRoomVisible(room.zoneId);

      const desiredTier: RoomLodTier = portalOccluded ? 0 : unoccludedTier;

      if (
        room.currentTier !== desiredTier ||
        room.unoccludedTier !== unoccludedTier ||
        room.portalOccluded !== portalOccluded ||
        forceNotify
      ) {
        if (room.currentTier !== desiredTier) {
          anyChanged = true;
          roomTierChanged = true;
        }
        // Only an unoccluded floor/policy tier-1 boundary change alters the shadow-caster set;
        // portal-culled rooms are bracketed by CutawayController's shadow-pass hooks so camera
        // motion never triggers shadow-map rebuilds!
        if ((room.unoccludedTier >= 1) !== (unoccludedTier >= 1)) {
          shadowsDirty = true;
        }
        room.unoccludedTier = unoccludedTier;
        room.portalOccluded = portalOccluded;
        room.currentTier = desiredTier;
        this.applyTierToRoom(room, desiredTier);
      }
    }

    // Evaluate runtime distance-culled micro-detail and outbuilding interior clusters
    const nRuntime = this.runtimeDistanceItems.length;
    if (nRuntime > 0) {
      const camX = cameraPos.x;
      const camY = cameraPos.y;
      const camZ = cameraPos.z;
      const tgtX = cameraTarget.x;
      const tgtY = cameraTarget.y;
      const tgtZ = cameraTarget.z;
      const mode = this.policyMode;
      const scale = this.distanceScale;

      for (let i = 0; i < nRuntime; i++) {
        const item = this.runtimeDistanceItems[i]!;
        let wantVisible = true;
        if (mode === 'lod0') {
          wantVisible = false;
        } else if (mode === 'lod1') {
          wantVisible = item.maxDistanceM > 20.0;
        } else if (mode === 'auto') {
          const dxC = item.centerX - camX;
          const dyC = (item.centerY - camY) * 0.5;
          const dzC = item.centerZ - camZ;
          const distCamSq = dxC * dxC + dyC * dyC + dzC * dzC;

          const dxT = item.centerX - tgtX;
          const dyT = (item.centerY - tgtY) * 0.5;
          const dzT = item.centerZ - tgtZ;
          const distTgtSq = dxT * dxT + dyT * dyT + dzT * dzT;

          const rawMinDistSq = Math.min(distCamSq * 0.78, distTgtSq);
          const minDistSq =
            !options?.isWalkthrough && distCamSq > 256.0
              ? Math.max(rawMinDistSq, distCamSq * 0.55)
              : rawMinDistSq;
          // 1.2m hysteresis band prevents popping when hovering near threshold
          const scaledMax = item.maxDistanceM * scale;
          const threshold = item.visible ? scaledMax + 0.6 : scaledMax - 0.6;
          wantVisible = minDistSq <= threshold * threshold;
        }

        if (item.visible !== wantVisible || forceNotify) {
          if (item.visible !== wantVisible) {
            // Runtime items are permanently non-shadow-casting: never dirties shadows.
            anyChanged = true;
          }
          item.visible = wantVisible;
          item.object.visible = wantVisible;
        }
      }
    }

    this.lastEvalShadowsDirty = shadowsDirty;

    if ((roomTierChanged || forceNotify) && this.onLodChangeCallback) {
      this.onLodChangeCallback(this.getDiagnostics());
    }

    return anyChanged;
  }

  private computeDesiredTierForRoom(
    room: ManagedRoomLodEntry,
    effectiveDistM: number,
    floorViewMode: FloorViewMode
  ): RoomLodTier {
    if (this.policyMode === 'lod0') return 0;
    if (this.policyMode === 'lod1') return 1;
    if (this.policyMode === 'lod2') return 2;

    // In 'auto' mode:
    // 1. Rooms on a hidden/non-active floor drop to LOD0 Shell. Rooms that declare
    //    `crossFloorVisibleOn` for the active floor (e.g. both ends of a double-height stair void)
    //    always keep LOD1 so the shadow-caster set does not depend on which room is focused.
    if (
      floorViewMode !== 'all' &&
      room.floorId !== floorViewMode &&
      room.floorId !== 'exterior'
    ) {
      return room.crossFloorVisibleOn?.includes(floorViewMode) ? 1 : 0;
    }

    // 2. The explicitly focused room (and any room sharing its open-plan volume) gets LOD2 Hero
    const isFocusedPair =
      this.focusedZoneId !== null &&
      (room.zoneId === this.focusedZoneId ||
        Boolean(room.linkedOpenPlanZones?.includes(this.focusedZoneId)));

    if (isFocusedPair || effectiveDistM <= this.highDetailMaxDistanceM * this.distanceScale) {
      return 2;
    }

    // Always keep primary room furniture (LOD1 Standard) visible on the active floor
    return 1;
  }

  private applyTierToRoom(room: ManagedRoomLodEntry, tier: RoomLodTier): void {
    room.shellGroup.visible = true;
    room.standardGroup.visible = tier >= 1;
    room.heroGroup.visible = tier >= 2;

    for (const item of room.managedObjects) {
      item.object.visible = tier >= item.tier;
    }
  }

  public getDiagnostics(): RoomLodDiagnostics {
    const tierCounts: Record<RoomLodTier, number> = { 0: 0, 1: 0, 2: 0 };
    const snapshots: RoomLodStateSnapshot[] = [];

    for (const room of this.rooms.values()) {
      tierCounts[room.currentTier] += 1;
      let standardCount = room.standardGroup.children.length;
      let heroCount = room.heroGroup.children.length;
      for (const m of room.managedObjects) {
        if (m.tier === 1) standardCount += 1;
        else heroCount += 1;
      }
      snapshots.push({
        zoneId: room.zoneId,
        shortName: room.shortName,
        floorId: room.floorId,
        tier: room.currentTier,
        isFocused: room.zoneId === this.focusedZoneId,
        distanceToTargetM: room.lastDistanceM,
        standardObjectCount: standardCount,
        heroObjectCount: heroCount,
      });
    }

    let effectiveFocusId: RoomZoneId | null = this.focusedZoneId;
    if (effectiveFocusId === null) {
      let first: RoomZoneId | undefined;
      for (const room of this.rooms.values()) {
        first ??= room.zoneId;
        if (!room.isInterior) {
          effectiveFocusId = room.zoneId;
          break;
        }
      }
      effectiveFocusId ??= first ?? ('exterior' as RoomZoneId);
    }
    const focusedEntry = this.focusedZoneId ? this.rooms.get(this.focusedZoneId) : undefined;
    return {
      policyMode: this.policyMode,
      focusedZoneId: effectiveFocusId,
      focusedZoneTier: focusedEntry ? focusedEntry.currentTier : 0,
      tierCounts,
      rooms: snapshots,
    };
  }
}
