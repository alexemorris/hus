import * as THREE from 'three';
import { attachAssetMetadata } from '../shared/catalog-smart-metadata.ts';
import type { SceneBuilderContext } from '../../engine/viewer/scene-types.ts';
import {
  buildArtisanalSpiritBottle,
  buildCrystalBordeauxGlass,
  buildCrystalChampagneFlute,
  buildCrystalRocksTumbler,
  buildCrystalWhiskyDecanter,
} from '../decor/barware-glassware.ts';

export interface SohoKingsleyBarCabinetOptions {
  readonly namePrefix?: string;
  readonly zoneId?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  readonly includeTopServingTray?: boolean;
}

export interface SohoKingsleyBarCabinetResult {
  readonly cabinetGroup: THREE.Group;
  readonly topTrayGroup: THREE.Group | null;
  readonly leftDoorPivot: THREE.Group;
  readonly rightDoorPivot: THREE.Group;
  readonly drawerGroup: THREE.Group;
}

interface KingsleyMaterialSuite {
  readonly oakBody: THREE.MeshPhysicalMaterial;
  readonly oakReed: THREE.MeshPhysicalMaterial;
  readonly oakGroove: THREE.MeshStandardMaterial;
  readonly greyEmperadorMarble: THREE.MeshPhysicalMaterial;
  readonly antiqueBrass: THREE.MeshStandardMaterial;
  readonly darkBrassRecess: THREE.MeshStandardMaterial;
  readonly mirrorGlass: THREE.MeshPhysicalMaterial;
  readonly toughenedGlassShelf: THREE.MeshPhysicalMaterial;
  readonly brushedSteel: THREE.MeshStandardMaterial;
  readonly drawerFelt: THREE.MeshStandardMaterial;
  readonly claretBottleGlass: THREE.MeshPhysicalMaterial;
  readonly burgundyBottleGlass: THREE.MeshPhysicalMaterial;
  readonly champagneBottleGlass: THREE.MeshPhysicalMaterial;
  readonly goldFoilCapsule: THREE.MeshStandardMaterial;
  readonly crimsonFoilCapsule: THREE.MeshStandardMaterial;
  readonly charcoalFoilCapsule: THREE.MeshStandardMaterial;
  readonly vintageLabelCream: THREE.MeshStandardMaterial;
  readonly vintageLabelIvory: THREE.MeshStandardMaterial;
}

let cachedKingsleyMaterials: KingsleyMaterialSuite | null = null;

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function hash2D(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1442695041) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function periodicNoise2D(
  u: number,
  v: number,
  freqU: number,
  freqV: number,
  seed: number
): number {
  const uf = u - Math.floor(u);
  const vf = v - Math.floor(v);
  const x = uf * freqU;
  const y = vf * freqV;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothstep(x - x0);
  const ty = smoothstep(y - y0);

  const ix0 = x0 >= freqU ? 0 : x0;
  const ix1 = ix0 + 1 === freqU ? 0 : ix0 + 1;
  const iy0 = y0 >= freqV ? 0 : y0;
  const iy1 = iy0 + 1 === freqV ? 0 : iy0 + 1;

  const n00 = hash2D(ix0, iy0, seed);
  const n10 = hash2D(ix1, iy0, seed);
  const n01 = hash2D(ix0, iy1, seed);
  const n11 = hash2D(ix1, iy1, seed);

  const nx0 = n00 + (n10 - n00) * tx;
  const nx1 = n01 + (n11 - n01) * tx;
  return nx0 + (nx1 - nx0) * ty;
}

/**
 * Generates deterministic PBR Grey Emperador marble albedo & roughness DataTextures
 * (`#6e6860` warm taupe-grey brecciated limestone with `#dfd9ce` spiderweb calcite veining).
 */
function createGreyEmperadorTextures(): {
  readonly albedo: THREE.DataTexture;
  readonly roughness: THREE.DataTexture;
} {
  const size = 256;
  const rgba = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const idx = (y * size + x) * 4;

      const cloud =
        0.55 * periodicNoise2D(u, v, 4, 4, 17) +
        0.3 * periodicNoise2D(u, v, 9, 9, 31) +
        0.15 * periodicNoise2D(u, v, 18, 18, 53);

      const warpU = u + 0.085 * (periodicNoise2D(u, v, 5, 5, 71) - 0.5);
      const warpV = v + 0.085 * (periodicNoise2D(u, v, 5, 5, 89) - 0.5);

      const ridgeA = Math.abs(periodicNoise2D(warpU, warpV, 7, 5, 103) - 0.5);
      const ridgeB = Math.abs(periodicNoise2D(warpU * 1.3 + 0.2, warpV * 1.1, 13, 11, 137) - 0.5);
      const ridgeC = Math.abs(periodicNoise2D(warpU * 2.1, warpV * 1.9 + 0.4, 24, 20, 179) - 0.5);

      const primaryVein = Math.pow(Math.max(0, 1 - ridgeA * 15.5), 2.4);
      const spiderVein = Math.pow(Math.max(0, 1 - ridgeB * 21.0), 2.2) * 0.82;
      const microVein = Math.pow(Math.max(0, 1 - ridgeC * 26.0), 2.0) * 0.52;
      const darkFissure = Math.pow(Math.max(0, 1 - Math.abs(ridgeA - 0.14) * 18.0), 2.5) * 0.35;

      const vein = Math.min(1, primaryVein + spiderVein + microVein);

      // Base Grey Emperador `#6e6860` (110, 104, 96) modulated by mineral clouds & `#dfd9ce` (223, 217, 206) calcite veins
      const baseR = 98 + cloud * 24 - darkFissure * 34;
      const baseG = 92 + cloud * 23 - darkFissure * 32;
      const baseB = 84 + cloud * 21 - darkFissure * 28;

      const r = baseR * (1 - vein) + 223 * vein;
      const g = baseG * (1 - vein) + 217 * vein;
      const b = baseB * (1 - vein) + 206 * vein;

      rgba[idx] = clampByte(r);
      rgba[idx + 1] = clampByte(g);
      rgba[idx + 2] = clampByte(b);
      rgba[idx + 3] = 255;

      const rVal = clampByte(54 + (1 - cloud) * 18 + vein * 14 + darkFissure * 22);
      rough[idx] = rVal;
      rough[idx + 1] = rVal;
      rough[idx + 2] = rVal;
      rough[idx + 3] = 255;
    }
  }

  const albedo = new THREE.DataTexture(rgba, size, size, THREE.RGBAFormat);
  albedo.name = 'sohoKingsley.greyEmperador.albedo';
  albedo.wrapS = THREE.RepeatWrapping;
  albedo.wrapT = THREE.RepeatWrapping;
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.needsUpdate = true;

  const roughness = new THREE.DataTexture(rough, size, size, THREE.RGBAFormat);
  roughness.name = 'sohoKingsley.greyEmperador.roughness';
  roughness.wrapS = THREE.RepeatWrapping;
  roughness.wrapT = THREE.RepeatWrapping;
  roughness.colorSpace = THREE.NoColorSpace;
  roughness.needsUpdate = true;

  return { albedo, roughness };
}

/**
 * Generates deterministic mid-tone European oak woodgrain DataTexture (`#9a6f44`..`#7d5632`).
 */
