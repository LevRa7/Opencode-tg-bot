import { logger } from "../utils/logger.js";
import { buildTelegraphContent } from "./content-builder.js";
import type { TelegraphElement } from "./content-builder.js";
import type { TechnicalDetailsPublishRequest, TechnicalDetailsPublisher, TelegraphConfig } from "./types.js";

interface TelegraphPageResponse {
  ok: boolean;
  error?: string;
  result?: {
    path?: string;
    url?: string;
  };
}

const API_BASE = "https://api.telegra.ph";
const truncatedMarker = "\n[truncated]";
const FLOOD_WAIT_REGEX = /FLOOD_WAIT_(\d+)/;

export class FloodWaitError extends Error {
  constructor(public readonly waitMs: number) {
    super(`FLOOD_WAIT: must wait ${waitMs}ms`);
    this.name = "FloodWaitError";
  }
}

export interface CreatePageResult {
  url: string;
  path: string;
}

export class TelegraphClient implements TechnicalDetailsPublisher {
  constructor(private readonly config: TelegraphConfig) {}

  async publish(request: TechnicalDetailsPublishRequest): Promise<string | null> {
    const safeTitle = request.title.length > 256 ? `${request.title.slice(0, 253)}...` : request.title;
    const result = await this.createPage(safeTitle, request.body);
    return result?.url ?? null;
  }

  async flush(): Promise<void> {}

  reset(): void {}

  async createPage(title: string, body: string): Promise<CreatePageResult | null> {
    if (!this.config.enabled || !this.config.accessToken || body.trim().length === 0) {
      return null;
    }

    const safeTitle = title.length > 256 ? `${title.slice(0, 253)}...` : title;

    const params = new URLSearchParams();
    params.set("access_token", this.config.accessToken);
    params.set("title", safeTitle);
    params.set("author_name", this.config.authorName);
    params.set("content", JSON.stringify(this.buildNodes(body)));
    params.set("return_content", "false");

    const payload = await this.apiCall(`${API_BASE}/createPage`, params);
    if (!payload) return null;

    const url = validateTelegraphUrl(payload.result?.url);
    const path = payload.result?.path;
    if (!url || !path) return null;

    return { url, path };
  }

  async editPage(path: string, title: string, body: string): Promise<boolean> {
    if (!this.config.enabled || !this.config.accessToken) {
      return false;
    }

    const safeTitle = title.length > 256 ? `${title.slice(0, 253)}...` : title;

    const params = new URLSearchParams();
    params.set("access_token", this.config.accessToken);
    params.set("title", safeTitle);
    params.set("author_name", this.config.authorName);
    params.set("content", JSON.stringify(this.buildNodes(body)));
    params.set("return_content", "false");

    const payload = await this.apiCall(`${API_BASE}/editPage/${path}`, params);
    return payload !== null;
  }

  private buildNodes(body: string): TelegraphElement[] {
    const truncated = truncateBody(body, this.config.maxChars);
    return buildTelegraphContent(truncated);
  }

  private async apiCall(url: string, body: URLSearchParams): Promise<TelegraphPageResponse | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        logger.warn("[TelegraphClient] Telegraph API request failed", { status: response.status });
        return null;
      }

      const payload = (await response.json()) as TelegraphPageResponse;
      if (!payload.ok) {
        const errorText = payload.error ?? "unknown error";
        const floodWait = parseFloodWaitSeconds(errorText);
        if (floodWait !== null) {
          logger.warn(`[TelegraphClient] FLOOD_WAIT: ${floodWait}s`);
          throw new FloodWaitError(floodWait * 1000);
        }
        logger.warn(
          `[TelegraphClient] Telegraph API returned an unsuccessful response: ${errorText}`,
        );
        return null;
      }

      return payload;
    } catch (error) {
      if (error instanceof FloodWaitError) {
        throw error;
      }
      logger.warn("[TelegraphClient] Failed to call Telegraph API", safeError(error));
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function truncateBody(body: string, maxChars: number): string {
  if (body.length <= maxChars) {
    return body;
  }

  const limit = Math.max(0, maxChars - truncatedMarker.length);
  return `${body.slice(0, limit)}${truncatedMarker}`;
}

function validateTelegraphUrl(value: string | undefined): string | null {
  if (!value) {
    logger.warn("[TelegraphClient] Telegraph API response did not include a URL");
    return null;
  }

  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.hostname !== "telegra.ph"
    ) {
      logger.warn("[TelegraphClient] Telegraph API returned an invalid URL");
      return null;
    }

    return url.toString();
  } catch {
    logger.warn("[TelegraphClient] Telegraph API returned an invalid URL");
    return null;
  }
}

function parseFloodWaitSeconds(text: string): number | null {
  const match = text.match(FLOOD_WAIT_REGEX);
  return match ? parseInt(match[1]!, 10) : null;
}

function safeError(error: unknown): { name?: string } {
  if (error instanceof Error) {
    return { name: error.name };
  }

  return {};
}
