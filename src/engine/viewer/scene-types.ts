/**
 * three.js-dependent scene-building types (moved out of src/core so core stays
 * renderer-free). Pure data types live in core/types/scene.ts.
 */
import type * as THREE from 'three';
import type { CircuitId } from '../../core/types/knx.ts';
import type { FloorViewMode } from '../../core/types/scene.ts';
import type { BuildingId, FloorId, RoomBoundingBox, RoomZoneId } from '../../core/types/topology.ts';
import type { SceneInteractionManager } from '../interaction/interaction-manager.ts';

export interface CameraPresetDefinition {
  readonly id: string;
  readonly label: string;
  readonly buildingId: BuildingId;
  readonly zoneId?: RoomZoneId;
  readonly floorViewMode?: FloorViewMode;
  readonly pos: THREE.Vector3;
  readonly target: THREE.Vector3;
  readonly useOrthographic?: boolean;
  readonly orthoZoom?: number;
}

export interface GlowPoolEntry {
  readonly mat: THREE.MeshBasicMaterial;
  readonly maxOpacity: number;
}

export interface LightCircuitGroup {
  readonly lights: THREE.PointLight[];
  readonly emissives: THREE.MeshStandardMaterial[];
  readonly cones: THREE.MeshBasicMaterial[];
  readonly pools: GlowPoolEntry[];
  readonly maxIntensity: number;
}

export type LightGroupMap = Record<CircuitId, LightCircuitGroup>;

export interface BifoldPanelRef {
  readonly group: THREE.Group;
  readonly closedX: number;
  readonly openX: number;
  readonly dir: number;
}

export interface CameraTweenState {
  readonly startPos: THREE.Vector3;
  readonly endPos: THREE.Vector3;
  readonly startTarget: THREE.Vector3;
  readonly endTarget: THREE.Vector3;
  elapsed: number;
  readonly duration: number;
}

export interface CutawayWallGroups {
  readonly southWest: THREE.Group;
  readonly west: THREE.Group;
  readonly north: THREE.Group;
  readonly east: THREE.Group;
}

export interface FloorLayerEntry {
  readonly id: string;
  readonly elevationY: number;
  readonly ceilingHeight: number;
  readonly contentGroup: THREE.Group;
  readonly slabGroup: THREE.Group;
  readonly ceilingGroup: THREE.Group;
}

export interface FloorBuilderScope {
  readonly id: string;
  readonly elevationY: number;
  readonly ceilingHeight: number;
  readonly group: THREE.Group;
  readonly slabGroup: THREE.Group;
  readonly ceilingGroup: THREE.Group;
  add(...objects: THREE.Object3D[]): void;
}

export interface SceneBuilderContext {
  readonly scene: THREE.Scene;
  readonly firstFloorMeshGroup: THREE.Group;
  readonly groundFloorCeilingGroup: THREE.Group;
  readonly ceilingMeshGroup: THREE.Group;
  readonly roof?: THREE.Group;
  readonly site?: THREE.Group;
  floor?(floorId: string): FloorBuilderScope;
  readonly ceilingCutaway: boolean;
  readonly cutawayWallGroups: CutawayWallGroups;
  readonly bifoldPanels: BifoldPanelRef[];
  readonly interactiveMeshes: THREE.Object3D[];
  readonly interactions: SceneInteractionManager;
  readonly lightGroups: LightGroupMap;
  addGlowPool(
    circuitId: CircuitId,
    x: number,
    y: number,
    z: number,
    radius: number,
    maxOpacity?: number,
    rotX?: number
  ): void;
  registerSwitchLedMaterial?(
    circuitId: CircuitId,
    mat: THREE.MeshStandardMaterial
  ): void;
}

export interface ZoneIndicatorMaterials {
  readonly wallSwitchLedMat?: THREE.MeshStandardMaterial;
  readonly courtyardSwitchLedMat?: THREE.MeshStandardMaterial;
  readonly utilitySwitchLedMat?: THREE.MeshStandardMaterial;
  readonly kitchenSensorLedMat?: THREE.MeshStandardMaterial;
  readonly utilitySensorLedMat?: THREE.MeshStandardMaterial;
  readonly tvScreenMat?: THREE.MeshStandardMaterial;
}

export interface SceneZoneModule {
  readonly id: string;
  readonly name: string;
  readonly buildingId: BuildingId;
  readonly floorId: FloorId;
  readonly zoneIds: readonly RoomZoneId[];
  readonly interiorBounds?: readonly RoomBoundingBox[];
  readonly cameraPresets?: readonly CameraPresetDefinition[];
  build(ctx: SceneBuilderContext): ZoneIndicatorMaterials;
}
