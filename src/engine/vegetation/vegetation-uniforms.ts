import * as THREE from 'three';
import { uniform } from 'three/tsl';
import {
  classifyClimateZone,
  climateZoneToCode,
  computeYearPhase,
  getClimateCurveParams,
  type ClimateCode,
  type ClimateZone,
} from '../../core/geo/climate-phenology.ts';
import {
  DEFAULT_HUS_LATITUDE_DEG,
  DEFAULT_HUS_LOCATION,
  type HouseLocation,
} from '../../core/types/solar-weather.ts';

export type TslFloatUniformNode = ReturnType<typeof uniform<number>>;
export type TslVec2UniformNode = ReturnType<typeof uniform<THREE.Vector2>>;
export type TslVec4UniformNode = ReturnType<typeof uniform<THREE.Vector4>>;

/**
 * GPU uniform block driving all `PhenologyMaterial` instances in `O(1)` (zero mesh rebuilds,
 * zero geometry allocations when scrubbing `dayOfYear` or transitioning seasons).
 */
export interface VegetationUniforms {
  /** Continuous hemisphere-adjusted seasonal phase in `[0, 1)`. */
  readonly uYearPhase: TslFloatUniformNode;
  /** Numeric climate classification code (`0..4`). */
  readonly uClimateCode: TslFloatUniformNode;
  /** Packed climate curve parameters: `(deciduousMinScale, autumnColorStrength, springOnset, summerDormancy)`. */
  readonly uClimateCurves: TslVec4UniformNode;
  /** Outdoor snow & frost normal-cap accumulation in `[0, 1]`. */
  readonly uSnowAmount: TslFloatUniformNode;
  /** Rain & dew surface wetness in `[0, 1]` (reduces leaf/bark roughness and deepens albedo). */
  readonly uRainWetness: TslFloatUniformNode;
  /** Active outdoor wind sway & leaf flutter amplitude in `[0, 1]` (`0` when idle to preserve `0 Hz` sleep). */
  readonly uWindStrength: TslFloatUniformNode;
  /** Continuous wind animation clock in seconds (advanced only while weather/wind animation is active). */
  readonly uWindTime: TslFloatUniformNode;
  /** Normalized world XZ wind direction vector. */
  readonly uWindDirection: TslVec2UniformNode;
}

export function createVegetationUniforms(): VegetationUniforms {
  const defaultZone = classifyClimateZone(DEFAULT_HUS_LOCATION);
  const curves = getClimateCurveParams(defaultZone);
  return {
    uYearPhase: uniform(computeYearPhase(172, DEFAULT_HUS_LATITUDE_DEG)),
    uClimateCode: uniform<number>(climateZoneToCode(defaultZone)),
    uClimateCurves: uniform(
      new THREE.Vector4(
        curves.deciduousMinScale,
        curves.autumnColorStrength,
        curves.springOnset,
        curves.summerDormancy
      )
    ),
    uSnowAmount: uniform(0),
    uRainWetness: uniform(0),
    uWindStrength: uniform(0),
    uWindTime: uniform(0),
    uWindDirection: uniform(new THREE.Vector2(0.8, 0.6)),
  };
}

/** Shared singleton uniform block bound to default `PhenologyMaterial` instances. */
export const SHARED_VEGETATION_UNIFORMS: VegetationUniforms = createVegetationUniforms();

export interface VegetationEnvironmentSyncInput {
  readonly location?: Partial<HouseLocation>;
  readonly dayOfYear: number;
  readonly snowAmount?: number;
  readonly rainWetness?: number;
  readonly windSpeedKph?: number;
  readonly windDirDeg?: number;
  /** True only when live weather / precipitation / wind animation is actively ticking. */
  readonly windAnimating?: boolean;
  readonly dtSeconds?: number;
}

export interface VegetationPhenologySnapshot {
  readonly yearPhase: number;
  readonly dayOfYear: number;
  readonly latitudeDeg: number;
  readonly climateZone: ClimateZone;
  readonly climateCode: ClimateCode;
  readonly snowAmount: number;
  readonly rainWetness: number;
  readonly windStrength: number;
  readonly windTime: number;
}

