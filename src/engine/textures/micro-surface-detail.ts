/**
 * Procedural 256x256 tileable micro-surface detail maps, close-up TSL triplanar micro-normal
 * relief, and thin-walled fabric translucency materials for architectural finishes.
 *
 * Each surface class allocates a single deterministic `DataTexture` pair (roughness + tangent
 * normal) cached across the entire session so `SceneBatchOptimizer` coalesces matching finishes
 * by texture UUID with zero cold-boot overhead.
 */
import * as THREE from 'three';
import type { Node } from 'three/webgpu';
import {
  Fn,
  abs,
  clamp,
  dot,
  float,
  floor,
  fract,
  max,
  mix,
  normalize,
  type ShaderNodeObject,
  smoothstep,
  vec2,
  vec3,
} from 'three/tsl';

export type MicroSurfaceClass =
  | 'plaster-stipple'
  | 'honed-stone'
  | 'timber-pore'
  | 'brushed-metal'
  | 'woven-fabric';

export interface MicroSurfaceDetailMaps {
  readonly surfaceClass: MicroSurfaceClass;
  readonly roughnessMap: THREE.DataTexture;
  readonly normalMap: THREE.DataTexture;
}

export interface ThinFabricShadeOptions {
  readonly color?: THREE.ColorRepresentation;
  readonly sheenColor?: THREE.ColorRepresentation;
  readonly roughness?: number;
  readonly transmission?: number;
  readonly sheen?: number;
  readonly side?: THREE.Side;
  readonly unique?: boolean;
  readonly name?: string;
}

export const MICRO_SURFACE_MAP_SIZE = 256;

const detailMapCache = new Map<MicroSurfaceClass, MicroSurfaceDetailMaps>();
const fabricMaterialCache = new Map<string, THREE.MeshPhysicalMaterial>();
const colorScratch = new THREE.Color();
const sheenScratch = new THREE.Color();

function buildPeriodicGrid(cellsU: number, cellsV: number, seed: number): Float32Array {
  const grid = new Float32Array(cellsU * cellsV);
  for (let iy = 0; iy < cellsV; iy++) {
    const rowSeed = (Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) | 0;
    const rowOffset = iy * cellsU;
    for (let ix = 0; ix < cellsU; ix++) {
      let h = (Math.imul(ix, 374761393) + rowSeed) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      grid[rowOffset + ix] = ((h ^ (h >>> 16)) >>> 0) * 2.3283064365386963e-10;
    }
  }
  return grid;
}

function addOctaveToField(
  out: Float32Array,
  size: number,
  cellsU: number,
  cellsV: number,
  seed: number,
  weight: number
): void {
  const grid = buildPeriodicGrid(cellsU, cellsV, seed);
  const invSize = 1 / size;
  const x0Tab = new Int32Array(size);
  const x1Tab = new Int32Array(size);
  const sxTab = new Float32Array(size);
  for (let x = 0; x < size; x++) {
    const gx = x * invSize * cellsU;
    const ix = gx | 0;
    const fx = gx - ix;
    x0Tab[x] = ix % cellsU;
    x1Tab[x] = (ix + 1) % cellsU;
    sxTab[x] = fx * fx * (3 - 2 * fx);
  }
  for (let y = 0; y < size; y++) {
    const gy = y * invSize * cellsV;
    const iy = gy | 0;
    const fy = gy - iy;
    const sy = fy * fy * (3 - 2 * fy);
    const r0 = (iy % cellsV) * cellsU;
    const r1 = ((iy + 1) % cellsV) * cellsU;
    const rowOut = y * size;
    for (let x = 0; x < size; x++) {
      const ix0 = x0Tab[x]!;
      const ix1 = x1Tab[x]!;
      const sx = sxTab[x]!;
      const nx0 = grid[r0 + ix0]! + (grid[r0 + ix1]! - grid[r0 + ix0]!) * sx;
      const nx1 = grid[r1 + ix0]! + (grid[r1 + ix1]! - grid[r1 + ix0]!) * sx;
      out[rowOut + x]! += (nx0 + (nx1 - nx0) * sy) * weight;
    }
  }
}

