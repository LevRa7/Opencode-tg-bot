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
