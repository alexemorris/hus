import { batch } from '@preact/signals';
import type { SeasonSelection } from '../../core/types/environment-hdri.ts';
import type { TwinApi, TwinGraphicsStats, TwinUfhZone } from '../../core/types/twin-api.ts';
import type { TerrainSculptMode } from '../../core/geo/terrain-sculpt.ts';
import {
  assetInspectMode,
  inspectedAssetSnapshot,
} from '../../state/asset-inspector-store.ts';
import { annotationTool, annotatorActive } from '../../state/notes-store.ts';
import {
  DEFAULT_TERRAIN_SCULPT_SNAPSHOT,
  terrainSculptAvailable,
  terrainSculptSnapshot,
} from '../../state/terrain-sculpt-store.ts';
import {
  activeTool,
  cameraCompassBearingDeg,
  currentRoomId,
  deviceRevision,
  floorMode,
  graphicsFps,
  graphicsMode,
  graphicsTierLabel,
  guestMode,
  isCompactPhone,
  isMobile,
  liveLevels,
  navigatorOpen,
  roomPanelOpen,
  roomSheetSnap,
  touchNavMode,
  type TouchNavMode,
  sectionCut,
  showToast,
  skyWeatherSnapshot,
  timeOfDay,
  tradeView,
  viewMode,
  type ShellTool,
  type ShellViewMode,
} from '../../state/shell-store.ts';
import { buildShareUrl, isRoomZoneId } from '../../state/url-state.ts';
import type { KnxZoneScene } from '../../core/types/knx-zones.ts';
import type { CircuitId, CircuitLevels } from '../../core/types/knx.ts';
import type {
  AnnotationToolMode,
  FloorViewMode,
  SceneAnnotationRecord,
  TimeOfDay,
} from '../../core/types/scene.ts';
import type { RoomZoneId } from '../../core/types/topology.ts';
import type {
  GraphicsMode,
  GraphicsTier,
  RoomSceneControl,
  ShareViewState,
  TradeView,
} from '../../core/types/twin-ux.ts';
import type {
  PrecipitationType,
  SolarDateTimeInput,
  WeatherPresetId,
} from '../../core/types/solar-weather.ts';
import { TRADE_VIEW_LABELS } from '../../core/types/twin-ux.ts';
import {
  copyTextWithFallback,
  downloadBlobFile,
  downloadNotesJson,
  formatAnnotationsForAgent,
  notesExportFilename,
} from '../notes/notes-export.ts';
import {
  getScopedNoteMeta,
  isScopedTwinNotes,
  pruneScopedNoteMeta,
  resolveHouseIdentity,
} from '../notes/scoped-annotations.ts';
import { PROPERTY_NAME } from './room-data.ts';

/** The notes inspector actions the shell drives (implemented by `AnnotatorController`). */
export interface ShellNotesTools {
  activateTool(tool: AnnotationToolMode | null): void;
  focusRecord(id: number): void;
  removeRecord(id: number): void;
  getHouseId?(): string;
  getHouseName?(): string;
}

export interface ShellDeps {
  readonly api: TwinApi;
  readonly notes: ShellNotesTools;
}

const LEVEL_PUSH_INTERVAL_MS = 120;

const TIER_LABELS: Readonly<Record<GraphicsTier, string>> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  ultra: 'Ultra',
};

function formatTier(stats: TwinGraphicsStats): string {
  return TIER_LABELS[stats.tier] ?? stats.tier;
}

/**
 * Imperative glue between the Preact shell and the twin. Components read
 * shell-store signals and call these actions; only this class talks to
 * `TwinApi`, and only through subscriptions (no polling, no engine imports).
 */
export class ShellController {
  public readonly api: TwinApi;
  private readonly notesTools: ShellNotesTools;
  private levelPushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastLevelPush = 0;
  private pendingLevels: Readonly<CircuitLevels> | null = null;
  private panelsBeforeWalk: { readonly navigator: boolean; readonly roomPanel: boolean } | null = null;

  public constructor(deps: ShellDeps) {
    this.api = deps.api;
    this.notesTools = deps.notes;
  }

