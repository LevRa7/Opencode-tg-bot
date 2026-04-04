import path from "node:path";
import type { Context } from "grammy";
import type { FilePartInput } from "@opencode-ai/sdk/v2";
import { processUserPrompt, type ProcessPromptDeps } from "./prompt.js";
import { downloadTelegramFile, toDataUri } from "../utils/file-download.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";

const TELEGRAM_VIDEO_MAX_DURATION_SEC = 60;

interface VideoMessageInfo {
  fileId: string;
  durationSec: number;
  mimeType: string;
  filename: string;
  kind: "video" | "video_note";
}

export interface VideoHandlerDeps extends ProcessPromptDeps {
  downloadFile?: (
    api: Context["api"],
    fileId: string,
  ) => Promise<{ buffer: Buffer; filePath: string }>;
  processPrompt?: (
    ctx: Context,
    text: string,
    deps: ProcessPromptDeps,
    fileParts?: FilePartInput[],
  ) => Promise<boolean>;
}

function getVideoMessageInfo(ctx: Context): VideoMessageInfo | null {
  const video = ctx.message?.video;
  if (video?.file_id) {
    return {
      fileId: video.file_id,
      durationSec: video.duration,
      mimeType: video.mime_type?.trim() || "video/mp4",
      filename: video.file_name?.trim() || "video.mp4",
      kind: "video",
    };
  }

  const videoNote = ctx.message?.video_note;
  if (videoNote?.file_id) {
    return {
      fileId: videoNote.file_id,
      durationSec: videoNote.duration,
      mimeType: "video/mp4",
      filename: "video-note.mp4",
      kind: "video_note",
    };
  }

  return null;
}

function normalizeVideoFilename(filename: string, filePath: string): string {
  const fallbackName = path.basename(filePath).trim();
  const resolvedName = filename.trim() || fallbackName || "video.mp4";

  if (resolvedName.includes(".")) {
    return resolvedName;
  }

  return `${resolvedName}.mp4`;
}

export async function handleVideoMessage(ctx: Context, deps: VideoHandlerDeps): Promise<void> {
  const downloadFile = deps.downloadFile ?? downloadTelegramFile;
  const processPrompt = deps.processPrompt ?? processUserPrompt;

  const videoInfo = getVideoMessageInfo(ctx);
  if (!videoInfo) {
    return;
  }

  if (videoInfo.durationSec > TELEGRAM_VIDEO_MAX_DURATION_SEC) {
    await ctx.reply(
      t("bot.video_too_long", { maxDurationSec: String(TELEGRAM_VIDEO_MAX_DURATION_SEC) }),
    );
    return;
  }

  const caption = ctx.message?.caption || "";

  try {
    await ctx.reply(t("bot.video_downloading"));
    const downloadedFile = await downloadFile(ctx.api, videoInfo.fileId);
    const mimeType = videoInfo.mimeType.startsWith("video/") ? videoInfo.mimeType : "video/mp4";
    const filePart: FilePartInput = {
      type: "file",
      mime: mimeType,
      filename: normalizeVideoFilename(videoInfo.filename, downloadedFile.filePath),
      url: toDataUri(downloadedFile.buffer, mimeType),
    };

    logger.info(
      `[Video] Sending ${videoInfo.kind} (${downloadedFile.buffer.length} bytes, duration=${videoInfo.durationSec}s) with prompt`,
    );

    await processPrompt(ctx, caption, deps, [filePart]);
  } catch (err) {
    logger.error("[Video] Error handling video message:", err);
    await ctx.reply(t("bot.video_download_error"));
  }
}
