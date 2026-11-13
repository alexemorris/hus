/**
 * Pure (`core`-layer, zero-Three.js) climate classification, continuous `yearPhase` ephemeris,
 * exposure envelopes (`'outdoor' | 'greenhouse' | 'indoor'`), and multi-organ botanical
 * phenology curves shared between CPU tests/diagnostics and the GPU TSL `PhenologyMaterial`.
 */
import type { HomeLocation, HouseLocation } from '../types/solar-weather.ts';

export type ClimateZone =
  | 'temperate-maritime'
  | 'continental'
  | 'mediterranean'
  | 'arid'
  | 'subtropical';

/** Numeric climate code `[0..4]` bound to `uClimateCode` on GPU. */
export type ClimateCode = 0 | 1 | 2 | 3 | 4;

export type VegetationExposure = 'outdoor' | 'greenhouse' | 'indoor';

export type VegetationOrganKind =
  | 'bark'
  | 'deciduous-leaf'
  | 'evergreen-leaf'
  | 'marcescent-leaf'
  | 'spring-blossom'
  | 'summer-flower'
  | 'fruit'
  | 'ground-litter'
  | 'warm-season-grass';

export const CLIMATE_ZONE_CODES: Readonly<Record<ClimateZone, ClimateCode>> = {
  'temperate-maritime': 0,
  continental: 1,
  mediterranean: 2,
  arid: 3,
  subtropical: 4,
};

export const VEGETATION_ORGAN_CODES: Readonly<Record<VegetationOrganKind, number>> = {
  bark: 0,
  'deciduous-leaf': 1,
  'evergreen-leaf': 2,
  'marcescent-leaf': 3,
  'spring-blossom': 4,
  'summer-flower': 5,
  fruit: 6,
  'ground-litter': 7,
  'warm-season-grass': 8,
};

export interface ExposureEnvelope {
  readonly exposure: VegetationExposure;
  /** Overall seasonal amplitude (`1.0` outdoor, `0.30` greenhouse, `0.06` indoor). */
  readonly reactivity: number;
  /** Wind sway & leaf flutter multiplier (`0` inside glasshouse or interior rooms). */
  readonly windScale: number;
  /** Winter snow & frost normal-cap multiplier (`0` inside glasshouse or interior rooms). */
  readonly snowScale: number;
  /** Whether deciduous organs drop to bare branches in winter. */
  readonly leafDropAllowed: boolean;
  /** Autumn carotenoid/anthocyanin senescence intensity (`0` indoor, `0.25` greenhouse, `1.0` outdoor). */
  readonly senescenceScale: number;
  /** Phase window extension (`yearPhase` units) for sheltered glasshouse growing/fruiting. */
  readonly extendedWindow: number;
  /** Minimum winter organ scale floor for sheltered deciduous foliage when `leafDropAllowed = false`. */
  readonly winterFloorScale: number;
}

export const EXPOSURE_ENVELOPES: Readonly<Record<VegetationExposure, ExposureEnvelope>> = {
  outdoor: {
    exposure: 'outdoor',
    reactivity: 1.0,
    windScale: 1.0,
    snowScale: 1.0,
    leafDropAllowed: true,
    senescenceScale: 1.0,
    extendedWindow: 0.0,
    winterFloorScale: 0.0,
  },
  greenhouse: {
    exposure: 'greenhouse',
    reactivity: 0.3,
    windScale: 0.0,
    snowScale: 0.0,
    leafDropAllowed: false,
    senescenceScale: 0.25,
    extendedWindow: 0.075,
    winterFloorScale: 0.76,
  },
  indoor: {
    exposure: 'indoor',
    reactivity: 0.06,
    windScale: 0.0,
    snowScale: 0.0,
    leafDropAllowed: false,
    senescenceScale: 0.0,
    extendedWindow: 0.0,
    winterFloorScale: 0.97,
  },
};

