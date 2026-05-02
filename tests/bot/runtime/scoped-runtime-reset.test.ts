import { beforeEach, describe, expect, it, vi } from "vitest";
import { summaryAggregator } from "../../../src/summary/aggregator.js";
import { clearAllInteractionState } from "../../../src/interaction/cleanup.js";
import { buildTelegramConversationScopeKey } from "../../../src/telegram/scope.js";

vi.mock("../../../src/interaction/cleanup.js", () => ({
  clearAllInteractionState: vi.fn(),
}));

vi.mock("../../../src/telegram/scope.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/telegram/scope.js")>();
  return {
    ...actual,
    buildTelegramConversationScopeKey: vi.fn().mockReturnValue("test-scope-key"),
  };
});

describe("bot/runtime/scoped-runtime-reset", () => {
  let clearScopedSessionRuntime: (typeof import("../../../src/bot/runtime/scoped-runtime-reset.js"))["clearScopedSessionRuntime"];
  let clearSessionTreeRuntime: (typeof import("../../../src/bot/runtime/scoped-runtime-reset.js"))["clearSessionTreeRuntime"];

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(buildTelegramConversationScopeKey).mockReturnValue("test-scope-key");
    const mod = await import("../../../src/bot/runtime/scoped-runtime-reset.js");
    clearScopedSessionRuntime = mod.clearScopedSessionRuntime;
    clearSessionTreeRuntime = mod.clearSessionTreeRuntime;
  });

  describe("clearScopedSessionRuntime", () => {
    it("clears the addressed session summary and scoped interaction state", () => {
      const clearSessionSpy = vi.spyOn(summaryAggregator, "clearSession").mockImplementation(() => {
        return;
      });

      clearScopedSessionRuntime("session-1", "test-reason", {
        scope: { userId: 1, chatId: 100, messageThreadId: 10 },
      });

      expect(clearSessionSpy).toHaveBeenCalledTimes(1);
      expect(clearSessionSpy).toHaveBeenCalledWith("session-1");
      expect(clearAllInteractionState).toHaveBeenCalledTimes(1);
      expect(buildTelegramConversationScopeKey).toHaveBeenCalledWith({
        userId: 1,
        chatId: 100,
        messageThreadId: 10,
      });
      expect(clearAllInteractionState).toHaveBeenCalledWith("test-reason", "test-scope-key");
    });

    it("clears the addressed session summary without scoped interaction state when scope is missing", () => {
      const clearSessionSpy = vi.spyOn(summaryAggregator, "clearSession").mockImplementation(() => {
        return;
      });

      clearScopedSessionRuntime("session-1", "test-reason");

      expect(clearSessionSpy).toHaveBeenCalledTimes(1);
      expect(clearSessionSpy).toHaveBeenCalledWith("session-1");
      expect(clearAllInteractionState).toHaveBeenCalledTimes(1);
      expect(clearAllInteractionState).toHaveBeenCalledWith("test-reason", undefined);
    });
  });

  describe("clearSessionTreeRuntime", () => {
    it("cleans root and child session summaries, interaction state, and child topics synchronously", () => {
      vi.spyOn(summaryAggregator, "getSessionTree").mockReturnValue({
        rootSessionId: "root-1",
        childSessionIds: ["child-1", "child-2"],
      });
      const clearSessionSpy = vi.spyOn(summaryAggregator, "clearSession").mockImplementation(() => {
        return;
      });

      const mockTopicService = { clearSession: vi.fn(), markSubagentStopped: vi.fn() };

      const result = clearSessionTreeRuntime("root-1", "test-reason", mockTopicService);

      expect(result).toBeUndefined();
      expect(clearSessionSpy).toHaveBeenNthCalledWith(1, "child-1");
      expect(clearSessionSpy).toHaveBeenNthCalledWith(2, "child-2");
      expect(clearSessionSpy).toHaveBeenNthCalledWith(3, "root-1");
      expect(clearAllInteractionState).toHaveBeenCalledTimes(3);
      expect(clearAllInteractionState).toHaveBeenNthCalledWith(1, "test-reason", undefined);
      expect(clearAllInteractionState).toHaveBeenNthCalledWith(2, "test-reason", undefined);
      expect(clearAllInteractionState).toHaveBeenNthCalledWith(3, "test-reason", undefined);
      expect(mockTopicService.markSubagentStopped).toHaveBeenNthCalledWith(1, "child-1");
      expect(mockTopicService.markSubagentStopped).toHaveBeenNthCalledWith(2, "child-2");
      expect(mockTopicService.clearSession).toHaveBeenNthCalledWith(1, "child-1");
      expect(mockTopicService.clearSession).toHaveBeenNthCalledWith(2, "child-2");
    });

    it("calls subagentTopicService methods for each child", () => {
      vi.spyOn(summaryAggregator, "getSessionTree").mockReturnValue({
        rootSessionId: "root-1",
        childSessionIds: ["child-1", "child-2", "child-3"],
      });

      const mockTopicService = { clearSession: vi.fn(), markSubagentStopped: vi.fn() };

      clearSessionTreeRuntime("root-1", "test-reason", mockTopicService);

      expect(mockTopicService.markSubagentStopped).toHaveBeenCalledTimes(3);
      expect(mockTopicService.markSubagentStopped).toHaveBeenCalledWith("child-1");
      expect(mockTopicService.markSubagentStopped).toHaveBeenCalledWith("child-2");
      expect(mockTopicService.markSubagentStopped).toHaveBeenCalledWith("child-3");
    });

    it("handles empty child list by cleaning only the root session", () => {
      vi.spyOn(summaryAggregator, "getSessionTree").mockReturnValue({
        rootSessionId: "root-1",
        childSessionIds: [],
      });
      const clearSessionSpy = vi.spyOn(summaryAggregator, "clearSession").mockImplementation(() => {
        return;
      });

      const mockTopicService = { clearSession: vi.fn(), markSubagentStopped: vi.fn() };

      const result = clearSessionTreeRuntime("root-1", "test-reason", mockTopicService);

      expect(result).toBeUndefined();
      expect(clearSessionSpy).toHaveBeenCalledTimes(1);
      expect(clearSessionSpy).toHaveBeenCalledWith("root-1");
      expect(mockTopicService.markSubagentStopped).not.toHaveBeenCalled();
      expect(mockTopicService.clearSession).not.toHaveBeenCalled();
      expect(clearAllInteractionState).toHaveBeenCalledTimes(1);
      expect(clearAllInteractionState).toHaveBeenCalledWith("test-reason", undefined);
    });
  });
});
