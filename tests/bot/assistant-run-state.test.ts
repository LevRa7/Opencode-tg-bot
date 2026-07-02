import { beforeEach, describe, expect, it } from "vitest";
import { assistantRunState } from "../../src/bot/assistant-run-state.js";

describe("bot/assistant-run-state", () => {
  beforeEach(() => {
    assistantRunState.__resetForTests();
  });

  it("tracks completion timing and logical message metadata for a completed run", () => {
    assistantRunState.startRun("session-1", {
      startedAt: 100,
      configuredAgent: "build",
      configuredProviderID: "openai",
      configuredModelID: "gpt-5.4",
    });

    assistantRunState.markResponseCompleted("session-1", {
      agent: "build",
      providerID: "openai",
      modelID: "gpt-5.4",
      logicalMessageId: "message-stream-1",
      completedAt: 250,
    });

    expect(assistantRunState.finishRun("session-1", "test_complete")).toEqual(
      expect.objectContaining({
        startedAt: 100,
        actualAgent: "build",
        actualProviderID: "openai",
        actualModelID: "gpt-5.4",
        hasCompletedResponse: false,
        completionRecorded: true,
        hasPublishedFinalResponse: false,
        completedAt: 250,
        completedLogicalMessageId: "message-stream-1",
      }),
    );
  });

  it("tracks durable final publication separately from completion metadata", () => {
    assistantRunState.startRun("session-1", {
      startedAt: 100,
      configuredAgent: "build",
      configuredProviderID: "openai",
      configuredModelID: "gpt-5.4",
    });

    assistantRunState.markResponseCompleted("session-1", {
      logicalMessageId: "message-stream-1",
      completedAt: 250,
    });
    assistantRunState.markFinalResponsePublished("session-1", {
      logicalMessageId: "message-stream-1",
    });

    expect(assistantRunState.finishRun("session-1", "test_complete")).toEqual(
      expect.objectContaining({
        completionRecorded: true,
        hasPublishedFinalResponse: true,
        publishedFinalLogicalMessageId: "message-stream-1",
      }),
    );
  });

  describe("isFinalizationInFlight", () => {
    // 2026-06-26: the completion/finalization pipeline runs asynchronously after the
    // server reports the session idle. Busy reconciliation must be able to detect that
    // window (completion recorded, final not yet published) so it does not clear the run
    // state mid-finalization, which would break the duplicate-suppression guard and leave
    // a leftover streaming draft next to the final message.
    it("is false when no run exists", () => {
      expect(assistantRunState.isFinalizationInFlight("session-1")).toBe(false);
    });

    it("is false for a started run before completion is recorded", () => {
      assistantRunState.startRun("session-1", { startedAt: 100 });

      expect(assistantRunState.isFinalizationInFlight("session-1")).toBe(false);
    });

    it("is true once completion is recorded but the final is not yet published", () => {
      assistantRunState.startRun("session-1", { startedAt: 100 });
      assistantRunState.markResponseCompleted("session-1", { logicalMessageId: "m1" });

      expect(assistantRunState.isFinalizationInFlight("session-1")).toBe(true);
    });

    it("is false after the final response has been published", () => {
      assistantRunState.startRun("session-1", { startedAt: 100 });
      assistantRunState.markResponseCompleted("session-1", { logicalMessageId: "m1" });
      assistantRunState.markFinalResponsePublished("session-1", { logicalMessageId: "m1" });

      expect(assistantRunState.isFinalizationInFlight("session-1")).toBe(false);
    });

    it("is false after the run is cleared", () => {
      assistantRunState.startRun("session-1", { startedAt: 100 });
      assistantRunState.markResponseCompleted("session-1", { logicalMessageId: "m1" });
      assistantRunState.clearRun("session-1", "test_clear");

      expect(assistantRunState.isFinalizationInFlight("session-1")).toBe(false);
    });

    // 2026-06-26: regression for the dropped-final-answer race. A run can complete more
    // than one assistant message (multi-step turns / multiple message.updated(completed)
    // events). Publishing the first response set hasPublishedFinalResponse=true and it was
    // never reset, so a SECOND completion reported isFinalizationInFlight=false. Busy
    // reconciliation then cleared the run mid-finalization (status_reconcile_idle), turning
    // markFinalResponsePublished into a no-op and dropping the second final answer — the
    // user saw the thinking block but no answer text. The in-flight window MUST reopen for
    // each new completion whose logical message has not yet been published.
    it("is true again when a new completion arrives after a previous response was published", () => {
      assistantRunState.startRun("session-1", { startedAt: 100 });
      assistantRunState.markResponseCompleted("session-1", { logicalMessageId: "m1" });
      assistantRunState.markVisibleFinalResponse("session-1", { logicalMessageId: "m1" });
      assistantRunState.markFinalResponsePublished("session-1", { logicalMessageId: "m1" });

      // Second completion within the same run — not yet published.
      assistantRunState.markResponseCompleted("session-1", { logicalMessageId: "m2" });

      expect(assistantRunState.isFinalizationInFlight("session-1")).toBe(true);
    });

    // 2026-07-02: regression for tool-only message triggering premature
    // finalization. When the model sends a message with tool calls but no
    // text (finish: 'tool-calls'), markResponseCompleted fires but
    // markVisibleFinalResponse / markFinalResponsePublished MUST NOT follow.
    // If they do, isFinalizationInFlight becomes false, reconciliation clears
    // the run, and the model's next turn (after tool execution) arrives to
    // a dead run — the final answer is silently dropped.
    it("stays in-flight after tool-only completion (no markVisibleFinal or markFinalPublished)", () => {
      assistantRunState.startRun("session-1", { startedAt: 100 });
      assistantRunState.markResponseCompleted("session-1", { logicalMessageId: "tool-msg-1" });

      // Tool-only completion: completionRecorded=true, but no
      // markVisibleFinalResponse / markFinalResponsePublished calls.
      // isFinalizationInFlight MUST stay true to protect against
      // reconciliation clearing the run.
      expect(assistantRunState.isFinalizationInFlight("session-1")).toBe(true);
    });
  });
});
