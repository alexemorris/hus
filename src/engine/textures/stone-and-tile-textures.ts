import * as THREE from 'three';
import {
  buildFloorPbrTextureBundle,
  clampByte,
  fastSinTurn,
  hash2Periodic,
  type FloorPbrTextureBundle,
  valueNoise2Periodic,
} from './floor-pbr-lut.ts';
import { derivePbrNormalAndRoughnessMaps } from './pbr-surface-maps.ts';
import {
  getOrCreateCachedCanvas,
  getOrCreateCachedCanvasPair,
  getOrCreateCachedTexture,
} from './texture-registry.ts';
import { createBrowserDataOrCanvasTexture } from './texture-registry.ts';

export function createStoneTileTexture(): THREE.CanvasTexture {
  const canvas = getOrCreateCachedCanvas('stone-tile', 512, 512, (ctx) => {
    // Lighter-colored pale silver/off-white grout lines (#e2e4e6)
    ctx.fillStyle = '#e2e4e6';
    ctx.fillRect(0, 0, 512, 512);

    // 2x2 grid per 1.20m x 1.20m tile repeat -> exact 60cm x 60cm large-format square tiles
    const rows = 2;
    const cols = 2;
    const w = 512 / cols;
    const h = 512 / rows;
    const groutHalf = 2.5; // crisp 5px light grout joint

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tx = c * w + groutHalf;
        const ty = r * h + groutHalf;
        const tw = w - groutHalf * 2;
        const th = h - groutHalf * 2;

        // Light grey poured concrete / micro-cement base tone
        const baseShade = 194 + ((r * 5 + c * 9) % 6) - 3;
        ctx.fillStyle = `rgb(${baseShade}, ${baseShade + 2}, ${baseShade + 5})`;
        ctx.fillRect(tx, ty, tw, th);

        // Subtle trowelled cement clouding & mineral aggregate texture within each 60x60 tile
        for (let py = ty + 4; py < ty + th - 8; py += 12) {
          for (let px = tx + 4; px < tx + tw - 8; px += 12) {
            const hash = ((px * 23 + py * 41 + r * 17 + c * 31) % 15) - 7;
            const s = baseShade + hash;
            ctx.fillStyle = `rgba(${s}, ${s + 2}, ${s + 4}, 0.32)`;
            ctx.fillRect(px, py, 14, 14);
          }
        }

        // Fine cement aggregate speckles (tiny light and dark mineral grains)
        for (let i = 0; i < 45; i++) {
          const sx = tx + 8 + ((i * 53 + r * 29 + c * 71) % Math.floor(tw - 16));
          const sy = ty + 8 + ((i * 79 + r * 43 + c * 19) % Math.floor(th - 16));
          ctx.fillStyle =
            i % 2 === 0 ? 'rgba(228, 232, 236, 0.25)' : 'rgba(155, 160, 166, 0.22)';
          ctx.fillRect(sx, sy, 2.5, 2.5);
        }
      }
    }
  });

  const tex = createBrowserDataOrCanvasTexture('stone-tile:1', canvas, { colorSpace: THREE.NoColorSpace });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  // 10.20m / 1.20m = 8.5 repeats X (17 x 60cm tiles); 5.25m / 1.20m = 4.375 repeats Z (8.75 x 60cm tiles)
  tex.repeat.set(8.5, 4.375);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createCourtyardStoneTexture(): THREE.CanvasTexture {
  const canvas = getOrCreateCachedCanvas('courtyard-stone', 512, 512, (ctx) => {
    // Warm sandy-buff lime mortar joints between limestone slabs
    ctx.fillStyle = '#b8ae9c';
    ctx.fillRect(0, 0, 512, 512);

    // Traditional random-coursed English riven limestone flagstone layout
    const slabs: ReadonlyArray<readonly [number, number, number, number]> = [
      // Course 1
      [4, 4, 196, 120],
      [206, 4, 148, 120],
      [360, 4, 148, 120],
      // Course 2
      [4, 130, 132, 124],
      [142, 130, 212, 124],
      [360, 130, 148, 124],
      // Course 3
      [4, 260, 224, 118],
      [234, 260, 132, 118],
      [372, 260, 136, 118],
      // Course 4
      [4, 384, 158, 124],
      [168, 384, 176, 124],
      [350, 384, 158, 124],
    ];

    const limestonePalette = [
      [206, 198, 182], // Warm Cotswold / Lincolnshire honey-buff limestone
      [196, 190, 178], // Pale dove-buff limestone
      [212, 204, 188], // Cream-buff flagstone
      [188, 184, 174], // Weathered silver-buff limestone
      [202, 193, 176], // Warm sandy limestone
    ];

    slabs.forEach(([x, y, bw, bh], i) => {
      const base = limestonePalette[i % limestonePalette.length] ?? [202, 194, 180];
      const delta = ((i * 13) % 10) - 5;
      const r = base[0] + delta;
      const g = base[1] + delta;
      const b = base[2] + delta;

      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(x, y, bw, bh);

      // Subtle natural riven stone surface mottling
      for (let sy = y + 6; sy < y + bh - 8; sy += 14) {
        for (let sx = x + 6; sx < x + bw - 8; sx += 18) {
          const n = (((sx * 19 + sy * 37 + i * 7) % 12) - 6);
          ctx.fillStyle = `rgba(${r + n}, ${g + n}, ${b + n}, 0.35)`;
          ctx.fillRect(sx, sy, 14, 10);
        }
      }

      // Chiseled edge highlight along each limestone slab
      ctx.strokeStyle = 'rgba(255, 250, 240, 0.28)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 1, y + 1, bw - 2, bh - 2);
    });
  });

  const tex = createBrowserDataOrCanvasTexture('stone-tile:2', canvas, { colorSpace: THREE.NoColorSpace });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5.5, 2.2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createGraniteSettArcTexture(): THREE.CanvasTexture {
  const canvas = getOrCreateCachedCanvas('granite-sett-arc', 512, 256, (ctx) => {
    // Warm sandy-colored lime/sand mortar pointing base
    ctx.fillStyle = '#cbb894';
    ctx.fillRect(0, 0, 512, 256);

    // Subtle sandy grain variation in the mortar pointing (periodic across 512x256)
    for (let y = 0; y < 256; y += 4) {
      for (let x = 0; x < 512; x += 4) {
        const delta = (((x % 512) * 17 + (y % 256) * 31) % 14) - 7;
        ctx.fillStyle = `rgb(${203 + delta}, ${184 + delta}, ${148 + delta})`;
        ctx.fillRect(x, y, 4, 4);
      }
    }

    // Mixture of old weathered granite cobble colors (silver-grey, blue-grey, rose/pink granite, buff, charcoal)
    const granitePalette = [
      '#7d8186',
      '#6c737b',
      '#8f7b74',
      '#928879',
      '#62666c',
      '#86898e',
      '#7f6d67',
      '#74797e',
      '#9b8f80',
      '#5b6066',
    ];

    // 100% 2D-periodic coursed granite setts (18 courses across 512px, 8 rows across 256px)
    // so world-space (X, Z) UV mapping wraps around corners as a single continuous seamless texture.
    const numCourses = 18;
    const numRows = 8;
    const courseStepX = 512 / numCourses; // 28.44px
    const cobbleStepY = 256 / numRows;    // 32.0px (exact integer divisor of 256px)
    const arcAmp = 14;

    for (let c = -2; c <= numCourses + 2; c++) {
      const cMod = ((c % numCourses) + numCourses) % numCourses;
      const baseCourseX = c * courseStepX;
      const staggerY = (cMod % 2) * (cobbleStepY * 0.5);

      for (let s = -2; s <= numRows + 2; s++) {
        const sMod = ((s % numRows) + numRows) % numRows;
        const yMid = s * cobbleStepY + staggerY;
        if (yMid < -32 || yMid > 288) continue;

        // Smoothly periodic wave across 256px so v=0 and v=1 match in both position and tangent angle
        const wavePhase = (2 * Math.PI * yMid) / 256;
        const arcOffsetX = arcAmp * 0.5 * (1 - Math.cos(wavePhase));
        const xMid = baseCourseX - arcOffsetX + courseStepX * 0.5;
        const tangentAngle = Math.atan(((arcAmp * Math.PI) / 256) * Math.sin(wavePhase));

        const colorIdx =
          Math.abs((cMod * 17 + sMod * 11 + 7) % granitePalette.length);
        const baseColor = granitePalette[colorIdx] ?? '#7d8186';

        const cobbleW = courseStepX - 4.6; // ~23.8px
        const cobbleH = cobbleStepY - 4.6; // ~27.4px

        ctx.save();
        ctx.translate(xMid, yMid);
        ctx.rotate(tangentAngle);

        const rx = -cobbleW * 0.5;
        const ry = -cobbleH * 0.5;
        const cornerR = 3.5;

        ctx.fillStyle = baseColor;
        ctx.beginPath();
        ctx.roundRect(rx, ry, cobbleW, cobbleH, cornerR);
        ctx.fill();

        // Subtle weathered top highlight & dark granite crystal speckle
        ctx.strokeStyle = 'rgba(255, 248, 235, 0.18)';
        ctx.lineWidth = 1.1;
        ctx.stroke();

        ctx.fillStyle = 'rgba(30, 32, 36, 0.12)';
        ctx.fillRect(rx + 3, ry + 4, 3, 3);
        ctx.fillRect(rx + cobbleW - 7, ry + cobbleH - 8, 3, 3);

        ctx.restore();
      }
    }
  });

  const tex = createBrowserDataOrCanvasTexture('stone-tile:3', canvas, { colorSpace: THREE.NoColorSpace });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createMarbleBacksplashTexture(): THREE.CanvasTexture {
  const canvas = getOrCreateCachedCanvas('marble-backsplash', 512, 192, (ctx) => {
    // Warm Carrara / Calacatta marble base
    const bg = ctx.createLinearGradient(0, 0, 512, 192);
    bg.addColorStop(0, '#f4f1ea');
    bg.addColorStop(0.5, '#faf8f4');
    bg.addColorStop(1, '#eeeae0');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 192);

    // Soft cloudy mineral wash
    for (let i = 0; i < 12; i++) {
      const cx = (i * 47) % 512;
      const cy = (i * 31) % 192;
      const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, 75);
      g.addColorStop(0, 'rgba(195, 190, 182, 0.16)');
      g.addColorStop(1, 'rgba(195, 190, 182, 0.0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 512, 192);
    }

    // Organic diagonal grey-taupe marble veins across the slab
    const veins: ReadonlyArray<readonly [number, number, number, number, number, number, number, string]> = [
      [15, 180, 110, 110, 210, 55, 1.8, 'rgba(148, 144, 138, 0.42)'],
      [95, 190, 175, 125, 270, 20, 1.1, 'rgba(165, 158, 148, 0.32)'],
      [180, 170, 260, 95, 360, 30, 2.1, 'rgba(140, 136, 130, 0.45)'],
      [230, 140, 310, 85, 410, 15, 1.0, 'rgba(175, 162, 142, 0.28)'],
      [320, 185, 395, 115, 495, 45, 1.7, 'rgba(146, 142, 136, 0.38)'],
      [50, 90, 145, 50, 240, 12, 0.9, 'rgba(156, 152, 146, 0.28)'],
      [370, 150, 430, 95, 505, 70, 1.1, 'rgba(162, 155, 145, 0.3)'],
    ];

    for (const [x0, y0, cx, cy, x1, y1, width, color] of veins) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(cx, cy, x1, y1);
      ctx.stroke();
    }
  });

  const tex = createBrowserDataOrCanvasTexture('stone-tile:4', canvas, { colorSpace: THREE.NoColorSpace });
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createCementTexture(): THREE.CanvasTexture {
  const canvas = getOrCreateCachedCanvas('cement', 256, 256, (ctx) => {
    // Modern architectural cast-cement neutral grey base
    ctx.fillStyle = '#9a9892';
    ctx.fillRect(0, 0, 256, 256);

    // Soft organic trowel / formwork clouding
    for (let i = 0; i < 18; i++) {
      const cx = (i * 53) % 256;
      const cy = (i * 41) % 256;
      const r = 36 + ((i * 19) % 44);
      const isLight = i % 2 === 0;
      const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, r);
      grad.addColorStop(
        0,
        isLight ? 'rgba(182, 180, 174, 0.22)' : 'rgba(122, 120, 115, 0.20)'
      );
      grad.addColorStop(1, 'rgba(154, 152, 146, 0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 256, 256);
    }

    // Fine cast-concrete aggregate & micro-pinhole pores
    for (let y = 0; y < 256; y += 4) {
      for (let x = 0; x < 256; x += 4) {
        const hash = (x * 29 + y * 47) % 19;
        if (hash === 0) {
          ctx.fillStyle = 'rgba(104, 102, 98, 0.35)';
          ctx.fillRect(x, y, 2, 2);
        } else if (hash === 1) {
          ctx.fillStyle = 'rgba(192, 190, 184, 0.28)';
          ctx.fillRect(x, y, 2, 2);
        }
      }
    }
  });

  const tex = createBrowserDataOrCanvasTexture('stone-tile:5', canvas, { colorSpace: THREE.NoColorSpace });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createHerringboneTerracottaQuarryTileTextures(): FloorPbrTextureBundle {
  return getOrCreateCachedTexture('herringbone-terracotta-quarry', () => {
    const size = 1024;
    const quarryPalette: ReadonlyArray<readonly [number, number, number]> = [
      [148, 86, 64],
      [134, 77, 57],
      [158, 94, 70],
      [126, 72, 54],
      [144, 84, 63],
      [138, 80, 60],
      [120, 68, 52],
      [162, 98, 73],
      [131, 75, 57],
      [141, 82, 62],
    ];

    const K = 4;
    const RATIO = 3;
    const GRID = K * RATIO;

    return buildFloorPbrTextureBundle({
      key: 'herringbone-terracotta-quarry',
      width: size,
      height: size,
      normalStrength: 2.6,
      anisotropy: 8,
      populate: (albedo, heightField, roughField) => {
        for (let py = 0; py < size; py++) {
          const v = py / size;
          for (let px = 0; px < size; px++) {
            const u = px / size;
            const a = (u + v) * GRID;
            const b = (u - v + 1.0) * GRID;
            const ia = Math.floor(a);
            const ib = Math.floor(b);
            const fa = a - ia;
            const fb = b - ib;

            const diag = (((ia - ib) % (2 * RATIO)) + 2 * RATIO) % (2 * RATIO);
            const horizontal = diag < RATIO;

            let blockI: number;
            let blockJ: number;
            let along: number;
            let across: number;
            if (horizontal) {
              blockI = ia - diag;
              blockJ = ib;
              along = (diag + fa) / RATIO;
              across = fb;
            } else {
              const d2 = diag - RATIO;
              blockI = ia;
              blockJ = (ib + d2 - (RATIO - 1)) * 3 + 1;
              along = (RATIO - 1 - d2 + fb) / RATIO;
              across = fa;
            }

            const pI = ((blockI % GRID) + GRID) % GRID;
            const pJ = ((blockJ % (GRID * 3)) + GRID * 3) % (GRID * 3);
            const seedIdx = (pI * 7 + pJ * 13) % quarryPalette.length;
            const pal = quarryPalette[seedIdx]!;
            const seedTone = (hash2Periodic(pI, pJ, GRID, GRID * 3, 29) - 0.5) * 18;
            const seedH = (hash2Periodic(pI, pJ, GRID, GRID * 3, 61) - 0.5) * 0.05;
            const seedR = (hash2Periodic(pI, pJ, GRID, GRID * 3, 89) - 0.5) * 0.05;

            const edgeAcross = Math.min(across, 1 - across);
            const edgeAlong = Math.min(along, 1 - along) * RATIO;
            const wobble =
              (valueNoise2Periodic(u * 2, v * 2, 24, 24, 311) - 0.5) * 0.018;
            const edgeMetric = Math.min(edgeAcross, edgeAlong) + wobble;

            const groutHalf = 0.036;
            const bevelEnd = 0.115;
            const isGrout = edgeMetric < groutHalf;
            const bevelT = THREE.MathUtils.smoothstep(edgeMetric, groutHalf * 0.65, bevelEnd);

            const idx = py * size + px;
            const o4 = idx * 4;

            if (isGrout) {
              const mortarGrain =
                (valueNoise2Periodic(u, v, 96, 96, 419) - 0.5) * 14 +
                (hash2Periodic(px, py, size, size, 433) - 0.5) * 8;
              albedo[o4] = clampByte(66 + mortarGrain);
              albedo[o4 + 1] = clampByte(57 + mortarGrain * 0.92);
              albedo[o4 + 2] = clampByte(49 + mortarGrain * 0.85);
              albedo[o4 + 3] = 255;
              heightField[idx] = 0.14 + (mortarGrain / 255) * 0.4;
              roughField[idx] = 0.92;
            } else {
              const kilnEdge = 1 - THREE.MathUtils.smoothstep(edgeMetric, groutHalf, 0.28);
              const clayCloud =
                (valueNoise2Periodic(u + pI * 0.07, v + pJ * 0.05, 16, 16, 521) - 0.5) * 14;
              const microClay =
                (valueNoise2Periodic(u, v, 84, 84, 607) - 0.5) * 7;
              const pitNoise = valueNoise2Periodic(u, v, 128, 128, 677);
              const pit = pitNoise < 0.14 ? (0.14 - pitNoise) * 4.5 : 0;

              const r = pal[0] + seedTone + clayCloud + microClay - kilnEdge * 12 - pit * 14;
              const g = pal[1] + seedTone * 0.66 + clayCloud * 0.72 + microClay * 0.7 - kilnEdge * 9 - pit * 10;
              const b = pal[2] + seedTone * 0.52 + clayCloud * 0.58 + microClay * 0.6 - kilnEdge * 7 - pit * 8;

              const creviceAO = THREE.MathUtils.lerp(0.62, 1.0, bevelT);
              albedo[o4] = clampByte(r * creviceAO);
              albedo[o4 + 1] = clampByte(g * creviceAO);
              albedo[o4 + 2] = clampByte(b * creviceAO);
              albedo[o4 + 3] = 255;

              const pillow =
                Math.sin(THREE.MathUtils.clamp(across, 0, 1) * Math.PI) *
                Math.sin(THREE.MathUtils.clamp(along, 0, 1) * Math.PI) *
                0.045;
              const hBody =
                0.76 +
                seedH +
                pillow +
                (clayCloud / 14) * 0.025 -
                pit * 0.09;
              heightField[idx] = THREE.MathUtils.clamp(
                THREE.MathUtils.lerp(0.18, hBody, bevelT),
                0,
                1
              );

              let rough =
                0.43 +
                seedR -
                pillow * 0.65 +
                kilnEdge * 0.08 +
                (0.5 - microClay / 14) * 0.04;
              rough = THREE.MathUtils.clamp(rough, 0.37, 0.52);
              if (pit > 0.02) {
                rough = THREE.MathUtils.lerp(rough, 0.68, THREE.MathUtils.clamp(pit, 0, 1));
              }
              rough = THREE.MathUtils.lerp(0.92, rough, bevelT);
              roughField[idx] = rough;
            }
          }
        }
      },
    });
  });
}

/**
 * Aged tumbled & honed English / Bourgogne natural limestone flagstone PBR texture set
 * (`1024 × 1024`, coursed varied-length stone modules across a `1.60m` world repeat when paired
 * with `0.5 m⁻¹` slab UVs and `.repeat.set(1.25, 1.25)`):
 * - Stone-to-stone mineral variation (warm ivory, pale fawn, fossil buff, soft grey-taupe)
 * - Sedimentary clouding, fine fossil/calcite shell & vein inclusions, tumbled undulation & micro-pitting
 * - Hand-dressed pillowed flagstone arrises and recessed `3–4.5 mm` lime-mortar joints
 * - Calibrated impregnator-sealed honed/tumbled limestone `roughnessMap` (`0.40–0.54` honed stone centres,
 *   `0.68` micro-pits, `0.92` dead-matte lime-mortar joints).
 */
export function createTumbledLimestoneFlagstoneTextures(): FloorPbrTextureBundle {
  return getOrCreateCachedTexture('tumbled-limestone-flagstone-pbr', () => {
    const size = 1024;
    const courses: ReadonlyArray<{
      readonly y0: number;
      readonly h: number;
      readonly splits: readonly number[];
    }> = [
      { y0: 0, h: 272, splits: [0, 384, 712, 1024] },
      { y0: 272, h: 232, splits: [0, 188, 556, 876, 1024] },
      { y0: 504, h: 280, splits: [0, 72, 456, 804, 1024] },
      { y0: 784, h: 240, splits: [0, 252, 616, 948, 1024] },
    ];

    const palette: ReadonlyArray<readonly [number, number, number]> = [
      [222, 214, 198],
      [212, 203, 185],
      [205, 195, 177],
      [217, 209, 194],
      [201, 193, 178],
      [215, 205, 187],
      [224, 217, 203],
      [208, 199, 182],
    ];

    return buildFloorPbrTextureBundle({
      key: 'tumbled-limestone-flagstone',
      width: size,
      height: size,
      normalStrength: 2.45,
      repeat: [1.25, 1.25],
      anisotropy: 16,
      populate: (albedo, heightField, roughField) => {
        for (let cIdx = 0; cIdx < courses.length; cIdx++) {
          const course = courses[cIdx]!;
          const splits = course.splits;
          const numSegs = splits.length - 1;
          const wrapsX = splits[1]! < 300 && splits[numSegs - 1]! > 760;

          for (let ly = 0; ly < course.h; ly++) {
            const py = course.y0 + ly;
            const v = py / size;
            const distBedJointPx = Math.min(ly + 0.5, course.h - (ly + 0.5));

            let seg = 0;
            for (let px = 0; px < size; px++) {
              while (seg < numSegs - 1 && px >= splits[seg + 1]!) {
                seg++;
              }
              const u = px / size;
              const x0 = splits[seg]!;
              const x1 = splits[seg + 1]!;
              const slabId = wrapsX && seg === numSegs - 1 ? 0 : seg;
              const seed = cIdx * 31 + slabId * 17 + 7;
              const pal = palette[(seed * 5 + cIdx * 3) % palette.length]!;

              const distLeftPerp = x0 === 0 && wrapsX ? 999 : px + 0.5 - x0;
              const distRightPerp = x1 === size && wrapsX ? 999 : x1 - (px + 0.5);
              const distPerpJointPx = Math.min(distLeftPerp, distRightPerp);

              const arrisChisel =
                (valueNoise2Periodic(u, v, 48, 48, 211) - 0.5) * 1.15 +
                (valueNoise2Periodic(u, v, 112, 112, 239) - 0.5) * 0.55;
              const dEdgePx = Math.min(distBedJointPx, distPerpJointPx) + arrisChisel;
              const cornerRoundPx =
                distBedJointPx < 9 && distPerpJointPx < 9
                  ? 9 - Math.hypot(9 - distBedJointPx, 9 - distPerpJointPx)
                  : 999;
              const edgePx = Math.min(dEdgePx, cornerRoundPx + arrisChisel * 0.6);

              const mortarHalfPx = 1.45;
              const pillowWidthPx = 7.2;
              const isMortar = edgePx < mortarHalfPx;
              const bevelT = THREE.MathUtils.smoothstep(edgePx, mortarHalfPx * 0.7, pillowWidthPx);

              const idx = py * size + px;
              const o4 = idx * 4;

              if (isMortar) {
                const sand =
                  (valueNoise2Periodic(u, v, 128, 128, 307) - 0.5) * 13 +
                  (hash2Periodic(px, py, size, size, 331) - 0.5) * 9;
                albedo[o4] = clampByte(196 + sand);
                albedo[o4 + 1] = clampByte(188 + sand * 0.95);
                albedo[o4 + 2] = clampByte(173 + sand * 0.88);
                albedo[o4 + 3] = 255;
                heightField[idx] = 0.15 + (sand / 255) * 0.35;
                roughField[idx] = 0.92;
              } else {
                const stoneShift = (hash2Periodic(slabId, cIdx, 8, 4, 37) - 0.5) * 15;
                const warmShift = (hash2Periodic(slabId, cIdx, 8, 4, 71) - 0.5) * 8;
                const slabHeightBias = (hash2Periodic(slabId, cIdx, 8, 4, 97) - 0.5) * 0.045;
                const slabRoughBias = (hash2Periodic(slabId, cIdx, 8, 4, 127) - 0.5) * 0.045;

                const cloud1 = valueNoise2Periodic(
                  u + seed * 0.071,
                  v + seed * 0.053,
                  10,
                  10,
                  409
                );
                const cloud2 = valueNoise2Periodic(
                  u + seed * 0.031,
                  v + seed * 0.089,
                  26,
                  26,
                  461
                );
                const microOolite = valueNoise2Periodic(u, v, 96, 96, 503);
                const sedimentary = (cloud1 - 0.5) * 14 + (cloud2 - 0.5) * 8 + (microOolite - 0.5) * 5;

                const veinPhase =
                  u * 3.0 + v * 2.0 + (cloud1 - 0.5) * 0.55 + seed * 0.13;
                const veinRidge = Math.abs(fastSinTurn(veinPhase));
                const calciteVein =
                  veinRidge < 0.045
                    ? THREE.MathUtils.smoothstep(0.045 - veinRidge, 0, 0.045) * 0.65
                    : 0;

                const shellNoise = valueNoise2Periodic(
                  u + seed * 0.11,
                  v + seed * 0.17,
                  64,
                  64,
                  577
                );
                const fossilArc =
                  shellNoise > 0.84
                    ? THREE.MathUtils.smoothstep(shellNoise, 0.84, 0.96)
                    : 0;

                const pitNoise = valueNoise2Periodic(u, v, 144, 144, 641);
                const pitThreshold = 0.15 + (1 - bevelT) * 0.08;
                const pit =
                  pitNoise < pitThreshold
                    ? THREE.MathUtils.clamp((pitThreshold - pitNoise) * 5.2, 0, 1)
                    : 0;

                let r =
                  pal[0] +
                  stoneShift +
                  warmShift +
                  sedimentary +
                  calciteVein * 18 +
                  fossilArc * 13 -
                  pit * 16;
                let g =
                  pal[1] +
                  stoneShift +
                  warmShift * 0.82 +
                  sedimentary * 0.96 +
                  calciteVein * 17 +
                  fossilArc * 11 -
                  pit * 15;
                let b =
                  pal[2] +
                  stoneShift +
                  warmShift * 0.54 +
                  sedimentary * 0.9 +
                  calciteVein * 14 +
                  fossilArc * 8 -
                  pit * 13;

                const arrisWearLift =
                  edgePx >= mortarHalfPx + 1.2 && edgePx <= pillowWidthPx + 1.5
                    ? (1 - Math.abs(edgePx - (mortarHalfPx + 3.2)) / 3.5) * 5.0
                    : 0;
                const creviceAO = THREE.MathUtils.lerp(0.76, 1.0, bevelT);
                r = r * creviceAO + Math.max(0, arrisWearLift);
                g = g * creviceAO + Math.max(0, arrisWearLift * 0.96);
                b = b * creviceAO + Math.max(0, arrisWearLift * 0.9);

                albedo[o4] = clampByte(r);
                albedo[o4 + 1] = clampByte(g);
                albedo[o4 + 2] = clampByte(b);
                albedo[o4 + 3] = 255;

                const undulation =
                  (cloud1 - 0.5) * 0.055 +
                  (cloud2 - 0.5) * 0.028 +
                  (microOolite - 0.5) * 0.014;
                const hStone =
                  0.77 +
                  slabHeightBias +
                  undulation +
                  calciteVein * 0.015 -
                  pit * 0.14;
                heightField[idx] = THREE.MathUtils.clamp(
                  THREE.MathUtils.lerp(0.20, hStone, bevelT),
                  0,
                  1
                );

                let rough =
                  0.46 +
                  slabRoughBias -
                  (cloud1 - 0.5) * 0.07 +
                  (0.5 - microOolite) * 0.04 -
                  calciteVein * 0.06;
                rough = THREE.MathUtils.clamp(rough, 0.40, 0.54);
                if (pit > 0.02) {
                  rough = THREE.MathUtils.lerp(rough, 0.68, pit);
                }
                rough = THREE.MathUtils.lerp(0.92, rough, bevelT);
                roughField[idx] = rough;
              }
            }
          }
        }
      },
    });
  });
}

/** Nominal face pitch (`406mm`) of a `Parisian Manoir Cabochon` tumbled marble octagon tile. */
export const PARISIAN_MANOIR_TILE_PITCH_M = 0.406;
/** Number of octagon courses across one procedural texture tile (`3 × 0.406m = 1.218m`). */
export const PARISIAN_MANOIR_GRID_CELLS = 3;
/** World-space repeat span (`1.218m`) covered by one `Parisian Manoir` procedural texture repeat. */
export const PARISIAN_MANOIR_REPEAT_SPAN_M =
  PARISIAN_MANOIR_GRID_CELLS * PARISIAN_MANOIR_TILE_PITCH_M;

const PARISIAN_MANOIR_CABOCHON_CUT_M = 0.052;
const PARISIAN_MANOIR_GROUT_COLOR = '#f2eee5';
const PARISIAN_MANOIR_GROUT_HALF_PX = 1.26;

const PARISIAN_MANOIR_OCTAGON_PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [214, 209, 200],
  [206, 202, 194],
  [219, 213, 203],
  [202, 198, 191],
  [212, 206, 195],
];

const PARISIAN_MANOIR_CABOCHON_PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [86, 84, 81],
  [75, 74, 71],
  [95, 93, 89],
  [81, 79, 76],
];

