import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import {
  equirectUV,
  mix,
  pmremTexture,
  positionWorldDirection,
  texture,
  uniform,
  vec3,
} from 'three/tsl';
import { PMREMGenerator, TempNode, type NodeBuilder, type WebGPURenderer } from 'three/webgpu';
import {
  ENGLISH_COUNTRYSIDE_HDR_SPEC,
  normalizeEnvironmentHdrSpec,
  resolveEnvironmentHdrCell,
  timeSlotToTimeOfDay,
  type ContinuousEnvironmentHdrBlend,
  type EnvironmentHdrQuery,
  type HouseEnvironmentHdrCell,
  type HouseEnvironmentHdrSpec,
  type HouseEnvironmentInput,
  type ResolvedEnvironmentHdrCell,
} from '../../../core/types/environment-hdri.ts';
import type { TimeOfDay } from '../../../core/types/scene.ts';
import { DEFAULT_HUS_PLUS_X_BEARING_DEG } from '../../../core/types/solar-weather.ts';
import { detectMobile } from '../../perf/device-tier.ts';
import {
  ENV_PRESETS,
  buildCellEnvPresetConfig,
  environmentRotationForSunXZ,
  resolveHdrAssetUrl,
} from './env-presets.ts';
import type { HdrDecodeRequest, HdrWorkerResponse } from './hdr-decode.worker.ts';
import {
  DEFAULT_MAX_HDR_DETAIL_WIDTH,
  configureEquirect,
  bakeProceduralSky,
  deriveDetailWebpUrl,
  environmentRotationForTrueNorth,
  prepareHdrPanorama,
  wrapPreparedHdrBuffers,
} from './hdr-processing.ts';

const TIMES_OF_DAY: readonly TimeOfDay[] = ['day', 'dusk', 'night'];

/** Maximum resident decoded HDR cells in the LRU cache (protects both active blend slots). */
export const MAX_CACHED_CELLS = 8;

/** Duration (ms) of cubic ease-in-out HDR cross-fades on discrete preset / season / weather changes. */
export const HDR_TRANSITION_DURATION_MS = 900;

const DEFAULT_QUERY_BY_MODE: Readonly<Record<TimeOfDay, EnvironmentHdrQuery>> = {
  day: { season: 'summer', time: 'day', weather: 'clear' },
  dusk: { season: 'summer', time: 'dusk', weather: 'clear' },
  night: { season: 'winter', time: 'night', weather: 'clear' },
};

function cubicEaseInOut(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped < 0.5
    ? 4 * clamped * clamped * clamped
    : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}

function nowTimestampMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
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

interface WebGpuPmremGenerator extends PMREMGenerator {
  fromEquirectangular(
    equirectangular: THREE.Texture,
    renderTarget?: THREE.RenderTarget | null
  ): THREE.RenderTarget;
}

export type PmremTarget = THREE.RenderTarget;

interface GpuDisposable {
  dispose(): void;
}

interface CachedHdrCellTextures {
  readonly cellId: string;
  readonly cell: HouseEnvironmentHdrCell;
  readonly mode: TimeOfDay;
  readonly tier: 'preview' | 'full';
  readonly envTarget: PmremTarget;
  readonly envTex: THREE.Texture;
  readonly bgTex: THREE.Texture;
  readonly horizonGround: THREE.Color;
  lastUsedOrder: number;
}

interface BoundSlotState {
  cellId: string;
  cellKey: string;
  bgTex: THREE.Texture;
  envTex: THREE.Texture;
  rotationY: number;
  horizonGround: THREE.Color;
}

export interface ApplyEnvironmentTexturesOptions {
  readonly query?: EnvironmentHdrQuery;
  readonly continuousBlend?: ContinuousEnvironmentHdrBlend;
  readonly plusXTrueBearingDeg?: number;
  readonly animate?: boolean;
  readonly nowMs?: number;
}

export interface HdrEnvironmentManagerDeps {
  readonly scene: THREE.Scene;
  readonly renderer?: WebGPURenderer;
  readonly environment?: HouseEnvironmentInput;
  readonly bakeEquirectPmrem: (renderer: WebGPURenderer, equirect: THREE.Texture) => PmremTarget;
  readonly onApplyIntensities: () => void;
  readonly onEnvUpdated?: (invalidateShadows?: boolean) => void;
}

