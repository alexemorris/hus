#!/usr/bin/env node
/**
 * `husjs hdri` — Nano Banana Seamless 360° 8K Master-Anchor Ultra-HDR Environment Matrix Generator.
 *
 * Generates seamless 2:1 equirectangular environments across the 3D
 * `(Season × TimeSlot × WeatherRegime)` tensor for Hus.js architectural digital twins:
 *   - `*_8k.webp` (`8192×4096` default): Master-Anchor-locked native `4K` Nano Banana
 *     (`gemini-3-pro-image-preview`) panorama suite with 4-azimuth `4K` (`4992×3328` per tile)
 *     horizon super-resolution on the Master Anchor and 1:1 pixel-registered `2:1` (`5760×2880`)
 *     relighting across all time/weather/season cells (`colShift = 0`, True-North compass layout),
 *     encoded with an invertible highlight-shoulder curve (`GAINMAP_SHOULDER_K = 0.85`).
 *   - `*_2k.hdr` (`1024×512` default): 1:1 sub-pixel-aligned `#?RADIANCE` (`FORMAT=32-bit_rle_rgbe`)
 *     physical linear radiance map for `< 1 ms` `PMREMGenerator` IBL & ISO-21496-1 style gainmap fusion.
 *   - `*_512.hdr` (`512×256`): fast progressive preview `.hdr`.
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { decodePng } from './husjs-terrain.mjs';

export const SEASONS = /** @type {const} */ (['spring', 'summer', 'autumn', 'winter']);
export const TIME_SLOTS = /** @type {const} */ (['dawn', 'day', 'dusk', 'night']);
export const WEATHER_REGIMES = /** @type {const} */ (['clear', 'cloudy', 'overcast', 'rain', 'snow']);

export const GAINMAP_SHOULDER_K = 0.85;

const CLI_4K_PATH = '/tmp/generate_image_4k_cli';
const CLOUDTOP_CLI_PATH = '/google/bin/releases/gemini-agents-generate-image/generate_image_cli';
const PRO_4K_MODEL = 'gemini-3-pro-image-preview';
const DEFAULT_CLI_MODEL = 'gemini-3.1-flash-image';
const FALLBACK_MODEL = 'gemini-2.5-flash-image';
const VALID_IMAGE_SIZES = new Set(['1K', '2K', '4K']);

const HDR_USAGE = `Usage: husjs hdri [options]

Options:
  --preset <id>              Environment preset ID (e.g. english-countryside, hollywood-hills, custom)
  --prompt <text>            Base location/landscape prompt (auto-populated for built-in presets)
  --refs <a.png,b.jpg,...>   Optional comma-separated reference photos for style/landscape grounding
  --anchor <path>            Optional pre-existing seamless 2:1 Master Anchor PNG for suite relighting
  --no-anchor-lock           Disable Master-Anchor 1:1 horizon locking across suite cells
  --seasons <list>           Comma-separated seasons: spring,summer,autumn,winter (default: summer)
  --times <list>             Comma-separated times: dawn,day,dusk,night (default: day,dusk,night)
  --weathers <list>          Comma-separated weathers: clear,cloudy,overcast,rain,snow (default: clear)
  --cells <list>             Optional explicit cell list: [<season>_]<time>_<weather>[@<res>]
  --out <dir>                Output directory (default: public/textures/hdr)
  --res <2048|1536|1024|512> Physical Radiance .hdr width (height = width / 2, default: 1024)
  --detail-res <width>       Ultra-HDR visual detail .webp width (default: 8192 -> *_8k.webp; 4096 -> *_4k.webp; 0 disables)
  --preview-res <width>      Fast preview .hdr width (default: 512; 0 disables _512.hdr output)
  --image-size <1K|2K|4K>    Nano Banana native generation size (default: 4K)
  --webp-quality <1..100>    WebP encoding quality for detail panoramas (default: 83)
  --no-multitile             Disable 4-azimuth horizon super-resolution tiling on Master Anchor
  --backend <auto|rest|cli>  Nano Banana backend selection (default: auto)
  --model <id>               Nano Banana model ID (default: gemini-3-pro-image-preview for 4K w/ fallbacks)
  --gcp-project <id>         Cloud project for generate_image_cli (auto-detected if omitted)
  --concurrency <n>          Parallel generation workers (default: 4)
  --skip-existing            Skip cells whose target .hdr, detail .webp, and preview already exist
  --manifest-out <file>      Optional JSON manifest path recording per-cell sun UV & horizonGround RGB
  --help, -h                 Show this help message`;

export const DEFAULT_HDR_SUN_V = {
  dawn: 0.42,
  day: 0.18,
  dusk: 0.36,
  night: 0.38,
};

/**
 * True-North Compass Equirectangular Convention (`northU = 0`):
 *   u = 0.00 / 1.00 : True North (0°)
 *   u = 0.25        : True East  (90°  — Dawn sunrise)
 *   u = 0.50        : True South (180° — Midday sun / primary South vista)
 *   u = 0.75        : True West  (270° — Dusk sunset)
 */
export const DEFAULT_WORLD_ANCHORED_SUN_U = {
  dawn: 0.25,
  day: 0.5,
  dusk: 0.75,
  night: 0.5,
};

export const PRESET_BASE_PROMPTS = {
  'english-countryside':
    'Wide 360-degree equirectangular countryside panorama in the Cotswolds, England: gently rolling pastoral meadows, crisp hawthorn hedgerows, mature oak and ash tree canopies at medium-far distance, and distant honey-stone cottage rooftops low on the far horizon',
  'hollywood-hills':
    'Wide 360-degree equirectangular panorama from a Hollywood Hills promontory ridge above Sunset Boulevard in Los Angeles (240m elevation): crisp coastal sage scrub and chaparral canyon ridges in the mid-distance, low chaparral scrub below the horizon line (no tall close foreground trees blocking the skyline), and the vast panoramic Los Angeles Basin stretching flat with razor-sharp urban grid detail to the distant Pacific Ocean horizon',
  'english-countryside':
    'Wide 360-degree equirectangular English pastoral countryside panorama with rolling green meadows, distant hedgerows, and mature broadleaf trees low along a level horizon',
};

const COMPASS_LAYOUT_PROMPTS = {
  'english-countryside':
    'Wide 360-degree equirectangular countryside panorama in the Cotswolds, England: gently rolling pastoral meadows, crisp hawthorn hedgerows, mature oak and ash tree canopies at medium-far distance, and distant honey-stone cottage rooftops low on the far horizon',
  'hollywood-hills':
    'Strict True-North compass azimuth layout across the panorama width: at horizontal center (True South, 180°, u=0.50) the vast flat panoramic Los Angeles Basin street grid, distant Downtown LA high-rise skyline toward left-of-center SSE, and sparkling distant Pacific Ocean horizon to the SSW; at left-quarter (True East, 90°, u=0.25) Griffith Observatory ridge and eastern Hollywood Hills; at right-quarter (True West, 270°, u=0.75) Santa Monica Mountains coastal ridge and Westside/Century City horizon; at both far-left and far-right wrap edges (True North, 0°/360°, u=0.0/1.0) matching low coastal sage and chaparral Hollywood Hills slope behind the promontory so left and right edges wrap seamlessly.',
};

const SEASON_DESCRIPTIONS = {
  'english-countryside': {
    spring:
      'in fresh English Spring (May): vibrant young lime-emerald pasture grass, crisp white May blossom frosting the hawthorn hedgerows, finely detailed budding oak foliage',
    summer:
      'in lush high English Summer (June): rich deep emerald meadow pastures, crisp leafy oak and ash canopies, wildflowers along distant hedgerow margins',
    autumn:
      'in golden English Autumn (October): crisp russet, amber, and copper oak and hawthorn foliage, golden-ochre harvest pastures',
    winter:
      'in crisp English Winter (January): razor-sharp bare sculptural oak and hawthorn branches, muted winter-dormant frosted fescue pasture',
  },
  default: {
    spring: 'in fresh Spring foliage and vibrant young green ground cover',
    summer: 'in lush full Summer foliage and warm sunlit terrain',
    autumn: 'in warm golden-amber Autumn foliage',
    winter: 'in crisp Winter atmosphere',
  },
};

const TIME_DESCRIPTIONS = {
  dawn: 'at early Dawn sunrise: low warm rose-amber eastern horizon glow (at left-quarter East azimuth u=0.25) transitioning smoothly to cool pale cerulean upper sky, without any oversized white sun blob',
  day: 'in natural Midday daylight: expansive realistic sky dome overhead illuminated from True South (horizontal center u=0.50) with crisp cloud micro-texture and clean atmospheric perspective toward the distant horizon',
  dusk: 'at Golden Hour Dusk sunset: rich warm amber-apricot western horizon glow (at right-quarter West azimuth u=0.75) transitioning smoothly into deep twilight indigo-blue zenith sky, without any blown-out white sun blob',
  night: 'at calm Astronomical Night: dark deep midnight-indigo sky dome with subtle moonlight and pinpoint warm distant village or city lights twinkling cleanly along the far horizon',
};

const WEATHER_DESCRIPTIONS = {
  clear: 'under Clear sky conditions with crystal-clear air, tack-sharp distant horizon detail, and clean directional lighting',
  cloudy: 'under Partly Cloudy sky (~45% crisp cumulus and stratocumulus clouds) with sharp sunlit cloud edges and blue sky patches',
  overcast: 'under full 100% Overcast stratus cloud canopy with soft, even, shadowless diffuse sky illumination and zero direct sun disc',
  rain: 'during steady Rain under dark slate-grey layered nimbus rain clouds, wet misty atmospheric horizon, and zero direct sun hotspot',
  snow: 'during Winter Snow with pale silver-grey overcast snow clouds, a clean blanket of fresh white snow covering the rolling fields, hedgerows, and distant rooftops, and crisp winter horizon detail',
};

export function parseHdriCliArgs(argv) {
  const opts = {
    preset: 'english-countryside',
    prompt: '',
    refs: /** @type {string[]} */ ([]),
    anchor: '',
    anchorLock: true,
    seasons: ['summer'],
    times: ['day', 'dusk', 'night'],
    weathers: ['clear'],
    cells: /** @type {string[]} */ ([]),
    outDir: 'public/textures/hdr',
    res: 1024,
    detailRes: 8192,
    previewRes: 512,
    imageSize: '4K',
    webpQuality: 83,
    multiTile: false,
    backend: 'auto',
    model: '',
    gcpProject: '',
    concurrency: 4,
    skipExisting: false,
    manifestOut: '',
    help: false,
  };

  let explicitNoAnchorLock = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`Missing value after ${arg}`);
      return argv[++i];
    };
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--preset') {
      opts.preset = next().trim();
    } else if (arg === '--prompt') {
      opts.prompt = next().trim();
    } else if (arg === '--refs') {
      opts.refs = next()
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg === '--anchor') {
      opts.anchor = next().trim();
    } else if (arg === '--no-anchor-lock') {
      explicitNoAnchorLock = true;
    } else if (arg === '--seasons') {
      opts.seasons = next()
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    } else if (arg === '--times') {
      opts.times = next()
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    } else if (arg === '--weathers') {
      opts.weathers = next()
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    } else if (arg === '--cells') {
      opts.cells = next()
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    } else if (arg === '--out') {
      opts.outDir = next().trim();
    } else if (arg === '--res') {
      opts.res = Number(next());
    } else if (arg === '--detail-res') {
      opts.detailRes = Number(next());
    } else if (arg === '--preview-res') {
      opts.previewRes = Number(next());
    } else if (arg === '--image-size') {
      opts.imageSize = next().trim().toUpperCase();
    } else if (arg === '--webp-quality') {
      opts.webpQuality = Number(next());
    } else if (arg === '--no-multitile') {
      opts.multiTile = false;
    } else if (arg === '--multitile') {
      opts.multiTile = true;
    } else if (arg === '--backend') {
      opts.backend = next().trim().toLowerCase();
    } else if (arg === '--model') {
      opts.model = next().trim();
    } else if (arg === '--gcp-project') {
      opts.gcpProject = next().trim();
    } else if (arg === '--concurrency') {
      opts.concurrency = Math.max(1, Math.min(10, Number(next()) || 1));
    } else if (arg === '--skip-existing') {
      opts.skipExisting = true;
    } else if (arg === '--manifest-out') {
      opts.manifestOut = next().trim();
    } else {
      throw new Error(`Unknown option '${arg}'`);
    }
  }

  if (!Number.isInteger(opts.res) || opts.res < 64 || opts.res % 2 !== 0) {
    throw new Error(`Invalid --res ${opts.res}: expected an even integer >= 64 (e.g. 2048, 1536, 1024)`);
  }
  if (!Number.isInteger(opts.detailRes) || opts.detailRes < 0 || opts.detailRes % 2 !== 0) {
    throw new Error(`Invalid --detail-res ${opts.detailRes}: expected 0 or an even integer (e.g. 8192, 4096)`);
  }
  if (!VALID_IMAGE_SIZES.has(opts.imageSize)) {
    throw new Error(`Invalid --image-size '${opts.imageSize}' (expected 1K, 2K, or 4K)`);
  }
  if (!Number.isFinite(opts.webpQuality) || opts.webpQuality < 1 || opts.webpQuality > 100) {
    throw new Error(`Invalid --webp-quality ${opts.webpQuality}: expected 1..100`);
  }
  opts.webpQuality = Math.round(opts.webpQuality);

  for (const s of opts.seasons) {
    if (!SEASONS.includes(/** @type {any} */ (s))) {
      throw new Error(`Invalid season '${s}' (expected spring,summer,autumn,winter)`);
    }
  }
  for (const t of opts.times) {
    if (!TIME_SLOTS.includes(/** @type {any} */ (t))) {
      throw new Error(`Invalid time '${t}' (expected dawn,day,dusk,night)`);
    }
  }
  for (const w of opts.weathers) {
    if (!WEATHER_REGIMES.includes(/** @type {any} */ (w))) {
      throw new Error(`Invalid weather '${w}' (expected clear,cloudy,overcast,rain,snow)`);
    }
  }

  const estimatedCellCount =
    opts.cells.length > 0
      ? opts.cells.length
      : opts.seasons.length * opts.times.length * opts.weathers.length;
  opts.anchorLock = explicitNoAnchorLock
    ? false
    : Boolean(opts.anchor) || opts.detailRes >= 4096 || estimatedCellCount > 1;

  return opts;
}

