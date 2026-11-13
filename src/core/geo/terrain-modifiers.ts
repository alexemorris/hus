/**
 * Pure, zero-dependency (`core`-layer safe) `.husgrid.json` DEM heightgrid decoder,
 * multi-tier C1 bilinear sampler, and composable non-destructive `TerrainModifier[]` pipeline.
 *
 * Supports multi-tier concentric heightgrids with optional `scaleM` (default `0.001` = 1 mm).
 */

export interface QuantizedHeightGridSpec {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly step: number;
  readonly cols: number;
  readonly rows: number;
  readonly base64Int16Mm: string;
}

export interface HusGridLayerSpec extends QuantizedHeightGridSpec {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly step: number;
  readonly cols: number;
  readonly rows: number;
  /**
   * Base64 little-endian `Int16` quantized heights relative to `origin.datumElevationM`.
   * Multiply each `Int16` sample by `scaleM ?? 0.001` to obtain metres.
   */
  readonly base64Int16Mm: string;
  /**
   * Metres per `Int16` quantized unit. Defaults to `0.001` (`1 mm`, `±32.767 m` range).
   * Steep sites (e.g. `> ±32 m` relief) use `0.01` (`1 cm`, `±327.67 m`) or `0.1` (`10 cm`).
   */
  readonly scaleM?: number;
  /** Optional alias for `scaleM` expressed in millimetres per `Int16` unit (default `1`). */
  readonly unitMm?: number;
  /** Optional C1 margin blend width (metres) when transitioning into a coarser outer grid. */
  readonly blendMarginM?: number;
}

export interface HusGridOrigin {
  readonly lat: number;
  readonly lon: number;
  readonly datumElevationM: number;
  readonly northOffsetDeg?: number;
}

export interface HusGridDocument {
  readonly format: 'husgrid-v1';
  readonly origin: HusGridOrigin;
  readonly source?: string;
  /** One or more concentric local ENU grids (finest first, C1-blended at margins). */
  readonly grids: readonly HusGridLayerSpec[];
}

export type HusGridFile = HusGridDocument;

export interface DecodedTerrainGrid {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly step: number;
  readonly cols: number;
  readonly rows: number;
  readonly scaleM: number;
  readonly blendMarginM: number;
  readonly heightsM: Float32Array;
}

export function decodeBase64Bytes(base64: string): Uint8Array {
  const cleaned = base64.replace(/\s+/g, '');
  if (cleaned.length === 0) {
    return new Uint8Array(0);
  }
  const normalized = cleaned.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    '='
  );
  const bufferCtor = (
    globalThis as {
      readonly Buffer?: { from(input: string, encoding: 'base64'): Uint8Array };
    }
  ).Buffer;
  if (typeof bufferCtor !== 'undefined') {
    return new Uint8Array(bufferCtor.from(padded, 'base64'));
  }
  const binary = atob(padded);
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

/** Hermite C1 smoothstep interpolation in `[0, 1]`. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 === edge0) {
    return x < edge0 ? 0 : 1;
  }
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function signedBoxDist2D(
  x: number,
  z: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number
): number {
  const dx = Math.max(minX - x, 0, x - maxX);
  const dz = Math.max(minZ - z, 0, z - maxZ);
  const outside = Math.hypot(dx, dz);
  if (outside > 0) return outside;
  return -Math.min(x - minX, maxX - x, z - minZ, maxZ - z);
}

/**
 * Exact 2D Euclidean signed distance to an axis-aligned ellipse `(rx, rz)` centred at `(0, 0)`.
 * Negative strictly inside, `0` on the perimeter, positive outside.
 */
function signedEllipseDist2D(px: number, pz: number, rx: number, rz: number): number {
  const safeRx = Math.max(1e-6, rx);
  const safeRz = Math.max(1e-6, rz);
  if (Math.abs(safeRx - safeRz) <= 1e-6) {
    return Math.hypot(px, pz) - safeRx;
  }

  let x = Math.abs(px);
  let y = Math.abs(pz);
  let a = safeRx;
  let b = safeRz;
  if (x > y) {
    // Keep symmetry stable; solve in standard quadrant via Newton on angle t in [0, pi/2].
  } else {
    const tmpP = x;
    x = y;
    y = tmpP;
    const tmpR = a;
    a = b;
    b = tmpR;
  }

  let t = Math.atan2(a * y, b * x);
  for (let iter = 0; iter < 5; iter++) {
    const ct = Math.cos(t);
    const st = Math.sin(t);
    const ex = a * ct;
    const ey = b * st;
    const rxDiff = x - ex;
    const ryDiff = y - ey;
    const f = -a * st * rxDiff + b * ct * ryDiff;
    const df = a * ct * rxDiff + a * a * st * st + b * st * ryDiff + b * b * ct * ct;
    if (Math.abs(df) <= 1e-12) break;
    t = Math.max(0, Math.min(0.5 * Math.PI, t - f / df));
  }
  const qx = a * Math.cos(t);
  const qy = b * Math.sin(t);
  const dist = Math.hypot(x - qx, y - qy);
  const inside = (x * x) / (a * a) + (y * y) / (b * b) < 1;
  return inside ? -dist : dist;
}

function signedPolygonDist2D(
  px: number,
  pz: number,
  vertices: readonly (readonly [number, number])[]
): number {
  const n = vertices.length;
  if (n === 0) return Infinity;
  if (n === 1) return Math.hypot(px - vertices[0]![0], pz - vertices[0]![1]);
  if (n === 2) {
    const [ax, az] = vertices[0]!;
    const [bx, bz] = vertices[1]!;
    const abx = bx - ax;
    const abz = bz - az;
    const len2 = abx * abx + abz * abz;
    const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / len2)) : 0;
    return Math.hypot(px - (ax + t * abx), pz - (az + t * abz));
  }

  let minDist2 = Infinity;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [ix, iz] = vertices[i]!;
    const [jx, jz] = vertices[j]!;
    const ex = ix - jx;
    const ez = iz - jz;
    const wx = px - jx;
    const wz = pz - jz;
    const len2 = ex * ex + ez * ez;
    const t = len2 > 1e-12 ? Math.max(0, Math.min(1, (wx * ex + wz * ez) / len2)) : 0;
    const dx = wx - ex * t;
    const dz = wz - ez * t;
    const d2 = dx * dx + dz * dz;
    if (d2 < minDist2) minDist2 = d2;

    const cond1 = iz > pz;
    const cond2 = jz > pz;
    if (cond1 !== cond2) {
      const xIntersect = ((jx - ix) * (pz - iz)) / (jz - iz) + ix;
      if (px < xIntersect) {
        inside = !inside;
      }
    }
  }
  const dist = Math.sqrt(minDist2);
  return inside ? -dist : dist;
}

const decodedGridCache = new WeakMap<HusGridLayerSpec, DecodedTerrainGrid>();

function isDecodedTerrainGrid(
  grid: HusGridLayerSpec | DecodedTerrainGrid
): grid is DecodedTerrainGrid {
  return 'heightsM' in grid && grid.heightsM instanceof Float32Array;
}

function defaultBlendMarginM(spec: HusGridLayerSpec): number {
  const spanX = Math.max(0, spec.maxX - spec.minX);
  const spanZ = Math.max(0, spec.maxZ - spec.minZ);
  const quarterMinSpan = 0.25 * Math.min(spanX, spanZ);
  return Math.max(spec.step, Math.min(spec.step * 6, quarterMinSpan));
}