/** Nominal face pitch (`125mm`) of a Claybrook Studio `Fellini Oliva` square ceramic wall tile. */
export const FELLINI_OLIVA_TILE_PITCH_M = 0.125;
const FELLINI_OLIVA_GRID_CELLS = 8;
const FELLINI_OLIVA_GROUT_COLOR = '#d8d7c5';
const FELLINI_OLIVA_GROUT_SHADOW = '#c5bbaf';
const FELLINI_OLIVA_GROUT_HALF_PX = 1.54;

/**
 * Sampled directly from Claybrook Studio `Fellini Oliva Gloss Square` studio swatches
 * (`HSL Hue = 115°-150°, S = 5%-10%`, pale misty celadon / dusty eucalyptus-sage over white clay):
 * - ~25% lightest misty white-clay / celadon (`#CFD9D1`, `#C5CEC4`, `#BDC6BB`)
 * - ~55% core mid dusty sage / smoky eucalyptus (`#B2BEB7`, `#A9B2AA`, `#A1ABA2`, `#9FA9A1`)
 * - ~20% deeper smoky slate-olive (`#96A197`, `#939E98`)
 */
const FELLINI_OLIVA_V4_PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [207, 217, 209], // #CFD9D1 (lightest misty celadon)
  [178, 190, 183], // #B2BEB7 (mid dusty sage)
  [169, 178, 170], // #A9B2AA (mid smoky eucalyptus)
  [150, 161, 151], // #96A197 (deeper smoky slate-olive)
  [197, 206, 196], // #C5CEC4 (light white-clay celadon)
  [161, 171, 162], // #A1ABA2 (core eucalyptus-sage)
  [159, 169, 161], // #9FA9A1 (core smoky sage)
  [189, 198, 187], // #BDC6BB (light misty sage)
  [178, 190, 183], // #B2BEB7 (mid dusty sage)
  [147, 158, 152], // #939E98 (deeper slate-olive)
  [169, 178, 170], // #A9B2AA (mid smoky eucalyptus)
  [207, 217, 209], // #CFD9D1 (lightest misty celadon)
  [161, 171, 162], // #A1ABA2 (core eucalyptus-sage)
  [150, 161, 151], // #96A197 (deeper smoky slate-olive)
  [159, 169, 161], // #9FA9A1 (core smoky sage)
  [197, 206, 196], // #C5CEC4 (light white-clay celadon)
  [178, 190, 183], // #B2BEB7 (mid dusty sage)
  [169, 178, 170], // #A9B2AA (mid smoky eucalyptus)
  [147, 158, 152], // #939E98 (deeper slate-olive)
  [161, 171, 162], // #A1ABA2 (core eucalyptus-sage)
];

function clampColorByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function traceParisianOctagonPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  cellPx: number,
  cutPx: number,
  inset: number
): void {
  const half = cellPx * 0.5 - inset;
  const diagCut = cutPx + inset * 0.4142;
  const xL = cx - half;
  const xR = cx + half;
  const yT = cy - half;
  const yB = cy + half;
  ctx.beginPath();
  ctx.moveTo(xL + diagCut, yT);
  ctx.lineTo(xR - diagCut, yT);
  ctx.lineTo(xR, yT + diagCut);
  ctx.lineTo(xR, yB - diagCut);
  ctx.lineTo(xR - diagCut, yB);
  ctx.lineTo(xL + diagCut, yB);
  ctx.lineTo(xL, yB - diagCut);
  ctx.lineTo(xL, yT + diagCut);
  ctx.closePath();
}

function traceParisianCabochonPath(
  ctx: CanvasRenderingContext2D,
  vx: number,
  vy: number,
  cutPx: number,
  inset: number
): void {
  const radius = Math.max(4, cutPx - inset * Math.SQRT2);
  ctx.beginPath();
  ctx.moveTo(vx, vy - radius);
  ctx.lineTo(vx + radius, vy);
  ctx.lineTo(vx, vy + radius);
  ctx.lineTo(vx - radius, vy);
  ctx.closePath();
}

