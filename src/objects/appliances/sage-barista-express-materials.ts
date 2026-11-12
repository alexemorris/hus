import * as THREE from 'three';
import {
  getOrCreateCachedCanvas,
  getOrCreateCachedCanvasPair,
  getOrCreateCachedTexture,
} from '../../engine/textures/texture-registry.ts';

export interface SageTextureSuite {
  brushedColor: THREE.CanvasTexture;
  brushedBump: THREE.CanvasTexture;
  spunMetalMap: THREE.CanvasTexture;
  pressureGaugeMap: THREE.CanvasTexture;
  fasciaLegendMap: THREE.CanvasTexture;
  dripGrilleMap: THREE.CanvasTexture;
  dripGrilleAlpha: THREE.CanvasTexture;
  tempStripMap: THREE.CanvasTexture;
  pitcherBadgeMap: THREE.CanvasTexture;
}

function createCanvas2D(
  key: string,
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void
): HTMLCanvasElement {
  return getOrCreateCachedCanvas(key, width, height, (ctx) => draw(ctx));
}

/**
 * Fine horizontal satin-brushed stainless steel map + subtle micro-hairline bump.
 */
function buildBrushedStainlessMaps(): {
  colorMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
} {
  const w = 512;
  const h = 512;
  const [cCol, cBump] = getOrCreateCachedCanvasPair(
    'sage-bes875-brushed-stainless-v2',
    w,
    h,
    (ctxCol, ctxBump) => {
    const grad = ctxCol.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0.0, '#eaedf2');
    grad.addColorStop(0.32, '#e1e5eb');
    grad.addColorStop(0.68, '#eceff4');
    grad.addColorStop(1.0, '#dfe3ea');
    ctxCol.fillStyle = grad;
    ctxCol.fillRect(0, 0, w, h);

    ctxBump.fillStyle = '#808080';
    ctxBump.fillRect(0, 0, w, h);

    let seed = 133742;
    const nextRand = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };

    for (let y = 0; y < h; y++) {
      const r = nextRand();
      const delta = Math.round((r - 0.5) * 13);
      const colVal = Math.max(210, Math.min(248, 231 + delta));
      const bumpVal = Math.max(98, Math.min(162, 128 + delta * 2));

      ctxCol.fillStyle = `rgb(${colVal},${colVal + 1},${colVal + 3})`;
      ctxCol.fillRect(0, y, w, 1);

      ctxBump.fillStyle = `rgb(${bumpVal},${bumpVal},${bumpVal})`;
      ctxBump.fillRect(0, y, w, 1);

      if (y % 4 === 0) {
        const streakCount = 2 + Math.floor(nextRand() * 3);
        for (let s = 0; s < streakCount; s++) {
          const sx = Math.floor(nextRand() * w);
          const sw = 48 + Math.floor(nextRand() * 140);
          const sv = nextRand() > 0.5 ? 244 : 216;
          ctxCol.fillStyle = `rgba(${sv},${sv + 1},${sv + 3},0.20)`;
          ctxCol.fillRect(sx, y, Math.min(sw, w - sx), 1);
        }
      }
    }

    }
  );

  const colorMap = new THREE.CanvasTexture(cCol);
  colorMap.colorSpace = THREE.SRGBColorSpace;
  colorMap.wrapS = THREE.RepeatWrapping;
  colorMap.wrapT = THREE.RepeatWrapping;
  colorMap.needsUpdate = true;

  const bumpMap = new THREE.CanvasTexture(cBump);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.needsUpdate = true;

  return { colorMap, bumpMap };
}

/**
 * Radial spun-metal sheen map for BES875BSS push-button caps and rotary dial face
 * (gives the characteristic cross-star conical specular brush seen in studio photos).
 */