  /** Subscribes to twin events and seeds the shell signals. */
  public init(): void {
    const { api } = this;

    batch(() => {
      currentRoomId.value = api.rooms.getCurrent();
      tradeView.value = api.trades.getView();
      floorMode.value = api.floors.getMode();
      sectionCut.value = api.floors.isCeilingCutaway();
      graphicsMode.value = api.graphics.getMode();
      liveLevels.value = { ...api.lighting.getLiveLevels() };
      timeOfDay.value = api.lighting.getTimeOfDay();
      viewMode.value = api.walkthrough.isActive() ? 'walk' : '3d';
      if (typeof api.camera.getCompassBearingDeg === 'function') {
        cameraCompassBearingDeg.value = api.camera.getCompassBearingDeg();
      }
      if (api.sky) {
        skyWeatherSnapshot.value = api.sky.getSnapshot();
      }
      if (api.terrainSculpt) {
        terrainSculptAvailable.value = api.terrainSculpt.isAvailable();
        terrainSculptSnapshot.value = api.terrainSculpt.getSnapshot();
      } else {
        terrainSculptAvailable.value = false;
        terrainSculptSnapshot.value = DEFAULT_TERRAIN_SCULPT_SNAPSHOT;
      }
      assetInspectMode.value = api.assets?.isInspectMode() ?? false;
      inspectedAssetSnapshot.value = api.assets?.getInspected() ?? null;
    });
    this.refreshGraphicsReadout();

    api.rooms.onChanged((zoneId) => {
      currentRoomId.value = zoneId;
    });
    api.trades.onChanged((view) => {
      tradeView.value = view;
    });
    api.camera.onViewChanged((view) => {
      if (floorMode.value !== view.floorViewMode) floorMode.value = view.floorViewMode;
      const cut = api.floors.isCeilingCutaway();
      if (sectionCut.value !== cut) sectionCut.value = cut;
    });
    api.sky?.onChanged((snap) => {
      skyWeatherSnapshot.value = snap;
      if (timeOfDay.value !== snap.timeOfDay) {
        timeOfDay.value = snap.timeOfDay;
      }
    });
    api.walkthrough.onChanged((walking) => {
      if (walking && viewMode.value !== 'walk') viewMode.value = 'walk';
      else if (!walking && viewMode.value === 'walk') viewMode.value = '3d';
      this.syncImmersivePanels(walking);
    });
    this.syncImmersivePanels(api.walkthrough.isActive());
    api.lighting.onLevelsChanged((levels) => this.pushLiveLevels(levels));
    api.lighting.subscribe((event) => {
      if (event.type !== 'stateChange') return;
      deviceRevision.value += 1;
      const tod = api.lighting.getTimeOfDay();
      if (tod !== timeOfDay.value) timeOfDay.value = tod;
    });
    api.devices.onChanged(() => {
      deviceRevision.value += 1;
    });
    api.graphics.onToast((message) => showToast(message, 3200));

    api.notes.subscribe((records) => {
      pruneScopedNoteMeta(this.getHouseId(), records.map((r) => r.id));
    });

    api.terrainSculpt?.onChanged((snap) => {
      terrainSculptSnapshot.value = snap;
    });

    api.assets?.onChanged((snap) => {
      inspectedAssetSnapshot.value = snap;
      assetInspectMode.value = api.assets?.isInspectMode() ?? false;
    });

    // Tool state follows the notes inspector, asset inspector & terrain sculpt controller.
    const syncTool = (): void => {
      const tool = annotationTool.value;
      const sculptOn = terrainSculptSnapshot.value.active;
      const inspectOn = assetInspectMode.value;
      const next: ShellTool = sculptOn
        ? 'sculpt'
        : inspectOn
          ? 'inspect'
          : !annotatorActive.value
            ? 'orbit'
            : tool === 'measure'
              ? 'measure'
              : 'note';
      if (activeTool.value !== next) activeTool.value = next;
    };
    annotatorActive.subscribe(syncTool);
    annotationTool.subscribe(syncTool);
    terrainSculptSnapshot.subscribe(syncTool);
    assetInspectMode.subscribe(syncTool);

    // Double-click a surface to jump into that room.
    api.camera.onSurfaceDoubleClick((point) => {
      const room = api.rooms.findAt(point);
      if (room) this.selectRoom(room.zoneId);
    });
  }