export function buildCellPrompt({
  preset,
  basePrompt,
  season,
  time,
  weather,
  includeSeason = true,
  includeCompassLayout = false,
}) {
  const base =
    basePrompt ||
    PRESET_BASE_PROMPTS[/** @type {keyof typeof PRESET_BASE_PROMPTS} */ (preset)] ||
    `Wide 360-degree equirectangular architectural environment panorama of ${preset.replace(/[-_]+/g, ' ')}`;
  const seasonTable =
    SEASON_DESCRIPTIONS[/** @type {keyof typeof SEASON_DESCRIPTIONS} */ (preset)] ??
    SEASON_DESCRIPTIONS.default;
  const seasonClause = includeSeason ? ` ${seasonTable[season] ?? SEASON_DESCRIPTIONS.default[season]},` : '';
  const timeClause = TIME_DESCRIPTIONS[time] ?? TIME_DESCRIPTIONS.day;
  const weatherClause =
    preset === 'hollywood-hills' && weather === 'overcast' && time === 'day'
      ? 'under a soft coastal Southern California marine-layer overcast sky with diffused silver-white skylight, gentle coastal haze over the LA Basin, and zero harsh point sun hotspot'
      : preset === 'hollywood-hills' && time === 'night'
        ? 'at clear California Night with a vast glittering carpet of pinpoint warm golden-amber and cool white Los Angeles street-grid city lights across the flat basin below, dark chaparral hills, and deep starry indigo sky'
        : WEATHER_DESCRIPTIONS[weather] ?? WEATHER_DESCRIPTIONS.clear;
  const compassClause = includeCompassLayout
    ? ` ${COMPASS_LAYOUT_PROMPTS[/** @type {keyof typeof COMPASS_LAYOUT_PROMPTS} */ (preset)] ?? 'Strict True-North compass layout: True South at horizontal center (u=0.50), True East at left-quarter (u=0.25), True West at right-quarter (u=0.75), True North matching at far-left and far-right wrap edges (u=0.0/1.0).'}`
    : '';

  return (
    `${base},${seasonClause} ${timeClause}, ${weatherClause}.${compassClause} ` +
    'True 360-degree equirectangular environment panorama with a perfectly level horizontal horizon line ' +
    'exactly at the vertical midpoint (50% height), continuous left-to-right wrap-around horizon, ' +
    'expansive sky dome filling the upper half (top 50%), natural distant ground/meadows filling the lower half, ' +
    'tack-sharp 8K medium-format architectural photography with crisp distant trees, ridges, clouds, and horizon edges, ' +
    'NO depth-of-field blur, NO bokeh, NO close foreground buildings/roads/cars/fences/tripods/people, NO text or watermarks.'
  );
}

export function buildAnchorRelightPrompt({
  preset,
  season,
  time,
  weather,
  includeSeason = true,
}) {
  const seasonTable =
    SEASON_DESCRIPTIONS[/** @type {keyof typeof SEASON_DESCRIPTIONS} */ (preset)] ??
    SEASON_DESCRIPTIONS.default;
  const targetLabel = [
    includeSeason ? season.toUpperCase() : '',
    time.toUpperCase(),
    weather.toUpperCase(),
  ]
    .filter(Boolean)
    .join(' ');

  let lightingInstruction;
  if (weather === 'overcast') {
    lightingInstruction =
      preset === 'hollywood-hills'
        ? 'Relight the sky into a soft Southern California coastal marine-layer 100% overcast stratus canopy with even diffused silver-white skylight, gentle coastal haze over the distant LA Basin, and ZERO direct point sun hotspot.'
        : 'Relight the sky into a full 100% overcast stratus cloud deck with soft, even, shadowless diffuse sky illumination across terrain and foliage, and ZERO direct point sun hotspot.';
  } else if (weather === 'rain') {
    lightingInstruction =
      'Relight into steady Rain under dark slate-grey layered nimbus rain clouds with wet glistening ground and foliage, subtle atmospheric rain mist along the far horizon, and ZERO direct point sun hotspot.';
  } else if (weather === 'snow') {
    lightingInstruction =
      time === 'dusk'
        ? 'Relight into Winter Dusk Snow under muted blue-lavender winter twilight snow clouds with a soft rose-amber twilight horizon hint on the right-quarter West azimuth (u=0.75), a clean blanket of fresh white snow covering the exact existing fields, hedgerows, and distant rooftops, snow-dusted bare branches on the exact existing trees, tiny warm cottage window pinpoints on existing distant buildings, and ZERO direct sun hotspot.'
        : 'Relight into Winter Day Snow under pale silver-grey overcast snow clouds, a clean blanket of fresh white snow covering the exact existing rolling fields, hedgerows, and distant rooftops, snow-dusted bare branches on the exact existing trees, and ZERO direct point sun hotspot.';
  } else if (time === 'dawn') {
    lightingInstruction =
      preset === 'hollywood-hills'
        ? 'Relight into crisp California Dawn sunrise: warm rose-gold sunrise horizon glow centered on the left-quarter East azimuth (25% from left edge, u=0.25, behind the Griffith Observatory eastern hills) transitioning smoothly into cool pale cerulean-indigo upper sky, soft early-morning basin haze, and ZERO oversized white sun blob.'
        : 'Relight into early English Dawn sunrise: warm rose-amber sunrise glow centered low on the left-quarter East azimuth (25% from left edge, u=0.25) transitioning smoothly to cool pale cerulean upper sky, gentle morning meadow mist, and ZERO oversized white sun blob.';
  } else if (time === 'dusk') {
    lightingInstruction =
      preset === 'hollywood-hills'
        ? 'Relight into Golden-Hour California Dusk sunset: rich warm amber-apricot and magenta-gold sunset glow centered low on the right-quarter West azimuth (75% from left edge, u=0.75, over the Santa Monica Mountains & Westside) transitioning smoothly into deep twilight indigo-blue zenith sky, early warm twilight glints beginning along the exact existing LA Basin street grid, and ZERO blown-out white sun blob.'
        : 'Relight into Golden-Hour English Dusk sunset: rich warm amber-apricot sunset glow centered low on the right-quarter West azimuth (75% from left edge, u=0.75) raking warmly across the pastures and tree canopies and transitioning smoothly into deep twilight indigo-blue zenith sky, with ZERO blown-out white sun blob.';
  } else if (time === 'night') {
    lightingInstruction =
      preset === 'hollywood-hills'
        ? 'Relight into clear Astronomical California Night: deep dark starry midnight-indigo sky dome overhead, dark night-lit chaparral hills, and a vast glittering carpet of razor-sharp pinpoint warm golden-amber and cool-white Los Angeles street-grid and skyline lights ONLY across the exact existing flat LA Basin streets and buildings below (no blurry light blobs).'
        : 'Relight into calm Astronomical English Night: deep dark starry midnight-indigo sky dome with subtle cool moonlight near horizontal center South (u=0.50), dark moonlit meadows and tree silhouettes, and tiny razor-sharp pinpoint warm amber cottage lights ONLY on the exact existing distant village rooftops.';
  } else if (weather === 'cloudy') {
    lightingInstruction =
      'Relight into Partly Cloudy Midday daylight (~45% crisp sunlit cumulus and stratocumulus clouds with blue sky patches), illuminated from horizontal center South (u=0.50) high overhead with ZERO oversized white sun blob.';
  } else {
    lightingInstruction =
      'Relight into crystal-clear Midday daylight illuminated from horizontal center South (u=0.50) high overhead with clean realistic blue sky dome and ZERO oversized white sun blob.';
  }

  const foliageInstruction = includeSeason
    ? ` Update seasonal foliage and ground coloration ${seasonTable[season] ?? SEASON_DESCRIPTIONS.default[season]} while keeping every tree trunk, branch structure, hedgerow line, and field boundary in the exact same pixel position.`
    : '';

  return (
    `Edit this exact 2:1 360-degree equirectangular panorama into ${targetLabel}. ` +
    'Maintain STRICT 1:1 pixel-accurate geometric registration of the entire horizon line (at 50% vertical height), ' +
    'every distant hill and ridge, every tree trunk and canopy silhouette, every hedgerow, church spire, building, skyline structure, and terrain feature—' +
    'ZERO camera rotation, ZERO horizontal shift, ZERO vertical shift, ZERO cropping or zooming, ZERO new or moved objects. ' +
    lightingInstruction +
    foliageInstruction +
    ' Output crisp native 4K medium-format optical sharpness with seamless left-to-right u=0/1 wrap continuity, NO blur, NO bokeh, NO borders or text.'
  );
}

export function buildHorizonTileSuperResPrompt({ preset, season, time, weather, azimuthLabel }) {
  const loc =
    preset === 'hollywood-hills'
      ? 'Hollywood Hills ridge overlooking the Los Angeles Basin, distant downtown skyline, and Pacific horizon'
      : preset === 'english-countryside'
        ? 'English countryside meadows, hawthorn hedgerows, mature oak/ash canopies, and distant pastoral horizon'
        : `${preset.replace(/[-_]+/g, ' ')} distant landscape horizon`;
  const nightNote =
    time === 'night'
      ? ' Render distant city/village lights as razor-sharp pinpoint micro-lights (no blurry blobs).'
      : '';
  return (
    `Exact high-resolution 8K optical detail enhancement of this ${azimuthLabel} horizon crop (${loc}, ${season} ${time} ${weather}). ` +
    'Preserve the EXACT composition, horizon height, hill/tree silhouettes, cloud positions, and color palette of the reference image 1:1 ' +
    'so left/right/top/bottom edges align seamlessly, while resolving tack-sharp fine optical detail: individual distant tree branches and foliage texture, ' +
    'crisp ridge/hedgerow/skyline edges, natural cloud micro-structure, and sharp distant terrain texture.' +
    nightNote +
    ' Zero blur, zero bokeh, zero new foreground objects, zero framing or border.'
  );
}

export function floatRgbToRgbe(r, g, b, out, offset) {
  const cr = r > 0 && Number.isFinite(r) ? r : 0;
  const cg = g > 0 && Number.isFinite(g) ? g : 0;
  const cb = b > 0 && Number.isFinite(b) ? b : 0;
  const maxComp = Math.max(cr, cg, cb);
  if (maxComp < 1e-32) {
    out[offset] = 0;
    out[offset + 1] = 0;
    out[offset + 2] = 0;
    out[offset + 3] = 0;
    return;
  }
  let exp = Math.floor(Math.log2(maxComp)) + 1;
  let scale = Math.pow(2, exp);
  if (maxComp / scale >= 1.0) {
    exp += 1;
    scale *= 2;
  }
  const eByte = exp + 128;
  if (eByte <= 0) {
    out[offset] = 0;
    out[offset + 1] = 0;
    out[offset + 2] = 0;
    out[offset + 3] = 0;
    return;
  }
  if (eByte >= 255) {
    out[offset] = 255;
    out[offset + 1] = 255;
    out[offset + 2] = 255;
    out[offset + 3] = 255;
    return;
  }
  const mult = 255.0 / scale;
  out[offset] = Math.min(255, Math.max(0, Math.round(cr * mult)));
  out[offset + 1] = Math.min(255, Math.max(0, Math.round(cg * mult)));
  out[offset + 2] = Math.min(255, Math.max(0, Math.round(cb * mult)));
  out[offset + 3] = eByte;
}

export function encodeRgbeChannelRle(channel, width, outBytes) {
  let cur = 0;
  while (cur < width) {
    let begRun = cur;
    let runCount = 0;
    let oldRunCount = 0;
    while (runCount < 4 && begRun < width) {
      begRun += runCount;
      oldRunCount = runCount;
      runCount = 1;
      while (
        begRun + runCount < width &&
        runCount < 127 &&
        channel[begRun] === channel[begRun + runCount]
      ) {
        runCount++;
      }
    }
    if (oldRunCount >= 3 && oldRunCount === begRun - cur) {
      outBytes.push(128 + oldRunCount, channel[cur]);
      cur = begRun;
    }
    while (cur < begRun) {
      const litLen = Math.min(128, begRun - cur);
      outBytes.push(litLen);
      for (let i = 0; i < litLen; i++) {
        outBytes.push(channel[cur + i]);
      }
      cur += litLen;
    }
    if (runCount >= 4) {
      outBytes.push(128 + runCount, channel[begRun]);
      cur += runCount;
    }
  }
}

