import { describe, expect, it, vi } from "vitest";
import {
  buildThinkingMessageHtml,
  deliverThinkingMessage,
} from "../../../src/bot/utils/thinking-message.js";
import { t } from "../../../src/i18n/index.js";
import { escapeHtml } from "../../../src/bot/utils/reasoning-format.js";

describe("bot/utils/thinking-message", () => {
  it("sends thinking immediately as a separate bold quote title when visible", () => {
    const batcher = {
      enqueue: vi.fn(),
      sendTextNow: vi.fn(),
    };

    deliverThinkingMessage("s1", batcher, {
      hideThinkingMessages: false,
    });

    expect(batcher.sendTextNow).toHaveBeenCalledWith(
      "s1",
      `<blockquote><b>${escapeHtml(t("bot.thinking"))}</b></blockquote>`,
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

  it("escapes html-sensitive thinking text before wrapping it in quote", () => {
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
      '<blockquote><b>think &lt;fast&gt; &amp; &quot;safe&quot;</b></blockquote>',
      "thinking_started",
      "html",
    );
  });

  it("builds a full thinking html payload with separate title and expandable body quotes", () => {
    const html = buildThinkingMessageHtml("Thinking...", "**Plan**\n\nNeed to verify formatting.");

    expect(html).toBe(
      "<blockquote><b>Thinking...</b></blockquote>\n\n<blockquote expandable><b>Plan</b>\n\n<i><b>Need to verify formatting.</b></i></blockquote>",
    );
  });
});
