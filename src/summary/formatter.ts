import { ToolInfo } from "./aggregator.js";
import { formatTechnicalProgressSync } from "./technical-progress/formatter.js";
import * as path from "path";
import { config } from "../config.js";
import type { MessageFormatMode } from "../config.js";
import { logger } from "../utils/logger.js";
import { t } from "../i18n/index.js";
import { getCurrentProject } from "../settings/manager.js";
import { convertMarkdownToTelegramV2 } from "./markdown-to-telegram-v2.js";

const TELEGRAM_MESSAGE_LIMIT = 4096;
const MARKDOWN_V2_RESERVED_CHARS = /([_\*\[\]\(\)~`>#+\-=|{}.!\\])/g;

interface SplitTextOptions {
  avoidTrailingMarkdownEscape?: boolean;
}

function endsWithOddTrailingBackslashes(text: string, start: number, end: number): boolean {
  let backslashCount = 0;

  for (let index = end - 1; index >= start; index--) {
    if (text[index] !== "\\") {
      break;
    }
    backslashCount += 1;
  }

  return backslashCount % 2 === 1;
}

function resolveSplitEndIndex(
  text: string,
  currentIndex: number,
  maxLength: number,
  options?: SplitTextOptions,
): number {
  const hardLimit = Math.min(text.length, currentIndex + maxLength);
  if (hardLimit >= text.length) {
    return text.length;
  }

  let endIndex = hardLimit;
  const breakPoint = text.lastIndexOf("\n", endIndex);
  if (breakPoint > currentIndex) {
    endIndex = breakPoint + 1;
  }

  if (!options?.avoidTrailingMarkdownEscape) {
    return endIndex;
  }

  while (endIndex > currentIndex && endsWithOddTrailingBackslashes(text, currentIndex, endIndex)) {
    endIndex -= 1;
  }

  return endIndex > currentIndex ? endIndex : hardLimit;
}

function splitText(text: string, maxLength: number, options?: SplitTextOptions): string[] {
  const parts: string[] = [];
  let currentIndex = 0;

  while (currentIndex < text.length) {
    const endIndex = resolveSplitEndIndex(text, currentIndex, maxLength, options);

    if (endIndex <= currentIndex) {
      const fallbackEnd = Math.min(text.length, currentIndex + 1);
      parts.push(text.slice(currentIndex, fallbackEnd));
      currentIndex = fallbackEnd;
      continue;
    }

    parts.push(text.slice(currentIndex, endIndex));
    currentIndex = endIndex;
  }

  return parts;
}

export function normalizePathForDisplay(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const project = getCurrentProject();

  if (!project?.worktree) {
    return normalizedPath;
  }

  const normalizedWorktree = project.worktree.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalizedWorktree) {
    return normalizedPath;
  }

  const pathForCompare =
    process.platform === "win32" ? normalizedPath.toLowerCase() : normalizedPath;
  const worktreeForCompare =
    process.platform === "win32" ? normalizedWorktree.toLowerCase() : normalizedWorktree;

  if (pathForCompare === worktreeForCompare) {
    return ".";
  }

  const worktreePrefix = `${worktreeForCompare}/`;
  if (pathForCompare.startsWith(worktreePrefix)) {
    return normalizedPath.slice(normalizedWorktree.length + 1);
  }

  return normalizedPath;
}

export function formatSummary(text: string): string[] {
  return formatSummaryWithMode(text, config.bot.messageFormatMode);
}

export function getAssistantParseMode(): "MarkdownV2" | undefined {
  if (config.bot.messageFormatMode === "markdown") {
    return "MarkdownV2";
  }

  return undefined;
}

export function escapePlainTextForTelegramMarkdownV2(text: string): string {
  return text.replace(MARKDOWN_V2_RESERVED_CHARS, "\\$1");
}

function formatMarkdownForTelegram(text: string): string {
  try {
    return escapeMarkdownV2PipesOutsideCode(convertMarkdownToTelegramV2(text));
  } catch (error) {
    logger.warn("[Formatter] Failed to convert markdown summary, falling back to raw text", error);
    return text;
  }
}

function escapeMarkdownV2PipesOutsideCode(text: string): string {
  let result = "";
  let index = 0;
  let inInlineCode = false;
  let inCodeFence = false;

  while (index < text.length) {
    if (text.startsWith("```", index)) {
      result += "```";
      index += 3;
      inCodeFence = !inCodeFence;
      continue;
    }

    const char = text[index];

    if (!inCodeFence && char === "`") {
      inInlineCode = !inInlineCode;
      result += char;
      index += 1;
      continue;
    }

    if (!inCodeFence && !inInlineCode && char === "|" && text[index - 1] !== "\\") {
      result += "\\|";
      index += 1;
      continue;
    }

    result += char;
    index += 1;
  }

  return result;
}

