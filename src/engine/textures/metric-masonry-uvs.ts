import * as THREE from 'three';

/**
 * True 1:1 UK metric brick & masonry repeat constants matching `createBrickTextures('heritage-red-flemish')`
 * (`16` courses per vertical repeat -> `16 * 0.075 m = 1.20 m`, i.e. exact `75 mm` course height;
 *  `4` Flemish stretcher+header units per horizontal repeat -> `4 * 0.3375 m = 1.35 m`, i.e. `225 mm` stretcher pitch).
 */
export const UK_BRICK_TILE_W_M = 1.35;
export const UK_BRICK_TILE_H_M = 1.2;

/** Coursed Northamptonshire / Cotswold ironstone repeat (`14` courses * `75 mm` = `1.05 m`). */
export const IRONSTONE_WALL_TILE_W_M = 1.44;
export const IRONSTONE_WALL_TILE_H_M = 1.05;

/** Monolithic sawn buff Yorkstone coping & counter grain tile (`1.15 m x 1.15 m`). */
export const YORKSTONE_COPING_TILE_M = 1.15;

export interface MetricUvOptions {
  readonly tileW: number;
  readonly tileH?: number;
  readonly topTileV?: number;
  readonly ox?: number;
  readonly oy?: number;
  readonly oz?: number;
  readonly rotY?: number;
}

export interface MetricCylinderUvOptions extends MetricUvOptions {
  readonly radius: number;
}

/**
 * Unified metric UV options accepted by `applyMetricMasonryUVs`, supporting either explicit
 * `{ tileW, tileH }` or `{ tileSizeM: [tileW, tileH] }` directly from a `ProceduralPbrMapBundle`,
 * plus optional `radius` for cylindrical drums/bullnoses.
 */
export interface MetricMasonryUvOptions {
  readonly tileW?: number;
  readonly tileH?: number;
  readonly tileSizeM?: readonly [number, number];
  readonly topTileV?: number;
  readonly ox?: number;
  readonly oy?: number;
  readonly oz?: number;
  readonly rotY?: number;
  readonly radius?: number;
}

export interface TerrainFollowingWallStation {
  readonly x: number;
  readonly z: number;
  readonly botY: number;
  readonly topY: number;
  readonly arcDist: number;
}

/**
 * Deterministic world-scale metric UV generator for `THREE.BoxGeometry` (and box-like buffers).
 * - Vertical faces (`|ny| < 0.5`): `u = dot(worldPos, faceHorizontalTangent) / tileW`, `v = worldPos.y / tileH`
 *   so mortar courses stay strictly horizontal at `1:1` metric height (`75 mm` per brick course) even on rotated
 *   or 45-degree chamfered masonry blocks, and `40-55 mm` stone coping edges never smear `[0..1]` UVs.
 * - Horizontal top/bottom faces (`|ny| >= 0.5`): uniform metric `(u, v)` in world/tangent metres.
 */
