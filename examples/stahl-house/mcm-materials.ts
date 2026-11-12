import * as THREE from 'three';
import { applyMetricBoxUVs, getOrCreateCachedTexture } from 'husjs/materials';
import { prepGeo } from 'husjs/objects';

function hash2(ix: number, iy: number, seed: number): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function vnoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm2(x: number, y: number, seed: number): number {
  return (
    vnoise(x, y, seed) * 0.55 +
    vnoise(x * 2.07, y * 2.07, seed + 31) * 0.28 +
    vnoise(x * 4.31, y * 4.31, seed + 73) * 0.17
  );
}

interface PbrBundle {
  readonly map: THREE.DataTexture;
  readonly normalMap: THREE.DataTexture;
  readonly roughnessMap: THREE.DataTexture;
}

function buildPbrDataBundle(
  key: string,
  size: number,
  normalScale: number,
  repeat: readonly [number, number],
  sample: (u: number, v: number, x: number, y: number) => {
    readonly r: number;
    readonly g: number;
    readonly b: number;
    readonly h: number;
    readonly rough: number;
  }
): PbrBundle {
  return getOrCreateCachedTexture(key, () => {
    const colorData = new Uint8Array(size * size * 4);
    const normalData = new Uint8Array(size * size * 4);
    const roughData = new Uint8Array(size * size * 4);
    const heights = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const s = sample(u, v, x, y);
        heights[y * size + x] = s.h;
        const idx = (y * size + x) * 4;
        colorData[idx] = Math.max(0, Math.min(255, Math.round(s.r)));
        colorData[idx + 1] = Math.max(0, Math.min(255, Math.round(s.g)));
        colorData[idx + 2] = Math.max(0, Math.min(255, Math.round(s.b)));
        colorData[idx + 3] = 255;
        const rv = Math.max(8, Math.min(255, Math.round(s.rough * 255)));
        roughData[idx] = rv;
        roughData[idx + 1] = rv;
        roughData[idx + 2] = rv;
        roughData[idx + 3] = 255;
      }
    }

    for (let y = 0; y < size; y++) {
      const ym = (y - 1 + size) % size;
      const yp = (y + 1) % size;
      for (let x = 0; x < size; x++) {
        const xm = (x - 1 + size) % size;
        const xp = (x + 1) % size;
        const dx = (heights[y * size + xp]! - heights[y * size + xm]!) * normalScale;
        const dy = (heights[yp * size + x]! - heights[ym * size + x]!) * normalScale;
        const inv = 1 / Math.hypot(dx, dy, 1);
        const idx = (y * size + x) * 4;
        normalData[idx] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
        normalData[idx + 1] = Math.round((-dy * inv * 0.5 + 0.5) * 255);
        normalData[idx + 2] = Math.round((inv * 0.5 + 0.5) * 255);
        normalData[idx + 3] = 255;
      }
    }

    const cfg = (tex: THREE.DataTexture, srgb: boolean): THREE.DataTexture => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeat[0], repeat[1]);
      if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.needsUpdate = true;
      return tex;
    };

    return {
      map: cfg(new THREE.DataTexture(colorData, size, size, THREE.RGBAFormat), true),
      normalMap: cfg(new THREE.DataTexture(normalData, size, size, THREE.RGBAFormat), false),
      roughnessMap: cfg(new THREE.DataTexture(roughData, size, size, THREE.RGBAFormat), false),
    };
  });
}

