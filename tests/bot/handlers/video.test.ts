import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { handleVideoMessage, type VideoHandlerDeps } from "../../../src/bot/handlers/video.js";
import { t } from "../../../src/i18n/index.js";

function createVideoContext(overrides: Partial<Context["message"]> = {}): {
  ctx: Context;
  replyMock: ReturnType<typeof vi.fn>;
} {
  const replyMock = vi.fn().mockResolvedValue({ message_id: 101 });

  const ctx = {
    chat: { id: 777 },
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
} {
  const processPromptMock = vi.fn().mockResolvedValue(true);
  const downloadMock = vi.fn().mockResolvedValue({
    buffer: Buffer.from("video-binary"),
    filePath: "videos/clip.mp4",
  });

  const deps: VideoHandlerDeps = {
    bot: {} as VideoHandlerDeps["bot"],
    ensureEventSubscription: vi.fn().mockResolvedValue(undefined),
    downloadFile: downloadMock,
    processPrompt: processPromptMock,
    ...overrides,
  };

  return { deps, processPromptMock, downloadMock };
}

describe("bot/handlers/video", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("downloads and sends a supported video as file part", async () => {
    const { ctx, replyMock } = createVideoContext();
    const { deps, processPromptMock, downloadMock } = createVideoDeps();

    await handleVideoMessage(ctx, deps);

    expect(replyMock).toHaveBeenCalledWith(t("bot.video_downloading"));
    expect(downloadMock).toHaveBeenCalledWith(ctx.api, "video-file-id");
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

    await handleVideoMessage(ctx, deps);

    expect(downloadMock).not.toHaveBeenCalled();
    expect(deps.downloadFile as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      ctx.api,
      "video-note-file-id",
    );
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
});
