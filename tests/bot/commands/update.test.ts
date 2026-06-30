import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CommandContext, Context } from "grammy";

const { mockUpdateVm } = vi.hoisted(() => ({
  mockUpdateVm: vi.fn(),
}));

vi.mock("../../../src/vm/manager.js", () => ({
  vmManager: {
    updateVm: mockUpdateVm,
  },
}));

import { updateCommand } from "../../../src/bot/commands/update.js";

function createCtx(overrides?: Partial<CommandContext<Context>>): CommandContext<Context> {
  return {
    from: { id: 12345, is_bot: false, first_name: "Test" },
    reply: vi.fn().mockResolvedValue({ message_id: 1, chat: { id: 12345 } }),
    chat: { id: 12345 },
    ...overrides,
  } as unknown as CommandContext<Context>;
}

describe("bot/commands/update", () => {
  beforeEach(() => {
    mockUpdateVm.mockReset();
  });

  it("replies with no-VM message when VM not found", async () => {
    mockUpdateVm.mockResolvedValue({
      success: false,
      error: "VM not found",
    });

    const ctx = createCtx();
    await updateCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      "You don't have a VM deployed. Nothing to update.",
    );
  });

  it("replies with SSH success when update occurs via SSH", async () => {
    mockUpdateVm.mockResolvedValue({
      success: true,
      method: "ssh",
    });

    const ctx = createCtx();
    await updateCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      "✅ VM updated via SSH. SSH password auth fix + skills symlink applied.",
    );
  });

  it("replies with guestfish success when update requires restart", async () => {
    mockUpdateVm.mockResolvedValue({
      success: true,
      method: "guestfish",
    });

    const ctx = createCtx();
    await updateCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      "✅ VM updated (required restart). SSH password auth fix + skills symlink applied.",
    );
  });

  it("replies with skipped when VM is already up to date", async () => {
    mockUpdateVm.mockResolvedValue({
      success: true,
      method: "skipped",
    });

    const ctx = createCtx();
    await updateCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith("ℹ️ VM already up to date.");
  });

  it("replies with error when update fails", async () => {
    mockUpdateVm.mockResolvedValue({
      success: false,
      error: "virt-customize timed out",
    });

    const ctx = createCtx();
    await updateCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      "❌ Update failed: virt-customize timed out",
    );
  });

  it("passes the correct userId to updateVm", async () => {
    mockUpdateVm.mockResolvedValue({ success: true, method: "skipped" });

    const ctx = createCtx({ from: { id: 99999, is_bot: false, first_name: "Test" } });
    await updateCommand(ctx);

    expect(mockUpdateVm).toHaveBeenCalledWith(99999);
  });

  it("handles no from.id gracefully", async () => {
    const ctx = createCtx({ from: undefined });
    await updateCommand(ctx);

    expect(mockUpdateVm).not.toHaveBeenCalled();
  });
});
