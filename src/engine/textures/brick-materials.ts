import * as THREE from 'three';
import { UK_BRICK_TILE_H_M, UK_BRICK_TILE_W_M } from './metric-masonry-uvs.ts';
import { derivePbrNormalAndRoughnessMaps } from './pbr-surface-maps.ts';
import {
  createBrowserDataOrCanvasTexture,
  createSharedSourceTextureVariant,
  getOrCreateCachedCanvasPair,
  getOrCreateCachedTexture,
} from './texture-registry.ts';

export interface ProceduralPbrMapBundle {
  readonly colorMap: THREE.CanvasTexture;
  readonly bumpMap: THREE.CanvasTexture;
  /** Height/relief alias for `bumpMap` for symmetry across masonry & cobblestone generators. */
  readonly depthMap: THREE.CanvasTexture;
  readonly normalMap: THREE.CanvasTexture;
  readonly roughnessMap: THREE.Texture;
  /** Physical world dimensions `[widthM, heightM]` spanned by one `[0..1]` UV tile. */
  readonly tileSizeM: readonly [number, number];
}

export type BrickPreset =
  | 'heritage-red-flemish'
  | 'weathered-cottage'
  | 'yellow-london-stock'
  | 'dark-engineered'
  | 'limewashed-brick'
  | 'herringbone-pavers';

export type BrickBond =
  | 'flemish'
  | 'english'
  | 'stretcher'
  | 'header'
  | 'soldier'
  | 'herringbone-45'
  | 'herringbone-90';

export type RgbTuple = readonly [number, number, number];

export interface BrickWeatheringOptions {
  /** Fraction `[0..1]` of bricks receiving kiln-flashing / coal-scorch bloom. */
  readonly kilnFlash?: number;
  /** Atmospheric soot & smoke darkening `[0..1]`. */
  readonly sootLevel?: number;
  /** Breathable chalky limewash coat `[0..1]` worn back across brick arrises and headers. */
  readonly limewash?: number;
  /** Damp-course & mortar-joint moss / crustose lichen `[0..1]`. */
  readonly mossAndLichen?: number;
}

export interface BrickMaterialOptions {
  readonly preset?: BrickPreset;
  readonly bond?: BrickBond;
  /** Physical brick stretcher length in metres (default `0.215` UK standard). */
  readonly brickLengthM?: number;
  /** Physical brick header width in metres (default `0.1025` UK standard). */
  readonly brickWidthM?: number;
  /** Physical brick course height excluding mortar in metres (default `0.065` UK standard). */
  readonly brickHeightM?: number;
  /** Physical mortar bed/perp joint thickness in metres (default `0.010` = `10 mm`). */
  readonly mortarJointM?: number;
  /** Mortar color override. */
  readonly mortarColor?: THREE.ColorRepresentation;
  /** Custom stretcher color palette (`[r, g, b]` in `0..255` or CSS/hex `ColorRepresentation`). */
  readonly palette?: ReadonlyArray<THREE.ColorRepresentation | RgbTuple>;
  /** Optional header color palette (`[r, g, b]` in `0..255` or CSS/hex `ColorRepresentation`). */
  readonly headerPalette?: ReadonlyArray<THREE.ColorRepresentation | RgbTuple>;
  /** Grouped weathering controls. */
  readonly weathering?: BrickWeatheringOptions;
  readonly kilnFlash?: number;
  readonly sootLevel?: number;
  readonly limewash?: number;
  readonly mossAndLichen?: number;
  /** Deterministic variation seed (default `0`). */
  readonly seed?: number;
  /** Explicit physical `[widthM, heightM]` override for 1 UV repeat. */
  readonly tileSizeM?: readonly [number, number];
  /**
   * World metres covered by `1.0` UV unit on target meshes.
   * - `createBrickMaterial` defaults this to `1.0` (`repeat = [1 / tileW, 1 / tileH]` via shared-source variants).
   * - `createBrickTextures` leaves base maps at `repeat = (1, 1)` unless `worldMetersPerUv` is explicitly supplied.
   */
  readonly worldMetersPerUv?: number | null;
  /** Procedural canvas resolution in pixels (default `512`). */
  readonly resolution?: number;
  readonly normalScale?: number | readonly [number, number];
  readonly bumpScale?: number;
  readonly roughness?: number;
  readonly metalness?: number;
  readonly tint?: THREE.ColorRepresentation;
}

interface BrickPresetConfig {
  readonly defaultBond: BrickBond;
  readonly mortarRgb: RgbTuple;
  readonly stretcherPalette: readonly RgbTuple[];
  readonly headerPalette: readonly RgbTuple[];
  readonly kilnFlash: number;
  readonly sootLevel: number;
  readonly limewash: number;
  readonly mossAndLichen: number;
  readonly crispArris: boolean;
  readonly roughness: number;
  readonly surfaceRoughnessMin: number;
  readonly surfaceRoughnessMax: number;
  readonly normalStrength: number;
  readonly bumpScale: number;
  readonly defaultTileSizeM: readonly [number, number];
}