function createEuropeanOakTexture(): THREE.DataTexture {
  const w = 128;
  const h = 128;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const idx = (y * w + x) * 4;
      const streak =
        0.6 * periodicNoise2D(u, v, 36, 4, 211) +
        0.28 * periodicNoise2D(u, v, 72, 8, 239) +
        0.12 * periodicNoise2D(u, v, 12, 2, 263);
      const pore = periodicNoise2D(u, v, 64, 24, 293);
      const tone = streak * 0.85 + pore * 0.15;

      rgba[idx] = clampByte(126 + tone * 46);
      rgba[idx + 1] = clampByte(87 + tone * 37);
      rgba[idx + 2] = clampByte(51 + tone * 25);
      rgba[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(rgba, w, h, THREE.RGBAFormat);
  tex.name = 'sohoKingsley.europeanOak.albedo';
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function getKingsleyMaterialSuite(): KingsleyMaterialSuite {
  if (cachedKingsleyMaterials) return cachedKingsleyMaterials;

  const marbleTex = createGreyEmperadorTextures();
  const oakTex = createEuropeanOakTexture();

  cachedKingsleyMaterials = {
    oakBody: new THREE.MeshPhysicalMaterial({
      name: 'sohoKingsley.oakBody',
      color: 0xb88b5e,
      map: oakTex,
      roughness: 0.48,
      metalness: 0.02,
      clearcoat: 0.14,
      clearcoatRoughness: 0.42,
    }),
    oakReed: new THREE.MeshPhysicalMaterial({
      name: 'sohoKingsley.oakReed',
      color: 0xc19364,
      map: oakTex,
      roughness: 0.44,
      metalness: 0.02,
      clearcoat: 0.18,
      clearcoatRoughness: 0.36,
    }),
    oakGroove: new THREE.MeshStandardMaterial({
      name: 'sohoKingsley.oakGroove',
      color: 0x4b321d,
      roughness: 0.72,
      metalness: 0.02,
    }),
    greyEmperadorMarble: new THREE.MeshPhysicalMaterial({
      name: 'sohoKingsley.greyEmperadorMarble',
      color: 0xffffff,
      map: marbleTex.albedo,
      roughnessMap: marbleTex.roughness,
      bumpMap: marbleTex.roughness,
      bumpScale: 0.0015,
      roughness: 0.24,
      metalness: 0.01,
      clearcoat: 0.24,
      clearcoatRoughness: 0.18,
    }),
    antiqueBrass: new THREE.MeshStandardMaterial({
      name: 'sohoKingsley.antiqueBrass',
      color: 0xb58e4c,
      roughness: 0.28,
      metalness: 0.86,
    }),
    darkBrassRecess: new THREE.MeshStandardMaterial({
      name: 'sohoKingsley.darkBrassRecess',
      color: 0x6b5026,
      roughness: 0.42,
      metalness: 0.78,
    }),
    mirrorGlass: new THREE.MeshPhysicalMaterial({
      name: 'sohoKingsley.mirrorBackPanel',
      color: 0xf4f1ec,
      metalness: 0.98,
      roughness: 0.03,
      clearcoat: 0.35,
      clearcoatRoughness: 0.04,
    }),
    toughenedGlassShelf: new THREE.MeshPhysicalMaterial({
      name: 'sohoKingsley.toughenedGlassShelf',
      color: 0xdcebe8,
      transparent: true,
      opacity: 0.34,
      roughness: 0.06,
      metalness: 0.04,
      ior: 1.52,
      clearcoat: 0.4,
      depthWrite: false,
    }),
    brushedSteel: new THREE.MeshStandardMaterial({
      name: 'sohoKingsley.brushedSteel',
      color: 0xd8dde2,
      roughness: 0.22,
      metalness: 0.9,
    }),
    drawerFelt: new THREE.MeshStandardMaterial({
      name: 'sohoKingsley.drawerFelt',
      color: 0x3b352f,
      roughness: 0.92,
      metalness: 0.0,
    }),
    claretBottleGlass: new THREE.MeshPhysicalMaterial({
      name: 'sohoKingsley.claretBottleGlass',
      color: 0x1b2c1a,
      roughness: 0.1,
      metalness: 0.04,
      clearcoat: 0.65,
      clearcoatRoughness: 0.08,
    }),
    burgundyBottleGlass: new THREE.MeshPhysicalMaterial({
      name: 'sohoKingsley.burgundyBottleGlass',
      color: 0x2c3018,
      roughness: 0.11,
      metalness: 0.04,
      clearcoat: 0.65,
      clearcoatRoughness: 0.08,
    }),
    champagneBottleGlass: new THREE.MeshPhysicalMaterial({
      name: 'sohoKingsley.champagneBottleGlass',
      color: 0x1a3520,
      roughness: 0.1,
      metalness: 0.04,
      clearcoat: 0.68,
      clearcoatRoughness: 0.08,
    }),
    goldFoilCapsule: new THREE.MeshStandardMaterial({
      name: 'sohoKingsley.goldFoilCapsule',
      color: 0xc9a24b,
      roughness: 0.26,
      metalness: 0.84,
    }),
    crimsonFoilCapsule: new THREE.MeshStandardMaterial({
      name: 'sohoKingsley.crimsonFoilCapsule',
      color: 0x6f1d24,
      roughness: 0.34,
      metalness: 0.45,
    }),
    charcoalFoilCapsule: new THREE.MeshStandardMaterial({
      name: 'sohoKingsley.charcoalFoilCapsule',
      color: 0x222024,
      roughness: 0.36,
      metalness: 0.38,
    }),
    vintageLabelCream: new THREE.MeshStandardMaterial({
      name: 'sohoKingsley.vintageLabelCream',
      color: 0xf1eadc,
      roughness: 0.72,
      metalness: 0.01,
    }),
    vintageLabelIvory: new THREE.MeshStandardMaterial({
      name: 'sohoKingsley.vintageLabelIvory',
      color: 0xe6dcc8,
      roughness: 0.74,
      metalness: 0.01,
    }),
  };

  return cachedKingsleyMaterials;
}

/** Merges an array of non-indexed or indexed BufferGeometries into a single BufferGeometry. */
function mergeGeometries(geos: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const norm: number[] = [];
  const uv: number[] = [];

  for (const src of geos) {
    const g = src.index ? src.toNonIndexed() : src;
    const p = g.getAttribute('position');
    if (!p) continue;
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const n = g.getAttribute('normal');
    const u = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      if (n) {
        norm.push(n.getX(i), n.getY(i), n.getZ(i));
      } else {
        norm.push(0, 1, 0);
      }
      if (u) {
        uv.push(u.getX(i), u.getY(i));
      } else {
        uv.push(0, 0);
      }
    }
    if (g !== src) g.dispose();
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/**
 * Builds a 2D rounded-front, square-back footprint shape in `(x, -z)` so after `rotateX(-Math.PI / 2)`
 * the extruded slab spans `x ∈ [-halfW, +halfW]`, `z ∈ [zBack, zFront]`, and `y ∈ [0, thickness]`.
 */
function buildRoundedFrontSlabGeometry(
  halfW: number,
  zBack: number,
  zFront: number,
  frontRadius: number,
  thickness: number,
  bevelThickness = 0,
  bevelSize = 0
): THREE.BufferGeometry {
  const w = halfW - bevelSize;
  const zb = zBack + bevelSize;
  const zf = zFront - bevelSize;
  const r = Math.max(0.008, Math.min(frontRadius - bevelSize, w - 0.005, (zf - zb) * 0.8));

  // Shape coordinates (sx, sy) map after rotateX(-PI/2) to (x = sx, y = extrudeZ, z = -sy)
  const shape = new THREE.Shape();
  shape.moveTo(-w, -zb);
  shape.lineTo(w, -zb);
  shape.lineTo(w, -(zf - r));
  shape.absarc(w - r, -(zf - r), r, 0, -Math.PI * 0.5, true);
  shape.lineTo(-(w - r), -zf);
  shape.absarc(-(w - r), -(zf - r), r, -Math.PI * 0.5, -Math.PI, true);
  shape.closePath();

  const bodyDepth = Math.max(0.001, thickness - bevelThickness * 2);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: bodyDepth,
    bevelEnabled: bevelThickness > 0 && bevelSize > 0,
    bevelThickness,
    bevelSize,
    bevelSegments: 4,
    curveSegments: 20,
  });
  geo.rotateX(-Math.PI / 2);
  if (bevelThickness > 0) {
    geo.translate(0, bevelThickness, 0);
  }

  // Planar top/bottom world-scale UVs so Grey Emperador veining flows naturally across the slab
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  if (pos && uv) {
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      uv.setXY(i, (px + halfW) * 1.15 + py * 0.4, (pz - zBack) * 1.15 + py * 0.4);
    }
    uv.needsUpdate = true;
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds one concentric diamond-reeded oak marquetry panel (`panelW × panelH`) centered at `(cx, cy, faceZ)`.
 * Top & bottom triangular quadrants have horizontal half-round oak reeds; left & right quadrants have
 * vertical half-round oak reeds meeting cleanly along 45° diagonal mitres around a central pyramid boss.
 */
function collectConcentricDiamondReededPanelGeos(
  out: THREE.BufferGeometry[],
  cx: number,
  cy: number,
  faceZ: number,
  panelW: number,
  panelH: number
): void {
  const halfW = panelW * 0.5;
  const halfH = panelH * 0.5;
  const reedPitch = 0.0175;
  const reedDepth = 0.0045;
  const reedThick = 0.0132;
  const frameRail = 0.011;

  // Slim perimeter moulding around the marquetry field
  for (const [ox, oy, rw, rh] of [
    [0, halfH - frameRail * 0.5, panelW, frameRail],
    [0, -halfH + frameRail * 0.5, panelW, frameRail],
    [-halfW + frameRail * 0.5, 0, frameRail, panelH - frameRail * 2],
    [halfW - frameRail * 0.5, 0, frameRail, panelH - frameRail * 2],
  ] as const) {
    const g = new THREE.BoxGeometry(rw, rh, reedDepth * 1.15);
    g.translate(cx + ox, cy + oy, faceZ + reedDepth * 0.575);
    out.push(g);
  }

  const innerHalfW = halfW - frameRail - 0.002;
  const innerHalfH = halfH - frameRail - 0.002;
  const rings = Math.floor(Math.min(innerHalfW, innerHalfH) / reedPitch);

  for (let k = 0; k < rings; k++) {
    const offsetFromOuter = k * reedPitch + reedPitch * 0.5;
    const spanW = Math.max(0.014, (innerHalfW - offsetFromOuter) * 2 - 0.003);
    const spanH = Math.max(0.014, (innerHalfH - offsetFromOuter) * 2 - 0.003);

    // Top & bottom horizontal reeds
    const yOff = innerHalfH - offsetFromOuter;
    if (yOff > 0.009) {
      for (const sY of [-1, 1] as const) {
        const g = new THREE.CylinderGeometry(reedThick * 0.5, reedThick * 0.5, spanW, 8, 1, false, 0, Math.PI);
        g.rotateZ(Math.PI / 2);
        g.rotateX(Math.PI / 2);
        g.scale(1, 1, (reedDepth / (reedThick * 0.5)) * 0.95);
        g.translate(cx, cy + sY * yOff, faceZ);
        out.push(g);
      }
    }

    // Left & right vertical reeds
    const xOff = innerHalfW - offsetFromOuter;
    if (xOff > 0.009) {
      for (const sX of [-1, 1] as const) {
        const g = new THREE.CylinderGeometry(reedThick * 0.5, reedThick * 0.5, spanH, 8, 1, false, 0, Math.PI);
        g.rotateY(Math.PI / 2);
        g.scale(1, 1, (reedDepth / (reedThick * 0.5)) * 0.95);
        g.translate(cx + sX * xOff, cy, faceZ);
        out.push(g);
      }
    }
  }

  // Central mitred 4-way pyramid oak boss
  const boss = new THREE.ConeGeometry(0.016, reedDepth * 1.25, 4);
  boss.rotateY(Math.PI / 4);
  boss.rotateX(Math.PI / 2);
  boss.translate(cx, cy, faceZ + reedDepth * 0.62);
  out.push(boss);
}

/**
 * Builds a cast antique-brass half-pyramid / chevron relief handle (`H = 136mm × W = 48mm × D = 18mm`)
 * matching Soho Home Kingsley's signature central diamond pull pair.
 */
function buildKingsleyBrassHandle(
  name: string,
  sideSign: -1 | 1,
  mats: KingsleyMaterialSuite
): THREE.Group {
  const handle = new THREE.Group();
  handle.name = name;

  const h = 0.136;
  const w = 0.046;
  const tiers = [
    [w, h, 0.005, 0.0025],
    [w * 0.78, h * 0.78, 0.005, 0.0075],
    [w * 0.54, h * 0.54, 0.0045, 0.0122],
    [w * 0.3, h * 0.3, 0.0035, 0.0162],
  ] as const;

  // Back finger-pull shadow undercut
  const undercut = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.72, h * 0.76, 0.004),
    mats.darkBrassRecess
  );
  undercut.name = `${name}.undercut`;
  undercut.position.set(-sideSign * (w * 0.14), 0, 0.002);
  handle.add(undercut);

  tiers.forEach(([tw, th, td, tz], idx) => {
    const tierMesh = new THREE.Mesh(new THREE.BoxGeometry(tw, th, td), mats.antiqueBrass);
    tierMesh.name = `${name}.tier.${idx + 1}`;
    // Shift tiers toward the center meeting stile so the two door handles form a unified 4-way diamond
    const centerBias = -sideSign * ((w - tw) * 0.5);
    tierMesh.position.set(centerBias, 0, tz);
    tierMesh.castShadow = true;
    handle.add(tierMesh);
  });

  return handle;
}