function paintParisianOctagonTile(
  cCtx: CanvasRenderingContext2D,
  bCtx: CanvasRenderingContext2D,
  row: number,
  col: number,
  cellPx: number,
  cutPx: number
): void {
  const seed = row * 7 + col * 13 + 5;
  const cx = (col + 0.5) * cellPx;
  const cy = (row + 0.5) * cellPx;
  const base =
    PARISIAN_MANOIR_OCTAGON_PALETTE[(row * 3 + col * 2) % PARISIAN_MANOIR_OCTAGON_PALETTE.length]!;
  const shift = ((seed * 11) % 5) - 2;
  const br = clampColorByte(base[0] + shift);
  const bg = clampColorByte(base[1] + shift);
  const bb = clampColorByte(base[2] + shift);

  bCtx.fillStyle = 'rgb(186, 186, 186)';
  traceParisianOctagonPath(bCtx, cx, cy, cellPx, cutPx, PARISIAN_MANOIR_GROUT_HALF_PX);
  bCtx.fill();

  bCtx.fillStyle = 'rgb(206, 206, 206)';
  traceParisianOctagonPath(bCtx, cx, cy, cellPx, cutPx, PARISIAN_MANOIR_GROUT_HALF_PX + 2.4);
  bCtx.fill();

  cCtx.save();
  bCtx.save();
  traceParisianOctagonPath(cCtx, cx, cy, cellPx, cutPx, PARISIAN_MANOIR_GROUT_HALF_PX);
  cCtx.fillStyle = `rgb(${br}, ${bg}, ${bb})`;
  cCtx.fill();
  cCtx.clip();

  traceParisianOctagonPath(bCtx, cx, cy, cellPx, cutPx, PARISIAN_MANOIR_GROUT_HALF_PX + 1.5);
  bCtx.clip();

  const x0 = cx - cellPx * 0.5;
  const y0 = cy - cellPx * 0.5;

  for (let py = y0 + 8; py < y0 + cellPx - 12; py += 22) {
    for (let px = x0 + 8; px < x0 + cellPx - 12; px += 24) {
      const h = ((Math.round(px) * 19 + Math.round(py) * 31 + seed * 17) % 13) - 6;
      const warmPatch = (Math.round(px + py) + seed * 7) % 5 === 0;
      const mr = clampColorByte(br + h + (warmPatch ? 2 : -3));
      const mg = clampColorByte(bg + h + (warmPatch ? 0 : -2));
      const mb = clampColorByte(bb + h + (warmPatch ? -4 : 0));
      cCtx.fillStyle = `rgba(${mr}, ${mg}, ${mb}, 0.25)`;
      cCtx.fillRect(px, py, 26, 22);

      const bh = clampColorByte(206 + h * 1.1);
      bCtx.fillStyle = `rgba(${bh}, ${bh}, ${bh}, 0.24)`;
      bCtx.fillRect(px, py, 26, 22);
    }
  }

  for (let v = 0; v < 4; v++) {
    const isWarmVein = v === 2 || v === 3;
    cCtx.strokeStyle = isWarmVein
      ? 'rgba(176, 154, 118, 0.34)'
      : 'rgba(122, 125, 130, 0.36)';
    cCtx.lineWidth = v === 0 ? 2.5 : 1.5;
    const startOff = ((v * 83 + seed * 29) % Math.floor(cellPx * 0.8)) - cellPx * 0.4;
    cCtx.beginPath();
    cCtx.moveTo(x0 + 6, cy + startOff * 0.65);
    cCtx.bezierCurveTo(
      cx - cellPx * 0.16,
      cy + startOff * 0.2 - 26,
      cx + cellPx * 0.18,
      cy - startOff * 0.25 + 22,
      x0 + cellPx - 6,
      cy - startOff * 0.55
    );
    cCtx.stroke();
  }

  for (let f = 0; f < 22; f++) {
    const fx = x0 + 14 + ((f * 67 + seed * 43) % Math.floor(cellPx - 28));
    const fy = y0 + 14 + ((f * 89 + seed * 37) % Math.floor(cellPx - 28));
    cCtx.fillStyle =
      f % 3 === 0 ? 'rgba(248, 246, 241, 0.36)' : 'rgba(176, 174, 168, 0.22)';
    cCtx.fillRect(fx, fy, f % 4 === 0 ? 4.5 : 2.6, 2.0);
  }

  cCtx.restore();
  bCtx.restore();

  cCtx.strokeStyle = 'rgba(174, 168, 158, 0.58)';
  cCtx.lineWidth = 1.5;
  traceParisianOctagonPath(cCtx, cx, cy, cellPx, cutPx, PARISIAN_MANOIR_GROUT_HALF_PX + 0.7);
  cCtx.stroke();
}