export interface ClimateCurveParams {
  readonly zone: ClimateZone;
  readonly code: ClimateCode;
  /** Minimum winter foliage retention on outdoor deciduous species (`0` in temperate/continental, partial in subtropical). */
  readonly deciduousMinScale: number;
  /** Autumn anthocyanin/carotenoid brilliance `[0..1]`. */
  readonly autumnColorStrength: 0.92 | number;
  /** Spring budbreak phase center in `[0, 1)` (`~0.20` = mid-March). */
  readonly springOnset: number;
  /** Summer chaparral drought dormancy strength (`1.0` mediterranean/arid, `0.12` temperate). */
  readonly summerDormancy: number;
}

export const CLIMATE_CURVE_PARAMS: Readonly<Record<ClimateZone, ClimateCurveParams>> = {
  'temperate-maritime': {
    zone: 'temperate-maritime',
    code: 0,
    deciduousMinScale: 0.0,
    autumnColorStrength: 0.92,
    springOnset: 0.205,
    summerDormancy: 0.12,
  },
  continental: {
    zone: 'continental',
    code: 1,
    deciduousMinScale: 0.0,
    autumnColorStrength: 1.0,
    springOnset: 0.228,
    summerDormancy: 0.18,
  },
  mediterranean: {
    zone: 'mediterranean',
    code: 2,
    deciduousMinScale: 0.12,
    autumnColorStrength: 0.68,
    springOnset: 0.165,
    summerDormancy: 0.95,
  },
  arid: {
    zone: 'arid',
    code: 3,
    deciduousMinScale: 0.18,
    autumnColorStrength: 0.45,
    springOnset: 0.155,
    summerDormancy: 1.0,
  },
  subtropical: {
    zone: 'subtropical',
    code: 4,
    deciduousMinScale: 0.45,
    autumnColorStrength: 0.28,
    springOnset: 0.14,
    summerDormancy: 0.08,
  },
};

/** Phase jitter scale (`±0.018` phase = `±6.5` calendar days across individual leaves/twigs). */
export const ORGAN_PHASE_JITTER_SPAN = 0.036;

function saturateUnit(x: number): number {
  return x <= 0 ? 0 : x >= 1 ? 1 : x;
}

