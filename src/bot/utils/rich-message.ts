import type { Api } from "grammy";
import { logger } from "../../utils/logger.js";

/** Bot API 10.1 rich message character limit. */
const RICH_MESSAGE_MAX_CHARS = 32768;

/** Maximum UTF-8 bytes for a rich message (Telegram docs: 65536 bytes). */
const RICH_MESSAGE_MAX_BYTES = 65536;

/** Rich payload shape sent to sendRichMessage / sendRichMessageDraft / editMessageText. */
interface RichMessagePayload {
  chat_id: number | string;
  rich_message: { markdown: string };
  message_thread_id?: number;
  direct_messages_topic_id?: number;
  reply_parameters?: { message_id: number };
  disable_notification?: boolean;
  link_preview_options?: { is_disabled?: boolean };
  message_id?: number;
  draft_id?: number;
  business_connection_id?: string;
}

type GrammyApi = Api;

interface RichSendOptions {
  /** Forum topic / thread id. */
  messageThreadId?: number;
  /** Direct Messages topic id (takes precedence over messageThreadId). */
  directMessagesTopicId?: number;
  /** Reply to message id. */
  replyToMessageId?: number;
  /** Disable notification (default: true). */
  disableNotification?: boolean;
  /** Disable link previews. */
  disableLinkPreviews?: boolean;
  /** Business connection id. */
  businessConnectionId?: string;
}

/**
 * Detect whether raw markdown text contains rich-only constructs
 * that would benefit from native Telegram rendering via sendRichMessage.
 *
 * Rich-eligible constructs: GFM tables, task lists, code blocks,
 * blockquotes, headings, <details> blocks, LaTeX math.
 */
export function isRichContent(text: string): boolean {
  if (!text) return false;

  return (
    hasGfmTable(text) ||
    hasTaskList(text) ||
    hasDetailsBlock(text) ||
    hasLatexMath(text) ||
    hasCodeBlock(text) ||
    hasBlockquote(text) ||
    hasHeading(text)
  );
}

function hasCodeBlock(text: string): boolean {
  return /^```/m.test(text);
}

function hasBlockquote(text: string): boolean {
  return /^> /m.test(text);
}

function hasHeading(text: string): boolean {
  return /^#{1,6}\s+\S/m.test(text);
}

/**
 * Format tool call output as rich markdown suitable for sendRichMessage.
 * Returns null if the output is empty or trivial.
 */
export function formatToolOutputForRichMessage(
  tool: string,
  input: Record<string, unknown> | undefined,
  output: string | undefined,
): string | null {
  if (!output || output.trim().length === 0) return null;

  const body = output.trim();

  switch (tool) {
    case "bash": {
      const cmd = typeof input?.command === "string" ? input.command.trim() : "";
      const header = cmd ? `$ ${cmd}` : "";
      return `\`\`\`bash\n${header ? `${header}\n\n` : ""}${body}\n\`\`\``;
    }
    case "write":
    case "edit": {
      const fp = typeof input?.filePath === "string" ? input.filePath.trim() : "";
      const content = typeof input?.content === "string" ? input.content : body;
      const header = fp ? `📄 ${fp}\n\n` : "";
      const lang = detectCodeLang(fp);
      return `${header}\`\`\`${lang}\n${content}\n\`\`\``;
    }
    case "read": {
      const fp = typeof input?.filePath === "string" ? input.filePath.trim() : "";
      const header = fp ? `📄 ${fp}\n\n` : "";
      const lang = detectCodeLang(fp);
      return `${header}\`\`\`${lang}\n${body}\n\`\`\``;
    }
    case "grep":
    case "glob": {
      const pattern = typeof input?.pattern === "string" ? input.pattern : "";
      const header = pattern ? `**${pattern}**\n\n` : "";
      return `${header}\`\`\`\n${body}\n\`\`\``;
    }
    case "diff":
    case "apply_patch":
    case "filediff":
      return `\`\`\`diff\n${body}\n\`\`\``;
    case "reasoning":
      return body;
    case "todowrite":
      return body;
    default:
      return `\`\`\`\n${body}\n\`\`\``;
  }
}

