#!/usr/bin/env node
/**
 * `husjs zfight` — deterministic 3D coplanar triangle z-fighting detector CLI.
 *
 * Loads any Hus.js house definition or `PropertySceneProfile` headlessly in Node via Vite SSR,
 * constructs the full 3D scene graph, and runs exact world-space coplanar triangle clipping.
 *
 * Usage:
 *   husjs zfight --house simple-flat
 *   husjs zfight --all-examples --epsilon-mm 0.35 --min-area-cm2 1.0
 *   node tools/husjs-zfight.mjs --house ./examples/stahl-house/index.ts --json
 */

import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseCliFlags } from './cli-args.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_HOUSE = 'simple-flat';
const DEFAULT_EPSILON_MM = 0.35;
const DEFAULT_MIN_AREA_CM2 = 1.0;
const EXAMPLE_HOUSES = ['simple-flat', 'simple-house', 'stahl-house'];

const BUILTIN_HOUSE_MODULES = {
  'simple-flat': 'examples/simple-flat/index.ts',
  'simple-house': 'examples/simple-house/index.ts',
  'stahl-house': 'examples/stahl-house/index.ts',
};

const ZFIGHT_CLI_OPTIONS = {
  house: { type: 'string' },
  'epsilon-mm': { type: 'string' },
  'min-area-cm2': { type: 'string' },
  json: { type: 'boolean' },
  'all-examples': { type: 'boolean' },
};

export function parseZfightCliArgs(argv) {
  const { values } = parseCliFlags(argv, ZFIGHT_CLI_OPTIONS);

  if (values.help) {
    return { help: true };
  }

  const json = values.json === true;
  const allExamples = values['all-examples'] === true;

  if (allExamples && values.house !== undefined) {
    throw new Error('Cannot combine --house with --all-examples');
  }

  if (values.house === '') {
    throw new Error("Flag '--house' needs a non-empty value");
  }

  const epsilonMm =
    values['epsilon-mm'] !== undefined ? Number(values['epsilon-mm']) : DEFAULT_EPSILON_MM;
  if (!Number.isFinite(epsilonMm) || epsilonMm < 0) {
    throw new Error(
      `--epsilon-mm must be a non-negative number in millimetres (got '${values['epsilon-mm']}')`
    );
  }

  const minAreaCm2 =
    values['min-area-cm2'] !== undefined ? Number(values['min-area-cm2']) : DEFAULT_MIN_AREA_CM2;
  if (!Number.isFinite(minAreaCm2) || minAreaCm2 < 0) {
    throw new Error(
      `--min-area-cm2 must be a non-negative number in cm² (got '${values['min-area-cm2']}')`
    );
  }

  return {
    help: false,
    house: values.house ?? DEFAULT_HOUSE,
    allExamples,
    epsilonMm,
    epsilonM: epsilonMm / 1000,
    minAreaCm2,
    minOverlapAreaM2: minAreaCm2 / 10000,
    json,
  };
}

