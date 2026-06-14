import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

const { spawnMock, execMock, execSyncMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  execMock: vi.fn(),
  execSyncMock: vi.fn(),
}));

type TenantRuntimeRecord = {
  userId: number;
  chatId: number;
  port: number;
  baseUrl: string;
  pid?: number;
  startTime?: string;
  tenantId: string;
  deployTarget?: "docker" | "vm";
};

const {
  getServerProcessMock,
  setServerProcessMock,
  clearServerProcessMock,
  tenantRuntimesState,
  getTenantRuntimesMock,
  getTenantRuntimeInfoMock,
  setTenantRuntimeInfoMock,
  clearTenantRuntimeInfoMock,
  getOrCreateServerPasswordMock,
} = vi.hoisted(() => {
  const tenantRuntimesState: Record<string, TenantRuntimeRecord> = {};

  return {
    getServerProcessMock: vi.fn(),
    setServerProcessMock: vi.fn(),
    clearServerProcessMock: vi.fn(),
    tenantRuntimesState,
    getTenantRuntimesMock: vi.fn(() => tenantRuntimesState),
    getTenantRuntimeInfoMock: vi.fn((userId: number) => tenantRuntimesState[String(userId)]),
    setTenantRuntimeInfoMock: vi.fn(async (userId: number, runtimeInfo: TenantRuntimeRecord) => {
      tenantRuntimesState[String(userId)] = runtimeInfo;
    }),
    clearTenantRuntimeInfoMock: vi.fn(async (userId: number) => {
      delete tenantRuntimesState[String(userId)];
    }),
    getOrCreateServerPasswordMock: vi.fn(() => "test-vm-pw-" + Math.random().toString(36).slice(2, 8)),
  };
});

const {
  getUserDeployTargetMock,
  setUserDeployTargetMock,
  getUserVmSpecTierMock,
  setUserVmSpecTierMock,
  getVmRuntimeInfoMock,
  setVmRuntimeInfoMock,
  clearVmRuntimeInfoMock,
} = vi.hoisted(() => ({
  getUserDeployTargetMock: vi.fn(() => undefined),
  setUserDeployTargetMock: vi.fn(),
  getUserVmSpecTierMock: vi.fn(() => undefined),
  setUserVmSpecTierMock: vi.fn(),
  getVmRuntimeInfoMock: vi.fn(() => undefined),
  setVmRuntimeInfoMock: vi.fn(),
  clearVmRuntimeInfoMock: vi.fn(),
}));

