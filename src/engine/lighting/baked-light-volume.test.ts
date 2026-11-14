import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { CircuitLevels } from '../../core/types/knx.ts';
import {
  BakedLightVolumeController,
  SHARED_BAKED_VOLUME_TEXTURE,
  SHARED_DAYLIGHT_GI_TINT,
  SHARED_DAYLIGHT_VOLUME_TEXTURE,
  SHARED_CLUSTER_LIGHT_DATA_TEXTURE,
  SHARED_LIGHT_CLUSTER_TEXTURE,
  SHARED_POINT_LIGHT_ACTIVITY,
  updateClusteredPointLightGrid,
  type BakedRoomVolumeBounds,
} from './baked-light-volume.ts';
import { CircuitLightingController } from './circuit-lighting.ts';
import { FittingEffects } from './fitting-fx.ts';
import { SHARED_CLOUD_GOBO_TEXTURE } from './shader-light-culling.ts';
import { POINT_LIGHT_BUDGET_WEIGHT_KEY } from '../rendering/scene-batch-optimizer.ts';
import type { CircuitFixtureAppearance } from '../viewer/property-scene-profile.ts';
import type { LightGroupMap } from '../viewer/scene-types.ts';

function createTestLightGroups(): LightGroupMap {
  const kitchenLight = new THREE.PointLight(0xffdfba, 4.0, 7.5, 2);
  kitchenLight.position.set(0, 2.2, 0);
  kitchenLight.userData = { baseIntensity: 4.0, knxDecayGain: 4.0 };
  kitchenLight.updateMatrixWorld(true);

  const barnLight = new THREE.PointLight(0xffe0b2, 5.0, 8.0, 2);
  barnLight.position.set(-2.0, 2.0, 17.0);
  barnLight.userData = { baseIntensity: 5.0, knxDecayGain: 6.0 };
  barnLight.updateMatrixWorld(true);

  return {
    islandPendants: {
      lights: [kitchenLight],
      emissives: [],
      cones: [],
      pools: [],
      maxIntensity: 4.0,
    },
    barnPoolTableLight: {
      lights: [barnLight],
      emissives: [],
      cones: [],
      pools: [],
      maxIntensity: 5.0,
    },
  } as unknown as LightGroupMap;
}

const TEST_ROOMS: readonly BakedRoomVolumeBounds[] = [
  {
    zoneId: 'kitchen',
    bounds: { minX: -4, maxX: 4, minY: 0, maxY: 2.8, minZ: -4, maxZ: 4 },
  },
  {
    zoneId: 'outbuildingBarn',
    bounds: { minX: -7, maxX: 1, minY: 0, maxY: 3.5, minZ: 14, maxZ: 20 },
  },
];

