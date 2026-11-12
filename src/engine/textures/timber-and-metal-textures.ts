import * as THREE from 'three';
import {
  getOrCreateCachedCanvas,
  getOrCreateCachedCanvasPair,
  getOrCreateCachedTexture,
} from './texture-registry.ts';
import { createBrowserDataOrCanvasTexture } from './texture-registry.ts';

export function createBraidedCableTexture(): THREE.CanvasTexture {
  const canvas = getOrCreateCachedCanvas('braided-cable', 64, 128, (ctx) => {
    // Charcoal-black woven textile base
    ctx.fillStyle = '#181a1d';
    ctx.fillRect(0, 0, 64, 128);

    // Interlocking diagonal off-white & black braided fabric strands
    ctx.strokeStyle = '#ece9e2';
    ctx.lineWidth = 4;
    for (let y = -64; y < 192; y += 12) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(64, y + 48);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(64, y + 6);
      ctx.lineTo(0, y + 54);
      ctx.stroke();
    }

    // Re-weave black cross-over checks for authentic braided flex look
    ctx.fillStyle = '#181a1d';
    for (let y = 0; y < 128; y += 12) {
      for (let x = 0; x < 64; x += 16) {
        const offset = (y / 12) % 2 === 0 ? 0 : 8;
        ctx.fillRect(x + offset, y, 5, 5);
      }
    }
  });

  const tex = createBrowserDataOrCanvasTexture('timber-metal:1', canvas, { colorSpace: THREE.NoColorSpace });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 18);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createDriftwoodTexture(): THREE.CanvasTexture {
  const canvas = getOrCreateCachedCanvas('driftwood', 256, 256, (ctx) => {
    // Sun-bleached, washed-out silver-taupe driftwood base
    ctx.fillStyle = '#aba193';
    ctx.fillRect(0, 0, 256, 256);

    // Weathered linear grain streaks in pale ash, chalky grey, and muted taupe
    for (let y = 0; y < 256; y += 2) {
      const wave = Math.sin(y * 0.09) * 6 + Math.cos(y * 0.23) * 3;
      const tone = 166 + Math.round(wave) + ((y * 13) % 14) - 7;
      ctx.fillStyle = `rgb(${tone + 5}, ${tone + 1}, ${tone - 6})`;
      ctx.fillRect(0, y, 256, 2);
    }

    // Chalky sun-bleached mineral pores along the wood grain
    ctx.strokeStyle = 'rgba(226, 220, 210, 0.32)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 42; i++) {
      const y = (i * 19) % 256;
      const x0 = (i * 37) % 180;
      const len = 35 + ((i * 29) % 65);
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + len, y + ((i % 3) - 1));
      ctx.stroke();
    }
  });

  const tex = createBrowserDataOrCanvasTexture('timber-metal:2', canvas, { colorSpace: THREE.NoColorSpace });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createBrushedStainlessTexture(): THREE.CanvasTexture {
  return getOrCreateCachedTexture('brushed-stainless', () => {
    const canvas = getOrCreateCachedCanvas('brushed-stainless', 256, 256, (ctx) => {
      // Warm-neutral satin stainless steel base gradient (zero blue tint)
      const baseGrad = ctx.createLinearGradient(0, 0, 256, 256);
      baseGrad.addColorStop(0.0, '#a8a59e');
      baseGrad.addColorStop(0.28, '#c8c5be');
      baseGrad.addColorStop(0.5, '#9e9b95');
      baseGrad.addColorStop(0.76, '#d2cfc8');
      baseGrad.addColorStop(1.0, '#aba8a1');
      ctx.fillStyle = baseGrad;
      ctx.fillRect(0, 0, 256, 256);

      // Dense, crisp horizontal brushed stainless steel grain lines
      for (let y = 0; y < 256; y++) {
        const hash = (y * 29 + ((y * y) % 17)) % 16;
        const isLight = hash < 8;
        const alpha = 0.04 + (hash % 7) * 0.022;
        ctx.fillStyle = isLight
          ? `rgba(248, 245, 238, ${alpha})`
          : `rgba(58, 56, 52, ${alpha})`;
        ctx.fillRect(0, y, 256, 1);

        // Interrupted fine abrasive brush streaks along each horizontal pass
        for (let s = 0; s < 5; s++) {
          const sx = ((y * 43 + s * 67) % 220);
          const sw = 18 + ((y * 19 + s * 31) % 36);
          ctx.fillStyle =
            (y + s) % 2 === 0
              ? 'rgba(255, 252, 246, 0.11)'
              : 'rgba(46, 44, 41, 0.10)';
          ctx.fillRect(sx, y, sw, 1);
        }
      }
    });

    const tex = createBrowserDataOrCanvasTexture('timber-metal:3', canvas, { colorSpace: THREE.NoColorSpace });
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
}

export function createBrushedStainlessBumpTexture(): THREE.CanvasTexture {
  return getOrCreateCachedTexture('brushed-stainless:bump', () => {
    const base = createBrushedStainlessTexture();
    const bump = base.clone();
    bump.source = base.source;
    bump.colorSpace = THREE.NoColorSpace;
    bump.needsUpdate = true;
    return bump;
  });
}

export function createPolishedChromeTexture(): THREE.CanvasTexture {
  return getOrCreateCachedTexture('polished-chrome', () => {
    const canvas = getOrCreateCachedCanvas('polished-chrome', 256, 256, (ctx) => {
      // Smooth, high-luster mirror chrome gradient (NO brushed lines, NO blue tint)
      const mirrorGrad = ctx.createLinearGradient(0, 0, 256, 256);
      mirrorGrad.addColorStop(0.0, '#62605c');
      mirrorGrad.addColorStop(0.18, '#b8b5ae');
      mirrorGrad.addColorStop(0.32, '#f6f3ec');
      mirrorGrad.addColorStop(0.45, '#54524e');
      mirrorGrad.addColorStop(0.62, '#c8c5be');
      mirrorGrad.addColorStop(0.78, '#faf7f0');
      mirrorGrad.addColorStop(0.9, '#8c8983');
      mirrorGrad.addColorStop(1.0, '#5c5a56');
      ctx.fillStyle = mirrorGrad;
      ctx.fillRect(0, 0, 256, 256);

      // Soft secondary cross-reflection band for curved & flat mirror surfaces
      const crossGrad = ctx.createLinearGradient(0, 256, 256, 0);
      crossGrad.addColorStop(0.0, 'rgba(38, 36, 34, 0.18)');
      crossGrad.addColorStop(0.48, 'rgba(255, 252, 245, 0.24)');
      crossGrad.addColorStop(0.55, 'rgba(32, 30, 28, 0.20)');
      crossGrad.addColorStop(1.0, 'rgba(245, 242, 235, 0.15)');
      ctx.fillStyle = crossGrad;
      ctx.fillRect(0, 0, 256, 256);
    });

    const tex = createBrowserDataOrCanvasTexture('timber-metal:4', canvas, { colorSpace: THREE.NoColorSpace });
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
}

export function createEngineeredOakFloorTextures(): {
  readonly colorMap: THREE.CanvasTexture;
  readonly bumpMap: THREE.CanvasTexture;
} {
  return getOrCreateCachedTexture('engineered-oak-floor', () => {
    const size = 1024;
    const [colorCanvas, bumpCanvas] = getOrCreateCachedCanvasPair(
      'engineered-oak-floor',
      size,
      size,
      (cCtx, bCtx) => {
      // Natural raw-effect matte-oiled European oak palette (matching reference photo media_1791557597873_0dec7400.jpg):
      // Muted warm sandy-taupe / biscuit oak without orange Danish-oil saturation
      const oakPlankPalette: ReadonlyArray<readonly [number, number, number]> = [
        [184, 157, 126], // Natural raw-oiled European oak (#b89d7e)
        [176, 149, 118], // Warm muted taupe-biscuit oak (#b09576)
        [190, 163, 132], // Pale sandy heartwood oak (#bea384)
        [170, 143, 112], // Medium weathered taupe oak (#aa8f70)
        [194, 168, 137], // Light sunlit natural European oak (#c2a889)
        [180, 153, 122], // Balanced matte-oiled farmhouse oak (#b4997a)
        [173, 146, 115], // Muted warm umber-taupe oak (#ad9273)
        [187, 160, 129], // Soft biscuit-oak plank (#bba081)
      ];

      const clampByte = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));

      // World tile = 4.40m (X) x 1.76m (Z):
      // - 8 courses of 128px = 220mm (0.22m) wide planks (8 * 0.22m = 1.76m)
      // - Full-length plank = 512px = 2200mm (2.20m) long (2 * 2.20m = 4.40m)
      // - Packs include ~20% cut lengths: 6 of 8 rows have two full 2200mm (512px) planks;
      //   2 of 8 rows (rows 2 & 6) split one 2200mm plank into two cut lengths (4 cut boards / 18 total = 22%).
      const numRows = 8;
      const rowH = size / numRows; // 128px = 220mm
      const rowJointLayouts: ReadonlyArray<ReadonlyArray<number>> = [
        [0, 512, size],               // Row 0: two full 2200mm planks (joints at 0m, 2.20m)
        [0, 320, 832, size],          // Row 1: two full 2200mm planks staggered by 1.375m
        [0, 144, 451, 656, size],     // Row 2: one full 2200mm plank + two cut lengths (1320mm + 880mm)
        [0, 416, 928, size],          // Row 3: two full 2200mm planks staggered by 1.79m
        [0, 192, 704, size],          // Row 4: two full 2200mm planks staggered by 0.825m
        [0, 464, 976, size],          // Row 5: two full 2200mm planks staggered by 1.99m
        [0, 240, 470, 752, size],     // Row 6: one full 2200mm plank + two cut lengths (990mm + 1210mm)
        [0, 96, 608, size],           // Row 7: two full 2200mm planks staggered by 0.41m
      ];

      for (let row = 0; row < numRows; row++) {
        const y0 = row * rowH;
        const joints = rowJointLayouts[row] ?? [0, 512, size];

        for (let seg = 0; seg < joints.length - 1; seg++) {
          const xStart = joints[seg] ?? 0;
          const xEnd = joints[seg + 1] ?? size;
          const segW = xEnd - xStart;
          if (segW <= 1) continue;

          // Ensure left-edge and right-edge wrapped segments of the same plank share identical identity
          const wrapsSeam = joints[1] !== 512;
          const plankId = wrapsSeam && seg === joints.length - 2 ? 0 : seg;
          const seed = row * 37 + plankId * 23 + 13;
          const [baseR, baseG, baseB] =
            oakPlankPalette[Math.abs(seed) % oakPlankPalette.length] ?? [168, 129, 90];

          // 1. Base plank fill + handcrafted undulated surface shading across plank width & length
          cCtx.fillStyle = `rgb(${baseR}, ${baseG}, ${baseB})`;
          cCtx.fillRect(xStart, y0, segW, rowH);

          const bumpBase = 198 + (((seed * 13) % 10) - 5);
          bCtx.fillStyle = `rgb(${bumpBase}, ${bumpBase}, ${bumpBase})`;
          bCtx.fillRect(xStart, y0, segW, rowH);

          // Soft cross-plank crown & sapwood/heartwood tonal gradient
          const plankGrad = cCtx.createLinearGradient(0, y0, 0, y0 + rowH);
          const edgeShift = (seed & 1) === 0 ? 5 : -5;
          const centerShift = -Math.round(edgeShift * 0.55);
          plankGrad.addColorStop(
            0,
            `rgba(${clampByte(baseR + edgeShift)}, ${clampByte(baseG + edgeShift)}, ${clampByte(baseB + Math.round(edgeShift * 0.85))}, 0.32)`
          );
          plankGrad.addColorStop(
            0.5,
            `rgba(${clampByte(baseR + centerShift)}, ${clampByte(baseG + centerShift)}, ${clampByte(baseB + Math.round(centerShift * 0.85))}, 0.24)`
          );
          plankGrad.addColorStop(
            1,
            `rgba(${clampByte(baseR - edgeShift)}, ${clampByte(baseG - edgeShift)}, ${clampByte(baseB - Math.round(edgeShift * 0.85))}, 0.32)`
          );
          cCtx.fillStyle = plankGrad;
          cCtx.fillRect(xStart, y0, segW, rowH);

          // 2. Sparse, natural knots: only ~4 subtle knots across the entire 18-plank (7.74 m²) tile!
          interface KnotSpec {
            readonly kx: number;
            readonly ky: number;
            readonly rx: number;
            readonly ry: number;
            readonly angle: number;
          }
          const knots: KnotSpec[] = [];
          const hasSingleKnot =
            segW >= 260 &&
            ((row === 1 && seg === 1) ||
              (row === 3 && seg === 1) ||
              (row === 5 && seg === 1) ||
              (row === 7 && seg === 1));
          if (hasSingleKnot) {
            const kHash = seed * 31 + 17;
            const marginX = 72;
            const usableW = Math.max(32, segW - marginX * 2);
            const kx = xStart + marginX + Math.floor((((kHash * 73) & 0x7fffffff) % usableW));
            const ky = y0 + 28 + Math.floor((((kHash * 41) & 0x7fffffff) % (rowH - 56)));
            const rx = 6.5 + ((kHash * 19) % 4); // Subtle 6.5..9.5px knot
            const ry = 3.2 + ((kHash * 11) % 2.2); // 3.2..5.0px
            const angle = (((kHash % 7) - 3) * 0.035);
            knots.push({ kx, ky, rx, ry, angle });
          }

          // 3. Heavily Brushed longitudinal woodgrain fibers & cathedral heartwood arches
          const cathedralCenterY = y0 + rowH * (0.32 + ((seed % 5) * 0.09));
          const numFibers = 76;
          const stepX = 16;

          for (let f = 0; f < numFibers; f++) {
            const t = (f + 0.5) / numFibers;
            const baseY = y0 + 2 + t * (rowH - 4);
            const distFromCathedral = (baseY - cathedralCenterY) / (rowH * 0.5);

            // Alternate between deep brushed earlywood pore grooves and raised oiled latewood ridges
            const fiberWave =
              Math.sin(f * 0.85 + seed * 0.4) * 6.0 +
              Math.cos(f * 1.9 + seed * 1.1) * 4.2 +
              Math.sin(distFromCathedral * Math.PI * 2.0) * 6.5;
            const isDarkPore = fiberWave < -2.5;
            const isLightRidge = fiberWave > 4.5;

            const dR = Math.round(fiberWave * 1.15 - (isDarkPore ? 6 : 0) + (isLightRidge ? 4 : 0));
            const dG = Math.round(fiberWave * 1.2 - (isDarkPore ? 7 : 0) + (isLightRidge ? 4 : 0));
            const dB = Math.round(fiberWave * 1.05 - (isDarkPore ? 6 : 0) + (isLightRidge ? 3 : 0));

            cCtx.strokeStyle = `rgba(${clampByte(baseR + dR)}, ${clampByte(baseG + dG)}, ${clampByte(baseB + dB)}, ${isDarkPore ? 0.58 : isLightRidge ? 0.44 : 0.32})`;
            cCtx.lineWidth = isDarkPore ? 1.45 : 1.15;

            const bVal = clampByte(
              bumpBase + (isDarkPore ? -36 : isLightRidge ? 22 : Math.round(fiberWave * 2.0))
            );
            bCtx.strokeStyle = `rgb(${bVal}, ${bVal}, ${bVal})`;
            bCtx.lineWidth = isDarkPore ? 1.45 : 1.1;

            cCtx.beginPath();
            bCtx.beginPath();
            for (let px = xStart; px <= xEnd; px += stepX) {
              const worldX = wrapsSeam && seg === joints.length - 2 ? px - size : px;
              // Undulated cathedral arch wave along the 2200mm plank length
              let gy =
                baseY +
                Math.sin(worldX * 0.0085 + seed * 0.7) * distFromCathedral * 6.0 +
                Math.cos(worldX * 0.021 + f * 0.18 + seed) * 1.5;

              // Deflect fiber smoothly around any knot in this plank
              for (const knot of knots) {
                const dx = px - knot.kx;
                const dy = baseY - knot.ky;
                const sigmaX = knot.rx * 3.0;
                const sigmaY = knot.ry * 3.4;
                const gauss = Math.exp(-(dx * dx) / (2 * sigmaX * sigmaX) - (dy * dy) / (2 * sigmaY * sigmaY));
                if (gauss > 0.01) {
                  const dir = dy >= 0 ? 1 : -1;
                  gy += dir * gauss * (knot.ry * 1.25);
                }
              }

              gy = Math.max(y0 + 1.5, Math.min(y0 + rowH - 1.5, gy));
              if (px === xStart) {
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

          // 4. Render subtle Heritage knot (when present on this plank)
          for (const knot of knots) {
            cCtx.save();
            cCtx.translate(knot.kx, knot.ky);
            cCtx.rotate(knot.angle);

            // Soft warm amber-brown grain halo
            const haloGrad = cCtx.createRadialGradient(
              0,
              0,
              knot.ry * 0.25,
              0,
              0,
              knot.rx * 1.45
            );
            haloGrad.addColorStop(0, 'rgba(68, 45, 25, 0.72)');
            haloGrad.addColorStop(0.45, 'rgba(102, 70, 42, 0.45)');
            haloGrad.addColorStop(0.8, `rgba(${clampByte(baseR - 20)}, ${clampByte(baseG - 22)}, ${clampByte(baseB - 18)}, 0.22)`);
            haloGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            cCtx.fillStyle = haloGrad;
            cCtx.beginPath();
            cCtx.ellipse(0, 0, knot.rx * 1.45, knot.ry * 1.5, 0, 0, Math.PI * 2);
            cCtx.fill();

            // Dark filled knot core
            cCtx.fillStyle = '#422b19';
            cCtx.beginPath();
            cCtx.ellipse(0, 0, knot.rx * 0.62, knot.ry * 0.65, 0, 0, Math.PI * 2);
            cCtx.fill();

            cCtx.fillStyle = '#2d1c0f';
            cCtx.beginPath();
            cCtx.ellipse(0, 0, knot.rx * 0.34, knot.ry * 0.36, 0, 0, Math.PI * 2);
            cCtx.fill();
            cCtx.restore();

            // Subtle knot bump relief
            bCtx.save();
            bCtx.translate(knot.kx, knot.ky);
            bCtx.rotate(knot.angle);
            bCtx.fillStyle = '#686868';
            bCtx.beginPath();
            bCtx.ellipse(0, 0, knot.rx * 0.6, knot.ry * 0.62, 0, 0, Math.PI * 2);
            bCtx.fill();
            bCtx.restore();
          }

          // 5. Balanced bevelled header end-joint V-groove at xStart (if > 0)
          if (xStart > 0) {
            cCtx.fillStyle = 'rgba(92, 62, 36, 0.36)';
            cCtx.fillRect(xStart - 1.1, y0, 2.2, rowH);
            cCtx.fillStyle = 'rgba(66, 43, 24, 0.82)';
            cCtx.fillRect(xStart - 0.7, y0, 1.4, rowH);
            cCtx.fillStyle = 'rgba(222, 188, 148, 0.28)';
            cCtx.fillRect(xStart + 0.8, y0, 1.1, rowH);

            bCtx.fillStyle = '#484848';
            bCtx.fillRect(xStart - 0.8, y0, 1.6, rowH);
          }
        }

        // 6. Balanced bevelled long-edge V-groove between wide 220mm planks
        cCtx.fillStyle = 'rgba(92, 62, 36, 0.4)';
        cCtx.fillRect(0, y0, size, 2.6);
        cCtx.fillStyle = 'rgba(64, 42, 23, 0.86)';
        cCtx.fillRect(0, y0, size, 1.75);
        cCtx.fillStyle = 'rgba(224, 190, 150, 0.3)';
        cCtx.fillRect(0, y0 + 2.0, size, 1.3);

        bCtx.fillStyle = '#404040';
        bCtx.fillRect(0, y0, size, 1.9);
      }
      }
    );

    const colorMap = createBrowserDataOrCanvasTexture('timber-metal:5', colorCanvas, { colorSpace: THREE.NoColorSpace });
    colorMap.wrapS = THREE.RepeatWrapping;
    colorMap.wrapT = THREE.RepeatWrapping;
    colorMap.colorSpace = THREE.SRGBColorSpace;
    colorMap.anisotropy = 8;

    const bumpMap = createBrowserDataOrCanvasTexture('timber-metal:6', bumpCanvas, { colorSpace: THREE.NoColorSpace });
    bumpMap.wrapS = THREE.RepeatWrapping;
    bumpMap.wrapT = THREE.RepeatWrapping;
    bumpMap.anisotropy = 8;

    return { colorMap, bumpMap };
  });
}

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

        // Pale, desaturated natural matte European oak base (matching skirting/joinery photo media_1791557597873_0dec7400.jpg)
        const baseR = 192;
        const baseG = 167;
        const baseB = 138;
        cCtx.fillStyle = `rgb(${baseR}, ${baseG}, ${baseB})`;
        cCtx.fillRect(0, 0, size, size);

        bCtx.fillStyle = 'rgb(196, 196, 196)';
        bCtx.fillRect(0, 0, size, size);

        // Subtle cross-board tonal variation (rift/quarter-sawn European white oak)
        const bgGrad = cCtx.createLinearGradient(0, 0, 0, size);
        bgGrad.addColorStop(0, 'rgba(202, 178, 149, 0.35)');
        bgGrad.addColorStop(0.35, 'rgba(186, 161, 132, 0.25)');
        bgGrad.addColorStop(0.7, 'rgba(198, 174, 145, 0.30)');
        bgGrad.addColorStop(1, 'rgba(202, 178, 149, 0.35)');
        cCtx.fillStyle = bgGrad;
        cCtx.fillRect(0, 0, size, size);

        // Fine longitudinal open-pore European oak fibers
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

          const dR = Math.round(wave * 0.95 - (isOpenPore ? 9 : 0) + (isSilkyRay ? 5 : 0));
          const dG = Math.round(wave * 0.95 - (isOpenPore ? 9 : 0) + (isSilkyRay ? 5 : 0));
          const dB = Math.round(wave * 0.85 - (isOpenPore ? 8 : 0) + (isSilkyRay ? 4 : 0));

          cCtx.strokeStyle = `rgba(${clampByte(baseR + dR)}, ${clampByte(baseG + dG)}, ${clampByte(baseB + dB)}, ${
            isOpenPore ? 0.52 : isSilkyRay ? 0.38 : 0.26
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

        // Delicate pale silver-straw medullary rays (characteristic of European oak skirting & doors)
        for (let r = 0; r < 28; r++) {
          const rx = ((r * 79 + 23) % (size - 60)) + 20;
          const ry = ((r * 113 + 41) % (size - 24)) + 12;
          const rw = 18 + (r % 5) * 7;
          const rh = 1.6 + (r % 3) * 0.6;
          cCtx.fillStyle = 'rgba(214, 193, 166, 0.24)';
          cCtx.beginPath();
          cCtx.ellipse(rx, ry, rw, rh, ((r % 3) - 1) * 0.03, 0, Math.PI * 2);
          cCtx.fill();
        }
      }
    );

    const colorMap = createBrowserDataOrCanvasTexture('timber-metal:7', colorCanvas, { colorSpace: THREE.NoColorSpace });
    colorMap.wrapS = THREE.RepeatWrapping;
    colorMap.wrapT = THREE.RepeatWrapping;
    colorMap.colorSpace = THREE.SRGBColorSpace;
    colorMap.anisotropy = 8;

    const bumpMap = createBrowserDataOrCanvasTexture('timber-metal:8', bumpCanvas, { colorSpace: THREE.NoColorSpace });
    bumpMap.wrapS = THREE.RepeatWrapping;
    bumpMap.wrapT = THREE.RepeatWrapping;
    bumpMap.anisotropy = 8;

    return { colorMap, bumpMap };
  });
}


export interface LivingCopperPatinaMaps {
  readonly shellColorModMap: THREE.DataTexture;
  readonly plinthColorModMap: THREE.DataTexture;
  readonly shellRoughnessMap: THREE.DataTexture;
  readonly plinthRoughnessMap: THREE.DataTexture;
  readonly normalMap: THREE.DataTexture;
}

let livingCopperPatinaCache: LivingCopperPatinaMaps | null = null;

function hashPeriodic2D(ix: number, iy: number, periodX: number, periodY: number, seed: number): number {
  const wx = ((ix % periodX) + periodX) % periodX;
  const wy = ((iy % periodY) + periodY) % periodY;
  let h = (wx * 374761393 + wy * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}

function quinticSmooth(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Quintic C2-smooth 2D value noise, strictly periodic in X (`periodX`) and Y (`periodY`). */
function periodicSmoothNoise2D(
  u: number,
  v: number,
  freqX: number,
  freqY: number,
  seed: number
): number {
  const x = u * freqX;
  const y = v * freqY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = quinticSmooth(x - x0);
  const fy = quinticSmooth(y - y0);

  const n00 = hashPeriodic2D(x0, y0, freqX, freqY, seed);
  const n10 = hashPeriodic2D(x0 + 1, y0, freqX, freqY, seed);
  const n01 = hashPeriodic2D(x0, y0 + 1, freqX, freqY, seed);
  const n11 = hashPeriodic2D(x0 + 1, y0 + 1, freqX, freqY, seed);

  const nx0 = n00 + (n10 - n00) * fx;
  const nx1 = n01 + (n11 - n01) * fx;
  return nx0 + (nx1 - nx0) * fy;
}

function buildPatinaDataTexture(
  data: Uint8Array<ArrayBuffer>,
  width: number,
  height: number,
  name: string,
  srgb: boolean
): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.name = name;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(1, 1);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Light, organic hand-rubbed living-copper / warm antique-bronze patina maps
 * (`512x256` RGBA `DataTexture`s, strictly 1-periodic across `u in [0, 1)` for zero
 * wraparound seam on closed bateau bath rings, and isotropic in 3D metres across the
 * ~3.90m perimeter x ~0.42m hull / ~0.21m moulded plinth).
 *
 * Strictly warm honey-copper -> waxed bronze/umber mottling (zero green verdigris,
 * zero harsh high-frequency blotches) paired with `0.24..0.38` roughness variation
 * and a subtle artisan hand-planished tangent-space normal map.
 */
export function getLivingCopperPatinaMaps(): LivingCopperPatinaMaps {
  if (livingCopperPatinaCache) return livingCopperPatinaCache;

  const w = 512;
  const h = 256;
  const shellColor = new Uint8Array(w * h * 4);
  const plinthColor = new Uint8Array(w * h * 4);
  const shellRough = new Uint8Array(w * h * 4);
  const plinthRough = new Uint8Array(w * h * 4);
  const normalData = new Uint8Array(w * h * 4);
  const heightField = new Float32Array(w * h);

  // Sample organic isotropic cloud field at (u in [0,1), vMetric in [0, 0.25])
  const sampleCloudAndPlanish = (
    u: number,
    vMetric: number
  ): { readonly cloud: number; readonly waxSweep: number; readonly planish: number } => {
    const dwU =
      (periodicSmoothNoise2D(u, vMetric, 5, 8, 1709) - 0.5) * 0.042 +
      (periodicSmoothNoise2D(u, vMetric, 9, 16, 2311) - 0.5) * 0.018;
    const dwV =
      (periodicSmoothNoise2D(u, vMetric, 5, 8, 2903) - 0.5) * 0.016 +
      (periodicSmoothNoise2D(u, vMetric, 9, 16, 3517) - 0.5) * 0.008;

    const uw = ((u + dwU) % 1 + 1) % 1;
    const vw = ((vMetric + dwV) % 1 + 1) % 1;

    // Broad ~45-75cm soft living-copper clouds + medium ~22-35cm hand-rubbed warmth
    const cBroad = periodicSmoothNoise2D(uw, vw, 6, 8, 4127);
    const cMed = periodicSmoothNoise2D(uw, vw, 11, 16, 4813);
    const cSoft = periodicSmoothNoise2D(uw, vw, 19, 28, 5407);
    const cloud = 0.54 * cBroad + 0.31 * cMed + 0.15 * cSoft;

    // Gentle longitudinal beeswax polishing-cloth sweep
    const waxSweep =
      0.65 * periodicSmoothNoise2D(u, vMetric, 4, 36, 6101) +
      0.35 * periodicSmoothNoise2D(u, vMetric, 8, 64, 6733);

    // Subtle wide hand-planished sheet-metal undulation for specular breakup
    const planish =
      0.62 * periodicSmoothNoise2D(uw, vw, 14, 20, 7309) +
      0.38 * periodicSmoothNoise2D(u, vMetric, 26, 38, 7919);

    return { cloud, waxSweep, planish };
  };

  const clampB = (n: number): number => (n < 0 ? 0 : n > 255 ? 255 : Math.round(n));
  const gauss = (v: number, center: number, sigma: number): number => {
    const d = (v - center) / sigma;
    return Math.exp(-d * d);
  };

  for (let y = 0; y < h; y++) {
    const v = y / (h - 1); // 0 at bottom of mesh, 1 at top of mesh

    // Continuous world-proportional vertical coordinate so clouds flow seamlessly across waistY
    const vMetricShell = 0.062 + v * 0.118; // ~0.42m upper hull height
    const vMetricPlinth = v * 0.062; // ~0.21m moulded plinth height

    // Architectural patina shading along upper hull v in [0, 1]:
    // - Subtle waxed bronze depth tucked right above waist collar joint (v = 0..0.09)
    // - Gentle warm hand-buffed lift across mid-upper body (v = 0.48..0.82)
    // - Delicate shadow tucked right beneath overhanging white rolled rim (v = 0.93..1.0)
    const shellWaistCrease = gauss(v, 0.0, 0.075) * 0.42;
    const shellRimUnder = gauss(v, 1.0, 0.055) * 0.22;
    const shellHandBuff = gauss(v, 0.62, 0.26) * 0.18;

    // Architectural patina shading along 3-part moulded plinth v in [0, 1]:
    // - Floor pad & lower ogee base cove (v ~ 0.0..0.08 & v ~ 0.26) get gentle antique-bronze depth
    // - Proud bullnose foot crown (v ~ 0.15) & cambered waist collar (v ~ 0.89) get warm hand-rubbed lift
    // - Stepped-in collar throat (v ~ 0.76) & top waist rebate (v ~ 0.99) get subtle waxed patina
    const plinthCovePatina =
      gauss(v, 0.02, 0.055) * 0.34 +
      gauss(v, 0.265, 0.062) * 0.38 +
      gauss(v, 0.76, 0.045) * 0.36 +
      gauss(v, 0.99, 0.035) * 0.38;
    const plinthCrownBuff =
      gauss(v, 0.155, 0.044) * 0.24 +
      gauss(v, 0.885, 0.054) * 0.26;

    for (let x = 0; x < w; x++) {
      const u = x / w; // strictly in [0, 1) -> x=0 and x=w wrap with 0 discontinuity

      const sSample = sampleCloudAndPlanish(u, vMetricShell);
      const pSample = sampleCloudAndPlanish(u, vMetricPlinth);

      // Normalize 3-octave FBM (~[0.37..0.63]) via smooth tanh into [-1, +1] so soft
      // low-frequency cloudy mottling reads clearly yet organically without harsh edges
      const sCloudNorm = Math.tanh(
        ((sSample.cloud - 0.5) * 4.4 + (sSample.waxSweep - 0.5) * 1.15)
      );
      const pCloudNorm = Math.tanh(
        ((pSample.cloud - 0.5) * 4.4 + (pSample.waxSweep - 0.5) * 1.15)
      );

      // Net patina factor in approx [-1.1 .. +1.0]:
      // + values -> warm honey-copper hand-rubbed highlight
      // - values -> light antique-bronze / warm umber patina (strictly warm, zero green!)
      const sTone = sCloudNorm * 0.68 + shellHandBuff - shellWaistCrease - shellRimUnder;
      const pTone = pCloudNorm * 0.68 + plinthCrownBuff - plinthCovePatina;

      const sDeep = Math.max(0, -sTone);
      const pDeep = Math.max(0, -pTone);

      // Light living-copper color modulation:
      // Peak highlight (+0.85) -> rgb(255, 245, 236) (warm burnished honey-copper)
      // Mid tone (0.0)         -> rgb(219, 203, 190) (warm waxed copper-bronze)
      // Deeper cloud (-0.85)   -> rgb(171, 146, 130) (soft antique bronze / warm umber)
      const sR = clampB(219 + sTone * 46);
      const sG = clampB(203 + sTone * 52 - sDeep * 11);
      const sB = clampB(190 + sTone * 56 - sDeep * 15);

      const pR = clampB(213 + pTone * 46);
      const pG = clampB(196 + pTone * 52 - pDeep * 11);
      const pB = clampB(183 + pTone * 56 - pDeep * 15);

      // Roughness in [0.24 .. 0.38] (bytes 61 .. 97 when material.roughness = 1.0):
      // brighter honey-rubbed areas are smoother (~0.24-0.26), deeper patina clouds/coves are ~0.35-0.38
      const sRoughVal = Math.max(
        0.24,
        Math.min(0.38, 0.306 - sTone * 0.068 + (0.5 - sSample.planish) * 0.032)
      );
      const pRoughVal = Math.max(
        0.245,
        Math.min(0.385, 0.318 - pTone * 0.068 + (0.5 - pSample.planish) * 0.032)
      );
      const sRoughByte = clampB(sRoughVal * 255);
      const pRoughByte = clampB(pRoughVal * 255);

      const idx = (y * w + x) * 4;
      shellColor[idx] = sR;
      shellColor[idx + 1] = sG;
      shellColor[idx + 2] = sB;
      shellColor[idx + 3] = 255;

      plinthColor[idx] = pR;
      plinthColor[idx + 1] = pG;
      plinthColor[idx + 2] = pB;
      plinthColor[idx + 3] = 255;

      shellRough[idx] = sRoughByte;
      shellRough[idx + 1] = sRoughByte;
      shellRough[idx + 2] = sRoughByte;
      shellRough[idx + 3] = 255;

      plinthRough[idx] = pRoughByte;
      plinthRough[idx + 1] = pRoughByte;
      plinthRough[idx + 2] = pRoughByte;
      plinthRough[idx + 3] = 255;

      heightField[y * w + x] =
        sSample.planish * 0.62 + sSample.cloud * 0.26 + sSample.waxSweep * 0.12;
    }
  }

  // Derive seamless periodic tangent-space normal map (periodic in X, clamped in Y)
  const strength = 1.35;
  for (let y = 0; y < h; y++) {
    const ym = Math.max(0, y - 1);
    const yp = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w;
      const xp = (x + 1) % w;
      // Scale dX by ~1/6 relative to dY to compensate for perimeter:height aspect ratio (~3.9m vs ~0.42m)
      const dX = (heightField[y * w + xp]! - heightField[y * w + xm]!) * strength * 1.4;
      const dY = (heightField[yp * w + x]! - heightField[ym * w + x]!) * strength * 0.35;
      const nx = -dX;
      const ny = -dY;
      const nz = 1.0;
      const invLen = 1.0 / Math.hypot(nx, ny, nz);

      const idx = (y * w + x) * 4;
      normalData[idx] = clampB((nx * invLen * 0.5 + 0.5) * 255);
      normalData[idx + 1] = clampB((ny * invLen * 0.5 + 0.5) * 255);
      normalData[idx + 2] = clampB((nz * invLen * 0.5 + 0.5) * 255);
      normalData[idx + 3] = 255;
    }
  }

  livingCopperPatinaCache = {
    shellColorModMap: buildPatinaDataTexture(
      shellColor,
      w,
      h,
      'bathroom.livingCopper.shellColor',
      true
    ),
    plinthColorModMap: buildPatinaDataTexture(
      plinthColor,
      w,
      h,
      'bathroom.livingCopper.plinthColor',
      true
    ),
    shellRoughnessMap: buildPatinaDataTexture(
      shellRough,
      w,
      h,
      'bathroom.livingCopper.shellRoughness',
      false
    ),
    plinthRoughnessMap: buildPatinaDataTexture(
      plinthRough,
      w,
      h,
      'bathroom.livingCopper.plinthRoughness',
      false
    ),
    normalMap: buildPatinaDataTexture(normalData, w, h, 'bathroom.livingCopper.normal', false),
  };
  return livingCopperPatinaCache;
}
