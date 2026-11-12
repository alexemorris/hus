import { isRecordingCanvasStub } from '../../../engine/textures/texture-registry.ts';
import * as THREE from 'three';
import { getOrCreateCachedPropTexture } from '../../../engine/textures/texture-registry.ts';

/**
 * Generates a 512x512 procedural Land Rover Santorini Black Metallic (`#0d0f13` deep obsidian base
 * with fine `#1e242d` and `#2c3542` metallic micro-flake sheen) automotive paint texture.
 */
export function createSantoriniBlackMetallicTexture(): THREE.CanvasTexture {
  return getOrCreateCachedPropTexture('defender:santorini-black', () => {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, '#0d0f13');
  grad.addColorStop(0.28, '#151920');
  grad.addColorStop(0.52, '#1e242d');
  grad.addColorStop(0.76, '#14181f');
  grad.addColorStop(1, '#0b0d11');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const img = ctx.getImageData(0, 0, size, size);
  const data = img.data;
  for (let i = 0; i < size * size; i++) {
    const idx = i * 4;
    const h1 = Math.sin(i * 12.9898 + 7.3) * 43758.5453;
    const f1 = h1 - Math.floor(h1);
    const h2 = Math.sin(i * 78.233 + 1.9) * 19341.1234;
    const f2 = h2 - Math.floor(h2);
    const flake = (f1 - 0.5) * 14 + (f2 > 0.86 ? 12 : 0);
    data[idx] = Math.max(8, Math.min(68, Math.round(data[idx]! + flake * 0.85)));
    data[idx + 1] = Math.max(10, Math.min(78, Math.round(data[idx + 1]! + flake * 0.95)));
    data[idx + 2] = Math.max(14, Math.min(92, Math.round(data[idx + 2]! + flake * 1.15)));
  }
  if (!isRecordingCanvasStub(canvas)) {
    const dTex = new THREE.DataTexture(
      new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength),
      size,
      size,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    );
    dTex.colorSpace = THREE.SRGBColorSpace;
    dTex.wrapS = THREE.RepeatWrapping;
    dTex.wrapT = THREE.RepeatWrapping;
    dTex.repeat.set(3, 3);
    dTex.flipY = true;
    dTex.magFilter = THREE.LinearFilter;
    dTex.minFilter = THREE.LinearMipmapLinearFilter;
    dTex.generateMipmaps = true;
    dTex.anisotropy = 8;
    dTex.needsUpdate = true;
    return dTex as unknown as THREE.CanvasTexture;
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
  });
}

/**
 * Generates a 256x256 procedural diamond-pattern chequer-plate texture for the L663 Defender
 * bonnet tread plates and side rock-slider step pads.
 */
