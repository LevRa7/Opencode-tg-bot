# Localized Technical Progress Messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw OpenCode tool/thinking progress text with concise localized one-line Telegram service messages and optional Telegraph links for useful technical details.

**Architecture:** Add a focused `src/summary/technical-progress/` domain module for classification, titles, metrics, redaction, detail extraction, and formatting while preserving existing OpenCode event lifecycle. Add a `src/telegraph/` port and adapter so Telegraph is optional and failures degrade to the same unlinked one-line message. Keep `formatToolInfo()` as a synchronous compatibility facade and introduce async formatting only at the bot delivery boundary.

**Tech Stack:** TypeScript 5.x, Node.js 20 built-in `fetch`, Vitest, existing i18n dictionaries, existing logger/config patterns.

---

## File structure

Create:

- `src/summary/technical-progress/types.ts` — shared domain types for progress categories, phases, outcomes, format input/output, todo status, and publisher port input.
- `src/summary/technical-progress/redact.ts` — deterministic secret redaction for titles and Telegraph body text.
- `src/summary/technical-progress/title.ts` — human-readable title extraction for paths, commands, URLs, prompts, todo updates, reasoning, and fallback tools.
- `src/summary/technical-progress/metrics.ts` — line counts, diff counts, result counts, task counts, command summaries, and HTTP status metrics.
- `src/summary/technical-progress/classify.ts` — tool-name and state based category/phase/outcome classification.
- `src/summary/technical-progress/details.ts` — useful-detail extraction and worthless-payload rejection.
- `src/summary/technical-progress/formatter.ts` — localized one-line text formatting, HTML link wrapping, todo formatting, and async Telegraph publication flow.
- `src/telegraph/types.ts` — Telegraph config, request, response, and publisher interfaces.
- `src/telegraph/details-publisher.ts` — `TechnicalDetailsPublisher` interface and helper factory.
- `src/telegraph/noop-details-publisher.ts` — disabled publisher returning `null`.
- `src/telegraph/telegraph-client.ts` — Telegraph API adapter using `fetch`, timeout, truncation, validation, and warn logging.
- `tests/summary/technical-progress/classify.test.ts`.
- `tests/summary/technical-progress/formatter.test.ts`.
- `tests/summary/technical-progress/details.test.ts`.
- `tests/summary/technical-progress/redact.test.ts`.
- `tests/telegraph/telegraph-client.test.ts`.
- `tests/bot/utils/thinking-message.test.ts` if not already present.

Modify:

- `src/summary/formatter.ts` — keep summary helpers and `prepareCodeFile`; delegate `formatToolInfo()` to the new sync progress formatter.
- `src/bot/index.ts` — use async progress formatting only where Telegraph details are available before sending tool/thinking service messages.
- `src/bot/utils/thinking-message.ts` — produce one-line reasoning/thinking messages and optional linked completion output instead of expandable reasoning blocks.
- `src/bot/utils/reasoning-format.ts` — keep escaping utilities, remove reliance on expandable reasoning for final visible reasoning text.
- `src/config.ts` — add optional Telegraph config with `TELEGRAPH_ENABLED`, `TELEGRAPH_ACCESS_TOKEN`, `TELEGRAPH_AUTHOR_NAME`, `TELEGRAPH_TIMEOUT_MS`, `TELEGRAPH_MAX_CHARS`.
- `src/i18n/en.ts`, `src/i18n/ru.ts`, `src/i18n/de.ts`, `src/i18n/es.ts`, `src/i18n/fr.ts`, `src/i18n/zh.ts` — add typed `progress.*` keys.
- `tests/summary/formatter.test.ts` — update legacy facade expectations.
- `tests/bot/streaming/tool-call-streamer.test.ts` — keep lifecycle expectations, update message text only if needed.
- `PRODUCT.md` — add user-visible localized technical progress and optional Telegraph detail behavior.
- `CHANGELOG.md` — add Unreleased entry explaining why progress messages changed.

---

### Task 1: Progress classification domain

**Files:**
- Create: `src/summary/technical-progress/types.ts`
- Create: `src/summary/technical-progress/classify.ts`
- Test: `tests/summary/technical-progress/classify.test.ts`

- [ ] **Step 1: Write the failing classification tests**

Create `tests/summary/technical-progress/classify.test.ts`:

```ts
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
    expect(classifyTechnicalProgress(info("bash", "running"))).toMatchObject({ category: "command", phase: "running", outcome: "success" });
    expect(classifyTechnicalProgress(info("grep"))).toMatchObject({ category: "project_search", phase: "completed", outcome: "success" });
    expect(classifyTechnicalProgress(info("glob"))).toMatchObject({ category: "project_search", phase: "completed", outcome: "success" });
    expect(classifyTechnicalProgress(info("webfetch"))).toMatchObject({ category: "web_read", phase: "completed", outcome: "success" });
    expect(classifyTechnicalProgress(info("skill"))).toMatchObject({ category: "skill", phase: "completed", outcome: "success" });
    expect(classifyTechnicalProgress(info("task"))).toMatchObject({ category: "subagent", phase: "completed", outcome: "success" });
    expect(classifyTechnicalProgress(info("todowrite"))).toMatchObject({ category: "todo", phase: "completed", outcome: "success" });
  });

  it("classifies web search, MCP-like tools, failed tools, and unknown tools safely", () => {
    expect(classifyTechnicalProgress(info("web-search_tavily_search"))).toMatchObject({ category: "web_search" });
    expect(classifyTechnicalProgress(info("github.search_issues"))).toMatchObject({ category: "mcp" });
    expect(classifyTechnicalProgress(info("bash", "error"))).toMatchObject({ category: "command", phase: "completed", outcome: "failure" });
    expect(classifyTechnicalProgress(info("unknown_tool"))).toMatchObject({ category: "generic", phase: "completed", outcome: "success" });
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `npm test -- tests/summary/technical-progress/classify.test.ts`

Expected: FAIL because `src/summary/technical-progress/classify.ts` does not exist.

- [ ] **Step 3: Implement minimal classification types and function**

Create `src/summary/technical-progress/types.ts`:

```ts
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
```

Create `src/summary/technical-progress/classify.ts`:

```ts
import type { TechnicalProgressClassification, TechnicalProgressToolInfo } from "./types.js";

const MCP_NAME_PATTERN = /^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_.-]+$/;

