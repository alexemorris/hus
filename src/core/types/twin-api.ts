import type { TwinAssetInspectorApi } from '../assets/asset-metadata.ts';
/**
 * TwinApi — the UI-facing facade over the 3D engine and the smart-home
 * integrations.
 *
 * UI code (src/ui/**, except src/ui/dev/**) must talk to the twin ONLY through
 * this interface, imported type-only. It deliberately references nothing but
 * src/core types so the UI never depends on three.js, the engine or the KNX
 * emulator. The concrete adapter lives in `create-twin-api.ts`.
 *
 * Conventions:
 * - `on*` / `subscribe` methods return an unsubscribe function and support
 *   any number of listeners.
 * - Methods that change state return the resulting state where useful.
 */
import type { SeasonSelection } from './environment-hdri.ts';
import type { LodPolicyMode, RoomLodDiagnostics } from '../entities.ts';
import type { TerrainStamp } from '../geo/terrain-modifiers.ts';
import type { TerrainSculptMode, TerrainSculptSnapshot } from '../geo/terrain-sculpt.ts';
import type {
  CircuitConfig,
  CircuitId,
  CircuitLevels,
  KNXBusEvent,
  KNXTransportMode,
  KNXTransportStatus,
  RoomMotionSensorId,
  ScenePreset,
} from './knx.ts';
import type {
  AnnotationToolMode,
  CameraPresetName,
  FloorViewMode,
  GizmoTransformMode,
  LiveMeasurePreviewState,
  SceneAnnotationHit,
  SceneAnnotationRecord,
  SceneCameraPoseSnapshot,
  SceneObjectTransformAnnotation,
  TimeOfDay,
  Vec3Tuple,
} from './scene.ts';
import type { FloorId, RoomBoundingBox, RoomZoneId } from './topology.ts';
import type { KnxZoneScene, KnxZoneState, LightingLayerKind } from './knx-zones.ts';
import type {
  GraphicsMode,
  GraphicsTier,
  PaintSheen,
  RoomFinishSpec,
  RoomManifestEntry,
  RoomPaintSurfaceSpec,
  TradeView,
} from './twin-ux.ts';

export type { PaintSheen, RoomFinishSpec, RoomPaintSurfaceSpec };
import type {
  LiveWeatherState,
  PrecipitationType,
  SkyWeatherSnapshot,
  SolarDateTimeInput,
  WeatherPresetId,
} from './solar-weather.ts';

/** Function returned by every subscription; call it to stop listening. */
export type Unsubscribe = () => void;

/** Camera + floor state (plain data, safe to keep). */
export interface TwinViewState {
  readonly cameraPosition: Vec3Tuple;
  readonly target: Vec3Tuple;
  readonly isOrthographic: boolean;
  readonly orthoZoom: number;
  readonly floorViewMode: FloorViewMode;
}

export interface TwinCameraApi {
  flyToPreset(preset: CameraPresetName | string): void;
  flyToCameraPose(pose: SceneCameraPoseSnapshot): void;
  /** Frames a room (keeps the viewing direction) and selects it. */
  flyToRoom(zoneId: RoomZoneId): void;
  /** Frames arbitrary room bounds on the given floor. */
  flyToBounds(bounds: RoomBoundingBox, floor: FloorViewMode): void;
  /** Re-frames the current room (or the overview). */
  recenter(): void;
  getPose(): SceneCameraPoseSnapshot;
  getViewState(): TwinViewState;
  onViewChanged(listener: (view: TwinViewState) => void): Unsubscribe;
  /** Zero-allocation True-North camera compass bearing (0..360° CW from North). */
  getCompassBearingDeg(): number;
  onCompassBearingChanged(listener: (bearingDeg: number) => void): Unsubscribe;
  /** Double-click on visible geometry outside annotation mode (world point). */
  onSurfaceDoubleClick(listener: (point: Vec3Tuple) => void): Unsubscribe;
  /**
   * Projects a world point with the live active camera (orbit, ortho or
   * walkthrough) to CSS pixels relative to the viewport canvas.
   */
  projectToScreen(point: Vec3Tuple): TwinScreenPoint;
  /** Enables 1-finger touch pan instead of 1-finger orbit (ideal for mobile/tablet thumb panning). */
  setSingleFingerPan(enabled: boolean): void;
  isSingleFingerPan(): boolean;
}

