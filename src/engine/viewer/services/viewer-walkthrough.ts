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
  onInteractWithMesh(mesh: THREE.Object3D): void;
  /** Optional hook when walkthrough barges a door open so portal/room LOD updates immediately. */
  onDoorBarged?(): void;
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
      host.getInteractions().describeInteractable(mesh),
    onInteractWithMesh: (mesh) => host.onInteractWithMesh(mesh),
    onTriggerCustomInteraction: (id) => rendered(host.getInteractions().triggerCustomInteraction(id)),
    getCustomInteractionElapsedSec: (id) => host.getInteractions().getCustomInteractionElapsedSec(id),
    getCustomInteractionPrompt: (id) => host.getInteractions().getCustomInteractionPromptLabel(id),
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
    onBargeWalkthroughDoor: (interactableId, isSprinting, footX, footY, footZ, moveDirX, moveDirZ) => {
      const changed = host
        .getInteractions()
        .bargeOpenWalkthroughDoor(interactableId, isSprinting, footX, footY, footZ, moveDirX, moveDirZ);
      if (changed) host.onDoorBarged?.();
      return rendered(changed);
    },
    onProximityBargeDoors: (footX, footY, footZ, moveDirX, moveDirZ, isSprinting) => {
      const changed = host
        .getInteractions()
        .bargeNearbyWalkthroughDoors(footX, footY, footZ, moveDirX, moveDirZ, isSprinting);
      if (changed) host.onDoorBarged?.();
      return rendered(changed);
    },
    onStateChanged: () => host.onStateChanged(),
    onPoseUpdated: () => host.onPoseUpdated(),
    hooks: host.walkthroughHooks,
  });
}
