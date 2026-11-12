import * as THREE from 'three';
import { attachAssetInteraction, attachAssetMetadata, formatBrasswareFinishLabel, resolveBrasswareCode } from '../shared/catalog-smart-metadata.ts';
import {
  buildBasinTapFromSpec,
  isCustomTapObject3D,
  mountTapOnFixture,
  registerTapMountAnchor,
} from './perrin-rowe-taps.ts';
import {
  finalizeSanitaryGroup,
  getAntiqueWhiteCeramicMaterial,
  getBathroomBrassMaterials,
  getVitreousChinaMaterial,
  getWcSeatMaterial,
  getWcWaterSealMaterial,
} from './bathroom-materials.ts';
import { prepGeo } from '../shared/scene-helpers.ts';
import type {
  ThomasCrapperCeramicFinish,
  ThomasCrapperDownhamBasinOptions,
  ThomasCrapperLowLevelWcOptions,
} from './bathroom-spec-types.ts';

// ---------------------------------------------------------------------------
// Procedural Heritage Embossed Plaque & Underglaze Cartouche DataTextures
// (Pure Uint8Array — zero DOM dependencies, deterministic in Node/Vitest/WebGPU)
// ---------------------------------------------------------------------------

const GLYPH_5X7: Record<string, readonly number[]> = {
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  C: [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
  N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  '&': [0b01100, 0b10010, 0b10100, 0b01000, 0b10101, 0b10010, 0b01101],
  '.': [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00110, 0b00110],
  ' ': [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000],
};

function stampWordMask(
  mask: Float32Array,
  texW: number,
  texH: number,
  word: string,
  centerY: number,
  scaleX: number,
  scaleY: number,
  letterSpacing: number
): void {
  const charW = 5 * scaleX;
  const charH = 7 * scaleY;
  const totalW = word.length * charW + Math.max(0, word.length - 1) * letterSpacing;
  const startX = Math.round((texW - totalW) * 0.5);
  const startY = Math.round(centerY - charH * 0.5);

  for (let ci = 0; ci < word.length; ci++) {
    const glyph = GLYPH_5X7[word[ci]!] ?? GLYPH_5X7[' ']!;
    const ox = startX + ci * (charW + letterSpacing);
    for (let gy = 0; gy < 7; gy++) {
      const rowBits = glyph[gy]!;
      for (let gx = 0; gx < 5; gx++) {
        if (((rowBits >> (4 - gx)) & 1) === 0) continue;
        for (let sy = 0; sy < scaleY; sy++) {
          const py = startY + gy * scaleY + sy;
          if (py < 0 || py >= texH) continue;
          // DataTexture Y=0 is bottom, so flip Y for upright text
          const texY = texH - 1 - py;
          for (let sx = 0; sx < scaleX; sx++) {
            const px = ox + gx * scaleX + sx;
            if (px >= 0 && px < texW) {
              mask[texY * texW + px] = 1.0;
            }
          }
        }
      }
    }
  }
}

let downhamPlaqueBumpCache: THREE.DataTexture | null = null;
function getDownhamEmbossedPlaqueBumpMap(): THREE.DataTexture {
  if (downhamPlaqueBumpCache) return downhamPlaqueBumpCache;
  const w = 256;
  const h = 128;
  const raw = new Float32Array(w * h);

  // Scalloped-corner inner border fillet
  for (let y = 0; y < h; y++) {
    const ny = Math.abs((y - h * 0.5) / (h * 0.5));
    for (let x = 0; x < w; x++) {
      const nx = Math.abs((x - w * 0.5) / (w * 0.5));
      const cornerDist = Math.hypot((1 - nx) * w * 0.5, (1 - ny) * h * 0.5);
      const borderBand =
        (nx > 0.88 && nx < 0.92 && cornerDist > 18) ||
        (ny > 0.80 && ny < 0.86 && cornerDist > 18) ||
        (cornerDist >= 16.5 && cornerDist <= 19.5);
      if (borderBand) {
        raw[y * w + x] = 0.65;
      }
    }
  }

  stampWordMask(raw, w, h, 'THOMAS', h * 0.37, 4, 3, 5);
  stampWordMask(raw, w, h, 'CRAPPER', h * 0.66, 4, 3, 4);

  // Soft 3x3 Gaussian blur for rounded glazed ceramic relief shoulders
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let weight = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          const k = dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1;
          sum += raw[yy * w + xx]! * k;
          weight += k;
        }
      }
      const byte = Math.min(255, Math.max(0, Math.round(128 + (sum / weight) * 124)));
      const idx = (y * w + x) * 4;
      data[idx] = byte;
      data[idx + 1] = byte;
      data[idx + 2] = byte;
      data[idx + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.name = 'bathroom.thomasCrapper.downhamPlaque.bump';
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  downhamPlaqueBumpCache = tex;
  return tex;
}

const downhamPlaqueMatCache = new Map<ThomasCrapperCeramicFinish, THREE.MeshPhysicalMaterial>();
function getDownhamPlaqueMaterial(finish: ThomasCrapperCeramicFinish): THREE.MeshPhysicalMaterial {
  const existing = downhamPlaqueMatCache.get(finish);
  if (existing) return existing;
  const base =
    finish === 'antiqueWhite' ? getAntiqueWhiteCeramicMaterial() : getVitreousChinaMaterial();
  const mat = base.clone();
  mat.name = `bathroom.thomasCrapper.downhamPlaque.${finish}`;
  mat.bumpMap = getDownhamEmbossedPlaqueBumpMap();
  mat.bumpScale = 0.0038;
  downhamPlaqueMatCache.set(finish, mat);
  return mat;
}

const cisternBadgeMatCache = new Map<ThomasCrapperCeramicFinish, THREE.MeshPhysicalMaterial>();
function getCisternCartoucheMaterial(finish: ThomasCrapperCeramicFinish): THREE.MeshPhysicalMaterial {
  const existing = cisternBadgeMatCache.get(finish);
  if (existing) return existing;

  const w = 256;
  const h = 160;
  const ink = new Float32Array(w * h);

  // Classic Victorian double oval wreath border
  for (let y = 0; y < h; y++) {
    const ny = (y - h * 0.5) / (h * 0.44);
    for (let x = 0; x < w; x++) {
      const nx = (x - w * 0.5) / (w * 0.45);
      const r = Math.hypot(nx, ny);
      if ((r >= 0.92 && r <= 0.98) || (r >= 0.82 && r <= 0.85)) {
        ink[y * w + x] = 0.88;
      }
    }
  }

  stampWordMask(ink, w, h, 'THOMAS', h * 0.33, 3, 2, 3);
  stampWordMask(ink, w, h, 'CRAPPER', h * 0.52, 3, 2, 3);
  stampWordMask(ink, w, h, '& CO. LTD', h * 0.70, 2, 2, 2);

  const bgRgb = finish === 'antiqueWhite' ? [242, 237, 224] : [247, 246, 242];
  const inkRgb = [46, 44, 41]; // Authentic underglaze charcoal-sepia transfer print
  const colorData = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const t = Math.min(1, ink[i]!);
    const idx = i * 4;
    colorData[idx] = Math.round(bgRgb[0]! * (1 - t) + inkRgb[0]! * t);
    colorData[idx + 1] = Math.round(bgRgb[1]! * (1 - t) + inkRgb[1]! * t);
    colorData[idx + 2] = Math.round(bgRgb[2]! * (1 - t) + inkRgb[2]! * t);
    colorData[idx + 3] = 255;
  }

  const colorMap = new THREE.DataTexture(colorData, w, h, THREE.RGBAFormat);
  colorMap.name = `bathroom.thomasCrapper.cisternCartouche.${finish}.color`;
  colorMap.colorSpace = THREE.SRGBColorSpace;
  colorMap.wrapS = THREE.ClampToEdgeWrapping;
  colorMap.wrapT = THREE.ClampToEdgeWrapping;
  colorMap.magFilter = THREE.LinearFilter;
  colorMap.minFilter = THREE.LinearMipmapLinearFilter;
  colorMap.generateMipmaps = true;
  colorMap.needsUpdate = true;

  const mat = new THREE.MeshPhysicalMaterial({
    name: `bathroom.thomasCrapper.cisternCartouche.${finish}`,
    color: 0xffffff,
    map: colorMap,
    metalness: 0.0,
    roughness: 0.11,
    clearcoat: 0.88,
    clearcoatRoughness: 0.07,
    reflectivity: 0.65,
  });
  cisternBadgeMatCache.set(finish, mat);
  return mat;
}

function getCeramicMaterial(finish: ThomasCrapperCeramicFinish): THREE.MeshPhysicalMaterial {
  return finish === 'antiqueWhite' ? getAntiqueWhiteCeramicMaterial() : getVitreousChinaMaterial();
}

// ---------------------------------------------------------------------------
// Rounded-Rectangle Contour & Scalloped Plaque Helpers
// ---------------------------------------------------------------------------

/**
 * Samples `segCount` perimeter points around a centered rounded rectangle (`halfW`, `halfD`, `radius`)
 * in the `(X, Z)` plane starting from angle 0 (`+X, 0`) counter-clockwise.
 */