export interface TwinScreenPoint {
  readonly x: number;
  readonly y: number;
  /** False when behind the camera or outside the view frustum. */
  readonly visible: boolean;
}

/** One storey of the property, as offered by the floor switcher. */
export interface TwinFloorInfo {
  readonly id: FloorViewMode;
  readonly label: string;
  /** Finished floor elevation (m). */
  readonly elevationY?: number;
  readonly ceilingHeight?: number;
}

export interface TwinFloorsApi {
  /** The property's storeys, lowest first (excludes the synthetic `'all'` mode). */
  list(): readonly TwinFloorInfo[];
  /** Display name of the property. */
  propertyName?(): string;
  getMode(): FloorViewMode;
  setMode(mode: FloorViewMode): void;
  isCeilingCutaway(): boolean;
  setCeilingCutaway(cutaway: boolean): void;
  toggleCeilingCutaway(): boolean;
}

/** Lightweight room hit-test result (focus model). */
export interface TwinRoomHit {
  readonly zoneId: RoomZoneId;
  readonly label: string;
  readonly floorId: FloorId;
  readonly bounds: RoomBoundingBox;
}

export interface TwinRoomNavGroup {
  readonly id: string;
  readonly label: string;
  readonly rooms: readonly RoomManifestEntry[];
}

export interface TwinRoomsApi {
  getCurrent(): RoomZoneId | null;
  onChanged(listener: (zoneId: RoomZoneId | null) => void): Unsubscribe;
  /** Explicitly selects (and focuses LOD on) a room without moving the camera. */
  select(zoneId: RoomZoneId): void;
  /** Subtle floor tint/outline for a room; `null` clears. */
  highlight(zoneId: RoomZoneId | null): void;
  /** Room context manifest (lights, scenes, devices) in navigator order. */
  list(): readonly RoomManifestEntry[];
  /** Navigator grouping (house ground / first, outbuildings, grounds). */
  navTree(): readonly TwinRoomNavGroup[];
  /** Per-room lighting presets expressed as circuit levels. */
  getLevelScenes(zoneId: RoomZoneId): readonly KnxZoneScene[];
  isInterior(zoneId: RoomZoneId): boolean;
  getManifest(zoneId: RoomZoneId): RoomManifestEntry | undefined;
  getLabel(zoneId: RoomZoneId): string;
  getBounds(zoneId: RoomZoneId): RoomBoundingBox | null;
  /** Room containing a world point (optionally constrained to a floor). */
  findAt(point: Vec3Tuple, floorId?: FloorId): TwinRoomHit | null;
}

export interface TwinRoomMotionSensor {
  readonly id: RoomMotionSensorId;
  readonly label: string;
  readonly occupied: boolean;
}

/** One circuit (actuator channel) inside a lighting zone. */
export interface TwinZoneCircuit {
  readonly id: CircuitId;
  readonly label: string;
  readonly kind: LightingLayerKind;
  readonly dimmable: boolean;
}

/** Circuits of one fitting type within a zone (Pendants, Downlights, Wall lights …). */
export interface TwinLightingLayer {
  readonly kind: LightingLayerKind;
  readonly label: string;
  readonly circuits: readonly TwinZoneCircuit[];
}

export interface TwinZoneScene {
  /** Index for {@link TwinZoneLightingApi.recallScene} / `KnxZoneState.sceneIndex`. */
  readonly index: number;
  readonly id: string;
  readonly label: string;
}

