import { describe, expect, it } from "vitest";
import {
  formatReasoningForTelegramHtml,
  formatToolCallAsSpoiler,
  markdownToHtml,
} from "../../../src/bot/utils/reasoning-format.js";

describe("bot/utils/reasoning-format", () => {
  describe("formatReasoningForTelegramHtml", () => {
    it("places answer text BEFORE the expandable spoiler block", () => {
      const [result] = formatReasoningForTelegramHtml(
        2,
        "Crafting in Russian\n\nI want to create something concise in Russian.",
        [],
        "Here is the answer.",
      );

      // Answer comes first, then spoiler with reasoning
      expect(result).toMatch(/^Here is the answer\./);
      expect(result).toContain("<blockquote expandable>");
      // Answer text should NOT be inside the blockquote
      const blockquoteStart = result.indexOf("<blockquote expandable>");
      const blockquoteEnd = result.indexOf("</blockquote>");
      const blockquoteContent = result.slice(blockquoteStart, blockquoteEnd);
      expect(blockquoteContent).not.toContain("Here is the answer");
    });

    it("puts reasoning inside the spoiler block", () => {
      const [result] = formatReasoningForTelegramHtml(
        2,
        "Crafting in Russian\n\nI want to create something concise in Russian.",
        [],
        "Here is the answer.",
      );

      expect(result).toContain("<b>Crafting in Russian</b>");
      expect(result).toContain("<i><b>I want to create something concise in Russian.</b></i>");

      // Reasoning should be inside blockquote
      const blockquoteStart = result.indexOf("<blockquote expandable>");
      const blockquoteEnd = result.indexOf("</blockquote>");
      const blockquoteContent = result.slice(blockquoteStart, blockquoteEnd);
      expect(blockquoteContent).toContain("Crafting in Russian");
    });

    it("puts tool calls inside the spoiler block", () => {
      const technicals = [{ description: "bash", command: "ls -la" }];
      const [result] = formatReasoningForTelegramHtml(2, "Thinking...", technicals, "Answer text");

      const blockquoteStart = result.indexOf("<blockquote expandable>");
      const blockquoteEnd = result.indexOf("</blockquote>");
      const blockquoteContent = result.slice(blockquoteStart, blockquoteEnd);
      expect(blockquoteContent).toContain("bash");
      expect(blockquoteContent).toContain("ls -la");
    });

    it("returns plain answer when no reasoning or tools", () => {
      const [result] = formatReasoningForTelegramHtml(0, "", [], "Just the answer");

      expect(result).toBe("Just the answer");
      expect(result).not.toContain("<blockquote");
    });

    it("returns only spoiler when no answer text but has reasoning", () => {
      const [result] = formatReasoningForTelegramHtml(1, "Some reasoning", [], "");

      expect(result).toContain("<blockquote expandable>");
      expect(result).toContain("Some reasoning");
    });

    it("escapes html-sensitive characters", () => {
      const [result] = formatReasoningForTelegramHtml(2, "Plan <tag> & test", [], "💭 Thinking...");

      expect(result).toContain("<i><b>Plan &lt;tag&gt; &amp; test</b></i>");
    });

    it("unwraps markdown-style titles before rendering html", () => {
      const [result] = formatReasoningForTelegramHtml(
        2,
        "**Updating reasoning format**\n\nI need to update the reasoning format.",
        [],
        "💭 Thinking...",
      );

      expect(result).toContain("<b>Updating reasoning format</b>");
      expect(result).not.toContain("**Updating reasoning format**");
    });

    it("formats repeated headings line by line inside the blockquote", () => {
      const [result] = formatReasoningForTelegramHtml(
        2,
        [
          "**Heading One**",
          "**Heading Two**",
          "Body paragraph line one.",
          "Body paragraph line two.",
          "",
          "# Heading Three",
          "Final paragraph.",
        ].join("\n"),
        [],
        "💭 Thinking...",
      );

      expect(result).toContain("<b>Heading One</b>\n\n<b>Heading Two</b>");
      expect(result).toContain("<i><b>Body paragraph line one.\nBody paragraph line two.</b></i>");
      expect(result).toContain("<b>Heading Three</b>\n\n<i><b>Final paragraph.</b></i>");
      expect(result).not.toContain("**Heading Two**");
    });

    it("always uses expandable blockquote when reasoning is shown", () => {
      const [result] = formatReasoningForTelegramHtml(1, "Short reasoning", [], "Answer");

      expect(result).toContain("<blockquote expandable>");
      expect(result).not.toContain("<blockquote>Short reasoning");
    });

    it("keeps thinking text as visible answer outside the spoiler", () => {
      const [result] = formatReasoningForTelegramHtml(2, "Reasoning body", [], "💭 Thinking...");

      // textPrefix is the visible answer, NOT inside the spoiler
      expect(result.startsWith("💭 Thinking...")).toBe(true);
      expect(result).toContain("<blockquote expandable>");
      expect((result.match(/💭 Thinking\.\.\./g) ?? []).length).toBe(1);
    });

    describe("message splitting for long content", () => {
      it("splits long reasoning text into multiple chunks", () => {
        const longReasoning = "a".repeat(5000);
        const chunks = formatReasoningForTelegramHtml(1, longReasoning, [], "");

        expect(chunks.length).toBeGreaterThan(1);
        expect(chunks[0]).not.toContain("...");
      });

      it("each chunk respects message limit of 4096 chars", () => {
        const longReasoning = "b".repeat(8000);
        const chunks = formatReasoningForTelegramHtml(1, longReasoning, [], "");

        for (const chunk of chunks) {
          expect(chunk.length).toBeLessThanOrEqual(4096);
        }
      });

      it("does not truncate when content exceeds limit", () => {
        const longReasoning = "c".repeat(5000);
        const chunks = formatReasoningForTelegramHtml(1, longReasoning, [], "");

        // Should NOT contain truncation marker
        for (const chunk of chunks) {
          expect(chunk).not.toContain("...");
        }
      });

      it("splits at word boundaries when possible", () => {
        const textWithWords = "word ".repeat(2000);
        const chunks = formatReasoningForTelegramHtml(1, textWithWords, [], "");

        // Should split cleanly at spaces
        expect(chunks.length).toBeGreaterThan(1);
      });
    });
  });

  describe("formatToolCallAsSpoiler", () => {
    it("wraps tool call text in expandable blockquote", () => {
      const result = formatToolCallAsSpoiler('💻 "bash" `ls -la`');

      expect(result).toBe("<blockquote expandable>💻 &quot;bash&quot; `ls -la`</blockquote>");
    });

    it("escapes HTML-sensitive characters", () => {
      const result = formatToolCallAsSpoiler('Tool <script> & "args"');

      expect(result).toBe("<blockquote expandable>Tool &lt;script&gt; &amp; &quot;args&quot;</blockquote>");
    });

    it("returns empty string for empty input", () => {
      const result = formatToolCallAsSpoiler("");

      expect(result).toBe("");
    });

    it("trims whitespace from input", () => {
      const result = formatToolCallAsSpoiler("  some tool  ");

      expect(result).toBe("<blockquote expandable>some tool</blockquote>");
    });
  });

  describe("markdownToHtml", () => {
    it("converts bold and italic to valid HTML with paired tags", () => {
      const result = markdownToHtml("**bold** and *italic*");
      expect(result).toBe("<b>bold</b> and <i>italic</i>");
    });

    it("produces valid HTML for nested bold+italic", () => {
      const result = markdownToHtml("**bold *inside* bold**");
      // After sanitizer: interleaved tags are fixed
      expect(result).toContain("<b>");
      expect(result).toContain("</b>");
      expect(result).toContain("<i>");
      expect(result).toContain("</i>");
      // Verify tag pairing: count opens == count closes for each tag
      const bOpens = (result.match(/<b>/g) ?? []).length;
      const bCloses = (result.match(/<\/b>/g) ?? []).length;
      expect(bOpens).toBe(bCloses);
    });

    it("produces valid HTML for code blocks", () => {
      const result = markdownToHtml("```\ncode here\n```");
      expect(result).toBe("<pre>code here</pre>");
    });

    it("produces valid HTML for inline code", () => {
      const result = markdownToHtml("use `console.log` here");
      expect(result).toBe("use <code>console.log</code> here");
    });

    it("produces valid HTML for strikethrough", () => {
      const result = markdownToHtml("~~deleted~~");
      expect(result).toBe("<s>deleted</s>");
    });

    it("produces valid HTML for links", () => {
      const result = markdownToHtml("[click](https://example.com)");
      expect(result).toBe('<a href="https://example.com">click</a>');
    });

    it("escapes HTML entities in non-code text", () => {
      const result = markdownToHtml("use <script> & tags");
      expect(result).toContain("&lt;script&gt;");
      expect(result).toContain("&amp;");
    });

    it("always produces tag-balanced HTML", () => {
      // Test various tricky inputs that could cause interleaved tags
      const inputs = [
        "**a*b**c*",
        "*a**b*c*",
        "**__nested__**",
        "~~*combo*~~",
        "**bold** text *italic* **more**",
      ];

      for (const input of inputs) {
        const result = markdownToHtml(input);
        // Verify every tag has a matching pair
        const bOpens = (result.match(/<b>/g) ?? []).length;
        const bCloses = (result.match(/<\/b>/g) ?? []).length;
        const iOpens = (result.match(/<i>/g) ?? []).length;
        const iCloses = (result.match(/<\/i>/g) ?? []).length;
        const sOpens = (result.match(/<s>/g) ?? []).length;
        const sCloses = (result.match(/<\/s>/g) ?? []).length;

        expect(bOpens, `b mismatch for "${input}"`).toBe(bCloses);
        expect(iOpens, `i mismatch for "${input}"`).toBe(iCloses);
        expect(sOpens, `s mismatch for "${input}"`).toBe(sCloses);
      }
    });
  });
});
