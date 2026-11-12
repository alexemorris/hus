import * as THREE from 'three';
import { createBrickTextures } from './brick-materials.ts';
import { getWelshSlateRoofCanvasPair } from './cobblestone-materials.ts';
import { derivePbrNormalAndRoughnessMaps } from './pbr-surface-maps.ts';
import {
  createBrowserDataOrCanvasTexture,
  getOrCreateCachedTexture,
} from './texture-registry.ts';

export function createWelshSlateRoofTextures(): {
  readonly colorMap: THREE.CanvasTexture;
  readonly bumpMap: THREE.CanvasTexture;
  readonly normalMap: THREE.CanvasTexture;
  readonly roughnessMap: THREE.Texture;
} {
  return getOrCreateCachedTexture('welsh-slate-roof', () => {
    const [colorCanvas, bumpCanvas] = getWelshSlateRoofCanvasPair();

    const colorMap = createBrowserDataOrCanvasTexture('roof-brick:1', colorCanvas, {
      colorSpace: THREE.NoColorSpace,
    });
    colorMap.wrapS = THREE.RepeatWrapping;
    colorMap.wrapT = THREE.RepeatWrapping;
    colorMap.repeat.set(7.5, 3.2);
    colorMap.colorSpace = THREE.SRGBColorSpace;
    colorMap.anisotropy = 8;

    const bumpMap = createBrowserDataOrCanvasTexture('roof-brick:2', bumpCanvas, {
      colorSpace: THREE.NoColorSpace,
    });
    bumpMap.wrapS = THREE.RepeatWrapping;
    bumpMap.wrapT = THREE.RepeatWrapping;
    bumpMap.repeat.set(7.5, 3.2);
    bumpMap.anisotropy = 8;

    const { normalMap, roughnessMap } = derivePbrNormalAndRoughnessMaps(
      'welsh-slate-roof',
      bumpCanvas,
      {
        normalStrength: 3.0,
        mortarThreshold: 0.18,
        mortarRoughness: 1.0,
        surfaceRoughnessMin: 0.72,
        surfaceRoughnessMax: 0.92,
        microGrainRoughness: 0.04,
      }
    );
    normalMap.repeat.set(7.5, 3.2);
    roughnessMap.repeat.set(7.5, 3.2);

    return { colorMap, bumpMap, normalMap, roughnessMap };
  });
}

export function createWelshSlateRoofTexture(): THREE.CanvasTexture {
  return createWelshSlateRoofTextures().colorMap;
}

export function createImperialBrickTextures(): {
  readonly colorMap: THREE.CanvasTexture;
  readonly bumpMap: THREE.CanvasTexture;
  readonly normalMap: THREE.CanvasTexture;
  readonly roughnessMap: THREE.Texture;
} {
  const { colorMap, bumpMap, normalMap, roughnessMap } = createBrickTextures('heritage-red-flemish');
  return { colorMap, bumpMap, normalMap, roughnessMap };
}
