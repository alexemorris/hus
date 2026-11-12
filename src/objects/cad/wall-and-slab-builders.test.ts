import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  createFloorSlab,
  createHippedRoof,
  createPitchedRoof,
  createWallNetwork,
} from './wall-and-slab-builders.ts';

function collectMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      out.push(obj);
    }
  });
  return out;
}

describe('wall-and-slab-builders', () => {
  it('miters closed L-corners cleanly with exact outer/inner bounds and zero wing-fins', () => {
    const extMat = new THREE.MeshStandardMaterial({ color: 0xa05040 });
    const intMat = new THREE.MeshStandardMaterial({ color: 0xf4f1ea });

    // 6 m x 4 m interior room, 0.26 m exterior walls aligned to interior face
    const network = createWallNetwork({
      floor: 'ground',
      baseY: 0,
      height: 2.7,
      exteriorMaterial: extMat,
      interiorMaterial: intMat,
      walls: [
        { id: 'north', from: [0, 0], to: [6, 0], thickness: 0.26, align: 'interior' },
        { id: 'east', from: [6, 0], to: [6, 4], thickness: 0.26, align: 'interior' },
        { id: 'south', from: [6, 4], to: [0, 4], thickness: 0.26, align: 'interior' },
        { id: 'west', from: [0, 4], to: [0, 0], thickness: 0.26, align: 'interior' },
      ],
    });

    const box = new THREE.Box3().setFromObject(network.group);
    // Exterior faces must sit at exact [-0.26, 6.26] x [-0.26, 4.26] with zero overshoot wing-fins
    expect(box.min.x).toBeCloseTo(-0.26, 4);
    expect(box.max.x).toBeCloseTo(6.26, 4);
    expect(box.min.z).toBeCloseTo(-0.26, 4);
    expect(box.max.z).toBeCloseTo(4.26, 4);

    // +0.5 mm inter-storey clearance at bottom and top
    expect(box.min.y).toBeCloseTo(0.0005, 5);
    expect(box.max.y).toBeCloseTo(2.7 - 0.0005, 5);

    // Interior polygon matches exact [0, 6] x [0, 4] room face
    expect(network.interiorPolygonXZ.length).toBe(4);
    const xs = network.interiorPolygonXZ.map((p) => p[0]);
    const zs = network.interiorPolygonXZ.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(0, 4);
    expect(Math.max(...xs)).toBeCloseTo(6, 4);
    expect(Math.min(...zs)).toBeCloseTo(0, 4);
    expect(Math.max(...zs)).toBeCloseTo(4, 4);
  });

  it('trims T-junction partitions flush to host interior face (0 penetration) and splits per-room CutawayWallDescriptors', () => {
    // 8 m x 4 m exterior shell (center-aligned at x=0..8, z=0..4, thickness=0.26 -> interior faces at z=0.13 and z=3.87)
    // Interior partition at x=4 running from z=0 to z=4 (thickness 0.12)
    const network = createWallNetwork({
      floor: 'ground',
      baseY: 0,
      height: 2.8,
      walls: [
        { id: 'north', from: [0, 0], to: [8, 0], thickness: 0.26, align: 'center' },
        { id: 'east', from: [8, 0], to: [8, 4], thickness: 0.26, align: 'center' },
        { id: 'south', from: [8, 4], to: [0, 4], thickness: 0.26, align: 'center' },
        { id: 'west', from: [0, 4], to: [0, 0], thickness: 0.26, align: 'center' },
        {
          id: 'hallPartition',
          from: [4, 0],
          to: [4, 4],
          thickness: 0.12,
          kind: 'partition',
          openings: [{ id: 'door', centerOffset: 2.0, width: 0.9, sillY: 0, height: 2.1 }],
        },
      ],
    });

    const partitionGroup = network.group.children.find(
      (c) => c.userData.wallId === 'hallPartition'
    );
    expect(partitionGroup).toBeDefined();
    const partBox = new THREE.Box3().setFromObject(partitionGroup!);

    // Partition must stop flush at host interior faces z = 0.13 and z = 3.87 (zero penetration into 0.26 m exterior core!)
    expect(partBox.min.z).toBeCloseTo(0.13, 4);
    expect(partBox.max.z).toBeCloseTo(3.87, 4);
    expect(partBox.min.x).toBeCloseTo(4 - 0.06, 4);
    expect(partBox.max.x).toBeCloseTo(4 + 0.06, 4);
    expect(partitionGroup!.userData.isCutawayWall).toBeUndefined();

    // North and South exterior walls should each be split into 2 per-room cutaway bays at x = 4
    const northCutaways = network.cutawaysByWallId.get('north')!;
    const southCutaways = network.cutawaysByWallId.get('south')!;
    expect(northCutaways).toHaveLength(2);
    expect(southCutaways).toHaveLength(2);
    expect(northCutaways[0]!.outwardSide).toBe('north');
    expect(southCutaways[0]!.outwardSide).toBe('south');

    const westBay = network.getWallCutaway('north', 1.5)!;
    const eastBay = network.getWallCutaway('north', 6.5)!;
    expect(westBay.maxSpan).toBeCloseTo(4, 3);
    expect(eastBay.minSpan).toBeCloseTo(4, 3);

    // Every exterior bay mesh carries recursive cutaway tags
    const northBayObj = network.group.children.find((c) => c.name === 'north.bay_0')!;
    expect(northBayObj.userData.isCutawayWall).toBe(true);
    for (const mesh of collectMeshes(northBayObj)) {
      expect(mesh.userData.isCutawayWall).toBe(true);
    }
  });

  it('maintains +0.5 mm inter-storey clearance and continuous 1 UV = 1 m world-space UVs across stacked storeys', () => {
    const ground = createWallNetwork({
      floor: 'ground',
      baseY: 0,
      height: 3.0,
      walls: [
        {
          id: 'front',
          from: [2, 5],
          to: [7, 5],
          thickness: 0.26,
          outwardSide: 'south',
          openings: [
            {
              id: 'sash',
              centerOffset: 2.5,
              width: 1.2,
              sillY: 0.9,
              height: 1.5,
              archRiseM: 0.12,
            },
          ],
        },
      ],
    });
    const first = createWallNetwork({
      floor: 'first',
      baseY: 3.0,
      height: 2.7,
      walls: [
        { id: 'frontUpper', from: [2, 5], to: [7, 5], thickness: 0.26, outwardSide: 'south' },
      ],
    });

    const gBox = new THREE.Box3().setFromObject(ground.group);
    const fBox = new THREE.Box3().setFromObject(first.group);
    // Ground top is 2.9995, First bottom is 3.0005 -> full 1.0 mm separation (zero coplanar cap overlap)
    expect(fBox.min.y - gBox.max.y).toBeCloseTo(0.001, 5);

    // Check world-space metric UVs (u = worldX along +X tangent, v = worldY) on both outer faces
    for (const net of [ground, first]) {
      const outerMesh = collectMeshes(net.group).find((m) => m.name.endsWith('.outer'))!;
      const pos = outerMesh.geometry.getAttribute('position');
      const uv = outerMesh.geometry.getAttribute('uv');
      for (let i = 0; i < pos.count; i++) {
        expect(uv.getX(i)).toBeCloseTo(pos.getX(i), 5);
        expect(uv.getY(i)).toBeCloseTo(pos.getY(i), 5);
      }
    }
  });

  it('builds layered floor slabs with stairwell void subtraction, solidPlane collision, and lower-floor ceiling soffit', () => {
    const shell = createWallNetwork({
      floor: 'first',
      baseY: 3.0,
      height: 2.7,
      walls: [
        { id: 'n', from: [0, 0], to: [6, 0], thickness: 0.26, align: 'interior' },
        { id: 'e', from: [6, 0], to: [6, 5], thickness: 0.26, align: 'interior' },
        { id: 's', from: [6, 5], to: [0, 5], thickness: 0.26, align: 'interior' },
        { id: 'w', from: [0, 5], to: [0, 0], thickness: 0.26, align: 'interior' },
      ],
    });

    const upperSlabContainer = new THREE.Group();
    const groundCeilingContainer = new THREE.Group();
    const oakMat = new THREE.MeshStandardMaterial({ color: 0x8b6b4a });
    const plasterMat = new THREE.MeshStandardMaterial({ color: 0xf7f5f0 });

    const slab = createFloorSlab({
      wallNetwork: shell,
      elevationY: 3.0,
      thickness: 0.24,
      finishThickness: 0.022,
      ceilingThickness: 0.015,
      voids: [
        // Interior stairwell void (2 m x 1.2 m)
        [
          [1.0, 1.0],
          [3.0, 1.0],
          [3.0, 2.2],
          [1.0, 2.2],
        ],
      ],
      floorMaterial: oakMat,
      ceilingMaterial: plasterMat,
      floor: { slabGroup: upperSlabContainer },
      lowerFloor: { ceilingGroup: groundCeilingContainer },
      zone: 'hall',
    });

    expect(upperSlabContainer.children).toContain(slab.slabGroup);
    expect(groundCeilingContainer.children).toContain(slab.ceilingMesh);
    expect(slab.finishMesh.userData.isWalkthroughSolidPlane).toBe(true);
    expect(slab.deckMesh).toBeDefined();

    // Inset 0.5 mm inside [0, 6] x [0, 5] interior wall face -> never pokes into exterior brick
    expect(slab.bounds.min.x).toBeCloseTo(0.0005, 4);
    expect(slab.bounds.max.x).toBeCloseTo(6 - 0.0005, 4);
    expect(slab.bounds.min.z).toBeCloseTo(0.0005, 4);
    expect(slab.bounds.max.z).toBeCloseTo(5 - 0.0005, 4);

    // Non-overlapping Y layers: ceiling [2.76, 2.775], deck [2.7755, 2.9775], finish [2.978, 3.0]
    const finishBox = new THREE.Box3().setFromObject(slab.finishMesh);
    const deckBox = new THREE.Box3().setFromObject(slab.deckMesh!);
    const ceilBox = new THREE.Box3().setFromObject(slab.ceilingMesh!);
    expect(finishBox.max.y).toBeCloseTo(3.0, 5);
    expect(finishBox.min.y).toBeCloseTo(2.978, 5);
    expect(finishBox.min.y - deckBox.max.y).toBeCloseTo(0.0005, 5);
    expect(deckBox.min.y - ceilBox.max.y).toBeCloseTo(0.0005, 5);
    expect(ceilBox.min.y).toBeCloseTo(2.76, 5);

    // Raycast down through the stairwell void center (2.0, 1.6) must NOT hit the slab,
    // while raycasting onto solid landing (4.5, 3.5) hits at y = 3.0
    slab.slabGroup.updateMatrixWorld(true);
    const raycaster = new THREE.Raycaster();
    raycaster.set(new THREE.Vector3(2.0, 5.0, 1.6), new THREE.Vector3(0, -1, 0));
    expect(raycaster.intersectObject(slab.finishMesh, false)).toHaveLength(0);

    raycaster.set(new THREE.Vector3(4.5, 5.0, 3.5), new THREE.Vector3(0, -1, 0));
    const landingHits = raycaster.intersectObject(slab.finishMesh, false);
    expect(landingHits.length).toBeGreaterThan(0);
    expect(landingHits[0]!.point.y).toBeCloseTo(3.0, 4);
  });

  it('clips pitched and hipped roof slopes at exact miter planes and clips gable walls to soffitClipPlanes', () => {
    const slateMat = new THREE.MeshStandardMaterial({ color: 0x3b4048 });
    const pitched = createPitchedRoof({
      minX: 0,
      maxX: 8,
      minZ: 0,
      maxZ: 6,
      eavesY: 5.4,
      pitchDeg: 35,
      ridgeAxis: 'x',
      overhangM: 0.25,
      thickness: 0.18,
      liningThickness: 0.015,
      outerMaterial: slateMat,
      ridgeCapMaterial: slateMat,
    });

    const expectedRidgeY = 5.4 + 3 * Math.tan(THREE.MathUtils.degToRad(35));
    expect(pitched.ridgeY).toBeCloseTo(expectedRidgeY, 4);
    expect(pitched.soffitClipPlanes).toHaveLength(2);

    // Build an oversized gable wall rising to y = 9.0 and clip it with pitched.soffitClipPlanes
    const gableNetwork = createWallNetwork({
      floor: 'attic',
      baseY: 5.4,
      height: 3.6,
      roofClipPlanes: pitched.soffitClipPlanes,
      walls: [
        { id: 'westGable', from: [0, 6], to: [0, 0], thickness: 0.26, align: 'interior' },
      ],
    });

    const gableMeshes = collectMeshes(gableNetwork.group);
    expect(gableMeshes.length).toBeGreaterThan(0);

    // Every single gable wall vertex must satisfy all roof soffitClipPlanes (zero roof poke-through!)
    for (const mesh of gableMeshes) {
      const pos = mesh.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        const vx = pos.getX(i);
        const vy = pos.getY(i);
        const vz = pos.getZ(i);
        for (const pl of pitched.soffitClipPlanes) {
          const n = pl.normal as readonly [number, number, number];
          const signed = n[0] * vx + n[1] * vy + n[2] * vz + pl.constant;
          expect(signed).toBeGreaterThanOrEqual(-1e-4);
        }
      }
    }

    // Verify hipped roof builds 4 soffit clip planes and accurate hipped ridge elevation
    const hipped = createHippedRoof({
      width: 10,
      depth: 6,
      centerXZ: [5, 3],
      eavesY: 5.4,
      pitchDeg: 30,
      outerMaterial: slateMat,
      ridgeCapMaterial: slateMat,
    });
    expect(hipped.soffitClipPlanes).toHaveLength(4);
    expect(hipped.ridgeY).toBeCloseTo(5.4 + 3 * Math.tan(THREE.MathUtils.degToRad(30)), 4);
    const hipBox = new THREE.Box3().setFromObject(hipped.group);
    expect(hipBox.min.x).toBeCloseTo(-0.25, 4);
    expect(hipBox.max.x).toBeCloseTo(10.25, 4);
  });
});
