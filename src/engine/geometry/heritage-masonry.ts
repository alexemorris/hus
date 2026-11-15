import * as THREE from 'three';
import { hashTimberSeed, type TimberSeedInput } from './timber-piece-uvs.ts';

export interface HeritageClampRect2D {
  readonly uMin: number;
  readonly uMax: number;
  readonly vMin: number;
  readonly vMax: number;
  /** Clear zero-displacement margin outside the rectangle (`default: 0.02` = `20 mm`). */
  readonly clearPaddingM?: number;
  /** Smoothstep ramp width from `0` to `1` outside `clearPaddingM` (`default: 0.09` = `90 mm`). */
  readonly featherM?: number;
}

export interface HeritageBoundaryWeightOptions {
  /** Bottom skirting height clamped strictly to `0.000 mm` (`default: 0.16` = `160 mm`). */
  readonly skirtingClampH?: number;
  /** Top ceiling/cornice margin clamped strictly to `0.000 mm` (`default: 0.04` = `40 mm`). */
  readonly topClampM?: number;
  /** Left/right corner margin clamped strictly to `0.000 mm` (`default: 0.04` = `40 mm`). */
  readonly endClampM?: number;
  /** Smoothstep feather ramp width from clamped `0` boundary into full undulation (`default: 0.12` = `120 mm`). */
  readonly featherM?: number;
  /** Interior exclusion rectangles (openings, radiators, wardrobes, mirrors, artwork) clamped to `0.000 mm`. */
  readonly clampZones?: readonly HeritageClampRect2D[];
}

export interface HeritageWallImperfectionOptions extends HeritageBoundaryWeightOptions {
  readonly seed: TimberSeedInput;
  /** Max restrained surface undulation in metres (`default: 0.003` = `3.0 mm`; clamped `<= 0.005`). */
  readonly amplitudeM?: number;
  /** Target interior subdivision step in metres (`default: 0.35`). */
  readonly gridStepM?: number;
  /** Which faces receive plaster displacement (`'interior' | 'both' | 'front' | 'back'`, default `'both'`). */
  readonly targetFaces?: 'interior' | 'both' | 'front' | 'back';
  /** Optional world-space origin offset `[x, y, z]` for continuous noise & plaster UVs across adjacent piers. */
  readonly worldOffset?: readonly [number, number, number];
  /** World-space plaster UV tile span in metres (`default: 2.4`). */
  readonly tileM?: number;
  /** Applies world-space plaster UVs (`tileM = 2.4 m`) and sets `geo.userData.isSculpted = true` (`default: true`). */
  readonly applyPlasterUVs?: boolean;
}

export interface HeritageSkeilingSlabOptions {
  /** Coplanar 3D polygon vertices (`3`, `4`, or `N` points `[x, y, z]` or `THREE.Vector3`) on the room-facing underside. */
  readonly undersideQuadOrPoly: readonly (readonly [number, number, number] | THREE.Vector3)[];
  /** Vertical `+Y` slab thickness in metres (`default: 0.03` = `30 mm`). */
  readonly verticalThicknessM?: number;
  /** Optional vertical Y offset applied to all vertices (`default: 0`). */
  readonly verticalOffsetM?: number;
  readonly seed: TimberSeedInput;
  /** Max restrained lath-and-plaster undulation in metres (`default: 0.0032` = `3.2 mm`; clamped `<= 0.005`). */
  readonly amplitudeM?: number;
  /** Target underside subdivision pitch in metres (`default: 0.32`). */
  readonly gridStepM?: number;
  /** Perimeter clear zero-displacement band width in metres (`default: 0.025`). */
  readonly edgeClampM?: number;
  /** Smoothstep feather distance from perimeter into interior (`default: 0.14`). */
  readonly featherM?: number;
  /** Optional 3D spherical clamp zones `[x, y, z, radiusM]` pinned to `0.000 mm` displacement. */
  readonly clampWorldPoints?: readonly (readonly [number, number, number, number])[];
  /** Optional per-edge rim omission flags (`omitEdges[i] === true` skips vertical edge `i -> i+1`). */
  readonly omitEdges?: readonly boolean[];
  /** World-space plaster UV tile span in metres (`default: 2.4`). */
  readonly tileM?: number;
}

export interface SoftenedPlasterRevealOptions {
  /** Cardinal wall axis (`'x'` = opening runs along X; `'z'` = opening runs along Z). Optional when `tangent` & `inwardNormal` are supplied. */
  readonly axis?: 'x' | 'z';
  /** Center coordinate along `axis` (or along `tangent` from `wallOrigin`). */
  readonly openingCenter: number;
  /** Clear opening width in metres. */
  readonly openingWidth: number;
  /** Bottom elevation Y of reveal jambs in metres. */
  readonly botY: number;
  /** Top elevation Y of reveal head/jambs in metres. */
  readonly topY: number;
  /** Depth coordinate of outer window/frame reveal stop (`frameZ` for `axis: 'x'`, `frameX` for `axis: 'z'`). */
  readonly revealStartCoord?: number;
  /** Depth coordinate of room-facing interior wall plane (`intFaceZ` or `intFaceX`). */
  readonly interiorWallFaceCoord?: number;
  /** `+1` or `-1` pointing from the wall into the room (used with `axis`). */
  readonly inwardSign?: 1 | -1;
  /** Optional `dX/dZ` wall slope for angled walls when `axis === 'z'` (or `dZ/dX` when `axis === 'x'`). */
  readonly slopeXPerZ?: number;
  /** Optional arbitrary 3D wall frame alternative to `axis`/`interiorWallFaceCoord`. */
  readonly wallOrigin?: readonly [number, number, number];
  readonly tangent?: readonly [number, number, number];
  readonly inwardNormal?: readonly [number, number, number];
  readonly revealDepthM?: number;
  /** Omit head soffit lining (e.g. under an exposed oak lintel). */
  readonly skipHead?: boolean;
  /** Optional bullnosed plaster sill lining at `botY` (`default: false`). */
  readonly includeSill?: boolean;
  /** Bullnose arris radius in metres (`default: 0.013` = `13 mm`, clamped `0.008..0.022`). */
  readonly bullnoseRadiusM?: number;
  /** Max subtle hand-trowelled jamb/head wave in metres (`default: 0.0022` = `2.2 mm`, clamped `<= 0.004`). */
  readonly waveAmplitudeM?: number;
  readonly parent?: THREE.Object3D;
  readonly material: THREE.Material;
  readonly namePrefix?: string;
  readonly seed: TimberSeedInput;
  readonly tileM?: number;
}

