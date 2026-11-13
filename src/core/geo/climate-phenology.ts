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
  readonly autumnColorStrength: number;
  /** Spring budbreak phase center in `[0, 1)` (`~0.20` = mid-March). */
  readonly springOnset: number;
  /** Summer chaparral drought dormancy strength (`1.0` mediterranean/arid, `0.15` temperate). */
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
  const raw = wrapUnitPhase(phase - center + 0.5) - 0.5;
  return raw;
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

  // Hot desert / arid interiors: Mojave & Sonoran (-116.8..-104°W), Sahara/Arabian/Middle East (12..62°E),
  // Atacama (-71.5..-67°W), Namib/Kalahari (14..24°E south), interior Australia (121..143°E, 19..31°S).
  const isNorthAmericanDesert = lat >= 22 && lat <= 37.5 && lon >= -116.8 && lon <= -104 && elevM < 1300;
  const isSaharaArabia = lat >= 14 && lat <= 33 && lon >= -12 && lon <= 62 && !(lat >= 30.5 && lon <= 36 && lon >= -10 && lat >= 33.5);
  const isAustralianOutback = lat <= -19 && lat >= -31.5 && lon >= 120 && lon <= 143;
  const isAtacama = lat <= -18 && lat >= -29.5 && lon >= -71.5 && lon <= -67.5;
  if (isNorthAmericanDesert || isSaharaArabia || isAustralianOutback || isAtacama) {
    return 'arid';
  }

  // Mediterranean west-coast & basin climates:
  // California coast & coastal ranges (including 34.1°N, -118.37°W Hollywood Hills Stahl House),
  // Mediterranean Basin, Central Chile, Western Cape, SW/South Australia.
  const isCaliforniaMed = lat >= 30 && lat <= 42.5 && lon >= -125 && lon < -116.8 && elevM < 1100;
  const isMedBasin = lat >= 33.5 && lat <= 45.2 && lon >= -10 && lon <= 37 && elevM < 950;
  const isCentralChile = lat <= -30 && lat >= -39.5 && lon >= -74.5 && lon <= -70;
  const isWesternCape = lat <= -32 && lat >= -35.5 && lon >= 17 && lon <= 22;
  const isSouthWestAus = lat <= -31.5 && lat >= -38.5 && ((lon >= 114 && lon <= 122) || (lon >= 134 && lon <= 141));
  if (isCaliforniaMed || isMedBasin || isCentralChile || isWesternCape || isSouthWestAus) {
    return 'mediterranean';
  }

  // Subtropical low latitudes & warm humid east coasts below 33.5°
  if (absLat < 30 && elevM < 900) {
    return 'subtropical';
  }
  if (absLat < 33.5 && elevM < 600) {
    return 'subtropical';
  }

  if (elevM >= 900) {
    return 'continental';
  }

  // Temperate-maritime oceanic belts:
  // UK, Ireland, NW & Atlantic Europe (lon -12..11, lat 43..63), Pacific NW (lon -132..-121, lat 42.5..59),
  // New Zealand & Tasmania (lat -48..-34, lon 144..180), southern Chile (-52..-39.5).
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
  const raw = (((b - a + 182.5) % 365) + 365) % 365 - 182.5;
  return raw;
}

