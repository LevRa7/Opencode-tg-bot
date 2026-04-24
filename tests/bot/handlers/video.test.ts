import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { handleVideoMessage, type VideoHandlerDeps } from "../../../src/bot/handlers/video.js";
import { t } from "../../../src/i18n/index.js";
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
      video: {
        file_id: "video-file-id",
        file_unique_id: "video-unique-id",
        duration: 42,
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

  it("rejects videos longer than 60 seconds", async () => {
    const { ctx, replyMock } = createVideoContext({
      video: {
        file_id: "video-file-id",
        file_unique_id: "video-unique-id",
        duration: 61,
        width: 640,
        height: 360,
        mime_type: "video/mp4",
        file_name: "long.mp4",
        file_size: 2048,
      },
    });
    const { deps, downloadMock, processPromptMock } = createVideoDeps();

    await handleVideoMessage(ctx, deps);

    expect(replyMock).toHaveBeenCalledWith(t("bot.video_too_long", { maxDurationSec: "60" }));
    expect(downloadMock).not.toHaveBeenCalled();
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
