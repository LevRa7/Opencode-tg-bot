import { logger } from "../utils/logger.js";
import type { TechnicalDetailsPublishRequest, TechnicalDetailsPublisher, TelegraphConfig } from "./types.js";

interface TelegraphCreatePageResponse {
  ok: boolean;
  result?: {
    url?: string;
  };
}

const createPageUrl = "https://api.telegra.ph/createPage";
const truncatedMarker = "\n[truncated]";

interface TelegraphNode {
  tag: "p";
  children: string[];
}

export class TelegraphClient implements TechnicalDetailsPublisher {
  constructor(private readonly config: TelegraphConfig) {}

  async publish(request: TechnicalDetailsPublishRequest): Promise<string | null> {
    if (!this.config.enabled || !this.config.accessToken || request.body.trim().length === 0) {
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(createPageUrl, {
        method: "POST",
        body: this.buildRequestBody(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        logger.warn("[TelegraphClient] Telegraph API request failed", { status: response.status });
        return null;
      }

      const payload = (await response.json()) as TelegraphCreatePageResponse & { error?: string };
      if (!payload.ok) {
        logger.warn(
          `[TelegraphClient] Telegraph API returned an unsuccessful response: ${payload.error ?? "unknown error"}`,
        );
        return null;
      }

      return validateTelegraphUrl(payload.result?.url);
    } catch (error) {
      logger.warn("[TelegraphClient] Failed to publish technical details", safeError(error));
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildRequestBody(request: TechnicalDetailsPublishRequest): URLSearchParams {
    const body = new URLSearchParams();
    body.set("access_token", this.config.accessToken);
    body.set("title", request.title);
    body.set("author_name", this.config.authorName);
    body.set("content", JSON.stringify(buildContentNodes(truncateBody(request.body, this.config.maxChars))));
    body.set("return_content", "false");
    return body;
  }
}

function buildContentNodes(body: string): TelegraphNode[] {
  return body
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => ({ tag: "p", children: [line] }));
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

function safeError(error: unknown): { name?: string } {
  if (error instanceof Error) {
    return { name: error.name };
  }

  return {};
}
