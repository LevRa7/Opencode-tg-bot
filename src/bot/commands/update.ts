import type { CommandContext, Context } from "grammy";
import { vmManager } from "../../vm/manager.js";
import { sshManager } from "../../utils/ssh-manager.js";

export async function updateCommand(ctx: CommandContext<Context>): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const result = await vmManager.updateVm(userId);

  if (!result.success) {
    if (result.error === "VM not found") {
      await ctx.reply("You don't have a VM deployed. Nothing to update.");
      return;
    }
    await ctx.reply(`❌ Update failed: ${result.error ?? "Unknown error"}`);
    return;
  }

  switch (result.method) {
    case "ssh":
      await ctx.reply("✅ VM updated via SSH. SSH password auth fix + skills symlink applied.");
      break;
    case "guestfish":
      await ctx.reply("✅ VM updated (required restart). SSH password auth fix + skills symlink applied.");
      break;
    case "skipped":
      await ctx.reply("ℹ️ VM already up to date.");
      break;
    default:
      await ctx.reply("✅ VM updated.");
      break;
  }
}
