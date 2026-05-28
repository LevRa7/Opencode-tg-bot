import { redactSecrets } from "./redact.js";
import type { TechnicalProgressToolInfo } from "./types.js";

export interface TechnicalDetails {
  title: string;
  body: string;
}

type TodoStatus = "completed" | "in_progress" | "cancelled" | string;

interface TodoItem {
  content: string;
  status: TodoStatus;
}

const worthlessTexts = new Set(["", "[object Object]", "{}", "[]"]);

export function buildTechnicalDetails(toolInfo: TechnicalProgressToolInfo): TechnicalDetails | null {
  const body = buildBody(toolInfo);
  if (body === null) {
    return null;
  }

  return {
    title: toolInfo.tool,
    body: redactSecrets(body),
  };
}

function buildBody(toolInfo: TechnicalProgressToolInfo): string | null {
  const todoBody = formatTodos(toolInfo.metadata?.todos);
  const input = toolInfo.input ?? {};

  if (toolInfo.tool === "reasoning") {
    const text = stringifyCandidate(toolInfo.metadata?.reasoningText);
    if (text !== null) return stripFirstSentence(text);
  }

  if (toolInfo.tool === "todowrite" && todoBody) {
    return todoBody;
  }

  const fileDiffBody = formatFileDiff(toolInfo.metadata?.filediff, toolInfo.metadata?.diff);
  if (fileDiffBody) {
    return fileDiffBody;
  }

  if (toolInfo.tool === "write") {
    const filePath = typeof input.filePath === "string" ? input.filePath.trim() : "";
    const content = typeof input.content === "string" ? input.content : "";
    if (filePath && content) {
      const lines = content.split("\n");
      return [`📄 ${filePath}  +${lines.length} −0`, "", "```", content, "```"].join("\n");
    }
  }

  if (toolInfo.tool === "bash") {
    const command = typeof input.command === "string" ? input.command.trim() : "";
    const output = stringifyCandidate(toolInfo.metadata?.output);
    if (output) {
      const header = command ? `$ ${command}` : "";
      const body = [header, output].filter(Boolean).join("\n");
      return ["```bash", body, "```"].join("\n");
    }
  }

  if (["grep", "glob"].includes(toolInfo.tool)) {
    const output = stringifyCandidate(toolInfo.metadata?.output);
    if (output) return ["```", output, "```"].join("\n");
    const results = toolInfo.metadata?.results;
    if (Array.isArray(results) && results.length > 0) {
      return `Found ${results.length} result(s)`;
    }
  }

  // 2026-05-09: OpenCode places read tool output at the top-level `output`
  // field of the tool state (alongside `metadata`), not inside metadata.
  const toolStateOutput = (toolInfo.state as Record<string, unknown> | undefined)?.output;
  const toolInlineOutput = (toolInfo as TechnicalProgressToolInfo & { output?: unknown }).output;
  const toolOutput = extractReadContent(
    typeof toolStateOutput === "string" ? toolStateOutput : typeof toolInlineOutput === "string" ? toolInlineOutput : undefined,
  );
  const candidates = [
    toolInfo.metadata?.diff,
    toolInfo.metadata?.content,
    toolInfo.metadata?.result,
    toolInfo.metadata?.results,
    toolInfo.metadata?.reasoningText,
    toolInfo.metadata?.output,
    toolOutput,
    todoBody,
  ];

  for (const candidate of candidates) {
    const text = stringifyCandidate(candidate);
    if (text !== null) {
      return text;
    }
  }

  const filePath = typeof input.filePath === "string" ? input.filePath.trim() : "";
  if (filePath) {
    return filePath;
  }

  return null;
}

function stringifyCandidate(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const text = typeof value === "string" ? value : stringifyJson(value);
  if (text === undefined) {
    return null;
  }

  const trimmed = text.trim();
  return worthlessTexts.has(trimmed) ? null : trimmed;
}

function stringifyJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(value, redactSecretJsonValue, 2);
  } catch {
    return undefined;
  }
}

function redactSecretJsonValue(key: string, value: unknown): unknown {
  return isSecretKey(key) ? "[REDACTED]" : value;
}

function isSecretKey(key: string): boolean {
  return /(?:token|secret|password|pass|api_?key|access_?key)/i.test(key);
}

function formatTodos(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const lines = value.filter(isTodoItem).map((todo) => `${todoIcon(todo.status)} ${todo.content}`);
  if (lines.length === 0) {
    return null;
  }

  return lines.join("\n");
}

function formatFileDiff(filediff: unknown, diffText: unknown): string | null {
  if (typeof filediff !== "object" || filediff === null) {
    return null;
  }

  const fd = filediff as Record<string, unknown>;
  const file = typeof fd.file === "string" ? fd.file.trim() : "";
  const additions = typeof fd.additions === "number" ? fd.additions : null;
  const deletions = typeof fd.deletions === "number" ? fd.deletions : null;
  if (!file && additions === null && deletions === null) {
    return null;
  }

  const parts: string[] = [];
  const metric = additions !== null && deletions !== null ? `+${additions} −${deletions}` : "";
  parts.push(`${file}  ${metric}`.trim());
  parts.push("");

  const diff = typeof diffText === "string" ? diffText.trim() : "";
  if (diff) {
    parts.push("```diff");
    parts.push(diff);
    parts.push("```");
  }

  return parts.join("\n");
}

function isTodoItem(value: unknown): value is TodoItem {
  return (
    typeof value === "object" &&
    value !== null &&
    "content" in value &&
    "status" in value &&
    typeof value.content === "string" &&
    typeof value.status === "string"
  );
}

function todoIcon(status: TodoStatus): string {
  if (status === "completed") {
    return "✅";
  }

  if (status === "in_progress") {
    return "⏳";
  }

  if (status === "cancelled") {
    return "🚫";
  }

  return "⬜";
}

function stripFirstSentence(text: string): string {
  const firstLineEnd = text.indexOf("\n");
  if (firstLineEnd !== -1) {
    const after = text.slice(firstLineEnd + 1).trim();
    if (after) return after;
  }
  return text;
}

function extractReadContent(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;

  const contentMatch = raw.match(/<content>\s*([\s\S]*?)\s*<\/content>/i);
  if (contentMatch?.[1]) return contentMatch[1].trim();

  const entriesMatch = raw.match(/<entries>\s*([\s\S]*?)\s*<\/entries>/i);
  if (entriesMatch?.[1]) return entriesMatch[1].trim();

  return raw;
}
