import { Context, InlineKeyboard } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentProject } from "../../settings/manager.js";
import { processManager } from "../../process/manager.js";
import { getCurrentOpencodeRoute, getHostOpencodeClient } from "../../opencode/client.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { clearActiveInlineMenu } from "../handlers/inline-menu.js";
import { execSync } from "node:child_process";
import { sshManager } from "../../utils/ssh-manager.js";

const POPULAR_PROVIDERS = ["openai", "google", "anthropic", "deepseek", "vertex", "perplexity"];
const apiKeyPromptByUser = new Map<number, { providerId: string; chatId: number }>();
const oauthCallbackByUser = new Map<number, { providerId: string; chatId: number; methodIndex: number }>();

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

export function isAnyProviderPrompt(userId: number): boolean {
  return apiKeyPromptByUser.has(userId) || oauthCallbackByUser.has(userId);
}

function compareProviders(a: any, b: any): number {
  return (a.name ?? a.id ?? "").localeCompare(b.name ?? b.id ?? "");
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
    const hasAuth = new Set(Object.keys(authData as Record<string, any>));
    const popular: any[] = [], rest: any[] = [];
    for (const p of rawList) {
      const id = p.id ?? p.name ?? "";
      const provider = { ...p, hasAuth: hasAuth.has(id) };
      (POPULAR_PROVIDERS.some(pp => id.toLowerCase().includes(pp)) ? popular : rest).push(provider);
    }
    popular.sort(compareProviders);
    rest.sort(compareProviders);
    const providerList = [...popular, ...rest];
    const keyboard = new InlineKeyboard();
    for (const p of providerList) {
      keyboard.text((p.hasAuth ? "🔑 " : "🔧 ") + (p.name ?? p.id ?? "?"), "provider:auth:" + (p.id ?? p.name)).row();
    }
    keyboard.text(t("inline.button.cancel"), "connect:cancel").row();
    await ctx.reply(t("connect.select"), { reply_markup: keyboard });
  } catch (err) { logger.error("[Connect] Error:", err); clearActiveInlineMenu("connect_error"); await ctx.reply(t("connect.error")); }
}

export async function handleProviderAuth(ctx: Context, providerId: string): Promise<void> {
  try {
    // Remove the method selection keyboard
    if (ctx.callbackQuery?.message?.message_id) {
      ctx.api.editMessageReplyMarkup(ctx.chat!.id!, ctx.callbackQuery.message.message_id, {}).catch(() => {});
    }
    const project = getCurrentProject();
    const { data: authData } = await opencodeClient.provider.auth({ directory: project?.worktree });
    const methods = (authData as Record<string, any[]>)?.[providerId] ?? [];
    logger.debug("[Connect] methods for", providerId, ":", methods.length);
    // Provider has no registered auth methods — go straight to API key entry
    if (methods.length === 0) {
      await startApiKeyFlow(ctx, providerId);
      return;
    }
    if (methods.length === 1) {
      if (methods[0].type === "api") await startApiKeyFlow(ctx, providerId);
      else await startOAuthFlow(ctx, providerId, 0);
      return;
    }
    const keyboard = new InlineKeyboard();
    methods.forEach((m: any, i: number) => {
      keyboard.text((m.type === "oauth" ? "🔐 " : "🔑 ") + m.label, "provider:start:" + providerId + ":" + i).row();
    });
    keyboard.text(t("inline.button.cancel"), "connect:cancel").row();
    const msg = await ctx.reply(t("connect.choose_method"), { reply_markup: keyboard });
    // Store messageId so the keyboard can be removed after selection
    (ctx as any)._connectMethodMsgId = msg.message_id;
    await ctx.answerCallbackQuery();
  } catch (err) { clearActiveInlineMenu("connect_error"); await ctx.reply(t("connect.auth_error")); await ctx.answerCallbackQuery(); }
}

export async function startProviderAuth(ctx: Context, providerId: string, methodIndex: number): Promise<void> {
  try {
    // Remove the method selection keyboard after user made a choice
    if (ctx.callbackQuery?.message?.message_id) {
      ctx.api.editMessageReplyMarkup(ctx.chat!.id!, ctx.callbackQuery.message.message_id, { reply_markup: undefined }).catch(() => {});
    }
    const project = getCurrentProject();
    const { data: authData } = await opencodeClient.provider.auth({ directory: project?.worktree });
    const methods = (authData as Record<string, any[]>)?.[providerId] ?? [];
    if (methodIndex >= methods.length) { await ctx.reply(t("connect.auth_error")); await ctx.answerCallbackQuery(); return; }
    if (methods[methodIndex].type === "api") await startApiKeyFlow(ctx, providerId);
    else await startOAuthFlow(ctx, providerId, methodIndex);
  } catch (err) { clearActiveInlineMenu("connect_error"); await ctx.reply(t("connect.auth_error")); await ctx.answerCallbackQuery(); }
}

