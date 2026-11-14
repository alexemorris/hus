import * as THREE from 'three';
import type { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import type { WebGPURenderer } from 'three/webgpu';
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
import { ENV_PRESETS } from './env-presets.ts';
import {
  HdrResourcePool,
  MAX_CACHED_CELLS,
  MOBILE_MAX_CACHED_CELLS,
  enqueueUniquePreparedHdrBake,
  getMaxHdrCachedCells,
  type CachedHdrCellTextures,
  type PendingHdrBakeEntry,
} from './hdr-cache-and-pmrem.ts';
import {
  extractRendererHdrLimits,
  startHdrCellLoading,
  type HdrCellLoadStatus,
} from './hdr-cell-loader.ts';
import {
  HdrDualSlotGraph,
  copyBoundSlot,
  populateHdrBoundSlot,
  cubicEaseInOut,
  nowTimestampMs,
  type BoundSlotState,
  type PmremTarget,
} from './hdr-dual-slot-graph.ts';
import {
  bakeProceduralSky,
  resolveMaxHdrDetailWidth,
  type PreparedHdr,
} from './hdr-processing.ts';

export { MAX_CACHED_CELLS, MOBILE_MAX_CACHED_CELLS, getMaxHdrCachedCells, type PmremTarget };

const TIMES_OF_DAY: readonly TimeOfDay[] = ['day', 'dusk', 'night'];

/** Duration (ms) of cubic ease-in-out HDR cross-fades on discrete preset / season / weather changes. */
export const HDR_TRANSITION_DURATION_MS = 900;

const DEFAULT_QUERY_BY_MODE: Readonly<Record<TimeOfDay, EnvironmentHdrQuery>> = {
  day: { season: 'summer', time: 'day', weather: 'clear' },
  dusk: { season: 'summer', time: 'dusk', weather: 'clear' },
  night: { season: 'winter', time: 'night', weather: 'clear' },
};

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

/**
 * Manages procedural sky fallbacks, WebGPU PMREM IBL generation, deferred staging
 * texture disposal, lazy on-demand 3D `(Season × TimeSlot × WeatherRegime)` `.hdr` cell
 * resolution, progressive `_512.hdr` -> `8K` (`8192×4096`) off-thread Web Worker decoding,
 * LRU residency (`8` desktop / `2` mobile), and persistent dual-slot WebGPU TSL cross-blending.
 */
export class HdrEnvironmentManager {
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

  private readonly lastSunDirection = new THREE.Vector3(...ENV_PRESETS.dusk.sunDirection);
  private readonly lastFallbackFogColor = new THREE.Color(ENV_PRESETS.dusk.fogColor);
  private lastQuery: EnvironmentHdrQuery | undefined;
  private lastContinuousBlend: ContinuousEnvironmentHdrBlend | undefined;
  private lastPlusXTrueBearingDeg = DEFAULT_HUS_PLUS_X_BEARING_DEG;
  private pendingPreloadCells: readonly ResolvedEnvironmentHdrCell[] = [];

  private readonly proceduralEnvMaps: Partial<Record<TimeOfDay, THREE.Texture>> = {};
  private readonly proceduralEnvTargets: Partial<Record<TimeOfDay, PmremTarget>> = {};
  private readonly proceduralBgMaps: Partial<Record<TimeOfDay, THREE.Texture>> = {};

  private readonly cellCache = new Map<string, CachedHdrCellTextures>();
  private readonly cellLoadState = new Map<string, HdrCellLoadStatus>();
  private readonly cellLoadPromises = new Map<string, Promise<void>>();
  private readonly pool = new HdrResourcePool();
  private readonly pendingHdrBakes: PendingHdrBakeEntry[] = [];
  private disposed = false;
  private hasBakedProceduralEnvironments = false;
  private hdrUpgradeEnabled = true;
  private readonly activeHdrWorkers = new Set<Worker>();
  private bakedProceduralSkyCount = 0;
  private requestedHdrCount = 0;

  private readonly dualGraph = new HdrDualSlotGraph();

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
    this.targetSlotA = makeInitSlot(
      this.dualGraph.fallbackBgTexA,
      this.dualGraph.fallbackPmremTexA
    );
    this.targetSlotB = makeInitSlot(
      this.dualGraph.fallbackBgTexB,
      this.dualGraph.fallbackPmremTexB
    );
    this.displaySlotA = makeInitSlot(
      this.dualGraph.fallbackBgTexA,
      this.dualGraph.fallbackPmremTexA
    );
    this.displaySlotB = makeInitSlot(
      this.dualGraph.fallbackBgTexB,
      this.dualGraph.fallbackPmremTexB
    );
    this.transFromSlot = makeInitSlot(
      this.dualGraph.fallbackBgTexA,
      this.dualGraph.fallbackPmremTexA
    );

    if (this.renderer) {
      this.dualGraph.ensureInstalled(this.scene);
    }
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

  public hasEquirectBackground(): boolean {
    if (this.dualGraph.isInstalled()) {
      return true;
    }
    return (
      this.scene.background instanceof THREE.Texture &&
      (this.scene.background.mapping === THREE.EquirectangularReflectionMapping ||
        this.scene.background.mapping === THREE.EquirectangularRefractionMapping)
    );
  }

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
      dualGraphInstalled: this.dualGraph.isInstalled(),
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

  public getMaxDetailWidth(renderer: WebGPURenderer): number {
    return resolveMaxHdrDetailWidth(extractRendererHdrLimits(renderer), detectMobile());
  }

  public defaultBakeEquirectPmremTarget(
    renderer: WebGPURenderer,
    equirect: THREE.Texture
  ): PmremTarget {
    return this.pool.bakeEquirectPmremTarget(renderer, equirect);
  }

  private evictLruCellsIfNeeded(renderer: WebGPURenderer): void {
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
    this.pool.evictLruCellsIfNeeded({
      renderer,
      cellCache: this.cellCache,
      cellLoadState: this.cellLoadState,
      cellLoadPromises: this.cellLoadPromises,
      protectedIds,
      displaySlotA: this.displaySlotA,
      displaySlotB: this.displaySlotB,
      isDisposed: () => this.disposed,
      onClearLastBoundIfMatch: (evictedKey) => {
        if (this.lastBoundHdrCell?.cellId === evictedKey) {
          this.lastBoundHdrCell = null;
        }
      },
    });
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
    this.pool.pmremRenderer = activeRenderer;
    this.dualGraph.ensureInstalled(this.scene);

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
    const renderer = this.pool.pmremRenderer ?? this.renderer;
    if (!renderer) return;
    const resolved = this.resolveQueryCell('dusk', query ?? this.lastQuery);
    this.ensureCellLoading(resolved.cellId, resolved.cell, resolved.mode, renderer);
  }

  public async preloadActiveHdr(
    renderer: WebGPURenderer | undefined,
    activeHdrBucket: TimeOfDay,
    sunDirection: THREE.Vector3,
    fallbackFogColor: THREE.Color,
    isInteractiveScrub: boolean,
    query?: EnvironmentHdrQuery
  ): Promise<void> {
    const activeRenderer = renderer ?? this.pool.pmremRenderer ?? this.renderer;
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

  public getRetainedEnvironmentTextures(): THREE.Texture[] {
    const seen = new Set<THREE.Texture>();
    this.dualGraph.collectFallbackTextures(seen);
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
        const renderer = this.pool.pmremRenderer ?? this.renderer;
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
    this.pool.retainedTargets.add(target);
    this.pool.retainedTargets.add(sky);
    this.proceduralEnvTargets[mode] = target;
    this.proceduralEnvMaps[mode] = target.texture;
    this.proceduralBgMaps[mode] = sky;
    this.bakedProceduralSkyCount++;
  }

  private maybeScheduleBackgroundPrewarm(renderer: WebGPURenderer): void {
    if (
      this.disposed ||
      detectMobile() ||
      !this.hdrUpgradeEnabled ||
      !this.hasBakedProceduralEnvironments ||
      this.pendingPreloadCells.length === 0
    ) {
      return;
    }

    const stateA = this.cellLoadState.get(this.activeCellIdA);
    if (stateA !== 'loaded') return;
    if (this.targetBlendT > 0.001 && this.activeCellIdB !== this.activeCellIdA) {
      const stateB = this.cellLoadState.get(this.activeCellIdB);
      if (stateB !== 'loaded') return;
    }

    for (const st of this.cellLoadState.values()) {
      if (st === 'loading-preview' || st === 'loading-full') {
        return;
      }
    }

    const maxCachedCells = getMaxHdrCachedCells(false);
    for (const candidate of this.pendingPreloadCells) {
      const cellId = this.makeCellId(this.environmentSpec, candidate.cell);
      if (this.cellLoadState.has(cellId) || this.cellCache.has(cellId)) {
        continue;
      }
      if (this.cellCache.size >= maxCachedCells) {
        this.evictLruCellsIfNeeded(renderer);
      }
      const mode = timeSlotToTimeOfDay(candidate.cell.time);
      this.ensureCellLoading(cellId, candidate.cell, mode, renderer);
      break;
    }
  }

  public flushPendingHdrBakes(
    activeHdrBucket: TimeOfDay,
    sunDirection: THREE.Vector3,
    fallbackFogColor: THREE.Color,
    isInteractiveScrub: boolean,
    activeQuery?: EnvironmentHdrQuery
  ): boolean {
    if (this.disposed || isInteractiveScrub || this.pendingHdrBakes.length === 0) return false;
    const { count, updatedActive, lastRenderer } = this.pool.drainBakeQueue({
      queue: this.pendingHdrBakes,
      cellCache: this.cellCache,
      cellLoadState: this.cellLoadState,
      horizonGroundByMode: this.horizonGround,
      displaySlotA: this.displaySlotA,
      displaySlotB: this.displaySlotB,
      activeIds: new Set([this.activeCellId, this.activeCellIdA, this.activeCellIdB]),
      bakeEquirectPmrem: this.bakeEquirectPmrem,
      nextLruOrder: () => ++this.lruClock,
      isDisposed: () => this.disposed,
    });

    if (lastRenderer) {
      this.evictLruCellsIfNeeded(lastRenderer);
    }
    if (updatedActive) {
      this.applyEnvironmentTextures(activeHdrBucket, sunDirection, fallbackFogColor, {
        query: activeQuery ?? this.lastQuery,
        continuousBlend: this.lastContinuousBlend,
        plusXTrueBearingDeg: this.lastPlusXTrueBearingDeg,
        animate: false,
      });
      this.onApplyIntensities();
      this.onEnvUpdated?.(false);
    }
    if (lastRenderer) {
      this.maybeScheduleBackgroundPrewarm(lastRenderer);
    }
    return count > 0;
  }

  private enqueuePreparedHdrBake(
    cellId: string,
    cell: HouseEnvironmentHdrCell,
    mode: TimeOfDay,
    tier: 'preview' | 'full',
    renderer: WebGPURenderer,
    prepared: PreparedHdr
  ): void {
    enqueueUniquePreparedHdrBake(this.pendingHdrBakes, {
      cellId,
      cell,
      mode,
      tier,
      renderer,
      prepared,
    });
    this.onEnvUpdated?.(false);
  }

  private ensureCellLoading(
    cellId: string,
    cell: HouseEnvironmentHdrCell,
    mode: TimeOfDay,
    renderer: WebGPURenderer
  ): void {
    if (!this.hdrUpgradeEnabled || this.cellLoadState.has(cellId) || this.disposed) return;
    startHdrCellLoading(
      {
        environmentSpec: this.environmentSpec,
        cellLoadState: this.cellLoadState,
        cellLoadPromises: this.cellLoadPromises,
        activeHdrWorkers: this.activeHdrWorkers,
        getHdrLoader: () => this.hdrLoader,
        setHdrLoader: (loader) => {
          this.hdrLoader = loader;
        },
        isDisposed: () => this.disposed,
        incrementRequestedHdrCount: () => {
          this.requestedHdrCount++;
        },
        enqueuePreparedBake: (id, c, m, tier, r, prepared) => {
          this.enqueuePreparedHdrBake(id, c, m, tier, r, prepared);
        },
      },
      cellId,
      cell,
      mode,
      renderer
    );
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
    populateHdrBoundSlot({
      spec: this.environmentSpec,
      cellId,
      cell,
      mode,
      cachedCell: this.cellCache.get(cellId),
      lastBoundHdrCell: this.lastBoundHdrCell,
      proceduralBg: this.proceduralBgMaps[mode],
      proceduralEnv: this.proceduralEnvMaps[mode],
      horizonGroundByMode: this.horizonGround,
      sunDirOverride,
      plusXTrueBearingDeg,
      fallbackBg,
      fallbackPmrem,
      nextLruOrder: () => ++this.lruClock,
      onUpdateLastBound: (c) => {
        this.lastBoundHdrCell = c;
      },
      out,
    });
  }

  private commitDisplaySlots(
    slotA: BoundSlotState,
    slotB: BoundSlotState,
    blendT: number
  ): void {
    const clampedT = THREE.MathUtils.clamp(blendT, 0, 1);
    copyBoundSlot(slotA, this.displaySlotA);
    copyBoundSlot(slotB, this.displaySlotB);
    this.displayBlendT = clampedT;
    this.hasDisplayState = true;

    this.activeHorizonGround.lerpColors(
      slotA.horizonGround,
      slotB.horizonGround,
      clampedT
    );

    const activeRenderer = this.pool.pmremRenderer ?? this.renderer;
    if (activeRenderer) {
      this.dualGraph.commitWebGpuSlots(this.scene, slotA, slotB, clampedT);
      return;
    }

    this.dualGraph.commitHeadlessFallback(
      this.scene,
      slotA,
      slotB,
      clampedT,
      this.lastFallbackFogColor
    );
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
    const activeRenderer = this.pool.pmremRenderer ?? this.renderer;
    const isMobile = detectMobile();

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

      blendT = cellIdA === cellIdB ? 0 : THREE.MathUtils.clamp(cb.blendT, 0, 1);
      const dominantCell = blendT < 0.5 ? cellA : cellB;
      this.activeCellId = blendT < 0.5 ? cellIdA : cellIdB;
      this.activeCellKey = dominantCell.key;
      this.pendingPreloadCells = isMobile ? [] : cb.preloadCells;
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
      copyBoundSlot(prevDominantSlot, this.transFromSlot);
      this.transFromSlot.horizonGround.copy(this.activeHorizonGround);
    }

    this.resolveBoundSlot(
      cellIdA,
      cellA,
      modeA,
      sunDirOverride,
      plusXTrueBearingDeg,
      this.dualGraph.fallbackBgTexA,
      this.dualGraph.fallbackPmremTexA,
      this.targetSlotA
    );
    if (cellIdB === cellIdA || blendT <= 0.001) {
      copyBoundSlot(this.targetSlotA, this.targetSlotB);
      this.targetBlendT = 0;
    } else {
      this.resolveBoundSlot(
        cellIdB,
        cellB,
        modeB,
        sunDirOverride,
        plusXTrueBearingDeg,
        this.dualGraph.fallbackBgTexB,
        this.dualGraph.fallbackPmremTexB,
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
    this.pool.disposeAll();
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
    this.dualGraph.dispose();
  }
}