function buildSpunMetalTexture(): THREE.CanvasTexture {
  const size = 128;
  const cx = size * 0.5;
  const cy = size * 0.5;
  const canvas = createCanvas2D('sage-bes875-spun-cap-v2', size, size, (ctx) => {
    ctx.fillStyle = '#dde2ea';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 180; i++) {
      const a = (i / 180) * Math.PI * 2;
      const sheen = Math.cos(a * 2 - 0.85) * 0.72 + Math.cos(a * 4 - 1.7) * 0.28;
      const v = Math.round(206 + sheen * 42);
      ctx.strokeStyle = `rgb(${v},${v + 2},${v + 5})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * size, cy + Math.sin(a) * size);
      ctx.stroke();
    }
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 512x512 procedural Espresso Pressure Gauge dial matching the Sage BES875BSS:
 * silver-white metallic dial face, radial ticks, PRE-INFUSION zone, solid medium-grey
 * ESPRESSO RANGE arc band (10:00 -> 1:30), curved legends, and two dial screws.
 */
function buildPressureGaugeTexture(): THREE.CanvasTexture {
  const size = 512;
  const cx = size * 0.5;
  const cy = size * 0.5;
  const canvas = createCanvas2D('sage-bes875-pressure-gauge-v2', size, size, (ctx) => {
    const bgGrad = ctx.createRadialGradient(
      cx - 36,
      cy - 44,
      18,
      cx,
      cy,
      size * 0.5
    );
    bgGrad.addColorStop(0.0, '#fcfdfe');
    bgGrad.addColorStop(0.70, '#eaedf2');
    bgGrad.addColorStop(0.90, '#cfd6e0');
    bgGrad.addColorStop(1.0, '#b0b8c5');
    ctx.fillStyle = bgGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.495, 0, Math.PI * 2);
    ctx.fill();

    // Inner recessed bevel shadow ring
    ctx.strokeStyle = 'rgba(58, 64, 74, 0.38)';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.468, 0, Math.PI * 2);
    ctx.stroke();

    const degToRad = (deg: number): number => (deg * Math.PI) / 180;
    const startAngle = degToRad(138);
    const preInfEnd = degToRad(176);
    const optStart = degToRad(196);
    const optEnd = degToRad(312);
    const maxAngle = degToRad(402);

    // Solid grey ESPRESSO RANGE optimal zone band
    ctx.strokeStyle = '#5f6672';
    ctx.lineWidth = 34;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.arc(cx, cy, 165, optStart, optEnd);
    ctx.stroke();

    // Subtle PRE-INFUSION arc
    ctx.strokeStyle = '#a5acb7';
    ctx.lineWidth = 13;
    ctx.beginPath();
    ctx.arc(cx, cy, 174, startAngle, preInfEnd);
    ctx.stroke();

    // Outer scale perimeter arc
    ctx.strokeStyle = '#30353e';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, 194, startAngle, maxAngle);
    ctx.stroke();

    // Radial major & minor ticks
    const totalTicks = 28;
    for (let i = 0; i <= totalTicks; i++) {
      const t = i / totalTicks;
      const ang = startAngle + t * (maxAngle - startAngle);
      const isMajor = i % 4 === 0;
      const rOuter = 194;
      const rInner = isMajor ? 158 : 175;
      ctx.strokeStyle = isMajor ? '#1f2329' : '#4d535e';
      ctx.lineWidth = isMajor ? 5.5 : 2.8;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * rInner, cy + Math.sin(ang) * rInner);
      ctx.lineTo(cx + Math.cos(ang) * rOuter, cy + Math.sin(ang) * rOuter);
      ctx.stroke();
    }

    // Dial typography
    ctx.fillStyle = '#2d323a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 21px sans-serif';
    ctx.fillText('ESPRESSO', cx, cy - 72);
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('RANGE', cx, cy - 50);

    ctx.fillStyle = '#474d57';
    ctx.font = 'bold 17px sans-serif';
    ctx.fillText('PRESSURE', cx, cy + 88);

    ctx.save();
    ctx.translate(cx - 118, cy + 44);
    ctx.rotate(degToRad(-66));
    ctx.fillStyle = '#4d535e';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('PRE-INFUSION', 0, 0);
    ctx.restore();

    // Two small silver dial mounting screws flanking bottom center
    for (const sx of [cx - 38, cx + 38]) {
      const sy = cy + 124;
      ctx.fillStyle = '#a8b0bc';
      ctx.beginPath();
      ctx.arc(sx, sy, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#494f5a';
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sx - 6, sy - 4);
      ctx.lineTo(sx + 6, sy + 4);
      ctx.stroke();
    }
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * High-DPI silk-screened fascia graphics + metallic Sage wordmark across the control panel.
 * Maps linearly to X in [-0.140, +0.140] and fascia local Y in [-0.048, +0.042] around fasciaMidY = 0.285.
 */
function buildFasciaLegendTexture(): THREE.CanvasTexture {
  const w = 1024;
  const h = 360;
  const canvas = createCanvas2D('sage-bes875-fascia-legends-v2', w, h, (ctx) => {
    ctx.clearRect(0, 0, w, h);

    // World Y range [0.237, 0.327] (height 0.090 m)
    const toPxX = (xM: number): number => ((xM + 0.140) / 0.280) * w;
    const toPxY = (yM: number): number => ((0.327 - yM) / 0.090) * h;

    // Embossed metallic "Sage" wordmark centered above the pressure gauge (x = 0, y = 0.309)
    const sx = toPxX(0.0);
    const sy = toPxY(0.309);
    ctx.font = 'bold 31px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(42, 47, 56, 0.55)';
    ctx.fillText('Sage', sx + 1.2, sy + 1.5);
    ctx.fillStyle = '#f6f8fc';
    ctx.fillText('Sage', sx - 0.8, sy - 0.8);
    ctx.fillStyle = '#7e8694';
    ctx.fillText('Sage', sx, sy);

    ctx.fillStyle = '#262a31';
    ctx.strokeStyle = '#262a31';

    // POWER label below left power button (-0.120, 0.292)
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('POWER', toPxX(-0.120), toPxY(0.270));

    // GRIND AMOUNT curved ticks & label around (-0.087, 0.292)
    const gx = toPxX(-0.087);
    const gy = toPxY(0.292);
    for (let i = 0; i <= 10; i++) {
      const a = ((-132 + i * 26.4) * Math.PI) / 180 - Math.PI * 0.5;
      const r1 = 52;
      const r2 = i % 5 === 0 ? 60 : 56;
      ctx.lineWidth = i % 5 === 0 ? 2.4 : 1.5;
      ctx.beginPath();
      ctx.moveTo(gx + Math.cos(a) * r1, gy + Math.sin(a) * r1);
      ctx.lineTo(gx + Math.cos(a) * r2, gy + Math.sin(a) * r2);
      ctx.stroke();
    }
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('GRIND AMOUNT', gx, toPxY(0.268));

    // FILTER SIZE + SINGLE / DOUBLE cleanly inside the fascia panel (-0.051, 0.292)
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('FILTER SIZE', toPxX(-0.051), toPxY(0.273));
    ctx.font = 'bold 9.5px sans-serif';
    ctx.fillText('SINGLE', toPxX(-0.060), toPxY(0.256));
    ctx.fillText('DOUBLE', toPxX(-0.042), toPxY(0.256));

    // PROGRAM + CLEAN/DESCALE + HOT WATER/STEAM (+0.051, 0.292)
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('PROGRAM', toPxX(0.051), toPxY(0.273));
    ctx.font = 'bold 8.5px sans-serif';
    ctx.fillText('CLEAN', toPxX(0.041), toPxY(0.258));
    ctx.fillText('DESCALE', toPxX(0.041), toPxY(0.252));
    ctx.fillText('STEAM', toPxX(0.062), toPxY(0.258));
    ctx.fillText('HOT WATER', toPxX(0.062), toPxY(0.252));

    // 1 CUP icon below (+0.087, 0.292) and 2 CUP double icon below (+0.120, 0.292)
    const drawMiniCup = (cxCup: number, cyCup: number): void => {
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(cxCup - 6.5, cyCup - 4.5);
      ctx.lineTo(cxCup - 4.8, cyCup + 4.5);
      ctx.lineTo(cxCup + 4.8, cyCup + 4.5);
      ctx.lineTo(cxCup + 6.5, cyCup - 4.5);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cxCup + 7, cyCup, 3.0, -Math.PI * 0.45, Math.PI * 0.45);
      ctx.stroke();
    };

    drawMiniCup(toPxX(0.087), toPxY(0.268));
    drawMiniCup(toPxX(0.114), toPxY(0.268));
    drawMiniCup(toPxX(0.126), toPxY(0.268));
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Die-cast stainless drip-tray top grille texture + alpha cutout mask.
 */
function buildDripTrayGrilleMaps(): {
  colorMap: THREE.CanvasTexture;
  alphaMap: THREE.CanvasTexture;
} {
  const w = 512;
  const h = 256;
  const [cCol, cAlpha] = getOrCreateCachedCanvasPair(
    'sage-bes875-drip-grille-v2',
    w,
    h,
    (ctxCol, ctxAlpha) => {
    const metalGrad = ctxCol.createLinearGradient(0, 0, 0, h);
    metalGrad.addColorStop(0.0, '#e3e7ed');
    metalGrad.addColorStop(0.5, '#eef1f6');
    metalGrad.addColorStop(1.0, '#d8dde5');
    ctxCol.fillStyle = metalGrad;
    ctxCol.fillRect(0, 0, w, h);

    ctxAlpha.fillStyle = '#ffffff';
    ctxAlpha.fillRect(0, 0, w, h);

    ctxCol.strokeStyle = '#bcc3ce';
    ctxCol.lineWidth = 4;
    ctxCol.strokeRect(10, 10, w - 20, h - 20);

    const drawSlotHole = (
      x: number,
      y: number,
      sw: number,
      sh: number,
      r: number
    ): void => {
      for (const target of [
        { ctx: ctxCol, fill: '#181a1f' },
        { ctx: ctxAlpha, fill: '#000000' },
      ]) {
        target.ctx.fillStyle = target.fill;
        target.ctx.beginPath();
        target.ctx.moveTo(x + r, y);
        target.ctx.lineTo(x + sw - r, y);
        target.ctx.arc(x + sw - r, y + r, r, -Math.PI * 0.5, Math.PI * 0.5);
        target.ctx.lineTo(x + r, y + sh);
        target.ctx.arc(x + r, y + r, r, Math.PI * 0.5, -Math.PI * 0.5);
        target.ctx.closePath();
        target.ctx.fill();
      }
    };

    const cols = 4;
    const rows = 9;
    const marginX = 36;
    const marginY = 30;
    const usableW = w - marginX * 2;
    const usableH = h - marginY * 2;
    const cellW = usableW / cols;
    const cellH = usableH / rows;

    const purgeCx = w * 0.58;
    const purgeCy = h * 0.52;

    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const sx = marginX + c * cellW + 8;
        const sy = marginY + r * cellH + 5;
        const sw = cellW - 16;
        const sh = 8;

        const slotMidX = sx + sw * 0.5;
        const slotMidY = sy + sh * 0.5;
        if (Math.hypot(slotMidX - purgeCx, slotMidY - purgeCy) < 34) continue;
        if (c === 0 && r <= 1) continue;
        drawSlotHole(sx, sy, sw, sh, 4);
      }
    }

    ctxCol.strokeStyle = '#9aa2af';
    ctxCol.lineWidth = 4;
    ctxCol.beginPath();
    ctxCol.arc(purgeCx, purgeCy, 19, 0, Math.PI * 2);
    ctxCol.stroke();

    for (const target of [
      { ctx: ctxCol, fill: '#121418' },
      { ctx: ctxAlpha, fill: '#000000' },
    ]) {
      target.ctx.fillStyle = target.fill;
      target.ctx.beginPath();
      target.ctx.arc(purgeCx, purgeCy, 15, 0, Math.PI * 2);
      target.ctx.fill();
    }

    drawSlotHole(marginX + 8, marginY + 4, 66, 22, 6);
    }
  );

  const colorMap = new THREE.CanvasTexture(cCol);
  colorMap.colorSpace = THREE.SRGBColorSpace;
  colorMap.needsUpdate = true;

  const alphaMap = new THREE.CanvasTexture(cAlpha);
  alphaMap.needsUpdate = true;

  return { colorMap, alphaMap };
}

/**
 * Sage milk pitcher liquid-crystal temperature indicator strip + Sage wordmark decal.
 */
function buildPitcherMaps(): {
  tempStripMap: THREE.CanvasTexture;
  pitcherBadgeMap: THREE.CanvasTexture;
} {
  const cTemp = createCanvas2D('sage-bes875-temp-strip-v2', 256, 64, (ctxTemp) => {
    ctxTemp.fillStyle = '#181a1e';
    ctxTemp.fillRect(0, 0, 256, 64);
    ctxTemp.strokeStyle = '#505661';
    ctxTemp.lineWidth = 3;
    ctxTemp.strokeRect(3, 3, 250, 58);

    const temps = ['55', '60', '65', '70', '75'];
    for (let i = 0; i < temps.length; i++) {
      const bx = 14 + i * 46;
      ctxTemp.fillStyle =
        i === 2 ? '#1e9d5a' : i === 1 ? '#29587a' : '#25282f';
      ctxTemp.fillRect(bx, 12, 38, 40);
      ctxTemp.fillStyle = i === 2 ? '#eafff2' : '#9aa1ad';
      ctxTemp.font = 'bold 17px sans-serif';
      ctxTemp.textAlign = 'center';
      ctxTemp.textBaseline = 'middle';
      ctxTemp.fillText(temps[i], bx + 19, 33);
    }
  });
  const tempStripMap = new THREE.CanvasTexture(cTemp);
  tempStripMap.colorSpace = THREE.SRGBColorSpace;
  tempStripMap.needsUpdate = true;

  const cBadge = createCanvas2D('sage-bes875-pitcher-badge-v2', 128, 64, (ctxBadge) => {
    ctxBadge.clearRect(0, 0, 128, 64);
    ctxBadge.fillStyle = '#2d3138';
    ctxBadge.font = 'bold 28px Georgia, serif';
    ctxBadge.textAlign = 'center';
    ctxBadge.textBaseline = 'middle';
    ctxBadge.fillText('Sage', 64, 32);
  });
  const pitcherBadgeMap = new THREE.CanvasTexture(cBadge);
  pitcherBadgeMap.colorSpace = THREE.SRGBColorSpace;
  pitcherBadgeMap.needsUpdate = true;

  return { tempStripMap, pitcherBadgeMap };
}

export function getSageTextures(): SageTextureSuite {
  return getOrCreateCachedTexture('sage-bes875-texture-suite-v2', () => {
    const brushed = buildBrushedStainlessMaps();
    const spunMetalMap = buildSpunMetalTexture();
    const pressureGaugeMap = buildPressureGaugeTexture();
    const fasciaLegendMap = buildFasciaLegendTexture();
    const grille = buildDripTrayGrilleMaps();
    const pitcher = buildPitcherMaps();
    return {
      brushedColor: brushed.colorMap,
      brushedBump: brushed.bumpMap,
      spunMetalMap,
      pressureGaugeMap,
      fasciaLegendMap,
      dripGrilleMap: grille.colorMap,
      dripGrilleAlpha: grille.alphaMap,
      tempStripMap: pitcher.tempStripMap,
      pitcherBadgeMap: pitcher.pitcherBadgeMap,
    };
  });
}

export interface SageMaterialSuite {
  readonly tex: SageTextureSuite;
  readonly matBrushedSS: THREE.MeshStandardMaterial;
  readonly matFasciaBrushedSS: THREE.MeshStandardMaterial;
  readonly matSpunButtonCap: THREE.MeshStandardMaterial;
  readonly matPolishedChrome: THREE.MeshStandardMaterial;
  readonly matCastAlloy: THREE.MeshStandardMaterial;
  readonly matMatteBlack: THREE.MeshStandardMaterial;
  readonly matGlossBlackHandle: THREE.MeshPhysicalMaterial;
  readonly matSmokedHopper: THREE.MeshPhysicalMaterial;
  readonly matRearTankClear: THREE.MeshPhysicalMaterial;
  readonly matWaterTint: THREE.MeshPhysicalMaterial;
  readonly matLedRingIdle: THREE.MeshStandardMaterial;
  readonly matLedPowerOn: THREE.MeshStandardMaterial;
  readonly matLedWarmDot: THREE.MeshStandardMaterial;
  readonly matEspressoBean: THREE.MeshStandardMaterial;
  readonly matDripSump: THREE.MeshStandardMaterial;
  readonly matFloatIndicator: THREE.MeshStandardMaterial;
  readonly matDripGrille: THREE.MeshStandardMaterial;
  readonly matStoneware: THREE.MeshPhysicalMaterial;
  readonly matFasciaLegend: THREE.MeshBasicMaterial;
  readonly matGaugeShadowSleeve: THREE.MeshStandardMaterial;
  readonly matGaugeDialDisc: THREE.MeshStandardMaterial;
  readonly matGaugeNeedle: THREE.MeshStandardMaterial;
  readonly matGaugeGlass: THREE.MeshPhysicalMaterial;
  readonly matPitcherBadge: THREE.MeshBasicMaterial;
  readonly matTempStrip: THREE.MeshStandardMaterial;
}

let cachedSageMaterialSuite: SageMaterialSuite | null = null;

/**
 * Returns the memoized procedural 9-texture canvas suite & 25-material PBR suite
 * for the Sage the Barista Express (`BES875BSS`) so canvases and materials are
 * instantiated once per session with zero duplicate UUID churn.
 */
export function getSageMaterialSuite(): SageMaterialSuite {
  if (cachedSageMaterialSuite) return cachedSageMaterialSuite;

  const tex = getSageTextures();

  const matBrushedSS = new THREE.MeshStandardMaterial({
    color: 0xe6eaf0,
    map: tex.brushedColor,
    bumpMap: tex.brushedBump,
    bumpScale: 0.0006,
    metalness: 0.84,
    roughness: 0.27,
  });

  // Slightly richer satin steel on the 12.5 deg upward-tilted fascia so overhead lights
  // preserve silky metallic contrast and keep silk-screened legends crisp
  const matFasciaBrushedSS = new THREE.MeshStandardMaterial({
    color: 0xcad0da,
    map: tex.brushedColor,
    bumpMap: tex.brushedBump,
    bumpScale: 0.00055,
    metalness: 0.68,
    roughness: 0.38,
    envMapIntensity: 0.62,
  });

  const matSpunButtonCap = new THREE.MeshStandardMaterial({
    color: 0xdce2ec,
    map: tex.spunMetalMap,
    metalness: 0.82,
    roughness: 0.25,
    envMapIntensity: 0.68,
  });

  const matPolishedChrome = new THREE.MeshStandardMaterial({
    color: 0xf6f8fb,
    metalness: 0.95,
    roughness: 0.09,
  });

  const matCastAlloy = new THREE.MeshStandardMaterial({
    color: 0xd6dce5,
    metalness: 0.82,
    roughness: 0.29,
  });

  const matMatteBlack = new THREE.MeshStandardMaterial({
    color: 0x131518,
    metalness: 0.08,
    roughness: 0.56,
    envMapIntensity: 0.34,
  });

  const matGlossBlackHandle = new THREE.MeshPhysicalMaterial({
    color: 0x0f1114,
    metalness: 0.06,
    roughness: 0.16,
    clearcoat: 0.9,
    clearcoatRoughness: 0.1,
    envMapIntensity: 0.44,
  });

  const matSmokedHopper = new THREE.MeshPhysicalMaterial({
    color: 0x2d2927,
    transparent: true,
    opacity: 0.36,
    roughness: 0.08,
    metalness: 0.02,
    ior: 1.49,
    clearcoat: 0.9,
    clearcoatRoughness: 0.08,
  });

  const matRearTankClear = new THREE.MeshPhysicalMaterial({
    color: 0xdbe5ee,
    transparent: true,
    opacity: 0.36,
    roughness: 0.08,
    metalness: 0.02,
    ior: 1.46,
    clearcoat: 0.65,
  });

  const matWaterTint = new THREE.MeshPhysicalMaterial({
    color: 0xc8deec,
    transparent: true,
    opacity: 0.26,
    roughness: 0.05,
    metalness: 0.0,
  });

  const matLedRingIdle = new THREE.MeshStandardMaterial({
    color: 0x565e6a,
    emissive: 0xd8e4f5,
    emissiveIntensity: 0.22,
    roughness: 0.28,
    metalness: 0.15,
  });

  const matLedPowerOn = new THREE.MeshStandardMaterial({
    color: 0xeef5ff,
    emissive: 0xd6e8ff,
    emissiveIntensity: 0.5,
    roughness: 0.2,
    metalness: 0.08,
  });

  const matLedWarmDot = new THREE.MeshStandardMaterial({
    color: 0xffe4b8,
    emissive: 0xffb85c,
    emissiveIntensity: 0.5,
    roughness: 0.28,
  });

  const matEspressoBean = new THREE.MeshStandardMaterial({
    color: 0x25140c,
    roughness: 0.32,
    metalness: 0.04,
    envMapIntensity: 0.4,
  });

  const matDripSump = new THREE.MeshStandardMaterial({
    color: 0x101216,
    roughness: 0.85,
    metalness: 0.1,
  });
  const matFloatIndicator = new THREE.MeshStandardMaterial({
    color: 0xc92c24,
    roughness: 0.36,
    metalness: 0.08,
  });
  const matDripGrille = new THREE.MeshStandardMaterial({
    color: 0xe6eaf0,
    map: tex.dripGrilleMap,
    alphaMap: tex.dripGrilleAlpha,
    transparent: true,
    alphaTest: 0.25,
    metalness: 0.82,
    roughness: 0.26,
  });
  const matStoneware = new THREE.MeshPhysicalMaterial({
    color: 0xf4f1ea,
    roughness: 0.22,
    metalness: 0.0,
    clearcoat: 0.65,
    clearcoatRoughness: 0.14,
  });
  const matFasciaLegend = new THREE.MeshBasicMaterial({
    map: tex.fasciaLegendMap,
    transparent: true,
    depthWrite: false,
  });
  const matGaugeShadowSleeve = new THREE.MeshStandardMaterial({
    color: 0x2c313a,
    roughness: 0.65,
    metalness: 0.25,
    side: THREE.BackSide,
  });
  const matGaugeDialDisc = new THREE.MeshStandardMaterial({
    map: tex.pressureGaugeMap,
    roughness: 0.72,
    metalness: 0.04,
    envMapIntensity: 0.28,
  });
  const matGaugeNeedle = new THREE.MeshStandardMaterial({
    color: 0xc91c1c,
    roughness: 0.28,
    metalness: 0.12,
  });
  const matGaugeGlass = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.09,
    roughness: 0.04,
    metalness: 0.04,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    depthWrite: false,
  });
  const matPitcherBadge = new THREE.MeshBasicMaterial({
    map: tex.pitcherBadgeMap,
    transparent: true,
    depthWrite: false,
  });
  const matTempStrip = new THREE.MeshStandardMaterial({
    map: tex.tempStripMap,
    roughness: 0.32,
    metalness: 0.08,
  });

  cachedSageMaterialSuite = {
    tex,
    matBrushedSS,
    matFasciaBrushedSS,
    matSpunButtonCap,
    matPolishedChrome,
    matCastAlloy,
    matMatteBlack,
    matGlossBlackHandle,
    matSmokedHopper,
    matRearTankClear,
    matWaterTint,
    matLedRingIdle,
    matLedPowerOn,
    matLedWarmDot,
    matEspressoBean,
    matDripSump,
    matFloatIndicator,
    matDripGrille,
    matStoneware,
    matFasciaLegend,
    matGaugeShadowSleeve,
    matGaugeDialDisc,
    matGaugeNeedle,
    matGaugeGlass,
    matPitcherBadge,
    matTempStrip,
  };
  return cachedSageMaterialSuite;
}