export function createDiamondChequerPlateTexture(): THREE.CanvasTexture {
  return getOrCreateCachedPropTexture('defender:chequer-plate', () => {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  ctx.fillStyle = '#181c22';
  ctx.fillRect(0, 0, size, size);

  const step = 16;
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      const isAlt = ((x / step + y / step) & 1) === 1;
      ctx.save();
      ctx.translate(x + step * 0.5, y + step * 0.5);
      ctx.rotate(isAlt ? Math.PI / 4 : -Math.PI / 4);

      ctx.fillStyle = '#2d333d';
      ctx.beginPath();
      ctx.ellipse(0, 0, step * 0.34, step * 0.13, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#404854';
      ctx.beginPath();
      ctx.ellipse(-1, -1, step * 0.24, step * 0.07, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 2);
  return tex;
  });
}

/**
 * Generates a crisp Satin Black / Shadow Atlas `D E F E N D E R` bonnet edge lettering texture.
 */
export function createDefenderBonnetLetteringTexture(): THREE.CanvasTexture {
  return getOrCreateCachedPropTexture('defender:bonnet-lettering', () => {
  const w = 512;
  const h = 64;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  ctx.clearRect(0, 0, w, h);

  // Subtle dark metallic backing shadow + crisp anthracite/silver-edged Black Pack lettering
  ctx.font = 'bold 36px "Arial Black", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const chars = ['D', 'E', 'F', 'E', 'N', 'D', 'E', 'R'];
  const spacing = w / (chars.length + 1);
  for (let i = 0; i < chars.length; i++) {
    const cx = spacing * (i + 1);
    const cy = h * 0.52;
    ctx.strokeStyle = '#4a5362';
    ctx.lineWidth = 3.5;
    ctx.strokeText(chars[i]!, cx, cy);
    ctx.fillStyle = '#14171c';
    ctx.fillText(chars[i]!, cx, cy);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
  });
}

/**
 * Generates the iconic oval Land Rover badge texture (Black Pack dark anthracite/emerald oval with silver script).
 */
export function createLandRoverOvalBadgeTexture(): THREE.CanvasTexture {
  return getOrCreateCachedPropTexture('defender:oval-badge', () => {
  const w = 256;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  ctx.clearRect(0, 0, w, h);

  // Outer chrome/satin silver oval ring
  ctx.fillStyle = '#0d261c';
  ctx.strokeStyle = '#c8d0dc';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 0.5, w * 0.45, h * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = '#788496';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 0.5, w * 0.41, h * 0.37, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#e6ecf5';
  ctx.font = 'bold 26px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('LAND', w * 0.5, h * 0.36);
  ctx.fillText('ROVER', w * 0.5, h * 0.66);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
  });
}

/**
 * Generates a crisp UK registration plate (`DEF 110X`) texture (white front / yellow rear).
 */
export function createUkNumberPlateTexture(isRearYellow: boolean): THREE.CanvasTexture {
  return getOrCreateCachedPropTexture(`defender:plate:${isRearYellow ? 1 : 0}`, () => {
  const w = 512;
  const h = 112;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  ctx.fillStyle = isRearYellow ? '#f2b705' : '#f4f6f8';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = '#15181c';
  ctx.lineWidth = 6;
  ctx.strokeRect(5, 5, w - 10, h - 10);

  ctx.fillStyle = '#0d3b8c';
  ctx.fillRect(8, 8, 48, h - 16);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('UK', 32, h * 0.62);

  ctx.fillStyle = '#111317';
  ctx.font = 'bold 64px "Arial Narrow", Impact, sans-serif';
  ctx.fillText('DEF 110X', w * 0.55, h * 0.54);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
  });
}

/**
 * Generates a ventilated 380mm steel brake rotor texture with radial cooling slots.
 */
export function createVentilatedSteelRotorTexture(): THREE.CanvasTexture {
  return getOrCreateCachedPropTexture('defender:rotor', () => {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const cx = size * 0.5;
  const cy = size * 0.5;

  ctx.fillStyle = '#7a828e';
  ctx.fillRect(0, 0, size, size);

  for (let r = 76; r < 246; r += 2) {
    ctx.strokeStyle = r % 4 === 0 ? 'rgba(182, 190, 202, 0.5)' : 'rgba(72, 78, 88, 0.45)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Dark central hat & radial ventilation grooves
  ctx.fillStyle = '#22262d';
  ctx.beginPath();
  ctx.arc(cx, cy, 88, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#262b33';
  ctx.lineWidth = 3.2;
  const slots = 24;
  for (let s = 0; s < slots; s++) {
    const a0 = (s / slots) * Math.PI * 2;
    const a1 = a0 + 0.14;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a0) * 102, cy + Math.sin(a0) * 102);
    ctx.lineTo(cx + Math.cos(a1) * 232, cy + Math.sin(a1) * 232);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
  });
}

/**
 * Generates a Goodyear Wrangler All-Terrain Adventure sidewall + shoulder lug texture.
 */
export function createAllTerrainTireSidewallTexture(): THREE.CanvasTexture {
  return getOrCreateCachedPropTexture('defender:tire-sidewall', () => {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const cx = size * 0.5;
  const cy = size * 0.5;

  ctx.fillStyle = '#181b1f';
  ctx.fillRect(0, 0, size, size);

  // Subtle concentric sidewall ribs
  for (const r of [156, 168, 212, 224]) {
    ctx.strokeStyle = '#252a30';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 36 aggressive outer shoulder tread lugs around perimeter
  const lugs = 36;
  for (let i = 0; i < lugs; i++) {
    const ang = (i / lugs) * Math.PI * 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.fillStyle = i % 2 === 0 ? '#242930' : '#1f242a';
    ctx.fillRect(218, -7, 32, 14);
    ctx.restore();
  }

  // Subtle moulded sidewall lettering arcs ("GOODYEAR WRANGLER ALL-TERRAIN ADVENTURE 275/45 R22")
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = '#383f49';
  ctx.font = 'bold 14px Arial, sans-serif';
  ctx.textAlign = 'center';
  const topText = 'GOODYEAR WRANGLER ALL-TERRAIN';
  for (let i = 0; i < topText.length; i++) {
    const a = -Math.PI * 0.78 + i * 0.056;
    ctx.save();
    ctx.rotate(a);
    ctx.fillText(topText[i]!, 0, -188);
    ctx.restore();
  }
  const botText = '275/45 R22 112W M+S DEFENDER';
  for (let i = 0; i < botText.length; i++) {
    const a = Math.PI * 0.22 + i * 0.056;
    ctx.save();
    ctx.rotate(a);
    ctx.fillText(botText[i]!, 0, -188);
    ctx.restore();
  }
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
  });
}

/**
 * Generates a soft radial under-chassis ambient occlusion contact shadow texture.
 */
export function createUnderCarShadowTexture(): THREE.CanvasTexture {
  return getOrCreateCachedPropTexture('defender:shadow', () => {
  const w = 512;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  ctx.clearRect(0, 0, w, h);
  const grad = ctx.createRadialGradient(w * 0.5, h * 0.5, 22, w * 0.5, h * 0.5, w * 0.49);
  grad.addColorStop(0, 'rgba(5, 7, 10, 0.86)');
  grad.addColorStop(0.58, 'rgba(7, 9, 14, 0.64)');
  grad.addColorStop(0.85, 'rgba(9, 12, 18, 0.24)');
  grad.addColorStop(1, 'rgba(9, 12, 18, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
  });
}

export interface Defender110Materials {
  santoriniBlackBodyMat: THREE.MeshStandardMaterial;
  narvikGlossBlackMat: THREE.MeshStandardMaterial;
  satinAnthraciteMat: THREE.MeshStandardMaterial;
  chequerPlateMat: THREE.MeshStandardMaterial;
  tintedPrivacyGlassMat: THREE.MeshStandardMaterial;
  clearPolycarbonateLensMat: THREE.MeshStandardMaterial;
  smokedLensMat: THREE.MeshStandardMaterial;
  ledHaloWhiteMat: THREE.MeshStandardMaterial;
  ledCrimsonRedMat: THREE.MeshStandardMaterial;
  ledAmberPipMat: THREE.MeshStandardMaterial;
  tireRubberMat: THREE.MeshStandardMaterial;
  tireSidewallMat: THREE.MeshStandardMaterial;
  steelRotorMat: THREE.MeshStandardMaterial;
  xenonBlueCaliperMat: THREE.MeshStandardMaterial;
  chromeLugMat: THREE.MeshStandardMaterial;
  landRoverBadgeMat: THREE.MeshStandardMaterial;
  ebonyWindsorLeatherMat: THREE.MeshStandardMaterial;
  magnesiumCrossBeamMat: THREE.MeshStandardMaterial;
}

/**
 * Creates the full PBR material palette for the Land Rover Defender 110 (L663 V8 Carpathian / Black Pack).
 */
export function createDefender110Materials(): Defender110Materials {
  const santoriniBlackTex = createSantoriniBlackMetallicTexture();
  const santoriniBlackBodyMat = new THREE.MeshStandardMaterial({
    color: 0x16191f,
    map: santoriniBlackTex,
    emissive: new THREE.Color(0x05070a),
    emissiveIntensity: 0.22,
    roughness: 0.18,
    metalness: 0.48,
    side: THREE.DoubleSide,
  });

  const narvikGlossBlackMat = new THREE.MeshStandardMaterial({
    color: 0x0c0e12,
    emissive: new THREE.Color(0x030406),
    emissiveIntensity: 0.14,
    roughness: 0.12,
    metalness: 0.55,
    side: THREE.DoubleSide,
  });

  const satinAnthraciteMat = new THREE.MeshStandardMaterial({
    color: 0x282d35,
    emissive: new THREE.Color(0x06080b),
    emissiveIntensity: 0.15,
    roughness: 0.36,
    metalness: 0.62,
    side: THREE.DoubleSide,
  });

  const chequerPlateTex = createDiamondChequerPlateTexture();
  const chequerPlateMat = new THREE.MeshStandardMaterial({
    color: 0x242932,
    map: chequerPlateTex,
    roughness: 0.42,
    metalness: 0.54,
    side: THREE.DoubleSide,
  });

  const tintedPrivacyGlassMat = new THREE.MeshStandardMaterial({
    color: 0x121c26,
    roughness: 0.06,
    metalness: 0.22,
    transparent: true,
    opacity: 0.56,
    side: THREE.DoubleSide,
  });

  const clearPolycarbonateLensMat = new THREE.MeshStandardMaterial({
    color: 0xe8f2ff,
    roughness: 0.05,
    metalness: 0.14,
    transparent: true,
    opacity: 0.42,
    side: THREE.DoubleSide,
  });

  const smokedLensMat = new THREE.MeshStandardMaterial({
    color: 0x1a1216,
    roughness: 0.08,
    metalness: 0.24,
    transparent: true,
    opacity: 0.62,
    side: THREE.DoubleSide,
  });

  const ledHaloWhiteMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: new THREE.Color(0xf2f8ff),
    emissiveIntensity: 2.5,
    roughness: 0.08,
  });

  const ledCrimsonRedMat = new THREE.MeshStandardMaterial({
    color: 0xff1c22,
    emissive: new THREE.Color(0xff161c),
    emissiveIntensity: 2.4,
    roughness: 0.12,
  });

  const ledAmberPipMat = new THREE.MeshStandardMaterial({
    color: 0xffa018,
    emissive: new THREE.Color(0xff8800),
    emissiveIntensity: 1.8,
    roughness: 0.15,
  });

  const tireRubberMat = new THREE.MeshStandardMaterial({
    color: 0x181b20,
    roughness: 0.78,
    metalness: 0.06,
    side: THREE.DoubleSide,
  });

  const tireSidewallMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: createAllTerrainTireSidewallTexture(),
    roughness: 0.72,
    metalness: 0.08,
  });

  const steelRotorMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: createVentilatedSteelRotorTexture(),
    roughness: 0.28,
    metalness: 0.72,
  });

  const xenonBlueCaliperMat = new THREE.MeshStandardMaterial({
    color: 0x1278c4, // Land Rover Defender V8 Xenon Blue / Black caliper contrast
    emissive: new THREE.Color(0x041e38),
    emissiveIntensity: 0.24,
    roughness: 0.22,
    metalness: 0.38,
  });

  const chromeLugMat = new THREE.MeshStandardMaterial({
    color: 0xd8e0ec,
    roughness: 0.18,
    metalness: 0.85,
  });

  const landRoverBadgeMat = new THREE.MeshStandardMaterial({
    map: createLandRoverOvalBadgeTexture(),
    transparent: true,
    roughness: 0.2,
    metalness: 0.45,
  });

  const ebonyWindsorLeatherMat = new THREE.MeshStandardMaterial({
    color: 0x1c2026,
    roughness: 0.56,
    metalness: 0.06,
  });

  const magnesiumCrossBeamMat = new THREE.MeshStandardMaterial({
    color: 0x3b424e,
    roughness: 0.34,
    metalness: 0.68,
  });

  return {
    santoriniBlackBodyMat,
    narvikGlossBlackMat,
    satinAnthraciteMat,
    chequerPlateMat,
    tintedPrivacyGlassMat,
    clearPolycarbonateLensMat,
    smokedLensMat,
    ledHaloWhiteMat,
    ledCrimsonRedMat,
    ledAmberPipMat,
    tireRubberMat,
    tireSidewallMat,
    steelRotorMat,
    xenonBlueCaliperMat,
    chromeLugMat,
    landRoverBadgeMat,
    ebonyWindsorLeatherMat,
    magnesiumCrossBeamMat,
  };
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Evaluates a piecewise monotone-clamped cubic Hermite spline through sorted `(x, y)` control knots
 * so there is zero overshoot between stations.
 */
