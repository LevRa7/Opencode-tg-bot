import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../src/i18n/index.js";
import type { Context, NextFunction } from "grammy";

const settingsState = {
  approvedTelegramUserIds: [] as number[],
  pendingAccessRequests: [] as Array<Record<string, unknown>>,
};

vi.mock("../../../src/config.js", () => ({
  config: {
    telegram: {
      adminUserId: 1,
      allowedUserIds: [1, 2],
    },
    opencode: {
      apiUrl: "http://localhost:4096",
      username: "opencode",
      password: "",
    },
    server: {
      logLevel: "error",
    },
  },
}));

vi.mock("../../../src/settings/manager.js", () => ({
  getApprovedTelegramUserIds: vi.fn(() => [...settingsState.approvedTelegramUserIds]),
  getPendingAccessRequests: vi.fn(() => settingsState.pendingAccessRequests.map((request) => ({ ...request }))),
  setApprovedTelegramUserIds: vi.fn(async (userIds: number[]) => {
    settingsState.approvedTelegramUserIds = [...userIds];
  }),
  setPendingAccessRequests: vi.fn(async (requests: Array<Record<string, unknown>>) => {
    settingsState.pendingAccessRequests = requests.map((request) => ({ ...request }));
  }),
}));

import { authMiddleware, handleAccessApprovalCallback } from "../../../src/bot/middleware/auth.js";
import {
  getPendingAccessRequests,
  setApprovedTelegramUserIds,
  setPendingAccessRequests,
} from "../../../src/settings/manager.js";

function createContext(options: {
  userId?: number;
  chatId?: number;
  chatType?: "private" | "supergroup";
  username?: string;
  firstName?: string;
  lastName?: string;
  languageCode?: string;
  callbackData?: string;
  callbackMessageId?: number;
}): Context {
  return {
    from: options.userId
      ? ({
          id: options.userId,
          username: options.username,
          first_name: options.firstName,
          last_name: options.lastName,
          language_code: options.languageCode,
        } as Context["from"])
      : undefined,
    chat:
      options.chatId !== undefined
        ? ({ id: options.chatId, type: options.chatType ?? "private" } as Context["chat"])
        : undefined,
    callbackQuery: options.callbackData
      ? ({
          data: options.callbackData,
          message: options.callbackMessageId
            ? ({ message_id: options.callbackMessageId } as NonNullable<Context["callbackQuery"]>["message"])
            : undefined,
        } as Context["callbackQuery"])
      : undefined,
    api: {
      setMyCommands: vi.fn().mockResolvedValue(undefined),
      setChatMenuButton: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue({ message_id: 777 }),
      editMessageText: vi.fn().mockResolvedValue(undefined),
    },
    reply: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

describe("authMiddleware", () => {
  beforeEach(() => {
    settingsState.approvedTelegramUserIds = [];
    settingsState.pendingAccessRequests = [];
    vi.clearAllMocks();
  });

  it("allows configured users", async () => {
    const ctx = createContext({ userId: 2, chatId: 2 });
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await authMiddleware(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.api.setMyCommands).not.toHaveBeenCalled();
    expect(ctx.api.setChatMenuButton).not.toHaveBeenCalled();
  });

  it("creates admin approval request for unauthorized private chats", async () => {
    const ctx = createContext({
      userId: 99,
      chatId: 99,
      chatType: "private",
      username: "guest99",
      firstName: "Guest",
      lastName: "User",
      languageCode: "ru",
    });
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
    expect(ctx.api.sendMessage).toHaveBeenCalledWith(
      1,
      expect.stringContaining(t("auth.request.user_id", { userId: 99 })),
      expect.objectContaining({ reply_markup: expect.anything() }),
    );
    expect(getPendingAccessRequests).toHaveBeenCalled();
    expect(setPendingAccessRequests).toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(t("auth.requester.sent"));
  });

  it("does not change commands in unauthorized group chats", async () => {
    const ctx = createContext({ userId: 99, chatId: -1001, chatType: "supergroup" });
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await authMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.api.setMyCommands).not.toHaveBeenCalled();
    expect(ctx.api.setChatMenuButton).not.toHaveBeenCalled();
  });

  it("suppresses duplicate approval spam during cooldown", async () => {
    settingsState.pendingAccessRequests = [
      {
        userId: 99,
        chatId: 99,
        chatType: "private",
        username: "guest99",
        firstName: "Guest",
        lastName: "User",
        languageCode: "ru",
        requestedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        lastNotifiedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        adminChatId: 1,
        adminMessageId: 777,
      },
    ];

    const ctx = createContext({
      userId: 99,
      chatId: 99,
      chatType: "private",
      username: "guest99",
      firstName: "Guest",
      lastName: "User",
      languageCode: "ru",
    });
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await authMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.api.sendMessage).not.toHaveBeenCalledWith(
      1,
      expect.stringContaining(t("auth.request.user_id", { userId: 99 })),
      expect.anything(),
    );
    expect(setPendingAccessRequests).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });
});

describe("handleAccessApprovalCallback", () => {
  beforeEach(() => {
    settingsState.approvedTelegramUserIds = [];
    settingsState.pendingAccessRequests = [];
    vi.clearAllMocks();
  });

  it("approves pending access requests", async () => {
    settingsState.pendingAccessRequests = [
      {
        userId: 99,
        chatId: 99,
        chatType: "private",
        username: "guest99",
        firstName: "Guest",
        lastName: "User",
        languageCode: "ru",
        requestedAt: "2026-04-03T10:00:00.000Z",
        lastNotifiedAt: "2026-04-03T10:00:00.000Z",
        adminChatId: 1,
        adminMessageId: 777,
      },
    ];

    const ctx = createContext({
      userId: 1,
      chatId: 1,
      callbackData: "access:approve:99",
      callbackMessageId: 777,
    });

    const handled = await handleAccessApprovalCallback(ctx);

    expect(handled).toBe(true);
    expect(setApprovedTelegramUserIds).toHaveBeenCalledWith([1, 2, 99]);
    expect(setPendingAccessRequests).toHaveBeenCalledWith([]);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("auth.decision.approved") });
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining(t("auth.decision.approved")),
      { reply_markup: undefined },
    );
    expect(ctx.api.sendMessage).toHaveBeenCalledWith(99, t("auth.requester.approved"));
  });

  it("rejects non-admin approval callbacks", async () => {
    const ctx = createContext({
      userId: 99,
      chatId: 99,
      callbackData: "access:approve:42",
      callbackMessageId: 777,
    });

    const handled = await handleAccessApprovalCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("auth.error.admin_only"),
      show_alert: true,
    });
    expect(setApprovedTelegramUserIds).not.toHaveBeenCalled();
  });
});
