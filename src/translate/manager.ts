import { logger } from "../utils/logger.js";
import { config } from "../config.js";
import type { Locale } from "../i18n/index.js";

interface LibreTranslateResponse {
  translatedText: string;
}

export function isTranslationEnabled(): boolean {
  return !!(config.telegraph?.translateEnabled && config.telegraph?.translateApiUrl);
}

export async function translateText(
  text: string,
  locale: Locale,
): Promise<string | null> {
  if (!isTranslationEnabled() || locale === "en" || !text.trim()) {
    return null;
  }

  const apiUrl = config.telegraph.translateApiUrl;
  if (!apiUrl) return null;

  logger.debug("[Translate] Translating", { locale, textLength: text.length });

  try {
    const response = await fetch(`${apiUrl}/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        q: text,
        source: "en",
        target: locale,
        format: "text",
      }),
    });

    if (!response.ok) {
      logger.warn("[Translate] API error", { status: response.status });
      return null;
    }

    const data = (await response.json()) as LibreTranslateResponse;
    const translated = data?.translatedText?.trim();

    if (!translated) return null;

    logger.debug("[Translate] OK", { locale, preview: translated.slice(0, 80) });
    return translated;
  } catch (error) {
    logger.warn("[Translate] Request failed", { error });
    return null;
  }
}


// ====== TRANSLATION POOL ======

class TranslatePool {
  private active = 0;
  private readonly maxConcurrent: number;
  private readonly maxQueueSize: number;
  private readonly timeoutMs: number;
  private queue: Array<{
    text: string;
    locale: string;
    resolve: (value: string | null) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];
  private disposed = false;

  constructor(maxConcurrent = 3, maxQueueSize = 50, timeoutMs = 15000) {
    this.maxConcurrent = maxConcurrent;
    this.maxQueueSize = maxQueueSize;
    this.timeoutMs = timeoutMs;
  }

  async translate(text: string, locale: string): Promise<string | null> {
    if (this.disposed) return null;
    if (!text.trim() || locale === "en") return null;

    if (this.queue.length >= this.maxQueueSize) {
      logger.warn("[TranslatePool] Queue overflow, rejecting request");
      return null;
    }

    return new Promise<string | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeFromQueue(text);
        resolve(null);
      }, this.timeoutMs);

      this.queue.push({ text, locale, resolve, reject, timer });
      this.processQueue();
    });
  }

  private removeFromQueue(text: string): void {
    this.queue = this.queue.filter(item => item.text !== text);
  }

  private async processQueue(): Promise<void> {
    if (this.active >= this.maxConcurrent || this.queue.length === 0) return;

    this.active++;
    const item = this.queue.shift()!;
    clearTimeout(item.timer);

    try {
      const result = await fetchWithTimeout(item.text, item.locale, this.timeoutMs);
      item.resolve(result);
    } catch {
      item.resolve(null);
    } finally {
      this.active--;
      if (!this.disposed) {
        setImmediate(() => this.processQueue());
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const item of this.queue) {
      clearTimeout(item.timer);
      item.resolve(null);
    }
    this.queue = [];
  }
}

async function fetchWithTimeout(text: string, locale: string, timeoutMs: number): Promise<string | null> {
  if (!isTranslationEnabled()) return null;

  const apiUrl = config.telegraph.translateApiUrl;
  if (!apiUrl) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${apiUrl}/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: text, source: "en", target: locale, format: "text" }),
      signal: controller.signal,
    });

    if (!response.ok) return null;
    const data = await response.json() as { translatedText?: string };
    return data?.translatedText?.trim() ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const translatePool = new TranslatePool();