function paintParisianCabochonInsert(
  cCtx: CanvasRenderingContext2D,
  bCtx: CanvasRenderingContext2D,
  ix: number,
  iy: number,
  cellPx: number,
  cutPx: number
): void {
  const modX = ix % PARISIAN_MANOIR_GRID_CELLS;
  const modY = iy % PARISIAN_MANOIR_GRID_CELLS;
  const seed = modY * 11 + modX * 19 + 3;
  const vx = ix * cellPx;
  const vy = iy * cellPx;
  const base =
    PARISIAN_MANOIR_CABOCHON_PALETTE[(modY * 2 + modX) % PARISIAN_MANOIR_CABOCHON_PALETTE.length]!;

  bCtx.fillStyle = 'rgb(184, 184, 184)';
  traceParisianCabochonPath(bCtx, vx, vy, cutPx, PARISIAN_MANOIR_GROUT_HALF_PX);
  bCtx.fill();

  bCtx.fillStyle = 'rgb(204, 204, 204)';
  traceParisianCabochonPath(bCtx, vx, vy, cutPx, PARISIAN_MANOIR_GROUT_HALF_PX + 2.0);
  bCtx.fill();

  cCtx.save();
  traceParisianCabochonPath(cCtx, vx, vy, cutPx, PARISIAN_MANOIR_GROUT_HALF_PX);
  cCtx.fillStyle = `rgb(${base[0]}, ${base[1]}, ${base[2]})`;
  cCtx.fill();
  cCtx.clip();

  for (let s = 0; s < 38; s++) {
    const ox = (((s * 37 + seed * 13) % 76) - 38) * (cutPx / 42);
    const oy = (((s * 53 + seed * 29) % 76) - 38) * (cutPx / 42);
    cCtx.fillStyle =
      s % 3 !== 0 ? 'rgba(186, 183, 177, 0.32)' : 'rgba(54, 52, 50, 0.36)';
    cCtx.fillRect(vx + ox, vy + oy, s % 4 === 0 ? 4.2 : 2.4, 2.2);
  }

  cCtx.strokeStyle = 'rgba(206, 203, 196, 0.34)';
  cCtx.lineWidth = 1.1;
  cCtx.beginPath();
  cCtx.moveTo(vx - cutPx * 0.65, vy - cutPx * 0.18);
  cCtx.quadraticCurveTo(vx, vy + cutPx * 0.14, vx + cutPx * 0.62, vy - cutPx * 0.08);
  cCtx.stroke();
  cCtx.restore();

  cCtx.strokeStyle = 'rgba(172, 169, 162, 0.40)';
  cCtx.lineWidth = 1.0;
  traceParisianCabochonPath(cCtx, vx, vy, cutPx, PARISIAN_MANOIR_GROUT_HALF_PX + 0.5);
  cCtx.stroke();
}

/**
 * Quorn Stone / MyStoneFloor `Parisian Manoir Cabochon` tumbled marble floor tile PBR texture set
 * (SKU `601200`: `406 × 406 × 10mm` warm chalky cream/ecru & dove-veined tumbled marble octagons
 * with contrasting aged-noir tumbled marble diamond cabochon inserts and `3mm` *White Wash* grout).
 *
 * One `1024 × 1024` tile spans a `3 × 3` module (`1.218m × 1.218m` in world space; paired with
 * `uvScale = 0.5` (`2.00m` per UV unit) and `.repeat.set(1.642, 1.642)` so each octagon renders at
 * exact `0.406m` (`40.6cm`) pitch and each cabochon insert at `~71 × 71mm`).
 */
export function createParisianManoirCabochonTextures(): {
  readonly colorMap: THREE.CanvasTexture;
  readonly bumpMap: THREE.CanvasTexture;
  readonly normalMap: THREE.CanvasTexture;
  readonly roughnessMap: THREE.Texture;
} {
  return getOrCreateCachedTexture('parisian-manoir-cabochon-pbr', () => {
    const size = 1024;
    const cellPx = size / PARISIAN_MANOIR_GRID_CELLS;
    const cutPx = (PARISIAN_MANOIR_CABOCHON_CUT_M / PARISIAN_MANOIR_TILE_PITCH_M) * cellPx;
    const repeatScale = 2.0 / PARISIAN_MANOIR_REPEAT_SPAN_M;

    const [colorCanvas, bumpCanvas] = getOrCreateCachedCanvasPair(
      'parisian-manoir-cabochon',
      size,
      size,
      (cCtx, bCtx) => {
        cCtx.fillStyle = PARISIAN_MANOIR_GROUT_COLOR;
        cCtx.fillRect(0, 0, size, size);

        bCtx.fillStyle = 'rgb(122, 122, 122)';
        bCtx.fillRect(0, 0, size, size);

        for (let row = 0; row < PARISIAN_MANOIR_GRID_CELLS; row++) {
          for (let col = 0; col < PARISIAN_MANOIR_GRID_CELLS; col++) {
            paintParisianOctagonTile(cCtx, bCtx, row, col, cellPx, cutPx);
          }
        }

        for (let iy = 0; iy <= PARISIAN_MANOIR_GRID_CELLS; iy++) {
          for (let ix = 0; ix <= PARISIAN_MANOIR_GRID_CELLS; ix++) {
            paintParisianCabochonInsert(cCtx, bCtx, ix, iy, cellPx, cutPx);
          }
        }
      }
    );

    const colorMap = createBrowserDataOrCanvasTexture('stone-tile:12', colorCanvas, { colorSpace: THREE.NoColorSpace });
    colorMap.wrapS = THREE.RepeatWrapping;
    colorMap.wrapT = THREE.RepeatWrapping;
    colorMap.repeat.set(repeatScale, repeatScale);
    colorMap.colorSpace = THREE.SRGBColorSpace;
    colorMap.anisotropy = 16;

    const bumpMap = createBrowserDataOrCanvasTexture('stone-tile:13', bumpCanvas, { colorSpace: THREE.NoColorSpace });
    bumpMap.wrapS = THREE.RepeatWrapping;
    bumpMap.wrapT = THREE.RepeatWrapping;
    bumpMap.repeat.set(repeatScale, repeatScale);
    bumpMap.anisotropy = 16;

    const { normalMap, roughnessMap } = derivePbrNormalAndRoughnessMaps(
      'parisian-manoir-cabochon',
      bumpCanvas,
      {
        normalStrength: 2.35,
        mortarThreshold: 0.62,
        mortarRoughness: 0.90,
        surfaceRoughnessMin: 0.32,
        surfaceRoughnessMax: 0.46,
        microGrainRoughness: 0.028,
        maxDimension: 1024,
      }
    );
    normalMap.repeat.set(repeatScale, repeatScale);
    normalMap.anisotropy = 16;
    roughnessMap.repeat.set(repeatScale, repeatScale);
    roughnessMap.anisotropy = 16;

    return { colorMap, bumpMap, normalMap, roughnessMap };
  });
}

/**
 * Matching `Parisian Manoir` pale tumbled marble upstand/skirting PBR texture set
 * (`406 × 100 × 12mm` chamfered-top marble upstand tiles cut from the pale tumbled marble field
 * stone with `3mm` *White Wash* vertical grout joints every `0.406m` across `1.218m` world U).
 */
export function createParisianManoirUpstandTextures(): {
  readonly colorMap: THREE.CanvasTexture;
  readonly bumpMap: THREE.CanvasTexture;
  readonly normalMap: THREE.CanvasTexture;
  readonly roughnessMap: THREE.Texture;
} {
  return getOrCreateCachedTexture('parisian-manoir-upstand-pbr', () => {
    const width = 1024;
    const height = 256;
    const cellW = width / PARISIAN_MANOIR_GRID_CELLS;

    const [colorCanvas, bumpCanvas] = getOrCreateCachedCanvasPair(
      'parisian-manoir-upstand',
      width,
      height,
      (cCtx, bCtx) => {
        cCtx.fillStyle = PARISIAN_MANOIR_GROUT_COLOR;
        cCtx.fillRect(0, 0, width, height);

        bCtx.fillStyle = 'rgb(122, 122, 122)';
        bCtx.fillRect(0, 0, width, height);

        for (let c = 0; c < PARISIAN_MANOIR_GRID_CELLS; c++) {
          const sx = c * cellW + PARISIAN_MANOIR_GROUT_HALF_PX;
          const sw = cellW - PARISIAN_MANOIR_GROUT_HALF_PX * 2;
          const base = PARISIAN_MANOIR_OCTAGON_PALETTE[c % PARISIAN_MANOIR_OCTAGON_PALETTE.length]!;

          bCtx.fillStyle = 'rgb(188, 188, 188)';
          bCtx.fillRect(sx, 0, sw, height);
          bCtx.fillStyle = 'rgb(206, 206, 206)';
          bCtx.fillRect(sx + 2, 3, sw - 4, height - 6);

          cCtx.fillStyle = `rgb(${base[0]}, ${base[1]}, ${base[2]})`;
          cCtx.fillRect(sx, 0, sw, height);

          for (let py = 6; py < height - 10; py += 20) {
            for (let px = sx + 6; px < sx + sw - 14; px += 24) {
              const h = ((Math.round(px) * 17 + py * 29 + c * 13) % 11) - 5;
              cCtx.fillStyle = `rgba(${clampColorByte(base[0] + h)}, ${clampColorByte(base[1] + h)}, ${clampColorByte(base[2] + h)}, 0.25)`;
              cCtx.fillRect(px, py, 22, 18);
            }
          }

          cCtx.strokeStyle = 'rgba(128, 130, 134, 0.30)';
          cCtx.lineWidth = 1.8;
          cCtx.beginPath();
          cCtx.moveTo(sx + 8, height * (0.28 + c * 0.14));
          cCtx.bezierCurveTo(
            sx + sw * 0.35,
            height * 0.62,
            sx + sw * 0.68,
            height * 0.24,
            sx + sw - 8,
            height * 0.54
          );
          cCtx.stroke();
        }
      }
    );

    const colorMap = createBrowserDataOrCanvasTexture('stone-tile:14', colorCanvas, { colorSpace: THREE.NoColorSpace });
    colorMap.wrapS = THREE.RepeatWrapping;
    colorMap.wrapT = THREE.ClampToEdgeWrapping;
    colorMap.colorSpace = THREE.SRGBColorSpace;
    colorMap.anisotropy = 16;

    const bumpMap = createBrowserDataOrCanvasTexture('stone-tile:15', bumpCanvas, { colorSpace: THREE.NoColorSpace });
    bumpMap.wrapS = THREE.RepeatWrapping;
    bumpMap.wrapT = THREE.ClampToEdgeWrapping;
    bumpMap.anisotropy = 16;

    const { normalMap, roughnessMap } = derivePbrNormalAndRoughnessMaps(
      'parisian-manoir-upstand',
      bumpCanvas,
      {
        normalStrength: 2.15,
        wrapS: true,
        wrapT: false,
        mortarThreshold: 0.62,
        mortarRoughness: 0.90,
        surfaceRoughnessMin: 0.32,
        surfaceRoughnessMax: 0.46,
        microGrainRoughness: 0.024,
        maxDimension: 1024,
      }
    );
    normalMap.anisotropy = 16;
    roughnessMap.anisotropy = 16;

    return { colorMap, bumpMap, normalMap, roughnessMap };
  });
}

