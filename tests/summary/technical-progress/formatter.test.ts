import { afterEach, describe, expect, it, vi } from "vitest";
import type { TechnicalProgressToolInfo } from "../../../src/summary/technical-progress/types.js";
import { resetRuntimeLocale, setRuntimeLocaleOverride } from "../../../src/i18n/index.js";
import {
  formatTechnicalProgressSync,
  formatTechnicalProgressWithDetails,
} from "../../../src/summary/technical-progress/formatter.js";
import type { TechnicalDetailsPublisher } from "../../../src/telegraph/details-publisher.js";
import { buildProgressMetric } from "../../../src/summary/technical-progress/metrics.js";
import { buildProgressTitle } from "../../../src/summary/technical-progress/title.js";

vi.mock("../../../src/settings/manager.js", () => ({
  getCurrentProject: () => ({ id: "p1", name: "repo", worktree: "D:/repo" }),
}));

function toolInfo(overrides: Partial<TechnicalProgressToolInfo>): TechnicalProgressToolInfo {
  return {
    sessionId: "s1",
    messageId: "m1",
    callId: "c1",
    state: { status: "completed" },
    tool: overrides.tool ?? "unknown",
    ...overrides,
  } as TechnicalProgressToolInfo;
}

afterEach(() => {
  resetRuntimeLocale();
});

describe("technical progress titles and metrics", () => {
  it("builds concise safe titles from files, commands, URLs, and fallback strings", () => {
    expect(buildProgressTitle(toolInfo({ tool: "read", input: { filePath: "D:/repo/src/formatter.ts" } }))).toBe("formatter.ts");
    expect(buildProgressTitle(toolInfo({ tool: "bash", input: { command: "npm test -- --runInBand" } }))).toBe("npm test -- --runInBand");
    expect(buildProgressTitle(toolInfo({ tool: "bash", input: { command: "touch /tmp/report.txt", description: "Saved /tmp/report.txt" } }))).toBe("touch /tmp/report.txt");
    expect(buildProgressTitle(toolInfo({ tool: "webfetch", input: { url: "https://opencode.ai/docs/sdk" } }))).toBe("opencode.ai");
    expect(buildProgressTitle(toolInfo({ tool: "unknown", input: { token: "abc123456", query: "formatToolInfo" } }))).toBe("formatToolInfo");
  });

  it("builds apply_patch titles from file diffs, patch-like titles, input paths, and fallback", () => {
    expect(buildProgressTitle(toolInfo({ tool: "apply_patch", metadata: { filediff: { file: "D:/repo/src/from-diff.ts" } }, title: "patch" }))).toBe("from-diff.ts");
    expect(buildProgressTitle(toolInfo({ tool: "apply_patch", title: "M a.ts" }))).toBe("a.ts");
    expect(buildProgressTitle(toolInfo({ tool: "apply_patch", title: "Success...\nM a.ts" }))).toBe("a.ts");
    expect(buildProgressTitle(toolInfo({ tool: "apply_patch", input: { path: "D:/repo/src/from-input.ts" } }))).toBe("from-input.ts");
    expect(buildProgressTitle(toolInfo({ tool: "apply_patch", input: { patchText: "--- a/src/old.ts\n+++ b/src/new.ts" } }))).toBe("new.ts");
    expect(buildProgressTitle(toolInfo({ tool: "apply_patch" }))).toBe("patch");
  });

  it("builds metrics for lines, diffs, results, tasks, command test summaries, and HTTP status", () => {
    expect(buildProgressMetric(toolInfo({ tool: "read", metadata: { lines: 345 } }))).toBe("345 lines");
    expect(buildProgressMetric(toolInfo({ tool: "write", input: { content: "one\ntwo" } }))).toBe("2 lines");
    expect(buildProgressMetric(toolInfo({ tool: "edit", metadata: { filediff: { additions: 34, deletions: 2 } } }))).toBe("+34 −2");
    expect(buildProgressMetric(toolInfo({ tool: "grep", metadata: { resultCount: 23 } }))).toBe("23 results");
    expect(buildProgressMetric(toolInfo({ tool: "todowrite", metadata: { todos: [{ id: "1", content: "A", status: "completed" }] } }))).toBe("1 task");
    expect(buildProgressMetric(toolInfo({ tool: "bash", metadata: { output: "3 failed, 66 passed" } }))).toBe("3 failed, 66 passed");
    expect(buildProgressMetric(toolInfo({ tool: "webfetch", metadata: { statusCode: 200 } }))).toBe("200 OK");
  });

  it("ignores malformed file diff metrics", () => {
    expect(buildProgressMetric(toolInfo({ tool: "edit", metadata: { filediff: { additions: "34", deletions: 2 } } }))).toBe("");
    expect(buildProgressMetric(toolInfo({ tool: "edit", metadata: { filediff: { additions: 34, deletions: "2" } } }))).toBe("");
  });
});

