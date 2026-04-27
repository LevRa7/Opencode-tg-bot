import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import {
  handleDocumentMessage,
  type DocumentHandlerDeps,
} from "../../../src/bot/handlers/document.js";
import type { PreparedMediaPrompt } from "../../../src/media/types.js";
import { t } from "../../../src/i18n/index.js";
import { logger } from "../../../src/utils/logger.js";

function createDocumentContext(overrides: Partial<Context["message"]> = {}): {
  ctx: Context;
  replyMock: ReturnType<typeof vi.fn>;
} {
  const replyMock = vi.fn().mockResolvedValue({ message_id: 101 });

  const ctx = {
    chat: { id: 777 },
    from: { id: 123, first_name: "Lev" },
    message: {
      message_id: 10,
      document: {
        file_id: "doc-file-id",
        file_unique_id: "unique-id",
        file_name: "test.txt",
        mime_type: "text/plain",
        file_size: 1024,
      },
      caption: "",
      ...overrides,
    },
    reply: replyMock,
    api: {
      getFile: vi.fn().mockResolvedValue({
        file_path: "documents/test.txt",
        file_size: 1024,
      }),
    },
  } as unknown as Context;

  return { ctx, replyMock };
}

function createDocumentDeps(overrides: Partial<DocumentHandlerDeps> = {}): {
  deps: DocumentHandlerDeps;
  processPromptMock: ReturnType<typeof vi.fn>;
  downloadMock: ReturnType<typeof vi.fn>;
  prepareMediaPromptMock: ReturnType<typeof vi.fn>;
} {
  const processPromptMock = vi.fn().mockResolvedValue(true);
  const downloadMock = vi.fn().mockResolvedValue({
    buffer: Buffer.from("file content here"),
    filePath: "documents/test.txt",
  });
  const prepareMediaPromptMock = vi.fn().mockResolvedValue({
    mode: "text",
    promptText: "prepared prompt",
    sourceFile: {
      hostAbsolutePath: "/tmp/test.txt",
      runtimeVisiblePath: ".opencode/media/test.txt",
      fileName: "test.txt",
      mimeType: "text/plain",
      sizeBytes: 17,
      mediaType: "text_document",
    },
    transcriberKind: "document",
  });

  const deps: DocumentHandlerDeps = {
    bot: {} as DocumentHandlerDeps["bot"],
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

describe("bot/handlers/document", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("text files", () => {
    it("routes text files through shared media preparation", async () => {
      const { ctx, replyMock } = createDocumentContext();
      const { deps, processPromptMock, downloadMock, prepareMediaPromptMock } =
        createDocumentDeps();

      await handleDocumentMessage(ctx, deps);

      expect(replyMock).toHaveBeenCalledWith(t("bot.file_downloading"));
      expect(downloadMock).toHaveBeenCalled();
      expect(prepareMediaPromptMock).toHaveBeenCalledWith({
        ctx,
        telegramFileId: "doc-file-id",
        mediaType: "text_document",
        mimeType: "text/plain",
        originalFileName: "test.txt",
        fallbackFileName: "test.txt",
        caption: "",
        buffer: Buffer.from("file content here"),
        textContent: "file content here",
      });
      expect(processPromptMock).toHaveBeenCalledWith(ctx, "prepared prompt", deps);
    });

    it("passes caption into shared text document preparation", async () => {
      const { ctx } = createDocumentContext({ caption: "Please review this file" });
      const { deps, prepareMediaPromptMock, processPromptMock } = createDocumentDeps();

      await handleDocumentMessage(ctx, deps);

      expect(prepareMediaPromptMock).toHaveBeenCalledWith(
        expect.objectContaining({ caption: "Please review this file" }),
      );
      expect(processPromptMock).toHaveBeenCalledWith(ctx, "prepared prompt", deps);
    });

    it("rejects text file larger than limit", async () => {
      const { ctx, replyMock } = createDocumentContext({
        document: {
          file_id: "doc-file-id",
          file_unique_id: "unique-id",
          file_name: "large.txt",
          mime_type: "text/plain",
          file_size: 200 * 1024, // 200KB
        },
      });
      const { deps, processPromptMock, downloadMock } = createDocumentDeps();

      await handleDocumentMessage(ctx, deps);

      expect(replyMock).toHaveBeenCalledWith(t("bot.text_file_too_large", { maxSizeKb: "100" }));
      expect(downloadMock).not.toHaveBeenCalled();
      expect(processPromptMock).not.toHaveBeenCalled();
    });

    it("accepts application/json as text file", async () => {
      const { ctx, replyMock } = createDocumentContext({
        document: {
          file_id: "doc-file-id",
          file_unique_id: "unique-id",
          file_name: "config.json",
          mime_type: "application/json",
          file_size: 500,
        },
      });
      const { deps, processPromptMock } = createDocumentDeps();

      await handleDocumentMessage(ctx, deps);

      expect(replyMock).toHaveBeenCalledWith(t("bot.file_downloading"));
      expect(processPromptMock).toHaveBeenCalled();
    });

    it("accepts application/xml as text file", async () => {
      const { ctx, replyMock } = createDocumentContext({
        document: {
          file_id: "doc-file-id",
          file_unique_id: "unique-id",
          file_name: "data.xml",
          mime_type: "application/xml",
          file_size: 500,
        },
      });
      const { deps, processPromptMock } = createDocumentDeps();

      await handleDocumentMessage(ctx, deps);

      expect(replyMock).toHaveBeenCalledWith(t("bot.file_downloading"));
      expect(processPromptMock).toHaveBeenCalled();
    });

    it("accepts application/javascript as text file", async () => {
      const { ctx, replyMock } = createDocumentContext({
        document: {
          file_id: "doc-file-id",
          file_unique_id: "unique-id",
          file_name: "script.js",
          mime_type: "application/javascript",
          file_size: 500,
        },
      });
      const { deps, processPromptMock } = createDocumentDeps();

      await handleDocumentMessage(ctx, deps);

      expect(replyMock).toHaveBeenCalledWith(t("bot.file_downloading"));
      expect(processPromptMock).toHaveBeenCalled();
    });
  });

  describe("PDF files", () => {
    it("downloads and sends PDF attachments when shared media layer returns attachment mode", async () => {
      const { ctx, replyMock } = createDocumentContext({
        document: {
          file_id: "pdf-file-id",
          file_unique_id: "pdf-unique-id",
          file_name: "document.pdf",
          mime_type: "application/pdf",
          file_size: 5000,
        },
      });
      const fileParts = [
        {
          type: "file" as const,
          mime: "application/pdf",
          filename: "document.pdf",
          url: "data:application/pdf;base64,ZmFrZQ==",
        },
      ] as PreparedMediaPrompt extends { mode: "attachment"; fileParts: infer T } ? T : never;
      const { deps, processPromptMock, downloadMock, prepareMediaPromptMock } = createDocumentDeps({
        prepareMediaPrompt: vi.fn().mockResolvedValue({
          mode: "attachment",
          promptText: "Summarize this document",
          fileParts,
          sourceFile: {
            hostAbsolutePath: "/tmp/document.pdf",
            runtimeVisiblePath: ".opencode/media/document.pdf",
            fileName: "document.pdf",
            mimeType: "application/pdf",
            sizeBytes: 5000,
            mediaType: "pdf",
          },
          transcriberKind: "document",
        } satisfies PreparedMediaPrompt),
      });

      await handleDocumentMessage(ctx, deps);

      expect(replyMock).toHaveBeenCalledWith(t("bot.file_downloading"));
      expect(downloadMock).toHaveBeenCalled();
      expect(prepareMediaPromptMock).toHaveBeenCalledWith({
        ctx,
        telegramFileId: "pdf-file-id",
        mediaType: "pdf",
        mimeType: "application/pdf",
        originalFileName: "document.pdf",
        fallbackFileName: "document.pdf",
        caption: "",
        buffer: Buffer.from("file content here"),
        onFallbackStart: expect.any(Function),
      });
      expect(processPromptMock).toHaveBeenCalledWith(
        ctx,
        "Summarize this document",
        deps,
        fileParts,
      );
    });

    it("uses shared media fallback text flow for unsupported PDF input and reports processing status", async () => {
      const { ctx, replyMock } = createDocumentContext({
        document: {
          file_id: "pdf-file-id",
          file_unique_id: "pdf-unique-id",
          file_name: "document.pdf",
          mime_type: "application/pdf",
          file_size: 5000,
        },
      });
      const prepareMediaPromptMock = vi.fn().mockImplementation(async (params) => {
        await params.onFallbackStart?.();
        return {
          mode: "text",
          promptText: "prepared pdf fallback text",
          sourceFile: {
            hostAbsolutePath: "/tmp/document.pdf",
            runtimeVisiblePath: ".opencode/media/document.pdf",
            fileName: "document.pdf",
            mimeType: "application/pdf",
            sizeBytes: 5000,
            mediaType: "pdf",
          },
          transcriberKind: "document",
        } satisfies PreparedMediaPrompt;
      });
      const { deps, processPromptMock } = createDocumentDeps({
        prepareMediaPrompt: prepareMediaPromptMock,
      });

      await handleDocumentMessage(ctx, deps);

      expect(replyMock).toHaveBeenNthCalledWith(1, t("bot.file_downloading"));
      expect(replyMock).toHaveBeenNthCalledWith(2, t("bot.file_processing"));
      expect(processPromptMock).toHaveBeenCalledWith(ctx, "prepared pdf fallback text", deps);
    });

    it("does not keep the old caption-only PDF fallback behavior", async () => {
      const { ctx } = createDocumentContext({
        document: {
          file_id: "pdf-file-id",
          file_unique_id: "pdf-unique-id",
          file_name: "document.pdf",
          mime_type: "application/pdf",
          file_size: 5000,
        },
        caption: "Summarize this document",
      });
      const { deps, processPromptMock } = createDocumentDeps({
        prepareMediaPrompt: vi.fn().mockResolvedValue({
          mode: "text",
          promptText: "prepared pdf fallback text with caption context",
          sourceFile: {
            hostAbsolutePath: "/tmp/document.pdf",
            runtimeVisiblePath: ".opencode/media/document.pdf",
            fileName: "document.pdf",
            mimeType: "application/pdf",
            sizeBytes: 5000,
            mediaType: "pdf",
          },
          transcriberKind: "document",
        } satisfies PreparedMediaPrompt),
      });

      await handleDocumentMessage(ctx, deps);

      expect(processPromptMock).toHaveBeenCalledWith(
        ctx,
        "prepared pdf fallback text with caption context",
        deps,
      );
      expect(processPromptMock).not.toHaveBeenCalledWith(ctx, "Summarize this document", deps);
    });
  });

  describe("unsupported file types", () => {
    it("ignores unsupported MIME types silently", async () => {
      const { ctx, replyMock } = createDocumentContext({
        document: {
          file_id: "zip-file-id",
          file_unique_id: "zip-unique-id",
          file_name: "archive.zip",
          mime_type: "application/zip",
          file_size: 5000,
        },
      });
      const { deps, processPromptMock, downloadMock } = createDocumentDeps();

      await handleDocumentMessage(ctx, deps);

      expect(replyMock).not.toHaveBeenCalled();
      expect(downloadMock).not.toHaveBeenCalled();
      expect(processPromptMock).not.toHaveBeenCalled();
    });

    it("ignores image files", async () => {
      const { ctx, replyMock } = createDocumentContext({
        document: {
          file_id: "image-file-id",
          file_unique_id: "image-unique-id",
          file_name: "photo.png",
          mime_type: "image/png",
          file_size: 5000,
        },
      });
      const { deps, processPromptMock } = createDocumentDeps();

      await handleDocumentMessage(ctx, deps);

      expect(replyMock).not.toHaveBeenCalled();
      expect(processPromptMock).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("shows download error when file download fails", async () => {
      const { ctx, replyMock } = createDocumentContext();
      const { deps } = createDocumentDeps({
        downloadFile: vi.fn().mockRejectedValue(new Error("Network error")),
      });
      const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

      await handleDocumentMessage(ctx, deps);

      expect(replyMock).toHaveBeenCalledWith(t("bot.file_download_error"));
      expect(errorSpy).toHaveBeenCalledWith(
        "[Document] Error handling document message:",
        expect.any(Error),
      );
    });

    it("shows process error when media preparation fails after download", async () => {
      const { ctx, replyMock } = createDocumentContext();
      const { deps } = createDocumentDeps({
        prepareMediaPrompt: vi.fn().mockRejectedValue(new Error("Failed to extract text")),
      });
      const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

      await handleDocumentMessage(ctx, deps);

      expect(replyMock).toHaveBeenNthCalledWith(1, t("bot.file_downloading"));
      expect(replyMock).toHaveBeenNthCalledWith(2, t("bot.file_process_error"));
      expect(errorSpy).toHaveBeenCalledWith(
        "[Document] Error processing document message:",
        expect.any(Error),
      );
    });
  });

  describe("missing document", () => {
    it("returns early when no document in message", async () => {
      const ctx = { chat: { id: 777 }, message: {} } as unknown as Context;
      const { deps, processPromptMock } = createDocumentDeps();

      await handleDocumentMessage(ctx, deps);

      expect(processPromptMock).not.toHaveBeenCalled();
    });
  });
});
