import * as THREE from 'three';
import type { RoomLodController } from '../lod/lod-manager.ts';
import type {
  CutawayWallDescriptor,
  FloorDefinition,
  FloorViewMode,
} from '../../core/types/scene.ts';
import {
  type PropertySceneProfile,
  getBoundPropertySceneProfile,
} from '../viewer/property-scene-profile.ts';
import type { PropertySceneLayers } from '../viewer/scene-content.ts';
import type { SceneZoneRegistry } from '../viewer/scene-zone-registry.ts';
import {
  type DynamicCutawayWallItem,
  createShadowPassHook,
  evaluateDynamicWallCut,
  isHiddenUpperFloorCutawayItem,
  resolveContainerTransformXZ,
  toContainerLocalXZ,
} from './cutaway-wall-math.ts';

export interface CutawayViewInput {
  readonly cameraPosition: THREE.Vector3;
  readonly target: THREE.Vector3;
  readonly isOrthographic: boolean;
  readonly orthoZoom: number;
  readonly isWalkthrough?: boolean;
  readonly camera?: THREE.Camera;
}

/** The parts of a home's profile the cutaway controller reads. */
export type CutawayProfile = Pick<PropertySceneProfile, 'floors' | 'cutawayOptions' | 'initialView'>;

/** Storeys assumed for homes that do not declare any. */
const DEFAULT_FLOORS: readonly FloorDefinition[] = [
  { id: 'ground', elevationY: 0, ceilingHeight: 2.5 },
  { id: 'first', elevationY: 2.5, ceilingHeight: 2.4 },
];

/** Highest orbit eye height above the lowest floor that still counts as inside the house (m). */
const LOWEST_FLOOR_INTERIOR_EYE_MAX_M = 1.85;
/** Same limit above the viewed upper floor (or the top floor when every floor is shown) (m). */
const UPPER_FLOOR_INTERIOR_EYE_MAX_M = 2.15;
/** A walkthrough eye this far below a floor's elevation is already on that floor (stairs) (m). */
const WALKTHROUGH_FLOOR_EYE_MARGIN_M = 0.35;
/** An interior orbit eye this far below the upper floor's elevation reveals the upper storey (m). */
const UPPER_FLOOR_REVEAL_EYE_MARGIN_M = 0.3;
/** Wall-cutaway focus plane above the lowest floor (m). */
const LOWEST_FLOOR_FOCUS_PLANE_M = 0.4;
/** Wall-cutaway focus plane below an upper floor's elevation (m). */
const UPPER_FLOOR_FOCUS_PLANE_DROP_M = 0.7;

export interface CutawayUpdateResult {
  readonly needsRender: boolean;
  readonly shadowsDirty: boolean;
}

/**
 * Owns the floor-view / ceiling-cutaway state and decides, every time the camera
 * moves, which floors, ceilings, roof and walls are hidden so the camera can
 * see into the focused rooms. Also drives room LOD evaluation.
 *
 * Lighting invariant: cutaways only change what the *camera* sees. Geometry hidden by a
 * cutaway (first floor, ceilings, roof, camera-facing walls, and wall-mounted exterior vines)
 * keeps casting shadows via two shadow-pass hook meshes bracketing every shadow-map render.
 */
export class CutawayController {
  private readonly layers: PropertySceneLayers;
  private readonly zoneRegistry: SceneZoneRegistry;
  private readonly lodController: RoomLodController;
  private readonly dynamicCutawayWallItems: DynamicCutawayWallItem[] = [];
  private readonly overheadLightMaterials: Array<{
    readonly mat: THREE.MeshStandardMaterial;
    readonly cutawayOpacity: number;
  }> = [];

  private shadowCastersIgnoreCutaway = true;
  private readonly shadowPassStartHook: THREE.Mesh = createShadowPassHook('__cutawayShadowPassStart');
  private readonly shadowPassEndHook: THREE.Mesh = createShadowPassHook('__cutawayShadowPassEnd');
  private readonly shadowPassRevealed: THREE.Object3D[] = [];

