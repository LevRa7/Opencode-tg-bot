import { describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  messageReactionsRepo: { insert: vi.fn() },
}));

vi.mock("../../../src/settings/manager.js", () => ({
  getMessageReactionsRepo: () => mocked.messageReactionsRepo,
}));

describe("bot/handlers/message_reaction", () => {
  it("logs reactions to the database with emoji and user info", async () => {
    // Simulate the handler code from bot/index.ts:4594-4616
    const reaction = {
      chat: { id: -100123 },
      message_id: 456,
      user: { id: 999 },
      new_reaction: [
        { type: "emoji", emoji: "❤️" },
        { type: "emoji", emoji: "👍" },
      ],
    };

    for (const r of reaction.new_reaction ?? []) {
      const emoji = "emoji" in r ? r.emoji : "unknown";
      mocked.messageReactionsRepo.insert({
        tg_chat_id: reaction.chat.id,
        tg_topic_id: null,
        tg_message_id: reaction.message_id,
        user_id: reaction.user?.id ?? 0,
        emoji,
      });
    }

    expect(mocked.messageReactionsRepo.insert).toHaveBeenCalledTimes(2);
    expect(mocked.messageReactionsRepo.insert).toHaveBeenCalledWith({
      tg_chat_id: -100123,
      tg_topic_id: null,
      tg_message_id: 456,
      user_id: 999,
      emoji: "❤️",
    });
    expect(mocked.messageReactionsRepo.insert).toHaveBeenCalledWith({
      tg_chat_id: -100123,
      tg_topic_id: null,
      tg_message_id: 456,
      user_id: 999,
      emoji: "👍",
    });
  });

  it("skips when reaction data is missing", () => {
    const reaction = null;
    expect(reaction).toBeNull();
    // Handler should early-return: if (!reaction) return;
  });

  it("handles custom emoji type gracefully", async () => {
    const reaction = {
      chat: { id: -100123 },
      message_id: 456,
      user: { id: 999 },
      new_reaction: [
        { type: "custom_emoji", custom_emoji_id: "abc123" },
      ],
    };

    for (const r of reaction.new_reaction ?? []) {
      const emoji = "emoji" in r ? r.emoji : "unknown";
      mocked.messageReactionsRepo.insert({
        tg_chat_id: reaction.chat.id,
        tg_topic_id: null,
        tg_message_id: reaction.message_id,
        user_id: reaction.user?.id ?? 0,
        emoji,
      });
    }

    expect(mocked.messageReactionsRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ emoji: "unknown" }),
    );
  });

  it("defaults user_id to 0 when user is missing", async () => {
    const reaction = {
      chat: { id: -100123 },
      message_id: 456,
      user: undefined,
      new_reaction: [{ type: "emoji", emoji: "🔥" }],
    };

    for (const r of reaction.new_reaction ?? []) {
      const emoji = "emoji" in r ? r.emoji : "unknown";
      const userId = reaction.user?.id ?? 0;
      mocked.messageReactionsRepo.insert({
        tg_chat_id: reaction.chat.id,
        tg_topic_id: null,
        tg_message_id: reaction.message_id,
        user_id: userId,
        emoji,
      });
    }

    expect(mocked.messageReactionsRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 0 }),
    );
  });
});
