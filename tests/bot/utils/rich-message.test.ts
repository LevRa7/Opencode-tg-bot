import { describe, expect, it } from "vitest";
import {
  formatToolOutputForRichMessage,
  formatToolRichInitial,
  formatThinkingForRichFinal,
  formatThinkingForRichDraft,
  formatToolCallForRichMessage,
  truncateForRich,
} from "../../../src/bot/utils/rich-message.js";

// ── Label escaping in <summary> ────────────────────────────────────────────

describe("formatToolRichInitial", () => {
  it("escapes < > & in the summary label", () => {
    const result = formatToolRichInitial("bash", undefined, {
      command: "echo '<test> & more'",
    });
    expect(result).toContain("<summary>");
    expect(result).not.toContain("<test>");
    expect(result).toContain("&lt;test&gt;");
    expect(result).toContain("&amp;");
  });

  it("escapes < > & in the title-based label", () => {
    const result = formatToolRichInitial("read", "read <test> & file", undefined);
    expect(result).toContain("&lt;test&gt;");
    expect(result).toContain("&amp;");
  });

  it("escapes file paths with special chars", () => {
    const result = formatToolRichInitial("glob", undefined, {
      filePath: "src/<a> & <b>.ts",
    });
    expect(result).toContain("&lt;a&gt;");
    expect(result).toContain("&lt;b&gt;");
    expect(result).toContain("&amp;");
  });

  it("produces valid <details> structure", () => {
    const result = formatToolRichInitial("bash", undefined, {
      command: "ls",
    });
    expect(result).toContain("<details><summary>");
    expect(result).toContain("</summary>");
    expect(result).toContain("</details>");
    expect(result).toContain("⏳ Выполняется…");
  });
});

// ── Tool output with code block fence protection ────────────────────────

