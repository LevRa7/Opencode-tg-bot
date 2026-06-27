# Edit/Diff Rich Messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render `edit`/`apply_patch`/`write` tool outputs as inline rich `<details>` messages (no `.diff` file), and fix the collapsed-body bug where markup shows as raw tags.

**Architecture:** Stop producing a file attachment for the three diff/content tools in the summary aggregator so they flow into the existing Bot API 10.1 rich-message path; harden the rich formatter with line-aware truncation and markdown-consistent body rendering.

**Tech Stack:** TypeScript, Node 20, grammY, Vitest, custom i18n (`src/i18n`).

**Spec:** `docs/superpowers/specs/2026-06-26-edit-diff-rich-message-design.md`

---

## File Structure

- `src/i18n/{en,ru,de,es,fr,zh}.ts` — add `tool.diff.truncated` key (key type comes from `en`).
- `src/bot/utils/rich-message.ts` — add `truncateForRich` + budgets; consolidate `formatToolOutputForRichMessage` branches; add `locale` param + truncation marker; fix markdown body escaping; un-escape `formatThinkingForRichFinal` body; remove duplicate `apply_patch` case.
- `src/summary/aggregator.ts` — `prepareToolFileContext` returns `fileData: null` (keep `fileChange`) for `write`/`edit`/`apply_patch`.
- `src/bot/index.ts` — pass `getLocale()` into `formatToolOutputForRichMessage`.
- Tests: `tests/bot/utils/rich-message.test.ts`, `tests/summary/aggregator.test.ts`, `tests/i18n/index.test.ts`.
- Docs: `CHANGELOG.md`.

**Run a single test file:** `npx vitest run <path>`
**Run by name:** `npx vitest run <path> -t "<name>"`

---

## Task 1: i18n key `tool.diff.truncated`

**Files:**
- Modify: `src/i18n/en.ts:453`, `src/i18n/ru.ts:455`, `src/i18n/de.ts:373`, `src/i18n/es.ts:373`, `src/i18n/fr.ts:373`, `src/i18n/zh.ts:373`
- Test: `tests/i18n/index.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/i18n/index.test.ts` (inside the top-level `describe`, or add a new `describe`):

```ts
import { t } from "../../src/i18n/index.js";

describe("tool.diff.truncated", () => {
  it("interpolates shown/total in every locale", () => {
    for (const locale of ["en", "ru", "de", "es", "fr", "zh"] as const) {
      const result = t("tool.diff.truncated", { shown: 800, total: 3200 }, locale);
      expect(result).toContain("800");
      expect(result).toContain("3200");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/i18n/index.test.ts -t "interpolates shown/total"`
Expected: FAIL — `t` returns the key string `"tool.diff.truncated"` (key missing), so `toContain("800")` fails.

- [ ] **Step 3: Add the key to all six locales**

In `src/i18n/en.ts`, immediately after line 453 (`"tool.todo.overflow": "*({count} more tasks)*",`) add:

```ts
  "tool.diff.truncated": "… diff truncated (showing {shown} of {total} lines)",
```

In `src/i18n/ru.ts`, after its `"tool.todo.overflow"` line add:

```ts
  "tool.diff.truncated": "… дифф обрезан (показано {shown} из {total} строк)",
```

In `src/i18n/de.ts`, after its `"tool.todo.overflow"` line add:

```ts
  "tool.diff.truncated": "… Diff gekürzt (Zeilen {shown} von {total})",
```

In `src/i18n/es.ts`, after its `"tool.todo.overflow"` line add:

```ts
  "tool.diff.truncated": "… diff truncado (mostrando {shown} de {total} líneas)",
```

In `src/i18n/fr.ts`, after its `"tool.todo.overflow"` line add:

```ts
  "tool.diff.truncated": "… diff tronqué (affichage de {shown} sur {total} lignes)",
```

In `src/i18n/zh.ts`, after its `"tool.todo.overflow"` line add:

```ts
  "tool.diff.truncated": "… 差异已截断（显示 {shown}/{total} 行）",
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/i18n/index.test.ts -t "interpolates shown/total"`
Expected: PASS
Run: `npm run build`
Expected: PASS (tsc enforces the key in every `Record<I18nKey, string>` dictionary).

