import type { Context } from "grammy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildStoredMediaPrompt,
  prepareAudioPrompt,
  prepareAttachmentMediaPrompt,
  resolveMediaStorageOwner,
} from "../../src/media/ingest.js";
import type { StoredMediaFile, StoredMediaType } from "../../src/media/types.js";

const getCurrentOpencodeRouteMock = vi.hoisted(() => vi.fn());

const baseSourceFile: StoredMediaFile = {
  hostAbsolutePath: "/home/me/Workspaces/tg-123/state/media/123/2026/04/30/photo.jpg",
  runtimeVisiblePath: "/state/media/123/2026/04/30/photo.jpg",
  fileName: "photo.jpg",
  mimeType: "image/jpeg",
  sizeBytes: 11,
  mediaType: "image",
};

vi.mock("../../src/opencode/client.js", () => ({
  getCurrentOpencodeRoute: getCurrentOpencodeRouteMock,
}));

function createStoredMediaFile(overrides: Partial<StoredMediaFile> = {}): StoredMediaFile {
  const mediaType = overrides.mediaType ?? "image";
  return {
    hostAbsolutePath: `/host/media/123/2026/04/30/file`,
    runtimeVisiblePath: `/state/media/123/2026/04/30/file`,
    fileName: "file",
    mimeType: "application/octet-stream",
    sizeBytes: 11,
    mediaType: mediaType as StoredMediaType,
    ...overrides,
  };
}