export function encodeRadianceHdrRle(linearData, width, height, stride = 4) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid HDR dimensions: ${width}x${height}`);
  }
  if (linearData.length < width * height * stride) {
    throw new Error(`linearData too short (${linearData.length} < ${width * height * stride})`);
  }

  const headerText =
    '#?RADIANCE\n' +
    '# Generated by husjs hdri\n' +
    'FORMAT=32-bit_rle_rgbe\n\n' +
    `-Y ${height} +X ${width}\n`;
  const headerBytes = Buffer.from(headerText, 'ascii');

  if (width < 8 || width > 0x7fff) {
    const out = new Uint8Array(headerBytes.length + width * height * 4);
    out.set(headerBytes, 0);
    let dst = headerBytes.length;
    for (let i = 0, n = width * height; i < n; i++) {
      const s = i * stride;
      floatRgbToRgbe(linearData[s], linearData[s + 1], linearData[s + 2], out, dst);
      dst += 4;
    }
    return out;
  }

  const outBytes = [];
  for (let i = 0; i < headerBytes.length; i++) {
    outBytes.push(headerBytes[i]);
  }

  const pxRgbe = new Uint8Array(4);
  const chanR = new Uint8Array(width);
  const chanG = new Uint8Array(width);
  const chanB = new Uint8Array(width);
  const chanE = new Uint8Array(width);
  const hiW = (width >> 8) & 0xff;
  const loW = width & 0xff;

  for (let y = 0; y < height; y++) {
    const rowBase = y * width * stride;
    for (let x = 0; x < width; x++) {
      const s = rowBase + x * stride;
      floatRgbToRgbe(linearData[s], linearData[s + 1], linearData[s + 2], pxRgbe, 0);
      chanR[x] = pxRgbe[0];
      chanG[x] = pxRgbe[1];
      chanB[x] = pxRgbe[2];
      chanE[x] = pxRgbe[3];
    }
    outBytes.push(2, 2, hiW, loW);
    encodeRgbeChannelRle(chanR, width, outBytes);
    encodeRgbeChannelRle(chanG, width, outBytes);
    encodeRgbeChannelRle(chanB, width, outBytes);
    encodeRgbeChannelRle(chanE, width, outBytes);
  }

  return Uint8Array.from(outBytes);
}

export function decodeRadianceHdr(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let pos = 0;
  const readLine = () => {
    if (pos >= bytes.length) return null;
    const start = pos;
    while (pos < bytes.length && bytes[pos] !== 0x0a) pos++;
    const line = Buffer.from(bytes.subarray(start, pos)).toString('ascii').replace(/\r$/, '');
    if (pos < bytes.length && bytes[pos] === 0x0a) pos++;
    return line;
  };

  const first = readLine();
  if (!first || !first.startsWith('#?')) {
    throw new Error('Invalid Radiance HDR: missing #? magic header');
  }
  let sawFormat = false;
  let width = 0;
  let height = 0;
  while (pos < bytes.length) {
    const line = readLine();
    if (line === null) break;
    if (line.startsWith('#') || line.trim() === '') continue;
    const fmtMatch = /^\s*FORMAT=(\S+)\s*$/.exec(line);
    if (fmtMatch) {
      sawFormat = true;
      continue;
    }
    const dimMatch = /^\s*-Y\s+(\d+)\s+\+X\s+(\d+)\s*$/.exec(line);
    if (dimMatch) {
      height = Number(dimMatch[1]);
      width = Number(dimMatch[2]);
      break;
    }
  }
  if (!sawFormat || width <= 0 || height <= 0) {
    throw new Error(`Invalid Radiance HDR header (format=${sawFormat}, ${width}x${height})`);
  }

  const rgbe = new Uint8Array(width * height * 4);
  if (
    width < 8 ||
    width > 0x7fff ||
    pos + 4 > bytes.length ||
    bytes[pos] !== 2 ||
    bytes[pos + 1] !== 2 ||
    (bytes[pos + 2] & 0x80) !== 0
  ) {
    rgbe.set(bytes.subarray(pos, pos + width * height * 4));
  } else {
    const scanline = new Uint8Array(width * 4);
    for (let y = 0; y < height; y++) {
      if (pos + 4 > bytes.length) throw new Error('Truncated HDR scanline header');
      const b0 = bytes[pos++];
      const b1 = bytes[pos++];
      const b2 = bytes[pos++];
      const b3 = bytes[pos++];
      if (b0 !== 2 || b1 !== 2 || ((b2 << 8) | b3) !== width) {
        throw new Error(`Bad HDR RLE scanline header at row ${y}`);
      }
      let ptr = 0;
      const end = width * 4;
      while (ptr < end) {
        if (pos >= bytes.length) throw new Error('Truncated HDR RLE stream');
        let count = bytes[pos++];
        if (count > 128) {
          count -= 128;
          if (count === 0 || ptr + count > end) throw new Error('Bad HDR RLE run count');
          const val = bytes[pos++];
          scanline.fill(val, ptr, ptr + count);
          ptr += count;
        } else {
          if (count === 0 || ptr + count > end) throw new Error('Bad HDR literal run count');
          scanline.set(bytes.subarray(pos, pos + count), ptr);
          ptr += count;
          pos += count;
        }
      }
      const dstRow = y * width * 4;
      for (let x = 0; x < width; x++) {
        rgbe[dstRow + x * 4] = scanline[x];
        rgbe[dstRow + x * 4 + 1] = scanline[x + width];
        rgbe[dstRow + x * 4 + 2] = scanline[x + width * 2];
        rgbe[dstRow + x * 4 + 3] = scanline[x + width * 3];
      }
    }
  }

  const data = new Float32Array(width * height * 4);
  for (let i = 0, n = width * height; i < n; i++) {
    const o = i * 4;
    const e = rgbe[o + 3];
    if (e === 0) {
      data[o] = 0;
      data[o + 1] = 0;
      data[o + 2] = 0;
      data[o + 3] = 1;
    } else {
      const scale = Math.pow(2.0, e - 128.0) / 255.0;
      data[o] = rgbe[o] * scale;
      data[o + 1] = rgbe[o + 1] * scale;
      data[o + 2] = rgbe[o + 2] * scale;
      data[o + 3] = 1;
    }
  }
  return { width, height, data };
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(typeAscii, dataBuf) {
  const len = dataBuf.length;
  const out = Buffer.alloc(12 + len);
  out.writeUInt32BE(len, 0);
  out.write(typeAscii, 4, 4, 'ascii');
  if (len > 0) dataBuf.copy(out, 8);
  const crc = crc32(out.subarray(4, 8 + len));
  out.writeUInt32BE(crc, 8 + len);
  return out;
}

export function encodeRgbPng(rgbData, width, height) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowStride = width * 3;
  const raw = Buffer.alloc((rowStride + 1) * height);
  for (let y = 0; y < height; y++) {
    const dstOff = y * (rowStride + 1);
    raw[dstOff] = 0;
    Buffer.from(rgbData.buffer, rgbData.byteOffset + y * rowStride, rowStride).copy(
      raw,
      dstOff + 1
    );
  }
  const idat = deflateSync(raw, { level: 6 });
  return Buffer.concat([
    sig,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', idat),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export function srgbByteToLinear(byteVal) {
  const c = Math.max(0, Math.min(255, byteVal)) / 255.0;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgbByte(lin) {
  const c = Math.max(0, Math.min(1, lin));
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1.0 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(s * 255)));
}

export function encodeGainmapDetailRgbBytes(linearRgba, width, height, stride = 4) {
  const n = width * height;
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const si = i * stride;
    const di = i * 3;
    const r = Math.max(0, linearRgba[si]);
    const g = Math.max(0, linearRgba[si + 1]);
    const b = Math.max(0, linearRgba[si + 2]);
    out[di] = linearToSrgbByte(r / (GAINMAP_SHOULDER_K + r));
    out[di + 1] = linearToSrgbByte(g / (GAINMAP_SHOULDER_K + g));
    out[di + 2] = linearToSrgbByte(b / (GAINMAP_SHOULDER_K + b));
  }
  return out;
}

export function encodeAnchorReferencePng(anchorEquirect, srcW, srcH, dstW = 4096) {
  const dstH = Math.round(dstW / 2);
  const rgb = new Uint8Array(dstW * dstH * 3);
  const scaleX = srcW / dstW;
  const scaleY = srcH / dstH;

  for (let y = 0; y < dstH; y++) {
    const sy0 = Math.floor(y * scaleY);
    const sy1 = Math.max(sy0 + 1, Math.min(srcH, Math.ceil((y + 1) * scaleY)));
    for (let x = 0; x < dstW; x++) {
      const sx0 = Math.floor(x * scaleX);
      const sx1 = Math.max(sx0 + 1, Math.min(srcW, Math.ceil((x + 1) * scaleX)));
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        const rowOff = sy * srcW;
        for (let sx = sx0; sx < sx1; sx++) {
          const si = (rowOff + sx) * 3;
          sr += anchorEquirect[si];
          sg += anchorEquirect[si + 1];
          sb += anchorEquirect[si + 2];
          n++;
        }
      }
      const inv = 1 / Math.max(1, n);
      const r = sr * inv;
      const g = sg * inv;
      const b = sb * inv;
      const di = (y * dstW + x) * 3;
      rgb[di] = linearToSrgbByte(r / (1.0 + 0.32 * r));
      rgb[di + 1] = linearToSrgbByte(g / (1.0 + 0.32 * g));
      rgb[di + 2] = linearToSrgbByte(b / (1.0 + 0.32 * b));
    }
  }
  return encodeRgbPng(rgb, dstW, dstH);
}

export function writeRgbWebpFile(rgbBytes, width, height, outWebpPath, quality = 83) {
  const inputBuf = Buffer.from(rgbBytes.buffer, rgbBytes.byteOffset, rgbBytes.byteLength);
  try {
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-loglevel',
        'error',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgb24',
        '-s',
        `${width}x${height}`,
        '-i',
        'pipe:0',
        '-c:v',
        'libwebp',
        '-quality',
        String(quality),
        '-compression_level',
        '5',
        outWebpPath,
      ],
      { input: inputBuf, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return;
  } catch {
    const tmpPng = `${outWebpPath}.tmp.png`;
    try {
      writeFileSync(tmpPng, encodeRgbPng(rgbBytes, width, height));
      execFileSync('convert', [tmpPng, '-quality', String(quality), outWebpPath], {
        stdio: 'pipe',
      });
    } finally {
      rmSync(tmpPng, { force: true });
    }
  }
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-6, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function catmullRomWeight(t) {
  const at = Math.abs(t);
  if (at <= 1) return 1.5 * at * at * at - 2.5 * at * at + 1.0;
  if (at < 2) return -0.5 * at * at * at + 2.5 * at * at - 4.0 * at + 2.0;
  return 0;
}

function sampleCatmullRomRgb(src, srcW, srcH, fx, fy, wrapX, out, outIdx) {
  const cy = Math.max(0, Math.min(srcH - 1, fy));
  const ix = Math.floor(fx);
  const iy = Math.floor(cy);
  const tx = fx - ix;
  const ty = cy - iy;

  const wx0 = catmullRomWeight(-1 - tx);
  const wx1 = catmullRomWeight(-tx);
  const wx2 = catmullRomWeight(1 - tx);
  const wx3 = catmullRomWeight(2 - tx);

  const wy0 = catmullRomWeight(-1 - ty);
  const wy1 = catmullRomWeight(-ty);
  const wy2 = catmullRomWeight(1 - ty);
  const wy3 = catmullRomWeight(2 - ty);

  const xs = [ix - 1, ix, ix + 1, ix + 2];
  for (let k = 0; k < 4; k++) {
    xs[k] = wrapX
      ? ((xs[k] % srcW) + srcW) % srcW
      : Math.max(0, Math.min(srcW - 1, xs[k]));
  }
  const ys = [
    Math.max(0, Math.min(srcH - 1, iy - 1)),
    Math.max(0, Math.min(srcH - 1, iy)),
    Math.max(0, Math.min(srcH - 1, iy + 1)),
    Math.max(0, Math.min(srcH - 1, iy + 2)),
  ];
  const wxs = [wx0, wx1, wx2, wx3];
  const wys = [wy0, wy1, wy2, wy3];

  let r = 0, g = 0, b = 0;
  let minR = Infinity, maxR = -Infinity;
  let minG = Infinity, maxG = -Infinity;
  let minB = Infinity, maxB = -Infinity;

  for (let j = 0; j < 4; j++) {
    const wy = wys[j];
    const rowOff = ys[j] * srcW;
    for (let i = 0; i < 4; i++) {
      const w = wxs[i] * wy;
      const idx = (rowOff + xs[i]) * 3;
      const sr = src[idx];
      const sg = src[idx + 1];
      const sb = src[idx + 2];
      r += sr * w;
      g += sg * w;
      b += sb * w;
      if (i >= 1 && i <= 2 && j >= 1 && j <= 2) {
        if (sr < minR) minR = sr;
        if (sr > maxR) maxR = sr;
        if (sg < minG) minG = sg;
        if (sg > maxG) maxG = sg;
        if (sb < minB) minB = sb;
        if (sb > maxB) maxB = sb;
      }
    }
  }

  out[outIdx] = Math.max(minR, Math.min(maxR, r));
  out[outIdx + 1] = Math.max(minG, Math.min(maxG, g));
  out[outIdx + 2] = Math.max(minB, Math.min(maxB, b));
}

function boxBlurRgb(src, W, H, radius, wrapX) {
  if (radius <= 0) return new Float32Array(src);
  const tmp = new Float32Array(W * H * 3);
  const dst = new Float32Array(W * H * 3);
  const inv = 1.0 / (2 * radius + 1);

  for (let y = 0; y < H; y++) {
    const row = y * W;
    let sr = 0, sg = 0, sb = 0;
    for (let dx = -radius; dx <= radius; dx++) {
      const xx = wrapX ? ((dx % W) + W) % W : Math.max(0, Math.min(W - 1, dx));
      const i = (row + xx) * 3;
      sr += src[i];
      sg += src[i + 1];
      sb += src[i + 2];
    }
    for (let x = 0; x < W; x++) {
      const o = (row + x) * 3;
      tmp[o] = sr * inv;
      tmp[o + 1] = sg * inv;
      tmp[o + 2] = sb * inv;
      const xRem = wrapX ? (((x - radius) % W) + W) % W : Math.max(0, Math.min(W - 1, x - radius));
      const xAdd = wrapX ? (((x + radius + 1) % W) + W) % W : Math.max(0, Math.min(W - 1, x + radius + 1));
      const iRem = (row + xRem) * 3;
      const iAdd = (row + xAdd) * 3;
      sr += src[iAdd] - src[iRem];
      sg += src[iAdd + 1] - src[iRem + 1];
      sb += src[iAdd + 2] - src[iRem + 2];
    }
  }

  for (let x = 0; x < W; x++) {
    let sr = 0, sg = 0, sb = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      const yy = Math.max(0, Math.min(H - 1, dy));
      const i = (yy * W + x) * 3;
      sr += tmp[i];
      sg += tmp[i + 1];
      sb += tmp[i + 2];
    }
    for (let y = 0; y < H; y++) {
      const o = (y * W + x) * 3;
      dst[o] = sr * inv;
      dst[o + 1] = sg * inv;
      dst[o + 2] = sb * inv;
      const yRem = Math.max(0, Math.min(H - 1, y - radius));
      const yAdd = Math.max(0, Math.min(H - 1, y + radius + 1));
      const iRem = (yRem * W + x) * 3;
      const iAdd = (yAdd * W + x) * 3;
      sr += tmp[iAdd] - tmp[iRem];
      sg += tmp[iAdd + 1] - tmp[iRem + 1];
      sb += tmp[iAdd + 2] - tmp[iRem + 2];
    }
  }
  return dst;
}

function boxBlurBandRgb(fullGrid, W, H, y0, y1, radius) {
  const padY0 = Math.max(0, y0 - radius);
  const padY1 = Math.min(H, y1 + radius);
  const padH = padY1 - padY0;
  const slice = fullGrid.subarray(padY0 * W * 3, padY1 * W * 3);
  const blurred = boxBlurRgb(slice, W, padH, radius, true);
  const outOffset = (y0 - padY0) * W * 3;
  return blurred.subarray(outOffset, outOffset + (y1 - y0) * W * 3);
}

/**
 * Direct 1:1 linear equirectangular mapper for `2:1` anchor-relit panoramas (`5760×2880` -> `8192×4096`).
 * Preserves exact 1:1 horizontal & vertical registration (`u = x / W`, `v = y / (H - 1)`),
 * heals only the narrow `u ∈ [0, 0.015] ∪ [0.985, 1.0]` periodic wrap edge, and transfers
 * subtle `8K` horizon micro-detail (`r = 2`) from the super-resolved Master Anchor.
 */
export function buildDirect2to1EquirectGrid(
  decodedImage,
  W,
  H,
  weather,
  anchorEquirect = null,
  options = {}
) {
  const srcW = decodedImage.width;
  const srcH = decodedImage.height;
  const ch = decodedImage.channels;
  const time = options.time ?? 'day';
  const season = options.season ?? 'summer';

  const linSrc = new Float32Array(srcW * srcH * 3);
  for (let y = 0; y < srcH; y++) {
    const vSrc = y / Math.max(1, srcH - 1);
    const skyWeight = 1 - smoothstep(0.45, 0.56, vSrc);
    for (let x = 0; x < srcW; x++) {
      const si = (y * srcW + x) * ch;
      const di = (y * srcW + x) * 3;
      const lr = srgbByteToLinear(decodedImage.data[si]);
      const lg = srgbByteToLinear(decodedImage.data[si + 1]);
      const lb = srgbByteToLinear(decodedImage.data[si + 2]);
      const lum = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
      const boost = 1.0 + skyWeight * Math.pow(lum, 2.2) * (weather === 'clear' ? 2.4 : 0.85);
      linSrc[di] = lr * boost;
      linSrc[di + 1] = lg * boost;
      linSrc[di + 2] = lb * boost;
    }
  }

  const equirect = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    const v = y / Math.max(1, H - 1);
    const sy = v * (srcH - 1);
    const rowOff = y * W;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const sx = u * (srcW - 1);
      sampleCatmullRomRgb(linSrc, srcW, srcH, sx, sy, true, equirect, (rowOff + x) * 3);
    }
  }

  // Wide raised-cosine u=0/1 atmospheric illumination harmonizer (~18% / 65 deg)
  // that smoothly reconciles asymmetric Dawn/Dusk sky gradients while keeping every tree/ridge at colShift=0.
  const wideSpan = Math.max(8, Math.round(W * 0.18));
  const lpRadius = Math.max(2, Math.round(W * 0.004));
  const leftLow = new Float32Array(H * wideSpan * 3);
  const rightLow = new Float32Array(H * wideSpan * 3);
  for (let y = 0; y < H; y++) {
    const rowBase = y * W;
    for (let k = 0; k < wideSpan; k++) {
      let lr = 0, lg = 0, lb = 0;
      let rr = 0, rg = 0, rb = 0;
      let cnt = 0;
      for (let dx = -lpRadius; dx <= lpRadius; dx++) {
        const kl = Math.max(0, Math.min(W - 1, k + dx));
        const kr = Math.max(0, Math.min(W - 1, W - 1 - k + dx));
        const li = (rowBase + kl) * 3;
        const ri = (rowBase + kr) * 3;
        lr += equirect[li]; lg += equirect[li + 1]; lb += equirect[li + 2];
        rr += equirect[ri]; rg += equirect[ri + 1]; rb += equirect[ri + 2];
        cnt++;
      }
      const o = (y * wideSpan + k) * 3;
      leftLow[o] = lr / cnt; leftLow[o + 1] = lg / cnt; leftLow[o + 2] = lb / cnt;
      rightLow[o] = rr / cnt; rightLow[o + 1] = rg / cnt; rightLow[o + 2] = rb / cnt;
    }
  }

  const edgeSampleCols = Math.max(2, Math.min(16, Math.round(W * 0.004)));
  const rawMid = new Float32Array(H * 3);
  for (let y = 0; y < H; y++) {
    let mr = 0, mg = 0, mb = 0;
    for (let k = 0; k < edgeSampleCols; k++) {
      const o = (y * wideSpan + k) * 3;
      mr += 0.5 * (leftLow[o] + rightLow[o]);
      mg += 0.5 * (leftLow[o + 1] + rightLow[o + 1]);
      mb += 0.5 * (leftLow[o + 2] + rightLow[o + 2]);
    }
    rawMid[y * 3] = mr / edgeSampleCols;
    rawMid[y * 3 + 1] = mg / edgeSampleCols;
    rawMid[y * 3 + 2] = mb / edgeSampleCols;
  }

  const vBlur = Math.max(3, Math.round(H * 0.004));
  const smoothMid = new Float32Array(H * 3);
  for (let y = 0; y < H; y++) {
    let mr = 0, mg = 0, mb = 0, cnt = 0;
    for (let dy = -vBlur; dy <= vBlur; dy++) {
      const yy = Math.max(0, Math.min(H - 1, y + dy));
      mr += rawMid[yy * 3];
      mg += rawMid[yy * 3 + 1];
      mb += rawMid[yy * 3 + 2];
      cnt++;
    }
    smoothMid[y * 3] = mr / cnt;
    smoothMid[y * 3 + 1] = mg / cnt;
    smoothMid[y * 3 + 2] = mb / cnt;
  }

  const microSpan = Math.max(3, Math.round(W * 0.0025));
  for (let y = 0; y < H; y++) {
    const rowBase = y * W;
    const mid0 = smoothMid[y * 3];
    const mid1 = smoothMid[y * 3 + 1];
    const mid2 = smoothMid[y * 3 + 2];
    for (let k = 0; k < wideSpan; k++) {
      const u = k / wideSpan;
      const wWide = Math.pow(0.5 + 0.5 * Math.cos(Math.PI * u), 1.35);
      const li = (rowBase + k) * 3;
      const ri = (rowBase + (W - 1 - k)) * 3;
      const o = (y * wideSpan + k) * 3;

      const lfL0 = leftLow[o], lfL1 = leftLow[o + 1], lfL2 = leftLow[o + 2];
      const lfR0 = rightLow[o], lfR1 = rightLow[o + 1], lfR2 = rightLow[o + 2];
      const hfL0 = equirect[li] - lfL0, hfL1 = equirect[li + 1] - lfL1, hfL2 = equirect[li + 2] - lfL2;
      const hfR0 = equirect[ri] - lfR0, hfR1 = equirect[ri + 1] - lfR1, hfR2 = equirect[ri + 2] - lfR2;

      const tL0 = lfL0 * (1 - wWide) + mid0 * wWide;
      const tL1 = lfL1 * (1 - wWide) + mid1 * wWide;
      const tL2 = lfL2 * (1 - wWide) + mid2 * wWide;
      const tR0 = lfR0 * (1 - wWide) + mid0 * wWide;
      const tR1 = lfR1 * (1 - wWide) + mid1 * wWide;
      const tR2 = lfR2 * (1 - wWide) + mid2 * wWide;

      const scaleL = Math.min(1.6, Math.max(0.45, (tL0 + tL1 + tL2 + 0.06) / (lfL0 + lfL1 + lfL2 + 0.06)));
      const scaleR = Math.min(1.6, Math.max(0.45, (tR0 + tR1 + tR2 + 0.06) / (lfR0 + lfR1 + lfR2 + 0.06)));

      equirect[li] = Math.max(0, tL0 + hfL0 * scaleL);
      equirect[li + 1] = Math.max(0, tL1 + hfL1 * scaleL);
      equirect[li + 2] = Math.max(0, tL2 + hfL2 * scaleL);
      equirect[ri] = Math.max(0, tR0 + hfR0 * scaleR);
      equirect[ri + 1] = Math.max(0, tR1 + hfR1 * scaleR);
      equirect[ri + 2] = Math.max(0, tR2 + hfR2 * scaleR);
    }
    const i0 = rowBase * 3;
    const iN = (rowBase + (W - 1)) * 3;
    const mr = 0.5 * (equirect[i0] + equirect[iN]);
    const mg = 0.5 * (equirect[i0 + 1] + equirect[iN + 1]);
    const mb = 0.5 * (equirect[i0 + 2] + equirect[iN + 2]);
    for (let k = 0; k < microSpan; k++) {
      const wMicro = 0.85 * (1 - smoothstep(0, 1, k / microSpan));
      const li = (rowBase + k) * 3;
      const ri = (rowBase + (W - 1 - k)) * 3;
      equirect[li] = equirect[li] * (1 - wMicro) + mr * wMicro;
      equirect[li + 1] = equirect[li + 1] * (1 - wMicro) + mg * wMicro;
      equirect[li + 2] = equirect[li + 2] * (1 - wMicro) + mb * wMicro;
      equirect[ri] = equirect[ri] * (1 - wMicro) + mr * wMicro;
      equirect[ri + 1] = equirect[ri + 1] * (1 - wMicro) + mg * wMicro;
      equirect[ri + 2] = equirect[ri + 2] * (1 - wMicro) + mb * wMicro;
    }
  }

  // Transfer subtle 8K Master Anchor ultra-high-frequency micro-detail along horizon band v in [0.44, 0.58]
  if (anchorEquirect && anchorEquirect.length === W * H * 3) {
    const y0 = Math.max(0, Math.floor(H * 0.44));
    const y1 = Math.min(H, Math.ceil(H * 0.58));
    const cellLowBand = boxBlurBandRgb(equirect, W, H, y0, y1, 2);
    const anchorLowBand =
      options.anchorLowBand && options.anchorBandY0 === y0 && options.anchorBandY1 === y1
        ? options.anchorLowBand
        : boxBlurBandRgb(anchorEquirect, W, H, y0, y1, 2);

    const conditionGain =
      time === 'night'
        ? 0.16
        : weather === 'rain' || weather === 'snow'
          ? 0.24
          : season === 'winter'
            ? 0.34
            : 0.58;

    for (let y = y0; y < y1; y++) {
      const v = y / Math.max(1, H - 1);
      const vEnv = smoothstep(0.44, 0.465, v) * (1 - smoothstep(0.555, 0.58, v));
      const bandRow = (y - y0) * W * 3;
      const gridRow = y * W * 3;
      for (let x = 0; x < W; x++) {
        const bi = bandRow + x * 3;
        const gi = gridRow + x * 3;
        const cLowLum =
          0.2126 * cellLowBand[bi] +
          0.7152 * cellLowBand[bi + 1] +
          0.0722 * cellLowBand[bi + 2];
        const aLowLum =
          0.2126 * anchorLowBand[bi] +
          0.7152 * anchorLowBand[bi + 1] +
          0.0722 * anchorLowBand[bi + 2];
        const lumRatio = Math.min(1.4, Math.max(0.25, (cLowLum + 0.03) / (aLowLum + 0.03)));
        const hfScale = vEnv * conditionGain * lumRatio;

        const aPxLum =
          0.2126 * anchorEquirect[gi] +
          0.7152 * anchorEquirect[gi + 1] +
          0.0722 * anchorEquirect[gi + 2];
        const cPxLum =
          0.2126 * equirect[gi] +
          0.7152 * equirect[gi + 1] +
          0.0722 * equirect[gi + 2];
        // Scalar luminance micro-detail ratio from Master Anchor, gated by silhouette coherence
        // so Day sky vs Dusk foliage never bleeds negative blue or chromatic halos.
        const relDiff = Math.abs(cLowLum - aLowLum * lumRatio) / Math.max(0.06, cLowLum + aLowLum);
        const coherence = 1 - smoothstep(0.18, 0.55, relDiff);
        const anchorMicroRatio = Math.min(
          1.28,
          Math.max(0.76, (aPxLum + 0.035) / (aLowLum + 0.035))
        );
        const selfMicroRatio = Math.min(
          1.22,
          Math.max(0.82, (cPxLum + 0.035) / (cLowLum + 0.035))
        );
        const scalarDetailMult =
          1.0 +
          (selfMicroRatio - 1.0) * (0.16 * vEnv) +
          (anchorMicroRatio - 1.0) * (vEnv * conditionGain * coherence * 0.65);
        for (let c = 0; c < 3; c++) {
          equirect[gi + c] = Math.max(0, equirect[gi + c] * scalarDetailMult);
        }
      }
    }
  }

  return equirect;
}

function buildPeriodicLinearEquirectGrid(decodedImage, W, H, weather) {
  const srcW = decodedImage.width;
  const srcH = decodedImage.height;
  const ch = decodedImage.channels;

  const linSrc = new Float32Array(srcW * srcH * 3);
  for (let y = 0; y < srcH; y++) {
    const vSrc = y / Math.max(1, srcH - 1);
    const skyWeight = 1 - smoothstep(0.45, 0.56, vSrc);
    for (let x = 0; x < srcW; x++) {
      const si = (y * srcW + x) * ch;
      const di = (y * srcW + x) * 3;
      const lr = srgbByteToLinear(decodedImage.data[si]);
      const lg = srgbByteToLinear(decodedImage.data[si + 1]);
      const lb = srgbByteToLinear(decodedImage.data[si + 2]);
      const lum = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
      const boost = 1.0 + skyWeight * Math.pow(lum, 2.2) * (weather === 'clear' ? 2.4 : 0.85);
      linSrc[di] = lr * boost;
      linSrc[di + 1] = lg * boost;
      linSrc[di + 2] = lb * boost;
    }
  }

  const naturalOverlap = Math.max(0, srcW - 2 * srcH);
  const overlapPx = Math.max(
    Math.round(srcW * 0.08),
    Math.min(Math.round(srcW * 0.16), naturalOverlap > 0 ? naturalOverlap : Math.round(srcW * 0.10))
  );
  const periodPx = srcW - overlapPx;

  const rowLeftMean = new Float32Array(srcH * 3);
  const rowRightMean = new Float32Array(srcH * 3);
  for (let y = 0; y < srcH; y++) {
    let lr = 0, lg = 0, lb = 0;
    let rr = 0, rg = 0, rb = 0;
    for (let dx = 0; dx < overlapPx; dx++) {
      const li = (y * srcW + dx) * 3;
      const ri = (y * srcW + (periodPx + dx)) * 3;
      lr += linSrc[li];
      lg += linSrc[li + 1];
      lb += linSrc[li + 2];
      rr += linSrc[ri];
      rg += linSrc[ri + 1];
      rb += linSrc[ri + 2];
    }
    const inv = 1 / Math.max(1, overlapPx);
    rowLeftMean[y * 3] = lr * inv;
    rowLeftMean[y * 3 + 1] = lg * inv;
    rowLeftMean[y * 3 + 2] = lb * inv;
    rowRightMean[y * 3] = rr * inv;
    rowRightMean[y * 3 + 1] = rg * inv;
    rowRightMean[y * 3 + 2] = rb * inv;
  }

  const smoothDiff = new Float32Array(srcH * 3);
  const vBlur = Math.max(4, Math.round(srcH * 0.03));
  for (let y = 0; y < srcH; y++) {
    let dr = 0, dg = 0, db = 0, cnt = 0;
    for (let dy = -vBlur; dy <= vBlur; dy++) {
      const yy = Math.max(0, Math.min(srcH - 1, y + dy));
      dr += rowRightMean[yy * 3] - rowLeftMean[yy * 3];
      dg += rowRightMean[yy * 3 + 1] - rowLeftMean[yy * 3 + 1];
      db += rowRightMean[yy * 3 + 2] - rowLeftMean[yy * 3 + 2];
      cnt++;
    }
    smoothDiff[y * 3] = dr / cnt;
    smoothDiff[y * 3 + 1] = dg / cnt;
    smoothDiff[y * 3 + 2] = db / cnt;
  }

  const harmonizedSrc = new Float32Array(linSrc.length);
  for (let y = 0; y < srcH; y++) {
    const dr = smoothDiff[y * 3];
    const dg = smoothDiff[y * 3 + 1];
    const db = smoothDiff[y * 3 + 2];
    for (let x = 0; x < srcW; x++) {
      let t;
      if (x <= overlapPx) {
        t = 0;
      } else if (x >= periodPx) {
        t = 1;
      } else {
        const uMid = (x - overlapPx) / Math.max(1, periodPx - overlapPx);
        t = 0.5 - 0.5 * Math.cos(Math.PI * uMid);
      }
      const shiftScale = 0.5 - t;
      const idx = (y * srcW + x) * 3;
      harmonizedSrc[idx] = Math.max(0, linSrc[idx] + dr * shiftScale);
      harmonizedSrc[idx + 1] = Math.max(0, linSrc[idx + 1] + dg * shiftScale);
      harmonizedSrc[idx + 2] = Math.max(0, linSrc[idx + 2] + db * shiftScale);
    }
  }

  const lowSrc = boxBlurRgb(harmonizedSrc, srcW, srcH, Math.max(3, Math.round(srcW * 0.012)), false);

  const equirect = new Float32Array(W * H * 3);
  const pxLeft = new Float32Array(3);
  const pxRight = new Float32Array(3);
  const lowLeft = new Float32Array(3);
  const lowRight = new Float32Array(3);

  for (let y = 0; y < H; y++) {
    const v = y / Math.max(1, H - 1);
    let vSample;
    if (v <= 0.5) {
      const tUp = v / 0.5;
      vSample = 0.5 * Math.pow(tUp, 1.12);
    } else {
      const tDn = (v - 0.5) / 0.5;
      vSample = 0.5 + 0.5 * (1 - Math.pow(1 - tDn, 1.18));
    }
    const fy = vSample * (srcH - 1);

    for (let x = 0; x < W; x++) {
      const u = x / W;
      const sx = u * periodPx;
      const outIdx = (y * W + x) * 3;

      if (sx < overlapPx) {
        const tau = sx / overlapPx;
        const wLow = 0.5 - 0.5 * Math.cos(Math.PI * tau);
        const wHigh = smoothstep(0.40, 0.60, tau);

        sampleCatmullRomRgb(harmonizedSrc, srcW, srcH, sx, fy, false, pxLeft, 0);
        sampleCatmullRomRgb(harmonizedSrc, srcW, srcH, sx + periodPx, fy, false, pxRight, 0);
        sampleCatmullRomRgb(lowSrc, srcW, srcH, sx, fy, false, lowLeft, 0);
        sampleCatmullRomRgb(lowSrc, srcW, srcH, sx + periodPx, fy, false, lowRight, 0);

        for (let c = 0; c < 3; c++) {
          const lf = lowRight[c] * (1 - wLow) + lowLeft[c] * wLow;
          const hfLeft = pxLeft[c] - lowLeft[c];
          const hfRight = pxRight[c] - lowRight[c];
          const hf = hfRight * (1 - wHigh) + hfLeft * wHigh;
          equirect[outIdx + c] = Math.max(0, lf + hf);
        }
      } else {
        sampleCatmullRomRgb(harmonizedSrc, srcW, srcH, sx, fy, false, equirect, outIdx);
      }
    }
  }

  return equirect;
}

export async function fuseMultiAzimuthHorizonSuperRes(equirect, W, H, params) {
  const tileW = Math.round((W * 1248) / 4096);
  const tileH = Math.round((tileW * 2) / 3);
  const yStart = Math.max(0, Math.round(H * 0.5 - tileH * 0.5));
  const azimuthStarts = [0, Math.floor(W * 0.25), Math.floor(W * 0.5), Math.floor(W * 0.75)];
  const azimuthLabels = [
    'North-to-East (0°–110°)',
    'East-to-South (90°–200°)',
    'South-to-West (180°–290°)',
    'West-to-North (270°–360°)',
  ];

  const cropPaths = [];
  for (let t = 0; t < 4; t++) {
    const x0 = azimuthStarts[t];
    const rgb = new Uint8Array(tileW * tileH * 3);
    for (let ty = 0; ty < tileH; ty++) {
      const gy = Math.min(H - 1, yStart + ty);
      for (let tx = 0; tx < tileW; tx++) {
        const gx = (x0 + tx) % W;
        const si = (gy * W + gx) * 3;
        const di = (ty * tileW + tx) * 3;
        const r = equirect[si];
        const g = equirect[si + 1];
        const b = equirect[si + 2];
        rgb[di] = linearToSrgbByte(r / (1.0 + 0.32 * r));
        rgb[di + 1] = linearToSrgbByte(g / (1.0 + 0.32 * g));
        rgb[di + 2] = linearToSrgbByte(b / (1.0 + 0.32 * b));
      }
    }
    const cropPath = join(
      params.workDir,
      `crop_${params.season}_${params.time}_${params.weather}_t${t}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`
    );
    writeFileSync(cropPath, encodeRgbPng(rgb, tileW, tileH));
    cropPaths.push(cropPath);
  }

  const superResBuffers = await Promise.all(
    azimuthStarts.map(async (_x0, t) => {
      const prompt = buildHorizonTileSuperResPrompt({
        preset: params.preset,
        season: params.season,
        time: params.time,
        weather: params.weather,
        azimuthLabel: azimuthLabels[t],
      });
      const bytes = await params.generateTileBytes({
        prompt,
        cropPngPath: cropPaths[t],
      });
      return decodeImageBufferToRgb(bytes, params.workDir);
    })
  );

  const blurRadius = Math.max(6, Math.round(W * 0.005));
  const masterLow = boxBlurRgb(equirect, W, H, blurRadius, true);

  const detailSum = new Float32Array(W * tileH * 3);
  const weightSum = new Float32Array(W * tileH);
  const pxSample = new Float32Array(3);

  for (let t = 0; t < 4; t++) {
    const decoded = superResBuffers[t];
    const srcW = decoded.width;
    const srcH = decoded.height;
    const ch = decoded.channels;
    const x0 = azimuthStarts[t];

    const rawLin = new Float32Array(srcW * srcH * 3);
    for (let y = 0; y < srcH; y++) {
      const vBand = (yStart + (y / Math.max(1, srcH - 1)) * tileH) / H;
      const skyWeight = 1 - smoothstep(0.45, 0.56, vBand);
      for (let x = 0; x < srcW; x++) {
        const si = (y * srcW + x) * ch;
        const di = (y * srcW + x) * 3;
        const lr = srgbByteToLinear(decoded.data[si]);
        const lg = srgbByteToLinear(decoded.data[si + 1]);
        const lb = srgbByteToLinear(decoded.data[si + 2]);
        const lum = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
        const boost = 1.0 + skyWeight * Math.pow(lum, 2.2) * (params.weather === 'clear' ? 2.4 : 0.85);
        rawLin[di] = lr * boost;
        rawLin[di + 1] = lg * boost;
        rawLin[di + 2] = lb * boost;
      }
    }

    const tileLin = new Float32Array(tileW * tileH * 3);
    for (let ty = 0; ty < tileH; ty++) {
      const fy = (ty / Math.max(1, tileH - 1)) * (srcH - 1);
      for (let tx = 0; tx < tileW; tx++) {
        const fx = (tx / Math.max(1, tileW - 1)) * (srcW - 1);
        sampleCatmullRomRgb(rawLin, srcW, srcH, fx, fy, false, pxSample, 0);
        const o = (ty * tileW + tx) * 3;
        tileLin[o] = pxSample[0];
        tileLin[o + 1] = pxSample[1];
        tileLin[o + 2] = pxSample[2];
      }
    }

    const tileLow = boxBlurRgb(tileLin, tileW, tileH, blurRadius, false);
    const hFeather = Math.max(16, tileW - Math.floor(W * 0.25));
    const vFeather = Math.max(16, Math.round(tileH * 0.14));

    for (let ty = 0; ty < tileH; ty++) {
      const gy = Math.min(H - 1, yStart + ty);
      let wy = 1.0;
      if (ty < vFeather) {
        wy = 0.5 - 0.5 * Math.cos((Math.PI * ty) / vFeather);
      } else if (ty >= tileH - vFeather) {
        wy = 0.5 - 0.5 * Math.cos((Math.PI * (tileH - 1 - ty)) / vFeather);
      }

      for (let tx = 0; tx < tileW; tx++) {
        let wx = 1.0;
        if (tx < hFeather) {
          wx = smoothstep(0.36, 0.64, tx / hFeather);
        } else if (tx >= tileW - hFeather) {
          wx = smoothstep(0.36, 0.64, (tileW - 1 - tx) / hFeather);
        }
        const w = wx * wy;
        if (w <= 1e-5) continue;

        const gx = (x0 + tx) % W;
        const ti = (ty * tileW + tx) * 3;
        const mi = (gy * W + gx) * 3;
        const bi = ty * W + gx;
        const bi3 = bi * 3;

        const mLum =
          0.2126 * masterLow[mi] + 0.7152 * masterLow[mi + 1] + 0.0722 * masterLow[mi + 2];
        const tLum =
          0.2126 * tileLow[ti] + 0.7152 * tileLow[ti + 1] + 0.0722 * tileLow[ti + 2];
        const expMatch = Math.min(1.65, Math.max(0.55, (mLum + 0.06) / (tLum + 0.06)));
        for (let c = 0; c < 3; c++) {
          detailSum[bi3 + c] += tileLin[ti + c] * expMatch * w;
        }
        weightSum[bi] += w;
      }
    }
  }

  for (let ty = 0; ty < tileH; ty++) {
    const gy = Math.min(H - 1, yStart + ty);
    for (let gx = 0; gx < W; gx++) {
      const bi = ty * W + gx;
      const wTot = weightSum[bi];
      if (wTot <= 1e-5) continue;
      const mi = (gy * W + gx) * 3;
      const bi3 = bi * 3;
      const blend = Math.min(1.0, wTot);
      const invW = 1.0 / wTot;
      for (let c = 0; c < 3; c++) {
        const srVal = detailSum[bi3 + c] * invW;
        equirect[mi + c] = Math.max(0, equirect[mi + c] * (1.0 - blend) + srVal * blend);
      }
    }
  }

  for (const p of cropPaths) {
    rmSync(p, { force: true });
  }
}

function stabilizeEquirectPolesInPlace(equirect, W, H) {
  const poleScratch = new Float32Array(W * 3);
  const prefixR = new Float64Array(W * 3 + 1);
  const prefixG = new Float64Array(W * 3 + 1);
  const prefixB = new Float64Array(W * 3 + 1);

  let groundAvgR = 0, groundAvgG = 0, groundAvgB = 0;
  const gy0 = Math.floor(H * 0.525);
  const gy1 = Math.max(gy0 + 1, Math.floor(H * 0.555));
  for (let y = gy0; y < gy1; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 3;
      groundAvgR += equirect[idx];
      groundAvgG += equirect[idx + 1];
      groundAvgB += equirect[idx + 2];
    }
  }
  const gNorm = 1 / ((gy1 - gy0) * W);
  groundAvgR *= gNorm;
  groundAvgG *= gNorm;
  groundAvgB *= gNorm;

  for (let y = 0; y < H; y++) {
    const v = y / Math.max(1, H - 1);
    const zenithWeight = v < 0.10 ? 1 - smoothstep(0.0, 0.10, v) : 0;
    const nadirWeight = v > 0.66 ? smoothstep(0.66, 0.96, v) : 0;
    if (zenithWeight <= 0 && nadirWeight <= 0) continue;

    const poleStrength = Math.max(zenithWeight, nadirWeight);
    const blurRadius = Math.min(
      Math.floor(W / 2),
      Math.max(1, Math.round(poleStrength * poleStrength * (W * 0.45)))
    );

    const rowBase = y * W * 3;
    let meanR = 0, meanG = 0, meanB = 0;
    for (let x = 0; x < W * 3; x++) {
      const xw = x % W;
      const r = equirect[rowBase + xw * 3];
      const g = equirect[rowBase + xw * 3 + 1];
      const b = equirect[rowBase + xw * 3 + 2];
      if (x < W) {
        meanR += r;
        meanG += g;
        meanB += b;
      }
      prefixR[x + 1] = prefixR[x] + r;
      prefixG[x + 1] = prefixG[x] + g;
      prefixB[x + 1] = prefixB[x] + b;
    }
    meanR /= W;
    meanG /= W;
    meanB /= W;

    const invSpan = 1 / (2 * blurRadius + 1);
    const exactPoleMix =
      v <= 0.015 ? 1 - v / 0.015 : v >= 0.97 ? (v - 0.97) / 0.03 : 0;
    const deepGroundMix = v > 0.72 ? smoothstep(0.72, 0.98, v) * 0.82 : 0;

    for (let x = 0; x < W; x++) {
      const cx = x + W;
      const lo = cx - blurRadius;
      const hi = cx + blurRadius + 1;
      const br = (prefixR[hi] - prefixR[lo]) * invSpan;
      const bg = (prefixG[hi] - prefixG[lo]) * invSpan;
      const bb = (prefixB[hi] - prefixB[lo]) * invSpan;

      let r = equirect[rowBase + x * 3] * (1 - poleStrength) + br * poleStrength;
      let g = equirect[rowBase + x * 3 + 1] * (1 - poleStrength) + bg * poleStrength;
      let b = equirect[rowBase + x * 3 + 2] * (1 - poleStrength) + bb * poleStrength;

      if (deepGroundMix > 0) {
        r = r * (1 - deepGroundMix) + groundAvgR * 0.82 * deepGroundMix;
        g = g * (1 - deepGroundMix) + groundAvgG * 0.82 * deepGroundMix;
        b = b * (1 - deepGroundMix) + groundAvgB * 0.82 * deepGroundMix;
      }
      if (exactPoleMix > 0) {
        const pr = nadirWeight > 0 ? groundAvgR * 0.82 : meanR;
        const pg = nadirWeight > 0 ? groundAvgG * 0.82 : meanG;
        const pb = nadirWeight > 0 ? groundAvgB * 0.82 : meanB;
        r = r * (1 - exactPoleMix) + pr * exactPoleMix;
        g = g * (1 - exactPoleMix) + pg * exactPoleMix;
        b = b * (1 - exactPoleMix) + pb * exactPoleMix;
      }
      poleScratch[x * 3] = r;
      poleScratch[x * 3 + 1] = g;
      poleScratch[x * 3 + 2] = b;
    }
    equirect.set(poleScratch, rowBase);
  }
}

export function finalizeEquirectHdrFromGrid(equirect, W, H, options = {}) {
  const time = options.time ?? 'day';
  const weather = options.weather ?? 'clear';
  const lockAzimuth = Boolean(options.lockAzimuth);
  const includeOrb = options.includeOrb !== undefined ? Boolean(options.includeOrb) : true;
  const hdrSunU =
    options.hdrSunU ??
    (lockAzimuth
      ? DEFAULT_WORLD_ANCHORED_SUN_U[/** @type {keyof typeof DEFAULT_WORLD_ANCHORED_SUN_U} */ (time)] ?? 0.5
      : 0.6);
  const hdrSunV = options.hdrSunV ?? DEFAULT_HDR_SUN_V[time] ?? 0.18;

  if (!options.skipPoleStabilize) {
    stabilizeEquirectPolesInPlace(equirect, W, H);
  }

  let colShift = 0;
  if (!lockAzimuth) {
    const skyY0 = Math.floor(H * 0.08);
    const skyY1 = Math.floor(H * 0.45);
    const colEnergy = new Float64Array(W);
    for (let y = skyY0; y < skyY1; y++) {
      for (let x = 0; x < W; x++) {
        const idx = (y * W + x) * 3;
        const lum = 0.2126 * equirect[idx] + 0.7152 * equirect[idx + 1] + 0.0722 * equirect[idx + 2];
        colEnergy[x] += lum * lum;
      }
    }
    const win = Math.max(2, Math.round(W * 0.03));
    let bestCol = Math.round(hdrSunU * W) % W;
    let bestScore = -1;
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let dx = -win; dx <= win; dx++) {
        sum += colEnergy[(x + dx + W) % W];
      }
      if (sum > bestScore) {
        bestScore = sum;
        bestCol = x;
      }
    }
    const targetCol = Math.round(hdrSunU * W) % W;
    colShift = (bestCol - targetCol + W) % W;
  }

  const TIME_EXPOSURE_SCALE = { dawn: 1.25, day: 1.55, dusk: 1.22, night: 0.24 };
  const WEATHER_SCALE = { clear: 1.0, cloudy: 0.92, overcast: 0.84, rain: 0.68, snow: 0.95 };
  const baseScale = (TIME_EXPOSURE_SCALE[time] ?? 1.3) * (WEATHER_SCALE[weather] ?? 1.0);
  const diffuseSkyKnee =
    weather === 'overcast' || weather === 'rain' || weather === 'snow'
      ? time === 'night' ? 0.35 : time === 'day' ? 2.35 : 1.65
      : weather === 'cloudy'
        ? time === 'night' ? 0.9 : 5.5
        : 0;

  const orbColor =
    time === 'night'
      ? [0.62, 0.72, 0.92]
      : time === 'dawn'
        ? [1.0, 0.74, 0.48]
        : time === 'dusk'
          ? [1.0, 0.68, 0.38]
          : [1.0, 0.96, 0.88];
  const orbPeak = !includeOrb
    ? 0
    : weather === 'clear'
      ? time === 'day' ? 16.5 : time === 'night' ? 1.35 : 7.5
      : weather === 'cloudy'
        ? time === 'day' ? 2.2 : time === 'night' ? 0.35 : 1.5
        : 0;

  // When lockAzimuth is enabled, keep analytical sun specular energy tight/pinpoint in the .hdr
  // IBL buffer so it never paints a wide synthetic Gaussian bullseye ring onto the 8K skybox.
  const sharpness = lockAzimuth
    ? time === 'night' ? 42000.0 : weather === 'clear' ? 24000.0 : 2400.0
    : time === 'night' ? 26000.0 : weather === 'clear' ? 6400.0 : 320.0;
  const coronaFalloff = lockAzimuth
    ? time === 'night' ? 64.0 : 48.0
    : time === 'night' ? 38.0 : weather === 'clear' ? 18.0 : 8.0;
  const coronaGain = lockAzimuth
    ? 0.012
    : time === 'night' ? 0.04 : 0.09;

  const outRgba = new Float32Array(W * H * 4);
  let horizonR = 0, horizonG = 0, horizonB = 0;
  const hy0 = Math.floor(H * 0.525);
  const hy1 = Math.max(hy0 + 1, Math.floor(H * 0.545));

  for (let y = 0; y < H; y++) {
    const v = y / Math.max(1, H - 1);
    const skyMask = 1 - smoothstep(0.47, 0.515, v);
    for (let x = 0; x < W; x++) {
      const srcX = colShift === 0 ? x : (x + colShift) % W;
      const si = (y * W + srcX) * 3;
      let r = equirect[si] * baseScale;
      let g = equirect[si + 1] * baseScale;
      let b = equirect[si + 2] * baseScale;

      if (time === 'night' && v > 0.49 && v < 0.66) {
        const lum = 0.2126 * equirect[si] + 0.7152 * equirect[si + 1] + 0.0722 * equirect[si + 2];
        if (lum > 0.32) {
          const lightBoost = 1 + Math.pow((lum - 0.32) / 0.68, 1.5) * 6.5;
          r *= lightBoost;
          g *= lightBoost;
          b *= lightBoost;
        }
      }

      if (diffuseSkyKnee > 0 && skyMask > 0.01) {
        const peak = Math.max(r, g, b);
        if (peak > diffuseSkyKnee * 0.65) {
          const k = diffuseSkyKnee * 0.65;
          const compressed =
            k + (diffuseSkyKnee - k) * Math.tanh((peak - k) / Math.max(1e-4, diffuseSkyKnee - k));
          const s = (compressed / peak) * skyMask + (1 - skyMask);
          r *= s;
          g *= s;
          b *= s;
        }
      }

      if (orbPeak > 0 && skyMask > 0.01) {
        const u = x / W;
        const du = Math.min(Math.abs(u - hdrSunU), 1 - Math.abs(u - hdrSunU));
        const dv = v - hdrSunV;
        const dist = Math.hypot(du * 2.0, dv);
        if (dist < 0.22) {
          const disc = Math.exp(-dist * dist * sharpness) * orbPeak * skyMask;
          const corona = Math.exp(-dist * coronaFalloff) * (orbPeak * coronaGain) * skyMask;
          r += orbColor[0] * (disc + corona);
          g += orbColor[1] * (disc + corona);
          b += orbColor[2] * (disc + corona);
        }
      }

      if (y >= hy0 && y < hy1) {
        horizonR += Math.min(r, 2.0);
        horizonG += Math.min(g, 2.0);
        horizonB += Math.min(b, 2.0);
      }

      const di = (y * W + x) * 4;
      outRgba[di] = r;
      outRgba[di + 1] = g;
      outRgba[di + 2] = b;
      outRgba[di + 3] = 1.0;
    }
  }

  const wrapSpan = Math.max(2, Math.round(W * 0.004));
  for (let y = 0; y < H; y++) {
    const i0 = (y * W + 0) * 4;
    const iN = (y * W + (W - 1)) * 4;
    const mr = 0.5 * (outRgba[i0] + outRgba[iN]);
    const mg = 0.5 * (outRgba[i0 + 1] + outRgba[iN + 1]);
    const mb = 0.5 * (outRgba[i0 + 2] + outRgba[iN + 2]);
    for (let k = 0; k < wrapSpan; k++) {
      const w = 0.75 * (1 - k / wrapSpan);
      const il = (y * W + k) * 4;
      const ir = (y * W + (W - 1 - k)) * 4;
      outRgba[il] = outRgba[il] * (1 - w) + mr * w;
      outRgba[il + 1] = outRgba[il + 1] * (1 - w) + mg * w;
      outRgba[il + 2] = outRgba[il + 2] * (1 - w) + mb * w;
      outRgba[ir] = outRgba[ir] * (1 - w) + mr * w;
      outRgba[ir + 1] = outRgba[ir + 1] * (1 - w) + mg * w;
      outRgba[ir + 2] = outRgba[ir + 2] * (1 - w) + mb * w;
    }
  }

  const hCount = Math.max(1, (hy1 - hy0) * W);
  const horizonGround = /** @type {const} */ ([
    Number((horizonR / hCount).toFixed(4)),
    Number((horizonG / hCount).toFixed(4)),
    Number((horizonB / hCount).toFixed(4)),
  ]);

  return { width: W, height: H, data: outRgba, hdrSunU, hdrSunV, horizonGround };
}

export function buildSeamlessHdrPanorama(decodedImage, options = {}) {
  const W = options.targetWidth ?? 2048;
  const H = Math.round(W / 2);
  const weather = options.weather ?? 'clear';
  const equirect = buildPeriodicLinearEquirectGrid(decodedImage, W, H, weather);
  return finalizeEquirectHdrFromGrid(equirect, W, H, options);
}

export function upsampleHdrToDetailRgbBytes(srcRgba, srcW, srcH, dstW = 4096) {
  const dstH = Math.round(dstW / 2);
  const srcRgb = new Float32Array(srcW * srcH * 3);
  for (let i = 0, n = srcW * srcH; i < n; i++) {
    srcRgb[i * 3] = Math.max(0, srcRgba[i * 4]);
    srcRgb[i * 3 + 1] = Math.max(0, srcRgba[i * 4 + 1]);
    srcRgb[i * 3 + 2] = Math.max(0, srcRgba[i * 4 + 2]);
  }

  const up = new Float32Array(dstW * dstH * 3);
  for (let y = 0; y < dstH; y++) {
    const fy = ((y + 0.5) * srcH) / dstH - 0.5;
    for (let x = 0; x < dstW; x++) {
      const fx = ((x + 0.5) * srcW) / dstW - 0.5;
      sampleCatmullRomRgb(srcRgb, srcW, srcH, fx, fy, true, up, (y * dstW + x) * 3);
    }
  }

  const blur = boxBlurRgb(up, dstW, dstH, 2, true);
  for (let i = 0, n = dstW * dstH * 3; i < n; i++) {
    const v = up[i];
    const d = v - blur[i];
    up[i] = Math.max(0, v + d * 0.38);
  }
  return encodeGainmapDetailRgbBytes(up, dstW, dstH, 3);
}

export function downsampleEquirectHdr(srcRgba, srcW, srcH, dstW) {
  const dstH = Math.round(dstW / 2);
  const out = new Float32Array(dstW * dstH * 4);
  const scaleX = srcW / dstW;
  const scaleY = srcH / dstH;

  for (let y = 0; y < dstH; y++) {
    const sy0 = Math.floor(y * scaleY);
    const sy1 = Math.max(sy0 + 1, Math.min(srcH, Math.ceil((y + 1) * scaleY)));
    for (let x = 0; x < dstW; x++) {
      const sx0 = Math.floor(x * scaleX);
      const sx1 = Math.max(sx0 + 1, Math.min(srcW, Math.ceil((x + 1) * scaleX)));
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const idx = (sy * srcW + sx) * 4;
          sr += srcRgba[idx];
          sg += srcRgba[idx + 1];
          sb += srcRgba[idx + 2];
          n++;
        }
      }
      const inv = 1 / Math.max(1, n);
      const di = (y * dstW + x) * 4;
      out[di] = sr * inv;
      out[di + 1] = sg * inv;
      out[di + 2] = sb * inv;
      out[di + 3] = 1.0;
    }
  }

  const wrapSpan = Math.max(2, Math.round(dstW * 0.004));
  for (let y = 0; y < dstH; y++) {
    const i0 = (y * dstW + 0) * 4;
    const iN = (y * dstW + (dstW - 1)) * 4;
    const mr = 0.5 * (out[i0] + out[iN]);
    const mg = 0.5 * (out[i0 + 1] + out[iN + 1]);
    const mb = 0.5 * (out[i0 + 2] + out[iN + 2]);
    for (let k = 0; k < wrapSpan; k++) {
      const w = 0.8 * (1 - k / wrapSpan);
      const il = (y * dstW + k) * 4;
      const ir = (y * dstW + (dstW - 1 - k)) * 4;
      out[il] = out[il] * (1 - w) + mr * w;
      out[il + 1] = out[il + 1] * (1 - w) + mg * w;
      out[il + 2] = out[il + 2] * (1 - w) + mb * w;
      out[ir] = out[ir] * (1 - w) + mr * w;
      out[ir + 1] = out[ir + 1] * (1 - w) + mg * w;
      out[ir + 2] = out[ir + 2] * (1 - w) + mb * w;
    }
  }
  return { width: dstW, height: dstH, data: out };
}

export function decodeImageBufferToRgb(bytes, tmpDir) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const isPng =
    u8.length > 8 && u8[0] === 137 && u8[1] === 80 && u8[2] === 78 && u8[3] === 71;

  if (isPng) {
    try {
      return decodePng(u8);
    } catch {
      // Fall through
    }
  }

  const scratch = tmpDir ?? mkdtempSync(join(tmpdir(), 'husjs-hdri-img-'));
  const cleanupScratch = !tmpDir;
  const tag = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const inFile = join(scratch, `raw_${tag}.img`);
  const outPng = join(scratch, `rgb8_${tag}.png`);
  try {
    writeFileSync(inFile, u8);
    try {
      execFileSync(
        'ffmpeg',
        ['-y', '-loglevel', 'error', '-i', inFile, '-pix_fmt', 'rgb24', outPng],
        { stdio: 'pipe' }
      );
    } catch {
      execFileSync('convert', [inFile, '-depth', '8', `PNG24:${outPng}`], { stdio: 'pipe' });
    }
    return decodePng(readFileSync(outPng));
  } finally {
    rmSync(inFile, { force: true });
    rmSync(outPng, { force: true });
    if (cleanupScratch) {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}

export function prepareReferenceImages(refPaths, workDir) {
  /** @type {string[]} */
  const ready = [];
  for (let i = 0; i < refPaths.length; i++) {
    const abs = resolve(refPaths[i]);
    if (!existsSync(abs)) {
      throw new Error(`Reference image not found: ${abs}`);
    }
    const ext = extname(abs).toLowerCase();
    if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') {
      ready.push(abs);
      continue;
    }
    const outPng = join(workDir, `ref_${i}_${basename(abs, ext)}.png`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', abs, outPng], { stdio: 'pipe' });
    ready.push(outPng);
  }
  return ready;
}

function detectGcpProject(explicitProject) {
  if (explicitProject) return explicitProject;
  if (process.env.GOOGLE_CLOUD_PROJECT) return process.env.GOOGLE_CLOUD_PROJECT;
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;
  try {
    const out = execFileSync('gcloud', ['config', 'get-value', 'project'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
    if (out && out !== '(unset)') return out;
  } catch {
    // ignore
  }
  return 'lovelace-open-models';
}

function resolveCloudtopCli() {
  if (existsSync(CLI_4K_PATH)) {
    return { cliPath: CLI_4K_PATH, supportsImageSize: true };
  }
  if (existsSync(CLOUDTOP_CLI_PATH)) {
    return { cliPath: CLOUDTOP_CLI_PATH, supportsImageSize: false };
  }
  return { cliPath: '', supportsImageSize: false };
}

export async function generateNanoBananaRest({
  prompt,
  refs,
  apiKey,
  aspectRatio = '21:9',
  imageSize = '4K',
  model = PRO_4K_MODEL,
}) {
  /** @type {Array<Record<string, unknown>>} */
  const parts = [];
  for (const ref of refs.slice(0, 3)) {
    const ext = extname(ref).toLowerCase();
    const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
    const b64 = readFileSync(ref).toString('base64');
    parts.push({ inlineData: { mimeType, data: b64 } });
  }
  parts.push({ text: prompt });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: {
          aspectRatio,
          ...(imageSize && !model.includes(FALLBACK_MODEL) ? { imageSize } : {}),
        },
      },
    }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Gemini Nano Banana REST error (${res.status}): ${errBody.slice(0, 300)}`);
  }
  const json = /** @type {any} */ (await res.json());
  const candParts = json?.candidates?.[0]?.content?.parts ?? [];
  for (const p of candParts) {
    const b64 = p?.inlineData?.data ?? p?.inline_data?.data;
    if (typeof b64 === 'string' && b64.length > 0) {
      return new Uint8Array(Buffer.from(b64, 'base64'));
    }
  }
  throw new Error('Gemini Nano Banana REST response did not include an inlineData image part');
}

