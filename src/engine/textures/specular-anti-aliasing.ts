/**
 * Geometric Specular Anti-Aliasing (Kaplanyan & Antonov 2016 / Toksvig) in TSL + CPU reference.
 *
 * Filters microfacet GGX / clearcoat roughness using screen-space normal derivatives
 * (`dFdx(normalView)`, `dFdy(normalView)`) so sub-pixel bevels, grazing mouldings, brass/chrome
 * hardware, glazing bars, and normal-mapped surfaces stay free of specular shimmer and fireflies
 * with zero extra texture bindings.
 */
import type * as THREE from 'three';
import type { Node } from 'three/webgpu';
import {
  clamp,
  dFdx,
  dFdy,
  dot,
  float,
  min,
  normalView,
  type ShaderNodeObject,
  sqrt,
} from 'three/tsl';

export const DEFAULT_SPECULAR_AA_SIGMA = 0.5;
export const DEFAULT_SPECULAR_AA_MAX_VARIANCE = 0.18;

export interface SpecularAntiAliasingOptions {
  /** Pixel filter footprint standard deviation in screen texels (`0.5` by default). */
  readonly sigma?: number;
  /** Maximum normal-variance clamp preventing over-blurring at silhouette discontinuities (`0.18` by default). */
  readonly maxVariance?: number;
  /** Set `false` to opt a specific material out of geometric specular AA (`true` by default). */
  readonly enabled?: boolean;
}

export interface SpecularAntiAliasingMetadata {
  readonly enabled: boolean;
  readonly sigma: number;
  readonly maxVariance: number;
}

const DEFAULT_METADATA: SpecularAntiAliasingMetadata = Object.freeze({
  enabled: true,
  sigma: DEFAULT_SPECULAR_AA_SIGMA,
  maxVariance: DEFAULT_SPECULAR_AA_MAX_VARIANCE,
});

const materialSpecularAaRegistry = new WeakMap<THREE.Material, SpecularAntiAliasingMetadata>();

/**
 * Pure CPU reference for Kaplanyan & Antonov 2016 screen-space normal-variance roughness filtering:
 * `filtered = sqrt(clamp(baseRoughness^2 + min(maxVariance, sigma^2 * (|dn/du|^2 + |dn/dv|^2)), 0, 1))`.
 */
export function computeGeometricSpecularAaRoughnessCpu(
  baseRoughness: number,
  dnduLenSq: number,
  dndvLenSq: number,
  sigma = DEFAULT_SPECULAR_AA_SIGMA,
  maxVariance = DEFAULT_SPECULAR_AA_MAX_VARIANCE
): number {
  const safeBase = Math.min(1.0, Math.max(0.0, baseRoughness));
  const safeSigma = Math.max(0.0, sigma);
  const safeMaxVariance = Math.max(0.0, maxVariance);
  const slopeEnergy = Math.max(0.0, dnduLenSq) + Math.max(0.0, dndvLenSq);
  const kernelVariance = Math.min(safeMaxVariance, safeSigma * safeSigma * slopeEnergy);
  const roughnessSq = safeBase * safeBase;
  return Math.sqrt(Math.min(1.0, Math.max(0.0, roughnessSq + kernelVariance)));
}

/**
 * Builds a TSL node computing variance-filtered microfacet roughness from screen-space partial
 * derivatives of `normalNode` (`normalView` or `clearcoatNormalView`).
 *
 * Must be evaluated in uniform fragment control flow (e.g. `PhysicalLightingModel.start`).
 */
export function buildGeometricSpecularRoughnessNode<
  TRoughness extends Node = Node,
  TNormal extends Node = Node,
>(
  baseRoughnessNode: ShaderNodeObject<TRoughness>,
  normalNode: ShaderNodeObject<TNormal> = normalView as unknown as ShaderNodeObject<TNormal>,
  opts?: SpecularAntiAliasingOptions
): ShaderNodeObject<Node> {
  const baseRoughness = float(baseRoughnessNode as unknown as ShaderNodeObject<Node>);
  const normal = normalNode as unknown as ShaderNodeObject<Node>;
  const sigma = Math.max(0.0, opts?.sigma ?? DEFAULT_SPECULAR_AA_SIGMA);
  const maxVariance = Math.max(0.0, opts?.maxVariance ?? DEFAULT_SPECULAR_AA_MAX_VARIANCE);
  if (opts?.enabled === false || sigma <= 0.0 || maxVariance <= 0.0) {
    return clamp(baseRoughness, 0.0, 1.0);
  }
  const dndu = dFdx(normal);
  const dndv = dFdy(normal);
  const variance = min(
    float(maxVariance),
    float(sigma * sigma).mul(dot(dndu, dndu).add(dot(dndv, dndv)))
  );
  return sqrt(clamp(baseRoughness.mul(baseRoughness).add(variance), 0.0, 1.0));
}

/**
 * Registers calibrated Geometric Specular AA parameters for a `MeshStandardMaterial` or
 * `MeshPhysicalMaterial` (and attaches `roughnessNode` directly if a TSL `NodeMaterial` with an
 * explicit `roughnessNode` is supplied), without mutating `material.userData` so scene snapshots
 * and static batch deduplication stay 100% intact.
 */
export function applyGeometricSpecularAA<
  T extends THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
>(material: T, options?: SpecularAntiAliasingOptions): T {
  const enabled = options?.enabled !== false;
  const sigma = Math.max(0.0, options?.sigma ?? DEFAULT_SPECULAR_AA_SIGMA);
  const maxVariance = Math.max(0.0, options?.maxVariance ?? DEFAULT_SPECULAR_AA_MAX_VARIANCE);
  const meta: SpecularAntiAliasingMetadata =
    enabled &&
    sigma === DEFAULT_SPECULAR_AA_SIGMA &&
    maxVariance === DEFAULT_SPECULAR_AA_MAX_VARIANCE
      ? DEFAULT_METADATA
      : Object.freeze({ enabled, sigma, maxVariance });

  materialSpecularAaRegistry.set(material, meta);

  const nodeMat = material as unknown as {
    isNodeMaterial?: boolean;
    roughnessNode?: ShaderNodeObject<Node> | null;
  };
  if (enabled && nodeMat.isNodeMaterial === true && nodeMat.roughnessNode) {
    nodeMat.roughnessNode = buildGeometricSpecularRoughnessNode(
      nodeMat.roughnessNode,
      normalView,
      meta
    );
  }

  return material;
}

/** Returns registered Geometric Specular AA metadata for `material`, or `undefined` if not explicitly tagged. */
export function getGeometricSpecularAAMetadata(
  material: THREE.Material | null | undefined
): SpecularAntiAliasingMetadata | undefined {
  if (!material) return undefined;
  return materialSpecularAaRegistry.get(material);
}

/** Resolves effective Geometric Specular AA settings for `material` inside `PhysicalLightingModel.start`. */
export function resolveMaterialSpecularAA(
  material: THREE.Material | null | undefined
): SpecularAntiAliasingMetadata {
  if (!material) return DEFAULT_METADATA;
  if (material.userData?.['specularAA'] === false) {
    return { enabled: false, sigma: 0, maxVariance: 0 };
  }
  return materialSpecularAaRegistry.get(material) ?? DEFAULT_METADATA;
}
