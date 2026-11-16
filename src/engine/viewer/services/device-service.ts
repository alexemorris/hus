import type * as THREE from 'three';
import type { AccessPointEntityState, CctvCameraEntityState } from '../../../core/entities.ts';
import type { CircuitLevels } from '../../../core/types/knx.ts';
import type { InteractiveUserData, TimeOfDay } from '../../../core/types/scene.ts';
import type { SceneInteractionManager } from '../../interaction/interaction-manager.ts';
import { CircuitLightingController } from '../../lighting/circuit-lighting.ts';
import { Emitter } from '../../util/emitter.ts';
import type {
  PropertySceneProfile,
  SecurityOverlay3D,
  UfhSystemOverlay3D,
  UfhZoneId,
} from '../property-scene-profile.ts';
import type { PropertySceneContent } from '../scene-content.ts';
import type { RenderInvalidator } from './viewer-types.ts';

export interface DeviceServiceHost<TSecurity extends SecurityOverlay3D> {
  readonly content: PropertySceneContent<TSecurity>;
  readonly profile: PropertySceneProfile<TSecurity>;
  readonly invalidator: RenderInvalidator;
  /** Enters walkthrough if needed and starts a registered cutscene. */
  startCutscene?(cutsceneId: string): void;
  /** Enters walkthrough if needed when a first-person interactable starts. */
  startFirstPersonInteractable?(interactableId: string): void;
  /** Home / integration click hook. */
  onObjectInteraction(data: InteractiveUserData): void;
}

/** Door shadow refresh throttle while doors animate (ms). */
const DOOR_SHADOW_THROTTLE_MS = 32;
const DOOR_SHADOW_THROTTLE_WALKING_MS = 90;
const WALK_DOOR_SHADOW_SETTLE_MS = 250;

/**
 * 3D device state: KNX-driven fixtures (circuit lighting, switch/sensor LEDs),
 * interactive assemblies (doors, bifold assemblies, swing gates, drawers, custom devices),
 * UFH and security overlays.
 */
export class DeviceService<TSecurity extends SecurityOverlay3D = SecurityOverlay3D> {
  /** Fires after user-driven device changes. */
  public readonly changed = new Emitter<[]>();
  public readonly circuitLighting: CircuitLightingController;
  public readonly interactions: SceneInteractionManager;
  private readonly host: DeviceServiceHost<TSecurity>;
  private lastDoorShadowUpdateMs = 0;
  private lastWalkingMotionMs = -Infinity;
  private pendingWalkDoorShadowFlush = false;
  private doorsWereAnimating = false;
  private portalOrDoorAnimations = false;
  private activeAnimations = false;

  public constructor(host: DeviceServiceHost<TSecurity>) {
    this.host = host;
    const { content, profile } = host;
    this.interactions = content.interactions;
    this.circuitLighting = new CircuitLightingController({
      lightGroups: content.lightGroups,
      indicatorMats: content.indicatorMats,
      roomSwitchLedMats: content.roomSwitchLedMats,
      switchLedRules: profile.switchLedRules,
      defaultFixtureAppearance: profile.defaultFixtureAppearance,
      fixtureAppearanceOverrides: profile.fixtureAppearanceOverrides,
      ...(profile.circuitIntensityMultipliers
        ? { circuitIntensityMultipliers: profile.circuitIntensityMultipliers }
        : {}),
      lodRegistrations: profile.lodRegistrations,
    });
    content.ufhSystem?.subscribe(() => host.invalidator.requestRender());
  }

  /** Adds every animated object (doors, bifold assemblies, swing gates, drawers) so it keeps matrix auto-update. */
  public collectDynamicObjects(target: Set<THREE.Object3D>): void {
    this.interactions.collectDynamicObjects(target);
  }

  /** Adds only boot-active animated objects excluded from initial static batching. */
  public collectBatchExcludedObjects(target: Set<THREE.Object3D>): void {
    this.interactions.collectBootPinnedDynamicObjects(target);
  }

  public handleInteractable(interactableId: string): boolean {
    const handled = this.interactions.handleInteractableClick(interactableId);
    if (handled) {
      const cutsceneId = this.interactions.getCustomInteractionCutsceneId(interactableId);
      if (cutsceneId) {
        this.host.startCutscene?.(cutsceneId);
      }
      if (this.interactions.getActiveFirstPersonPose() !== null) {
        this.host.startFirstPersonInteractable?.(interactableId);
      }
      this.host.invalidator.requestRender();
      this.changed.emit();
    }
    return handled;
  }

  public setTimeOfDay(mode: TimeOfDay): void {
    this.circuitLighting.setTimeOfDay(mode);
  }

