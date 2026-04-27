import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { handleVoiceMessage, type VoiceMessageDeps } from "../../../src/bot/handlers/voice.js";
import { t } from "../../../src/i18n/index.js";

function createVoiceContext(): {
  ctx: Context;
  replyMock: ReturnType<typeof vi.fn>;
  editMessageTextMock: ReturnType<typeof vi.fn>;
} {
  const replyMock = vi.fn().mockResolvedValue({ message_id: 101 });
  const editMessageTextMock = vi.fn().mockResolvedValue(true);

  const ctx = {
    chat: { id: 777 },
    from: { id: 123, first_name: "Lev" },
    message: {
      message_id: 10,
      voice: {
        file_id: "voice-file-id",
      },
    },
    reply: replyMock,
    api: {
      editMessageText: editMessageTextMock,
    },
  } as unknown as Context;

  return { ctx, replyMock, editMessageTextMock };
}

function createVoiceDeps(overrides: Partial<VoiceMessageDeps> = {}): {
  deps: VoiceMessageDeps;
  processPromptMock: ReturnType<typeof vi.fn>;
  downloadMock: ReturnType<typeof vi.fn>;
  transcribeMock: ReturnType<typeof vi.fn>;
  prepareAudioPromptMock: ReturnType<typeof vi.fn>;
} {
  const processPromptMock = vi.fn().mockResolvedValue(true);
  const downloadMock = vi.fn().mockResolvedValue({
    buffer: Buffer.from("audio"),
    filename: "file_1.oga",
  });
  const transcribeMock = vi.fn().mockResolvedValue({ text: "run tests" });
  const prepareAudioPromptMock = vi.fn().mockResolvedValue({
    mode: "text",
    recognizedText: "run tests",
    promptText: "stored prompt text",
    sourceFile: {
      hostAbsolutePath: "/tmp/file_1.ogg",
      runtimeVisiblePath: "/state/file_1.ogg",
      fileName: "file_1.ogg",
      mimeType: "audio/ogg",
      sizeBytes: 5,
      mediaType: "audio",
    },
    transcriberKind: "audio",
  });

  const deps: VoiceMessageDeps = {
    bot: {} as VoiceMessageDeps["bot"],
    ensureEventSubscription: vi.fn().mockResolvedValue(undefined),
    isSttConfigured: vi.fn(() => true),
    downloadTelegramFile: downloadMock,
    transcribeAudio: transcribeMock,
    prepareAudioPrompt: prepareAudioPromptMock,
    processPrompt: processPromptMock,
    acquireProcessingHold: vi.fn(() => vi.fn()),
    enqueueCorrelatedItem: vi.fn(() => false),
    ...overrides,
  };

  return { deps, processPromptMock, downloadMock, transcribeMock, prepareAudioPromptMock };
}

