import type { PreparedLocalFileFollowUp } from "./telegram-local-file-follow-up.js";
import type { TelegramTextFormat } from "./telegram-text.js";
import { sanitizeHtmlForTelegram } from "./html-sanitize.js";

const TELEGRAM_MESSAGE_LIMIT = 4096;
/**
 * Maximum extra characters the sanitizer can add (closing tags for all allowed nestable tags).
 * Worst case: </blockquote></pre></code></s></u></i></b> = ~50 chars.
 */
const SANITIZER_HEADROOM = 64;

/**
 * Split HTML text into chunks that fit within the Telegram message limit.
 * Sanitizes each chunk to close any severed HTML tags.
 * Prefers splitting at newlines; falls back to hard split at the limit.
 */
function splitHtmlIntoChunks(html: string): string[] {
  if (html.length <= TELEGRAM_MESSAGE_LIMIT) {
    return [html];
  }

  const chunks: string[] = [];
  const splitLimit = TELEGRAM_MESSAGE_LIMIT - SANITIZER_HEADROOM;
  let remaining = html;

  while (remaining.length > TELEGRAM_MESSAGE_LIMIT) {
    // Try to split at the last newline within the limit
    let splitIndex = remaining.lastIndexOf("\n", splitLimit - 100);
    if (splitIndex <= splitLimit / 4) {
      // No good newline found, hard split at limit
      splitIndex = splitLimit;
    }
    // Sanitize the chunk to close any severed HTML tags
    chunks.push(sanitizeHtmlForTelegram(remaining.slice(0, splitIndex)));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(sanitizeHtmlForTelegram(remaining));
  }

  return chunks;
}

interface FinalizeAssistantResponseOptions {
  sessionId: string;
  messageText: string;
  sourceText?: string;
  chunks?: string[];
  draftFailed?: boolean;
  flushDraftStream: (sessionId: string) => Promise<void>;
  flushPendingServiceMessages: () => Promise<void>;
  formatSummary: (messageText: string) => string[];
  formatRawSummary: (messageText: string) => string[];
  resolveFormat: () => TelegramTextFormat;
  getReplyKeyboard: () => Promise<unknown>;
  prepareLocalFileFollowUps?: (messageText: string) => Promise<PreparedLocalFileFollowUp[]>;
  sendText: (
    text: string,
    rawFallbackText: string | undefined,
    options: { reply_markup: unknown } | undefined,
    format: TelegramTextFormat,
  ) => Promise<void>;
}

interface FinalizeAssistantResponseResult {
  followUpFiles: PreparedLocalFileFollowUp[];
}

export async function finalizeAssistantResponse({
  sessionId,
  messageText,
  sourceText,
  chunks,
  draftFailed = false,
  flushDraftStream,
  flushPendingServiceMessages,
  formatSummary,
  formatRawSummary,
  resolveFormat,
  getReplyKeyboard,
  prepareLocalFileFollowUps,
  sendText,
}: FinalizeAssistantResponseOptions): Promise<FinalizeAssistantResponseResult> {
  void draftFailed;

  // Что делает этот код:
  // - завершает основной поток ответа (draft/service flush + отправка текста),
  // - отдельно подготавливает follow-up файлы из сырого текста,
  // - но не отправляет их здесь, чтобы не блокировать основной ответ.
  // Почему выбрано это решение:
  // - асинхронная отправка follow-up медиа должна быть вынесена в orchestration слой,
  //   иначе следующий ответ может попасть в ненужную очередь ожидания.
  // Исправлено:
  // - убрана QR-специфичная блокирующая отправка из финализации.
  // Цель:
  // - вернуть кандидатов на media follow-up без влияния на отправку основного текста.
  const followUpFiles = prepareLocalFileFollowUps
    ? await prepareLocalFileFollowUps(sourceText ?? messageText)
    : [];

  await flushDraftStream(sessionId);
  await flushPendingServiceMessages();

  const format = resolveFormat();
  const keyboard = await getReplyKeyboard();
  const options = keyboard ? { reply_markup: keyboard } : undefined;

  if (chunks && chunks.length > 0) {
    for (const chunk of chunks) {
      if (!chunk.trim()) {
        continue;
      }

      // Split oversized chunks to respect Telegram's message limit
      if (format === "html" && chunk.length > TELEGRAM_MESSAGE_LIMIT) {
        const subChunks = splitHtmlIntoChunks(chunk);
        for (let subIndex = 0; subIndex < subChunks.length; subIndex++) {
          const subChunk = subChunks[subIndex];
          if (!subChunk.trim()) {
            continue;
          }
          const subOptions = subIndex === 0 ? options : undefined;
          await sendText(subChunk, undefined, subOptions, format);
        }
      } else {
        await sendText(chunk, undefined, options, format);
      }
    }
    return { followUpFiles };
  }

  if (format === "html") {
    if (messageText.trim().length > 0) {
      const htmlChunks = splitHtmlIntoChunks(messageText);
      for (let chunkIndex = 0; chunkIndex < htmlChunks.length; chunkIndex++) {
        const chunk = htmlChunks[chunkIndex];
        if (!chunk.trim()) {
          continue;
        }
        // Only attach keyboard to the first chunk
        const chunkOptions = chunkIndex === 0 ? options : undefined;
        await sendText(chunk, undefined, chunkOptions, format);
      }
    }
    return { followUpFiles };
  }

  const parts = formatSummary(messageText);
  const rawParts = formatRawSummary(messageText);

  for (let partIndex = 0; partIndex < parts.length; partIndex++) {
    const part = parts[partIndex];
    const rawFallbackText = rawParts[partIndex];
    if (!part.trim()) {
      continue;
    }
    await sendText(part, rawFallbackText, options, format);
  }

  return { followUpFiles };
}
