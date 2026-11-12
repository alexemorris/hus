import { execSync } from 'node:child_process';
import type { Plugin } from 'vite';
import { asRecord, errorMessage, readRequestBody, sendJson } from './http-helpers.ts';

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const TOKEN_TTL_MS = 45 * 60 * 1000;
const MODEL_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

let cachedAccessToken = '';
let tokenExpiresAt = 0;

function getVertexAccessToken(forceRefresh: boolean): string {
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

/**
 * Dev-only Vertex AI proxy for the KNX AI assistant: `POST <base>api/knx-ai`
 * with `{ model?, vertexRequest }`. Requires `GOOGLE_CLOUD_PROJECT` in the
 * environment (there is deliberately no default project) and gcloud
 * credentials; responds 503 when the project is not configured.
 */
export function vertexAiProxyPlugin(): Plugin {
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
              'KNX AI assistant is not configured: set GOOGLE_CLOUD_PROJECT (and run `gcloud auth application-default login`) before starting the dev server.',
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

            const callVertex = (forceRefresh: boolean): Promise<Response> =>
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
            const data: unknown = await upstream.json();
            sendJson(res, upstream.status, data);
          } catch (err) {
            sendJson(res, 500, { error: errorMessage(err, 'Vertex AI proxy failure') });
          }
        })();
      });
    },
  };
}
