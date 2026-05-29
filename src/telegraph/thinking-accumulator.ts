import { logger } from "../utils/logger.js";
import type { TelegraphClient } from "./telegraph-client.js";
import type { TechnicalDetailsPublishRequest, TechnicalDetailsPublisher } from "./types.js";

interface ThoughtEntry {
  timestamp: number;
  title: string;
  body: string;
}

interface ThinkingPage {
  url: string;
  path: string;
  entries: ThoughtEntry[];
  dirty: boolean;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

function entryToMarkdown(entry: ThoughtEntry): string {
  return `## ${formatTimestamp(entry.timestamp)}\n\n${entry.title}\n\n${entry.body}`;
}

function buildPageContent(entries: ThoughtEntry[]): string {
  const reversed = [...entries].reverse();
  return reversed.map(entryToMarkdown).join("\n\n---\n\n");
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

    const title = stripThinkingPrefix(request.title.trim());
    const body = stripLeadingTitle(thoughtBody, title);
    const entry: ThoughtEntry = {
      timestamp: Date.now(),
      title: title || extractFirstLine(thoughtBody),
      body,
    };

    if (this.page) {
      this.page.entries.push(entry);
      this.page.dirty = true;
      this.scheduleFlush();
      return this.page.url;
    }

    try {
      const content = entryToMarkdown(entry);
      const result = await this.client.createPage("💭 Thinking", content);
      if (!result) return null;

      this.page = {
        url: result.url,
        path: result.path,
        entries: [entry],
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
    if (!this.page || this.page.entries.length === 0) return;

    const content = buildPageContent(this.page.entries);

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

function stripThinkingPrefix(title: string): string {
  return title.replace(/^(?:💭\s*)+/u, "").trim();
}

function extractFirstLine(text: string): string {
  return text.split(/\r?\n/)[0]?.trim() || text;
}

function stripLeadingTitle(body: string, title: string): string {
  if (!title) return body;
  const trimmed = body.trimStart();
  if (trimmed.startsWith(title)) {
    const after = trimmed.slice(title.length).trimStart();
    return after || trimmed;
  }
  return trimmed;
}
