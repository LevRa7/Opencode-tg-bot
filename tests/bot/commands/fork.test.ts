import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { forkCommand } from "../../../src/bot/commands/fork.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  opencodeClient: {
    session: { fork: vi.fn() },
  },
  attachSessionForScope: vi.fn(),
  threadContextManager: {
    getActiveScope: vi.fn(),
  },
  createForumTopic: vi.fn(),
  messageJournalHelpers: { resolveRepliedMessage: vi.fn() },
}));

vi.mock("../../../src/session/manager.js", () => ({
  getCurrentSession: mocked.getCurrentSession,
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: mocked.opencodeClient,
}));

vi.mock("../../../src/attach/service.js", () => ({
  attachSessionForScope: mocked.attachSessionForScope,
}));

vi.mock("../../../src/thread/manager.js", () => ({
  threadContextManager: mocked.threadContextManager,
}));

vi.mock("../../../src/bot/commands/message-journal-helpers.js", () => ({
  resolveRepliedMessage: mocked.messageJournalHelpers.resolveRepliedMessage,
}));

const SESSION = { id: "s1", title: "Test", directory: "/root/proj" };
const FORKED = { id: "s2", title: "Test (fork)" };

function makeCtx(overrides: Partial<Context> = {}): Context {
  return {
    chat: { id: 777 },
    reply: vi.fn().mockResolvedValue(undefined),
    api: { createForumTopic: mocked.createForumTopic },
    ...overrides,
  } as unknown as Context;
}

describe("bot/commands/fork", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.getCurrentSession.mockReturnValue(SESSION);
    mocked.opencodeClient.session.fork.mockResolvedValue({ data: FORKED, error: null });
    mocked.threadContextManager.getActiveScope.mockReturnValue({
      userId: 1,
      chatId: 777,
    });
    mocked.createForumTopic.mockResolvedValue({ message_thread_id: 42 } as never);
    mocked.attachSessionForScope.mockResolvedValue(undefined);
    mocked.messageJournalHelpers.resolveRepliedMessage.mockReturnValue(null);
  });

  it("replies with error when no active session", async () => {
    mocked.getCurrentSession.mockReturnValue(null);
    const ctx = makeCtx();

    await forkCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(t("fork.no_session"));
    expect(mocked.opencodeClient.session.fork).not.toHaveBeenCalled();
  });

  it("forks the current session and creates a new forum topic", async () => {
    const ctx = makeCtx();

    await forkCommand(ctx);

    expect(mocked.opencodeClient.session.fork).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: "s1",
        directory: "/root/proj",
        messageID: undefined,
      }),
    );
    expect(mocked.createForumTopic).toHaveBeenCalledWith(777, "[Fork] Test (fork)");
    expect(mocked.attachSessionForScope).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: expect.objectContaining({
          chatId: 777,
          messageThreadId: 42,
        }),
        session: expect.objectContaining({
          id: "s2",
          title: "Test (fork)",
          directory: "/root/proj",
        }),
        reason: "fork",
      }),
    );
    expect(ctx.reply).toHaveBeenCalledWith(
      t("fork.success", { title: "Test (fork)" }),
      expect.anything(),
    );
  });

  it("includes replied message ID when forking with a reply", async () => {
    mocked.messageJournalHelpers.resolveRepliedMessage.mockReturnValue({
      oc_message_id: "msg-abc",
      oc_session_id: "s1",
      tg_message_id: 100,
      tg_chat_id: 777,
      tg_topic_id: null,
    } as never);
    const ctx = makeCtx();

    await forkCommand(ctx);

    expect(mocked.opencodeClient.session.fork).toHaveBeenCalledWith(
      expect.objectContaining({ messageID: "msg-abc" }),
    );
  });

  it("handles API error gracefully", async () => {
    mocked.opencodeClient.session.fork.mockResolvedValue({
      data: null,
      error: { message: "Conflict" },
    });
    const ctx = makeCtx();

    await forkCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(t("fork.error"));
  });

  it("handles thrown error gracefully", async () => {
    mocked.opencodeClient.session.fork.mockRejectedValue(new Error("Network error"));
    const ctx = makeCtx();

    await forkCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(t("fork.error"));
  });

  it("does not create topic or attach when scope is null", async () => {
    mocked.threadContextManager.getActiveScope.mockReturnValue(null);
    const ctx = makeCtx();

    await forkCommand(ctx);

    expect(mocked.createForumTopic).toHaveBeenCalled();
    expect(mocked.attachSessionForScope).not.toHaveBeenCalled();
  });
});