const BRICK_PRESET_CONFIGS: Record<BrickPreset, BrickPresetConfig> = {
  'heritage-red-flemish': {
    defaultBond: 'flemish',
    mortarRgb: [202, 187, 160],
    stretcherPalette: [
      [162, 72, 53],
      [176, 82, 57],
      [142, 59, 43],
      [186, 94, 64],
      [152, 67, 49],
      [168, 76, 55],
      [131, 53, 40],
      [181, 87, 60],
      [124, 54, 43],
      [170, 88, 63],
      [146, 68, 52],
      [190, 96, 66],
    ],
    headerPalette: [
      [120, 56, 45],
      [142, 63, 47],
      [158, 72, 53],
      [108, 49, 41],
      [134, 64, 50],
      [172, 80, 56],
    ],
    kilnFlash: 0.45,
    sootLevel: 0.0,
    limewash: 0.0,
    mossAndLichen: 0.0,
    crispArris: false,
    roughness: 0.88,
    surfaceRoughnessMin: 0.72,
    surfaceRoughnessMax: 0.92,
    normalStrength: 3.4,
    bumpScale: 0.028,
    defaultTileSizeM: [UK_BRICK_TILE_W_M, UK_BRICK_TILE_H_M],
  },
  'weathered-cottage': {
    defaultBond: 'english',
    mortarRgb: [208, 196, 174],
    stretcherPalette: [
      [168, 92, 74],
      [154, 82, 66],
      [179, 103, 82],
      [143, 74, 60],
      [162, 88, 70],
      [174, 98, 78],
      [138, 69, 57],
      [184, 110, 88],
    ],
    headerPalette: [
      [132, 68, 58],
      [146, 77, 64],
      [122, 62, 53],
      [158, 86, 70],
    ],
    kilnFlash: 0.38,
    sootLevel: 0.16,
    limewash: 0.14,
    mossAndLichen: 0.28,
    crispArris: false,
    roughness: 0.91,
    surfaceRoughnessMin: 0.76,
    surfaceRoughnessMax: 0.95,
    normalStrength: 3.5,
    bumpScale: 0.03,
    defaultTileSizeM: [UK_BRICK_TILE_W_M, UK_BRICK_TILE_H_M],
  },
  'yellow-london-stock': {
    defaultBond: 'flemish',
    mortarRgb: [214, 204, 184],
    stretcherPalette: [
      [194, 166, 112],
      [182, 153, 101],
      [204, 176, 122],
      [171, 142, 92],
      [188, 158, 106],
      [164, 134, 88],
      [199, 170, 116],
      [156, 126, 84],
    ],
    headerPalette: [
      [158, 131, 86],
      [142, 116, 78],
      [174, 146, 98],
      [126, 102, 72],
    ],
    kilnFlash: 0.52,
    sootLevel: 0.22,
    limewash: 0.0,
    mossAndLichen: 0.06,
    crispArris: false,
    roughness: 0.89,
    surfaceRoughnessMin: 0.74,
    surfaceRoughnessMax: 0.93,
    normalStrength: 3.3,
    bumpScale: 0.026,
    defaultTileSizeM: [UK_BRICK_TILE_W_M, UK_BRICK_TILE_H_M],
  },
  'dark-engineered': {
    defaultBond: 'stretcher',
    mortarRgb: [148, 144, 136],
    stretcherPalette: [
      [58, 60, 68],
      [50, 53, 62],
      [66, 65, 72],
      [45, 48, 56],
      [72, 68, 74],
      [54, 56, 65],
    ],
    headerPalette: [
      [46, 49, 58],
      [54, 56, 64],
      [40, 43, 52],
    ],
    kilnFlash: 0.24,
    sootLevel: 0.05,
    limewash: 0.0,
    mossAndLichen: 0.0,
    crispArris: true,
    roughness: 0.68,
    surfaceRoughnessMin: 0.52,
    surfaceRoughnessMax: 0.76,
    normalStrength: 2.9,
    bumpScale: 0.02,
    defaultTileSizeM: [UK_BRICK_TILE_W_M, UK_BRICK_TILE_H_M],
  },
  'limewashed-brick': {
    defaultBond: 'flemish',
    mortarRgb: [228, 222, 210],
    stretcherPalette: [
      [174, 92, 72],
      [162, 82, 64],
      [184, 102, 79],
      [152, 76, 59],
      [168, 88, 68],
    ],
    headerPalette: [
      [138, 70, 58],
      [152, 79, 64],
      [128, 64, 54],
    ],
    kilnFlash: 0.18,
    sootLevel: 0.03,
    limewash: 0.78,
    mossAndLichen: 0.05,
    crispArris: false,
    roughness: 0.93,
    surfaceRoughnessMin: 0.82,
    surfaceRoughnessMax: 0.97,
    normalStrength: 3.1,
    bumpScale: 0.025,
    defaultTileSizeM: [UK_BRICK_TILE_W_M, UK_BRICK_TILE_H_M],
  },
  'herringbone-pavers': {
    defaultBond: 'herringbone-45',
    mortarRgb: [185, 171, 147],
    stretcherPalette: [
      [164, 82, 62],
      [148, 72, 54],
      [176, 94, 68],
      [132, 66, 54],
      [156, 86, 66],
      [170, 88, 64],
      [139, 64, 49],
    ],
    headerPalette: [
      [138, 68, 54],
      [152, 76, 58],
      [124, 60, 48],
    ],
    kilnFlash: 0.32,
    sootLevel: 0.06,
    limewash: 0.0,
    mossAndLichen: 0.12,
    crispArris: false,
    roughness: 0.86,
    surfaceRoughnessMin: 0.68,
    surfaceRoughnessMax: 0.9,
    normalStrength: 3.4,
    bumpScale: 0.026,
    defaultTileSizeM: [1.36, 1.36],
  },
};

export const BRICK_PRESETS: readonly BrickPreset[] = [
  'heritage-red-flemish',
  'weathered-cottage',
  'yellow-london-stock',
  'dark-engineered',
  'limewashed-brick',
  'herringbone-pavers',
] as const;

export const BRICK_BONDS: readonly BrickBond[] = [
  'flemish',
  'english',
  'stretcher',
  'header',
  'soldier',
  'herringbone-45',
  'herringbone-90',
] as const;

function normalizeBrickOptions(
  presetOrOptions?: BrickPreset | BrickMaterialOptions
): BrickMaterialOptions {
  if (!presetOrOptions) return { preset: 'heritage-red-flemish' };
  if (typeof presetOrOptions === 'string') return { preset: presetOrOptions };
  return presetOrOptions;
}