export interface OrganPhenologyInput {
  readonly organ: VegetationOrganKind;
  /** Continuous seasonal phase `[0, 1)` (already hemisphere-adjusted). */
  readonly yearPhase: number;
  readonly climateZone?: ClimateZone;
  readonly exposure?: VegetationExposure;
  /** Per-organ phase jitter in `[0, 1]` (default `0.5` = zero offset). */
  readonly phaseJitter?: number;
  /** Species/cultivar secondary parameter in `[0, 1]` (autumn hue target, persistent winter berry flag, or litter kind). */
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
 * Pure CPU reference evaluator mirroring the GPU TSL `PhenologyMaterial` curves so unit tests
 * and scene diagnostics can assert exact organ unfurling, senescence, marcescent retention,
 * fruit ripening, and `indoor` vs `greenhouse` vs `outdoor` reactivity.
 */
export function evaluateOrganPhenology(input: OrganPhenologyInput): OrganPhenologyEvaluation {
  const climate = getClimateCurveParams(input.climateZone ?? 'temperate-maritime');
  const env = getExposureEnvelope(input.exposure ?? 'outdoor');
  const jitterOffset = ((input.phaseJitter ?? 0.5) - 0.5) * 0.06;
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
    // Active growing canopy centered in late spring / summer (~0.48), widening in mild climates or greenhouses.
    const halfWidth = 0.21 + climate.deciduousMinScale * 0.08 + env.extendedWindow;
    const rawCanopy = circularPhaseWindow(p, 0.485, halfWidth, 0.085);
    const outdoorScale = mixScalar(climate.deciduousMinScale, 1.0, rawCanopy);
    const organScale = env.leafDropAllowed
      ? outdoorScale
      : mixScalar(1.0, Math.max(env.winterFloorScale, outdoorScale), env.reactivity);

    const springFlush =
      circularPhaseWindow(p, climate.springOnset + 0.045, 0.035, 0.065) *
      mixScalar(0.28, 1.0, env.reactivity);
    const rawAutumn =
      circularPhaseWindow(p, 0.745, 0.055, 0.075) * climate.autumnColorStrength;
    const autumnSenescence = rawAutumn * env.senescenceScale;

    // Fresh spring lime-chartreuse flush
    const springR = base[0] * 1.42 + 0.04;
    const springG = base[1] * 1.36 + 0.06;
    const springB = base[2] * 0.78;
    let r = mixScalar(base[0], springR, springFlush * 0.75);
    let g = mixScalar(base[1], springG, springFlush * 0.75);
    let b = mixScalar(base[2], springB, springFlush * 0.75);

    // Species-specific autumn carotenoid gold (variant=0) -> amber-russet (0.5) -> anthocyanin scarlet (1.0)
    const goldRgb: readonly [number, number, number] = [0.76, 0.56, 0.09];
    const crimsonRgb: readonly [number, number, number] = [0.58, 0.11, 0.07];
    const autR = mixScalar(goldRgb[0], crimsonRgb[0], variant);
    const autG = mixScalar(goldRgb[1], crimsonRgb[1], variant);
    const autB = mixScalar(goldRgb[2], crimsonRgb[2], variant);

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
    // Copper Beech & hornbeam hedges: full summer canopy (1.0) and ~75% retained dry russet-bronze winter leaves.
    const summerPresence = circularPhaseWindow(p, 0.485, 0.22 + env.extendedWindow, 0.08);
    const winterRetention = env.leafDropAllowed ? 0.75 : Math.max(0.88, env.winterFloorScale);
    const organScale = mixScalar(winterRetention, 1.0, summerPresence);
    const springFlush = circularPhaseWindow(p, climate.springOnset + 0.04, 0.035, 0.06);
    const dryWinterOrAutumn = (1 - summerPresence * 0.85) * mixScalar(0.15, 1.0, env.senescenceScale);
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
    // Tight buds swell and unfurl around spring equinox (~0.215), peak in mid-spring, shed before summer canopy.
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
    // Phase-window encoding via variant (aVegMeta.w):
    // 0.0..0.22 = early-spring bulbs (daffodils, tulips), 0.25..0.45 = late-spring wisteria/rhododendron,
    // 0.50..1.0 = summer & repeat-flowering roses, lavender, hydrangea, star-jasmine.
    const center = mixScalar(0.20, 0.56, variant);
    const baseHalfSpan = mixScalar(0.042, 0.13, hermiteRamp(0.2, 0.55, variant));
    const halfSpan =
      baseHalfSpan + env.extendedWindow + (climate.zone === 'mediterranean' ? 0.035 : 0);
    const feather = mixScalar(0.038, 0.068, hermiteRamp(0.2, 0.55, variant));
    const rawBloom = circularPhaseWindow(p, center, halfSpan, feather);
    const organScale =
      env.exposure === 'indoor' ? mixScalar(0.65, 1.0, rawBloom) : rawBloom;
    return {
      organScale: saturateUnit(organScale),
      springFlush: 0,
      autumnSenescence: 0,
      ripeness: organScale,
      colorRgb: [base[0], base[1], base[2]],
    };
  }

  if (input.organ === 'fruit') {
    // variant < 0.5: summer-swelling -> autumn-ripening orchard fruit & grapes (center ~0.64, ripens 0.54->0.72, drops in winter).
    // variant >= 0.5: winter-persistent holly berries & Mediterranean citrus (swells in summer, ripens in autumn, persists through winter).
    const isWinterPersistent = variant >= 0.5;
    const rawScale = isWinterPersistent
      ? circularPhaseWindow(p, 0.84, 0.24 + env.extendedWindow, 0.09)
      : circularPhaseWindow(p, 0.63, 0.11 + env.extendedWindow, 0.075);
    const ripeness = isWinterPersistent
      ? circularPhaseWindow(p, 0.92, 0.20, 0.10)
      : hermiteRamp(0.48, 0.67, p) * (1 - hermiteRamp(0.84, 0.94, p));

    // Unripe green -> cultivar ripe color (`base`)
    const unripeR = 0.22;
    const unripeG = 0.42;
    const unripeB = 0.14;
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
    // variant < 0.5: fallen spring blossom petals (late spring ~0.265); variant >= 0.5: fallen autumn leaf carpet (~0.77).
    const isAutumnLitter = variant >= 0.5;
    const rawLitter = isAutumnLitter
      ? circularPhaseWindow(p, 0.785, 0.075, 0.075) * climate.autumnColorStrength
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

  // 'warm-season-grass' (Mediterranean chaparral / California deergrass):
  // Lush cool-season green in winter/spring, curing to golden-ochre dry dormancy in late summer/autumn.
  const dryDormancy =
    circularPhaseWindow(p, 0.62, 0.13, 0.10) *
    climate.summerDormancy *
    mixScalar(0.0, 1.0, env.reactivity);
  const dryR = 0.72;
  const dryG = 0.57;
  const dryB = 0.28;
  return {
    organScale: mixScalar(0.92, 1.0, 1 - dryDormancy * 0.5),
    springFlush: circularPhaseWindow(p, 0.2, 0.08, 0.08),
    autumnSenescence: dryDormancy,
    ripeness: 0,
    colorRgb: [
      saturateUnit(mixScalar(base[0], dryR, dryDormancy)),
      saturateUnit(mixScalar(base[1], dryG, dryDormancy)),
      saturateUnit(mixScalar(base[2], dryB, dryDormancy)),
    ],
  };
}
