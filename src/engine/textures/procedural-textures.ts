import * as THREE from 'three';
import {
  clearTextureRegistryCache,
  getOrCreateCachedCanvas,
  getOrCreateCachedCanvasPair,
  getOrCreateCachedTexture,
} from './texture-registry.ts';
import { createBrowserDataOrCanvasTexture } from './texture-registry.ts';

/**
 * Procedural texture generators barrel module.
 *
 * Re-exports all domain-specific procedural texture generators and the
 * deterministic canvas/texture memoization registry.
 */
export {
  derivePbrNormalAndRoughnessMaps,
  type PbrSurfaceMapOptions,
} from './pbr-surface-maps.ts';

export {
  clearTextureRegistryCache,
  getOrCreateCachedCanvas,
  getOrCreateCachedCanvasPair,
  getOrCreateCachedTexture,
};

export {
  createCementTexture,
  createCourtyardStoneTexture,
  createGraniteSettArcTexture,
  createHerringboneTerracottaQuarryTileTextures,
  createMarbleBacksplashTexture,
  SANDBERG_MIMI_SANDSTONE_REPEAT_U,
  SANDBERG_MIMI_SANDSTONE_REPEAT_V,
  createParisianManoirUpstandTextures,
  createSandbergMimiSandstoneWallpaperMaterial,
  createSandbergMimiSandstoneWallpaperTextures,
  createStoneTileTexture,
  createTumbledLimestoneFlagstoneTextures,
} from './stone-and-tile-textures.ts';

export {
  createImperialBrickTextures,
  createWelshSlateRoofTexture,
  createWelshSlateRoofTextures,
} from './roof-and-brick-textures.ts';

export {
  createBraidedCableTexture,
  createBrushedStainlessBumpTexture,
  createBrushedStainlessTexture,
  createDriftwoodTexture,
  createEngineeredOakFloorTextures,
  createPolishedChromeTexture,
} from './timber-and-metal-textures.ts';

export {
  createHawaiiArtworkTexture,
  createRadialGlowTexture,
  createTVArtGalleryTextures,
  createTVOffTexture,
  createWovenWoolCarpetTextures,
} from './furnishing-and-art-textures.ts';

