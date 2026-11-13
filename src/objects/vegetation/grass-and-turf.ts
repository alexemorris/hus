import * as THREE from 'three';
import type { AssetMetadata } from '../../core/assets/asset-metadata.ts';
import { VEGETATION_ORGAN_CODES, type VegetationExposure } from '../../core/geo/climate-phenology.ts';
import { tagCollisionRole } from '../../engine/geometry/mesh-traits.ts';
import type { VegetationUniforms } from '../../engine/vegetation/vegetation-uniforms.ts';
import {
  OrganCollector,
  assembleBotanicalMeshes,
  createBotanicalRng,
  resolveReactivity,
  type BotanicalRng,
} from './organ-geometry.ts';

export type GrassPatchStyle =
  | 'lawn-edge'
  | 'meadow-verge'
  | 'clover-daisy-turf'
  | 'ornamental-tuft';

export interface GrassPatchPoint2D {
  readonly x: number;
  readonly z: number;
}

export type GrassPatchPointInput = GrassPatchPoint2D | readonly [number, number];

export interface CreateGrassPatchOptions {
  readonly style?: GrassPatchStyle;
  /** Rectangular patch `[width, depth]` centered at `(0, 0)` (when `ribbonPath` and `radius` are omitted). */
  readonly width?: number;
  readonly depth?: number;
  /** Circular clump/patch radius in metres. */
  readonly radius?: number;
  /** Polyline border/verge path in local `(x, z)` along which 3D grass edge tufts are scattered within `±ribbonWidth * 0.5`. */
  readonly ribbonPath?: readonly GrassPatchPointInput[];
  readonly ribbonWidth?: number;
  /** Optional local terrain elevation callback `(x, z) => y`. */
  readonly sampleGroundY?: (x: number, z: number) => number;
  /** Mean blade height in metres (default depends on style: `0.075` lawn-edge, `0.16` meadow-verge, `0.085` clover-daisy-turf, `0.32` ornamental-tuft). */
  readonly bladeHeight?: number;
  /** Density multiplier (`0.3 .. 3.0`, default `1.0`). */
  readonly density?: number;
  /** Include tiny white lawn daisies (`Bellis perennis`) and clover (`Trifolium repens`) heads (`summer-flower` organ). */
  readonly wildflowers?: boolean;
  readonly exposure?: VegetationExposure;
  readonly seed?: number;
  readonly uniforms?: VegetationUniforms;
  readonly name?: string;
  readonly metadata?: Partial<AssetMetadata>;
}

interface GrassStyleSpec {
  readonly defaultBladeHeight: number;
  readonly bladeWidthFactor: number;
  readonly tuftsPerSqM: number;
  readonly minBlades: number;
  readonly maxBlades: number;
  readonly archFactor: number;
  readonly leanMin: number;
  readonly leanMax: number;
  readonly baseHex: number;
  readonly tipHex: number;
  readonly defaultWildflowers: boolean;
}

const STYLE_SPECS: Readonly<Record<GrassPatchStyle, GrassStyleSpec>> = {
  'lawn-edge': {
    defaultBladeHeight: 0.075, bladeWidthFactor: 0.085, tuftsPerSqM: 46,
    minBlades: 5, maxBlades: 8, archFactor: 0.34, leanMin: 0.22, leanMax: 0.58,
    baseHex: 0x244d1d, tipHex: 0x5c8f32, defaultWildflowers: false,
  },
  'meadow-verge': {
    defaultBladeHeight: 0.16, bladeWidthFactor: 0.062, tuftsPerSqM: 36,
    minBlades: 6, maxBlades: 9, archFactor: 0.48, leanMin: 0.28, leanMax: 0.72,
    baseHex: 0x274e1e, tipHex: 0x6a9a38, defaultWildflowers: true,
  },
  'clover-daisy-turf': {
    defaultBladeHeight: 0.085, bladeWidthFactor: 0.082, tuftsPerSqM: 40,
    minBlades: 5, maxBlades: 8, archFactor: 0.36, leanMin: 0.24, leanMax: 0.62,
    baseHex: 0x234c1c, tipHex: 0x5a8e31, defaultWildflowers: true,
  },
  'ornamental-tuft': {
    defaultBladeHeight: 0.32, bladeWidthFactor: 0.044, tuftsPerSqM: 58,
    minBlades: 7, maxBlades: 9, archFactor: 0.62, leanMin: 0.32, leanMax: 0.85,
    baseHex: 0x2a5322, tipHex: 0x76a244, defaultWildflowers: false,
  },
};

