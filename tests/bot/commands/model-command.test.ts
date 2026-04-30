import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandContext, Context } from "grammy";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  showModelSelectionMenuMock: vi.fn(),
  applySelectedModelMock: vi.fn(),
  getRuntimeModelCatalogMock: vi.fn(),
}));

vi.mock("../../../src/bot/handlers/model.js", () => ({
  showModelSelectionMenu: mocked.showModelSelectionMenuMock,
  applySelectedModel: mocked.applySelectedModelMock,
}));

vi.mock("../../../src/model/manager.js", () => ({
  getRuntimeModelCatalog: mocked.getRuntimeModelCatalogMock,
}));

import { modelCommand } from "../../../src/bot/commands/model.js";

function createCommandContext(match: string): CommandContext<Context> {
  return {
    match,
    chat: { id: 123 },
    api: { sendMessage: vi.fn() },
    reply: vi.fn().mockResolvedValue({ message_id: 10 }),
  } as unknown as CommandContext<Context>;
}

describe("bot/commands/model", () => {
  beforeEach(() => {
    mocked.showModelSelectionMenuMock.mockReset().mockResolvedValue(undefined);
    mocked.applySelectedModelMock.mockReset().mockResolvedValue(undefined);
    mocked.getRuntimeModelCatalogMock.mockReset().mockResolvedValue({
      providers: [
        {
          providerID: "cliproxyapi",
          models: [{ providerID: "cliproxyapi", modelID: "gpt-5.5" }],
        },
      ],
    });
  });

  it("shows the model selection menu when no argument is provided", async () => {
    const ctx = createCommandContext("");

    await modelCommand(ctx);

    expect(mocked.showModelSelectionMenuMock).toHaveBeenCalledWith(ctx);
    expect(mocked.getRuntimeModelCatalogMock).not.toHaveBeenCalled();
    expect(mocked.applySelectedModelMock).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("delegates a known model to the shared model application flow", async () => {
    const ctx = createCommandContext("cliproxyapi/gpt-5.5");
    const modelInfo = { providerID: "cliproxyapi", modelID: "gpt-5.5", variant: "default" };

    await modelCommand(ctx);

    expect(mocked.getRuntimeModelCatalogMock).toHaveBeenCalledTimes(1);
    expect(mocked.applySelectedModelMock).toHaveBeenCalledWith(ctx,
      modelInfo,
      { replyTextKey: "model.command.changed" },
    );
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("replies with usage and changes nothing when the model format is invalid", async () => {
    const ctx = createCommandContext("cliproxyapi");

    await modelCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(t("model.command.usage"));
    expect(mocked.getRuntimeModelCatalogMock).not.toHaveBeenCalled();
    expect(mocked.applySelectedModelMock).not.toHaveBeenCalled();
  });

  it("replies with not found and changes nothing when the model is absent from the runtime catalog", async () => {
    const ctx = createCommandContext("cliproxyapi/unknown");

    await modelCommand(ctx);

    expect(mocked.getRuntimeModelCatalogMock).toHaveBeenCalledTimes(1);
    expect(ctx.reply).toHaveBeenCalledWith(
      t("model.command.not_found", { name: "cliproxyapi/unknown" }),
    );
    expect(mocked.applySelectedModelMock).not.toHaveBeenCalled();
  });
});
