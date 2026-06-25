import { formatModelDisplayName } from "../pinned/format.js";
import { t } from "../i18n/index.js";
import { formatCompactToolInfo } from "./formatter.js";
import type { SubagentInfo } from "./aggregator.js";
import type { ToolInfo } from "./aggregator.js";
import { escapeHtml, markdownToHtml } from "../bot/utils/reasoning-format.js";

function truncateToLines(text: string, maxLines: number): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join("\n") + "...";
}

function formatToolStep(subagent: SubagentInfo): string {
  if (!subagent.currentTool) {
    return "";
  }

  const inputDetails = formatCompactToolInfo(
    {
      sessionId: subagent.sessionId ?? subagent.parentSessionId,
      messageId: subagent.cardId,
      callId: subagent.cardId,
      tool: subagent.currentTool,
      state: {
        status: "running",
        input: subagent.currentToolInput ?? {},
        metadata: {},
        time: { start: subagent.updatedAt },
      },
      input: subagent.currentToolInput,
      metadata: {},
      hasFileAttachment: false,
    },
    128,
    "",
  ).trim();

  const toolInfo: ToolInfo = {
    sessionId: subagent.sessionId ?? subagent.parentSessionId,
    messageId: subagent.cardId,
    callId: subagent.cardId,
    tool: subagent.currentTool,
    state: {
      status: "running",
      input: subagent.currentToolInput ?? {},
      title: subagent.currentToolTitle,
      metadata: {},
      time: { start: subagent.updatedAt },
    },
    input: subagent.currentToolInput,
    title: subagent.currentToolTitle,
    metadata: {},
    hasFileAttachment: false,
  };

  const formatted = formatCompactToolInfo(toolInfo, 128, "").trim();
  if (inputDetails && inputDetails !== formatted) {
    return inputDetails;
  }

  const firstSpaceIndex = formatted.indexOf(" ");
  if (firstSpaceIndex >= 0 && formatted.slice(firstSpaceIndex + 1) === subagent.currentTool) {
    return "";
  }

  return formatted;
}

function formatSubagentActivity(subagent: SubagentInfo): string {
  if (subagent.status === "completed") {
    return `✅ ${t("subagent.completed")}`;
  }

  if (subagent.status === "error") {
    const message = escapeHtml(subagent.terminalMessage?.trim() || t("subagent.failed"));
    return `❌ ${message}`;
  }

  const toolStep = formatToolStep(subagent);
  if (toolStep) {
    return escapeHtml(toolStep);
  }

  return `⚙️ ${t("subagent.working")}`;
}

async function formatSubagentCard(subagent: SubagentInfo): Promise<string> {
  const modelName = escapeHtml(formatModelDisplayName(subagent.providerID, subagent.modelID));
  const lines = [
    `🧩 ${t("subagent.line.task", { task: escapeHtml(subagent.description) })}`,
    t("subagent.line.agent", { agent: escapeHtml(subagent.agent) }),
    t("pinned.line.model", { model: modelName }),
    "",
    formatSubagentActivity(subagent),
  ];

  const lastMsg = subagent.lastMessage?.trim();
  const lastMessageLine = lastMsg
    ? `💬 ${markdownToHtml(truncateToLines(lastMsg, 2))}`
    : subagent.stoppedLine
      ? `• ${markdownToHtml(subagent.stoppedLine)}`
      : subagent.topicLinkLabel && subagent.topicLinkUrl
        ? `• <a href="${escapeHtml(subagent.topicLinkUrl)}">${escapeHtml(subagent.topicLinkLabel)}</a>`
        : "";

  if (lastMessageLine) {
    lines.push("");
    lines.push(lastMessageLine);
  }

  return lines.join("\n");
}

export async function renderSubagentCards(subagents: SubagentInfo[]): Promise<string> {
  if (subagents.length === 0) {
    return "";
  }

  const parts = await Promise.all(subagents.map((subagent) => formatSubagentCard(subagent)));
  const body = parts.filter(Boolean).join("\n\n");
  return body ? `<blockquote>${body}</blockquote>` : "";
}
