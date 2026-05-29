import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandContext, Context } from "grammy";
import {
  __resetRestartStateForTests,
  restartCommand,
} from "../../../src/bot/commands/restart.js";
import { t } from "../../../src/i18n/index.js";

const { restartCurrentProcessMock } = vi.hoisted(() => ({
  restartCurrentProcessMock: vi.fn(),
}));

const { restartTenantRuntimesMock, stopBotContainersMock } = vi.hoisted(() => ({
  restartTenantRuntimesMock: vi.fn(),
  stopBotContainersMock: vi.fn(),
}));

const mocked = vi.hoisted(() => ({
  lastRestartRequest: undefined as { updateId: number; requestedAt: string } | undefined,
  setLastRestartRequestMock: vi.fn(async (restartRequest: { updateId: number; requestedAt: string }) => {
    mocked.lastRestartRequest = restartRequest;
  }),
}));

vi.mock("../../../src/runtime/restart.js", () => ({
  restartCurrentProcess: restartCurrentProcessMock,
}));

vi.mock("../../../src/runtime/docker.js", () => ({
  stopBotContainers: stopBotContainersMock,
}));

vi.mock("../../../src/process/manager.js", () => ({
  processManager: {
    restartTenantRuntimes: restartTenantRuntimesMock,
  },
}));

vi.mock("../../../src/settings/manager.js", () => ({
  getLastRestartRequest: vi.fn(() => mocked.lastRestartRequest),
  setLastRestartRequest: mocked.setLastRestartRequestMock,
}));

vi.mock("../../../src/config.js", () => ({
  config: {
    telegram: {
      adminUserId: 777,
    },
    server: {
      logLevel: "error",
    },
  },
}));

function createContext(updateId: number = 500): CommandContext<Context> {
  return {
    update: { update_id: updateId },
    from: { id: 777 },
    reply: vi.fn().mockResolvedValue({ message_id: 1, chat: { id: 777 } }),
    chat: { id: 777 },
  } as unknown as CommandContext<Context>;
}

describe("bot/commands/restart", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    restartCurrentProcessMock.mockReset();
    restartTenantRuntimesMock.mockReset();
    stopBotContainersMock.mockReset();
    restartTenantRuntimesMock.mockResolvedValue({ success: true });
    stopBotContainersMock.mockResolvedValue(undefined);
    mocked.lastRestartRequest = undefined;
    mocked.setLastRestartRequestMock.mockClear();
    __resetRestartStateForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("notifies user and restarts tenants before triggering process restart", async () => {
    restartTenantRuntimesMock.mockResolvedValue({ success: true });

    const ctx = createContext();
    await restartCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(t("restart.restarting"), {});
    expect(restartCurrentProcessMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1500);

    expect(mocked.setLastRestartRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ updateId: 500 }),
    );
    expect(restartTenantRuntimesMock).toHaveBeenCalledTimes(1);
    expect(stopBotContainersMock).toHaveBeenCalledTimes(1);
    expect(restartCurrentProcessMock).toHaveBeenCalledTimes(1);
    expect(stopBotContainersMock.mock.invocationCallOrder[0]).toBeLessThan(
      restartCurrentProcessMock.mock.invocationCallOrder[0],
    );
  });

  it("prevents duplicate restart scheduling while pending", async () => {
    restartTenantRuntimesMock.mockResolvedValue({ success: true });

    const firstCtx = createContext(500);
    const secondCtx = createContext(501);

    await restartCommand(firstCtx);
    await restartCommand(secondCtx);

    expect(secondCtx.reply).toHaveBeenCalledWith(t("restart.in_progress"), {});

    await vi.advanceTimersByTimeAsync(1500);

    expect(restartCurrentProcessMock).toHaveBeenCalledTimes(1);
  });

  it("reports deferred restart errors", async () => {
    restartTenantRuntimesMock.mockResolvedValue({ success: true });
    restartCurrentProcessMock.mockImplementation(() => {
      throw new Error("spawn failed");
    });

    const ctx = createContext();
    await restartCommand(ctx);

    await vi.advanceTimersByTimeAsync(1500);

    expect(ctx.reply).toHaveBeenNthCalledWith(1, t("restart.restarting"), {});
    expect(ctx.reply).toHaveBeenNthCalledWith(2, t("restart.error", { error: "spawn failed" }), {});
  });

  it("reports container stop failures and skips process restart", async () => {
    restartTenantRuntimesMock.mockResolvedValue({ success: true });
    stopBotContainersMock.mockRejectedValue(new Error("timeout"));

    const ctx = createContext();
    await restartCommand(ctx);

    await vi.advanceTimersByTimeAsync(1500);

    expect(restartTenantRuntimesMock).toHaveBeenCalledTimes(1);
    expect(stopBotContainersMock).toHaveBeenCalledTimes(1);
    expect(restartCurrentProcessMock).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenNthCalledWith(2, t("restart.error", { error: "timeout" }), {});
  });

  it("reports tenant restart failures and skips host restart", async () => {
    restartTenantRuntimesMock.mockResolvedValue({ success: false, error: "tenant failed" });

    const ctx = createContext();
    await restartCommand(ctx);

    await vi.advanceTimersByTimeAsync(1500);

    expect(restartTenantRuntimesMock).toHaveBeenCalledTimes(1);
    expect(restartCurrentProcessMock).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenNthCalledWith(2, t("restart.error", { error: "tenant failed" }), {});
  });

  it("ignores replayed restart update after process relaunch", async () => {
    mocked.lastRestartRequest = {
      updateId: 777,
      requestedAt: new Date().toISOString(),
    };

    const ctx = createContext(777);
    await restartCommand(ctx);

    expect(ctx.reply).not.toHaveBeenCalled();
    expect(mocked.setLastRestartRequestMock).not.toHaveBeenCalled();
    expect(restartCurrentProcessMock).not.toHaveBeenCalled();
  });
});
