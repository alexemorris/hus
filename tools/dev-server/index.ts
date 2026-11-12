import type { PluginOption } from 'vite';
import { vertexAiProxyPlugin } from './vertex-ai-proxy-plugin.ts';

/** All Hus dev-server plugins. API middleware is `apply: 'serve'` only. */
export function husDevServerPlugins(): PluginOption[] {
  return [vertexAiProxyPlugin()];
}