function sampleRoundedRectRing(
  halfW: number,
  halfD: number,
  cornerRadius: number,
  centerZ: number,
  segPerCorner = 10
): Array<[number, number]> {
  const r = Math.min(cornerRadius, halfW * 0.92, halfD * 0.92);
  const cx = halfW - r;
  const cz = halfD - r;
  const corners: Array<[number, number, number]> = [
    [cx, cz, 0],
    [-cx, cz, Math.PI * 0.5],
    [-cx, -cz, Math.PI],
    [cx, -cz, Math.PI * 1.5],
  ];
  const pts: Array<[number, number]> = [];
  for (const [ox, oz, startAng] of corners) {
    for (let i = 0; i <= segPerCorner; i++) {
      const a = startAng + (i / segPerCorner) * (Math.PI * 0.5);
      pts.push([ox + Math.cos(a) * r, centerZ + oz + Math.sin(a) * r]);
    }
  }
  return pts;
}

/**
 * Lofts a closed multi-ring profile (`rings` of `[halfW, halfD, cornerR, y, centerZ]`)
 * into a watertight, smooth-shaded `THREE.BufferGeometry` (outer + inner hollow shell).
 */
function buildLoftedRoundedRectShellGeometry(
  rings: ReadonlyArray<readonly [number, number, number, number, number]>,
  segPerCorner = 10,
  capBottom = true
): THREE.BufferGeometry {
  const ringPts = rings.map(([hw, hd, cr, , cz]) =>
    sampleRoundedRectRing(hw, hd, cr, cz, segPerCorner)
  );
  const cols = ringPts[0]!.length;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let ri = 0; ri < rings.length; ri++) {
    const y = rings[ri]![3]!;
    const v = ri / Math.max(1, rings.length - 1);
    const pts = ringPts[ri]!;
    for (let ci = 0; ci <= cols; ci++) {
      const [px, pz] = pts[ci % cols]!;
      positions.push(px, y, pz);
      uvs.push(ci / cols, v);
    }
  }

  const stride = cols + 1;
  for (let ri = 0; ri < rings.length - 1; ri++) {
    const r0 = ri * stride;
    const r1 = (ri + 1) * stride;
    for (let ci = 0; ci < cols; ci++) {
      const a = r0 + ci;
      const b = r0 + ci + 1;
      const c = r1 + ci + 1;
      const d = r1 + ci;
      indices.push(a, d, b, b, d, c);
    }
  }

  if (capBottom && rings.length > 0) {
    const y0 = rings[0]![3]!;
    const cz0 = rings[0]![4]!;
    const centerIdx = positions.length / 3;
    positions.push(0, y0, cz0);
    uvs.push(0.5, 0.5);
    for (let ci = 0; ci < cols; ci++) {
      indices.push(centerIdx, ci, ci + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return prepGeo(geo);
}

/**
 * Builds a Victorian scalloped-corner rectangular plaque (`width × height` with concave
 * quarter-circle corner cutouts of radius `scallopR`), normalized UVs `[0..1] × [0..1]`.
 */
function createScallopedPlaqueGeometry(
  width: number,
  height: number,
  scallopR: number,
  depth: number,
  bevelSize = 0.0018
): THREE.BufferGeometry {
  const hw = width * 0.5 - bevelSize;
  const hh = height * 0.5 - bevelSize;
  const r = Math.min(scallopR, hw * 0.45, hh * 0.45);

  const shape = new THREE.Shape();
  shape.moveTo(-(hw - r), -hh);
  shape.lineTo(hw - r, -hh);
  shape.absarc(hw, -hh, r, Math.PI, Math.PI * 0.5, true);
  shape.lineTo(hw, hh - r);
  shape.absarc(hw, hh, r, Math.PI * 1.5, Math.PI, true);
  shape.lineTo(-(hw - r), hh);
  shape.absarc(-hw, hh, r, 0, -Math.PI * 0.5, true);
  shape.lineTo(-hw, -(hh - r));
  shape.absarc(-hw, -hh, r, Math.PI * 0.5, 0, true);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevelSize,
    bevelSize,
    bevelSegments: 3,
    curveSegments: 16,
  });

  // Normalize planar UVs across [-width/2..+width/2] x [-height/2..+height/2] for crisp embossed text alignment
  const pos = geo.attributes.position!;
  const uvArr = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    uvArr[i * 2] = Math.min(1, Math.max(0, (x + width * 0.5) / width));
    uvArr[i * 2 + 1] = Math.min(1, Math.max(0, (y + height * 0.5) / height));
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
  return prepGeo(geo);
}

// ---------------------------------------------------------------------------
// 1. Thomas Crapper `Downham` Surface Basin (`TCDO400WH`, 425 × 330 × 180 mm)
// ---------------------------------------------------------------------------

/**
 * Builds the official CAD-accurate 3D model of the **Thomas Crapper `Downham` Surface Basin**
 * (`TCDO400`, `425 mm` W × `330 mm` D × `180 mm` H, 0 tap holes):
 * - Rectangular rounded-corner fireclay body (`~396 × 301 mm` base -> `404 × 309 mm` upper walls)
 *   crowned by the overhanging **`35 mm` wide × `25 mm` tall heritage collar rim** (`425 × 330 mm` overall),
 * - Deep glazed **`355 × 260 mm` internal bowl** with **integral rear-centre weir overflow** (`64 mm` wide lobe + slot),
 * - Front embossed **`310 × 123 mm` scalloped-corner `THOMAS CRAPPER` plaque** with twin raised faux screw bosses,
 * - **Slotted `1 1/4"` BSP waste** (`Ø63 mm` flange + click-clack mushroom dome plug) at `x = 0, z = 0.105` (`105 mm` from rear).
 *
 * Local coordinates:
 * - `x ∈ [-widthM/2, +widthM/2]`, `y ∈ [0, heightM]` (`y = 0` sits on countertop), `z ∈ [0, depthM]` (`z = 0` rear collar face, `z = depthM` front collar face).
 */
