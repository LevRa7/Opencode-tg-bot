import { describe, expect, it, vi } from "vitest";
import { SessionDeliveryOrchestrator } from "../../../src/bot/delivery/session-delivery-orchestrator.js";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function waitForNextTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function createDurableItem(
  sessionId: string,
  label: string,
  events: string[],
  options?: {
    eventTimeMs?: number;
    waitForLogicalMessageLiveTerminal?: string;
    logicalMessageId?: string;
    waitForLogicalMessageDurable?: string;
    deliver?: () => Promise<void>;
  },
) {
  return {
    sessionId,
    channel: "durable" as const,
    eventTimeMs: options?.eventTimeMs,
    waitForLogicalMessageLiveTerminal: options?.waitForLogicalMessageLiveTerminal,
    logicalMessageId: options?.logicalMessageId,
    waitForLogicalMessageDurable: options?.waitForLogicalMessageDurable,
    deliver:
      options?.deliver ??
      (async () => {
        events.push(`durable:${label}`);
      }),
  };
}

function createLiveItem(
  sessionId: string,
  logicalMessageId: string,
  events: string[],
  options?: {
    isTerminal?: boolean;
    deliver?: () => Promise<void>;
  },
) {
  return {
    sessionId,
    channel: "live" as const,
    logicalMessageId,
    isTerminal: options?.isTerminal,
    deliver:
      options?.deliver ??
      (async () => {
        events.push(`live:${logicalMessageId}`);
      }),
  };
}

