#!/usr/bin/env node
/**
 * Zero-API-key terrain DEM bootstrapper for Hus.js (`husgrid-v1`).
 *
 * Supports:
 * - `usgs-3dep`: USGS 3DEP 1m LiDAR Elevation ImageServer (32-bit float GeoTIFF, US coverage)
 * - `defra`:     UK Environment Agency / DEFRA 1m LiDAR DTM WCS 2.0.1 (32-bit float GeoTIFF, EPSG:27700)
 * - `terrarium`: AWS Open Data Terrarium global elevation PNG tiles (`z/x/y.png`)
 * - `auto`:      Selects `usgs-3dep` for US coordinates, `defra` for England (with automatic
 *                fallback to `terrarium` when outside coverage), and `terrarium` globally.
 *
 * Usage:
 *   node tools/husjs-terrain.mjs --lat 34.100437 --lon -118.370152 --size 240 --skirt 720 --source auto --out ./terrain.husgrid.json
 *   husjs terrain --lat 34.100437 --lon -118.370152 --extent 240 --skirt 720 --out ./terrain.husgrid.json
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const TERRARIUM_TILE_URL_TEMPLATE =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const USGS_3DEP_EXPORT_URL =
  'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage';
const DEFRA_WCS_URL =
  'https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/wcs';
const DEFRA_COVERAGE_ID = '977a4366-6c49-4620-a874-5f372882f9d3__Lidar_Composite_Elevation_DTM_1m';

// WGS84 ellipsoid constants for accurate local tangent plane (ENU -> lat/lon)
const WGS84_A = 6378137.0;
const WGS84_B = 6356752.314245;
const WGS84_E2 = 0.00669437999014;
const MAX_MERCATOR_LAT = 85.05;

export const VALID_TERRAIN_SOURCES = /** @type {const} */ ([
  'auto',
  'usgs-3dep',
  'defra',
  'terrarium',
]);

// ---------------------------------------------------------------------------
// 1. Pure Node.js PNG Decoder (`node:zlib` only, filters 0..4, RGB & RGBA)
// ---------------------------------------------------------------------------

export function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Decodes an 8-bit non-interlaced RGB (`colorType = 2`) or RGBA (`colorType = 6`) PNG buffer.
 *
 * @param {Uint8Array | Buffer} input
 * @returns {{ width: number, height: number, channels: 3 | 4, colorType: 2 | 6, data: Uint8Array }}
 */
export function decodePng(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 33) {
    throw new Error(`Invalid PNG: buffer too short (${bytes.byteLength} bytes)`);
  }
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      throw new Error('Invalid PNG: bad 8-byte PNG signature');
    }
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlaceMethod = 0;
  let sawIhdr = false;
  let sawIend = false;
  /** @type {Uint8Array[]} */
  const idatChunks = [];
  let totalIdatLength = 0;

  while (offset + 8 <= bytes.byteLength) {
    const chunkLen = view.getUint32(offset, false);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7]
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLen;
    if (dataEnd + 4 > bytes.byteLength) {
      throw new Error(`Invalid PNG: truncated ${type} chunk`);
    }

    if (type === 'IHDR') {
      if (chunkLen < 13) {
        throw new Error('Invalid PNG: IHDR chunk shorter than 13 bytes');
      }
      width = view.getUint32(dataStart, false);
      height = view.getUint32(dataStart + 4, false);
      bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
      const compressionMethod = bytes[dataStart + 10];
      const filterMethod = bytes[dataStart + 11];
      interlaceMethod = bytes[dataStart + 12];
      if (width <= 0 || height <= 0) {
        throw new Error(`Invalid PNG dimensions: ${width}x${height}`);
      }
      if (bitDepth !== 8) {
        throw new Error(`Unsupported PNG bit depth: ${bitDepth} (expected 8)`);
      }
      if (colorType !== 2 && colorType !== 6) {
        throw new Error(
          `Unsupported PNG colorType: ${colorType} (expected 2=RGB or 6=RGBA)`
        );
      }
      if (compressionMethod !== 0 || filterMethod !== 0) {
        throw new Error(
          `Unsupported PNG compression/filter method (${compressionMethod}/${filterMethod})`
        );
      }
      if (interlaceMethod !== 0) {
        throw new Error('Unsupported PNG interlace method (Adam7 interlaced PNGs not supported)');
      }
      sawIhdr = true;
    } else if (type === 'IDAT') {
      const slice = bytes.subarray(dataStart, dataEnd);
      idatChunks.push(slice);
      totalIdatLength += slice.byteLength;
    } else if (type === 'IEND') {
      sawIend = true;
      break;
    }

    offset = dataEnd + 4; // skip 4-byte CRC
  }

  if (!sawIhdr) {
    throw new Error('Invalid PNG: missing IHDR chunk');
  }
  if (idatChunks.length === 0) {
    throw new Error('Invalid PNG: missing IDAT compressed image data');
  }
  if (!sawIend) {
    throw new Error('Invalid PNG: missing IEND chunk');
  }

  const compressed = new Uint8Array(totalIdatLength);
  let pos = 0;
  for (const chunk of idatChunks) {
    compressed.set(chunk, pos);
    pos += chunk.byteLength;
  }

  const inflated = inflateSync(compressed);
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const expectedBytes = height * (1 + stride);
  if (inflated.byteLength < expectedBytes) {
    throw new Error(
      `Invalid PNG: inflated data too short (${inflated.byteLength} < ${expectedBytes})`
    );
  }

  const out = new Uint8Array(height * stride);
  for (let row = 0; row < height; row++) {
    const srcRowOffset = row * (1 + stride);
    const filterType = inflated[srcRowOffset];
    const rawOffset = srcRowOffset + 1;
    const dstOffset = row * stride;
    const prevOffset = (row - 1) * stride;

    switch (filterType) {
      case 0: {
        out.set(inflated.subarray(rawOffset, rawOffset + stride), dstOffset);
        break;
      }
      case 1: {
        for (let i = 0; i < stride; i++) {
          const a = i >= channels ? out[dstOffset + i - channels] : 0;
          out[dstOffset + i] = (inflated[rawOffset + i] + a) & 0xff;
        }
        break;
      }
      case 2: {
        for (let i = 0; i < stride; i++) {
          const b = row > 0 ? out[prevOffset + i] : 0;
          out[dstOffset + i] = (inflated[rawOffset + i] + b) & 0xff;
        }
        break;
      }
      case 3: {
        for (let i = 0; i < stride; i++) {
          const a = i >= channels ? out[dstOffset + i - channels] : 0;
          const b = row > 0 ? out[prevOffset + i] : 0;
          out[dstOffset + i] = (inflated[rawOffset + i] + ((a + b) >> 1)) & 0xff;
        }
        break;
      }
      case 4: {
        for (let i = 0; i < stride; i++) {
          const a = i >= channels ? out[dstOffset + i - channels] : 0;
          const b = row > 0 ? out[prevOffset + i] : 0;
          const c = row > 0 && i >= channels ? out[prevOffset + i - channels] : 0;
          out[dstOffset + i] =
            (inflated[rawOffset + i] + paethPredictor(a, b, c)) & 0xff;
        }
        break;
      }
      default:
        throw new Error(`Invalid PNG scanline filter type ${filterType} at row ${row}`);
    }
  }

  return {
    width,
    height,
    channels,
    colorType: /** @type {2 | 6} */ (colorType),
    data: out,
  };
}

