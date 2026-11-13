import type { CutawayWallDescriptor } from '../types/scene.ts';
import type { RoomBoundingBox } from '../types/topology.ts';

export interface Frame2DParams {
  readonly originX: number;
  readonly originZ: number;
  readonly rotationY: number;
  readonly elevationY?: number;
}

/**
 * Analytical 2D half-plane in `(X, Z)` coordinates.
 *
 * Sign convention: points `(x, z)` satisfying `nx * x + nz * z + constant >= 0`
 * lie inside / on the kept half-space (matching `THREE.Plane.distanceToPoint(p) >= 0`
 * and `HalfPlane2D` in `src/engine/geometry/cad-primitives.ts`).
 */
export interface Plane2D {
  readonly nx: number;
  readonly nz: number;
  readonly constant: number;
}

/**
 * Oriented 2D bounding box in world `(X, Z)` coordinates.
 */
export interface OrientedBox2D {
  readonly center: [number, number];
  readonly halfExtents: [number, number];
  readonly axisU: [number, number];
  readonly axisV: [number, number];
  readonly rotationY: number;
}

/**
 * Analytical world-space representation of a `CutawayWallDescriptor` transformed
 * through a `Frame2D` (preserving exact normal and span endpoints for arbitrary angles).
 */
export interface WorldCutawayWallPlane2D {
  readonly plane: Plane2D;
  readonly startXZ: [number, number];
  readonly endXZ: [number, number];
  readonly outwardNormalXZ: [number, number];
  readonly floor: CutawayWallDescriptor['floor'];
  readonly includeInFirstFloorCutaway?: boolean;
}

/**
 * Right-handed `SE(2)` local coordinate frame in the horizontal `(X, Z)` plane (`+Y` up),
 * matching Three.js `Object3D` Y-rotation conventions (`rotation.y = rotationY`):
 *
 * - `wx = x * cos(rotationY) + z * sin(rotationY) + originX`
 * - `wy = y + elevationY`
 * - `wz = -x * sin(rotationY) + z * cos(rotationY) + originZ`
 *
 * Pure mathematical primitive in `src/core/geo` with zero renderer dependencies.
 */
export class Frame2D {
  public readonly originX: number;
  public readonly originZ: number;
  public readonly elevationY: number;
  public readonly rotationY: number;
  public readonly cos: number;
  public readonly sin: number;

  public constructor(params: Frame2DParams) {
    this.originX = params.originX;
    this.originZ = params.originZ;
    this.elevationY = params.elevationY ?? 0;
    this.rotationY = params.rotationY;
    this.cos = Math.cos(params.rotationY);
    this.sin = Math.sin(params.rotationY);
  }

  /** Identity world frame at `(0, 0, 0)` with `rotationY = 0`. */
  public static identity(): Frame2D {
    return new Frame2D({ originX: 0, originZ: 0, rotationY: 0, elevationY: 0 });
  }

  /** Creates a `Frame2D` from world origin `(originX, originZ)`, `rotationY`, and optional `elevationY`. */
  public static fromOriginAndAngle(
    originX: number,
    originZ: number,
    rotationY: number,
    elevationY = 0
  ): Frame2D {
    return new Frame2D({ originX, originZ, rotationY, elevationY });
  }

  /**
   * Creates a `Frame2D` rotated by `rotationY` and translated so that local point
   * `(localX, localZ)` lands at exact world coordinates `(worldX, worldZ)`.
   */
  public static fromAnchor(
    localX: number,
    localZ: number,
    worldX: number,
    worldZ: number,
    rotationY: number,
    elevationY = 0
  ): Frame2D {
    const cos = Math.cos(rotationY);
    const sin = Math.sin(rotationY);
    const originX = worldX - (localX * cos + localZ * sin);
    const originZ = worldZ - (-localX * sin + localZ * cos);
    return new Frame2D({ originX, originZ, rotationY, elevationY });
  }

  /** Transforms local `(x, z)` to world `[wx, wz]`. */
  public toWorldXZ(x: number, z: number): [number, number] {
    return [
      x * this.cos + z * this.sin + this.originX,
      -x * this.sin + z * this.cos + this.originZ,
    ];
  }

  /** Transforms world `(wx, wz)` to local `[x, z]`. */
  public toLocalXZ(wx: number, wz: number): [number, number] {
    const dx = wx - this.originX;
    const dz = wz - this.originZ;
    return [dx * this.cos - dz * this.sin, dx * this.sin + dz * this.cos];
  }

