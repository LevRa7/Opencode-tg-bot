import type { Api } from "grammy";
import { logger } from "../../utils/logger.js";
import { t, type Locale } from "../../i18n/index.js";
import { markdownToHtml } from "./reasoning-format.js";

/** Bot API 10.1 rich message character limit. */
const RICH_MESSAGE_MAX_CHARS = 32768;

/** Maximum UTF-8 bytes for a rich message (Telegram docs: 65536 bytes). */
const RICH_MESSAGE_MAX_BYTES = 65536;

/** Inner-payload char budget; headroom under RICH_MESSAGE_MAX_CHARS for wrapper + marker. */
const RICH_INNER_BUDGET_CHARS = 30000;

/** Inner-payload byte budget; headroom under RICH_MESSAGE_MAX_BYTES. */
const RICH_INNER_BUDGET_BYTES = 60000;

export interface RichTruncation {
  text: string;
  truncated: boolean;
  shownLines: number;
  totalLines: number;
}

/**
 * Truncate text to char and byte budgets on a line boundary.
 * Used to keep an inline rich diff/content within Telegram's rich-message limits.
 */
export function truncateForRich(
  text: string,
  charBudget: number,
  byteBudget: number,
): RichTruncation {
  const totalLines = text.split("\n").length;
  let cut = text;
  let truncated = false;

  if (cut.length > charBudget) {
    cut = cut.slice(0, charBudget);
    truncated = true;
  }

  // Geometric 10% shrink per pass: fast convergence; budgets are assumed positive.
  while (cut.length > 0 && Buffer.byteLength(cut, "utf-8") > byteBudget) {
    cut = cut.slice(0, Math.floor(cut.length * 0.9));
    truncated = true;
  }

  if (truncated) {
    // Only trim to a newline when one exists past index 0 (avoid emptying single-line content).
    const lastNewline = cut.lastIndexOf("\n");
    if (lastNewline > 0) {
      cut = cut.slice(0, lastNewline);
    }
  }

  const shownLines = cut.split("\n").length;
  return { text: cut, truncated, shownLines, totalLines };
}

/** Rich payload shape sent to sendRichMessage / sendRichMessageDraft / editMessageText. */
interface RichMessagePayload {
  chat_id: number | string;
  rich_message: { markdown?: string; html?: string };
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
  /** Use HTML instead of markdown for the rich_message payload. */
  useHtml?: boolean;
}