describe('BakedLightVolumeController', () => {
  it('bakes static architectural AO with darker room corners than open room centers', () => {
    const controller = new BakedLightVolumeController(createTestLightGroups(), TEST_ROOMS);
    expect(controller.isBaked()).toBe(true);
    expect(controller.getBakedCircuitCount()).toBe(2);

    const centerSample = controller.sampleAtWorldPosition(0, 1.4, 0);
    const cornerSample = controller.sampleAtWorldPosition(-3.8, 0.1, -3.8);
    expect(centerSample.ao).toBeGreaterThan(cornerSample.ao);
    expect(cornerSample.ao).toBeGreaterThanOrEqual(0.55);
  });

  it('updates baked 3D irradiance dynamically when KNX circuits dim and occludes across walls/slabs', () => {
    const controller = new BakedLightVolumeController(createTestLightGroups(), TEST_ROOMS);

    const allOff = { islandPendants: 0, barnPoolTableLight: 0 } as unknown as CircuitLevels;
    controller.updateFromCircuitLevels(allOff, 'night');
    expect(controller.sampleAtWorldPosition(0, 1.2, 0).r).toBe(0);

    const kitchenOn = { islandPendants: 100, barnPoolTableLight: 0 } as unknown as CircuitLevels;
    controller.updateFromCircuitLevels(kitchenOn, 'night');

    const kitchenLit = controller.sampleAtWorldPosition(0, 1.2, 0);
    const upstairsBlocked = controller.sampleAtWorldPosition(0, 4.2, 0);
    const barnDark = controller.sampleAtWorldPosition(-2.0, 1.5, 17.0);

    expect(kitchenLit.r).toBeGreaterThan(0.2);
    expect(kitchenLit.r).toBeGreaterThan(upstairsBlocked.r * 5);
    expect(barnDark.r).toBe(0);
  });

  it('incrementally updates single-circuit dimming identically to full rebuilds and skips no-op texture uploads', () => {
    const controller = new BakedLightVolumeController(createTestLightGroups(), TEST_ROOMS);
    const baseLevels = { islandPendants: 60, barnPoolTableLight: 40 } as unknown as CircuitLevels;
    controller.updateFromCircuitLevels(baseLevels, 'dusk');

    const versionAfterFirst = SHARED_BAKED_VOLUME_TEXTURE.version;
    controller.updateFromCircuitLevels(baseLevels, 'dusk');
    expect(SHARED_BAKED_VOLUME_TEXTURE.version).toBe(versionAfterFirst);

    const dimmedLevels = { islandPendants: 25, barnPoolTableLight: 40 } as unknown as CircuitLevels;
    controller.updateFromCircuitLevels(dimmedLevels, 'dusk');
    expect(SHARED_BAKED_VOLUME_TEXTURE.version).toBeGreaterThan(versionAfterFirst);
    const incrementalSnapshot = new Uint8Array(SHARED_BAKED_VOLUME_TEXTURE.image.data as Uint8Array);

    // Fresh full rebuild at the same levels must match every voxel byte bit-for-bit
    const freshController = new BakedLightVolumeController(createTestLightGroups(), TEST_ROOMS);
    freshController.updateFromCircuitLevels(dimmedLevels, 'dusk');
    const freshSnapshot = new Uint8Array(SHARED_BAKED_VOLUME_TEXTURE.image.data as Uint8Array);
    expect(Buffer.compare(Buffer.from(incrementalSnapshot), Buffer.from(freshSnapshot))).toBe(0);

    // Dimming back to 0 leaves exact zero irradiance without residual float drift
    controller.updateFromCircuitLevels(
      { islandPendants: 0, barnPoolTableLight: 40 } as unknown as CircuitLevels,
      'dusk'
    );
    expect(controller.sampleAtWorldPosition(0, 1.2, 0).r).toBe(0);
  });

  it('always refreshes CircuitLightingController light.intensity when pointLightBudgetWeight changes at identical levels', () => {
    const lightGroups = createTestLightGroups();
    const light = lightGroups.islandPendants!.lights[0]!;
    const scene = new THREE.Scene();
    scene.add(light);

    const circuitController = new CircuitLightingController({
      lightGroups,
      indicatorMats: {} as never,
      roomSwitchLedMats: [],
      switchLedRules: [],
      defaultFixtureAppearance: {
        litColor: 0xffe4b5,
        unlitColor: 0x222222,
        emissiveColor: 0xffb86c,
        maxEmissiveIntensity: 1.8,
      } as unknown as CircuitFixtureAppearance,
      fixtureAppearanceOverrides: {},
      tvArtTextures: [],
      tvOffTexture: new THREE.Texture() as unknown as THREE.CanvasTexture,
      sceneRoot: scene,
      lodRegistrations: [],
    });

    const levels = { islandPendants: 80, barnPoolTableLight: 0 } as unknown as CircuitLevels;
    circuitController.applyLevels(levels);
    const fullIntensity = light.intensity;
    expect(fullIntensity).toBeGreaterThan(0);

    // Simulate pointLightBudgetWeight changing without circuit levels or timeOfDay changing:
    light.userData[POINT_LIGHT_BUDGET_WEIGHT_KEY] = 0.25;
    circuitController.applyLevels(levels);
    expect(light.intensity).toBeCloseTo(fullIntensity * 0.25, 6);
  });

  it('precomputes window sky-portal daylight GI strictly inside interior rooms and zeros it at dusk/night', () => {
    const scene = new THREE.Scene();
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.28,
      transmission: 0.85,
    });
    const bifoldGlass = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.1, 0.03), glassMat);
    bifoldGlass.name = 'kitchen.southBifold.glassPane';
    bifoldGlass.position.set(0, 1.25, 3.98);
    scene.add(bifoldGlass);

    const courtyardRoom: BakedRoomVolumeBounds = {
      zoneId: 'courtyard',
      isInterior: false,
      bounds: { minX: -6, maxX: 6, minY: 0, maxY: 3.0, minZ: 4.1, maxZ: 12.0 },
    };

    const controller = new BakedLightVolumeController(
      createTestLightGroups(),
      [...TEST_ROOMS, courtyardRoom],
      scene
    );
    expect(controller.getBakedDaylightPortalCount()).toBe(1);
    expect(controller.getBakedDaylightVoxelCount()).toBeGreaterThan(0);

    const allOff = { islandPendants: 0, barnPoolTableLight: 0 } as unknown as CircuitLevels;
    controller.updateFromCircuitLevels(allOff, 'day');
    controller.setDaylightState(1.0, [1.0, 0.98, 0.94]);

    const nearWindow = controller.sampleAtWorldPosition(0, 1.2, 2.8);
    const deepRoom = controller.sampleAtWorldPosition(0, 1.2, -2.5);
    const exteriorPatio = controller.sampleAtWorldPosition(0, 1.2, 5.5);

    expect(nearWindow.r).toBeGreaterThan(0.25);
    expect(deepRoom.r).toBeGreaterThan(0.08);
    expect(nearWindow.r).toBeGreaterThan(deepRoom.r);
    // Exterior courtyard/patio receives strictly 0 extra irradiance
    expect(exteriorPatio.r).toBe(0);
    expect(exteriorPatio.g).toBe(0);
    expect(exteriorPatio.b).toBe(0);

    // Overcast sky cools & attenuates daylight GI smoothly
    controller.setDaylightState(0.55, [0.9, 0.95, 1.02]);
    const overcastWindow = controller.sampleAtWorldPosition(0, 1.2, 2.8);
    expect(overcastWindow.r).toBeLessThan(nearWindow.r);
    expect(overcastWindow.b / Math.max(1e-4, overcastWindow.r)).toBeGreaterThan(
      nearWindow.b / Math.max(1e-4, nearWindow.r)
    );

    // Dusk / Night (strength = 0) leaves 100% zero daylight GI so evening lighting is untouched
    controller.updateFromCircuitLevels(allOff, 'dusk');
    controller.setDaylightState(0, [1.0, 0.98, 0.94]);
    const duskWindow = controller.sampleAtWorldPosition(0, 1.2, 2.8);
    expect(duskWindow.r).toBe(0);
    expect(duskWindow.g).toBe(0);
    expect(duskWindow.b).toBe(0);
  });

  it('splits daylight sky-portal GI into static SHARED_DAYLIGHT_VOLUME_TEXTURE with 0 rebuildFullVolume or KNX 3D uploads during Day <-> Dusk transitions', () => {
    const scene = new THREE.Scene();
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.28,
      transmission: 0.85,
    });
    const bifoldGlass = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.1, 0.03), glassMat);
    bifoldGlass.name = 'kitchen.southBifold.glassPane';
    bifoldGlass.position.set(0, 1.25, 3.98);
    scene.add(bifoldGlass);

    const daylightVerBefore = SHARED_DAYLIGHT_VOLUME_TEXTURE.version;
    const controller = new BakedLightVolumeController(createTestLightGroups(), TEST_ROOMS, scene);
    expect(SHARED_DAYLIGHT_VOLUME_TEXTURE.version).toBeGreaterThan(daylightVerBefore);

    const levels = { islandPendants: 50, barnPoolTableLight: 0 } as unknown as CircuitLevels;
    controller.updateFromCircuitLevels(levels, 'dusk');
    const knxVerBeforeTransition = SHARED_BAKED_VOLUME_TEXTURE.version;
    const dlVerAfterBake = SHARED_DAYLIGHT_VOLUME_TEXTURE.version;
    const rebuildsBefore = controller.getRebuildFullVolumeCount();

    // Simulate 60 frames of Dusk -> Day solar/GI transition
    for (let i = 0; i <= 60; i++) {
      const k = i / 60;
      controller.setDaylightState(k, [1.0, 0.98, 0.94]);
    }
    expect(controller.getRebuildFullVolumeCount()).toBe(rebuildsBefore);
    expect(SHARED_BAKED_VOLUME_TEXTURE.version).toBe(knxVerBeforeTransition);
    expect(SHARED_DAYLIGHT_VOLUME_TEXTURE.version).toBe(dlVerAfterBake);
    expect(SHARED_DAYLIGHT_GI_TINT.x).toBeCloseTo(1.0, 5);
  });

  it('updates SHARED_POINT_LIGHT_ACTIVITY uniform flag and mutates light.userData in place without reallocating', () => {
    const lightGroups = createTestLightGroups();
    const light = lightGroups.islandPendants!.lights[0]!;
    const scene = new THREE.Scene();
    scene.add(light);

    const circuitController = new CircuitLightingController({
      lightGroups,
      indicatorMats: {} as never,
      roomSwitchLedMats: [],
      switchLedRules: [],
      defaultFixtureAppearance: {
        litColor: 0xffe4b5,
        unlitColor: 0x222222,
        emissiveColor: 0xffb86c,
        maxEmissiveIntensity: 1.8,
      } as unknown as CircuitFixtureAppearance,
      fixtureAppearanceOverrides: {},
      tvArtTextures: [],
      tvOffTexture: new THREE.Texture() as unknown as THREE.CanvasTexture,
      sceneRoot: scene,
      lodRegistrations: [],
    });

    const userDataRef = light.userData;
    circuitController.applyLevels({ islandPendants: 0, barnPoolTableLight: 0 } as unknown as CircuitLevels);
    expect(SHARED_POINT_LIGHT_ACTIVITY.x).toBe(0);
    expect(light.userData).toBe(userDataRef);

    circuitController.applyLevels({ islandPendants: 75, barnPoolTableLight: 0 } as unknown as CircuitLevels);
    expect(SHARED_POINT_LIGHT_ACTIVITY.x).toBe(1);
    expect(light.userData).toBe(userDataRef);
  });
  it("initializes both 3D volume textures with generateMipmaps=false and version>0 for WebGPU texture_3d safety and clamps corrupted circuit levels", () => {
    expect(SHARED_BAKED_VOLUME_TEXTURE.generateMipmaps).toBe(false);
    expect(SHARED_DAYLIGHT_VOLUME_TEXTURE.generateMipmaps).toBe(false);
    expect(SHARED_BAKED_VOLUME_TEXTURE.version).toBeGreaterThan(0);
    expect(SHARED_DAYLIGHT_VOLUME_TEXTURE.version).toBeGreaterThan(0);

    const prevVersion = SHARED_DAYLIGHT_VOLUME_TEXTURE.version;
    const emptyScene = new THREE.Group();
    const volume = new BakedLightVolumeController(createTestLightGroups(), TEST_ROOMS, emptyScene);
    expect(volume.getBakedDaylightPortalCount()).toBe(0);
    expect(SHARED_DAYLIGHT_VOLUME_TEXTURE.version).toBeGreaterThan(prevVersion);

    const lightGroups = createTestLightGroups();
    const kitchenLight = lightGroups.islandPendants!.lights[0]!;
    const barnLight = lightGroups.barnPoolTableLight!.lights[0]!;
    const scene = new THREE.Scene();
    scene.add(kitchenLight, barnLight);

    const circuitController = new CircuitLightingController({
      lightGroups,
      indicatorMats: {} as never,
      roomSwitchLedMats: [],
      switchLedRules: [],
      defaultFixtureAppearance: {
        litColor: 0xffe4b5,
        unlitColor: 0x222222,
        emissiveColor: 0xffb86c,
        maxEmissiveIntensity: 1.8,
      } as unknown as CircuitFixtureAppearance,
      fixtureAppearanceOverrides: {},
      tvArtTextures: [],
      tvOffTexture: new THREE.Texture() as unknown as THREE.CanvasTexture,
      sceneRoot: scene,
      lodRegistrations: [],
    });

    // Even if raw levels contain 6052% or -5972% or NaN, PointLight intensities stay finite and bounded (never 254x or NaN)
    circuitController.setTimeOfDay("day");
    circuitController.applyLevels({
      islandPendants: 6052,
      barnPoolTableLight: -5972,
    } as unknown as CircuitLevels);

    expect(Number.isFinite(kitchenLight.intensity)).toBe(true);
    expect(kitchenLight.intensity).toBeCloseTo(4.0 * 4.0 * 0.68, 5);
    expect(Number.isFinite(barnLight.intensity)).toBe(true);
    expect(barnLight.intensity).toBe(0);
  });
  it("populates 3D voxel-clustered KNX light grid (32x8x24) + 64x2 float light data texture with wall occlusion and baked 128x128 cloud gobo", () => {
    expect(SHARED_LIGHT_CLUSTER_TEXTURE.image.width).toBe(32);
    expect(SHARED_LIGHT_CLUSTER_TEXTURE.image.height).toBe(8);
    expect(SHARED_LIGHT_CLUSTER_TEXTURE.image.depth).toBe(24);
    expect(SHARED_LIGHT_CLUSTER_TEXTURE.generateMipmaps).toBe(false);
    expect(SHARED_LIGHT_CLUSTER_TEXTURE.minFilter).toBe(THREE.NearestFilter);
    expect(SHARED_LIGHT_CLUSTER_TEXTURE.magFilter).toBe(THREE.NearestFilter);

    expect(SHARED_CLUSTER_LIGHT_DATA_TEXTURE.image.width).toBe(64);
    expect(SHARED_CLUSTER_LIGHT_DATA_TEXTURE.image.height).toBe(2);
    expect(SHARED_CLUSTER_LIGHT_DATA_TEXTURE.generateMipmaps).toBe(false);
    expect(SHARED_CLUSTER_LIGHT_DATA_TEXTURE.minFilter).toBe(THREE.NearestFilter);

    // Verify 128x128 baked cloud gobo FBM texture is tileable and non-uniform
    expect(SHARED_CLOUD_GOBO_TEXTURE.image.width).toBe(128);
    expect(SHARED_CLOUD_GOBO_TEXTURE.image.height).toBe(128);
    expect(SHARED_CLOUD_GOBO_TEXTURE.wrapS).toBe(THREE.RepeatWrapping);
    expect(SHARED_CLOUD_GOBO_TEXTURE.wrapT).toBe(THREE.RepeatWrapping);
    const cloudBytes = SHARED_CLOUD_GOBO_TEXTURE.image.data as Uint8Array;
    let minCloud = 255;
    let maxCloud = 0;
    for (let i = 0; i < cloudBytes.length; i += 4) {
      const v = cloudBytes[i]!;
      if (v < minCloud) minCloud = v;
      if (v > maxCloud) maxCloud = v;
    }
    expect(maxCloud - minCloud).toBeGreaterThan(80);

    // Populate clustered grid with 1 active Kitchen pendant at (0, 2.2, 0) and 1 inactive Barn light
    updateClusteredPointLightGrid(
      [
        {
          x: 0,
          y: 2.2,
          z: 0,
          r: 1.0,
          g: 0.88,
          b: 0.72,
          intensity: 16.0,
          distance: 7.5,
          decay: 2,
        },
        {
          x: -2.0,
          y: 2.0,
          z: 17.0,
          r: 1.0,
          g: 0.85,
          b: 0.7,
          intensity: 0,
          distance: 8.0,
          decay: 2,
        },
      ],
      true,
      TEST_ROOMS
    );

    expect(SHARED_POINT_LIGHT_ACTIVITY.w).toBe(1);

    // Kitchen voxel around (0, 2.2, 0): ix = floor((0 - (-34)) / 56 * 32) = 19, iy = floor((2.2 - (-0.6)) / 8 * 8) = 2, iz = floor((0 - (-18)) / 44 * 24) = 9
    const clusterBytes = SHARED_LIGHT_CLUSTER_TEXTURE.image.data as Uint8Array;
    const kitchenVoxelOffset = ((9 * 8 + 2) * 32 + 19) * 4;
    expect(clusterBytes[kitchenVoxelOffset]).toBe(1); // 1-based slot index 1 -> light idx 0

    // Far Barn voxel around (-2, 2.0, 17): ix = 18, iy = 2, iz = 19 must be empty (0)
    const barnVoxelOffset = ((19 * 8 + 2) * 32 + 18) * 4;
    expect(clusterBytes[barnVoxelOffset]).toBe(0);

    // Verify float light data row 0 (pos + cutoff) and row 1 (scaled linear RGB + decay)
    const lightFloats = SHARED_CLUSTER_LIGHT_DATA_TEXTURE.image.data as Float32Array;
    expect(lightFloats[0]).toBeCloseTo(0, 4);
    expect(lightFloats[1]).toBeCloseTo(2.2, 4);
    expect(lightFloats[2]).toBeCloseTo(0, 4);
    expect(lightFloats[3]).toBeCloseTo(7.5, 4);
    const row1Base = 64 * 4;
    expect(lightFloats[row1Base]!).toBeCloseTo(16.0, 4);
    expect(lightFloats[row1Base + 3]).toBeCloseTo(2.0, 4);

    // Turning all lights off clears clustered activity flag (.w = 0)
    updateClusteredPointLightGrid([], true);
    expect(SHARED_POINT_LIGHT_ACTIVITY.w).toBe(0);
  });

  it('binds FittingEffects multi-fitting halo attributes as non-interleaved InstancedBufferAttribute for WebGPU instance stepMode', () => {
    const root = new THREE.Group();
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xfff4dc,
      emissive: new THREE.Color(0xffad42),
      emissiveIntensity: 2.0,
    });
    const bulbGeo = new THREE.SphereGeometry(0.03, 8, 8);
    const positions = [
      [-21.22, 2.876, 8.575],
      [-19.08, 2.876, 8.575],
      [-19.85, 4.405, 9.94],
    ] as const;
    for (let i = 0; i < positions.length; i++) {
      const m = new THREE.Mesh(bulbGeo, bulbMat);
      m.name = `bedroom4.lamp_${i}.bulb`;
      m.position.set(positions[i]![0], positions[i]![1], positions[i]![2]);
      root.add(m);
    }
    root.updateMatrixWorld(true);

    const lightGroups = {
      bedroom4Pendant: {
        lights: [],
        emissives: [bulbMat],
        cones: [],
        pools: [],
        maxIntensity: 13.0,
      },
    } as unknown as LightGroupMap;
    const fx = new FittingEffects({ lightGroups, sceneRoot: root });
    void fx;

    const haloSprite = root.children.find((c) => c.name === 'fx.halo.bedroom4Pendant') as
      | (THREE.Sprite & { count?: number })
      | undefined;
    expect(haloSprite).toBeDefined();
    expect(haloSprite?.count).toBe(3);

    const mat = haloSprite?.material as unknown as {
      positionNode?: {
        attribute?: THREE.BufferAttribute & {
          isInstancedBufferAttribute?: boolean;
          isInterleavedBufferAttribute?: boolean;
        };
      };
    };
    const posAttr = mat.positionNode?.attribute;
    expect(posAttr).toBeDefined();
    expect(posAttr?.isInstancedBufferAttribute).toBe(true);
    expect(posAttr?.isInterleavedBufferAttribute).not.toBe(true);
    expect(posAttr?.count).toBe(3);
  });
});