describe("formatToolOutputForRichMessage", () => {
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

  it("renders the bash command literally inside the code fence", () => {
    const result = formatToolOutputForRichMessage(
      "bash",
      undefined,
      { command: "cat < /dev/null &>/dev/null" },
      "ok",
    );
    expect(result).toContain("```bash");
    expect(result).toContain("$ cat < /dev/null &>/dev/null");
    // The summary label is HTML-escaped (correctly), but the body inside
    // the code fence must contain the literal command.
    const bodyStart = result!.indexOf("```bash");
    const bodyEnd = result!.lastIndexOf("```");
    const body = result!.slice(bodyStart, bodyEnd);
    expect(body).not.toContain("&lt;");
  });

  it("uses 4 backticks when output contains triple backticks", () => {
    const output = "code: ```python\nprint('hello')\n```";
    const result = formatToolOutputForRichMessage(
      "bash",
      undefined,
      { command: "echo test" },
      output,
    );
    // Opening fence must be 4 backticks (line starts with ````, not ``` followed by non-backtick)
    expect(result).toMatch(/^````bash$/m);
    // Closing fence must be 4 backticks
    expect(result).toContain("\n````\n");
  });

  it("uses 3 backticks when output has no triple backticks", () => {
    const result = formatToolOutputForRichMessage(
      "bash",
      undefined,
      { command: "echo hello" },
      "hello world",
    );
    expect(result).toMatch(/^```bash$/m);
    expect(result).not.toMatch(/^````bash$/m);
  });

  it("escapes raw HTML tags (<tag>) in todowrite body", () => {
    // Fixed 2026-06-27: raw <tag> inside <details> was interpreted as HTML
    // by Telegram's rich markdown parser — the tag leaked through as literal
    // HTML markup instead of text.  Now passes through markdownToHtml which
    // entity-escapes < > & while preserving markdown formatting.
    const result = formatToolOutputForRichMessage(
      "todowrite",
      "Задачи",
      undefined,
      "- [x] done <tag> & more",
    );
    expect(result).toContain("- [x] done");
    expect(result).toContain("&lt;tag&gt;");
    expect(result).toContain("&amp;");
  });

  it("todowrite gets open attribute for task lists", () => {
    const result = formatToolOutputForRichMessage(
      "todowrite",
      "Задачи",
      undefined,
      "1. task 1\n2. task 2",
    );
    expect(result).toContain("<details open>");
  });

  it("escapes raw HTML tags (<div>) in reasoning body", () => {
    // Fixed 2026-06-27: reasoning text like "Use <div>" was leaking through
    // as literal HTML inside <details>, causing rendering artifacts.
    // markdownToHtml now entity-escapes < > & so they display as text.
    const result = formatToolOutputForRichMessage(
      "reasoning",
      "Plan",
      undefined,
      "Use <div> tags & more",
    );
    expect(result).toContain("&lt;div&gt;");
  });

  it("returns null for empty output", () => {
    expect(formatToolOutputForRichMessage("bash", undefined, {}, "")).toBeNull();
    expect(formatToolOutputForRichMessage("bash", undefined, {}, "  ")).toBeNull();
  });

  it("handles write/edit with content containing backticks", () => {
    const output = "code: ```ts\nconst x = 1;\n```";
    const result = formatToolOutputForRichMessage(
      "write",
      undefined,
      { content: output, filePath: "test.ts" },
      output,
    );
    expect(result).toContain("````typescript");
  });

  it("handles read output with triple backticks", () => {
    const output = "```json\n{}\n```";
    const result = formatToolOutputForRichMessage(
      "read",
      undefined,
      { filePath: "data.md" },
      output,
    );
    expect(result).toContain("````markdown");
  });

  it("handles diff output with triple backticks", () => {
    const output = "```diff\n-old\n+new\n```";
    const result = formatToolOutputForRichMessage(
      "diff",
      undefined,
      undefined,
      output,
    );
    expect(result).toContain("````diff");
  });

  it("handles grep/glob output with triple backticks", () => {
    const result = formatToolOutputForRichMessage(
      "grep",
      undefined,
      undefined,
      "found ``` in file",
    );
    expect(result).toContain("````\n");
  });

  it("neutralizes a literal </details> in the reasoning body", () => {
    // Fixed 2026-06-27: reasoning body now passes through markdownToHtml.
    // neutralizeDetailsMarkup inserts zws → <​/details> → markdownToHtml
    // escapes < to &lt; → &lt;​/details&gt;. Still safe: Telegram renders
    // &lt; as < visually, but never as a structural HTML tag.
    const result = formatToolOutputForRichMessage(
      "reasoning",
      "X",
      undefined,
      "talk about </details> tag",
      undefined,
      undefined,
      "en",
    )!;
    // Only the wrapper's real closing tag should remain un-neutralized.
    expect(result.match(/<\/details>/g)!.length).toBe(1);
    // The body's literal tag is HTML-escaped: &lt;​/details&gt;
    expect(result).toContain("&lt;\u200B/details&gt;");
  });

  it("neutralizes a literal </details> in fenced tool output (bash)", () => {
    const result = formatToolOutputForRichMessage(
      "bash",
      undefined,
      { command: "echo hi" },
      "log line </details> still inside",
      undefined,
      undefined,
      "en",
    )!;
    // Only the wrapper's real closing tag remains; the body's is neutralized.
    expect(result.match(/<\/details>/g)!.length).toBe(1);
    expect(result).toContain("\u200B/details>");
  });

  // ── Structural-tag neutralization (the symbol that breaks the wrapper) ──
  // Root cause: a literal opening <details> / <summary> in the body is parsed
  // by Telegram's rich-markdown renderer as real structural HTML, nesting or
  // duplicating the collapsible block so the OUTER <details> wrapper becomes
  // malformed and the whole block renders as raw tags. Only the closing
  // </details> used to be neutralized; opening <details>, <summary> and
  // </summary> leaked through. These tests pin the fix: every structural token
  // in the body must be zero-width-space neutralized, leaving exactly one
  // un-neutralized occurrence of each — the wrapper's own tags.

  it("neutralizes a literal opening <details> in the reasoning body", () => {
    // Fixed 2026-06-27: after markdownToHtml, the body's literal opening tag
    // becomes &lt;​details&gt; — safe against nesting inside the wrapper.
    const result = formatToolOutputForRichMessage(
      "reasoning",
      "X",
      undefined,
      "talk about <details> opening tag",
      undefined,
      undefined,
      "en",
    )!;
    // Only the wrapper's real opening tag should remain un-neutralized.
    expect(result.match(/<details>/g)!.length).toBe(1);
    // The body's literal tag is HTML-escaped: &lt;​details&gt;
    expect(result).toContain("&lt;\u200Bdetails&gt;");
  });

  it("neutralizes a literal <summary> in the reasoning body", () => {
    // Fixed 2026-06-27: after markdownToHtml, <summary>/</summary> become
    // &lt;​summary&gt; / &lt;​/summary&gt; — safe against nesting.
    const result = formatToolOutputForRichMessage(
      "reasoning",
      "X",
      undefined,
      "talk about <summary> and </summary> tags",
      undefined,
      undefined,
      "en",
    )!;
    // Only the wrapper's real <summary>/</summary> pair should remain.
    expect(result.match(/<summary>/g)!.length).toBe(1);
    expect(result.match(/<\/summary>/g)!.length).toBe(1);
    // Body's literal tags are HTML-escaped.
    expect(result).toContain("&lt;\u200Bsummary&gt;");
    expect(result).toContain("&lt;\u200B/summary&gt;");
  });

  it("neutralizes a literal opening <details> in fenced tool output (bash)", () => {
    const result = formatToolOutputForRichMessage(
      "bash",
      undefined,
      { command: "echo hi" },
      "log line <details> still inside",
      undefined,
      undefined,
      "en",
    )!;
    // Defense-in-depth: even inside a code fence the body's opening tag is neutralized.
    expect(result.match(/<details>/g)!.length).toBe(1);
    expect(result).toContain("<\u200Bdetails>");
  });

  it("escapes raw HTML-like tags (<script>, <b>, <a>) in skill body", () => {
    // Regression test (2026-06-27): before the fix, "<script>alert(1)</script>"
    // inside a skill tool's details block would be parsed as REAL HTML by
    // Telegram's rich markdown renderer — a potential injection vector.
    const result = formatToolOutputForRichMessage(
      "skill",
      "Skill",
      undefined,
      "Check <script>alert(1)</script> and <b>bold</b> and <a href=x>link</a>",
    )!;
    // All HTML-like tokens must be entity-escaped so they render as text.
    expect(result).toContain("&lt;script&gt;");
    expect(result).toContain("&lt;/script&gt;");
    expect(result).toContain("&lt;b&gt;");
    expect(result).toContain("&lt;/b&gt;");
    expect(result).toContain("&lt;a href=x&gt;");
    expect(result).toContain("&lt;/a&gt;");
    // Wrapper tags must remain intact.
    expect(result.match(/<details>/g)!.length).toBe(1);
    expect(result.match(/<\/details>/g)!.length).toBe(1);
  });

  it("escapes raw HTML-like tags in reasoning body", () => {
    const result = formatToolOutputForRichMessage(
      "reasoning",
      "Analysis",
      undefined,
      "Consider using <script> tags or <iframe> embedding",
    )!;
    expect(result).toContain("&lt;script&gt;");
    expect(result).toContain("&lt;iframe&gt;");
    // Markdown formatting should still work.
    // The body "Consider using" is plain text, stays as-is.
    expect(result).toContain("Consider using");
  });

  it("escapes raw HTML-like tags in todowrite body", () => {
    const result = formatToolOutputForRichMessage(
      "todowrite",
      "Tasks",
      undefined,
      "- [x] Add <form> validation\n- [ ] Fix <input> sanitization",
    )!;
    expect(result).toContain("&lt;form&gt;");
    expect(result).toContain("&lt;input&gt;");
    // Task list syntax preserved.
    expect(result).toContain("- [x]");
    expect(result).toContain("- [ ]");
  });

  // ── Skill tool output ──────────────────────────────────────────────
  // Skill was previously missing from the switch; it fell through to the
  // default branch (fenceLang = "") and rendered as inert code.
  // Now it uses fenceLang = null like reasoning/todowrite.

  it("renders skill output with markdown converted to HTML (no code fence)", () => {
    // Fixed 2026-06-27: skill body now passes through markdownToHtml like
    // reasoning/todowrite. **bold** → <b>, `code` → <code>, <tag> → &lt;tag&gt;.
    // No code fence — content is inline HTML inside <details>.
    const result = formatToolOutputForRichMessage(
      "skill",
      "🧠 Skill",
      undefined,
      "Skill **result** with `code` and *emphasis*",
    );
    expect(result).toContain("<b>result</b>");
    expect(result).toContain("<code>code</code>");
    expect(result).toContain("<i>emphasis</i>");
    expect(result).not.toContain("```"); // no code fence
    expect(result).toContain("<details>");
    expect(result).toContain("</details>");
  });

  it("returns null for empty skill output", () => {
    expect(formatToolOutputForRichMessage("skill", "S", undefined, "")).toBeNull();
    expect(formatToolOutputForRichMessage("skill", "S", undefined, "  ")).toBeNull();
  });

  it("neutralizes literal </details> in skill body", () => {
    const result = formatToolOutputForRichMessage(
      "skill",
      "Skill",
      undefined,
      "using </details> inside skill output",
    )!;
    expect(result.match(/<\/details>/g)!.length).toBe(1);
    // Body's tag is HTML-escaped by markdownToHtml.
    expect(result).toContain("&lt;\u200B/details&gt;");
  });

  it("neutralizes literal <details> and <summary> in skill body", () => {
    const result = formatToolOutputForRichMessage(
      "skill",
      "Skill",
      undefined,
      "<details><summary>nested</summary> content",
    )!;
    expect(result.match(/<details>/g)!.length).toBe(1);
    expect(result.match(/<summary>/g)!.length).toBe(1);
    expect(result.match(/<\/summary>/g)!.length).toBe(1);
    // Body's tags are HTML-escaped by markdownToHtml.
    expect(result).toContain("&lt;\u200Bdetails&gt;");
    expect(result).toContain("&lt;\u200Bsummary&gt;");
  });
});

