import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { PropertySceneLayers } from '../viewer/scene-content.ts';

const bevelGeometryCache = new Map<string, RoundedBoxGeometry>();

/** Minimum cross-section thickness (18 mm) for a chamfered edge to resolve above sub-pixel width. */
export const BEVEL_MIN_THICKNESS_M = 0.018;
/** Minimum secondary dimension (48 mm) — skips narrow slats, fins, battens, muntins, and trim strips. */
export const BEVEL_MIN_MIDDLE_DIM_M = 0.048;
/** Minimum primary length (160 mm) — skips small blocks, buttons, sockets, and hardware micro-parts. */
export const BEVEL_MIN_LENGTH_M = 0.16;

function qMm(value: number): number {
  return Math.round(value * 2000) / 2000;
}

function getCachedChamferBoxGeometry(
  width: number,
  height: number,
  depth: number,
  radius: number
): RoundedBoxGeometry {
  const qw = qMm(width);
  const qh = qMm(height);
  const qd = qMm(depth);
  const qr = qMm(radius);
  const key = `${qw}:${qh}:${qd}:${qr}`;
  let geo = bevelGeometryCache.get(key);
  if (!geo) {
    // segments = 1 creates a 1-segment smoothed-normal chamfer (108 tris vs 200+ for multi-segment),
    // giving smooth specular edge highlights at a fraction of the vertex count.
    geo = new RoundedBoxGeometry(qw, qh, qd, 1, qr);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    bevelGeometryCache.set(key, geo);
  }
  return geo;
}

const JOINERY_OR_FURNITURE_NAME_RE =
  /island|cabinet|drawer|door|table|desk|bench|sofa|chair|ottoman|bed|wardrobe|dresser|sideboard|bookcase|shelf|shelves|mantel|hearth|beam|bressummer|joist|rafter|newel|handrail|balustrade|tread|aga|fridge|oven|washer|dryer|sink|vanity|bath|radiator|tv|speaker|subwoofer|console|clock|frame|art|mirror|plinth|worktop|counter/i;

const STRUCTURAL_WALL_NAME_RE =
  /wall|pier|header|lintel|sill|spandrel|gable|chimneyBreast|parapet|partition|lining|plaster|slab|floor|terrace|step|roof|ceilingSheet/i;

/**
 * Micro-parts, repetitive thin slats/battens, and concealed carcass interiors where a 9x triangle
 * bevel expansion (`12 -> 108` tris) produces sub-0.2px edges or sits inside closed joinery.
 */
const MICRO_OR_HIDDEN_PART_NAME_RE =
  /leafCore|recessCore|solidDoorCore|alcoveEnclosure|voidFloor|ceilingBacking|subSlab|stoneCourse|archBrick|firebrick|tgPlank|\bbook\b|book[._A-Z0-9]|socket|switch|screw|bolt|rivet|shelfPin|\bfin\b|dripTray|slat|batten|trellis|muntin|glazingBar|spoke|pegboard|lath|greenhouse/i;

/**
 * Applies a selective 1-segment smoothed chamfer (`RoundedBoxGeometry` with `segments = 1`)
 * to furniture, cabinetry, worktops, tables, timber beams, fireplace mantels, and doors,
 * while preserving seamless flat structural plaster walls, floor slabs, concealed interiors,
 * and sub-4.8cm micro-parts.
 */