// ---------------------------------------------------------------------------
// 1b. Pure Node.js 32-Bit Float GeoTIFF Decoder (Little/Big Endian, Strips & Tiles)
// ---------------------------------------------------------------------------

const TIFF_TYPE_SIZES = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  6: 1, // SBYTE
  7: 1, // UNDEFINED
  8: 2, // SSHORT
  9: 4, // SLONG
  10: 8, // SRATIONAL
  11: 4, // FLOAT
  12: 8, // DOUBLE
};

/**
 * Decodes a single-band 32-bit IEEE float GeoTIFF (`II` little-endian or `MM` big-endian,
 * uncompressed `Compression = 1` or `Deflate = 8/32946`, stripped or tiled layout) along
 * with GeoTIFF tiepoint/scale (`33550`/`33922`), affine matrix (`34264`), and `GDAL_NODATA` (`42113`).
 *
 * @param {Uint8Array | Buffer} input
 * @returns {{
 *   width: number;
 *   height: number;
 *   elevationsM: Float32Array;
 *   noDataValue: number | null;
 *   originX: number | null;
 *   originY: number | null;
 *   pixelSizeX: number | null;
 *   pixelSizeY: number | null;
 * }}
 */
export function decodeFloat32GeoTiff(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 16) {
    throw new Error(`Invalid GeoTIFF: buffer too short (${bytes.byteLength} bytes)`);
  }
  const b0 = bytes[0];
  const b1 = bytes[1];
  let littleEndian = true;
  if (b0 === 0x49 && b1 === 0x49) {
    littleEndian = true;
  } else if (b0 === 0x4d && b1 === 0x4d) {
    littleEndian = false;
  } else {
    throw new Error(`Invalid GeoTIFF byte-order header: 0x${b0.toString(16)}${b1.toString(16)}`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint16(2, littleEndian);
  if (magic !== 42) {
    throw new Error(`Invalid GeoTIFF magic number: ${magic} (expected 42)`);
  }

  const ifdOffset = view.getUint32(4, littleEndian);
  if (ifdOffset + 2 > bytes.byteLength) {
    throw new Error('Invalid GeoTIFF: IFD offset out of bounds');
  }
  const entryCount = view.getUint16(ifdOffset, littleEndian);
  /** @type {Record<number, any>} */
  const tags = {};

  for (let i = 0; i < entryCount; i++) {
    const entryOff = ifdOffset + 2 + i * 12;
    if (entryOff + 12 > bytes.byteLength) {
      throw new Error('Invalid GeoTIFF: truncated IFD entry');
    }
    const tag = view.getUint16(entryOff, littleEndian);
    const type = view.getUint16(entryOff + 2, littleEndian);
    const count = view.getUint32(entryOff + 4, littleEndian);
    const unitBytes = TIFF_TYPE_SIZES[type] ?? 1;
    const totalBytes = count * unitBytes;
    const valOff = totalBytes <= 4 ? entryOff + 8 : view.getUint32(entryOff + 8, littleEndian);
    if (valOff + totalBytes > bytes.byteLength) {
      continue;
    }

    if (type === 2) {
      let str = '';
      for (let k = 0; k < count; k++) {
        const ch = bytes[valOff + k];
        if (ch === 0) break;
        str += String.fromCharCode(ch);
      }
      tags[tag] = str;
    } else if (type === 3) {
      const arr = new Array(count);
      for (let k = 0; k < count; k++) arr[k] = view.getUint16(valOff + k * 2, littleEndian);
      tags[tag] = count === 1 ? arr[0] : arr;
    } else if (type === 4) {
      const arr = new Array(count);
      for (let k = 0; k < count; k++) arr[k] = view.getUint32(valOff + k * 4, littleEndian);
      tags[tag] = count === 1 ? arr[0] : arr;
    } else if (type === 11) {
      const arr = new Array(count);
      for (let k = 0; k < count; k++) arr[k] = view.getFloat32(valOff + k * 4, littleEndian);
      tags[tag] = count === 1 ? arr[0] : arr;
    } else if (type === 12) {
      const arr = new Array(count);
      for (let k = 0; k < count; k++) arr[k] = view.getFloat64(valOff + k * 8, littleEndian);
      tags[tag] = count === 1 ? arr[0] : arr;
    }
  }

  const width = Number(tags[256] ?? 0);
  const height = Number(tags[257] ?? 0);
  const bitsPerSample = Array.isArray(tags[258]) ? tags[258][0] : Number(tags[258] ?? 32);
  const compression = Number(tags[259] ?? 1);
  if (width <= 0 || height <= 0) {
    throw new Error(`Invalid GeoTIFF dimensions: ${width}x${height}`);
  }
  if (bitsPerSample !== 32) {
    throw new Error(`Unsupported GeoTIFF BitsPerSample: ${bitsPerSample} (expected 32-bit float)`);
  }
  if (compression !== 1 && compression !== 8 && compression !== 32946) {
    throw new Error(`Unsupported GeoTIFF compression: ${compression}`);
  }

  const decodeChunkBytes = (off, byteLen) => {
    const slice = bytes.subarray(off, off + byteLen);
    return compression === 1 ? slice : inflateSync(slice);
  };

  const elevationsM = new Float32Array(width * height);
  const asArray = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

  if (tags[324] !== undefined) {
    // Tiled GeoTIFF (e.g. USGS 3DEP ImageServer)
    const tileW = Number(tags[322]);
    const tileH = Number(tags[323]);
    const tileOffsets = asArray(tags[324]);
    const tileByteCounts = asArray(tags[325]);
    const tilesAcross = Math.ceil(width / tileW);
    for (let t = 0; t < tileOffsets.length; t++) {
      const off = tileOffsets[t];
      const byteLen = tileByteCounts[t] ?? tileW * tileH * 4;
      const chunk = decodeChunkBytes(off, byteLen);
      const chunkView = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      const tx0 = (t % tilesAcross) * tileW;
      const ty0 = Math.floor(t / tilesAcross) * tileH;
      const maxR = Math.min(tileH, height - ty0);
      const maxC = Math.min(tileW, width - tx0);
      for (let r = 0; r < maxR; r++) {
        const dstRow = (ty0 + r) * width;
        const srcRow = r * tileW;
        for (let c = 0; c < maxC; c++) {
          elevationsM[dstRow + tx0 + c] = chunkView.getFloat32((srcRow + c) * 4, littleEndian);
        }
      }
    }
  } else if (tags[273] !== undefined) {
    // Stripped GeoTIFF (e.g. DEFRA 1m LiDAR WCS)
    const rowsPerStrip = Math.min(height, Number(tags[278] ?? height));
    const stripOffsets = asArray(tags[273]);
    const stripByteCounts = asArray(tags[279]);
    for (let s = 0; s < stripOffsets.length; s++) {
      const row0 = s * rowsPerStrip;
      const rowsInStrip = Math.min(rowsPerStrip, height - row0);
      if (rowsInStrip <= 0) break;
      const off = stripOffsets[s];
      const byteLen = stripByteCounts[s] ?? rowsInStrip * width * 4;
      const chunk = decodeChunkBytes(off, byteLen);
      const chunkView = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      for (let r = 0; r < rowsInStrip; r++) {
        const dstRow = (row0 + r) * width;
        const srcRow = r * width;
        for (let c = 0; c < width; c++) {
          elevationsM[dstRow + c] = chunkView.getFloat32((srcRow + c) * 4, littleEndian);
        }
      }
    }
  } else {
    throw new Error('Invalid GeoTIFF: missing StripOffsets (273) and TileOffsets (324)');
  }

  let noDataValue = null;
  if (typeof tags[42113] === 'string') {
    const parsed = Number(tags[42113].trim());
    if (Number.isFinite(parsed)) noDataValue = parsed;
  }

  let originX = null;
  let originY = null;
  let pixelSizeX = null;
  let pixelSizeY = null;
  if (Array.isArray(tags[33550]) && Array.isArray(tags[33922]) && tags[33922].length >= 6) {
    pixelSizeX = Number(tags[33550][0]);
    pixelSizeY = -Math.abs(Number(tags[33550][1]));
    const tieI = Number(tags[33922][0]);
    const tieJ = Number(tags[33922][1]);
    originX = Number(tags[33922][3]) - tieI * pixelSizeX;
    originY = Number(tags[33922][4]) - tieJ * pixelSizeY;
  } else if (Array.isArray(tags[34264]) && tags[34264].length >= 16) {
    pixelSizeX = Number(tags[34264][0]);
    originX = Number(tags[34264][3]);
    pixelSizeY = Number(tags[34264][5]);
    originY = Number(tags[34264][7]);
  }

  return {
    width,
    height,
    elevationsM,
    noDataValue,
    originX,
    originY,
    pixelSizeX,
    pixelSizeY,
  };
}

// ---------------------------------------------------------------------------
// 2. Geodesy: AWS Terrarium, Web Mercator, Local ENU & OSGB36 (EPSG:27700)
// ---------------------------------------------------------------------------

/**
 * AWS Terrarium RGB -> elevation in metres ASL:
 *   `elevationM = (R * 256 + G + B / 256) - 32768`
 */
export function terrariumRgbToElevationM(r, g, b) {
  return r * 256 + g + b / 256 - 32768;
}

/**
 * Inverse Terrarium formula (useful for encoding synthetic test tiles).
 * @param {number} elevationM
 * @returns {[number, number, number]} `[r, g, b]` bytes in `0..255`
 */
export function elevationMToTerrariumRgb(elevationM) {
  const shifted = Math.max(0, Math.min(65535.99609375, elevationM + 32768));
  const total256 = Math.round(shifted * 256);
  const r = Math.min(255, (total256 >> 16) & 0xff);
  const g = (total256 >> 8) & 0xff;
  const b = total256 & 0xff;
  return [r, g, b];
}

/**
 * Converts `(lat, lon, zoom)` to continuous global slippy-map pixel coordinates `(gx, gy)`
 * where each tile is `256 x 256` pixels and pixel `(0, 0)` center is at `(0.0, 0.0)`.
 */
export function latLonToGlobalMercatorPixel(lat, lon, zoom, tileSize = 256) {
  const clampedLat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
  const wrappedLon = ((((lon + 180) % 360) + 360) % 360) - 180;
  const n = Math.pow(2, zoom);
  const latRad = (clampedLat * Math.PI) / 180;
  const tileXFloat = ((wrappedLon + 180) / 360) * n;
  const tileYFloat =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;

  return {
    tileXFloat,
    tileYFloat,
    tileX: Math.min(n - 1, Math.max(0, Math.floor(tileXFloat))),
    tileY: Math.min(n - 1, Math.max(0, Math.floor(tileYFloat))),
    pixelX: tileXFloat * tileSize - 0.5,
    pixelY: tileYFloat * tileSize - 0.5,
  };
}

/**
 * Maps local right-handed world `(wx, wz)` (metres) around `(lat0, lon0)` to `(lat, lon)`.
 *
 * `northOffsetDeg` is the clockwise bearing of `+X` from True North:
 * - Default `90` -> standard ENU (`+X` = East, `-Z` = True North, `+Z` = South).
 */
export function localWorldToLatLon(wx, wz, lat0, lon0, northOffsetDeg = 90) {
  const psiRad = (northOffsetDeg * Math.PI) / 180;
  const sinPsi = Math.sin(psiRad);
  const cosPsi = Math.cos(psiRad);
  const dEastM = wx * sinPsi + wz * cosPsi;
  const dNorthM = wx * cosPsi - wz * sinPsi;

  const lat0Rad = (lat0 * Math.PI) / 180;
  const sinLat = Math.sin(lat0Rad);
  const denom = Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  const rN = WGS84_A / denom;
  const rM = (WGS84_A * (1 - WGS84_E2)) / (denom * denom * denom);

  const dLatDeg = (dNorthM / rM) * (180 / Math.PI);
  const cosLat = Math.max(1e-9, Math.cos(lat0Rad));
  const dLonDeg = (dEastM / (rN * cosLat)) * (180 / Math.PI);

  return {
    lat: lat0 + dLatDeg,
    lon: lon0 + dLonDeg,
    dEastM,
    dNorthM,
  };
}

/**
 * Converts WGS84 `(lat, lon)` degrees to British National Grid `EPSG:27700` `(eastingM, northingM)`
 * via 7-parameter Helmert datum transformation to OSGB36 (Airy 1830) + Transverse Mercator.
 */
export function wgs84ToOsgb36Grid(latDeg, lonDeg) {
  const e2W = (WGS84_A * WGS84_A - WGS84_B * WGS84_B) / (WGS84_A * WGS84_A);
  const phi = (latDeg * Math.PI) / 180;
  const lam = (lonDeg * Math.PI) / 180;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const nuW = WGS84_A / Math.sqrt(1 - e2W * sinPhi * sinPhi);
  const x1 = nuW * cosPhi * Math.cos(lam);
  const y1 = nuW * cosPhi * Math.sin(lam);
  const z1 = (1 - e2W) * nuW * sinPhi;

  // Helmert WGS84 -> OSGB36
  const tx = -446.448;
  const ty = 125.157;
  const tz = -542.06;
  const s = 20.4894e-6;
  const rx = ((-0.1502 / 3600) * Math.PI) / 180;
  const ry = ((-0.247 / 3600) * Math.PI) / 180;
  const rz = ((-0.8421 / 3600) * Math.PI) / 180;
  const x2 = tx + (1 + s) * x1 - rz * y1 + ry * z1;
  const y2 = ty + rz * x1 + (1 + s) * y1 - rx * z1;
  const z2 = tz - ry * x1 + rx * y1 + (1 + s) * z1;

  // Airy 1830 ellipsoid
  const a = 6377563.396;
  const b = 6356256.909;
  const e2 = (a * a - b * b) / (a * a);
  const p = Math.hypot(x2, y2);
  let phiA = Math.atan2(z2, p * (1 - e2));
  for (let i = 0; i < 6; i++) {
    const spA = Math.sin(phiA);
    const nu = a / Math.sqrt(1 - e2 * spA * spA);
    phiA = Math.atan2(z2 + e2 * nu * spA, p);
  }
  const lamA = Math.atan2(y2, x2);

  // OS National Grid Transverse Mercator
  const F0 = 0.9996012717;
  const phi0 = (49 * Math.PI) / 180;
  const lam0 = (-2 * Math.PI) / 180;
  const N0 = -100000;
  const E0 = 400000;
  const n = (a - b) / (a + b);
  const n2 = n * n;
  const n3 = n2 * n;
  const sp = Math.sin(phiA);
  const cp = Math.cos(phiA);
  const tp = Math.tan(phiA);
  const nu = (a * F0) / Math.sqrt(1 - e2 * sp * sp);
  const rho = (a * F0 * (1 - e2)) / Math.pow(1 - e2 * sp * sp, 1.5);
  const eta2 = nu / rho - 1;

  const dPhi = phiA - phi0;
  const sPhi = phiA + phi0;
  const Ma = (1 + n + 1.25 * n2 + 1.25 * n3) * dPhi;
  const Mb = (3 * n + 3 * n2 + 2.625 * n3) * Math.sin(dPhi) * Math.cos(sPhi);
  const Mc = (1.875 * n2 + 1.875 * n3) * Math.sin(2 * dPhi) * Math.cos(2 * sPhi);
  const Md = (35 / 24) * n3 * Math.sin(3 * dPhi) * Math.cos(3 * sPhi);
  const M = b * F0 * (Ma - Mb + Mc - Md);

  const I = M + N0;
  const II = (nu / 2) * sp * cp;
  const III = (nu / 24) * sp * cp * cp * cp * (5 - tp * tp + 9 * eta2);
  const IIIA = (nu / 720) * sp * Math.pow(cp, 5) * (61 - 58 * tp * tp + Math.pow(tp, 4));
  const IV = nu * cp;
  const V = (nu / 6) * cp * cp * cp * (nu / rho - tp * tp);
  const VI =
    (nu / 120) *
    Math.pow(cp, 5) *
    (5 - 18 * tp * tp + Math.pow(tp, 4) + 14 * eta2 - 58 * tp * tp * eta2);

  const dLam = lamA - lam0;
  const northingM = I + II * dLam * dLam + III * Math.pow(dLam, 4) + IIIA * Math.pow(dLam, 6);
  const eastingM = E0 + IV * dLam + V * Math.pow(dLam, 3) + VI * Math.pow(dLam, 5);
  return { eastingM, northingM };
}

/**
 * Selects the highest-resolution zero-key DEM source for `(lat, lon)` when `--source auto`.
 * - `'usgs-3dep'`: United States (CONUS, Alaska, Hawaii, Puerto Rico / USVI)
 * - `'defra'`:     England / Great Britain bounding box (`49.85..55.85°N, -6.5..2.0°E`)
 * - `'terrarium'`: Global fallback
 */
export function resolveAutoTerrainSource(lat, lon) {
  const isConus = lat >= 24.3 && lat <= 49.5 && lon >= -125.0 && lon <= -66.5;
  const isHawaii = lat >= 18.8 && lat <= 22.4 && lon >= -160.5 && lon <= -154.6;
  const isPuertoRico = lat >= 17.8 && lat <= 18.6 && lon >= -67.4 && lon <= -65.1;
  const isAlaska = lat >= 51.0 && lat <= 71.6 && lon >= -179.9 && lon <= -129.9;
  if (isConus || isHawaii || isPuertoRico || isAlaska) {
    return 'usgs-3dep';
  }
  const isEnglandBox = lat >= 49.85 && lat <= 55.85 && lon >= -6.5 && lon <= 2.0;
  if (isEnglandBox) {
    return 'defra';
  }
  return 'terrarium';
}

/**
 * Decodes a `256 x 256` decoded PNG into a `Float32Array` of Terrarium elevations in metres.
 */
export function decodeTerrariumElevationTile(decodedPng) {
  const { width, height, channels, data } = decodedPng;
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += channels) {
    out[i] = terrariumRgbToElevationM(data[p], data[p + 1], data[p + 2]);
  }
  return { width, height, elevationsM: out };
}

