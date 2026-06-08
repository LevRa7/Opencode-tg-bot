import type { FilePartInput } from "@opencode-ai/sdk/v2";

export type StoredMediaType = "image" | "pdf" | "audio" | "video" | "text_document";

export type MediaTranscriberKind = "photo" | "document" | "audio" | "video";

export type MediaStorageOwner =
  | {
      userId: number;
      runtimeKind: "host";
    }
  | {
      userId: number;
      runtimeKind: "tenant";
      tenantId: string;
      /**
       * SSH active → file needs to be uploaded to remote machine
       * after writing locally; runtimeVisiblePath should point to
       * the remote-accessible path.
       */
      sshUploadToRemote: boolean;
    };

export interface StoredMediaFile {
  hostAbsolutePath: string;
  runtimeVisiblePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  mediaType: StoredMediaType;
}

export type PreparedMediaPrompt =
  | {
      mode: "attachment";
      promptText: string;
      fileParts: [FilePartInput];
      sourceFile: StoredMediaFile;
      transcriberKind: MediaTranscriberKind;
    }
  | {
      mode: "text";
      recognizedText?: string;
      promptText: string;
      sourceFile: StoredMediaFile;
      transcriberKind: MediaTranscriberKind;
    };
