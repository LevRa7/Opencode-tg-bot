import type { ToolInfo } from "../aggregator.js";

export type TechnicalProgressCategory =
  | "file_read"
  | "file_write"
  | "file_edit"
  | "file_create"
  | "file_delete"
  | "patch"
  | "command"
  | "project_search"
  | "web_search"
  | "web_read"
  | "reasoning"
  | "skill"
  | "subagent"
  | "mcp"
  | "todo"
  | "network"
  | "package"
  | "build"
  | "test"
  | "generic";

export type TechnicalProgressPhase = "running" | "completed";

export type TechnicalProgressOutcome = "success" | "failure" | "empty";

export interface TechnicalProgressClassification {
  category: TechnicalProgressCategory;
  phase: TechnicalProgressPhase;
  outcome: TechnicalProgressOutcome;
}

export type TechnicalProgressToolInfo = ToolInfo;
