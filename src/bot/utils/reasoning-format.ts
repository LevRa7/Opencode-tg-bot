import { sanitizeHtmlForTelegram } from "./html-sanitize.js";

const TELEGRAM_MESSAGE_LIMIT = 4096;

/**
 * Maximum extra characters the sanitizer can add (closing tags for all allowed nestable tags).
 * Worst case: </blockquote></pre></code></s></u></i></b> = ~50 chars.
 * We use a generous headroom so sanitized chunks never exceed the limit.
 */
const SANITIZER_HEADROOM = 64;

function splitTextIntoChunks(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) {
    return [sanitizeHtmlForTelegram(text)];
  }

  const chunks: string[] = [];
  let remaining = text;
  // Leave headroom for closing tags the sanitizer may append
  const splitLimit = maxLength - SANITIZER_HEADROOM;

  while (remaining.length > maxLength) {
    let splitIndex = remaining.lastIndexOf("\n", splitLimit - 100);
    if (splitIndex <= splitLimit / 2) {
      splitIndex = remaining.lastIndexOf(" ", splitLimit - 100);
    }
    if (splitIndex <= splitLimit / 4) {
      splitIndex = splitLimit;
    }

    // Sanitize each chunk to close any tags severed by the split
    chunks.push(sanitizeHtmlForTelegram(remaining.slice(0, splitIndex)));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  if (remaining) {
    chunks.push(sanitizeHtmlForTelegram(remaining));
  }

  return chunks;
}

type ReasoningBlock =
  | {
      kind: "heading";
      text: string;
    }
  | {
      kind: "paragraph";
      text: string;
    };

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Convert basic markdown to Telegram HTML format.
 * Handles: **bold**, *italic*, `code`, ```code blocks~~~, [text](url), ~~strikethrough~~.
 */
export function markdownToHtml(text: string): string {
  // Process code blocks first (before inline code, before escaping)
  // We need to escape everything outside code blocks, but preserve code content
  const codeBlocks: string[] = [];
  let result = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, _lang, code) => {
    const index = codeBlocks.length;
    codeBlocks.push(`<pre>${escapeHtml(code.trim())}</pre>`);
    return `\x00CB${index}\x00`;
  });

  // Process inline code
  const inlineCodes: string[] = [];
  result = result.replace(/`([^`\n]+)`/g, (_match, code) => {
    const index = inlineCodes.length;
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `\x00IC${index}\x00`;
  });

  // Escape HTML entities in remaining text
  result = escapeHtml(result);

  // Now apply markdown conversions on the escaped text
  // Bold: **text** or __text__
  result = result.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  result = result.replace(/__(.+?)__/g, "<b>$1</b>");

  // Italic: *text* or _text_ (but not inside words for underscore)
  result = result.replace(/\*(.+?)\*/g, "<i>$1</i>");
  result = result.replace(/(?<!\w)_(.+?)_(?!\w)/g, "<i>$1</i>");

  // Strikethrough: ~~text~~
  result = result.replace(/~~(.+?)~~/g, "<s>$1</s>");

  // Links: [text](url)
  result = result.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');

  // Restore code blocks and inline codes (they're already HTML-escaped)
  result = result.replace(/\x00CB(\d+)\x00/g, (_match, index) => codeBlocks[Number(index)]);
  result = result.replace(/\x00IC(\d+)\x00/g, (_match, index) => inlineCodes[Number(index)]);

  // Sanitize to fix any interleaved or mismatched tags from sequential regex replacements
  return sanitizeHtmlForTelegram(result);
}

function normalizeReasoning(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

function unwrapMarkdownTitle(text: string): string {
  let result = text.trim();

  const wrappers = [
    [/^\*\*(.+)\*\*$/s, "$1"],
    [/^__(.+)__$/s, "$1"],
    [/^\*(.+)\*$/s, "$1"],
    [/^_(.+)_$/s, "$1"],
    [/^`(.+)`$/s, "$1"],
  ] as const;

  for (const [pattern, replacement] of wrappers) {
    if (pattern.test(result)) {
      result = result.replace(pattern, replacement).trim();
    }
  }

  return result;
}

function isLikelyTitle(line: string, nextLine: string | undefined): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 120) {
    return false;
  }

  if (/^#{1,6}\s+/.test(trimmed)) {
    return true;
  }

  if (nextLine !== "") {
    return false;
  }

  return !/[.!?;:]$/.test(trimmed);
}