export function evalSpline(x: number, knots: readonly (readonly [number, number])[]): number {
  if (x <= knots[0]![0]) return knots[0]![1];
  const last = knots[knots.length - 1]!;
  if (x >= last[0]) return last[1];

  for (let i = 0; i < knots.length - 1; i++) {
    const k0 = knots[i]!;
    const k1 = knots[i + 1]!;
    if (x >= k0[0] && x <= k1[0]) {
      const dx = Math.max(1e-6, k1[0] - k0[0]);
      const u = (x - k0[0]) / dx;
      const km1 = knots[Math.max(0, i - 1)]!;
      const kp2 = knots[Math.min(knots.length - 1, i + 2)]!;
      const m0 = ((k1[1] - km1[1]) / Math.max(1e-5, k1[0] - km1[0])) * dx * 0.8;
      const m1 = ((kp2[1] - k0[1]) / Math.max(1e-5, kp2[0] - k0[0])) * dx * 0.8;
      const u2 = u * u;
      const u3 = u2 * u;
      const h00 = 2 * u3 - 3 * u2 + 1;
      const h10 = u3 - 2 * u2 + u;
      const h01 = -2 * u3 + 3 * u2;
      const h11 = u3 - u2;
      return h00 * k0[1] + h10 * m0 + h01 * k1[1] + h11 * m1;
    }
  }
  return last[1];
}


/**
 * Plan-view wrap-around shift `getPlanWrapShiftX(x, z)`:
 * Captures the L663 Defender's bevelled front fascia corners (`+x` wrap at outer `z`)
 * and curved plan-view rear quarter corners (`-x` wrap into the Kamm tail).
 */
export function getPlanWrapShiftX(x: number, z: number): number {
  const noseWrap = smoothstep(-1.95, -2.38, x);
  const tailWrap = smoothstep(1.98, 2.36, x);
  const zNorm = Math.min(1.12, Math.abs(z) / 0.96);
  const zCurve = Math.pow(zNorm, 2.2);
  return noseWrap * zCurve * 0.115 - tailWrap * zCurve * 0.095;
}

