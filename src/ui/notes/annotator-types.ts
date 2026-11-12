import type { TwinMovableTarget } from '../../core/types/twin-api.ts';
import type {
  AnnotationKind,
  SceneAnnotationHit,
  SceneObjectTransformAnnotation,
} from '../../core/types/scene.ts';

export interface ActiveTransformUIState {
  readonly baseHit: SceneAnnotationHit;
  readonly transform: SceneObjectTransformAnnotation;
  readonly candidates: readonly TwinMovableTarget[];
}

export interface ProjectedPinScreenCoord {
  readonly id: number;
  readonly kind: AnnotationKind;
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
}
