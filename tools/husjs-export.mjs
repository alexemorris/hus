#!/usr/bin/env node
/**
 * `husjs export` — exports a Hus.js house to binary glTF (`.glb`) and, via headless Blender,
 * to a packed `.blend`.
 *
 * The house is opened in headless Chrome (Playwright when installed, otherwise a zero-dependency
 * DevTools-pipe client), exported in-page by `src/engine/export/glb-scene-exporter.ts`, and the
 * bytes are streamed back to Node in base64 slices.
 *
 * Usage:
 *   husjs export --house simple-house --out ./export --format both
 *   node tools/husjs-export.mjs --url http://localhost:5173/ --out ./house.glb
 */

import { spawn } from 'node:child_process';
import {
  accessSync,
  constants as fsConstants,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const LOG_PREFIX = '[husjs export]';
const EXPORT_FORMATS = ['glb', 'blend', 'both'];
const DEFAULT_HOUSE = 'simple-house';
const DEFAULT_TIMEOUT_MS = 120000;
const TRANSFER_SLICE_BYTES = 2 * 1024 * 1024;
const EXPORTER_MODULE_PATH = 'src/engine/export/glb-scene-exporter.ts';
const GLTF_EXPORTER_DEP = 'three/examples/jsm/exporters/GLTFExporter.js';
const GLB_MAGIC = 0x46546c67;

const CHROME_CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const MACOS_BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender';

const CHROME_ARGS = [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu-sandbox',
  '--enable-webgl',
  '--ignore-gpu-blocklist',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--mute-audio',
];

// ---------------------------------------------------------------------------
// CLI arguments & output paths
// ---------------------------------------------------------------------------

const VALUE_FLAGS = new Set(['house', 'url', 'out', 'format', 'blender-bin', 'chrome-bin', 'timeout']);

export function parseExportCliArgs(argv) {
  /** @type {Record<string, string>} */
  const flags = {};
  let help = false;
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

  const format = flags.format ?? 'glb';
  if (!EXPORT_FORMATS.includes(format)) {
    throw new Error(`Invalid --format '${format}' (expected one of: ${EXPORT_FORMATS.join(', ')})`);
  }
  const timeoutMs = flags.timeout !== undefined ? Number(flags.timeout) : DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`--timeout must be a positive number of milliseconds (got '${flags.timeout}')`);
  }
  for (const key of ['house', 'url', 'out', 'blender-bin', 'chrome-bin']) {
    if (flags[key] === '') {
      throw new Error(`Flag '--${key}' needs a non-empty value`);
    }
  }
  if (flags.url !== undefined && !isHttpUrl(flags.url)) {
    throw new Error(`--url must start with http:// or https:// (got '${flags.url}')`);
  }

  return {
    help: false,
    house: flags.house ?? DEFAULT_HOUSE,
    url: flags.url,
    out: flags.out ?? './export',
    format,
    blenderBin: flags['blender-bin'],
    chromeBin: flags['chrome-bin'],
    timeoutMs,
  };
}

