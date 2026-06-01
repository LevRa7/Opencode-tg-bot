import { Context, InlineKeyboard } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentProject } from "../../settings/manager.js";
import { processManager } from "../../process/manager.js";
import { getCurrentOpencodeRoute } from "../../opencode/client.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";

const POPULAR_PROVIDERS = ["openai", "google", "anthropic", "deepseek", "vertex", "perplexity"];
const apiKeyPromptByUser = new Map<number, { providerId: string; chatId: number }>();
const oauthCallbackByUser = new Map<number, { providerId: string; chatId: number }>();

export function isProviderApiKeyPrompt(userId: number): string | undefined {
  return apiKeyPromptByUser.get(userId)?.providerId;
}
export function clearProviderApiKeyPrompt(userId: number): void {
  apiKeyPromptByUser.delete(userId);
}
export function isOAuthCallbackPrompt(userId: number): string | undefined {
  return oauthCallbackByUser.get(userId)?.providerId;
}
export function clearOAuthCallbackPrompt(userId: number): void {
  oauthCallbackByUser.delete(userId);
}

// === Prompt interceptor for BOTH API key and OAuth code ===
export function isAnyProviderPrompt(userId: number): boolean {
  return apiKeyPromptByUser.has(userId) || oauthCallbackByUser.has(userId);
}