const DAISY_PETAL_COLOR = new THREE.Color(0xfaf9f2);
const DAISY_DISC_COLOR = new THREE.Color(0xe5b526);
const CLOVER_HEAD_COLOR = new THREE.Color(0xf5eef2);
const CLOVER_LEAF_COLOR = new THREE.Color(0x2d6126);
const NOOP_RAYCAST: THREE.Object3D['raycast'] = () => {};

function addCurvedGrassBlade(
  collector: OrganCollector,
  pivX: number,
  pivY: number,
  pivZ: number,
  azimuth: number,
  lean: number,
  height: number,
  baseWidth: number,
  archFactor: number,
  baseCol: THREE.Color,
  tipCol: THREE.Color,
  jitter: number,
  reactivity: number
): void {
  const organCode = VEGETATION_ORGAN_CODES['warm-season-grass'];
  const cosA = Math.cos(azimuth);
  const sinA = Math.sin(azimuth);
  const rightX = -sinA;
  const rightZ = cosA;

  const r0 = height * lean * 0.42;
  const y1 = height * (0.56 - lean * 0.08);
  const r2 = height * (lean * 0.95 + archFactor * 0.44);
  const y2 = height * (0.94 - archFactor * 0.24 * lean);
  const hw0 = baseWidth * 0.5;
  const hw1 = baseWidth * 0.34;
  const midR = THREE.MathUtils.lerp(baseCol.r, tipCol.r, 0.52);
  const midG = THREE.MathUtils.lerp(baseCol.g, tipCol.g, 0.52);
  const midB = THREE.MathUtils.lerp(baseCol.b, tipCol.b, 0.52);

  const v0 = collector.pushVertex(
    pivX - rightX * hw0, pivY, pivZ - rightZ * hw0,
    -cosA * 0.25 - rightX * 0.14, 0.94, -sinA * 0.25 - rightZ * 0.14,
    0, 0, baseCol.r, baseCol.g, baseCol.b,
    pivX, pivY, pivZ, organCode, jitter, reactivity, 0.5
  );
  const v1 = collector.pushVertex(
    pivX + rightX * hw0, pivY, pivZ + rightZ * hw0,
    -cosA * 0.25 + rightX * 0.14, 0.94, -sinA * 0.25 + rightZ * 0.14,
    1, 0, baseCol.r, baseCol.g, baseCol.b,
    pivX, pivY, pivZ, organCode, jitter, reactivity, 0.5
  );
  const mx = pivX + cosA * r0;
  const my = pivY + y1;
  const mz = pivZ + sinA * r0;
  const v2 = collector.pushVertex(
    mx - rightX * hw1, my, mz - rightZ * hw1,
    -cosA * 0.38 - rightX * 0.12, 0.86, -sinA * 0.38 - rightZ * 0.12,
    0.16, 0.54, midR, midG, midB,
    pivX, pivY, pivZ, organCode, jitter, reactivity, 0.5
  );
  const v3 = collector.pushVertex(
    mx + rightX * hw1, my, mz + rightZ * hw1,
    -cosA * 0.38 + rightX * 0.12, 0.86, -sinA * 0.38 + rightZ * 0.12,
    0.84, 0.54, midR, midG, midB,
    pivX, pivY, pivZ, organCode, jitter, reactivity, 0.5
  );
  const v4 = collector.pushVertex(
    pivX + cosA * r2, pivY + y2, pivZ + sinA * r2,
    -cosA * 0.48, 0.78, -sinA * 0.48,
    0.5, 1.0, tipCol.r, tipCol.g, tipCol.b,
    pivX, pivY, pivZ, organCode, jitter, reactivity, 0.5
  );

  collector.pushTriangle(v0, v1, v3);
  collector.pushTriangle(v0, v3, v2);
  collector.pushTriangle(v2, v3, v4);
}

