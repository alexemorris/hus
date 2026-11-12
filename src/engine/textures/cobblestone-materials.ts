import * as THREE from 'three';
import {
  type ProceduralPbrMapBundle,
  type RgbTuple,
  scaleBundleForWorldMetersPerUv,
} from './brick-materials.ts';
import {
  IRONSTONE_WALL_TILE_H_M,
  IRONSTONE_WALL_TILE_W_M,
  YORKSTONE_COPING_TILE_M,
} from './metric-masonry-uvs.ts';
import { derivePbrNormalAndRoughnessMaps } from './pbr-surface-maps.ts';
import {
  createBrowserDataOrCanvasTexture,
  getOrCreateCachedCanvasPair,
  getOrCreateCachedTexture,
  isRecordingCanvasStub,
  isSnapshotRecordingCanvas,
} from './texture-registry.ts';

export type CobblestonePreset =
  | 'fan-cobble'
  | 'courtyard-cobble'
  | 'granite-setts'
  | 'tumbled-pavers'
  | 'riven-yorkstone'
  | 'honed-limestone'
  | 'pea-gravel';

export type StoneMasonryPreset =
  | 'cotswold-dry-stone'
  | 'sawn-yorkstone-coping'
  | 'welsh-slate-roof';

export interface CobblestoneMaterialOptions {
  readonly preset?: CobblestonePreset;
  /** Recesses the middle sett course as a surface-water drainage channel / valley gutter (`'granite-setts'` / `'tumbled-pavers'`). */
  readonly valleyGutter?: boolean;
  readonly mortarColor?: THREE.ColorRepresentation;
  readonly palette?: ReadonlyArray<THREE.ColorRepresentation | RgbTuple>;
  /** Joint & stone-edge moss/lichen intensity `[0..1]`. */
  readonly mossAndLichen?: number;
  readonly seed?: number;
  readonly tileSizeM?: readonly [number, number];
  /**
   * World metres covered by `1.0` UV unit on target meshes.
   * - `createCobblestoneMaterial` defaults this to `1.0` (`repeat = [1 / tileW, 1 / tileH]` via shared-source variants).
   * - `createCobblestoneTextures` leaves base maps at `repeat = (1, 1)` unless `worldMetersPerUv` is explicitly supplied.
   */
  readonly worldMetersPerUv?: number | null;
  readonly resolution?: number;
  readonly normalScale?: number | readonly [number, number];
  readonly bumpScale?: number;
  readonly roughness?: number;
  readonly metalness?: number;
  readonly tint?: THREE.ColorRepresentation;
}

export interface StoneMasonryMaterialOptions {
  readonly preset?: StoneMasonryPreset;
  readonly palette?: ReadonlyArray<THREE.ColorRepresentation | RgbTuple>;
  readonly mossAndLichen?: number;
  readonly seed?: number;
  readonly tileSizeM?: readonly [number, number];
  readonly worldMetersPerUv?: number | null;
  readonly resolution?: number;
  readonly normalScale?: number | readonly [number, number];
  readonly bumpScale?: number;
  readonly roughness?: number;
  readonly metalness?: number;
  readonly tint?: THREE.ColorRepresentation;
}

export const COBBLESTONE_PRESETS: readonly CobblestonePreset[] = [
  'fan-cobble',
  'courtyard-cobble',
  'granite-setts',
  'tumbled-pavers',
  'riven-yorkstone',
  'honed-limestone',
  'pea-gravel',
] as const;