// ============================================================================
// AUTHENTIC LAND ROVER DEFENDER 110 (L663 V8 CARPATHIAN / BLACK PACK) CURVES
// (`x = -2.38m` front bumper face to `x = +2.36m` rear tailgate face, `4.758m` body
//  length, `+2.62m` over rear spare wheel; wheelbase `3.022m` with front axle at
//  `x = -1.51m` and rear axle at `x = +1.51m`; roof crown at `y = 1.967m`)
// ============================================================================

/**
 * 1. Centerline elevation profile `CENTERLINE_Y_KNOTS`:
 *    - Upright front skid pan & H-frame bumper fascia (`x = -2.38m..-2.345m`, rising from `0.33m` to `1.03m`)
 *    - Smooth clamshell bonnet leading edge & long sculpted bonnet (`x = -2.28m..-1.02m`, `y = 1.13m..1.23m`)
 *    - Sleek, raked L663 windshield (`x = -1.02m..-0.38m`, `y = 1.23m..1.92m`)
 *    - Flat, commanding Defender safari roof crown (`x = -0.38m..+2.18m`, `y = 1.92m..1.967m`)
 *    - Vertical cut-off Kamm rear tailgate (`x = +2.26m..+2.36m`, dropping cleanly to the rear skid pan at `y = 0.34m`).
 */
export const CENTERLINE_Y_KNOTS: readonly (readonly [number, number])[] = [
  [-2.38, 0.33],
  [-2.365, 0.68],
  [-2.345, 1.03],
  [-2.28, 1.13], // Leading edge of L663 clamshell bonnet
  [-2.06, 1.172],
  [-1.62, 1.202],
  [-1.02, 1.23], // Base of windshield cowl
  [-0.80, 1.46],
  [-0.58, 1.73],
  [-0.38, 1.92], // Top of raked windshield header
  [-0.16, 1.956],
  [0.45, 1.967], // Peak of Defender 110 roof crown
  [1.35, 1.964],
  [2.08, 1.952],
  [2.26, 1.925], // Rear roof header above tailgate glass
  [2.32, 1.56],
  [2.35, 1.21], // Base of rear tailgate window / waist line
  [2.36, 0.72], // Vertical Kamm tailgate lower face
];

/**
 * 2. Horizontal Defender Barrel Waist Shoulder Line `SHOULDER_Y_KNOTS`:
 *    Runs continuously at `y ≈ 1.21m` from the clamshell bonnet shutline across the doors
 *    to the vertical rear corner pillars (`x = +2.35m`).
 */
export const SHOULDER_Y_KNOTS: readonly (readonly [number, number])[] = [
  [-2.38, 0.33],
  [-2.365, 0.68],
  [-2.345, 1.03],
  [-2.28, 1.12],
  [-2.02, 1.18],
  [-1.51, 1.206], // Above front wheel arch
  [-1.02, 1.212], // Front A-pillar waist (`yShoulder ≈ 1.21m`)
  [0.0, 1.214], // Mid-door horizontal barrel waist shelf
  [0.95, 1.215],
  [1.51, 1.215], // Above rear wheel arch
  [2.15, 1.212],
  [2.32, 1.205], // Rear corner pillar waist
  [2.35, 0.88],
  [2.36, 0.62],
];

/**
 * 3. Plan-View Outer Body Half-Width `BODY_WIDTH_Z_KNOTS`:
 *    Captures the muscular `2.008m` (`z = ±1.004m`) Defender wheel-arch fenders, full-width front bumper corners,
 *    and taut barrel flanks (`z ≈ 0.96m`).
 */
export const BODY_WIDTH_Z_KNOTS: readonly (readonly [number, number])[] = [
  [-2.38, 0.86],
  [-2.33, 0.915],
  [-2.14, 0.956],
  [-1.82, 0.992],
  [-1.51, 1.004], // Muscular front wheel arch flare (`2.008m` width)
  [-1.12, 0.976],
  [-0.75, 0.964],
  [0.0, 0.962], // Door flank width (`z ≈ 0.96m`)
  [0.82, 0.968],
  [1.18, 0.992],
  [1.51, 1.006], // Muscular rear wheel arch flare (`2.012m` width)
  [1.88, 0.988],
  [2.20, 0.948],
  [2.36, 0.89],
];

/**
 * 4. Plan-View Roof Cantrail & Bonnet Crown Half-Width `CROWN_WIDTH_Z_KNOTS`:
 *    Captures the L663 Defender's pronounced tumblehome greenhouse tapering to the chamfered floating roof crown (`zCrown ≈ 0.70m`).
 */
export const CROWN_WIDTH_Z_KNOTS: readonly (readonly [number, number])[] = [
  [-2.38, 0.58],
  [-2.28, 0.68],
  [-1.85, 0.74],
  [-1.35, 0.765],
  [-1.02, 0.775], // Windshield base half-width
  [-0.38, 0.704], // Windshield header half-width (`zCrown ≈ 0.70m`)
  [0.20, 0.700], // Chamfered floating roof cantrail half-width
  [1.20, 0.696],
  [2.08, 0.688],
  [2.28, 0.672],
  [2.36, 0.64],
];

/**
 * Evaluates the smooth rounded-chamfer circular wheel-arch cutout height `yArch(x)` around the
 * front (`x = -1.51m`) and rear (`x = +1.51m`) axles.
 */
export function sampleWheelArchCutoutY(x: number, yBaseSill: number): number {
  const rArch = 0.448;
  const yCenterArch = 0.415;

  for (const xAxle of [-1.51, 1.51] as const) {
    const dx = x - xAxle;
    if (Math.abs(dx) < rArch) {
      // Smooth rounded-chamfer L663 Defender arch profile (`exponent = 2.15`)
      const u = Math.min(1, Math.abs(dx) / rArch);
      const archRise = rArch * Math.pow(Math.max(0, 1 - Math.pow(u, 2.15)), 1 / 2.05);
      return Math.max(yBaseSill, yCenterArch + archRise);
    }
  }
  return yBaseSill;
}

/**
 * Computes a single cross-section half-profile (`nv + 1` points from `z = 0` centerline to lower rocker sill)
 * at longitudinal station `x` (`-2.38m .. +2.36m`).
 */