export function decodeHusGridLayer(spec: HusGridLayerSpec): DecodedTerrainGrid {
  const cached = decodedGridCache.get(spec);
  if (cached) return cached;

  const scaleM =
    spec.scaleM ?? (spec.unitMm !== undefined ? spec.unitMm * 0.001 : 0.001);
  const count = spec.cols * spec.rows;
  const bytes = decodeBase64Bytes(spec.base64Int16Mm);
  if (bytes.byteLength < count * 2) {
    throw new Error(
      `Invalid HusGridLayerSpec: expected ${count * 2} bytes for ${spec.cols}x${spec.rows} grid, got ${bytes.byteLength}`
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const heightsM = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    heightsM[i] = view.getInt16(i * 2, true) * scaleM;
  }

  const decoded: DecodedTerrainGrid = {
    minX: spec.minX,
    maxX: spec.maxX,
    minZ: spec.minZ,
    maxZ: spec.maxZ,
    step: spec.step,
    cols: spec.cols,
    rows: spec.rows,
    scaleM,
    blendMarginM: spec.blendMarginM ?? defaultBlendMarginM(spec),
    heightsM,
  };
  decodedGridCache.set(spec, decoded);
  return decoded;
}

export function sampleDecodedTerrainGrid(
  grid: DecodedTerrainGrid,
  wx: number,
  wz: number
): number {
  if (grid.cols <= 0 || grid.rows <= 0 || grid.heightsM.length === 0) {
    return 0;
  }
  if (grid.cols === 1 && grid.rows === 1) {
    return grid.heightsM[0]!;
  }
  const maxColIdx = Math.max(0, grid.cols - 1.000001);
  const maxRowIdx = Math.max(0, grid.rows - 1.000001);
  const fx = Math.max(0, Math.min(maxColIdx, (wx - grid.minX) / grid.step));
  const fz = Math.max(0, Math.min(maxRowIdx, (wz - grid.minZ) / grid.step));
  const x0 = fx | 0;
  const z0 = fz | 0;
  const tx = fx - x0;
  const tz = fz - z0;
  const row0 = z0 * grid.cols;
  const row1 = Math.min(grid.rows - 1, z0 + 1) * grid.cols;
  const x1 = Math.min(grid.cols - 1, x0 + 1);
  const h00 = grid.heightsM[row0 + x0]!;
  const h10 = grid.heightsM[row0 + x1]!;
  const h01 = grid.heightsM[row1 + x0]!;
  const h11 = grid.heightsM[row1 + x1]!;
  const a = h00 + (h10 - h00) * tx;
  const b = h01 + (h11 - h01) * tx;
  return a + (b - a) * tz;
}

function gridInnerMargin(grid: DecodedTerrainGrid, wx: number, wz: number): number {
  return Math.min(wx - grid.minX, grid.maxX - wx, wz - grid.minZ, grid.maxZ - wz);
}

function sampleDecodedLayersFromIndex(
  grids: readonly DecodedTerrainGrid[],
  startIndex: number,
  wx: number,
  wz: number
): number {
  const lastIdx = grids.length - 1;
  for (let i = startIndex; i <= lastIdx; i++) {
    const grid = grids[i]!;
    if (i === lastIdx) {
      return sampleDecodedTerrainGrid(grid, wx, wz);
    }
    const margin = gridInnerMargin(grid, wx, wz);
    if (margin >= grid.blendMarginM) {
      return sampleDecodedTerrainGrid(grid, wx, wz);
    }
    if (margin > 0) {
      const w = smoothstep(0, grid.blendMarginM, margin);
      const innerY = sampleDecodedTerrainGrid(grid, wx, wz);
      const outerY = sampleDecodedLayersFromIndex(grids, i + 1, wx, wz);
      return outerY * (1 - w) + innerY * w;
    }
  }
  return sampleDecodedTerrainGrid(grids[lastIdx]!, wx, wz);
}

/**
 * Samples one or more concentric heightgrid layers (`finest first`) at world `(wx, wz)`
 * using bilinear interpolation and C1 `smoothstep` margin blending.
 */
export function sampleHusGridLayers(
  grids: readonly (HusGridLayerSpec | DecodedTerrainGrid)[],
  wx: number,
  wz: number,
  fallbackElevationY = 0
): number {
  if (grids.length === 0) {
    return fallbackElevationY;
  }
  const decoded: DecodedTerrainGrid[] = new Array(grids.length);
  for (let i = 0; i < grids.length; i++) {
    const g = grids[i]!;
    decoded[i] = isDecodedTerrainGrid(g) ? g : decodeHusGridLayer(g);
  }
  return sampleDecodedLayersFromIndex(decoded, 0, wx, wz);
}

export type TerrainBlendMode = 'blend' | 'min' | 'max';

export type TerrainFeatherSide = 'outside' | 'inside' | 'centered';

function applyBlendMode(
  currentY: number,
  targetY: number,
  weight: number,
  mode: TerrainBlendMode
): number {
  if (weight <= 0) return currentY;
  let effectiveTarget = targetY;
  if (mode === 'min') {
    effectiveTarget = Math.min(currentY, targetY);
  } else if (mode === 'max') {
    effectiveTarget = Math.max(currentY, targetY);
  }
  if (weight >= 1) return effectiveTarget;
  return currentY * (1 - weight) + effectiveTarget * weight;
}

export interface GradePadOptions {
  readonly id?: string;
  /** Target elevation at the pad reference point (metres). */
  readonly elevationY: number;
  /** Optional pad center / local frame origin X (metres). */
  readonly centerX?: number;
  /** Optional pad center / local frame origin Z (metres). */
  readonly centerZ?: number;
  /** Alias for `centerX` (or local `Frame2D` origin X when paired with `minX..maxX`). */
  readonly originX?: number;
  /** Alias for `centerZ` (or local `Frame2D` origin Z when paired with `minZ..maxZ`). */
  readonly originZ?: number;
  /** Pad X extent in metres (alternative to `minX..maxX`). */
  readonly width?: number;
  /** Pad Z extent in metres (alternative to `minZ..maxZ`). */
  readonly depth?: number;
  /** Local or world minimum X bound (alternative to `width`). */
  readonly minX?: number;
  /** Local or world maximum X bound (alternative to `width`). */
  readonly maxX?: number;
  /** Local or world minimum Z bound (alternative to `depth`). */
  readonly minZ?: number;
  /** Local or world maximum Z bound (alternative to `depth`). */
  readonly maxZ?: number;
  /** Optional Y-axis rotation in radians (`Frame2D` / Three.js `Object3D` convention). */
  readonly rotationY?: number;
  /** Optional linear grade along local `+X` (`dy / dx`). */
  readonly slopeX?: number;
  /** Optional linear grade along local `+Z` (`dy / dz`). */
  readonly slopeZ?: number;
  /** Width of C1 smoothstep feather band in metres (default `1.5`). */
  readonly featherM?: number;
  /**
   * Where the feather transition occurs relative to the pad perimeter:
   * - `'outside'` (default): full grade across pad footprint, feathers outward `[0..featherM]`.
   * - `'inside'`: `0` effect outside pad perimeter, feathers inward `[-featherM..0]` (ideal for interior sub-slab carves).
   * - `'centered'`: feathers symmetrically across `[-featherM/2..+featherM/2]`.
   */
  readonly featherSide?: TerrainFeatherSide;
  /** Optional inward perimeter inset in metres (e.g. `0.02` for interior wall sub-slab carves). */
  readonly insetM?: number;
  /** Blend rule (`'blend'` default, `'min'` cut-only, `'max'` fill-only). */
  readonly mode?: TerrainBlendMode;
}

export interface GradePadModifier {
  readonly kind: 'gradePad';
  readonly id?: string;
  readonly frameOriginX: number;
  readonly frameOriginZ: number;
  readonly rotationY: number;
  readonly cos: number;
  readonly sin: number;
  readonly boxMinX: number;
  readonly boxMaxX: number;
  readonly boxMinZ: number;
  readonly boxMaxZ: number;
  readonly refX: number;
  readonly refZ: number;
  readonly elevationY: number;
  readonly slopeX: number;
  readonly slopeZ: number;
  readonly featherM: number;
  readonly featherSide: TerrainFeatherSide;
  readonly insetM: number;
  readonly mode: TerrainBlendMode;
  readonly aabbMinX: number;
  readonly aabbMaxX: number;
  readonly aabbMinZ: number;
  readonly aabbMaxZ: number;
}

export function gradePad(opts: GradePadOptions): GradePadModifier {
  const rotationY = opts.rotationY ?? 0;
  const cos = Math.cos(rotationY);
  const sin = Math.sin(rotationY);

  let frameOriginX: number;
  let frameOriginZ: number;
  let boxMinX: number;
  let boxMaxX: number;
  let boxMinZ: number;
  let boxMaxZ: number;

  const hasExplicitBounds =
    opts.minX !== undefined &&
    opts.maxX !== undefined &&
    opts.minZ !== undefined &&
    opts.maxZ !== undefined;

  if (hasExplicitBounds) {
    const bMinX = Math.min(opts.minX!, opts.maxX!);
    const bMaxX = Math.max(opts.minX!, opts.maxX!);
    const bMinZ = Math.min(opts.minZ!, opts.maxZ!);
    const bMaxZ = Math.max(opts.minZ!, opts.maxZ!);
    const hasExplicitFrameOrigin =
      opts.originX !== undefined ||
      opts.originZ !== undefined ||
      opts.centerX !== undefined ||
      opts.centerZ !== undefined;
    if (hasExplicitFrameOrigin) {
      frameOriginX = opts.originX ?? opts.centerX ?? 0;
      frameOriginZ = opts.originZ ?? opts.centerZ ?? 0;
      boxMinX = bMinX;
      boxMaxX = bMaxX;
      boxMinZ = bMinZ;
      boxMaxZ = bMaxZ;
    } else {
      frameOriginX = 0.5 * (bMinX + bMaxX);
      frameOriginZ = 0.5 * (bMinZ + bMaxZ);
      const halfW = 0.5 * (bMaxX - bMinX);
      const halfD = 0.5 * (bMaxZ - bMinZ);
      boxMinX = -halfW;
      boxMaxX = halfW;
      boxMinZ = -halfD;
      boxMaxZ = halfD;
    }
  } else {
    const halfW = 0.5 * Math.max(0, opts.width ?? 0);
    const halfD = 0.5 * Math.max(0, opts.depth ?? 0);
    frameOriginX = opts.centerX ?? opts.originX ?? 0;
    frameOriginZ = opts.centerZ ?? opts.originZ ?? 0;
    boxMinX = -halfW;
    boxMaxX = halfW;
    boxMinZ = -halfD;
    boxMaxZ = halfD;
  }

  const refX = 0.5 * (boxMinX + boxMaxX);
  const refZ = 0.5 * (boxMinZ + boxMaxZ);
  const featherM = Math.max(0, opts.featherM ?? 1.5);
  const featherSide = opts.featherSide ?? 'outside';
  const insetM = opts.insetM ?? 0;
  const outerPad =
    featherSide === 'inside'
      ? Math.max(0, -insetM)
      : featherSide === 'centered'
        ? 0.5 * featherM + Math.max(0, -insetM)
        : featherM + Math.max(0, -insetM);

  const corners: [number, number][] = [
    [boxMinX - outerPad, boxMinZ - outerPad],
    [boxMaxX + outerPad, boxMinZ - outerPad],
    [boxMaxX + outerPad, boxMaxZ + outerPad],
    [boxMinX - outerPad, boxMaxZ + outerPad],
  ];
  let aabbMinX = Infinity;
  let aabbMaxX = -Infinity;
  let aabbMinZ = Infinity;
  let aabbMaxZ = -Infinity;
  for (const [lx, lz] of corners) {
    const wx = lx * cos + lz * sin + frameOriginX;
    const wz = -lx * sin + lz * cos + frameOriginZ;
    if (wx < aabbMinX) aabbMinX = wx;
    if (wx > aabbMaxX) aabbMaxX = wx;
    if (wz < aabbMinZ) aabbMinZ = wz;
    if (wz > aabbMaxZ) aabbMaxZ = wz;
  }

  return {
    kind: 'gradePad',
    id: opts.id,
    frameOriginX,
    frameOriginZ,
    rotationY,
    cos,
    sin,
    boxMinX,
    boxMaxX,
    boxMinZ,
    boxMaxZ,
    refX,
    refZ,
    elevationY: opts.elevationY,
    slopeX: opts.slopeX ?? 0,
    slopeZ: opts.slopeZ ?? 0,
    featherM,
    featherSide,
    insetM,
    mode: opts.mode ?? 'blend',
    aabbMinX,
    aabbMaxX,
    aabbMinZ,
    aabbMaxZ,
  };
}

function evalGradePad(mod: GradePadModifier, wx: number, wz: number, currentY: number): number {
  if (
    wx < mod.aabbMinX ||
    wx > mod.aabbMaxX ||
    wz < mod.aabbMinZ ||
    wz > mod.aabbMaxZ
  ) {
    return currentY;
  }
  const dx = wx - mod.frameOriginX;
  const dz = wz - mod.frameOriginZ;
  const lx = dx * mod.cos - dz * mod.sin;
  const lz = dx * mod.sin + dz * mod.cos;

  const dist =
    signedBoxDist2D(lx, lz, mod.boxMinX, mod.boxMaxX, mod.boxMinZ, mod.boxMaxZ) + mod.insetM;

  let w: number;
  if (mod.featherSide === 'inside') {
    if (dist >= 0) return currentY;
    w = mod.featherM > 0 ? 1 - smoothstep(-mod.featherM, 0, dist) : 1;
  } else if (mod.featherSide === 'centered') {
    const halfF = 0.5 * mod.featherM;
    if (dist >= halfF) return currentY;
    w = mod.featherM > 0 ? 1 - smoothstep(-halfF, halfF, dist) : dist <= 0 ? 1 : 0;
  } else {
    if (dist > mod.featherM) return currentY;
    w = dist <= 0 ? 1 : mod.featherM > 0 ? 1 - smoothstep(0, mod.featherM, dist) : 0;
  }

  if (w <= 0) return currentY;
  const targetY =
    mod.elevationY + mod.slopeX * (lx - mod.refX) + mod.slopeZ * (lz - mod.refZ);
  return applyBlendMode(currentY, targetY, w, mod.mode);
}

export type SplineControlPoint = readonly [number, number, number?];

export interface SplinePathOptions {
  readonly id?: string;
  /** Control points `[x, z, y?]`. When `y` is omitted, uses longitudinally smoothed terrain height. */
  readonly points: readonly SplineControlPoint[];
  /** Half-width of the graded path bed in metres. */
  readonly halfWidthM: number;
  /** C1 feather width outside `halfWidthM` in metres (default `1.5`). */
  readonly featherM?: number;
  /** Optional centreline camber/crown height in metres (parabolically drops to `0` at `halfWidthM`). */
  readonly crownM?: number;
  /** Optional vertical offset added to target path elevation in metres (default `0`). */
  readonly heightOffsetM?: number;
  /** Curve interpolation mode (`'catmullRom'` default for `>= 3` points, `'polyline'` for straight segments). */
  readonly curve?: 'catmullRom' | 'polyline';
  /** Discretization subdivisions per control segment (default `16`). */
  readonly subdivisionsPerSegment?: number;
  /** Longitudinal Gaussian smoothing sigma (metres) when following terrain elevation. */
  readonly smoothingWindowM?: number;
  /** Blend rule (`'blend'` default, `'min'` cut-only, `'max'` fill-only). */
  readonly mode?: TerrainBlendMode;
}

export interface SplineSampleVertex {
  readonly x: number;
  readonly z: number;
  readonly arcLengthM: number;
  readonly explicitY: number | null;
}

export interface SplinePathModifier {
  readonly kind: 'splinePath';
  readonly id?: string;
  readonly points: readonly SplineControlPoint[];
  readonly samples: readonly SplineSampleVertex[];
  readonly hasAllExplicitY: boolean;
  readonly halfWidthM: number;
  readonly featherM: number;
  readonly crownM: number;
  readonly heightOffsetM: number;
  readonly smoothingWindowM: number;
  readonly mode: TerrainBlendMode;
  readonly aabbMinX: number;
  readonly aabbMaxX: number;
  readonly aabbMinZ: number;
  readonly aabbMaxZ: number;
}

function centripetalCatmullRom1D(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t0: number,
  t1: number,
  t2: number,
  t3: number,
  t: number
): number {
  const dt10 = Math.max(1e-6, t1 - t0);
  const dt21 = Math.max(1e-6, t2 - t1);
  const dt32 = Math.max(1e-6, t3 - t2);
  const dt20 = Math.max(1e-6, t2 - t0);
  const dt31 = Math.max(1e-6, t3 - t1);

  const a1 = ((t1 - t) / dt10) * p0 + ((t - t0) / dt10) * p1;
  const a2 = ((t2 - t) / dt21) * p1 + ((t - t1) / dt21) * p2;
  const a3 = ((t3 - t) / dt32) * p2 + ((t - t2) / dt32) * p3;

  const b1 = ((t2 - t) / dt20) * a1 + ((t - t0) / dt20) * a2;
  const b2 = ((t3 - t) / dt31) * a2 + ((t - t1) / dt31) * a3;

  return ((t2 - t) / dt21) * b1 + ((t - t1) / dt21) * b2;
}

function buildSplineSamples(
  points: readonly SplineControlPoint[],
  curveMode: 'catmullRom' | 'polyline',
  subdivisionsPerSegment: number
): { samples: SplineSampleVertex[]; hasAllExplicitY: boolean } {
  if (points.length === 0) {
    return { samples: [], hasAllExplicitY: true };
  }
  if (points.length === 1) {
    const p = points[0]!;
    return {
      samples: [{ x: p[0], z: p[1], arcLengthM: 0, explicitY: p[2] ?? null }],
      hasAllExplicitY: p[2] !== undefined,
    };
  }

  const n = points.length;
  const rawPts: { x: number; z: number; controlIdxFloat: number }[] = [];
  const subs = Math.max(1, subdivisionsPerSegment | 0);
  const useCatmull = curveMode === 'catmullRom' && n >= 3;

  if (!useCatmull) {
    for (let i = 0; i < n - 1; i++) {
      const p1 = points[i]!;
      const p2 = points[i + 1]!;
      for (let s = 0; s < subs; s++) {
        const u = s / subs;
        rawPts.push({
          x: p1[0] + (p2[0] - p1[0]) * u,
          z: p1[1] + (p2[1] - p1[1]) * u,
          controlIdxFloat: i + u,
        });
      }
    }
    const last = points[n - 1]!;
    rawPts.push({ x: last[0], z: last[1], controlIdxFloat: n - 1 });
  } else {
    for (let i = 0; i < n - 1; i++) {
      const p1 = points[i]!;
      const p2 = points[i + 1]!;
      const p0 = i > 0 ? points[i - 1]! : [2 * p1[0] - p2[0], 2 * p1[1] - p2[1]];
      const p3 = i + 2 < n ? points[i + 2]! : [2 * p2[0] - p1[0], 2 * p2[1] - p1[1]];

      const d01 = Math.sqrt(Math.max(1e-6, Math.hypot(p1[0] - p0[0], p1[1] - p0[1])));
      const d12 = Math.sqrt(Math.max(1e-6, Math.hypot(p2[0] - p1[0], p2[1] - p1[1])));
      const d23 = Math.sqrt(Math.max(1e-6, Math.hypot(p3[0] - p2[0], p3[1] - p2[1])));
      const t0 = 0;
      const t1 = t0 + d01;
      const t2 = t1 + d12;
      const t3 = t2 + d23;

      for (let s = 0; s < subs; s++) {
        const u = s / subs;
        const t = t1 + (t2 - t1) * u;
        rawPts.push({
          x: centripetalCatmullRom1D(p0[0], p1[0], p2[0], p3[0], t0, t1, t2, t3, t),
          z: centripetalCatmullRom1D(p0[1], p1[1], p2[1], p3[1], t0, t1, t2, t3, t),
          controlIdxFloat: i + u,
        });
      }
    }
    const last = points[n - 1]!;
    rawPts.push({ x: last[0], z: last[1], controlIdxFloat: n - 1 });
  }

  // Compute cumulative arc length and control-point arc lengths
  const arcLengths = new Float64Array(rawPts.length);
  const controlArc = new Float64Array(n);
  let accArc = 0;
  for (let k = 0; k < rawPts.length; k++) {
    if (k > 0) {
      accArc += Math.hypot(rawPts[k]!.x - rawPts[k - 1]!.x, rawPts[k]!.z - rawPts[k - 1]!.z);
    }
    arcLengths[k] = accArc;
    const cf = rawPts[k]!.controlIdxFloat;
    if (Math.abs(cf - Math.round(cf)) < 1e-9) {
      controlArc[Math.round(cf)] = accArc;
    }
  }

  // Collect anchored (arc, y) control points
  const anchors: { arc: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const py = points[i]![2];
    if (py !== undefined) {
      anchors.push({ arc: controlArc[i]!, y: py });
    }
  }

  const allExplicit = anchors.length === n;
  const hasInterpolatedAnchors = anchors.length >= 2;

  const samples: SplineSampleVertex[] = new Array(rawPts.length);
  for (let k = 0; k < rawPts.length; k++) {
    const s = arcLengths[k]!;
    let explicitY: number | null = null;
    if (allExplicit || hasInterpolatedAnchors) {
      if (s <= anchors[0]!.arc) {
        explicitY = anchors[0]!.y;
      } else if (s >= anchors[anchors.length - 1]!.arc) {
        explicitY = anchors[anchors.length - 1]!.y;
      } else {
        let seg = 0;
        while (seg + 1 < anchors.length - 1 && anchors[seg + 1]!.arc < s) {
          seg++;
        }
        const a0 = anchors[seg]!;
        const a1 = anchors[seg + 1]!;
        const span = Math.max(1e-9, a1.arc - a0.arc);
        const u = (s - a0.arc) / span;
        // Smooth Hermite / linear grade along arc length
        if (anchors.length === 2 || !useCatmull) {
          explicitY = a0.y + (a1.y - a0.y) * u;
        } else {
          const prev = seg > 0 ? anchors[seg - 1]! : a0;
          const next = seg + 2 < anchors.length ? anchors[seg + 2]! : a1;
          const m0 =
            seg > 0
              ? ((a1.y - prev.y) / Math.max(1e-6, a1.arc - prev.arc)) * span
              : a1.y - a0.y;
          const m1 =
            seg + 2 < anchors.length
              ? ((next.y - a0.y) / Math.max(1e-6, next.arc - a0.arc)) * span
              : a1.y - a0.y;
          const u2 = u * u;
          const u3 = u2 * u;
          explicitY =
            (2 * u3 - 3 * u2 + 1) * a0.y +
            (u3 - 2 * u2 + u) * m0 +
            (-2 * u3 + 3 * u2) * a1.y +
            (u3 - u2) * m1;
        }
      }
    } else if (anchors.length === 1) {
      explicitY = anchors[0]!.y;
    }

    samples[k] = {
      x: rawPts[k]!.x,
      z: rawPts[k]!.z,
      arcLengthM: s,
      explicitY,
    };
  }

  return { samples, hasAllExplicitY: anchors.length > 0 };
}

export function splinePath(opts: SplinePathOptions): SplinePathModifier {
  const halfWidthM = Math.max(0, opts.halfWidthM);
  const featherM = Math.max(0, opts.featherM ?? 1.5);
  const subs = opts.subdivisionsPerSegment ?? 16;
  const curveMode = opts.curve ?? (opts.points.length >= 3 ? 'catmullRom' : 'polyline');
  const { samples, hasAllExplicitY } = buildSplineSamples(opts.points, curveMode, subs);

  const reach = halfWidthM + featherM;
  let aabbMinX = Infinity;
  let aabbMaxX = -Infinity;
  let aabbMinZ = Infinity;
  let aabbMaxZ = -Infinity;
  for (const s of samples) {
    if (s.x - reach < aabbMinX) aabbMinX = s.x - reach;
    if (s.x + reach > aabbMaxX) aabbMaxX = s.x + reach;
    if (s.z - reach < aabbMinZ) aabbMinZ = s.z - reach;
    if (s.z + reach > aabbMaxZ) aabbMaxZ = s.z + reach;
  }

  return {
    kind: 'splinePath',
    id: opts.id,
    points: opts.points,
    samples,
    hasAllExplicitY,
    halfWidthM,
    featherM,
    crownM: opts.crownM ?? 0,
    heightOffsetM: opts.heightOffsetM ?? 0,
    smoothingWindowM: Math.max(0.5, opts.smoothingWindowM ?? Math.max(4, halfWidthM * 3)),
    mode: opts.mode ?? 'blend',
    aabbMinX,
    aabbMaxX,
    aabbMinZ,
    aabbMaxZ,
  };
}

function buildSmoothedCenterlineProfile(
  mod: SplinePathModifier,
  sampleHeightAt: (wx: number, wz: number) => number
): Float64Array {
  const m = mod.samples.length;
  const rawY = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    const s = mod.samples[i]!;
    rawY[i] = s.explicitY !== null ? s.explicitY : sampleHeightAt(s.x, s.z);
  }
  if (mod.hasAllExplicitY || m <= 2) {
    return rawY;
  }
  const sigma = mod.smoothingWindowM;
  const invTwoSigma2 = 1 / (2 * sigma * sigma);
  const smoothed = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    const si = mod.samples[i]!.arcLengthM;
    let sumW = 0;
    let sumY = 0;
    for (let j = 0; j < m; j++) {
      const ds = mod.samples[j]!.arcLengthM - si;
      if (Math.abs(ds) > sigma * 3.5) continue;
      const w = Math.exp(-ds * ds * invTwoSigma2);
      sumW += w;
      sumY += w * rawY[j]!;
    }
    smoothed[i] = sumW > 0 ? sumY / sumW : rawY[i]!;
  }
  return smoothed;
}

