import type * as THREE from 'three';
import type { FloorViewMode } from '../../../core/types/scene.ts';

/** Shared render / shadow invalidation handle passed to every viewer service. */
export interface RenderInvalidator {
  /** Marks the frame dirty so the next `update()` renders. */
  requestRender(): void;
  /** Marks the (manually updated) shadow maps for re-render. */
  invalidateShadows(): void;
}

/** Camera + floor state published to view listeners (e.g. the focus HUD). */
export interface PropertySceneViewState {
  readonly cameraPosition: THREE.Vector3;
  readonly target: THREE.Vector3;
  readonly isOrthographic: boolean;
  readonly orthoZoom: number;
  readonly floorViewMode: FloorViewMode;
}

/** Room framing target for `flyToRoomBounds`. */
export interface RoomFramingBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** Viewport-space projection of a world point (CSS px relative to the canvas). */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
}
