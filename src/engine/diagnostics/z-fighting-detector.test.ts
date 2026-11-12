import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
// @ts-expect-error untyped Node CLI .mjs entrypoint outside tsconfig include
import { dispatchHusjsCli } from '../../../bin/husjs.mjs';
// @ts-expect-error untyped Node CLI .mjs tool outside tsconfig include
import { parseZfightCliArgs, runZfightCli } from '../../../tools/husjs-zfight.mjs';
import {
  assertNoZFighting,
  detectZFighting,
} from './z-fighting-detector.ts';

function makeHorizontalQuad(
  name: string,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  y: number,
  facingUp = true,
  material?: THREE.Material
): THREE.Mesh {
  const geom = new THREE.BufferGeometry();
  // In Y-up right-handed coords, CCW from +Y is:
  // (minX, y, minZ) -> (minX, y, maxZ) -> (maxX, y, maxZ) -> (maxX, y, minZ)
  const positions = new Float32Array([
    minX,
    y,
    minZ,
    minX,
    y,
    maxZ,
    maxX,
    y,
    maxZ,
    maxX,
    y,
    minZ,
  ]);
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setIndex(facingUp ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);

  const mat = material ?? new THREE.MeshStandardMaterial({ name: `${name}Mat` });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = name;
  return mesh;
}

