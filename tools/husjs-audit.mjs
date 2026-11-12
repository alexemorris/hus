#!/usr/bin/env node
/**
 * `husjs audit` — deterministic architectural & 1PV walkthrough verification suite CLI.
 *
 * Loads any Hus.js house definition or `PropertySceneProfile` headlessly in Node via Vite SSR,
 * constructs the full 3D scene graph, and runs the 4 architectural audit checks:
 *   1. zFighting   (coplanar triangle overlap detector, epsilon = 0.35 mm)
 *   2. cutaway     (cutawayWall descriptor integrity & missing wall attachments)
 *   3. doorSwings  (swept 3D OBB door-swing & drawer-slide collision clearance)
 *   4. walkthrough (staircase vertical headroom >= 1.95 m & 20 cm 1PV capsule BFS reachability)
 *
 * Usage:
 *   husjs audit --house simple-flat
 *   husjs audit --house stahl-house --strict
 *   husjs audit --house simple-house --skip zFighting,cutaway --json
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveHouseModulePath } from './husjs-zfight.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_HOUSE = 'simple-flat';
const EXAMPLE_HOUSES = ['simple-flat', 'simple-house', 'stahl-house'];
const VALID_CHECKS = new Set(['zFighting', 'cutaway', 'doorSwings', 'walkthrough']);
const CHECK_ORDER = ['zFighting', 'cutaway', 'doorSwings', 'walkthrough'];
const CHECK_LABELS = {
  zFighting: 'Z-Fighting Coplanar Overlap',
  cutaway: 'Cutaway Wall Integrity',
  doorSwings: 'Door-Swing & Drawer Clearance',
  walkthrough: '1PV Walkthrough & Stair Headroom',
};

const VALUE_FLAGS = new Set(['house', 'skip']);
const BOOLEAN_FLAGS = new Set(['json', 'strict', 'all-examples']);

export function parseAuditCliArgs(argv) {
  /** @type {Record<string, string>} */
  const flags = {};
  let help = false;
  let json = false;
  let strict = false;
  let allExamples = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected positional argument '${arg}'`);
    }
    const eqIdx = arg.indexOf('=');
    const key = eqIdx >= 0 ? arg.slice(2, eqIdx) : arg.slice(2);

    if (BOOLEAN_FLAGS.has(key)) {
      if (eqIdx >= 0) {
        const val = arg.slice(eqIdx + 1).toLowerCase();
        if (val !== 'true' && val !== 'false' && val !== '1' && val !== '0') {
          throw new Error(`Invalid boolean value for '--${key}': '${val}'`);
        }
        const enabled = val === 'true' || val === '1';
        if (key === 'json') json = enabled;
        if (key === 'strict') strict = enabled;
        if (key === 'all-examples') allExamples = enabled;
      } else {
        if (key === 'json') json = true;
        if (key === 'strict') strict = true;
        if (key === 'all-examples') allExamples = true;
      }
      continue;
    }

    if (!VALUE_FLAGS.has(key)) {
      throw new Error(`Unknown flag '--${key}'`);
    }

    if (eqIdx >= 0) {
      flags[key] = arg.slice(eqIdx + 1);
    } else {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`Missing value for flag '--${key}'`);
      }
      flags[key] = next;
      i++;
    }
  }

  if (help) {
    return { help: true };
  }

  if (allExamples && flags.house !== undefined) {
    throw new Error('Cannot combine --house with --all-examples');
  }

  if (flags.house === '') {
    throw new Error("Flag '--house' needs a non-empty value");
  }

  /** @type {string[]} */
  const skipChecks = [];
  if (flags.skip !== undefined && flags.skip.trim().length > 0) {
    for (const raw of flags.skip.split(',')) {
      const check = raw.trim();
      if (!check) continue;
      if (!VALID_CHECKS.has(check)) {
        throw new Error(
          `Unknown check '${check}' in --skip (expected comma-separated values from: ${Array.from(VALID_CHECKS).join(', ')})`
        );
      }
      if (!skipChecks.includes(check)) {
        skipChecks.push(check);
      }
    }
  }

  return {
    help: false,
    house: flags.house ?? DEFAULT_HOUSE,
    allExamples,
    json,
    strict,
    skipChecks,
  };
}

export function printAuditHelp(log = console.log) {
  log(`Usage: husjs audit [options]
       node tools/husjs-audit.mjs [options]

Runs the built-in architectural & 1PV walkthrough verification suite on a Hus.js house.

Checks:
  zFighting      Coplanar triangle z-fighting overlap detector (epsilon = 0.35 mm)
  cutaway        Cutaway wall descriptor validity & missing wall attachments
  doorSwings     Swept 3D OBB door-swing & drawer-slide collision clearance
  walkthrough    Staircase vertical headroom (>= 1.95 m) & 20 cm 1PV capsule BFS reachability