function evalSplinePath(
  mod: SplinePathModifier,
  wx: number,
  wz: number,
  currentY: number,
  precomputedCenterlineY?: Float64Array
): number {
  const m = mod.samples.length;
  if (
    m < 2 ||
    wx < mod.aabbMinX ||
    wx > mod.aabbMaxX ||
    wz < mod.aabbMinZ ||
    wz > mod.aabbMaxZ
  ) {
    return currentY;
  }

  const maxReach = mod.halfWidthM + mod.featherM;
  let bestDist2 = maxReach * maxReach;
  let bestSeg = -1;
  let bestT = 0;

  for (let i = 0; i < m - 1; i++) {
    const a = mod.samples[i]!;
    const b = mod.samples[i + 1]!;
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz;
    const t =
      len2 > 1e-12
        ? Math.max(0, Math.min(1, ((wx - a.x) * abx + (wz - a.z) * abz) / len2))
        : 0;
    const dx = wx - (a.x + abx * t);
    const dz = wz - (a.z + abz * t);
    const d2 = dx * dx + dz * dz;
    if (d2 < bestDist2) {
      bestDist2 = d2;
      bestSeg = i;
      bestT = t;
    }
  }

  if (bestSeg < 0) return currentY;
  const dist = Math.sqrt(bestDist2);
  const w =
    dist <= mod.halfWidthM
      ? 1
      : mod.featherM > 0
        ? 1 - smoothstep(mod.halfWidthM, maxReach, dist)
        : 0;
  if (w <= 0) return currentY;

  let centerY: number;
  if (precomputedCenterlineY) {
    const y0 = precomputedCenterlineY[bestSeg]!;
    const y1 = precomputedCenterlineY[bestSeg + 1]!;
    centerY = y0 + (y1 - y0) * bestT;
  } else if (mod.hasAllExplicitY) {
    const y0 = mod.samples[bestSeg]!.explicitY ?? currentY;
    const y1 = mod.samples[bestSeg + 1]!.explicitY ?? currentY;
    centerY = y0 + (y1 - y0) * bestT;
  } else {
    centerY = currentY;
  }

  let crown = 0;
  if (mod.crownM !== 0 && mod.halfWidthM > 1e-6 && dist < mod.halfWidthM) {
    const ratio = dist / mod.halfWidthM;
    crown = mod.crownM * (1 - ratio * ratio);
  }

  const targetY = centerY + mod.heightOffsetM + crown;
  return applyBlendMode(currentY, targetY, w, mod.mode);
}