describe("bot/handlers/voice", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("continues with prompt processing when recognized text message edit fails", async () => {
    const { ctx, replyMock, editMessageTextMock } = createVoiceContext();
    const { deps, processPromptMock } = createVoiceDeps();

    editMessageTextMock.mockRejectedValueOnce(new Error("message is too long"));

    await handleVoiceMessage(ctx, deps);

    expect(replyMock).toHaveBeenCalledWith(t("stt.recognizing"));
    expect(processPromptMock).toHaveBeenCalledWith(ctx, "stored prompt text", deps);
  });

  it("acquires and releases the processing hold during standalone audio preprocessing", async () => {
    const { ctx } = createVoiceContext();
    const releaseHoldMock = vi.fn();
    const acquireProcessingHoldMock = vi.fn(() => releaseHoldMock);
    const enqueueCorrelatedItemMock = vi.fn(() => false);
    const { deps, processPromptMock } = createVoiceDeps({
      acquireProcessingHold: acquireProcessingHoldMock,
      enqueueCorrelatedItem: enqueueCorrelatedItemMock,
    });

    await handleVoiceMessage(ctx, deps);

    expect(acquireProcessingHoldMock).toHaveBeenCalledTimes(1);
    expect(releaseHoldMock).toHaveBeenCalledTimes(1);
    expect(enqueueCorrelatedItemMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "audio",
      }),
    );
    expect(processPromptMock).toHaveBeenCalled();
  });

  it("continues through shared audio preparation when STT is not configured", async () => {
    const { ctx, replyMock } = createVoiceContext();
    const { deps, processPromptMock, downloadMock, prepareAudioPromptMock, transcribeMock } =
      createVoiceDeps({
        isSttConfigured: () => false,
      });

    await handleVoiceMessage(ctx, deps);

    expect(replyMock).toHaveBeenCalledWith(t("stt.recognizing"));
    expect(downloadMock).toHaveBeenCalledWith(ctx, "voice-file-id");
    expect(prepareAudioPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ctx,
        telegramFileId: "voice-file-id",
        mimeType: "audio/ogg",
        originalFileName: "file_1.oga",
        fallbackFileName: "file_1.oga",
        buffer: Buffer.from("audio"),
        isSttConfigured: deps.isSttConfigured,
        transcribeAudio: transcribeMock,
        onFallbackStart: expect.any(Function),
      }),
    );
    expect(processPromptMock).toHaveBeenCalledWith(ctx, "stored prompt text", deps);
  });

  it("updates the status message when audio fallback transcription starts", async () => {
    const { ctx, editMessageTextMock } = createVoiceContext();
    const fallbackPrepareAudioPrompt = vi.fn(
      async (params: Parameters<NonNullable<VoiceMessageDeps["prepareAudioPrompt"]>>[0]) => {
        await params.onFallbackStart?.();

        return {
          mode: "text" as const,
          recognizedText: "run tests",
          promptText: "stored prompt text",
          sourceFile: {
            hostAbsolutePath: "/tmp/file_1.ogg",
            runtimeVisiblePath: "/state/file_1.ogg",
            fileName: "file_1.ogg",
            mimeType: "audio/ogg",
            sizeBytes: 5,
            mediaType: "audio" as const,
          },
          transcriberKind: "audio" as const,
        };
      },
    );
    const { deps, processPromptMock } = createVoiceDeps({
      prepareAudioPrompt: fallbackPrepareAudioPrompt,
    });

    await handleVoiceMessage(ctx, deps);

    expect(editMessageTextMock).toHaveBeenCalledWith(777, 101, t("bot.audio_processing"));
    expect(processPromptMock).toHaveBeenCalledWith(ctx, "stored prompt text", deps);
  });

  it("continues prompt processing when fallback progress edit fails", async () => {
    const { ctx, replyMock, editMessageTextMock } = createVoiceContext();
    const fallbackPrepareAudioPrompt = vi.fn(
      async (params: Parameters<NonNullable<VoiceMessageDeps["prepareAudioPrompt"]>>[0]) => {
        await params.onFallbackStart?.();

        return {
          mode: "text" as const,
          recognizedText: "run tests",
          promptText: "stored prompt text",
          sourceFile: {
            hostAbsolutePath: "/tmp/file_1.ogg",
            runtimeVisiblePath: "/state/file_1.ogg",
            fileName: "file_1.ogg",
            mimeType: "audio/ogg",
            sizeBytes: 5,
            mediaType: "audio" as const,
          },
          transcriberKind: "audio" as const,
        };
      },
    );
    const { deps, processPromptMock } = createVoiceDeps({
      prepareAudioPrompt: fallbackPrepareAudioPrompt,
    });

    editMessageTextMock.mockRejectedValueOnce(new Error("message is not modified"));

    await handleVoiceMessage(ctx, deps);

    expect(processPromptMock).toHaveBeenCalledWith(ctx, "stored prompt text", deps);
    expect(replyMock).toHaveBeenCalledTimes(1);
    expect(replyMock).toHaveBeenCalledWith(t("stt.recognizing"));
  });

  it("shows empty-result message and skips prompt processing when prepared text is empty", async () => {
    const { ctx, editMessageTextMock } = createVoiceContext();
    const { deps, processPromptMock } = createVoiceDeps({
      prepareAudioPrompt: vi.fn().mockResolvedValue({
        mode: "text",
        recognizedText: "   ",
        promptText: "stored prompt text",
        sourceFile: {
          hostAbsolutePath: "/tmp/file_1.ogg",
          runtimeVisiblePath: "/state/file_1.ogg",
          fileName: "file_1.ogg",
          mimeType: "audio/ogg",
          sizeBytes: 5,
          mediaType: "audio",
        },
        transcriberKind: "audio",
      }),
    });

    await handleVoiceMessage(ctx, deps);

    expect(editMessageTextMock).toHaveBeenCalledWith(777, 101, t("stt.empty_result"));
    expect(processPromptMock).not.toHaveBeenCalled();
  });
});
