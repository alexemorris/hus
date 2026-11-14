import * as THREE from 'three';
import { PMREMGenerator, type WebGPURenderer } from 'three/webgpu';
import type { HouseEnvironmentHdrCell } from '../../../core/types/environment-hdri.ts';
import type { TimeOfDay } from '../../../core/types/scene.ts';
import { detectMobile } from '../../perf/device-tier.ts';
import type { HdrCellLoadStatus } from './hdr-cell-loader.ts';
import type { BoundSlotState, GpuDisposable, PmremTarget } from './hdr-dual-slot-graph.ts';
import type { PreparedHdr } from './hdr-processing.ts';

export interface PendingHdrBakeEntry {
  readonly cellId: string;
  readonly cell: HouseEnvironmentHdrCell;
  readonly mode: TimeOfDay;
  readonly tier: 'preview' | 'full';
  readonly renderer: WebGPURenderer;
  readonly prepared: PreparedHdr;
}

export function enqueueUniquePreparedHdrBake(
  queue: PendingHdrBakeEntry[],
  entry: PendingHdrBakeEntry
): void {
  for (let i = queue.length - 1; i >= 0; i--) {
    const queued = queue[i]!;
    if (queued.cellId === entry.cellId && (queued.tier === entry.tier || entry.tier === 'full')) {
      const stale = queue.splice(i, 1)[0]!;
      stale.prepared.envSource.dispose();
      if (stale.prepared.background !== stale.prepared.envSource) {
        stale.prepared.background.dispose();
      }
    }
  }
  queue.push(entry);
}

/** Maximum resident decoded HDR cells in the desktop LRU cache (protects both active blend slots). */
export const MAX_CACHED_CELLS = 8;

/** Maximum resident decoded HDR cells on mobile / iOS / iPadOS devices (`Slot A` + `Slot B`). */
export const MOBILE_MAX_CACHED_CELLS = 2;

export function getMaxHdrCachedCells(isMobile = detectMobile()): number {
  return isMobile ? MOBILE_MAX_CACHED_CELLS : MAX_CACHED_CELLS;
}

interface WebGpuPmremGenerator extends PMREMGenerator {
  fromEquirectangular(
    equirectangular: THREE.Texture,
    renderTarget?: THREE.RenderTarget | null
  ): THREE.RenderTarget;
}

export interface CachedHdrCellTextures {
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

/**
 * Owns WebGPU `PMREMGenerator` pooling, deferred GPU staging disposal, and LRU cell eviction.
 */
export class HdrResourcePool {
  public readonly retainedTargets = new Set<GpuDisposable>();
  public readonly pendingDisposables = new Set<GpuDisposable>();
  public pmremRenderer: WebGPURenderer | null = null;
  private readonly webGpuPmremBySize = new Map<number, WebGpuPmremGenerator>();

