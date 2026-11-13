/**
 * General, house-agnostic architectural & first-person walkthrough audit suite.
 *
 * Packages four deterministic verification passes for any Hus.js house scene:
 * 1. `zFighting`: world-space coplanar triangle overlap detection (`epsilonM = 0.00035`).
 * 2. `cutaway`: cutaway wall descriptor validity, freestanding interior furniture/sanitaryware
 *    mistakenly tagged with `cutawayWall`, and likely missing `tagCutaway` wall attachments.
 * 3. `doorSwings`: swept 3D OBB collision clearance for hinged doors and sliding drawers/panels.
 * 4. `walkthrough`: staircase vertical headroom (`>= 1.95 m`) and `20 cm` first-person capsule (`5'10"`,
 *    `r = 0.24 m`, `stepHeight = 0.24 m`) BFS reachability across habitable `roomZones`.
 */
import * as THREE from 'three';
import type { RoomZoneLodRegistration } from '../../core/entities.ts';
import type { TerrainSurfaceSampler } from '../../core/geo/terrain-modifiers.ts';
import type { CutawayWallDescriptor, FloorDefinition } from '../../core/types/scene.ts';
import type { RoomBoundingBox, RoomZoneDefinition } from '../../core/types/topology.ts';
import {
  applyHingedDoorPose,
  createHingedDoorState,
  getDefaultDoorOpenAngle,
  type HingedDoorState,
} from '../interaction/handlers/hinged-doors.ts';
import type { SlidingDrawerState } from '../interaction/handlers/sliding-drawers.ts';
import type { DoorPolicy } from '../interaction/handlers/door-policy.ts';
import type { InteractionRegistry } from '../interaction/interaction-registry.ts';
import {
  collectRegisteredStaircases,
  createAutoWalkthroughElevationComposer,
  type TerrainElevationFn,
} from '../walkthrough/auto-elevation-composer.ts';
import {
  detectZFighting,
  type DetectZFightingOptions,
  type ZFightingFinding,
} from './z-fighting-detector.ts';

export type AuditCheckName = 'zFighting' | 'cutaway' | 'doorSwings' | 'walkthrough';
export type AuditSeverity = 'error' | 'warning';
export type AuditCheckStatus = 'pass' | 'warn' | 'fail' | 'skipped';

export interface AuditFinding {
  readonly check: AuditCheckName;
  readonly severity: AuditSeverity;
  readonly code: string;
  readonly message: string;
  readonly objectName?: string;
  readonly targetName?: string;
  readonly position?: readonly [number, number, number];
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface AuditCheckSummary {
  readonly check: AuditCheckName;
  readonly status: AuditCheckStatus;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly findings: readonly AuditFinding[];
  readonly durationMs: number;
}

export interface ArchitecturalAuditReport {
  readonly passed: boolean;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly checks: Readonly<Record<AuditCheckName, AuditCheckSummary>>;
  readonly findings: readonly AuditFinding[];
  readonly zFightingFindings: readonly ZFightingFinding[];
  readonly durationMs: number;
}

export interface AuditRoomZoneInput {
  readonly id?: string;
  readonly zoneId?: string;
  readonly name?: string;
  readonly shortName?: string;
  readonly floorId: string;
  readonly bounds: RoomBoundingBox;
  readonly isInterior?: boolean;
  readonly walkingFloorY?: number;
  readonly excludedCutout?: (x: number, z: number) => boolean;
}

export interface CutawayAuditOptions {
  readonly floors?: readonly FloorDefinition[];
  /** Maximum perpendicular distance (m) from declared cutaway wall plane before an object is flagged as freestanding (default `0.45`). */
  readonly maxWallMountDistanceM?: number;
  /** Exterior cutaway wall band thickness (m) within which untagged wall attachments are reported (default `0.18`). */
  readonly exteriorWallBandM?: number;
  /** Maximum width (m) along the wall for perpendicular partition end-butts to exclude (default `0.35`). */
  readonly maxPartitionButtWidthM?: number;
}

export interface DoorSwingAuditOptions {
  readonly interactions?: InteractionRegistry;
  readonly doorPolicy?: DoorPolicy;
  /** Number of sweep pose samples across `(0 .. openAngle]` (default `5`). */
  readonly sampleSteps?: number;
  /** Minimum OBB penetration allowance in metres to ignore flush hardware/seals (default `0.006`). */
  readonly clearanceToleranceM?: number;
}

export interface WalkthroughAuditOptions {
  readonly floors?: readonly FloorDefinition[];
  readonly roomZones?:
    | readonly (RoomZoneDefinition | RoomZoneLodRegistration | AuditRoomZoneInput)[]
    | Readonly<Record<string, RoomZoneDefinition | undefined>>;
  readonly elevationSampler?: (x: number, z: number, currentFootY: number) => number;
  readonly terrainSampler?: TerrainElevationFn | TerrainSurfaceSampler;
  readonly interactions?: InteractionRegistry;
  readonly doorPolicy?: DoorPolicy;
  readonly entryPosition?: readonly [number, number, number];
  readonly entryZoneId?: string;
  /** Minimum clear vertical headroom above staircase walkable path (default `1.95 m`). */
  readonly minStairHeadroomM?: number;
  /** Horizontal BFS grid resolution in metres (default `0.20 m`). */
  readonly gridStepM?: number;
  /** First-person walker capsule radius in metres (default `0.24 m`). */
  readonly capsuleRadiusM?: number;
  /** First-person walker standing height in metres (default `1.778 m` = `5'10"`). */
  readonly capsuleHeightM?: number;
  /** Maximum walkable step-up height between adjacent 20 cm cells (default `0.24 m`). */
  readonly stepHeightM?: number;
}

export interface ArchitecturalAuditOptions {
  readonly floors?: readonly FloorDefinition[];
  readonly roomZones?: WalkthroughAuditOptions['roomZones'];
  readonly interactions?: InteractionRegistry;
  readonly doorPolicy?: DoorPolicy;
  readonly elevationSampler?: WalkthroughAuditOptions['elevationSampler'];
  readonly terrainSampler?: WalkthroughAuditOptions['terrainSampler'];
  readonly entryPosition?: readonly [number, number, number];
  readonly entryZoneId?: string;
  readonly zFighting?: DetectZFightingOptions;
  readonly cutaway?: CutawayAuditOptions;
  readonly doorSwings?: DoorSwingAuditOptions;
  readonly walkthrough?: WalkthroughAuditOptions;
  readonly skipChecks?: readonly AuditCheckName[];
}

interface OrientedBox3D {
  readonly center: THREE.Vector3;
  readonly axes: readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  readonly halfSizes: readonly [number, number, number];
  readonly worldAabb: THREE.Box3;
}

interface NormalizedAuditZone {
  readonly id: string;
  readonly label: string;
  readonly floorId: string;
  readonly bounds: RoomBoundingBox;
  readonly isInterior: boolean;
  readonly walkingFloorY: number;
  readonly excludedCutout?: (x: number, z: number) => boolean;
}

const ALL_AUDIT_CHECKS: readonly AuditCheckName[] = [
  'zFighting',
  'cutaway',
  'doorSwings',
  'walkthrough',
];

const r3 = (n: number): number => Math.round(n * 1000) / 1000;

function formatObjPath(obj: THREE.Object3D): string {
  const parts: string[] = [];
  let cur: THREE.Object3D | null = obj;
  while (cur && cur.parent) {
    if (cur.name) parts.push(cur.name);
    cur = cur.parent;
    if (parts.length >= 3) break;
  }
  return parts.length > 0 ? parts.reverse().join('/') : obj.type;
}

function getBoxCenterTuple(box: THREE.Box3): [number, number, number] {
  return [
    r3((box.min.x + box.max.x) * 0.5),
    r3((box.min.y + box.max.y) * 0.5),
    r3((box.min.z + box.max.z) * 0.5),
  ];
}

function computeMeshOrientedBox(
  mesh: THREE.Mesh,
  shrinkM = 0
): OrientedBox3D | null {
  const geom = mesh.geometry;
  if (!geom.boundingBox) geom.computeBoundingBox();
  const lb = geom.boundingBox;
  if (!lb || lb.isEmpty()) return null;

  const localCenter = new THREE.Vector3(
    (lb.min.x + lb.max.x) * 0.5,
    (lb.min.y + lb.max.y) * 0.5,
    (lb.min.z + lb.max.z) * 0.5
  );
  const localHalf = [
    Math.max(0, (lb.max.x - lb.min.x) * 0.5),
    Math.max(0, (lb.max.y - lb.min.y) * 0.5),
    Math.max(0, (lb.max.z - lb.min.z) * 0.5),
  ] as const;

  const mw = mesh.matrixWorld;
  const center = localCenter.applyMatrix4(mw);
  const ax0 = new THREE.Vector3().setFromMatrixColumn(mw, 0);
  const ax1 = new THREE.Vector3().setFromMatrixColumn(mw, 1);
  const ax2 = new THREE.Vector3().setFromMatrixColumn(mw, 2);

  const s0 = ax0.length();
  const s1 = ax1.length();
  const s2 = ax2.length();
  if (s0 < 1e-6 || s1 < 1e-6 || s2 < 1e-6) return null;

  ax0.divideScalar(s0);
  ax1.divideScalar(s1);
  ax2.divideScalar(s2);

  const h0 = Math.max(0.0005, localHalf[0] * s0 - shrinkM);
  const h1 = Math.max(0.0005, localHalf[1] * s1 - shrinkM);
  const h2 = Math.max(0.0005, localHalf[2] * s2 - shrinkM);

  const extX = Math.abs(ax0.x) * h0 + Math.abs(ax1.x) * h1 + Math.abs(ax2.x) * h2;
  const extY = Math.abs(ax0.y) * h0 + Math.abs(ax1.y) * h1 + Math.abs(ax2.y) * h2;
  const extZ = Math.abs(ax0.z) * h0 + Math.abs(ax1.z) * h1 + Math.abs(ax2.z) * h2;

  const worldAabb = new THREE.Box3(
    new THREE.Vector3(center.x - extX, center.y - extY, center.z - extZ),
    new THREE.Vector3(center.x + extX, center.y + extY, center.z + extZ)
  );

  return {
    center,
    axes: [ax0, ax1, ax2],
    halfSizes: [h0, h1, h2],
    worldAabb,
  };
}

const satDiff = new THREE.Vector3();
const satCrossAxis = new THREE.Vector3();

function projectObbRadius(obb: OrientedBox3D, axis: THREE.Vector3): number {
  return (
    obb.halfSizes[0] * Math.abs(axis.dot(obb.axes[0])) +
    obb.halfSizes[1] * Math.abs(axis.dot(obb.axes[1])) +
    obb.halfSizes[2] * Math.abs(axis.dot(obb.axes[2]))
  );
}

/** Exact 15-axis 3D Separating Axis Theorem intersection test between two OBBs. */
function obbsIntersect(a: OrientedBox3D, b: OrientedBox3D): boolean {
  if (!a.worldAabb.intersectsBox(b.worldAabb)) return false;
  satDiff.subVectors(b.center, a.center);

  for (let i = 0; i < 3; i++) {
    const axis = a.axes[i]!;
    if (Math.abs(satDiff.dot(axis)) > a.halfSizes[i]! + projectObbRadius(b, axis)) {
      return false;
    }
  }
  for (let i = 0; i < 3; i++) {
    const axis = b.axes[i]!;
    if (Math.abs(satDiff.dot(axis)) > projectObbRadius(a, axis) + b.halfSizes[i]!) {
      return false;
    }
  }
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      satCrossAxis.crossVectors(a.axes[i]!, b.axes[j]!);
      const lenSq = satCrossAxis.lengthSq();
      if (lenSq < 1e-8) continue;
      satCrossAxis.divideScalar(Math.sqrt(lenSq));
      if (
        Math.abs(satDiff.dot(satCrossAxis)) >
        projectObbRadius(a, satCrossAxis) + projectObbRadius(b, satCrossAxis)
      ) {
        return false;
      }
    }
  }
  return true;
}