export async function generateNanoBananaCloudtopCli({
  prompt,
  refs,
  gcpProject,
  aspectRatio = '21:9',
  imageSize = '4K',
  model = '',
  scratchRoot = '',
}) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  const { cliPath, supportsImageSize } = resolveCloudtopCli();
  if (!cliPath) {
    throw new Error(`Neither ${CLI_4K_PATH} nor ${CLOUDTOP_CLI_PATH} is available`);
  }

  const modelsToTry = model
    ? [model]
    : imageSize === '4K' && supportsImageSize
      ? [PRO_4K_MODEL, DEFAULT_CLI_MODEL, FALLBACK_MODEL]
      : [DEFAULT_CLI_MODEL, FALLBACK_MODEL];

  let lastError = null;
  const baseTmp = scratchRoot || tmpdir();

  for (const candidateModel of modelsToTry) {
    const outDir = mkdtempSync(join(baseTmp, 'husjs-nb-cli-'));
    try {
      const args = [
        'generate',
        '--project',
        gcpProject,
        '--location',
        'global',
        '--model',
        candidateModel,
        '--aspect_ratio',
        aspectRatio,
        '--prompt',
        prompt,
        '--output_dir',
        outDir,
      ];
      if (supportsImageSize && imageSize && !candidateModel.includes(FALLBACK_MODEL)) {
        args.push('--image_size', imageSize);
      }
      if (refs.length > 0) {
        args.push('--image_paths', refs.slice(0, 3).join(','));
      }
      await execFileAsync(cliPath, args, {
        maxBuffer: 32 * 1024 * 1024,
        timeout: 240_000,
      });
      const files = readdirSync(outDir)
        .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
        .sort();
      if (files.length > 0) {
        return new Uint8Array(readFileSync(join(outDir, files[0])));
      }
      lastError = new Error(`${candidateModel} produced no image output files`);
    } catch (err) {
      lastError = err;
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }
  throw lastError ?? new Error('generate_image_cli failed across candidate models');
}

