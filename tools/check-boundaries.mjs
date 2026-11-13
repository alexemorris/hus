#!/usr/bin/env node
// Zero-dependency layer boundary checker for src/.
//
// Dependency rule (husjs layered architecture):
//   core → (nothing)            engine → core           objects → engine, core
//   integrations → core         state → core
//   ui → core, state (src/ui/dev/** may also import engine + integrations for dev tools)
//   husjs → core, engine, objects, integrations, state, ui
//   homes → husjs ( ONLY via public 'husjs' / 'husjs/*' entrypoints — 0 deep imports!)
//   app, main.ts → husjs, homes ( ONLY via public 'husjs' / 'husjs/*' entrypoints + homes)
// core and state must not import three.js. Same-layer imports are always allowed.
//
// Usage: node tools/check-boundaries.mjs [--json] [--no-baseline]
// Exits 1 when any violation outside the baseline is found.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCliFlags } from './cli-args.mjs';

const BOUNDARIES_CLI_OPTIONS = {
  json: { type: 'boolean' },
  'no-baseline': { type: 'boolean' },
};

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const EXAMPLES = join(ROOT, 'examples');

/** @type {Record<string, readonly string[] | '*'>} */
export const ALLOWED = {
  core: [],
  engine: ['core'],
  objects: ['engine', 'core'],
  integrations: ['core'],
  state: ['core'],
  ui: ['core', 'state'],
  husjs: ['core', 'engine', 'objects', 'integrations', 'state', 'ui'],
  homes: ['husjs'],
  examples: ['husjs'],
  app: ['husjs', 'homes', 'examples'],
};

/** Exact public entrypoint files allowed when importing into `src/husjs/`. */
export const PUBLIC_HUSJS_ENTRYPOINTS = new Set([
  'src/husjs/index.ts',
  'src/husjs/viewer.ts',
  'src/husjs/materials.ts',
  'src/husjs/objects.ts',
  'src/husjs/audio.ts',
  'src/husjs/knx.ts',
  'src/husjs/unifi.ts',
  'src/husjs/ui.ts',
  'src/husjs/testing.ts',
  'src/husjs/vite.ts',
  'src/husjs/catalog/appliances.ts',
  'src/husjs/catalog/architectural.ts',
  'src/husjs/catalog/bathroom.ts',
  'src/husjs/catalog/devices.ts',
  'src/husjs/catalog/electrical.ts',
  'src/husjs/catalog/electronics.ts',
  'src/husjs/catalog/furniture.ts',
  'src/husjs/catalog/garden.ts',
  'src/husjs/catalog/hardware.ts',
  'src/husjs/catalog/homewares.ts',
  'src/husjs/catalog/joinery.ts',
  'src/husjs/catalog/kitchen.ts',
  'src/husjs/catalog/lighting.ts',
  'src/husjs/catalog/radiators.ts',
  'src/husjs/catalog/sanitaryware.ts',
  'src/husjs/catalog/soft-furnishings.ts',
  'src/husjs/catalog/vehicles.ts',
]);

/** Bare packages forbidden per layer (pure layers must stay renderer-agnostic). */
const FORBIDDEN_PACKAGES = {
  core: ['three', 'preact', '@preact/signals'],
  state: ['three'],
};

const HOUSE_SPECIFIC_FORBIDDEN_ZONE_IDS = [
  'familyRoom',
  'bootLobby',
  'livingRoom',
  'entranceHall',
  'sittingRoom',
  'mainBedroom',
  'familyBathroom',
  'upperLanding',
  'bedroom2',
  'bedroom3',
  'bedroom4',
  'courtyard',
  'diningRoom',
  'masterBedroom',
  'annexLiving',
  'annexBedroom',
  'outbuildingGym',
  'outbuildingGarage',
  'outbuildingStore',
  'outbuildingBarn',
  'outbuildingMezzanine',
  'outbuildingStableOffice',
  'outbuildingStableSuite',
];
const HOUSE_SPECIFIC_ZONE_LITERAL_RE = new RegExp(
  '[`\'"\\b](' + HOUSE_SPECIFIC_FORBIDDEN_ZONE_IDS.join('|') + ')(?:\\.[^`\'"]*)?[`\'"]',
  'g'
);

const BASELINE_PATH = join(ROOT, 'tools', 'boundaries-baseline.json');

const UI_DEV_PREFIX = 'src/ui/dev/';
const UI_DEV_EXTRA = ['engine', 'integrations'];