function computeSubtreeWorldBox(root: THREE.Object3D): THREE.Box3 {
  const out = new THREE.Box3();
  const tmp = new THREE.Box3();
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const u = node.userData as Record<string, unknown> | undefined;
    if (
      u?.isLightGlowPool === true ||
      u?.isFittingFx === true ||
      u?.isShadowPassHook === true ||
      node.name.endsWith('.contactShadow')
    ) {
      return;
    }
    if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
    const gb = node.geometry.boundingBox;
    if (!gb || gb.isEmpty()) return;
    tmp.copy(gb).applyMatrix4(node.matrixWorld);
    out.union(tmp);
  });
  return out;
}

function getContainerTransformXZ(obj: THREE.Object3D): {
  readonly offsetX: number;
  readonly offsetZ: number;
  readonly rotationY: number;
} {
  let offsetX = 0;
  let offsetZ = 0;
  let rotationY = 0;
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    const containerTransform = cur.userData?.containerTransform as
      | { readonly offset?: readonly [number, number, number]; readonly rotationY?: number }
      | undefined;
    const containerOffset =
      (cur.userData?.containerOffset as readonly [number, number, number] | undefined) ??
      containerTransform?.offset;
    if (containerOffset) {
      offsetX += containerOffset[0];
      offsetZ += containerOffset[2];
    }
    const containerRotY =
      (cur.userData?.containerRotationY as number | undefined) ?? containerTransform?.rotationY;
    if (typeof containerRotY === 'number') {
      rotationY += containerRotY;
    }
    cur = cur.parent;
  }
  return { offsetX, offsetZ, rotationY };
}

function worldBoxToContainerLocalBox(
  box: THREE.Box3,
  offsetX: number,
  offsetZ: number,
  rotationY: number
): THREE.Box3 {
  if (offsetX === 0 && offsetZ === 0 && rotationY === 0) {
    return box;
  }
  const cos = Math.cos(rotationY);
  const sin = Math.sin(rotationY);
  const out = new THREE.Box3();
  const pt = new THREE.Vector3();
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        const dx = x - offsetX;
        const dz = z - offsetZ;
        pt.set(dx * cos - dz * sin, y, dx * sin + dz * cos);
        out.expandByPoint(pt);
      }
    }
  }
  return out;
}

const CUTAWAY_EXEMPT_UNTAGGED_PATH_RE =
  /ceilingMeshGroup|groundFloorCeilingGroup|cutaway\.(southWest|west|north|east)|\.slab$|\.ceiling$|roof|cornice|coving|ceilingRose|girder|caisson|foundation|gradeBeam|retaining|columns|cliffCatwalk|poolTerrace|terrace|apron|plinth|terrain|paddock|driveway|lawn|hedge|tree|shrub|water|pool|staircase|balustrade|contactShadow|glowPool/i;