function evaluateSurfaceHeightField(surfaceClass: MicroSurfaceClass, size: number): Float32Array {
  const field = new Float32Array(size * size);
  if (surfaceClass === 'plaster-stipple') {
    addOctaveToField(field, size, 16, 16, 101, 0.36);
    addOctaveToField(field, size, 48, 48, 211, 0.4);
    addOctaveToField(field, size, 128, 128, 307, 0.24);
  } else if (surfaceClass === 'honed-stone') {
    addOctaveToField(field, size, 12, 12, 409, 0.42);
    addOctaveToField(field, size, 36, 36, 521, 0.36);
    addOctaveToField(field, size, 96, 96, 613, 0.22);
  } else if (surfaceClass === 'timber-pore') {
    addOctaveToField(field, size, 10, 28, 701, 0.35);
    addOctaveToField(field, size, 64, 32, 919, 0.35);
    addOctaveToField(field, size, 128, 16, 811, 0.3);
  } else if (surfaceClass === 'brushed-metal') {
    addOctaveToField(field, size, 8, 128, 1031, 0.46);
    addOctaveToField(field, size, 16, 192, 1151, 0.38);
    addOctaveToField(field, size, 32, 32, 1277, 0.16);
  } else {
    addOctaveToField(field, size, 24, 24, 1381, 0.32);
    const invSize = 1 / size;
    const sinTab = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      sinTab[i] = (Math.sin(i * invSize * Math.PI * 2 * 64) * 0.5 + 0.5) * 0.34;
    }
    for (let y = 0; y < size; y++) {
      const wy = sinTab[y]!;
      const rowOut = y * size;
      for (let x = 0; x < size; x++) {
        field[rowOut + x]! += sinTab[x]! + wy;
      }
    }
  }
  return field;
}

function getSlopeAndRoughnessCalibration(surfaceClass: MicroSurfaceClass): {
  readonly slopeGain: number;
  readonly roughCenter: number;
  readonly roughSwing: number;
  readonly repeat: number;
} {
  switch (surfaceClass) {
    case 'plaster-stipple':
      return { slopeGain: 0.32, roughCenter: 240, roughSwing: 26, repeat: 6 };
    case 'honed-stone':
      return { slopeGain: 0.36, roughCenter: 236, roughSwing: 32, repeat: 5 };
    case 'timber-pore':
      return { slopeGain: 0.34, roughCenter: 238, roughSwing: 30, repeat: 6 };
    case 'brushed-metal':
      return { slopeGain: 0.28, roughCenter: 242, roughSwing: 24, repeat: 8 };
    case 'woven-fabric':
      return { slopeGain: 0.42, roughCenter: 244, roughSwing: 22, repeat: 10 };
  }
}

/**
 * Returns a deterministically generated, tileable 256x256 roughness and normal `DataTexture`
 * pair cached once per `MicroSurfaceClass`.
 *
 * Normal slopes are gently calibrated so both direct `normalScale` (`0.04..0.10`) and
 * `SceneBatchOptimizer` vertex-color-consolidated `0.35` batches preserve subtle architectural
 * plaster/mineral relief without harsh sandpaper contrast.
 */
