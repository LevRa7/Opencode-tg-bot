import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { t } from "../../../src/i18n/index.js";

type RuntimeInfo = {
  managed: boolean;
  pid: number | null;
  uptimeMs: number | null;
};

const mocked = vi.hoisted(() => ({
  healthMock: vi.fn(),
  resolveLocalOpencodeTargetMock: vi.fn(),
  editBotTextMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  config: {
    opencode: { apiUrl: "http://localhost:4096" },
    telegram: { adminUserId: 777 },
  },
  processManagerMock: {
    isRunning: vi.fn(() => false),
    getPID: vi.fn(() => null),
    stop: vi.fn(() => Promise.resolve({ success: true, error: null })),
    getCurrentRuntimeInfo: vi.fn(
      (): RuntimeInfo => ({ managed: false, pid: null, uptimeMs: null }),
    ),
    ensureRuntime: vi.fn(() => Promise.resolve({ success: true, error: null })),
  },
  sshManagerMock: {
    isSshActive: vi.fn(() => false),
    disconnect: vi.fn(() => Promise.resolve()),
    getSavedConnections: vi.fn(() => Promise.resolve([])),
    connect: vi.fn(() => Promise.resolve()),
    bootstrapRemoteServer: vi.fn(() => Promise.resolve()),
  },
  abortThenRunMock: vi.fn(async (_ctx: unknown, action: () => Promise<void>) => action()),
  refreshSessionCacheMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../../src/config.js", () => ({
  config: mocked.config,
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    global: { health: mocked.healthMock },
  },
}));

vi.mock("../../../src/opencode/process.js", () => ({
  resolveLocalOpencodeTarget: mocked.resolveLocalOpencodeTargetMock,
}));

vi.mock("../../../src/process/manager.js", () => ({
  processManager: mocked.processManagerMock,
}));

vi.mock("../../../src/utils/ssh-manager.js", () => ({
  sshManager: mocked.sshManagerMock,
}));

vi.mock("../../../src/bot/utils/telegram-text.js", () => ({
  editBotText: mocked.editBotTextMock,
}));

vi.mock("../../../src/bot/utils/abort-then-run.js", () => ({
  abortThenRun: mocked.abortThenRunMock,
}));

