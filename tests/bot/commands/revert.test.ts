import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { revertCommand } from "../../../src/bot/commands/revert.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  opencodeClient: { session: { revert: vi.fn() } },
  messageJournalRepo: {
    findByTgTopic: vi.fn(),
    deleteByTgMessage: vi.fn(),
  },
  messageJournalHelpers: { resolveRepliedMessage: vi.fn() },
}));

vi.mock("../../../src/session/manager.js", () => ({
  getCurrentSession: mocked.getCurrentSession,
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
  oc_message_id: "msg-1",
  oc_session_id: "s1",
  oc_project: "/root/proj",
  tg_message_id: 100,
  tg_chat_id: 777,
  tg_topic_id: 42,
};

const SESSION = { id: "s1", title: "Test", directory: "/root/proj" };

function makeCtx(overrides: Partial<Context> = {}): Context {
  return {
    chat: { id: 777 },
    reply: vi.fn().mockResolvedValue({ message_id: 200 }),
    api: { deleteMessage: vi.fn().mockResolvedValue(undefined) },
    ...overrides,
  } as unknown as Context;
}

describe("bot/commands/revert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.getCurrentSession.mockReturnValue(SESSION);
    mocked.opencodeClient.session.revert.mockResolvedValue({ error: null });
    mocked.messageJournalHelpers.resolveRepliedMessage.mockReturnValue(JRNL_ROW);
    mocked.messageJournalRepo.findByTgTopic.mockReturnValue([
      { ...JRNL_ROW, tg_message_id: 100 },
      { ...JRNL_ROW, tg_message_id: 150, oc_message_id: "msg-2" },
      { ...JRNL_ROW, tg_message_id: 200, oc_message_id: "msg-3" },
    ]);
    mocked.messageJournalRepo.deleteByTgMessage.mockReturnValue(undefined);
  });

  it("requires reply to a journaled message", async () => {
    mocked.messageJournalHelpers.resolveRepliedMessage.mockReturnValue(null);
    const ctx = makeCtx();

    await revertCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(t("revert.no_reply"));
    expect(mocked.opencodeClient.session.revert).not.toHaveBeenCalled();
  });

  it("requires an active session", async () => {
    mocked.getCurrentSession.mockReturnValue(null);
    const ctx = makeCtx();

    await revertCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(t("revert.no_session"));
  });

  it("reverts session and deletes messages after the revert point", async () => {
    const ctx = makeCtx();

    await revertCommand(ctx);

    expect(mocked.opencodeClient.session.revert).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: "s1",
        messageID: "msg-1",
        directory: "/root/proj",
      }),
    );

    // Messages with id > 100 should be deleted: 150, 200
    expect(ctx.api.deleteMessage).toHaveBeenCalledTimes(2);
    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(777, 150);
    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(777, 200);

    expect(mocked.messageJournalRepo.deleteByTgMessage).toHaveBeenCalledTimes(2);
    expect(ctx.reply).toHaveBeenCalledWith(t("revert.success"), expect.anything());
  });

  it("handles API error gracefully", async () => {
    mocked.opencodeClient.session.revert.mockRejectedValue(new Error("fail"));
    const ctx = makeCtx();

    await revertCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(t("revert.error"));
  });

  it("handles deleteMessage errors gracefully", async () => {
    const ctx = makeCtx();
    (ctx.api.deleteMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("forbidden"));

    await revertCommand(ctx);

    // Should still succeed overall
    expect(ctx.reply).toHaveBeenCalledWith(t("revert.success"), expect.anything());
  });

  it("does not delete messages at or before the revert point", async () => {
    // Only msg 100 (the revert point), no later messages
    mocked.messageJournalRepo.findByTgTopic.mockReturnValue([JRNL_ROW]);
    const ctx = makeCtx();

    await revertCommand(ctx);

    expect(ctx.api.deleteMessage).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(t("revert.success"), expect.anything());
  });
});
