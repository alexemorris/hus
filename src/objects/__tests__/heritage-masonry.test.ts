import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createWallNetwork } from '../cad/wall-and-slab-builders.ts';
import {
  createHeritagePlasterWallGeometry,
  createHeritageSkeilingSlabGeometry,
  createSoftenedPlasterRevealLinings,
  evaluateHeritageBoundaryWeight,
} from '../../engine/geometry/heritage-masonry.ts';
import { SceneInteractionManager } from '../../engine/interaction/interaction-manager.ts';
import { buildAngledWallSegment } from '../../engine/geometry/period-house-primitives.ts';

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

describe('Heritage Lime-Plaster Wall, Skeiling & Softened Reveal Geometry', () => {
  it('clamps plaster undulation to 0.000 mm on perimeter margins, skirtings, cornices, and fixture exclusion zones while undulating interior field', () => {
    const w = 4.2;
    const h = 2.7;
    const d = 0.22;
    const fixtureZone = {
      uMin: 1.5,
      uMax: 2.5,
      vMin: 0.9,
      vMax: 1.8,
      clearPaddingM: 0.02,
      featherM: 0.1,
    };

    expect(
      evaluateHeritageBoundaryWeight(2.0, 1.35, w, h, {
        clampZones: [fixtureZone],
      })
    ).toBe(0);
    expect(
      evaluateHeritageBoundaryWeight(0.02, 1.35, w, h, {
        endClampM: 0.04,
      })
    ).toBe(0);

    const wallGeo = createHeritagePlasterWallGeometry(w, h, d, {
      seed: 'drawing-room-north',
      amplitudeM: 0.0038,
      gridStepM: 0.25,
      skirtingClampH: 0.18,
      topClampM: 0.12,
      endClampM: 0.04,
      clampZones: [fixtureZone],
    });

    expect(wallGeo.userData.isSculpted).toBe(true);
    expect(Object.keys(wallGeo.attributes).sort()).toEqual(['normal', 'position', 'uv']);
    expect(computeSignedMeshVolume(wallGeo)).toBeGreaterThan(w * h * d * 0.98);

    const pos = wallGeo.getAttribute('position') as THREE.BufferAttribute;
    const norm = wallGeo.getAttribute('normal') as THREE.BufferAttribute;
    const halfD = d * 0.5;
    let maxFieldDisp = 0;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const u = x + w * 0.5;
      const v = y + h * 0.5;

      if (Math.abs(norm.getZ(i)) < 0.8) continue;
      const nominalZ = z >= 0 ? halfD : -halfD;
      const disp = Math.abs(z - nominalZ);

      // Hard-cap <= 5.0 mm everywhere
      expect(disp).toBeLessThanOrEqual(0.005 + 1e-6);

      // Perimeter edges, skirting band, cornice band, and fixture clamp rect must be 0.000 mm
      const inPerimeter = u <= 0.04 - 1e-5 || u >= w - 0.04 + 1e-5;
      const inSkirting = v <= 0.18 - 1e-5;
      const inCornice = v >= h - 0.12 + 1e-5;
      const inFixture =
        u >= fixtureZone.uMin - 0.02 + 1e-5 &&
        u <= fixtureZone.uMax + 0.02 - 1e-5 &&
        v >= fixtureZone.vMin - 0.02 + 1e-5 &&
        v <= fixtureZone.vMax + 0.02 - 1e-5;

      if (inPerimeter || inSkirting || inCornice || inFixture) {
        expect(disp).toBeLessThan(1e-6);
      } else if (disp > maxFieldDisp) {
        maxFieldDisp = disp;
      }
    }

    expect(maxFieldDisp).toBeGreaterThan(0.0008);
    expect(maxFieldDisp).toBeLessThanOrEqual(0.0038 + 1e-5);
  });

  it('builds watertight positive-volume skeiling slabs with pinned perimeter edges and outward normals', () => {
    const quad: readonly (readonly [number, number, number])[] = [
      [0, 2.2, 0],
      [4.4, 2.2, 0],
      [4.4, 3.8, 1.8],
      [0, 3.8, 1.8],
    ];
    const skeiling = createHeritageSkeilingSlabGeometry({
      undersideQuadOrPoly: quad,
      verticalThicknessM: 0.04,
      seed: 'attic-skeiling-west',
      amplitudeM: 0.0035,
      gridStepM: 0.28,
      edgeClampM: 0.04,
    });

    expect(skeiling.userData.isSculpted).toBe(true);
    expect(Object.keys(skeiling.attributes).sort()).toEqual(['normal', 'position', 'uv']);
    expect(computeSignedMeshVolume(skeiling)).toBeGreaterThan(0.25);

    // Verify all 4 perimeter corner vertices remain pinned at exact input coordinates (< 0.001 mm)
    const pos = skeiling.getAttribute('position') as THREE.BufferAttribute;
    for (const [qx, qy, qz] of quad) {
      let minDist = Infinity;
      for (let i = 0; i < pos.count; i++) {
        const d = Math.hypot(pos.getX(i) - qx, pos.getY(i) - qy, pos.getZ(i) - qz);
        if (d < minDist) minDist = d;
      }
      expect(minDist).toBeLessThan(1e-5);
    }
  });

  it('builds softened bullnosed plaster reveal linings with smooth quadrant corner normals', () => {
    const plasterMat = new THREE.MeshStandardMaterial({ color: 0xefeae0 });
    const reveal = createSoftenedPlasterRevealLinings({
      axis: 'x',
      openingCenter: 2.0,
      openingWidth: 1.05,
      botY: 0.85,
      topY: 2.15,
      revealStartCoord: 0.06,
      interiorWallFaceCoord: 0.28,
      inwardSign: 1,
      bullnoseRadiusM: 0.014,
      waveAmplitudeM: 0.0022,
      includeSill: true,
      material: plasterMat,
      seed: 'window-reveal-1',
    });

    expect(reveal.meshes).toHaveLength(4); // jambLeft, jambRight, head, sill
    for (const m of reveal.meshes) {
      expect(m.geometry.userData.isSculpted).toBe(true);
      expect(m.geometry.getAttribute('color')).toBeUndefined();
      expect(m.geometry.getAttribute('position').count).toBeGreaterThan(20);
    }
  });

  it('wires heritageImperfection seamlessly into buildAngledWallSegment and createWallNetwork', () => {
    const mat = new THREE.MeshStandardMaterial({ color: 0xebe5d8 });

    const partitionScene = new THREE.Group();
    const interactions = new SceneInteractionManager([]);
    buildAngledWallSegment(partitionScene, interactions, {
      start: [0, 0],
      end: [4.2, 0],
      frontFloorY: 0,
      backFloorY: 0,
      topY: 2.75,
      thickness: 0.16,
      wallMaterial: mat,
      capMaterial: mat,
      heritageImperfection: {
        seed: 'partition-wall-test',
        amplitudeM: 0.003,
      },
      openings: [
        {
          kind: 'cased-opening',
          uCenter: 2.1,
          width: 0.9,
          doorHeight: 2.05,
          lowerFloorY: 0,
          architraveMaterial: mat,
        },
      ],
    });

    let sculptedPiers = 0;
    partitionScene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.name.includes('pier')) {
        if ((o as THREE.Mesh).geometry.userData.isSculpted) sculptedPiers++;
      }
    });
    expect(sculptedPiers).toBeGreaterThanOrEqual(2);

    const network = createWallNetwork({
      floor: 'ground',
      baseY: 0,
      height: 2.7,
      exteriorMaterial: mat,
      interiorMaterial: mat,
      walls: [
        {
          id: 'north-wall',
          from: [0, 0],
          to: [4.5, 0],
          thickness: 0.3,
          kind: 'exterior',
          outwardSide: 'north',
          heritageImperfection: {
            seed: 'north-lime-wall',
            amplitudeM: 0.0032,
            applyPlasterUVs: true,
          },
        },
      ],
    });

    let innerMesh: THREE.Mesh | null = null;
    let outerMesh: THREE.Mesh | null = null;
    network.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        if (o.name.endsWith('.inner')) innerMesh = o as THREE.Mesh;
        if (o.name.endsWith('.outer')) outerMesh = o as THREE.Mesh;
      }
    });
    expect(innerMesh).not.toBeNull();
    expect(outerMesh).not.toBeNull();
    expect(innerMesh!.geometry.userData.isSculpted).toBe(true);
    // Exterior wall defaults to 'interior' targetFaces only so exterior masonry stays crisp
    expect(outerMesh!.geometry.userData.isSculpted).toBeUndefined();
  });
});
