import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOpenCodeAutoRestartMonitor } from "../../src/opencode/auto-restart.js";

describe("createOpenCodeAutoRestartMonitor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts the runtime when health check fails and auto-restart is enabled", async () => {
    const isRuntimeAvailable = vi.fn().mockResolvedValue(false);
    const start = vi.fn().mockResolvedValue({ success: true });
    const monitor = createOpenCodeAutoRestartMonitor({
      enabled: true,
      intervalMs: 1000,
      isRuntimeAvailable,
      start,
    });

    await monitor.checkNow();

    expect(isRuntimeAvailable).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledOnce();
  });

  it("does not start the runtime when auto-restart is disabled", async () => {
    const isRuntimeAvailable = vi.fn().mockResolvedValue(false);
    const start = vi.fn().mockResolvedValue({ success: true });
    const monitor = createOpenCodeAutoRestartMonitor({
      enabled: false,
      intervalMs: 1000,
      isRuntimeAvailable,
      start,
    });

    await monitor.checkNow();

    expect(isRuntimeAvailable).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it("does not attempt restart when runtime is already healthy", async () => {
    const isRuntimeAvailable = vi.fn().mockResolvedValue(true);
    const start = vi.fn();
    const monitor = createOpenCodeAutoRestartMonitor({
      enabled: true,
      intervalMs: 1000,
      isRuntimeAvailable,
      start,
    });

    await monitor.checkNow();

    expect(isRuntimeAvailable).toHaveBeenCalledOnce();
    expect(start).not.toHaveBeenCalled();
  });

  it("schedules periodic checks and stops them on dispose", async () => {
    const isRuntimeAvailable = vi.fn().mockResolvedValue(false);
    const start = vi.fn().mockResolvedValue({ success: true });
    const monitor = createOpenCodeAutoRestartMonitor({
      enabled: true,
      intervalMs: 1000,
      isRuntimeAvailable,
      start,
    });

    monitor.start();
    await vi.advanceTimersByTimeAsync(3000);
    monitor.stop();
    await vi.advanceTimersByTimeAsync(3000);

    expect(isRuntimeAvailable).toHaveBeenCalledTimes(3);
    expect(start).toHaveBeenCalledTimes(3);
  });

  it("avoids overlapping restart checks while one is in progress", async () => {
    let resolveRuntimeProbe: (() => void) | undefined;
    const isRuntimeAvailable = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRuntimeProbe = () => resolve(false);
        }),
    );
    const start = vi.fn().mockResolvedValue({ success: true });
    const monitor = createOpenCodeAutoRestartMonitor({
      enabled: true,
      intervalMs: 1000,
      isRuntimeAvailable,
      start,
    });

    monitor.start();
    await vi.advanceTimersByTimeAsync(2500);
    expect(isRuntimeAvailable).toHaveBeenCalledTimes(1);

    resolveRuntimeProbe?.();
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));

    monitor.stop();
  });

  it("does not restart when the side-effect-free probe says runtime is available", async () => {
    const isRuntimeAvailable = vi.fn().mockResolvedValue(true);
    const start = vi.fn();
    const monitor = createOpenCodeAutoRestartMonitor({
      enabled: true,
      intervalMs: 1000,
      isRuntimeAvailable,
      start,
    });

    await monitor.checkNow();

    expect(isRuntimeAvailable).toHaveBeenCalledOnce();
    expect(start).not.toHaveBeenCalled();
  });
});
