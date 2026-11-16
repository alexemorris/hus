import type { CircuitId, RoomMotionSensorId } from './knx.ts';
import type { RoomZoneId } from './topology.ts';

export type TimeOfDay = 'day' | 'dusk' | 'night';

/** One storey of a property, lowest first. */
export interface FloorDefinition {
  readonly id: string;
  readonly label?: string;
  readonly shortLabel?: string;
  readonly order?: number;
  /** Finished floor elevation (m). */
  readonly elevationY: number;
  readonly elevationM?: number;
  readonly ceilingHeight?: number;
  readonly ceilingCutawayY?: number;
}

export type FloorViewMode = 'ground' | 'first' | 'all' | (string & {});

/** Camera preset identifier (`'overview'`, `'isometric'`, `'top'`, or any home-defined preset id). */
export type CameraPresetName = 'overview' | 'isometric' | 'top' | (string & {});

export type TradeCategoryId =
  | 'structure'
  | 'envelope'
  | 'joinery'
  | 'electrical'
  | 'plumbing'
  | 'heating'
  | 'smart'
  | 'furniture'
  | 'external'
  | 'vehicle';

export interface InteractiveUserData {
  readonly isKNXSwitch?: boolean;
  readonly roomMotionSensorId?: RoomMotionSensorId;
  readonly isUniFiCamera?: boolean;
  readonly cameraEntityId?: string;
  readonly isUniFiAccessReader?: boolean;
  readonly accessEntityId?: string;
  readonly interactableId?: string;
  /** Explicit hover/crosshair prompt label for custom or delegated devices. */
  readonly interactionPromptLabel?: string;
  readonly switchLocation?: string;
  readonly switchDirection?: 'up' | 'down';
  readonly switchPa?: string;
  /** 1-based gang on a multi-gang KNX push-button plate. */
  readonly switchGang?: number;
  /** Physical address of a KNX presence detector (ceiling PIR) mesh. */
  readonly presenceDetectorPa?: string;
  readonly sensorGa?: string;
  readonly zoneId?: RoomZoneId;
  readonly circuitId?: CircuitId;
  readonly electricalSwitchId?: string;
  readonly electricalDimmerId?: string;
  readonly ufhZoneId?: string;
  readonly isKnxTempSensor?: boolean;
  readonly isClimbableLadder?: boolean;
  readonly isCustomInteraction?: boolean;
  readonly zoneSceneSwitchZoneId?: RoomZoneId;
  /** Generic rendering / batching / LOD / walkthrough / trade traits. */
  readonly isAnimatedDoor?: boolean;
  readonly isExteriorGate?: boolean;
  readonly isDynamicBarrier?: boolean;
  readonly isWalkableStep?: boolean;
  readonly isDynamicInteractionObject?: boolean;
  readonly isDynamicObject?: boolean;
  readonly isRigidDynamicGroup?: boolean;
  readonly lodImportance?: 'shell' | 'standard' | 'hero';
  readonly tradeCategory?: TradeCategoryId;
  readonly isAppliance?: boolean;
  readonly isJoineryDoor?: boolean;
}

export interface CutawayWallDescriptor {
  readonly axis: 'x' | 'z';
  readonly coord: number;
  readonly minSpan: number;
  readonly maxSpan: number;
  readonly floor: 'ground' | 'first' | (string & {});
  readonly outwardSide?: 'north' | 'south' | 'east' | 'west';
  readonly includeInFirstFloorCutaway?: boolean;
}

export type Vec3Tuple = readonly [number, number, number];

export type AnnotationToolMode = 'pin' | 'move' | 'rotate' | 'measure';

export type AnnotationKind = 'pin' | 'move' | 'measure';

export type GizmoTransformMode = 'translate' | 'rotate';

export interface SceneCameraPoseSnapshot {
  readonly position: Vec3Tuple;
  readonly target: Vec3Tuple;
  readonly floorViewMode: FloorViewMode;
  readonly ceilingCutaway: boolean;
  readonly isOrthographic: boolean;
}

export interface SceneMeshDiagnosticInfo {
  readonly meshName: string;
  readonly parentChain: readonly string[];
  readonly geometrySummary: string;
  readonly materialSummary: string;
  readonly meshWorldCenter: Vec3Tuple;
  readonly meshBoundingBoxMin: Vec3Tuple;
  readonly meshBoundingBoxMax: Vec3Tuple;
  readonly meshBoundingBoxSize: Vec3Tuple;
  readonly cutawayWall?: CutawayWallDescriptor;
}

export interface SceneObjectTransformAnnotation {
  readonly targetUuid: string;
  readonly targetName: string;
  readonly targetPath: readonly string[];
  readonly targetKind: 'group' | 'mesh';
  readonly initialWorldCenter: Vec3Tuple;
  newWorldCenter: Vec3Tuple;
  deltaTranslation: Vec3Tuple;
  readonly initialObjectPosition: Vec3Tuple;
  newObjectPosition: Vec3Tuple;
  readonly initialRotationDeg: Vec3Tuple;
  newRotationDeg: Vec3Tuple;
  deltaRotationDeg: Vec3Tuple;
}

export interface SceneMeasurementAnnotation {
  readonly startPoint: Vec3Tuple;
  readonly startNormal: Vec3Tuple;
  readonly startMeshName: string;
  readonly endPoint: Vec3Tuple;
  readonly endNormal: Vec3Tuple;
  readonly endMeshName: string;
  readonly deltaXYZ: Vec3Tuple;
  readonly horizontalDistanceM: number;
  readonly distanceM: number;
  targetMeasurement?: string;
}

export interface LiveMeasurePreviewState {
  readonly active: boolean;
  readonly startPoint: Vec3Tuple | null;
  readonly currentEndPoint: Vec3Tuple | null;
  readonly deltaXYZ: Vec3Tuple | null;
  readonly horizontalDistanceM: number | null;
  readonly distanceM: number | null;
  readonly axisSnapLocked: boolean;
}

export interface SceneAnnotationHit {
  readonly kind?: AnnotationKind;
  readonly worldPoint: Vec3Tuple;
  readonly worldNormal: Vec3Tuple;
  readonly roomZoneId: string;
  readonly roomName: string;
  readonly meshInfo: SceneMeshDiagnosticInfo;
  readonly cameraPose: SceneCameraPoseSnapshot;
  objectTransform?: SceneObjectTransformAnnotation;
  measurement?: SceneMeasurementAnnotation;
}

export interface SceneAnnotationRecord extends SceneAnnotationHit {
  readonly id: number;
  readonly createdAt: string;
  note: string;
}

/** Formats meters as `1.234 m (123.4 cm · 4' 0.6")` for scene measurements. */
export function formatMetersAndFeetInches(meters: number): string {
  const cm = (meters * 100).toFixed(1);
  const totalInches = meters * 39.3700787;
  const feet = Math.floor(totalInches / 12);
  const inches = (totalInches - feet * 12).toFixed(1);
  return `${meters.toFixed(3)} m (${cm} cm · ${feet}' ${inches}")`;
}