export function printExportHelp(log = console.log) {
  log(`Usage: husjs export [options]

Exports a house to binary glTF (.glb) and, with Blender installed, to a packed .blend.

Options:
  --house <id-or-url>      House id, examples/<id> folder name, or http(s) URL (default: ${DEFAULT_HOUSE})
  --url <url>              Export from an already running page (overrides --house for the target)
  --out <dir-or-file>      Output directory, or a .glb / .blend file path (default: ./export)
  --format <glb|blend|both>  What to write (default: glb)
  --blender-bin <path>     Blender executable (default: $BLENDER_BIN, then 'blender' on PATH)
  --chrome-bin <path>      Chrome / Chromium executable (default: $CHROME_BIN, then auto-detected)
  --timeout <ms>           Time allowed for the house to load and export (default: ${DEFAULT_TIMEOUT_MS})
  --help, -h               Show this help message

Examples:
  husjs export --house simple-house --out ./export
  husjs export --house stahl-house --format both --out ./export/stahl.blend
  husjs export --url http://localhost:5173/ --format blend --blender-bin /opt/blender/blender`);
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

/** File-name-safe slug for a house id or URL. */
export function deriveHouseSlug(house) {
  let raw = house;
  if (isHttpUrl(house)) {
    try {
      const url = new URL(house);
      const segments = url.pathname.split('/').filter((s) => s && !/^index\.html?$/i.test(s));
      raw = url.searchParams.get('house') ?? segments.at(-1) ?? url.hostname;
    } catch {
      raw = 'house';
    }
  } else if (house === 'default') {
    raw = DEFAULT_HOUSE;
  }
  const slug = raw.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  return slug || 'house';
}

/**
 * Derives the `.glb` / `.blend` paths. An `out` ending in `.glb` or `.blend` names the files
 * directly (both share its base name); anything else is a directory holding `<houseSlug>.*`.
 */
export function resolveOutputPaths({ out, houseSlug, cwd = process.cwd() }) {
  const absOut = resolve(cwd, out);
  const fileMatch = /\.(glb|blend)$/i.exec(absOut);
  const basePath = fileMatch ? absOut.slice(0, -fileMatch[0].length) : join(absOut, houseSlug);
  return {
    outDir: dirname(basePath),
    glbPath: `${basePath}.glb`,
    blendPath: `${basePath}.blend`,
  };
}

// ---------------------------------------------------------------------------
// Executable discovery
// ---------------------------------------------------------------------------

function isExecutableFile(path) {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findOnPath(name, env) {
  const extensions = process.platform === 'win32' ? ['', '.exe', '.cmd'] : [''];
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    for (const ext of extensions) {
      const candidate = join(dir, name + ext);
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
}

function resolveExecutable(nameOrPath, env) {
  if (nameOrPath.includes('/') || nameOrPath.includes('\\')) {
    return isExecutableFile(nameOrPath) ? nameOrPath : null;
  }
  return findOnPath(nameOrPath, env);
}

/** Resolves `--blender-bin`, then `$BLENDER_BIN`, then `blender` on `PATH`. `null` when missing. */
export function findBlenderExecutable(explicitBin, env = process.env) {
  const requested = explicitBin ?? env.BLENDER_BIN;
  if (requested) return resolveExecutable(requested, env);
  return findOnPath('blender', env) ?? (isExecutableFile(MACOS_BLENDER) ? MACOS_BLENDER : null);
}

/** Resolves `--chrome-bin`, then `$CHROME_BIN`, then well-known install paths. `null` when missing. */
export function findChromeExecutable(explicitBin, env = process.env) {
  const requested = explicitBin ?? env.CHROME_BIN;
  if (requested) return resolveExecutable(requested, env);
  return CHROME_CANDIDATES.find(isExecutableFile) ?? null;
}

// ---------------------------------------------------------------------------
// Target URL & temporary Vite server
// ---------------------------------------------------------------------------

function withExportQueryParams(rawUrl, extraParams = {}) {
  const url = new URL(rawUrl);
  for (const [key, value] of Object.entries(extraParams)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set('husjsExport', '1');
  url.searchParams.set('forceWebGL', '1');
  return url.href;
}

/**
 * Resolves the page to export. http(s) targets are used directly; anything else is served by a
 * temporary Vite dev server rooted at `rootDir` (close it through the returned `close()`).
 *
 * @param {{ house: string, url?: string }} parsed
 * @param {{ rootDir?: string, createViteServer?: (config: object) => Promise<any> }} [options]
 * @returns {Promise<{ url: string, exporterModulePath: string, close: () => Promise<void> }>}
 */
export async function resolveHouseExportTarget(parsed, options = {}) {
  const directUrl = parsed.url ?? (isHttpUrl(parsed.house) ? parsed.house : undefined);
  if (directUrl !== undefined) {
    return {
      url: withExportQueryParams(directUrl),
      exporterModulePath: `/${EXPORTER_MODULE_PATH}`,
      close: async () => {},
    };
  }

  const rootDir = options.rootDir ?? process.cwd();
  const createViteServer = options.createViteServer ?? (await import('vite')).createServer;
  // An isolated dep cache keeps this short-lived server from disturbing a running dev server.
  const cacheDir = mkdtempSync(join(tmpdir(), 'husjs-export-vite-'));
  let server;
  try {
    server = await createViteServer({
      root: rootDir,
      cacheDir,
      logLevel: 'error',
      clearScreen: false,
      appType: 'mpa',
      server: { port: 0, host: '127.0.0.1', open: false, hmr: false, watch: null },
      // Pre-bundled up front: discovering it mid-export would make Vite reload the page.
      optimizeDeps: { include: [GLTF_EXPORTER_DEP] },
    });
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') {
      throw new Error('Temporary Vite server did not report a listening port');
    }

    const base = server.config?.base ?? '/';
    const origin = `http://127.0.0.1:${address.port}`;
    const { house } = parsed;
    let url;
    if (house === DEFAULT_HOUSE || house === 'default') {
      url = withExportQueryParams(`${origin}${base}`);
    } else if (
      /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(house) &&
      existsSync(join(rootDir, 'examples', house, 'index.html'))
    ) {
      url = withExportQueryParams(`${origin}${base}examples/${house}/index.html`);
    } else {
      url = withExportQueryParams(`${origin}${base}`, { house });
    }

    const viteServer = server;
    return {
      url,
      exporterModulePath: `${base}${EXPORTER_MODULE_PATH}`,
      close: async () => {
        try {
          await viteServer.close();
        } finally {
          rmSync(cacheDir, { recursive: true, force: true });
        }
      },
    };
  } catch (err) {
    await server?.close().catch(() => {});
    rmSync(cacheDir, { recursive: true, force: true });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Headless browser drivers (Playwright when installed, else Chrome DevTools pipe)
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function withDeadline(promise, deadline, what) {
  const remaining = deadline - Date.now();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Timed out while ${what}`)),
      Math.max(0, remaining)
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Removes a directory that exiting helper processes may still be writing into: Chrome's GPU and
 * utility processes outlive the browser process briefly, so a single removal can fail or be undone.
 */
async function removeDirWithRetries(dir, attempts = 20, delayMs = 150) {
  for (let attempt = 1; ; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      if (attempt >= attempts) throw err;
    }
    await sleep(delayMs);
    if (!existsSync(dir)) return;
    if (attempt >= attempts) {
      throw new Error(`Could not remove temporary directory ${dir}`);
    }
  }
}

/** NUL-delimited JSON DevTools protocol client over Chrome's `--remote-debugging-pipe` fds 3/4. */
function createPipeCdpConnection(child) {
  const writer = child.stdio[3];
  const reader = child.stdio[4];
  let nextId = 1;
  let closedError = null;
  /** @type {Map<number, { resolve: (value: any) => void, reject: (err: Error) => void }>} */
  const pending = new Map();
  /** @type {Set<(message: any) => void>} */
  const eventListeners = new Set();
  /** @type {Buffer[]} */
  let partial = [];

  const fail = (err) => {
    if (closedError) return;
    closedError = err;
    for (const { reject } of pending.values()) reject(err);
    pending.clear();
  };

  const dispatch = (message) => {
    if (message.id !== undefined) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) {
        entry.reject(new Error(message.error.message ?? 'DevTools protocol error'));
      } else {
        entry.resolve(message.result);
      }
      return;
    }
    for (const listener of eventListeners) listener(message);
  };

  reader.on('data', (chunk) => {
    let start = 0;
    let end;
    while ((end = chunk.indexOf(0, start)) !== -1) {
      partial.push(chunk.subarray(start, end));
      const text = Buffer.concat(partial).toString('utf8');
      partial = [];
      start = end + 1;
      try {
        dispatch(JSON.parse(text));
      } catch (err) {
        fail(new Error(`Malformed DevTools message: ${err instanceof Error ? err.message : err}`));
      }
    }
    if (start < chunk.length) partial.push(chunk.subarray(start));
  });
  reader.on('close', () => fail(new Error('Chrome closed the DevTools pipe')));
  reader.on('error', (err) => fail(err));
  writer.on('error', (err) => fail(err));
  child.on('error', (err) => fail(new Error(`Failed to launch Chrome: ${err.message}`)));
  child.on('exit', (code, signal) =>
    fail(new Error(`Chrome exited unexpectedly (code ${code}, signal ${signal})`))
  );

  return {
    onEvent: (listener) => eventListeners.add(listener),
    send(method, params = {}, sessionId) {
      if (closedError) return Promise.reject(closedError);
      const id = nextId++;
      const promise = new Promise((resolvePromise, reject) => {
        pending.set(id, { resolve: resolvePromise, reject });
      });
      writer.write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
      return promise;
    },
  };
}

/**
 * @typedef {{
 *   navigate(url: string): Promise<void>,
 *   evaluate(expression: string): Promise<any>,
 *   pageErrors(): string[],
 *   close(): Promise<void>,
 * }} PageDriver
 */

/** @returns {Promise<PageDriver>} */
async function launchChromePipeDriver(chromeBin, deadline) {
  const profileDir = mkdtempSync(join(tmpdir(), 'husjs-export-chrome-'));
  const child = spawn(
    chromeBin,
    [...CHROME_ARGS, `--user-data-dir=${profileDir}`, '--remote-debugging-pipe', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] }
  );
  let stderrTail = '';
  child.stdio[2].on('data', (chunk) => {
    stderrTail = (stderrTail + chunk.toString('utf8')).slice(-2000);
  });

  /** @type {string[]} */
  const errors = [];
  const hasExited = () => child.exitCode !== null || child.signalCode !== null;
  const close = async () => {
    if (!hasExited()) {
      const exited = new Promise((r) => child.once('exit', r));
      child.kill();
      await Promise.race([exited, sleep(3000)]);
      if (!hasExited()) {
        child.kill('SIGKILL');
        await Promise.race([exited, sleep(2000)]);
      }
    }
    await removeDirWithRetries(profileDir);
  };

  try {
    const cdp = createPipeCdpConnection(child);
    const { targetInfos } = await withDeadline(
      cdp.send('Target.getTargets'),
      deadline,
      'connecting to Chrome'
    );
    const targetId =
      targetInfos.find((t) => t.type === 'page')?.targetId ??
      (await cdp.send('Target.createTarget', { url: 'about:blank' })).targetId;
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

    cdp.onEvent((message) => {
      if (message.sessionId !== sessionId || message.method !== 'Runtime.exceptionThrown') return;
      const details = message.params?.exceptionDetails;
      errors.push(String(details?.exception?.description ?? details?.text ?? 'Unknown page error'));
      if (errors.length > 5) errors.shift();
    });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);

    return {
      async navigate(url) {
        const result = await cdp.send('Page.navigate', { url }, sessionId);
        if (result.errorText) {
          throw new Error(`Failed to open ${url}: ${result.errorText}`);
        }
      },
      async evaluate(expression) {
        const { result, exceptionDetails } = await cdp.send(
          'Runtime.evaluate',
          { expression, awaitPromise: true, returnByValue: true },
          sessionId
        );
        if (exceptionDetails) {
          throw new Error(
            String(exceptionDetails.exception?.description ?? exceptionDetails.text)
          );
        }
        return result.value;
      },
      pageErrors: () => errors.slice(),
      close,
    };
  } catch (err) {
    await close();
    if (err instanceof Error && stderrTail.trim()) {
      err.message += `\nChrome stderr (tail):\n${stderrTail.trim()}`;
    }
    throw err;
  }
}

/** @returns {Promise<PageDriver | null>} `null` when Playwright is not installed. */
async function launchPlaywrightDriver(chromeBin) {
  let playwright;
  try {
    const specifier = 'playwright';
    playwright = await import(specifier);
  } catch {
    return null;
  }
  const chromium = playwright.chromium ?? playwright.default?.chromium;
  if (!chromium) return null;

  const browser = await chromium.launch({
    headless: true,
    args: CHROME_ARGS.filter((arg) => !arg.startsWith('--headless')),
    ...(chromeBin ? { executablePath: chromeBin } : {}),
  });
  try {
    const page = await browser.newPage();
    /** @type {string[]} */
    const errors = [];
    page.on('pageerror', (err) => {
      errors.push(String(err?.stack ?? err));
      if (errors.length > 5) errors.shift();
    });
    return {
      navigate: async (url) => {
        await page.goto(url, { waitUntil: 'commit' });
      },
      evaluate: (expression) => page.evaluate(expression),
      pageErrors: () => errors.slice(),
      close: () => browser.close(),
    };
  } catch (err) {
    await browser.close();
    throw err;
  }
}

// ---------------------------------------------------------------------------
// In-page export & chunked transfer
// ---------------------------------------------------------------------------

const PAGE_READY_EXPRESSION = `(() => {
  const viewer = window.__HUSJS_MOUNTED__?.scene || (window.__HUSJS_MOUNTED__?.scene ?? window.husTwin?.scene);
  if (!viewer) return false;
  const loading = document.getElementById('loading-screen');
  return !loading || loading.classList.contains('is-done');
})()`;

function buildPageExportExpression(exporterModulePath, maxTextureSize) {
  const options = maxTextureSize ? { maxTextureSize } : {};
  return `(async () => {
  const viewer = window.__HUSJS_MOUNTED__?.scene ?? (window.__HUSJS_MOUNTED__?.scene ?? window.husTwin?.scene);
  const result =
    typeof window.__HUSJS_EXPORT_GLB__ === 'function'
      ? await window.__HUSJS_EXPORT_GLB__(${JSON.stringify(options)})
      : await import(${JSON.stringify(exporterModulePath)}).then((m) =>
          m.exportPropertySceneToGlb(viewer, ${JSON.stringify(options)})
        );
  const raw = result instanceof Uint8Array || result instanceof ArrayBuffer ? result : result.glbBytes;
  const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw;
  if (!(bytes instanceof Uint8Array)) throw new Error('In-page export did not return .glb bytes');
  window.__husjsLastGlbBytes = bytes;
  return {
    byteLength: bytes.byteLength,
    meshCount: result.meshCount ?? null,
    materialCount: result.materialCount ?? null,
    convertedBumpMaps: result.convertedBumpMaps ?? null,
    cameraPresets: Array.isArray(result.cameraPresets) ? result.cameraPresets : [],
  };
})()`;
}

function buildPageSliceExpression(offset, length) {
  return `(() => {
  const slice = window.__husjsLastGlbBytes.subarray(${offset}, ${offset + length});
  let binary = '';
  for (let i = 0; i < slice.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, slice.subarray(i, i + 0x8000));
  }
  return btoa(binary);
})()`;
}

function assertValidGlb(bytes) {
  if (bytes.byteLength < 20 || bytes.readUInt32LE(0) !== GLB_MAGIC || bytes.readUInt32LE(4) !== 2) {
    throw new Error('Exported data is not a binary glTF 2.0 (.glb) file');
  }
  if (bytes.readUInt32LE(8) !== bytes.byteLength) {
    throw new Error(
      `Exported .glb is truncated (header says ${bytes.readUInt32LE(8)} bytes, received ${bytes.byteLength})`
    );
  }
}

async function waitForHouseMounted(driver, url, deadline, timeoutMs) {
  for (;;) {
    let ready = false;
    try {
      ready = (await withDeadline(driver.evaluate(PAGE_READY_EXPRESSION), deadline, 'polling the page')) === true;
    } catch (err) {
      if (Date.now() >= deadline) ready = false;
      else if (!isNavigationRace(err)) throw err;
    }
    if (ready) return;
    if (Date.now() >= deadline) {
      const errors = driver.pageErrors();
      throw new Error(
        `Timed out after ${timeoutMs} ms waiting for the house to finish loading at ${url}` +
          (errors.length > 0 ? `\nPage errors:\n  ${errors.join('\n  ')}` : '')
      );
    }
    await sleep(250);
  }
}

/** Errors raised when the page navigated or reloaded underneath an evaluation. */
function isNavigationRace(err) {
  const message = err instanceof Error ? err.message : String(err);
  return /context was destroyed|Cannot find context|navigat|Inspected target/i.test(message);
}

/**
 * Opens `url` in a headless browser, runs the in-page exporter and returns the `.glb` bytes.
 *
 * @param {{
 *   url: string,
 *   exporterModulePath?: string,
 *   chromeBin?: string,
 *   timeoutMs?: number,
 *   maxTextureSize?: number,
 *   env?: NodeJS.ProcessEnv,
 *   log?: (message: string) => void,
 * }} options
 */
export async function exportGlbViaBrowser(options) {
  const {
    url,
    exporterModulePath = `/${EXPORTER_MODULE_PATH}`,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    env = process.env,
    log = () => {},
  } = options;
  const deadline = Date.now() + timeoutMs;
  const chromeBin = findChromeExecutable(options.chromeBin, env);
  if (options.chromeBin && !chromeBin) {
    throw new Error(`Chrome executable not found at '${options.chromeBin}'`);
  }

  let driver = await launchPlaywrightDriver(chromeBin);
  if (!driver) {
    if (!chromeBin) {
      throw new Error(
        'No Chrome / Chromium executable found (pass --chrome-bin <path>, set CHROME_BIN, or install Playwright).'
      );
    }
    driver = await launchChromePipeDriver(chromeBin, deadline);
  }

  try {
    log(`${LOG_PREFIX} Opening ${url}`);
    await withDeadline(driver.navigate(url), deadline, `opening ${url}`);

    const exportExpression = buildPageExportExpression(exporterModulePath, options.maxTextureSize);
    let meta;
    for (let attempt = 1; ; attempt++) {
      await waitForHouseMounted(driver, url, deadline, timeoutMs);
      log(`${LOG_PREFIX} House loaded; exporting scene to glTF...`);
      try {
        meta = await withDeadline(
          driver.evaluate(exportExpression),
          deadline,
          `exporting the scene (--timeout ${timeoutMs} ms)`
        );
        break;
      } catch (err) {
        // A dev server may reload the page once while it optimises a newly discovered dependency.
        if (attempt >= 2 || !isNavigationRace(err)) throw err;
        log(`${LOG_PREFIX} Page reloaded during export; retrying once...`);
      }
    }

    const glbBytes = Buffer.alloc(meta.byteLength);
    for (let offset = 0; offset < meta.byteLength; offset += TRANSFER_SLICE_BYTES) {
      const length = Math.min(TRANSFER_SLICE_BYTES, meta.byteLength - offset);
      const base64 = await withDeadline(
        driver.evaluate(buildPageSliceExpression(offset, length)),
        deadline,
        'transferring the .glb from the browser'
      );
      const written = glbBytes.write(base64, offset, 'base64');
      if (written !== length) {
        throw new Error(`Corrupt .glb slice at offset ${offset} (expected ${length} bytes, got ${written})`);
      }
    }
    await driver.evaluate('delete window.__husjsLastGlbBytes').catch(() => {});
    assertValidGlb(glbBytes);

    return {
      glbBytes,
      meshCount: meta.meshCount,
      materialCount: meta.materialCount,
      convertedBumpMaps: meta.convertedBumpMaps,
      cameraPresets: meta.cameraPresets,
    };
  } finally {
    await driver.close().catch((err) => {
      log(`${LOG_PREFIX} Warning: browser cleanup failed: ${err instanceof Error ? err.message : err}`);
    });
  }
}

// ---------------------------------------------------------------------------
// Headless Blender `.glb` -> `.blend`
// ---------------------------------------------------------------------------

/** Blender Python script run as `blender --background --factory-startup --python <script> -- ...`. */
export function buildBlenderConversionScript() {
  return `"""Converts a Hus.js .glb export into a packed, presentation-ready .blend."""
import json
import math
import sys
import traceback

import bpy
from mathutils import Vector


def parse_args(argv):
    args = argv[argv.index("--") + 1:] if "--" in argv else []
    parsed = {"glb": None, "blend": None, "cameras-json": None}
    i = 0
    while i < len(args):
        key = args[i][2:] if args[i].startswith("--") else None
        if key not in parsed or i + 1 >= len(args):
            raise SystemExit("Unexpected argument: " + args[i])
        parsed[key] = args[i + 1]
        i += 2
    if not parsed["glb"] or not parsed["blend"]:
        raise SystemExit("Usage: -- --glb <in.glb> --blend <out.blend> [--cameras-json <cameras.json>]")
    return parsed


def three_to_blender(xyz):
    """three.js Y-up (x, y, z) -> Blender Z-up (x, -z, y)."""
    return Vector((xyz[0], -xyz[2], xyz[1]))


def hide_empties():
    for obj in bpy.data.objects:
        if obj.type == 'EMPTY':
            obj.empty_display_size = 0.02
            obj.hide_viewport = True


def configure_viewports():
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type != 'VIEW_3D':
                continue
            for space in area.spaces:
                if space.type != 'VIEW_3D':
                    continue
                overlay = space.overlay
                if hasattr(overlay, "show_relationship_lines"):
                    overlay.show_relationship_lines = False
                if hasattr(overlay, "show_extras"):
                    overlay.show_extras = False
                if hasattr(overlay, "show_object_origins"):
                    overlay.show_object_origins = False
                space.shading.type = 'MATERIAL'


def configure_color_management(scene):
    view_settings = scene.view_settings
    for view_transform in ('AgX', 'Filmic', 'Standard'):
        try:
            view_settings.view_transform = view_transform
            break
        except TypeError:
            continue
    try:
        view_settings.look = 'None'
    except TypeError:
        pass


def add_preset_cameras(scene, cameras_json_path):
    if not cameras_json_path:
        return
    with open(cameras_json_path, "r", encoding="utf-8") as handle:
        presets = json.load(handle)

    created = []
    for preset in presets:
        name = "Cam_" + str(preset["id"])
        camera_data = bpy.data.cameras.new(name)
        fov_deg = preset.get("fovDeg")
        if fov_deg:
            camera_data.sensor_fit = 'VERTICAL'
            camera_data.angle_y = math.radians(fov_deg)
        camera = bpy.data.objects.new(name, camera_data)
        scene.collection.objects.link(camera)

        location = three_to_blender(preset["position"])
        direction = three_to_blender(preset["target"]) - location
        camera.location = location
        if direction.length > 1e-6:
            camera.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
        created.append(camera)

    if created:
        scene.camera = next((c for c in created if c.name == "Cam_overview"), created[0])


def main():
    args = parse_args(sys.argv)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=args["glb"])
    scene = bpy.context.scene

    bpy.ops.file.pack_all()
    hide_empties()
    configure_viewports()
    configure_color_management(scene)
    add_preset_cameras(scene, args["cameras-json"])

    bpy.ops.wm.save_as_mainfile(filepath=args["blend"], compress=True)
    print("[husjs export] Saved " + args["blend"])


try:
    main()
except SystemExit:
    raise
except Exception:
    traceback.print_exc()
    sys.exit(1)
`;
}

/**
 * Runs headless Blender to turn `glbPath` into `blendPath`. Rejects when Blender fails or does
 * not produce the file.
 *
 * @param {{
 *   glbPath: string,
 *   blendPath: string,
 *   blenderBin: string,
 *   cameraPresets?: readonly object[],
 * }} options
 */
export async function convertGlbToBlend({ glbPath, blendPath, blenderBin, cameraPresets = [] }) {
  const workDir = mkdtempSync(join(tmpdir(), 'husjs-export-blender-'));
  try {
    const scriptPath = join(workDir, 'glb-to-blend.py');
    const camerasJsonPath = join(workDir, 'cameras.json');
    writeFileSync(scriptPath, buildBlenderConversionScript(), 'utf8');
    writeFileSync(camerasJsonPath, JSON.stringify(cameraPresets), 'utf8');
    mkdirSync(dirname(blendPath), { recursive: true });
    rmSync(blendPath, { force: true });

    const args = [
      '--background',
      '--factory-startup',
      '--python',
      scriptPath,
      '--',
      '--glb',
      glbPath,
      '--blend',
      blendPath,
      '--cameras-json',
      camerasJsonPath,
    ];
    const { code, signal, outputTail } = await new Promise((resolvePromise, reject) => {
      const child = spawn(blenderBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let tail = '';
      const collect = (chunk) => {
        tail = (tail + chunk.toString('utf8')).slice(-4000);
      };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      child.on('error', reject);
      child.on('close', (exitCode, exitSignal) =>
        resolvePromise({ code: exitCode, signal: exitSignal, outputTail: tail })
      );
    });

    if (code !== 0 || !existsSync(blendPath)) {
      const reason = code !== 0 ? `exited with code ${code ?? `signal ${signal}`}` : 'did not write the .blend file';
      throw new Error(`Blender ${reason}.\nBlender output (tail):\n${outputTail.trim()}`);
    }
    return blendPath;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

/**
 * Runs `husjs export`. Rejects on invalid flags or export failures (callers map that to exit 1).
 * A missing Blender is not an error: the `.glb` is kept and `blenderSkipped` is set.
 *
 * @param {string[]} [argv]
 * @param {{
 *   log?: (message: string) => void,
 *   env?: NodeJS.ProcessEnv,
 *   cwd?: string,
 *   resolveHouseExportTarget?: typeof resolveHouseExportTarget,
 *   exportGlbViaBrowser?: typeof exportGlbViaBrowser,
 *   convertGlbToBlend?: typeof convertGlbToBlend,
 * }} [io]
 */
export async function runExportCli(argv = process.argv.slice(2), io = {}) {
  const log = io.log ?? console.log;
  const env = io.env ?? process.env;
  const cwd = io.cwd ?? process.cwd();
  const resolveTarget = io.resolveHouseExportTarget ?? resolveHouseExportTarget;
  const exportGlb = io.exportGlbViaBrowser ?? exportGlbViaBrowser;
  const convert = io.convertGlbToBlend ?? convertGlbToBlend;

  const parsed = parseExportCliArgs(argv);
  if (parsed.help) {
    printExportHelp(log);
    return { help: true };
  }

  const { outDir, glbPath, blendPath } = resolveOutputPaths({
    out: parsed.out,
    houseSlug: deriveHouseSlug(parsed.house),
    cwd,
  });
  const wantsBlend = parsed.format !== 'glb';
  const blenderBin = wantsBlend ? findBlenderExecutable(parsed.blenderBin, env) : null;

  const target = await resolveTarget(parsed, { rootDir: cwd });
  let exported;
  try {
    exported = await exportGlb({
      url: target.url,
      exporterModulePath: target.exporterModulePath,
      chromeBin: parsed.chromeBin,
      timeoutMs: parsed.timeoutMs,
      env,
      log,
    });
  } finally {
    await target.close();
  }

  // A blend-only run keeps its intermediate .glb out of the output folder unless it is needed.
  const glbIsIntermediate = parsed.format === 'blend' && blenderBin !== null;
  const scratchDir = glbIsIntermediate ? mkdtempSync(join(tmpdir(), 'husjs-export-glb-')) : null;
  const writtenGlbPath = scratchDir ? join(scratchDir, 'scene.glb') : glbPath;
  try {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(writtenGlbPath, exported.glbBytes);
    const stats = {
      meshCount: exported.meshCount,
      materialCount: exported.materialCount,
      convertedBumpMaps: exported.convertedBumpMaps,
    };
    const sizeMb = (exported.glbBytes.byteLength / (1024 * 1024)).toFixed(1);
    const summary = `${sizeMb} MB, ${exported.meshCount ?? '?'} meshes, ${exported.materialCount ?? '?'} materials`;
    if (!glbIsIntermediate) {
      log(`${LOG_PREFIX} Wrote ${glbPath} (${summary})`);
    }

    if (!wantsBlend) {
      return { glbPath, blendPath: null, blenderSkipped: false, ...stats };
    }
    if (!blenderBin) {
      const where = parsed.blenderBin ?? env.BLENDER_BIN;
      log(
        `${LOG_PREFIX} Blender executable not found ${where ? `at '${where}'` : 'on PATH'} ` +
          `(pass --blender-bin <path> or install Blender 4.x). ` +
          `Skipping .blend conversion; .glb export is ready at ${glbPath}.`
      );
      return { glbPath, blendPath: null, blenderSkipped: true, ...stats };
    }

    log(`${LOG_PREFIX} Converting to .blend with ${blenderBin}...`);
    try {
      await convert({
        glbPath: writtenGlbPath,
        blendPath,
        blenderBin,
        cameraPresets: exported.cameraPresets ?? [],
      });
    } catch (err) {
      if (glbIsIntermediate) {
        copyFileSync(writtenGlbPath, glbPath);
        log(`${LOG_PREFIX} Blender conversion failed; kept the .glb export at ${glbPath}.`);
      }
      throw err;
    }
    log(`${LOG_PREFIX} Wrote ${blendPath}${glbIsIntermediate ? ` (${summary})` : ''}`);
    return {
      glbPath: glbIsIntermediate ? null : glbPath,
      blendPath,
      blenderSkipped: false,
      ...stats,
    };
  } finally {
    if (scratchDir) rmSync(scratchDir, { recursive: true, force: true });
  }
}

const isMain =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  runExportCli().catch((err) => {
    console.error(`husjs-export error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
