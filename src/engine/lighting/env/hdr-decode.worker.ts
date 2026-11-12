import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import type { TimeOfDay } from '../../../core/types/scene.ts';
import { ENV_PRESETS, type EnvPresetConfig } from './env-presets.ts';
import {
  DEFAULT_MAX_HDR_DETAIL_WIDTH,
  deriveDetailWebpUrl,
  deriveFallbackDetailWebpUrl,
  prepareHdrBuffers,
  type DetailRgbaImage,
} from './hdr-processing.ts';

export interface HdrDecodeRequest {
  readonly cellId?: string;
  readonly tier?: 'preview' | 'full';
  readonly mode: TimeOfDay;
  readonly url: string;
  readonly detailUrl?: string | null;
  readonly maxDetailWidth?: number;
  readonly hdrSunU?: number;
  readonly hdrSunV?: number;
  readonly relocateDaySun?: boolean;
  readonly zenithDarkening?: number;
}

export type HdrWorkerRequest = HdrDecodeRequest;

export type HdrWorkerResponse =
  | {
      readonly ok: true;
      readonly cellId: string;
      readonly tier: 'preview' | 'full';
      readonly mode: TimeOfDay;
      readonly width: number;
      readonly height: number;
      readonly bgWidth: number;
      readonly bgHeight: number;
      readonly envWidth: number;
      readonly envHeight: number;
      readonly bgBuffer: ArrayBufferLike;
      readonly envBuffer: ArrayBufferLike;
      readonly avgR: number;
      readonly avgG: number;
      readonly avgB: number;
    }
  | {
      readonly ok: false;
      readonly cellId: string;
      readonly tier: 'preview' | 'full';
      readonly mode: TimeOfDay;
    };

const loader = new HDRLoader().setDataType(THREE.FloatType);

interface DedicatedWorkerScope {
  onmessage: ((event: MessageEvent<HdrDecodeRequest>) => void) | null;
  postMessage(message: HdrWorkerResponse, transfer?: Transferable[]): void;
}

const workerScope = self as unknown as DedicatedWorkerScope;

async function fetchDetailWebpResponse(primaryUrl: string): Promise<Response | null> {
  try {
    const resp = await fetch(primaryUrl);
    if (resp.ok) {
      return resp;
    }
  } catch {
    // Fall through to _4k.webp fallback if available
  }
  const fallbackUrl = deriveFallbackDetailWebpUrl(primaryUrl);
  if (!fallbackUrl) {
    return null;
  }
  try {
    const fallbackResp = await fetch(fallbackUrl);
    return fallbackResp.ok ? fallbackResp : null;
  } catch {
    return null;
  }
}

async function fetchAndDecodeDetailWebp(
  detailUrl: string | null | undefined,
  maxDetailWidth: number
): Promise<DetailRgbaImage | null> {
  if (
    !detailUrl ||
    typeof createImageBitmap !== 'function' ||
    typeof OffscreenCanvas === 'undefined'
  ) {
    return null;
  }
  try {
    const resp = await fetchDetailWebpResponse(detailUrl);
    if (!resp) return null;
    const blob = await resp.blob();
    const bitmap = await createImageBitmap(blob, {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
    try {
      const srcW = bitmap.width;
      const srcH = bitmap.height;
      if (srcW < 512 || srcH < 256) return null;
      const safeMaxW = Math.max(512, Math.floor(maxDetailWidth));
      const targetW = srcW > safeMaxW ? safeMaxW : srcW;
      const targetH =
        srcW > safeMaxW ? Math.max(256, Math.round((srcH * targetW) / srcW)) : srcH;
      const canvas = new OffscreenCanvas(targetW, targetH);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, targetW, targetH);
      const imgData = ctx.getImageData(0, 0, targetW, targetH);
      return { data: imgData.data, width: targetW, height: targetH };
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}

workerScope.onmessage = async (event: MessageEvent<HdrDecodeRequest>): Promise<void> => {
  const {
    cellId = event.data.mode,
    tier = 'full',
    mode,
    url,
    detailUrl,
    maxDetailWidth = DEFAULT_MAX_HDR_DETAIL_WIDTH,
    hdrSunU,
    hdrSunV,
    relocateDaySun,
    zenithDarkening,
  } = event.data;
  try {
    const effectiveDetailUrl =
      tier === 'full' ? (detailUrl !== undefined ? detailUrl : deriveDetailWebpUrl(url)) : null;

    const [response, detailImage] = await Promise.all([
      fetch(url),
      fetchAndDecodeDetailWebp(effectiveDetailUrl, maxDetailWidth),
    ]);
    if (!response.ok) {
      workerScope.postMessage({ ok: false, cellId, tier, mode });
      return;
    }
    const buffer = await response.arrayBuffer();
    const parsed = loader.parse(buffer);
    const srcData = parsed.data as Float32Array | Uint16Array | undefined;
    if (!(srcData instanceof Float32Array) || !parsed.width || !parsed.height) {
      workerScope.postMessage({ ok: false, cellId, tier, mode });
      return;
    }
    const baseCfg = ENV_PRESETS[mode];
    const cfg: EnvPresetConfig = {
      ...baseCfg,
      ...(hdrSunU !== undefined ? { hdrSunU } : {}),
      ...(hdrSunV !== undefined ? { hdrSunV } : {}),
      relocateDaySun: relocateDaySun ?? false,
      ...(zenithDarkening !== undefined ? { zenithDarkening } : {}),
    };
    const prepared = prepareHdrBuffers(
      srcData,
      parsed.width,
      parsed.height,
      cfg,
      detailImage,
      maxDetailWidth
    );
    workerScope.postMessage(
      {
        ok: true,
        cellId,
        tier,
        mode,
        width: prepared.width,
        height: prepared.height,
        bgWidth: prepared.bgWidth ?? prepared.width,
        bgHeight: prepared.bgHeight ?? prepared.height,
        envWidth: prepared.envWidth ?? parsed.width,
        envHeight: prepared.envHeight ?? parsed.height,
        bgBuffer: prepared.bgData.buffer,
        envBuffer: prepared.envData.buffer,
        avgR: prepared.avgR,
        avgG: prepared.avgG,
        avgB: prepared.avgB,
      },
      [prepared.bgData.buffer as ArrayBuffer, prepared.envData.buffer as ArrayBuffer]
    );
  } catch {
    workerScope.postMessage({ ok: false, cellId, tier, mode });
  }
};