export function sampleDefenderHalfProfile(x: number, nv: number): [number, number][] {
  const yCenter = evalSpline(x, CENTERLINE_Y_KNOTS);
  const yShoulder = evalSpline(x, SHOULDER_Y_KNOTS);
  const zMax = evalSpline(x, BODY_WIDTH_Z_KNOTS);
  const zCrown = Math.min(zMax * 0.84, evalSpline(x, CROWN_WIDTH_Z_KNOTS));

  const frontApproach = smoothstep(-1.88, -2.38, x);
  const rearDeparture = smoothstep(1.88, 2.36, x);
  const yBaseSill = 0.25 + frontApproach * 0.08 + rearDeparture * 0.09;
  const yArchCut = sampleWheelArchCutoutY(x, yBaseSill);

  const bonnetWeight =
    smoothstep(-2.28, -2.06, x) * (1 - smoothstep(-1.08, -0.92, x));
  const cabinWeight =
    smoothstep(-1.02, -0.42, x) * (1 - smoothstep(2.24, 2.35, x));

  // Smooth monolithic rounded-chamfer fender blister weight around front (`x = -1.51m`) and rear (`x = +1.51m`) wheel arches
  const frontBlister = Math.exp(-Math.pow((x - -1.51) / 0.56, 2));
  const rearBlister = Math.exp(-Math.pow((x - 1.51) / 0.58, 2));
  const archBlister = Math.max(frontBlister, rearBlister);

  const pts: [number, number][] = [];
  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    let y = 0;
    let z = 0;

    if (v <= 0.30) {
      // Region 1: Floating Roof Crown with Chamfered Cantrail Bevel / Raked Windshield / Sculpted Clamshell Bonnet
      const u = v / 0.30;
      z = u * zCrown;
      const roofCamber = cabinWeight * 0.014 * (1 - u * u);
      const cantrailBevel = cabinWeight * 0.024 * smoothstep(0.78, 1.0, u);
      // Central raised V8 bonnet dome (`u < 0.56`) stepping down into the bonnet valley channel (`u ≈ 0.60..0.86`)
      const domeStep = 1 - smoothstep(0.46, 0.66, u);
      const valleyDip =
        smoothstep(0.54, 0.66, u) * (1 - smoothstep(0.74, 0.88, u));
      const bonnetSculpt = bonnetWeight * (domeStep * 0.026 - valleyDip * 0.012);
      y = yCenter + roofCamber - cantrailBevel + bonnetSculpt;
    } else if (v <= 0.56) {
      // Region 2: Tumblehome Greenhouse (`v = 0.30..0.49`) & Crisp Horizontal L663 Barrel Shoulder Shelf (`v = 0.49..0.56`)
      const u = (v - 0.30) / 0.26;
      const uGlass = Math.min(1, u / 0.73);
      const uShelf = Math.max(0, (u - 0.73) / 0.27);
      const yRoofEdge = yCenter - cabinWeight * 0.024;
      const yGlassBase = yShoulder + 0.014;
      const yGreenhouse = lerp(yRoofEdge, yGlassBase, uGlass) - uShelf * 0.014;
      const yBonnetFender = lerp(yCenter, yShoulder, smoothstep(0, 1, u));
      y = lerp(yBonnetFender, yGreenhouse, cabinWeight);

      // Greenhouse tumblehome widens from `zCrown` (`~0.70m`) to `zGlassBase` (`~0.86m`), then steps sharply outward across the horizontal shoulder shelf to `zShoulderOuter` (`~0.96m`)
      const zGlassBase = zMax * 0.888;
      const zShoulderOuter = zMax * 0.985;
      const zGreenhouse =
        lerp(zCrown, zGlassBase, Math.pow(uGlass, 0.92)) +
        smoothstep(0, 1, uShelf) * (zShoulderOuter - zGlassBase);
      const zBonnetFender = lerp(zCrown, zShoulderOuter, Math.pow(u, 0.84));
      z = lerp(zBonnetFender, zGreenhouse, cabinWeight);
    } else if (v <= 0.90) {
      // Region 3: Muscular Lower Body Side Flank & Smooth Monolithic Rounded-Chamfer Fender Blister
      const u = (v - 0.56) / 0.34;
      const yFlankNominal = lerp(yShoulder, yBaseSill + 0.04, u);
      const yClampedMin = yArchCut + 0.024 + (1 - u) * 0.045;
      y = Math.max(yFlankNominal, lerp(yShoulder, yClampedMin, u));

      // Taut barrel side profile with smooth monolithic rounded-chamfer wheel-arch flare
      const barrelCurve = Math.sin(u * Math.PI * 0.85) * 0.016;
      const blisterOut = archBlister * Math.sin(u * Math.PI * 0.92) * 0.018;
      z = lerp(zMax * 0.985, zMax * 0.975, u) + barrelCurve + blisterOut;
    } else {
      // Region 4: Lower Rocker Sill & Wheel-Arch Lip Return Flange
      const u = (v - 0.90) / 0.10;
      const yTop = Math.max(lerp(yShoulder, yBaseSill + 0.04, 1.0), yArchCut + 0.024);
      y = lerp(yTop, yArchCut, u);
      const isWheelArch = smoothstep(yBaseSill + 0.015, yBaseSill + 0.14, yArchCut);
      const tuckIn = lerp(0.055, 0.018, isWheelArch);
      z = zMax * 0.975 - u * tuckIn;
    }

    pts.push([y, Math.max(0, z)]);
  }

  return pts;
}

/**
 * Samples the lateral outer surface `z(x, y)` on the Defender body shell for conformal side glazing & trim.
 */
export function sampleLateralSurfaceZAtXY(x: number, yTarget: number): number {
  const halfPts = sampleDefenderHalfProfile(x, 64);
  let bestZ = halfPts[22]![1];
  let bestDiff = 1e9;
  for (let j = 14; j < 64; j++) {
    const [y0, z0] = halfPts[j]!;
    const [y1, z1] = halfPts[j + 1]!;
    const yMaxSeg = Math.max(y0, y1);
    const yMinSeg = Math.min(y0, y1);
    if (yTarget <= yMaxSeg && yTarget >= yMinSeg) {
      const t = Math.abs(y0 - y1) > 1e-5 ? (yTarget - y0) / (y1 - y0) : 0;
      return lerp(z0, z1, t);
    }
    const diff = Math.abs(y0 - yTarget);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestZ = z0;
    }
  }
  return bestZ;
}