  /** Transforms local `(x, y, z)` to world `[wx, wy, wz]`. */
  public toWorldTuple3(x: number, y: number, z: number): [number, number, number] {
    return [
      x * this.cos + z * this.sin + this.originX,
      y + this.elevationY,
      -x * this.sin + z * this.cos + this.originZ,
    ];
  }

  /** Transforms world `(wx, wy, wz)` to local `[x, y, z]`. */
  public toLocalTuple3(wx: number, wy: number, wz: number): [number, number, number] {
    const dx = wx - this.originX;
    const dz = wz - this.originZ;
    return [
      dx * this.cos - dz * this.sin,
      wy - this.elevationY,
      dx * this.sin + dz * this.cos,
    ];
  }

  /** Rotates a local 2D direction/displacement `(vx, vz)` into world `[wx, wz]`. */
  public vectorToWorldXZ(vx: number, vz: number): [number, number] {
    return [vx * this.cos + vz * this.sin, -vx * this.sin + vz * this.cos];
  }

  /** Rotates a world 2D direction/displacement `(wx, wz)` into local `[vx, vz]`. */
  public vectorToLocalXZ(wx: number, wz: number): [number, number] {
    return [wx * this.cos - wz * this.sin, wx * this.sin + wz * this.cos];
  }

  /** Rotates a local 3D vector `(vx, vy, vz)` into world `[wx, wy, wz]`. */
  public vectorToWorldTuple3(vx: number, vy: number, vz: number): [number, number, number] {
    return [vx * this.cos + vz * this.sin, vy, -vx * this.sin + vz * this.cos];
  }

  /** Rotates a world 3D vector `(wx, wy, wz)` into local `[vx, vy, vz]`. */
  public vectorToLocalTuple3(wx: number, wy: number, wz: number): [number, number, number] {
    return [wx * this.cos - wz * this.sin, wy, wx * this.sin + wz * this.cos];
  }

  /** Converts a local Y-rotation angle (radians) to world Y-rotation angle. */
  public angleToWorldY(localRotY: number): number {
    return this.rotationY + localRotY;
  }

  /** Converts a world Y-rotation angle (radians) to local Y-rotation angle. */
  public angleToLocalY(worldRotY: number): number {
    return worldRotY - this.rotationY;
  }

  /**
   * Transforms a local half-plane `nx * x + nz * z + constant >= 0` into world `(X, Z)`
   * preserving signed Euclidean distance:
   * `worldPlane.nx * wx + worldPlane.nz * wz + worldPlane.constant === localPlane.nx * x + localPlane.nz * z + localPlane.constant`.
   */
  public planeToWorld(localPlane: Plane2D): Plane2D {
    const [nx, nz] = this.vectorToWorldXZ(localPlane.nx, localPlane.nz);
    const constant = localPlane.constant - (nx * this.originX + nz * this.originZ);
    return { nx, nz, constant };
  }

  /**
   * Transforms a world half-plane `nx * wx + nz * wz + constant >= 0` into local `(X, Z)`
   * preserving signed Euclidean distance.
   */
  public planeToLocal(worldPlane: Plane2D): Plane2D {
    const [nx, nz] = this.vectorToLocalXZ(worldPlane.nx, worldPlane.nz);
    const constant =
      worldPlane.constant + worldPlane.nx * this.originX + worldPlane.nz * this.originZ;
    return { nx, nz, constant };
  }

  /**
   * Converts a local `CutawayWallDescriptor` into an exact analytical world-space half-plane
   * and world segment endpoints (`nx * wx + nz * wz + constant >= 0` on the outward camera side).
   */
  public cutawayWallToWorldPlane(desc: CutawayWallDescriptor): WorldCutawayWallPlane2D {
    const startLocal: [number, number] =
      desc.axis === 'z' ? [desc.minSpan, desc.coord] : [desc.coord, desc.minSpan];
    const endLocal: [number, number] =
      desc.axis === 'z' ? [desc.maxSpan, desc.coord] : [desc.coord, desc.maxSpan];

    let localNx = 0;
    let localNz = 0;
    if (desc.outwardSide === 'north') {
      localNz = -1;
    } else if (desc.outwardSide === 'south') {
      localNz = 1;
    } else if (desc.outwardSide === 'east') {
      localNx = 1;
    } else if (desc.outwardSide === 'west') {
      localNx = -1;
    } else if (desc.axis === 'z') {
      localNz = 1;
    } else {
      localNx = 1;
    }

    const localConstant = -(localNx * startLocal[0] + localNz * startLocal[1]);
    const plane = this.planeToWorld({ nx: localNx, nz: localNz, constant: localConstant });
    const outwardNormalXZ = this.vectorToWorldXZ(localNx, localNz);
    return {
      plane,
      startXZ: this.toWorldXZ(startLocal[0], startLocal[1]),
      endXZ: this.toWorldXZ(endLocal[0], endLocal[1]),
      outwardNormalXZ,
      floor: desc.floor,
      ...(desc.includeInFirstFloorCutaway !== undefined
        ? { includeInFirstFloorCutaway: desc.includeInFirstFloorCutaway }
        : {}),
    };
  }

