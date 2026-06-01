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

// === /connect command ===

export async function connectCommand(ctx: Context): Promise<void> {
  try {
    const project = getCurrentProject();
    const [{ data: providerData }, { data: authData }] = await Promise.all([
      opencodeClient.provider.list({ directory: project?.worktree }),
      opencodeClient.provider.auth({ directory: project?.worktree }),
    ]);

    const rawList = (providerData as any)?.all ?? (providerData as any)?.providers ?? [];
    const authMethods = (authData as Record<string, Array<{ type: string; label: string }>>) ?? {};

    if (rawList.length === 0) {
      await ctx.reply(t("connect.empty"));
      return;
    }

    // Sort: popular first, then alphabetical
    const popular: any[] = [];
    const rest: any[] = [];
    for (const p of rawList) {
      const id = (p.id ?? p.name ?? "").toLowerCase();
      (POPULAR_PROVIDERS.some(pp => id.includes(pp)) ? popular : rest).push(p);
    }
    popular.sort((a: any, b: any) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
    rest.sort((a: any, b: any) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
    const providerList = [...popular, ...rest];

    // Show providers with auth status
    let text = t("connect.select") + "\n\n";
    for (const p of providerList) {
      const id = p.id ?? p.name;
      const methods = authMethods[id] ?? [];
      const methodIcons = methods.map((m: any) => m.type === "oauth" ? "🔐" : "🔑").join("");
      text += `${methodIcons} <b>${p.name ?? id}</b>\n`;
    }

    await ctx.reply(text, { parse_mode: "HTML" });

    // Build keyboard with provider buttons
    const keyboard = new InlineKeyboard();
    for (const p of providerList) {
      const name = p.name ?? p.id ?? "unknown";
      keyboard.text(name, `provider:auth:${p.id}`).row();
    }

    await ctx.reply(t("connect.pick"), { reply_markup: keyboard });
  } catch (err) {
    logger.error("[Connect] Error:", err);
    await ctx.reply(t("connect.error"));
  }
}

// === Provider selection → show auth methods ===

export async function handleProviderAuth(ctx: Context, providerId: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const project = getCurrentProject();
    const { data: authData } = await opencodeClient.provider.auth({
      directory: project?.worktree,
    });

    const methods = (authData as Record<string, any[]>)?.[providerId] ?? [];
    if (methods.length === 0) {
      await ctx.reply(t("connect.no_methods"));
      await ctx.answerCallbackQuery();
      return;
    }

    // Only one method — execute directly
    if (methods.length === 1) {
      if (methods[0].type === "api") {
        await startApiKeyFlow(ctx, providerId);
      } else if (methods[0].type === "oauth") {
        await startOAuthFlow(ctx, providerId, 0);
      }
      return;
    }

    // Multiple methods — show choice
    const keyboard = new InlineKeyboard();
    methods.forEach((m: any, i: number) => {
      const label = m.type === "oauth" ? `🔐 ${m.label}` : `🔑 ${m.label}`;
      keyboard.text(label, `provider:start:${providerId}:${i}`).row();
    });

    await ctx.reply(t("connect.choose_method"), { reply_markup: keyboard });
    await ctx.answerCallbackQuery();
  } catch (err) {
    logger.error("[Connect] Auth methods error:", err);
    await ctx.reply(t("connect.auth_error"));
    await ctx.answerCallbackQuery();
  }
}

// === Start specific auth method ===

export async function startProviderAuth(ctx: Context, providerId: string, methodIndex: number): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const project = getCurrentProject();
    const { data: authData } = await opencodeClient.provider.auth({
      directory: project?.worktree,
    });

    const methods = (authData as Record<string, any[]>)?.[providerId] ?? [];
    if (methodIndex >= methods.length) {
      await ctx.reply(t("connect.auth_error"));
      await ctx.answerCallbackQuery();
      return;
    }

    if (methods[methodIndex].type === "api") {
      await startApiKeyFlow(ctx, providerId);
    } else {
      await startOAuthFlow(ctx, providerId, methodIndex);
    }
  } catch (err) {
    logger.error("[Connect] Start auth error:", err);
    await ctx.reply(t("connect.auth_error"));
    await ctx.answerCallbackQuery();
  }
}

async function startApiKeyFlow(ctx: Context, providerId: string): Promise<void> {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  if (!userId || !chatId) return;

  apiKeyPromptByUser.set(userId, { providerId, chatId });
  await ctx.reply(t("connect.enter_key", { name: providerId }));
  await ctx.answerCallbackQuery();
}

async function startOAuthFlow(ctx: Context, providerId: string, methodIndex: number): Promise<void> {
  try {
    const project = getCurrentProject();
    const { data, error } = await opencodeClient.provider.oauth.authorize({
      providerID: providerId,
      directory: project?.worktree,
      method: methodIndex,
    });

    if (error) {
      logger.error("[Connect] OAuth authorize error:", error);
      await ctx.reply(t("connect.auth_error"));
      await ctx.answerCallbackQuery();
      return;
    }

    const authData = data as { url?: string; instructions?: string };
    if (authData?.url) {
      await ctx.reply(t("connect.auth_url", { url: authData.url }));
    } else {
      await ctx.reply(t("connect.authorized"));
    }
    await ctx.answerCallbackQuery();
  } catch (err) {
    logger.error("[Connect] OAuth error:", err);
    await ctx.reply(t("connect.auth_error"));
    await ctx.answerCallbackQuery();
  }
}

// === Handle API key submission ===

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