  private readonly explicitProfile: CutawayProfile | undefined;
  private floorsSource: readonly FloorDefinition[] | undefined | null = null;
  private floors: readonly FloorDefinition[] = DEFAULT_FLOORS;
  private floorViewMode: FloorViewMode = 'ground';
  private ceilingCutaway = true;
  private wasWalkthrough = false;
  private allDynamicWallsShown = false;
  private overheadLightsLowOpacity = true;
  private readonly lastWalkthroughLodPos = new THREE.Vector3(
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY
  );
  private readonly lastOrbitLodCamPos = new THREE.Vector3(
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY
  );
  private readonly lastOrbitLodTargetPos = new THREE.Vector3(
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY
  );
  private readonly lastLodCamQuat = new THREE.Quaternion();
  private hasLastLodCamQuat = false;

  public constructor(
    layers: PropertySceneLayers,
    zoneRegistry: SceneZoneRegistry,
    lodController: RoomLodController,
    profile?: CutawayProfile
  ) {
    this.layers = layers;
    this.zoneRegistry = zoneRegistry;
    this.lodController = lodController;
    this.explicitProfile = profile;
    const resolvedProfile = this.profile;
    if (resolvedProfile?.floors && resolvedProfile.floors.length > 0) {
      this.layers.ensureFloors?.(resolvedProfile.floors);
      this.floorViewMode = this.getFloors()[0]!.id;
    }
    if (resolvedProfile?.initialView?.floor !== undefined) {
      const initFloor = resolvedProfile.initialView.floor;
      if (initFloor === 'all' || this.getFloors().some((f) => f.id === initFloor)) {
        this.floorViewMode = initFloor;
      }
    }
    if (resolvedProfile?.initialView?.sectionCut !== undefined) {
      this.ceilingCutaway = resolvedProfile.initialView.sectionCut;
    } else if (resolvedProfile?.initialView?.floor !== undefined) {
      this.ceilingCutaway = this.floorViewMode !== 'all';
    }
    this.shadowPassStartHook.onBeforeShadow = (): void => {
      this.revealCutawayGeometryForShadowPass();
    };
    this.shadowPassEndHook.onAfterShadow = (): void => {
      this.restoreCutawayGeometryAfterShadowPass();
    };
  }

  public setShadowCastersIgnoreCutaway(enabled: boolean): boolean {
    if (this.shadowCastersIgnoreCutaway === enabled) return false;
    this.shadowCastersIgnoreCutaway = enabled;
    this.ensureShadowPassHooks();
    return true;
  }

  public getShadowCastersIgnoreCutaway(): boolean {
    return this.shadowCastersIgnoreCutaway;
  }

  public doesCutawayAffectShadows(): boolean {
    return !this.shadowCastersIgnoreCutaway;
  }

  private forEachCutawayManagedObject(fn: (obj: THREE.Object3D) => void): void {
    const {
      firstFloorMeshGroup,
      groundFloorCeilingGroup,
      ceilingMeshGroup,
      roofGroup,
      floorLayers,
      cutawayWallGroups,
    } = this.layers;
    fn(firstFloorMeshGroup);
    fn(groundFloorCeilingGroup);
    fn(ceilingMeshGroup);
    if (roofGroup && roofGroup !== ceilingMeshGroup) {
      fn(roofGroup);
    }
    if (floorLayers) {
      for (let i = 0; i < floorLayers.length; i++) {
        const entry = floorLayers[i]!;
        if (entry.contentGroup !== firstFloorMeshGroup) {
          fn(entry.contentGroup);
        }
        fn(entry.slabGroup);
        if (entry.ceilingGroup !== groundFloorCeilingGroup) {
          fn(entry.ceilingGroup);
        }
      }
    }
    fn(cutawayWallGroups.southWest);
    fn(cutawayWallGroups.west);
    fn(cutawayWallGroups.north);
    fn(cutawayWallGroups.east);
    for (const item of this.dynamicCutawayWallItems) {
      fn(item.obj);
    }
    this.lodController.forEachPortalCulledObject(fn);
  }

  private revealCutawayGeometryForShadowPass(): void {
    if (!this.shadowCastersIgnoreCutaway || this.shadowPassRevealed.length > 0) return;
    this.forEachCutawayManagedObject((obj) => {
      if (!obj.visible) {
        obj.visible = true;
        this.shadowPassRevealed.push(obj);
      }
    });
  }

  private restoreCutawayGeometryAfterShadowPass(): void {
    for (let i = 0; i < this.shadowPassRevealed.length; i++) {
      this.shadowPassRevealed[i]!.visible = false;
    }
    this.shadowPassRevealed.length = 0;
  }

