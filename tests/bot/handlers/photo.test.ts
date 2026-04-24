import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { handlePhotoMessage, type PhotoHandlerDeps } from "../../../src/bot/handlers/photo.js";
import { t } from "../../../src/i18n/index.js";

function createPhotoContext(overrides: Partial<Context["message"]> = {}): {
  ctx: Context;
  replyMock: ReturnType<typeof vi.fn>;
} {
  const replyMock = vi.fn().mockResolvedValue({ message_id: 101 });

  const ctx = {
    chat: { id: 777 },
    from: { id: 123 },
    message: {
      photo: [
        {
          file_id: "small-photo-id",
          file_unique_id: "small-photo-unique-id",
          width: 90,
          height: 90,
          file_size: 512,
        },
        {
          file_id: "large-photo-id",
          file_unique_id: "large-photo-unique-id",
          width: 1280,
          height: 720,
          file_size: 4096,
        },
      ],
      caption: "Describe this photo",
      ...overrides,
    },
    reply: replyMock,
    api: {
      getFile: vi.fn(),
    },
  } as unknown as Context;

  return { ctx, replyMock };
}

function createPhotoDeps(overrides: Partial<PhotoHandlerDeps> = {}): {
  deps: PhotoHandlerDeps;
  processPromptMock: ReturnType<typeof vi.fn>;
  downloadMock: ReturnType<typeof vi.fn>;
  prepareMediaPromptMock: ReturnType<typeof vi.fn>;
} {
  const processPromptMock = vi.fn().mockResolvedValue(true);
  const downloadMock = vi.fn().mockResolvedValue({
    buffer: Buffer.from("jpeg-binary"),
    filePath: "photos/photo.jpg",
  });
  const prepareMediaPromptMock = vi.fn().mockResolvedValue({
    mode: "attachment",
    promptText: "Describe this photo",
    fileParts: [
      {
        type: "file",
        mime: "image/jpeg",
        filename: "photo.jpg",
        url: "data:image/jpeg;base64,anBlZy1iaW5hcnk=",
      },
    ],
  });

  const deps: PhotoHandlerDeps = {
    bot: {} as PhotoHandlerDeps["bot"],
    ensureEventSubscription: vi.fn().mockResolvedValue(undefined),
    downloadFile: downloadMock,
    prepareMediaPrompt: prepareMediaPromptMock,
    processPrompt: processPromptMock,
    ...overrides,
  };

  return { deps, processPromptMock, downloadMock, prepareMediaPromptMock };
}

