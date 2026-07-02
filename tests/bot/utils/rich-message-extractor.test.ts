import { describe, expect, it } from "vitest";
import { extractRichMessageText } from "../../../src/bot/utils/rich-message-extractor.js";

describe("extractRichMessageText", () => {
  it("returns empty string for undefined", () => {
    expect(extractRichMessageText(undefined)).toBe("");
  });

  it("returns empty string for empty blocks", () => {
    expect(extractRichMessageText({ blocks: [] })).toBe("");
  });

  it("extracts paragraph text", () => {
    const rm = {
      blocks: [{ type: "paragraph", text: ["Hello world"] }],
    };
    expect(extractRichMessageText(rm)).toBe("Hello world");
  });

  it("extracts paragraph with formatted text", () => {
    const rm = {
      blocks: [
        {
          type: "paragraph",
          text: [
            "Regular ",
            { type: "bold", text: "bold" },
            " and ",
            { type: "italic", text: "italic" },
          ],
        },
      ],
    };
    expect(extractRichMessageText(rm)).toBe("Regular bold and italic");
  });

  it("extracts preformatted text", () => {
    const rm = {
      blocks: [{ type: "pre", text: "code block\nline 2" }],
    };
    const result = extractRichMessageText(rm);
    expect(result).toContain("```");
    expect(result).toContain("code block");
    expect(result).toContain("line 2");
  });

  it("extracts headings", () => {
    const rm = {
      blocks: [
        { type: "heading", text: "Title", size: 2 },
        { type: "heading", text: "Subtitle", size: 3 },
      ],
    };
    const result = extractRichMessageText(rm);
    expect(result).toContain("## Title");
    expect(result).toContain("### Subtitle");
  });

  it("extracts unordered list", () => {
    const rm = {
      blocks: [
        {
          type: "unordered_list",
          items: ["Item 1", "Item 2", "Item 3"],
        },
      ],
    };
    const result = extractRichMessageText(rm);
    expect(result).toBe("- Item 1\n- Item 2\n- Item 3");
  });

  it("extracts ordered list", () => {
    const rm = {
      blocks: [
        {
          type: "ordered_list",
          items: ["First", "Second"],
        },
      ],
    };
    const result = extractRichMessageText(rm);
    expect(result).toBe("1. First\n2. Second");
  });

  it("extracts blockquote", () => {
    const rm = {
      blocks: [
        {
          type: "blockquote",
          text: ["Quoted text"],
        },
      ],
    };
    expect(extractRichMessageText(rm)).toBe("> Quoted text");
  });

  it("extracts table with header and mixed text types", () => {
    const rm = {
      blocks: [
        {
          type: "table",
          cells: [
            [
              { text: "Name", is_header: true },
              { text: "Value", is_header: true },
            ],
            [{ text: "Foo" }, { text: "123" }],
            [{ text: "Bar" }, { text: "456" }],
          ],
        },
      ],
    };
    const result = extractRichMessageText(rm);
    expect(result).toContain("| Name | Value |");
    expect(result).toContain("| Foo | 123 |");
    expect(result).toContain("| Bar | 456 |");
  });

  it("handles table cells with array text", () => {
    const rm = {
      blocks: [
        {
          type: "table",
          cells: [
            [
              { text: ["Status"], is_header: true },
            ],
            [
              { text: [{ type: "bold", text: "OK" }] },
            ],
          ],
        },
      ],
    };
    const result = extractRichMessageText(rm);
    expect(result).toContain("| Status |");
    expect(result).toContain("| OK |");
  });

  it("joins multiple blocks with double newline", () => {
    const rm = {
      blocks: [
        { type: "paragraph", text: ["First paragraph"] },
        { type: "paragraph", text: ["Second paragraph"] },
      ],
    };
    expect(extractRichMessageText(rm)).toBe("First paragraph\n\nSecond paragraph");
  });

  it("extracts mixed block types", () => {
    const rm = {
      blocks: [
        { type: "heading", text: "Summary", size: 2 },
        { type: "paragraph", text: ["This is a test"] },
        {
          type: "unordered_list",
          items: ["Point A", "Point B"],
        },
      ],
    };
    const result = extractRichMessageText(rm);
    expect(result).toContain("## Summary");
    expect(result).toContain("This is a test");
    expect(result).toContain("- Point A");
    expect(result).toContain("- Point B");
  });

  it("extracts real-world forwarded rich message", () => {
    // Based on actual Telegram rich_message structure
    const rm = {
      blocks: [
        {
          type: "paragraph",
          text: ["💭 ", { type: "bold", text: "Reasoning:" }],
        },
        {
          type: "pre",
          text: "The bot is running correctly.",
        },
        {
          type: "heading",
          text: "✅ Готово",
          size: 2,
        },
        {
          type: "paragraph",
          text: ["Вот что сделано:"],
        },
        {
          type: "table",
          cells: [
            [
              { text: "Аспект", is_header: true },
              { text: "Статус", is_header: true },
            ],
            [{ text: "Тесты" }, { text: "✅ 41 pass" }],
            [{ text: "Бот" }, { text: "🟢 active" }],
          ],
        },
      ],
    };
    const result = extractRichMessageText(rm);
    // Should contain the structured content as Markdown
    expect(result).toContain("💭 Reasoning:");
    expect(result).toContain("```");
    expect(result).toContain("The bot is running correctly.");
    expect(result).toContain("## ✅ Готово");
    expect(result).toContain("Вот что сделано:");
    expect(result).toContain("| Аспект | Статус |");
    expect(result).toContain("| Тесты | ✅ 41 pass |");
  });

  it("extracts details (collapsible) block with nested content", () => {
    const rm = {
      blocks: [
        {
          type: "details",
          summary: "🔧 — Invalid Tool",
          blocks: [
            {
              type: "pre",
              text: "The arguments provided to the tool are invalid: Model tried to call unavailable tool 'memory_search'.",
            },
          ],
        },
      ],
    };
    const result = extractRichMessageText(rm);
    expect(result).toContain("🔧 — Invalid Tool");
    expect(result).toContain("The arguments provided to the tool are invalid");
    expect(result).toContain("<details>");
    expect(result).toContain("<summary>");
  });

  it("extracts details block with summary only (no nested blocks)", () => {
    const rm = {
      blocks: [
        {
          type: "details",
          summary: "Error summary",
        },
      ],
    };
    // Should just return the summary text
    expect(extractRichMessageText(rm)).toContain("Error summary");
  });

  it("extracts deeply nested details → details → pre", () => {
    const rm = {
      blocks: [
        {
          type: "details",
          summary: "Outer",
          blocks: [
            {
              type: "details",
              summary: "Inner",
              blocks: [
                { type: "pre", text: "nested code" },
              ],
            },
          ],
        },
      ],
    };
    const result = extractRichMessageText(rm);
    expect(result).toContain("Outer");
    expect(result).toContain("Inner");
    expect(result).toContain("nested code");
  });
});