export function classifyTechnicalProgress(
  toolInfo: Pick<TechnicalProgressToolInfo, "tool" | "state">,
): TechnicalProgressClassification {
  const phase = toolInfo.state.status === "running" || toolInfo.state.status === "pending" ? "running" : "completed";
  const outcome = toolInfo.state.status === "error" ? "failure" : "success";

  switch (toolInfo.tool) {
    case "read":
      return { category: "file_read", phase, outcome };
    case "write":
      return { category: "file_write", phase, outcome };
    case "edit":
      return { category: "file_edit", phase, outcome };
    case "apply_patch":
      return { category: "patch", phase, outcome };
    case "bash":
      return { category: "command", phase, outcome };
    case "grep":
    case "glob":
      return { category: "project_search", phase, outcome };
    case "web-search_tavily_search":
      return { category: "web_search", phase, outcome };
    case "webfetch":
    case "web-search_tavily_extract":
      return { category: "web_read", phase, outcome };
    case "skill":
      return { category: "skill", phase, outcome };
    case "task":
      return { category: "subagent", phase, outcome };
    case "todowrite":
    case "todoread":
      return { category: "todo", phase, outcome };
    default:
      return { category: MCP_NAME_PATTERN.test(toolInfo.tool) ? "mcp" : "generic", phase, outcome };
  }
}
```

- [ ] **Step 4: Verify classification tests pass**

Run: `npm test -- tests/summary/technical-progress/classify.test.ts`

Expected: PASS.

---

### Task 2: Redaction, titles, and metrics

**Files:**
- Create: `src/summary/technical-progress/redact.ts`
- Create: `src/summary/technical-progress/title.ts`
- Create: `src/summary/technical-progress/metrics.ts`
- Test: `tests/summary/technical-progress/redact.test.ts`
- Test: `tests/summary/technical-progress/formatter.test.ts`

- [ ] **Step 1: Write failing redaction/title/metric tests**

Create `tests/summary/technical-progress/redact.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { redactSecrets } from "../../../src/summary/technical-progress/redact.js";

describe("redactSecrets", () => {
  it("redacts common tokens, credentials, and URL passwords", () => {
    const text = "TOKEN=abc123456789 password=hunter2 https://user:secret@example.com x-api-key: sk-abcdef123456";

    expect(redactSecrets(text)).toBe("TOKEN=[REDACTED] password=[REDACTED] https://user:[REDACTED]@example.com x-api-key: [REDACTED]");
  });
});
```

Create `tests/summary/technical-progress/formatter.test.ts` with the first title/metric tests:

```ts
import { describe, expect, it, vi } from "vitest";
import { buildProgressMetric } from "../../../src/summary/technical-progress/metrics.js";
import { buildProgressTitle } from "../../../src/summary/technical-progress/title.js";

vi.mock("../../../src/settings/manager.js", () => ({
  getCurrentProject: () => ({ id: "p1", name: "repo", worktree: "D:/repo" }),
}));

