import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  createTerrainSampler,
  type HusGridDocument,
} from '../src/core/geo/terrain-modifiers.ts';
import {
  buildHusGrid,
  buildHusGridFromDefraWcs,
  buildHusGridFromTerrarium,
  buildHusGridFromUsgs3dep,
  decodeFloat32GeoTiff,
  resolveAutoTerrainSource,
  wgs84ToOsgb36Grid,
  decodePng,
  decodeTerrariumElevationTile,
  elevationMToTerrariumRgb,
  latLonToGlobalMercatorPixel,
  localWorldToLatLon,
  paethPredictor,
  parseCliArgs,
  quantizeRelativeHeightGrid,
  runTerrainCli,
  selectQuantizationScaleM,
  terrariumRgbToElevationM,
} from './husjs-terrain.mjs';

function makePngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + data.byteLength + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.byteLength, false);
  for (let i = 0; i < 4; i++) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(data, 8);
  // 4-byte CRC placeholder (decoder validates structure & zlib stream)
  view.setUint32(8 + data.byteLength, 0, false);
  return out;
}

/**
 * Encodes a synthetic 8-bit RGB (`colorType = 2`) or RGBA (`colorType = 6`) PNG
 * using an arbitrary per-row filter schedule (`0..4`, including Paeth `4`).
 */
function encodeSyntheticPng(
  width: number,
  height: number,
  colorType: 2 | 6,
  pixels: Uint8Array,
  rowFilters: readonly number[]
): Uint8Array {
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const rawScanlines = new Uint8Array(height * (1 + stride));

  for (let row = 0; row < height; row++) {
    const filter = rowFilters[row % rowFilters.length] ?? 0;
    const dstRow = row * (1 + stride);
    rawScanlines[dstRow] = filter;
    const curOff = row * stride;
    const prevOff = (row - 1) * stride;

    for (let i = 0; i < stride; i++) {
      const x = pixels[curOff + i]!;
      const a = i >= channels ? pixels[curOff + i - channels]! : 0;
      const b = row > 0 ? pixels[prevOff + i]! : 0;
      const c = row > 0 && i >= channels ? pixels[prevOff + i - channels]! : 0;
      let filtered = x;
      if (filter === 1) filtered = (x - a) & 0xff;
      else if (filter === 2) filtered = (x - b) & 0xff;
      else if (filter === 3) filtered = (x - ((a + b) >> 1)) & 0xff;
      else if (filter === 4) filtered = (x - paethPredictor(a, b, c)) & 0xff;
      rawScanlines[dstRow + 1 + i] = filtered;
    }
  }

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8; // bitDepth
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = deflateSync(rawScanlines);
  // Split across 2 IDAT chunks to exercise multi-IDAT concatenation
  const mid = Math.max(1, compressed.byteLength >> 1);
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks = [
    sig,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', compressed.subarray(0, mid)),
    makePngChunk('IDAT', compressed.subarray(mid)),
    makePngChunk('IEND', new Uint8Array(0)),
  ];

  const totalLen = chunks.reduce((acc, c) => acc + c.byteLength, 0);
  const png = new Uint8Array(totalLen);
  let pos = 0;
  for (const c of chunks) {
    png.set(c, pos);
    pos += c.byteLength;
  }
  return png;
}

