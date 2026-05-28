import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelegraphPublishQueue } from "../../src/telegraph/publish-queue.js";
import { FloodWaitError, TelegraphClient } from "../../src/telegraph/telegraph-client.js";

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function mockClient(overrides?: Partial<TelegraphClient>): TelegraphClient {
  return {
    createPage: vi.fn(async () => ({ url: "https://telegra.ph/page-01", path: "page-01" })),
    editPage: vi.fn(async () => true),
    publish: vi.fn(async () => "https://telegra.ph/page-01"),
    flush: vi.fn(async () => {}),
    reset: vi.fn(),
    ...overrides,
  } as unknown as TelegraphClient;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TelegraphPublishQueue", () => {
  it("forwards publish requests to upstream and returns a unique URL per call", async () => {
    const client = mockClient({
      publish: vi.fn()
        .mockResolvedValueOnce("https://telegra.ph/page-01")
        .mockResolvedValueOnce("https://telegra.ph/page-02"),
    });
    const queue = new TelegraphPublishQueue(client, { minIntervalMs: 10 });

    const p1 = queue.publish({ title: "t1", body: "b1" });
    const p2 = queue.publish({ title: "t2", body: "b2" });

    await vi.runAllTimersAsync();
    const [url1, url2] = await Promise.all([p1, p2]);

    expect(url1).toBe("https://telegra.ph/page-01");
    expect(url2).toBe("https://telegra.ph/page-02");
    expect(client.publish).toHaveBeenCalledTimes(2);
  });

  it("processes requests sequentially with minimum interval", async () => {
    const calls: number[] = [];
    const client = mockClient({
      publish: vi.fn(async () => {
        calls.push(Date.now());
        return "https://telegra.ph/page";
      }),
    });
    const queue = new TelegraphPublishQueue(client, { minIntervalMs: 100, maxQueueSize: 5 });

    const p1 = queue.publish({ title: "t1", body: "b1" });
    const p2 = queue.publish({ title: "t2", body: "b2" });

    await vi.runAllTimersAsync();
    await Promise.all([p1, p2]);

    expect(calls.length).toBe(2);
    expect(calls[1]! - calls[0]!).toBeGreaterThanOrEqual(100);
  });

  it("opens circuit breaker on FloodWaitError and drains queue", async () => {
    const client = mockClient({
      publish: vi.fn(async () => { throw new FloodWaitError(60000); }),
    });
    const queue = new TelegraphPublishQueue(client, { circuitBreakerThreshold: 1, minIntervalMs: 10 });

    const p1 = queue.publish({ title: "t1", body: "b1" });
    const p2 = queue.publish({ title: "t2", body: "b2" });

    await vi.runAllTimersAsync();
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toBeNull();
    expect(r2).toBeNull();
    expect(queue.isOpen).toBe(true);
  });

  it("rejects new requests while circuit is open", async () => {
    const client = mockClient({
      publish: vi.fn(async () => { throw new FloodWaitError(60000); }),
    });
    const queue = new TelegraphPublishQueue(client, { circuitBreakerThreshold: 1, minIntervalMs: 10 });

    const p1 = queue.publish({ title: "t1", body: "b1" });
    await vi.runAllTimersAsync();
    await p1;

    expect(queue.isOpen).toBe(true);

    const result = await queue.publish({ title: "t2", body: "b2" });
    expect(result).toBeNull();
  });

  it("recovers after circuit breaker cooldown", async () => {
    let shouldFail = true;
    const client = mockClient({
      publish: vi.fn(async () => {
        if (shouldFail) throw new FloodWaitError(500);
        return "https://telegra.ph/recovered";
      }),
    });
    const queue = new TelegraphPublishQueue(client, {
      circuitBreakerThreshold: 1,
      circuitBreakerCooldownMs: 500,
      minIntervalMs: 10,
    });

    const p1 = queue.publish({ title: "t1", body: "b1" });
    await vi.runAllTimersAsync();
    await p1;

    expect(queue.isOpen).toBe(true);

    shouldFail = false;
    vi.advanceTimersByTime(600);

    const p2 = queue.publish({ title: "t2", body: "b2" });
    await vi.runAllTimersAsync();
    const result = await p2;

    expect(result).toBe("https://telegra.ph/recovered");
    expect(queue.isOpen).toBe(false);
  });

  it("drops oldest requests on queue overflow", async () => {
    let blocked = true;
    const client = mockClient({
      publish: vi.fn(async () => {
        while (blocked) await new Promise((r) => setTimeout(r, 10));
        return "https://telegra.ph/page";
      }),
    });
    const queue = new TelegraphPublishQueue(client, { maxQueueSize: 3, minIntervalMs: 10 });

    const promises = Array.from({ length: 5 }, (_, i) =>
      queue.publish({ title: `t${i}`, body: `b${i}` }),
    );

    blocked = false;
    await vi.runAllTimersAsync();
    const results = await Promise.all(promises);

    const nullCount = results.filter((r) => r === null).length;
    expect(nullCount).toBeGreaterThanOrEqual(1);
  });

  it("returns null for pending requests on reset", async () => {
    let resolveLater: () => void;
    const waitPromise = new Promise<void>((r) => { resolveLater = r; });
    const client = mockClient({
      publish: vi.fn(async () => {
        await waitPromise;
        return "https://telegra.ph/page";
      }),
    });
    const queue = new TelegraphPublishQueue(client, { minIntervalMs: 10 });

    const p1 = queue.publish({ title: "t1", body: "b1" });
    const p2 = queue.publish({ title: "t2", body: "b2" });

    queue.reset();
    resolveLater!();
    await vi.runAllTimersAsync();

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r2).toBeNull();
  });

  it("resets failure counter on successful publish", async () => {
    let failCount = 0;
    const client = mockClient({
      publish: vi.fn(async () => {
        failCount++;
        if (failCount <= 2) return null;
        return "https://telegra.ph/page";
      }),
    });
    const queue = new TelegraphPublishQueue(client, {
      circuitBreakerThreshold: 5,
      minIntervalMs: 10,
    });

    const promises = Array.from({ length: 3 }, (_, i) =>
      queue.publish({ title: `t${i}`, body: `b${i}` }),
    );

    await vi.runAllTimersAsync();
    const results = await Promise.all(promises);

    expect(results[2]).toBe("https://telegra.ph/page");
    expect(queue.isOpen).toBe(false);
  });
});
