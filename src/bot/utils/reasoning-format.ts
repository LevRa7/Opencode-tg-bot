const TELEGRAM_MESSAGE_LIMIT = 4096;

function splitTextIntoChunks(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitIndex = remaining.lastIndexOf("\n", maxLength - 100);
    if (splitIndex <= maxLength / 2) {
      splitIndex = remaining.lastIndexOf(" ", maxLength - 100);
    }
    if (splitIndex <= maxLength / 4) {
      splitIndex = maxLength;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  if (remaining) {
    chunks.push(remaining);
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

export function formatReasoningForTelegramHtml(
  reasoningMode: number,
  reasoningText: string,
  technicals: Array<{ description: string; command?: string }>,
  textPrefix: string = "",
): string[] {
  let contentHtml = "";

  if (reasoningMode >= 1 && reasoningText) {
    contentHtml += formatReasoningBlock(reasoningText);
  }

  if (reasoningMode >= 2 && technicals.length > 0) {
    for (const tech of technicals) {
      if (contentHtml) contentHtml += "\n\n";
      contentHtml += formatTechnicalBlock(tech.description, tech.command);
    }
  }

  if (!contentHtml) {
    return [textPrefix];
  }

  // Combined block mode 3 or simple split mode for others
  const isCombined = reasoningMode === 3;
  const wrapped = isCombined
    ? `<blockquote expandable>${contentHtml}</blockquote>`
    : `<blockquote>${contentHtml}</blockquote>`;

  // Answer (textPrefix) comes BEFORE reasoning block for better readability
  const fullText = textPrefix ? `${textPrefix}\n\n${wrapped}` : wrapped;

  if (fullText.length <= TELEGRAM_MESSAGE_LIMIT) {
    return [fullText];
  }

  return splitTextIntoChunks(fullText, TELEGRAM_MESSAGE_LIMIT);
}
