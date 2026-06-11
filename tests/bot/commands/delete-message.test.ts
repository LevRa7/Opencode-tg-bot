import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { deleteMessageCommand } from "../../../src/bot/commands/delete-message.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  opencodeClient: { session: { revert: vi.fn() } },
  messageJournalRepo: {
    deleteByTgMessage: vi.fn(),
  },
  messageJournalHelpers: { resolveRepliedMessage: vi.fn() },
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: mocked.opencodeClient,
}));

vi.mock("../../../src/settings/manager.js", () => ({
  getMessageJournalRepo: () => mocked.messageJournalRepo,
}));

vi.mock("../../../src/bot/commands/message-journal-helpers.js", () => ({
  resolveRepliedMessage: mocked.messageJournalHelpers.resolveRepliedMessage,
}));

const JRNL_ROW = {
  oc_message_id: "msg-abc",
  oc_session_id: "s1",
  oc_project: "/root/proj",
  tg_message_id: 50,
  tg_chat_id: 777,
  tg_topic_id: null,
};

function makeCtx(overrides: Partial<Context> = {}): Context {
  return {
    chat: { id: 777 },
    reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    api: { deleteMessage: vi.fn().mockResolvedValue(undefined) },
    ...overrides,
  } as unknown as Context;
}

describe("bot/commands/delete-message", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.opencodeClient.session.revert.mockResolvedValue({ error: null });
    mocked.messageJournalHelpers.resolveRepliedMessage.mockReturnValue(JRNL_ROW);
    mocked.messageJournalRepo.deleteByTgMessage.mockReturnValue(undefined);
  });

  it("requires reply to a journaled message", async () => {
    mocked.messageJournalHelpers.resolveRepliedMessage.mockReturnValue(null);
    const ctx = makeCtx();

    await deleteMessageCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(t("del.no_reply"));
    expect(mocked.opencodeClient.session.revert).not.toHaveBeenCalled();
  });

  it("deletes message from OpenCode and Telegram", async () => {
    const ctx = makeCtx();

    await deleteMessageCommand(ctx);

    expect(mocked.opencodeClient.session.revert).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: "s1",
        messageID: "msg-abc",
        directory: "/root/proj",
      }),
    );

    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(777, 50);
    expect(mocked.messageJournalRepo.deleteByTgMessage).toHaveBeenCalledWith(
      50, 777, null,
    );
    expect(ctx.reply).toHaveBeenCalledWith(t("del.success"), expect.anything());
  });

  it("handles Telegram deletion failure gracefully", async () => {
    const ctx = makeCtx();
    (ctx.api.deleteMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("forbidden"));

    await deleteMessageCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(t("del.success"), expect.anything());
  });

  it("handles revert failure gracefully", async () => {
    mocked.opencodeClient.session.revert.mockRejectedValue(new Error("fail"));
    const ctx = makeCtx();

    await deleteMessageCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(t("del.error"));
  });
});