export function applyMetricBoxUVs<T extends THREE.BufferGeometry>(
  geo: T,
  opts: MetricUvOptions
): T {
  const pos = geo.attributes.position;
  const norm = geo.attributes.normal;
  const uv = geo.attributes.uv;
  if (!pos || !norm || !uv) return geo;

  const tileW = opts.tileW;
  const tileH = opts.tileH ?? opts.tileW;
  const topTileV = opts.topTileV ?? opts.tileW;
  const ox = opts.ox ?? 0;
  const oy = opts.oy ?? 0;
  const oz = opts.oz ?? 0;
  const rotY = opts.rotY ?? 0;
  const cosY = Math.cos(rotY);
  const sinY = Math.sin(rotY);

  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i);
    const ly = pos.getY(i);
    const lz = pos.getZ(i);

    const wx = lx * cosY + lz * sinY + ox;
    const wy = ly + oy;
    const wz = -lx * sinY + lz * cosY + oz;

    const lnx = norm.getX(i);
    const lny = norm.getY(i);
    const lnz = norm.getZ(i);
    const wnx = lnx * cosY + lnz * sinY;
    const wny = lny;
    const wnz = -lnx * sinY + lnz * cosY;

    if (Math.abs(wny) < 0.5) {
      const hLen = Math.hypot(wnx, wnz);
      const tx = hLen > 1e-5 ? -wnz / hLen : 1;
      const tz = hLen > 1e-5 ? wnx / hLen : 0;
      const arcU = wx * tx + wz * tz;
      uv.setXY(i, arcU / tileW, wy / tileH);
    } else {
      const metricX = lx + ox * cosY - oz * sinY;
      const metricZ = lz + ox * sinY + oz * cosY;
      uv.setXY(i, metricX / tileW, metricZ / topTileV);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

/**
 * Deterministic world-scale metric UV generator for `THREE.CylinderGeometry` (curved brick drums
 * and bullnose Yorkstone counter/planter caps).
 * Scales circumferential U by exact `2 * Math.PI * radius / tileW` and vertical V by `worldY / tileH`
 * so curved brick plinths match adjacent straight brick runs at exact `225 x 75 mm` UK brick scale.
 */
export function applyMetricCylinderUVs<T extends THREE.BufferGeometry>(
  geo: T,
  opts: MetricCylinderUvOptions
): T {
  const pos = geo.attributes.position;
  const norm = geo.attributes.normal;
  const uv = geo.attributes.uv;
  if (!pos || !norm || !uv) return geo;

  const tileW = opts.tileW;
  const tileH = opts.tileH ?? opts.tileW;
  const topTileV = opts.topTileV ?? opts.tileW;
  const ox = opts.ox ?? 0;
  const oy = opts.oy ?? 0;
  const oz = opts.oz ?? 0;
  const circumferenceM = 2 * Math.PI * Math.max(0.01, opts.radius);

  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i);
    const ly = pos.getY(i);
    const lz = pos.getZ(i);
    const ny = norm.getY(i);

    if (Math.abs(ny) < 0.5) {
      const rawU = uv.getX(i);
      uv.setXY(i, (rawU * circumferenceM) / tileW, (ly + oy) / tileH);
    } else {
      uv.setXY(i, (lx + ox) / tileW, (lz + oz) / topTileV);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

/**
 * Deterministic world-scale metric UV generator for `THREE.ExtrudeGeometry` and custom sculpted
 * masonry/coping `BufferGeometry` meshes.
 */
export function applyMetricExtrudeUVs<T extends THREE.BufferGeometry>(
  geo: T,
  opts: MetricUvOptions
): T {
  if (!geo.attributes.normal) {
    geo.computeVertexNormals();
  }
  const pos = geo.attributes.position;
  const norm = geo.attributes.normal;
  if (!pos || !norm) return geo;

  let uv = geo.attributes.uv as THREE.BufferAttribute | undefined;
  if (!uv || uv.count !== pos.count) {
    uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
    geo.setAttribute('uv', uv);
  }

  return applyMetricBoxUVs(geo, opts);
}

/**
 * General-purpose metric masonry UV helper for `BoxGeometry`, `CylinderGeometry`, `ExtrudeGeometry`,
 * or custom `BufferGeometry` meshes. Defaults to standard UK brickwork (`1.35 m x 1.20 m`) when
 * neither `tileW` nor `tileSizeM` is specified.
 */
export function applyMetricMasonryUVs<T extends THREE.BufferGeometry>(
  geo: T,
  opts: MetricMasonryUvOptions = {}
): T {
  const tileW = opts.tileW ?? opts.tileSizeM?.[0] ?? UK_BRICK_TILE_W_M;
  const tileH = opts.tileH ?? opts.tileSizeM?.[1] ?? opts.tileW ?? UK_BRICK_TILE_H_M;
  const topTileV = opts.topTileV ?? opts.tileSizeM?.[1] ?? tileW;

  if (opts.radius !== undefined || geo instanceof THREE.CylinderGeometry) {
    const cylParams = (geo as unknown as { parameters?: { radiusTop?: number; radiusBottom?: number } }).parameters;
    const radius =
      opts.radius ??
      Math.max(0.01, ((cylParams?.radiusTop ?? 0.5) + (cylParams?.radiusBottom ?? 0.5)) * 0.5);
    return applyMetricCylinderUVs(geo, {
      tileW,
      tileH,
      topTileV,
      ox: opts.ox,
      oy: opts.oy,
      oz: opts.oz,
      rotY: opts.rotY,
      radius,
    });
  }

  return applyMetricExtrudeUVs(geo, {
    tileW,
    tileH,
    topTileV,
    ox: opts.ox,
    oy: opts.oy,
    oz: opts.oz,
    rotY: opts.rotY,
  });
}

/**
 * Builds a watertight, terrain-following coursed masonry wall section (or overhanging stone coping
 * ribbon) from sampled `(x, z, botY, topY, arcDist)` stations with true `1:1` horizontal world-space
 * mortar courses (`u = arcDist / tileW`, `v = wy / tileH`) on both vertical faces and end caps.
 */
export function buildMetricWallRibbonGeo(
  stations: ReadonlyArray<TerrainFollowingWallStation>,
  halfThickness: number,
  tileW: number,
  tileH: number,
  capStart: boolean,
  capEnd: boolean
): THREE.BufferGeometry {
  const n = stations.length;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  const nxArr = new Float64Array(n);
  const nzArr = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const pPrev = stations[Math.max(0, i - 1)]!;
    const pNext = stations[Math.min(n - 1, i + 1)]!;
    const dx = pNext.x - pPrev.x;
    const dz = pNext.z - pPrev.z;
    const len = Math.hypot(dx, dz) || 1;
    nxArr[i] = dz / len;
    nzArr[i] = -dx / len;
  }

  const pushQuad = (
    ax: number, ay: number, az: number, au: number, av: number,
    bx: number, by: number, bz: number, bu: number, bv: number,
    cx: number, cy: number, cz: number, cu: number, cv: number,
    dx: number, dy: number, dz: number, du: number, dv: number,
    fnx: number, fny: number, fnz: number
  ) => {
    positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    positions.push(ax, ay, az, cx, cy, cz, dx, dy, dz);
    for (let k = 0; k < 6; k++) {
      normals.push(fnx, fny, fnz);
    }
    uvs.push(au, av, bu, bv, cu, cv);
    uvs.push(au, av, cu, cv, du, dv);
  };

  for (let i = 0; i < n - 1; i++) {
    const s0 = stations[i]!;
    const s1 = stations[i + 1]!;
    const n0x = nxArr[i]!;
    const n0z = nzArr[i]!;
    const n1x = nxArr[i + 1]!;
    const n1z = nzArr[i + 1]!;

    const x0N = s0.x + n0x * halfThickness;
    const z0N = s0.z + n0z * halfThickness;
    const x1N = s1.x + n1x * halfThickness;
    const z1N = s1.z + n1z * halfThickness;

    const x0S = s0.x - n0x * halfThickness;
    const z0S = s0.z - n0z * halfThickness;
    const x1S = s1.x - n1x * halfThickness;
    const z1S = s1.z - n1z * halfThickness;

    const segDx = s1.x - s0.x;
    const segDz = s1.z - s0.z;
    const segLen = Math.hypot(segDx, segDz) || 1;
    const faceNx = segDz / segLen;
    const faceNz = -segDx / segLen;

    const u0 = s0.arcDist / tileW;
    const u1 = s1.arcDist / tileW;

    pushQuad(
      x1N, s1.botY, z1N, u1, s1.botY / tileH,
      x0N, s0.botY, z0N, u0, s0.botY / tileH,
      x0N, s0.topY, z0N, u0, s0.topY / tileH,
      x1N, s1.topY, z1N, u1, s1.topY / tileH,
      faceNx, 0, faceNz
    );

    pushQuad(
      x0S, s0.botY, z0S, u0, s0.botY / tileH,
      x1S, s1.botY, z1S, u1, s1.botY / tileH,
      x1S, s1.topY, z1S, u1, s1.topY / tileH,
      x0S, s0.topY, z0S, u0, s0.topY / tileH,
      -faceNx, 0, -faceNz
    );

    const vN = -halfThickness / tileW;
    const vS = halfThickness / tileW;
    pushQuad(
      x0S, s0.topY, z0S, u0, vS,
      x1S, s1.topY, z1S, u1, vS,
      x1N, s1.topY, z1N, u1, vN,
      x0N, s0.topY, z0N, u0, vN,
      0, 1, 0
    );

    pushQuad(
      x0N, s0.botY, z0N, u0, vN,
      x1N, s1.botY, z1N, u1, vN,
      x1S, s1.botY, z1S, u1, vS,
      x0S, s0.botY, z0S, u0, vS,
      0, -1, 0
    );
  }

  if (capStart && n >= 2) {
    const s0 = stations[0]!;
    const s1 = stations[1]!;
    const n0x = nxArr[0]!;
    const n0z = nzArr[0]!;
    const segLen = Math.hypot(s1.x - s0.x, s1.z - s0.z) || 1;
    const endNx = -(s1.x - s0.x) / segLen;
    const endNz = -(s1.z - s0.z) / segLen;
    const xN = s0.x + n0x * halfThickness;
    const zN = s0.z + n0z * halfThickness;
    const xS = s0.x - n0x * halfThickness;
    const zS = s0.z - n0z * halfThickness;
    const uSpan = (halfThickness * 2) / tileW;
    pushQuad(
      xN, s0.botY, zN, 0, s0.botY / tileH,
      xS, s0.botY, zS, uSpan, s0.botY / tileH,
      xS, s0.topY, zS, uSpan, s0.topY / tileH,
      xN, s0.topY, zN, 0, s0.topY / tileH,
      endNx, 0, endNz
    );
  }

  if (capEnd && n >= 2) {
    const sLast = stations[n - 1]!;
    const sPrev = stations[n - 2]!;
    const nLx = nxArr[n - 1]!;
    const nLz = nzArr[n - 1]!;
    const segLen = Math.hypot(sLast.x - sPrev.x, sLast.z - sPrev.z) || 1;
    const endNx = (sLast.x - sPrev.x) / segLen;
    const endNz = (sLast.z - sPrev.z) / segLen;
    const xN = sLast.x + nLx * halfThickness;
    const zN = sLast.z + nLz * halfThickness;
    const xS = sLast.x - nLx * halfThickness;
    const zS = sLast.z - nLz * halfThickness;
    const uSpan = (halfThickness * 2) / tileW;
    pushQuad(
      xS, sLast.botY, zS, 0, sLast.botY / tileH,
      xN, sLast.botY, zN, uSpan, sLast.botY / tileH,
      xN, sLast.topY, zN, uSpan, sLast.topY / tileH,
      xS, sLast.topY, zS, 0, sLast.topY / tileH,
      endNx, 0, endNz
    );
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}