function paintFelliniOlivaGlazedTile(
  cCtx: CanvasRenderingContext2D,
  bCtx: CanvasRenderingContext2D,
  row: number,
  col: number,
  cellPx: number
): void {
  const hash = ((row * 41 + col * 67 + ((row * 13) ^ (col * 29)) * 19 + 7) >>> 0);
  const base = FELLINI_OLIVA_V4_PALETTE[hash % FELLINI_OLIVA_V4_PALETTE.length]!;
  const drift = ((hash * 17) % 9) - 4;
  // Preserve cool mineral celadon/eucalyptus balance (Blue >= Red, never yellow-green R >> B)
  const br = clampColorByte(base[0] + drift);
  const bg = clampColorByte(base[1] + drift);
  const bb = clampColorByte(Math.max(br, base[2] + drift));

  const jitterW = (((hash >> 3) % 3) - 1) * 0.3;
  const tx = col * cellPx + FELLINI_OLIVA_GROUT_HALF_PX - jitterW * 0.5;
  const ty = row * cellPx + FELLINI_OLIVA_GROUT_HALF_PX - jitterW * 0.5;
  const tw = cellPx - FELLINI_OLIVA_GROUT_HALF_PX * 2 + jitterW;
  const th = cellPx - FELLINI_OLIVA_GROUT_HALF_PX * 2 + jitterW;

  // Shaded Dawn mortar joint recess (#C5BBAF) hugging the pressed tile edge
  cCtx.strokeStyle = FELLINI_OLIVA_GROUT_SHADOW;
  cCtx.lineWidth = 1.4;
  cCtx.beginPath();
  cCtx.roundRect(tx - 0.6, ty - 0.6, tw + 1.2, th + 1.2, 2.8);
  cCtx.stroke();

  bCtx.fillStyle = 'rgb(174, 174, 174)';
  bCtx.beginPath();
  bCtx.roundRect(tx, ty, tw, th, 2.5);
  bCtx.fill();

  bCtx.fillStyle = 'rgb(202, 202, 202)';
  bCtx.beginPath();
  bCtx.roundRect(tx + 2.2, ty + 2.2, tw - 4.4, th - 4.4, 1.8);
  bCtx.fill();

  cCtx.save();
  bCtx.save();
  cCtx.beginPath();
  cCtx.roundRect(tx, ty, tw, th, 2.5);
  cCtx.fillStyle = `rgb(${br}, ${bg}, ${bb})`;
  cCtx.fill();
  cCtx.clip();

  bCtx.beginPath();
  bCtx.roundRect(tx + 1.8, ty + 1.8, tw - 3.6, th - 3.6, 1.8);
  bCtx.clip();

  if (typeof cCtx.createRadialGradient === 'function') {
    const cx = tx + tw * (0.46 + ((hash % 5) - 2) * 0.04);
    const cy = ty + th * (0.46 + (((hash >> 2) % 5) - 2) * 0.04);
    const poolGrad = cCtx.createRadialGradient(
      cx,
      cy,
      tw * 0.08,
      tx + tw * 0.5,
      ty + th * 0.5,
      tw * 0.72
    );
    // Subtle translucent white-clay crown lift at center + concave edge glaze pooling (#858F8A-#8C9792)
    poolGrad.addColorStop(
      0,
      `rgba(${clampColorByte(br + 12)}, ${clampColorByte(bg + 11)}, ${clampColorByte(bb + 12)}, 0.34)`
    );
    poolGrad.addColorStop(0.62, `rgba(${br}, ${bg}, ${bb}, 0.06)`);
    poolGrad.addColorStop(
      1,
      (hash & 1) === 0 ? 'rgba(133, 143, 138, 0.34)' : 'rgba(140, 151, 146, 0.34)'
    );
    cCtx.fillStyle = poolGrad;
    cCtx.fillRect(tx, ty, tw, th);
  }

  const phaseX = (hash % 11) * 0.57;
  const phaseY = ((hash >> 4) % 11) * 0.63;
  const step = 12;
  for (let py = ty; py < ty + th; py += step) {
    const ny = (py - ty) / th;
    const edgeDomeY = Math.sin(ny * Math.PI);
    for (let px = tx; px < tx + tw; px += step) {
      const nx = (px - tx) / tw;
      const edgeDomeX = Math.sin(nx * Math.PI);
      const wave =
        Math.sin(nx * Math.PI * 2.3 + phaseX) * 0.52 +
        Math.cos(ny * Math.PI * 2.2 + phaseY) * 0.52 +
        Math.sin((nx + ny) * Math.PI * 3.1 + phaseX * 0.7) * 0.36;
      const hByte = clampColorByte(198 + edgeDomeX * edgeDomeY * 16 + wave * 12);
      bCtx.fillStyle = `rgb(${hByte}, ${hByte}, ${hByte})`;
      bCtx.fillRect(px, py, step + 0.5, step + 0.5);

      const gShift = Math.round(wave * 5);
      cCtx.fillStyle = `rgba(${clampColorByte(br + gShift)}, ${clampColorByte(bg + gShift)}, ${clampColorByte(bb + gShift)}, 0.16)`;
      cCtx.fillRect(px, py, step + 0.5, step + 0.5);
    }
  }

  cCtx.restore();
  bCtx.restore();

  // Thin 2-4px white-clay bisque lip (#B8BEB4) around pressed ceramic tile perimeter
  cCtx.strokeStyle = 'rgba(184, 190, 180, 0.42)';
  cCtx.lineWidth = 2.4;
  cCtx.beginPath();
  cCtx.roundRect(tx + 1.4, ty + 1.4, tw - 2.8, th - 2.8, 2.0);
  cCtx.stroke();
}

/**
 * Claybrook Studio `Fellini Oliva` Gloss Square (SKU `W-FEL-OLI-125125SQ`: `125 × 125 × 8mm`)
 * hand-glazed Moroccan-zellige-style ceramic wall tile PBR texture set (`1024 × 1024` over a
 * `1.00m × 1.00m` world repeat = exact `8 × 8` grid of `0.125m` (`12.5cm`) square tiles with
 * `V4 Extreme` tonal variation across pale celadon/sage-olive, warm moss-olive, smoky grey-green,
 * and deeper herbal olive, undulating high-gloss surface normal, `roughness ~0.14–0.20`, and
 * `3mm` soft putty/warm off-white *Dawn* grout).
 */
export function createFelliniOlivaSquareTileTextures(): {
  readonly colorMap: THREE.CanvasTexture;
  readonly bumpMap: THREE.CanvasTexture;
  readonly normalMap: THREE.CanvasTexture;
  readonly roughnessMap: THREE.Texture;
} {
  return getOrCreateCachedTexture('claybrook-fellini-oliva-square-pbr', () => {
    const size = 1024;
    const cellPx = size / FELLINI_OLIVA_GRID_CELLS;

    const [colorCanvas, bumpCanvas] = getOrCreateCachedCanvasPair(
      'claybrook-fellini-oliva-square',
      size,
      size,
      (cCtx, bCtx) => {
        cCtx.fillStyle = FELLINI_OLIVA_GROUT_COLOR;
        cCtx.fillRect(0, 0, size, size);

        bCtx.fillStyle = 'rgb(110, 110, 110)';
        bCtx.fillRect(0, 0, size, size);

        for (let row = 0; row < FELLINI_OLIVA_GRID_CELLS; row++) {
          for (let col = 0; col < FELLINI_OLIVA_GRID_CELLS; col++) {
            paintFelliniOlivaGlazedTile(cCtx, bCtx, row, col, cellPx);
          }
        }
      }
    );

    const colorMap = createBrowserDataOrCanvasTexture('stone-tile:16', colorCanvas, { colorSpace: THREE.NoColorSpace });
    colorMap.wrapS = THREE.RepeatWrapping;
    colorMap.wrapT = THREE.RepeatWrapping;
    colorMap.colorSpace = THREE.SRGBColorSpace;
    colorMap.anisotropy = 16;

    const bumpMap = createBrowserDataOrCanvasTexture('stone-tile:17', bumpCanvas, { colorSpace: THREE.NoColorSpace });
    bumpMap.wrapS = THREE.RepeatWrapping;
    bumpMap.wrapT = THREE.RepeatWrapping;
    bumpMap.anisotropy = 16;

    const { normalMap, roughnessMap } = derivePbrNormalAndRoughnessMaps(
      'claybrook-fellini-oliva-square',
      bumpCanvas,
      {
        normalStrength: 1.75,
        mortarThreshold: 0.55,
        mortarRoughness: 0.84,
        surfaceRoughnessMin: 0.08,
        surfaceRoughnessMax: 0.12,
        microGrainRoughness: 0.012,
      }
    );
    normalMap.anisotropy = 16;
    roughnessMap.anisotropy = 16;

    return { colorMap, bumpMap, normalMap, roughnessMap };
  });
}

// Sandberg Wallpaper — Mimi Sandstone (SKU: S10267, Kolonin Collection)
// 13.25cm × 13.30cm straight-match alternating checkerboard botanical print
// (rendered as a 2 × 2 = 0.265m × 0.266m seamless 1024 × 1024 PBR repeat)

export const SANDBERG_MIMI_SANDSTONE_REPEAT_U = 0.265;
export const SANDBERG_MIMI_SANDSTONE_REPEAT_V = 0.266;

const MIMI_PAPER_GROUND = '#f1eee7';

