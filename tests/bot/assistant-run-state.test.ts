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
});