export function createNaturalOakJoineryTextures(): {
  readonly colorMap: THREE.CanvasTexture;
  readonly bumpMap: THREE.CanvasTexture;
} {
  return getOrCreateCachedTexture('natural-oak-joinery', () => {
    const size = 512;
    const [colorCanvas, bumpCanvas] = getOrCreateCachedCanvasPair(
      'natural-oak-joinery',
      size,
      size,
      (cCtx, bCtx) => {
        const clampByte = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));

        // Issue #14: Richer warm honey European oak base (#be986b) so skirtings, architraves & stripped joinery
        // read as authentic warm oiled oak rather than pale bleached beige
        const baseR = 190; // #be
        const baseG = 152; // #98
        const baseB = 107; // #6b
        cCtx.fillStyle = '#be986b';
        cCtx.fillRect(0, 0, size, size);

        bCtx.fillStyle = 'rgb(196, 196, 196)';
        bCtx.fillRect(0, 0, size, size);

        // Subtle cross-board tonal variation with warm cathedral heartwood bands (#ab8356) and golden highlights (#cea97d)
        const bgGrad = cCtx.createLinearGradient(0, 0, 0, size);
        bgGrad.addColorStop(0, 'rgba(206, 169, 125, 0.32)');   // #cea97d
        bgGrad.addColorStop(0.35, 'rgba(171, 131, 86, 0.34)'); // #ab8356
        bgGrad.addColorStop(0.7, 'rgba(190, 152, 107, 0.28)'); // #be986b
        bgGrad.addColorStop(1, 'rgba(206, 169, 125, 0.32)');   // #cea97d
        cCtx.fillStyle = bgGrad;
        cCtx.fillRect(0, 0, size, size);

        // Fine longitudinal open-pore European oak fibers & #ab8356 cathedral grain
        const numFibers = 160;
        const stepX = 12;
        for (let f = 0; f < numFibers; f++) {
          const baseY = ((f + 0.5) / numFibers) * size;
          const wave =
            Math.sin(f * 0.92 + 1.3) * 4.8 +
            Math.cos(f * 2.15 + 0.7) * 3.4 +
            Math.sin(f * 0.28) * 4.2;
          const isOpenPore = wave < -2.6;
          const isSilkyRay = wave > 4.2;

          const dR = Math.round(wave * 1.05 - (isOpenPore ? 19 : 0) + (isSilkyRay ? 16 : 0));
          const dG = Math.round(wave * 1.05 - (isOpenPore ? 21 : 0) + (isSilkyRay ? 17 : 0));
          const dB = Math.round(wave * 0.95 - (isOpenPore ? 21 : 0) + (isSilkyRay ? 18 : 0));

          cCtx.strokeStyle = isOpenPore
            ? 'rgba(171, 131, 86, 0.58)' // #ab8356 cathedral grain
            : `rgba(${clampByte(baseR + dR)}, ${clampByte(baseG + dG)}, ${clampByte(baseB + dB)}, ${
                isSilkyRay ? 0.40 : 0.28
              })`;
          cCtx.lineWidth = isOpenPore ? 1.25 : 1.0;

          const bVal = clampByte(196 + (isOpenPore ? -28 : isSilkyRay ? 16 : Math.round(wave * 1.6)));
          bCtx.strokeStyle = `rgb(${bVal}, ${bVal}, ${bVal})`;
          bCtx.lineWidth = isOpenPore ? 1.25 : 1.0;

          cCtx.beginPath();
          bCtx.beginPath();
          for (let px = 0; px <= size; px += stepX) {
            const theta = (px / size) * Math.PI * 2;
            const gy =
              baseY +
              Math.sin(theta + f * 0.11) * 2.8 +
              Math.cos(theta * 2 - f * 0.07) * 1.1;
            if (px === 0) {
              cCtx.moveTo(px, gy);
              bCtx.moveTo(px, gy);
            } else {
              cCtx.lineTo(px, gy);
              bCtx.lineTo(px, gy);
            }
          }
          cCtx.stroke();
          bCtx.stroke();
        }

        // Delicate warm golden-straw medullary rays (#cea97d, characteristic of European oak skirting & doors)
        cCtx.fillStyle = '#cea97d';
        cCtx.globalAlpha = 0.26;
        for (let r = 0; r < 28; r++) {
          const rx = ((r * 79 + 23) % (size - 60)) + 20;
          const ry = ((r * 113 + 41) % (size - 24)) + 12;
          const rw = 18 + (r % 5) * 7;
          const rh = 1.6 + (r % 3) * 0.6;
          cCtx.beginPath();
          cCtx.ellipse(rx, ry, rw, rh, ((r % 3) - 1) * 0.03, 0, Math.PI * 2);
          cCtx.fill();
        }
        cCtx.globalAlpha = 1.0;
      }
    );

    const colorMap = createBrowserDataOrCanvasTexture('proc:1', colorCanvas, { colorSpace: THREE.NoColorSpace });
    colorMap.wrapS = THREE.RepeatWrapping;
    colorMap.wrapT = THREE.RepeatWrapping;
    colorMap.colorSpace = THREE.SRGBColorSpace;
    colorMap.anisotropy = 8;

    const bumpMap = createBrowserDataOrCanvasTexture('proc:2', bumpCanvas, { colorSpace: THREE.NoColorSpace });
    bumpMap.wrapS = THREE.RepeatWrapping;
    bumpMap.wrapT = THREE.RepeatWrapping;
    bumpMap.anisotropy = 8;

    return { colorMap, bumpMap };
  });
}