export type BasinShape = 'ellipse' | 'box' | 'polygon';
export type BasinProfile = 'smooth' | 'flatBottom';

export interface CarveBasinOptions {
  readonly id?: string;
  readonly shape?: BasinShape;
  readonly centerX?: number;
  readonly centerZ?: number;
  readonly originX?: number;
  readonly originZ?: number;
  /** Ellipse X semi-axis in metres (or circle radius when `radiusZ` omitted). */
  readonly radiusX?: number;
  /** Ellipse Z semi-axis in metres (defaults to `radiusX`). */
  readonly radiusZ?: number;
  /** Alias for circular `radiusX` & `radiusZ`. */
  readonly radius?: number;
  /** Box width in metres (for `shape: 'box'`). */
  readonly width?: number;
  /** Box depth in metres (for `shape: 'box'`). */
  readonly depth?: number;
  readonly minX?: number;
  readonly maxX?: number;
  readonly minZ?: number;
  readonly maxZ?: number;
  /** Polygon perimeter vertices `[x, z][]` (for `shape: 'polygon'`). */
  readonly vertices?: readonly (readonly [number, number])[];
  /** Optional Y-axis rotation in radians. */
  readonly rotationY?: number;
  /** Absolute basin floor elevation in metres (mutually optional with `depthM`). */
  readonly bottomY?: number;
  /** Relative depression depth below local terrain in metres (used when `bottomY` is omitted). */
  readonly depthM?: number;
  /** Optional interior wall transition width in metres. */
  readonly wallSlopeM?: number;
  /** Exterior C1 rim blend width in metres (default `1.5`). */
  readonly featherM?: number;
  /** Cross-sectional profile (`'smooth'` bowl or `'flatBottom'`). */
  readonly profile?: BasinProfile;
  /** Blend rule (`'min'` default so basins only depress terrain, or `'blend'` / `'max'`). */
  readonly mode?: TerrainBlendMode;
}

