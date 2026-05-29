import { describe, expect, it, vi } from "vitest";
import {
  buildThinkingMessageHtml,
  deliverThinkingMessage,
  extractReasoningTitle,
  formatThinkingMessageWithReasoning,
  getVisibleReasoningText,
} from "../../../src/bot/utils/thinking-message.js";
import { t } from "../../../src/i18n/index.js";

describe("bot/utils/thinking-message", () => {
  it("sends thinking immediately as a separate bold title when visible", () => {
    const batcher = {
      enqueue: vi.fn(),
      sendTextNow: vi.fn(),
    };

    deliverThinkingMessage("s1", batcher, {
      hideThinkingMessages: false,
    });

    expect(batcher.sendTextNow).toHaveBeenCalledWith(
      "s1",
      `💭 ${t("bot.thinking")}`,
      "thinking_started",
      undefined,
    );
    expect(batcher.enqueue).not.toHaveBeenCalled();
  });

  it("does not send thinking message when hidden", () => {
    const batcher = {
      enqueue: vi.fn(),
      sendTextNow: vi.fn(),
    };

    deliverThinkingMessage("s1", batcher, {
      hideThinkingMessages: true,
    });

    expect(batcher.enqueue).not.toHaveBeenCalled();
    expect(batcher.sendTextNow).not.toHaveBeenCalled();
  });

  it("escapes html-sensitive thinking text before sending it", () => {
    const batcher = {
      enqueue: vi.fn(),
      sendTextNow: vi.fn(),
    };

    deliverThinkingMessage("s1", batcher, {
      hideThinkingMessages: false,
      message: 'think <fast> & "safe"',
    });

    expect(batcher.sendTextNow).toHaveBeenCalledWith(
      "s1",
      '💭 think <fast> & "safe"',
      "thinking_started",
      undefined,
    );
  });

  it("builds a compact technical progress payload without reasoning body", () => {
    const html = buildThinkingMessageHtml("Thinking...", "**Plan**\n\nNeed to verify formatting.");

    expect(html).toBe("💭 Thinking...");
    expect(html).not.toContain("**Plan**");
    expect(html).not.toContain("Need to verify formatting.");
    expect(html).not.toContain("<blockquote");
  });

  it("formats thinking message with title only", () => {
    const result = formatThinkingMessageWithReasoning("Думаю...", "First step\n\nSecond step");

    expect(result.format).toBeUndefined();
    expect(result.text).toBe("💭 Думаю...");
    expect(result.text).not.toContain("First step");
    expect(result.text).not.toContain("Second step");
    expect(result.text).not.toContain("<blockquote");
  });

  it("formats thinking message without reasoning as one-line technical progress", () => {
    const result = formatThinkingMessageWithReasoning("Думаю...", "");

    expect(result.format).toBeUndefined();
    expect(result.text).toBe("💭 Думаю...");
  });

  it("drops synthetic thinking placeholders instead of publishing them as reasoning", () => {
    expect(getVisibleReasoningText("💭 Думаю...\n\n💭 Думаю...")).toBeUndefined();
    expect(getVisibleReasoningText("💭 Thinking...\nThinking...")).toBeUndefined();
  });

  it("keeps explicit reasoning while removing synthetic placeholder lines", () => {
    expect(getVisibleReasoningText("💭 Думаю...\n\nNeed to inspect the file.")).toBe(
      "Need to inspect the file.",
    );
  });

  it("keeps reasoning content out of the visible message", () => {
    const result = formatThinkingMessageWithReasoning("Думаю...", '<script>alert("xss")</script>');

    expect(result.text).toBe("💭 Думаю...");
    expect(result.text).not.toContain("alert");
    expect(result.text).not.toContain("<blockquote");
  });

  it("keeps thinking delivery on the service-message path instead of the assistant response path", () => {
    const batcher = {
      enqueue: vi.fn(),
      sendTextNow: vi.fn(),
    };

    deliverThinkingMessage("session-1", batcher, {
      hideThinkingMessages: false,
    });

    expect(batcher.sendTextNow).toHaveBeenCalledTimes(1);
    expect(batcher.enqueue).not.toHaveBeenCalled();
  });

  describe("extractReasoningTitle", () => {
    it("extracts first sentence as title", () => {
      expect(extractReasoningTitle("We need to check the file. Then continue.")).toBe(
        "We need to check the file.",
      );
    });

    it("falls back to first line when no sentence-ending punctuation", () => {
      expect(extractReasoningTitle("Analyzing the database schema")).toBe(
        "Analyzing the database schema",
      );
    });

    it("strips ordered list marker like '1. ' before extracting title", () => {
      expect(extractReasoningTitle("1. Review the authentication module")).toBe(
        "Review the authentication module",
      );
    });

    it("strips ordered list marker and extracts first sentence", () => {
      expect(extractReasoningTitle("2. Check the error handling. Then we can move on.")).toBe(
        "Check the error handling.",
      );
    });

    it("strips list marker with parenthesis", () => {
      expect(extractReasoningTitle("3) Update the configuration file")).toBe(
        "Update the configuration file",
      );
    });

    it("preserves title starting with digits but not a list marker", () => {
      expect(extractReasoningTitle("2 approaches to solving this problem")).toBe(
        "2 approaches to solving this problem",
      );
    });

    it("returns a non-empty default title for empty text", () => {
      const title = extractReasoningTitle("");
      expect(title).toBe(t("bot.thinking"));
    });

    it("strips trailing colon when first line introduces a numbered list", () => {
      expect(
        extractReasoningTitle("I need to:\n1. Step one\n2. Step two"),
      ).toBe("I need to");
    });

    it("strips trailing semicolon", () => {
      expect(
        extractReasoningTitle("Review the following;\n1. Item one"),
      ).toBe("Review the following");
    });

    it("does not bleed into numbered list when extracting title", () => {
      expect(
        extractReasoningTitle("We need to fix this.\n1. First issue\n2. Second issue"),
      ).toBe("We need to fix this.");
    });

    it("handles Russian enumeration", () => {
      expect(
        extractReasoningTitle("Нужно сделать:\n1. Первый шаг\n2. Второй шаг"),
      ).toBe("Нужно сделать");
    });
  });
});
