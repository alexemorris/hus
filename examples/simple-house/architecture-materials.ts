import * as THREE from 'three';
import {
  applyMetricBoxUVs,
  createRoomPaintScheme,
  createSharedSourceTextureVariant,
  type RoomPaintScheme,
} from 'husjs/materials';
import {
  VITORIA_CHEQUER_REPEAT_M,
  createEngineeredOakFloorTextures,
  createHerringboneTerracottaQuarryTileTextures,
  createParisianManoirCabochonTextures,
  createTumbledLimestoneFlagstoneTextures,
  createVitoriaRossoChequerboardTextures,
  prepGeo,
} from 'husjs/objects';
import {
  createHeritageFloorFinishMaterial,
  createPaleOakHerringboneParquetMaterial,
} from 'husjs/catalog/architectural';

export type Side = 'north' | 'south' | 'east' | 'west';
export type FloorId = 'ground' | 'first';

export type SimpleHouseRoomSchemeKey =
  | 'houseHall'
  | 'houseDrawing'
  | 'houseKitchenDiner'
  | 'houseBootLobby'
  | 'houseCloakroom'
  | 'houseLanding'
  | 'housePrincipalBed'
  | 'housePrincipalDressing'
  | 'housePrincipalEnsuite'
  | 'houseBedroom2'
  | 'houseStudy'
  | 'houseBathroom';

