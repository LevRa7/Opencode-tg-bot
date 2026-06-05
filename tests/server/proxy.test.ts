import { describe, it, expect, vi } from "vitest";

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
    telegram: { adminUserId: 777, allowedUserIds: [] },
    opencode: { apiUrl: "http://localhost:4096", username: "opencode", password: "test" },
    server: { logLevel: "error" },
  },
}));

vi.mock("../../src/settings/manager.js", () => ({
  getApprovedTelegramUserIds: vi.fn(() => []),
  getOrCreateServerPassword: vi.fn(() => "admin-pass"),
  getTenantRuntimeInfo: vi.fn(() => null),
  getSubdomainsRepository: vi.fn(() => ({
    getBySubdomain: vi.fn((s: string) => {
      if (s === "lev") return {
        user_id: 777, username: "lev", subdomain: "lev",
        kind: "host", created_at: "2026-01-01",
        hostname: null, ssh_connection_id: null,
      };
      if (s === "vps.ivan") return {
        user_id: 999, username: "ivan", subdomain: "vps.ivan",
        kind: "ssh-host", hostname: "vps",
        ssh_connection_id: "conn-1", created_at: "2026-01-01",
      };
      return null;
    }),
    getByUserId: vi.fn(),
    upsert: vi.fn(),
    deleteByUserId: vi.fn(),
  })),
}));

vi.mock("../../src/utils/ssh-manager.js", () => ({ sshManager: mockSsh }));

import { resolveProxyTarget } from "../../src/server/proxy.js";

describe("resolveProxyTarget", () => {
  it("should resolve host subdomain to OpenCode URL with Basic auth", () => {
    const target = resolveProxyTarget("lev.smart-server.online");
    expect(target).toBeDefined();
    expect(target!.baseUrl).toBe("http://localhost:4096");
    expect(target!.authHeader).toMatch(/^Basic /);
  });

  it("should resolve SSH subdomain", () => {
    mockSsh.isSshActive.mockReturnValue(true);
    mockSsh.getLocalPort.mockReturnValue(49600);
    mockSsh.getActiveConnection.mockReturnValue({
      opencodePassword: "ssh-pass", deployTarget: "host",
    });

    const target = resolveProxyTarget("vps.ivan.smart-server.online");
    expect(target).toBeDefined();
    expect(target!.baseUrl).toBe("http://127.0.0.1:49600");
  });

  it("should return null for unknown subdomain", () => {
    expect(resolveProxyTarget("unknown.smart-server.online")).toBeNull();
  });

  it("should return null for localhost", () => {
    expect(resolveProxyTarget("localhost:80")).toBeNull();
  });
});
