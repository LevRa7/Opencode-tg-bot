const TELEGRAM_MESSAGE_LIMIT = 4096;

type ReasoningBlock =
  | {
      kind: "heading";
      text: string;
    }
  | {
      kind: "paragraph";
      text: string;
    };

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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

      return `<i>${escapedText}</i>`;
    })
    .join("\n\n");
}

function renderReasoningHtmlChunk(text: string, prefix: string): string {
  const normalized = normalizeReasoning(text);
  if (!normalized) {
    return prefix;
  }

  const blocks = parseReasoningBlocks(normalized);
  const contentHtml = renderReasoningBlocks(blocks);

  return `${prefix}\n\n<blockquote expandable>${contentHtml}</blockquote>`;
}

export function formatReasoningForTelegramHtml(reasoningText: string, prefix: string): string[] {
  const normalized = normalizeReasoning(reasoningText);
  if (!normalized) {
    return [prefix];
  }

  const rendered = renderReasoningHtmlChunk(normalized, prefix);
  if (rendered.length <= TELEGRAM_MESSAGE_LIMIT) {
    return [rendered];
  }

  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > 0) {
    let splitIndex = remaining.lastIndexOf("\n", 3000);
    if (splitIndex <= 0 || splitIndex < 1800) {
      splitIndex = remaining.lastIndexOf(" ", 3000);
    }
    if (splitIndex <= 0 || splitIndex < 1800) {
      splitIndex = Math.min(3000, remaining.length);
    }

    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks.map((chunk) => renderReasoningHtmlChunk(chunk, prefix));
}
