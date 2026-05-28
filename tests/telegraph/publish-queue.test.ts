import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelegraphPageAccumulator } from "../../src/telegraph/publish-queue.js";
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

describe("TelegraphPageAccumulator", () => {
  it("creates a page on first publish and returns URL", async () => {
    const client = mockClient();
    const acc = new TelegraphPageAccumulator(client, { flushIntervalMs: 3000, idleResetMs: 60000 });

    const url = await acc.publish({ title: "test", body: "content" });

    expect(url).toBe("https://telegra.ph/page-01");
    expect(client.createPage).toHaveBeenCalledTimes(1);
  });

  it("returns same URL for subsequent publishes without creating new pages", async () => {
    const client = mockClient();
    const acc = new TelegraphPageAccumulator(client, { flushIntervalMs: 3000, idleResetMs: 60000 });

    const url1 = await acc.publish({ title: "t1", body: "b1" });
    const url2 = await acc.publish({ title: "t2", body: "b2" });

    expect(url1).toBe(url2);
    expect(client.createPage).toHaveBeenCalledTimes(1);
  });

  it("edits the page on timer tick when dirty", async () => {
    const client = mockClient();
    const acc = new TelegraphPageAccumulator(client, { flushIntervalMs: 100, idleResetMs: 60000 });

    await acc.publish({ title: "t1", body: "b1" });
    await acc.publish({ title: "t2", body: "b2" });

    expect(client.editPage).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(150);

    expect(client.editPage).toHaveBeenCalledTimes(1);
    expect(client.editPage).toHaveBeenCalledWith(
      "page-01",
      expect.any(String),
      expect.stringContaining("t1"),
    );
  });

  it("flush() forces immediate page edit", async () => {
    const client = mockClient();
    const acc = new TelegraphPageAccumulator(client, { flushIntervalMs: 10000, idleResetMs: 60000 });

    await acc.publish({ title: "t1", body: "b1" });
    await acc.publish({ title: "t2", body: "b2" });

    await acc.flush();

    expect(client.editPage).toHaveBeenCalledTimes(1);
  });

  it("does not edit when no new sections since last flush", async () => {
    const client = mockClient();
    const acc = new TelegraphPageAccumulator(client, { flushIntervalMs: 100, idleResetMs: 60000 });

    await acc.publish({ title: "t1", body: "b1" });

    // First tick — will not edit because initial create already has content
    await vi.advanceTimersByTimeAsync(150);
    expect(client.editPage).not.toHaveBeenCalled();

    // Add new section
    await acc.publish({ title: "t2", body: "b2" });
    await vi.advanceTimersByTimeAsync(150);
    expect(client.editPage).toHaveBeenCalledTimes(1);

    // Another tick without new content — no extra edit
    await vi.advanceTimersByTimeAsync(150);
    expect(client.editPage).toHaveBeenCalledTimes(1);
  });

  it("handles FLOOD_WAIT on create gracefully", async () => {
    const client = mockClient({
      createPage: vi.fn(async () => { throw new FloodWaitError(60000); }),
    } as unknown as Partial<TelegraphClient>);
    const acc = new TelegraphPageAccumulator(client, { flushIntervalMs: 3000, idleResetMs: 60000 });

    const url = await acc.publish({ title: "t1", body: "b1" });

    expect(url).toBeNull();
  });

  it("handles FLOOD_WAIT on edit gracefully and pauses", async () => {
    const editMock = vi.fn(async () => { throw new FloodWaitError(10000); });
    const client = mockClient({
      editPage: editMock,
    } as unknown as Partial<TelegraphClient>);
    const acc = new TelegraphPageAccumulator(client, { flushIntervalMs: 100, idleResetMs: 60000 });

    await acc.publish({ title: "t1", body: "b1" });
    await acc.publish({ title: "t2", body: "b2" });

    await acc.flush();

    // After FLOOD_WAIT, further flushes are skipped
    editMock.mockResolvedValue(true);
    await acc.publish({ title: "t3", body: "b3" });
    await acc.flush();

    // Only 1 call because second flush was during cooldown
    expect(editMock).toHaveBeenCalledTimes(1);
  });

  it("resets state and creates a new page after reset()", async () => {
    const client = mockClient();
    const acc = new TelegraphPageAccumulator(client, { flushIntervalMs: 3000, idleResetMs: 60000 });

    await acc.publish({ title: "t1", body: "b1" });
    expect(client.createPage).toHaveBeenCalledTimes(1);

    acc.reset();

    (client.createPage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ url: "https://telegra.ph/page-02", path: "page-02" });
    const url = await acc.publish({ title: "t2", body: "b2" });

    expect(url).toBe("https://telegra.ph/page-02");
    expect(client.createPage).toHaveBeenCalledTimes(2);
  });

  it("accumulates sections into full page content", async () => {
    const client = mockClient();
    const acc = new TelegraphPageAccumulator(client, { flushIntervalMs: 3000, idleResetMs: 60000 });

    await acc.publish({ title: "💻 git status", body: "```\nOn branch main\n```" });
    await acc.publish({ title: "✍️ Edited file", body: "```diff\n+new\n-old\n```" });

    await acc.flush();

    const editCall = (client.editPage as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = editCall?.[2] as string;
    expect(body).toContain("💻 git status");
    expect(body).toContain("On branch main");
    expect(body).toContain("---");
    expect(body).toContain("✍️ Edited file");
    expect(body).toContain("+new");
  });

  it("auto-resets after idle period and creates new page", async () => {
    const client = mockClient();
    const acc = new TelegraphPageAccumulator(client, { flushIntervalMs: 3000, idleResetMs: 1000 });

    await acc.publish({ title: "t1", body: "b1" });
    expect(client.createPage).toHaveBeenCalledTimes(1);

    // Advance past idle threshold
    vi.advanceTimersByTime(1500);

    (client.createPage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ url: "https://telegra.ph/page-02", path: "page-02" });
    const url = await acc.publish({ title: "t2", body: "b2" });

    expect(url).toBe("https://telegra.ph/page-02");
    expect(client.createPage).toHaveBeenCalledTimes(2);
  });
});