/**
 * Selects an `Int16` quantization scale (`scaleM` in metres per unit) that avoids `Int16`
 * overflow (`[-32768, 32767]`) even on steep mountain/canyon sites (`> ±32 m` relief).
 */
export function selectQuantizationScaleM(maxAbsRelativeHeightM) {
  if (maxAbsRelativeHeightM <= 32.0) return 0.001; // 1 mm precision (±32.767 m)
  if (maxAbsRelativeHeightM <= 320.0) return 0.01; // 1 cm precision (±327.67 m)
  if (maxAbsRelativeHeightM <= 3200.0) return 0.1; // 10 cm precision (±3276.7 m)
  return 1.0; // 1 m precision (±32767 m)
}

/**
 * Quantizes relative heights (metres) into a `HusGridLayerSpec` with auto-ranged `scaleM`.
 */
export function quantizeRelativeHeightGrid({
  minX,
  maxX,
  minZ,
  maxZ,
  step,
  cols,
  rows,
  relativeHeightsM,
  scaleM: explicitScaleM,
}) {
  if (relativeHeightsM.length !== cols * rows) {
    throw new Error(
      `Height buffer length ${relativeHeightsM.length} does not match ${cols}x${rows}`
    );
  }
  let maxAbs = 0;
  for (let i = 0; i < relativeHeightsM.length; i++) {
    const absH = Math.abs(relativeHeightsM[i]);
    if (absH > maxAbs) maxAbs = absH;
  }

  const scaleM = explicitScaleM ?? selectQuantizationScaleM(maxAbs);
  const byteBuf = new Uint8Array(cols * rows * 2);
  const view = new DataView(byteBuf.buffer);
  for (let i = 0; i < relativeHeightsM.length; i++) {
    const q = Math.max(-32768, Math.min(32767, Math.round(relativeHeightsM[i] / scaleM)));
    view.setInt16(i * 2, q, true);
  }

  const base64Int16Mm = Buffer.from(byteBuf).toString('base64');
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    step,
    cols,
    rows,
    scaleM,
    base64Int16Mm,
  };
}

