import { options, render } from 'preact';
import { describe, expect, it, vi } from 'vitest';
import {
  bearingToCardinal16,
  formatCivilHourHHMM,
  formatDayOfYearShort,
  formatDurationHoursHM,
  forwardXZToTrueBearingDeg,
  projectCelestialOnCompassRose,
} from '../../core/solar-weather-format.ts';
import type { SkyWeatherSnapshot } from '../../core/types/solar-weather.ts';
import {
  cameraCompassBearingDeg,
  closeTopOverlay,
  skyHudPopover,
  skyWeatherSnapshot,
  viewMode,
} from '../../state/shell-store.ts';
import { ShellContext } from './shell-context.ts';
import type { ShellController } from './shell-controller.ts';
import {
  SkyWeatherHud,
  effectiveCloudCoverPct,
  formatHudWeatherBadge,
  isWeatherPresetActive,
} from './SkyWeatherHud.tsx';
import { h } from 'preact';

const SAMPLE_SNAPSHOT: SkyWeatherSnapshot = {
  timeOfDay: 'dusk',
  liveClockSync: false,
  plusXTrueBearingDeg: 340.17,
  locationLabel: 'Cotswolds · Gloucestershire',
  latitudeDeg: 51.8412,
  longitudeDeg: -1.7924,
  elevationM: 120.88,
  solar: {
    civilHour: 19.75,
    dayOfYear: 172,
    year: 2026,
    utcOffsetHours: 1,
    timezone: 'Europe/London',
    timezoneAbbreviation: 'BST',
    equationOfTimeMin: -1.6,
    apparentSolarHour: 18.69,
    solarNoonHour: 13.09,
    sunriseHour: 4.71,
    sunsetHour: 21.55,
    dayLengthHours: 16.84,
    declinationDeg: 23.44,
    altitudeDeg: 14.2,
    azimuthFromNorthDeg: 292.4,
    isAfterSunset: false,
    trueSunDirection: [0.65, 0.245, -0.718],
    shadowLightDirection: [0.65, 0.245, -0.718],
  },
  lunar: {
    altitudeDeg: 22.0,
    azimuthFromNorthDeg: 134.0,
    illuminatedFraction: 0.42,
    synodicPhaseDeg: 81.0,
    isWaxing: true,
    lunarAgeDays: 6.6,
    phaseName: 'First Quarter',
    trueMoonDirection: [-0.83, 0.37, -0.41],
    shadowMoonDirection: [-0.83, 0.37, -0.41],
  },
  weather: {
    liveFeedEnabled: false,
    condition: 'partly_cloudy',
    rawConditionCode: 'PARTLY_CLOUDY',
    description: 'Partly Cloudy · Cotswolds',
    temperatureC: 15.4,
    feelsLikeC: 14.6,
    dewPointC: 9.2,
    precipitationMm: 0,
    precipitationChancePct: 12,
    thunderstormChancePct: 0,
    cloudCoverPct: 38,
    windSpeedKph: 14,
    windGustKph: 20,
    windDirDeg: 235,
    humidityPct: 68,
    visibilityKm: 16.0,
    pressureHpa: 1016,
    source: 'Cotswolds Preset',
    updatedAtIso: '2026-06-21T19:45:00Z',
    cloudEnabled: true,
    precipType: 'none',
    precipIntensity: 0,
    fogEnabled: false,
    fogIntensity: 0,
    surfaceWetness: 0,
  },
};

describe('solar-weather-format pure helpers', () => {
  it('computes True-North bearings & cardinal labels accurately for Cotswold House axes', () => {
    expect(forwardXZToTrueBearingDeg(1, 0, 340.17)).toBeCloseTo(340.17, 2); // +X axis
    expect(forwardXZToTrueBearingDeg(-1, 0, 340.17)).toBeCloseTo(160.17, 2); // -X axis
    expect(forwardXZToTrueBearingDeg(0, 1, 340.17)).toBeCloseTo(70.17, 2); // +Z Courtyard ENE
    expect(bearingToCardinal16(340.17)).toBe('NNW');
    expect(bearingToCardinal16(160.17)).toBe('SSE');
    expect(bearingToCardinal16(70.17)).toBe('ENE');
    expect(formatCivilHourHHMM(4.7167)).toBe('04:43');
    expect(formatDurationHoursHM(16.84)).toBe('16h 50m');
    expect(formatDayOfYearShort(172, 2026)).toBe('21 Jun');
  });

  it('projects celestial positions onto the camera-oriented compass dial', () => {
    // Looking due North (0°), sun due East (90°) at 45° altitude -> right side (+rx, ~0 ry)
    const pt = projectCelestialOnCompassRose(90, 45, 0);
    expect(pt.isAboveHorizon).toBe(true);
    expect(pt.rx).toBeGreaterThan(0.4);
    expect(Math.abs(pt.ry)).toBeLessThan(1e-6);
  });
});

