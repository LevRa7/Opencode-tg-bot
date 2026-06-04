import type { Context } from "grammy";
import { downloadTelegramFile } from "../utils/file-download.js";
import { saveAttachment, buildAttachmentsTag, resolveMimeType } from "../utils/download-path-upload.js";
import { processUserPrompt, type ProcessPromptDeps } from "./prompt.js";
import { extractMessageMetadata, type ResolvedDeferredItem } from "../../media/batch-types.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";

export interface FileAttachmentHandlerDeps extends ProcessPromptDeps {
  downloadFile?: typeof downloadTelegramFile;
  processPrompt?: typeof processUserPrompt;
  enqueueCorrelatedItem?: (item: ResolvedDeferredItem) => boolean;
  acquireProcessingHold?: () => (() => void) | null;
}

export async function handleFileAttachment(
  ctx: Context,
  deps: FileAttachmentHandlerDeps,
): Promise<void> {
  const doc = ctx.message?.document;
  if (!doc) return;

  const downloadFile = deps.downloadFile ?? downloadTelegramFile;
  const processPrompt = deps.processPrompt ?? processUserPrompt;
  const enqueueCorrelatedItem = deps.enqueueCorrelatedItem;
  const acquireProcessingHold = deps.acquireProcessingHold;

  const caption = ctx.message.caption || "";
  const mimeType = doc.mime_type || "";
  const filename = doc.file_name || "file";

  await ctx.reply(t("bot.file_downloading"));

  let downloadedFile: Awaited<ReturnType<typeof downloadTelegramFile>>;

  const releaseHold = acquireProcessingHold?.() ?? null;

  try {
    downloadedFile = await downloadFile(ctx.api, doc.file_id);
  } catch (error) {
    logger.error("[FileAttachment] Error downloading file:", error);
    await ctx.reply(t("bot.file_download_error"));
    return;
  }

  try {
    const resolvedMime = resolveMimeType(mimeType, filename, downloadedFile.buffer);

    const saved = await saveAttachment(
      downloadedFile.buffer,
      filename,
      resolvedMime,
    );

    const attachmentsTag = buildAttachmentsTag([saved]);

    const enrichedText = caption
      ? `${caption}${attachmentsTag}`
      : attachmentsTag;

    logger.info(
      `[FileAttachment] Saved ${filename} (${saved.sizeLabel}) at ${saved.absolutePath}`,
    );

    if (
      enqueueCorrelatedItem?.({
        correlationId: `attachment:${ctx.message?.message_id ?? doc.file_id}`,
        kind: "document",
        caption,
        previewText: caption.trim() || filename,
        contextText: enrichedText,
        metadata: extractMessageMetadata(ctx),
      })
    ) {
      return;
    }

    await processPrompt(ctx, enrichedText, deps);
  } catch (error) {
    logger.error("[FileAttachment] Error processing file attachment:", error);
    await ctx.reply(t("bot.file_process_error"));
  } finally {
    releaseHold?.();
  }
}
