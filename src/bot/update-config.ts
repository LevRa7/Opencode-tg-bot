import type { Api, Context } from "grammy";

export const TELEGRAM_ALLOWED_UPDATES: ReadonlyArray<Exclude<keyof Context["update"], "update_id">> = [
  "message",
  "edited_message",
  "channel_post",
  "edited_channel_post",
  "callback_query",
  "inline_query",
  "chosen_inline_result",
  "my_chat_member",
  "chat_member",
  "chat_join_request",
  "poll",
  "poll_answer",
  "message_reaction",
];

export interface TelegramWebhookConfig {
  baseUrl: string;
  path: string;
  secret: string;
}

export function normalizeTelegramWebhookPath(path: string): string {
  const trimmedPath = path.trim();
  if (!trimmedPath) {
    return "/telegram/webhook";
  }
  return trimmedPath.startsWith("/") ? trimmedPath : `/${trimmedPath}`;
}

export function buildTelegramWebhookUrl(config: TelegramWebhookConfig): string {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  return `${baseUrl}${normalizeTelegramWebhookPath(config.path)}`;
}

type TelegramWebhookApi = Pick<Api, "getWebhookInfo" | "setWebhook" | "deleteWebhook">;

interface TelegramWebhookInfoLike {
  url?: string;
  pending_update_count: number;
  last_error_date?: number;
}

export function isTelegramWebhookDeliveryUnhealthy(
  webhookInfo: TelegramWebhookInfoLike,
  startupUnixSeconds: number,
): boolean {
  if (!webhookInfo.url || webhookInfo.pending_update_count <= 0) {
    return false;
  }

  return (webhookInfo.last_error_date ?? 0) >= startupUnixSeconds;
}

export async function switchTelegramToPolling(api: TelegramWebhookApi): Promise<void> {
  const webhookInfo = await api.getWebhookInfo();
  if (webhookInfo.url) {
    await api.deleteWebhook();
  }
}

export async function ensureTelegramWebhook(api: TelegramWebhookApi, config: TelegramWebhookConfig): Promise<string> {
  const webhookUrl = buildTelegramWebhookUrl(config);
  const webhookInfo = await api.getWebhookInfo();

  if (webhookInfo.url !== webhookUrl) {
    await api.setWebhook(webhookUrl, {
      allowed_updates: TELEGRAM_ALLOWED_UPDATES,
      secret_token: config.secret,
    });
  }

  return webhookUrl;
}
