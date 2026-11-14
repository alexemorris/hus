import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import type { WebGPURenderer } from 'three/webgpu';
import type {
  HouseEnvironmentHdrCell,
  HouseEnvironmentHdrSpec,
} from '../../../core/types/environment-hdri.ts';
import type { TimeOfDay } from '../../../core/types/scene.ts';
import { detectMobile } from '../../perf/device-tier.ts';
import { buildCellEnvPresetConfig, resolveHdrAssetUrl } from './env-presets.ts';
import type { HdrDecodeRequest, HdrWorkerResponse } from './hdr-decode.worker.ts';
import {
  deriveDetailWebpUrl,
  prepareHdrPanorama,
  resolveMaxHdrDetailWidth,
  wrapPreparedHdrBuffers,
  type HdrDeviceLimitsLike,
  type PreparedHdr,
} from './hdr-processing.ts';

export type HdrCellLoadStatus = 'loading-preview' | 'loading-full' | 'loaded';

export interface HdrCellLoadHost {
  readonly environmentSpec: HouseEnvironmentHdrSpec;
  readonly cellLoadState: Map<string, HdrCellLoadStatus>;
  readonly cellLoadPromises: Map<string, Promise<void>>;
  readonly activeHdrWorkers: Set<Worker>;
  getHdrLoader(): HDRLoader | null;
  setHdrLoader(loader: HDRLoader): void;
  isDisposed(): boolean;
  incrementRequestedHdrCount(): void;
  enqueuePreparedBake(
    cellId: string,
    cell: HouseEnvironmentHdrCell,
    mode: TimeOfDay,
    tier: 'preview' | 'full',
    renderer: WebGPURenderer,
    prepared: PreparedHdr
  ): void;
}

export function extractRendererHdrLimits(renderer: WebGPURenderer): HdrDeviceLimitsLike | null {
  const limits = (
    renderer as unknown as {
      backend?: {
        device?: {
          limits?: {
            maxTextureDimension2D?: number;
            maxBufferSize?: number;
          };
        };
      };
    }
  ).backend?.device?.limits;
  return limits ?? null;
}

export function startHdrCellLoading(
  host: HdrCellLoadHost,
  cellId: string,
  cell: HouseEnvironmentHdrCell,
  mode: TimeOfDay,
  renderer: WebGPURenderer
): void {
  if (host.cellLoadState.has(cellId) || host.isDisposed()) return;

  const isMobile = detectMobile();
  const cfg = buildCellEnvPresetConfig(host.environmentSpec, cell);
  const fullUrl = resolveHdrAssetUrl(cell.hdrUrl);
  const previewUrl = cell.previewHdrUrl ? resolveHdrAssetUrl(cell.previewHdrUrl) : undefined;
  const maxDetailWidth = resolveMaxHdrDetailWidth(extractRendererHdrLimits(renderer), isMobile);

  if (isMobile && !previewUrl) {
    return;
  }

  host.incrementRequestedHdrCount();

  const runDirectHdrLoader = (targetUrl: string): Promise<void> => {
    host.cellLoadState.set(cellId, 'loading-full');
    let loader = host.getHdrLoader();
    if (!loader) {
      loader = new HDRLoader().setDataType(THREE.FloatType);
      host.setHdrLoader(loader);
    }
    return new Promise<void>((resolve) => {
      loader!.load(
        targetUrl,
        (loadedTex) => {
          if (host.isDisposed()) {
            loadedTex.dispose();
            resolve();
            return;
          }
          const prepared = prepareHdrPanorama(loadedTex, cfg, null, maxDetailWidth);
          loadedTex.dispose();
          if (prepared) {
            host.enqueuePreparedBake(cellId, cell, mode, 'full', renderer, prepared);
          } else {
            host.cellLoadState.delete(cellId);
          }
          resolve();
        },
        undefined,
        () => {
          host.cellLoadState.delete(cellId);
          resolve();
        }
      );
    });
  };

  if (host.getHdrLoader() === null && typeof Worker === 'function') {
    const hasDistinctPreview = Boolean(previewUrl && previewUrl !== fullUrl);
    const stages: Array<{ readonly tier: 'preview' | 'full'; readonly url: string }> = isMobile
      ? [{ tier: 'full', url: previewUrl! }]
      : hasDistinctPreview
        ? [
            { tier: 'preview', url: previewUrl! },
            { tier: 'full', url: fullUrl },
          ]
        : [{ tier: 'full', url: fullUrl }];

    host.cellLoadState.set(
      cellId,
      stages[0]!.tier === 'preview' ? 'loading-preview' : 'loading-full'
    );

    const detailOverride =
      !isMobile && cell.detailUrl ? resolveHdrAssetUrl(cell.detailUrl) : undefined;
    const fallbackHdrUrl = isMobile && previewUrl ? previewUrl : fullUrl;

    const loadPromise = new Promise<void>((resolve) => {
      let worker: Worker;
      let receivedAnyBake = false;
      try {
        worker = new Worker(new URL('./hdr-decode.worker.ts', import.meta.url), {
          type: 'module',
        });
        host.activeHdrWorkers.add(worker);
        let stageIndex = 0;

        const cleanup = (): void => {
          if (host.activeHdrWorkers.delete(worker)) {
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
            !isMobile && stage.tier === 'full'
              ? deriveDetailWebpUrl(stage.url, detailOverride, false)
              : null;
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
          if (host.isDisposed()) {
            cleanup();
            resolve();
            return;
          }
          if (msg?.ok) {
            receivedAnyBake = true;
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
            host.enqueuePreparedBake(cellId, cell, mode, msg.tier, renderer, prepared);
          }

          stageIndex++;
          if (stageIndex < stages.length) {
            host.cellLoadState.set(cellId, 'loading-full');
            postStage(stageIndex);
            return;
          }

          if (!receivedAnyBake) {
            host.cellLoadState.delete(cellId);
          }
          cleanup();
          resolve();
        };

        worker.onerror = (): void => {
          cleanup();
          if (!receivedAnyBake && !host.isDisposed()) {
            host.cellLoadState.delete(cellId);
            void runDirectHdrLoader(fallbackHdrUrl).then(resolve, () => resolve());
            return;
          }
          resolve();
        };

        postStage(0);
        return;
      } catch {
        host.cellLoadState.delete(cellId);
      }
      void runDirectHdrLoader(fallbackHdrUrl).then(resolve, () => resolve());
    });

    host.cellLoadPromises.set(cellId, loadPromise);
    return;
  }

  const targetUrl = isMobile && previewUrl ? previewUrl : fullUrl;
  const loadPromise = runDirectHdrLoader(targetUrl);
  host.cellLoadPromises.set(cellId, loadPromise);
}