- [ ] **Step 5: Commit**

```bash
git add src/i18n/*.ts tests/i18n/index.test.ts
git commit -m "feat(i18n): add tool.diff.truncated marker"
```

---

## Task 2: `truncateForRich` helper + budgets

**Files:**
- Modify: `src/bot/utils/rich-message.ts` (add near the top constants and below the existing helpers)
- Test: `tests/bot/utils/rich-message.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/bot/utils/rich-message.test.ts`. First extend the import on lines 2-7 to include `truncateForRich`:

```ts
import {
  formatToolOutputForRichMessage,
  formatToolRichInitial,
  formatThinkingForRichFinal,
  formatToolCallForRichMessage,
  truncateForRich,
} from "../../../src/bot/utils/rich-message.js";
```

Then add:

```ts
describe("truncateForRich", () => {
  it("returns text unchanged when within budget", () => {
    const r = truncateForRich("a\nb\nc", 100, 100);
    expect(r.truncated).toBe(false);
    expect(r.text).toBe("a\nb\nc");
    expect(r.totalLines).toBe(3);
    expect(r.shownLines).toBe(3);
  });

  it("truncates on a line boundary and reports counts", () => {
    const text = Array.from({ length: 1000 }, (_, i) => `line-${i}`).join("\n");
    const r = truncateForRich(text, 200, 65536);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(200);
    expect(r.text.endsWith("\n")).toBe(false);
    expect(r.totalLines).toBe(1000);
    expect(r.shownLines).toBeLessThan(1000);
  });

  it("respects the byte budget for multibyte content", () => {
    const text = "あ".repeat(5000); // 3 bytes each → 15000 bytes
    const r = truncateForRich(text, 100000, 6000);
    expect(Buffer.byteLength(r.text, "utf-8")).toBeLessThanOrEqual(6000);
    expect(r.truncated).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bot/utils/rich-message.test.ts -t "truncateForRich"`
Expected: FAIL — `truncateForRich` is not exported.

- [ ] **Step 3: Implement the helper**

In `src/bot/utils/rich-message.ts`, just below the existing byte constant (`RICH_MESSAGE_MAX_BYTES`, line 8) add:

```ts
/** Inner-payload char budget; headroom under RICH_MESSAGE_MAX_CHARS for wrapper + marker. */
const RICH_INNER_BUDGET_CHARS = 30000;

/** Inner-payload byte budget; headroom under RICH_MESSAGE_MAX_BYTES. */
const RICH_INNER_BUDGET_BYTES = 60000;

export interface RichTruncation {
  text: string;
  truncated: boolean;
  shownLines: number;
  totalLines: number;
}

/**
 * Truncate text to char and byte budgets on a line boundary.
 * Used to keep an inline rich diff/content within Telegram's rich-message limits.
 */
export function truncateForRich(
  text: string,
  charBudget: number,
  byteBudget: number,
): RichTruncation {
  const totalLines = text.split("\n").length;
  let cut = text;
  let truncated = false;

  if (cut.length > charBudget) {
    cut = cut.slice(0, charBudget);
    truncated = true;
  }

  while (cut.length > 0 && Buffer.byteLength(cut, "utf-8") > byteBudget) {
    cut = cut.slice(0, Math.floor(cut.length * 0.9));
    truncated = true;
  }

  if (truncated) {
    const lastNewline = cut.lastIndexOf("\n");
    if (lastNewline > 0) {
      cut = cut.slice(0, lastNewline);
    }
  }

  const shownLines = cut.split("\n").length;
  return { text: cut, truncated, shownLines, totalLines };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bot/utils/rich-message.test.ts -t "truncateForRich"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/bot/utils/rich-message.ts tests/bot/utils/rich-message.test.ts
git commit -m "feat(rich): add truncateForRich helper with char/byte budgets"
```

---

## Task 3: Consolidate `formatToolOutputForRichMessage` (truncation + body fix + locale)

**Files:**
- Modify: `src/bot/utils/rich-message.ts:88-145` (the function), plus imports at top
- Test: `tests/bot/utils/rich-message.test.ts`

- [ ] **Step 1: Update existing tests to the corrected contract (and add new ones)**

In `tests/bot/utils/rich-message.test.ts`:

