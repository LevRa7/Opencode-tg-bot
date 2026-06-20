import { describe, expect, it, vi, beforeEach } from "vitest";
import { createLibvirtHealthProxy } from "../../src/vm/health-proxy.js";

function makeHandle(overrides?: Record<string, unknown>) {
  return {
    vmId: "vm-1",
    userId: 42,
    domainName: "opencode-tg-42",
    ipv4: "10.100.0.50",
    mac: "52:54:00:ab:cd:ef",
    baseUrl: "http://10.100.0.50:4096",
    password: "testpw",
    specTier: "small",
    ...overrides,
  };
}

describe("createLibvirtHealthProxy", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns unhealthy when fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network error"));
    const proxy = createLibvirtHealthProxy({ pollMs: 100, timeoutMs: 500 });
    const result = await proxy.check(makeHandle());
    expect(result.healthy).toBe(false);
    expect(result.services.opencode).toBe(false);
    expect(result.error).toContain("timed out");
  });

  it("returns healthy when fetch returns 200", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    const proxy = createLibvirtHealthProxy({ pollMs: 100, timeoutMs: 500 });
    const result = await proxy.check(makeHandle());
    expect(result.healthy).toBe(true);
    expect(result.services.opencode).toBe(true);
  });

  it("uses Basic auth with provided password", async () => {
    let usedUrl = "";
    let usedAuth = "";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, opts) => {
      usedUrl = typeof url === "string" ? url : "";
      usedAuth = (opts?.headers as Record<string, string>)?.Authorization ?? "";
      return new Response(null, { status: 200 });
    });
    const proxy = createLibvirtHealthProxy({ pollMs: 100, timeoutMs: 500 });
    await proxy.check(makeHandle({ password: "secret" }));
    expect(usedUrl).toContain("/api/health");
    expect(usedAuth).toContain("Basic");
    const decoded = Buffer.from(usedAuth.split(" ")[1], "base64").toString();
    expect(decoded).toBe("opencode:secret");
  });

  it("respects per-call timeout", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("timeout"));
    const proxy = createLibvirtHealthProxy({ pollMs: 50, timeoutMs: 5000 });
    const start = Date.now();
    await proxy.check(makeHandle(), { timeoutMs: 200 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(3000);
  });
});
