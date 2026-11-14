import * as THREE from 'three';
import {
  equirectUV,
  mix,
  pmremTexture,
  positionWorldDirection,
  texture,
  uniform,
  vec3,
} from 'three/tsl';
import { TempNode, type NodeBuilder } from 'three/webgpu';
import type { HouseEnvironmentHdrCell, HouseEnvironmentHdrSpec } from '../../../core/types/environment-hdri.ts';
import type { TimeOfDay } from '../../../core/types/scene.ts';
import { ENV_PRESETS, environmentRotationForSunXZ } from './env-presets.ts';
import type { CachedHdrCellTextures } from './hdr-cache-and-pmrem.ts';
import { configureEquirect, environmentRotationForTrueNorth } from './hdr-processing.ts';

export type PmremTarget = THREE.RenderTarget;

export interface GpuDisposable {
  dispose(): void;
}

export interface BoundSlotState {
  cellId: string;
  cellKey: string;
  bgTex: THREE.Texture;
  envTex: THREE.Texture;
  rotationY: number;
  horizonGround: THREE.Color;
}

export function cubicEaseInOut(t: number): number {
  const clamped = THREE.MathUtils.clamp(t, 0, 1);
  return clamped < 0.5
    ? 4 * clamped * clamped * clamped
    : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}