export async function generatePanoramaSourceBytes({
  prompt,
  refs,
  backend,
  gcpProject,
  aspectRatio = '21:9',
  imageSize = '4K',
  model = '',
  scratchRoot = '',
}) {
  const apiKey = process.env.GEMINI_API_KEY?.trim() ?? '';
  const { cliPath } = resolveCloudtopCli();
  const hasCli = Boolean(cliPath);

  if (backend === 'rest') {
    if (!apiKey) throw new Error('--backend rest requires GEMINI_API_KEY in environment');
    return generateNanoBananaRest({
      prompt,
      refs,
      apiKey,
      aspectRatio,
      imageSize,
      model: model || (imageSize === '4K' ? PRO_4K_MODEL : FALLBACK_MODEL),
    });
  }
  if (backend === 'cli') {
    if (!hasCli) throw new Error(`--backend cli requires ${CLI_4K_PATH} or ${CLOUDTOP_CLI_PATH}`);
    return generateNanoBananaCloudtopCli({
      prompt,
      refs,
      gcpProject: detectGcpProject(gcpProject),
      aspectRatio,
      imageSize,
      model,
      scratchRoot,
    });
  }

  if (apiKey) {
    return generateNanoBananaRest({
      prompt,
      refs,
      apiKey,
      aspectRatio,
      imageSize,
      model: model || (imageSize === '4K' ? PRO_4K_MODEL : FALLBACK_MODEL),
    });
  }
  if (hasCli) {
    return generateNanoBananaCloudtopCli({
      prompt,
      refs,
      gcpProject: detectGcpProject(gcpProject),
      aspectRatio,
      imageSize,
      model,
      scratchRoot,
    });
  }
  throw new Error('No Nano Banana backend available');
}

