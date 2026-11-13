import * as THREE from 'three';
import { applyMetricBoxUVs, getOrCreateCachedTexture } from 'husjs/materials';
import { prepGeo } from 'husjs/objects';
import {
  configureDataTex,
  getArchitecturalFinishPbr512,
  getCeramicTilePbr1024,
  getLeatherPbr1024,
  getRosewoodPbr1024,
  getShagWoolPbr1024,
  getTravertinePbr1024,
  getVinylYachtCordPbr512,
  getWalnutPbr1024,
  getWovenTextilePbr1024,
  hashCell2D,
} from './pbr-textures.ts';

function buildAlbedoTex(
  key: string,
  size: number,
  repeat: readonly [number, number],
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
    return configureDataTex(data, size, true, repeat);
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
  readonly stonewareWhite: THREE.MeshStandardMaterial;
  readonly vinylYachtCord: THREE.MeshStandardMaterial;
  readonly muranoAmberGlass: THREE.MeshPhysicalMaterial;
  readonly vinylRecord: THREE.MeshStandardMaterial;
}

let cachedMcmMaterials: McmMaterials | null = null;

export function getMcmMaterials(): McmMaterials {
  if (cachedMcmMaterials) return cachedMcmMaterials;

  const walnutMaps = getWalnutPbr1024();
  const rosewoodMaps = getRosewoodPbr1024();
  const travertineMaps = getTravertinePbr1024();
  const shagMaps = getShagWoolPbr1024();
  const berberMaps = getWovenTextilePbr1024('berber');
  const boucleMaps = getWovenTextilePbr1024('boucle');
  const linenMaps = getWovenTextilePbr1024('linen');
  const leatherMaps = getLeatherPbr1024();
  const mosaicBlueMaps = getCeramicTilePbr1024('bathBlue4x4');
  const mosaicSandMaps = getCeramicTilePbr1024('bathSand4x4');
  const stainlessMaps = getArchitecturalFinishPbr512('brushedStainless');
  const alumMaps = getArchitecturalFinishPbr512('anodizedAlum');
  const steelMaps = getArchitecturalFinishPbr512('paintedSteel');
  const fiberglassMaps = getArchitecturalFinishPbr512('moldedFiberglass');
  const plasterMaps = getArchitecturalFinishPbr512('plaster');
  const yachtCordMaps = getVinylYachtCordPbr512();

  // Fluted architectural glass normal map (512x512 crisp vertical reeds)
  const flutedNorm = getOrCreateCachedTexture('stahl:mcm:flutedNorm512', () => {
    const size = 512;
    const data = new Uint8Array(size * size * 4);
    for (let x = 0; x < size; x++) {
      const gx = Math.cos((x / size) * Math.PI * 2 * 32) * 0.85;
      const inv = 127.5 / Math.sqrt(gx * gx + 1);
      const nx = Math.max(0, Math.min(255, Math.round(-gx * inv + 127.5)));
      const nz = Math.max(0, Math.min(255, Math.round(inv + 127.5)));
      for (let y = 0; y < size; y++) {
        const idx = (y * size + x) * 4;
        data[idx] = nx;
        data[idx + 1] = 128;
        data[idx + 2] = nz;
        data[idx + 3] = 255;
      }
    }
    return configureDataTex(data, size, false, [3, 1]);
  });

  // Bubble-lamp silk-resin wire-ribbed normal map (512x512)
  const bubbleRibNorm = getOrCreateCachedTexture('stahl:mcm:bubbleRibNorm512', () => {
    const size = 512;
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      const gy = Math.cos((y / size) * Math.PI * 2 * 28) * 0.42;
      for (let x = 0; x < size; x++) {
        const gx = Math.cos((x / size) * Math.PI * 2 * 36) * 0.34;
        const inv = 127.5 / Math.sqrt(gx * gx + gy * gy + 1);
        const idx = (y * size + x) * 4;
        data[idx] = Math.round(-gx * inv + 127.5);
        data[idx + 1] = Math.round(-gy * inv + 127.5);
        data[idx + 2] = Math.round(inv + 127.5);
        data[idx + 3] = 255;
      }
    }
    return configureDataTex(data, size, false, [1, 1]);
  });

  // 512x512 hand-loomed California striped wool throw
  const stripedMap = buildAlbedoTex('stahl:mcm:stripedThrow512', 512, [2, 2], (_u, v, x, y) => {
    const band = (v * 8) % 1;
    const twill = ((x + y) & 3) === 0 ? 7 : -4;
    const grain = (hashCell2D(x >> 1, y >> 1, 907) - 0.5) * 12 + twill;
    if (band < 0.3) return [214 + grain, 154 + grain, 54 + grain];
    if (band < 0.45) return [237 + grain, 231 + grain, 217 + grain];
    if (band < 0.73) return [86 + grain, 148 + grain, 154 + grain];
    if (band < 0.87) return [205 + grain, 95 + grain, 61 + grain];
    return [58 + grain, 51 + grain, 44 + grain];
  });

  // 512x512 Arts & Architecture June 1960 cover graphic (Case Study House #22 issue)
  const aaCoverMap = buildAlbedoTex('stahl:mcm:aaCover512', 512, [1, 1], (u, v, x, y) => {
    const paper = (hashCell2D(x >> 1, y >> 1, 411) - 0.5) * 6;
    if (v > 0.83 || u < 0.06 || u > 0.94 || v < 0.05) {
      if (v > 0.88 && v < 0.93 && u > 0.1 && u < 0.78 && (x & 7) < 5) {
        return [32, 34, 36]; // Crisp masthead typography bar
      }
      return [240 + paper, 236 + paper, 226 + paper];
    }
    if (Math.abs(u - 0.54) < 0.008 || Math.abs(v - 0.36) < 0.008) {
      return [240 + paper, 236 + paper, 226 + paper];
    }
    if (u < 0.54 && v > 0.36) return [28 + paper, 34 + paper, 42 + paper];
    if (u >= 0.54 && v > 0.52) return [72 + paper, 143 + paper, 160 + paper];
    if (v <= 0.36 && u > 0.34) return [214 + paper, 149 + paper, 48 + paper];
    return [206 + paper, 88 + paper, 56 + paper];
  });

  // 512x512 California Hard-Edge Geometric Serigraph (Karl Benjamin / John McLaughlin 1960 homage)
  const serigraphMap = buildAlbedoTex('stahl:mcm:serigraph512', 512, [1, 1], (u, v, x, y) => {
    const tooth = (hashCell2D(x >> 1, y >> 1, 523) - 0.5) * 5;
    if (u < 0.065 || u > 0.935 || v < 0.065 || v > 0.935) {
      return [243 + tooth, 239 + tooth, 230 + tooth];
    }
    const iu = (u - 0.065) / 0.87;
    const iv = (v - 0.065) / 0.87;
    if (iu < 0.335) return iv > 0.42 ? [33 + tooth, 38 + tooth, 45 + tooth] : [215 + tooth, 156 + tooth, 52 + tooth];
    if (iu < 0.67) {
      if (iv > 0.68) return [208 + tooth, 93 + tooth, 57 + tooth];
      if (iv > 0.28) return [239 + tooth, 234 + tooth, 221 + tooth];
      return [84 + tooth, 150 + tooth, 157 + tooth];
    }
    return iv > 0.52 ? [84 + tooth, 150 + tooth, 157 + tooth] : [33 + tooth, 38 + tooth, 45 + tooth];
  });

  const makeFiberglass = (hex: number, rough: number): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({
      color: hex,
      normalMap: fiberglassMaps.normalMap,
      normalScale: new THREE.Vector2(0.22, 0.22),
      roughnessMap: fiberglassMaps.roughnessMap,
      roughness: rough,
      metalness: 0.04,
    });

  const makeFormica = (hex: number, rough = 0.28): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({
      color: hex,
      normalMap: steelMaps.normalMap,
      normalScale: new THREE.Vector2(0.08, 0.08),
      roughnessMap: steelMaps.roughnessMap,
      roughness: rough,
      metalness: 0.03,
    });

  cachedMcmMaterials = {
    walnut: new THREE.MeshStandardMaterial({
      map: walnutMaps.map,
      normalMap: walnutMaps.normalMap,
      normalScale: new THREE.Vector2(0.52, 0.52),
      roughnessMap: walnutMaps.roughnessMap,
      roughness: 0.4,
      metalness: 0.03,
    }),
    rosewood: new THREE.MeshStandardMaterial({
      map: rosewoodMaps.map,
      normalMap: rosewoodMaps.normalMap,
      normalScale: new THREE.Vector2(0.42, 0.42),
      roughnessMap: rosewoodMaps.roughnessMap,
      roughness: 0.32,
      metalness: 0.04,
    }),
    travertine: new THREE.MeshStandardMaterial({
      map: travertineMaps.map,
      normalMap: travertineMaps.normalMap,
      normalScale: new THREE.Vector2(0.48, 0.48),
      roughnessMap: travertineMaps.roughnessMap,
      roughness: 0.42,
      metalness: 0.02,
    }),
    shagWool: new THREE.MeshStandardMaterial({
      map: shagMaps.map,
      normalMap: shagMaps.normalMap,
      normalScale: new THREE.Vector2(0.95, 0.95),
      roughnessMap: shagMaps.roughnessMap,
      roughness: 0.95,
    }),
    berberOat: new THREE.MeshStandardMaterial({
      map: berberMaps.map,
      normalMap: berberMaps.normalMap,
      normalScale: new THREE.Vector2(0.7, 0.7),
      roughnessMap: berberMaps.roughnessMap,
      roughness: 0.92,
    }),
    boucleIvory: new THREE.MeshStandardMaterial({
      color: 0xf5f0e5,
      map: boucleMaps.map,
      normalMap: boucleMaps.normalMap,
      normalScale: new THREE.Vector2(0.68, 0.68),
      roughnessMap: boucleMaps.roughnessMap,
      roughness: 0.88,
    }),
    boucleCamel: new THREE.MeshStandardMaterial({
      color: 0xd3bd9c,
      map: boucleMaps.map,
      normalMap: boucleMaps.normalMap,
      normalScale: new THREE.Vector2(0.68, 0.68),
      roughnessMap: boucleMaps.roughnessMap,
      roughness: 0.88,
    }),
    blackLeather: new THREE.MeshStandardMaterial({
      map: leatherMaps.map,
      normalMap: leatherMaps.normalMap,
      normalScale: new THREE.Vector2(0.44, 0.44),
      roughnessMap: leatherMaps.roughnessMap,
      roughness: 0.38,
      metalness: 0.04,
    }),
    saddleLeather: new THREE.MeshStandardMaterial({
      color: 0xb76e3d,
      normalMap: leatherMaps.normalMap,
      normalScale: new THREE.Vector2(0.44, 0.44),
      roughnessMap: leatherMaps.roughnessMap,
      roughness: 0.42,
      metalness: 0.03,
    }),
    fiberglassParchment: makeFiberglass(0xebe6da, 0.34),
    fiberglassOchre: makeFiberglass(0xd69638, 0.36),
    fiberglassSeafoam: makeFiberglass(0x6ea6a4, 0.36),
    formicaAqua: makeFormica(0x5c9fa1, 0.28),
    formicaMustard: makeFormica(0xd59c38, 0.28),
    formicaPersimmon: makeFormica(0xd2623e, 0.28),
    formicaWhite: makeFormica(0xf2eee3, 0.26),
    formicaCharcoal: makeFormica(0x2d3135, 0.32),
    mosaicBlue: new THREE.MeshStandardMaterial({
      map: mosaicBlueMaps.map,
      normalMap: mosaicBlueMaps.normalMap,
      normalScale: new THREE.Vector2(0.65, 0.65),
      roughnessMap: mosaicBlueMaps.roughnessMap,
      roughness: 0.85,
      metalness: 0.04,
    }),
    mosaicSand: new THREE.MeshStandardMaterial({
      map: mosaicSandMaps.map,
      normalMap: mosaicSandMaps.normalMap,
      normalScale: new THREE.Vector2(0.65, 0.65),
      roughnessMap: mosaicSandMaps.roughnessMap,
      roughness: 0.85,
      metalness: 0.03,
    }),
    brushedStainless: new THREE.MeshStandardMaterial({
      map: stainlessMaps.map,
      normalMap: stainlessMaps.normalMap,
      normalScale: new THREE.Vector2(0.28, 0.28),
      roughnessMap: stainlessMaps.roughnessMap,
      roughness: 0.26,
      metalness: 0.91,
    }),
    polishedChrome: new THREE.MeshStandardMaterial({
      color: 0xe9eef2,
      normalMap: alumMaps.normalMap,
      normalScale: new THREE.Vector2(0.05, 0.05),
      roughness: 0.09,
      metalness: 0.97,
    }),
    satinBrass: new THREE.MeshStandardMaterial({
      color: 0xd6b064,
      normalMap: alumMaps.normalMap,
      normalScale: new THREE.Vector2(0.14, 0.14),
      roughnessMap: alumMaps.roughnessMap,
      roughness: 0.24,
      metalness: 0.89,
    }),
    blackenedSteel: new THREE.MeshStandardMaterial({
      color: 0x1e2124,
      normalMap: steelMaps.normalMap,
      normalScale: new THREE.Vector2(0.18, 0.18),
      roughnessMap: steelMaps.roughnessMap,
      roughness: 0.42,
      metalness: 0.76,
    }),
    dieCastAlum: new THREE.MeshStandardMaterial({
      color: 0xd8dee2,
      map: alumMaps.map,
      normalMap: alumMaps.normalMap,
      normalScale: new THREE.Vector2(0.2, 0.2),
      roughnessMap: alumMaps.roughnessMap,
      roughness: 0.22,
      metalness: 0.9,
    }),
    porcelainWhite: new THREE.MeshStandardMaterial({
      color: 0xf8f7f3,
      normalMap: steelMaps.normalMap,
      normalScale: new THREE.Vector2(0.04, 0.04),
      roughness: 0.12,
      metalness: 0.03,
    }),
    opalGlass: new THREE.MeshStandardMaterial({
      color: 0xfffaf0,
      emissive: new THREE.Color(0xffdfa8),
      emissiveIntensity: 0.0,
      normalMap: bubbleRibNorm,
      normalScale: new THREE.Vector2(0.22, 0.22),
      roughness: 0.34,
    }),
    flutedGlass: new THREE.MeshPhysicalMaterial({
      color: 0xdff0f2,
      normalMap: flutedNorm,
      normalScale: new THREE.Vector2(0.75, 0.75),
      transparent: true,
      opacity: 0.5,
      roughness: 0.18,
      metalness: 0.04,
      ior: 1.52,
    }),
    plateMirror: new THREE.MeshStandardMaterial({ color: 0xecf3f6, roughness: 0.03, metalness: 0.98 }),
    sheerCasement: new THREE.MeshStandardMaterial({
      color: 0xf4f0e7,
      map: linenMaps.map,
      normalMap: linenMaps.normalMap,
      normalScale: new THREE.Vector2(0.32, 0.32),
      transparent: true,
      opacity: 0.64,
      roughness: 0.88,
      side: THREE.DoubleSide,
    }),
    bedspreadOat: new THREE.MeshStandardMaterial({
      color: 0xe7dfcc,
      map: linenMaps.map,
      normalMap: boucleMaps.normalMap,
      normalScale: new THREE.Vector2(0.42, 0.42),
      roughnessMap: boucleMaps.roughnessMap,
      roughness: 0.88,
    }),
    throwOchre: new THREE.MeshStandardMaterial({
      color: 0xc98e33,
      normalMap: boucleMaps.normalMap,
      normalScale: new THREE.Vector2(0.48, 0.48),
      roughnessMap: boucleMaps.roughnessMap,
      roughness: 0.86,
    }),
    throwOlive: new THREE.MeshStandardMaterial({
      color: 0x6f7b4f,
      normalMap: boucleMaps.normalMap,
      normalScale: new THREE.Vector2(0.48, 0.48),
      roughnessMap: boucleMaps.roughnessMap,
      roughness: 0.86,
    }),
    throwStriped: new THREE.MeshStandardMaterial({
      map: stripedMap,
      normalMap: boucleMaps.normalMap,
      normalScale: new THREE.Vector2(0.42, 0.42),
      roughnessMap: boucleMaps.roughnessMap,
      roughness: 0.86,
    }),
    pillowLinen: new THREE.MeshStandardMaterial({
      color: 0xf6f2e8,
      map: linenMaps.map,
      normalMap: linenMaps.normalMap,
      normalScale: new THREE.Vector2(0.35, 0.35),
      roughnessMap: linenMaps.roughnessMap,
      roughness: 0.84,
    }),
    aaCoverMat: new THREE.MeshStandardMaterial({ map: aaCoverMap, roughness: 0.34 }),
    serigraphMat: new THREE.MeshStandardMaterial({ map: serigraphMap, roughness: 0.5 }),
    ceramicTeal: new THREE.MeshStandardMaterial({ color: 0x3b7d84, roughness: 0.2, metalness: 0.05 }),
    ceramicTerracotta: new THREE.MeshStandardMaterial({
      color: 0xb85d3b,
      normalMap: plasterMaps.normalMap,
      normalScale: new THREE.Vector2(0.25, 0.25),
      roughness: 0.62,
    }),
    stonewareWhite: new THREE.MeshStandardMaterial({
      color: 0xf1ede3,
      normalMap: plasterMaps.normalMap,
      normalScale: new THREE.Vector2(0.24, 0.24),
      roughnessMap: plasterMaps.roughnessMap,
      roughness: 0.64,
    }),
    vinylYachtCord: new THREE.MeshStandardMaterial({
      map: yachtCordMaps.map,
      normalMap: yachtCordMaps.normalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughnessMap: yachtCordMaps.roughnessMap,
      roughness: 0.42,
    }),
    muranoAmberGlass: new THREE.MeshPhysicalMaterial({
      color: 0xd9872a,
      transparent: true,
      opacity: 0.78,
      roughness: 0.07,
      ior: 1.53,
    }),
    vinylRecord: new THREE.MeshStandardMaterial({ color: 0x141517, roughness: 0.2, metalness: 0.16 }),
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
