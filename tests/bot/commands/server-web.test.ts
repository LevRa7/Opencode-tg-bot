import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Context } from "grammy";

const mocked = vi.hoisted(() => ({
  mockGetSubdomainByUserId: vi.fn(),
  mockResolveRoute: vi.fn(),
}));

vi.mock("../../../src/server/subdomain-manager.js", () => ({
  SubdomainManager: vi.fn().mockImplementation(() => ({
    getSubdomainByUserId: mocked.mockGetSubdomainByUserId,
  })),
}));

vi.mock("../../../src/settings/manager.js", () => ({
  getSubdomainsRepository: vi.fn(() => ({})),
}));

vi.mock("../../../src/server/route-resolver.js", () => ({
  resolveOpencodeRouteForUser: mocked.mockResolveRoute,
}));

vi.mock("../../../src/process/manager.js", () => ({
  processManager: {
    stop: vi.fn(),
    start: vi.fn(),
    restartTenantRuntimes: vi.fn(),
  },
}));

vi.mock("../../../src/config.js", () => ({
  config: {
    telegram: { adminUserId: 777 },
    server: { logLevel: "error" },
  },
}));

import { serverWebCommand } from "../../../src/bot/commands/server-web.js";

function makeCtx(userId: number): Context {
  return {
    from: { id: userId },
    reply: vi.fn(),
  } as unknown as Context;
}

describe("serverWebCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when SSH is active", () => {
    it("should display SSH kind and hostname from resolved subdomain", async () => {
      mocked.mockGetSubdomainByUserId.mockReturnValue({
        userId: 999,
        kind: "ssh-host",
        subdomain: "vps.tg999",
        hostname: "vps",
        sshConnectionId: "conn-1",
      });

      mocked.mockResolveRoute.mockReturnValue({
        baseUrl: "http://127.0.0.1:49600",
        password: "ssh-pass",
        kind: "ssh-host",
      });

      const ctx = makeCtx(999);
      await serverWebCommand(ctx);

      const replyText = (ctx.reply as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as string;

      expect(replyText).toContain("ssh-host");
      expect(replyText).toContain("vps");
      expect(replyText).toContain("vps.tg999.smart-server.online");
      expect(replyText).toContain("ssh-pass");
    });

    it("should display ssh-docker kind for docker deployments", async () => {
      mocked.mockGetSubdomainByUserId.mockReturnValue({
        userId: 1000,
        kind: "ssh-docker",
        subdomain: "dockerhost.tg1000",
        hostname: "dockerhost",
        sshConnectionId: "conn-2",
      });

      mocked.mockResolveRoute.mockReturnValue({
        baseUrl: "http://127.0.0.1:49601",
        password: "docker-pass",
        kind: "ssh-docker",
      });

      const ctx = makeCtx(1000);
      await serverWebCommand(ctx);

      const replyText = (ctx.reply as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as string;

      expect(replyText).toContain("ssh-docker");
      expect(replyText).toContain("dockerhost");
      expect(replyText).toContain("dockerhost.tg1000.smart-server.online");
    });
  });

  describe("when SSH is not active", () => {
    it("should display host kind for admin user", async () => {
      mocked.mockGetSubdomainByUserId.mockReturnValue({
        userId: 777,
        kind: "host",
        subdomain: "admin",
        hostname: null,
        sshConnectionId: null,
      });

      mocked.mockResolveRoute.mockReturnValue({
        baseUrl: "http://localhost:4096",
        password: "admin-pass",
        kind: "host",
      });

      const ctx = makeCtx(777);
      await serverWebCommand(ctx);

      const replyText = (ctx.reply as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as string;

      expect(replyText).toContain("host");
      expect(replyText).toContain("https://admin.smart-server.online");
      // Hostname line should NOT be present for non-SSH
      expect(replyText).not.toMatch(/hostname/i);
    });

    it("should display tenant kind for tenant user", async () => {
      mocked.mockGetSubdomainByUserId.mockReturnValue({
        userId: 555,
        kind: "tenant",
        subdomain: "tg555",
        hostname: null,
        sshConnectionId: null,
      });

      mocked.mockResolveRoute.mockReturnValue({
        baseUrl: "http://localhost:4097",
        password: "tenant-pass",
        kind: "tenant",
      });

      const ctx = makeCtx(555);
      await serverWebCommand(ctx);

      const replyText = (ctx.reply as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as string;

      expect(replyText).toContain("tenant");
      expect(replyText).toContain("tg555.smart-server.online");
    });
  });

  describe("edge cases", () => {
    it("should show 'not configured' when no subdomain exists", async () => {
      mocked.mockGetSubdomainByUserId.mockReturnValue(null);

      const ctx = makeCtx(888);
      await serverWebCommand(ctx);

      const [replyText, options] = (ctx.reply as ReturnType<typeof vi.fn>).mock
        .calls[0] as [string, { parse_mode: string }];

      expect(replyText).toContain("not configured");
      expect(options.parse_mode).toBe("HTML");
    });

    it("should return early when userId is undefined", async () => {
      const ctx = {
        reply: vi.fn(),
      } as unknown as Context;

      await serverWebCommand(ctx);

      expect(ctx.reply).not.toHaveBeenCalled();
    });
  });
});
