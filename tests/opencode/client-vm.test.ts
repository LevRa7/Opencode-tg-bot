import { describe, expect, it, vi, beforeAll } from "vitest";

// ── Hoisted mocks (must be at module level, before any import) ──

const mockGetCurrentTelegramConversationScope = vi.hoisted(() => vi.fn());
const mockGetUserDeployTarget = vi.hoisted(() => vi.fn());
const mockGetVmRuntimeInfo = vi.hoisted(() => vi.fn());
const mockGetOrCreateServerPassword = vi.hoisted(() => vi.fn());
const mockProcessEnsureRuntime = vi.hoisted(() => vi.fn());
const mockSshIsSshActive = vi.hoisted(() => vi.fn());
const mockSshGetLocalPort = vi.hoisted(() => vi.fn());
const mockSshGetActiveConnection = vi.hoisted(() => vi.fn());
const mockSshIsBootstrapInProgress = vi.hoisted(() => vi.fn());
const mockSshIsTunnelHealthy = vi.hoisted(() => vi.fn());
const mockSshDisconnect = vi.hoisted(() => vi.fn());

vi.mock("../../src/telegram/scope.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/telegram/scope.js")>();
  return {
    ...actual,
    getCurrentTelegramConversationScope: mockGetCurrentTelegramConversationScope,
  };
});

vi.mock("../../src/settings/manager.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/settings/manager.js")>();
  return {
    ...actual,
    getUserDeployTarget: mockGetUserDeployTarget,
    getVmRuntimeInfo: mockGetVmRuntimeInfo,
    getOrCreateServerPassword: mockGetOrCreateServerPassword,
  };
});

vi.mock("../../src/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/config.js")>();
  return {
    ...actual,
    config: {
      ...actual.config,
      telegram: { ...actual.config.telegram, adminUserId: 99999 },
      opencode: { ...actual.config.opencode, apiUrl: "http://localhost:4096" },
    },
  };
});

vi.mock("../../src/process/manager.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/process/manager.js")>();
  return {
    ...actual,
    processManager: {
      ...actual.processManager,
      ensureRuntime: mockProcessEnsureRuntime,
    },
  };
});

vi.mock("../../src/utils/ssh-manager.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/ssh-manager.js")>();
  return {
    ...actual,
    sshManager: {
      ...actual.sshManager,
      isSshActive: mockSshIsSshActive,
      getLocalPort: mockSshGetLocalPort,
      getActiveConnection: mockSshGetActiveConnection,
      isBootstrapInProgress: mockSshIsBootstrapInProgress,
      isTunnelHealthy: mockSshIsTunnelHealthy,
      disconnect: mockSshDisconnect,
    },
  };
});

// ── Imports after mocks ──

import {
  getCurrentOpencodeRoute,
  ensureCurrentOpencodeRouteReady,
  NeedsDeployTargetError,
} from "../../src/opencode/client.js";

// Test user scope
const SCOPE = { userId: 42, chatId: 777 };

