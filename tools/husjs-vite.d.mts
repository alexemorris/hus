import type { Plugin, PluginOption, UserConfig } from 'vite';

export interface HusViteOptions {
  readonly base?: string;
  readonly devServerProxy?: boolean;
}

export declare function husDevServerPlugins(): PluginOption[];
export declare function resolveHusBase(raw: string | undefined): string;
export declare function husManualChunks(id: string): string | undefined;
export declare function faviconBaseRewritePlugin(): Plugin;
export declare function husVitePlugin(options?: HusViteOptions): PluginOption[];
export declare function husViteConfig(options?: HusViteOptions): UserConfig;