describe("technical progress titles and metrics", () => {
  it("builds concise safe titles from files, commands, URLs, and fallback strings", () => {
    expect(buildProgressTitle({ tool: "read", input: { filePath: "D:/repo/src/formatter.ts" } } as never)).toBe("src/formatter.ts");
    expect(buildProgressTitle({ tool: "bash", input: { command: "npm test -- --runInBand" } } as never)).toBe("npm test -- --runInBand");
    expect(buildProgressTitle({ tool: "webfetch", input: { url: "https://opencode.ai/docs/sdk" } } as never)).toBe("opencode.ai");
    expect(buildProgressTitle({ tool: "unknown", input: { token: "abc123456", query: "formatToolInfo" } } as never)).toBe("formatToolInfo");
  });

  it("builds metrics for lines, diffs, results, tasks, command test summaries, and HTTP status", () => {
    expect(buildProgressMetric({ tool: "read", metadata: { lines: 345 } } as never)).toBe("345 lines");
    expect(buildProgressMetric({ tool: "write", input: { content: "one\ntwo" } } as never)).toBe("2 lines");
    expect(buildProgressMetric({ tool: "edit", metadata: { filediff: { additions: 34, deletions: 2 } } } as never)).toBe("+34 −2");
    expect(buildProgressMetric({ tool: "grep", metadata: { resultCount: 23 } } as never)).toBe("23 results");
    expect(buildProgressMetric({ tool: "todowrite", metadata: { todos: [{ id: "1", content: "A", status: "completed" }] } } as never)).toBe("1 task");
    expect(buildProgressMetric({ tool: "bash", metadata: { output: "3 failed, 66 passed" } } as never)).toBe("3 failed, 66 passed");
    expect(buildProgressMetric({ tool: "webfetch", metadata: { statusCode: 200 } } as never)).toBe("200 OK");
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `npm test -- tests/summary/technical-progress/redact.test.ts tests/summary/technical-progress/formatter.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement redaction, title, and metrics**

Create `src/summary/technical-progress/redact.ts`:

```ts
const SECRET_ASSIGNMENT_PATTERN = /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASS|API_KEY|ACCESS_KEY)[A-Z0-9_]*)\s*=\s*([^\s]+)/gi;
const SECRET_HEADER_PATTERN = /\b((?:x-)?api-key|authorization|token)\s*:\s*([^\s]+)/gi;
const URL_CREDENTIAL_PATTERN = /(https?:\/\/[^:\s/@]+:)([^@\s]+)(@)/gi;

export function redactSecrets(text: string): string {
  return text
    .replace(URL_CREDENTIAL_PATTERN, "$1[REDACTED]$3")
    .replace(SECRET_ASSIGNMENT_PATTERN, "$1=[REDACTED]")
    .replace(SECRET_HEADER_PATTERN, "$1: [REDACTED]");
}
```

Create `src/summary/technical-progress/title.ts`:

```ts
import { normalizePathForDisplay } from "../formatter.js";
import type { TechnicalProgressToolInfo } from "./types.js";
import { redactSecrets } from "./redact.js";

const TITLE_LIMIT = 96;

function truncate(text: string, limit = TITLE_LIMIT): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

function firstStringField(input: Record<string, unknown>, fields: string[]): string {
  for (const field of fields) {
    const value = input[field];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function buildProgressTitle(toolInfo: Pick<TechnicalProgressToolInfo, "tool" | "input" | "title">): string {
  const input = toolInfo.input ?? {};
  let title = toolInfo.title ?? "";

  if (["read", "write", "edit"].includes(toolInfo.tool)) {
    title = firstStringField(input, ["filePath", "path"]);
    title = title ? normalizePathForDisplay(title) : title;
  } else if (toolInfo.tool === "apply_patch") {
    title = firstStringField(input, ["filePath", "path"]);
    title = title ? normalizePathForDisplay(title) : toolInfo.title ?? "patch";
  } else if (toolInfo.tool === "bash") {
    title = firstStringField(input, ["command", "description"]);
  } else if (["grep", "glob", "web-search_tavily_search"].includes(toolInfo.tool)) {
    title = firstStringField(input, ["pattern", "query"]);
  } else if (["webfetch", "web-search_tavily_extract"].includes(toolInfo.tool)) {
    const url = firstStringField(input, ["url"]);
    title = url ? hostFromUrl(url) : "web page";
  } else if (toolInfo.tool === "todowrite") {
    title = "todo list";
  } else {
    title = firstStringField(input, ["query", "url", "name", "prompt", "text", "command"]);
  }

  return truncate(redactSecrets(title || toolInfo.tool));
}
```

Create `src/summary/technical-progress/metrics.ts`:

```ts
import type { TechnicalProgressToolInfo } from "./types.js";

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function lineCount(text: string): number {
  return text.length === 0 ? 0 : text.split("\n").length;
}

function statusText(statusCode: number): string {
  if (statusCode >= 200 && statusCode < 300) {
    return `${statusCode} OK`;
  }
  return String(statusCode);
}

export function buildProgressMetric(toolInfo: Pick<TechnicalProgressToolInfo, "tool" | "input" | "metadata">): string {
  const metadata = toolInfo.metadata ?? {};

  if (typeof metadata.output === "string") {
    const summary = metadata.output.match(/\d+ failed, \d+ passed/)?.[0] ?? metadata.output.match(/\d+ passed/)?.[0];
    if (summary) return summary;
  }

  if (typeof metadata.statusCode === "number") {
    return statusText(metadata.statusCode);
  }

  if (typeof metadata.lines === "number") {
    return plural(metadata.lines, "line", "lines");
  }

  const filediff = metadata.filediff as { additions?: number; deletions?: number } | undefined;
  if (filediff && (filediff.additions || filediff.deletions)) {
    const additions = filediff.additions ?? 0;
    const deletions = filediff.deletions ?? 0;
    return `+${additions} −${deletions}`;
  }

  if (typeof metadata.resultCount === "number") {
    return plural(metadata.resultCount, "result", "results");
  }

  const todos = metadata.todos as unknown[] | undefined;
  if (Array.isArray(todos)) {
    return plural(todos.length, "task", "tasks");
  }

  if (toolInfo.input && typeof toolInfo.input.content === "string") {
    return plural(lineCount(toolInfo.input.content), "line", "lines");
  }

  return "";
}
```

- [ ] **Step 4: Verify tests pass**

Run: `npm test -- tests/summary/technical-progress/redact.test.ts tests/summary/technical-progress/formatter.test.ts`

Expected: PASS.

---

### Task 3: Localized one-line formatter and todo output

**Files:**
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/ru.ts`
- Modify: `src/i18n/de.ts`, `src/i18n/es.ts`, `src/i18n/fr.ts`, `src/i18n/zh.ts`
- Create: `src/summary/technical-progress/formatter.ts`
- Modify: `src/summary/formatter.ts`
- Test: `tests/summary/technical-progress/formatter.test.ts`
- Test: `tests/summary/formatter.test.ts`

- [ ] **Step 1: Add failing Russian output catalog tests**

Append to `tests/summary/technical-progress/formatter.test.ts`:

```ts
import { formatTechnicalProgressSync } from "../../../src/summary/technical-progress/formatter.js";
import { setRuntimeLocaleOverride } from "../../../src/i18n/index.js";

describe("technical progress Russian one-line output", () => {
  beforeEach(() => setRuntimeLocaleOverride("ru"));

  it("formats file, patch, command, search, web, skill, subagent, MCP, network, and generic messages", () => {
    expect(formatTechnicalProgressSync({ sessionId: "s", messageId: "m", callId: "c", tool: "read", state: { status: "running" }, input: { filePath: "formatter.ts" } } as never).text).toBe("📄 Читаю файл — formatter.ts");
    expect(formatTechnicalProgressSync({ sessionId: "s", messageId: "m", callId: "c", tool: "read", state: { status: "completed" }, input: { filePath: "formatter.ts" }, metadata: { lines: 345 } } as never).text).toBe("📄 Прочитал файл — formatter.ts (345 строк)");
    expect(formatTechnicalProgressSync({ sessionId: "s", messageId: "m", callId: "c", tool: "edit", state: { status: "completed" }, input: { filePath: "summary/formatter.ts" }, metadata: { filediff: { additions: 34, deletions: 2 } } } as never).text).toBe("✍️ Отредактировал файл — summary/formatter.ts (+34 −2)");
    expect(formatTechnicalProgressSync({ sessionId: "s", messageId: "m", callId: "c", tool: "apply_patch", state: { status: "running" }, input: { filePath: "formatter.ts" } } as never).text).toBe("🧩 Применяю правку — formatter.ts");
    expect(formatTechnicalProgressSync({ sessionId: "s", messageId: "m", callId: "c", tool: "bash", state: { status: "running" }, input: { command: "npm test" } } as never).text).toBe("💻 Выполняю команду — npm test");
    expect(formatTechnicalProgressSync({ sessionId: "s", messageId: "m", callId: "c", tool: "grep", state: { status: "completed" }, input: { pattern: "formatToolInfo" }, metadata: { resultCount: 23 } } as never).text).toBe("🔎 Нашёл совпадения — formatToolInfo (23 результата)");
    expect(formatTechnicalProgressSync({ sessionId: "s", messageId: "m", callId: "c", tool: "grep", state: { status: "completed" }, input: { pattern: "formatToolInfo" }, metadata: { resultCount: 0 } } as never).text).toBe("🔎 Совпадений не найдено — formatToolInfo");
    expect(formatTechnicalProgressSync({ sessionId: "s", messageId: "m", callId: "c", tool: "webfetch", state: { status: "completed" }, input: { url: "https://opencode.ai/docs" } } as never).text).toBe("🌐 Прочитал страницу — opencode.ai");
    expect(formatTechnicalProgressSync({ sessionId: "s", messageId: "m", callId: "c", tool: "skill", state: { status: "completed" }, input: { name: "writing-plans" }, metadata: { taskCount: 12 } } as never).text).toBe("🧠 Выполнил навык — writing-plans (12 задач)");
    expect(formatTechnicalProgressSync({ sessionId: "s", messageId: "m", callId: "c", tool: "task", state: { status: "running" }, input: { description: "исследование progress formatter" } } as never).text).toBe("🤖 Субагент работает — исследование progress formatter");
    expect(formatTechnicalProgressSync({ sessionId: "s", messageId: "m", callId: "c", tool: "github.search_issues", state: { status: "completed" }, input: { query: "bug" }, metadata: { resultCount: 12 } } as never).text).toBe("🔌 MCP-инструмент выполнен — bug (12 результатов)");
    expect(formatTechnicalProgressSync({ sessionId: "s", messageId: "m", callId: "c", tool: "unknown_tool", state: { status: "completed" }, input: { name: "неизвестный инструмент" } } as never).text).toBe("⚙️ Выполнил действие — неизвестный инструмент");
  });

  it("formats todowrite with emoji statuses and all-done collapse", () => {
    const active = formatTechnicalProgressSync({
      sessionId: "s",
      messageId: "m",
      callId: "c",
      tool: "todowrite",
      state: { status: "completed" },
      metadata: {
        todos: [
          { id: "1", content: "Explore project context and source design document", status: "completed" },
          { id: "2", content: "Ask user to review written spec", status: "in_progress" },
          { id: "3", content: "Transition to implementation planning", status: "pending" },
        ],
      },
    } as never);

    expect(active.text).toBe([
      "📝 Обновил список задач — 3 пункта",
      "",
      "✅ Explore project context and source design document",
      "⏳ Ask user to review written spec",
      "⬜ Transition to implementation planning",
    ].join("\n"));

    const done = formatTechnicalProgressSync({
      sessionId: "s",
      messageId: "m",
      callId: "c",
      tool: "todowrite",
      state: { status: "completed" },
      metadata: { todos: [{ id: "1", content: "Done", status: "completed" }] },
    } as never);

    expect(done.text).toBe("✅ Все задачи выполнены");
  });
});
```

- [ ] **Step 2: Run the failing formatter test**

Run: `npm test -- tests/summary/technical-progress/formatter.test.ts`

Expected: FAIL because `formatTechnicalProgressSync()` and i18n keys do not exist.

- [ ] **Step 3: Add i18n keys**

Add these keys to `src/i18n/en.ts` and equivalent typed fallback strings to `de/es/fr/zh`. Add the exact Russian strings to `src/i18n/ru.ts`:

```ts
  "progress.file.read.running": "📄 Reading file",
  "progress.file.read.completed": "📄 Read file",
  "progress.file.write.running": "✍️ Editing file",
  "progress.file.write.completed": "📝 Created file",
  "progress.file.edit.running": "✍️ Editing file",
  "progress.file.edit.completed": "✍️ Edited file",
  "progress.file.delete.completed": "🗑️ Deleted file",
  "progress.patch.running": "🧩 Applying patch",
  "progress.patch.completed": "🧩 Applied patch",
  "progress.command.running": "💻 Running command",
  "progress.command.completed": "💻 Ran command",
  "progress.command.failed": "⚠️ Command failed",
  "progress.search.running": "🔎 Searching project",
  "progress.search.completed": "🔎 Found matches",
  "progress.search.empty": "🔎 No matches found",
  "progress.web.search.running": "🌐 Searching the web",
  "progress.web.search.completed": "🌐 Found sources",
  "progress.web.read.running": "🌐 Reading page",
  "progress.web.read.completed": "🌐 Read page",
  "progress.skill.running": "🧠 Loading skill",
  "progress.skill.loaded": "🧠 Loaded skill",
  "progress.skill.completed": "🧠 Completed skill",
  "progress.skill.failed": "⚠️ Skill failed",
  "progress.subagent.starting": "🤖 Starting subagent",
  "progress.subagent.running": "🤖 Subagent working",
  "progress.subagent.completed": "🤖 Subagent completed task",
  "progress.subagent.failed": "⚠️ Subagent failed",
  "progress.mcp.running": "🔌 Calling MCP tool",
  "progress.mcp.completed": "🔌 MCP tool completed",
  "progress.mcp.failed": "⚠️ MCP tool failed",
  "progress.todo.running": "📝 Updating task list",
  "progress.todo.completed": "📝 Updated task list",
  "progress.todo.all_done": "✅ All tasks complete",
  "progress.reasoning.running": "💭 Analyzing",
  "progress.reasoning.completed": "💭 Analyzed",
  "progress.network.running": "📡 Sending request",
  "progress.network.completed": "📡 Received response",
  "progress.network.failed": "⚠️ Request failed",
  "progress.package.running": "📦 Installing dependencies",
  "progress.build.running": "🏗️ Building project",
  "progress.test.running": "🧪 Running tests",
  "progress.test.completed": "🧪 Tests passed",
  "progress.test.failed": "⚠️ Tests failed",
  "progress.generic.running": "⚙️ Performing action",
  "progress.generic.completed": "⚙️ Performed action",
  "progress.generic.failed": "⚠️ Action failed",
```

For `src/i18n/ru.ts`, use:

```ts
  "progress.file.read.running": "📄 Читаю файл",
  "progress.file.read.completed": "📄 Прочитал файл",
  "progress.file.write.running": "✍️ Редактирую файл",
  "progress.file.write.completed": "📝 Создал файл",
  "progress.file.edit.running": "✍️ Редактирую файл",
  "progress.file.edit.completed": "✍️ Отредактировал файл",
  "progress.file.delete.completed": "🗑️ Удалил файл",
  "progress.patch.running": "🧩 Применяю правку",
  "progress.patch.completed": "🧩 Применил правку",
  "progress.command.running": "💻 Выполняю команду",
  "progress.command.completed": "💻 Выполнил команду",
  "progress.command.failed": "⚠️ Команда завершилась с ошибкой",
  "progress.search.running": "🔎 Ищу в проекте",
  "progress.search.completed": "🔎 Нашёл совпадения",
  "progress.search.empty": "🔎 Совпадений не найдено",
  "progress.web.search.running": "🌐 Ищу в интернете",
  "progress.web.search.completed": "🌐 Нашёл источники",
  "progress.web.read.running": "🌐 Читаю страницу",
  "progress.web.read.completed": "🌐 Прочитал страницу",
  "progress.skill.running": "🧠 Подключаю навык",
  "progress.skill.loaded": "🧠 Подключил навык",
  "progress.skill.completed": "🧠 Выполнил навык",
  "progress.skill.failed": "⚠️ Навык завершился с ошибкой",
  "progress.subagent.starting": "🤖 Запускаю субагента",
  "progress.subagent.running": "🤖 Субагент работает",
  "progress.subagent.completed": "🤖 Субагент завершил задачу",
  "progress.subagent.failed": "⚠️ Субагент завершился с ошибкой",
  "progress.mcp.running": "🔌 Вызываю MCP-инструмент",
  "progress.mcp.completed": "🔌 MCP-инструмент выполнен",
  "progress.mcp.failed": "⚠️ MCP-инструмент завершился с ошибкой",
  "progress.todo.running": "📝 Обновляю список задач",
  "progress.todo.completed": "📝 Обновил список задач",
  "progress.todo.all_done": "✅ Все задачи выполнены",
  "progress.reasoning.running": "💭 Анализирую",
  "progress.reasoning.completed": "💭 Анализировал",
  "progress.network.running": "📡 Отправляю запрос",
  "progress.network.completed": "📡 Получил ответ",
  "progress.network.failed": "⚠️ Запрос завершился с ошибкой",
  "progress.package.running": "📦 Устанавливаю зависимости",
  "progress.build.running": "🏗️ Собираю проект",
  "progress.test.running": "🧪 Запускаю тесты",
  "progress.test.completed": "🧪 Тесты прошли",
  "progress.test.failed": "⚠️ Тесты упали",
  "progress.generic.running": "⚙️ Выполняю действие",
  "progress.generic.completed": "⚙️ Выполнил действие",
  "progress.generic.failed": "⚠️ Действие завершилось с ошибкой",
```

- [ ] **Step 4: Implement sync formatter**

Create `src/summary/technical-progress/formatter.ts`:

```ts
import { t } from "../../i18n/index.js";
import { classifyTechnicalProgress } from "./classify.js";
import { buildProgressMetric } from "./metrics.js";
import { buildProgressTitle } from "./title.js";
import type { TechnicalProgressClassification, TechnicalProgressToolInfo } from "./types.js";

export interface TechnicalProgressFormatResult {
  text: string;
  format?: "html";
}

function metricText(metric: string): string {
  return metric ? ` (${metric})` : "";
}

function actionKey(classification: TechnicalProgressClassification): string {
  const { category, phase, outcome } = classification;

  if (outcome === "failure") {
    if (category === "command") return "progress.command.failed";
    if (category === "skill") return "progress.skill.failed";
    if (category === "subagent") return "progress.subagent.failed";
    if (category === "mcp") return "progress.mcp.failed";
    if (category === "network") return "progress.network.failed";
    if (category === "test") return "progress.test.failed";
    return "progress.generic.failed";
  }

  if (category === "file_read") return phase === "running" ? "progress.file.read.running" : "progress.file.read.completed";
  if (category === "file_write") return phase === "running" ? "progress.file.write.running" : "progress.file.write.completed";
  if (category === "file_edit") return phase === "running" ? "progress.file.edit.running" : "progress.file.edit.completed";
  if (category === "patch") return phase === "running" ? "progress.patch.running" : "progress.patch.completed";
  if (category === "command") return phase === "running" ? "progress.command.running" : "progress.command.completed";
  if (category === "project_search") return outcome === "empty" ? "progress.search.empty" : phase === "running" ? "progress.search.running" : "progress.search.completed";
  if (category === "web_search") return phase === "running" ? "progress.web.search.running" : "progress.web.search.completed";
  if (category === "web_read") return phase === "running" ? "progress.web.read.running" : "progress.web.read.completed";
  if (category === "skill") return phase === "running" ? "progress.skill.running" : "progress.skill.completed";
  if (category === "subagent") return phase === "running" ? "progress.subagent.running" : "progress.subagent.completed";
  if (category === "mcp") return phase === "running" ? "progress.mcp.running" : "progress.mcp.completed";
  if (category === "todo") return phase === "running" ? "progress.todo.running" : "progress.todo.completed";
  if (category === "reasoning") return phase === "running" ? "progress.reasoning.running" : "progress.reasoning.completed";
  if (category === "network") return phase === "running" ? "progress.network.running" : "progress.network.completed";
  if (category === "test") return phase === "running" ? "progress.test.running" : "progress.test.completed";
  if (category === "build") return "progress.build.running";
  if (category === "package") return "progress.package.running";
  return phase === "running" ? "progress.generic.running" : "progress.generic.completed";
}

function todoEmoji(status: string): string {
  if (status === "completed") return "✅";
  if (status === "in_progress") return "⏳";
  if (status === "cancelled") return "🚫";
  return "⬜";
}

function formatTodos(toolInfo: TechnicalProgressToolInfo): string | null {
  const todos = toolInfo.metadata?.todos as Array<{ id: string; content: string; status: string }> | undefined;
  if (!Array.isArray(todos)) return null;

  const allDone = todos.length > 0 && todos.every((todo) => todo.status === "completed" || todo.status === "cancelled");
  if (allDone) {
    return t("progress.todo.all_done");
  }

  const suffix = ` (${todos.length} ${todos.length === 1 ? "пункт" : todos.length >= 2 && todos.length <= 4 ? "пункта" : "пунктов"})`;
  return [`${t(actionKey(classifyTechnicalProgress(toolInfo)) as never)} — ${todos.length} ${todos.length === 1 ? "пункт" : todos.length >= 2 && todos.length <= 4 ? "пункта" : "пунктов"}`, "", ...todos.map((todo) => `${todoEmoji(todo.status)} ${todo.content}`)].join("\n");
}

export function formatTechnicalProgressSync(toolInfo: TechnicalProgressToolInfo): TechnicalProgressFormatResult {
  const todoText = toolInfo.tool === "todowrite" ? formatTodos(toolInfo) : null;
  if (todoText) {
    return { text: todoText };
  }

  const classification = classifyTechnicalProgress(toolInfo);
  const metadata = toolInfo.metadata ?? {};
  const metric = buildProgressMetric(toolInfo);
  const title = buildProgressTitle(toolInfo);
  const effectiveClassification = classification.category === "project_search" && metric === "0 results"
    ? { ...classification, outcome: "empty" as const }
    : classification;

  return {
    text: `${t(actionKey(effectiveClassification) as never)} — ${title}${metricText(metric)}`,
  };
}
```

After writing, replace the temporary Russian-only todo plural logic with locale-neutral metric logic if the compiler complains; keep the exact RU expected output green before refactoring.

- [ ] **Step 5: Delegate legacy facade**

In `src/summary/formatter.ts`, import the new formatter and replace only the body of `formatToolInfo()`:

```ts
import { formatTechnicalProgressSync } from "./technical-progress/formatter.js";
```

```ts
export function formatToolInfo(toolInfo: ToolInfo): string | null {
  return formatTechnicalProgressSync(toolInfo).text;
}
```

Do not remove other exports used by tests until the full suite confirms they are unused.

- [ ] **Step 6: Update legacy facade tests**

Update `tests/summary/formatter.test.ts` expectations for tool output:

```ts
expect(text).toBe([
  "📝 Updated task list — 3 tasks",
  "",
  "✅ Done item",
  "⏳ In progress item",
  "⬜ Pending item",
].join("\n"));
```

Use English expected strings in this legacy file unless the test explicitly sets Russian locale.

- [ ] **Step 7: Run formatter tests**

Run: `npm test -- tests/summary/technical-progress/formatter.test.ts tests/summary/formatter.test.ts`

Expected: PASS.

---

### Task 4: Useful details extraction

**Files:**
- Create: `src/summary/technical-progress/details.ts`
- Test: `tests/summary/technical-progress/details.test.ts`

- [ ] **Step 1: Write failing detail extraction tests**

Create `tests/summary/technical-progress/details.test.ts`:

```ts
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
    expect(buildTechnicalDetails({ tool: "bash", metadata: { output: "TOKEN=abc123456789" } } as never)?.body).toBe("TOKEN=[REDACTED]");
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `npm test -- tests/summary/technical-progress/details.test.ts`

Expected: FAIL because `details.ts` does not exist.

- [ ] **Step 3: Implement detail extraction**

Create `src/summary/technical-progress/details.ts`:

```ts
import { redactSecrets } from "./redact.js";
import type { TechnicalProgressToolInfo } from "./types.js";

export interface TechnicalDetails {
  title: string;
  body: string;
}

function isWorthless(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length === 0 || trimmed === "[object Object]" || trimmed === "{}" || trimmed === "[]";
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return JSON.stringify(value, null, 2);
}

function todoBody(todos: Array<{ content: string; status: string }>): string {
  return todos.map((todo) => `${todo.status === "completed" ? "✅" : todo.status === "in_progress" ? "⏳" : todo.status === "cancelled" ? "🚫" : "⬜"} ${todo.content}`).join("\n");
}

export function buildTechnicalDetails(toolInfo: TechnicalProgressToolInfo): TechnicalDetails | null {
  const metadata = toolInfo.metadata ?? {};
  const todos = metadata.todos as Array<{ content: string; status: string }> | undefined;
  const candidates = [
    metadata.output,
    metadata.diff,
    metadata.content,
    metadata.result,
    metadata.results,
    metadata.reasoningText,
    todos ? todoBody(todos) : undefined,
    toolInfo.title,
  ];

  const body = candidates.map(stringify).find((candidate) => !isWorthless(candidate));
  if (!body) return null;

  return {
    title: toolInfo.tool,
    body: redactSecrets(body),
  };
}
```

- [ ] **Step 4: Verify detail tests pass**

Run: `npm test -- tests/summary/technical-progress/details.test.ts`

Expected: PASS.

---

### Task 5: Telegraph adapter and async linked formatting

**Files:**
- Modify: `src/config.ts`
- Create: `src/telegraph/types.ts`
- Create: `src/telegraph/details-publisher.ts`
- Create: `src/telegraph/noop-details-publisher.ts`
- Create: `src/telegraph/telegraph-client.ts`
- Modify: `src/summary/technical-progress/formatter.ts`
- Test: `tests/telegraph/telegraph-client.test.ts`
- Test: `tests/summary/technical-progress/formatter.test.ts`

- [ ] **Step 1: Write failing Telegraph client tests**

Create `tests/telegraph/telegraph-client.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TelegraphClient } from "../../src/telegraph/telegraph-client.js";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("TelegraphClient", () => {
  it("publishes sanitized HTML and returns a valid Telegraph URL", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: { url: "https://telegra.ph/test" } }) });
    const client = new TelegraphClient({ enabled: true, accessToken: "token", authorName: "bot", timeoutMs: 1000, maxChars: 1000 });

    await expect(client.publish({ title: "npm test", body: "<hello>\nworld" })).resolves.toBe("https://telegra.ph/test");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.stringify(fetchMock.mock.calls[0][1])).toContain("&lt;hello&gt;<br>world");
  });

  it("returns null when disabled, API fails, URL is invalid, or body is empty", async () => {
    await expect(new TelegraphClient({ enabled: false, accessToken: "", authorName: "bot", timeoutMs: 1000, maxChars: 1000 }).publish({ title: "x", body: "body" })).resolves.toBeNull();

    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    await expect(new TelegraphClient({ enabled: true, accessToken: "token", authorName: "bot", timeoutMs: 1000, maxChars: 1000 }).publish({ title: "x", body: "body" })).resolves.toBeNull();

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, result: { url: "https://example.com/no" } }) });
    await expect(new TelegraphClient({ enabled: true, accessToken: "token", authorName: "bot", timeoutMs: 1000, maxChars: 1000 }).publish({ title: "x", body: "body" })).resolves.toBeNull();
  });
});
```

Append async formatting tests to `tests/summary/technical-progress/formatter.test.ts`:

```ts
import { formatTechnicalProgressWithDetails } from "../../../src/summary/technical-progress/formatter.js";