function paintMimiCordateLeaf(
  cCtx: CanvasRenderingContext2D,
  bCtx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  angle: number,
  fillHex: string,
  veinHex: string
): void {
  cCtx.save();
  cCtx.translate(cx, cy);
  cCtx.rotate(angle);

  // Subtle Scandinavian surface-print ivory registration halo along upper-left edge
  cCtx.fillStyle = '#faf8f2';
  cCtx.beginPath();
  cCtx.ellipse(-1.6, -1.2, rx * 0.98, ry * 0.94, 0, 0, Math.PI * 2);
  cCtx.fill();

  // Cordate / scalloped wild-violet leaf silhouette
  cCtx.fillStyle = fillHex;
  cCtx.beginPath();
  cCtx.moveTo(0, ry * 0.72);
  cCtx.bezierCurveTo(-rx * 0.55, ry * 1.05, -rx * 1.08, ry * 0.45, -rx * 0.98, -ry * 0.12);
  cCtx.bezierCurveTo(-rx * 0.92, -ry * 0.68, -rx * 0.42, -ry * 1.02, 0, -ry * 0.98);
  cCtx.bezierCurveTo(rx * 0.42, -ry * 1.02, rx * 0.92, -ry * 0.68, rx * 0.98, -ry * 0.12);
  cCtx.bezierCurveTo(rx * 1.08, ry * 0.45, rx * 0.55, ry * 1.05, 0, ry * 0.72);
  cCtx.closePath();
  cCtx.fill();

  // Soft scalloped lobe accents & midrib vein
  cCtx.strokeStyle = veinHex;
  cCtx.lineWidth = 1.35;
  cCtx.lineCap = 'round';
  cCtx.beginPath();
  cCtx.moveTo(0, ry * 0.68);
  cCtx.quadraticCurveTo(rx * 0.05, 0, 0, -ry * 0.76);
  cCtx.stroke();

  for (const [vy0, vx1, vy1] of [
    [ry * 0.28, -rx * 0.56, -ry * 0.02],
    [ry * 0.24, rx * 0.56, -ry * 0.04],
    [-ry * 0.14, -rx * 0.46, -ry * 0.44],
    [-ry * 0.16, rx * 0.46, -ry * 0.46],
  ] as const) {
    cCtx.lineWidth = 0.95;
    cCtx.beginPath();
    cCtx.moveTo(0, vy0);
    cCtx.quadraticCurveTo(vx1 * 0.55, (vy0 + vy1) * 0.5, vx1, vy1);
    cCtx.stroke();
  }
  cCtx.restore();

  bCtx.save();
  bCtx.translate(cx, cy);
  bCtx.rotate(angle);
  bCtx.fillStyle = 'rgb(154, 154, 154)';
  bCtx.beginPath();
  bCtx.ellipse(0, 0, rx * 0.92, ry * 0.9, 0, 0, Math.PI * 2);
  bCtx.fill();
  bCtx.restore();
}

function paintMimiVioletPetal(
  cCtx: CanvasRenderingContext2D,
  bCtx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  angle: number,
  fillHex: string,
  shadeHex: string,
  haloShiftX: number,
  haloShiftY: number
): void {
  cCtx.save();
  cCtx.translate(cx, cy);
  cCtx.rotate(angle);

  // Crisp warm-ivory block-print registration rim (#faf8f2)
  cCtx.fillStyle = '#faf8f2';
  cCtx.beginPath();
  cCtx.ellipse(haloShiftX, haloShiftY, rx * 1.02, ry * 1.02, 0, 0, Math.PI * 2);
  cCtx.fill();

  // Main dusty periwinkle-lavender petal body
  cCtx.fillStyle = fillHex;
  cCtx.beginPath();
  cCtx.moveTo(0, ry * 0.92);
  cCtx.bezierCurveTo(-rx * 0.95, ry * 0.55, -rx * 1.08, -ry * 0.45, -rx * 0.42, -ry * 0.94);
  cCtx.bezierCurveTo(-rx * 0.12, -ry * 1.06, rx * 0.12, -ry * 1.06, rx * 0.42, -ry * 0.94);
  cCtx.bezierCurveTo(rx * 1.08, -ry * 0.45, rx * 0.95, ry * 0.55, 0, ry * 0.92);
  cCtx.closePath();
  cCtx.fill();

  // Soft chalky inner-petal wash toward throat
  cCtx.fillStyle = shadeHex;
  cCtx.globalAlpha = 0.55;
  cCtx.beginPath();
  cCtx.ellipse(0, ry * 0.28, rx * 0.58, ry * 0.52, 0, 0, Math.PI * 2);
  cCtx.fill();
  cCtx.globalAlpha = 1.0;

  cCtx.restore();

  bCtx.save();
  bCtx.translate(cx, cy);
  bCtx.rotate(angle);
  bCtx.fillStyle = 'rgb(156, 156, 156)';
  bCtx.beginPath();
  bCtx.ellipse(0, 0, rx * 0.9, ry * 0.9, 0, 0, Math.PI * 2);
  bCtx.fill();
  bCtx.restore();
}

function paintMimiWildVioletSprig(
  cCtx: CanvasRenderingContext2D,
  bCtx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  mirrorX: 1 | -1,
  variant: number
): void {
  const jitterRot = ((variant % 3) - 1) * 0.018 * mirrorX;

  cCtx.save();
  cCtx.translate(cx, cy);
  cCtx.rotate(jitterRot);
  cCtx.scale(mirrorX, 1);

  bCtx.save();
  bCtx.translate(cx, cy);
  bCtx.rotate(jitterRot);
  bCtx.scale(mirrorX, 1);

  // Subtle cream print registration under stems
  cCtx.strokeStyle = '#faf8f2';
  cCtx.lineWidth = 3.6;
  cCtx.lineCap = 'round';
  cCtx.beginPath();
  cCtx.moveTo(-9.5, 70);
  cCtx.bezierCurveTo(-11, 44, -6, 16, 4, -36);
  cCtx.stroke();

  // Slender curved sage-olive flower pedicel & twin leaf petioles (~148px total sprig height = ~3.83cm)
  cCtx.strokeStyle = '#a8ab9a';
  cCtx.lineWidth = 2.35;
  cCtx.lineCap = 'round';
  cCtx.beginPath();
  cCtx.moveTo(-8, 71);
  cCtx.bezierCurveTo(-10, 44, -5, 14, 5, -37);
  cCtx.stroke();

  cCtx.strokeStyle = '#aeb1a0';
  cCtx.lineWidth = 2.05;
  cCtx.beginPath();
  cCtx.moveTo(4, 65);
  cCtx.bezierCurveTo(0, 46, -6, 26, -18, 9);
  cCtx.stroke();

  cCtx.beginPath();
  cCtx.moveTo(-5, 36);
  cCtx.bezierCurveTo(2, 28, 10, 22, 18, 22);
  cCtx.stroke();

  bCtx.strokeStyle = 'rgb(152, 152, 152)';
  bCtx.lineWidth = 2.4;
  bCtx.lineCap = 'round';
  bCtx.beginPath();
  bCtx.moveTo(-8, 71);
  bCtx.bezierCurveTo(-10, 44, -5, 14, 5, -37);
  bCtx.stroke();

  // Two lobed/cordate sage-olive Viola leaves (#b3b6a5 / #aeb1a0) flanking the stem
  paintMimiCordateLeaf(cCtx, bCtx, -21, 7, 15.5, 13.5, -0.58, '#b3b6a5', '#9da18f');
  paintMimiCordateLeaf(cCtx, bCtx, 18, 23, 19.5, 16.5, 0.46, '#b5b8a7', '#9ea290');

  // Slender arched upper pedicel & dainty half-open nodding violet bud above main flower
  cCtx.strokeStyle = '#aeb1a0';
  cCtx.lineWidth = 1.75;
  cCtx.beginPath();
  cCtx.moveTo(-4, 4);
  cCtx.bezierCurveTo(-12, -26, -11, -54, -2, -64);
  cCtx.stroke();

  cCtx.fillStyle = '#faf8f2';
  cCtx.beginPath();
  cCtx.ellipse(0, -64, 9.2, 6.8, 0.22, 0, Math.PI * 2);
  cCtx.fill();

  cCtx.fillStyle = '#a9abbb';
  cCtx.beginPath();
  cCtx.ellipse(2, -66, 6.8, 4.0, -0.32, 0, Math.PI * 2);
  cCtx.fill();

  cCtx.fillStyle = '#9fa1b2';
  cCtx.beginPath();
  cCtx.ellipse(3, -62, 6.0, 3.6, 0.26, 0, Math.PI * 2);
  cCtx.fill();

  cCtx.fillStyle = '#a8ab9a';
  cCtx.beginPath();
  cCtx.ellipse(-4, -63, 4.2, 2.3, -0.45, 0, Math.PI * 2);
  cCtx.fill();

  // Tiny sage calyx sepal behind nodding violet blossom
  cCtx.fillStyle = '#a8ab9a';
  cCtx.beginPath();
  cCtx.ellipse(-2, -35, 4.5, 2.6, -0.4, 0, Math.PI * 2);
  cCtx.fill();

  // 5-petalled dusty periwinkle-lavender wild-violet flower (#a4a6b8 / #a9acbc / #9ea0b0)
  const fx = 3;
  const fy = -42;
  // Two rounded upper banner petals
  paintMimiVioletPetal(cCtx, bCtx, fx - 7.5, fy - 14.5, 11.5, 14.5, -0.30, '#a6a8ba', '#9ca0b0', -1.4, -1.3);
  paintMimiVioletPetal(cCtx, bCtx, fx + 8.5, fy - 14.0, 12.0, 14.8, 0.26, '#a9acbc', '#9ea0b0', 1.2, -1.4);
  // Two spreading lateral wing petals with soft blush-mauve inner wash
  paintMimiVioletPetal(cCtx, bCtx, fx - 14.5, fy + 1.5, 13.5, 9.8, -1.18, '#a4a6b8', '#dad3d5', -1.5, 0.4);
  paintMimiVioletPetal(cCtx, bCtx, fx + 15.0, fy + 2.0, 13.8, 10.0, 1.15, '#a7a9bb', '#dad3d5', 1.5, 0.4);
  // Lower rounded lip petal
  paintMimiVioletPetal(cCtx, bCtx, fx + 0.5, fy + 14.0, 11.2, 12.5, 3.10, '#a9acbc', '#989bad', -0.8, 1.4);

  // Crisp ivory-white (#faf8f2) radiating throat streaks & warm honey-ochre (#e7e0d5) eye
  cCtx.strokeStyle = '#faf8f2';
  cCtx.lineCap = 'round';
  for (const [dx, dy, lw] of [
    [-7.5, -2.5, 1.7],
    [8.0, -2.0, 1.7],
    [-4.5, 5.5, 1.6],
    [0.5, 7.5, 1.9],
    [5.2, 5.2, 1.6],
  ] as const) {
    cCtx.lineWidth = lw;
    cCtx.beginPath();
    cCtx.moveTo(fx, fy + 1.0);
    cCtx.lineTo(fx + dx, fy + dy);
    cCtx.stroke();
  }

  // Soft blush-ivory central throat beard & warm honey throat dot
  cCtx.fillStyle = '#faf8f2';
  cCtx.beginPath();
  cCtx.arc(fx + 0.3, fy + 1.2, 3.6, 0, Math.PI * 2);
  cCtx.fill();

  cCtx.fillStyle = '#e7e0d5';
  cCtx.beginPath();
  cCtx.arc(fx + 0.4, fy + 0.8, 2.3, 0, Math.PI * 2);
  cCtx.fill();

  cCtx.fillStyle = '#d5cab8';
  cCtx.beginPath();
  cCtx.arc(fx + 0.4, fy + 0.4, 1.15, 0, Math.PI * 2);
  cCtx.fill();

  cCtx.restore();
  bCtx.restore();
}

