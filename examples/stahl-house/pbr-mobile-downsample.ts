import * as THREE from 'three';
import { boxDownsampleTexels, detectMobile } from 'husjs/materials';

/** Which PBR slot a square RGBA8 texel buffer feeds, which decides its mobile resolution cap. */
export type PbrTexelKind = 'srgb' | 'linear' | 'roughness';

/**
 * Longest-edge cap applied on phones/tablets: `>= 1024` sRGB albedo keeps `512`, everything else
 * (normal, roughness, and `512` albedo) drops to `256`. Desktop returns `size` unchanged.
 */
export function resolveMobilePbrSize(size: number, kind: PbrTexelKind, isMobile: boolean): number {
  if (!isMobile) return size;
  return Math.min(size, kind === 'srgb' && size >= 1024 ? 512 : 256);
}

/**
 * Wraps a square RGBA8 texel buffer in a mip-mapped repeating `THREE.DataTexture`. On mobile
 * (`detectMobile()`), the buffer is box-downsampled to its slot's cap and `roughness` buffers are
 * packed to 2-channel `THREE.RGFormat`, so the full-resolution array is never uploaded.
 */
export function createPbrDataTex(
  data: Uint8Array,
  size: number,
  kind: PbrTexelKind,
  repeat: readonly [number, number] = [1, 1]
): THREE.DataTexture {
  const isMobile = detectMobile();
  const fit = isMobile
    ? boxDownsampleTexels(data, size, size, 4, resolveMobilePbrSize(size, kind, true))
    : null;
  let texels = fit ? fit.data : data;
  const texSize = fit ? fit.width : size;
  let format: THREE.PixelFormat = THREE.RGBAFormat;
  if (isMobile && kind === 'roughness') {
    const packed = new Uint8Array(texSize * texSize * 2);
    for (let i = 0, n = texSize * texSize; i < n; i++) {
      packed[i * 2] = texels[i * 4]!;
      packed[i * 2 + 1] = texels[i * 4 + 1]!;
    }
    texels = packed;
    format = THREE.RGFormat;
  }

  const tex = new THREE.DataTexture(texels, texSize, texSize, format);
  if (format === THREE.RGFormat) tex.unpackAlignment = 1;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.colorSpace = kind === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}
