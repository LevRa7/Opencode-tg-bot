import { getAgentDisplayName } from "../../agent/types.js";

interface AssistantRunFooterParams {
  agent: string;
  providerID: string;
  modelID: string;
  elapsedMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, elapsedMs) / 1000;

  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)}s`;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  if (hours > 0) {
    if (seconds > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    }
    return `${hours}h ${minutes}m`;
  }

  if (seconds > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${minutes}m`;
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
  let text = `${agentDisplay} · 🤖 ${providerID}/${modelID} · 🕒 ${formatElapsed(elapsedMs)}`;

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