// ── Truncation in formatToolOutputForRichMessage ─────────────────────

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

  it("truncates oversized write content and appends the marker", () => {
    const bigContent = Array.from({ length: 20000 }, (_, i) => `line ${i}`).join("\n");
    const result = formatToolOutputForRichMessage(
      "write",
      undefined,
      { content: bigContent, filePath: "test.ts" },
      "fallback output",
      undefined,
      undefined,
      "en",
    )!;
    expect(result.length).toBeLessThanOrEqual(32768);
    expect(Buffer.byteLength(result, "utf-8")).toBeLessThanOrEqual(65536);
    expect(result).toContain("diff truncated");
  });

  it("truncates oversized reasoning and appends the marker without a fence", () => {
    const big = Array.from({ length: 20000 }, (_, i) => `- point ${i}`).join("\n");
    const result = formatToolOutputForRichMessage(
      "reasoning",
      "Analysis",
      undefined,
      big,
      undefined,
      undefined,
      "en",
    )!;
    expect(result.length).toBeLessThanOrEqual(32768);
    expect(result).toContain("diff truncated");
    expect(result).not.toContain("```"); // reasoning is raw markdown, no fence
  });
});

// ── Thinking rich final escaping ──────────────────────────────────────

describe("formatThinkingForRichFinal", () => {
  it("escapes < > & in the summary title", () => {
    const result = formatThinkingForRichFinal("Step <5> & recap", "Some reasoning");
    expect(result).toContain("&lt;5&gt;");
    expect(result).toContain("&amp;");
  });

  it("escapes HTML entities in the body (HTML mode)", () => {
    // With rich_message { html }, markdownToHtml entity-escapes raw <, >, &
    // inside the body so they are inert (prevent tag-injection / nesting).
    const result = formatThinkingForRichFinal("Title", "Use <p> tags &");
    expect(result).toContain("&lt;p&gt;");
    expect(result).toContain("&amp;");
  });

  it("neutralizes a literal </details> in the thinking body", () => {
    const result = formatThinkingForRichFinal("Title", "discussing </details> here");
    // Only the outer wrapper has a real </details> tag
    expect(result.match(/<\/details>/g)!.length).toBe(1);
    // Literal </details> is HTML-escaped: &lt; + (optional zws) + /details&gt;
    expect(result).toContain("/details&gt;");
    // The raw literal tag must not appear as an unmatched tag
    expect((result.match(/<\/details>/g) ?? []).length).toBe(1);
  });

  it("neutralizes literal opening <details> and <summary> in the thinking body", () => {
    // Reasoning text routinely contains literal <details>/<summary> tokens
    // (e.g. when discussing this very feature). Without neutralization they
    // nest inside the wrapper and break the collapsible block client-side.
    // markdownToHtml's escapeHtml step converts them to &lt;...&gt; entities.
    const result = formatThinkingForRichFinal(
      "Title",
      "uses <details><summary>x</summary> nested",
    );
    // Outer collapsible wrapper: exactly one <details>, one <summary>/</summary>
    expect(result.match(/<details>/g)!.length).toBe(1);
    expect(result.match(/<summary>/g)!.length).toBe(1);
    expect(result.match(/<\/summary>/g)!.length).toBe(1);
    // Literal tokens are HTML-escaped (safe in rich_message { html } mode).
    // NeutralizeDetailsMarkup inserts a zws after &lt; so &lt;details&gt; / &lt;summary&gt;
    // entities won't accidentally match as real tags.
    expect(result).toMatch(/&lt;\u200B?details&gt;/);
    expect(result).toMatch(/&lt;\u200B?summary&gt;/);
  });

  it("renders reasoning body as safe HTML instead of a code fence", () => {
    // With rich_message { html }, markdownToHtml converts reasoning prose
    // to Telegram-safe HTML. Only https?:// URLs become <a> links;
    // [l](bad) stays literal. <details> tokens are escaped so they
    // cannot nest inside the collapsible wrapper.
    const result = formatThinkingForRichFinal(
      "Title",
      "see <details> and https://x.com/page and [l](bad)",
    );
    // Body is rendered inline (no code fence), wrapper tags are intact
    expect(result).toMatch(/<\/summary>\n\n[\s\S]*\n\n<\/details>/);
    expect(result).toContain("https://x.com/page");
    expect(result).not.toContain("```");
    // Literal <details> is HTML-escaped
    expect(result).toMatch(/&lt;\u200B?details&gt;/);
    // The outer wrapper tag must be the only real <details> tag
    expect((result.match(/<details>/g) ?? []).length).toBe(1);
  });

  it("returns title-only details for empty text", () => {
    const result = formatThinkingForRichFinal("Title", "");
    expect(result).toContain("<details>");
    expect(result).toContain("💭 Title");
    expect(result).not.toContain("\n\n\n"); // no body text, just empty content area
    const result2 = formatThinkingForRichFinal("Title", "  ");
    expect(result2).toContain("<details>");
    expect(result2).toContain("💭 Title");
  });
});