export function formatSummaryWithMode(
  text: string,
  mode: MessageFormatMode,
  maxLength: number = TELEGRAM_MESSAGE_LIMIT,
): string[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const normalizedMaxLength = Math.max(1, Math.floor(maxLength));
  const rawTextLimit =
    mode === "raw" ? Math.max(1, normalizedMaxLength - "```\n\n```".length) : normalizedMaxLength;
  const parts = splitText(text, rawTextLimit);
  const formattedParts: string[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }

    if (mode === "markdown") {
      const converted = formatMarkdownForTelegram(trimmed);
      const convertedParts = splitText(converted, normalizedMaxLength, {
        avoidTrailingMarkdownEscape: true,
      });

      for (const convertedPart of convertedParts) {
        const normalizedPart = convertedPart.trim();
        if (normalizedPart) {
          formattedParts.push(normalizedPart);
        }
      }
      continue;
    }

    if (parts.length > 1) {
      formattedParts.push(`\`\`\`\n${trimmed}\n\`\`\``);
    } else {
      formattedParts.push(trimmed);
    }
  }

  return formattedParts;
}

export function countDiffChangesFromText(text: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;

  for (const line of text.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      additions++;
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      deletions++;
    }
  }

  return { additions, deletions };
}

export function extractFirstUpdatedFileFromTitle(title: string): string {
  for (const rawLine of title.split("\n")) {
    const line = rawLine.trim();
    if (line.length >= 3 && line[1] === " " && /[AMDURC]/.test(line[0])) {
      return line.slice(2).trim();
    }
  }
  return "";
}

export function formatToolInfo(toolInfo: ToolInfo): string | null {
  return formatTechnicalProgressSync(toolInfo).text;
}

export function formatCompactToolInfo(toolInfo: ToolInfo, maxLength = 64, fallback = "-"): string {
  const formatted = formatToolInfo(toolInfo);
  const normalized = formatted?.replace(/\s*\n+\s*/g, " ").trim() ?? "";

  if (!normalized) {
    return fallback;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export interface CodeFileData {
  buffer: Buffer;
  filename: string;
  caption: string;
  captionFormat?: "html";
}

function formatDiff(diff: string): string {
  const lines = diff.split("\n");
  const formattedLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("@@")) {
      continue;
    }
    if (line.startsWith("---") || line.startsWith("+++")) {
      continue;
    }
    if (line.startsWith("Index:")) {
      continue;
    }
    if (line.startsWith("===") && line.includes("=")) {
      continue;
    }
    if (line.startsWith("\\ No newline")) {
      continue;
    }

    if (line.startsWith(" ")) {
      formattedLines.push(" " + line.slice(1));
    } else if (line.startsWith("+")) {
      formattedLines.push("+ " + line.slice(1));
    } else if (line.startsWith("-")) {
      formattedLines.push("- " + line.slice(1));
    } else {
      formattedLines.push(line);
    }
  }

  return formattedLines.join("\n");
}

export function prepareCodeFile(
  content: string,
  filePath: string,
  operation: "write" | "edit",
): CodeFileData | null {
  const displayPath = normalizePathForDisplay(filePath);
  let processedContent = content;

  if (operation === "edit") {
    processedContent = formatDiff(content);
  }

  const sizeKb = Buffer.byteLength(processedContent, "utf8") / 1024;

  if (sizeKb > config.files.maxFileSizeKb) {
    logger.debug(
      `[Formatter] File too large: ${displayPath} (${sizeKb.toFixed(2)} KB > ${config.files.maxFileSizeKb} KB)`,
    );
    return null;
  }

  const header =
    operation === "write"
      ? t("tool.file_header.write", { path: displayPath })
      : t("tool.file_header.edit", { path: displayPath });
  const fullContent = header + processedContent;

  const buffer = Buffer.from(fullContent, "utf8");
  const basename = path.basename(filePath);
  const filename = `${operation}_${basename}.txt`;

  return { buffer, filename, caption: "" };
}