export function applySelectiveBevelModifier(layers: PropertySceneLayers): void {
  const { scene, cutawayWallGroups } = layers;
  const cutawayRoots = new Set<THREE.Object3D>([
    cutawayWallGroups.southWest,
    cutawayWallGroups.west,
    cutawayWallGroups.north,
    cutawayWallGroups.east,
  ]);

  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (obj.geometry.type !== 'BoxGeometry') return;
    if (Array.isArray(obj.material)) return;
    if (obj.userData?.isAnnotationGroup) return;

    // Skip invisible hitboxes or transparent glow/glass volumes
    const mat = obj.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
    if (!mat || !mat.visible || mat.transparent) return;

    // Only bevel meshes with near-uniform scale so bevels are never stretched
    if (
      Math.abs(obj.scale.x - 1) > 0.05 ||
      Math.abs(obj.scale.y - 1) > 0.05 ||
      Math.abs(obj.scale.z - 1) > 0.05
    ) {
      return;
    }

    const params = (obj.geometry as THREE.BoxGeometry).parameters as
      | {
          width?: number;
          height?: number;
          depth?: number;
          widthSegments?: number;
          heightSegments?: number;
          depthSegments?: number;
        }
      | undefined;
    if (!params) return;
    const w = params.width ?? 1;
    const h = params.height ?? 1;
    const d = params.depth ?? 1;

    // Physical dimension gate: skip sub-18mm thin parts, narrow strips/rods (< 48mm middle axis),
    // and short micro-blocks (< 160mm) before scanning vertex buffers or parent chains.
    const minDim = Math.min(w, h, d);
    const maxDim = Math.max(w, h, d);
    const midDim = w + h + d - minDim - maxDim;
    if (
      minDim < BEVEL_MIN_THICKNESS_M ||
      midDim < BEVEL_MIN_MIDDLE_DIM_M ||
      maxDim < BEVEL_MIN_LENGTH_M ||
      maxDim > 6.5
    ) {
      return;
    }

    // Skip wide room floor slabs, ceiling plasterboards, and terrace slabs
    if (midDim >= 1.6 && minDim <= 0.45) {
      return;
    }

    // Never overwrite BoxGeometries that are subdivided, sculpted (e.g. sofa cushions, pillows, beds),
    // or whose vertices were sheared, tapered, or translated in-place!
    if (
      obj.geometry.userData?.isSheared ||
      obj.geometry.userData?.isSculpted ||
      (params.widthSegments ?? 1) !== 1 ||
      (params.heightSegments ?? 1) !== 1 ||
      (params.depthSegments ?? 1) !== 1
    ) {
      return;
    }
    const posAttr = obj.geometry.getAttribute('position');
    if (!posAttr || posAttr.count !== 24) {
      return;
    }
    {
      const hw = w * 0.5;
      const hh = h * 0.5;
      const hd = d * 0.5;
      for (let i = 0; i < 24; i++) {
        if (
          Math.abs(Math.abs(posAttr.getX(i)) - hw) > 1e-3 ||
          Math.abs(Math.abs(posAttr.getY(i)) - hh) > 1e-3 ||
          Math.abs(Math.abs(posAttr.getZ(i)) - hd) > 1e-3
        ) {
          return;
        }
      }
    }

    // Inspect ancestor hierarchy for semantic context
    let inCutawayWall = false;
    let inArchitecturalShell = false;
    let hasFurnitureOrJoineryTag = false;
    let hasExplicitWallName = false;
    let cur: THREE.Object3D | null = obj;
    while (cur && cur !== scene) {
      if (typeof cur.name === 'string' && cur.name.length > 0) {
        if (MICRO_OR_HIDDEN_PART_NAME_RE.test(cur.name)) {
          return;
        }
        if (JOINERY_OR_FURNITURE_NAME_RE.test(cur.name)) {
          hasFurnitureOrJoineryTag = true;
        } else if (STRUCTURAL_WALL_NAME_RE.test(cur.name)) {
          hasExplicitWallName = true;
        }
      }
      if (cutawayRoots.has(cur) || cur.userData?.cutawayWall || cur.userData?.isCutawayWall) {
        inCutawayWall = true;
      }
      if (cur.userData?.isArchitecturalShell) {
        inArchitecturalShell = true;
      }
      if (
        cur.userData?.interactableId ||
        cur.userData?.isBifoldDoor ||
        cur.userData?.isCarGate
      ) {
        hasFurnitureOrJoineryTag = true;
      }
      cur = cur.parent;
    }

    if (hasExplicitWallName || (inArchitecturalShell && !hasFurnitureOrJoineryTag)) {
      return;
    }

    // Skip structural plaster / brick wall segments (piers, lintels, sills, partitions)
    // so abutting wall boxes never show V-groove seams in flat walls.
    const minHoriz = Math.min(w, d);
    const maxHoriz = Math.max(w, d);
    const isWallThickness = minHoriz >= 0.075 && minHoriz <= 0.36;
    const isMatteWallPlasterOrBrick =
      'roughness' in mat &&
      typeof mat.roughness === 'number' &&
      mat.roughness >= 0.82 &&
      (mat.metalness ?? 0) <= 0.05;

    if (!hasFurnitureOrJoineryTag) {
      if (inCutawayWall && isWallThickness) {
        return;
      }
      if (isWallThickness && h >= 0.38 && maxHoriz >= 0.28 && isMatteWallPlasterOrBrick) {
        return;
      }
      if (isWallThickness && h >= 1.85 && maxHoriz >= 0.22) {
        return;
      }
    }

    const radius =
      minDim <= 0.045
        ? Math.min(0.0035, minDim * 0.12)
        : Math.min(0.0055, minDim * 0.075);

    obj.geometry = getCachedChamferBoxGeometry(w, h, d, radius);
  });
}