/** A lighting zone (one per room; `id` is the room's zone id). */
export interface TwinLightingZone {
  readonly id: RoomZoneId;
  readonly name: string;
  readonly circuitIds: readonly CircuitId[];
  /** Non-empty layers in presentation order. */
  readonly layers: readonly TwinLightingLayer[];
  readonly scenes: readonly TwinZoneScene[];
}

export interface TwinPresenceDetector {
  readonly pa: string;
  readonly name: string;
  readonly zoneId: RoomZoneId;
  readonly detected: boolean;
  readonly lastSeenSimSec: number | null;
}

export interface TwinZoneSwitchGang {
  readonly gang: number;
  readonly zoneId: RoomZoneId;
  readonly label: string;
  /** Status LED: lit while the gang's zone is not `off`. */
  readonly ledOn: boolean;
}

export interface TwinZoneSwitch {
  readonly pa: string;
  readonly name: string;
  readonly location: string;
  readonly mountedInZoneId: RoomZoneId;
  readonly gangs: readonly TwinZoneSwitchGang[];
}

export interface TwinZoneLightingApi {
  /** `knx` when the controller models zones natively; `derived` = per-room fallback. */
  source(): 'knx' | 'derived';
  list(): readonly TwinLightingZone[];
  get(zoneId: RoomZoneId): TwinLightingZone | undefined;
  getState(zoneId: RoomZoneId): KnxZoneState;
  recallScene(zoneId: RoomZoneId, sceneIndex: number): void;
  setFull(zoneId: RoomZoneId): void;
  setNight(zoneId: RoomZoneId): void;
  setOff(zoneId: RoomZoneId): void;
  /** Fires after any KNX state change (any zone's state / presence may have changed). */
  onStateChanged(listener: () => void): Unsubscribe;
  presenceDetectors(zoneId?: RoomZoneId): readonly TwinPresenceDetector[];
  /** Wall push-buttons (all, or those mounted in a room) with live LED feedback. */
  switches(mountedInZoneId?: RoomZoneId): readonly TwinZoneSwitch[];
}

export interface TwinLightingApi {
  /** Per-room lighting zones (layers, zone scenes, Full / Night / Off, presence). */
  readonly zones: TwinZoneLightingApi;
  circuits(): readonly CircuitConfig[];
  isKnownCircuit(circuitId: string): circuitId is CircuitId;
  getLiveLevels(): Readonly<CircuitLevels>;
  getTargetLevels(): Readonly<CircuitLevels>;
  toggleCircuit(circuitId: CircuitId): void;
  /** `pct` is clamped to 0–100 and ramps at the actuator's dimming speed. */
  setCircuitLevel(circuitId: CircuitId, pct: number): void;
  /** Applies many levels at once (unknown / omitted circuits untouched). */
  applyLevels(levels: Readonly<Partial<Record<CircuitId, number>>>): void;
  allOff(): void;
  /** KNX scene recall from a wall switch (`pa` defaults to the kitchen switch). */
  recallScene(sceneNumber: number, pa?: string): void;
  scenes(): readonly ScenePreset[];
  getActiveSceneIndex(): number;
  /** Any KNX bus event (state changes, telegrams, transport). */
  subscribe(listener: (event: KNXBusEvent) => void): Unsubscribe;
  /** Live levels changed (throttled to the dimming frame loop). */
  onLevelsChanged(listener: (levels: Readonly<CircuitLevels>) => void): Unsubscribe;
  getTimeOfDay(): TimeOfDay;
  /** Sets sky/sun + KNX ambient lux to match. */
  setTimeOfDay(tod: TimeOfDay): void;
  getAmbientLux(): number;
  setAmbientLux(lux: number): void;
  roomMotionSensors(): readonly TwinRoomMotionSensor[];
  toggleRoomMotion(sensorId: RoomMotionSensorId): boolean;
  isRoomNightDimActive(circuitId: CircuitId): boolean;
  /** Room rocker switch emulation (short press up/down, long-press hold down). */
  pressZoneSwitch(zoneId: RoomZoneId, direction: 'up' | 'down', longPress?: boolean): void;
  getTransport(): { readonly mode: KNXTransportMode; readonly status: KNXTransportStatus };
}

