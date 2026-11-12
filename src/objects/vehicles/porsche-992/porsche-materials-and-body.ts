import { isRecordingCanvasStub } from '../../../engine/textures/texture-registry.ts';
import * as THREE from 'three';
import { getOrCreateCachedPropTexture } from '../../../engine/textures/texture-registry.ts';

/**
 * Generates a 512x512 procedural Porsche Ocean Blue / Gentian Blue Metallic (`#103760` -> `#2b6fb3`)
 * automotive basecoat + fine metallic pearl micro-flake texture.
 */
export function createOceanBlueMetallicTexture(): THREE.CanvasTexture {
  return getOrCreateCachedPropTexture('porsche:ocean-blue', () => {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, '#113863');
  grad.addColorStop(0.28, '#1b538c');
  grad.addColorStop(0.52, '#276cb0');
  grad.addColorStop(0.76, '#194d84');
  grad.addColorStop(1, '#0f3259');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const img = ctx.getImageData(0, 0, size, size);
  const data = img.data;
  for (let i = 0; i < size * size; i++) {
    const idx = i * 4;
    const h1 = Math.sin(i * 12.9898 + 4.1) * 43758.5453;
    const f1 = h1 - Math.floor(h1);
    const sparkle = (f1 - 0.5) * 9;
    data[idx] = Math.max(12, Math.min(115, Math.round(data[idx]! + sparkle * 0.65)));
    data[idx + 1] = Math.max(44, Math.min(180, Math.round(data[idx + 1]! + sparkle * 0.95)));
    data[idx + 2] = Math.max(84, Math.min(242, Math.round(data[idx + 2]! + sparkle * 1.25)));
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
    dTex.repeat.set(2, 2);
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
  tex.repeat.set(2, 2);
  return tex;
  });
}

/**
 * Generates a radial cross-drilled carbon-ceramic brake rotor texture (`420mm` / `390mm` PCCB).
 */
