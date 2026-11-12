import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { husDevServerPlugins } from './tools/dev-server/index.ts';

const ROOT_DIR = dirname(fileURLToPath(import.meta.url));

/** Normalises VITE_BASE (e.g. `/hus/`) to a leading + trailing slash. */
function resolveBase(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed || trimmed === '/') {
    return '/';
  }
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}/`;
}

/**
 * Vendor-only manual chunks. App code is left to Rollup's default chunking: the
 * layer-based split that used to live here produced circular chunks
 * (engine <-> homes) which risk TDZ errors at module-evaluation time.
 */
function manualChunks(id: string): string | undefined {
  if (id.includes('node_modules/three')) {
    return 'vendor-three';
  }
  if (id.includes('node_modules/preact') || id.includes('node_modules/@preact')) {
    return 'vendor-preact';
  }
  return undefined;
}

function faviconBaseRewritePlugin() {
  let resolvedBase = '/';
  return {
    name: 'hus:favicon-base-rewrite',
    configResolved(config: { readonly base: string }) {
      resolvedBase = config.base || '/';
    },
    transformIndexHtml(html: string) {
      const normalizedBase = resolvedBase.endsWith('/') ? resolvedBase : `${resolvedBase}/`;
      return html.replace('href="./favicon.svg"', `href="${normalizedBase}favicon.svg"`);
    },
  };
}

export default defineConfig({
  base: resolveBase(process.env.VITE_BASE),
  plugins: [husDevServerPlugins(), faviconBaseRewritePlugin()],
  resolve: {
    alias: [
      { find: /^husjs\/(.+)$/, replacement: resolve(ROOT_DIR, 'src/husjs/$1.ts') },
      { find: /^husjs$/, replacement: resolve(ROOT_DIR, 'src/husjs/index.ts') },
    ],
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
  build: {
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: { manualChunks },
    },
  },
});