export const STONE_MASONRY_PRESETS: readonly StoneMasonryPreset[] = [
  'cotswold-dry-stone',
  'sawn-yorkstone-coping',
  'welsh-slate-roof',
] as const;

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function stoneHash(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

function hash2D(ix: number, iy: number, seed: number): number {
  let n = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) | 0;
  n = (n ^ (n >>> 13)) | 0;
  n = Math.imul(n, 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function valueNoise2D(
  x: number,
  y: number,
  periodX: number,
  periodY: number,
  seed: number
): number {
  const fx = ((x % periodX) + periodX) % periodX;
  const fy = ((y % periodY) + periodY) % periodY;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = (x0 + 1) % periodX;
  const y1 = (y0 + 1) % periodY;
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const v00 = hash2D(x0, y0, seed);
  const v10 = hash2D(x1, y0, seed);
  const v01 = hash2D(x0, y1, seed);
  const v11 = hash2D(x1, y1, seed);
  return (v00 * (1 - sx) + v10 * sx) * (1 - sy) + (v01 * (1 - sx) + v11 * sx) * sy;
}

function toRgbTuple(c: THREE.ColorRepresentation | RgbTuple): RgbTuple {
  if (Array.isArray(c) && c.length === 3) {
    return [clampByte(Number(c[0])), clampByte(Number(c[1])), clampByte(Number(c[2]))];
  }
  const col = new THREE.Color(c as THREE.ColorRepresentation);
  return [clampByte(col.r * 255), clampByte(col.g * 255), clampByte(col.b * 255)];
}

function traceOrganicCobblePath(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  seed: number,
  inset = 0
): void {
  const hw = Math.max(2, w * 0.5 - inset);
  const hh = Math.max(2, h * 0.5 - inset);
  const chX = Math.min(hw * 0.42, (2.8 + stoneHash(seed + 1) * 3.4) * (1 - inset * 0.08));
  const chY = Math.min(hh * 0.42, (2.6 + stoneHash(seed + 2) * 3.2) * (1 - inset * 0.08));
  const j = (k: number): number =>
    (stoneHash(seed + k * 19.3) - 0.5) * 1.9 * Math.max(0.25, 1 - inset * 0.12);

  ctx.beginPath();
  ctx.moveTo(-hw + chX + j(3), -hh + j(4));
  ctx.lineTo(hw - chX + j(5), -hh + j(6));
  ctx.lineTo(hw + j(7), -hh + chY + j(8));
  ctx.lineTo(hw + j(9), hh - chY + j(10));
  ctx.lineTo(hw - chX + j(11), hh + j(12));
  ctx.lineTo(-hw + chX + j(13), hh + j(14));
  ctx.lineTo(-hw + j(15), hh - chY + j(16));
  ctx.lineTo(-hw + j(17), -hh + chY + j(18));
  ctx.closePath();
}

const DEFAULT_FAN_COBBLE_PALETTE: readonly RgbTuple[] = [
  [125, 129, 134],
  [108, 115, 123],
  [143, 123, 116],
  [146, 136, 121],
  [98, 102, 108],
  [134, 137, 142],
  [127, 109, 103],
  [116, 121, 126],
  [155, 143, 128],
  [91, 96, 102],
  [138, 127, 114],
  [112, 118, 114],
  [149, 131, 118],
  [104, 108, 115],
];

const FAN_COBBLE_TILE_SIZE_M: readonly [number, number] = [16 * 0.1437559, 2.92];
const COURTYARD_COBBLE_TILE_SIZE_M: readonly [number, number] = [1.8, 1.8];
const GRANITE_SETTS_TILE_SIZE_M: readonly [number, number] = [1.2, 0.9];
const TUMBLED_PAVERS_TILE_SIZE_M: readonly [number, number] = [1.28, 0.96];
const RIVEN_YORKSTONE_TILE_SIZE_M: readonly [number, number] = [1.85, 1.85];
const HONED_LIMESTONE_TILE_SIZE_M: readonly [number, number] = [1.6, 1.6];
const PEA_GRAVEL_TILE_SIZE_M: readonly [number, number] = [0.85, 0.85];
const WELSH_SLATE_TILE_SIZE_M: readonly [number, number] = [2.0, 2.4];

function isDefaultCobblestoneOptions(opts: CobblestoneMaterialOptions): boolean {
  return (
    opts.valleyGutter === undefined &&
    opts.mortarColor === undefined &&
    opts.palette === undefined &&
    opts.mossAndLichen === undefined &&
    opts.seed === undefined &&
    opts.tileSizeM === undefined &&
    opts.resolution === undefined
  );
}

function isDefaultStoneMasonryOptions(opts: StoneMasonryMaterialOptions): boolean {
  return (
    opts.palette === undefined &&
    opts.mossAndLichen === undefined &&
    opts.seed === undefined &&
    opts.tileSizeM === undefined &&
    opts.resolution === undefined
  );
}

function drawSingleSettStone(
  cCtx: CanvasRenderingContext2D,
  dCtx: CanvasRenderingContext2D,
  cxPx: number,
  cyPx: number,
  angle: number,
  cobbleW: number,
  cobbleH: number,
  rgb: RgbTuple,
  seed: number,
  recessBias = 0
): void {
  const rx = -cobbleW * 0.5;
  const ry = -cobbleH * 0.5;
  const toneShift = Math.round((stoneHash(seed + 7) - 0.5) * 24);
  const warmShift = Math.round((stoneHash(seed + 8) - 0.5) * 12);
  const sr = Math.max(52, Math.min(206, rgb[0] + toneShift + warmShift));
  const sg = Math.max(52, Math.min(202, rgb[1] + toneShift));
  const sb = Math.max(50, Math.min(198, rgb[2] + toneShift - warmShift));
  const cobbleHeightBias = Math.round((stoneHash(seed + 9) - 0.5) * 34) + recessBias;

  cCtx.save();
  cCtx.translate(cxPx, cyPx);
  cCtx.rotate(angle);

  cCtx.fillStyle = 'rgba(42, 36, 28, 0.26)';
  traceOrganicCobblePath(cCtx, cobbleW + 3.2, cobbleH + 3.2, seed, 0);
  cCtx.fill();

  const grad = cCtx.createLinearGradient(rx, ry, -rx, -ry);
  grad.addColorStop(
    0,
    `rgb(${Math.min(225, sr + 14)}, ${Math.min(220, sg + 13)}, ${Math.min(215, sb + 11)})`
  );
  grad.addColorStop(0.55, `rgb(${sr}, ${sg}, ${sb})`);
  grad.addColorStop(
    1,
    `rgb(${Math.max(40, sr - 16)}, ${Math.max(40, sg - 16)}, ${Math.max(40, sb - 14)})`
  );
  cCtx.fillStyle = grad;
  traceOrganicCobblePath(cCtx, cobbleW, cobbleH, seed, 0);
  cCtx.fill();

  cCtx.strokeStyle = 'rgba(255, 248, 232, 0.22)';
  cCtx.lineWidth = 1.25;
  cCtx.stroke();

  for (let sp = 0; sp < 6; sp++) {
    const spX = (stoneHash(seed + 20 + sp * 3) - 0.5) * (cobbleW * 0.68);
    const spY = (stoneHash(seed + 21 + sp * 3) - 0.5) * (cobbleH * 0.68);
    const spR = 1.3 + stoneHash(seed + 22 + sp * 3) * 2.4;
    cCtx.fillStyle = sp % 2 === 0 ? 'rgba(248, 242, 228, 0.16)' : 'rgba(28, 30, 34, 0.17)';
    cCtx.beginPath();
    cCtx.arc(spX, spY, spR, 0, Math.PI * 2);
    cCtx.fill();
  }

  if (stoneHash(seed + 45) > 0.68) {
    cCtx.strokeStyle =
      stoneHash(seed + 46) > 0.5 ? 'rgba(235, 226, 210, 0.18)' : 'rgba(42, 38, 34, 0.20)';
    cCtx.lineWidth = 0.9;
    cCtx.beginPath();
    cCtx.moveTo(rx * 0.65, (stoneHash(seed + 47) - 0.5) * cobbleH * 0.5);
    cCtx.lineTo(-rx * 0.65, (stoneHash(seed + 48) - 0.5) * cobbleH * 0.5);
    cCtx.stroke();
  }
  cCtx.restore();

  dCtx.save();
  dCtx.translate(cxPx, cyPx);
  dCtx.rotate(angle);

  const rings: ReadonlyArray<readonly [number, number]> = [
    [0.0, 92],
    [1.6, 154],
    [3.2, 204],
    [5.0, 238],
  ];
  for (const [inset, baseLum] of rings) {
    const lum = Math.max(36, Math.min(255, baseLum + cobbleHeightBias));
    dCtx.fillStyle = `rgb(${lum}, ${lum}, ${lum})`;
    traceOrganicCobblePath(dCtx, cobbleW, cobbleH, seed, inset);
    dCtx.fill();
  }

  const crownLum = Math.max(54, Math.min(255, 246 + cobbleHeightBias));
  dCtx.fillStyle = `rgb(${crownLum}, ${crownLum}, ${crownLum})`;
  dCtx.fillRect(
    rx + cobbleW * 0.22,
    ry + cobbleH * 0.24,
    Math.max(2, cobbleW * 0.52),
    Math.max(2, cobbleH * 0.36)
  );
  const pitLum = Math.max(36, Math.min(228, 174 + cobbleHeightBias));
  dCtx.fillStyle = `rgb(${pitLum}, ${pitLum}, ${pitLum})`;
  dCtx.fillRect(rx + 4, ry + 4, 3, 3);
  dCtx.fillRect(rx + cobbleW - 7, ry + cobbleH - 8, 3, 3);
  dCtx.restore();
}

function paintSandyLimeMortarBase(
  cCtx: CanvasRenderingContext2D,
  dCtx: CanvasRenderingContext2D,
  width: number,
  height: number,
  mortarRgb: RgbTuple,
  mossAndLichen: number
): void {
  cCtx.fillStyle = `rgb(${mortarRgb[0]}, ${mortarRgb[1]}, ${mortarRgb[2]})`;
  cCtx.fillRect(0, 0, width, height);
  dCtx.fillStyle = '#121212';
  dCtx.fillRect(0, 0, width, height);

  const mossThresh = 1.0 - Math.max(0, Math.min(1, mossAndLichen)) * 0.72;
  const maybeCImg =
    !isRecordingCanvasStub(cCtx.canvas) &&
    typeof cCtx.createImageData === 'function' &&
    typeof cCtx.putImageData === 'function'
      ? cCtx.createImageData(width, height)
      : null;
  if (maybeCImg && maybeCImg.data instanceof Uint8ClampedArray) {
    const cImg = maybeCImg;
    const dImg = dCtx.createImageData(width, height);
    const cBuf = cImg.data;
    const dBuf = dImg.data;
    for (let y = 0; y < height; y += 4) {
      const ny = (y / height) * Math.PI * 2;
      const yMax = Math.min(height, y + 4);
      for (let x = 0; x < width; x += 4) {
        const nx = (x / width) * Math.PI * 2;
        const macroWave =
          Math.sin(nx * 2 + ny) * 6 +
          Math.cos(nx * 3 - ny * 2) * 5 +
          Math.sin(nx * 5 + ny * 4) * 3;
        const grit = (((x * 19 + y * 37) ^ (x * 7)) % 15) - 7;
        const mossSignal =
          Math.sin(nx * 3 + 0.8) * Math.cos(ny * 3 - 0.5) +
          Math.sin(nx * 7 - ny * 5) * 0.45;
        const isMossy = mossAndLichen > 0.01 && mossSignal > mossThresh;
        const r = clampByte(mortarRgb[0] + macroWave + grit - (isMossy ? 22 : 0));
        const g = clampByte(mortarRgb[1] + macroWave + grit - (isMossy ? 4 : 0));
        const b = clampByte(mortarRgb[2] + macroWave + grit - (isMossy ? 26 : 0));
        const dv = Math.max(8, Math.min(36, 19 + Math.round((macroWave + grit) * 0.55)));
        const xMax = Math.min(width, x + 4);
        for (let py = y; py < yMax; py++) {
          let idx = (py * width + x) * 4;
          for (let px = x; px < xMax; px++) {
            cBuf[idx] = r;
            cBuf[idx + 1] = g;
            cBuf[idx + 2] = b;
            cBuf[idx + 3] = 255;
            dBuf[idx] = dv;
            dBuf[idx + 1] = dv;
            dBuf[idx + 2] = dv;
            dBuf[idx + 3] = 255;
            idx += 4;
          }
        }
      }
    }
    cCtx.putImageData(cImg, 0, 0);
    dCtx.putImageData(dImg, 0, 0);
  } else {
    for (let y = 0; y < height; y += 4) {
      const ny = (y / height) * Math.PI * 2;
      for (let x = 0; x < width; x += 4) {
        const nx = (x / width) * Math.PI * 2;
        const macroWave =
          Math.sin(nx * 2 + ny) * 6 +
          Math.cos(nx * 3 - ny * 2) * 5 +
          Math.sin(nx * 5 + ny * 4) * 3;
        const grit = (((x * 19 + y * 37) ^ (x * 7)) % 15) - 7;
        const mossSignal =
          Math.sin(nx * 3 + 0.8) * Math.cos(ny * 3 - 0.5) +
          Math.sin(nx * 7 - ny * 5) * 0.45;
        const isMossy = mossAndLichen > 0.01 && mossSignal > mossThresh;
        const r = clampByte(mortarRgb[0] + macroWave + grit - (isMossy ? 22 : 0));
        const g = clampByte(mortarRgb[1] + macroWave + grit - (isMossy ? 4 : 0));
        const b = clampByte(mortarRgb[2] + macroWave + grit - (isMossy ? 26 : 0));
        cCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        cCtx.fillRect(x, y, 4, 4);
        const dv = Math.max(8, Math.min(36, 19 + Math.round((macroWave + grit) * 0.55)));
        dCtx.fillStyle = `rgb(${dv}, ${dv}, ${dv})`;
        dCtx.fillRect(x, y, 4, 4);
      }
    }
  }
}

/**
 * Snapshot-exact default `'fan-cobble'` generator matching heritage `'courtyard-continuous-cobble'`.
 */
function buildDefaultFanCobbleBundle(): ProceduralPbrMapBundle {
  const cached = getOrCreateCachedTexture('courtyard-continuous-cobble', () => {
    const width = 1024;
    const height = 1024;
    const bandW = 1.46;
    const bandsPerTile = 2;
    const tileSpanU = bandW * bandsPerTile;
    const courseStep = 0.1437559;
    const coursesPerTile = 16;
    const tileSpanS = coursesPerTile * courseStep;
    const rowsPerBand = 8;
    const cobbleStepU = bandW / rowsPerBand;
    const pxPerMeterS = width / tileSpanS;
    const pxPerMeterU = height / tileSpanU;

    const [colorCanvas, depthCanvas] = getOrCreateCachedCanvasPair(
      'courtyard-continuous-cobble',
      width,
      height,
      (cCtx, dCtx, cCanvas) => {
        cCtx.fillStyle = '#c4b18d';
        cCtx.fillRect(0, 0, width, height);

        dCtx.fillStyle = '#121212';
        dCtx.fillRect(0, 0, width, height);

        if (
          !isRecordingCanvasStub(cCanvas) &&
          typeof cCtx.createImageData === 'function' &&
          typeof cCtx.putImageData === 'function'
        ) {
          const cImg = cCtx.createImageData(width, height);
          const dImg = dCtx.createImageData(width, height);
          const cBuf = cImg.data;
          const dBuf = dImg.data;
          for (let y = 0; y < height; y += 4) {
            const ny = (y / height) * Math.PI * 2;
            const yMax = Math.min(height, y + 4);
            for (let x = 0; x < width; x += 4) {
              const nx = (x / width) * Math.PI * 2;
              const macroWave =
                Math.sin(nx * 2 + ny) * 6 +
                Math.cos(nx * 3 - ny * 2) * 5 +
                Math.sin(nx * 5 + ny * 4) * 3;
              const grit = (((x * 19 + y * 37) ^ (x * 7)) % 15) - 7;
              const mossSignal =
                Math.sin(nx * 3 + 0.8) * Math.cos(ny * 3 - 0.5) +
                Math.sin(nx * 7 - ny * 5) * 0.45;
              const isMossy = mossSignal > 0.68;
              const r = Math.max(
                135,
                Math.min(222, Math.round(196 + macroWave + grit - (isMossy ? 22 : 0)))
              );
              const g = Math.max(
                130,
                Math.min(212, Math.round(177 + macroWave + grit - (isMossy ? 6 : 0)))
              );
              const b = Math.max(
                105,
                Math.min(182, Math.round(141 + macroWave + grit - (isMossy ? 26 : 0)))
              );
              const dv = Math.max(8, Math.min(36, 19 + Math.round((macroWave + grit) * 0.55)));
              const xMax = Math.min(width, x + 4);
              for (let py = y; py < yMax; py++) {
                let idx = (py * width + x) * 4;
                for (let px = x; px < xMax; px++) {
                  cBuf[idx] = r;
                  cBuf[idx + 1] = g;
                  cBuf[idx + 2] = b;
                  cBuf[idx + 3] = 255;
                  dBuf[idx] = dv;
                  dBuf[idx + 1] = dv;
                  dBuf[idx + 2] = dv;
                  dBuf[idx + 3] = 255;
                  idx += 4;
                }
              }
            }
          }
          cCtx.putImageData(cImg, 0, 0);
          dCtx.putImageData(dImg, 0, 0);
        } else {
          for (let y = 0; y < height; y += 4) {
            const ny = (y / height) * Math.PI * 2;
            for (let x = 0; x < width; x += 4) {
              const nx = (x / width) * Math.PI * 2;
              const macroWave =
                Math.sin(nx * 2 + ny) * 6 +
                Math.cos(nx * 3 - ny * 2) * 5 +
                Math.sin(nx * 5 + ny * 4) * 3;
              const grit = (((x * 19 + y * 37) ^ (x * 7)) % 15) - 7;
              const mossSignal =
                Math.sin(nx * 3 + 0.8) * Math.cos(ny * 3 - 0.5) +
                Math.sin(nx * 7 - ny * 5) * 0.45;
              const isMossy = mossSignal > 0.68;

              const r = Math.max(
                135,
                Math.min(222, Math.round(196 + macroWave + grit - (isMossy ? 22 : 0)))
              );
              const g = Math.max(
                130,
                Math.min(212, Math.round(177 + macroWave + grit - (isMossy ? 6 : 0)))
              );
              const b = Math.max(
                105,
                Math.min(182, Math.round(141 + macroWave + grit - (isMossy ? 26 : 0)))
              );
              cCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
              cCtx.fillRect(x, y, 4, 4);

              const dv = Math.max(8, Math.min(36, 19 + Math.round((macroWave + grit) * 0.55)));
              dCtx.fillStyle = `rgb(${dv}, ${dv}, ${dv})`;
              dCtx.fillRect(x, y, 4, 4);
            }
          }
        }

        const granitePaletteRgb = DEFAULT_FAN_COBBLE_PALETTE;
        const baseCobbleW = (courseStep - 0.024) * pxPerMeterS;
        const baseCobbleH = (cobbleStepU - 0.024) * pxPerMeterU;

        for (let band = 0; band < bandsPerTile; band++) {
          const bandOffsetU = band * bandW;
          const bandArcPivotR = band === 0 ? 1.16 : 1.23;
          const bandCoursePhase = band === 0 ? 0.0 : 0.18;

          for (let c = -3; c <= coursesPerTile + 3; c++) {
            const wrappedC = ((c % coursesPerTile) + coursesPerTile) % coursesPerTile;
            const courseWave =
              Math.sin((wrappedC / coursesPerTile) * Math.PI * 4 + band * 1.7) * 0.008;

            for (let r = 0; r < rowsPerBand; r++) {
              const seed = band * 4099 + wrappedC * 131 + r * 17 + 23;
              const staggerU = (wrappedC % 2) * (cobbleStepU * 0.42);
              const jitterU = (stoneHash(seed + 1) - 0.5) * 0.014;
              const localU = (r + 0.46) * cobbleStepU + staggerU * 0.36 + jitterU;
              if (localU < 0.032 || localU > bandW - 0.032) continue;

              const du = localU - bandW * 0.5;
              const clampedDu = Math.max(-bandArcPivotR + 0.14, Math.min(bandArcPivotR - 0.14, du));
              const arcBow =
                bandArcPivotR - Math.sqrt(bandArcPivotR * bandArcPivotR - clampedDu * clampedDu);
              const arcTangentAngle =
                Math.asin(clampedDu / bandArcPivotR) + (stoneHash(seed + 2) - 0.5) * 0.062;

              const jitterS = (stoneHash(seed + 3) - 0.5) * 0.015 + courseWave;
              const s = (c + 0.5 + bandCoursePhase) * courseStep - arcBow + jitterS;
              const u = bandOffsetU + localU;

              const cxPx = (s / tileSpanS) * width;
              const cyPx = (u / tileSpanU) * height;
              if (cxPx < -baseCobbleW || cxPx > width + baseCobbleW) continue;

              const cobbleW = baseCobbleW * (0.87 + stoneHash(seed + 4) * 0.25);
              const cobbleH = baseCobbleH * (0.86 + stoneHash(seed + 5) * 0.24);
              const rx = -cobbleW * 0.5;
              const ry = -cobbleH * 0.5;

              const palIdx = Math.floor(stoneHash(seed + 6) * granitePaletteRgb.length);
              const [br, bg, bb] = granitePaletteRgb[palIdx] ?? [125, 129, 134];
              const toneShift = Math.round((stoneHash(seed + 7) - 0.5) * 24);
              const warmShift = Math.round((stoneHash(seed + 8) - 0.5) * 12);
              const sr = Math.max(62, Math.min(188, br + toneShift + warmShift));
              const sg = Math.max(62, Math.min(184, bg + toneShift));
              const sb = Math.max(60, Math.min(182, bb + toneShift - warmShift));

              const cobbleHeightBias = Math.round((stoneHash(seed + 9) - 0.5) * 34);

              cCtx.save();
              cCtx.translate(cxPx, cyPx);
              cCtx.rotate(arcTangentAngle);

              cCtx.fillStyle = 'rgba(42, 36, 28, 0.26)';
              traceOrganicCobblePath(cCtx, cobbleW + 3.2, cobbleH + 3.2, seed, 0);
              cCtx.fill();

              const grad = cCtx.createLinearGradient(rx, ry, -rx, -ry);
              grad.addColorStop(
                0,
                `rgb(${Math.min(215, sr + 14)}, ${Math.min(210, sg + 13)}, ${Math.min(205, sb + 11)})`
              );
              grad.addColorStop(0.55, `rgb(${sr}, ${sg}, ${sb})`);
              grad.addColorStop(
                1,
                `rgb(${Math.max(45, sr - 16)}, ${Math.max(45, sg - 16)}, ${Math.max(45, sb - 14)})`
              );
              cCtx.fillStyle = grad;
              traceOrganicCobblePath(cCtx, cobbleW, cobbleH, seed, 0);
              cCtx.fill();

              cCtx.strokeStyle = 'rgba(255, 248, 232, 0.22)';
              cCtx.lineWidth = 1.25;
              cCtx.stroke();

              for (let sp = 0; sp < 6; sp++) {
                const spX = (stoneHash(seed + 20 + sp * 3) - 0.5) * (cobbleW * 0.68);
                const spY = (stoneHash(seed + 21 + sp * 3) - 0.5) * (cobbleH * 0.68);
                const spR = 1.3 + stoneHash(seed + 22 + sp * 3) * 2.4;
                cCtx.fillStyle =
                  sp % 2 === 0 ? 'rgba(248, 242, 228, 0.16)' : 'rgba(28, 30, 34, 0.17)';
                cCtx.beginPath();
                cCtx.arc(spX, spY, spR, 0, Math.PI * 2);
                cCtx.fill();
              }

              if (stoneHash(seed + 45) > 0.68) {
                cCtx.strokeStyle =
                  stoneHash(seed + 46) > 0.5
                    ? 'rgba(235, 226, 210, 0.18)'
                    : 'rgba(42, 38, 34, 0.20)';
                cCtx.lineWidth = 0.9;
                cCtx.beginPath();
                cCtx.moveTo(rx * 0.65, (stoneHash(seed + 47) - 0.5) * cobbleH * 0.5);
                cCtx.lineTo(-rx * 0.65, (stoneHash(seed + 48) - 0.5) * cobbleH * 0.5);
                cCtx.stroke();
              }
              cCtx.restore();

              dCtx.save();
              dCtx.translate(cxPx, cyPx);
              dCtx.rotate(arcTangentAngle);

              const rings: ReadonlyArray<readonly [number, number]> = [
                [0.0, 92],
                [1.6, 154],
                [3.2, 204],
                [5.0, 238],
              ];
              for (const [inset, baseLum] of rings) {
                const lum = Math.max(42, Math.min(255, baseLum + cobbleHeightBias));
                dCtx.fillStyle = `rgb(${lum}, ${lum}, ${lum})`;
                traceOrganicCobblePath(dCtx, cobbleW, cobbleH, seed, inset);
                dCtx.fill();
              }

              const crownLum = Math.max(60, Math.min(255, 246 + cobbleHeightBias));
              dCtx.fillStyle = `rgb(${crownLum}, ${crownLum}, ${crownLum})`;
              dCtx.fillRect(
                rx + cobbleW * 0.22,
                ry + cobbleH * 0.24,
                Math.max(2, cobbleW * 0.52),
                Math.max(2, cobbleH * 0.36)
              );
              const pitLum = Math.max(40, Math.min(228, 174 + cobbleHeightBias));
              dCtx.fillStyle = `rgb(${pitLum}, ${pitLum}, ${pitLum})`;
              dCtx.fillRect(rx + 4, ry + 4, 3, 3);
              dCtx.fillRect(rx + cobbleW - 7, ry + cobbleH - 8, 3, 3);
              dCtx.restore();
            }
          }
        }
      }
    );

    const colorMap = createBrowserDataOrCanvasTexture(
      'courtyard-continuous-cobble:color',
      colorCanvas,
      {
        colorSpace: THREE.SRGBColorSpace,
        wrapS: THREE.RepeatWrapping,
        wrapT: THREE.RepeatWrapping,
        anisotropy: 8,
      }
    );
    colorMap.colorSpace = THREE.SRGBColorSpace;
    colorMap.wrapS = THREE.RepeatWrapping;
    colorMap.wrapT = THREE.RepeatWrapping;
    colorMap.anisotropy = 8;

    const depthMap = createBrowserDataOrCanvasTexture(
      'courtyard-continuous-cobble:depth',
      depthCanvas,
      {
        colorSpace: THREE.NoColorSpace,
        wrapS: THREE.RepeatWrapping,
        wrapT: THREE.RepeatWrapping,
        anisotropy: 8,
      }
    );
    depthMap.wrapS = THREE.RepeatWrapping;
    depthMap.wrapT = THREE.RepeatWrapping;
    depthMap.anisotropy = 8;

    const { normalMap, roughnessMap } = derivePbrNormalAndRoughnessMaps(
      'courtyard-continuous-cobble',
      depthCanvas,
      {
        normalStrength: 4.2,
        mortarThreshold: 0.24,
        mortarRoughness: 1.0,
        surfaceRoughnessMin: 0.62,
        surfaceRoughnessMax: 0.88,
        microGrainRoughness: 0.06,
      }
    );

    return { colorMap, depthMap, normalMap, roughnessMap };
  });

  return {
    colorMap: cached.colorMap,
    bumpMap: cached.depthMap,
    depthMap: cached.depthMap,
    normalMap: cached.normalMap,
    roughnessMap: cached.roughnessMap,
    tileSizeM: FAN_COBBLE_TILE_SIZE_M,
  };
}

/**
 * Snapshot-exact default `'riven-yorkstone'` generator matching heritage `createRivenYorkstonePatioTextures()`.
 */
function buildDefaultRivenYorkstoneBundle(): ProceduralPbrMapBundle {
  const base = getOrCreateCachedTexture('riven-yorkstone-patio:1024:1x1', () => {
    const size = 1024;
    const [colorCanvas, bumpCanvas] = getOrCreateCachedCanvasPair(
      'riven-yorkstone-patio:1024:1x1',
      size,
      size,
      (cCtx, bCtx) => {
        cCtx.fillStyle = '#5e584c';
        cCtx.fillRect(0, 0, size, size);
        bCtx.fillStyle = '#141414';
        bCtx.fillRect(0, 0, size, size);

        const hash = (n: number): number => {
          const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
          return x - Math.floor(x);
        };

        const yorkstonePalette: ReadonlyArray<RgbTuple> = [
          [176, 162, 138],
          [162, 154, 140],
          [186, 168, 138],
          [152, 146, 135],
          [170, 155, 129],
          [158, 152, 134],
          [181, 164, 142],
          [146, 138, 126],
        ];

        const courseHeights = [176, 152, 192, 164, 184, 156];
        let curY = 0;
        const jointPx = 7;

        for (let row = 0; row < courseHeights.length; row++) {
          const ch = courseHeights[row]!;
          const slabWidths =
            row % 3 === 0
              ? [268, 212, 304, 240]
              : row % 3 === 1
                ? [196, 284, 224, 320]
                : [312, 208, 260, 244];

          let curX = 0;
          for (let col = 0; col < slabWidths.length; col++) {
            const sw = slabWidths[col]!;
            const seed = row * 97 + col * 31 + 13;
            const pal = yorkstonePalette[Math.floor(hash(seed) * yorkstonePalette.length)]!;
            const delta = Math.round((hash(seed + 1) - 0.5) * 18);
            const warm = Math.round((hash(seed + 2) - 0.5) * 10);
            const rBase = Math.max(95, Math.min(215, pal[0] + delta + warm));
            const gBase = Math.max(90, Math.min(208, pal[1] + delta));
            const bBase = Math.max(80, Math.min(195, pal[2] + delta - warm));

            const sx = curX + jointPx * 0.5;
            const sy = curY + jointPx * 0.5;
            const w = sw - jointPx;
            const h = ch - jointPx;

            const grad = cCtx.createLinearGradient(sx, sy, sx + w, sy + h);
            grad.addColorStop(0, `rgb(${rBase + 8}, ${gBase + 7}, ${bBase + 5})`);
            grad.addColorStop(0.55, `rgb(${rBase}, ${gBase}, ${bBase})`);
            grad.addColorStop(1, `rgb(${rBase - 10}, ${gBase - 9}, ${bBase - 8})`);
            cCtx.fillStyle = grad;
            cCtx.fillRect(sx, sy, w, h);

            cCtx.strokeStyle = `rgba(${Math.min(235, rBase + 22)}, ${Math.min(228, gBase + 20)}, ${Math.min(210, bBase + 16)}, 0.48)`;
            cCtx.lineWidth = 2.5;
            cCtx.strokeRect(sx + 1.5, sy + 1.5, w - 3, h - 3);

            const slabBump = Math.round(165 + (hash(seed + 3) - 0.5) * 44);
            bCtx.fillStyle = `rgb(${slabBump}, ${slabBump}, ${slabBump})`;
            bCtx.fillRect(sx, sy, w, h);

            for (let py = sy + 3; py < sy + h - 3; py += 4) {
              const relY = (py - sy) / h;
              for (let px = sx + 3; px < sx + w - 3; px += 4) {
                const relX = (px - sx) / w;
                const ripple =
                  Math.sin(relX * Math.PI * 5 + relY * 8 + seed) * 6 +
                  Math.cos(relY * Math.PI * 6 - relX * 4 + seed * 0.7) * 5;
                const grain = (hash(px * 13 + py * 29 + seed) - 0.5) * 11;
                const edgeDist = Math.min(relX, 1 - relX, relY, 1 - relY);
                const lichen = edgeDist < 0.09 && hash(px * 7 + py * 19 + seed) > 0.65 ? -14 : 0;

                const pr = Math.max(85, Math.min(228, Math.round(rBase + ripple + grain + lichen)));
                const pg = Math.max(
                  82,
                  Math.min(222, Math.round(gBase + ripple + grain + (lichen ? -4 : 0)))
                );
                const pb = Math.max(
                  72,
                  Math.min(208, Math.round(bBase + ripple + grain + (lichen ? -18 : 0)))
                );
                cCtx.fillStyle = `rgb(${pr}, ${pg}, ${pb})`;
                cCtx.fillRect(px, py, 4, 4);

                const bv = Math.max(
                  95,
                  Math.min(
                    248,
                    Math.round(
                      slabBump + ripple * 1.9 + grain * 0.9 - (edgeDist < 0.04 ? 28 : 0)
                    )
                  )
                );
                bCtx.fillStyle = `rgb(${bv}, ${bv}, ${bv})`;
                bCtx.fillRect(px, py, 4, 4);
              }
            }

            curX += sw;
          }
          curY += ch;
        }
      }
    );

    const colorMap = createBrowserDataOrCanvasTexture(
      'riven-yorkstone-patio:color',
      colorCanvas,
      {
        wrapS: THREE.RepeatWrapping,
        wrapT: THREE.RepeatWrapping,
        colorSpace: THREE.SRGBColorSpace,
        anisotropy: 8,
      }
    );
    colorMap.wrapS = THREE.RepeatWrapping;
    colorMap.wrapT = THREE.RepeatWrapping;
    colorMap.colorSpace = THREE.SRGBColorSpace;
    colorMap.anisotropy = 8;

    const bumpMap = createBrowserDataOrCanvasTexture('riven-yorkstone-patio:bump', bumpCanvas, {
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      colorSpace: THREE.NoColorSpace,
      anisotropy: 8,
    });
    bumpMap.wrapS = THREE.RepeatWrapping;
    bumpMap.wrapT = THREE.RepeatWrapping;
    bumpMap.anisotropy = 8;

    return { colorMap, bumpMap, bumpCanvas };
  });

  const pbrOpts = {
    normalStrength: 3.4,
    mortarThreshold: 0.25,
    mortarRoughness: 0.98,
    surfaceRoughnessMin: 0.64,
    surfaceRoughnessMax: 0.88,
    microGrainRoughness: 0.05,
  } as const;

  // In snapshot recording mode, preserve per-call CanvasTexture wrapper identity (T213 & T305).
  const nr = isSnapshotRecordingCanvas(base.bumpCanvas)
    ? derivePbrNormalAndRoughnessMaps('riven-yorkstone-patio:pbr:1024:1x1', base.bumpCanvas, pbrOpts)
    : getOrCreateCachedTexture('riven-yorkstone-patio:pbr-bundle:1024:1x1', () =>
        derivePbrNormalAndRoughnessMaps('riven-yorkstone-patio:pbr:1024:1x1', base.bumpCanvas, pbrOpts)
      );

  return {
    colorMap: base.colorMap,
    bumpMap: base.bumpMap,
    depthMap: base.bumpMap,
    normalMap: nr.normalMap,
    roughnessMap: nr.roughnessMap,
    tileSizeM: RIVEN_YORKSTONE_TILE_SIZE_M,
  };
}

/**
 * Generates a tileable procedural cobblestone, sett, flagstone, or gravel PBR map bundle
 * across 7 built-in landscape & interior stone presets.
 */
export function createCobblestoneTextures(
  presetOrOptions?: CobblestonePreset | CobblestoneMaterialOptions
): ProceduralPbrMapBundle {
  const opts: CobblestoneMaterialOptions =
    !presetOrOptions
      ? { preset: 'fan-cobble' }
      : typeof presetOrOptions === 'string'
        ? { preset: presetOrOptions }
        : presetOrOptions;

  const preset: CobblestonePreset = opts.preset ?? 'fan-cobble';

  if (preset === 'fan-cobble' && isDefaultCobblestoneOptions(opts)) {
    return scaleBundleForWorldMetersPerUv(buildDefaultFanCobbleBundle(), opts.worldMetersPerUv);
  }
  if (preset === 'riven-yorkstone' && isDefaultCobblestoneOptions(opts)) {
    return scaleBundleForWorldMetersPerUv(
      buildDefaultRivenYorkstoneBundle(),
      opts.worldMetersPerUv
    );
  }

  const seedBase = Math.round(opts.seed ?? 0) * 991;
  const moss = Math.max(
    0,
    Math.min(
      1,
      opts.mossAndLichen ??
        (preset === 'courtyard-cobble' || preset === 'fan-cobble'
          ? 0.42
          : preset === 'honed-limestone'
            ? 0.0
            : 0.16)
    )
  );
  const valleyGutter = Boolean(opts.valleyGutter);

  const defaultTileSize: readonly [number, number] =
    preset === 'fan-cobble'
      ? FAN_COBBLE_TILE_SIZE_M
      : preset === 'courtyard-cobble'
        ? COURTYARD_COBBLE_TILE_SIZE_M
        : preset === 'granite-setts'
          ? GRANITE_SETTS_TILE_SIZE_M
          : preset === 'tumbled-pavers'
            ? TUMBLED_PAVERS_TILE_SIZE_M
            : preset === 'riven-yorkstone'
              ? RIVEN_YORKSTONE_TILE_SIZE_M
              : preset === 'honed-limestone'
                ? HONED_LIMESTONE_TILE_SIZE_M
                : PEA_GRAVEL_TILE_SIZE_M;

  const tileSizeM = opts.tileSizeM ?? defaultTileSize;
  const size = Math.max(
    64,
    Math.round(
      opts.resolution ??
        (preset === 'fan-cobble' || preset === 'riven-yorkstone' || preset === 'honed-limestone'
          ? 512
          : 512)
    )
  );

  const defaultMortar: RgbTuple =
    preset === 'granite-setts'
      ? [142, 134, 120]
      : preset === 'tumbled-pavers'
        ? [154, 139, 114]
        : preset === 'honed-limestone'
          ? [226, 218, 203]
          : preset === 'riven-yorkstone'
            ? [94, 88, 76]
            : preset === 'pea-gravel'
              ? [118, 104, 82]
              : [196, 177, 141];

  const mortarRgb = opts.mortarColor !== undefined ? toRgbTuple(opts.mortarColor) : defaultMortar;

  const defaultPalette: readonly RgbTuple[] =
    preset === 'granite-setts'
      ? [
          [118, 124, 132],
          [98, 105, 114],
          [134, 139, 146],
          [84, 90, 98],
          [108, 113, 121],
          [126, 128, 133],
        ]
      : preset === 'tumbled-pavers'
        ? [
            [198, 178, 144],
            [184, 163, 129],
            [210, 192, 158],
            [172, 151, 120],
            [192, 172, 138],
            [164, 145, 118],
          ]
        : preset === 'riven-yorkstone'
          ? [
              [176, 162, 138],
              [162, 154, 140],
              [186, 168, 138],
              [152, 146, 135],
              [170, 155, 129],
              [181, 164, 142],
            ]
          : preset === 'honed-limestone'
            ? [
                [219, 211, 194],
                [213, 204, 186],
                [208, 197, 178],
                [217, 208, 192],
                [210, 200, 182],
              ]
            : preset === 'pea-gravel'
              ? [
                  [206, 184, 142],
                  [188, 165, 124],
                  [164, 146, 116],
                  [218, 198, 158],
                  [136, 126, 110],
                  [176, 154, 118],
                  [112, 106, 98],
                ]
              : DEFAULT_FAN_COBBLE_PALETTE;

  const palette =
    opts.palette && opts.palette.length > 0 ? opts.palette.map(toRgbTuple) : defaultPalette;
  const palSig = palette.map((c) => c.join(',')).join(';');
  const cacheKey = [
    'husjs:cobble',
    preset,
    size,
    valleyGutter ? 'vg1' : 'vg0',
    mortarRgb.join(','),
    palSig,
    moss.toFixed(3),
    seedBase,
    tileSizeM[0].toFixed(4),
    tileSizeM[1].toFixed(4),
  ].join('|');

  const baseBundle = getOrCreateCachedTexture(cacheKey, (): ProceduralPbrMapBundle => {
    const [colorCanvas, depthCanvas] = getOrCreateCachedCanvasPair(
      cacheKey,
      size,
      size,
      (cCtx, dCtx) => {
        if (preset === 'fan-cobble') {
          paintSandyLimeMortarBase(cCtx, dCtx, size, size, mortarRgb, moss);
          const bandW = 1.46;
          const bandsPerTile = 2;
          const tileSpanU = bandW * bandsPerTile;
          const courseStep = 0.1437559;
          const coursesPerTile = 16;
          const tileSpanS = coursesPerTile * courseStep;
          const rowsPerBand = 8;
          const cobbleStepU = bandW / rowsPerBand;
          const baseW = (courseStep - 0.024) * (size / tileSpanS);
          const baseH = (cobbleStepU - 0.024) * (size / tileSpanU);

          for (let band = 0; band < bandsPerTile; band++) {
            const bandOffsetU = band * bandW;
            const pivotR = band === 0 ? 1.16 : 1.23;
            const phase = band === 0 ? 0.0 : 0.18;
            for (let c = -3; c <= coursesPerTile + 3; c++) {
              const wc = ((c % coursesPerTile) + coursesPerTile) % coursesPerTile;
              const wave = Math.sin((wc / coursesPerTile) * Math.PI * 4 + band * 1.7) * 0.008;
              for (let r = 0; r < rowsPerBand; r++) {
                const s = seedBase + band * 4099 + wc * 131 + r * 17 + 23;
                const localU =
                  (r + 0.46) * cobbleStepU +
                  (wc % 2) * (cobbleStepU * 0.1512) +
                  (stoneHash(s + 1) - 0.5) * 0.014;
                if (localU < 0.032 || localU > bandW - 0.032) continue;
                const du = Math.max(-pivotR + 0.14, Math.min(pivotR - 0.14, localU - bandW * 0.5));
                const bow = pivotR - Math.sqrt(pivotR * pivotR - du * du);
                const ang = Math.asin(du / pivotR) + (stoneHash(s + 2) - 0.5) * 0.062;
                const sCoord = (c + 0.5 + phase) * courseStep - bow + (stoneHash(s + 3) - 0.5) * 0.015 + wave;
                const cxPx = (sCoord / tileSpanS) * size;
                const cyPx = ((bandOffsetU + localU) / tileSpanU) * size;
                if (cxPx < -baseW || cxPx > size + baseW) continue;
                const cw = baseW * (0.87 + stoneHash(s + 4) * 0.25);
                const ch = baseH * (0.86 + stoneHash(s + 5) * 0.24);
                const rgb = palette[Math.floor(stoneHash(s + 6) * palette.length)]!;
                for (const oy of [-size, 0, size]) {
                  if (cyPx + oy < -baseH || cyPx + oy > size + baseH) continue;
                  drawSingleSettStone(cCtx, dCtx, cxPx, cyPx + oy, ang, cw, ch, rgb, s);
                }
              }
            }
          }
        } else if (preset === 'courtyard-cobble') {
          paintSandyLimeMortarBase(cCtx, dCtx, size, size, mortarRgb, moss);
          const cols = 10;
          const rows = 10;
          const cellW = size / cols;
          const cellH = size / rows;
          for (let r = 0; r < rows; r++) {
            const stagger = (r % 2) * (cellW * 0.46);
            const rowWave = Math.sin((r / rows) * Math.PI * 2) * (cellH * 0.08);
            for (let c = 0; c < cols; c++) {
              const s = seedBase + r * 149 + c * 37 + 19;
              const jx = (stoneHash(s + 1) - 0.5) * cellW * 0.24;
              const jy = (stoneHash(s + 2) - 0.5) * cellH * 0.22 + rowWave;
              const baseX = ((c + 0.5) * cellW + stagger + jx + size) % size;
              const baseY = ((r + 0.5) * cellH + jy + size) % size;
              const cw = cellW * (0.72 + stoneHash(s + 3) * 0.24);
              const ch = cellH * (0.7 + stoneHash(s + 4) * 0.24);
              const ang = (stoneHash(s + 5) - 0.5) * 0.42;
              const rgb = palette[Math.floor(stoneHash(s + 6) * palette.length)]!;
              for (const ox of [-size, 0, size]) {
                if (baseX + ox < -cw || baseX + ox > size + cw) continue;
                for (const oy of [-size, 0, size]) {
                  if (baseY + oy < -ch || baseY + oy > size + ch) continue;
                  drawSingleSettStone(cCtx, dCtx, baseX + ox, baseY + oy, ang, cw, ch, rgb, s);
                }
              }
            }
          }
        } else if (preset === 'granite-setts' || preset === 'tumbled-pavers') {
          paintSandyLimeMortarBase(cCtx, dCtx, size, size, mortarRgb, moss);
          const numRows = valleyGutter ? 6 : 8;
          const numCols = preset === 'granite-setts' ? 6 : 8;
          const rowH = size / numRows;
          const colW = size / numCols;
          const jointPx = Math.max(3.5, Math.min(rowH, colW) * (preset === 'tumbled-pavers' ? 0.11 : 0.1));

          for (let r = 0; r < numRows; r++) {
            const stagger = (r % 2) * (colW * 0.5);
            const distFromMid = Math.abs(r + 0.5 - numRows * 0.5) / (numRows * 0.5);
            const gutterRecess = valleyGutter ? -Math.round((1 - distFromMid) * 52) : 0;

            for (let c = 0; c < numCols; c++) {
              const s = seedBase + r * 113 + c * 41 + 13;
              const baseX = ((c + 0.5) * colW + stagger) % size;
              const baseY = (r + 0.5) * rowH + (stoneHash(s + 1) - 0.5) * 1.4;
              const cw = (colW - jointPx) * (0.94 + stoneHash(s + 2) * 0.1);
              const ch = (rowH - jointPx) * (0.94 + stoneHash(s + 3) * 0.1);
              const ang =
                (stoneHash(s + 4) - 0.5) * (preset === 'tumbled-pavers' ? 0.08 : 0.035);
              const rgb = palette[Math.floor(stoneHash(s + 5) * palette.length)]!;

              for (const ox of [-size, 0, size]) {
                if (baseX + ox < -cw || baseX + ox > size + cw) continue;
                for (const oy of [-size, 0, size]) {
                  if (baseY + oy < -ch || baseY + oy > size + ch) continue;
                  drawSingleSettStone(
                    cCtx,
                    dCtx,
                    baseX + ox,
                    baseY + oy,
                    ang,
                    cw,
                    ch,
                    rgb,
                    s,
                    gutterRecess
                  );
                }
              }
            }
          }
        } else if (preset === 'riven-yorkstone') {
          cCtx.fillStyle = `rgb(${mortarRgb[0]}, ${mortarRgb[1]}, ${mortarRgb[2]})`;
          cCtx.fillRect(0, 0, size, size);
          dCtx.fillStyle = '#141414';
          dCtx.fillRect(0, 0, size, size);

          const scale = size / 1024;
          const courseHeights = [176, 152, 192, 164, 184, 156].map((h) => h * scale);
          const jointPx = Math.max(2.5, 7 * scale);
          let curY = 0;

          for (let row = 0; row < courseHeights.length; row++) {
            const ch = courseHeights[row]!;
            const rawWidths =
              row % 3 === 0
                ? [268, 212, 304, 240]
                : row % 3 === 1
                  ? [196, 284, 224, 320]
                  : [312, 208, 260, 244];
            let curX = 0;
            for (let col = 0; col < rawWidths.length; col++) {
              const sw = rawWidths[col]! * scale;
              const s = seedBase + row * 97 + col * 31 + 13;
              const pal = palette[Math.floor(stoneHash(s) * palette.length)]!;
              const delta = Math.round((stoneHash(s + 1) - 0.5) * 18);
              const warm = Math.round((stoneHash(s + 2) - 0.5) * 10);
              const rB = clampByte(pal[0] + delta + warm);
              const gB = clampByte(pal[1] + delta);
              const bB = clampByte(pal[2] + delta - warm);

              const sx = curX + jointPx * 0.5;
              const sy = curY + jointPx * 0.5;
              const w = Math.max(4, sw - jointPx);
              const h = Math.max(4, ch - jointPx);

              cCtx.fillStyle = `rgb(${rB}, ${gB}, ${bB})`;
              cCtx.fillRect(sx, sy, w, h);

              const slabBump = clampByte(172 + (stoneHash(s + 3) - 0.5) * 40);
              dCtx.fillStyle = `rgb(${slabBump}, ${slabBump}, ${slabBump})`;
              dCtx.fillRect(sx, sy, w, h);

              const step = Math.max(3, Math.round(4 * scale));
              for (let py = sy + 2; py < sy + h - 2; py += step) {
                const relY = (py - sy) / h;
                for (let px = sx + 2; px < sx + w - 2; px += step) {
                  const relX = (px - sx) / w;
                  const ripple =
                    Math.sin(relX * Math.PI * 5 + relY * 8 + s) * 6 +
                    Math.cos(relY * Math.PI * 6 - relX * 4 + s * 0.7) * 5;
                  const grain = (stoneHash(px * 13 + py * 29 + s) - 0.5) * 10;
                  const edgeDist = Math.min(relX, 1 - relX, relY, 1 - relY);
                  const hasLichen =
                    moss > 0.02 &&
                    edgeDist < 0.1 &&
                    stoneHash(px * 7 + py * 19 + s) > 1 - moss * 0.85;
                  const pr = clampByte(rB + ripple + grain - (hasLichen ? 16 : 0));
                  const pg = clampByte(gB + ripple + grain - (hasLichen ? 4 : 0));
                  const pb = clampByte(bB + ripple + grain - (hasLichen ? 20 : 0));
                  cCtx.fillStyle = `rgb(${pr}, ${pg}, ${pb})`;
                  cCtx.fillRect(px, py, step, step);

                  const bv = clampByte(
                    slabBump + ripple * 1.8 + grain * 0.8 - (edgeDist < 0.04 ? 26 : 0)
                  );
                  dCtx.fillStyle = `rgb(${bv}, ${bv}, ${bv})`;
                  dCtx.fillRect(px, py, step, step);
                }
              }
              curX += sw;
            }
            curY += ch;
          }
        } else if (preset === 'honed-limestone') {
          cCtx.fillStyle = `rgb(${mortarRgb[0]}, ${mortarRgb[1]}, ${mortarRgb[2]})`;
          cCtx.fillRect(0, 0, size, size);
          dCtx.fillStyle = 'rgb(154, 154, 154)';
          dCtx.fillRect(0, 0, size, size);

          const scale = size / 1024;
          const courses = [
            { y: 0, h: 256, xSplits: [0, 368, 708, 1024] },
            { y: 256, h: 256, xSplits: [184, 548, 884, 1208] },
            { y: 512, h: 256, xSplits: [56, 432, 776, 1080] },
            { y: 768, h: 256, xSplits: [236, 596, 940, 1260] },
          ];
          const groutHalf = Math.max(0.75, 0.95 * scale);
          let slabIdx = 0;

          const drawLimestoneSlab = (
            sx: number,
            sy: number,
            sw: number,
            sh: number,
            rgb: RgbTuple,
            sIdx: number
          ): void => {
            cCtx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
            cCtx.beginPath();
            cCtx.roundRect(sx, sy, sw, sh, 1.4);
            cCtx.fill();

            dCtx.fillStyle = 'rgb(194, 194, 194)';
            dCtx.beginPath();
            dCtx.roundRect(sx, sy, sw, sh, 1.4);
            dCtx.fill();

            dCtx.fillStyle = 'rgb(212, 212, 212)';
            dCtx.beginPath();
            dCtx.roundRect(sx + 1.5, sy + 1.5, Math.max(2, sw - 3), Math.max(2, sh - 3), 1.0);
            dCtx.fill();

            const stepY = Math.max(8, Math.round(20 * scale));
            const stepX = Math.max(10, Math.round(26 * scale));
            for (let py = sy + 4; py < sy + sh - 6; py += stepY) {
              for (let px = sx + 4; px < sx + sw - 8; px += stepX) {
                const n = Math.round(
                  (stoneHash(px * 23 + py * 37 + sIdx * 13 + seedBase) - 0.5) * 10
                );
                cCtx.fillStyle = `rgba(${clampByte(rgb[0] + n)}, ${clampByte(rgb[1] + n)}, ${clampByte(rgb[2] + n - 1)}, 0.30)`;
                cCtx.fillRect(px, py, stepX - 2, stepY - 2);
                const bn = clampByte(212 + n * 1.6);
                dCtx.fillStyle = `rgba(${bn}, ${bn}, ${bn}, 0.30)`;
                dCtx.fillRect(px, py, stepX - 2, stepY - 2);
              }
            }

            // Calcite & shell fossil flecks
            for (let f = 0; f < 22; f++) {
              const fx =
                sx + 6 + stoneHash(seedBase + sIdx * 41 + f * 73) * Math.max(4, sw - 14);
              const fy =
                sy + 6 + stoneHash(seedBase + sIdx * 29 + f * 97) * Math.max(4, sh - 12);
              cCtx.fillStyle =
                f % 3 === 0 ? 'rgba(244, 240, 231, 0.34)' : 'rgba(186, 176, 160, 0.24)';
              cCtx.fillRect(fx, fy, f % 4 === 0 ? 4.5 : 2.5, 2.0);
            }
          };

          for (let r = 0; r < courses.length; r++) {
            const course = courses[r]!;
            for (let c = 0; c < course.xSplits.length - 1; c++) {
              const x0 = course.xSplits[c]! * scale;
              const x1 = course.xSplits[c + 1]! * scale;
              const sx = x0 + groutHalf;
              const sy = course.y * scale + groutHalf;
              const sw = x1 - x0 - groutHalf * 2;
              const sh = course.h * scale - groutHalf * 2;
              if (sw <= 4 || sh <= 4) continue;
              const base = palette[(slabIdx + Math.abs(seedBase)) % palette.length]!;
              const shift = Math.round((stoneHash(seedBase + slabIdx * 17 + r * 7) - 0.5) * 8);
              const rgb: RgbTuple = [
                clampByte(base[0] + shift),
                clampByte(base[1] + shift),
                clampByte(base[2] + shift),
              ];
              drawLimestoneSlab(sx, sy, sw, sh, rgb, slabIdx);
              if (sx + sw > size) {
                drawLimestoneSlab(sx - size, sy, sw, sh, rgb, slabIdx);
              }
              slabIdx++;
            }
          }
        } else {
          // 'pea-gravel': true seamless packed multi-scale angular Cotswold/flint pea-gravel
          cCtx.fillStyle = `rgb(${clampByte(mortarRgb[0] * 0.48)}, ${clampByte(mortarRgb[1] * 0.48)}, ${clampByte(mortarRgb[2] * 0.48)})`;
          cCtx.fillRect(0, 0, size, size);
          dCtx.fillStyle = 'rgb(16, 16, 16)';
          dCtx.fillRect(0, 0, size, size);

          const layers: ReadonlyArray<{
            readonly cells: number;
            readonly minR: number;
            readonly maxR: number;
            readonly baseLum: number;
            readonly layerSeed: number;
          }> = [
            { cells: 16, minR: 0.36, maxR: 0.56, baseLum: 96, layerSeed: 101 },
            { cells: 22, minR: 0.28, maxR: 0.46, baseLum: 158, layerSeed: 307 },
            { cells: 28, minR: 0.22, maxR: 0.38, baseLum: 214, layerSeed: 613 },
          ];

          const traceAngularPebble = (
            ctx: CanvasRenderingContext2D,
            rx: number,
            ry: number,
            pSeed: number
          ): void => {
            const verts = 7;
            ctx.beginPath();
            for (let v = 0; v < verts; v++) {
              const ang = (v / verts) * Math.PI * 2;
              const radJit = 0.8 + stoneHash(pSeed + v * 13) * 0.34;
              const vx = Math.cos(ang) * rx * radJit;
              const vy = Math.sin(ang) * ry * radJit;
              if (v === 0) ctx.moveTo(vx, vy);
              else ctx.lineTo(vx, vy);
            }
            ctx.closePath();
          };

          for (const layer of layers) {
            const cellPx = size / layer.cells;
            for (let gy = 0; gy < layer.cells; gy++) {
              for (let gx = 0; gx < layer.cells; gx++) {
                const pSeed = seedBase + layer.layerSeed * 1009 + gy * 131 + gx * 37;
                const cx = (gx + 0.18 + stoneHash(pSeed + 1) * 0.64) * cellPx;
                const cy = (gy + 0.18 + stoneHash(pSeed + 2) * 0.64) * cellPx;
                const rx = cellPx * (layer.minR + stoneHash(pSeed + 3) * (layer.maxR - layer.minR));
                const ry = rx * (0.72 + stoneHash(pSeed + 4) * 0.42);
                const rot = stoneHash(pSeed + 5) * Math.PI;
                const pal = palette[Math.floor(stoneHash(pSeed + 6) * palette.length)]!;
                const delta = Math.round((stoneHash(pSeed + 7) - 0.5) * 32);
                const rC = clampByte(pal[0] + delta);
                const gC = clampByte(pal[1] + delta);
                const bC = clampByte(pal[2] + delta);
                const maxR = Math.max(rx, ry) + 3;

                for (const ox of [-size, 0, size]) {
                  if (cx + ox < -maxR || cx + ox > size + maxR) continue;
                  for (const oy of [-size, 0, size]) {
                    if (cy + oy < -maxR || cy + oy > size + maxR) continue;

                    // Interstitial shadow AO halo + angular mineral facet
                    cCtx.save();
                    cCtx.translate(cx + ox, cy + oy);
                    cCtx.rotate(rot);
                    cCtx.fillStyle = 'rgba(24, 20, 16, 0.36)';
                    traceAngularPebble(cCtx, rx + 1.4, ry + 1.4, pSeed);
                    cCtx.fill();

                    const grad = cCtx.createLinearGradient(-rx, -ry, rx, ry);
                    grad.addColorStop(
                      0,
                      `rgb(${clampByte(rC + 20)}, ${clampByte(gC + 18)}, ${clampByte(bC + 14)})`
                    );
                    grad.addColorStop(0.55, `rgb(${rC}, ${gC}, ${bC})`);
                    grad.addColorStop(
                      1,
                      `rgb(${clampByte(rC - 26)}, ${clampByte(gC - 24)}, ${clampByte(bC - 20)})`
                    );
                    cCtx.fillStyle = grad;
                    traceAngularPebble(cCtx, rx, ry, pSeed);
                    cCtx.fill();
                    cCtx.restore();

                    // Layered height crown in depth map
                    const lumEdge = clampByte(
                      layer.baseLum - 38 + (stoneHash(pSeed + 8) - 0.5) * 26
                    );
                    const lumCrown = clampByte(
                      layer.baseLum + 22 + (stoneHash(pSeed + 8) - 0.5) * 26
                    );
                    dCtx.save();
                    dCtx.translate(cx + ox, cy + oy);
                    dCtx.rotate(rot);
                    dCtx.fillStyle = `rgb(${lumEdge}, ${lumEdge}, ${lumEdge})`;
                    traceAngularPebble(dCtx, rx, ry, pSeed);
                    dCtx.fill();
                    dCtx.fillStyle = `rgb(${lumCrown}, ${lumCrown}, ${lumCrown})`;
                    traceAngularPebble(dCtx, rx * 0.62, ry * 0.62, pSeed);
                    dCtx.fill();
                    dCtx.restore();
                  }
                }
              }
            }
          }
        }
      }
    );

    const colorMap = createBrowserDataOrCanvasTexture(`${cacheKey}:color`, colorCanvas, {
      colorSpace: THREE.SRGBColorSpace,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      anisotropy: 8,
    });
    colorMap.colorSpace = THREE.SRGBColorSpace;
    colorMap.wrapS = THREE.RepeatWrapping;
    colorMap.wrapT = THREE.RepeatWrapping;
    colorMap.anisotropy = 8;

    const depthMap = createBrowserDataOrCanvasTexture(`${cacheKey}:depth`, depthCanvas, {
      colorSpace: THREE.NoColorSpace,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      anisotropy: 8,
    });
    depthMap.colorSpace = THREE.NoColorSpace;
    depthMap.wrapS = THREE.RepeatWrapping;
    depthMap.wrapT = THREE.RepeatWrapping;
    depthMap.anisotropy = 8;

    const pbrCfg =
      preset === 'honed-limestone'
        ? {
            normalStrength: 1.05,
            mortarThreshold: 0.65,
            mortarRoughness: 0.7,
            surfaceRoughnessMin: 0.45,
            surfaceRoughnessMax: 0.62,
            microGrainRoughness: 0.025,
          }
        : preset === 'pea-gravel'
          ? {
              normalStrength: 4.4,
              mortarThreshold: 0.22,
              mortarRoughness: 1.0,
              surfaceRoughnessMin: 0.82,
              surfaceRoughnessMax: 0.98,
              microGrainRoughness: 0.08,
            }
          : {
              normalStrength: 3.9,
              mortarThreshold: 0.24,
              mortarRoughness: 0.99,
              surfaceRoughnessMin: 0.62,
              surfaceRoughnessMax: 0.89,
              microGrainRoughness: 0.055,
            };

    const { normalMap, roughnessMap } = derivePbrNormalAndRoughnessMaps(
      cacheKey,
      depthCanvas,
      pbrCfg
    );

    return {
      colorMap,
      bumpMap: depthMap,
      depthMap,
      normalMap,
      roughnessMap,
      tileSizeM,
    };
  });

  return scaleBundleForWorldMetersPerUv(baseBundle, opts.worldMetersPerUv);
}

/**
 * Creates a `THREE.MeshStandardMaterial` configured with procedural cobblestone/flagstone/gravel PBR maps.
 * Defaults `worldMetersPerUv` to `1.0` so `1 UV = 1 m` world-space slabs & paths repeat automatically at `1 / tileSizeM`.
 */
export function createCobblestoneMaterial(
  presetOrOptions?: CobblestonePreset | CobblestoneMaterialOptions
): THREE.MeshStandardMaterial {
  const opts: CobblestoneMaterialOptions =
    !presetOrOptions
      ? { preset: 'fan-cobble' }
      : typeof presetOrOptions === 'string'
        ? { preset: presetOrOptions }
        : presetOrOptions;
  const preset = opts.preset ?? 'fan-cobble';
  const worldMetersPerUv = opts.worldMetersPerUv === undefined ? 1.0 : opts.worldMetersPerUv;
  const maps = createCobblestoneTextures({ ...opts, worldMetersPerUv });

  const defaultRoughness =
    preset === 'honed-limestone' ? 0.56 : preset === 'pea-gravel' ? 0.95 : 0.86;
  const defaultBumpScale =
    preset === 'honed-limestone' ? 0.008 : preset === 'pea-gravel' ? 0.045 : 0.036;
  const nScale = opts.normalScale ?? (preset === 'honed-limestone' ? 0.45 : 0.9);
  const normalScaleVec =
    typeof nScale === "number"
      ? new THREE.Vector2(nScale, nScale)
      : new THREE.Vector2(nScale[0], nScale[1]);

  return new THREE.MeshStandardMaterial({
    color: opts.tint ?? 0xffffff,
    map: maps.colorMap,
    bumpMap: maps.bumpMap,
    bumpScale: opts.bumpScale ?? defaultBumpScale,
    normalMap: maps.normalMap,
    normalScale: normalScaleVec,
    roughnessMap: maps.roughnessMap,
    roughness: opts.roughness ?? defaultRoughness,
    metalness: opts.metalness ?? (preset === 'honed-limestone' ? 0.01 : 0.04),
  });
}

/**
 * Shared 1024x1024 North Wales double-lap roof slate canvas pair used by both
 * `createWelshSlateRoofTextures()` (legacy `7.5 x 3.2` repeat) and
 * `createStoneMasonryTextures('welsh-slate-roof')` (clean `1:1` base repeat).
 */
export function getWelshSlateRoofCanvasPair(): readonly [HTMLCanvasElement, HTMLCanvasElement] {
  const size = 1024;
  return getOrCreateCachedCanvasPair('welsh-slate-roof', size, size, (cCtx, bCtx) => {
    const hash01 = (n: number): number => {
      const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
      return s - Math.floor(s);
    };

    cCtx.fillStyle = '#1e2329';
    cCtx.fillRect(0, 0, size, size);

    bCtx.fillStyle = '#121212';
    bCtx.fillRect(0, 0, size, size);

    const numRows = 16;
    const numCols = 8;
    const courseH = size / numRows;
    const tileW = size / numCols;

    const slatePalette: ReadonlyArray<RgbTuple> = [
      [58, 66, 76],
      [66, 74, 85],
      [52, 59, 68],
      [64, 68, 79],
      [71, 79, 90],
      [55, 62, 72],
      [61, 66, 75],
      [48, 55, 64],
      [68, 73, 82],
      [59, 68, 78],
    ];

    for (let row = 0; row < numRows; row++) {
      const y0 = row * courseH;
      const stagger = (row % 2) * (tileW * 0.5);

      for (let col = -1; col <= numCols; col++) {
        const colMod = ((col % numCols) + numCols) % numCols;
        const seed = row * 53 + colMod * 29 + 17;

        const baseRgb = slatePalette[seed % slatePalette.length] ?? [58, 66, 76];
        const toneDelta = Math.round((hash01(seed * 13 + 3) - 0.5) * 16);
        const plumShift = Math.round((hash01(seed * 19 + 7) - 0.5) * 6);
        const sr = Math.max(34, Math.min(115, baseRgb[0] + toneDelta + plumShift));
        const sg = Math.max(38, Math.min(122, baseRgb[1] + toneDelta));
        const sb = Math.max(44, Math.min(134, baseRgb[2] + toneDelta - plumShift));

        const perpGap = 3.2;
        const tailJitter = (hash01(seed * 23 + 11) - 0.5) * 1.8;
        const chamfer = 4.5 + hash01(seed * 31 + 5) * 3.5;
        const xLeft = col * tileW + stagger + perpGap * 0.5;
        const sW = tileW - perpGap;
        const sH = courseH - 2.2 + tailJitter;

        const slateBumpBias = Math.round((hash01(seed * 37 + 9) - 0.5) * 24);
        const headBump = Math.max(70, Math.min(175, 118 + slateBumpBias));
        const tailBump = Math.max(165, Math.min(252, 224 + slateBumpBias));

        const traceSlatePath = (
          ctx: CanvasRenderingContext2D,
          ox: number,
          oy: number,
          w: number,
          h: number
        ): void => {
          const midWave1 = (hash01(seed * 41 + 1) - 0.5) * 1.4;
          const midWave2 = (hash01(seed * 43 + 2) - 0.5) * 1.4;
          ctx.beginPath();
          ctx.moveTo(ox, oy);
          ctx.lineTo(ox + w, oy);
          ctx.lineTo(ox + w, oy + h - chamfer);
          ctx.lineTo(ox + w - chamfer, oy + h);
          ctx.lineTo(ox + w * 0.66, oy + h + midWave2);
          ctx.lineTo(ox + w * 0.33, oy + h + midWave1);
          ctx.lineTo(ox + chamfer, oy + h);
          ctx.lineTo(ox, oy + h - chamfer);
          ctx.closePath();
        };

        const bodyGrad = cCtx.createLinearGradient(xLeft, y0, xLeft, y0 + sH);
        bodyGrad.addColorStop(
          0.0,
          `rgb(${Math.max(28, sr - 10)}, ${Math.max(32, sg - 10)}, ${Math.max(38, sb - 9)})`
        );
        bodyGrad.addColorStop(0.22, `rgb(${sr}, ${sg}, ${sb})`);
        bodyGrad.addColorStop(
          0.82,
          `rgb(${Math.min(130, sr + 7)}, ${Math.min(138, sg + 8)}, ${Math.min(148, sb + 9)})`
        );
        bodyGrad.addColorStop(
          1.0,
          `rgb(${Math.min(142, sr + 12)}, ${Math.min(150, sg + 13)}, ${Math.min(162, sb + 14)})`
        );
        cCtx.fillStyle = bodyGrad;
        traceSlatePath(cCtx, xLeft, y0, sW, sH);
        cCtx.fill();

        const bumpGrad = bCtx.createLinearGradient(xLeft, y0, xLeft, y0 + sH);
        bumpGrad.addColorStop(0.0, `rgb(${headBump}, ${headBump}, ${headBump})`);
        bumpGrad.addColorStop(0.88, `rgb(${tailBump - 12}, ${tailBump - 12}, ${tailBump - 12})`);
        bumpGrad.addColorStop(1.0, `rgb(${tailBump}, ${tailBump}, ${tailBump})`);
        bCtx.fillStyle = bumpGrad;
        traceSlatePath(bCtx, xLeft, y0, sW, sH);
        bCtx.fill();

        const numCleavageSteps = 4;
        for (let st = 0; st < numCleavageSteps; st++) {
          const fracY = 0.18 + st * 0.21 + (hash01(seed * 47 + st) - 0.5) * 0.08;
          const cy = y0 + fracY * sH;
          const stepH = 6 + hash01(seed * 53 + st) * 10;
          const isLightStep = (st + seed) % 2 === 0;
          cCtx.fillStyle = isLightStep ? 'rgba(210, 222, 236, 0.055)' : 'rgba(18, 22, 28, 0.065)';
          cCtx.fillRect(xLeft + 3, cy, sW - 6, stepH);

          const ridgeLum = isLightStep
            ? Math.min(255, tailBump + 10)
            : Math.max(50, headBump - 12);
          bCtx.fillStyle = `rgb(${ridgeLum}, ${ridgeLum}, ${ridgeLum})`;
          bCtx.fillRect(xLeft + 3, cy, sW - 6, 2.2);
        }

        cCtx.save();
        traceSlatePath(cCtx, xLeft, y0, sW, sH);
        cCtx.clip();
        for (let g = 0; g < 9; g++) {
          const gx0 = xLeft - 10 + hash01(seed * 59 + g * 7) * (sW + 20);
          const gy0 = y0 + hash01(seed * 61 + g * 11) * sH;
          const gLen = 22 + hash01(seed * 67 + g * 13) * 38;
          cCtx.strokeStyle =
            g % 2 === 0 ? 'rgba(225, 235, 245, 0.048)' : 'rgba(16, 20, 25, 0.055)';
          cCtx.lineWidth = 1.2;
          cCtx.beginPath();
          cCtx.moveTo(gx0, gy0);
          cCtx.lineTo(gx0 + gLen, gy0 + (hash01(seed + g) - 0.5) * 8);
          cCtx.stroke();
        }

        if (hash01(seed * 71 + 19) < 0.22) {
          const lx = xLeft + 18 + hash01(seed * 73) * Math.max(12, sW - 36);
          const ly = y0 + 16 + hash01(seed * 79) * Math.max(10, sH - 28);
          const lr = 7 + hash01(seed * 83) * 9;
          const isGoldLichen = hash01(seed * 89) < 0.35;
          cCtx.fillStyle = isGoldLichen ? 'rgba(168, 152, 96, 0.14)' : 'rgba(136, 148, 130, 0.13)';
          cCtx.beginPath();
          cCtx.ellipse(lx, ly, lr * 1.3, lr * 0.75, 0.25, 0, Math.PI * 2);
          cCtx.fill();
        }
        cCtx.restore();

        cCtx.strokeStyle = 'rgba(205, 218, 232, 0.22)';
        cCtx.lineWidth = 1.3;
        cCtx.beginPath();
        cCtx.moveTo(xLeft + 1, y0 + 2);
        cCtx.lineTo(xLeft + 1, y0 + sH - chamfer);
        cCtx.lineTo(xLeft + chamfer, y0 + sH - 0.8);
        cCtx.lineTo(xLeft + sW - chamfer, y0 + sH - 0.8);
        cCtx.lineTo(xLeft + sW - 1, y0 + sH - chamfer);
        cCtx.stroke();
      }

      const headShadow = cCtx.createLinearGradient(0, y0, 0, y0 + 10);
      headShadow.addColorStop(0.0, 'rgba(12, 15, 20, 0.82)');
      headShadow.addColorStop(0.45, 'rgba(18, 22, 28, 0.42)');
      headShadow.addColorStop(1.0, 'rgba(24, 29, 36, 0.0)');
      cCtx.fillStyle = headShadow;
      cCtx.fillRect(0, y0, size, 10);

      bCtx.fillStyle = '#181818';
      bCtx.fillRect(0, y0, size, 3);
    }
  });
}

function drawDryStoneWallCanvases(
  cCtx: CanvasRenderingContext2D,
  bCtx: CanvasRenderingContext2D,
  width: number,
  height: number,
  palette: readonly RgbTuple[],
  seedOffset: number
): void {
  cCtx.fillStyle = '#231d17';
  cCtx.fillRect(0, 0, width, height);
  bCtx.fillStyle = '#0a0a0a';
  bCtx.fillRect(0, 0, width, height);

  const hash = (n: number): number => {
    const x = Math.sin(n * 91.7 + 197.3) * 43758.5453;
    return x - Math.floor(x);
  };

  const scaleY = height / 512;
  const scaleX = width / 1024;
  const courseHeights = [52, 42, 48, 38, 54, 44, 46, 40, 50, 46, 52].map((h) => h * scaleY);
  let curY = 0;

  for (let row = 0; row < courseHeights.length; row++) {
    const ch = courseHeights[row]!;
    const staggerPx = Math.round(hash(seedOffset + row * 37 + 5) * 90 * scaleX);
    let curX = -staggerPx;
    let col = 0;

    while (curX < width) {
      const seed = seedOffset + row * 173 + col * 29 + 19;
      const rem = width - curX;
      const targetW = Math.round((88 + hash(seed) * 118) * scaleX);
      const sw = rem < 150 * scaleX ? rem : targetW;

      const pal = palette[Math.floor(hash(seed + 1) * palette.length)]!;
      const shift = Math.round((hash(seed + 2) - 0.5) * 24);
      const warm = Math.round((hash(seed + 3) - 0.5) * 14);
      const rBase = Math.max(82, Math.min(220, pal[0] + shift + warm));
      const gBase = Math.max(76, Math.min(205, pal[1] + shift));
      const bBase = Math.max(64, Math.min(182, pal[2] + shift - warm));

      const padX = 3.5 * scaleX;
      const padY = 3.0 * scaleY;
      const sx = curX + padX;
      const sy = curY + padY;
      const w = Math.max(12 * scaleX, sw - padX * 2);
      const h = Math.max(10 * scaleY, ch - padY * 2);

      const traceDryStonePoly = (ctx: CanvasRenderingContext2D, inset = 0): void => {
        const x0 = sx + inset;
        const y0 = sy + inset;
        const x1 = sx + w - inset;
        const y1 = sy + h - inset;
        const j = (k: number): number => (hash(seed + k * 13) - 0.5) * 3.6;
        const chf = Math.min(7, h * 0.22);

        ctx.beginPath();
        ctx.moveTo(x0 + chf + j(1), y0 + j(2));
        ctx.lineTo(x0 + w * 0.5 + j(3), y0 + j(4) * 0.7);
        ctx.lineTo(x1 - chf + j(5), y0 + j(6));
        ctx.lineTo(x1 + j(7), y0 + chf + j(8));
        ctx.lineTo(x1 + j(9), y1 - chf + j(10));
        ctx.lineTo(x1 - chf + j(11), y1 + j(12));
        ctx.lineTo(x0 + w * 0.5 + j(13), y1 + j(14) * 0.7);
        ctx.lineTo(x0 + chf + j(15), y1 + j(16));
        ctx.lineTo(x0 + j(17), y1 - chf + j(18));
        ctx.lineTo(x0 + j(19), y0 + chf + j(20));
        ctx.closePath();
      };

      const grad = cCtx.createLinearGradient(sx, sy, sx, sy + h);
      grad.addColorStop(
        0,
        `rgb(${Math.min(235, rBase + 22)}, ${Math.min(220, gBase + 19)}, ${Math.min(198, bBase + 15)})`
      );
      grad.addColorStop(0.28, `rgb(${rBase + 6}, ${gBase + 5}, ${bBase + 3})`);
      grad.addColorStop(0.78, `rgb(${rBase - 6}, ${gBase - 6}, ${bBase - 5})`);
      grad.addColorStop(
        1,
        `rgb(${Math.max(48, rBase - 34)}, ${Math.max(42, gBase - 30)}, ${Math.max(35, bBase - 26)})`
      );

      cCtx.save();
      traceDryStonePoly(cCtx, 0);
      cCtx.fillStyle = grad;
      cCtx.fill();
      cCtx.clip();

      for (let sLine = 0; sLine < 3; sLine++) {
        const ly = sy + (0.25 + sLine * 0.24 + (hash(seed + 30 + sLine) - 0.5) * 0.1) * h;
        cCtx.strokeStyle =
          sLine % 2 === 0
            ? `rgba(42, 34, 26, 0.28)`
            : `rgba(${Math.min(242, rBase + 28)}, ${Math.min(228, gBase + 24)}, ${Math.min(205, bBase + 18)}, 0.25)`;
        cCtx.lineWidth = 1.4;
        cCtx.beginPath();
        cCtx.moveTo(sx, ly);
        cCtx.lineTo(sx + w * 0.5, ly + (hash(seed + 40 + sLine) - 0.5) * 3);
        cCtx.lineTo(sx + w, ly + (hash(seed + 50 + sLine) - 0.5) * 3);
        cCtx.stroke();
      }

      const speckCount = Math.floor((w * h) / 70);
      for (let sp = 0; sp < speckCount; sp++) {
        const px = sx + hash(seed + sp * 7 + 100) * w;
        const py = sy + hash(seed + sp * 11 + 200) * h;
        const isDark = sp % 2 === 0;
        cCtx.fillStyle = isDark
          ? `rgba(48, 39, 30, 0.22)`
          : `rgba(${Math.min(245, rBase + 32)}, ${Math.min(232, gBase + 28)}, ${Math.min(210, bBase + 22)}, 0.24)`;
        cCtx.fillRect(px, py, 2.5, 2.0);
      }
      cCtx.restore();

      const baseBump = Math.round(145 + hash(seed + 9) * 85);
      bCtx.save();
      traceDryStonePoly(bCtx, 0);
      bCtx.fillStyle = `rgb(${Math.max(55, baseBump - 65)}, ${Math.max(55, baseBump - 65)}, ${Math.max(55, baseBump - 65)})`;
      bCtx.fill();

      traceDryStonePoly(bCtx, 2.5);
      bCtx.fillStyle = `rgb(${baseBump}, ${baseBump}, ${baseBump})`;
      bCtx.fill();

      traceDryStonePoly(bCtx, 5.0);
      const crownBump = Math.min(252, baseBump + 24);
      bCtx.fillStyle = `rgb(${crownBump}, ${crownBump}, ${crownBump})`;
      bCtx.fill();
      bCtx.restore();

      if (curX < 0) {
        cCtx.save();
        cCtx.translate(width, 0);
        traceDryStonePoly(cCtx, 0);
        cCtx.fillStyle = grad;
        cCtx.fill();
        cCtx.restore();

        bCtx.save();
        bCtx.translate(width, 0);
        traceDryStonePoly(bCtx, 0);
        bCtx.fillStyle = `rgb(${baseBump}, ${baseBump}, ${baseBump})`;
        bCtx.fill();
        bCtx.restore();
      }

      curX += sw;
      col++;
    }
    curY += ch;
  }
}

const DEFAULT_DRY_STONE_PALETTE: readonly RgbTuple[] = [
  [186, 158, 120],
  [168, 146, 118],
  [152, 138, 122],
  [194, 168, 132],
  [138, 126, 112],
  [175, 152, 122],
  [146, 136, 116],
  [162, 134, 104],
];

function buildDefaultDryStoneWallBundle(): ProceduralPbrMapBundle {
  const base = getOrCreateCachedTexture('dry-stone-wall:1024x512:1x1', () => {
    const width = 1024;
    const height = 512;
    const [colorCanvas, bumpCanvas] = getOrCreateCachedCanvasPair(
      'dry-stone-wall:1024x512:1x1',
      width,
      height,
      (cCtx, bCtx) => {
        drawDryStoneWallCanvases(cCtx, bCtx, width, height, DEFAULT_DRY_STONE_PALETTE, 0);
      }
    );

    const colorMap = createBrowserDataOrCanvasTexture('dry-stone-wall:color', colorCanvas, {
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      colorSpace: THREE.SRGBColorSpace,
      anisotropy: 8,
    });
    colorMap.wrapS = THREE.RepeatWrapping;
    colorMap.wrapT = THREE.RepeatWrapping;
    colorMap.colorSpace = THREE.SRGBColorSpace;
    colorMap.anisotropy = 8;

    const bumpMap = createBrowserDataOrCanvasTexture('dry-stone-wall:bump', bumpCanvas, {
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      colorSpace: THREE.NoColorSpace,
      anisotropy: 8,
    });
    bumpMap.wrapS = THREE.RepeatWrapping;
    bumpMap.wrapT = THREE.RepeatWrapping;
    bumpMap.anisotropy = 8;

    return { colorMap, bumpMap, bumpCanvas };
  });

  const pbrOpts = {
    normalStrength: 4.2,
    mortarThreshold: 0.28,
    mortarRoughness: 0.99,
    surfaceRoughnessMin: 0.7,
    surfaceRoughnessMax: 0.92,
    microGrainRoughness: 0.06,
  } as const;

  const nr = isSnapshotRecordingCanvas(base.bumpCanvas)
    ? derivePbrNormalAndRoughnessMaps('dry-stone-wall:pbr:1024x512:1x1', base.bumpCanvas, pbrOpts)
    : getOrCreateCachedTexture('dry-stone-wall:pbr-bundle:1024x512:1x1', () =>
        derivePbrNormalAndRoughnessMaps('dry-stone-wall:pbr:1024x512:1x1', base.bumpCanvas, pbrOpts)
      );

  return {
    colorMap: base.colorMap,
    bumpMap: base.bumpMap,
    depthMap: base.bumpMap,
    normalMap: nr.normalMap,
    roughnessMap: nr.roughnessMap,
    tileSizeM: [IRONSTONE_WALL_TILE_W_M, IRONSTONE_WALL_TILE_H_M],
  };
}

function buildSawnYorkstoneCopingBundle(
  seedOffset = 0,
  tileSizeM: readonly [number, number] = [YORKSTONE_COPING_TILE_M, YORKSTONE_COPING_TILE_M]
): ProceduralPbrMapBundle {
  const size = 256;
  const keySuffix = seedOffset === 0 ? 'v1' : `v1:s${seedOffset}`;

  const buildDataTex = (
    key: string,
    srgb: boolean,
    fill: (rgba: Uint8Array) => void
  ): THREE.DataTexture =>
    getOrCreateCachedTexture(key, () => {
      const data = new Uint8Array(size * size * 4);
      fill(data);
      const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
      tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(1, 1);
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.needsUpdate = true;
      return tex;
    });

  const sampleFields = (px: number, py: number) => {
    const macro = valueNoise2D((px / size) * 6, (py / size) * 6, 6, 6, 701 + seedOffset);
    const bedding = valueNoise2D((px / size) * 4, (py / size) * 18, 4, 18, 709 + seedOffset);
    const med = valueNoise2D((px / size) * 24, (py / size) * 24, 24, 24, 719 + seedOffset);
    const fine = valueNoise2D((px / size) * 72, (py / size) * 72, 72, 72, 733 + seedOffset);
    const speck = hash2D(px, py, 751 + seedOffset);
    return { macro, bedding, med, fine, speck };
  };

  const colorMap = buildDataTex(`grounds:sawn-yorkstone-coping:color:${keySuffix}`, true, (rgba) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const { macro, bedding, med, fine, speck } = sampleFields(x, y);
        const warmShift =
          (macro - 0.5) * 18 + (bedding - 0.5) * 11 + (med - 0.5) * 8 + (fine - 0.5) * 6;
        const mica = speck > 0.965 ? 10 : speck < 0.035 ? -9 : 0;
        const r = Math.max(120, Math.min(220, Math.round(176 + warmShift + mica)));
        const g = Math.max(115, Math.min(212, Math.round(169 + warmShift * 0.94 + mica * 0.9)));
        const b = Math.max(104, Math.min(198, Math.round(154 + warmShift * 0.82 + mica * 0.8)));
        const idx = (y * size + x) * 4;
        rgba[idx] = r;
        rgba[idx + 1] = g;
        rgba[idx + 2] = b;
        rgba[idx + 3] = 255;
      }
    }
  });

  const bumpMap = buildDataTex(`grounds:sawn-yorkstone-coping:bump:${keySuffix}`, false, (rgba) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const { bedding, med, fine, speck } = sampleFields(x, y);
        const h = Math.max(
          0,
          Math.min(
            255,
            Math.round(
              128 +
                (bedding - 0.5) * 32 +
                (med - 0.5) * 36 +
                (fine - 0.5) * 44 +
                (speck - 0.5) * 18
            )
          )
        );
        const idx = (y * size + x) * 4;
        rgba[idx] = h;
        rgba[idx + 1] = h;
        rgba[idx + 2] = h;
        rgba[idx + 3] = 255;
      }
    }
  });

  const roughnessMap = buildDataTex(
    `grounds:sawn-yorkstone-coping:rough:${keySuffix}`,
    false,
    (rgba) => {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const { macro, med, fine } = sampleFields(x, y);
          const rVal = Math.max(
            150,
            Math.min(
              242,
              Math.round(202 + (macro - 0.5) * 24 + (med - 0.5) * 20 - (fine - 0.5) * 16)
            )
          );
          const idx = (y * size + x) * 4;
          rgba[idx] = rVal;
          rgba[idx + 1] = rVal;
          rgba[idx + 2] = rVal;
          rgba[idx + 3] = 255;
        }
      }
    }
  );

  // Pure CPU Sobel normalMap from `bumpMap` (zero DOM/RecordingCanvas allocation)
  const normalMap = buildDataTex(
    `grounds:sawn-yorkstone-coping:normal:${keySuffix}`,
    false,
    (rgba) => {
      const hBuf = (bumpMap.image as { data: Uint8Array }).data;
      const hAt = (x: number, y: number): number => {
        const wx = ((x % size) + size) % size;
        const wy = ((y % size) + size) % size;
        return hBuf[(wy * size + wx) * 4]! * (1 / 255);
      };
      const strength = 2.2;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const tl = hAt(x - 1, y - 1);
          const tc = hAt(x, y - 1);
          const tr = hAt(x + 1, y - 1);
          const ml = hAt(x - 1, y);
          const mr = hAt(x + 1, y);
          const bl = hAt(x - 1, y + 1);
          const bc = hAt(x, y + 1);
          const br = hAt(x + 1, y + 1);
          const dX = (tr + 2 * mr + br - (tl + 2 * ml + bl)) * 0.125;
          const dY = (bl + 2 * bc + br - (tl + 2 * tc + tr)) * 0.125;
          const nx = -dX * strength;
          const ny = dY * strength;
          const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
          const idx = (y * size + x) * 4;
          rgba[idx] = clampByte((nx * inv * 0.5 + 0.5) * 255);
          rgba[idx + 1] = clampByte((ny * inv * 0.5 + 0.5) * 255);
          rgba[idx + 2] = Math.max(128, clampByte((inv * 0.5 + 0.5) * 255));
          rgba[idx + 3] = 255;
        }
      }
    }
  );

  return {
    colorMap: colorMap as unknown as THREE.CanvasTexture,
    bumpMap: bumpMap as unknown as THREE.CanvasTexture,
    depthMap: bumpMap as unknown as THREE.CanvasTexture,
    normalMap: normalMap as unknown as THREE.CanvasTexture,
    roughnessMap,
    tileSizeM,
  };
}

