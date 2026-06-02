import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";

const mocked = vi.hoisted(() => ({
  questionReplyMock: vi.fn(),
  currentProject: {
    id: "project-1",
    worktree: "D:/repo",
  } as { id: string; worktree: string } | undefined,
  currentSession: null as { id: string; title: string; directory: string } | null,
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    question: {
      reply: mocked.questionReplyMock,
    },
  },
}));

vi.mock("../../../src/settings/manager.js", () => ({
  getOrCreateServerPassword: vi.fn(() => "test-pw-" + Math.random().toString(36).slice(2, 8)),
  getCurrentProject: vi.fn(() => mocked.currentProject),
}));

vi.mock("../../../src/session/manager.js", () => ({
  getCurrentSession: vi.fn(() => mocked.currentSession),
}));

vi.mock("../../../src/utils/safe-background-task.js", () => ({
  safeBackgroundTask: ({
    task,
    onSuccess,
    onError,
  }: {
    task: () => Promise<unknown>;
    onSuccess?: (value: unknown) => void | Promise<void>;
    onError?: (error: unknown) => void | Promise<void>;
  }) => {
    void task()
      .then((result) => {
        if (onSuccess) {
          void onSuccess(result);
        }
      })
      .catch((error) => {
        if (onError) {
          void onError(error);
        }
      });
  },
}));

import { questionManager } from "../../../src/question/manager.js";
import { interactionManager } from "../../../src/interaction/manager.js";
import {
  handleQuestionCallback,
  handleQuestionTextAnswer,
  showCurrentQuestion,
} from "../../../src/bot/handlers/question.js";
import type { Question } from "../../../src/question/types.js";
import { t } from "../../../src/i18n/index.js";
import { buildTelegramConversationScopeKey } from "../../../src/telegram/scope.js";

const QUESTION_ONE: Question = {
  header: "Q1",
  question: "Pick one",
  options: [
    { label: "Yes", description: "accept" },
    { label: "No", description: "decline" },
  ],
};

const QUESTION_TWO: Question = {
  header: "Q2",
  question: "Second question",
  options: [
    { label: "Alpha", description: "first" },
    { label: "Beta", description: "second" },
  ],
};

const MULTIPLE_QUESTION: Question = {
  header: "Q multi",
  question: "Pick multiple",
  multiple: true,
  options: [
    { label: "One", description: "1" },
    { label: "Two", description: "2" },
  ],
};

const SINGLE_OPTION_QUESTION: Question = {
  header: "Код",
  question: "Введите код из Telegram",
  options: [{ label: "Отправить", description: "Введите 5-значный код из Telegram" }],
};

function createApi(sendMessageIds: number[]): Context["api"] {
  let index = 0;

  return {
    sendMessage: vi.fn().mockImplementation(async () => {
      const messageId = sendMessageIds[index] ?? sendMessageIds[sendMessageIds.length - 1] ?? 1;
      index += 1;
      return { message_id: messageId };
    }),
    deleteMessage: vi.fn().mockResolvedValue(true),
  } as unknown as Context["api"];
}

