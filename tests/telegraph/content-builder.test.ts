import { describe, expect, it } from "vitest";
import { buildTelegraphContent } from "../../src/telegraph/content-builder.js";

describe("buildTelegraphContent", () => {
  it("wraps plain text lines separated by blank line into paragraphs", () => {
    const result = buildTelegraphContent("hello\n\nworld");
    expect(result).toEqual([
      { tag: "p", children: ["hello"] },
      { tag: "p", children: ["world"] },
    ]);
  });

  it("converts code fences to pre tags", () => {
    const result = buildTelegraphContent("```\nconst x = 1;\nconsole.log(x);\n```");
    expect(result).toEqual([
      { tag: "pre", children: ["const x = 1;\nconsole.log(x);"] },
    ]);
  });

  it("handles code fences with language identifier", () => {
    const result = buildTelegraphContent("```typescript\nconst x = 1;\n```");
    expect(result).toEqual([
      { tag: "pre", children: ["const x = 1;"] },
    ]);
  });

  it("converts headers to h3 and h4 tags", () => {
    const result = buildTelegraphContent("# Title\n\n## Subtitle\n\n### Section\n\n#### Sub");
    expect(result).toEqual([
      { tag: "h3", children: ["Title"] },
      { tag: "h3", children: ["Subtitle"] },
      { tag: "h3", children: ["Section"] },
      { tag: "h4", children: ["Sub"] },
    ]);
  });

  it("converts blockquotes to blockquote tags", () => {
    const result = buildTelegraphContent("> This is quoted\n> Second line");
    expect(result).toEqual([
      { tag: "blockquote", children: ["This is quoted", { tag: "br" }, "Second line"] },
    ]);
  });

  it("converts unordered lists to ul/li tags", () => {
    const result = buildTelegraphContent("- item one\n- item two\n- item three");
    expect(result).toEqual([
      {
        tag: "ul",
        children: [
          { tag: "li", children: ["item one"] },
          { tag: "li", children: ["item two"] },
          { tag: "li", children: ["item three"] },
        ],
      },
    ]);
  });

  it("converts ordered lists to ol/li tags", () => {
    const result = buildTelegraphContent("1. first\n2. second\n3. third");
    expect(result).toEqual([
      {
        tag: "ol",
        children: [
          { tag: "li", children: ["first"] },
          { tag: "li", children: ["second"] },
          { tag: "li", children: ["third"] },
        ],
      },
    ]);
  });

  it("converts horizontal rules to hr tags", () => {
    const result = buildTelegraphContent("text above\n\n---\n\ntext below");
    expect(result).toEqual([
      { tag: "p", children: ["text above"] },
      { tag: "hr" },
      { tag: "p", children: ["text below"] },
    ]);
  });

  it("handles inline bold formatting", () => {
    const result = buildTelegraphContent("This is **bold** text");
    expect(result).toEqual([
      { tag: "p", children: ["This is ", { tag: "b", children: ["bold"] }, " text"] },
    ]);
  });

  it("handles inline italic formatting", () => {
    const result = buildTelegraphContent("This is *italic* text");
    expect(result).toEqual([
      { tag: "p", children: ["This is ", { tag: "em", children: ["italic"] }, " text"] },
    ]);
  });

  it("handles inline code formatting", () => {
    const result = buildTelegraphContent("Run `npm test` now");
    expect(result).toEqual([
      { tag: "p", children: ["Run ", { tag: "code", children: ["npm test"] }, " now"] },
    ]);
  });

  it("handles strikethrough formatting", () => {
    const result = buildTelegraphContent("This is ~~deleted~~ text");
    expect(result).toEqual([
      { tag: "p", children: ["This is ", { tag: "s", children: ["deleted"] }, " text"] },
    ]);
  });

  it("handles consecutive lines without blank separator as single paragraph with br", () => {
    const result = buildTelegraphContent("line one\nline two\nline three");
    expect(result).toEqual([
      { tag: "p", children: ["line one", { tag: "br" }, "line two", { tag: "br" }, "line three"] },
    ]);
  });

  it("skips empty code blocks", () => {
    const result = buildTelegraphContent("```\n   \n```\n\ntext");
    expect(result).toEqual([
      { tag: "p", children: ["text"] },
    ]);
  });

  it("returns fallback for empty input", () => {
    const result = buildTelegraphContent("");
    expect(result).toEqual([{ tag: "p", children: ["(empty)"] }]);
  });

  it("handles mixed content: text, code, list", () => {
    const input = "# Summary\n\nRan tests:\n\n```\n10 passed, 0 failed\n```\n\n- Task A\n- Task B";
    const result = buildTelegraphContent(input);
    expect(result).toEqual([
      { tag: "h3", children: ["Summary"] },
      { tag: "p", children: ["Ran tests:"] },
      { tag: "pre", children: ["10 passed, 0 failed"] },
      { tag: "ul", children: [
        { tag: "li", children: ["Task A"] },
        { tag: "li", children: ["Task B"] },
      ]},
    ]);
  });

  it("handles bash command format with $ prefix and code fence", () => {
    const input = "$ git status\n```\nOn branch main\nnothing to commit\n```";
    const result = buildTelegraphContent(input);
    expect(result).toEqual([
      { tag: "p", children: ["$ git status"] },
      { tag: "pre", children: ["On branch main\nnothing to commit"] },
    ]);
  });
});
