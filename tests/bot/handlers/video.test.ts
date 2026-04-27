import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { handleVideoMessage, type VideoHandlerDeps } from "../../../src/bot/handlers/video.js";
import { t } from "../../../src/i18n/index.js";
import {
  MissingVideoCompressionDependencyError,
  OversizedVideoCompressionError,
} from "../../../src/media/video-preprocess.js";
import { logger } from "../../../src/utils/logger.js";

function createVideoContext(overrides: Partial<Context["message"]> = {}): {
  ctx: Context;
  replyMock: ReturnType<typeof vi.fn>;
} {
  const replyMock = vi.fn().mockResolvedValue({ message_id: 101 });

  const ctx = {
    chat: { id: 777 },
    from: { id: 123 },
    message: {
      message_id: 10,
      video: {
        file_id: "video-file-id",
        file_unique_id: "video-unique-id",
        duration: 42,
        width: 640,
        height: 360,
        mime_type: "video/mp4",
        file_name: "clip.mp4",
        file_size: 2048,
      },
      caption: "Summarize this video",
      ...overrides,
    },
    reply: replyMock,
    api: {
      getFile: vi.fn(),
    },
  } as unknown as Context;

  return { ctx, replyMock };
}

function createVideoDeps(overrides: Partial<VideoHandlerDeps> = {}): {
  deps: VideoHandlerDeps;
  processPromptMock: ReturnType<typeof vi.fn>;
  downloadMock: ReturnType<typeof vi.fn>;
  prepareMediaPromptMock: ReturnType<typeof vi.fn>;
} {
  const processPromptMock = vi.fn().mockResolvedValue(true);
  const downloadMock = vi.fn().mockResolvedValue({
    buffer: Buffer.from("video-binary"),
    filePath: "videos/clip.mp4",
  });
  const prepareMediaPromptMock = vi.fn().mockResolvedValue({
    mode: "attachment",
    promptText: "Summarize this video",
    fileParts: [
      {
        type: "file",
        mime: "video/mp4",
        filename: "clip.mp4",
        url: "data:video/mp4;base64,dmlkZW8tYmluYXJ5",
      },
    ],
  });

  const deps: VideoHandlerDeps = {
    bot: {} as VideoHandlerDeps["bot"],
    ensureEventSubscription: vi.fn().mockResolvedValue(undefined),
    downloadFile: downloadMock,
    prepareMediaPrompt: prepareMediaPromptMock,
    processPrompt: processPromptMock,
    acquireProcessingHold: vi.fn(() => vi.fn()),
    enqueueCorrelatedItem: vi.fn(() => false),
    ...overrides,
  };

  return {
    deps,
    processPromptMock,
    downloadMock,
    prepareMediaPromptMock: deps.prepareMediaPrompt as ReturnType<typeof vi.fn>,
  };
}