function createCallbackContext(data: string, messageId: number, api: Context["api"]): Context {
  return {
    chat: { id: 123 },
    callbackQuery: {
      data,
      message: {
        message_id: messageId,
      },
    } as Context["callbackQuery"],
    api,
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

function createTextContext(text: string, api: Context["api"]): Context {
  return {
    chat: { id: 123 },
    message: {
      text,
    } as Context["message"],
    api,
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

function createScopedTextContext(
  text: string,
  api: Context["api"],
  userId: number,
  chatId: number,
  messageThreadId: number,
): Context {
  return {
    from: { id: userId },
    chat: { id: chatId, is_forum: true },
    message: {
      text,
      message_thread_id: messageThreadId,
    } as Context["message"],
    api,
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("bot/handlers/question", () => {
  beforeEach(() => {
    questionManager.clear();
    interactionManager.clear("test_setup");
    mocked.questionReplyMock.mockReset();
    mocked.questionReplyMock.mockResolvedValue({ error: null });
    mocked.currentProject = {
      id: "project-1",
      worktree: "D:/repo",
    };
    mocked.currentSession = null;
  });

  it("starts question interaction in callback mode when showing question", async () => {
    const api = createApi([100]);

    questionManager.startQuestions([QUESTION_ONE], "req-1");
    await showCurrentQuestion(api, 123);

    expect(questionManager.getActiveMessageId()).toBe(100);

    const state = interactionManager.getSnapshot();
    expect(state?.kind).toBe("question");
    expect(state?.expectedInput).toBe("callback");
    expect(state?.metadata.requestID).toBe("req-1");
    expect(state?.metadata.messageId).toBe(100);
    expect(state?.metadata.questionIndex).toBe(0);
  });

  it("switches to mixed mode on custom callback and accepts custom text", async () => {
    const api = createApi([101, 102]);

    questionManager.startQuestions([QUESTION_ONE, QUESTION_TWO], "req-2");
    await showCurrentQuestion(api, 123);

    const customCtx = createCallbackContext("question:custom:0", 101, api);
    await handleQuestionCallback(customCtx);

    expect(questionManager.isWaitingForCustomInput(0)).toBe(true);
    expect(interactionManager.getSnapshot()?.expectedInput).toBe("mixed");

    const textCtx = createTextContext("My custom answer", api);
    await handleQuestionTextAnswer(textCtx);

    expect(questionManager.getCustomAnswer(0)).toBe("My custom answer");
    expect(questionManager.getCurrentIndex()).toBe(1);
    expect(questionManager.getActiveMessageId()).toBe(102);
    expect(interactionManager.getSnapshot()?.expectedInput).toBe("callback");

    expect(api.deleteMessage).toHaveBeenCalledWith(123, 101);
  });

  it("rejects stale callback from old question message", async () => {
    const api = createApi([200]);

    questionManager.startQuestions([QUESTION_ONE], "req-3");
    await showCurrentQuestion(api, 123);

    const staleCtx = createCallbackContext("question:select:0:0", 199, api);
    const handled = await handleQuestionCallback(staleCtx);

    expect(handled).toBe(true);
    expect(staleCtx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("question.inactive_callback"),
      show_alert: true,
    });
    expect(questionManager.getSelectedOptions(0)).toEqual(new Set<number>());
  });

  it("cancels poll and clears question interaction", async () => {
    const api = createApi([300]);

    questionManager.startQuestions([QUESTION_ONE], "req-4");
    await showCurrentQuestion(api, 123);

    const cancelCtx = createCallbackContext("question:cancel:0", 300, api);
    const handled = await handleQuestionCallback(cancelCtx);

    expect(handled).toBe(true);
    expect(cancelCtx.editMessageText).toHaveBeenCalledWith(t("question.cancelled"));
    expect(questionManager.isActive()).toBe(false);
    expect(questionManager.getTotalQuestions()).toBe(0);
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("requires at least one selected option on multiple submit", async () => {
    const api = createApi([400]);

    questionManager.startQuestions([MULTIPLE_QUESTION], "req-5");
    await showCurrentQuestion(api, 123);

    const submitCtx = createCallbackContext("question:submit:0", 400, api);
    const handled = await handleQuestionCallback(submitCtx);

    expect(handled).toBe(true);
    expect(submitCtx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("question.select_one_required_callback"),
      show_alert: true,
    });
    expect(questionManager.isActive()).toBe(true);
  });

  it("uses direct text input for single-option questions without inline keyboard", async () => {
    const api = createApi([500]);

    questionManager.startQuestions([SINGLE_OPTION_QUESTION], "req-6");
    await showCurrentQuestion(api, 123);

    expect(api.sendMessage).toHaveBeenCalledWith(
      123,
      "❓ 1/1 Код\n\nВведите код из Telegram\n\nОтправить — Введите 5-значный код из Telegram",
      {
        entities: [
          { type: "bold", offset: 0, length: 9 },
          { type: "bold", offset: 36, length: 9 },
        ],
      },
    );
    expect(interactionManager.getSnapshot()?.expectedInput).toBe("mixed");

    const textCtx = createTextContext("95001", api);
    await handleQuestionTextAnswer(textCtx);

    expect(questionManager.isActive()).toBe(false);
    expect(api.deleteMessage).toHaveBeenCalledWith(123, 500);
  });

  it("sends child-topic questions silently when a dedicated delivery target is provided", async () => {
    const api = createApi([600]);

    questionManager.startQuestions([QUESTION_ONE], "req-7");
    await (showCurrentQuestion as unknown as (...args: unknown[]) => Promise<void>)(
      api,
      -100123,
      undefined,
      undefined,
      {
        chatId: -100123,
        messageThreadId: 321,
        disableNotification: true,
      },
    );

    expect(api.sendMessage).toHaveBeenCalledWith(
      -100123,
      "❓ 1/1 Q1\n\nPick one\n\nYes — accept\n\nNo — decline",
      expect.objectContaining({
        entities: [
          { type: "bold", offset: 0, length: 8 },
          { type: "bold", offset: 20, length: 3 },
          { type: "bold", offset: 34, length: 2 },
        ],
        message_thread_id: 321,
        disable_notification: true,
        reply_markup: expect.anything(),
      }),
    );
  });

  it("replies with the stored session directory instead of ambient runtime state", async () => {
    const api = createApi([700]);

    questionManager.startQuestions(
      [SINGLE_OPTION_QUESTION],
      "req-8",
      {
        sessionId: "session-stored",
        runtimeContext: {
          directory: "D:/explicit-runtime",
        },
      },
    );
    await showCurrentQuestion(api, 123);

    mocked.currentSession = {
      id: "session-ambient",
      title: "Ambient session",
      directory: "D:/ambient-session",
    };
    mocked.currentProject = {
      id: "project-ambient",
      worktree: "D:/ambient-project",
    };

    const textCtx = createTextContext("95001", api);
    await handleQuestionTextAnswer(textCtx);
    await flushMicrotasks();

    expect(mocked.questionReplyMock).toHaveBeenCalledWith({
      requestID: "req-8",
      directory: "D:/explicit-runtime",
      answers: [["95001"]],
    });
  });

  it("reports missing stored runtime directory when question runtime context is absent", async () => {
    const api = createApi([800, 801]);
    const scopeKey = buildTelegramConversationScopeKey({
      userId: 1,
      chatId: 123,
      messageThreadId: 10,
    });

    questionManager.startQuestions([SINGLE_OPTION_QUESTION], "req-9", {
      scopeKey,
    });
    await showCurrentQuestion(api, 123, 10, scopeKey);

    const textCtx = createScopedTextContext("95001", api, 1, 123, 10);
    await handleQuestionTextAnswer(textCtx);

    expect(api.sendMessage).toHaveBeenCalledWith(
      123,
      t("question.no_active_question_runtime"),
      expect.objectContaining({ message_thread_id: 10 }),
    );
    expect(mocked.questionReplyMock).not.toHaveBeenCalled();
  });

  it("uses stored runtime context after restoring question state into a new scope", async () => {
    const api = createApi([900]);
    const sourceScopeKey = buildTelegramConversationScopeKey({
      userId: 1,
      chatId: 123,
      messageThreadId: 10,
    });
    const targetScopeKey = buildTelegramConversationScopeKey({
      userId: 1,
      chatId: 123,
      messageThreadId: 20,
    });

    questionManager.startQuestions([SINGLE_OPTION_QUESTION], "req-10", {
      scopeKey: sourceScopeKey,
      sessionId: "session-restored",
      runtimeContext: {
        directory: "D:/restored-runtime",
      },
    });

    expect(questionManager.restoreSessionToScope("session-restored", targetScopeKey)).toBe(true);

    await showCurrentQuestion(api, 123, undefined, targetScopeKey);

    mocked.currentSession = {
      id: "session-ambient",
      title: "Ambient session",
      directory: "D:/ambient-session",
    };
    mocked.currentProject = {
      id: "project-ambient",
      worktree: "D:/ambient-project",
    };

    const textCtx = createScopedTextContext("95001", api, 1, 123, 20);
    await handleQuestionTextAnswer(textCtx);
    await flushMicrotasks();

    expect(mocked.questionReplyMock).toHaveBeenCalledWith({
      requestID: "req-10",
      directory: "D:/restored-runtime",
      answers: [["95001"]],
    });
  });
});
