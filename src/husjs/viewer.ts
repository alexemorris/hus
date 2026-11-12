export { PropertyScene } from '../engine/viewer/property-scene.ts';
export { ViewerComposition } from '../engine/viewer/viewer-composition.ts';
export * from '../engine/viewer/property-scene-profile.ts';
export * from '../engine/viewer/scene-content.ts';
export * from '../engine/viewer/scene-types.ts';
export * from '../engine/viewer/scene-zone-registry.ts';
export { CutawayController } from '../engine/cutaway/cutaway-controller.ts';
export { SceneBatchOptimizer } from '../engine/rendering/scene-batch-optimizer.ts';
export { RoomLodController } from '../engine/lod/lod-manager.ts';
export {
  PortalVisibilitySolver,
  type ExteriorWindowPortal,
  type InteriorRoomPortal,
} from '../engine/lod/portal-visibility-solver.ts';
export { discoverExteriorGlazedPortals } from '../engine/lighting/baked-light-volume.ts';
export {
  SITE_GROUND_Y,
  buildAridCliffRockTextureData,
  buildAridSoilTextureData,
  buildMeadowTextureData,
  buildTopographicSiteGroundGeometry,
  createSiteGround,
  raycastTopographicSiteGround,
  type AridCliffRockTextureBundle,
  type SiteGround,
} from '../engine/lighting/env/site-ground.ts';
export { FocusController, type FocusRoom, type FocusThresholds } from '../engine/rooms/focus-controller.ts';
export { RoomTracker } from '../engine/rooms/room-tracker.ts';
export { SceneAnnotationStore } from '../engine/annotation/annotation-system.ts';
export { audioEngine, AudioEngine, soundEngine, SoundEngine } from '../engine/audio/sound-engine.ts';
export { SoundscapeController } from '../engine/audio/soundscape-controller.ts';
export * from '../engine/audio/acoustic-occlusion.ts';
export { BifoldDoorAnimator } from '../engine/interaction/bifold-animator.ts';
export type {
  AnimatedInteractable,
  FirstPersonPoseSample,
} from '../engine/interaction/handlers/animated-interactable.ts';
export { symmetricConflicts, type DoorPolicy } from '../engine/interaction/handlers/door-policy.ts';
export {
  applyHingedDoorPose,
  getClosedDoorwayGeometry,
  isWalkthroughDoorState,
  type HingedDoorState,
} from '../engine/interaction/handlers/hinged-doors.ts';
export { SceneInteractionManager } from '../engine/interaction/interaction-manager.ts';
export { InteractionRegistry } from '../engine/interaction/interaction-registry.ts';
export { intersectVisibleObjects, isObjectVisibleInHierarchy } from '../engine/util/object-utils.ts';
export {
  WalkthroughController,
  WALKTHROUGH_FOV_PRESETS,
  type HouseWalkthroughHooks,
  type WalkthroughClimbableController,
  type WalkthroughClimbableStepResult,
  type WalkthroughCutsceneController,
  type WalkthroughCutscenePose,
  type WalkthroughSpawnPoint,
} from '../engine/walkthrough/walkthrough-controller.ts';
export { WalkthroughDoorBargeAndCollisionSolver } from '../engine/walkthrough/parts/walkthrough-door-barge.ts';
export type { FloorSurfaceType } from '../engine/walkthrough/parts/walkthrough-footstep-audio.ts';
export {
  CROUCH_EYE_HEIGHT,
  MAX_PITCH_RAD,
  STANDING_EYE_HEIGHT,
  findNearestWalkthroughSpawn,
  type WalkthroughCollisionMeshRule,
  type WalkthroughCutsceneCurrentPose,
  type WalkthroughCutsceneHost,
} from '../engine/walkthrough/parts/walkthrough-spawns.ts';
export * from '../engine/export/glb-scene-exporter.ts';

export * from '../engine/assets/smart-asset.ts';
export { AssetInspectorController } from '../engine/assets/asset-inspector-controller.ts';

export { CircuitLightingController } from '../engine/lighting/circuit-lighting.ts';