// ---------------------------------------------------------------------------
// 3. DEM Builders (`usgs-3dep`, `defra`, `terrarium`, and unified `buildHusGrid`)
// ---------------------------------------------------------------------------

function validateCommonGridOptions(options, defaultInnerStepFn) {
  const { lat, lon } = options;
  if (!Number.isFinite(lat) || lat < -MAX_MERCATOR_LAT || lat > MAX_MERCATOR_LAT) {
    throw new Error(
      `--lat must be a finite number in [-${MAX_MERCATOR_LAT}, ${MAX_MERCATOR_LAT}] (got ${lat})`
    );
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new Error(`--lon must be a finite number in [-180, 180] (got ${lon})`);
  }

  const sizeM = options.sizeM ?? 500;
  if (!Number.isFinite(sizeM) || sizeM <= 0) {
    throw new Error(`--size must be a positive number in metres (got ${sizeM})`);
  }

  const stepM = options.stepM ?? defaultInnerStepFn(sizeM);
  if (!Number.isFinite(stepM) || stepM <= 0) {
    throw new Error(`--step must be a positive number in metres (got ${stepM})`);
  }

  const northOffsetDeg = options.northOffsetDeg ?? 90;
  if (!Number.isFinite(northOffsetDeg)) {
    throw new Error(`--north-offset must be a finite number in degrees (got ${northOffsetDeg})`);
  }

  const skirtM = options.skirtM;
  if (skirtM !== undefined && (!Number.isFinite(skirtM) || skirtM <= 0)) {
    throw new Error(`--skirt must be a positive number in metres (got ${skirtM})`);
  }
  const hasSkirt = skirtM !== undefined && skirtM > sizeM;
  const skirtStepM = hasSkirt
    ? (options.skirtStepM ?? Math.max(stepM * 2, skirtM <= 1600 ? 8 : 16))
    : undefined;
  if (skirtStepM !== undefined && (!Number.isFinite(skirtStepM) || skirtStepM <= 0)) {
    throw new Error(`skirtStepM must be a positive number in metres (got ${skirtStepM})`);
  }

  return { lat, lon, sizeM, stepM, northOffsetDeg, skirtM, hasSkirt, skirtStepM };
}