  public bakeEquirectPmremTarget(
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

  public disposeWebGpuPmremGenerators(): void {
    for (const gen of this.webGpuPmremBySize.values()) {
      gen.dispose();
    }
    this.webGpuPmremBySize.clear();
  }

  public disposeTransientStagingResources(
    renderer: WebGPURenderer,
    isDisposed: () => boolean,
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
          if (!isDisposed()) flush();
        },
        () => {
          if (!isDisposed()) flush();
        }
      );
      return;
    }

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        if (isDisposed()) return;
        requestAnimationFrame(() => {
          if (isDisposed()) return;
          requestAnimationFrame(() => {
            if (!isDisposed()) flush();
          });
        });
      });
    }
  }

  public evictLruCellsIfNeeded(opts: {
    readonly renderer: WebGPURenderer;
    readonly cellCache: Map<string, CachedHdrCellTextures>;
    readonly cellLoadState: Map<string, HdrCellLoadStatus>;
    readonly cellLoadPromises: Map<string, Promise<void>>;
    readonly protectedIds: ReadonlySet<string>;
    readonly displaySlotA: BoundSlotState;
    readonly displaySlotB: BoundSlotState;
    readonly isDisposed: () => boolean;
    readonly onClearLastBoundIfMatch: (evictedKey: string) => void;
  }): void {
    const maxCachedCells = getMaxHdrCachedCells();
    if (opts.cellCache.size <= maxCachedCells) return;

    while (opts.cellCache.size > maxCachedCells) {
      let oldestKey: string | null = null;
      let oldestOrder = Infinity;
      for (const [key, entry] of opts.cellCache) {
        if (opts.protectedIds.has(key)) continue;
        if (entry.lastUsedOrder < oldestOrder) {
          oldestOrder = entry.lastUsedOrder;
          oldestKey = key;
        }
      }
      if (!oldestKey) break;

      const evicted = opts.cellCache.get(oldestKey)!;
      opts.cellCache.delete(oldestKey);
      opts.cellLoadState.delete(oldestKey);
      opts.cellLoadPromises.delete(oldestKey);
      opts.onClearLastBoundIfMatch(oldestKey);

      const stillBound =
        opts.displaySlotA.bgTex === evicted.bgTex ||
        opts.displaySlotB.bgTex === evicted.bgTex ||
        opts.displaySlotA.envTex === evicted.envTex ||
        opts.displaySlotB.envTex === evicted.envTex;
      if (!stillBound) {
        this.retainedTargets.delete(evicted.envTarget);
        this.retainedTargets.delete(evicted.bgTex);
        this.disposeTransientStagingResources(
          opts.renderer,
          opts.isDisposed,
          evicted.envTarget,
          evicted.bgTex
        );
      }
    }
  }

  public drainBakeQueue(opts: {
    readonly queue: PendingHdrBakeEntry[];
    readonly cellCache: Map<string, CachedHdrCellTextures>;
    readonly cellLoadState: Map<string, HdrCellLoadStatus>;
    readonly horizonGroundByMode: Record<TimeOfDay, THREE.Color>;
    readonly displaySlotA: BoundSlotState;
    readonly displaySlotB: BoundSlotState;
    readonly activeIds: ReadonlySet<string>;
    readonly bakeEquirectPmrem: (renderer: WebGPURenderer, equirect: THREE.Texture) => PmremTarget;
    readonly nextLruOrder: () => number;
    readonly isDisposed: () => boolean;
  }): { readonly count: number; readonly updatedActive: boolean; readonly lastRenderer?: WebGPURenderer } {
    const batch = opts.queue.splice(0, opts.queue.length);
    let updatedActive = false;
    let lastRenderer: WebGPURenderer | undefined;

    for (const entry of batch) {
      const { cellId, cell, mode, tier, renderer, prepared } = entry;
      lastRenderer = renderer;
      const existing = opts.cellCache.get(cellId);
      if (existing?.tier === 'full' && tier === 'preview') {
        this.disposeTransientStagingResources(
          renderer,
          opts.isDisposed,
          prepared.envSource,
          prepared.background !== prepared.envSource ? prepared.background : undefined
        );
        continue;
      }

      const envTarget = opts.bakeEquirectPmrem(renderer, prepared.envSource);
      this.retainedTargets.add(envTarget);
      this.retainedTargets.add(prepared.background);
      const bgTex = prepared.background;
      this.disposeTransientStagingResources(
        renderer,
        opts.isDisposed,
        prepared.envSource !== prepared.background ? prepared.envSource : undefined
      );

      if (existing) {
        const previewStillBound =
          opts.displaySlotA.bgTex === existing.bgTex ||
          opts.displaySlotB.bgTex === existing.bgTex ||
          opts.displaySlotA.envTex === existing.envTex ||
          opts.displaySlotB.envTex === existing.envTex;
        if (!previewStillBound) {
          this.retainedTargets.delete(existing.envTarget);
          this.retainedTargets.delete(existing.bgTex);
          this.disposeTransientStagingResources(
            renderer,
            opts.isDisposed,
            existing.envTarget,
            existing.bgTex
          );
        }
      }

      const horizonColor = new THREE.Color().copy(prepared.horizonGround);
      opts.cellCache.set(cellId, {
        cellId,
        cell,
        mode,
        tier,
        envTarget,
        envTex: envTarget.texture,
        bgTex,
        horizonGround: horizonColor,
        lastUsedOrder: opts.nextLruOrder(),
      });
      opts.horizonGroundByMode[mode].copy(horizonColor);
      if (tier === 'full') {
        opts.cellLoadState.set(cellId, 'loaded');
      }
      if (opts.activeIds.has(cellId)) {
        updatedActive = true;
      }
    }

    return { count: batch.length, updatedActive, lastRenderer };
  }

  public disposeAll(): void {
    for (const item of this.pendingDisposables) {
      item.dispose();
    }
    this.pendingDisposables.clear();
    for (const item of this.retainedTargets) {
      item.dispose();
    }
    this.retainedTargets.clear();
    this.disposeWebGpuPmremGenerators();
    this.pmremRenderer = null;
  }
}