describe("bot/handlers/photo", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function createDeferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    return { promise, resolve, reject };
  }

  it("dispatches native attachment prompts with file parts", async () => {
    const { ctx, replyMock } = createPhotoContext();
    const { deps, processPromptMock, downloadMock, prepareMediaPromptMock } = createPhotoDeps();

    await handlePhotoMessage(ctx, deps);

    expect(replyMock).toHaveBeenCalledWith(t("bot.photo_downloading"));
    expect(downloadMock).toHaveBeenCalledWith(ctx.api, "large-photo-id");
    expect(prepareMediaPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ctx,
        telegramFileId: "large-photo-id",
        mediaType: "image",
        mimeType: "image/jpeg",
        fallbackFileName: "photo.jpg",
        caption: "Describe this photo",
        buffer: Buffer.from("jpeg-binary"),
        onFallbackStart: expect.any(Function),
      }),
    );
    expect(processPromptMock).toHaveBeenCalledWith(
      ctx,
      "Describe this photo",
      deps,
      expect.arrayContaining([
        expect.objectContaining({
          type: "file",
          mime: "image/jpeg",
          filename: "photo.jpg",
        }),
      ]),
    );
  });

  it("passes an awaitable fallback callback to media preparation", async () => {
    const { ctx, replyMock } = createPhotoContext();
    let fallbackResult: unknown;
    let awaitedFallbackResult: unknown;

    const { deps } = createPhotoDeps({
      prepareMediaPrompt: vi.fn().mockImplementation(async (params) => {
        fallbackResult = params.onFallbackStart?.();
        awaitedFallbackResult = await fallbackResult;
        return {
          mode: "text",
          promptText: "fallback prompt text",
        };
      }),
    });

    await handlePhotoMessage(ctx, deps);

    expect(replyMock).toHaveBeenNthCalledWith(2, t("bot.photo_processing"));
    expect(fallbackResult).toBeInstanceOf(Promise);
    expect(awaitedFallbackResult).toBeUndefined();
  });

  it("sends processing status and dispatches fallback text prompts", async () => {
    const { ctx, replyMock } = createPhotoContext({ caption: "Explain the screenshot" });
    const { deps, processPromptMock } = createPhotoDeps({
      prepareMediaPrompt: vi.fn().mockImplementation(async (params) => {
        params.onFallbackStart?.();
        return {
          mode: "text",
          promptText: "fallback prompt text",
        };
      }),
    });

    await handlePhotoMessage(ctx, deps);

    expect(replyMock).toHaveBeenNthCalledWith(1, t("bot.photo_downloading"));
    expect(replyMock).toHaveBeenNthCalledWith(2, t("bot.photo_processing"));
    expect(processPromptMock).toHaveBeenCalledWith(ctx, "fallback prompt text", deps);
  });

  it("waits for the processing status message before dispatching fallback text prompts", async () => {
    const processingReplyDeferred = createDeferred<{ message_id: number }>();
    const { ctx, replyMock } = createPhotoContext({ caption: "Explain the screenshot" });
    const { deps, processPromptMock } = createPhotoDeps({
      prepareMediaPrompt: vi.fn().mockImplementation(async (params) => {
        await params.onFallbackStart?.();
        return {
          mode: "text",
          promptText: "fallback prompt text",
        };
      }),
    });

    replyMock
      .mockResolvedValueOnce({ message_id: 101 })
      .mockReturnValueOnce(processingReplyDeferred.promise);

    const handlingPromise = handlePhotoMessage(ctx, deps);
    await Promise.resolve();
    await Promise.resolve();

    expect(replyMock).toHaveBeenNthCalledWith(1, t("bot.photo_downloading"));
    expect(replyMock).toHaveBeenNthCalledWith(2, t("bot.photo_processing"));
    expect(processPromptMock).not.toHaveBeenCalled();

    processingReplyDeferred.resolve({ message_id: 102 });
    await handlingPromise;

    expect(processPromptMock).toHaveBeenCalledWith(ctx, "fallback prompt text", deps);
  });

  it("shows a download error and skips prompt processing when download fails", async () => {
    const { ctx, replyMock } = createPhotoContext();
    const { deps, processPromptMock, prepareMediaPromptMock } = createPhotoDeps({
      downloadFile: vi.fn().mockRejectedValue(new Error("network down")),
    });

    await handlePhotoMessage(ctx, deps);

    expect(replyMock).toHaveBeenNthCalledWith(1, t("bot.photo_downloading"));
    expect(replyMock).toHaveBeenNthCalledWith(2, t("bot.photo_download_error"));
    expect(prepareMediaPromptMock).not.toHaveBeenCalled();
    expect(processPromptMock).not.toHaveBeenCalled();
  });

  it("shows a processing error and skips prompt dispatch when media preparation fails", async () => {
    const { ctx, replyMock } = createPhotoContext();
    const { deps, processPromptMock } = createPhotoDeps({
      prepareMediaPrompt: vi.fn().mockRejectedValue(new Error("transcriber failed")),
    });

    await handlePhotoMessage(ctx, deps);

    expect(replyMock).toHaveBeenNthCalledWith(1, t("bot.photo_downloading"));
    expect(replyMock).toHaveBeenNthCalledWith(2, t("bot.photo_process_error"));
    expect(processPromptMock).not.toHaveBeenCalled();
  });
});