function detectCodeLang(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (!ext) return "";
  const langMap: Record<string, string> = {
    ts: "typescript", tsx: "typescript",
    js: "javascript", jsx: "javascript",
    py: "python", rs: "rust", go: "go",
    java: "java", kt: "kotlin", swift: "swift",
    c: "c", cpp: "cpp", h: "c", hpp: "cpp",
    css: "css", scss: "scss", html: "html", htm: "html",
    json: "json", yaml: "yaml", yml: "yaml",
    toml: "toml", xml: "xml", sql: "sql",
    sh: "bash", bash: "bash", zsh: "bash",
    md: "markdown", mdx: "markdown",
    dockerfile: "dockerfile", nix: "nix",
  };
  return langMap[ext] ?? "";
}

/**
 * Extract the raw output text from a tool info for rich message formatting.
 * Returns the most relevant content: command output, file content, diff, etc.
 */
export function extractToolOutput(tool: string, input: Record<string, unknown> | undefined, metadata: Record<string, unknown> | undefined, stateOutput: unknown): string | null {
  switch (tool) {
    case "bash": {
      const output = extractString(metadata?.output) ?? extractString(stateOutput);
      return output;
    }
    case "write":
    case "edit": {
      const content = typeof input?.content === "string" ? input.content : "";
      if (content) return content;
      return extractString(stateOutput);
    }
    case "read": {
      return readExtractContent(extractString(stateOutput));
    }
    case "grep":
    case "glob": {
      const output = extractString(metadata?.output);
      if (output) return output;
      const results = metadata?.results;
      if (Array.isArray(results)) {
        return results.map(String).join("\n");
      }
      return null;
    }
    case "diff":
    case "apply_patch":
    case "filediff":
      return extractString(metadata?.diff);
    case "reasoning":
      return extractString(metadata?.reasoningText);
    case "todowrite": {
      const todos = metadata?.todos;
      if (Array.isArray(todos)) {
        return todos
          .map((t: unknown) => {
            const item = t as Record<string, unknown>;
            const icon = item.status === "completed" ? "- [x]" : item.status === "in_progress" ? "- [ ]" : "- [ ]";
            return `${icon} ${String(item.content ?? "")}`;
          })
          .join("\n");
      }
      return null;
    }
    default:
      return extractString(metadata?.output)
        ?? extractString(metadata?.result)
        ?? extractString(stateOutput);
  }
}

function extractString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return null;
}

function readExtractContent(raw: string | null): string | null {
  if (!raw) return null;
  const contentMatch = raw.match(/<content>\s*([\s\S]*?)\s*<\/content>/i);
  if (contentMatch?.[1]) return contentMatch[1].trim();
  const entriesMatch = raw.match(/<entries>\s*([\s\S]*?)\s*<\/entries>/i);
  if (entriesMatch?.[1]) return entriesMatch[1].trim();
  return raw;
}

function hasGfmTable(text: string): boolean {
  // Pipe-delimited rows: | a | b | followed by divider |---|---|
  return /^\|.+\|$/m.test(text) && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/m.test(text);
}

function hasTaskList(text: string): boolean {
  return /^\s*[-*]\s+\[[ x]\]/m.test(text);
}

function hasDetailsBlock(text: string): boolean {
  return /<details\b[\s\S]*?<\/details>/i.test(text);
}

function hasLatexMath(text: string): boolean {
  return /\$\$[\s\S]*?\$\$/.test(text) || /\\\([\s\S]*?\\\)/.test(text);
}

function isRichSizeOk(text: string): boolean {
  return (
    text.length <= RICH_MESSAGE_MAX_CHARS &&
    Buffer.byteLength(text, "utf-8") <= RICH_MESSAGE_MAX_BYTES
  );
}

