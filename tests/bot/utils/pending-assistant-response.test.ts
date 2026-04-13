import { describe, expect, it } from "vitest";
import {
  createPendingAssistantResponseStore,
  type PendingAssistantResponse,
} from "../../../src/bot/utils/pending-assistant-response.js";

describe("bot/utils/pending-assistant-response", () => {
  it("keeps only the latest completed response for a session", () => {
    const store = createPendingAssistantResponseStore();
    const first: PendingAssistantResponse = {
      messageText: "internal draft",
      reasoningText: "",
      toolCalls: [],
    };
    const second: PendingAssistantResponse = {
      messageText: "final answer",
      reasoningText: "",
      toolCalls: [],
    };

    store.set("session-1", first);
    store.set("session-1", second);

    expect(store.consume("session-1")).toEqual(second);
    expect(store.consume("session-1")).toBeNull();
  });

  it("isolates responses between sessions", () => {
    const store = createPendingAssistantResponseStore();

    store.set("session-1", {
      messageText: "first session",
      reasoningText: "",
      toolCalls: [],
    });
    store.set("session-2", {
      messageText: "second session",
      reasoningText: "",
      toolCalls: [],
    });

    expect(store.consume("session-2")?.messageText).toBe("second session");
    expect(store.consume("session-1")?.messageText).toBe("first session");
  });

  it("clears pending response without consuming it", () => {
    const store = createPendingAssistantResponseStore();

    store.set("session-1", {
      messageText: "final answer",
      reasoningText: "",
      toolCalls: [],
    });
    store.clear("session-1");

    expect(store.consume("session-1")).toBeNull();
  });
});
