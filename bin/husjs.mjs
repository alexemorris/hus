#!/usr/bin/env node
/**
 * `husjs` command-line entrypoint.
 *
 *   husjs terrain --lat <deg> --lon <deg> [options]   Bootstrap a .husgrid.json terrain DEM
 *   husjs hdri [--preset <id>] [options]              Generate seamless 360° Radiance .hdr suite
 *   husjs export [--house <id-or-url>] [options]      Export a house to .glb / .blend
 *   husjs zfight [--house <id-or-path>] [options]     Detect coplanar 3D z-fighting overlaps
 *   husjs audit [--house <id-or-path>] [options]      Run architectural & 1PV walkthrough audit
 *   husjs schedule [--house <id-or-path>] [options]   Export FF&E / sanitaryware / joinery schedule
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const USAGE = `Usage: husjs <command> [options]

Commands:
  terrain    Fetch elevation tiles and write a .husgrid.json terrain grid
  hdri       Generate seamless 360° Radiance .hdr environment panoramas via Nano Banana
  export     Export a house to binary glTF (.glb) and/or Blender (.blend)
  zfight     Detect coplanar 3D triangle z-fighting overlaps in a house scene
  audit      Run architectural & 1PV walkthrough verification suite on a house scene
  schedule   Export FF&E, sanitaryware, joinery & appliance schedule (Markdown / CSV / JSON)
  help       Show this help message

Examples:
  husjs terrain --lat 34.1003 --lon -118.3698 --size 300 --skirt 900 --out ./terrain.husgrid.json
  husjs hdri --preset hollywood-hills --seasons spring,summer,autumn,winter --times dawn,day,dusk,night
  husjs export --house simple-house --out ./export
  husjs export --house simple-house --format both --out ./export/simple-house.blend
  husjs zfight --house simple-flat --epsilon-mm 1.5 --min-area-cm2 1.0
  husjs audit --house simple-flat
  husjs schedule --house simple-house --format markdown

Run 'husjs <command> --help' for the options of a command.`;

/**
 * Dispatches a `husjs` invocation and resolves with the process exit code.
 *
 * @param {string[]} argv Arguments after the executable name.
 * @param {{ log?: (message: string) => void, error?: (message: string) => void }} [io]
 * @returns {Promise<number>}
 */
export async function dispatchHusjsCli(argv, io = {}) {
  const log = io.log ?? console.log;
  const error = io.error ?? console.error;
  const [command, ...rest] = argv;

  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    log(USAGE);
    return 0;
  }

  try {
    if (command === 'terrain') {
      const { runTerrainCli } = await import('../tools/husjs-terrain.mjs');
      await runTerrainCli(rest, io);
      return 0;
    }
    if (command === 'hdri') {
      const { runHdriCli } = await import('../tools/husjs-hdri.mjs');
      await runHdriCli(rest, io);
      return 0;
    }
    if (command === 'export') {
      const { runExportCli } = await import('../tools/husjs-export.mjs');
      await runExportCli(rest, io);
      return 0;
    }
    if (command === 'zfight') {
      const { runZfightCli } = await import('../tools/husjs-zfight.mjs');
      await runZfightCli(rest, io);
      return 0;
    }
    if (command === 'audit') {
      const { runAuditCli } = await import('../tools/husjs-audit.mjs');
      await runAuditCli(rest, io);
      return 0;
    }
    if (command === 'schedule') {
      const { runScheduleCli } = await import('../tools/husjs-schedule.mjs');
      await runScheduleCli(rest, io);
      return 0;
    }
  } catch (err) {
    error(`husjs ${command} error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  error(`husjs: unknown command '${command}'\n\n${USAGE}`);
  return 1;
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  process.exitCode = await dispatchHusjsCli(process.argv.slice(2));
}