export function auditCutawayIntegrity(
  scene: THREE.Object3D,
  options?: CutawayAuditOptions
): AuditFinding[] {
  scene.updateMatrixWorld(true);
  const findings: AuditFinding[] = [];
  const maxWallMountDistanceM = options?.maxWallMountDistanceM ?? 0.45;
  const exteriorWallBandM = options?.exteriorWallBandM ?? 0.18;
  const maxPartitionButtWidthM = options?.maxPartitionButtWidthM ?? 0.35;

  const sortedFloors = options?.floors
    ? [...options.floors].sort((a, b) => a.elevationY - b.elevationY)
    : [];
  const validFloorIds =
    sortedFloors.length > 0 ? new Set(sortedFloors.map((f) => f.id)) : null;

  const floorBandById = new Map<string, { readonly minY: number; readonly maxY: number }>();
  for (let i = 0; i < sortedFloors.length; i++) {
    const f = sortedFloors[i]!;
    const minY = f.elevationY;
    const nextFloorY = sortedFloors[i + 1]?.elevationY;
    const maxY =
      f.ceilingCutawayY ??
      (f.ceilingHeight !== undefined ? minY + f.ceilingHeight : nextFloorY ?? minY + 3.2);
    floorBandById.set(f.id, { minY, maxY });
  }

  interface ActiveCutawayPlane {
    floor: string;
    axis: 'x' | 'z';
    coord: number;
    minSpan: number;
    maxSpan: number;
    outwardSide?: CutawayWallDescriptor['outwardSide'];
    offsetX: number;
    offsetZ: number;
    rotationY: number;
  }
  const activePlanesMap = new Map<string, ActiveCutawayPlane>();

  const inspectTaggedTree = (
    node: THREE.Object3D,
    inheritedDesc: CutawayWallDescriptor | undefined
  ): void => {
    const rawDesc = node.userData?.cutawayWall as CutawayWallDescriptor | undefined;
    const isNewDescriptorRoot =
      rawDesc !== undefined &&
      (!inheritedDesc ||
        inheritedDesc.axis !== rawDesc.axis ||
        inheritedDesc.coord !== rawDesc.coord ||
        inheritedDesc.floor !== rawDesc.floor ||
        inheritedDesc.minSpan !== rawDesc.minSpan ||
        inheritedDesc.maxSpan !== rawDesc.maxSpan);

    if (isNewDescriptorRoot && rawDesc) {
      const objLabel = formatObjPath(node);
      const worldBox = computeSubtreeWorldBox(node);
      const pos = !worldBox.isEmpty() ? getBoxCenterTuple(worldBox) : undefined;

      if (validFloorIds && !validFloorIds.has(rawDesc.floor)) {
        findings.push({
          check: 'cutaway',
          severity: 'error',
          code: 'INVALID_CUTAWAY_FLOOR',
          message: `Cutaway object '${objLabel}' references undeclared floor '${rawDesc.floor}' (expected one of: ${Array.from(validFloorIds).join(', ')}).`,
          objectName: objLabel,
          ...(pos ? { position: pos } : {}),
          details: { floor: rawDesc.floor },
        });
      }

      if (
        !Number.isFinite(rawDesc.coord) ||
        !Number.isFinite(rawDesc.minSpan) ||
        !Number.isFinite(rawDesc.maxSpan) ||
        !(rawDesc.minSpan < rawDesc.maxSpan)
      ) {
        findings.push({
          check: 'cutaway',
          severity: 'error',
          code: 'INVALID_CUTAWAY_SPAN',
          message: `Cutaway object '${objLabel}' has invalid span [${rawDesc.minSpan}, ${rawDesc.maxSpan}] or coord ${rawDesc.coord}.`,
          objectName: objLabel,
          ...(pos ? { position: pos } : {}),
          details: {
            axis: rawDesc.axis,
            coord: rawDesc.coord,
            minSpan: rawDesc.minSpan,
            maxSpan: rawDesc.maxSpan,
          },
        });
      } else if (!worldBox.isEmpty()) {
        const ct = getContainerTransformXZ(node);
        const localBox = worldBoxToContainerLocalBox(
          worldBox,
          ct.offsetX,
          ct.offsetZ,
          ct.rotationY
        );

        const isOverheadDoor =
          node.userData?.overheadTrackZ !== undefined || /garage.*door/i.test(objLabel);

        const boxMinPerp = rawDesc.axis === 'x' ? localBox.min.x : localBox.min.z;
        const boxMaxPerp = rawDesc.axis === 'x' ? localBox.max.x : localBox.max.z;
        const minDistToPlane =
          rawDesc.coord >= boxMinPerp && rawDesc.coord <= boxMaxPerp
            ? 0
            : Math.min(
                Math.abs(boxMinPerp - rawDesc.coord),
                Math.abs(boxMaxPerp - rawDesc.coord)
              );

        if (!isOverheadDoor && minDistToPlane > maxWallMountDistanceM) {
          findings.push({
            check: 'cutaway',
            severity: 'error',
            code: 'FREESTANDING_CUTAWAY_OBJECT',
            message: `Freestanding object '${objLabel}' is tagged with cutawayWall (${rawDesc.axis}=${r3(rawDesc.coord)}) but its AABB sits ${r3(minDistToPlane)} m (> ${maxWallMountDistanceM} m) from the wall plane and will vanish on cutaway.`,
            objectName: objLabel,
            ...(pos ? { position: pos } : {}),
            details: {
              axis: rawDesc.axis,
              wallCoord: rawDesc.coord,
              distanceFromWallM: r3(minDistToPlane),
              maxWallMountDistanceM,
            },
          });
        }

        // Record active exterior cutaway wall plane if this object sits on the plane
        if (minDistToPlane <= 0.3) {
          const planeKey = `${rawDesc.floor}|${rawDesc.axis}|${Math.round(rawDesc.coord * 50)}|${rawDesc.outwardSide ?? ''}|${Math.round(ct.offsetX * 20)}|${Math.round(ct.offsetZ * 20)}|${Math.round(ct.rotationY * 100)}`;
          const existing = activePlanesMap.get(planeKey);
          if (existing) {
            existing.minSpan = Math.min(existing.minSpan, rawDesc.minSpan);
            existing.maxSpan = Math.max(existing.maxSpan, rawDesc.maxSpan);
          } else {
            activePlanesMap.set(planeKey, {
              floor: rawDesc.floor,
              axis: rawDesc.axis,
              coord: rawDesc.coord,
              minSpan: rawDesc.minSpan,
              maxSpan: rawDesc.maxSpan,
              outwardSide: rawDesc.outwardSide,
              offsetX: ct.offsetX,
              offsetZ: ct.offsetZ,
              rotationY: ct.rotationY,
            });
          }
        }
      }
    }

    const nextInherited = rawDesc ?? inheritedDesc;
    for (let i = 0; i < node.children.length; i++) {
      inspectTaggedTree(node.children[i]!, nextInherited);
    }
  };

  inspectTaggedTree(scene, undefined);

  // Second pass: inspect untagged static assemblies/meshes lying directly inside/on an active exterior cutaway wall band
  const activePlanes = Array.from(activePlanesMap.values());
  if (activePlanes.length > 0) {
    const CONTAINER_GROUP_NAME_RE =
      /(\.(root|slab|ceiling))$|^cutaway\.|(MeshGroup|CeilingGroup|FloorGroup|WallGroup|ZoneGroup)$|^floor\./i;

    const hasAnyCutawayDescendant = (root: THREE.Object3D): boolean => {
      let found = false;
      root.traverse((n) => {
        if (found) return;
        const nu = n.userData as Record<string, unknown> | undefined;
        if (nu?.cutawayWall || nu?.isCutawayWall === true) {
          found = true;
        }
      });
      return found;
    };

    const checkBoxAgainstActivePlanes = (
      targetNode: THREE.Object3D,
      worldBox: THREE.Box3
    ): void => {
      const sizeX = worldBox.max.x - worldBox.min.x;
      const sizeY = worldBox.max.y - worldBox.min.y;
      const sizeZ = worldBox.max.z - worldBox.min.z;

      // Exclude horizontal floor slabs / carpets / thresholds
      if (sizeY <= 0.14 && Math.min(sizeX, sizeZ) >= 0.45) {
        return;
      }

      const ct = getContainerTransformXZ(targetNode);
      for (let p = 0; p < activePlanes.length; p++) {
        const plane = activePlanes[p]!;
        if (
          Math.abs(ct.offsetX - plane.offsetX) > 0.05 ||
          Math.abs(ct.offsetZ - plane.offsetZ) > 0.05 ||
          Math.abs(ct.rotationY - plane.rotationY) > 0.02
        ) {
          continue;
        }
        const floorBand = floorBandById.get(plane.floor);
        const fMinY = floorBand?.minY ?? 0;
        const fMaxY = floorBand?.maxY ?? 3.2;
        if (worldBox.max.y <= fMinY + 0.06 || worldBox.min.y >= fMaxY - 0.16) {
          continue;
        }
        if (worldBox.min.y < fMinY - 0.15 || worldBox.max.y > fMaxY + 0.25) {
          continue;
        }

        const localBox = worldBoxToContainerLocalBox(
          worldBox,
          plane.offsetX,
          plane.offsetZ,
          plane.rotationY
        );

        const perpMin = plane.axis === "x" ? localBox.min.x : localBox.min.z;
        const perpMax = plane.axis === "x" ? localBox.max.x : localBox.max.z;
        const spanMin = plane.axis === "x" ? localBox.min.z : localBox.min.x;
        const spanMax = plane.axis === "x" ? localBox.max.z : localBox.max.x;

        if (spanMin < plane.minSpan + 0.03 || spanMax > plane.maxSpan - 0.03) {
          continue;
        }

        const maxDistFromPlane = Math.max(
          Math.abs(perpMin - plane.coord),
          Math.abs(perpMax - plane.coord)
        );
        if (maxDistFromPlane >= exteriorWallBandM) {
          continue;
        }

        const spanWidth = spanMax - spanMin;
        // Exclude tall perpendicular partition end-butts / pilasters (< maxPartitionButtWidthM wide and tall)
        if (spanWidth < maxPartitionButtWidthM && sizeY > 1.5) {
          continue;
        }

        const label = formatObjPath(targetNode);
        findings.push({
          check: "cutaway",
          severity: "warning",
          code: "MISSING_CUTAWAY_TAG",
          message: `Untagged mesh/fixture '${label}' lies within ${r3(maxDistFromPlane)} m (< ${exteriorWallBandM} m) of cutaway wall (${plane.floor} ${plane.axis}=${r3(plane.coord)}) and will float in mid-air when the wall cuts away.`,
          objectName: label,
          position: getBoxCenterTuple(worldBox),
          details: {
            floor: plane.floor,
            axis: plane.axis,
            wallCoord: plane.coord,
            maxDistanceFromWallM: r3(maxDistFromPlane),
          },
        });
        return;
      }
    };

    const meshWorldBox = new THREE.Box3();
    const visitUntagged = (node: THREE.Object3D): void => {
      const u = node.userData as Record<string, unknown> | undefined;
      if (u?.cutawayWall || u?.isCutawayWall === true) return;

      const name = typeof node.name === "string" ? node.name : "";
      if (
        CUTAWAY_EXEMPT_UNTAGGED_PATH_RE.test(name) ||
        u?.isLightGlowPool === true ||
        u?.isFittingFx === true ||
        u?.isShadowPassHook === true ||
        u?.isAnnotationGroup === true ||
        u?.isWeatherOverlay === true ||
        u?.isEnvironmentGround === true ||
        u?.isBatchedStaticMesh === true ||
        Boolean(u?.ufhZoneId)
      ) {
        return;
      }

      if (node !== scene && node instanceof THREE.Group && node.children.length > 0) {
        const isContainerGroup = CONTAINER_GROUP_NAME_RE.test(name);
        if (!isContainerGroup && !hasAnyCutawayDescendant(node)) {
          const groupBox = computeSubtreeWorldBox(node);
          if (!groupBox.isEmpty()) {
            const gx = groupBox.max.x - groupBox.min.x;
            const gz = groupBox.max.z - groupBox.min.z;
            // Bounded object assembly (furniture, joinery carcass, sanitaryware, switch plate, sconce, radiator):
            // evaluate its full assembly AABB as a single unit rather than dissecting rear screws/panels.
            if (Math.max(gx, gz) <= 4.8) {
              checkBoxAgainstActivePlanes(node, groupBox);
              return;
            }
          }
        }
      }

      if (node instanceof THREE.Mesh && !(node instanceof THREE.InstancedMesh)) {
        if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
        const gb = node.geometry.boundingBox;
        if (gb && !gb.isEmpty()) {
          meshWorldBox.copy(gb).applyMatrix4(node.matrixWorld);
          checkBoxAgainstActivePlanes(node, meshWorldBox);
        }
        return;
      }

      for (let i = 0; i < node.children.length; i++) {
        visitUntagged(node.children[i]!);
      }
    };

    visitUntagged(scene);
  }

  return findings;
}

const DOOR_OBSTACLE_SKIP_NAME_RE =
  /ceilingMeshGroup|groundFloorCeilingGroup|cutaway\.(southWest|west|north|east)|\.slab$|\.ceiling$|roof|cornice|coving|ceilingRose|wall|partition|skirting|dado|pictureRail|architrave|frame|jamb|lintel|sill|header|threshold|mullion|window|sash|glassBay|curtain|blind|rug|carpet|runner|mat\b|glowPool|contactShadow|plinth|terrace|catwalk|foundation|gradeBeam|columns|pendant|chandelier|downlight|sconce/i;

function resolveDoorPolicyOverride(
  door: HingedDoorState,
  policy: DoorPolicy | undefined
): number | undefined {
  if (!policy) return undefined;
  if (door.id in policy.openAngles) return policy.openAngles[door.id];
  const pivotName = door.pivot.name || door.pivot.children[0]?.name;
  if (pivotName) {
    const clean = pivotName.replace(/\.pivot$/, '');
    const stableKey = `door:${clean}`;
    if (stableKey in policy.openAngles) return policy.openAngles[stableKey];
    if (clean in policy.openAngles) return policy.openAngles[clean];
  }
  return undefined;
}

function collectDoorsAndDrawers(
  scene: THREE.Object3D,
  interactions?: InteractionRegistry
): {
  readonly doors: HingedDoorState[];
  readonly drawers: SlidingDrawerState[];
} {
  if (interactions) {
    const regInternal = interactions as unknown as {
      hingedDoors?: ReadonlyMap<string, HingedDoorState>;
      slidingDrawers?: ReadonlyMap<string, SlidingDrawerState>;
    };
    const doors = regInternal.hingedDoors ? Array.from(regInternal.hingedDoors.values()) : [];
    const drawers = regInternal.slidingDrawers
      ? Array.from(regInternal.slidingDrawers.values())
      : [];
    if (doors.length > 0 || drawers.length > 0) {
      return { doors, drawers };
    }
  }

  const doors: HingedDoorState[] = [];
  const drawers: SlidingDrawerState[] = [];
  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Group)) return;
    const u = obj.userData as Record<string, unknown> | undefined;
    if (u?.doorRole === 'pivot') {
      const axis = (u.doorAxis as 'x' | 'y' | 'z' | undefined) ?? 'y';
      const openAngle = typeof u.openAngle === 'number' ? u.openAngle : 1.4;
      const id = typeof u.interactableId === 'string' ? u.interactableId : obj.name || 'door';
      doors.push(createHingedDoorState(id, obj, axis, obj.rotation[axis], openAngle));
    } else if (u?.drawerRole === 'group' && u.slideDelta instanceof THREE.Vector3) {
      const id = typeof u.interactableId === 'string' ? u.interactableId : obj.name || 'drawer';
      const closedPos = obj.position.clone();
      drawers.push({
        id,
        group: obj,
        closedPos,
        openPos: closedPos.clone().add(u.slideDelta),
        isOpen: false,
        progress: 0,
        speed: 2.8,
      });
    }
  });
  return { doors, drawers };
}

