import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { compactCommand } from "../../../src/bot/commands/compact.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  getCurrentSessionMock: vi.fn(),
  getStoredModelMock: vi.fn(),
  summarizeMock: vi.fn(),
  abortThenRunMock: vi.fn(async (_ctx: unknown, action: () => Promise<void>) => action()),
}));

vi.mock("../../../src/bot/utils/abort-then-run.js", () => ({
  abortThenRun: mocked.abortThenRunMock,
}));

vi.mock("../../../src/session/manager.js", () => ({
  getCurrentSession: mocked.getCurrentSessionMock,
}));

vi.mock("../../../src/model/manager.js", () => ({
  getStoredModel: mocked.getStoredModelMock,
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      summarize: mocked.summarizeMock,
    },
  },
}));

vi.mock("../../../src/keyboard/manager.js", () => ({
  keyboardManager: {
    initialize: vi.fn(),
    getKeyboard: vi.fn(() => ({ inline_keyboard: [[{ text: "OK" }]] })),
  },
}));

function createContext(): Context {
  return {
    chat: { id: 123 },
    message: { message_thread_id: 55 },
    api: {
      sendChatAction: vi.fn().mockResolvedValue(undefined),
      editMessageText: vi.fn().mockResolvedValue(undefined),
      deleteMessage: vi.fn().mockResolvedValue(undefined),
    },
    reply: vi.fn().mockResolvedValue({ message_id: 10 }),
  } as unknown as Context;
}

describe("bot/commands/compact", () => {
  beforeEach(() => {
    mocked.getCurrentSessionMock.mockReset();
    mocked.getStoredModelMock.mockReset();
    mocked.summarizeMock.mockReset();
    mocked.abortThenRunMock.mockClear();

    mocked.getCurrentSessionMock.mockReturnValue({
      id: "session-1",
      title: "Test",
      directory: "/repo",
    });
    mocked.getStoredModelMock.mockReturnValue({
      providerID: "openai",
      modelID: "gpt-4",
    });
  });

  it("delegates to abortThenRun before compacting", async () => {
    mocked.summarizeMock.mockResolvedValue({ error: null });

    const ctx = createContext();
    await compactCommand(ctx as never);

    expect(mocked.abortThenRunMock).toHaveBeenCalledTimes(1);
    expect(mocked.summarizeMock).toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(
      t("context.success"),
      expect.objectContaining({ message_thread_id: 55 }),
    );
  });

  it("replies with no_active_session when no session", async () => {
    mocked.getCurrentSessionMock.mockReturnValue(null);

    const ctx = createContext();
    await compactCommand(ctx as never);

    expect(mocked.abortThenRunMock).toHaveBeenCalledTimes(1);
    expect(mocked.summarizeMock).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(
      t("context.no_active_session"),
      expect.objectContaining({ message_thread_id: 55 }),
    );
  });

  it("edits progress message on compact error", async () => {
    mocked.summarizeMock.mockResolvedValue({ error: "compact failed" });

    const ctx = createContext();
    await compactCommand(ctx as never);

    expect(mocked.abortThenRunMock).toHaveBeenCalledTimes(1);
    expect(ctx.api.editMessageText).toHaveBeenCalledWith(
      123,
      10,
      t("context.error"),
    );
  });
});