function publisherReturning(url: string | null): TechnicalDetailsPublisher {
  return {
    publish: vi.fn().mockResolvedValue(url),
    flush: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn(),
  };
}

describe("formatTechnicalProgressSync", () => {
  it("formats Russian one-line progress catalog", () => {
    setRuntimeLocaleOverride("ru");

    const examples: Array<[Partial<TechnicalProgressToolInfo>, string]> = [
      [
        { tool: "read", state: { status: "running" }, input: { filePath: "D:/repo/formatter.ts" } },
        "📄 Читаю файл — formatter.ts",
      ],
      [
        { tool: "read", input: { filePath: "D:/repo/formatter.ts" }, metadata: { lines: 345 } },
        "📄 Прочитал файл — formatter.ts (345 строк)",
      ],
      [
        {
          tool: "read",
          input: { filePath: "/" },
          metadata: {
            output: "<path>/</path>\n<type>directory</type>\n<entries>\nhome/\ntmp/\n</entries>",
          },
        },
        "📄 Прочитал директорию — /",
      ],
      [
        { tool: "edit", input: { filePath: "D:/repo/summary/formatter.ts" }, metadata: { filediff: { additions: 34, deletions: 2 } } },
        "✍️ Отредактировал файл — formatter.ts (+34 −2)",
      ],
      [
        { tool: "apply_patch", state: { status: "running" }, input: { path: "D:/repo/formatter.ts" } },
        "🧩 Применяю правку — formatter.ts",
      ],
      [
        { tool: "bash", state: { status: "running" }, input: { command: "npm test" } },
        "💻 Выполняю команду — npm test",
      ],
      [
        { tool: "grep", input: { pattern: "formatToolInfo" }, metadata: { resultCount: 23 } },
        "🔎 Нашёл совпадения — formatToolInfo (23 результата)",
      ],
      [
        { tool: "grep", input: { pattern: "formatToolInfo" }, metadata: { resultCount: 0 } },
        "🔎 Совпадений не найдено — formatToolInfo",
      ],
      [
        { tool: "webfetch", input: { url: "https://opencode.ai/docs" } },
        "🌐 Прочитал страницу — opencode.ai",
      ],
      [
        { tool: "skill", input: { name: "writing-plans" }, metadata: { taskCount: 12 } },
        "🧠 Выполнил навык — writing-plans (12 задач)",
      ],
      [
        { tool: "task", state: { status: "running" }, input: { description: "исследование progress formatter" } },
        "🤖 Субагент работает — исследование progress formatter",
      ],
      [
        { tool: "github.search_issues", input: { query: "bug" }, metadata: { resultCount: 12 } },
        "🔌 MCP-инструмент выполнен — bug (12 результатов)",
      ],
      [
        { tool: "неизвестный инструмент" },
        "⚙️ Выполнил действие — неизвестный инструмент",
      ],
    ];

    for (const [input, expected] of examples) {
      expect(formatTechnicalProgressSync(toolInfo(input)).text).toBe(expected);
    }
  });

  it("suppresses zero-result search metrics from structured metadata", () => {
    setRuntimeLocaleOverride("ru");

    const result = formatTechnicalProgressSync(toolInfo({
      tool: "grep",
      input: { pattern: "formatToolInfo" },
      metadata: { output: "0 passed", resultCount: 0 },
    }));

    expect(result.text).toBe("🔎 Совпадений не найдено — formatToolInfo");
  });

  it("formats read directory output when the directory marker is on the tool output", () => {
    setRuntimeLocaleOverride("ru");

    const result = formatTechnicalProgressSync(toolInfo({
      tool: "read",
      input: { filePath: "/repo" },
      output: "<path>/repo</path>\n<type>directory</type>\n<entries>src/</entries>",
    } as Partial<TechnicalProgressToolInfo> & { output: string }));

    expect(result.text).toBe("📄 Прочитал директорию — repo");
  });

  it("formats Russian active todo output", () => {
    setRuntimeLocaleOverride("ru");

    const result = formatTechnicalProgressSync(toolInfo({
      tool: "todowrite",
      metadata: {
        todos: [
          { id: "1", content: "Explore project context and source design document", status: "completed" },
          { id: "2", content: "Ask user to review written spec", status: "in_progress" },
          { id: "3", content: "Transition to implementation planning", status: "pending" },
        ],
      },
    }));

    expect(result.text).toBe("📝 Обновил список задач — 3 пункта");
  });

  it("redacts secrets from visible active todo content", () => {
    const result = formatTechnicalProgressSync(toolInfo({
      tool: "todowrite",
      metadata: {
        todos: [
          { id: "1", content: "Use TOKEN=secret-value for setup", status: "in_progress" },
          { id: "2", content: "Call service with password: secret-value", status: "pending" },
        ],
      },
    }));

    expect(result.text).not.toContain("TOKEN=secret-value");
    expect(result.text).not.toContain("password: secret-value");
    expect(result.text).toBe("📝 Updated task list — 2 tasks");
  });

  it("renders running reasoning as a compact one-line title only", () => {
    const result = formatTechnicalProgressSync(toolInfo({
      tool: "reasoning",
      state: { status: "running" },
      title: "Considering debugging skills",
      metadata: {
        reasoningText:
          "Considering debugging skills\n\nI need to take action and assess my skills for systematic debugging.",
      },
    }));

    expect(result.text).toBe("💭 Considering debugging skills");
    expect(result.text).not.toContain("I need to take action");
    expect(result.text).not.toContain("\n");
  });

  it("strips markdown emphasis from visible reasoning titles", () => {
    const result = formatTechnicalProgressSync(toolInfo({
      tool: "reasoning",
      title: "**Clarifying user request** and reviewing **context**",
      metadata: { reasoningText: "It looks like the user is asking me to repeat something." },
    }));

    expect(result.text).toBe("💭 Clarifying user request and reviewing context");
  });

  it("collapses completed and cancelled Russian todos", () => {
    setRuntimeLocaleOverride("ru");

    const result = formatTechnicalProgressSync(toolInfo({
      tool: "todowrite",
      metadata: {
        todos: [
          { id: "1", content: "Done", status: "completed" },
          { id: "2", content: "Skipped", status: "cancelled" },
        ],
      },
    }));

    expect(result.text).toBe("✅ Все задачи выполнены");
  });
});

