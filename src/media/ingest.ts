import type { Model } from "@opencode-ai/sdk/v2";
import type { Context } from "grammy";
import { toDataUri } from "../bot/utils/file-download.js";
import { getCurrentOpencodeRoute } from "../opencode/client.js";
import { isSttConfigured, transcribeAudio, type SttResult } from "../stt/client.js";
import { logger } from "../utils/logger.js";
import { getModelCapabilities, supportsAttachment, supportsInput } from "../model/capabilities.js";
import { getStoredModel } from "../model/manager.js";
import { saveIncomingMediaFile } from "./storage.js";
import { transcribeStoredMedia } from "./transcriber.js";
import type {
  MediaStorageOwner,
  MediaTranscriberKind,
  PreparedMediaPrompt,
  StoredMediaType,
} from "./types.js";

type AttachmentPromptMediaType = Extract<
  StoredMediaType,
  "image" | "pdf" | "video" | "text_document"
>;
type AttachmentSupportedInput = Extract<StoredMediaType, "image" | "pdf" | "video">;
type PreparedAudioPrompt = Extract<PreparedMediaPrompt, { mode: "text" }> & {
  recognizedText: string;
};

interface PrepareAttachmentMediaPromptParams {
  ctx: Context;
  telegramFileId: string;
  mediaType: AttachmentPromptMediaType;
  mimeType: string;
  originalFileName?: string;
  fallbackFileName: string;
  caption: string;
  buffer: Buffer;
  textContent?: string;
  onFallbackStart?: () => void | Promise<void>;
  saveIncomingMediaFile?: typeof saveIncomingMediaFile;
  getStoredModel?: typeof getStoredModel;
  getModelCapabilities?: (
    providerID: string,
    modelID: string,
  ) => Promise<Model["capabilities"] | null>;
  transcribeStoredMedia?: typeof transcribeStoredMedia;
}

interface PrepareAudioPromptParams {
  ctx: Context;
  telegramFileId: string;
  mimeType: string;
  originalFileName?: string;
  fallbackFileName: string;
  buffer: Buffer;
  onFallbackStart?: () => void | Promise<void>;
  saveIncomingMediaFile?: typeof saveIncomingMediaFile;
  transcribeStoredMedia?: typeof transcribeStoredMedia;
  isSttConfigured?: typeof isSttConfigured;
  transcribeAudio?: (audioBuffer: Buffer, filename: string) => Promise<SttResult>;
}

function resolveTranscriberKind(mediaType: AttachmentPromptMediaType): MediaTranscriberKind {
  switch (mediaType) {
    case "image":
      return "photo";
    case "pdf":
    case "text_document":
      return "document";
    case "video":
      return "video";
  }
}

function getAttachmentInputType(mediaType: AttachmentSupportedInput): AttachmentSupportedInput {
  return mediaType;
}

function resolveAttachmentFileName(params: {
  originalFileName?: string;
  fallbackFileName: string;
}): string {
  return params.originalFileName?.trim() || params.fallbackFileName;
}

export function resolveMediaStorageOwner(ctx: Context): MediaStorageOwner {
  const userId = ctx.from?.id;
  if (typeof userId !== "number") {
    throw new Error("Telegram context is missing from.id for media storage");
  }

  const route = getCurrentOpencodeRoute();
  if (route.kind === "tenant") {
    return {
      userId,
      runtimeKind: "tenant",
      tenantId: route.tenantId ?? `tg-${userId}`,
    };
  }

  return {
    userId,
    runtimeKind: "host",
  };
}

export function buildStoredMediaPrompt(params: {
  runtimeVisiblePath: string;
  extractedText: string;
  caption: string;
  processingError?: string;
}): string {
  const sections = [
    "Telegram media was already processed locally.",
    "Use the saved file path only when you need to reference the uploaded file in this session; otherwise use the processed result below as the source of truth.",
    `Saved file path:\n${params.runtimeVisiblePath}`,
  ];

  if (params.processingError?.trim()) {
    sections.push(`Media processing failed:\n${params.processingError.trim()}`);
  }

  if (params.extractedText.trim().length > 0) {
    sections.push(`Processed media result:\n${params.extractedText}`);
  }

  if (params.caption.trim().length > 0) {
    sections.push(`User caption/instruction:\n${params.caption}`);
  }

  return sections.join("\n\n");
}

function formatMediaProcessingError(_error: unknown): string {
  return "Media processing failed after the file was saved.";
}

function buildStoredMediaPathPrompt(params: {
  runtimeVisiblePath: string;
  caption: string;
}): string {
  return buildStoredMediaPrompt({
    runtimeVisiblePath: params.runtimeVisiblePath,
    extractedText: "",
    caption: params.caption,
  });
}

