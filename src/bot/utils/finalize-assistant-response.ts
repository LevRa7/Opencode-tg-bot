import type { StreamingMessagePayload, ResponseStreamer } from "../streaming/response-streamer.js";
import { logger } from "../../utils/logger.js";
import type { TelegramRenderedPart } from "../../telegram/render/types.js";

interface FinalizeAssistantResponseOptions {
  sessionId: string;
  messageId: string;
  messageText: string;
  sourceCommand?: string;
  responseStreamer: Pick<ResponseStreamer, "complete">;
  flushPendingServiceMessages: () => Promise<void>;
  prepareStreamingPayload: (messageText: string) => StreamingMessagePayload | null;
  renderFinalParts: (messageText: string) => TelegramRenderedPart[];
  getReplyKeyboard: () => unknown | Promise<unknown>;
  sendRenderedPart: (
    part: TelegramRenderedPart,
    options:
      | {
          reply_markup?: unknown;
          disable_notification?: boolean;
        }
      | undefined,
  ) => Promise<void>;
}

function shouldAutoExpandReplyKeyboard(sourceCommand?: string): boolean {
  return sourceCommand === "/start" || sourceCommand === "/help" || sourceCommand === "/new";
}

export async function finalizeAssistantResponse({
  sessionId,
  messageId,
  messageText,
  sourceCommand,
  responseStreamer,
  flushPendingServiceMessages,
  prepareStreamingPayload,
  renderFinalParts,
  getReplyKeyboard,
  sendRenderedPart,
}: FinalizeAssistantResponseOptions): Promise<{ streamed: boolean; telegramMessageIds: number[] }> {
  logger.debug(
    `[FinalizeResponse] Final assistant raw text received: session=${sessionId}, message=${messageId}`,
    messageText,
  );

  const keyboard = await getReplyKeyboard();
  const replyOptions = keyboard ? { reply_markup: keyboard } : undefined;
  const silentReplyOptions = {
    disable_notification: true,
    ...(replyOptions ?? {}),
  };
  const streamSendOptions = {
    ...(shouldAutoExpandReplyKeyboard(sourceCommand)
      ? silentReplyOptions
      : { disable_notification: true }),
  } as StreamingMessagePayload["sendOptions"];

  const preparedStreamPayload = prepareStreamingPayload(messageText);
  if (preparedStreamPayload) {
    preparedStreamPayload.sendOptions = streamSendOptions;
    preparedStreamPayload.editOptions = undefined;
  }

  await flushPendingServiceMessages();

  const result = await responseStreamer.complete(
    sessionId,
    messageId,
    preparedStreamPayload ?? undefined,
  );

  if (result.streamed) {
    logger.debug(
      `[FinalizeResponse] Finalized streamed assistant message in place: session=${sessionId}, message=${messageId}, telegramMessages=${result.telegramMessageIds.length}`,
    );
    return { streamed: true, telegramMessageIds: result.telegramMessageIds };
  }

  const parts = renderFinalParts(messageText);

  for (const part of parts) {
    await sendRenderedPart(part, silentReplyOptions);
  }

  return { streamed: false, telegramMessageIds: [] };
}
