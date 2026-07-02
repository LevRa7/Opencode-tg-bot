import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stopBotContainersMock = vi.hoisted(() => vi.fn());
const loadSettingsMock = vi.hoisted(() => vi.fn());
const processManagerMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  ensureRuntime: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  dispose: vi.fn(),
}));
const autoRestartMonitorStartMock = vi.hoisted(() => vi.fn());
const autoRestartMonitorStopMock = vi.hoisted(() => vi.fn());
const reconcileStoredModelSelectionMock = vi.hoisted(() => vi.fn());
const warmupHostSessionDirectoryCacheMock = vi.hoisted(() => vi.fn());
const scheduledTaskRuntimeMock = vi.hoisted(() => ({
  initialize: vi.fn(),
}));
const createBotMock = vi.hoisted(() => vi.fn());
const botStartMock = vi.hoisted(() => vi.fn());
const botStopMock = vi.hoisted(() => vi.fn());
const botGetWebhookInfoMock = vi.hoisted(() => vi.fn());
const botDeleteWebhookMock = vi.hoisted(() => vi.fn());
interface MockBotApi {
  getWebhookInfo: typeof botGetWebhookInfoMock
  deleteWebhook: typeof botDeleteWebhookMock
}

const botApi: MockBotApi = {
  getWebhookInfo: botGetWebhookInfoMock,
  deleteWebhook: botDeleteWebhookMock,
};

let resolveBotStart: (() => void) | undefined;

vi.mock("../../src/runtime/docker.js", () => ({
  stopBotContainers: stopBotContainersMock,
}));

vi.mock("../../src/settings/manager.js", () => ({
  getOrCreateServerPassword: vi.fn(() => "test-pw-" + Math.random().toString(36).slice(2, 8)),
  loadSettings: loadSettingsMock,
  disposeDatabase: vi.fn(),
  getSubdomainsRepository: vi.fn(() => ({
    getByUserId: vi.fn(() => null),
    getBySubdomain: vi.fn(() => null),
    upsert: vi.fn(),
    deleteByUserId: vi.fn(),
  })),
}));

vi.mock("../../src/process/manager.js", () => ({
  processManager: processManagerMock,
}));

vi.mock("../../src/model/manager.js", () => ({
  reconcileStoredModelSelection: reconcileStoredModelSelectionMock,
}));

vi.mock("../../src/session/cache-manager.js", () => ({
  warmupHostSessionDirectoryCache: warmupHostSessionDirectoryCacheMock,
  __resetSessionDirectoryCacheForTests: vi.fn(),
}));

vi.mock("../../src/scheduled-task/runtime.js", () => ({
  scheduledTaskRuntime: scheduledTaskRuntimeMock,
}));

vi.mock("../../src/bot/index.js", () => ({
  createBot: createBotMock,
  disposeBotIntervals: vi.fn(),
}));

vi.mock("../../src/server/index.js", () => ({
  startHttpServer: vi.fn(() => Promise.resolve()),
  stopHttpServer: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../src/config.js", () => ({
  config: {
    telegram: { adminUserId: 777 },
    opencode: {
      autoRestart: {
        enabled: true,
        monitorIntervalSec: 300,
      },
    },
  },
}));

vi.mock("../../src/runtime/mode.js", () => ({
  getRuntimeMode: vi.fn(() => "sources"),
}));

vi.mock("../../src/runtime/paths.js", () => ({
  getRuntimePaths: vi.fn(() => ({
    envFilePath: "/tmp/.env",
    settingsFilePath: "/tmp/settings.json",
    runDirPath: `${process.cwd()}/.tmp/run`,
  })),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { startBotApp } from "../../src/app/start-bot-app.js";

describe("runtime/start-bot-app", () => {
  beforeEach(() => {
    resolveBotStart = undefined;
    stopBotContainersMock.mockReset();
    loadSettingsMock.mockReset();
    processManagerMock.initialize.mockReset();
    processManagerMock.ensureRuntime.mockReset();
    processManagerMock.start.mockReset();
    processManagerMock.stop.mockReset();
    autoRestartMonitorStartMock.mockReset();
    autoRestartMonitorStopMock.mockReset();
    reconcileStoredModelSelectionMock.mockReset();
    warmupHostSessionDirectoryCacheMock.mockReset();
    scheduledTaskRuntimeMock.initialize.mockReset();
    createBotMock.mockReset();
    botStartMock.mockReset();
    botStopMock.mockReset();
    botGetWebhookInfoMock.mockReset();
    botDeleteWebhookMock.mockReset();

    loadSettingsMock.mockResolvedValue(undefined);
    processManagerMock.initialize.mockResolvedValue(undefined);
    processManagerMock.ensureRuntime.mockResolvedValue({ success: true });
    processManagerMock.start.mockResolvedValue({ success: true });
    processManagerMock.stop.mockResolvedValue({ success: true });
    reconcileStoredModelSelectionMock.mockResolvedValue(undefined);
    warmupHostSessionDirectoryCacheMock.mockResolvedValue(undefined);
    scheduledTaskRuntimeMock.initialize.mockResolvedValue(undefined);
    botGetWebhookInfoMock.mockResolvedValue({ url: "" });

    createBotMock.mockReturnValue({
      api: botApi,
      start: botStartMock,
      stop: botStopMock,
    });
    botStartMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveBotStart = resolve;
        }),
    );
    botStopMock.mockImplementation(async () => undefined);
    stopBotContainersMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stops bot containers during shutdown", async () => {
    type SignalHandler = (signal: NodeJS.Signals) => unknown;
    const signalHandlers: Partial<Record<NodeJS.Signals, SignalHandler>> = {};
    const onSpy = vi.spyOn(process, "on").mockImplementation(((event: string, handler: SignalHandler) => {
      signalHandlers[event as NodeJS.Signals] = handler;
      return process;
    }) as typeof process.on);
    const offSpy = vi.spyOn(process, "off").mockImplementation(((event: string) => {
      delete signalHandlers[event as NodeJS.Signals];
      return process;
    }) as typeof process.off);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined as never));
    const createMonitor = vi.fn(() => ({
      start: autoRestartMonitorStartMock,
      stop: autoRestartMonitorStopMock,
      checkNow: vi.fn(),
    }));

    const startPromise = startBotApp({ createMonitor });
    await vi.waitFor(() => expect(createBotMock).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(botStartMock).toHaveBeenCalledTimes(1));

    signalHandlers.SIGTERM?.("SIGTERM");
    resolveBotStart?.();
    await startPromise;

    expect(botStopMock).toHaveBeenCalledTimes(1);
    expect(stopBotContainersMock).toHaveBeenCalledTimes(1);
    expect(createMonitor).toHaveBeenCalledWith({
      enabled: true,
      intervalMs: 300000,
      isRuntimeAvailable: expect.any(Function),
      start: expect.any(Function),
    });
    expect(autoRestartMonitorStartMock).toHaveBeenCalledTimes(1);
    expect(autoRestartMonitorStopMock).toHaveBeenCalledTimes(1);
    expect(onSpy).toHaveBeenCalled();
    expect(offSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
