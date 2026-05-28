import { logger } from "../utils/logger.js";
import type { TelegraphClient } from "./telegraph-client.js";
import type { TechnicalDetailsPublishRequest, TechnicalDetailsPublisher } from "./types.js";

interface ThinkingPage {
  url: string;
  path: string;
  thoughts: string[];
  dirty: boolean;
}

/**
 * Accumulates all thinking blocks into a single Telegraph page.
 * Resets on flush() (called on session idle).
 */
export class ThinkingTelegraphAccumulator implements TechnicalDetailsPublisher {
  private page: ThinkingPage | null = null;
  private readonly client: TelegraphClient;

  constructor(client: TelegraphClient) {
    this.client = client;
  }

  async publish(request: TechnicalDetailsPublishRequest): Promise<string | null> {
    const thoughtBody = request.body.trim();
    if (!thoughtBody || thoughtBody.length < 10) return null;

    if (this.page) {
      this.page.thoughts.push(thoughtBody);
      this.page.dirty = true;
      this.scheduleFlush();
      return this.page.url;
    }

    try {
      const result = await this.client.createPage("💭 Thinking", thoughtBody);
      if (!result) return null;

      this.page = {
        url: result.url,
        path: result.path,
        thoughts: [thoughtBody],
        dirty: false,
      };
      return result.url;
    } catch (error) {
      logger.warn("[ThinkingAccum] Failed to create thinking page", { error });
      return null;
    }
  }

  async flush(): Promise<void> {
    if (this.page && this.page.dirty) {
      await this.doFlush();
    }
    this.page = null;
  }

  reset(): void {
    this.page = null;
  }

  private pendingFlush = false;

  private scheduleFlush(): void {
    if (this.pendingFlush) return;
    this.pendingFlush = true;
    setImmediate(async () => {
      this.pendingFlush = false;
      if (this.page && this.page.dirty) {
        await this.doFlush();
      }
    });
  }

  private async doFlush(): Promise<void> {
    if (!this.page || this.page.thoughts.length === 0) return;

    const reversed = [...this.page.thoughts].reverse();
    const content = reversed
      .map((t, i) => `## ${reversed.length - i}\n\n${t}`)
      .join("\n\n---\n\n");

    try {
      const success = await this.client.editPage(this.page.path, "💭 Thinking", content);
      if (success) {
        this.page.dirty = false;
      }
    } catch (error) {
      logger.warn("[ThinkingAccum] Failed to edit thinking page", { error });
    }
  }
}
