import type { Context } from "grammy";
import type { FilePartInput } from "@opencode-ai/sdk/v2";
import { prepareAttachmentMediaPrompt } from "../../media/ingest.js";
import { extractMessageMetadata, type ResolvedDeferredItem } from "../../media/batch-types.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { downloadTelegramFile } from "../utils/file-download.js";
import { processUserPrompt, type ProcessPromptDeps } from "./prompt.js";

export interface PhotoHandlerDeps extends ProcessPromptDeps {
  downloadFile?: (
    api: Context["api"],
    fileId: string,
  ) => Promise<{ buffer: Buffer; filePath: string }>;
  prepareMediaPrompt?: typeof prepareAttachmentMediaPrompt;
  processPrompt?: (
    ctx: Context,
    text: string,
    deps: ProcessPromptDeps,
    fileParts?: FilePartInput[],
  ) => Promise<boolean>;
  enqueueCorrelatedItem?: (item: ResolvedDeferredItem) => boolean;
  acquireProcessingHold?: () => (() => void) | null;
}

export async function handlePhotoMessage(ctx: Context, deps: PhotoHandlerDeps): Promise<void> {
  const photos = ctx.message?.photo;
  if (!photos || photos.length === 0) {
    return;
  }

  const downloadFile = deps.downloadFile ?? downloadTelegramFile;
  const prepareMediaPrompt = deps.prepareMediaPrompt ?? prepareAttachmentMediaPrompt;
  const processPrompt = deps.processPrompt ?? processUserPrompt;
  const enqueueCorrelatedItem = deps.enqueueCorrelatedItem;
  const acquireProcessingHold = deps.acquireProcessingHold;
  const largestPhoto = photos[photos.length - 1];
  const caption = ctx.message?.caption || "";

  const releaseHold = acquireProcessingHold?.() ?? null;

  await ctx.reply(t("bot.photo_downloading"));

  let downloadedFile: Awaited<ReturnType<typeof downloadTelegramFile>>;

  try {
    downloadedFile = await downloadFile(ctx.api, largestPhoto.file_id);
  } catch (error) {
    logger.error("[Photo] Error downloading photo message:", error);
    await ctx.reply(t("bot.photo_download_error"));
    return;
  }

  try {
    const prepared = await prepareMediaPrompt({
      ctx,
      telegramFileId: largestPhoto.file_id,
      mediaType: "image",
      mimeType: "image/jpeg",
      fallbackFileName: "photo.jpg",
      caption,
      buffer: downloadedFile.buffer,
      onFallbackStart: async () => {
        await ctx.reply(t("bot.photo_processing"));
      },
    });

    if (
      enqueueCorrelatedItem?.({
        correlationId: `photo:${ctx.message?.message_id ?? largestPhoto.file_id}`,
        kind: "photo",
        caption,
        previewText: caption.trim() || prepared.sourceFile.fileName,
        contextText: prepared.promptText,
        metadata: extractMessageMetadata(ctx),
      })
    ) {
      return;
    }

    if (prepared.mode === "attachment") {
      await processPrompt(ctx, prepared.promptText, deps, prepared.fileParts);
      return;
    }

    await processPrompt(ctx, prepared.promptText, deps);
  } catch (error) {
    logger.error("[Photo] Error processing photo message:", error);
    await ctx.reply(t("bot.photo_process_error"));
  } finally {
    releaseHold?.();
  }
}