function addGrassTuft(
  collector: OrganCollector,
  cx: number,
  cy: number,
  cz: number,
  meanHeight: number,
  spec: GrassStyleSpec,
  baseRootCol: THREE.Color,
  tipRootCol: THREE.Color,
  outwardBiasAz: number | null,
  reactivity: number,
  rng: BotanicalRng
): void {
  const bladeCount = rng.int(spec.minBlades, spec.maxBlades);
  const baseAz = rng.range(0, Math.PI * 2);
  const tuftJitter = rng.next();
  const hueShift = rng.signed() * 0.025;
  const satShift = rng.signed() * 0.05;
  const lumShift = rng.signed() * 0.04;
  const baseCol = baseRootCol.clone().offsetHSL(hueShift, satShift, lumShift * 0.7);
  const tipCol = tipRootCol.clone().offsetHSL(hueShift * 1.1, satShift, lumShift);

  for (let i = 0; i < bladeCount; i++) {
    let az = baseAz + (i / bladeCount) * Math.PI * 2 + rng.signed() * 0.34;
    if (outwardBiasAz !== null) {
      az += Math.atan2(Math.sin(outwardBiasAz - az), Math.cos(outwardBiasAz - az)) * 0.42;
    }
    const h = meanHeight * rng.range(0.65, 1.35);
    const w = Math.max(0.0035, h * spec.bladeWidthFactor * rng.range(0.85, 1.18));
    const offR = rng.range(0, Math.min(0.028, meanHeight * 0.14));
    const jitter = THREE.MathUtils.clamp(tuftJitter + rng.signed() * 0.06, 0, 1);
    addCurvedGrassBlade(
      collector, cx + Math.cos(az) * offR, cy - 0.004, cz + Math.sin(az) * offR,
      az, rng.range(spec.leanMin, spec.leanMax), h, w, spec.archFactor,
      baseCol, tipCol, jitter, reactivity
    );
  }
}

function addWildflowerAccent(
  collector: OrganCollector,
  cx: number,
  cy: number,
  cz: number,
  meanHeight: number,
  cloverScale: number,
  reactivity: number,
  rng: BotanicalRng
): void {
  const roll = rng.next();
  if (roll < 0.42) {
    const piv = new THREE.Vector3(
      cx + rng.signed() * 0.03,
      cy + rng.range(0.016, 0.034) * cloverScale,
      cz + rng.signed() * 0.03
    );
    const baseYaw = rng.range(0, Math.PI * 2);
    const leafLen = rng.range(0.013, 0.02) * cloverScale;
    const col = CLOVER_LEAF_COLOR.clone().offsetHSL(
      rng.signed() * 0.018, rng.signed() * 0.04, rng.signed() * 0.035
    );
    const jitter = rng.next();
    for (let i = 0; i < 3; i++) {
      const az = baseYaw + (i * Math.PI * 2) / 3 + rng.signed() * 0.16;
      collector.addCuppedLeafBlade({
        pivot: piv,
        direction: new THREE.Vector3(Math.cos(az), rng.range(0.08, 0.25), Math.sin(az)).normalize(),
        length: leafLen,
        width: leafLen * 0.92,
        archDrop: leafLen * 0.14,
        cupDepth: leafLen * 0.12,
        segsLength: 2,
        segsWidth: 2,
        shape: 'cordate',
        color: col,
        meta: { organ: 'evergreen-leaf', jitter, reactivity, variant: 0.5 },
      });
    }
  }

  if (roll <= 0.72) return;
  const flowerY = meanHeight * rng.range(0.62, 0.96);

  if (rng.next() < 0.65) {
    const flowerCode = VEGETATION_ORGAN_CODES['summer-flower'];
    const variant = 0.58;
    const jitter = rng.next();
    const hx = cx + rng.signed() * 0.008;
    const hy = cy + flowerY;
    const hz = cz + rng.signed() * 0.008;
    const discR = rng.range(0.0038, 0.0052);
    const rayR = discR * rng.range(2.5, 3.1);
    const rayW = discR * 0.52;
    const rot0 = rng.range(0, Math.PI * 2);

    const centerIdx = collector.pushVertex(
      hx, hy + discR * 0.38, hz, 0, 1, 0, 0.5, 0.5,
      DAISY_DISC_COLOR.r, DAISY_DISC_COLOR.g, DAISY_DISC_COLOR.b,
      hx, hy, hz, flowerCode, jitter, reactivity, variant
    );
    const rim: number[] = [];
    for (let i = 0; i < 6; i++) {
      const th = rot0 + (i / 6) * Math.PI * 2;
      const rx = Math.cos(th);
      const rz = Math.sin(th);
      rim.push(
        collector.pushVertex(
          hx + rx * discR, hy + discR * 0.08, hz + rz * discR,
          rx * 0.35, 0.93, rz * 0.35, 0.5 + rx * 0.3, 0.5 + rz * 0.3,
          DAISY_DISC_COLOR.r * 0.94, DAISY_DISC_COLOR.g * 0.92, DAISY_DISC_COLOR.b * 0.88,
          hx, hy, hz, flowerCode, jitter, reactivity, variant
        )
      );
    }
    for (let i = 0; i < 6; i++) {
      collector.pushTriangle(centerIdx, rim[(i + 1) % 6]!, rim[i]!);
    }

    const petalCol = DAISY_PETAL_COLOR.clone().offsetHSL(0, 0, rng.signed() * 0.02);
    for (let p = 0; p < 8; p++) {
      const az = rot0 + (p / 8) * Math.PI * 2 + rng.signed() * 0.08;
      const cosA = Math.cos(az);
      const sinA = Math.sin(az);
      const rx = -sinA * rayW * 0.55;
      const rz = cosA * rayW * 0.55;
      const bx = hx + cosA * discR * 0.82;
      const bz = hz + sinA * discR * 0.82;
      const by = hy + discR * 0.06;
      const b0 = collector.pushVertex(
        bx - rx, by, bz - rz, 0, 1, 0, 0.2, 0.1,
        petalCol.r * 0.95, petalCol.g * 0.95, petalCol.b * 0.94,
        hx, hy, hz, flowerCode, jitter, reactivity, variant
      );
      const b1 = collector.pushVertex(
        bx + rx, by, bz + rz, 0, 1, 0, 0.8, 0.1,
        petalCol.r * 0.95, petalCol.g * 0.95, petalCol.b * 0.94,
        hx, hy, hz, flowerCode, jitter, reactivity, variant
      );
      const tip = collector.pushVertex(
        hx + cosA * rayR, hy + discR * 0.24, hz + sinA * rayR,
        cosA * 0.15, 0.98, sinA * 0.15, 0.5, 1.0,
        petalCol.r, petalCol.g, petalCol.b,
        hx, hy, hz, flowerCode, jitter, reactivity, variant
      );
      collector.pushTriangle(b0, b1, tip);
    }
  } else {
    const r = rng.range(0.0075, 0.0105);
    const col = CLOVER_HEAD_COLOR.clone().offsetHSL(
      rng.signed() * 0.01, rng.signed() * 0.03, rng.signed() * 0.025
    );
    collector.addSpheroidOrgan({
      pivot: new THREE.Vector3(cx + rng.signed() * 0.006, cy + flowerY * 0.88, cz + rng.signed() * 0.006),
      centerOffset: new THREE.Vector3(0, r * 0.85, 0),
      radiusXZ: r,
      radiusY: r * 1.08,
      latSegments: 3,
      lonSegments: 5,
      color: col,
      meta: { organ: 'summer-flower', jitter: rng.next(), reactivity, variant: 0.58 },
    });
  }
}