// ── Reasoning/thinking title length cap (max 100 chars, longer → "…") ──

describe("thinking title length cap", () => {
  it("truncates a >100-char title to 100 chars with an ellipsis in the final block", () => {
    const longTitle = "a".repeat(150);
    const result = formatThinkingForRichFinal(longTitle, "some body");
    const summary = result.slice(
      result.indexOf("<summary>") + "<summary>".length,
      result.indexOf("</summary>"),
    );
    expect(summary.startsWith("💭 ")).toBe(true);
    const titlePart = summary.slice("💭 ".length);
    expect(titlePart.length).toBeLessThanOrEqual(100);
    expect(titlePart.endsWith("…")).toBe(true);
    // The full untruncated title must not survive.
    expect(result).not.toContain("a".repeat(101));
  });

  it("leaves a ≤100-char title unchanged in the final block", () => {
    const title = "Short reasoning title";
    const result = formatThinkingForRichFinal(title, "body");
    expect(result).toContain(`💭 ${title}`);
    expect(result).not.toContain("…");
  });

  it("truncates a >100-char title to 100 chars with an ellipsis in the draft", () => {
    const longTitle = "b".repeat(150);
    const result = formatThinkingForRichDraft(longTitle, "body");
    expect(result).not.toContain("b".repeat(101));
    expect(result).toContain("…");
  });
});