function buildAlbedoTexture(
  key: string,
  size: number,
  paint: (u: number, v: number, x: number, y: number) => readonly [number, number, number]
): THREE.DataTexture {
  return getOrCreateCachedTexture(key, () => {
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const [r, g, b] = paint(x / size, v, x, y);
        const idx = (y * size + x) * 4;
        data[idx] = Math.max(0, Math.min(255, Math.round(r)));
        data[idx + 1] = Math.max(0, Math.min(255, Math.round(g)));
        data[idx + 2] = Math.max(0, Math.min(255, Math.round(b)));
        data[idx + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  });
}

export interface McmMaterials {
  readonly walnut: THREE.MeshStandardMaterial;
  readonly rosewood: THREE.MeshStandardMaterial;
  readonly travertine: THREE.MeshStandardMaterial;
  readonly shagWool: THREE.MeshStandardMaterial;
  readonly berberOat: THREE.MeshStandardMaterial;
  readonly boucleIvory: THREE.MeshStandardMaterial;
  readonly boucleCamel: THREE.MeshStandardMaterial;
  readonly blackLeather: THREE.MeshStandardMaterial;
  readonly saddleLeather: THREE.MeshStandardMaterial;
  readonly fiberglassParchment: THREE.MeshStandardMaterial;
  readonly fiberglassOchre: THREE.MeshStandardMaterial;
  readonly fiberglassSeafoam: THREE.MeshStandardMaterial;
  readonly formicaAqua: THREE.MeshStandardMaterial;
  readonly formicaMustard: THREE.MeshStandardMaterial;
  readonly formicaPersimmon: THREE.MeshStandardMaterial;
  readonly formicaWhite: THREE.MeshStandardMaterial;
  readonly formicaCharcoal: THREE.MeshStandardMaterial;
  readonly mosaicBlue: THREE.MeshStandardMaterial;
  readonly mosaicSand: THREE.MeshStandardMaterial;
  readonly brushedStainless: THREE.MeshStandardMaterial;
  readonly polishedChrome: THREE.MeshStandardMaterial;
  readonly satinBrass: THREE.MeshStandardMaterial;
  readonly blackenedSteel: THREE.MeshStandardMaterial;
  readonly dieCastAlum: THREE.MeshStandardMaterial;
  readonly porcelainWhite: THREE.MeshStandardMaterial;
  readonly opalGlass: THREE.MeshStandardMaterial;
  readonly flutedGlass: THREE.MeshPhysicalMaterial;
  readonly plateMirror: THREE.MeshStandardMaterial;
  readonly sheerCasement: THREE.MeshStandardMaterial;
  readonly bedspreadOat: THREE.MeshStandardMaterial;
  readonly throwOchre: THREE.MeshStandardMaterial;
  readonly throwOlive: THREE.MeshStandardMaterial;
  readonly throwStriped: THREE.MeshStandardMaterial;
  readonly pillowLinen: THREE.MeshStandardMaterial;
  readonly aaCoverMat: THREE.MeshStandardMaterial;
  readonly serigraphMat: THREE.MeshStandardMaterial;
  readonly ceramicTeal: THREE.MeshStandardMaterial;
  readonly ceramicTerracotta: THREE.MeshStandardMaterial;
  readonly muranoAmberGlass: THREE.MeshPhysicalMaterial;
  readonly vinylRecord: THREE.MeshStandardMaterial;
}

let cachedMcmMaterials: McmMaterials | null = null;

export function getMcmMaterials(): McmMaterials {
  if (cachedMcmMaterials) return cachedMcmMaterials;

  // Book-matched American black walnut (512x512 cathedral & straight grain + open pores)
  const walnutMaps = buildPbrDataBundle('stahl:mcm:walnut512', 512, 1.85, [1, 1], (u, v) => {
    const bu = Math.abs((u * 2) % 2 - 1); // Book-matched symmetry across panel seam
    const warp = fbm2(bu * 3.5, v * 2.2, 101) * 0.22;
    const ring = Math.sin((bu * 15.0 + warp * 8.5 + Math.sin(v * Math.PI * 2) * 0.45) * Math.PI);
    const fine = vnoise(bu * 95, v * 24, 113);
    const pore = vnoise(bu * 180, v * 42, 127) < 0.14 ? -0.18 : 0;
    const tone = 0.5 + 0.34 * ring + (fine - 0.5) * 0.22 + pore;
    return {
      r: 86 + tone * 46,
      g: 55 + tone * 32,
      b: 35 + tone * 21,
      h: Math.max(0, Math.min(1, 0.55 + ring * 0.12 + pore + (fine - 0.5) * 0.08)),
      rough: 0.38 - ring * 0.04 - pore * 0.22,
    };
  });

  // Molded Santos Palisander rosewood veneer for Eames 670/671 shells
  const rosewoodMaps = buildPbrDataBundle('stahl:mcm:rosewood256', 256, 1.5, [1, 1], (u, v) => {
    const swirl = fbm2(u * 4.2, v * 2.6, 211);
    const streak = Math.sin((u * 19.0 + swirl * 9.0) * Math.PI);
    const darkVein = Math.pow(Math.max(0, -streak), 2.2);
    const amber = Math.max(0, streak) * 0.5;
    return {
      r: 92 + amber * 64 - darkVein * 58,
      g: 42 + amber * 34 - darkVein * 28,
      b: 26 + amber * 18 - darkVein * 18,
      h: 0.52 + streak * 0.1,
      rough: 0.29 + darkVein * 0.06,
    };
  });

  // Vein-cut honed Roman travertine
  const travertineMaps = buildPbrDataBundle('stahl:mcm:travertine256', 256, 1.7, [1, 1], (u, v) => {
    const band = fbm2(u * 2.4, v * 11.5, 307);
    const vein = Math.sin((v * 14.0 + band * 2.8) * Math.PI);
    const pit = vnoise(u * 44, v * 140, 317) < 0.09 ? -0.24 : 0;
    const base = 218 + vein * 14 + (band - 0.5) * 18 + pit * 45;
    return {
      r: base + 8,
      g: base + 1,
      b: base - 14,
      h: Math.max(0, Math.min(1, 0.6 + vein * 0.08 + pit)),
      rough: 0.42 - pit * 0.35,
    };
  });

  // High-pile warm ivory shag wool rug
  const shagMaps = buildPbrDataBundle('stahl:mcm:shag256', 256, 2.8, [6, 6], (u, v) => {
    const tuftA = vnoise(u * 46, v * 46, 401);
    const tuftB = vnoise(u * 92 + 3.1, v * 88 + 1.7, 419);
    const curl = fbm2(u * 18, v * 18, 433);
    const h = 0.35 + tuftA * 0.38 + tuftB * 0.27;
    const shade = 224 + (tuftA - 0.5) * 24 + (curl - 0.5) * 18 + (tuftB - 0.5) * 14;
    return {
      r: shade + 6,
      g: shade + 2,
      b: shade - 10,
      h,
      rough: 0.93 + (0.5 - tuftA) * 0.05,
    };
  });

  // Flat-weave oat Berber wool rug for Master & Bedroom 2
  const berberMaps = buildPbrDataBundle('stahl:mcm:berber256', 256, 2.1, [8, 8], (u, v) => {
    const loopX = Math.abs(Math.sin(u * Math.PI * 64));
    const loopY = Math.abs(Math.sin(v * Math.PI * 48));
    const fleck = vnoise(u * 70, v * 70, 461);
    const loop = loopX * 0.55 + loopY * 0.45;
    const c = 198 + loop * 22 + (fleck - 0.5) * 26;
    return {
      r: c + 7,
      g: c + 1,
      b: c - 13,
      h: 0.4 + loop * 0.42,
      rough: 0.91,
    };
  });

  // Nubby mid-century bouclé wool upholstery (warm ivory & camel variants)
  const boucleMaps = buildPbrDataBundle('stahl:mcm:boucle256', 256, 2.2, [7, 7], (u, v) => {
    const warp = Math.abs(Math.sin(u * Math.PI * 72));
    const weft = Math.abs(Math.sin(v * Math.PI * 72));
    const slub = vnoise(u * 54, v * 54, 503);
    const h = 0.35 + (warp * 0.5 + weft * 0.5) * 0.38 + slub * 0.25;
    const lum = 212 + (h - 0.5) * 34;
    return {
      r: lum + 6,
      g: lum + 1,
      b: lum - 11,
      h,
      rough: 0.87 + (0.5 - slub) * 0.08,
    };
  });

  // Fine pebble-grain aniline leather
  const leatherMaps = buildPbrDataBundle('stahl:mcm:leather256', 256, 1.35, [5, 5], (u, v) => {
    const p1 = vnoise(u * 84, v * 84, 607);
    const p2 = vnoise(u * 156, v * 156, 619);
    const h = 0.45 + p1 * 0.35 + p2 * 0.2;
    return {
      r: 30 + h * 14,
      g: 29 + h * 14,
      b: 30 + h * 15,
      h,
      rough: 0.36 + (1 - h) * 0.14,
    };
  });

  // 1960s 2"x2" glazed ceramic mosaic tile (Bath Core walls, floor & sunken Roman tub)
  const createMosaic = (key: string, baseRgb: readonly [number, number, number], seed: number): PbrBundle =>
    buildPbrDataBundle(key, 256, 2.4, [1, 1], (u, v) => {
      const cells = 16; // 16 tiles per 0.81m repeat -> ~50mm (2") square ceramic mosaic!
      const cu = (u * cells) % 1;
      const cv = (v * cells) % 1;
      const ix = Math.floor(u * cells);
      const iy = Math.floor(v * cells);
      const edge = Math.min(cu, 1 - cu, cv, 1 - cv);
      const isGrout = edge < 0.065;
      const varTone = (hash2(ix, iy, seed) - 0.5) * 18;
      if (isGrout) {
        return { r: 214, g: 211, b: 203, h: 0.18, rough: 0.86 };
      }
      const pillow = Math.min(1, edge * 7.5);
      return {
        r: baseRgb[0] + varTone,
        g: baseRgb[1] + varTone * 0.9,
        b: baseRgb[2] + varTone * 0.85,
        h: 0.55 + pillow * 0.35,
        rough: 0.19 + (hash2(ix, iy, seed + 17) - 0.5) * 0.05,
      };
    });

  const mosaicBlueMaps = createMosaic('stahl:mcm:mosaicBlue256', [106, 166, 178], 701);
  const mosaicSandMaps = createMosaic('stahl:mcm:mosaicSand256', [208, 199, 181], 733);

  // Brushed 304 stainless steel (Thermador ovens, fridge, cooktop & Lyoncraft double sink)
  const stainlessMaps = buildPbrDataBundle('stahl:mcm:stainless256', 256, 0.9, [2, 2], (u, v) => {
    const brush = vnoise(u * 14, v * 220, 809) * 0.65 + vnoise(u * 28, v * 410, 821) * 0.35;
    const c = 198 + (brush - 0.5) * 24;
    return { r: c, g: c + 2, b: c + 5, h: 0.45 + brush * 0.2, rough: 0.26 + (brush - 0.5) * 0.08 };
  });

  // Fluted architectural glass normal map for sunken shower bypass doors
  const flutedMaps = buildPbrDataBundle('stahl:mcm:flutedGlass256', 256, 2.6, [3, 1], (u) => {
    const wave = 0.5 + 0.5 * Math.sin(u * Math.PI * 48);
    return { r: 232, g: 243, b: 245, h: wave, rough: 0.18 };
  });

  // Striped geometric throw blanket for Bedroom 2
  const stripedMap = buildAlbedoTexture('stahl:mcm:stripedThrow128', 128, (u, v) => {
    const band = (v * 10) % 1;
    const weave = (vnoise(u * 80, v * 80, 907) - 0.5) * 14;
    if (band < 0.32) return [214 + weave, 154 + weave, 54 + weave]; // Mustard ochre
    if (band < 0.46) return [236 + weave, 230 + weave, 216 + weave]; // Ivory
    if (band < 0.74) return [88 + weave, 148 + weave, 152 + weave]; // Koenig aqua
    if (band < 0.88) return [204 + weave, 96 + weave, 62 + weave]; // Persimmon
    return [62 + weave, 54 + weave, 46 + weave]; // Espresso charcoal
  });
  stripedMap.wrapS = stripedMap.wrapT = THREE.RepeatWrapping;

  // Arts & Architecture June 1960 cover graphic (Case Study House #22 issue!)
  const aaCoverMap = buildAlbedoTexture('stahl:mcm:aaCover128', 128, (u, v) => {
    if (v > 0.82) return [238, 234, 224]; // Masthead band
    if (u < 0.07 || u > 0.93 || v < 0.06) return [238, 234, 224];
    // Iconic architectural black/blue/ochre modernist block composition
    if (u < 0.54 && v > 0.36) return [28, 34, 42];
    if (u >= 0.54 && v > 0.52) return [74, 142, 158];
    if (v <= 0.36 && u > 0.34) return [212, 148, 48];
    return [205, 88, 56];
  });

  // California Hard-Edge Geometric Serigraph (Karl Benjamin / John McLaughlin 1960 homage)
  const serigraphMap = buildAlbedoTexture('stahl:mcm:serigraph256', 256, (u, v) => {
    if (u < 0.06 || u > 0.94 || v < 0.06 || v > 0.94) return [242, 238, 229]; // Crisp mat board
    const iu = (u - 0.06) / 0.88;
    const iv = (v - 0.06) / 0.88;
    if (iu < 0.34) return iv > 0.42 ? [34, 38, 44] : [214, 156, 52];
    if (iu < 0.68) {
      if (iv > 0.68) return [208, 94, 58];
      if (iv > 0.28) return [238, 233, 220];
      return [86, 150, 156];
    }
    return iv > 0.52 ? [86, 150, 156] : [34, 38, 44];
  });

  cachedMcmMaterials = {
    walnut: new THREE.MeshStandardMaterial({
      map: walnutMaps.map,
      normalMap: walnutMaps.normalMap,
      normalScale: new THREE.Vector2(0.45, 0.45),
      roughnessMap: walnutMaps.roughnessMap,
      roughness: 0.42,
      metalness: 0.03,
    }),
    rosewood: new THREE.MeshStandardMaterial({
      map: rosewoodMaps.map,
      normalMap: rosewoodMaps.normalMap,
      normalScale: new THREE.Vector2(0.35, 0.35),
      roughnessMap: rosewoodMaps.roughnessMap,
      roughness: 0.3,
      metalness: 0.04,
    }),
    travertine: new THREE.MeshStandardMaterial({
      map: travertineMaps.map,
      normalMap: travertineMaps.normalMap,
      normalScale: new THREE.Vector2(0.4, 0.4),
      roughnessMap: travertineMaps.roughnessMap,
      roughness: 0.44,
      metalness: 0.02,
    }),
    shagWool: new THREE.MeshStandardMaterial({
      map: shagMaps.map,
      normalMap: shagMaps.normalMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughnessMap: shagMaps.roughnessMap,
      roughness: 0.95,
    }),
    berberOat: new THREE.MeshStandardMaterial({
      map: berberMaps.map,
      normalMap: berberMaps.normalMap,
      normalScale: new THREE.Vector2(0.65, 0.65),
      roughnessMap: berberMaps.roughnessMap,
      roughness: 0.92,
    }),
    boucleIvory: new THREE.MeshStandardMaterial({
      color: 0xf4efe4,
      map: boucleMaps.map,
      normalMap: boucleMaps.normalMap,
      normalScale: new THREE.Vector2(0.6, 0.6),
      roughnessMap: boucleMaps.roughnessMap,
      roughness: 0.88,
    }),
    boucleCamel: new THREE.MeshStandardMaterial({
      color: 0xd2bc9b,
      map: boucleMaps.map,
      normalMap: boucleMaps.normalMap,
      normalScale: new THREE.Vector2(0.6, 0.6),
      roughnessMap: boucleMaps.roughnessMap,
      roughness: 0.88,
    }),
    blackLeather: new THREE.MeshStandardMaterial({
      map: leatherMaps.map,
      normalMap: leatherMaps.normalMap,
      normalScale: new THREE.Vector2(0.35, 0.35),
      roughnessMap: leatherMaps.roughnessMap,
      roughness: 0.36,
      metalness: 0.04,
    }),
    saddleLeather: new THREE.MeshStandardMaterial({
      color: 0xb66e3d,
      normalMap: leatherMaps.normalMap,
      normalScale: new THREE.Vector2(0.35, 0.35),
      roughness: 0.4,
      metalness: 0.03,
    }),
    fiberglassParchment: new THREE.MeshStandardMaterial({ color: 0xebe6da, roughness: 0.36, metalness: 0.04 }),
    fiberglassOchre: new THREE.MeshStandardMaterial({ color: 0xd69638, roughness: 0.38, metalness: 0.04 }),
    fiberglassSeafoam: new THREE.MeshStandardMaterial({ color: 0x6ea6a4, roughness: 0.38, metalness: 0.04 }),
    formicaAqua: new THREE.MeshStandardMaterial({ color: 0x5c9fa1, roughness: 0.3, metalness: 0.03 }),
    formicaMustard: new THREE.MeshStandardMaterial({ color: 0xd59c38, roughness: 0.3, metalness: 0.03 }),
    formicaPersimmon: new THREE.MeshStandardMaterial({ color: 0xd2623e, roughness: 0.3, metalness: 0.03 }),
    formicaWhite: new THREE.MeshStandardMaterial({ color: 0xf2eee3, roughness: 0.28, metalness: 0.03 }),
    formicaCharcoal: new THREE.MeshStandardMaterial({ color: 0x2d3135, roughness: 0.34, metalness: 0.05 }),
    mosaicBlue: new THREE.MeshStandardMaterial({
      map: mosaicBlueMaps.map,
      normalMap: mosaicBlueMaps.normalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughnessMap: mosaicBlueMaps.roughnessMap,
      roughness: 0.22,
    }),
    mosaicSand: new THREE.MeshStandardMaterial({
      map: mosaicSandMaps.map,
      normalMap: mosaicSandMaps.normalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughnessMap: mosaicSandMaps.roughnessMap,
      roughness: 0.24,
    }),
    brushedStainless: new THREE.MeshStandardMaterial({
      map: stainlessMaps.map,
      normalMap: stainlessMaps.normalMap,
      normalScale: new THREE.Vector2(0.25, 0.25),
      roughnessMap: stainlessMaps.roughnessMap,
      roughness: 0.26,
      metalness: 0.9,
    }),
    polishedChrome: new THREE.MeshStandardMaterial({ color: 0xe6eaee, roughness: 0.1, metalness: 0.96 }),
    satinBrass: new THREE.MeshStandardMaterial({ color: 0xd5af62, roughness: 0.24, metalness: 0.88 }),
    blackenedSteel: new THREE.MeshStandardMaterial({ color: 0x1e2124, roughness: 0.42, metalness: 0.74 }),
    dieCastAlum: new THREE.MeshStandardMaterial({ color: 0xd6dce0, roughness: 0.2, metalness: 0.9 }),
    porcelainWhite: new THREE.MeshStandardMaterial({ color: 0xf8f7f3, roughness: 0.13, metalness: 0.03 }),
    opalGlass: new THREE.MeshStandardMaterial({
      color: 0xfffaf0,
      emissive: new THREE.Color(0xffdfa8),
      emissiveIntensity: 0.0,
      roughness: 0.32,
    }),
    flutedGlass: new THREE.MeshPhysicalMaterial({
      color: 0xdff0f2,
      normalMap: flutedMaps.normalMap,
      normalScale: new THREE.Vector2(0.65, 0.65),
      transparent: true,
      opacity: 0.48,
      roughness: 0.2,
      metalness: 0.04,
      ior: 1.5,
    }),
    plateMirror: new THREE.MeshStandardMaterial({ color: 0xebf2f5, roughness: 0.03, metalness: 0.98 }),
    sheerCasement: new THREE.MeshStandardMaterial({
      color: 0xf3efe6,
      transparent: true,
      opacity: 0.62,
      roughness: 0.9,
      side: THREE.DoubleSide,
    }),
    bedspreadOat: new THREE.MeshStandardMaterial({
      color: 0xe6decb,
      normalMap: boucleMaps.normalMap,
      normalScale: new THREE.Vector2(0.35, 0.35),
      roughness: 0.88,
    }),
    throwOchre: new THREE.MeshStandardMaterial({
      color: 0xc88d32,
      normalMap: boucleMaps.normalMap,
      normalScale: new THREE.Vector2(0.4, 0.4),
      roughness: 0.86,
    }),
    throwOlive: new THREE.MeshStandardMaterial({
      color: 0x6f7a4e,
      normalMap: boucleMaps.normalMap,
      normalScale: new THREE.Vector2(0.4, 0.4),
      roughness: 0.86,
    }),
    throwStriped: new THREE.MeshStandardMaterial({
      map: stripedMap,
      normalMap: boucleMaps.normalMap,
      normalScale: new THREE.Vector2(0.35, 0.35),
      roughness: 0.86,
    }),
    pillowLinen: new THREE.MeshStandardMaterial({ color: 0xf5f1e7, roughness: 0.84 }),
    aaCoverMat: new THREE.MeshStandardMaterial({ map: aaCoverMap, roughness: 0.36 }),
    serigraphMat: new THREE.MeshStandardMaterial({ map: serigraphMap, roughness: 0.52 }),
    ceramicTeal: new THREE.MeshStandardMaterial({ color: 0x3b7d84, roughness: 0.24, metalness: 0.05 }),
    ceramicTerracotta: new THREE.MeshStandardMaterial({ color: 0xb85d3b, roughness: 0.62 }),
    muranoAmberGlass: new THREE.MeshPhysicalMaterial({
      color: 0xd9872a,
      transparent: true,
      opacity: 0.76,
      roughness: 0.08,
      ior: 1.52,
    }),
    vinylRecord: new THREE.MeshStandardMaterial({ color: 0x141517, roughness: 0.22, metalness: 0.15 }),
  };

  return cachedMcmMaterials;
}

/** Creates a `prepGeo` BoxGeometry with 1:1 world-scale metric UVs (`tileW`, `tileH` in meters). */
export function metricBox(
  w: number,
  h: number,
  d: number,
  tileW = 0.85,
  tileH = 0.85
): THREE.BufferGeometry {
  return prepGeo(applyMetricBoxUVs(new THREE.BoxGeometry(w, h, d), { tileW, tileH }));
}
