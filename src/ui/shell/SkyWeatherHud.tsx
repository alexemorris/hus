import { effect } from '@preact/signals';
import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import {
  bearingToCardinal16,
  formatCivilHourHHMM,
  formatDayOfYearShort,
  formatDurationHoursHM,
  formatLatLonCoords,
  formatUtcOffsetLabel,
  projectCelestialOnCompassRose,
  weatherConditionShortLabel,
} from '../../core/solar-weather-format.ts';
import {
  canonicalDayOfYearForSeason,
  deriveSeasonFromDayOfYear,
  resolveClimateCapabilities,
  type Season,
  type SeasonSelection,
} from '../../core/types/environment-hdri.ts';
import type { TimeOfDay } from '../../core/types/scene.ts';
import type {
  PrecipitationType,
  SkyWeatherSnapshot,
  WeatherCondition,
  WeatherPresetId,
} from '../../core/types/solar-weather.ts';
import {
  cameraCompassBearingDeg,
  skyHudPopover,
  skyWeatherSnapshot,
  timeOfDay,
  viewMode,
  type SkyHudPopover,
} from '../../state/shell-store.ts';
import { Icon, type IconName } from './icons.tsx';
import { useShell } from './shell-context.ts';

const WEATHER_PRESETS: readonly {
  readonly id: WeatherPresetId;
  readonly label: string;
  readonly icon: IconName;
}[] = [
  { id: 'clear', label: 'Clear', icon: 'sun' },
  { id: 'partly_cloudy', label: 'Partly Cloudy', icon: 'cloud' },
  { id: 'overcast', label: 'Overcast', icon: 'cloud' },
  { id: 'light_rain', label: 'Light Rain', icon: 'rain' },
  { id: 'heavy_storm', label: 'Heavy Storm', icon: 'rain' },
  { id: 'morning_mist', label: 'Morning Mist', icon: 'mist' },
  { id: 'winter_snow', label: 'Winter Snow', icon: 'snow' },
];

const SEASON_SELECTIONS: readonly { readonly id: SeasonSelection; readonly label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'spring', label: 'Spring' },
  { id: 'summer', label: 'Summer' },
  { id: 'autumn', label: 'Autumn' },
  { id: 'winter', label: 'Winter' },
];

const SEASON_LABELS: Readonly<Record<Season, string>> = {
  spring: 'Spring',
  summer: 'Summer',
  autumn: 'Autumn',
  winter: 'Winter',
};

const TOD_CHIPS: readonly { readonly id: TimeOfDay; readonly label: string; readonly icon: IconName }[] = [
  { id: 'day', label: 'Day', icon: 'sun' },
  { id: 'dusk', label: 'Dusk', icon: 'sunset' },
  { id: 'night', label: 'Night', icon: 'moon' },
];

const PRECIP_MODES: readonly { readonly id: PrecipitationType; readonly label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'rain', label: 'Rain' },
  { id: 'snow', label: 'Snow' },
];

const QUICK_CLOUD_CHIPS: readonly { readonly pct: number; readonly label: string }[] = [
  { pct: 0, label: 'Clear 0%' },
  { pct: 42, label: 'Partly 42%' },
  { pct: 92, label: 'Overcast 92%' },
];

export function effectiveCloudCoverPct(weather: SkyWeatherSnapshot['weather']): number {
  if (!weather.cloudEnabled) return 0;
  return Math.max(0, Math.min(100, Math.round(weather.cloudCoverPct)));
}

export function isWeatherPresetActive(
  presetId: WeatherPresetId,
  weather: SkyWeatherSnapshot['weather']
): boolean {
  const effCloud = effectiveCloudCoverPct(weather);
  const isDryClearAir = weather.precipType === 'none' && !weather.fogEnabled;
  switch (presetId) {
    case 'clear':
      return isDryClearAir && effCloud < 15;
    case 'partly_cloudy':
      return isDryClearAir && effCloud >= 15 && effCloud <= 77;
    case 'overcast':
      return isDryClearAir && effCloud >= 78;
    case 'light_rain':
      return (
        weather.precipType === 'rain' &&
        weather.precipIntensity > 0.01 &&
        weather.precipIntensity < 0.72
      );
    case 'heavy_storm':
      return weather.precipType === 'rain' && weather.precipIntensity >= 0.72;
    case 'morning_mist':
      return weather.precipType === 'none' && weather.fogEnabled && weather.fogIntensity >= 0.35;
    case 'winter_snow':
      return weather.precipType === 'snow' && weather.precipIntensity > 0.01;
  }
}

export function formatHudWeatherBadge(weather: SkyWeatherSnapshot['weather']): string {
  const effCloud = effectiveCloudCoverPct(weather);
  const isDryClearAir = weather.precipType === 'none' && !weather.fogEnabled;
  if (isDryClearAir) {
    if (effCloud < 15) return 'Clear';
    if (effCloud <= 77) return `${effCloud}% Clouds`;
    return 'Overcast';
  }
  return weatherConditionShortLabel(weather.condition);
}

function weatherIconForCondition(
  condition: WeatherCondition,
  isNight: boolean,
  effCloudPct: number,
  isDryClearAir: boolean
): IconName {
  if (isDryClearAir) {
    if (effCloudPct < 15) return isNight ? 'moon' : 'sun';
    return 'cloud';
  }
  switch (condition) {
    case 'clear':
      return isNight ? 'moon' : 'sun';
    case 'partly_cloudy':
    case 'overcast':
      return 'cloud';
    case 'drizzle':
    case 'rain':
    case 'heavy_rain':
      return 'rain';
    case 'fog':
      return 'mist';
    case 'snow':
      return 'snow';
  }
}