export function getMicroSurfaceDetailMaps(
  surfaceClass: MicroSurfaceClass
): MicroSurfaceDetailMaps {
  const cached = detailMapCache.get(surfaceClass);
  if (cached) {
    return cached;
  }

  const size = MICRO_SURFACE_MAP_SIZE;
  const heightField = evaluateSurfaceHeightField(surfaceClass, size);
  const { slopeGain, roughCenter, roughSwing, repeat } =
    getSlopeAndRoughnessCalibration(surfaceClass);

  const roughnessData = new Uint8Array(size * size * 4);
  const normalData = new Uint8Array(size * size * 4);

  const mask = size - 1;
  for (let y = 0; y < size; y++) {
    const rowC = y * size;
    const rowM = ((y - 1) & mask) * size;
    const rowP = ((y + 1) & mask) * size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1) & mask;
      const xp = (x + 1) & mask;
      const idx = rowC + x;
      const hVal = heightField[idx]!;
      const rRaw = (roughCenter + (0.5 - hVal) * roughSwing + 0.5) | 0;
      const roughByte = rRaw < 0 ? 0 : rRaw > 255 ? 255 : rRaw;
      const p4 = idx << 2;
      roughnessData[p4] = roughByte;
      roughnessData[p4 + 1] = roughByte;
      roughnessData[p4 + 2] = roughByte;
      roughnessData[p4 + 3] = 255;

      const dx = (heightField[rowC + xp]! - heightField[rowC + xm]!) * slopeGain;
      const dy = (heightField[rowP + x]! - heightField[rowM + x]!) * slopeGain;
      const invLen = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const nx = ((-dx * invLen * 0.5 + 0.5) * 255 + 0.5) | 0;
      const ny = ((-dy * invLen * 0.5 + 0.5) * 255 + 0.5) | 0;
      const nz = ((invLen * 0.5 + 0.5) * 255 + 0.5) | 0;
      normalData[p4] = nx < 0 ? 0 : nx > 255 ? 255 : nx;
      normalData[p4 + 1] = ny < 0 ? 0 : ny > 255 ? 255 : ny;
      normalData[p4 + 2] = nz < 0 ? 0 : nz > 255 ? 255 : nz;
      normalData[p4 + 3] = 255;
    }
  }

  const roughnessMap = new THREE.DataTexture(roughnessData, size, size, THREE.RGBAFormat);
  roughnessMap.name = `microDetail:${surfaceClass}:roughness`;
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(repeat, repeat);
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.generateMipmaps = true;
  roughnessMap.minFilter = THREE.LinearMipmapLinearFilter;
  roughnessMap.magFilter = THREE.LinearFilter;
  roughnessMap.needsUpdate = true;

  const normalMap = new THREE.DataTexture(normalData, size, size, THREE.RGBAFormat);
  normalMap.name = `microDetail:${surfaceClass}:normal`;
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.repeat.set(repeat, repeat);
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.generateMipmaps = true;
  normalMap.minFilter = THREE.LinearMipmapLinearFilter;
  normalMap.magFilter = THREE.LinearFilter;
  normalMap.needsUpdate = true;

  const pair: MicroSurfaceDetailMaps = {
    surfaceClass,
    roughnessMap,
    normalMap,
  };
  detailMapCache.set(surfaceClass, pair);
  return pair;
}

/**
 * Creates a cached thin-walled `THREE.MeshPhysicalMaterial` for architectural lampshades,
 * linen blinds, and sheer curtains using physical sheen and zero-refraction thin-surface
 * transmission with shared 256x256 woven micro-detail maps.
 */
export function createThinFabricShadeMaterial(
  options?: ThinFabricShadeOptions
): THREE.MeshPhysicalMaterial {
  colorScratch.set(options?.color ?? '#F4EFE4');
  sheenScratch.set(options?.sheenColor ?? '#FFF8EA');
  const hex = colorScratch.getHexString();
  const sheenHex = sheenScratch.getHexString();
  const roughness = THREE.MathUtils.clamp(options?.roughness ?? 0.84, 0.1, 1.0);
  const transmission = THREE.MathUtils.clamp(options?.transmission ?? 0.24, 0.0, 0.85);
  const sheen = THREE.MathUtils.clamp(options?.sheen ?? 0.55, 0.0, 1.0);
  const side = options?.side ?? THREE.DoubleSide;
  const unique = options?.unique === true;
  const customName = options?.name ?? '';

  const key = `${hex}|${sheenHex}|${roughness.toFixed(3)}|${transmission.toFixed(3)}|${sheen.toFixed(3)}|${side}|${customName}`;
  if (!unique) {
    const cached = fabricMaterialCache.get(key);
    if (cached) {
      return cached;
    }
  }

  const weave = getMicroSurfaceDetailMaps('woven-fabric');
  const mat = new THREE.MeshPhysicalMaterial({
    name: customName || `finish:thin-fabric:#${hex}`,
    color: new THREE.Color(`#${hex}`),
    roughness,
    metalness: 0.0,
    sheen,
    sheenRoughness: 0.72,
    sheenColor: new THREE.Color(`#${sheenHex}`),
    transmission,
    thickness: 0.0,
    ior: 1.0,
    roughnessMap: weave.roughnessMap,
    normalMap: weave.normalMap,
    normalScale: new THREE.Vector2(0.06, 0.06),
    side,
  });

  if (!unique) {
    fabricMaterialCache.set(key, mat);
  }
  return mat;
}

