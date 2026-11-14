import * as THREE from 'three';

export type TimberGrainAxis = 'x' | 'y' | 'z' | 'longest';

export type TimberSeedInput =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly TimberSeedInput[];

export interface TimberSliceTransform {
  readonly uOffset: number;
  readonly vOffset: number;
  readonly uSign: 1 | -1;
  readonly vSign: 1 | -1;
}

export interface TimberPieceUvOptions {
  /**
   * Local geometry axis along which the timber grain fibers must run.
   * Defaults to `'longest'` (the dominant bounding-box dimension of `geometry`).
   */
  readonly grainAxis?: TimberGrainAxis;
  /**
   * UV repeats per physical metre along the grain axis (`1 / slabSpanAlongM`).
   * Defaults to `1 / 2.2` (`~0.454545`, matching a `2.2 m` physical oak slab).
   */
  readonly scalePerMetre?: number;
  /**
   * UV repeats per physical metre across the grain (`1 / slabSpanAcrossM`).
   * Defaults to `scalePerMetre` (`1 / 2.2`, preserving physical aspect ratio on `2.2 m × 2.2 m` slabs).
   */
  readonly crossScalePerMetre?: number;
  /**
   * Deterministic seed (e.g. `[doorWorldX, doorWorldY, doorWorldZ, memberIndex]` or mesh name)
   * producing a unique `(uOffset, vOffset, uSign, vSign)` slice of the timber slab per piece.
   */
  readonly seed?: TimberSeedInput;
  /**
   * Optional target material used to auto-detect whether its `map` fibers run along `'u'`
   * (`rotation ≈ 0`) or `'v'` (`rotation ≈ ±π/2`, e.g. `grainAxis: 'v'` door materials).
   */
  readonly material?: THREE.Material | null;
  /**
   * Explicit texture fiber axis override (`'u'` or `'v'`). Overrides `material` auto-detection when provided.
   */
  readonly materialGrainAxis?: 'u' | 'v';
  /**
   * When `false`, keeps `uSign = 1, vSign = 1` (offset-only decorrelation). Defaults to `true`.
   */
  readonly allowFlip?: boolean;
}

function mixUint32(h: number, k: number): number {
  let x = (k >>> 0) * 0xcc9e2d51;
  x = Math.imul(x >>> 0, 1) >>> 0;
  let k1 = Math.imul(k >>> 0, 0xcc9e2d51) >>> 0;
  k1 = ((k1 << 15) | (k1 >>> 17)) >>> 0;
  k1 = Math.imul(k1, 0x1b873593) >>> 0;

  let h1 = (h ^ k1) >>> 0;
  h1 = ((h1 << 13) | (h1 >>> 19)) >>> 0;
  h1 = (Math.imul(h1, 5) + 0xe6546b64) >>> 0;
  void x;
  return h1;
}

function finalizeUint32(h: number): number {
  let x = h >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

function feedSeedValue(h: number, value: TimberSeedInput): number {
  if (value === null || value === undefined) {
    return mixUint32(h, 0x9e3779b9);
  }
  if (typeof value === 'boolean') {
    return mixUint32(h, value ? 0x517cc1b7 : 0x27d4eb2f);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return mixUint32(h, 0x7f4a7c15);
    }
    // Quantize to 0.1 mm so floating-point arithmetic jitter never alters deterministic UV hashes
    const q = Math.round(value * 10000);
    const lo = q | 0;
    const hi = Math.floor(q / 4294967296) | 0;
    return mixUint32(mixUint32(h, lo >>> 0), hi >>> 0);
  }
  if (typeof value === 'string') {
    let cur = mixUint32(h, value.length);
    for (let i = 0; i < value.length; i++) {
      cur = mixUint32(cur, value.charCodeAt(i));
    }
    return cur;
  }
  let cur = mixUint32(h, value.length + 0x165667b1);
  for (let i = 0; i < value.length; i++) {
    cur = feedSeedValue(cur, value[i]);
  }
  return cur;
}

/**
 * Hashes an arbitrary deterministic timber seed (numbers quantized to `0.1 mm`, strings, or nested tuples)
 * to an avalanched unsigned 32-bit integer.
 */
export function hashTimberSeed(seed: TimberSeedInput): number {
  return finalizeUint32(feedSeedValue(0x811c9dc5, seed));
}

/**
 * Samples a deterministic `(uOffset, vOffset, uSign, vSign)` slice transform from `seed` so every
 * door, stile, rail, panel, architrave leg/head, skirting segment, or beam samples a distinct region
 * of a seamless `RepeatWrapping` timber slab.
 */
export function sampleTimberSliceTransform(
  seed: TimberSeedInput,
  allowFlip = true
): TimberSliceTransform {
  if (seed === undefined || seed === null) {
    return { uOffset: 0, vOffset: 0, uSign: 1, vSign: 1 };
  }
  const h0 = hashTimberSeed(seed);
  const h1 = finalizeUint32(mixUint32(h0, 0x9e3779b9));
  const h2 = finalizeUint32(mixUint32(h1, 0x85ebca6b));
  const uOffset = (h0 >>> 8) / 16777216;
  const vOffset = (h1 >>> 8) / 16777216;
  const uSign: 1 | -1 = !allowFlip || (h2 & 1) === 0 ? 1 : -1;
  const vSign: 1 | -1 = !allowFlip || (h2 & 2) === 0 ? 1 : -1;
  return { uOffset, vOffset, uSign, vSign };
}