function isGeoTiffValidSample(v, noDataValue) {
  if (!Number.isFinite(v)) return false;
  if (noDataValue !== null && Math.abs(v - noDataValue) <= Math.max(1e-3, Math.abs(noDataValue) * 1e-5)) {
    return false;
  }
  return v > -1000 && v < 12000;
}

function sampleGeoTiffBilinear(tiff, px, py) {
  const { width, height, elevationsM, noDataValue } = tiff;
  const clampedX = Math.max(0, Math.min(width - 1, px));
  const clampedY = Math.max(0, Math.min(height - 1, py));
  const x0 = Math.min(width - 1, Math.floor(clampedX));
  const y0 = Math.min(height - 1, Math.floor(clampedY));
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = clampedX - x0;
  const ty = clampedY - y0;

  const h00 = elevationsM[y0 * width + x0];
  const h10 = elevationsM[y0 * width + x1];
  const h01 = elevationsM[y1 * width + x0];
  const h11 = elevationsM[y1 * width + x1];
  const v00 = isGeoTiffValidSample(h00, noDataValue);
  const v10 = isGeoTiffValidSample(h10, noDataValue);
  const v01 = isGeoTiffValidSample(h01, noDataValue);
  const v11 = isGeoTiffValidSample(h11, noDataValue);

  if (v00 && v10 && v01 && v11) {
    const a = h00 + (h10 - h00) * tx;
    const b = h01 + (h11 - h01) * tx;
    return a + (b - a) * ty;
  }

  let sum = 0;
  let wSum = 0;
  const acc = (valid, val, w) => {
    if (valid) {
      sum += val * (w + 1e-4);
      wSum += w + 1e-4;
    }
  };
  acc(v00, h00, (1 - tx) * (1 - ty));
  acc(v10, h10, tx * (1 - ty));
  acc(v01, h01, (1 - tx) * ty);
  acc(v11, h11, tx * ty);
  return wSum > 0 ? sum / wSum : Number.NaN;
}

export function formatUsgs3depExportUrl({ minLon, minLat, maxLon, maxLat, width, height }) {
  const bbox = `${minLon.toFixed(7)},${minLat.toFixed(7)},${maxLon.toFixed(7)},${maxLat.toFixed(7)}`;
  return (
    `${USGS_3DEP_EXPORT_URL}?bbox=${encodeURIComponent(bbox)}` +
    `&bboxSR=4326&size=${width},${height}&imageSR=4326` +
    `&format=tiff&pixelType=F32&interpolation=+RSP_BilinearInterpolation&f=image`
  );
}

