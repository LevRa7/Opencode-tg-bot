import { describe, it, expect } from "vitest";
import { TelegraphKeyPool } from "../../src/telegraph/key-pool.js";
import { TelegraphClient } from "../../src/telegraph/telegraph-client.js";

describe("TelegraphKeyPool", () => {
  it("should return null for unknown keyId", () => {
    const pool = new TelegraphKeyPool();
    expect(pool.getClient(999)).toBeNull();
  });

  it("should return the correct client by keyId", () => {
    const pool = new TelegraphKeyPool();
    const config = { enabled: true, accessToken: "tok1", authorName: "test", timeoutMs: 3000, maxChars: 25000, translateEnabled: false } as any;
    const client1 = new TelegraphClient(config);
    const client2 = new TelegraphClient(config);
    pool.addKey(client1, 10);
    pool.addKey(client2, 20);
    expect(pool.getClient(10)).toBe(client1);
    expect(pool.getClient(20)).toBe(client2);
  });
});
