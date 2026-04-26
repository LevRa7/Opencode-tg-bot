import type { Context } from "grammy";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentOpencodeRouteMock = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
const sttClientMock = vi.hoisted(() => ({
  isSttConfigured: vi.fn(),
  transcribeAudio: vi.fn(),
}));

vi.mock("../../src/opencode/client.js", () => ({
  getCurrentOpencodeRoute: getCurrentOpencodeRouteMock,
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: loggerMock,
}));

vi.mock("../../src/stt/client.js", () => sttClientMock);

import {
  buildStoredMediaPrompt,
  prepareAudioPrompt,
  prepareAttachmentMediaPrompt,
  resolveMediaStorageOwner,
} from "../../src/media/ingest.js";

describe("media/ingest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentOpencodeRouteMock.mockReturnValue({
      runtimeKey: "host",
      baseUrl: "http://localhost:4096",
      kind: "host",
    });
  });

  it("keeps the STT result for audio when remote transcription succeeds", async () => {
    const saveIncomingMediaFile = vi.fn().mockResolvedValue({
      hostAbsolutePath: "/host/media/123/2026/04/24/audio.ogg",
      runtimeVisiblePath: "/state/media/123/2026/04/24/audio.ogg",
      fileName: "audio.ogg",
      mimeType: "audio/ogg",
      sizeBytes: 6,
      mediaType: "audio",
    });
    const transcribeAudio = vi.fn().mockResolvedValue({ text: "  remote transcript  " });
    const transcribeStoredMedia = vi.fn();

    const preparedPrompt = await prepareAudioPrompt({
      ctx: { from: { id: 123 } } as Context,
      telegramFileId: "telegram-audio-1",
      mimeType: "audio/ogg",
      originalFileName: "audio.ogg",
      fallbackFileName: "fallback.ogg",
      buffer: Buffer.from("audio!"),
      saveIncomingMediaFile,
      isSttConfigured: () => true,
      transcribeAudio,
      transcribeStoredMedia,
    });

    expect(saveIncomingMediaFile).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: { userId: 123, runtimeKind: "host" },
        telegramFileId: "telegram-audio-1",
        originalFileName: "audio.ogg",
        fallbackFileName: "fallback.ogg",
        mimeType: "audio/ogg",
        mediaType: "audio",
        buffer: Buffer.from("audio!"),
      }),
    );
    expect(transcribeAudio).toHaveBeenCalledWith(Buffer.from("audio!"), "audio.ogg");
    expect(transcribeStoredMedia).not.toHaveBeenCalled();
    expect(preparedPrompt).toEqual({
      mode: "text",
      recognizedText: "remote transcript",
      promptText:
        "Telegram media was already processed locally.\n\nUse only the processed result below as the source of truth. Do not try to reopen, locate, inspect, or transcribe the original file again.\n\nProcessed media result:\nremote transcript",
      sourceFile: {
        hostAbsolutePath: "/host/media/123/2026/04/24/audio.ogg",
        runtimeVisiblePath: "/state/media/123/2026/04/24/audio.ogg",
        fileName: "audio.ogg",
        mimeType: "audio/ogg",
        sizeBytes: 6,
        mediaType: "audio",
      },
      transcriberKind: "audio",
    });
  });

  it("uses the default STT dependencies for audio when no overrides are injected", async () => {
    const saveIncomingMediaFile = vi.fn().mockResolvedValue({
      hostAbsolutePath: "/host/media/123/2026/04/24/audio.ogg",
      runtimeVisiblePath: "/state/media/123/2026/04/24/audio.ogg",
      fileName: "audio.ogg",
      mimeType: "audio/ogg",
      sizeBytes: 6,
      mediaType: "audio",
    });
    const transcribeStoredMedia = vi.fn();

    sttClientMock.isSttConfigured.mockReturnValue(true);
    sttClientMock.transcribeAudio.mockResolvedValue({ text: " default transcript " });

    const preparedPrompt = await prepareAudioPrompt({
      ctx: { from: { id: 123 } } as Context,
      telegramFileId: "telegram-audio-default",
      mimeType: "audio/ogg",
      fallbackFileName: "fallback.ogg",
      buffer: Buffer.from("audio!"),
      saveIncomingMediaFile,
      transcribeStoredMedia,
    });

    expect(sttClientMock.isSttConfigured).toHaveBeenCalledTimes(1);
    expect(sttClientMock.transcribeAudio).toHaveBeenCalledWith(Buffer.from("audio!"), "audio.ogg");
    expect(transcribeStoredMedia).not.toHaveBeenCalled();
    expect(preparedPrompt).toEqual({
      mode: "text",
      recognizedText: "default transcript",
      promptText:
        "Telegram media was already processed locally.\n\nUse only the processed result below as the source of truth. Do not try to reopen, locate, inspect, or transcribe the original file again.\n\nProcessed media result:\ndefault transcript",
      sourceFile: {
        hostAbsolutePath: "/host/media/123/2026/04/24/audio.ogg",
        runtimeVisiblePath: "/state/media/123/2026/04/24/audio.ogg",
        fileName: "audio.ogg",
        mimeType: "audio/ogg",
        sizeBytes: 6,
        mediaType: "audio",
      },
      transcriberKind: "audio",
    });
  });

  it("falls back when remote STT returns blank text and uses the fallback transcript", async () => {
    const saveIncomingMediaFile = vi.fn().mockResolvedValue({
      hostAbsolutePath: "/host/media/123/2026/04/24/audio.ogg",
      runtimeVisiblePath: "/state/media/123/2026/04/24/audio.ogg",
      fileName: "audio.ogg",
      mimeType: "audio/ogg",
      sizeBytes: 6,
      mediaType: "audio",
    });
    const onFallbackStart = vi.fn();
    const transcribeAudio = vi.fn().mockResolvedValue({ text: "   \n  " });
    const transcribeStoredMedia = vi.fn().mockResolvedValue("fallback transcript");

    const preparedPrompt = await prepareAudioPrompt({
      ctx: { from: { id: 123 } } as Context,
      telegramFileId: "telegram-audio-blank-stt",
      mimeType: "audio/ogg",
      fallbackFileName: "fallback.ogg",
      buffer: Buffer.from("audio!"),
      onFallbackStart,
      saveIncomingMediaFile,
      isSttConfigured: () => true,
      transcribeAudio,
      transcribeStoredMedia,
    });

    expect(loggerMock.warn).toHaveBeenCalledWith(
      "[MediaIngest] Remote audio STT returned empty text, falling back to stored-media transcription",
    );
    expect(onFallbackStart).toHaveBeenCalledTimes(1);
    expect(transcribeStoredMedia).toHaveBeenCalledWith({
      kind: "audio",
      hostAbsolutePath: "/host/media/123/2026/04/24/audio.ogg",
    });
    expect(preparedPrompt).toEqual({
      mode: "text",
      recognizedText: "fallback transcript",
      promptText:
        "Telegram media was already processed locally.\n\nUse only the processed result below as the source of truth. Do not try to reopen, locate, inspect, or transcribe the original file again.\n\nProcessed media result:\nfallback transcript",
      sourceFile: {
        hostAbsolutePath: "/host/media/123/2026/04/24/audio.ogg",
        runtimeVisiblePath: "/state/media/123/2026/04/24/audio.ogg",
        fileName: "audio.ogg",
        mimeType: "audio/ogg",
        sizeBytes: 6,
        mediaType: "audio",
      },
      transcriberKind: "audio",
    });
  });

  it("falls back to the stored-media audio transcriber when STT is not configured", async () => {
    const saveIncomingMediaFile = vi.fn().mockResolvedValue({
      hostAbsolutePath: "/host/media/123/2026/04/24/audio.ogg",
      runtimeVisiblePath: "/state/media/123/2026/04/24/audio.ogg",
      fileName: "audio.ogg",
      mimeType: "audio/ogg",
      sizeBytes: 6,
      mediaType: "audio",
    });
    const onFallbackStart = vi.fn();
    const transcribeStoredMedia = vi.fn().mockResolvedValue("local transcript");
    const transcribeAudio = vi.fn();

    const preparedPrompt = await prepareAudioPrompt({
      ctx: { from: { id: 123 } } as Context,
      telegramFileId: "telegram-audio-2",
      mimeType: "audio/ogg",
      fallbackFileName: "fallback.ogg",
      buffer: Buffer.from("audio!"),
      onFallbackStart,
      saveIncomingMediaFile,
      isSttConfigured: () => false,
      transcribeAudio,
      transcribeStoredMedia,
    });

    expect(transcribeAudio).not.toHaveBeenCalled();
    expect(onFallbackStart).toHaveBeenCalledTimes(1);
    expect(transcribeStoredMedia).toHaveBeenCalledWith({
      kind: "audio",
      hostAbsolutePath: "/host/media/123/2026/04/24/audio.ogg",
    });
    expect(preparedPrompt).toEqual({
      mode: "text",
      recognizedText: "local transcript",
      promptText:
        "Telegram media was already processed locally.\n\nUse only the processed result below as the source of truth. Do not try to reopen, locate, inspect, or transcribe the original file again.\n\nProcessed media result:\nlocal transcript",
      sourceFile: {
        hostAbsolutePath: "/host/media/123/2026/04/24/audio.ogg",
        runtimeVisiblePath: "/state/media/123/2026/04/24/audio.ogg",
        fileName: "audio.ogg",
        mimeType: "audio/ogg",
        sizeBytes: 6,
        mediaType: "audio",
      },
      transcriberKind: "audio",
    });
  });

  it("falls back to the stored-media audio transcriber when remote STT throws", async () => {
    const saveIncomingMediaFile = vi.fn().mockResolvedValue({
      hostAbsolutePath: "/host/media/123/2026/04/24/audio.ogg",
      runtimeVisiblePath: "/state/media/123/2026/04/24/audio.ogg",
      fileName: "audio.ogg",
      mimeType: "audio/ogg",
      sizeBytes: 6,
      mediaType: "audio",
    });
    const onFallbackStart = vi.fn();
    const sttError = new Error("remote STT failed");
    const transcribeAudio = vi.fn().mockRejectedValue(sttError);
    const transcribeStoredMedia = vi.fn().mockResolvedValue("local transcript");

    const preparedPrompt = await prepareAudioPrompt({
      ctx: { from: { id: 123 } } as Context,
      telegramFileId: "telegram-audio-3",
      mimeType: "audio/ogg",
      fallbackFileName: "fallback.ogg",
      buffer: Buffer.from("audio!"),
      onFallbackStart,
      saveIncomingMediaFile,
      isSttConfigured: () => true,
      transcribeAudio,
      transcribeStoredMedia,
    });

    expect(loggerMock.warn).toHaveBeenCalledWith(
      "[MediaIngest] Remote audio STT failed, falling back to stored-media transcription",
      sttError,
    );
    expect(onFallbackStart).toHaveBeenCalledTimes(1);
    expect(transcribeStoredMedia).toHaveBeenCalledWith({
      kind: "audio",
      hostAbsolutePath: "/host/media/123/2026/04/24/audio.ogg",
    });
    expect(preparedPrompt).toEqual({
      mode: "text",
      recognizedText: "local transcript",
      promptText:
        "Telegram media was already processed locally.\n\nUse only the processed result below as the source of truth. Do not try to reopen, locate, inspect, or transcribe the original file again.\n\nProcessed media result:\nlocal transcript",
      sourceFile: {
        hostAbsolutePath: "/host/media/123/2026/04/24/audio.ogg",
        runtimeVisiblePath: "/state/media/123/2026/04/24/audio.ogg",
        fileName: "audio.ogg",
        mimeType: "audio/ogg",
        sizeBytes: 6,
        mediaType: "audio",
      },
      transcriberKind: "audio",
    });
  });

  it("resolves tenant media storage owner from telegram context and current route", () => {
    getCurrentOpencodeRouteMock.mockReturnValue({
      runtimeKey: "tenant:123:tenant-123",
      baseUrl: "http://tenant.local",
      kind: "tenant",
      tenantId: "tenant-123",
    });

    const owner = resolveMediaStorageOwner({ from: { id: 123 } } as Context);

    expect(owner).toEqual({
      userId: 123,
      runtimeKind: "tenant",
      tenantId: "tenant-123",
    });
  });

  it("builds stored media prompt without caption when caption is blank", () => {
    const prompt = buildStoredMediaPrompt({
      runtimeVisiblePath: "/state/media/123/2026/04/24/image.png",
      extractedText: "visual summary",
      caption: "   ",
    });

    expect(prompt).toBe(
      "Telegram media was already processed locally.\n\nUse only the processed result below as the source of truth. Do not try to reopen, locate, inspect, or transcribe the original file again.\n\nProcessed media result:\nvisual summary",
    );
  });

  it("returns text mode for text documents and includes the saved file path and caption", async () => {
    const saveIncomingMediaFile = vi.fn().mockResolvedValue({
      hostAbsolutePath: "/host/media/123/2026/04/24/notes.txt",
      runtimeVisiblePath: "/state/media/123/2026/04/24/notes.txt",
      fileName: "notes.txt",
      mimeType: "text/plain",
      sizeBytes: 10,
      mediaType: "text_document",
    });

    const preparedPrompt = await prepareAttachmentMediaPrompt({
      ctx: { from: { id: 123 } } as Context,
      telegramFileId: "telegram-file-1",
      mediaType: "text_document",
      mimeType: "text/plain",
      originalFileName: "notes.txt",
      fallbackFileName: "notes.txt",
      caption: "Summarize this",
      buffer: Buffer.from("ignored buffer text"),
      textContent: "alpha\nbeta",
      saveIncomingMediaFile,
      getStoredModel: vi.fn(),
      getModelCapabilities: vi.fn(),
      transcribeStoredMedia: vi.fn(),
    });

    expect(saveIncomingMediaFile).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: { userId: 123, runtimeKind: "host" },
        telegramFileId: "telegram-file-1",
        originalFileName: "notes.txt",
        fallbackFileName: "notes.txt",
        mimeType: "text/plain",
        mediaType: "text_document",
        buffer: Buffer.from("ignored buffer text"),
      }),
    );
    expect(preparedPrompt).toEqual({
      mode: "text",
      promptText:
        "Telegram media was already processed locally.\n\nUse only the processed result below as the source of truth. Do not try to reopen, locate, inspect, or transcribe the original file again.\n\nProcessed media result:\nalpha\nbeta\n\nUser caption/instruction:\nSummarize this",
      sourceFile: {
        hostAbsolutePath: "/host/media/123/2026/04/24/notes.txt",
        runtimeVisiblePath: "/state/media/123/2026/04/24/notes.txt",
        fileName: "notes.txt",
        mimeType: "text/plain",
        sizeBytes: 10,
        mediaType: "text_document",
      },
      transcriberKind: "document",
    });
  });

  it("returns attachment mode with a data uri file part when the model supports image input", async () => {
    const saveIncomingMediaFile = vi.fn().mockResolvedValue({
      hostAbsolutePath: "/host/media/123/2026/04/24/photo.png",
      runtimeVisiblePath: "/state/media/123/2026/04/24/photo.png",
      fileName: "photo.png",
      mimeType: "image/png",
      sizeBytes: 4,
      mediaType: "image",
    });
    const getStoredModel = vi.fn().mockReturnValue({
      providerID: "openai",
      modelID: "gpt-4.1",
      variant: "default",
    });
    const getModelCapabilities = vi.fn().mockResolvedValue({
      input: { image: true, pdf: false, audio: false, video: false },
      attachment: true,
    });

    const preparedPrompt = await prepareAttachmentMediaPrompt({
      ctx: { from: { id: 123 } } as Context,
      telegramFileId: "telegram-file-2",
      mediaType: "image",
      mimeType: "image/png",
      originalFileName: "photo.png",
      fallbackFileName: "photo.png",
      caption: "Describe this",
      buffer: Buffer.from("png!"),
      saveIncomingMediaFile,
      getStoredModel,
      getModelCapabilities,
      transcribeStoredMedia: vi.fn(),
    });

    expect(getStoredModel).toHaveBeenCalledTimes(1);
    expect(getModelCapabilities).toHaveBeenCalledWith("openai", "gpt-4.1");
    expect(preparedPrompt).toEqual({
      mode: "attachment",
      promptText: "Describe this",
      fileParts: [
        {
          type: "file",
          mime: "image/png",
          filename: "photo.png",
          url: "data:image/png;base64,cG5nIQ==",
        },
      ],
      sourceFile: {
        hostAbsolutePath: "/host/media/123/2026/04/24/photo.png",
        runtimeVisiblePath: "/state/media/123/2026/04/24/photo.png",
        fileName: "photo.png",
        mimeType: "image/png",
        sizeBytes: 4,
        mediaType: "image",
      },
      transcriberKind: "photo",
    });
  });

  it("falls back to text transcription for unsupported images and notifies when fallback starts", async () => {
    const saveIncomingMediaFile = vi.fn().mockResolvedValue({
      hostAbsolutePath: "/host/media/123/2026/04/24/photo.png",
      runtimeVisiblePath: "/state/media/123/2026/04/24/photo.png",
      fileName: "photo.png",
      mimeType: "image/png",
      sizeBytes: 4,
      mediaType: "image",
    });
    const getStoredModel = vi.fn().mockReturnValue({
      providerID: "openai",
      modelID: "gpt-4.1",
      variant: "default",
    });
    const getModelCapabilities = vi.fn().mockResolvedValue({
      input: { image: false, pdf: false, audio: false, video: false },
      attachment: false,
    });
    const transcribeStoredMedia = vi.fn().mockResolvedValue("image transcript");
    const onFallbackStart = vi.fn();

    const preparedPrompt = await prepareAttachmentMediaPrompt({
      ctx: { from: { id: 123 } } as Context,
      telegramFileId: "telegram-file-3",
      mediaType: "image",
      mimeType: "image/png",
      originalFileName: "photo.png",
      fallbackFileName: "photo.png",
      caption: "Describe this",
      buffer: Buffer.from("png!"),
      onFallbackStart,
      saveIncomingMediaFile,
      getStoredModel,
      getModelCapabilities,
      transcribeStoredMedia,
    });

    expect(onFallbackStart).toHaveBeenCalledTimes(1);
    expect(transcribeStoredMedia).toHaveBeenCalledWith({
      kind: "photo",
      hostAbsolutePath: "/host/media/123/2026/04/24/photo.png",
    });
    expect(preparedPrompt).toEqual({
      mode: "text",
      promptText:
        "Telegram media was already processed locally.\n\nUse only the processed result below as the source of truth. Do not try to reopen, locate, inspect, or transcribe the original file again.\n\nProcessed media result:\nimage transcript\n\nUser caption/instruction:\nDescribe this",
      sourceFile: {
        hostAbsolutePath: "/host/media/123/2026/04/24/photo.png",
        runtimeVisiblePath: "/state/media/123/2026/04/24/photo.png",
        fileName: "photo.png",
        mimeType: "image/png",
        sizeBytes: 4,
        mediaType: "image",
      },
      transcriberKind: "photo",
    });
  });

  it("falls back to text transcription when image input exists but attachments are disabled", async () => {
    const saveIncomingMediaFile = vi.fn().mockResolvedValue({
      hostAbsolutePath: "/host/media/123/2026/04/24/photo.png",
      runtimeVisiblePath: "/state/media/123/2026/04/24/photo.png",
      fileName: "photo.png",
      mimeType: "image/png",
      sizeBytes: 4,
      mediaType: "image",
    });
    const getStoredModel = vi.fn().mockReturnValue({
      providerID: "openai",
      modelID: "gpt-4.1",
      variant: "default",
    });
    const getModelCapabilities = vi.fn().mockResolvedValue({
      input: { image: true, pdf: false, audio: false, video: false },
      attachment: false,
    });
    const transcribeStoredMedia = vi.fn().mockResolvedValue("image transcript");

    const preparedPrompt = await prepareAttachmentMediaPrompt({
      ctx: { from: { id: 123 } } as Context,
      telegramFileId: "telegram-file-4",
      mediaType: "image",
      mimeType: "image/png",
      originalFileName: "photo.png",
      fallbackFileName: "photo.png",
      caption: "Describe this",
      buffer: Buffer.from("png!"),
      saveIncomingMediaFile,
      getStoredModel,
      getModelCapabilities,
      transcribeStoredMedia,
    });

    expect(transcribeStoredMedia).toHaveBeenCalledWith({
      kind: "photo",
      hostAbsolutePath: "/host/media/123/2026/04/24/photo.png",
    });
    expect(preparedPrompt).toEqual({
      mode: "text",
      promptText:
        "Telegram media was already processed locally.\n\nUse only the processed result below as the source of truth. Do not try to reopen, locate, inspect, or transcribe the original file again.\n\nProcessed media result:\nimage transcript\n\nUser caption/instruction:\nDescribe this",
      sourceFile: {
        hostAbsolutePath: "/host/media/123/2026/04/24/photo.png",
        runtimeVisiblePath: "/state/media/123/2026/04/24/photo.png",
        fileName: "photo.png",
        mimeType: "image/png",
        sizeBytes: 4,
        mediaType: "image",
      },
      transcriberKind: "photo",
    });
  });

  it("transcribes audio and returns attachment mode when the model supports video input and attachment", async () => {
    const saveIncomingMediaFile = vi.fn().mockResolvedValue({
      hostAbsolutePath: "/host/media/123/2026/04/24/video.mp4",
      runtimeVisiblePath: "/state/media/123/2026/04/24/video.mp4",
      fileName: "video.mp4",
      mimeType: "video/mp4",
      sizeBytes: 999,
      mediaType: "video",
    });
    const getStoredModel = vi.fn().mockReturnValue({
      providerID: "openai",
      modelID: "gpt-4.1",
      variant: "default",
    });
    const getModelCapabilities = vi.fn().mockResolvedValue({
      input: { image: true, pdf: false, audio: false, video: true },
      attachment: true,
    });
    const transcribeStoredMedia = vi.fn().mockResolvedValue("what's in this cup?");
    const onFallbackStart = vi.fn();

    const preparedPrompt = await prepareAttachmentMediaPrompt({
      ctx: { from: { id: 123 } } as Context,
      telegramFileId: "telegram-video-attach",
      mediaType: "video",
      mimeType: "video/mp4",
      fallbackFileName: "video.mp4",
      caption: "",
      buffer: Buffer.from("mp4!"),
      onFallbackStart,
      saveIncomingMediaFile,
      getStoredModel,
      getModelCapabilities,
      transcribeStoredMedia,
    });

    expect(onFallbackStart).toHaveBeenCalledTimes(1);
    expect(transcribeStoredMedia).toHaveBeenCalledWith({
      kind: "video",
      hostAbsolutePath: "/host/media/123/2026/04/24/video.mp4",
    });
    expect(preparedPrompt).toEqual({
      mode: "attachment",
      promptText: "what's in this cup?",
      fileParts: [
        {
          type: "file",
          mime: "video/mp4",
          filename: "video.mp4",
          url: "data:video/mp4;base64,bXA0IQ==",
        },
      ],
      sourceFile: {
        hostAbsolutePath: "/host/media/123/2026/04/24/video.mp4",
        runtimeVisiblePath: "/state/media/123/2026/04/24/video.mp4",
        fileName: "video.mp4",
        mimeType: "video/mp4",
        sizeBytes: 999,
        mediaType: "video",
      },
      transcriberKind: "video",
    });
  });

  it("merges caption with video transcription in attachment mode when both are present", async () => {
    const saveIncomingMediaFile = vi.fn().mockResolvedValue({
      hostAbsolutePath: "/host/media/123/2026/04/24/video.mp4",
      runtimeVisiblePath: "/state/media/123/2026/04/24/video.mp4",
      fileName: "video.mp4",
      mimeType: "video/mp4",
      sizeBytes: 999,
      mediaType: "video",
    });
    const getStoredModel = vi.fn().mockReturnValue({
      providerID: "openai",
      modelID: "gpt-4.1",
      variant: "default",
    });
    const getModelCapabilities = vi.fn().mockResolvedValue({
      input: { image: true, pdf: false, audio: false, video: true },
      attachment: true,
    });
    const transcribeStoredMedia = vi.fn().mockResolvedValue("how does this work?");

    const preparedPrompt = await prepareAttachmentMediaPrompt({
      ctx: { from: { id: 123 } } as Context,
      telegramFileId: "telegram-video-cap",
      mediaType: "video",
      mimeType: "video/mp4",
      fallbackFileName: "video.mp4",
      caption: "Explain this",
      buffer: Buffer.from("mp4!"),
      saveIncomingMediaFile,
      getStoredModel,
      getModelCapabilities,
      transcribeStoredMedia,
    });

    expect(transcribeStoredMedia).toHaveBeenCalledTimes(1);
    expect(preparedPrompt).toEqual({
      mode: "attachment",
      promptText: "Explain this\n\nTranscribed video audio:\nhow does this work?",
      fileParts: [
        {
          type: "file",
          mime: "video/mp4",
          filename: "video.mp4",
          url: "data:video/mp4;base64,bXA0IQ==",
        },
      ],
      sourceFile: {
        hostAbsolutePath: "/host/media/123/2026/04/24/video.mp4",
        runtimeVisiblePath: "/state/media/123/2026/04/24/video.mp4",
        fileName: "video.mp4",
        mimeType: "video/mp4",
        sizeBytes: 999,
        mediaType: "video",
      },
      transcriberKind: "video",
    });
  });

  it("falls back to caption when video transcription in attachment mode fails", async () => {
    const saveIncomingMediaFile = vi.fn().mockResolvedValue({
      hostAbsolutePath: "/host/media/123/2026/04/24/video.mp4",
      runtimeVisiblePath: "/state/media/123/2026/04/24/video.mp4",
      fileName: "video.mp4",
      mimeType: "video/mp4",
      sizeBytes: 999,
      mediaType: "video",
    });
    const getStoredModel = vi.fn().mockReturnValue({
      providerID: "openai",
      modelID: "gpt-4.1",
      variant: "default",
    });
    const getModelCapabilities = vi.fn().mockResolvedValue({
      input: { image: true, pdf: false, audio: false, video: true },
      attachment: true,
    });
    const transcribeStoredMedia = vi.fn().mockRejectedValue(new Error("transcriber unavailable"));

    const preparedPrompt = await prepareAttachmentMediaPrompt({
      ctx: { from: { id: 123 } } as Context,
      telegramFileId: "telegram-video-fail",
      mediaType: "video",
      mimeType: "video/mp4",
      fallbackFileName: "video.mp4",
      caption: "What's going on?",
      buffer: Buffer.from("mp4!"),
      saveIncomingMediaFile,
      getStoredModel,
      getModelCapabilities,
      transcribeStoredMedia,
    });

    expect(loggerMock.warn).toHaveBeenCalledWith(
      "[Media] Video transcription in attachment mode failed, using caption only",
      expect.any(Error),
    );
    expect(preparedPrompt).toEqual({
      mode: "attachment",
      promptText: "What's going on?",
      fileParts: [
        {
          type: "file",
          mime: "video/mp4",
          filename: "video.mp4",
          url: "data:video/mp4;base64,bXA0IQ==",
        },
      ],
      sourceFile: {
        hostAbsolutePath: "/host/media/123/2026/04/24/video.mp4",
        runtimeVisiblePath: "/state/media/123/2026/04/24/video.mp4",
        fileName: "video.mp4",
        mimeType: "video/mp4",
        sizeBytes: 999,
        mediaType: "video",
      },
      transcriberKind: "video",
    });
  });

  it("uses a processed-result-only prompt for unsupported video fallback so OpenCode does not try to reopen the file", async () => {
    const saveIncomingMediaFile = vi.fn().mockResolvedValue({
      hostAbsolutePath: "/host/media/123/2026/04/24/video-note.mp4",
      runtimeVisiblePath: "/state/media/123/2026/04/24/video-note.mp4",
      fileName: "video-note.mp4",
      mimeType: "video/mp4",
      sizeBytes: 4,
      mediaType: "video",
    });
    const getStoredModel = vi.fn().mockReturnValue({
      providerID: "cliproxyapi",
      modelID: "gpt-5.4",
      variant: "default",
    });
    const getModelCapabilities = vi.fn().mockResolvedValue({
      input: { image: true, pdf: false, audio: false, video: false },
      attachment: true,
    });
    const transcribeStoredMedia = vi.fn().mockResolvedValue("video transcript and visual summary");

    const preparedPrompt = await prepareAttachmentMediaPrompt({
      ctx: { from: { id: 123 } } as Context,
      telegramFileId: "telegram-video-1",
      mediaType: "video",
      mimeType: "video/mp4",
      originalFileName: "video-note.mp4",
      fallbackFileName: "video-note.mp4",
      caption: "What is happening here?",
      buffer: Buffer.from("mp4!"),
      saveIncomingMediaFile,
      getStoredModel,
      getModelCapabilities,
      transcribeStoredMedia,
    });

    expect(transcribeStoredMedia).toHaveBeenCalledWith({
      kind: "video",
      hostAbsolutePath: "/host/media/123/2026/04/24/video-note.mp4",
    });
    expect(preparedPrompt).toEqual({
      mode: "text",
      promptText:
        "Telegram media was already processed locally.\n\nUse only the processed result below as the source of truth. Do not try to reopen, locate, inspect, or transcribe the original file again.\n\nProcessed media result:\nvideo transcript and visual summary\n\nUser caption/instruction:\nWhat is happening here?",
      sourceFile: {
        hostAbsolutePath: "/host/media/123/2026/04/24/video-note.mp4",
        runtimeVisiblePath: "/state/media/123/2026/04/24/video-note.mp4",
        fileName: "video-note.mp4",
        mimeType: "video/mp4",
        sizeBytes: 4,
        mediaType: "video",
      },
      transcriberKind: "video",
    });
  });
});
