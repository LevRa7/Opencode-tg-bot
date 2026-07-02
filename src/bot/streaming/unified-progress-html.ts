import { TELEGRAM_RICH_MAX_LENGTH } from "../../telegram/constants.js";
import {
  formatToolOutputForRichMessage,
  formatToolRichInitial,
} from "../utils/rich-message.js";

export type ToolStatus = "queued" | "running" | "done" | "error";

export interface ToolEntry {
  callId: string;
  title: string;
  category: string;
  status: ToolStatus;
  metric?: string;
  /** Tool output — shown in expandable details when tool completes. */
  output?: string;
  /** Tool name (e.g. "bash", "read") for rich output formatting. */
  tool?: string;
  /** Tool input params for rich output formatting. */
  input?: Record<string, unknown>;
  /** Tool metadata for rich output formatting. */
  metadata?: Record<string, unknown>;
  /** Tool state output for rich output formatting. */
  stateOutput?: unknown;
}

export interface ProgressState {
  sessionTitle: string;
  toolEntries: ToolEntry[];
  reasoningBlocks: string[];
  /** Title for the reasoning heading. */
  reasoningTitle?: string;
  doneCount: number;
  totalCount: number;
  /** Project path for the header (e.g. "/home/me/projects/my-app"). */
  projectPath?: string;
}

export const STATUS_ICONS: Record<ToolStatus, string> = {
  queued: "⏳",
  running: "🔄",
  done: "✅",
  error: "❌",
};

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Build ──────────────────────────────────────────────

function buildRunningSection(entries: ToolEntry[]): string {
  const running = entries.filter(
    (e) => e.status === "running" || e.status === "queued",
  );
  if (running.length === 0) return "";

  const lines: string[] = ["<b>Выполняю:</b>"];

  for (const entry of running) {
    const icon = STATUS_ICONS[entry.status];
    const title = escapeHtml(entry.title);

    if (entry.tool) {
      const initialBlock = formatToolRichInitial(
        entry.tool,
        entry.title,
        entry.input,
      );
      // Add open attribute for expanded view + prepend status icon
      const withIcon = initialBlock.replace(
        /^(<details)([^>]*>)(<summary>)/i,
        `$1 open$2$3${icon} `,
      );
      lines.push(withIcon);
    } else {
      const metric = entry.metric ? ` <i>${escapeHtml(entry.metric)}</i>` : "";
      lines.push(`${icon} <code>${title}</code>${metric}`);
    }
  }

  return lines.join("\n");
}

function buildCompletedSection(entries: ToolEntry[]): string {
  const completed = entries.filter(
    (e) => e.status === "done" || e.status === "error",
  );
  if (completed.length === 0) return "";

  const lines: string[] = ["<b>Tool Calls</b>"];

  for (const entry of completed) {
    // Reasoning entries: show as <details> with 💭 prefix, same format as tool calls
    if (entry.tool === "reasoning") {
      const firstLine = entry.title.split("\n")[0].trim();
      const summaryText = escapeHtml(firstLine.length > 100 ? firstLine.slice(0, 97) + "…" : firstLine);
      const bodyText = escapeHtml(entry.title);
      lines.push(`<details><summary>💭 ${summaryText}</summary>\n\n${bodyText}\n\n</details>`);
      continue;
    }

    const icon = STATUS_ICONS[entry.status];

    if ((entry.status === "done" || entry.status === "error") && entry.output) {
      const richBlock = formatToolOutputForRichMessage(
        entry.tool || "",
        entry.title,
        entry.input,
        entry.output,
        entry.metadata,
        entry.stateOutput,
      );
      if (richBlock) {
        const withIcon = richBlock.replace(
          /^(<details[^>]*>)(<summary>)/i,
          `$1$2${icon} `,
        );
        lines.push(withIcon);
      } else {
        const title = escapeHtml(entry.title);
        lines.push(`${icon} <code>${title}</code>`);
      }
    } else if (entry.tool) {
      const initialBlock = formatToolRichInitial(
        entry.tool,
        entry.title,
        entry.input,
      );
      const withIcon = initialBlock.replace(
        /^(<details[^>]*>)(<summary>)/i,
        `$1$2${icon} `,
      );
      lines.push(withIcon);
    } else {
      const title = escapeHtml(entry.title);
      const metric = entry.metric ? ` <i>${escapeHtml(entry.metric)}</i>` : "";
      lines.push(`${icon} <code>${title}</code>${metric}`);
    }
  }

  return lines.join("\n");
}

function buildReasoningSection(
  blocks: string[],
  title?: string,
): string {
  if (blocks.length === 0) return "";

  const text = blocks.join("\n").trim();
  if (!text) return "";

  // Extract title (summary) and body (rest)
  const lines = text.split("\n");
  const firstLine = lines[0].trim();
  const restLines = lines.slice(1).join("\n").trim();
  const headingText = title || firstLine;

  // Body: rest of text after first line; if no rest, use first line as body too
  const body = restLines || text;

  const summary = escapeHtml(headingText.length > 100 ? headingText.slice(0, 97) + "…" : headingText);
  const truncated = body.length > 4000
    ? escapeHtml(body.slice(0, 4000)) + "\n... truncated"
    : escapeHtml(body);

  return `<details><summary>💭 ${summary}</summary>\n\n${truncated}\n\n</details>`;
}

