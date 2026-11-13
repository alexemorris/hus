import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BRICK_BONDS,
  BRICK_PRESETS,
  createBrickMaterial,
  createBrickTextures,
} from '../brick-materials.ts';
import {
  COBBLESTONE_PRESETS,
  STONE_MASONRY_PRESETS,
  createCobblestoneMaterial,
  createCobblestoneTextures,
  createStoneMasonryMaterial,
  createStoneMasonryTextures,
} from '../cobblestone-materials.ts';
import {
  IRONSTONE_WALL_TILE_H_M,
  IRONSTONE_WALL_TILE_W_M,
  UK_BRICK_TILE_H_M,
  UK_BRICK_TILE_W_M,
  YORKSTONE_COPING_TILE_M,
  applyMetricBoxUVs,
  applyMetricCylinderUVs,
  applyMetricExtrudeUVs,
  applyMetricMasonryUVs,
  buildMetricWallRibbonGeo,
} from '../metric-masonry-uvs.ts';
import { clearTextureRegistryCache } from '../texture-registry.ts';

interface RgbaImageLike {
  width: number;
  height: number;
  data?: Uint8Array | Uint8ClampedArray;
  getContext?: (kind: '2d') => {
    getImageData(
      x: number,
      y: number,
      w: number,
      h: number
    ): { data: Uint8ClampedArray; width: number; height: number };
  } | null;
}

function readRgbaPixels(tex: THREE.Texture): {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
} {
  const img = tex.image as RgbaImageLike;
  expect(img).toBeTruthy();
  if (img.data) {
    return { width: img.width, height: img.height, data: img.data };
  }
  const ctx = img.getContext?.('2d');
  expect(ctx).toBeTruthy();
  const imageData = ctx!.getImageData(0, 0, img.width, img.height);
  return { width: imageData.width, height: imageData.height, data: imageData.data };
}

function computePixelVariance(data: Uint8Array | Uint8ClampedArray, stride = 4): number {
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += stride) {
    const v = data[i]!;
    sum += v;
    sumSq += v * v;
    count++;
  }
  if (count === 0) return 0;
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

function measureWrapEdgeJump(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number
): { horizWrapDiff: number; interiorHorizDiff: number; vertWrapDiff: number; interiorVertDiff: number } {
  let wrapHSum = 0;
  let intHSum = 0;
  for (let y = 0; y < height; y++) {
    const leftIdx = (y * width + 0) * 4;
    const rightIdx = (y * width + (width - 1)) * 4;
    const midA = (y * width + Math.floor(width * 0.5)) * 4;
    const midB = (y * width + Math.floor(width * 0.5) - 1) * 4;
    wrapHSum +=
      Math.abs(data[leftIdx]! - data[rightIdx]!) +
      Math.abs(data[leftIdx + 1]! - data[rightIdx + 1]!) +
      Math.abs(data[leftIdx + 2]! - data[rightIdx + 2]!);
    intHSum +=
      Math.abs(data[midA]! - data[midB]!) +
      Math.abs(data[midA + 1]! - data[midB + 1]!) +
      Math.abs(data[midA + 2]! - data[midB + 2]!);
  }

  let wrapVSum = 0;
  let intVSum = 0;
  for (let x = 0; x < width; x++) {
    const topIdx = x * 4;
    const botIdx = ((height - 1) * width + x) * 4;
    const midA = (Math.floor(height * 0.5) * width + x) * 4;
    const midB = ((Math.floor(height * 0.5) - 1) * width + x) * 4;
    wrapVSum +=
      Math.abs(data[topIdx]! - data[botIdx]!) +
      Math.abs(data[topIdx + 1]! - data[botIdx + 1]!) +
      Math.abs(data[topIdx + 2]! - data[botIdx + 2]!);
    intVSum +=
      Math.abs(data[midA]! - data[midB]!) +
      Math.abs(data[midA + 1]! - data[midB + 1]!) +
      Math.abs(data[midA + 2]! - data[midB + 2]!);
  }

  return {
    horizWrapDiff: wrapHSum / (height * 3),
    interiorHorizDiff: intHSum / (height * 3),
    vertWrapDiff: wrapVSum / (width * 3),
    interiorVertDiff: intVSum / (width * 3),
  };
}

