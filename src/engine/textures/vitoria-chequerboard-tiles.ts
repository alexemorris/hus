import * as THREE from 'three';
import { derivePbrNormalAndRoughnessMaps } from './pbr-surface-maps.ts';
import {
  createBrowserDataOrCanvasTexture,
  getOrCreateCachedCanvasPair,
  getOrCreateCachedTexture,
} from './texture-registry.ts';

/** Nominal tile size of the Fayrouz Vitoria chequerboard range (30cm x 30cm porcelain). */
export const VITORIA_TILE_SIZE_M = 0.3;

/** Diagonal tiles per texture repeat along each axis (period = n * tile * sqrt(2)). */
const DIAGONALS_PER_REPEAT = 4;

/**
 * World-space length of one texture repeat. The chequerboard is laid on the diagonal
 * (45° to the walls), so the pattern repeats every `tile * sqrt(2)` along X and Z.
 */
export const VITORIA_CHEQUER_REPEAT_M = DIAGONALS_PER_REPEAT * VITORIA_TILE_SIZE_M * Math.SQRT2;

export interface VitoriaChequerboardTextures {
  readonly colorMap: THREE.CanvasTexture;
  readonly bumpMap: THREE.CanvasTexture;
  readonly normalMap: THREE.CanvasTexture;
  readonly roughnessMap: THREE.Texture;
}

type Rng = () => number;

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rgba(r: number, g: number, b: number, a: number): string {
  const c = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
  return `rgba(${c(r)}, ${c(g)}, ${c(b)}, ${a.toFixed(3)})`;
}

/** Random-walk crack/vein polyline across a tile (local coordinates, tile centred on 0,0). */
function drawVein(
  ctx: CanvasRenderingContext2D,
  rng: Rng,
  half: number,
  style: string,
  width: number,
  branches: number
): void {
  const edgePoint = (): [number, number] => {
    const side = Math.floor(rng() * 4);
    const t = (rng() * 2 - 1) * half;
    if (side === 0) return [-half, t];
    if (side === 1) return [half, t];
    if (side === 2) return [t, -half];
    return [t, half];
  };
  const [x0, y0] = edgePoint();
  let [x1, y1] = edgePoint();
  if (Math.hypot(x1 - x0, y1 - y0) < half) {
    x1 = -x0;
    y1 = -y0;
  }
  const steps = 14;
  const points: [number, number][] = [];
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const wobble = s === 0 || s === steps ? 0 : (rng() - 0.5) * half * 0.22;
    const nx = -(y1 - y0);
    const ny = x1 - x0;
    const nLen = Math.hypot(nx, ny) || 1;
    points.push([
      x0 + (x1 - x0) * t + (nx / nLen) * wobble,
      y0 + (y1 - y0) * t + (ny / nLen) * wobble,
    ]);
  }
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (const [px, py] of points.slice(1)) {
    ctx.lineTo(px, py);
  }
  ctx.stroke();

  // Fine hairline offshoots, typical of Rosso / Calacatta marble veining.
  for (let b = 0; b < branches; b++) {
    const [sx, sy] = points[1 + Math.floor(rng() * (points.length - 2))];
    const angle = rng() * Math.PI * 2;
    const len = half * (0.2 + rng() * 0.45);
    ctx.lineWidth = width * 0.45;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    let cx = sx;
    let cy = sy;
    for (let s = 1; s <= 5; s++) {
      const a = angle + (rng() - 0.5) * 0.9;
      cx += Math.cos(a) * (len / 5);
      cy += Math.sin(a) * (len / 5);
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }
}

