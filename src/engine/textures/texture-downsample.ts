/**
 * Pure typed-array box-filter downsampling for 8-bit `R8` / `RG8` / `RGBA8` texel buffers,
 * used to cap procedural PBR texture resolution on memory-constrained mobile GPUs.
 */

export interface DownsampledTexelBuffer {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/**
 * Returns the `[width, height]` a `srcW x srcH` buffer shrinks to so its longest edge is
 * `<= maxDimension`, using the smallest integer reduction factor.
 */
export function resolveBoxDownsampleSize(
  srcW: number,
  srcH: number,
  maxDimension: number
): readonly [number, number] {
  const longest = Math.max(srcW, srcH);
  if (longest <= maxDimension || maxDimension <= 0) return [srcW, srcH];
  const factor = Math.ceil(longest / maxDimension);
  return [Math.max(1, Math.round(srcW / factor)), Math.max(1, Math.round(srcH / factor))];
}

/**
 * Area-averages an interleaved 8-bit texel buffer down to `<= maxDimension` on its longest edge.
 * `RGBA8` colour is alpha-weighted so sparse emissive/alpha-masked texels (street-light grids,
 * decals) keep their brightness instead of being diluted by transparent black neighbours.
 * Returns `null` when the buffer already fits or is malformed.
 */
export function boxDownsampleTexels(
  src: Uint8Array | Uint8ClampedArray,
  srcW: number,
  srcH: number,
  channels: 1 | 2 | 4,
  maxDimension: number
): DownsampledTexelBuffer | null {
  if (srcW <= 0 || srcH <= 0 || src.length < srcW * srcH * channels) return null;
  const [dstW, dstH] = resolveBoxDownsampleSize(srcW, srcH, maxDimension);
  if (dstW === srcW && dstH === srcH) return null;

  const data = new Uint8Array(dstW * dstH * channels);
  const x0Lut = new Int32Array(dstW + 1);
  for (let x = 0; x <= dstW; x++) {
    x0Lut[x] = Math.min(srcW, Math.floor((x * srcW) / dstW));
  }

  for (let y = 0; y < dstH; y++) {
    const sy0 = Math.min(srcH - 1, Math.floor((y * srcH) / dstH));
    const sy1 = Math.max(sy0 + 1, Math.min(srcH, Math.floor(((y + 1) * srcH) / dstH)));
    for (let x = 0; x < dstW; x++) {
      const sx0 = Math.min(srcW - 1, x0Lut[x]!);
      const sx1 = Math.max(sx0 + 1, x0Lut[x + 1]!);
      const count = (sx1 - sx0) * (sy1 - sy0);
      const half = count >> 1;
      const dst = (y * dstW + x) * channels;

      if (channels === 4) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        let wr = 0;
        let wg = 0;
        let wb = 0;
        for (let sy = sy0; sy < sy1; sy++) {
          let i = (sy * srcW + sx0) * 4;
          for (let sx = sx0; sx < sx1; sx++, i += 4) {
            const alpha = src[i + 3]!;
            r += src[i]!;
            g += src[i + 1]!;
            b += src[i + 2]!;
            a += alpha;
            wr += src[i]! * alpha;
            wg += src[i + 1]! * alpha;
            wb += src[i + 2]! * alpha;
          }
        }
        if (a > 0 && a < count * 255) {
          const halfA = a >> 1;
          data[dst] = Math.min(255, Math.floor((wr + halfA) / a));
          data[dst + 1] = Math.min(255, Math.floor((wg + halfA) / a));
          data[dst + 2] = Math.min(255, Math.floor((wb + halfA) / a));
        } else {
          data[dst] = Math.floor((r + half) / count);
          data[dst + 1] = Math.floor((g + half) / count);
          data[dst + 2] = Math.floor((b + half) / count);
        }
        data[dst + 3] = Math.floor((a + half) / count);
      } else {
        for (let c = 0; c < channels; c++) {
          let sum = 0;
          for (let sy = sy0; sy < sy1; sy++) {
            let i = (sy * srcW + sx0) * channels + c;
            for (let sx = sx0; sx < sx1; sx++, i += channels) {
              sum += src[i]!;
            }
          }
          data[dst + c] = Math.floor((sum + half) / count);
        }
      }
    }
  }
  return { data, width: dstW, height: dstH };
}
