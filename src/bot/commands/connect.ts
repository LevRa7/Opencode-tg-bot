import { Context, InlineKeyboard } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentProject } from "../../settings/manager.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";

const POPULAR_PROVIDERS = ["openai", "google", "anthropic", "deepseek", "vertex", "perplexity"];

const apiKeyPromptByUser = new Map<number, { providerId: string; chatId: number }>();

export function isProviderApiKeyPrompt(userId: number): string | undefined {
  return apiKeyPromptByUser.get(userId)?.providerId;
}

export function clearProviderApiKeyPrompt(userId: number): void {
  apiKeyPromptByUser.delete(userId);
}

export async function connectCommand(ctx: Context): Promise<void> {
  try {
    const project = getCurrentProject();
    const { data: providerData, error } = await opencodeClient.provider.list({
      directory: project?.worktree,
    });

    if (error || !providerData) {
      await ctx.reply(t("connect.error"));
      return;
    }

    const rawList = (providerData as any)?.all ?? (providerData as any)?.providers ?? [];
    if (rawList.length === 0) {
      await ctx.reply(t("connect.empty"));
      return;
    }

    // Sort: popular first, then alphabetical
    const popular: any[] = [];
    const rest: any[] = [];
    for (const p of rawList) {
      const id = (p.id ?? p.name ?? "").toLowerCase();
      if (POPULAR_PROVIDERS.some(pp => id.includes(pp))) {
        popular.push(p);
      } else {
        rest.push(p);
      }
    }
    popular.sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
    rest.sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
    const providerList = [...popular, ...rest];

    const keyboard = new InlineKeyboard();
    for (const p of providerList) {
      const name = p.name ?? p.id ?? "unknown";
      keyboard.text(name, `provider:auth:${p.id}`).row();
    }

    await ctx.reply(t("connect.select"), { reply_markup: keyboard });
  } catch (err) {
    logger.error("[Connect] Error:", err);
    await ctx.reply(t("connect.error"));
  }
}

export async function handleProviderAuth(ctx: Context, providerId: string): Promise<void> {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  if (!userId || !chatId) return;

  apiKeyPromptByUser.set(userId, { providerId, chatId });
  await ctx.reply(t("connect.enter_key", { name: providerId }));
  await ctx.answerCallbackQuery();
}

export async function handleProviderApiKey(ctx: Context, apiKey: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const pending = apiKeyPromptByUser.get(userId);
  if (!pending) return;

  apiKeyPromptByUser.delete(userId);

  try {
    const project = getCurrentProject();
    const { error } = await opencodeClient.auth.set({
      providerID: pending.providerId,
      directory: project?.worktree,
      auth: { type: "api", key: apiKey },
    });

    if (error) {
      logger.error("[Connect] Auth set error:", error);
      await ctx.reply(t("connect.auth_error"));
      return;
    }

    await ctx.reply(t("connect.authorized"));
  } catch (err) {
    logger.error("[Connect] Auth set error:", err);
    await ctx.reply(t("connect.auth_error"));
  }
}
