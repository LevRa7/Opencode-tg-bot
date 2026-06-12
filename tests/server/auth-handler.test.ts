import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

const BOT_TOKEN = "123456:ABC-DEF";

function createTestInitData(userId: number, username?: string): string {
  const userObj: Record<string, unknown> = { id: userId, first_name: "Test" };
  if (username) userObj.username = username;

  const fields = new URLSearchParams();
  fields.set("query_id", "query123");
  fields.set("user", JSON.stringify(userObj));
  fields.set("auth_date", String(Math.floor(Date.now() / 1000)));

  const dataCheckString = Array.from(fields.entries())
    .filter(([k]) => k !== "hash")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  fields.set("hash", hash);

  return fields.toString();
}

describe("handleAuthRequest", () => {
  const mockEnsureSubdomain = vi.fn();
  const mockGetSubdomainByUserId = vi.fn();
  const mockResolveRoute = vi.fn();
  const mockRepoGetByUserId = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    vi.doMock("../../src/config.js", () => ({
      config: {
        telegram: {
          token: BOT_TOKEN,
          adminUserId: 777,
          allowedUserIds: [999, 1000, 555, 888],
        },
        server: { logLevel: "error" },
      },
    }));

    vi.doMock("../../src/settings/manager.js", () => ({
      getApprovedTelegramUserIds: vi.fn(() => []),
      getSubdomainsRepository: vi.fn(() => ({
        getByUserId: mockRepoGetByUserId,
      })),
    }));

    vi.doMock("../../src/server/subdomain-manager.js", () => ({
      SubdomainManager: vi.fn().mockImplementation(() => ({
        ensureSubdomain: mockEnsureSubdomain,
        getSubdomainByUserId: mockGetSubdomainByUserId,
      })),
    }));

    vi.doMock("../../src/server/route-resolver.js", () => ({
      resolveOpencodeRouteForUser: mockResolveRoute,
    }));
  });

  async function invokeHandleAuthRequest(
    initData: string,
  ): Promise<{ status: number; body: string }> {
    const { handleAuthRequest } = await import(
      "../../src/server/auth-handler.js"
    );
    return handleAuthRequest(JSON.stringify({ initData }));
  }

  describe("when SSH is active", () => {
    it("should not call ensureSubdomain (preserves SSH kind in DB)", async () => {
      // Current (broken) code WILL call ensureSubdomain with "host", which
      // overwrites the SSH kind. This test must FAIL until fixed.
      mockResolveRoute.mockReturnValue({
        baseUrl: "http://127.0.0.1:49600",
        password: "ssh-pass",
        kind: "ssh-host",
      });

      // The repo returns an SSH subdomain record
      mockRepoGetByUserId.mockReturnValue({
        user_id: 999,
        username: "tg999",
        subdomain: "vps.tg999",
        kind: "ssh-host",
        hostname: "vps",
        ssh_connection_id: "conn-1",
        created_at: "2026-01-01",
      });

      mockGetSubdomainByUserId.mockReturnValue({
        userId: 999,
        kind: "ssh-host",
        subdomain: "vps.tg999",
        hostname: "vps",
        sshConnectionId: "conn-1",
      });

      // Simulate the broken ensureSubdomain returning "host" kind
      mockEnsureSubdomain.mockReturnValue({
        userId: 999,
        username: "tg999",
        subdomain: "vps.tg999",
        kind: "host",
        hostname: null,
      });

      const response = await invokeHandleAuthRequest(
        createTestInitData(999, "tg999"),
      );

      // ensureSubdomain must NOT be called when SSH is active
      expect(mockEnsureSubdomain).not.toHaveBeenCalled();

      expect(response.status).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.subdomain).toBe("vps.tg999.smart-server.online");
      expect(body.username).toBe("tg999");
      expect(body.password).toBe("ssh-pass");
      expect(body.authenticated).toBe(true);
    });

    it("should preserve SSH kind when SSH is active and deployment is docker", async () => {
      mockResolveRoute.mockReturnValue({
        baseUrl: "http://127.0.0.1:49601",
        password: "docker-pass",
        kind: "ssh-docker",
      });

      mockRepoGetByUserId.mockReturnValue({
        user_id: 1000,
        username: "tg1000",
        subdomain: "dockerhost.tg1000",
        kind: "ssh-docker",
        hostname: "dockerhost",
        ssh_connection_id: "conn-2",
        created_at: "2026-01-01",
      });

      mockGetSubdomainByUserId.mockReturnValue({
        userId: 1000,
        kind: "ssh-docker",
        subdomain: "dockerhost.tg1000",
        hostname: "dockerhost",
        sshConnectionId: "conn-2",
      });

      mockEnsureSubdomain.mockReturnValue({
        userId: 1000,
        username: "tg1000",
        subdomain: "dockerhost.tg1000",
        kind: "host",
        hostname: null,
      });

      const response = await invokeHandleAuthRequest(
        createTestInitData(1000, "tg1000"),
      );

      expect(mockEnsureSubdomain).not.toHaveBeenCalled();

      const body = JSON.parse(response.body);
      expect(body.subdomain).toBe("dockerhost.tg1000.smart-server.online");
      expect(body.password).toBe("docker-pass");
    });
  });

  describe("when SSH is not active", () => {
    it("should call ensureSubdomain with kind host for admin user", async () => {
      mockResolveRoute.mockReturnValue({
        baseUrl: "http://localhost:4096",
        password: "admin-pass",
        kind: "host",
      });

      mockEnsureSubdomain.mockReturnValue({
        userId: 777,
        username: "admin",
        subdomain: "admin",
        kind: "host",
      });

      const response = await invokeHandleAuthRequest(
        createTestInitData(777, "admin"),
      );

      // Current code passes "host" hardcoded — admin gets "host" too, so this passes already.
      // After the fix, it should still get "host" from the route.
      expect(mockEnsureSubdomain).toHaveBeenCalledWith(777, "admin", "host");
      expect(response.status).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.subdomain).toBe("admin.smart-server.online");
      expect(body.password).toBe("admin-pass");
    });

    it("should call ensureSubdomain with kind tenant for tenant user", async () => {
      mockResolveRoute.mockReturnValue({
        baseUrl: "http://localhost:4097",
        password: "tenant-pass",
        kind: "tenant",
      });

      mockEnsureSubdomain.mockReturnValue({
        userId: 555,
        username: "tg555",
        subdomain: "tg555",
        kind: "tenant",
      });

      const response = await invokeHandleAuthRequest(
        createTestInitData(555, "tg555"),
      );

      // Current (broken) code passes "host" for everyone — this must FAIL.
      expect(mockEnsureSubdomain).toHaveBeenCalledWith(555, "tg555", "tenant");
      expect(response.status).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.password).toBe("tenant-pass");
    });

    it("should call ensureSubdomain with kind host when route is null (fallback)", async () => {
      mockResolveRoute.mockReturnValue(null);

      mockEnsureSubdomain.mockReturnValue({
        userId: 888,
        username: "tg888",
        subdomain: "tg888",
        kind: "host",
      });

      const response = await invokeHandleAuthRequest(
        createTestInitData(888, "tg888"),
      );

      expect(mockEnsureSubdomain).toHaveBeenCalledWith(888, "tg888", "host");
      expect(response.status).toBe(200);
    });
  });
});
