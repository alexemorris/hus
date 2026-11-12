import { execSync } from 'node:child_process';

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const TOKEN_TTL_MS = 45 * 60 * 1000;
const MODEL_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

let cachedAccessToken = '';
let tokenExpiresAt = 0;

function getVertexAccessToken(forceRefresh) {
  const now = Date.now();
  if (!forceRefresh && cachedAccessToken && now < tokenExpiresAt) {
    return cachedAccessToken;
  }
  cachedAccessToken = execSync(
    'gcloud auth application-default print-access-token 2>/dev/null || gcloud auth print-access-token 2>/dev/null',
    { encoding: 'utf8' }
  ).trim();
  tokenExpiresAt = now + TOKEN_TTL_MS;
  return cachedAccessToken;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function asRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}

function vertexAiProxyPlugin() {
  return {
    name: 'hus-vertex-ai-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(`${server.config.base}api/knx-ai`, (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed' });
          return;
        }
        const project = process.env.GOOGLE_CLOUD_PROJECT?.trim();
        if (!project) {
          sendJson(res, 503, {
            error:
              'KNX AI assistant is not configured: set GOOGLE_CLOUD_PROJECT before starting the dev server.',
          });
          return;
        }
        void (async () => {
          try {
            const payload = asRecord(JSON.parse((await readRequestBody(req)) || '{}'));
            const model =
              typeof payload.model === 'string' && MODEL_ID_PATTERN.test(payload.model)
                ? payload.model
                : DEFAULT_MODEL;
            const location = process.env.GOOGLE_CLOUD_LOCATION?.trim() || 'global';
            const url = `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${model}:generateContent`;
            const callVertex = (forceRefresh) =>
              fetch(url, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${getVertexAccessToken(forceRefresh)}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload.vertexRequest ?? {}),
              });
            let upstream = await callVertex(false);
            if (upstream.status === 401) {
              upstream = await callVertex(true);
            }
            const data = await upstream.json();
            sendJson(res, upstream.status, data);
          } catch (err) {
            sendJson(res, 500, { error: err instanceof Error ? err.message : 'Vertex AI proxy failure' });
          }
        })();
      });
    },
  };
}

export function husDevServerPlugins() {
  return [vertexAiProxyPlugin()];
}

export function resolveHusBase(raw) {
  const trimmed = (raw ?? '').trim();
  if (!trimmed || trimmed === '/') {
    return '/';
  }
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}/`;
}

export function husManualChunks(id) {
  if (id.includes('node_modules/three')) {
    return 'vendor-three';
  }
  if (id.includes('node_modules/preact') || id.includes('node_modules/@preact')) {
    return 'vendor-preact';
  }
  return undefined;
}

export function faviconBaseRewritePlugin() {
  let resolvedBase = '/';
  return {
    name: 'hus:favicon-base-rewrite',
    configResolved(config) {
      resolvedBase = config.base || '/';
    },
    transformIndexHtml(html) {
      const normalizedBase = resolvedBase.endsWith('/') ? resolvedBase : `${resolvedBase}/`;
      return html.replace('href="./favicon.svg"', `href="${normalizedBase}favicon.svg"`);
    },
  };
}

export function husVitePlugin(options = {}) {
  const plugins = [
    {
      name: 'husjs-vite-plugin',
      config() {
        return {
          optimizeDeps: {
            exclude: ['husjs'],
            include: ['three', 'three/examples/jsm/loaders/HDRLoader.js', 'preact', '@preact/signals'],
          },
          resolve: {
            dedupe: ['three', 'preact', '@preact/signals'],
          },
          worker: {
            format: 'es',
          },
        };
      },
    },
    faviconBaseRewritePlugin(),
  ];
  if (options.devServerProxy !== false) {
    plugins.push(...husDevServerPlugins());
  }
  return plugins;
}

export function husViteConfig(options = {}) {
  return {
    base: resolveHusBase(options.base ?? process.env.VITE_BASE),
    plugins: husVitePlugin(options),
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
        output: { manualChunks: husManualChunks },
      },
    },
  };
}
