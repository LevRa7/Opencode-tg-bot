import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { resolveRepliedMessage } from "../../../src/bot/commands/message-journal-helpers.js";

const mocked = vi.hoisted(() => ({
  messageJournalRepo: {
    findByTgMessage: vi.fn(),
  },
  messageThread: {
    extractMessageThreadIdFromContext: vi.fn().mockReturnValue(null),
  },
}));

vi.mock("../../../src/settings/manager.js", () => ({
  getMessageJournalRepo: () => mocked.messageJournalRepo,
}));

vi.mock("../../../src/bot/utils/message-thread.js", () => ({
  extractMessageThreadIdFromContext: mocked.messageThread.extractMessageThreadIdFromContext,
}));

const JRNL_ROW = {
  oc_message_id: "msg-1",
  oc_session_id: "s1",
  oc_project: "/proj",
  tg_message_id: 100,
  tg_chat_id: 777,
  tg_topic_id: null,
};

describe("message-journal-helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.messageJournalRepo.findByTgMessage.mockReturnValue(null);
  });

  describe("resolveRepliedMessage", () => {
    it("returns null when no reply_to_message", () => {
      const ctx = {
        message: {},
        chat: { id: 777 },
      } as unknown as Context;

      expect(resolveRepliedMessage(ctx)).toBeNull();
    });

    it("returns null when reply_to_message has no message_id", () => {
      const ctx = {
        message: { reply_to_message: {} },
        chat: { id: 777 },
      } as unknown as Context;

      expect(resolveRepliedMessage(ctx)).toBeNull();
    });

    it("looks up the replied message in the journal", () => {
      mocked.messageJournalRepo.findByTgMessage.mockReturnValue(JRNL_ROW);
      const ctx = {
        message: { reply_to_message: { message_id: 100 } },
        chat: { id: 777 },
      } as unknown as Context;

      const result = resolveRepliedMessage(ctx);
      expect(result).toBe(JRNL_ROW);
      expect(mocked.messageJournalRepo.findByTgMessage).toHaveBeenCalledWith(
        100, 777, null,
      );
    });

    it("passes topic ID when message is in a forum topic", () => {
      mocked.messageThread.extractMessageThreadIdFromContext.mockReturnValue(42);
      mocked.messageJournalRepo.findByTgMessage.mockReturnValue(JRNL_ROW);
      const ctx = {
        message: { reply_to_message: { message_id: 100 } },
        chat: { id: 777 },
      } as unknown as Context;

      resolveRepliedMessage(ctx);
      expect(mocked.messageJournalRepo.findByTgMessage).toHaveBeenCalledWith(
        100, 777, 42,
      );
    });

    it("returns null when message is not in journal", () => {
      mocked.messageJournalRepo.findByTgMessage.mockReturnValue(null);
      const ctx = {
        message: { reply_to_message: { message_id: 999 } },
        chat: { id: 777 },
      } as unknown as Context;

      expect(resolveRepliedMessage(ctx)).toBeNull();
    });
  });
});