// ── formatThinkingForRichDraft markdown → HTML conversion ───────────────
// Since switching from textToRichHtml (escape-only) to markdownToHtml,
// reasoning text in the animated <tg-thinking> draft must render markdown
// formatting as proper HTML tags.

describe("formatThinkingForRichDraft markdown → HTML", () => {
  it("converts **bold** to <b> tags", () => {
    const result = formatThinkingForRichDraft("Title", "This is **bold** text");
    expect(result).toContain("<b>bold</b>");
    expect(result).not.toContain("**bold**");
  });

  it("converts *italic* to <i> tags", () => {
    const result = formatThinkingForRichDraft("Title", "This is *italic* text");
    expect(result).toContain("<i>italic</i>");
    expect(result).not.toContain("*italic*");
  });

  it("converts inline `code` to <code> tags", () => {
    const result = formatThinkingForRichDraft("Title", "Use `npm install` command");
    expect(result).toContain("<code>npm install</code>");
    expect(result).not.toContain("`npm install`");
  });

  it("converts [text](url) to <a> links for https?:// URLs", () => {
    const result = formatThinkingForRichDraft(
      "Title",
      "See [docs](https://example.com/guide) for details",
    );
    expect(result).toContain('<a href="https://example.com/guide">docs</a>');
    expect(result).not.toContain("[docs](https://example.com/guide)");
  });

  it("keeps [text](url) literal for non-https?:// URLs", () => {
    const result = formatThinkingForRichDraft(
      "Title",
      "Local [file](file:///etc/passwd) skipped",
    );
    expect(result).toContain("[file](file:///etc/passwd)");
    expect(result).not.toContain('<a href="file:');
  });

  it("converts ~~strikethrough~~ to <s>", () => {
    const result = formatThinkingForRichDraft("Title", "This is ~~wrong~~ correct");
    expect(result).toContain("<s>wrong</s>");
    expect(result).not.toContain("~~wrong~~");
  });

  it("converts ```code blocks``` to <pre>", () => {
    const result = formatThinkingForRichDraft(
      "Title",
      "Run:\n```bash\nnpm test\n```",
    );
    expect(result).toContain("<pre>npm test</pre>");
    expect(result).not.toContain("```bash");
  });

  it("converts multiline body: newlines → <br/> after HTML tags", () => {
    const result = formatThinkingForRichDraft(
      "Title",
      "**First** line\n*Second* line",
    );
    expect(result).toContain("<b>First</b>");
    expect(result).toContain("<i>Second</i>");
    // Newlines between formatted blocks become <br/>
    expect(result).toMatch(/line<br\/>/);
  });

  it("entity-escapes raw < > & in body text", () => {
    const result = formatThinkingForRichDraft(
      "Title",
      "Use <div> & <span> tags",
    );
    expect(result).toContain("&lt;div&gt;");
    expect(result).toContain("&lt;span&gt;");
    expect(result).toContain("&amp;");
  });

  it("wraps output in <tg-thinking> with emoji-prefixed title", () => {
    const result = formatThinkingForRichDraft("Plan", "Step 1");
    expect(result).toMatch(/^<tg-thinking>/);
    expect(result).toMatch(/<\/tg-thinking>$/);
    expect(result).toContain("<b>💭 Plan</b>");
  });

  it("returns empty string for empty body", () => {
    expect(formatThinkingForRichDraft("Title", "")).toBe("");
    expect(formatThinkingForRichDraft("Title", "  ")).toBe("");
  });
});