interface TuftPlacement {
  readonly x: number;
  readonly z: number;
  readonly outwardAz: number | null;
}

function sampleTuftPlacements(
  options: CreateGrassPatchOptions,
  style: GrassPatchStyle,
  tuftsPerSqM: number,
  density: number,
  rng: BotanicalRng
): { readonly placements: readonly TuftPlacement[]; readonly spanX: number; readonly spanZ: number } {
  const placements: TuftPlacement[] = [];

  if (options.ribbonPath && options.ribbonPath.length >= 2) {
    const path: GrassPatchPoint2D[] = options.ribbonPath.map((pt) => Array.isArray(pt) ? { x: pt[0], z: pt[1] } : (pt as GrassPatchPoint2D));
    const ribbonW = Math.max(0.06, options.ribbonWidth ?? 0.28);
    const segLens: number[] = [];
    let totalLen = 0;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < path.length; i++) {
      const p = path[i]!;
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
      if (i < path.length - 1) {
        const len = Math.hypot(path[i + 1]!.x - p.x, path[i + 1]!.z - p.z);
        segLens.push(len);
        totalLen += len;
      }
    }

    if (totalLen > 1e-4) {
      const count = THREE.MathUtils.clamp(Math.round(totalLen * ribbonW * tuftsPerSqM * density), 4, 420);
      for (let i = 0; i < count; i++) {
        let targetS = ((i + rng.range(0.15, 0.85)) / count) * totalLen;
        let segIdx = 0;
        while (segIdx < segLens.length - 1 && targetS > segLens[segIdx]!) {
          targetS -= segLens[segIdx]!;
          segIdx++;
        }
        const a = path[segIdx]!;
        const b = path[segIdx + 1]!;
        const segL = Math.max(1e-5, segLens[segIdx]!);
        const t = THREE.MathUtils.clamp(targetS / segL, 0, 1);
        const nx = -(b.z - a.z) / segL;
        const nz = (b.x - a.x) / segL;
        const lat = (rng.next() + rng.next() - 1) * 0.5 * ribbonW;
        placements.push({
          x: THREE.MathUtils.lerp(a.x, b.x, t) + nx * lat,
          z: THREE.MathUtils.lerp(a.z, b.z, t) + nz * lat,
          outwardAz: Math.abs(lat) > ribbonW * 0.18 ? Math.atan2(nz * Math.sign(lat), nx * Math.sign(lat)) : null,
        });
      }
    }
    return {
      placements,
      spanX: Math.max(ribbonW, maxX - minX + ribbonW),
      spanZ: Math.max(ribbonW, maxZ - minZ + ribbonW),
    };
  }

  if (typeof options.radius === 'number' && options.radius > 0) {
    const r = options.radius;
    const minCount = style === 'ornamental-tuft' ? 7 : 4;
    const count = THREE.MathUtils.clamp(Math.round(Math.PI * r * r * tuftsPerSqM * density), minCount, 420);
    const radialExp = style === 'ornamental-tuft' ? 0.68 : 0.5;
    for (let i = 0; i < count; i++) {
      const th = rng.range(0, Math.PI * 2);
      const dist = r * Math.pow(rng.next(), radialExp);
      placements.push({
        x: Math.cos(th) * dist,
        z: Math.sin(th) * dist,
        outwardAz: style === 'ornamental-tuft' && dist > r * 0.2 ? th : null,
      });
    }
    return { placements, spanX: r * 2, spanZ: r * 2 };
  }

  const w = Math.max(0.08, options.width ?? (style === 'ornamental-tuft' ? 0.45 : 1.2));
  const d = Math.max(0.08, options.depth ?? (style === 'ornamental-tuft' ? 0.45 : 0.6));
  const count = THREE.MathUtils.clamp(
    Math.round(w * d * tuftsPerSqM * density),
    style === 'ornamental-tuft' ? 7 : 4,
    420
  );
  for (let i = 0; i < count; i++) {
    const x = rng.range(-w * 0.5, w * 0.5);
    const z = rng.range(-d * 0.5, d * 0.5);
    placements.push({ x, z, outwardAz: style === 'ornamental-tuft' ? Math.atan2(z, x) : null });
  }
  return { placements, spanX: w, spanZ: d };
}

