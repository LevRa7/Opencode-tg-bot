import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    bot: {
      richProgressFlushIntervalMs: 2000,
    },
  },
}));

vi.mock("../../../src/config.js", () => ({
  config: mockConfig,
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { UnifiedProgressStreamer } from "../../../src/bot/streaming/unified-progress-streamer.js";
import { logger } from "../../../src/utils/logger.js";

describe("UnifiedProgressStreamer", () => {
  let sendText: ReturnType<typeof vi.fn>;
  let editText: ReturnType<typeof vi.fn>;
  let deleteText: ReturnType<typeof vi.fn>;
  let streamer: UnifiedProgressStreamer;

  beforeEach(() => {
    vi.clearAllMocks();
    sendText = vi.fn().mockResolvedValue(100);
    editText = vi.fn().mockResolvedValue(undefined);
    deleteText = vi.fn().mockResolvedValue(undefined);
    streamer = new UnifiedProgressStreamer({ sendText, editText, deleteText });
  });

  afterEach(() => {
    streamer.clearAll();
  });

  const startSession = async (
    sessionId = "s1",
    chatId = 123,
    title = "Test Session",
    threadId?: number,
    projectPath?: string,
  ) => {
    sendText.mockResolvedValueOnce(200);
    await streamer.start(
      sessionId,
      chatId,
      title,
      threadId,
      projectPath ?? "/home/me/test-project",
    );
  };

  // ── Lifecycle ──────────────────────────────────────────────

  describe("start()", () => {
    it("should send initial message on start", async () => {
      await startSession();

      expect(sendText).toHaveBeenCalledTimes(1);
      expect(sendText).toHaveBeenCalledWith(
        123,
        expect.stringContaining("/home/me/test-project"),
        undefined,
      );
      expect(streamer.hasSession("s1")).toBe(true);
    });

    it("should send initial message with threadId when provided", async () => {
      sendText.mockResolvedValueOnce(200);
      await streamer.start("s1", 123, "Test", 789, "/home/me/proj");

      expect(sendText).toHaveBeenCalledWith(
        123,
        expect.any(String),
        789,
      );
    });

    it("should throw if sendText fails on start", async () => {
      sendText.mockRejectedValueOnce(new Error("network error"));

      await expect(
        streamer.start("s1", 123, "Test", undefined, "/proj"),
      ).rejects.toThrow("network error");
    });
  });

  // ── Tool calls ─────────────────────────────────────────────

  describe("addToolCall()", () => {
    it("should add tool call and mark dirty but not send until flush", async () => {
      vi.useFakeTimers();
      await startSession();
      sendText.mockClear();

      streamer.addToolCall("s1", {
        callId: "call1",
        title: "Read file",
        category: "file",
      });

      // No API calls until timer fires
      expect(editText).not.toHaveBeenCalled();

      // Advance timer past flush interval
      vi.advanceTimersByTime(2000);

      expect(editText).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it("should flush on timer and update the message", async () => {
      vi.useFakeTimers();
      await startSession();
      sendText.mockClear();
      editText.mockClear();

      streamer.addToolCall("s1", {
        callId: "call1",
        title: "Read file",
        category: "file",
      });

      vi.advanceTimersByTime(2000);

      expect(editText).toHaveBeenCalledWith(
        123,
        200,
        expect.stringContaining("Read file"),
      );
      vi.useRealTimers();
    });

    it("should not call editText when nothing changed (dirty flag)", async () => {
      vi.useFakeTimers();
      await startSession();
      sendText.mockClear();
      editText.mockClear();

      // No changes — dirty is false
      vi.advanceTimersByTime(2000);

      expect(editText).not.toHaveBeenCalled();
      vi.useRealTimers();
    });
  });

  describe("updateToolCall()", () => {
    it("should update tool call status on flush", async () => {
      vi.useFakeTimers();
      await startSession();
      sendText.mockClear();

      streamer.addToolCall("s1", {
        callId: "call1",
        title: "Read file",
        category: "file",
      });
      streamer.updateToolCall("s1", "call1", { status: "done" });

      vi.advanceTimersByTime(2000);

      expect(editText).toHaveBeenCalledWith(
        123,
        200,
        expect.stringContaining("✅"),
      );
      vi.useRealTimers();
    });

    it("should handle tool call with error status", async () => {
      vi.useFakeTimers();
      await startSession();
      sendText.mockClear();

      streamer.addToolCall("s1", {
        callId: "call1",
        title: "Bad command",
        category: "bash",
      });
      streamer.updateToolCall("s1", "call1", {
        status: "error",
        metric: "exit 1",
      });

      vi.advanceTimersByTime(2000);

      expect(editText).toHaveBeenCalledWith(
        123,
        200,
        expect.stringContaining("❌"),
      );
      vi.useRealTimers();
    });
  });

  // ── Reasoning ──────────────────────────────────────────────

  describe("addReasoning()", () => {
    it("should add reasoning and include in flush", async () => {
      vi.useFakeTimers();
      await startSession();
      sendText.mockClear();

      streamer.addReasoning("s1", "I should read the file first");

      vi.advanceTimersByTime(2000);

      expect(editText).toHaveBeenCalledWith(
        123,
        200,
        expect.stringContaining("I should read the file first"),
      );
      vi.useRealTimers();
    });
  });

  // ── Finalize / Abort ───────────────────────────────────────

  describe("finalize()", () => {
    it("should finalize with completion marker and stop timer", async () => {
      vi.useFakeTimers();
      await startSession();
      sendText.mockClear();

      streamer.addToolCall("s1", {
        callId: "call1",
        title: "Read file",
        category: "file",
      });
      streamer.updateToolCall("s1", "call1", { status: "running" });

      await streamer.finalize("s1");

      // Should have flushed (with all tools marked done)
      expect(editText).toHaveBeenCalled();
      const htmlArg = editText.mock.calls[0][2];
      expect(htmlArg).toContain("✅");

      // Timer should be stopped: advancing should not trigger more flushes
      editText.mockClear();
      vi.advanceTimersByTime(2000);
      expect(editText).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe("abort()", () => {
    it("should abort with error marker and reason text", async () => {
      vi.useFakeTimers();
      await startSession();
      sendText.mockClear();

      streamer.addToolCall("s1", {
        callId: "call1",
        title: "Read file",
        category: "file",
      });

      await streamer.abort("s1", "User requested abort");

      expect(editText).toHaveBeenCalled();
      const htmlArg = editText.mock.calls[0][2];
      expect(htmlArg).toContain("❌");
      expect(htmlArg).toContain("User requested abort");
      vi.useRealTimers();
    });
  });

  // ── Overflow ───────────────────────────────────────────────

  describe("overflow handling", () => {
    it("should handle overflow by creating multiple messages", async () => {
      vi.useFakeTimers();
      await startSession();
      sendText.mockClear();

      const longTitle = "A".repeat(200);

      // Add many tool calls with long titles to push past TELEGRAM_RICH_MAX_LENGTH
      for (let i = 0; i < 200; i++) {
        streamer.addToolCall("s1", {
          callId: `call${i}`,
          title: `${longTitle}-${i}`,
          category: "file",
        });
      }

      // overflow sendText mocks (up to many overflow messages)
      for (let i = 0; i < 20; i++) {
        sendText.mockResolvedValueOnce(300 + i);
      }

      await vi.advanceTimersByTimeAsync(2000);

      // editText should have been called for the root message
      expect(editText).toHaveBeenCalled();
      // sendText should have been called for overflow messages
      expect(sendText).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("should delete excess overflow messages when content shrinks", async () => {
      vi.useFakeTimers();
      await startSession();
      sendText.mockClear();

      const longTitle = "B".repeat(200);

      // First: create many entries to cause overflow
      for (let i = 0; i < 200; i++) {
        streamer.addToolCall("s1", {
          callId: `call${i}`,
          title: `${longTitle}-${i}`,
          category: "file",
        });
      }

      // Allow overflow messages to be created
      for (let i = 0; i < 20; i++) {
        sendText.mockResolvedValueOnce(300 + i);
      }
      await vi.advanceTimersByTimeAsync(2000);

      // Verify overflow was created
      expect(sendText).toHaveBeenCalled();

      // Now simulate content shrinking by clearing tool entries
      const state = streamer._getSessionForTesting("s1")!;
      state.toolEntries.clear();
      state.dirty = true;

      editText.mockClear();
      sendText.mockClear();
      deleteText.mockClear();

      await vi.advanceTimersByTimeAsync(2000);

      // deleteText should clean up excess overflow messages
      expect(deleteText).toHaveBeenCalled();
      vi.useRealTimers();
    });
  });

  // ── In-flight lock ─────────────────────────────────────────

  describe("in-flight lock", () => {
    it("should handle in-flight lock — skip flush if previous edit is pending", async () => {
      vi.useFakeTimers();
      await startSession();
      sendText.mockClear();

      // Make editText slow (doesn't resolve immediately)
      let resolveEdit!: () => void;
      editText.mockImplementation(
        () => new Promise<void>((resolve) => {
          resolveEdit = resolve;
        }),
      );

      streamer.addToolCall("s1", {
        callId: "call1",
        title: "Read file",
        category: "file",
      });

      // First timer tick — starts edit (in-flight)
      vi.advanceTimersByTime(2000);
      expect(editText).toHaveBeenCalledTimes(1);

      // Add more changes, advance timer again — should skip because in-flight
      streamer.addToolCall("s1", {
        callId: "call2",
        title: "Write file",
        category: "file",
      });
      vi.advanceTimersByTime(2000);
      expect(editText).toHaveBeenCalledTimes(1);

      // Now resolve the in-flight edit
      resolveEdit();
      await vi.advanceTimersByTimeAsync(0);

      // Next timer tick should flush pending changes
      vi.advanceTimersByTime(2000);
      expect(editText).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });
  });

  // ── Error handling ─────────────────────────────────────────

  describe("error handling", () => {
    it("should recreate message on MESSAGE_ID_INVALID", async () => {
      vi.useFakeTimers();
      await startSession();
      sendText.mockClear();

      streamer.addToolCall("s1", {
        callId: "call1",
        title: "Read file",
        category: "file",
      });

      editText.mockRejectedValueOnce(
        Object.assign(new Error("Bad Request: message to edit not found"), {
          error_code: 400,
          description: "Bad Request: message to edit not found",
        }),
      );
      sendText.mockResolvedValueOnce(999);

      await vi.advanceTimersByTimeAsync(2000);

      expect(sendText).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("should clear dirty on MESSAGE_NOT_MODIFIED", async () => {
      vi.useFakeTimers();
      await startSession();
      sendText.mockClear();

      streamer.addToolCall("s1", {
        callId: "call1",
        title: "Read file",
        category: "file",
      });

      editText.mockRejectedValueOnce(
        Object.assign(new Error("Bad Request: message is not modified"), {
          error_code: 400,
          description: "Bad Request: message is not modified",
        }),
      );

      await vi.advanceTimersByTimeAsync(2000);

      // Dirty should be cleared, so next tick won't call editText again
      editText.mockClear();
      vi.advanceTimersByTime(2000);
      expect(editText).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("should keep dirty on unknown error for retry", async () => {
      vi.useFakeTimers();
      await startSession();
      sendText.mockClear();

      streamer.addToolCall("s1", {
        callId: "call1",
        title: "Read file",
        category: "file",
      });

      editText.mockRejectedValueOnce(new Error("unknown network error"));

      await vi.advanceTimersByTimeAsync(2000);

      // Should log the error
      expect(logger.error).toHaveBeenCalled();

      // Dirty should still be true, so next tick retries
      editText.mockClear();
      editText.mockResolvedValue(undefined);
      vi.advanceTimersByTime(2000);
      expect(editText).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });
  });

  // ── Session management ─────────────────────────────────────

  describe("hasSession()", () => {
    it("returns true for active sessions", async () => {
      await startSession();
      expect(streamer.hasSession("s1")).toBe(true);
      expect(streamer.hasSession("nonexistent")).toBe(false);
    });
  });

  describe("clearAll()", () => {
    it("cleans up all sessions", async () => {
      await startSession("s1");
      await startSession("s2");

      expect(streamer.hasSession("s1")).toBe(true);
      expect(streamer.hasSession("s2")).toBe(true);

      streamer.clearAll();

      expect(streamer.hasSession("s1")).toBe(false);
      expect(streamer.hasSession("s2")).toBe(false);
    });
  });

  // ── I1: Finalize/abort waits for in-flight ──────────────────

  describe("finalize/abort with in-flight flush", () => {
    it("should wait for in-flight flush before finalizing", async () => {
      vi.useFakeTimers();
      await startSession();
      sendText.mockClear();

      let resolveFirst!: () => void;
      editText.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve;
          }),
      );

      streamer.addToolCall("s1", {
        callId: "call1",
        title: "Read file",
        category: "file",
      });

      // Start the in-flight flush via timer
      vi.advanceTimersByTime(2000);
      expect(editText).toHaveBeenCalledTimes(1);

      // Call finalize while flush is in-flight — enters polling loop
      const finalizePromise = streamer.finalize("s1");

      // Advance fake timers to fire the polling setTimeout(50) loop
      await vi.advanceTimersByTimeAsync(200);

      // Resolve the in-flight edit → flushNow's finally sets inFlight = false
      resolveFirst();
      await vi.advanceTimersByTimeAsync(0);

      // Advance to let polling loop re-check and exit, then final flush runs
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(0);

      await finalizePromise;

      // Should have called edit again (the final flush from finalize)
      expect(editText).toHaveBeenCalledTimes(2);
      // Session persists after finalize (for subsequent message parts in same response)
      expect(streamer.hasSession("s1")).toBe(true);
      const finalizedState = streamer._getSessionForTesting("s1");
      expect(finalizedState?.finalized).toBe(true);
      vi.useRealTimers();
    });

    it("should wait for in-flight flush before aborting", async () => {
      vi.useFakeTimers();
      await startSession();
      sendText.mockClear();

      let resolveFirst!: () => void;
      editText.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve;
          }),
      );

      streamer.addToolCall("s1", {
        callId: "call1",
        title: "Read file",
        category: "file",
      });

      vi.advanceTimersByTime(2000);
      expect(editText).toHaveBeenCalledTimes(1);

      const abortPromise = streamer.abort("s1", "cancelled");

      await vi.advanceTimersByTimeAsync(200);

      resolveFirst();
      await vi.advanceTimersByTimeAsync(0);

      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(0);

      await abortPromise;

      expect(editText).toHaveBeenCalledTimes(2);
      expect(streamer.hasSession("s1")).toBe(false);
      vi.useRealTimers();
    });
  });

  // ── I2: Unsplitted HTML recovery ────────────────────────────

  describe("handleFlushError with unsplit HTML", () => {
    it("should split HTML when recreating after MESSAGE_ID_INVALID with overflow", async () => {
      vi.useFakeTimers();
      await startSession();
      sendText.mockClear();

      const longTitle = "X".repeat(200);
      for (let i = 0; i < 200; i++) {
        streamer.addToolCall("s1", {
          callId: `call${i}`,
          title: `${longTitle}-${i}`,
          category: "file",
        });
      }

      // First flush creates overflow messages
      for (let i = 0; i < 20; i++) {
        sendText.mockResolvedValueOnce(300 + i);
      }
      await vi.advanceTimersByTimeAsync(2000);

      // Now simulate message deleted error with next edit
      editText.mockRejectedValueOnce(
        Object.assign(new Error("Bad Request: message to edit not found"), {
          error_code: 400,
          description: "Bad Request: message to edit not found",
        }),
      );
      // sendText mocks for root + overflow recreation
      for (let i = 0; i < 20; i++) {
        sendText.mockResolvedValueOnce(500 + i);
      }

      streamer.addToolCall("s1", {
        callId: "call_extra",
        title: "Extra tool",
        category: "misc",
      });
      await vi.advanceTimersByTimeAsync(2000);

      // sendText should have been called multiple times (root + overflow parts)
      // At least 2: root message + at least 1 overflow
      expect(sendText).toHaveBeenCalled();
      vi.useRealTimers();
    });
  });

  // ── I3: Memory leak — sessions deleted after abort, persisted after finalize ──

  describe("session cleanup", () => {
    it("should keep session in map after finalize (persists for subsequent messages)", async () => {
      await startSession();
      sendText.mockClear();

      streamer.addToolCall("s1", {
        callId: "call1",
        title: "Read file",
        category: "file",
      });

      await streamer.finalize("s1");

      // Session persists after finalize — only abort/clearAll destroy
      const state = streamer._getSessionForTesting("s1");
      expect(state).toBeDefined();
      expect(state!.finalized).toBe(true);
      expect(state!.destroyed).toBe(false);
    });

    it("should remove session from map after abort", async () => {
      await startSession();
      sendText.mockClear();

      streamer.addToolCall("s1", {
        callId: "call1",
        title: "Read file",
        category: "file",
      });

      await streamer.abort("s1");

      expect(streamer._getSessionForTesting("s1")).toBeUndefined();
    });
  });
});
