import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { isRealBrowserMobile } from '../perf/device-tier.ts';
import type { PropertySceneLayers } from '../viewer/scene-content.ts';

const bevelGeometryCache = new Map<string, RoundedBoxGeometry>();

/** Minimum cross-section thickness (22 mm) — skips tiny sub-parts too thin on screen to resolve a 1.2 mm fillet. */
export const BEVEL_MIN_THICKNESS_M = 0.022;
/** Minimum secondary dimension (32 mm) — catches 35–48 mm stiles, rails, frames, trim, and mullions. */
export const BEVEL_MIN_MIDDLE_DIM_M = 0.032;
/** Minimum primary length (80 mm) — skips sub-8 cm hardware/blocks while catching plinths, corbels, and short returns. */
export const BEVEL_MIN_LENGTH_M = 0.08;

/** Hero architectural joinery / masonry / worktop thresholds eligible for 2-segment fillets on desktop. */
export const BEVEL_HERO_MIN_MAX_DIM_M = 0.65;
export const BEVEL_HERO_MIN_MID_DIM_M = 0.25;
export const BEVEL_HERO_MIN_THICKNESS_M = 0.038;

export function resolveAdaptiveBevelSegments(params: {
  readonly minDim: number;
  readonly midDim: number;
  readonly maxDim: number;
  readonly isConstrainedMobile: boolean;
  readonly overrideSegments?: 1 | 2;
}): 1 | 2 {
  if (params.overrideSegments !== undefined) {
    return params.overrideSegments;
  }
  if (params.isConstrainedMobile) {
    return 1;
  }
  if (
    params.maxDim >= BEVEL_HERO_MIN_MAX_DIM_M &&
    params.midDim >= BEVEL_HERO_MIN_MID_DIM_M &&
    params.minDim >= BEVEL_HERO_MIN_THICKNESS_M
  ) {
    return 2;
  }
  return 1;
}

export interface SelectiveBevelOptions {
  readonly segments?: 1 | 2;
  readonly isConstrainedMobile?: boolean;
}

export interface RoundedBoxParameters {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly segments: number;
  readonly radius: number;
}

function qMm(value: number): number {
  return Math.round(value * 2000) / 2000;
}

function getCachedChamferBoxGeometry(
  width: number,
  height: number,
  depth: number,
  segments: 1 | 2,
  radius: number
): RoundedBoxGeometry {
  const qw = qMm(width);
  const qh = qMm(height);
  const qd = qMm(depth);
  const qr = qMm(radius);
  const key = `${qw}:${qh}:${qd}:${segments}:${qr}`;
  let geo = bevelGeometryCache.get(key);
  if (!geo) {
    geo = new RoundedBoxGeometry(qw, qh, qd, segments, qr);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    bevelGeometryCache.set(key, geo);
  }
  return geo;
}

const DEFAULT_UV_EPS = 1e-4;

/**
 * Checks whether a 24-vertex `THREE.BoxGeometry` `uv` attribute still holds standard
 * per-face `[0,1], [1,1], [0,0], [1,0]` coordinates across all 6 faces.
 */
