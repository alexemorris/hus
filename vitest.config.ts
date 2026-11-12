import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const ROOT_DIR = dirname(fileURLToPath(import.meta.url));

// Unit tests run in plain Node (no DOM / WebGL). Keep tests next to the pure
// modules they cover as `*.test.ts`.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^husjs\/(.+)$/, replacement: resolve(ROOT_DIR, 'src/husjs/$1.ts') },
      { find: /^husjs$/, replacement: resolve(ROOT_DIR, 'src/husjs/index.ts') },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts', 'examples/**/*.test.ts'],
  },
});
