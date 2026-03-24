import { describe, expect, it } from "vitest";
import { formatReasoningForTelegramHtml } from "../../../src/bot/utils/reasoning-format.js";

describe("bot/utils/reasoning-format", () => {
  it("formats a titled reasoning block as an expandable html quote", () => {
    const [result] = formatReasoningForTelegramHtml(
      "Crafting in Russian\n\nI want to create something concise in Russian.",
      "💭 Thinking...",
    );

    expect(result).toBe(
      "💭 Thinking...\n\n<blockquote expandable><b>Crafting in Russian</b>\n\n<i>I want to create something concise in Russian.</i></blockquote>",
    );
  });

  it("escapes html-sensitive characters", () => {
    const [result] = formatReasoningForTelegramHtml("Plan <tag> & test", "💭 Thinking...");

    expect(result).toContain("<i>Plan &lt;tag&gt; &amp; test</i>");
  });

  it("unwraps markdown-style titles before rendering html", () => {
    const [result] = formatReasoningForTelegramHtml(
      "**Updating reasoning format**\n\nI need to update the reasoning format.",
      "💭 Thinking...",
    );

    expect(result).toContain("<b>Updating reasoning format</b>");
    expect(result).not.toContain("**Updating reasoning format**");
  });

  it("formats repeated headings line by line inside the blockquote", () => {
    const [result] = formatReasoningForTelegramHtml(
      [
        "**Heading One**",
        "**Heading Two**",
        "Body paragraph line one.",
        "Body paragraph line two.",
        "",
        "# Heading Three",
        "Final paragraph.",
      ].join("\n"),
      "💭 Thinking...",
    );

    expect(result).toContain("<b>Heading One</b>\n\n<b>Heading Two</b>");
    expect(result).toContain("<i>Body paragraph line one.\nBody paragraph line two.</i>");
    expect(result).toContain("<b>Heading Three</b>\n\n<i>Final paragraph.</i>");
    expect(result).not.toContain("**Heading Two**");
  });
});