/**
 * Coordinates continuous `O(1)` updates to `VegetationUniforms` from `EnvironmentLighting`
 * (`location`, fractional `dayOfYear`, snow accumulation, rain wetness, and wind state)
 * without waking the `0 Hz` render loop when idle.
 */
export class VegetationPhenologyController {
  public readonly uniforms: VegetationUniforms;
  private currentZone: ClimateZone;
  private currentDayOfYear = 172;
  private currentLatitudeDeg = DEFAULT_HUS_LATITUDE_DEG;

  public constructor(uniforms: VegetationUniforms = SHARED_VEGETATION_UNIFORMS) {
    this.uniforms = uniforms;
    this.currentZone = classifyClimateZone(DEFAULT_HUS_LOCATION);
  }

  public syncFromEnvironment(input: VegetationEnvironmentSyncInput): VegetationPhenologySnapshot {
    const lat =
      typeof input.location?.lat === 'number' && Number.isFinite(input.location.lat)
        ? input.location.lat
        : this.currentLatitudeDeg;
    this.currentLatitudeDeg = lat;
    this.currentDayOfYear = input.dayOfYear;

    const zone = classifyClimateZone(input.location ?? { lat });
    this.currentZone = zone;
    const code = climateZoneToCode(zone);
    const curves = getClimateCurveParams(zone);

    const yearPhase = computeYearPhase(input.dayOfYear, lat);
    this.uniforms.uYearPhase.value = yearPhase;
    this.uniforms.uClimateCode.value = code;
    this.uniforms.uClimateCurves.value.set(
      curves.deciduousMinScale,
      curves.autumnColorStrength,
      curves.springOnset,
      curves.summerDormancy
    );

    if (typeof input.snowAmount === 'number' && Number.isFinite(input.snowAmount)) {
      this.uniforms.uSnowAmount.value = THREE.MathUtils.clamp(input.snowAmount, 0, 1);
    }
    if (typeof input.rainWetness === 'number' && Number.isFinite(input.rainWetness)) {
      this.uniforms.uRainWetness.value = THREE.MathUtils.clamp(input.rainWetness, 0, 1);
    }

    if (typeof input.windDirDeg === 'number' && Number.isFinite(input.windDirDeg)) {
      const rad = (input.windDirDeg * Math.PI) / 180;
      this.uniforms.uWindDirection.value.set(Math.sin(rad), -Math.cos(rad)).normalize();
    }

    const windAnimating = input.windAnimating === true;
    const speedKph =
      typeof input.windSpeedKph === 'number' && Number.isFinite(input.windSpeedKph)
        ? Math.max(0, input.windSpeedKph)
        : 0;
    this.uniforms.uWindStrength.value = windAnimating
      ? THREE.MathUtils.clamp(speedKph / 52, 0.04, 1)
      : 0;

    if (windAnimating && typeof input.dtSeconds === 'number' && input.dtSeconds > 0) {
      this.uniforms.uWindTime.value = (this.uniforms.uWindTime.value + input.dtSeconds) % 10000;
    }

    return this.getSnapshot();
  }

  public setYearPhase(yearPhase: number): void {
    const wrapped = ((yearPhase % 1) + 1) % 1;
    this.uniforms.uYearPhase.value = wrapped;
  }

  public getSnapshot(): VegetationPhenologySnapshot {
    return {
      yearPhase: this.uniforms.uYearPhase.value,
      dayOfYear: this.currentDayOfYear,
      latitudeDeg: this.currentLatitudeDeg,
      climateZone: this.currentZone,
      climateCode: climateZoneToCode(this.currentZone),
      snowAmount: this.uniforms.uSnowAmount.value,
      rainWetness: this.uniforms.uRainWetness.value,
      windStrength: this.uniforms.uWindStrength.value,
      windTime: this.uniforms.uWindTime.value,
    };
  }
}
