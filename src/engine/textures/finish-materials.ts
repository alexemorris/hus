/**
 * Architectural paint-sheen & surface-finish material registry (`husjs/materials`).
 *
 * Eliminates ad-hoc `new THREE.MeshStandardMaterial({ color, roughness })` allocations across
 * room and joinery modules while guaranteeing deterministic reference identity so
 * `SceneBatchOptimizer` merges matching painted walls, skirtings, architraves, and cabinetry
 * into single draw calls.
 */
import * as THREE from 'three';

export type FinishCategory = 'paint-plaster' | 'timber-stone' | 'metal-enamel';

export type FinishSheen =
  // Paint & Plaster
  | 'lime-wash'
  | 'chalky-matte'
  | 'estate-emulsion'
  | 'modern-emulsion'
  | 'eggshell'
  | 'satinwood'
  | 'full-gloss'
  // Timber & Stone
  | 'oiled-oak'
  | 'waxed-walnut'
  | 'fumed-mahogany'
  | 'honed-stone'
  | 'polished-marble'
  | 'riven-slate'
  // Architectural Metals & Enamel
  | 'unlacquered-brass'
  | 'aged-brass'
  | 'polished-chrome'
  | 'brushed-nickel'
  | 'wrought-iron'
  | 'cast-iron'
  | 'vitreous-enamel';

export interface FinishSheenDescriptor {
  readonly sheen: FinishSheen;
  readonly category: FinishCategory;
  readonly roughness: number;
  readonly metalness: number;
  readonly defaultColor: `#${string}`;
  readonly microGrainScale: number;
}

export interface FinishMaterialOptions {
  /**
   * Attaches a subtle shared procedural micro-grain roughness & normal map (off by default
   * so flat paint finishes coalesce with zero extra texture binds; uses a single cached
   * `DataTexture` pair when enabled).
   */
  readonly microGrain?: boolean;
  /** Face culling mode (`THREE.FrontSide` by default). */
  readonly side?: THREE.Side;
  /**
   * When `true`, allocates a dedicated uncached `THREE.MeshStandardMaterial` instance for
   * callers that intend to mutate `.opacity`, `.emissive`, or `.color` dynamically at runtime.
   */
  readonly unique?: boolean;
  /** Optional transparency override (`false` by default). */
  readonly transparent?: boolean;
  /** Optional opacity override (`1` by default). */
  readonly opacity?: number;
  /** Optional material debug name (defaults to `finish:<sheen>:#<hex>`). */
  readonly name?: string;
}