export interface CarveBasinModifier {
  readonly kind: 'carveBasin';
  readonly id?: string;
  readonly shape: BasinShape;
  readonly frameOriginX: number;
  readonly frameOriginZ: number;
  readonly rotationY: number;
  readonly cos: number;
  readonly sin: number;
  readonly radiusX: number;
  readonly radiusZ: number;
  readonly boxMinX: number;
  readonly boxMaxX: number;
  readonly boxMinZ: number;
  readonly boxMaxZ: number;
  readonly vertices: readonly (readonly [number, number])[];
  readonly bottomY: number | undefined;
  readonly depthM: number;
  readonly wallSlopeM: number;
  readonly featherM: number;
  readonly profile: BasinProfile;
  readonly mode: TerrainBlendMode;
  readonly aabbMinX: number;
  readonly aabbMaxX: number;
  readonly aabbMinZ: number;
  readonly aabbMaxZ: number;
}

export function carveBasin(opts: CarveBasinOptions): CarveBasinModifier {
  const shape: BasinShape =
    opts.shape ??
    (opts.vertices && opts.vertices.length >= 3
      ? 'polygon'
      : opts.width !== undefined || opts.depth !== undefined || opts.minX !== undefined
        ? 'box'
        : 'ellipse');

  const rotationY = opts.rotationY ?? 0;
  const cos = Math.cos(rotationY);
  const sin = Math.sin(rotationY);
  const featherM = Math.max(0, opts.featherM ?? 1.5);
  const wallSlopeM = Math.max(0, opts.wallSlopeM ?? 0);
  const profile: BasinProfile =
    opts.profile ?? (shape === 'ellipse' && opts.wallSlopeM === undefined ? 'smooth' : 'flatBottom');

  let frameOriginX = opts.centerX ?? opts.originX ?? 0;
  let frameOriginZ = opts.centerZ ?? opts.originZ ?? 0;
  const radiusX = Math.max(1e-3, opts.radiusX ?? opts.radius ?? 4);
  const radiusZ = Math.max(1e-3, opts.radiusZ ?? opts.radiusX ?? opts.radius ?? 4);
  let boxMinX = -0.5 * (opts.width ?? 2 * radiusX);
  let boxMaxX = 0.5 * (opts.width ?? 2 * radiusX);
  let boxMinZ = -0.5 * (opts.depth ?? 2 * radiusZ);
  let boxMaxZ = 0.5 * (opts.depth ?? 2 * radiusZ);

  if (
    shape === 'box' &&
    opts.minX !== undefined &&
    opts.maxX !== undefined &&
    opts.minZ !== undefined &&
    opts.maxZ !== undefined
  ) {
    const bMinX = Math.min(opts.minX, opts.maxX);
    const bMaxX = Math.max(opts.minX, opts.maxX);
    const bMinZ = Math.min(opts.minZ, opts.maxZ);
    const bMaxZ = Math.max(opts.minZ, opts.maxZ);
    if (
      opts.originX !== undefined ||
      opts.originZ !== undefined ||
      opts.centerX !== undefined ||
      opts.centerZ !== undefined
    ) {
      boxMinX = bMinX;
      boxMaxX = bMaxX;
      boxMinZ = bMinZ;
      boxMaxZ = bMaxZ;
    } else {
      frameOriginX = 0.5 * (bMinX + bMaxX);
      frameOriginZ = 0.5 * (bMinZ + bMaxZ);
      const hw = 0.5 * (bMaxX - bMinX);
      const hd = 0.5 * (bMaxZ - bMinZ);
      boxMinX = -hw;
      boxMaxX = hw;
      boxMinZ = -hd;
      boxMaxZ = hd;
    }
  }

  const vertices = opts.vertices ?? [];
  let aabbMinX = Infinity;
  let aabbMaxX = -Infinity;
  let aabbMinZ = Infinity;
  let aabbMaxZ = -Infinity;

  if (shape === 'polygon' && vertices.length > 0) {
    for (const [vx, vz] of vertices) {
      if (vx - featherM < aabbMinX) aabbMinX = vx - featherM;
      if (vx + featherM > aabbMaxX) aabbMaxX = vx + featherM;
      if (vz - featherM < aabbMinZ) aabbMinZ = vz - featherM;
      if (vz + featherM > aabbMaxZ) aabbMaxZ = vz + featherM;
    }
  } else {
    const localMinX = shape === 'ellipse' ? -radiusX - featherM : boxMinX - featherM;
    const localMaxX = shape === 'ellipse' ? radiusX + featherM : boxMaxX + featherM;
    const localMinZ = shape === 'ellipse' ? -radiusZ - featherM : boxMinZ - featherM;
    const localMaxZ = shape === 'ellipse' ? radiusZ + featherM : boxMaxZ + featherM;
    const corners: [number, number][] = [
      [localMinX, localMinZ],
      [localMaxX, localMinZ],
      [localMaxX, localMaxZ],
      [localMinX, localMaxZ],
    ];
    for (const [lx, lz] of corners) {
      const wx = lx * cos + lz * sin + frameOriginX;
      const wz = -lx * sin + lz * cos + frameOriginZ;
      if (wx < aabbMinX) aabbMinX = wx;
      if (wx > aabbMaxX) aabbMaxX = wx;
      if (wz < aabbMinZ) aabbMinZ = wz;
      if (wz > aabbMaxZ) aabbMaxZ = wz;
    }
  }

  return {
    kind: 'carveBasin',
    id: opts.id,
    shape,
    frameOriginX,
    frameOriginZ,
    rotationY,
    cos,
    sin,
    radiusX,
    radiusZ,
    boxMinX,
    boxMaxX,
    boxMinZ,
    boxMaxZ,
    vertices,
    bottomY: opts.bottomY,
    depthM: opts.depthM ?? 1.0,
    wallSlopeM,
    featherM,
    profile,
    mode: opts.mode ?? 'min',
    aabbMinX,
    aabbMaxX,
    aabbMinZ,
    aabbMaxZ,
  };
}