/**
 * Generates a tileable procedural stone masonry PBR map bundle (`'cotswold-dry-stone'`,
 * `'sawn-yorkstone-coping'`, or `'welsh-slate-roof'`) with clean non-mutated `1:1` base repeat.
 */
export function createStoneMasonryTextures(
  presetOrOptions?: StoneMasonryPreset | StoneMasonryMaterialOptions
): ProceduralPbrMapBundle {
  const opts: StoneMasonryMaterialOptions =
    !presetOrOptions
      ? { preset: 'cotswold-dry-stone' }
      : typeof presetOrOptions === 'string'
        ? { preset: presetOrOptions }
        : presetOrOptions;

  const preset: StoneMasonryPreset = opts.preset ?? 'cotswold-dry-stone';

  if (preset === 'cotswold-dry-stone') {
    if (isDefaultStoneMasonryOptions(opts)) {
      return scaleBundleForWorldMetersPerUv(buildDefaultDryStoneWallBundle(), opts.worldMetersPerUv);
    }
    const width = Math.max(128, Math.round(opts.resolution ?? 1024));
    const height = Math.max(64, Math.round(width * 0.5));
    const palette =
      opts.palette && opts.palette.length > 0
        ? opts.palette.map(toRgbTuple)
        : DEFAULT_DRY_STONE_PALETTE;
    const seedOffset = Math.round(opts.seed ?? 0) * 977;
    const tileSizeM = opts.tileSizeM ?? [IRONSTONE_WALL_TILE_W_M, IRONSTONE_WALL_TILE_H_M];
    const cacheKey = `husjs:stone:cotswold-dry-stone:${width}x${height}:${seedOffset}:${palette.map((c) => c.join(',')).join(';')}`;

    const customBundle = getOrCreateCachedTexture(cacheKey, (): ProceduralPbrMapBundle => {
      const [colorCanvas, bumpCanvas] = getOrCreateCachedCanvasPair(
        cacheKey,
        width,
        height,
        (cCtx, bCtx) => {
          drawDryStoneWallCanvases(cCtx, bCtx, width, height, palette, seedOffset);
        }
      );
      const colorMap = createBrowserDataOrCanvasTexture(`${cacheKey}:color`, colorCanvas, {
        wrapS: THREE.RepeatWrapping,
        wrapT: THREE.RepeatWrapping,
        colorSpace: THREE.SRGBColorSpace,
        anisotropy: 8,
      });
      colorMap.wrapS = THREE.RepeatWrapping;
      colorMap.wrapT = THREE.RepeatWrapping;
      colorMap.colorSpace = THREE.SRGBColorSpace;
      colorMap.anisotropy = 8;

      const bumpMap = createBrowserDataOrCanvasTexture(`${cacheKey}:bump`, bumpCanvas, {
        wrapS: THREE.RepeatWrapping,
        wrapT: THREE.RepeatWrapping,
        colorSpace: THREE.NoColorSpace,
        anisotropy: 8,
      });
      bumpMap.wrapS = THREE.RepeatWrapping;
      bumpMap.wrapT = THREE.RepeatWrapping;
      bumpMap.anisotropy = 8;

      const { normalMap, roughnessMap } = derivePbrNormalAndRoughnessMaps(cacheKey, bumpCanvas, {
        normalStrength: 4.2,
        mortarThreshold: 0.28,
        mortarRoughness: 0.99,
        surfaceRoughnessMin: 0.7,
        surfaceRoughnessMax: 0.92,
        microGrainRoughness: 0.06,
      });

      return {
        colorMap,
        bumpMap,
        depthMap: bumpMap,
        normalMap,
        roughnessMap,
        tileSizeM,
      };
    });
    return scaleBundleForWorldMetersPerUv(customBundle, opts.worldMetersPerUv);
  }

  if (preset === 'sawn-yorkstone-coping') {
    const seedOffset = Math.round(opts.seed ?? 0) * 31;
    const tileSizeM = opts.tileSizeM ?? [YORKSTONE_COPING_TILE_M, YORKSTONE_COPING_TILE_M];
    const base = buildSawnYorkstoneCopingBundle(seedOffset, tileSizeM);
    return scaleBundleForWorldMetersPerUv(base, opts.worldMetersPerUv);
  }

  // 'welsh-slate-roof': clean 1:1 base repeat (never mutated by legacy 7.5x3.2 repeat!)
  const tileSizeM = opts.tileSizeM ?? WELSH_SLATE_TILE_SIZE_M;
  const slateBundle = getOrCreateCachedTexture(
    `husjs:stone:welsh-slate-roof:1x1:${tileSizeM[0]}x${tileSizeM[1]}`,
    (): ProceduralPbrMapBundle => {
      const [colorCanvas, bumpCanvas] = getWelshSlateRoofCanvasPair();
      const colorMap = createBrowserDataOrCanvasTexture(
        'husjs:welsh-slate-roof:1x1:color',
        colorCanvas,
        {
          wrapS: THREE.RepeatWrapping,
          wrapT: THREE.RepeatWrapping,
          colorSpace: THREE.SRGBColorSpace,
          anisotropy: 8,
        }
      );
      colorMap.wrapS = THREE.RepeatWrapping;
      colorMap.wrapT = THREE.RepeatWrapping;
      colorMap.colorSpace = THREE.SRGBColorSpace;
      colorMap.anisotropy = 8;

      const bumpMap = createBrowserDataOrCanvasTexture(
        'husjs:welsh-slate-roof:1x1:bump',
        bumpCanvas,
        {
          wrapS: THREE.RepeatWrapping,
          wrapT: THREE.RepeatWrapping,
          colorSpace: THREE.NoColorSpace,
          anisotropy: 8,
        }
      );
      bumpMap.wrapS = THREE.RepeatWrapping;
      bumpMap.wrapT = THREE.RepeatWrapping;
      bumpMap.anisotropy = 8;

      const { normalMap, roughnessMap } = derivePbrNormalAndRoughnessMaps(
        'husjs:welsh-slate-roof:1x1',
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

      return {
        colorMap,
        bumpMap,
        depthMap: bumpMap,
        normalMap,
        roughnessMap,
        tileSizeM,
      };
    }
  );
  return scaleBundleForWorldMetersPerUv(slateBundle, opts.worldMetersPerUv);
}

/**
 * Creates a `THREE.MeshStandardMaterial` configured with procedural stone masonry PBR maps.
 * Defaults `worldMetersPerUv` to `1.0` so `1 UV = 1 m` walls/copings/roofs repeat automatically at `1 / tileSizeM`.
 */
export function createStoneMasonryMaterial(
  presetOrOptions?: StoneMasonryPreset | StoneMasonryMaterialOptions
): THREE.MeshStandardMaterial {
  const opts: StoneMasonryMaterialOptions =
    !presetOrOptions
      ? { preset: 'cotswold-dry-stone' }
      : typeof presetOrOptions === 'string'
        ? { preset: presetOrOptions }
        : presetOrOptions;
  const preset = opts.preset ?? 'cotswold-dry-stone';
  const worldMetersPerUv = opts.worldMetersPerUv === undefined ? 1.0 : opts.worldMetersPerUv;
  const maps = createStoneMasonryTextures({ ...opts, worldMetersPerUv });

  const defaultRoughness =
    preset === 'sawn-yorkstone-coping' ? 0.84 : preset === 'welsh-slate-roof' ? 0.78 : 0.91;
  const defaultBumpScale =
    preset === 'sawn-yorkstone-coping' ? 0.016 : preset === 'welsh-slate-roof' ? 0.024 : 0.036;
  const nScale = opts.normalScale ?? (preset === 'sawn-yorkstone-coping' ? 0.55 : 0.9);
  const normalScaleVec =
    typeof nScale === "number"
      ? new THREE.Vector2(nScale, nScale)
      : new THREE.Vector2(nScale[0], nScale[1]);

  return new THREE.MeshStandardMaterial({
    color: opts.tint ?? 0xffffff,
    map: maps.colorMap,
    bumpMap: maps.bumpMap,
    bumpScale: opts.bumpScale ?? defaultBumpScale,
    normalMap: maps.normalMap,
    normalScale: normalScaleVec,
    roughnessMap: maps.roughnessMap,
    roughness: opts.roughness ?? defaultRoughness,
    metalness: opts.metalness ?? (preset === 'welsh-slate-roof' ? 0.05 : 0.02),
  });
}
