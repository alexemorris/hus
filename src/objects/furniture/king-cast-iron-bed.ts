import * as THREE from 'three';
import { attachAssetMetadata } from '../shared/catalog-smart-metadata.ts';
import { getOrCreateCachedPropTexture } from '../../engine/textures/texture-registry.ts';

export interface KingCastIronBedOptions {
  readonly name: string;
  readonly zone?: string;
  /** World or parent-group position of the center-back of the headboard at floor level */
  readonly position: readonly [number, number, number];
  /** Rotation around Y in radians (`0` = bed extends along `+X` from headboard at `x = 0` to footboard at `x = +2.02m`) */
  readonly rotationY: number;
  /** Colour palette variant for the draped duvet, throw, bedspread, and cushions */
  readonly palette: 'sageOlive' | 'frenchBlue' | 'warmOatmealTerracotta';
  /** Frame proportion preset: compact 'ukKing' (1.52m × 1.98m) or 'ukDouble' (1.40m × 1.92m) */
  readonly size?: 'ukKing' | 'ukDouble';
}

/**
 * Creates a woven herringbone/waffle throw texture & bump map for the foot bedspread.
 */
function createWovenThrowTexture(
  baseHex: string,
  stripeHex: string,
  stitchHex: string
): {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
} {
  return getOrCreateCachedPropTexture(`king-bed:woven-throw:${baseHex}:${stripeHex}:${stitchHex}`, () => {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = 256;
  bumpCanvas.height = 256;
  const bCtx = bumpCanvas.getContext('2d');

  if (ctx && bCtx) {
    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, 256, 256);

    bCtx.fillStyle = '#808080';
    bCtx.fillRect(0, 0, 256, 256);

    const cell = 16;
    for (let gx = 0; gx < 256; gx += cell) {
      for (let gy = 0; gy < 256; gy += cell) {
        const grad = bCtx.createRadialGradient(
          gx + cell * 0.5,
          gy + cell * 0.5,
          1,
          gx + cell * 0.5,
          gy + cell * 0.5,
          cell * 0.65
        );
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.75, '#a8a8a8');
        grad.addColorStop(1, '#303030');
        bCtx.fillStyle = grad;
        bCtx.fillRect(gx, gy, cell, cell);

        ctx.strokeStyle = stitchHex;
        ctx.lineWidth = 1.2;
        ctx.strokeRect(gx + 0.5, gy + 0.5, cell - 1, cell - 1);
      }
    }

    // Decorative woven border stripes near the hanging side hems
    ctx.fillStyle = stripeHex;
    ctx.fillRect(0, 14, 256, 12);
    ctx.fillRect(0, 32, 256, 5);
    ctx.fillRect(0, 230, 256, 12);
    ctx.fillRect(0, 219, 256, 5);
  }

  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  map.repeat.set(2.5, 1);
  map.colorSpace = THREE.SRGBColorSpace;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(3.0, 5.0);

  return { map, bumpMap };
  });
}

/**
 * Creates a fine ticking-stripe cotton texture for turn-down folds and scatter cushions.
 */
function createTickingStripeTexture(
  bgHex: string,
  stripeHex: string
): THREE.CanvasTexture {
  return getOrCreateCachedPropTexture(`king-bed:ticking:${bgHex}:${stripeHex}`, () => {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = bgHex;
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = stripeHex;
    for (let y = 0; y < 128; y += 8) {
      ctx.fillRect(0, y, 128, 2.2);
      ctx.fillRect(0, y + 3.5, 128, 1.0);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 3);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
  });
}

interface KingDrapedLayerOptions {
  readonly xStart: number;
  readonly xEnd: number;
  readonly shellOffset: number;
  readonly loftThickness: number;
  readonly sideHemY: number;
  readonly sideFlareZ: number;
  readonly sideWaveCount: number;
  readonly sideWaveAmp: number;
  readonly wavePhaseOffset: number;
  readonly tuckFootBehindRail?: boolean;
  readonly headRolledFold?: boolean;
  readonly topHalfWidthZ?: number;
  readonly shoulderRadius?: number;
  readonly footShoulderX?: number;
  readonly segU?: number;
  readonly segV?: number;
}

/**
 * Generates a continuous, lofted 3D cloth-draped layer (duvet, turn-down fold, or foot throw)
 * tailored to a UK King Size cast-iron bedstead (`1.50m` mattress width, `|z| <= 0.75m`).
 * Wraps smoothly over the left & right mattress shoulders (`|z| = 0.72m..0.805m`) and hangs
 * down outside the cast-iron side rails (`|z| = 0.79m`) with natural drapery folds.
 */