describe("bot/handlers/video", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("routes supported videos through shared media preparation and sends attachment file parts", async () => {
    const { ctx, replyMock } = createVideoContext();
    const { deps, processPromptMock, downloadMock, prepareMediaPromptMock } = createVideoDeps();

    await handleVideoMessage(ctx, deps);

    expect(replyMock).toHaveBeenCalledWith(t("bot.video_downloading"));
    expect(downloadMock).toHaveBeenCalledWith(ctx.api, "video-file-id");
    expect(prepareMediaPromptMock).toHaveBeenCalledWith({
      ctx,
      telegramFileId: "video-file-id",
      mediaType: "video",
      mimeType: "video/mp4",
      originalFileName: "clip.mp4",
      fallbackFileName: "clip.mp4",
      caption: "Summarize this video",
      buffer: Buffer.from("video-binary"),
      onFallbackStart: expect.any(Function),
    });
    expect(processPromptMock).toHaveBeenCalledWith(
      ctx,
      "Summarize this video",
      deps,
      expect.arrayContaining([
        expect.objectContaining({
          type: "file",
          mime: "video/mp4",
          filename: "clip.mp4",
        }),
      ]),
    );
  });

  it("acquires and releases the processing hold during standalone video preprocessing", async () => {
    const { ctx } = createVideoContext();
    const releaseHoldMock = vi.fn();
    const acquireProcessingHoldMock = vi.fn(() => releaseHoldMock);
    const enqueueCorrelatedItemMock = vi.fn(() => false);
    const { deps, processPromptMock } = createVideoDeps({
      acquireProcessingHold: acquireProcessingHoldMock,
      enqueueCorrelatedItem: enqueueCorrelatedItemMock,
    });

    await handleVideoMessage(ctx, deps);

    expect(acquireProcessingHoldMock).toHaveBeenCalledTimes(1);
    expect(releaseHoldMock).toHaveBeenCalledTimes(1);
    expect(enqueueCorrelatedItemMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "video",
      }),
    );
    expect(processPromptMock).toHaveBeenCalled();
  });

  it("accepts video notes and uses default file metadata", async () => {
    const { ctx } = createVideoContext({
      video: undefined,
      video_note: {
        file_id: "video-note-file-id",
        file_unique_id: "video-note-unique-id",
        duration: 12,
        length: 240,
        file_size: 1024,
      },
      caption: undefined,
    });
    const { deps, processPromptMock, downloadMock } = createVideoDeps({
      downloadFile: vi.fn().mockResolvedValue({
        buffer: Buffer.from("video-note"),
        filePath: "video_notes/circle-note",
      }),
    });
    const prepareMediaPromptMock = vi.fn().mockResolvedValue({
      mode: "attachment",
      promptText: "",
      fileParts: [
        {
          type: "file",
          mime: "video/mp4",
          filename: "video-note.mp4",
          url: "data:video/mp4;base64,dmlkZW8tbm90ZQ==",
        },
      ],
    });
    deps.prepareMediaPrompt = prepareMediaPromptMock;

    await handleVideoMessage(ctx, deps);

    expect(downloadMock).not.toHaveBeenCalled();
    expect(deps.downloadFile as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      ctx.api,
      "video-note-file-id",
    );
    expect(prepareMediaPromptMock).toHaveBeenCalledWith({
      ctx,
      telegramFileId: "video-note-file-id",
      mediaType: "video",
      mimeType: "video/mp4",
      originalFileName: "video-note.mp4",
      fallbackFileName: "video-note.mp4",
      caption: "",
      buffer: Buffer.from("video-note"),
      onFallbackStart: expect.any(Function),
    });
    expect(processPromptMock).toHaveBeenCalledWith(
      ctx,
      "",
      deps,
      expect.arrayContaining([
        expect.objectContaining({
          type: "file",
          mime: "video/mp4",
          filename: "video-note.mp4",
        }),
      ]),
    );
  });

  it("sends processing status and dispatches fallback text prompts for unsupported video input", async () => {
    const { ctx, replyMock } = createVideoContext({ caption: "Explain this clip" });
    const { deps, processPromptMock } = createVideoDeps({
      prepareMediaPrompt: vi.fn().mockImplementation(async (params) => {
        await params.onFallbackStart?.();
        return {
          mode: "text",
          promptText: "prepared video fallback text",
        };
      }),
    });

    await handleVideoMessage(ctx, deps);

    expect(replyMock).toHaveBeenNthCalledWith(1, t("bot.video_downloading"));
    expect(replyMock).toHaveBeenNthCalledWith(2, t("bot.video_processing"));
    expect(processPromptMock).toHaveBeenCalledWith(ctx, "prepared video fallback text", deps);
  });

  it("rejects videos longer than 61 seconds", async () => {
    const { ctx, replyMock } = createVideoContext({
      video: {
        file_id: "video-file-id",
        file_unique_id: "video-unique-id",
        duration: 62,
        width: 640,
        height: 360,
        mime_type: "video/mp4",
        file_name: "long.mp4",
        file_size: 2048,
      },
    });
    const { deps, downloadMock, processPromptMock } = createVideoDeps();

    await handleVideoMessage(ctx, deps);

    expect(replyMock).toHaveBeenCalledWith(t("bot.video_too_long", { maxDurationSec: "61" }));
    expect(downloadMock).not.toHaveBeenCalled();
    expect(processPromptMock).not.toHaveBeenCalled();
  });

  it("accepts videos up to 61 seconds", async () => {
    const { ctx, replyMock } = createVideoContext({
      video: {
        file_id: "video-file-id",
        file_unique_id: "video-unique-id",
        duration: 61,
        width: 640,
        height: 360,
        mime_type: "video/mp4",
        file_name: "allowed.mp4",
        file_size: 2048,
      },
    });
    const { deps, downloadMock, processPromptMock } = createVideoDeps();

    await handleVideoMessage(ctx, deps);

    expect(replyMock).toHaveBeenCalledWith(t("bot.video_downloading"));
    expect(downloadMock).toHaveBeenCalledWith(ctx.api, "video-file-id");
    expect(processPromptMock).toHaveBeenCalled();
  });

  it("downloads oversized videos for compression, shows compression status, and sends the derivative", async () => {
    const { ctx, replyMock } = createVideoContext({
      video: {
        file_id: "oversized-video-id",
        file_unique_id: "oversized-video-unique-id",
        duration: 61,
        width: 1920,
        height: 1080,
        mime_type: "video/mp4",
        file_name: "oversized.mp4",
        file_size: 25 * 1024 * 1024,
      },
    });

    const oversizedDownloadMock = vi.fn().mockResolvedValue({
      buffer: Buffer.from("oversized-video-binary"),
      filePath: "videos/oversized.mp4",
    });
    const compressVideoMock = vi.fn().mockResolvedValue({
      outputPath: "/tmp/oversized-compressed.mp4",
      sizeBytes: 1024,
      preset: { maxSide: 960, fps: 15 },
    });
    const compressedBuffer = Buffer.from("compressed-video-binary");
    const readFileMock = vi.fn().mockResolvedValue(compressedBuffer);
    const mkdtempMock = vi.fn().mockResolvedValue("/tmp/video-handler-123");
    const writeFileMock = vi.fn().mockResolvedValue(undefined);
    const rmMock = vi.fn().mockResolvedValue(undefined);
    const { deps, downloadMock, prepareMediaPromptMock, processPromptMock } = createVideoDeps({
      downloadOversizedVideo: oversizedDownloadMock,
      compressVideo: compressVideoMock,
      readFile: readFileMock,
      mkdtemp: mkdtempMock,
      writeFile: writeFileMock,
      rm: rmMock,
    });

    await handleVideoMessage(ctx, deps);

    expect(downloadMock).not.toHaveBeenCalled();
    expect(oversizedDownloadMock).toHaveBeenCalledWith(ctx.api, "oversized-video-id");
    expect(replyMock).toHaveBeenNthCalledWith(1, t("bot.video_downloading"));
    expect(replyMock).toHaveBeenNthCalledWith(2, t("bot.video_compressing"));
    expect(mkdtempMock).toHaveBeenCalled();
    expect(writeFileMock).toHaveBeenCalledWith(
      expect.stringContaining("oversized-video-id.mp4"),
      Buffer.from("oversized-video-binary"),
    );
    expect(compressVideoMock).toHaveBeenCalledWith({
      inputPath: expect.stringContaining("oversized-video-id.mp4"),
      outputDirectoryPath: "/tmp/video-handler-123",
    });
    expect(readFileMock).toHaveBeenCalledWith("/tmp/oversized-compressed.mp4");
    expect(prepareMediaPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        telegramFileId: "oversized-video-id",
        mimeType: "video/mp4",
        originalFileName: "oversized-compressed.mp4",
        fallbackFileName: "oversized-compressed.mp4",
        buffer: compressedBuffer,
      }),
    );
    expect(processPromptMock).toHaveBeenCalled();
    expect(rmMock).toHaveBeenCalledWith("/tmp/video-handler-123", { force: true, recursive: true });
  });

  it("uses compressed mp4 metadata for prompt preparation after compressing oversized mov input", async () => {
    const { ctx } = createVideoContext({
      video: {
        file_id: "oversized-mov-id",
        file_unique_id: "oversized-mov-unique-id",
        duration: 45,
        width: 1920,
        height: 1080,
        mime_type: "video/quicktime",
        file_name: "oversized.mov",
        file_size: 25 * 1024 * 1024,
      },
    });

    const compressedBuffer = Buffer.from("compressed-mov-video-binary");
    const { deps, prepareMediaPromptMock } = createVideoDeps({
      downloadOversizedVideo: vi.fn().mockResolvedValue({
        buffer: Buffer.from("oversized-mov-binary"),
        filePath: "videos/oversized.mov",
      }),
      compressVideo: vi.fn().mockResolvedValue({
        outputPath: "/tmp/oversized-compressed-960x15.mp4",
        sizeBytes: 1024,
        preset: { maxSide: 960, fps: 15 },
      }),
      readFile: vi.fn().mockResolvedValue(compressedBuffer),
      mkdtemp: vi.fn().mockResolvedValue("/tmp/video-handler-mov"),
      writeFile: vi.fn().mockResolvedValue(undefined),
      rm: vi.fn().mockResolvedValue(undefined),
    });

    await handleVideoMessage(ctx, deps);

    expect(prepareMediaPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType: "video/mp4",
        originalFileName: "oversized-compressed-960x15.mp4",
        fallbackFileName: "oversized-compressed-960x15.mp4",
        buffer: compressedBuffer,
      }),
    );
  });

  it("does not use untrusted Telegram filename when creating the temporary input path", async () => {
    const { ctx } = createVideoContext({
      video: {
        file_id: "oversized-weird-name-id",
        file_unique_id: "oversized-weird-name-unique-id",
        duration: 45,
        width: 1920,
        height: 1080,
        mime_type: "video/quicktime",
        file_name: "../../../../escape.mov",
        file_size: 25 * 1024 * 1024,
      },
    });

    const writeFileMock = vi.fn().mockResolvedValue(undefined);
    const { deps } = createVideoDeps({
      downloadOversizedVideo: vi.fn().mockResolvedValue({
        buffer: Buffer.from("oversized-video-binary"),
        filePath: "videos/original.mov",
      }),
      compressVideo: vi.fn().mockResolvedValue({
        outputPath: "/tmp/compressed-safe-name.mp4",
        sizeBytes: 1024,
        preset: { maxSide: 960, fps: 15 },
      }),
      readFile: vi.fn().mockResolvedValue(Buffer.from("compressed-video-binary")),
      mkdtemp: vi.fn().mockResolvedValue("/tmp/video-handler-safe-name"),
      writeFile: writeFileMock,
      rm: vi.fn().mockResolvedValue(undefined),
    });

    await handleVideoMessage(ctx, deps);

    expect(writeFileMock).toHaveBeenCalledWith(
      expect.stringContaining("oversized-weird-name-id"),
      Buffer.from("oversized-video-binary"),
    );
    expect(writeFileMock.mock.calls[0]?.[0]).not.toContain("escape.mov");
    expect(writeFileMock.mock.calls[0]?.[0]).not.toContain("..");
  });

  it("uses the compression-capable path when telegram message metadata omits file size", async () => {
    const { ctx } = createVideoContext({
      video: {
        file_id: "missing-size-video-id",
        file_unique_id: "missing-size-video-unique-id",
        duration: 45,
        width: 1920,
        height: 1080,
        mime_type: "video/mp4",
        file_name: "missing-size.mp4",
        file_size: undefined,
      },
    });

    const regularDownloadMock = vi
      .fn()
      .mockRejectedValue(new Error("should not use default downloader"));
    const oversizedDownloadMock = vi.fn().mockResolvedValue({
      buffer: Buffer.from("oversized-video-binary"),
      filePath: "videos/missing-size.mp4",
    });
    const apiGetFileMock = vi.fn().mockResolvedValue({
      file_path: "videos/missing-size.mp4",
      file_size: 25 * 1024 * 1024,
    });
    ctx.api.getFile = apiGetFileMock;

    const { deps } = createVideoDeps({
      downloadFile: regularDownloadMock,
      downloadOversizedVideo: oversizedDownloadMock,
      compressVideo: vi.fn().mockResolvedValue({
        outputPath: "/tmp/missing-size-compressed.mp4",
        sizeBytes: 1024,
        preset: { maxSide: 960, fps: 15 },
      }),
      readFile: vi.fn().mockResolvedValue(Buffer.from("compressed-video-binary")),
      mkdtemp: vi.fn().mockResolvedValue("/tmp/video-handler-missing-size"),
      writeFile: vi.fn().mockResolvedValue(undefined),
      rm: vi.fn().mockResolvedValue(undefined),
    });

    await handleVideoMessage(ctx, deps);

    expect(apiGetFileMock).toHaveBeenCalledWith("missing-size-video-id");
    expect(regularDownloadMock).not.toHaveBeenCalled();
    expect(oversizedDownloadMock).toHaveBeenCalledWith(ctx.api, "missing-size-video-id");
  });

  it("cleans up temp directory when compressed artifact readback fails", async () => {
    const { ctx, replyMock } = createVideoContext({
      video: {
        file_id: "oversized-video-id",
        file_unique_id: "oversized-video-unique-id",
        duration: 30,
        width: 1920,
        height: 1080,
        mime_type: "video/mp4",
        file_name: "oversized.mp4",
        file_size: 25 * 1024 * 1024,
      },
    });

    const rmMock = vi.fn().mockResolvedValue(undefined);
    const { deps, processPromptMock, prepareMediaPromptMock } = createVideoDeps({
      downloadOversizedVideo: vi.fn().mockResolvedValue({
        buffer: Buffer.from("oversized-video-binary"),
        filePath: "videos/oversized.mp4",
      }),
      compressVideo: vi.fn().mockResolvedValue({
        outputPath: "/tmp/oversized-compressed.mp4",
        sizeBytes: 1024,
        preset: { maxSide: 960, fps: 15 },
      }),
      readFile: vi.fn().mockRejectedValue(new Error("readback failed")),
      mkdtemp: vi.fn().mockResolvedValue("/tmp/video-handler-readback-error"),
      writeFile: vi.fn().mockResolvedValue(undefined),
      rm: rmMock,
    });

    await handleVideoMessage(ctx, deps);

    expect(replyMock).toHaveBeenNthCalledWith(3, t("bot.video_compression_failed"));
    expect(prepareMediaPromptMock).not.toHaveBeenCalled();
    expect(processPromptMock).not.toHaveBeenCalled();
    expect(rmMock).toHaveBeenCalledWith("/tmp/video-handler-readback-error", {
      force: true,
      recursive: true,
    });
  });

  it("shows dedicated ffmpeg dependency error when compression prerequisites are missing", async () => {
    const { ctx, replyMock } = createVideoContext({
      video: {
        file_id: "oversized-video-id",
        file_unique_id: "oversized-video-unique-id",
        duration: 30,
        width: 1920,
        height: 1080,
        mime_type: "video/mp4",
        file_name: "oversized.mp4",
        file_size: 25 * 1024 * 1024,
      },
    });

    const { deps, processPromptMock, prepareMediaPromptMock } = createVideoDeps({
      downloadOversizedVideo: vi.fn().mockResolvedValue({
        buffer: Buffer.from("oversized-video-binary"),
        filePath: "videos/oversized.mp4",
      }),
      compressVideo: vi
        .fn()
        .mockRejectedValue(new MissingVideoCompressionDependencyError("ffmpeg")),
      mkdtemp: vi.fn().mockResolvedValue("/tmp/video-handler-ffmpeg"),
      writeFile: vi.fn().mockResolvedValue(undefined),
      rm: vi.fn().mockResolvedValue(undefined),
    });

    await handleVideoMessage(ctx, deps);

    expect(replyMock).toHaveBeenNthCalledWith(1, t("bot.video_downloading"));
    expect(replyMock).toHaveBeenNthCalledWith(2, t("bot.video_compressing"));
    expect(replyMock).toHaveBeenNthCalledWith(3, t("bot.video_compression_requires_ffmpeg"));
    expect(prepareMediaPromptMock).not.toHaveBeenCalled();
    expect(processPromptMock).not.toHaveBeenCalled();
  });

  it("shows dedicated compression failure when compressed output still exceeds the budget", async () => {
    const { ctx, replyMock } = createVideoContext({
      video: {
        file_id: "oversized-video-id",
        file_unique_id: "oversized-video-unique-id",
        duration: 30,
        width: 1920,
        height: 1080,
        mime_type: "video/mp4",
        file_name: "oversized.mp4",
        file_size: 25 * 1024 * 1024,
      },
    });

    const { deps, processPromptMock, prepareMediaPromptMock } = createVideoDeps({
      downloadOversizedVideo: vi.fn().mockResolvedValue({
        buffer: Buffer.from("oversized-video-binary"),
        filePath: "videos/oversized.mp4",
      }),
      compressVideo: vi.fn().mockRejectedValue(new OversizedVideoCompressionError(1024)),
      mkdtemp: vi.fn().mockResolvedValue("/tmp/video-handler-too-large"),
      writeFile: vi.fn().mockResolvedValue(undefined),
      rm: vi.fn().mockResolvedValue(undefined),
    });

    await handleVideoMessage(ctx, deps);

    expect(replyMock).toHaveBeenNthCalledWith(1, t("bot.video_downloading"));
    expect(replyMock).toHaveBeenNthCalledWith(2, t("bot.video_compressing"));
    expect(replyMock).toHaveBeenNthCalledWith(3, t("bot.video_compression_failed"));
    expect(prepareMediaPromptMock).not.toHaveBeenCalled();
    expect(processPromptMock).not.toHaveBeenCalled();
  });

  it("shows download error when video download fails", async () => {
    const { ctx, replyMock } = createVideoContext();
    const { deps, processPromptMock } = createVideoDeps({
      downloadFile: vi.fn().mockRejectedValue(new Error("Network error")),
    });

    await handleVideoMessage(ctx, deps);

    expect(replyMock).toHaveBeenNthCalledWith(1, t("bot.video_downloading"));
    expect(replyMock).toHaveBeenNthCalledWith(2, t("bot.video_download_error"));
    expect(processPromptMock).not.toHaveBeenCalled();
  });

  it("does not surface an unhandled rejection when the initial status reply fails", async () => {
    const { ctx } = createVideoContext();
    const { deps } = createVideoDeps();

    ctx.reply = vi
      .fn()
      .mockRejectedValueOnce(new Error("Telegram send failed"))
      .mockResolvedValueOnce({ message_id: 102 });

    await expect(handleVideoMessage(ctx, deps)).resolves.toBeUndefined();
  });

  it("shows processing error when shared media preparation fails after download", async () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => logger);
    const { ctx, replyMock } = createVideoContext();
    const { deps, processPromptMock } = createVideoDeps({
      prepareMediaPrompt: vi.fn().mockRejectedValue(new Error("transcriber failed")),
    });

    await handleVideoMessage(ctx, deps);

    expect(errorSpy).toHaveBeenCalledWith(
      "[Video] Error processing video message:",
      expect.any(Error),
    );
    expect(replyMock).toHaveBeenNthCalledWith(1, t("bot.video_downloading"));
    expect(replyMock).toHaveBeenNthCalledWith(2, t("bot.video_process_error"));
    expect(processPromptMock).not.toHaveBeenCalled();
  });
});