function toPosix(p) {
  return p.split(sep).join('/');
}

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx|mts)$/.test(name) && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Layer of a repo-relative posix path under src/, or null when outside src/. */
export function layerOf(relPath) {
  if (relPath.startsWith('examples/')) {
    return 'examples';
  }
  if (!relPath.startsWith('src/')) {
    return null;
  }
  const rest = relPath.slice('src/'.length);
  if (!rest.includes('/')) {
    return 'app'; // src/main.ts and other root entry files are composition-root code
  }
  return rest.slice(0, rest.indexOf('/'));
}

/** Resolves `'husjs'` / `'husjs/*'` alias specifiers to repo-relative `src/husjs/*.ts` paths. */
export function resolveHusjsAlias(spec) {
  if (spec === 'husjs') {
    return 'src/husjs/index.ts';
  }
  if (spec.startsWith('husjs/')) {
    const sub = spec.slice('husjs/'.length).replace(/\.ts$/, '');
    return `src/husjs/${sub}.ts`;
  }
  return null;
}

/** Blanks out comments while preserving line numbers and string contents. */
function stripComments(text) {
  let out = '';
  let i = 0;
  let quote = '';
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (quote) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i += 2;
        continue;
      }
      if (ch === quote) {
        quote = '';
      }
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') {
        i += 1;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        out += text[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
    }
    out += ch;
    i += 1;
  }
  return out;
}

const STATIC_RE =
  /(^|[\n;{}])\s*(import|export)\s+(type\s+)?([^;'"`]*?)\s*from\s*['"]([^'"\n]+)['"]/g;
const SIDE_EFFECT_RE = /(^|[\n;{}])\s*import\s*['"]([^'"\n]+)['"]/g;
const DYNAMIC_RE = /\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/g;

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
    }
  }
  return line;
}

/** Index of the `import`/`export` keyword in a statement match (skips the leading separator). */
function keywordIndex(m) {
  const afterSep = m[0].slice(m[1].length);
  return m.index + m[1].length + afterSep.search(/\S/);
}

/** True when every named specifier in `{ ... }` is marked `type`. */
function allSpecifiersTypeOnly(clause) {
  const m = /^\{([\s\S]*)\}$/.exec(clause.trim());
  if (!m) {
    return false;
  }
  const parts = m[1].split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((s) => s.startsWith('type '));
}

export function parseImports(text) {
  const code = stripComments(text);
  /** @type {{ spec: string, typeOnly: boolean, line: number }[]} */
  const found = [];
  for (const m of code.matchAll(STATIC_RE)) {
    const typeOnly = Boolean(m[3]) || allSpecifiersTypeOnly(m[4]);
    found.push({ spec: m[5], typeOnly, line: lineAt(code, keywordIndex(m)) });
  }
  for (const m of code.matchAll(SIDE_EFFECT_RE)) {
    found.push({ spec: m[2], typeOnly: false, line: lineAt(code, keywordIndex(m)) });
  }
  for (const m of code.matchAll(DYNAMIC_RE)) {
    found.push({ spec: m[1], typeOnly: false, line: lineAt(code, m.index) });
  }
  return found;
}

