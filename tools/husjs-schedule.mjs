#!/usr/bin/env node
/**
 * `husjs schedule` — Architectural FF&E / Sanitaryware / Joinery / Appliance Schedule Exporter.
 *
 * Loads any Hus.js house definition or `PropertySceneProfile` headlessly in Node via Vite SSR,
 * constructs the full 3D scene graph, and aggregates every smart asset tagged with
 * `attachAssetMetadata(...)` into a clean Table, Markdown, CSV, or JSON schedule.
 *
 * Usage:
 *   husjs schedule --house simple-house
 *   husjs schedule --house simple-house --format csv --out ./schedule.csv
 *   husjs schedule --house simple-house --format json
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseCliFlags } from './cli-args.mjs';
import { resolveHouseModulePath } from './husjs-zfight.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_HOUSE = 'simple-house';
const VALID_FORMATS = new Set(['markdown', 'md', 'table', 'csv', 'json']);

const SCHEDULE_CLI_OPTIONS = {
  house: { type: 'string' },
  format: { type: 'string' },
  out: { type: 'string' },
  category: { type: 'string' },
  room: { type: 'string' },
  json: { type: 'boolean' },
  'by-zone': { type: 'boolean' },
};

export function parseScheduleCliArgs(argv) {
  const { values } = parseCliFlags(argv, SCHEDULE_CLI_OPTIONS);

  if (values.help) {
    return {
      help: true,
      house: DEFAULT_HOUSE,
      format: 'markdown',
      groupByZone: false,
      out: undefined,
      category: undefined,
      room: undefined,
    };
  }

  const jsonFlag = values.json === true;
  const groupByZone = values['by-zone'] === true;

  let format = (values.format ?? (jsonFlag ? 'json' : 'markdown')).toLowerCase();
  if (!VALID_FORMATS.has(format)) {
    throw new Error(
      `Invalid --format '${format}'. Expected one of: markdown, table, csv, json`
    );
  }
  if (format === 'md') format = 'markdown';

  return {
    help: false,
    house: values.house ?? DEFAULT_HOUSE,
    format,
    groupByZone,
    out: values.out,
    category: values.category,
    room: values.room,
  };
}

export function printScheduleHelp(log = console.log) {
  log(`Usage: husjs schedule [options]
       node tools/husjs-schedule.mjs [options]

Exports a complete FF&E, sanitaryware, joinery, lighting, and appliance schedule
from any Hus.js house scene in Markdown, Table, CSV, or JSON format.

Options:
  --house <id-or-path>               House id ('simple-house', 'simple-house', 'simple-flat',
                                     'stahl-house') or path to a .ts/.js house module
                                     (default: ${DEFAULT_HOUSE})
  --format <markdown|table|csv|json> Output format (default: markdown)
  --json                             Shorthand for --format json
  --by-zone                          Group schedule rows per room/zone
  --category <category>              Filter rows by AssetCategory (e.g. sanitaryware, appliance)
  --room <zoneId>                    Filter rows by room zone id or name
  --out <file>                       Write schedule to <file> instead of stdout
  --help, -h                         Show this help message

Examples:
  husjs schedule --house simple-house
  husjs schedule --house simple-house --format csv --out ./house-schedule.csv
  husjs schedule --house simple-house --json`);
}

function installHeadlessCanvasStub() {
  if (typeof globalThis.document !== 'undefined') {
    return () => {};
  }
  const noop = () => undefined;
  const makeGradient = () => ({ addColorStop: noop });
  const makeContext2d = () =>
    new Proxy(
      {
        canvas: { width: 256, height: 256 },
        createLinearGradient: makeGradient,
        createRadialGradient: makeGradient,
        createPattern: () => ({}),
        measureText: () => ({ width: 10 }),
        getImageData: (_x, _y, w, h) => ({
          width: w,
          height: h,
          data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
        }),
        createImageData: (w, h) => ({
          width: w,
          height: h,
          data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
        }),
        putImageData: noop,
      },
      {
        get(target, prop) {
          return prop in target ? target[prop] : noop;
        },
        set() {
          return true;
        },
      }
    );

  const createStubElement = (tag) => {
    if (tag === 'canvas') {
      return {
        width: 256,
        height: 256,
        style: {},
        getContext: () => makeContext2d(),
        toDataURL: () => 'data:image/png;base64,',
        addEventListener: noop,
        removeEventListener: noop,
      };
    }
    return { style: {}, addEventListener: noop, removeEventListener: noop };
  };

  globalThis.document = {
    createElement: createStubElement,
    createElementNS: (_ns, tag) => createStubElement(tag),
  };

  return () => {
    delete globalThis.document;
  };
}

function isPropertySceneProfile(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.createZoneRegistry === 'function' &&
    typeof value.buildSecurityOverlay === 'function' &&
    value.circuitMaxIntensity !== undefined
  );
}

function isHouseDefinition(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.createSceneProfile === 'function'
  );
}

function extractHouseAndProfileFromModule(mod, fallbackId) {
  const candidates = [];
  if (mod && typeof mod === 'object') {
    if ('default' in mod && mod.default !== undefined) {
      candidates.push(['default', mod.default]);
    }
    for (const [key, val] of Object.entries(mod)) {
      if (key !== 'default') {
        candidates.push([key, val]);
      }
    }
  }

  for (const [, val] of candidates) {
    if (isHouseDefinition(val)) {
      const profile = val.createSceneProfile();
      return { houseId: val.id ?? profile.id ?? fallbackId, houseDef: val, profile };
    }
    if (isPropertySceneProfile(val)) {
      return { houseId: val.id ?? fallbackId, houseDef: null, profile: val };
    }
  }

  for (const [key, val] of candidates) {
    if (typeof val === 'function' && /^create.*Profile$/i.test(key) && val.length === 0) {
      const invoked = val();
      if (isPropertySceneProfile(invoked)) {
        return { houseId: invoked.id ?? fallbackId, houseDef: null, profile: invoked };
      }
    }
  }

  throw new Error(
    `Module did not export a Hus.js HouseDefinition (defineHouse) or PropertySceneProfile`
  );
}


function collectRoomFinishesForSchedule(houseDef, profile, scene) {
  const manifest = houseDef?.rooms?.manifest ?? profile?.roomManifest ?? [];
  const roomDefs = houseDef?.rooms?.definitions ?? {};
  const out = [];
  const seenZones = new Set();

  for (const entry of manifest) {
    const def = roomDefs[entry.zoneId];
    const finishes = entry.finishes ?? def?.finishes ?? scene?.userData?.roomFinishes?.[entry.zoneId];
    const mergedNotes = Array.from(
      new Set(
        [...(finishes?.notes ?? []), ...(entry.notes ?? []), ...(def?.notes ?? [])]
          .map((n) => String(n).trim())
          .filter(Boolean)
      )
    );
    if (!finishes && mergedNotes.length === 0) continue;
    seenZones.add(entry.zoneId);
    out.push({
      zoneId: entry.zoneId,
      label: entry.label ?? def?.name ?? entry.zoneId,
      ...(entry.group ? { group: entry.group } : {}),
      ...(entry.floor ? { floor: entry.floor } : {}),
      ...(finishes ? { finishes } : {}),
      ...(mergedNotes.length > 0 ? { notes: mergedNotes } : {}),
    });
  }

  for (const reg of profile?.lodRegistrations ?? []) {
    if (seenZones.has(reg.zoneId)) continue;
    const def = roomDefs[reg.zoneId];
    const finishes = reg.finishes ?? def?.finishes ?? scene?.userData?.roomFinishes?.[reg.zoneId];
    const mergedNotes = Array.from(
      new Set(
        [...(finishes?.notes ?? []), ...(reg.notes ?? []), ...(def?.notes ?? [])]
          .map((n) => String(n).trim())
          .filter(Boolean)
      )
    );
    if (!finishes && mergedNotes.length === 0) continue;
    seenZones.add(reg.zoneId);
    out.push({
      zoneId: reg.zoneId,
      label: def?.name ?? reg.shortName ?? reg.zoneId,
      floor: reg.floorId,
      ...(finishes ? { finishes } : {}),
      ...(mergedNotes.length > 0 ? { notes: mergedNotes } : {}),
    });
  }

  return out;
}

export async function runScheduleCli(argv = process.argv.slice(2), io = {}) {
  const log = io.log ?? console.log;
  const parsed = parseScheduleCliArgs(argv);
  if (parsed.help) {
    printScheduleHelp(log);
    return { help: true };
  }

  const cleanupCanvas = installHeadlessCanvasStub();
  const { createServer } = await import('vite');
  const cwd = io.cwd ?? process.cwd();
  const server = await createServer({
    configFile: false,
    root: cwd,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false, fs: { allow: [cwd, REPO_ROOT] } },
    optimizeDeps: { noDiscovery: true },
    resolve: {
      alias: [
        { find: /^husjs\/(.+)$/, replacement: join(REPO_ROOT, 'src/husjs/$1.ts') },
        { find: /^husjs$/, replacement: join(REPO_ROOT, 'src/husjs/index.ts') },
      ],
    },
  });

  try {
    const THREE = await import('three');
    const viewerMod = await server.ssrLoadModule(join(REPO_ROOT, 'src/husjs/viewer.ts'));
    const { createPropertySceneLayers, buildPropertySceneContent, RoomLodController } = viewerMod;
    const { collectSceneAssetSchedule } = await server.ssrLoadModule(
      join(REPO_ROOT, 'src/engine/assets/smart-asset.ts')
    );
    const {
      formatAssetScheduleCsv,
      formatAssetScheduleMarkdown,
      formatAssetScheduleTable,
    } = await server.ssrLoadModule(
      join(REPO_ROOT, 'src/core/assets/asset-metadata.ts')
    );

    const modulePath = resolveHouseModulePath(parsed.house, { cwd, repoRoot: REPO_ROOT });
    const mod = await server.ssrLoadModule(modulePath);
    const { houseId, houseDef, profile } = extractHouseAndProfileFromModule(mod, parsed.house);

    const scene = new THREE.Scene();
    const layers = createPropertySceneLayers(scene, profile.floors);
    const lodController = new RoomLodController(profile.lodRegistrations);
    const registry = profile.createZoneRegistry();
    buildPropertySceneContent(layers, {
      profile,
      registry,
      lodController,
      ceilingCutaway: false,
    });
    scene.updateMatrixWorld(true);

    const roomDefs = houseDef?.rooms?.definitions ?? {};
    const manifestLabels = new Map(
      (houseDef?.rooms?.manifest ?? profile?.roomManifest ?? []).map((m) => [m.zoneId, m.label])
    );
    const getZoneLabel = (zoneId) => manifestLabels.get(zoneId) ?? roomDefs[zoneId]?.name ?? zoneId;

    let roomFinishes = collectRoomFinishesForSchedule(houseDef, profile, scene);
    if (parsed.room) {
      const roomFilter = parsed.room.toLowerCase();
      roomFinishes = roomFinishes.filter(
        (r) =>
          r.zoneId.toLowerCase().includes(roomFilter) ||
          r.label.toLowerCase().includes(roomFilter)
      );
    }
    if (parsed.category && parsed.category.toLowerCase() !== "finishes") {
      roomFinishes = [];
    }

    let report = {
      ...collectSceneAssetSchedule(scene, {
        houseId,
        houseName: houseDef?.name ?? profile.name ?? houseId,
        groupByZone: parsed.groupByZone,
        getZoneLabel,
      }),
      ...(roomFinishes.length > 0 ? { roomFinishes } : {}),
    };

    if (parsed.category || parsed.room) {
      const catFilter = parsed.category?.toLowerCase();
      const roomFilter = parsed.room?.toLowerCase();
      const filteredEntries = report.entries.filter((e) => {
        if (catFilter && (e.category ?? '').toLowerCase() !== catFilter) return false;
        if (
          roomFilter &&
          !e.zones.some((z) => z.toLowerCase().includes(roomFilter))
        ) {
          return false;
        }
        return true;
      });
      const totalPlacedAssets = filteredEntries.reduce((acc, e) => acc + e.quantity, 0);
      report = {
        ...report,
        totalPlacedAssets,
        uniqueEntries: filteredEntries.length,
        entries: filteredEntries,
      };
    }

    let formatted;
    if (parsed.format === 'json') {
      formatted = JSON.stringify(report, null, 2);
    } else if (parsed.format === 'csv') {
      formatted = formatAssetScheduleCsv(report);
    } else if (parsed.format === 'table') {
      formatted = formatAssetScheduleTable(report);
    } else {
      formatted = formatAssetScheduleMarkdown(report);
    }

    if (parsed.out) {
      const outPath = resolve(process.cwd(), parsed.out);
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, formatted.endsWith('\n') ? formatted : `${formatted}\n`, 'utf8');
      log(
        `Wrote ${parsed.format} schedule (${report.uniqueEntries} unique line(s), ${report.totalPlacedAssets} total asset(s)) to ${outPath}`
      );
    } else {
      log(formatted);
    }

    return { help: false, report, formatted };
  } finally {
    await server.close();
    cleanupCanvas();
  }
}

const isMain =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  runScheduleCli().catch((err) => {
    console.error(`husjs-schedule error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
