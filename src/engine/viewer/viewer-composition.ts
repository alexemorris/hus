import * as THREE from 'three';
import type {
  AcousticPortalState,
  AcousticSurfaceMaterial,
  FloorSurfaceType,
  RoomAcousticProfile,
} from '../../core/types/acoustics.ts';
import type { SeasonSelection } from '../../core/types/environment-hdri.ts';
import type { FloorViewMode, InteractiveUserData, TimeOfDay } from '../../core/types/scene.ts';
import type {
  LiveWeatherState,
  PrecipitationType,
  SkyWeatherSnapshot,
  SolarDateTimeInput,
  WeatherPresetId,
} from '../../core/types/solar-weather.ts';
import { computeAcousticOcclusion } from '../audio/acoustic-occlusion.ts';
import { soundEngine } from '../audio/sound-engine.ts';
import { getAttachedAudioEmitters, type AudioEmitterHandle } from '../audio/spatial-emitters.ts';
import { CutawayController } from '../cutaway/cutaway-controller.ts';
import { EnvironmentLighting } from '../lighting/environment-lighting.ts';
import { installShaderLightCulling } from '../lighting/shader-light-culling.ts';
import { RoomLodController } from '../lod/lod-manager.ts';
import { applySelectiveBevelModifier } from '../rendering/bevel-modifier.ts';
import {
  isRecordingCanvasStub,
  releaseUploadedStaticCanvases,
} from '../textures/texture-registry.ts';
import { STANDING_EYE_HEIGHT } from '../walkthrough/parts/walkthrough-spawns.ts';
import {
  type WalkthroughController,
} from '../walkthrough/walkthrough-controller.ts';
import type { PropertySceneProfile, SecurityOverlay3D } from './property-scene-profile.ts';
import {
  buildPropertySceneContent,
  createPropertySceneLayers,
  type PropertySceneContent,
  type PropertySceneLayers,
} from './scene-content.ts';
import type { SceneZoneRegistry } from './scene-zone-registry.ts';
import { AnnotationService } from './services/annotation-service.ts';
import { CameraService } from './services/camera-service.ts';
import { DeviceService } from './services/device-service.ts';
import { GraphicsService } from './services/graphics-service.ts';
import { PointerInput } from './services/pointer-input.ts';
import { RoomService } from './services/room-service.ts';
import { StaticSceneService } from './services/static-scene-service.ts';
import { TradeViewService } from './services/trade-view-service.ts';
import { AssetInspectorController } from '../assets/asset-inspector-controller.ts';
import { TerrainSculptController } from '../terrain/terrain-sculpt-controller.ts';
import { ViewerRenderer } from './services/viewer-renderer.ts';
import { createViewerWalkthrough } from './services/viewer-walkthrough.ts';

/**
 * Composition root of the 3D viewer: builds and wires the focused services and
 * runs the frame loop. `PropertyScene` extends this with flat legacy delegates.
 *
 * - `renderer` (ViewerRenderer): WebGL + post-processing + on-demand render flag
 * - `camera` (CameraService): rig, fly-to, poses, view events, projection / picking
 * - `cutaways` (CutawayController): floor focus, ceiling / roof / wall cutaways
 * - `rooms` (RoomService): current room, focused-room LOD, room highlight
 * - `graphics` (GraphicsService): PerformanceGovernor, quality presets, stats
 * - `trades` (TradeViewService), `annotations` (AnnotationService),
 *   `devices` (DeviceService), `staticScene` (batching / matrix freezing),
 *   `input` (PointerInput), `walkthrough`
 *
 * Home-specific data comes from a `PropertySceneProfile`.
 */
export class ViewerComposition<TSecurity extends SecurityOverlay3D = SecurityOverlay3D> {
  public readonly scene: THREE.Scene;
  public readonly renderer: ViewerRenderer;
  public readonly camera: CameraService;
  public readonly cutaways: CutawayController;
  public readonly rooms: RoomService;
  public readonly walkthrough: WalkthroughController;
  public readonly annotations: AnnotationService;
  public readonly environment: EnvironmentLighting;
  public readonly devices: DeviceService<TSecurity>;
  public readonly trades: TradeViewService;
  public readonly staticScene: StaticSceneService;
  public readonly input: PointerInput;
  public readonly terrainSculpt: TerrainSculptController;
  public readonly assetInspector: AssetInspectorController;
  public readonly graphics: GraphicsService;

  private readonly canvas: HTMLCanvasElement;
  protected readonly zoneRegistry: SceneZoneRegistry;
  protected readonly lodController: RoomLodController;
  protected readonly layers: PropertySceneLayers;
  protected readonly content: PropertySceneContent<TSecurity>;
  protected readonly profile: PropertySceneProfile<TSecurity>;
  private userInteracting = false;
  private viewDirtyFromControls = false;
  private readonly retainedWarmupDisposables: Array<{ dispose(): void }> = [];
  private lastTickActive = false;
  private panCloudDriftAccumSec = 0;
  private deferredShadowFrustumUpdate = false;
  private appliedSceneTimeOfDay: TimeOfDay | null = null;
  private trailingShadowTimer: ReturnType<typeof setTimeout> | null = null;
  private interactiveScrubActive = false;
  private interactiveScrubPointerHeld = false;
  private interactiveScrubSettleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastProgrammaticScrubMs = -10_000;
  private lastScrubShadowBakeMs = -10_000;
  private readonly scrubSettledListeners = new Set<() => void>();
  private readonly audioEmitters: readonly AudioEmitterHandle[];
  private readonly isInteriorAcousticPoint: (x: number, y: number, z: number) => boolean;
  private readonly exteriorPortalsScratch: AcousticPortalState[] = [];