export async function prepareAttachmentMediaPrompt(
  params: PrepareAttachmentMediaPromptParams,
): Promise<PreparedMediaPrompt> {
  const saveFile = params.saveIncomingMediaFile ?? saveIncomingMediaFile;
  const readStoredModel = params.getStoredModel ?? getStoredModel;
  const readModelCapabilities = params.getModelCapabilities ?? getModelCapabilities;
  const transcribeMedia = params.transcribeStoredMedia ?? transcribeStoredMedia;
  const transcriberKind = resolveTranscriberKind(params.mediaType);

  const sourceFile = await saveFile({
    owner: resolveMediaStorageOwner(params.ctx),
    telegramFileId: params.telegramFileId,
    originalFileName: params.originalFileName,
    fallbackFileName: params.fallbackFileName,
    mimeType: params.mimeType,
    mediaType: params.mediaType,
    buffer: params.buffer,
  });

  if (params.mediaType === "text_document") {
    const extractedText = params.textContent ?? params.buffer.toString("utf-8");
    return {
      mode: "text",
      promptText: buildStoredMediaPrompt({
        runtimeVisiblePath: sourceFile.runtimeVisiblePath,
        extractedText,
        caption: params.caption,
      }),
      sourceFile,
      transcriberKind,
    };
  }

  const storedModel = readStoredModel();
  const capabilities = await readModelCapabilities(storedModel.providerID, storedModel.modelID);
  const inputType = getAttachmentInputType(params.mediaType);

  if (supportsInput(capabilities, inputType) && supportsAttachment(capabilities)) {
    let promptText = buildStoredMediaPathPrompt({
      runtimeVisiblePath: sourceFile.runtimeVisiblePath,
      caption: params.caption,
    });

    if (inputType === "video") {
      try {
        await params.onFallbackStart?.();
        const extractedText = await transcribeMedia({
          kind: transcriberKind,
          hostAbsolutePath: sourceFile.hostAbsolutePath,
        });
        if (extractedText.trim().length > 0) {
          promptText = buildStoredMediaPrompt({
            runtimeVisiblePath: sourceFile.runtimeVisiblePath,
            extractedText: `Transcribed video audio:\n${extractedText}`,
            caption: params.caption,
          });
        }
      } catch (error) {
        logger.warn(
          "[Media] Video transcription in attachment mode failed, using caption only",
          error,
        );
      }
    }

    return {
      mode: "attachment",
      promptText,
      fileParts: [
        {
          type: "file",
          mime: params.mimeType,
          filename: resolveAttachmentFileName({
            originalFileName: params.originalFileName,
            fallbackFileName: params.fallbackFileName,
          }),
          url: toDataUri(params.buffer, params.mimeType),
        },
      ],
      sourceFile,
      transcriberKind,
    };
  }

  await params.onFallbackStart?.();
  let extractedText = "";
  let processingError: string | undefined;

  try {
    extractedText = await transcribeMedia({
      kind: transcriberKind,
      hostAbsolutePath: sourceFile.hostAbsolutePath,
    });
  } catch (error) {
    processingError = formatMediaProcessingError(error);
    logger.error("[Media] Stored media transcription failed after saving file", error);
  }

  return {
    mode: "text",
    promptText: buildStoredMediaPrompt({
      runtimeVisiblePath: sourceFile.runtimeVisiblePath,
      extractedText,
      caption: params.caption,
      processingError,
    }),
    sourceFile,
    transcriberKind,
  };
}

export async function prepareAudioPrompt(
  params: PrepareAudioPromptParams,
): Promise<PreparedAudioPrompt> {
  const saveFile = params.saveIncomingMediaFile ?? saveIncomingMediaFile;
  const sttConfigured = params.isSttConfigured ?? isSttConfigured;
  const transcribeWithStt = params.transcribeAudio ?? transcribeAudio;
  const transcribeMedia = params.transcribeStoredMedia ?? transcribeStoredMedia;

  const sourceFile = await saveFile({
    owner: resolveMediaStorageOwner(params.ctx),
    telegramFileId: params.telegramFileId,
    originalFileName: params.originalFileName,
    fallbackFileName: params.fallbackFileName,
    mimeType: params.mimeType,
    mediaType: "audio",
    buffer: params.buffer,
  });

  if (sttConfigured()) {
    try {
      const result = await transcribeWithStt(params.buffer, sourceFile.fileName);
      const recognizedText = result.text.trim();

      if (recognizedText.length === 0) {
        logger.warn(
          "[MediaIngest] Remote audio STT returned empty text, falling back to stored-media transcription",
        );
      } else {
        return {
          mode: "text",
          recognizedText,
          promptText: buildStoredMediaPrompt({
            runtimeVisiblePath: sourceFile.runtimeVisiblePath,
            extractedText: recognizedText,
            caption: "",
          }),
          sourceFile,
          transcriberKind: "audio",
        };
      }
    } catch (error) {
      logger.warn(
        "[MediaIngest] Remote audio STT failed, falling back to stored-media transcription",
        error,
      );
    }
  }

  await params.onFallbackStart?.();

  try {
    const recognizedText = await transcribeMedia({
      kind: "audio",
      hostAbsolutePath: sourceFile.hostAbsolutePath,
    });

    return {
      mode: "text",
      recognizedText,
      promptText: buildStoredMediaPrompt({
        runtimeVisiblePath: sourceFile.runtimeVisiblePath,
        extractedText: recognizedText,
        caption: "",
      }),
      sourceFile,
      transcriberKind: "audio",
    };
  } catch (error) {
    logger.error("[MediaIngest] Stored-media audio transcription failed after saving file", error);
    const recognizedText = "";

    return {
      mode: "text",
      recognizedText,
      promptText: buildStoredMediaPrompt({
        runtimeVisiblePath: sourceFile.runtimeVisiblePath,
        extractedText: recognizedText,
        caption: "",
        processingError: formatMediaProcessingError(error),
      }),
      sourceFile,
      transcriberKind: "audio",
    };
  }
}