  public applyLightLevels(liveLevels: Readonly<CircuitLevels>, continuousFade = false): void {
    this.circuitLighting.applyLevels(liveLevels, continuousFade);
    this.host.invalidator.requestRender();
  }

  public setSensorLedState(sensorId: string, detected: boolean): void {
    if (this.circuitLighting.setSensorLedState(sensorId, detected)) {
      this.host.invalidator.requestRender();
    }
  }

  public setSensorLedStates(states: Readonly<Record<string, boolean>>): void {
    if (this.circuitLighting.setSensorLedStates(states)) {
      this.host.invalidator.requestRender();
    }
  }

  public syncSecurity(
    cameras: readonly CctvCameraEntityState[],
    accessPoints: readonly AccessPointEntityState[]
  ): void {
    this.host.content.security.syncCameras(cameras);
    this.host.content.security.syncAccessPoints(accessPoints);
    this.host.invalidator.requestRender();
  }

  public getUfhSystem(): UfhSystemOverlay3D | null {
    return this.host.content.ufhSystem;
  }

  public isUfhLayerVisible(): boolean {
    return this.host.content.ufhSystem?.isLayerVisible() ?? false;
  }

  public setUfhLayerVisible(visible: boolean): void {
    const ufh = this.host.content.ufhSystem;
    if (!ufh) return;
    ufh.setLayerVisible(visible);
    this.host.invalidator.requestRender();
  }

  public toggleUfhLayer(): boolean {
    const ufh = this.host.content.ufhSystem;
    if (!ufh) return false;
    const next = ufh.toggleLayerVisible();
    this.host.invalidator.requestRender();
    return next;
  }

  public toggleUfhZone(zoneId: UfhZoneId): boolean {
    const ufh = this.host.content.ufhSystem;
    if (!ufh) return false;
    const next = ufh.toggleZone(zoneId);
    this.host.invalidator.requestRender();
    return next;
  }

  public setAllUfhZones(on: boolean): void {
    const ufh = this.host.content.ufhSystem;
    if (!ufh) return;
    ufh.setAllZones(on);
    this.host.invalidator.requestRender();
  }

  public hasActiveAnimations(): boolean {
    return this.activeAnimations;
  }

  /** True ONLY while portal/hinged/bifold doors or gates are moving (or finishing their final frame), excluding ambient loops. */
  public hasPortalOrDoorAnimations(): boolean {
    return this.portalOrDoorAnimations;
  }

  public update(
    dtSeconds: number,
    walkingCameraMoved: boolean,
    isWalkthroughActive = false
  ): void {
    const doorMoving = this.interactions.update(dtSeconds);
    const ambientMoving = this.interactions.stepAmbient(dtSeconds);
    const wasAnimatingDoors = this.doorsWereAnimating;
    this.portalOrDoorAnimations = doorMoving || wasAnimatingDoors;
    this.activeAnimations = this.portalOrDoorAnimations || ambientMoving;

    const now = performance.now();
    if (walkingCameraMoved) {
      this.lastWalkingMotionMs = now;
    }

    const { invalidator } = this.host;
    const suppressMidWalkDoorShadows = isWalkthroughActive || walkingCameraMoved;

    if (doorMoving) {
      this.doorsWereAnimating = true;
      if (suppressMidWalkDoorShadows) {
        this.pendingWalkDoorShadowFlush = true;
      } else {
        const throttleMs = walkingCameraMoved
          ? DOOR_SHADOW_THROTTLE_WALKING_MS
          : DOOR_SHADOW_THROTTLE_MS;
        if (now - this.lastDoorShadowUpdateMs >= throttleMs) {
          this.lastDoorShadowUpdateMs = now;
          invalidator.invalidateShadows();
        }
      }
      invalidator.requestRender();
    } else if (this.doorsWereAnimating) {
      this.doorsWereAnimating = false;
      if (isWalkthroughActive || walkingCameraMoved) {
        this.pendingWalkDoorShadowFlush = true;
        invalidator.requestRender();
      } else {
        this.pendingWalkDoorShadowFlush = false;
        invalidator.invalidateShadows();
        invalidator.requestRender();
      }
    } else if (ambientMoving) {
      invalidator.requestRender();
    }

    if (
      this.pendingWalkDoorShadowFlush &&
      !doorMoving &&
      !walkingCameraMoved &&
      now - this.lastWalkingMotionMs >= WALK_DOOR_SHADOW_SETTLE_MS
    ) {
      this.pendingWalkDoorShadowFlush = false;
      this.lastDoorShadowUpdateMs = now;
      invalidator.invalidateShadows();
      invalidator.requestRender();
    }
  }
}
