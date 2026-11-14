import * as THREE from 'three';
import {
  buildFloorPbrTextureBundle,
  clampByte,
  fastCosTurn,
  fastSinTurn,
  type FloorPbrTextureBundle,
  valueNoise2Periodic,
} from './floor-pbr-lut.ts';
import {
  createBrowserDataOrCanvasTexture,
  getOrCreateCachedCanvas,
  getOrCreateCachedCanvasPair,
  getOrCreateCachedTexture,
} from './texture-registry.ts';

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

export function createEngineeredOakFloorTextures(): FloorPbrTextureBundle {
  return getOrCreateCachedTexture('engineered-oak-floor', () => {
    const size = 1024;
    const PHI = 0.6180339887498949;
    // Warm European oak palette (wheaten oat, biscuit, golden honey, warm heartwood)
    const oakPlankPalette: ReadonlyArray<readonly [number, number, number]> = [
      [192, 160, 121],
      [176, 143, 104],
      [204, 174, 135],
      [168, 135, 97],
      [198, 167, 128],
      [183, 150, 111],
      [172, 139, 101],
      [209, 180, 142],
      [187, 155, 116],
      [179, 147, 109],
      [201, 170, 131],
      [165, 133, 96],
    ];

    const hashBoard = (row: number, board: number, salt: number): number => {
      let h = (Math.imul(row + 11, 374761393) + Math.imul(board + 7, 668265263) + Math.imul(salt, 1442695041)) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };

    // 10 staggered courses with 2-3 unequal board lengths per course and golden-ratio phase offsets
    // + explicit repulsion from neighboring courses so header end-joints never align or form diagonal steps.
    const numRows = 10;
    const rowBoundsY: number[] = [];
    for (let r = 0; r <= numRows; r++) {
      rowBoundsY.push(Math.round((r * size) / numRows));
    }

    const rawCourseProportions: ReadonlyArray<ReadonlyArray<number>> = [
      [0.44, 0.31, 0.25],
      [0.61, 0.39],
      [0.29, 0.43, 0.28],
      [0.36, 0.26, 0.38],
      [0.57, 0.43],
      [0.33, 0.41, 0.26],
      [0.47, 0.24, 0.29],
      [0.63, 0.37],
      [0.27, 0.38, 0.35],
      [0.41, 0.33, 0.26],
    ];

    const courseInteriorJoints: number[][] = [];
    for (let row = 0; row < numRows; row++) {
      const props = rawCourseProportions[row]!;
      let phase = (row * PHI + (hashBoard(row, 0, 19) - 0.5) * 0.09 + 10) % 1;
      const prevJoints = row > 0 ? courseInteriorJoints[row - 1]! : [];
      const firstJoints = row === numRows - 1 ? courseInteriorJoints[0]! : [];

      let bestJoints: number[] = [];
      let bestMinClearance = -1;
      for (let attempt = 0; attempt < 11; attempt++) {
        const candPhase = (phase + attempt * 0.083) % 1;
        let acc = candPhase;
        const pts: number[] = [];
        for (let k = 0; k < props.length; k++) {
          const px = Math.round((acc % 1) * size);
          const clamped = Math.max(24, Math.min(size - 24, px));
          pts.push(clamped);
          acc += props[k]!;
        }
        pts.sort((a, b) => a - b);
        // Ensure minimum board length >= 180px inside tile
        let valid = true;
        for (let k = 1; k < pts.length; k++) {
          if (pts[k]! - pts[k - 1]! < 176) valid = false;
        }
        if (pts[0]! + (size - pts[pts.length - 1]!) < 176) valid = false;
        if (!valid) continue;

        let minClear = 9999;
        for (const x of pts) {
          for (const px of prevJoints) {
            const d = Math.abs(x - px);
            minClear = Math.min(minClear, Math.min(d, size - d));
          }
          for (const fx of firstJoints) {
            const d = Math.abs(x - fx);
            minClear = Math.min(minClear, Math.min(d, size - d));
          }
        }
        if (minClear > bestMinClearance) {
          bestMinClearance = minClear;
          bestJoints = pts;
        }
      }
      courseInteriorJoints.push(bestJoints);
    }

    interface PlankSegInfo {
      readonly plankId: number;
      readonly baseR: number;
      readonly baseG: number;
      readonly baseB: number;
      readonly heightBias: number;
      readonly roughBias: number;
      readonly sapSide: number;
      readonly phaseU: number;
      readonly phaseV: number;
      readonly isQuarterSawn: boolean;
      readonly logCenterY: number;
      readonly logDepth: number;
      readonly logSlope: number;
      readonly ringFreq: number;
      readonly hasRayFleck: boolean;
      readonly hasPinKnot: boolean;
      readonly kx: number;
      readonly ky: number;
      readonly rx: number;
      readonly ry: number;
      readonly knotAngleCos: number;
      readonly knotAngleSin: number;
      readonly wrapsLeft: boolean;
      readonly xStartWorld: number;
      readonly plankLen: number;
    }

    return buildFloorPbrTextureBundle({
      key: 'engineered-oak-floor',
      width: size,
      height: size,
      normalStrength: 2.35,
      anisotropy: 8,
      populate: (albedo, heightField, roughField) => {
        for (let row = 0; row < numRows; row++) {
          const y0 = rowBoundsY[row]!;
          const y1 = rowBoundsY[row + 1]!;
          const rowH = y1 - y0;
          const interior = courseInteriorJoints[row]!;
          const joints = [0, ...interior, size];
          const wrapsSeam = true;
          const numSegs = joints.length - 1;
          const segInfos: PlankSegInfo[] = [];

          for (let seg = 0; seg < numSegs; seg++) {
            const xStart = joints[seg]!;
            const xEnd = joints[seg + 1]!;
            const plankId = seg === numSegs - 1 ? 0 : seg;

            // Permute palette index without neighbor collisions
            const palIdx = Math.floor(hashBoard(row, plankId, 23) * oakPlankPalette.length) % oakPlankPalette.length;
            const pal = oakPlankPalette[palIdx]!;
            // Genuine board-to-board lightness (±8.5%) & warm honey/biscuit tint variation
            const warmthShift = (hashBoard(row, plankId, 37) - 0.5) * 22.0;
            const valShift = (hashBoard(row, plankId, 59) - 0.5) * 24.0;
            const baseR = pal[0] + warmthShift + valShift;
            const baseG = pal[1] + warmthShift * 0.85 + valShift * 0.92;
            const baseB = pal[2] + warmthShift * 0.64 + valShift * 0.80;

            const heightBias = (hashBoard(row, plankId, 83) - 0.5) * 0.048;
            const roughBias = (hashBoard(row, plankId, 107) - 0.5) * 0.085;
            const sapSide = hashBoard(row, plankId, 127) > 0.5 ? 1 : -1;
            const phaseU = hashBoard(row, plankId, 149);
            const phaseV = hashBoard(row, plankId, 173);

            // ~62% calm quarter-sawn / rift-sawn boards, ~38% gentle crown-cut boards
            const cutRoll = hashBoard(row, plankId, 199);
            const isQuarterSawn = cutRoll < 0.62;
            const logCenterY = isQuarterSawn
              ? (hashBoard(row, plankId, 223) > 0.5 ? -0.85 : 1.85) + (hashBoard(row, plankId, 239) - 0.5) * 0.4
              : 0.24 + hashBoard(row, plankId, 223) * 0.52;
            const logDepth = isQuarterSawn
              ? 0.42 + hashBoard(row, plankId, 251) * 0.55
              : 0.20 + hashBoard(row, plankId, 251) * 0.28;
            const logSlope = (hashBoard(row, plankId, 269) - 0.5) * (isQuarterSawn ? 0.22 : 0.44);
            const ringFreq = isQuarterSawn
              ? 7.2 + hashBoard(row, plankId, 283) * 3.8
              : 5.4 + hashBoard(row, plankId, 283) * 2.6;
            const hasRayFleck = isQuarterSawn
              ? hashBoard(row, plankId, 307) > 0.25
              : hashBoard(row, plankId, 307) > 0.76;

            let xStartWorld = xStart;
            let plankLen = xEnd - xStart;
            if (seg === 0) {
              const tailStart = joints[numSegs - 1]!;
              xStartWorld = tailStart - size;
              plankLen = xEnd + (size - tailStart);
            } else if (seg === numSegs - 1) {
              plankLen = joints[1]! + (size - xStart);
            }

            // Rare, tiny, warm-amber intergrown pin-knots (only 3 subtle pin-knots across ~28 boards, never dark black landmarks)
            const segW = xEnd - xStart;
            const hasPinKnot =
              segW >= 220 &&
              seg > 0 &&
              seg < numSegs - 1 &&
              ((row === 2 && plankId === 1) ||
                (row === 6 && plankId === 1) ||
                (row === 8 && plankId === 2));
            const kFracX = 0.28 + hashBoard(row, plankId, 331) * 0.44;
            const kFracY = 0.28 + hashBoard(row, plankId, 353) * 0.44;
            const knotAngle = (hashBoard(row, plankId, 379) - 0.5) * 0.55;

            segInfos.push({
              plankId,
              baseR,
              baseG,
              baseB,
              heightBias,
              roughBias,
              sapSide,
              phaseU,
              phaseV,
              isQuarterSawn,
              logCenterY,
              logDepth,
              logSlope,
              ringFreq,
              hasRayFleck,
              hasPinKnot,
              kx: xStart + segW * kFracX,
              ky: y0 + rowH * kFracY,
              rx: 3.4 + hashBoard(row, plankId, 401) * 1.9,
              ry: 2.1 + hashBoard(row, plankId, 419) * 1.2,
              knotAngleCos: Math.cos(knotAngle),
              knotAngleSin: Math.sin(knotAngle),
              wrapsLeft: seg === numSegs - 1,
              xStartWorld,
              plankLen: Math.max(80, plankLen),
            });
          }

          for (let ly = 0; ly < rowH; ly++) {
            const py = y0 + ly;
            const vGlobal = py / size;
            const across = (ly + 0.5) / rowH;
            const distLongEdgePx = Math.min(ly + 0.5, rowH - (ly + 0.5));

            let segIdx = 0;
            for (let px = 0; px < size; px++) {
              while (segIdx < numSegs - 1 && px >= joints[segIdx + 1]!) {
                segIdx++;
              }
              const info = segInfos[segIdx]!;
              const xStart = joints[segIdx]!;
              const xEnd = joints[segIdx + 1]!;
              const uGlobal = px / size;

              const distLeftButt = xStart === 0 && wrapsSeam ? 999 : px + 0.5 - xStart;
              const distRightButt = xEnd === size && wrapsSeam ? 999 : xEnd - (px + 0.5);
              const distButtPx = Math.min(distLeftButt, distRightButt);

              const worldPx = info.wrapsLeft ? px - size : px;
              const along = (worldPx - info.xStartWorld) / info.plankLen;

              // Full [0, 1) per-board UV phase decorrelation
              const uBoard = uGlobal + info.phaseU;
              const vBoard = vGlobal + info.phaseV;

              let acrossDeflected = across;
              let pinKnotMask = 0;
              let pinKnotCore = 0;
              if (info.hasPinKnot) {
                const rawDx = px - info.kx;
                const rawDy = py - info.ky;
                const dx = rawDx * info.knotAngleCos + rawDy * info.knotAngleSin;
                const dy = -rawDx * info.knotAngleSin + rawDy * info.knotAngleCos;
                const nx = dx / (info.rx * 3.2);
                const ny = dy / (info.ry * 3.0);
                const d2 = nx * nx + ny * ny;
                if (d2 < 2.6) {
                  const deflect = 1 - THREE.MathUtils.clamp(d2 / 2.6, 0, 1);
                  const dir = dy >= 0 ? 1 : -1;
                  acrossDeflected += dir * deflect * deflect * (info.ry / rowH) * 1.15;
                  const ang = Math.atan2(dy, dx) / (Math.PI * 2);
                  const wobble =
                    1 +
                    fastSinTurn(ang * 3 + info.phaseU) * 0.18 +
                    fastCosTurn(ang * 5 + info.phaseV) * 0.11;
                  const coreD = Math.hypot(dx / info.rx, dy / info.ry) / wobble;
                  if (coreD < 1.45) {
                    pinKnotMask = 1 - THREE.MathUtils.smoothstep(coreD, 0.25, 1.45);
                    pinKnotCore = 1 - THREE.MathUtils.smoothstep(coreD, 0.0, 0.65);
                  }
                }
              }

              // Multi-octave organic domain warp (periodic over uBoard/vBoard so wrap seams are seamless)
              const warpLow =
                valueNoise2Periodic(uBoard, vBoard, 6, 16, 401) - 0.5;
              const warpMid =
                valueNoise2Periodic(uBoard * 1.0, vBoard * 1.0, 14, 38, 439) - 0.5;
              const domainWarp = warpLow * 0.085 + warpMid * 0.036;

              // Off-axis 3D cylinder growth-ring slice (quarter-sawn straight grain vs gentle crown arches)
              const dyLog = (acrossDeflected - info.logCenterY) * (info.isQuarterSawn ? 1.12 : 1.95);
              const dzLog =
                info.logDepth +
                (along - 0.5) * info.logSlope +
                domainWarp * (info.isQuarterSawn ? 0.55 : 0.85);
              const rLog = Math.hypot(dyLog, dzLog);
              const ringPhase = rLog * info.ringFreq + warpMid * 0.55;
              const ringFrac = ringPhase - Math.floor(ringPhase);
              // Asymmetric ring-porous oak transition: narrow darker latewood/earlywood pore band, broad warm heartwood
              const ringBand =
                THREE.MathUtils.smoothstep(ringFrac, 0.0, 0.18) *
                (1 - THREE.MathUtils.smoothstep(ringFrac, 0.22, 0.68));
              const latewood = 1 - ringBand;

              const fineFiber = valueNoise2Periodic(uBoard, vBoard, 24, 210, 509);
              const microStreak = valueNoise2Periodic(uBoard, vBoard, 10, 96, 547);
              const poreNoise = valueNoise2Periodic(uBoard, vBoard, 48, 340, 613);
              const earlywoodZone = ringBand;
              const openPore =
                poreNoise < 0.19 + earlywoodZone * 0.15
                  ? (0.34 - poreNoise) * (1.7 + earlywoodZone * 0.9)
                  : 0;

              let rayFleck = 0;
              if (info.hasRayFleck) {
                const rayPatch = valueNoise2Periodic(uBoard, vBoard, 18, 22, 733);
                const raySilky = valueNoise2Periodic(uBoard, vBoard, 36, 12, 769);
                if (rayPatch > 0.60 && raySilky > 0.54) {
                  rayFleck =
                    THREE.MathUtils.smoothstep(rayPatch, 0.60, 0.88) *
                    THREE.MathUtils.smoothstep(raySilky, 0.54, 0.86);
                }
              }

              // Subtle within-board sapwood/heartwood gradient and lengthwise organic drift
              const sapGrad = (across - 0.5) * 2 * info.sapSide;
              const sapLift = THREE.MathUtils.clamp(sapGrad, -1, 1) * 4.8;
              const alongDrift = (warpLow * 7.5) + (microStreak - 0.5) * 6.5;

              const longBevel = THREE.MathUtils.smoothstep(distLongEdgePx, 0.5, 2.65);
              const buttBevel = THREE.MathUtils.smoothstep(distButtPx, 0.45, 2.05);
              const grooveFactor = Math.min(longBevel, buttBevel);
              const isGrooveCrevice = grooveFactor < 0.40;

              const grainTone =
                (ringBand - 0.32) * -17.5 +
                (fineFiber - 0.5) * 11.5 +
                alongDrift -
                openPore * 16.5 +
                rayFleck * 13.5 +
                sapLift;

              let r = info.baseR + grainTone;
              let g = info.baseG + grainTone * 0.90;
              let b = info.baseB + grainTone * 0.76 + rayFleck * 2.5;

              // Warm-amber intergrown pin-knot (~18-24% deeper warm honey-amber, NEVER black/dark brown!)
              if (pinKnotMask > 0) {
                const amberR = info.baseR * 0.79;
                const amberG = info.baseG * 0.73;
                const amberB = info.baseB * 0.65;
                r = THREE.MathUtils.lerp(r, amberR, pinKnotMask * 0.68);
                g = THREE.MathUtils.lerp(g, amberG, pinKnotMask * 0.70);
                b = THREE.MathUtils.lerp(b, amberB, pinKnotMask * 0.72);
                if (pinKnotCore > 0) {
                  r = THREE.MathUtils.lerp(r, info.baseR * 0.70, pinKnotCore * 0.55);
                  g = THREE.MathUtils.lerp(g, info.baseG * 0.63, pinKnotCore * 0.55);
                  b = THREE.MathUtils.lerp(b, info.baseB * 0.54, pinKnotCore * 0.55);
                }
              }

              // Crisp micro-bevelled V-grooves on long plank seams and lighter micro-chamfer on header end-joints
              const effectiveCreviceFloor = distLongEdgePx < distButtPx ? 0.44 : 0.54;
              const creviceShade = THREE.MathUtils.lerp(effectiveCreviceFloor, 1.0, grooveFactor);
              const bevelKiss =
                distLongEdgePx >= 2.0 && distLongEdgePx <= 3.6 && ly < 5 ? 4.0 : 0;
              r = r * creviceShade + bevelKiss;
              g = g * creviceShade + bevelKiss * 0.9;
              b = b * creviceShade + bevelKiss * 0.76;

              const idx = py * size + px;
              const o4 = idx * 4;
              albedo[o4] = clampByte(r);
              albedo[o4 + 1] = clampByte(g);
              albedo[o4 + 2] = clampByte(b);
              albedo[o4 + 3] = 255;

              const plankCrown = Math.sin(across * Math.PI) * 0.022;
              const grainRelief =
                latewood * 0.05 +
                (fineFiber - 0.5) * 0.032 -
                openPore * 0.14 +
                rayFleck * 0.018 -
                pinKnotCore * 0.035;
              const hSurface = 0.74 + info.heightBias + plankCrown + grainRelief;
              const grooveDepth = distLongEdgePx < distButtPx ? 0.14 : 0.24;
              heightField[idx] = THREE.MathUtils.clamp(
                THREE.MathUtils.lerp(grooveDepth, hSurface, grooveFactor),
                0,
                1
              );

              let rough =
                0.42 +
                info.roughBias -
                latewood * 0.045 -
                rayFleck * 0.055 +
                (0.5 - fineFiber) * 0.04;
              rough = THREE.MathUtils.clamp(rough, 0.34, 0.52);
              if (openPore > 0.02) {
                const poreT = THREE.MathUtils.clamp(openPore * 1.4, 0, 1);
                rough = THREE.MathUtils.lerp(rough, 0.63, poreT);
              }
              if (pinKnotMask > 0.05) {
                rough = THREE.MathUtils.lerp(rough, 0.52, pinKnotMask * 0.5);
              }
              if (grooveFactor < 0.96) {
                rough = THREE.MathUtils.lerp(
                  0.89,
                  rough,
                  THREE.MathUtils.smoothstep(grooveFactor, 0.18, 0.96)
                );
              }
              if (isGrooveCrevice) {
                rough = 0.89;
              }
              roughField[idx] = rough;
            }
          }
        }
      },
    });
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
