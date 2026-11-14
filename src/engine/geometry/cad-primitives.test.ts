import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Frame2D } from '../../core/geo/frame2d.ts';
import {
  applyFrame2DToObject3D,
  clipPolygon2DToPlanes,
  clipPolygonToPlanes,
  clipProfileToPlanes,
  computeSignedPolygonArea2D,
  extrudePlanarSolidWithHoles,
  frame2DToThreeMatrix4,
  projectWorldBoxUVs,
  sweepMouldingAlongPath,
  transformFrame2DPoint,
} from './cad-primitives.ts';
import { buildMitredArchitraveSegments } from './swept-moulding.ts';
import { applyTimberPieceUVs, createTimberBoxGeometry } from './timber-piece-uvs.ts';

function verifyEveryTriangleMatchesVertexNormals(geo: THREE.BufferGeometry): number {
  const pos = geo.getAttribute('position');
  const norm = geo.getAttribute('normal');
  const index = geo.getIndex();
  expect(pos).toBeDefined();
  expect(norm).toBeDefined();
  expect(index).not.toBeNull();

  const triCount = index!.count / 3;
  expect(triCount).toBeGreaterThan(0);

  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const p2 = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const faceCross = new THREE.Vector3();
  const n0 = new THREE.Vector3();

  for (let t = 0; t < triCount; t++) {
    const i0 = index!.getX(t * 3);
    const i1 = index!.getX(t * 3 + 1);
    const i2 = index!.getX(t * 3 + 2);
    p0.fromBufferAttribute(pos, i0);
    p1.fromBufferAttribute(pos, i1);
    p2.fromBufferAttribute(pos, i2);
    e1.subVectors(p1, p0);
    e2.subVectors(p2, p0);
    faceCross.crossVectors(e1, e2);
    expect(faceCross.length()).toBeGreaterThan(1e-9);
    faceCross.normalize();

    n0.fromBufferAttribute(norm, i0).normalize();
    expect(faceCross.dot(n0)).toBeGreaterThan(0.999);
  }
  return triCount;
}

/** Signed volume of a closed indexed triangle mesh via divergence theorem (`> 0` iff outward-wound). */
function computeSignedMeshVolume(geo: THREE.BufferGeometry): number {
  const pos = geo.getAttribute('position');
  const index = geo.getIndex()!;
  let vol6 = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const cross = new THREE.Vector3();
  for (let t = 0; t < index.count / 3; t++) {
    a.fromBufferAttribute(pos, index.getX(t * 3));
    b.fromBufferAttribute(pos, index.getX(t * 3 + 1));
    c.fromBufferAttribute(pos, index.getX(t * 3 + 2));
    cross.crossVectors(b, c);
    vol6 += a.dot(cross);
  }
  return vol6 / 6;
}