export function printZfightHelp(log = console.log) {
  log(`Usage: husjs zfight [options]
       node tools/husjs-zfight.mjs [options]

Deterministically detects coplanar z-fighting triangle overlaps in a Hus.js house scene.

Options:
  --house <id-or-path>     House id ('simple-flat', 'simple-house', 'stahl-house') or path to a .ts/.js house module
                           (default: ${DEFAULT_HOUSE})
  --all-examples           Check all example houses (${EXAMPLE_HOUSES.join(', ')})
  --epsilon-mm <mm>        Maximum perpendicular plane separation in mm (default: ${DEFAULT_EPSILON_MM})
  --min-area-cm2 <cm2>     Minimum coplanar polygon overlap area in cm² (default: ${DEFAULT_MIN_AREA_CM2})
  --json                   Emit structured JSON { house, findingsCount, findings }
  --help, -h               Show this help message

Examples:
  husjs zfight --house simple-flat
  husjs zfight --all-examples --epsilon-mm 0.35 --min-area-cm2 1.0
  husjs zfight --house ./examples/stahl-house/index.ts --json`);
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

/**
 * Resolves a `--house` identifier or path to an absolute module file path.
 *
 * @param {string} houseSpec
 * @param {{ cwd?: string, repoRoot?: string }} [options]
 */
export function resolveHouseModulePath(houseSpec, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const repoRoot = options.repoRoot ?? REPO_ROOT;

  if (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(houseSpec)) {
    for (const root of [cwd, repoRoot]) {
      const homeCandidate = join(root, 'src', 'homes', houseSpec, 'index.ts');
      if (existsSync(homeCandidate)) return homeCandidate;
      const exampleCandidate = join(root, 'examples', houseSpec, 'index.ts');
      if (existsSync(exampleCandidate)) return exampleCandidate;
    }
  }

  if (Object.prototype.hasOwnProperty.call(BUILTIN_HOUSE_MODULES, houseSpec)) {
    return join(repoRoot, BUILTIN_HOUSE_MODULES[houseSpec]);
  }

  if (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(houseSpec)) {
    const exampleCandidate = join(repoRoot, 'examples', houseSpec, 'index.ts');
    if (existsSync(exampleCandidate)) {
      return exampleCandidate;
    }
    const homeCandidate = join(repoRoot, 'src', 'homes', houseSpec, 'index.ts');
    if (existsSync(homeCandidate)) {
      return homeCandidate;
    }
  }

  const candidatePaths = [resolve(cwd, houseSpec), resolve(repoRoot, houseSpec)];
  for (const abs of candidatePaths) {
    if (!existsSync(abs)) continue;
    const st = statSync(abs);
    if (st.isDirectory()) {
      for (const indexFile of ['index.ts', 'index.js', 'index.mjs']) {
        const inner = join(abs, indexFile);
        if (existsSync(inner)) return inner;
      }
    } else if (st.isFile()) {
      return abs;
    }
  }

  throw new Error(
    `Could not resolve house '${houseSpec}' (expected one of ${Object.keys(BUILTIN_HOUSE_MODULES).join(', ')} or a valid module path)`
  );
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

function extractSceneProfileFromModule(mod, fallbackId) {
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
      return { houseId: val.id ?? profile.id ?? fallbackId, profile };
    }
    if (isPropertySceneProfile(val)) {
      return { houseId: val.id ?? fallbackId, profile: val };
    }
  }

  for (const [key, val] of candidates) {
    if (typeof val === 'function' && /SceneProfile/i.test(key)) {
      const profile = val();
      if (isPropertySceneProfile(profile)) {
        return { houseId: profile.id ?? fallbackId, profile };
      }
    }
  }

  throw new Error(
    `Module for '${fallbackId}' does not export a HouseDefinition or PropertySceneProfile`
  );
}

function serializeFinding(f) {
  return {
    meshA: f.meshA,
    meshB: f.meshB,
    materialA: f.materialA,
    materialB: f.materialB,
    normal: f.normal,
    planeDistanceDiffMm: f.planeDistanceDiffMm,
    overlapAreaCm2: f.overlapAreaCm2,
    centroid: f.centroid,
  };
}

function formatHumanReport(houseId, findings, elapsedMs) {
  if (findings.length === 0) {
    return `[husjs zfight] ${houseId}: 0 z-fighting overlaps (${elapsedMs.toFixed(0)} ms)`;
  }

  const previewLimit = Math.min(findings.length, 25);
  const lines = [
    `[husjs zfight] ${houseId}: ${findings.length} coplanar z-fighting overlap(s) (${elapsedMs.toFixed(0)} ms):`,
    '  # | Area (cm²) | Diff (mm) | Normal              | Centroid [x, y, z]       | Mesh Pair',
    '----+------------+-----------+---------------------+--------------------------+----------',
  ];

  for (let i = 0; i < previewLimit; i++) {
    const f = findings[i];
    const idx = String(i + 1).padStart(3, ' ');
    const area = f.overlapAreaCm2.toFixed(2).padStart(10, ' ');
    const diff = f.planeDistanceDiffMm.toFixed(3).padStart(9, ' ');
    const norm = `[${f.normal.map((n) => n.toFixed(2)).join(', ')}]`.padEnd(19, ' ');
    const cent = `[${f.centroid.map((c) => c.toFixed(2)).join(', ')}]`.padEnd(24, ' ');
    lines.push(`${idx} | ${area} | ${diff} | ${norm} | ${cent} | ${f.meshA} <-> ${f.meshB}`);
  }

  if (findings.length > previewLimit) {
    lines.push(`... and ${findings.length - previewLimit} more finding(s).`);
  }

  return lines.join('\n');
}