describe("technical progress Telegraph links", () => {
  it("wraps the complete one-line final message when useful details publish successfully", async () => {
    const publisher = { publish: vi.fn().mockResolvedValue("https://telegra.ph/npm-test") };

    const result = await formatTechnicalProgressWithDetails({ sessionId: "s", messageId: "m", callId: "c", tool: "bash", state: { status: "completed" }, input: { command: "npm test" }, metadata: { output: "69 passed" } } as never, publisher);

    expect(result).toEqual({ text: '<a href="https://telegra.ph/npm-test">💻 Выполнил команду — npm test (69 passed)</a>', format: "html" });
  });

  it("keeps the same unlinked one-line message when details are worthless or publishing fails", async () => {
    const publisher = { publish: vi.fn().mockResolvedValue(null) };

    await expect(formatTechnicalProgressWithDetails({ sessionId: "s", messageId: "m", callId: "c", tool: "bash", state: { status: "completed" }, input: { command: "npm test" }, metadata: { output: "" } } as never, publisher)).resolves.toEqual({ text: "💻 Выполнил команду — npm test" });
  });
});
```

- [ ] **Step 2: Run failing Telegraph tests**

Run: `npm test -- tests/telegraph/telegraph-client.test.ts tests/summary/technical-progress/formatter.test.ts`

Expected: FAIL because Telegraph modules and async formatter do not exist.

- [ ] **Step 3: Add config**

In `src/config.ts`, add a `telegraph` object near `bot`:

```ts
  telegraph: {
    enabled: getOptionalBooleanEnvVar("TELEGRAPH_ENABLED", false),
    accessToken: getEnvVar("TELEGRAPH_ACCESS_TOKEN", false),
    authorName: getEnvVar("TELEGRAPH_AUTHOR_NAME", false) || "opencode-tg",
    timeoutMs: getOptionalPositiveIntEnvVar("TELEGRAPH_TIMEOUT_MS", 3000),
    maxChars: getOptionalPositiveIntEnvVar("TELEGRAPH_MAX_CHARS", 60000),
  },
