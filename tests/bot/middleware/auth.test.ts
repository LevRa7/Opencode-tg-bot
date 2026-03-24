import { describe, expect, it, vi } from "vitest";
import type { Context, NextFunction } from "grammy";

vi.mock("../../../src/config.js", () => ({
  config: {
    telegram: {
      adminUserId: 1,
      allowedUserIds: [1, 2],
    },
    server: {
      logLevel: "error",
    },
  },
}));

import { authMiddleware } from "../../../src/bot/middleware/auth.js";

function createContext(options: {
  userId?: number;
  chatId?: number;
  chatType?: "private" | "supergroup";
}): Context {
  return {
    from: options.userId ? ({ id: options.userId } as Context["from"]) : undefined,
    chat:
      options.chatId !== undefined
        ? ({ id: options.chatId, type: options.chatType ?? "private" } as Context["chat"])
        : undefined,
    api: {
      setMyCommands: vi.fn().mockResolvedValue(undefined),
      setChatMenuButton: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as Context;
}

describe("authMiddleware", () => {
  it("allows configured users", async () => {
    const ctx = createContext({ userId: 2, chatId: 2 });
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await authMiddleware(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.api.setMyCommands).not.toHaveBeenCalled();
    expect(ctx.api.setChatMenuButton).not.toHaveBeenCalled();
  });

  it("hides commands for unauthorized private chats", async () => {
    const ctx = createContext({ userId: 99, chatId: 99, chatType: "private" });
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await authMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.api.setMyCommands).toHaveBeenCalledWith([], {
      scope: { type: "chat", chat_id: 99 },
    });
    expect(ctx.api.setChatMenuButton).toHaveBeenCalledWith({
      chat_id: 99,
      menu_button: { type: "default" },
    });
  });

  it("does not change commands in unauthorized group chats", async () => {
    const ctx = createContext({ userId: 99, chatId: -1001, chatType: "supergroup" });
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await authMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.api.setMyCommands).not.toHaveBeenCalled();
    expect(ctx.api.setChatMenuButton).not.toHaveBeenCalled();
  });
});