async function defaultFetchGeoTiff(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch GeoTIFF ${url}: HTTP ${res.status} ${res.statusText}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Builds a `HusGridDocument` (`husgrid-v1`) from the USGS 3DEP 1m LiDAR Elevation ImageServer.
 */
export async function buildHusGridFromUsgs3dep(options) {
  const { lat, lon, sizeM, stepM, northOffsetDeg, hasSkirt, skirtM, skirtStepM } =
    validateCommonGridOptions(options, (s) => (s <= 320 ? 1.5 : s <= 800 ? 2 : 4));
  const fetchGeoTiff = options.fetchGeoTiff ?? defaultFetchGeoTiff;

  const planLattice = (spanM, cellM) => {
    const cols = Math.max(2, Math.ceil(spanM / cellM) + 1);
    const rows = cols;
    const halfSpanM = 0.5 * (cols - 1) * cellM;
    return {
      minX: -halfSpanM,
      maxX: halfSpanM,
      minZ: -halfSpanM,
      maxZ: halfSpanM,
      step: cellM,
      cols,
      rows,
    };
  };

  const innerPlan = planLattice(sizeM, stepM);
  const outerPlan = hasSkirt ? planLattice(skirtM, skirtStepM) : null;

  const fetchWindowTiff = async (halfSpanM, cellM) => {
    // Expand bounding box for arbitrary northOffsetDeg rotation + bilinear margin
    const rotPadM = Math.ceil(halfSpanM * 1.42) + 8;
    const corners = [
      localWorldToLatLon(-rotPadM, -rotPadM, lat, lon, 90),
      localWorldToLatLon(rotPadM, rotPadM, lat, lon, 90),
    ];
    const minLat = Math.min(corners[0].lat, corners[1].lat);
    const maxLat = Math.max(corners[0].lat, corners[1].lat);
    const minLon = Math.min(corners[0].lon, corners[1].lon);
    const maxLon = Math.max(corners[0].lon, corners[1].lon);
    const targetResM = Math.max(1.0, Math.min(cellM, 4.0));
    const pixelDim = Math.max(32, Math.min(2000, Math.ceil((2 * rotPadM) / targetResM) + 1));
    const url = formatUsgs3depExportUrl({
      minLon,
      minLat,
      maxLon,
      maxLat,
      width: pixelDim,
      height: pixelDim,
    });
    const bytes = await fetchGeoTiff(url);
    const tiff = decodeFloat32GeoTiff(bytes);
    const originLon = tiff.originX ?? minLon;
    const originLat = tiff.originY ?? maxLat;
    const dLon = tiff.pixelSizeX ?? (maxLon - minLon) / tiff.width;
    const dLat = tiff.pixelSizeY ?? -(maxLat - minLat) / tiff.height;
    return {
      tiff,
      sampleLatLon(ptLat, ptLon) {
        const px = (ptLon - originLon) / dLon - 0.5;
        const py = (ptLat - originLat) / dLat - 0.5;
        return sampleGeoTiffBilinear(tiff, px, py);
      },
    };
  };

  // Single 1m LiDAR request when total span fits inside 2000x2000, or dual concentric requests
  const maxHalfSpanM = outerPlan ? outerPlan.maxX : innerPlan.maxX;
  const singleHighRes = maxHalfSpanM * 2 * 1.42 <= 1950 && stepM >= 1.0;

  let innerSampler;
  let outerSampler = null;
  if (singleHighRes || !outerPlan) {
    innerSampler = await fetchWindowTiff(maxHalfSpanM, Math.min(1.0, stepM));
    outerSampler = innerSampler;
  } else {
    [innerSampler, outerSampler] = await Promise.all([
      fetchWindowTiff(innerPlan.maxX, Math.min(1.0, stepM)),
      fetchWindowTiff(outerPlan.maxX, Math.max(1.0, skirtStepM * 0.5)),
    ]);
  }

  const rawDatum = innerSampler.sampleLatLon(lat, lon);
  if (!Number.isFinite(rawDatum)) {
    throw new Error(`USGS 3DEP returned NoData at origin (${lat}, ${lon})`);
  }
  const datumElevationM = Math.round(rawDatum * 1000) / 1000;

  const sampleLayer = (plan, sampler) => {
    const relativeHeightsM = new Float32Array(plan.cols * plan.rows);
    for (let r = 0; r < plan.rows; r++) {
      const wz = plan.minZ + r * plan.step;
      for (let c = 0; c < plan.cols; c++) {
        const wx = plan.minX + c * plan.step;
        const pt = localWorldToLatLon(wx, wz, lat, lon, northOffsetDeg);
        const absH = sampler.sampleLatLon(pt.lat, pt.lon);
        if (!Number.isFinite(absH)) {
          throw new Error(`USGS 3DEP returned NoData at (${pt.lat.toFixed(5)}, ${pt.lon.toFixed(5)})`);
        }
        relativeHeightsM[r * plan.cols + c] = absH - datumElevationM;
      }
    }
    return quantizeRelativeHeightGrid({
      minX: plan.minX,
      maxX: plan.maxX,
      minZ: plan.minZ,
      maxZ: plan.maxZ,
      step: plan.step,
      cols: plan.cols,
      rows: plan.rows,
      relativeHeightsM,
    });
  };

  const innerGrid = sampleLayer(innerPlan, innerSampler);
  const grids = outerPlan
    ? [
        {
          ...innerGrid,
          blendMarginM: Math.min(sizeM * 0.2, Math.max(stepM * 4, 24)),
        },
        sampleLayer(outerPlan, outerSampler),
      ]
    : [innerGrid];

  return {
    format: /** @type {const} */ ('husgrid-v1'),
    origin: {
      lat,
      lon,
      datumElevationM,
      northOffsetDeg,
    },
    source: 'usgs-3dep-1m',
    grids,
  };
}

export function formatDefraWcsUrl({ minE, maxE, minN, maxN }) {
  return (
    `${DEFRA_WCS_URL}?service=WCS&version=2.0.1&request=GetCoverage` +
    `&coverageId=${encodeURIComponent(DEFRA_COVERAGE_ID)}` +
    `&subset=E(${Math.floor(minE)},${Math.ceil(maxE)})` +
    `&subset=N(${Math.floor(minN)},${Math.ceil(maxN)})` +
    `&format=image/tiff`
  );
}

/**
 * Builds a `HusGridDocument` (`husgrid-v1`) from the UK DEFRA 1m LiDAR DTM WCS 2.0.1 service (`EPSG:27700`).
 */
export async function buildHusGridFromDefraWcs(options) {
  const { lat, lon, sizeM, stepM, northOffsetDeg, hasSkirt, skirtM, skirtStepM } =
    validateCommonGridOptions(options, (s) => (s <= 320 ? 1.5 : s <= 800 ? 2 : 4));
  const fetchGeoTiff = options.fetchGeoTiff ?? defaultFetchGeoTiff;

  const planLattice = (spanM, cellM) => {
    const cols = Math.max(2, Math.ceil(spanM / cellM) + 1);
    const rows = cols;
    const halfSpanM = 0.5 * (cols - 1) * cellM;
    return {
      minX: -halfSpanM,
      maxX: halfSpanM,
      minZ: -halfSpanM,
      maxZ: halfSpanM,
      step: cellM,
      cols,
      rows,
    };
  };

  const innerPlan = planLattice(sizeM, stepM);
  const outerPlan = hasSkirt ? planLattice(skirtM, skirtStepM) : null;
  const maxHalfSpanM = outerPlan ? outerPlan.maxX : innerPlan.maxX;
  const padM = Math.ceil(maxHalfSpanM * 1.42) + 8;

  const originGrid = wgs84ToOsgb36Grid(lat, lon);
  const minE = Math.floor(originGrid.eastingM - padM);
  const maxE = Math.ceil(originGrid.eastingM + padM);
  const minN = Math.floor(originGrid.northingM - padM);
  const maxN = Math.ceil(originGrid.northingM + padM);

  const url = formatDefraWcsUrl({ minE, maxE, minN, maxN });
  const bytes = await fetchGeoTiff(url);
  const tiff = decodeFloat32GeoTiff(bytes);
  const originE = tiff.originX ?? minE;
  const originN = tiff.originY ?? maxN;
  const dE = tiff.pixelSizeX ?? (maxE - minE) / tiff.width;
  const dN = tiff.pixelSizeY ?? -(maxN - minN) / tiff.height;

  const sampleLatLon = (ptLat, ptLon) => {
    const g = wgs84ToOsgb36Grid(ptLat, ptLon);
    const px = (g.eastingM - originE) / dE - 0.5;
    const py = (g.northingM - originN) / dN - 0.5;
    return sampleGeoTiffBilinear(tiff, px, py);
  };

  const rawDatum = sampleLatLon(lat, lon);
  if (!Number.isFinite(rawDatum)) {
    throw new Error(`DEFRA 1m LiDAR WCS returned NoData at origin (${lat}, ${lon})`);
  }
  const datumElevationM = Math.round(rawDatum * 1000) / 1000;

  const sampleLayer = (plan) => {
    const relativeHeightsM = new Float32Array(plan.cols * plan.rows);
    for (let r = 0; r < plan.rows; r++) {
      const wz = plan.minZ + r * plan.step;
      for (let c = 0; c < plan.cols; c++) {
        const wx = plan.minX + c * plan.step;
        const pt = localWorldToLatLon(wx, wz, lat, lon, northOffsetDeg);
        const absH = sampleLatLon(pt.lat, pt.lon);
        relativeHeightsM[r * plan.cols + c] = Number.isFinite(absH) ? absH - datumElevationM : 0;
      }
    }
    return quantizeRelativeHeightGrid({
      minX: plan.minX,
      maxX: plan.maxX,
      minZ: plan.minZ,
      maxZ: plan.maxZ,
      step: plan.step,
      cols: plan.cols,
      rows: plan.rows,
      relativeHeightsM,
    });
  };

  const innerGrid = sampleLayer(innerPlan);
  const grids = outerPlan
    ? [
        {
          ...innerGrid,
          blendMarginM: Math.min(sizeM * 0.2, Math.max(stepM * 4, 24)),
        },
        sampleLayer(outerPlan),
      ]
    : [innerGrid];

  return {
    format: /** @type {const} */ ('husgrid-v1'),
    origin: {
      lat,
      lon,
      datumElevationM,
      northOffsetDeg,
    },
    source: 'defra-lidar-1m',
    grids,
  };
}

export function formatTerrariumTileUrl(z, x, y, template = TERRARIUM_TILE_URL_TEMPLATE) {
  return template
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
}

async function defaultFetchTilePng(z, x, y) {
  const url = formatTerrariumTileUrl(z, x, y);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch Terrarium tile ${url}: HTTP ${res.status} ${res.statusText}`);
  }
  const ab = await res.arrayBuffer();
  return new Uint8Array(ab);
}

/**
 * Builds a complete `HusGridDocument` (`husgrid-v1`) around `(lat, lon)` by fetching and
 * bilinearly sampling AWS Terrarium elevation tiles.
 *
 * When `skirtM > sizeM`, a second coarser grid spanning `[-skirtM/2 .. +skirtM/2]` is sampled
 * against the same datum and tiles, and returned after the primary grid (`grids` is finest-first).
 *
 * @param {{
 *   lat: number;
 *   lon: number;
 *   sizeM?: number;
 *   stepM?: number;
 *   skirtM?: number;
 *   skirtStepM?: number;
 *   zoom?: number;
 *   northOffsetDeg?: number;
 *   fetchTilePng?: (z: number, x: number, y: number) => Promise<Uint8Array | Buffer>;
 * }} options
 */
export async function buildHusGridFromTerrarium(options) {
  const { lat, lon, sizeM, stepM, northOffsetDeg, hasSkirt, skirtM, skirtStepM } =
    validateCommonGridOptions(options, (s) => (s <= 600 ? 2 : s <= 1600 ? 4 : 10));

  const rawZoom = options.zoom ?? 15;
  if (!Number.isFinite(rawZoom)) {
    throw new Error(`--zoom must be a number in [0, 15] (got ${rawZoom})`);
  }
  const zoom = Math.max(0, Math.min(15, Math.round(rawZoom)));

  const fetchTile = options.fetchTilePng ?? defaultFetchTilePng;
  const tileSize = 256;
  const numTiles = Math.pow(2, zoom);
  const totalPixels = numTiles * tileSize;

  // Determine all required tiles across the grid plus the origin (0, 0)
  /** @type {Set<string>} */
  const neededTiles = new Set();
  /** @type {{ x: number, y: number }[]} */
  const tileCoords = [];

  const registerGlobalPixel = (px, py) => {
    const x0 = Math.floor(px);
    const x1 = x0 + 1;
    const y0 = Math.max(0, Math.min(totalPixels - 1, Math.floor(py)));
    const y1 = Math.max(0, Math.min(totalPixels - 1, y0 + 1));
    for (const gx of [x0, x1]) {
      const wrappedGx = ((gx % totalPixels) + totalPixels) % totalPixels;
      const tx = Math.floor(wrappedGx / tileSize);
      for (const gy of [y0, y1]) {
        const ty = Math.floor(gy / tileSize);
        const key = `${tx}/${ty}`;
        if (!neededTiles.has(key)) {
          neededTiles.add(key);
          tileCoords.push({ x: tx, y: ty });
        }
      }
    }
  };

  const originMerc = latLonToGlobalMercatorPixel(lat, lon, zoom, tileSize);
  registerGlobalPixel(originMerc.pixelX, originMerc.pixelY);

  // Plans one square sample lattice centred on the origin and registers every tile it touches.
  const planSampleGrid = (spanM, cellM) => {
    const cols = Math.max(2, Math.ceil(spanM / cellM) + 1);
    const rows = cols;
    const halfSpanM = 0.5 * (cols - 1) * cellM;
    const minX = -halfSpanM;
    const maxX = halfSpanM;
    const minZ = -halfSpanM;
    const maxZ = halfSpanM;
    const mercPixelsX = new Float64Array(cols * rows);
    const mercPixelsY = new Float64Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      const wz = minZ + r * cellM;
      for (let c = 0; c < cols; c++) {
        const wx = minX + c * cellM;
        const pt = localWorldToLatLon(wx, wz, lat, lon, northOffsetDeg);
        const mp = latLonToGlobalMercatorPixel(pt.lat, pt.lon, zoom, tileSize);
        const idx = r * cols + c;
        mercPixelsX[idx] = mp.pixelX;
        mercPixelsY[idx] = mp.pixelY;
        registerGlobalPixel(mp.pixelX, mp.pixelY);
      }
    }
    return { minX, maxX, minZ, maxZ, step: cellM, cols, rows, mercPixelsX, mercPixelsY };
  };

  // Both lattices are planned before fetching so every needed tile is fetched in one batch.
  const innerPlan = planSampleGrid(sizeM, stepM);
  const outerPlan = hasSkirt ? planSampleGrid(skirtM, skirtStepM) : null;

  /** @type {Map<string, { width: number, height: number, elevationsM: Float32Array }>} */
  const tileMap = new Map();
  await Promise.all(
    tileCoords.map(async ({ x, y }) => {
      const pngBytes = await fetchTile(zoom, x, y);
      const decodedPng = decodePng(pngBytes);
      const elevTile = decodeTerrariumElevationTile(decodedPng);
      tileMap.set(`${x}/${y}`, elevTile);
    })
  );

  const readElevationPixel = (gx, gy) => {
    const wrappedGx = ((gx % totalPixels) + totalPixels) % totalPixels;
    const clampedGy = Math.max(0, Math.min(totalPixels - 1, gy));
    const tx = Math.floor(wrappedGx / tileSize);
    const ty = Math.floor(clampedGy / tileSize);
    const lx = wrappedGx - tx * tileSize;
    const ly = clampedGy - ty * tileSize;
    const tile = tileMap.get(`${tx}/${ty}`);
    if (!tile) {
      throw new Error(`Missing fetched Terrarium tile ${zoom}/${tx}/${ty}`);
    }
    return tile.elevationsM[ly * tile.width + lx];
  };

  const sampleBilinearGlobalPixel = (px, py) => {
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const tx = px - x0;
    const ty = py - y0;
    const h00 = readElevationPixel(x0, y0);
    const h10 = readElevationPixel(x0 + 1, y0);
    const h01 = readElevationPixel(x0, y0 + 1);
    const h11 = readElevationPixel(x0 + 1, y0 + 1);
    const a = h00 + (h10 - h00) * tx;
    const b = h01 + (h11 - h01) * tx;
    return a + (b - a) * ty;
  };

  const datumElevationM =
    Math.round(sampleBilinearGlobalPixel(originMerc.pixelX, originMerc.pixelY) * 1000) / 1000;

  const sampleGridLayer = (plan) => {
    const relativeHeightsM = new Float32Array(plan.cols * plan.rows);
    for (let i = 0; i < relativeHeightsM.length; i++) {
      const absElevM = sampleBilinearGlobalPixel(plan.mercPixelsX[i], plan.mercPixelsY[i]);
      relativeHeightsM[i] = absElevM - datumElevationM;
    }
    return quantizeRelativeHeightGrid({
      minX: plan.minX,
      maxX: plan.maxX,
      minZ: plan.minZ,
      maxZ: plan.maxZ,
      step: plan.step,
      cols: plan.cols,
      rows: plan.rows,
      relativeHeightsM,
    });
  };

  const innerGrid = sampleGridLayer(innerPlan);
  const grids = outerPlan
    ? [
        {
          ...innerGrid,
          blendMarginM: Math.min(sizeM * 0.2, Math.max(stepM * 4, 24)),
        },
        sampleGridLayer(outerPlan),
      ]
    : [innerGrid];

  return {
    format: /** @type {const} */ ('husgrid-v1'),
    origin: {
      lat,
      lon,
      datumElevationM,
      northOffsetDeg,
    },
    source: `aws-terrarium-z${zoom}`,
    grids,
  };
}

/**
 * Unified DEM builder supporting `source: 'auto' | 'usgs-3dep' | 'defra' | 'terrarium'`.
 * When `source === 'auto'`, selects USGS 3DEP 1m LiDAR for US coordinates, DEFRA 1m LiDAR for
 * England (falling back to AWS Terrarium if outside England coverage), and AWS Terrarium globally.
 */
export async function buildHusGrid(options) {
  const requested = options.source ?? 'auto';
  if (!VALID_TERRAIN_SOURCES.includes(requested)) {
    throw new Error(
      `Invalid --source '${requested}' (expected one of: ${VALID_TERRAIN_SOURCES.join(', ')})`
    );
  }
  const effective =
    requested === 'auto' ? resolveAutoTerrainSource(options.lat, options.lon) : requested;

  if (effective === 'usgs-3dep') {
    if (requested === 'auto') {
      try {
        return await buildHusGridFromUsgs3dep(options);
      } catch {
        return await buildHusGridFromTerrarium(options);
      }
    }
    return buildHusGridFromUsgs3dep(options);
  }
  if (effective === 'defra') {
    if (requested === 'auto') {
      try {
        return await buildHusGridFromDefraWcs(options);
      } catch {
        return await buildHusGridFromTerrarium(options);
      }
    }
    return buildHusGridFromDefraWcs(options);
  }
  return buildHusGridFromTerrarium(options);
}

// ---------------------------------------------------------------------------
// 4. CLI Argument Parser & Entrypoint
// ---------------------------------------------------------------------------

export function parseCliArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      flags.help = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected positional argument '${arg}'`);
    }
    const eqIdx = arg.indexOf('=');
    if (eqIdx >= 0) {
      flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
    } else {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || (next.startsWith('--') && !/^--?\d/.test(next))) {
        throw new Error(`Missing value for flag '--${key}'`);
      }
      flags[key] = next;
      i++;
    }
  }

  if (flags.help) {
    return { help: true };
  }
  if (flags.lat === undefined) {
    throw new Error('Missing required flag --lat <number>');
  }
  if (flags.lon === undefined) {
    throw new Error('Missing required flag --lon <number>');
  }

  const parseNum = (name, raw) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      throw new Error(`Invalid numeric value for --${name}: '${raw}'`);
    }
    return n;
  };

  const sizeRaw = flags.size ?? flags.extent;
  const sizeFlagName = flags.size !== undefined ? 'size' : 'extent';
  const sizeM = sizeRaw !== undefined ? parseNum(sizeFlagName, sizeRaw) : 500;
  if (sizeM <= 0) {
    throw new Error(`--${sizeFlagName} must be a positive number in metres (got ${sizeM})`);
  }

  const skirtM = flags.skirt !== undefined ? parseNum('skirt', flags.skirt) : undefined;
  if (skirtM !== undefined && skirtM <= 0) {
    throw new Error(`--skirt must be a positive number in metres (got ${skirtM})`);
  }

  const skirtStepM =
    flags['skirt-step'] !== undefined ? parseNum('skirt-step', flags['skirt-step']) : undefined;
  if (skirtStepM !== undefined && skirtStepM <= 0) {
    throw new Error(`--skirt-step must be a positive number in metres (got ${skirtStepM})`);
  }

  let source;
  if (flags.source !== undefined) {
    const s = String(flags.source).trim().toLowerCase();
    if (!VALID_TERRAIN_SOURCES.includes(/** @type {any} */ (s))) {
      throw new Error(
        `Invalid --source '${flags.source}' (expected one of: ${VALID_TERRAIN_SOURCES.join('|')})`
      );
    }
    source = s;
  }

  const result = {
    help: false,
    lat: parseNum('lat', flags.lat),
    lon: parseNum('lon', flags.lon),
    sizeM,
    stepM: flags.step !== undefined ? parseNum('step', flags.step) : undefined,
    skirtM,
    zoom: flags.zoom !== undefined ? parseNum('zoom', flags.zoom) : 15,
    northOffsetDeg:
      flags['north-offset'] !== undefined
        ? parseNum('north-offset', flags['north-offset'])
        : 90,
    outPath: typeof flags.out === 'string' ? flags.out : './terrain.husgrid.json',
  };
  if (skirtStepM !== undefined) {
    result.skirtStepM = skirtStepM;
  }
  if (source !== undefined) {
    result.source = source;
  }
  return result;
}