function toRgbTuple(c: THREE.ColorRepresentation | RgbTuple): RgbTuple {
  if (Array.isArray(c) && c.length === 3) {
    return [
      Math.max(0, Math.min(255, Math.round(Number(c[0])))),
      Math.max(0, Math.min(255, Math.round(Number(c[1])))),
      Math.max(0, Math.min(255, Math.round(Number(c[2])))),
    ];
  }
  const col = new THREE.Color(c as THREE.ColorRepresentation);
  return [
    Math.max(0, Math.min(255, Math.round(col.r * 255))),
    Math.max(0, Math.min(255, Math.round(col.g * 255))),
    Math.max(0, Math.min(255, Math.round(col.b * 255))),
  ];
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function hash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function isDefaultImperialBrickRequest(opts: BrickMaterialOptions): boolean {
  const preset = opts.preset ?? 'heritage-red-flemish';
  if (preset !== 'heritage-red-flemish') return false;
  if (opts.bond !== undefined && opts.bond !== 'flemish') return false;
  return (
    opts.brickLengthM === undefined &&
    opts.brickWidthM === undefined &&
    opts.brickHeightM === undefined &&
    opts.mortarJointM === undefined &&
    opts.mortarColor === undefined &&
    opts.palette === undefined &&
    opts.headerPalette === undefined &&
    opts.weathering === undefined &&
    opts.kilnFlash === undefined &&
    opts.sootLevel === undefined &&
    opts.limewash === undefined &&
    opts.mossAndLichen === undefined &&
    opts.seed === undefined &&
    opts.tileSizeM === undefined &&
    opts.resolution === undefined
  );
}

/**
 * Snapshot-exact heritage English Imperial Flemish-bond brick bundle (`'imperial-brick'`).
 * Preserves bit-for-bit identical canvas draw commands and cache keys for `createImperialBrickTextures()`.
 */
function getBaseImperialBrickBundle(): ProceduralPbrMapBundle {
  const cached = getOrCreateCachedTexture('imperial-brick', () => {
    const [colorCanvas, bumpCanvas] = getOrCreateCachedCanvasPair(
      'imperial-brick',
      512,
      512,
      (cCtx, bCtx) => {
        cCtx.fillStyle = '#cabba0';
        cCtx.fillRect(0, 0, 512, 512);

        bCtx.fillStyle = '#181818';
        bCtx.fillRect(0, 0, 512, 512);

        for (let y = 0; y < 512; y += 3) {
          for (let x = 0; x < 512; x += 3) {
            const mx = x % 512;
            const my = y % 512;
            const h1 = hash01(mx * 17 + my * 31);
            const h2 = hash01(mx * 43 + my * 13 + 7);
            const d = Math.round((h1 - 0.5) * 24);
            const warmShift = Math.round((h2 - 0.5) * 10);
            cCtx.fillStyle = `rgb(${202 + d + warmShift}, ${188 + d}, ${161 + d - warmShift})`;
            cCtx.fillRect(x, y, 3, 3);

            const mb = Math.round(18 + h1 * 22);
            bCtx.fillStyle = `rgb(${mb}, ${mb}, ${mb})`;
            bCtx.fillRect(x, y, 3, 3);
          }
        }

        const stretcherPalette = BRICK_PRESET_CONFIGS['heritage-red-flemish'].stretcherPalette;
        const headerPalette = BRICK_PRESET_CONFIGS['heritage-red-flemish'].headerPalette;

        const numCourses = 16;
        const courseH = 512 / numCourses;
        const mortarH = 4.8;
        const brickH = courseH - mortarH;
        const unitW = 128;
        const stretcherW = 81;
        const headerW = 38;
        const mortarW = 4.5;

        const traceRusticBrickPath = (
          ctx: CanvasRenderingContext2D,
          bx: number,
          by: number,
          bw: number,
          bh: number,
          seed: number,
          inset = 0
        ): void => {
          const xL = bx + inset;
          const xR = bx + bw - inset;
          const yT = by + inset;
          const yB = by + bh - inset;
          const wSpan = xR - xL;
          const hSpan = yB - yT;
          const c = Math.max(1.2, 2.8 - inset * 0.5);

          const tWave1 = (hash01(seed * 11 + 1) - 0.5) * 1.8;
          const tWave2 = (hash01(seed * 11 + 2) - 0.5) * 1.8;
          const bWave1 = (hash01(seed * 11 + 3) - 0.5) * 1.8;
          const bWave2 = (hash01(seed * 11 + 4) - 0.5) * 1.8;
          const lWave = (hash01(seed * 11 + 5) - 0.5) * 1.4;
          const rWave = (hash01(seed * 11 + 6) - 0.5) * 1.4;

          ctx.beginPath();
          ctx.moveTo(xL + c, yT);
          ctx.lineTo(xL + wSpan * 0.35, yT + tWave1);
          ctx.lineTo(xL + wSpan * 0.68, yT + tWave2);
          ctx.lineTo(xR - c, yT);
          ctx.quadraticCurveTo(xR, yT, xR, yT + c);
          ctx.lineTo(xR + rWave, yT + hSpan * 0.5);
          ctx.lineTo(xR, yB - c);
          ctx.quadraticCurveTo(xR, yB, xR - c, yB);
          ctx.lineTo(xL + wSpan * 0.65, yB + bWave2);
          ctx.lineTo(xL + wSpan * 0.32, yB + bWave1);
          ctx.lineTo(xL + c, yB);
          ctx.quadraticCurveTo(xL, yB, xL, yB - c);
          ctx.lineTo(xL + lWave, yT + hSpan * 0.5);
          ctx.lineTo(xL, yT + c);
          ctx.quadraticCurveTo(xL, yT, xL + c, yT);
          ctx.closePath();
        };

        const drawBrick = (
          x0: number,
          y0: number,
          w: number,
          h: number,
          rgb: RgbTuple,
          seed: number
        ): void => {
          const [r, g, b] = rgb;
          const delta = Math.round((hash01(seed * 19 + 3) - 0.5) * 26);
          const warmTint = Math.round((hash01(seed * 31 + 9) - 0.5) * 12);
          const br = Math.max(38, Math.min(238, r + delta + warmTint));
          const bg = Math.max(28, Math.min(212, g + Math.round(delta * 0.68)));
          const bb = Math.max(
            22,
            Math.min(195, b + Math.round(delta * 0.48) - Math.round(warmTint * 0.4))
          );

          const jitterX = (hash01(seed * 23 + 5) - 0.5) * 1.8;
          const jitterY = (hash01(seed * 29 + 7) - 0.5) * 1.6;
          const jitterW = (hash01(seed * 37 + 11) - 0.5) * 2.2;
          const jitterH = (hash01(seed * 41 + 13) - 0.5) * 1.8;
          const effY = y0 + jitterY;
          const effW = w + jitterW;
          const effH = h + jitterH;

          for (const wrapOffsetX of [-512, 0, 512]) {
            const bx = x0 + jitterX + wrapOffsetX;
            if (bx + effW < -2 || bx > 514) continue;

            cCtx.fillStyle = `rgb(${br}, ${bg}, ${bb})`;
            traceRusticBrickPath(cCtx, bx, effY, effW, effH, seed, 0);
            cCtx.fill();

            const flashRoll = hash01(seed * 47 + 17);
            if (flashRoll < 0.45) {
              const fx = bx + effW * (0.2 + 0.6 * hash01(seed * 53 + 1));
              const fy = effY + effH * (0.25 + 0.5 * hash01(seed * 59 + 2));
              const fr = Math.max(10, effW * (0.28 + 0.25 * hash01(seed * 61 + 3)));
              const grad = cCtx.createRadialGradient(fx, fy, 1, fx, fy, fr);
              if (flashRoll < 0.26) {
                grad.addColorStop(0, 'rgba(38, 22, 18, 0.34)');
                grad.addColorStop(1, 'rgba(38, 22, 18, 0)');
              } else {
                grad.addColorStop(0, 'rgba(224, 132, 82, 0.28)');
                grad.addColorStop(1, 'rgba(224, 132, 82, 0)');
              }
              cCtx.fillStyle = grad;
              traceRusticBrickPath(cCtx, bx, effY, effW, effH, seed, 0.5);
              cCtx.fill();
            }

            cCtx.fillStyle = 'rgba(255, 235, 210, 0.13)';
            cCtx.fillRect(bx + 2.5, effY + 1, effW - 5, 2);
            cCtx.fillStyle = 'rgba(32, 16, 10, 0.20)';
            cCtx.fillRect(bx + 2.5, effY + effH - 2.6, effW - 5, 2.2);

            for (let py = 3; py < effH - 3; py += 5) {
              for (let px = 4; px < effW - 4; px += 7) {
                const cellHash = hash01(px * 23 + py * 41 + seed * 13);
                const m = Math.round((cellHash - 0.5) * 28);
                const patchW = 5 + Math.round(hash01(px * 17 + seed) * 4);
                const patchH = 3 + Math.round(hash01(py * 19 + seed) * 3);
                cCtx.fillStyle = `rgb(${Math.max(30, Math.min(245, br + m))}, ${Math.max(24, Math.min(220, bg + Math.round(m * 0.72)))}, ${Math.max(20, Math.min(205, bb + Math.round(m * 0.52)))})`;
                cCtx.fillRect(bx + px, effY + py, patchW, patchH);
              }
            }

            if (hash01(seed * 67 + 23) < 0.28) {
              const sx = bx + 3 + hash01(seed * 71) * Math.max(4, effW - 16);
              const sy = effY + (hash01(seed * 73) < 0.5 ? 1 : effH - 5);
              cCtx.fillStyle = 'rgba(212, 198, 174, 0.26)';
              cCtx.fillRect(sx, sy, 6 + hash01(seed * 79) * 8, 3.2);
            }

            const bumpBias = Math.round((hash01(seed * 17 + 5) - 0.5) * 38);
            const edgeLum = Math.max(80, Math.min(185, 130 + bumpBias));
            const faceLum = Math.max(172, Math.min(252, 222 + bumpBias));

            bCtx.fillStyle = `rgb(${edgeLum}, ${edgeLum}, ${edgeLum})`;
            traceRusticBrickPath(bCtx, bx, effY, effW, effH, seed, 0);
            bCtx.fill();

            bCtx.fillStyle = `rgb(${faceLum}, ${faceLum}, ${faceLum})`;
            traceRusticBrickPath(bCtx, bx, effY, effH < 4 ? effW : effW, effH, seed, 2.2);
            bCtx.fill();

            const creaseLum = Math.max(130, faceLum - 32);
            const creaseY = effY + effH * (0.38 + 0.24 * hash01(seed * 83));
            bCtx.fillStyle = `rgb(${creaseLum}, ${creaseLum}, ${creaseLum})`;
            bCtx.fillRect(bx + 5, creaseY, effW - 10, 2.2);

            for (let p = 0; p < 5; p++) {
              const pitX = bx + 4 + hash01(seed * 89 + p * 7) * Math.max(4, effW - 12);
              const pitY = effY + 4 + hash01(seed * 97 + p * 11) * Math.max(4, effH - 10);
              const pitLum = Math.max(120, faceLum - Math.round(18 + hash01(seed + p) * 26));
              bCtx.fillStyle = `rgb(${pitLum}, ${pitLum}, ${pitLum})`;
              bCtx.fillRect(pitX, pitY, 4, 3);
            }
          }
        };

        for (let row = 0; row < numCourses; row++) {
          const courseWaveY = Math.sin((row / numCourses) * Math.PI * 4) * 0.45;
          const y0 = row * courseH + mortarH * 0.5 + courseWaveY;
          const rowShift = (row % 2) * (unitW * 0.5);

          for (let u = 0; u < 4; u++) {
            const baseX = u * unitW + rowShift;
            const seed1 = row * 37 + u * 13 + 7;
            const stretcherRgb =
              stretcherPalette[Math.abs(seed1 * 7 + row * 3) % stretcherPalette.length] ?? [
                162, 72, 53,
              ];
            drawBrick(baseX, y0, stretcherW, brickH, stretcherRgb, seed1);

            const headerX = baseX + stretcherW + mortarW;
            const seed2 = row * 53 + u * 29 + 19;
            const headerRgb =
              headerPalette[Math.abs(seed2 * 5 + row * 11) % headerPalette.length] ?? [136, 62, 48];
            drawBrick(headerX, y0, headerW, brickH, headerRgb, seed2);
          }
        }
      }
    );

    const colorMap = createBrowserDataOrCanvasTexture('roof-brick:3', colorCanvas, {
      colorSpace: THREE.NoColorSpace,
    });
    colorMap.wrapS = THREE.RepeatWrapping;
    colorMap.wrapT = THREE.RepeatWrapping;
    colorMap.colorSpace = THREE.SRGBColorSpace;
    colorMap.anisotropy = 8;

    const bumpMap = createBrowserDataOrCanvasTexture('roof-brick:4', bumpCanvas, {
      colorSpace: THREE.NoColorSpace,
    });
    bumpMap.wrapS = THREE.RepeatWrapping;
    bumpMap.wrapT = THREE.RepeatWrapping;
    bumpMap.anisotropy = 8;

    const { normalMap, roughnessMap } = derivePbrNormalAndRoughnessMaps(
      'imperial-brick',
      bumpCanvas,
      {
        normalStrength: 3.4,
        mortarThreshold: 0.25,
        mortarRoughness: 1.0,
        surfaceRoughnessMin: 0.72,
        surfaceRoughnessMax: 0.92,
        microGrainRoughness: 0.05,
      }
    );

    return { colorMap, bumpMap, normalMap, roughnessMap };
  });

  return {
    colorMap: cached.colorMap,
    bumpMap: cached.bumpMap,
    depthMap: cached.bumpMap,
    normalMap: cached.normalMap,
    roughnessMap: cached.roughnessMap,
    tileSizeM: [UK_BRICK_TILE_W_M, UK_BRICK_TILE_H_M],
  };
}

export function scaleBundleForWorldMetersPerUv(
  base: ProceduralPbrMapBundle,
  worldMetersPerUv: number | null | undefined
): ProceduralPbrMapBundle {
  if (worldMetersPerUv === undefined || worldMetersPerUv === null || worldMetersPerUv <= 0) {
    return base;
  }
  const repU = worldMetersPerUv / Math.max(0.01, base.tileSizeM[0]);
  const repV = worldMetersPerUv / Math.max(0.01, base.tileSizeM[1]);
  if (Math.abs(repU - 1) < 1e-6 && Math.abs(repV - 1) < 1e-6) {
    return base;
  }
  const variantOpts = { repeat: [repU, repV] as const };
  const bumpVariant = createSharedSourceTextureVariant(base.bumpMap, variantOpts);
  const depthVariant =
    base.depthMap === base.bumpMap
      ? bumpVariant
      : createSharedSourceTextureVariant(base.depthMap, variantOpts);
  return {
    colorMap: createSharedSourceTextureVariant(base.colorMap, variantOpts) as THREE.CanvasTexture,
    bumpMap: bumpVariant as THREE.CanvasTexture,
    depthMap: depthVariant as THREE.CanvasTexture,
    normalMap: createSharedSourceTextureVariant(base.normalMap, variantOpts) as THREE.CanvasTexture,
    roughnessMap: createSharedSourceTextureVariant(base.roughnessMap, variantOpts),
    tileSizeM: base.tileSizeM,
  };
}

function computeBrickTileSizeM(
  bond: BrickBond,
  brickLengthM: number,
  brickWidthM: number,
  brickHeightM: number,
  mortarJointM: number
): readonly [number, number] {
  const stretcherPitch = brickLengthM + mortarJointM;
  const headerPitch = brickWidthM + mortarJointM;
  const coursePitch = brickHeightM + mortarJointM;

  switch (bond) {
    case 'flemish':
      return [4 * (stretcherPitch + headerPitch), 16 * coursePitch];
    case 'english':
    case 'stretcher':
      return [6 * stretcherPitch, 16 * coursePitch];
    case 'header':
      return [12 * headerPitch, 16 * coursePitch];
    case 'soldier':
      return [16 * coursePitch, 4 * stretcherPitch];
    case 'herringbone-45': {
      const diagPitch = 12 * Math.SQRT2 * headerPitch;
      return [diagPitch, diagPitch];
    }
    case 'herringbone-90':
      return [16 * headerPitch, 16 * headerPitch];
  }
}

function buildBrickCacheKey(
  preset: BrickPreset,
  bond: BrickBond,
  size: number,
  mortarRgb: RgbTuple,
  stretcherPalette: readonly RgbTuple[],
  headerPalette: readonly RgbTuple[],
  kilnFlash: number,
  sootLevel: number,
  limewash: number,
  mossAndLichen: number,
  seed: number,
  tileSizeM: readonly [number, number],
  mortarJointM: number
): string {
  const palSig = stretcherPalette.map((c) => c.join(',')).join(';');
  const hPalSig = headerPalette.map((c) => c.join(',')).join(';');
  return [
    'husjs:brick',
    preset,
    bond,
    size,
    mortarRgb.join(','),
    palSig,
    hPalSig,
    kilnFlash.toFixed(3),
    sootLevel.toFixed(3),
    limewash.toFixed(3),
    mossAndLichen.toFixed(3),
    seed,
    tileSizeM[0].toFixed(4),
    tileSizeM[1].toFixed(4),
    mortarJointM.toFixed(4),
  ].join('|');
}

/**
 * Generates a tileable procedural brick PBR map bundle (`colorMap`, `bumpMap`, `depthMap`,
 * `normalMap`, `roughnessMap`, `tileSizeM`) across 6 built-in architectural presets and 7 bonds.
 */
export function createBrickTextures(
  presetOrOptions?: BrickPreset | BrickMaterialOptions
): ProceduralPbrMapBundle {
  const opts = normalizeBrickOptions(presetOrOptions);
  if (isDefaultImperialBrickRequest(opts)) {
    return scaleBundleForWorldMetersPerUv(getBaseImperialBrickBundle(), opts.worldMetersPerUv);
  }

  const preset: BrickPreset = opts.preset ?? 'heritage-red-flemish';
  const cfg = BRICK_PRESET_CONFIGS[preset];
  const bond: BrickBond = opts.bond ?? cfg.defaultBond;
  const size = Math.max(64, Math.round(opts.resolution ?? 512));

  const brickLengthM = opts.brickLengthM ?? 0.215;
  const brickWidthM = opts.brickWidthM ?? 0.1025;
  const brickHeightM = opts.brickHeightM ?? 0.065;
  const mortarJointM = opts.mortarJointM ?? 0.01;

  const hasCustomDims =
    opts.brickLengthM !== undefined ||
    opts.brickWidthM !== undefined ||
    opts.brickHeightM !== undefined ||
    opts.mortarJointM !== undefined ||
    opts.bond !== undefined;

  const tileSizeM: readonly [number, number] =
    opts.tileSizeM ??
    (hasCustomDims
      ? computeBrickTileSizeM(bond, brickLengthM, brickWidthM, brickHeightM, mortarJointM)
      : cfg.defaultTileSizeM);

  const mortarRgb = opts.mortarColor !== undefined ? toRgbTuple(opts.mortarColor) : cfg.mortarRgb;
  const stretcherPalette =
    opts.palette && opts.palette.length > 0 ? opts.palette.map(toRgbTuple) : cfg.stretcherPalette;
  const headerPalette =
    opts.headerPalette && opts.headerPalette.length > 0
      ? opts.headerPalette.map(toRgbTuple)
      : opts.palette && opts.palette.length > 0
        ? opts.palette.map(toRgbTuple)
        : cfg.headerPalette;

  const kilnFlash = Math.max(0, Math.min(1, opts.kilnFlash ?? opts.weathering?.kilnFlash ?? cfg.kilnFlash));
  const sootLevel = Math.max(0, Math.min(1, opts.sootLevel ?? opts.weathering?.sootLevel ?? cfg.sootLevel));
  const limewash = Math.max(0, Math.min(1, opts.limewash ?? opts.weathering?.limewash ?? cfg.limewash));
  const mossAndLichen = Math.max(
    0,
    Math.min(1, opts.mossAndLichen ?? opts.weathering?.mossAndLichen ?? cfg.mossAndLichen)
  );
  const seedBase = Math.round(opts.seed ?? 0) * 997;

  const cacheKey = buildBrickCacheKey(
    preset,
    bond,
    size,
    mortarRgb,
    stretcherPalette,
    headerPalette,
    kilnFlash,
    sootLevel,
    limewash,
    mossAndLichen,
    seedBase,
    tileSizeM,
    mortarJointM
  );

  const baseBundle = getOrCreateCachedTexture(cacheKey, (): ProceduralPbrMapBundle => {
    const [colorCanvas, bumpCanvas] = getOrCreateCachedCanvasPair(
      cacheKey,
      size,
      size,
      (cCtx, bCtx) => {
        cCtx.fillStyle = `rgb(${mortarRgb[0]}, ${mortarRgb[1]}, ${mortarRgb[2]})`;
        cCtx.fillRect(0, 0, size, size);
        bCtx.fillStyle = '#181818';
        bCtx.fillRect(0, 0, size, size);

        // Periodic sand/lime mortar grit & optional damp-crevice moss across [0..size)
        const gritStep = Math.max(2, Math.round(size / 128));
        for (let y = 0; y < size; y += gritStep) {
          const ny = (y / size) * Math.PI * 2;
          for (let x = 0; x < size; x += gritStep) {
            const nx = (x / size) * Math.PI * 2;
            const h1 = hash01((x % size) * 17 + (y % size) * 31 + seedBase);
            const h2 = hash01((x % size) * 43 + (y % size) * 13 + 7 + seedBase);
            const d = Math.round((h1 - 0.5) * 22);
            const warm = Math.round((h2 - 0.5) * 9);
            let mr = mortarRgb[0] + d + warm;
            let mg = mortarRgb[1] + d;
            let mb = mortarRgb[2] + d - warm;

            if (mossAndLichen > 0.01) {
              const mossWave =
                0.5 + 0.5 * Math.sin(nx * 2 + 0.7) * Math.cos(ny * 2 - 0.4) + (h2 - 0.5) * 0.35;
              if (mossWave > 1 - mossAndLichen * 0.85) {
                const mAmt = Math.min(0.65, mossAndLichen * 0.7);
                mr = mr * (1 - mAmt) + 84 * mAmt;
                mg = mg * (1 - mAmt) + 106 * mAmt;
                mb = mb * (1 - mAmt) + 64 * mAmt;
              }
            }
            if (sootLevel > 0.01) {
              const sAmt = sootLevel * 0.25;
              mr *= 1 - sAmt;
              mg *= 1 - sAmt;
              mb *= 1 - sAmt;
            }

            cCtx.fillStyle = `rgb(${clampByte(mr)}, ${clampByte(mg)}, ${clampByte(mb)})`;
            cCtx.fillRect(x, y, gritStep, gritStep);

            const bumpVal = clampByte(18 + h1 * 22);
            bCtx.fillStyle = `rgb(${bumpVal}, ${bumpVal}, ${bumpVal})`;
            bCtx.fillRect(x, y, gritStep, gritStep);
          }
        }

        const traceBrickLocal = (
          ctx: CanvasRenderingContext2D,
          w: number,
          h: number,
          seed: number,
          inset = 0
        ): void => {
          const hw = Math.max(1.5, w * 0.5 - inset);
          const hh = Math.max(1.5, h * 0.5 - inset);
          if (cfg.crispArris) {
            const r = Math.max(0.6, Math.min(1.6, Math.min(hw, hh) * 0.14));
            ctx.beginPath();
            ctx.roundRect(-hw, -hh, hw * 2, hh * 2, r);
            return;
          }
          const waveAmp = Math.min(1.8, Math.min(hw, hh) * 0.12);
          const c = Math.max(1.0, Math.min(2.6, Math.min(hw, hh) * 0.22) - inset * 0.4);
          const tW1 = (hash01(seed * 11 + 1) - 0.5) * 2 * waveAmp;
          const tW2 = (hash01(seed * 11 + 2) - 0.5) * 2 * waveAmp;
          const bW1 = (hash01(seed * 11 + 3) - 0.5) * 2 * waveAmp;
          const bW2 = (hash01(seed * 11 + 4) - 0.5) * 2 * waveAmp;

          ctx.beginPath();
          ctx.moveTo(-hw + c, -hh);
          ctx.lineTo(-hw * 0.3, -hh + tW1);
          ctx.lineTo(hw * 0.36, -hh + tW2);
          ctx.lineTo(hw - c, -hh);
          ctx.quadraticCurveTo(hw, -hh, hw, -hh + c);
          ctx.lineTo(hw, hh - c);
          ctx.quadraticCurveTo(hw, hh, hw - c, hh);
          ctx.lineTo(hw * 0.3, hh + bW2);
          ctx.lineTo(-hw * 0.36, hh + bW1);
          ctx.lineTo(-hw + c, hh);
          ctx.quadraticCurveTo(-hw, hh, -hw, hh - c);
          ctx.lineTo(-hw, -hh + c);
          ctx.quadraticCurveTo(-hw, -hh, -hw + c, -hh);
          ctx.closePath();
        };

        const stampWrappedBrick = (
          cx: number,
          cy: number,
          w: number,
          h: number,
          angleRad: number,
          rgb: RgbTuple,
          seed: number
        ): void => {
          const jitterAmp = cfg.crispArris ? 0.35 : 1.3;
          const jx = (hash01(seed * 23 + 5) - 0.5) * jitterAmp;
          const jy = (hash01(seed * 29 + 7) - 0.5) * jitterAmp;
          const effW = Math.max(4, w + (hash01(seed * 37 + 11) - 0.5) * jitterAmp);
          const effH = Math.max(4, h + (hash01(seed * 41 + 13) - 0.5) * jitterAmp);

          const toneSpan = cfg.crispArris ? 12 : 24;
          const delta = Math.round((hash01(seed * 19 + 3) - 0.5) * toneSpan);
          const warm = Math.round((hash01(seed * 31 + 9) - 0.5) * 10);
          let br = rgb[0] + delta + warm;
          let bg = rgb[1] + Math.round(delta * 0.72);
          let bb = rgb[2] + Math.round(delta * 0.52) - Math.round(warm * 0.35);

          if (sootLevel > 0.005) {
            const sootPatch = sootLevel * (0.28 + 0.45 * hash01(seed * 61 + 7));
            br = br * (1 - sootPatch) + 28 * sootPatch;
            bg = bg * (1 - sootPatch) + 26 * sootPatch;
            bb = bb * (1 - sootPatch) + 25 * sootPatch;
          }

          br = clampByte(br);
          bg = clampByte(bg);
          bb = clampByte(bb);

          const bumpBias = Math.round((hash01(seed * 17 + 5) - 0.5) * (cfg.crispArris ? 18 : 34));
          const edgeLum = clampByte((cfg.crispArris ? 156 : 132) + bumpBias);
          const faceLum = clampByte((cfg.crispArris ? 228 : 220) + bumpBias);
          const maxSpan = Math.hypot(effW, effH) * 0.6;

          const wrapOffsets = [-size, 0, size];
          for (const ox of wrapOffsets) {
            const px = cx + jx + ox;
            if (px + maxSpan < -2 || px - maxSpan > size + 2) continue;
            for (const oy of wrapOffsets) {
              const py = cy + jy + oy;
              if (py + maxSpan < -2 || py - maxSpan > size + 2) continue;

              cCtx.save();
              cCtx.translate(px, py);
              if (angleRad !== 0) cCtx.rotate(angleRad);

              cCtx.fillStyle = `rgb(${br}, ${bg}, ${bb})`;
              traceBrickLocal(cCtx, effW, effH, seed, 0);
              cCtx.fill();

              // Kiln-flashing / vitrified clinker spot
              if (kilnFlash > 0.01 && hash01(seed * 47 + 17) < kilnFlash) {
                const fx = (hash01(seed * 53 + 1) - 0.5) * effW * 0.55;
                const fy = (hash01(seed * 59 + 2) - 0.5) * effH * 0.45;
                const fr = Math.max(6, Math.max(effW, effH) * 0.34);
                const grad = cCtx.createRadialGradient(fx, fy, 1, fx, fy, fr);
                if (preset === 'yellow-london-stock' || hash01(seed * 43 + 9) < 0.58) {
                  grad.addColorStop(0, 'rgba(34, 24, 20, 0.36)');
                  grad.addColorStop(1, 'rgba(34, 24, 20, 0)');
                } else {
                  grad.addColorStop(0, 'rgba(218, 128, 80, 0.26)');
                  grad.addColorStop(1, 'rgba(218, 128, 80, 0)');
                }
                cCtx.fillStyle = grad;
                traceBrickLocal(cCtx, effW, effH, seed, 0.5);
                cCtx.fill();
              }

              // Sand-faced clay mottling
              const stepY = Math.max(4, Math.round(effH / 4));
              const stepX = Math.max(5, Math.round(effW / 6));
              for (let my = -effH * 0.36; my < effH * 0.36; my += stepY) {
                for (let mx = -effW * 0.4; mx < effW * 0.4; mx += stepX) {
                  const m = Math.round(
                    (hash01(Math.round(mx * 19 + my * 37) + seed * 13) - 0.5) * (cfg.crispArris ? 12 : 24)
                  );
                  cCtx.fillStyle = `rgb(${clampByte(br + m)}, ${clampByte(bg + m * 0.75)}, ${clampByte(bb + m * 0.55)})`;
                  cCtx.fillRect(mx, my, Math.min(stepX, 6), Math.min(stepY, 4));
                }
              }

              // Breathable chalky limewash overlay worn back along brick arrises
              if (limewash > 0.01) {
                const brickWash = limewash * (0.62 + 0.38 * hash01(seed * 71 + 3));
                cCtx.fillStyle = `rgba(236, 230, 218, ${Math.min(0.92, brickWash * 0.88).toFixed(3)})`;
                traceBrickLocal(cCtx, effW, effH, seed, 1.4);
                cCtx.fill();
                if (brickWash > 0.35) {
                  cCtx.fillStyle = `rgba(244, 240, 231, ${Math.min(0.85, brickWash * 0.55).toFixed(3)})`;
                  traceBrickLocal(cCtx, effW * 0.82, effH * 0.74, seed + 5, 1.0);
                  cCtx.fill();
                }
              }

              // Moss / crustose lichen kiss along lower damp edge
              if (mossAndLichen > 0.02 && hash01(seed * 83 + 19) < mossAndLichen * 0.9) {
                const lx = (hash01(seed * 89) - 0.5) * effW * 0.55;
                const ly = effH * 0.32;
                cCtx.fillStyle = `rgba(104, 124, 78, ${Math.min(0.55, 0.22 + mossAndLichen * 0.35).toFixed(3)})`;
                cCtx.beginPath();
                cCtx.ellipse(lx, ly, Math.max(3, effW * 0.16), Math.max(2, effH * 0.14), 0, 0, Math.PI * 2);
                cCtx.fill();
              }

              // Sunlit top arris & bottom bed shadow
              cCtx.fillStyle = cfg.crispArris
                ? 'rgba(235, 240, 250, 0.14)'
                : 'rgba(255, 238, 216, 0.13)';
              cCtx.fillRect(-effW * 0.45, -effH * 0.48, effW * 0.9, 1.6);
              cCtx.fillStyle = 'rgba(24, 16, 12, 0.18)';
              cCtx.fillRect(-effW * 0.45, effH * 0.48 - 1.8, effW * 0.9, 1.8);
              cCtx.restore();

              // Bump relief
              bCtx.save();
              bCtx.translate(px, py);
              if (angleRad !== 0) bCtx.rotate(angleRad);
              bCtx.fillStyle = `rgb(${edgeLum}, ${edgeLum}, ${edgeLum})`;
              traceBrickLocal(bCtx, effW, effH, seed, 0);
              bCtx.fill();

              bCtx.fillStyle = `rgb(${faceLum}, ${faceLum}, ${faceLum})`;
              traceBrickLocal(bCtx, effW, effH, seed, cfg.crispArris ? 1.2 : 2.0);
              bCtx.fill();
              bCtx.restore();
            }
          }
        };

        const jointRatio = Math.max(0.04, Math.min(0.28, mortarJointM / Math.max(0.03, brickHeightM + mortarJointM)));

        if (bond === 'herringbone-90') {
          const nGrid = 16;
          const step = size / nGrid;
          const jointPx = Math.max(2.2, step * jointRatio * 1.15);
          const brickW = step - jointPx;
          const brickL = step * 2 - jointPx;

          for (let gy = -2; gy < nGrid + 2; gy++) {
            for (let gx = -2; gx < nGrid + 2; gx++) {
              const gxMod = ((gx % nGrid) + nGrid) % nGrid;
              const gyMod = ((gy % nGrid) + nGrid) % nGrid;
              const isHoriz = ((gxMod + gyMod) & 1) === 0;
              const cellSeed = seedBase + gyMod * 139 + gxMod * 73 + 17;
              const rgb = stretcherPalette[Math.abs(cellSeed) % stretcherPalette.length]!;
              if (isHoriz) {
                stampWrappedBrick(
                  (gx + 1.0) * step,
                  (gy + 0.5) * step,
                  brickL,
                  brickW,
                  0,
                  rgb,
                  cellSeed
                );
              } else {
                stampWrappedBrick(
                  (gx + 0.5) * step,
                  (gy + 1.0) * step,
                  brickW,
                  brickL,
                  0,
                  rgb,
                  cellSeed
                );
              }
            }
          }
        } else if (bond === 'herringbone-45') {
          // Periodic 45-degree rotated lattice: u = (x+y)*N/size, v = (x-y)*N/size with even N = 12
          const nDiag = 12;
          const stepDiag = size / nDiag / Math.SQRT2;
          const jointPx = Math.max(2.0, stepDiag * jointRatio * 1.15);
          const brickW = stepDiag - jointPx;
          const brickL = stepDiag * 2 - jointPx;
          const toScreenX = (u: number, v: number): number => ((u + v) * 0.5 * size) / nDiag;
          const toScreenY = (u: number, v: number): number => ((u - v) * 0.5 * size) / nDiag;

          for (let gu = -nDiag; gu <= nDiag * 2; gu++) {
            for (let gv = -nDiag * 2; gv <= nDiag * 2; gv++) {
              const guMod = ((gu % nDiag) + nDiag) % nDiag;
              const gvMod = ((gv % nDiag) + nDiag) % nDiag;
              const alongU = ((guMod + gvMod) & 1) === 0;
              const cu = alongU ? gu + 1.0 : gu + 0.5;
              const cv = alongU ? gv + 0.5 : gv + 1.0;
              const sx = toScreenX(cu, cv);
              const sy = toScreenY(cu, cv);
              if (sx < -brickL || sx > size + brickL || sy < -brickL || sy > size + brickL) {
                continue;
              }
              const cellSeed = seedBase + guMod * 151 + gvMod * 83 + 29;
              const rgb = stretcherPalette[Math.abs(cellSeed) % stretcherPalette.length]!;
              stampWrappedBrick(
                sx,
                sy,
                brickL,
                brickW,
                alongU ? Math.PI * 0.25 : -Math.PI * 0.25,
                rgb,
                cellSeed
              );
            }
          }
        } else if (bond === 'soldier') {
          const numCourses = 4;
          const bricksPerCourse = 16;
          const courseH = size / numCourses;
          const colW = size / bricksPerCourse;
          const mortarPx = Math.max(2.2, colW * jointRatio);
          const bw = colW - mortarPx;
          const bh = courseH - mortarPx * 1.15;

          for (let row = 0; row < numCourses; row++) {
            const cy = (row + 0.5) * courseH;
            for (let col = 0; col < bricksPerCourse; col++) {
              const cx = (col + 0.5) * colW;
              const cellSeed = seedBase + row * 97 + col * 31 + 11;
              const useHeaderTint = hash01(cellSeed * 7) < 0.22;
              const rgb = useHeaderTint
                ? headerPalette[Math.abs(cellSeed) % headerPalette.length]!
                : stretcherPalette[Math.abs(cellSeed) % stretcherPalette.length]!;
              stampWrappedBrick(cx, cy, bw, bh, 0, rgb, cellSeed);
            }
          }
        } else {
          const numCourses = 16;
          const courseH = size / numCourses;
          const mortarH = Math.max(2.2, courseH * jointRatio);
          const bh = courseH - mortarH;

          for (let row = 0; row < numCourses; row++) {
            const waveY = cfg.crispArris ? 0 : Math.sin((row / numCourses) * Math.PI * 4) * 0.4;
            const cy = (row + 0.5) * courseH + waveY;

            if (bond === 'flemish') {
              const units = 4;
              const unitW = size / units;
              const mortarW = mortarH * 0.95;
              const totalBrickW = unitW - mortarW * 2;
              const sRatio = brickLengthM / Math.max(0.05, brickLengthM + brickWidthM);
              const sw = totalBrickW * sRatio;
              const hw = totalBrickW - sw;
              const shift = (row % 2) * (unitW * 0.5);

              for (let u = 0; u < units; u++) {
                const xStart = u * unitW + shift;
                const s1 = seedBase + row * 37 + u * 13 + 7;
                const sRgb = stretcherPalette[Math.abs(s1 * 7 + row * 3) % stretcherPalette.length]!;
                stampWrappedBrick(xStart + sw * 0.5, cy, sw, bh, 0, sRgb, s1);

                const s2 = seedBase + row * 53 + u * 29 + 19;
                const hRgb = headerPalette[Math.abs(s2 * 5 + row * 11) % headerPalette.length]!;
                stampWrappedBrick(xStart + sw + mortarW + hw * 0.5, cy, hw, bh, 0, hRgb, s2);
              }
            } else if (bond === 'english') {
              const isHeaderCourse = row % 2 === 1;
              if (!isHeaderCourse) {
                const cols = 6;
                const colW = size / cols;
                const sw = colW - mortarH * 0.95;
                for (let c = 0; c < cols; c++) {
                  const s1 = seedBase + row * 41 + c * 17 + 5;
                  const sRgb = stretcherPalette[Math.abs(s1 * 7 + row) % stretcherPalette.length]!;
                  stampWrappedBrick((c + 0.5) * colW, cy, sw, bh, 0, sRgb, s1);
                }
              } else {
                const cols = 12;
                const colW = size / cols;
                const hw = colW - mortarH * 0.9;
                const shift = colW * 0.5;
                for (let c = 0; c < cols; c++) {
                  const s2 = seedBase + row * 59 + c * 23 + 13;
                  const hRgb = headerPalette[Math.abs(s2 * 5 + row) % headerPalette.length]!;
                  stampWrappedBrick(c * colW + shift, cy, hw, bh, 0, hRgb, s2);
                }
              }
            } else if (bond === 'stretcher') {
              const cols = 6;
              const colW = size / cols;
              const sw = colW - mortarH * 0.95;
              const shift = (row % 2) * (colW * 0.5);
              for (let c = 0; c < cols; c++) {
                const s1 = seedBase + row * 43 + c * 19 + 9;
                const sRgb = stretcherPalette[Math.abs(s1 * 7 + row * 3) % stretcherPalette.length]!;
                stampWrappedBrick((c + 0.5) * colW + shift, cy, sw, bh, 0, sRgb, s1);
              }
            } else {
              // 'header' bond
              const cols = 12;
              const colW = size / cols;
              const hw = colW - mortarH * 0.9;
              const shift = (row % 2) * (colW * 0.5);
              for (let c = 0; c < cols; c++) {
                const s2 = seedBase + row * 61 + c * 29 + 15;
                const hRgb = headerPalette[Math.abs(s2 * 5 + row * 7) % headerPalette.length]!;
                stampWrappedBrick((c + 0.5) * colW + shift, cy, hw, bh, 0, hRgb, s2);
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
    colorMap.wrapS = THREE.RepeatWrapping;
    colorMap.wrapT = THREE.RepeatWrapping;
    colorMap.colorSpace = THREE.SRGBColorSpace;
    colorMap.anisotropy = 8;

    const bumpMap = createBrowserDataOrCanvasTexture(`${cacheKey}:bump`, bumpCanvas, {
      colorSpace: THREE.NoColorSpace,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      anisotropy: 8,
    });
    bumpMap.wrapS = THREE.RepeatWrapping;
    bumpMap.wrapT = THREE.RepeatWrapping;
    bumpMap.colorSpace = THREE.NoColorSpace;
    bumpMap.anisotropy = 8;

    const { normalMap, roughnessMap } = derivePbrNormalAndRoughnessMaps(cacheKey, bumpCanvas, {
      normalStrength: cfg.normalStrength,
      mortarThreshold: 0.25,
      mortarRoughness: 1.0,
      surfaceRoughnessMin: cfg.surfaceRoughnessMin,
      surfaceRoughnessMax: cfg.surfaceRoughnessMax,
      microGrainRoughness: cfg.crispArris ? 0.03 : 0.05,
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

  return scaleBundleForWorldMetersPerUv(baseBundle, opts.worldMetersPerUv);
}

/**
 * Creates a ready-to-use `THREE.MeshStandardMaterial` configured with procedural brick PBR maps.
 * Defaults `worldMetersPerUv` to `1.0` so `1 UV = 1 m` extruded walls tile automatically at
 * `1 / tileSizeM` via non-mutating shared-source texture variants.
 */
export function createBrickMaterial(
  presetOrOptions?: BrickPreset | BrickMaterialOptions
): THREE.MeshStandardMaterial {
  const opts = normalizeBrickOptions(presetOrOptions);
  const preset: BrickPreset = opts.preset ?? 'heritage-red-flemish';
  const cfg = BRICK_PRESET_CONFIGS[preset];
  const worldMetersPerUv = opts.worldMetersPerUv === undefined ? 1.0 : opts.worldMetersPerUv;
  const maps = createBrickTextures({ ...opts, worldMetersPerUv });

  const nScale = opts.normalScale ?? 0.85;
  const normalScaleVec =
    typeof nScale === "number"
      ? new THREE.Vector2(nScale, nScale)
      : new THREE.Vector2(nScale[0], nScale[1]);

  return new THREE.MeshStandardMaterial({
    color: opts.tint ?? 0xffffff,
    map: maps.colorMap,
    bumpMap: maps.bumpMap,
    bumpScale: opts.bumpScale ?? cfg.bumpScale,
    normalMap: maps.normalMap,
    normalScale: normalScaleVec,
    roughnessMap: maps.roughnessMap,
    roughness: opts.roughness ?? cfg.roughness,
    metalness: opts.metalness ?? (preset === 'dark-engineered' ? 0.06 : 0.02),
  });
}