describe("formatTechnicalProgressWithDetails", () => {
  it("wraps complete one-line final messages in a Telegraph link when useful details publish", async () => {
    const publisher = publisherReturning("https://telegra.ph/npm-test");

    const result = await formatTechnicalProgressWithDetails(toolInfo({
      tool: "bash",
      input: { command: "npm test" },
      metadata: { output: "10 passed" },
    }), publisher);

    expect(result).toEqual({
      text: '💻 Ran command — npm test (10 passed)  <a href="https://telegra.ph/npm-test">🔗</a>',
      format: "html",
    });
    expect(publisher.publish).toHaveBeenCalledWith({ title: "💻 Ran command — npm test (10 passed)", body: "```bash\n$ npm test\n10 passed\n```" });
  });

  it("keeps the same unlinked one-line message when details are worthless", async () => {
    const publisher = publisherReturning("https://telegra.ph/npm-test");

    const result = await formatTechnicalProgressWithDetails(toolInfo({
      tool: "bash",
      input: { command: "npm test" },
      metadata: { output: "{}" },
    }), publisher);

    expect(result).toEqual(formatTechnicalProgressSync(toolInfo({
      tool: "bash",
      input: { command: "npm test" },
      metadata: { output: "{}" },
    })));
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("keeps the same unlinked one-line message when publishing fails", async () => {
    const publisher = publisherReturning(null);
    const input = toolInfo({
      tool: "bash",
      input: { command: "npm test" },
      metadata: { output: "10 passed" },
    });

    const result = await formatTechnicalProgressWithDetails(input, publisher);

    expect(result).toEqual(formatTechnicalProgressSync(input));
  });

  it("keeps todo details out of linked anchor text", async () => {
    const publisher = publisherReturning("https://telegra.ph/npm-test");

    const result = await formatTechnicalProgressWithDetails(toolInfo({
      tool: "todowrite",
      metadata: {
        output: "details",
        todos: [{ id: "1", content: "Review <b>& fix", status: "in_progress" }],
      },
    }), publisher);

    expect(result.text).toBe('📝 Updated task list — 1 task  <a href="https://telegra.ph/npm-test">🔗</a>');
    expect(publisher.publish).toHaveBeenCalledWith({
      title: "📝 Updated task list — 1 task",
      body: "⏳ Review <b>& fix",
    });
  });

  it("publishes file diff details behind a linked file edit one-liner", async () => {
    const publisher = publisherReturning("https://telegra.ph/file-diff");
    const input = toolInfo({
      tool: "edit",
      input: { filePath: "D:/repo/src/index.ts" },
      metadata: { filediff: { file: "src/index.ts", additions: 2, deletions: 1 } },
    });

    const result = await formatTechnicalProgressWithDetails(input, publisher);

    expect(result).toEqual({
      text: '✍️ Edited file — index.ts (+2 −1)  <a href="https://telegra.ph/file-diff">🔗</a>',
      format: "html",
    });
    expect(publisher.publish).toHaveBeenCalledWith({
      title: "✍️ Edited file — index.ts (+2 −1)",
      body: "src/index.ts  +2 −1\n",
    });
  });

  it("publishes useful completed reasoning details behind a linked one-liner", async () => {
    const publisher = publisherReturning("https://telegra.ph/reasoning");
    const input = toolInfo({
      tool: "reasoning",
      title: "Thinking",
      metadata: { reasoningText: "Step 1\nStep 2" },
    });

    const result = await formatTechnicalProgressWithDetails(input, publisher);

    expect(result).toEqual({
      text: '💭 Thinking  <a href="https://telegra.ph/reasoning">🔗</a>',
      format: "html",
    });
    expect(publisher.publish).toHaveBeenCalledWith({
      title: "💭 Thinking",
      body: "Step 2",
    });
  });

  it("keeps completed reasoning as a plain one-liner when publisher returns no URL", async () => {
    const publisher = publisherReturning(null);
    const input = toolInfo({
      tool: "reasoning",
      title: "Thinking",
      metadata: { reasoningText: "Step 1" },
    });

    const result = await formatTechnicalProgressWithDetails(input, publisher);

    expect(result).toEqual(formatTechnicalProgressSync(input));
  });

  it("does not publish completed reasoning without useful content", async () => {
    const publisher = publisherReturning("https://telegra.ph/reasoning");
    const input = toolInfo({
      tool: "reasoning",
      title: "Thinking",
      metadata: { reasoningText: "{}" },
    });

    const result = await formatTechnicalProgressWithDetails(input, publisher);

    expect(result).toEqual(formatTechnicalProgressSync(input));
    expect(publisher.publish).not.toHaveBeenCalled();
  });
});
