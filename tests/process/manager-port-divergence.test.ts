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
  getOrCreateServerPassword: vi.fn(() => "test-pw-" + Math.random().toString(36).slice(2, 8)),
  getServerProcess: getServerProcessMock,
  setServerProcess: setServerProcessMock,
  clearServerProcess: clearServerProcessMock,
  getTenantRuntimeInfo: getTenantRuntimeInfoMock,
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

describe("Tenant port divergence", () => {
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

    // Default: exec returns empty string (used for taskkill etc)
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
      // timers may not be mocked in all tests
    }
    vi.useRealTimers();
  });

  /**
   * Property: when Docker selects a different host port than the one Node.js requested,
   * the health check must poll the actual Docker-mapped port, not the requested one.
   */
  it("detects port divergence via docker port command and health-checks the actual port", async () => {
    vi.useFakeTimers();

    // Arrange: tenant runtime exists with requested port 49600
    const requestedPort = 49600;
    const actualPort = 49601;
    const userId = 42;
    tenantRuntimesState[String(userId)] = {
      userId,
      chatId: 420,
      port: requestedPort,
      baseUrl: `http://127.0.0.1:${requestedPort}`,
      pid: 1111,
      tenantId: "tg-42",
    };

    // Mock isAlive (PID check)
    vi.spyOn(process, "kill").mockImplementation((pid: number, signal?: number | NodeJS.Signals) => {
      // Signal 0 = isAlive check → return true for existing PID
      if (signal === 0 && pid === 1111) return true;
      return true;
    });

    // Spawn a new child process for the restart
    spawnMock.mockReturnValue(createMockChildProcess(2222));

    // Mock docker port command to return a DIFFERENT port than requested
    const execCalls: string[] = [];
    execMock.mockImplementation((cmd: string, callback?: (...args: unknown[]) => void) => {
      execCalls.push(String(cmd));
      if (typeof cmd === "string" && cmd.includes("docker port")) {
        if (callback) {
          callback(null, `0.0.0.0:${actualPort}\n`, "");
        }
      } else if (callback) {
        callback(null, "", "");
      }
      return {};
    });

    // Track which URLs get health-checked
    // Only respond OK on the actual Docker-mapped port; reject on the wrong port
    const healthCheckUrls: string[] = [];
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/global/health")) {
        healthCheckUrls.push(url);
        if (url.includes(`:${actualPort}`)) {
          return { ok: true };
        }
        throw new Error(`Connection refused to ${url} - wrong port`);
      }
      return { ok: true };
    });

    // Act: restart all tenant runtimes
    const resultPromise = processManager.restartTenantRuntimes();
    await vi.runAllTimersAsync();
    const result = await resultPromise;
    vi.useRealTimers();

    // Assert: restart succeeds
    expect(result).toEqual({ success: true });

    // Assert: docker port was queried
    expect(execCalls.some(c => c.includes("docker port"))).toBe(true);

    // Assert: health check was called with the ACTUAL docker-mapped port, not the requested one
    expect(healthCheckUrls.length).toBeGreaterThan(0);
    const usedUrl = healthCheckUrls[0];
    expect(usedUrl).toBe(`http://127.0.0.1:${actualPort}/global/health`);
    expect(usedUrl).not.toBe(`http://127.0.0.1:${requestedPort}/global/health`);
  });
});
