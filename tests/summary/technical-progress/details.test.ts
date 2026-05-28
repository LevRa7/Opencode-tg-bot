import { describe, expect, it } from "vitest";
import { buildTechnicalDetails } from "../../../src/summary/technical-progress/details.js";

describe("buildTechnicalDetails", () => {
  it("extracts useful terminal, diff, read, web, MCP, todo, skill, subagent, reasoning, and generic payloads", () => {
    expect(buildTechnicalDetails({ tool: "bash", input: { command: "npm test" }, metadata: { output: "69 passed" } } as never)?.body).toContain("69 passed");
    expect(buildTechnicalDetails({ tool: "apply_patch", metadata: { diff: "+added" } } as never)?.body).toContain("+added");
    expect(buildTechnicalDetails({ tool: "read", metadata: { content: "file body" } } as never)?.body).toContain("file body");
    expect(buildTechnicalDetails({ tool: "webfetch", metadata: { content: "page body" } } as never)?.body).toContain("page body");
    expect(buildTechnicalDetails({ tool: "github.search_issues", metadata: { result: { title: "issue" } } } as never)?.body).toContain("issue");
    expect(buildTechnicalDetails({ tool: "todowrite", metadata: { todos: [{ id: "1", content: "Done", status: "completed" }] } } as never)?.body).toContain("✅ Done");
    expect(buildTechnicalDetails({ tool: "skill", metadata: { output: "skill output" } } as never)?.body).toContain("skill output");
    expect(buildTechnicalDetails({ tool: "task", metadata: { output: "subagent output" } } as never)?.body).toContain("subagent output");
    expect(buildTechnicalDetails({ tool: "reasoning", metadata: { reasoningText: "root cause analysis" } } as never)?.body).toContain("root cause analysis");
    expect(buildTechnicalDetails({ tool: "unknown", metadata: { result: { ok: true } } } as never)?.body).toContain("ok");
  });

  it("skips empty and worthless payloads and redacts secrets", () => {
    expect(buildTechnicalDetails({ tool: "bash", metadata: { output: "" } } as never)).toBeNull();
    expect(buildTechnicalDetails({ tool: "unknown", metadata: { result: "[object Object]" } } as never)).toBeNull();
    expect(buildTechnicalDetails({ tool: "unknown", metadata: { result: {} } } as never)).toBeNull();
    expect(buildTechnicalDetails({ tool: "unknown", metadata: { result: [] } } as never)).toBeNull();
    expect(buildTechnicalDetails({ tool: "bash", title: "x", metadata: {} } as never)).toBeNull();
    expect(buildTechnicalDetails({ tool: "bash", metadata: { output: "TOKEN=abc123456789" } } as never)?.body).toBe("```\nTOKEN=[REDACTED]\n```");
  });

  it("skips unsupported structured payloads without crashing", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(buildTechnicalDetails({ tool: "unknown", metadata: { result: cyclic } } as never)).toBeNull();
    expect(buildTechnicalDetails({ tool: "unknown", metadata: { result: 1n } } as never)).toBeNull();
  });

  it("includes top-level output for read tool events instead of just filePath fallback", () => {
    const details = buildTechnicalDetails({
      tool: "read",
      input: { filePath: "/repo/src/index.ts" },
      output: "export const x = 1;\nexport const y = 2;",
      metadata: { preview: "export const x = 1;\n", truncated: false, loaded: [] },
      title: "index.ts",
    } as never);

    expect(details?.body).toContain("export const x = 1;");
    expect(details?.body).toContain("export const y = 2;");
    expect(details?.body).not.toBe("/repo/src/index.ts");
  });

  it("falls back to filePath when read tool has no top-level output and no useful metadata", () => {
    expect(
      buildTechnicalDetails({
        tool: "read",
        input: { filePath: "/repo/src/index.ts" },
        metadata: {},
      } as never)?.body,
    ).toBe("/repo/src/index.ts");
  });

  it("strips XML wrapper from read file output, keeping only content lines with line numbers", () => {
    const details = buildTechnicalDetails({
      tool: "read",
      input: { filePath: "/repo/src/index.ts" },
      state: {
        status: "completed",
        output: "<path>/repo/src/index.ts</path>\n<type>file</type>\n<content>\n1: export const x = 1;\n2: export const y = 2;\n</content>",
      },
      metadata: { preview: "export const x = 1;\n", truncated: false },
      title: "index.ts",
    } as never);

    expect(details?.body).toContain("1: export const x = 1;");
    expect(details?.body).toContain("2: export const y = 2;");
    expect(details?.body).not.toContain("<path>");
    expect(details?.body).not.toContain("<content>");
    expect(details?.body).not.toBe("/repo/src/index.ts");
  });

  it("strips XML wrapper from read directory output, keeping only entries", () => {
    const details = buildTechnicalDetails({
      tool: "read",
      input: { filePath: "/repo" },
      state: {
        status: "completed",
        output: "<path>/repo</path>\n<type>directory</type>\n<entries>\nsrc/\ntests/\ndist/\n</entries>",
      },
      metadata: { preview: "src/\ntests/", truncated: false, loaded: [] },
    } as never);

    expect(details?.body).toContain("src/");
    expect(details?.body).toContain("tests/");
    expect(details?.body).not.toContain("<entries>");
    expect(details?.body).not.toContain("<type>directory</type>");
  });

  it("keeps raw output when read tool output has no XML wrapper", () => {
    const details = buildTechnicalDetails({
      tool: "read",
      state: { status: "completed", output: "plain output without xml" },
      input: { filePath: "/repo/src/index.ts" },
    } as never);

    expect(details?.body).toContain("plain output without xml");
  });

  it("redacts secrets inside JSON object details", () => {
    const details = buildTechnicalDetails({
      tool: "unknown",
      metadata: { result: { token: "abc123456789", apiKey: "key123456789", password: "pass123456789" } },
    } as never);

    expect(details?.body).toContain("[REDACTED]");
    expect(details?.body).not.toContain("abc123456789");
    expect(details?.body).not.toContain("key123456789");
    expect(details?.body).not.toContain("pass123456789");
  });
});
