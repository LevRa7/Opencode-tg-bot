import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { Context } from "grammy";
import type { File } from "grammy/types";
import type { FilePartInput } from "@opencode-ai/sdk/v2";
import { prepareAttachmentMediaPrompt } from "../../media/ingest.js";
import {
  compressVideoToBudget,
  MissingVideoCompressionDependencyError,
  OversizedVideoCompressionError,
} from "../../media/video-preprocess.js";
import { processUserPrompt, type ProcessPromptDeps } from "./prompt.js";
import {
  downloadTelegramFile,
  downloadTelegramVideoForCompression,
  type DownloadedFile,
} from "../utils/file-download.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";

const TELEGRAM_VIDEO_MAX_DURATION_SEC = 61;
const TELEGRAM_VIDEO_FAST_PATH_MAX_BYTES = 20 * 1024 * 1024;

interface VideoMessageInfo {
  fileId: string;
  durationSec: number;
  fileSizeBytes?: number;
  mimeType: string;
  filename: string;
  kind: "video" | "video_note";
}

export interface VideoHandlerDeps extends ProcessPromptDeps {
  downloadFile?: (
    api: Context["api"],
    fileId: string,
  ) => Promise<{ buffer: Buffer; filePath: string }>;
  getTelegramFile?: (api: Context["api"], fileId: string) => Promise<File>;
  downloadOversizedVideo?: typeof downloadTelegramVideoForCompression;
  compressVideo?: typeof compressVideoToBudget;
  mkdtemp?: typeof mkdtemp;
  writeFile?: typeof writeFile;
  readFile?: typeof readFile;
  rm?: typeof rm;
  prepareMediaPrompt?: typeof prepareAttachmentMediaPrompt;
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
      fileSizeBytes: video.file_size,
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
      fileSizeBytes: videoNote.file_size,
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

function buildSafeTempVideoFilename(fileId: string): string {
  return `${fileId}.mp4`;
}

function isOversizedTelegramVideo(videoInfo: VideoMessageInfo): boolean {
  return (videoInfo.fileSizeBytes ?? 0) > TELEGRAM_VIDEO_FAST_PATH_MAX_BYTES;
}

async function compressDownloadedVideo(params: {
  videoInfo: VideoMessageInfo;
  downloadedFile: DownloadedFile;
  compressVideo: typeof compressVideoToBudget;
  makeTempDir: typeof mkdtemp;
  writeTempFile: typeof writeFile;
  readCompressedFile: typeof readFile;
  removeTempDir: typeof rm;
}): Promise<DownloadedFile> {
  const tempDirectoryPath = await params.makeTempDir(path.join(tmpdir(), "opencode-video-"));
  const inputFilename = buildSafeTempVideoFilename(params.videoInfo.fileId);
  const inputPath = path.join(tempDirectoryPath, inputFilename);

  try {
    await params.writeTempFile(inputPath, params.downloadedFile.buffer);
    const compressed = await params.compressVideo({
      inputPath,
      outputDirectoryPath: tempDirectoryPath,
    });
    const compressedBuffer = await params.readCompressedFile(compressed.outputPath);

    return {
      buffer: compressedBuffer,
      filePath: compressed.outputPath,
      mimeType: "video/mp4",
    };
  } finally {
    await params.removeTempDir(tempDirectoryPath, { force: true, recursive: true }).catch(() => {});
  }
}

async function resolveVideoFileSizeBytes(params: {
  ctx: Context;
  videoInfo: VideoMessageInfo;
  getTelegramFile: (api: Context["api"], fileId: string) => Promise<File>;
}): Promise<number | undefined> {
  if (typeof params.videoInfo.fileSizeBytes === "number") {
    return params.videoInfo.fileSizeBytes;
  }

  const file = await params.getTelegramFile(params.ctx.api, params.videoInfo.fileId);
  return file.file_size;
}

export async function handleVideoMessage(ctx: Context, deps: VideoHandlerDeps): Promise<void> {
  const downloadFile = deps.downloadFile ?? downloadTelegramFile;
  const getTelegramFile = deps.getTelegramFile ?? ((api, fileId) => api.getFile(fileId));
  const downloadOversizedVideo = deps.downloadOversizedVideo ?? downloadTelegramVideoForCompression;
  const compressVideo = deps.compressVideo ?? compressVideoToBudget;
  const makeTempDir = deps.mkdtemp ?? mkdtemp;
  const writeTempFile = deps.writeFile ?? writeFile;
  const readCompressedFile = deps.readFile ?? readFile;
  const removeTempDir = deps.rm ?? rm;
  const prepareMediaPrompt = deps.prepareMediaPrompt ?? prepareAttachmentMediaPrompt;
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

  let downloadedFile: DownloadedFile;
  let promptFilename = videoInfo.filename;
  let promptMimeType = videoInfo.mimeType.startsWith("video/") ? videoInfo.mimeType : "video/mp4";
  let requiresCompression = false;

  try {
    const resolvedFileSizeBytes = await resolveVideoFileSizeBytes({
      ctx,
      videoInfo,
      getTelegramFile,
    });
    requiresCompression = isOversizedTelegramVideo({
      ...videoInfo,
      fileSizeBytes: resolvedFileSizeBytes,
    });

    await ctx.reply(t("bot.video_downloading"));
    downloadedFile = requiresCompression
      ? await downloadOversizedVideo(ctx.api, videoInfo.fileId)
      : await downloadFile(ctx.api, videoInfo.fileId);
  } catch (error) {
    logger.error("[Video] Error handling video message:", error);
    await ctx.reply(t("bot.video_download_error"));
    return;
  }

  if (requiresCompression) {
    try {
      await ctx.reply(t("bot.video_compressing"));
      downloadedFile = await compressDownloadedVideo({
        videoInfo,
        downloadedFile,
        compressVideo,
        makeTempDir,
        writeTempFile,
        readCompressedFile,
        removeTempDir,
      });
      promptFilename = normalizeVideoFilename(path.basename(downloadedFile.filePath), downloadedFile.filePath);
      promptMimeType = "video/mp4";
    } catch (error) {
      logger.error("[Video] Error preprocessing oversized video:", error);

      if (error instanceof MissingVideoCompressionDependencyError) {
        await ctx.reply(t("bot.video_compression_requires_ffmpeg"));
        return;
      }

      if (error instanceof OversizedVideoCompressionError) {
        await ctx.reply(t("bot.video_compression_failed"));
        return;
      }

      await ctx.reply(t("bot.video_compression_failed"));
      return;
    }
  }

  try {
    const prepared = await prepareMediaPrompt({
      ctx,
      telegramFileId: videoInfo.fileId,
      mediaType: "video",
      mimeType: promptMimeType,
      originalFileName: promptFilename,
      fallbackFileName: promptFilename,
      caption,
      buffer: downloadedFile.buffer,
      onFallbackStart: async () => {
        await ctx.reply(t("bot.video_processing"));
      },
    });

    logger.info(
      `[Video] Sending ${videoInfo.kind} (${downloadedFile.buffer.length} bytes, duration=${videoInfo.durationSec}s) via shared media prompt`,
    );

    if (prepared.mode === "attachment") {
      await processPrompt(ctx, prepared.promptText, deps, prepared.fileParts);
      return;
    }

    await processPrompt(ctx, prepared.promptText, deps);
  } catch (error) {
    logger.error("[Video] Error processing video message:", error);
    await ctx.reply(t("bot.video_process_error"));
  }
}