export function buildThomasCrapperDownhamBasin(
  opts: ThomasCrapperDownhamBasinOptions
): THREE.Group {
  const p = opts.namePrefix;
  const W = opts.widthM ?? 0.425; // 425 mm exact CAD width
  const D = opts.depthM ?? 0.330; // 330 mm exact CAD depth
  const H = opts.heightM ?? 0.180; // 180 mm exact CAD height
  const ceramicMat = getCeramicMaterial(opts.ceramicFinish ?? 'white');
  const plaqueMat = getDownhamPlaqueMaterial(opts.ceramicFinish ?? 'white');
  const brassMats = getBathroomBrassMaterials(opts.finish);
  const wasteMats = opts.wasteFinish ? getBathroomBrassMaterials(opts.wasteFinish) : brassMats;

  const group = new THREE.Group();
  group.name = p;

  const cz = D * 0.5; // 0.165 m bowl centre Z
  const collarOverhang = 0.0105; // 10.5 mm overhang beyond 404 x 309 mm upper body
  const rimWidth = 0.035; // 35 mm wide top rim ledge -> 355 x 260 mm inner bowl
  const hwCollar = W * 0.5; // 0.2125 m
  const hdCollar = D * 0.5; // 0.1650 m
  const hwUpper = hwCollar - collarOverhang; // 0.2020 m (404 mm)
  const hdUpper = hdCollar - collarOverhang; // 0.1545 m (309 mm)
  const hwBase = hwUpper - 0.004; // 0.1980 m (396 mm, ~1.5° fireclay draft)
  const hdBase = hdUpper - 0.004; // 0.1505 m (301 mm)
  const hwInnerTop = hwCollar - rimWidth; // 0.1775 m (355 mm)
  const hdInnerTop = hdCollar - rimWidth; // 0.1300 m (260 mm)

  const collarBottomY = H - 0.025; // 0.155 m (25 mm tall collar)
  const bowlFloorY = 0.024;

  // Hollow lofted fireclay shell (bottom contact -> drafted body -> overhanging collar -> top rim -> inner bowl)
  const shellRings: Array<[number, number, number, number, number]> = [
    [hwBase - 0.006, hdBase - 0.006, 0.018, 0.0, cz],
    [hwBase, hdBase, 0.020, 0.006, cz],
    [hwUpper, hdUpper, 0.022, collarBottomY - 0.003, cz],
    [hwUpper + 0.004, hdUpper + 0.004, 0.023, collarBottomY, cz],
    [hwCollar, hdCollar, 0.024, collarBottomY + 0.004, cz],
    [hwCollar, hdCollar, 0.024, H - 0.0035, cz],
    [hwCollar - 0.003, hdCollar - 0.003, 0.022, H, cz],
    [hwInnerTop + 0.003, hdInnerTop + 0.003, 0.018, H, cz],
    [hwInnerTop, hdInnerTop, 0.017, H - 0.004, cz],
    [hwInnerTop - 0.008, hdInnerTop - 0.008, 0.020, 0.052, cz],
    [hwInnerTop - 0.020, hdInnerTop - 0.018, 0.024, bowlFloorY + 0.008, cz],
    [0.033, 0.033, 0.032, bowlFloorY, 0.105],
  ];
  const basinBody = new THREE.Mesh(
    buildLoftedRoundedRectShellGeometry(shellRings, 10, true),
    ceramicMat
  );
  basinBody.name = `${p}.fireclayBody`;
  group.add(basinBody);

  // Integral rear-centre weir overflow lobe (64 mm wide sculpted glazed projection on rear inner wall)
  const weirHeight = H - bowlFloorY - 0.002;
  const weirShape = new THREE.Shape();
  weirShape.moveTo(-0.032, 0);
  weirShape.lineTo(0.032, 0);
  weirShape.quadraticCurveTo(0.032, -0.028, 0.016, -0.031);
  weirShape.lineTo(-0.016, -0.031);
  weirShape.quadraticCurveTo(-0.032, -0.028, -0.032, 0);
  weirShape.closePath();

  const weirRawGeo = new THREE.ExtrudeGeometry(weirShape, {
    depth: weirHeight,
    bevelEnabled: true,
    bevelThickness: 0.0025,
    bevelSize: 0.0025,
    bevelSegments: 2,
    curveSegments: 14,
  });
  weirRawGeo.rotateX(-Math.PI * 0.5);
  const weirLobe = new THREE.Mesh(prepGeo(weirRawGeo), ceramicMat);
  weirLobe.name = `${p}.weirOverflowLobe`;
  weirLobe.position.set(0, bowlFloorY + 0.001, rimWidth - 0.002);
  group.add(weirLobe);

  // Recessed dark weir overflow pill slot at top of rear weir lobe
  const weirSlot = new THREE.Mesh(
    prepGeo(new THREE.CapsuleGeometry(0.0045, 0.024, 6, 14)),
    brassMats.darkShadow
  );
  weirSlot.name = `${p}.weirOverflowSlot`;
  weirSlot.rotation.z = Math.PI * 0.5;
  weirSlot.scale.set(1, 1, 0.55);
  weirSlot.position.set(0, H - 0.004, rimWidth + 0.014);
  group.add(weirSlot);

  // Front embossed scalloped-corner plaque (`310 mm` W × `123 mm` H) + twin Ø9mm faux screw bosses
  const frontBodyZ = cz + hdUpper - 0.0015; // ~0.318 m
  const plaqueCenterY = 0.080;
  const plaqueMesh = new THREE.Mesh(
    createScallopedPlaqueGeometry(0.310, 0.123, 0.020, 0.0026, 0.0016),
    plaqueMat
  );
  plaqueMesh.name = `${p}.embossedFrontPlaque`;
  plaqueMesh.position.set(0, plaqueCenterY, frontBodyZ);
  group.add(plaqueMesh);

  const bossGeo = prepGeo(
    new THREE.SphereGeometry(0.0046, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5)
  );
  bossGeo.rotateX(Math.PI * 0.5);
  for (const [sideTag, sx] of [
    ['left', -0.130],
    ['right', 0.130],
  ] as const) {
    const boss = new THREE.Mesh(bossGeo, ceramicMat);
    boss.name = `${p}.plaqueScrewBoss.${sideTag}`;
    boss.position.set(sx, plaqueCenterY, frontBodyZ + 0.003);
    group.add(boss);
  }

  // Slotted Polished Brass waste (`TCWPUWPB` / `6800BR`, Ø63mm flange + click-clack dome plug at z = 0.105 m)
  const wasteZ = 0.105; // 105 mm forward of rear outer collar face per official CAD plan
  const wasteFlange = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0315, 0.023, 0.004, 28)),
    wasteMats.primary
  );
  wasteFlange.name = `${p}.slottedWasteFlange`;
  wasteFlange.position.set(0, bowlFloorY + 0.0015, wasteZ);
  group.add(wasteFlange);

  const wasteThroat = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.021, 0.021, 0.003, 24)),
    wasteMats.darkShadow
  );
  wasteThroat.name = `${p}.wasteThroat`;
  wasteThroat.position.set(0, bowlFloorY + 0.0025, wasteZ);
  group.add(wasteThroat);

  const clickClackDome = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0195, 0.0205, 0.0045, 28)),
    wasteMats.primary
  );
  clickClackDome.name = `${p}.wastePlug`;
  clickClackDome.position.set(0, bowlFloorY + 0.0055, wasteZ);
  group.add(clickClackDome);

  const holeCount: 0 | 1 | 3 =
    opts.tap && typeof opts.tap === 'object' && !isCustomTapObject3D(opts.tap)
      ? opts.tap.mount === 'monobloc-deck'
        ? 1
        : opts.tap.mount === '3-hole-deck'
          ? 3
          : 0
      : 0;
  registerTapMountAnchor(group, {
    deckPosition: [0, H + 0.0005, 0.018],
    wallPosition: [0, H + 0.095, 0],
    wastePosition: [0, bowlFloorY, wasteZ],
    holeCount,
    rotationY: 0,
  });

  if (opts.tap !== undefined && opts.tap !== 'none') {
    if (opts.tap === 'default') {
      const defaultTap = buildBasinTapFromSpec(
        { collection: 'armstrong', mount: '2-hole-wall', finish: opts.finish },
        opts.finish,
        '2-hole-wall',
        `${p}.wallBasinTap`
      );
      mountTapOnFixture(group, defaultTap, 'wall');
    } else if (isCustomTapObject3D(opts.tap)) {
      mountTapOnFixture(group, opts.tap);
    } else {
      const tapSpec = opts.tap;
      const resolvedMount = tapSpec.mount ?? '2-hole-wall';
      const tapObj = buildBasinTapFromSpec(
        tapSpec,
        opts.finish,
        resolvedMount,
        `${p}.basinTap`
      );
      mountTapOnFixture(group, tapObj, resolvedMount === '2-hole-wall' ? 'wall' : 'deck');
    }
  }

  const fCode = resolveBrasswareCode(opts.finish, 'BR');
  return attachAssetMetadata(finalizeSanitaryGroup(group, 'sanitary'), {
    name: 'Thomas Crapper Downham Cloakroom Fireclay Basin',
    brand: 'Thomas Crapper & Co.',
    collection: '1861 Heritage',
    sku: `TCDOW365-${fCode}`,
    finish: `Fine Fireclay / ${formatBrasswareFinishLabel(opts.finish, 'BR')}`,
    category: 'sanitaryware',
    dimensionsMm: [365, 275, 235],
    productUrl: 'https://www.thomascrapper.com/products/basins/downham-cloakroom-basin/',
    schematicUrl: 'https://www.thomascrapper.com/downloads/spec-sheets/TCDOW365-CAD.pdf',
  });
}

// ---------------------------------------------------------------------------
// 2. Thomas Crapper Low-Level Ceramic Cistern WC Set (`TCWC3CERLL`)
// ---------------------------------------------------------------------------

/**
 * Builds the cast pierced `TC` monogram medium cistern bracket (`TC200MEDPB`, `190 mm` H × `158 mm` D).
 */
function createPiercedTcBracketGeometry(): THREE.BufferGeometry {
  const H = 0.190; // 190 mm wall leg
  const D = 0.158; // 158 mm horizontal support arm
  const webT = 0.016; // 16 mm cast solid brass web

  // 2D profile in (Z, Y) plane -> rotateY(-PI/2) after extrusion so z ∈ [0..D], y ∈ [0..H]
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0.018, 0);
  // Sweeping S-scroll front brace up to horizontal top arm tip (D, H)
  shape.bezierCurveTo(0.024, 0.048, 0.056, 0.082, 0.092, 0.118);
  shape.bezierCurveTo(0.118, 0.144, 0.140, 0.168, D, H - 0.016);
  shape.lineTo(D, H);
  shape.lineTo(0, H);
  shape.closePath();

  // Upper rear spandrel cutout (pierced scroll window leaving central Ø58mm medallion solid)
  const upperHole = new THREE.Path();
  upperHole.absarc(0.042, 0.138, 0.018, 0, Math.PI * 2, true);
  shape.holes.push(upperHole);

  // Lower spandrel trefoil cutout
  const lowerHole = new THREE.Path();
  lowerHole.absarc(0.024, 0.072, 0.011, 0, Math.PI * 2, true);
  shape.holes.push(lowerHole);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: webT,
    bevelEnabled: true,
    bevelThickness: 0.0018,
    bevelSize: 0.0018,
    bevelSegments: 2,
    curveSegments: 18,
  });
  geo.translate(0, 0, -webT * 0.5);
  geo.rotateY(Math.PI * 0.5);
  // After rotateY(+90°): old +X -> -Z, so mirror Z -> +Z
  geo.scale(1, 1, -1);
  // Flip winding after negative Z scale
  const idx = geo.index;
  if (idx) {
    const arr = idx.array as Uint16Array | Uint32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const tmp = arr[i + 1]!;
      arr[i + 1] = arr[i + 2]!;
      arr[i + 2] = tmp;
    }
  }
  return prepGeo(geo);
}

/**
 * Cross-section slice for the lofted *Venerable* (`TCVE101`) vitreous-china WC pan:
 * - `y`: elevation above finished floor (`0.000 .. 0.405 m`),
 * - `zRear`, `zFront`: rear & front Z bounds in pan-local coordinates (`0.000` = rear spigot datum, `0.462` = front rim nose),
 * - `hwFront`: half-width across the rounded front D-column / oval front bowl,
 * - `hwRear`: half-width across the side floor-bolt shelves / integral trap shroud / rear seat-bolt deck,
 * - `earBulge`: optional (`0..1`) rear seat-bolt lug ear flare at `x = ±81 mm` (`162 mm` CAD centres),
 * - `keyholePinch`: optional (`0..1`) subtle Victorian waist transition between front D-column & rear trap shroud.
 */
