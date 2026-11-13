/**
 * Architectural paint-sheen & surface-finish material registry (`husjs/materials`).
 *
 * Eliminates ad-hoc `new THREE.MeshStandardMaterial({ color, roughness })` allocations across
 * room and joinery modules while guaranteeing deterministic reference identity so
 * `SceneBatchOptimizer` merges matching painted walls, skirtings, architraves, and cabinetry
 * into single draw calls.
 */
import * as THREE from 'three';
import {
  clearMicroSurfaceDetailCache,
  createThinFabricShadeMaterial,
  getMicroSurfaceDetailMaps,
  type MicroSurfaceClass,
  type ThinFabricShadeOptions,
} from './micro-surface-detail.ts';

export { createThinFabricShadeMaterial, type MicroSurfaceClass, type ThinFabricShadeOptions };

export type FinishCategory = 'paint-plaster' | 'timber-stone' | 'metal-enamel';

export type FinishSheen =
  | 'lime-wash'
  | 'chalky-matte'
  | 'estate-emulsion'
  | 'modern-emulsion'
  | 'eggshell'
  | 'satinwood'
  | 'full-gloss'
  | 'oiled-oak'
  | 'waxed-walnut'
  | 'fumed-mahogany'
  | 'honed-stone'
  | 'polished-marble'
  | 'riven-slate'
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
  readonly surfaceClass: MicroSurfaceClass;
  readonly roughness: number;
  readonly metalness: number;
  readonly defaultColor: `#${string}`;
  readonly microGrainScale: number;
}

