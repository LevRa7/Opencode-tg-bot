import { logger } from "../utils/logger.js";
import { FloodWaitError } from "./telegraph-client.js";
import type { TelegraphPageClient } from "./types.js";

interface LogEntry {
  timestamp: number;
  text: string;
}

interface SubagentPage {
  url: string;
  path: string;
  entries: LogEntry[];
  lastSyncedCount: number;
  dirty: boolean;
}

export interface SubagentLogEvent {
  sessionId: string;
  title: string;
  tool?: string;
  detail?: string;
  status?: string;
}

const FLUSH_INTERVAL_MS = 5000;

/**
 * Manages per-subagent Telegraph pages with activity logs.
 * Creates one page per child session, updates every 3 seconds.
 */
export class SubagentTelegraphLogger {
  private readonly pages = new Map<string, SubagentPage>();
  private readonly pending = new Map<string, LogEntry[]>();
  private readonly client: TelegraphPageClient;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private cooldownUntil = 0;

  constructor(client: TelegraphPageClient) {
    this.client = client;
    this.startFlushTimer();
  }

  /**
   * Appends a log entry for a subagent session.
   * Returns the page URL (creates page on first call for this session).
   */
  async logEvent(event: SubagentLogEvent): Promise<string | null> {
    const entry: LogEntry = {
      timestamp: Date.now(),
      text: this.formatEntry(event),
    };

    const existing = this.pages.get(event.sessionId);
    if (existing) {
      existing.entries.push(entry);
      existing.dirty = true;
      return existing.url;
    }

    // Accumulate entries until page is created
    const pendingEntries = this.pending.get(event.sessionId) ?? [];
    pendingEntries.push(entry);
    this.pending.set(event.sessionId, pendingEntries);

    // Try to create the page
    if (pendingEntries.length === 1) {
      return this.createPage(event.sessionId, event.title);
    }

    return null;
  }

  getPageUrl(sessionId: string): string | null {
    return this.pages.get(sessionId)?.url ?? null;
  }

  dispose(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    void this.flushAll();
  }

  private async createPage(sessionId: string, title: string): Promise<string | null> {
    if (this.isCoolingDown()) return null;

    const entries = this.pending.get(sessionId) ?? [];
    const content = this.buildContent(entries);

    try {
      const result = await this.client.createPage(`🧩 ${title}`, content);
      if (!result) return null;

      this.pages.set(sessionId, {
        url: result.url,
        path: result.path,
        entries,
        lastSyncedCount: entries.length,
        dirty: false,
      });
      this.pending.delete(sessionId);
      logger.debug(`[SubagentLogger] Created page for ${sessionId}: ${result.url}`);
      return result.url;
    } catch (error) {
      if (error instanceof FloodWaitError) {
        this.cooldownUntil = Date.now() + error.waitMs;
        logger.warn(`[SubagentLogger] FLOOD_WAIT on create: ${error.waitMs}ms`);
      }
      return null;
    }
  }

  private async flushAll(): Promise<void> {
    if (this.isCoolingDown()) return;

    for (const [sessionId, page] of this.pages) {
      if (page.dirty && page.entries.length > page.lastSyncedCount) {
        await this.flushPage(sessionId, page);
      }
    }
  }

  private async flushPage(sessionId: string, page: SubagentPage): Promise<void> {
    const content = this.buildContent(page.entries);

    try {
      const success = await this.client.editPage(page.path, `🧩 Subagent Log`, content);
      if (success) {
        page.dirty = false;
        page.lastSyncedCount = page.entries.length;
      }
    } catch (error) {
      if (error instanceof FloodWaitError) {
        this.cooldownUntil = Date.now() + error.waitMs;
        logger.warn(`[SubagentLogger] FLOOD_WAIT on edit: ${error.waitMs}ms`);
      }
    }
  }

  private buildContent(entries: LogEntry[]): string {
    if (entries.length === 0) return "(no activity yet)";

    const lines: string[] = [];
    for (const entry of entries) {
      const time = new Date(entry.timestamp).toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      lines.push(`**${time}** ${entry.text}`);
    }
    return lines.join("\n\n");
  }

  private formatEntry(event: SubagentLogEvent): string {
    if (event.status === "completed") return "✅ Completed";
    if (event.status === "error") return `❌ Error`;
    if (event.tool && event.detail) return `${event.tool}: ${event.detail}`;
    if (event.tool) return event.tool;
    return "⚙️ Working...";
  }

  private isCoolingDown(): boolean {
    if (this.cooldownUntil === 0) return false;
    if (Date.now() >= this.cooldownUntil) {
      this.cooldownUntil = 0;
      return false;
    }
    return true;
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      void this.flushAll();
    }, FLUSH_INTERVAL_MS);
  }
}