describe("opencode/client VM route", () => {
  beforeAll(() => {
    // Ensure SSH is never active so we don't enter SSH branch
    mockSshIsSshActive.mockReturnValue(false);
  });

  // ── getCurrentOpencodeRoute ──

  describe("getCurrentOpencodeRoute", () => {
    it("returns kind=vm with vmInfo.baseUrl when deployTarget=vm and VmInfo exists", () => {
      mockGetCurrentTelegramConversationScope.mockReturnValue(SCOPE);
      mockGetUserDeployTarget.mockReturnValue("vm");
      mockGetVmRuntimeInfo.mockReturnValue({
        userId: 42,
        tier: "small",
        domainName: "vm-42.opencode.local",
        qcow2Path: "/var/lib/libvirt/images/vm-42.qcow2",
        cloudInitIsoPath: "/var/lib/libvirt/images/vm-42-cloudinit.iso",
        bridgeIp: "192.168.122.100",
        baseUrl: "http://192.168.122.100:4096",
        startTime: "2025-01-01T00:00:00Z",
        pid: 1234,
      });
      mockGetOrCreateServerPassword.mockReturnValue("vmpass123");

      const route = getCurrentOpencodeRoute();

      expect(route.kind).toBe("vm");
      expect(route.baseUrl).toBe("http://192.168.122.100:4096");
      expect(route.userId).toBe(42);
      expect(route.chatId).toBe(777);
      expect(route.tenantId).toBe("vm-42.opencode.local");
      expect(route.password).toBe("vmpass123");
      expect(route.runtimeKey).toBe("vm:42:vm-42.opencode.local");
    });

    it("returns vm-pending route when deployTarget=vm and VmInfo is missing", () => {
      mockGetCurrentTelegramConversationScope.mockReturnValue(SCOPE);
      mockGetUserDeployTarget.mockReturnValue("vm");
      mockGetVmRuntimeInfo.mockReturnValue(undefined);
      mockGetOrCreateServerPassword.mockReturnValue("pendingpass");

      const route = getCurrentOpencodeRoute();

      expect(route.kind).toBe("vm");
      expect(route.runtimeKey).toBe("vm-pending:42");
      expect(route.baseUrl).toBe("http://localhost:4096");
      expect(route.userId).toBe(42);
      expect(route.chatId).toBe(777);
      expect(route.password).toBe("pendingpass");
    });
  });

  // ── ensureCurrentOpencodeRouteReady ──

  describe("ensureCurrentOpencodeRouteReady", () => {
    it("throws NeedsDeployTargetError when deployTarget=vm and ensureRuntime returns needsVmSpec", async () => {
      mockGetCurrentTelegramConversationScope.mockReturnValue(SCOPE);
      mockGetUserDeployTarget.mockReturnValue("vm");
      mockProcessEnsureRuntime.mockResolvedValue({
        success: false,
        needsVmSpec: true,
      });

      await expect(ensureCurrentOpencodeRouteReady()).rejects.toThrow(
        NeedsDeployTargetError,
      );
      await expect(ensureCurrentOpencodeRouteReady()).rejects.toMatchObject({
        code: "vm_spec_required",
        userId: 42,
      });
    });

    it("resolves when deployTarget=vm and ensureRuntime succeeds", async () => {
      mockGetCurrentTelegramConversationScope.mockReturnValue(SCOPE);
      mockGetUserDeployTarget.mockReturnValue("vm");
      mockProcessEnsureRuntime.mockResolvedValue({ success: true });

      await expect(ensureCurrentOpencodeRouteReady()).resolves.toBeUndefined();
    });

    it("throws generic Error when deployTarget=vm and ensureRuntime fails without needsVmSpec", async () => {
      mockGetCurrentTelegramConversationScope.mockReturnValue(SCOPE);
      mockGetUserDeployTarget.mockReturnValue("vm");
      mockProcessEnsureRuntime.mockResolvedValue({
        success: false,
        error: "disk full",
      });

      await expect(ensureCurrentOpencodeRouteReady()).rejects.toThrow(
        "disk full",
      );
    });
  });

  // ── NeedsDeployTargetError ──

  describe("NeedsDeployTargetError", () => {
    it("has correct name, code, and userId", () => {
      const err = new NeedsDeployTargetError("vm_spec_required", 42);

      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("NeedsDeployTargetError");
      expect(err.code).toBe("vm_spec_required");
      expect(err.userId).toBe(42);
    });
  });

  // ── AsyncLocalStorage scope preservation ──

  describe("getCurrentOpencodeRoute with pre-captured scope", () => {
    it("uses pre-captured scope instead of AsyncLocalStorage when provided", () => {
      // Simulate AsyncLocalStorage returning null (scope lost after execSync)
      mockGetCurrentTelegramConversationScope.mockReturnValue(null);
      mockGetUserDeployTarget.mockReturnValue("vm");
      mockGetVmRuntimeInfo.mockReturnValue({
        userId: 42,
        tier: "small",
        domainName: "vm-42.opencode.local",
        qcow2Path: "/var/lib/libvirt/images/vm-42.qcow2",
        cloudInitIsoPath: "/var/lib/libvirt/images/vm-42-cloudinit.iso",
        bridgeIp: "192.168.122.100",
        baseUrl: "http://192.168.122.100:4096",
        startTime: "2025-01-01T00:00:00Z",
        pid: 1234,
      });
      mockGetOrCreateServerPassword.mockReturnValue("vmpass123");

      // Pass pre-captured scope — should resolve correctly even though
      // AsyncLocalStorage returns null
      const route = getCurrentOpencodeRoute(SCOPE);

      expect(route.kind).toBe("vm");
      expect(route.baseUrl).toBe("http://192.168.122.100:4096");
      expect(route.userId).toBe(42);
      expect(route.runtimeKey).toBe("vm:42:vm-42.opencode.local");
    });

    it("falls back to AsyncLocalStorage when no pre-captured scope provided", () => {
      // AsyncLocalStorage returns valid scope
      mockGetCurrentTelegramConversationScope.mockReturnValue(SCOPE);
      mockGetUserDeployTarget.mockReturnValue("vm");
      mockGetVmRuntimeInfo.mockReturnValue({
        userId: 42,
        tier: "small",
        domainName: "vm-42.opencode.local",
        qcow2Path: "/var/lib/libvirt/images/vm-42.qcow2",
        cloudInitIsoPath: "/var/lib/libvirt/images/vm-42-cloudinit.iso",
        bridgeIp: "192.168.122.100",
        baseUrl: "http://192.168.122.100:4096",
        startTime: "2025-01-01T00:00:00Z",
        pid: 1234,
      });
      mockGetOrCreateServerPassword.mockReturnValue("vmpass123");

      // No pre-captured scope — should use AsyncLocalStorage
      const route = getCurrentOpencodeRoute();

      expect(route.kind).toBe("vm");
      expect(route.baseUrl).toBe("http://192.168.122.100:4096");
    });

    it("pre-captured scope prevents fallback to admin host route", () => {
      // AsyncLocalStorage returns null (scope lost)
      mockGetCurrentTelegramConversationScope.mockReturnValue(null);
      mockGetUserDeployTarget.mockReturnValue("vm");
      mockGetVmRuntimeInfo.mockReturnValue({
        userId: 42,
        tier: "small",
        domainName: "vm-42.opencode.local",
        qcow2Path: "/var/lib/libvirt/images/vm-42.qcow2",
        cloudInitIsoPath: "/var/lib/libvirt/images/vm-42-cloudinit.iso",
        bridgeIp: "192.168.122.100",
        baseUrl: "http://192.168.122.100:4096",
        startTime: "2025-01-01T00:00:00Z",
        pid: 1234,
      });
      mockGetOrCreateServerPassword.mockReturnValue("vmpass123");

      // Without pre-captured scope, null scope → admin host route
      const routeWithoutScope = getCurrentOpencodeRoute();
      expect(routeWithoutScope.runtimeKey).toBe("host");

      // With pre-captured scope → correct VM route
      const routeWithScope = getCurrentOpencodeRoute(SCOPE);
      expect(routeWithScope.runtimeKey).toBe("vm:42:vm-42.opencode.local");
    });
  });

  // ── VM route ensures all API calls go to VM, not host ──

  describe("VM route isolation", () => {
    it("VM route baseUrl differs from config.opencode.apiUrl", () => {
      mockGetCurrentTelegramConversationScope.mockReturnValue(SCOPE);
      mockGetUserDeployTarget.mockReturnValue("vm");
      mockGetVmRuntimeInfo.mockReturnValue({
        userId: 42,
        tier: "medium",
        domainName: "vm-42.opencode.local",
        qcow2Path: "/var/lib/libvirt/images/vm-42.qcow2",
        cloudInitIsoPath: "/var/lib/libvirt/images/vm-42-cloudinit.iso",
        bridgeIp: "10.100.0.55",
        baseUrl: "http://10.100.0.55:4096",
        startTime: "2025-01-01T00:00:00Z",
        pid: 1234,
      });
      mockGetOrCreateServerPassword.mockReturnValue("vmsecret");

      const route = getCurrentOpencodeRoute();

      // VM route must NOT point to host server
      expect(route.baseUrl).not.toBe("http://localhost:4096");
      expect(route.baseUrl).toBe("http://10.100.0.55:4096");
      expect(route.password).toBe("vmsecret");
      expect(route.kind).toBe("vm");
    });

    it("VM pending route still uses different password from admin", () => {
      mockGetCurrentTelegramConversationScope.mockReturnValue(SCOPE);
      mockGetUserDeployTarget.mockReturnValue("vm");
      mockGetVmRuntimeInfo.mockReturnValue(undefined);
      mockGetOrCreateServerPassword.mockReturnValue("user-vm-password");

      const vmPending = getCurrentOpencodeRoute();

      // Admin route with the same scope but different password
      mockGetOrCreateServerPassword.mockReturnValue("admin-password");
      const adminRoute = getCurrentOpencodeRoute({ userId: 99999, chatId: 0 } as any);

      expect(vmPending.password).toBe("user-vm-password");
      // Admin route should have different password
      expect(vmPending.password).not.toBe("admin-password");
    });

    it("deployTarget=docker routes to tenant, not vm", () => {
      mockGetCurrentTelegramConversationScope.mockReturnValue(SCOPE);
      mockGetUserDeployTarget.mockReturnValue("docker");

      const route = getCurrentOpencodeRoute();

      // Docker users go through tenant runtime, not VM
      expect(route.kind).not.toBe("vm");
      expect(route.runtimeKey).not.toContain("vm");
    });
  });
});
