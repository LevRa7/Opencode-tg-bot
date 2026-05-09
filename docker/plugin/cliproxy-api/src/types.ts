import type { Plugin } from "@opencode-ai/plugin";

export type { Plugin };

export type PluginContext = Parameters<Plugin>[0];

export type PluginResult = Awaited<ReturnType<Plugin>>;

export interface LoaderResult {
  apiKey: string;
  fetch(input: RequestInfo, init?: RequestInit): Promise<Response>;
}

export type GetAuth = () => Promise<unknown>;