export interface TwinUfhZone {
  readonly id: string;
  readonly name: string;
  readonly shortName: string;
  readonly manifoldLabel?: string;
  readonly roomZones: readonly RoomZoneId[];
  readonly heatingOn: boolean;
  readonly targetTempC: number;
  /** Human-readable warm-up estimate, if the home models it. */
  readonly warmupLabel?: string;
}

export interface TwinDevicesApi {
  /** Generic device action (doors, gates, golf shot, …) by stable interactable id. */
  handleInteractable(interactableId: string): boolean;
  /** Fires after any device state change (gates, bifolds, TV, UFH, motion). */
  onChanged(listener: () => void): Unsubscribe;

  isGatesOpen(): boolean;
  isGatesMoving(): boolean;
  getGatesStatusLabel(): string;
  /** Returns true when the gates are now opening. */
  toggleGates(): boolean;

  isBifoldsOpen(): boolean;
  toggleBifolds(): boolean;

  isTvArtMode(): boolean;
  getTvArtTitle(): string;
  cycleTvArt(): void;

  isCourtyardLightOn(): boolean;
  getCourtyardModeLabel(): string;
  pressCourtyardSwitch(): void;

  hasUfh(): boolean;
  ufhZones(): readonly TwinUfhZone[];
  ufhZoneForRoom(zoneId: RoomZoneId): TwinUfhZone | undefined;
  toggleUfhZone(ufhZoneId: string): boolean;
  setAllUfhZones(on: boolean): void;
  isUfhLayerVisible(): boolean;
  setUfhLayerVisible(visible: boolean): void;
  toggleUfhLayer(): boolean;
}

export interface TwinGraphicsStats {
  readonly fps: number;
  readonly p95Ms: number;
  readonly tier: GraphicsTier;
  readonly pixelRatio: number;
}

export interface TwinGraphicsApi {
  /** Persisted by the engine (single source of truth). */
  getMode(): GraphicsMode;
  setMode(mode: GraphicsMode): void;
  /** Cheap (O(samples) over a ~2 s window); fine to poll at 1–4 Hz. */
  getStats(): TwinGraphicsStats;
  /** Short user-facing messages (e.g. automatic quality step-down). */
  onToast(listener: (message: string) => void): Unsubscribe;
  isSsaoEnabled(): boolean;
  setSsaoEnabled(enabled: boolean): void;
  isFxaaEnabled(): boolean;
  setFxaaEnabled(enabled: boolean): void;
  isMotionBlurEnabled(): boolean;
  setMotionBlurEnabled(enabled: boolean): void;
}

export interface TwinTradesApi {
  getView(): TradeView;
  setView(view: TradeView): void;
  onChanged(listener: (view: TradeView) => void): Unsubscribe;
  /** CSV schedule of service points for a trade (defaults to the current view). */
  exportServiceSchedule(view?: TradeView): string;
}

export interface TwinWalkthroughSpawn {
  readonly id: string;
  readonly label: string;
  readonly zoneId: RoomZoneId;
}

/** Snapshot of the first-person walker for overlays (plain data). */
export interface TwinWalkthroughState {
  readonly active: boolean;
  /** Interaction prompt for the object under the crosshair (e.g. "Open Door"), if any. */
  readonly prompt: string | null;
  readonly crouched: boolean;
  readonly pointerLocked: boolean;
  readonly fovDeg: number;
}