export function box(
  parent: THREE.Object3D,
  name: string,
  size: readonly [number, number, number],
  center: readonly [number, number, number],
  mat: THREE.Material,
  metricTileM?: number
): THREE.Mesh {
  const rawGeo = new THREE.BoxGeometry(size[0], size[1], size[2]);
  if (metricTileM !== undefined) {
    applyMetricBoxUVs(rawGeo, { tileW: metricTileM, tileH: metricTileM });
  }
  const mesh = new THREE.Mesh(prepGeo(rawGeo), mat);
  mesh.name = name;
  mesh.position.set(center[0], center[1], center[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function createSimpleHouseSchemes(): Readonly<
  Record<SimpleHouseRoomSchemeKey, RoomPaintScheme>
> {
  return {
    houseHall: createRoomPaintScheme({
      wallColor: 'slipper-satin',
      trimColor: 'wimborne-white',
      roomKind: 'hallway',
    }),
    houseDrawing: createRoomPaintScheme({
      wallColor: 'cromarty',
      trimColor: 'school-house-white',
      roomKind: 'drawing-room',
    }),
    houseKitchenDiner: createRoomPaintScheme({
      wallColor: 'joas-white',
      trimColor: 'pointing',
      ceilingColor: 'pointing',
      wallSheen: 'estate-emulsion',
      roomKind: 'kitchen',
    }),
    houseBootLobby: createRoomPaintScheme({
      wallColor: 'shaded-white',
      trimColor: 'green-smoke',
      roomKind: 'boot-room',
    }),
    houseCloakroom: createRoomPaintScheme({
      wallColor: 'hague-blue',
      trimColor: 'wimborne-white',
      roomKind: 'wc',
    }),
    houseLanding: createRoomPaintScheme({
      wallColor: 'slipper-satin',
      trimColor: 'wimborne-white',
      roomKind: 'landing',
    }),
    housePrincipalBed: createRoomPaintScheme({
      wallColor: 'skimming-stone',
      trimColor: 'wimborne-white',
      roomKind: 'bedroom',
    }),
    housePrincipalDressing: createRoomPaintScheme({
      wallColor: 'skimming-stone',
      trimColor: 'pointing',
      roomKind: 'dressing-room',
    }),
    housePrincipalEnsuite: createRoomPaintScheme({
      wallColor: 'wevet',
      trimColor: 'all-white',
      roomKind: 'ensuite',
    }),
    houseBedroom2: createRoomPaintScheme({
      wallColor: 'setting-plaster',
      trimColor: 'school-house-white',
      roomKind: 'bedroom',
    }),
    houseStudy: createRoomPaintScheme({
      wallColor: 'drop-cloth',
      trimColor: 'shaded-white',
      roomKind: 'study',
    }),
    houseBathroom: createRoomPaintScheme({
      wallColor: 'pointing',
      trimColor: 'mizzle',
      roomKind: 'bathroom',
    }),
  };
}

export function buildMetricScaledFloorMaterial(
  name: string,
  maps: {
    readonly map?: THREE.Texture;
    readonly colorMap?: THREE.Texture;
    readonly normalMap?: THREE.Texture;
    readonly roughnessMap?: THREE.Texture;
    readonly bumpMap?: THREE.Texture;
  },
  repeatPerMeter: readonly [number, number],
  roughness = 0.62,
  normalScale = 0.45
): THREE.MeshStandardMaterial {
  const baseColor = maps.map ?? maps.colorMap!;
  const map = createSharedSourceTextureVariant(baseColor, {
    repeat: repeatPerMeter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
  });
  const normalMap = maps.normalMap
    ? createSharedSourceTextureVariant(maps.normalMap, {
        repeat: repeatPerMeter,
        wrapS: THREE.RepeatWrapping,
        wrapT: THREE.RepeatWrapping,
      })
    : undefined;
  const roughnessMap = maps.roughnessMap
    ? createSharedSourceTextureVariant(maps.roughnessMap, {
        repeat: repeatPerMeter,
        wrapS: THREE.RepeatWrapping,
        wrapT: THREE.RepeatWrapping,
      })
    : undefined;
  const bumpMap =
    !normalMap && maps.bumpMap
      ? createSharedSourceTextureVariant(maps.bumpMap, {
          repeat: repeatPerMeter,
          wrapS: THREE.RepeatWrapping,
          wrapT: THREE.RepeatWrapping,
        })
      : undefined;
  return new THREE.MeshStandardMaterial({
    name,
    color: 0xffffff,
    map,
    ...(normalMap
      ? { normalMap, normalScale: new THREE.Vector2(normalScale, normalScale) }
      : {}),
    ...(roughnessMap ? { roughnessMap } : {}),
    ...(bumpMap ? { bumpMap, bumpScale: 0.012 } : {}),
    roughness,
    metalness: 0.0,
  });
}

let cachedDrawingHoneyOakParquetMat: THREE.MeshStandardMaterial | null = null;
export function createDrawingHoneyOakParquetMaterial(): THREE.MeshStandardMaterial {
  if (cachedDrawingHoneyOakParquetMat) return cachedDrawingHoneyOakParquetMat;

  const N = 512;
  const albedo = new Uint8Array(N * N * 4);
  const heightF = new Float32Array(N * N);
  const roughByte = new Uint8Array(N * N * 4);

  const hash2 = (ix: number, iy: number, seed: number): number => {
    let h = Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263) + Math.imul(seed | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const valueNoisePeriodic = (u: number, v: number, pU: number, pV: number, seed: number): number => {
    const x = u * pU;
    const y = v * pV;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const x0 = ((ix % pU) + pU) % pU;
    const x1 = (x0 + 1) % pU;
    const y0 = ((iy % pV) + pV) % pV;
    const y1 = (y0 + 1) % pV;
    const c00 = hash2(x0, y0, seed);
    const c10 = hash2(x1, y0, seed);
    const c01 = hash2(x0, y1, seed);
    const c11 = hash2(x1, y1, seed);
    const a = c00 + (c10 - c00) * sx;
    const b = c01 + (c11 - c01) * sx;
    return a + (b - a) * sy;
  };

  const K = 3;
  const RATIO = 4;
  const GRID = K * RATIO;

  for (let py = 0; py < N; py++) {
    const v = py / N;
    for (let px = 0; px < N; px++) {
      const u = px / N;
      const a = (u + v) * GRID;
      const b = (u - v + 1.0) * GRID;
      const ia = Math.floor(a);
      const ib = Math.floor(b);
      const fa = a - ia;
      const fb = b - ib;

      const diag = (((ia - ib) % (2 * RATIO)) + 2 * RATIO) % (2 * RATIO);
      const horizontal = diag < RATIO;

      let blockI: number;
      let blockJ: number;
      let along: number;
      let across: number;
      if (horizontal) {
        blockI = ia - diag;
        blockJ = ib;
        along = (diag + fa) / RATIO;
        across = fb;
      } else {
        const d2 = diag - RATIO;
        blockI = ia;
        blockJ = (ib + d2 - (RATIO - 1)) * 3 + 1;
        along = (RATIO - 1 - d2 + fb) / RATIO;
        across = fa;
      }

      const pI = ((blockI % 12) + 12) % 12;
      const pJ = ((blockJ % 36) + 36) % 36;
      const seedA = hash2(pI, pJ, 17);
      const seedB = hash2(pI, pJ, 53);
      const seedC = hash2(pI, pJ, 97);

      const bevelAlong = Math.min(along, 1 - along) * RATIO;
      const bevelAcross = Math.min(across, 1 - across);
      const edge = Math.min(bevelAlong, bevelAcross);
      const isGroove = edge < 0.028;

      const gU = ((along + seedA) % 1 + 1) % 1;
      const gV = ((across + seedB) % 1 + 1) % 1;
      const fine = valueNoisePeriodic(gU, gV, 8, 48, 311);
      const micro = valueNoisePeriodic(gU, gV, 24, 96, 619);
      const ray = valueNoisePeriodic(gU, gV, 32, 10, 887);
      const ringArg = (gV - 0.5) * (2.6 + seedC * 1.4) + (fine - 0.5) * 0.55 + Math.sin(gU * Math.PI * 2) * 0.18;
      const cathedral = 0.5 + 0.5 * Math.sin(ringArg * Math.PI * 4.0);
      const medullary = ray > 0.76 ? (ray - 0.76) * 4.1 : 0;

      const idx = py * N + px;
      const o = idx * 4;

      if (isGroove) {
        albedo[o] = 75;
        albedo[o + 1] = 49;
        albedo[o + 2] = 28;
        albedo[o + 3] = 255;
        heightF[idx] = 0.12;
        const rb = Math.round(0.76 * 255);
        roughByte[o] = rb;
        roughByte[o + 1] = rb;
        roughByte[o + 2] = rb;
        roughByte[o + 3] = 255;
      } else {
        const plankTone = (seedA - 0.5) * 28;
        const grainDelta = (cathedral - 0.5) * 18 + (fine - 0.5) * 11 + (micro - 0.5) * 7 + medullary * 14;
        const poreDip = micro > 0.8 ? -9 : 0;
        const d = plankTone + grainDelta + poreDip;
        albedo[o] = Math.max(0, Math.min(255, Math.round(188 + d)));
        albedo[o + 1] = Math.max(0, Math.min(255, Math.round(138 + d * 0.84)));
        albedo[o + 2] = Math.max(0, Math.min(255, Math.round(84 + d * 0.66)));
        albedo[o + 3] = 255;

        const chamfer = Math.min(1, edge / 0.085);
        heightF[idx] = 0.5 + 0.34 * chamfer + 0.09 * cathedral + 0.06 * fine + (micro > 0.8 ? -0.05 : 0);
        const rVal = Math.max(0.24, Math.min(0.54, 0.38 + (seedB - 0.5) * 0.07 + (0.5 - cathedral) * 0.05 - medullary * 0.05));
        const rb = Math.round(rVal * 255);
        roughByte[o] = rb;
        roughByte[o + 1] = rb;
        roughByte[o + 2] = rb;
        roughByte[o + 3] = 255;
      }
    }
  }

  const normalBytes = new Uint8Array(N * N * 4);
  const strength = 2.4;
  for (let y = 0; y < N; y++) {
    const ym = (y - 1 + N) % N;
    const yp = (y + 1) % N;
    for (let x = 0; x < N; x++) {
      const xm = (x - 1 + N) % N;
      const xp = (x + 1) % N;
      const dx = (heightF[y * N + xp]! - heightF[y * N + xm]!) * strength;
      const dy = (heightF[yp * N + x]! - heightF[ym * N + x]!) * strength;
      const nx = -dx;
      const ny = -dy;
      const nz = 1.0;
      const invLen = 1 / Math.hypot(nx, ny, nz);
      const o = (y * N + x) * 4;
      normalBytes[o] = Math.round((nx * invLen * 0.5 + 0.5) * 255);
      normalBytes[o + 1] = Math.round((ny * invLen * 0.5 + 0.5) * 255);
      normalBytes[o + 2] = Math.round((nz * invLen * 0.5 + 0.5) * 255);
      normalBytes[o + 3] = 255;
    }
  }

  const repeatScale = 1 / 1.65;
  const configTex = (tex: THREE.DataTexture, name: string, srgb: boolean): THREE.DataTexture => {
    tex.name = name;
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatScale, repeatScale);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    return tex;
  };

  const map = configTex(new THREE.DataTexture(albedo, N, N, THREE.RGBAFormat), 'simpleHouse.drawingHoneyOakParquet.albedo', true);
  const normalMap = configTex(new THREE.DataTexture(normalBytes, N, N, THREE.RGBAFormat), 'simpleHouse.drawingHoneyOakParquet.normal', false);
  const roughnessMap = configTex(new THREE.DataTexture(roughByte, N, N, THREE.RGBAFormat), 'simpleHouse.drawingHoneyOakParquet.roughness', false);

  cachedDrawingHoneyOakParquetMat = new THREE.MeshStandardMaterial({
    name: 'simpleHouse.floorMat.drawingHoneyOak',
    color: 0xffffff,
    map,
    normalMap,
    normalScale: new THREE.Vector2(0.42, 0.42),
    roughnessMap,
    roughness: 0.38,
    metalness: 0.0,
  });
  return cachedDrawingHoneyOakParquetMat;
}

export function createSimpleHouseFloorMaterials() {
  const drawingHoneyOakFloorMat = createDrawingHoneyOakParquetMaterial();
  const kitchenHerringboneOakMat = createPaleOakHerringboneParquetMaterial();
  const bootTerracottaQuarryMat = buildMetricScaledFloorMaterial(
    'simpleHouse.floorMat.bootTerracottaQuarry',
    createHerringboneTerracottaQuarryTileTextures(),
    [1 / 1.05, 1 / 1.05],
    0.72,
    0.5
  );
  const wcVitoriaChequerMat = buildMetricScaledFloorMaterial(
    'simpleHouse.floorMat.wcVitoriaChequer',
    createVitoriaRossoChequerboardTextures(),
    [1 / VITORIA_CHEQUER_REPEAT_M, 1 / VITORIA_CHEQUER_REPEAT_M],
    0.46,
    0.42
  );
  const landingSmokedOakMat = buildMetricScaledFloorMaterial(
    'simpleHouse.floorMat.landingSmokedOak',
    createEngineeredOakFloorTextures(),
    [1 / 4.75, 1 / 1.9],
    0.58,
    0.42
  );
  landingSmokedOakMat.color.setHex(0xdfd3c3);
  const principalOatmealCarpetMat = createHeritageFloorFinishMaterial('oatmealLoopWoolCarpet');
  const ensuiteParisianManoirMat = buildMetricScaledFloorMaterial(
    'simpleHouse.floorMat.ensuiteParisianManoir',
    createParisianManoirCabochonTextures(),
    [1 / 1.218, 1 / 1.218],
    0.42,
    0.45
  );
  const guestHoneySisalMat = createHeritageFloorFinishMaterial('honeySisalBoucle');
  const studyFumedWalnutOakMat = buildMetricScaledFloorMaterial(
    'simpleHouse.floorMat.studyHoneySmokedOak',
    createEngineeredOakFloorTextures(),
    [1 / 5.0, 1 / 2.0],
    0.48,
    0.44
  );
  studyFumedWalnutOakMat.color.setHex(0xd8c3a8);
  const bathroomCotswoldLimestoneMat = buildMetricScaledFloorMaterial(
    'simpleHouse.floorMat.bathroomCotswoldLimestone',
    createTumbledLimestoneFlagstoneTextures(),
    [1 / 1.6, 1 / 1.6],
    0.64,
    0.52
  );

  return {
    drawingHoneyOakFloorMat,
    kitchenHerringboneOakMat,
    bootTerracottaQuarryMat,
    wcVitoriaChequerMat,
    landingSmokedOakMat,
    principalOatmealCarpetMat,
    ensuiteParisianManoirMat,
    guestHoneySisalMat,
    studyFumedWalnutOakMat,
    bathroomCotswoldLimestoneMat,
  };
}