  /**
   * Transforms a local `CutawayWallDescriptor` into the dominant world-axis `CutawayWallDescriptor`.
   */
  public transformCutawayWall(desc: CutawayWallDescriptor): CutawayWallDescriptor {
    const startLocal: [number, number] =
      desc.axis === 'z' ? [desc.minSpan, desc.coord] : [desc.coord, desc.minSpan];
    const endLocal: [number, number] =
      desc.axis === 'z' ? [desc.maxSpan, desc.coord] : [desc.coord, desc.maxSpan];

    const [wx0, wz0] = this.toWorldXZ(startLocal[0], startLocal[1]);
    const [wx1, wz1] = this.toWorldXZ(endLocal[0], endLocal[1]);

    const localAxisNormal: [number, number] = desc.axis === 'z' ? [0, 1] : [1, 0];
    const [wnx, wnz] = this.vectorToWorldXZ(localAxisNormal[0], localAxisNormal[1]);
    const worldAxis: 'x' | 'z' = Math.abs(wnx) > Math.abs(wnz) ? 'x' : 'z';

    const coord = worldAxis === 'z' ? (wz0 + wz1) * 0.5 : (wx0 + wx1) * 0.5;
    const s0 = worldAxis === 'z' ? wx0 : wz0;
    const s1 = worldAxis === 'z' ? wx1 : wz1;
    const minSpan = Math.min(s0, s1);
    const maxSpan = Math.max(s0, s1);

    let outwardSide: CutawayWallDescriptor['outwardSide'];
    if (desc.outwardSide) {
      const sideVec: [number, number] =
        desc.outwardSide === 'north'
          ? [0, -1]
          : desc.outwardSide === 'south'
            ? [0, 1]
            : desc.outwardSide === 'east'
              ? [1, 0]
              : [-1, 0];
      const [ox, oz] = this.vectorToWorldXZ(sideVec[0], sideVec[1]);
      if (Math.abs(ox) > Math.abs(oz)) {
        outwardSide = ox >= 0 ? 'east' : 'west';
      } else {
        outwardSide = oz >= 0 ? 'south' : 'north';
      }
    }

    return {
      axis: worldAxis,
      coord,
      minSpan,
      maxSpan,
      floor: desc.floor,
      ...(outwardSide !== undefined ? { outwardSide } : {}),
      ...(desc.includeInFirstFloorCutaway !== undefined
        ? { includeInFirstFloorCutaway: desc.includeInFirstFloorCutaway }
        : {}),
    };
  }

  /**
   * Computes the world-space AABB enclosing a local `CutawayWallDescriptor`
   * (with optional `minY`, `maxY`, and `halfThickness` around `coord`).
   */
  public cutawayDescriptorToWorldAabb(
    desc: CutawayWallDescriptor,
    minY = 0,
    maxY = 3,
    halfThickness = 0
  ): RoomBoundingBox {
    const minX = desc.axis === 'z' ? desc.minSpan : desc.coord - halfThickness;
    const maxX = desc.axis === 'z' ? desc.maxSpan : desc.coord + halfThickness;
    const minZ = desc.axis === 'z' ? desc.coord - halfThickness : desc.minSpan;
    const maxZ = desc.axis === 'z' ? desc.coord + halfThickness : desc.maxSpan;
    return this.boundsToWorldAabb({ minX, maxX, minY, maxY, minZ, maxZ });
  }

  /**
   * Transforms a local axis-aligned rectangle `[minX, maxX] x [minZ, maxZ]` into
   * its 4 world-space corners `[[x0, z0], [x1, z1], [x2, z2], [x3, z3]]`
   * ordered `(minX, minZ) -> (maxX, minZ) -> (maxX, maxZ) -> (minX, maxZ)`.
   */
  public rectToWorldPolygon(
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number
  ): [[number, number], [number, number], [number, number], [number, number]] {
    return [
      this.toWorldXZ(minX, minZ),
      this.toWorldXZ(maxX, minZ),
      this.toWorldXZ(maxX, maxZ),
      this.toWorldXZ(minX, maxZ),
    ];
  }

