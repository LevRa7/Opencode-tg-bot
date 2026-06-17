import type { Context } from "grammy";
import {
  setUserDeployTarget,
  setUserVmSpecTier,
  setUserLocale,
  getVmRuntimeInfo,
} from "../../settings/manager.js";
import { VM_TIERS, type VmSpecTier } from "../../vm/types.js";
import { generateIpv6ForUser } from "../../vm/manager.js";
import { processManager } from "../../process/manager.js";
import { getLocaleOptions, type Locale } from "../../i18n/index.js";
import { t } from "../../i18n/index.js";
import { config } from "../../config.js";

// Pending VM deployments waiting for admin approval
const pendingVmDeployments = new Map<number, {
  tier: VmSpecTier;
  chatId: number;
  username?: string;
  messageThreadId?: number;
  ipv6: string;
}>();

export function getPendingVmDeployment(userId: number) {
  return pendingVmDeployments.get(userId);
}

export function removePendingVmDeployment(userId: number) {
  pendingVmDeployments.delete(userId);
}

export async function deployPendingVm(userId: number): Promise<{ success: boolean; error?: string }> {
  const info = pendingVmDeployments.get(userId);
  if (!info) return { success: false, error: "No pending deployment" };
  
  setUserDeployTarget(userId, "vm");
  setUserVmSpecTier(userId, info.tier);
  
  const result = await processManager.ensureRuntime(async () => {});
  pendingVmDeployments.delete(userId);
  return result;
}

async function sendAccessRequest(ctx: Context, userId: number): Promise<void> {
  // Dynamically import to avoid circular deps with auth middleware
  const { upsertPendingApprovalRequest } = await import("../middleware/auth-internal.js");
  const replyMsg = await ctx.reply(t("auth.requester.sent")).catch(() => undefined);
  const sent = await upsertPendingApprovalRequest(ctx, replyMsg?.message_id);
  if (!sent && replyMsg) {
    // Request not sent (cooldown) — delete the premature message
    try { await ctx.api.deleteMessage(ctx.chat!.id, replyMsg.message_id); } catch { /* ignore */ }
  }
}

export async function showLanguageSelection(ctx: Context): Promise<void> {
  const locales = getLocaleOptions();
  const keyboard = locales.map((locale) => [{
    text: `${locale.flag} ${locale.label}`,
    callback_data: `onboarding:lang:${locale.code}`,
  }]);

  await ctx.reply(t("settings.language.title"), {
    reply_markup: { inline_keyboard: keyboard },
  });
}

export async function showDeployTargetSelection(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const isAdmin = userId === config.telegram.adminUserId;
  const tiers = Object.entries(VM_TIERS);
  const keyboard = tiers.map(([key, spec]) => [
    {
      text: t("vm.tier.format", { label: t(`vm.tier.${key}`), ram: String(spec.ramMb / 1024), vcpus: String(spec.vcpus), disk: String(spec.diskGb) }),
      callback_data: `onboarding:vm:${key}`,
    },
  ]);

  if (isAdmin) {
    keyboard.push([
      {
        text: t("vm.onboarding.host"),
        callback_data: "onboarding:host",
      },
    ]);
  }

  keyboard.push([
    {
      text: t("vm.onboarding.docker"),
      callback_data: "onboarding:docker",
    },
  ]);

  await ctx.reply(t("vm.onboarding.title"), {
    reply_markup: { inline_keyboard: keyboard },
  });
}

export async function handleOnboardingCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  const userId = ctx.from?.id;
  if (!data || !userId) return false;

  if (data.startsWith("onboarding:lang:")) {
    const localeCode = data.slice("onboarding:lang:".length);
    const localeOption = getLocaleOptions().find(l => l.code === localeCode);
    if (!localeOption) return false;
    setUserLocale(localeCode as Locale);
    await ctx.answerCallbackQuery({ text: localeOption.label });
    await ctx.editMessageText(`✅ ${localeOption.flag} ${localeOption.label}`);
    await showDeployTargetSelection(ctx);
    return true;
  }

  if (data === "onboarding:docker") {
    setUserDeployTarget(userId, "docker");
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(t("vm.onboarding.docker_selected"));
    const result = await processManager.ensureRuntime();
    if (result.success) {
      await sendAccessRequest(ctx, userId);
    } else {
      await ctx.reply(t("vm.onboarding.error", { error: result.error || "unknown error" }));
    }
    return true;
  }

  if (data === "onboarding:host") {
    setUserDeployTarget(userId, "docker"); // admin on "host" uses docker deploy target for routing purposes
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(t("vm.onboarding.docker_selected"));
    await sendAccessRequest(ctx, userId);
    return true;
  }

  const vmMatch = data.match(/^onboarding:vm:(.+)$/);
  if (vmMatch) {
    const tier = vmMatch[1] as VmSpecTier;
    const spec = VM_TIERS[tier];
    if (!spec) return false;

    const tierLabel = t(`vm.tier.${tier}`);
    const ram = String(spec.ramMb / 1024);
    const vcpus = String(spec.vcpus);
    const disk = String(spec.diskGb);

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      t("vm.onboarding.vm_selected", { label: tierLabel, ram, vcpus, disk }),
    );

    // Store pending deployment and send approval request to admin
    // VM will be deployed only after admin approves
    pendingVmDeployments.set(userId, {
      tier,
      chatId: ctx.chat!.id,
      username: ctx.from?.username,
      messageThreadId: ctx.message?.message_thread_id,
      ipv6: generateIpv6ForUser(userId),
    });

    setUserDeployTarget(userId, "vm");
    setUserVmSpecTier(userId, tier);

    // Send approval request to admin and store requester message id for later editing
    const { upsertPendingApprovalRequest } = await import("../middleware/auth-internal.js");
    const usernameStr = ctx.from?.username ? `@${ctx.from.username}` : `ID ${userId}`;
    const configMsg = t("vm.onboarding.vm_selected", { label: tierLabel, ram, vcpus, disk });
    const replyMsg = await ctx.reply(
      t("vm.onboarding.pending_approval", { username: usernameStr, config: configMsg }),
      { parse_mode: "HTML" },
    );
    await upsertPendingApprovalRequest(ctx, replyMsg.message_id);
    return true;
  }

  return false;
}