describe("bot/delivery/session-delivery-orchestrator", () => {
  it("flushes durable items per session ordered by event time then arrival sequence", async () => {
    const events: string[] = [];
    const orchestrator = new SessionDeliveryOrchestrator();

    orchestrator.enqueue(createDurableItem("session-1", "same-time-first", events, { eventTimeMs: 200 }));
    orchestrator.enqueue(createDurableItem("session-2", "other-session", events, { eventTimeMs: 10 }));
    orchestrator.enqueue(createDurableItem("session-1", "earliest", events, { eventTimeMs: 100 }));
    orchestrator.enqueue(createDurableItem("session-1", "same-time-second", events, { eventTimeMs: 200 }));

    await orchestrator.flushSession("session-1");

    expect(events).toEqual([
      "durable:earliest",
      "durable:same-time-first",
      "durable:same-time-second",
    ]);
  });

  it("uses arrival sequence when durable items do not have event times", async () => {
    const events: string[] = [];
    const orchestrator = new SessionDeliveryOrchestrator();

    orchestrator.enqueue(createDurableItem("session-1", "first", events));
    orchestrator.enqueue(createDurableItem("session-1", "second", events));
    orchestrator.enqueue(createDurableItem("session-1", "third", events));

    await orchestrator.flushSession("session-1");

    expect(events).toEqual(["durable:first", "durable:second", "durable:third"]);
  });

  it("waits for the matching live logical message terminal before dispatching a durable item", async () => {
    const events: string[] = [];
    const liveTerminalGate = createDeferred<void>();
    const orchestrator = new SessionDeliveryOrchestrator();

    orchestrator.enqueue(
      createDurableItem("session-1", "final", events, {
        waitForLogicalMessageLiveTerminal: "message-1",
      }),
    );

    const flushTask = orchestrator.flushSession("session-1");
    await waitForNextTick();

    expect(events).toEqual([]);

    orchestrator.enqueue(
      createLiveItem("session-1", "message-1", events, {
        isTerminal: true,
        deliver: async () => {
          events.push("live:message-1:start");
          await liveTerminalGate.promise;
          events.push("live:message-1:done");
        },
      }),
    );

    await waitForNextTick();

    expect(events).toEqual(["live:message-1:start"]);

    liveTerminalGate.resolve();
    await flushTask;

    expect(events).toEqual(["live:message-1:start", "live:message-1:done", "durable:final"]);
  });

  it("lets a later durable item satisfy a same-message durable dependency", async () => {
    const events: string[] = [];
    const finalGate = createDeferred<void>();
    const orchestrator = new SessionDeliveryOrchestrator();

    orchestrator.enqueue(
      createDurableItem("session-1", "footer", events, {
        waitForLogicalMessageDurable: "message-1",
      }),
    );

    const flushTask = orchestrator.flushSession("session-1");
    await waitForNextTick();

    expect(events).toEqual([]);

    orchestrator.enqueue(
      createDurableItem("session-1", "final", events, {
        logicalMessageId: "message-1",
        deliver: async () => {
          events.push("durable:final:start");
          await finalGate.promise;
          events.push("durable:final:done");
        },
      }),
    );

    await waitForNextTick();

    expect(events).toEqual(["durable:final:start"]);

    finalGate.resolve();
    await flushTask;

    expect(events).toEqual(["durable:final:start", "durable:final:done", "durable:footer"]);
  });

  it("does not make durable delivery wait for unrelated live items", async () => {
    const events: string[] = [];
    const unrelatedLiveGate = createDeferred<void>();
    const orchestrator = new SessionDeliveryOrchestrator();

    orchestrator.enqueue(
      createLiveItem("session-1", "message-2", events, {
        deliver: async () => {
          events.push("live:message-2:start");
          await unrelatedLiveGate.promise;
          events.push("live:message-2:done");
        },
      }),
    );
    orchestrator.enqueue(createDurableItem("session-1", "final", events, { eventTimeMs: 10 }));

    await orchestrator.flushSession("session-1");

    expect(events).toEqual(["live:message-2:start", "durable:final"]);

    unrelatedLiveGate.resolve();
    await waitForNextTick();
  });

  it("continues with later durable items after one durable delivery fails", async () => {
    const events: string[] = [];
    const onError = vi.fn();
    const orchestrator = new SessionDeliveryOrchestrator({ onError });

    const firstDelivery = orchestrator.enqueue(
      createDurableItem("session-1", "first", events, {
        eventTimeMs: 100,
        deliver: async () => {
          events.push("durable:first");
          throw new Error("first failed");
        },
      }),
    );
    orchestrator.enqueue(createDurableItem("session-1", "second", events, { eventTimeMs: 200 }));

    await orchestrator.flushSession("session-1");
    await expect(firstDelivery).rejects.toThrow("first failed");

    expect(events).toEqual(["durable:first", "durable:second"]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  it("clears pending session items", async () => {
    const events: string[] = [];
    const orchestrator = new SessionDeliveryOrchestrator();

    orchestrator.enqueue(createDurableItem("session-1", "final", events, { eventTimeMs: 10 }));

    orchestrator.clearSession("session-1");
    await orchestrator.flushSession("session-1");

    expect(events).toEqual([]);
  });

  it("clears completed durable ids on normal session cleanup", async () => {
    const events: string[] = [];
    const orchestrator = new SessionDeliveryOrchestrator();

    orchestrator.enqueue(
      createDurableItem("session-1", "final", events, {
        logicalMessageId: "message-1",
      }),
    );

    await orchestrator.flushSession("session-1");
    orchestrator.clearSession("session-1");

    orchestrator.enqueue(
      createDurableItem("session-1", "footer", events, {
        waitForLogicalMessageDurable: "message-1",
      }),
    );

    const flushTask = orchestrator.flushSession("session-1");
    await waitForNextTick();

    expect(events).toEqual(["durable:final"]);

    orchestrator.clearSession("session-1");
    await flushTask;

    expect(events).toEqual(["durable:final"]);
  });

  it("resolves a waiting flush when the session is cleared", async () => {
    const events: string[] = [];
    const orchestrator = new SessionDeliveryOrchestrator();

    orchestrator.enqueue(
      createDurableItem("session-1", "final", events, {
        waitForLogicalMessageLiveTerminal: "message-1",
      }),
    );

    const flushTask = orchestrator.flushSession("session-1");
    await waitForNextTick();

    orchestrator.clearSession("session-1");

    await expect(
      Promise.race([
        flushTask.then(() => "flushed"),
        new Promise<string>((resolve) => setTimeout(() => resolve("timed_out"), 25)),
      ]),
    ).resolves.toBe("flushed");
    expect(events).toEqual([]);
  });

  it("ignores old live terminal completions after clear and waits for a new generation terminal", async () => {
    const events: string[] = [];
    const oldLiveGate = createDeferred<void>();
    const newLiveGate = createDeferred<void>();
    const orchestrator = new SessionDeliveryOrchestrator();

    orchestrator.enqueue(
      createDurableItem("session-1", "old-final", events, {
        waitForLogicalMessageLiveTerminal: "message-1",
      }),
    );

    const oldFlushTask = orchestrator.flushSession("session-1");
    await waitForNextTick();

    orchestrator.enqueue(
      createLiveItem("session-1", "message-1", events, {
        isTerminal: true,
        deliver: async () => {
          events.push("live:old:start");
          await oldLiveGate.promise;
          events.push("live:old:done");
        },
      }),
    );

    await waitForNextTick();
    orchestrator.clearSession("session-1");

    await expect(
      Promise.race([
        oldFlushTask.then(() => "flushed"),
        new Promise<string>((resolve) => setTimeout(() => resolve("timed_out"), 25)),
      ]),
    ).resolves.toBe("flushed");

    orchestrator.enqueue(
      createDurableItem("session-1", "new-final", events, {
        waitForLogicalMessageLiveTerminal: "message-1",
      }),
    );

    const newFlushTask = orchestrator.flushSession("session-1");
    await waitForNextTick();

    oldLiveGate.resolve();
    await waitForNextTick();

    expect(events).toEqual(["live:old:start", "live:old:done"]);

    orchestrator.enqueue(
      createLiveItem("session-1", "message-1", events, {
        isTerminal: true,
        deliver: async () => {
          events.push("live:new:start");
          await newLiveGate.promise;
          events.push("live:new:done");
        },
      }),
    );

    await waitForNextTick();
    expect(events).toEqual(["live:old:start", "live:old:done", "live:new:start"]);

    newLiveGate.resolve();
    await newFlushTask;

    expect(events).toEqual([
      "live:old:start",
      "live:old:done",
      "live:new:start",
      "live:new:done",
      "durable:new-final",
    ]);
  });
});