/**
 * Runs `husjs zfight`. Rejects when invalid flags are passed or when z-fighting findings exist.
 *
 * @param {string[]} [argv]
 * @param {{ log?: (message: string) => void, cwd?: string, repoRoot?: string }} [io]
 */
export async function runZfightCli(argv = process.argv.slice(2), io = {}) {
  const log = io.log ?? console.log;
  const cwd = io.cwd ?? process.cwd();
  const repoRoot = io.repoRoot ?? REPO_ROOT;

  const parsed = parseZfightCliArgs(argv);
  if (parsed.help) {
    printZfightHelp(log);
    return { help: true, findingsCount: 0, findings: [] };
  }

  const houseSpecs = parsed.allExamples ? EXAMPLE_HOUSES : [parsed.house];
  const resolvedTargets = houseSpecs.map((spec) => ({
    spec,
    modulePath: resolveHouseModulePath(spec, { cwd, repoRoot }),
  }));

  const cleanupCanvas = installHeadlessCanvasStub();
  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: false,
    root: cwd,
    server: { middlewareMode: true, hmr: false, ws: false, fs: { allow: [cwd, repoRoot] } },
    logLevel: 'error',
    clearScreen: false,
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    ssr: { external: ['three', 'preact', '@preact/signals'] },
    server: { middlewareMode: true, hmr: false, watch: null },
    resolve: {
      dedupe: ['three', 'preact', '@preact/signals'],
      alias: [
        { find: /^husjs\/(.+)$/, replacement: join(repoRoot, 'src/husjs/$1.ts') },
        { find: /^husjs$/, replacement: join(repoRoot, 'src/husjs/index.ts') },
      ],
    },
  });

  try {
    const THREE = await import('three');
    const testingMod = await server.ssrLoadModule(join(repoRoot, 'src/husjs/testing.ts'));
    const viewerMod = await server.ssrLoadModule(join(repoRoot, 'src/husjs/viewer.ts'));
    const { detectZFighting } = testingMod;
    const { createPropertySceneLayers, buildPropertySceneContent, RoomLodController } = viewerMod;

    const results = [];
    for (const target of resolvedTargets) {
      const mod = await server.ssrLoadModule(target.modulePath);
      const { houseId, profile } = extractSceneProfileFromModule(mod, target.spec);

      const scene = new THREE.Scene();
      const layers = createPropertySceneLayers(scene);
      const lodController = new RoomLodController(profile.lodRegistrations);
      const registry = profile.createZoneRegistry();
      buildPropertySceneContent(layers, {
        profile,
        registry,
        lodController,
        ceilingCutaway: false,
      });

      const t0 = performance.now();
      const rawFindings = detectZFighting(scene, {
        epsilonM: parsed.epsilonM,
        minOverlapAreaM2: parsed.minOverlapAreaM2,
      });
      const elapsedMs = performance.now() - t0;
      const serialized = rawFindings.map(serializeFinding);
      results.push({
        house: houseId,
        findingsCount: serialized.length,
        findings: serialized,
        elapsedMs,
      });
    }

    const totalFindings = results.reduce((acc, r) => acc + r.findingsCount, 0);

    if (parsed.json) {
      if (parsed.allExamples) {
        log(
          JSON.stringify(
            {
              house: 'all-examples',
              findingsCount: totalFindings,
              houses: results.map(({ house, findingsCount, findings }) => ({
                house,
                findingsCount,
                findings,
              })),
              findings: results.flatMap((r) =>
                r.findings.map((f) => ({ house: r.house, ...f }))
              ),
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
              findingsCount: single.findingsCount,
              findings: single.findings,
            },
            null,
            2
          )
        );
      }
    } else {
      for (const r of results) {
        log(formatHumanReport(r.house, r.findings, r.elapsedMs));
      }
    }

    if (totalFindings > 0) {
      const summary = results
        .filter((r) => r.findingsCount > 0)
        .map((r) => `${r.house} (${r.findingsCount})`)
        .join(', ');
      throw new Error(`Detected ${totalFindings} coplanar z-fighting overlap(s) in ${summary}`);
    }

    return {
      help: false,
      findingsCount: 0,
      findings: [],
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
  runZfightCli().catch((err) => {
    console.error(`husjs-zfight error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