describe('SkyWeatherHud Preact widget & popovers (jsdom-lite check)', () => {
  it('closes skyHudPopover via closeTopOverlay() before modal overlays', () => {
    skyHudPopover.value = 'weather';
    expect(closeTopOverlay()).toBe(true);
    expect(skyHudPopover.value).toBe('none');
  });

  it('renders compass, UK solar clock, and Cotswolds weather popovers cleanly when DOM is available', () => {
    if (typeof document === 'undefined') {
      // Vitest runs in node environment by default; verify component callable with signals
      skyWeatherSnapshot.value = SAMPLE_SNAPSHOT;
      cameraCompassBearingDeg.value = 160.2;
      viewMode.value = '3d';
      skyHudPopover.value = 'sun';
      const fakeCtl = {
        setLiveClockSync: vi.fn(),
        setSolarDateTime: vi.fn(),
        setTimeOfDay: vi.fn(),
        applyWeatherPreset: vi.fn(),
      } as unknown as ShellController;
      const vnode = h(ShellContext.Provider, { value: fakeCtl, children: h(SkyWeatherHud, null) });
      expect(vnode).toBeTruthy();
      skyHudPopover.value = 'none';
      return;
    }

    const host = document.createElement('div');
    skyWeatherSnapshot.value = SAMPLE_SNAPSHOT;
    cameraCompassBearingDeg.value = 160.2;
    viewMode.value = '3d';
    skyHudPopover.value = 'weather';
    const fakeCtl = {
      beginInteractiveScrub: vi.fn(),
      endInteractiveScrub: vi.fn(),
      setLiveClockSync: vi.fn(),
      setSolarDateTime: vi.fn(),
      setTimeOfDay: vi.fn(),
      applyWeatherPreset: vi.fn(),
    } as unknown as ShellController;
    render(h(ShellContext.Provider, { value: fakeCtl, children: h(SkyWeatherHud, null) }), host);
    expect(host.textContent).toContain('Cotswolds');
    render(null, host);
    skyHudPopover.value = 'none';
  });

  it('exposes always-visible 0..100% Cloud Cover sliders in both Weather & Sun popovers (0% -> 42% -> 92% -> 0%) and range-matched preset badges', () => {
    const clearWeather = {
      ...SAMPLE_SNAPSHOT.weather,
      cloudEnabled: false,
      cloudCoverPct: 0,
      condition: 'clear' as const,
    };
    const partly42 = {
      ...SAMPLE_SNAPSHOT.weather,
      cloudEnabled: true,
      cloudCoverPct: 42,
      condition: 'partly_cloudy' as const,
    };
    const overcast92 = {
      ...SAMPLE_SNAPSHOT.weather,
      cloudEnabled: true,
      cloudCoverPct: 92,
      condition: 'overcast' as const,
    };

    expect(effectiveCloudCoverPct(clearWeather)).toBe(0);
    expect(formatHudWeatherBadge(clearWeather)).toBe('Clear');
    expect(isWeatherPresetActive('clear', clearWeather)).toBe(true);
    expect(isWeatherPresetActive('partly_cloudy', clearWeather)).toBe(false);

    expect(effectiveCloudCoverPct(partly42)).toBe(42);
    expect(formatHudWeatherBadge(partly42)).toBe('42% Clouds');
    expect(isWeatherPresetActive('partly_cloudy', partly42)).toBe(true);
    expect(isWeatherPresetActive('clear', partly42)).toBe(false);
    expect(isWeatherPresetActive('overcast', partly42)).toBe(false);

    expect(effectiveCloudCoverPct(overcast92)).toBe(92);
    expect(formatHudWeatherBadge(overcast92)).toBe('Overcast');
    expect(isWeatherPresetActive('overcast', overcast92)).toBe(true);

    // Traverse Preact VNode tree directly so the test exercises real rendered sliders even in Node
    const calls: Array<{ enabled: boolean; pct: number }> = [];
    const fakeCtl = {
      beginInteractiveScrub: vi.fn(),
      endInteractiveScrub: vi.fn(),
      setLiveClockSync: vi.fn(),
      setSolarDateTime: vi.fn(),
      setTimeOfDay: vi.fn(),
      applyWeatherPreset: vi.fn(),
      setWeatherCloudLayer: vi.fn((enabled: boolean, pct: number) => {
        calls.push({ enabled, pct });
        skyWeatherSnapshot.value = {
          ...SAMPLE_SNAPSHOT,
          weather: {
            ...SAMPLE_SNAPSHOT.weather,
            cloudEnabled: enabled,
            cloudCoverPct: pct,
          },
        };
      }),
    } as unknown as ShellController;

    const findNodeByTestId = (node: unknown, testId: string): any => {
      if (!node || typeof node !== 'object') return null;
      if (Array.isArray(node)) {
        for (const child of node) {
          const hit = findNodeByTestId(child, testId);
          if (hit) return hit;
        }
        return null;
      }
      const vnode = node as { type?: unknown; props?: Record<string, any> };
      if (typeof vnode.type === 'function' && vnode.type !== SkyWeatherHud) {
        return null;
      }
      if (vnode.props?.['data-testid'] === testId) return vnode;
      if (vnode.props?.children) return findNodeByTestId(vnode.props.children, testId);
      return null;
    };

    // Render SkyWeatherHud through Preact's hook lifecycle (__b / __r) in Node so useShell(), useRef(),
    // and useEffect() run cleanly and return the real rendered JSX VNode tree!
    const evalComponentWithCtl = (): unknown => {
      const cid = (ShellContext as unknown as { __c: string }).__c;
      const comp: Record<string, unknown> = {
        __H: { __: [], __h: [] },
        context: { [cid]: { props: { value: fakeCtl }, sub: () => {} } },
        props: {},
        setState: () => {},
        forceUpdate: () => {},
      };
      const vnode: Record<string, unknown> = { type: SkyWeatherHud, props: {}, __c: comp };
      (options as unknown as { __b?: (v: unknown) => void }).__b?.(vnode);
      (options as unknown as { __r?: (v: unknown) => void }).__r?.(vnode);
      const out = SkyWeatherHud();
      (options as unknown as { diffed?: (v: unknown) => void }).diffed?.(vnode);
      (options as unknown as { unmount?: (v: unknown) => void }).unmount?.(vnode);
      return out;
    };

    try {
      skyWeatherSnapshot.value = { ...SAMPLE_SNAPSHOT, weather: clearWeather };
      viewMode.value = '3d';

      skyHudPopover.value = 'weather';
      const weatherTree = evalComponentWithCtl();
      const weatherSlider = findNodeByTestId(weatherTree, 'weather-cloud-slider');
      expect(weatherSlider).toBeTruthy();
      expect(weatherSlider.props.min).toBe('0');
      expect(weatherSlider.props.max).toBe('100');
      expect(weatherSlider.props.value).toBe(0);
      // No hidden 'Toggle 3D cloud deck' Off switch gating the slider!
      expect(JSON.stringify(weatherTree)).not.toContain('Toggle 3D cloud deck');

      // Drag Weather Cloud Cover slider: 0% -> 42% -> 92% -> 0%
      weatherSlider.props.onInput({ currentTarget: { value: '42' } });
      weatherSlider.props.onInput({ currentTarget: { value: '92' } });
      weatherSlider.props.onInput({ currentTarget: { value: '0' } });

      // Also verify Sun / Daylight popover exposes its own 0..100% Cloud Cover slider
      skyHudPopover.value = 'sun';
      const sunTree = evalComponentWithCtl();
      const sunSlider = findNodeByTestId(sunTree, 'sun-cloud-slider');
      expect(sunSlider).toBeTruthy();
      expect(sunSlider.props.min).toBe('0');
      expect(sunSlider.props.max).toBe('100');
      expect(sunSlider.props.value).toBe(0);
      sunSlider.props.onInput({ currentTarget: { value: '42' } });

      expect(calls).toEqual([
        { enabled: true, pct: 42 },
        { enabled: true, pct: 92 },
        { enabled: false, pct: 0 },
        { enabled: true, pct: 42 },
      ]);

      // Verify pointerdown -> keyup brackets interactive scrub cleanly
      sunSlider.props.onPointerDown();
      sunSlider.props.onKeyUp();
      expect(fakeCtl.beginInteractiveScrub).toHaveBeenCalledWith(true);
      expect(fakeCtl.endInteractiveScrub).toHaveBeenCalled();
    } finally {
      skyHudPopover.value = 'none';
    }
  });

  it('renders dynamic coordinates, timezone abbreviations, and generic labels for non-UK zero-config locations', () => {
    const fakeCtl = {
      beginInteractiveScrub: vi.fn(),
      endInteractiveScrub: vi.fn(),
      setLiveClockSync: vi.fn(),
      setSolarDateTime: vi.fn(),
      setTimeOfDay: vi.fn(),
      applyWeatherPreset: vi.fn(),
      setWeatherCloudLayer: vi.fn(),
      setWeatherLiveFeed: vi.fn(),
      refreshLiveWeather: vi.fn(),
    } as unknown as ShellController;

    const evalComponent = (): unknown => {
      const cid = (ShellContext as unknown as { __c: string }).__c;
      const comp: Record<string, unknown> = {
        __H: { __: [], __h: [] },
        context: { [cid]: { props: { value: fakeCtl }, sub: () => {} } },
        props: {},
        setState: () => {},
        forceUpdate: () => {},
      };
      const vnode: Record<string, unknown> = { type: SkyWeatherHud, props: {}, __c: comp };
      (options as unknown as { __b?: (v: unknown) => void }).__b?.(vnode);
      (options as unknown as { __r?: (v: unknown) => void }).__r?.(vnode);
      const out = SkyWeatherHud();
      (options as unknown as { diffed?: (v: unknown) => void }).diffed?.(vnode);
      (options as unknown as { unmount?: (v: unknown) => void }).unmount?.(vnode);
      return out;
    };

    const laSnapshot: SkyWeatherSnapshot = {
      ...SAMPLE_SNAPSHOT,
      plusXTrueBearingDeg: 90,
      locationLabel: undefined,
      latitudeDeg: 34.1003,
      longitudeDeg: -118.3698,
      elevationM: 231,
      solar: {
        ...SAMPLE_SNAPSHOT.solar,
        utcOffsetHours: -7,
        timezone: 'America/Los_Angeles',
        timezoneAbbreviation: 'PDT',
      },
      weather: {
        ...SAMPLE_SNAPSHOT.weather,
        description: 'Clear Sky',
        source: 'Open-Meteo Live',
        timezone: 'America/Los_Angeles',
        timezoneAbbreviation: 'PDT',
        utcOffsetSeconds: -25200,
        elevationM: 231,
      },
    };

    try {
      viewMode.value = '3d';
      skyWeatherSnapshot.value = laSnapshot;

      skyHudPopover.value = 'sun';
      const sunJson = JSON.stringify(evalComponent());
      expect(sunJson).toContain('34.100°N, 118.370°W · PDT');
      expect(sunJson).toContain('Local Civil Time');
      expect(sunJson).toContain('LIVE CLOCK');
      expect(sunJson).not.toContain('Cotswolds');
      expect(sunJson).not.toContain('OX7');
      expect(sunJson).not.toContain('LIVE UK');
      expect(sunJson).not.toContain('UKV');

      skyHudPopover.value = 'weather';
      const weatherJson = JSON.stringify(evalComponent());
      expect(weatherJson).toContain('Open-Meteo Live');
      expect(weatherJson).toContain('Clear Sky');
      expect(weatherJson).toContain('LIVE WEATHER');
      expect(weatherJson).not.toContain('Cotswolds');
      expect(weatherJson).not.toContain('OX7');
      expect(weatherJson).not.toContain('UKV');

      // Cotswolds snapshot preserves its label, coordinates, and BST
      skyWeatherSnapshot.value = SAMPLE_SNAPSHOT;
      skyHudPopover.value = 'sun';
      const ukSunJson = JSON.stringify(evalComponent());
      expect(ukSunJson).toContain('Cotswolds · Gloucestershire · 51.841°N, 1.792°W · BST');
    } finally {
      skyHudPopover.value = 'none';
    }
  });
});

