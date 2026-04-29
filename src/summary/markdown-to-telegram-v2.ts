import { parseTelegramBlocks } from "../telegram/render/block-parser.js";
import {
  escapeTelegramMarkdownV2Text,
  renderInlineNodesAsTelegramMarkdownV2,
} from "../telegram/render/inline-renderer.js";
import { normalizeMarkdownForTelegramRendering } from "../telegram/render/markdown-normalizer.js";
import type { TelegramBlock } from "../telegram/render/types.js";
import { logger } from "../utils/logger.js";

function hasUnbalancedTripleBacktickFence(text: string): boolean {
  const fenceMatches = text.match(/```/g);
  return fenceMatches !== null && fenceMatches.length % 2 === 1;
}

function hasUnmatchedMarkdownDelimiters(text: string): boolean {
  const unescapedDoubleAsterisks = text.match(/(?<!\\)\*\*/g);
  if (unescapedDoubleAsterisks !== null && unescapedDoubleAsterisks.length % 2 === 1) {
    return true;
  }

  const unescapedBrackets = text.match(/(?<!\\)\[/g);
  const unescapedClosingBrackets = text.match(/(?<!\\)\]/g);
  const unmatchedLinkOpener =
    (unescapedBrackets?.length ?? 0) > (unescapedClosingBrackets?.length ?? 0) ||
    /(?<!\\)\]\((?![^\s)]+\))/m.test(text);

  return unmatchedLinkOpener;
}

function renderParagraphBlock(block: Extract<TelegramBlock, { type: "paragraph" }>): string {
  return renderInlineNodesAsTelegramMarkdownV2(block.inlines);
}

function renderHeadingBlock(block: Extract<TelegramBlock, { type: "heading" }>): string {
  const content = renderInlineNodesAsTelegramMarkdownV2(block.inlines);
  return content ? `*${content}*` : "";
}

function renderBlockquoteBlock(block: Extract<TelegramBlock, { type: "blockquote" }>): string {
  return block.lines
    .map((line) =>
      renderInlineNodesAsTelegramMarkdownV2(line)
        .split("\n")
        .map((segment) => `> ${segment}`.trimEnd())
        .join("\n"),
    )
    .join("\n");
}

function renderListBlock(block: Extract<TelegramBlock, { type: "list" }>): string {
  return block.items
    .map((item, index) => {
      const marker = block.ordered ? `${index + 1}\\. ` : "- ";
      return `${marker}${renderInlineNodesAsTelegramMarkdownV2(item)}`;
    })
    .join("\n");
}

function renderCodeBlock(block: Extract<TelegramBlock, { type: "code" }>): string {
  const escapedBody = block.text.replace(/```/g, "\\`\\`\\`");
  const language = block.language?.replace(/[^A-Za-z0-9_+-]/g, "") ?? "";

  return language ? `\`\`\`${language}\n${escapedBody}\n\`\`\`` : `\`\`\`\n${escapedBody}\n\`\`\``;
}

function renderTableBlock(block: Extract<TelegramBlock, { type: "table" }>): string {
  return block.rows
    .map((row) => row.map((cell) => escapeTelegramMarkdownV2Text(cell)).join(" \\| "))
    .map((row) => `\\| ${row} \\|`)
    .join("\n");
}

function renderRuleBlock(): string {
  return "──────────";
}

function renderPlainBlock(block: Extract<TelegramBlock, { type: "plain" }>): string {
  return escapeTelegramMarkdownV2Text(block.text);
}

function renderBlock(block: TelegramBlock): string {
  switch (block.type) {
    case "paragraph":
      return renderParagraphBlock(block);
    case "heading":
      return renderHeadingBlock(block);
    case "blockquote":
      return renderBlockquoteBlock(block);
    case "list":
      return renderListBlock(block);
    case "code":
      return renderCodeBlock(block);
    case "table":
      return renderTableBlock(block);
    case "rule":
      return renderRuleBlock();
    case "plain":
      return renderPlainBlock(block);
    default: {
      const exhaustiveCheck: never = block;
      throw new Error(`Unsupported Telegram markdown block: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

function fallbackAsEscapedPlainText(markdown: string): string {
  return escapeTelegramMarkdownV2Text(markdown.trim());
}

export function convertMarkdownToTelegramV2(markdown: string): string {
  const normalizedInput = markdown.trim();
  if (!normalizedInput) {
    return "";
  }

  if (hasUnbalancedTripleBacktickFence(normalizedInput) || hasUnmatchedMarkdownDelimiters(normalizedInput)) {
    return fallbackAsEscapedPlainText(normalizedInput);
  }

  const normalizedMarkdown = normalizeMarkdownForTelegramRendering(normalizedInput);

  try {
    const rendered = parseTelegramBlocks(normalizedMarkdown)
      .map((block) => renderBlock(block))
      .filter(Boolean)
      .join("\n\n");

    return rendered || fallbackAsEscapedPlainText(normalizedInput);
  } catch (error) {
    logger.warn(
      "[Formatter] Failed to convert markdown with local Telegram renderer, falling back to escaped text",
      error,
    );
    return fallbackAsEscapedPlainText(normalizedInput);
  }
}

export function convertMalformedMarkdownToTelegramV2(markdown: string): string {
  return convertMarkdownToTelegramV2(markdown);
}