export function buildProgressHtml(state: ProgressState): string {
  // Header: project path in blockquote
  const projectPath = state.projectPath || "—";
  const header = `<pre>Проект: ${escapeHtml(projectPath)}</pre>`;

  // Reasoning first
  const reasoning = buildReasoningSection(state.reasoningBlocks, state.reasoningTitle);

  // Currently running tools ("Выполняю:")
  const running = buildRunningSection(state.toolEntries);

  // Completed tools
  const completed = buildCompletedSection(state.toolEntries);

  const body = [reasoning, running, completed].filter(Boolean).join("\n\n");

  return [header, body].filter(Boolean).join("\n");
}

// ── Tag-Aware Split ────────────────────────────────────

const SPLIT_BOUNDARIES = [
  "</pre>",
  "</code>\n",
  "</details>",
  "</tg-spoiler>",
  "</blockquote>",
  "</i>\n",
] as const;

interface SplitPoint {
  index: number;
  afterLength: number;
}

function findSplitPoint(html: string, maxLength: number): SplitPoint | null {
  let best: SplitPoint | null = null;

  for (const boundary of SPLIT_BOUNDARIES) {
    let searchFrom = 0;
    while (true) {
      const idx = html.indexOf(boundary, searchFrom);
      if (idx === -1) break;
      const after = idx + boundary.length;
      if (after > maxLength) break;
      if (!best || after > best.afterLength) {
        best = { index: idx, afterLength: after };
      }
      searchFrom = idx + 1;
    }
  }

  return best;
}

function isInsideInlineTag(html: string, pos: number): boolean {
  // Check if position is inside <code...> or <tg-spoiler>
  const before = html.slice(0, pos);
  const openCode = before.lastIndexOf("<code");
  const closeCode = before.lastIndexOf("</code>");
  if (openCode > closeCode) return true;

  const openSpoiler = before.lastIndexOf("<tg-spoiler>");
  const closeSpoiler = before.lastIndexOf("</tg-spoiler>");
  if (openSpoiler > closeSpoiler) return true;

  return false;
}

function rewindBeforeInlineTag(html: string, pos: number): number {
  const before = html.slice(0, pos);
  const openCode = before.lastIndexOf("<code");
  const closeCode = before.lastIndexOf("</code>");
  if (openCode > closeCode) return openCode;

  const openSpoiler = before.lastIndexOf("<tg-spoiler>");
  const closeSpoiler = before.lastIndexOf("</tg-spoiler>");
  if (openSpoiler > closeSpoiler) return openSpoiler;

  return pos;
}

function balanceTags(parts: string[]): void {
  const TAG_PATTERNS = [
    { open: /<pre>/g, close: /<\/pre>/g },
    { open: /<code>/g, close: /<\/code>/g },
    { open: /<tg-spoiler>/g, close: /<\/tg-spoiler>/g },
    { open: /<details[^>]*>/g, close: /<\/details>/g },
    { open: /<blockquote[^>]*>/g, close: /<\/blockquote>/g },
    { open: /<b>/g, close: /<\/b>/g },
    { open: /<i>/g, close: /<\/i>/g },
  ];

  for (let i = 0; i < parts.length; i++) {
    for (const { open, close } of TAG_PATTERNS) {
      open.lastIndex = 0;
      close.lastIndex = 0;
      const opens = (parts[i].match(open) || []).length;
      const closes = (parts[i].match(close) || []).length;
      const excess = opens - closes;

      if (excess > 0 && i < parts.length - 1) {
        // Add closing tags to current part, remove from next
        const closeStr = close.source.replace(/\\/g, "").replace(/\/g$/, "").slice(1, -1);
        parts[i] += `</${closeStr}>`;
        for (let j = 0; j < excess; j++) {
          parts[i + 1] = parts[i + 1].replace(new RegExp(`<${closeStr}(?!\\w)`, "i"), "");
        }
      } else if (excess < 0 && i > 0) {
        // Add opening tags from previous part
        const openStr = open.source.replace(/\\/g, "").replace(/\/g$/, "").slice(1, -1);
        for (let j = 0; j < -excess; j++) {
          parts[i] = `<${openStr}>` + parts[i];
          parts[i - 1] = parts[i - 1].replace(new RegExp(`<\/${openStr}>`, "i"), "");
        }
      }

      open.lastIndex = 0;
      close.lastIndex = 0;
    }
  }
}

export function splitHtmlAtTagBoundaries(
  html: string,
  maxLength: number = TELEGRAM_RICH_MAX_LENGTH,
): string[] {
  if (html.length <= maxLength) {
    return [html];
  }

  const parts: string[] = [];
  let remaining = html;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      parts.push(remaining);
      break;
    }

    let splitAt: number;
    const splitPoint = findSplitPoint(remaining, maxLength);

    if (!splitPoint) {
      // No good split point — force split at maxLength
      splitAt = maxLength;
    } else {
      splitAt = splitPoint.afterLength;
      // Don't split inside inline tags
      if (isInsideInlineTag(remaining, splitAt)) {
        splitAt = rewindBeforeInlineTag(remaining, splitAt);
      }
    }

    parts.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }

  balanceTags(parts);
  return parts;
}