/** Rich message draft payload shape. */
interface RichDraftPayload {
  chat_id: number | string;
  draft_id: number;
  rich_message: { markdown?: string; html?: string };
  message_thread_id?: number;
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
    hasHeading(text) ||
    hasInlineMarkdown(text)
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

function hasInlineMarkdown(text: string): boolean {
  // Fixed 2026-06-30: final prose with only inline markup, e.g.
  // `Итог: **...**`, bypassed rich delivery and could arrive with literal
  // asterisks. Keep this intentionally narrow to avoid treating arithmetic
  // `2 * 3` or ordinary punctuation as rich content.
  return (
    /(^|\s)\*\*\S[\s\S]*?\S\*\*(?=\s|[.!?,:;)]|$)/.test(text) ||
    /(^|\s)__\S[\s\S]*?\S__(?=\s|[.!?,:;)]|$)/.test(text) ||
    /(^|\s)~~\S[\s\S]*?\S~~(?=\s|[.!?,:;)]|$)/.test(text) ||
    /`[^`\n]+`/.test(text) ||
    /\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)/i.test(text)
  );
}

/**
 * Format tool call output as a clickable details block.
 * Title is the <summary> (always visible), output is hidden inside.
 *
 * Body is rendered markdown-consistently: fenced branches keep their content
 * literal; non-fenced branches (reasoning/todowrite) emit raw markdown so it
 * renders (fixes raw-tag display). Oversized payloads are truncated with a
 * localized marker.
 */
export function formatToolOutputForRichMessage(
  tool: string,
  title: string | undefined,
  input: Record<string, unknown> | undefined,
  output: string | undefined,
  metadata?: Record<string, unknown>,
  stateOutput?: unknown,
  locale?: Locale,
): string | null {
  if (!output || output.trim().length === 0) return null;

  const body = output.trim();
  // toolRichLabel returns HTML-safe <summary> content (it escapes internally and
  // may wrap the read/write path in <code>), so it must NOT be re-escaped here.
  const summaryHtml = toolRichLabel(tool, title, input, metadata, stateOutput);

  // Append diff stats for edit/write/diff tools
  const diffTools = new Set(["edit", "write", "apply_patch", "diff", "filediff"]);
  let summaryWithStats = summaryHtml;
  if (diffTools.has(tool)) {
    // Try metadata.diff first, fall back to output body
    const diffText = extractString(metadata?.diff) ?? (output || undefined);
    const stats = countDiffStats(diffText ?? undefined);
    if (stats) {
      if (summaryWithStats.endsWith("</summary>")) {
        summaryWithStats = summaryWithStats.replace("</summary>", `${stats}</summary>`);
      } else {
        summaryWithStats += stats;
      }
    }
  }

  const openAttr = tool === "todowrite" ? " open" : "";

  // Decide the raw inner payload and its fence language (null = raw markdown body).
  let inner: string;
  let fenceLang: string | null;
  switch (tool) {
    case "bash": {
      const cmd = typeof input?.command === "string" ? input.command.trim() : "";
      inner = cmd ? `$ ${cmd}\n${body}` : body;
      fenceLang = "bash";
      break;
    }
    case "write": {
      inner = typeof input?.content === "string" ? input.content : body;
      fenceLang = detectCodeLang(typeof input?.filePath === "string" ? input.filePath : "");
      break;
    }
    case "edit":
    case "apply_patch":
    case "diff":
    case "filediff":
      inner = body;
      fenceLang = "diff";
      break;
    case "read": {
      inner = body;
      fenceLang = detectCodeLang(typeof input?.filePath === "string" ? input.filePath : "");
      break;
    }
    case "grep":
    case "glob":
      inner = body;
      fenceLang = "";
      break;
    case "reasoning":
    case "todowrite":
    case "skill":
      inner = body;
      fenceLang = null;
      break;
    default:
      inner = body;
      fenceLang = "";
      break;
  }

  // Neutralize structural <details>/<summary> markup before truncation so the
  // zero-width-space expansion is counted within the size budget, and so fenced
  // branches are protected too.
  const safeInner = neutralizeDetailsMarkup(inner);
  const { text: truncatedInner, truncated, shownLines, totalLines } = truncateForRich(
    safeInner,
    RICH_INNER_BUDGET_CHARS,
    RICH_INNER_BUDGET_BYTES,
  );

  if (truncated) {
    logger.debug("[RichMessage] Tool output truncated for rich message", {
      tool,
      shownLines,
      totalLines,
      originalChars: safeInner.length,
      originalBytes: Buffer.byteLength(safeInner, "utf-8"),
    });
  }

  // Unfenced tools (reasoning, todowrite, skill): body is raw markdown/text
  // placed directly inside <details>. Telegram's rich markdown parser treats
  // literal HTML-like tokens (<tag>, &amp;, etc.) as real HTML inside the
  // collapsible block.  Pass through markdownToHtml to convert markdown
  // formatting (**bold**, `code`, etc.) to Telegram-safe HTML while escaping
  // raw < > & so they render as text rather than being interpreted as HTML tags.
  // Fixed 2026-06-27: was raw truncatedInner — literal <tag> leaked as HTML.
  let content =
    fenceLang === null
      ? markdownToHtml(truncatedInner)
      : fencedCodeBlock(fenceLang, truncatedInner);

  if (truncated) {
    const marker = t("tool.diff.truncated", { shown: shownLines, total: totalLines }, locale);
    content = `${content}\n\n${marker}`;
  }

  return `<details${openAttr}><summary>${summaryWithStats}</summary>\n\n${content}\n\n</details>`;
}

/**
 * Format tool call initial (running) notification as a clickable details block
 * with a placeholder until output arrives.
 */
export function formatToolRichInitial(
  tool: string,
  title: string | undefined,
  input: Record<string, unknown> | undefined,
): string {
  // toolRichLabel returns HTML-safe <summary> content (escaped internally).
  const summaryHtml = toolRichLabel(tool, title, input);

  // For bash: show the actual command while it's running
  if (tool === "bash" && typeof input?.command === "string") {
    const cmd = input.command.trim();
    const escaped = escapeSummary(cmd);
    return `<details><summary>${summaryHtml}</summary>\n\n<pre><code class="language-bash">${escaped}</code></pre>\n\n⏳ Выполняется…\n\n</details>`;
  }

  return `<details><summary>${summaryHtml}</summary>\n\n⏳ Выполняется…\n\n</details>`;
}

/**
 * Build the <summary> header for a tool-call rich block.
 *
 * Returns HTML-safe content ready to drop straight into <summary> (callers must
 * NOT re-escape): plain text is entity-escaped, and read/write file paths are
 * wrapped in <code> with a trailing "(N строк)" line count.
 */

/**
 * Count added/removed lines from a unified diff text.
 * Returns " (+X/-Y)" or empty string if no diff stats found.
 */
function countDiffStats(diffText: string | undefined): string {
  if (!diffText) return "";
  let added = 0;
  let removed = 0;
  for (const line of diffText.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added++;
    if (line.startsWith("-") && !line.startsWith("---")) removed++;
  }
  if (added === 0 && removed === 0) return "";
  return ` (+${added} -${removed})`;
}

function toolRichLabel(
  tool: string,
  title?: string,
  input?: Record<string, unknown>,
  metadata?: Record<string, unknown>,
  stateOutput?: unknown,
): string {
  const MAX_LABEL = 100;

  const toolEmoji: Record<string, string> = {
    bash: "💻",
    write: "✍️",
    edit: "✏️",
    read: "📄",
    grep: "🔍",
    glob: "🔎",
    webfetch: "🌐",
    task: "🤖",
    reasoning: "💭",
    todowrite: "📋",
    apply_patch: "🧩",
    diff: "🧩",
    filediff: "🧩",
    ls: "📂",
    question: "❓",
    skill: "🧠",
  };
  const emoji = toolEmoji[tool] || "🔧";

  const toolText: Record<string, string> = {
    bash: "Команда",
    write: "Запись",
    edit: "Правка",
    read: "Чтение",
    grep: "Поиск",
    glob: "Поиск",
    diff: "Diff",
    apply_patch: "Патч",
    filediff: "Diff",
    reasoning: "Рассуждение",
    todowrite: "Задачи",
    ls: "Просмотр",
    webfetch: "Загрузка",
    task: "Задача",
    question: "Вопрос",
    skill: "Навык",
  };
  const base = `${emoji} ${toolText[tool] || tool}`;

  // If the model provided a meaningful title (not just the tool name itself),
  // use it directly instead of parsing input fields.
  const modelTitle = title?.trim();
  if (modelTitle && modelTitle !== tool) {
    // Model title is meaningful — render as: "💻 Команда — model title"
    const withTitle = truncateTitle(`${base} — ${modelTitle}`, MAX_LABEL);
    return escapeSummary(withTitle);
  }

  const fp = typeof input?.filePath === "string" ? input.filePath.trim() : "";

  // Read/write headers: file path in <code> (inline monospace), line count in
  // "(N строк)". Built from structured input so the format is deterministic and
  // the path can be wrapped in <code>; the free-form title is bypassed here.
  // 2026-06-26: added per request (path as inline code + line count in parens).
  if ((tool === "read" || tool === "read_file" || tool === "write") && fp) {
    let lineSuffix = "";
    if (tool === "read" || tool === "read_file") {
      const offset = typeof input?.offset === "number" ? input.offset : undefined;
      const limit = typeof input?.limit === "number" ? input.limit : undefined;
      if (offset !== undefined && limit !== undefined && limit > 0) {
        const start = offset;
        const end = offset + limit - 1;
        lineSuffix = ` (${start} — ${end})`;
      }
    }
    if (!lineSuffix) {
      const lines = readWriteLineCount(tool, input, metadata, stateOutput);
      lineSuffix = lines !== undefined ? ` (${lines} ${pluralLines(lines)})` : "";
    }
    // Budget the visible path so "base — path lineSuffix" stays within MAX_LABEL;
    // keep the tail (filename) when the path is too long.
    const overhead = base.length + " — ".length + lineSuffix.length;
    const pathBudget = Math.max(8, MAX_LABEL - overhead);
    const shownPath =
      fp.length > pathBudget ? "…" + fp.slice(fp.length - (pathBudget - 1)) : fp;
    return `${escapeSummary(base)} — <code>${escapeSummary(shownPath)}</code>${escapeSummary(lineSuffix)}`;
  }

  // grep / glob: show the search pattern in the header, not just the path
  const searchPattern =
    typeof input?.pattern === "string"
      ? input.pattern.trim()
      : typeof input?.query === "string"
        ? input.query.trim()
        : "";
  if ((tool === "grep" || tool === "glob") && searchPattern) {
    const patternDisplay =
      searchPattern.length > 60
        ? `"${searchPattern.slice(0, 57)}…"`
        : `"${searchPattern}"`;
    const titleSuffix = title?.trim() ? ` — ${title.trim()}` : "";
    const full = truncateTitle(`${base} ${patternDisplay}${titleSuffix}`, MAX_LABEL);
    return escapeSummary(full);
  }

  if (title?.trim()) {
    const t = title.trim();
    // For bash tools, if the title is just the raw command or the tool name itself,
    // show the actual command from input instead.
    const cmd = typeof input?.command === "string" ? input.command.trim() : "";
    const isBashRawCommand =
      tool === "bash" && cmd && (t === cmd || t.startsWith(cmd.slice(0, 40)));
    if (!isBashRawCommand) {
      // If title is just the tool name (e.g. "bash"), show the command instead
      if (tool === "bash" && cmd && t === tool) {
        // Fall through to the fallback label below
      } else {
        const prefixSep = title.includes(" — ") ? "" : " — ";
        const withEmoji = truncateTitle(`${emoji}${prefixSep}${t}`, MAX_LABEL);
        return escapeSummary(withEmoji);
      }
    }
  }

  // Fallback label: emoji + tool name + truncated command/path
  const cmd2 = typeof input?.command === "string" ? input.command.trim() : "";
  let extra = "";
  if (cmd2) {
    // Show first line of the command, truncate to fit
    const firstLine = cmd2.split("\n")[0].trim();
    const maxCmdLen = 70;
    const shownCmd = firstLine.length > maxCmdLen
      ? firstLine.slice(0, maxCmdLen - 1) + "…"
      : firstLine;
    extra = ` — ${shownCmd}`;
  } else if (fp) {
    extra = ` — ${fp}`;
  }
  const full = truncateTitle(`${base}${extra}`, MAX_LABEL);
  return escapeSummary(full);
}

/**
 * Resolve the line count shown in a read/write header.
 * - write: number of lines in the written content (`input.content`).
 * - read:  number of indexed lines, from the read tool's state/metadata output.
 */
function readWriteLineCount(
  tool: string,
  input?: Record<string, unknown>,
  metadata?: Record<string, unknown>,
  stateOutput?: unknown,
): number | undefined {
  if (tool === "write") {
    const content = typeof input?.content === "string" ? input.content : undefined;
    if (content === undefined) return undefined;
    const n = content.split("\n").length;
    return n > 0 ? n : undefined;
  }
  const raw = extractString(stateOutput) || extractString(metadata?.output);
  return raw ? extractReadLineCount(raw) : undefined;
}

function extractReadLineCount(raw: string): number | undefined {
  const contentMatch = raw.match(/<entries>\s*[\s\S]*?<count>(\d+)<\/count>/i);
  if (contentMatch?.[1]) return parseInt(contentMatch[1], 10);
  const lines = raw.split("\n").filter((l) => l.trim()).length;
  return lines > 0 ? lines : undefined;
}

function pluralLines(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "строка";
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return "строки";
  return "строк";
}

function escapeSummary(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Cap a visible title/label to `max` characters, replacing the overflow with a
 * single-character ellipsis (so the result is at most `max` chars).
 * Shared by tool labels and reasoning/thinking titles to keep the collapsible
 * <summary> header short and readable.
 */
function truncateTitle(text: string, max = 100): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

function fencedCodeBlock(lang: string, code: string): string {
  const fence = code.includes("```") ? "````" : "```";
  return `${fence}${lang}\n${code}\n${fence}`;
}

/**
 * Neutralize the structural collapsible-block tags (<details>, </details>,
 * <summary>, </summary>) inside body content so they cannot nest into,
 * duplicate, or prematurely close the outer <details> rich wrapper.
 *
 * Inserts an invisible zero-width space right after '<' so Telegram's
 * rich-markdown renderer no longer treats the token as real structural HTML,
 * while the text stays visually identical.
 *
 * Fixed 2026-06-26: previously only the closing </details> was neutralized.
 * A literal opening <details> or a <summary>/</summary> in the body (very
 * common in reasoning/tool text — e.g. when discussing this feature) nested
 * inside the wrapper, leaving the outer <details> unbalanced; Telegram then
 * rendered the whole collapsible block as raw tags. Neutralizing all four
 * structural tokens keeps the wrapper well-formed. Applied to every tool-body
 * payload (including fenced) as defense-in-depth against fence breakout.
 */
function neutralizeDetailsMarkup(text: string): string {
  return text.replace(/<(\/?(?:details|summary))\b/gi, "<\u200B$1");
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
export function extractToolOutput(
  tool: string,
  input: Record<string, unknown> | undefined,
  metadata: Record<string, unknown> | undefined,
  stateOutput: unknown,
): string | null {
  let result: string | null = null;

  switch (tool) {
    case "bash": {
      result = extractString(metadata?.output) ?? extractString(stateOutput);
      break;
    }
    case "write":
    case "edit": {
      const diffText = extractString(metadata?.diff);
      if (diffText) {
        result = diffText;
      } else {
        const content = typeof input?.content === "string" ? input.content : "";
        result = content || extractString(stateOutput);
      }
      break;
    }
    case "read": {
      result = readExtractContent(extractString(stateOutput));
      break;
    }
    case "grep":
    case "glob": {
      result = extractString(metadata?.output);
      if (!result && Array.isArray(metadata?.results)) {
        result = (metadata.results as unknown[]).map(String).join("\n");
      }
      break;
    }
    case "diff":
    case "apply_patch":
    case "filediff":
      result = extractString(metadata?.diff);
      break;
    case "reasoning":
      result = extractString(metadata?.reasoningText);
      break;
    case "todowrite": {
      const todos = metadata?.todos;
      if (Array.isArray(todos) && todos.length > 0) {
        result = (todos as unknown[]).map((t: unknown) => {
          const item = t as Record<string, unknown>;
          const icon = item.status === "completed" ? "- [x]" : item.status === "in_progress" ? "- [ ]" : "- [ ]";
          return `${icon} ${String(item.content ?? "")}`;
        }).join("\n");
      }
      break;
    }
  }

  // General fallback for any tool: try metadata.output, metadata.result, stateOutput
  return result
    || extractString(metadata?.output)
    || extractString(metadata?.result)
    || extractString(metadata?.content)
    || extractString(stateOutput);
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
  content: string,
  options?: RichSendOptions,
): RichMessagePayload {
  const useHtml = options?.useHtml ?? false;
  const payload: RichMessagePayload = {
    chat_id: chatId,
    rich_message: useHtml ? { html: content } : { markdown: content },
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

function buildDraftPayload(
  chatId: number | string,
  draftId: number,
  content: string,
  options?: RichSendOptions,
): RichDraftPayload {
  const useHtml = options?.useHtml ?? false;
  const payload: RichDraftPayload = {
    chat_id: chatId,
    draft_id: draftId,
    rich_message: useHtml ? { html: content } : { markdown: content },
  };

  if (options?.messageThreadId !== undefined) {
    payload.message_thread_id = options.messageThreadId;
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
    const raw = getRawApi(api);
    if (!raw?.sendRichMessage) {
      return null;
    }
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
  content: string,
  options?: RichSendOptions,
): Promise<RichSendResult | null> {
  if (!isRichSizeOk(content)) {
    return null;
  }

  const useHtml = options?.useHtml ?? false;
  const payload: RichMessagePayload = {
    chat_id: chatId,
    message_id: messageId,
    rich_message: useHtml ? { html: content } : { markdown: content },
  };

  if (options?.businessConnectionId) {
    payload.business_connection_id = options.businessConnectionId;
  }

  try {
    const raw = getRawApi(api);
    if (!raw?.editMessageText) {
      return null;
    }
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

/**
 * Send a rich message without the isRichContent gate.
 * Use when the content is known to be rich-eligible (e.g. <details> blocks).
 */
export async function trySendRichMessageUnchecked(
  api: GrammyApi,
  chatId: number | string,
  markdown: string,
  options?: RichSendOptions,
): Promise<RichSendResult | null> {
  if (!isRichSizeOk(markdown)) {
    return null;
  }

  const payload = buildRichPayload(chatId, markdown, options);

  try {
    const raw = getRawApi(api);
    if (!raw?.sendRichMessage) {
      return null;
    }
    const result = await raw.sendRichMessage(payload);
    const messageId = extractMessageId(result);
    logger.info("[RichMessage] Sent rich message (unchecked)", { chatId, messageId });
    return { success: true, messageId };
  } catch (error) {
    const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    logger.warn("[RichMessage] sendRichMessage unchecked failed", { chatId, error: msg });

    if (isPermanentError(msg)) {
      return { success: false };
    }

    return null;
  }
}

function getRawApi(api: GrammyApi): Record<string, (...args: unknown[]) => unknown> | null {
  const raw = (api as unknown as { raw?: Record<string, (...args: unknown[]) => unknown> }).raw;
  return raw ?? null;
}

/**
 * Send a rich message draft via Bot API 10.1 sendRichMessageDraft.
 * Drafts auto-expire after 30 seconds but can be animated by re-sending
 * with the same draft_id.
 */
export async function trySendRichMessageDraft(
  api: GrammyApi,
  chatId: number | string,
  draftId: number,
  content: string,
  options?: RichSendOptions,
): Promise<RichSendResult | null> {
  if (!isRichSizeOk(content)) {
    return null;
  }

  const raw = getRawApi(api);
  if (!raw?.sendRichMessageDraft) {
    logger.debug("[RichMessage] sendRichMessageDraft not available, skipping rich draft");
    return null;
  }

  const payload = buildDraftPayload(chatId, draftId, content, options);

  try {
    await raw.sendRichMessageDraft(payload);
    logger.debug("[RichMessage] Sent rich draft", { chatId, draftId });
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    logger.warn("[RichMessage] sendRichMessageDraft failed", { chatId, draftId, error: msg });
    return null;
  }
}

/**
 * Format reasoning text as a rich message draft using <tg-thinking>.
 * <tg-thinking> is available only in sendRichMessageDraft and shows
 * an animated "Thinking..." placeholder with the text.
 */
export function formatThinkingForRichDraft(title: string, text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";

  const escapedTitle = escapeXmlForHtml(`💭 ${truncateTitle(title)}`);
  // Convert markdown to Telegram-safe HTML so **bold**, *italic*, `code`,
  // [links](url), blockquotes, code blocks, tables etc. render properly
  // inside the <tg-thinking> block which uses rich_message { html }.
  // Replace remaining newlines with <br/> for line breaks in inline HTML.
  const formattedBody = markdownToHtml(trimmed).replace(/\n/g, "<br/>");
  return `<tg-thinking><b>${escapedTitle}</b>\n\n${formattedBody}</tg-thinking>`;
}

/**
 * Format thinking completion as a clickable details block.
 * Title is the <summary> (always visible), reasoning text is hidden inside.
 * Returns Telegram-safe HTML for use with rich_message { html }.
 */
export function formatThinkingForRichFinal(title: string, text: string): string {
  const trimmed = text.trim();
  const escapedTitle = escapeSummary(`💭 ${truncateTitle(title)}`);
  if (!trimmed) {
    // Empty reasoning text — still publish a collapsible block with just the title
    // so the animated <tg-thinking> draft has a proper visual resolution.
    return `<details><summary>${escapedTitle}</summary>\n\n</details>`;
  }
  // Convert markdown to Telegram-safe HTML via markdownToHtml (handles
  // **bold**, *italic*, `code`, [links](url), blockquotes, tables, etc.).
  // neutralizeDetailsMarkup prevents nested <details>/<summary> from
  // breaking the outer collapsible block. markdownToHtml only emits
  // https?:// <a> links, avoiding rich_message_url_invalid rejections
  // that previously forced us to wrap the body in an inert code fence.
  // Fixed 2026-06-26: switched from code-fenced markdown → rendered HTML.
  const safeBody = markdownToHtml(neutralizeDetailsMarkup(trimmed));
  return `<details><summary>${escapedTitle}</summary>\n\n${safeBody}\n\n</details>`;
}

/**
 * Format tool call as rich markdown for sendRichMessage.
 * Uses heading + code block with language tag.
 */
export function formatToolCallForRichMessage(
  toolName: string,
  toolTitle: string,
  output?: string,
): string {
  const heading = `### 🔧 ${escapeSummary(toolTitle)}`;
  if (!output?.trim()) return heading;

  const lang = toolLanguageForRich(toolName);
  return `${heading}\n\n${fencedCodeBlock(lang, output.trim())}`;
}

function toolLanguageForRich(tool: string): string {
  switch (tool) {
    case "bash": return "bash";
    case "write": case "edit": return "";
    case "read": return "";
    case "grep": case "glob": return "";
    case "diff": case "apply_patch": case "filediff": return "diff";
    default: return "";
  }
}

function escapeXmlForHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Strip HTML tags and decode entities to plain text.
 * Used as last-resort fallback when structured output extraction fails.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .trim();
}
