import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChildProcess } from "node:child_process";
import type { Context } from "grammy";
import { t } from "../../../src/i18n/index.js";

type RuntimeInfo = {
  managed: boolean;
  pid: number | null;
  uptimeMs: number | null;
};

const mocked = vi.hoisted(() => ({
  healthMock: vi.fn(),
  spawnMock: vi.fn(),
  resolveLocalOpencodeTargetMock: vi.fn(),
  editBotTextMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  config: {
    opencode: {
      apiUrl: "http://localhost:4096",
    },
    telegram: {
      adminUserId: 777,
    },
  },
  processManagerMock: {
    isRunning: vi.fn(() => false),
    getPID: vi.fn(() => null),
    stop: vi.fn(),
    getCurrentRuntimeInfo: vi.fn(
      (): RuntimeInfo => ({ managed: false, pid: null, uptimeMs: null }),
    ),
    ensureRuntime: vi.fn(() => Promise.resolve({ success: true, error: null })),
  },
}));

vi.mock("node:child_process", () => ({
  spawn: mocked.spawnMock,
}));

vi.mock("../../../src/config.js", () => ({
  config: mocked.config,
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    global: {
      health: mocked.healthMock,
    },
  },
}));

vi.mock("../../../src/opencode/process.js", () => ({
  resolveLocalOpencodeTarget: mocked.resolveLocalOpencodeTargetMock,
}));

vi.mock("../../../src/process/manager.js", () => ({
  processManager: mocked.processManagerMock,
}));

vi.mock("../../../src/bot/utils/telegram-text.js", () => ({
  editBotText: mocked.editBotTextMock,
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    info: mocked.loggerInfoMock,
    error: mocked.loggerErrorMock,
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

import { opencodeStartCommand } from "../../../src/bot/commands/opencode-start.js";

function createContext(userId = mocked.config.telegram.adminUserId): Context {
  return {
    chat: { id: 42, type: "private" },
    from: { id: userId } as Context["from"],
    api: {},
    reply: vi.fn().mockResolvedValue({ message_id: 10 }),
  } as unknown as Context;
}

function createChildProcess(pid: number): ChildProcess {
  return {
    pid,
    once: vi.fn(),
    unref: vi.fn(),
  } as unknown as ChildProcess;
}

describe("bot/commands/opencode-start", () => {
  beforeEach(() => {
    mocked.healthMock.mockReset();
    mocked.spawnMock.mockReset();
    mocked.resolveLocalOpencodeTargetMock.mockReset();
    mocked.editBotTextMock.mockReset();
    mocked.loggerInfoMock.mockReset();
    mocked.loggerErrorMock.mockReset();
    mocked.processManagerMock.isRunning.mockReset();
    mocked.processManagerMock.getPID.mockReset();
    mocked.processManagerMock.stop.mockReset();
    mocked.processManagerMock.getCurrentRuntimeInfo.mockReset();
    mocked.processManagerMock.ensureRuntime.mockReset();

    mocked.config.opencode.apiUrl = "http://localhost:4096";
    mocked.resolveLocalOpencodeTargetMock.mockReturnValue({ host: "localhost", port: 4096 });
    mocked.editBotTextMock.mockResolvedValue(undefined);
    mocked.processManagerMock.isRunning.mockReturnValue(false);
    mocked.processManagerMock.getCurrentRuntimeInfo.mockReturnValue({
      managed: false,
      pid: null,
      uptimeMs: null,
    });
    mocked.processManagerMock.ensureRuntime.mockResolvedValue({ success: true, error: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("warns when OPENCODE_API_URL points to a remote server", async () => {
    const ctx = createContext();
    mocked.config.opencode.apiUrl = "https://example.com";
    mocked.resolveLocalOpencodeTargetMock.mockReturnValue(null);

    await opencodeStartCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(
      t("opencode_start.remote_configured"),
      expect.anything(),
    );
    expect(mocked.spawnMock).not.toHaveBeenCalled();
  });

  it("allows direct invocation from non-admin users", async () => {
    const ctx = createContext(100);
    mocked.healthMock.mockResolvedValue({ data: { healthy: true, version: "1.2.3" }, error: null });

    await opencodeStartCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(
      t("opencode_start.already_running_external", { version: "1.2.3" }),
      expect.anything(),
    );
    expect(mocked.resolveLocalOpencodeTargetMock).toHaveBeenCalledWith("http://localhost:4096");
    expect(mocked.healthMock).toHaveBeenCalled();
    expect(mocked.processManagerMock.ensureRuntime).not.toHaveBeenCalled();
  });

  it("reports that the server is already running when health-check succeeds", async () => {
    const ctx = createContext();
    mocked.healthMock.mockResolvedValue({ data: { healthy: true, version: "1.2.3" }, error: null });

    await opencodeStartCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(
      t("opencode_start.already_running_external", { version: "1.2.3" }),
      expect.anything(),
    );
    expect(mocked.spawnMock).not.toHaveBeenCalled();
  });

  it("starts the local server and reports success", async () => {
    const ctx = createContext();
    mocked.processManagerMock.getCurrentRuntimeInfo.mockReturnValue({
      managed: false,
      pid: 123,
      uptimeMs: null,
    } as RuntimeInfo);
    mocked.healthMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ data: { healthy: true, version: "1.2.3" }, error: null })
      .mockResolvedValueOnce({ data: { healthy: true, version: "1.2.3" }, error: null });

    await opencodeStartCommand(ctx as never);

    expect(mocked.processManagerMock.ensureRuntime).toHaveBeenCalledTimes(1);
    expect(mocked.editBotTextMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        text: t("opencode_start.success", { pid: 123, version: "1.2.3" }),
      }),
    );
  });

  it("reports started_not_ready when the server does not answer in time", async () => {
    vi.useFakeTimers();

    const ctx = createContext();
    mocked.processManagerMock.getCurrentRuntimeInfo.mockReturnValue({
      managed: false,
      pid: 321,
      uptimeMs: null,
    } as RuntimeInfo);
    mocked.healthMock.mockRejectedValue(new Error("offline"));

    const commandPromise = opencodeStartCommand(ctx as never);
    await vi.advanceTimersByTimeAsync(10_500);
    await commandPromise;

    expect(mocked.processManagerMock.ensureRuntime).toHaveBeenCalledTimes(1);
    expect(mocked.editBotTextMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        text: t("opencode_start.started_not_ready", { pid: 321 }),
      }),
    );
  });
});