Options:
  --house <id-or-path>     House id ('simple-flat', 'simple-house', 'stahl-house',) or path to a .ts/.js house module
                           (default: ${DEFAULT_HOUSE})
  --all-examples           Audit all example houses (${EXAMPLE_HOUSES.join(', ')})
  --skip <checks>          Comma-separated checks to skip (e.g. zFighting,cutaway)
  --strict                 Treat warnings as failures (non-zero exit code)
  --json                   Emit structured JSON audit report
  --help, -h               Show this help message

Examples:
  husjs audit --house simple-flat
  husjs audit --house stahl-house --strict
  husjs audit --house simple-house --skip zFighting --json`);
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
    if (typeof val === 'function' && /SceneProfile/i.test(key)) {
      const profile = val();
      if (isPropertySceneProfile(profile)) {
        return { houseId: profile.id ?? fallbackId, houseDef: null, profile };
      }
    }
  }

  throw new Error(
    `Module for '${fallbackId}' does not export a HouseDefinition or PropertySceneProfile`
  );
}

function createProfileRoomMinYSampler(lodRegistrations) {
  const WALK_FLOOR_SNAP_M = 0.95;
  return (x, y, z) => {
    let bestMinY = null;
    let bestDistY = Number.POSITIVE_INFINITY;
    for (const reg of lodRegistrations) {
      if (reg.isInterior === false) continue;
      if (reg.excludedCutout?.(x, z)) continue;
      const b = reg.bounds;
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) {
        const walkingFloorY = reg.walkingFloorY ?? b.minY;
        const distY = Math.abs(y - walkingFloorY);
        if (distY <= WALK_FLOOR_SNAP_M && distY < bestDistY) {
          bestDistY = distY;
          bestMinY = walkingFloorY;
        }
      }
    }
    return bestMinY;
  };
}

function formatAuditTable(houseId, report, strict) {
  const failed = report.errorCount > 0 || (strict && report.warningCount > 0);
  const overallLabel = failed
    ? 'FAIL'
    : report.warningCount > 0
      ? 'WARN'
      : 'PASS';

  const lines = [
    `[husjs audit] ${houseId}: ${overallLabel} (${report.errorCount} error(s), ${report.warningCount} warning(s), ${report.durationMs.toFixed(0)} ms)`,
    '  Check                            | Status | Errors | Warnings | Time (ms)',
    '-----------------------------------+--------+--------+----------+----------',
  ];

  for (const check of CHECK_ORDER) {
    const c = report.checks[check];
    const label = CHECK_LABELS[check].padEnd(32, ' ');
    const statusRaw =
      c.status === 'skipped'
        ? 'SKIP'
        : c.status === 'fail' || (strict && c.status === 'warn')
          ? 'FAIL'
          : c.status.toUpperCase();
    const status = statusRaw.padEnd(6, ' ');
    const errs = String(c.errorCount).padStart(6, ' ');
    const warns = String(c.warningCount).padStart(8, ' ');
    const ms = c.durationMs.toFixed(0).padStart(8, ' ');
    lines.push(`  ${label} | ${status} | ${errs} | ${warns} | ${ms}`);
  }

  if (report.findings.length > 0) {
    const limit = Math.min(report.findings.length, 25);
    lines.push('');
    lines.push('  Findings:');
    for (let i = 0; i < limit; i++) {
      const f = report.findings[i];
      const tag = f.severity === 'error' ? 'ERROR' : 'WARN ';
      lines.push(`    [${tag}] (${f.check}:${f.code}) ${f.message}`);
    }
    if (report.findings.length > limit) {
      lines.push(`    ... and ${report.findings.length - limit} more finding(s).`);
    }
  }

  return lines.join('\n');
}

/**
 * Runs `husjs audit`. Rejects when errors exist (or warnings under `--strict`).
 *
 * @param {string[]} [argv]
 * @param {{ log?: (message: string) => void, cwd?: string, repoRoot?: string }} [io]
 */
export async function runAuditCli(argv = process.argv.slice(2), io = {}) {
  const log = io.log ?? console.log;
  const cwd = io.cwd ?? process.cwd();
  const repoRoot = io.repoRoot ?? REPO_ROOT;

  const parsed = parseAuditCliArgs(argv);
  if (parsed.help) {
    printAuditHelp(log);
    return { help: true, passed: true, results: [] };
  }

  const houseSpecs = parsed.allExamples ? EXAMPLE_HOUSES : [parsed.house];
  const resolvedTargets = houseSpecs.map((spec) => ({
    spec,
    modulePath: resolveHouseModulePath(spec, { cwd, repoRoot }),
  }));

  const cleanupCanvas = installHeadlessCanvasStub();
  const engineRoot = existsSync(join(repoRoot, 'src', 'husjs', 'index.ts')) ? repoRoot : REPO_ROOT;
  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: false,
    root: cwd,
    logLevel: 'error',
    clearScreen: false,
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    ssr: { external: ['three', 'preact', '@preact/signals'] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null, fs: { allow: [cwd, repoRoot, engineRoot] } },
    resolve: {
      dedupe: ['three', 'preact', '@preact/signals'],
      alias: [
        { find: /^husjs\/(.+)$/, replacement: join(engineRoot, 'src/husjs/$1.ts') },
        { find: /^husjs$/, replacement: join(engineRoot, 'src/husjs/index.ts') },
      ],
    },
  });

  try {
    const THREE = await import('three');
    const testingMod = await server.ssrLoadModule(join(engineRoot, 'src/husjs/testing.ts'));
    const viewerMod = await server.ssrLoadModule(join(engineRoot, 'src/husjs/viewer.ts'));
    const { runArchitecturalAudit } = testingMod;
    const { createPropertySceneLayers, buildPropertySceneContent, RoomLodController } = viewerMod;

    const results = [];
    for (const target of resolvedTargets) {
      const mod = await server.ssrLoadModule(target.modulePath);
      const { houseId, houseDef, profile } = extractHouseAndProfileFromModule(mod, target.spec);

      const scene = new THREE.Scene();
      const layers = createPropertySceneLayers(scene, profile.floors);
      const lodController = new RoomLodController(profile.lodRegistrations);
      const registry = profile.createZoneRegistry();
      const built = buildPropertySceneContent(layers, {
        profile,
        registry,
        lodController,
        ceilingCutaway: false,
      });

      const getRoomMinYAt = createProfileRoomMinYSampler(profile.lodRegistrations);
      const sampleWalkable = profile.walkthroughHooks?.sampleWalkableElevation;
      const elevationSampler = sampleWalkable
        ? (x, z, currentFootY) => sampleWalkable(x, currentFootY, z, getRoomMinYAt)
        : undefined;

      const spawns = houseDef?.walkthrough?.spawns ?? profile.walkthroughHooks?.spawns;
      const firstSpawn = Array.isArray(spawns) && spawns.length > 0 ? spawns[0] : undefined;

      const report = runArchitecturalAudit(scene, {
        floors: profile.floors,
        roomZones: profile.lodRegistrations,
        interactions: built.interactions,
        doorPolicy: profile.doorPolicy,
        terrainSampler: profile.terrainSampler,
        ...(elevationSampler ? { elevationSampler } : {}),
        ...(firstSpawn?.position ? { entryPosition: firstSpawn.position } : {}),
        ...(firstSpawn?.zoneId ? { entryZoneId: firstSpawn.zoneId } : {}),
        skipChecks: parsed.skipChecks,
      });

      const failed = report.errorCount > 0 || (parsed.strict && report.warningCount > 0);
      results.push({
        house: houseId,
        passed: !failed,
        report,
      });
    }

    const failedResults = results.filter((r) => !r.passed);

    if (parsed.json) {
      if (parsed.allExamples) {
        log(
          JSON.stringify(
            {
              passed: failedResults.length === 0,
              strict: parsed.strict,
              houses: results.map((r) => ({
                house: r.house,
                passed: r.passed,
                errorCount: r.report.errorCount,
                warningCount: r.report.warningCount,
                checks: r.report.checks,
                findings: r.report.findings,
              })),
            },
            null,
            2
          )
        );
      } else {
        const single = results[0];
        log(
          JSON.stringify(
            {
              house: single.house,
              passed: single.passed,
              strict: parsed.strict,
              errorCount: single.report.errorCount,
              warningCount: single.report.warningCount,
              checks: single.report.checks,
              findings: single.report.findings,
            },
            null,
            2
          )
        );
      }
    } else {
      for (const r of results) {
        log(formatAuditTable(r.house, r.report, parsed.strict));
      }
    }

    if (failedResults.length > 0) {
      const summary = failedResults
        .map(
          (r) =>
            `${r.house} (${r.report.errorCount} error(s)${parsed.strict ? `, ${r.report.warningCount} warning(s)` : ''})`
        )
        .join(', ');
      throw new Error(`Architectural audit failed for ${summary}`);
    }

    return {
      help: false,
      passed: true,
      results,
    };
  } finally {
    await server.close();
    cleanupCanvas();
  }
}

const isMain =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  runAuditCli().catch((err) => {
    console.error(`husjs-audit error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