```

- [ ] **Step 4: Implement Telegraph types and client**

Create `src/telegraph/types.ts`:

```ts
export interface TelegraphConfig {
  enabled: boolean;
  accessToken: string;
  authorName: string;
  timeoutMs: number;
  maxChars: number;
}

export interface TechnicalDetailsPublishRequest {
  title: string;
  body: string;
}

export interface TechnicalDetailsPublisher {
  publish(request: TechnicalDetailsPublishRequest): Promise<string | null>;
}
```

Create `src/telegraph/details-publisher.ts`:

```ts
export type { TechnicalDetailsPublisher, TechnicalDetailsPublishRequest } from "./types.js";
```

Create `src/telegraph/noop-details-publisher.ts`:

```ts
import type { TechnicalDetailsPublishRequest, TechnicalDetailsPublisher } from "./types.js";

export class NoopDetailsPublisher implements TechnicalDetailsPublisher {
  async publish(_request: TechnicalDetailsPublishRequest): Promise<string | null> {
    return null;
  }
}
```

Create `src/telegraph/telegraph-client.ts`:

```ts
import { logger } from "../utils/logger.js";
import type { TechnicalDetailsPublishRequest, TechnicalDetailsPublisher, TelegraphConfig } from "./types.js";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function toHtml(body: string, maxChars: number): string {
  const truncated = body.length <= maxChars ? body : `${body.slice(0, maxChars)}\n\n[truncated]`;
  return escapeHtml(truncated).replace(/\n/g, "<br>");
}