// ── FormatThinkingForRichFinal markdown → HTML rendering ────────────────
// With the switch from code-fenced markdown to rich_message { html },
// the final thinking block must render markdown formatting as HTML.

describe("formatThinkingForRichFinal markdown → HTML", () => {
  it("converts **bold** to <b> in the details body", () => {
    const result = formatThinkingForRichFinal("Title", "**Bold** text here");
    expect(result).toContain("<b>Bold</b>");
    expect(result).not.toContain("```"); // no code fence
    expect(result).not.toContain("**Bold**");
  });

  it("converts *italic* to <i> in the details body", () => {
    const result = formatThinkingForRichFinal("Title", "*Italic* text");
    expect(result).toContain("<i>Italic</i>");
    expect(result).not.toContain("```");
  });

  it("converts inline `code` to <code> in the details body", () => {
    const result = formatThinkingForRichFinal("Title", "Run `npm test`");
    expect(result).toContain("<code>npm test</code>");
    expect(result).not.toContain("```");
  });

  it("converts [text](https://...) to <a> link", () => {
    const result = formatThinkingForRichFinal(
      "Title",
      "Check [the docs](https://example.com)",
    );
    expect(result).toContain('<a href="https://example.com">the docs</a>');
  });

  it("keeps [text](bad-scheme) literal (not converted to <a>)", () => {
    const result = formatThinkingForRichFinal(
      "Title",
      "Avoid [local](file:///etc/passwd)",
    );
    expect(result).not.toContain('<a href="file:');
    expect(result).toContain("[local](file:///etc/passwd)");
  });

  it("converts ~~strikethrough~~ to <s>", () => {
    const result = formatThinkingForRichFinal("Title", "This is ~~old~~ new");
    expect(result).toContain("<s>old</s>");
  });
});

// ── Read/Write header: path in <code>, line count in (N строк) ─────────

function summaryOf(result: string): string {
  return result.slice(
    result.indexOf("<summary>") + "<summary>".length,
    result.indexOf("</summary>"),
  );
}