  private ensureShadowPassHooks(): void {
    const scene = this.layers.scene;
    const start = this.shadowPassStartHook;
    const end = this.shadowPassEndHook;
    if (!this.shadowCastersIgnoreCutaway) {
      if (start.parent) start.parent.remove(start);
      if (end.parent) end.parent.remove(end);
      return;
    }
    const children = scene.children;
    if (children[0] !== start) {
      if (start.parent !== scene) scene.add(start);
      const idx = children.indexOf(start);
      if (idx > 0) {
        children.splice(idx, 1);
        children.unshift(start);
      }
    }
    if (children[children.length - 1] !== end) {
      if (end.parent === scene) {
        children.splice(children.indexOf(end), 1);
        children.push(end);
      } else {
        scene.add(end);
      }
    }
    start.castShadow = true;
    end.castShadow = true;

    const hookedScene = scene as THREE.Scene & { __cutawayShadowSceneHooked?: boolean };
    if (!hookedScene.__cutawayShadowSceneHooked) {
      hookedScene.__cutawayShadowSceneHooked = true;
      const prevBefore = scene.onBeforeRender;
      const prevAfter = scene.onAfterRender;
      scene.onBeforeRender = (...args) => {
        if (typeof prevBefore === 'function') {
          prevBefore.apply(scene, args);
        }
        const overrideMat = scene.overrideMaterial as { isShadowPassMaterial?: boolean } | null;
        if (overrideMat?.isShadowPassMaterial === true) {
          this.revealCutawayGeometryForShadowPass();
        }
      };
      scene.onAfterRender = (...args) => {
        if (this.shadowPassRevealed.length > 0) {
          this.restoreCutawayGeometryAfterShadowPass();
        }
        if (typeof prevAfter === 'function') {
          prevAfter.apply(scene, args);
        }
      };
    }
  }

  private get profile(): CutawayProfile | undefined {
    return this.explicitProfile ?? getBoundPropertySceneProfile(this.layers.scene);
  }

  public getFloors(): readonly FloorDefinition[] {
    const source = this.profile?.floors;
    if (source !== this.floorsSource) {
      this.floorsSource = source;
      this.floors =
        source && source.length > 0
          ? [...source].sort((a, b) => a.elevationY - b.elevationY)
          : DEFAULT_FLOORS;
      this.layers.ensureFloors?.(this.floors);
    }
    return this.floors;
  }

  public getFloorViewMode(): FloorViewMode {
    return this.floorViewMode;
  }

  public isCeilingCutaway(): boolean {
    return this.ceilingCutaway;
  }

  public setFloorViewMode(mode: FloorViewMode): void {
    this.floorViewMode = mode;
    this.ceilingCutaway = mode !== 'all';
    this.lastOrbitLodCamPos.set(
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY
    );
  }

  public setViewState(floorViewMode: FloorViewMode, ceilingCutaway: boolean): void {
    this.floorViewMode = floorViewMode;
    this.ceilingCutaway = ceilingCutaway;
    this.lastOrbitLodCamPos.set(
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY
    );
  }

  public toggleCeilingCutaway(): boolean {
    this.ceilingCutaway = !this.ceilingCutaway;
    this.invalidateLodCache();
    return this.ceilingCutaway;
  }

  public invalidateLodCache(): void {
    this.lastWalkthroughLodPos.set(
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY
    );
    this.lastOrbitLodCamPos.set(
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY
    );
    this.hasLastLodCamQuat = false;
  }

