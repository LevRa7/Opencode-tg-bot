import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandContext, Context } from "grammy";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  showVariantSelectionMenuMock: vi.fn(),
  applySelectedVariantMock: vi.fn(),
}));

vi.mock("../../../src/bot/handlers/variant.js", () => ({
  showVariantSelectionMenu: mocked.showVariantSelectionMenuMock,
  applySelectedVariant: mocked.applySelectedVariantMock,
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
    mocked.applySelectedVariantMock.mockReset().mockResolvedValue({
      applied: true,
      displayName: "Fast",
    });
  });

  it("shows the variant selection menu when no argument is provided", async () => {
    const ctx = createCommandContext("");

    await variantCommand(ctx);

    expect(mocked.showVariantSelectionMenuMock).toHaveBeenCalledWith(ctx);
    expect(mocked.applySelectedVariantMock).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("delegates an available variant to the shared variant application flow", async () => {
    const ctx = createCommandContext("fast");

    await variantCommand(ctx);

    expect(mocked.applySelectedVariantMock).toHaveBeenCalledWith(ctx, "fast", {
      replyTextKey: "variant.command.changed",
    });
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("replies with model required when the shared flow rejects a missing model", async () => {
    const ctx = createCommandContext("fast");
    mocked.applySelectedVariantMock.mockResolvedValue({
      applied: false,
      reason: "model_required",
      variantId: "fast",
    });

    await variantCommand(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(t("variant.command.model_required"));
    expect(mocked.applySelectedVariantMock).toHaveBeenCalledWith(ctx, "fast", {
      replyTextKey: "variant.command.changed",
    });
  });

  it("replies with not found when the shared flow rejects an unknown variant", async () => {
    const ctx = createCommandContext("unknown");
    mocked.applySelectedVariantMock.mockResolvedValue({
      applied: false,
      reason: "not_found",
      variantId: "unknown",
    });

    await variantCommand(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(t("variant.command.not_found", { name: "unknown" }));
    expect(mocked.applySelectedVariantMock).toHaveBeenCalledWith(ctx, "unknown", {
      replyTextKey: "variant.command.changed",
    });
  });

  it("replies with not found when the shared flow rejects a disabled variant", async () => {
    const ctx = createCommandContext("slow");
    mocked.applySelectedVariantMock.mockResolvedValue({
      applied: false,
      reason: "not_found",
      variantId: "slow",
    });

    await variantCommand(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(t("variant.command.not_found", { name: "slow" }));
    expect(mocked.applySelectedVariantMock).toHaveBeenCalledWith(ctx, "slow", {
      replyTextKey: "variant.command.changed",
    });
  });
});