function isTelegraphUrl(url: string): boolean {
  try {
    return new URL(url).host === "telegra.ph";
  } catch {
    return false;
  }
}

export class TelegraphClient implements TechnicalDetailsPublisher {
  constructor(private readonly config: TelegraphConfig) {}

  async publish(request: TechnicalDetailsPublishRequest): Promise<string | null> {
    if (!this.config.enabled || !this.config.accessToken || !request.body.trim()) {
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const params = new URLSearchParams({
        access_token: this.config.accessToken,
        title: request.title.slice(0, 256) || "OpenCode details",
        author_name: this.config.authorName,
        content: JSON.stringify([{ tag: "p", children: [toHtml(request.body, this.config.maxChars)] }]),
        return_content: "false",
      });
      const response = await fetch("https://api.telegra.ph/createPage", {
        method: "POST",
        body: params,
        signal: controller.signal,
      });
      if (!response.ok) {
        logger.warn("[Telegraph] createPage failed", { status: response.status });
        return null;
      }
      const payload = (await response.json()) as { ok?: boolean; result?: { url?: string } };
      const url = payload.result?.url ?? "";
      return payload.ok && isTelegraphUrl(url) ? url : null;
    } catch (error) {
      logger.warn("[Telegraph] createPage error", error);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}
```

- [ ] **Step 5: Implement async linked formatter**

In `src/summary/technical-progress/formatter.ts`, add:

```ts
import { buildTechnicalDetails } from "./details.js";
import type { TechnicalDetailsPublisher } from "../../telegraph/types.js";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function formatTechnicalProgressWithDetails(
  toolInfo: TechnicalProgressToolInfo,
  publisher: TechnicalDetailsPublisher,
): Promise<TechnicalProgressFormatResult> {
  const base = formatTechnicalProgressSync(toolInfo);
  const details = buildTechnicalDetails(toolInfo);
  if (!details) {
    return base;
  }

  const url = await publisher.publish({ title: base.text.replace(/\n.*/s, ""), body: details.body });
  if (!url) {
    return base;
  }

  return {
    text: `<a href="${escapeHtml(url)}">${escapeHtml(base.text)}</a>`,
    format: "html",
  };
}
```

- [ ] **Step 6: Verify Telegraph tests pass**

Run: `npm test -- tests/telegraph/telegraph-client.test.ts tests/summary/technical-progress/formatter.test.ts`

Expected: PASS.

---

### Task 6: Bot integration without lifecycle rewrite

**Files:**
- Modify: `src/bot/index.ts`
- Modify: `src/summary/tool-message-batcher.ts` only if it cannot carry HTML format through existing methods
- Test: `tests/bot/streaming/tool-call-streamer.test.ts`
- Test: add or update relevant bot tests around the `formatToolInfo()` call site

- [ ] **Step 1: Write failing integration test for linked tool message format**

Add a focused test near existing bot service-message tests, or create `tests/bot/technical-progress-delivery.test.ts` if no focused file exists:

```ts
import { describe, expect, it, vi } from "vitest";
import { formatTechnicalProgressWithDetails } from "../../src/summary/technical-progress/formatter.js";

describe("technical progress delivery contract", () => {
  it("returns html format only when Telegraph link is present", async () => {
    const linked = await formatTechnicalProgressWithDetails({ sessionId: "s", messageId: "m", callId: "c", tool: "bash", state: { status: "completed" }, input: { command: "npm test" }, metadata: { output: "69 passed" } } as never, { publish: vi.fn().mockResolvedValue("https://telegra.ph/npm-test") });
    const plain = await formatTechnicalProgressWithDetails({ sessionId: "s", messageId: "m", callId: "c", tool: "bash", state: { status: "completed" }, input: { command: "npm test" }, metadata: { output: "" } } as never, { publish: vi.fn().mockResolvedValue(null) });

    expect(linked.format).toBe("html");
    expect(plain.format).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run focused integration tests**

Run: `npm test -- tests/bot/technical-progress-delivery.test.ts tests/bot/streaming/tool-call-streamer.test.ts`

Expected: the new test passes once formatter exists; streamer tests should pass before integration changes.

- [ ] **Step 3: Wire publisher and async formatter at the bot tool-message call site**

In `src/bot/index.ts`:

- Import `formatTechnicalProgressWithDetails`.
- Import `TelegraphClient` and `NoopDetailsPublisher`.
- Create one publisher during bot setup:

```ts
const technicalDetailsPublisher = config.telegraph.enabled
  ? new TelegraphClient(config.telegraph)
  : new NoopDetailsPublisher();
```

At the existing `formatToolInfo()` service-message call site around `src/bot/index.ts:2036`, replace synchronous formatting only in the scheduled message publication path:

```ts
const formattedProgress = await formatTechnicalProgressWithDetails(toolInfo, technicalDetailsPublisher);
if (formattedProgress.text) {
  toolCallStreamer.publishToolMessage(scopeKey, toolInfo.callId, formattedProgress.text, formattedProgress.format);
}
```

Use the actual existing streamer/batcher method names found in `src/bot/index.ts`; preserve session IDs, ordering, throttling, visibility checks, and existing file attachment behavior.

- [ ] **Step 4: Run bot/streaming regression tests**

Run: `npm test -- tests/bot/streaming/tool-call-streamer.test.ts`

Expected: PASS. If it fails because a method lacks `format`, add the smallest overload/optional parameter and update only expected message payload, not ordering assertions.

---

### Task 7: Reasoning and thinking one-line Telegraph behavior

**Files:**
- Modify: `src/bot/utils/thinking-message.ts`
- Modify: `src/bot/utils/reasoning-format.ts`
- Modify: `src/bot/index.ts`
- Test: `tests/bot/utils/thinking-message.test.ts`

- [ ] **Step 1: Write failing reasoning tests**

Create or update `tests/bot/utils/thinking-message.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { buildThinkingMessageHtml, formatThinkingMessageWithReasoning } from "../../../src/bot/utils/thinking-message.js";

describe("thinking/reasoning messages", () => {
  it("keeps visible reasoning as one line without expandable body", () => {
    expect(buildThinkingMessageHtml("💭 Анализирую причину ошибки в Telegram streaming", "full reasoning body")).toBe("<b>💭 Анализирую причину ошибки в Telegram streaming</b>");
  });

  it("returns HTML format for reasoning title", () => {
    expect(formatThinkingMessageWithReasoning("💭 Анализирую причину ошибки в Telegram streaming", "body")).toEqual({
      text: "<b>💭 Анализирую причину ошибки в Telegram streaming</b>",
      format: "html",
    });
  });
});
```

- [ ] **Step 2: Run failing reasoning tests**

Run: `npm test -- tests/bot/utils/thinking-message.test.ts`

Expected: FAIL because current output includes `<blockquote expandable>`.

- [ ] **Step 3: Make reasoning visible text one-line only**

In `src/bot/utils/thinking-message.ts`, change `buildThinkingMessageHtml()` to ignore the reasoning body for visible output:

```ts
export function buildThinkingMessageHtml(title: string, _reasoningText: string): string {
  return `<b>${escapeHtml(title)}</b>`;
}
```

In `src/bot/index.ts`, when a reasoning block completes and useful reasoning text exists, create a pseudo tool info:

```ts
const formattedReasoning = await formatTechnicalProgressWithDetails({
  sessionId,
  messageId: reasoningMessageId,
  callId: reasoningMessageId,
  tool: "reasoning",
  state: { status: "completed" } as never,
  title: reasoningTitle,
  metadata: { reasoningText },
} as never, technicalDetailsPublisher);
```

Send `formattedReasoning.text` with `formattedReasoning.format` through the existing thinking delivery path. Preserve the current hide-thinking setting.

- [ ] **Step 4: Verify reasoning tests pass**

Run: `npm test -- tests/bot/utils/thinking-message.test.ts`

Expected: PASS.

---

### Task 8: Documentation and product updates

**Files:**
- Modify: `PRODUCT.md`
- Modify: `CHANGELOG.md`
- Optionally Modify: `.env.example` if Telegraph env variables are documented there

- [ ] **Step 1: Update PRODUCT.md**

In `PRODUCT.md`, under `### Result delivery`, add:

```md
- Show localized one-line technical progress messages for file, command, search, web, MCP, skill, subagent, todo, reasoning, network, build, test, and fallback actions; publish useful long details to Telegraph when configured while keeping Telegram chat concise.
```

Under `### Configuration`, add:

```md
- Optional Telegraph publishing for technical progress details (`TELEGRAPH_ENABLED`, `TELEGRAPH_ACCESS_TOKEN`, `TELEGRAPH_AUTHOR_NAME`, `TELEGRAPH_TIMEOUT_MS`, `TELEGRAPH_MAX_CHARS`)
```

- [ ] **Step 2: Update CHANGELOG.md**

Under `## [Unreleased]`, add to `### Added`:

```md
- Added localized one-line technical progress messages with optional Telegraph detail links for tool calls, todo updates, skills, subagents, MCP tools, web/search results, commands, reasoning, and fallback actions.
  - Why: mobile Telegram chats need concise progress updates without losing access to long technical details.
  - Affects: `src/summary/technical-progress/*`, `src/telegraph/*`, `src/summary/formatter.ts`, `src/bot/index.ts`, `src/bot/utils/thinking-message.ts`, `src/i18n/*.ts`
```

- [ ] **Step 3: Run docs-free type sanity check**

Run: `npm run build`

Expected: PASS or TypeScript errors only from implementation steps that must be fixed before final verification.

---

### Task 9: Full verification and review

**Files:**
- No new implementation files unless tests reveal defects.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npm test -- tests/summary/technical-progress tests/telegraph tests/summary/formatter.test.ts tests/bot/utils/thinking-message.test.ts tests/bot/streaming/tool-call-streamer.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run required quality checks**

Run:

```bash
npm run build
npm run lint
npm test
```

Expected: all PASS.

- [ ] **Step 3: Request post-implementation reviews**

Run two parallel review agents after checks pass:

Security review prompt:

```text
Review these changes for security issues only.

Focus on authn/authz, secrets handling, input validation, injection, SSRF, path traversal, unsafe deserialization, race conditions, logging leaks, privilege escalation, and remote-control abuse paths.
Pay extra attention to trust boundaries where the Telegram bot can trigger actions in local runtimes or external tools and publish details to Telegraph.

For each finding, report: severity, file:line, why it matters, exploitability, and the smallest safe fix.
If there are no findings, say so and mention any residual risk.
Do not suggest unrelated refactors.
```

Architecture review prompt:

```text
Review these changes for architecture and complexity quality.

Focus on coupling, cohesion, module boundaries, DDD bounded contexts, ubiquitous language, dependency direction, Clean Architecture layering, testability, observability, debuggability, scalability, and how hard it would be to replace Telegraph with another publisher.
Call out trade-offs, hotspots, hidden dependencies, and places where primitives leak across domain boundaries.
For each finding, report: severity, file:line, why it matters, and the smallest refactor that would improve the design.
Keep the focus on maintainability, not style.
```

Expected: review findings are either none or actionable. If findings appear, apply the smallest safe fixes with tests first, then rerun `npm run build`, `npm run lint`, and `npm test`.

---

## Self-review checklist

- Spec coverage: the plan covers classification, all visible output categories, broad Telegraph detail scope, worthless payload skipping, redaction, todo emojis/all-done collapse, reasoning one-line behavior, optional config, docs, and quality checks.
- Placeholder scan: no task says to add unspecified tests or undefined error handling without code/commands.
- Type consistency: `TechnicalDetailsPublisher.publish()` returns `Promise<string | null>` and is used consistently by `formatTechnicalProgressWithDetails()` and Telegraph adapters.
- Boundary check: no task rewrites the OpenCode event pipeline; bot integration is limited to formatting and optional HTML format propagation.
