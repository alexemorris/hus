import type { RoomVariationGroupInfo } from "../../core/types/variations.ts";
import type { RoomVariationController, RoomVariationGroup, RoomVariationGroupInput } from "../variations/room-variation-controller.ts";
import type * as THREE from 'three';
import type {
  AccessPointEntityState,
  CctvCameraEntityState,
  LodPolicyMode,
  RoomLodDiagnostics,
} from '../../core/entities.ts';
import type { CircuitLevels } from '../../core/types/knx.ts';
import type {
  AnnotationToolMode,
  CameraPresetName,
  FloorDefinition,
  FloorViewMode,
  LiveMeasurePreviewState,
  GizmoTransformMode,
  SceneAnnotationHit,
  SceneAnnotationRecord,
  SceneCameraPoseSnapshot,
} from '../../core/types/scene.ts';
import type { RoomZoneId } from '../../core/types/topology.ts';
import type { GraphicsMode, TradeView } from '../../core/types/twin-ux.ts';
import type {
  MeasureCompleteCallback,
  ObjectTransformChangeCallback,
} from '../annotation/annotation-controller.ts';
import type { RoomLodController } from '../lod/lod-manager.ts';
import type { PerformanceGovernorStats } from '../perf/index.ts';
import type {
  GraphicsQualityPreset,
  GraphicsSettingsState,
} from '../rendering/post-processing-pipeline.ts';
import type { WalkthroughSpawnPoint } from '../walkthrough/parts/walkthrough-spawns.ts';
import {
  type WalkthroughController,
} from '../walkthrough/walkthrough-controller.ts';
import type { SecurityOverlay3D, UfhSystemOverlay3D, UfhZoneId } from './property-scene-profile.ts';
import type { SceneZoneRegistry } from './scene-zone-registry.ts';
import type {
  PropertySceneViewState,
  RoomFramingBounds,
  ScreenPoint,
} from './services/viewer-types.ts';
import { ViewerComposition } from './viewer-composition.ts';

export type { MovableTargetCandidate } from '../annotation/annotation-controller.ts';
export type { PropertySceneViewState, RoomFramingBounds, ScreenPoint } from './services/viewer-types.ts';

type Unsubscribe = () => void;

/**
 * Home-agnostic 3D property scene.
 *
 * All behaviour lives in the services composed by {@link ViewerComposition}
 * (`renderer`, `camera`, `cutaways`, `rooms`, `graphics`, `trades`,
 * `annotations`, `devices`, `staticScene`, `input`, `walkthrough`).
 * The flat methods below are thin delegates kept for existing callers; new
 * code should use the services directly (engine / dev tools) or the app-level
 * TwinApi (UI).
 */
export class PropertyScene<
  TSecurity extends SecurityOverlay3D = SecurityOverlay3D,
