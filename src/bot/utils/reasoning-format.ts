import { sanitizeHtmlForTelegram } from "./html-sanitize.js";

export const TELEGRAM_MESSAGE_LIMIT = 4096;
const EXPANDABLE_BLOCKQUOTE_OPEN = "<blockquote expandable>";
const BLOCKQUOTE_CLOSE = "</blockquote>";

/**
 * Maximum extra characters the sanitizer can add (closing tags for all allowed nestable tags).
 * Worst case: </blockquote></pre></code></s></u></i></b> = ~50 chars.
 * We use a generous headroom so sanitized chunks never exceed the limit.
 */
const SANITIZER_HEADROOM = 64;

function takeTextChunk(text: string, maxLength: number): { chunk: string; remaining: string } {
  if (text.length <= maxLength) {
    return {
      chunk: sanitizeHtmlForTelegram(text),
      remaining: "",
    };
  }

  // Leave headroom for closing tags the sanitizer may append
  const splitLimit = maxLength - SANITIZER_HEADROOM;

  let splitIndex = text.lastIndexOf("\n", splitLimit - 100);
  if (splitIndex <= splitLimit / 2) {
    splitIndex = text.lastIndexOf(" ", splitLimit - 100);
  }
  if (splitIndex <= splitLimit / 4) {
    splitIndex = splitLimit;
  }

  return {
    chunk: sanitizeHtmlForTelegram(text.slice(0, splitIndex)),
    remaining: text.slice(splitIndex).trimStart(),
  };
}

function wrapExpandableBlockquote(content: string): string {
  return `${EXPANDABLE_BLOCKQUOTE_OPEN}${content}${BLOCKQUOTE_CLOSE}`;
}

function splitExpandableBlockquoteChunks(
  content: string,
  maxLength: number,
  textPrefix: string,
): string[] {
  const chunks: string[] = [];
  let remaining = content;
  const wrapperLength = EXPANDABLE_BLOCKQUOTE_OPEN.length + BLOCKQUOTE_CLOSE.length;
  const prefixChunk = textPrefix ? sanitizeHtmlForTelegram(textPrefix) : "";

  if (prefixChunk && prefixChunk.length + 2 + wrapperLength >= maxLength) {
    chunks.push(prefixChunk);
  }

  while (remaining) {
    const prefix = chunks.length === 0 && prefixChunk ? `${prefixChunk}\n\n` : "";
    const contentMaxLength = maxLength - wrapperLength - prefix.length;

    if (prefix && contentMaxLength <= SANITIZER_HEADROOM) {
      chunks.push(prefixChunk);
      continue;
    }

    const { chunk, remaining: nextRemaining } = takeTextChunk(remaining, contentMaxLength);

    chunks.push(`${prefix}${wrapExpandableBlockquote(chunk)}`);
    remaining = nextRemaining;
  }

  return chunks;
}