describe('husjs-terrain: pure Node PNG decoder & AWS Terrarium math', () => {
  it('decodes 8-bit RGB and RGBA PNGs across all 5 scanline filters (None, Sub, Up, Average, Paeth)', () => {
    const w = 17;
    const h = 15;
    const rgb = new Uint8Array(w * h * 3);
    for (let i = 0; i < rgb.length; i++) {
      rgb[i] = (i * 73 + (i >> 3) * 19 + 41) & 0xff;
    }
    const pngRgb = encodeSyntheticPng(w, h, 2, rgb, [0, 1, 2, 3, 4]);
    const decodedRgb = decodePng(pngRgb);
    expect(decodedRgb.width).toBe(w);
    expect(decodedRgb.height).toBe(h);
    expect(decodedRgb.channels).toBe(3);
    expect(Array.from(decodedRgb.data)).toEqual(Array.from(rgb));

    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < rgba.length; i++) {
      rgba[i] = (i * 131 + 17) & 0xff;
    }
    const pngRgba = encodeSyntheticPng(w, h, 6, rgba, [4, 3, 2, 1, 0]);
    const decodedRgba = decodePng(pngRgba);
    expect(decodedRgba.channels).toBe(4);
    expect(Array.from(decodedRgba.data)).toEqual(Array.from(rgba));
  });

  it('computes exact AWS Terrarium elevations (R*256 + G + B/256) - 32768', () => {
    // Sea level 0.0 m -> R=128, G=0, B=0
    expect(terrariumRgbToElevationM(128, 0, 0)).toBe(0);
    // Dead Sea -413.25 m -> 32354.75 -> R=126, G=98, B=192
    const [rDead, gDead, bDead] = elevationMToTerrariumRgb(-413.25);
    expect([rDead, gDead, bDead]).toEqual([126, 98, 192]);
    expect(terrariumRgbToElevationM(rDead, gDead, bDead)).toBeCloseTo(-413.25, 6);

    // Hollywood Hills ~312.625 m
    const [rStahl, gStahl, bStahl] = elevationMToTerrariumRgb(312.625);
    expect(terrariumRgbToElevationM(rStahl, gStahl, bStahl)).toBeCloseTo(312.625, 6);

    // Decode a synthetic 4x4 Terrarium tile
    const pixels = new Uint8Array(4 * 4 * 3);
    for (let i = 0; i < 16; i++) {
      const [r, g, b] = elevationMToTerrariumRgb(100 + i * 12.5);
      pixels[i * 3] = r;
      pixels[i * 3 + 1] = g;
      pixels[i * 3 + 2] = b;
    }
    const tile = decodeTerrariumElevationTile(
      decodePng(encodeSyntheticPng(4, 4, 2, pixels, [0, 4, 1, 3]))
    );
    expect(tile.elevationsM[0]).toBeCloseTo(100, 5);
    expect(tile.elevationsM[15]).toBeCloseTo(100 + 15 * 12.5, 5);
  });

  it('computes Web Mercator tile coordinates and right-handed ENU local offsets accurately', () => {
    // Hollywood Hills (34.1003, -118.3698) at zoom 15
    const merc = latLonToGlobalMercatorPixel(34.1003, -118.3698, 15);
    expect(merc.tileX).toBe(5609);
    expect(merc.tileY).toBe(13078);

    // Standard ENU (northOffsetDeg = 90): +X = East (+lon), -Z = True North (+lat)
    const east100 = localWorldToLatLon(100, 0, 51.84, -1.79, 90);
    expect(east100.dEastM).toBeCloseTo(100, 6);
    expect(east100.dNorthM).toBeCloseTo(0, 6);
    expect(east100.lon).toBeGreaterThan(-1.79);
    expect(east100.lat).toBeCloseTo(51.84, 6);

    const north100 = localWorldToLatLon(0, -100, 51.84, -1.79, 90);
    expect(north100.dNorthM).toBeCloseTo(100, 6);
    expect(north100.lat).toBeGreaterThan(51.84);
  });

  it('quantizes steep canyon relief (> 120 m) without Int16 overflow and round-trips into createTerrainSampler', async () => {
    expect(selectQuantizationScaleM(18.5)).toBe(0.001);
    expect(selectQuantizationScaleM(145.0)).toBe(0.01);
    expect(selectQuantizationScaleM(950.0)).toBe(0.1);

    const steepRel = new Float32Array([-128.44, -45.12, 33.8, 142.67]);
    const spec = quantizeRelativeHeightGrid({
      minX: -100,
      maxX: 100,
      minZ: -100,
      maxZ: 100,
      step: 200,
      cols: 2,
      rows: 2,
      relativeHeightsM: steepRel,
    });
    expect(spec.scaleM).toBe(0.01);

    // End-to-end buildHusGridFromTerrarium with mocked 256x256 PNG tiles encoding a steep canyon plane:
    // elevationM(gx, gy) = 300 + (gx - gx0) * 3.5 - (gy - gy0) * 2.5 (over ~120 m relief!)
    const lat0 = 34.1003;
    const lon0 = -118.3698;
    const zoom = 15;
    const originMerc = latLonToGlobalMercatorPixel(lat0, lon0, zoom, 256);

    const doc = (await buildHusGridFromTerrarium({
      lat: lat0,
      lon: lon0,
      sizeM: 300,
      stepM: 10,
      zoom,
      fetchTilePng: async (_z, tx, ty) => {
        const pixels = new Uint8Array(256 * 256 * 3);
        for (let py = 0; py < 256; py++) {
          for (let px = 0; px < 256; px++) {
            const gx = tx * 256 + px;
            const gy = ty * 256 + py;
            const elev = 300 + (gx - originMerc.pixelX) * 2.2 - (gy - originMerc.pixelY) * 1.8;
            const [r, g, b] = elevationMToTerrariumRgb(elev);
            const idx = (py * 256 + px) * 3;
            pixels[idx] = r;
            pixels[idx + 1] = g;
            pixels[idx + 2] = b;
          }
        }
        return encodeSyntheticPng(256, 256, 2, pixels, [0, 1, 2, 3, 4]);
      },
    })) as HusGridDocument;

    expect(doc.format).toBe('husgrid-v1');
    expect(doc.origin.datumElevationM).toBeCloseTo(300, 1);
    expect(doc.grids).toHaveLength(1);
    expect(doc.grids[0]!.scaleM).toBe(0.01); // Steep > 32m relief auto-selected 1cm scale!

    const sampler = createTerrainSampler({ base: doc });
    // Origin (0, 0) is anchored to 0.00 m relative to datumElevationM
    expect(sampler.sampleTerrainY(0, 0)).toBeCloseTo(0, 1);
    // East (+X) & North (-Z) climb well past +32.7m without clipping!
    expect(sampler.sampleTerrainY(150, -150)).toBeGreaterThan(100);
    expect(sampler.sampleTerrainY(-150, 150)).toBeLessThan(-100);
  });

  it('parses CLI flags including negative longitudes', () => {
    const parsed = parseCliArgs([
      '--lat',
      '34.1003',
      '--lon',
      '-118.3698',
      '--size',
      '300',
      '--step',
      '5',
      '--zoom',
      '14',
      '--north-offset',
      '90',
      '--out',
      '/tmp/test.husgrid.json',
    ]);
    expect(parsed).toEqual({
      help: false,
      lat: 34.1003,
      lon: -118.3698,
      sizeM: 300,
      stepM: 5,
      zoom: 14,
      northOffsetDeg: 90,
      outPath: '/tmp/test.husgrid.json',
    });
  });

  it('parses --skirt as an optional positive number and documents it in --help', async () => {
    const base = ['--lat', '34.1003', '--lon', '-118.3698'];
    expect(parseCliArgs(base).skirtM).toBeUndefined();
    expect(parseCliArgs([...base, '--skirt', '900']).skirtM).toBe(900);
    expect(parseCliArgs([...base, '--skirt=1200.5']).skirtM).toBe(1200.5);
    expect(() => parseCliArgs([...base, '--skirt', '0'])).toThrow(/--skirt must be a positive number/);
    expect(() => parseCliArgs([...base, '--skirt', '-50'])).toThrow(/--skirt must be a positive number/);
    expect(() => parseCliArgs([...base, '--skirt', 'wide'])).toThrow(/Invalid numeric value for --skirt/);

    const lines: string[] = [];
    await runTerrainCli(['--help'], { log: (line: string) => lines.push(line) });
    expect(lines.join('\n')).toContain('--skirt <metres>');
  });

  it('adds a coarser concentric skirt grid sharing the inner datum and a single tile fetch batch', async () => {
    const lat0 = 34.1003;
    const lon0 = -118.3698;
    const zoom = 15;
    const originMerc = latLonToGlobalMercatorPixel(lat0, lon0, zoom, 256);
    const planeElevationM = (gx: number, gy: number): number =>
      300 + (gx - originMerc.pixelX) * 0.5 - (gy - originMerc.pixelY) * 0.4;

    const fetchedTiles: string[] = [];
    let fetchesStarted = 0;
    let fetchesStartedAtFirstResolve = -1;
    const fetchTilePng = async (_z: number, tx: number, ty: number): Promise<Uint8Array> => {
      fetchedTiles.push(`${tx}/${ty}`);
      fetchesStarted++;
      await Promise.resolve();
      if (fetchesStartedAtFirstResolve < 0) fetchesStartedAtFirstResolve = fetchesStarted;
      const pixels = new Uint8Array(256 * 256 * 3);
      for (let py = 0; py < 256; py++) {
        for (let px = 0; px < 256; px++) {
          const [r, g, b] = elevationMToTerrariumRgb(planeElevationM(tx * 256 + px, ty * 256 + py));
          const idx = (py * 256 + px) * 3;
          pixels[idx] = r;
          pixels[idx + 1] = g;
          pixels[idx + 2] = b;
        }
      }
      return encodeSyntheticPng(256, 256, 2, pixels, [0]);
    };

    const doc = (await buildHusGridFromTerrarium({
      lat: lat0,
      lon: lon0,
      sizeM: 300,
      stepM: 10,
      skirtM: 900,
      zoom,
      fetchTilePng,
    })) as HusGridDocument;

    expect(doc.grids).toHaveLength(2);
    const [inner, outer] = doc.grids as [HusGridDocument['grids'][number], HusGridDocument['grids'][number]];
    expect([inner.minX, inner.maxX, inner.minZ, inner.maxZ, inner.step]).toEqual([-150, 150, -150, 150, 10]);
    expect([inner.cols, inner.rows]).toEqual([31, 31]);
    expect(inner.blendMarginM).toBe(40);
    expect([outer.minX, outer.maxX, outer.minZ, outer.maxZ, outer.step]).toEqual([-450, 450, -450, 450, 20]);
    expect([outer.cols, outer.rows]).toEqual([46, 46]);
    expect(outer.blendMarginM).toBeUndefined();

    // Every tile is requested exactly once, and all requests start before any tile resolves.
    expect(new Set(fetchedTiles).size).toBe(fetchedTiles.length);
    expect(fetchesStartedAtFirstResolve).toBe(fetchedTiles.length);

    const expectedRelativeM = (wx: number, wz: number): number => {
      const pt = localWorldToLatLon(wx, wz, lat0, lon0, 90);
      const mp = latLonToGlobalMercatorPixel(pt.lat, pt.lon, zoom, 256);
      return planeElevationM(mp.pixelX, mp.pixelY) - doc.origin.datumElevationM;
    };

    const sampler = createTerrainSampler({ base: doc });
    expect(sampler.sampleTerrainY(0, 0)).toBeCloseTo(0, 1);
    const probes: readonly (readonly [number, number])[] = [
      [60, -45],
      [149, 0],
      [151, 0],
      [130, 130],
      [-300, 220],
      [440, -440],
    ];
    for (const [wx, wz] of probes) {
      expect(Math.abs(sampler.sampleTerrainY(wx, wz) - expectedRelativeM(wx, wz))).toBeLessThan(0.15);
    }
    // The skirt carries real relief beyond the inner grid instead of clamping at its edge.
    expect(sampler.sampleTerrainY(440, -440)).toBeGreaterThan(sampler.sampleTerrainY(150, -150) + 30);

    const explicitStep = (await buildHusGridFromTerrarium({
      lat: lat0,
      lon: lon0,
      sizeM: 300,
      stepM: 10,
      skirtM: 900,
      skirtStepM: 50,
      zoom,
      fetchTilePng,
    })) as HusGridDocument;
    expect(explicitStep.grids[1]!.step).toBe(50);
    expect(explicitStep.grids[1]!.cols).toBe(19);
  });

  it('keeps a single grid when --skirt does not exceed --size and rejects invalid skirts', async () => {
    const flatTile = async (): Promise<Uint8Array> => {
      const pixels = new Uint8Array(256 * 256 * 3);
      const [r, g, b] = elevationMToTerrariumRgb(120);
      for (let i = 0; i < 256 * 256; i++) {
        pixels[i * 3] = r;
        pixels[i * 3 + 1] = g;
        pixels[i * 3 + 2] = b;
      }
      return encodeSyntheticPng(256, 256, 2, pixels, [0]);
    };
    const common = { lat: 51.84, lon: -1.79, sizeM: 300, stepM: 20, fetchTilePng: flatTile };

    const withoutSkirt = (await buildHusGridFromTerrarium(common)) as HusGridDocument;
    for (const skirtM of [300, 120]) {
      const doc = (await buildHusGridFromTerrarium({ ...common, skirtM })) as HusGridDocument;
      expect(doc).toEqual(withoutSkirt);
      expect(doc.grids).toHaveLength(1);
      expect(doc.grids[0]!.blendMarginM).toBeUndefined();
    }

    for (const skirtM of [0, -900, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(buildHusGridFromTerrarium({ ...common, skirtM })).rejects.toThrow(
        /--skirt must be a positive number/
      );
    }
  });
});

