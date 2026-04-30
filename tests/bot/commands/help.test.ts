import { describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { helpCommand } from "../../../src/bot/commands/help.js";
import { getLocalizedBotCommands } from "../../../src/bot/commands/definitions.js";

const mocked = vi.hoisted(() => ({
  keyboardInitializeMock: vi.fn(),
  keyboardGetKeyboardMock: vi.fn(() => ({ keyboard: true })),
}));

vi.mock("../../../src/keyboard/manager.js", () => ({
  keyboardManager: {
    initialize: mocked.keyboardInitializeMock,
    getKeyboard: mocked.keyboardGetKeyboardMock,
  },
}));

describe("bot/commands/help", () => {
  it("returns full commands list from centralized definitions", async () => {
    const replyMock = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      chat: { id: 100 },
      message: { message_thread_id: 77 },
      api: {},
      reply: replyMock,
    } as unknown as Context;

    await helpCommand(ctx);

    expect(replyMock).toHaveBeenCalledTimes(1);

    const helpText = replyMock.mock.calls[0][0] as string;
    const commands = getLocalizedBotCommands({ isAdmin: false });

    for (const item of commands) {
      expect(helpText).toContain(`/${item.command}`);
      expect(helpText).toContain(item.description);
    }
    expect(helpText).toContain("/mcps");
    expect(helpText).not.toContain("/export_data");
    expect(replyMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        reply_markup: { keyboard: true },
        message_thread_id: 77,
      }),
    );
  });
});
