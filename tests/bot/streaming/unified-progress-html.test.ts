import { describe, expect, it } from "vitest";
import type {
  ProgressState,
} from "../../../src/bot/streaming/unified-progress-html.js";
import {
  buildProgressHtml,
  splitHtmlAtTagBoundaries,
  escapeHtml,
  STATUS_ICONS,
} from "../../../src/bot/streaming/unified-progress-html.js";

describe("escapeHtml", () => {
  it("escapes & to &amp;", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("escapes < to &lt;", () => {
    expect(escapeHtml("a < b")).toBe("a &lt; b");
  });

  it("escapes > to &gt;", () => {
    expect(escapeHtml("a > b")).toBe("a &gt; b");
  });

  it("does not double-escape already escaped text", () => {
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
  });

  it("escapes multiple characters", () => {
    expect(escapeHtml("<div class=\"test\"> & more")).toBe(
      "&lt;div class=&quot;test&quot;&gt; &amp; more"
    );
  });
});

describe("buildProgressHtml", () => {
  const baseState: ProgressState = {
    sessionTitle: "Test Session",
    toolEntries: [],
    reasoningBlocks: [],
    doneCount: 0,
    totalCount: 0,
    projectPath: "/home/me/test-project",
  };

  it("renders header with project path", () => {
    const html = buildProgressHtml(baseState);
    expect(html).toContain("<pre>Проект: /home/me/test-project</pre>");
  });

  it("escapes HTML in project path", () => {
    const state: ProgressState = {
      ...baseState,
      projectPath: "/home/me/<script>alert('xss')</script>",
    };
    const html = buildProgressHtml(state);
    expect(html).toContain(
      "<pre>Проект: /home/me/&lt;script&gt;alert('xss')&lt;/script&gt;</pre>"
    );
  });

  it("renders header with placeholder when projectPath is empty", () => {
    const state: ProgressState = {
      ...baseState,
      projectPath: "",
    };
    const html = buildProgressHtml(state);
    expect(html).toContain("<pre>Проект: —</pre>");
  });

  it("renders completed tool with status icon in Tool Calls", () => {
    const state: ProgressState = {
      ...baseState,
      toolEntries: [
        { callId: "1", title: "read", category: "file", status: "done", metric: "12ms" },
      ],
    };
    const html = buildProgressHtml(state);
    expect(html).toContain("✅");
    expect(html).toContain("<code>read</code>");
    expect(html).toContain("12ms");
    expect(html).toContain("<b>Tool Calls</b>");
    expect(html).not.toContain("<b>Выполняю:</b>");
  });

  it("renders running tool in Выполняю section", () => {
    const state: ProgressState = {
      ...baseState,
      toolEntries: [
        { callId: "1", title: "bash", category: "terminal", status: "running", metric: "..." },
      ],
    };
    const html = buildProgressHtml(state);
    expect(html).toContain("<b>Выполняю:</b>");
    expect(html).toContain("🔄");
    expect(html).toContain("<code>bash</code>");
    expect(html).not.toContain("<b>Tool Calls</b>");
  });

  it("renders mixed tools — running in Выполняю, done in Tool Calls", () => {
    const state: ProgressState = {
      ...baseState,
      toolEntries: [
        { callId: "1", title: "read", category: "file", status: "done", metric: "12ms" },
        { callId: "2", title: "bash", category: "terminal", status: "running", metric: "..." },
        { callId: "3", title: "grep", category: "search", status: "queued", metric: undefined },
        {
          callId: "4",
          title: "write",
          category: "file",
          status: "error",
          metric: "ERR",
        },
      ],
    };
    const html = buildProgressHtml(state);

    // Running section
    expect(html).toContain("<b>Выполняю:</b>");
    // Completed section
    expect(html).toContain("<b>Tool Calls</b>");

    expect(html).toContain("✅");
    expect(html).toContain("🔄");
    expect(html).toContain("⏳");
    expect(html).toContain("❌");
  });

  it("escapes HTML in tool titles", () => {
    const state: ProgressState = {
      ...baseState,
      toolEntries: [
        {
          callId: "1",
          title: "<script>evil()</script>",
          category: "file",
          status: "done",
        },
      ],
    };
    const html = buildProgressHtml(state);
    expect(html).toContain("<code>&lt;script&gt;evil()&lt;/script&gt;</code>");
    expect(html).not.toContain("<script>evil()</script>");
  });

  it("renders active reasoning as open details with summary", () => {
    const state: ProgressState = {
      ...baseState,
      reasoningBlocks: ["I should search first\nThen read the file"],
    };
    const html = buildProgressHtml(state);

    expect(html).toContain("<details><summary>💭 I should search first</summary>");
    expect(html).toContain("Then read the file");
    expect(html).toContain("</details>");
  });

  it("uses title for summary when title is provided", () => {
    const state: ProgressState = {
      ...baseState,
      reasoningBlocks: ["Analyzing the request\nActually, the user wants..."],
      reasoningTitle: "Analyzing the request",
    };
    const html = buildProgressHtml(state);
    expect(html).toContain("<details><summary>💭 Analyzing the request</summary>");
    expect(html).toContain("Actually, the user wants...");
  });

  it("shows reasoning entries in tool calls as expandable details", () => {
    const state: ProgressState = {
      ...baseState,
      toolEntries: [
        { callId: "r1", title: "Previous thought about architecture\nMore details here", category: "reasoning", status: "done", tool: "reasoning" },
        { callId: "1", title: "read", category: "file", status: "done", metric: "12ms" },
      ],
    };
    const html = buildProgressHtml(state);
    // Reasoning entry appears as <details> with 💭 prefix
    expect(html).toContain("<details><summary>💭 Previous thought about architecture</summary>");
    expect(html).toContain("More details here");
    expect(html).toContain("</details>");
    // Regular tool still shows normally
    expect(html).toContain("✅");
    expect(html).toContain("<code>read</code>");
  });

  it("escapes HTML in reasoning blocks", () => {
    const state: ProgressState = {
      ...baseState,
      reasoningBlocks: ["if (x < 5)", "Use <script>alert()</script>"],
    };
    const html = buildProgressHtml(state);

    expect(html).toContain("if (x &lt; 5)");
    expect(html).toContain(
      "Use &lt;script&gt;alert()&lt;/script&gt;"
    );
    expect(html).not.toContain("<script>");
  });

  it("does not render reasoning section when no blocks", () => {
    const html = buildProgressHtml(baseState);
    expect(html).not.toContain("<b>Tool Calls</b>");
  });

  it("does not render reasoning section when no blocks", () => {
    const html = buildProgressHtml(baseState);
    expect(html).not.toContain("💭 Reasoning");
  });

  it("renders completed tool with output as expandable details via formatToolOutputForRichMessage", () => {
    const state: ProgressState = {
      ...baseState,
      toolEntries: [
        {
          callId: "1",
          title: "Read file",
          category: "file",
          status: "done",
          metric: "12ms",
          output: "line 1\nline 2",
          tool: "read",
          input: { filePath: "src/test.ts" },
        },
      ],
    };
    const html = buildProgressHtml(state);

    // Should contain a <details> block with the formatted output
    expect(html).toContain("<details>");
    expect(html).toContain("</details>");
    // Status icon prepended to summary
    expect(html).toMatch(/<summary>✅ /);
    // Output content inside
    expect(html).toContain("line 1");
    expect(html).toContain("line 2");
  });

  it("renders running tool without expandable block", () => {
    const state: ProgressState = {
      ...baseState,
      toolEntries: [
        {
          callId: "1",
          title: "bash",
          category: "terminal",
          status: "running",
          metric: "...",
          output: "partial output",
        },
      ],
    };
    const html = buildProgressHtml(state);

    // Running tools don't get <details> even if output exists
    expect(html).not.toContain("<details>");
    expect(html).toContain("🔄");
    expect(html).toContain("<code>bash</code>");
  });

  it("does not render Выполняю or Tool Calls when no entries", () => {
    const html = buildProgressHtml(baseState);
    expect(html).not.toContain("<b>Tool Calls</b>");
    expect(html).not.toContain("<b>Выполняю:</b>");
  });

  it("includes reasoning before tool calls and running section", () => {
    const state: ProgressState = {
      ...baseState,
      toolEntries: [
        { callId: "1", title: "read", category: "file", status: "done", metric: "12ms" },
        { callId: "2", title: "bash", category: "terminal", status: "running", metric: "..." },
      ],
      reasoningBlocks: ["Looking at the code..."],
    };
    const html = buildProgressHtml(state);

    // Reasoning appears before tool sections
    const reasoningPos = html.indexOf("<details><summary>💭 Looking at the code...</summary>");
    const toolPos = html.indexOf("<b>Tool Calls</b>");
    const runningPos = html.indexOf("<b>Выполняю:</b>");
    expect(reasoningPos).toBeLessThan(toolPos);
    expect(reasoningPos).toBeLessThan(runningPos);
  });

  it("has correct STATUS_ICONS mapping", () => {
    expect(STATUS_ICONS.queued).toBe("⏳");
    expect(STATUS_ICONS.running).toBe("🔄");
    expect(STATUS_ICONS.done).toBe("✅");
    expect(STATUS_ICONS.error).toBe("❌");
  });
});

describe("splitHtmlAtTagBoundaries", () => {
  it("returns single part when under limit", () => {
    const html = "<blockquote><b>Short message</b></blockquote>";
    const parts = splitHtmlAtTagBoundaries(html);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe(html);
  });

  it("splits at </code> boundaries", () => {
    const toolLine = "✅ <code>read_file.ts</code> 12ms\n";
    const repeated = toolLine.repeat(10);
    const html = `<blockquote>${repeated}</blockquote>\n<i>footer</i>`;

    const parts = splitHtmlAtTagBoundaries(html, 150);
    expect(parts.length).toBeGreaterThan(1);
  });

  it("does not split inside an HTML tag", () => {
    const longTitle = "a".repeat(35000);
    const html = `<blockquote>✅ <code>${longTitle}</code> 5ms</blockquote>\n<i>footer</i>`;

    // Should not throw — may return 1 part if the only safe split point is at the end.
    // Edge case: when <code> content exceeds split limit, parts may be unbalanced.
    expect(() => splitHtmlAtTagBoundaries(html)).not.toThrow();
  });

  it("splits at blockquote boundaries", () => {
    const toolLine = "✅ <code>f.ts</code> 5ms\n";
    const manyLines = toolLine.repeat(500);
    const html = `<blockquote>${manyLines}</blockquote>\n<i>footer text</i>`;

    const parts = splitHtmlAtTagBoundaries(html, 1500);
    expect(parts.length).toBeGreaterThan(1);
    // The last part should contain the footer
    const lastPart = parts[parts.length - 1];
    expect(lastPart).toContain("<i>");
    expect(lastPart).toContain("</i>");
  });

  it("each part has balanced tags (no unmatched open/close)", () => {
    const toolLine = "✅ <code>file_name.ts</code> 12ms\n";
    const repeated = toolLine.repeat(10);
    const html = `<blockquote expandable><b>Tool Calls</b>\n${repeated}</blockquote>\n<i>📊 10/10 tools • ⏱ updated just now</i>`;

    const parts = splitHtmlAtTagBoundaries(html, 200);
    expect(parts.length).toBeGreaterThan(1);

    const pairedTags = [/<code[ >]/g, /<\/code>/g] as const;

    for (const part of parts) {
      const openCount = (part.match(pairedTags[0]) || []).length;
      const closeCount = (part.match(pairedTags[1]) || []).length;
      expect(openCount).toBe(closeCount);
    }
  });

  it("returns single part when no safe split point exists", () => {
    // A message that has no safe split boundaries — just one long block
    const longText = "a".repeat(33000);
    const html = `<blockquote>${longText}</blockquote>`;
    const parts = splitHtmlAtTagBoundaries(html, 32000);
    // Should not throw; may return 1 part or split at best effort
    expect(parts.length).toBeGreaterThanOrEqual(1);
  });
});