function encodeSyntheticFloat32GeoTiff(options: {
  width: number;
  height: number;
  values: Float32Array;
  bigEndian?: boolean;
  originX: number;
  originY: number;
  scaleX: number;
  scaleY: number;
}): Uint8Array {
  const { width, height, values, bigEndian = false, originX, originY, scaleX, scaleY } = options;
  const le = !bigEndian;
  const entryCount = 9;
  const ifdOffset = 8;
  const extraOffset = ifdOffset + 2 + entryCount * 12 + 4;
  const pixelScaleOffset = extraOffset; // 3 * 8 = 24 bytes
  const tiepointOffset = pixelScaleOffset + 24; // 6 * 8 = 48 bytes
  const dataOffset = tiepointOffset + 48;
  const dataByteLen = width * height * 4;
  const buf = new ArrayBuffer(dataOffset + dataByteLen);
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);

  u8[0] = le ? 0x49 : 0x4d;
  u8[1] = le ? 0x49 : 0x4d;
  view.setUint16(2, 42, le);
  view.setUint32(4, ifdOffset, le);
  view.setUint16(ifdOffset, entryCount, le);

  let pos = ifdOffset + 2;
  const writeEntry = (tag: number, type: number, count: number, valueOrOffset: number) => {
    view.setUint16(pos, tag, le);
    view.setUint16(pos + 2, type, le);
    view.setUint32(pos + 4, count, le);
    if (type === 3 && count === 1) {
      view.setUint16(pos + 8, valueOrOffset, le);
    } else {
      view.setUint32(pos + 8, valueOrOffset, le);
    }
    pos += 12;
  };

  writeEntry(256, 3, 1, width); // ImageWidth
  writeEntry(257, 3, 1, height); // ImageLength
  writeEntry(258, 3, 1, 32); // BitsPerSample = 32
  writeEntry(259, 3, 1, 1); // Compression = None
  writeEntry(273, 4, 1, dataOffset); // StripOffsets
  writeEntry(278, 3, 1, height); // RowsPerStrip
  writeEntry(279, 4, 1, dataByteLen); // StripByteCounts
  writeEntry(339, 3, 1, 3); // SampleFormat = IEEEFP
  writeEntry(33550, 12, 3, pixelScaleOffset); // ModelPixelScaleTag

  // Overwrite last entry count+1 -> actually add ModelTiepointTag cleanly by bumping entryCount=10:
  return buf ? encodeSyntheticFloat32GeoTiffWithTiepoint(options) : u8;
}

