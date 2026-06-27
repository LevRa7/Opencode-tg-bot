import type { Api, RawApi } from "grammy";
import type { SendBotTextParams, TelegramTextFormat } from "../utils/telegram-text.js";
import type { TelegramDeliveryTarget } from "../utils/message-thread.js";

type SendMessageApi = Pick<Api<RawApi>, "sendMessage">;
type TelegramSendMessageOptions = Parameters<SendMessageApi["sendMessage"]>[2];

export type ChildTopicDeliveryKind =
  | "live_text"
  | "diagnostic"
  | "terminal_footer"
  | "interactive_prompt"
  | "file_or_media_notice";

export interface ChildTopicDeliveryRequest {
  sessionId: string;
  kind: ChildTopicDeliveryKind;
  text?: string;
  format?: TelegramTextFormat;
  options?: TelegramSendMessageOptions;
  rawFallbackText?: string;
}

export interface ChildTopicDeliveryDependencies {
  getRoutingApi(sessionId: string): SendMessageApi | null;
  getDeliveryTarget(sessionId: string): TelegramDeliveryTarget | null;
  withTopicReopenClose<T>(sessionId: string, fn: () => Promise<T>): Promise<T>;
  sendText(params: SendBotTextParams): Promise<number | null>;
}

/**
 * Transport used by the child-topic delivery dependency.
 *
 * Mirrors {@link ChildTopicDeliveryDependencies.sendText}: takes Telegram send
 * params and returns the created message id (or null when nothing was sent).
 */
export type ChildTopicSendText = (params: SendBotTextParams) => Promise<number | null>;

/**
 * Adapts the streaming Telegram transport into the child-topic `sendText`
 * dependency.
 *
 * Why: child-session final answers and topic notices previously went out through
 * a plain one-shot send that did not opt into HTML fallback, so they bypassed the
 * rich rendering used by the main assistant streaming pipeline. Wiring the
 * dependency through the streaming transport with `useHtmlFallback` enabled gives
 * child-topic messages the same rich/edit-capable delivery path, while keeping the
 * dispatcher (`deliverChildTopicMessage`) free of transport details.
 */
export function createStreamedChildTopicSendText(send: ChildTopicSendText): ChildTopicSendText {
  return (params) => send({ ...params, useHtmlFallback: true });
}

export async function deliverChildTopicMessage(
  dependencies: ChildTopicDeliveryDependencies,
  request: ChildTopicDeliveryRequest,
): Promise<number | null> {
  const text = request.text;
  if (!text?.trim()) {
    return null;
  }

  return dependencies.withTopicReopenClose(request.sessionId, async () => {
    const api = dependencies.getRoutingApi(request.sessionId);
    const target = dependencies.getDeliveryTarget(request.sessionId);
    if (!api || !target) {
      return null;
    }

    switch (request.kind) {
      case "live_text":
      case "diagnostic":
      case "terminal_footer":
      case "interactive_prompt":
      case "file_or_media_notice":
        return dependencies.sendText({
          api,
          chatId: target.chatId,
          text,
          rawFallbackText: request.rawFallbackText,
          format: request.format,
          messageThreadId: target.messageThreadId,
          deliveryTarget: target,
          options: request.options,
        });
      default:
        throw new Error(`Unsupported child topic delivery kind: ${String(request.kind)}`);
    }
  });
}
