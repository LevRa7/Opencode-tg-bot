import { describe, it, expect, vi, beforeEach } from "vitest";
import { MultiKeyClient } from "../../src/telegraph/multi-key-client.js";
import { TelegraphKeyPool } from "../../src/telegraph/key-pool.js";
import { TelegraphClient, FloodWaitError } from "../../src/telegraph/telegraph-client.js";

const MOCK_CONFIG = { authorName: "test", timeoutMs: 3000, maxChars: 25000 };

function createMockClient(returnUrl: string | null, failWithFlood = false) {
  const client = {
    createPage: vi.fn().mockImplementation(async () => {
      if (failWithFlood) {
        throw new FloodWaitError(30000);
      }
      if (returnUrl === null) return null;
      return { url: returnUrl, path: returnUrl.replace("https://telegra.ph/", "") };
    }),
    editPage: vi.fn().mockResolvedValue(true),
    publish: vi.fn().mockResolvedValue(returnUrl),
    flush: vi.fn(),
    reset: vi.fn(),
  } as unknown as TelegraphClient;
  return client;
}

describe("MultiKeyClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should create a page using the available key", async () => {
    const pool = new TelegraphKeyPool();
    const client1 = createMockClient("https://telegra.ph/test-1");
    pool.addKey(client1, 1);

    const bindingsRepo = {
      insert: vi.fn(),
      getByPath: vi.fn().mockReturnValue(undefined),
    };

    const mkc = new MultiKeyClient(pool, bindingsRepo as any, MOCK_CONFIG);
    const result = await mkc.publish({ title: "Test", body: "Hello" });
    expect(result).toBe("https://telegra.ph/test-1");
    expect(bindingsRepo.insert).toHaveBeenCalledWith({ userId: 0, path: "test-1", keyId: 1 });
  });

  it("should skip flooded keys and try next", async () => {
    const pool = new TelegraphKeyPool();
    const floodClient = createMockClient(null, true);
    const goodClient = createMockClient("https://telegra.ph/test-2");
    pool.addKey(floodClient, 1);
    pool.addKey(goodClient, 2);

    const bindingsRepo = {
      insert: vi.fn(),
      getByPath: vi.fn().mockReturnValue(undefined),
    };

    const mkc = new MultiKeyClient(pool, bindingsRepo as any, MOCK_CONFIG);
    const result = await mkc.publish({ title: "Test", body: "Hello" });
    expect(result).toBe("https://telegra.ph/test-2");
    expect(bindingsRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ keyId: 2 }));
  });

  it("should return null when all keys are exhausted", async () => {
    const pool = new TelegraphKeyPool();
    const flood1 = createMockClient(null, true);
    const flood2 = createMockClient(null, true);
    pool.addKey(flood1, 1);
    pool.addKey(flood2, 2);

    const bindingsRepo = {
      insert: vi.fn(),
      getByPath: vi.fn().mockReturnValue(undefined),
    };

    const mkc = new MultiKeyClient(pool, bindingsRepo as any, MOCK_CONFIG);
    const result = await mkc.publish({ title: "Test", body: "Hello" });
    expect(result).toBeNull();
  });

  it("should edit a page using the same key that created it", async () => {
    const pool = new TelegraphKeyPool();
    const client1 = createMockClient("https://telegra.ph/test-1");
    const client2 = createMockClient("https://telegra.ph/test-2");
    pool.addKey(client1, 1);
    pool.addKey(client2, 2);

    const bindingsRepo = {
      insert: vi.fn(),
      getByPath: vi.fn().mockReturnValue({ key_id: 1, user_id: 1 }),
    };

    const mkc = new MultiKeyClient(pool, bindingsRepo as any, MOCK_CONFIG);
    const result = await mkc.editPage("test-1", "Updated", "New body");
    expect(result).toBe(true);
    expect(client1.editPage).toHaveBeenCalledWith("test-1", "Updated", "New body");
    expect(client2.editPage).not.toHaveBeenCalled();
  });

  it("should create a new page when no binding exists for edit", async () => {
    const pool = new TelegraphKeyPool();
    const client1 = createMockClient("https://telegra.ph/new-page");
    pool.addKey(client1, 1);

    const bindingsRepo = {
      insert: vi.fn(),
      getByPath: vi.fn().mockReturnValue(undefined),
    };

    const mkc = new MultiKeyClient(pool, bindingsRepo as any, MOCK_CONFIG);
    const result = await mkc.editPage("unknown-path", "New", "Content");
    expect(result).toBe(true);
    expect(client1.createPage).toHaveBeenCalled();
  });
});
