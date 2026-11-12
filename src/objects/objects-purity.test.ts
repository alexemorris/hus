import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const OBJECTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(OBJECTS_DIR, '../..');

const FORBIDDEN_HOUSE_ZONE_IDS = [
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
] as const;

function walkObjectProductionFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkObjectProductionFiles(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('src/objects purity invariants', () => {
  it('passes tools/check-boundaries.mjs with zero violations', () => {
    const raw = execFileSync(
      process.execPath,
      [join(REPO_ROOT, 'tools/check-boundaries.mjs'), '--json'],
      { encoding: 'utf8' }
    );
    const parsed = JSON.parse(raw) as { violations: readonly { file: string }[] };
    expect(parsed.violations).toEqual([]);
  });

  it('contains zero imports from homes/ and zero hardcoded house-specific room zone IDs', () => {
    const zoneRe = new RegExp('[\`\'"](' + FORBIDDEN_HOUSE_ZONE_IDS.join('|') + ')(?:\\.[^\`\'"]*)?[\`\'"]');
    const offending: string[] = [];

    for (const absPath of walkObjectProductionFiles(OBJECTS_DIR)) {
      const rel = relative(REPO_ROOT, absPath);
      const lines = readFileSync(absPath, 'utf8').split('\n');
      lines.forEach((line, idx) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
          return;
        }
        if (/from\s+['"][^'"]*homes\//.test(trimmed)) {
          offending.push(`${rel}:${idx + 1} imports homes/: ${trimmed}`);
        }
        if (zoneRe.test(trimmed)) {
          offending.push(`${rel}:${idx + 1} hardcodes house-specific zone ID: ${trimmed}`);
        }
      });
    }

    expect(offending).toEqual([]);
  });
});