function paintMimiCrossFloret(
  cCtx: CanvasRenderingContext2D,
  bCtx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  variant: number
): void {
  const angleOffset = ((variant % 3) - 1) * 0.035;
  // ~23px total width in 1024px (0.265m) = ~6.0mm dainty 4-arm '×' periwinkle floret
  const armReach = 7.4;
  const petalRx = 3.6;
  const petalRy = 6.2;

  cCtx.save();
  cCtx.translate(cx, cy);
  cCtx.rotate(angleOffset);

  // Subtle crisp ivory block-print registration halo (#faf8f2)
  cCtx.fillStyle = '#faf8f2';
  for (let a = 0; a < 4; a++) {
    const theta = Math.PI * 0.25 + a * Math.PI * 0.5;
    cCtx.save();
    cCtx.rotate(theta);
    cCtx.beginPath();
    cCtx.ellipse(-0.9, -armReach * 0.58, petalRx * 1.04, petalRy * 1.04, 0, 0, Math.PI * 2);
    cCtx.fill();
    cCtx.restore();
  }

  // Four diagonal periwinkle-lavender petals forming '×' cross (#a4a6b8 / #a9acbc)
  for (let a = 0; a < 4; a++) {
    const theta = Math.PI * 0.25 + a * Math.PI * 0.5;
    cCtx.save();
    cCtx.rotate(theta);
    cCtx.fillStyle = a % 2 === 0 ? '#a4a6b8' : '#abaebd';
    cCtx.beginPath();
    cCtx.ellipse(0, -armReach * 0.56, petalRx, petalRy, 0, 0, Math.PI * 2);
    cCtx.fill();
    cCtx.restore();
  }

  // Soft deeper periwinkle & ivory eye at intersection
  cCtx.fillStyle = '#989bad';
  cCtx.beginPath();
  cCtx.arc(0, 0, 2.3, 0, Math.PI * 2);
  cCtx.fill();

  cCtx.fillStyle = '#faf8f2';
  cCtx.beginPath();
  cCtx.arc(-0.3, -0.3, 1.05, 0, Math.PI * 2);
  cCtx.fill();

  cCtx.restore();

  bCtx.save();
  bCtx.translate(cx, cy);
  bCtx.fillStyle = 'rgb(154, 154, 154)';
  bCtx.beginPath();
  bCtx.arc(0, 0, 9.5, 0, Math.PI * 2);
  bCtx.fill();
  bCtx.restore();
}

/**
 * Sandberg Wallpaper `Mimi Sandstone` (SKU `S10267`, Kolonin Collection) seamless `1024 × 1024`
 * PBR texture set covering `0.265m × 0.266m` world space (`2 × 2` of the `13.25cm × 13.30cm`
 * straight-match repeat on `#F1EEE7` warm sandstone-ecru non-woven paper ground, alternating
 * horizontally-mirrored wild-violet sprigs with tiny `6mm` 4-arm periwinkle `'×'` cross florets).
 */
export function createSandbergMimiSandstoneWallpaperTextures(): {
  readonly colorMap: THREE.CanvasTexture;
  readonly bumpMap: THREE.CanvasTexture;
  readonly normalMap: THREE.CanvasTexture;
  readonly roughnessMap: THREE.Texture;
} {
  return getOrCreateCachedTexture('sandberg-mimi-sandstone-pbr', () => {
    const size = 1024;
    const cellW = size / 2; // 512px = 13.25cm horizontal repeat
    const cellH = size / 2; // 512px = 13.30cm vertical repeat

    const [colorCanvas, bumpCanvas] = getOrCreateCachedCanvasPair(
      'sandberg-mimi-sandstone',
      size,
      size,
      (cCtx, bCtx) => {
        // Warm sandstone-ecru matte non-woven paper ground (#F1EEE7 = rgb(241, 238, 231), ~93% open ground)
        cCtx.fillStyle = MIMI_PAPER_GROUND;
        cCtx.fillRect(0, 0, size, size);

        bCtx.fillStyle = 'rgb(142, 142, 142)';
        bCtx.fillRect(0, 0, size, size);

        // Subtle matte non-woven Scandinavian paper fiber weave (tileable across 1024x1024)
        for (let i = 0; i < 420; i++) {
          const fx = (i * 173 + 29) % size;
          const fy = (i * 257 + 61) % size;
          const fw = 10 + (i % 5) * 6;
          const fh = 2 + (i % 3);
          const warmShift = i % 2 === 0 ? 2 : -2;
          cCtx.fillStyle = `rgba(${241 + warmShift}, ${238 + warmShift}, ${231 + warmShift}, 0.26)`;
          cCtx.fillRect(fx, fy, fw, fh);
          if (fx + fw > size) cCtx.fillRect(fx - size, fy, fw, fh);

          const bVal = 142 + ((i % 5) - 2) * 3;
          bCtx.fillStyle = `rgb(${bVal}, ${bVal}, ${bVal})`;
          bCtx.fillRect(fx, fy, fw, fh);
          if (fx + fw > size) bCtx.fillRect(fx - size, fy, fw, fh);
        }

        // Alternating checkerboard grid inside each 13.25 × 13.30cm (512 × 512px) repeat:
        //    - Even rows (v = 0.25 of cell): Wild-violet sprig (+1) at u = 0.25, '×' cross floret at u = 0.75
        //    - Odd rows  (v = 0.75 of cell): '×' cross floret at u = 0.25, Mirrored wild-violet sprig (-1) at u = 0.75
        for (let gy = 0; gy < 2; gy++) {
          for (let gx = 0; gx < 2; gx++) {
            const ox = gx * cellW;
            const oy = gy * cellH;
            const seed = gy * 2 + gx;

            // Even row: upright/right-nodding wild-violet sprig + midway '×' cross floret
            paintMimiWildVioletSprig(cCtx, bCtx, ox + cellW * 0.25, oy + cellH * 0.25, 1, seed);
            paintMimiCrossFloret(cCtx, bCtx, ox + cellW * 0.75, oy + cellH * 0.25, seed);

            // Odd row: midway '×' cross floret + horizontally mirrored wild-violet sprig
            paintMimiCrossFloret(cCtx, bCtx, ox + cellW * 0.25, oy + cellH * 0.75, seed + 3);
            paintMimiWildVioletSprig(cCtx, bCtx, ox + cellW * 0.75, oy + cellH * 0.75, -1, seed + 1);
          }
        }
      }
    );

    const colorMap = createBrowserDataOrCanvasTexture('stone-tile:18', colorCanvas, { colorSpace: THREE.NoColorSpace });
    colorMap.wrapS = THREE.RepeatWrapping;
    colorMap.wrapT = THREE.RepeatWrapping;
    colorMap.colorSpace = THREE.SRGBColorSpace;
    colorMap.anisotropy = 16;

    const bumpMap = createBrowserDataOrCanvasTexture('stone-tile:19', bumpCanvas, { colorSpace: THREE.NoColorSpace });
    bumpMap.wrapS = THREE.RepeatWrapping;
    bumpMap.wrapT = THREE.RepeatWrapping;
    bumpMap.anisotropy = 16;

    const { normalMap, roughnessMap } = derivePbrNormalAndRoughnessMaps(
      'sandberg-mimi-sandstone',
      bumpCanvas,
      {
        normalStrength: 0.55,
        mortarThreshold: 0.05,
        mortarRoughness: 0.82,
        surfaceRoughnessMin: 0.75,
        surfaceRoughnessMax: 0.81,
        microGrainRoughness: 0.02,
      }
    );
    normalMap.anisotropy = 16;
    roughnessMap.anisotropy = 16;

    return { colorMap, bumpMap, normalMap, roughnessMap };
  });
}

/**
 * Creates a ready-to-use `THREE.MeshStandardMaterial` for Sandberg `Mimi Sandstone` (`S10267`)
 * matte non-woven botanical wallpaper (`roughness: 0.78`, `metalness: 0.0`, world repeat `0.265m × 0.266m`).
 */
export function createSandbergMimiSandstoneWallpaperMaterial(): THREE.MeshStandardMaterial {
  const maps = createSandbergMimiSandstoneWallpaperTextures();
  return new THREE.MeshStandardMaterial({
    name: 'sandbergMimiSandstoneS10267',
    map: maps.colorMap,
    normalMap: maps.normalMap,
    normalScale: new THREE.Vector2(0.16, 0.16),
    roughnessMap: maps.roughnessMap,
    color: 0xffffff,
    roughness: 0.78,
    metalness: 0.0,
  });
}