export interface FinishMaterialOptions {
  /**
   * Attaches a subtle shared 256x256 procedural micro-surface roughness & tangent-normal map
   * cached once per surface class (`plaster-stipple`, `honed-stone`, `timber-pore`,
   * `brushed-metal`). Off by default so untextured batches coalesce with zero extra binds.
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
  'lime-wash': {
    sheen: 'lime-wash',
    category: 'paint-plaster',
    surfaceClass: 'plaster-stipple',
    roughness: 0.9,
    metalness: 0.0,
    defaultColor: '#EAE4D7',
    microGrainScale: 0.09,
  },
  'chalky-matte': {
    sheen: 'chalky-matte',
    category: 'paint-plaster',
    surfaceClass: 'plaster-stipple',
    roughness: 0.86,
    metalness: 0.0,
    defaultColor: '#F0EDE5',
    microGrainScale: 0.075,
  },
  'estate-emulsion': {
    sheen: 'estate-emulsion',
    category: 'paint-plaster',
    surfaceClass: 'plaster-stipple',
    roughness: 0.82,
    metalness: 0.0,
    defaultColor: '#EFECE4',
    microGrainScale: 0.065,
  },
  'modern-emulsion': {
    sheen: 'modern-emulsion',
    category: 'paint-plaster',
    surfaceClass: 'plaster-stipple',
    roughness: 0.72,
    metalness: 0.0,
    defaultColor: '#F2EFE8',
    microGrainScale: 0.055,
  },
  eggshell: {
    sheen: 'eggshell',
    category: 'paint-plaster',
    surfaceClass: 'plaster-stipple',
    roughness: 0.38,
    metalness: 0.01,
    defaultColor: '#EDEAE2',
    microGrainScale: 0.048,
  },
  satinwood: {
    sheen: 'satinwood',
    category: 'paint-plaster',
    surfaceClass: 'plaster-stipple',
    roughness: 0.28,
    metalness: 0.01,
    defaultColor: '#F4F1EA',
    microGrainScale: 0.042,
  },
  'full-gloss': {
    sheen: 'full-gloss',
    category: 'paint-plaster',
    surfaceClass: 'plaster-stipple',
    roughness: 0.14,
    metalness: 0.06,
    defaultColor: '#F7F5F0',
    microGrainScale: 0.04,
  },
  'oiled-oak': {
    sheen: 'oiled-oak',
    category: 'timber-stone',
    surfaceClass: 'timber-pore',
    roughness: 0.46,
    metalness: 0.02,
    defaultColor: '#C8A87E',
    microGrainScale: 0.07,
  },
  'waxed-walnut': {
    sheen: 'waxed-walnut',
    category: 'timber-stone',
    surfaceClass: 'timber-pore',
    roughness: 0.32,
    metalness: 0.02,
    defaultColor: '#5C3D28',
    microGrainScale: 0.055,
  },
  'fumed-mahogany': {
    sheen: 'fumed-mahogany',
    category: 'timber-stone',
    surfaceClass: 'timber-pore',
    roughness: 0.3,
    metalness: 0.03,
    defaultColor: '#4E2A1E',
    microGrainScale: 0.055,
  },
  'honed-stone': {
    sheen: 'honed-stone',
    category: 'timber-stone',
    surfaceClass: 'honed-stone',
    roughness: 0.34,
    metalness: 0.01,
    defaultColor: '#D8D1C3',
    microGrainScale: 0.065,
  },
  'polished-marble': {
    sheen: 'polished-marble',
    category: 'timber-stone',
    surfaceClass: 'honed-stone',
    roughness: 0.18,
    metalness: 0.02,
    defaultColor: '#F3F0EA',
    microGrainScale: 0.04,
  },
  'riven-slate': {
    sheen: 'riven-slate',
    category: 'timber-stone',
    surfaceClass: 'honed-stone',
    roughness: 0.76,
    metalness: 0.03,
    defaultColor: '#3C4146',
    microGrainScale: 0.095,
  },
  'unlacquered-brass': {
    sheen: 'unlacquered-brass',
    category: 'metal-enamel',
    surfaceClass: 'brushed-metal',
    roughness: 0.28,
    metalness: 0.88,
    defaultColor: '#C8A14B',
    microGrainScale: 0.05,
  },
  'aged-brass': {
    sheen: 'aged-brass',
    category: 'metal-enamel',
    surfaceClass: 'brushed-metal',
    roughness: 0.36,
    metalness: 0.84,
    defaultColor: '#B5914B',
    microGrainScale: 0.06,
  },
  'polished-chrome': {
    sheen: 'polished-chrome',
    category: 'metal-enamel',
    surfaceClass: 'brushed-metal',
    roughness: 0.12,
    metalness: 0.94,
    defaultColor: '#DCE2E6',
    microGrainScale: 0.04,
  },
  'brushed-nickel': {
    sheen: 'brushed-nickel',
    category: 'metal-enamel',
    surfaceClass: 'brushed-metal',
    roughness: 0.32,
    metalness: 0.86,
    defaultColor: '#C8C6BE',
    microGrainScale: 0.065,
  },
  'wrought-iron': {
    sheen: 'wrought-iron',
    category: 'metal-enamel',
    surfaceClass: 'brushed-metal',
    roughness: 0.4,
    metalness: 0.62,
    defaultColor: '#45494C',
    microGrainScale: 0.08,
  },
  'cast-iron': {
    sheen: 'cast-iron',
    category: 'metal-enamel',
    surfaceClass: 'brushed-metal',
    roughness: 0.54,
    metalness: 0.55,
    defaultColor: '#2E3134',
    microGrainScale: 0.095,
  },
  'vitreous-enamel': {
    sheen: 'vitreous-enamel',
    category: 'metal-enamel',
    surfaceClass: 'brushed-metal',
    roughness: 0.15,
    metalness: 0.08,
    defaultColor: '#F6F5F0',
    microGrainScale: 0.04,
  },
});

const finishMaterialCache = new Map<string, THREE.MeshStandardMaterial>();
const colorScratch = new THREE.Color();

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
  const opacity = THREE.MathUtils.clamp(options?.opacity ?? 1, 0, 1);
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
    const grain = getMicroSurfaceDetailMaps(descriptor.surfaceClass);
    const scale = THREE.MathUtils.clamp(descriptor.microGrainScale, 0.04, 0.1);
    matParams.roughnessMap = grain.roughnessMap;
    matParams.normalMap = grain.normalMap;
    matParams.normalScale = new THREE.Vector2(scale, scale);
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
  clearMicroSurfaceDetailCache();
}