function createFallbackEquirectTexture(): THREE.DataTexture {
  const data = new Uint16Array(2 * 1 * 4);
  const tex = new THREE.DataTexture(data, 2, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  configureEquirect(tex);
  return tex;
}

function createFallbackPmremTexture(): THREE.DataTexture {
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
 * Manages procedural sky fallbacks, WebGPU PMREM IBL generation, deferred staging
 * texture disposal, lazy on-demand 3D `(Season × TimeSlot × WeatherRegime)` `.hdr` cell
 * resolution, progressive `_512.hdr` -> `8K` (`8192×4096`) off-thread Web Worker decoding,
 * `MAX_CACHED_CELLS = 8` LRU residency with background pre-warming, and persistent dual-slot
 * WebGPU TSL `backgroundNode` (`mip = 0`) + `environmentNode` cross-blending.
 */
export class HdrEnvironmentManager {
  /** Linear radiance of each canonical bucket's horizon ground band (updated from active HDR cell). */
  public readonly horizonGround: Record<TimeOfDay, THREE.Color> = {
    day: new THREE.Color(ENV_PRESETS.day.groundPasture),
    dusk: new THREE.Color(ENV_PRESETS.dusk.groundPasture),
    night: new THREE.Color(ENV_PRESETS.night.groundPasture),
  };
  public hdrLoader: HDRLoader | null = null;

  private readonly scene: THREE.Scene;
  private readonly renderer?: WebGPURenderer;
  private readonly bakeEquirectPmrem: (
    renderer: WebGPURenderer,
    equirect: THREE.Texture
  ) => PmremTarget;
  private readonly onApplyIntensities: () => void;
  private readonly onEnvUpdated?: (invalidateShadows?: boolean) => void;

  private environmentSpec: HouseEnvironmentHdrSpec;
  private activeCellId = '';
  private activeCellKey = 'dusk';
  private activeCellIdA = '';
  private activeCellIdB = '';
  private activeHorizonGround = new THREE.Color(ENV_PRESETS.dusk.groundPasture);
  private lastBoundHdrCell: CachedHdrCellTextures | null = null;
  private lruClock = 0;

  // Last evaluation parameters so async HDR bake completions & transition ticks stay synchronized
  private readonly lastSunDirection = new THREE.Vector3(...ENV_PRESETS.dusk.sunDirection);
  private readonly lastFallbackFogColor = new THREE.Color(ENV_PRESETS.dusk.fogColor);
  private lastQuery: EnvironmentHdrQuery | undefined;
  private lastContinuousBlend: ContinuousEnvironmentHdrBlend | undefined;
  private lastPlusXTrueBearingDeg = DEFAULT_HUS_PLUS_X_BEARING_DEG;
  private pendingPreloadCells: readonly ResolvedEnvironmentHdrCell[] = [];

  // Lightweight procedural fallback textures (pre-baked once at Frame 0)
  private readonly proceduralEnvMaps: Partial<Record<TimeOfDay, THREE.Texture>> = {};
  private readonly proceduralEnvTargets: Partial<Record<TimeOfDay, PmremTarget>> = {};
  private readonly proceduralBgMaps: Partial<Record<TimeOfDay, THREE.Texture>> = {};

  // Lazily decoded HDR cell LRU cache keyed by `${spec.id}::${cell.key}`
  private readonly cellCache = new Map<string, CachedHdrCellTextures>();
  private readonly cellLoadState = new Map<string, 'loading-preview' | 'loading-full' | 'loaded'>();
  private readonly cellLoadPromises = new Map<string, Promise<void>>();

  private readonly retainedTargets = new Set<GpuDisposable>();
  private readonly pendingDisposables = new Set<GpuDisposable>();
  private readonly pendingHdrBakes: Array<{
    cellId: string;
    cell: HouseEnvironmentHdrCell;
    mode: TimeOfDay;
    tier: 'preview' | 'full';
    renderer: WebGPURenderer;
    prepared: NonNullable<ReturnType<typeof prepareHdrPanorama>>;
  }> = [];
  private readonly webGpuPmremBySize = new Map<number, WebGpuPmremGenerator>();
  private pmremRenderer: WebGPURenderer | null = null;
  private disposed = false;
  private hasBakedProceduralEnvironments = false;
  private hdrUpgradeEnabled = true;
  private readonly activeHdrWorkers = new Set<Worker>();
  private bakedProceduralSkyCount = 0;
  private requestedHdrCount = 0;

  // Persistent Dual-Slot WebGPU TSL Node Graph (`renderer !== undefined`)
  private readonly fallbackBgTexA = createFallbackEquirectTexture();
  private readonly fallbackBgTexB = createFallbackEquirectTexture();
  private readonly fallbackPmremTexA = createFallbackPmremTexture();
  private readonly fallbackPmremTexB = createFallbackPmremTexture();
  private dualGraphInstalled = false;
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

  // Target dual-slot state & animated discrete transition state
  private readonly targetSlotA: BoundSlotState;
  private readonly targetSlotB: BoundSlotState;
  private targetBlendT = 0;

  private readonly displaySlotA: BoundSlotState;
  private readonly displaySlotB: BoundSlotState;
  private displayBlendT = 0;
  private hasDisplayState = false;

  private readonly transFromSlot: BoundSlotState;
  private hdrTransitionActive = false;
  private hdrTransitionStartMs = 0;
  private hdrTransitionDurationMs = HDR_TRANSITION_DURATION_MS;

  public constructor(deps: HdrEnvironmentManagerDeps) {
    this.scene = deps.scene;
    this.renderer = deps.renderer;
    this.environmentSpec = normalizeEnvironmentHdrSpec(
      deps.environment ?? ENGLISH_COUNTRYSIDE_HDR_SPEC
    );
    this.bakeEquirectPmrem = deps.bakeEquirectPmrem;
    this.onApplyIntensities = deps.onApplyIntensities;
    this.onEnvUpdated = deps.onEnvUpdated;

    const initial = resolveEnvironmentHdrCell(this.environmentSpec, DEFAULT_QUERY_BY_MODE.dusk);
    this.activeCellId = this.makeCellId(this.environmentSpec, initial.cell);
    this.activeCellIdA = this.activeCellId;
    this.activeCellIdB = this.activeCellId;
    this.activeCellKey = initial.cell.key;
    this.activeHorizonGround.setRGB(
      initial.cell.horizonGround[0],
      initial.cell.horizonGround[1],
      initial.cell.horizonGround[2],
      THREE.LinearSRGBColorSpace
    );

    const makeInitSlot = (bg: THREE.Texture, env: THREE.Texture): BoundSlotState => ({
      cellId: this.activeCellId,
      cellKey: this.activeCellKey,
      bgTex: bg,
      envTex: env,
      rotationY: 0,
      horizonGround: this.activeHorizonGround.clone(),
    });
    this.targetSlotA = makeInitSlot(this.fallbackBgTexA, this.fallbackPmremTexA);
    this.targetSlotB = makeInitSlot(this.fallbackBgTexB, this.fallbackPmremTexB);
    this.displaySlotA = makeInitSlot(this.fallbackBgTexA, this.fallbackPmremTexA);
    this.displaySlotB = makeInitSlot(this.fallbackBgTexB, this.fallbackPmremTexB);
    this.transFromSlot = makeInitSlot(this.fallbackBgTexA, this.fallbackPmremTexA);

    if (this.renderer) {
      this.ensureDualNodeGraphInstalled();
    }
  }

  private ensureDualNodeGraphInstalled(): void {
    if (this.dualGraphInstalled) return;
    this.dualGraphInstalled = true;

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

    const sceneWithNodes = this.scene as unknown as {
      backgroundNode: unknown;
      environmentNode: unknown;
    };
    this.scene.background = null;
    this.scene.environment = null;
    this.scene.backgroundRotation.set(0, 0, 0);
    this.scene.environmentRotation.set(0, 0, 0);
    sceneWithNodes.backgroundNode = dualBgNode;
    sceneWithNodes.environmentNode = dualEnvNode;
  }

  private makeCellId(spec: HouseEnvironmentHdrSpec, cell: HouseEnvironmentHdrCell): string {
    return `${spec.id}::${cell.key}`;
  }

  public getEnvironmentSpec(): HouseEnvironmentHdrSpec {
    return this.environmentSpec;
  }

  public setEnvironmentSpec(input?: HouseEnvironmentInput): HouseEnvironmentHdrSpec {
    const next = normalizeEnvironmentHdrSpec(input);
    if (next.id !== this.environmentSpec.id || next !== this.environmentSpec) {
      this.environmentSpec = next;
      this.lastBoundHdrCell = null;
      this.pendingPreloadCells = [];
    }
    return this.environmentSpec;
  }

  public getActiveCellKey(): string {
    return this.activeCellKey;
  }

  /** True when an equirectangular skybox (either persistent WebGPU `backgroundNode` or headless `scene.background`) is active. */
  public hasEquirectBackground(): boolean {
    if (this.dualGraphInstalled) {
      return true;
    }
    return (
      this.scene.background instanceof THREE.Texture &&
      (this.scene.background.mapping === THREE.EquirectangularReflectionMapping ||
        this.scene.background.mapping === THREE.EquirectangularRefractionMapping)
    );
  }

  /** Exposes current GPU dual-slot state for diagnostics and unit tests. */
  public getDualSlotState(): {
    readonly dualGraphInstalled: boolean;
    readonly cellKeyA: string;
    readonly cellKeyB: string;
    readonly bgTexA: THREE.Texture;
    readonly bgTexB: THREE.Texture;
    readonly envTexA: THREE.Texture;
    readonly envTexB: THREE.Texture;
    readonly rotationYA: number;
    readonly rotationYB: number;
    readonly blendT: number;
    readonly cachedCellCount: number;
  } {
    return {
      dualGraphInstalled: this.dualGraphInstalled,
      cellKeyA: this.displaySlotA.cellKey,
      cellKeyB: this.displaySlotB.cellKey,
      bgTexA: this.displaySlotA.bgTex,
      bgTexB: this.displaySlotB.bgTex,
      envTexA: this.displaySlotA.envTex,
      envTexB: this.displaySlotB.envTex,
      rotationYA: this.displaySlotA.rotationY,
      rotationYB: this.displaySlotB.rotationY,
      blendT: this.displayBlendT,
      cachedCellCount: this.cellCache.size,
    };
  }

  public getActiveHorizonGround(fallbackBucket: TimeOfDay): THREE.Color {
    if (this.activeCellId) {
      return this.activeHorizonGround;
    }
    return this.horizonGround[fallbackBucket];
  }

  public hasPendingBakes(): boolean {
    return this.pendingHdrBakes.length > 0;
  }

  public isHdrTransitioning(): boolean {
    return this.hdrTransitionActive;
  }

  public cancelHdrTransition(): void {
    if (!this.hdrTransitionActive) return;
    this.hdrTransitionActive = false;
    this.commitDisplaySlots(this.targetSlotA, this.targetSlotB, this.targetBlendT);
  }

  /**
   * Advances any in-flight `900 ms` cubic ease-in-out discrete panorama cross-fade.
   * Returns `true` while the cross-fade is still animating (or just completed on this tick).
   */
  public tickTransition(nowMs = nowTimestampMs()): boolean {
    if (!this.hdrTransitionActive || this.disposed) {
      return false;
    }
    const elapsed = Math.max(0, nowMs - this.hdrTransitionStartMs);
    const rawT = Math.min(1, elapsed / Math.max(1, this.hdrTransitionDurationMs));
    const eased = cubicEaseInOut(rawT);

    if (rawT >= 1) {
      this.hdrTransitionActive = false;
      this.commitDisplaySlots(this.targetSlotA, this.targetSlotB, this.targetBlendT);
      this.onApplyIntensities();
      return false;
    }

    // Choose dominant target slot as destination while cross-fading from `transFromSlot`
    const destSlot = this.targetBlendT >= 0.5 ? this.targetSlotB : this.targetSlotA;
    this.commitDisplaySlots(this.transFromSlot, destSlot, eased);
    this.onApplyIntensities();
    return true;
  }

  public getBakedProceduralSkyCount(): number {
    return this.bakedProceduralSkyCount;
  }

  public getRequestedHdrCount(): number {
    return this.requestedHdrCount;
  }

  private getMaxDetailWidth(renderer: WebGPURenderer): number {
    const deviceLimit = (
      renderer as unknown as {
        backend?: { device?: { limits?: { maxTextureDimension2D?: number } } };
      }
    ).backend?.device?.limits?.maxTextureDimension2D;
    if (typeof deviceLimit === 'number' && Number.isFinite(deviceLimit) && deviceLimit >= 512) {
      return Math.min(DEFAULT_MAX_HDR_DETAIL_WIDTH, Math.floor(deviceLimit));
    }
    return DEFAULT_MAX_HDR_DETAIL_WIDTH;
  }

  public defaultBakeEquirectPmremTarget(
    renderer: WebGPURenderer,
    equirect: THREE.Texture
  ): PmremTarget {
    if (this.pmremRenderer && this.pmremRenderer !== renderer) {
      this.disposeWebGpuPmremGenerators();
    }
    this.pmremRenderer = renderer;

    const widthKey =
      (equirect.image as { width?: number } | null | undefined)?.width ?? 512;
    let pmrem = this.webGpuPmremBySize.get(widthKey);
    if (!pmrem) {
      pmrem = new PMREMGenerator(renderer) as WebGpuPmremGenerator;
      this.webGpuPmremBySize.set(widthKey, pmrem);
    }
    return pmrem.fromEquirectangular(equirect);
  }

  private disposeWebGpuPmremGenerators(): void {
    for (const gen of this.webGpuPmremBySize.values()) {
      gen.dispose();
    }
    this.webGpuPmremBySize.clear();
  }

  /**
   * Releases transient equirectangular staging textures or evicted LRU cache entries only after
   * submitted GPU work completes.
   */
  private disposeTransientStagingResources(
    renderer: WebGPURenderer,
    ...items: ReadonlyArray<GpuDisposable | undefined>
  ): void {
    const valid = items.filter(
      (item): item is GpuDisposable => Boolean(item) && !this.retainedTargets.has(item!)
    );
    if (valid.length === 0) return;
    for (const item of valid) {
      this.pendingDisposables.add(item);
    }

    const flush = (): void => {
      for (const item of valid) {
        if (this.pendingDisposables.delete(item)) {
          item.dispose();
        }
      }
    };

    const queue = (
      renderer as unknown as {
        backend?: { device?: { queue?: { onSubmittedWorkDone?: () => Promise<void> } } };
      }
    ).backend?.device?.queue;
    if (typeof queue?.onSubmittedWorkDone === 'function') {
      void queue.onSubmittedWorkDone().then(
        () => {
          if (!this.disposed) flush();
        },
        () => {
          if (!this.disposed) flush();
        }
      );
      return;
    }

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        if (this.disposed) return;
        requestAnimationFrame(() => {
          if (this.disposed) return;
          requestAnimationFrame(() => {
            if (!this.disposed) flush();
          });
        });
      });
    }
  }

  private evictLruCellsIfNeeded(renderer: WebGPURenderer): void {
    if (this.cellCache.size <= MAX_CACHED_CELLS) return;

    const protectedIds = new Set<string>([
      this.activeCellId,
      this.activeCellIdA,
      this.activeCellIdB,
      this.targetSlotA.cellId,
      this.targetSlotB.cellId,
      this.displaySlotA.cellId,
      this.displaySlotB.cellId,
    ]);
    if (this.hdrTransitionActive) {
      protectedIds.add(this.transFromSlot.cellId);
    }

    while (this.cellCache.size > MAX_CACHED_CELLS) {
      let oldestKey: string | null = null;
      let oldestOrder = Infinity;
      for (const [key, entry] of this.cellCache) {
        if (protectedIds.has(key)) continue;
        if (entry.lastUsedOrder < oldestOrder) {
          oldestOrder = entry.lastUsedOrder;
          oldestKey = key;
        }
      }
      if (!oldestKey) break;

      const evicted = this.cellCache.get(oldestKey)!;
      this.cellCache.delete(oldestKey);
      this.cellLoadState.delete(oldestKey);
      this.cellLoadPromises.delete(oldestKey);
      if (this.lastBoundHdrCell?.cellId === oldestKey) {
        this.lastBoundHdrCell = null;
      }

      // Only release GPU textures that are not currently referenced by any live slot
      const stillBound =
        this.displaySlotA.bgTex === evicted.bgTex ||
        this.displaySlotB.bgTex === evicted.bgTex ||
        this.displaySlotA.envTex === evicted.envTex ||
        this.displaySlotB.envTex === evicted.envTex;
      if (!stillBound) {
        this.retainedTargets.delete(evicted.envTarget);
        this.retainedTargets.delete(evicted.bgTex);
        this.disposeTransientStagingResources(renderer, evicted.envTarget, evicted.bgTex);
      }
    }
  }

  private resolveQueryCell(
    bucket: TimeOfDay,
    query?: EnvironmentHdrQuery
  ): {
    readonly cellId: string;
    readonly cell: HouseEnvironmentHdrCell;
    readonly mode: TimeOfDay;
  } {
    const effectiveQuery = query ?? DEFAULT_QUERY_BY_MODE[bucket];
    const resolved = resolveEnvironmentHdrCell(this.environmentSpec, effectiveQuery);
    const mode = timeSlotToTimeOfDay(resolved.cell.time);
    return {
      cellId: this.makeCellId(this.environmentSpec, resolved.cell),
      cell: resolved.cell,
      mode,
    };
  }

  /**
   * Frame-0 procedural sky + PMREM IBL across the 3 base TimeOfDay buckets and lazy fetch
   * of ONLY the active `(season, time, weather)` `.hdr` cell(s).
   */
  public bakeProceduralEnvironments(
    renderer: WebGPURenderer | undefined,
    activeHdrBucket: TimeOfDay,
    sunDirection: THREE.Vector3,
    fallbackFogColor: THREE.Color,
    options?: {
      readonly deferHdr?: boolean;
      readonly query?: EnvironmentHdrQuery;
      readonly continuousBlend?: ContinuousEnvironmentHdrBlend;
      readonly plusXTrueBearingDeg?: number;
    }
  ): boolean {
    const activeRenderer = renderer ?? this.renderer;
    if (this.hasBakedProceduralEnvironments || !activeRenderer || this.disposed) return false;
    this.hasBakedProceduralEnvironments = true;
    if (options?.deferHdr === true) {
      this.hdrUpgradeEnabled = false;
    }
    this.pmremRenderer = activeRenderer;
    this.ensureDualNodeGraphInstalled();

    for (const mode of TIMES_OF_DAY) {
      this.ensureProceduralBucketOnly(mode, activeRenderer);
    }

    this.applyEnvironmentTextures(activeHdrBucket, sunDirection, fallbackFogColor, {
      query: options?.query,
      continuousBlend: options?.continuousBlend,
      plusXTrueBearingDeg: options?.plusXTrueBearingDeg,
      animate: false,
    });
    return true;
  }

  public startDeferredHdrUpgrade(query?: EnvironmentHdrQuery): void {
    if (this.disposed) return;
    this.hdrUpgradeEnabled = true;
    const renderer = this.pmremRenderer ?? this.renderer;
    if (!renderer) return;
    const resolved = this.resolveQueryCell('dusk', query ?? this.lastQuery);
    this.ensureCellLoading(resolved.cellId, resolved.cell, resolved.mode, renderer);
  }

  /**
   * Lazily fetches & off-thread decodes ONLY the active `(season, time, weather)` `.hdr`
   * cell during `warmUpForStartup()` (while `#loading-screen` is visible) so boot is fast and
   * non-active seasonal/weather panoramas consume zero bandwidth until requested.
   */
  public async preloadActiveHdr(
    renderer: WebGPURenderer | undefined,
    activeHdrBucket: TimeOfDay,
    sunDirection: THREE.Vector3,
    fallbackFogColor: THREE.Color,
    isInteractiveScrub: boolean,
    query?: EnvironmentHdrQuery
  ): Promise<void> {
    const activeRenderer = renderer ?? this.pmremRenderer ?? this.renderer;
    if (this.disposed || !activeRenderer) return;
    this.hdrUpgradeEnabled = true;
    const resolved = this.resolveQueryCell(activeHdrBucket, query);
    this.ensureProceduralBucketOnly(resolved.mode, activeRenderer);
    this.ensureCellLoading(resolved.cellId, resolved.cell, resolved.mode, activeRenderer);
    const pending = this.cellLoadPromises.get(resolved.cellId);
    if (pending) {
      await Promise.race([
        pending,
        new Promise<void>((resolve) => setTimeout(resolve, 4000)),
      ]);
    }
    this.flushPendingHdrBakes(
      activeHdrBucket,
      sunDirection,
      fallbackFogColor,
      isInteractiveScrub,
      query
    );
  }

  /** Returns all currently resident PMREM IBL and skybox textures for upfront GPU upload. */
  public getRetainedEnvironmentTextures(): THREE.Texture[] {
    const seen = new Set<THREE.Texture>();
    if (this.dualGraphInstalled) {
      seen.add(this.fallbackBgTexA);
      seen.add(this.fallbackBgTexB);
      seen.add(this.fallbackPmremTexA);
      seen.add(this.fallbackPmremTexB);
    }
    for (const mode of TIMES_OF_DAY) {
      if (this.proceduralEnvMaps[mode]) seen.add(this.proceduralEnvMaps[mode]!);
      if (this.proceduralBgMaps[mode]) seen.add(this.proceduralBgMaps[mode]!);
    }
    for (const entry of this.cellCache.values()) {
      seen.add(entry.envTex);
      seen.add(entry.bgTex);
    }
    return [...seen];
  }

  /**
   * Precompiles WebGPU `BasicEnvironmentNode` + skybox `GPURenderPipeline`s using already-resident
   * procedural/active textures WITHOUT triggering network fetches for non-active HDR cells.
   */
  public async withEachEnvironmentBucketForCompile(
    activeHdrBucket: TimeOfDay,
    sunDirection: THREE.Vector3,
    fallbackFogColor: THREE.Color,
    onRestoreState: () => void,
    compileStep: (mode: TimeOfDay) => Promise<void>,
    activeQuery?: EnvironmentHdrQuery
  ): Promise<void> {
    const savedUpgrade = this.hdrUpgradeEnabled;
    const savedContinuous = this.lastContinuousBlend;
    const savedBearing = this.lastPlusXTrueBearingDeg;
    this.hdrUpgradeEnabled = false;
    try {
      for (const mode of TIMES_OF_DAY) {
        const renderer = this.pmremRenderer ?? this.renderer;
        if (renderer) {
          this.ensureProceduralBucketOnly(mode, renderer);
        }
        if (!this.proceduralEnvMaps[mode] && !this.proceduralBgMaps[mode]) continue;
        this.applyEnvironmentTextures(mode, sunDirection, fallbackFogColor, {
          query: mode === activeHdrBucket ? activeQuery : DEFAULT_QUERY_BY_MODE[mode],
          plusXTrueBearingDeg: savedBearing,
          animate: false,
        });
        await compileStep(mode);
      }
    } finally {
      this.hdrUpgradeEnabled = savedUpgrade;
      this.applyEnvironmentTextures(activeHdrBucket, sunDirection, fallbackFogColor, {
        query: activeQuery,
        continuousBlend: savedContinuous,
        plusXTrueBearingDeg: savedBearing,
        animate: false,
      });
      onRestoreState();
    }
  }

  private ensureProceduralBucketOnly(
    mode: TimeOfDay,
    renderer: WebGPURenderer
  ): void {
    if (!this.hasBakedProceduralEnvironments || this.disposed || this.proceduralEnvMaps[mode]) {
      return;
    }
    const isMobile = detectMobile();
    const sky = bakeProceduralSky(ENV_PRESETS[mode], isMobile ? 256 : 512, isMobile ? 128 : 256);
    const target = this.bakeEquirectPmrem(renderer, sky);
    this.retainedTargets.add(target);
    this.retainedTargets.add(sky);
    this.proceduralEnvTargets[mode] = target;
    this.proceduralEnvMaps[mode] = target.texture;
    this.proceduralBgMaps[mode] = sky;
    this.bakedProceduralSkyCount++;
  }

  /**
   * Low-priority background pre-warmer: once active slot(s) have finished decoding their `'full'`
   * tier, streams one adjacent time-of-day cell at a time from `pendingPreloadCells` so continuous
   * solar scrubbing finds `8K` cells already resident in GPU memory.
   */
  private maybeScheduleBackgroundPrewarm(renderer: WebGPURenderer): void {
    if (
      this.disposed ||
      !this.hdrUpgradeEnabled ||
      !this.hasBakedProceduralEnvironments ||
      this.pendingPreloadCells.length === 0
    ) {
      return;
    }

    // Wait until active slot A (and slot B when actively blended) finish loading full detail
    const stateA = this.cellLoadState.get(this.activeCellIdA);
    if (stateA !== 'loaded') return;
    if (this.targetBlendT > 0.001 && this.activeCellIdB !== this.activeCellIdA) {
      const stateB = this.cellLoadState.get(this.activeCellIdB);
      if (stateB !== 'loaded') return;
    }

    // Do not spawn more than one background pre-warm worker concurrently
    for (const st of this.cellLoadState.values()) {
      if (st === 'loading-preview' || st === 'loading-full') {
        return;
      }
    }

    for (const candidate of this.pendingPreloadCells) {
      const cellId = this.makeCellId(this.environmentSpec, candidate.cell);
      if (this.cellLoadState.has(cellId) || this.cellCache.has(cellId)) {
        continue;
      }
      if (this.cellCache.size >= MAX_CACHED_CELLS) {
        this.evictLruCellsIfNeeded(renderer);
      }
      const mode = timeSlotToTimeOfDay(candidate.cell.time);
      this.ensureCellLoading(cellId, candidate.cell, mode, renderer);
      break;
    }
  }

  /**
   * Executes any queued HDR PMREM bakes cleanly at the frame boundary (outside any open
   * WebGPU render pass) and updates the active scene environment/background if needed.
   */
  public flushPendingHdrBakes(
    activeHdrBucket: TimeOfDay,
    sunDirection: THREE.Vector3,
    fallbackFogColor: THREE.Color,
    isInteractiveScrub: boolean,
    activeQuery?: EnvironmentHdrQuery
  ): boolean {
    if (this.disposed || isInteractiveScrub || this.pendingHdrBakes.length === 0) return false;
    const batch = this.pendingHdrBakes.splice(0, this.pendingHdrBakes.length);
    let updatedActive = false;
    let lastRenderer: WebGPURenderer | undefined;

    for (const entry of batch) {
      const { cellId, cell, mode, tier, renderer, prepared } = entry;
      lastRenderer = renderer;
      const existing = this.cellCache.get(cellId);
      if (existing?.tier === 'full' && tier === 'preview') {
        this.disposeTransientStagingResources(
          renderer,
          prepared.envSource,
          prepared.background !== prepared.envSource ? prepared.background : undefined
        );
        continue;
      }

      const envTarget = this.bakeEquirectPmrem(renderer, prepared.envSource);
      this.retainedTargets.add(envTarget);
      this.retainedTargets.add(prepared.background);
      const bgTex = prepared.background;
      this.disposeTransientStagingResources(
        renderer,
        prepared.envSource !== prepared.background ? prepared.envSource : undefined
      );

      // Release superseded preview entry once full tier is baked
      if (existing) {
        const previewStillBound =
          this.displaySlotA.bgTex === existing.bgTex ||
          this.displaySlotB.bgTex === existing.bgTex ||
          this.displaySlotA.envTex === existing.envTex ||
          this.displaySlotB.envTex === existing.envTex;
        if (!previewStillBound) {
          this.retainedTargets.delete(existing.envTarget);
          this.retainedTargets.delete(existing.bgTex);
          this.disposeTransientStagingResources(renderer, existing.envTarget, existing.bgTex);
        }
      }

      const horizonColor = new THREE.Color().copy(prepared.horizonGround);
      const cached: CachedHdrCellTextures = {
        cellId,
        cell,
        mode,
        tier,
        envTarget,
        envTex: envTarget.texture,
        bgTex,
        horizonGround: horizonColor,
        lastUsedOrder: ++this.lruClock,
      };
      this.cellCache.set(cellId, cached);
      this.horizonGround[mode].copy(horizonColor);
      if (tier === 'full') {
        this.cellLoadState.set(cellId, 'loaded');
      }

      if (
        cellId === this.activeCellId ||
        cellId === this.activeCellIdA ||
        cellId === this.activeCellIdB
      ) {
        updatedActive = true;
      }
    }

    if (lastRenderer) {
      this.evictLruCellsIfNeeded(lastRenderer);
    }

    if (updatedActive) {
      this.applyEnvironmentTextures(
        activeHdrBucket,
        sunDirection,
        fallbackFogColor,
        {
          query: activeQuery ?? this.lastQuery,
          continuousBlend: this.lastContinuousBlend,
          plusXTrueBearingDeg: this.lastPlusXTrueBearingDeg,
          animate: false,
        }
      );
      this.onApplyIntensities();
      this.onEnvUpdated?.(false);
    }

    if (lastRenderer) {
      this.maybeScheduleBackgroundPrewarm(lastRenderer);
    }
    return batch.length > 0;
  }

  private enqueuePreparedHdrBake(
    cellId: string,
    cell: HouseEnvironmentHdrCell,
    mode: TimeOfDay,
    tier: 'preview' | 'full',
    renderer: WebGPURenderer,
    prepared: NonNullable<ReturnType<typeof prepareHdrPanorama>>
  ): void {
    for (let i = this.pendingHdrBakes.length - 1; i >= 0; i--) {
      const queued = this.pendingHdrBakes[i]!;
      if (queued.cellId === cellId && (queued.tier === tier || tier === 'full')) {
        const stale = this.pendingHdrBakes.splice(i, 1)[0]!;
        stale.prepared.envSource.dispose();
        if (stale.prepared.background !== stale.prepared.envSource) {
          stale.prepared.background.dispose();
        }
      }
    }
    this.pendingHdrBakes.push({ cellId, cell, mode, tier, renderer, prepared });
    this.onEnvUpdated?.(false);
  }

  /**
   * Lazily streams & decodes a single `(season, time, weather)` `.hdr` cell off-thread:
   *  - Desktop Worker path: streams `_512.hdr` fast preview first (when available), then upgrades
   *    to full `2K` `.hdr` + `8K` `.webp` detail (clamped to `maxTextureDimension2D`).
   *  - Mobile path: fetches only `_512.hdr` preview.
   *  - Unit-test / injected `this.hdrLoader` path: loads directly via `this.hdrLoader`.
   */
  private ensureCellLoading(
    cellId: string,
    cell: HouseEnvironmentHdrCell,
    mode: TimeOfDay,
    renderer: WebGPURenderer
  ): void {
    if (!this.hdrUpgradeEnabled || this.cellLoadState.has(cellId) || this.disposed) return;

    const isMobile = detectMobile();
    const cfg = buildCellEnvPresetConfig(this.environmentSpec, cell);
    const fullUrl = resolveHdrAssetUrl(cell.hdrUrl);
    const previewUrl = cell.previewHdrUrl ? resolveHdrAssetUrl(cell.previewHdrUrl) : undefined;
    const maxDetailWidth = this.getMaxDetailWidth(renderer);

    if (isMobile && !previewUrl) {
      return;
    }

    this.requestedHdrCount++;

    if (this.hdrLoader === null && typeof Worker === 'function') {
      const hasDistinctPreview = Boolean(previewUrl && previewUrl !== fullUrl);
      const stages: Array<{ readonly tier: 'preview' | 'full'; readonly url: string }> = isMobile
        ? [{ tier: 'full', url: previewUrl! }]
        : hasDistinctPreview
          ? [
              { tier: 'preview', url: previewUrl! },
              { tier: 'full', url: fullUrl },
            ]
          : [{ tier: 'full', url: fullUrl }];

      this.cellLoadState.set(
        cellId,
        stages[0]!.tier === 'preview' ? 'loading-preview' : 'loading-full'
      );

      const detailOverride = cell.detailUrl ? resolveHdrAssetUrl(cell.detailUrl) : undefined;

      const loadPromise = new Promise<void>((resolve) => {
        let worker: Worker;
        try {
          worker = new Worker(new URL('./hdr-decode.worker.ts', import.meta.url), {
            type: 'module',
          });
          this.activeHdrWorkers.add(worker);
          let stageIndex = 0;

          const cleanup = (): void => {
            if (this.activeHdrWorkers.delete(worker)) {
              worker.terminate();
            }
          };

          const postStage = (idx: number): void => {
            const stage = stages[idx]!;
            const resolvedUrl =
              typeof window !== 'undefined' && window.location
                ? new URL(stage.url, window.location.href).href
                : stage.url;
            const rawDetailUrl =
              stage.tier === 'full' ? deriveDetailWebpUrl(stage.url, detailOverride) : null;
            const resolvedDetailUrl =
              rawDetailUrl && typeof window !== 'undefined' && window.location
                ? new URL(rawDetailUrl, window.location.href).href
                : rawDetailUrl;
            const req: HdrDecodeRequest = {
              cellId,
              tier: stage.tier,
              mode,
              url: resolvedUrl,
              detailUrl: resolvedDetailUrl,
              maxDetailWidth,
              hdrSunU: cfg.hdrSunU,
              hdrSunV: cfg.hdrSunV,
              relocateDaySun: Boolean(cfg.relocateDaySun),
              zenithDarkening: cfg.zenithDarkening,
            };
            worker.postMessage(req);
          };

          worker.onmessage = (event: MessageEvent<HdrWorkerResponse>): void => {
            const msg = event.data;
            if (this.disposed) {
              cleanup();
              resolve();
              return;
            }
            if (msg?.ok) {
              const prepared = wrapPreparedHdrBuffers({
                width: msg.width,
                height: msg.height,
                bgWidth: msg.bgWidth,
                bgHeight: msg.bgHeight,
                envWidth: msg.envWidth,
                envHeight: msg.envHeight,
                bgData: new Uint16Array(msg.bgBuffer),
                envData: new Uint16Array(msg.envBuffer),
                avgR: msg.avgR,
                avgG: msg.avgG,
                avgB: msg.avgB,
              });
              this.enqueuePreparedHdrBake(cellId, cell, mode, msg.tier, renderer, prepared);
            }

            stageIndex++;
            if (stageIndex < stages.length) {
              this.cellLoadState.set(cellId, 'loading-full');
              postStage(stageIndex);
              return;
            }

            cleanup();
            resolve();
          };

          worker.onerror = (): void => {
            cleanup();
            resolve();
          };

          postStage(0);
          return;
        } catch {
          // Fall through to HDRLoader if Worker instantiation is unavailable.
        }
        resolve();
      });

      this.cellLoadPromises.set(cellId, loadPromise);
      return;
    }

    // Injected mock `hdrLoader` (unit tests) or non-Worker environment
    this.cellLoadState.set(cellId, 'loading-full');
    if (!this.hdrLoader) {
      this.hdrLoader = new HDRLoader().setDataType(THREE.FloatType);
    }
    const targetUrl = isMobile && previewUrl ? previewUrl : fullUrl;
    const loadPromise = new Promise<void>((resolve) => {
      this.hdrLoader!.load(
        targetUrl,
        (loadedTex) => {
          if (this.disposed) {
            loadedTex.dispose();
            resolve();
            return;
          }
          const prepared = prepareHdrPanorama(loadedTex, cfg, null, maxDetailWidth);
          loadedTex.dispose();
          if (prepared) {
            this.enqueuePreparedHdrBake(cellId, cell, mode, 'full', renderer, prepared);
          }
          resolve();
        },
        undefined,
        () => {
          resolve();
        }
      );
    });
    this.cellLoadPromises.set(cellId, loadPromise);
  }

  private computeSlotRotationY(
    mode: TimeOfDay,
    hdrSunU: number,
    sunDirOverride: THREE.Vector3 | undefined,
    plusXTrueBearingDeg: number
  ): number {
    if (this.environmentSpec.worldAnchored) {
      return environmentRotationForTrueNorth(
        plusXTrueBearingDeg,
        this.environmentSpec.northU ?? 0
      );
    }
    const cfg = ENV_PRESETS[mode];
    const sunX = sunDirOverride ? sunDirOverride.x : cfg.sunDirection[0];
    const sunZ = sunDirOverride ? sunDirOverride.z : cfg.sunDirection[2];
    return environmentRotationForSunXZ(sunX, sunZ, hdrSunU);
  }

  private resolveBoundSlot(
    cellId: string,
    cell: HouseEnvironmentHdrCell,
    mode: TimeOfDay,
    sunDirOverride: THREE.Vector3 | undefined,
    plusXTrueBearingDeg: number,
    fallbackBg: THREE.Texture,
    fallbackPmrem: THREE.Texture,
    out: BoundSlotState
  ): void {
    const cachedCell = this.cellCache.get(cellId);
    let bgTex: THREE.Texture | undefined;
    let envTex: THREE.Texture | undefined;
    let hdrSunU = cell.hdrSunU;

    if (cachedCell) {
      cachedCell.lastUsedOrder = ++this.lruClock;
      bgTex = cachedCell.bgTex;
      envTex = cachedCell.envTex;
      hdrSunU = cachedCell.cell.hdrSunU;
      this.lastBoundHdrCell = cachedCell;
      out.horizonGround.copy(cachedCell.horizonGround);
      this.horizonGround[mode].copy(cachedCell.horizonGround);
    } else if (
      this.lastBoundHdrCell &&
      (this.lastBoundHdrCell.mode === 'night') === (mode === 'night')
    ) {
      bgTex = this.lastBoundHdrCell.bgTex;
      envTex = this.lastBoundHdrCell.envTex;
      hdrSunU = this.lastBoundHdrCell.cell.hdrSunU;
      out.horizonGround.setRGB(
        cell.horizonGround[0],
        cell.horizonGround[1],
        cell.horizonGround[2],
        THREE.LinearSRGBColorSpace
      );
      this.horizonGround[mode].copy(out.horizonGround);
    } else {
      bgTex = this.proceduralBgMaps[mode];
      envTex = this.proceduralEnvMaps[mode];
      hdrSunU = ENV_PRESETS[mode].hdrSunU;
      out.horizonGround.setRGB(
        cell.horizonGround[0],
        cell.horizonGround[1],
        cell.horizonGround[2],
        THREE.LinearSRGBColorSpace
      );
      this.horizonGround[mode].copy(out.horizonGround);
    }

    out.cellId = cellId;
    out.cellKey = cell.key;
    out.bgTex = bgTex ?? fallbackBg;
    out.envTex = envTex ?? fallbackPmrem;
    out.rotationY = this.computeSlotRotationY(
      mode,
      hdrSunU,
      sunDirOverride,
      plusXTrueBearingDeg
    );
  }

  private copyBoundSlot(src: BoundSlotState, dst: BoundSlotState): void {
    dst.cellId = src.cellId;
    dst.cellKey = src.cellKey;
    dst.bgTex = src.bgTex;
    dst.envTex = src.envTex;
    dst.rotationY = src.rotationY;
    dst.horizonGround.copy(src.horizonGround);
  }

  private commitDisplaySlots(
    slotA: BoundSlotState,
    slotB: BoundSlotState,
    blendT: number
  ): void {
    const clampedT = Math.max(0, Math.min(1, blendT));
    this.copyBoundSlot(slotA, this.displaySlotA);
    this.copyBoundSlot(slotB, this.displaySlotB);
    this.displayBlendT = clampedT;
    this.hasDisplayState = true;

    this.activeHorizonGround.lerpColors(
      slotA.horizonGround,
      slotB.horizonGround,
      clampedT
    );

    const activeRenderer = this.pmremRenderer ?? this.renderer;
    if (activeRenderer) {
      this.ensureDualNodeGraphInstalled();
      this.scene.background = null;
      this.scene.environment = null;
      this.scene.backgroundBlurriness = 0;

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
      return;
    }

    // Headless fallback (`this.renderer === undefined`): bind primary slot directly to `scene`
    const sceneWithNodes = this.scene as unknown as {
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
      this.scene.background = primary.bgTex;
      this.scene.backgroundRotation.set(0, primary.rotationY, 0);
      this.scene.backgroundBlurriness = 0;
    } else {
      if (this.scene.background instanceof THREE.Color) {
        this.scene.background.copy(this.lastFallbackFogColor);
      } else {
        this.scene.background = this.lastFallbackFogColor.clone();
      }
      this.scene.backgroundRotation.set(0, primary.rotationY, 0);
    }

    if (hasRealEnv) {
      this.scene.environment = primary.envTex;
      this.scene.environmentRotation.set(0, primary.rotationY, 0);
    } else {
      this.scene.environment = null;
      this.scene.environmentRotation.set(0, primary.rotationY, 0);
    }
  }

  public applyEnvironmentTextures(
    bucket: TimeOfDay,
    sunDirOverride: THREE.Vector3 | undefined,
    fallbackFogColor: THREE.Color,
    queryOrOptions?: EnvironmentHdrQuery | ApplyEnvironmentTexturesOptions
  ): void {
    const isQuery =
      queryOrOptions !== undefined &&
      'season' in queryOrOptions &&
      'time' in queryOrOptions &&
      'weather' in queryOrOptions;
    const opts: ApplyEnvironmentTexturesOptions = isQuery
      ? { query: queryOrOptions }
      : (queryOrOptions ?? {});

    if (sunDirOverride) {
      this.lastSunDirection.copy(sunDirOverride);
    }
    this.lastFallbackFogColor.copy(fallbackFogColor);
    this.lastQuery = opts.query;
    this.lastContinuousBlend = opts.continuousBlend;
    if (opts.plusXTrueBearingDeg !== undefined) {
      this.lastPlusXTrueBearingDeg = opts.plusXTrueBearingDeg;
    }
    const plusXTrueBearingDeg = this.lastPlusXTrueBearingDeg;
    const activeRenderer = this.pmremRenderer ?? this.renderer;

    let cellA: HouseEnvironmentHdrCell;
    let cellIdA: string;
    let modeA: TimeOfDay;
    let cellB: HouseEnvironmentHdrCell;
    let cellIdB: string;
    let modeB: TimeOfDay;
    let blendT = 0;

    if (opts.continuousBlend) {
      const cb = opts.continuousBlend;
      cellA = cb.cellA.cell;
      cellIdA = this.makeCellId(this.environmentSpec, cellA);
      modeA = timeSlotToTimeOfDay(cellA.time);

      cellB = cb.cellB.cell;
      cellIdB = this.makeCellId(this.environmentSpec, cellB);
      modeB = timeSlotToTimeOfDay(cellB.time);

      blendT = cellIdA === cellIdB ? 0 : Math.max(0, Math.min(1, cb.blendT));
      const dominantCell = blendT < 0.5 ? cellA : cellB;
      this.activeCellId = blendT < 0.5 ? cellIdA : cellIdB;
      this.activeCellKey = dominantCell.key;
      this.pendingPreloadCells = cb.preloadCells;
    } else {
      const resolved = this.resolveQueryCell(bucket, opts.query);
      cellA = resolved.cell;
      cellIdA = resolved.cellId;
      modeA = resolved.mode;
      cellB = cellA;
      cellIdB = cellIdA;
      modeB = modeA;
      blendT = 0;
      this.activeCellId = cellIdA;
      this.activeCellKey = cellA.key;
      this.pendingPreloadCells = [];
    }

    this.activeCellIdA = cellIdA;
    this.activeCellIdB = cellIdB;

    if (activeRenderer && this.hasBakedProceduralEnvironments) {
      this.ensureProceduralBucketOnly(modeA, activeRenderer);
      this.ensureCellLoading(cellIdA, cellA, modeA, activeRenderer);
      if (cellIdB !== cellIdA && blendT > 0.001) {
        this.ensureProceduralBucketOnly(modeB, activeRenderer);
        this.ensureCellLoading(cellIdB, cellB, modeB, activeRenderer);
      }
      this.evictLruCellsIfNeeded(activeRenderer);
    }

    const prevDominantSlot =
      this.displayBlendT >= 0.5 ? this.displaySlotB : this.displaySlotA;
    const prevCellId = this.hasDisplayState ? prevDominantSlot.cellId : '';
    if (this.hasDisplayState) {
      this.copyBoundSlot(prevDominantSlot, this.transFromSlot);
      // Preserve blended horizon ground at the moment a new discrete transition starts
      this.transFromSlot.horizonGround.copy(this.activeHorizonGround);
    }

    this.resolveBoundSlot(
      cellIdA,
      cellA,
      modeA,
      sunDirOverride,
      plusXTrueBearingDeg,
      this.fallbackBgTexA,
      this.fallbackPmremTexA,
      this.targetSlotA
    );
    if (cellIdB === cellIdA || blendT <= 0.001) {
      this.copyBoundSlot(this.targetSlotA, this.targetSlotB);
      this.targetBlendT = 0;
    } else {
      this.resolveBoundSlot(
        cellIdB,
        cellB,
        modeB,
        sunDirOverride,
        plusXTrueBearingDeg,
        this.fallbackBgTexB,
        this.fallbackPmremTexB,
        this.targetSlotB
      );
      this.targetBlendT = blendT;
    }

    const nextDominantSlot =
      this.targetBlendT >= 0.5 ? this.targetSlotB : this.targetSlotA;
    const shouldAnimate =
      Boolean(opts.animate) &&
      activeRenderer !== undefined &&
      this.hasDisplayState &&
      (prevCellId !== nextDominantSlot.cellId ||
        this.transFromSlot.bgTex !== nextDominantSlot.bgTex ||
        this.transFromSlot.envTex !== nextDominantSlot.envTex);

    if (shouldAnimate) {
      this.hdrTransitionActive = true;
      this.hdrTransitionStartMs = opts.nowMs ?? nowTimestampMs();
      this.hdrTransitionDurationMs = HDR_TRANSITION_DURATION_MS;
      this.commitDisplaySlots(this.transFromSlot, nextDominantSlot, 0);
    } else if (opts.animate === false || !this.hdrTransitionActive) {
      this.hdrTransitionActive = false;
      this.commitDisplaySlots(this.targetSlotA, this.targetSlotB, this.targetBlendT);
    }

    if (activeRenderer) {
      this.maybeScheduleBackgroundPrewarm(activeRenderer);
    }
    this.onApplyIntensities();
  }

  public dispose(): void {
    this.disposed = true;
    this.hdrTransitionActive = false;
    for (const worker of this.activeHdrWorkers) {
      worker.terminate();
    }
    this.activeHdrWorkers.clear();
    for (const queued of this.pendingHdrBakes) {
      queued.prepared.envSource.dispose();
      if (queued.prepared.background !== queued.prepared.envSource) {
        queued.prepared.background.dispose();
      }
    }
    this.pendingHdrBakes.length = 0;
    for (const item of this.pendingDisposables) {
      item.dispose();
    }
    this.pendingDisposables.clear();
    for (const item of this.retainedTargets) {
      item.dispose();
    }
    this.retainedTargets.clear();
    this.cellCache.clear();
    this.cellLoadState.clear();
    this.cellLoadPromises.clear();
    this.lastBoundHdrCell = null;
    for (const mode of TIMES_OF_DAY) {
      this.proceduralBgMaps[mode]?.dispose();
      this.proceduralEnvTargets[mode]?.dispose();
      this.proceduralEnvMaps[mode]?.dispose();
      delete this.proceduralBgMaps[mode];
      delete this.proceduralEnvTargets[mode];
      delete this.proceduralEnvMaps[mode];
    }
    this.fallbackBgTexA.dispose();
    this.fallbackBgTexB.dispose();
    this.fallbackPmremTexA.dispose();
    this.fallbackPmremTexB.dispose();
    this.pmremNodeA?.dispose();
    this.pmremNodeB?.dispose();
    this.disposeWebGpuPmremGenerators();
    this.pmremRenderer = null;
  }
}
