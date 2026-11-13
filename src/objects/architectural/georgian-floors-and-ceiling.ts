import * as THREE from 'three';
import { getOrCreateCachedTexture } from '../../engine/textures/texture-registry.ts';
import {
  addNamedBox,
  addNamedCyl,
  deriveNormalAndRoughnessFromHeight,
  finalizeCatalogGroup,
  getGeorgianLimePlasterMaterial,
  getHonedCarraraCatalogMaterial,
  getNeroMarquinaCatalogMaterial,
  makeRgbaDataTexture,
  type PbrDataMapBundle,
  seamlessFbm2D,
  seamlessValueNoise2D,
  sharedSphereGeometry,
  sharedTorusGeometry,
  tagHighLod,
} from '../shared/neptune-and-georgian-materials.ts';

export interface CarraraNeroChequerboardTextureOptions {
  /** Diagonal tile edge length in metres (default `0.305` = classic 12-inch Georgian marble tile). */
  readonly tileEdgeM?: number;
  /** Grout joint width in metres (default `0.0025`). */
  readonly groutWidthM?: number;
  readonly resolution?: number;
  readonly repeatX?: number;
  readonly repeatY?: number;
}

/**
 * Generates a seamless `45°` diagonal Honed Carrara (`#ECEAE4` w/ subtle grey veining) &
 * Belgian Nero Marquina (`#1E1F21` w/ crisp white calcite veins) PBR map bundle
 * (`colorMap`, `normalMap`, `roughnessMap`) using headless-safe `DataTexture`s.
 */
export function createCarraraNeroChequerboardTextures(
  opts: CarraraNeroChequerboardTextureOptions = {}
): PbrDataMapBundle & { readonly diagonalRepeatM: number } {
  const tileEdgeM = opts.tileEdgeM ?? 0.305;
  const groutM = opts.groutWidthM ?? 0.0025;
  const size = opts.resolution ?? 256;
  const repeatX = opts.repeatX ?? 1;
  const repeatY = opts.repeatY ?? 1;
  const diagonalRepeatM = tileEdgeM * Math.SQRT2;
  const groutNorm = groutM / tileEdgeM;

  const cacheKey = `catalog:carrara-nero-chequer:${size}:${tileEdgeM.toFixed(3)}:${groutM.toFixed(4)}:${repeatX.toFixed(3)}:${repeatY.toFixed(3)}`;
  const bundle = getOrCreateCachedTexture(cacheKey, () => {
    const color = new Uint8Array(size * size * 4);
    const height = new Float32Array(size * size);
    const rough = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        // 45° rotated coordinates: (u + v) and (u - v) have integer period 1 along UV edges!
        // In 1x1 UV tile, s = u + v spans [0..2], t = u - v + 1 spans [0..2] -> exact 45° seamless diamond chequerboard!
        const s = u + v;
        const t = u - v + 2;
        const cellS = Math.floor(s);
        const cellT = Math.floor(t);
        const fs = s - cellS;
        const ft = t - cellT;

        const edgeDist = Math.min(fs, 1 - fs, ft, 1 - ft);
        const isGrout = edgeDist < groutNorm * 0.5;
        const isNero = ((cellS + cellT) & 1) === 1;

        const idx = y * size + x;
        const o = idx * 4;

        if (isGrout) {
          color[o] = 154;
          color[o + 1] = 151;
          color[o + 2] = 145;
          color[o + 3] = 255;
          height[idx] = 0.28;
          rough[idx] = 0.72;
        } else if (isNero) {
          // Belgian Nero Marquina (#1E1F21) with crisp white calcite veins
          const warp = seamlessFbm2D(u, v, 4, 3, 7207) * 0.3;
          const ridge = Math.abs(
            Math.sin((u * 2 + v * 2 + warp) * Math.PI * 2) +
              (seamlessFbm2D(u + 0.17, v + 0.31, 8, 3, 7331) - 0.5) * 0.85
          );
          const calcite = Math.pow(Math.max(0, 1 - ridge * 10), 1.65);
          const tone = (seamlessValueNoise2D(u, v, 8, 8, 7411) - 0.5) * 7;
          color[o] = Math.max(0, Math.min(255, Math.round(30 + tone + calcite * 195)));
          color[o + 1] = Math.max(0, Math.min(255, Math.round(31 + tone + calcite * 192)));
          color[o + 2] = Math.max(0, Math.min(255, Math.round(33 + tone + calcite * 186)));
          color[o + 3] = 255;
          height[idx] = 0.5 + calcite * 0.03;
          rough[idx] = 0.25 + calcite * 0.06;
        } else {
          // Honed Carrara (#ECEAE4) with subtle grey feather veining
          const warp = seamlessFbm2D(u, v, 3, 3, 7507) * 0.32;
          const ridge = Math.abs(
            Math.sin((u * 2 - v * 1 + warp) * Math.PI * 2) * 0.65 +
              (seamlessFbm2D(u + 0.23, v, 6, 3, 7603) - 0.5) * 0.72
          );
          const vein = Math.max(0, 1 - ridge * 7.8) * 0.78;
          const cloud = (seamlessFbm2D(u, v, 4, 2, 7717) - 0.5) * 9;
          color[o] = Math.max(0, Math.min(255, Math.round(236 + cloud - vein * 48)));
          color[o + 1] = Math.max(0, Math.min(255, Math.round(234 + cloud - vein * 47)));
          color[o + 2] = Math.max(0, Math.min(255, Math.round(228 + cloud - vein * 43)));
          color[o + 3] = 255;
          height[idx] = 0.51 - vein * 0.03;
          rough[idx] = 0.29 + vein * 0.06;
        }
      }
    }

    const derived = deriveNormalAndRoughnessFromHeight(
      height,
      rough,
      size,
      size,
      2.2,
      'catalog.carraraNeroChequer',
      repeatX,
      repeatY
    );
    return {
      colorMap: makeRgbaDataTexture(
        color,
        size,
        size,
        'catalog.carraraNeroChequer.color',
        true,
        repeatX,
        repeatY
      ),
      normalMap: derived.normalMap,
      roughnessMap: derived.roughnessMap,
    };
  });

  return { ...bundle, diagonalRepeatM };
}

export interface ChequerboardMarbleFloorOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  /** Overall floor width along X in metres (default `3.20`). */
  readonly widthM?: number;
  /** Overall floor depth along Z in metres (default `4.20`). */
  readonly depthM?: number;
  /** Slab thickness in metres (default `0.02`, top surface at `y = 0` or `y = thicknessM` via `topAtZero`). */
  readonly thicknessM?: number;
  /** Nero Marquina tramline border width in metres (default `0.14` = `140 mm`). */
  readonly tramlineWidthM?: number;
  /** Honed Carrara outer margin width in metres (default `0.18` = `180 mm`). */
  readonly outerMarginWidthM?: number;
  /** Diagonal marble tile edge in metres (default `0.305`). */
  readonly tileEdgeM?: number;
}

/**
 * Builds a Georgian entrance-hall Honed Carrara & Belgian Nero Marquina `45°` diagonal
 * chequerboard marble floor framed by a `140 mm` Nero Marquina tramline border and
 * `180 mm` Carrara outer margin using **9 strictly disjoint non-overlapping panels** (`0` z-fighting!).
 */
export function buildChequerboardMarbleFloor(
  opts: ChequerboardMarbleFloorOptions = {}
): THREE.Group {
  const namePrefix = opts.name ?? 'chequerboardMarbleFloor';
  const totalW = opts.widthM ?? 3.2;
  const totalD = opts.depthM ?? 4.2;
  const t = opts.thicknessM ?? 0.02;
  const marginW = Math.min(opts.outerMarginWidthM ?? 0.18, Math.min(totalW, totalD) * 0.2);
  const tramW = Math.min(opts.tramlineWidthM ?? 0.14, Math.min(totalW, totalD) * 0.15);
  const tileEdgeM = opts.tileEdgeM ?? 0.305;

  const fieldW = Math.max(0.2, totalW - (marginW + tramW) * 2);
  const fieldD = Math.max(0.2, totalD - (marginW + tramW) * 2);
  const diagPeriod = tileEdgeM * Math.SQRT2;

  const chequerMaps = createCarraraNeroChequerboardTextures({
    tileEdgeM,
    repeatX: Math.max(1, fieldW / diagPeriod),
    repeatY: Math.max(1, fieldD / diagPeriod),
  });
  const fieldMat = new THREE.MeshStandardMaterial({
    name: `${namePrefix}.diagonalChequerMat`,
    map: chequerMaps.colorMap,
    normalMap: chequerMaps.normalMap,
    normalScale: new THREE.Vector2(0.32, 0.32),
    roughnessMap: chequerMaps.roughnessMap,
    roughness: 0.28,
    metalness: 0.02,
  });
  const neroMat = getNeroMarquinaCatalogMaterial();
  const carraraMat = getHonedCarraraCatalogMaterial();

  const root = new THREE.Group();
  root.name = namePrefix;
  const cy = t * 0.5;

  // Center 45° diagonal chequerboard field (`[-fieldW/2 .. +fieldW/2] x [-fieldD/2 .. +fieldD/2]`)
  const centerMesh = addNamedBox(
    root,
    `${namePrefix}.diagonalChequerField`,
    fieldW,
    t,
    fieldD,
    0,
    cy,
    0,
    fieldMat
  );
  centerMesh.castShadow = false;

  // 4 strictly disjoint Nero Marquina 140 mm tramline border strips around the center field
  const tramOuterW = fieldW + tramW * 2;
  addNamedBox(
    root,
    `${namePrefix}.neroTramlineNorth`,
    tramOuterW,
    t,
    tramW,
    0,
    cy,
    -(fieldD * 0.5 + tramW * 0.5),
    neroMat
  ).castShadow = false;
  addNamedBox(
    root,
    `${namePrefix}.neroTramlineSouth`,
    tramOuterW,
    t,
    tramW,
    0,
    cy,
    fieldD * 0.5 + tramW * 0.5,
    neroMat
  ).castShadow = false;
  addNamedBox(
    root,
    `${namePrefix}.neroTramlineWest`,
    tramW,
    t,
    fieldD,
    -(fieldW * 0.5 + tramW * 0.5),
    cy,
    0,
    neroMat
  ).castShadow = false;
  addNamedBox(
    root,
    `${namePrefix}.neroTramlineEast`,
    tramW,
    t,
    fieldD,
    fieldW * 0.5 + tramW * 0.5,
    cy,
    0,
    neroMat
  ).castShadow = false;

  // 4 strictly disjoint Honed Carrara 180 mm outer margin strips around the tramline
  const tramOuterD = fieldD + tramW * 2;
  addNamedBox(
    root,
    `${namePrefix}.carraraMarginNorth`,
    totalW,
    t,
    marginW,
    0,
    cy,
    -(tramOuterD * 0.5 + marginW * 0.5),
    carraraMat
  ).castShadow = false;
  addNamedBox(
    root,
    `${namePrefix}.carraraMarginSouth`,
    totalW,
    t,
    marginW,
    0,
    cy,
    tramOuterD * 0.5 + marginW * 0.5,
    carraraMat
  ).castShadow = false;
  addNamedBox(
    root,
    `${namePrefix}.carraraMarginWest`,
    marginW,
    t,
    tramOuterD,
    -(tramOuterW * 0.5 + marginW * 0.5),
    cy,
    0,
    carraraMat
  ).castShadow = false;
  addNamedBox(
    root,
    `${namePrefix}.carraraMarginEast`,
    marginW,
    t,
    tramOuterD,
    tramOuterW * 0.5 + marginW * 0.5,
    cy,
    0,
    carraraMat
  ).castShadow = false;

  return finalizeCatalogGroup(root, namePrefix, opts.position, opts.rotationY);
}

