import { AsyncLocalStorage } from "node:async_hooks";
import type { Api, RawApi } from "grammy";

type SendMessageApi = Pick<Api<RawApi>, "sendMessage">;
type SendMessageChatId = Parameters<SendMessageApi["sendMessage"]>[0];
type SendMessageText = Parameters<SendMessageApi["sendMessage"]>[1];
type SendMessageOptions = Parameters<SendMessageApi["sendMessage"]>[2];

const sendMessageDraftEffectSuppressionStorage = new AsyncLocalStorage<boolean>();

export function isSendMessageDraftEffectSuppressed(): boolean {
  return sendMessageDraftEffectSuppressionStorage.getStore() === true;
}

export function runWithoutSendMessageDraftEffect<T>(fn: () => T): T {
  return sendMessageDraftEffectSuppressionStorage.run(true, fn);
}

export function sendMessageWithoutDraftEffect(
  api: SendMessageApi,
  chatId: SendMessageChatId,
  text: SendMessageText,
  options?: SendMessageOptions,
) {
  return runWithoutSendMessageDraftEffect(() => api.sendMessage(chatId, text, options));
}