function printHelp(log = console.log) {
  log(`Usage: husjs terrain --lat <deg> --lon <deg> [options]
       node tools/husjs-terrain.mjs --lat <deg> --lon <deg> [options]

Options:
  --lat <number>           Origin latitude in degrees [-85.05, 85.05] (required)
  --lon <number>           Origin longitude in degrees [-180, 180] (required)
  --source <mode>          DEM source: auto|usgs-3dep|defra|terrarium (default: auto)
  --size, --extent <m>     Inner square grid span [-size/2 .. +size/2] (default: 500)
  --step <metres>          Inner grid cell spacing in metres (default: auto, 1.5-2m)
  --skirt <metres>         Also sample a coarser outer skirt grid spanning [-skirt/2 .. +skirt/2]
                           (only when larger than --size; default: no skirt)
  --skirt-step <metres>    Outer skirt grid cell spacing in metres (default: auto)
  --zoom <0..15>           AWS Terrarium tile zoom level (default: 15)
  --north-offset <deg>     Bearing of +X clockwise from True North (default: 90 = +X East, -Z North)
  --out <filepath>         Output .husgrid.json path (default: ./terrain.husgrid.json)
  --help, -h               Show this help message`);
}

/**
 * Runs the terrain CLI. Rejects on invalid flags or fetch failures (callers map that to exit 1).
 *
 * @param {string[]} [argv]
 * @param {{ log?: (message: string) => void }} [io]
 */
