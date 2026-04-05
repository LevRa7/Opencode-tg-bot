import { describe, expect, it } from "vitest";
import { formatReasoningForTelegramHtml } from "../../../src/bot/utils/reasoning-format.js";

describe("bot/utils/reasoning-format", () => {
  it("formats reasoning block with answer BEFORE reasoning (mode 3)", () => {
    const [result] = formatReasoningForTelegramHtml(
      3,
      "Crafting in Russian\n\nI want to create something concise in Russian.",
      [],
      "💭 Thinking...",
    );

    // Answer (textPrefix) comes before blockquote for better readability
    expect(result).toBe(
      "💭 Thinking...\n\n<blockquote expandable><b>Crafting in Russian</b>\n\n<i><b>I want to create something concise in Russian.</b></i></blockquote>",
    );
  });

  it("escapes html-sensitive characters", () => {
    const [result] = formatReasoningForTelegramHtml(3, "Plan <tag> & test", [], "💭 Thinking...");

    expect(result).toContain("<i><b>Plan &lt;tag&gt; &amp; test</b></i>");
  });

  it("unwraps markdown-style titles before rendering html", () => {
    const [result] = formatReasoningForTelegramHtml(
      3,
      "**Updating reasoning format**\n\nI need to update the reasoning format.",
      [],
      "💭 Thinking...",
    );

    expect(result).toContain("<b>Updating reasoning format</b>");
    expect(result).not.toContain("**Updating reasoning format**");
  });

  it("formats repeated headings line by line inside the blockquote", () => {
    const [result] = formatReasoningForTelegramHtml(
      3,
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