async function startApiKeyFlow(ctx: Context, providerId: string): Promise<void> {
  const userId = ctx.from?.id, chatId = ctx.chat?.id;
  if (!userId || !chatId) return;
  apiKeyPromptByUser.set(userId, { providerId, chatId });
  clearActiveInlineMenu("connect_api_key_prompt");
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
      if (userId && chatId) oauthCallbackByUser.set(userId, { providerId, chatId, methodIndex });
      clearActiveInlineMenu("connect_oauth_prompt");
      await ctx.reply(t("connect.auth_url", { url: authData.url }));
      await ctx.reply(t("connect.oauth_callback_prompt", { name: providerId }));
    } else {
      await ctx.reply(t("connect.authorized"));
    }
    await ctx.answerCallbackQuery();
  } catch (err) { clearActiveInlineMenu("connect_error"); await ctx.reply(t("connect.auth_error")); await ctx.answerCallbackQuery(); }
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
      logger.debug("[Connect] API key auth.set for", keyPending.providerId, "route:", getCurrentOpencodeRoute().runtimeKey);
      const { error } = await opencodeClient.auth.set({ providerID: keyPending.providerId, directory: project?.worktree, auth: { type: "api", key: text } });
      logger.debug("[Connect] auth.set result:", JSON.stringify({ error: !!error }));
      if (error) { logger.error("[Connect] auth.set error:", error); await ctx.reply(t("connect.auth_error")); return; }
      await ctx.reply(t("connect.authorized"));
      clearActiveInlineMenu("connect_success");
      await ctx.reply("Restarting OpenCode server to apply changes...");
      await restartProviderServer();
      await ctx.reply("Server restarted. Provider available in /model.");
    } catch (err) { clearActiveInlineMenu("connect_error"); await ctx.reply(t("connect.auth_error")); }
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
      logger.debug("[Connect] OAuth callback:", oauthPending.providerId, "codeLen:", code.length, "method:", oauthPending.methodIndex);
      // Set a 30s timeout via AbortController to prevent hanging
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      try {
        const result = await opencodeClient.provider.oauth.callback({
        providerID: oauthPending.providerId,
        method: oauthPending.methodIndex,
        directory: project?.worktree,
        code,
      });
      const error = result?.error;
      if (error) { logger.error("[Connect] OAuth callback error:", error); clearActiveInlineMenu("connect_error"); await ctx.reply(t("connect.auth_error")); return; }
      await ctx.reply(t("connect.authorized"));
      clearActiveInlineMenu("connect_success");
      await ctx.reply("Restarting OpenCode server to apply changes...");
      await restartProviderServer();
      await ctx.reply("Server restarted. Provider available in /model.");
      } finally {
        clearTimeout(timeout);
      }
    } catch (err: any) { 
      if (err?.name === "AbortError") {
        logger.error("[Connect] OAuth callback timed out after 30s");
      } else {
        logger.error("[Connect] OAuth callback error:", err);
      }
      clearActiveInlineMenu("connect_error"); 
      await ctx.reply(t("connect.auth_error")); 
    }
    return;
  }
}

async function restartProviderServer(): Promise<void> {
  const route = getCurrentOpencodeRoute();
  if (route.runtimeKey.startsWith("ssh:")) {
    const userId = route.userId;
    if (userId) {
      try {
        const containerName = "opencode-serve-tg-" + userId;
        logger.info("[Connect] Restarting Docker container " + containerName);
        execSync("docker stop " + containerName, { timeout: 15000 });
        execSync("docker start " + containerName, { timeout: 15000 });
        logger.info("[Connect] Docker container restarted, rebuilding tunnel...");
        // Rebuild SSH tunnel to match new container port
        const sshUser = route.userId;
        if (sshUser) {
          try {
            await sshManager.bootstrapRemoteServer(sshUser);
          } catch (e) {
            logger.error("[Connect] Tunnel rebuild error:", e);
          }
        }
        await new Promise(r => setTimeout(r, 3000));
      } catch (err) {
        logger.error("[Connect] Docker restart error:", err);
      }
    }
    return;
  }
  if (route.kind === "host") {
    await processManager.stop();
    await processManager.start();
  } else {
    await processManager.restartTenantRuntimes();
  }
}