export interface SoftenedPlasterRevealResult {
  readonly jambLeft: THREE.Mesh;
  readonly jambRight: THREE.Mesh;
  readonly head?: THREE.Mesh;
  readonly sill?: THREE.Mesh;
  readonly meshes: readonly THREE.Mesh[];
}

function prngFloat(ix: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smoothNoise1D(x: number, seed: number): number {
  const i0 = Math.floor(x);
  const f = x - i0;
  const u = f * f * (3 - 2 * f);
  return prngFloat(i0, seed) * (1 - u) + prngFloat(i0 + 1, seed) * u;
}

function smoothNoise2D(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const sRow0 = (seed + Math.imul(iy, 668265263)) | 0;
  const sRow1 = (seed + Math.imul(iy + 1, 668265263)) | 0;
  const n00 = prngFloat(ix, sRow0);
  const n10 = prngFloat(ix + 1, sRow0);
  const n01 = prngFloat(ix, sRow1);
  const n11 = prngFloat(ix + 1, sRow1);
  return (n00 * (1 - ux) + n10 * ux) * (1 - uy) + (n01 * (1 - ux) + n11 * ux) * uy;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (x <= edge0) return 0;
  if (x >= edge1) return 1;
  const t = (x - edge0) / Math.max(1e-6, edge1 - edge0);
  return t * t * (3 - 2 * t);
}

/**
 * Evaluates the boundary-clamping weight field `W(u, v) in [0, 1]` over `[0, spanU] x [0, spanV]`.
 *
 * Returns exact `0` on all 4 outer perimeter bands (`v <= skirtingClampH`, `v >= spanV - topClampM`,
 * `u <= endClampM`, `u >= spanU - endClampM`) and inside every `clampZones` rectangle (plus its
 * `clearPaddingM`), ramping smoothly via `C^1` Hermite smoothstep into the interior.
 */
export function evaluateHeritageBoundaryWeight(
  u: number,
  v: number,
  spanU: number,
  spanV: number,
  options: HeritageBoundaryWeightOptions = {}
): number {
  if (u <= 1e-6 || u >= spanU - 1e-6 || v <= 1e-6 || v >= spanV - 1e-6) {
    return 0;
  }
  const skirtH = Math.max(0, options.skirtingClampH ?? 0.16);
  const topClamp = Math.max(0, options.topClampM ?? 0.04);
  const endClamp = Math.max(0, options.endClampM ?? 0.04);
  const feather = Math.max(0.01, options.featherM ?? 0.12);

  const wBot = smoothstep(skirtH, skirtH + feather, v);
  if (wBot <= 0) return 0;
  const wTop = smoothstep(topClamp, topClamp + feather, spanV - v);
  if (wTop <= 0) return 0;
  const dEnd = Math.min(u, spanU - u);
  const wEnds = smoothstep(endClamp, endClamp + feather, dEnd);
  if (wEnds <= 0) return 0;

  let w = wBot * wTop * wEnds;
  if (options.clampZones) {
    for (const z of options.clampZones) {
      const dx = Math.max(0, z.uMin - u, u - z.uMax);
      const dy = Math.max(0, z.vMin - v, v - z.vMax);
      const dist = Math.hypot(dx, dy);
      const clearPad = Math.max(0, z.clearPaddingM ?? 0.02);
      if (dist <= clearPad) return 0;
      const zFeather = Math.max(0.01, z.featherM ?? 0.09);
      w *= smoothstep(clearPad, clearPad + zFeather, dist);
      if (w <= 0) return 0;
    }
  }
  return w;
}

/**
 * Evaluates a restrained multi-octave world-space lime-plaster undulation (`[-amplitudeM, +amplitudeM]`).
 */
export function sampleHeritagePlasterDisplacement(
  wx: number,
  wy: number,
  wz: number,
  seed: TimberSeedInput,
  amplitudeM = 0.003
): number {
  const amp = THREE.MathUtils.clamp(amplitudeM, 0, 0.005);
  if (amp <= 1e-7) return 0;
  const s = hashTimberSeed(seed);
  // Coherent 2D projection across horizontal + vertical coordinates
  const pA = wx * 0.82 + wz * 0.79;
  const pB = wy * 0.85 + (wx - wz) * 0.31;
  const n1 = (smoothNoise2D(pA * 0.85, pB * 0.85, s) - 0.5) * 2;
  const n2 = (smoothNoise2D(pA * 1.95 + 3.7, pB * 1.95 + 1.9, s + 97) - 0.5) * 2;
  const n3 = (smoothNoise2D(pA * 3.8 + 7.1, pB * 3.8 + 5.3, s + 211) - 0.5) * 2;
  return amp * (0.62 * n1 + 0.28 * n2 + 0.1 * n3);
}

/**
 * Applies seamless triplanar world-space plaster UVs (`1 UV tile = tileM`, default `2.4 m`)
 * and marks `geo.userData.isSculpted = true` so bevel modifiers preserve the UV mapping.
 */
export function applyWorldSpacePlasterUVs<T extends THREE.BufferGeometry>(
  geo: T,
  offsetX = 0,
  offsetY = 0,
  offsetZ = 0,
  tileM = 2.4
): T {
  const invTile = 1 / Math.max(0.1, tileM);
  if (!geo.getAttribute('normal')) {
    geo.computeVertexNormals();
  }
  const pos = geo.getAttribute('position');
  const norm = geo.getAttribute('normal');
  if (!pos) return geo;

  let uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!uv || uv.count !== pos.count) {
    uv = new THREE.Float32BufferAttribute(new Float32Array(pos.count * 2), 2);
    geo.setAttribute('uv', uv);
  }

  for (let i = 0; i < pos.count; i++) {
    const wx = pos.getX(i) + offsetX;
    const wy = pos.getY(i) + offsetY;
    const wz = pos.getZ(i) + offsetZ;
    const nx = norm ? Math.abs(norm.getX(i)) : 0;
    const ny = norm ? Math.abs(norm.getY(i)) : 0;
    const nz = norm ? Math.abs(norm.getZ(i)) : 1;

    if (ny >= nx && ny >= nz) {
      uv.setXY(i, wx * invTile, wz * invTile);
    } else if (nx >= nz) {
      uv.setXY(i, wz * invTile, wy * invTile);
    } else {
      uv.setXY(i, wx * invTile, wy * invTile);
    }
  }
  uv.needsUpdate = true;
  geo.userData.isSculpted = true;
  return geo;
}

