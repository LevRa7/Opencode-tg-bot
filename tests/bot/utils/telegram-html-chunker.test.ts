import { describe, expect, it } from "vitest";

async function loadChunker() {
  return import("../../../src/bot/utils/telegram-html-chunker.js");
}

describe("bot/utils/telegram-html-chunker", () => {
  it("keeps nested inline html balanced across chunk boundaries", async () => {
    const { chunkTelegramHtml } = await loadChunker();

    expect(chunkTelegramHtml("<b><i>abcdef</i></b>", 17)).toEqual([
      "<b><i>abc</i></b>",
      "<b><i>def</i></b>",
    ]);
  });

  it("preserves plain and expandable blockquote wrappers across chunk boundaries", async () => {
    const { chunkTelegramHtml } = await loadChunker();

    expect(chunkTelegramHtml("<blockquote><i>abcdef</i></blockquote>", 35)).toEqual([
      "<blockquote><i>abc</i></blockquote>",
      "<blockquote><i>def</i></blockquote>",
    ]);
    expect(chunkTelegramHtml("<blockquote expandable><i>abcdef</i></blockquote>", 46)).toEqual([
      "<blockquote expandable><i>abc</i></blockquote>",
      "<blockquote expandable><i>def</i></blockquote>",
    ]);
  });

  it("returns a balanced first chunk for active draft rendering", async () => {
    const { getFirstTelegramHtmlChunk } = await loadChunker();
    const html = "<b>Thinking</b>\n\n<blockquote expandable><i>abcdef</i></blockquote>";

    expect(getFirstTelegramHtmlChunk(html, 63)).toBe(
      "<b>Thinking</b>\n\n<blockquote expandable><i>abc</i></blockquote>",
    );
  });

  it("rejects chunk sizes that would split a leading html entity", async () => {
    const { chunkTelegramHtml } = await loadChunker();

    expect(() => chunkTelegramHtml("<b>&amp;x</b>", 11)).toThrow(/entity/i);
    expect(() => chunkTelegramHtml("<b>&#128640;x</b>", 15)).toThrow(/entity/i);
  });

  it("rejects chunk sizes smaller than html wrapper overhead", async () => {
    const { chunkTelegramHtml } = await loadChunker();

    expect(() => chunkTelegramHtml("<blockquote expandable></blockquote>", 20)).toThrow(/maxLength/i);
  });
});
