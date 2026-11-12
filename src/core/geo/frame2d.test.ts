import { describe, expect, it } from 'vitest';
import type { CutawayWallDescriptor } from '../types/scene.ts';
import type { RoomBoundingBox } from '../types/topology.ts';
import { Frame2D, type Plane2D } from './frame2d.ts';

describe('Frame2D', () => {
  it('supports identity, fromOriginAndAngle, and point/vector/angle round-trips', () => {
    const id = Frame2D.identity();
    expect(id.toWorldXZ(3.5, -2.25)).toEqual([3.5, -2.25]);
    expect(id.toLocalXZ(3.5, -2.25)).toEqual([3.5, -2.25]);
    expect(id.toWorldTuple3(1, 2, 3)).toEqual([1, 2, 3]);

    const frame = Frame2D.fromOriginAndAngle(12.4, -7.8, 0.42, 1.35);
    const samples: readonly [number, number, number][] = [
      [0, 0, 0],
      [4.2, 1.8, -3.1],
      [-11.5, -0.4, 8.75],
      [0.001, 2.95, -0.002],
    ];

    for (const [lx, ly, lz] of samples) {
      const [wx, wy, wz] = frame.toWorldTuple3(lx, ly, lz);
      const [rx, ry, rz] = frame.toLocalTuple3(wx, wy, wz);
      expect(rx).toBeCloseTo(lx, 12);
      expect(ry).toBeCloseTo(ly, 12);
      expect(rz).toBeCloseTo(lz, 12);

      const [wx2, wz2] = frame.toWorldXZ(lx, lz);
      expect(wx2).toBe(wx);
      expect(wz2).toBe(wz);
      const [rlx, rlz] = frame.toLocalXZ(wx2, wz2);
      expect(rlx).toBeCloseTo(lx, 12);
      expect(rlz).toBeCloseTo(lz, 12);
    }

    // Vector transforms are translation-free and preserve Euclidean length
    const [vxW, vzW] = frame.vectorToWorldXZ(3, 4);
    expect(Math.hypot(vxW, vzW)).toBeCloseTo(5, 12);
    const [vxL, vzL] = frame.vectorToLocalXZ(vxW, vzW);
    expect(vxL).toBeCloseTo(3, 12);
    expect(vzL).toBeCloseTo(4, 12);

    const [v3x, v3y, v3z] = frame.vectorToWorldTuple3(3, 2.5, 4);
    expect(v3y).toBe(2.5);
    const [rv3x, rv3y, rv3z] = frame.vectorToLocalTuple3(v3x, v3y, v3z);
    expect(rv3x).toBeCloseTo(3, 12);
    expect(rv3y).toBe(2.5);
    expect(rv3z).toBeCloseTo(4, 12);

    // Angle transforms round-trip
    const worldAngle = frame.angleToWorldY(-0.75);
    expect(worldAngle).toBeCloseTo(0.42 - 0.75, 12);
    expect(frame.angleToLocalY(worldAngle)).toBeCloseTo(-0.75, 12);
  });

  it('matches surveyed angled East-West Wing and Outbuilding site frame coordinates', () => {
    const eastWingRotY = -Math.atan2(0.705, 5.27);
    const eastWing = Frame2D.fromAnchor(-16.92, 2.54, -16.92, 2.61, eastWingRotY);

    // Anchor invariant: local (-16.92, 2.54) lands at exact world (-16.92, 2.61)
    const [anchorWx, anchorWz] = eastWing.toWorldXZ(-16.92, 2.54);
    expect(anchorWx).toBeCloseTo(-16.92, 13);
    expect(anchorWz).toBeCloseTo(2.61, 13);

    // Exact IEEE-754 bit-identity against historical East-Wing formula
    const cos = Math.cos(eastWingRotY);
    const sin = Math.sin(eastWingRotY);
    const legacyOffsetX = -16.92 - (-16.92 * cos + 2.54 * sin);
    const legacyOffsetZ = 2.61 - (16.92 * sin + 2.54 * cos);
    expect(Object.is(eastWing.originX, legacyOffsetX)).toBe(true);
    expect(Object.is(eastWing.originZ, legacyOffsetZ)).toBe(true);

    for (const [x, z] of [
      [-16.92, 2.68],
      [-11.65, 2.68],
      [-6.2, -3.4],
      [0, 0],
    ] as const) {
      const [wx, wz] = eastWing.toWorldXZ(x, z);
      expect(Object.is(wx, x * cos + z * sin + legacyOffsetX)).toBe(true);
      expect(Object.is(wz, -x * sin + z * cos + legacyOffsetZ)).toBe(true);
    }

    // Outbuilding site frame: origin (-22.47, 16.00), rotation +atan2(2.49, 28.98)
    const outbuildingRotY = Math.atan2(2.49, 28.98);
    const outbuilding = new Frame2D({
      originX: -22.47,
      originZ: 16.0,
      rotationY: outbuildingRotY,
    });
    expect(outbuilding.toWorldXZ(0, 0)).toEqual([-22.47, 16.0]);
    const [obEndX, obEndZ] = outbuilding.toWorldXZ(29.0867, 0);
    // North face drops southward (~+2.49m in +Z) across the ~29.09m range
    expect(obEndX).toBeCloseTo(-22.47 + 28.98, 2);
    expect(obEndZ).toBeCloseTo(16.0 - 2.49, 2);
  });

  it('preserves signed half-space distance under planeToWorld / planeToLocal and transforms CutawayWallDescriptors', () => {
    const frame = Frame2D.fromOriginAndAngle(-5.5, 9.2, -0.63);
    const localPlane: Plane2D = {
      nx: Math.cos(0.9),
      nz: Math.sin(0.9),
      constant: -2.35,
    };

    const worldPlane = frame.planeToWorld(localPlane);
    const roundTripPlane = frame.planeToLocal(worldPlane);
    expect(roundTripPlane.nx).toBeCloseTo(localPlane.nx, 12);
    expect(roundTripPlane.nz).toBeCloseTo(localPlane.nz, 12);
    expect(roundTripPlane.constant).toBeCloseTo(localPlane.constant, 12);

    for (const [lx, lz] of [
      [0, 0],
      [3.4, -1.2],
      [-4.8, 6.1],
    ] as const) {
      const [wx, wz] = frame.toWorldXZ(lx, lz);
      const dLocal = localPlane.nx * lx + localPlane.nz * lz + localPlane.constant;
      const dWorld = worldPlane.nx * wx + worldPlane.nz * wz + worldPlane.constant;
      expect(dWorld).toBeCloseTo(dLocal, 12);
    }

    const desc: CutawayWallDescriptor = {
      axis: 'z',
      coord: 2.68,
      minSpan: -16.92,
      maxSpan: -8.4,
      floor: 'ground',
      outwardSide: 'south',
      includeInFirstFloorCutaway: true,
    };
    const worldWallPlane = frame.cutawayWallToWorldPlane(desc);
    // Points on the wall segment lie on plane === 0
    const dStart =
      worldWallPlane.plane.nx * worldWallPlane.startXZ[0] +
      worldWallPlane.plane.nz * worldWallPlane.startXZ[1] +
      worldWallPlane.plane.constant;
    const dEnd =
      worldWallPlane.plane.nx * worldWallPlane.endXZ[0] +
      worldWallPlane.plane.nz * worldWallPlane.endXZ[1] +
      worldWallPlane.plane.constant;
    expect(dStart).toBeCloseTo(0, 12);
    expect(dEnd).toBeCloseTo(0, 12);

    // Point 1m outward (+Z in local frame for 'south') has signed distance +1m
    const [outWx, outWz] = frame.toWorldXZ(-12.0, 3.68);
    const dOutward =
      worldWallPlane.plane.nx * outWx +
      worldWallPlane.plane.nz * outWz +
      worldWallPlane.plane.constant;
    expect(dOutward).toBeCloseTo(1.0, 12);

    // 90-degree rotation maps a local Z-wall ('south' -> +Z) onto a world X-wall ('east' -> +X)
    const rot90 = Frame2D.fromOriginAndAngle(2, 4, Math.PI / 2);
    const transformedDesc = rot90.transformCutawayWall(desc);
    expect(transformedDesc.axis).toBe('x');
    expect(transformedDesc.outwardSide).toBe('east');
    expect(transformedDesc.includeInFirstFloorCutaway).toBe(true);

    const aabb = rot90.cutawayDescriptorToWorldAabb(desc, 0, 2.8, 0.15);
    expect(aabb.minY).toBe(0);
    expect(aabb.maxY).toBe(2.8);
    expect(aabb.maxX - aabb.minX).toBeCloseTo(0.3, 12);
  });

  it('computes OBBs, world AABBs, point containment, and exact Euclidean signed distance', () => {
    const frame = Frame2D.fromOriginAndAngle(10, -4, Math.PI / 6, 0.5);
    const minX = -2;
    const maxX = 4;
    const minZ = -1;
    const maxZ = 3;

    const poly = frame.rectToWorldPolygon(minX, maxX, minZ, maxZ);
    expect(poly).toHaveLength(4);
    // Signed shoelace area in (X, Z) equals rectangle area (6 * 4 = 24)
    let area2 = 0;
    for (let i = 0; i < 4; i++) {
      const [x0, z0] = poly[i]!;
      const [x1, z1] = poly[(i + 1) % 4]!;
      area2 += x0 * z1 - x1 * z0;
    }
    expect(Math.abs(area2) * 0.5).toBeCloseTo(24, 11);

    const obb = frame.toOrientedBox2D(minX, maxX, minZ, maxZ);
    expect(obb.halfExtents).toEqual([3, 2]);
    expect(obb.center[0]).toBeCloseTo(frame.toWorldXZ(1, 1)[0], 12);
    expect(obb.center[1]).toBeCloseTo(frame.toWorldXZ(1, 1)[1], 12);
    expect(
      obb.axisU[0] * obb.axisV[0] + obb.axisU[1] * obb.axisV[1]
    ).toBeCloseTo(0, 12);

    const localBounds: RoomBoundingBox = {
      minX,
      maxX,
      minY: 0,
      maxY: 2.7,
      minZ,
      maxZ,
    };
    const worldAabb = frame.boundsToWorldAabb(localBounds);
    expect(worldAabb.minY).toBeCloseTo(0.5, 12);
    expect(worldAabb.maxY).toBeCloseTo(3.2, 12);
    for (const [cx, cz] of poly) {
      expect(cx).toBeGreaterThanOrEqual(worldAabb.minX - 1e-12);
      expect(cx).toBeLessThanOrEqual(worldAabb.maxX + 1e-12);
      expect(cz).toBeGreaterThanOrEqual(worldAabb.minZ - 1e-12);
      expect(cz).toBeLessThanOrEqual(worldAabb.maxZ + 1e-12);
    }

    // Center (1, 1) -> inside by 2m to nearest Z edge
    const [cWx, cWz] = frame.toWorldXZ(1, 1);
    expect(frame.containsWorldPointXZ(cWx, cWz, minX, maxX, minZ, maxZ)).toBe(true);
    expect(frame.signedDistanceToBoxXZ(cWx, cWz, minX, maxX, minZ, maxZ)).toBeCloseTo(-2, 12);

    // Outside corner (4 + 3, 3 + 4) -> distance = hypot(3, 4) = 5
    const [outWx, outWz] = frame.toWorldXZ(7, 7);
    expect(frame.containsWorldPointXZ(outWx, outWz, minX, maxX, minZ, maxZ)).toBe(false);
    expect(frame.containsWorldPointXZ(outWx, outWz, minX, maxX, minZ, maxZ, 4.05)).toBe(true);
    expect(frame.signedDistanceToBoxXZ(outWx, outWz, minX, maxX, minZ, maxZ)).toBeCloseTo(5, 12);
  });

  it('forms an exact group under compose() and inverse()', () => {
    const parent = Frame2D.fromOriginAndAngle(-14.2, 6.8, -0.31, 0.25);
    const child = Frame2D.fromOriginAndAngle(3.7, -2.1, 0.84, 2.85);
    const composed = parent.compose(child);

    const [nestedX, nestedY, nestedZ] = child.toWorldTuple3(1.5, 0.9, -2.4);
    const [expectedX, expectedY, expectedZ] = parent.toWorldTuple3(nestedX, nestedY, nestedZ);
    const [actualX, actualY, actualZ] = composed.toWorldTuple3(1.5, 0.9, -2.4);

    expect(actualX).toBeCloseTo(expectedX, 12);
    expect(actualY).toBeCloseTo(expectedY, 12);
    expect(actualZ).toBeCloseTo(expectedZ, 12);

    const inv = composed.inverse();
    const idLeft = inv.compose(composed);
    const idRight = composed.compose(inv);
    expect(idLeft.originX).toBeCloseTo(0, 12);
    expect(idLeft.originZ).toBeCloseTo(0, 12);
    expect(idLeft.elevationY).toBeCloseTo(0, 12);
    expect(idLeft.rotationY).toBeCloseTo(0, 12);
    expect(idRight.originX).toBeCloseTo(0, 12);
    expect(idRight.originZ).toBeCloseTo(0, 12);
  });
});
