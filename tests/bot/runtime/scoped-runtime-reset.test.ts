import { beforeEach, describe, expect, it, vi } from "vitest";
import { summaryAggregator } from "../../../src/summary/aggregator.js";
import { stopEventListening } from "../../../src/opencode/events.js";
import { clearAllInteractionState } from "../../../src/interaction/cleanup.js";

vi.mock("../../../src/opencode/events.js", () => ({
  stopEventListening: vi.fn(),
}));

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
  let clearScopedSessionRuntime: typeof import("../../../src/bot/runtime/scoped-runtime-reset.js")["clearScopedSessionRuntime"];
  let clearSessionTreeRuntime: typeof import("../../../src/bot/runtime/scoped-runtime-reset.js")["clearSessionTreeRuntime"];

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../../src/bot/runtime/scoped-runtime-reset.js");
    clearScopedSessionRuntime = mod.clearScopedSessionRuntime;
    clearSessionTreeRuntime = mod.clearSessionTreeRuntime;
  });

  describe("clearScopedSessionRuntime", () => {
    it("clears only the addressed session", () => {
      clearScopedSessionRuntime("session-1", "test-reason");

      expect(stopEventListening).toHaveBeenCalledTimes(1);
      expect(clearAllInteractionState).toHaveBeenCalledTimes(1);
      expect(clearAllInteractionState).toHaveBeenCalledWith("test-reason", undefined);
    });
  });

  describe("clearSessionTreeRuntime", () => {
    it("cleans root and all child sessions", async () => {
      vi.spyOn(summaryAggregator, "getSessionTree").mockReturnValue({
        rootSessionId: "root-1",
        childSessionIds: ["child-1", "child-2"],
      });

      const mockTopicService = { clearSession: vi.fn(), markSubagentStopped: vi.fn() };

      await clearSessionTreeRuntime("root-1", "test-reason", mockTopicService);

      expect(stopEventListening).toHaveBeenCalledTimes(3);
      expect(clearAllInteractionState).toHaveBeenCalledTimes(3);
      expect(clearAllInteractionState).toHaveBeenNthCalledWith(1, "test-reason", undefined);
      expect(clearAllInteractionState).toHaveBeenNthCalledWith(2, "test-reason", undefined);
      expect(clearAllInteractionState).toHaveBeenNthCalledWith(3, "test-reason", undefined);
    });

    it("calls subagentTopicService methods for each child", async () => {
      vi.spyOn(summaryAggregator, "getSessionTree").mockReturnValue({
        rootSessionId: "root-1",
        childSessionIds: ["child-1", "child-2", "child-3"],
      });

      const mockTopicService = { clearSession: vi.fn(), markSubagentStopped: vi.fn() };

      await clearSessionTreeRuntime("root-1", "test-reason", mockTopicService);

      expect(mockTopicService.markSubagentStopped).toHaveBeenCalledTimes(3);
      expect(mockTopicService.markSubagentStopped).toHaveBeenCalledWith("child-1");
      expect(mockTopicService.markSubagentStopped).toHaveBeenCalledWith("child-2");
      expect(mockTopicService.markSubagentStopped).toHaveBeenCalledWith("child-3");
    });

    it("handles empty child list", async () => {
      vi.spyOn(summaryAggregator, "getSessionTree").mockReturnValue({
        rootSessionId: "root-1",
        childSessionIds: [],
      });

      const mockTopicService = { clearSession: vi.fn(), markSubagentStopped: vi.fn() };

      await clearSessionTreeRuntime("root-1", "test-reason", mockTopicService);

      expect(mockTopicService.markSubagentStopped).not.toHaveBeenCalled();
      expect(mockTopicService.clearSession).not.toHaveBeenCalled();
      expect(stopEventListening).toHaveBeenCalledTimes(1);
      expect(clearAllInteractionState).toHaveBeenCalledTimes(1);
    });
  });
});
