import { beforeEach, describe, expect, it, vi } from "vitest";

// These mocks must be hoisted so they're available before the setup file imports real modules.
const {
  ensureRuntimeMock,
  startMock,
  initializeMock,
  loggerWarnMock,
  loggerInfoMock,
  loggerErrorMock,
  loggerDebugMock,
} = vi.hoisted(() => ({
  ensureRuntimeMock: vi.fn(),
  startMock: vi.fn(),
  initializeMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  loggerDebugMock: vi.fn(),
}));

vi.mock("../../src/process/manager.js", () => ({
  processManager: {
    initialize: initializeMock,
    ensureRuntime: ensureRuntimeMock,
    start: startMock,
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    debug: loggerDebugMock,
    info: loggerInfoMock,
    warn: loggerWarnMock,
    error: loggerErrorMock,
  },
}));

describe("app/start-bot-app auto-start", () => {
  beforeEach(() => {
    vi.resetModules();
    ensureRuntimeMock.mockReset();
    startMock.mockReset();
    initializeMock.mockReset();
    loggerWarnMock.mockReset();
    loggerInfoMock.mockReset();
    loggerErrorMock.mockReset();
    loggerDebugMock.mockReset();

    initializeMock.mockResolvedValue(undefined);
    ensureRuntimeMock.mockResolvedValue({ success: true });
    startMock.mockResolvedValue({ success: true });
  });

  it("calls start() when ensureRuntime() returns failure", async () => {
    ensureRuntimeMock.mockResolvedValue({ success: false, error: "server not running" });

    const { tryAutoStartServer } = await import("../../src/app/start-bot-app.js");
    await tryAutoStartServer();

    expect(ensureRuntimeMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledTimes(1);
  });

  it("does not call start() when ensureRuntime() succeeds", async () => {
    ensureRuntimeMock.mockResolvedValue({ success: true });

    const { tryAutoStartServer } = await import("../../src/app/start-bot-app.js");
    await tryAutoStartServer();

    expect(ensureRuntimeMock).toHaveBeenCalledTimes(1);
    expect(startMock).not.toHaveBeenCalled();
  });

  it("returns false when both ensureRuntime and start fail", async () => {
    ensureRuntimeMock.mockResolvedValue({ success: false, error: "not running" });
    startMock.mockResolvedValue({ success: false, error: "opencode not found" });

    const { tryAutoStartServer } = await import("../../src/app/start-bot-app.js");
    const result = await tryAutoStartServer();

    expect(result).toBe(false);
    expect(startMock).toHaveBeenCalledTimes(1);
  });

  it("returns true when ensureRuntime fails but start succeeds", async () => {
    ensureRuntimeMock.mockResolvedValue({ success: false, error: "not running" });
    startMock.mockResolvedValue({ success: true });

    const { tryAutoStartServer } = await import("../../src/app/start-bot-app.js");
    const result = await tryAutoStartServer();

    expect(result).toBe(true);
  });
});