const { vmManagerMock } = vi.hoisted(() => ({
  vmManagerMock: {
    isAvailable: vi.fn().mockResolvedValue(true),
    ensureBaseImage: vi.fn().mockResolvedValue({ success: true }),
    createAndStart: vi.fn(),
    stop: vi.fn().mockResolvedValue({ success: true }),
    destroy: vi.fn().mockResolvedValue({ success: true }),
    isRunning: vi.fn(),
    waitForHealth: vi.fn(),
    getBridgeIp: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("child_process", () => ({
  spawn: spawnMock,
  exec: execMock,
  execSync: execSyncMock,
}));

vi.mock("../../src/settings/manager.js", () => ({
  getOrCreateServerPassword: getOrCreateServerPasswordMock,
  getServerProcess: getServerProcessMock,
  setServerProcess: setServerProcessMock,
  clearServerProcess: clearServerProcessMock,
  getTenantRuntimes: getTenantRuntimesMock,
  getTenantRuntimeInfo: getTenantRuntimeInfoMock,
  setTenantRuntimeInfo: setTenantRuntimeInfoMock,
  clearTenantRuntimeInfo: clearTenantRuntimeInfoMock,
  getUserDeployTarget: getUserDeployTargetMock,
  setUserDeployTarget: setUserDeployTargetMock,
  getUserVmSpecTier: getUserVmSpecTierMock,
  setUserVmSpecTier: setUserVmSpecTierMock,
  getVmRuntimeInfo: getVmRuntimeInfoMock,
  setVmRuntimeInfo: setVmRuntimeInfoMock,
  clearVmRuntimeInfo: clearVmRuntimeInfoMock,
}));

vi.mock("../../src/vm/manager.js", () => ({
  vmManager: vmManagerMock,
}));

// We import after all mocks are set up so module-level deps like vmManager
// are already replaced by the time the ProcessManager constructor runs.
import { processManager } from "../../src/process/manager.js";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function createMockChildProcess(pid: number): ChildProcess {
  const processMock = new EventEmitter() as unknown as ChildProcess;

  Object.assign(processMock, {
    pid,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn().mockReturnValue(true),
  });

  return processMock;
}

/**
 * Creates a mock function that returns a fake telegram scope for user-specific tests.
 */
function createScope(userId: number, chatId: number) {
  return { userId, chatId, messageThreadId: 42 };
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("process/manager (VM support)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    spawnMock.mockReset();
    execMock.mockReset();
    execSyncMock.mockReset();
    fetchMock.mockReset();
    getServerProcessMock.mockReset();
    setServerProcessMock.mockReset();
    clearServerProcessMock.mockReset();
    getTenantRuntimesMock.mockReset();
    getTenantRuntimeInfoMock.mockReset();
    setTenantRuntimeInfoMock.mockReset();
    clearTenantRuntimeInfoMock.mockReset();
    getUserDeployTargetMock.mockReset();
    getUserVmSpecTierMock.mockReset();
    getVmRuntimeInfoMock.mockReset();
    setVmRuntimeInfoMock.mockReset();
    clearVmRuntimeInfoMock.mockReset();
    vmManagerMock.ensureBaseImage.mockReset();
    vmManagerMock.createAndStart.mockReset();
    vmManagerMock.stop.mockReset();
    vmManagerMock.destroy.mockReset();
    vmManagerMock.isRunning.mockReset();
    vmManagerMock.waitForHealth.mockReset();
    vmManagerMock.isAvailable.mockReset().mockResolvedValue(true);

    for (const key of Object.keys(tenantRuntimesState)) {
      delete tenantRuntimesState[key];
    }
    getTenantRuntimesMock.mockReturnValue(tenantRuntimesState);
    getTenantRuntimeInfoMock.mockImplementation(
      (userId: number) => tenantRuntimesState[String(userId)],
    );
    setTenantRuntimeInfoMock.mockImplementation(
      async (userId: number, runtimeInfo: TenantRuntimeRecord) => {
        tenantRuntimesState[String(userId)] = runtimeInfo;
      },
    );
    clearTenantRuntimeInfoMock.mockImplementation(async (userId: number) => {
      delete tenantRuntimesState[String(userId)];
    });

    fetchMock.mockResolvedValue({ ok: true });
    execMock.mockImplementation((_command: string, callback?: (...args: unknown[]) => void) => {
      if (callback) {
        callback(null, "", "");
      }
      return {};
    });
  });

  afterEach(() => {
    try {
      vi.runOnlyPendingTimers();
    } catch {
      // timers may not be mocked in tests that do not need them
    }
    vi.useRealTimers();
  });

  // ---- 1. ensureRuntime with deployTarget="docker" → calls ensureTenantRuntime -------------------------------------------------------
  it("ensureRuntime with deployTarget=docker delegates to tenant runtime", async () => {
    vi.useFakeTimers();
    const scope = createScope(100, 200);

    // Setup scope module inline via vi.doMock or vi.hoisted – since we can’t change
    // the import after the fact, we replace the module-level getter.
    const scopeModule = await import("../../src/telegram/scope.js");
    vi.spyOn(scopeModule, "getCurrentTelegramConversationScope").mockReturnValue(scope);

    getUserDeployTargetMock.mockReturnValue("docker");
    getTenantRuntimeInfoMock.mockReturnValue(undefined);
    spawnMock.mockReturnValue(createMockChildProcess(7778));
    fetchMock.mockResolvedValue({ ok: true });
    vi.spyOn(process, "kill").mockImplementation(() => true);

    const resultPromise = processManager.ensureRuntime();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ success: true });
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenCalledWith(
      "bash",
      expect.stringContaining("run-opencode-serve.sh"),
      expect.any(Object),
    );
    expect(vmManagerMock.ensureBaseImage).not.toHaveBeenCalled();
    expect(vmManagerMock.createAndStart).not.toHaveBeenCalled();
  });

  // ---- 2. ensureRuntime with deployTarget="vm", no tier → needsVmSpec ---------------------------------------------------------------
  it("ensureRuntime with deployTarget=vm and no tier returns needsVmSpec", async () => {
    const scope = createScope(101, 201);

    const scopeModule = await import("../../src/telegram/scope.js");
    vi.spyOn(scopeModule, "getCurrentTelegramConversationScope").mockReturnValue(scope);

    getUserDeployTargetMock.mockReturnValue("vm");
    getUserVmSpecTierMock.mockReturnValue(undefined);

    const result = await processManager.ensureRuntime();

    expect(result).toEqual({ success: false, needsVmSpec: true });
    expect(vmManagerMock.createAndStart).not.toHaveBeenCalled();
  });

  // ---- 3. ensureRuntime with deployTarget="vm", tier set, VM created → success -----------------------------------------------------
  it("ensureRuntime creates and starts a VM when tier is set", async () => {
    vi.useFakeTimers();
    const scope = createScope(102, 202);

    const scopeModule = await import("../../src/telegram/scope.js");
    vi.spyOn(scopeModule, "getCurrentTelegramConversationScope").mockReturnValue(scope);

    getUserDeployTargetMock.mockReturnValue("vm");
    getUserVmSpecTierMock.mockReturnValue("medium");
    getVmRuntimeInfoMock.mockReturnValue(undefined);

    vmManagerMock.ensureBaseImage.mockResolvedValue({ success: true });

    const vmInfo = {
      userId: 102,
      tier: "medium",
      domainName: "opencode-tg-102",
      qcow2Path: "/var/lib/libvirt/images/opencode-tg-102.qcow2",
      cloudInitIsoPath: "/var/lib/libvirt/images/cloud-init-102.iso",
      bridgeIp: "192.168.122.100",
      baseUrl: "http://192.168.122.100:4096",
      startTime: new Date().toISOString(),
      pid: null,
      sudoPassword: "sudo-secret",
    };
    vmManagerMock.createAndStart.mockResolvedValue(vmInfo);
    vmManagerMock.waitForHealth.mockResolvedValue(true);
    fetchMock.mockResolvedValue({ ok: true });

    const resultPromise = processManager.ensureRuntime();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ success: true });
    expect(vmManagerMock.ensureBaseImage).toHaveBeenCalledTimes(1);
    expect(vmManagerMock.createAndStart).toHaveBeenCalledTimes(1);
    expect(setVmRuntimeInfoMock).toHaveBeenCalledWith(102, vmInfo);
    expect(vmManagerMock.waitForHealth).toHaveBeenCalledTimes(1);
  });

  // ---- 4. ensureRuntime with deployTarget="vm", VM already running healthy → returns success immediately -----------------------------
  it("returns success immediately when VM is already healthy", async () => {
    const scope = createScope(103, 203);

    const scopeModule = await import("../../src/telegram/scope.js");
    vi.spyOn(scopeModule, "getCurrentTelegramConversationScope").mockReturnValue(scope);

    getUserDeployTargetMock.mockReturnValue("vm");
    getUserVmSpecTierMock.mockReturnValue("medium");

    const existingVmInfo = {
      userId: 103,
      tier: "medium",
      domainName: "opencode-tg-103",
      qcow2Path: "/var/lib/libvirt/images/opencode-tg-103.qcow2",
      cloudInitIsoPath: "/var/lib/libvirt/images/cloud-init-103.iso",
      bridgeIp: "192.168.122.101",
      baseUrl: "http://192.168.122.101:4096",
      startTime: new Date(Date.now() - 60_000).toISOString(),
      pid: null,
      sudoPassword: "sudo-secret-2",
    };
    getVmRuntimeInfoMock.mockReturnValue(existingVmInfo);
    vmManagerMock.isRunning.mockResolvedValue(true);
    vmManagerMock.waitForHealth.mockResolvedValue(true);

    fetchMock.mockResolvedValue({ ok: true });

    const result = await processManager.ensureRuntime();

    expect(result).toEqual({ success: true });
    // ensureBaseImage and createAndStart should NOT be called because the VM is already healthy
    expect(vmManagerMock.ensureBaseImage).not.toHaveBeenCalled();
    expect(vmManagerMock.createAndStart).not.toHaveBeenCalled();
  });

  // ---- 5. ensureRuntime with deployTarget="vm", VM dead → cleans up and recreates ---------------------------------------------------
  it("cleans up and recreates when VM is dead", async () => {
    vi.useFakeTimers();
    const scope = createScope(104, 204);

    const scopeModule = await import("../../src/telegram/scope.js");
    vi.spyOn(scopeModule, "getCurrentTelegramConversationScope").mockReturnValue(scope);

    getUserDeployTargetMock.mockReturnValue("vm");
    getUserVmSpecTierMock.mockReturnValue("small");

    const existingVmInfo = {
      userId: 104,
      tier: "small",
      domainName: "opencode-tg-104",
      qcow2Path: "/var/lib/libvirt/images/opencode-tg-104.qcow2",
      cloudInitIsoPath: "/var/lib/libvirt/images/cloud-init-104.iso",
      bridgeIp: "192.168.122.102",
      baseUrl: "http://192.168.122.102:4096",
      startTime: new Date(Date.now() - 10_000).toISOString(),
      pid: null,
      sudoPassword: "sudo-secret-3",
    };
    getVmRuntimeInfoMock.mockReturnValue(existingVmInfo);
    vmManagerMock.isRunning.mockResolvedValue(false);

    vmManagerMock.ensureBaseImage.mockResolvedValue({ success: true });

    const recreatedVmInfo = {
      userId: 104,
      tier: "small",
      domainName: "opencode-tg-104",
      qcow2Path: "/var/lib/libvirt/images/opencode-tg-104.qcow2",
      cloudInitIsoPath: "/var/lib/libvirt/images/cloud-init-104.iso",
      bridgeIp: "192.168.122.103",
      baseUrl: "http://192.168.122.103:4096",
      startTime: new Date().toISOString(),
      pid: null,
      sudoPassword: "sudo-secret-4",
    };
    vmManagerMock.createAndStart.mockResolvedValue(recreatedVmInfo);
    vmManagerMock.waitForHealth.mockResolvedValue(true);
    fetchMock.mockResolvedValue({ ok: true });

    const resultPromise = processManager.ensureRuntime();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ success: true });
    expect(vmManagerMock.isRunning).toHaveBeenCalledWith(104);
    expect(vmManagerMock.destroy).not.toHaveBeenCalled(); // no destroy on cleanup-only in ensure flow
    expect(vmManagerMock.ensureBaseImage).toHaveBeenCalledTimes(1);
    expect(vmManagerMock.createAndStart).toHaveBeenCalledTimes(1);
    expect(setVmRuntimeInfoMock).toHaveBeenCalledWith(104, recreatedVmInfo);
  });

  // ---- 6. getCurrentRuntimeInfo with deployTarget="vm" → returns kind: "vm" --------------------------------------------------------
  it("getCurrentRuntimeInfo returns kind:vm when deploy target is vm", async () => {
    const scope = createScope(105, 205);

    const scopeModule = await import("../../src/telegram/scope.js");
    vi.spyOn(scopeModule, "getCurrentTelegramConversationScope").mockReturnValue(scope);

    getUserDeployTargetMock.mockReturnValue("vm");

    const vmInfo = {
      userId: 105,
      tier: "medium",
      domainName: "opencode-tg-105",
      qcow2Path: "/var/lib/libvirt/images/opencode-tg-105.qcow2",
      cloudInitIsoPath: "/var/lib/libvirt/images/cloud-init-105.iso",
      bridgeIp: "192.168.122.105",
      baseUrl: "http://192.168.122.105:4096",
      startTime: new Date(Date.now() - 100_000).toISOString(),
      pid: null,
      sudoPassword: "sudo-secret-5",
    };
    getVmRuntimeInfoMock.mockReturnValue(vmInfo);

    const info = processManager.getCurrentRuntimeInfo();

    expect(info.kind).toBe("vm");
    expect(info.userId).toBe(105);
    expect(info.chatId).toBe(205);
    expect(info.tenantId).toBe("opencode-tg-105");
    expect(info.baseUrl).toBe("http://192.168.122.105:4096");
    expect(info.managed).toBe(true);
    expect(info.pid).toBeNull();
    expect(info.uptimeMs).toBeGreaterThanOrEqual(100_000);
  });

  // ---- 7. isRunning with deployTarget="vm" → delegates to virsh via execSync ----------------------------------------------------
  it("isRunning checks virsh via execSync when deploy target is vm", async () => {
    const scope = createScope(106, 206);

    const scopeModule = await import("../../src/telegram/scope.js");
    vi.spyOn(scopeModule, "getCurrentTelegramConversationScope").mockReturnValue(scope);

    getUserDeployTargetMock.mockReturnValue("vm");

    execSyncMock.mockReturnValue("running");
    expect(processManager.isRunning()).toBe(true);
    expect(execSyncMock).toHaveBeenCalledWith(
      "virsh domstate opencode-tg-106",
      expect.objectContaining({ encoding: "utf-8" }),
    );

    execSyncMock.mockReturnValue("shut off");
    expect(processManager.isRunning()).toBe(false);
  });

  // ---- 8. stop with deployTarget="vm" → delegates to vmManager, clears VmInfo ----------------------------------------------------
  it("stop delegates to vmManager and clears VmInfo for vm target", async () => {
    const scope = createScope(107, 207);

    const scopeModule = await import("../../src/telegram/scope.js");
    vi.spyOn(scopeModule, "getCurrentTelegramConversationScope").mockReturnValue(scope);

    getUserDeployTargetMock.mockReturnValue("vm");

    vmManagerMock.stop.mockResolvedValue({ success: true });

    const result = await processManager.stop();
    expect(result).toEqual({ success: true });
    expect(vmManagerMock.stop).toHaveBeenCalledWith(107);
    expect(clearVmRuntimeInfoMock).toHaveBeenCalledWith(107);
  });
});
