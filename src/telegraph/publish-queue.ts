import { logger } from "../utils/logger.js";
import { FloodWaitError, TelegraphClient } from "./telegraph-client.js";
import type { TechnicalDetailsPublishRequest, TechnicalDetailsPublisher } from "./types.js";

export interface PageAccumulatorConfig {
  flushIntervalMs: number;
  idleResetMs: number;
  pageTitle: string;
}

const DEFAULT_CONFIG: PageAccumulatorConfig = {
  flushIntervalMs: 3000,
  idleResetMs: 120_000,
  pageTitle: "🔧 Task Details",
};

interface ActivePage {
  url: string;
  path: string;
  createdAt: number;
}

/**
 * Accumulates tool event details on a single Telegraph page.
 * Creates one page, then edits it periodically (every 3s) with all content.
 * Avoids FLOOD_WAIT by minimizing API calls.
 */
export class TelegraphPageAccumulator implements TechnicalDetailsPublisher {
  private readonly client: TelegraphClient;
  private readonly config: PageAccumulatorConfig;

  private activePage: ActivePage | null = null;
  private sections: Array<{ title: string; body: string }> = [];
  private lastSectionCount = 0;
  private dirty = false;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private lastPublishAt = 0;
  private creating = false;
  private createPromise: Promise<ActivePage | null> | null = null;
  private cooldownUntil = 0;
  private disposed = false;

  constructor(client: TelegraphClient, config?: Partial<PageAccumulatorConfig>) {
    this.client = client;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async publish(request: TechnicalDetailsPublishRequest): Promise<string | null> {
    if (this.disposed) return null;

    if (this.isCoolingDown()) {
      return this.activePage?.url ?? null;
    }

    // Check if page should be reset (long idle period)
    if (this.activePage && Date.now() - this.lastPublishAt > this.config.idleResetMs) {
      await this.flush();
      this.reset();
    }

    this.sections.push({ title: request.title, body: request.body });
    this.dirty = true;
    this.lastPublishAt = Date.now();

    // If no active page, create one
    if (!this.activePage) {
      const page = await this.getOrCreatePage();
      if (!page) return null;
      this.startFlushTimer();
      return page.url;
    }

    // Page exists — return URL immediately; edit will happen on timer
    return this.activePage.url;
  }

  async flush(): Promise<void> {
    if (!this.dirty || !this.activePage || this.sections.length === 0) return;
    if (this.isCoolingDown()) return;

    const fullContent = this.buildFullContent();
    try {
      const success = await this.client.editPage(
        this.activePage.path,
        this.config.pageTitle,
        fullContent,
      );
      if (success) {
        this.dirty = false;
        this.lastSectionCount = this.sections.length;
        logger.debug(`[PageAccumulator] Page updated (${this.sections.length} sections)`);
      }
    } catch (error) {
      if (error instanceof FloodWaitError) {
        this.cooldownUntil = Date.now() + error.waitMs;
        logger.warn(
          `[PageAccumulator] FLOOD_WAIT on edit (${error.waitMs}ms), pausing`,
        );
      } else {
        logger.warn("[PageAccumulator] Failed to edit page", { error });
      }
    }
  }

  reset(): void {
    this.activePage = null;
    this.sections = [];
    this.lastSectionCount = 0;
    this.dirty = false;
    this.creating = false;
    this.createPromise = null;
    this.stopFlushTimer();
  }

  dispose(): void {
    this.disposed = true;
    this.stopFlushTimer();
    void this.flush();
  }

  get pageUrl(): string | null {
    return this.activePage?.url ?? null;
  }

  get sectionCount(): number {
    return this.sections.length;
  }

  private isCoolingDown(): boolean {
    if (this.cooldownUntil === 0) return false;
    if (Date.now() >= this.cooldownUntil) {
      this.cooldownUntil = 0;
      return false;
    }
    return true;
  }

  private async getOrCreatePage(): Promise<ActivePage | null> {
    if (this.activePage) return this.activePage;

    // Deduplicate concurrent create calls
    if (this.creating && this.createPromise) {
      return this.createPromise;
    }

    this.creating = true;
    this.createPromise = this.doCreatePage();

    try {
      const result = await this.createPromise;
      return result;
    } finally {
      this.creating = false;
      this.createPromise = null;
    }
  }

  private async doCreatePage(): Promise<ActivePage | null> {
    const fullContent = this.buildFullContent();

    try {
      const result = await this.client.createPage(this.config.pageTitle, fullContent);
      if (!result) return null;

      this.activePage = {
        url: result.url,
        path: result.path,
        createdAt: Date.now(),
      };
      this.dirty = false;
      this.lastSectionCount = this.sections.length;
      logger.info(`[PageAccumulator] Created new page: ${result.url}`);
      return this.activePage;
    } catch (error) {
      if (error instanceof FloodWaitError) {
        this.cooldownUntil = Date.now() + error.waitMs;
        logger.warn(`[PageAccumulator] FLOOD_WAIT on create (${error.waitMs}ms)`);
      } else {
        logger.warn("[PageAccumulator] Failed to create page", { error });
      }
      return null;
    }
  }

  private buildFullContent(): string {
    const parts: string[] = [];

    for (let i = 0; i < this.sections.length; i++) {
      const section = this.sections[i]!;
      if (i > 0) {
        parts.push("\n---\n");
      }
      parts.push(`## ${section.title}\n`);
      parts.push(section.body);
    }

    return parts.join("\n");
  }

  private startFlushTimer(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      if (this.dirty && this.sections.length > this.lastSectionCount) {
        void this.flush();
      }
    }, this.config.flushIntervalMs);
  }

  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
}