function bareName(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

export function checkSourceImports(file, rawSource) {
  /** @type {{ file: string, line: number, from: string, to: string, spec: string, reason: string }[]} */
  const violations = [];
  const fromLayer = layerOf(file);
  if (!fromLayer) {
    return violations;
  }
  const absDir = dirname(join(ROOT, file));

  if ((fromLayer === 'objects' || fromLayer === 'engine') && !/\.test\.(ts|tsx|mts)$/.test(file)) {
    const stripped = stripComments(rawSource);
    for (const m of stripped.matchAll(HOUSE_SPECIFIC_ZONE_LITERAL_RE)) {
      violations.push({
        file,
        line: lineAt(stripped, m.index),
        from: fromLayer,
        to: 'homes',
        spec: m[0],
        reason: `${fromLayer} file references house-specific zone ID ${m[0]}`,
      });
    }
  }

  for (const imp of parseImports(rawSource)) {
    const aliasTarget = resolveHusjsAlias(imp.spec);
    if (!imp.spec.startsWith('.') && !imp.spec.startsWith('/') && !aliasTarget) {
      const pkg = bareName(imp.spec);
      const banned = FORBIDDEN_PACKAGES[fromLayer] ?? [];
      if (banned.includes(pkg) && !imp.typeOnly) {
        violations.push({
          file,
          line: imp.line,
          from: fromLayer,
          to: pkg,
          spec: imp.spec,
          reason: `${fromLayer} must not import '${pkg}'`,
        });
      }
      continue;
    }

    const target = aliasTarget ?? toPosix(relative(ROOT, resolve(absDir, imp.spec)));
    const toLayer = layerOf(target);
    if (!toLayer) {
      continue;
    }

    // Enforce public husjs entrypoint surface for any external consumer of `husjs`.
    if (toLayer === 'husjs' && fromLayer !== 'husjs') {
      if (!aliasTarget) {
        violations.push({
          file,
          line: imp.line,
          from: fromLayer,
          to: toLayer,
          spec: imp.spec,
          reason: `${fromLayer} must import husjs via 'husjs' or 'husjs/*' package specifiers, not relative path '${imp.spec}'`,
        });
        continue;
      }
      if (!PUBLIC_HUSJS_ENTRYPOINTS.has(target)) {
        violations.push({
          file,
          line: imp.line,
          from: fromLayer,
          to: toLayer,
          spec: imp.spec,
          reason: `'${imp.spec}' (${target}) is not a public husjs entrypoint`,
        });
        continue;
      }
    }

    if (toLayer === fromLayer) {
      continue;
    }

    const allowed = ALLOWED[fromLayer];
    if (allowed === undefined) {
      violations.push({
        file,
        line: imp.line,
        from: fromLayer,
        to: toLayer,
        spec: imp.spec,
        reason: `unknown layer '${fromLayer}' (add it to tools/check-boundaries.mjs)`,
      });
      continue;
    }
    if (allowed === '*' || allowed.includes(toLayer)) {
      continue;
    }
    if (fromLayer === 'ui' && file.startsWith(UI_DEV_PREFIX) && UI_DEV_EXTRA.includes(toLayer)) {
      continue;
    }

    violations.push({
      file,
      line: imp.line,
      from: fromLayer,
      to: toLayer,
      spec: imp.spec,
      reason: `${fromLayer} → ${toLayer} is not allowed`,
    });
  }
  return violations;
}

export function checkBoundaries() {
  /** @type {{ file: string, line: number, from: string, to: string, spec: string, reason: string }[]} */
  const violations = [];
  const dirsToScan = [SRC];
  try {
    if (statSync(EXAMPLES).isDirectory()) dirsToScan.push(EXAMPLES);
  } catch {
    // examples/ directory is optional
  }
  const files = [];
  for (const d of dirsToScan) walk(d, files);
  for (const abs of files) {
    const file = toPosix(relative(ROOT, abs));
    const rawSource = readFileSync(abs, 'utf8');
    violations.push(...checkSourceImports(file, rawSource));
  }
  return violations;
}

/** @returns {{ file: string, spec: string, reason?: string }[]} */
function loadBaseline() {
  try {
    const parsed = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    return Array.isArray(parsed.violations) ? parsed.violations : [];
  } catch {
    return [];
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { values } = parseCliFlags(process.argv.slice(2), BOUNDARIES_CLI_OPTIONS);
  if (values.help) {
    console.log('Usage: node tools/check-boundaries.mjs [--json] [--no-baseline]');
    process.exit(0);
  }
  const all = checkBoundaries();
  const baseline = values['no-baseline'] ? [] : loadBaseline();
  const key = (v) => `${v.file}|${v.spec}`;
  const baselineKeys = new Set(baseline.map(key));
  const known = all.filter((v) => baselineKeys.has(key(v)));
  const violations = all.filter((v) => !baselineKeys.has(key(v)));
  const liveKeys = new Set(all.map(key));
  const stale = baseline.filter((b) => !liveKeys.has(key(b)));

  if (values.json) {
    console.log(JSON.stringify({ violations, known, stale }, null, 2));
  } else {
    for (const v of known) {
      console.log(`known  ${v.file}:${v.line}  ${v.reason}  [${v.spec}]`);
    }
    for (const b of stale) {
      console.log(`stale  ${b.file}  [${b.spec}] is fixed: remove it from tools/boundaries-baseline.json`);
    }
    for (const v of violations) {
      console.log(`${v.file}:${v.line}  ${v.reason}  [${v.spec}]`);
    }
    console.log(
      violations.length === 0
        ? `check-boundaries: OK (${known.length} known baseline violation(s))`
        : `\ncheck-boundaries: ${violations.length} violation(s) (+${known.length} known in baseline)`
    );
  }
  process.exit(violations.length === 0 ? 0 : 1);
}