function buildAdaptiveAxisCoords(
  span: number,
  gridStepM: number,
  breakpoints: readonly number[]
): readonly number[] {
  const baseSegs = THREE.MathUtils.clamp(Math.ceil(span / Math.max(0.08, gridStepM)), 2, 48);
  const raw: number[] = [0, span];
  for (let i = 1; i < baseSegs; i++) {
    raw.push((span * i) / baseSegs);
  }
  for (const bp of breakpoints) {
    if (bp > 0.01 && bp < span - 0.01) {
      raw.push(bp);
    }
  }
  raw.sort((a, b) => a - b);
  const minStep = Math.min(0.025, span * 0.1);
  const merged: number[] = [0];
  for (let i = 1; i < raw.length - 1; i++) {
    const val = raw[i]!;
    if (val - merged[merged.length - 1]! >= minStep && span - val >= minStep) {
      merged.push(val);
    }
  }
  merged.push(span);
  return merged;
}

/**
 * Builds a watertight, boundary-clamped historic lime-plaster wall `THREE.BufferGeometry`
 * centered at `(0, 0, 0)` with dimensions `(width, height, depth)` and standard 6-face
 * `BoxGeometry` material group compatibility (`0: +X, 1: -X, 2: +Y, 3: -Y, 4: +Z, 5: -Z`).
 *
 * All outer perimeter bands, skirting zones (`v <= skirtingClampH`), and `clampZones`
 * receive exact `0.000 mm` normal displacement, guaranteeing watertight corner joins (`signedVol > 0`)
 * and zero air gaps behind straight joinery.
 */
