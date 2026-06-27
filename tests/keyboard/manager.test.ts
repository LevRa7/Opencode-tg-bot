import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TelegramConversationScope } from "../../src/telegram/scope.js";
import { runWithTelegramConversationScope } from "../../src/telegram/scope.js";

/**
 * Tests for KeyboardManager.
 *
 * 1. Scoped state isolation: per-conversation keyboard state (e.g. context tokens)
 *    must not leak between topics/scopes.
 * 2. sendKeyboardUpdate force option: a forced update must bypass the
 *    UPDATE_DEBOUNCE_MS (2000ms) debounce so a freshly selected model/variant
 *    refreshes the host keyboard immediately.
 */

const mocked = vi.hoisted(() => ({
  createMainKeyboardMock: vi.fn(() => ({ keyboard: "main" })),
  getStoredModelMock: vi.fn(() => ({ providerID: "openai", modelID: "gpt-5", variant: "default" })),
  getStoredAgentMock: vi.fn(() => "build"),
  formatVariantForButtonMock: vi.fn(() => "Default"),
  getSystemInfoMock: vi.fn(() => ({ cpu: "1%", ram: "2%" })),
  isRunningMock: vi.fn(() => false),
  isTerminalTopicMock: vi.fn(() => false),
  isTerminalRunningMock: vi.fn(() => false),
  isBusyMock: vi.fn(() => false),
  loggerMock: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/bot/utils/keyboard.js", () => ({
  createMainKeyboard: mocked.createMainKeyboardMock,
}));

vi.mock("../../src/model/manager.js", () => ({
  getStoredModel: mocked.getStoredModelMock,
}));

vi.mock("../../src/agent/manager.js", () => ({
  getStoredAgent: mocked.getStoredAgentMock,
}));

vi.mock("../../src/variant/manager.js", () => ({
  formatVariantForButton: mocked.formatVariantForButtonMock,
}));

vi.mock("../../src/utils/system-info.js", () => ({
  getSystemInfo: mocked.getSystemInfoMock,
}));

vi.mock("../../src/process/manager.js", () => ({
  processManager: {
    isRunning: mocked.isRunningMock,
  },
}));

vi.mock("../../src/bot/commands/terminal.js", () => ({
  isTerminalTopic: mocked.isTerminalTopicMock,
  isTerminalRunning: mocked.isTerminalRunningMock,
}));

vi.mock("../../src/scheduled-task/foreground-state.js", () => ({
  foregroundSessionState: {
    isBusy: mocked.isBusyMock,
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: mocked.loggerMock,
}));

import { keyboardManager, __resetKeyboardManagersForTests } from "../../src/keyboard/manager.js";

describe("keyboard/manager scoped state", () => {
  const scopeA: TelegramConversationScope = { userId: 1, chatId: 100, messageThreadId: 10 };
  const scopeB: TelegramConversationScope = { userId: 1, chatId: 100, messageThreadId: 11 };

  beforeEach(() => {
    __resetKeyboardManagersForTests();
  });

  it("keeps context state isolated between topics", () => {
    runWithTelegramConversationScope(scopeA, () => {
      keyboardManager.initialize({} as never, 100);
      keyboardManager.updateContext(10, 100);
    });

    runWithTelegramConversationScope(scopeB, () => {
      keyboardManager.initialize({} as never, 100);
      keyboardManager.updateContext(20, 200);
    });

    expect(
      runWithTelegramConversationScope(scopeA, () => keyboardManager.getContextInfo()),
    ).toEqual({
      tokensUsed: 10,
      tokensLimit: 100,
    });
    expect(
      runWithTelegramConversationScope(scopeB, () => keyboardManager.getContextInfo()),
    ).toEqual({
      tokensUsed: 20,
      tokensLimit: 200,
    });
  });
});

interface SeededScopedState {
  state: null;
  api: { editMessageReplyMarkup: ReturnType<typeof vi.fn> };
  chatId: number;
  lastUpdateTime: number;
  keyboardMessageId: number;
}

function seedGlobalScope(): { editMock: ReturnType<typeof vi.fn> } {
  const editMock = vi.fn().mockResolvedValue(undefined);
  const seeded: SeededScopedState = {
    state: null,
    api: { editMessageReplyMarkup: editMock },
    chatId: 111,
    lastUpdateTime: 0,
    keyboardMessageId: 555,
  };
  // "global" is the scope key resolved when no conversation scope is active. Seeding the
  // edit path directly (state=null) lets buildKeyboard short-circuit to createMainKeyboard.
  (keyboardManager as unknown as { scopedStates: Map<string, unknown> }).scopedStates.set(
    "global",
    seeded,
  );
  return { editMock };
}

describe("keyboard/manager sendKeyboardUpdate force option", () => {
  beforeEach(() => {
    __resetKeyboardManagersForTests();
    mocked.createMainKeyboardMock.mockClear();
    mocked.loggerMock.debug.mockClear();
  });

  it("bypasses the debounce window when the second call is forced", async () => {
    const { editMock } = seedGlobalScope();

    // First update is allowed (lastUpdateTime starts at 0).
    await keyboardManager.sendKeyboardUpdate(111);
    expect(editMock).toHaveBeenCalledTimes(1);

    // A second rapid call without force lands inside the debounce window and is skipped.
    await keyboardManager.sendKeyboardUpdate(111);
    expect(editMock).toHaveBeenCalledTimes(1);

    // The same rapid call WITH force must still edit the host message.
    await keyboardManager.sendKeyboardUpdate(111, undefined, { force: true });
    expect(editMock).toHaveBeenCalledTimes(2);

    expect(editMock).toHaveBeenLastCalledWith(111, 555, expect.objectContaining({
      reply_markup: { keyboard: "main" },
    }));
  });
});
