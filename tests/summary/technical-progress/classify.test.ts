import { describe, expect, it } from "vitest";
import { classifyTechnicalProgress } from "../../../src/summary/technical-progress/classify.js";

function info(tool: string, status: "pending" | "running" | "completed" | "error" = "completed") {
  return {
    sessionId: "s1",
    messageId: "m1",
    callId: "c1",
    tool,
    state: { status },
  } as const;
}

describe("classifyTechnicalProgress", () => {
  it("classifies known OpenCode tools into stable categories", () => {
    expect(classifyTechnicalProgress(info("read"))).toMatchObject({ category: "file_read", phase: "completed", outcome: "success" });
    expect(classifyTechnicalProgress(info("write"))).toMatchObject({ category: "file_write", phase: "completed", outcome: "success" });
    expect(classifyTechnicalProgress(info("edit"))).toMatchObject({ category: "file_edit", phase: "completed", outcome: "success" });
    expect(classifyTechnicalProgress(info("apply_patch"))).toMatchObject({ category: "patch", phase: "completed", outcome: "success" });
    expect(classifyTechnicalProgress(info("bash", "pending"))).toMatchObject({ category: "command", phase: "running", outcome: "success" });
    expect(classifyTechnicalProgress(info("bash", "running"))).toMatchObject({ category: "command", phase: "running", outcome: "success" });
    expect(classifyTechnicalProgress(info("grep"))).toMatchObject({ category: "project_search", phase: "completed", outcome: "success" });
    expect(classifyTechnicalProgress(info("glob"))).toMatchObject({ category: "project_search", phase: "completed", outcome: "success" });
    expect(classifyTechnicalProgress(info("webfetch"))).toMatchObject({ category: "web_read", phase: "completed", outcome: "success" });
    expect(classifyTechnicalProgress(info("web-search_tavily_extract"))).toMatchObject({ category: "web_read", phase: "completed", outcome: "success" });
    expect(classifyTechnicalProgress(info("skill"))).toMatchObject({ category: "skill", phase: "completed", outcome: "success" });
    expect(classifyTechnicalProgress(info("task"))).toMatchObject({ category: "subagent", phase: "completed", outcome: "success" });
    expect(classifyTechnicalProgress(info("todowrite"))).toMatchObject({ category: "todo", phase: "completed", outcome: "success" });
    expect(classifyTechnicalProgress(info("todoread"))).toMatchObject({ category: "todo", phase: "completed", outcome: "success" });
  });

  it("classifies web search, MCP-like tools, failed tools, and unknown tools safely", () => {
    expect(classifyTechnicalProgress(info("web-search_tavily_search"))).toMatchObject({ category: "web_search" });
    expect(classifyTechnicalProgress(info("github.search_issues"))).toMatchObject({ category: "mcp" });
    expect(classifyTechnicalProgress(info("bash", "error"))).toMatchObject({ category: "command", phase: "completed", outcome: "failure" });
    expect(classifyTechnicalProgress(info("unknown_tool"))).toMatchObject({ category: "generic", phase: "completed", outcome: "success" });
  });
});