describe('cad-primitives', () => {
  describe('clipPolygonToPlanes & clipProfileToPlanes', () => {
    it('clips 2D and 3D polygons against convex half-spaces with exact area and vertex deduplication', () => {
      // 4m x 3m wall rectangle [0..4] x [0..3], clipped by gable roof y <= 3.5 - 0.5 * x
      // Rewrite y <= 3.5 - 0.5x  <=>  -0.5 * x - 1.0 * y + 3.5 >= 0
      const rect: readonly [number, number][] = [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ];
      const clipped2D = clipPolygon2DToPlanes(rect, [{ nx: -0.5, ny: -1, constant: 3.5 }]);
      // At x = 1, y = 3; at x = 4, y = 1.5 -> pentagon (0,0)-(4,0)-(4,1.5)-(1,3)-(0,3)
      // Area = 4*3 - 0.5 * 3 * 1.5 = 12 - 2.25 = 9.75
      expect(clipped2D).toHaveLength(5);
      expect(computeSignedPolygonArea2D(clipped2D)).toBeCloseTo(9.75, 10);

      // Completely clipped polygon returns []
      const empty = clipPolygonToPlanes(rect, [{ nx: 1, ny: 0, constant: -10 }]);
      expect(empty).toEqual([]);

      // 3D polygon clipped against THREE.Plane (normal · p + constant >= 0)
      const quad3D = [
        new THREE.Vector3(0, 0, 2),
        new THREE.Vector3(4, 0, 2),
        new THREE.Vector3(4, 4, 2),
        new THREE.Vector3(0, 4, 2),
      ];
      const planes3D = [
        new THREE.Plane(new THREE.Vector3(-1, 0, 0), 3), // -x + 3 >= 0 => x <= 3
        new THREE.Plane(new THREE.Vector3(0, -1, 0), 2.5), // -y + 2.5 >= 0 => y <= 2.5
      ];
      const clipped3D = clipPolygonToPlanes(quad3D, planes3D);
      expect(clipped3D).toHaveLength(4);
      const xs = clipped3D.map((v) => v.x);
      const ys = clipped3D.map((v) => v.y);
      expect(Math.min(...xs)).toBeCloseTo(0, 9);
      expect(Math.max(...xs)).toBeCloseTo(3, 9);
      expect(Math.min(...ys)).toBeCloseTo(0, 9);
      expect(Math.max(...ys)).toBeCloseTo(2.5, 9);
    });

    it('clips a 2D gable wall profile with interior window holes and drops holes outside the clip plane', () => {
      // 6m wide wall [0..6] x [0..4.5] clipped by symmetric gable pitches peaking at (3, 4.5) down to eaves y = 2.5:
      // Left pitch: y - 2.5 <= (2/3)*x  => (2/3)*x - y + 2.5 >= 0
      // Right pitch: y - 2.5 <= (2/3)*(6 - x) => -(2/3)*x - y + 6.5 >= 0
      const profile = {
        outer: [
          [0, 0],
          [6, 0],
          [6, 4.5],
          [0, 4.5],
        ] as const,
        holes: [
          // Lower window [1.0..2.2] x [0.9..2.1] -> completely inside gable
          [
            [1.0, 0.9],
            [2.2, 0.9],
            [2.2, 2.1],
            [1.0, 2.1],
          ],
          // Upper attic window [2.4..3.6] x [2.8..4.6] -> extends past ridge (3, 4.5), clipped to 5-vertex pointed gable window!
          [
            [2.4, 2.8],
            [3.6, 2.8],
            [3.6, 4.6],
            [2.4, 4.6],
          ],
          // Ghost hole outside eave corner [0.1..0.5] x [3.8..4.4] -> completely clipped away
          [
            [0.1, 3.8],
            [0.5, 3.8],
            [0.5, 4.4],
            [0.1, 4.4],
          ],
        ] as const,
      };

      const clipped = clipProfileToPlanes(profile, [
        { nx: 2 / 3, ny: -1, constant: 2.5 },
        { nx: -2 / 3, ny: -1, constant: 6.5 },
      ]);

      // Outer pentagon area: 6 * 2.5 + 0.5 * 6 * 2.0 = 15 + 6 = 21 m^2
      expect(clipped.outer).toHaveLength(5);
      expect(computeSignedPolygonArea2D(clipped.outer)).toBeCloseTo(21.0, 10);

      // Two valid holes survive, both normalized to CW (negative signed area)
      expect(clipped.holes).toHaveLength(2);
      expect(computeSignedPolygonArea2D(clipped.holes[0]!)).toBeCloseTo(-1.2 * 1.2, 10);
      expect(computeSignedPolygonArea2D(clipped.holes[1]!)).toBeLessThan(0);
      // Clipped attic window turns into a pointed 5-vertex gabled opening peaking at (3, 4.5)
      expect(clipped.holes[1]!).toHaveLength(5);
    });
  });

  describe('extrudePlanarSolidWithHoles', () => {
    const wallOuter: readonly [number, number][] = [
      [0, 0],
      [5, 0],
      [5, 3],
      [0, 3],
    ];
    // Window hole [1.5..3.5] x [1.0..2.2] (area = 2.4 m^2)
    const windowHole: readonly [number, number][] = [
      [1.5, 1.0],
      [3.5, 1.0],
      [3.5, 2.2],
      [1.5, 2.2],
    ];

    it('produces outward normals, positive closed volume, and inward-pointing hole jamb normals under a +1 right-handed basis', () => {
      const geo = extrudePlanarSolidWithHoles({
        outer: wallOuter,
        holes: [windowHole],
        depth: 0.3,
        uAxis: [1, 0, 0],
        vAxis: [0, 1, 0],
        wAxis: [0, 0, 1],
      });

      verifyEveryTriangleMatchesVertexNormals(geo);

      // Expected solid volume = (5*3 - 2*1.2) * 0.3 = (15 - 2.4) * 0.3 = 3.78 m^3
      expect(computeSignedMeshVolume(geo)).toBeCloseTo(3.78, 5);

      // Inspect triangle centroids & geometric normals on the interior window hole jambs:
      // - Sill at y = 1.0 must point UP (+Y) into the opening
      // - Head lintel at y = 2.2 must point DOWN (-Y) into the opening
      // - Left jamb at x = 1.5 must point RIGHT (+X) into the opening
      // - Right jamb at x = 3.5 must point LEFT (-X) into the opening
      const pos = geo.getAttribute('position');
      const index = geo.getIndex()!;
      let foundWindowSillUp = false;
      let foundWindowLintelDown = false;
      let foundWindowLeftJambRight = false;
      let foundWindowRightJambLeft = false;

      const p0 = new THREE.Vector3();
      const p1 = new THREE.Vector3();
      const p2 = new THREE.Vector3();
      const centroid = new THREE.Vector3();
      const triNormal = new THREE.Vector3();

      for (let t = 0; t < index.count / 3; t++) {
        p0.fromBufferAttribute(pos, index.getX(t * 3));
        p1.fromBufferAttribute(pos, index.getX(t * 3 + 1));
        p2.fromBufferAttribute(pos, index.getX(t * 3 + 2));
        centroid.copy(p0).add(p1).add(p2).divideScalar(3);
        triNormal.subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0)).normalize();

        if (Math.abs(triNormal.z) > 0.5) continue;

        if (centroid.x > 1.6 && centroid.x < 3.4 && Math.abs(centroid.y - 1.0) < 1e-5) {
          expect(triNormal.y).toBeGreaterThan(0.99);
          foundWindowSillUp = true;
        }
        if (centroid.x > 1.6 && centroid.x < 3.4 && Math.abs(centroid.y - 2.2) < 1e-5) {
          expect(triNormal.y).toBeLessThan(-0.99);
          foundWindowLintelDown = true;
        }
        if (Math.abs(centroid.x - 1.5) < 1e-5 && centroid.y > 1.1 && centroid.y < 2.1) {
          expect(triNormal.x).toBeGreaterThan(0.99);
          foundWindowLeftJambRight = true;
        }
        if (Math.abs(centroid.x - 3.5) < 1e-5 && centroid.y > 1.1 && centroid.y < 2.1) {
          expect(triNormal.x).toBeLessThan(-0.99);
          foundWindowRightJambLeft = true;
        }
      }

      expect(foundWindowSillUp).toBe(true);
      expect(foundWindowLintelDown).toBe(true);
      expect(foundWindowLeftJambRight).toBe(true);
      expect(foundWindowRightJambLeft).toBe(true);
    });

    it('automatically flips winding and preserves outward normals under a mirrored -1 Jacobian determinant basis', () => {
      // Mirrored basis: uAxis = [-1, 0, 0], vAxis = [0, 1, 0], wAxis = [0, 0, 1] -> det = -1
      // Also feed reversed CW outer ring and CCW hole ring to test normalization + Jacobian check together
      const geoMirrored = extrudePlanarSolidWithHoles({
        outer: [...wallOuter].reverse(),
        holes: [windowHole],
        depth: 0.3,
        origin: [5, 0, 0],
        uAxis: [-1, 0, 0],
        vAxis: [0, 1, 0],
        wAxis: [0, 0, 1],
      });

      verifyEveryTriangleMatchesVertexNormals(geoMirrored);
      // Even under a -1 mirrored basis, the resulting 3D mesh must have strictly POSITIVE outward volume (+3.78 m^3)!
      expect(computeSignedMeshVolume(geoMirrored)).toBeCloseTo(3.78, 5);
    });
  });

  describe('sweepMouldingAlongPath', () => {
    // 40mm wide x 120mm tall rectangular skirting profile [0..0.04] x [0..0.12]
    const rectProfile: readonly [number, number][] = [
      [0, 0],
      [0.04, 0],
      [0.04, 0.12],
      [0, 0.12],
    ];

    it('preserves exact cross-section width around 90-degree mitered corners on an open L-path with endcaps', () => {
      const lPath: readonly [number, number][] = [
        [0, 0],
        [2, 0],
        [2, 1.5],
      ];
      const geo = sweepMouldingAlongPath(rectProfile, lPath, {
        closed: false,
        endCaps: true,
        elevationY: 0.5,
      });

      verifyEveryTriangleMatchesVertexNormals(geo);
      geo.computeBoundingBox();
      const bb = geo.boundingBox!;

      expect(bb.min.y).toBeCloseTo(0.5, 6);
      expect(bb.max.y).toBeCloseTo(0.62, 6);
      expect(bb.min.x).toBeCloseTo(0, 6);
      expect(bb.max.x).toBeCloseTo(2.0, 6);
      expect(bb.min.z).toBeCloseTo(0, 6);
      expect(bb.max.z).toBeCloseTo(1.5, 6);

      // Exact solid volume of L-shaped mitered moulding:
      // Outer L area = 2.0 * 0.04 + 1.5 * 0.04 - 0.04 * 0.04 = 0.08 + 0.06 - 0.0016 = 0.1384 m^2
      // Multiplied by height 0.12m = 0.016608 m^3
      expect(computeSignedMeshVolume(geo)).toBeCloseTo(0.016608, 6);
    });

    it('sweeps a closed rectangular picture-rail / cornice loop with watertight positive volume', () => {
      const loopPath: readonly [number, number][] = [
        [0, 0],
        [0, 2],
        [3, 2],
        [3, 0],
      ];
      const geo = sweepMouldingAlongPath(rectProfile, loopPath, {
        closed: true,
        elevationY: 2.6,
      });

      verifyEveryTriangleMatchesVertexNormals(geo);
      // Volume = ((3.08 * 2.08) - (3 * 2)) * 0.12 = 0.4064 * 0.12 = 0.048768 m^3
      expect(computeSignedMeshVolume(geo)).toBeCloseTo(0.048768, 6);
    });
  });

  describe('projectWorldBoxUVs & Frame2D Three.js helpers', () => {
    it('projects 1 unit = 1 m metric world UVs onto scaled and rotated meshes', () => {
      const box = new THREE.BoxGeometry(1, 1, 1);
      const mesh = new THREE.Mesh(box);
      mesh.position.set(10, 2, -5);
      mesh.rotation.y = Math.PI / 2;
      mesh.scale.set(3.2, 2.4, 0.4);
      mesh.updateMatrixWorld(true);

      projectWorldBoxUVs(box, mesh.matrixWorld);

      const norm = box.getAttribute('normal');
      const uv = box.getAttribute('uv');
      const normalMat = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);

      const xFaceU: number[] = [];
      const xFaceV: number[] = [];
      const yFaceU: number[] = [];
      const yFaceV: number[] = [];

      const wn = new THREE.Vector3();
      for (let i = 0; i < norm.count; i++) {
        wn.fromBufferAttribute(norm, i).applyMatrix3(normalMat).normalize();
        if (wn.x > 0.99) {
          xFaceU.push(uv.getX(i));
          xFaceV.push(uv.getY(i));
        } else if (wn.y > 0.99) {
          yFaceU.push(uv.getX(i));
          yFaceV.push(uv.getY(i));
        }
      }

      expect(xFaceU).toHaveLength(4);
      expect(Math.max(...xFaceU) - Math.min(...xFaceU)).toBeCloseTo(3.2, 5);
      expect(Math.max(...xFaceV) - Math.min(...xFaceV)).toBeCloseTo(2.4, 5);

      expect(yFaceU).toHaveLength(4);
      expect(Math.max(...yFaceU) - Math.min(...yFaceU)).toBeCloseTo(0.4, 5);
      expect(Math.max(...yFaceV) - Math.min(...yFaceV)).toBeCloseTo(3.2, 5);
    });

    it('matches Three.js Object3D matrixWorld via frame2DToThreeMatrix4 and applyFrame2DToObject3D', () => {
      const frame = Frame2D.fromOriginAndAngle(-8.4, 11.2, -0.37, 1.15);
      const group = applyFrame2DToObject3D(new THREE.Group(), frame);
      group.updateMatrixWorld(true);

      const mat = frame2DToThreeMatrix4(frame);
      for (let k = 0; k < 16; k++) {
        expect(mat.elements[k]!).toBeCloseTo(group.matrixWorld.elements[k]!, 12);
      }

      const localPt = new THREE.Vector3(2.3, 0.9, -4.1).applyMatrix4(group.matrixWorld);
      const helperPt = transformFrame2DPoint(frame, 2.3, 0.9, -4.1);
      expect(helperPt.distanceTo(localPt)).toBeLessThan(1e-12);
    });
  });

  describe('applyTimberPieceUVs & carpenter grain orientation', () => {
    it('orients fibers along each member axis and decorrelates distinct seeds', () => {
      const rotTex = new THREE.Texture();
      rotTex.rotation = Math.PI * 0.5;
      const vertDoorMat = new THREE.MeshStandardMaterial({ map: rotTex });

      // Vertical stile (grainAxis: y) vs horizontal rail (grainAxis: x) with texture fiber on V
      const stile = createTimberBoxGeometry(0.1, 2.0, 0.044, {
        grainAxis: 'y',
        material: vertDoorMat,
        scalePerMetre: 0.5,
        seed: ['doorA', 'stileL'],
      });
      const rail = createTimberBoxGeometry(0.64, 0.16, 0.044, {
        grainAxis: 'x',
        material: vertDoorMat,
        scalePerMetre: 0.5,
        seed: ['doorA', 'railLock'],
      });
      const stileDoorB = createTimberBoxGeometry(0.1, 2.0, 0.044, {
        grainAxis: 'y',
        material: vertDoorMat,
        scalePerMetre: 0.5,
        seed: ['doorB', 'stileL'],
      });

      const frontFaceUvSpan = (geo: THREE.BufferGeometry) => {
        const norm = geo.getAttribute('normal');
        const uv = geo.getAttribute('uv');
        const us: number[] = [];
        const vs: number[] = [];
        for (let i = 0; i < norm.count; i++) {
          if (norm.getZ(i) > 0.9) {
            us.push(uv.getX(i));
            vs.push(uv.getY(i));
          }
        }
        return {
          uMin: Math.min(...us),
          uMax: Math.max(...us),
          vMin: Math.min(...vs),
          vMax: Math.max(...vs),
        };
      };

      const stileSpan = frontFaceUvSpan(stile);
      const railSpan = frontFaceUvSpan(rail);
      const stileBSpan = frontFaceUvSpan(stileDoorB);

      // Stile long axis (2.0m * 0.5 = 1.0) maps to texture V; rail long axis (0.64m * 0.5 = 0.32) also maps to texture V!
      expect(stileSpan.vMax - stileSpan.vMin).toBeCloseTo(1.0, 4);
      expect(stileSpan.uMax - stileSpan.uMin).toBeCloseTo(0.05, 4);
      expect(railSpan.vMax - railSpan.vMin).toBeCloseTo(0.32, 4);
      expect(railSpan.uMax - railSpan.uMin).toBeCloseTo(0.08, 4);

      // Adjacent doors A & B sample distinct UV slices
      const sameSlice =
        Math.abs(stileSpan.uMin - stileBSpan.uMin) < 1e-3 &&
        Math.abs(stileSpan.vMin - stileBSpan.vMin) < 1e-3;
      expect(sameSlice).toBe(false);

      // Shared primitive guard: never mutates shared geometry in-place
      const shared = new THREE.BoxGeometry(0.2, 0.8, 0.04);
      shared.userData.isSharedPrimitive = true;
      const beforeUv0 = shared.getAttribute('uv').getX(0);
      const cloned = applyTimberPieceUVs(shared, { grainAxis: 'y', seed: 'testShared' });
      expect(cloned).not.toBe(shared);
      expect(shared.getAttribute('uv').getX(0)).toBe(beforeUv0);

      // Mitred architrave segments scale U physically by segment length and orient grain lengthwise
      const archSegs = buildMitredArchitraveSegments(
        -0.45,
        0.45,
        0,
        0,
        2.05,
        'x',
        0,
        1,
        0.068,
        0.022,
        8,
        { scalePerMetre: 0.5, seed: 'archTest' }
      );
      expect(archSegs).toHaveLength(3);
      const legUv = archSegs[0]!.getAttribute('uv');
      let legMinU = Infinity;
      let legMaxU = -Infinity;
      for (let i = 0; i < legUv.count; i++) {
        legMinU = Math.min(legMinU, legUv.getX(i));
        legMaxU = Math.max(legMaxU, legUv.getX(i));
      }
      expect(legMaxU - legMinU).toBeGreaterThan(0.95);
    });
  });
});