export interface GeorgianCeilingRoseOptions {
  readonly name?: string;
  readonly position?: readonly [number, number, number];
  /** Outer diameter in metres (default `0.62`). */
  readonly diameterM?: number;
}

/**
 * Classical George III acanthus & beaded lime-plaster ceiling rose (`Ø620 mm` default),
 * hanging downward (`-Y`) from `y = 0` ceiling soffit.
 */
export function buildGeorgianCeilingRose(
  opts: GeorgianCeilingRoseOptions = {}
): THREE.Group {
  const namePrefix = opts.name ?? 'georgianCeilingRose';
  const r = (opts.diameterM ?? 0.62) * 0.5;
  const plasterMat = getGeorgianLimePlasterMaterial();
  const root = new THREE.Group();
  root.name = namePrefix;

  addNamedCyl(root, `${namePrefix}.outerPlaque`, r, r * 0.96, 0.014, 32, 0, -0.0078, 0, plasterMat);
  const outerRing = new THREE.Mesh(sharedTorusGeometry(r * 0.86, 0.011, 10, 32), plasterMat);
  outerRing.name = `${namePrefix}.outerBeadRing`;
  outerRing.rotation.x = Math.PI * 0.5;
  outerRing.position.set(0, -0.018, 0);
  tagHighLod(outerRing);
  root.add(outerRing);

  const innerRing = new THREE.Mesh(sharedTorusGeometry(r * 0.48, 0.009, 10, 28), plasterMat);
  innerRing.name = `${namePrefix}.innerAcanthusRing`;
  innerRing.rotation.x = Math.PI * 0.5;
  innerRing.position.set(0, -0.022, 0);
  tagHighLod(innerRing);
  root.add(innerRing);

  // 12 radial acanthus leaves between inner & outer rings
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const midR = r * 0.66;
    const leaf = new THREE.Mesh(sharedSphereGeometry(r * 0.12, 10, 8), plasterMat);
    leaf.name = `${namePrefix}.acanthusLeaf_${i + 1}`;
    leaf.scale.set(0.52, 0.25, 1.35);
    leaf.rotation.y = -a;
    leaf.position.set(Math.sin(a) * midR, -0.02, Math.cos(a) * midR);
    tagHighLod(leaf);
    root.add(leaf);
  }

  addNamedCyl(
    root,
    `${namePrefix}.centerBoss`,
    r * 0.16,
    r * 0.22,
    0.024,
    20,
    0,
    -0.026,
    0,
    plasterMat,
    true
  );

  return finalizeCatalogGroup(root, namePrefix, opts.position);
}
