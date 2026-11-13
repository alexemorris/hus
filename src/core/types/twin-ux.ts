import type { FloorViewMode } from './scene.ts';
import type { FloorId, RoomZoneId } from './topology.ts';

/**
 * Shared UX contracts for the parallel UX/usability overhaul.
 * Shared contract types consumed across engine, UI, and integration modules.
 */

/** User-facing graphics mode. `auto` lets the PerformanceGovernor pick and adapt the tier. */
export type GraphicsTier = 'low' | 'medium' | 'high' | 'ultra';
export type GraphicsMode = 'auto' | GraphicsTier;

/** Concrete render settings applied for a tier (never includes lighting intensities). */
export interface GraphicsTierSettings {
  readonly tier: GraphicsTier;
  /** Renderer pixel ratio (already clamped to device DPR). */
  readonly pixelRatio: number;
  readonly postProcessing: boolean;
  readonly ambientOcclusion: boolean;
  readonly bloom: boolean;
  readonly sharpen: boolean;
  readonly shadowMapSize: 1024 | 2048 | 4096;
  /** Multiplier applied to LOD detail distances. */
  readonly lodDistanceScale: number;
  /** Max distance (m) for `userData.lodTier === 'high'` props. */
  readonly highDetailMaxDistance: number;
}

/** Persona-specific overlay of the same model. */
export type TradeView = 'owner' | 'architect' | 'builder' | 'electrician' | 'plumber';

export const TRADE_VIEW_LABELS: Readonly<Record<TradeView, string>> = {
  owner: 'Owner',
  architect: 'Architect',
  builder: 'Builder',
  electrician: 'Electrician',
  plumber: 'Plumber',
};

/** Physical architectural paint sheen identifiers matching `husjs/materials`. */
export type PaintSheen =
  | 'limewash'
  | 'dead-flat'
  | 'estate-emulsion'
  | 'modern-emulsion'
  | 'estate-eggshell'
  | 'exterior-eggshell'
  | 'satinwood'
  | 'modern-eggshell'
  | 'full-gloss';

/** Structured paint swatch & sheen metadata for a single room surface (walls, ceiling, trim). */
export interface RoomPaintSurfaceSpec {
  readonly brand?: string;
  readonly name: string;
  readonly code?: string;
  readonly hex: string;
  readonly sheen?: PaintSheen | string;
  readonly notes?: string;
}

/** Complete architectural paint, surface finish, joinery, and renovation metadata for a room/zone. */
export interface RoomFinishSpec {
  readonly walls?: RoomPaintSurfaceSpec | readonly RoomPaintSurfaceSpec[];
  readonly ceiling?: RoomPaintSurfaceSpec;
  readonly trim?: RoomPaintSurfaceSpec;
  readonly doors?: string;
  readonly windows?: string;
  readonly flooring?: string;
  readonly tilingOrWallpaper?: string;
  readonly joinery?: string;
  readonly notes?: readonly string[];
}

/** A single controllable light/circuit shown in the room context panel. */
export interface RoomLightControl {
  /** KNX circuit id understood by `KNXPropertyBusController.toggleCircuit` / live levels. */
  readonly circuitId: string;
  readonly label: string;
  readonly dimmable: boolean;
}

export interface RoomSceneControl {
  readonly id: string;
  readonly label: string;
  /** KNX scene number for `recallScene(sceneNumber, pa)`. */
  readonly sceneNumber: number;
  readonly pa: string;
}

export interface RoomDeviceControl {
  /** Interactable id handled by `scene.handleInteractableClick(id)`. */
  readonly interactableId: string;
  readonly label: string;
}

/** Everything the room context panel needs for one room. */
export interface RoomManifestEntry {
  readonly zoneId: RoomZoneId;
  readonly label: string;
  /** Navigator group id (e.g. `'house-ground'`, `'outbuildings'`, or any house-defined group). */
  readonly group: 'house-ground' | 'house-first' | 'outbuildings' | 'grounds' | (string & {});
  readonly floor: FloorId;
  readonly lights: readonly RoomLightControl[];
  readonly scenes: readonly RoomSceneControl[];
  readonly devices: readonly RoomDeviceControl[];
  /** UFH zone id if the room has underfloor heating. */
  readonly ufhZoneId?: string;
  /** Embedded room paint swatches, architectural surface finishes & joinery metadata. */
  readonly finishes?: RoomFinishSpec;
  /** Optional architectural & renovation notes attached directly to the room. */
  readonly notes?: readonly string[];
}

/** Serializable view state used for share links (`?v=` URL param). */
export interface ShareViewState {
  readonly cam: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly floor: FloorViewMode;
  readonly ortho: boolean;
  readonly room?: RoomZoneId;
  readonly view: TradeView;
  readonly guest: boolean;
}
