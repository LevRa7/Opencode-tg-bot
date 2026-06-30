import type { CommandContext, Context } from "grammy";
import { execSync } from "child_process";
import { vmManager } from "../../vm/manager.js";

async function getAdminUserId(): Promise<number | null> {
  const { config } = await import("../../config.js");
  return config.telegram.adminUserId ?? null;
}

export async function updateAllCommand(ctx: CommandContext<Context>): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const adminUserId = await getAdminUserId();
  if (userId !== adminUserId) {
    await ctx.reply("⛔ Admin only.");
    return;
  }

  // List all VMs
  let vmNames: string[] = [];
  try {
    const output = execSync("sudo virsh list --all --name", {
      encoding: "utf-8",
      stdio: "pipe",
    });
    vmNames = output
      .split("\n")
      .map((l) => l.trim())
      .filter((n) => n.startsWith("opencode-tg-"));
  } catch {
    await ctx.reply("📊 Update results:\n\nNo VMs found.");
    return;
  }

  if (vmNames.length === 0) {
    await ctx.reply("📊 Update results:\n\nNo VMs found.");
    return;
  }

  // Parse userId from domain names and run updates
  const results: { userId: number; method: string; status: string }[] = [];

  for (const name of vmNames) {
    const match = name.match(/^opencode-tg-(\d+)$/);
    if (!match) continue;
    const vmUserId = parseInt(match[1], 10);

    try {
      const result = await vmManager.updateVm(vmUserId);
      if (result.success) {
        results.push({
          userId: vmUserId,
          method: result.method ?? "unknown",
          status: "✅",
        });
      } else {
        results.push({
          userId: vmUserId,
          method: result.method ?? "failed",
          status: `❌ ${result.error ?? "failed"}`,
        });
      }
    } catch (err) {
      results.push({
        userId: vmUserId,
        method: "error",
        status: `❌ ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Build summary table
  let reply = "📊 Update results:\n";
  reply += "```\n";
  reply += "| User | Method    | Status |\n";
  reply += "|------|-----------|--------|\n";
  for (const r of results) {
    const method = r.method.padEnd(9);
    reply += `| ${String(r.userId).padEnd(4)} | ${method} | ${r.status.padEnd(6)} |\n`;
  }
  reply += "```";

  await ctx.reply(reply, { parse_mode: "MarkdownV2" } as any);
}
