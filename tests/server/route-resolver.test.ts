import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSsh } = vi.hoisted(() => ({
  mockSsh: {
    isSshActive: vi.fn(() => false),
    getLocalPort: vi.fn(() => undefined),
    getActiveConnection: vi.fn(() => undefined),
    isBootstrapInProgress: vi.fn(() => false),
  },
}));

vi.mock("../../src/config.js", () => ({
  config: {
    telegram: { adminUserId: 777 },
    opencode: { apiUrl: "http://localhost:4096", username: "opencode", password: "test123" },
    server: { logLevel: "error" },
  },
}));

vi.mock("../../src/settings/manager.js", () => {
  const passwords = new Map<number, string>();
  passwords.set(777, "admin-pass");
  return {
    getOrCreateServerPassword: vi.fn((userId: number) => {
      if (passwords.has(userId)) return passwords.get(userId);
      return "auto-pass-" + userId;
    }),
    getTenantRuntimeInfo: vi.fn(() => null),
  };
});

vi.mock("../../src/utils/ssh-manager.js", () => ({
  sshManager: mockSsh,
}));

import { resolveOpencodeRouteForUser } from "../../src/server/route-resolver.js";

describe("resolveOpencodeRouteForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should resolve admin user to host route", () => {
    const route = resolveOpencodeRouteForUser(777);
    expect(route).toBeDefined();
    expect(route!.baseUrl).toBe("http://localhost:4096");
    expect(route!.kind).toBe("host");
    expect(route!.password).toBe("admin-pass");
  });

  it("should resolve SSH user to tunnel route", () => {
    mockSsh.isSshActive.mockReturnValue(true);
    mockSsh.getLocalPort.mockReturnValue(49600);
    mockSsh.getActiveConnection.mockReturnValue({
      opencodePassword: "ssh-pass",
      client: {},
      server: {},
      localPort: 49600,
      remotePort: 49601,
      details: { host: "remote", port: 22, username: "root" },
      deployTarget: "host",
    });

    const route = resolveOpencodeRouteForUser(999);
    expect(route).toBeDefined();
    expect(route!.baseUrl).toBe("http://127.0.0.1:49600");
    expect(route!.kind).toBe("ssh-host");
    expect(route!.password).toBe("ssh-pass");
  });

  it("should mark SSH docker as ssh-docker kind", () => {
    mockSsh.isSshActive.mockReturnValue(true);
    mockSsh.getLocalPort.mockReturnValue(49601);
    mockSsh.getActiveConnection.mockReturnValue({
      opencodePassword: "docker-pass",
      deployTarget: "docker",
    });

    const route = resolveOpencodeRouteForUser(1000);
    expect(route!.kind).toBe("ssh-docker");
  });

  it("should return null for unknown user with no tenant", () => {
    const route = resolveOpencodeRouteForUser(888);
    expect(route).toBeNull();
  });

  it("should resolve tenant user when tenantRuntime exists", async () => {
    const { getTenantRuntimeInfo } = await import("../../src/settings/manager.js");
    vi.mocked(getTenantRuntimeInfo).mockReturnValue({
      userId: 555,
      chatId: 1,
      port: 4097,
      baseUrl: "http://localhost:4097",
      tenantId: "tenant-555",
    });

    const route = resolveOpencodeRouteForUser(555);
    expect(route).toBeDefined();
    expect(route!.baseUrl).toBe("http://localhost:4097");
    expect(route!.kind).toBe("tenant");
  });
});
