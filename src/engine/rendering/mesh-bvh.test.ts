import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  accelerateMergedBatchRaycast,
  accelerateStaticMeshRaycast,
  FlatTriangleBvh,
  restoreDefaultMeshRaycast,
} from './mesh-bvh.ts';

describe('FlatTriangleBvh', () => {
  it('produces bit-identical hit points, normals, faceIndex, and distances to default Mesh.raycast on high-poly meshes', () => {
    const geo = new THREE.TorusKnotGeometry(1.4, 0.38, 120, 24);
    const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });

    const baselineMesh = new THREE.Mesh(geo.clone(), mat);
    baselineMesh.position.set(-4.2, 1.35, 6.8);
    baselineMesh.rotation.set(0.35, -0.82, 0.19);
    baselineMesh.scale.set(1.25, 0.85, 1.4);
    baselineMesh.updateMatrixWorld(true);

    const bvhMesh = new THREE.Mesh(geo.clone(), mat);
    bvhMesh.position.copy(baselineMesh.position);
    bvhMesh.rotation.copy(baselineMesh.rotation);
    bvhMesh.scale.copy(baselineMesh.scale);
    bvhMesh.updateMatrixWorld(true);

    expect(accelerateStaticMeshRaycast(bvhMesh, 512)).toBe(true);

    const raycaster = new THREE.Raycaster();
    let hitCount = 0;

    // Test 80 deterministic rays including oblique and axis-aligned top-down rays
    for (let i = 0; i < 80; i++) {
      const angle = (i / 80) * Math.PI * 2;
      const origin =
        i % 5 === 0
          ? new THREE.Vector3(
              baselineMesh.position.x + ((i % 7) - 3) * 0.4,
              baselineMesh.position.y + 6.0,
              baselineMesh.position.z + ((i % 9) - 4) * 0.35
            )
          : new THREE.Vector3(
              baselineMesh.position.x + Math.cos(angle) * 5.0,
              baselineMesh.position.y + Math.sin(angle * 1.7) * 2.4,
              baselineMesh.position.z + Math.sin(angle) * 5.0
            );
      const target = new THREE.Vector3(
        baselineMesh.position.x + Math.sin(i * 1.3) * 0.9,
        baselineMesh.position.y + Math.cos(i * 0.9) * 0.9,
        baselineMesh.position.z + Math.sin(i * 0.7) * 0.9
      );
      const dir =
        i % 5 === 0
          ? new THREE.Vector3(0, -1, 0)
          : target.sub(origin).normalize();

      raycaster.set(origin, dir);
      const expected = raycaster.intersectObject(baselineMesh, false);
      const actual = raycaster.intersectObject(bvhMesh, false);

      expect(actual.length).toBe(expected.length);
      if (expected.length > 0) {
        hitCount++;
        expect(actual[0]!.distance).toBeCloseTo(expected[0]!.distance, 6);
        expect(actual[0]!.point.x).toBeCloseTo(expected[0]!.point.x, 6);
        expect(actual[0]!.point.y).toBeCloseTo(expected[0]!.point.y, 6);
        expect(actual[0]!.point.z).toBeCloseTo(expected[0]!.point.z, 6);
        expect(actual[0]!.faceIndex).toBe(expected[0]!.faceIndex);
        if (expected[0]!.face && actual[0]!.face) {
          expect(actual[0]!.face.normal.x).toBeCloseTo(expected[0]!.face.normal.x, 6);
          expect(actual[0]!.face.normal.y).toBeCloseTo(expected[0]!.face.normal.y, 6);
          expect(actual[0]!.face.normal.z).toBeCloseTo(expected[0]!.face.normal.z, 6);
        }
      }
    }

    expect(hitCount).toBeGreaterThan(30);
    expect(bvhMesh.geometry.drawRange.start).toBe(0);
    expect(bvhMesh.geometry.drawRange.count).toBe(Infinity);

    restoreDefaultMeshRaycast(bvhMesh);
    expect(bvhMesh.raycast).toBe(THREE.Mesh.prototype.raycast);
  });

  it('preserves originalMesh attribution and excludeFromRaycast on merged batch geometries', () => {
    const subA = new THREE.Mesh(
      new THREE.SphereGeometry(0.8, 32, 24),
      new THREE.MeshStandardMaterial()
    );
    const subExcluded = new THREE.Mesh(
      new THREE.SphereGeometry(0.9, 32, 24),
      new THREE.MeshStandardMaterial()
    );
    subExcluded.userData.excludeFromRaycast = true;

    const gA = subA.geometry;
    const gB = subExcluded.geometry.clone().translate(0, 0, 2.5);
    const posA = gA.getAttribute('position') as THREE.BufferAttribute;
    const posB = gB.getAttribute('position') as THREE.BufferAttribute;
    const idxA = gA.index!;
    const idxB = gB.index!;

    const mergedPos = new Float32Array((posA.count + posB.count) * 3);
    mergedPos.set(posA.array as Float32Array, 0);
    mergedPos.set(posB.array as Float32Array, posA.count * 3);

    const mergedIdx = new Uint32Array(idxA.count + idxB.count);
    mergedIdx.set(idxA.array as Uint16Array, 0);
    for (let i = 0; i < idxB.count; i++) {
      mergedIdx[idxA.count + i] = idxB.getX(i) + posA.count;
    }

    const mergedGeo = new THREE.BufferGeometry();
    mergedGeo.setAttribute('position', new THREE.BufferAttribute(mergedPos, 3));
    mergedGeo.setIndex(new THREE.BufferAttribute(mergedIdx, 1));
    mergedGeo.computeVertexNormals();
    mergedGeo.computeBoundingBox();
    mergedGeo.computeBoundingSphere();
    mergedGeo.userData = {
      subBounds: new Float32Array([-1, -1, -1, 1, 1, 1, -1, -1, 1.5, 1, 1, 3.5]),
      subRanges: new Uint32Array([0, idxA.count, idxA.count, idxB.count]),
      subMeshes: [subA, subExcluded],
    };

    expect(FlatTriangleBvh.build(mergedGeo)).not.toBeNull();
    const mergedMesh = new THREE.Mesh(mergedGeo, subA.material);
    mergedMesh.updateMatrixWorld(true);
    accelerateMergedBatchRaycast(mergedMesh);

    const rc = new THREE.Raycaster(new THREE.Vector3(0, 0, -4), new THREE.Vector3(0, 0, 1));
    const hits = rc.intersectObject(mergedMesh, false) as Array<
      THREE.Intersection & { originalMesh?: THREE.Mesh }
    >;
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.originalMesh).toBe(subA);
    }

    // Ray aimed exclusively at the excluded sub-mesh should yield zero hits
    const rcExcluded = new THREE.Raycaster(
      new THREE.Vector3(0, 5, 2.5),
      new THREE.Vector3(0, -1, 0)
    );
    expect(rcExcluded.intersectObject(mergedMesh, false)).toHaveLength(0);
  });
});
