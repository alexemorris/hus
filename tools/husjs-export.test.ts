import { execFileSync, spawnSync } from 'node:child_process';
import {
  accessSync,
  chmodSync,
  constants as fsConstants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dispatchHusjsCli } from '../bin/husjs.mjs';
import {
  buildBlenderConversionScript,
  convertGlbToBlend,
  deriveHouseSlug,
  findBlenderExecutable,
  parseExportCliArgs,
  resolveHouseExportTarget,
  resolveOutputPaths,
  runExportCli,
} from './husjs-export.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HUSJS_BIN = join(REPO_ROOT, 'bin', 'husjs.mjs');

let workDir = '';
beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'husjs-export-test-'));
});
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function captureIo() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: { log: (line: string) => out.push(line), error: (line: string) => err.push(line) },
  };
}

/** A minimal structurally valid `.glb` (header + empty JSON chunk). */
function makeTinyGlb(): Buffer {
  const json = Buffer.from('{"asset":{"version":"2.0"}}   ', 'utf8');
  const glb = Buffer.alloc(20 + json.byteLength);
  glb.writeUInt32LE(0x46546c67, 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(glb.byteLength, 8);
  glb.writeUInt32LE(json.byteLength, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  json.copy(glb, 20);
  return glb;
}

/** Stand-ins for the Vite server and the headless browser, so no process is spawned. */
function fakeBrowserIo(glbBytes: Buffer) {
  const captured = captureIo();
  const state = { targetClosed: false, exportUrl: '' };
  return {
    ...captured,
    state,
    io: {
      ...captured.io,
      env: { PATH: '' },
      cwd: workDir,
      resolveHouseExportTarget: async () => ({
        url: 'http://127.0.0.1:1/?husjsExport=1&forceWebGL=1',
        exporterModulePath: '/src/engine/export/glb-scene-exporter.ts',
        close: async () => {
          state.targetClosed = true;
        },
      }),
      exportGlbViaBrowser: async (options: { url: string }) => {
        state.exportUrl = options.url;
        return {
          glbBytes,
          meshCount: 12,
          materialCount: 5,
          convertedBumpMaps: 2,
          cameraPresets: [{ id: 'overview', position: [1, 8, 12], target: [0, 1, 0], fovDeg: 42 }],
        };
      },
    },
  };
}

/** Writes an executable shell script that records its arguments and writes the `--blend` file. */
function writeFakeBlender(dir: string, exitCode = 0): string {
  const path = join(dir, 'fake-blender');
  writeFileSync(
    path,
    `#!/bin/sh
here="$(dirname "$0")"
printf '%s\\n' "$@" > "$here/args.txt"
while [ $# -gt 0 ]; do
  case "$1" in
    --python) cp "$2" "$here/script.py" ;;
    --glb) cp "$2" "$here/input.glb" ;;
    --blend) blend="$2" ;;
    --cameras-json) cp "$2" "$here/cameras.json" ;;
  esac
  shift
done
if [ ${exitCode} -ne 0 ]; then echo "Error: simulated Blender failure" >&2; exit ${exitCode}; fi
printf 'BLENDER-fake' > "$blend"
`
  );
  chmodSync(path, 0o755);
  return path;
}

describe('bin/husjs.mjs dispatch', () => {
  it('prints usage with terrain and export examples for --help, -h, help and no arguments', async () => {
    for (const argv of [['--help'], ['-h'], ['help'], []]) {
      const { io, out, err } = captureIo();
      expect(await dispatchHusjsCli(argv, io)).toBe(0);
      expect(err).toEqual([]);
      const text = out.join('\n');
      expect(text).toContain('Usage: husjs <command> [options]');
      expect(text).toMatch(/husjs terrain --lat .+ --lon /);
      expect(text).toMatch(/husjs export --house /);
    }
  });

  it('routes `terrain --help` and `export --help` to their subcommands', async () => {
    const terrain = captureIo();
    expect(await dispatchHusjsCli(['terrain', '--help'], terrain.io)).toBe(0);
    expect(terrain.out.join('\n')).toContain('--skirt <metres>');
    expect(terrain.out.join('\n')).toContain('--lat <number>');

    const exported = captureIo();
    expect(await dispatchHusjsCli(['export', '--help'], exported.io)).toBe(0);
    const exportHelp = exported.out.join('\n');
    for (const flag of ['--house', '--url', '--out', '--format', '--blender-bin', '--chrome-bin', '--timeout']) {
      expect(exportHelp).toContain(flag);
    }
  });

  it('fails with exit code 1 on an unknown subcommand or invalid subcommand flags', async () => {
    const unknown = captureIo();
    expect(await dispatchHusjsCli(['teleport'], unknown.io)).toBe(1);
    expect(unknown.out).toEqual([]);
    expect(unknown.err.join('\n')).toContain("unknown command 'teleport'");
    expect(unknown.err.join('\n')).toContain('Usage: husjs <command> [options]');

    const badExport = captureIo();
    expect(await dispatchHusjsCli(['export', '--format', 'fbx'], badExport.io)).toBe(1);
    expect(badExport.err.join('\n')).toContain("Invalid --format 'fbx'");

    const badTerrain = captureIo();
    expect(await dispatchHusjsCli(['terrain', '--lat', '10'], badTerrain.io)).toBe(1);
    expect(badTerrain.err.join('\n')).toContain('Missing required flag --lon');
  });

  it('is an executable script whose process exit code follows the dispatch result', () => {
    expect(readFileSync(HUSJS_BIN, 'utf8').startsWith('#!/usr/bin/env node\n')).toBe(true);
    expect(() => accessSync(HUSJS_BIN, fsConstants.X_OK)).not.toThrow();

    const help = execFileSync(process.execPath, [HUSJS_BIN, '--help'], { encoding: 'utf8' });
    expect(help).toContain('husjs export');

    const unknown = spawnSync(process.execPath, [HUSJS_BIN, 'teleport'], { encoding: 'utf8' });
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain("unknown command 'teleport'");
  });
});

describe('parseExportCliArgs', () => {
  it('applies defaults', () => {
    expect(parseExportCliArgs([])).toEqual({
      help: false,
      house: 'simple-house',
      url: undefined,
      out: './export',
      format: 'glb',
      blenderBin: undefined,
      chromeBin: undefined,
      timeoutMs: 120000,
    });
    expect(parseExportCliArgs(['--help'])).toEqual({ help: true });
    expect(parseExportCliArgs(['--house', 'x', '-h'])).toEqual({ help: true });
  });

  it('parses every flag in both `--flag value` and `--flag=value` form', () => {
    expect(
      parseExportCliArgs([
        '--house',
        'stahl-house',
        '--url=http://localhost:5173/?house=stahl-house',
        '--out',
        './renders/stahl.blend',
        '--format',
        'both',
        '--blender-bin',
        '/opt/blender/blender',
        '--chrome-bin=/usr/bin/chromium',
        '--timeout',
        '45000',
      ])
    ).toEqual({
      help: false,
      house: 'stahl-house',
      url: 'http://localhost:5173/?house=stahl-house',
      out: './renders/stahl.blend',
      format: 'both',
      blenderBin: '/opt/blender/blender',
      chromeBin: '/usr/bin/chromium',
      timeoutMs: 45000,
    });
    for (const format of ['glb', 'blend', 'both']) {
      expect(parseExportCliArgs(['--format', format]).format).toBe(format);
    }
  });

  it('rejects invalid input with a clear message', () => {
    expect(() => parseExportCliArgs(['--format', 'fbx'])).toThrow(
      "Invalid --format 'fbx' (expected one of: glb, blend, both)"
    );
    expect(() => parseExportCliArgs(['--format', 'GLB'])).toThrow(/Invalid --format/);
    expect(() => parseExportCliArgs(['--timeout', 'soon'])).toThrow(/--timeout must be a positive number/);
    expect(() => parseExportCliArgs(['--timeout', '0'])).toThrow(/--timeout must be a positive number/);
    expect(() => parseExportCliArgs(['--house'])).toThrow("Missing value for flag '--house'");
    expect(() => parseExportCliArgs(['--out', '--format', 'glb'])).toThrow("Missing value for flag '--out'");
    expect(() => parseExportCliArgs(['--hause', 'x'])).toThrow("Unknown flag '--hause'");
    expect(() => parseExportCliArgs(['courtyard-house'])).toThrow(/Unexpected positional argument/);
    expect(() => parseExportCliArgs(['--url', 'localhost:5173'])).toThrow(/--url must start with http/);
  });
});

describe('resolveOutputPaths & deriveHouseSlug', () => {
  it('treats a plain path as a directory holding <houseSlug>.glb / .blend', () => {
    expect(resolveOutputPaths({ out: './export', houseSlug: 'courtyard-house', cwd: '/work' })).toEqual({
      outDir: '/work/export',
      glbPath: '/work/export/courtyard-house.glb',
      blendPath: '/work/export/courtyard-house.blend',
    });
    expect(resolveOutputPaths({ out: '/abs/out.v2', houseSlug: 'stahl', cwd: '/work' })).toEqual({
      outDir: '/abs/out.v2',
      glbPath: '/abs/out.v2/stahl.glb',
      blendPath: '/abs/out.v2/stahl.blend',
    });
  });

  it('derives both paths from a .glb or .blend file path', () => {
    const expected = {
      outDir: '/work/renders',
      glbPath: '/work/renders/house.v2.glb',
      blendPath: '/work/renders/house.v2.blend',
    };
    expect(resolveOutputPaths({ out: 'renders/house.v2.glb', houseSlug: 'ignored', cwd: '/work' })).toEqual(expected);
    expect(resolveOutputPaths({ out: 'renders/house.v2.blend', houseSlug: 'ignored', cwd: '/work' })).toEqual(expected);
    expect(resolveOutputPaths({ out: '/abs/Scene.GLB', houseSlug: 'ignored', cwd: '/work' }).blendPath).toBe(
      '/abs/Scene.blend'
    );
  });

  it('derives file-name-safe slugs from house ids and URLs', () => {
    expect(deriveHouseSlug('courtyard-house')).toBe('courtyard-house');
    expect(deriveHouseSlug('default')).toBe('simple-house');
    expect(deriveHouseSlug('../../etc/passwd')).toBe('etc-passwd');
    expect(deriveHouseSlug('http://localhost:5173/examples/stahl-house/index.html')).toBe('stahl-house');
    expect(deriveHouseSlug('http://localhost:5173/?house=glass+box')).toBe('glass-box');
    expect(deriveHouseSlug('https://twin.example.com/')).toBe('twin.example.com');
  });
});

describe('resolveHouseExportTarget', () => {
  function fakeVite(port: number) {
    const state = { configs: [] as Record<string, any>[], closed: 0 };
    const createViteServer = async (config: Record<string, any>) => {
      state.configs.push(config);
      return {
        config: { base: '/' },
        httpServer: { address: () => ({ port }) },
        listen: async () => {},
        close: async () => {
          state.closed++;
        },
      };
    };
    return { state, createViteServer };
  }

  it('uses http(s) targets directly, adding the export query flags and keeping existing ones', async () => {
    const neverStarted = async () => {
      throw new Error('a Vite server must not be started for http(s) targets');
    };
    const fromUrl = await resolveHouseExportTarget(
      { house: 'courtyard-house', url: 'http://localhost:5173/?house=stahl' },
      { createViteServer: neverStarted }
    );
    expect(fromUrl.url).toBe('http://localhost:5173/?house=stahl&husjsExport=1&forceWebGL=1');

    const fromHouse = await resolveHouseExportTarget(
      { house: 'https://twin.example.com/app/' },
      { createViteServer: neverStarted }
    );
    expect(fromHouse.url).toBe('https://twin.example.com/app/?husjsExport=1&forceWebGL=1');
    expect(fromHouse.exporterModulePath).toBe('/src/engine/export/glb-scene-exporter.ts');
    await fromHouse.close();
  });

  it('serves local houses from a temporary Vite server bound to loopback', async () => {
    mkdirSync(join(workDir, 'examples', 'stahl-house'), { recursive: true });
    writeFileSync(join(workDir, 'examples', 'stahl-house', 'index.html'), '<!doctype html>');

    const expectations: [string, string][] = [
      ['simple-house', 'http://127.0.0.1:4321/?husjsExport=1&forceWebGL=1'],
      ['courtyard-house', 'http://127.0.0.1:4321/?house=courtyard-house&husjsExport=1&forceWebGL=1'],
      ['default', 'http://127.0.0.1:4321/?husjsExport=1&forceWebGL=1'],
      ['stahl-house', 'http://127.0.0.1:4321/examples/stahl-house/index.html?husjsExport=1&forceWebGL=1'],
      ['lake-cabin', 'http://127.0.0.1:4321/?house=lake-cabin&husjsExport=1&forceWebGL=1'],
    ];
    for (const [house, expectedUrl] of expectations) {
      const { state, createViteServer } = fakeVite(4321);
      const target = await resolveHouseExportTarget({ house }, { rootDir: workDir, createViteServer });
      expect(target.url).toBe(expectedUrl);
      expect(state.configs).toHaveLength(1);
      expect(state.configs[0]!.root).toBe(workDir);
      expect(state.configs[0]!.server).toMatchObject({ port: 0, host: '127.0.0.1' });

      const cacheDir = state.configs[0]!.cacheDir as string;
      expect(existsSync(cacheDir)).toBe(true);
      await target.close();
      expect(state.closed).toBe(1);
      expect(existsSync(cacheDir)).toBe(false);
    }

    const spaced = fakeVite(4321);
    const target = await resolveHouseExportTarget(
      { house: 'glass box & co' },
      { rootDir: workDir, createViteServer: spaced.createViteServer }
    );
    expect(new URL(target.url).searchParams.get('house')).toBe('glass box & co');
    await target.close();
  });

  it('closes the server and removes its cache when startup fails', async () => {
    const state = { cacheDir: '', closed: 0 };
    const createViteServer = async (config: Record<string, any>) => {
      state.cacheDir = config.cacheDir;
      return {
        config: { base: '/' },
        httpServer: { address: () => null },
        listen: async () => {},
        close: async () => {
          state.closed++;
        },
      };
    };
    await expect(
      resolveHouseExportTarget({ house: 'courtyard-house' }, { rootDir: workDir, createViteServer })
    ).rejects.toThrow(/did not report a listening port/);
    expect(state.closed).toBe(1);
    expect(existsSync(state.cacheDir)).toBe(false);
  });
});

describe('buildBlenderConversionScript', () => {
  const script = buildBlenderConversionScript();

  it('imports the .glb into an empty scene, packs textures and saves a compressed .blend', () => {
    const order = [
      'bpy.ops.wm.read_factory_settings(use_empty=True)',
      'bpy.ops.import_scene.gltf(filepath=args["glb"])',
      'bpy.ops.file.pack_all()',
      'bpy.ops.wm.save_as_mainfile(filepath=args["blend"], compress=True)',
    ].map((needle) => script.indexOf(needle));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('shrinks and hides empties and declutters every 3D viewport', () => {
    expect(script).toContain("if obj.type == 'EMPTY':");
    expect(script).toContain('obj.empty_display_size = 0.02');
    expect(script).toContain('obj.hide_viewport = True');
    expect(script).toContain('for screen in bpy.data.screens:');
    expect(script).toContain("if area.type != 'VIEW_3D':");
    expect(script).toContain("if space.type != 'VIEW_3D':");
    for (const overlayFlag of ['show_relationship_lines', 'show_extras', 'show_object_origins']) {
      expect(script).toContain(`if hasattr(overlay, "${overlayFlag}"):`);
      expect(script).toContain(`overlay.${overlayFlag} = False`);
    }
    expect(script).toContain("space.shading.type = 'MATERIAL'");
  });

  it('selects AgX colour management with fallbacks for older Blender', () => {
    expect(script).toContain("for view_transform in ('AgX', 'Filmic', 'Standard'):");
    expect(script).toContain('view_settings.view_transform = view_transform');
    expect(script).toContain("view_settings.look = 'None'");
  });

  it('adds Cam_<id> cameras converted from three.js Y-up to Blender Z-up', () => {
    expect(script).toContain('name = "Cam_" + str(preset["id"])');
    expect(script).toContain('return Vector((xyz[0], -xyz[2], xyz[1]))');
    expect(script).toContain("direction.to_track_quat('-Z', 'Y')");
    expect(script).toContain('if c.name == "Cam_overview"');
    expect(script).toContain('scene.camera = ');
  });

  it('is syntactically valid Python', (ctx) => {
    const probe = spawnSync('python3', ['--version']);
    if (probe.error || probe.status !== 0) {
      ctx.skip();
      return;
    }
    const scriptPath = join(workDir, 'glb-to-blend.py');
    writeFileSync(scriptPath, script);
    const compiled = spawnSync(
      'python3',
      ['-c', 'import sys; compile(open(sys.argv[1]).read(), sys.argv[1], "exec")', scriptPath],
      { encoding: 'utf8' }
    );
    expect(compiled.stderr).toBe('');
    expect(compiled.status).toBe(0);
  });
});

describe('Blender discovery & conversion', () => {
  it('finds Blender from --blender-bin, $BLENDER_BIN or PATH, and returns null when missing', () => {
    const fake = writeFakeBlender(workDir);
    const binDir = join(workDir, 'bin');
    mkdirSync(binDir);
    writeFileSync(join(binDir, 'blender'), '#!/bin/sh\n');
    chmodSync(join(binDir, 'blender'), 0o755);
    const notExecutable = join(workDir, 'not-executable');
    writeFileSync(notExecutable, '');
    chmodSync(notExecutable, 0o644);

    expect(findBlenderExecutable(fake, { PATH: '' })).toBe(fake);
    expect(findBlenderExecutable(undefined, { PATH: '', BLENDER_BIN: fake })).toBe(fake);
    expect(findBlenderExecutable(undefined, { PATH: binDir })).toBe(join(binDir, 'blender'));

    expect(findBlenderExecutable('/nonexistent/blender', { PATH: binDir })).toBeNull();
    expect(findBlenderExecutable(notExecutable, { PATH: '' })).toBeNull();
    expect(findBlenderExecutable(workDir, { PATH: '' })).toBeNull();
    expect(findBlenderExecutable(undefined, { PATH: '', BLENDER_BIN: '/nonexistent/blender' })).toBeNull();
  });

  it('runs Blender headless with the conversion script, paths and camera presets', async () => {
    const fake = writeFakeBlender(workDir);
    const glbPath = join(workDir, 'in.glb');
    const blendPath = join(workDir, 'nested', 'out.blend');
    writeFileSync(glbPath, makeTinyGlb());
    const cameraPresets = [{ id: 'overview', position: [1, 8, 12], target: [0, 1, 0] }];

    await expect(convertGlbToBlend({ glbPath, blendPath, blenderBin: fake, cameraPresets })).resolves.toBe(blendPath);

    expect(readFileSync(blendPath, 'utf8')).toBe('BLENDER-fake');
    const args = readFileSync(join(workDir, 'args.txt'), 'utf8').trim().split('\n');
    expect(args.slice(0, 3)).toEqual(['--background', '--factory-startup', '--python']);
    expect(args[3]).toMatch(/\.py$/);
    expect(args.slice(4, 9)).toEqual(['--', '--glb', glbPath, '--blend', blendPath]);
    expect(args[9]).toBe('--cameras-json');
    expect(readFileSync(join(workDir, 'script.py'), 'utf8')).toBe(buildBlenderConversionScript());
    expect(JSON.parse(readFileSync(join(workDir, 'cameras.json'), 'utf8'))).toEqual(cameraPresets);
    // The temporary script and camera files are cleaned up afterwards.
    expect(existsSync(args[3]!)).toBe(false);
    expect(existsSync(args[10]!)).toBe(false);
  });

  it('reports Blender failures with its output instead of a silent success', async () => {
    const failing = writeFakeBlender(workDir, 3);
    const glbPath = join(workDir, 'in.glb');
    writeFileSync(glbPath, makeTinyGlb());
    await expect(
      convertGlbToBlend({ glbPath, blendPath: join(workDir, 'out.blend'), blenderBin: failing })
    ).rejects.toThrow(/Blender exited with code 3[\s\S]*simulated Blender failure/);
    expect(existsSync(join(workDir, 'out.blend'))).toBe(false);
  });
});

describe('runExportCli', () => {
  it('writes <houseSlug>.glb into the output directory for the default glb format', async () => {
    const glb = makeTinyGlb();
    const { io, out, state } = fakeBrowserIo(glb);
    const result = await runExportCli(['--house', 'stahl-house', '--out', 'export'], io);

    const glbPath = join(workDir, 'export', 'stahl-house.glb');
    expect(result).toEqual({
      glbPath,
      blendPath: null,
      blenderSkipped: false,
      meshCount: 12,
      materialCount: 5,
      convertedBumpMaps: 2,
    });
    expect(readFileSync(glbPath).equals(glb)).toBe(true);
    expect(readdirSync(join(workDir, 'export'))).toEqual(['stahl-house.glb']);
    expect(state.exportUrl).toContain('husjsExport=1');
    expect(state.targetClosed).toBe(true);
    expect(out.join('\n')).toContain(`Wrote ${glbPath}`);
  });

  it('skips .blend conversion gracefully when Blender is missing, keeping the .glb', async () => {
    for (const format of ['both', 'blend']) {
      const glb = makeTinyGlb();
      const { io, out, err } = fakeBrowserIo(glb);
      const outFile = join(workDir, format, 'house.blend');
      const result = await runExportCli(
        ['--format', format, '--out', outFile, '--blender-bin', '/nonexistent/blender'],
        io
      );

      const glbPath = join(workDir, format, 'house.glb');
      expect(result).toMatchObject({ glbPath, blendPath: null, blenderSkipped: true });
      expect(readFileSync(glbPath).equals(glb)).toBe(true);
      expect(existsSync(outFile)).toBe(false);
      expect(err).toEqual([]);
      const message = out.find((line) => line.includes('Blender executable not found'));
      expect(message).toContain("at '/nonexistent/blender'");
      expect(message).toContain('pass --blender-bin <path> or install Blender 4.x');
      expect(message).toContain(`Skipping .blend conversion; .glb export is ready at ${glbPath}.`);
    }
  });

  it('exits 0 through the husjs dispatcher when Blender is missing', async () => {
    const { io, out } = fakeBrowserIo(makeTinyGlb());
    const code = await dispatchHusjsCli(
      ['export', '--format', 'both', '--out', 'export', '--blender-bin', '/nonexistent/blender'],
      io
    );
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('Blender executable not found');
    expect(existsSync(join(workDir, 'export', 'simple-house.glb'))).toBe(true);
  });

  it('writes both files for --format both and only the .blend for --format blend', async () => {
    const fake = writeFakeBlender(workDir);

    const both = fakeBrowserIo(makeTinyGlb());
    const bothResult = await runExportCli(['--format', 'both', '--out', 'both', '--blender-bin', fake], both.io);
    expect(bothResult).toMatchObject({
      glbPath: join(workDir, 'both', 'simple-house.glb'),
      blendPath: join(workDir, 'both', 'simple-house.blend'),
      blenderSkipped: false,
    });
    expect(readdirSync(join(workDir, 'both')).sort()).toEqual(['simple-house.blend', 'simple-house.glb']);
    expect(JSON.parse(readFileSync(join(workDir, 'cameras.json'), 'utf8'))).toEqual([
      { id: 'overview', position: [1, 8, 12], target: [0, 1, 0], fovDeg: 42 },
    ]);

    const glb = makeTinyGlb();
    const blendOnly = fakeBrowserIo(glb);
    const blendResult = await runExportCli(
      ['--format', 'blend', '--out', 'blend-only/house.blend', '--blender-bin', fake],
      blendOnly.io
    );
    expect(blendResult).toMatchObject({
      glbPath: null,
      blendPath: join(workDir, 'blend-only', 'house.blend'),
      blenderSkipped: false,
    });
    expect(readdirSync(join(workDir, 'blend-only'))).toEqual(['house.blend']);
    // Blender still received the real export through a temporary .glb, which is removed afterwards.
    expect(readFileSync(join(workDir, 'input.glb')).equals(glb)).toBe(true);
    const tempGlb = readFileSync(join(workDir, 'args.txt'), 'utf8').trim().split('\n')[6]!;
    expect(existsSync(tempGlb)).toBe(false);
  });

  it('keeps the .glb when a blend-only conversion fails, and closes the target when export fails', async () => {
    const failing = writeFakeBlender(workDir, 2);
    const glb = makeTinyGlb();
    const failed = fakeBrowserIo(glb);
    await expect(
      runExportCli(['--format', 'blend', '--out', 'failed', '--blender-bin', failing], failed.io)
    ).rejects.toThrow(/Blender exited with code 2/);
    expect(readFileSync(join(workDir, 'failed', 'simple-house.glb')).equals(glb)).toBe(true);

    const broken = fakeBrowserIo(glb);
    broken.io.exportGlbViaBrowser = async () => {
      throw new Error('Timed out waiting for the house');
    };
    await expect(runExportCli(['--out', 'broken'], broken.io)).rejects.toThrow('Timed out waiting for the house');
    expect(broken.state.targetClosed).toBe(true);
    expect(existsSync(join(workDir, 'broken'))).toBe(false);
  });
});