  /**
   * Computes the world-space axis-aligned bounding box of a local `RoomBoundingBox`.
   * When `roundMm` is `true`, horizontal bounds are rounded to millimetres (`1e-3`).
   */
  public boundsToWorldAabb(bounds: RoomBoundingBox, roundMm = false): RoomBoundingBox {
    const corners = this.rectToWorldPolygon(bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ);
    const c0 = corners[0];
    const c1 = corners[1];
    const c2 = corners[2];
    const c3 = corners[3];
    const rawMinX = Math.min(c0[0], c1[0], c2[0], c3[0]);
    const rawMaxX = Math.max(c0[0], c1[0], c2[0], c3[0]);
    const rawMinZ = Math.min(c0[1], c1[1], c2[1], c3[1]);
    const rawMaxZ = Math.max(c0[1], c1[1], c2[1], c3[1]);
    const round = (v: number): number => Math.round(v * 1000) / 1000;
    return {
      minX: roundMm ? round(rawMinX) : rawMinX,
      maxX: roundMm ? round(rawMaxX) : rawMaxX,
      minY: bounds.minY + this.elevationY,
      maxY: bounds.maxY + this.elevationY,
      minZ: roundMm ? round(rawMinZ) : rawMinZ,
      maxZ: roundMm ? round(rawMaxZ) : rawMaxZ,
    };
  }

  /** Converts a local rectangle `[minX, maxX] x [minZ, maxZ]` into a world `OrientedBox2D`. */
  public toOrientedBox2D(
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number
  ): OrientedBox2D {
    return {
      center: this.toWorldXZ((minX + maxX) * 0.5, (minZ + maxZ) * 0.5),
      halfExtents: [(maxX - minX) * 0.5, (maxZ - minZ) * 0.5],
      axisU: this.vectorToWorldXZ(1, 0),
      axisV: this.vectorToWorldXZ(0, 1),
      rotationY: this.rotationY,
    };
  }

  /**
   * Tests whether world point `(wx, wz)` lies inside local box `[minX, maxX] x [minZ, maxZ]`
   * expanded by optional `margin` (metres, default `0`).
   */
  public containsWorldPointXZ(
    wx: number,
    wz: number,
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
    margin = 0
  ): boolean {
    const [lx, lz] = this.toLocalXZ(wx, wz);
    return (
      lx >= minX - margin &&
      lx <= maxX + margin &&
      lz >= minZ - margin &&
      lz <= maxZ + margin
    );
  }

  /**
   * Exact Euclidean signed distance (metres) from world point `(wx, wz)` to the boundary
   * of local box `[minX, maxX] x [minZ, maxZ]` (negative inside, `0` on boundary, positive outside).
   */
  public signedDistanceToBoxXZ(
    wx: number,
    wz: number,
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number
  ): number {
    const [lx, lz] = this.toLocalXZ(wx, wz);
    const cx = (minX + maxX) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    const hx = (maxX - minX) * 0.5;
    const hz = (maxZ - minZ) * 0.5;
    const qx = Math.abs(lx - cx) - hx;
    const qz = Math.abs(lz - cz) - hz;
    const outsideDist = Math.hypot(Math.max(qx, 0), Math.max(qz, 0));
    const insideDist = Math.min(Math.max(qx, qz), 0);
    return outsideDist + insideDist;
  }

  /** Returns the exact `SE(2) x R` inverse frame mapping world coordinates back to local coordinates. */
  public inverse(): Frame2D {
    const [originX, originZ] = this.toLocalXZ(0, 0);
    return new Frame2D({
      originX,
      originZ,
      rotationY: -this.rotationY,
      elevationY: -this.elevationY,
    });
  }

  /**
   * Composes `this` (parent -> world) with `child` (child -> parent), returning
   * the combined frame `child -> world` such that
   * `this.compose(child).toWorldTuple3(x, y, z)` equals `this.toWorldTuple3(...child.toWorldTuple3(x, y, z))`.
   */
  public compose(child: Frame2D): Frame2D {
    const [originX, elevationY, originZ] = this.toWorldTuple3(
      child.originX,
      child.elevationY,
      child.originZ
    );
    return new Frame2D({
      originX,
      originZ,
      rotationY: this.rotationY + child.rotationY,
      elevationY,
    });
  }
}