  /**
   * Indexes every object tagged with `userData.cutawayWall` across all scene groups
   * (including `siteGroup`, `groundFloorMeshGroup`, `firstFloorMeshGroup`, and batched
   * `PhenologyMaterial` containers), recording any parent wing/room container transform.
   */
  public collectDynamicCutawayWalls(): void {
    this.restoreCutawayGeometryAfterShadowPass();
    this.ensureShadowPassHooks();
    this.dynamicCutawayWallItems.length = 0;
    this.overheadLightMaterials.length = 0;
    this.allDynamicWallsShown = false;
    const seenLightMats = new Set<THREE.MeshStandardMaterial>();

    this.layers.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (m instanceof THREE.MeshStandardMaterial && !seenLightMats.has(m)) {
            const savedCutawayOpacity = m.userData?.cutawayLightOpacity as number | undefined;
            if (
              typeof savedCutawayOpacity === 'number' ||
              (m.transparent && m.opacity >= 0.30 && m.opacity <= 0.44 && m.depthWrite === false)
            ) {
              const cutawayOpacity = savedCutawayOpacity ?? m.opacity;
              m.userData = { ...m.userData, cutawayLightOpacity: cutawayOpacity };
              seenLightMats.add(m);
              this.overheadLightMaterials.push({ mat: m, cutawayOpacity });
            }
          }
        }
      }

      const rawDescriptor = obj.userData?.cutawayWall as CutawayWallDescriptor | undefined;
      if (!rawDescriptor) return;
      // Skip descendants that merely inherited the identical descriptor reference from an ancestor group.
      if (obj.parent?.userData?.cutawayWall === rawDescriptor) return;

      const { offsetX, offsetZ, rotationY } = resolveContainerTransformXZ(obj);
      this.dynamicCutawayWallItems.push({
        obj,
        descriptor: rawDescriptor,
        offsetX,
        offsetZ,
        rotationY,
      });
    });
  }

  public update(view: CutawayViewInput): CutawayUpdateResult {
    const { firstFloorMeshGroup, groundFloorCeilingGroup, ceilingMeshGroup, cutawayWallGroups } =
      this.layers;
    let needsRender = false;
    let lodShadowsDirty = false;
    this.restoreCutawayGeometryAfterShadowPass();
    this.ensureShadowPassHooks();
    const cutawayAffectsShadows = !this.shadowCastersIgnoreCutaway;

    const cam = view.cameraPosition;
    const target = view.target;
    const isWalkthrough = Boolean(view.isWalkthrough);

    const dx = target.x - cam.x;
    const dz = target.z - cam.z;
    const horizLen = Math.hypot(dx, dz);
    const isTopDownPlan = horizLen < 0.45;

    const perspDist = cam.distanceTo(target);
    const zoomedOut =
      this.lodController.getPolicyMode() === 'lod0' ||
      (view.isOrthographic
        ? view.orthoZoom <= 0.62
        : perspDist >= (isTopDownPlan ? 32.0 : 28.5));

    const floors = this.getFloors();
    const lowestFloor = floors[0]!;
    const viewedFloorIndex = floors.findIndex((f) => f.id === this.floorViewMode);
    const isLowestFloorMode = viewedFloorIndex === 0;
    const isUpperFloorMode = viewedFloorIndex > 0;
    const maxEyeY = isLowestFloorMode
      ? lowestFloor.elevationY + LOWEST_FLOOR_INTERIOR_EYE_MAX_M
      : (isUpperFloorMode ? floors[viewedFloorIndex]! : floors[floors.length - 1]!).elevationY +
        UPPER_FLOOR_INTERIOR_EYE_MAX_M;
    const cameraInsideHouse =
      isWalkthrough ||
      (!view.isOrthographic &&
        perspDist <= 4.35 &&
        cam.y <= maxEyeY &&
        this.zoneRegistry.isPointInsideInteriorRoom(cam.x, cam.y, cam.z) &&
        this.zoneRegistry.isPointInsideInteriorRoom(target.x, target.y, target.z));

    const roofCutawayOpen =
      !cameraInsideHouse && this.floorViewMode === 'all' && this.ceilingCutaway && !zoomedOut;

    const camRotated =
      view.camera !== undefined &&
      (!this.hasLastLodCamQuat ||
        1 - Math.abs(this.lastLodCamQuat.dot(view.camera.quaternion)) > 1e-4);

    if (isWalkthrough) {
      const enteredWalkthrough = !this.wasWalkthrough;
      this.wasWalkthrough = true;
      if (
        enteredWalkthrough ||
        camRotated ||
        this.lastWalkthroughLodPos.distanceToSquared(cam) >= 0.14
      ) {
        this.lastWalkthroughLodPos.copy(cam);
        if (view.camera) {
          this.lastLodCamQuat.copy(view.camera.quaternion);
          this.hasLastLodCamQuat = true;
        }
        let walkthroughFloor: FloorViewMode = lowestFloor.id;
        for (let i = 1; i < floors.length; i++) {
          const floor = floors[i]!;
          if (cam.y >= floor.elevationY - WALKTHROUGH_FLOOR_EYE_MARGIN_M) walkthroughFloor = floor.id;
        }
        if (
          this.lodController.evaluateLod(cam, cam, walkthroughFloor, false, {
            camera: view.camera,
            isWalkthrough: true,
            roofCutawayOpen: false,
          })
        ) {
          needsRender = true;
          if (this.lodController.didLastEvalChangeShadows()) {
            lodShadowsDirty = true;
          }
        }
      }
    } else {
      if (this.wasWalkthrough) {
        this.wasWalkthrough = false;
        this.invalidateLodCache();
      }
      if (
        camRotated ||
        this.lastOrbitLodCamPos.distanceToSquared(cam) >= 0.08 ||
        this.lastOrbitLodTargetPos.distanceToSquared(target) >= 0.04
      ) {
        this.lastOrbitLodCamPos.copy(cam);
        this.lastOrbitLodTargetPos.copy(target);
        if (view.camera) {
          this.lastLodCamQuat.copy(view.camera.quaternion);
          this.hasLastLodCamQuat = true;
        }
        if (
          this.lodController.evaluateLod(cam, target, this.floorViewMode, false, {
            camera: view.camera,
            isWalkthrough: false,
            roofCutawayOpen,
            zoomedOutClosedShell: false,
          })
        ) {
          needsRender = true;
          if (this.lodController.didLastEvalChangeShadows()) {
            lodShadowsDirty = true;
          }
        }
      }
    }

    const wantLowOpacityLights = this.ceilingCutaway && !cameraInsideHouse;
    if (wantLowOpacityLights !== this.overheadLightsLowOpacity) {
      this.overheadLightsLowOpacity = wantLowOpacityLights;
      for (const { mat, cutawayOpacity } of this.overheadLightMaterials) {
        mat.transparent = wantLowOpacityLights;
        mat.opacity = wantLowOpacityLights ? cutawayOpacity : 1.0;
        mat.depthWrite = !wantLowOpacityLights;
        mat.needsUpdate = true;
      }
      needsRender = true;
    }

    const floorLayers = this.layers.floorLayers;
    const roofGroup = this.layers.roofGroup ?? ceilingMeshGroup;
    const applyShellVisibilities = (): boolean => {
      let shellChanged = false;
      if (floorLayers && floorLayers.length > 0) {
        const topIdx = floorLayers.length - 1;
        const activeIdx = viewedFloorIndex >= 0 ? viewedFloorIndex : 0;
        let desiredRoofVis = true;
        if (cameraInsideHouse) {
          desiredRoofVis = true;
        } else if (this.floorViewMode === 'all') {
          desiredRoofVis = !this.ceilingCutaway || zoomedOut;
        } else {
          desiredRoofVis = activeIdx === topIdx ? !this.ceilingCutaway : false;
        }

        for (let i = 0; i < floorLayers.length; i++) {
          const entry = floorLayers[i]!;
          let wantContent = true;
          let wantSlab = true;
          let wantCeiling = true;

          if (cameraInsideHouse) {
            const showFloor =
              isWalkthrough ||
              i === 0 ||
              cam.y >= entry.elevationY - UPPER_FLOOR_REVEAL_EYE_MARGIN_M ||
              !isLowestFloorMode;
            wantContent = showFloor;
            wantSlab = showFloor;
            wantCeiling = true;
          } else if (this.floorViewMode === 'all') {
            wantContent = true;
            wantSlab = true;
            wantCeiling = i < topIdx ? true : !this.ceilingCutaway || zoomedOut;
          } else if (i > activeIdx) {
            wantContent = false;
            wantSlab = false;
            wantCeiling = false;
          } else if (i === activeIdx) {
            wantContent = true;
            wantSlab = true;
            wantCeiling = !this.ceilingCutaway;
          } else {
            wantContent = true;
            wantSlab = true;
            wantCeiling = true;
          }

          if (entry.contentGroup.visible !== wantContent) {
            entry.contentGroup.visible = wantContent;
            shellChanged = true;
          }
          if (entry.slabGroup.visible !== wantSlab) {
            entry.slabGroup.visible = wantSlab;
            shellChanged = true;
          }
          if (entry.ceilingGroup.visible !== wantCeiling) {
            entry.ceilingGroup.visible = wantCeiling;
            shellChanged = true;
          }
        }

        if (roofGroup.visible !== desiredRoofVis) {
          roofGroup.visible = desiredRoofVis;
          shellChanged = true;
        }
        if (ceilingMeshGroup !== roofGroup && ceilingMeshGroup.visible !== desiredRoofVis) {
          ceilingMeshGroup.visible = desiredRoofVis;
          shellChanged = true;
        }
        return shellChanged;
      }

      let desiredFirstFloorVis = true;
      let desiredGroundCeilingVis = true;
      let desiredRoofVis = true;
      if (cameraInsideHouse) {
        const upperFloorY = floors[1]?.elevationY ?? Number.POSITIVE_INFINITY;
        desiredGroundCeilingVis = true;
        desiredRoofVis = true;
        desiredFirstFloorVis =
          isWalkthrough ||
          cam.y >= upperFloorY - UPPER_FLOOR_REVEAL_EYE_MARGIN_M ||
          !isLowestFloorMode;
      } else if (this.floorViewMode === 'all') {
        desiredFirstFloorVis = true;
        desiredGroundCeilingVis = true;
        desiredRoofVis = !this.ceilingCutaway || zoomedOut;
      } else if (isUpperFloorMode) {
        desiredFirstFloorVis = true;
        desiredGroundCeilingVis = true;
        desiredRoofVis = !this.ceilingCutaway;
      } else {
        desiredFirstFloorVis = false;
        desiredGroundCeilingVis = !this.ceilingCutaway;
        desiredRoofVis = false;
      }
      if (
        firstFloorMeshGroup.visible !== desiredFirstFloorVis ||
        groundFloorCeilingGroup.visible !== desiredGroundCeilingVis ||
        ceilingMeshGroup.visible !== desiredRoofVis
      ) {
        firstFloorMeshGroup.visible = desiredFirstFloorVis;
        groundFloorCeilingGroup.visible = desiredGroundCeilingVis;
        ceilingMeshGroup.visible = desiredRoofVis;
        shellChanged = true;
      }
      return shellChanged;
    };

    if (zoomedOut || cameraInsideHouse || !this.ceilingCutaway) {
      this.ensureCeilingSubgroupsVisible();
      let changed = applyShellVisibilities();
      if (
        !cutawayWallGroups.southWest.visible ||
        !cutawayWallGroups.west.visible ||
        !cutawayWallGroups.north.visible ||
        !cutawayWallGroups.east.visible
      ) {
        cutawayWallGroups.southWest.visible = true;
        cutawayWallGroups.west.visible = true;
        cutawayWallGroups.north.visible = true;
        cutawayWallGroups.east.visible = true;
        changed = true;
      }
      const hasUpperFloorFilter = !cameraInsideHouse && viewedFloorIndex >= 0;
      if (!this.allDynamicWallsShown || hasUpperFloorFilter) {
        for (const item of this.dynamicCutawayWallItems) {
          const desiredVis = !isHiddenUpperFloorCutawayItem(
            item.descriptor,
            floors,
            viewedFloorIndex,
            cameraInsideHouse
          );
          if (item.obj.visible !== desiredVis) {
            item.obj.visible = desiredVis;
            changed = true;
          }
        }
        this.allDynamicWallsShown = !hasUpperFloorFilter;
      }
      return {
        needsRender: needsRender || changed,
        shadowsDirty: (cutawayAffectsShadows && changed) || lodShadowsDirty,
      };
    }

    this.allDynamicWallsShown = false;

    const focusPlaneY = isUpperFloorMode
      ? floors[viewedFloorIndex]!.elevationY - UPPER_FLOOR_FOCUS_PLANE_DROP_M
      : lowestFloor.elevationY + LOWEST_FLOOR_FOCUS_PLANE_M;
    const tFocus =
      cam.y > focusPlaneY + 0.5 && target.y < focusPlaneY - 0.5
        ? THREE.MathUtils.clamp((cam.y - focusPlaneY) / (cam.y - target.y), 0.2, 1.0)
        : 1.0;
    const focusWorldX = cam.x + (target.x - cam.x) * tFocus;
    const focusWorldZ = cam.z + (target.z - cam.z) * tFocus;

    const cutawayContainer = cutawayWallGroups.southWest.children[0];
    const containerOffset = (cutawayContainer?.userData?.containerOffset as
      | readonly [number, number, number]
      | undefined) ?? [0, 0, 0];
    const containerRotY =
      (cutawayContainer?.userData?.containerRotationY as number | undefined) ?? 0;
    const localCam = toContainerLocalXZ(
      cam.x,
      cam.z,
      containerOffset[0],
      containerOffset[2],
      containerRotY
    );
    const localTarget = toContainerLocalXZ(
      focusWorldX,
      focusWorldZ,
      containerOffset[0],
      containerOffset[2],
      containerRotY
    );
    const localDx = localTarget.x - localCam.x;
    const localDz = localTarget.z - localCam.z;
    const localHorizLen = Math.hypot(localDx, localDz);

    let staticCuts = this.profile?.cutawayOptions?.evaluateStaticCutawayGroups?.({
      floorViewMode: this.floorViewMode,
      isTopDownPlan,
      camX: localCam.x,
      camZ: localCam.z,
      targetX: localTarget.x,
      targetZ: localTarget.z,
      dirX: localHorizLen > 0.001 ? localDx / localHorizLen : 0,
      dirZ: localHorizLen > 0.001 ? localDz / localHorizLen : 0,
    });
    if (
      this.floorViewMode === 'all' &&
      this.ceilingCutaway &&
      !isTopDownPlan &&
      !staticCuts?.southWest &&
      !staticCuts?.west &&
      !staticCuts?.north &&
      !staticCuts?.east
    ) {
      staticCuts = this.profile?.cutawayOptions?.evaluateStaticCutawayGroups?.({
        floorViewMode: lowestFloor.id,
        isTopDownPlan,
        camX: localCam.x,
        camZ: localCam.z,
        targetX: localTarget.x,
        targetZ: localTarget.z,
        dirX: localHorizLen > 0.001 ? localDx / localHorizLen : 0,
        dirZ: localHorizLen > 0.001 ? localDz / localHorizLen : 0,
      });
    }
    const swVis = !staticCuts?.southWest;
    const wVis = !staticCuts?.west;
    const nVis = !staticCuts?.north;
    const eVis = !staticCuts?.east;

    this.ensureCeilingSubgroupsVisible();
    let changed = applyShellVisibilities();
    if (
      cutawayWallGroups.southWest.visible !== swVis ||
      cutawayWallGroups.west.visible !== wVis ||
      cutawayWallGroups.north.visible !== nVis ||
      cutawayWallGroups.east.visible !== eVis
    ) {
      cutawayWallGroups.southWest.visible = swVis;
      cutawayWallGroups.west.visible = wVis;
      cutawayWallGroups.north.visible = nVis;
      cutawayWallGroups.east.visible = eVis;
      changed = true;
    }

    for (const { obj, descriptor, offsetX, offsetZ, rotationY } of this.dynamicCutawayWallItems) {
      if (isHiddenUpperFloorCutawayItem(descriptor, floors, viewedFloorIndex, cameraInsideHouse)) {
        if (obj.visible) {
          obj.visible = false;
          changed = true;
        }
        continue;
      }
      const lCam = toContainerLocalXZ(cam.x, cam.z, offsetX, offsetZ, rotationY);
      const lTarget = toContainerLocalXZ(focusWorldX, focusWorldZ, offsetX, offsetZ, rotationY);
      const lHorizLen = Math.hypot(lTarget.x - lCam.x, lTarget.z - lCam.z);
      const lVx = lHorizLen > 0.001 ? (lTarget.x - lCam.x) / lHorizLen : 0;
      const lVz = lHorizLen > 0.001 ? (lTarget.z - lCam.z) / lHorizLen : 0;
      const desiredVis = !evaluateDynamicWallCut(
        descriptor,
        this.floorViewMode,
        lCam.x,
        lCam.z,
        lTarget.x,
        lTarget.z,
        lVx,
        lVz,
        isTopDownPlan,
        lowestFloor.id,
        isUpperFloorMode
      );
      if (obj.visible !== desiredVis) {
        obj.visible = desiredVis;
        changed = true;
      }
    }

    return {
      needsRender: needsRender || changed,
      shadowsDirty: (cutawayAffectsShadows && changed) || lodShadowsDirty,
    };
  }

  private ensureCeilingSubgroupsVisible(): void {
    for (const child of this.layers.ceilingMeshGroup.children) {
      if (child.userData?.isRoomContainer && !child.visible) {
        child.visible = true;
      }
    }
    for (const child of this.layers.groundFloorCeilingGroup.children) {
      if (child.userData?.isRoomContainer && !child.visible) {
        child.visible = true;
      }
    }
    if (this.layers.floorLayers) {
      for (const entry of this.layers.floorLayers) {
        if (entry.ceilingGroup === this.layers.groundFloorCeilingGroup) continue;
        for (const child of entry.ceilingGroup.children) {
          if (child.userData?.isRoomContainer && !child.visible) {
            child.visible = true;
          }
        }
      }
    }
  }
}