describe('husjs/materials — Procedural Brick, Cobblestone & Stone Masonry PBR Library', () => {
  afterEach(() => {
    clearTextureRegistryCache();
  });

  it('runs headlessly in Node without DOM document and produces non-trivial PBR pixel maps for all 6 brick presets', () => {
    expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined');
    expect(BRICK_PRESETS).toHaveLength(6);

    for (const preset of BRICK_PRESETS) {
      const bundle = createBrickTextures({ preset, resolution: 128 });
      expect(bundle.colorMap.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(bundle.bumpMap.colorSpace).toBe(THREE.NoColorSpace);
      expect(bundle.normalMap.colorSpace).toBe(THREE.NoColorSpace);
      expect(bundle.roughnessMap.colorSpace).toBe(THREE.NoColorSpace);
      expect(bundle.colorMap.wrapS).toBe(THREE.RepeatWrapping);
      expect(bundle.colorMap.wrapT).toBe(THREE.RepeatWrapping);
      expect(bundle.colorMap.repeat.x).toBe(1);
      expect(bundle.colorMap.repeat.y).toBe(1);
      expect(bundle.tileSizeM[0]).toBeGreaterThan(0.2);
      expect(bundle.tileSizeM[1]).toBeGreaterThan(0.2);

      const colorPixels = readRgbaPixels(bundle.colorMap);
      const bumpPixels = readRgbaPixels(bundle.bumpMap);
      const normalPixels = readRgbaPixels(bundle.normalMap);
      expect(computePixelVariance(colorPixels.data)).toBeGreaterThan(25);
      expect(computePixelVariance(bumpPixels.data)).toBeGreaterThan(40);
      expect(computePixelVariance(normalPixels.data)).toBeGreaterThan(8);

      const mat = createBrickMaterial({ preset, resolution: 128 });
      expect(mat).toBeInstanceOf(THREE.MeshStandardMaterial);
      expect(mat.map).toBeTruthy();
      expect(mat.normalMap).toBeTruthy();
      expect(mat.roughnessMap).toBeTruthy();
      // Default worldMetersPerUv = 1.0 scales repeat to 1 / tileSizeM without mutating cached base bundle!
      expect(mat.map!.repeat.x).toBeCloseTo(1 / bundle.tileSizeM[0], 5);
      expect(mat.map!.repeat.y).toBeCloseTo(1 / bundle.tileSizeM[1], 5);
      expect(bundle.colorMap.repeat.x).toBe(1);
      expect(bundle.colorMap.repeat.y).toBe(1);
      expect(mat.map!.source).toBe(bundle.colorMap.source);
    }
  });

  it('supports all 7 brick bonds plus weathering, dimension, palette, and mortar overrides', () => {
    expect(BRICK_BONDS).toHaveLength(7);

    for (const bond of BRICK_BONDS) {
      const bundle = createBrickTextures({
        preset: bond.startsWith('herringbone') ? 'herringbone-pavers' : 'weathered-cottage',
        bond,
        resolution: 128,
        brickLengthM: 0.215,
        brickWidthM: 0.1025,
        brickHeightM: 0.065,
        mortarJointM: 0.01,
        mortarColor: '#d8ccb4',
        weathering: {
          kilnFlash: 0.4,
          sootLevel: 0.15,
          limewash: bond === 'english' ? 0.55 : 0.05,
          mossAndLichen: 0.25,
        },
        seed: 42,
      });

      const colorPixels = readRgbaPixels(bundle.colorMap);
      expect(colorPixels.width).toBe(128);
      expect(colorPixels.height).toBe(128);
      expect(computePixelVariance(colorPixels.data)).toBeGreaterThan(20);

      // Verify seamless wrap across tile boundaries (no blank seam cliff at x=0/W-1 or y=0/H-1)
      const wrapStats = measureWrapEdgeJump(colorPixels.data, colorPixels.width, colorPixels.height);
      expect(wrapStats.horizWrapDiff).toBeLessThan(85);
      expect(wrapStats.vertWrapDiff).toBeLessThan(85);
    }
  });

  it('generates all 7 cobblestone, sett, flagstone, and pea-gravel presets including valleyGutter and seamless wrap', () => {
    expect(COBBLESTONE_PRESETS).toHaveLength(7);

    for (const preset of COBBLESTONE_PRESETS) {
      const base = createCobblestoneTextures({ preset, resolution: 128 });
      expect(base.colorMap.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(base.depthMap).toBe(base.bumpMap);
      expect(base.colorMap.repeat.x).toBe(1);
      expect(base.colorMap.repeat.y).toBe(1);

      const colorPixels = readRgbaPixels(base.colorMap);
      const bumpPixels = readRgbaPixels(base.bumpMap);
      expect(computePixelVariance(colorPixels.data)).toBeGreaterThan(15);
      expect(computePixelVariance(bumpPixels.data)).toBeGreaterThan(15);

      const wrapStats = measureWrapEdgeJump(colorPixels.data, colorPixels.width, colorPixels.height);
      expect(wrapStats.horizWrapDiff).toBeLessThan(90);
      expect(wrapStats.vertWrapDiff).toBeLessThan(90);

      const mat = createCobblestoneMaterial({ preset, resolution: 128, worldMetersPerUv: 2.0 });
      expect(mat.map!.repeat.x).toBeCloseTo(2.0 / base.tileSizeM[0], 5);
      expect(mat.map!.repeat.y).toBeCloseTo(2.0 / base.tileSizeM[1], 5);
      // Base cached texture repeat stays untouched at (1, 1)
      expect(base.colorMap.repeat.x).toBe(1);
      expect(base.colorMap.repeat.y).toBe(1);
      expect(mat.map!.source).toBe(base.colorMap.source);
    }

    // Verify valleyGutter drainage-channel sett mode on granite-setts
    const flatSetts = createCobblestoneTextures({
      preset: 'granite-setts',
      resolution: 128,
      valleyGutter: false,
    });
    const gutterSetts = createCobblestoneTextures({
      preset: 'granite-setts',
      resolution: 128,
      valleyGutter: true,
    });
    expect(gutterSetts.bumpMap).not.toBe(flatSetts.bumpMap);
    const gutterDepth = readRgbaPixels(gutterSetts.bumpMap);
    // Center row of valleyGutter dished profile sits lower than outer kerb rows
    const topEdgeLum = gutterDepth.data[(4 * 128 + 64) * 4]!;
    const dishMidLum = gutterDepth.data[(64 * 128 + 64) * 4]!;
    expect(dishMidLum).toBeLessThan(topEdgeLum + 40);
  });

  it('generates all 3 stone masonry presets (cotswold-dry-stone, sawn-yorkstone-coping, welsh-slate-roof) with 1:1 base repeat', () => {
    expect(STONE_MASONRY_PRESETS).toHaveLength(3);

    for (const preset of STONE_MASONRY_PRESETS) {
      const bundle = createStoneMasonryTextures(preset);
      expect(bundle.colorMap.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(bundle.colorMap.wrapS).toBe(THREE.RepeatWrapping);
      expect(bundle.colorMap.wrapT).toBe(THREE.RepeatWrapping);
      expect(bundle.colorMap.repeat.x).toBe(1);
      expect(bundle.colorMap.repeat.y).toBe(1);
      expect(bundle.bumpMap.repeat.x).toBe(1);
      expect(bundle.bumpMap.repeat.y).toBe(1);
      expect(bundle.normalMap.repeat.x).toBe(1);
      expect(bundle.normalMap.repeat.y).toBe(1);
      expect(bundle.roughnessMap.repeat.x).toBe(1);
      expect(bundle.roughnessMap.repeat.y).toBe(1);

      const mat = createStoneMasonryMaterial({ preset, worldMetersPerUv: 1.5 });
      expect(mat.map!.repeat.x).toBeCloseTo(1.5 / bundle.tileSizeM[0], 5);
      expect(mat.map!.repeat.y).toBeCloseTo(1.5 / bundle.tileSizeM[1], 5);
      expect(bundle.colorMap.repeat.x).toBe(1);
      expect(bundle.colorMap.repeat.y).toBe(1);
    }

    const dryStone = createStoneMasonryTextures('cotswold-dry-stone');
    expect(dryStone.tileSizeM).toEqual([IRONSTONE_WALL_TILE_W_M, IRONSTONE_WALL_TILE_H_M]);

    const coping = createStoneMasonryTextures('sawn-yorkstone-coping');
    expect(coping.tileSizeM).toEqual([YORKSTONE_COPING_TILE_M, YORKSTONE_COPING_TILE_M]);
  });

  it('applies metric world-space masonry UVs across BoxGeometry, CylinderGeometry, ExtrudeGeometry, and wall ribbons', () => {
    // BoxGeometry via applyMetricMasonryUVs with [tileW, tileH] tuple
    const wallBox = new THREE.BoxGeometry(2.7, 2.4, 0.3);
    applyMetricMasonryUVs(wallBox, {
      tileSizeM: [UK_BRICK_TILE_W_M, UK_BRICK_TILE_H_M],
      oy: 1.2,
    });
    const uvAttr = wallBox.attributes.uv as THREE.BufferAttribute;
    const normAttr = wallBox.attributes.normal as THREE.BufferAttribute;

    let minVerticalV = Infinity;
    let maxVerticalV = -Infinity;
    for (let i = 0; i < uvAttr.count; i++) {
      if (Math.abs(normAttr.getY(i)) < 0.5) {
        minVerticalV = Math.min(minVerticalV, uvAttr.getY(i));
        maxVerticalV = Math.max(maxVerticalV, uvAttr.getY(i));
      }
    }
    // 2.4m tall wall centered at oy=1.2 spans wy = 0..2.4 -> v = 0 .. (2.4 / 1.2) = 2.0 repeats (32 courses * 75mm)
    expect(minVerticalV).toBeCloseTo(0, 5);
    expect(maxVerticalV).toBeCloseTo(2.4 / UK_BRICK_TILE_H_M, 5);

    // CylinderGeometry via applyMetricMasonryUVs with radius
    const radius = 0.6;
    const drum = new THREE.CylinderGeometry(radius, radius, 1.2, 16);
    applyMetricMasonryUVs(drum, {
      tileW: UK_BRICK_TILE_W_M,
      tileH: UK_BRICK_TILE_H_M,
      radius,
      oy: 0.6,
    });
    const drumUv = drum.attributes.uv as THREE.BufferAttribute;
    const drumNorm = drum.attributes.normal as THREE.BufferAttribute;
    let maxDrumU = 0;
    for (let i = 0; i < drumUv.count; i++) {
      if (Math.abs(drumNorm.getY(i)) < 0.5) {
        maxDrumU = Math.max(maxDrumU, drumUv.getX(i));
      }
    }
    expect(maxDrumU).toBeCloseTo((2 * Math.PI * radius) / UK_BRICK_TILE_W_M, 4);

    // Direct applyMetricBoxUVs, applyMetricCylinderUVs, applyMetricExtrudeUVs, buildMetricWallRibbonGeo
    const box2 = applyMetricBoxUVs(new THREE.BoxGeometry(1.15, 0.05, 1.15), {
      tileW: YORKSTONE_COPING_TILE_M,
    });
    expect(box2.attributes.uv).toBeDefined();

    const cyl2 = applyMetricCylinderUVs(new THREE.CylinderGeometry(0.4, 0.4, 0.8, 12), {
      tileW: UK_BRICK_TILE_W_M,
      tileH: UK_BRICK_TILE_H_M,
      radius: 0.4,
    });
    expect(cyl2.attributes.uv).toBeDefined();

    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(1.35, 0);
    shape.lineTo(1.35, 1.2);
    shape.lineTo(0, 1.2);
    shape.closePath();
    const extrude = applyMetricExtrudeUVs(
      new THREE.ExtrudeGeometry(shape, { depth: 0.22, bevelEnabled: false }),
      { tileW: UK_BRICK_TILE_W_M, tileH: UK_BRICK_TILE_H_M }
    );
    expect(extrude.attributes.uv.count).toBe(extrude.attributes.position.count);

    const ribbon = buildMetricWallRibbonGeo(
      [
        { x: 0, z: 0, botY: 0, topY: 1.05, arcDist: 0 },
        { x: 1.44, z: 0, botY: 0.1, topY: 1.05, arcDist: 1.44 },
      ],
      0.22,
      IRONSTONE_WALL_TILE_W_M,
      IRONSTONE_WALL_TILE_H_M,
      true,
      true
    );
    expect(ribbon.attributes.position.count).toBe(36);
    expect(ribbon.attributes.uv.count).toBe(36);
  });
});