Replace the test at lines 51-60 (`"escapes < > & in the summary label"`) with one that only checks the summary, since the bash body now contains the literal command:

```ts
  it("escapes < > & in the summary label (body may contain literal command)", () => {
    const result = formatToolOutputForRichMessage(
      "bash",
      undefined,
      { command: "echo '<danger>'" },
      "hello world",
    );
    const summary = result!.slice(result!.indexOf("<summary>"), result!.indexOf("</summary>"));
    expect(summary).toContain("&lt;danger&gt;");
    expect(summary).not.toContain("<danger>");
  });
```

Replace the test at lines 62-70 (`"escapes special characters in bash command header"`) with:

```ts
  it("renders the bash command literally inside the code fence", () => {
    const result = formatToolOutputForRichMessage(
      "bash",
      undefined,
      { command: "cat < /dev/null &>/dev/null" },
      "ok",
    );
    expect(result).toContain("```bash");
    expect(result).toContain("$ cat < /dev/null &>/dev/null");
    expect(result).not.toContain("&lt; /dev/null");
  });
```

Replace the test at lines 97-106 (`"escapes content in non-code tools (todowrite)"`) with:

```ts
  it("emits todowrite body as raw markdown (no entity escaping)", () => {
    const result = formatToolOutputForRichMessage(
      "todowrite",
      "Задачи",
      undefined,
      "- [x] done <tag> & more",
    );
    expect(result).toContain("- [x] done <tag> & more");
    expect(result).not.toContain("&lt;tag&gt;");
    expect(result).not.toContain("&amp;");
  });
```

Replace the test at lines 118-127 (`"escapes content in reasoning tool"`) with:

```ts
  it("emits reasoning body as raw markdown (no entity escaping)", () => {
    const result = formatToolOutputForRichMessage(
      "reasoning",
      "Plan",
      undefined,
      "Use <div> tags & more",
    );
    expect(result).toContain("Use <div> tags & more");
    expect(result).not.toContain("&lt;div&gt;");
  });
```

Replace the test at lines 256-264 (`"handles ampersands in output correctly"`) with:

```ts
  it("does not entity-escape ampersands in reasoning body", () => {
    const result = formatToolOutputForRichMessage(
      "reasoning",
      "Analysis",
      undefined,
      "A && B && C",
    );
    expect(result).toContain("A && B && C");
    expect(result).not.toContain("&amp;");
  });
