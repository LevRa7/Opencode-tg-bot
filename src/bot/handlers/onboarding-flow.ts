import type { Context } from "grammy";
import {
  setUserDeployTarget,
  setUserVmSpecTier,
  setUserLocale,
  getVmRuntimeInfo,
} from "../../settings/manager.js";
import { VM_TIERS, type VmSpecTier } from "../../vm/types.js";
import { processManager } from "../../process/manager.js";
import { getLocaleOptions, type Locale } from "../../i18n/index.js";
import { t } from "../../i18n/index.js";
import { config } from "../../config.js";

async function sendAccessRequest(ctx: Context, userId: number): Promise<void> {
  // Dynamically import to avoid circular deps with auth middleware
  const { upsertPendingApprovalRequest } = await import("../middleware/auth-internal.js");
  const sent = await upsertPendingApprovalRequest(ctx);
  if (sent) {
    await ctx.reply("Запрос доступа отправлен администратору. После подтверждения можно будет пользоваться ботом.");
  }
}

export async function showLanguageSelection(ctx: Context): Promise<void> {
  const locales = getLocaleOptions();
  const keyboard = locales.map((locale) => [{
    text: `${locale.flag} ${locale.label}`,
    callback_data: `onboarding:lang:${locale.code}`,
  }]);

  await ctx.reply("Выберите язык / Choose language:", {
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

    setUserDeployTarget(userId, "vm");
    setUserVmSpecTier(userId, tier);

    const tierLabel = t(`vm.tier.${tier}`);
    const ram = String(spec.ramMb / 1024);
    const vcpus = String(spec.vcpus);
    const disk = String(spec.diskGb);

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      t("vm.onboarding.vm_selected", { label: tierLabel, ram, vcpus, disk }),
    );

    const result = await processManager.ensureRuntime(async (step) => {
      try {
        await ctx.editMessageText(
          `${t("vm.onboarding.vm_selected", { label: tierLabel, ram, vcpus, disk })}\n\n${step}`,
        );
      } catch { /* message might be deleted */ }
    });
    if (result.success) {
      const vmInfo = getVmRuntimeInfo(userId);
      await ctx.reply(
        t("vm.onboarding.server_ready", { address: vmInfo?.baseUrl || "assigning..." }),
        { parse_mode: "HTML" },
      );
      await sendAccessRequest(ctx, userId);
    } else {
      await ctx.reply(t("vm.onboarding.error", { error: result.error || "unknown error" }));
    }
    return true;
  }

  return false;
}
