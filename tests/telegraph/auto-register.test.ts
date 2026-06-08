import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureUserKeys } from "../../src/telegraph/auto-register.js";

describe("ensureUserKeys", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should create accounts when fewer than 5 keys exist", async () => {
    const repo = {
      countByUser: vi.fn().mockReturnValue(0),
      insert: vi.fn(),
      getAllByUser: vi.fn().mockReturnValue([]),
    };
    const mockResponse = { ok: true, result: { access_token: "new-token-xxx" } };
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    await ensureUserKeys(
      repo as any,
      1,
      { authorName: "opencode-tg", timeoutMs: 3000 },
      Buffer.alloc(32),
      5,
    );

    expect(repo.countByUser).toHaveBeenCalledWith(1);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(repo.insert).toHaveBeenCalledTimes(5);
  });

  it("should skip creation when 5 keys already exist", async () => {
    const repo = {
      countByUser: vi.fn().mockReturnValue(5),
      insert: vi.fn(),
      getAllByUser: vi.fn().mockReturnValue([]),
    };

    await ensureUserKeys(
      repo as any,
      1,
      { authorName: "opencode-tg", timeoutMs: 3000 },
      Buffer.alloc(32),
      5,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(repo.insert).not.toHaveBeenCalled();
  });
});