export function hasDefaultBoxUvs(
  uvAttr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute
): boolean {
  if (uvAttr.count !== 24) return false;
  for (let side = 0; side < 6; side++) {
    const base = side * 4;
    if (
      Math.abs(uvAttr.getX(base) - 0) > DEFAULT_UV_EPS ||
      Math.abs(uvAttr.getY(base) - 1) > DEFAULT_UV_EPS ||
      Math.abs(uvAttr.getX(base + 1) - 1) > DEFAULT_UV_EPS ||
      Math.abs(uvAttr.getY(base + 1) - 1) > DEFAULT_UV_EPS ||
      Math.abs(uvAttr.getX(base + 2) - 0) > DEFAULT_UV_EPS ||
      Math.abs(uvAttr.getY(base + 2) - 0) > DEFAULT_UV_EPS ||
      Math.abs(uvAttr.getX(base + 3) - 1) > DEFAULT_UV_EPS ||
      Math.abs(uvAttr.getY(base + 3) - 0) > DEFAULT_UV_EPS
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Creates a `RoundedBoxGeometry` instance sharing `position` and `normal` `BufferAttribute`
 * references with `baseRounded` while allocating only a custom `uv` `Float32Array` whose
 * per-face UVs bilinearly interpolate the source 24-vertex `BoxGeometry`'s affine face UVs
 * (preserving rotated wood grain, flips, stochastic slice offsets, and metric masonry tiling).
 */
function buildUvInterpolatedRoundedBox(
  baseRounded: RoundedBoxGeometry,
  srcUvAttr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  srcUserData?: Record<string, unknown>
): RoundedBoxGeometry {
  const baseUv = baseRounded.getAttribute('uv') as THREE.BufferAttribute;
  const totalVerts = baseUv.count;
  const vertsPerSide = totalVerts / 6;
  const baseUvArr = baseUv.array as Float32Array;
  const outUvArr = new Float32Array(totalVerts * 2);

  for (let side = 0; side < 6; side++) {
    const srcBase = side * 4;
    const u0 = srcUvAttr.getX(srcBase);
    const v0 = srcUvAttr.getY(srcBase);
    const u1 = srcUvAttr.getX(srcBase + 1);
    const v1 = srcUvAttr.getY(srcBase + 1);
    const u2 = srcUvAttr.getX(srcBase + 2);
    const v2 = srcUvAttr.getY(srcBase + 2);
    const u3 = srcUvAttr.getX(srcBase + 3);
    const v3 = srcUvAttr.getY(srcBase + 3);

    const vStart = side * vertsPerSide;
    const vEnd = vStart + vertsPerSide;
    for (let vi = vStart; vi < vEnd; vi++) {
      const j = vi * 2;
      const s = baseUvArr[j]!;
      const t = baseUvArr[j + 1]!;
      const oneMinusS = 1 - s;
      const oneMinusT = 1 - t;

      const uBot = oneMinusS * u2 + s * u3;
      const uTop = oneMinusS * u0 + s * u1;
      const vBot = oneMinusS * v2 + s * v3;
      const vTop = oneMinusS * v0 + s * v1;

      outUvArr[j] = oneMinusT * uBot + t * uTop;
      outUvArr[j + 1] = oneMinusT * vBot + t * vTop;
    }
  }

  const cloned = new THREE.BufferGeometry() as RoundedBoxGeometry;
  Object.setPrototypeOf(cloned, RoundedBoxGeometry.prototype);
  const mutableCloned = cloned as unknown as {
    type: string;
    parameters: unknown;
  };
  mutableCloned.type = baseRounded.type;
  mutableCloned.parameters = (baseRounded as unknown as { parameters: unknown }).parameters;
  cloned.setAttribute('position', baseRounded.getAttribute('position'));
  cloned.setAttribute('normal', baseRounded.getAttribute('normal'));
  cloned.setAttribute('uv', new THREE.BufferAttribute(outUvArr, 2));
  if (baseRounded.groups.length > 0) {
    for (const grp of baseRounded.groups) {
      cloned.addGroup(grp.start, grp.count, grp.materialIndex);
    }
  }
  cloned.boundingBox = baseRounded.boundingBox ? baseRounded.boundingBox.clone() : null;
  cloned.boundingSphere = baseRounded.boundingSphere ? baseRounded.boundingSphere.clone() : null;
  if (srcUserData) {
    cloned.userData = { ...srcUserData };
  }
  return cloned;
}

function tokenizeIdentifierWords(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim();
}

const JOINERY_OR_FURNITURE_WORD_RE =
  /\b(island|cabinets?|drawers?|doors?|tables?|desks?|bench|benches|sofas?|chairs?|ottomans?|beds?|wardrobes?|dressers?|sideboards?|bookcases?|shelf|shelves|mantels?|mantles?|hearths?|beams?|bressummers?|joists?|rafters?|newels?|handrails?|balustrades?|treads?|risers?|steps?|thresholds?|cookers?|ranges?|fridges?|ovens?|washers?|dryers?|sinks?|vanity|vanities|baths?|bathtubs?|radiators?|tvs?|speakers?|subwoofers?|consoles?|clocks?|frames?|art|artworks?|mirrors?|plinths?|worktops?|counters?|countertops?|sills?|cills?|window Boards?|mullions?|transoms?|casements?|sash|sashes|stiles?|rails?|panels?|architraves?|skirtings?|dados?|cornices?|pelmets?|shutters?|pilasters?|columns?|posts?|surrounds?|cheeks?|hobs?|corbels?|lintel Stones?|quoins?|copings?|pier Caps?|gate Piers?|portico Piers?|porticos?|stoves?|firebox|sconces?|lamps?|planters?)\b/i;

const STRUCTURAL_WALL_RAW_RE =
  /\b(wall|exteriorBrickWall|brickWall|wallRun|wallSegment|spandrel|gable|chimneyBreast|parapet|partition|lining|plasterLining|plasterWall|floorSlab|ceilingSlab|subSlab|terraceSlab|roofSlope|ceilingSheet)\b|wall[A-Z_0-9]|Slab$/i;

const STRUCTURAL_WALL_WORD_RE =
  /\b(walls?|spandrels?|gables?|chimney Breasts?|parapets?|partitions?|linings?|slabs?|roof Slopes?|ceiling Sheets?)\b/i;

function classifySemanticSegment(segment: string): 'joinery' | 'structural' | 'neutral' {
  if (!segment) return 'neutral';
  const words = tokenizeIdentifierWords(segment);
  if (JOINERY_OR_FURNITURE_WORD_RE.test(words)) {
    return 'joinery';
  }
  if (STRUCTURAL_WALL_RAW_RE.test(segment) || STRUCTURAL_WALL_WORD_RE.test(words)) {
    return 'structural';
  }
  return 'neutral';
}

function classifyObjectName(rawName: string): 'joinery' | 'structural' | 'neutral' {
  const parts = rawName.split('.');
  for (let i = parts.length - 1; i >= 0; i--) {
    const cls = classifySemanticSegment(parts[i]!);
    if (cls !== 'neutral') {
      return cls;
    }
  }
  return classifySemanticSegment(rawName);
}

/**
 * Micro-parts, repetitive thin slats/battens, and concealed carcass interiors where bevel
 * expansion produces sub-pixel edges or sits inside closed joinery.
 */
const MICRO_OR_HIDDEN_PART_NAME_RE =
  /leafCore|recessCore|solidDoorCore|alcoveEnclosure|voidFloor|ceilingBacking|subSlab|stoneCourse|archBrick|firebrick|tgPlank|\bbook\b|book[._A-Z0-9]|socket|switch|screw|bolt|rivet|shelfPin|\bfin\b|dripTray|slat|batten|trellis|muntin|glazingBar|spoke|pegboard|lath|greenhouse/i;

/**
 * Applies a selective smooth micro-bevel (`RoundedBoxGeometry` with `segments = 2` on desktop,
 * `segments = 1` on constrained mobile) with exact per-face affine UV interpolation to joinery,
 * trim, window sills/boards, doors, fireplaces, stone steps, cabinetry, and furniture, while
 * preserving seamless flat structural walls, floor/ceiling slabs, and `isSculpted` / `bevelLocked` meshes.
 */
export function applySelectiveBevelModifier(
  layers: PropertySceneLayers,
  options?: SelectiveBevelOptions
): void {
  const { scene, cutawayWallGroups } = layers;
  const isConstrainedMobile = options?.isConstrainedMobile ?? isRealBrowserMobile();

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

    const geoUserData = obj.geometry.userData as Record<string, unknown> | undefined;
    if (
      obj.userData?.noBevel === true ||
      geoUserData?.noBevel === true ||
      geoUserData?.bevelLocked === true ||
      Boolean(geoUserData?.isSheared) ||
      Boolean(geoUserData?.isSculpted)
    ) {
      return;
    }

    const mat = obj.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
    if (!mat || !mat.visible || mat.transparent) return;

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

    if (midDim >= 1.6 && minDim <= 0.45) {
      return;
    }

    if (
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

    let inCutawayWall = false;
    let inArchitecturalShell = false;
    let nearestSemanticTag: 'joinery' | 'structural' | null = null;
    let hasAncestorWallTag = false;
    let cur: THREE.Object3D | null = obj;
    while (cur && cur !== scene) {
      if (cur.userData?.noBevel === true || cur.userData?.bevelLocked === true) {
        return;
      }
      if (typeof cur.name === 'string' && cur.name.length > 0) {
        if (MICRO_OR_HIDDEN_PART_NAME_RE.test(cur.name)) {
          return;
        }
        const cls = classifyObjectName(cur.name);
        if (cls !== 'neutral' && nearestSemanticTag === null) {
          nearestSemanticTag = cls;
        }
        if (cls === 'structural') {
          hasAncestorWallTag = true;
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
        cur.userData?.isAnimatedDoor ||
        cur.userData?.isExteriorGate
      ) {
        if (nearestSemanticTag === null) {
          nearestSemanticTag = 'joinery';
        }
      }
      cur = cur.parent;
    }

    if (nearestSemanticTag === 'structural') {
      return;
    }

    const hasFurnitureOrJoineryTag = nearestSemanticTag === 'joinery';
    if (!hasFurnitureOrJoineryTag && (hasAncestorWallTag || inArchitecturalShell)) {
      return;
    }

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

    const segments = resolveAdaptiveBevelSegments({
      minDim,
      midDim,
      maxDim,
      isConstrainedMobile,
      overrideSegments: options?.segments,
    });
    const radius = THREE.MathUtils.clamp(minDim * 0.085, 0.0012, 0.0035);
    const baseRounded = getCachedChamferBoxGeometry(w, h, d, segments, radius);

    const uvAttr = obj.geometry.getAttribute('uv');
    if (!uvAttr || hasDefaultBoxUvs(uvAttr)) {
      obj.geometry = baseRounded;
    } else {
      obj.geometry = buildUvInterpolatedRoundedBox(baseRounded, uvAttr, geoUserData);
    }
  });
}
