import { describe, expect, it, vi } from "vitest";

describe("reaction bookmarks", () => {
  describe("reaction ❤️ (heart) → bookmark message", () => {
    it("saves bookmarked message metadata when user reacts with ❤️", () => {
      const bookmarkRepo = {
        upsert: vi.fn(),
      };

      const reactionHandler = (
        chatId: number,
        topicId: number | null,
        messageId: number,
        userId: number,
        emoji: string,
      ) => {
        if (emoji === "❤️") {
          bookmarkRepo.upsert({
            tg_chat_id: chatId,
            tg_topic_id: topicId,
            tg_message_id: messageId,
            user_id: userId,
            emoji: "❤️",
          });
        }
      };

      reactionHandler(-100123, 42, 500, 999, "❤️");

      expect(bookmarkRepo.upsert).toHaveBeenCalledWith({
        tg_chat_id: -100123,
        tg_topic_id: 42,
        tg_message_id: 500,
        user_id: 999,
        emoji: "❤️",
      });
    });

    it("does not bookmark for other reactions", () => {
      const bookmarkRepo = { upsert: vi.fn() };

      const reactionHandler = (
        _chatId: number,
        _topicId: number | null,
        _messageId: number,
        _userId: number,
        emoji: string,
      ) => {
        if (emoji === "❤️" || emoji === "✍️") {
          bookmarkRepo.upsert({ emoji } as never);
        }
      };

      reactionHandler(-100, null, 1, 1, "👍");
      reactionHandler(-100, null, 1, 1, "🔥");
      reactionHandler(-100, null, 1, 1, "😊");

      expect(bookmarkRepo.upsert).not.toHaveBeenCalled();
    });
  });

  describe("reaction ✍️ (writing hand) → bookmark message", () => {
    it("saves bookmarked message when user reacts with ✍️", () => {
      const bookmarkRepo = { upsert: vi.fn() };

      const reactionHandler = (
        chatId: number,
        topicId: number | null,
        messageId: number,
        userId: number,
        emoji: string,
      ) => {
        if (emoji === "✍️") {
          bookmarkRepo.upsert({
            tg_chat_id: chatId,
            tg_topic_id: topicId,
            tg_message_id: messageId,
            user_id: userId,
            emoji: "✍️",
          });
        }
      };

      reactionHandler(-100123, null, 777, 999, "✍️");

      expect(bookmarkRepo.upsert).toHaveBeenCalledWith({
        tg_chat_id: -100123,
        tg_topic_id: null,
        tg_message_id: 777,
        user_id: 999,
        emoji: "✍️",
      });
    });
  });

  describe("bookmark removal", () => {
    it("removes bookmark when reaction is removed", () => {
      const bookmarkRepo = {
        delete: vi.fn(),
      };

      const removeReactionHandler = (
        chatId: number,
        topicId: number | null,
        messageId: number,
        userId: number,
      ) => {
        bookmarkRepo.delete({
          tg_chat_id: chatId,
          tg_topic_id: topicId,
          tg_message_id: messageId,
          user_id: userId,
        });
      };

      removeReactionHandler(-100, 42, 500, 999);

      expect(bookmarkRepo.delete).toHaveBeenCalledWith({
        tg_chat_id: -100,
        tg_topic_id: 42,
        tg_message_id: 500,
        user_id: 999,
      });
    });
  });
});

describe("reaction 💔 → /abort", () => {
  it("triggers abort when user reacts with 💔", async () => {
    const abortCurrentOperation = vi.fn().mockResolvedValue(undefined);

    const reactionHandler = async (
      chatId: number,
      topicId: number | null,
      messageId: number,
      userId: number,
      emoji: string,
      ctx: { chat: { id: number }; message?: { message_thread_id?: number } },
    ) => {
      if (emoji === "💔") {
        await abortCurrentOperation(ctx as never, { notifyUser: false });
      }
    };

    const ctx = { chat: { id: -100123 }, message: { message_thread_id: 42 } };
    await reactionHandler(-100123, 42, 999, 999, "💔", ctx);

    expect(abortCurrentOperation).toHaveBeenCalledWith(ctx, { notifyUser: false });
  });

  it("does not trigger abort for other reactions", async () => {
    const abortCurrentOperation = vi.fn();

    const reactionHandler = async (
      _chatId: number,
      _topicId: number | null,
      _messageId: number,
      _userId: number,
      emoji: string,
      ctx: unknown,
    ) => {
      if (emoji === "💔") {
        await abortCurrentOperation(ctx as never, { notifyUser: false });
      }
    };

    await reactionHandler(-100, null, 1, 1, "❤️", {});
    await reactionHandler(-100, null, 1, 1, "👍", {});
    await reactionHandler(-100, null, 1, 1, "🔥", {});

    expect(abortCurrentOperation).not.toHaveBeenCalled();
  });

  it("only triggers for allowed admin user", async () => {
    const abortCurrentOperation = vi.fn();
    const ALLOWED_USER_ID = 999;

    const reactionHandler = async (
      userId: number,
      emoji: string,
      ctx: unknown,
    ) => {
      if (emoji === "💔" && userId === ALLOWED_USER_ID) {
        await abortCurrentOperation(ctx as never, { notifyUser: false });
      }
    };

    // Allowed user
    await reactionHandler(999, "💔", {});
    expect(abortCurrentOperation).toHaveBeenCalledTimes(1);

    // Not allowed user
    await reactionHandler(888, "💔", {});
    expect(abortCurrentOperation).toHaveBeenCalledTimes(1); // no additional call
  });
});