function paintRossoTile(ctx: CanvasRenderingContext2D, rng: Rng, half: number): void {
  const tone = (rng() - 0.5) * 16;
  ctx.fillStyle = rgba(160 + tone, 114 + tone * 0.7, 102 + tone * 0.6, 1);
  ctx.fillRect(-half, -half, half * 2, half * 2);
  // Mottled clouds of deeper rust and paler salmon.
  for (let i = 0; i < 70; i++) {
    const dark = rng() < 0.55;
    const r = half * (0.08 + rng() * 0.3);
    ctx.fillStyle = dark
      ? rgba(136 + rng() * 20, 92 + rng() * 14, 82 + rng() * 10, 0.12 + rng() * 0.12)
      : rgba(196 + rng() * 20, 160 + rng() * 18, 148 + rng() * 16, 0.1 + rng() * 0.14);
    ctx.beginPath();
    ctx.ellipse(
      (rng() * 2 - 1) * half,
      (rng() * 2 - 1) * half,
      r,
      r * (0.4 + rng() * 0.6),
      rng() * Math.PI,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
  // Fine grey-blue speckle.
  for (let i = 0; i < 420; i++) {
    ctx.fillStyle = rgba(140 + rng() * 60, 132 + rng() * 50, 132 + rng() * 50, 0.2);
    ctx.fillRect((rng() * 2 - 1) * half, (rng() * 2 - 1) * half, 1.2, 1.2);
  }
  // Bright white calcite veins.
  const veins = 1 + Math.floor(rng() * 3);
  for (let v = 0; v < veins; v++) {
    drawVein(ctx, rng, half, rgba(245, 232, 226, 0.55 + rng() * 0.35), 0.8 + rng() * 1.6, 3);
  }
}

function paintCreamTile(ctx: CanvasRenderingContext2D, rng: Rng, half: number): void {
  const tone = (rng() - 0.5) * 8;
  ctx.fillStyle = rgba(224 + tone, 219 + tone, 211 + tone, 1);
  ctx.fillRect(-half, -half, half * 2, half * 2);
  // Soft warm-grey clouding.
  for (let i = 0; i < 30; i++) {
    const r = half * (0.15 + rng() * 0.4);
    ctx.fillStyle = rgba(196 + rng() * 20, 190 + rng() * 18, 182 + rng() * 16, 0.06 + rng() * 0.08);
    ctx.beginPath();
    ctx.ellipse(
      (rng() * 2 - 1) * half,
      (rng() * 2 - 1) * half,
      r,
      r * (0.3 + rng() * 0.5),
      rng() * Math.PI,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
  // Thin grey Carrara-style veins.
  const veins = 1 + Math.floor(rng() * 2);
  for (let v = 0; v < veins; v++) {
    drawVein(ctx, rng, half, rgba(138, 134, 130, 0.35 + rng() * 0.3), 0.6 + rng() * 1.1, 2);
  }
}

export function createVitoriaRossoChequerboardTextures(): VitoriaChequerboardTextures {
  return getOrCreateCachedTexture('vitoria-rosso-chequerboard-pbr', () => {
    const size = 1024;
    const n = DIAGONALS_PER_REPEAT;
    const tilePx = size / (n * Math.SQRT2);
    const groutPx = 2.0;
    const half = tilePx / 2 - groutPx / 2;

    const [colorCanvas, bumpCanvas] = getOrCreateCachedCanvasPair(
      'vitoria-rosso-chequerboard',
      size,
      size,
      (cCtx, bCtx) => {
        cCtx.fillStyle = '#c9c2b7';
        cCtx.fillRect(0, 0, size, size);
        bCtx.fillStyle = '#343434';
        bCtx.fillRect(0, 0, size, size);

        const range = 2 * n + 2;
        for (let i = -range; i <= range; i++) {
          for (let j = -range; j <= range; j++) {
            const u = (i + 0.5) * tilePx;
            const v = (j + 0.5) * tilePx;
            const cx = (u - v) / Math.SQRT2;
            const cy = (u + v) / Math.SQRT2;
            if (cx < -tilePx || cx > size + tilePx || cy < -tilePx || cy > size + tilePx) {
              continue;
            }
            const wrappedI = ((i % n) + n) % n;
            const wrappedJ = ((j % n) + n) % n;
            const ci = ((i - wrappedI) / n + (j - wrappedJ) / n) % 2 === 0 ? 0 : 1;
            const seed = 9173 + wrappedI * 131 + wrappedJ * 977 + ci * 7919;
            const isRosso = (i + j) % 2 === 0;
            const hBias = ((seed * 17) % 15) - 7;

            for (const [ox, oy] of [
              [0, 0],
              [-size, 0],
              [size, 0],
              [0, -size],
              [0, size],
            ] as const) {
              const x = cx + ox;
              const y = cy + oy;
              if (x < -tilePx || x > size + tilePx || y < -tilePx || y > size + tilePx) {
                continue;
              }
              const rng = mulberry32(seed);
              cCtx.save();
              cCtx.translate(x, y);
              cCtx.rotate(Math.PI / 4);
              cCtx.beginPath();
              cCtx.rect(-half, -half, half * 2, half * 2);
              cCtx.clip();
              if (isRosso) {
                paintRossoTile(cCtx, rng, half);
              } else {
                paintCreamTile(cCtx, rng, half);
              }
              cCtx.strokeStyle = isRosso
                ? 'rgba(235, 212, 198, 0.22)'
                : 'rgba(255, 252, 245, 0.34)';
              cCtx.lineWidth = 1.4;
              cCtx.strokeRect(-half + 0.8, -half + 0.8, half * 2 - 1.6, half * 2 - 1.6);
              cCtx.restore();

              bCtx.save();
              bCtx.translate(x, y);
              bCtx.rotate(Math.PI / 4);
              const bevelLum = Math.max(120, Math.min(185, 156 + hBias));
              const crownLum = Math.max(195, Math.min(248, 224 + hBias));
              bCtx.fillStyle = `rgb(${bevelLum}, ${bevelLum}, ${bevelLum})`;
              bCtx.fillRect(-half, -half, half * 2, half * 2);
              bCtx.fillStyle = `rgb(${crownLum}, ${crownLum}, ${crownLum})`;
              bCtx.fillRect(-half + 2.4, -half + 2.4, half * 2 - 4.8, half * 2 - 4.8);
              bCtx.restore();
            }
          }
        }
      }
    );

    const colorMap = createBrowserDataOrCanvasTexture('vitoria:1', colorCanvas, {
      colorSpace: THREE.NoColorSpace,
    });
    colorMap.wrapS = THREE.RepeatWrapping;
    colorMap.wrapT = THREE.RepeatWrapping;
    colorMap.colorSpace = THREE.SRGBColorSpace;
    colorMap.anisotropy = 8;

    const bumpMap = createBrowserDataOrCanvasTexture('vitoria:2', bumpCanvas, {
      colorSpace: THREE.NoColorSpace,
    });
    bumpMap.wrapS = THREE.RepeatWrapping;
    bumpMap.wrapT = THREE.RepeatWrapping;
    bumpMap.anisotropy = 8;

    const { normalMap, roughnessMap } = derivePbrNormalAndRoughnessMaps(
      'vitoria-rosso-chequerboard',
      bumpCanvas,
      {
        normalStrength: 2.35,
        mortarThreshold: 0.42,
        mortarRoughness: 0.90,
        surfaceRoughnessMin: 0.36,
        surfaceRoughnessMax: 0.48,
        microGrainRoughness: 0.026,
        maxDimension: 1024,
      }
    );

    return { colorMap, bumpMap, normalMap, roughnessMap };
  });
}