describe('detectZFighting & assertNoZFighting', () => {
  it('detects exact coplanar overlapping quads (0.0 mm diff) with exact overlapAreaCm2 and centroid', () => {
    const root = new THREE.Group();
    root.name = 'testRoot';

    // Quad A: [0, 2] x [0, 2] at y = 1.0
    // Quad B: [1, 3] x [1, 3] at y = 1.0
    // Overlap: [1, 2] x [1, 2] => 1.0 m² = 10,000 cm², centroid = [1.5, 1.0, 1.5]
    const quadA = makeHorizontalQuad('slabA', 0, 2, 0, 2, 1.0, true);
    const quadB = makeHorizontalQuad('slabB', 1, 3, 1, 3, 1.0, true);
    root.add(quadA, quadB);

    const findings = detectZFighting(root);
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.meshA).toBe('testRoot > slabA');
    expect(f.meshB).toBe('testRoot > slabB');
    expect(f.objectA).toBe(quadA);
    expect(f.objectB).toBe(quadB);
    expect(f.planeDistanceDiffMm).toBeCloseTo(0, 4);
    expect(f.overlapAreaCm2).toBeCloseTo(10000, 2);
    expect(f.normal[0]).toBeCloseTo(0, 5);
    expect(f.normal[1]).toBeCloseTo(1, 5);
    expect(f.normal[2]).toBeCloseTo(0, 5);
    expect(f.centroid[0]).toBeCloseTo(1.5, 5);
    expect(f.centroid[1]).toBeCloseTo(1.0, 5);
    expect(f.centroid[2]).toBeCloseTo(1.5, 5);
  });

  it('detects sub-millimetre float drift (0.2 mm < 0.35 mm epsilonM) with accurate planeDistanceDiffMm', () => {
    const root = new THREE.Group();
    const quadA = makeHorizontalQuad('floorA', 0, 1, 0, 1, 0.0, true);
    const quadB = makeHorizontalQuad('floorB', 0, 1, 0, 1, 0.0002, true);
    root.add(quadA, quadB);

    const findings = detectZFighting(root);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.planeDistanceDiffMm).toBeCloseTo(0.2, 3);
    expect(findings[0]!.overlapAreaCm2).toBeCloseTo(10000, 2);
  });

  it('reports 0 findings for clean separation (0.8 mm > 0.35 mm epsilonM)', () => {
    const root = new THREE.Group();
    const quadA = makeHorizontalQuad('floorBase', 0, 1, 0, 1, 0.0, true);
    const quadB = makeHorizontalQuad('rugTop', 0, 1, 0, 1, 0.0008, true);
    root.add(quadA, quadB);

    expect(detectZFighting(root)).toHaveLength(0);
  });

  it('reports 0 findings for edge-touching and corner-touching adjacent floor tiles', () => {
    const root = new THREE.Group();
    const tile00 = makeHorizontalQuad('tile00', 0, 1, 0, 1, 0, true);
    const tile10 = makeHorizontalQuad('tile10', 1, 2, 0, 1, 0, true); // shares X=1 edge
    const tile11 = makeHorizontalQuad('tile11', 1, 2, 1, 2, 0, true); // shares (1, 1) corner with tile00
    root.add(tile00, tile10, tile11);

    expect(detectZFighting(root)).toHaveLength(0);
  });

  it('reports 0 findings for back-to-back opposing FrontSide faces (n1 · n2 = -1)', () => {
    const root = new THREE.Group();
    // Touching solids: top of lower box (+Y) touching bottom of upper box (-Y) at y = 1.0
    const lowerTop = makeHorizontalQuad(
      'wallFront',
      0,
      1,
      0,
      1,
      1.0,
      true,
      new THREE.MeshStandardMaterial({ side: THREE.FrontSide })
    );
    const upperBottom = makeHorizontalQuad(
      'cabinetBack',
      0,
      1,
      0,
      1,
      1.0,
      false,
      new THREE.MeshStandardMaterial({ side: THREE.FrontSide })
    );
    root.add(lowerTop, upperBottom);

    expect(detectZFighting(root)).toHaveLength(0);

    // Also test two touching BoxGeometries sharing a face at x = 0.5
    const boxes = new THREE.Group();
    const boxL = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    boxL.position.set(0, 0.5, 0);
    const boxR = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    boxR.position.set(1, 0.5, 0);
    boxes.add(boxL, boxR);
    expect(detectZFighting(boxes)).toHaveLength(0);
  });

  it('detects a DoubleSide face overlapping a FrontSide face with opposite winding', () => {
    const root = new THREE.Group();
    const frontQuad = makeHorizontalQuad(
      'frontFace',
      0,
      1,
      0,
      1,
      0.5,
      true,
      new THREE.MeshStandardMaterial({ side: THREE.FrontSide })
    );
    const doubleQuadOpposite = makeHorizontalQuad(
      'doubleFace',
      0,
      1,
      0,
      1,
      0.5,
      false,
      new THREE.MeshStandardMaterial({ side: THREE.DoubleSide })
    );
    root.add(frontQuad, doubleQuadOpposite);

    const findings = detectZFighting(root);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.overlapAreaCm2).toBeCloseTo(10000, 2);
  });

  it('exempts intentional decals with distinct polygonOffset', () => {
    const root = new THREE.Group();
    const base = makeHorizontalQuad(
      'roadSurface',
      0,
      2,
      0,
      2,
      0,
      true,
      new THREE.MeshStandardMaterial()
    );
    const decal = makeHorizontalQuad(
      'roadMarkingDecal',
      0.5,
      1.5,
      0.5,
      1.5,
      0,
      true,
      new THREE.MeshStandardMaterial({
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      })
    );
    root.add(base, decal);

    expect(detectZFighting(root)).toHaveLength(0);
  });

  it('skips invisible meshes/subtrees (when onlyVisible: true) and non-depth/non-color/helper meshes', () => {
    const root = new THREE.Group();
    const base = makeHorizontalQuad('floor', 0, 1, 0, 1, 0, true);
    root.add(base);

    const hiddenMesh = makeHorizontalQuad('hiddenFloor', 0, 1, 0, 1, 0, true);
    hiddenMesh.visible = false;
    root.add(hiddenMesh);

    const hiddenGroup = new THREE.Group();
    hiddenGroup.visible = false;
    hiddenGroup.add(makeHorizontalQuad('cutawayDuplicate', 0, 1, 0, 1, 0, true));
    root.add(hiddenGroup);

    const noDepth = makeHorizontalQuad(
      'glowOverlay',
      0,
      1,
      0,
      1,
      0,
      true,
      new THREE.MeshBasicMaterial({ depthWrite: false, transparent: true })
    );
    root.add(noDepth);

    const noColor = makeHorizontalQuad(
      'occluderMask',
      0,
      1,
      0,
      1,
      0,
      true,
      new THREE.MeshBasicMaterial({ colorWrite: false })
    );
    root.add(noColor);

    const collider = makeHorizontalQuad('walkCollider', 0, 1, 0, 1, 0, true);
    collider.userData.isWalkthroughCollider = true;
    root.add(collider);

    expect(detectZFighting(root)).toHaveLength(0);
    // When onlyVisible is false, the two hidden meshes overlap with base (and each other)
    expect(detectZFighting(root, { onlyVisible: false }).length).toBeGreaterThan(0);
  });

  it('detects overlapping instances within a THREE.InstancedMesh', () => {
    const root = new THREE.Group();
    const geom = new THREE.BoxGeometry(1, 0.2, 1);
    const mat = new THREE.MeshStandardMaterial({ name: 'paverMat' });
    const inst = new THREE.InstancedMesh(geom, mat, 2);
    inst.name = 'courtyardPavers';

    const m0 = new THREE.Matrix4().makeTranslation(0, 0.1, 0);
    const m1 = new THREE.Matrix4().makeTranslation(0.5, 0.1, 0); // overlaps 0.5m x 1.0m on top & bottom
    inst.setMatrixAt(0, m0);
    inst.setMatrixAt(1, m1);
    root.add(inst);

    const findings = detectZFighting(root);
    // Top/bottom faces (+Y, -Y) overlap by 0.5 m² = 5,000 cm²; front/back faces (+Z, -Z) overlap by 0.1 m² = 1,000 cm²
    expect(findings).toHaveLength(4);
    expect(findings[0]!.meshA).toContain('courtyardPavers#instance0');
    expect(findings[0]!.meshB).toContain('courtyardPavers#instance1');
    expect(findings[0]!.overlapAreaCm2).toBeCloseTo(5000, 1);
    expect(findings[1]!.overlapAreaCm2).toBeCloseTo(5000, 1);
    expect(findings[2]!.overlapAreaCm2).toBeCloseTo(1000, 1);
    expect(findings[3]!.overlapAreaCm2).toBeCloseTo(1000, 1);
  });

  it('handles negative-scale mirrored transforms by flipping geometric winding', () => {
    const root = new THREE.Group();
    // Normal quad facing +Y at y = 0
    const quadA = makeHorizontalQuad('quadA', 0, 1, 0, 1, 0, true);
    // Quad wound for -Y locally, but mirrored with scale.y = -1 -> world front face becomes +Y!
    const quadMirrored = makeHorizontalQuad('quadMirrored', 0, 1, 0, 1, 0, false);
    quadMirrored.scale.set(1, -1, 1);
    root.add(quadA, quadMirrored);

    const findings = detectZFighting(root);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.overlapAreaCm2).toBeCloseTo(10000, 2);
  });

  it('assertNoZFighting throws a descriptive table on overlap and passes when clean', () => {
    const cleanRoot = new THREE.Group();
    cleanRoot.add(makeHorizontalQuad('a', 0, 1, 0, 1, 0, true));
    cleanRoot.add(makeHorizontalQuad('b', 2, 3, 0, 1, 0, true));
    expect(() => assertNoZFighting(cleanRoot)).not.toThrow();

    const dirtyRoot = new THREE.Group();
    dirtyRoot.add(makeHorizontalQuad('wallA', 0, 1, 0, 1, 0, true));
    dirtyRoot.add(makeHorizontalQuad('wallB', 0.5, 1.5, 0, 1, 0.0002, true));

    expect(() => assertNoZFighting(dirtyRoot)).toThrowError(
      /Detected 1 coplanar z-fighting overlap\(s\)[\s\S]*wallA <-> wallB/
    );
  });
});