type KingsleyWineVarietal = 'bordeaux' | 'burgundy' | 'champagne';

let cachedHorizontalBottleBodyGeo: THREE.BufferGeometry | null = null;
let cachedHorizontalCapsuleGeo: THREE.BufferGeometry | null = null;
let cachedHorizontalLabelGeo: THREE.BufferGeometry | null = null;

let cachedUprightBottleBodyGeo: THREE.BufferGeometry | null = null;
let cachedUprightCapsuleGeo: THREE.BufferGeometry | null = null;
let cachedUprightLabelGeo: THREE.BufferGeometry | null = null;

function buildStockedHorizontalWineBottle(
  name: string,
  varietal: KingsleyWineVarietal,
  mats: KingsleyMaterialSuite
): THREE.Group {
  if (!cachedHorizontalBottleBodyGeo) {
    const pts = [
      new THREE.Vector2(0.0001, 0.012),
      new THREE.Vector2(0.033, 0.0),
      new THREE.Vector2(0.038, 0.006),
      new THREE.Vector2(0.038, 0.165),
      new THREE.Vector2(0.031, 0.205),
      new THREE.Vector2(0.0145, 0.232),
      new THREE.Vector2(0.014, 0.292),
      new THREE.Vector2(0.0155, 0.298),
      new THREE.Vector2(0.0001, 0.300),
    ];
    cachedHorizontalBottleBodyGeo = new THREE.LatheGeometry(pts, 18);
    cachedHorizontalBottleBodyGeo.rotateX(Math.PI / 2);

    cachedHorizontalCapsuleGeo = new THREE.CylinderGeometry(0.0152, 0.0156, 0.056, 16);
    cachedHorizontalCapsuleGeo.rotateX(Math.PI / 2);

    cachedHorizontalLabelGeo = new THREE.CylinderGeometry(
      0.0386,
      0.0386,
      0.088,
      16,
      1,
      true,
      -Math.PI * 0.42,
      Math.PI * 0.84
    );
    cachedHorizontalLabelGeo.rotateX(Math.PI / 2);
  }

  const bottle = new THREE.Group();
  bottle.name = name;

  const glassMat =
    varietal === 'bordeaux'
      ? mats.claretBottleGlass
      : varietal === 'burgundy'
        ? mats.burgundyBottleGlass
        : mats.champagneBottleGlass;
  const foilMat =
    varietal === 'champagne'
      ? mats.goldFoilCapsule
      : varietal === 'bordeaux'
        ? mats.crimsonFoilCapsule
        : mats.charcoalFoilCapsule;

  const glass = new THREE.Mesh(cachedHorizontalBottleBodyGeo, glassMat);
  glass.name = `${name}.glass`;
  glass.castShadow = true;
  bottle.add(glass);

  const foil = new THREE.Mesh(cachedHorizontalCapsuleGeo!, foilMat);
  foil.name = `${name}.capsule`;
  foil.position.z = 0.271;
  bottle.add(foil);

  const label = new THREE.Mesh(
    cachedHorizontalLabelGeo!,
    varietal === 'burgundy' ? mats.vintageLabelIvory : mats.vintageLabelCream
  );
  label.name = `${name}.label`;
  label.position.z = 0.095;
  bottle.add(label);

  return bottle;
}

function buildStockedUprightWineBottle(
  name: string,
  varietal: KingsleyWineVarietal,
  mats: KingsleyMaterialSuite
): THREE.Group {
  if (!cachedUprightBottleBodyGeo) {
    const pts = [
      new THREE.Vector2(0.0001, 0.012),
      new THREE.Vector2(0.033, 0.0),
      new THREE.Vector2(0.038, 0.006),
      new THREE.Vector2(0.038, 0.165),
      new THREE.Vector2(0.031, 0.205),
      new THREE.Vector2(0.0145, 0.232),
      new THREE.Vector2(0.014, 0.292),
      new THREE.Vector2(0.0155, 0.298),
      new THREE.Vector2(0.0001, 0.300),
    ];
    cachedUprightBottleBodyGeo = new THREE.LatheGeometry(pts, 18);
    cachedUprightCapsuleGeo = new THREE.CylinderGeometry(0.0152, 0.0156, 0.056, 16);
    cachedUprightLabelGeo = new THREE.CylinderGeometry(
      0.0386,
      0.0386,
      0.088,
      16,
      1,
      true,
      -Math.PI * 0.42,
      Math.PI * 0.84
    );
  }

  const bottle = new THREE.Group();
  bottle.name = name;

  const glassMat =
    varietal === 'bordeaux'
      ? mats.claretBottleGlass
      : varietal === 'burgundy'
        ? mats.burgundyBottleGlass
        : mats.champagneBottleGlass;
  const foilMat =
    varietal === 'champagne'
      ? mats.goldFoilCapsule
      : varietal === 'bordeaux'
        ? mats.crimsonFoilCapsule
        : mats.charcoalFoilCapsule;

  const glass = new THREE.Mesh(cachedUprightBottleBodyGeo, glassMat);
  glass.name = `${name}.glass`;
  glass.castShadow = true;
  bottle.add(glass);

  const foil = new THREE.Mesh(cachedUprightCapsuleGeo!, foilMat);
  foil.name = `${name}.capsule`;
  foil.position.y = 0.271;
  bottle.add(foil);

  const label = new THREE.Mesh(
    cachedUprightLabelGeo!,
    varietal === 'burgundy' ? mats.vintageLabelIvory : mats.vintageLabelCream
  );
  label.name = `${name}.label`;
  label.position.y = 0.095;
  bottle.add(label);

  return bottle;
}