function evalCarveBasin(mod: CarveBasinModifier, wx: number, wz: number, currentY: number): number {
  if (
    wx < mod.aabbMinX ||
    wx > mod.aabbMaxX ||
    wz < mod.aabbMinZ ||
    wz > mod.aabbMaxZ
  ) {
    return currentY;
  }

  let w = 0;
  if (mod.shape === 'ellipse') {
    const dx = wx - mod.frameOriginX;
    const dz = wz - mod.frameOriginZ;
    const lx = dx * mod.cos - dz * mod.sin;
    const lz = dx * mod.sin + dz * mod.cos;

    if (mod.profile === 'smooth') {
      const outerRx = mod.radiusX + mod.featherM;
      const outerRz = mod.radiusZ + mod.featherM;
      const rho = Math.hypot(lx / outerRx, lz / outerRz);
      if (rho >= 1) return currentY;
      w = 1 - smoothstep(0, 1, rho);
    } else {
      const dist = signedEllipseDist2D(lx, lz, mod.radiusX, mod.radiusZ);
      if (dist > mod.featherM) return currentY;
      const span = mod.wallSlopeM + mod.featherM;
      w = dist <= -mod.wallSlopeM ? 1 : span > 0 ? 1 - smoothstep(-mod.wallSlopeM, mod.featherM, dist) : 0;
    }
  } else if (mod.shape === 'box') {
    const dx = wx - mod.frameOriginX;
    const dz = wz - mod.frameOriginZ;
    const lx = dx * mod.cos - dz * mod.sin;
    const lz = dx * mod.sin + dz * mod.cos;
    const dist = signedBoxDist2D(lx, lz, mod.boxMinX, mod.boxMaxX, mod.boxMinZ, mod.boxMaxZ);
    if (dist > mod.featherM) return currentY;
    const innerSpan =
      mod.profile === 'smooth'
        ? mod.wallSlopeM > 0
          ? mod.wallSlopeM
          : 0.5 * Math.min(mod.boxMaxX - mod.boxMinX, mod.boxMaxZ - mod.boxMinZ)
        : mod.wallSlopeM;
    const totalSpan = innerSpan + mod.featherM;
    w =
      dist <= -innerSpan
        ? 1
        : totalSpan > 0
          ? 1 - smoothstep(-innerSpan, mod.featherM, dist)
          : 0;
  } else {
    const dist = signedPolygonDist2D(wx, wz, mod.vertices);
    if (dist > mod.featherM) return currentY;
    const innerSpan =
      mod.profile === 'smooth'
        ? mod.wallSlopeM > 0
          ? mod.wallSlopeM
          : Math.max(1, mod.featherM)
        : mod.wallSlopeM;
    const totalSpan = innerSpan + mod.featherM;
    w =
      dist <= -innerSpan
        ? 1
        : totalSpan > 0
          ? 1 - smoothstep(-innerSpan, mod.featherM, dist)
          : 0;
  }

  if (w <= 0) return currentY;
  const floorY = mod.bottomY !== undefined ? mod.bottomY : currentY - mod.depthM;
  return applyBlendMode(currentY, floorY, w, mod.mode);
}

export type TerrainStampFalloff = 'smooth' | 'gaussian' | 'plateau';

export interface TerrainStamp {
  readonly x: number;
  readonly z: number;
  readonly radiusX: number;
  readonly radiusZ?: number;
  readonly rotationY?: number;
  readonly deltaY: number;
  readonly falloff?: TerrainStampFalloff;
  readonly plateauRatio?: number;
}

export interface SculptStampsOptions {
  readonly id?: string;
  readonly stamps: readonly TerrainStamp[];
}

interface PreparedTerrainStamp {
  readonly x: number;
  readonly z: number;
  readonly invRx: number;
  readonly invRz: number;
  readonly cos: number;
  readonly sin: number;
  readonly deltaY: number;
  readonly falloff: TerrainStampFalloff;
  readonly plateauRatio: number;
  readonly aabbMinX: number;
  readonly aabbMaxX: number;
  readonly aabbMinZ: number;
  readonly aabbMaxZ: number;
}

export interface SculptStampsModifier {
  readonly kind: 'sculptStamps';
  readonly id?: string;
  readonly stamps: readonly TerrainStamp[];
  readonly prepared?: readonly PreparedTerrainStamp[];
  readonly aabbMinX?: number;
  readonly aabbMaxX?: number;
  readonly aabbMinZ?: number;
  readonly aabbMaxZ?: number;
}