export const FINISH_SHEENS: Readonly<Record<FinishSheen, FinishSheenDescriptor>> = Object.freeze({
  // Paint & Plaster
  'lime-wash': {
    sheen: 'lime-wash',
    category: 'paint-plaster',
    roughness: 0.9,
    metalness: 0.0,
    defaultColor: '#EAE4D7',
    microGrainScale: 0.06,
  },
  'chalky-matte': {
    sheen: 'chalky-matte',
    category: 'paint-plaster',
    roughness: 0.86,
    metalness: 0.0,
    defaultColor: '#F0EDE5',
    microGrainScale: 0.05,
  },
  'estate-emulsion': {
    sheen: 'estate-emulsion',
    category: 'paint-plaster',
    roughness: 0.82,
    metalness: 0.0,
    defaultColor: '#EFECE4',
    microGrainScale: 0.04,
  },
  'modern-emulsion': {
    sheen: 'modern-emulsion',
    category: 'paint-plaster',
    roughness: 0.72,
    metalness: 0.0,
    defaultColor: '#F2EFE8',
    microGrainScale: 0.035,
  },
  eggshell: {
    sheen: 'eggshell',
    category: 'paint-plaster',
    roughness: 0.38,
    metalness: 0.01,
    defaultColor: '#EDEAE2',
    microGrainScale: 0.025,
  },
  satinwood: {
    sheen: 'satinwood',
    category: 'paint-plaster',
    roughness: 0.28,
    metalness: 0.01,
    defaultColor: '#F4F1EA',
    microGrainScale: 0.02,
  },
  'full-gloss': {
    sheen: 'full-gloss',
    category: 'paint-plaster',
    roughness: 0.14,
    metalness: 0.06,
    defaultColor: '#F7F5F0',
    microGrainScale: 0.012,
  },

  // Timber & Stone
  'oiled-oak': {
    sheen: 'oiled-oak',
    category: 'timber-stone',
    roughness: 0.46,
    metalness: 0.02,
    defaultColor: '#C8A87E',
    microGrainScale: 0.055,
  },
  'waxed-walnut': {
    sheen: 'waxed-walnut',
    category: 'timber-stone',
    roughness: 0.32,
    metalness: 0.02,
    defaultColor: '#5C3D28',
    microGrainScale: 0.045,
  },
  'fumed-mahogany': {
    sheen: 'fumed-mahogany',
    category: 'timber-stone',
    roughness: 0.3,
    metalness: 0.03,
    defaultColor: '#4E2A1E',
    microGrainScale: 0.045,
  },
  'honed-stone': {
    sheen: 'honed-stone',
    category: 'timber-stone',
    roughness: 0.34,
    metalness: 0.01,
    defaultColor: '#D8D1C3',
    microGrainScale: 0.05,
  },
  'polished-marble': {
    sheen: 'polished-marble',
    category: 'timber-stone',
    roughness: 0.18,
    metalness: 0.02,
    defaultColor: '#F3F0EA',
    microGrainScale: 0.018,
  },
  'riven-slate': {
    sheen: 'riven-slate',
    category: 'timber-stone',
    roughness: 0.76,
    metalness: 0.03,
    defaultColor: '#3C4146',
    microGrainScale: 0.08,
  },

  // Architectural Metals & Enamel
  'unlacquered-brass': {
    sheen: 'unlacquered-brass',
    category: 'metal-enamel',
    roughness: 0.28,
    metalness: 0.88,
    defaultColor: '#C8A14B',
    microGrainScale: 0.03,
  },
  'aged-brass': {
    sheen: 'aged-brass',
    category: 'metal-enamel',
    roughness: 0.36,
    metalness: 0.84,
    defaultColor: '#B5914B',
    microGrainScale: 0.04,
  },
  'polished-chrome': {
    sheen: 'polished-chrome',
    category: 'metal-enamel',
    roughness: 0.12,
    metalness: 0.94,
    defaultColor: '#DCE2E6',
    microGrainScale: 0.012,
  },
  'brushed-nickel': {
    sheen: 'brushed-nickel',
    category: 'metal-enamel',
    roughness: 0.32,
    metalness: 0.86,
    defaultColor: '#C8C6BE',
    microGrainScale: 0.035,
  },
  'wrought-iron': {
    sheen: 'wrought-iron',
    category: 'metal-enamel',
    roughness: 0.4,
    metalness: 0.62,
    defaultColor: '#45494C',
    microGrainScale: 0.065,
  },
  'cast-iron': {
    sheen: 'cast-iron',
    category: 'metal-enamel',
    roughness: 0.54,
    metalness: 0.55,
    defaultColor: '#2E3134',
    microGrainScale: 0.075,
  },
  'vitreous-enamel': {
    sheen: 'vitreous-enamel',
    category: 'metal-enamel',
    roughness: 0.15,
    metalness: 0.08,
    defaultColor: '#F6F5F0',
    microGrainScale: 0.015,
  },
});

interface MicroGrainTexturePair {
  readonly roughnessMap: THREE.DataTexture;
  readonly normalMap: THREE.DataTexture;
}

const finishMaterialCache = new Map<string, THREE.MeshStandardMaterial>();
let sharedMicroGrainMaps: MicroGrainTexturePair | null = null;
const colorScratch = new THREE.Color();