/**
 * Isolated zero-VDOM-diff compass pill dial + heading readout.
 * Mutates SVG transform and text nodes directly inside a `@preact/signals` effect
 * so 60 Hz camera orbit/pan triggers ZERO Preact component re-renders!
 */
function MiniCompassReadout({ snap }: { readonly snap: SkyWeatherSnapshot }): JSX.Element {
  const ctl = useShell();
  const roseGroupRef = useRef<SVGGElement | null>(null);
  const orbCircleRef = useRef<SVGCircleElement | null>(null);
  const degSpanRef = useRef<HTMLSpanElement | null>(null);
  const cardSpanRef = useRef<HTMLSpanElement | null>(null);
  const lastIntDegRef = useRef<number>(Number.NaN);

  const initialBearing =
    typeof ctl.getCompassBearingDeg === 'function'
      ? ctl.getCompassBearingDeg()
      : cameraCompassBearingDeg.peek();
  const showSun = snap.solar.altitudeDeg >= -0.833;
  const bodyAz = showSun ? snap.solar.azimuthFromNorthDeg : snap.lunar.azimuthFromNorthDeg;
  const bodyAlt = showSun ? snap.solar.altitudeDeg : snap.lunar.altitudeDeg;
  const initialOrb = projectCelestialOnCompassRose(bodyAz, bodyAlt, initialBearing);
  const initialIntDeg = ((Math.round(initialBearing) % 360) + 360) % 360;

  useEffect(() => {
    lastIntDegRef.current = Number.NaN;
    const applyBearing = (b: number): void => {
      const rose = roseGroupRef.current;
      if (rose) {
        rose.setAttribute('transform', `rotate(${(-b).toFixed(2)})`);
      }
      const orbEl = orbCircleRef.current;
      if (orbEl) {
        const pt = projectCelestialOnCompassRose(bodyAz, bodyAlt, b);
        orbEl.setAttribute('cx', (pt.rx * 12).toFixed(2));
        orbEl.setAttribute('cy', (pt.ry * 12).toFixed(2));
      }
      const intDeg = ((Math.round(b) % 360) + 360) % 360;
      if (intDeg !== lastIntDegRef.current) {
        lastIntDegRef.current = intDeg;
        if (degSpanRef.current) degSpanRef.current.textContent = `${intDeg}°`;
        if (cardSpanRef.current) cardSpanRef.current.textContent = bearingToCardinal16(b);
      }
    };
    const disposeSignal = effect(() => {
      applyBearing(cameraCompassBearingDeg.value);
    });
    if (typeof ctl.getCompassBearingDeg === 'function') {
      applyBearing(ctl.getCompassBearingDeg());
    }
    const unsubCamera =
      typeof ctl.onCompassBearingChanged === 'function'
        ? ctl.onCompassBearingChanged(applyBearing)
        : () => {};
    return () => {
      unsubCamera();
      disposeSignal();
    };
  }, [ctl, bodyAz, bodyAlt]);

  return (
    <>
      <svg
        class="skyhud-mini-compass"
        width="28"
        height="28"
        viewBox="-16 -16 32 32"
        aria-hidden="true"
      >
        <circle cx="0" cy="0" r="13.5" fill="rgba(10, 13, 18, 0.72)" stroke="rgba(255,255,255,0.22)" stroke-width="1" />
        <g ref={roseGroupRef} transform={`rotate(${(-initialBearing).toFixed(2)})`}>
          <line x1="0" y1="-13" x2="0" y2="-9.5" stroke="#f08a5d" stroke-width="1.8" stroke-linecap="round" />
          <line x1="13" y1="0" x2="10.5" y2="0" stroke="rgba(255,255,255,0.35)" stroke-width="1" />
          <line x1="0" y1="13" x2="0" y2="10.5" stroke="rgba(255,255,255,0.35)" stroke-width="1" />
          <line x1="-13" y1="0" x2="-10.5" y2="0" stroke="rgba(255,255,255,0.35)" stroke-width="1" />
          <polygon points="0,-9 -2.3,-3.5 2.3,-3.5" fill="#f08a5d" />
          <polygon points="0,8.2 -2,3.5 2,3.5" fill="rgba(255,255,255,0.35)" />
        </g>
        <circle
          ref={orbCircleRef}
          cx={(initialOrb.rx * 12).toFixed(2)}
          cy={(initialOrb.ry * 12).toFixed(2)}
          r={showSun ? '2.6' : '2.2'}
          fill={showSun ? '#f2c46d' : '#b7d0f7'}
          stroke="rgba(10,13,18,0.85)"
          stroke-width="0.9"
        />
      </svg>
      <span class="skyhud-compass-readout">
        <span ref={degSpanRef} class="skyhud-deg">{initialIntDeg}°</span>
        <span ref={cardSpanRef} class="skyhud-cardinal">{bearingToCardinal16(initialBearing)}</span>
      </span>
    </>
  );
}

/**
 * Popover sky dome + heading readout, also updating via direct DOM refs
 * so orbiting while the solar popover is open triggers 0 Preact VDOM diffs.
 */
