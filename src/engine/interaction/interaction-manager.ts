/**
 * Backwards-compatible entry point. The interaction system now lives in
 * `interaction-registry.ts` (registry + routing) and `handlers/*` (per-device behaviour).
 */
export {
  InteractionRegistry,
  InteractionRegistry as SceneInteractionManager,
  type InteractableInfo,
  type InteractableKind,
} from './interaction-registry.ts';
