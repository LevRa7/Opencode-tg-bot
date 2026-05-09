import { describe, expect, it, vi } from "vitest";
import {
  buildThinkingMessageHtml,
  deliverThinkingMessage,
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
});