function toHeadingText(line: string): string {
  return unwrapMarkdownTitle(line.replace(/^#{1,6}\s+/, "").trim());
}

function isHeadingLine(line: string, nextLine: string | undefined): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  if (/^#{1,6}\s+/.test(trimmed)) {
    return true;
  }

  if (
    /^(\*\*.+\*\*|__.+__|\*.+\*|_.+_|`.+`)$/.test(trimmed) &&
    unwrapMarkdownTitle(trimmed) !== trimmed
  ) {
    return true;
  }

  return isLikelyTitle(trimmed, nextLine);
}

function parseReasoningBlocks(text: string): ReasoningBlock[] {
  const lines = text.split("\n");
  const blocks: ReasoningBlock[] = [];
  let paragraphLines: string[] = [];

  const flushParagraph = () => {
    const paragraphText = paragraphLines.join("\n").trim();
    if (paragraphText) {
      blocks.push({ kind: "paragraph", text: paragraphText });
    }
    paragraphLines = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    const nextLine = lines[index + 1]?.trim();

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    if (isHeadingLine(trimmed, nextLine)) {
      flushParagraph();
      const headingText = toHeadingText(trimmed);
      if (headingText) {
        blocks.push({ kind: "heading", text: headingText });
      }
      continue;
    }

    paragraphLines.push(trimmed);
  }

  flushParagraph();

  return blocks;
}

function renderReasoningBlocks(blocks: ReasoningBlock[]): string {
  return blocks
    .map((block) => {
      const escapedText = escapeHtml(block.text);
      if (block.kind === "heading") {
        return `<b>${escapedText}</b>`;
      }

      return `<i><b>${escapedText}</b></i>`;
    })
    .join("\n\n");
}

function buildReasoningEnvelope(textPrefix: string, contentHtml: string): string {
  const parts: string[] = [];

  if (textPrefix) {
    parts.push(escapeHtml(textPrefix));
  }

  if (contentHtml) {
    parts.push(contentHtml);
  }

  return `<blockquote expandable>${parts.join("\n\n")}</blockquote>`;
}

export function formatReasoningBlock(text: string): string {
  const normalized = normalizeReasoning(text);
  if (!normalized) {
    return "";
  }

  const blocks = parseReasoningBlocks(normalized);
  const contentHtml = renderReasoningBlocks(blocks);

  return contentHtml;
}

export function formatTechnicalBlock(description: string, command?: string): string {
  const escapedDesc = `<b>${escapeHtml(description)}</b>`;
  if (!command) {
    return escapedDesc;
  }
  const escapedCmd = `<pre>${escapeHtml(command)}</pre>`;
  return `${escapedDesc}\n${escapedCmd}`;
}

export function formatToolCallAsSpoiler(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }

  return `<blockquote expandable>${escapeHtml(trimmed)}</blockquote>`;
}

export function formatReasoningForTelegramHtml(
  reasoningMode: number,
  reasoningText: string,
  technicals: Array<{ description: string; command?: string }>,
  textPrefix: string = "",
): string[] {
  let spoilerContentHtml = "";

  if (reasoningMode >= 1 && reasoningText) {
    spoilerContentHtml += formatReasoningBlock(reasoningText);
  }

  if (reasoningMode >= 2 && technicals.length > 0) {
    for (const tech of technicals) {
      if (spoilerContentHtml) spoilerContentHtml += "\n\n";
      spoilerContentHtml += formatTechnicalBlock(tech.description, tech.command);
    }
  }

  if (!spoilerContentHtml) {
    return [textPrefix];
  }

  const spoilerHtml = `<blockquote expandable>${spoilerContentHtml}</blockquote>`;

  if (textPrefix) {
    const fullText = `${textPrefix}\n\n${spoilerHtml}`;
    if (fullText.length <= TELEGRAM_MESSAGE_LIMIT) {
      return [fullText];
    }
    return splitTextIntoChunks(fullText, TELEGRAM_MESSAGE_LIMIT);
  }

  if (spoilerHtml.length <= TELEGRAM_MESSAGE_LIMIT) {
    return [spoilerHtml];
  }

  return splitTextIntoChunks(spoilerHtml, TELEGRAM_MESSAGE_LIMIT);
}
