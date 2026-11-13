import type * as THREE from 'three';
import type { AccessPointEntityState, CctvCameraEntityState } from '../../../core/entities.ts';
import type { CircuitLevels } from '../../../core/types/knx.ts';
import type { InteractiveUserData, TimeOfDay } from '../../../core/types/scene.ts';
import { BifoldDoorAnimator } from '../../interaction/bifold-animator.ts';
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
  /** Enters walkthrough at the golf bay and starts the first-person shot. */
  startGolfSimulatorShot(): void;
  /** Enters walkthrough if needed when a first-person workout interactable starts. */
  startFirstPersonInteractable?(interactableId: string): void;
  /** Home / integration click hook; KNX-backed pseudo-devices route through it. */
  onObjectInteraction(data: InteractiveUserData): void;
}

/** Door shadow refresh throttle while doors animate (ms). */
const DOOR_SHADOW_THROTTLE_MS = 32;
const DOOR_SHADOW_THROTTLE_WALKING_MS = 90;
const WALK_DOOR_SHADOW_SETTLE_MS = 250;

/**
 * 3D device state: KNX-driven fixtures (circuit lighting, switch LEDs, Frame TV,
 * motion sensors), bifolds, car gates, doors and other interactables, UFH and
 * security overlays.
 */
export class DeviceService<TSecurity extends SecurityOverlay3D = SecurityOverlay3D> {
  /** Fires after user-driven device changes (bifolds, gates, interactables). */
  public readonly changed = new Emitter<[]>();
  public readonly circuitLighting: CircuitLightingController;
  public readonly bifolds: BifoldDoorAnimator;
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
      tvArtTextures: content.tvArtTextures,
      tvOffTexture: content.tvOffTexture,
      lodRegistrations: profile.lodRegistrations,
    });
    this.bifolds = new BifoldDoorAnimator(content.bifoldPanels, profile.bifoldTrack);
    content.ufhSystem?.subscribe(() => host.invalidator.requestRender());
  }

  /** Adds every animated object (bifolds, doors, gates) so it keeps matrix auto-update. */
  public collectDynamicObjects(target: Set<THREE.Object3D>): void {
    for (const panel of this.bifolds.getPanels()) {
      panel.group.traverse((child) => target.add(child));
    }
    this.interactions.collectDynamicObjects(target);
  }

  /** Adds only boot-active animated objects (bifolds + ambient flame loops) excluded from initial static batching. */
  public collectBatchExcludedObjects(target: Set<THREE.Object3D>): void {
    for (const panel of this.bifolds.getPanels()) {
      panel.group.traverse((child) => target.add(child));
    }
    this.interactions.collectBootPinnedDynamicObjects(target);
  }

  public handleInteractable(interactableId: string): boolean {
    if (interactableId === 'golf-simulator-shot') {
      if (!this.interactions.triggerGolfSimulatorShot()) return false;
      this.host.startGolfSimulatorShot();
      this.host.invalidator.requestRender();
      this.changed.emit();
      return true;
    }
    // KNX-backed pseudo-devices (car-gates, kitchen-bifolds, frame-tv) take the same
    // path as a 3D click so the bus stays the source of truth.
    const pseudo = this.interactions.getPseudoDeviceUserData(interactableId);
    if (pseudo) {
      this.host.onObjectInteraction(pseudo);
      this.host.invalidator.requestRender();
      this.changed.emit();
      return true;
    }
    const handled = this.interactions.handleInteractableClick(interactableId);
    if (handled) {
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

  public setMotionSensorStates(kitchenMotion: boolean, utilityMotion: boolean): void {
    this.circuitLighting.setMotionSensorStates(kitchenMotion, utilityMotion);
    this.host.invalidator.requestRender();
  }

  public setTVArtState(artModeOn: boolean, artIndex: number): void {
    if (this.circuitLighting.setTVArtState(artModeOn, artIndex)) {
      this.host.invalidator.requestRender();
    }
  }

  public isBifoldsOpen(): boolean {
    return this.bifolds.isOpen();
  }

  public toggleBifolds(): boolean {
    const open = this.bifolds.toggle();
    this.host.invalidator.requestRender();
    this.changed.emit();
    return open;
  }

  public isCarGatesOpen(): boolean {
    return this.interactions.isCarGatesOpen();
  }

  /** Mirrors the KNX gate state (no change event: the bus already announced it). */
  public setCarGatesOpen(isOpen: boolean): void {
    if (this.interactions.isCarGatesOpen() !== isOpen) {
      this.interactions.setCarGatesOpen(isOpen);
      this.host.invalidator.requestRender();
    }
  }

  public toggleCarGates(): boolean {
    const next = !this.interactions.isCarGatesOpen();
    this.interactions.setCarGatesOpen(next);
    this.host.invalidator.requestRender();
    this.changed.emit();
    return next;
  }

  public getCarGatesProgress(): number {
    return this.interactions.getCarGatesProgress();
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

  /**
   * Steps bifold / door / gate animations and throttles shadow-map refreshes
   * while they move. `walkingCameraMoved` slows the throttle during walkthrough
   * motion.
   */
  public hasActiveAnimations(): boolean {
    return this.activeAnimations;
  }

  /** True ONLY while bifold or hinged/portal doors are moving (or finishing their final frame), excluding ambient loops. */
  public hasPortalOrDoorAnimations(): boolean {
    return this.portalOrDoorAnimations;
  }

  public update(
    dtSeconds: number,
    walkingCameraMoved: boolean,
    isWalkthroughActive = false
  ): void {
    const bifoldMoving = this.bifolds.update(dtSeconds);
    const doorMoving = this.interactions.update(dtSeconds);
    const ambientMoving = this.interactions.stepAmbient(dtSeconds);
    const wasAnimatingDoors = this.doorsWereAnimating;
    this.portalOrDoorAnimations = bifoldMoving || doorMoving || wasAnimatingDoors;
    this.activeAnimations = this.portalOrDoorAnimations || ambientMoving;

    const now = performance.now();
    if (walkingCameraMoved) {
      this.lastWalkingMotionMs = now;
    }

    const { invalidator } = this.host;
    const suppressMidWalkDoorShadows =
      (isWalkthroughActive || walkingCameraMoved) && !bifoldMoving;

    if (bifoldMoving || doorMoving) {
      this.doorsWereAnimating = true;
      if (suppressMidWalkDoorShadows) {
        this.pendingWalkDoorShadowFlush = true;
      } else if (bifoldMoving && (isWalkthroughActive || walkingCameraMoved)) {
        // Exterior bifolds while walking: defer single shadow bake until motion settles
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
      !bifoldMoving &&
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
