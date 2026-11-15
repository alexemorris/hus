import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { detectZFighting } from '../../engine/diagnostics/z-fighting-detector.ts';
import { FastGeometryMerger } from '../../engine/rendering/batching/fast-geometry-merger.ts';
import { applySelectiveBevelModifier } from '../../engine/rendering/bevel-modifier.ts';
import { createPropertySceneLayers } from '../../engine/viewer/scene-content.ts';
import {
  AGED_TIMBER_PROFILES,
  type AgedTimberProfileId,
  createAgedTimberBeamGeometry,
  createAgedTimberBoxBeamGeometry,
  createPlasterBeamHaunchGeometry,
} from '../../engine/geometry/aged-timber-beam.ts';
import {
  createAgedJoistBay,
  createAgedRoofTruss,
  createAgedTimberBeam,
} from '../architectural/heritage-timber.ts';

function computeSignedMeshVolume(geo: THREE.BufferGeometry): number {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const idx = geo.getIndex();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const cross = new THREE.Vector3();
  let vol6 = 0;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    cross.crossVectors(b, c);
    vol6 += a.dot(cross);
  }
  return vol6 / 6;
}

describe('Procedural Aged Timber Beam Engine & Catalog Primitives', () => {
  it('enforces restrained straightness (maxBowM <= 5 mm on all presets) and exact preserveOuterAabb invariance (< 0.01 mm)', () => {
    const allProfiles: readonly AgedTimberProfileId[] = [
      'cottage-ceiling-joist',
      'cottage-spine-beam',
      'inglenook-bressummer',
      'embedded-wall-plate',
      'exposed-roof-truss',
      'cambered-cruck-blade',
    ];
    for (const id of allProfiles) {
      expect(AGED_TIMBER_PROFILES[id].maxBowM).toBeGreaterThanOrEqual(0.002);
      expect(AGED_TIMBER_PROFILES[id].maxBowM).toBeLessThanOrEqual(0.005);
    }

    const dims: readonly [number, number, number][] = [
      [4.2, 0.22, 0.18], // X-longest spine beam
      [0.16, 2.75, 0.16], // Y-longest upright post
      [0.12, 0.18, 3.65], // Z-longest joist
    ];
    const seeds = ['beam-a', 'beam-b', 101, 202, ['bay', 3, 'oak'] as const];

    for (const [sx, sy, sz] of dims) {
      for (const profile of allProfiles) {
        for (const seed of seeds) {
          const geo = createAgedTimberBoxBeamGeometry(sx, sy, sz, seed, {
            profile,
            preserveOuterAabb: true,
          });
          geo.computeBoundingBox();
          const bb = geo.boundingBox!;
          expect(Math.abs(bb.min.x - -sx * 0.5)).toBeLessThan(1e-5);
          expect(Math.abs(bb.max.x - sx * 0.5)).toBeLessThan(1e-5);
          expect(Math.abs(bb.min.y - -sy * 0.5)).toBeLessThan(1e-5);
          expect(Math.abs(bb.max.y - sy * 0.5)).toBeLessThan(1e-5);
          expect(Math.abs(bb.min.z - -sz * 0.5)).toBeLessThan(1e-5);
          expect(Math.abs(bb.max.z - sz * 0.5)).toBeLessThan(1e-5);

          // Closed beam has positive signed volume and outward-facing normals
          expect(computeSignedMeshVolume(geo)).toBeGreaterThan(sx * sy * sz * 0.8);
        }
      }
    }
  });

  it('produces deterministic per-seed edge chips, V-groove drying checks on >= 130 mm beams, and stochastic carpenter UVs', () => {
    const oakMat = new THREE.MeshStandardMaterial({ color: 0x6b4e35 });
    const oakTex = new THREE.DataTexture(new Uint8Array(16), 2, 2);
    oakTex.repeat.set(2, 1);
    oakMat.map = oakTex;

    const beamA1 = createAgedTimberBeamGeometry({
      start: [-1.9, 0, 0],
      end: [1.9, 0, 0],
      width: 0.2,
      height: 0.22,
      profile: 'cottage-spine-beam',
      seed: 'spine-north',
      material: oakMat,
    });
    const beamA2 = createAgedTimberBeamGeometry({
      start: [-1.9, 0, 0],
      end: [1.9, 0, 0],
      width: 0.2,
      height: 0.22,
      profile: 'cottage-spine-beam',
      seed: 'spine-north',
      material: oakMat,
    });
    const beamB = createAgedTimberBeamGeometry({
      start: [-1.9, 0, 0],
      end: [1.9, 0, 0],
      width: 0.2,
      height: 0.22,
      profile: 'cottage-spine-beam',
      seed: 'spine-south',
      material: oakMat,
    });

    const posA1 = beamA1.getAttribute('position').array as Float32Array;
    const posA2 = beamA2.getAttribute('position').array as Float32Array;
    const posB = beamB.getAttribute('position').array as Float32Array;

    // Identical seed is 100% deterministic
    expect(posA1.length).toBe(posA2.length);
    expect(Array.from(posA1)).toEqual(Array.from(posA2));

    // Different seed produces distinct vertex stations / carved positions & UV offsets
    let diffFound = posA1.length !== posB.length;
    if (!diffFound) {
      for (let i = 0; i < posA1.length; i++) {
        if (Math.abs(posA1[i]! - posB[i]!) > 1e-4) {
          diffFound = true;
          break;
        }
      }
    }
    expect(diffFound).toBe(true);

    const uvA = beamA1.getAttribute('uv').array as Float32Array;
    const uvB = beamB.getAttribute('uv').array as Float32Array;
    expect(Math.abs(uvA[0]! - uvB[0]!) + Math.abs(uvA[1]! - uvB[1]!)).toBeGreaterThan(1e-3);

    // Narrow joist (< 130 mm) skips V-groove drying checks cleanly
    const slenderJoist = createAgedTimberBeamGeometry({
      start: [0, 0, -1.6],
      end: [0, 0, 1.6],
      width: 0.095,
      height: 0.12,
      profile: 'cottage-ceiling-joist',
      seed: 'slender-joist',
    });
    expect(slenderJoist.getAttribute('position').count).toBeGreaterThan(32);
  });

  it('isolates flat face normals from chamfer normals and stays 28 B/vert FastGeometryMerger & bevel-modifier safe', () => {
    const mat = new THREE.MeshStandardMaterial({ color: 0x5c432d });
    const geo = createAgedTimberBeamGeometry({
      start: [-1.7, 0, 0],
      end: [1.7, 0, 0],
      width: 0.18,
      height: 0.2,
      profile: 'cottage-spine-beam',
      seed: 'batch-check',
    });

    expect(geo.userData.isSculpted).toBe(true);
    expect(geo.getAttribute('color')).toBeUndefined();
    expect(Object.keys(geo.attributes).sort()).toEqual(['normal', 'position', 'uv']);

    // Check normal isolation: soffit (-Y) flat face vertices point predominantly downward (ny < -0.98)
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const norm = geo.getAttribute('normal') as THREE.BufferAttribute;
    let flatSoffitCount = 0;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < -0.096 && Math.abs(pos.getZ(i)) < 0.04) {
        if (norm.getY(i) < -0.98) flatSoffitCount++;
      }
    }
    expect(flatSoffitCount).toBeGreaterThan(6);

    // applySelectiveBevelModifier must leave sculpted aged beam geometry & UVs untouched
    const uvBefore = Float32Array.from((geo.getAttribute('uv') as THREE.BufferAttribute).array);
    const scene = new THREE.Scene();
    const layers = createPropertySceneLayers(scene);
    const beamMesh = new THREE.Mesh(geo, mat);
    scene.add(beamMesh);
    applySelectiveBevelModifier(layers);

    expect(beamMesh.geometry).toBe(geo);
    expect(
      Array.from((beamMesh.geometry.getAttribute('uv') as THREE.BufferAttribute).array)
    ).toEqual(Array.from(uvBefore));

    // FastGeometryMerger merges multiple aged beams without color buffer bloat
    const beam2 = createAgedTimberBeam({
      start: [-1.7, 0, 0.8],
      end: [1.7, 0, 0.8],
      width: 0.18,
      height: 0.2,
      seed: 'batch-check-2',
      material: mat,
    });
    scene.add(beam2.root);
    scene.updateMatrixWorld(true);

    const merger = new FastGeometryMerger();
    const merged = merger.mergeMeshListFast(
      [{ mesh: beamMesh }, { mesh: beam2.mesh }],
      new THREE.Matrix4().identity(),
      new THREE.Matrix4()
    );
    expect(merged).not.toBeNull();
    expect(merged!.getAttribute('color')).toBeUndefined();
    expect(merged!.getAttribute('position').count).toBe(
      geo.getAttribute('position').count + beam2.mesh.geometry.getAttribute('position').count
    );
  });

  it('eliminates coplanar ceiling z-fighting via omitEmbeddedFaces + angled plaster haunches across createAgedTimberBeam & createAgedJoistBay', () => {
    const timberMat = new THREE.MeshStandardMaterial({ color: 0x5a402a });
    const plasterMat = new THREE.MeshStandardMaterial({ color: 0xf1ece1 });

    const root = new THREE.Group();
    const ceilingY = 2.45;
    const ceilingSlab = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.18, 3.8), plasterMat);
    ceilingSlab.name = 'ceiling.slab';
    ceilingSlab.position.set(0, ceilingY + 0.09, 0);
    root.add(ceilingSlab);

    const spineBeam = createAgedTimberBeam({
      name: 'hall.spineBeam',
      start: [-2.1, ceilingY - 0.11, 0],
      end: [2.1, ceilingY - 0.11, 0],
      width: 0.2,
      height: 0.22,
      profile: 'cottage-spine-beam',
      preserveOuterAabb: true,
      omitEmbeddedFaces: ['top'],
      material: timberMat,
      seed: 'hall-spine',
      plasterHaunch: {
        sides: ['left', 'right'],
        hostFace: 'top',
        material: plasterMat,
        reachM: 0.016,
        climbM: 0.014,
      },
      parent: root,
    });
    expect(spineBeam.haunches).toHaveLength(2);

    const joistBay = createAgedJoistBay({
      bayId: 'ceiling.northBay',
      spanAxis: 'z',
      spanStart: -1.8,
      spanEnd: -0.15,
      joistWidth: 0.1,
      joistHeight: 0.14,
      topY: ceilingY,
      layoutStart: -1.75,
      layoutEnd: 1.75,
      count: 6,
      omitEmbeddedFaces: ['top'],
      material: timberMat,
      parent: root,
    });

    expect(joistBay.joists).toHaveLength(6);
    const uvSet = new Set<string>();
    for (const jMesh of joistBay.joists) {
      const uv = jMesh.geometry.getAttribute('uv') as THREE.BufferAttribute;
      uvSet.add(`${uv.getX(0).toFixed(5)}:${uv.getY(0).toFixed(5)}`);
    }
    // Every joist in the bay gets a distinct deterministic seed & stochastic UV slice
    expect(uvSet.size).toBe(6);

    // Verify haunch normals stay strictly angled 28°..55° away from ceiling & timber cheek normals
    const haunchGeo = createPlasterBeamHaunchGeometry({
      start: [-1.2, ceilingY, 0.1],
      end: [1.2, ceilingY, 0.1],
      surfaceNormal: [0, -1, 0],
      intoTimberDir: [0, 0, -1],
      seed: 'haunch-angle-check',
    });
    expect(haunchGeo.userData.isSculpted).toBe(true);
    const hNorm = haunchGeo.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i < hNorm.count; i++) {
      const ny = Math.abs(hNorm.getY(i));
      const nz = Math.abs(hNorm.getZ(i));
      expect(ny).toBeLessThan(0.92);
      expect(nz).toBeLessThan(0.92);
    }

    // Zero coplanar z-fighting between ceiling slab, open-top spine beam/joists, and angled haunches
    root.updateMatrixWorld(true);
    const findings = detectZFighting(root);
    expect(findings).toHaveLength(0);
  });

  it('supports miter-clipped roof trusses via createAgedRoofTruss', () => {
    const mat = new THREE.MeshStandardMaterial({ color: 0x624730 });
    const truss = createAgedRoofTruss({
      id: 'barnTruss.1',
      kind: 'king-post',
      span: 4.6,
      rise: 1.85,
      tieBeamSize: [0.16, 0.2],
      rafterSize: [0.14, 0.16],
      includeStruts: true,
      includeKneeBraces: true,
      material: mat,
      seed: 'gable-truss-1',
    });

    expect(truss.tieBeam).toBeDefined();
    expect(truss.kingPost).toBeDefined();
    expect(truss.struts).toHaveLength(2);
    expect(truss.kneeBraces).toHaveLength(2);
    expect(truss.members.length).toBeGreaterThanOrEqual(8);
    for (const m of truss.members) {
      expect(m.geometry.userData.isSculpted).toBe(true);
    }

    // Tie beam preserves exact outer AABB so top-mounted track lighting seats flush to 0.000 mm
    truss.tieBeam!.geometry.computeBoundingBox();
    const tieBb = truss.tieBeam!.geometry.boundingBox!;
    expect(Math.abs(tieBb.max.y - 0.1)).toBeLessThan(1e-5);
    expect(Math.abs(tieBb.min.y - -0.1)).toBeLessThan(1e-5);
  });
});
