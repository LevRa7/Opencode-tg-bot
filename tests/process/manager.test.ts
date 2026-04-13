import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

const { spawnMock, execMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  execMock: vi.fn(),
}));

type TenantRuntimeRecord = {
  userId: number;
  chatId: number;
  port: number;
  baseUrl: string;
  pid?: number;
  startTime?: string;
  tenantId: string;
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
  };
});

vi.mock("child_process", () => ({
  spawn: spawnMock,
  exec: execMock,
}));

vi.mock("../../src/settings/manager.js", () => ({
  getServerProcess: getServerProcessMock,
  setServerProcess: setServerProcessMock,
  clearServerProcess: clearServerProcessMock,
  getTenantRuntimes: getTenantRuntimesMock,
  setTenantRuntimeInfo: setTenantRuntimeInfoMock,
  clearTenantRuntimeInfo: clearTenantRuntimeInfoMock,
}));

import { processManager } from "../../src/process/manager.js";

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

function setPlatform(platform: NodeJS.Platform): () => void {
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", { value: platform, configurable: true });

  return () => {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  };
}

describe("process/manager", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    spawnMock.mockReset();
    execMock.mockReset();
    fetchMock.mockReset();
    getServerProcessMock.mockReset();
    setServerProcessMock.mockReset();
    clearServerProcessMock.mockReset();
    getTenantRuntimesMock.mockReset();
    setTenantRuntimeInfoMock.mockReset();
    clearTenantRuntimeInfoMock.mockReset();
    for (const key of Object.keys(tenantRuntimesState)) {
      delete tenantRuntimesState[key];
    }
    getTenantRuntimesMock.mockReturnValue(tenantRuntimesState);
    getTenantRuntimeInfoMock.mockImplementation((userId: number) => tenantRuntimesState[String(userId)]);
    setTenantRuntimeInfoMock.mockImplementation(async (userId: number, runtimeInfo: TenantRuntimeRecord) => {
      tenantRuntimesState[String(userId)] = runtimeInfo;
    });
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

  it("restores running process from settings on initialize", async () => {
    getServerProcessMock.mockReturnValue({
      pid: 321,
      startTime: new Date(Date.now() - 10_000).toISOString(),
    });
    vi.spyOn(process, "kill").mockImplementation(() => true);

    await processManager.initialize();

    expect(getServerProcessMock).toHaveBeenCalledTimes(1);
    expect(clearServerProcessMock).not.toHaveBeenCalled();
    expect(processManager.isRunning()).toBe(true);
    expect(processManager.getPID()).toBe(321);
    expect(processManager.getUptime()).toBeTypeOf("number");
  });

  it("cleans dead saved process on initialize", async () => {
    getServerProcessMock.mockReturnValue({
      pid: 322,
      startTime: new Date().toISOString(),
    });
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });

    await processManager.initialize();

    expect(clearServerProcessMock).toHaveBeenCalledTimes(1);
    expect(processManager.isRunning()).toBe(false);
    expect(processManager.getPID()).toBeNull();
  });

  it("starts process, waits for health, and persists PID", async () => {
    const restorePlatform = setPlatform("win32");
    vi.spyOn(process, "kill").mockImplementation(() => true);
    spawnMock.mockReturnValue(createMockChildProcess(456));
    fetchMock
      .mockRejectedValueOnce(new Error("not ready"))
      .mockResolvedValueOnce({ ok: true });

    try {
      const result = await processManager.start();

      expect(result).toEqual({ success: true });
      expect(spawnMock).toHaveBeenCalledWith(
        "cmd.exe",
        ["/c", "opencode", "serve"],
        expect.objectContaining({
          detached: false,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        }),
      );
      expect(fetchMock).toHaveBeenCalled();
      expect(setServerProcessMock).toHaveBeenCalledWith(
        expect.objectContaining({
          pid: 456,
          startTime: expect.any(String),
        }),
      );
      expect(processManager.getPID()).toBe(456);
      expect(processManager.isRunning()).toBe(true);

      const alreadyRunning = await processManager.start();
      expect(alreadyRunning).toEqual({ success: false, error: "Process already running" });
    } finally {
      restorePlatform();
    }
  });

  it("returns error when process fails to start", async () => {
    const restorePlatform = setPlatform("win32");
    spawnMock.mockReturnValue(createMockChildProcess(undefined as never));

    try {
      const result = await processManager.start();
      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to start OpenCode server process");
      expect(processManager.getPID()).toBeNull();
      expect(clearServerProcessMock).toHaveBeenCalled();
    } finally {
      restorePlatform();
    }
  });

  it("returns error when host process never becomes healthy", async () => {
    const restorePlatform = setPlatform("win32");
    vi.useFakeTimers();
    vi.spyOn(process, "kill").mockImplementation(() => true);
    spawnMock.mockReturnValue(createMockChildProcess(654));
    fetchMock.mockRejectedValue(new Error("still booting"));

    try {
      const resultPromise = processManager.start();
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await resultPromise;
      expect(result.success).toBe(false);
      expect(result.error).toContain("did not become ready");
      expect(clearServerProcessMock).toHaveBeenCalled();
    } finally {
      restorePlatform();
    }
  });

  it("stops running process on Windows and clears state", async () => {
    const restorePlatform = setPlatform("win32");
    spawnMock.mockReturnValue(createMockChildProcess(789));
    vi.spyOn(process, "kill").mockImplementation(() => true);

    try {
      await processManager.start();
      const result = await processManager.stop(100);

      expect(result).toEqual({ success: true });
      expect(execMock).toHaveBeenCalledTimes(1);
      expect(execMock.mock.calls[0][0]).toBe("taskkill /F /T /PID 789");
      expect(processManager.getPID()).toBeNull();
      expect(processManager.isRunning()).toBe(false);
      expect(clearServerProcessMock).toHaveBeenCalled();
    } finally {
      restorePlatform();
    }
  });

  it("restarts tenant runtimes in order", async () => {
    vi.useFakeTimers();
    tenantRuntimesState["22"] = {
      userId: 22,
      chatId: 220,
      port: 49602,
      baseUrl: "http://127.0.0.1:49602",
      pid: 2222,
      tenantId: "tg-22",
    };
    tenantRuntimesState["11"] = {
      userId: 11,
      chatId: 110,
      port: 49601,
      baseUrl: "http://127.0.0.1:49601",
      pid: 1111,
      tenantId: "tg-11",
    };
    const pidCalls: number[] = [];
    vi.spyOn(process, "kill").mockImplementation((pid: number, signal?: number | NodeJS.Signals) => {
      pidCalls.push(pid);
      return signal === 0 ? false : true;
    });
    spawnMock.mockReturnValueOnce(createMockChildProcess(333)).mockReturnValueOnce(
      createMockChildProcess(444),
    );
    fetchMock.mockResolvedValue({ ok: true });

    const resultPromise = processManager.restartTenantRuntimes();
    await vi.runAllTimersAsync();
    const result = await resultPromise;
    vi.useRealTimers();

    expect(result).toEqual({ success: true });
    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(spawnMock.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        env: expect.objectContaining({ TG_ID: "11" }),
      }),
    );
    expect(spawnMock.mock.calls[1][2]).toEqual(
      expect.objectContaining({
        env: expect.objectContaining({ TG_ID: "22" }),
      }),
    );
    expect(pidCalls).toEqual(expect.arrayContaining([1111, 2222]));
  });

  it("returns error when stopping non-running process", async () => {
    const result = await processManager.stop();
    expect(result).toEqual({ success: false, error: "Process not running" });
  });

  it("cleans up state when tracked process is no longer alive", async () => {
    const restorePlatform = setPlatform("win32");
    spawnMock.mockReturnValue(createMockChildProcess(999));

    try {
      await processManager.start();
      vi.spyOn(process, "kill").mockImplementation(() => {
        throw new Error("ESRCH");
      });

      expect(processManager.isRunning()).toBe(false);
      expect(processManager.getPID()).toBeNull();
      expect(clearServerProcessMock).toHaveBeenCalled();
    } finally {
      restorePlatform();
    }
  });

  it("cleans saved PID on initialize when health check fails", async () => {
    vi.useFakeTimers();
    getServerProcessMock.mockReturnValue({
      pid: 500,
      startTime: new Date(Date.now() - 10_000).toISOString(),
    });
    vi.spyOn(process, "kill").mockImplementation(() => true);
    fetchMock.mockRejectedValue(new Error("connection refused"));

    const resultPromise = processManager.initialize();
    await vi.advanceTimersByTimeAsync(10_000);
    await resultPromise;

    expect(clearServerProcessMock).toHaveBeenCalledTimes(1);
    expect(processManager.isRunning()).toBe(false);
  });

  it("restores saved PID on initialize when health check passes", async () => {
    getServerProcessMock.mockReturnValue({
      pid: 501,
      startTime: new Date(Date.now() - 10_000).toISOString(),
    });
    vi.spyOn(process, "kill").mockImplementation(() => true);
    fetchMock.mockResolvedValue({ ok: true });

    await processManager.initialize();

    expect(clearServerProcessMock).not.toHaveBeenCalled();
    expect(processManager.isRunning()).toBe(true);
    expect(processManager.getPID()).toBe(501);
  });

  it("deduplicates parallel tenant runtime startups", async () => {
    vi.useFakeTimers();
    getTenantRuntimeInfoMock.mockReturnValue(undefined);
    spawnMock.mockReturnValue(createMockChildProcess(7777));
    fetchMock.mockResolvedValue({ ok: true });
    vi.spyOn(process, "kill").mockImplementation(() => true);

    const result1Promise = processManager.ensureRuntime();
    const result2Promise = processManager.ensureRuntime();

    await vi.runAllTimersAsync();
    const [result1, result2] = await Promise.all([result1Promise, result2Promise]);

    expect(result1).toEqual({ success: true });
    expect(result2).toEqual({ success: true });
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });
});