export async function runTerrainCli(argv = process.argv.slice(2), io = {}) {
  const log = io.log ?? console.log;
  const parsed = parseCliArgs(argv);
  if (parsed.help) {
    printHelp(log);
    return;
  }

  const doc = await buildHusGrid({
    lat: parsed.lat,
    lon: parsed.lon,
    source: parsed.source ?? 'auto',
    sizeM: parsed.sizeM,
    stepM: parsed.stepM,
    skirtM: parsed.skirtM,
    skirtStepM: parsed.skirtStepM,
    zoom: parsed.zoom,
    northOffsetDeg: parsed.northOffsetDeg,
  });

  const absOut = resolve(process.cwd(), parsed.outPath);
  mkdirSync(dirname(absOut), { recursive: true });
  writeFileSync(absOut, JSON.stringify(doc, null, 2) + '\n', 'utf8');

  const layers = doc.grids
    .map((g) => `${g.cols}x${g.rows} @ ${g.step}m, scaleM=${g.scaleM}`)
    .join(' + skirt ');
  log(
    `Wrote ${absOut} (${doc.source}: ${layers}, datum=${doc.origin.datumElevationM.toFixed(2)}m ASL)`
  );
}

const isMain =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  runTerrainCli().catch((err) => {
    console.error(`husjs-terrain error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
