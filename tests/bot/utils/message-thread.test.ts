import { describe, expect, it } from "vitest";
import type { Context } from "grammy";
import {
  extractMessageThreadIdFromContext,
  extractThreadTargetFromContext,
  isForumMainThreadContext,
  resolveReplyKeyboardActionThreadId,
  withMessageThreadId,
} from "../../../src/bot/utils/message-thread.js";

describe("bot/utils/message-thread", () => {
  it("extracts message_thread_id from message updates", () => {
    const ctx = {
      chat: { id: -100123 },
      message: { chat: { id: -100123 }, message_thread_id: 42 },
    } as unknown as Context;

    expect(extractMessageThreadIdFromContext(ctx)).toBe(42);
    expect(extractThreadTargetFromContext(ctx)).toEqual({
      chatId: -100123,
      messageThreadId: 42,
    });
  });

  it("extracts message_thread_id from callback message", () => {
    const ctx = {
      chat: { id: -100123 },
      callbackQuery: {
        data: "x",
        message: { chat: { id: -100777 }, message_thread_id: 99 },
      },
    } as unknown as Context;

    expect(extractMessageThreadIdFromContext(ctx)).toBe(99);
    expect(extractThreadTargetFromContext(ctx)).toEqual({
      chatId: -100777,
      messageThreadId: 99,
    });
  });

  it("keeps forum main topic as a valid target without a thread id", () => {
    const ctx = {
      from: { id: 1001 },
      chat: { id: -100123, type: "supergroup", is_forum: true },
      message: { chat: { id: -100123, type: "supergroup", is_forum: true } },
    } as unknown as Context;

    expect(extractMessageThreadIdFromContext(ctx)).toBeUndefined();
    expect(extractThreadTargetFromContext(ctx)).toEqual({
      chatId: -100123,
      messageThreadId: 0,
    });
  });

  it("detects forum main-thread message contexts", () => {
    const ctx = {
      chat: { id: -100123, type: "supergroup", is_forum: true },
      message: { chat: { id: -100123, type: "supergroup", is_forum: true } },
    } as unknown as Context;

    expect(isForumMainThreadContext(ctx)).toBe(true);
    expect(resolveReplyKeyboardActionThreadId(ctx)).toBe(0);
  });

  it("keeps topic thread ids for topic contexts", () => {
    const ctx = {
      chat: { id: -100123, type: "supergroup", is_forum: true },
      message: { chat: { id: -100123, type: "supergroup", is_forum: true }, message_thread_id: 42 },
    } as unknown as Context;

    expect(isForumMainThreadContext(ctx)).toBe(false);
    expect(resolveReplyKeyboardActionThreadId(ctx)).toBe(42);
  });

  it("merges message_thread_id into send options", () => {
    expect(withMessageThreadId({ disable_notification: true }, 7)).toEqual({
      disable_notification: true,
      message_thread_id: 7,
    });

    expect(withMessageThreadId(undefined, undefined)).toEqual({});
    expect(withMessageThreadId({ disable_notification: true }, 0)).toEqual({
      disable_notification: true,
    });
    expect(withMessageThreadId({ disable_notification: true }, -3)).toEqual({
      disable_notification: true,
    });
  });
});