/**
 * Determines whether a material's primary diffuse/normal texture has wood fibers running along `'u'`
 * (`rotation ≈ 0` or `π`) or `'v'` (`rotation ≈ ±π/2`, such as `grainAxis: 'v'` door materials).
 */
export function resolveMaterialTextureGrainAxis(
  material?: THREE.Material | null,
  explicit?: 'u' | 'v'
): 'u' | 'v' {
  if (explicit) return explicit;
  if (!material) return 'u';
  const matRecord = material as unknown as {
    readonly map?: THREE.Texture | null;
    readonly normalMap?: THREE.Texture | null;
    readonly bumpMap?: THREE.Texture | null;
  };
  const tex = matRecord.map ?? matRecord.normalMap ?? matRecord.bumpMap ?? null;
  if (!tex || typeof tex.rotation !== 'number') return 'u';
  return Math.abs(Math.sin(tex.rotation)) > Math.SQRT1_2 ? 'v' : 'u';
}

function resolveDominantAxis(bb: THREE.Box3): 'x' | 'y' | 'z' {
  const sx = bb.max.x - bb.min.x;
  const sy = bb.max.y - bb.min.y;
  const sz = bb.max.z - bb.min.z;
  if (sx >= sy && sx >= sz) return 'x';
  if (sy >= sx && sy >= sz) return 'y';
  return 'z';
}

/**
 * Orients `geometry`'s `uv` attribute so timber grain **always runs along the member's physical
 * `grainAxis`** (`'x'`, `'y'`, `'z'`, or `'longest'`) at true metric scale (`scalePerMetre`), and
 * applies a deterministic `(uOffset, vOffset, uSign, vSign)` slice transform from `seed`.
 *
 * Compatible with `MaterialTextureDeduplicator` & `StaticContainerBatcher`: all members (vertical
 * stiles, horizontal rails, fielded panels, architrave legs/heads, beams) can share a single
 * canonical `THREE.Material` instance (`mat.uuid`) and batch into one draw call.
 */
export function applyTimberPieceUVs<T extends THREE.BufferGeometry>(
  inputGeometry: T,
  options: TimberPieceUvOptions = {}
): T {
  const geometry = inputGeometry.userData?.isSharedPrimitive
    ? (inputGeometry.clone() as T)
    : inputGeometry;
  if (geometry !== inputGeometry) {
    delete geometry.userData.isSharedPrimitive;
  }
  const pos = geometry.getAttribute('position');
  if (!pos || pos.count === 0) return geometry;

  if (!geometry.getAttribute('normal')) {
    geometry.computeVertexNormals();
  }
  const norm = geometry.getAttribute('normal');

  let uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!uv || uv.itemSize !== 2 || (uv as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute) {
    uv = new THREE.Float32BufferAttribute(new Float32Array(pos.count * 2), 2);
    geometry.setAttribute('uv', uv);
  }

  let axis: 'x' | 'y' | 'z';
  if (!options.grainAxis || options.grainAxis === 'longest') {
    geometry.computeBoundingBox();
    axis = geometry.boundingBox ? resolveDominantAxis(geometry.boundingBox) : 'x';
  } else {
    axis = options.grainAxis;
  }

  const scaleAlong = options.scalePerMetre ?? 1 / 2.2;
  const scaleAcross = options.crossScalePerMetre ?? scaleAlong;
  const texAxis = resolveMaterialTextureGrainAxis(options.material, options.materialGrainAxis);
  const slice = sampleTimberSliceTransform(options.seed, options.allowFlip ?? true);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = norm ? Math.abs(norm.getX(i)) : 0;
    const ny = norm ? Math.abs(norm.getY(i)) : 0;
    const nz = norm ? Math.abs(norm.getZ(i)) : 1;

    let along: number;
    let across: number;
    if (axis === 'x') {
      along = x;
      // On ±Z front/back faces -> across = y; on ±Y top/bottom faces -> across = z; on ±X end-grain -> across = y + z * 0.5
      across = nz >= ny && nz >= nx ? y : ny >= nx ? z : y + z * 0.35;
    } else if (axis === 'y') {
      along = y;
      // On ±Z front/back faces -> across = x; on ±X left/right faces -> across = z; on ±Y end-grain -> across = x + z * 0.5
      across = nz >= nx && nz >= ny ? x : nx >= ny ? z : x + z * 0.35;
    } else {
      along = z;
      // On ±X left/right faces -> across = y; on ±Y top/bottom faces -> across = x; on ±Z end-grain -> across = x + y * 0.5
      across = nx >= ny && nx >= nz ? y : ny >= nz ? x : x + y * 0.35;
    }

    const fiberCoord = along * scaleAlong * slice.uSign + slice.uOffset;
    const crossCoord = across * scaleAcross * slice.vSign + slice.vOffset;

    if (texAxis === 'u') {
      uv.setXY(i, fiberCoord, crossCoord);
    } else {
      // Material rotates texture +90° around (0.5, 0.5), mapping geometry V -> texture fiber U
      uv.setXY(i, crossCoord, fiberCoord);
    }
  }

  uv.needsUpdate = true;
  return geometry;
}

/**
 * Creates a fresh `THREE.BoxGeometry(width, height, depth)` with carpenter's grain orientation
 * and deterministic stochastic UV slice offset applied via `applyTimberPieceUVs`.
 * Never mutates `sharedBoxGeometry` caches.
 */
export function createTimberBoxGeometry(
  width: number,
  height: number,
  depth: number,
  options: TimberPieceUvOptions = {}
): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(width, height, depth);
  applyTimberPieceUVs(geo, options);
  geo.computeBoundingSphere();
  return geo;
}