/**
 * Samples the exact 3D front fascia coordinate `vx = xStation + getPlanWrapShiftX(xStation, zTarget)`
 * on the Defender monocoque nose at height `yTarget` (`0.33m .. 1.13m`) and lateral offset `zTarget`
 * so all front grille, headlight, bumper, fog lamp, radar, tow eye, and number plate attachments
 * sit 100% flush with zero floating gap.
 */
export function sampleFrontNoseSurfaceXAtYZ(yTarget: number, zTarget: number): number {
  let lo = -2.38;
  let hi = -2.28;
  const zFrac = Math.min(1, Math.max(0, (Math.abs(zTarget) - 0.58) / 0.32));
  const clampedY = Math.max(0.33, Math.min(1.13, yTarget));
  for (let iter = 0; iter < 18; iter++) {
    const mid = 0.5 * (lo + hi);
    const yMid = lerp(
      evalSpline(mid, CENTERLINE_Y_KNOTS),
      evalSpline(mid, SHOULDER_Y_KNOTS),
      zFrac
    );
    if (yMid < clampedY) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const xSt = 0.5 * (lo + hi);
  return xSt + getPlanWrapShiftX(xSt, zTarget);
}

/**
 * Builds the unified, water-tight, high-density parametric lofted L663 Land Rover Defender 110
 * monocoque body shell (`landRoverDefender.bodyShell`) across 96 longitudinal stations
 * and 97 transverse profile points per station (`computeVertexNormals()` & `computeBoundingSphere()`).
 */
export function createUnifiedDefender110BodyGeometry(): THREE.BufferGeometry {
  const nx = 96; // >= 56 longitudinal stations
  const nv = 48; // 97 transverse profile points per station (>= 44)
  const xMin = -2.38;
  const xMax = 2.36;
  const rowStride = nv * 2 + 1;

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Add 1 front lower skid-pan closure station so the front chin is 100% water-tight
  const firstHalfPts = sampleDefenderHalfProfile(xMin, nv);
  for (let k = -nv; k <= nv; k++) {
    const j = Math.abs(k);
    const signZ = k < 0 ? -1 : k > 0 ? 1 : 0;
    const [, pzOrig] = firstHalfPts[j]!;
    const pz = signZ * pzOrig * 0.92;
    const py = 0.28;
    const vx = -2.32 + getPlanWrapShiftX(xMin, pz);
    positions.push(vx, py, pz);
    uvs.push(0.0, (pz + 1.0) / 2.0);
  }

  for (let i = 0; i <= nx; i++) {
    const t = i / nx;
    const shapedT = 0.5 - 0.5 * Math.cos(t * Math.PI);
    const x = lerp(xMin, xMax, lerp(t, shapedT, 0.28));
    const halfPts = sampleDefenderHalfProfile(x, nv);

    for (let k = -nv; k <= nv; k++) {
      const j = Math.abs(k);
      const signZ = k < 0 ? -1 : k > 0 ? 1 : 0;
      const [py, pzAbs] = halfPts[j]!;
      const pz = signZ * pzAbs;
      const vx = x + getPlanWrapShiftX(x, pz);

      positions.push(vx, py, pz);
      uvs.push((vx - xMin) / (xMax - xMin), (pz + 1.0) / 2.0);
    }
  }

  // Add 2 rear lower bumper / valance closure stations so the vertical Kamm tail is 100% water-tight
  const lastHalfPts = sampleDefenderHalfProfile(xMax, nv);
  for (const [extraX, targetCenterY, tuckScaleZ] of [
    [2.35, 0.36, 0.96],
    [2.26, 0.29, 0.9],
  ] as const) {
    for (let k = -nv; k <= nv; k++) {
      const j = Math.abs(k);
      const signZ = k < 0 ? -1 : k > 0 ? 1 : 0;
      const vFrac = j / nv;
      const [, pzOrig] = lastHalfPts[j]!;
      const pz = signZ * pzOrig * tuckScaleZ;
      const py = lerp(targetCenterY, 0.29, Math.pow(vFrac, 0.75));
      const vx = extraX + getPlanWrapShiftX(extraX, pz);

      positions.push(vx, py, pz);
      uvs.push(1.0, (pz + 1.0) / 2.0);
    }
  }

  const totalStations = nx + 3;
  for (let i = 0; i < totalStations; i++) {
    const r0 = i * rowStride;
    const r1 = (i + 1) * rowStride;
    for (let c = 0; c < rowStride - 1; c++) {
      const a = r0 + c;
      const b = r1 + c;
      const d = r1 + c + 1;
      const e = r0 + c + 1;
      indices.push(a, b, d, a, d, e);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Builds a conformal surface patch directly over the parametric Defender monocoque `(x, v)` domain.
 */
export function createConformalDefenderPatchGeometry(
  xStart: number,
  xEnd: number,
  vStartFunc: (x: number) => number,
  vEndFunc: (x: number) => number,
  segX: number,
  segV: number,
  outwardOffsetY: number,
  outwardOffsetZ: number,
  mirrorBothSides: boolean
): THREE.BufferGeometry {
  const nv = 64;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const sides = mirrorBothSides ? ([-1, 1] as const) : ([1] as const);

  for (const sideZ of sides) {
    const baseVertex = positions.length / 3;
    for (let ix = 0; ix <= segX; ix++) {
      const tx = ix / segX;
      const x = lerp(xStart, xEnd, tx);
      const halfPts = sampleDefenderHalfProfile(x, nv);
      const v0 = vStartFunc(x);
      const v1 = vEndFunc(x);

      for (let iv = 0; iv <= segV; iv++) {
        const tv = iv / segV;
        const v = mirrorBothSides ? lerp(v0, v1, tv) : lerp(-v1, v1, tv);
        const absV = Math.abs(v);
        const sign = mirrorBothSides ? sideZ : v < 0 ? -1 : 1;

        const fIdx = Math.min(nv - 1e-4, Math.max(0, absV * nv));
        const j0 = Math.floor(fIdx);
        const j1 = Math.min(nv, j0 + 1);
        const frac = fIdx - j0;

        const p0 = halfPts[j0]!;
        const p1 = halfPts[j1]!;
        const py = lerp(p0[0], p1[0], frac) + outwardOffsetY;
        const pz = sign * (lerp(p0[1], p1[1], frac) + outwardOffsetZ);
        const vx = x + getPlanWrapShiftX(x, pz);

        positions.push(vx, py, pz);
        uvs.push(tx, tv);
      }
    }

    const stride = segV + 1;
    for (let ix = 0; ix < segX; ix++) {
      for (let iv = 0; iv < segV; iv++) {
        const a = baseVertex + ix * stride + iv;
        const b = baseVertex + (ix + 1) * stride + iv;
        const c = baseVertex + (ix + 1) * stride + iv + 1;
        const d = baseVertex + ix * stride + iv + 1;
        if (sideZ > 0 || !mirrorBothSides) {
          indices.push(a, b, c, a, c, d);
        } else {
          indices.push(a, c, b, a, d, c);
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Builds a conformal lateral panel or side window on one or both sides of the Defender greenhouse/flank.
 */
export function createConformalLateralWindowOrPanelGeometry(
  xStart: number,
  xEnd: number,
  yBotFunc: (x: number) => number,
  yTopFunc: (x: number) => number,
  segX: number,
  segY: number,
  outwardZOffset: number,
  sides: readonly (-1 | 1)[] = [-1, 1]
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (const sideZ of sides) {
    const baseVertex = positions.length / 3;
    for (let ix = 0; ix <= segX; ix++) {
      const tx = ix / segX;
      const x = lerp(xStart, xEnd, tx);
      const yBot = yBotFunc(x);
      const yTop = Math.max(yBot + 0.005, yTopFunc(x));

      for (let iy = 0; iy <= segY; iy++) {
        const ty = iy / segY;
        const py = lerp(yBot, yTop, ty);
        const zSurf = sampleLateralSurfaceZAtXY(x, py);
        const pz = sideZ * (zSurf + outwardZOffset);
        const vx = x + getPlanWrapShiftX(x, pz);

        positions.push(vx, py, pz);
        uvs.push(tx, ty);
      }
    }

    const stride = segY + 1;
    for (let ix = 0; ix < segX; ix++) {
      for (let iy = 0; iy < segY; iy++) {
        const a = baseVertex + ix * stride + iy;
        const b = baseVertex + (ix + 1) * stride + iy;
        const c = baseVertex + (ix + 1) * stride + iy + 1;
        const d = baseVertex + ix * stride + iy + 1;
        if (sideZ > 0) {
          indices.push(a, c, b, a, d, c);
        } else {
          indices.push(a, b, c, a, c, d);
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Builds the smooth, flush, monolithic rounded-chamfer L663 Narvik Gloss Black wheel-arch cladding lip
 * and deep inner wheelhouse liner around the front (`x = -1.51m`) and rear (`x = +1.51m`) axles.
 */
export function buildDefenderWheelArchCladdingAndLiner(
  parent: THREE.Group,
  xAxle: number,
  yAxle: number,
  rArch: number,
  zOuterFallback: number,
  claddingMat: THREE.Material,
  linerMat: THREE.Material,
  namePrefix = 'landRoverDefender'
): void {
  const segs = 36;
  const lipPositions: number[] = [];
  const lipIndices: number[] = [];
  const linerPositions: number[] = [];
  const linerIndices: number[] = [];

  const lipWidth = 0.038; // Flush monolithic L663 Defender rounded-chamfer arch eyebrow moulding
  const linerDepthZ = 0.38;

  for (const sideZ of [-1, 1] as const) {
    const lipBase = lipPositions.length / 3;
    const linerBase = linerPositions.length / 3;

    for (let s = 0; s <= segs; s++) {
      const ang = -0.06 + (s / segs) * (Math.PI + 0.12);
      const c = Math.cos(ang);
      const sn = Math.sin(ang);
      // Smooth rounded-chamfer Defender wheel arch contour
      const sqFactor = 1 + 0.026 * Math.sin(ang * 2) * Math.sin(ang);
      const rIn = rArch * sqFactor;
      const rOut = (rArch + lipWidth) * sqFactor;

      const px = xAxle - c * rIn;
      const py = Math.max(0.26, yAxle + sn * rIn);
      const pxOut = xAxle - c * rOut;
      const pyOut = Math.max(0.26, yAxle + sn * rOut);

      const zSurfOut = Math.max(zOuterFallback * 0.94, sampleLateralSurfaceZAtXY(pxOut, pyOut));
      const zSurfIn = Math.max(zOuterFallback * 0.92, sampleLateralSurfaceZAtXY(px, py));

      const zRim = sideZ * (zSurfOut + 0.004);
      const zIn = sideZ * (zSurfIn - 0.016);
      const zDeep = sideZ * (zSurfIn - linerDepthZ);

      const vxOut = pxOut + getPlanWrapShiftX(pxOut, zRim);
      const vxIn = px + getPlanWrapShiftX(px, zIn);
      const vxDeep = (px * 0.97 + xAxle * 0.03) + getPlanWrapShiftX(px, zDeep);

      lipPositions.push(vxOut, pyOut, zRim, vxIn, py, zIn);
      linerPositions.push(
        vxIn,
        py,
        zIn,
        vxDeep,
        Math.max(0.24, py - 0.02),
        zDeep
      );
    }

    for (let s = 0; s < segs; s++) {
      const a = lipBase + s * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      if (sideZ > 0) {
        lipIndices.push(a, b, d, a, d, c);
      } else {
        lipIndices.push(a, d, b, a, c, d);
      }

      const la = linerBase + s * 2;
      const lb = la + 1;
      const lc = la + 2;
      const ld = la + 3;
      if (sideZ > 0) {
        linerIndices.push(la, lb, ld, la, ld, lc);
      } else {
        linerIndices.push(la, ld, lb, la, lc, ld);
      }
    }
  }

  const lipGeo = new THREE.BufferGeometry();
  lipGeo.setAttribute('position', new THREE.Float32BufferAttribute(lipPositions, 3));
  lipGeo.setIndex(lipIndices);
  lipGeo.computeVertexNormals();
  lipGeo.computeBoundingSphere();
  const lipMesh = new THREE.Mesh(lipGeo, claddingMat);
  lipMesh.name = `${namePrefix}.wheelArchCladding`;
  lipMesh.castShadow = true;
  lipMesh.receiveShadow = true;
  parent.add(lipMesh);

  const linerGeo = new THREE.BufferGeometry();
  linerGeo.setAttribute('position', new THREE.Float32BufferAttribute(linerPositions, 3));
  linerGeo.setIndex(linerIndices);
  linerGeo.computeVertexNormals();
  linerGeo.computeBoundingSphere();
  const linerMesh = new THREE.Mesh(linerGeo, linerMat);
  linerMesh.name = `${namePrefix}.wheelhouseLiner`;
  parent.add(linerMesh);
}

/**
 * Builds the under-vehicle contact shadow pad, heavy-duty off-road chassis undertray,
 * smoothly lofted L663 Defender 110 monocoque body shell, contrast Narvik Black floating roof cap,
 * horizontal waist shoulder moulding, lower door cladding, wheel-arch cladding, and bonnet chequer plates.
 */
export function buildDefender110MonocoqueAndCladding(
  defenderGroup: THREE.Group,
  mats: Defender110Materials,
  namePrefix = 'landRoverDefender'
): void {
  // Under-Vehicle Contact Shadow Pad & Heavy-Duty Off-Road Chassis Undertray
  const shadowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(5.18, 2.32),
    new THREE.MeshBasicMaterial({
      map: createUnderCarShadowTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
  );
  shadowPlane.name = `${namePrefix}.contactShadow`;
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.set(0.05, 0.022, 0);
  defenderGroup.add(shadowPlane);

  const chassisUndertray = new THREE.Mesh(
    new THREE.BoxGeometry(4.12, 0.055, 1.56),
    mats.narvikGlossBlackMat
  );
  chassisUndertray.name = `${namePrefix}.undertray`;
  chassisUndertray.position.set(0, 0.265, 0);
  defenderGroup.add(chassisUndertray);

  // Smoothly Lofted Parametric L663 Defender 110 Monocoque Body Shell
  const bodyShellGeo = createUnifiedDefender110BodyGeometry();
  const bodyShellMesh = new THREE.Mesh(bodyShellGeo, mats.santoriniBlackBodyMat);
  bodyShellMesh.name = `${namePrefix}.bodyShell`;
  bodyShellMesh.castShadow = true;
  bodyShellMesh.receiveShadow = true;
  defenderGroup.add(bodyShellMesh);

  // Contrast Narvik Gloss Black Floating Roof Cap (`x = -0.38m..+2.24m, y = 1.90m..1.968m`)
  const floatingRoofCapGeo = createConformalDefenderPatchGeometry(
    -0.38,
    2.24,
    () => 0.0,
    () => 0.305,
    36,
    24,
    0.0065,
    0.0055,
    false
  );
  const floatingRoofCapMesh = new THREE.Mesh(floatingRoofCapGeo, mats.narvikGlossBlackMat);
  floatingRoofCapMesh.name = `${namePrefix}.floatingRoof`;
  floatingRoofCapMesh.castShadow = true;
  floatingRoofCapMesh.receiveShadow = true;
  defenderGroup.add(floatingRoofCapMesh);

  // Prominent Horizontal Defender Barrel Waist Shoulder Shelf Moulding (`y ≈ 1.21m, z = ±0.86m..±0.96m`)
  const waistShoulderStripGeo = createConformalDefenderPatchGeometry(
    -2.20,
    2.30,
    () => 0.495,
    () => 0.558,
    48,
    6,
    0.006,
    0.006,
    true
  );
  const waistShoulderStripMesh = new THREE.Mesh(waistShoulderStripGeo, mats.narvikGlossBlackMat);
  waistShoulderStripMesh.name = `${namePrefix}.waistShoulderLine`;
  defenderGroup.add(waistShoulderStripMesh);

  // Conformal Lower Door & Quarter Protective Narvik Black Cladding Panels (`x = -1.02m..+1.02m, y = 0.30m..0.50m`)
  const lowerDoorCladdingGeo = createConformalLateralWindowOrPanelGeometry(
    -1.02,
    1.02,
    () => 0.30,
    () => 0.50,
    24,
    6,
    0.0065,
    [-1, 1]
  );
  const lowerDoorCladdingMesh = new THREE.Mesh(lowerDoorCladdingGeo, mats.narvikGlossBlackMat);
  lowerDoorCladdingMesh.name = `${namePrefix}.lowerDoorCladding`;
  defenderGroup.add(lowerDoorCladdingMesh);

  // Smooth Rounded-Chamfer Wheel Arch Cladding Flanges & Dark Wheelhouse Liners (`x = -1.51m` front, `x = +1.51m` rear)
  buildDefenderWheelArchCladdingAndLiner(
    defenderGroup,
    -1.51,
    0.415,
    0.442,
    0.968,
    mats.narvikGlossBlackMat,
    mats.satinAnthraciteMat,
    namePrefix
  );
  buildDefenderWheelArchCladdingAndLiner(
    defenderGroup,
    1.51,
    0.415,
    0.442,
    0.972,
    mats.narvikGlossBlackMat,
    mats.satinAnthraciteMat,
    namePrefix
  );

  // Twin Outer Black Diamond-Pattern Chequer-Plate Bonnet Tread Plates (`landRoverDefender.bonnetChequerPlate`)
  const bonnetChequerGroup = new THREE.Group();
  bonnetChequerGroup.name = `${namePrefix}.bonnetChequerPlate`;
  defenderGroup.add(bonnetChequerGroup);

  const bonnetChequerPatchGeo = createConformalDefenderPatchGeometry(
    -2.18,
    -1.08,
    () => 0.195,
    () => 0.285,
    24,
    8,
    0.006,
    0.004,
    true
  );
  const bonnetChequerMesh = new THREE.Mesh(bonnetChequerPatchGeo, mats.chequerPlateMat);
  bonnetChequerMesh.name = `${namePrefix}.bonnetChequerPlate`;
  bonnetChequerMesh.castShadow = true;
  bonnetChequerMesh.receiveShadow = true;
  bonnetChequerGroup.add(bonnetChequerMesh);
}
