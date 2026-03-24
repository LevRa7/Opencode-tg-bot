import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { streamCommand } from "../../../src/bot/commands/stream.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  isMessageStreamingEnabledMock: vi.fn(() => true),
  setMessageStreamingEnabledMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/settings/manager.js", () => ({
  isMessageStreamingEnabled: mocked.isMessageStreamingEnabledMock,
  setMessageStreamingEnabled: mocked.setMessageStreamingEnabledMock,
}));

function createContext(text: string): Context {
  return {
    message: { text },
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

describe("bot/commands/stream", () => {
  beforeEach(() => {
    mocked.isMessageStreamingEnabledMock.mockReset();
    mocked.isMessageStreamingEnabledMock.mockReturnValue(true);
    mocked.setMessageStreamingEnabledMock.mockReset();
    mocked.setMessageStreamingEnabledMock.mockResolvedValue(undefined);
  });

  it("enables streaming with /stream on", async () => {
    const ctx = createContext("/stream on");

    await streamCommand(ctx);

    expect(mocked.setMessageStreamingEnabledMock).toHaveBeenCalledWith(true);
    expect(ctx.reply).toHaveBeenCalledWith(t("stream.enabled"));
  });

  it("disables streaming with /stream off", async () => {
    const ctx = createContext("/stream off");

    await streamCommand(ctx);

    expect(mocked.setMessageStreamingEnabledMock).toHaveBeenCalledWith(false);
    expect(ctx.reply).toHaveBeenCalledWith(t("stream.disabled"));
  });

  it("shows current status", async () => {
    mocked.isMessageStreamingEnabledMock.mockReturnValue(false);
    const ctx = createContext("/stream status");

    await streamCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(t("stream.status_disabled"));
  });

  it("shows usage for unknown arguments", async () => {
    const ctx = createContext("/stream maybe");

    await streamCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(t("stream.usage"));
  });
});