function encodeSyntheticFloat32GeoTiffWithTiepoint(options: {
  width: number;
  height: number;
  values: Float32Array;
  bigEndian?: boolean;
  originX: number;
  originY: number;
  scaleX: number;
  scaleY: number;
}): Uint8Array {
  const { width, height, values, bigEndian = false, originX, originY, scaleX, scaleY } = options;
  const le = !bigEndian;
  const entryCount = 10;
  const ifdOffset = 8;
  const pixelScaleOffset = ifdOffset + 2 + entryCount * 12 + 4;
  const tiepointOffset = pixelScaleOffset + 24;
  const dataOffset = tiepointOffset + 48;
  const dataByteLen = width * height * 4;
  const buf = new ArrayBuffer(dataOffset + dataByteLen);
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);

  u8[0] = le ? 0x49 : 0x4d;
  u8[1] = le ? 0x49 : 0x4d;
  view.setUint16(2, 42, le);
  view.setUint32(4, ifdOffset, le);
  view.setUint16(ifdOffset, entryCount, le);

  let pos = ifdOffset + 2;
  const writeEntry = (tag: number, type: number, count: number, valueOrOffset: number) => {
    view.setUint16(pos, tag, le);
    view.setUint16(pos + 2, type, le);
    view.setUint32(pos + 4, count, le);
    if (type === 3 && count === 1) {
      view.setUint16(pos + 8, valueOrOffset, le);
    } else {
      view.setUint32(pos + 8, valueOrOffset, le);
    }
    pos += 12;
  };

  writeEntry(256, 3, 1, width);
  writeEntry(257, 3, 1, height);
  writeEntry(258, 3, 1, 32);
  writeEntry(259, 3, 1, 1);
  writeEntry(273, 4, 1, dataOffset);
  writeEntry(278, 3, 1, height);
  writeEntry(279, 4, 1, dataByteLen);
  writeEntry(339, 3, 1, 3);
  writeEntry(33550, 12, 3, pixelScaleOffset);
  writeEntry(33922, 12, 6, tiepointOffset);
  view.setUint32(pos, 0, le);

  view.setFloat64(pixelScaleOffset, scaleX, le);
  view.setFloat64(pixelScaleOffset + 8, scaleY, le);
  view.setFloat64(pixelScaleOffset + 16, 0, le);

  view.setFloat64(tiepointOffset + 24, originX, le);
  view.setFloat64(tiepointOffset + 32, originY, le);

  for (let i = 0; i < values.length; i++) {
    view.setFloat32(dataOffset + i * 4, values[i]!, le);
  }
  return u8;
}

