import type * as THREE from 'three';
import type { FloorSurfaceType } from '../../../core/types/acoustics.ts';
import type { RoomZoneId } from '../../../core/types/topology.ts';
import type { CameraRig } from '../../camera/camera-rig.ts';
import type { SceneInteractionManager } from '../../interaction/interaction-manager.ts';
import {
  type HouseWalkthroughHooks,
  WalkthroughController,
} from '../../walkthrough/walkthrough-controller.ts';
import type { RenderInvalidator } from './viewer-types.ts';

export interface ViewerWalkthroughHost {
  readonly canvas: HTMLCanvasElement;
  readonly scene: THREE.Scene;
  readonly rig: CameraRig;
  readonly invalidator: RenderInvalidator;
  /** Per-house walkthrough rules (spawns, stairs, ladders, cutscenes, collision). */
  readonly walkthroughHooks?: HouseWalkthroughHooks;
  getRoomMinYAt(x: number, y: number, z: number): number | null;
  getCurrentRoomId?(): RoomZoneId | null;
  getRoomFloorSurface?(roomId: RoomZoneId): FloorSurfaceType | undefined;
  /** Resolved lazily: content is built after the walkthrough controller. */
  getInteractiveMeshes(): readonly THREE.Object3D[];
  getInteractions(): SceneInteractionManager;
  isBifoldsOpen(): boolean;
  onInteractWithMesh(mesh: THREE.Object3D): void;
  /** Walkthrough entered / exited. */
  onStateChanged(): void;
  /** Eye pose moved. */
  onPoseUpdated(): void;
}

/** Builds the first-person walkthrough wired to the viewer's interactables. */
export function createViewerWalkthrough(host: ViewerWalkthroughHost): WalkthroughController {
  const rendered = (changed: boolean): boolean => {
    if (changed) host.invalidator.requestRender();
    return changed;
  };
  return new WalkthroughController({
    canvas: host.canvas,
    scene: host.scene,
    rig: host.rig,
    getRoomMinYAt: (x, y, z) => host.getRoomMinYAt(x, y, z),
    getCurrentRoomId: () => host.getCurrentRoomId?.() ?? null,
    getRoomFloorSurface: (roomId) => host.getRoomFloorSurface?.(roomId),
    getInteractiveMeshes: () => host.getInteractiveMeshes(),
    describeInteractable: (mesh) =>
      host.getInteractions().describeInteractable(mesh, host.isBifoldsOpen()),
    onInteractWithMesh: (mesh) => host.onInteractWithMesh(mesh),
    onTriggerGolfSimulatorShot: () => rendered(host.getInteractions().triggerGolfSimulatorShot()),
    getGolfSimulatorShotElapsedSec: () => host.getInteractions().getGolfSimulatorShotElapsedSec(),
    getGolfSimulatorPrompt: () => host.getInteractions().getGolfSimulatorPromptLabel(),
    getActiveFirstPersonPose: () => host.getInteractions().getActiveFirstPersonPose(),
    cancelActiveFirstPerson: () => rendered(host.getInteractions().cancelActiveFirstPerson()),
    getProximityAnimatedInteractable: (footX, footY, footZ) => {
      const hit = host.getInteractions().getProximityAnimatedInteractable(footX, footY, footZ);
      if (!hit) return null;
      return {
        id: hit.id,
        prompt: hit.prompt,
        trigger: () => rendered(host.getInteractions().handleInteractableClick(hit.id)),
      };
    },
    onBargeWalkthroughDoor: (interactableId, isSprinting, footX, footY, footZ, moveDirX, moveDirZ) =>
      rendered(
        host
          .getInteractions()
          .bargeOpenWalkthroughDoor(interactableId, isSprinting, footX, footY, footZ, moveDirX, moveDirZ)
      ),
    onProximityBargeDoors: (footX, footY, footZ, moveDirX, moveDirZ, isSprinting) =>
      rendered(
        host
          .getInteractions()
          .bargeNearbyWalkthroughDoors(footX, footY, footZ, moveDirX, moveDirZ, isSprinting)
      ),
    onStateChanged: () => host.onStateChanged(),
    onPoseUpdated: () => host.onPoseUpdated(),
    hooks: host.walkthroughHooks,
  });
}