/**
 * TSL world-space triplanar micro-normal perturbation helper for close-up architectural plaster
 * and painted surfaces (`0.10 m .. 1.95 m`), returning a subtle grazing-light relief multiplier
 * centered at `1.0` with zero UV seam stretching and zero temporal animation.
 */
export function buildCloseUpTriplanarMicroReliefNode(
  worldPos: ShaderNodeObject<Node>,
  worldNormal: ShaderNodeObject<Node>,
  lightWorldDir: ShaderNodeObject<Node>,
  viewDistMeters: ShaderNodeObject<Node>,
  strength: ShaderNodeObject<Node>
): ShaderNodeObject<Node> {
  const hash2 = (p: ShaderNodeObject<Node>): ShaderNodeObject<Node> => {
    const q = fract(p.mul(vec2(0.1031, 0.103)));
    const d = dot(q, q.yx.add(33.33));
    return fract(q.x.add(d).mul(q.y.add(d)));
  };

  const valueNoise2 = (p: ShaderNodeObject<Node>): ShaderNodeObject<Node> => {
    const i = floor(p);
    const f = fract(p);
    const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));
    const a = hash2(i);
    const b = hash2(i.add(vec2(1.0, 0.0)));
    const c = hash2(i.add(vec2(0.0, 1.0)));
    const d = hash2(i.add(vec2(1.0, 1.0)));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  };

  const evalFn = Fn(() => {
    const distFade = float(1.0)
      .sub(smoothstep(0.65, 1.95, viewDistMeters))
      .mul(smoothstep(0.08, 0.22, viewDistMeters));
    const unitN = normalize(worldNormal);
    const absN = abs(unitN);
    const wSum = max(1e-4, absN.x.add(absN.y).add(absN.z));
    const triW = absN.div(wSum);

    const fineScale = float(172.0);
    const medScale = float(54.0);
    const pFine = worldPos.mul(fineScale);
    const pMed = worldPos.mul(medScale);

    const hX = valueNoise2(pFine.yz).mul(0.56).add(valueNoise2(pMed.yz).mul(0.44));
    const hY = valueNoise2(pFine.xz).mul(0.56).add(valueNoise2(pMed.xz).mul(0.44));
    const hZ = valueNoise2(pFine.xy).mul(0.56).add(valueNoise2(pMed.xy).mul(0.44));
    const hCenter = hX.mul(triW.x).add(hY.mul(triW.y)).add(hZ.mul(triW.z));

    const eps = vec2(0.42, 0.29);
    const hX2 = valueNoise2(pFine.yz.add(eps)).mul(0.56).add(valueNoise2(pMed.yz.add(eps.mul(0.35))).mul(0.44));
    const hY2 = valueNoise2(pFine.xz.add(eps)).mul(0.56).add(valueNoise2(pMed.xz.add(eps.mul(0.35))).mul(0.44));
    const hZ2 = valueNoise2(pFine.xy.add(eps)).mul(0.56).add(valueNoise2(pMed.xy.add(eps.mul(0.35))).mul(0.44));
    const hShift = hX2.mul(triW.x).add(hY2.mul(triW.y)).add(hZ2.mul(triW.z));

    const microSlope = hShift.sub(hCenter);
    const lightObliquity = float(1.0).sub(abs(dot(unitN, normalize(max(vec3(1e-4), lightWorldDir).mul(0.0).add(lightWorldDir)))).mul(0.45));
    const relief = microSlope.mul(strength).mul(distFade).mul(lightObliquity);
    return clamp(float(1.0).add(relief), 0.968, 1.032);
  });

  return evalFn();
}

export function clearMicroSurfaceDetailCache(): void {
  for (const entry of detailMapCache.values()) {
    entry.roughnessMap.dispose();
    entry.normalMap.dispose();
  }
  detailMapCache.clear();
  fabricMaterialCache.clear();
}