export function auditDoorSwings(
  scene: THREE.Object3D,
  options?: DoorSwingAuditOptions
): AuditFinding[] {
  scene.updateMatrixWorld(true);
  const findings: AuditFinding[] = [];
  const sampleSteps = Math.max(2, options?.sampleSteps ?? 5);
  const clearanceToleranceM = options?.clearanceToleranceM ?? 0.006;

  const { doors, drawers } = collectDoorsAndDrawers(scene, options?.interactions);
  if (doors.length === 0 && drawers.length === 0) {
    return findings;
  }

  const dynamicRoots = new Set<THREE.Object3D>();
  for (const d of doors) dynamicRoots.add(d.pivot);
  for (const dr of drawers) dynamicRoots.add(dr.group);

  // Collect static non-shell furniture / sanitaryware / appliance obstacle OBBs
  interface StaticObstacleEntry {
    readonly mesh: THREE.Mesh;
    readonly label: string;
    readonly obb: OrientedBox3D;
    readonly carcassRoot: THREE.Object3D | null;
  }
  const obstacles: StaticObstacleEntry[] = [];

  const findHostCarcassAncestor = (node: THREE.Object3D): THREE.Object3D | null => {
    let cur: THREE.Object3D | null = node.parent;
    while (cur && cur !== scene) {
      if (/wardrobe|cabinet|cupboard|carcass|vanity|dresser|appliance/i.test(cur.name)) {
        return cur;
      }
      cur = cur.parent;
    }
    return null;
  };

  const collectObstacles = (
    node: THREE.Object3D,
    hasShellAncestor: boolean
  ): void => {
    if (dynamicRoots.has(node)) return;
    const u = node.userData as Record<string, unknown> | undefined;
    if (
      u?.collisionRole === 'ignore' ||
      u?.ignoreWalkthroughCollision === true ||
      u?.isLightGlowPool === true ||
      u?.isFittingFx === true ||
      u?.isShadowPassHook === true ||
      u?.isAnnotationGroup === true ||
      u?.isWeatherOverlay === true ||
      u?.isEnvironmentGround === true ||
      u?.isBatchedStaticMesh === true ||
      u?.doorRole === 'pivot' ||
      u?.drawerRole === 'group' ||
      Boolean(u?.ufhZoneId)
    ) {
      return;
    }

    const name = typeof node.name === 'string' ? node.name : '';
    const isShell =
      hasShellAncestor ||
      u?.isArchitecturalShell === true ||
      u?.isCutawayWall === true ||
      Boolean(u?.cutawayWall);

    if (DOOR_OBSTACLE_SKIP_NAME_RE.test(name)) {
      return;
    }

    if (!isShell && node instanceof THREE.Mesh && !(node instanceof THREE.InstancedMesh)) {
      const obb = computeMeshOrientedBox(node, clearanceToleranceM);
      if (obb) {
        const sizeY = obb.worldAabb.max.y - obb.worldAabb.min.y;
        const sizeX = obb.worldAabb.max.x - obb.worldAabb.min.x;
        const sizeZ = obb.worldAabb.max.z - obb.worldAabb.min.z;
        // Skip flat floor slabs / bath floors / rugs
        const isFloorSlab =
          (sizeY <= 0.22 && Math.min(sizeX, sizeZ) >= 0.85 && obb.worldAabb.max.y <= 0.08) ||
          (sizeY <= 0.05 && obb.worldAabb.min.y <= 0.02);
        if (!isFloorSlab) {
          obstacles.push({
            mesh: node,
            label: formatObjPath(node),
            obb,
            carcassRoot: findHostCarcassAncestor(node),
          });
        }
      }
    }

    for (let i = 0; i < node.children.length; i++) {
      collectObstacles(node.children[i]!, isShell);
    }
  };

  collectObstacles(scene, false);
  if (obstacles.length === 0) return findings;

  const collectDynamicMeshes = (root: THREE.Object3D): THREE.Mesh[] => {
    const meshes: THREE.Mesh[] = [];
    root.traverse((n) => {
      if (!(n instanceof THREE.Mesh)) return;
      const u = n.userData as Record<string, unknown> | undefined;
      if (
        u?.collisionRole === 'ignore' ||
        u?.isLightGlowPool === true ||
        u?.isFittingFx === true ||
        n.name.endsWith('.contactShadow')
      ) {
        return;
      }
      meshes.push(n);
    });
    return meshes;
  };

  // Sweep hinged & linear-slide doors
  for (const door of doors) {
    if (door.isFoldingFloorMat) continue;
    const doorMeshes = collectDynamicMeshes(door.pivot);
    if (doorMeshes.length === 0) continue;

    const savedPos = door.pivot.position.clone();
    const savedRot = door.pivot.rotation.clone();
    const savedProgress = door.progress;
    const savedClosedPivotPos = door.closedPivotPos ? door.closedPivotPos.clone() : undefined;
    const doorCarcass = findHostCarcassAncestor(door.pivot);
    const doorLabel = formatObjPath(door.pivot);

    try {
      const overrideAngle = resolveDoorPolicyOverride(door, options?.doorPolicy);
      const hasLinearSlide = Boolean(door.pivot.userData?.linearSlideOffset);
      const effectiveOpen = hasLinearSlide
        ? door.openAngle
        : getDefaultDoorOpenAngle(door, overrideAngle);

      if (!hasLinearSlide && Math.abs(effectiveOpen - door.closedAngle) < 1e-4) {
        continue;
      }

      // Record any obstacles already touching at closed pose (t = 0, e.g. own carcass shelves/seals)
      door.progress = 0;
      applyHingedDoorPose(door, effectiveOpen);
      door.pivot.updateMatrixWorld(true);
      const closedOverlaps = new Set<THREE.Mesh>();
      for (const dm of doorMeshes) {
        const dObb = computeMeshOrientedBox(dm, clearanceToleranceM);
        if (!dObb) continue;
        for (const obs of obstacles) {
          if (obbsIntersect(dObb, obs.obb)) {
            closedOverlaps.add(obs.mesh);
          }
        }
      }

      let collisionFound = false;
      for (let step = 1; step <= sampleSteps && !collisionFound; step++) {
        const t = step / sampleSteps;
        door.progress = t;
        applyHingedDoorPose(door, effectiveOpen);
        door.pivot.updateMatrixWorld(true);

        const sweptBox = new THREE.Box3();
        const doorObbs: OrientedBox3D[] = [];
        for (const dm of doorMeshes) {
          const dObb = computeMeshOrientedBox(dm, clearanceToleranceM);
          if (dObb) {
            doorObbs.push(dObb);
            sweptBox.union(dObb.worldAabb);
          }
        }
        if (doorObbs.length === 0) continue;

        for (const obs of obstacles) {
          if (closedOverlaps.has(obs.mesh)) continue;
          if (doorCarcass && obs.carcassRoot === doorCarcass) continue;
          if (!sweptBox.intersectsBox(obs.obb.worldAabb)) continue;

          for (const dObb of doorObbs) {
            if (obbsIntersect(dObb, obs.obb)) {
              const angleDeg = Math.round(
                ((door.closedAngle + (effectiveOpen - door.closedAngle) * t) * 180) / Math.PI
              );
              findings.push({
                check: 'doorSwings',
                severity: 'error',
                code: 'DOOR_SWING_BLOCKED',
                message: `Door '${doorLabel}' (${door.id}) collides with '${obs.label}' at ${Math.round(t * 100)}% open (${angleDeg}°).`,
                objectName: doorLabel,
                targetName: obs.label,
                position: getBoxCenterTuple(dObb.worldAabb),
                details: {
                  doorId: door.id,
                  openFraction: r3(t),
                  angleDeg,
                },
              });
              collisionFound = true;
              break;
            }
          }
          if (collisionFound) break;
        }
      }
    } finally {
      door.progress = savedProgress;
      door.pivot.position.copy(savedPos);
      door.pivot.rotation.copy(savedRot);
      if (savedClosedPivotPos) {
        door.closedPivotPos = savedClosedPivotPos;
      } else {
        delete door.closedPivotPos;
      }
      door.pivot.updateMatrixWorld(true);
    }
  }

  // Sweep sliding drawers
  for (const drawer of drawers) {
    if (drawer.fadeOutWhenOpen) continue;
    const drawerMeshes = collectDynamicMeshes(drawer.group);
    if (drawerMeshes.length === 0) continue;

    const savedPos = drawer.group.position.clone();
    const savedProgress = drawer.progress;
    const drawerCarcass = findHostCarcassAncestor(drawer.group);
    const drawerLabel = formatObjPath(drawer.group);

    try {
      drawer.group.position.copy(drawer.closedPos);
      drawer.group.updateMatrixWorld(true);
      const closedOverlaps = new Set<THREE.Mesh>();
      for (const dm of drawerMeshes) {
        const dObb = computeMeshOrientedBox(dm, clearanceToleranceM);
        if (!dObb) continue;
        for (const obs of obstacles) {
          if (obbsIntersect(dObb, obs.obb)) {
            closedOverlaps.add(obs.mesh);
          }
        }
      }

      let collisionFound = false;
      for (let step = 1; step <= sampleSteps && !collisionFound; step++) {
        const t = step / sampleSteps;
        drawer.group.position.lerpVectors(drawer.closedPos, drawer.openPos, t);
        drawer.group.updateMatrixWorld(true);

        for (const dm of drawerMeshes) {
          const dObb = computeMeshOrientedBox(dm, clearanceToleranceM);
          if (!dObb) continue;
          for (const obs of obstacles) {
            if (closedOverlaps.has(obs.mesh)) continue;
            if (drawerCarcass && obs.carcassRoot === drawerCarcass) continue;
            if (obbsIntersect(dObb, obs.obb)) {
              findings.push({
                check: 'doorSwings',
                severity: 'error',
                code: 'DRAWER_SLIDE_BLOCKED',
                message: `Sliding drawer '${drawerLabel}' (${drawer.id}) collides with '${obs.label}' at ${Math.round(t * 100)}% extension.`,
                objectName: drawerLabel,
                targetName: obs.label,
                position: getBoxCenterTuple(dObb.worldAabb),
                details: {
                  drawerId: drawer.id,
                  openFraction: r3(t),
                },
              });
              collisionFound = true;
              break;
            }
          }
          if (collisionFound) break;
        }
      }
    } finally {
      drawer.progress = savedProgress;
      drawer.group.position.copy(savedPos);
      drawer.group.updateMatrixWorld(true);
    }
  }

  return findings;
}