vi.mock("../../../src/opencode/ready-refresh.js", () => ({
  refreshSessionCacheAfterOpencodeReady: mocked.refreshSessionCacheMock,
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    info: mocked.loggerInfoMock,
    error: mocked.loggerErrorMock,
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

import { opencodeRestartCommand } from "../../../src/bot/commands/opencode-restart.js";

function createContext(userId = mocked.config.telegram.adminUserId): Context {
  return {
    chat: { id: 42, type: "private" },
    from: { id: userId } as Context["from"],
    api: {
      editMessageText: vi.fn().mockResolvedValue(undefined),
    },
    reply: vi.fn().mockResolvedValue({ message_id: 10 }),
  } as unknown as Context;
}

describe("bot/commands/opencode-restart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.config.opencode.apiUrl = "http://localhost:4096";
    mocked.resolveLocalOpencodeTargetMock.mockReturnValue({ host: "localhost", port: 4096 });
    mocked.editBotTextMock.mockResolvedValue(undefined);
    mocked.processManagerMock.isRunning.mockReturnValue(false);
    mocked.processManagerMock.ensureRuntime.mockResolvedValue({ success: true, error: null });
    mocked.processManagerMock.stop.mockResolvedValue({ success: true, error: null });
    mocked.sshManagerMock.isSshActive.mockReturnValue(false);
    mocked.sshManagerMock.disconnect.mockResolvedValue(undefined);
    mocked.sshManagerMock.connect.mockResolvedValue(undefined);
    mocked.sshManagerMock.bootstrapRemoteServer.mockResolvedValue(undefined);
    mocked.sshManagerMock.getSavedConnections.mockResolvedValue([]);
    mocked.abortThenRunMock.mockImplementation(
      async (_ctx: unknown, action: () => Promise<void>) => action(),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delegates to abortThenRun before restarting", async () => {
    const ctx = createContext();
    mocked.healthMock.mockResolvedValue({ data: { healthy: true, version: "1.0.0" }, error: null });
    mocked.processManagerMock.getCurrentRuntimeInfo.mockReturnValue({
      managed: false,
      pid: 111,
      uptimeMs: null,
    });

    await opencodeRestartCommand(ctx as never);

    expect(mocked.abortThenRunMock).toHaveBeenCalledTimes(1);
  });

  it("warns when OPENCODE_API_URL points to a remote server (non-SSH)", async () => {
    const ctx = createContext();
    mocked.config.opencode.apiUrl = "https://example.com";
    mocked.resolveLocalOpencodeTargetMock.mockReturnValue(null);

    await opencodeRestartCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(
      t("opencode_restart.remote_configured"),
      expect.anything(),
    );
    expect(mocked.processManagerMock.stop).not.toHaveBeenCalled();
    expect(mocked.processManagerMock.ensureRuntime).not.toHaveBeenCalled();
  });

  it("SSH path: disconnects and reconnects when SSH is active", async () => {
    const ctx = createContext();
    mocked.sshManagerMock.isSshActive.mockReturnValue(true);
    mocked.sshManagerMock.getSavedConnections.mockResolvedValue([
      {
        id: "conn1",
        details: { username: "root", host: "192.168.1.1", port: 22 },
        auth: { type: "password", password: "secret" },
        deployTarget: "host" as const,
      },
    ]);

    await opencodeRestartCommand(ctx as never);

    expect(mocked.sshManagerMock.disconnect).toHaveBeenCalledWith(ctx.from!.id);
    expect(mocked.sshManagerMock.getSavedConnections).toHaveBeenCalledWith(ctx.from!.id);
    expect(mocked.sshManagerMock.connect).toHaveBeenCalledWith(
      ctx.from!.id,
      { username: "root", host: "192.168.1.1", port: 22 },
      { type: "password", password: "secret" },
      "host",
    );
    expect(mocked.sshManagerMock.bootstrapRemoteServer).toHaveBeenCalledWith(ctx.from!.id);

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining(t("opencode_restart.restarting")),
      expect.anything(),
    );
    expect(ctx.api.editMessageText).toHaveBeenLastCalledWith(
      ctx.chat!.id,
      10,
      t("opencode_restart.success_ssh"),
    );
  });

  it("SSH path: disconnects without reconnect when no saved connections", async () => {
    const ctx = createContext();
    mocked.sshManagerMock.isSshActive.mockReturnValue(true);
    mocked.sshManagerMock.getSavedConnections.mockResolvedValue([]);

    await opencodeRestartCommand(ctx as never);

    expect(mocked.sshManagerMock.disconnect).toHaveBeenCalledWith(ctx.from!.id);
    expect(mocked.sshManagerMock.connect).not.toHaveBeenCalled();
    expect(ctx.api.editMessageText).toHaveBeenLastCalledWith(
      ctx.chat!.id,
      10,
      t("opencode_restart.success_ssh"),
    );
  });

  it("managed path: stops then starts the server", async () => {
    const ctx = createContext();
    mocked.processManagerMock.isRunning.mockReturnValue(true);
    mocked.processManagerMock.getPID.mockReturnValue(456);
    mocked.processManagerMock.getCurrentRuntimeInfo.mockReturnValue({
      managed: true,
      pid: 789,
      uptimeMs: null,
    });
    mocked.healthMock
      .mockResolvedValueOnce({ data: { healthy: true, version: "2.0.0" }, error: null })
      .mockResolvedValueOnce({ data: { healthy: true, version: "2.0.0" }, error: null });

    await opencodeRestartCommand(ctx as never);

    // stop was called first
    expect(mocked.processManagerMock.stop).toHaveBeenCalledWith(5000);
    // then ensureRuntime
    expect(mocked.processManagerMock.ensureRuntime).toHaveBeenCalledTimes(1);

    const stopOrder = mocked.processManagerMock.stop.mock.invocationCallOrder[0];
    const startOrder = mocked.processManagerMock.ensureRuntime.mock.invocationCallOrder[0];
    expect(stopOrder).toBeLessThan(startOrder);

    expect(mocked.editBotTextMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        text: t("opencode_restart.success", { pid: 789, version: "2.0.0" }),
      }),
    );
    expect(mocked.refreshSessionCacheMock).toHaveBeenCalledWith("opencode_restart_success");
  });

  it("managed path: starts without stopping when server is not running", async () => {
    const ctx = createContext();
    mocked.processManagerMock.isRunning.mockReturnValue(false);
    mocked.processManagerMock.getCurrentRuntimeInfo.mockReturnValue({
      managed: true,
      pid: 111,
      uptimeMs: null,
    });
    mocked.healthMock
      .mockResolvedValueOnce({ data: { healthy: true, version: "3.0.0" }, error: null })
      .mockResolvedValueOnce({ data: { healthy: true, version: "3.0.0" }, error: null });

    await opencodeRestartCommand(ctx as never);

    expect(mocked.processManagerMock.stop).not.toHaveBeenCalled();
    expect(mocked.processManagerMock.ensureRuntime).toHaveBeenCalledTimes(1);
    expect(mocked.editBotTextMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        text: t("opencode_restart.success", { pid: 111, version: "3.0.0" }),
      }),
    );
  });

  it("reports stop_error when process stop fails", async () => {
    const ctx = createContext();
    mocked.processManagerMock.isRunning.mockReturnValue(true);
    mocked.processManagerMock.stop.mockResolvedValue({
      success: false,
      error: "timeout",
    });

    await opencodeRestartCommand(ctx as never);

    expect(mocked.editBotTextMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        text: t("opencode_restart.stop_error", { error: "timeout" }),
      }),
    );
    expect(mocked.processManagerMock.ensureRuntime).not.toHaveBeenCalled();
  });

  it("reports start_error when ensureRuntime fails", async () => {
    const ctx = createContext();
    mocked.processManagerMock.isRunning.mockReturnValue(false);
    mocked.processManagerMock.ensureRuntime.mockResolvedValue({
      success: false,
      error: "spawn failed",
    });

    await opencodeRestartCommand(ctx as never);

    expect(mocked.editBotTextMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        text: t("opencode_restart.start_error", { error: "spawn failed" }),
      }),
    );
  });

  it("reports not_ready when server starts but health check times out", async () => {
    vi.useFakeTimers();

    const ctx = createContext();
    mocked.processManagerMock.isRunning.mockReturnValue(false);
    mocked.processManagerMock.getCurrentRuntimeInfo.mockReturnValue({
      managed: true,
      pid: 321,
      uptimeMs: null,
    });
    mocked.healthMock.mockRejectedValue(new Error("offline"));

    const commandPromise = opencodeRestartCommand(ctx as never);
    await vi.advanceTimersByTimeAsync(10_500);
    await commandPromise;

    expect(mocked.processManagerMock.ensureRuntime).toHaveBeenCalledTimes(1);
    expect(mocked.editBotTextMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        text: t("opencode_restart.not_ready", { pid: 321 }),
      }),
    );
  });

  it("catches unexpected errors and reports generic error", async () => {
    const ctx = createContext();
    mocked.sshManagerMock.isSshActive.mockReturnValue(false);
    mocked.processManagerMock.isRunning.mockReturnValue(true);
    mocked.processManagerMock.stop.mockRejectedValue(new Error("crash"));

    await opencodeRestartCommand(ctx as never);

    expect(mocked.loggerErrorMock).toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(
      t("opencode_restart.error"),
      expect.anything(),
    );
  });

  it("allows non-admin users to execute the command", async () => {
    const ctx = createContext(100);
    mocked.healthMock
      .mockResolvedValueOnce({ data: { healthy: true, version: "1.0.0" }, error: null })
      .mockResolvedValueOnce({ data: { healthy: true, version: "1.0.0" }, error: null });

    await opencodeRestartCommand(ctx as never);

    expect(mocked.processManagerMock.stop).not.toHaveBeenCalled();
    expect(mocked.processManagerMock.ensureRuntime).toHaveBeenCalled();
  });
});