export function createPccbRotorTexture(): THREE.CanvasTexture {
  return getOrCreateCachedPropTexture('porsche:pccb-rotor', () => {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const cx = size * 0.5;
  const cy = size * 0.5;

  ctx.fillStyle = '#4c525c';
  ctx.fillRect(0, 0, size, size);

  for (let r = 76; r < 248; r += 2) {
    ctx.strokeStyle = r % 4 === 0 ? 'rgba(148, 156, 168, 0.48)' : 'rgba(44, 48, 54, 0.48)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = '#14171c';
  const numSpiralArms = 32;
  for (let a = 0; a < numSpiralArms; a++) {
    const baseAngle = (a / numSpiralArms) * Math.PI * 2;
    for (let h = 0; h < 6; h++) {
      const rad = 104 + h * 24;
      const ang = baseAngle + h * 0.052;
      const hx = cx + Math.cos(ang) * rad;
      const hy = cy + Math.sin(ang) * rad;
      ctx.beginPath();
      ctx.arc(hx, hy, 3.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
  });
}

/**
 * Generates a crisp UK registration plate (`992 TBS`) texture.
 */
export function createUkNumberPlateTexture(isRearYellow: boolean): THREE.CanvasTexture {
  return getOrCreateCachedPropTexture(`porsche:plate:${isRearYellow ? 1 : 0}`, () => {
  const w = 512;
  const h = 112;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  ctx.fillStyle = isRearYellow ? '#f2b705' : '#f4f6f8';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = '#1a1d21';
  ctx.lineWidth = 6;
  ctx.strokeRect(5, 5, w - 10, h - 10);

  ctx.fillStyle = '#0d3b8c';
  ctx.fillRect(8, 8, 46, h - 16);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('UK', 31, h * 0.62);

  ctx.fillStyle = '#111317';
  ctx.font = 'bold 68px "Arial Narrow", Impact, sans-serif';
  ctx.fillText('992 TBS', w * 0.54, h * 0.54);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
  });
}

/**
 * Generates a Stuttgart Porsche Crest shield texture.
 */
export function createPorscheCrestTexture(): THREE.CanvasTexture {
  return getOrCreateCachedPropTexture('porsche:crest', () => {
  const w = 128;
  const h = 160;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#d4b475';
  ctx.beginPath();
  ctx.moveTo(w * 0.12, h * 0.08);
  ctx.lineTo(w * 0.88, h * 0.08);
  ctx.lineTo(w * 0.86, h * 0.56);
  ctx.quadraticCurveTo(w * 0.82, h * 0.84, w * 0.5, h * 0.95);
  ctx.quadraticCurveTo(w * 0.18, h * 0.84, w * 0.14, h * 0.56);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = '#1c1915';
  ctx.lineWidth = 5;
  ctx.stroke();

  ctx.fillStyle = '#9b2226';
  ctx.fillRect(w * 0.5, h * 0.16, w * 0.3, h * 0.28);
  ctx.fillRect(w * 0.2, h * 0.48, w * 0.3, h * 0.28);

  ctx.fillStyle = '#141414';
  ctx.fillRect(w * 0.36, h * 0.34, w * 0.28, h * 0.3);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
  });
}

/**
 * Generates a soft radial under-chassis ambient occlusion contact shadow texture.
 */
export function createUnderCarShadowTexture(): THREE.CanvasTexture {
  return getOrCreateCachedPropTexture('porsche:shadow', () => {
  const w = 512;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  ctx.clearRect(0, 0, w, h);
  const grad = ctx.createRadialGradient(w * 0.5, h * 0.5, 16, w * 0.5, h * 0.5, w * 0.48);
  grad.addColorStop(0, 'rgba(6, 8, 12, 0.84)');
  grad.addColorStop(0.56, 'rgba(8, 11, 16, 0.62)');
  grad.addColorStop(0.84, 'rgba(10, 14, 20, 0.22)');
  grad.addColorStop(1, 'rgba(10, 14, 20, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
  });
}

export interface Porsche992Materials {
  oceanBlueBodyMat: THREE.MeshStandardMaterial;
  satinBlackAeroMat: THREE.MeshStandardMaterial;
  glossBlackTrimMat: THREE.MeshStandardMaterial;
  turboniteMat: THREE.MeshStandardMaterial;
  tintedGlassMat: THREE.MeshStandardMaterial;
  clearLensMat: THREE.MeshStandardMaterial;
  ledDrlMat: THREE.MeshStandardMaterial;
  amberIndicatorMat: THREE.MeshStandardMaterial;
  crimsonTaillightMat: THREE.MeshStandardMaterial;
  smokedRedLensMat: THREE.MeshStandardMaterial;
  tireRubberMat: THREE.MeshStandardMaterial;
  diamondCutAlloyMat: THREE.MeshStandardMaterial;
  pccbRotorMat: THREE.MeshStandardMaterial;
  pccbYellowCaliperMat: THREE.MeshStandardMaterial;
  crestMat: THREE.MeshStandardMaterial;
  titaniumExhaustMat: THREE.MeshStandardMaterial;
  slateLeatherMat: THREE.MeshStandardMaterial;
  chalkLeatherMat: THREE.MeshStandardMaterial;
}

/**
 * Creates the full PBR + Clearcoat material palette for the Porsche 911 (992.2) Turbo S Coupé.
 */
export function createPorsche992Materials(): Porsche992Materials {
  const oceanBlueTex = createOceanBlueMetallicTexture();
  // Showroom-grade MeshPhysicalMaterial with clearcoat = 1.0 over Ocean Blue Metallic basecoat
  const oceanBlueBodyMat = new THREE.MeshPhysicalMaterial({
    color: 0x1e5c98,
    map: oceanBlueTex,
    emissive: new THREE.Color(0x051528),
    emissiveIntensity: 0.18,
    roughness: 0.21,
    metalness: 0.52,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    reflectivity: 0.92,
    side: THREE.DoubleSide,
  });

  const satinBlackAeroMat = new THREE.MeshStandardMaterial({
    color: 0x1e2228,
    roughness: 0.38,
    metalness: 0.34,
    side: THREE.DoubleSide,
  });

  const glossBlackTrimMat = new THREE.MeshPhysicalMaterial({
    color: 0x0e1116,
    roughness: 0.12,
    metalness: 0.48,
    clearcoat: 0.9,
    clearcoatRoughness: 0.08,
    side: THREE.DoubleSide,
  });

  const turboniteMat = new THREE.MeshStandardMaterial({
    color: 0x4b515a,
    roughness: 0.24,
    metalness: 0.78,
  });

  const tintedGlassMat = new THREE.MeshPhysicalMaterial({
    color: 0x142230,
    roughness: 0.05,
    metalness: 0.15,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    transparent: true,
    opacity: 0.62,
    side: THREE.DoubleSide,
  });

  const clearLensMat = new THREE.MeshPhysicalMaterial({
    color: 0xeaf4ff,
    roughness: 0.04,
    metalness: 0.1,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    transparent: true,
    opacity: 0.42,
    side: THREE.DoubleSide,
  });

  const ledDrlMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: new THREE.Color(0xf0f8ff),
    emissiveIntensity: 2.8,
    roughness: 0.08,
  });

  const amberIndicatorMat = new THREE.MeshStandardMaterial({
    color: 0xffe4b8,
    emissive: new THREE.Color(0xffb84d),
    emissiveIntensity: 1.4,
    roughness: 0.15,
  });

  const crimsonTaillightMat = new THREE.MeshStandardMaterial({
    color: 0xff1a22,
    emissive: new THREE.Color(0xff1118),
    emissiveIntensity: 2.4,
    roughness: 0.12,
  });

  const smokedRedLensMat = new THREE.MeshStandardMaterial({
    color: 0x4a080c,
    roughness: 0.08,
    metalness: 0.2,
    transparent: true,
    opacity: 0.65,
  });

  const tireRubberMat = new THREE.MeshStandardMaterial({
    color: 0x16191d,
    roughness: 0.72,
    metalness: 0.08,
    side: THREE.DoubleSide,
  });

  const diamondCutAlloyMat = new THREE.MeshStandardMaterial({
    color: 0xd8e0ea,
    emissive: new THREE.Color(0x14181e),
    emissiveIntensity: 0.14,
    roughness: 0.16,
    metalness: 0.84,
  });

  const pccbRotorMat = new THREE.MeshStandardMaterial({
    map: createPccbRotorTexture(),
    color: 0xffffff,
    roughness: 0.3,
    metalness: 0.64,
  });

  const pccbYellowCaliperMat = new THREE.MeshPhysicalMaterial({
    color: 0xf7c800, // Porsche Speed Yellow PCCB
    emissive: new THREE.Color(0x3a2e00),
    emissiveIntensity: 0.18,
    roughness: 0.18,
    metalness: 0.28,
    clearcoat: 0.85,
    clearcoatRoughness: 0.1,
  });

  const crestMat = new THREE.MeshStandardMaterial({
    map: createPorscheCrestTexture(),
    transparent: true,
    roughness: 0.25,
    metalness: 0.55,
  });

  const titaniumExhaustMat = new THREE.MeshStandardMaterial({
    color: 0xb2bac6,
    roughness: 0.18,
    metalness: 0.86,
  });

  const slateLeatherMat = new THREE.MeshStandardMaterial({
    color: 0x262b32,
    roughness: 0.56,
    metalness: 0.05,
  });

  const chalkLeatherMat = new THREE.MeshStandardMaterial({
    color: 0xdad6cc,
    roughness: 0.52,
    metalness: 0.04,
  });

  return {
    oceanBlueBodyMat,
    satinBlackAeroMat,
    glossBlackTrimMat,
    turboniteMat,
    tintedGlassMat,
    clearLensMat,
    ledDrlMat,
    amberIndicatorMat,
    crimsonTaillightMat,
    smokedRedLensMat,
    tireRubberMat,
    diamondCutAlloyMat,
    pccbRotorMat,
    pccbYellowCaliperMat,
    crestMat,
    titaniumExhaustMat,
    slateLeatherMat,
    chalkLeatherMat,
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
      const m0 = ((k1[1] - km1[1]) / Math.max(1e-5, k1[0] - km1[0])) * dx * 0.85;
      const m1 = ((kp2[1] - k0[1]) / Math.max(1e-5, kp2[0] - k0[0])) * dx * 0.85;
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
 * Plan-view wrap-around shift `xWrapShift(x, z)`:
 * Curves the outer front bumper corners rearward (`+x`) and outer rear bumper corners
 * forward (`-x`) so the nose and tail have the sculpted 992 plan-view curvature seen in the photo.
 */
export function getPlanWrapShiftX(x: number, z: number): number {
  const noseWrap = smoothstep(-1.72, -2.24, x);
  const tailWrap = smoothstep(1.75, 2.24, x);
  const zNorm = Math.min(1.18, Math.abs(z) / 0.90);
  return noseWrap * Math.pow(zNorm, 1.85) * 0.175 - tailWrap * Math.pow(zNorm, 1.9) * 0.185;
}

// ============================================================================
// AUTHENTIC PORSCHE 911 (992.2) TURBO S LONGITUDINAL FEATURE CURVES
// (`x = -2.24m` front bumper nose to `x = +2.24m` rear bumper tail, `L = 4.48m`,
//  wheelbase `2.45m`: front axle at `x = -1.25m`, rear axle at `x = +1.20m`)
// ============================================================================

/**
 * 1. Centerline profile `yCenter(x)`:
 *    - Sculpted 992.2 front bumper fascia (`x = -2.24..-2.10m`)
 *    - Low, dished central 911 frunk hood (`x = -2.10..-0.92m`, `y = 0.475m -> 0.805m`) sitting below the raised outer fender pontoons
 *    - Sleek raked windshield (`x = -0.92..-0.26m`, `y = 0.808m -> 1.244m`)
 *    - Low, iconic **911 Coupé Flyline Roof Crown** (`x = -0.26..+0.30m`, peaking at `1.266m`)
 *    - Continuous, taut **911 Fastback Rear Window & Slatted Engine Decklid** (`x = +0.30..+2.06m`)
 *    - Recessed full-width LED taillight visor step (`x = 2.14m, y = 0.722m`)
 *    - Swelling muscular 992.2 lower rear bumper (`x = 2.22m, y = 0.565m` -> `x = 2.24m, y = 0.355m`).
 */
export const CENTERLINE_Y_KNOTS: readonly (readonly [number, number])[] = [
  [-2.24, 0.205],
  [-2.21, 0.355],
  [-2.14, 0.478],
  [-1.95, 0.558],
  [-1.65, 0.658],
  [-1.30, 0.748],
  [-0.94, 0.808], // Windshield cowl base
  [-0.75, 0.942],
  [-0.50, 1.124],
  [-0.28, 1.242], // Top of windshield header
  [-0.04, 1.266], // Smooth, low 911 roof crown
  [0.24, 1.246],
  [0.55, 1.180], // Start of rear fastback glass
  [0.92, 1.074],
  [1.28, 0.960],
  [1.54, 0.886], // Base of rear window / start of slatted engine decklid
  [1.84, 0.826], // Rear of decklid grille / base of active spoiler
  [2.06, 0.800], // Integrated ducktail trailing lip above taillight visor
  [2.14, 0.722], // Recessed full-width taillight bar visor slot
  [2.22, 0.565], // Upper crown of lower rear bumper below taillight bar
  [2.24, 0.355], // Lower rear bumper face
];

/**
 * 2. Fender / Door Beltline / Rear Haunch Shoulder Height `yShoulder(x)`:
 *    - Prominent raised Porsche 911 cannon-barrel front fender pontoons (`x = -2.08..-1.00m`, rising `55mm` above the sunken central hood!)
 *    - Taut horizontal door beltline (`y = 0.855m..0.865m` across `x = -0.90..+0.42m`)
 *    - Muscular 992.2 Turbo S widebody rear quarter haunch cresting over the rear wheel (`y = 0.896m` at `x = 1.12m`)
 *      and sloping organically downward into the wrap-around taillight visor (`x = 2.14m`).
 */
export const SHOULDER_Y_KNOTS: readonly (readonly [number, number])[] = [
  [-2.24, 0.21],
  [-2.20, 0.375],
  [-2.10, 0.555],
  [-1.92, 0.695],
  [-1.65, 0.802],
  [-1.25, 0.862], // High crest of 911 front fender pontoon over front wheel
  [-0.90, 0.856],
  [-0.40, 0.858], // Taut horizontal door beltline
  [0.10, 0.865],
  [0.48, 0.882],
  [0.85, 0.898], // Muscular Turbo S rear haunch shoulder
  [1.18, 0.894], // Crest over rear wheel
  [1.56, 0.838], // Smooth downward teardrop taper behind rear wheel
  [1.92, 0.768],
  [2.08, 0.738],
  [2.14, 0.708], // Wrap-around taillight visor channel
  [2.22, 0.545], // Swelling lower rear bumper shoulder
  [2.24, 0.345],
];

/**
 * 3. Plan-View Outer Body Half-Width `zBodyMax(x)`:
 *    - Widebody front fenders (`z = 0.922m` at `x = -1.25m`), sculpted Coke-bottle door waist (`0.860m`),
 *      and dramatic widebody Turbo S rear haunches (`z = 0.964m` at `x = 1.20m`).
 */
export const BODY_WIDTH_Z_KNOTS: readonly (readonly [number, number])[] = [
  [-2.24, 0.63],
  [-2.18, 0.755],
  [-2.04, 0.848],
  [-1.78, 0.902],
  [-1.45, 0.920],
  [-1.25, 0.922], // Front wheel arch crown (`1.844m` width)
  [-0.90, 0.896],
  [-0.45, 0.866],
  [-0.05, 0.858], // Taut Coke-bottle door waist
  [0.35, 0.888],
  [0.75, 0.952], // Widebody rear haunch flare
  [1.20, 0.964], // Rear wheel arch crown (`1.928m` widebody width!)
  [1.58, 0.936],
  [1.90, 0.878],
  [2.12, 0.818],
  [2.24, 0.755],
];

/**
 * 4. Plan-View Teardrop Cabin Greenhouse / Hood-Edge Half-Width `zCrown(x)`:
 */
export const CROWN_WIDTH_Z_KNOTS: readonly (readonly [number, number])[] = [
  [-2.24, 0.34],
  [-2.08, 0.44],
  [-1.75, 0.49],
  [-1.25, 0.54],
  [-0.92, 0.645],
  [-0.55, 0.605],
  [-0.25, 0.568],
  [0.10, 0.558],
  [0.50, 0.525],
  [0.96, 0.472],
  [1.45, 0.420], // Narrow teardrop rear glass base creating broad 911 rear haunch shelves!
  [1.85, 0.402],
  [2.08, 0.438],
  [2.24, 0.420],
];

/**
 * Evaluates the circular wheel-arch cutout height `yArch(x)` around the front (`x = -1.25m`)
 * and rear (`x = +1.20m`) axles.
 */
export function sampleWheelArchCutoutY(x: number, yBaseSill: number): number {
  const frontDx = x - -1.25;
  const frontR = 0.362;
  if (Math.abs(frontDx) < frontR) {
    const archY = 0.338 + Math.sqrt(Math.max(0, frontR * frontR - frontDx * frontDx));
    return Math.max(yBaseSill, archY);
  }

  const rearDx = x - 1.20;
  const rearR = 0.382;
  if (Math.abs(rearDx) < rearR) {
    const archY = 0.354 + Math.sqrt(Math.max(0, rearR * rearR - rearDx * rearDx));
    return Math.max(yBaseSill, archY);
  }

  return yBaseSill;
}

/**
 * Computes a single cross-section profile (`nv + 1` points from `z = 0` centerline to lower rocker sill)
 * at longitudinal station `x` (`-2.24m .. +2.24m`).
 */
export function sampleMonocoqueHalfProfile(x: number, nv: number): [number, number][] {
  const yCenter = evalSpline(x, CENTERLINE_Y_KNOTS);
  const yShoulder = evalSpline(x, SHOULDER_Y_KNOTS);
  const zMax = evalSpline(x, BODY_WIDTH_Z_KNOTS);
  const zCrown = Math.min(zMax * 0.82, evalSpline(x, CROWN_WIDTH_Z_KNOTS));

  const frontApproach = smoothstep(-1.62, -2.24, x);
  const rearDeparture = smoothstep(1.56, 2.24, x);
  const yBaseSill = 0.13 + frontApproach * 0.032 + rearDeparture * 0.055;
  const yArchCut = sampleWheelArchCutoutY(x, yBaseSill);

  const hoodWeight = (1 - smoothstep(-0.98, -0.78, x)) * smoothstep(-2.14, -1.94, x);
  const cabinWeight = smoothstep(-0.92, -0.62, x) * (1 - smoothstep(1.42, 1.85, x));

  // Side intercooler intake recess on the Turbo S rear fender leading flank (`x = 0.54..0.92m`)
  const intakeLongitudinal =
    smoothstep(0.52, 0.64, x) * (1 - smoothstep(0.78, 0.94, x));

  // Lower door aero undercut channel (`x = -0.82..+0.68m`) that feeds into the widebody rear haunch
  const doorFlankWeight =
    smoothstep(-0.86, -0.55, x) * (1 - smoothstep(0.45, 0.78, x));

  const pts: [number, number][] = [];
  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    let y = 0;
    let z = 0;

    if (v <= 0.32) {
      const u = v / 0.32;
      z = u * zCrown;
      // Sunken central 992 frunk hood with twin longitudinal stamp creases near `u = 0.72`
      const hoodRecess = hoodWeight * (-0.016 * (1 - u * u) + 0.008 * Math.exp(-Math.pow((u - 0.74) / 0.12, 2)));
      const camber = cabinWeight * 0.018 * (1 - u * u) + hoodRecess;
      y = yCenter + camber;
    } else if (v <= 0.58) {
      const u = (v - 0.32) / 0.26;
      const shelfBlend = smoothstep(0.0, 1.0, u);
      const glassSlopeU = Math.min(1, u * 1.38);
      const yCabinTransition = lerp(
        yCenter,
        yShoulder,
        0.74 * glassSlopeU + 0.26 * shelfBlend * shelfBlend
      );
      // Iconic 911 cannon-barrel raised front fender pontoon dome (`u = 0.15..0.85`)
      const pontoonArch = hoodWeight * 0.036 * Math.sin(Math.pow(u, 0.85) * Math.PI);
      y =
        lerp(yCenter, yShoulder, shelfBlend) * (1 - cabinWeight) +
        yCabinTransition * cabinWeight +
        pontoonArch;
      z = lerp(zCrown, zMax * 0.94, Math.pow(u, 0.82));
    } else if (v <= 0.90) {
      const u = (v - 0.58) / 0.32;
      const yFlankNominal = lerp(yShoulder, yBaseSill + 0.035, u);
      const yClampedMin = yArchCut + 0.022 + (1 - u) * 0.04;
      y = Math.max(yFlankNominal, lerp(yShoulder, yClampedMin, u));

      const flankBelly = Math.sin(u * Math.PI * 0.82);
      // Taut lower door sculpture + flared lower rocker shelf (`u > 0.72`)
      const doorSculptureZ =
        doorFlankWeight * (-0.014 * Math.sin(u * Math.PI) + smoothstep(0.68, 0.95, u) * 0.022);
      z = lerp(zMax * 0.94, zMax * 0.96, u) + flankBelly * 0.038 + doorSculptureZ;

      if (intakeLongitudinal > 0.01) {
        const intakeV = smoothstep(0.16, 0.32, u) * (1 - smoothstep(0.58, 0.76, u));
        z -= intakeLongitudinal * intakeV * 0.056;
      }
    } else {
      const u = (v - 0.90) / 0.10;
      const yTop = Math.max(lerp(yShoulder, yBaseSill + 0.035, 1.0), yArchCut + 0.022);
      y = lerp(yTop, yArchCut, u);
      const isWheelArch = smoothstep(yBaseSill + 0.01, yBaseSill + 0.12, yArchCut);
      const tuckIn = lerp(0.052, 0.018, isWheelArch);
      z = zMax * 0.96 - u * tuckIn;
    }

    pts.push([y, Math.max(0, z)]);
  }

  return pts;
}

export function sampleLateralSurfaceZAtXY(x: number, yTarget: number): number {
  const halfPts = sampleMonocoqueHalfProfile(x, 64);
  let bestZ = halfPts[20]![1];
  let bestDiff = 1e9;
  for (let j = 16; j < 44; j++) {
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
 * Builds the Porsche 911 Teardrop Side Window (`DLO`) mesh directly from exact side-view `(x, y)` curves.
 */
export function createSideWindowDloGeometry(
  marginX: number,
  marginY: number,
  outwardZOffset: number
): THREE.BufferGeometry {
  const xStart = -0.82 - marginX;
  const xEnd = 0.96 + marginX * 1.2;
  const segX = 44;
  const segY = 14;

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const evalDloTopY = (x: number): number => {
    if (x < -0.30) {
      const u = Math.max(0, Math.min(1, (x - -0.82) / (-0.30 - -0.82)));
      return lerp(0.875, 1.195, Math.pow(u, 0.92)) + marginY;
    }
    const u = Math.max(0, Math.min(1, (x - -0.30) / (0.96 - -0.30)));
    const arch = 1.195 + 0.045 * Math.sin(u * Math.PI * 0.65) - 0.25 * Math.pow(u, 1.55);
    return arch + marginY;
  };

  const evalDloBotY = (x: number): number => {
    const u = Math.max(0, Math.min(1, (x - -0.82) / (0.96 - -0.82)));
    const rearSweep = smoothstep(0.62, 1.0, u);
    return lerp(0.872, 0.885, u) + rearSweep * 0.060 - marginY;
  };

  for (const sideZ of [-1, 1] as const) {
    const baseVertex = positions.length / 3;
    for (let ix = 0; ix <= segX; ix++) {
      const tx = ix / segX;
      const shapedTx = 0.5 - 0.5 * Math.cos(tx * Math.PI);
      const x = lerp(xStart, xEnd, lerp(tx, shapedTx, 0.55));
      const yBot = evalDloBotY(x);
      const yTop = Math.max(yBot + 0.004, evalDloTopY(x));

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
 * Builds the unified, water-tight, smooth-shaded monocoque body shell (`porsche992TurboS.bodyShell`).
 */
export function createUnifiedPorsche992BodyGeometry(): THREE.BufferGeometry {
  const nx = 124;
  const nv = 48;
  const xMin = -2.24;
  const xMax = 2.24;
  const rowStride = nv * 2 + 1;

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= nx; i++) {
    const t = i / nx;
    const shapedT = 0.5 - 0.5 * Math.cos(t * Math.PI);
    const x = lerp(xMin, xMax, lerp(t, shapedT, 0.35));
    const halfPts = sampleMonocoqueHalfProfile(x, nv);

    for (let k = -nv; k <= nv; k++) {
      const j = Math.abs(k);
      const signZ = k < 0 ? -1 : k > 0 ? 1 : 0;
      const [py, pzAbs] = halfPts[j]!;
      const pz = signZ * pzAbs;
      const vx = x + getPlanWrapShiftX(x, pz);

      positions.push(vx, py, pz);
      uvs.push((vx - xMin) / (xMax - xMin), (pz + 0.96) / 1.92);
    }
  }

  const lastHalfPts = sampleMonocoqueHalfProfile(xMax, nv);
  for (const [extraX, targetCenterY, tuckScaleZ] of [
    [2.235, 0.235, 0.97],
    [2.165, 0.185, 0.91],
  ] as const) {
    for (let k = -nv; k <= nv; k++) {
      const j = Math.abs(k);
      const signZ = k < 0 ? -1 : k > 0 ? 1 : 0;
      const vFrac = j / nv;
      const [, pzOrig] = lastHalfPts[j]!;
      const pz = signZ * pzOrig * tuckScaleZ;
      const py = lerp(targetCenterY, 0.185, Math.pow(vFrac, 0.75));
      const vx = extraX + getPlanWrapShiftX(extraX, pz);

      positions.push(vx, py, pz);
      uvs.push(1.0, (pz + 0.96) / 1.92);
    }
  }

  const totalStations = nx + 2;
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

export function createConformalBodyPatchGeometry(
  xStart: number,
  xEnd: number,
  vStartFunc: (x: number) => number,
  vEndFunc: (x: number) => number,
  segX: number,
  segV: number,
  outwardOffset: number,
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
      const halfPts = sampleMonocoqueHalfProfile(x, nv);
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
        const py = lerp(p0[0], p1[0], frac) + outwardOffset * 0.85;
        const pz = sign * (lerp(p0[1], p1[1], frac) + outwardOffset * 0.65);
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
 * Builds an elliptical conformal patch on the front fender pontoon (`(xCenter, vCenter)`)
 * so the 992.2 oval headlights lie 100% flush with the fender curvature and never stick out!
 */
export function createConformalEllipticalHeadlightPatch(
  xCenter: number,
  vCenter: number,
  radiusX: number,
  radiusV: number,
  outwardOffset: number,
  sideZ: 1 | -1
): THREE.BufferGeometry {
  const nv = 64;
  const rings = 10;
  const sectors = 32;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let r = 0; r <= rings; r++) {
    const fracR = r / rings;
    for (let s = 0; s <= sectors; s++) {
      const ang = (s / sectors) * Math.PI * 2;
      const x = xCenter + Math.cos(ang) * radiusX * fracR;
      const v = Math.max(0.02, Math.min(0.88, vCenter + Math.sin(ang) * radiusV * fracR));

      const halfPts = sampleMonocoqueHalfProfile(x, nv);
      const fIdx = v * nv;
      const j0 = Math.floor(fIdx);
      const j1 = Math.min(nv, j0 + 1);
      const frac = fIdx - j0;
      const p0 = halfPts[j0]!;
      const p1 = halfPts[j1]!;

      const domeLift = outwardOffset + (1 - fracR * fracR) * 0.0065;
      const py = lerp(p0[0], p1[0], frac) + domeLift * 0.88;
      const pz = sideZ * (lerp(p0[1], p1[1], frac) + domeLift * 0.48);
      const vx = x + getPlanWrapShiftX(x, pz) - domeLift * 0.25;

      positions.push(vx, py, pz);
      uvs.push(0.5 + 0.5 * fracR * Math.cos(ang), 0.5 + 0.5 * fracR * Math.sin(ang));
    }
  }

  const stride = sectors + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < sectors; s++) {
      const a = r * stride + s;
      const b = (r + 1) * stride + s;
      const c = (r + 1) * stride + s + 1;
      const d = r * stride + s + 1;
      if (sideZ > 0) {
        indices.push(a, c, b, a, d, c);
      } else {
        indices.push(a, b, c, a, c, d);
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
 * Builds a cylindrical wheel-arch lip & dark inner wheelhouse liner around a wheel opening.
 */
export function buildWheelArchFenderLipAndLiner(
  parent: THREE.Group,
  xAxle: number,
  yAxle: number,
  rArch: number,
  zOuter: number,
  bodyMat: THREE.Material,
  linerMat: THREE.Material,
  namePrefix = 'porsche992TurboS'
): void {
  const segs = 36;
  const lipPositions: number[] = [];
  const lipIndices: number[] = [];
  const linerPositions: number[] = [];
  const linerIndices: number[] = [];

  const lipWidth = 0.022;
  const linerDepthZ = 0.36;

  for (const sideZ of [-1, 1] as const) {
    const lipBase = lipPositions.length / 3;
    const linerBase = linerPositions.length / 3;

    for (let s = 0; s <= segs; s++) {
      const ang = -0.12 + (s / segs) * (Math.PI + 0.24);
      const c = Math.cos(ang);
      const sn = Math.sin(ang);
      const px = xAxle - c * rArch;
      const py = Math.max(0.13, yAxle + sn * rArch);
      const pxOut = xAxle - c * (rArch + lipWidth);
      const pyOut = Math.max(0.13, yAxle + sn * (rArch + lipWidth));

      const zRim = sideZ * zOuter;
      const zIn = sideZ * (zOuter - 0.028);
      const zDeep = sideZ * (zOuter - linerDepthZ);

      lipPositions.push(pxOut, pyOut, zRim, px, py, zIn);
      linerPositions.push(px, py, zIn, px * 0.98 + xAxle * 0.02, Math.max(0.12, py - 0.02), zDeep);
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

  const lipUvs = new Float32Array((lipPositions.length / 3) * 2);
  for (let i = 0, vi = 0; i < lipPositions.length; i += 3, vi += 2) {
    lipUvs[vi] = lipPositions[i]! * 0.5 + 0.5;
    lipUvs[vi + 1] = lipPositions[i + 1]! * 0.5;
  }
  const lipGeo = new THREE.BufferGeometry();
  lipGeo.setAttribute('position', new THREE.Float32BufferAttribute(lipPositions, 3));
  lipGeo.setAttribute('uv', new THREE.BufferAttribute(lipUvs, 2));
  lipGeo.setIndex(lipIndices);
  lipGeo.computeVertexNormals();
  lipGeo.computeBoundingSphere();
  const lipMesh = new THREE.Mesh(lipGeo, bodyMat);
  lipMesh.name = `${namePrefix}.fenderLip`;
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
 * Builds the contact shadow pad, undertray, unified smooth monocoque 992.2 widebody shell,
 * panoramic gloss-black glass roof panel, frunk shut-lines & fuel filler flap,
 * wheel-arch fender lips & liners, and sculpted lower side rocker skirts with rear flare.
 */
export function buildPorsche992BodyAndUnderbody(
  carGroup: THREE.Group,
  mats: Porsche992Materials,
  namePrefix = 'porsche992TurboS'
): void {
  // 0. Soft Ambient Occlusion Contact Shadow Pad + Plan-Conformal Undertray
  const shadowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(4.76, 2.12),
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
  shadowPlane.position.set(0, 0.003, 0);
  carGroup.add(shadowPlane);

  const undertray = new THREE.Mesh(
    new THREE.BoxGeometry(3.65, 0.036, 1.32),
    mats.satinBlackAeroMat
  );
  undertray.name = `${namePrefix}.undertray`;
  undertray.position.set(0, 0.145, 0);
  carGroup.add(undertray);

  // 1. Unified Smooth Monocoque 992.2 Widebody Shell (`porsche992TurboS.bodyShell`)
  const bodyShellGeo = createUnifiedPorsche992BodyGeometry();
  const bodyShellMesh = new THREE.Mesh(bodyShellGeo, mats.oceanBlueBodyMat);
  bodyShellMesh.name = `${namePrefix}.bodyShell`;
  bodyShellMesh.castShadow = true;
  bodyShellMesh.receiveShadow = true;
  carGroup.add(bodyShellMesh);

  // 1B. Gloss-Black Panoramic Glass Sunroof Panel (`x = -0.28..+0.44m`) matching the reference photo
  const sunroofGeo = createConformalBodyPatchGeometry(
    -0.28,
    0.44,
    () => 0.0,
    () => 0.255,
    18,
    18,
    0.0028,
    false
  );
  const sunroofMesh = new THREE.Mesh(sunroofGeo, mats.glossBlackTrimMat);
  sunroofMesh.name = `${namePrefix}.panoramicSunroof`;
  carGroup.add(sunroofMesh);

  // 1C. Crisp 992 Frunk Hood Shut-Line & Twin Longitudinal Hood Crease Accents (`x = -2.06..-0.94m`)
  for (const sideZ of [-1, 1] as const) {
    const shutLineGeo = createConformalBodyPatchGeometry(
      -2.05,
      -0.94,
      () => 0.268,
      () => 0.276,
      20,
      2,
      0.0018,
      false
    );
    if (sideZ === 1) {
      const shutLineMesh = new THREE.Mesh(shutLineGeo, mats.glossBlackTrimMat);
      shutLineMesh.name = `${namePrefix}.frunkShutLine`;
      carGroup.add(shutLineMesh);
    }
  }
  const frontTransverseShutGeo = createConformalBodyPatchGeometry(
    -2.06,
    -2.045,
    () => 0.0,
    () => 0.272,
    3,
    16,
    0.0018,
    false
  );
  const frontTransverseShutMesh = new THREE.Mesh(frontTransverseShutGeo, mats.glossBlackTrimMat);
  frontTransverseShutMesh.name = `${namePrefix}.frunkFrontShutLine`;
  carGroup.add(frontTransverseShutMesh);

  // 1D. Right-Front Fender Circular Fuel Filler Flap (`x = -0.96m, v = 0.44..0.52, sideZ = +1`) visible in reference photo
  const fillerFlapRingGeo = createConformalEllipticalHeadlightPatch(-0.96, 0.48, 0.058, 0.042, 0.002, 1);
  const fillerFlapRing = new THREE.Mesh(fillerFlapRingGeo, mats.glossBlackTrimMat);
  fillerFlapRing.name = `${namePrefix}.fuelFillerFlap.seam`;
  carGroup.add(fillerFlapRing);

  const fillerFlapCapGeo = createConformalEllipticalHeadlightPatch(-0.96, 0.48, 0.052, 0.037, 0.0026, 1);
  const fillerFlapCap = new THREE.Mesh(fillerFlapCapGeo, mats.oceanBlueBodyMat);
  fillerFlapCap.name = `${namePrefix}.fuelFillerFlap`;
  carGroup.add(fillerFlapCap);

  // Front (`x = -1.25m`) and Rear (`x = +1.20m`) Cylindrical Fender Arch Lip Flanges & Wheelhouse Liners
  buildWheelArchFenderLipAndLiner(
    carGroup,
    -1.25,
    0.338,
    0.362,
    0.888,
    mats.oceanBlueBodyMat,
    mats.satinBlackAeroMat,
    namePrefix
  );
  buildWheelArchFenderLipAndLiner(
    carGroup,
    1.20,
    0.354,
    0.382,
    0.928,
    mats.oceanBlueBodyMat,
    mats.satinBlackAeroMat,
    namePrefix
  );

  // Sculpted Lower Side Rocker Skirts & Flared Rear Sill Aero Winglet (`x = -0.86m .. +0.80m`)
  for (const sideZ of [-1, 1] as const) {
    const rockerGroup = new THREE.Group();
    rockerGroup.name = `${namePrefix}.rockerSkirt`;
    carGroup.add(rockerGroup);

    const rockerPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const rx = lerp(-0.86, 0.80, t);
      const flareZ = lerp(0.842, 0.905, Math.pow(t, 1.45));
      rockerPts.push(new THREE.Vector3(rx, 0.142, sideZ * flareZ));
    }
    const rockerCurve = new THREE.CatmullRomCurve3(rockerPts);
    const rockerBladeGeo = new THREE.TubeGeometry(rockerCurve, 24, 0.024, 8, false);
    rockerBladeGeo.computeBoundingSphere();
    const rockerBlade = new THREE.Mesh(rockerBladeGeo, mats.satinBlackAeroMat);
    rockerBlade.name = `${namePrefix}.rockerSkirt`;
    rockerBlade.scale.set(1.0, 0.65, 1.35);
    rockerBlade.position.set(0, 0.142 * 0.35, -sideZ * 0.86 * 0.35);
    rockerGroup.add(rockerBlade);

    // Body-colored upper sill moulding above the black aero skirt blade
    const upperSillGeo = new THREE.TubeGeometry(rockerCurve, 24, 0.020, 8, false);
    upperSillGeo.computeBoundingSphere();
    const upperSill = new THREE.Mesh(upperSillGeo, mats.oceanBlueBodyMat);
    upperSill.name = `${namePrefix}.rockerSkirt.upperMoulding`;
    upperSill.scale.set(1.0, 0.85, 1.1);
    upperSill.position.set(0, 0.032 + 0.142 * 0.15, -sideZ * 0.86 * 0.1);
    rockerGroup.add(upperSill);
  }
}
