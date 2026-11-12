import type {
  AcousticOcclusionState,
  AcousticSurfaceMaterial,
  ExteriorPortalAcousticState,
  RoomAcousticProfile,
} from '../../core/types/acoustics.ts';

/**
 * Representative mid-band Sabine sound absorption coefficients for architectural finishes.
 */
export const SURFACE_ABSORPTION_COEFFS: Readonly<Record<AcousticSurfaceMaterial, number>> = {
  stone: 0.05,
  tile: 0.05,
  glass: 0.08,
  plaster: 0.12,
  timber: 0.18,
  carpet: 0.38,
};

export interface ComputeSabineRt60Params {
  readonly volumeM3?: number;
  readonly primarySurface?: AcousticSurfaceMaterial;
  readonly absorptionCoeff?: number;
  readonly openPortalAreaM2?: number;
}

export interface ComputeAcousticOcclusionParams {
  readonly listenerPos: readonly [number, number, number];
  readonly isInterior: boolean;
  readonly room?: RoomAcousticProfile;
  readonly exteriorPortals?: readonly ExteriorPortalAcousticState[];
}

export const OUTDOOR_ACOUSTIC_OCCLUSION: AcousticOcclusionState = {
  isInterior: false,
  effectiveOpenness: 1,
  exteriorLowpassHz: 18000,
  exteriorHighShelfDb: 0,
  exteriorGainScale: 1,
  reverbDecaySec: 0.14,
  reverbWetSend: 0.05,
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/**
 * Computes room reverberation decay time (RT60, in seconds) via the Sabine approximation,
 * accounting for room volume, interior finish absorption, and open exterior portal area
 * (which acts as an anechoic $\alpha = 1.0$ aperture).
 */
export function computeSabineRt60(params: ComputeSabineRt60Params): number {
  const volumeM3 = clamp(params.volumeM3 ?? 75, 12, 2500);
  const surfaceAreaM2 = 6 * Math.cbrt(volumeM3) ** 2;
  const fallbackAlpha = SURFACE_ABSORPTION_COEFFS[params.primarySurface ?? 'plaster'];
  const absorptionCoeff = clamp(params.absorptionCoeff ?? fallbackAlpha, 0.03, 0.95);
  const openArea =
    params.openPortalAreaM2 !== undefined && Number.isFinite(params.openPortalAreaM2)
      ? Math.max(0, params.openPortalAreaM2)
      : 0;

  return clamp(
    (0.161 * volumeM3) / Math.max(1.5, surfaceAreaM2 * absorptionCoeff + openArea),
    0.12,
    2.2
  );
}

/**
 * Computes physically grounded indoor/outdoor portal occlusion and Sabine room reverberation
 * parameters from the listener's world position, interior/exterior state, room volume/finish,
 * and open exterior portals (sliding glass walls, concertina bifolds, French doors, windows).
 */
export function computeAcousticOcclusion(
  params: ComputeAcousticOcclusionParams
): AcousticOcclusionState {
  if (!params.isInterior) {
    return OUTDOOR_ACOUSTIC_OCCLUSION;
  }

  let sumContributions = 0;
  let openArea = 0;

  const portals = params.exteriorPortals;
  if (portals && portals.length > 0) {
    const [lx, ly, lz] = params.listenerPos;
    for (let i = 0; i < portals.length; i++) {
      const portal = portals[i]!;
      const openness = clamp(portal.openness, 0, 1);
      if (openness <= 0) continue;

      const rawArea = portal.areaM2 ?? 4.0;
      const areaM2 = clamp(rawArea, 0.05, 120);
      const dx = portal.position[0] - lx;
      const dy = portal.position[1] - ly;
      const dz = portal.position[2] - lz;
      const dist = Math.hypot(dx, dy, dz);

      const distWeight = 1 / (1 + (dist / 5.5) ** 2);
      const areaFactor = clamp(areaM2 / 8, 0.25, 2.0);
      sumContributions += openness * areaFactor * distWeight;
      openArea += openness * areaM2;
    }
  }

  const effectiveOpenness = clamp(1 - Math.exp(-sumContributions * 1.35), 0, 0.96);
  const exteriorLowpassHz = 720 * Math.pow(18000 / 720, effectiveOpenness);
  const exteriorHighShelfDb = -14 * (1 - effectiveOpenness);
  const exteriorGainScale = 0.18 + 0.78 * effectiveOpenness;

  const reverbDecaySec = computeSabineRt60({
    ...(params.room?.volumeM3 !== undefined ? { volumeM3: params.room.volumeM3 } : {}),
    ...(params.room?.primarySurface !== undefined
      ? { primarySurface: params.room.primarySurface }
      : {}),
    ...(params.room?.absorptionCoeff !== undefined
      ? { absorptionCoeff: params.room.absorptionCoeff }
      : {}),
    openPortalAreaM2: openArea,
  });
  const reverbWetSend = clamp(
    (0.12 + 0.14 * Math.min(1, reverbDecaySec / 1.2)) * (1 - 0.35 * effectiveOpenness),
    0.06,
    0.38
  );

  return {
    isInterior: true,
    effectiveOpenness,
    exteriorLowpassHz,
    exteriorHighShelfDb,
    exteriorGainScale,
    reverbDecaySec,
    reverbWetSend,
  };
}

/**
 * Fallback occlusion estimate for legacy callers that only supply `(isInterior, bifoldsOpen)`
 * without explicit portal geometry or room acoustic metadata.
 */
export function computeLegacyAcousticOcclusion(
  isInterior: boolean,
  bifoldsOpen: boolean
): AcousticOcclusionState {
  if (!isInterior) {
    return OUTDOOR_ACOUSTIC_OCCLUSION;
  }
  return computeAcousticOcclusion({
    listenerPos: [0, 1.5, 0],
    isInterior: true,
    exteriorPortals: bifoldsOpen
      ? [{ id: 'legacy-bifolds', position: [0, 1.5, 4.2], areaM2: 7.5, openness: 1 }]
      : [],
  });
}