export async function connectCommand(ctx: Context): Promise<void> {
  try {
    const project = getCurrentProject();
    const [{ data: providerData }, { data: authData }] = await Promise.all([
      opencodeClient.provider.list({ directory: project?.worktree }),
      opencodeClient.provider.auth({ directory: project?.worktree }),
    ]);
    const rawList = (providerData as any)?.all ?? (providerData as any)?.providers ?? [];
    if (rawList.length === 0) { await ctx.reply(t("connect.empty")); return; }
    const popular: any[] = [], rest: any[] = [];
    for (const p of rawList) {
      (POPULAR_PROVIDERS.some(pp => (p.id ?? p.name ?? "").toLowerCase().includes(pp)) ? popular : rest).push(p);
    }
    popular.sort((a: any,b: any) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
    rest.sort((a: any,b: any) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
    const providerList = [...popular, ...rest];
    const keyboard = new InlineKeyboard();
    for (const p of providerList) keyboard.text(p.name ?? p.id ?? "?", "provider:auth:" + p.id).row();
    await ctx.reply(t("connect.select"), { reply_markup: keyboard });
  } catch (err) { logger.error("[Connect] Error:", err); await ctx.reply(t("connect.error")); }
}

export async function handleProviderAuth(ctx: Context, providerId: string): Promise<void> {
  try {
    const project = getCurrentProject();
    const { data: authData } = await opencodeClient.provider.auth({ directory: project?.worktree });
    const methods = (authData as Record<string, any[]>)?.[providerId] ?? [];
    if (methods.length === 0) { await ctx.reply(t("connect.no_methods")); await ctx.answerCallbackQuery(); return; }
    if (methods.length === 1) {
      if (methods[0].type === "api") await startApiKeyFlow(ctx, providerId);
      else await startOAuthFlow(ctx, providerId, 0);
      return;
    }
    const keyboard = new InlineKeyboard();
    methods.forEach((m: any, i: number) => {
      keyboard.text((m.type === "oauth" ? "🔐 " : "🔑 ") + m.label, "provider:start:" + providerId + ":" + i).row();
    });
    await ctx.reply(t("connect.choose_method"), { reply_markup: keyboard });
    await ctx.answerCallbackQuery();
  } catch (err) { await ctx.reply(t("connect.auth_error")); await ctx.answerCallbackQuery(); }
}

export async function startProviderAuth(ctx: Context, providerId: string, methodIndex: number): Promise<void> {
  try {
    const project = getCurrentProject();
    const { data: authData } = await opencodeClient.provider.auth({ directory: project?.worktree });
    const methods = (authData as Record<string, any[]>)?.[providerId] ?? [];
    if (methodIndex >= methods.length) { await ctx.reply(t("connect.auth_error")); await ctx.answerCallbackQuery(); return; }
    if (methods[methodIndex].type === "api") await startApiKeyFlow(ctx, providerId);
    else await startOAuthFlow(ctx, providerId, methodIndex);
  } catch (err) { await ctx.reply(t("connect.auth_error")); await ctx.answerCallbackQuery(); }
}

async function startApiKeyFlow(ctx: Context, providerId: string): Promise<void> {
  const userId = ctx.from?.id, chatId = ctx.chat?.id;
  if (!userId || !chatId) return;
  apiKeyPromptByUser.set(userId, { providerId, chatId });
  await ctx.reply(t("connect.enter_key", { name: providerId }));
  await ctx.answerCallbackQuery();
}

async function startOAuthFlow(ctx: Context, providerId: string, methodIndex: number): Promise<void> {
  try {
    const project = getCurrentProject();
    const { data, error } = await opencodeClient.provider.oauth.authorize({ providerID: providerId, directory: project?.worktree, method: methodIndex });
    if (error) { await ctx.reply(t("connect.auth_error")); await ctx.answerCallbackQuery(); return; }
    const authData = data as { url?: string };
    if (authData?.url) {
      const userId = ctx.from?.id, chatId = ctx.chat?.id;
      if (userId && chatId) oauthCallbackByUser.set(userId, { providerId, chatId });
      await ctx.reply(t("connect.auth_url", { url: authData.url }));
      await ctx.reply(t("connect.oauth_callback_prompt", { name: providerId }));
    } else {
      await ctx.reply(t("connect.authorized"));
    }
    await ctx.answerCallbackQuery();
  } catch (err) { await ctx.reply(t("connect.auth_error")); await ctx.answerCallbackQuery(); }
}

// === Handle API key OR OAuth code submission ===

export async function handleProviderInput(ctx: Context, text: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  // API key prompt
  const keyPending = apiKeyPromptByUser.get(userId);
  if (keyPending) {
    apiKeyPromptByUser.delete(userId);
    try {
      const project = getCurrentProject();
      const { error } = await opencodeClient.auth.set({ providerID: keyPending.providerId, directory: project?.worktree, auth: { type: "api", key: text } });
      if (error) { await ctx.reply(t("connect.auth_error")); return; }
      await ctx.reply(t("connect.authorized"));
      await ctx.reply("Restarting OpenCode server to apply changes...");
      await processManager.restartTenantRuntimes();
      await ctx.reply("Server restarted. Provider available in /model.");
    } catch (err) { await ctx.reply(t("connect.auth_error")); }
    return;
  }

  // OAuth callback
  const oauthPending = oauthCallbackByUser.get(userId);
  if (oauthPending) {
    oauthCallbackByUser.delete(userId);
    try {
      // Parse code from URL if full callback URL was pasted
      let code = text;
      try {
        const url = new URL(text);
        const codeParam = url.searchParams.get("code");
        if (codeParam) code = codeParam;
      } catch {}
      
      const project = getCurrentProject();
      const { error } = await opencodeClient.provider.oauth.callback({ providerID: oauthPending.providerId, directory: project?.worktree, code });
      if (error) { logger.error("[Connect] OAuth callback error:", error); await ctx.reply(t("connect.auth_error")); return; }
      await ctx.reply(t("connect.authorized"));
      await ctx.reply("Restarting OpenCode server to apply changes...");
        const route = getCurrentOpencodeRoute();
  if (route.kind === "host") {
    await processManager.stop();
    await processManager.start();
  } else {
    await processManager.restartTenantRuntimes();
  }
      await ctx.reply("Server restarted. Provider available in /model.");
    } catch (err) { logger.error("[Connect] OAuth callback error:", err); await ctx.reply(t("connect.auth_error")); }
    return;
  }
}