function normalizeRoomZones(
  raw: WalkthroughAuditOptions['roomZones'],
  floors: readonly FloorDefinition[]
): NormalizedAuditZone[] {
  if (!raw) return [];
  const floorYById = new Map<string, number>(floors.map((f) => [f.id, f.elevationY]));
  const items: (RoomZoneDefinition | RoomZoneLodRegistration | AuditRoomZoneInput)[] =
    Array.isArray(raw)
      ? raw
      : Object.values(raw).filter((v): v is RoomZoneDefinition => v !== undefined);

  return items.map((item) => {
    const rec = item as AuditRoomZoneInput;
    const id = rec.id ?? rec.zoneId ?? 'unknown-zone';
    const label = rec.name ?? rec.shortName ?? id;
    const walkingFloorY =
      rec.walkingFloorY ?? floorYById.get(rec.floorId) ?? rec.bounds.minY;
    return {
      id,
      label,
      floorId: rec.floorId,
      bounds: rec.bounds,
      isInterior: rec.isInterior !== false,
      walkingFloorY,
      ...(rec.excludedCutout ? { excludedCutout: rec.excludedCutout } : {}),
    };
  });
}

function rayIntersectsTriangleUpward(
  ox: number,
  oy: number,
  oz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number
): number | null {
  // Ray origin = (ox, oy, oz), direction = (0, 1, 0)
  const e1x = bx - ax;
  const e1y = by - ay;
  const e1z = bz - az;
  const e2x = cx - ax;
  const e2y = cy - ay;
  const e2z = cz - az;

  // h = D x e2 = (0, 1, 0) x e2 = (e2z, 0, -e2x)
  const hx = e2z;
  const hz = -e2x;
  const det = e1x * hx + e1z * hz;
  if (Math.abs(det) < 1e-8) return null;
  const invDet = 1 / det;

  const sx = ox - ax;
  const sy = oy - ay;
  const sz = oz - az;
  const u = (sx * hx + sz * hz) * invDet;
  if (u < -1e-5 || u > 1 + 1e-5) return null;

  // q = s x e1
  const qx = sy * e1z - sz * e1y;
  const qy = sz * e1x - sx * e1z;
  const qz = sx * e1y - sy * e1x;

  // v = D . q * invDet = qy * invDet
  const v = qy * invDet;
  if (v < -1e-5 || u + v > 1 + 1e-5) return null;

  // t = e2 . q * invDet
  const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
  return t > 0 ? t : null;
}

function distSqPointToSegment2D(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq <= 1e-12) return (px - ax) * (px - ax) + (pz - az) * (pz - az);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq));
  const cx = ax + t * dx;
  const cz = az + t * dz;
  return (px - cx) * (px - cx) + (pz - cz) * (pz - cz);
}

function circleIntersectsTriangle2D(
  cx: number,
  cz: number,
  rSq: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  tx: number,
  tz: number
): boolean {
  const c1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const c2 = (tx - bx) * (cz - bz) - (tz - bz) * (cx - bx);
  const c3 = (ax - tx) * (cz - tz) - (az - tz) * (cx - tx);
  if ((c1 >= 0 && c2 >= 0 && c3 >= 0) || (c1 <= 0 && c2 <= 0 && c3 <= 0)) {
    return true;
  }
  if (distSqPointToSegment2D(cx, cz, ax, az, bx, bz) <= rSq) return true;
  if (distSqPointToSegment2D(cx, cz, bx, bz, tx, tz) <= rSq) return true;
  if (distSqPointToSegment2D(cx, cz, tx, tz, ax, az) <= rSq) return true;
  return false;
}

interface ObstacleTriangle25D {
  readonly ax: number;
  readonly az: number;
  readonly bx: number;
  readonly bz: number;
  readonly cx: number;
  readonly cz: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
}

const WALKTHROUGH_SKIP_OBSTACLE_RE =
  /pendant|chandelier|downlight|sconce|fixture\.|luminousPanel|glowPool|contactShadow|rug|carpet|runner|mat\b|skirting|cornice|coving|ceilingRose|romanBlind|curtain/i;