function detailSuffixForRes(detailRes) {
  return detailRes >= 8192 ? '_8k.webp' : '_4k.webp';
}

export function expandTargetCells(opts) {
  const prefix = opts.preset.replace(/-/g, '_');
  const detailSuffix = detailSuffixForRes(opts.detailRes);
  /** @type {Array<{ key: string, season: string, time: string, weather: string, includeSeason: boolean, res: number, detailRes: number, mainFile: string, detailFile: string, previewFile: string }>} */
  const list = [];

  if (opts.cells.length > 0) {
    for (const raw of opts.cells) {
      const [specPart, resPart] = raw.split('@');
      const cellRes = resPart ? Number(resPart) : opts.res;
      const parts = specPart.split('_');
      let season = 'summer';
      let time = 'day';
      let weather = 'clear';
      let includeSeason = true;
      if (parts.length === 3) {
        [season, time, weather] = parts;
      } else if (parts.length === 2) {
        includeSeason = false;
        [time, weather] = parts;
      } else {
        throw new Error(`Invalid --cells item '${raw}' (expected [season_]time_weather[@res])`);
      }
      const stem = includeSeason
        ? `${prefix}_${season}_${time}_${weather}`
        : `${prefix}_${time}_${weather}`;
      list.push({
        key: includeSeason ? `${season}_${time}_${weather}` : `${time}_${weather}`,
        season,
        time,
        weather,
        includeSeason,
        res: cellRes,
        detailRes: opts.detailRes,
        mainFile: `${stem}_2k.hdr`,
        detailFile: `${stem}${detailSuffix}`,
        previewFile: `${stem}_512.hdr`,
      });
    }
    return list;
  }

  const includeSeason = !(opts.seasons.length === 1 && opts.preset === 'hollywood-hills');
  for (const season of opts.seasons) {
    for (const time of opts.times) {
      for (const weather of opts.weathers) {
        if (weather === 'snow' && season !== 'winter') {
          continue;
        }
        const stem = includeSeason
          ? `${prefix}_${season}_${time}_${weather}`
          : `${prefix}_${time}_${weather}`;
        list.push({
          key: includeSeason ? `${season}_${time}_${weather}` : `${time}_${weather}`,
          season,
          time,
          weather,
          includeSeason,
          res: opts.res,
          detailRes: opts.detailRes,
          mainFile: `${stem}_2k.hdr`,
          detailFile: `${stem}${detailSuffix}`,
          previewFile: `${stem}_512.hdr`,
        });
      }
    }
  }
  return list;
}