  /**
   * Walk mode is immersive: collapse the navigator and room panel on entry and
   * restore whatever was open on exit (the walk overlay's room chip replaces them).
   */
  private syncImmersivePanels(walking: boolean): void {
    if (walking && this.panelsBeforeWalk === null) {
      this.panelsBeforeWalk = { navigator: navigatorOpen.value, roomPanel: roomPanelOpen.value };
      batch(() => {
        navigatorOpen.value = false;
        roomPanelOpen.value = false;
      });
    } else if (!walking && this.panelsBeforeWalk !== null) {
      const saved = this.panelsBeforeWalk;
      this.panelsBeforeWalk = null;
      batch(() => {
        navigatorOpen.value = saved.navigator;
        roomPanelOpen.value = saved.roomPanel;
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Rooms
  // ---------------------------------------------------------------------------

  public roomLabel(zoneId: RoomZoneId | null): string {
    return zoneId ? this.api.rooms.getLabel(zoneId) : PROPERTY_NAME;
  }

  public roomLevelScenes(zoneId: RoomZoneId): readonly KnxZoneScene[] {
    return this.api.rooms.getLevelScenes(zoneId);
  }

  public highlightRoom(zoneId: RoomZoneId | null): void {
    this.api.rooms.highlight(zoneId);
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  public selectRoom(zoneId: RoomZoneId, fly = true): void {
    const { api } = this;
    if (fly) {
      api.camera.flyToRoom(zoneId);
      if (viewMode.value === 'plan') viewMode.value = '3d';
    } else {
      api.rooms.select(zoneId);
    }
    // Mirror immediately in case the engine defers the change notification.
    currentRoomId.value = api.rooms.getCurrent() ?? zoneId;
    if (isMobile.value) {
      navigatorOpen.value = false;
      roomPanelOpen.value = true;
      if (isCompactPhone.value) {
        roomSheetSnap.value = 'peek';
      }
    }
  }

  public setFloor(mode: FloorViewMode): void {
    this.api.floors.setMode(mode);
    floorMode.value = mode;
  }

  public setViewMode(mode: ShellViewMode): void {
    const { api } = this;
    if (mode === 'walk') {
      this.setTool('orbit');
      api.walkthrough.enter();
    } else {
      if (api.walkthrough.isActive()) api.walkthrough.exit();
      const keepFloor = api.floors.getMode();
      if (mode === 'plan') {
        api.camera.setSingleFingerPan(true);
        touchNavMode.value = 'pan';
        api.camera.flyToPreset('top');
      } else if (viewMode.value === 'plan') {
        api.camera.setSingleFingerPan(false);
        touchNavMode.value = 'orbit';
        const room = currentRoomId.value;
        const bounds = room ? api.rooms.getBounds(room) : null;
        if (bounds) api.camera.flyToBounds(bounds, keepFloor);
        else api.camera.flyToPreset('overview');
      }
      if (api.floors.getMode() !== keepFloor) api.floors.setMode(keepFloor);
    }
    viewMode.value = api.walkthrough.isActive() ? 'walk' : mode === 'walk' ? '3d' : mode;
    floorMode.value = api.floors.getMode();
  }

  public recenter(): void {
    if (this.api.walkthrough.isActive()) return;
    this.api.camera.recenter();
  }

  public setTouchNavMode(mode: TouchNavMode): void {
    this.api.camera.setSingleFingerPan(mode === 'pan');
    touchNavMode.value = mode;
  }

  public toggleTouchNavMode(): void {
    const next: TouchNavMode = touchNavMode.value === 'pan' ? 'orbit' : 'pan';
    this.setTouchNavMode(next);
  }

  public isWalking(): boolean {
    return this.api.walkthrough.isActive();
  }

  public setTool(tool: ShellTool): void {
    if (tool !== 'orbit' && this.api.walkthrough.isActive()) this.api.walkthrough.exit();
    if (tool === 'inspect') {
      this.notesTools.activateTool(null);
      if (this.api.terrainSculpt?.isActive()) {
        this.api.terrainSculpt.setActive(false);
      }
      const activated = this.api.assets?.setInspectMode(true) ?? false;
      assetInspectMode.value = activated;
      activeTool.value = activated ? 'inspect' : 'orbit';
      return;
    }
    if (this.api.assets?.isInspectMode()) {
      this.api.assets.setInspectMode(false);
      assetInspectMode.value = false;
    } else if (tool === 'orbit' && inspectedAssetSnapshot.value !== null) {
      this.api.assets?.clear();
      inspectedAssetSnapshot.value = null;
    }
    if (tool === 'sculpt') {
      this.notesTools.activateTool(null);
      const activated = this.api.terrainSculpt?.setActive(true) ?? false;
      activeTool.value = activated ? 'sculpt' : 'orbit';
      return;
    }
    if (this.api.terrainSculpt?.isActive()) {
      this.api.terrainSculpt.setActive(false);
    }
    this.notesTools.activateTool(tool === 'orbit' ? null : tool === 'measure' ? 'measure' : 'pin');
    activeTool.value = tool;
  }

  public closeAssetInspector(): void {
    this.api.assets?.clear();
    if (this.api.assets?.isInspectMode()) {
      this.api.assets.setInspectMode(false);
    }
    assetInspectMode.value = false;
    inspectedAssetSnapshot.value = null;
    if (activeTool.value === 'inspect') {
      activeTool.value = 'orbit';
    }
  }

  public triggerInspectedAssetAction(actionId: string): void {
    this.api.assets?.triggerAction(actionId);
  }

  public frameInspectedAsset(): void {
    this.api.assets?.frameInspected();
  }

  public playInspectedAssetSound(): void {
    this.api.assets?.playSound();
  }

  public isTerrainSculptAvailable(): boolean {
    return this.api.terrainSculpt?.isAvailable() ?? false;
  }

  public setTerrainSculptMode(mode: TerrainSculptMode): void {
    this.api.terrainSculpt?.setMode(mode);
  }

  public setTerrainSculptRadius(radiusM: number): void {
    this.api.terrainSculpt?.setRadiusM(radiusM);
  }

  public setTerrainSculptStrength(strength: number): void {
    this.api.terrainSculpt?.setStrength(strength);
  }

  public undoTerrainSculpt(): void {
    if (this.api.terrainSculpt?.undo()) {
      showToast('Undid last terrain stroke');
    }
  }

  public resetTerrainSculpt(): void {
    if (this.api.terrainSculpt?.reset()) {
      showToast('Reset terrain sculpt strokes');
    }
  }

  public async copyTerrainSculptModifier(format: 'json' | 'ts' = 'json'): Promise<boolean> {
    const tsApi = this.api.terrainSculpt;
    if (!tsApi) return false;
    const text = format === 'ts' ? tsApi.formatModifierTs() : tsApi.formatModifierJson();
    const ok = await copyTextWithFallback(text);
    showToast(
      ok
        ? `TerrainModifier ${format.toUpperCase()} copied (${tsApi.getStamps().length} stamps)`
        : 'Could not copy TerrainModifier'
    );
    return ok;
  }

  public toggleTool(tool: Exclude<ShellTool, 'orbit'>): void {
    this.setTool(activeTool.value === tool ? 'orbit' : tool);
  }

  /** Developer object tools (move / rotate furniture). */
  public activateObjectTool(tool: 'move' | 'rotate'): void {
    this.notesTools.activateTool(tool);
  }

  public toggleSection(): void {
    sectionCut.value = this.api.floors.toggleCeilingCutaway();
  }

  public setTradeView(view: TradeView): void {
    this.api.trades.setView(view);
    tradeView.value = this.api.trades.getView();
  }

  // ---------------------------------------------------------------------------
  // Graphics
  // ---------------------------------------------------------------------------

  /** The engine persists the chosen mode; the shell only mirrors it. */
  public setGraphicsMode(mode: GraphicsMode): void {
    this.api.graphics.setMode(mode);
    graphicsMode.value = this.api.graphics.getMode();
    this.refreshGraphicsReadout();
  }

  public refreshGraphicsReadout(): void {
    const stats = this.api.graphics.getStats();
    graphicsTierLabel.value = formatTier(stats);
    graphicsFps.value = Number.isFinite(stats.fps) && stats.fps > 0 ? stats.fps : null;
  }

  // ---------------------------------------------------------------------------
  // Lights & devices
  // ---------------------------------------------------------------------------

  /** Throttled mirror of KNX live levels into the panel. */
  private pushLiveLevels(levels: Readonly<CircuitLevels>): void {
    this.pendingLevels = levels;
    const now = performance.now();
    const elapsed = now - this.lastLevelPush;
    if (elapsed >= LEVEL_PUSH_INTERVAL_MS) {
      this.flushLevels(now);
      return;
    }
    if (this.levelPushTimer) return;
    this.levelPushTimer = setTimeout(() => {
      this.levelPushTimer = null;
      this.flushLevels(performance.now());
    }, LEVEL_PUSH_INTERVAL_MS - elapsed);
  }

  private flushLevels(now: number): void {
    this.lastLevelPush = now;
    const levels = this.pendingLevels ?? this.api.lighting.getLiveLevels();
    this.pendingLevels = null;
    liveLevels.value = { ...levels };
  }

  public toggleLight(circuitId: string): void {
    if (!this.api.lighting.isKnownCircuit(circuitId)) return;
    this.api.lighting.toggleCircuit(circuitId);
  }

  public setLightLevel(circuitId: string, pct: number): void {
    if (!this.api.lighting.isKnownCircuit(circuitId)) return;
    this.api.lighting.setCircuitLevel(circuitId, Math.round(Math.max(0, Math.min(100, pct))));
  }

  public recallScene(sceneCtl: RoomSceneControl): void {
    this.api.lighting.recallScene(sceneCtl.sceneNumber, sceneCtl.pa);
    showToast(`${sceneCtl.label} scene`);
  }

  public applyLevels(levels: Readonly<Partial<Record<CircuitId, number>>>, label?: string): void {
    this.api.lighting.applyLevels(levels);
    if (label) showToast(label);
  }

  public allLightsOff(): void {
    this.api.lighting.allOff();
    showToast('All lights off');
  }

  /** Whole-house evening mood: kitchen "Lounge" scene + each room's middle preset. */
  public eveningScene(): void {
    const { lighting, rooms } = this.api;
    lighting.recallScene(2);
    const zones = new Set<RoomZoneId>();
    for (const c of lighting.circuits()) zones.add(c.zoneId);
    for (const zoneId of zones) {
      const presets = rooms.getLevelScenes(zoneId);
      const preset = presets[1] ?? presets[0];
      if (preset) lighting.applyLevels(preset.levels);
    }
    showToast('Evening scene');
  }

  public toggleGates(): void {
    const opening = this.api.devices.toggleGates();
    showToast(opening ? 'Gates opening' : 'Gates closing');
  }

  public isGateOpenOrOpening(): boolean {
    return this.api.devices.isGatesOpen();
  }

  public setTimeOfDay(tod: TimeOfDay): void {
    this.api.lighting.setTimeOfDay(tod);
    timeOfDay.value = tod;
    if (this.api.sky) {
      skyWeatherSnapshot.value = this.api.sky.getSnapshot();
    }
  }

  public getCompassBearingDeg(): number {
    return typeof this.api.camera.getCompassBearingDeg === 'function'
      ? this.api.camera.getCompassBearingDeg()
      : cameraCompassBearingDeg.peek();
  }

  public onCompassBearingChanged(listener: (bearingDeg: number) => void): () => void {
    if (typeof this.api.camera.onCompassBearingChanged === 'function') {
      return this.api.camera.onCompassBearingChanged(listener);
    }
    return () => {};
  }

  public beginInteractiveScrub(holdUntilEnd = false): void {
    this.api.sky?.beginInteractiveScrub?.(holdUntilEnd);
  }

  public endInteractiveScrub(): void {
    this.api.sky?.endInteractiveScrub?.();
  }

  public setSolarDateTime(input: SolarDateTimeInput): void {
    if (!this.api.sky) return;
    const snap = this.api.sky.setSolarDateTime(input);
    skyWeatherSnapshot.value = snap;
    if (timeOfDay.peek() !== snap.timeOfDay) {
      timeOfDay.value = snap.timeOfDay;
    }
  }

  public setSeason(season: SeasonSelection): void {
    if (!this.api.sky) return;
    if (this.api.sky.setSeason) {
      const snap = this.api.sky.setSeason(season);
      skyWeatherSnapshot.value = snap;
      if (timeOfDay.peek() !== snap.timeOfDay) {
        timeOfDay.value = snap.timeOfDay;
      }
      return;
    }
    skyWeatherSnapshot.value = this.api.sky.getSnapshot();
  }

  public setLiveClockSync(enabled: boolean): void {
    if (!this.api.sky) return;
    const snap = this.api.sky.setLiveClockSync(enabled);
    skyWeatherSnapshot.value = snap;
    timeOfDay.value = snap.timeOfDay;
    showToast(
      enabled
        ? snap.solar.timezone
          ? `Synced to live local time (${snap.solar.timezone})`
          : 'Synced to live local time'
        : 'Manual solar clock'
    );
  }

  public async setWeatherLiveFeed(enabled: boolean): Promise<void> {
    if (!this.api.sky) return;
    await this.api.sky.setWeatherLiveFeed(enabled);
    const snap = this.api.sky.getSnapshot();
    skyWeatherSnapshot.value = snap;
    showToast(
      enabled
        ? snap.locationLabel
          ? `Live Open-Meteo weather · ${snap.locationLabel}`
          : 'Live Open-Meteo weather'
        : 'Manual weather controls'
    );
  }

  public async refreshLiveWeather(): Promise<void> {
    if (!this.api.sky) return;
    await this.api.sky.refreshLiveWeather();
    skyWeatherSnapshot.value = this.api.sky.getSnapshot();
  }

  public applyWeatherPreset(preset: WeatherPresetId): void {
    if (!this.api.sky) return;
    this.api.sky.applyWeatherPreset(preset);
    skyWeatherSnapshot.value = this.api.sky.getSnapshot();
  }

  public setWeatherCloudLayer(enabled: boolean, coverPct: number): void {
    if (!this.api.sky) return;
    this.api.sky.setCloudLayer(enabled, coverPct);
    skyWeatherSnapshot.value = this.api.sky.getSnapshot();
  }

  public setWeatherPrecipitationLayer(type: PrecipitationType, intensity: number): void {
    if (!this.api.sky) return;
    this.api.sky.setPrecipitationLayer(type, intensity);
    skyWeatherSnapshot.value = this.api.sky.getSnapshot();
  }

  public setWeatherFogLayer(enabled: boolean, intensity: number): void {
    if (!this.api.sky) return;
    this.api.sky.setFogLayer(enabled, intensity);
    skyWeatherSnapshot.value = this.api.sky.getSnapshot();
  }

  public ufhZoneForRoom(zoneId: RoomZoneId): TwinUfhZone | undefined {
    return this.api.devices.hasUfh() ? this.api.devices.ufhZoneForRoom(zoneId) : undefined;
  }

  public toggleUfhZoneForRoom(zoneId: RoomZoneId): void {
    const zone = this.ufhZoneForRoom(zoneId);
    if (!zone) return;
    this.api.devices.toggleUfhZone(zone.id);
    deviceRevision.value += 1;
  }

  public activateDevice(interactableId: string, label: string): void {
    const handled = this.api.devices.handleInteractable(interactableId);
    if (!handled) showToast(`${label} isn't available right now`);
  }

  // ---------------------------------------------------------------------------
  // Notes
  // ---------------------------------------------------------------------------

  public focusNote(id: number): void {
    this.notesTools.focusRecord(id);
  }

  public deleteNote(id: number): void {
    this.notesTools.removeRecord(id);
  }

  public updateNoteText(id: number, text: string): void {
    this.api.notes.updateNote(id, text);
  }

  public getHouseId(): string {
    return this.notesTools.getHouseId?.() ?? resolveHouseIdentity(this.api).houseId;
  }

  public getHouseName(): string {
    return this.notesTools.getHouseName?.() ?? resolveHouseIdentity(this.api).houseName;
  }

  private formatTradeAppendix(records: readonly SceneAnnotationRecord[]): string {
    const meta = getScopedNoteMeta(this.getHouseId());
    const lines: string[] = [];
    for (const r of records) {
      const m = meta[String(r.id)];
      if (!m?.trade && !m?.resolved) continue;
      const trade = m.trade ? TRADE_VIEW_LABELS[m.trade] : 'Unassigned';
      lines.push(`- #${r.id} (${r.roomName}): ${trade}${m.resolved ? ' · resolved' : ' · open'}`);
    }
    return lines.length > 0 ? `\n\n## Trade assignments\n\n${lines.join('\n')}\n` : '';
  }

  public buildNotesMarkdown(): string {
    const { notes } = this.api;
    const records = notes.getRecords();
    const report = isScopedTwinNotes(notes)
      ? notes.formatForAgent()
      : formatAnnotationsForAgent(records, this.getHouseName());
    return report + this.formatTradeAppendix(records);
  }

  public async copyNotesMarkdown(): Promise<void> {
    const ok = await copyTextWithFallback(this.buildNotesMarkdown());
    showToast(ok ? 'Notes copied as Markdown' : 'Could not copy notes');
  }

  public downloadNotesMarkdown(): void {
    downloadBlobFile(
      this.buildNotesMarkdown(),
      notesExportFilename(this.getHouseId(), 'md'),
      'text/markdown;charset=utf-8'
    );
  }

  public downloadNotesJson(): void {
    downloadNotesJson(this.api.notes, {
      houseId: this.getHouseId(),
      houseName: this.getHouseName(),
    });
  }

  // ---------------------------------------------------------------------------
  // Sharing
  // ---------------------------------------------------------------------------

  public captureShareState(guest = true): ShareViewState {
    const { api } = this;
    const pose = api.camera.getPose();
    const room = api.rooms.getCurrent() ?? currentRoomId.value;
    return {
      cam: pose.position,
      target: pose.target,
      floor: api.floors.getMode(),
      ortho: pose.isOrthographic,
      ...(room ? { room } : {}),
      view: api.trades.getView(),
      guest,
    };
  }

  public async share(): Promise<void> {
    const url = buildShareUrl(this.captureShareState(true));
    const ok = await copyTextWithFallback(url);
    const viewLabel = TRADE_VIEW_LABELS[this.api.trades.getView()];
    showToast(
      ok
        ? `Link copied · opens this view (${viewLabel}) read-only`
        : 'Could not copy the link — check clipboard permissions',
      3600
    );
  }

  /** Applies a decoded `?v=` share state (called once after the scene is ready). */
  public applyShareState(s: ShareViewState): void {
    const { api } = this;
    guestMode.value = s.guest;
    api.trades.setView(s.view);
    tradeView.value = api.trades.getView();
    const room = s.room && isRoomZoneId(s.room) ? s.room : null;
    if (room) {
      api.rooms.select(room);
      currentRoomId.value = api.rooms.getCurrent() ?? room;
    }
    api.camera.flyToCameraPose({
      position: s.cam,
      target: s.target,
      floorViewMode: s.floor,
      ceilingCutaway: api.floors.isCeilingCutaway(),
      isOrthographic: s.ortho,
    });
    floorMode.value = s.floor;
    showToast(
      `Shared view${room ? ` · ${this.roomLabel(room)}` : ''} · ${TRADE_VIEW_LABELS[s.view]}`,
      3200
    );
  }
}