export function auditWalkthroughReachability(
  scene: THREE.Object3D,
  options?: WalkthroughAuditOptions
): AuditFinding[] {
  scene.updateMatrixWorld(true);
  const findings: AuditFinding[] = [];

  const minStairHeadroomM = options?.minStairHeadroomM ?? 1.95;
  const gridStepM = options?.gridStepM ?? 0.2;
  const capsuleRadiusM = options?.capsuleRadiusM ?? 0.24;
  const capsuleHeightM = options?.capsuleHeightM ?? 1.778;
  const stepHeightM = options?.stepHeightM ?? 0.24;

  const floors: readonly FloorDefinition[] =
    options?.floors && options.floors.length > 0
      ? options.floors
      : [{ id: 'ground', elevationY: 0, ceilingHeight: 2.7 }];
  const sortedFloors = [...floors].sort((a, b) => a.elevationY - b.elevationY);
  const zones = normalizeRoomZones(options?.roomZones, sortedFloors);
  const stairs = collectRegisteredStaircases(scene);

  if (stairs.length > 0) {
    interface OverheadTri {
      readonly label: string;
      readonly ax: number;
      readonly ay: number;
      readonly az: number;
      readonly bx: number;
      readonly by: number;
      readonly bz: number;
      readonly cx: number;
      readonly cy: number;
      readonly cz: number;
      readonly minX: number;
      readonly maxX: number;
      readonly minY: number;
      readonly maxY: number;
      readonly minZ: number;
      readonly maxZ: number;
    }

    const stairSubtrees = new Set<THREE.Object3D>();
    for (const st of stairs) {
      st.group.traverse((n) => stairSubtrees.add(n));
    }

    const minLowestStairY = Math.min(...stairs.map((s) => s.worldBottomY));
    const overheadTris: OverheadTri[] = [];
    const vA = new THREE.Vector3();
    const vB = new THREE.Vector3();
    const vC = new THREE.Vector3();
    const tmpBox = new THREE.Box3();

    scene.traverse((node) => {
      if (!(node instanceof THREE.Mesh) || node instanceof THREE.InstancedMesh) return;
      if (stairSubtrees.has(node)) return;
      const u = node.userData as Record<string, unknown> | undefined;
      if (
        u?.collisionRole === 'ignore' ||
        u?.isLightGlowPool === true ||
        u?.isFittingFx === true ||
        u?.isShadowPassHook === true ||
        u?.isBatchedStaticMesh === true
      ) {
        return;
      }
      const name = typeof node.name === 'string' ? node.name : '';
      if (/pendant|chandelier|downlight|sconce|fixture\.|contactShadow/i.test(name)) {
        return;
      }
      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
      const gb = node.geometry.boundingBox;
      if (!gb || gb.isEmpty()) return;
      tmpBox.copy(gb).applyMatrix4(node.matrixWorld);
      if (tmpBox.max.y <= minLowestStairY + 0.45) return;

      const overlapsAnyStairXZ = stairs.some(
        (s) =>
          tmpBox.max.x >= s.minX &&
          tmpBox.min.x <= s.maxX &&
          tmpBox.max.z >= s.minZ &&
          tmpBox.min.z <= s.maxZ
      );
      if (!overlapsAnyStairXZ) return;

      const pos = node.geometry.getAttribute('position');
      if (!pos || pos.count < 3) return;
      const idx = node.geometry.getIndex();
      const triCount = idx ? Math.floor(idx.count / 3) : Math.floor(pos.count / 3);
      if (triCount > 4096) return;
      const label = formatObjPath(node);

      for (let t = 0; t < triCount; t++) {
        const i0 = idx ? idx.getX(t * 3) : t * 3;
        const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
        const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
        vA.fromBufferAttribute(pos, i0).applyMatrix4(node.matrixWorld);
        vB.fromBufferAttribute(pos, i1).applyMatrix4(node.matrixWorld);
        vC.fromBufferAttribute(pos, i2).applyMatrix4(node.matrixWorld);
        overheadTris.push({
          label,
          ax: vA.x,
          ay: vA.y,
          az: vA.z,
          bx: vB.x,
          by: vB.y,
          bz: vB.z,
          cx: vC.x,
          cy: vC.y,
          cz: vC.z,
          minX: Math.min(vA.x, vB.x, vC.x),
          maxX: Math.max(vA.x, vB.x, vC.x),
          minY: Math.min(vA.y, vB.y, vC.y),
          maxY: Math.max(vA.y, vB.y, vC.y),
          minZ: Math.min(vA.z, vB.z, vC.z),
          maxZ: Math.max(vA.z, vB.z, vC.z),
        });
      }
    });

    if (overheadTris.length > 0) {
      const sampleStep = 0.14;
      const edgeInset = 0.12;
      for (const stair of stairs) {
        let worstClearance = Number.POSITIVE_INFINITY;
        let worstTarget = '';
        let worstPos: [number, number, number] | null = null;

        for (let x = stair.minX + 0.15; x <= stair.maxX - 0.15; x += sampleStep) {
          for (let z = stair.minZ + 0.15; z <= stair.maxZ - 0.15; z += sampleStep) {
            const treadY = stair.sampleWorldY(x, z);
            if (treadY === null) continue;
            // Require central tread lane (inset from stringer/trimmer perimeter)
            if (
              stair.sampleWorldY(x - edgeInset, z) === null ||
              stair.sampleWorldY(x + edgeInset, z) === null ||
              stair.sampleWorldY(x, z - edgeInset) === null ||
              stair.sampleWorldY(x, z + edgeInset) === null
            ) {
              continue;
            }
            // Exclude top landing apron flush with upper floor slab
            if (treadY >= stair.worldTopY - 0.08) continue;

            const rayOriginY = treadY + 0.25;
            for (let i = 0; i < overheadTris.length; i++) {
              const tri = overheadTris[i]!;
              if (x < tri.minX || x > tri.maxX || z < tri.minZ || z > tri.maxZ) continue;
              if (tri.maxY <= rayOriginY || tri.minY >= treadY + minStairHeadroomM) continue;
              const hitDist = rayIntersectsTriangleUpward(
                x,
                rayOriginY,
                z,
                tri.ax,
                tri.ay,
                tri.az,
                tri.bx,
                tri.by,
                tri.bz,
                tri.cx,
                tri.cy,
                tri.cz
              );
              if (hitDist === null) continue;
              const headroom = 0.25 + hitDist;
              // Ignore sub-0.35m hits near bottom/top slab junctions; real overhead soffits/bulkheads sit > 0.45m above tread
              if (headroom < 0.45) continue;
              if (headroom < minStairHeadroomM && headroom < worstClearance) {
                worstClearance = headroom;
                worstTarget = tri.label;
                worstPos = [r3(x), r3(treadY), r3(z)];
              }
            }
          }
        }

        if (worstPos !== null && worstClearance < minStairHeadroomM) {
          const stairLabel = formatObjPath(stair.group);
          findings.push({
            check: 'walkthrough',
            severity: 'error',
            code: 'LOW_STAIR_HEADROOM',
            message: `Staircase '${stairLabel}' has only ${r3(worstClearance)} m vertical headroom (< ${minStairHeadroomM} m minimum) beneath '${worstTarget}' at [${worstPos.join(', ')}].`,
            objectName: stairLabel,
            targetName: worstTarget,
            position: worstPos,
            details: {
              measuredHeadroomM: r3(worstClearance),
              minStairHeadroomM,
            },
          });
        }
      }
    }
  }

  const habitableZones = zones.filter((z) => z.isInterior);
  if (habitableZones.length <= 1 && !options?.entryPosition) {
    return findings;
  }

  const lodRegs: RoomZoneLodRegistration[] = zones.map((z) => ({
    zoneId: z.id,
    shortName: z.label,
    floorId: z.floorId,
    bounds: z.bounds,
    isInterior: z.isInterior,
    walkingFloorY: z.walkingFloorY,
    ...(z.excludedCutout ? { excludedCutout: z.excludedCutout } : {}),
  }));

  const autoComposer = createAutoWalkthroughElevationComposer({
    floors: sortedFloors,
    getScene: () => scene,
    terrainSampler: options?.terrainSampler,
    roomRegistrations: lodRegs,
  });

  const sampleElevation =
    options?.elevationSampler ??
    ((x: number, z: number, currentFootY: number) =>
      autoComposer.sampleElevationY(x, z, currentFootY));

  // Pose all doors to open pose during reachability BFS and restore in finally
  const { doors } = collectDoorsAndDrawers(scene, options?.interactions);
  const savedDoorStates = doors.map((door) => ({
    door,
    pos: door.pivot.position.clone(),
    rot: door.pivot.rotation.clone(),
    progress: door.progress,
    closedPivotPos: door.closedPivotPos ? door.closedPivotPos.clone() : undefined,
  }));

  try {
    for (const door of doors) {
      if (door.isFoldingFloorMat) continue;
      const overrideAngle = resolveDoorPolicyOverride(door, options?.doorPolicy);
      const hasLinearSlide = Boolean(door.pivot.userData?.linearSlideOffset);
      const effectiveOpen = hasLinearSlide
        ? door.openAngle
        : getDefaultDoorOpenAngle(door, overrideAngle);
      door.progress = 1;
      applyHingedDoorPose(door, effectiveOpen);
      door.pivot.updateMatrixWorld(true);
    }

    // Compute world XZ domain covering all declared zones (+ 1.2 m margin) & entryPosition
    let domMinX = Number.POSITIVE_INFINITY;
    let domMaxX = Number.NEGATIVE_INFINITY;
    let domMinZ = Number.POSITIVE_INFINITY;
    let domMaxZ = Number.NEGATIVE_INFINITY;
    for (const z of zones) {
      domMinX = Math.min(domMinX, z.bounds.minX);
      domMaxX = Math.max(domMaxX, z.bounds.maxX);
      domMinZ = Math.min(domMinZ, z.bounds.minZ);
      domMaxZ = Math.max(domMaxZ, z.bounds.maxZ);
    }
    for (const st of stairs) {
      domMinX = Math.min(domMinX, st.minX);
      domMaxX = Math.max(domMaxX, st.maxX);
      domMinZ = Math.min(domMinZ, st.minZ);
      domMaxZ = Math.max(domMaxZ, st.maxZ);
    }
    if (options?.entryPosition) {
      domMinX = Math.min(domMinX, options.entryPosition[0]);
      domMaxX = Math.max(domMaxX, options.entryPosition[0]);
      domMinZ = Math.min(domMinZ, options.entryPosition[2]);
      domMaxZ = Math.max(domMaxZ, options.entryPosition[2]);
    }
    domMinX -= 1.2;
    domMaxX += 1.2;
    domMinZ -= 1.2;
    domMaxZ += 1.2;

    // Index obstacle triangles in a 1 m spatial hash grid
    const HASH_CELL_M = 1.0;
    const INV_HASH = 1 / HASH_CELL_M;
    const hashKey = (cx: number, cz: number): number =>
      ((cx + 16384) << 15) | ((cz + 16384) & 0x7fff);
    const obstacleBuckets = new Map<number, ObstacleTriangle25D[]>();

    const stairTreadMeshes = new Set<THREE.Object3D>();
    for (const st of stairs) {
      st.group.traverse((n) => {
        if (/tread|riser|bullnose|nosing|scotia|curtail|bracket|landing|stringer|soffit|carpet|runner|rod|apron/i.test(n.name)) {
          stairTreadMeshes.add(n);
        }
      });
    }

    // Swung hinged door leaves auto-barge out of the walker's path in first-person mode; exclude hinged
    // door leaves (without linearSlideOffset) so an inward-swinging bathroom door leaf doesn't
    // artificially pinch a narrow room, while closed/opened sliding glass panels participate!
    const hingedLeafSubtrees = new Set<THREE.Object3D>();
    for (const d of doors) {
      if (!d.pivot.userData?.linearSlideOffset) {
        d.pivot.traverse((n) => hingedLeafSubtrees.add(n));
      }
    }

    const vA = new THREE.Vector3();
    const vB = new THREE.Vector3();
    const vC = new THREE.Vector3();
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    const triNorm = new THREE.Vector3();
    const tmpBox = new THREE.Box3();

    const visitObstacleNode = (node: THREE.Object3D): void => {
      if (hingedLeafSubtrees.has(node) || stairTreadMeshes.has(node)) return;
      const u = node.userData as Record<string, unknown> | undefined;
      if (
        u?.collisionRole === 'ignore' ||
        u?.collisionRole === 'climbable' ||
        u?.collisionRole === 'walkable' ||
        u?.ignoreWalkthroughCollision === true ||
        u?.skipWalkthroughObstacle === true ||
        u?.isLightGlowPool === true ||
        u?.isFittingFx === true ||
        u?.isShadowPassHook === true ||
        u?.isAnnotationGroup === true ||
        u?.isWeatherOverlay === true ||
        u?.isEnvironmentGround === true ||
        u?.isBatchedStaticMesh === true ||
        Boolean(u?.ufhZoneId)
      ) {
        return;
      }
      const name = typeof node.name === 'string' ? node.name : '';
      if (
        name === 'ceilingMeshGroup' ||
        name === 'groundFloorCeilingGroup' ||
        /\.slab$|\.ceiling$/i.test(name) ||
        WALKTHROUGH_SKIP_OBSTACLE_RE.test(name)
      ) {
        return;
      }

      if (node instanceof THREE.Mesh && !(node instanceof THREE.InstancedMesh)) {
        if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
        const gb = node.geometry.boundingBox;
        if (gb && !gb.isEmpty()) {
          tmpBox.copy(gb).applyMatrix4(node.matrixWorld);
          if (
            tmpBox.max.x >= domMinX &&
            tmpBox.min.x <= domMaxX &&
            tmpBox.max.z >= domMinZ &&
            tmpBox.min.z <= domMaxZ
          ) {
            const pos = node.geometry.getAttribute('position');
            if (pos && pos.count >= 3) {
              const idx = node.geometry.getIndex();
              const triCount = idx ? Math.floor(idx.count / 3) : Math.floor(pos.count / 3);
              if (triCount <= 4096) {
                for (let t = 0; t < triCount; t++) {
                  const i0 = idx ? idx.getX(t * 3) : t * 3;
                  const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
                  const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
                  vA.fromBufferAttribute(pos, i0).applyMatrix4(node.matrixWorld);
                  vB.fromBufferAttribute(pos, i1).applyMatrix4(node.matrixWorld);
                  vC.fromBufferAttribute(pos, i2).applyMatrix4(node.matrixWorld);

                  // Skip nearly-horizontal floor/step top & bottom faces when thin slab
                  e1.subVectors(vB, vA);
                  e2.subVectors(vC, vA);
                  triNorm.crossVectors(e1, e2);
                  const len = triNorm.length();
                  if (len < 1e-6) continue;
                  const absNy = Math.abs(triNorm.y / len);
                  const meshHeight = tmpBox.max.y - tmpBox.min.y;
                  if (absNy > 0.92 && meshHeight <= 0.25) continue;

                  const minX = Math.min(vA.x, vB.x, vC.x);
                  const maxX = Math.max(vA.x, vB.x, vC.x);
                  const minY = Math.min(vA.y, vB.y, vC.y);
                  const maxY = Math.max(vA.y, vB.y, vC.y);
                  const minZ = Math.min(vA.z, vB.z, vC.z);
                  const maxZ = Math.max(vA.z, vB.z, vC.z);

                  const tri: ObstacleTriangle25D = {
                    ax: vA.x,
                    az: vA.z,
                    bx: vB.x,
                    bz: vB.z,
                    cx: vC.x,
                    cz: vC.z,
                    minX,
                    maxX,
                    minY,
                    maxY,
                    minZ,
                    maxZ,
                  };

                  const c0x = Math.floor((minX - capsuleRadiusM) * INV_HASH);
                  const c1x = Math.floor((maxX + capsuleRadiusM) * INV_HASH);
                  const c0z = Math.floor((minZ - capsuleRadiusM) * INV_HASH);
                  const c1z = Math.floor((maxZ + capsuleRadiusM) * INV_HASH);
                  for (let cx = c0x; cx <= c1x; cx++) {
                    for (let cz = c0z; cz <= c1z; cz++) {
                      const k = hashKey(cx, cz);
                      let arr = obstacleBuckets.get(k);
                      if (!arr) {
                        arr = [];
                        obstacleBuckets.set(k, arr);
                      }
                      arr.push(tri);
                    }
                  }
                }
              }
            }
          }
        }
      }

      for (let i = 0; i < node.children.length; i++) {
        visitObstacleNode(node.children[i]!);
      }
    };

    visitObstacleNode(scene);

    const rSq = capsuleRadiusM * capsuleRadiusM;
    const isCapsuleClear = (wx: number, wz: number, footY: number): boolean => {
      const capMinY = footY + stepHeightM + 0.04;
      const capMaxY = footY + capsuleHeightM;
      const bucket = obstacleBuckets.get(
        hashKey(Math.floor(wx * INV_HASH), Math.floor(wz * INV_HASH))
      );
      if (!bucket) return true;
      for (let i = 0; i < bucket.length; i++) {
        const tri = bucket[i]!;
        if (tri.maxY <= capMinY || tri.minY >= capMaxY) continue;
        if (
          wx + capsuleRadiusM < tri.minX ||
          wx - capsuleRadiusM > tri.maxX ||
          wz + capsuleRadiusM < tri.minZ ||
          wz - capsuleRadiusM > tri.maxZ
        ) {
          continue;
        }
        if (
          circleIntersectsTriangle2D(
            wx,
            wz,
            rSq,
            tri.ax,
            tri.az,
            tri.bx,
            tri.bz,
            tri.cx,
            tri.cz
          )
        ) {
          return false;
        }
      }
      return true;
    };

    // Build multi-layer 20 cm walkable grid nodes
    const cols = Math.max(1, Math.ceil((domMaxX - domMinX) / gridStepM) + 1);
    const rows = Math.max(1, Math.ceil((domMaxZ - domMinZ) / gridStepM) + 1);

    interface GridNode {
      readonly id: number;
      readonly gx: number;
      readonly gz: number;
      readonly wx: number;
      readonly wz: number;
      readonly footY: number;
    }

    const cellNodes: (GridNode[] | undefined)[] = new Array(cols * rows);
    const allNodes: GridNode[] = [];
    const seedElevations = sortedFloors.map((f) => f.elevationY);

    for (let gz = 0; gz < rows; gz++) {
      const wz = domMinZ + gz * gridStepM;
      for (let gx = 0; gx < cols; gx++) {
        const wx = domMinX + gx * gridStepM;
        const candidateYs: number[] = [];

        for (let s = 0; s < seedElevations.length; s++) {
          const y = sampleElevation(wx, wz, seedElevations[s]!);
          if (!Number.isFinite(y)) continue;
          if (!candidateYs.some((ey) => Math.abs(ey - y) < 0.16)) {
            candidateYs.push(y);
          }
        }
        for (let stIdx = 0; stIdx < stairs.length; stIdx++) {
          const st = stairs[stIdx]!;
          if (wx >= st.minX && wx <= st.maxX && wz >= st.minZ && wz <= st.maxZ) {
            const stY = st.sampleWorldY(wx, wz);
            if (stY !== null) {
              const y = sampleElevation(wx, wz, stY);
              if (Number.isFinite(y) && !candidateYs.some((ey) => Math.abs(ey - y) < 0.16)) {
                candidateYs.push(y);
              }
            }
          }
        }

        let list: GridNode[] | undefined;
        for (let c = 0; c < candidateYs.length; c++) {
          const footY = candidateYs[c]!;
          if (!isCapsuleClear(wx, wz, footY)) continue;
          const node: GridNode = {
            id: allNodes.length,
            gx,
            gz,
            wx,
            wz,
            footY,
          };
          allNodes.push(node);
          if (!list) list = [];
          list.push(node);
        }
        if (list) {
          cellNodes[gz * cols + gx] = list;
        }
      }
    }

    // Map each habitable room zone to its walkable grid nodes
    const zoneNodeIds = new Map<string, number[]>();
    for (const z of habitableZones) {
      const ids: number[] = [];
      const b = z.bounds;
      const gx0 = Math.max(0, Math.ceil((b.minX - domMinX) / gridStepM));
      const gx1 = Math.min(cols - 1, Math.floor((b.maxX - domMinX) / gridStepM));
      const gz0 = Math.max(0, Math.ceil((b.minZ - domMinZ) / gridStepM));
      const gz1 = Math.min(rows - 1, Math.floor((b.maxZ - domMinZ) / gridStepM));
      for (let gz = gz0; gz <= gz1; gz++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const list = cellNodes[gz * cols + gx];
          if (!list) continue;
          for (let i = 0; i < list.length; i++) {
            const n = list[i]!;
            if (z.excludedCutout?.(n.wx, n.wz)) continue;
            if (Math.abs(n.footY - z.walkingFloorY) <= 0.65) {
              ids.push(n.id);
            }
          }
        }
      }
      zoneNodeIds.set(z.id, ids);
    }

    // Choose BFS seed node from entryPosition -> entryZoneId -> first habitable zone
    let startNode: GridNode | undefined;
    if (options?.entryPosition) {
      const [ex, ey, ez] = options.entryPosition;
      let bestDistSq = Number.POSITIVE_INFINITY;
      for (let i = 0; i < allNodes.length; i++) {
        const n = allNodes[i]!;
        if (Math.abs(n.footY - ey) > 0.75) continue;
        const dSq = (n.wx - ex) * (n.wx - ex) + (n.wz - ez) * (n.wz - ez);
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          startNode = n;
        }
      }
    }
    if (!startNode) {
      const entryZone =
        (options?.entryZoneId
          ? habitableZones.find((z) => z.id === options.entryZoneId)
          : undefined) ?? habitableZones[0]!;
      const candidateIds = zoneNodeIds.get(entryZone.id) ?? [];
      if (candidateIds.length > 0) {
        const cx = (entryZone.bounds.minX + entryZone.bounds.maxX) * 0.5;
        const cz = (entryZone.bounds.minZ + entryZone.bounds.maxZ) * 0.5;
        let bestDistSq = Number.POSITIVE_INFINITY;
        for (const id of candidateIds) {
          const n = allNodes[id]!;
          const dSq = (n.wx - cx) * (n.wx - cx) + (n.wz - cz) * (n.wz - cz);
          if (dSq < bestDistSq) {
            bestDistSq = dSq;
            startNode = n;
          }
        }
      }
    }

    if (!startNode) {
      const z0 = habitableZones[0]!;
      findings.push({
        check: 'walkthrough',
        severity: 'error',
        code: 'NO_WALKABLE_ENTRY_CELL',
        message: `Entry room zone '${z0.id}' (${z0.label}) has zero clear first-person capsule cells (r=${capsuleRadiusM} m, h=${capsuleHeightM} m).`,
        objectName: z0.id,
      });
      return findings;
    }

    // Determine which floors are connected via staircases to startNode's floor
    const connectedFloorElevations = new Set<number>([
      sortedFloors.reduce((best, f) =>
        Math.abs(f.elevationY - startNode!.footY) < Math.abs(best - startNode!.footY)
          ? f.elevationY
          : best
      , sortedFloors[0]!.elevationY),
    ]);
    let addedFloor = true;
    while (addedFloor) {
      addedFloor = false;
      for (const st of stairs) {
        const hasBottom = Array.from(connectedFloorElevations).some(
          (fy) => Math.abs(fy - st.worldBottomY) <= 0.65
        );
        const hasTop = Array.from(connectedFloorElevations).some(
          (fy) => Math.abs(fy - st.worldTopY) <= 0.65
        );
        if (hasBottom && !hasTop) {
          connectedFloorElevations.add(st.worldTopY);
          addedFloor = true;
        } else if (hasTop && !hasBottom) {
          connectedFloorElevations.add(st.worldBottomY);
          addedFloor = true;
        }
      }
    }

    // BFS across 4-cardinal + corner-clear diagonal neighbors with |dy| <= stepHeightM
    const visited = new Uint8Array(allNodes.length);
    const queue = new Int32Array(allNodes.length);
    let qHead = 0;
    let qTail = 0;
    visited[startNode.id] = 1;
    queue[qTail++] = startNode.id;

    const hasMatchingHeightNode = (gx: number, gz: number, refY: number): boolean => {
      if (gx < 0 || gx >= cols || gz < 0 || gz >= rows) return false;
      const list = cellNodes[gz * cols + gx];
      if (!list) return false;
      for (let i = 0; i < list.length; i++) {
        if (Math.abs(list[i]!.footY - refY) <= stepHeightM + 1e-4) return true;
      }
      return false;
    };

    const neighborOffsets: readonly [number, number, boolean][] = [
      [1, 0, false],
      [-1, 0, false],
      [0, 1, false],
      [0, -1, false],
      [1, 1, true],
      [1, -1, true],
      [-1, 1, true],
      [-1, -1, true],
    ];

    while (qHead < qTail) {
      const cur = allNodes[queue[qHead++]!]!;
      for (let d = 0; d < neighborOffsets.length; d++) {
        const [dx, dz, isDiag] = neighborOffsets[d]!;
        const nx = cur.gx + dx;
        const nz = cur.gz + dz;
        if (nx < 0 || nx >= cols || nz < 0 || nz >= rows) continue;
        if (isDiag) {
          // Prevent diagonal squeezing through tight wall corners
          if (
            !hasMatchingHeightNode(cur.gx + dx, cur.gz, cur.footY) ||
            !hasMatchingHeightNode(cur.gx, cur.gz + dz, cur.footY)
          ) {
            continue;
          }
        }
        const nList = cellNodes[nz * cols + nx];
        if (!nList) continue;
        for (let i = 0; i < nList.length; i++) {
          const nb = nList[i]!;
          if (visited[nb.id]) continue;
          if (Math.abs(nb.footY - cur.footY) <= stepHeightM + 1e-4) {
            visited[nb.id] = 1;
            queue[qTail++] = nb.id;
          }
        }
      }
    }

    for (const z of habitableZones) {
      const isOnConnectedFloor =
        stairs.length === 0
          ? sortedFloors.length === 1 ||
            Array.from(connectedFloorElevations).some(
              (fy) => Math.abs(fy - z.walkingFloorY) <= 0.65
            )
          : Array.from(connectedFloorElevations).some(
              (fy) => Math.abs(fy - z.walkingFloorY) <= 0.65
            );
      if (!isOnConnectedFloor) {
        findings.push({
          check: 'walkthrough',
          severity: 'error',
          code: 'UNCONNECTED_FLOOR_ZONE',
          message: `Habitable room zone '${z.id}' (${z.label}, floor '${z.floorId}' at Y=${r3(z.walkingFloorY)} m) has no staircase connecting it to the entry floor.`,
          objectName: z.id,
          position: [
            r3((z.bounds.minX + z.bounds.maxX) * 0.5),
            r3(z.walkingFloorY),
            r3((z.bounds.minZ + z.bounds.maxZ) * 0.5),
          ],
          details: { zoneId: z.id, floorId: z.floorId, walkingFloorY: z.walkingFloorY },
        });
        continue;
      }

      const ids = zoneNodeIds.get(z.id) ?? [];
      const reachedCount = ids.reduce((acc, id) => acc + (visited[id] ? 1 : 0), 0);
      if (reachedCount === 0) {
        findings.push({
          check: 'walkthrough',
          severity: 'error',
          code: 'UNREACHABLE_ROOM_ZONE',
          message:
            ids.length === 0
              ? `Habitable room zone '${z.id}' (${z.label}) has 0 unobstructed first-person capsule cells (r=${capsuleRadiusM} m, h=${capsuleHeightM} m).`
              : `Habitable room zone '${z.id}' (${z.label}, floor '${z.floorId}') is unreachable by a first-person walker (r=${capsuleRadiusM} m, step=${stepHeightM} m) from '${ r3(startNode.wx)}, ${r3(startNode.footY)}, ${r3(startNode.wz)}' (${ids.length} interior walkable cell(s) isolated).`,
          objectName: z.id,
          position: [
            r3((z.bounds.minX + z.bounds.maxX) * 0.5),
            r3(z.walkingFloorY),
            r3((z.bounds.minZ + z.bounds.maxZ) * 0.5),
          ],
          details: {
            zoneId: z.id,
            floorId: z.floorId,
            interiorClearCells: ids.length,
            gridStepM,
            capsuleRadiusM,
          },
        });
      }
    }
  } finally {
    for (const s of savedDoorStates) {
      s.door.progress = s.progress;
      s.door.pivot.position.copy(s.pos);
      s.door.pivot.rotation.copy(s.rot);
      if (s.closedPivotPos) {
        s.door.closedPivotPos = s.closedPivotPos;
      } else {
        delete s.door.closedPivotPos;
      }
      s.door.pivot.updateMatrixWorld(true);
    }
  }

  return findings;
}

