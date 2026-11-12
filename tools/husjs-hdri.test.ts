import fs from 'node:fs';
import path from 'node:path';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { describe, expect, it } from 'vitest';
import {
  buildSeamlessHdrPanorama,
  decodeRadianceHdr,
  encodeGainmapDetailRgbBytes,
  encodeRadianceHdrRle,
  parseHdriCliArgs,
} from './husjs-hdri.mjs';
import { ENV_PRESETS } from '../src/engine/lighting/env/env-presets.ts';
import {
  deriveDetailWebpUrl,
  prepareHdrBuffers,
  wrapPreparedHdrBuffers,
} from '../src/engine/lighting/env/hdr-processing.ts';

function measureHorizontalWrapRms(rgba: Float32Array, width: number, height: number): number {
  let sumSq = 0;
  let count = 0;
  for (let y = 0; y < height; y++) {
    const i0 = (y * width + 0) * 4;
    const i1 = (y * width + (width - 1)) * 4;
    for (let c = 0; c < 3; c++) {
      const diff = (rgba[i0 + c] ?? 0) - (rgba[i1 + c] ?? 0);
      sumSq += diff * diff;
      count++;
    }
  }
  return Math.sqrt(sumSq / Math.max(1, count));
}

describe('tools/husjs-hdri.mjs — Radiance RLE .hdr encoder, u=0/1 seam healer & CLI', () => {
  it('parses CLI flags cleanly across presets, seasons, times, weathers & resolutions', () => {
    const parsed = parseHdriCliArgs([
      '--preset',
      'english-countryside',
      '--seasons',
      'spring,winter',
      '--times',
      'day,dusk',
      '--weathers',
      'clear,snow',
      '--refs',
      'a.png,b.jpg',
      '--res',
      '1536',
      '--preview-res',
      '512',
      '--skip-existing',
    ]);
    expect(parsed.preset).toBe('english-countryside');
    expect(parsed.seasons).toEqual(['spring', 'winter']);
    expect(parsed.times).toEqual(['day', 'dusk']);
    expect(parsed.weathers).toEqual(['clear', 'snow']);
    expect(parsed.refs).toEqual(['a.png', 'b.jpg']);
    expect(parsed.res).toBe(1536);
    expect(parsed.previewRes).toBe(512);
    expect(parsed.skipExisting).toBe(true);
  });

  it('round-trips scanline-RLE #?RADIANCE .hdr buffers through both decodeRadianceHdr and Three.js HDRLoader', () => {
    const width = 128;
    const height = 64;
    const linearRgb = new Float32Array(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 3;
        const u = x / width;
        const v = y / height;
        const sun = Math.exp(-((u - 0.6) ** 2 + (v - 0.25) ** 2) * 400) * 32.0;
        linearRgb[idx] = (x < 32 ? 0.42 : 0.18 + 0.6 * u) + sun;
        linearRgb[idx + 1] = 0.28 + 0.4 * (1 - v) + sun * 0.95;
        linearRgb[idx + 2] = (x % 2 === 0 ? 0.55 : 0.51) + sun * 0.85;
      }
    }

    const encoded = encodeRadianceHdrRle(linearRgb, width, height, 3);
    const headerAscii = Buffer.from(encoded.buffer, encoded.byteOffset, 96).toString('utf8');
    expect(headerAscii).toContain('#?RADIANCE');
    expect(headerAscii).toContain('FORMAT=32-bit_rle_rgbe');

    const decoded = decodeRadianceHdr(encoded);
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);

    const loader = new HDRLoader();
    const threeParsed = loader.parse(
      encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength)
    );
    expect(threeParsed.width).toBe(width);
    expect(threeParsed.height).toBe(height);

    for (let i = 0; i < width * height; i++) {
      const rOrig = linearRgb[i * 3]!;
      const rDec = decoded.data[i * 4]!;
      expect(Math.abs(rDec - rOrig)).toBeLessThan(Math.max(0.03, rOrig * 0.025));
    }
  });

  it('heals sharp u=0 <-> u=1 horizontal discontinuities and suppresses point sun hotspots in overcast/snow', () => {
    const srcW = 192;
    const srcH = 96;
    const srgb = new Uint8Array(srcW * srcH * 3);
    for (let y = 0; y < srcH; y++) {
      for (let x = 0; x < srcW; x++) {
        const u = x / (srcW - 1);
        const idx = (y * srcW + x) * 3;
        srgb[idx] = Math.round(40 + 180 * u);
        srgb[idx + 1] = Math.round(70 + 140 * u);
        srgb[idx + 2] = Math.round(90 + 120 * (1 - y / srcH));
      }
    }

    const img = { width: srcW, height: srcH, channels: 3, data: srgb };
    const clearPano = buildSeamlessHdrPanorama(img, {
      targetWidth: 128,
      season: 'summer',
      time: 'day',
      weather: 'clear',
    });
    const snowPano = buildSeamlessHdrPanorama(img, {
      targetWidth: 128,
      season: 'winter',
      time: 'day',
      weather: 'snow',
    });

    expect(measureHorizontalWrapRms(clearPano.data, 128, 64)).toBeLessThan(0.05);
    expect(measureHorizontalWrapRms(snowPano.data, 128, 64)).toBeLessThan(0.035);

    let clearMax = 0;
    let snowMax = 0;
    for (let i = 0; i < clearPano.data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        if (clearPano.data[i + c]! > clearMax) clearMax = clearPano.data[i + c]!;
        if (snowPano.data[i + c]! > snowMax) snowMax = snowPano.data[i + c]!;
      }
    }
    expect(clearMax).toBeGreaterThan(15.0);
    expect(snowMax).toBeLessThan(4.5);
  });

  it('ships valid, RLE-compressed, seamless .hdr suites in public/textures/hdr within budget', () => {
    const hdrDir = path.resolve(process.cwd(), 'public/textures/hdr');
    const files = fs.readdirSync(hdrDir).filter((f) => f.endsWith('.hdr'));
    expect(files.length).toBeGreaterThanOrEqual(16);

    let totalBytes = 0;
    for (const f of files) {
      totalBytes += fs.statSync(path.join(hdrDir, f)).size;
    }
    expect(totalBytes).toBeLessThanOrEqual(62 * 1024 * 1024);

    const loader = new HDRLoader();
    for (const sample of [
      'hollywood_hills_dusk_clear_512.hdr',
      'hollywood_hills_day_clear_512.hdr',
      'hollywood_hills_night_clear_512.hdr',
    ]) {
      const buf = fs.readFileSync(path.join(hdrDir, sample));
      const parsed = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      expect(parsed.width).toBe(512);
      expect(parsed.height).toBe(256);
      const decoded = decodeRadianceHdr(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
      expect(measureHorizontalWrapRms(decoded.data, decoded.width, decoded.height)).toBeLessThan(0.08);
    }
  });

  it('ships 8192x4096 *_8k.webp anchor-locked panoramas (+ legacy *_4k.webp) and fuses sharp mip=0 HalfFloat skybox while keeping compact envSource', () => {
    const hdrDir = path.resolve(process.cwd(), 'public/textures/hdr');
    const webp8kFiles = fs.readdirSync(hdrDir).filter((f) => f.endsWith('_8k.webp'));
    const webp4kFiles = fs.readdirSync(hdrDir).filter((f) => f.endsWith('_4k.webp'));
    expect(webp8kFiles.length).toBe(5);
    expect(webp4kFiles.length).toBe(3);

    let totalAllBytes = 0;
    for (const f of fs.readdirSync(hdrDir)) {
      if (f.endsWith('.hdr') || f.endsWith('.webp')) {
        totalAllBytes += fs.statSync(path.join(hdrDir, f)).size;
      }
    }
    expect(totalAllBytes).toBeLessThanOrEqual(98 * 1024 * 1024);

    expect(deriveDetailWebpUrl('/textures/hdr/hollywood_hills_dusk_clear_2k.hdr')).toBe(
      '/textures/hdr/hollywood_hills_dusk_clear_8k.webp'
    );
    expect(
      deriveDetailWebpUrl(
        '/textures/hdr/english_countryside_day_2k.hdr',
        '/textures/hdr/english_countryside_day_4k.webp'
      )
    ).toBe('/textures/hdr/english_countryside_day_4k.webp');
    expect(deriveDetailWebpUrl('/textures/hdr/hollywood_hills_dusk_clear_512.hdr')).toBeNull();

    // Verify 4x Ultra-HDR gainmap fusion preserves high-res detail dimensions & compact env dimensions
    const envW = 64;
    const envH = 32;
    const detW = 256;
    const detH = 128;
    const hdrSrc = new Float32Array(envW * envH * 4);
    for (let i = 0; i < envW * envH; i++) {
      hdrSrc[i * 4] = 0.6;
      hdrSrc[i * 4 + 1] = 0.7;
      hdrSrc[i * 4 + 2] = 0.9;
      hdrSrc[i * 4 + 3] = 1.0;
    }
    const fineLin = new Float32Array(detW * detH * 4);
    for (let y = 0; y < detH; y++) {
      for (let x = 0; x < detW; x++) {
        const checker = (x + y) % 2 === 0 ? 0.9 : 0.3;
        const o = (y * detW + x) * 4;
        fineLin[o] = 0.6 * checker;
        fineLin[o + 1] = 0.7 * checker;
        fineLin[o + 2] = 0.9 * checker;
        fineLin[o + 3] = 1.0;
      }
    }
    const rgb24 = encodeGainmapDetailRgbBytes(fineLin, detW, detH, 4);
    const rgbaDetail = new Uint8Array(detW * detH * 4);
    for (let i = 0; i < detW * detH; i++) {
      rgbaDetail[i * 4] = rgb24[i * 3]!;
      rgbaDetail[i * 4 + 1] = rgb24[i * 3 + 1]!;
      rgbaDetail[i * 4 + 2] = rgb24[i * 3 + 2]!;
      rgbaDetail[i * 4 + 3] = 255;
    }
    const raw = prepareHdrBuffers(
      hdrSrc,
      envW,
      envH,
      { ...ENV_PRESETS.day, relocateDaySun: false },
      { data: rgbaDetail, width: detW, height: detH }
    );
    const wrapped = wrapPreparedHdrBuffers(raw);
    expect(wrapped.background.image.width).toBe(detW);
    expect(wrapped.background.image.height).toBe(detH);
    expect(wrapped.envSource.image.width).toBe(envW);
    expect(wrapped.envSource.image.height).toBe(envH);
  });
});