interface VenerablePanSlice {
  readonly y: number;
  readonly zRear: number;
  readonly zFront: number;
  readonly hwFront: number;
  readonly hwRear: number;
  readonly earBulge?: number;
  readonly keyholePinch?: number;
}

/**
 * Evaluates a smooth, twist-free 2D plan point `(x, z)` at strict radial angle `theta ∈ [0, 2π]`
 * (`theta = π/2` -> front `+Z`; `theta = -π/2` / `3π/2` -> rear `-Z`; `theta = 0` -> right `+X`).
 */
function sampleVenerableSlicePoint(
  theta: number,
  slice: VenerablePanSlice
): readonly [number, number] {
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta); // +1 = front (+Z), -1 = rear (-Z)

  const zMid = (slice.zRear + slice.zFront) * 0.5;
  const zHalf = (slice.zFront - slice.zRear) * 0.5;

  // Full oval width `hwFront` across mid-belly & front (`sinT >= -0.05`, giving exact `2 * hwFront = 370 mm`
  // CAD bowl width at `theta = 0/π`), tapering smoothly into `hwRear` toward the rear deck/heel (`sinT < -0.05`).
  const rearTaper = sinT >= -0.05 ? 0 : Math.pow((-sinT - 0.05) / 0.95, 1.35);
  let hw = slice.hwFront - (slice.hwFront - slice.hwRear) * rearTaper;

  // Subtle Victorian waist indentation along the mid-side junction between front D-column & rear trap shroud
  if (slice.keyholePinch && slice.keyholePinch > 0) {
    const midSide = Math.exp(-Math.pow((sinT + 0.08) / 0.42, 2));
    hw *= 1 - slice.keyholePinch * midSide;
  }

  // Flatten the rear heel / trap-shroud back wall slightly for crisp Victorian ceramic definition
  const rearFlatten = sinT < -0.72 ? Math.pow((-sinT - 0.72) / 0.28, 1.6) * 0.008 : 0;
  let z = zMid + sinT * zHalf + rearFlatten;
  let x = cosT * hw;

  // Integral rear seat-bolt lug ears (`162 mm` centres = `±81 mm`, `12 mm` from rear per `03_Venerable_WC_Pan` plan CAD)
  if (slice.earBulge && slice.earBulge > 0 && sinT < -0.45) {
    const earWindow = Math.exp(-Math.pow((Math.abs(cosT) - 0.56) / 0.19, 2)) *
      Math.pow(Math.min(1, (-sinT - 0.45) / 0.45), 1.15);
    z -= slice.earBulge * 0.020 * earWindow;
    x += Math.sign(cosT) * slice.earBulge * 0.010 * earWindow;
  }

  return [x, z];
}

/**
 * Builds the official CAD-accurate **Thomas Crapper *Venerable* WC Pan (`TCVE101WH`)**
 * (`370 mm` W × `462 mm` D overall / `450 mm` rim × `405 mm` rim H):
 * - Elongated Victorian keyhole/pear floor flange (`y = 0..46 mm`, `0.0 mm` flush on finished floor)
 *   with stepped double-ogee / torus-and-cove skirt and flat side floor-bolt shelves,
 * - Proud vertical-fronted oval Victorian D-column pedestal (`zFront ≈ 0.387 m` from `y = 48..222 mm`
 *   per `03_Venerable_WC_Pan` side elevation) flowing seamlessly into the integral rear P-trap shroud,
 * - Crisp rounded under-bowl throat/chin flaring into the full `370 mm` oval washdown bowl,
 * - Signature double-beaded horizontal Victorian torus moulding, rolled top rim (`y = 405 mm`),
 *   `162 mm`-centres rear seat-bolt lug ears, and true hollow glazed interior basin.
 * - Strict outward triangle winding (`(a, d, b), (b, d, c)`) + closed floor & throat caps.
 */
function createVenerablePanGeometry(): THREE.BufferGeometry {
  const outerSlices: ReadonlyArray<VenerablePanSlice> = [
    // Elongated Victorian keyhole floor flange & stepped torus-cove base skirt (`y = 0..48 mm`)
    { y: 0.000, zRear: 0.082, zFront: 0.408, hwFront: 0.113, hwRear: 0.098, keyholePinch: 0.04 },
    { y: 0.011, zRear: 0.082, zFront: 0.408, hwFront: 0.113, hwRear: 0.098, keyholePinch: 0.04 },
    { y: 0.018, zRear: 0.085, zFront: 0.405, hwFront: 0.110, hwRear: 0.096, keyholePinch: 0.04 }, // Lower torus roll
    { y: 0.026, zRear: 0.091, zFront: 0.398, hwFront: 0.103, hwRear: 0.090, keyholePinch: 0.05 }, // Concave scotia cove
    { y: 0.034, zRear: 0.088, zFront: 0.396, hwFront: 0.101, hwRear: 0.089, keyholePinch: 0.05 }, // Flat side bolt-shelf & upper torus bead
    { y: 0.042, zRear: 0.082, zFront: 0.390, hwFront: 0.092, hwRear: 0.081, keyholePinch: 0.06 }, // Stepped neck fillet
    { y: 0.052, zRear: 0.074, zFront: 0.387, hwFront: 0.087, hwRear: 0.076, keyholePinch: 0.07 }, // Base of vertical D-column

    // Vertical-fronted Victorian D-column & integral rear P-trap ceramic shroud (`y = 52..222 mm`)
    { y: 0.095, zRear: 0.062, zFront: 0.3865, hwFront: 0.085, hwRear: 0.074, keyholePinch: 0.08 },
    { y: 0.145, zRear: 0.046, zFront: 0.386,  hwFront: 0.084, hwRear: 0.074, keyholePinch: 0.07 },
    { y: 0.190, zRear: 0.040, zFront: 0.3865, hwFront: 0.086, hwRear: 0.076, keyholePinch: 0.06 }, // Rear P-trap outlet C/L (`190 mm`)
    { y: 0.218, zRear: 0.048, zFront: 0.3875, hwFront: 0.090, hwRear: 0.078, keyholePinch: 0.04 },

    // Crisp under-bowl chin/throat (`y = 224..245 mm`) flaring into full oval washdown bowl
    { y: 0.230, zRear: 0.054, zFront: 0.396, hwFront: 0.104, hwRear: 0.084, keyholePinch: 0.02 },
    { y: 0.246, zRear: 0.056, zFront: 0.412, hwFront: 0.126, hwRear: 0.094 },
    { y: 0.275, zRear: 0.052, zFront: 0.429, hwFront: 0.152, hwRear: 0.110 },
    { y: 0.312, zRear: 0.044, zFront: 0.442, hwFront: 0.171, hwRear: 0.124 },
    { y: 0.345, zRear: 0.036, zFront: 0.448, hwFront: 0.177, hwRear: 0.131, earBulge: 0.25 }, // Flush inlet C/L (`345 mm`)
    { y: 0.362, zRear: 0.030, zFront: 0.449, hwFront: 0.178, hwRear: 0.134, earBulge: 0.45 },

    // Signature double-beaded Victorian horizontal torus moulding & rolled `405 mm` rim
    { y: 0.371, zRear: 0.026, zFront: 0.455, hwFront: 0.182, hwRear: 0.137, earBulge: 0.70 }, // Lower torus bead
    { y: 0.378, zRear: 0.026, zFront: 0.454, hwFront: 0.181, hwRear: 0.137, earBulge: 0.80 },
    { y: 0.384, zRear: 0.025, zFront: 0.450, hwFront: 0.179, hwRear: 0.136, earBulge: 0.90 }, // Inter-bead shadow cove
    { y: 0.394, zRear: 0.022, zFront: 0.460, hwFront: 0.1845, hwRear: 0.139, earBulge: 1.00 },
    { y: 0.399, zRear: 0.020, zFront: 0.462, hwFront: 0.185, hwRear: 0.140, earBulge: 1.00 }, // Upper rolled torus (`370 mm` W × `462 mm` D!)
    { y: 0.405, zRear: 0.022, zFront: 0.457, hwFront: 0.181, hwRear: 0.138, earBulge: 1.00 }, // Top rolled rim seat plane (`405 mm` H!)
  ];

  // Continue seamlessly over the rolled inner lip into the hollow glazed washdown basin
  const innerSlices: ReadonlyArray<VenerablePanSlice> = [
    { y: 0.405, zRear: 0.118, zFront: 0.422, hwFront: 0.145, hwRear: 0.118 }, // Inner rolled rim crown
    { y: 0.397, zRear: 0.122, zFront: 0.425, hwFront: 0.148, hwRear: 0.120 }, // Flushing rim overhang lip
    { y: 0.382, zRear: 0.126, zFront: 0.418, hwFront: 0.141, hwRear: 0.115 }, // Flushing rim undercut
    { y: 0.315, zRear: 0.136, zFront: 0.394, hwFront: 0.124, hwRear: 0.102 }, // Upper glazed funnel
    { y: 0.235, zRear: 0.148, zFront: 0.344, hwFront: 0.088, hwRear: 0.076 }, // Lower washdown bowl
    { y: 0.175, zRear: 0.158, zFront: 0.292, hwFront: 0.058, hwRear: 0.054 }, // Standing water-seal throat
  ];

  const allSlices = [...outerSlices, ...innerSlices];
  const segs = 48;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let si = 0; si < allSlices.length; si++) {
    const slice = allSlices[si]!;
    const v = si / (allSlices.length - 1);
    for (let ai = 0; ai <= segs; ai++) {
      const theta = (ai / segs) * Math.PI * 2;
      const [x, z] = sampleVenerableSlicePoint(theta, slice);
      positions.push(x, slice.y, z);
      uvs.push(ai / segs, v);
    }
  }

  // Outward-facing CCW triangle winding: `(d - a) × (b - a)` points radially outward on outer shell,
  // `+Y` across top rim, and inward/upward into the hollow glazed bowl cavity on inner shell.
  const stride = segs + 1;
  for (let si = 0; si < allSlices.length - 1; si++) {
    const r0 = si * stride;
    const r1 = (si + 1) * stride;
    for (let ai = 0; ai < segs; ai++) {
      const a = r0 + ai;
      const b = r0 + ai + 1;
      const c = r1 + ai + 1;
      const d = r1 + ai;
      indices.push(a, d, b, b, d, c);
    }
  }

  // Watertight bottom floor cap (`y = 0.000`, normal `-Y`)
  const footCenterIdx = positions.length / 3;
  const footMidZ = (outerSlices[0]!.zRear + outerSlices[0]!.zFront) * 0.5;
  positions.push(0, 0.000, footMidZ);
  uvs.push(0.5, 0.0);
  for (let ai = 0; ai < segs; ai++) {
    indices.push(footCenterIdx, ai, ai + 1);
  }

  // Watertight trap throat bottom cap (`y = 0.172`, normal `+Y`)
  const lastRingStart = (allSlices.length - 1) * stride;
  const throatCenterIdx = positions.length / 3;
  const throatMidZ = (innerSlices[innerSlices.length - 1]!.zRear + innerSlices[innerSlices.length - 1]!.zFront) * 0.5;
  positions.push(0, 0.172, throatMidZ);
  uvs.push(0.5, 1.0);
  for (let ai = 0; ai < segs; ai++) {
    indices.push(throatCenterIdx, lastRingStart + ai + 1, lastRingStart + ai);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return prepGeo(geo);
}