function summarizeCheck(
  check: AuditCheckName,
  findings: readonly AuditFinding[],
  durationMs: number,
  skipped: boolean
): AuditCheckSummary {
  if (skipped) {
    return {
      check,
      status: 'skipped',
      errorCount: 0,
      warningCount: 0,
      findings: [],
      durationMs: 0,
    };
  }
  let errorCount = 0;
  let warningCount = 0;
  for (const f of findings) {
    if (f.severity === 'error') errorCount++;
    else warningCount++;
  }
  const status: AuditCheckStatus =
    errorCount > 0 ? 'fail' : warningCount > 0 ? 'warn' : 'pass';
  return {
    check,
    status,
    errorCount,
    warningCount,
    findings,
    durationMs,
  };
}

export function runArchitecturalAudit(
  scene: THREE.Object3D,
  options?: ArchitecturalAuditOptions
): ArchitecturalAuditReport {
  const tStart = performance.now();
  const skipped = new Set<AuditCheckName>(options?.skipChecks ?? []);
  const summaries = {} as Record<AuditCheckName, AuditCheckSummary>;
  const allFindings: AuditFinding[] = [];
  let zFightingFindings: readonly ZFightingFinding[] = [];

  // Z-Fighting
  if (skipped.has('zFighting')) {
    summaries.zFighting = summarizeCheck('zFighting', [], 0, true);
  } else {
    const t0 = performance.now();
    zFightingFindings = detectZFighting(scene, {
      epsilonM: 0.00035,
      ...options?.zFighting,
    });
    const zfAuditFindings: AuditFinding[] = zFightingFindings.map((f) => ({
      check: 'zFighting',
      severity: 'error',
      code: 'COPLANAR_Z_FIGHTING',
      message: `Coplanar z-fighting overlap (${f.overlapAreaCm2.toFixed(1)} cm², Δ=${f.planeDistanceDiffMm.toFixed(3)} mm) between '${f.meshA}' and '${f.meshB}'.`,
      objectName: f.meshA,
      targetName: f.meshB,
      position: f.centroid,
      details: {
        overlapAreaCm2: f.overlapAreaCm2,
        planeDistanceDiffMm: f.planeDistanceDiffMm,
        normal: f.normal,
      },
    }));
    summaries.zFighting = summarizeCheck(
      'zFighting',
      zfAuditFindings,
      performance.now() - t0,
      false
    );
    allFindings.push(...zfAuditFindings);
  }

  // Cutaway Integrity
  if (skipped.has('cutaway')) {
    summaries.cutaway = summarizeCheck('cutaway', [], 0, true);
  } else {
    const t0 = performance.now();
    const cutFindings = auditCutawayIntegrity(scene, {
      floors: options?.floors,
      ...options?.cutaway,
    });
    summaries.cutaway = summarizeCheck(
      'cutaway',
      cutFindings,
      performance.now() - t0,
      false
    );
    allFindings.push(...cutFindings);
  }

  // Door-Swing & Drawer Clearance
  if (skipped.has('doorSwings')) {
    summaries.doorSwings = summarizeCheck('doorSwings', [], 0, true);
  } else {
    const t0 = performance.now();
    const doorFindings = auditDoorSwings(scene, {
      interactions: options?.interactions,
      doorPolicy: options?.doorPolicy,
      ...options?.doorSwings,
    });
    summaries.doorSwings = summarizeCheck(
      'doorSwings',
      doorFindings,
      performance.now() - t0,
      false
    );
    allFindings.push(...doorFindings);
  }

  // First-person capsule walkthrough reachability & stair headroom
  if (skipped.has('walkthrough')) {
    summaries.walkthrough = summarizeCheck('walkthrough', [], 0, true);
  } else {
    const t0 = performance.now();
    const wtFindings = auditWalkthroughReachability(scene, {
      floors: options?.floors,
      roomZones: options?.roomZones,
      interactions: options?.interactions,
      doorPolicy: options?.doorPolicy,
      elevationSampler: options?.elevationSampler,
      terrainSampler: options?.terrainSampler,
      entryPosition: options?.entryPosition,
      entryZoneId: options?.entryZoneId,
      ...options?.walkthrough,
    });
    summaries.walkthrough = summarizeCheck(
      'walkthrough',
      wtFindings,
      performance.now() - t0,
      false
    );
    allFindings.push(...wtFindings);
  }

  let errorCount = 0;
  let warningCount = 0;
  for (const check of ALL_AUDIT_CHECKS) {
    errorCount += summaries[check].errorCount;
    warningCount += summaries[check].warningCount;
  }

  return {
    passed: errorCount === 0,
    errorCount,
    warningCount,
    checks: summaries,
    findings: allFindings,
    zFightingFindings,
    durationMs: performance.now() - tStart,
  };
}

export function assertArchitecturalAudit(
  scene: THREE.Object3D,
  options?: ArchitecturalAuditOptions & { readonly failOnWarnings?: boolean }
): ArchitecturalAuditReport {
  const report = runArchitecturalAudit(scene, options);
  const failCount =
    report.errorCount + (options?.failOnWarnings ? report.warningCount : 0);
  if (failCount > 0) {
    const summaryLines = report.findings
      .filter((f) => f.severity === 'error' || options?.failOnWarnings)
      .slice(0, 12)
      .map((f) => `  [${f.severity.toUpperCase()} ${f.check}:${f.code}] ${f.message}`);
    throw new Error(
      `Architectural audit failed (${report.errorCount} error(s), ${report.warningCount} warning(s)):\n${summaryLines.join('\n')}`
    );
  }
  return report;
}
