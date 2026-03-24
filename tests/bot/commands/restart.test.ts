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

const mocked = vi.hoisted(() => ({
  lastRestartRequest: undefined as { updateId: number; requestedAt: string } | undefined,
  setLastRestartRequestMock: vi.fn(async (restartRequest: { updateId: number; requestedAt: string }) => {
    mocked.lastRestartRequest = restartRequest;
  }),
}));

vi.mock("../../../src/runtime/restart.js", () => ({
  restartCurrentProcess: restartCurrentProcessMock,
}));

vi.mock("../../../src/settings/manager.js", () => ({
  getLastRestartRequest: vi.fn(() => mocked.lastRestartRequest),
  setLastRestartRequest: mocked.setLastRestartRequestMock,
}));

function createContext(updateId: number = 500): CommandContext<Context> {
  return {
    update: { update_id: updateId },
    from: { id: 123 },
    reply: vi.fn().mockResolvedValue({ message_id: 1 }),
  } as unknown as CommandContext<Context>;
}

describe("bot/commands/restart", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    restartCurrentProcessMock.mockReset();
    mocked.lastRestartRequest = undefined;
    mocked.setLastRestartRequestMock.mockClear();
    __resetRestartStateForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("notifies user and triggers process restart after a short delay", async () => {
    const ctx = createContext();
    await restartCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(t("restart.restarting"));
    expect(restartCurrentProcessMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1500);

    expect(mocked.setLastRestartRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ updateId: 500 }),
    );
    expect(restartCurrentProcessMock).toHaveBeenCalledTimes(1);
  });

  it("prevents duplicate restart scheduling while pending", async () => {
    const firstCtx = createContext(500);
    const secondCtx = createContext(501);

    await restartCommand(firstCtx);
    await restartCommand(secondCtx);

    expect(secondCtx.reply).toHaveBeenCalledWith(t("restart.in_progress"));

    await vi.advanceTimersByTimeAsync(1500);

    expect(restartCurrentProcessMock).toHaveBeenCalledTimes(1);
  });

  it("reports deferred restart errors", async () => {
    restartCurrentProcessMock.mockImplementation(() => {
      throw new Error("spawn failed");
    });

    const ctx = createContext();
    await restartCommand(ctx);

    await vi.advanceTimersByTimeAsync(1500);

    expect(ctx.reply).toHaveBeenNthCalledWith(1, t("restart.restarting"));
    expect(ctx.reply).toHaveBeenNthCalledWith(2, t("restart.error", { error: "spawn failed" }));
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
