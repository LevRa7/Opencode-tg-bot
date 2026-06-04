import type { Context } from "grammy";
import { config } from "../../config.js";
import { prepareAttachmentMediaPrompt } from "../../media/ingest.js";
import { extractMessageMetadata, type ResolvedDeferredItem } from "../../media/batch-types.js";
import { processUserPrompt, type ProcessPromptDeps } from "./prompt.js";
import { downloadTelegramFile, isTextMimeType, isFileSizeAllowed } from "../utils/file-download.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { handleFileAttachment } from "./file-attachment.js";
import type { FilePartInput } from "@opencode-ai/sdk/v2";

export interface DocumentHandlerDeps extends ProcessPromptDeps {
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
  handleFileAttachment?: typeof handleFileAttachment;
}

export async function handleDocumentMessage(
  ctx: Context,
  deps: DocumentHandlerDeps,
): Promise<void> {
  const downloadFile = deps.downloadFile ?? downloadTelegramFile;
  const prepareMediaPrompt = deps.prepareMediaPrompt ?? prepareAttachmentMediaPrompt;
  const processPrompt = deps.processPrompt ?? processUserPrompt;
  const enqueueCorrelatedItem = deps.enqueueCorrelatedItem;
  const acquireProcessingHold = deps.acquireProcessingHold;

  const doc = ctx.message?.document;
  if (!doc) {
    return;
  }

  const caption = ctx.message.caption || "";
  const mimeType = doc.mime_type || "";
  const filename = doc.file_name || "document";

  if (isTextMimeType(mimeType)) {
    if (!isFileSizeAllowed(doc.file_size, config.files.maxFileSizeKb)) {
      logger.warn(
        `[Document] Text file too large: ${filename} (${doc.file_size} bytes > ${config.files.maxFileSizeKb}KB)`,
      );
      await ctx.reply(
        t("bot.text_file_too_large", { maxSizeKb: String(config.files.maxFileSizeKb) }),
      );
      return;
    }

    await ctx.reply(t("bot.file_downloading"));

    let downloadedFile: Awaited<ReturnType<typeof downloadTelegramFile>>;

    const releaseHold = acquireProcessingHold?.() ?? null;

    try {
      downloadedFile = await downloadFile(ctx.api, doc.file_id);
    } catch (error) {
      logger.error("[Document] Error handling document message:", error);
      await ctx.reply(t("bot.file_download_error"));
      return;
    }

    try {
      const textContent = downloadedFile.buffer.toString("utf-8");
      const prepared = await prepareMediaPrompt({
        ctx,
        telegramFileId: doc.file_id,
        mediaType: "text_document",
        mimeType,
        originalFileName: filename,
        fallbackFileName: filename,
        caption,
        buffer: downloadedFile.buffer,
        textContent,
      });

      logger.info(
        `[Document] Sending text file (${downloadedFile.buffer.length} bytes, ${filename}) via shared media prompt`,
      );

      if (
        enqueueCorrelatedItem?.({
          correlationId: `document:${ctx.message?.message_id ?? doc.file_id}`,
          kind: "document",
          caption,
          previewText: caption.trim() || filename,
          contextText: prepared.promptText,
          metadata: extractMessageMetadata(ctx),
        })
      ) {
        return;
      }

      await processPrompt(ctx, prepared.promptText, deps);
      return;
    } catch (error) {
      logger.error("[Document] Error processing document message:", error);
      await ctx.reply(t("bot.file_process_error"));
      return;
    } finally {
      releaseHold?.();
    }
  }

  if (mimeType.startsWith("image/")) {
    await ctx.reply(t("bot.file_downloading"));

    let downloadedFile: Awaited<ReturnType<typeof downloadTelegramFile>>;

    const releaseHold = acquireProcessingHold?.() ?? null;

    try {
      downloadedFile = await downloadFile(ctx.api, doc.file_id);
    } catch (error) {
      logger.error("[Document] Error downloading image document:", error);
      await ctx.reply(t("bot.file_download_error"));
      return;
    }

    try {
      const prepared = await prepareMediaPrompt({
        ctx,
        telegramFileId: doc.file_id,
        mediaType: "image",
        mimeType,
        originalFileName: filename,
        fallbackFileName: filename,
        caption,
        buffer: downloadedFile.buffer,
      });

      logger.info(
        `[Document] Sending image document (${downloadedFile.buffer.length} bytes, ${filename}, ${mimeType}) via shared media prompt`,
      );

      if (
        enqueueCorrelatedItem?.({
          correlationId: `document:${ctx.message?.message_id ?? doc.file_id}`,
          kind: "document",
          caption,
          previewText: caption.trim() || filename,
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
      return;
    } catch (error) {
      logger.error("[Document] Error processing image document:", error);
      await ctx.reply(t("bot.file_process_error"));
      return;
    } finally {
      releaseHold?.();
    }
  }

  if (mimeType === "application/pdf") {
    await ctx.reply(t("bot.file_downloading"));

    let downloadedFile: Awaited<ReturnType<typeof downloadTelegramFile>>;

    const releaseHold = acquireProcessingHold?.() ?? null;

    try {
      downloadedFile = await downloadFile(ctx.api, doc.file_id);
    } catch (error) {
      logger.error("[Document] Error handling document message:", error);
      await ctx.reply(t("bot.file_download_error"));
      return;
    }

    try {
      const prepared = await prepareMediaPrompt({
        ctx,
        telegramFileId: doc.file_id,
        mediaType: "pdf",
        mimeType,
        originalFileName: filename,
        fallbackFileName: filename,
        caption,
        buffer: downloadedFile.buffer,
        onFallbackStart: async () => {
          await ctx.reply(t("bot.file_processing"));
        },
      });

      logger.info(
        `[Document] Sending PDF (${downloadedFile.buffer.length} bytes, ${filename}) via shared media prompt`,
      );

      if (
        enqueueCorrelatedItem?.({
          correlationId: `document:${ctx.message?.message_id ?? doc.file_id}`,
          kind: "document",
          caption,
          previewText: caption.trim() || filename,
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
      return;
    } catch (error) {
      logger.error("[Document] Error processing document message:", error);
      await ctx.reply(t("bot.file_process_error"));
      return;
    } finally {
      releaseHold?.();
    }
  }

  const fileAttachmentHandler = deps.handleFileAttachment ?? handleFileAttachment;
  await fileAttachmentHandler(ctx, deps);
}