export function nowTimestampMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function createFallbackEquirectTexture(): THREE.DataTexture {
  const data = new Uint16Array(2 * 1 * 4);
  const tex = new THREE.DataTexture(data, 2, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  configureEquirect(tex);
  return tex;
}

export function createFallbackPmremTexture(): THREE.DataTexture {
  const data = new Uint16Array(2 * 1 * 4);
  const tex = new THREE.DataTexture(data, 2, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.mapping = THREE.CubeUVReflectionMapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  (tex as unknown as { isPMREMTexture: boolean }).isPMREMTexture = true;
  tex.needsUpdate = true;
  return tex;
}

export function copyBoundSlot(src: BoundSlotState, dst: BoundSlotState): void {
  dst.cellId = src.cellId;
  dst.cellKey = src.cellKey;
  dst.bgTex = src.bgTex;
  dst.envTex = src.envTex;
  dst.rotationY = src.rotationY;
  dst.horizonGround.copy(src.horizonGround);
}

/**
 * Wraps a `PMREMNode` with an independent world-space Y rotation `(cos(theta), sin(theta))` on
 * the radiance/irradiance lookup vector while `scene.environment = null` keeps Three.js's global
 * `materialEnvRotation` at identity. Matches `scene.environmentRotation.set(0, theta, 0)` 1:1.
 */
class RotatedPmremSlotNode extends TempNode {
  private readonly pmremNode: ReturnType<typeof pmremTexture>;
  private readonly cosUniform: ReturnType<typeof uniform<number>>;
  private readonly sinUniform: ReturnType<typeof uniform<number>>;

  public constructor(
    pmremNode: ReturnType<typeof pmremTexture>,
    cosUniform: ReturnType<typeof uniform<number>>,
    sinUniform: ReturnType<typeof uniform<number>>
  ) {
    super('vec3');
    this.pmremNode = pmremNode;
    this.cosUniform = cosUniform;
    this.sinUniform = sinUniform;
  }

  public override setup(builder: NodeBuilder): unknown {
    const parentGetUV = (
      builder as unknown as {
        context?: { getUV?: (node: unknown) => ReturnType<typeof vec3> };
      }
    ).context?.getUV;
    if (!parentGetUV) {
      return this.pmremNode;
    }
    return this.pmremNode.context({
      getUV: (targetNode: unknown) => {
        const uv = parentGetUV(targetNode);
        const rx = uv.x.mul(this.cosUniform).add(uv.z.mul(this.sinUniform));
        const rz = uv.z.mul(this.cosUniform).sub(uv.x.mul(this.sinUniform));
        return vec3(rx, uv.y, rz);
      },
    });
  }
}

function assignPmremNodeTexture(
  node: ReturnType<typeof pmremTexture>,
  nextTex: THREE.Texture
): void {
  if (node.value !== nextTex) {
    node.value = nextTex;
    (node as unknown as { _pmrem: THREE.Texture | null })._pmrem = null;
  }
}

/**
 * Persistent dual-slot WebGPU TSL `backgroundNode` (`mip = 0`) + `environmentNode` graph
 * allowing zero-recompile cross-blending between two active HDR skybox/IBL slots.
 */
export class HdrDualSlotGraph {
  public readonly fallbackBgTexA = createFallbackEquirectTexture();
  public readonly fallbackBgTexB = createFallbackEquirectTexture();
  public readonly fallbackPmremTexA = createFallbackPmremTexture();
  public readonly fallbackPmremTexB = createFallbackPmremTexture();

  private installed = false;
  private bgTexNodeA: ReturnType<typeof texture> | null = null;
  private bgTexNodeB: ReturnType<typeof texture> | null = null;
  private pmremNodeA: ReturnType<typeof pmremTexture> | null = null;
  private pmremNodeB: ReturnType<typeof pmremTexture> | null = null;
  private readonly uRotCosA = uniform(1);
  private readonly uRotSinA = uniform(0);
  private readonly uRotCosB = uniform(1);
  private readonly uRotSinB = uniform(0);
  private readonly uBgBlend = uniform(0);
  private readonly uEnvBlend = uniform(0);

  public isInstalled(): boolean {
    return this.installed;
  }

  public ensureInstalled(scene: THREE.Scene): void {
    if (this.installed) return;
    this.installed = true;

    const dir = positionWorldDirection.normalize();
    const rotDirA = vec3(
      dir.x.mul(this.uRotCosA).sub(dir.z.mul(this.uRotSinA)),
      dir.y,
      dir.x.mul(this.uRotSinA).add(dir.z.mul(this.uRotCosA))
    );
    const rotDirB = vec3(
      dir.x.mul(this.uRotCosB).sub(dir.z.mul(this.uRotSinB)),
      dir.y,
      dir.x.mul(this.uRotSinB).add(dir.z.mul(this.uRotCosB))
    );

    this.bgTexNodeA = texture(this.fallbackBgTexA, equirectUV(rotDirA), 0);
    this.bgTexNodeB = texture(this.fallbackBgTexB, equirectUV(rotDirB), 0);
    const dualBgNode = mix(this.bgTexNodeA, this.bgTexNodeB, this.uBgBlend);

    this.pmremNodeA = pmremTexture(this.fallbackPmremTexA);
    this.pmremNodeB = pmremTexture(this.fallbackPmremTexB);
    const rotPmremA = new RotatedPmremSlotNode(this.pmremNodeA, this.uRotCosA, this.uRotSinA);
    const rotPmremB = new RotatedPmremSlotNode(this.pmremNodeB, this.uRotCosB, this.uRotSinB);
    const dualEnvNode = mix(rotPmremA, rotPmremB, this.uEnvBlend);

    const sceneWithNodes = scene as unknown as {
      backgroundNode: unknown;
      environmentNode: unknown;
    };
    scene.background = null;
    scene.environment = null;
    scene.backgroundRotation.set(0, 0, 0);
    scene.environmentRotation.set(0, 0, 0);
    sceneWithNodes.backgroundNode = dualBgNode;
    sceneWithNodes.environmentNode = dualEnvNode;
  }

  public commitWebGpuSlots(
    scene: THREE.Scene,
    slotA: BoundSlotState,
    slotB: BoundSlotState,
    clampedT: number
  ): void {
    this.ensureInstalled(scene);
    scene.background = null;
    scene.environment = null;
    scene.backgroundBlurriness = 0;

    if (this.bgTexNodeA && this.bgTexNodeA.value !== slotA.bgTex) {
      this.bgTexNodeA.value = slotA.bgTex;
    }
    if (this.bgTexNodeB && this.bgTexNodeB.value !== slotB.bgTex) {
      this.bgTexNodeB.value = slotB.bgTex;
    }
    if (this.pmremNodeA) {
      assignPmremNodeTexture(this.pmremNodeA, slotA.envTex);
    }
    if (this.pmremNodeB) {
      assignPmremNodeTexture(this.pmremNodeB, slotB.envTex);
    }

    this.uRotCosA.value = Math.cos(slotA.rotationY);
    this.uRotSinA.value = Math.sin(slotA.rotationY);
    this.uRotCosB.value = Math.cos(slotB.rotationY);
    this.uRotSinB.value = Math.sin(slotB.rotationY);
    this.uBgBlend.value = clampedT;
    this.uEnvBlend.value = clampedT;
  }

  public commitHeadlessFallback(
    scene: THREE.Scene,
    slotA: BoundSlotState,
    slotB: BoundSlotState,
    clampedT: number,
    fallbackFogColor: THREE.Color
  ): void {
    const sceneWithNodes = scene as unknown as {
      backgroundNode: unknown;
      environmentNode: unknown;
    };
    sceneWithNodes.backgroundNode = null;
    sceneWithNodes.environmentNode = null;

    const primary = clampedT >= 0.5 ? slotB : slotA;
    const hasRealBg =
      primary.bgTex !== this.fallbackBgTexA && primary.bgTex !== this.fallbackBgTexB;
    const hasRealEnv =
      primary.envTex !== this.fallbackPmremTexA && primary.envTex !== this.fallbackPmremTexB;

    if (hasRealBg) {
      scene.background = primary.bgTex;
      scene.backgroundRotation.set(0, primary.rotationY, 0);
      scene.backgroundBlurriness = 0;
    } else {
      if (scene.background instanceof THREE.Color) {
        scene.background.copy(fallbackFogColor);
      } else {
        scene.background = fallbackFogColor.clone();
      }
      scene.backgroundRotation.set(0, primary.rotationY, 0);
    }

    if (hasRealEnv) {
      scene.environment = primary.envTex;
      scene.environmentRotation.set(0, primary.rotationY, 0);
    } else {
      scene.environment = null;
      scene.environmentRotation.set(0, primary.rotationY, 0);
    }
  }

  public collectFallbackTextures(target: Set<THREE.Texture>): void {
    if (!this.installed) return;
    target.add(this.fallbackBgTexA);
    target.add(this.fallbackBgTexB);
    target.add(this.fallbackPmremTexA);
    target.add(this.fallbackPmremTexB);
  }

  public dispose(): void {
    this.fallbackBgTexA.dispose();
    this.fallbackBgTexB.dispose();
    this.fallbackPmremTexA.dispose();
    this.fallbackPmremTexB.dispose();
    this.pmremNodeA?.dispose();
    this.pmremNodeB?.dispose();
  }
}

export function computeHdrSlotRotationY(
  spec: HouseEnvironmentHdrSpec,
  mode: TimeOfDay,
  hdrSunU: number,
  sunDirOverride: THREE.Vector3 | undefined,
  plusXTrueBearingDeg: number
): number {
  if (spec.worldAnchored) {
    return environmentRotationForTrueNorth(plusXTrueBearingDeg, spec.northU ?? 0);
  }
  const cfg = ENV_PRESETS[mode];
  const sunX = sunDirOverride ? sunDirOverride.x : cfg.sunDirection[0];
  const sunZ = sunDirOverride ? sunDirOverride.z : cfg.sunDirection[2];
  return environmentRotationForSunXZ(sunX, sunZ, hdrSunU);
}

export function populateHdrBoundSlot(opts: {
  readonly spec: HouseEnvironmentHdrSpec;
  readonly cellId: string;
  readonly cell: HouseEnvironmentHdrCell;
  readonly mode: TimeOfDay;
  readonly cachedCell: CachedHdrCellTextures | undefined;
  readonly lastBoundHdrCell: CachedHdrCellTextures | null;
  readonly proceduralBg: THREE.Texture | undefined;
  readonly proceduralEnv: THREE.Texture | undefined;
  readonly horizonGroundByMode: Record<TimeOfDay, THREE.Color>;
  readonly sunDirOverride: THREE.Vector3 | undefined;
  readonly plusXTrueBearingDeg: number;
  readonly fallbackBg: THREE.Texture;
  readonly fallbackPmrem: THREE.Texture;
  readonly nextLruOrder: () => number;
  readonly onUpdateLastBound: (cell: CachedHdrCellTextures) => void;
  readonly out: BoundSlotState;
}): void {
  const { cell, mode, out } = opts;
  let bgTex: THREE.Texture | undefined;
  let envTex: THREE.Texture | undefined;
  let hdrSunU = cell.hdrSunU;

  if (opts.cachedCell) {
    opts.cachedCell.lastUsedOrder = opts.nextLruOrder();
    bgTex = opts.cachedCell.bgTex;
    envTex = opts.cachedCell.envTex;
    hdrSunU = opts.cachedCell.cell.hdrSunU;
    opts.onUpdateLastBound(opts.cachedCell);
    out.horizonGround.copy(opts.cachedCell.horizonGround);
    opts.horizonGroundByMode[mode].copy(opts.cachedCell.horizonGround);
  } else if (
    opts.lastBoundHdrCell &&
    (opts.lastBoundHdrCell.mode === 'night') === (mode === 'night')
  ) {
    bgTex = opts.lastBoundHdrCell.bgTex;
    envTex = opts.lastBoundHdrCell.envTex;
    hdrSunU = opts.lastBoundHdrCell.cell.hdrSunU;
    out.horizonGround.setRGB(
      cell.horizonGround[0],
      cell.horizonGround[1],
      cell.horizonGround[2],
      THREE.LinearSRGBColorSpace
    );
    opts.horizonGroundByMode[mode].copy(out.horizonGround);
  } else {
    bgTex = opts.proceduralBg;
    envTex = opts.proceduralEnv;
    hdrSunU = ENV_PRESETS[mode].hdrSunU;
    out.horizonGround.setRGB(
      cell.horizonGround[0],
      cell.horizonGround[1],
      cell.horizonGround[2],
      THREE.LinearSRGBColorSpace
    );
    opts.horizonGroundByMode[mode].copy(out.horizonGround);
  }

  out.cellId = opts.cellId;
  out.cellKey = cell.key;
  out.bgTex = bgTex ?? opts.fallbackBg;
  out.envTex = envTex ?? opts.fallbackPmrem;
  out.rotationY = computeHdrSlotRotationY(
    opts.spec,
    mode,
    hdrSunU,
    opts.sunDirOverride,
    opts.plusXTrueBearingDeg
  );
}
