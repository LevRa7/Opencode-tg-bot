import { InputFile, type Api, type RawApi } from "grammy";
import { consumePromptResponseMode } from "../handlers/prompt.js";
import { isTtsConfigured, synthesizeSpeech, type TtsResult } from "../../tts/client.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { withMessageThreadId } from "./message-thread.js";

const MAX_TTS_INPUT_CHARS = 4_000;

type SendAudioApi = Pick<Api<RawApi>, "sendAudio">;
type SendMessageApi = Pick<Api<RawApi>, "sendMessage">;

type TelegramAudioOptions = Parameters<SendAudioApi["sendAudio"]>[2];
type TelegramSendMessageOptions = Parameters<SendMessageApi["sendMessage"]>[2];

interface TelegramAudioApi {
  sendAudio: (chatId: number, audio: InputFile, options?: TelegramAudioOptions) => Promise<unknown>;
  sendMessage: (
    chatId: number,
    text: string,
    options?: TelegramSendMessageOptions,
  ) => Promise<unknown>;
}

interface SendTtsResponseParams {
  api: TelegramAudioApi;
  sessionId: string;
  chatId: number;
  text: string;
  messageThreadId?: number;
  consumeResponseMode?: (sessionId: string) => "text_only" | "text_and_tts" | null;
  isTtsConfigured?: () => boolean;
  synthesizeSpeech?: (text: string) => Promise<TtsResult>;
}

export async function sendTtsResponseForSession({
  api,
  sessionId,
  chatId,
  text,
  messageThreadId,
  consumeResponseMode: consumeResponseModeImpl = consumePromptResponseMode,
  isTtsConfigured: isTtsConfiguredImpl = isTtsConfigured,
  synthesizeSpeech: synthesizeSpeechImpl = synthesizeSpeech,
}: SendTtsResponseParams): Promise<boolean> {
  const responseMode = consumeResponseModeImpl(sessionId);
  if (responseMode !== "text_and_tts") {
    return false;
  }

  const normalizedText = text.trim();
  if (!normalizedText) {
    return false;
  }

  if (!isTtsConfiguredImpl()) {
    logger.info(`[TTS] Skipping audio reply for session ${sessionId}: TTS is not configured`);
    return false;
  }

  if (normalizedText.length > MAX_TTS_INPUT_CHARS) {
    logger.warn(
      `[TTS] Skipping audio reply for session ${sessionId}: text length ${normalizedText.length} exceeds limit ${MAX_TTS_INPUT_CHARS}`,
    );
    return false;
  }

  try {
    const speech = await synthesizeSpeechImpl(normalizedText);
    await api.sendAudio(
      chatId,
      new InputFile(speech.buffer, speech.filename),
      withMessageThreadId(undefined, messageThreadId),
    );
    logger.info(`[TTS] Sent audio reply for session ${sessionId}`);
    return true;
  } catch (error) {
    logger.warn(`[TTS] Failed to send audio reply for session ${sessionId}`, error);

    await api
      .sendMessage(chatId, t("tts.failed"), withMessageThreadId(undefined, messageThreadId))
      .catch((sendError) => {
        logger.warn(`[TTS] Failed to send audio error message for session ${sessionId}`, sendError);
      });

    return false;
  }
}