export function splitTextIntoChunks(text: string, maxLength: number): string[] {
  const expandableSpoilerPrefix = `\n\n${EXPANDABLE_BLOCKQUOTE_OPEN}`;
  const spoilerStartsAt = text.indexOf(expandableSpoilerPrefix);

  if (text.startsWith(EXPANDABLE_BLOCKQUOTE_OPEN) && text.endsWith(BLOCKQUOTE_CLOSE)) {
    const content = text.slice(EXPANDABLE_BLOCKQUOTE_OPEN.length, -BLOCKQUOTE_CLOSE.length);
    return splitExpandableBlockquoteChunks(content, maxLength, "");
  }

  if (spoilerStartsAt !== -1 && text.endsWith(BLOCKQUOTE_CLOSE)) {
    const textPrefix = text.slice(0, spoilerStartsAt);
    const content = text.slice(
      spoilerStartsAt + expandableSpoilerPrefix.length,
      -BLOCKQUOTE_CLOSE.length,
    );
    return splitExpandableBlockquoteChunks(content, maxLength, textPrefix);
  }

  if (text.length <= maxLength) {
    return [sanitizeHtmlForTelegram(text)];
  }

  const chunks: string[] = [];
  let remaining = text;

  if (remaining) {
    while (remaining) {
      const chunkResult = takeTextChunk(remaining, maxLength);
      chunks.push(chunkResult.chunk);
      remaining = chunkResult.remaining;
    }
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

type OrderedListLine = {
  indent: string;
  marker: string;
  content: string;
};

const ORDERED_LIST_LINE_PATTERN = /^(\s*)(\d+\.\s+)(.*\S.*)$/;

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function isGfmTableDivider(line: string): boolean {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function parseGfmTableRow(line: string): string[] {
  const trimmed = line.trim();
  const withBounds = trimmed.startsWith("|") && trimmed.endsWith("|") ? trimmed : `|${trimmed}|`;
  return withBounds
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim());
}

function isGfmTableRow(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("|") &&
    trimmed.endsWith("|") &&
    trimmed.length > 2 &&
    !isGfmTableDivider(trimmed)
  );
}

function formatGfmTable(rows: string[][]): string {
  if (rows.length === 0) return "";

  const colCount = Math.max(...rows.map((r) => r.length));
  const colWidths = new Array<number>(colCount).fill(0);
  for (const row of rows) {
    for (let c = 0; c < row.length; c++) {
      colWidths[c] = Math.max(colWidths[c]!, row[c]!.length);
    }
  }

  const headerCells = colWidths.map((w, c) => (rows[0]![c] ?? "").padEnd(w));
  const header = headerCells.join(" | ");

  const divider = colWidths.map((w) => "-".repeat(w)).join("-|-");

  const bodyLines = rows.slice(1).map((row) =>
    colWidths.map((w, c) => (row[c] ?? "").padEnd(w)).join(" | "),
  );

  return [header, divider, ...bodyLines].join("\n");
}

function extractGfmTables(text: string): {
  result: string;
  tableBlocks: string[];
} {
  const tableBlocks: string[] = [];
  const lines = text.split("\n");
  const output: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const nextLine = lines[i + 1] ?? "";

    if (isGfmTableRow(line) && isGfmTableDivider(nextLine)) {
      const rows: string[][] = [];
      rows.push(parseGfmTableRow(line));

      let j = i + 2;
      while (j < lines.length && isGfmTableRow(lines[j]!)) {
        rows.push(parseGfmTableRow(lines[j]!));
        j++;
      }

      const formatted = formatGfmTable(rows);
      const placeholder = `\x00TB${tableBlocks.length}\x00`;
      tableBlocks.push(`<pre>${escapeHtml(formatted)}</pre>`);
      output.push(placeholder);
      i = j;
    } else {
      output.push(line);
      i++;
    }
  }

  return { result: output.join("\n"), tableBlocks };
}

/**
 * Convert markdown to Telegram HTML format.
 * Handles: headings, tables, blockquotes, **bold**, *italic*, `code`,
 * ```code blocks```, [text](url), ~~strikethrough~~, --- horizontal rules,
 * - unordered lists, 1. ordered lists.
 */