function hermiteRamp(edge0: number, edge1: number, x: number): number {
  if (Math.abs(edge1 - edge0) < 1e-6) {
    return x >= edge1 ? 1 : 0;
  }
  const t = saturateUnit((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function mixScalar(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function wrapUnitPhase(phase: number): number {
  const r = phase % 1;
  return r < 0 ? r + 1 : r;
}

/** Signed shortest circular phase distance in `[-0.5, 0.5)`. */
export function circularPhaseDelta(phase: number, center: number): number {
  return wrapUnitPhase(phase - center + 0.5) - 0.5;
}

/** Smooth bell window `[0..1]` on the unit circle `[0, 1)` with flat plateau `halfPlateau` and ramp `feather`. */
export function circularPhaseWindow(
  phase: number,
  center: number,
  halfPlateau: number,
  feather: number
): number {
  const dist = Math.abs(circularPhaseDelta(phase, center));
  return 1 - hermiteRamp(halfPlateau, halfPlateau + Math.max(1e-4, feather), dist);
}

export function climateZoneToCode(zone: ClimateZone): ClimateCode {
  return CLIMATE_ZONE_CODES[zone];
}

export function climateCodeToZone(code: number): ClimateZone {
  const rounded = Math.round(code);
  switch (rounded) {
    case 1:
      return 'continental';
    case 2:
      return 'mediterranean';
    case 3:
      return 'arid';
    case 4:
      return 'subtropical';
    default:
      return 'temperate-maritime';
  }
}

export function getExposureEnvelope(exposure: VegetationExposure): ExposureEnvelope {
  return EXPOSURE_ENVELOPES[exposure];
}

export function getClimateCurveParams(zone: ClimateZone): ClimateCurveParams {
  return CLIMATE_CURVE_PARAMS[zone];
}

/**
 * Classifies botanical climate zone automatically from `HomeLocation` (`lat`, `lon`, `elevationM`,
 * and optional `climateOverride`).
 */
export function classifyClimateZone(
  location?: Partial<HomeLocation | HouseLocation>
): ClimateZone {
  if (location?.climateOverride && location.climateOverride in CLIMATE_ZONE_CODES) {
    return location.climateOverride;
  }

  const lat =
    typeof location?.lat === 'number' && Number.isFinite(location.lat) ? location.lat : 51.8412;
  const lon =
    typeof location?.lon === 'number' && Number.isFinite(location.lon) ? location.lon : -1.7924;
  const elevM =
    typeof location?.elevationM === 'number' && Number.isFinite(location.elevationM)
      ? location.elevationM
      : 0;
  const absLat = Math.abs(lat);

  if (elevM >= 1100 && absLat >= 25) {
    return 'continental';
  }

  const isNorthAmericanDesert = lat >= 22 && lat <= 37.5 && lon >= -116.8 && lon <= -104 && elevM < 1300;
  const isSaharaArabia =
    lat >= 14 &&
    lat <= 33 &&
    lon >= -12 &&
    lon <= 62 &&
    !(lat >= 30.5 && lon <= 36 && lon >= -10 && lat >= 33.5);
  const isAustralianOutback = lat <= -19 && lat >= -31.5 && lon >= 120 && lon <= 143;
  const isAtacama = lat <= -18 && lat >= -29.5 && lon >= -71.5 && lon <= -67.5;
  if (isNorthAmericanDesert || isSaharaArabia || isAustralianOutback || isAtacama) {
    return 'arid';
  }

  const isCaliforniaMed = lat >= 30 && lat <= 42.5 && lon >= -125 && lon < -116.8 && elevM < 1100;
  const isMedBasin = lat >= 33.5 && lat <= 45.2 && lon >= -10 && lon <= 37 && elevM < 950;
  const isCentralChile = lat <= -30 && lat >= -39.5 && lon >= -74.5 && lon <= -70;
  const isWesternCape = lat <= -32 && lat >= -35.5 && lon >= 17 && lon <= 22;
  const isSouthWestAus =
    lat <= -31.5 && lat >= -38.5 && ((lon >= 114 && lon <= 122) || (lon >= 134 && lon <= 141));
  if (isCaliforniaMed || isMedBasin || isCentralChile || isWesternCape || isSouthWestAus) {
    return 'mediterranean';
  }

  if (absLat < 30 && elevM < 900) {
    return 'subtropical';
  }
  if (absLat < 33.5 && elevM < 600) {
    return 'subtropical';
  }

  if (elevM >= 900) {
    return 'continental';
  }

  const isAtlanticEurope = lat >= 43 && lat <= 63 && lon >= -12 && lon <= 11.5;
  const isPacificNorthwest = lat >= 42.5 && lat <= 59 && lon >= -132 && lon <= -121;
  const isNewZealandTasmania = lat <= -34 && lat >= -48.5 && lon >= 144 && lon <= 180;
  const isSouthernChile = lat < -39.5 && lat >= -54 && lon >= -76 && lon <= -70;
  if (isAtlanticEurope || isPacificNorthwest || isNewZealandTasmania || isSouthernChile) {
    return 'temperate-maritime';
  }

  if (absLat >= 36) {
    return 'continental';
  }

  return 'temperate-maritime';
}

/**
 * Computes continuous seasonal `yearPhase ∈ [0, 1)` from `dayOfYear` (`1..365`, fractional values supported).
 * Automatically flips seasonal phase by `+0.5` in the Southern Hemisphere (`latitudeDeg < 0`).
 *
 * Northern Hemisphere canonical landmarks:
 * - Spring equinox (`d80` / Mar 21): `~0.2164`
 * - Summer solstice (`d172` / Jun 21): `~0.4685`
 * - Autumn equinox (`d265` / Sep 22): `~0.7233`
 * - Mid-November (`d317` / Nov 13): `~0.8658`
 * - Winter solstice (`d355` / Dec 21): `~0.9699`
 */
export function computeYearPhase(dayOfYear: number, latitudeDeg = 51.8412): number {
  const safeDay = Number.isFinite(dayOfYear) ? dayOfYear : 172;
  const northernPhase = wrapUnitPhase((safeDay - 1) / 365);
  return latitudeDeg < 0 ? wrapUnitPhase(northernPhase + 0.5) : northernPhase;
}

/** Wraps a continuous 1-based calendar day into `[1, 365]`. */
export function wrapDayOfYear(dayOfYear: number): number {
  const wrapped = (((dayOfYear - 1) % 365) + 365) % 365;
  return wrapped + 1;
}

/** Signed shortest calendar arc `[-182.5, +182.5)` between two days of year (`1..365`). */
export function shortestDayOfYearDelta(fromDay: number, toDay: number): number {
  const a = wrapDayOfYear(fromDay) - 1;
  const b = wrapDayOfYear(toDay) - 1;
  return (((b - a + 182.5) % 365) + 365) % 365 - 182.5;
}

export interface OrganPhenologyInput {
  readonly organ: VegetationOrganKind;
  /** Continuous seasonal phase `[0, 1)` (already hemisphere-adjusted). */
  readonly yearPhase: number;
  readonly climateZone?: ClimateZone;
  readonly exposure?: VegetationExposure;
  /** Per-organ phase jitter in `[0, 1]` (default `0.5` = zero offset). */
  readonly phaseJitter?: number;
  /** Species/cultivar secondary parameter in `[0, 1]` (autumn hue & drop offset, winter berry flag, or litter kind). */
  readonly variantParam?: number;
  /** Base summer/cultivar RGB in linear `[0..1]`. */
  readonly baseColorRgb?: readonly [number, number, number];
}

export interface OrganPhenologyEvaluation {
  readonly organScale: number;
  readonly springFlush: number;
  readonly autumnSenescence: number;
  readonly ripeness: number;
  readonly colorRgb: readonly [number, number, number];
}

/**
 * Pure CPU reference evaluator mirroring the GPU TSL `PhenologyMaterial` curves 1:1 so unit tests
 * and scene diagnostics can assert exact organ unfurling, October/November canopy retention,
 * marcescent retention, fruit ripening, and `indoor` vs `greenhouse` vs `outdoor` reactivity.
 */
export function evaluateOrganPhenology(input: OrganPhenologyInput): OrganPhenologyEvaluation {
  const climate = getClimateCurveParams(input.climateZone ?? 'temperate-maritime');
  const env = getExposureEnvelope(input.exposure ?? 'outdoor');
  const jitterOffset = ((input.phaseJitter ?? 0.5) - 0.5) * ORGAN_PHASE_JITTER_SPAN;
  const p = wrapUnitPhase(input.yearPhase + jitterOffset);
  const variant = saturateUnit(input.variantParam ?? 0.5);
  const base = input.baseColorRgb ?? [0.16, 0.34, 0.12];

  if (input.organ === 'bark') {
    return {
      organScale: 1,
      springFlush: 0,
      autumnSenescence: 0,
      ripeness: 0,
      colorRgb: [base[0], base[1], base[2]],
    };
  }

  if (input.organ === 'evergreen-leaf') {
    const rawFlush = circularPhaseWindow(p, climate.springOnset + 0.05, 0.04, 0.07);
    const springFlush = rawFlush * mixScalar(0.35, 1.0, env.reactivity);
    const tipBoost = 1 + springFlush * 0.24;
    return {
      organScale: 1,
      springFlush,
      autumnSenescence: 0,
      ripeness: 0,
      colorRgb: [
        saturateUnit(base[0] * tipBoost * 1.05),
        saturateUnit(base[1] * tipBoost * 1.12),
        saturateUnit(base[2] * (1 + springFlush * 0.06)),
      ],
    };
  }

  if (input.organ === 'deciduous-leaf') {
    // Species abscission shift:
    // - Early scarlet climbers (Virginia Creeper, variant >= 0.82) drop ~17 days earlier in mid-November.
    // - Late-holding russet trees (English Oak ~0.32, Orchard Apple ~0.28) hold into late Nov / early Dec.
    // - Birch (0.08), Willow (0.12), Cherry (0.72), and default (0.50) hold 68-78% through mid-November
    //   and complete bare-branch drop in early-to-mid December (days 340-352).
    const earlyDrop = -0.048 * hermiteRamp(0.80, 0.95, variant);
    const oakAppleHold =
      0.016 * hermiteRamp(0.18, 0.28, variant) * (1 - hermiteRamp(0.38, 0.52, variant));
    const dropShift = earlyDrop + oakAppleHold + climate.deciduousMinScale * 0.04;

    const springBud = hermiteRamp(
      climate.springOnset - 0.035 - env.extendedWindow * 0.5,
      climate.springOnset + 0.075,
      p
    );
    const octThin = 0.10 * hermiteRamp(0.742 + dropShift, 0.835 + dropShift, p);
    const novDrop =
      0.90 * hermiteRamp(0.832 + dropShift, 0.950 + dropShift + env.extendedWindow, p);
    const rawCanopy = saturateUnit(springBud * (1 - octThin - novDrop));

    const outdoorScale = mixScalar(climate.deciduousMinScale, 1.0, rawCanopy);
    const organScale = env.leafDropAllowed
      ? outdoorScale
      : mixScalar(1.0, Math.max(env.winterFloorScale, outdoorScale), env.reactivity);

    const springFlush =
      circularPhaseWindow(p, climate.springOnset + 0.045, 0.035, 0.065) *
      mixScalar(0.28, 1.0, env.reactivity);

    // Autumn pigmentation onset: late Sep / Oct across trees, earlier scarlet flush on Virginia Creeper (variant >= 0.80),
    // staying rich gold/amber/russet/crimson throughout November until bare-branch drop.
    const earlyScarlet = hermiteRamp(0.75, 0.94, variant);
    const senOnset = mixScalar(0.742, 0.682, earlyScarlet);
    const senPeak = mixScalar(0.835, 0.738, earlyScarlet);
    const senReset = 1 - hermiteRamp(0.960, 0.990, p);
    const rawAutumn = hermiteRamp(senOnset, senPeak, p) * senReset * climate.autumnColorStrength;
    const autumnSenescence = rawAutumn * env.senescenceScale;

    const springR = base[0] * 1.42 + 0.04;
    const springG = base[1] * 1.36 + 0.06;
    const springB = base[2] * 0.78;
    let r = mixScalar(base[0], springR, springFlush * 0.75);
    let g = mixScalar(base[1], springG, springFlush * 0.75);
    let b = mixScalar(base[2], springB, springFlush * 0.75);

    // 3-stop botanical autumn palette:
    // Birch/Willow gold (0.0) -> Oak/Apple russet-ochre (0.45) -> Cherry/Creeper scarlet-crimson (1.0)
    const goldRgb: readonly [number, number, number] = [0.78, 0.58, 0.09];
    const russetRgb: readonly [number, number, number] = [0.66, 0.34, 0.08];
    const crimsonRgb: readonly [number, number, number] = [0.64, 0.09, 0.07];
    const tLow = saturateUnit(variant / 0.45);
    const tHigh = saturateUnit((variant - 0.45) / 0.55);
    const midR = mixScalar(goldRgb[0], russetRgb[0], tLow);
    const midG = mixScalar(goldRgb[1], russetRgb[1], tLow);
    const midB = mixScalar(goldRgb[2], russetRgb[2], tLow);
    const autR = mixScalar(midR, crimsonRgb[0], tHigh);
    const autG = mixScalar(midG, crimsonRgb[1], tHigh);
    const autB = mixScalar(midB, crimsonRgb[2], tHigh);

    r = mixScalar(r, autR, autumnSenescence);
    g = mixScalar(g, autG, autumnSenescence);
    b = mixScalar(b, autB, autumnSenescence);

    return {
      organScale: saturateUnit(organScale),
      springFlush,
      autumnSenescence,
      ripeness: 0,
      colorRgb: [saturateUnit(r), saturateUnit(g), saturateUnit(b)],
    };
  }

  if (input.organ === 'marcescent-leaf') {
    // Copper Beech & hornbeam hedges: full summer/autumn canopy (1.0) and ~75% retained bronze winter leaves.
    const summerPresence = circularPhaseWindow(p, 0.53, 0.27 + env.extendedWindow, 0.09);
    const winterRetention = env.leafDropAllowed ? 0.75 : Math.max(0.88, env.winterFloorScale);
    const organScale = mixScalar(winterRetention, 1.0, summerPresence);
    const springFlush = circularPhaseWindow(p, climate.springOnset + 0.04, 0.035, 0.06);
    const dryWinterOrAutumn =
      (1 - summerPresence * 0.85) * mixScalar(0.15, 1.0, env.senescenceScale);
    const russetR = 0.44;
    const russetG = 0.19;
    const russetB = 0.09;
    const plumSpringR = base[0] * 1.35 + 0.06;
    const plumSpringG = base[1] * 1.15 + 0.02;
    const plumSpringB = base[2] * 1.2 + 0.03;

    let r = mixScalar(base[0], plumSpringR, springFlush * 0.7);
    let g = mixScalar(base[1], plumSpringG, springFlush * 0.7);
    let b = mixScalar(base[2], plumSpringB, springFlush * 0.7);
    r = mixScalar(r, russetR, dryWinterOrAutumn);
    g = mixScalar(g, russetG, dryWinterOrAutumn);
    b = mixScalar(b, russetB, dryWinterOrAutumn);

    return {
      organScale: saturateUnit(organScale),
      springFlush,
      autumnSenescence: dryWinterOrAutumn,
      ripeness: 0,
      colorRgb: [saturateUnit(r), saturateUnit(g), saturateUnit(b)],
    };
  }

  if (input.organ === 'spring-blossom') {
    const center = climate.springOnset + 0.018 + (variant - 0.5) * 0.05;
    const rawBloom = circularPhaseWindow(p, center, 0.032 + env.extendedWindow * 0.4, 0.048);
    const organScale = env.exposure === 'indoor' ? rawBloom * 0.35 : rawBloom;
    const budTightness = 1 - organScale;
    const r = mixScalar(base[0], Math.min(1, base[0] * 1.08 + 0.05), budTightness * 0.4);
    const g = mixScalar(base[1], base[1] * 0.82, budTightness * 0.4);
    const b = mixScalar(base[2], base[2] * 0.88, budTightness * 0.4);
    return {
      organScale: saturateUnit(organScale),
      springFlush: organScale,
      autumnSenescence: 0,
      ripeness: 0,
      colorRgb: [saturateUnit(r), saturateUnit(g), saturateUnit(b)],
    };
  }

  if (input.organ === 'summer-flower') {
    const center = mixScalar(0.20, 0.56, variant);
    const baseHalfSpan = mixScalar(0.042, 0.13, hermiteRamp(0.2, 0.55, variant));
    const halfSpan =
      baseHalfSpan + env.extendedWindow + (climate.zone === 'mediterranean' ? 0.035 : 0);
    const feather = mixScalar(0.038, 0.068, hermiteRamp(0.2, 0.55, variant));
    const rawBloom = circularPhaseWindow(p, center, halfSpan, feather);
    const organScale = env.exposure === 'indoor' ? mixScalar(0.65, 1.0, rawBloom) : rawBloom;
    return {
      organScale: saturateUnit(organScale),
      springFlush: 0,
      autumnSenescence: 0,
      ripeness: organScale,
      colorRgb: [base[0], base[1], base[2]],
    };
  }

  if (input.organ === 'fruit') {
    // variant < 0.5: summer-forming -> late-summer/autumn-ripening pergola grapes & orchard fruit
    // (full bunches from mid-June d165 through late October d300, tapering in November).
    // variant >= 0.5: winter-persistent holly berries & Mediterranean citrus.
    const isWinterPersistent = variant >= 0.5;
    const rawScale = isWinterPersistent
      ? circularPhaseWindow(p, 0.84, 0.24 + env.extendedWindow, 0.09)
      : circularPhaseWindow(p, 0.635, 0.18 + env.extendedWindow, 0.075);
    const ripeness = isWinterPersistent
      ? circularPhaseWindow(p, 0.92, 0.20, 0.10)
      : hermiteRamp(0.45, 0.63, p) * (1 - hermiteRamp(0.86, 0.95, p));

    const unripeR = 0.24;
    const unripeG = 0.46;
    const unripeB = 0.15;
    return {
      organScale: saturateUnit(rawScale),
      springFlush: 0,
      autumnSenescence: 0,
      ripeness: saturateUnit(ripeness),
      colorRgb: [
        saturateUnit(mixScalar(unripeR, base[0], ripeness)),
        saturateUnit(mixScalar(unripeG, base[1], ripeness)),
        saturateUnit(mixScalar(unripeB, base[2], ripeness)),
      ],
    };
  }

  if (input.organ === 'ground-litter') {
    // variant < 0.5: fallen spring blossom petals; variant >= 0.5: fallen Oct-Dec autumn leaf carpet.
    const isAutumnLitter = variant >= 0.5;
    const rawLitter = isAutumnLitter
      ? circularPhaseWindow(p, 0.865, 0.068, 0.078) * climate.autumnColorStrength
      : circularPhaseWindow(p, climate.springOnset + 0.055, 0.026, 0.038);
    const organScale = env.leafDropAllowed ? rawLitter : 0;
    return {
      organScale: saturateUnit(organScale),
      springFlush: 0,
      autumnSenescence: isAutumnLitter ? organScale : 0,
      ripeness: 0,
      colorRgb: [base[0], base[1], base[2]],
    };
  }

  // 'warm-season-grass' & 3D turf tufts:
  // Temperate-maritime: vibrant spring flush, lush summer/autumn green, slight winter olive trim.
  // Mediterranean/arid: cool-season winter/spring green curing to golden-buff summer dormancy.
  const dryDormancy =
    circularPhaseWindow(p, 0.62, 0.13, 0.10) *
    climate.summerDormancy *
    mixScalar(0.0, 1.0, env.reactivity);
  const coolWinterDorm =
    circularPhaseWindow(p, 0.02, 0.09, 0.08) *
    (1 - climate.summerDormancy * 0.85) *
    mixScalar(0.0, 1.0, env.reactivity);
  const springFlush =
    circularPhaseWindow(p, climate.springOnset + 0.06, 0.055, 0.075) *
    mixScalar(0.25, 1.0, env.reactivity);

  const organScale =
    mixScalar(0.92, 1.0, 1 - dryDormancy * 0.5) * mixScalar(1.0, 0.84, coolWinterDorm);

  let r = mixScalar(base[0], base[0] * 1.18 + 0.02, springFlush * 0.65);
  let g = mixScalar(base[1], base[1] * 1.24 + 0.04, springFlush * 0.65);
  let b = mixScalar(base[2], base[2] * 0.92, springFlush * 0.65);

  // Winter temperate olive-dormant shift
  r = mixScalar(r, r * 1.04 + 0.03, coolWinterDorm * 0.55);
  g = mixScalar(g, g * 0.88, coolWinterDorm * 0.55);
  b = mixScalar(b, b * 0.86, coolWinterDorm * 0.55);

  // Mediterranean/arid summer golden-buff dormancy
  r = mixScalar(r, 0.72, dryDormancy);
  g = mixScalar(g, 0.57, dryDormancy);
  b = mixScalar(b, 0.28, dryDormancy);

  return {
    organScale: saturateUnit(organScale),
    springFlush,
    autumnSenescence: dryDormancy,
    ripeness: 0,
    colorRgb: [saturateUnit(r), saturateUnit(g), saturateUnit(b)],
  };
}

export interface SeasonalTurfEvaluationInput {
  readonly yearPhase: number;
  readonly climateZone?: ClimateZone;
  readonly rainWetness?: number;
  readonly snowAmount?: number;
}

export interface SeasonalTurfEvaluation {
  /** Linear RGB multiplier applied to base fescue/ryegrass lawn & meadow albedo. */
  readonly tintRgb: readonly [number, number, number];
  /** Golden-buff chaparral summer dormancy blend `[0..1]`. */
  readonly summerDormancyMix: number;
  /** Winter frost/snow accumulation factor `[0..1]`. */
  readonly frostSnowMix: number;
  /** Effective surface roughness `[0..1]`. */
  readonly roughness: number;
}

/**
 * Continuous seasonal turf & meadow shading evaluator mirrored 1:1 by the GPU TSL lawn/meadow node:
 * - `temperate-maritime` / `continental`: vibrant emerald spring flush (Apr-Jun), rich mown summer
 *   green (Jul-Aug), deep verdant autumn turf (Sept-Nov), and olive winter dormancy + hoarfrost/snow (Dec-Feb).
 * - `mediterranean` / `arid`: lush winter/spring green flush (Dec-Apr) curing smoothly into
 *   sun-bleached golden-buff summer dormancy (Jul-Oct).
 */
export function evaluateSeasonalTurfPhenology(
  input: SeasonalTurfEvaluationInput
): SeasonalTurfEvaluation {
  const climate = getClimateCurveParams(input.climateZone ?? 'temperate-maritime');
  const p = wrapUnitPhase(input.yearPhase);
  const rain = saturateUnit(input.rainWetness ?? 0);
  const snow = saturateUnit(input.snowAmount ?? 0);

  const springEmerald = circularPhaseWindow(p, climate.springOnset + 0.075, 0.065, 0.085);
  const warmSummer = circularPhaseWindow(p, 0.55, 0.075, 0.085);
  const verdantAutumn =
    circularPhaseWindow(p, 0.80, 0.075, 0.085) * (1 - climate.summerDormancy * 0.7);
  const coolWinter =
    circularPhaseWindow(p, 0.015, 0.085, 0.085) * (1 - climate.summerDormancy * 0.8);
  const medWinterGreen =
    circularPhaseWindow(p, 0.14, 0.14, 0.10) * climate.summerDormancy;
  const summerDormancyMix =
    circularPhaseWindow(p, 0.62, 0.13, 0.10) * climate.summerDormancy;

  let r = 1.0;
  let g = 1.0;
  let b = 1.0;

  // Fresh emerald spring chlorophyll flush
  r = mixScalar(r, 0.93, springEmerald * 0.75);
  g = mixScalar(g, 1.12, springEmerald * 0.75);
  b = mixScalar(b, 0.88, springEmerald * 0.75);

  // Mediterranean cool-season winter/spring flush
  r = mixScalar(r, 0.90, medWinterGreen * 0.65);
  g = mixScalar(g, 1.14, medWinterGreen * 0.65);
  b = mixScalar(b, 0.86, medWinterGreen * 0.65);

  // Sunlit summer chlorophyll warmth (temperate)
  const tempSummer = warmSummer * (1 - climate.summerDormancy * 0.8);
  r = mixScalar(r, 1.02, tempSummer * 0.55);
  g = mixScalar(g, 1.04, tempSummer * 0.55);
  b = mixScalar(b, 0.94, tempSummer * 0.55);

  // Deep verdant autumn dew-rich turf (Sept-Nov: rich emerald-olive, never dead brown!)
  r = mixScalar(r, 0.95, verdantAutumn * 0.65);
  g = mixScalar(g, 1.03, verdantAutumn * 0.65);
  b = mixScalar(b, 0.92, verdantAutumn * 0.65);

  // Winter temperate olive-green dormancy
  r = mixScalar(r, 1.02, coolWinter * 0.72);
  g = mixScalar(g, 0.90, coolWinter * 0.72);
  b = mixScalar(b, 0.86, coolWinter * 0.72);

  // Mediterranean / arid sun-bleached golden-buff summer dormancy
  r = mixScalar(r, 1.48, summerDormancyMix * 0.88);
  g = mixScalar(g, 1.10, summerDormancyMix * 0.88);
  b = mixScalar(b, 0.76, summerDormancyMix * 0.88);

  // Rain wetness deepens chlorophyll saturation slightly
  const wetDarken = mixScalar(1.0, 0.84, rain);
  r *= wetDarken;
  g *= mixScalar(1.0, 0.88, rain);
  b *= wetDarken;

  const roughness = saturateUnit(
    mixScalar(mixScalar(0.92, 0.64, rain * 0.85), 0.85, snow * 0.9)
  );

  return {
    tintRgb: [r, g, b],
    summerDormancyMix,
    frostSnowMix: snow,
    roughness,
  };
}