function buildRichPayload(
  chatId: number | string,
  markdown: string,
  options?: RichSendOptions,
): RichMessagePayload {
  const payload: RichMessagePayload = {
    chat_id: chatId,
    rich_message: { markdown },
    disable_notification: options?.disableNotification ?? true,
  };

  if (options?.directMessagesTopicId !== undefined) {
    payload.direct_messages_topic_id = options.directMessagesTopicId;
  } else if (options?.messageThreadId !== undefined) {
    payload.message_thread_id = options.messageThreadId;
  }

  if (options?.replyToMessageId !== undefined) {
    payload.reply_parameters = { message_id: options.replyToMessageId };
  }

  if (options?.disableLinkPreviews) {
    payload.link_preview_options = { is_disabled: true };
  }

  if (options?.businessConnectionId) {
    payload.business_connection_id = options.businessConnectionId;
  }

  return payload;
}

export interface RichSendResult {
  success: boolean;
  messageId?: number;
}

/**
 * Send a rich message via Bot API 10.1 sendRichMessage.
 * Falls back to null (caller must use legacy path) on error.
 */
export async function trySendRichMessage(
  api: GrammyApi,
  chatId: number | string,
  markdown: string,
  options?: RichSendOptions,
): Promise<RichSendResult | null> {
  if (!isRichContent(markdown) || !isRichSizeOk(markdown)) {
    return null;
  }

  const payload = buildRichPayload(chatId, markdown, options);

  try {
    const raw = (api as unknown as { raw: Record<string, (...args: unknown[]) => unknown> }).raw;
    const result = await raw.sendRichMessage(payload);
    const messageId = extractMessageId(result);
    logger.info("[RichMessage] Sent rich message", { chatId, messageId });
    return { success: true, messageId };
  } catch (error) {
    const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    logger.warn("[RichMessage] sendRichMessage failed, falling back to legacy", { chatId, error: msg });

    if (isPermanentError(msg)) {
      return { success: false };
    }

    return null;
  }
}

/**
 * Edit an existing message to become a rich message via editMessageText.
 * Bot API 10.1 allows passing rich_message to editMessageText.
 */
export async function tryEditRichMessage(
  api: GrammyApi,
  chatId: number | string,
  messageId: number,
  markdown: string,
  options?: RichSendOptions,
): Promise<RichSendResult | null> {
  if (!isRichSizeOk(markdown)) {
    return null;
  }

  const payload: RichMessagePayload = {
    chat_id: chatId,
    message_id: messageId,
    rich_message: { markdown },
  };

  if (options?.businessConnectionId) {
    payload.business_connection_id = options.businessConnectionId;
  }

  try {
    const raw = (api as unknown as { raw: Record<string, (...args: unknown[]) => unknown> }).raw;
    const result = await raw.editMessageText(payload);
    const msgId = extractMessageId(result);
    logger.info("[RichMessage] Edited to rich message", { chatId, messageId, resultId: msgId });
    return { success: true, messageId: msgId };
  } catch (error) {
    const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

    if (msg.includes("message is not modified")) {
      return { success: true, messageId };
    }

    logger.warn("[RichMessage] editMessageText rich failed, falling back", { chatId, messageId, error: msg });
    return null;
  }
}

function extractMessageId(result: unknown): number | undefined {
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.message_id === "number") return r.message_id;
    if (r.result && typeof r.result === "object") {
      const inner = r.result as Record<string, unknown>;
      if (typeof inner.message_id === "number") return inner.message_id;
    }
  }
  return undefined;
}

function isPermanentError(errorMessage: string): boolean {
  return (
    errorMessage.includes("can't parse") ||
    errorMessage.includes("method not found") ||
    errorMessage.includes("endpoint") ||
    errorMessage.includes("unknown method") ||
    errorMessage.includes("bad request: method not found")
  );
}