async function generateWithRetry(fn, attempts = 4) {
  let lastErr = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < attempts) {
        await new Promise((r) => setTimeout(r, 1500 * attempt + Math.floor(Math.random() * 600)));
      }
    }
  }
  throw lastErr ?? new Error('Generation failed');
}

function selectAnchorCellIndex(cells, preset) {
  const preferredKey = preset === 'hollywood-hills' ? 'day_clear' : 'summer_day_clear';
  const exactIdx = cells.findIndex((c) => c.key === preferredKey);
  if (exactIdx >= 0) return exactIdx;
  const dayClearIdx = cells.findIndex((c) => c.time === 'day' && c.weather === 'clear');
  if (dayClearIdx >= 0) return dayClearIdx;
  return 0;
}

function writeCellOutputsFromGrid({
  equirectGrid,
  fullW,
  fullH,
  cell,
  opts,
  outDir,
  lockAzimuth,
}) {
  const mainPath = join(outDir, cell.mainFile);
  const detailPath = join(outDir, cell.detailFile);
  const previewPath = join(outDir, cell.previewFile);

  const hdrSunU = lockAzimuth
    ? DEFAULT_WORLD_ANCHORED_SUN_U[/** @type {keyof typeof DEFAULT_WORLD_ANCHORED_SUN_U} */ (cell.time)] ?? 0.5
    : 0.6;
  const hdrSunV =
    DEFAULT_HDR_SUN_V[/** @type {keyof typeof DEFAULT_HDR_SUN_V} */ (cell.time)] ?? 0.18;

  // Stabilize zenith/nadir poles once in-place so both 8K detail WebP and 2K/512 .hdr share exact poles
  stabilizeEquirectPolesInPlace(equirectGrid, fullW, fullH);

  let detailKb = 0;
  if (cell.detailRes > 0) {
    // Encode 8K photographic detail WebP WITHOUT synthetic Gaussian orb bullseye
    const cleanDetailHdr = finalizeEquirectHdrFromGrid(equirectGrid, fullW, fullH, {
      time: /** @type {any} */ (cell.time),
      weather: /** @type {any} */ (cell.weather),
      hdrSunU,
      hdrSunV,
      lockAzimuth,
      includeOrb: false,
      skipPoleStabilize: true,
    });
    const detailSource =
      cleanDetailHdr.width === cell.detailRes
        ? cleanDetailHdr
        : downsampleEquirectHdr(
            cleanDetailHdr.data,
            cleanDetailHdr.width,
            cleanDetailHdr.height,
            cell.detailRes
          );
    const detailRgb = encodeGainmapDetailRgbBytes(
      detailSource.data,
      detailSource.width,
      detailSource.height,
      4
    );
    writeRgbWebpFile(
      detailRgb,
      detailSource.width,
      detailSource.height,
      detailPath,
      opts.webpQuality
    );
    detailKb = Math.round(readFileSync(detailPath).byteLength / 1024);
  }

  // Physical Radiance .hdr IBL buffer includes analytical pinpoint solar energy
  const fullHdr = finalizeEquirectHdrFromGrid(equirectGrid, fullW, fullH, {
    time: /** @type {any} */ (cell.time),
    weather: /** @type {any} */ (cell.weather),
    hdrSunU,
    hdrSunV,
    lockAzimuth,
    includeOrb: true,
    skipPoleStabilize: true,
  });

  const mainHdr =
    fullHdr.width === cell.res
      ? fullHdr
      : downsampleEquirectHdr(fullHdr.data, fullHdr.width, fullHdr.height, cell.res);
  const encodedMain = encodeRadianceHdrRle(mainHdr.data, mainHdr.width, mainHdr.height, 4);
  decodeRadianceHdr(encodedMain);
  writeFileSync(mainPath, encodedMain);

  let previewKb = 0;
  if (opts.previewRes > 0) {
    const preview = downsampleEquirectHdr(
      fullHdr.data,
      fullHdr.width,
      fullHdr.height,
      opts.previewRes
    );
    const encodedPreview = encodeRadianceHdrRle(preview.data, preview.width, preview.height, 4);
    decodeRadianceHdr(encodedPreview);
    writeFileSync(previewPath, encodedPreview);
    previewKb = Math.round(encodedPreview.byteLength / 1024);
  }

  return {
    mainHdr,
    fullHdr,
    encodedMainBytes: encodedMain.byteLength,
    detailKb,
    previewKb,
  };
}