export function createGrassPatch(options: CreateGrassPatchOptions = {}): THREE.Group {
  const style = options.style ?? 'lawn-edge';
  const spec = STYLE_SPECS[style];
  const exposure = options.exposure ?? 'outdoor';
  const reactivity = resolveReactivity(exposure);
  const meanHeight = Math.max(0.025, options.bladeHeight ?? spec.defaultBladeHeight);
  const density = THREE.MathUtils.clamp(options.density ?? 1.0, 0.3, 3.0);
  const wildflowers = options.wildflowers ?? spec.defaultWildflowers;
  const rng = createBotanicalRng(options.seed ?? 2117);
  const sampleY = options.sampleGroundY;

  const { placements, spanX, spanZ } = sampleTuftPlacements(options, style, spec.tuftsPerSqM, density, rng);
  const foliage = new OrganCollector();
  const baseRootCol = new THREE.Color(spec.baseHex);
  const tipRootCol = new THREE.Color(spec.tipHex);

  for (let i = 0; i < placements.length; i++) {
    const p = placements[i]!;
    const gy = sampleY ? sampleY(p.x, p.z) : 0;
    addGrassTuft(foliage, p.x, gy, p.z, meanHeight, spec, baseRootCol, tipRootCol, p.outwardAz, reactivity, rng);
    if (wildflowers) {
      addWildflowerAccent(foliage, p.x, gy, p.z, meanHeight, style === 'meadow-verge' ? 1.25 : 1.0, reactivity, rng);
    }
  }

  const namePrefix = options.name ?? `husjs.vegetation.grassPatch.${style}`;
  const group = new THREE.Group();
  group.name = namePrefix;

  assembleBotanicalMeshes({
    group,
    namePrefix,
    exposure,
    foliageCollector: foliage,
    uniforms: options.uniforms,
    castCanopyShadow: false,
    ...(options.metadata
      ? {
          metadata: {
            name: options.metadata.name ?? `Grass & Turf Patch (${style})`,
            collection: 'husjs/vegetation Grass & Turf',
            dimensionsMm: [Math.round(spanX * 1000), Math.round(spanZ * 1000), Math.round(meanHeight * 1000)],
            ...options.metadata,
          },
        }
      : {}),
  });

  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = false;
      child.receiveShadow = true;
      child.raycast = NOOP_RAYCAST;
      child.userData['excludeFromRaycast'] = true;
      tagCollisionRole(child, 'ignore');
    }
  });
  group.userData['excludeFromRaycast'] = true;
  tagCollisionRole(group, 'ignore');

  return group;
}

export const createLawnTurf: typeof createGrassPatch = createGrassPatch;
