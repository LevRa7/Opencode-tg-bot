import { describe, expect, it, vi } from "vitest";
import {
  buildThinkingMessageHtml,
  deliverThinkingMessage,
  formatThinkingMessageWithReasoning,
} from "../../../src/bot/utils/thinking-message.js";
import { t } from "../../../src/i18n/index.js";
import { escapeHtml } from "../../../src/bot/utils/reasoning-format.js";

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
      `<b>${escapeHtml(t("bot.thinking"))}</b>`,
      "thinking_started",
      "html",
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
      '<b>think &lt;fast&gt; &amp; &quot;safe&quot;</b>',
      "thinking_started",
      "html",
    );
  });

  it("builds a full thinking html payload with plain title and expandable body quote", () => {
    const html = buildThinkingMessageHtml("Thinking...", "**Plan**\n\nNeed to verify formatting.");

    expect(html).toBe(
      "<b>Thinking...</b>\n\n<blockquote expandable><b>Plan</b>\n\n<i><b>Need to verify formatting.</b></i></blockquote>",
    );
  });

  it("formats thinking message with reasoning content as expandable quote", () => {
    const result = formatThinkingMessageWithReasoning("Думаю...", "First step\n\nSecond step");

    expect(result.format).toBe("html");
    expect(result.text).toContain("<b>Думаю...</b>");
    expect(result.text).toContain("<blockquote expandable>");
    expect(result.text).toContain("First step");
    expect(result.text).toContain("Second step");
  });

  it("formats thinking message without reasoning when reasoning is empty", () => {
    const result = formatThinkingMessageWithReasoning("Думаю...", "");

    expect(result.format).toBe("html");
    expect(result.text).toBe("<b>Думаю...</b>");
  });

  it("escapes html in reasoning content", () => {
    const result = formatThinkingMessageWithReasoning("Думаю...", '<script>alert("xss")</script>');

    expect(result.text).not.toContain("<script>");
    expect(result.text).toContain("&lt;script&gt;");
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