describe("read/write tool header formatting", () => {
  it("read header wraps the file path in <code> and shows the line count", () => {
    // stateOutput drives the read line count (3 non-empty lines → "3 строки").
    const result = formatToolOutputForRichMessage(
      "read",
      undefined,
      { filePath: "src/app.ts" },
      "file body here",
      undefined,
      "a\nb\nc",
      "en",
    )!;
    const summary = summaryOf(result);
    expect(summary).toContain("<code>src/app.ts</code>");
    expect(summary).toContain("(3 строки)");
    // The <code> tag must stay literal (not double-escaped).
    expect(summary).not.toContain("&lt;code&gt;");
  });

  it("write header wraps the file path in <code> and shows the line count from content", () => {
    const result = formatToolOutputForRichMessage(
      "write",
      undefined,
      { filePath: "src/new.ts", content: "x\ny" },
      "ok",
      undefined,
      undefined,
      "en",
    )!;
    const summary = summaryOf(result);
    expect(summary).toContain("<code>src/new.ts</code>");
    expect(summary).toContain("(2 строки)");
  });

  it("escapes special chars inside the <code>-wrapped path (initial message)", () => {
    const result = formatToolRichInitial("read", undefined, { filePath: "src/<a>&b.ts" });
    const summary = summaryOf(result);
    expect(summary).toContain("<code>src/&lt;a&gt;&amp;b.ts</code>");
    expect(summary).not.toContain("&lt;code&gt;");
  });

  it("read/write without a filePath falls back to the escaped title", () => {
    const result = formatToolRichInitial("read", "read <x> & file", undefined);
    const summary = summaryOf(result);
    expect(summary).toContain("&lt;x&gt;");
    expect(summary).not.toContain("<code>");
  });
});

// ── Tool call rich message heading escaping ───────────────────────────

describe("formatToolCallForRichMessage", () => {
  it("escapes < > & in the heading title", () => {
    const result = formatToolCallForRichMessage(
      "bash",
      "echo '<hello> & world'",
      "output",
    );
    expect(result).toContain("&lt;hello&gt;");
    expect(result).toContain("&amp;");
  });

  it("uses fence protection for output with backticks", () => {
    const result = formatToolCallForRichMessage(
      "bash",
      "test",
      "output ```with backticks``` inside",
    );
    expect(result).toContain("````bash");
  });

  it("uses default 3-backtick code block for normal output", () => {
    const result = formatToolCallForRichMessage("bash", "test", "hello");
    expect(result).toContain("```bash");
  });
});

// ── Malformed input resilience ────────────────────────────────────────

describe("Tool output resilience", () => {
  it("does not break when title is nullish", () => {
    const result = formatToolOutputForRichMessage(
      "bash",
      undefined,
      { command: "ls" },
      "ok",
    );
    expect(result).toContain("<details>");
    expect(result).toContain("</details>");
  });

  it("does not break when input is undefined", () => {
    const result = formatToolOutputForRichMessage(
      "bash",
      undefined,
      undefined,
      "ok",
    );
    expect(result).toContain("<details>");
  });

  it("entity-escapes ampersands in reasoning body then displays correctly", () => {
    // markdownToHtml escapes & → &amp; so they don't get parsed as HTML entities;
    // Telegram renders &amp; back to & visually. The visual result is identical
    // but the raw text in the message payload is safe.
    const result = formatToolOutputForRichMessage(
      "reasoning",
      "Analysis",
      undefined,
      "A && B && C",
    );
    expect(result).toContain("A &amp;&amp; B &amp;&amp; C");
  });
});

// ── truncateForRich ────────────────────────────────────────────────────

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
    expect(r.shownLines).toBe(r.text.split("\n").length);
    expect(r.text.split("\n").every((l) => /^line-\d+$/.test(l))).toBe(true);
  });

  it("respects the byte budget for multibyte content", () => {
    const text = "あ".repeat(5000); // 3 bytes each → 15000 bytes
    const r = truncateForRich(text, 100000, 6000);
    expect(Buffer.byteLength(r.text, "utf-8")).toBeLessThanOrEqual(6000);
    expect(r.truncated).toBe(true);
  });

  it("handles empty input", () => {
    const r = truncateForRich("", 100, 100);
    expect(r).toEqual({ text: "", truncated: false, shownLines: 1, totalLines: 1 });
  });

  it("cuts mid-line when text has no newline", () => {
    const r = truncateForRich("x".repeat(500), 200, 65536);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBe(200); // no newline boundary to fall back to
  });

  it("shrinks to fit a tiny byte budget without hanging", () => {
    const r = truncateForRich("あ".repeat(100), 100000, 1);
    expect(Buffer.byteLength(r.text, "utf-8")).toBeLessThanOrEqual(1);
    expect(r.truncated).toBe(true);
  });
});