describe("media/ingest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentOpencodeRouteMock.mockReturnValue({
      runtimeKey: "host",
      baseUrl: "http://localhost:4096",
      kind: "host",
    });
  });

  it("includes the saved file path in stored-media text prompts", () => {
    // What this verifies:
    // - every text/fallback media prompt must carry the runtime-visible path.
    // Passing result:
    // - OpenCode receives the saved path before any extracted text.
    const prompt = buildStoredMediaPrompt({
      runtimeVisiblePath: "/state/media/123/2026/04/30/audio.ogg",
      extractedText: "hello world",
      caption: "",
    });

    expect(prompt).toContain("Saved file path:\n/state/media/123/2026/04/30/audio.ogg");
    expect(prompt).toContain("Processed media result:\nhello world");
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

  it("keeps the STT result and saved path for audio when remote transcription succeeds", async () => {
    const sourceFile = createStoredMediaFile({
      hostAbsolutePath: "/host/media/123/audio.ogg",
      runtimeVisiblePath: "/state/media/123/audio.ogg",
      fileName: "audio.ogg",
      mimeType: "audio/ogg",
      mediaType: "audio",
    });
    const saveIncomingMediaFile = vi.fn().mockResolvedValue(sourceFile);
    const transcribeAudio = vi.fn().mockResolvedValue({ text: "  remote transcript  " });
    const transcribeStoredMedia = vi.fn();

    const prepared = await prepareAudioPrompt({
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
        mediaType: "audio",
      }),
    );
    expect(transcribeAudio).toHaveBeenCalledWith(Buffer.from("audio!"), "audio.ogg");
    expect(transcribeStoredMedia).not.toHaveBeenCalled();
    expect(prepared).toEqual(
      expect.objectContaining({
        mode: "text",
        recognizedText: "remote transcript",
        sourceFile,
        transcriberKind: "audio",
      }),
    );
    expect(prepared.promptText).toContain("Saved file path:\n/state/media/123/audio.ogg");
    expect(prepared.promptText).toContain("Processed media result:\nremote transcript");
  });

  it("falls back when remote audio STT returns blank text", async () => {
    const sourceFile = createStoredMediaFile({
      hostAbsolutePath: "/host/media/123/audio.ogg",
      runtimeVisiblePath: "/state/media/123/audio.ogg",
      fileName: "audio.ogg",
      mimeType: "audio/ogg",
      mediaType: "audio",
    });
    const onFallbackStart = vi.fn();
    const transcribeStoredMedia = vi.fn().mockResolvedValue("fallback transcript");

    const prepared = await prepareAudioPrompt({
      ctx: { from: { id: 123 } } as Context,
      telegramFileId: "telegram-audio-blank-stt",
      mimeType: "audio/ogg",
      fallbackFileName: "fallback.ogg",
      buffer: Buffer.from("audio!"),
      onFallbackStart,
      saveIncomingMediaFile: vi.fn().mockResolvedValue(sourceFile),
      isSttConfigured: () => true,
      transcribeAudio: vi.fn().mockResolvedValue({ text: "   \n  " }),
      transcribeStoredMedia,
    });

    expect(onFallbackStart).toHaveBeenCalledTimes(1);
    expect(transcribeStoredMedia).toHaveBeenCalledWith({
      kind: "audio",
      hostAbsolutePath: "/host/media/123/audio.ogg",
    });
    expect(prepared.recognizedText).toBe("fallback transcript");
    expect(prepared.promptText).toContain("Saved file path:\n/state/media/123/audio.ogg");
    expect(prepared.promptText).toContain("Processed media result:\nfallback transcript");
  });

  it("returns saved audio path context when stored audio transcription fails after saving", async () => {
    const sourceFile = createStoredMediaFile({
      hostAbsolutePath: "/host/media/123/audio.ogg",
      runtimeVisiblePath: "/state/media/123/audio.ogg",
      fileName: "audio.ogg",
      mimeType: "audio/ogg",
      mediaType: "audio",
    });

    const prepared = await prepareAudioPrompt({
      ctx: { from: { id: 123 } } as Context,
      telegramFileId: "telegram-audio-fail",
      mimeType: "audio/ogg",
      fallbackFileName: "fallback.ogg",
      buffer: Buffer.from("audio!"),
      saveIncomingMediaFile: vi.fn().mockResolvedValue(sourceFile),
      isSttConfigured: () => false,
      transcribeAudio: vi.fn(),
      transcribeStoredMedia: vi.fn().mockRejectedValue(new Error("host /secret leaked")),
    });

    expect(prepared.recognizedText).toBe("");
    expect(prepared.promptText).toContain("Saved file path:\n/state/media/123/audio.ogg");
    expect(prepared.promptText).toContain(
      "Automatic transcription failed:\nAutomatic speech/image transcription failed.",
    );
    expect(prepared.promptText).not.toContain("/secret");
  });

  it("returns text mode for text documents and includes saved file path and caption", async () => {
    const sourceFile = createStoredMediaFile({
      hostAbsolutePath: "/host/media/123/notes.txt",
      runtimeVisiblePath: "/state/media/123/notes.txt",
      fileName: "notes.txt",
      mimeType: "text/plain",
      mediaType: "text_document",
    });

    const prepared = await prepareAttachmentMediaPrompt({
      ctx: { from: { id: 123 } } as Context,
      telegramFileId: "telegram-file-1",
      mediaType: "text_document",
      mimeType: "text/plain",
      originalFileName: "notes.txt",
      fallbackFileName: "notes.txt",
      caption: "Summarize this",
      buffer: Buffer.from("ignored buffer text"),
      textContent: "alpha\nbeta",
      saveIncomingMediaFile: vi.fn().mockResolvedValue(sourceFile),
      getStoredModel: vi.fn(),
      getModelCapabilities: vi.fn(),
      transcribeStoredMedia: vi.fn(),
    });

    expect(prepared).toEqual(expect.objectContaining({ mode: "text", sourceFile }));
    expect(prepared.promptText).toContain("Saved file path:\n/state/media/123/notes.txt");
    expect(prepared.promptText).toContain("Processed media result:\nalpha\nbeta");
    expect(prepared.promptText).toContain("User caption/instruction:\nSummarize this");
  });

  it("prefixes attachment prompts with the saved file path", async () => {
    // What this verifies:
    // - native image/PDF/video attachment mode also carries the saved path in text.
    // Passing result:
    // - OpenCode sees the file path even when the model receives a file part.
    const prepared = await prepareAttachmentMediaPrompt({
      ctx: {
        from: { id: 123 },
      } as Parameters<typeof prepareAttachmentMediaPrompt>[0]["ctx"],
      telegramFileId: "photo-file-id",
      mediaType: "image",
      mimeType: "image/jpeg",
      fallbackFileName: "photo.jpg",
      caption: "Describe this photo",
      buffer: Buffer.from("jpeg-binary"),
      saveIncomingMediaFile: vi.fn().mockResolvedValue(baseSourceFile),
      getStoredModel: vi.fn(() => ({ providerID: "test", modelID: "vision" })),
      getModelCapabilities: vi.fn().mockResolvedValue({
        input: { image: true },
        attachment: true,
      }),
    });

    expect(prepared.mode).toBe("attachment");
    expect(prepared.promptText).toContain("Saved file path:\n/state/media/123/2026/04/30/photo.jpg");
    expect(prepared.promptText).toContain("User caption/instruction:\nDescribe this photo");
  });

  it("falls back to text transcription for unsupported images and includes saved path", async () => {
    const sourceFile = createStoredMediaFile({
      hostAbsolutePath: "/host/media/123/photo.png",
      runtimeVisiblePath: "/state/media/123/photo.png",
      fileName: "photo.png",
      mimeType: "image/png",
      mediaType: "image",
    });
    const transcribeStoredMedia = vi.fn().mockResolvedValue("image transcript");
    const onFallbackStart = vi.fn();

    const prepared = await prepareAttachmentMediaPrompt({
      ctx: { from: { id: 123 } } as Context,
      telegramFileId: "telegram-file-3",
      mediaType: "image",
      mimeType: "image/png",
      originalFileName: "photo.png",
      fallbackFileName: "photo.png",
      caption: "Describe this",
      buffer: Buffer.from("png!"),
      onFallbackStart,
      saveIncomingMediaFile: vi.fn().mockResolvedValue(sourceFile),
      getStoredModel: vi.fn(() => ({ providerID: "openai", modelID: "text-only" })),
      getModelCapabilities: vi.fn().mockResolvedValue({
        input: { image: false },
        attachment: false,
      }),
      transcribeStoredMedia,
    });

    expect(onFallbackStart).toHaveBeenCalledTimes(1);
    expect(transcribeStoredMedia).toHaveBeenCalledWith({
      kind: "photo",
      hostAbsolutePath: "/host/media/123/photo.png",
    });
    expect(prepared.mode).toBe("text");
    expect(prepared.promptText).toContain("Saved file path:\n/state/media/123/photo.png");
    expect(prepared.promptText).toContain("Processed media result:\nimage transcript");
  });

  it("adds saved path and transcribed audio to video attachment prompts", async () => {
    const sourceFile = createStoredMediaFile({
      hostAbsolutePath: "/host/media/123/video.mp4",
      runtimeVisiblePath: "/state/media/123/video.mp4",
      fileName: "video.mp4",
      mimeType: "video/mp4",
      mediaType: "video",
    });
    const transcribeStoredMedia = vi.fn().mockResolvedValue("how does this work?");

    const prepared = await prepareAttachmentMediaPrompt({
      ctx: { from: { id: 123 } } as Context,
      telegramFileId: "telegram-video-cap",
      mediaType: "video",
      mimeType: "video/mp4",
      fallbackFileName: "video.mp4",
      caption: "Explain this",
      buffer: Buffer.from("mp4!"),
      saveIncomingMediaFile: vi.fn().mockResolvedValue(sourceFile),
      getStoredModel: vi.fn(() => ({ providerID: "openai", modelID: "gpt-4.1" })),
      getModelCapabilities: vi.fn().mockResolvedValue({
        input: { video: true },
        attachment: true,
      }),
      transcribeStoredMedia,
    });

    expect(prepared.mode).toBe("attachment");
    expect(prepared.promptText).toContain("Saved file path:\n/state/media/123/video.mp4");
    expect(prepared.promptText).toContain("Processed media result:\nTranscribed video audio:\nhow does this work?");
    expect(prepared.promptText).toContain("User caption/instruction:\nExplain this");
  });

  it("keeps saved path in video attachment prompts when audio transcription fails", async () => {
    const sourceFile = createStoredMediaFile({
      hostAbsolutePath: "/host/media/123/video.mp4",
      runtimeVisiblePath: "/state/media/123/video.mp4",
      fileName: "video.mp4",
      mimeType: "video/mp4",
      mediaType: "video",
    });

    const prepared = await prepareAttachmentMediaPrompt({
      ctx: { from: { id: 123 } } as Context,
      telegramFileId: "telegram-video-fail",
      mediaType: "video",
      mimeType: "video/mp4",
      fallbackFileName: "video.mp4",
      caption: "What's going on?",
      buffer: Buffer.from("mp4!"),
      saveIncomingMediaFile: vi.fn().mockResolvedValue(sourceFile),
      getStoredModel: vi.fn(() => ({ providerID: "openai", modelID: "gpt-4.1" })),
      getModelCapabilities: vi.fn().mockResolvedValue({
        input: { video: true },
        attachment: true,
      }),
      transcribeStoredMedia: vi.fn().mockRejectedValue(new Error("transcriber unavailable")),
    });

    expect(prepared.mode).toBe("attachment");
    expect(prepared.promptText).toContain("Saved file path:\n/state/media/123/video.mp4");
    expect(prepared.promptText).toContain("User caption/instruction:\nWhat's going on?");
    expect(prepared.promptText).not.toContain("transcriber unavailable");
  });

  it("returns a saved file path prompt when attachment fallback transcription fails", async () => {
    // What this verifies:
    // - after the file has been saved, transcription failure still creates OpenCode context.
    // Passing result:
    // - caller can send a failure prompt that contains the saved runtime-visible path.
    const prepared = await prepareAttachmentMediaPrompt({
      ctx: {
        from: { id: 123 },
      } as Parameters<typeof prepareAttachmentMediaPrompt>[0]["ctx"],
      telegramFileId: "photo-file-id",
      mediaType: "image",
      mimeType: "image/jpeg",
      fallbackFileName: "photo.jpg",
      caption: "Describe this photo",
      buffer: Buffer.from("jpeg-binary"),
      saveIncomingMediaFile: vi.fn().mockResolvedValue(baseSourceFile),
      getStoredModel: vi.fn(() => ({ providerID: "test", modelID: "text-only" })),
      getModelCapabilities: vi.fn().mockResolvedValue({ input: {}, attachment: false }),
      transcribeStoredMedia: vi.fn().mockRejectedValue(new Error("transcriber failed")),
    });

    expect(prepared.mode).toBe("text");
    expect(prepared.promptText).toContain("Saved file path:\n/state/media/123/2026/04/30/photo.jpg");
    expect(prepared.promptText).toContain(
      "Automatic transcription failed:\nAutomatic speech/image transcription failed.",
    );
    expect(prepared.promptText).not.toContain("transcriber failed");
  });
});