function SkyDomeSection({ snap }: { readonly snap: SkyWeatherSnapshot }): JSX.Element {
  const ctl = useShell();
  const { solar, lunar, plusXTrueBearingDeg } = snap;
  const roseGroupRef = useRef<SVGGElement | null>(null);
  const axisLineRef = useRef<SVGLineElement | null>(null);
  const moonCircleRef = useRef<SVGCircleElement | null>(null);
  const sunCircleRef = useRef<SVGCircleElement | null>(null);
  const headingStrongRef = useRef<HTMLElement | null>(null);
  const lastIntDegRef = useRef<number>(Number.NaN);

  const initialBearing =
    typeof ctl.getCompassBearingDeg === 'function'
      ? ctl.getCompassBearingDeg()
      : cameraCompassBearingDeg.peek();
  const R = 46;
  const sunPt = projectCelestialOnCompassRose(solar.azimuthFromNorthDeg, solar.altitudeDeg, initialBearing);
  const moonPt = projectCelestialOnCompassRose(lunar.azimuthFromNorthDeg, lunar.altitudeDeg, initialBearing);
  const paddockRelRad = (((plusXTrueBearingDeg - initialBearing) % 360) * Math.PI) / 180;
  const mainStRelRad = (((plusXTrueBearingDeg + 180 - initialBearing) % 360) * Math.PI) / 180;
  const sunCard = bearingToCardinal16(solar.azimuthFromNorthDeg);
  const initialIntDeg = ((Math.round(initialBearing) % 360) + 360) % 360;

  useEffect(() => {
    lastIntDegRef.current = Number.NaN;
    const applyBearing = (b: number): void => {
      if (roseGroupRef.current) {
        roseGroupRef.current.setAttribute('transform', `rotate(${(-b).toFixed(2)})`);
      }
      if (axisLineRef.current) {
        const padRad = (((plusXTrueBearingDeg - b) % 360) * Math.PI) / 180;
        const mainRad = (((plusXTrueBearingDeg + 180 - b) % 360) * Math.PI) / 180;
        axisLineRef.current.setAttribute('x1', (Math.sin(mainRad) * (R - 3)).toFixed(1));
        axisLineRef.current.setAttribute('y1', (-Math.cos(mainRad) * (R - 3)).toFixed(1));
        axisLineRef.current.setAttribute('x2', (Math.sin(padRad) * (R - 3)).toFixed(1));
        axisLineRef.current.setAttribute('y2', (-Math.cos(padRad) * (R - 3)).toFixed(1));
      }
      if (sunCircleRef.current) {
        const sPt = projectCelestialOnCompassRose(solar.azimuthFromNorthDeg, solar.altitudeDeg, b);
        sunCircleRef.current.setAttribute('cx', (sPt.rx * R).toFixed(2));
        sunCircleRef.current.setAttribute('cy', (sPt.ry * R).toFixed(2));
      }
      if (moonCircleRef.current) {
        const mPt = projectCelestialOnCompassRose(lunar.azimuthFromNorthDeg, lunar.altitudeDeg, b);
        moonCircleRef.current.setAttribute('cx', (mPt.rx * R).toFixed(2));
        moonCircleRef.current.setAttribute('cy', (mPt.ry * R).toFixed(2));
      }
      const intDeg = ((Math.round(b) % 360) + 360) % 360;
      if (intDeg !== lastIntDegRef.current) {
        lastIntDegRef.current = intDeg;
        if (headingStrongRef.current) {
          headingStrongRef.current.textContent = `${intDeg}° ${bearingToCardinal16(b)}`;
        }
      }
    };
    const disposeSignal = effect(() => {
      applyBearing(cameraCompassBearingDeg.value);
    });
    if (typeof ctl.getCompassBearingDeg === 'function') {
      applyBearing(ctl.getCompassBearingDeg());
    }
    const unsubCamera =
      typeof ctl.onCompassBearingChanged === 'function'
        ? ctl.onCompassBearingChanged(applyBearing)
        : () => {};
    return () => {
      unsubCamera();
      disposeSignal();
    };
  }, [
    ctl,
    plusXTrueBearingDeg,
    solar.azimuthFromNorthDeg,
    solar.altitudeDeg,
    lunar.azimuthFromNorthDeg,
    lunar.altitudeDeg,
  ]);

  return (
    <div class="skyhud-dome-row">
      <svg
        class="skyhud-dome-svg"
        width="118"
        height="118"
        viewBox="-60 -60 120 120"
        role="img"
        aria-label="True-North sun and moon sky dome"
      >
        <circle cx="0" cy="0" r={R} fill="rgba(8, 11, 16, 0.78)" stroke="rgba(255,255,255,0.2)" stroke-width="1.1" />
        <circle cx="0" cy="0" r={R * 0.66} fill="none" stroke="rgba(255,255,255,0.09)" stroke-dasharray="2 2" stroke-width="0.8" />
        <circle cx="0" cy="0" r={R * 0.33} fill="none" stroke="rgba(255,255,255,0.09)" stroke-dasharray="2 2" stroke-width="0.8" />

        {/* Paddock (+X, NNW) & Main Street (-X, SSE) site axis line */}
        <line
          ref={axisLineRef}
          x1={(Math.sin(mainStRelRad) * (R - 3)).toFixed(1)}
          y1={(-Math.cos(mainStRelRad) * (R - 3)).toFixed(1)}
          x2={(Math.sin(paddockRelRad) * (R - 3)).toFixed(1)}
          y2={(-Math.cos(paddockRelRad) * (R - 3)).toFixed(1)}
          stroke="rgba(242, 196, 109, 0.25)"
          stroke-width="1"
          stroke-dasharray="3 2"
        />

        {/* Rotated True-North cardinal ring */}
        <g ref={roseGroupRef} transform={`rotate(${(-initialBearing).toFixed(2)})`}>
          <polygon points={`0,${-(R - 2)} -3.2,${-(R - 9)} 3.2,${-(R - 9)}`} fill="#f08a5d" />
          <text x="0" y={-(R + 5)} text-anchor="middle" fill="#f08a5d" font-size="8.5" font-weight="700">
            N
          </text>
          <text x={R + 7} y="3" text-anchor="middle" fill="rgba(238,240,243,0.62)" font-size="7.5" font-weight="600">
            E
          </text>
          <text x="0" y={R + 11} text-anchor="middle" fill="rgba(238,240,243,0.62)" font-size="7.5" font-weight="600">
            S
          </text>
          <text x={-(R + 7)} y="3" text-anchor="middle" fill="rgba(238,240,243,0.62)" font-size="7.5" font-weight="600">
            W
          </text>
        </g>

        {/* Camera forward crosshair at top */}
        <line x1="0" y1="0" x2="0" y2="-12" stroke="rgba(255,255,255,0.32)" stroke-width="1" />
        <circle cx="0" cy="0" r="2" fill="rgba(255,255,255,0.55)" />

        {/* Moon position */}
        <circle
          ref={moonCircleRef}
          cx={(moonPt.rx * R).toFixed(2)}
          cy={(moonPt.ry * R).toFixed(2)}
          r="3.8"
          fill={lunar.altitudeDeg >= 0 ? '#bfd6fa' : 'rgba(191,214,250,0.3)'}
          stroke="rgba(10,13,18,0.9)"
          stroke-width="1"
        />

        {/* Sun position */}
        <circle
          ref={sunCircleRef}
          cx={(sunPt.rx * R).toFixed(2)}
          cy={(sunPt.ry * R).toFixed(2)}
          r="5.2"
          fill={sunPt.isAboveHorizon ? '#f2c46d' : 'rgba(242,196,109,0.28)'}
          stroke={sunPt.isAboveHorizon ? '#fff3d1' : 'rgba(255,255,255,0.25)'}
          stroke-width="1.2"
        />
      </svg>

      <div class="skyhud-ephem-grid">
        <div class="skyhud-kv">
          <span>View Heading</span>
          <strong ref={headingStrongRef}>
            {initialIntDeg}° {bearingToCardinal16(initialBearing)}
          </strong>
        </div>
        <div class="skyhud-kv">
          <span>Sun Position</span>
          <strong>
            {solar.altitudeDeg >= 0 ? '+' : ''}
            {solar.altitudeDeg.toFixed(1)}° · {Math.round(solar.azimuthFromNorthDeg)}° {sunCard}
          </strong>
        </div>
        <div class="skyhud-kv">
          <span>Rise · Noon · Set</span>
          <strong>
            {formatCivilHourHHMM(solar.sunriseHour)} · {formatCivilHourHHMM(solar.solarNoonHour)} ·{' '}
            {formatCivilHourHHMM(solar.sunsetHour)}
          </strong>
        </div>
        <div class="skyhud-kv">
          <span>Daylight · Moon</span>
          <strong>
            {formatDurationHoursHM(solar.dayLengthHours)} · {lunar.phaseName} ({Math.round(lunar.illuminatedFraction * 100)}%)
          </strong>
        </div>
      </div>
    </div>
  );
}