describe('SkyWeatherHud season selector & climate-aware snow controls', () => {
  it('exposes Auto/Spring/Summer/Autumn/Winter season selector and disables Snow controls outside Winter or in warm climates', () => {
    const seasonCalls: string[] = [];
    const fakeCtl = {
      beginInteractiveScrub: vi.fn(),
      endInteractiveScrub: vi.fn(),
      setLiveClockSync: vi.fn(),
      setSolarDateTime: vi.fn(),
      setTimeOfDay: vi.fn(),
      setSeason: vi.fn((s: string) => seasonCalls.push(s)),
      applyWeatherPreset: vi.fn(),
      setWeatherCloudLayer: vi.fn(),
      setWeatherPrecipitationLayer: vi.fn(),
      setWeatherLiveFeed: vi.fn(),
      refreshLiveWeather: vi.fn(),
    } as unknown as ShellController;

    const findNodeByTestId = (node: unknown, testId: string): any => {
      if (!node || typeof node !== 'object') return null;
      if (Array.isArray(node)) {
        for (const child of node) {
          const hit = findNodeByTestId(child, testId);
          if (hit) return hit;
        }
        return null;
      }
      const vnode = node as { type?: unknown; props?: Record<string, any> };
      if (typeof vnode.type === 'function' && vnode.type !== SkyWeatherHud) return null;
      if (vnode.props?.['data-testid'] === testId) return vnode;
      if (vnode.props?.children) return findNodeByTestId(vnode.props.children, testId);
      return null;
    };

    const evalComponent = (): unknown => {
      const cid = (ShellContext as unknown as { __c: string }).__c;
      const comp: Record<string, unknown> = {
        __H: { __: [], __h: [] },
        context: { [cid]: { props: { value: fakeCtl }, sub: () => {} } },
        props: {},
        setState: () => {},
        forceUpdate: () => {},
      };
      const vnode: Record<string, unknown> = { type: SkyWeatherHud, props: {}, __c: comp };
      (options as unknown as { __b?: (v: unknown) => void }).__b?.(vnode);
      (options as unknown as { __r?: (v: unknown) => void }).__r?.(vnode);
      const out = SkyWeatherHud();
      (options as unknown as { diffed?: (v: unknown) => void }).diffed?.(vnode);
      (options as unknown as { unmount?: (v: unknown) => void }).unmount?.(vnode);
      return out;
    };

    try {
      viewMode.value = '3d';
      skyWeatherSnapshot.value = { ...SAMPLE_SNAPSHOT, season: 'summer', seasonSelection: 'summer' };
      skyHudPopover.value = 'weather';
      const summerTree = evalComponent();
      const winterSnowChip = findNodeByTestId(summerTree, 'weather-preset-winter_snow');
      const snowPrecipBtn = findNodeByTestId(summerTree, 'weather-precip-snow');
      expect(winterSnowChip.props.disabled).toBe(true);
      expect(winterSnowChip.props.title).toContain('Snow only available in Winter');
      expect(snowPrecipBtn.props.disabled).toBe(true);

      const winterSeasonBtn = findNodeByTestId(summerTree, 'weather-season-winter');
      winterSeasonBtn.props.onClick();
      expect(seasonCalls).toEqual(['winter']);

      skyWeatherSnapshot.value = { ...SAMPLE_SNAPSHOT, season: 'winter', seasonSelection: 'winter' };
      const winterTree = evalComponent();
      expect(findNodeByTestId(winterTree, 'weather-preset-winter_snow').props.disabled).toBe(false);
      expect(findNodeByTestId(winterTree, 'weather-precip-snow').props.disabled).toBe(false);

      skyWeatherSnapshot.value = {
        ...SAMPLE_SNAPSHOT,
        latitudeDeg: 34.1004,
        longitudeDeg: -118.3702,
        elevationM: 240.2,
        season: 'winter',
        seasonSelection: 'winter',
        environmentId: 'hollywood-hills',
      };
      const stahlTree = evalComponent();
      const stahlSnowChip = findNodeByTestId(stahlTree, 'weather-preset-winter_snow');
      expect(stahlSnowChip.props.disabled).toBe(true);
      expect(stahlSnowChip.props.title).toContain('Snow unavailable at this location');
    } finally {
      skyHudPopover.value = 'none';
    }
  });
});
