import { getAgentDisplayName } from "../../agent/types.js";

interface AssistantRunFooterParams {
  agent: string;
  providerID: string;
  modelID: string;
  elapsedMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

function formatElapsedSeconds(elapsedMs: number): string {
  const safeElapsedMs = Math.max(0, elapsedMs);
  return `${(safeElapsedMs / 1000).toFixed(1)}s`;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return String(value);
}

export function formatAssistantRunFooter({
  agent,
  providerID,
  modelID,
  elapsedMs,
  inputTokens,
  outputTokens,
}: AssistantRunFooterParams): string {
  const agentDisplay = getAgentDisplayName(agent);
  let text = `${agentDisplay} · 🤖 ${providerID}/${modelID} · 🕒 ${formatElapsedSeconds(elapsedMs)}`;

  if (typeof inputTokens === "number" || typeof outputTokens === "number") {
    const parts: string[] = [];
    if (typeof inputTokens === "number" && inputTokens > 0) {
      parts.push(`📥 ${formatTokens(inputTokens)}`);
    }
    if (typeof outputTokens === "number" && outputTokens > 0) {
      parts.push(`📤 ${formatTokens(outputTokens)}`);
    }
    if (parts.length > 0) {
      text += `\n${parts.join(" · ")}`;
    }
  }

  return text;
}
