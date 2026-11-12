import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { CutawayWallDescriptor } from '../../core/types/scene.ts';
import {
  createMouldingPath,
  createSkirtingProfile,
  createSkirtingRun,
  mouldingPath,
  type SkirtingProfilePreset,
} from './skirting-run.ts';

describe('skirting-run', () => {
  const paintMat = new THREE.MeshStandardMaterial({ color: 0xf5f2eb });

  it('builds all 4 built-in architectural profiles seated flush at u=0, v=0 and omits hidden back/bottom faces by default', () => {
    const presets: readonly SkirtingProfilePreset[] = [
      'ogee',
      'torus',
      'lambs-tongue',
      'chamfered',
    ];

    for (const preset of presets) {
      const profile = createSkirtingProfile(preset, { height: 0.145, thickness: 0.018 });
      expect(profile.length).toBeGreaterThanOrEqual(5);

      const us = profile.map((p) => p.u);
      const vs = profile.map((p) => p.v);
      expect(Math.min(...us)).toBeCloseTo(0, 6);
      expect(Math.max(...us)).toBeCloseTo(0.018, 6);
      expect(Math.min(...vs)).toBeCloseTo(0, 6);
      expect(Math.max(...vs)).toBeCloseTo(0.145, 6);

      // Closed loop eliminates end-caps so only swept profile faces exist
      const closedPath = mouldingPath
        .startAt(0, 0, { roomSide: 'right' })
        .lineTo(2, 0)
        .lineTo(2, 2)
        .lineTo(0, 2)
        .close();

      const defaultRun = createSkirtingRun({
        path: closedPath,
        profile: preset,
        height: 0.145,
        thickness: 0.018,
        material: paintMat,
        zone: 'lounge',
      });
      const fullRun = createSkirtingRun({
        path: closedPath,
        profile: preset,
        height: 0.145,
        thickness: 0.018,
        includeHiddenBackAndBottomFaces: true,
        material: paintMat,
      });

      expect(defaultRun.userData.ignoreWalkthroughCollision).toBe(true);
      expect(defaultRun.interiorMeshes).toHaveLength(1);
      const defaultIdxCount = defaultRun.interiorMeshes[0]!.geometry.index!.count;
      const fullIdxCount = fullRun.interiorMeshes[0]!.geometry.index!.count;
      // 4 segments x 2 hidden faces (back + bottom) x 6 indices = 48 fewer indices
      expect(fullIdxCount - defaultIdxCount).toBe(48);
    }
  });

  it('miters 90-degree internal/external corners and 45-degree bay window splays accurately', () => {
    // Path with a 90-degree internal corner, a 45-degree canted bay window projection, and a 90-degree external nib
    const bayPath = mouldingPath
      .startAt(0, 4, { roomSide: 'right' })
      .lineTo(0, 0) // 90 deg internal corner at (0, 0)
      .lineTo(1.5, 0) // 45 deg bay splay start
      .lineTo(2.0, -0.5) // 45 deg splay into bay
      .lineTo(3.5, -0.5) // bay front
      .lineTo(4.0, 0) // 45 deg splay out of bay
      .lineTo(5.0, 0) // 90 deg external chimney-breast corner at (5, 0)
      .lineTo(5.0, 0.4)
      .lineTo(5.8, 0.4);

    const run = createSkirtingRun({
      path: bayPath,
      profile: 'ogee',
      height: 0.15,
      thickness: 0.02,
      material: paintMat,
    });

    const box = new THREE.Box3().setFromObject(run);
    // At internal corner (0, 0) with roomSide='right', room interior is +X/+Z so wall back sits at x=0, z=0
    expect(box.min.x).toBeCloseTo(0, 4);
    // Bay window projects to z = -0.5 on wall line, front face extends +0.02 into room (+Z)
    expect(box.min.z).toBeCloseTo(-0.5, 4);
    expect(box.min.y).toBeCloseTo(0, 5);
    expect(box.max.y).toBeCloseTo(0.15, 4);
    expect(run.totalLengthM).toBeGreaterThan(8.5);
  });

  it('produces smooth averaged vertex normals across arcTo and bezierTo curved walls', () => {
    const curvedPath = createMouldingPath(0, 0, { roomSide: 'right' })
      .arcTo(2, 0, { radius: 1.5, clockwise: true, segments: 16 })
      .bezierTo(2.6, 0, 3.0, 0.6, 3.6, 0.6, 16)
      .quadBezierTo(4.0, 0.6, 4.4, 1.0, 10)
      .splineThrough(
        [
          [4.8, 1.2],
          [5.4, 1.2],
        ],
        8
      )
      .build();

    // Interior curve vertices must be flagged smoothEnd / smoothStart
    const smoothJoints = curvedPath.segments.filter((s) => s.smoothStart || s.smoothEnd);
    expect(smoothJoints.length).toBeGreaterThan(30);

    const run = createSkirtingRun({
      path: curvedPath,
      profile: 'chamfered',
      height: 0.12,
      thickness: 0.018,
      cap: 'butt',
      material: paintMat,
    });

    const mesh = run.interiorMeshes[0]!;
    const pos = mesh.geometry.getAttribute('position');
    const norm = mesh.geometry.getAttribute('normal');

    // On a flat fascia edge (chamfered plinth) along a smooth arc, vertices sharing the exact same 3D position
    // across adjacent arc segments must share identical smooth averaged normals (dot > 0.9999)!
    const bucket = new Map<string, THREE.Vector3[]>();
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      // Sample bottom front plinth toe (v = 0, u = T) at interior curve subdivisions
      // (excluding open ends x=0, 5.4 and sharp G0 kinks between distinct curve commands at x=2.0, 3.6, 4.4)
      const nearSharpJoin =
        Math.abs(px - 0) < 0.05 ||
        Math.abs(px - 2.0) < 0.05 ||
        Math.abs(px - 3.6) < 0.05 ||
        Math.abs(px - 4.4) < 0.05 ||
        Math.abs(px - 5.4) < 0.05;
      if (Math.abs(py) < 1e-5 && !nearSharpJoin) {
        const key = `${px.toFixed(5)},${py.toFixed(5)},${pos.getZ(i).toFixed(5)}`;
        const list = bucket.get(key) ?? [];
        list.push(new THREE.Vector3(norm.getX(i), norm.getY(i), norm.getZ(i)).normalize());
        bucket.set(key, list);
      }
    }

    let matchedSharedVerts = 0;
    for (const normalsAtPoint of bucket.values()) {
      if (normalsAtPoint.length >= 2) {
        matchedSharedVerts += 1;
        const first = normalsAtPoint[0]!;
        for (let k = 1; k < normalsAtPoint.length; k++) {
          expect(first.dot(normalsAtPoint[k]!)).toBeGreaterThan(0.9999);
        }
      }
    }
    expect(matchedSharedVerts).toBeGreaterThan(20);
  });

  it('preserves zero roll/twist (zero holonomy) across .stepTo(newY) vertical drops and .rakeTo sloped flights', () => {
    // Diagonal wall at 37 deg in XZ to ensure any Frenet/holonomy roll would corrupt N_wall!
    const cosA = 0.8;
    const sinA = 0.6;
    const pathData = mouldingPath
      .startAt(0, 0, { y: 0.6, roomSide: 'left' })
      .lineTo(2 * cosA, 2 * sinA) // upper horizontal landing
      .stepTo(0.2) // plumb vertical 400 mm drop!
      .lineTo(4 * cosA, 4 * sinA) // mid horizontal tread
      .rakeTo(6 * cosA, 0.0, 6 * sinA) // sloped rake flight down to y=0
      .lineTo(8 * cosA, 8 * sinA) // lower horizontal hall run
      .build();

    expect(pathData.segments).toHaveLength(5);
    expect(pathData.segments[0]!.kind).toBe('horizontal');
    expect(pathData.segments[1]!.kind).toBe('vertical');
    expect(pathData.segments[2]!.kind).toBe('horizontal');
    expect(pathData.segments[3]!.kind).toBe('rake');
    expect(pathData.segments[4]!.kind).toBe('horizontal');

    const nBeforeStep = new THREE.Vector3(...pathData.segments[0]!.wallNormal);
    const nDuringStep = new THREE.Vector3(...pathData.segments[1]!.wallNormal);
    const nAfterStep = new THREE.Vector3(...pathData.segments[2]!.wallNormal);
    const nDuringRake = new THREE.Vector3(...pathData.segments[3]!.wallNormal);
    const nAfterRake = new THREE.Vector3(...pathData.segments[4]!.wallNormal);

    // Zero-roll / zero-holonomy invariant: N_wall stays 100% locked perpendicular to the wall!
    expect(nAfterStep.dot(nBeforeStep)).toBeGreaterThan(0.9999);
    expect(nDuringStep.dot(nBeforeStep)).toBeGreaterThan(0.9999);
    expect(nDuringRake.dot(nBeforeStep)).toBeGreaterThan(0.9999);
    expect(nAfterRake.dot(nBeforeStep)).toBeGreaterThan(0.9999);
    expect(Math.abs(nDuringStep.y)).toBeLessThan(1e-7);

    // Verify 3D swept mesh generates clean finite geometry without NaN or wall separation
    const run = createSkirtingRun({
      path: pathData,
      profile: 'torus',
      height: 0.14,
      thickness: 0.018,
      cap: 'selfReturn',
      material: paintMat,
    });
    const pos = run.interiorMeshes[0]!.geometry.getAttribute('position');
    expect(pos.count).toBeGreaterThan(40);
    for (let i = 0; i < pos.count; i++) {
      expect(Number.isFinite(pos.getX(i))).toBe(true);
      expect(Number.isFinite(pos.getY(i))).toBe(true);
      expect(Number.isFinite(pos.getZ(i))).toBe(true);
    }
  });

  it('subtracts doorway and hearth gaps (at/width, startDist/endDist, box) with butt, selfReturn, and miter caps', () => {
    // Single 6 m wall along +X at z = 0, roomSide = 'right' (+Z into room)
    const wallPath = mouldingPath.startAt(0, 0, { roomSide: 'right' }).lineTo(6, 0);

    const buttRun = createSkirtingRun({
      path: wallPath,
      profile: 'ogee',
      height: 0.145,
      thickness: 0.018,
      gaps: [
        { at: [2.0, 0], width: 0.9, cap: 'butt' },
        { box: { minX: 4.0, maxX: 4.8, minZ: -0.1, maxZ: 0.1 }, cap: 'miter' },
      ],
      cap: 'butt',
      material: paintMat,
    });

    const selfReturnRun = createSkirtingRun({
      path: wallPath,
      profile: 'ogee',
      height: 0.145,
      thickness: 0.018,
      gaps: [
        { startDist: 1.55, endDist: 2.45, cap: 'selfReturn' },
        { box: { minX: 4.0, maxX: 4.8, minZ: -0.1, maxZ: 0.1 }, cap: 'selfReturn' },
      ],
      cap: 'selfReturn',
      material: paintMat,
    });

    // Total active length = 6.0 - 0.9 - 0.8 = 4.3 m
    expect(buttRun.totalLengthM).toBeCloseTo(4.3, 4);
    expect(selfReturnRun.totalLengthM).toBeCloseTo(4.3, 4);

    // Self-return sweeps full moulded profile turns back into the wall -> strictly more vertices than planar butt caps
    const buttPos = buttRun.interiorMeshes[0]!.geometry.getAttribute('position');
    const retPos = selfReturnRun.interiorMeshes[0]!.geometry.getAttribute('position');
    expect(retPos.count).toBeGreaterThan(buttPos.count);

    // No vertex should fall inside the open doorway center (x in [1.6, 2.4])
    for (let i = 0; i < retPos.count; i++) {
      const vx = retPos.getX(i);
      expect(vx <= 1.5505 || vx >= 2.4495).toBe(true);
    }
  });

  it('splits and tags skirting meshes automatically against CutawayWallDescriptors while keeping interior runs untagged', () => {
    // 6 m x 4 m room on 'ground': north wall (z=0) and east wall (x=6) are exterior cutaway walls;
    // north wall is even split into two cutaway descriptors [0..3] and [3..6], while south & west are interior partitions!
    const cutawayWalls: readonly CutawayWallDescriptor[] = [
      {
        axis: 'z',
        coord: 0,
        minSpan: 0,
        maxSpan: 3,
        floor: 'ground',
        outwardSide: 'north',
      },
      {
        axis: 'z',
        coord: 0,
        minSpan: 3,
        maxSpan: 6,
        floor: 'ground',
        outwardSide: 'north',
      },
      {
        axis: 'x',
        coord: 6,
        minSpan: 0,
        maxSpan: 4,
        floor: 'ground',
        outwardSide: 'east',
      },
    ];

    const roomPath = mouldingPath
      .startAt(0, 0, { roomSide: 'right' })
      .lineTo(6, 0) // north exterior wall (spans both [0..3] and [3..6] descriptors!)
      .lineTo(6, 4) // east exterior wall
      .lineTo(0, 4) // south interior partition
      .lineTo(0, 0) // west interior partition
      .close();

    const run = createSkirtingRun({
      path: roomPath,
      profile: 'lambs-tongue',
      material: paintMat,
      floor: 'ground',
      cutawayWalls,
      zone: 'study',
    });

    expect(run.cutawayMeshes).toHaveLength(3);
    expect(run.interiorMeshes).toHaveLength(1);

    for (const cm of run.cutawayMeshes) {
      expect(cm.userData.isCutawayWall).toBe(true);
      expect((cm.userData.cutawayWall as CutawayWallDescriptor).floor).toBe('ground');
    }
    expect(run.interiorMeshes[0]!.userData.isCutawayWall).toBeUndefined();

    // Verify north wall was split cleanly at x = 3 into two separate cutaway meshes
    const northCutMeshes = run.cutawayMeshes.filter(
      (m) => (m.userData.cutawayWall as CutawayWallDescriptor).axis === 'z'
    );
    expect(northCutMeshes).toHaveLength(2);
    const spans = northCutMeshes
      .map((m) => {
        const cw = m.userData.cutawayWall as CutawayWallDescriptor;
        return [cw.minSpan, cw.maxSpan];
      })
      .sort((a, b) => a[0]! - b[0]!);
    expect(spans[0]).toEqual([0, 3]);
    expect(spans[1]).toEqual([3, 6]);
  });
});