function hash2d(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function getSharedMicroGrainMaps(): MicroGrainTexturePair {
  if (sharedMicroGrainMaps !== null) {
    return sharedMicroGrainMaps;
  }

  const size = 64;
  const heightField = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n0 = hash2d(x, y, 17);
      const n1 =
        (hash2d((x + 1) % size, y, 31) +
          hash2d((x + size - 1) % size, y, 31) +
          hash2d(x, (y + 1) % size, 31) +
          hash2d(x, (y + size - 1) % size, 31)) *
        0.25;
      heightField[y * size + x] = n0 * 0.45 + n1 * 0.55;
    }
  }

  const roughnessData = new Uint8Array(size * size * 4);
  const normalData = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    const ym = (y + size - 1) % size;
    const yp = (y + 1) % size;
    for (let x = 0; x < size; x++) {
      const xm = (x + size - 1) % size;
      const xp = (x + 1) % size;
      const idx = y * size + x;
      const hVal = heightField[idx]!;
      // Subtle ±7% roughness modulation around material.roughness multiplier (neutral near 0.93..1.0)
      const roughByte = Math.max(0, Math.min(255, Math.round(234 + (hVal - 0.5) * 36)));
      const p4 = idx * 4;
      roughnessData[p4] = roughByte;
      roughnessData[p4 + 1] = roughByte;
      roughnessData[p4 + 2] = roughByte;
      roughnessData[p4 + 3] = 255;

      const dx = (heightField[y * size + xp]! - heightField[y * size + xm]!) * 0.55;
      const dy = (heightField[yp * size + x]! - heightField[ym * size + x]!) * 0.55;
      const invLen = 1 / Math.hypot(dx, dy, 1);
      normalData[p4] = Math.round((-dx * invLen * 0.5 + 0.5) * 255);
      normalData[p4 + 1] = Math.round((-dy * invLen * 0.5 + 0.5) * 255);
      normalData[p4 + 2] = Math.round((invLen * 0.5 + 0.5) * 255);
      normalData[p4 + 3] = 255;
    }
  }

  const roughnessMap = new THREE.DataTexture(roughnessData, size, size, THREE.RGBAFormat);
  roughnessMap.name = 'finish:microGrain:roughness';
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(4, 4);
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.needsUpdate = true;

  const normalMap = new THREE.DataTexture(normalData, size, size, THREE.RGBAFormat);
  normalMap.name = 'finish:microGrain:normal';
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.repeat.set(4, 4);
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.needsUpdate = true;

  sharedMicroGrainMaps = { roughnessMap, normalMap };
  return sharedMicroGrainMaps;
}

/**
 * Creates (or returns a deterministically cached) `THREE.MeshStandardMaterial` for a calibrated
 * architectural finish sheen and optional hex/CSS/numeric colour.
 */
export function createFinishMaterial(
  sheen: FinishSheen,
  color?: THREE.ColorRepresentation,
  options?: FinishMaterialOptions
): THREE.MeshStandardMaterial {
  const descriptor = FINISH_SHEENS[sheen];
  if (!descriptor) {
    throw new Error(`Unknown architectural finish sheen '${String(sheen)}'`);
  }

  colorScratch.set(color ?? descriptor.defaultColor);
  const canonicalHex = colorScratch.getHexString();
  const side = options?.side ?? THREE.FrontSide;
  const microGrain = options?.microGrain === true;
  const transparent = options?.transparent === true;
  const opacity = options?.opacity ?? 1;
  const customName = options?.name;
  const unique = options?.unique === true;

  const cacheKey = `${sheen}|${canonicalHex}|${side}|${microGrain ? 1 : 0}|${transparent ? 1 : 0}|${opacity.toFixed(4)}|${customName ?? ''}`;
  if (!unique) {
    const cached = finishMaterialCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const matParams: THREE.MeshStandardMaterialParameters = {
    name: customName ?? `finish:${sheen}:#${canonicalHex}`,
    color: new THREE.Color(`#${canonicalHex}`),
    roughness: descriptor.roughness,
    metalness: descriptor.metalness,
    side,
    ...(transparent ? { transparent: true } : {}),
    ...(opacity !== 1 ? { opacity } : {}),
  };

  if (microGrain) {
    const grain = getSharedMicroGrainMaps();
    matParams.roughnessMap = grain.roughnessMap;
    matParams.normalMap = grain.normalMap;
    matParams.normalScale = new THREE.Vector2(
      descriptor.microGrainScale,
      descriptor.microGrainScale
    );
  }

  const material = new THREE.MeshStandardMaterial(matParams);
  if (!unique) {
    finishMaterialCache.set(cacheKey, material);
  }
  return material;
}

/** Clears the cached finish-material table (primarily for isolated unit tests). */
export function clearFinishMaterialCache(): void {
  finishMaterialCache.clear();
}