export async function runHdriCli(argv, io = {}) {
  const log = io.log ?? console.log;
  const opts = parseHdriCliArgs(argv);
  if (opts.help) {
    log(HDR_USAGE);
    return;
  }

  const outDir = resolve(opts.outDir);
  mkdirSync(outDir, { recursive: true });
  // Keep scratch workDir inside dirname(outDir) or repo root so external /tmp cleanups never touch in-flight crops
  const scratchParent = existsSync(join(process.cwd(), 'public')) ? process.cwd() : dirname(outDir);
  const workDir = mkdtempSync(join(scratchParent, '.husjs-hdri-work-'));

  try {
    const readyRefs = prepareReferenceImages(opts.refs, workDir);
    const cells = expandTargetCells(opts);
    log(
      `husjs hdri: generating ${cells.length} cell(s) for preset '${opts.preset}' -> ${outDir} ` +
        `(detailRes=${opts.detailRes}, hdrRes=${opts.res}, imageSize=${opts.imageSize}, ` +
        `anchorLock=${opts.anchorLock}, multiTile=${opts.multiTile}, webpQuality=${opts.webpQuality}, concurrency=${opts.concurrency})`
    );

    const manifestCells = {};

    const recordCellManifestAndLog = (cell, idxLabel, resInfo) => {
      manifestCells[cell.key] = {
        mainFile: cell.mainFile,
        ...(cell.detailRes > 0
          ? {
              detailFile: cell.detailFile,
              detailWidth: cell.detailRes,
              detailHeight: Math.round(cell.detailRes / 2),
            }
          : {}),
        ...(opts.previewRes > 0 ? { previewFile: cell.previewFile } : {}),
        width: resInfo.mainHdr.width,
        height: resInfo.mainHdr.height,
        hdrSunU: resInfo.fullHdr.hdrSunU,
        hdrSunV: resInfo.fullHdr.hdrSunV,
        horizonGround: resInfo.fullHdr.horizonGround,
      };
      log(
        `  [${idxLabel}] wrote ${cell.mainFile} (${resInfo.mainHdr.width}x${resInfo.mainHdr.height} ${(resInfo.encodedMainBytes / (1024 * 1024)).toFixed(2)} MB` +
          (cell.detailRes > 0
            ? ` + ${cell.detailFile} ${cell.detailRes}x${Math.round(cell.detailRes / 2)} ${resInfo.detailKb} KB`
            : '') +
          (opts.previewRes > 0 ? ` + _512 ${resInfo.previewKb} KB` : '') +
          `, sunU=${resInfo.fullHdr.hdrSunU}, horizon=[${resInfo.fullHdr.horizonGround.join(', ')}])`
      );
    };

    if (opts.anchorLock && cells.length > 0) {
      const anchorFullW = opts.detailRes > 0 ? Math.max(opts.detailRes, opts.res) : opts.res;
      const anchorFullH = Math.round(anchorFullW / 2);
      const anchorIdx = selectAnchorCellIndex(cells, opts.preset);
      const anchorCell = opts.anchor ? null : cells[anchorIdx];

      /** @type {Float32Array} */
      let anchorEquirect;
      const anchorPngPath = join(workDir, 'anchor_2to1.png');

      if (opts.anchor) {
        const absAnchor = resolve(opts.anchor);
        if (!existsSync(absAnchor)) {
          throw new Error(`--anchor file not found: ${absAnchor}`);
        }
        log(`  [Anchor] loading Master Anchor from ${absAnchor}...`);
        const decodedAnchor = decodeImageBufferToRgb(readFileSync(absAnchor), workDir);
        const ratio = decodedAnchor.width / Math.max(1, decodedAnchor.height);
        anchorEquirect =
          Math.abs(ratio - 2.0) < 0.06
            ? buildDirect2to1EquirectGrid(decodedAnchor, anchorFullW, anchorFullH, 'clear', null)
            : buildPeriodicLinearEquirectGrid(decodedAnchor, anchorFullW, anchorFullH, 'clear');
        const anchorPngBytes = encodeAnchorReferencePng(
          anchorEquirect,
          anchorFullW,
          anchorFullH,
          4096
        );
        writeFileSync(anchorPngPath, anchorPngBytes);
        if (opts.manifestOut) {
          const snapDir = dirname(resolve(opts.manifestOut));
          mkdirSync(snapDir, { recursive: true });
          writeFileSync(
            join(snapDir, `anchor_${opts.preset.replace(/-/g, "_")}.png`),
            anchorPngBytes
          );
        }
      } else if (anchorCell) {
        log(
          `  [Anchor] Step A — generating Master Anchor '${anchorCell.key}' (${anchorFullW}x${anchorFullH}, imageSize=${opts.imageSize})...`
        );
        const anchorPrompt = buildCellPrompt({
          preset: opts.preset,
          basePrompt: opts.prompt,
          season: /** @type {any} */ (anchorCell.season),
          time: /** @type {any} */ (anchorCell.time),
          weather: /** @type {any} */ (anchorCell.weather),
          includeSeason: anchorCell.includeSeason,
          includeCompassLayout: true,
        });

        const rawMasterBytes = await generateWithRetry(() =>
          generatePanoramaSourceBytes({
            prompt: anchorPrompt,
            refs: readyRefs,
            backend: opts.backend,
            gcpProject: opts.gcpProject,
            aspectRatio: '21:9',
            imageSize: opts.imageSize,
            model: opts.model,
            scratchRoot: workDir,
          })
        );
        const decodedMaster = decodeImageBufferToRgb(rawMasterBytes, workDir);
        log(
          `  [Anchor] base 21:9 shot decoded (${decodedMaster.width}x${decodedMaster.height}); healing periodic u=0/1 seam...`
        );
        anchorEquirect = buildPeriodicLinearEquirectGrid(
          decodedMaster,
          anchorFullW,
          anchorFullH,
          anchorCell.weather
        );

        if (opts.multiTile && anchorFullW >= 2048) {
          log(`  [Anchor] running 4-azimuth ${opts.imageSize} 3:2 horizon super-resolution fusion...`);
          await fuseMultiAzimuthHorizonSuperRes(anchorEquirect, anchorFullW, anchorFullH, {
            preset: opts.preset,
            season: anchorCell.season,
            time: anchorCell.time,
            weather: anchorCell.weather,
            workDir,
            generateTileBytes: ({ prompt: tilePrompt, cropPngPath }) =>
              generateWithRetry(() =>
                generatePanoramaSourceBytes({
                  prompt: tilePrompt,
                  refs: [cropPngPath],
                  backend: opts.backend,
                  gcpProject: opts.gcpProject,
                  aspectRatio: '3:2',
                  imageSize: opts.imageSize,
                  model: opts.model,
                  scratchRoot: workDir,
                })
              ),
          });
        }

        writeFileSync(
          anchorPngPath,
          encodeAnchorReferencePng(anchorEquirect, anchorFullW, anchorFullH, 4096)
        );

        const anchorWorkCopy = new Float32Array(anchorEquirect);
        const anchorResInfo = writeCellOutputsFromGrid({
          equirectGrid: anchorWorkCopy,
          fullW: anchorFullW,
          fullH: anchorFullH,
          cell: anchorCell,
          opts,
          outDir,
          lockAzimuth: true,
        });
        recordCellManifestAndLog(anchorCell, `1/${cells.length} anchor`, anchorResInfo);
      } else {
        throw new Error('Failed to select Master Anchor cell');
      }

      // Precompute Master Anchor low-pass band once for 8K horizon micro-detail transfer
      const bandY0 = Math.max(0, Math.floor(anchorFullH * 0.44));
      const bandY1 = Math.min(anchorFullH, Math.ceil(anchorFullH * 0.58));
      const anchorLowBand = boxBlurBandRgb(
        anchorEquirect,
        anchorFullW,
        anchorFullH,
        bandY0,
        bandY1,
        2
      );

      const remainingIndices = [];
      for (let i = 0; i < cells.length; i++) {
        if (!opts.anchor && i === anchorIdx) continue;
        remainingIndices.push(i);
      }

      let nextPtr = 0;
      const relightWorker = async () => {
        while (nextPtr < remainingIndices.length) {
          const rIdx = nextPtr++;
          const idx = remainingIndices[rIdx];
          const cell = cells[idx];
          const mainPath = join(outDir, cell.mainFile);
          const detailPath = join(outDir, cell.detailFile);
          const previewPath = join(outDir, cell.previewFile);

          if (
            opts.skipExisting &&
            existsSync(mainPath) &&
            (cell.detailRes <= 0 || existsSync(detailPath)) &&
            (opts.previewRes <= 0 || existsSync(previewPath))
          ) {
            log(`  [${idx + 1}/${cells.length}] skip existing ${cell.mainFile}`);
            continue;
          }

          const relightPrompt = buildAnchorRelightPrompt({
            preset: opts.preset,
            season: cell.season,
            time: cell.time,
            weather: cell.weather,
            includeSeason: cell.includeSeason,
          });

          const decodedRelit = await generateWithRetry(async () => {
            const bytes = await generatePanoramaSourceBytes({
              prompt: relightPrompt,
              refs: [anchorPngPath],
              backend: opts.backend,
              gcpProject: opts.gcpProject,
              aspectRatio: 'auto',
              imageSize: opts.imageSize,
              model: opts.model,
              scratchRoot: workDir,
            });
            const dec = decodeImageBufferToRgb(bytes, workDir);
            const ratio = dec.width / Math.max(1, dec.height);
            if (Math.abs(ratio - 2.0) >= 0.06) {
              throw new Error(
                `Expected 2:1 anchor-relit image for ${cell.key}, got ${dec.width}x${dec.height} (ratio=${ratio.toFixed(3)})`
              );
            }
            return dec;
          });

          const fullW = cell.detailRes > 0 ? Math.max(cell.detailRes, cell.res) : cell.res;
          const fullH = Math.round(fullW / 2);
          const equirectGrid = buildDirect2to1EquirectGrid(
            decodedRelit,
            fullW,
            fullH,
            cell.weather,
            fullW === anchorFullW && fullH === anchorFullH ? anchorEquirect : null,
            {
              season: cell.season,
              time: cell.time,
              anchorLowBand,
              anchorBandY0: bandY0,
              anchorBandY1: bandY1,
            }
          );

          const resInfo = writeCellOutputsFromGrid({
            equirectGrid,
            fullW,
            fullH,
            cell,
            opts,
            outDir,
            lockAzimuth: true,
          });
          recordCellManifestAndLog(cell, `${idx + 1}/${cells.length}`, resInfo);
        }
      };

      const runners = Array.from(
        { length: Math.min(opts.concurrency, Math.max(1, remainingIndices.length)) },
        () => relightWorker()
      );
      await Promise.all(runners);
    } else {
      let nextIdx = 0;
      const worker = async () => {
        while (nextIdx < cells.length) {
          const idx = nextIdx++;
          const cell = cells[idx];
          const mainPath = join(outDir, cell.mainFile);
          const detailPath = join(outDir, cell.detailFile);
          const previewPath = join(outDir, cell.previewFile);

          if (
            opts.skipExisting &&
            existsSync(mainPath) &&
            (cell.detailRes <= 0 || existsSync(detailPath)) &&
            (opts.previewRes <= 0 || existsSync(previewPath))
          ) {
            log(`  [${idx + 1}/${cells.length}] skip existing ${cell.mainFile}`);
            continue;
          }

          const prompt = buildCellPrompt({
            preset: opts.preset,
            basePrompt: opts.prompt,
            season: /** @type {any} */ (cell.season),
            time: /** @type {any} */ (cell.time),
            weather: /** @type {any} */ (cell.weather),
            includeSeason: cell.includeSeason,
          });

          const rawMasterBytes = await generateWithRetry(() =>
            generatePanoramaSourceBytes({
              prompt,
              refs: readyRefs,
              backend: opts.backend,
              gcpProject: opts.gcpProject,
              aspectRatio: '21:9',
              imageSize: opts.imageSize,
              model: opts.model,
              scratchRoot: workDir,
            })
          );

          const decodedMaster = decodeImageBufferToRgb(rawMasterBytes, workDir);
          const fullW = cell.detailRes > 0 ? Math.max(cell.detailRes, cell.res) : cell.res;
          const fullH = Math.round(fullW / 2);
          const equirectGrid = buildPeriodicLinearEquirectGrid(
            decodedMaster,
            fullW,
            fullH,
            cell.weather
          );

          if (opts.multiTile && fullW >= 2048) {
            await fuseMultiAzimuthHorizonSuperRes(equirectGrid, fullW, fullH, {
              preset: opts.preset,
              season: cell.season,
              time: cell.time,
              weather: cell.weather,
              workDir,
              generateTileBytes: ({ prompt: tilePrompt, cropPngPath }) =>
                generateWithRetry(() =>
                  generatePanoramaSourceBytes({
                    prompt: tilePrompt,
                    refs: [cropPngPath],
                    backend: opts.backend,
                    gcpProject: opts.gcpProject,
                    aspectRatio: '3:2',
                    imageSize: opts.imageSize,
                    model: opts.model,
                    scratchRoot: workDir,
                  })
                ),
            });
          }

          const resInfo = writeCellOutputsFromGrid({
            equirectGrid,
            fullW,
            fullH,
            cell,
            opts,
            outDir,
            lockAzimuth: false,
          });
          recordCellManifestAndLog(cell, `${idx + 1}/${cells.length}`, resInfo);
        }
      };

      const runners = Array.from(
        { length: Math.min(opts.concurrency, Math.max(1, cells.length)) },
        () => worker()
      );
      await Promise.all(runners);
    }

    if (opts.manifestOut) {
      const manifestPath = resolve(opts.manifestOut);
      mkdirSync(dirname(manifestPath), { recursive: true });
      writeFileSync(
        manifestPath,
        JSON.stringify({ preset: opts.preset, cells: manifestCells }, null, 2) + '\n'
      );
      log(`husjs hdri: wrote manifest -> ${manifestPath}`);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

const isMain =
  process.argv[1] &&
  (() => {
    try {
      return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
    } catch {
      return false;
    }
  })();

if (isMain) {
  runHdriCli(process.argv.slice(2)).catch((err) => {
    console.error(`husjs hdri error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
