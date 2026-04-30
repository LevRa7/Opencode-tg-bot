import type { Api, RawApi } from "grammy";
import { withTelegramRateLimitRetry } from "../../utils/telegram-rate-limit-retry.js";

type SafeTelegramApi = Pick<
  Api<RawApi>,
  "sendMessage" | "editMessageText" | "deleteMessage" | "sendMessageDraft"
>;

type SendMessageArgs = Parameters<SafeTelegramApi["sendMessage"]>;
type EditMessageTextArgs = Parameters<SafeTelegramApi["editMessageText"]>;
type DeleteMessageArgs = Parameters<SafeTelegramApi["deleteMessage"]>;
type SendMessageDraftArgs = Parameters<SafeTelegramApi["sendMessageDraft"]>;

export interface SafeTelegramSender {
  sendMessage: (...args: SendMessageArgs) => ReturnType<SafeTelegramApi["sendMessage"]>;
  editMessageText: (...args: EditMessageTextArgs) => ReturnType<SafeTelegramApi["editMessageText"]>;
  deleteMessage: (...args: DeleteMessageArgs) => ReturnType<SafeTelegramApi["deleteMessage"]>;
  sendMessageDraft: (...args: SendMessageDraftArgs) => ReturnType<SafeTelegramApi["sendMessageDraft"]>;
}

export function createSafeTelegramSender(api: SafeTelegramApi): SafeTelegramSender {
  return {
    sendMessage: (...args) => withTelegramRateLimitRetry(() => api.sendMessage(...args)),
    editMessageText: (...args) => withTelegramRateLimitRetry(() => api.editMessageText(...args)),
    deleteMessage: (...args) => withTelegramRateLimitRetry(() => api.deleteMessage(...args)),
    sendMessageDraft: (...args) => withTelegramRateLimitRetry(() => api.sendMessageDraft(...args)),
  };
}