export interface TwinWalkthroughApi {
  isActive(): boolean;
  getState(): TwinWalkthroughState;
  /** Fires on enter/exit and whenever the prompt, crouch, pointer lock or FOV changes. */
  onStateChanged(listener: (state: TwinWalkthroughState) => void): Unsubscribe;
  /** Uses the object under the crosshair (same as the F key). */
  interact(): boolean;
  toggleCrouch(): boolean;
  /** Trigger a jump or stair/ledge climb in first-person walkthrough mode. */
  jump(): void;
  /** Sets the virtual left thumbstick movement vector (-1..1 strafe & forward) for touch walkthrough. */
  setTouchMove(strafe: number, forward: number, sprint?: boolean): void;
  /** Sets the virtual right thumbstick look vector (-1..1 yaw & pitch) for touch walkthrough. */
  setTouchLook(yaw: number, pitch: number): void;
  /** Requests pointer lock for free mouse look (must be called from a user gesture). */
  requestMouseLook(): void;
  enter(spawnId?: string): void;
  exit(): void;
  toggle(spawnId?: string): boolean;
  spawns(): readonly TwinWalkthroughSpawn[];
  teleport(spawnId: string): boolean;
  onChanged(listener: (active: boolean) => void): Unsubscribe;
  /**
   * Walker foot position (world metres; eye height already removed) and the room it stands in.
   * Throttled to ~5 Hz and only emitted while the walkthrough is active.
   */
  onFootPositionChanged(listener: (pos: Vec3Tuple, zoneId: RoomZoneId | null) => void): Unsubscribe;
}

export interface TwinMovableTarget {
  readonly uuid: string;
  readonly label: string;
  readonly kind: 'group' | 'mesh';
}

export interface TwinObjectTransformEvent {
  readonly baseHit: SceneAnnotationHit | null;
  readonly transform: SceneObjectTransformAnnotation | null;
  readonly candidates: readonly TwinMovableTarget[];
  readonly commitToStore: boolean;
}

export interface TwinMeasureCompleteEvent {
  readonly startHit: SceneAnnotationHit;
  readonly endHit: SceneAnnotationHit;
  readonly snappedEndPoint: Vec3Tuple;
}

export interface TwinNotesApi {
  // Tool state
  isActive(): boolean;
  setActive(enabled: boolean): void;
  toggleActive(): boolean;
  getToolMode(): AnnotationToolMode;
  setToolMode(tool: AnnotationToolMode): void;
  getGizmoMode(): GizmoTransformMode;
  setGizmoMode(mode: GizmoTransformMode): void;
  getMeasureAxisSnap(): boolean;
  setMeasureAxisSnap(enabled: boolean): void;
  cancelMeasurement(): void;

  // Scene → UI events
  onPick(listener: (hit: SceneAnnotationHit) => void): Unsubscribe;
  onMarkerSelect(listener: (id: number) => void): Unsubscribe;
  onMeasurePreview(listener: (state: LiveMeasurePreviewState) => void): Unsubscribe;
  onMeasureComplete(listener: (event: TwinMeasureCompleteEvent) => void): Unsubscribe;
  onObjectTransform(listener: (event: TwinObjectTransformEvent) => void): Unsubscribe;

  // UI → scene sync
  syncMarkers(records: readonly SceneAnnotationRecord[], selectedId: number | null): void;
  reapplyMoves(records: readonly SceneAnnotationRecord[]): void;

  // Move / rotate tool
  detachGizmo(): void;
  switchMoveCandidate(targetUuid: string): void;
  selectMovedObject(targetUuid: string): boolean;
  nudgeSelected(dx: number, dy: number, dz: number, dRotYDeg?: number, dRotXDeg?: number, dRotZDeg?: number): void;
  setSelectedDelta(dx: number, dy: number, dz: number, dRotYDeg: number, dRotXDeg?: number, dRotZDeg?: number): void;
  resetMovedObject(targetUuid?: string): void;

  // Record store
  getRecords(): readonly SceneAnnotationRecord[];
  getSelectedId(): number | null;
  getSelectedRecord(): SceneAnnotationRecord | null;
  subscribe(listener: (records: readonly SceneAnnotationRecord[], selectedId: number | null) => void): Unsubscribe;
  select(id: number | null): void;
  add(hit: SceneAnnotationHit, note?: string): SceneAnnotationRecord;
  addMeasure(
    startHit: SceneAnnotationHit,
    endHit: SceneAnnotationHit,
    snappedEndPoint: Vec3Tuple,
    note?: string
  ): SceneAnnotationRecord;
  upsertMove(
    baseHit: SceneAnnotationHit,
    transform: SceneObjectTransformAnnotation,
    cameraPose: SceneCameraPoseSnapshot
  ): SceneAnnotationRecord;
  updateTargetMeasurement(id: number, target: string): void;
  updateNote(id: number, note: string): void;
  remove(id: number): void;
  clearAll(): void;
  formatForAgent(): string;
}