export function SkyWeatherHud(): JSX.Element | null {
  const ctl = useShell();
  const snap = skyWeatherSnapshot.value;
  // NOTE: Intentionally DO NOT read `cameraCompassBearingDeg.value` here!
  // Reading it at the top level would force a 660-line Preact VDOM diff on every 60 Hz camera orbit frame.
  const openPopover = skyHudPopover.value;
  const tod = timeOfDay.value;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const sliderRafRef = useRef<{
    rafId: number;
    pending: Record<string, (() => void) | undefined>;
    pointerActive: boolean;
    cleanupWindowUp: (() => void) | null;
  }>({ rafId: 0, pending: {}, pointerActive: false, cleanupWindowUp: null });

  const flushPendingSliders = (): void => {
    const state = sliderRafRef.current;
    if (state.rafId !== 0 && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }
    const tasks = state.pending;
    state.pending = {};
    for (const k of Object.keys(tasks)) {
      tasks[k]?.();
    }
  };

  const finishPointerScrub = (): void => {
    const state = sliderRafRef.current;
    state.cleanupWindowUp?.();
    state.cleanupWindowUp = null;
    state.pointerActive = false;
    flushPendingSliders();
    ctl.endInteractiveScrub?.();
  };

  const handleSliderPointerDown = (): void => {
    const state = sliderRafRef.current;
    state.cleanupWindowUp?.();
    state.pointerActive = true;
    ctl.beginInteractiveScrub?.(true);
    if (typeof window !== 'undefined') {
      const onUp = (): void => finishPointerScrub();
      window.addEventListener('pointerup', onUp, { once: true });
      window.addEventListener('pointercancel', onUp, { once: true });
      window.addEventListener('blur', onUp, { once: true });
      state.cleanupWindowUp = () => {
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        window.removeEventListener('blur', onUp);
      };
    }
  };

  // Coalesces high-DPI 250-1000 Hz pointer/range input bursts to at most 1 update per rAF
  // (leading-edge immediate on frame 0 + trailing-edge latest value on next rAF; synchronous in Node tests).
  const scheduleCoalescedSlider = (key: string, fn: () => void): void => {
    if (typeof requestAnimationFrame !== 'function') {
      fn();
      return;
    }
    const state = sliderRafRef.current;
    ctl.beginInteractiveScrub(state.pointerActive);
    if (state.rafId === 0) {
      fn();
      state.rafId = requestAnimationFrame(() => {
        state.rafId = 0;
        const tasks = state.pending;
        state.pending = {};
        for (const k of Object.keys(tasks)) {
          tasks[k]?.();
        }
      });
    } else {
      state.pending[key] = fn;
    }
  };

  useEffect(() => {
    return () => {
      const state = sliderRafRef.current;
      state.cleanupWindowUp?.();
      state.cleanupWindowUp = null;
      if (state.rafId !== 0 && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(state.rafId);
        state.rafId = 0;
      }
      state.pending = {};
      if (state.pointerActive) {
        state.pointerActive = false;
        ctl.endInteractiveScrub?.();
      }
    };
  }, [ctl]);

  // Close open popover when clicking outside the HUD widget
  useEffect(() => {
    if (openPopover === 'none') return undefined;
    const onPointerDown = (e: PointerEvent): void => {
      const root = wrapRef.current;
      if (root && e.target instanceof Node && !root.contains(e.target)) {
        skyHudPopover.value = 'none';
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [openPopover]);

  if (!snap || viewMode.value === 'walk') return null;

  const { solar, lunar, weather, liveClockSync } = snap;
  const tzLabel =
    solar.timezoneAbbreviation ||
    weather.timezoneAbbreviation ||
    formatUtcOffsetLabel(solar.utcOffsetHours);
  const coordsLabel =
    snap.latitudeDeg !== undefined && snap.longitudeDeg !== undefined
      ? formatLatLonCoords(snap.latitudeDeg, snap.longitudeDeg)
      : '';
  const sunEyebrow = [snap.locationLabel, coordsLabel, tzLabel].filter(Boolean).join(' · ');
  const weatherEyebrow =
    snap.locationLabel && !weather.source.includes(snap.locationLabel)
      ? `${snap.locationLabel} · ${weather.source}`
      : weather.source;
  const timeStr = formatCivilHourHHMM(solar.civilHour);
  const dateStr = formatDayOfYearShort(solar.dayOfYear, solar.year);
  const windCard = bearingToCardinal16(weather.windDirDeg);
  const effCloudPct = effectiveCloudCoverPct(weather);
  const isDryClearAir = weather.precipType === 'none' && !weather.fogEnabled;
  const isNight = solar.altitudeDeg < -0.833;
  const weatherIcon = weatherIconForCondition(
    weather.condition,
    isNight,
    effCloudPct,
    isDryClearAir
  );
  const hudWeatherBadge = formatHudWeatherBadge(weather);
  const latDeg = snap.latitudeDeg ?? 52.544462;
  const lonDeg = snap.longitudeDeg ?? -0.947371;
  const effectiveSeason: Season =
    snap.season ?? deriveSeasonFromDayOfYear(solar.dayOfYear, latDeg);
  const seasonSelection: SeasonSelection = snap.seasonSelection ?? 'auto';
  const climate =
    snap.climate ??
    resolveClimateCapabilities({
      location: {
        lat: latDeg,
        lon: lonDeg,
        elevationM: snap.elevationM,
        label: snap.locationLabel,
      },
      season: effectiveSeason,
      environment: snap.environmentId as any,
    });
  const snowDisabled = !climate.snowAllowedNow;
  const snowDisabledReason =
    climate.snowDisabledReason ??
    (snowDisabled ? 'Snow unavailable for current location/season' : undefined);
  const selectSeason = (nextSeason: SeasonSelection): void => {
    if (typeof ctl.setSeason === 'function') {
      ctl.setSeason(nextSeason);
      return;
    }
    if (nextSeason !== 'auto') {
      ctl.setSolarDateTime({
        civilHour: solar.civilHour,
        dayOfYear: canonicalDayOfYearForSeason(nextSeason, latDeg),
        year: solar.year,
      });
    }
  };
  const renderSeasonSelector = (testIdPrefix: string): JSX.Element => (
    <div class="skyhud-season-row" data-testid={`${testIdPrefix}-season-row`}>
      <span class="skyhud-season-row-label" title={(climate.seasonNote ?? undefined)}>
        Season · {SEASON_LABELS[effectiveSeason]}
      </span>
      <div class="skyhud-season-chips" role="group" aria-label="Season selector">
        {SEASON_SELECTIONS.map((opt) => {
          const isActive =
            seasonSelection === opt.id ||
            (seasonSelection === 'auto' && opt.id === 'auto');
          const isDerivedMatch = seasonSelection === 'auto' && opt.id === effectiveSeason;
          const tip =
            opt.id === 'auto'
              ? `Auto season from calendar date (${SEASON_LABELS[effectiveSeason]})`
              : !climate.hasDistinctFoliageSeasons
                ? `${opt.label} solar angle · ${(climate.seasonNote ?? undefined)}`
                : opt.id === 'winter' && climate.snowSupportedAtLocation
                  ? 'Winter season (snow enabled)'
                  : `${opt.label} season`;
          return (
            <button
              key={opt.id}
              type="button"
              data-testid={`${testIdPrefix}-season-${opt.id}`}
              class={`skyhud-mini-chip${isActive ? ' is-active' : isDerivedMatch ? ' is-derived' : ''}`}
              aria-pressed={isActive}
              title={tip}
              onClick={() => selectSeason(opt.id)}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );

  const applyCloudPct = (rawPct: number): void => {
    const pct = Math.max(0, Math.min(100, Math.round(rawPct)));
    ctl.setWeatherCloudLayer(pct > 0, pct);
  };

  const togglePopover = (target: Exclude<SkyHudPopover, 'none'>): void => {
    skyHudPopover.value = openPopover === target ? 'none' : target;
  };

  const hourFillPct = `${((solar.civilHour / 24) * 100).toFixed(1)}%`;
  const dayFillPct = `${(((solar.dayOfYear - 1) / 364) * 100).toFixed(1)}%`;
  const cloudFillPct = `${effCloudPct}%`;
  const precipPct = Math.round(weather.precipIntensity * 100);
  const fogPct = Math.round(weather.fogIntensity * 100);

  return (
    <div class="skyhud-anchor" ref={wrapRef} data-testid="sky-weather-hud">
      <div class="skyhud-bar shell-glass" role="region" aria-label={snap.locationLabel ? `${snap.locationLabel} sky, compass and weather` : 'Sky, compass and weather'}>
        <button
          type="button"
          class={`skyhud-pill skyhud-pill-sun${openPopover === 'sun' ? ' is-open' : ''}`}
          data-testid="sky-hud-sun-btn"
          aria-expanded={openPopover === 'sun'}
          aria-label="Open solar, lunar and compass controls"
          title={snap.locationLabel ? `True-North compass & ${snap.locationLabel} solar/lunar ephemeris` : 'True-North compass & solar/lunar ephemeris'}
          onClick={() => togglePopover('sun')}
        >
          <MiniCompassReadout snap={snap} />
          <span class="skyhud-sep" aria-hidden="true" />
          {liveClockSync && <span class="skyhud-live-badge">LIVE</span>}
          <span class="skyhud-clock">{timeStr}</span>
          <span class="skyhud-sub">{dateStr}</span>
          <span class="skyhud-sub skyhud-alt-hide-sm">
            {isNight
              ? `Moon ${Math.round(lunar.illuminatedFraction * 100)}%`
              : `Sun ${solar.altitudeDeg >= 0 ? '+' : ''}${solar.altitudeDeg.toFixed(0)}°`}
          </span>
        </button>

        <span class="skyhud-bar-divider" aria-hidden="true" />

        <button
          type="button"
          class={`skyhud-pill skyhud-pill-weather${openPopover === 'weather' ? ' is-open' : ''}`}
          data-testid="sky-hud-weather-btn"
          aria-expanded={openPopover === 'weather'}
          aria-label={snap.locationLabel ? `Open ${snap.locationLabel} live weather and cloud/rain/mist layers` : 'Open live weather and cloud/rain/mist layers'}
          title={snap.locationLabel ? `${snap.locationLabel} live weather & composable sky layers` : 'Live weather & composable sky layers'}
          onClick={() => togglePopover('weather')}
        >
          <Icon name={weatherIcon} size={15} />
          {weather.liveFeedEnabled && <span class="skyhud-live-badge is-blue">LIVE</span>}
          <span class="skyhud-temp">{Math.round(weather.temperatureC)}°C</span>
          <span class="skyhud-cond" data-testid="sky-hud-weather-badge">{hudWeatherBadge}</span>
        </button>
      </div>

      {openPopover === 'sun' && (
        <section
          class="skyhud-popover shell-glass"
          aria-label="Solar and lunar ephemeris controls"
          data-testid="sky-popover-sun"
        >
          <div class="skyhud-pop-head">
            <div>
              <div class="skyhud-eyebrow">{sunEyebrow}</div>
              <div class="skyhud-pop-title">Solar &amp; Lunar Ephemeris</div>
            </div>
            <button
              type="button"
              class={`skyhud-sync-btn${liveClockSync ? ' is-live' : ''}`}
              aria-pressed={liveClockSync}
              onClick={() => ctl.setLiveClockSync(!liveClockSync)}
            >
              <span class="skyhud-dot" />
              {liveClockSync ? 'LIVE TIME ON' : 'LIVE CLOCK'}
            </button>
          </div>

          <SkyDomeSection snap={snap} />

          <div class="skyhud-seg-row">
            <div class="shell-seg shell-seg-sm" role="group" aria-label="Lighting presets">
              {TOD_CHIPS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  class={`shell-seg-btn${!liveClockSync && tod === c.id ? ' is-active' : ''}`}
                  onClick={() => ctl.setTimeOfDay(c.id)}
                >
                  <Icon name={c.icon} size={13} />
                  <span>{c.label}</span>
                </button>
              ))}
            </div>
          </div>
          {renderSeasonSelector('sun')}

          <div class="skyhud-slider-group skyhud-sun-cloud-group">
            <div class="skyhud-cloud-quick-head">
              <label class="skyhud-slider-label">
                <span>Cloud Cover</span>
                <strong data-testid="sun-cloud-pct">{effCloudPct}%</strong>
              </label>
              <div class="skyhud-season-chips" role="group" aria-label="Quick cloud cover">
                {QUICK_CLOUD_CHIPS.map((chip) => {
                  const chipActive =
                    chip.pct === 0
                      ? effCloudPct < 15
                      : chip.pct < 78
                        ? effCloudPct >= 15 && effCloudPct <= 77
                        : effCloudPct >= 78;
                  return (
                    <button
                      key={chip.label}
                      type="button"
                      class={`skyhud-mini-chip${chipActive ? ' is-active' : ''}`}
                      aria-pressed={chipActive}
                      onClick={() => applyCloudPct(chip.pct)}
                    >
                      {chip.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <input
              type="range"
              class="shell-range"
              data-testid="sun-cloud-slider"
              min="0"
              max="100"
              step="1"
              value={effCloudPct}
              style={{ '--fill': cloudFillPct } as Record<string, string>}
              aria-label="Sun popover cloud cover percentage"
              onPointerDown={handleSliderPointerDown}
              onKeyUp={finishPointerScrub}
              onInput={(e) => {
                const v = Number(e.currentTarget.value);
                scheduleCoalescedSlider('cloud', () => applyCloudPct(v));
              }}
            />
          </div>

          <div class="skyhud-slider-group">
            <label class="skyhud-slider-label">
              <span>Local Civil Time ({tzLabel})</span>
              <strong>{timeStr}</strong>
            </label>
            <input
              type="range"
              class="shell-range"
              min="0"
              max="23.98"
              step="0.05"
              value={solar.civilHour}
              style={{ '--fill': hourFillPct } as Record<string, string>}
              aria-label="Solar civil hour"
              onPointerDown={handleSliderPointerDown}
              onKeyUp={finishPointerScrub}
              onInput={(e) => {
                const nextHour = Number(e.currentTarget.value);
                if (Number.isFinite(nextHour)) {
                  const doy = solar.dayOfYear;
                  const yr = solar.year;
                  scheduleCoalescedSlider('hour', () => {
                    ctl.setSolarDateTime({
                      civilHour: nextHour,
                      dayOfYear: doy,
                      year: yr,
                    });
                  });
                }
              }}
            />
          </div>

          <div class="skyhud-slider-group">
            <label class="skyhud-slider-label">
              <span>Date / Solar Declination ({solar.declinationDeg >= 0 ? '+' : ''}{solar.declinationDeg.toFixed(1)}°)</span>
              <strong>{dateStr}</strong>
            </label>
            <input
              type="range"
              class="shell-range"
              min="1"
              max="365"
              step="1"
              value={solar.dayOfYear}
              style={{ '--fill': dayFillPct } as Record<string, string>}
              aria-label="Day of year"
              onPointerDown={handleSliderPointerDown}
              onKeyUp={finishPointerScrub}
              onInput={(e) => {
                const nextDay = Number(e.currentTarget.value);
                if (Number.isFinite(nextDay)) {
                  const hr = solar.civilHour;
                  const yr = solar.year;
                  scheduleCoalescedSlider('day', () => {
                    ctl.setSolarDateTime({
                      civilHour: hr,
                      dayOfYear: nextDay,
                      year: yr,
                    });
                  });
                }
              }}
            />
          </div>

        </section>
      )}

      {openPopover === 'weather' && (
        <section
          class="skyhud-popover shell-glass"
          aria-label={snap.locationLabel ? `${snap.locationLabel} weather controls` : 'Weather controls'}
          data-testid="sky-popover-weather"
        >
          <div class="skyhud-pop-head">
            <div>
              <div class="skyhud-eyebrow">{weatherEyebrow}</div>
              <div class="skyhud-pop-title">{weather.description}</div>
            </div>
            <div class="skyhud-head-actions">
              {weather.liveFeedEnabled && (
                <button
                  type="button"
                  class="skyhud-mini-chip"
                  title="Refresh Open-Meteo live weather telemetry"
                  onClick={() => {
                    void ctl.refreshLiveWeather();
                  }}
                >
                  Refresh
                </button>
              )}
              <button
                type="button"
                class={`skyhud-sync-btn is-blue${weather.liveFeedEnabled ? ' is-live' : ''}`}
                aria-pressed={weather.liveFeedEnabled}
                onClick={() => {
                  void ctl.setWeatherLiveFeed(!weather.liveFeedEnabled);
                }}
              >
                <span class="skyhud-dot" />
                {weather.liveFeedEnabled ? 'LIVE WEATHER ON' : 'LIVE WEATHER'}
              </button>
            </div>
          </div>

          <div class="skyhud-telemetry-strip">
            <div class="skyhud-stat">
              <span>Temp</span>
              <strong>
                {weather.temperatureC.toFixed(1)}°C <small>(feels {weather.feelsLikeC.toFixed(0)}°)</small>
              </strong>
            </div>
            <div class="skyhud-stat">
              <span>Wind</span>
              <strong>
                {Math.round(weather.windSpeedKph)} kph {windCard}
              </strong>
            </div>
            <div class="skyhud-stat">
              <span>Humidity</span>
              <strong>{weather.humidityPct}%</strong>
            </div>
            <div class="skyhud-stat">
              <span>Vis / Wet</span>
              <strong>
                {weather.visibilityKm.toFixed(1)} km · {Math.round(weather.surfaceWetness * 100)}%
              </strong>
            </div>
          </div>

          {renderSeasonSelector('weather')}

          <div class="skyhud-preset-grid" role="group" aria-label="Weather presets">
            {WEATHER_PRESETS.map((p) => {
              const isSnowPreset = p.id === 'winter_snow';
              const disabled = isSnowPreset && snowDisabled;
              const active = !disabled && isWeatherPresetActive(p.id, weather);
              return (
                <button
                  key={p.id}
                  type="button"
                  data-testid={`weather-preset-${p.id}`}
                  class={`skyhud-preset-chip${active ? ' is-active' : ''}${disabled ? ' is-disabled' : ''}`}
                  aria-pressed={active}
                  aria-disabled={disabled}
                  disabled={disabled}
                  title={disabled ? snowDisabledReason : p.label}
                  onClick={() => {
                    if (disabled) return;
                    ctl.applyWeatherPreset(p.id);
                  }}
                >
                  <Icon name={p.icon} size={13} />
                  <span>{p.label}</span>
                </button>
              );
            })}
          </div>

          <div class="skyhud-layers">
            <div class="skyhud-layer-card">
              <div class="skyhud-layer-head">
                <span class="skyhud-layer-title">
                  <Icon name="cloud" size={14} />
                  <span>Cloud Cover</span>
                </span>
                <div class="skyhud-layer-right">
                  <span class="skyhud-layer-val" data-testid="weather-cloud-pct">{effCloudPct}%</span>
                </div>
              </div>
              <input
                type="range"
                class="shell-range"
                data-testid="weather-cloud-slider"
                min="0"
                max="100"
                step="1"
                value={effCloudPct}
                style={{ '--fill': cloudFillPct } as Record<string, string>}
                aria-label="Cloud cover percentage"
                onPointerDown={handleSliderPointerDown}
                onKeyUp={finishPointerScrub}
                onInput={(e) => {
                const v = Number(e.currentTarget.value);
                scheduleCoalescedSlider('cloud', () => applyCloudPct(v));
              }}
              />
            </div>

            <div class="skyhud-layer-card">
              <div class="skyhud-layer-head">
                <span class="skyhud-layer-title">
                  <Icon name={weather.precipType === 'snow' ? 'snow' : 'rain'} size={14} />
                  <span>Precipitation</span>
                </span>
                <div class="shell-seg shell-seg-sm" role="group" aria-label="Precipitation type">
                  {PRECIP_MODES.map((m) => {
                    const isSnowBtn = m.id === 'snow';
                    const disabled = isSnowBtn && snowDisabled;
                    const active = !disabled && weather.precipType === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        data-testid={`weather-precip-${m.id}`}
                        class={`shell-seg-btn${active ? ' is-active' : ''}${disabled ? ' is-disabled' : ''}`}
                        aria-disabled={disabled}
                        disabled={disabled}
                        title={disabled ? snowDisabledReason : m.label}
                        onClick={() => {
                          if (disabled) return;
                          ctl.setWeatherPrecipitationLayer(
                            m.id,
                            m.id === 'none' ? 0 : Math.max(0.45, weather.precipIntensity)
                          );
                        }}
                      >
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {weather.precipType !== 'none' && (
                <input
                  type="range"
                  class="shell-range"
                  min="10"
                  max="100"
                  step="1"
                  value={precipPct}
                  style={{ '--fill': `${precipPct}%` } as Record<string, string>}
                  aria-label="Precipitation intensity"
                  onPointerDown={handleSliderPointerDown}
                  onKeyUp={finishPointerScrub}
                  onInput={(e) => {
                    const pType = weather.precipType;
                    const val = Number(e.currentTarget.value) / 100;
                    scheduleCoalescedSlider('precip', () =>
                      ctl.setWeatherPrecipitationLayer(pType, val)
                    );
                  }}
                />
              )}
            </div>

            <div class="skyhud-layer-card">
              <div class="skyhud-layer-head">
                <span class="skyhud-layer-title">
                  <Icon name="mist" size={14} />
                  <span>Valley Mist &amp; Haze</span>
                </span>
                <div class="skyhud-layer-right">
                  <span class="skyhud-layer-val">{weather.fogEnabled ? `${fogPct}%` : 'Off'}</span>
                  <button
                    type="button"
                    class={`shell-switch${weather.fogEnabled ? ' is-on' : ''}`}
                    role="switch"
                    aria-checked={weather.fogEnabled}
                    aria-label="Toggle valley mist and haze"
                    onClick={() =>
                      ctl.setWeatherFogLayer(
                        !weather.fogEnabled,
                        weather.fogEnabled ? weather.fogIntensity : Math.max(0.55, weather.fogIntensity)
                      )
                    }
                  >
                    <span class="shell-switch-knob" />
                  </button>
                </div>
              </div>
              {weather.fogEnabled && (
                <input
                  type="range"
                  class="shell-range"
                  min="10"
                  max="100"
                  step="1"
                  value={fogPct}
                  style={{ '--fill': `${fogPct}%` } as Record<string, string>}
                  aria-label="Valley mist density"
                  onPointerDown={handleSliderPointerDown}
                  onKeyUp={finishPointerScrub}
                  onInput={(e) => {
                    const val = Number(e.currentTarget.value) / 100;
                    scheduleCoalescedSlider('fog', () => ctl.setWeatherFogLayer(true, val));
                  }}
                />
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