describe('husjs zfight CLI', () => {
  it('routes `husjs zfight --help` cleanly via dispatchHusjsCli', async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await dispatchHusjsCli(['zfight', '--help'], {
      log: (msg: string) => out.push(msg),
      error: (msg: string) => err.push(msg),
    });

    expect(code).toBe(0);
    expect(err).toEqual([]);
    const helpText = out.join('\n');
    expect(helpText).toContain('Usage: husjs zfight');
    expect(helpText).toContain('--house');
    expect(helpText).toContain('--all-examples');
    expect(helpText).toContain('--epsilon-mm');
    expect(helpText).toContain('--min-area-cm2');
    expect(helpText).toContain('--json');
  });

  it('parses CLI flags and converts mm/cm² units to metres/m²', () => {
    const parsed = parseZfightCliArgs([
      '--house',
      'stahl-house',
      '--epsilon-mm',
      '2.0',
      '--min-area-cm2',
      '5',
      '--json',
    ]);
    expect(parsed).toMatchObject({
      help: false,
      house: 'stahl-house',
      allExamples: false,
      epsilonMm: 2.0,
      epsilonM: 0.002,
      minAreaCm2: 5,
      minOverlapAreaM2: 0.0005,
      json: true,
    });
  });

  it('loads a custom TypeScript house module via runZfightCli and returns 0 when clean or throws when overlapping', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'husjs-zfight-cli-'));
    try {
      const cleanHousePath = join(tmp, 'clean-house.ts');
      writeFileSync(
        cleanHousePath,
        `import * as THREE from 'three';
import { defineHouse } from '${'hus' + 'js'}';

export const cleanHouse = defineHouse({
  id: 'clean-test-house',
  name: 'Clean Test House',
  location: { lat: 51.5, lon: -0.1, elevationM: 10, northOffsetDeg: 0, timezone: 'UTC', label: 'Test' },
  floors: [{ id: 'ground', name: 'Ground', shortName: 'G', elevationY: 0, ceilingHeight: 2.8 }],
  electrical: { breakers: [], circuits: [] },
  rooms: { manifest: [], navTree: [] },
  zones: {
    circuitMaxIntensity: {},
    modules: [
      {
        id: 'cleanModule',
        build(ctx) {
          const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
          a.position.set(0, 0.5, 0);
          const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
          b.position.set(3, 0.5, 0);
          ctx.scene.add(a, b);
          return {};
        },
      },
    ],
  },
});
`,
        'utf8'
      );

      const cleanLogs: string[] = [];
      const res = await runZfightCli(['--house', cleanHousePath, '--json'], {
        log: (m: string) => cleanLogs.push(m),
      });
      expect(res.findingsCount).toBe(0);
      expect(JSON.parse(cleanLogs.join('\n'))).toEqual({
        house: 'clean-test-house',
        findingsCount: 0,
        findings: [],
      });

      const overlapHousePath = join(tmp, 'overlap-house.ts');
      writeFileSync(
        overlapHousePath,
        `import * as THREE from 'three';
import { defineHouse } from '${'hus' + 'js'}';

export const overlapHouse = defineHouse({
  id: 'overlap-test-house',
  name: 'Overlap Test House',
  location: { lat: 51.5, lon: -0.1, elevationM: 10, northOffsetDeg: 0, timezone: 'UTC', label: 'Test' },
  floors: [{ id: 'ground', name: 'Ground', shortName: 'G', elevationY: 0, ceilingHeight: 2.8 }],
  electrical: { breakers: [], circuits: [] },
  rooms: { manifest: [], navTree: [] },
  zones: {
    circuitMaxIntensity: {},
    modules: [
      {
        id: 'overlapModule',
        build(ctx) {
          const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
          a.name = 'boxA';
          a.position.set(0, 0.5, 0);
          const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
          b.name = 'boxB';
          b.position.set(0.5, 0.5, 0);
          ctx.scene.add(a, b);
          return {};
        },
      },
    ],
  },
});
`,
        'utf8'
      );

      const overlapLogs: string[] = [];
      await expect(
        runZfightCli(['--house', overlapHousePath, '--json'], {
          log: (m: string) => overlapLogs.push(m),
        })
      ).rejects.toThrow(/Detected \d+ coplanar z-fighting overlap/);
      const parsedJson = JSON.parse(overlapLogs.join('\n'));
      expect(parsedJson.house).toBe('overlap-test-house');
      expect(parsedJson.findingsCount).toBeGreaterThan(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 20_000);
});
