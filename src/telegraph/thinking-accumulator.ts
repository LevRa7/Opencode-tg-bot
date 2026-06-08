import { logger } from "../utils/logger.js";
import { FloodWaitError } from "./telegraph-client.js";
import type { TechnicalDetailsPublishRequest, TechnicalDetailsPublisher, TelegraphPageClient } from "./types.js";
import { translateText } from "../translate/manager.js";

interface ThoughtEntry {
  timestamp: number;
  title: string;
  body: string;
  translatedBody?: string;
  locale?: string;
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
  const body = entry.translatedBody ?? entry.body;
  return `## ${formatTimestamp(entry.timestamp)}\n\n${entry.title}\n\n${body}`;
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
  private pagePath: string | null = null;
  private readonly client: TelegraphPageClient;

  constructor(client: TelegraphPageClient) {
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
      locale: request.locale,
    };

    if (this.page) {
      this.page.entries.push(entry);
      this.page.dirty = true;
      this.scheduleFlush();
      this.scheduleTranslation(entry);
      return this.page.url;
    }

    try {
      const content = entryToMarkdown(entry);
      const result = await this.client.createPage("💭 Thinking", content);
      if (!result) return null;

      this.pagePath = result.path;
      this.page = {
        url: result.url,
        path: result.path,
        entries: [entry],
        dirty: false,
      };
      this.scheduleTranslation(entry);
      return result.url;
    } catch (error) {
      logger.warn("[ThinkingAccum] Failed to create thinking page", { error });
      return null;
    }
  }

  async flush(): Promise<void> {
    if (this.page && this.page.dirty) {
      await this.doFlush(this.page);
    }
    this.page = null;
  }

  reset(): void {
    this.page = null;
  }

  private pendingFlush = false;
  private flushInProgress = false;
  private flushNeeded = false;

  private scheduleFlush(): void {
    if (this.pendingFlush) return;
    this.pendingFlush = true;
    const page = this.page;
    setImmediate(async () => {
      this.pendingFlush = false;
      if (page && page.dirty) {
        await this.doFlush(page);
      }
    });
  }

  private async doFlush(target?: ThinkingPage): Promise<boolean> {
    if (this.flushInProgress) {
      this.flushNeeded = true;
      return false;
    }
    this.flushInProgress = true;
    this.flushNeeded = false;
    try {
      return await this.doFlushInner(target);
    } finally {
      this.flushInProgress = false;
      if (this.flushNeeded) {
        this.flushNeeded = false;
        await this.doFlushInner(target);
      }
    }
  }

  private async doFlushInner(target?: ThinkingPage): Promise<boolean> {
    const page = target ?? this.page;
    if (!page || page.entries.length === 0) return false;

    const content = buildPageContent(page.entries);
    const path = page.path ?? this.pagePath;

    try {
      const success = await this.client.editPage(path, "💭 Thinking", content);
      if (success) {
        page.dirty = false;
      }
      return success;
    } catch (error) {
      if (error instanceof FloodWaitError) {
        logger.warn(
          `[ThinkingAccum] FloodWait on edit, waiting ${error.waitMs}ms then retrying`,
        );
        await new Promise((resolve) => setTimeout(resolve, error.waitMs));
        try {
          const success = await this.client.editPage(path, "💭 Thinking", content);
          if (success) {
            page.dirty = false;
          }
          return success;
        } catch (retryError) {
          logger.warn("[ThinkingAccum] Failed to edit thinking page on retry", { error: retryError });
          return false;
        }
      }
      logger.warn("[ThinkingAccum] Failed to edit thinking page", { error });
      return false;
    }
  }

  private scheduleTranslation(entry: ThoughtEntry): void {
    if (!entry.locale || entry.locale === "en" || entry.translatedBody) {
      logger.debug("[ThinkingAccum] Translation skipped in scheduleTranslation", {
        locale: entry.locale,
        localeTruthy: !!entry.locale,
        isEn: entry.locale === "en",
        hasTranslatedBody: !!entry.translatedBody,
        entryTitle: entry.title.slice(0, 80),
      });
      return;
    }

    const textToTranslate = entry.body;
    const locale = entry.locale;
    const page = this.page;

    logger.debug("[ThinkingAccum] Scheduling translation", {
      locale,
      textLength: textToTranslate.length,
      textPreview: textToTranslate.slice(0, 120),
      hasPage: !!page,
      pageUrl: page?.url,
    });

    setImmediate(async () => {
      try {
        logger.debug("[ThinkingAccum] Starting translation", { locale, textLength: textToTranslate.length });
        const translated = await translateText(textToTranslate, locale as any);
        logger.debug("[ThinkingAccum] Translation result", { hasResult: !!translated, locale });
        if (!translated || !page) {
          logger.debug("[ThinkingAccum] Translation aborted post-call", {
            hasTranslated: !!translated,
            hasPage: !!page,
          });
          return;
        }

        const storedEntry = page.entries.find((e) => e === entry);
        if (!storedEntry) {
          logger.debug("[ThinkingAccum] Entry no longer in page", {
            entryTitle: entry.title.slice(0, 80),
            pageEntryCount: page.entries.length,
          });
          return;
        }

        storedEntry.translatedBody = translated;
        page.dirty = true;
        const flushed = await this.doFlush(page);

        if (flushed) {
          logger.info("[ThinkingAccum] Translated thinking entry and updated page", {
            locale,
            url: page.url,
            entryTitle: entry.title.slice(0, 80),
            translatedPreview: translated.slice(0, 100),
          });
        } else {
          logger.warn("[ThinkingAccum] Translation succeeded but page update failed", {
            locale,
            url: page.url,
            entryTitle: entry.title.slice(0, 80),
          });
        }
      } catch (error) {
        logger.warn("[ThinkingAccum] Background translation failed", { error });
      }
    });
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