export function sculptStamps(
  optsOrStamps: SculptStampsOptions | readonly TerrainStamp[]
): SculptStampsModifier {
  const stamps = Array.isArray(optsOrStamps)
    ? (optsOrStamps as readonly TerrainStamp[])
    : (optsOrStamps as SculptStampsOptions).stamps;
  const id = Array.isArray(optsOrStamps)
    ? undefined
    : (optsOrStamps as SculptStampsOptions).id;

  const prepared: PreparedTerrainStamp[] = [];
  let aabbMinX = Infinity;
  let aabbMaxX = -Infinity;
  let aabbMinZ = Infinity;
  let aabbMaxZ = -Infinity;

  for (const s of stamps) {
    const rx = Math.max(1e-6, s.radiusX);
    const rz = Math.max(1e-6, s.radiusZ ?? s.radiusX);
    const rot = s.rotationY ?? 0;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const extX = Math.hypot(rx * cos, rz * sin);
    const extZ = Math.hypot(rx * sin, rz * cos);
    const sMinX = s.x - extX;
    const sMaxX = s.x + extX;
    const sMinZ = s.z - extZ;
    const sMaxZ = s.z + extZ;
    if (sMinX < aabbMinX) aabbMinX = sMinX;
    if (sMaxX > aabbMaxX) aabbMaxX = sMaxX;
    if (sMinZ < aabbMinZ) aabbMinZ = sMinZ;
    if (sMaxZ > aabbMaxZ) aabbMaxZ = sMaxZ;

    prepared.push({
      x: s.x,
      z: s.z,
      invRx: 1 / rx,
      invRz: 1 / rz,
      cos,
      sin,
      deltaY: s.deltaY,
      falloff: s.falloff ?? 'smooth',
      plateauRatio: Math.max(0, Math.min(0.999, s.plateauRatio ?? 0.4)),
      aabbMinX: sMinX,
      aabbMaxX: sMaxX,
      aabbMinZ: sMinZ,
      aabbMaxZ: sMaxZ,
    });
  }

  return {
    kind: 'sculptStamps',
    id,
    stamps,
    prepared,
    aabbMinX,
    aabbMaxX,
    aabbMinZ,
    aabbMaxZ,
  };
}

function evalStampFalloff(r: number, falloff: TerrainStampFalloff, plateauRatio: number): number {
  if (r >= 1) return 0;
  if (r <= 0) return 1;
  if (falloff === 'gaussian') {
    const oneMinusR2 = 1 - r * r;
    return Math.exp(-3 * r * r) * oneMinusR2 * oneMinusR2;
  }
  if (falloff === 'plateau') {
    if (r <= plateauRatio) return 1;
    const t = (r - plateauRatio) / (1 - plateauRatio);
    return 0.5 * (1 + Math.cos(Math.PI * t));
  }
  return 0.5 * (1 + Math.cos(Math.PI * r));
}

function ensurePreparedSculptStamps(mod: SculptStampsModifier): SculptStampsModifier & {
  readonly prepared: readonly PreparedTerrainStamp[];
  readonly aabbMinX: number;
  readonly aabbMaxX: number;
  readonly aabbMinZ: number;
  readonly aabbMaxZ: number;
} {
  if (
    mod.prepared !== undefined &&
    mod.aabbMinX !== undefined &&
    mod.aabbMaxX !== undefined &&
    mod.aabbMinZ !== undefined &&
    mod.aabbMaxZ !== undefined
  ) {
    return mod as SculptStampsModifier & {
      readonly prepared: readonly PreparedTerrainStamp[];
      readonly aabbMinX: number;
      readonly aabbMaxX: number;
      readonly aabbMinZ: number;
      readonly aabbMaxZ: number;
    };
  }
  return sculptStamps({ id: mod.id, stamps: mod.stamps }) as SculptStampsModifier & {
    readonly prepared: readonly PreparedTerrainStamp[];
    readonly aabbMinX: number;
    readonly aabbMaxX: number;
    readonly aabbMinZ: number;
    readonly aabbMaxZ: number;
  };
}

function evalSculptStamps(
  rawMod: SculptStampsModifier,
  wx: number,
  wz: number,
  currentY: number
): number {
  const mod = ensurePreparedSculptStamps(rawMod);
  if (
    mod.prepared.length === 0 ||
    wx < mod.aabbMinX ||
    wx > mod.aabbMaxX ||
    wz < mod.aabbMinZ ||
    wz > mod.aabbMaxZ
  ) {
    return currentY;
  }

  let y = currentY;
  for (let i = 0; i < mod.prepared.length; i++) {
    const s = mod.prepared[i]!;
    if (wx < s.aabbMinX || wx > s.aabbMaxX || wz < s.aabbMinZ || wz > s.aabbMaxZ) {
      continue;
    }
    const dx = wx - s.x;
    const dz = wz - s.z;
    const lx = dx * s.cos - dz * s.sin;
    const lz = dx * s.sin + dz * s.cos;
    const r = Math.hypot(lx * s.invRx, lz * s.invRz);
    if (r >= 1) continue;
    y += s.deltaY * evalStampFalloff(r, s.falloff, s.plateauRatio);
  }
  return y;
}

export interface CustomTerrainModifier {
  readonly kind: 'custom';
  readonly id?: string;
  readonly evaluate: (wx: number, wz: number, currentY: number) => number;
}

export function customTerrainModifier(
  fn: (wx: number, wz: number, currentY: number) => number,
  id?: string
): CustomTerrainModifier {
  return {
    kind: 'custom',
    id,
    evaluate: fn,
  };
}

export type TerrainModifier =
  | GradePadModifier
  | SplinePathModifier
  | CarveBasinModifier
  | SculptStampsModifier
  | CustomTerrainModifier;

function evaluateSingleModifier(
  mod: TerrainModifier,
  wx: number,
  wz: number,
  currentY: number,
  splineProfile?: Float64Array
): number {
  switch (mod.kind) {
    case 'gradePad':
      return evalGradePad(mod, wx, wz, currentY);
    case 'splinePath':
      return evalSplinePath(mod, wx, wz, currentY, splineProfile);
    case 'carveBasin':
      return evalCarveBasin(mod, wx, wz, currentY);
    case 'sculptStamps':
      return evalSculptStamps(mod, wx, wz, currentY);
    case 'custom':
      return mod.evaluate(wx, wz, currentY);
  }
}

/**
 * Evaluates an ordered `TerrainModifier[]` stack over `baseY` at world `(wx, wz)`.
 */
export function evaluateTerrainModifiers(
  baseY: number,
  wx: number,
  wz: number,
  modifiers: readonly TerrainModifier[]
): number {
  let y = baseY;
  for (let i = 0; i < modifiers.length; i++) {
    y = evaluateSingleModifier(modifiers[i]!, wx, wz, y);
  }
  return y;
}

export type TerrainBaseSource =
  | 'flat'
  | HusGridDocument
  | readonly HusGridLayerSpec[]
  | ((wx: number, wz: number) => number);

export type TerrainBiomePreset = 'lush-meadow' | 'arid-chaparral' | 'rocky-bluff';

export interface TerrainBiomeConfig {
  readonly preset?: TerrainBiomePreset;
  /** Maximum slope angle (degrees) for flat / gentle decomposed-granite soil (default `16`). */
  readonly gentleSlopeMaxDeg?: number;
  /** Minimum slope angle (degrees) for exposed triplanar rocky cliff escarpments (default `36`). */
  readonly cliffSlopeMinDeg?: number;
  /** Sun-baked decomposed-granite / sandy-loam primary hex (default `0xbda98a`). */
  readonly flatSoilPrimaryHex?: number;
  /** Dusty decomposed-granite secondary loam hex (default `0x9d8768`). */
  readonly flatSoilSecondaryHex?: number;
  /** Dry patchy chaparral scrub mottling hex on gentle ground (default `0x867c4c`). */
  readonly flatScrubHex?: number;
  /** Mid-slope eroded canyon talus earth hex (default `0x9e814d`). */
  readonly midSlopeTalusHex?: number;
  /** Mid-slope warm golden-ochre dry grass/earth hex (default `0x7f663f`). */
  readonly midSlopeOchreHex?: number;
  /** Steep cliff exposed decomposed-granite / iron-stained sandstone hex (default `0xa47d55`). */
  readonly cliffRockPrimaryHex?: number;
  /** Steep cliff weathered rust-ochre sandstone hex (default `0x836243`). */
  readonly cliffRockSecondaryHex?: number;
  /** Steep cliff sunlit quartz/granite highlight hex (default `0xbe976c`). */
  readonly cliffRockHighlightHex?: number;
  /** Deep rock fissure & crevice ambient-occlusion hex (default `0x4b392a`). */
  readonly cliffCreviceHex?: number;
  /** World-space metres per triplanar rock stratum tile (default `6.5`). */
  readonly triplanarScaleM?: number;
  /** Perturbation strength for stratified rock normal detail on steep faces (default `0.42`). */
  readonly normalPerturbStrength?: number;
}

