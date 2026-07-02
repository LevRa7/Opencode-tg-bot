import { normalizePathForDisplay } from "../formatter.js";
import type { TechnicalProgressToolInfo } from "./types.js";
import { redactSecrets } from "./redact.js";

function basename(p: string): string {
  return p.replace(/\\/g, "/").replace(/^.*[/]/, "") || p;
}

const TITLE_LIMIT = 96;
const BASH_COMMAND_LIMIT = 60;

function truncate(text: string, limit = TITLE_LIMIT): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

function stripMarkdownEmphasis(text: string): string {
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .trim();
}

function firstStringField(input: Record<string, unknown>, fields: string[]): string {
  for (const field of fields) {
    const value = input[field];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function fileDiffPath(metadata: Record<string, unknown>): string {
  const filediff = metadata.filediff;
  if (filediff && typeof filediff === "object" && "file" in filediff && typeof filediff.file === "string") {
    return filediff.file;
  }
  return "";
}

function pathFromPatchTitle(title: string): string {
  for (const line of title.split(/\r?\n/)) {
    const match = line.match(/^[A-Z?]+\s+(.+)$/);
    if (match?.[1]?.trim()) {
      return match[1].trim();
    }
  }
  return "";
}

function normalizeDiffPath(filePath: string): string {
  if (filePath === "/dev/null") {
    return "";
  }
  return filePath.replace(/^[ab]\//, "");
}

function pathFromPatchText(patchText: string): string {
  const addedPath = patchText.match(/^\+\+\+\s+([^\t\r\n]+)/m)?.[1]?.trim() ?? "";
  const normalizedAddedPath = normalizeDiffPath(addedPath);
  if (normalizedAddedPath) {
    return normalizedAddedPath;
  }

  const removedPath = patchText.match(/^---\s+([^\t\r\n]+)/m)?.[1]?.trim() ?? "";
  return normalizeDiffPath(removedPath);
}

export function buildProgressTitle(toolInfo: Pick<TechnicalProgressToolInfo, "tool" | "input" | "title" | "metadata">): string {
  const input = toolInfo.input ?? {};
  const metadata = toolInfo.metadata ?? {};

  // If the model generated a meaningful title, use it directly.
  // Skip for reasoning (handled separately) and bash where title == raw command.
  const modelTitle = toolInfo.title?.trim();
  if (modelTitle && toolInfo.tool !== "reasoning") {
    const cmd = typeof input?.command === "string" ? input.command.trim() : "";
    const isRawCommand = cmd && (modelTitle === cmd || modelTitle.startsWith(cmd.slice(0, 40)));
    if (!isRawCommand) {
      return truncate(redactSecrets(stripMarkdownEmphasis(modelTitle)));
    }
  }

  let title = toolInfo.title ?? "";

  if (["read", "write", "edit"].includes(toolInfo.tool)) {
    title = firstStringField(input, ["filePath", "path"]);
    title = title ? basename(normalizePathForDisplay(title) || title) : title;
  } else if (toolInfo.tool === "apply_patch") {
    const patchText = firstStringField(input, ["patchText"]);
    title = fileDiffPath(metadata) || pathFromPatchTitle(title) || firstStringField(input, ["filePath", "path"]) || pathFromPatchText(patchText);
    title = title ? basename(normalizePathForDisplay(title) || title) : "patch";
  } else if (toolInfo.tool === "bash") {
    title = firstStringField(input, ["command", "description"]);
    title = truncate(redactSecrets(stripMarkdownEmphasis(title)), BASH_COMMAND_LIMIT);
    return title || toolInfo.tool;
  } else if (["grep", "glob", "web-search_tavily_search"].includes(toolInfo.tool)) {
    title = firstStringField(input, ["pattern", "query"]);
  } else if (["webfetch", "web-search_tavily_extract"].includes(toolInfo.tool)) {
    const url = firstStringField(input, ["url"]);
    title = url ? hostFromUrl(url) : "web page";
  } else if (toolInfo.tool === "task") {
    title = firstStringField(input, ["description", "prompt", "text"]);
  } else if (toolInfo.tool === "reasoning") {
    title = toolInfo.title || firstStringField(input, ["title", "text"]);
  } else if (toolInfo.tool === "todowrite") {
    title = "todo list";
  } else {
    title = firstStringField(input, ["query", "url", "name", "prompt", "text", "command"]);
  }

  return truncate(redactSecrets(stripMarkdownEmphasis(title || toolInfo.tool)));
}