export function markdownToHtml(text: string): string {
  // 1. Extract code blocks (before inline code, before escaping)
  const codeBlocks: string[] = [];
  let result = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, _lang, code) => {
    const index = codeBlocks.length;
    codeBlocks.push(`<pre>${escapeHtml(code.trim())}</pre>`);
    return `\x00CB${index}\x00`;
  });

  // 2. Extract inline code
  const inlineCodes: string[] = [];
  result = result.replace(/`([^`\n]+)`/g, (_match, code) => {
    const index = inlineCodes.length;
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `\x00IC${index}\x00`;
  });

  // 3. Extract GFM tables → aligned <pre> blocks
  const { result: textWithoutTables, tableBlocks } = extractGfmTables(result);
  result = textWithoutTables;

  // 4. Escape HTML entities in remaining text
  result = escapeHtml(result);

  // 5. ATX headings (# Heading → bold) at line start
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

  // 6. Blockquotes (> text) → wrap consecutive lines in <blockquote>
  result = result.replace(
    /(?:^&gt;\s?.*$\n?)+/gm,
    (block) => {
      const content = block
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => l.replace(/^&gt;\s?/, ""))
        .join("\n");
      return `<blockquote>${content}</blockquote>`;
    },
  );

  // 7. Horizontal rules → em-dash border
  result = result.replace(/^(-{3,}|\*{3,}|_{3,})$/gm, "──────────");

  // 8. Bold: **text** or __text__
  result = result.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  result = result.replace(/__(.+?)__/g, "<b>$1</b>");

  // 9. Italic: *text* or _text_ (but not inside words for underscore)
  result = result.replace(/\*(.+?)\*/g, "<i>$1</i>");
  result = result.replace(/(?<!\w)_(.+?)_(?!\w)/g, "<i>$1</i>");

  // 10. Strikethrough: ~~text~~
  result = result.replace(/~~(.+?)~~/g, "<s>$1</s>");

  // 11. Links: [text](url) but only for explicitly safe schemes.
  result = result.replace(/\[(.+?)\]\((.+?)\)/g, (match, label, url) => {
    const normalizedUrl = String(url).trim();
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      return escapeHtml(match);
    }
    return `<a href="${normalizedUrl}">${label}</a>`;
  });

  // 12. Restore table blocks, code blocks, inline codes
  result = result.replace(/\x00TB(\d+)\x00/g, (_match, index) => tableBlocks[Number(index)]!);
  result = result.replace(/\x00CB(\d+)\x00/g, (_match, index) => codeBlocks[Number(index)]!);
  result = result.replace(/\x00IC(\d+)\x00/g, (_match, index) => inlineCodes[Number(index)]!);

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

  if (parseOrderedListLine(line)) {
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

function parseOrderedListLine(line: string): OrderedListLine | null {
  const match = ORDERED_LIST_LINE_PATTERN.exec(line);
  if (!match) {
    return null;
  }

  return {
    indent: match[1] ?? "",
    marker: match[2] ?? "",
    content: (match[3] ?? "").trim(),
  };
}

function getLeadingWhitespace(line: string): string {
  const match = line.match(/^\s*/);
  return match?.[0] ?? "";
}

function collectOrderedListBlock(
  lines: string[],
  startIndex: number,
): { text: string; nextIndex: number } {
  const orderedLines: string[] = [];
  let continuationIndent = "";
  let itemBaseIndentLength = 0;
  let itemIndex = 0;
  let firstItemIndentLength: number | null = null;
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmedRightLine = line.trimEnd();
    const trimmedLine = trimmedRightLine.trim();

    if (!trimmedLine) {
      let nextIndex = index + 1;
      while (nextIndex < lines.length && !(lines[nextIndex] ?? "").trim()) {
        nextIndex += 1;
      }

      if (nextIndex >= lines.length || !parseOrderedListLine(lines[nextIndex] ?? "")) {
        break;
      }

      index = nextIndex;
      continue;
    }

    const orderedLine = parseOrderedListLine(trimmedRightLine);
    if (orderedLine) {
      if (firstItemIndentLength === null) {
        firstItemIndentLength = orderedLine.indent.length;
      }

      const isBaseLevel = orderedLine.indent.length === firstItemIndentLength;
      const marker = isBaseLevel ? `${++itemIndex}. ` : orderedLine.marker;
      orderedLines.push(`${orderedLine.indent}${marker}${orderedLine.content}`);
      continuationIndent = `${orderedLine.indent}${" ".repeat(marker.length)}`;
      itemBaseIndentLength = orderedLine.indent.length;
      index += 1;
      continue;
    }

    if (getLeadingWhitespace(trimmedRightLine).length <= itemBaseIndentLength) {
      break;
    }

    orderedLines.push(`${continuationIndent}${trimmedLine}`);
    index += 1;
  }

  return {
    text: orderedLines.join("\n"),
    nextIndex: index,
  };
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

  for (let index = 0; index < lines.length; ) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    const nextLine = lines[index + 1]?.trim();

    if (!trimmed) {
      flushParagraph();
      index += 1;
      continue;
    }

    if (parseOrderedListLine(line)) {
      flushParagraph();
      const orderedListBlock = collectOrderedListBlock(lines, index);
      if (orderedListBlock.text) {
        blocks.push({ kind: "paragraph", text: orderedListBlock.text });
      }
      index = orderedListBlock.nextIndex;
      continue;
    }

    if (isHeadingLine(trimmed, nextLine)) {
      flushParagraph();
      const headingText = toHeadingText(trimmed);
      if (headingText) {
        blocks.push({ kind: "heading", text: headingText });
      }
      index += 1;
      continue;
    }

    paragraphLines.push(trimmed);
    index += 1;
  }

  flushParagraph();

  return blocks;
}

function renderReasoningBlocks(blocks: ReasoningBlock[]): string {
  return blocks
    .map((block) => {
      const formattedText = markdownToHtml(block.text);
      if (block.kind === "heading") {
        return `<b>${formattedText}</b>`;
      }

      return `<i><b>${formattedText}</b></i>`;
    })
    .join("\n\n");
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

  if (trimmed.startsWith("<blockquote>")) {
    return trimmed;
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

  const spoilerHtml = wrapExpandableBlockquote(spoilerContentHtml);

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