> extends ViewerComposition<TSecurity> {
  public flyToPreset(preset: CameraPresetName | string): void { this.camera.flyToPreset(preset); }
  public flyToCameraPose(pose: SceneCameraPoseSnapshot): void { this.camera.flyToCameraPose(pose); }
  public flyToRoomBounds(b: RoomFramingBounds, floor: FloorViewMode): void { this.camera.flyToRoomBounds(b, floor); }
  public getCurrentCameraPoseSnapshot(): SceneCameraPoseSnapshot { return this.camera.getPoseSnapshot(); }
  public getViewState(): PropertySceneViewState { return this.camera.getViewState(); }
  public onViewChanged(cb: (view: PropertySceneViewState) => void): Unsubscribe { return this.camera.viewChanged.add(cb); }
  public getCompassBearingDeg(): number { return this.camera.getCameraCompassBearingDeg(); }
  public onCompassBearingChanged(cb: (bearingDeg: number) => void): Unsubscribe { return this.camera.compassBearingChanged.add(cb); }
  public projectToScreen(x: number, y: number, z: number): ScreenPoint { return this.camera.projectToScreen(x, y, z); }
  public setSingleFingerPan(enabled: boolean): void { this.camera.rig.setSingleFingerPan(enabled); }
  public isSingleFingerPan(): boolean { return this.camera.rig.isSingleFingerPan(); }
  public onSurfaceDoubleClick(cb: (point: THREE.Vector3) => void): Unsubscribe { return this.input.surfaceDoubleClick.add(cb); }
  /** @deprecated use `onSurfaceDoubleClick` (multi-listener). */
  public setOnSurfaceDoubleClick(cb: ((point: THREE.Vector3) => void) | null): void { this.input.surfaceDoubleClick.setSlot(cb); }

  /** Display name of the property, when its profile declares one. */
  public getPropertyName(): string | undefined { return this.profile.name; }
  /** The property's storeys, lowest first. */
  public getFloors(): readonly FloorDefinition[] { return this.cutaways.getFloors(); }
  public getFloorViewMode(): FloorViewMode { return this.cutaways.getFloorViewMode(); }
  public isCeilingCutaway(): boolean { return this.cutaways.isCeilingCutaway(); }

  public getCurrentRoomId(): RoomZoneId | null { return this.rooms.getCurrent(); }
  public onCurrentRoomChanged(cb: (zoneId: RoomZoneId | null) => void): Unsubscribe { return this.rooms.changed.add(cb); }
  public selectRoom(zoneId: RoomZoneId): void { this.rooms.select(zoneId); }
  public setFocusedZone(zoneId: RoomZoneId): void { this.rooms.setFocusedZone(zoneId); }
  public highlightRoom(zoneId: RoomZoneId | null): void { this.rooms.highlight(zoneId); }
  public getLodPolicyMode(): LodPolicyMode { return this.rooms.getLodPolicyMode(); }
  public setLodPolicyMode(mode: LodPolicyMode): void { this.rooms.setLodPolicyMode(mode); }
  public getZoneRegistry(): SceneZoneRegistry { return this.zoneRegistry; }
  public getVariations(): RoomVariationController { return this.variations; }
  public getVariationGroups(): readonly RoomVariationGroupInfo[] { return this.variations.list(); }
  public selectVariationOption(groupId: string, optionId: string): boolean { return this.variations.selectOption(groupId, optionId); }
  public cycleVariationOption(groupId: string, delta: -1 | 1 = 1): string | undefined { return this.variations.cycleOption(groupId, delta); }
  public resetVariations(): boolean { return this.variations.resetDefaults(); }
  public registerVariationGroup(group: RoomVariationGroup | RoomVariationGroupInput): RoomVariationGroup { return this.variations.registerGroup(group); }
  public onVariationsChanged(cb: (groups: readonly RoomVariationGroupInfo[]) => void): Unsubscribe { return this.variations.onChanged(cb); }
  public getLodController(): RoomLodController { return this.lodController; }
  public getLodDiagnostics(): RoomLodDiagnostics { return this.lodController.getDiagnostics(); }
  public getFocusedRoomShortName(): string { return this.lodController.getFocusedRoomShortName(); }

  public getGraphicsMode(): GraphicsMode { return this.graphics.getMode(); }
  public setGraphicsMode(mode: GraphicsMode): void { this.graphics.setMode(mode); }
  public getGraphicsStats(): PerformanceGovernorStats { return this.graphics.getStats(); }
  public onGraphicsToast(cb: (message: string) => void): Unsubscribe { return this.graphics.toast.add(cb); }
  /** @deprecated use `onGraphicsToast` (multi-listener). */
  public setOnGraphicsToast(cb: ((message: string) => void) | null): void { this.graphics.toast.setSlot(cb); }
  public getGraphicsSettings(): GraphicsSettingsState { return this.graphics.getSettings(); }
  public setGraphicsQualityPreset(preset: GraphicsQualityPreset): void { this.graphics.setQualityPreset(preset); }
  public cycleGraphicsQualityPreset(): GraphicsQualityPreset { return this.graphics.cycleQualityPreset(); }
  public isMotionBlurEnabled(): boolean { return this.graphics.isMotionBlurEnabled(); }
  public setMotionBlurEnabled(enabled: boolean): void { this.graphics.setMotionBlurEnabled(enabled); }
  public toggleMotionBlur(): boolean { return this.graphics.toggleMotionBlur(); }
  public isSsaoEnabled(): boolean { return this.graphics.isSsaoEnabled(); }
  public setSsaoEnabled(enabled: boolean): void { this.graphics.setSsaoEnabled(enabled); }
  public isFxaaEnabled(): boolean { return this.graphics.isFxaaEnabled(); }
  public setFxaaEnabled(enabled: boolean): void { this.graphics.setFxaaEnabled(enabled); }

  public getTradeView(): TradeView { return this.trades.getView(); }
  public setTradeView(view: TradeView): void { this.trades.setView(view); }
  public onTradeViewChanged(cb: (view: TradeView) => void): Unsubscribe { return this.trades.changed.add(cb); }
  public exportServiceSchedule(view?: TradeView): string { return this.trades.exportServiceSchedule(view); }

  public getWalkthrough(): WalkthroughController { return this.walkthrough; }
  public getWalkthroughSpawns(): readonly WalkthroughSpawnPoint[] { return this.walkthrough.getSpawns(); }
  public isWalkthroughMode(): boolean { return this.walkthrough.isActive(); }
  public toggleWalkthroughMode(spawnId?: string): boolean { return this.setWalkthroughMode(!this.walkthrough.isActive(), spawnId); }

  public handleInteractableClick(interactableId: string): boolean { return this.devices.handleInteractable(interactableId); }
  public onDeviceStateChanged(cb: () => void): Unsubscribe { return this.devices.changed.add(cb); }
  public applyKNXLightLevels(levels: Readonly<CircuitLevels>, continuousFade = false): void { this.devices.applyLightLevels(levels, continuousFade); }
  public setMotionSensorStates(kitchen: boolean, utility: boolean): void { this.devices.setMotionSensorStates(kitchen, utility); }
  public setTVArtState(artModeOn: boolean, artIndex: number): void { this.devices.setTVArtState(artModeOn, artIndex); }
  public isBifoldsOpen(): boolean { return this.devices.isBifoldsOpen(); }
  public toggleBifolds(): boolean { return this.devices.toggleBifolds(); }
  public isCarGatesOpen(): boolean { return this.devices.isCarGatesOpen(); }
  public setCarGatesOpen(isOpen: boolean): void { this.devices.setCarGatesOpen(isOpen); }
  public toggleCarGates(): boolean { return this.devices.toggleCarGates(); }
  public getCarGatesProgress(): number { return this.devices.getCarGatesProgress(); }
  public getUfhSystem(): UfhSystemOverlay3D | null { return this.devices.getUfhSystem(); }
  public isUfhLayerVisible(): boolean { return this.devices.isUfhLayerVisible(); }
  public setUfhLayerVisible(visible: boolean): void { this.devices.setUfhLayerVisible(visible); }
  public toggleUfhLayer(): boolean { return this.devices.toggleUfhLayer(); }
  public toggleUfhZone(zoneId: UfhZoneId): boolean { return this.devices.toggleUfhZone(zoneId); }
  public setAllUfhZones(on: boolean): void { this.devices.setAllUfhZones(on); }
  public syncUniFiSecurity3D(cameras: readonly CctvCameraEntityState[], aps: readonly AccessPointEntityState[]): void { this.devices.syncSecurity(cameras, aps); }

  public isAnnotationMode(): boolean { return this.annotations.isActive(); }
  public setAnnotationMode(enabled: boolean): void {
    if (enabled && this.terrainSculpt.isActive()) this.terrainSculpt.setActive(false);
    if (enabled && this.assetInspector.isInspectMode()) this.assetInspector.setInspectMode(false);
    this.annotations.setActive(enabled);
  }
  public toggleAnnotationMode(): boolean {
    const next = !this.annotations.isActive();
    if (next && this.terrainSculpt.isActive()) this.terrainSculpt.setActive(false);
    if (next && this.assetInspector.isInspectMode()) this.assetInspector.setInspectMode(false);
    return this.annotations.toggleActive();
  }
  public reapplySavedMoveAnnotations(records: readonly SceneAnnotationRecord[]): void { this.annotations.reapplySavedMoves(records); }
  public getAnnotationToolMode(): AnnotationToolMode { return this.annotations.controller.getAnnotationToolMode(); }
  public setAnnotationToolMode(tool: AnnotationToolMode): void { this.annotations.controller.setAnnotationToolMode(tool); }
  public getGizmoTransformMode(): GizmoTransformMode { return this.annotations.controller.getGizmoTransformMode(); }
  public setGizmoTransformMode(mode: GizmoTransformMode): void { this.annotations.controller.setGizmoTransformMode(mode); }
  public getMeasureAxisSnap(): boolean { return this.annotations.controller.getMeasureAxisSnap(); }
  public setMeasureAxisSnap(enabled: boolean): void { this.annotations.controller.setMeasureAxisSnap(enabled); }
  public cancelActiveMeasurement(): void { this.annotations.controller.cancelActiveMeasurement(); }
  public syncAnnotationMarkers(records: readonly SceneAnnotationRecord[], selectedId: number | null): void { this.annotations.controller.syncAnnotationMarkers(records, selectedId); }
  public detachMoveGizmo(): void { this.annotations.controller.detachMoveGizmo(); }
  public switchSelectedMoveCandidate(uuid: string): void { this.annotations.controller.switchSelectedMoveCandidate(uuid); }
  public selectMovedObjectByUuid(uuid: string): boolean { return this.annotations.controller.selectMovedObjectByUuid(uuid); }
  public resetMovedObject(uuid?: string): void { this.annotations.controller.resetMovedObject(uuid); }
  public nudgeSelectedObject(dx: number, dy: number, dz: number, dRotYDeg = 0, dRotXDeg = 0, dRotZDeg = 0): void {
    this.annotations.controller.nudgeSelectedObject(dx, dy, dz, dRotYDeg, dRotXDeg, dRotZDeg);
  }
  public setSelectedObjectDeltaTransform(dx: number, dy: number, dz: number, dRotYDeg: number, dRotXDeg?: number, dRotZDeg?: number): void {
    this.annotations.controller.setSelectedObjectDeltaTransform(dx, dy, dz, dRotYDeg, dRotXDeg, dRotZDeg);
  }
  public onAnnotationPick(cb: (hit: SceneAnnotationHit) => void): Unsubscribe { return this.annotations.pick.add(cb); }
  public onAnnotationMarkerSelect(cb: (id: number) => void): Unsubscribe { return this.annotations.markerSelect.add(cb); }
  public onMeasurePreviewChange(cb: (state: LiveMeasurePreviewState) => void): Unsubscribe { return this.annotations.measurePreview.add(cb); }
  public onMeasureComplete(cb: MeasureCompleteCallback): Unsubscribe { return this.annotations.measureComplete.add(cb); }
  public onObjectTransformChange(cb: ObjectTransformChangeCallback): Unsubscribe { return this.annotations.objectTransform.add(cb); }
  /** @deprecated single-slot setters below: use the `on*` subscriptions above. */
  public setOnAnnotationPick(cb: ((hit: SceneAnnotationHit) => void) | null): void { this.annotations.pick.setSlot(cb); }
  public setOnAnnotationMarkerSelect(cb: ((id: number) => void) | null): void { this.annotations.markerSelect.setSlot(cb); }
  public setOnMeasurePreviewChange(cb: ((state: LiveMeasurePreviewState) => void) | null): void { this.annotations.measurePreview.setSlot(cb); }
  public setOnMeasureComplete(cb: MeasureCompleteCallback | null): void { this.annotations.measureComplete.setSlot(cb); }
  public setOnObjectTransformChange(cb: ObjectTransformChangeCallback | null): void { this.annotations.objectTransform.setSlot(cb); }
}
