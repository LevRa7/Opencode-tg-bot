import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FloodWaitError, TelegraphClient } from "../../src/telegraph/telegraph-client.js";
import { logger } from "../../src/utils/logger.js";

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const fetchMock = vi.fn<typeof fetch>();
const warnMock = vi.mocked(logger.warn);

function client(overrides: Partial<ConstructorParameters<typeof TelegraphClient>[0]> = {}): TelegraphClient {
  return new TelegraphClient({
    enabled: true,
    accessToken: "token",
    authorName: "opencode-tg",
    timeoutMs: 3000,
    maxChars: 60000,
    ...overrides,
  });
}

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

function sentContent(): unknown {
  const requestBody = fetchMock.mock.calls[0]?.[1]?.body;
  expect(requestBody).toBeInstanceOf(URLSearchParams);
  const content = (requestBody as URLSearchParams).get("content");
  expect(content).not.toBeNull();
  return JSON.parse(content ?? "");
}

beforeEach(() => {
  fetchMock.mockReset();
  warnMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TelegraphClient", () => {
  it("publishes Telegraph nodes with plain text content and returns a valid Telegraph URL", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, result: { url: "https://telegra.ph/test", path: "test" } }));

    const result = await client().publish({ title: "npm test", body: "<hello>\nworld" });

    expect(result).toBe("https://telegra.ph/test");
    expect(sentContent()).toEqual([
      { tag: "p", children: ["<hello>", { tag: "br" }, "world"] },
    ]);
  });

  it("returns null when disabled", async () => {
    const result = await client({ enabled: false }).publish({ title: "npm test", body: "details" });

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null when API fails", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, error: "bad token" }));

    const result = await client().publish({ title: "npm test", body: "details" });

    expect(result).toBeNull();
  });

  it("logs the API error message when Telegraph response is unsuccessful", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, error: "TITLE_REQUIRED" }));

    await client().publish({ title: "npm test", body: "details" });

    expect(warnMock).toHaveBeenCalledWith(
      expect.stringContaining("TITLE_REQUIRED"),
    );
  });

  it("skips empty and whitespace-only lines when building content nodes", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, result: { url: "https://telegra.ph/test", path: "test" } }));

    await client().publish({ title: "npm test", body: "line1\n\nline2\n   \nline3" });

    expect(sentContent()).toEqual([
      { tag: "p", children: ["line1"] },
      { tag: "p", children: ["line2"] },
      { tag: "p", children: ["line3"] },
    ]);
  });

  it("returns null when returned URL host is invalid", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, result: { url: "https://example.com/test" } }));

    const result = await client().publish({ title: "npm test", body: "details" });

    expect(result).toBeNull();
  });

  it("returns null when returned Telegraph URL is not HTTPS", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, result: { url: "http://telegra.ph/test" } }));

    const result = await client().publish({ title: "npm test", body: "details" });

    expect(result).toBeNull();
  });

  it("returns null when returned Telegraph URL contains credentials", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, result: { url: "https://user:pass@telegra.ph/test" } }));

    const result = await client().publish({ title: "npm test", body: "details" });

    expect(result).toBeNull();
  });

  it("returns null without leaking sensitive fetch error details to logs", async () => {
    fetchMock.mockRejectedValueOnce(new Error("access_token=secret body=leak"));

    const result = await client().publish({ title: "npm test", body: "details" });

    expect(result).toBeNull();
    expect(JSON.stringify(warnMock.mock.calls)).not.toContain("secret");
    expect(JSON.stringify(warnMock.mock.calls)).not.toContain("leak");
  });

  it("returns null when body is empty", async () => {
    const result = await client().publish({ title: "npm test", body: "   " });

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws FloodWaitError when Telegraph returns FLOOD_WAIT", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, error: "FLOOD_WAIT_120" }));

    await expect(client().publish({ title: "npm test", body: "details" }))
      .rejects.toThrow(FloodWaitError);

    try {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, error: "FLOOD_WAIT_300" }));
      await client().publish({ title: "test", body: "content" });
    } catch (e) {
      expect(e).toBeInstanceOf(FloodWaitError);
      expect((e as FloodWaitError).waitMs).toBe(300_000);
    }
  });
});
