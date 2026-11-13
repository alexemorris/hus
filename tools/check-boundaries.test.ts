import { describe, expect, it } from 'vitest';
// @ts-expect-error .mjs module imported directly under Vitest
import { ALLOWED, PUBLIC_HUSJS_ENTRYPOINTS, checkBoundaries, checkSourceImports } from './check-boundaries.mjs';

describe('tools/check-boundaries.mjs layer boundary rules', () => {
  it('locks ALLOWED.homes = ["husjs"] & ALLOWED.app = ["husjs", "homes"] and rejects deep or private husjs imports', () => {
    expect(ALLOWED.homes).toEqual(['husjs']);
    expect(ALLOWED.examples).toEqual(['husjs']);
    expect(ALLOWED.app).toEqual(['husjs', 'homes', 'examples']);
    expect(PUBLIC_HUSJS_ENTRYPOINTS.size).toBe(27);
    expect(PUBLIC_HUSJS_ENTRYPOINTS.has('src/husjs/testing.ts')).toBe(true);
    expect(PUBLIC_HUSJS_ENTRYPOINTS.has('src/husjs/materials.ts')).toBe(true);
    expect(checkBoundaries()).toEqual([]);

    const deepCoreViolation = checkSourceImports(
      'src/homes/demo/index.ts',
      "import { CircuitBus } from '../../core/electrical/index.ts';"
    );
    expect(deepCoreViolation).toHaveLength(1);
    expect(deepCoreViolation[0]?.reason).toContain('homes → core is not allowed');

    const internalHusjsViolation = checkSourceImports(
      'src/homes/demo/index.ts',
      "import { defineHouse } from 'husjs/house';"
    );
    expect(internalHusjsViolation).toHaveLength(1);
    expect(internalHusjsViolation[0]?.reason).toContain('not a public husjs entrypoint');

    const relativeHusjsViolation = checkSourceImports(
      'src/homes/demo/index.ts',
      "import { defineHouse } from '../../husjs/index.ts';"
    );
    expect(relativeHusjsViolation).toHaveLength(1);
    expect(relativeHusjsViolation[0]?.reason).toContain('package specifiers');

    const examplesDeepViolation = checkSourceImports(
      'examples/simple-flat/index.ts',
      "import { CircuitBus } from '../../src/core/electrical/index.ts';"
    );
    expect(examplesDeepViolation).toHaveLength(1);
    expect(examplesDeepViolation[0]?.reason).toContain('examples → core is not allowed');

    const examplesInternalHusjsViolation = checkSourceImports(
      'examples/simple-flat/index.ts',
      "import { defineHouse } from 'husjs/house';"
    );
    expect(examplesInternalHusjsViolation).toHaveLength(1);
    expect(examplesInternalHusjsViolation[0]?.reason).toContain('not a public husjs entrypoint');

    const engineHouseZoneViolation = checkSourceImports(
      'src/engine/audio/example.ts',
      "const z = 'livingRoom';"
    );
    expect(engineHouseZoneViolation).toHaveLength(1);
    expect(engineHouseZoneViolation[0]?.reason).toContain('engine file references house-specific zone ID');
  });
});