/**
 * Builds a seamless revolved ceramic P-trap horizontal outlet boss & Straight Ceramic Pan Connector
 * (`TC101526WH`): wide bell root fillet blending organically into the rear ceramic trap shroud,
 * rolled socket bead around `z = 0`, and glazed `Ø108 mm` connector barrel entering the rear soil boxing.
 */
function createSeamlessSoilOutletGeometry(connectorTailLenM: number): THREE.BufferGeometry {
  // Lathe profile `(radius, yAlongAxis)` -> after `rotateX(+PI/2)`, `yAlongAxis` maps to `+Z`.
  // Both ends close cleanly to `r = 0` (rear end inside soil boxing, front end buried `135 mm`
  // deep inside the solid ceramic trap shroud) so zero open rim can ever protrude past the curved shroud sides.
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.000, -connectorTailLenM),
    new THREE.Vector2(0.052, -connectorTailLenM),
    new THREE.Vector2(0.053, -0.018),
    new THREE.Vector2(0.061, -0.014), // Rolled ceramic pan-connector socket collar (`TC101526WH`)
    new THREE.Vector2(0.062, -0.003),
    new THREE.Vector2(0.056, 0.004),
    new THREE.Vector2(0.052, 0.010),  // Pan `Ø102-104 mm` P-trap horizontal outlet spigot
    new THREE.Vector2(0.054, 0.044),  // Enters rear of ceramic trap shroud (`zRear = 0.040 m` at `y = 0.190 m`)
    new THREE.Vector2(0.056, 0.072),
    new THREE.Vector2(0.050, 0.125),
    new THREE.Vector2(0.000, 0.132),
  ];
  const geo = new THREE.LatheGeometry(pts, 32);
  geo.rotateX(Math.PI * 0.5);
  return prepGeo(geo);
}

/**
 * Builds the 1895 Oval Solid Wood Seat Ring (`TC100O`, `387 mm` W × `407 mm` L,
 * `222 mm` W × `253 mm` L aperture) or matching Moulded Solid Wood Lid.
 */
function createOvalWoodSeatOrLidGeometry(isLid: boolean): THREE.BufferGeometry {
  const outerHW = 0.387 * 0.5; // 193.5 mm -> 387 mm exact CAD width
  const outerHL = 0.407 * 0.5; // 203.5 mm -> 407 mm exact CAD oval length
  const thickness = isLid ? 0.018 : 0.017;
  const bevel = 0.0045;

  const shape = new THREE.Shape();
  shape.absellipse(0, 0, outerHW - bevel, outerHL - bevel, 0, Math.PI * 2, false, 0);

  if (!isLid) {
    const innerHW = 0.222 * 0.5 + bevel * 0.5; // 222 mm CAD aperture width
    const innerHL = 0.253 * 0.5 + bevel * 0.5; // 253 mm CAD aperture length
    const hole = new THREE.Path();
    hole.absellipse(0, -0.006, innerHW, innerHL, 0, Math.PI * 2, true, 0);
    shape.holes.push(hole);
  }

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 32,
  });
  geo.rotateX(-Math.PI * 0.5);
  geo.translate(0, bevel, 0);

  // Align wood-grain UVs cleanly along length (+Z) and width (X)
  const pos = geo.attributes.position!;
  const uvArr = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uvArr[i * 2] = pos.getX(i) * 2.2 + 0.5;
    uvArr[i * 2 + 1] = pos.getZ(i) * 2.2 + 0.5;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
  return prepGeo(geo);
}

/**
 * Builds the official CAD-accurate 3D model of the **Thomas Crapper Low-Level Ceramic Cistern WC Set**
 * (`TCVE101` Venerable Pan + `TCMB201LL` Embossed Low-Level Ceramic Cistern + `TC200MED` Pierced `TC`
 * Cast Brass Wall Brackets + `TCWPLLFP` `Ø38 mm` Flush Pipe + `TC100O` 1895 Oval Solid Wood Seat & Lid w/ Full Bar Hinge):
 * - Rear wall-to-pan setback: `180 mm` (`01_Dim-098` spec `170–290 mm`, natively clearing Room 7's `172 mm` low soil boxing),
 * - Installed cistern top height: `1,045 mm` (`970–1,120 mm` CAD range), cistern `480 × 240 × 320 mm` (`445 mm` body W, `533 mm` w/ lever),
 * - Pan rim height: `405 mm` (`458 mm` closed seat height), overall projection: `715 mm` (`710–720 mm` CAD suggested).
 */