  public constructor(
    canvas: HTMLCanvasElement,
    onObjectInteraction: (
      data: InteractiveUserData,
      details?: {
        readonly pressDurationMs: number;
        readonly worldPosition?: { readonly x: number; readonly y: number; readonly z: number };
      }
    ) => void,
    profile: PropertySceneProfile<TSecurity>
  ) {
    installShaderLightCulling();
    this.canvas = canvas;
    this.profile = profile;
    this.zoneRegistry = profile.createZoneRegistry();
    this.lodController = new RoomLodController(profile.lodRegistrations);
    const interiorAcousticZones = profile.lodRegistrations
      .filter((r) => r.isInterior !== false)
      .map((r) => ({
        bounds: r.obb ? r.obb.bounds : r.bounds,
        ox: r.obb?.offset[0] ?? 0,
        oy: r.obb?.offset[1] ?? 0,
        oz: r.obb?.offset[2] ?? 0,
        cosY: r.obb ? Math.cos(r.obb.rotationY) : 1,
        sinY: r.obb ? Math.sin(r.obb.rotationY) : 0,
        hasObb: Boolean(r.obb),
        excludedCutout: r.excludedCutout,
      }));
    this.isInteriorAcousticPoint = (wx, wy, wz) => {
      for (let i = 0; i < interiorAcousticZones.length; i++) {
        const z = interiorAcousticZones[i]!;
        if (z.excludedCutout?.(wx, wz)) continue;
        let lx = wx;
        let ly = wy;
        let lz = wz;
        if (z.hasObb) {
          const dx = wx - z.ox;
          const dz = wz - z.oz;
          lx = dx * z.cosY - dz * z.sinY;
          ly = wy - z.oy;
          lz = dx * z.sinY + dz * z.cosY;
        }
        const b = z.bounds;
        if (
          lx >= b.minX &&
          lx <= b.maxX &&
          ly >= b.minY - 0.1 &&
          ly <= b.maxY + 0.15 &&
          lz >= b.minZ &&
          lz <= b.maxZ
        ) {
          return true;
        }
      }
      return false;
    };

    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(0x0f1318);

    const renderer = (this.renderer = new ViewerRenderer(canvas));
    this.camera = new CameraService({
      canvas,
      scene,
      renderer,
      zoneRegistry: this.zoneRegistry,
      lodController: this.lodController,
      onActiveCameraChanged: (camera) => this.annotations.controller.setCamera(camera),
      getCutaways: () => this.cutaways,
      getWalkthrough: () => this.walkthrough,
      isPickExcluded: (mesh) => this.isPickExcluded(mesh),
      refreshView: () => this.refreshView(false),
    });
    const rig = this.camera.rig;
    rig.controls.addEventListener('change', () => {
      this.viewDirtyFromControls = true;
      renderer.requestRender();
    });

    const layers = (this.layers = createPropertySceneLayers(scene, profile.floors));
    this.cutaways = new CutawayController(layers, this.zoneRegistry, this.lodController, profile);
    this.rooms = new RoomService({
      scene,
      registrations: profile.lodRegistrations,
      ...(profile.floors ? { floors: profile.floors } : {}),
      lodController: this.lodController,
      invalidator: renderer,
      getCameraPosition: () => rig.getActiveCamera().position,
      getOrbitTarget: () => rig.controls.target,
      getOrbitPivot: () => rig.getPivot(),
      getFloorViewMode: () => this.cutaways.getFloorViewMode(),
      onCurrentRoomChanged: () => {
        // Lighting is invariant to room/camera panning; never re-rank or fade lights on room change.
      },
    });

    this.walkthrough = createViewerWalkthrough({
      canvas,
      scene,
      rig,
      invalidator: renderer,
      ...(profile.walkthroughHooks ? { walkthroughHooks: profile.walkthroughHooks } : {}),
      getRoomMinYAt: (x, y, z) => this.rooms.getRoomMinYAt(x, y, z),
      getCurrentRoomId: () => this.rooms.getCurrent(),
      getRoomFloorSurface: (roomId) => this.rooms.getRegistration(roomId)?.floorSurface,
      getInteractiveMeshes: () => {
        const base = this.content?.interactiveMeshes ?? [];
        const extra = this.devices?.interactions.getSmartClickableMeshes() ?? [];
        return extra.length > 0 ? [...base, ...extra] : base;
      },
      getInteractions: () => this.devices.interactions,
      isBifoldsOpen: () => this.devices.isBifoldsOpen(),
      onInteractWithMesh: (mesh) => this.input.triggerInteractiveObject(mesh),
      onStateChanged: () => {
        this.camera.resetViewNotifyThrottle();
        renderer.resetHistory();
        this.refreshView(true);
        renderer.invalidateShadows();
        renderer.requestRender();
      },
      onPoseUpdated: () => {
        this.refreshView(false);
        renderer.requestRender();
      },
    });

    this.annotations = new AnnotationService({
      canvas,
      layers,
      orbitControls: rig.controls,
      getActiveCamera: () => rig.getActiveCamera(),
      getCameraPose: () => this.camera.getPoseSnapshot(),
      setRayFromClient: (clientX, clientY) => this.camera.setRayFromClient(clientX, clientY),
      isExcludedFromPicking: (mesh) => this.isPickExcluded(mesh),
      requestRender: () => renderer.requestRender(),
      invalidateShadows: () => renderer.invalidateShadows(),
      canUseStaticBatching: () => this.trades.getView() === 'owner',
      unbatchAll: () => this.staticScene.batchOptimizer.unbatchAll(),
      unbatchSubtree: (targetRoot) => this.staticScene.batchOptimizer.unbatchSubtree(targetRoot),
      optimizeBatches: () => this.staticScene.batchOptimizer.optimize(),
      freezeStaticMatrices: () => this.staticScene.freezeStaticMatrices(),
      captureFurnitureColliders: () => this.walkthrough.captureFurnitureColliders(),
      invalidateObstacleCache: () => this.walkthrough.invalidateObstacleCache(),
      refreshView: () => this.refreshView(true),
    });
    scene.add(...this.annotations.controller.getSceneObjects());

    this.environment = new EnvironmentLighting(
      scene,
      renderer.renderer,
      (invalidateShadows = true) => {
        this.syncSceneTimeOfDayIfChanged(this.environment.getTimeOfDay());
        this.syncDaylightVolumeGi();
        if (invalidateShadows) {
          renderer.invalidateShadows();
        }
        renderer.requestRender();
      },
      profile.location,
      profile.terrainSampler,
      profile.environment,
      profile.climate
    );
    if (profile.soundscape !== undefined) {
      this.environment.setSoundscape(profile.soundscape);
    }
    this.environment.weather.setInteriorRoomBounds(
      profile.lodRegistrations.filter((r) => r.isInterior !== false).map((r) => r.bounds)
    );
    this.setTimeOfDay('dusk');

    const content = (this.content = buildPropertySceneContent(layers, {
      profile,
      registry: this.zoneRegistry,
      lodController: this.lodController,
      ceilingCutaway: this.cutaways.isCeilingCutaway(),
    }));
    this.audioEmitters = getAttachedAudioEmitters(scene);
    applySelectiveBevelModifier(layers);
    this.devices = new DeviceService({
      content,
      profile,
      invalidator: renderer,
      startGolfSimulatorShot: () => this.startGolfSimulatorShot(),
      startFirstPersonInteractable: (interactableId) =>
        this.startFirstPersonInteractable(interactableId),
      onObjectInteraction,
    });
    if (profile.createPortalVisibilitySolver) {
      this.lodController.setPortalVisibilitySolver(
        profile.createPortalVisibilitySolver({
          sceneRoot: scene,
          lodRegistrations: profile.lodRegistrations,
          interactions: this.devices.interactions,
          bifolds: this.devices.bifolds,
        })
      );
    }
    this.devices.changed.add(() => {
      this.cutaways.invalidateLodCache();
      this.refreshView(false);
    });
    this.syncDaylightVolumeGi();
    this.environment.onSkyWeatherChanged(() => {
      this.syncDaylightVolumeGi();
    });
    this.trades = new TradeViewService(scene, renderer, (shouldBatch) => {
      const batchOpt = this.staticScene?.batchOptimizer;
      if (!batchOpt) return;
      if (!shouldBatch) {
        if (batchOpt.isBatched()) {
          batchOpt.unbatchAll();
          this.staticScene.freezeStaticMatrices();
          this.walkthrough.invalidateObstacleCache();
        }
      } else if (!batchOpt.isBatched() && !this.annotations.isActive()) {
        batchOpt.optimize();
        this.staticScene.freezeStaticMatrices();
        this.walkthrough.invalidateObstacleCache();
      }
    });
    this.staticScene = new StaticSceneService({
      scene,
      layers,
      renderer,
      lodController: this.lodController,
      lightGroups: content.lightGroups,
      indicatorMats: content.indicatorMats,
      roomSwitchLedMats: content.roomSwitchLedMats,
      interactiveMeshes: content.interactiveMeshes,
      getExtraInteractiveMeshes: () => this.devices.interactions.getSmartClickableMeshes(),
      bifoldPanels: content.bifoldPanels,
      tradeViews: this.trades.controller,
      cutaways: this.cutaways,
      collectDynamicObjects: (target) => {
        this.annotations.controller.collectDynamicObjects(target);
        this.assetInspector?.collectDynamicObjects(target);
        this.devices.collectDynamicObjects(target);
        this.environment.collectDynamicObjects(target);
        this.environment.weather.group.traverse((obj) => target.add(obj));
      },
      collectBatchExcludedObjects: (target) => {
        this.annotations.controller.collectDynamicObjects(target);
        this.assetInspector?.collectDynamicObjects(target);
        this.devices.collectBatchExcludedObjects(target);
        this.environment.collectDynamicObjects(target);
        this.environment.weather.group.traverse((obj) => target.add(obj));
      },
    });
    const batches = this.staticScene.batchOptimizer;
    this.devices.interactions.setUnbatchSubtreeHandler((targetRoot) => {
      batches.unbatchSubtree(targetRoot);
    });

    this.walkthrough.captureFurnitureColliders();
    this.environment.weather.indexExteriorMaterials(scene);
    this.syncSceneTimeOfDayIfChanged(this.environment.getTimeOfDay());
    batches.optimize();
    const budgetAnchorZone = profile.lodRegistrations.find((r) => r.isInterior !== false)?.zoneId;
    if (budgetAnchorZone) batches.setBudgetAnchorZone(budgetAnchorZone);
    this.refreshView(true);
    this.staticScene.freezeStaticMatrices();
    this.terrainSculpt = new TerrainSculptController({
      canvas,
      scene,
      controls: rig.controls,
      getSiteGround: () => this.environment.getSiteGround(),
      setRayFromClient: (clientX, clientY) => this.camera.setRayFromClient(clientX, clientY),
      isWalkthroughActive: () => this.walkthrough.isActive(),
      deactivateAnnotations: () => {
        if (this.annotations.isActive()) {
          this.annotations.setActive(false);
        }
        if (this.assetInspector?.isInspectMode()) {
          this.assetInspector.setInspectMode(false);
        }
      },
      requestRender: () => renderer.requestRender(),
    });
    this.assetInspector = new AssetInspectorController({
      scene,
      interactions: this.devices.interactions,
      setRayFromClient: (clientX, clientY) => this.camera.setRayFromClient(clientX, clientY),
      isPickExcluded: (mesh) => this.isPickExcluded(mesh),
      isWalkthroughActive: () => this.walkthrough.isActive(),
      deactivateOtherTools: () => {
        if (this.annotations.isActive()) this.annotations.setActive(false);
        if (this.terrainSculpt.isActive()) this.terrainSculpt.setActive(false);
      },
      getRoomLabel: (zoneId) => this.rooms.getRegistration(zoneId)?.zoneId,
      frameWorldBounds: (min, max, center) => {
        const span = Math.max(max.x - min.x, max.y - min.y, max.z - min.z);
        const dist = THREE.MathUtils.clamp(span * 1.85 + 0.95, 1.35, 6.5);
        const cam = rig.getActiveCamera().position;
        const horiz = new THREE.Vector3(cam.x - center.x, 0, cam.z - center.z);
        if (horiz.lengthSq() < 1e-4) horiz.set(0.5, 0, 0.86);
        horiz.normalize();
        const elev = THREE.MathUtils.degToRad(32);
        const endPos = center
          .clone()
          .addScaledVector(horiz, dist * Math.cos(elev))
          .add(new THREE.Vector3(0, dist * Math.sin(elev), 0));
        rig.useCamera(false);
        rig.startTween(endPos, center.clone(), 0.55);
        this.refreshView(false);
        renderer.requestRender();
      },
      handleInteractable: (id) => this.devices.handleInteractable(id),
      requestRender: () => renderer.requestRender(),
    });
    this.input = new PointerInput({
      canvas,
      camera: this.camera,
      annotations: this.annotations.controller,
      invalidator: renderer,
      interactiveMeshes: content.interactiveMeshes,
      getWalkthrough: () => this.walkthrough,
      isTerrainSculptActive: () => this.terrainSculpt.isActive(),
      isAssetInspectMode: () => this.assetInspector.isInspectMode(),
      hasInspectableAtClient: (x, y) => this.assetInspector.hasInspectableAtClient(x, y),
      inspectAssetAtClient: (x, y) => this.assetInspector.inspectAtClient(x, y) !== null,
      getExtraInteractiveMeshes: () => this.devices.interactions.getSmartClickableMeshes(),
      resolveSmartInteractableId: (obj) =>
        this.devices.interactions.getSmartInteractableIdForObject(obj),
      handleInteractable: (id) => {
        const ok = this.devices.handleInteractable(id);
        if (ok) this.assetInspector.refreshSnapshot();
        return ok;
      },
      toggleUfhZone: (zoneId) => this.devices.toggleUfhZone(zoneId),
      onObjectInteraction,
    });
    window.addEventListener('resize', () => this.handleResize());
    window.addEventListener('orientationchange', () => this.handleResize());
    window.visualViewport?.addEventListener('resize', () => this.handleResize());
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => this.handleResize());
      ro.observe(canvas);
    }

    // Navigation: anchor pans / orbits / zooms on the visible surface under the cursor.
    rig.setSurfacePicker((ndcX, ndcY) => this.camera.pickVisibleSurfacePointNdc(ndcX, ndcY));
    rig.controls.addEventListener('start', () => {
      this.userInteracting = true;
      renderer.requestRender();
    });
    rig.controls.addEventListener('end', () => {
      this.userInteracting = false;
      if (this.deferredShadowFrustumUpdate) {
        this.deferredShadowFrustumUpdate = false;
        this.refreshView(false);
      }
      renderer.requestRender();
    });

    this.graphics = new GraphicsService({
      renderer,
      environment: this.environment,
      lodController: this.lodController,
      batchOptimizer: batches,
      refreshView: () => this.refreshView(true),
    });
    this.walkthrough.restoreFromSessionIfActive(this.camera.getPoseSnapshot());
  }

  public handleResize(): void {
    const w = this.canvas.clientWidth;
    const h = Math.max(1, this.canvas.clientHeight);
    this.camera.rig.resize(w, h);
    this.renderer.resize(w, h);
    this.graphics.setDevicePixelRatio(window.devicePixelRatio || 1);
  }

  /** True when stationary precipitation is the sole active animation source (pace loop to 30 Hz via setTimeout). */
  public isStationaryPrecipitationOnly(): boolean {
    if (!this.environment.weather.isAnimating()) return false;
    return !(
      this.renderer.hasPendingRender() ||
      this.viewDirtyFromControls ||
      this.userInteracting ||
      this.walkthrough.isActive() ||
      this.camera.rig.isTweening() ||
      this.environment.isTransitioning() ||
      this.devices.hasActiveAnimations()
    );
  }

  public hasActiveAnimations(): boolean {
    return (
      this.renderer.hasPendingRender() ||
      this.viewDirtyFromControls ||
      this.userInteracting ||
      this.walkthrough.isActive() ||
      this.camera.rig.isTweening() ||
      this.environment.isTransitioning() ||
      this.environment.weather.isAnimating() ||
      this.devices.hasActiveAnimations() ||
      this.lastTickActive
    );
  }

  public update(dtSeconds: number): void {
    const rig = this.camera.rig;
    let cameraMoved = false;
    if (this.walkthrough.update(dtSeconds)) {
      this.renderer.requestRender();
      cameraMoved = true;
    }
    // Tween + damping in one step; coalesce high-rate OrbitControls 'change' events to 1 refreshView/frame.
    const wasTweening = rig.isTweening();
    if (!this.walkthrough.isActive() && rig.update(dtSeconds)) {
      if (wasTweening) {
        this.rooms.rebaseExplicitAnchor(rig.controls.target);
        this.viewDirtyFromControls = true;
      }
      this.renderer.requestRender();
      cameraMoved = true;
    }
    let refreshedThisFrame = false;
    if (this.viewDirtyFromControls) {
      this.viewDirtyFromControls = false;
      this.refreshView(false);
      refreshedThisFrame = true;
      cameraMoved = true;
    }
    if (cameraMoved && !refreshedThisFrame) {
      this.refreshView(false);
      refreshedThisFrame = true;
    }
    const envTransitioned = this.environment.stepTransition(dtSeconds, !cameraMoved && !this.userInteracting);
    const walkthroughActive = this.walkthrough.isActive();
    this.devices.update(dtSeconds, walkthroughActive && cameraMoved, walkthroughActive);
    if (this.devices.hasPortalOrDoorAnimations()) {
      this.cutaways.invalidateLodCache();
      this.refreshView(false);
    }
    const fadesActive = this.staticScene.batchOptimizer.stepFades(dtSeconds);
    if (fadesActive) this.renderer.requestRender();

    const clampedAudioDt = Math.max(0, Math.min(0.25, dtSeconds));
    const currentRoom = this.rooms.getCurrent();
    const isInterior = currentRoom !== null && !this.lodController.isExteriorZone(currentRoom);
    const activeCam = rig.getActiveCamera();
    this.exteriorPortalsScratch.length = 0;
    const bifoldPortal = this.devices.bifolds.getAcousticPortalState();
    if (bifoldPortal) {
      this.exteriorPortalsScratch.push(bifoldPortal);
    }
    const doorPortals = this.devices.interactions.getExteriorDoorAcousticPortals(
      this.isInteriorAcousticPoint
    );
    for (let i = 0; i < doorPortals.length; i++) {
      this.exteriorPortalsScratch.push(doorPortals[i]!);
    }

    let room: RoomAcousticProfile | undefined;
    if (isInterior && currentRoom) {
      const reg = this.rooms.getRegistration(currentRoom);
      if (reg) {
        const b = reg.obb ? reg.obb.bounds : reg.bounds;
        const volumeM3 =
          reg.volumeM3 ??
          Math.max(1, (b.maxX - b.minX) * (b.maxY - b.minY) * (b.maxZ - b.minZ));
        const inferredFloor: FloorSurfaceType | undefined =
          reg.floorSurface ??
          this.profile.walkthroughHooks?.classifyFloorSurface?.(
            currentRoom,
            activeCam.position.x,
            activeCam.position.y - STANDING_EYE_HEIGHT,
            activeCam.position.z,
            false
          );
        const primarySurface: AcousticSurfaceMaterial =
          reg.primarySurface ??
          (inferredFloor === 'stone'
            ? 'stone'
            : inferredFloor === 'turf' || inferredFloor === 'gravel'
              ? 'carpet'
              : inferredFloor === 'wood' || inferredFloor === 'stair' || inferredFloor === 'ladder'
                ? 'timber'
                : 'plaster');
        room = {
          volumeM3,
          primarySurface,
          ...(reg.absorptionCoeff !== undefined ? { absorptionCoeff: reg.absorptionCoeff } : {}),
        };
      }
    }

    const listenerPos: readonly [number, number, number] = [
      activeCam.position.x,
      activeCam.position.y,
      activeCam.position.z,
    ];
    const occlusion = computeAcousticOcclusion({
      listenerPos,
      isInterior,
      room,
      exteriorPortals: this.exteriorPortalsScratch,
    });
    soundEngine.updateListener(activeCam, isInterior, occlusion);
    this.environment.updateAmbientAudio(
      clampedAudioDt,
      isInterior,
      this.devices.isBifoldsOpen(),
      occlusion
    );
    for (let i = 0; i < this.audioEmitters.length; i++) {
      this.audioEmitters[i]!.update(clampedAudioDt, listenerPos, occlusion);
    }
    const smartAudioEmitters = this.devices.interactions.getSmartAudioEmitters();
    for (let i = 0; i < smartAudioEmitters.length; i++) {
      const em = smartAudioEmitters[i]!;
      if (!this.audioEmitters.includes(em)) {
        em.update(clampedAudioDt, listenerPos, occlusion);
      }
    }
    const weatherRendered = this.environment.updateWeatherAnimation(
      dtSeconds,
      activeCam.position,
      rig.controls.target,
      activeCam.quaternion
    );
    if (weatherRendered) {
      this.renderer.requestRender();
    }

    const activeTier = this.graphics.getActiveTier();
    const isMedium = activeTier === 'medium';
    if (!this.interactiveScrubActive && activeTier !== 'low' && this.environment.hasActiveCloudDrift()) {
      if (cameraMoved || this.userInteracting || envTransitioned || weatherRendered) {
        if (isMedium) {
          // Throttle cloud-drift & cumulus instance sync to <= 10 Hz during active touch pan/orbit
          this.panCloudDriftAccumSec += Math.min(0.25, Math.max(0, dtSeconds));
          if (this.panCloudDriftAccumSec >= 0.1) {
            this.environment.stepCloudDrift(this.panCloudDriftAccumSec);
            this.panCloudDriftAccumSec = 0;
          }
        } else {
          this.panCloudDriftAccumSec = 0;
          this.environment.stepCloudDrift(dtSeconds);
        }
      } else {
        this.panCloudDriftAccumSec = 0;
      }
    } else {
      this.panCloudDriftAccumSec = 0;
    }

    this.lastTickActive =
      cameraMoved ||
      envTransitioned ||
      fadesActive ||
      weatherRendered ||
      this.devices.hasActiveAnimations();

    const rendered = this.renderer.renderIfNeeded(
      this.scene,
      rig.getActiveCamera(),
      dtSeconds,
      cameraMoved,
      () => this.annotations.controller.prepareForRender()
    );
    if (rendered) {
      this.graphics.recordFrame(dtSeconds * 1000, cameraMoved || this.userInteracting);
    }
    if (!cameraMoved && !this.userInteracting) this.graphics.notifyIdle();
  }

  /** Re-evaluates cutaways, point-light culling, the current room and view listeners. */
  protected refreshView(forceNotifyView: boolean): void {
    const rig = this.camera.rig;
    const isWalkthrough = this.walkthrough.isActive();
    const activeCamera = rig.getActiveCamera();
    const camPos = activeCamera.position;
    const result = this.cutaways.update({
      cameraPosition: camPos,
      target: rig.controls.target,
      isOrthographic: rig.isOrthographic(),
      orthoZoom: rig.orthoCamera.zoom,
      isWalkthrough,
      camera: activeCamera,
    });
    const batches = this.staticScene.batchOptimizer;
    const upperFloorsVisible = this.layers.floorLayers.length > 1 ? this.layers.floorLayers.slice(1).some((f) => f.contentGroup.visible) : this.layers.firstFloorMeshGroup.visible;
    if (batches.syncPointLightVisibilityAndDistance(camPos, upperFloorsVisible)) {
      this.renderer.requestRender();
    }
    const shadowTarget = isWalkthrough ? camPos : rig.controls.target;
    const shadowDistM = isWalkthrough
      ? 10.0
      : rig.isOrthographic()
        ? Math.max(12.0, 48.0 / Math.max(0.25, rig.orthoCamera.zoom))
        : camPos.distanceTo(rig.controls.target);
    const activeTier = this.graphics?.getActiveTier() ?? 'high';
    const deferPanShadowBake = this.userInteracting && activeTier === 'medium';
    if (deferPanShadowBake) {
      this.deferredShadowFrustumUpdate = true;
    }
    const shadowFrustumMoved =
      this.environment && activeTier !== 'low' && !deferPanShadowBake
        ? this.environment.updateShadowFrustumForCamera(shadowTarget, shadowDistM, isWalkthrough)
        : false;
    if (result.shadowsDirty || shadowFrustumMoved) this.renderer.invalidateShadows();
    if (result.needsRender || shadowFrustumMoved) this.renderer.requestRender();
    this.rooms.updateFromView(isWalkthrough, isWalkthrough ? camPos : rig.controls.target);
    this.camera.notifyView(forceNotifyView);
  }

  private isPickExcluded(mesh: THREE.Mesh): boolean {
    return (
      mesh.geometry === this.content.glowPoolGeometry ||
      Boolean((mesh.userData as Record<string, unknown> | undefined)?.['excludeFromPick'])
    );
  }

  private startGolfSimulatorShot(): void {
    const cutsceneSpawn = this.profile.cutsceneEntrySpawns?.['golfSimulatorShot'];
    if (!this.walkthrough.isActive()) {
      if (this.annotations.isActive()) this.annotations.controller.setAnnotationMode(false);
      this.renderer.resetHistory();
      this.walkthrough.enter(this.camera.getPoseSnapshot(), cutsceneSpawn);
    }
    this.walkthrough.beginCutscene('golfSimulatorShot');
  }

  private startFirstPersonInteractable(_interactableId: string): void {
    const sample = this.devices.interactions.getActiveFirstPersonPose();
    if (!this.walkthrough.isActive() && sample) {
      if (this.annotations.isActive()) this.annotations.controller.setAnnotationMode(false);
      this.renderer.resetHistory();
      this.walkthrough.enter(this.camera.getPoseSnapshot(), {
        position: sample.footPosition,
        yawDeg: THREE.MathUtils.radToDeg(sample.yawRad),
      });
    }
  }

  /** Re-frames the camera on the current room (or the default overview). */
  public recenterView(): void {
    const current = this.rooms.getCurrent();
    const reg = current ? this.rooms.getRegistration(current) : undefined;
    if (!reg || this.walkthrough.isActive()) {
      this.camera.flyToPreset('top');
      return;
    }
    const b = reg.bounds;
    this.renderer.resetHistory();
    this.camera.rig.useCamera(false);
    this.camera.rig.frameBounds(b);
    this.rooms.rebaseExplicitAnchor(new THREE.Vector3((b.minX + b.maxX) / 2, b.minY, (b.minZ + b.maxZ) / 2));
    this.renderer.requestRender();
  }

  public setFloorViewMode(mode: FloorViewMode): void {
    this.cutaways.setFloorViewMode(mode);
    this.refreshView(false);
    if (this.cutaways.doesCutawayAffectShadows()) {
      this.renderer.invalidateShadows();
    }
    this.renderer.requestRender();
  }

  public toggleCeilingCutaway(): boolean {
    const next = this.cutaways.toggleCeilingCutaway();
    this.refreshView(false);
    if (this.cutaways.doesCutawayAffectShadows()) {
      this.renderer.invalidateShadows();
    }
    this.renderer.requestRender();
    return next;
  }

  public setWalkthroughMode(enabled: boolean, spawnId?: string): boolean {
    this.renderer.resetHistory();
    if (enabled) {
      if (this.annotations.isActive()) this.annotations.controller.setAnnotationMode(false);
      const spawn = spawnId ? this.walkthrough.getSpawns().find((s) => s.id === spawnId) : undefined;
      this.walkthrough.enter(this.camera.getPoseSnapshot(), spawn);
      this.refreshView(true);
      this.renderer.requestRender();
      return true;
    }
    const savedPose = this.walkthrough.exit();
    if (savedPose) this.camera.flyToCameraPose(savedPose);
    return false;
  }

  private syncDaylightVolumeGi(): void {
    if (!this.devices) return;
    const gi = this.environment.getDaylightGiState();
    this.devices.circuitLighting.bakedVolume.setDaylightState(gi.strength, gi.tint);
  }

  private syncSceneTimeOfDayIfChanged(mode: TimeOfDay): void {
    if (!this.devices || !this.staticScene) return;
    if (this.appliedSceneTimeOfDay === mode) return;
    this.appliedSceneTimeOfDay = mode;
    this.devices.setTimeOfDay(mode);
    this.staticScene.batchOptimizer.setTimeOfDay(mode);
    this.syncDaylightVolumeGi();
  }

  private enterInteractiveScrubMode(): void {
    if (this.interactiveScrubActive) return;
    this.interactiveScrubActive = true;
    this.staticScene?.setInteractiveScrubShadowCasters(true);
    this.environment.setInteractiveScrubShadow(true);
    this.renderer.post.setInteractiveScrubActive(true);
    this.renderer.requestRender();
  }

  private scheduleInteractiveScrubSettle(delayMs: number): void {
    if (this.interactiveScrubSettleTimer !== null) {
      clearTimeout(this.interactiveScrubSettleTimer);
    }
    this.interactiveScrubSettleTimer = setTimeout(() => {
      this.interactiveScrubSettleTimer = null;
      this.interactiveScrubPointerHeld = false;
      this.settleInteractiveScrubMode();
    }, delayMs);
  }

  private settleInteractiveScrubMode(): void {
    if (this.interactiveScrubSettleTimer !== null) {
      clearTimeout(this.interactiveScrubSettleTimer);
      this.interactiveScrubSettleTimer = null;
    }
    if (this.trailingShadowTimer !== null) {
      clearTimeout(this.trailingShadowTimer);
      this.trailingShadowTimer = null;
    }
    this.interactiveScrubPointerHeld = false;
    if (!this.interactiveScrubActive) return;
    this.interactiveScrubActive = false;
    this.staticScene?.setInteractiveScrubShadowCasters(false);
    this.environment.setInteractiveScrubShadow(false);
    this.renderer.post.setInteractiveScrubActive(false);
    const hasSunShadow = this.environment.hasActiveSunShadow();
    this.environment.flushShadowUpdate();
    this.syncSceneTimeOfDayIfChanged(this.environment.getTimeOfDay());
    this.syncDaylightVolumeGi();
    for (const cb of this.scrubSettledListeners) {
      cb();
    }
    if (hasSunShadow) {
      this.lastScrubShadowBakeMs =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
      this.renderer.invalidateShadows();
    }
    this.renderer.requestRender();
  }

  private noteScrubActivity(): void {
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const prevMs = this.lastProgrammaticScrubMs;
    this.lastProgrammaticScrubMs = nowMs;
    if (this.interactiveScrubActive) {
      this.scheduleInteractiveScrubSettle(this.interactiveScrubPointerHeld ? 15000 : 140);
      return;
    }
    if (nowMs - prevMs <= 130) {
      this.enterInteractiveScrubMode();
      this.scheduleInteractiveScrubSettle(140);
    }
  }

  public beginInteractiveScrub(holdUntilEnd = false): void {
    if (holdUntilEnd) {
      this.interactiveScrubPointerHeld = true;
    }
    this.enterInteractiveScrubMode();
    this.scheduleInteractiveScrubSettle(this.interactiveScrubPointerHeld ? 15000 : 140);
  }

  public endInteractiveScrub(): void {
    this.settleInteractiveScrubMode();
  }

  public isInteractiveScrubbing(): boolean {
    return this.interactiveScrubActive;
  }

  public onInteractiveScrubSettled(cb: () => void): () => void {
    this.scrubSettledListeners.add(cb);
    return () => {
      this.scrubSettledListeners.delete(cb);
    };
  }

  public setTimeOfDay(mode: TimeOfDay): void {
    if (this.trailingShadowTimer !== null) {
      clearTimeout(this.trailingShadowTimer);
      this.trailingShadowTimer = null;
    }
    this.settleInteractiveScrubMode();
    this.environment.setTimeOfDay(mode);
    this.syncSceneTimeOfDayIfChanged(mode);
    this.renderer.invalidateShadows();
    this.renderer.requestRender();
  }

  public setSolarDateTime(input: SolarDateTimeInput): SkyWeatherSnapshot {
    if (this.trailingShadowTimer !== null) {
      clearTimeout(this.trailingShadowTimer);
      this.trailingShadowTimer = null;
    }
    this.noteScrubActivity();
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const shadowIntervalMs = 16.0;
    const elapsedSinceShadowMs = nowMs - this.lastScrubShadowBakeMs;
    const bakeShadowNow = !this.interactiveScrubActive || elapsedSinceShadowMs >= shadowIntervalMs;
    const snap = this.environment.setSolarDateTime(input, {
      updateShadowMap: bakeShadowNow,
      suppressEnvCallback: true,
    });
    if (!this.interactiveScrubActive) {
      this.syncSceneTimeOfDayIfChanged(snap.timeOfDay);
    }
    this.syncDaylightVolumeGi();
    if (!this.environment.hasActiveSunShadow()) {
      // Skip 4096x4096 directional shadow passes completely when sun/moon shadow is extinct (e.g. 100% clouds).
    } else if (bakeShadowNow) {
      this.lastScrubShadowBakeMs = nowMs;
      this.renderer.invalidateShadows();
    } else {
      const catchUpMs = Math.max(1, Math.ceil(shadowIntervalMs - elapsedSinceShadowMs));
      this.trailingShadowTimer = setTimeout(() => {
        this.trailingShadowTimer = null;
        if (!this.environment.hasActiveSunShadow()) return;
        this.lastScrubShadowBakeMs =
          typeof performance !== 'undefined' ? performance.now() : Date.now();
        this.environment.flushShadowUpdate();
        this.renderer.invalidateShadows();
        this.renderer.requestRender();
      }, catchUpMs);
    }
    this.renderer.requestRender();
    return snap;
  }

  public setSeason(season: SeasonSelection): SkyWeatherSnapshot {
    if (this.trailingShadowTimer !== null) {
      clearTimeout(this.trailingShadowTimer);
      this.trailingShadowTimer = null;
    }
    this.settleInteractiveScrubMode();
    const snap = this.environment.setSeason(season);
    this.syncSceneTimeOfDayIfChanged(snap.timeOfDay);
    this.syncDaylightVolumeGi();
    this.renderer.invalidateShadows();
    this.renderer.requestRender();
    return snap;
  }

  public getSeasonSelection(): SeasonSelection {
    return this.environment.getSeasonSelection();
  }

  public setLiveClockSync(enabled: boolean): SkyWeatherSnapshot {
    if (this.trailingShadowTimer !== null) {
      clearTimeout(this.trailingShadowTimer);
      this.trailingShadowTimer = null;
    }
    const snap = this.environment.setLiveClockSync(enabled);
    this.syncSceneTimeOfDayIfChanged(snap.timeOfDay);
    this.renderer.invalidateShadows();
    this.renderer.requestRender();
    return snap;
  }

  public getSkyWeatherSnapshot(): SkyWeatherSnapshot {
    return this.environment.getSkyWeatherSnapshot();
  }

  public onSkyWeatherChanged(cb: (snapshot: SkyWeatherSnapshot) => void): () => void {
    return this.environment.onSkyWeatherChanged(cb);
  }

  public setWeatherLiveFeed(enabled: boolean): Promise<LiveWeatherState> {
    return this.environment.weather.setLiveFeedEnabled(enabled);
  }

  public refreshLiveWeather(): Promise<LiveWeatherState> {
    return this.environment.weather.refreshLiveWeather();
  }

  public applyWeatherPreset(preset: WeatherPresetId): LiveWeatherState {
    const next = this.environment.weather.applyPreset(preset);
    return next;
  }

  public setWeatherCloudLayer(enabled: boolean, coverPct: number): LiveWeatherState {
    this.noteScrubActivity();
    const next = this.environment.weather.setCloudLayer(enabled, coverPct);
    return next;
  }

  public setWeatherPrecipitationLayer(type: PrecipitationType, intensity: number): LiveWeatherState {
    this.noteScrubActivity();
    const next = this.environment.weather.setPrecipitationLayer(type, intensity);
    return next;
  }

  public setWeatherFogLayer(enabled: boolean, intensity: number): LiveWeatherState {
    this.noteScrubActivity();
    const next = this.environment.weather.setFogLayer(enabled, intensity);
    return next;
  }

  /**
   * Pre-computes all geometry bounding volumes, uploads all procedural textures
   * to GPU VRAM, compiles shaders across all floor/roof layers, and flushes the
   * initial render pass while `#loading-screen` is still visible so there is
   * zero lag when the viewport becomes interactive.
   */
  public async warmUpForStartup(
    onProgress?: (label: string, fraction: number) => Promise<void> | void
  ): Promise<void> {
    await this.renderer.init();
    this.graphics.refreshDeviceProfile();
    this.staticScene.batchOptimizer.stepFades(0);
    this.walkthrough.warmSpatialIndices();

    const glRenderer = this.renderer.renderer;
    this.environment.bakeProceduralEnvironments(glRenderer);
    this.environment.applyTimeOfDay(this.environment.currentMinutes, this.scene);

    // Load & PMREM-bake the 512x256 HDRI upfront during #loading-screen
    //    so zero post-boot HDR fetch/decode/PMREM stalls ever occur after loading.finish().
    await onProgress?.('Loading countryside HDRI…', 0.72);
    await this.environment.preloadActiveHdr(glRenderer);

    // Upload unique scene textures (DataTextures, HDR PMREM, async images, canvases)
    //    to GPU VRAM upfront while #loading-screen is visible so zero post-boot texture uploads occur.
    await onProgress?.('Uploading PBR surface maps…', 0.80);
    const uploadedTextures = await this.uploadAllSceneTexturesUpfront();

    // Synchronize starting exterior view & matrices, then compile unique scene
    //    GPURenderPipelines (including hidden LOD0/LOD1/LOD2 rooms, cutaway walls, doors,
    //    transparent glass, DoubleSide, mirrored negative-scale, and cutaway-toggled light variants)
    //    asynchronously in parallel against the exact MSAA rgba16float PassNode target.
    await onProgress?.('Compiling GPU pipelines…', 0.88);
    const rendererCoordSys = (
      glRenderer as unknown as { coordinateSystem?: THREE.CoordinateSystem }
    ).coordinateSystem;
    const perspCam = this.camera.rig.perspCamera;
    if (rendererCoordSys !== undefined && perspCam.coordinateSystem !== rendererCoordSys) {
      perspCam.coordinateSystem = rendererCoordSys;
      perspCam.updateProjectionMatrix();
    }
    this.viewDirtyFromControls = false;
    this.refreshView(true);
    this.scene.updateMatrixWorld(true);

    const warmupGroup = this.buildFullSceneWarmupGroup();
    const temporarilyShownMaterials: THREE.Material[] = [];
    warmupGroup.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (m && m.visible === false) {
          m.visible = true;
          temporarilyShownMaterials.push(m);
        }
      }
    });
    this.scene.add(warmupGroup);
    warmupGroup.updateMatrixWorld(true);

    this.renderer.invalidateShadows();
    for (const child of this.scene.children) {
      if (child instanceof THREE.Light && child.castShadow && child.shadow) {
        child.shadow.autoUpdate = false;
        child.shadow.needsUpdate = true;
      }
    }

    await this.compileSceneAcrossTimeOfDayBuckets(perspCam);

    // Render Frame 0 (including the 4096x4096 directional shadow pass while zero-area warmup
    //    dummies are attached so all shadow-caster depth pipelines also compile upfront).
    await onProgress?.('Rendering first frame…', 0.96);
    this.renderer.invalidateShadows();
    this.renderer.requestRender();
    try {
      this.update(0.016);
    } catch (err) {
      console.warn('[warmUpForStartup] initial frame warning:', err);
    } finally {
      for (const m of temporarilyShownMaterials) {
        m.visible = false;
      }
      warmupGroup.clear();
      this.scene.remove(warmupGroup);
      for (const d of this.retainedWarmupDisposables) {
        d.dispose();
      }
      this.retainedWarmupDisposables.length = 0;
    }

    this.releaseUploadedStaticSceneCanvases(uploadedTextures);

    try {
      this.camera.pickVisibleSurfacePointNdc(0, 0);
    } catch {
      // Ignore if canvas has zero dimensions in headless tests
    }
  }

  private async compileSceneAcrossTimeOfDayBuckets(
    perspCam: THREE.PerspectiveCamera
  ): Promise<void> {
    const glRenderer = this.renderer.renderer;
    // Three.js WebGPU RenderObject hashes InstancedMesh.uuid into its material cache key, so
    // temporarily expose 1 parked zero-scale slot on dormant InstancedMeshes (e.g. volumetric clouds)
    // during compileAsync so enabling clouds/weather at runtime triggers 0 createRenderPipeline calls.
    const weatherGroup = this.environment.weather.group;
    const tempAttachedWeatherGroup = weatherGroup.parent === null;
    if (tempAttachedWeatherGroup) {
      this.scene.add(weatherGroup);
      weatherGroup.updateMatrixWorld(true);
    }
    const parkedInstanced: THREE.InstancedMesh[] = [];
    const hiddenAncestors: THREE.Object3D[] = [];
    const hiddenSet = new Set<THREE.Object3D>();
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.InstancedMesh && obj.count === 0 && obj.instanceMatrix.count > 0) {
        obj.count = 1;
        parkedInstanced.push(obj);
        let cur: THREE.Object3D | null = obj;
        while (cur) {
          if (!cur.visible && !hiddenSet.has(cur)) {
            hiddenSet.add(cur);
            hiddenAncestors.push(cur);
            cur.visible = true;
          }
          cur = cur.parent;
        }
      }
    });
    try {
      await this.renderer.post.withSceneCompileState(
        this.scene,
        perspCam,
        () =>
          this.environment.withEachEnvironmentBucketForCompile(async () => {
            const zeroOpacityMats: THREE.Material[] = [];
            for (const inst of parkedInstanced) {
              inst.count = 1;
              const mats = Array.isArray(inst.material) ? inst.material : [inst.material];
              for (const m of mats) {
                if (m && m.opacity === 0) {
                  m.opacity = 1;
                  zeroOpacityMats.push(m);
                }
              }
            }
            for (const anc of hiddenAncestors) anc.visible = true;
            try {
              await glRenderer.compileAsync(this.scene, perspCam);
            } finally {
              for (const m of zeroOpacityMats) m.opacity = 0;
            }
          }),
        true
      );
    } catch (err) {
      console.warn('[warmUpForStartup] full-scene compileAsync warning:', err);
    } finally {
      for (const inst of parkedInstanced) inst.count = 0;
      for (const anc of hiddenAncestors) anc.visible = false;
      if (tempAttachedWeatherGroup && weatherGroup.parent === this.scene) {
        this.scene.remove(weatherGroup);
      }
    }
  }

  private async uploadAllSceneTexturesUpfront(): Promise<Set<THREE.Texture>> {
    const glRenderer = this.renderer.renderer;
    const maxAnisotropy = this.renderer.getMaxAnisotropy();
    const uniqueTextures = new Set<THREE.Texture>();

    const collectTex = (val: unknown): void => {
      if (val && typeof val === 'object' && (val as THREE.Texture).isTexture) {
        uniqueTextures.add(val as THREE.Texture);
      }
    };

    collectTex(this.scene.environment);
    collectTex(this.scene.background);
    for (const tex of this.environment.getRetainedEnvironmentTextures()) {
      collectTex(tex);
    }

    const collectMaterialTextures = (rawMat: THREE.Material | null | undefined): void => {
      const mat = rawMat as unknown as Record<string, unknown> | null | undefined;
      if (!mat) return;
      for (const key of Object.keys(mat)) {
        collectTex(mat[key]);
      }
    };

    const collectMeshTextures = (obj: THREE.Mesh): void => {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (let i = 0; i < mats.length; i++) {
        collectMaterialTextures(mats[i]);
      }
    };

    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Light && obj.shadow?.map?.texture) {
        collectTex(obj.shadow.map.texture);
      }
      if (obj instanceof THREE.Mesh) {
        collectMeshTextures(obj);
      }
    });
    this.staticScene.batchOptimizer.forEachDormantMaterial((mat) => {
      collectMaterialTextures(mat);
    });

    const pendingImageLoads: Promise<void>[] = [];
    for (const tex of uniqueTextures) {
      const img = tex.image as HTMLImageElement | undefined;
      if (
        typeof HTMLImageElement !== 'undefined' &&
        img instanceof HTMLImageElement &&
        !img.complete
      ) {
        pendingImageLoads.push(
          new Promise<void>((resolve) => {
            const done = (): void => {
              tex.needsUpdate = true;
              resolve();
            };
            img.addEventListener('load', done, { once: true });
            img.addEventListener('error', () => resolve(), { once: true });
          })
        );
      }
    }
    if (pendingImageLoads.length > 0) {
      await Promise.all(pendingImageLoads);
    }

    for (const tex of uniqueTextures) {
      if (
        !(tex instanceof THREE.DataTexture && tex.minFilter === THREE.LinearFilter) &&
        tex.generateMipmaps !== false &&
        tex.anisotropy < maxAnisotropy
      ) {
        tex.anisotropy = maxAnisotropy;
        tex.needsUpdate = true;
      }
      try {
        glRenderer.initTexture(tex);
      } catch {
        // Ignore placeholder/incomplete textures in headless environments
      }
    }
    return uniqueTextures;
  }

  private releaseUploadedStaticSceneCanvases(uploadedTextures: ReadonlySet<THREE.Texture>): void {
    if (typeof window !== 'undefined') {
      try {
        const params = new URLSearchParams(window.location?.search ?? '');
        if (params.get('husjsExport') === '1' || params.get('keepCanvases') === '1') {
          return;
        }
      } catch {
        // Ignore URL parsing issues in synthetic test environments
      }
    }
    const isCanvasElement = (img: unknown): img is HTMLCanvasElement =>
      typeof img === 'object' &&
      img !== null &&
      !isRecordingCanvasStub(img) &&
      typeof (img as HTMLCanvasElement).getContext === 'function' &&
      typeof (img as HTMLCanvasElement).width === 'number' &&
      typeof (img as HTMLCanvasElement).height === 'number';

    const retainedCanvases = new Set<HTMLCanvasElement>();
    const retainTextureCanvas = (val: unknown): void => {
      if (!val || typeof val !== 'object' || !(val as THREE.Texture).isTexture) return;
      const img = (val as THREE.Texture).image;
      if (isCanvasElement(img)) {
        retainedCanvases.add(img);
      }
    };
    const retainMaterialCanvases = (rawMat: THREE.Material | null | undefined): void => {
      const mat = rawMat as unknown as Record<string, unknown> | null | undefined;
      if (!mat) return;
      for (const key of Object.keys(mat)) {
        retainTextureCanvas(mat[key]);
      }
    };

    retainTextureCanvas(this.content.tvOffTexture);
    for (const tex of this.content.tvArtTextures) {
      retainTextureCanvas(tex);
    }

    const batchOpt = this.staticScene.batchOptimizer;
    const mutableMaterials = batchOpt.getMutableMaterials();
    for (const mat of mutableMaterials) {
      retainMaterialCanvases(mat);
    }

    this.scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const meshDynamic = Boolean(obj.userData?.isGolfSimulatorDynamic);
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (let i = 0; i < mats.length; i++) {
        const m = mats[i];
        if (!m) continue;
        if (meshDynamic || batchOpt.isMaterialRenderDynamic(m, mutableMaterials)) {
          retainMaterialCanvases(m);
        }
      }
    });

    const uploadedCanvases: HTMLCanvasElement[] = [];
    for (const tex of uploadedTextures) {
      if (isCanvasElement(tex.image)) {
        uploadedCanvases.push(tex.image);
      }
    }
    releaseUploadedStaticCanvases(uploadedCanvases, retainedCanvases);
  }

  private buildFullSceneWarmupGroup(): THREE.Group {
    const warmupGroup = new THREE.Group();
    warmupGroup.name = '__fullSceneShaderWarmupGroup';
    const seenSignatures = new Set<string>();
    const disposableGeometries: THREE.BufferGeometry[] = [];
    const disposableInstanced: THREE.InstancedMesh[] = [];
    const disposableMaterials: THREE.Material[] = [];

    const ENUM_NUMBER_PROPS = new Set<string>([
      'side',
      'shadowSide',
      'blending',
      'blendEquation',
      'blendEquationAlpha',
      'blendSrc',
      'blendSrcAlpha',
      'blendDst',
      'blendDstAlpha',
      'depthFunc',
      'normalMapType',
      'combine',
      'stencilFunc',
      'stencilFail',
      'stencilZFail',
      'stencilZPass',
    ]);

    const getProtoAndOwnKeys = (obj: object): string[] => {
      const keys = new Set<string>(Object.keys(obj));
      let proto = Object.getPrototypeOf(obj);
      while (proto && proto !== Object.prototype) {
        for (const descKey of Object.getOwnPropertyNames(proto)) {
          const desc = Object.getOwnPropertyDescriptor(proto, descKey);
          if (desc?.get) keys.add(descKey);
        }
        proto = Object.getPrototypeOf(proto);
      }
      return Array.from(keys).sort();
    };

    const buildMaterialProgramKey = (mat: THREE.Material): string => {
      let key = mat.userData?.['excludeIndoorLighting'] === true ? '|excl1|' : '|excl0|';
      const rec = mat as unknown as Record<string, unknown>;
      for (const prop of getProtoAndOwnKeys(mat)) {
        if (/^(is[A-Z]|_)|^(id|visible|version|uuid|name|opacity|userData|defines)$/.test(prop)) {
          continue;
        }
        const val = rec[prop];
        if (val === null || val === undefined) {
          key += String(val) + ',';
        } else if (typeof val === 'number') {
          if (ENUM_NUMBER_PROPS.has(prop)) {
            key += String(val) + ',';
          } else {
            key += (val !== 0 ? '1' : '0') + ',';
          }
        } else if (typeof val === 'object') {
          if ((val as THREE.Texture).isTexture) {
            const t = val as THREE.Texture;
            const wrapR = (t as unknown as { wrapR?: number }).wrapR ?? '';
            key += `{${t.mapping}:${t.magFilter}:${t.minFilter}:${t.wrapS}:${t.wrapT}:${wrapR}:${t.colorSpace}},`;
          } else if ((val as { isNode?: boolean; id?: number }).isNode) {
            key += `{N:${(val as { id?: number }).id ?? ''}},`;
          } else if ((val as THREE.Color).isColor) {
            const c = val as THREE.Color;
            key += c.r !== 0 || c.g !== 0 || c.b !== 0 ? 'C1,' : 'C0,';
          } else {
            key += '{},';
          }
        } else if (typeof val !== 'function') {
          key += String(val) + ',';
        }
      }
      return key;
    };

    const buildGeometryProgramKey = (srcGeo: THREE.BufferGeometry): string => {
      let key = srcGeo.index ? 'idx|' : 'noidx|';
      for (const name of Object.keys(srcGeo.attributes).sort()) {
        const attr = srcGeo.attributes[name]!;
        const stride = (attr as unknown as { data?: { stride?: number } }).data?.stride ?? '';
        const offset = (attr as unknown as { offset?: number }).offset ?? '';
        const ctor = attr.array?.constructor?.name ?? '';
        key += `${name}:${ctor}:${stride}:${offset}:${attr.itemSize}:${attr.normalized ? 'n' : ''},`;
      }
      return key;
    };

    const dummyGeoByLayout = new Map<string, THREE.BufferGeometry>();
    const getOrCreateZeroAreaDummyGeometry = (
      srcGeo: THREE.BufferGeometry,
      layoutKey: string
    ): THREE.BufferGeometry => {
      const existing = dummyGeoByLayout.get(layoutKey);
      if (existing) return existing;
      const g = new THREE.BufferGeometry();
      for (const name of Object.keys(srcGeo.attributes).sort()) {
        const srcAttr = srcGeo.attributes[name]!;
        const itemSize = srcAttr.itemSize;
        const ArrayCtor =
          (srcAttr.array?.constructor as new (len: number) => THREE.TypedArray) ?? Float32Array;
        // Zero-area degenerate triangle (0,0,0)-(0,0,0)-(0,0,0) compiles exact vertex/fragment/depth
        // GPURenderPipelines while rasterizing 0 fragments in both color and 4096 shadow passes!
        const typedArr = new ArrayCtor(3 * itemSize);
        g.setAttribute(name, new THREE.BufferAttribute(typedArr, itemSize, srcAttr.normalized));
      }
      if (!g.getAttribute('position')) {
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
      }
      if (srcGeo.index) {
        g.setIndex([0, 1, 2]);
      }
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1);
      g.boundingBox = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0));
      disposableGeometries.push(g);
      dummyGeoByLayout.set(layoutKey, g);
      return g;
    };

    interface WarmupDescriptor {
      readonly geometry: THREE.BufferGeometry;
      readonly isInstanced: boolean;
      readonly hasInstColor: boolean;
      readonly receiveShadow: boolean;
      readonly castShadow: boolean;
      readonly frontFaceCW: boolean;
      readonly name: string;
    }

    const registerWarmupMaterial = (desc: WarmupDescriptor, mat: THREE.Material): void => {
      const srcGeo = desc.geometry;
      if (!(srcGeo instanceof THREE.BufferGeometry)) return;
      const layoutKey = buildGeometryProgramKey(srcGeo);
      const sig = `${buildMaterialProgramKey(mat)}|${layoutKey}|${desc.isInstanced ? 1 : 0}|${desc.hasInstColor ? 1 : 0}|${desc.receiveShadow ? 1 : 0}|${desc.castShadow ? 1 : 0}|${desc.frontFaceCW ? 1 : 0}`;
      if (seenSignatures.has(sig)) return;
      seenSignatures.add(sig);

      const dummyGeo = getOrCreateZeroAreaDummyGeometry(srcGeo, layoutKey);
      let dummyMesh: THREE.Mesh;
      if (desc.isInstanced) {
        const inst = new THREE.InstancedMesh(dummyGeo, mat, 1);
        inst.setMatrixAt(0, new THREE.Matrix4());
        if (desc.hasInstColor) {
          inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array([1, 1, 1]), 3);
        }
        disposableInstanced.push(inst);
        dummyMesh = inst;
      } else {
        dummyMesh = new THREE.Mesh(dummyGeo, mat);
      }
      dummyMesh.receiveShadow = desc.receiveShadow;
      dummyMesh.castShadow = desc.castShadow;
      dummyMesh.name = desc.name;
      dummyMesh.frustumCulled = false;
      if (desc.frontFaceCW) {
        dummyMesh.scale.x = -1;
      }
      warmupGroup.add(dummyMesh);
    };

    const registerMaterialAndRuntimeVariants = (
      desc: WarmupDescriptor,
      mat: THREE.Material
    ): void => {
      registerWarmupMaterial(desc, mat);

      // Materials whose transparency/depthWrite toggles at runtime (ceiling cutaway light fade or
      // sliding golf bag fade) need BOTH opaque and transparent blend GPURenderPipelines precompiled.
      const matU = mat.userData as Record<string, unknown> | undefined;
      if (
        matU?.cutawayLightOpacity !== undefined ||
        matU?.isDynamicGolfBagMaterial === true
      ) {
        const toggled = mat.clone();
        toggled.userData = { ...mat.userData };
        toggled.transparent = !mat.transparent;
        toggled.depthWrite = !toggled.transparent;
        toggled.opacity = toggled.transparent ? 0.2 : 1.0;
        disposableMaterials.push(toggled);
        registerWarmupMaterial(desc, toggled);
      }
    };

    const registerDescriptorMaterials = (
      desc: WarmupDescriptor,
      mat: THREE.Material | THREE.Material[]
    ): void => {
      if (Array.isArray(mat)) {
        for (let i = 0; i < mat.length; i++) {
          if (mat[i]) registerMaterialAndRuntimeVariants(desc, mat[i]!);
        }
      } else if (mat) {
        registerMaterialAndRuntimeVariants(desc, mat);
      }
    };

    this.scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      if (obj.userData?.isShadowPassHook || obj.userData?.isMergedSourceMesh) return;
      if (obj instanceof THREE.InstancedMesh && obj.instanceMatrix.count === 0) return;
      const isInstanced = obj instanceof THREE.InstancedMesh;
      registerDescriptorMaterials(
        {
          geometry: obj.geometry,
          isInstanced,
          hasInstColor: isInstanced && Boolean(obj.instanceColor),
          receiveShadow: obj.receiveShadow,
          castShadow: obj.castShadow,
          frontFaceCW: obj.matrixWorld.determinant() < 0,
          name: obj.name || obj.type,
        },
        obj.material
      );
    });
    for (const entry of this.staticScene.batchOptimizer.getDormantWarmupEntries()) {
      registerDescriptorMaterials(
        {
          geometry: entry.geometry,
          isInstanced: false,
          hasInstColor: false,
          receiveShadow: entry.receiveShadow,
          castShadow: entry.castShadow,
          frontFaceCW: entry.frontFaceCW,
          name: entry.name,
        },
        entry.material
      );
    }

    this.retainedWarmupDisposables.push(
      ...disposableInstanced,
      ...disposableGeometries,
      ...disposableMaterials
    );
    return warmupGroup;
  }

  public dispose(): void {
    if (this.trailingShadowTimer !== null) {
      clearTimeout(this.trailingShadowTimer);
      this.trailingShadowTimer = null;
    }
    if (this.interactiveScrubSettleTimer !== null) {
      clearTimeout(this.interactiveScrubSettleTimer);
      this.interactiveScrubSettleTimer = null;
    }
    for (let i = 0; i < this.audioEmitters.length; i++) {
      this.audioEmitters[i]!.dispose();
    }
    const smartEmitters = this.devices.interactions.getSmartAudioEmitters();
    for (let i = 0; i < smartEmitters.length; i++) {
      smartEmitters[i]!.dispose();
    }
    this.assetInspector.dispose();
    this.terrainSculpt.dispose();
    this.environment.dispose();
  }
}