describe("USGS 3DEP 1m & DEFRA 1m Float32 GeoTIFF pipeline", () => {
  it("decodes little-endian (USGS 3DEP) and big-endian (DEFRA WCS) Float32 GeoTIFFs and routes --source auto", () => {
    const vals = new Float32Array([240.2, 239.0, 225.5, 210.25]);
    for (const bigEndian of [false, true]) {
      const bytes = encodeSyntheticFloat32GeoTiff({
        width: 2,
        height: 2,
        values: vals,
        bigEndian,
        originX: -118.371,
        originY: 34.101,
        scaleX: 0.00001,
        scaleY: 0.00001,
      });
      const decoded = decodeFloat32GeoTiff(bytes);
      expect(decoded.width).toBe(2);
      expect(decoded.height).toBe(2);
      expect(decoded.elevationsM[0]).toBeCloseTo(240.2, 3);
      expect(decoded.elevationsM[3]).toBeCloseTo(210.25, 3);
      expect(decoded.originX).toBeCloseTo(-118.371, 6);
      expect(decoded.pixelSizeX).toBeCloseTo(0.00001, 8);
    }

    expect(resolveAutoTerrainSource(34.100437, -118.370152)).toBe("usgs-3dep");
    expect(resolveAutoTerrainSource(51.84, -1.79)).toBe("defra");
    expect(resolveAutoTerrainSource(48.8566, 2.3522)).toBe("terrarium");

    const osgb = wgs84ToOsgb36Grid(51.84, -1.79);
    expect(osgb.eastingM).toBeGreaterThan(410000);
    expect(osgb.eastingM).toBeLessThan(420000);
    expect(osgb.northingM).toBeGreaterThan(210000);
    expect(osgb.northingM).toBeLessThan(220000);

    const parsed = parseCliArgs([
      "--lat",
      "34.100437",
      "--lon",
      "-118.370152",
      "--source",
      "usgs-3dep",
      "--extent",
      "240",
      "--skirt",
      "720",
      "--skirt-step",
      "6",
    ]);
    expect(parsed.source).toBe("usgs-3dep");
    expect(parsed.sizeM).toBe(240);
    expect(parsed.skirtM).toBe(720);
    expect(parsed.skirtStepM).toBe(6);
  });

  it("builds concentric multi-layer HusGrid documents from USGS 3DEP and DEFRA WCS Float32 GeoTIFFs", async () => {
    const lat0 = 34.100437;
    const lon0 = -118.370152;
    const usgsDoc = (await buildHusGrid({
      lat: lat0,
      lon: lon0,
      source: "usgs-3dep",
      sizeM: 60,
      stepM: 10,
      skirtM: 180,
      skirtStepM: 30,
      fetchGeoTiff: async (url: string) => {
        const u = new URL(url);
        const [minLon, minLat, maxLon, maxLat] = u.searchParams.get("bbox")!.split(",").map(Number);
        const [w, h] = u.searchParams.get("size")!.split(",").map(Number);
        const scaleX = (maxLon - minLon) / w;
        const scaleY = (maxLat - minLat) / h;
        const values = new Float32Array(w * h);
        for (let r = 0; r < h; r++) {
          const lat = maxLat - (r + 0.5) * scaleY;
          for (let c = 0; c < w; c++) {
            const lon = minLon + (c + 0.5) * scaleX;
            // Uphill North (+lat), downhill South (-lat) and East (+lon)
            values[r * w + c] = 240.0 + (lat - lat0) * 111000 * 0.12 - (lon - lon0) * 92000 * 0.2;
          }
        }
        return encodeSyntheticFloat32GeoTiff({
          width: w,
          height: h,
          values,
          bigEndian: false,
          originX: minLon,
          originY: maxLat,
          scaleX,
          scaleY,
        });
      },
    })) as HusGridDocument;

    expect(usgsDoc.source).toContain("usgs-3dep");
    expect(usgsDoc.grids).toHaveLength(2);
    const sampler = createTerrainSampler({ base: usgsDoc });
    // -Z is North (uphill > 0), +Z is South (downhill < 0), +X is East (downhill < 0)
    expect(sampler.sampleTerrainY(0, -30)).toBeGreaterThan(2.5);
    expect(sampler.sampleTerrainY(0, 30)).toBeLessThan(-2.5);
    expect(sampler.sampleTerrainY(30, 0)).toBeLessThan(-4.5);

    const defraDoc = (await buildHusGridFromDefraWcs({
      lat: 51.84,
      lon: -1.79,
      sizeM: 40,
      stepM: 10,
      fetchGeoTiff: async (url: string) => {
        const eMatch = /E\(([^,]+),([^)]+)\)/.exec(url)!;
        const nMatch = /N\(([^,]+),([^)]+)\)/.exec(url)!;
        const minE = Number(eMatch[1]);
        const maxE = Number(eMatch[2]);
        const minN = Number(nMatch[1]);
        const maxN = Number(nMatch[2]);
        const w = Math.round(maxE - minE);
        const h = Math.round(maxN - minN);
        const values = new Float32Array(w * h);
        values.fill(118.5);
        return encodeSyntheticFloat32GeoTiff({
          width: w,
          height: h,
          values,
          bigEndian: true,
          originX: minE,
          originY: maxN,
          scaleX: 1,
          scaleY: 1,
        });
      },
    })) as HusGridDocument;
    expect(defraDoc.source).toContain("defra");
    expect(defraDoc.origin.datumElevationM).toBeCloseTo(118.5, 2);
  });
});