export function createHeritagePlasterWallGeometry(
  width: number,
  height: number,
  depth: number,
  options: HeritageWallImperfectionOptions
): THREE.BufferGeometry {
  const w = Math.max(0.01, width);
  const h = Math.max(0.01, height);
  const d = Math.max(0.004, depth);
  const halfW = w * 0.5;
  const halfH = h * 0.5;
  const halfD = d * 0.5;

  const amp = THREE.MathUtils.clamp(options.amplitudeM ?? 0.003, 0, 0.005);
  const gridStep = Math.max(0.1, options.gridStepM ?? 0.35);
  const targetFaces = options.targetFaces ?? 'both';
  const displaceFront =
    targetFaces === 'both' || targetFaces === 'front' || targetFaces === 'interior';
  const displaceBack = targetFaces === 'both' || targetFaces === 'back';

  const [ox, oy, oz] = options.worldOffset ?? [0, 0, 0];
  const tileM = Math.max(0.25, options.tileM ?? 2.4);
  const invTile = 1 / tileM;

  const uBreaks: number[] = [];
  const vBreaks: number[] = [];
  const skirtH = Math.max(0, options.skirtingClampH ?? 0.16);
  if (skirtH > 0 && skirtH < h) vBreaks.push(skirtH);
  if (options.clampZones) {
    for (const cz of options.clampZones) {
      const pad = Math.max(0, cz.clearPaddingM ?? 0.02);
      uBreaks.push(cz.uMin - pad, cz.uMax + pad);
      vBreaks.push(cz.vMin - pad, cz.vMax + pad);
    }
  }

  const uCoords = buildAdaptiveAxisCoords(w, gridStep, uBreaks);
  const vCoords = buildAdaptiveAxisCoords(h, gridStep, vBreaks);
  const nu = uCoords.length - 1;
  const nv = vCoords.length - 1;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const groups: Array<{ start: number; count: number; materialIndex: number }> = [];

  const emitQuadGroup = (
    materialIndex: number,
    p0: readonly [number, number, number],
    p1: readonly [number, number, number],
    p2: readonly [number, number, number],
    p3: readonly [number, number, number],
    n: readonly [number, number, number],
    uv0: readonly [number, number],
    uv1: readonly [number, number],
    uv2: readonly [number, number],
    uv3: readonly [number, number]
  ): void => {
    const startIdx = indices.length;
    const baseV = positions.length / 3;
    for (const [p, uvPt] of [
      [p0, uv0],
      [p1, uv1],
      [p2, uv2],
      [p3, uv3],
    ] as const) {
      positions.push(p[0], p[1], p[2]);
      normals.push(n[0], n[1], n[2]);
      uvs.push(uvPt[0], uvPt[1]);
    }
    indices.push(baseV, baseV + 1, baseV + 2, baseV, baseV + 2, baseV + 3);
    groups.push({ start: startIdx, count: 6, materialIndex });
  };

  // Group 0: +X Right cap (z: +halfD -> -halfD, y: -halfH -> +halfH), outward normal (+1, 0, 0)
  emitQuadGroup(
    0,
    [halfW, -halfH, halfD],
    [halfW, -halfH, -halfD],
    [halfW, halfH, -halfD],
    [halfW, halfH, halfD],
    [1, 0, 0],
    [(oz + halfD) * invTile, (oy - halfH) * invTile],
    [(oz - halfD) * invTile, (oy - halfH) * invTile],
    [(oz - halfD) * invTile, (oy + halfH) * invTile],
    [(oz + halfD) * invTile, (oy + halfH) * invTile]
  );

  // Group 1: -X Left cap (z: -halfD -> +halfD, y: -halfH -> +halfH), outward normal (-1, 0, 0)
  emitQuadGroup(
    1,
    [-halfW, -halfH, -halfD],
    [-halfW, -halfH, halfD],
    [-halfW, halfH, halfD],
    [-halfW, halfH, -halfD],
    [-1, 0, 0],
    [(oz - halfD) * invTile, (oy - halfH) * invTile],
    [(oz + halfD) * invTile, (oy - halfH) * invTile],
    [(oz + halfD) * invTile, (oy + halfH) * invTile],
    [(oz - halfD) * invTile, (oy + halfH) * invTile]
  );

  // Group 2: +Y Top cap (x: -halfW -> +halfW, z: +halfD -> -halfD), outward normal (0, +1, 0)
  emitQuadGroup(
    2,
    [-halfW, halfH, halfD],
    [halfW, halfH, halfD],
    [halfW, halfH, -halfD],
    [-halfW, halfH, -halfD],
    [0, 1, 0],
    [(ox - halfW) * invTile, (oz + halfD) * invTile],
    [(ox + halfW) * invTile, (oz + halfD) * invTile],
    [(ox + halfW) * invTile, (oz - halfD) * invTile],
    [(ox - halfW) * invTile, (oz - halfD) * invTile]
  );

  // Group 3: -Y Bottom cap (x: -halfW -> +halfW, z: -halfD -> +halfD), outward normal (0, -1, 0)
  emitQuadGroup(
    3,
    [-halfW, -halfH, -halfD],
    [halfW, -halfH, -halfD],
    [halfW, -halfH, halfD],
    [-halfW, -halfH, halfD],
    [0, -1, 0],
    [(ox - halfW) * invTile, (oz - halfD) * invTile],
    [(ox + halfW) * invTile, (oz - halfD) * invTile],
    [(ox + halfW) * invTile, (oz + halfD) * invTile],
    [(ox - halfW) * invTile, (oz + halfD) * invTile]
  );

  // Helper to emit subdivided +Z (Group 4) or -Z (Group 5) elevation face with exact analytico-finite normals
  const emitElevationFace = (materialIndex: 4 | 5, zSign: 1 | -1, doDisplace: boolean): void => {
    const startIdx = indices.length;
    if (!doDisplace || amp <= 1e-7) {
      if (zSign > 0) {
        emitQuadGroup(
          materialIndex,
          [-halfW, -halfH, halfD],
          [halfW, -halfH, halfD],
          [halfW, halfH, halfD],
          [-halfW, halfH, halfD],
          [0, 0, 1],
          [(ox - halfW) * invTile, (oy - halfH) * invTile],
          [(ox + halfW) * invTile, (oy - halfH) * invTile],
          [(ox + halfW) * invTile, (oy + halfH) * invTile],
          [(ox - halfW) * invTile, (oy + halfH) * invTile]
        );
      } else {
        emitQuadGroup(
          materialIndex,
          [halfW, -halfH, -halfD],
          [-halfW, -halfH, -halfD],
          [-halfW, halfH, -halfD],
          [halfW, halfH, -halfD],
          [0, 0, -1],
          [(ox + halfW) * invTile, (oy - halfH) * invTile],
          [(ox - halfW) * invTile, (oy - halfH) * invTile],
          [(ox - halfW) * invTile, (oy + halfH) * invTile],
          [(ox + halfW) * invTile, (oy + halfH) * invTile]
        );
      }
      return;
    }

    const baseV = positions.length / 3;
    const faceSeed: TimberSeedInput = [options.seed, zSign > 0 ? 'front' : 'back'];
    const zGrid: number[][] = [];

    for (let iv = 0; iv <= nv; iv++) {
      const v = vCoords[iv]!;
      const yLocal = -halfH + v;
      const row: number[] = [];
      for (let iu = 0; iu <= nu; iu++) {
        const u = uCoords[iu]!;
        const xLocal = -halfW + u;
        const weight = evaluateHeritageBoundaryWeight(u, v, w, h, options);
        const dz =
          weight > 0
            ? weight *
              sampleHeritagePlasterDisplacement(
                ox + xLocal,
                oy + yLocal,
                oz + zSign * halfD,
                faceSeed,
                amp
              )
            : 0;
        row.push(zSign * (halfD + dz));
      }
      zGrid.push(row);
    }

    for (let iv = 0; iv <= nv; iv++) {
      const v = vCoords[iv]!;
      const yLocal = -halfH + v;
      const ivM = Math.max(0, iv - 1);
      const ivP = Math.min(nv, iv + 1);
      const dySpan = Math.max(1e-4, vCoords[ivP]! - vCoords[ivM]!);

      for (let iu = 0; iu <= nu; iu++) {
        const u = uCoords[iu]!;
        const xLocal = -halfW + u;
        const zLocal = zGrid[iv]![iu]!;

        const iuM = Math.max(0, iu - 1);
        const iuP = Math.min(nu, iu + 1);
        const dxSpan = Math.max(1e-4, uCoords[iuP]! - uCoords[iuM]!);

        const dzDx = (zGrid[iv]![iuP]! - zGrid[iv]![iuM]!) / dxSpan;
        const dzDy = (zGrid[ivP]![iu]! - zGrid[ivM]![iu]!) / dySpan;

        // Surface P(x, y) = (x, y, z(x,y)):
        // For +Z face: dP/dx x dP/dy = (1, 0, dzDx) x (0, 1, dzDy) = (-dzDx, -dzDy, 1)
        // For -Z face: dP/dy x dP/dx = (dzDx, dzDy, -1)
        const nx = zSign > 0 ? -dzDx : dzDx;
        const ny = zSign > 0 ? -dzDy : dzDy;
        const nz = zSign;
        const invLen = 1 / Math.hypot(nx, ny, nz);

        positions.push(xLocal, yLocal, zLocal);
        normals.push(nx * invLen, ny * invLen, nz * invLen);
        uvs.push((ox + xLocal) * invTile, (oy + yLocal) * invTile);
      }
    }

    const rowStride = nu + 1;
    for (let iv = 0; iv < nv; iv++) {
      const r0 = baseV + iv * rowStride;
      const r1 = baseV + (iv + 1) * rowStride;
      for (let iu = 0; iu < nu; iu++) {
        const a = r0 + iu;
        const b = r0 + iu + 1;
        const c = r1 + iu + 1;
        const dIdx = r1 + iu;
        if (zSign > 0) {
          indices.push(a, b, c, a, c, dIdx);
        } else {
          indices.push(b, a, dIdx, b, dIdx, c);
        }
      }
    }
    groups.push({ start: startIdx, count: indices.length - startIdx, materialIndex });
  };

  emitElevationFace(4, 1, displaceFront);
  emitElevationFace(5, -1, displaceBack);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  for (const grp of groups) {
    geo.addGroup(grp.start, grp.count, grp.materialIndex);
  }
  if (options.applyPlasterUVs !== false) {
    applyWorldSpacePlasterUVs(geo, ox, oy, oz, tileM);
  } else {
    geo.userData.isSculpted = true;
  }
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

function toVec3(p: readonly [number, number, number] | THREE.Vector3): THREE.Vector3 {
  return p instanceof THREE.Vector3 ? p.clone() : new THREE.Vector3(p[0], p[1], p[2]);
}

function distToSegment3D(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = new THREE.Vector3().subVectors(b, a);
  const lenSq = ab.lengthSq();
  if (lenSq <= 1e-12) return p.distanceTo(a);
  const t = THREE.MathUtils.clamp(new THREE.Vector3().subVectors(p, a).dot(ab) / lenSq, 0, 1);
  const proj = a.clone().addScaledVector(ab, t);
  return p.distanceTo(proj);
}

/**
 * Watertight 3D prism builder for vaulted lime-plaster skeilings & collars.
 *
 * - Subdivides ONLY the room-facing underside (`gridStepM = 0.32 m`) while keeping the concealed
 *   upper roof-cavity face coarse (`N - 2` tris).
 * - Pins ALL perimeter vertices strictly to `0.000 mm` displacement so collar-to-skeiling knuckles
 *   and scribed joinery cornices remain 100% watertight with zero T-junctions.
 * - Guarantees outward CCW winding and positive signed volume (`signedVol > 0`).
 */
export function createHeritageSkeilingSlabGeometry(
  options: HeritageSkeilingSlabOptions
): THREE.BufferGeometry {
  const rawPts = options.undersideQuadOrPoly.map(toVec3);
  if (rawPts.length < 3) {
    throw new Error('createHeritageSkeilingSlabGeometry requires at least 3 polygon vertices.');
  }

  const yOff = options.verticalOffsetM ?? 0;
  const thick = Math.max(0.005, options.verticalThicknessM ?? 0.03);
  const amp = THREE.MathUtils.clamp(options.amplitudeM ?? 0.0032, 0, 0.005);
  const gridStep = Math.max(0.1, options.gridStepM ?? 0.32);
  const edgeClamp = Math.max(0, options.edgeClampM ?? 0.025);
  const feather = Math.max(0.02, options.featherM ?? 0.14);
  const tileM = Math.max(0.25, options.tileM ?? 2.4);
  const invTile = 1 / tileM;

  const botPoly = rawPts.map((p) => new THREE.Vector3(p.x, p.y + yOff, p.z));

  // Compute upward unit normal (+Y hemisphere) of the slab plane via Newell's method
  const upNormal = new THREE.Vector3();
  for (let i = 0; i < botPoly.length; i++) {
    const curr = botPoly[i]!;
    const next = botPoly[(i + 1) % botPoly.length]!;
    upNormal.x += (curr.y - next.y) * (curr.z + next.z);
    upNormal.y += (curr.z - next.z) * (curr.x + next.x);
    upNormal.z += (curr.x - next.x) * (curr.y + next.y);
  }
  if (upNormal.lengthSq() <= 1e-12) {
    upNormal.set(0, 1, 0);
  } else {
    upNormal.normalize();
  }
  // Ensure polygon vertex order is CCW when viewed from +upNormal (so (p1-p0)x(p2-p0) aligns with +upNormal)
  let polySignedDot = 0;
  for (let i = 1; i + 1 < botPoly.length; i++) {
    const e1 = new THREE.Vector3().subVectors(botPoly[i]!, botPoly[0]!);
    const e2 = new THREE.Vector3().subVectors(botPoly[i + 1]!, botPoly[0]!);
    polySignedDot += e1.cross(e2).dot(upNormal);
  }
  if (upNormal.y < 0) {
    upNormal.negate();
    polySignedDot = -polySignedDot;
  }

  // Keep original edge indices aligned with `options.omitEdges` while knowing CCW orientation
  const isCcwFromAbove = polySignedDot >= 0;
  const roomNormal = upNormal.clone().negate();
  const topPoly = botPoly.map((p) => new THREE.Vector3(p.x, p.y + thick, p.z));

  const evalPointDisplacement = (pt: THREE.Vector3, isOnBoundary: boolean): number => {
    if (isOnBoundary || amp <= 1e-7) return 0;
    let minEdgeDist = Infinity;
    for (let i = 0; i < botPoly.length; i++) {
      const d = distToSegment3D(pt, botPoly[i]!, botPoly[(i + 1) % botPoly.length]!);
      if (d < minEdgeDist) minEdgeDist = d;
    }
    let w = smoothstep(edgeClamp, edgeClamp + feather, minEdgeDist);
    if (w <= 0) return 0;

    if (options.clampWorldPoints) {
      for (const [cx, cy, cz, rad] of options.clampWorldPoints) {
        const dist = Math.hypot(pt.x - cx, pt.y - cy, pt.z - cz);
        if (dist <= rad) return 0;
        w *= smoothstep(rad, rad + Math.max(0.06, feather * 0.75), dist);
        if (w <= 0) return 0;
      }
    }

    return w * sampleHeritagePlasterDisplacement(pt.x, pt.y, pt.z, options.seed, amp);
  };

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const pushVertex = (p: THREE.Vector3, uPlane: number, vPlane: number): number => {
    const idx = positions.length / 3;
    positions.push(p.x, p.y, p.z);
    uvs.push(uPlane * invTile, vPlane * invTile);
    return idx;
  };

  // In-plane orthonormal UV axes so angled skeilings never stretch textures vertically
  const tangentU = new THREE.Vector3().subVectors(botPoly[1]!, botPoly[0]!);
  if (tangentU.lengthSq() <= 1e-10) tangentU.set(1, 0, 0);
  tangentU.normalize();
  const tangentV = new THREE.Vector3().crossVectors(upNormal, tangentU).normalize();
  const projectUV = (p: THREE.Vector3): readonly [number, number] => [
    p.dot(tangentU),
    p.dot(tangentV),
  ];

  // Track subdivided bottom perimeter vertices along each polygon edge `i -> (i+1)` for watertight rim stitching
  const edgeChains: THREE.Vector3[][] = [];

  if (botPoly.length === 4) {
    const [b0, b1, b2, b3] = botPoly as [
      THREE.Vector3,
      THREE.Vector3,
      THREE.Vector3,
      THREE.Vector3,
    ];
    const spanU = Math.max(b0.distanceTo(b1), b3.distanceTo(b2));
    const spanV = Math.max(b0.distanceTo(b3), b1.distanceTo(b2));
    const nu = THREE.MathUtils.clamp(Math.ceil(spanU / gridStep), 3, 36);
    const nv = THREE.MathUtils.clamp(Math.ceil(spanV / gridStep), 3, 36);

    const botGrid: THREE.Vector3[][] = [];
    const botIdxGrid: number[][] = [];

    for (let iv = 0; iv <= nv; iv++) {
      const vf = iv / nv;
      const rowPts: THREE.Vector3[] = [];
      const rowIdx: number[] = [];
      for (let iu = 0; iu <= nu; iu++) {
        const uf = iu / nu;
        const left = new THREE.Vector3().lerpVectors(b0, b3, vf);
        const right = new THREE.Vector3().lerpVectors(b1, b2, vf);
        const pt = new THREE.Vector3().lerpVectors(left, right, uf);
        const isBoundary = iv === 0 || iv === nv || iu === 0 || iu === nu;
        const disp = evalPointDisplacement(pt, isBoundary);
        if (disp !== 0) {
          pt.addScaledVector(roomNormal, disp);
        }
        const [uu, vv] = projectUV(pt);
        rowPts.push(pt);
        rowIdx.push(pushVertex(pt, uu, vv));
      }
      botGrid.push(rowPts);
      botIdxGrid.push(rowIdx);
    }

    // Emit underside triangles oriented toward `roomNormal`
    for (let iv = 0; iv < nv; iv++) {
      for (let iu = 0; iu < nu; iu++) {
        const i00 = botIdxGrid[iv]![iu]!;
        const i10 = botIdxGrid[iv]![iu + 1]!;
        const i11 = botIdxGrid[iv + 1]![iu + 1]!;
        const i01 = botIdxGrid[iv + 1]![iu]!;
        if (isCcwFromAbove) {
          // From above, (i00 -> i10 -> i11 -> i01) is CCW, so underside (-upNormal) is CW from above:
          indices.push(i00, i01, i11, i00, i11, i10);
        } else {
          indices.push(i00, i10, i11, i00, i11, i01);
        }
      }
    }

    // Build exact perimeter chains for edges 0->1, 1->2, 2->3, 3->0
    const chain01: THREE.Vector3[] = [];
    for (let iu = 0; iu <= nu; iu++) chain01.push(botGrid[0]![iu]!);
    const chain12: THREE.Vector3[] = [];
    for (let iv = 0; iv <= nv; iv++) chain12.push(botGrid[iv]![nu]!);
    const chain23: THREE.Vector3[] = [];
    for (let iu = nu; iu >= 0; iu--) chain23.push(botGrid[nv]![iu]!);
    const chain30: THREE.Vector3[] = [];
    for (let iv = nv; iv >= 0; iv--) chain30.push(botGrid[iv]![0]!);
    edgeChains.push(chain01, chain12, chain23, chain30);
  } else {
    // General N-gon underside: subdivide each fan wedge (centroid, b_i, b_{i+1}) with shared vertex table
    const nSides = botPoly.length;
    const centroid = new THREE.Vector3();
    let maxEdge = 0;
    for (let i = 0; i < nSides; i++) {
      centroid.add(botPoly[i]!);
      const d = botPoly[i]!.distanceTo(botPoly[(i + 1) % nSides]!);
      if (d > maxEdge) maxEdge = d;
    }
    centroid.divideScalar(nSides);
    const steps = THREE.MathUtils.clamp(Math.ceil(maxEdge / gridStep), 3, 24);

    const vertKeyMap = new Map<string, { idx: number; pt: THREE.Vector3 }>();
    const getOrAddUndersideVert = (
      rawPos: THREE.Vector3,
      isOuterEdge: boolean
    ): { idx: number; pt: THREE.Vector3 } => {
      const key = `${Math.round(rawPos.x * 1e5)}:${Math.round(rawPos.y * 1e5)}:${Math.round(rawPos.z * 1e5)}`;
      const existing = vertKeyMap.get(key);
      if (existing) return existing;
      const pt = rawPos.clone();
      const disp = evalPointDisplacement(pt, isOuterEdge);
      if (disp !== 0) pt.addScaledVector(roomNormal, disp);
      const [uu, vv] = projectUV(pt);
      const entry = { idx: pushVertex(pt, uu, vv), pt };
      vertKeyMap.set(key, entry);
      return entry;
    };

    for (let side = 0; side < nSides; side++) {
      const pA = botPoly[side]!;
      const pB = botPoly[(side + 1) % nSides]!;
      const rows: { idx: number; pt: THREE.Vector3 }[][] = [];
      for (let r = 0; r <= steps; r++) {
        const rowFrac = r / steps;
        const rowLeft = new THREE.Vector3().lerpVectors(centroid, pA, rowFrac);
        const rowRight = new THREE.Vector3().lerpVectors(centroid, pB, rowFrac);
        const rowEntries: { idx: number; pt: THREE.Vector3 }[] = [];
        for (let c = 0; c <= r; c++) {
          const colFrac = r === 0 ? 0 : c / r;
          const pos = new THREE.Vector3().lerpVectors(rowLeft, rowRight, colFrac);
          rowEntries.push(getOrAddUndersideVert(pos, r === steps));
        }
        rows.push(rowEntries);
      }

      for (let r = 0; r < steps; r++) {
        const upperRow = rows[r]!;
        const lowerRow = rows[r + 1]!;
        for (let c = 0; c <= r; c++) {
          const vTop = upperRow[c]!.idx;
          const vBotL = lowerRow[c]!.idx;
          const vBotR = lowerRow[c + 1]!.idx;
          if (isCcwFromAbove) {
            indices.push(vTop, vBotR, vBotL);
          } else {
            indices.push(vTop, vBotL, vBotR);
          }
          if (c < r) {
            const vTopR = upperRow[c + 1]!.idx;
            if (isCcwFromAbove) {
              indices.push(vTop, vTopR, vBotR);
            } else {
              indices.push(vTop, vBotR, vTopR);
            }
          }
        }
      }

      edgeChains.push(rows[steps]!.map((e) => e.pt));
    }
  }

  // Coarse concealed upper face (+upNormal) with separate vertices for crisp flat roof-cavity normals
  {
    const topIndices: number[] = [];
    for (const tp of topPoly) {
      const [uu, vv] = projectUV(tp);
      topIndices.push(pushVertex(tp, uu, vv));
    }
    for (let i = 1; i + 1 < topIndices.length; i++) {
      if (isCcwFromAbove) {
        indices.push(topIndices[0]!, topIndices[i]!, topIndices[i + 1]!);
      } else {
        indices.push(topIndices[0]!, topIndices[i + 1]!, topIndices[i]!);
      }
    }
  }

  // Watertight vertical perimeter rim faces stitched directly to every subdivided bottom edge vertex (0 T-junctions!)
  for (let i = 0; i < botPoly.length; i++) {
    if (options.omitEdges?.[i]) continue;
    const chain = edgeChains[i]!;
    if (chain.length < 2) continue;

    for (let k = 0; k < chain.length - 1; k++) {
      const bA = chain[k]!;
      const bB = chain[k + 1]!;
      const tA = new THREE.Vector3(bA.x, bA.y + thick, bA.z);
      const tB = new THREE.Vector3(bB.x, bB.y + thick, bB.z);
      const segLen = bA.distanceTo(bB);
      if (segLen <= 1e-7) continue;

      const i0 = pushVertex(bA, 0, 0);
      const i1 = pushVertex(bB, segLen, 0);
      const i2 = pushVertex(tB, segLen, thick);
      const i3 = pushVertex(tA, 0, thick);

      if (isCcwFromAbove) {
        // Outward normal is (bB - bA) x (+Y): (bA -> bB -> tB -> tA) has cross (bB - bA) x (+Y)!
        indices.push(i0, i1, i2, i0, i2, i3);
      } else {
        indices.push(i1, i0, i3, i1, i3, i2);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  geo.userData.isSculpted = true;
  return geo;
}

/**
 * Adds softly bullnosed (`R = 10–16 mm`), gently hand-trowelled lime-plaster jamb & head reveal
 * linings for trimless historic windows and plastered masonry portals.
 *
 * Stands `+0.9 mm` proud of the host interior wall plane and `+1.2 mm` proud of the rough reveal
 * (`> 0.35 mm` z-fight detector threshold), eliminating coplanar z-fighting while softening the
 * 90° masonry arris.
 */
export function createSoftenedPlasterRevealLinings(
  options: SoftenedPlasterRevealOptions
): SoftenedPlasterRevealResult;
export function createSoftenedPlasterRevealLinings(
  parent: THREE.Object3D,
  options: SoftenedPlasterRevealOptions
): SoftenedPlasterRevealResult;
export function createSoftenedPlasterRevealLinings(
  parentOrOptions: THREE.Object3D | SoftenedPlasterRevealOptions,
  maybeOptions?: SoftenedPlasterRevealOptions
): SoftenedPlasterRevealResult {
  const hasExplicitParent = (parentOrOptions as THREE.Object3D).isObject3D === true;
  const options = hasExplicitParent
    ? maybeOptions!
    : (parentOrOptions as SoftenedPlasterRevealOptions);
  const parent: THREE.Object3D | undefined = hasExplicitParent
    ? (parentOrOptions as THREE.Object3D)
    : options.parent;
  const seedNum = hashTimberSeed(options.seed);
  const r = THREE.MathUtils.clamp(options.bullnoseRadiusM ?? 0.013, 0.008, 0.022);
  const waveAmp = THREE.MathUtils.clamp(options.waveAmplitudeM ?? 0.0022, 0, 0.004);
  const tileM = Math.max(0.25, options.tileM ?? 2.4);
  const invTile = 1 / tileM;
  const uHalf = options.openingWidth * 0.5;
  const namePrefix = options.namePrefix ?? 'heritageReveal';

  const wallProud = 0.0009; // +0.9 mm clear of flat interior wall face
  const revealProud = 0.0012; // +1.2 mm clear of raw opening reveal

  let depthSpan: number;
  let toWorld: (uOpening: number, y: number, depthFromWall: number) => THREE.Vector3;
  let tangentVec: THREE.Vector3;
  let inwardVec: THREE.Vector3;

  if (options.wallOrigin && options.tangent && options.inwardNormal) {
    const origin = new THREE.Vector3(
      options.wallOrigin[0],
      options.wallOrigin[1],
      options.wallOrigin[2]
    );
    tangentVec = new THREE.Vector3(
      options.tangent[0],
      options.tangent[1],
      options.tangent[2]
    ).normalize();
    inwardVec = new THREE.Vector3(
      options.inwardNormal[0],
      options.inwardNormal[1],
      options.inwardNormal[2]
    ).normalize();
    depthSpan = Math.max(0.028, options.revealDepthM ?? 0.16);
    toWorld = (uOpening: number, y: number, depthFromWall: number): THREE.Vector3 =>
      new THREE.Vector3(origin.x, y, origin.z)
        .addScaledVector(tangentVec, uOpening)
        .addScaledVector(inwardVec, depthFromWall);
  } else {
    const axis = options.axis ?? 'x';
    const inwardSign = options.inwardSign ?? 1;
    const slope = options.slopeXPerZ ?? 0;
    const intCoord = options.interiorWallFaceCoord ?? 0;
    const revStart = options.revealStartCoord ?? intCoord - inwardSign * (options.revealDepthM ?? 0.16);
    depthSpan = Math.max(0.028, Math.abs(intCoord - revStart));

    if (axis === 'x') {
      tangentVec = new THREE.Vector3(1, 0, 0);
      inwardVec = new THREE.Vector3(0, 0, inwardSign);
      toWorld = (uOpening: number, y: number, depthFromWall: number): THREE.Vector3 => {
        const wallZ = intCoord + slope * (uOpening - options.openingCenter);
        return new THREE.Vector3(uOpening, y, wallZ + inwardSign * depthFromWall);
      };
    } else {
      tangentVec = new THREE.Vector3(slope, 0, 1).normalize();
      inwardVec = new THREE.Vector3(inwardSign, 0, -inwardSign * slope).normalize();
      toWorld = (uOpening: number, y: number, depthFromWall: number): THREE.Vector3 => {
        const wallX = intCoord + slope * (uOpening - options.openingCenter);
        return new THREE.Vector3(wallX + inwardSign * depthFromWall, y, uOpening);
      };
    }
  }

  // 2D cross-section in (offsetIntoOpening, depthFromInteriorWallFace)
  const baseProf: Array<readonly [number, number]> = [
    [revealProud, -depthSpan],
    [revealProud, -depthSpan * 0.52],
    [revealProud, -r],
  ];
  const arcSegs = 4;
  for (let a = 1; a <= arcSegs; a++) {
    const theta = (a / arcSegs) * (Math.PI * 0.5);
    const u = -r + revealProud + r * Math.cos(theta);
    const d = -r + wallProud + r * Math.sin(theta);
    baseProf.push([u, d]);
  }
  baseProf.push([-r - 0.015, wallProud]);
  const pCount = baseProf.length;

  const buildSweepMesh = (
    meshName: string,
    segs: number,
    sampleRingPoint: (t: number, k: number, uProf: number, dProf: number) => THREE.Vector3,
    expectedInwardDir: THREE.Vector3,
    spanLenM: number
  ): THREE.Mesh => {
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      for (let k = 0; k < pCount; k++) {
        const [uProf, dProf] = baseProf[k]!;
        const wp = sampleRingPoint(t, k, uProf, dProf);
        positions.push(wp.x, wp.y, wp.z);
        uvs.push(t * spanLenM * invTile, (k / (pCount - 1)) * (depthSpan + r + 0.015) * invTile);
      }
    }

    const p0 = new THREE.Vector3(positions[0]!, positions[1]!, positions[2]!);
    const p1 = new THREE.Vector3(positions[3]!, positions[4]!, positions[5]!);
    const pNext = new THREE.Vector3(
      positions[pCount * 3]!,
      positions[pCount * 3 + 1]!,
      positions[pCount * 3 + 2]!
    );
    const triN = new THREE.Vector3()
      .subVectors(p1, p0)
      .cross(new THREE.Vector3().subVectors(pNext, p0));
    const flip = triN.dot(expectedInwardDir) < 0;

    for (let s = 0; s < segs; s++) {
      const r0 = s * pCount;
      const r1 = (s + 1) * pCount;
      for (let k = 0; k < pCount - 1; k++) {
        const a = r0 + k;
        const b = r0 + k + 1;
        const c = r1 + k + 1;
        const d = r1 + k;
        if (flip) {
          indices.push(a, d, c, a, c, b);
        } else {
          indices.push(a, b, c, a, c, d);
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    geo.userData.isSculpted = true;

    const mesh = new THREE.Mesh(geo, options.material);
    mesh.name = meshName;
    mesh.receiveShadow = true;
    mesh.userData.heritageFabric = {
      role: 'softened-plaster-reveal',
      seed: options.seed,
    };
    parent?.add(mesh);
    return mesh;
  };

  const jambHeight = Math.max(0.05, options.topY - options.botY);
  const jambSegs = THREE.MathUtils.clamp(Math.round(jambHeight * 12), 10, 32);
  const meshes: THREE.Mesh[] = [];

  const buildJamb = (sideSign: -1 | 1): THREE.Mesh => {
    const sideSeed = seedNum + (sideSign < 0 ? 101 : 203);
    const suffix =
      options.axis === 'z'
        ? sideSign < 0
          ? 'north'
          : 'south'
        : sideSign < 0
          ? 'left'
          : 'right';
    const expectedDir = inwardVec.clone().addScaledVector(tangentVec, -sideSign);
    const m = buildSweepMesh(
      `${namePrefix}.revealJamb.${suffix}`,
      jambSegs,
      (t, k, uProf, dProf) => {
        const y = THREE.MathUtils.lerp(options.botY, options.topY, t);
        const endTaper = Math.sin(Math.PI * t);
        const waveU = (smoothNoise1D(t * 5.2, sideSeed) - 0.5) * 2 * waveAmp * endTaper;
        const depthTaper = k === 0 || k === pCount - 1 ? 0.35 : 1.0;
        const uOpening =
          options.openingCenter + sideSign * uHalf - sideSign * (uProf + waveU * depthTaper);
        return toWorld(uOpening, y, dProf);
      },
      expectedDir,
      jambHeight
    );
    meshes.push(m);
    return m;
  };

  const jambLeft = buildJamb(-1);
  const jambRight = buildJamb(1);

  let head: THREE.Mesh | undefined;
  if (!options.skipHead) {
    const headSegs = THREE.MathUtils.clamp(Math.round(options.openingWidth * 12), 10, 32);
    const uStart = options.openingCenter - uHalf;
    const uEnd = options.openingCenter + uHalf;
    const expectedHeadDir = inwardVec.clone().add(new THREE.Vector3(0, -1, 0));
    head = buildSweepMesh(
      `${namePrefix}.revealHead`,
      headSegs,
      (t, k, yProf, dProf) => {
        const uOpening = THREE.MathUtils.lerp(uStart, uEnd, t);
        const endTaper = Math.sin(Math.PI * t);
        const waveY = (smoothNoise1D(t * 5.0, seedNum + 307) - 0.5) * 2 * waveAmp * endTaper;
        const depthTaper = k === 0 || k === pCount - 1 ? 0.35 : 1.0;
        const y = options.topY - (yProf + waveY * depthTaper);
        return toWorld(uOpening, y, dProf);
      },
      expectedHeadDir,
      options.openingWidth
    );
    meshes.push(head);
  }

  let sill: THREE.Mesh | undefined;
  if (options.includeSill) {
    const sillSegs = THREE.MathUtils.clamp(Math.round(options.openingWidth * 12), 10, 32);
    const uStart = options.openingCenter - uHalf;
    const uEnd = options.openingCenter + uHalf;
    const expectedSillDir = inwardVec.clone().add(new THREE.Vector3(0, 1, 0));
    sill = buildSweepMesh(
      `${namePrefix}.revealSill`,
      sillSegs,
      (t, k, yProf, dProf) => {
        const uOpening = THREE.MathUtils.lerp(uStart, uEnd, t);
        const endTaper = Math.sin(Math.PI * t);
        const waveY = (smoothNoise1D(t * 4.8, seedNum + 409) - 0.5) * 2 * waveAmp * endTaper;
        const depthTaper = k === 0 || k === pCount - 1 ? 0.35 : 1.0;
        const y = options.botY + (yProf + waveY * depthTaper);
        return toWorld(uOpening, y, dProf);
      },
      expectedSillDir,
      options.openingWidth
    );
    meshes.push(sill);
  }

  return {
    jambLeft,
    jambRight,
    ...(head ? { head } : {}),
    ...(sill ? { sill } : {}),
    meshes,
  };
}
