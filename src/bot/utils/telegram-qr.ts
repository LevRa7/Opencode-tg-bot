import { InputFile, type Api, type RawApi } from "grammy";
import QRCode from "qrcode";
import { logger } from "../../utils/logger.js";
import { withMessageThreadId } from "./message-thread.js";

type SendPhotoApi = Pick<Api<RawApi>, "sendPhoto">;
export type SendTelegramQrApi = SendPhotoApi;
type TelegramSendPhotoOptions = Parameters<SendPhotoApi["sendPhoto"]>[2];

const LOGIN_URL_PATTERN = /tg:\/\/login\?token=[A-Za-z0-9_-]+/g;
const MAX_QR_IMAGES_PER_MESSAGE = 3;

export interface TelegramQrPayload {
  loginUrl: string;
}

interface SendTelegramQrImagesParams {
  api: SendTelegramQrApi;
  chatId: number;
  messageText: string;
  options?: TelegramSendPhotoOptions;
  messageThreadId?: number;
}

export function extractTelegramQrPayloads(messageText: string): TelegramQrPayload[] {
  const urls = messageText.match(LOGIN_URL_PATTERN) ?? [];
  const unique = new Map<string, TelegramQrPayload>();

  for (const loginUrl of urls) {
    if (!unique.has(loginUrl)) {
      unique.set(loginUrl, { loginUrl });
    }
  }

  return [...unique.values()].slice(0, MAX_QR_IMAGES_PER_MESSAGE);
}

async function renderQrBuffer(payload: TelegramQrPayload): Promise<Buffer> {
  return await QRCode.toBuffer(payload.loginUrl, {
    type: "png",
    margin: 1,
    width: 512,
    errorCorrectionLevel: "M",
  });
}

function buildQrCaption(payload: TelegramQrPayload, index: number, total: number): string {
  return total > 1 ? `QR code ${index + 1}/${total}\n${payload.loginUrl}` : payload.loginUrl;
}

export async function sendTelegramQrImages({
  api,
  chatId,
  messageText,
  options,
  messageThreadId,
}: SendTelegramQrImagesParams): Promise<number> {
  const payloads = extractTelegramQrPayloads(messageText);
  if (payloads.length === 0) {
    return 0;
  }

  let sentCount = 0;

  for (let index = 0; index < payloads.length; index++) {
    const payload = payloads[index]!;

    try {
      const buffer = await renderQrBuffer(payload);
      await api.sendPhoto(
        chatId,
        new InputFile(buffer, `telegram-login-qr-${index + 1}.png`),
        withMessageThreadId(
          {
            ...options,
            caption: buildQrCaption(payload, index, payloads.length),
          },
          messageThreadId,
        ),
      );
      sentCount += 1;
    } catch (error) {
      logger.warn("[Bot] Failed to send QR image to Telegram", error);
    }
  }

  return sentCount;
}
