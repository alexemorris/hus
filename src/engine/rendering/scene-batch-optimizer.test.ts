import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { RoomLodController } from '../lod/lod-manager.ts';
import { createPropertySceneLayers } from '../viewer/scene-content.ts';
import { SceneBatchOptimizer } from './scene-batch-optimizer.ts';
type OptimizerDeps = ConstructorParameters<typeof SceneBatchOptimizer>[0];

function makeOptimizerHarness() {
  const scene = new THREE.Scene();
  const layers = createPropertySceneLayers(scene);
  const lodController = new RoomLodController([]);
  const interactiveMeshes: THREE.Mesh[] = [];
  const dynamicSet = new Set<THREE.Object3D>();
  const optimizer = new SceneBatchOptimizer({
    layers,
    lodController,
    interactiveMeshes,
    bifoldPanels: [],
    lightGroups: {} as OptimizerDeps["lightGroups"],
    indicatorMats: {} as OptimizerDeps["indicatorMats"],
    roomSwitchLedMats: [],
    getDynamicObjects: () => dynamicSet,
  });
  return { scene, layers, interactiveMeshes, dynamicSet, optimizer };
}

describe('SceneBatchOptimizer', () => {
  it('unwraps uniform 6-slot Material[] BoxGeometry walls into batchable single-material meshes and restores losslessly', () => {
    const { scene, interactiveMeshes, optimizer } = makeOptimizerHarness();
    const brickMat = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
    const wallGroup = new THREE.Group();
    wallGroup.name = 'outbuildings.groundShell';
    scene.add(wallGroup);

    const wallA = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2.4, 0.25),
      [brickMat, brickMat, brickMat, brickMat, brickMat, brickMat]
    );
    wallA.name = 'outbuildings.groundShell.brickWall.A';
    wallA.position.set(-2, 1.2, 0);

    const wallB = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2.4, 0.25),
      [brickMat, brickMat, brickMat, brickMat, brickMat, brickMat]
    );
    wallB.name = 'outbuildings.groundShell.brickWall.B';
    wallB.position.set(2, 1.2, 0);

    wallGroup.add(wallA, wallB);
    interactiveMeshes.push(wallA, wallB);
    scene.updateMatrixWorld(true);

    optimizer.optimize();

    // Both 6-slot boxes should be unwrapped and merged into 1 single-material batch mesh
    const liveMeshes: THREE.Mesh[] = [];
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) liveMeshes.push(o);
    });
    expect(liveMeshes).toHaveLength(1);
    expect(Array.isArray(liveMeshes[0]!.material)).toBe(false);

    optimizer.unbatchAll();
    expect(wallA.parent).toBe(wallGroup);
    expect(wallB.parent).toBe(wallGroup);
    expect(Array.isArray(wallA.material)).toBe(true);
    expect((wallA.material as THREE.Material[]).length).toBe(6);
    expect(wallA.geometry.groups).toHaveLength(6);
  });

  it('consolidates 2-material 6-face BoxGeometry into 2 draw groups (or 1 VC mesh when roughness matches) and restores original groups on unbatch', () => {
    const { scene, optimizer } = makeOptimizerHarness();
    const extMat = new THREE.MeshStandardMaterial({ color: 0x774433, roughness: 0.9 });
    const intMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.2 });
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(3, 2.5, 0.3),
      [extMat, intMat, extMat, intMat, extMat, intMat]
    );
    wall.name = 'kitchen.wall.cavity';
    scene.add(wall);
    scene.updateMatrixWorld(true);

    optimizer.optimize();

    expect(Array.isArray(wall.material)).toBe(true);
    expect((wall.material as THREE.Material[]).length).toBe(2);
    expect(wall.geometry.groups).toHaveLength(2);
    const totalIndexCount = wall.geometry.groups.reduce((sum, g) => sum + g.count, 0);
    expect(totalIndexCount).toBe(36);

    optimizer.unbatchAll();
    expect((wall.material as THREE.Material[]).length).toBe(6);
    expect(wall.geometry.groups).toHaveLength(6);
  });

  it('batches static sub-meshes inside rigid door/gate pivots without merging across nested child pivots', () => {
    const { scene, interactiveMeshes, dynamicSet, optimizer } = makeOptimizerHarness();
    const oakMat = new THREE.MeshStandardMaterial({ color: 0x996633 });

    const gateLeaf = new THREE.Group();
    gateLeaf.name = 'courtyard.splitGate.leaf.north';
    gateLeaf.userData.northPivot = true;
    gateLeaf.position.set(4, 0, -2);
    gateLeaf.rotation.y = Math.PI / 6;
    scene.add(gateLeaf);

    const stileA = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.8, 0.05), oakMat);
    stileA.name = 'courtyard.splitGate.leaf.stileA';
    stileA.position.set(-0.5, 0.9, 0);
    const stileB = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.8, 0.05), oakMat);
    stileB.name = 'courtyard.splitGate.leaf.stileB';
    stileB.position.set(0.5, 0.9, 0);
    gateLeaf.add(stileA, stileB);

    // Nested child handle lever that rotates independently relative to gateLeaf
    const handlePivot = new THREE.Group();
    handlePivot.name = 'courtyard.splitGate.doorPivot.latch';
    handlePivot.position.set(0.45, 1.0, 0.04);
    const latchA = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.12), oakMat);
    const latchB = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.03), oakMat);
    latchB.position.set(-0.05, 0, 0.05);
    handlePivot.add(latchA, latchB);
    gateLeaf.add(handlePivot);

    gateLeaf.traverse((c) => dynamicSet.add(c));
    interactiveMeshes.push(stileA, stileB, latchA, latchB);
    scene.updateMatrixWorld(true);

    optimizer.optimize();

    // gateLeaf has 1 local rigid batch (stileA + stileB) + handlePivot
    const leafDirectMeshes = gateLeaf.children.filter((c) => c instanceof THREE.Mesh);
    const latchDirectMeshes = handlePivot.children.filter((c) => c instanceof THREE.Mesh);
    expect(leafDirectMeshes).toHaveLength(1);
    expect(latchDirectMeshes).toHaveLength(1);

    // Raycasting the gate leaf while rotated resolves back to stileA/stileB
    gateLeaf.rotation.y = Math.PI / 3;
    scene.updateMatrixWorld(true);
    const stileAWorldCenter = new THREE.Vector3(-0.5, 0.9, 0).applyMatrix4(gateLeaf.matrixWorld);
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(stileAWorldCenter.x, stileAWorldCenter.y, stileAWorldCenter.z + 2),
      new THREE.Vector3(0, 0, -1)
    );
    const hits = raycaster.intersectObjects(interactiveMeshes, false);
    expect(hits.length).toBeGreaterThan(0);
    expect((hits[0] as THREE.Intersection & { originalMesh?: THREE.Mesh }).originalMesh).toBe(stileA);

    optimizer.unbatchAll();
    expect(stileA.parent).toBe(gateLeaf);
    expect(stileB.parent).toBe(gateLeaf);
    expect(latchA.parent).toBe(handlePivot);
    expect(latchB.parent).toBe(handlePivot);
  });

  it('prunes castShadow on micro botanical foliage while preserving kitchen cabinetInterior carcasses, and unbatchSubtree keeps sibling rooms batched', () => {
    const { scene, optimizer } = makeOptimizerHarness();
    const mat = new THREE.MeshStandardMaterial({ color: 0x557744 });

    const ivyLeaf = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.01), mat);
    ivyLeaf.name = 'courtyard.climbingIvy.leaf.1';
    ivyLeaf.castShadow = true;

    const cabinetCheek = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.85, 0.6), mat);
    cabinetCheek.name = 'joinery.cabinetInterior.mesh';
    cabinetCheek.castShadow = true;
    scene.add(ivyLeaf, cabinetCheek);

    const roomA = new THREE.Group();
    roomA.name = 'kitchen.island';
    const meshA1 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.5), mat);
    const meshA2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.5), mat);
    meshA2.position.x = 1;
    roomA.add(meshA1, meshA2);

    const roomB = new THREE.Group();
    roomB.name = 'masterBath.vanity';
    const meshB1 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.5), mat);
    meshB1.position.x = 50;
    const meshB2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.5), mat);
    meshB2.position.x = 51;
    roomB.add(meshB1, meshB2);

    scene.add(roomA, roomB);
    scene.updateMatrixWorld(true);

    optimizer.optimize();
    expect(ivyLeaf.castShadow).toBe(false);
    expect(cabinetCheek.castShadow).toBe(true);

    // Unbatch only roomA; roomB's batch stays intact!
    const dissolved = optimizer.unbatchSubtree(roomA);
    expect(dissolved).toBe(1);
    expect(meshA1.parent).toBe(roomA);
    expect(meshA2.parent).toBe(roomA);
    expect(meshB1.parent).toBeNull();
    expect(meshB2.parent).toBeNull();

    optimizer.unbatchAll();
    expect(ivyLeaf.castShadow).toBe(true);
    expect(cabinetCheek.castShadow).toBe(true);
    expect(meshB1.parent).toBe(roomB);
  });

  it('merges initially-hidden ceiling containers, cast-iron radiator sub-containers, and shared-material KNX bulbs while preserving live circuit mutation', () => {
    const scene = new THREE.Scene();
    const layers = createPropertySceneLayers(scene);
    const lodController = new RoomLodController([]);
    const interactiveMeshes: THREE.Mesh[] = [];
    const dynamicSet = new Set<THREE.Object3D>();

    const sharedKnxBulbMat = new THREE.MeshStandardMaterial({
      color: 0xfff4d8,
      emissive: 0xffaa44,
      emissiveIntensity: 0.0,
    });
    const bulb1 = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), sharedKnxBulbMat);
    bulb1.position.set(-1, 2.5, 0);
    const bulb2 = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), sharedKnxBulbMat);
    bulb2.position.set(1, 2.5, 0);
    scene.add(bulb1, bulb2);

    const hiddenRoofGroup = new THREE.Group();
    hiddenRoofGroup.name = 'kitchen.roof.slates';
    hiddenRoofGroup.visible = false;
    const slateMat = new THREE.MeshStandardMaterial({ color: 0x333840 });
    const s1 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.02, 0.3), slateMat);
    const s2 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.02, 0.3), slateMat);
    s2.position.x = 0.5;
    hiddenRoofGroup.add(s1, s2);
    scene.add(hiddenRoofGroup);

    const radiator = new THREE.Group();
    radiator.name = 'sittingRoom.castIronRadiator.westBay';
    radiator.userData.isBatchSubContainer = true;
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30 });
    for (let i = 0; i < 6; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.65, 0.14), ironMat);
      fin.position.x = i * 0.06;
      radiator.add(fin);
    }
    scene.add(radiator);
    scene.updateMatrixWorld(true);

    const optimizer = new SceneBatchOptimizer({
      layers,
      lodController,
      interactiveMeshes,
      bifoldPanels: [],
      lightGroups: {
        kitchenSpotlights: { lights: [], emissives: [sharedKnxBulbMat], cones: [], pools: [] },
      } as unknown as OptimizerDeps['lightGroups'],
      indicatorMats: {} as OptimizerDeps['indicatorMats'],
      roomSwitchLedMats: [],
      getDynamicObjects: () => dynamicSet,
    });

    optimizer.optimize();

    expect(hiddenRoofGroup.visible).toBe(false);
    expect(hiddenRoofGroup.children.filter((c) => c instanceof THREE.Mesh)).toHaveLength(1);

    const radBatches = radiator.children.filter((c) => c instanceof THREE.Mesh) as THREE.Mesh[];
    expect(radBatches).toHaveLength(1);

    const knxBatches: THREE.Mesh[] = [];
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material === sharedKnxBulbMat) {
        knxBatches.push(o);
      }
    });
    expect(knxBatches).toHaveLength(1);
    sharedKnxBulbMat.emissiveIntensity = 2.4;
    expect((knxBatches[0]!.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(2.4);
  });

  it('reuses canonical Material, DataTexture, and baked BufferGeometry instances across optimize -> unbatchAll -> optimize', () => {
    const { scene, optimizer, dynamicSet } = makeOptimizerHarness();

    const makePixelCanvas = (w: number, h: number): HTMLCanvasElement => {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 180;
        data[i + 1] = 140;
        data[i + 2] = 95;
        data[i + 3] = 255;
      }
      return {
        width: w,
        height: h,
        getContext: () => ({
          getImageData: () => ({ data, width: w, height: h }),
        }),
      } as unknown as HTMLCanvasElement;
    };

    const canvasTex = new THREE.CanvasTexture(makePixelCanvas(16, 16));
    canvasTex.repeat.set(3, 2);
    const sharedGeo = new THREE.BoxGeometry(1, 1, 1);

    // Protected single mesh so we can inspect its deduplicated material & baked geometry directly
    const protectedColorMesh = new THREE.Mesh(
      sharedGeo,
      new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.45 })
    );
    protectedColorMesh.name = 'kitchen.protectedColorCabinet';
    dynamicSet.add(protectedColorMesh);
    scene.add(protectedColorMesh);

    const protectedTexturedMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 1.2, 1.2),
      new THREE.MeshStandardMaterial({ color: 0xffffff, map: canvasTex, roughness: 0.5 })
    );
    protectedTexturedMesh.name = 'kitchen.protectedTexturedIsland';
    dynamicSet.add(protectedTexturedMesh);
    scene.add(protectedTexturedMesh);

    // Pair of static meshes to exercise dormant warmup entries as well
    const staticA = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.6, 0.6),
      new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.45 })
    );
    staticA.position.set(1, 0.5, 1);
    const staticB = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.6, 0.6),
      new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.45 })
    );
    staticB.position.set(2, 0.5, 1);
    scene.add(staticA, staticB);

    optimizer.optimize();

    const firstColorMat = protectedColorMesh.material as THREE.MeshStandardMaterial;
    const firstBakedVcGeo = protectedColorMesh.geometry;
    const firstTexMat = protectedTexturedMesh.material as THREE.MeshStandardMaterial;
    const firstDataTex = firstTexMat.map;
    const firstBakedUvGeo = protectedTexturedMesh.geometry;
    expect(firstDataTex).toBeInstanceOf(THREE.DataTexture);

    const dormantEntries = optimizer.getDormantWarmupEntries();
    expect(dormantEntries.length).toBe(2);
    expect(dormantEntries[0]!).not.toBeInstanceOf(THREE.Mesh);

    optimizer.unbatchAll();
    optimizer.optimize();

    expect(protectedColorMesh.material).toBe(firstColorMat);
    expect(protectedColorMesh.geometry).toBe(firstBakedVcGeo);
    expect(protectedTexturedMesh.material).toBe(firstTexMat);
    expect((protectedTexturedMesh.material as THREE.MeshStandardMaterial).map).toBe(firstDataTex);
    expect(protectedTexturedMesh.geometry).toBe(firstBakedUvGeo);
  });
  it('packs merged normals as WebGPU-aligned snorm16x4 and UVs as unorm16x2 / snorm16x2 while preserving tiled Float32 UVs and full MeshPhysicalMaterial', () => {
    const { scene, optimizer } = makeOptimizerHarness();
    const clearcoatMat = new THREE.MeshPhysicalMaterial({
      color: 0xb8860b,
      roughness: 0.25,
      metalness: 0.1,
      clearcoat: 0.85,
      clearcoatRoughness: 0.12,
      ior: 1.52,
    });

    // Batch 1: UVs strictly within [0, 1] -> unorm16x2 (Uint16BufferAttribute, itemSize=2, normalized=true)
    const unitGroup = new THREE.Group();
    scene.add(unitGroup);
    const boxA = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), clearcoatMat);
    boxA.position.set(-1, 0.5, 0);
    const boxB = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), clearcoatMat);
    boxB.position.set(1, 0.5, 0);
    unitGroup.add(boxA, boxB);

    // Batch 2: Signed UVs within [-1, 1] on textured surface -> snorm16x2 (Int16BufferAttribute, itemSize=2, normalized=true)
    const dummyAlbedo = new THREE.DataTexture(new Uint8Array(16).fill(255), 2, 2);
    dummyAlbedo.wrapS = THREE.RepeatWrapping;
    dummyAlbedo.wrapT = THREE.RepeatWrapping;
    dummyAlbedo.needsUpdate = true;
    const signedMat = new THREE.MeshStandardMaterial({ color: 0x556677, roughness: 0.85, map: dummyAlbedo });
    const signedGeoA = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const signedUvA = signedGeoA.getAttribute('uv') as THREE.BufferAttribute;
    signedUvA.setXY(0, -0.5, 0.75);
    const signedGeoB = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const signedMeshA = new THREE.Mesh(signedGeoA, signedMat);
    signedMeshA.position.set(-1, 2.0, 0);
    const signedMeshB = new THREE.Mesh(signedGeoB, signedMat);
    signedMeshB.position.set(1, 2.0, 0);
    scene.add(signedMeshA, signedMeshB);

    // Batch 3: Tiled architectural UVs outside [-1, 1] on textured surface -> Float32BufferAttribute preserved
    const tiledMat = new THREE.MeshStandardMaterial({ color: 0x994422, roughness: 0.22, map: dummyAlbedo });
    const tiledGeoA = new THREE.BoxGeometry(1, 1, 0.2);
    const tiledUvA = tiledGeoA.getAttribute('uv') as THREE.BufferAttribute;
    tiledUvA.setXY(0, 4.5, 8.25);
    const tiledGeoB = new THREE.BoxGeometry(1, 1, 0.2);
    const tiledMeshA = new THREE.Mesh(tiledGeoA, tiledMat);
    tiledMeshA.position.set(-2, 4.0, 0);
    const tiledMeshB = new THREE.Mesh(tiledGeoB, tiledMat);
    tiledMeshB.position.set(2, 4.0, 0);
    scene.add(tiledMeshA, tiledMeshB);

    optimizer.optimize();

    let foundUnitBatch = false;
    let foundSignedBatch = false;
    let foundTiledBatch = false;
    scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh) || !obj.userData?.isBatchedStaticMesh) return;
      const posAttr = obj.geometry.getAttribute('position') as THREE.BufferAttribute;
      const normAttr = obj.geometry.getAttribute('normal') as THREE.BufferAttribute;
      const uvAttr = obj.geometry.getAttribute('uv') as THREE.BufferAttribute;

      // Position stays exact Float32x3; normals use 8-byte aligned snorm16x4 (NEVER itemSize=3!)
      expect(posAttr.array).toBeInstanceOf(Float32Array);
      expect(posAttr.itemSize).toBe(3);
      expect(normAttr.array).toBeInstanceOf(Int16Array);
      expect(normAttr.itemSize).toBe(4);
      expect(normAttr.normalized).toBe(true);

      expect(uvAttr.array).toBeInstanceOf(Float32Array);
      expect(uvAttr.itemSize).toBe(2);
      expect(uvAttr.normalized).toBe(false);

      if (obj.material instanceof THREE.MeshPhysicalMaterial) {
        foundUnitBatch = true;
        expect(obj.material.clearcoat).toBeCloseTo(0.85, 5);
        expect(obj.material.ior).toBeCloseTo(1.52, 5);
      } else if ((obj.material as THREE.MeshStandardMaterial).map === dummyAlbedo && Math.abs((obj.material as THREE.MeshStandardMaterial).roughness - 0.85) < 0.05) {
        foundSignedBatch = true;
        expect(uvAttr.getX(0)).toBeCloseTo(-0.5, 5);
      } else if ((obj.material as THREE.MeshStandardMaterial).map === dummyAlbedo && Math.abs((obj.material as THREE.MeshStandardMaterial).roughness - 0.22) < 0.05) {
        foundTiledBatch = true;
        expect(uvAttr.getX(0)).toBeCloseTo(4.5, 5);
      }
    });

    expect(foundUnitBatch).toBe(true);
    expect(foundSignedBatch).toBe(true);
    expect(foundTiledBatch).toBe(true);
  });

  it('preserves exact world-space UV repeat density on multi-material floor slabs (carpet/limestone top + plaster ceiling underside) and restores losslessly', () => {
    const { scene, optimizer } = makeOptimizerHarness();

    const makeTiledTex = (rx: number, ry: number): THREE.DataTexture => {
      const tex = new THREE.DataTexture(new Uint8Array([220, 210, 195, 255]), 1, 1);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(rx, ry);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      return tex;
    };

    const carpetMat = new THREE.MeshStandardMaterial({
      name: 'upstairsWovenWoolCarpet',
      color: 0xf7f2e8,
      map: makeTiledTex(5, 5),
      roughness: 0.93,
      metalness: 0,
    });
    const limestoneMat = new THREE.MeshStandardMaterial({
      name: 'masterBathroomLimestoneFlagstone',
      color: 0xe8e2d6,
      map: makeTiledTex(1.25, 1.25),
      roughness: 0.72,
      metalness: 0,
    });
    const wallCapMat = new THREE.MeshStandardMaterial({ color: 0xe6e1d8, roughness: 0.85 });
    const ceilingMat = new THREE.MeshStandardMaterial({ color: 0xf6f3ec, roughness: 0.88 });

    const buildFloorSlabMesh = (
      name: string,
      cx: number,
      cz: number,
      w: number,
      d: number,
      topMat: THREE.Material,
      multiMat: boolean
    ): THREE.Mesh => {
      const geo = new THREE.BoxGeometry(w, 0.22, d);
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      const norm = geo.getAttribute('normal') as THREE.BufferAttribute;
      const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        if (Math.abs(norm.getY(i)) > 0.5) {
          uv.setXY(i, (cx + pos.getX(i)) * 0.5, (cz + pos.getZ(i)) * 0.5);
        }
      }
      uv.needsUpdate = true;
      const mesh = new THREE.Mesh(
        geo,
        multiMat ? [wallCapMat, wallCapMat, topMat, ceilingMat, wallCapMat, wallCapMat] : topMat
      );
      mesh.name = name;
      mesh.position.set(cx, 2.0, cz);
      return mesh;
    };

    const firstGroup = new THREE.Group();
    firstGroup.name = 'firstFloor';
    scene.add(firstGroup);

    const mainBedSlab = buildFloorSlabMesh('mainBedroom.floorSlab', -6, 0, 4.0, 4.0, carpetMat, true);
    const bed3Slab = buildFloorSlabMesh('bedroom3.floorSlab', -11, 0, 4.0, 3.6, carpetMat, true);
    const landingPolySlab = buildFloorSlabMesh('upperLanding.floorSlab', -2, 0, 3.0, 3.0, carpetMat, false);
    const bathSlabA = buildFloorSlabMesh('familyBathroom.floorSlab.A', -6, 5, 3.2, 3.0, limestoneMat, true);
    const bathSlabB = buildFloorSlabMesh('familyBathroom.floorSlab.B', -10, 5, 2.8, 3.0, limestoneMat, true);
    firstGroup.add(mainBedSlab, bed3Slab, landingPolySlab, bathSlabA, bathSlabB);
    scene.updateMatrixWorld(true);

    optimizer.optimize();
    scene.updateMatrixWorld(true);

    // Measure effective post-batch world-space UV density (tiles/m) on every upward-facing floor triangle
    const measureTopFaceDensities = (matNamePrefix: string): number[] => {
      const densities: number[] = [];
      const p0 = new THREE.Vector3();
      const p1 = new THREE.Vector3();
      const p2 = new THREE.Vector3();
      const n0 = new THREE.Vector3();
      scene.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        const g = obj.geometry;
        const pos = g.getAttribute('position') as THREE.BufferAttribute | undefined;
        const norm = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
        const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
        if (!pos || !norm || !uv) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        const groups =
          g.groups.length > 0
            ? g.groups
            : [{ start: 0, count: g.index ? g.index.count : pos.count, materialIndex: 0 }];
        for (const grp of groups) {
          const m = mats[grp.materialIndex ?? 0] as THREE.MeshStandardMaterial | undefined;
          if (!m || !m.name.startsWith(matNamePrefix)) continue;
          const rx = m.map?.repeat.x ?? 1;
          const ry = m.map?.repeat.y ?? 1;
          for (let k = 0; k + 2 < grp.count; k += 3) {
            const i0 = g.index ? g.index.getX(grp.start + k) : grp.start + k;
            const i1 = g.index ? g.index.getX(grp.start + k + 1) : grp.start + k + 1;
            const i2 = g.index ? g.index.getX(grp.start + k + 2) : grp.start + k + 2;
            n0.fromBufferAttribute(norm, i0).transformDirection(obj.matrixWorld);
            if (n0.y < 0.9) continue;
            p0.fromBufferAttribute(pos, i0).applyMatrix4(obj.matrixWorld);
            p1.fromBufferAttribute(pos, i1).applyMatrix4(obj.matrixWorld);
            p2.fromBufferAttribute(pos, i2).applyMatrix4(obj.matrixWorld);
            const du1 = (uv.getX(i1) - uv.getX(i0)) * rx;
            const dv1 = (uv.getY(i1) - uv.getY(i0)) * ry;
            const dWorld1 = Math.hypot(p1.x - p0.x, p1.z - p0.z);
            if (dWorld1 > 0.1) {
              densities.push(Math.hypot(du1, dv1) / dWorld1);
            }
            const du2 = (uv.getX(i2) - uv.getX(i0)) * rx;
            const dv2 = (uv.getY(i2) - uv.getY(i0)) * ry;
            const dWorld2 = Math.hypot(p2.x - p0.x, p2.z - p0.z);
            if (dWorld2 > 0.1 && Math.abs(p2.x - p0.x) < 0.01 || Math.abs(p2.z - p0.z) < 0.01) {
              densities.push(Math.hypot(du2, dv2) / dWorld2);
            }
          }
        }
      });
      return densities;
    };

    const carpetAxisDensities = measureTopFaceDensities('upstairsWovenWoolCarpet');
    expect(carpetAxisDensities.length).toBeGreaterThanOrEqual(6);
    for (const d of carpetAxisDensities) {
      // Every axis-aligned edge must have exact 0.5 * 5 = 2.5 tiles/m (or diagonal 2.5), NEVER 0.5 tiles/m!
      expect(d).toBeCloseTo(2.5, 3);
    }

    const limestoneAxisDensities = measureTopFaceDensities('masterBathroomLimestoneFlagstone');
    expect(limestoneAxisDensities.length).toBeGreaterThanOrEqual(4);
    for (const d of limestoneAxisDensities) {
      expect(d).toBeCloseTo(0.625, 3);
    }

    optimizer.unbatchAll();
    expect(carpetMat.map!.repeat.x).toBe(5);
    expect(limestoneMat.map!.repeat.x).toBe(1.25);
  });

  it('mounts an invariant carrier PointLight pool with 0 .visible mutations during walking/tier changes and preserves rigid door batches on unbatchSubtree', () => {
    const { scene, dynamicSet, optimizer } = makeOptimizerHarness();

    // Create 20 logical fixture PointLights spread across rooms
    const fixtures: THREE.PointLight[] = [];
    for (let i = 0; i < 20; i++) {
      const pl = new THREE.PointLight(0xffe6c2, 18, 9, 2);
      pl.position.set((i - 10) * 3.5, i % 2 === 0 ? 2.4 : 5.6, (i % 4) * 2.5);
      scene.add(pl);
      fixtures.push(pl);
    }

    // Create a walkthrough door pivot with multiple sub-meshes (rigid local batch)
    const doorMat = new THREE.MeshStandardMaterial({ color: 0xd4cbb8 });
    const doorPivot = new THREE.Group();
    doorPivot.name = 'hall.doorPivot';
    doorPivot.position.set(1.2, 0, -2.0);
    const leafA = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.05, 0.045), doorMat);
    const leafB = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.9, 0.055), doorMat);
    leafB.position.set(0, 0.5, 0);
    doorPivot.add(leafA, leafB);
    scene.add(doorPivot);
    scene.updateMatrixWorld(true);

    doorPivot.traverse((c) => dynamicSet.add(c));
    optimizer.optimize();
    optimizer.setPointLightBudget(16);
    optimizer.enableCarrierPointLightPool(16, new THREE.Vector3(0, 1.6, 0));
    optimizer.stepFades(0);

    const carriers: THREE.PointLight[] = [];
    scene.traverse((obj) => {
      if (obj instanceof THREE.PointLight && obj.userData?.isCarrierPointLight) {
        carriers.push(obj);
      }
    });
    expect(carriers.length).toBe(16);
    for (const c of carriers) expect(c.visible).toBe(true);
    for (const f of fixtures) expect(f.visible).toBe(false);

    // Trap any .visible mutation on ANY PointLight (carrier or fixture)
    let visibleFlipCount = 0;
    for (const light of [...carriers, ...fixtures]) {
      let curVis = light.visible;
      Object.defineProperty(light, 'visible', {
        configurable: true,
        get: () => curVis,
        set: (v: boolean) => {
          if (v !== curVis) {
            visibleFlipCount++;
            curVis = v;
          }
        },
      });
    }

    // Simulate walking 40m across the house + upstairs + tier budget switches (16 -> 12 -> 0 -> 16)
    for (let step = 0; step < 30; step++) {
      const camPos = new THREE.Vector3(-25 + step * 1.8, step > 15 ? 4.8 : 1.65, (step % 5) * 1.5);
      optimizer.syncPointLightVisibilityAndDistance(camPos, true);
      optimizer.stepFades(1 / 120);
    }
    optimizer.setPointLightBudget(12);
    optimizer.setPointLightBudget(0);
    for (const c of carriers) expect(c.intensity).toBe(0);
    optimizer.setPointLightBudget(16);
    optimizer.syncPointLightVisibilityAndDistance(new THREE.Vector3(2, 1.65, 2), true);
    optimizer.stepFades(0);

    expect(visibleFlipCount).toBe(0);
    expect(carriers.some((c) => c.intensity > 0)).toBe(true);

    // Verify barging a door (unbatchSubtree(doorPivot)) keeps its local rigid batch intact!
    const doorBatchesBefore = doorPivot.children.filter((ch) => ch instanceof THREE.Mesh);
    expect(doorBatchesBefore.length).toBe(1);
    const unbatchedCount = optimizer.unbatchSubtree(doorPivot);
    expect(unbatchedCount).toBe(0);
    const doorBatchesAfter = doorPivot.children.filter((ch) => ch instanceof THREE.Mesh);
    expect(doorBatchesAfter.length).toBe(1);
    expect(doorBatchesAfter[0]!.matrixAutoUpdate).toBe(true);
  });

  it('preserves MeshPhysicalMaterial clearcoat (<0.12), sheen, ior, roughness, and normalScale on PBR floor slabs without VC downgrade', () => {
    const { scene, optimizer } = makeOptimizerHarness();
    const roomGroup = new THREE.Group();
    roomGroup.name = 'kitchen';
    scene.add(roomGroup);

    const dummyTex = new THREE.DataTexture(new Uint8Array(16), 2, 2, THREE.RGBAFormat);
    dummyTex.wrapS = THREE.RepeatWrapping;
    dummyTex.wrapT = THREE.RepeatWrapping;
    const dummyNorm = new THREE.DataTexture(new Uint8Array(16), 2, 2, THREE.RGBAFormat);
    dummyNorm.wrapS = THREE.RepeatWrapping;
    dummyNorm.wrapT = THREE.RepeatWrapping;
    const dummyRough = new THREE.DataTexture(new Uint8Array(8), 2, 2, THREE.RGFormat);
    dummyRough.wrapS = THREE.RepeatWrapping;
    dummyRough.wrapT = THREE.RepeatWrapping;

    const limestoneFloorMat = new THREE.MeshPhysicalMaterial({
      color: 0xf4efe4,
      map: dummyTex,
      normalMap: dummyNorm,
      normalScale: new THREE.Vector2(0.58, 0.58),
      roughnessMap: dummyRough,
      roughness: 1.0,
      clearcoat: 0.11,
      clearcoatRoughness: 0.5,
      ior: 1.52,
    });

    const woolCarpetMat = new THREE.MeshPhysicalMaterial({
      color: 0xf7f2e8,
      map: dummyTex,
      normalMap: dummyNorm,
      normalScale: new THREE.Vector2(0.56, 0.56),
      roughnessMap: dummyRough,
      roughness: 0.9,
      sheen: 0.35,
      sheenRoughness: 0.75,
      sheenColor: new THREE.Color(0xfaf5eb),
    });

    const slabA = new THREE.Mesh(new THREE.BoxGeometry(4, 0.1, 4), limestoneFloorMat);
    slabA.name = 'kitchen.floor.slabA';
    const slabB = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 2), limestoneFloorMat);
    slabB.name = 'kitchen.floor.slabB';
    slabB.position.set(4, 0, 0);

    const rug = new THREE.Mesh(new THREE.BoxGeometry(2, 0.02, 3), woolCarpetMat);
    rug.name = 'kitchen.floor.rug';
    rug.position.set(0, 0.06, 0);

    roomGroup.add(slabA, slabB, rug);
    scene.updateMatrixWorld(true);
    optimizer.optimize();

    const activeMats: THREE.Material[] = [];
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.visible) {
        const m = Array.isArray(obj.material) ? obj.material : [obj.material];
        activeMats.push(...m);
      }
    });

    const physLimestone = activeMats.find(
      (m): m is THREE.MeshPhysicalMaterial =>
        m instanceof THREE.MeshPhysicalMaterial && Math.abs(m.clearcoat - 0.11) < 1e-3
    );
    expect(physLimestone).toBeDefined();
    expect(physLimestone!.type).toBe('MeshPhysicalMaterial');
    expect(physLimestone!.vertexColors).toBe(false);
    expect(physLimestone!.clearcoatRoughness).toBeCloseTo(0.5, 3);
    expect(physLimestone!.roughness).toBeCloseTo(1.0, 3);
    expect(physLimestone!.normalScale.x).toBeCloseTo(0.58, 3);
    expect(physLimestone!.ior).toBeCloseTo(1.52, 3);

    const physCarpet = activeMats.find(
      (m): m is THREE.MeshPhysicalMaterial =>
        m instanceof THREE.MeshPhysicalMaterial && Math.abs(m.sheen - 0.35) < 1e-3
    );
    expect(physCarpet).toBeDefined();
    expect(physCarpet!.sheenRoughness).toBeCloseTo(0.75, 3);
    expect(physCarpet!.roughness).toBeCloseTo(0.9, 3);
    expect(physCarpet!.normalScale.x).toBeCloseTo(0.56, 3);
  });
});