function createKingDrapedLayerGeometry(
  opts: KingDrapedLayerOptions
): THREE.BufferGeometry {
  const {
    xStart,
    xEnd,
    shellOffset,
    loftThickness,
    sideHemY,
    sideFlareZ,
    sideWaveCount,
    sideWaveAmp,
    wavePhaseOffset,
    tuckFootBehindRail = false,
    headRolledFold = false,
    topHalfWidthZ = 0.665,
    shoulderRadius = 0.088,
    footShoulderX = 1.76,
    segU = 40,
    segV = 64,
  } = opts;

  const centerTopY = 0.575;
  const crownArchY = 0.026;
  const vRollStart = 0.46;
  const vShoulder = 0.60;

  const sampleLayerMidSurface = (u: number, v: number): THREE.Vector3 => {
    const absV = Math.abs(v);
    const signV = v < 0 ? -1 : 1;

    let x = THREE.MathUtils.lerp(xStart, xEnd, u);

    // Smooth foot-shoulder roll tucking neatly behind the cast-iron footboard posts & rail (x = 1.98m)
    let footDropY = 0;
    let cornerWaterfallFlareZ = 0;
    let cornerWaterfallDropY = 0;
    if (tuckFootBehindRail && x > footShoulderX) {
      const ft = Math.min(
        1,
        (x - footShoulderX) / Math.max(0.04, xEnd - footShoulderX)
      );
      const footCurve = ft * ft * (3 - 2 * ft);
      footDropY = 0.115 * footCurve;
      x += Math.sin(ft * Math.PI) * 0.006;

      if (absV > vRollStart && x < xEnd - 0.015) {
        const st = (absV - vRollStart) / (1 - vRollStart);
        const cornerWeight = ft * st;
        cornerWaterfallFlareZ = cornerWeight * 0.022;
        cornerWaterfallDropY = cornerWeight * 0.028;
      }
    }

    const topBillowY =
      0.003 *
      Math.sin(u * Math.PI * 3.0 + wavePhaseOffset) *
      Math.cos((v / vShoulder) * Math.PI * 1.5) *
      Math.max(0, 1 - absV / vShoulder);

    const shoulderTopY = centerTopY - crownArchY - footDropY * 0.32;

    let baseZMag: number;
    let baseY: number;
    let normY: number;
    let normZMag: number;

    if (absV <= vRollStart) {
      const tv = absV / vRollStart;
      baseZMag = tv * topHalfWidthZ;
      const crownProfile = 1 - tv * tv;
      baseY =
        shoulderTopY +
        crownArchY * crownProfile -
        footDropY * 0.68 * (1 - 0.3 * tv) +
        topBillowY;

      const dyDz = (-2 * crownArchY * tv) / topHalfWidthZ;
      const len = Math.hypot(1, dyDz);
      normY = 1 / len;
      normZMag = -dyDz / len;
    } else if (absV <= vShoulder) {
      const tr = (absV - vRollStart) / (vShoulder - vRollStart);
      const ang = tr * (Math.PI * 0.47);
      baseZMag = topHalfWidthZ + Math.sin(ang) * shoulderRadius;
      baseY =
        shoulderTopY -
        (1 - Math.cos(ang)) * shoulderRadius -
        footDropY * (0.68 - 0.48 * tr);
      normY = Math.cos(ang);
      normZMag = Math.sin(ang);
    } else {
      const ts = (absV - vShoulder) / (1 - vShoulder);
      const maxAng = Math.PI * 0.47;
      const shoulderExitZ = topHalfWidthZ + Math.sin(maxAng) * shoulderRadius;
      const shoulderExitY =
        shoulderTopY -
        (1 - Math.cos(maxAng)) * shoulderRadius -
        footDropY * 0.2;

      const wavePhase =
        u * Math.PI * 2 * sideWaveCount +
        wavePhaseOffset +
        (signV < 0 ? 0.3 : 1.6);
      const waveOffsetZ =
        (Math.sin(wavePhase) * 0.68 + Math.cos(wavePhase * 1.5) * 0.32) *
        sideWaveAmp *
        Math.pow(ts, 1.15);

      const skirtFlareCurve = ts * (0.35 + 0.65 * ts);
      baseZMag =
        shoulderExitZ +
        sideFlareZ * skirtFlareCurve +
        waveOffsetZ +
        cornerWaterfallFlareZ;

      const targetHemY =
        sideHemY -
        cornerWaterfallDropY +
        Math.sin(wavePhase) * 0.006 * ts;
      baseY = THREE.MathUtils.lerp(shoulderExitY, targetHemY, ts);

      normY = Math.cos(maxAng) * (1 - ts) + 0.12 * ts;
      normZMag = Math.sin(maxAng);
      const nLen = Math.hypot(normY, normZMag);
      normY /= nLen;
      normZMag /= nLen;
    }

    const edgeTuck =
      u < 0.035
        ? -0.004 * (1 - u / 0.035)
        : !tuckFootBehindRail && u > 0.965
          ? -0.004 * ((u - 0.965) / 0.035)
          : 0;
    const headFoldSwell =
      headRolledFold && u < 0.11
        ? Math.sin((u / 0.11) * Math.PI) * 0.006
        : 0;

    const totalOffset = shellOffset + edgeTuck + headFoldSwell;
    const finalY = baseY + normY * totalOffset;
    const finalZ = signV * (baseZMag + normZMag * totalOffset);

    return new THREE.Vector3(x, finalY, finalZ);
  };

  const cols = segU + 1;
  const rows = segV + 1;
  const midGrid: THREE.Vector3[] = new Array(cols * rows);
  const normGrid: THREE.Vector3[] = new Array(cols * rows);

  for (let iu = 0; iu <= segU; iu++) {
    const u = iu / segU;
    for (let iv = 0; iv <= segV; iv++) {
      const v = (iv / segV) * 2 - 1;
      midGrid[iu * rows + iv] = sampleLayerMidSurface(u, v);
    }
  }

  const dU = new THREE.Vector3();
  const dV = new THREE.Vector3();
  for (let iu = 0; iu <= segU; iu++) {
    const iuPrev = Math.max(0, iu - 1);
    const iuNext = Math.min(segU, iu + 1);
    for (let iv = 0; iv <= segV; iv++) {
      const ivPrev = Math.max(0, iv - 1);
      const ivNext = Math.min(segV, iv + 1);
      dU.subVectors(midGrid[iuNext * rows + iv], midGrid[iuPrev * rows + iv]);
      dV.subVectors(midGrid[iu * rows + ivNext], midGrid[iu * rows + ivPrev]);
      const n = new THREE.Vector3().crossVectors(dV, dU).normalize();
      normGrid[iu * rows + iv] = n;
    }
  }

  const halfLoft = loftThickness * 0.5;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const getEdgePillowFactor = (u: number, v: number): number => {
    const distU = Math.min(u, 1 - u);
    const distV = 1 - Math.abs(v);
    const fu = Math.min(1, distU / 0.05);
    const fv = Math.min(1, distV / 0.04);
    const f = Math.min(fu, fv);
    return 0.22 + 0.78 * Math.sin(f * (Math.PI * 0.5));
  };

  for (let iu = 0; iu <= segU; iu++) {
    const u = iu / segU;
    for (let iv = 0; iv <= segV; iv++) {
      const v = (iv / segV) * 2 - 1;
      const idx = iu * rows + iv;
      const p = midGrid[idx];
      const n = normGrid[idx];
      const h = halfLoft * getEdgePillowFactor(u, v);
      positions.push(p.x + n.x * h, p.y + n.y * h, p.z + n.z * h);
      uvs.push(u, iv / segV);
    }
  }

  const botOffset = cols * rows;
  for (let iu = 0; iu <= segU; iu++) {
    const u = iu / segU;
    for (let iv = 0; iv <= segV; iv++) {
      const v = (iv / segV) * 2 - 1;
      const idx = iu * rows + iv;
      const p = midGrid[idx];
      const n = normGrid[idx];
      const h = halfLoft * getEdgePillowFactor(u, v);
      positions.push(p.x - n.x * h, p.y - n.y * h, p.z - n.z * h);
      uvs.push(u, iv / segV);
    }
  }

  for (let iu = 0; iu < segU; iu++) {
    for (let iv = 0; iv < segV; iv++) {
      const a = iu * rows + iv;
      const b = a + 1;
      const c = (iu + 1) * rows + iv;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
      indices.push(
        botOffset + a,
        botOffset + c,
        botOffset + b,
        botOffset + b,
        botOffset + c,
        botOffset + d
      );
    }
  }

  for (let iv = 0; iv < segV; iv++) {
    const t0 = iv;
    const t1 = iv + 1;
    const b0 = botOffset + iv;
    const b1 = botOffset + iv + 1;
    indices.push(t0, b0, t1, t1, b0, b1);

    const ft0 = segU * rows + iv;
    const ft1 = ft0 + 1;
    const fb0 = botOffset + ft0;
    const fb1 = botOffset + ft1;
    indices.push(ft0, ft1, fb0, ft1, fb1, fb0);
  }

  for (let iu = 0; iu < segU; iu++) {
    const t0 = iu * rows;
    const t1 = (iu + 1) * rows;
    const b0 = botOffset + t0;
    const b1 = botOffset + t1;
    indices.push(t0, t1, b0, t1, b1, b0);

    const st0 = iu * rows + segV;
    const st1 = (iu + 1) * rows + segV;
    const sb0 = botOffset + st0;
    const sb1 = botOffset + st1;
    indices.push(st0, sb0, st1, st1, sb0, sb1);
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
 * Creates a plump pinched-seam feather pillow geometry with tapered knife-edge corners.
 */
function createPinchedPillowGeometry(
  thicknessX: number,
  heightY: number,
  widthZ: number,
  hasOxfordFlange = false
): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(thicknessX, heightY, widthZ, 10, 18, 22);
  const pos = geo.attributes.position;
  const halfX = thicknessX / 2;
  const halfY = heightY / 2;
  const halfZ = widthZ / 2;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    const nx = halfX > 0 ? x / halfX : 0;
    const ny = halfY > 0 ? y / halfY : 0;
    const nz = halfZ > 0 ? z / halfZ : 0;

    const cosY = Math.cos(ny * Math.PI * 0.5);
    const cosZ = Math.cos(nz * Math.PI * 0.5);
    const plumpEnvelope = Math.pow(Math.max(0, cosY * cosZ), 0.58);

    const edgeDist = Math.max(Math.abs(ny), Math.abs(nz));
    const flangeFactor =
      hasOxfordFlange && edgeDist > 0.84
        ? 0.14
        : 0.12 + 0.88 * plumpEnvelope;

    const cornerFlare = 1 + 0.042 * (ny * ny * nz * nz);
    const centerDimpleX =
      nx > 0 ? -0.01 * Math.exp(-(ny * ny * 3.5 + nz * nz * 4.0)) : 0;
    const topCreaseY =
      ny > 0.3
        ? -0.007 * Math.exp(-(nz * nz * 6.0)) * ((ny - 0.3) / 0.7)
        : 0;

    pos.setXYZ(
      i,
      x * flangeFactor + centerDimpleX,
      y * cornerFlare + topCreaseY,
      z * cornerFlare
    );
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Builds a high-LOD traditional Victorian / Edwardian **King Size Cast-Iron & Aged-Brass Bedstead**
 * (`1.58m` wide × `2.04m` long) complete with tubular cast-iron headboard & footboard, foundry
 * knuckle castings, aged-brass ball finials, and sculpted 3D cloth-draped bedding.
 */
export function buildKingCastIronBed(
  scene: THREE.Object3D,
  options: KingCastIronBedOptions
): THREE.Group {
  const { name, zone, position, rotationY, palette } = options;

  const bedGroup = new THREE.Group();
  bedGroup.name = name;
  if (zone !== undefined) {
    bedGroup.userData.zone = zone;
  }
  bedGroup.position.set(position[0], position[1], position[2]);
  bedGroup.rotation.y = rotationY;

  // Materials for Cast-Iron Frame & Aged Brass Finials/Collars
  const castIronMat = new THREE.MeshStandardMaterial({
    color: 0x1e2125, // Forged satin black/anthracite cast iron
    roughness: 0.38,
    metalness: 0.76,
  });
  const agedBrassMat = new THREE.MeshStandardMaterial({
    color: 0xb8964c, // Warm burnished Victorian brass finials & collars
    roughness: 0.26,
    metalness: 0.86,
  });

  // Palette-specific textile materials
  const paletteConfigs = {
    sageOlive: {
      duvetHex: 0x9aa494, // Soft heritage sage-olive washed linen
      pillowMidHex: 0x6f7a68, // Deep olive linen Oxford pillows
      stripeBg: '#ece3d3',
      stripeFg: '#6c7564',
      throwBase: '#434d41',
      throwStripe: '#c8bca6',
      throwStitch: 'rgba(28, 34, 26, 0.45)',
    },
    frenchBlue: {
      duvetHex: 0xa4b2bc, // Soft French blue / duck-egg linen
      pillowMidHex: 0x5c6e7e, // Slate-indigo Oxford pillows
      stripeBg: '#eee6d8',
      stripeFg: '#536473',
      throwBase: '#3c4956',
      throwStripe: '#d0c4b0',
      throwStitch: 'rgba(22, 28, 36, 0.45)',
    },
    warmOatmealTerracotta: {
      duvetHex: 0xd8cebe, // Warm natural flax/oatmeal linen
      pillowMidHex: 0x9e634b, // Warm terracotta-russet linen Oxford pillows
      stripeBg: '#efe6d6',
      stripeFg: '#8c5843',
      throwBase: '#7c4b3a',
      throwStripe: '#dfcfb8',
      throwStitch: 'rgba(52, 28, 20, 0.42)',
    },
  } as const;

  const pal = paletteConfigs[palette];

  const ivorySheetMat = new THREE.MeshStandardMaterial({
    color: 0xf5f0e6,
    roughness: 0.84,
    metalness: 0.01,
  });
  const duvetMat = new THREE.MeshStandardMaterial({
    color: pal.duvetHex,
    roughness: 0.88,
    metalness: 0.01,
  });
  const midPillowMat = new THREE.MeshStandardMaterial({
    color: pal.pillowMidHex,
    roughness: 0.86,
    metalness: 0.01,
  });
  const tickingFoldMat = new THREE.MeshStandardMaterial({
    map: createTickingStripeTexture(pal.stripeBg, pal.stripeFg),
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0.01,
  });
  const wovenThrowTex = createWovenThrowTexture(
    pal.throwBase,
    pal.throwStripe,
    pal.throwStitch
  );
  const footThrowMat = new THREE.MeshStandardMaterial({
    map: wovenThrowTex.map,
    bumpMap: wovenThrowTex.bumpMap,
    bumpScale: 0.011,
    color: 0xffffff,
    roughness: 0.86,
    metalness: 0.02,
  });

  // VICTORIAN CAST-IRON & AGED-BRASS BEDSTEAD FRAME
  //    Right-sized compact UK King (1.52m W × 1.97m L) or UK Double (1.40m W × 1.91m L)
  //    with low period footboard (0.74m to finial tip) preserving walk-in sightlines.
  const isDouble = options.size === 'ukDouble';
  const halfSpanZ = isDouble ? 0.675 : 0.735;
  const headX = 0.032;
  const footX = isDouble ? 1.885 : 1.945;
  const sideRailY = 0.34;
  const headPostH = 1.06;
  const footPostH = 0.59;

  // Shared LatheGeometry for cast-iron foundry knuckle collars & brass finials
  const knucklePts: THREE.Vector2[] = [
    new THREE.Vector2(0.0, -0.028),
    new THREE.Vector2(0.015, -0.028),
    new THREE.Vector2(0.021, -0.014),
    new THREE.Vector2(0.025, 0.0),
    new THREE.Vector2(0.021, 0.014),
    new THREE.Vector2(0.015, 0.028),
    new THREE.Vector2(0.0, 0.028),
  ];
  const foundryKnuckleGeo = new THREE.LatheGeometry(knucklePts, 14);

  const finialPts: THREE.Vector2[] = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.025, 0.0),
    new THREE.Vector2(0.028, 0.008),
    new THREE.Vector2(0.016, 0.02),
    new THREE.Vector2(0.032, 0.052),
    new THREE.Vector2(0.034, 0.068),
    new THREE.Vector2(0.028, 0.086),
    new THREE.Vector2(0.012, 0.1),
    new THREE.Vector2(0.016, 0.108),
    new THREE.Vector2(0.005, 0.124),
    new THREE.Vector2(0.0, 0.128),
  ];
  const brassFinialGeo = new THREE.LatheGeometry(finialPts, 18);

  // Helper to build either the Headboard (at x = headX) or Footboard (at x = footX)
  const buildCastIronEndFrame = (
    endTag: 'headboard' | 'footboard',
    endX: number,
    postHeight: number,
    lowerRailY: number,
    midRailY: number,
    archShoulderY: number,
    archCrownRiseY: number
  ): void => {
    const endGroup = new THREE.Group();
    endGroup.name = `${name}.${endTag}`;

    // Left & Right tubular cast-iron corner posts + brass caster feet + foundry knuckles + brass ball finials
    for (const sideSign of [-1, 1] as const) {
      const sideLabel = sideSign < 0 ? 'left' : 'right';
      const pz = sideSign * halfSpanZ;
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.021, 0.021, postHeight, 16),
        castIronMat
      );
      post.name = `${name}.${endTag}.post.${sideLabel}`;
      post.position.set(endX, postHeight / 2 + 0.03, pz);
      post.castShadow = true;
      post.receiveShadow = true;
      endGroup.add(post);

      // Brass caster cup & wheel at bottom of post
      const casterCup = new THREE.Mesh(
        new THREE.CylinderGeometry(0.024, 0.017, 0.032, 14),
        agedBrassMat
      );
      casterCup.name = `${name}.${endTag}.casterCup.${sideLabel}`;
      casterCup.position.set(endX, 0.016, pz);
      endGroup.add(casterCup);

      // Foundry knuckle castings at rail junctions
      for (const [kTag, ky] of [
        ['lower', lowerRailY],
        ['mid', midRailY],
        ['upper', archShoulderY],
      ] as const) {
        const knuckle = new THREE.Mesh(foundryKnuckleGeo, castIronMat);
        knuckle.name = `${name}.${endTag}.post.${sideLabel}.knuckle.${kTag}`;
        knuckle.userData.lodTier = 'high';
        knuckle.userData.lodMaxDistance = 12;
        knuckle.position.set(endX, ky, pz);
        endGroup.add(knuckle);
      }

      // Decorative brass collar ring midway up the post
      const brassRing = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.025, 0.018, 16),
        agedBrassMat
      );
      brassRing.name = `${name}.${endTag}.post.${sideLabel}.brassCollar`;
      brassRing.userData.lodTier = 'high';
      brassRing.userData.lodMaxDistance = 12;
      brassRing.position.set(endX, (midRailY + archShoulderY) * 0.5, pz);
      endGroup.add(brassRing);

      // Turned Aged-Brass Ball & Spire Finial atop each corner post
      const finial = new THREE.Mesh(brassFinialGeo, agedBrassMat);
      finial.name = `${name}.${endTag}.finial.${sideLabel}`;
      finial.position.set(endX, postHeight + 0.03, pz);
      finial.castShadow = true;
      endGroup.add(finial);
    }

    // Horizontal tubular cast-iron lower & middle cross-rails
    const railSpan = halfSpanZ * 2;
    for (const [rTag, ry] of [
      ['lowerCrossRail', lowerRailY],
      ['midCrossRail', midRailY],
    ] as const) {
      const crossRail = new THREE.Mesh(
        new THREE.CylinderGeometry(0.014, 0.014, railSpan, 14),
        castIronMat
      );
      crossRail.name = `${name}.${endTag}.${rTag}`;
      crossRail.rotation.x = Math.PI / 2;
      crossRail.position.set(endX, ry, 0);
      crossRail.castShadow = true;
      endGroup.add(crossRail);
    }

    // Sweeping Arched Tubular Cast-Iron Top Rail (`TubeGeometry` from -halfSpanZ to +halfSpanZ)
    const sampleArchY = (z: number): number => {
      const nz = z / halfSpanZ;
      return archShoulderY + archCrownRiseY * (1 - nz * nz);
    };
    const archCurvePts: THREE.Vector3[] = [];
    const archSegs = 28;
    for (let i = 0; i <= archSegs; i++) {
      const z = THREE.MathUtils.lerp(-halfSpanZ, halfSpanZ, i / archSegs);
      archCurvePts.push(new THREE.Vector3(endX, sampleArchY(z), z));
    }
    const archCurve = new THREE.CatmullRomCurve3(archCurvePts);
    const topArchRail = new THREE.Mesh(
      new THREE.TubeGeometry(archCurve, 32, 0.0155, 14, false),
      castIronMat
    );
    topArchRail.name = `${name}.${endTag}.topArchRail`;
    topArchRail.castShadow = true;
    endGroup.add(topArchRail);

    // 9 Vertical Cast-Iron Baluster Spindles with Foundry Knuckle Collars & Brass Rings
    const numSpindles = 9;
    const spindleSpanZ = railSpan - 0.18;
    for (let i = 0; i < numSpindles; i++) {
      const sz = THREE.MathUtils.lerp(
        -spindleSpanZ / 2,
        spindleSpanZ / 2,
        i / (numSpindles - 1)
      );
      const topY = sampleArchY(sz);
      const spindleH = topY - lowerRailY;
      const spindle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.008, 0.008, spindleH, 10),
        castIronMat
      );
      spindle.name = `${name}.${endTag}.spindle.${i + 1}`;
      spindle.position.set(endX, lowerRailY + spindleH / 2, sz);
      spindle.castShadow = true;
      endGroup.add(spindle);

      // Cast-iron knuckle at midRailY junction
      const midKnuckle = new THREE.Mesh(foundryKnuckleGeo, castIronMat);
      midKnuckle.name = `${name}.${endTag}.spindle.${i + 1}.knuckle`;
      midKnuckle.userData.lodTier = 'high';
      midKnuckle.userData.lodMaxDistance = 12;
      midKnuckle.scale.set(0.62, 0.65, 0.62);
      midKnuckle.position.set(endX, midRailY, sz);
      endGroup.add(midKnuckle);

      // Decorative brass collar ring on alternating spindles
      if (i % 2 === 0) {
        const spindleBrassRing = new THREE.Mesh(
          new THREE.CylinderGeometry(0.013, 0.013, 0.014, 12),
          agedBrassMat
        );
        spindleBrassRing.name = `${name}.${endTag}.spindle.${i + 1}.brassCollar`;
        spindleBrassRing.userData.lodTier = 'high';
        spindleBrassRing.userData.lodMaxDistance = 12;
        spindleBrassRing.position.set(endX, (midRailY + topY) * 0.5, sz);
        endGroup.add(spindleBrassRing);
      }
    }

    bedGroup.add(endGroup);
  };

  // Build Headboard (`x = headX = 0.032m`, posts `1.06m` + brass finials to `1.22m`)
  buildCastIronEndFrame(
    'headboard',
    headX,
    headPostH,
    0.34,
    0.72,
    1.01,
    0.075
  );

  // Build Low Period Footboard (`x = footX`, posts `0.59m` + brass finials to `0.75m`)
  buildCastIronEndFrame(
    'footboard',
    footX,
    footPostH,
    0.34,
    0.46,
    0.57,
    0.042
  );

  // Tubular Cast-Iron Side Rails (`z = ±halfSpanZ`, `x = headX..footX`, `y = sideRailY`)
  const sideRailLen = footX - headX;
  const sideRailCenterX = (headX + footX) / 2;
  for (const sideSign of [-1, 1] as const) {
    const sideRail = new THREE.Mesh(
      new THREE.BoxGeometry(sideRailLen, 0.042, 0.028),
      castIronMat
    );
    sideRail.name = `${name}.sideRail.${sideSign < 0 ? 'left' : 'right'}`;
    sideRail.position.set(sideRailCenterX, sideRailY, sideSign * halfSpanZ);
    sideRail.castShadow = true;
    bedGroup.add(sideRail);
  }

  // MATTRESS, SCULPTED 3D DRAPED DUVET, TICKING TURN-DOWN & FOOT THROW
  const mattressLenX = isDouble ? 1.74 : 1.80;
  const mattressWidZ = isDouble ? 1.24 : 1.36;
  const drapeTopHalfZ = isDouble ? 0.592 : 0.652;
  const drapeShoulderR = isDouble ? 0.084 : 0.086;
  const duvetEndX = footX - 0.045;
  const footShoulderX = duvetEndX - 0.125;

  const mattressGeo = new THREE.BoxGeometry(mattressLenX, 0.20, mattressWidZ, 16, 6, 16);
  const mattressMesh = new THREE.Mesh(mattressGeo, ivorySheetMat);
  mattressMesh.name = `${name}.mattress`;
  mattressMesh.position.set(0.06 + mattressLenX * 0.5, 0.44, 0);
  mattressMesh.castShadow = true;
  mattressMesh.receiveShadow = true;
  bedGroup.add(mattressMesh);

  // Layer 1 — Sculpted 3D Draped Washed Linen Duvet
  const duvetGeo = createKingDrapedLayerGeometry({
    xStart: 0.41,
    xEnd: duvetEndX,
    shellOffset: 0.0,
    loftThickness: 0.022,
    sideHemY: 0.26,
    sideFlareZ: 0.016,
    sideWaveCount: 3.5,
    sideWaveAmp: 0.007,
    wavePhaseOffset: 0.0,
    tuckFootBehindRail: true,
    headRolledFold: true,
    topHalfWidthZ: drapeTopHalfZ,
    shoulderRadius: drapeShoulderR,
    footShoulderX,
    segU: 44,
    segV: 64,
  });
  const duvetMesh = new THREE.Mesh(duvetGeo, duvetMat);
  duvetMesh.name = `${name}.duvet`;
  duvetMesh.castShadow = true;
  duvetMesh.receiveShadow = true;
  bedGroup.add(duvetMesh);

  // Layer 2 — Sculpted Ticking-Stripe Turn-Down Fold
  const turnDownGeo = createKingDrapedLayerGeometry({
    xStart: 0.39,
    xEnd: 0.70,
    shellOffset: 0.013,
    loftThickness: 0.012,
    sideHemY: 0.275,
    sideFlareZ: 0.018,
    sideWaveCount: 1.5,
    sideWaveAmp: 0.006,
    wavePhaseOffset: 0.6,
    tuckFootBehindRail: false,
    headRolledFold: true,
    topHalfWidthZ: drapeTopHalfZ,
    shoulderRadius: drapeShoulderR,
    footShoulderX,
    segU: 22,
    segV: 60,
  });
  const turnDownMesh = new THREE.Mesh(turnDownGeo, tickingFoldMat);
  turnDownMesh.name = `${name}.sheetTurnDown`;
  turnDownMesh.castShadow = true;
  turnDownMesh.receiveShadow = true;
  bedGroup.add(turnDownMesh);

  // Layer 3 — Sculpted Waffle-Quilted Foot Bedspread / Throw
  const footThrowGeo = createKingDrapedLayerGeometry({
    xStart: duvetEndX - 0.76,
    xEnd: duvetEndX + 0.005,
    shellOffset: 0.016,
    loftThickness: 0.014,
    sideHemY: 0.22,
    sideFlareZ: 0.020,
    sideWaveCount: 2.5,
    sideWaveAmp: 0.008,
    wavePhaseOffset: 1.3,
    tuckFootBehindRail: true,
    headRolledFold: true,
    topHalfWidthZ: drapeTopHalfZ,
    shoulderRadius: drapeShoulderR,
    footShoulderX,
    segU: 36,
    segV: 64,
  });
  const footThrowMesh = new THREE.Mesh(footThrowGeo, footThrowMat);
  footThrowMesh.name = `${name}.footThrow`;
  footThrowMesh.castShadow = true;
  footThrowMesh.receiveShadow = true;
  bedGroup.add(footThrowMesh);

  // PINCHED-SEAM FEATHER PILLOWS & SCATTER CUSHIONS
  const pillowWidthZ = isDouble ? 0.55 : 0.60;
  const pillowOffsetZ = isDouble ? 0.295 : 0.325;
  const backPillowGeo = createPinchedPillowGeometry(0.16, 0.37, pillowWidthZ, false);
  const oxfordPillowGeo = createPinchedPillowGeometry(0.15, 0.38, pillowWidthZ, true);
  const lumbarCushionGeo = createPinchedPillowGeometry(0.125, 0.24, isDouble ? 0.46 : 0.50, false);

  for (const [pIdx, pz] of [
    [1, -pillowOffsetZ],
    [2, pillowOffsetZ],
  ] as const) {
    const backPillow = new THREE.Mesh(backPillowGeo, ivorySheetMat);
    backPillow.name = `${name}.pillow.back.${pIdx}`;
    backPillow.position.set(0.16, 0.69, pz);
    backPillow.rotation.z = 0.22;
    backPillow.castShadow = true;
    backPillow.receiveShadow = true;
    bedGroup.add(backPillow);

    const midPillow = new THREE.Mesh(oxfordPillowGeo, midPillowMat);
    midPillow.name = `${name}.pillow.mid.${pIdx}`;
    midPillow.position.set(0.285, 0.68, pz);
    midPillow.rotation.z = 0.3;
    midPillow.castShadow = true;
    midPillow.receiveShadow = true;
    bedGroup.add(midPillow);
  }

  const centerLumbar = new THREE.Mesh(lumbarCushionGeo, tickingFoldMat);
  centerLumbar.name = `${name}.cushion.lumbar`;
  centerLumbar.position.set(0.41, 0.645, 0);
  centerLumbar.rotation.z = 0.38;
  centerLumbar.castShadow = true;
  centerLumbar.receiveShadow = true;
  bedGroup.add(centerLumbar);

  attachAssetMetadata(bedGroup, {
    name: 'Cornish Bed Company Cast-Iron & Brass Finial King Bedstead',
    brand: 'The Cornish Bed Company',
    collection: 'Traditional Cast Iron',
    sku: 'CBC-VIC-KING-AB',
    finish: 'Hand-Poured Matte Black Cast Iron & Aged Spun Brass',
    category: 'furniture',
    dimensionsMm: [1580, 2120, 1420],
    productUrl: 'https://www.cornishbeds.co.uk/beds/cast-iron-beds/',
    schematicUrl: 'https://www.cornishbeds.co.uk/technical/king-bedstead-dimensions.pdf',
  });
  scene.add(bedGroup);
  return bedGroup;
}