export type TerrainBiomeInput = TerrainBiomePreset | TerrainBiomeConfig;

export interface ResolvedTerrainBiomeConfig {
  readonly preset: TerrainBiomePreset;
  readonly gentleSlopeMaxDeg: number;
  readonly cliffSlopeMinDeg: number;
  readonly flatSoilPrimaryHex: number;
  readonly flatSoilSecondaryHex: number;
  readonly flatScrubHex: number;
  readonly midSlopeTalusHex: number;
  readonly midSlopeOchreHex: number;
  readonly cliffRockPrimaryHex: number;
  readonly cliffRockSecondaryHex: number;
  readonly cliffRockHighlightHex: number;
  readonly cliffCreviceHex: number;
  readonly triplanarScaleM: number;
  readonly normalPerturbStrength: number;
}

export function resolveTerrainBiomeConfig(
  biome?: TerrainBiomeInput
): ResolvedTerrainBiomeConfig {
  const preset: TerrainBiomePreset =
    typeof biome === 'string' ? biome : (biome?.preset ?? 'lush-meadow');
  const opts: TerrainBiomeConfig = typeof biome === 'object' && biome !== null ? biome : {};
  const isRockyBluff = preset === 'rocky-bluff';
  return {
    preset,
    gentleSlopeMaxDeg: opts.gentleSlopeMaxDeg ?? (isRockyBluff ? 14 : 16),
    cliffSlopeMinDeg: opts.cliffSlopeMinDeg ?? (isRockyBluff ? 32 : 36),
    flatSoilPrimaryHex: opts.flatSoilPrimaryHex ?? 0xbda98a,
    flatSoilSecondaryHex: opts.flatSoilSecondaryHex ?? 0x9b8668,
    flatScrubHex: opts.flatScrubHex ?? (isRockyBluff ? 0x8d8050 : 0x7e7a49),
    midSlopeTalusHex: opts.midSlopeTalusHex ?? 0x9e814d,
    midSlopeOchreHex: opts.midSlopeOchreHex ?? 0x7c643e,
    cliffRockPrimaryHex: opts.cliffRockPrimaryHex ?? 0xb2895e,
    cliffRockSecondaryHex: opts.cliffRockSecondaryHex ?? 0x805f40,
    cliffRockHighlightHex: opts.cliffRockHighlightHex ?? 0xc29b6f,
    cliffCreviceHex: opts.cliffCreviceHex ?? 0x5c4430,
    triplanarScaleM: Math.max(0.5, opts.triplanarScaleM ?? 6.5),
    normalPerturbStrength: Math.max(0, opts.normalPerturbStrength ?? (isRockyBluff ? 0.48 : 0.38)),
  };
}

export interface TerrainConfig {
  /** Base DEM source (`'flat'`, `.husgrid.json` document, grid layer array, or height function). */
  readonly base?: TerrainBaseSource;
  /** Fallback / flat base elevation in metres (default `0`). */
  readonly flatElevationY?: number;
  /** Optional slope-driven surface biome preset or custom configuration (default `'lush-meadow'`). */
  readonly biome?: TerrainBiomeInput;
  /** Non-destructive landscape modifiers applied to `sampleTerrainY`. */
  readonly modifiers?: readonly TerrainModifier[];
  /** Additional mesh-only carve modifiers applied on top of `sampleTerrainY` for `sampleCarvedMeshY`. */
  readonly meshCarveModifiers?: readonly TerrainModifier[];
}

export interface TerrainSurfaceSampler {
  readonly biome?: TerrainBiomeInput;
  sampleTerrainY(wx: number, wz: number): number;
  sampleCarvedMeshY(wx: number, wz: number): number;
  sampleNormal(
    wx: number,
    wz: number,
    eps?: number
  ): { nx: number; ny: number; nz: number };
  evaluateTerrainModifiers(
    baseY: number,
    wx: number,
    wz: number,
    modifiers: readonly TerrainModifier[]
  ): number;
}

function isHusGridDocument(base: TerrainBaseSource): base is HusGridDocument {
  return (
    typeof base === 'object' &&
    base !== null &&
    !Array.isArray(base) &&
    'format' in base &&
    base.format === 'husgrid-v1'
  );
}

function buildBaseSampler(
  base: TerrainBaseSource | undefined,
  flatElevationY: number
): (wx: number, wz: number) => number {
  if (!base || base === 'flat') {
    return () => flatElevationY;
  }
  if (typeof base === 'function') {
    return base;
  }
  const layerSpecs = isHusGridDocument(base) ? base.grids : base;
  if (layerSpecs.length === 0) {
    return () => flatElevationY;
  }
  const decodedLayers = layerSpecs.map((spec) => decodeHusGridLayer(spec));
  return (wx: number, wz: number) => sampleDecodedLayersFromIndex(decodedLayers, 0, wx, wz);
}

function compileModifierPipeline(
  inputSampler: (wx: number, wz: number) => number,
  rawModifiers: readonly TerrainModifier[]
): (wx: number, wz: number) => number {
  if (rawModifiers.length === 0) {
    return inputSampler;
  }
  const modifiers: readonly TerrainModifier[] = rawModifiers.map((m) =>
    m.kind === 'sculptStamps' && m.prepared === undefined ? ensurePreparedSculptStamps(m) : m
  );

  // Precompute longitudinally smoothed terrain profiles for any `splinePath` modifiers
  // that omit explicit control-point `y` elevations.
  const splineProfiles: (Float64Array | undefined)[] = new Array(modifiers.length);
  for (let i = 0; i < modifiers.length; i++) {
    const mod = modifiers[i]!;
    if (mod.kind === 'splinePath' && !mod.hasAllExplicitY) {
      const stageIdx = i;
      const sampleUpToStage = (x: number, z: number): number => {
        let y = inputSampler(x, z);
        for (let j = 0; j < stageIdx; j++) {
          y = evaluateSingleModifier(modifiers[j]!, x, z, y, splineProfiles[j]);
        }
        return y;
      };
      splineProfiles[i] = buildSmoothedCenterlineProfile(mod, sampleUpToStage);
    }
  }

  return (wx: number, wz: number): number => {
    let y = inputSampler(wx, wz);
    for (let i = 0; i < modifiers.length; i++) {
      y = evaluateSingleModifier(modifiers[i]!, wx, wz, y, splineProfiles[i]);
    }
    return y;
  };
}

export function createTerrainSampler(config: TerrainConfig = {}): TerrainSurfaceSampler {
  const flatElevationY = config.flatElevationY ?? 0;
  const baseSampler = buildBaseSampler(config.base, flatElevationY);
  const sampleTerrainY = compileModifierPipeline(baseSampler, config.modifiers ?? []);
  const sampleCarvedMeshY = compileModifierPipeline(
    sampleTerrainY,
    config.meshCarveModifiers ?? []
  );

  const sampleNormal = (
    wx: number,
    wz: number,
    eps = 0.5
  ): { nx: number; ny: number; nz: number } => {
    const safeEps = Math.max(1e-4, eps);
    const dydx = (sampleTerrainY(wx + safeEps, wz) - sampleTerrainY(wx - safeEps, wz)) / (2 * safeEps);
    const dydz = (sampleTerrainY(wx, wz + safeEps) - sampleTerrainY(wx, wz - safeEps)) / (2 * safeEps);
    const invLen = 1 / Math.hypot(dydx, 1, dydz);
    return {
      nx: -dydx * invLen,
      ny: invLen,
      nz: -dydz * invLen,
    };
  };

  return {
    ...(config.biome !== undefined ? { biome: config.biome } : {}),
    sampleTerrainY,
    sampleCarvedMeshY,
    sampleNormal,
    evaluateTerrainModifiers,
  };
}
