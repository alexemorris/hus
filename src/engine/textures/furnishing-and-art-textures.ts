import * as THREE from 'three';
import {
  getOrCreateCachedCanvas,
  getOrCreateCachedCanvasPair,
  getOrCreateCachedTexture,
} from './texture-registry.ts';

export function createRadialGlowTexture(): THREE.CanvasTexture {
  const canvas = getOrCreateCachedCanvas('radial-glow', 128, 128, (ctx) => {
    const grad = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
    grad.addColorStop(0, 'rgba(255, 205, 130, 0.85)');
    grad.addColorStop(0.4, 'rgba(255, 185, 95, 0.35)');
    grad.addColorStop(1, 'rgba(255, 170, 75, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createTVOffTexture(): THREE.CanvasTexture {
  const canvas = getOrCreateCachedCanvas('tv-off', 256, 144, (ctx) => {
    const grad = ctx.createLinearGradient(0, 0, 256, 144);
    grad.addColorStop(0, '#121417');
    grad.addColorStop(0.5, '#171a1e');
    grad.addColorStop(1, '#101214');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 144);
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createTVArtGalleryTextures(): readonly THREE.CanvasTexture[] {
  const artworks: THREE.CanvasTexture[] = [];

  const drawPassepartout = (ctx: CanvasRenderingContext2D): void => {
    // Warm museum mount board (passe-partout) border
    ctx.fillStyle = '#f2ede2';
    ctx.fillRect(0, 0, 256, 144);
    ctx.strokeStyle = '#d4ccb8';
    ctx.lineWidth = 2;
    ctx.strokeRect(14, 12, 228, 120);
  };

  // Art 1: "Pastoral Hills Sunset" — Rolling Countryside Oil Landscape
  {
    const canvas = getOrCreateCachedCanvas('tv-art-gallery-0', 256, 144, (ctx) => {
      drawPassepartout(ctx);
      ctx.save();
      ctx.beginPath();
      ctx.rect(15, 13, 226, 118);
      ctx.clip();

      const sky = ctx.createLinearGradient(0, 13, 0, 92);
      sky.addColorStop(0, '#355678');
      sky.addColorStop(0.55, '#c98b5b');
      sky.addColorStop(1, '#ecc07e');
      ctx.fillStyle = sky;
      ctx.fillRect(15, 13, 226, 80);

      // Soft golden sun glow
      const sun = ctx.createRadialGradient(178, 62, 2, 178, 62, 34);
      sun.addColorStop(0, 'rgba(255, 242, 195, 0.92)');
      sun.addColorStop(1, 'rgba(255, 210, 130, 0)');
      ctx.fillStyle = sun;
      ctx.fillRect(15, 13, 226, 80);

      // Distant hill ridge
      ctx.fillStyle = '#586d57';
      ctx.beginPath();
      ctx.moveTo(15, 88);
      ctx.quadraticCurveTo(85, 65, 155, 82);
      ctx.quadraticCurveTo(205, 92, 241, 74);
      ctx.lineTo(241, 131);
      ctx.lineTo(15, 131);
      ctx.fill();

      // Foreground warm meadow & hedgerow
      const hills = ctx.createLinearGradient(0, 82, 0, 131);
      hills.addColorStop(0, '#495c3c');
      hills.addColorStop(1, '#293622');
      ctx.fillStyle = hills;
      ctx.beginPath();
      ctx.moveTo(15, 96);
      ctx.quadraticCurveTo(95, 78, 165, 98);
      ctx.quadraticCurveTo(210, 110, 241, 92);
      ctx.lineTo(241, 131);
      ctx.lineTo(15, 131);
      ctx.fill();

      ctx.restore();
    });
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    artworks.push(tex);
  }

  // Art 2: "St Ives Modernist" — Mid-Century Geometric Still Life (Nicholson inspired)
  {
    const canvas = getOrCreateCachedCanvas('tv-art-gallery-1', 256, 144, (ctx) => {
      drawPassepartout(ctx);
      ctx.save();
      ctx.beginPath();
      ctx.rect(15, 13, 226, 118);
      ctx.clip();

      ctx.fillStyle = '#e5ddd0';
      ctx.fillRect(15, 13, 226, 118);

      // Large slate blue block
      ctx.fillStyle = '#33526e';
      ctx.fillRect(34, 26, 86, 88);

      // Terracotta ochre circle
      ctx.fillStyle = '#c46843';
      ctx.beginPath();
      ctx.arc(146, 72, 36, 0, Math.PI * 2);
      ctx.fill();

      // Warm mustard vertical plane
      ctx.fillStyle = '#d8a648';
      ctx.fillRect(168, 28, 48, 76);

      // Charcoal minimalist line vessels
      ctx.strokeStyle = '#1f2328';
      ctx.lineWidth = 2.2;
      ctx.strokeRect(86, 42, 58, 62);
      ctx.beginPath();
      ctx.arc(115, 73, 16, 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();
    });
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    artworks.push(tex);
  }

  // Art 3: "Botanical Meadow" — Heritage Watercolour Flora & Fern Study
  {
    const canvas = getOrCreateCachedCanvas('tv-art-gallery-2', 256, 144, (ctx) => {
      drawPassepartout(ctx);
      ctx.save();
      ctx.beginPath();
      ctx.rect(15, 13, 226, 118);
      ctx.clip();

      ctx.fillStyle = '#efe9dc';
      ctx.fillRect(15, 13, 226, 118);

      // Botanical stems & leaves
      const stems = [58, 98, 138, 178, 204];
      for (const sx of stems) {
        ctx.strokeStyle = '#4c6b4f';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx, 126);
        ctx.quadraticCurveTo(sx - 8, 78, sx + 4, 34);
        ctx.stroke();

        // Paired leaves
        ctx.fillStyle = '#628262';
        for (const ly of [55, 75, 95]) {
          ctx.beginPath();
          ctx.ellipse(sx - 9, ly, 8, 3.5, -0.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(sx + 7, ly - 6, 8, 3.5, 0.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Wildflower Umbels / Blossoms
      const blooms: ReadonlyArray<readonly [number, number, string]> = [
        [62, 34, '#c86d51'],
        [102, 32, '#48688a'],
        [142, 30, '#d69b43'],
        [182, 36, '#b85a4c'],
        [208, 40, '#5a7896'],
      ];
      for (const [bx, by, col] of blooms) {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(bx, by, 7, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    });
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    artworks.push(tex);
  }

  // Art 4: "Nocturne in Blue & Gold" — Atmospheric Coastal Horizon
  {
    const canvas = getOrCreateCachedCanvas('tv-art-gallery-3', 256, 144, (ctx) => {
      drawPassepartout(ctx);
      ctx.save();
      ctx.beginPath();
      ctx.rect(15, 13, 226, 118);
      ctx.clip();

      const nocturne = ctx.createLinearGradient(0, 13, 0, 131);
      nocturne.addColorStop(0, '#192b3e');
      nocturne.addColorStop(0.58, '#284961');
      nocturne.addColorStop(0.64, '#d4a259');
      nocturne.addColorStop(1, '#162634');
      ctx.fillStyle = nocturne;
      ctx.fillRect(15, 13, 226, 118);

      // Shimmering gold water reflections
      ctx.fillStyle = 'rgba(238, 194, 112, 0.65)';
      for (let i = 0; i < 9; i++) {
        const y = 86 + i * 4.5;
        const w = 48 - i * 3.5;
        ctx.fillRect(128 - w / 2, y, w, 2);
      }

      ctx.restore();
    });
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    artworks.push(tex);
  }

  return artworks;
}

export function createHawaiiArtworkTexture(): THREE.CanvasTexture {
  return getOrCreateCachedTexture('hawaii-artwork', () => {
    const canvas = getOrCreateCachedCanvas('hawaii-artwork', 512, 360, (ctx) => {
      // 1. Warm golden-hour Hawaiian sunset sky (soft pacific azure -> apricot -> warm coral-gold at horizon)
      const skyGrad = ctx.createLinearGradient(0, 0, 0, 195);
      skyGrad.addColorStop(0.0, '#3e6b89');
      skyGrad.addColorStop(0.32, '#7596a8');
      skyGrad.addColorStop(0.62, '#d89b72');
      skyGrad.addColorStop(0.84, '#f0b86e');
      skyGrad.addColorStop(1.0, '#fae09c');
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, 512, 195);

      // Warm setting sun glow low over the Pacific horizon
      const sunGlow = ctx.createRadialGradient(345, 162, 6, 345, 162, 130);
      sunGlow.addColorStop(0.0, 'rgba(255, 250, 224, 0.96)');
      sunGlow.addColorStop(0.22, 'rgba(255, 219, 138, 0.72)');
      sunGlow.addColorStop(0.55, 'rgba(244, 154, 102, 0.28)');
      sunGlow.addColorStop(1.0, 'rgba(244, 154, 102, 0.0)');
      ctx.fillStyle = sunGlow;
      ctx.fillRect(180, 30, 320, 175);

      // Soft sunlit tropical clouds
      const clouds: ReadonlyArray<readonly [number, number, number, number, string]> = [
        [115, 68, 75, 16, 'rgba(255, 232, 202, 0.42)'],
        [155, 62, 52, 14, 'rgba(255, 240, 215, 0.50)'],
        [285, 54, 88, 15, 'rgba(255, 236, 208, 0.46)'],
        [420, 78, 68, 13, 'rgba(255, 224, 190, 0.38)'],
        [230, 105, 95, 11, 'rgba(255, 216, 172, 0.35)'],
      ];
      for (const [cx, cy, rx, ry, col] of clouds) {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // 2. Distant misty volcanic headland (Hawaiian island silhouette on horizon)
      ctx.fillStyle = '#6d7c86';
      ctx.beginPath();
      ctx.moveTo(210, 192);
      ctx.quadraticCurveTo(255, 152, 305, 168);
      ctx.quadraticCurveTo(345, 176, 385, 192);
      ctx.closePath();
      ctx.fill();

      // 3. Iconic Na Pali / Ko'olau fluted emerald volcanic mountain ridges on the left & midground
      const backRidgeGrad = ctx.createLinearGradient(0, 82, 260, 195);
      backRidgeGrad.addColorStop(0.0, '#2c4d3e');
      backRidgeGrad.addColorStop(0.55, '#3b6448');
      backRidgeGrad.addColorStop(1.0, '#5c7c54');
      ctx.fillStyle = backRidgeGrad;
      ctx.beginPath();
      ctx.moveTo(0, 194);
      ctx.lineTo(0, 96);
      ctx.lineTo(38, 78);
      ctx.lineTo(76, 94);
      ctx.lineTo(118, 84);
      ctx.lineTo(162, 118);
      ctx.lineTo(208, 136);
      ctx.lineTo(268, 184);
      ctx.lineTo(295, 194);
      ctx.closePath();
      ctx.fill();

      // Sunlit golden-green fluted pali ribs & deep shadowed tropical valleys
      const paliRibs: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
        [38, 78, 18, 192, 54, 192],
        [76, 94, 62, 192, 95, 192],
        [118, 84, 102, 192, 142, 192],
        [162, 118, 148, 192, 188, 192],
        [208, 136, 194, 192, 242, 192],
      ];
      for (const [px, py, lx, ly, rx, ry] of paliRibs) {
        // Warm sunlit right slope of each fluted ridge
        ctx.fillStyle = 'rgba(138, 168, 92, 0.52)';
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo((lx + rx) * 0.5, (ly + ry) * 0.5);
        ctx.lineTo(rx, ry);
        ctx.closePath();
        ctx.fill();

        // Deep emerald shadow on the left valley fold
        ctx.fillStyle = 'rgba(26, 48, 38, 0.45)';
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(lx, ly);
        ctx.lineTo((lx + rx) * 0.5, (ly + ry) * 0.5);
        ctx.closePath();
        ctx.fill();
      }

      // 4. Pacific Ocean Bay (deep cobalt horizon -> glowing turquoise lagoon -> shallow aquamarine)
      const oceanGrad = ctx.createLinearGradient(0, 190, 0, 325);
      oceanGrad.addColorStop(0.0, '#1d5b78');
      oceanGrad.addColorStop(0.35, '#1e7c8c');
      oceanGrad.addColorStop(0.7, '#3aa3a0');
      oceanGrad.addColorStop(1.0, '#7cc4b0');
      ctx.fillStyle = oceanGrad;
      ctx.fillRect(0, 190, 512, 170);

      // Golden sunset shimmer path across the water
      for (let i = 0; i < 28; i++) {
        const wy = 194 + i * 4.2;
        const spread = 18 + i * 2.2;
        const sx = 345 - spread * 0.5 + Math.sin(i * 1.7) * 6;
        ctx.fillStyle = `rgba(255, 226, 152, ${0.42 - i * 0.012})`;
        ctx.fillRect(sx, wy, spread, 2.2);
      }

      // 5. Curving Golden Hawaiian Sand Beach (right & foreground bay curve)
      const sandGrad = ctx.createLinearGradient(120, 245, 420, 360);
      sandGrad.addColorStop(0.0, '#e6c994');
      sandGrad.addColorStop(0.5, '#d9b376');
      sandGrad.addColorStop(1.0, '#c4995c');
      ctx.fillStyle = sandGrad;
      ctx.beginPath();
      ctx.moveTo(0, 312);
      ctx.quadraticCurveTo(145, 292, 238, 252);
      ctx.quadraticCurveTo(282, 232, 295, 194);
      ctx.lineTo(512, 194);
      ctx.lineTo(512, 360);
      ctx.lineTo(0, 360);
      ctx.closePath();
      ctx.fill();

      // Re-carve the curving turquoise bay over the upper-right so the beach forms a sweeping crescent
      ctx.fillStyle = oceanGrad;
      ctx.beginPath();
      ctx.moveTo(185, 190);
      ctx.lineTo(512, 190);
      ctx.lineTo(512, 268);
      ctx.quadraticCurveTo(360, 272, 255, 248);
      ctx.quadraticCurveTo(195, 232, 185, 190);
      ctx.closePath();
      ctx.fill();

      // Creamy white-water Pacific surf & reef rollers curving into the bay
      ctx.strokeStyle = 'rgba(250, 252, 248, 0.85)';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(0, 308);
      ctx.quadraticCurveTo(148, 286, 252, 248);
      ctx.quadraticCurveTo(358, 268, 512, 265);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(236, 248, 245, 0.62)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(0, 292);
      ctx.quadraticCurveTo(138, 272, 238, 236);
      ctx.quadraticCurveTo(352, 252, 512, 248);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(236, 248, 245, 0.45)';
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(45, 264);
      ctx.quadraticCurveTo(155, 250, 225, 222);
      ctx.stroke();

      // 6. Lush foreground headland & graceful Hawaiian coconut palms on the right bluff
      ctx.fillStyle = '#263f2e';
      ctx.beginPath();
      ctx.moveTo(355, 360);
      ctx.quadraticCurveTo(405, 302, 512, 295);
      ctx.lineTo(512, 360);
      ctx.closePath();
      ctx.fill();

      const drawPalmTree = (
        baseX: number,
        baseY: number,
        topX: number,
        topY: number,
        ctrlX: number,
        ctrlY: number,
        scale: number
      ): void => {
        // Curved coconut palm trunk
        ctx.strokeStyle = '#2b241d';
        ctx.lineWidth = 6.5 * scale;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(baseX, baseY);
        ctx.quadraticCurveTo(ctrlX, ctrlY, topX, topY);
        ctx.stroke();

        // Crown of arching palm fronds
        const frondAngles: ReadonlyArray<readonly [number, number, number, number]> = [
          [-68, -12, -36, -24],
          [-54, 22, -28, -4],
          [-22, -48, -10, -28],
          [18, -52, 10, -30],
          [58, -26, 32, -22],
          [66, 16, 36, -6],
          [32, 38, 18, 12],
        ];
        for (const [dx, dy, cx, cy] of frondAngles) {
          ctx.strokeStyle = '#1f3826';
          ctx.lineWidth = 3.2 * scale;
          ctx.beginPath();
          ctx.moveTo(topX, topY);
          ctx.quadraticCurveTo(
            topX + cx * scale,
            topY + cy * scale,
            topX + dx * scale,
            topY + dy * scale
          );
          ctx.stroke();

          // Warm golden sunset highlight along upper frond edge
          ctx.strokeStyle = 'rgba(168, 184, 96, 0.42)';
          ctx.lineWidth = 1.3 * scale;
          ctx.beginPath();
          ctx.moveTo(topX, topY);
          ctx.quadraticCurveTo(
            topX + cx * scale,
            topY + (cy - 2) * scale,
            topX + dx * scale,
            topY + (dy - 2) * scale
          );
          ctx.stroke();
        }
      };

      drawPalmTree(448, 336, 398, 118, 412, 228, 1.05);
      drawPalmTree(476, 342, 446, 148, 456, 245, 0.88);
      drawPalmTree(418, 348, 368, 174, 388, 258, 0.74);

      // 7. Subtle fine-art canvas weave & warm gallery varnish grain
      ctx.fillStyle = 'rgba(255, 248, 232, 0.035)';
      for (let y = 0; y < 360; y += 3) {
        ctx.fillRect(0, y, 512, 1);
      }
      for (let x = 0; x < 512; x += 3) {
        ctx.fillRect(x, 0, 1, 360);
      }
    });

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
}

export function createWovenWoolCarpetTextures(): {
  readonly colorMap: THREE.CanvasTexture;
  readonly bumpMap: THREE.CanvasTexture;
  readonly normalMap: THREE.DataTexture;
  readonly roughnessMap: THREE.DataTexture;
} {
  return getOrCreateCachedTexture('woven-wool-carpet-boucle-v2', () => {
    const size = 512;
    const mask = size - 1;
    // Isotropic 5x5 repeat over 2.0m UV tile => 40cm x 40cm tile with 48x48 organic 3-ply boucle wool loops (~8.3mm/loop)
    const repeatXY = 5;
    const loopsPerTile = 48;
    const heightField = new Float32Array(size * size);
    const roughData = new Uint8Array(size * size * 2);
    const normalData = new Uint8Array(size * size * 4);

    // Deterministic integer hash in [0, 1) with periodic wrapping over [0, period)
    const hash2 = (ix: number, iy: number, period: number, salt: number): number => {
      const wx = ((ix % period) + period) % period;
      const wy = ((iy % period) + period) % period;
      let h = (wx * 374761393 + wy * 668265263 + salt * 1442695041) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };

    const TAU = Math.PI * 2;
    const [colorCanvas, bumpCanvas] = getOrCreateCachedCanvasPair(
      'woven-wool-carpet-boucle-v2',
      size,
      size,
      (cCtx, bCtx) => {
        const cImg = cCtx.createImageData(size, size);
        const bImg = bCtx.createImageData(size, size);
        const cBuf = cImg.data;
        const bBuf = bImg.data;

        for (let py = 0; py < size; py++) {
          const v = py / size;
          // Multi-scale periodic macro-heathering across the 40cm tile (zero directional striping, zero mip washout)
          const macroY1 = Math.sin(TAU * v + 0.4);
          const macroY2 = Math.cos(TAU * 2 * v - 1.1);
          const macroY3 = Math.sin(TAU * 5 * v + 2.2);

          for (let px = 0; px < size; px++) {
            const u = px / size;
            const macro =
              0.38 * Math.sin(TAU * u + 0.7) * macroY1 +
              0.34 * Math.cos(TAU * 2 * u + 1.3) * macroY2 +
              0.28 * Math.sin(TAU * 3 * (u + v) - 0.5) +
              0.22 * Math.cos(TAU * 5 * u - 0.8) * macroY3;

            // Continuous loop-grid coordinates with organic staggered half-row bouclé offset + subtle weave wave
            const gxRaw =
              u * loopsPerTile +
              0.08 * Math.sin(TAU * 3 * v + 0.6) +
              0.05 * Math.cos(TAU * 7 * v - 0.3);
            const gyRaw =
              v * loopsPerTile +
              0.08 * Math.cos(TAU * 3 * u - 0.4) +
              0.05 * Math.sin(TAU * 7 * u + 0.9);

            const rowIdx = Math.floor(gyRaw);
            // Stagger alternate rows by ~0.5 loop + per-row organic phase jitter so no straight grid moiré forms!
            const rowShift = (rowIdx & 1) * 0.5 + (hash2(0, rowIdx, loopsPerTile, 11) - 0.5) * 0.24;
            const gx = gxRaw + rowShift;
            const colIdx = Math.floor(gx);

            // Evaluate closest loop center among 3x3 neighborhood so jittered plump bouclé tufts overlap naturally
            let bestH = 0.08;
            let bestYarnTone = 0.5;
            let bestTwist = 0.0;
            let bestSlub = 0.0;

            for (let dy = -1; dy <= 1; dy++) {
              const r = rowIdx + dy;
              const rShift = (r & 1) * 0.5 + (hash2(0, r, loopsPerTile, 11) - 0.5) * 0.24;
              const localGx = gxRaw + rShift;
              const baseC = Math.floor(localGx);
              for (let dx = -1; dx <= 1; dx++) {
                const c = baseC + dx;
                const jx = (hash2(c, r, loopsPerTile, 23) - 0.5) * 0.32;
                const jy = (hash2(c, r, loopsPerTile, 37) - 0.5) * 0.30;
                const cx = c + 0.5 + jx;
                const cy = r + 0.5 + jy;
                const ddx = localGx - cx;
                const ddy = gyRaw - cy;

                // Slight per-tuft orientation rotation (isotropic overall!) for natural 3-ply twisted bouclé wool
                const angle = (hash2(c, r, loopsPerTile, 53) - 0.5) * Math.PI;
                const ca = Math.cos(angle);
                const sa = Math.sin(angle);
                const rx = (ddx * ca + ddy * sa) / 0.54;
                const ry = (-ddx * sa + ddy * ca) / 0.44;
                const r2 = rx * rx + ry * ry;
                if (r2 < 1.35) {
                  const crown = Math.max(0, 1 - r2 * 0.76);
                  const dome = Math.pow(crown, 0.62);
                  // 3-ply spun yarn twist diagonal ridges across each plump wool loop
                  const plyPhase = (rx * 2.1 + ry * 1.45) * Math.PI;
                  const plyRidge = 0.5 + 0.5 * Math.cos(plyPhase);
                  const tuftScale = 0.86 + 0.14 * hash2(c, r, loopsPerTile, 71);
                  const h = dome * tuftScale * (0.86 + 0.14 * plyRidge);
                  if (h > bestH) {
                    bestH = h;
                    bestYarnTone = hash2(c, r, loopsPerTile, 89);
                    bestTwist = plyRidge;
                    bestSlub = hash2(c, r, loopsPerTile, 107);
                  }
                }
              }
            }
            void colIdx;

            // Fine spun-wool fibre fuzz noise (periodic over 512)
            const fuzz =
              (hash2(px, py, size, 131) - 0.5) * 0.055 +
              (hash2(px >> 1, py >> 1, size >> 1, 149) - 0.5) * 0.045;
            const hClamped = Math.max(0, Math.min(1, bestH + fuzz * 0.45));
            const idx = py * size + px;
            heightField[idx] = hClamped;

            // Natural unbleached British oatmeal / warm cream / soft biscuit wool palette:
            // Recessed backing shadow -> warm toasted oat, loop crown -> creamy ecru with rare organic fleece slubs
            const ao = 0.79 + 0.21 * Math.pow(hClamped, 0.72);
            const heatherShift =
              (bestYarnTone - 0.5) * 15.0 +
              macro * 6.5 +
              (bestTwist - 0.5) * 6.0 +
              fuzz * 22.0 -
              (bestSlub > 0.955 ? 20.0 : 0.0);

            const baseR = 236.0 * ao + heatherShift;
            const baseG = 227.0 * ao + heatherShift * 0.94;
            const baseB = 211.0 * ao + heatherShift * 0.84;

            const p4 = idx * 4;
            cBuf[p4] = Math.max(0, Math.min(255, Math.round(baseR)));
            cBuf[p4 + 1] = Math.max(0, Math.min(255, Math.round(baseG)));
            cBuf[p4 + 2] = Math.max(0, Math.min(255, Math.round(baseB)));
            cBuf[p4 + 3] = 255;

            const hByte = Math.max(0, Math.min(255, Math.round(hClamped * 255)));
            bBuf[p4] = hByte;
            bBuf[p4 + 1] = hByte;
            bBuf[p4 + 2] = hByte;
            bBuf[p4 + 3] = 255;

            // Roughness in G channel (RGFormat): recessed wool crevices = 0.98, raised spun-wool crowns = 0.86..0.93
            const rough = Math.max(
              0.82,
              Math.min(0.99, 0.98 - hClamped * 0.11 + (0.5 - bestTwist) * 0.03 + fuzz * 0.05)
            );
            const rByte = Math.round(rough * 255);
            roughData[idx * 2] = rByte;
            roughData[idx * 2 + 1] = rByte;
          }
        }

        cCtx.putImageData(cImg, 0, 0);
        bCtx.putImageData(bImg, 0, 0);
      }
    );

    // Derive seamless periodic tangent-space normal map from heightField
    const normalStrength = 1.65;
    for (let y = 0; y < size; y++) {
      const ym = ((y - 1) & mask) * size;
      const y0 = y * size;
      const yp = ((y + 1) & mask) * size;
      for (let x = 0; x < size; x++) {
        const xm = (x - 1) & mask;
        const xp = (x + 1) & mask;
        const dX =
          heightField[ym + xp]! +
          2 * heightField[y0 + xp]! +
          heightField[yp + xp]! -
          (heightField[ym + xm]! + 2 * heightField[y0 + xm]! + heightField[yp + xm]!);
        const dY =
          heightField[yp + xm]! +
          2 * heightField[yp + x]! +
          heightField[yp + xp]! -
          (heightField[ym + xm]! + 2 * heightField[ym + x]! + heightField[ym + xp]!);
        const nx = -dX * normalStrength;
        const ny = -dY * normalStrength;
        const nz = 1.0;
        const invLen = 1.0 / Math.hypot(nx, ny, nz);
        const p4 = (y0 + x) * 4;
        normalData[p4] = Math.max(0, Math.min(255, Math.round((nx * invLen * 0.5 + 0.5) * 255)));
        normalData[p4 + 1] = Math.max(0, Math.min(255, Math.round((ny * invLen * 0.5 + 0.5) * 255)));
        normalData[p4 + 2] = Math.max(0, Math.min(255, Math.round((nz * invLen * 0.5 + 0.5) * 255)));
        normalData[p4 + 3] = 255;
      }
    }

    const colorMap = new THREE.CanvasTexture(colorCanvas);
    colorMap.wrapS = THREE.RepeatWrapping;
    colorMap.wrapT = THREE.RepeatWrapping;
    colorMap.repeat.set(repeatXY, repeatXY);
    colorMap.anisotropy = 8;
    colorMap.colorSpace = THREE.SRGBColorSpace;

    const bumpMap = new THREE.CanvasTexture(bumpCanvas);
    bumpMap.wrapS = THREE.RepeatWrapping;
    bumpMap.wrapT = THREE.RepeatWrapping;
    bumpMap.repeat.set(repeatXY, repeatXY);
    bumpMap.anisotropy = 8;
    bumpMap.colorSpace = THREE.NoColorSpace;

    const normalMap = new THREE.DataTexture(
      normalData,
      size,
      size,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    );
    normalMap.wrapS = THREE.RepeatWrapping;
    normalMap.wrapT = THREE.RepeatWrapping;
    normalMap.repeat.set(repeatXY, repeatXY);
    normalMap.colorSpace = THREE.NoColorSpace;
    normalMap.anisotropy = 8;
    normalMap.flipY = true;
    normalMap.magFilter = THREE.LinearFilter;
    normalMap.minFilter = THREE.LinearMipmapLinearFilter;
    normalMap.generateMipmaps = true;
    normalMap.needsUpdate = true;

    const roughnessMap = new THREE.DataTexture(
      roughData,
      size,
      size,
      THREE.RGFormat,
      THREE.UnsignedByteType
    );
    roughnessMap.wrapS = THREE.RepeatWrapping;
    roughnessMap.wrapT = THREE.RepeatWrapping;
    roughnessMap.repeat.set(repeatXY, repeatXY);
    roughnessMap.colorSpace = THREE.NoColorSpace;
    roughnessMap.anisotropy = 8;
    roughnessMap.flipY = true;
    roughnessMap.unpackAlignment = 1;
    roughnessMap.magFilter = THREE.LinearFilter;
    roughnessMap.minFilter = THREE.LinearMipmapLinearFilter;
    roughnessMap.generateMipmaps = true;
    roughnessMap.needsUpdate = true;

    return { colorMap, bumpMap, normalMap, roughnessMap };
  });
}