/**
 * Builds the interactive Soho Home `Kingsley Bar Cabinet, Grey Emperador` (`SKU 74564715`):
 * - Exact `1.100m H × 0.950m W × 0.510m D` closed cabinet bounds (`familyRoom.kingsleyBarCabinet`),
 * - Grey Emperador marble serving slab (`32mm` double-stepped bullnose, `R = 115mm` front corners),
 * - Mid-tone European oak carcass with 27 horizontal half-round flutes, `R = 115mm` wrap-around box doors,
 *   concentric diamond-reeded marquetry panels, cast antique-brass 4-way pyramid handles & butt hinges,
 * - Synchronized `±106°` (`±1.85 rad`) double-door swing (`linkDoorPair`) + internal sliding oak drawer (`0.22m`),
 * - Warm `2700K` bar LED diffuser strip, silvered mirror back panel, toughened glass shelves, barware,
 *   16-cubby horizontal oak wine grid (16 bottles) + 6 inside-of-door oak & brass racks (8 upright wine bottles
 *   + spirit bottles & tumblers) + 2 reserve vintage wine bottles on the middle shelf (26 internal wine bottles!).
 */
export function buildSohoKingsleyBarCabinet(
  ctx: SceneBuilderContext,
  options: SohoKingsleyBarCabinetOptions = {}
): SohoKingsleyBarCabinetResult {
  const {
    namePrefix = 'sohoKingsleyBarCabinet',
    zoneId,
    position = [0, 0, 0],
    rotationY = 0,
    includeTopServingTray = true,
  } = options;

  const mats = getKingsleyMaterialSuite();

  const cabinetGroup = new THREE.Group();
  cabinetGroup.name = namePrefix;
  cabinetGroup.userData =
    zoneId !== undefined
      ? {
          ...cabinetGroup.userData,
          zone: zoneId,
          zoneId,
        }
      : { ...cabinetGroup.userData };
  cabinetGroup.position.set(position[0], position[1], position[2]);
  cabinetGroup.rotation.y = rotationY;

  // =========================================================================
  // 1. ANTIQUE-BRASS PLINTH FEET (`Y = 0.000..0.060m`, `60mm` floor clearance)
  //    Curved quarter-round front corner plinths (`R = 115mm`) + rear blocks
  // =========================================================================
  const plinthH = 0.06;
  for (const sideSign of [-1, 1] as const) {
    const sideLabel = sideSign < 0 ? 'left' : 'right';
    const cornerCenterX = sideSign * (0.468 - 0.112);
    const cornerCenterZ = 0.236 - 0.112;
    const thetaStart = sideSign > 0 ? 0 : -Math.PI * 0.5;

    const curvedFootGeo = new THREE.CylinderGeometry(
      0.112,
      0.112,
      plinthH,
      18,
      1,
      false,
      thetaStart,
      Math.PI * 0.5
    );
    const curvedFoot = new THREE.Mesh(curvedFootGeo, mats.antiqueBrass);
    curvedFoot.name = `${namePrefix}.brassPlinthFront.${sideLabel}`;
    curvedFoot.position.set(cornerCenterX, plinthH * 0.5, cornerCenterZ);
    curvedFoot.castShadow = true;
    curvedFoot.receiveShadow = true;
    cabinetGroup.add(curvedFoot);

    const frontReturn = new THREE.Mesh(
      new THREE.BoxGeometry(0.065, plinthH, 0.026),
      mats.antiqueBrass
    );
    frontReturn.name = `${namePrefix}.brassPlinthReturn.${sideLabel}`;
    frontReturn.position.set(sideSign * (0.468 - 0.112 - 0.032), plinthH * 0.5, 0.223);
    frontReturn.castShadow = true;
    cabinetGroup.add(frontReturn);

    const rearFoot = new THREE.Mesh(
      new THREE.BoxGeometry(0.036, plinthH, 0.095),
      mats.antiqueBrass
    );
    rearFoot.name = `${namePrefix}.brassPlinthRear.${sideLabel}`;
    rearFoot.position.set(sideSign * 0.448, plinthH * 0.5, -0.202);
    rearFoot.castShadow = true;
    cabinetGroup.add(rearFoot);
  }

  // =========================================================================
  // 2. GREY EMPERADOR MARBLE TOP SERVING SLAB (`Y = 1.068..1.100m`, `32mm` thick)
  //    Exact `0.950m W × 0.510m D` (`x = -0.475..+0.475, z = -0.255..+0.255`)
  //    Double-stepped bullnose edge profile + `R = 115mm` rounded front corners
  // =========================================================================
  const marbleLowerTier = new THREE.Mesh(
    buildRoundedFrontSlabGeometry(0.474, -0.255, 0.254, 0.115, 0.015, 0.003, 0.003),
    mats.greyEmperadorMarble
  );
  marbleLowerTier.name = `${namePrefix}.marbleTop.lowerBullnose`;
  marbleLowerTier.position.y = 1.068;
  marbleLowerTier.castShadow = true;
  marbleLowerTier.receiveShadow = true;
  cabinetGroup.add(marbleLowerTier);

  const marbleShadowGroove = new THREE.Mesh(
    buildRoundedFrontSlabGeometry(0.470, -0.253, 0.250, 0.112, 0.002, 0, 0),
    mats.oakGroove
  );
  marbleShadowGroove.name = `${namePrefix}.marbleTop.stepGroove`;
  marbleShadowGroove.position.y = 1.083;
  cabinetGroup.add(marbleShadowGroove);

  // Exact outer `0.950 × 0.510m` upper bullnose slab capping `Y = 1.085..1.100m`
  const marbleUpperTier = new THREE.Mesh(
    buildRoundedFrontSlabGeometry(0.475, -0.255, 0.255, 0.115, 0.015, 0.003, 0.003),
    mats.greyEmperadorMarble
  );
  marbleUpperTier.name = `${namePrefix}.marbleTop.upperBullnose`;
  marbleUpperTier.position.y = 1.085;
  marbleUpperTier.castShadow = true;
  marbleUpperTier.receiveShadow = true;
  cabinetGroup.add(marbleUpperTier);

  // =========================================================================
  // 3. REAR EUROPEAN OAK CARCASS (`Y = 0.060..1.068m`, `z = -0.255..+0.085m`)
  //    With 27 horizontally reeded half-round oak ribs on both side cheeks
  // =========================================================================
  const bodyBotY = 0.06;
  const bodyTopY = 1.068;
  const bodyH = bodyTopY - bodyBotY; // 1.008m
  const bodyMidY = (bodyBotY + bodyTopY) * 0.5; // 0.564m
  const carcassBackZ = -0.255;
  const carcassFrontZ = 0.085;
  const carcassD = carcassFrontZ - carcassBackZ; // 0.340m
  const carcassMidZ = (carcassBackZ + carcassFrontZ) * 0.5; // -0.085m
  const wallT = 0.024;
  const outerHalfW = 0.465; // 0.938m carcass width under 0.950m overhanging marble slab
  const innerHalfW = outerHalfW - wallT; // 0.445m (890mm clear interior width)

  // Bottom carcass base, top ceiling header, back oak panel & center rear batten
  for (const [partName, px, py, pz, sx, sy, sz, mat] of [
    ['carcassBase', 0, bodyBotY + 0.012, carcassMidZ, outerHalfW * 2, 0.024, carcassD, mats.oakBody],
    ['carcassTop', 0, bodyTopY - 0.012, carcassMidZ, outerHalfW * 2, 0.024, carcassD, mats.oakBody],
    ['carcassBackPanel', 0, bodyMidY, carcassBackZ + 0.009, outerHalfW * 2 - 0.008, bodyH - 0.016, 0.018, mats.oakBody],
    ['carcassBackBatten', 0, bodyMidY, carcassBackZ + 0.003, 0.056, bodyH - 0.02, 0.006, mats.oakReed],
    ['carcassLeftCheek', -outerHalfW + wallT * 0.5, bodyMidY, carcassMidZ, wallT, bodyH, carcassD, mats.oakBody],
    ['carcassRightCheek', outerHalfW - wallT * 0.5, bodyMidY, carcassMidZ, wallT, bodyH, carcassD, mats.oakBody],
  ] as const) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.name = `${namePrefix}.${partName}`;
    m.position.set(px, py, pz);
    m.castShadow = true;
    m.receiveShadow = true;
    cabinetGroup.add(m);
  }

  // 27 horizontally reeded half-round oak ribs along both 340mm side cheeks + 4 antique-brass butt hinges per side
  const numReeds = 27;
  const reedSpanH = bodyH - 0.016;
  const reedPitchY = reedSpanH / numReeds;
  const reedRadius = reedPitchY * 0.44;
  const sideReedGeos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < numReeds; i++) {
    const ry = bodyBotY + 0.008 + (i + 0.5) * reedPitchY;
    for (const sideSign of [-1, 1] as const) {
      const g = new THREE.CylinderGeometry(
        reedRadius,
        reedRadius,
        carcassD - 0.004,
        8,
        1,
        false,
        sideSign > 0 ? 0 : Math.PI,
        Math.PI
      );
      g.rotateX(Math.PI / 2);
      g.scale(0.55, 1, 1);
      g.translate(sideSign * outerHalfW, ry, carcassMidZ);
      sideReedGeos.push(g);
    }
  }
  const sideReedsMesh = new THREE.Mesh(mergeGeometries(sideReedGeos), mats.oakReed);
  sideReedsMesh.name = `${namePrefix}.sideCheekHorizontalReeds`;
  sideReedsMesh.castShadow = true;
  sideReedsMesh.receiveShadow = true;
  cabinetGroup.add(sideReedsMesh);

  // 4 antique-brass butt hinges per side along the `z = +0.087m` carcass/door vertical joint
  const hingeBarrelGeo = new THREE.CylinderGeometry(0.0042, 0.0042, 0.044, 10);
  for (const sideSign of [-1, 1] as const) {
    const sideLabel = sideSign < 0 ? 'left' : 'right';
    for (const [hIdx, hy] of ([0.165, 0.435, 0.705, 0.965] as const).entries()) {
      const hinge = new THREE.Mesh(hingeBarrelGeo, mats.antiqueBrass);
      hinge.name = `${namePrefix}.buttHinge.${sideLabel}.${hIdx + 1}`;
      hinge.position.set(sideSign * (outerHalfW + 0.001), hy, 0.087);
      cabinetGroup.add(hinge);
    }
  }

  // =========================================================================
  // 4. RICH STOCKED INTERIOR (`Y = 0.084..1.050m`)
  // =========================================================================

  // 4A. 16-Cubby Solid Oak Horizontal Wine Grid (`Y = 0.084..0.322m`, 2 rows × 8 cols = 16 bottles)
  const wineGridGroup = new THREE.Group();
  wineGridGroup.name = `${namePrefix}.oakWineGrid`;
  const gridBotY = bodyBotY + 0.024; // 0.084m
  const gridTopY = 0.322;
  const gridMidY = (gridBotY + gridTopY) * 0.5; // 0.203m
  const gridDepth = 0.312;
  const gridCenterZ = -0.078; // -0.234 .. +0.078m
  const dividerT = 0.01;

  // Middle horizontal shelf + top bar-deck slab
  const midWineShelf = new THREE.Mesh(
    new THREE.BoxGeometry(innerHalfW * 2, dividerT, gridDepth),
    mats.oakBody
  );
  midWineShelf.name = `${namePrefix}.oakWineGrid.midShelf`;
  midWineShelf.position.set(0, gridMidY, gridCenterZ);
  wineGridGroup.add(midWineShelf);

  const oakBarDeck = new THREE.Mesh(
    new THREE.BoxGeometry(innerHalfW * 2, 0.018, gridDepth + 0.01),
    mats.oakBody
  );
  oakBarDeck.name = `${namePrefix}.oakBarDeck`;
  oakBarDeck.position.set(0, gridTopY + 0.009, gridCenterZ + 0.003);
  oakBarDeck.castShadow = true;
  oakBarDeck.receiveShadow = true;
  cabinetGroup.add(oakBarDeck);

  // 7 vertical oak cubby dividers creating 8 columns
  const numCols = 8;
  const colW = (innerHalfW * 2) / numCols; // ~0.111m per cubby
  for (let c = 1; c < numCols; c++) {
    const dx = -innerHalfW + c * colW;
    const vDiv = new THREE.Mesh(
      new THREE.BoxGeometry(dividerT, gridTopY - gridBotY, gridDepth),
      mats.oakBody
    );
    vDiv.name = `${namePrefix}.oakWineGrid.divider.${c}`;
    vDiv.position.set(dx, gridMidY, gridCenterZ);
    wineGridGroup.add(vDiv);
  }

  // 16 stocked horizontal 750ml Bordeaux, Burgundy & Champagne wine bottles (necks forward +Z)
  const varietalCycle: readonly KingsleyWineVarietal[] = [
    'bordeaux',
    'burgundy',
    'champagne',
    'bordeaux',
    'champagne',
    'burgundy',
    'bordeaux',
    'champagne',
  ];
  let cubbyBottleIdx = 0;
  for (const [rIdx, rowY] of ([gridBotY + 0.056, gridMidY + 0.058] as const).entries()) {
    for (let c = 0; c < numCols; c++) {
      cubbyBottleIdx++;
      const cx = -innerHalfW + (c + 0.5) * colW;
      const varietal = varietalCycle[(c + rIdx * 3) % varietalCycle.length]!;
      const bottle = buildStockedHorizontalWineBottle(
        `${namePrefix}.cubbyWineBottle.${cubbyBottleIdx}`,
        varietal,
        mats
      );
      // Punt at z = -0.222m, neck/capsule tip at z = +0.078m (inside carcass front plane +0.085m)
      bottle.position.set(cx, rowY, -0.222);
      wineGridGroup.add(bottle);
    }
  }
  cabinetGroup.add(wineGridGroup);

  // 4B. Full-Width Silvered Mirror Back Panel (`Y = 0.340..0.958m`)
  const mirrorPanel = new THREE.Mesh(
    new THREE.BoxGeometry(innerHalfW * 2 - 0.006, 0.618, 0.008),
    mats.mirrorGlass
  );
  mirrorPanel.name = `${namePrefix}.mirroredBackPanel`;
  mirrorPanel.position.set(0, 0.649, carcassBackZ + 0.022);
  cabinetGroup.add(mirrorPanel);

  const applySparklingCrystal = <T extends THREE.Object3D>(root: T): T => {
    root.traverse((node) => {
      if (node instanceof THREE.Mesh && node.material instanceof THREE.Material) {
        const mName = (node.material.name || "").toLowerCase();
        if (mName.includes("crystal") || mName.includes("clear_glass") || mName.includes("glass")) {
          if (!mName.includes("amber") && !mName.includes("green") && !mName.includes("claret") && !mName.includes("burgundy") && !mName.includes("champagne")) {
            node.material = mats.toughenedGlassShelf;
          }
        }
      }
    });
    return root;
  };

  // 4C. Stocked Stemware on Solid Oak Bar Deck (`Y = 0.340m`)
  const deckTopY = gridTopY + 0.018; // 0.340m
  for (const [gIdx, gx] of ([-0.36, -0.25, -0.14, 0.14] as const).entries()) {
    const bordeaux = applySparklingCrystal(buildCrystalBordeauxGlass(`${namePrefix}.barDeck.bordeauxGlass.${gIdx + 1}`));
    bordeaux.position.set(gx, deckTopY, -0.05 + (gIdx % 2) * 0.055);
    cabinetGroup.add(bordeaux);
  }
  for (const [fIdx, fx] of ([0.25, 0.33, 0.39] as const).entries()) {
    const flute = buildCrystalChampagneFlute(`${namePrefix}.barDeck.champagneFlute.${fIdx + 1}`);
    flute.position.set(fx, deckTopY, -0.055 + (fIdx % 2) * 0.06);
    cabinetGroup.add(flute);
  }

  // 4D. Middle Full-Depth Toughened Glass Shelf (`Y = 0.576m, W = 0.870m × D = 0.305m`)
  const midGlassY = 0.576;
  const midGlassShelf = new THREE.Mesh(
    new THREE.BoxGeometry(0.87, 0.008, 0.305),
    mats.toughenedGlassShelf
  );
  midGlassShelf.name = `${namePrefix}.middleGlassShelf`;
  midGlassShelf.position.set(0, midGlassY, -0.082);
  cabinetGroup.add(midGlassShelf);

  const shelfPinGeo = new THREE.CylinderGeometry(0.004, 0.004, 0.014, 8);
  shelfPinGeo.rotateZ(Math.PI / 2);
  for (const [sy, zFrontPin] of [
    [midGlassY - 0.006, 0.04],
    [0.778 - 0.006, -0.095],
  ] as const) {
    for (const sX of [-1, 1] as const) {
      for (const pz of [-0.21, zFrontPin] as const) {
        const pin = new THREE.Mesh(shelfPinGeo, mats.antiqueBrass);
        pin.name = `${namePrefix}.brassShelfPin`;
        pin.position.set(sX * (innerHalfW - 0.005), sy, pz);
        cabinetGroup.add(pin);
      }
    }
  }

  // Stocked Middle Glass Shelf (`Y = 0.580m`): crystal decanters, cocktail shaker, ice bucket & 2 reserve vintage wine bottles
  const midTopY = midGlassY + 0.004;
  const leftDecanter = applySparklingCrystal(buildCrystalWhiskyDecanter(`${namePrefix}.middleShelf.crystalDecanter.1`));
  leftDecanter.scale.setScalar(0.78);
  leftDecanter.position.set(-0.33, midTopY, -0.085);
  cabinetGroup.add(leftDecanter);

  const rightDecanter = applySparklingCrystal(buildCrystalWhiskyDecanter(`${namePrefix}.middleShelf.crystalDecanter.2`));
  rightDecanter.scale.setScalar(0.74);
  rightDecanter.position.set(-0.18, midTopY, -0.115);
  cabinetGroup.add(rightDecanter);

  // Brushed-steel cobbler cocktail shaker (`H = 165mm`)
  const shakerGroup = new THREE.Group();
  shakerGroup.name = `${namePrefix}.middleShelf.cocktailShaker`;
  shakerGroup.position.set(-0.03, midTopY, -0.075);
  const shakerCup = new THREE.Mesh(
    new THREE.CylinderGeometry(0.041, 0.031, 0.112, 18),
    mats.brushedSteel
  );
  shakerCup.name = `${namePrefix}.cocktailShaker.cup`;
  shakerCup.position.y = 0.056;
  shakerGroup.add(shakerCup);
  const shakerShoulder = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.04, 0.034, 18),
    mats.brushedSteel
  );
  shakerShoulder.name = `${namePrefix}.cocktailShaker.shoulder`;
  shakerShoulder.position.y = 0.129;
  shakerGroup.add(shakerShoulder);
  const shakerCap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.017, 0.02, 0.022, 16),
    mats.antiqueBrass
  );
  shakerCap.name = `${namePrefix}.cocktailShaker.cap`;
  shakerCap.position.y = 0.157;
  shakerGroup.add(shakerCap);
  cabinetGroup.add(shakerGroup);

  // Brushed-steel & antique-brass ice bucket (`H = 148mm`)
  const iceBucket = new THREE.Group();
  iceBucket.name = `${namePrefix}.middleShelf.iceBucket`;
  iceBucket.position.set(0.13, midTopY, -0.095);
  const bucketBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.068, 0.058, 0.132, 20),
    mats.brushedSteel
  );
  bucketBody.name = `${namePrefix}.iceBucket.body`;
  bucketBody.position.y = 0.066;
  iceBucket.add(bucketBody);
  const bucketLid = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, 0.01, 20),
    mats.antiqueBrass
  );
  bucketLid.name = `${namePrefix}.iceBucket.lid`;
  bucketLid.position.y = 0.137;
  iceBucket.add(bucketLid);
  const bucketKnop = new THREE.Mesh(new THREE.SphereGeometry(0.011, 12, 10), mats.antiqueBrass);
  bucketKnop.name = `${namePrefix}.iceBucket.knop`;
  bucketKnop.position.y = 0.149;
  iceBucket.add(bucketKnop);
  cabinetGroup.add(iceBucket);

  // 2 reserve vintage wine bottles on the rear half of the middle shelf (clearing the top half-depth glass shelf at z = -0.235..-0.075)
  for (const [rbIdx, rx, rz, varietal] of [
    [1, 0.28, -0.005, 'bordeaux'],
    [2, 0.37, -0.015, 'champagne'],
  ] as const) {
    const reserveBottle = buildStockedUprightWineBottle(
      `${namePrefix}.reserveWineBottle.${rbIdx}`,
      varietal,
      mats
    );
    reserveBottle.scale.setScalar(0.88);
    reserveBottle.position.set(rx, midTopY, rz);
    cabinetGroup.add(reserveBottle);
  }

  // 4E. Top Half-Depth Toughened Glass Shelf (`Y = 0.778m, W = 0.870m × D = 0.160m`)
  const topGlassY = 0.778;
  const topGlassShelf = new THREE.Mesh(
    new THREE.BoxGeometry(0.87, 0.008, 0.16),
    mats.toughenedGlassShelf
  );
  topGlassShelf.name = `${namePrefix}.topHalfGlassShelf`;
  topGlassShelf.position.set(0, topGlassY, -0.155);
  cabinetGroup.add(topGlassShelf);

  const topShelfY = topGlassY + 0.004;
  for (const [tIdx, tx] of ([-0.35, -0.23, -0.11, 0.01] as const).entries()) {
    const tumbler = applySparklingCrystal(buildCrystalRocksTumbler(`${namePrefix}.topShelf.rocksTumbler.${tIdx + 1}`));
    tumbler.position.set(tx, topShelfY, -0.155);
    cabinetGroup.add(tumbler);
  }
  // Crystal coupe glasses on right half of top glass shelf
  const coupePts = [
    new THREE.Vector2(0.0001, 0.0),
    new THREE.Vector2(0.034, 0.0),
    new THREE.Vector2(0.009, 0.005),
    new THREE.Vector2(0.003, 0.014),
    new THREE.Vector2(0.003, 0.082),
    new THREE.Vector2(0.044, 0.104),
    new THREE.Vector2(0.046, 0.132),
    new THREE.Vector2(0.0448, 0.132),
    new THREE.Vector2(0.0425, 0.106),
    new THREE.Vector2(0.0001, 0.086),
  ];
  const coupeGeo = new THREE.LatheGeometry(coupePts, 18);
  for (const [cIdx, cx] of ([0.14, 0.25, 0.36] as const).entries()) {
    const coupe = new THREE.Mesh(coupeGeo, mats.toughenedGlassShelf);
    coupe.name = `${namePrefix}.topShelf.crystalCoupe.${cIdx + 1}`;
    coupe.position.set(cx, topShelfY, -0.155);
    cabinetGroup.add(coupe);
  }

  // 4F. Warm `2700K` Integrated Bar LED Diffuser Strip (`Y = 0.958m`) & Drawer Divider Shelf (`Y = 0.960m`)
  const drawerDivider = new THREE.Mesh(
    new THREE.BoxGeometry(innerHalfW * 2, 0.012, carcassD - 0.024),
    mats.oakBody
  );
  drawerDivider.name = `${namePrefix}.drawerHousingShelf`;
  drawerDivider.position.set(0, 0.958, carcassMidZ + 0.004);
  cabinetGroup.add(drawerDivider);

  const barLedMat = new THREE.MeshStandardMaterial({
    name: `${namePrefix}.warmBarLedMat`,
    color: 0xfff1cf,
    emissive: 0xffb448,
    emissiveIntensity: 2.3,
    roughness: 0.22,
  });
  barLedMat.userData.baseEmissiveIntensity = 2.3;
  if (ctx.lightGroups?.walkInCupboardLeds) {
    ctx.lightGroups.walkInCupboardLeds.emissives.push(barLedMat);
  }

  const ledChannel = new THREE.Mesh(
    new THREE.BoxGeometry(0.84, 0.006, 0.018),
    mats.antiqueBrass
  );
  ledChannel.name = `${namePrefix}.barLedChannel`;
  ledChannel.position.set(0, 0.951, 0.018);
  cabinetGroup.add(ledChannel);

  const ledDiffuser = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.004, 0.012), barLedMat);
  ledDiffuser.name = `${namePrefix}.barLedDiffuserStrip`;
  ledDiffuser.position.set(0, 0.948, 0.018);
  cabinetGroup.add(ledDiffuser);
  ctx.interactions.registerLightFixture(ledDiffuser, 'walkInCupboardLeds');

  // 4G. Top Internal Sliding Oak Drawer (`Y = 0.966..1.044m, W = 0.870m`)
  const drawerGroup = new THREE.Group();
  drawerGroup.name = `${namePrefix}.slidingOakDrawer`;
  drawerGroup.position.set(0, 1.005, -0.072); // Front face at -0.072 + 0.145 = +0.073m (inside carcass +0.085m)

  const drawerW = 0.87;
  const drawerH = 0.076;
  const drawerD = 0.29;

  const drawerFront = new THREE.Mesh(
    new THREE.BoxGeometry(drawerW, drawerH, 0.018),
    mats.oakReed
  );
  drawerFront.name = `${namePrefix}.slidingOakDrawer.front`;
  drawerFront.position.set(0, 0, drawerD * 0.5 - 0.009);
  drawerFront.castShadow = true;
  drawerGroup.add(drawerFront);

  // Recessed brass finger-pull & Soho Home maker's escutcheon on the sliding drawer front
  const fingerPull = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.018, 0.006),
    mats.antiqueBrass
  );
  fingerPull.name = `${namePrefix}.slidingOakDrawer.fingerPull`;
  fingerPull.position.set(0, 0.008, drawerD * 0.5 + 0.001);
  drawerGroup.add(fingerPull);

  const drawerBase = new THREE.Mesh(
    new THREE.BoxGeometry(drawerW - 0.024, 0.01, drawerD - 0.02),
    mats.drawerFelt
  );
  drawerBase.name = `${namePrefix}.slidingOakDrawer.feltBase`;
  drawerBase.position.set(0, -drawerH * 0.5 + 0.008, -0.004);
  drawerGroup.add(drawerBase);

  for (const sX of [-1, 1] as const) {
    const side = new THREE.Mesh(
      new THREE.BoxGeometry(0.014, drawerH - 0.01, drawerD - 0.018),
      mats.oakBody
    );
    side.name = `${namePrefix}.slidingOakDrawer.side.${sX < 0 ? 'left' : 'right'}`;
    side.position.set(sX * (drawerW * 0.5 - 0.009), -0.003, -0.004);
    drawerGroup.add(side);
  }
  const drawerBack = new THREE.Mesh(
    new THREE.BoxGeometry(drawerW - 0.024, drawerH - 0.012, 0.014),
    mats.oakBody
  );
  drawerBack.name = `${namePrefix}.slidingOakDrawer.back`;
  drawerBack.position.set(0, -0.003, -drawerD * 0.5 + 0.01);
  drawerGroup.add(drawerBack);

  // Sommelier brass corkscrew & cocktail jigger inside the sliding bar drawer
  const jigger = new THREE.Mesh(
    new THREE.CylinderGeometry(0.016, 0.011, 0.078, 12),
    mats.antiqueBrass
  );
  jigger.name = `${namePrefix}.slidingOakDrawer.brassJigger`;
  jigger.rotation.z = Math.PI / 2;
  jigger.position.set(-0.14, -drawerH * 0.5 + 0.024, 0.04);
  drawerGroup.add(jigger);

  const corkscrew = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.008, 0.125, 10),
    mats.antiqueBrass
  );
  corkscrew.name = `${namePrefix}.slidingOakDrawer.sommelierCorkscrew`;
  corkscrew.rotation.z = Math.PI / 2;
  corkscrew.position.set(0.12, -drawerH * 0.5 + 0.02, 0.045);
  drawerGroup.add(corkscrew);

  cabinetGroup.add(drawerGroup);
  ctx.interactions.registerSlidingDrawer(drawerGroup, new THREE.Vector3(0, 0, 0.22));

  // =========================================================================
  // 5. WRAP-AROUND BOX DOORS (`165mm` deep, `R = 115mm` curved reeded stiles,
  //    two stacked concentric diamond-reeded marquetry panels per leaf,
  //    cast 4-way pyramid brass handles & 3 oak + brass inside-of-door bar racks)
  // =========================================================================
  const buildBoxDoorLeaf = (sideSign: -1 | 1, doorBottleStartIndex: number): THREE.Group => {
    const sideLabel = sideSign < 0 ? 'left' : 'right';
    const doorGroup = new THREE.Group();
    doorGroup.name = `${namePrefix}.${sideLabel}Door`;
    // Positioned directly at the outer hinge axis (`x = ±0.469, y = 0.564, z = 0.087`)
    doorGroup.position.set(sideSign * outerHalfW, bodyMidY, 0.087);

    const doorH = bodyH - 0.006; // 1.002m
    const leafW = outerHalfW - 0.0015; // 0.4675m (`2mm` center gap)
    const boxD = 0.15; // z_rel = 0.000 .. +0.150m -> world localZ = 0.087 .. 0.237m
    const cornerR = 0.115;
    const flatW = leafW - cornerR; // ~0.3525m flat front marquetry leaf

    // Coordinates inside `doorGroup`:
    // Hinge is at `(x = 0, y = 0, z = 0)`.
    // Inward toward center gap is `-sideSign * x` (`x` from `0` to `-sideSign * leafW`).
    const inward = -sideSign;
    const xOuter = 0;
    const xCurveEnd = inward * cornerR;
    const xLatch = inward * leafW;
    const xFlatCenter = (xCurveEnd + xLatch) * 0.5;

    // 5A. Curved quarter-cylinder oak corner shell (`R = 115mm`) + straight 35mm return + flat front leaf + latch stile + top/bottom caps
    const arcCenterX = inward * cornerR;
    const arcCenterZ = boxD - cornerR; // 0.035m
    const thetaStart = sideSign > 0 ? 0 : Math.PI * 1.5;

    // Straight 35mm side cheek extension from hinge `z = 0` to `z = 0.035m`
    const sideReturn = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, doorH, arcCenterZ),
      mats.oakBody
    );
    sideReturn.name = `${doorGroup.name}.sideReturn`;
    sideReturn.position.set(inward * 0.01, 0, arcCenterZ * 0.5);
    sideReturn.castShadow = true;
    doorGroup.add(sideReturn);

    // Watertight 20mm-thick curved quarter-annulus oak wall (visible cleanly from BOTH exterior & open interior!)
    const rOuter = cornerR - 0.001;
    const rInner = cornerR - 0.021;
    const arcShape = new THREE.Shape();
    if (sideSign > 0) {
      arcShape.moveTo(rOuter, 0);
      arcShape.absarc(0, 0, rOuter, 0, -Math.PI * 0.5, true);
      arcShape.lineTo(0, -rInner);
      arcShape.absarc(0, 0, rInner, -Math.PI * 0.5, 0, false);
    } else {
      arcShape.moveTo(-rOuter, 0);
      arcShape.absarc(0, 0, rOuter, Math.PI, Math.PI * 1.5, false);
      arcShape.lineTo(0, -rInner);
      arcShape.absarc(0, 0, rInner, Math.PI * 1.5, Math.PI, true);
    }
    arcShape.closePath();
    const curvedShellGeo = new THREE.ExtrudeGeometry(arcShape, {
      depth: doorH,
      bevelEnabled: false,
      curveSegments: 20,
    });
    curvedShellGeo.rotateX(-Math.PI * 0.5);
    curvedShellGeo.translate(0, -doorH * 0.5, 0);
    void thetaStart;
    const curvedShell = new THREE.Mesh(curvedShellGeo, mats.oakBody);
    curvedShell.name = `${doorGroup.name}.curvedCornerStile`;
    curvedShell.position.set(arcCenterX, 0, arcCenterZ);
    curvedShell.castShadow = true;
    curvedShell.receiveShadow = true;
    doorGroup.add(curvedShell);

    // Carve interior pocket visually by adding crisp oak inner box frame (`topCap`, `bottomCap`, `latchStile`, `frontPanelSlab`)
    const frontSlab = new THREE.Mesh(
      new THREE.BoxGeometry(flatW, doorH, 0.02),
      mats.oakBody
    );
    frontSlab.name = `${doorGroup.name}.frontLeafSlab`;
    frontSlab.position.set(xFlatCenter, 0, boxD - 0.01);
    frontSlab.castShadow = true;
    frontSlab.receiveShadow = true;
    doorGroup.add(frontSlab);

    const latchStile = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, doorH, boxD),
      mats.oakBody
    );
    latchStile.name = `${doorGroup.name}.centerLatchStile`;
    latchStile.position.set(xLatch - inward * 0.01, 0, boxD * 0.5);
    latchStile.castShadow = true;
    doorGroup.add(latchStile);

    for (const [capLabel, cy] of [
      ['topCap', doorH * 0.5 - 0.011],
      ['bottomCap', -doorH * 0.5 + 0.011],
    ] as const) {
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(leafW - 0.03, 0.022, boxD - 0.016),
        mats.oakBody
      );
      cap.name = `${doorGroup.name}.${capLabel}`;
      cap.position.set(inward * (leafW * 0.5 + 0.01), cy, boxD * 0.5);
      doorGroup.add(cap);
    }

    // 5B. Merged 3D Reeded Oak Work: 27 horizontal curved corner flutes + 2 stacked concentric diamond-reeded marquetry panels
    const doorReedGeos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < numReeds; i++) {
      const ry = -doorH * 0.5 + 0.005 + (i + 0.5) * reedPitchY;
      // Straight 35mm flute lead-in from hinge
      const leadG = new THREE.CylinderGeometry(
        reedRadius,
        reedRadius,
        arcCenterZ,
        6,
        1,
        false,
        sideSign > 0 ? 0 : Math.PI,
        Math.PI
      );
      leadG.rotateX(Math.PI / 2);
      leadG.scale(0.55, 1, 1);
      leadG.translate(xOuter, ry, arcCenterZ * 0.5);
      doorReedGeos.push(leadG);

      // 90° quarter-torus horizontal oak rib wrapping around the `R = 115mm` corner stile
      const torus = new THREE.TorusGeometry(cornerR, reedRadius * 0.62, 7, 16, Math.PI * 0.5);
      torus.rotateX(Math.PI / 2);
      if (sideSign < 0) {
        torus.rotateY(-Math.PI * 0.5);
      }
      torus.translate(arcCenterX, ry, arcCenterZ);
      doorReedGeos.push(torus);
    }

    // Two stacked concentric diamond-reeded marquetry panels on the flat front face (`z = boxD`)
    const marquetryW = flatW - 0.026;
    const marquetryH = (doorH - 0.056) * 0.5;
    collectConcentricDiamondReededPanelGeos(
      doorReedGeos,
      xFlatCenter,
      marquetryH * 0.5 + 0.008,
      boxD,
      marquetryW,
      marquetryH
    );
    collectConcentricDiamondReededPanelGeos(
      doorReedGeos,
      xFlatCenter,
      -(marquetryH * 0.5 + 0.008),
      boxD,
      marquetryW,
      marquetryH
    );

    const doorReedsMesh = new THREE.Mesh(mergeGeometries(doorReedGeos), mats.oakReed);
    doorReedsMesh.name = `${doorGroup.name}.diamondReededMarquetry`;
    doorReedsMesh.castShadow = true;
    doorReedsMesh.receiveShadow = true;
    doorGroup.add(doorReedsMesh);

    // 5C. Cast Antique-Brass 4-Way Pyramid/Diamond Relief Handle at `Y = 0.615m` (`y_rel = 0.051m`), protruding to `z_rel = 0.168m` (`localZ = 0.255m`)
    const handle = buildKingsleyBrassHandle(`${doorGroup.name}.pyramidBrassHandle`, sideSign, mats);
    handle.position.set(xLatch - inward * 0.025, 0.051, boxD);
    doorGroup.add(handle);

    // 5D. Inside-of-Door Bar & Wine Racks (`3` oak shelves + `3` Ø8mm antique-brass guard rails per door!)
    const rackW = leafW - 0.068; // ~0.40m clear inside pocket
    const rackCenterX = inward * (leafW * 0.5 + 0.012);
    const rackDepth = 0.104;
    const rackCenterZ = 0.078; // z_rel = 0.026 .. 0.130m (clears carcass `z_rel <= -0.002m` by 28mm!)
    const railZ = 0.026;

    const shelfLevels = [
      { label: 'lowerWineWell', shelfY: -doorH * 0.5 + 0.028, railY: -doorH * 0.5 + 0.135 },
      { label: 'middleSpiritRack', shelfY: -0.035, railY: 0.048 },
      { label: 'upperTumblerRack', shelfY: 0.245, railY: 0.312 },
    ] as const;

    const railGeo = new THREE.CylinderGeometry(0.004, 0.004, rackW, 10);
    railGeo.rotateZ(Math.PI / 2);
    const postGeo = new THREE.CylinderGeometry(0.004, 0.004, 0.024, 8);
    postGeo.rotateX(Math.PI / 2);

    for (const tier of shelfLevels) {
      const shelf = new THREE.Mesh(
        new THREE.BoxGeometry(rackW, 0.014, rackDepth),
        mats.oakBody
      );
      shelf.name = `${doorGroup.name}.${tier.label}.oakShelf`;
      shelf.position.set(rackCenterX, tier.shelfY, rackCenterZ);
      doorGroup.add(shelf);

      const guardRail = new THREE.Mesh(railGeo, mats.antiqueBrass);
      guardRail.name = `${doorGroup.name}.${tier.label}.brassGuardRail`;
      guardRail.position.set(rackCenterX, tier.railY, railZ);
      doorGroup.add(guardRail);

      for (const endSign of [-1, 1] as const) {
        const post = new THREE.Mesh(postGeo, mats.antiqueBrass);
        post.name = `${doorGroup.name}.${tier.label}.brassRailMount.${endSign < 0 ? 1 : 2}`;
        post.position.set(rackCenterX + endSign * (rackW * 0.5 - 0.012), tier.railY, railZ + 0.012);
        doorGroup.add(post);
      }
    }

    // Lower door bottle well: 4 upright 750ml wine & champagne bottles per door (8 upright door wine bottles total!)
    const lowerTopY = shelfLevels[0].shelfY + 0.007;
    const doorVarietals: readonly KingsleyWineVarietal[] = [
      'champagne',
      'bordeaux',
      'burgundy',
      'bordeaux',
    ];
    for (let b = 0; b < 4; b++) {
      const bx = rackCenterX + (b - 1.5) * 0.092;
      const uprightWine = buildStockedUprightWineBottle(
        `${namePrefix}.doorWineBottle.${doorBottleStartIndex + b}`,
        doorVarietals[b]!,
        mats
      );
      uprightWine.position.set(bx, lowerTopY, rackCenterZ);
      doorGroup.add(uprightWine);
    }

    // Middle door rack: artisanal gin & single-malt spirit bottles
    const midRackTopY = shelfLevels[1].shelfY + 0.007;
    for (const [sIdx, sx, variant] of [
      [1, rackCenterX - 0.1, 'botanicalGin'],
      [2, rackCenterX + 0.095, 'singleMalt'],
    ] as const) {
      const spirit = buildArtisanalSpiritBottle(
        `${doorGroup.name}.spiritBottle.${sIdx}`,
        variant
      );
      spirit.scale.setScalar(0.86);
      spirit.position.set(sx, midRackTopY, rackCenterZ);
      doorGroup.add(spirit);
    }

    // Upper door rack: 3 cut-crystal Old Fashioned rocks tumblers
    const upperRackTopY = shelfLevels[2].shelfY + 0.007;
    for (let t = 0; t < 3; t++) {
      const tumbler = applySparklingCrystal(buildCrystalRocksTumbler(`${doorGroup.name}.doorTumbler.${t + 1}`));
      tumbler.scale.setScalar(0.9);
      tumbler.position.set(rackCenterX + (t - 1) * 0.11, upperRackTopY, rackCenterZ);
      doorGroup.add(tumbler);
    }

    return doorGroup;
  };

  const leftDoorGroup = buildBoxDoorLeaf(-1, 1);
  const rightDoorGroup = buildBoxDoorLeaf(1, 5);
  cabinetGroup.add(leftDoorGroup);
  cabinetGroup.add(rightDoorGroup);

  // Register interactive double doors (`±106°` = `±1.85 rad`) and link them so clicking either opens both!
  const leftDoorPivot = ctx.interactions.registerHingedDoor(
    cabinetGroup,
    leftDoorGroup,
    new THREE.Vector3(0, 0, 0),
    'y',
    -1.85,
    0
  );
  leftDoorPivot.name = `${namePrefix}.leftDoorPivot`;

  const rightDoorPivot = ctx.interactions.registerHingedDoor(
    cabinetGroup,
    rightDoorGroup,
    new THREE.Vector3(0, 0, 0),
    'y',
    1.85,
    0
  );
  rightDoorPivot.name = `${namePrefix}.rightDoorPivot`;

  ctx.interactions.linkDoorPair(leftDoorPivot, rightDoorPivot);

  ctx.scene.add(cabinetGroup);

  // =========================================================================
  // 6. TASTEFULLY STYLED MARBLE-TOP SERVING TRAY (`Y = 1.100m`, sibling group
  //    so `familyRoom.kingsleyBarCabinet` preserves exact `1.10 × 0.95 × 0.51m` bounds!)
  // =========================================================================
  let topTrayGroup: THREE.Group | null = null;
  if (includeTopServingTray) {
    topTrayGroup = new THREE.Group();
    topTrayGroup.name = `${namePrefix}.topTray`;
    topTrayGroup.userData = {
      ...topTrayGroup.userData,
      zone: zoneId,
      zoneId,
    };
    topTrayGroup.position.set(position[0], position[1] + 1.1, position[2]);
    topTrayGroup.rotation.y = rotationY;

    const trayW = 0.36;
    const trayD = 0.23;
    const trayBase = new THREE.Mesh(
      new THREE.BoxGeometry(trayW, 0.005, trayD),
      mats.antiqueBrass
    );
    trayBase.name = `${namePrefix}.topTray.brassBase`;
    trayBase.position.set(-0.08, 0.0025, -0.02);
    trayBase.castShadow = true;
    trayBase.receiveShadow = true;
    topTrayGroup.add(trayBase);

    for (const [rx, rz, rw, rd] of [
      [-0.08, -0.02 - trayD * 0.5 + 0.003, trayW, 0.006],
      [-0.08, -0.02 + trayD * 0.5 - 0.003, trayW, 0.006],
      [-0.08 - trayW * 0.5 + 0.003, -0.02, 0.006, trayD - 0.012],
      [-0.08 + trayW * 0.5 - 0.003, -0.02, 0.006, trayD - 0.012],
    ] as const) {
      const rim = new THREE.Mesh(new THREE.BoxGeometry(rw, 0.018, rd), mats.antiqueBrass);
      rim.name = `${namePrefix}.topTray.galleryRim`;
      rim.position.set(rx, 0.011, rz);
      topTrayGroup.add(rim);
    }

    const topDecanter = applySparklingCrystal(buildCrystalWhiskyDecanter(`${namePrefix}.topTray.crystalDecanter`));
    topDecanter.position.set(-0.18, 0.005, -0.03);
    topTrayGroup.add(topDecanter);

    const topWineBottle = buildStockedUprightWineBottle(
      `${namePrefix}.topTray.wineBottle`,
      'bordeaux',
      mats
    );
    topWineBottle.position.set(-0.075, 0.005, -0.055);
    topTrayGroup.add(topWineBottle);

    for (const [gIdx, gx, gz] of [
      [1, 0.015, -0.045],
      [2, 0.055, 0.025],
    ] as const) {
      const stemGlass = applySparklingCrystal(buildCrystalBordeauxGlass(`${namePrefix}.topTray.stemmedGlass.${gIdx}`));
      stemGlass.position.set(gx, 0.005, gz);
      topTrayGroup.add(stemGlass);
    }

    ctx.scene.add(topTrayGroup);
  }

  attachAssetMetadata(cabinetGroup, {
    name: 'Soho Home Kingsley Diamond-Reeded Oak & Emperador Marble Bar Cabinet',
    brand: 'Soho Home',
    collection: 'Kingsley (180 House)',
    sku: 'SH-KNG-BAR-1040',
    finish: 'Quarter-Sawn Smoked Oak, Grey Emperador Marble & Antiqued Brass',
    category: 'furniture',
    dimensionsMm: [1040, 520, 1520],
    productUrl: 'https://www.sohohome.com/products/kingsley-bar-cabinet',
    schematicUrl: 'https://www.sohohome.com/downloads/spec/Kingsley-Bar-Cabinet-Tearsheet.pdf',
  });

  return {
    cabinetGroup,
    topTrayGroup,
    leftDoorPivot,
    rightDoorPivot,
    drawerGroup,
  };
}
