import { describe, expect, it, vi } from "vitest";
import {
  formatTechnicalProgressSync,
  formatTechnicalProgressWithDetails,
} from "../../src/summary/technical-progress/formatter.js";
import { deliverThinkingMessage } from "../../src/bot/utils/thinking-message.js";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe("technical progress delivery contract", () => {
  it("keeps plain tool progress available while Telegraph details are pending", async () => {
    const deferred = createDeferred<string>();
    const toolInfo = {
      sessionId: "s",
      messageId: "m",
      callId: "c",
      tool: "bash",
      state: { status: "completed" },
      input: { command: "npm test" },
      metadata: { output: "69 passed" },
    } as never;

    const plain = formatTechnicalProgressSync(toolInfo);
    const linkedPromise = formatTechnicalProgressWithDetails(toolInfo, {
      publish: vi.fn(() => deferred.promise),
    });
    let linkedSettled = false;
    void linkedPromise.then(() => {
      linkedSettled = true;
    });

    await Promise.resolve();

    expect(plain.text).toContain("npm test");
    expect(linkedSettled).toBe(false);

    deferred.resolve("https://telegra.ph/npm-test");
    await expect(linkedPromise).resolves.toEqual(
      expect.objectContaining({ format: "html", text: expect.stringContaining("telegra.ph") }),
    );
  });

  it("does not enqueue visible thinking progress when thinking messages are hidden", () => {
    const batcher = {
      enqueue: vi.fn(),
      sendTextNow: vi.fn(),
    };

    deliverThinkingMessage("s", batcher, {
      hideThinkingMessages: true,
      message: "Thinking",
    });

    expect(batcher.sendTextNow).not.toHaveBeenCalled();
    expect(batcher.enqueue).not.toHaveBeenCalled();
  });

  it("returns html format only when Telegraph link is present", async () => {
    const linked = await formatTechnicalProgressWithDetails(
      {
        sessionId: "s",
        messageId: "m",
        callId: "c",
        tool: "bash",
        state: { status: "completed" },
        input: { command: "npm test" },
        metadata: { output: "69 passed" },
      } as never,
      { publish: vi.fn().mockResolvedValue("https://telegra.ph/npm-test") },
    );
    const plain = await formatTechnicalProgressWithDetails(
      {
        sessionId: "s",
        messageId: "m",
        callId: "c",
        tool: "bash",
        state: { status: "completed" },
        input: { command: "npm test" },
        metadata: { output: "" },
      } as never,
      { publish: vi.fn().mockResolvedValue(null) },
    );

    expect(linked.format).toBe("html");
    expect(plain.format).toBeUndefined();
  });
});