```

Add new truncation tests:

```ts
describe("formatToolOutputForRichMessage truncation", () => {
  it("truncates an oversized edit diff and appends the marker", () => {
    const big = Array.from({ length: 20000 }, (_, i) => `+line ${i}`).join("\n");
    const result = formatToolOutputForRichMessage("edit", undefined, undefined, big, undefined, undefined, "en")!;
    expect(result.length).toBeLessThanOrEqual(32768);
    expect(Buffer.byteLength(result, "utf-8")).toBeLessThanOrEqual(65536);
    expect(result).toContain("diff truncated");
    expect(result).toContain("```diff");
  });

  it("does not add a marker for a small diff", () => {
    const result = formatToolOutputForRichMessage("edit", undefined, undefined, "-a\n+b", undefined, undefined, "en")!;
    expect(result).not.toContain("truncated");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/bot/utils/rich-message.test.ts`
Expected: FAIL — old behavior still escapes; `locale` param/truncation not implemented; bash header still escaped.

- [ ] **Step 3: Add imports**

At the top of `src/bot/utils/rich-message.ts`, after line 2, add:

```ts
import { t, type Locale } from "../../i18n/index.js";
```

- [ ] **Step 4: Replace the function body (lines 88-145)**

Replace the entire `formatToolOutputForRichMessage` function (currently lines 88-145) with:

```ts
/**
 * Format tool call output as a clickable details block.
 * Title is the <summary> (always visible), output is hidden inside.
 *
 * Body is rendered markdown-consistently: fenced branches keep their content
 * literal; non-fenced branches (reasoning/todowrite) emit raw markdown so it
 * renders (fixes raw-tag display). Oversized payloads are truncated with a
 * localized marker.
 */
export function formatToolOutputForRichMessage(
  tool: string,
  title: string | undefined,
  input: Record<string, unknown> | undefined,
  output: string | undefined,
  metadata?: Record<string, unknown>,
  stateOutput?: unknown,
  locale?: Locale,
): string | null {
  if (!output || output.trim().length === 0) return null;

  const body = output.trim();
  const label = toolRichLabel(tool, title, input, metadata, stateOutput);
  const escapedLabel = escapeSummary(label);
  const openAttr = tool === "todowrite" ? " open" : "";

  // Decide the raw inner payload and its fence language (null = raw markdown body).
  let inner: string;
  let fenceLang: string | null;
  switch (tool) {
    case "bash": {
      const cmd = typeof input?.command === "string" ? input.command.trim() : "";
      inner = cmd ? `$ ${cmd}\n${body}` : body;
      fenceLang = "bash";
      break;
    }
    case "write": {
      inner = typeof input?.content === "string" ? input.content : body;
      fenceLang = detectCodeLang(typeof input?.filePath === "string" ? input.filePath : "");
      break;
    }
    case "edit":
    case "apply_patch":
    case "diff":
    case "filediff":
      inner = body;
      fenceLang = "diff";
      break;
    case "read": {
      inner = body;
      fenceLang = detectCodeLang(typeof input?.filePath === "string" ? input.filePath : "");
      break;
    }
    case "grep":
    case "glob":
      inner = body;
      fenceLang = "";
      break;
    case "reasoning":
    case "todowrite":
      inner = body;
      fenceLang = null;
      break;
    default:
      inner = body;
      fenceLang = "";
      break;
  }

  const { text: truncatedInner, truncated, shownLines, totalLines } = truncateForRich(
    inner,
    RICH_INNER_BUDGET_CHARS,
    RICH_INNER_BUDGET_BYTES,
  );

  let content = fenceLang === null ? truncatedInner : fencedCodeBlock(fenceLang, truncatedInner);

  if (truncated) {
    const marker = t("tool.diff.truncated", { shown: shownLines, total: totalLines }, locale);
    content = `${content}\n\n${marker}`;
  }

  return `<details${openAttr}><summary>${escapedLabel}</summary>\n\n${content}\n\n</details>`;
}
```

Note: the previous `escapeContent` usage for `reasoning`/`todowrite` is intentionally removed. `escapeContent` may now be unused — if `npm run lint` flags it as unused, delete the `escapeContent` function (lines ~243-245) as part of this step.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/bot/utils/rich-message.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/bot/utils/rich-message.ts tests/bot/utils/rich-message.test.ts
git commit -m "fix(rich): markdown-consistent tool body + diff truncation + locale"
```

---

## Task 4: Un-escape `formatThinkingForRichFinal` body

**Files:**
- Modify: `src/bot/utils/rich-message.ts:636-646`
- Test: `tests/bot/utils/rich-message.test.ts`

- [ ] **Step 1: Update the existing test (lines 187-191)**

Replace the test `"escapes < > & in the body text"` (lines 187-191) with:

```ts
  it("does not entity-escape the body text (markdown body)", () => {
    const result = formatThinkingForRichFinal("Title", "Use <p> tags &");
    expect(result).toContain("Use <p> tags &");
    expect(result).not.toContain("&lt;p&gt;");
  });
```

Keep the title-escaping test at lines 181-185 unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bot/utils/rich-message.test.ts -t "does not entity-escape the body text"`
Expected: FAIL — body is still `escapeContent`-escaped.

- [ ] **Step 3: Implement**

In `formatThinkingForRichFinal` (lines 636-646), change the body line from:

```ts
  const escapedBody = escapeContent(trimmed);
  return `<details><summary>${escapedTitle}</summary>\n\n${escapedBody}\n\n</details>`;
```

to:

```ts
  return `<details><summary>${escapedTitle}</summary>\n\n${trimmed}\n\n</details>`;
```

(Keep `escapedTitle = escapeSummary(...)` unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/bot/utils/rich-message.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/bot/utils/rich-message.ts tests/bot/utils/rich-message.test.ts
git commit -m "fix(rich): render thinking-final body as markdown, keep title escaped"
```

---

## Task 5: Aggregator drops file attachment for write/edit/apply_patch

**Files:**
- Modify: `src/summary/aggregator.ts:1829-1925` (`prepareToolFileContext`)
- Test: `tests/summary/aggregator.test.ts`

- [ ] **Step 1: Rewrite the two existing apply_patch file tests (lines 2021-2151)**

Replace the test `"sends apply_patch payload as tool file"` (lines 2021-2091) with:

```ts
  it("does NOT send apply_patch as a tool file; emits inline + fileChange", () => {
    const onTool = vi.fn();
    const onToolFile = vi.fn();
    const onFileChange = vi.fn();
    summaryAggregator.setOnTool(onTool);
    summaryAggregator.setOnToolFile(onToolFile);
    summaryAggregator.setOnFileChange(onFileChange);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: { id: "message-1", sessionID: "session-1", role: "assistant", time: { created: Date.now() } },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-1",
          sessionID: "session-1",
          messageID: "message-1",
          type: "tool",
          callID: "call-apply-patch",
          tool: "apply_patch",
          state: {
            status: "completed",
            input: { patchText: "irrelevant" },
            metadata: {
              filediff: { file: "D:/repo/src/one.ts", additions: 2, deletions: 1 },
              diff: ["@@ -1,2 +1,3 @@", "-before", "+after"].join("\n"),
            },
          },
        },
      },
    } as unknown as Event);

    expect(onToolFile).not.toHaveBeenCalled();

    const toolPayload = onTool.mock.calls.at(-1)![0] as { tool: string; hasFileAttachment: boolean };
    expect(toolPayload.tool).toBe("apply_patch");
    expect(toolPayload.hasFileAttachment).toBe(false);

    expect(onFileChange).toHaveBeenCalledWith("session-1", {
      file: "src/one.ts",
      additions: 2,
      deletions: 1,
    });
  });
```

Replace the test `"sends apply_patch file using title and patchText fallback"` (lines 2093-2151) with:

```ts
  it("does NOT send apply_patch file in the title/patchText fallback path", () => {
    const onToolFile = vi.fn();
    const onFileChange = vi.fn();
    summaryAggregator.setOnToolFile(onToolFile);
    summaryAggregator.setOnFileChange(onFileChange);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: { id: "message-2", sessionID: "session-1", role: "assistant", time: { created: Date.now() } },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-2",
          sessionID: "session-1",
          messageID: "message-2",
          type: "tool",
          callID: "call-apply-patch-fallback",
          tool: "apply_patch",
          state: {
            status: "completed",
            title: "Success. Updated the following files:\nM README.md",
            input: {
              patchText: ["--- a/README.md", "+++ b/README.md", "@@ -1,1 +1,2 @@", " old", "+new"].join("\n"),
            },
            metadata: {},
          },
        },
      },
    } as unknown as Event);

    expect(onToolFile).not.toHaveBeenCalled();
  });
```

Add a new behavioral test for `edit`:

```ts
  it("routes edit inline (no tool file) and still emits fileChange", () => {
    const onTool = vi.fn();
    const onToolFile = vi.fn();
    const onFileChange = vi.fn();
    summaryAggregator.setOnTool(onTool);
    summaryAggregator.setOnToolFile(onToolFile);
    summaryAggregator.setOnFileChange(onFileChange);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: { id: "message-edit", sessionID: "session-1", role: "assistant", time: { created: Date.now() } },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-edit",
          sessionID: "session-1",
          messageID: "message-edit",
          type: "tool",
          callID: "call-edit",
          tool: "edit",
          state: {
            status: "completed",
            input: { filePath: "D:/repo/src/two.ts" },
            metadata: {
              filediff: { file: "D:/repo/src/two.ts", additions: 3, deletions: 0 },
              diff: ["@@ -1 +1,4 @@", "+a", "+b", "+c"].join("\n"),
            },
          },
        },
      },
    } as unknown as Event);

    expect(onToolFile).not.toHaveBeenCalled();
    const toolPayload = onTool.mock.calls.at(-1)![0] as { tool: string; hasFileAttachment: boolean };
    expect(toolPayload.hasFileAttachment).toBe(false);
    expect(onFileChange).toHaveBeenCalledWith("session-1", { file: "src/two.ts", additions: 3, deletions: 0 });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/summary/aggregator.test.ts -t "apply_patch"`
Expected: FAIL — current code still produces `fileData` and fires `onToolFile`.

- [ ] **Step 3: Implement — drop fileData, keep fileChange**

In `src/summary/aggregator.ts`, in `prepareToolFileContext`:

`write` branch — change the `return` (currently lines 1839-1846) to:

```ts
      return {
        fileData: null,
        fileChange: {
          file: filePath,
          additions: content.split("\n").length,
          deletions: 0,
        },
      };
```

`edit` branch — change the `return` (currently lines 1863-1870) to:

```ts
      return {
        fileData: null,
        fileChange: {
          file: filePath,
          additions: editMetadata.filediff?.additions || 0,
          deletions: editMetadata.filediff?.deletions || 0,
        },
      };
```

`apply_patch` branch — change the `return` (currently lines 1921-1924) to:

```ts
      return {
        fileData: null,
        fileChange,
      };
```

(Leave all the `filePath`/`diffText`/`fileChange` computation above each `return` unchanged — only `fileData` becomes `null`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/summary/aggregator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/summary/aggregator.ts tests/summary/aggregator.test.ts
git commit -m "feat(summary): route write/edit/apply_patch inline, drop tool file"
```

---

## Task 6: Pass locale into the rich formatter in the bot

**Files:**
- Modify: `src/bot/index.ts:2670-2677`

- [ ] **Step 1: Pass `getLocale()` as the new argument**

`getLocale` is already imported in `src/bot/index.ts` (line 120). Update the call at lines 2670-2677 from:

```ts
                const richMarkdown = formatToolOutputForRichMessage(
                  toolInfo.tool,
                  translatedTitle,
                  toolInfo.input as Record<string, unknown> | undefined,
                  rawOutput,
                  toolInfo.metadata as Record<string, unknown> | undefined,
                  (toolInfo.state as Record<string, unknown>)?.output,
                );
```

to:

```ts
                const richMarkdown = formatToolOutputForRichMessage(
                  toolInfo.tool,
                  translatedTitle,
                  toolInfo.input as Record<string, unknown> | undefined,
                  rawOutput,
                  toolInfo.metadata as Record<string, unknown> | undefined,
                  (toolInfo.state as Record<string, unknown>)?.output,
                  getLocale(),
                );
```

- [ ] **Step 2: Typecheck + full test run**

Run: `npm run build`
Expected: PASS
Run: `npm test`
Expected: PASS (all suites)

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: PASS (0 warnings). If `escapeContent` is now unused, remove it; if `no-duplicate-case` was previously masking, confirm the duplicate `apply_patch` case is gone (handled in Task 3).

- [ ] **Step 4: Commit**

```bash
git add src/bot/index.ts
git commit -m "feat(bot): pass locale to rich tool-output formatter"
```

---

## Task 7: Changelog

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add an entry**

Add under the current unreleased/top section (match existing style in `CHANGELOG.md`):

```markdown
- Edit/apply_patch/write tool outputs now render as inline rich messages
  (collapsible diff/content) instead of a separate `.diff` file; oversized
  payloads are truncated with a localized marker.
- Fixed collapsed `<details>` body showing raw tags/entities — tool/reasoning/
  todowrite bodies now render as markdown.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): inline rich edit/diff messages + body formatting fix"
```

---

## Final verification

- [ ] `npm run build` — PASS
- [ ] `npm run lint` — PASS (0 warnings)
- [ ] `npm test` — PASS
- [ ] Manual (Telegram): trigger an `edit`, a large `edit`, a `todowrite`, and a `reasoning` step. Confirm:
  - inline collapsible diff appears, no `.diff` document is sent;
  - large diff shows the truncation marker and is within limits;
  - `todowrite` renders as a checklist and `reasoning` as formatted prose (no raw `&lt;`/tags).
- [ ] Run review agents in parallel (security + architecture) per AGENTS.md workflow.

## Self-review notes (coverage vs spec)

- §5.1 aggregator fileData drop → Task 5.
- §5.2 truncation + dup-case cleanup + budgets → Tasks 2, 3.
- §5.3 i18n marker → Task 1.
- §5.4 markdown body fix (bash/reasoning/todowrite/thinking) → Tasks 3, 4.
- §6 tests → Tasks 1-5 (unit + behavioral).
- Locale wiring (caller) → Task 6.