export interface TwinAudioApi {
  isMuted(): boolean;
  setMuted(muted: boolean): void;
  toggleMuted(): boolean;
  getVolume(): number;
  setVolume(volume: number): void;
  isAmbientEnabled(): boolean;
  setAmbientEnabled(enabled: boolean): void;
  isSfxEnabled(): boolean;
  setSfxEnabled(enabled: boolean): void;
  onChanged(listener: () => void): Unsubscribe;
}

export interface TwinDevApi {
  getLodDiagnostics(): RoomLodDiagnostics;
  getLodPolicyMode(): LodPolicyMode;
  setLodPolicyMode(mode: LodPolicyMode): void;
  getFocusedRoomShortName(): string;
  isMotionBlurEnabled(): boolean;
  toggleMotionBlur(): boolean;
}

export interface TwinSkyWeatherApi {
  getSnapshot(): SkyWeatherSnapshot;
  onChanged(listener: (snapshot: SkyWeatherSnapshot) => void): Unsubscribe;
  setSolarDateTime(input: SolarDateTimeInput): SkyWeatherSnapshot;
  setLiveClockSync(enabled: boolean): SkyWeatherSnapshot;
  setSeason?(season: SeasonSelection): SkyWeatherSnapshot;
  getSeasonSelection?(): SeasonSelection;
  setWeatherLiveFeed(enabled: boolean): Promise<LiveWeatherState>;
  refreshLiveWeather(): Promise<LiveWeatherState>;
  applyWeatherPreset(preset: WeatherPresetId): LiveWeatherState;
  setCloudLayer(enabled: boolean, coverPct: number): LiveWeatherState;
  setPrecipitationLayer(type: PrecipitationType, intensity: number): LiveWeatherState;
  setFogLayer(enabled: boolean, intensity: number): LiveWeatherState;
  beginInteractiveScrub?(holdUntilEnd?: boolean): void;
  endInteractiveScrub?(): void;
  isInteractiveScrubbing?(): boolean;
}

export interface TwinTerrainSculptApi {
  isAvailable(): boolean;
  getSnapshot(): TerrainSculptSnapshot;
  onChanged(listener: (snapshot: TerrainSculptSnapshot) => void): Unsubscribe;
  isActive(): boolean;
  setActive(active: boolean): boolean;
  toggleActive(): boolean;
  getMode(): TerrainSculptMode;
  setMode(mode: TerrainSculptMode): void;
  getRadiusM(): number;
  setRadiusM(radiusM: number): number;
  getStrength(): number;
  setStrength(strength: number): number;
  getPatchId(): string;
  setPatchId(id: string): void;
  undo(): boolean;
  reset(): boolean;
  getStamps(): readonly TerrainStamp[];
  formatModifierJson(idOverride?: string): string;
  formatModifierTs(idOverride?: string): string;
}

export interface TwinApi {
  readonly camera: TwinCameraApi;
  readonly floors: TwinFloorsApi;
  readonly rooms: TwinRoomsApi;
  readonly lighting: TwinLightingApi;
  readonly devices: TwinDevicesApi;
  readonly graphics: TwinGraphicsApi;
  readonly audio: TwinAudioApi;
  readonly trades: TwinTradesApi;
  readonly walkthrough: TwinWalkthroughApi;
  readonly notes: TwinNotesApi;
  readonly dev: TwinDevApi;
  readonly sky?: TwinSkyWeatherApi;
  readonly terrainSculpt?: TwinTerrainSculptApi;
  readonly assets?: TwinAssetInspectorApi;
}

