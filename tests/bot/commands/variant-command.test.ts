import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandContext, Context } from "grammy";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  showVariantSelectionMenuMock: vi.fn(),
  applySelectedVariantMock: vi.fn(),
  getStoredModelMock: vi.fn(),
  getAvailableVariantsMock: vi.fn(),
}));

vi.mock("../../../src/bot/handlers/variant.js", () => ({
  showVariantSelectionMenu: mocked.showVariantSelectionMenuMock,
  applySelectedVariant: mocked.applySelectedVariantMock,
}));

vi.mock("../../../src/model/manager.js", () => ({
  getStoredModel: mocked.getStoredModelMock,
}));

vi.mock("../../../src/variant/manager.js", () => ({
  getAvailableVariants: mocked.getAvailableVariantsMock,
}));

import { variantCommand } from "../../../src/bot/commands/variant.js";

function createCommandContext(match: string): CommandContext<Context> {
  return {
    match,
    chat: { id: 123 },
    api: { sendMessage: vi.fn() },
    reply: vi.fn().mockResolvedValue({ message_id: 10 }),
  } as unknown as CommandContext<Context>;
}

describe("bot/commands/variant", () => {
  beforeEach(() => {
    mocked.showVariantSelectionMenuMock.mockReset().mockResolvedValue(undefined);
    mocked.applySelectedVariantMock.mockReset().mockResolvedValue(undefined);
    mocked.getStoredModelMock.mockReset().mockReturnValue({
      providerID: "openai",
      modelID: "gpt-5",
      variant: "default",
    });
    mocked.getAvailableVariantsMock.mockReset().mockResolvedValue([
      { id: "default", disabled: false },
      { id: "fast", disabled: false },
      { id: "slow", disabled: true },
    ]);
  });

  it("shows the variant selection menu when no argument is provided", async () => {
    const ctx = createCommandContext("");

    await variantCommand(ctx);

    expect(mocked.showVariantSelectionMenuMock).toHaveBeenCalledWith(ctx);
    expect(mocked.getStoredModelMock).not.toHaveBeenCalled();
    expect(mocked.getAvailableVariantsMock).not.toHaveBeenCalled();
    expect(mocked.applySelectedVariantMock).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("delegates an available variant to the shared variant application flow", async () => {
    const ctx = createCommandContext("fast");

    await variantCommand(ctx);

    expect(mocked.getAvailableVariantsMock).toHaveBeenCalledWith("openai", "gpt-5");
    expect(mocked.applySelectedVariantMock).toHaveBeenCalledWith(ctx, "fast", {
      replyTextKey: "variant.command.changed",
    });
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("replies with model required and changes nothing when no model is selected", async () => {
    const ctx = createCommandContext("fast");
    mocked.getStoredModelMock.mockReturnValue({ providerID: "", modelID: "", variant: "default" });

    await variantCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(t("variant.command.model_required"));
    expect(mocked.getAvailableVariantsMock).not.toHaveBeenCalled();
    expect(mocked.applySelectedVariantMock).not.toHaveBeenCalled();
  });

  it("replies with not found and changes nothing when the variant is unknown", async () => {
    const ctx = createCommandContext("unknown");

    await variantCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(t("variant.command.not_found", { name: "unknown" }));
    expect(mocked.applySelectedVariantMock).not.toHaveBeenCalled();
  });

  it("replies with not found and changes nothing when the variant is disabled", async () => {
    const ctx = createCommandContext("slow");

    await variantCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(t("variant.command.not_found", { name: "slow" }));
    expect(mocked.applySelectedVariantMock).not.toHaveBeenCalled();
  });
});