export function buildThomasCrapperLowLevelWc(
  opts: ThomasCrapperLowLevelWcOptions
): THREE.Group {
  const p = opts.namePrefix;
  const ceramicFinish = opts.ceramicFinish ?? 'white';
  const ceramicMat = getCeramicMaterial(ceramicFinish);
  const cartoucheMat = getCisternCartoucheMaterial(ceramicFinish);
  const brassMats = getBathroomBrassMaterials(opts.finish);
  const woodMat = getWcSeatMaterial(opts.seatFinish ?? 'darkOak');
  const waterMat = getWcWaterSealMaterial();

  // Per `01_Dim-098` (`710-720 mm` suggested projection; `170-290 mm` low-level rear setback):
  // `246 mm` rear-to-spigot datum places the `462 mm` Venerable pan front rim at `708 mm`
  // (aligned cleanly under the `715 mm` 1895 Oval Wood Seat) and keeps the floor flange
  // `156 mm` clear in front of Room 7's `172 mm` low soil pipe boxing!
  const panRearZ = opts.panRearSetbackM ?? 0.246;
  const cisternTopY = opts.cisternTopYM ?? 1.045; // 1,045 mm FFL to lid top
  const cisternBodyBottomY = cisternTopY - 0.320; // 725 mm (320 mm total cistern height)
  const lidBottomY = cisternTopY - 0.047; // 998 mm (47 mm stepped ogee lid + cornice)
  const syphonZ = 0.120; // 120 mm from wall per 04_Low_Level_Ceramic_Cistern CAD
  const flushInletY = 0.345; // 345 mm flush inlet C/L per 01_Dim-098 & 03_Venerable_WC_Pan
  const soilOutletY = 0.190; // 190 mm soil outlet C/L per 01_Dim-098 & 03_Venerable_WC_Pan
  const panRimY = 0.405; // 405 mm exact Venerable pan height

  const group = new THREE.Group();
  group.name = p;

  // --- 1. Venerable Horizontal-Outlet WC Pan (`TCVE101WH`, W370 × D462 × H405 mm) ---
  const panGroup = new THREE.Group();
  panGroup.name = `${p}.venerablePan`;
  panGroup.position.set(0, 0, panRearZ);
  group.add(panGroup);

  const panMesh = new THREE.Mesh(createVenerablePanGeometry(), ceramicMat);
  panMesh.name = `${p}.venerablePan.ceramicBody`;
  panGroup.add(panMesh);

  // Water seal plane inside trap throat (`y = 0.196`)
  const waterGeo = new THREE.CircleGeometry(0.068, 28);
  waterGeo.rotateX(-Math.PI * 0.5);
  waterGeo.scale(0.96, 1, 1.16);
  const waterSeal = new THREE.Mesh(prepGeo(waterGeo), waterMat);
  waterSeal.name = `${p}.venerablePan.waterSeal`;
  waterSeal.position.set(0, 0.196, 0.228);
  panGroup.add(waterSeal);

  // Authentic Victorian floor-fixing dome screws & washers on the flat side bolt shelves (`y = 34 mm`)
  const screwWasherGeo = prepGeo(new THREE.CylinderGeometry(0.0068, 0.0078, 0.0022, 16));
  const screwDomeGeo = prepGeo(
    new THREE.SphereGeometry(0.0052, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5)
  );
  for (const [tag, sx, sz] of [
    ['left', -0.096, 0.292],
    ['right', 0.096, 0.292],
    ['rearLeft', -0.088, 0.148],
    ['rearRight', 0.088, 0.148],
  ] as const) {
    const screwGrp = new THREE.Group();
    screwGrp.name = `${p}.venerablePan.floorScrew.${tag}`;
    screwGrp.position.set(sx, 0.034, sz);
    const washer = new THREE.Mesh(screwWasherGeo, brassMats.primary);
    washer.name = `${p}.venerablePan.floorScrew.${tag}.washer`;
    washer.position.y = 0.001;
    screwGrp.add(washer);
    const dome = new THREE.Mesh(screwDomeGeo, brassMats.primary);
    dome.name = `${p}.venerablePan.floorScrew.${tag}.dome`;
    dome.position.y = 0.002;
    screwGrp.add(dome);
    panGroup.add(screwGrp);
  }

  // Seamless flared ceramic P-trap outlet boss & Straight Ceramic Pan Connector (`TC101526WH`)
  // extending cleanly into Room 7's `156-172 mm` low soil pipe boxing (`min z >= 0.08 m` standalone)
  const connectorTailLen = Math.max(0.045, Math.min(0.105, panRearZ - 0.142));
  const soilSpigot = new THREE.Mesh(
    createSeamlessSoilOutletGeometry(connectorTailLen),
    ceramicMat
  );
  soilSpigot.name = `${p}.venerablePan.soilSpigot`;
  soilSpigot.position.set(0, soilOutletY, 0);
  panGroup.add(soilSpigot);

  // Glazed ceramic wall/boxing entry escutcheon collar seated flush against the `156 mm` horizontal soil boxing
  const collarLocalZ = -(panRearZ - 0.161);
  const soilCollar = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.064, 0.067, 0.018, 28)),
    ceramicMat
  );
  soilCollar.name = `${p}.venerablePan.soilConnectorCollar`;
  soilCollar.rotation.x = Math.PI * 0.5;
  soilCollar.position.set(0, soilOutletY, Math.min(-0.008, collarLocalZ));
  panGroup.add(soilCollar);

  // Flared integral rear ceramic flush-inlet boss at `y = 0.345` C/L (closed deeply inside upper rear bowl)
  const flushHornPts: THREE.Vector2[] = [
    new THREE.Vector2(0.000, 0.010),
    new THREE.Vector2(0.027, 0.010),
    new THREE.Vector2(0.032, 0.016),
    new THREE.Vector2(0.030, 0.028),
    new THREE.Vector2(0.035, 0.046),
    new THREE.Vector2(0.032, 0.092),
    new THREE.Vector2(0.000, 0.098),
  ];
  const flushHornGeo = new THREE.LatheGeometry(flushHornPts, 24);
  flushHornGeo.rotateX(Math.PI * 0.5);
  const flushHorn = new THREE.Mesh(prepGeo(flushHornGeo), ceramicMat);
  flushHorn.name = `${p}.venerablePan.flushHorn`;
  flushHorn.position.set(0, flushInletY, 0);
  panGroup.add(flushHorn);

  // --- 2. Embossed Low-Level Ceramic Cistern (`TCMB201LL`, W480/445 × D240/216 × H320 mm) ---
  const cisternGroup = new THREE.Group();
  cisternGroup.name = `${p}.lowLevelCistern`;
  group.add(cisternGroup);

  // Tapered ceramic cistern tank (`424 × 204 mm` rounded bottom -> `445 × 216 mm` below cornice, flat against `z = 0` wall)
  const cisternBodyRings: Array<[number, number, number, number, number]> = [
    [0.196, 0.088, 0.022, cisternBodyBottomY, 0.098],
    [0.212, 0.101, 0.024, cisternBodyBottomY + 0.014, 0.101],
    [0.2225, 0.108, 0.024, lidBottomY - 0.012, 0.108],
    [0.226, 0.111, 0.024, lidBottomY, 0.111],
  ];
  const cisternTank = new THREE.Mesh(
    buildLoftedRoundedRectShellGeometry(cisternBodyRings, 8, true),
    ceramicMat
  );
  cisternTank.name = `${p}.lowLevelCistern.body`;
  cisternGroup.add(cisternTank);

  // Stepped ogee ceramic cistern lid (`480 × 240 × 47 mm`, `y = lidBottomY .. cisternTopY`)
  const cisternLidRings: Array<[number, number, number, number, number]> = [
    [0.232, 0.115, 0.024, lidBottomY, 0.115],
    [0.240, 0.120, 0.025, lidBottomY + 0.010, 0.120], // 480 x 240 mm overhanging cornice lip!
    [0.240, 0.120, 0.025, lidBottomY + 0.022, 0.120],
    [0.226, 0.112, 0.024, lidBottomY + 0.032, 0.112], // Ogee step inward
    [0.216, 0.105, 0.022, cisternTopY - 0.004, 0.105],
    [0.195, 0.092, 0.020, cisternTopY, 0.095],
    [0.020, 0.015, 0.010, cisternTopY + 0.001, 0.095],
  ];
  const cisternLid = new THREE.Mesh(
    buildLoftedRoundedRectShellGeometry(cisternLidRings, 8, false),
    ceramicMat
  );
  cisternLid.name = `${p}.lowLevelCistern.lid`;
  cisternGroup.add(cisternLid);

  // Front scalloped-corner moulded ceramic panel & oval *Thomas Crapper & Co. Ltd* heritage plaque
  const cisternFrontZ = 0.211;
  const cisternMidY = (cisternBodyBottomY + lidBottomY) * 0.5;
  const frontPanelFrame = new THREE.Mesh(
    createScallopedPlaqueGeometry(0.320, 0.165, 0.022, 0.0022, 0.0015),
    ceramicMat
  );
  frontPanelFrame.name = `${p}.lowLevelCistern.frontPanelMoulding`;
  frontPanelFrame.position.set(0, cisternMidY, cisternFrontZ);
  cisternGroup.add(frontPanelFrame);

  // Oval underglaze *THOMAS CRAPPER & Co. Ltd* cartouche (`92 mm` W × `58 mm` H)
  const badgeShape = new THREE.Shape();
  badgeShape.absellipse(0, 0, 0.046, 0.029, 0, Math.PI * 2, false, 0);
  const badgeGeo = new THREE.ExtrudeGeometry(badgeShape, {
    depth: 0.0018,
    bevelEnabled: true,
    bevelThickness: 0.001,
    bevelSize: 0.001,
    bevelSegments: 2,
    curveSegments: 28,
  });
  const bPos = badgeGeo.attributes.position!;
  const bUv = new Float32Array(bPos.count * 2);
  for (let i = 0; i < bPos.count; i++) {
    bUv[i * 2] = Math.min(1, Math.max(0, (bPos.getX(i) + 0.047) / 0.094));
    bUv[i * 2 + 1] = Math.min(1, Math.max(0, (bPos.getY(i) + 0.030) / 0.060));
  }
  badgeGeo.setAttribute('uv', new THREE.BufferAttribute(bUv, 2));
  const cisternBadge = new THREE.Mesh(prepGeo(badgeGeo), cartoucheMat);
  cisternBadge.name = `${p}.lowLevelCistern.thomasCrapperPlaque`;
  cisternBadge.position.set(0, cisternMidY, cisternFrontZ + 0.003);
  cisternGroup.add(cisternBadge);

  // --- 3. Cranked Polished Brass Pull Lever w/ Ceramic Handle (`108 mm` below top, `533 mm` overall W) ---
  const leverY = cisternTopY - 0.108; // 108 mm below cistern top per 04_Low_Level_Ceramic_Cistern CAD
  const leverGroup = new THREE.Group();
  leverGroup.name = `${p}.cisternLever`;
  leverGroup.position.set(0.168, leverY, cisternFrontZ + 0.002);
  cisternGroup.add(leverGroup);

  const leverRose = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.017, 0.019, 0.010, 22)),
    brassMats.primary
  );
  leverRose.name = `${p}.cisternLever.fulcrumRose`;
  leverRose.rotation.x = Math.PI * 0.5;
  leverRose.position.z = 0.005;
  leverGroup.add(leverRose);

  const leverSpindle = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.007, 0.007, 0.022, 16)),
    brassMats.primary
  );
  leverSpindle.name = `${p}.cisternLever.spindle`;
  leverSpindle.rotation.x = Math.PI * 0.5;
  leverSpindle.position.z = 0.016;
  leverGroup.add(leverSpindle);

  // Cranked solid-brass arm sweeping right so overall width from -0.240 left lid edge to handle tip (+0.293) = 533 mm!
  const armCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0.024),
    new THREE.Vector3(0.028, -0.006, 0.026),
    new THREE.Vector3(0.056, -0.014, 0.024),
    new THREE.Vector3(0.118, -0.016, 0.022),
  ]);
  const leverArm = new THREE.Mesh(
    prepGeo(new THREE.TubeGeometry(armCurve, 20, 0.0048, 14, false)),
    brassMats.primary
  );
  leverArm.name = `${p}.cisternLever.crankedArm`;
  leverGroup.add(leverArm);

  // Turned ceramic handle sleeve + Polished Brass ferrule & end finial
  const ceramicGrip = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0105, 0.009, 0.062, 20)),
    ceramicMat
  );
  ceramicGrip.name = `${p}.cisternLever.ceramicHandle`;
  ceramicGrip.rotation.z = Math.PI * 0.5;
  ceramicGrip.position.set(0.090, -0.0155, 0.022);
  leverGroup.add(ceramicGrip);

  const gripFinial = new THREE.Mesh(
    prepGeo(new THREE.SphereGeometry(0.0072, 14, 10)),
    brassMats.primary
  );
  gripFinial.name = `${p}.cisternLever.finial`;
  gripFinial.position.set(0.123, -0.016, 0.022);
  leverGroup.add(gripFinial);

  // --- 4. Pair of Cast Polished Brass Pierced `TC` Medium Wall Brackets (`TC200MEDPB`, 190 × 158 mm) ---
  const bracketGeo = createPiercedTcBracketGeometry();
  const medallionRingGeo = prepGeo(new THREE.TorusGeometry(0.023, 0.0034, 10, 24));
  medallionRingGeo.rotateY(Math.PI * 0.5);

  for (const [sideTag, bx] of [
    ['left', -0.145],
    ['right', 0.145],
  ] as const) {
    const bGroup = new THREE.Group();
    bGroup.name = `${p}.cisternBracket.${sideTag}`;
    bGroup.position.set(bx, cisternBodyBottomY - 0.190, 0);
    group.add(bGroup);

    const webMesh = new THREE.Mesh(bracketGeo, brassMats.primary);
    webMesh.name = `${p}.cisternBracket.${sideTag}.castWeb`;
    bGroup.add(webMesh);

    // Wall backplate & top bearing pad (`158 mm` arm, `24 mm` flange width)
    const wallFlange = new THREE.Mesh(
      prepGeo(new THREE.BoxGeometry(0.026, 0.190, 0.006)),
      brassMats.primary
    );
    wallFlange.name = `${p}.cisternBracket.${sideTag}.wallFlange`;
    wallFlange.position.set(0, 0.095, 0.003);
    bGroup.add(wallFlange);

    const mitreFlange = opts.mitreBracketFlange ?? false;
    const topArm = new THREE.Mesh(
      prepGeo(new THREE.BoxGeometry(0.026, 0.006, mitreFlange ? 0.151 : 0.158)),
      brassMats.primary
    );
    topArm.name = `${p}.cisternBracket.${sideTag}.topArm`;
    topArm.position.set(0, 0.187, mitreFlange ? 0.0825 : 0.079);
    bGroup.add(topArm);

    // Central raised circular `TC` monogram ring & vertical `T` bar in the pierced spandrel
    const ring = new THREE.Mesh(medallionRingGeo, brassMats.primary);
    ring.name = `${p}.cisternBracket.${sideTag}.tcMedallion`;
    ring.position.set(0, 0.138, 0.042);
    bGroup.add(ring);

    const tStem = new THREE.Mesh(
      prepGeo(new THREE.BoxGeometry(0.012, 0.032, 0.0045)),
      brassMats.primary
    );
    tStem.name = `${p}.cisternBracket.${sideTag}.tcMonogramStem`;
    tStem.position.set(0, 0.136, 0.042);
    bGroup.add(tStem);

    const tCross = new THREE.Mesh(
      prepGeo(new THREE.BoxGeometry(0.012, 0.0045, 0.024)),
      brassMats.primary
    );
    tCross.name = `${p}.cisternBracket.${sideTag}.tcMonogramBar`;
    tCross.position.set(0, 0.151, 0.042);
    bGroup.add(tCross);
  }

  // --- 5. Polished Brass `Ø38 mm` Exposed Low-Level Flush Pipe (`TCWPLLFPPB`) & Feed Pipe ---
  const flushGroup = new THREE.Group();
  flushGroup.name = `${p}.flushPipework`;
  group.add(flushGroup);

  // Stepped Polished Brass syphon backnut & collar under cistern (`z = 0.120 m`)
  const syphonNut = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.029, 0.029, 0.018, 6)),
    brassMats.primary
  );
  syphonNut.name = `${p}.flushPipework.syphonBacknut`;
  syphonNut.position.set(0, cisternBodyBottomY - 0.009, syphonZ);
  flushGroup.add(syphonNut);

  const syphonCollar = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.024, 0.022, 0.014, 22)),
    brassMats.primary
  );
  syphonCollar.name = `${p}.flushPipework.syphonCollar`;
  syphonCollar.position.set(0, cisternBodyBottomY - 0.023, syphonZ);
  flushGroup.add(syphonCollar);

  // Swept 90° Ø38mm (`r = 0.019m`) solid-brass L-flush pipe into pan flush horn (`y = 0.345m`)
  const bendR = Math.min(0.052, Math.max(0.025, (panRearZ - syphonZ) * 0.85));
  const flushCurve = new THREE.CurvePath<THREE.Vector3>();
  flushCurve.add(
    new THREE.LineCurve3(
      new THREE.Vector3(0, cisternBodyBottomY - 0.026, syphonZ),
      new THREE.Vector3(0, flushInletY + bendR, syphonZ)
    )
  );
  flushCurve.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(0, flushInletY + bendR, syphonZ),
      new THREE.Vector3(0, flushInletY, syphonZ),
      new THREE.Vector3(0, flushInletY, syphonZ + bendR)
    )
  );
  flushCurve.add(
    new THREE.LineCurve3(
      new THREE.Vector3(0, flushInletY, syphonZ + bendR),
      new THREE.Vector3(0, flushInletY, panRearZ + 0.022)
    )
  );

  const flushPipe = new THREE.Mesh(
    prepGeo(new THREE.TubeGeometry(flushCurve, 32, 0.019, 22, false)),
    brassMats.primary
  );
  flushPipe.name = `${p}.flushPipework.flushPipe38mm`;
  flushGroup.add(flushPipe);

  // Stepped Brushed/Polished Brass pan-horn compression shroud cone & union nut (`TCWPLLFP`)
  const flushCone = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.022, 0.032, 0.024, 24)),
    brassMats.primary
  );
  flushCone.name = `${p}.flushPipework.panFlushConnector`;
  flushCone.rotation.x = Math.PI * 0.5;
  flushCone.position.set(0, flushInletY, panRearZ + 0.004);
  flushGroup.add(flushCone);

  // Polished Brass wall standoff pipe clip (`TCWPLLFPPB`, `y = 0.535 m`)
  const clipY = (cisternBodyBottomY + flushInletY) * 0.5;
  const clipRose = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.018, 0.020, 0.008, 20)),
    brassMats.primary
  );
  clipRose.name = `${p}.flushPipework.wallClipRose`;
  clipRose.rotation.x = Math.PI * 0.5;
  clipRose.position.set(0, clipY, 0.004);
  flushGroup.add(clipRose);

  const clipStem = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0055, 0.0055, syphonZ - 0.016, 14)),
    brassMats.primary
  );
  clipStem.name = `${p}.flushPipework.wallClipStem`;
  clipStem.rotation.x = Math.PI * 0.5;
  clipStem.position.set(0, clipY, syphonZ * 0.5);
  flushGroup.add(clipStem);

  const clipBand = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0225, 0.0225, 0.014, 22)),
    brassMats.primary
  );
  clipBand.name = `${p}.flushPipework.wallClipRing`;
  clipBand.position.set(0, clipY, syphonZ);
  flushGroup.add(clipBand);

  // Rigid Ø15mm Polished Brass cold-water supply pipe & isolation valve on left (`x = -0.175`)
  const feedX = -0.175;
  const feedZ = 0.075;
  const feedWallRose = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.018, 0.020, 0.008, 18)),
    brassMats.primary
  );
  feedWallRose.name = `${p}.flushPipework.supplyWallRose`;
  feedWallRose.rotation.x = Math.PI * 0.5;
  feedWallRose.position.set(feedX, 0.44, 0.004);
  flushGroup.add(feedWallRose);

  const feedCurve = new THREE.CurvePath<THREE.Vector3>();
  feedCurve.add(
    new THREE.LineCurve3(
      new THREE.Vector3(feedX, 0.44, 0.004),
      new THREE.Vector3(feedX, 0.44, feedZ - 0.022)
    )
  );
  feedCurve.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(feedX, 0.44, feedZ - 0.022),
      new THREE.Vector3(feedX, 0.44, feedZ),
      new THREE.Vector3(feedX, 0.462, feedZ)
    )
  );
  feedCurve.add(
    new THREE.LineCurve3(
      new THREE.Vector3(feedX, 0.462, feedZ),
      new THREE.Vector3(feedX, cisternBodyBottomY + 0.004, feedZ)
    )
  );
  const feedPipe = new THREE.Mesh(
    prepGeo(new THREE.TubeGeometry(feedCurve, 20, 0.0075, 14, false)),
    brassMats.primary
  );
  feedPipe.name = `${p}.flushPipework.coldSupplyPipe`;
  flushGroup.add(feedPipe);

  const isoValve = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.012, 0.012, 0.024, 16)),
    brassMats.primary
  );
  isoValve.name = `${p}.flushPipework.isolationValve`;
  isoValve.position.set(feedX, 0.56, feedZ);
  flushGroup.add(isoValve);

  // --- 6. 1895 Oval Solid Dark/Smoked Oak Seat & Lid w/ Full Polished Brass Bar Hinge (`TC100OOAPB`) ---
  const seatGroup = new THREE.Group();
  seatGroup.name = `${p}.ovalWoodSeat`;
  group.add(seatGroup);

  // Align `407 mm` Oval Seat Ring front to `panRearZ + 0.469` (`0.715 m` at default `0.246 m` setback,
  // sitting `7 mm` proud of the `0.708 m` rolled ceramic pan rim per `01_Dim-098` & studio photos)
  const seatFrontZ = panRearZ + 0.469; // 0.715 m
  const ovalCenterZ = seatFrontZ - 0.407 * 0.5; // 0.5115 m (`z = 0.308 .. 0.715 m`)
  const hingeZ = ovalCenterZ - 0.407 * 0.5 - 0.003; // 0.305 m
  // Shaped bevelled solid-oak rear hinge bridge seated cleanly atop the pan's `162 mm`-centres rear ceramic lug ears
  // (`z = panRearZ + 0.018 .. hingeZ - 0.002`, `39 mm` D × `218 mm` W — zero rear overhang past the pan!)
  const blockZStart = panRearZ + 0.018;
  const blockDepth = Math.max(0.034, hingeZ - 0.002 - blockZStart);
  const bridgeHW = 0.109 - 0.003;
  const bridgeHD = blockDepth * 0.5 - 0.003;
  const bridgeR = Math.min(0.015, bridgeHD);
  const bridgeShape = new THREE.Shape();
  bridgeShape.moveTo(-bridgeHW + bridgeR, -bridgeHD);
  bridgeShape.lineTo(bridgeHW - bridgeR, -bridgeHD);
  bridgeShape.absarc(bridgeHW - bridgeR, -bridgeHD + bridgeR, bridgeR, -Math.PI * 0.5, 0, false);
  bridgeShape.lineTo(bridgeHW, bridgeHD - bridgeR);
  bridgeShape.absarc(bridgeHW - bridgeR, bridgeHD - bridgeR, bridgeR, 0, Math.PI * 0.5, false);
  bridgeShape.lineTo(-bridgeHW + bridgeR, bridgeHD);
  bridgeShape.absarc(-bridgeHW + bridgeR, bridgeHD - bridgeR, bridgeR, Math.PI * 0.5, Math.PI, false);
  bridgeShape.lineTo(-bridgeHW, -bridgeHD + bridgeR);
  bridgeShape.absarc(-bridgeHW + bridgeR, -bridgeHD + bridgeR, bridgeR, Math.PI, Math.PI * 1.5, false);
  bridgeShape.closePath();
  const bridgeGeo = new THREE.ExtrudeGeometry(bridgeShape, {
    depth: 0.011,
    bevelEnabled: true,
    bevelThickness: 0.003,
    bevelSize: 0.003,
    bevelSegments: 2,
    curveSegments: 12,
  });
  bridgeGeo.rotateX(-Math.PI * 0.5);
  const brPos = bridgeGeo.attributes.position!;
  const brUv = new Float32Array(brPos.count * 2);
  for (let i = 0; i < brPos.count; i++) {
    brUv[i * 2] = brPos.getX(i) * 2.2 + 0.5;
    brUv[i * 2 + 1] = brPos.getZ(i) * 2.2 + 0.5;
  }
  bridgeGeo.setAttribute('uv', new THREE.BufferAttribute(brUv, 2));

  const rearOakBlock = new THREE.Mesh(prepGeo(bridgeGeo), woodMat);
  rearOakBlock.name = `${p}.ovalWoodSeat.rearHingeBlock`;
  rearOakBlock.position.set(0, panRimY + 0.005, blockZStart + blockDepth * 0.5);
  seatGroup.add(rearOakBlock);

  // Twin Brushed/Polished Brass pillar dome bolts at `162 mm` pan bolt centres (`±81 mm`, `425 mm` from pan front)
  const seatBoltZ = panRearZ + (0.462 - 0.425); // `panRearZ + 0.037 = 0.283 m`
  for (const [tag, bx] of [
    ['left', -0.081],
    ['right', 0.081],
  ] as const) {
    const boltFlange = new THREE.Mesh(
      prepGeo(new THREE.CylinderGeometry(0.012, 0.013, 0.005, 18)),
      brassMats.primary
    );
    boltFlange.name = `${p}.ovalWoodSeat.hingeBolt.${tag}`;
    boltFlange.position.set(bx, panRimY + 0.021, seatBoltZ);
    seatGroup.add(boltFlange);
  }

  // Full-width Brushed/Polished Brass bar / piano hinge barrel (`Ø11.6 mm × 214 mm`) + twin brass hinge straps
  const hingeBarrel = new THREE.Mesh(
    prepGeo(new THREE.CylinderGeometry(0.0058, 0.0058, 0.214, 18)),
    brassMats.primary
  );
  hingeBarrel.name = `${p}.ovalWoodSeat.brassBarHinge`;
  hingeBarrel.rotation.z = Math.PI * 0.5;
  hingeBarrel.position.set(0, panRimY + 0.022, hingeZ);
  seatGroup.add(hingeBarrel);

  for (const [tag, sx] of [
    ['left', -0.095],
    ['right', 0.095],
  ] as const) {
    const strap = new THREE.Mesh(
      prepGeo(new THREE.BoxGeometry(0.028, 0.0035, 0.056)),
      brassMats.primary
    );
    strap.name = `${p}.ovalWoodSeat.hingeStrap.${tag}`;
    strap.position.set(sx, panRimY + 0.0195, hingeZ - 0.012);
    seatGroup.add(strap);
  }
  const seatRing = new THREE.Mesh(createOvalWoodSeatOrLidGeometry(false), woodMat);
  seatRing.name = `${p}.ovalWoodSeat.seatRing`;
  seatRing.position.set(0, panRimY + 0.004, ovalCenterZ);
  seatGroup.add(seatRing);

  // 4 dark rubber seat buffers resting on the 405 mm ceramic rim
  const bufferGeo = prepGeo(new THREE.CylinderGeometry(0.009, 0.009, 0.004, 14));
  for (const [bTag, bx, bz] of [
    ['frontLeft', -0.115, ovalCenterZ + 0.125],
    ['frontRight', 0.115, ovalCenterZ + 0.125],
    ['rearLeft', -0.125, ovalCenterZ - 0.095],
    ['rearRight', 0.125, ovalCenterZ - 0.095],
  ] as const) {
    const buf = new THREE.Mesh(bufferGeo, brassMats.darkShadow);
    buf.name = `${p}.ovalWoodSeat.buffer.${bTag}`;
    buf.position.set(bx, panRimY + 0.002, bz);
    seatGroup.add(buf);
  }

  // Moulded Oval Solid-Oak Lid (`387 × 407 mm`, closed top at `458 mm` FFL — CAD `460 mm`!)
  const seatLid = new THREE.Mesh(createOvalWoodSeatOrLidGeometry(true), woodMat);
  seatLid.name = `${p}.ovalWoodSeat.lid`;
  seatLid.position.set(0, panRimY + 0.032, ovalCenterZ);
  seatGroup.add(seatLid);

  // Recessed stepped heritage crown panel on top of the solid dark-oak lid
  const lidCrownGeo = new THREE.CylinderGeometry(0.145, 0.155, 0.004, 32);
  lidCrownGeo.scale(1.0, 1.0, 1.08);
  const lidCrown = new THREE.Mesh(prepGeo(lidCrownGeo), woodMat);
  lidCrown.name = `${p}.ovalWoodSeat.lidCrownPanel`;
  lidCrown.position.set(0, panRimY + 0.051, ovalCenterZ);
  seatGroup.add(lidCrown);

  attachAssetInteraction(group, {
    kind: 'toggle',
    label: 'Flush Thomas Crapper Cistern',
    activeLabel: 'Flushing Cistern…',
    autoResetAfterSec: 2.6,
    audio: { openPreset: 'cisternFlush', volume: 0.75 },
  });
  const fCode = resolveBrasswareCode(opts.finish, 'BR');
  return attachAssetMetadata(finalizeSanitaryGroup(group, 'sanitary'), {
    name: 'Thomas Crapper Venerable Low-Level Ceramic Cistern WC',
    brand: 'Thomas Crapper & Co.',
    collection: 'Venerable 1895',
    sku: `TCVE101-TCMB201LL-${fCode}`,
    finish: `Vitreous China, Smoked Oak Seat & ${formatBrasswareFinishLabel(opts.finish, 'BR')}`,
    category: 'sanitaryware',
    dimensionsMm: [533, 715, 1045],
    productUrl: 'https://www.thomascrapper.com/products/toilets-cisterns/low-level-ceramic-wc-set/',
    schematicUrl: 'https://www.thomascrapper.com/downloads/spec-sheets/TCMB201LL-TCVE101-Spec.pdf',
  });
}
