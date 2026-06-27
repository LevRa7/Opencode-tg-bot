import type {
  TechnicalProgressCategory,
  TechnicalProgressClassification,
  TechnicalProgressToolInfo,
} from "./types.js";

const toolCategories = new Map<string, TechnicalProgressCategory>([
  ["read", "file_read"],
  ["write", "file_write"],
  ["edit", "file_edit"],
  ["apply_patch", "patch"],
  ["bash", "command"],
  ["ls", "file_read"],
  ["grep", "project_search"],
  ["glob", "project_search"],
  ["web-search_tavily_search", "web_search"],
  ["webfetch", "web_read"],
  ["web-search_tavily_extract", "web_read"],
  ["reasoning", "reasoning"],
  ["skill", "skill"],
  ["task", "subagent"],
  ["todowrite", "todo"],
  ["todoread", "todo"],
]);

const mcpToolNamePattern = /^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_.-]+$/;

export function classifyTechnicalProgress(
  toolInfo: Pick<TechnicalProgressToolInfo, "tool" | "state">,
): TechnicalProgressClassification {
  const category = toolCategories.get(toolInfo.tool) ?? classifyUnknownTool(toolInfo.tool);
  const phase = toolInfo.state.status === "pending" || toolInfo.state.status === "running" ? "running" : "completed";
  const outcome = toolInfo.state.status === "error" ? "failure" : "success";

  return { category, phase, outcome };
}

function classifyUnknownTool(tool: string): TechnicalProgressCategory {
  return mcpToolNamePattern.test(tool) ? "mcp" : "generic";
}
