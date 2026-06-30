import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CommandContext, Context } from "grammy";

const { mockUpdateVm } = vi.hoisted(() => ({
  mockUpdateVm: vi.fn(),
}));

const { mockExecSync } = vi.hoisted(() => ({
  mockExecSync: vi.fn(),
}));

// Mock child_process before anything else loads it
vi.mock("node:child_process", () => ({
  execSync: mockExecSync,
  exec: vi.fn(),
}));

vi.mock("child_process", () => ({
  execSync: mockExecSync,
  exec: vi.fn(),
}));

vi.mock("../../../src/vm/manager.js", () => ({
  vmManager: {
    updateVm: mockUpdateVm,
  },
}));

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: { telegram: { adminUserId: 123 }, server: { logLevel: "error" } },
}));

vi.mock("../../../src/config.js", () => ({
  config: mockConfig,
}));

// Need to mock ssh-manager and process/manager to avoid loading child_process
vi.mock("../../../src/utils/ssh-manager.js", () => ({
  sshManager: { isSshActive: vi.fn(() => false) },
}));

vi.mock("../../../src/process/manager.js", () => ({
  processManager: {},
}));

import { updateAllCommand } from "../../../src/bot/commands/update-all.js";

function createCtx(overrides?: Partial<CommandContext<Context>>): CommandContext<Context> {
  return {
    from: { id: 123, is_bot: false, first_name: "Admin" },
    reply: vi.fn().mockResolvedValue({ message_id: 1, chat: { id: 123 } }),
    chat: { id: 123 },
    ...overrides,
  } as unknown as CommandContext<Context>;
}

describe("bot/commands/update-all", () => {
  beforeEach(() => {
    mockUpdateVm.mockReset();
    mockExecSync.mockReset();
    mockConfig.telegram.adminUserId = 123;
    mockExecSync.mockReturnValue("opencode-tg-111\nopencode-tg-222\nopencode-tg-333\n");
  });

  describe("admin check", () => {
    it("replies with admin-only message when user is not admin", async () => {
      const ctx = createCtx({ from: { id: 999, is_bot: false, first_name: "User" } });
      await updateAllCommand(ctx);

      expect(ctx.reply).toHaveBeenCalledWith("⛔ Admin only.");
      expect(mockExecSync).not.toHaveBeenCalled();
      expect(mockUpdateVm).not.toHaveBeenCalled();
    });

    it("allows admin user to proceed", async () => {
      mockUpdateVm.mockResolvedValue({ success: true, method: "skipped" });

      const ctx = createCtx();
      await updateAllCommand(ctx);

      expect(mockExecSync).toHaveBeenCalled();
      expect(mockUpdateVm).toHaveBeenCalled();
    });
  });

  describe("VM listing", () => {
    it("parses userId from domain names", async () => {
      mockUpdateVm.mockResolvedValue({ success: true, method: "skipped" });

      const ctx = createCtx();
      await updateAllCommand(ctx);

      expect(mockUpdateVm).toHaveBeenCalledWith(111);
      expect(mockUpdateVm).toHaveBeenCalledWith(222);
      expect(mockUpdateVm).toHaveBeenCalledWith(333);
      expect(mockUpdateVm).toHaveBeenCalledTimes(3);
    });

    it("handles empty VM list", async () => {
      mockExecSync.mockReturnValue("\n");
      const ctx = createCtx();
      await updateAllCommand(ctx);

      expect(mockUpdateVm).not.toHaveBeenCalled();
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("No VMs found"),
      );
    });
  });

  describe("summary table", () => {
    it("generates a table with results for each VM", async () => {
      mockUpdateVm
        .mockResolvedValueOnce({ success: true, method: "ssh" })
        .mockResolvedValueOnce({ success: true, method: "guestfish" })
        .mockResolvedValueOnce({ success: true, method: "skipped" });

      const ctx = createCtx();
      await updateAllCommand(ctx);

      const replyText = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(replyText).toContain("📊 Update results:");
      expect(replyText).toContain("111");
      expect(replyText).toContain("ssh");
      expect(replyText).toContain("222");
      expect(replyText).toContain("guestfish");
      expect(replyText).toContain("333");
      expect(replyText).toContain("skipped");
    });

    it("shows errors for failed updates", async () => {
      mockUpdateVm
        .mockResolvedValueOnce({ success: true, method: "ssh" })
        .mockResolvedValueOnce({ success: false, error: "timeout" })
        .mockResolvedValueOnce({ success: true, method: "skipped" });

      const ctx = createCtx();
      await updateAllCommand(ctx);

      const replyText = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(replyText).toContain("❌");
      expect(replyText).toContain("timeout");
    });
  });

  it("ignores non-opencode-tg domains", async () => {
    mockExecSync.mockReturnValue(
      "opencode-tg-111\nother-vm\nopencode-tg-222\nsystem-domain\n",
    );
    mockUpdateVm.mockResolvedValue({ success: true, method: "skipped" });

    const ctx = createCtx();
    await updateAllCommand(ctx);

    expect(mockUpdateVm).toHaveBeenCalledTimes(2);
    expect(mockUpdateVm).toHaveBeenCalledWith(111);
    expect(mockUpdateVm).toHaveBeenCalledWith(222);
  });

  it("handles no from.id gracefully", async () => {
    const ctx = createCtx({ from: undefined });
    await updateAllCommand(ctx);

    expect(mockExecSync).not.toHaveBeenCalled();
  });
});
