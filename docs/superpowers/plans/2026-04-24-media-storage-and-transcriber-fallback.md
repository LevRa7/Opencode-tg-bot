# Media Storage And Transcriber Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every incoming Telegram media file in runtime-aware user storage and automatically route unsupported media or unavailable audio STT through the local `openai-media-transcriber` scripts before forwarding text plus a runtime-visible file path to OpenCode.

**Architecture:** Add a small `src/media/*` layer that separates three concerns: runtime-aware persistent file storage, local transcriber script execution, and prompt preparation for native attachment versus fallback text flows. Keep Telegram handlers thin: download the file, call the shared media layer, then dispatch via `processUserPrompt`. For tenant users, store media on the host bind mount under `<WORKSPACES_ROOT>/<tenantId>/state/media/...` while exposing `/state/media/...` back to the tenant runtime in prompts.

**Tech Stack:** TypeScript, Node.js 20, grammY, Vitest, existing runtime path helpers, existing model capability helpers, existing logger/i18n modules, local `node` child-process execution.

---

## File Map

- `src/media/types.ts` - shared media-domain types used by storage, ingest, and transcriber helpers.
- `src/media/storage.ts` - runtime-aware persistent storage helper that writes host files and returns both host and runtime-visible paths.
- `tests/media/storage.test.ts` - storage tests for host roots, tenant roots, file naming, and sanitization.
- `src/media/transcriber.ts` - adapter that invokes `skills/openai-media-transcriber/scripts/*.mjs` through `node` and normalizes failures.
- `tests/media/transcriber.test.ts` - adapter tests for script selection, success parsing, empty output, and process failures.
- `package.json` - include `skills/openai-media-transcriber` in packaged files so installed mode can still execute the local scripts.
- `src/media/ingest.ts` - shared prompt-preparation orchestrator for attachment media and audio/STT fallback flows.
- `tests/media/ingest.test.ts` - ingest tests for owner resolution, native attachment flow, fallback text flow, and audio STT fallback behavior.
- `src/bot/handlers/photo.ts` - new dedicated photo handler using the shared media layer.
- `tests/bot/handlers/photo.test.ts` - photo handler tests for native attachment flow, fallback text flow, and error handling.
- `src/bot/index.ts` - replace inline photo logic with `handlePhotoMessage`.
- `src/bot/handlers/document.ts` - route text documents and PDFs through the shared media layer, including PDF fallback.
- `tests/bot/handlers/document.test.ts` - document handler tests updated to assert shared-media behavior instead of caption-only fallback.
- `src/bot/handlers/video.ts` - route videos and video notes through the shared media layer.
- `tests/bot/handlers/video.test.ts` - video handler tests updated for fallback text routing.
- `src/bot/handlers/voice.ts` - save audio first and switch from `stt.not_configured` hard stop to shared STT-or-transcriber prompt preparation.
- `tests/bot/handlers/voice.test.ts` - voice handler tests updated for STT success, fallback handling, and empty-result behavior.
- `src/i18n/en.ts` - add a generic media-processing status and media-processing error string.
- `src/i18n/de.ts` - add localized media-processing strings.
- `src/i18n/es.ts` - add localized media-processing strings.
- `src/i18n/fr.ts` - add localized media-processing strings.
- `src/i18n/ru.ts` - add localized media-processing strings.
- `src/i18n/zh.ts` - add localized media-processing strings.
- `PRODUCT.md` - update the implemented-feature bullets to mention persistent media storage and automatic fallback behavior.
- `CHANGELOG.md` - record the new persistent media storage and fallback flow.

---

### Task 1: Add the Shared Media Types And Storage Helper

**Files:**
- Create: `src/media/types.ts`
- Create: `src/media/storage.ts`
- Create: `tests/media/storage.test.ts`

- [ ] **Step 1: Write the failing storage tests first**

```typescript
// Create tests/media/storage.test.ts
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setRuntimeMode } from "../../src/runtime/mode.js";
import { saveIncomingMediaFile } from "../../src/media/storage.js";
import type { MediaStorageOwner } from "../../src/media/types.js";

describe("media/storage", () => {
  const tempHome = path.join(process.cwd(), ".tmp", "media-storage-home");
  const tempWorkspaces = path.join(process.cwd(), ".tmp", "media-storage-workspaces");
  const timestamp = new Date("2026-04-24T10:11:12.000Z");

  beforeEach(async () => {
    setRuntimeMode("installed");
    vi.stubEnv("OPENCODE_TELEGRAM_HOME", tempHome);
    vi.stubEnv("WORKSPACES_ROOT", tempWorkspaces);
    await fs.rm(tempHome, { recursive: true, force: true });
    await fs.rm(tempWorkspaces, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.OPENCODE_TELEGRAM_RUNTIME_MODE;
  });

  it("stores host media under appHome/media and returns the same runtime-visible path", async () => {
    const owner: MediaStorageOwner = { userId: 123, runtimeKind: "host" };

    const stored = await saveIncomingMediaFile({
      owner,
      telegramFileId: "abc123",
      originalFileName: "Screenshot 1.png",
      fallbackFileName: "photo.png",
      mimeType: "image/png",
      mediaType: "image",
      buffer: Buffer.from("png"),
      now: timestamp,
    });

    const expectedPath = path.join(
      tempHome,
      "media",
      "123",
      "2026",
      "04",
      "24",
      stored.fileName,
    );

    expect(stored.hostAbsolutePath).toBe(expectedPath);
    expect(stored.runtimeVisiblePath).toBe(expectedPath);
    expect(await fs.readFile(stored.hostAbsolutePath, "utf-8")).toBe("png");
  });

  it("stores tenant media under the tenant state mount and returns a /state runtime path", async () => {
    const owner: MediaStorageOwner = { userId: 222, runtimeKind: "tenant", tenantId: "tg-222" };

    const stored = await saveIncomingMediaFile({
      owner,
      telegramFileId: "tenant-file",
      originalFileName: "clip.mp4",
      fallbackFileName: "video.mp4",
      mimeType: "video/mp4",
      mediaType: "video",
      buffer: Buffer.from("video"),
      now: timestamp,
    });

    expect(stored.hostAbsolutePath).toBe(
      path.join(
        tempWorkspaces,
        "tg-222",
        "state",
        "media",
        "222",
        "2026",
        "04",
        "24",
        stored.fileName,
      ),
    );
    expect(stored.runtimeVisiblePath).toBe(`/state/media/222/2026/04/24/${stored.fileName}`);
    expect(await fs.readFile(stored.hostAbsolutePath, "utf-8")).toBe("video");
  });

  it("sanitizes the stored filename and keeps the extension from the original name", async () => {
    const owner: MediaStorageOwner = { userId: 123, runtimeKind: "host" };

    const stored = await saveIncomingMediaFile({
      owner,
      telegramFileId: "file/id:42",
      originalFileName: "../../Quarterly Report (final).pdf",
      fallbackFileName: "document.pdf",
      mimeType: "application/pdf",
      mediaType: "pdf",
      buffer: Buffer.from("pdf"),
      now: timestamp,
    });

    expect(stored.fileName).toBe(
      "2026-04-24T10-11-12-000Z-file-id-42-Quarterly-Report-final.pdf",
    );
  });
});
```

- [ ] **Step 2: Run the storage test to verify it fails**

Run: `npm test -- tests/media/storage.test.ts`
Expected: FAIL with `Cannot find module '../../src/media/storage.js'`.

- [ ] **Step 3: Write the minimal shared type and storage implementation**

```typescript
// Create src/media/types.ts
import type { FilePartInput } from "@opencode-ai/sdk/v2";

export type StoredMediaType = "image" | "pdf" | "audio" | "video" | "text_document";
export type MediaTranscriberKind = "photo" | "document" | "audio" | "video";

export interface MediaStorageOwner {
  userId: number;
  runtimeKind: "host" | "tenant";
  tenantId?: string;
}

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
      storedFile: StoredMediaFile;
      fileParts: FilePartInput[];
      recognizedText?: string;
    }
  | {
      mode: "text";
      promptText: string;
      storedFile: StoredMediaFile;
      recognizedText?: string;
    };

// Create src/media/storage.ts
import fs from "node:fs/promises";
import path from "node:path";
import { getRuntimePaths } from "../runtime/paths.js";
import type { MediaStorageOwner, StoredMediaFile, StoredMediaType } from "./types.js";

const DEFAULT_WORKSPACES_ROOT = "/home/me/Workspaces";

export interface SaveIncomingMediaFileParams {
  owner: MediaStorageOwner;
  telegramFileId: string;
  originalFileName?: string;
  fallbackFileName: string;
  mimeType: string;
  mediaType: StoredMediaType;
  buffer: Buffer;
  now?: Date;
}

function sanitizeSegment(value: string): string {
  const normalized = value
    .trim()
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");

  return normalized || "file";
}

function formatDateSegment(value: number): string {
  return String(value).padStart(2, "0");
}

function sanitizeExtension(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9]+/g, "").trim();
  return normalized ? `.${normalized}` : "";
}

function buildStoredFileName(params: {
  now: Date;
  telegramFileId: string;
  originalFileName?: string;
  fallbackFileName: string;
}): string {
  const timestamp = params.now.toISOString().replace(/[:.]/g, "-");
  const safeFileId = sanitizeSegment(params.telegramFileId);
  const parsedOriginal = path.parse(params.originalFileName || params.fallbackFileName);
  const parsedFallback = path.parse(params.fallbackFileName);
  const safeStem = sanitizeSegment(parsedOriginal.name || parsedFallback.name || "file");
  const safeExtension = sanitizeExtension((parsedOriginal.ext || parsedFallback.ext).replace(/^\./, ""));
  return `${timestamp}-${safeFileId}-${safeStem}${safeExtension}`;
}

function resolveOwnerRoots(owner: MediaStorageOwner): {
  hostRoot: string;
  runtimeVisibleRoot: string;
} {
  if (owner.runtimeKind === "tenant") {
    const workspacesRoot = process.env.WORKSPACES_ROOT || DEFAULT_WORKSPACES_ROOT;
    const tenantId = owner.tenantId || `tg-${owner.userId}`;

    return {
      hostRoot: path.join(workspacesRoot, tenantId, "state"),
      runtimeVisibleRoot: "/state",
    };
  }

  return {
    hostRoot: getRuntimePaths().appHome,
    runtimeVisibleRoot: getRuntimePaths().appHome,
  };
}

export async function saveIncomingMediaFile(
  params: SaveIncomingMediaFileParams,
): Promise<StoredMediaFile> {
  const now = params.now ?? new Date();
  const year = String(now.getUTCFullYear());
  const month = formatDateSegment(now.getUTCMonth() + 1);
  const day = formatDateSegment(now.getUTCDate());
  const fileName = buildStoredFileName({
    now,
    telegramFileId: params.telegramFileId,
    originalFileName: params.originalFileName,
    fallbackFileName: params.fallbackFileName,
  });
  const { hostRoot, runtimeVisibleRoot } = resolveOwnerRoots(params.owner);
  const hostDir = path.join(hostRoot, "media", String(params.owner.userId), year, month, day);
  const runtimeVisibleDir = path.posix.join(
    runtimeVisibleRoot,
    "media",
    String(params.owner.userId),
    year,
    month,
    day,
  );
  const hostAbsolutePath = path.join(hostDir, fileName);

  await fs.mkdir(hostDir, { recursive: true });
  await fs.writeFile(hostAbsolutePath, params.buffer);

  return {
    hostAbsolutePath,
    runtimeVisiblePath:
      params.owner.runtimeKind === "tenant"
        ? path.posix.join(runtimeVisibleDir, fileName)
        : hostAbsolutePath,
    fileName,
    mimeType: params.mimeType,
    sizeBytes: params.buffer.length,
    mediaType: params.mediaType,
  };
}
```

- [ ] **Step 4: Run the storage test again to verify it passes**

Run: `npm test -- tests/media/storage.test.ts`
Expected: PASS with 3 passing tests in `tests/media/storage.test.ts`.

- [ ] **Step 5: Commit the storage foundation**

```bash
git add src/media/types.ts src/media/storage.ts tests/media/storage.test.ts
git commit -m "feat: add runtime-aware media storage"
```

---

### Task 2: Add the Local Media Transcriber Adapter

**Files:**
- Create: `src/media/transcriber.ts`
- Create: `tests/media/transcriber.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing transcriber tests first**

```typescript
// Create tests/media/transcriber.test.ts
import type { ExecFileOptions } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

const execFileMock = vi.hoisted(() =>
  vi.fn(
    (
      _command: string,
      _args: ReadonlyArray<string>,
      _options: ExecFileOptions,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      callback(null, "recognized text\n", "");
      return undefined;
    },
  ),
);

import {
  MediaTranscriberError,
  resolveMediaTranscriberScriptPath,
  transcribeStoredMedia,
} from "../../src/media/transcriber.js";

describe("media/transcriber", () => {
  it("resolves the photo script path from the project skill directory", () => {
    expect(resolveMediaTranscriberScriptPath("photo")).toMatch(
      /skills\/openai-media-transcriber\/scripts\/photo\.mjs$/,
    );
  });

  it("returns trimmed stdout from the transcriber process", async () => {
    const text = await transcribeStoredMedia({
      kind: "video",
      hostAbsolutePath: "/tmp/clip.mp4",
      prompt: "Describe the clip",
      execFileImpl: execFileMock,
    });

    expect(execFileMock).toHaveBeenCalledWith(
      "node",
      [expect.stringMatching(/video\.mjs$/), "/tmp/clip.mp4", "Describe the clip"],
      expect.objectContaining({ env: process.env, maxBuffer: 10 * 1024 * 1024 }),
      expect.any(Function),
    );
    expect(text).toBe("recognized text");
  });

  it("throws a structured MediaTranscriberError on process failure", async () => {
    execFileMock.mockImplementationOnce(
      (
        _command: string,
        _args: ReadonlyArray<string>,
        _options: ExecFileOptions,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        const error = Object.assign(new Error("boom"), { code: 2 });
        callback(error, "", "stderr text");
        return undefined;
      },
    );

    await expect(
      transcribeStoredMedia({
        kind: "audio",
        hostAbsolutePath: "/tmp/audio.ogg",
        execFileImpl: execFileMock,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "MediaTranscriberError",
        exitCode: 2,
        stderr: "stderr text",
      }),
    );
  });

  it("treats empty stdout as a failed transcription", async () => {
    execFileMock.mockImplementationOnce(
      (
        _command: string,
        _args: ReadonlyArray<string>,
        _options: ExecFileOptions,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callback(null, "   \n", "");
        return undefined;
      },
    );

    await expect(
      transcribeStoredMedia({
        kind: "document",
        hostAbsolutePath: "/tmp/file.pdf",
        execFileImpl: execFileMock,
      }),
    ).rejects.toThrow("Media transcriber returned empty output");
  });
});
```

- [ ] **Step 2: Run the transcriber test to verify it fails**

Run: `npm test -- tests/media/transcriber.test.ts`
Expected: FAIL with `Cannot find module '../../src/media/transcriber.js'`.

- [ ] **Step 3: Write the minimal transcriber adapter and ship the scripts in installed builds**

```typescript
// Create src/media/transcriber.ts
import type { ExecFileOptions } from "node:child_process";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { MediaTranscriberKind } from "./types.js";

const TRANSCRIBER_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

const TRANSCRIBER_SCRIPT_PATHS: Record<MediaTranscriberKind, string> = {
  photo: fileURLToPath(
    new URL("../../skills/openai-media-transcriber/scripts/photo.mjs", import.meta.url),
  ),
  document: fileURLToPath(
    new URL("../../skills/openai-media-transcriber/scripts/document.mjs", import.meta.url),
  ),
  audio: fileURLToPath(
    new URL("../../skills/openai-media-transcriber/scripts/audio.mjs", import.meta.url),
  ),
  video: fileURLToPath(
    new URL("../../skills/openai-media-transcriber/scripts/video.mjs", import.meta.url),
  ),
};

export interface ExecFileLike {
  (
    command: string,
    args: ReadonlyArray<string>,
    options: ExecFileOptions,
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ): void;
}

export class MediaTranscriberError extends Error {
  constructor(
    message: string,
    readonly scriptPath: string,
    readonly stderr: string,
    readonly exitCode: number | null,
  ) {
    super(message);
    this.name = "MediaTranscriberError";
  }
}

export function resolveMediaTranscriberScriptPath(kind: MediaTranscriberKind): string {
  return TRANSCRIBER_SCRIPT_PATHS[kind];
}

function runExecFile(
  execFileImpl: ExecFileLike,
  command: string,
  args: readonly string[],
  options: ExecFileOptions,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFileImpl(command, args, options, (error, stdout, stderr) => {
      if (error) {
        const exitCode = typeof (error as NodeJS.ErrnoException).code === "number"
          ? ((error as NodeJS.ErrnoException).code as number)
          : null;
        reject(
          new MediaTranscriberError(
            `Media transcriber failed for ${args[0]}`,
            String(args[0]),
            stderr.trim(),
            exitCode,
          ),
        );
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

export async function transcribeStoredMedia(params: {
  kind: MediaTranscriberKind;
  hostAbsolutePath: string;
  prompt?: string;
  execFileImpl?: ExecFileLike;
}): Promise<string> {
  const scriptPath = resolveMediaTranscriberScriptPath(params.kind);
  const args = [scriptPath, params.hostAbsolutePath];
  if (params.prompt?.trim()) {
    args.push(params.prompt.trim());
  }

  const { stdout } = await runExecFile(params.execFileImpl ?? execFile, "node", args, {
    env: process.env,
    maxBuffer: TRANSCRIBER_MAX_BUFFER_BYTES,
  });
  const text = stdout.trim();

  if (!text) {
    throw new MediaTranscriberError(
      "Media transcriber returned empty output",
      scriptPath,
      "",
      null,
    );
  }

  return text;
}
```

```json
// Modify package.json
{
  "files": [
    "dist",
    "skills/openai-media-transcriber",
    "README.md",
    "LICENSE",
    ".env.example"
  ]
}
```

- [ ] **Step 4: Run the transcriber test again to verify it passes**

Run: `npm test -- tests/media/transcriber.test.ts`
Expected: PASS with 4 passing tests in `tests/media/transcriber.test.ts`.

- [ ] **Step 5: Commit the transcriber adapter**

```bash
git add src/media/transcriber.ts tests/media/transcriber.test.ts package.json
git commit -m "feat: add media transcriber adapter"
```

---

### Task 3: Add Attachment-Media Prompt Preparation

**Files:**
- Create: `src/media/ingest.ts`
- Create: `tests/media/ingest.test.ts`

- [ ] **Step 1: Write the failing attachment-ingest tests first**

```typescript
// Create tests/media/ingest.test.ts
import type { Context } from "grammy";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentOpencodeRouteMock = vi.hoisted(() =>
  vi.fn(() => ({ runtimeKey: "host", baseUrl: "http://localhost:4096", kind: "host" as const })),
);

vi.mock("../../src/opencode/client.js", () => ({
  getCurrentOpencodeRoute: getCurrentOpencodeRouteMock,
}));

import {
  prepareAttachmentMediaPrompt,
  resolveMediaStorageOwner,
} from "../../src/media/ingest.js";

const ctx = {
  from: { id: 123 },
  chat: { id: 777 },
} as unknown as Context;

const savedImage = {
  hostAbsolutePath: "/tmp/photo.jpg",
  runtimeVisiblePath: "/state/media/123/2026/04/24/photo.jpg",
  fileName: "photo.jpg",
  mimeType: "image/jpeg",
  sizeBytes: 5,
  mediaType: "image" as const,
};

describe("media/ingest attachment flow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves a tenant storage owner from the current OpenCode route", () => {
    getCurrentOpencodeRouteMock.mockReturnValue({
      runtimeKey: "tenant:123:tg-123",
      baseUrl: "http://localhost:5001",
      kind: "tenant",
      tenantId: "tg-123",
      userId: 123,
      chatId: 777,
    });

    expect(resolveMediaStorageOwner(ctx)).toEqual({
      userId: 123,
      runtimeKind: "tenant",
      tenantId: "tg-123",
    });
  });

  it("builds a text prompt for stored text documents", async () => {
    const saveIncomingMediaFile = vi.fn().mockResolvedValue({
      ...savedImage,
      fileName: "notes.txt",
      mimeType: "text/plain",
      mediaType: "text_document",
      runtimeVisiblePath: "/state/media/123/2026/04/24/notes.txt",
    });

    const result = await prepareAttachmentMediaPrompt({
      ctx,
      telegramFileId: "doc-id",
      mediaType: "text_document",
      mimeType: "text/plain",
      originalFileName: "notes.txt",
      fallbackFileName: "notes.txt",
      caption: "Summarize this",
      buffer: Buffer.from("alpha\nbeta"),
      textContent: "alpha\nbeta",
      saveIncomingMediaFile,
    });

    expect(result).toEqual({
      mode: "text",
      storedFile: expect.objectContaining({ fileName: "notes.txt" }),
      promptText:
        "User attached a local media file.\n\nSaved file path: /state/media/123/2026/04/24/notes.txt\nMedia analysis/transcript:\nalpha\nbeta\n\nUser caption/instruction:\nSummarize this",
    });
  });

  it("returns a native file part when the selected model supports the media input", async () => {
    const saveIncomingMediaFile = vi.fn().mockResolvedValue(savedImage);
    const getStoredModel = vi.fn().mockReturnValue({ providerID: "openai", modelID: "gpt-5.4" });
    const getModelCapabilities = vi.fn().mockResolvedValue({
      attachment: true,
      input: { image: true, pdf: false, video: false, audio: false, text: true },
      output: { text: true, image: false, audio: false, video: false, pdf: false },
      reasoning: false,
      toolcall: true,
      temperature: true,
      interleaved: false,
    });

    const result = await prepareAttachmentMediaPrompt({
      ctx,
      telegramFileId: "photo-id",
      mediaType: "image",
      mimeType: "image/jpeg",
      originalFileName: "photo.jpg",
      fallbackFileName: "photo.jpg",
      caption: "Describe this",
      buffer: Buffer.from("image"),
      saveIncomingMediaFile,
      getStoredModel,
      getModelCapabilities,
    });

    expect(result).toEqual({
      mode: "attachment",
      storedFile: savedImage,
      promptText: "Describe this",
      fileParts: [
        {
          type: "file",
          mime: "image/jpeg",
          filename: "photo.jpg",
          url: "data:image/jpeg;base64,aW1hZ2U=",
        },
      ],
    });
  });

  it("falls back to transcriber text when the model lacks the required media input", async () => {
    const saveIncomingMediaFile = vi.fn().mockResolvedValue(savedImage);
    const getStoredModel = vi.fn().mockReturnValue({ providerID: "openai", modelID: "gpt-5.4" });
    const getModelCapabilities = vi.fn().mockResolvedValue({
      attachment: true,
      input: { image: false, pdf: false, video: false, audio: false, text: true },
      output: { text: true, image: false, audio: false, video: false, pdf: false },
      reasoning: false,
      toolcall: true,
      temperature: true,
      interleaved: false,
    });
    const transcribeStoredMedia = vi.fn().mockResolvedValue("A whiteboard with TODO items.");
    const onFallbackStart = vi.fn().mockResolvedValue(undefined);

    const result = await prepareAttachmentMediaPrompt({
      ctx,
      telegramFileId: "photo-id",
      mediaType: "image",
      mimeType: "image/jpeg",
      originalFileName: "photo.jpg",
      fallbackFileName: "photo.jpg",
      caption: "Please summarize",
      buffer: Buffer.from("image"),
      saveIncomingMediaFile,
      getStoredModel,
      getModelCapabilities,
      transcribeStoredMedia,
      onFallbackStart,
    });

    expect(onFallbackStart).toHaveBeenCalledTimes(1);
    expect(transcribeStoredMedia).toHaveBeenCalledWith({
      kind: "photo",
      hostAbsolutePath: "/tmp/photo.jpg",
    });
    expect(result).toEqual({
      mode: "text",
      storedFile: savedImage,
      promptText:
        "User attached a local media file.\n\nSaved file path: /state/media/123/2026/04/24/photo.jpg\nMedia analysis/transcript:\nA whiteboard with TODO items.\n\nUser caption/instruction:\nPlease summarize",
    });
  });
});
```

- [ ] **Step 2: Run the attachment-ingest test to verify it fails**

Run: `npm test -- tests/media/ingest.test.ts`
Expected: FAIL with `Cannot find module '../../src/media/ingest.js'`.

- [ ] **Step 3: Write the minimal attachment-ingest implementation**

```typescript
// Create src/media/ingest.ts
import type { Context } from "grammy";
import type { FilePartInput } from "@opencode-ai/sdk/v2";
import { toDataUri } from "../bot/utils/file-download.js";
import { getCurrentOpencodeRoute } from "../opencode/client.js";
import { getModelCapabilities, supportsInput } from "../model/capabilities.js";
import { getStoredModel } from "../model/manager.js";
import { saveIncomingMediaFile } from "./storage.js";
import { transcribeStoredMedia } from "./transcriber.js";
import type {
  MediaStorageOwner,
  MediaTranscriberKind,
  PreparedMediaPrompt,
  StoredMediaType,
} from "./types.js";

function requireTelegramUserId(ctx: Context): number {
  const userId = ctx.from?.id;
  if (typeof userId !== "number") {
    throw new Error("Telegram user id is required for media storage");
  }
  return userId;
}

export function resolveMediaStorageOwner(ctx: Context): MediaStorageOwner {
  const route = getCurrentOpencodeRoute();
  const userId = requireTelegramUserId(ctx);

  if (route.kind === "tenant") {
    return {
      userId,
      runtimeKind: "tenant",
      tenantId: route.tenantId || `tg-${userId}`,
    };
  }

  return { userId, runtimeKind: "host" };
}

export function buildStoredMediaPrompt(params: {
  runtimeVisiblePath: string;
  extractedText: string;
  caption: string;
}): string {
  const parts = [
    "User attached a local media file.",
    "",
    `Saved file path: ${params.runtimeVisiblePath}`,
    "Media analysis/transcript:",
    params.extractedText.trim(),
  ];

  if (params.caption.trim()) {
    parts.push("", "User caption/instruction:", params.caption.trim());
  }

  return parts.join("\n");
}

function getRequiredInput(mediaType: StoredMediaType): "image" | "pdf" | "video" | null {
  switch (mediaType) {
    case "image":
      return "image";
    case "pdf":
      return "pdf";
    case "video":
      return "video";
    default:
      return null;
  }
}

function getTranscriberKind(mediaType: StoredMediaType): MediaTranscriberKind {
  switch (mediaType) {
    case "image":
      return "photo";
    case "pdf":
      return "document";
    case "video":
      return "video";
    default:
      throw new Error(`Unsupported transcriber media type: ${mediaType}`);
  }
}

export interface PrepareAttachmentMediaPromptParams {
  ctx: Context;
  telegramFileId: string;
  mediaType: Extract<StoredMediaType, "image" | "pdf" | "video" | "text_document">;
  mimeType: string;
  originalFileName?: string;
  fallbackFileName: string;
  caption: string;
  buffer: Buffer;
  textContent?: string;
  onFallbackStart?: () => Promise<void>;
  saveIncomingMediaFile?: typeof saveIncomingMediaFile;
  transcribeStoredMedia?: typeof transcribeStoredMedia;
  getModelCapabilities?: typeof getModelCapabilities;
  getStoredModel?: typeof getStoredModel;
}

export async function prepareAttachmentMediaPrompt(
  params: PrepareAttachmentMediaPromptParams,
): Promise<PreparedMediaPrompt> {
  const saveFile = params.saveIncomingMediaFile ?? saveIncomingMediaFile;
  const storedFile = await saveFile({
    owner: resolveMediaStorageOwner(params.ctx),
    telegramFileId: params.telegramFileId,
    originalFileName: params.originalFileName,
    fallbackFileName: params.fallbackFileName,
    mimeType: params.mimeType,
    mediaType: params.mediaType,
    buffer: params.buffer,
  });

  if (params.mediaType === "text_document") {
    return {
      mode: "text",
      storedFile,
      promptText: buildStoredMediaPrompt({
        runtimeVisiblePath: storedFile.runtimeVisiblePath,
        extractedText: params.textContent || params.buffer.toString("utf-8"),
        caption: params.caption,
      }),
    };
  }

  const storedModel = (params.getStoredModel ?? getStoredModel)();
  const capabilities = await (params.getModelCapabilities ?? getModelCapabilities)(
    storedModel.providerID,
    storedModel.modelID,
  );
  const requiredInput = getRequiredInput(params.mediaType);

  if (requiredInput && supportsInput(capabilities, requiredInput)) {
    const filePart: FilePartInput = {
      type: "file",
      mime: params.mimeType,
      filename: storedFile.fileName,
      url: toDataUri(params.buffer, params.mimeType),
    };

    return {
      mode: "attachment",
      storedFile,
      promptText: params.caption,
      fileParts: [filePart],
    };
  }

  await params.onFallbackStart?.();
  const extractedText = await (params.transcribeStoredMedia ?? transcribeStoredMedia)({
    kind: getTranscriberKind(params.mediaType),
    hostAbsolutePath: storedFile.hostAbsolutePath,
  });

  return {
    mode: "text",
    storedFile,
    promptText: buildStoredMediaPrompt({
      runtimeVisiblePath: storedFile.runtimeVisiblePath,
      extractedText,
      caption: params.caption,
    }),
  };
}
```

- [ ] **Step 4: Run the attachment-ingest test again to verify it passes**

Run: `npm test -- tests/media/ingest.test.ts`
Expected: PASS with 4 passing tests in `tests/media/ingest.test.ts`.

- [ ] **Step 5: Commit the attachment-ingest layer**

```bash
git add src/media/ingest.ts tests/media/ingest.test.ts
git commit -m "feat: add attachment media ingest flow"
```

---

### Task 4: Extend the Media Ingest Layer For Audio STT Fallback

**Files:**
- Modify: `src/media/ingest.ts`
- Modify: `tests/media/ingest.test.ts`

- [ ] **Step 1: Add failing audio-ingest tests first**

```typescript
// Extend tests/media/ingest.test.ts
describe("media/ingest audio flow", () => {
  it("keeps the regular STT path when STT succeeds", async () => {
    const saveIncomingMediaFile = vi.fn().mockResolvedValue({
      ...savedImage,
      fileName: "audio.ogg",
      mimeType: "audio/ogg",
      mediaType: "audio",
      runtimeVisiblePath: "/state/media/123/2026/04/24/audio.ogg",
      hostAbsolutePath: "/tmp/audio.ogg",
    });
    const transcribeAudio = vi.fn().mockResolvedValue({ text: "run tests" });
    const transcribeStoredMedia = vi.fn();

    const result = await prepareAudioPrompt({
      ctx,
      telegramFileId: "audio-id",
      mimeType: "audio/ogg",
      originalFileName: "audio.ogg",
      fallbackFileName: "audio.ogg",
      buffer: Buffer.from("audio"),
      saveIncomingMediaFile,
      transcribeAudio,
      isSttConfigured: () => true,
      transcribeStoredMedia,
    });

    expect(transcribeStoredMedia).not.toHaveBeenCalled();
    expect(result).toEqual({
      mode: "text",
      storedFile: expect.objectContaining({ fileName: "audio.ogg" }),
      recognizedText: "run tests",
      promptText:
        "User attached a local media file.\n\nSaved file path: /state/media/123/2026/04/24/audio.ogg\nMedia analysis/transcript:\nrun tests",
    });
  });

  it("falls back to the local transcriber when STT is not configured", async () => {
    const saveIncomingMediaFile = vi.fn().mockResolvedValue({
      ...savedImage,
      fileName: "audio.ogg",
      mimeType: "audio/ogg",
      mediaType: "audio",
      runtimeVisiblePath: "/state/media/123/2026/04/24/audio.ogg",
      hostAbsolutePath: "/tmp/audio.ogg",
    });
    const transcribeStoredMedia = vi.fn().mockResolvedValue("fallback transcript");
    const onFallbackStart = vi.fn().mockResolvedValue(undefined);

    const result = await prepareAudioPrompt({
      ctx,
      telegramFileId: "audio-id",
      mimeType: "audio/ogg",
      originalFileName: "audio.ogg",
      fallbackFileName: "audio.ogg",
      buffer: Buffer.from("audio"),
      saveIncomingMediaFile,
      isSttConfigured: () => false,
      transcribeAudio: vi.fn(),
      transcribeStoredMedia,
      onFallbackStart,
    });

    expect(onFallbackStart).toHaveBeenCalledTimes(1);
    expect(transcribeStoredMedia).toHaveBeenCalledWith({
      kind: "audio",
      hostAbsolutePath: "/tmp/audio.ogg",
    });
    expect(result.recognizedText).toBe("fallback transcript");
  });

  it("falls back to the local transcriber when STT throws", async () => {
    const saveIncomingMediaFile = vi.fn().mockResolvedValue({
      ...savedImage,
      fileName: "audio.ogg",
      mimeType: "audio/ogg",
      mediaType: "audio",
      runtimeVisiblePath: "/state/media/123/2026/04/24/audio.ogg",
      hostAbsolutePath: "/tmp/audio.ogg",
    });
    const transcribeAudio = vi.fn().mockRejectedValue(new Error("upstream boom"));
    const transcribeStoredMedia = vi.fn().mockResolvedValue("fallback transcript");

    const result = await prepareAudioPrompt({
      ctx,
      telegramFileId: "audio-id",
      mimeType: "audio/ogg",
      originalFileName: "audio.ogg",
      fallbackFileName: "audio.ogg",
      buffer: Buffer.from("audio"),
      saveIncomingMediaFile,
      isSttConfigured: () => true,
      transcribeAudio,
      transcribeStoredMedia,
    });

    expect(result.recognizedText).toBe("fallback transcript");
    expect(transcribeStoredMedia).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the ingest test again to verify the new audio cases fail**

Run: `npm test -- tests/media/ingest.test.ts`
Expected: FAIL because `prepareAudioPrompt` is imported in the test before it exists in `src/media/ingest.ts`.

- [ ] **Step 3: Extend the ingest implementation with audio prompt preparation**

```typescript
// Extend src/media/ingest.ts
import type { SttResult } from "../stt/client.js";

export interface PrepareAudioPromptParams {
  ctx: Context;
  telegramFileId: string;
  mimeType: string;
  originalFileName?: string;
  fallbackFileName: string;
  buffer: Buffer;
  onFallbackStart?: () => Promise<void>;
  saveIncomingMediaFile?: typeof saveIncomingMediaFile;
  transcribeStoredMedia?: typeof transcribeStoredMedia;
  isSttConfigured?: () => boolean;
  transcribeAudio?: (audioBuffer: Buffer, filename: string) => Promise<SttResult>;
}

export async function prepareAudioPrompt(
  params: PrepareAudioPromptParams,
): Promise<PreparedMediaPrompt> {
  const saveFile = params.saveIncomingMediaFile ?? saveIncomingMediaFile;
  const storedFile = await saveFile({
    owner: resolveMediaStorageOwner(params.ctx),
    telegramFileId: params.telegramFileId,
    originalFileName: params.originalFileName,
    fallbackFileName: params.fallbackFileName,
    mimeType: params.mimeType,
    mediaType: "audio",
    buffer: params.buffer,
  });

  const sttConfigured = params.isSttConfigured?.() ?? false;

  if (sttConfigured && params.transcribeAudio) {
    try {
      const sttResult = await params.transcribeAudio(params.buffer, storedFile.fileName);
      const recognizedText = sttResult.text.trim();

      return {
        mode: "text",
        storedFile,
        recognizedText,
        promptText: buildStoredMediaPrompt({
          runtimeVisiblePath: storedFile.runtimeVisiblePath,
          extractedText: recognizedText,
          caption: "",
        }),
      };
    } catch {
      // Fall through to the local media transcriber below.
    }
  }

  await params.onFallbackStart?.();
  const recognizedText = await (params.transcribeStoredMedia ?? transcribeStoredMedia)({
    kind: "audio",
    hostAbsolutePath: storedFile.hostAbsolutePath,
  });

  return {
    mode: "text",
    storedFile,
    recognizedText,
    promptText: buildStoredMediaPrompt({
      runtimeVisiblePath: storedFile.runtimeVisiblePath,
      extractedText: recognizedText,
      caption: "",
    }),
  };
}
```

- [ ] **Step 4: Run the ingest test again to verify it passes**

Run: `npm test -- tests/media/ingest.test.ts`
Expected: PASS with 7 passing tests in `tests/media/ingest.test.ts`.

- [ ] **Step 5: Commit the audio-ingest fallback**

```bash
git add src/media/ingest.ts tests/media/ingest.test.ts
git commit -m "feat: add audio transcription fallback"
```

---

### Task 5: Extract the Photo Handler And Wire It Into the Bot

**Files:**
- Create: `src/bot/handlers/photo.ts`
- Create: `tests/bot/handlers/photo.test.ts`
- Modify: `src/bot/index.ts`
- Modify: `src/i18n/en.ts`

- [ ] **Step 1: Write the failing photo-handler tests first**

```typescript
// Create tests/bot/handlers/photo.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { handlePhotoMessage, type PhotoHandlerDeps } from "../../../src/bot/handlers/photo.js";
import { t } from "../../../src/i18n/index.js";

function createPhotoContext(): { ctx: Context; replyMock: ReturnType<typeof vi.fn> } {
  const replyMock = vi.fn().mockResolvedValue({ message_id: 101 });

  const ctx = {
    chat: { id: 777 },
    from: { id: 123 },
    message: {
      photo: [
        { file_id: "small-photo-id", file_unique_id: "small", width: 10, height: 10 },
        { file_id: "large-photo-id", file_unique_id: "large", width: 20, height: 20 },
      ],
      caption: "Describe this photo",
    },
    reply: replyMock,
    api: {},
  } as unknown as Context;

  return { ctx, replyMock };
}

function createPhotoDeps(overrides: Partial<PhotoHandlerDeps> = {}): {
  deps: PhotoHandlerDeps;
  downloadMock: ReturnType<typeof vi.fn>;
  prepareMediaPromptMock: ReturnType<typeof vi.fn>;
  processPromptMock: ReturnType<typeof vi.fn>;
} {
  const downloadMock = vi.fn().mockResolvedValue({
    buffer: Buffer.from("image"),
    filePath: "photos/file_1.jpg",
  });
  const prepareMediaPromptMock = vi.fn().mockResolvedValue({
    mode: "attachment",
    promptText: "Describe this photo",
    storedFile: {
      hostAbsolutePath: "/tmp/photo.jpg",
      runtimeVisiblePath: "/state/media/123/2026/04/24/photo.jpg",
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 5,
      mediaType: "image",
    },
    fileParts: [
      { type: "file", mime: "image/jpeg", filename: "photo.jpg", url: "data:image/jpeg;base64,aW1hZ2U=" },
    ],
  });
  const processPromptMock = vi.fn().mockResolvedValue(true);

  const deps: PhotoHandlerDeps = {
    bot: {} as PhotoHandlerDeps["bot"],
    ensureEventSubscription: vi.fn().mockResolvedValue(undefined),
    downloadFile: downloadMock,
    prepareMediaPrompt: prepareMediaPromptMock,
    processPrompt: processPromptMock,
    ...overrides,
  };

  return { deps, downloadMock, prepareMediaPromptMock, processPromptMock };
}

describe("bot/handlers/photo", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("dispatches native image attachments through processUserPrompt", async () => {
    const { ctx, replyMock } = createPhotoContext();
    const { deps, downloadMock, prepareMediaPromptMock, processPromptMock } = createPhotoDeps();

    await handlePhotoMessage(ctx, deps);

    expect(replyMock).toHaveBeenCalledWith(t("bot.photo_downloading"));
    expect(downloadMock).toHaveBeenCalledWith(ctx.api, "large-photo-id");
    expect(prepareMediaPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({ mediaType: "image", telegramFileId: "large-photo-id" }),
    );
    expect(processPromptMock).toHaveBeenCalledWith(
      ctx,
      "Describe this photo",
      deps,
      expect.arrayContaining([expect.objectContaining({ type: "file", mime: "image/jpeg" })]),
    );
  });

  it("dispatches fallback text prompts and shows media-processing status", async () => {
    const { ctx, replyMock } = createPhotoContext();
    const { deps, prepareMediaPromptMock, processPromptMock } = createPhotoDeps({
      prepareMediaPrompt: vi.fn().mockImplementation(async (params) => {
        await params.onFallbackStart?.();
        return {
          mode: "text",
          promptText: "fallback photo prompt",
          storedFile: {
            hostAbsolutePath: "/tmp/photo.jpg",
            runtimeVisiblePath: "/state/media/123/2026/04/24/photo.jpg",
            fileName: "photo.jpg",
            mimeType: "image/jpeg",
            sizeBytes: 5,
            mediaType: "image",
          },
        };
      }),
    });

    await handlePhotoMessage(ctx, deps);

    expect(replyMock).toHaveBeenNthCalledWith(1, t("bot.photo_downloading"));
    expect(replyMock).toHaveBeenNthCalledWith(2, t("bot.photo_processing"));
    expect(prepareMediaPromptMock).not.toHaveBeenCalled();
    expect(processPromptMock).toHaveBeenCalledWith(ctx, "fallback photo prompt", deps);
  });

  it("shows photo download error when download fails", async () => {
    const { ctx, replyMock } = createPhotoContext();
    const { deps, processPromptMock } = createPhotoDeps({
      downloadFile: vi.fn().mockRejectedValue(new Error("boom")),
    });

    await handlePhotoMessage(ctx, deps);

    expect(replyMock).toHaveBeenNthCalledWith(1, t("bot.photo_downloading"));
    expect(replyMock).toHaveBeenNthCalledWith(2, t("bot.photo_download_error"));
    expect(processPromptMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the photo-handler test to verify it fails**

Run: `npm test -- tests/bot/handlers/photo.test.ts`
Expected: FAIL with `Cannot find module '../../../src/bot/handlers/photo.js'`.

- [ ] **Step 3: Implement the dedicated photo handler and replace the inline bot logic**

```typescript
// Create src/bot/handlers/photo.ts
import type { Context } from "grammy";
import { processUserPrompt, type ProcessPromptDeps } from "./prompt.js";
import { downloadTelegramFile } from "../utils/file-download.js";
import { prepareAttachmentMediaPrompt } from "../../media/ingest.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";

export interface PhotoHandlerDeps extends ProcessPromptDeps {
  downloadFile?: (
    api: Context["api"],
    fileId: string,
  ) => Promise<{ buffer: Buffer; filePath: string }>;
  prepareMediaPrompt?: typeof prepareAttachmentMediaPrompt;
  processPrompt?: typeof processUserPrompt;
}

export async function handlePhotoMessage(ctx: Context, deps: PhotoHandlerDeps): Promise<void> {
  const photos = ctx.message?.photo;
  if (!photos?.length) {
    return;
  }

  const downloadFile = deps.downloadFile ?? downloadTelegramFile;
  const prepareMediaPrompt = deps.prepareMediaPrompt ?? prepareAttachmentMediaPrompt;
  const processPrompt = deps.processPrompt ?? processUserPrompt;
  const caption = ctx.message.caption || "";
  const largestPhoto = photos[photos.length - 1];

  try {
    await ctx.reply(t("bot.photo_downloading"));
    const downloadedFile = await downloadFile(ctx.api, largestPhoto.file_id);

    try {
      const prepared = await prepareMediaPrompt({
        ctx,
        telegramFileId: largestPhoto.file_id,
        mediaType: "image",
        mimeType: "image/jpeg",
        fallbackFileName: "photo.jpg",
        caption,
        buffer: downloadedFile.buffer,
        onFallbackStart: async () => {
          await ctx.reply(t("bot.photo_processing"));
        },
      });

      if (prepared.mode === "attachment") {
        await processPrompt(ctx, prepared.promptText, deps, prepared.fileParts);
        return;
      }

      await processPrompt(ctx, prepared.promptText, deps);
    } catch (error) {
      logger.error("[Photo] Error processing photo message:", error);
      await ctx.reply(t("bot.photo_process_error"));
    }
  } catch (error) {
    logger.error("[Photo] Error handling photo download:", error);
    await ctx.reply(t("bot.photo_download_error"));
  }
}
```

```typescript
// Modify src/bot/index.ts
import { handlePhotoMessage } from "./handlers/photo.js";

bot.on("message:photo", async (ctx) => {
  logger.debug(`[Bot] Received photo message, chatId=${ctx.chat.id}`);
  const deps = { bot, ensureEventSubscription };
  await handlePhotoMessage(ctx, deps);
});
```

- [ ] **Step 4: Run the photo-handler test again to verify it passes**

Run: `npm test -- tests/bot/handlers/photo.test.ts`
Expected: PASS with 3 passing tests in `tests/bot/handlers/photo.test.ts`.

- [ ] **Step 5: Commit the photo-handler extraction**

```bash
git add src/bot/handlers/photo.ts src/bot/index.ts tests/bot/handlers/photo.test.ts
git commit -m "feat: persist photos before prompt dispatch"
```

---

### Task 6: Route Documents Through the Shared Media Layer

**Files:**
- Modify: `src/bot/handlers/document.ts`
- Modify: `tests/bot/handlers/document.test.ts`
- Modify: `src/i18n/en.ts`

- [ ] **Step 1: Update the document-handler tests first**

```typescript
// Update the deps factory in tests/bot/handlers/document.test.ts
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
    storedFile: {
      hostAbsolutePath: "/tmp/test.txt",
      runtimeVisiblePath: "/state/media/123/2026/04/24/test.txt",
      fileName: "test.txt",
      mimeType: "text/plain",
      sizeBytes: 17,
      mediaType: "text_document",
    },
  });

  const deps: DocumentHandlerDeps = {
    bot: {} as DocumentHandlerDeps["bot"],
    ensureEventSubscription: vi.fn().mockResolvedValue(undefined),
    downloadFile: downloadMock,
    prepareMediaPrompt: prepareMediaPromptMock,
    processPrompt: processPromptMock,
    ...overrides,
  };

  return { deps, processPromptMock, downloadMock, prepareMediaPromptMock };
}

// Replace the text-file assertion
it("routes text files through shared prompt preparation", async () => {
  const { ctx, replyMock } = createDocumentContext();
  const { deps, prepareMediaPromptMock, processPromptMock } = createDocumentDeps();

  await handleDocumentMessage(ctx, deps);

  expect(replyMock).toHaveBeenCalledWith(t("bot.file_downloading"));
  expect(prepareMediaPromptMock).toHaveBeenCalledWith(
    expect.objectContaining({
      mediaType: "text_document",
      textContent: "file content here",
      fallbackFileName: "test.txt",
    }),
  );
  expect(processPromptMock).toHaveBeenCalledWith(ctx, "prepared prompt", deps);
});

// Replace the unsupported-PDF tests with fallback behavior
it("uses transcribed fallback text when the model cannot accept PDFs", async () => {
  const { ctx, replyMock } = createDocumentContext({
    document: {
      file_id: "pdf-file-id",
      file_unique_id: "pdf-unique-id",
      file_name: "document.pdf",
      mime_type: "application/pdf",
      file_size: 5000,
    },
  });
  const { deps, processPromptMock } = createDocumentDeps({
    prepareMediaPrompt: vi.fn().mockImplementation(async (params) => {
      await params.onFallbackStart?.();
      return {
        mode: "text",
        promptText: "pdf fallback prompt",
        storedFile: {
          hostAbsolutePath: "/tmp/document.pdf",
          runtimeVisiblePath: "/state/media/123/2026/04/24/document.pdf",
          fileName: "document.pdf",
          mimeType: "application/pdf",
          sizeBytes: 100,
          mediaType: "pdf",
        },
      };
    }),
  });

  await handleDocumentMessage(ctx, deps);

  expect(replyMock).toHaveBeenNthCalledWith(1, t("bot.file_downloading"));
  expect(replyMock).toHaveBeenNthCalledWith(2, t("bot.file_processing"));
  expect(processPromptMock).toHaveBeenCalledWith(ctx, "pdf fallback prompt", deps);
});
```

- [ ] **Step 2: Run the document-handler test to verify the updated expectations fail**

Run: `npm test -- tests/bot/handlers/document.test.ts`
Expected: FAIL because `DocumentHandlerDeps` does not yet expose `prepareMediaPrompt` and the handler still sends caption-only / model-no-pdf behavior.

- [ ] **Step 3: Implement the shared-media document flow**

```typescript
// Modify src/bot/handlers/document.ts
import { prepareAttachmentMediaPrompt } from "../../media/ingest.js";

export interface DocumentHandlerDeps extends ProcessPromptDeps {
  downloadFile?: (
    api: Context["api"],
    fileId: string,
  ) => Promise<{ buffer: Buffer; filePath: string }>;
  prepareMediaPrompt?: typeof prepareAttachmentMediaPrompt;
  processPrompt?: typeof processUserPrompt;
}

export async function handleDocumentMessage(
  ctx: Context,
  deps: DocumentHandlerDeps,
): Promise<void> {
  const downloadFile = deps.downloadFile ?? downloadTelegramFile;
  const prepareMediaPrompt = deps.prepareMediaPrompt ?? prepareAttachmentMediaPrompt;
  const processPrompt = deps.processPrompt ?? processUserPrompt;

  const doc = ctx.message?.document;
  if (!doc) {
    return;
  }

  const caption = ctx.message.caption || "";
  const mimeType = doc.mime_type || "";
  const filename = doc.file_name || "document";

  try {
    if (isTextMimeType(mimeType)) {
      if (!isFileSizeAllowed(doc.file_size, config.files.maxFileSizeKb)) {
        await ctx.reply(t("bot.text_file_too_large", { maxSizeKb: String(config.files.maxFileSizeKb) }));
        return;
      }

      await ctx.reply(t("bot.file_downloading"));
      const downloadedFile = await downloadFile(ctx.api, doc.file_id);

      try {
        const prepared = await prepareMediaPrompt({
          ctx,
          telegramFileId: doc.file_id,
          mediaType: "text_document",
          mimeType,
          originalFileName: filename,
          fallbackFileName: filename,
          caption,
          buffer: downloadedFile.buffer,
          textContent: downloadedFile.buffer.toString("utf-8"),
        });

        await processPrompt(ctx, prepared.promptText, deps);
      } catch (error) {
        logger.error("[Document] Error processing text document:", error);
        await ctx.reply(t("bot.file_process_error"));
      }
      return;
    }

    if (mimeType === "application/pdf") {
      await ctx.reply(t("bot.file_downloading"));
      const downloadedFile = await downloadFile(ctx.api, doc.file_id);

      try {
        const prepared = await prepareMediaPrompt({
          ctx,
          telegramFileId: doc.file_id,
          mediaType: "pdf",
          mimeType,
          originalFileName: filename,
          fallbackFileName: filename,
          caption,
          buffer: downloadedFile.buffer,
          onFallbackStart: async () => {
            await ctx.reply(t("bot.file_processing"));
          },
        });

        if (prepared.mode === "attachment") {
          await processPrompt(ctx, prepared.promptText, deps, prepared.fileParts);
          return;
        }

        await processPrompt(ctx, prepared.promptText, deps);
      } catch (error) {
        logger.error("[Document] Error processing PDF document:", error);
        await ctx.reply(t("bot.file_process_error"));
      }
      return;
    }

    logger.debug(`[Document] Unsupported document MIME type: ${mimeType}, ignoring`);
  } catch (error) {
    logger.error("[Document] Error handling document download:", error);
    await ctx.reply(t("bot.file_download_error"));
  }
}
```

- [ ] **Step 4: Run the document-handler test again to verify it passes**

Run: `npm test -- tests/bot/handlers/document.test.ts`
Expected: PASS with the updated document tests green and the old caption-only PDF fallback assertions removed.

- [ ] **Step 5: Commit the document flow migration**

```bash
git add src/bot/handlers/document.ts tests/bot/handlers/document.test.ts
git commit -m "feat: add document media fallback flow"
```

---

### Task 7: Route Videos And Video Notes Through the Shared Media Layer

**Files:**
- Modify: `src/bot/handlers/video.ts`
- Modify: `tests/bot/handlers/video.test.ts`
- Modify: `src/i18n/en.ts`

- [ ] **Step 1: Update the video-handler tests first**

```typescript
// Update the deps factory in tests/bot/handlers/video.test.ts
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
    storedFile: {
      hostAbsolutePath: "/tmp/clip.mp4",
      runtimeVisiblePath: "/state/media/123/2026/04/24/clip.mp4",
      fileName: "clip.mp4",
      mimeType: "video/mp4",
      sizeBytes: 12,
      mediaType: "video",
    },
    fileParts: [
      { type: "file", mime: "video/mp4", filename: "clip.mp4", url: "data:video/mp4;base64,dmlkZW8tYmluYXJ5" },
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

  return { deps, processPromptMock, downloadMock, prepareMediaPromptMock };
}

// Add a fallback assertion
it("routes unsupported video input through fallback text preparation", async () => {
  const { ctx, replyMock } = createVideoContext();
  const { deps, processPromptMock } = createVideoDeps({
    prepareMediaPrompt: vi.fn().mockImplementation(async (params) => {
      await params.onFallbackStart?.();
      return {
        mode: "text",
        promptText: "fallback video prompt",
        storedFile: {
          hostAbsolutePath: "/tmp/clip.mp4",
          runtimeVisiblePath: "/state/media/123/2026/04/24/clip.mp4",
          fileName: "clip.mp4",
          mimeType: "video/mp4",
          sizeBytes: 12,
          mediaType: "video",
        },
      };
    }),
  });

  await handleVideoMessage(ctx, deps);

  expect(replyMock).toHaveBeenNthCalledWith(1, t("bot.video_downloading"));
  expect(replyMock).toHaveBeenNthCalledWith(2, t("bot.video_processing"));
  expect(processPromptMock).toHaveBeenCalledWith(ctx, "fallback video prompt", deps);
});
```

- [ ] **Step 2: Run the video-handler test to verify the new fallback case fails**

Run: `npm test -- tests/bot/handlers/video.test.ts`
Expected: FAIL because `VideoHandlerDeps` does not yet expose `prepareMediaPrompt` and the handler still always builds native file parts itself.

- [ ] **Step 3: Implement shared-media prompt preparation in the video handler**

```typescript
// Modify src/bot/handlers/video.ts
import { prepareAttachmentMediaPrompt } from "../../media/ingest.js";

export interface VideoHandlerDeps extends ProcessPromptDeps {
  downloadFile?: (
    api: Context["api"],
    fileId: string,
  ) => Promise<{ buffer: Buffer; filePath: string }>;
  prepareMediaPrompt?: typeof prepareAttachmentMediaPrompt;
  processPrompt?: typeof processUserPrompt;
}

export async function handleVideoMessage(ctx: Context, deps: VideoHandlerDeps): Promise<void> {
  const downloadFile = deps.downloadFile ?? downloadTelegramFile;
  const prepareMediaPrompt = deps.prepareMediaPrompt ?? prepareAttachmentMediaPrompt;
  const processPrompt = deps.processPrompt ?? processUserPrompt;

  const videoInfo = getVideoMessageInfo(ctx);
  if (!videoInfo) {
    return;
  }

  if (videoInfo.durationSec > TELEGRAM_VIDEO_MAX_DURATION_SEC) {
    await ctx.reply(t("bot.video_too_long", { maxDurationSec: String(TELEGRAM_VIDEO_MAX_DURATION_SEC) }));
    return;
  }

  const caption = ctx.message?.caption || "";

  try {
    await ctx.reply(t("bot.video_downloading"));
    const downloadedFile = await downloadFile(ctx.api, videoInfo.fileId);

    try {
      const mimeType = videoInfo.mimeType.startsWith("video/") ? videoInfo.mimeType : "video/mp4";
      const prepared = await prepareMediaPrompt({
        ctx,
        telegramFileId: videoInfo.fileId,
        mediaType: "video",
        mimeType,
        originalFileName: normalizeVideoFilename(videoInfo.filename, downloadedFile.filePath),
        fallbackFileName: normalizeVideoFilename(videoInfo.filename, downloadedFile.filePath),
        caption,
        buffer: downloadedFile.buffer,
        onFallbackStart: async () => {
          await ctx.reply(t("bot.video_processing"));
        },
      });

      if (prepared.mode === "attachment") {
        await processPrompt(ctx, prepared.promptText, deps, prepared.fileParts);
        return;
      }

      await processPrompt(ctx, prepared.promptText, deps);
    } catch (error) {
      logger.error("[Video] Error processing video message:", error);
      await ctx.reply(t("bot.video_process_error"));
    }
  } catch (error) {
    logger.error("[Video] Error handling video download:", error);
    await ctx.reply(t("bot.video_download_error"));
  }
}
```

- [ ] **Step 4: Run the video-handler test again to verify it passes**

Run: `npm test -- tests/bot/handlers/video.test.ts`
Expected: PASS with the existing duration/download tests still green plus the new fallback test passing.

- [ ] **Step 5: Commit the video flow migration**

```bash
git add src/bot/handlers/video.ts tests/bot/handlers/video.test.ts
git commit -m "feat: add video media fallback flow"
```

---

### Task 8: Route Voice And Audio Messages Through Shared STT-Or-Transcriber Preparation

**Files:**
- Modify: `src/bot/handlers/voice.ts`
- Modify: `tests/bot/handlers/voice.test.ts`
- Modify: `src/i18n/en.ts`

- [ ] **Step 1: Update the voice-handler tests first**

```typescript
// Update createVoiceDeps in tests/bot/handlers/voice.test.ts
function createVoiceDeps(overrides: Partial<VoiceMessageDeps> = {}): {
  deps: VoiceMessageDeps;
  processPromptMock: ReturnType<typeof vi.fn>;
  downloadMock: ReturnType<typeof vi.fn>;
  prepareAudioPromptMock: ReturnType<typeof vi.fn>;
} {
  const processPromptMock = vi.fn().mockResolvedValue(true);
  const downloadMock = vi.fn().mockResolvedValue({
    buffer: Buffer.from("audio"),
    filename: "file_1.oga",
  });
  const prepareAudioPromptMock = vi.fn().mockResolvedValue({
    mode: "text",
    promptText:
      "User attached a local media file.\n\nSaved file path: /state/media/123/2026/04/24/file_1.ogg\nMedia analysis/transcript:\nrun tests",
    recognizedText: "run tests",
    storedFile: {
      hostAbsolutePath: "/tmp/file_1.ogg",
      runtimeVisiblePath: "/state/media/123/2026/04/24/file_1.ogg",
      fileName: "file_1.ogg",
      mimeType: "audio/ogg",
      sizeBytes: 5,
      mediaType: "audio",
    },
  });

  const deps: VoiceMessageDeps = {
    bot: {} as VoiceMessageDeps["bot"],
    ensureEventSubscription: vi.fn().mockResolvedValue(undefined),
    isSttConfigured: vi.fn(() => true),
    downloadTelegramFile: downloadMock,
    transcribeAudio: vi.fn(),
    prepareAudioPrompt: prepareAudioPromptMock,
    processPrompt: processPromptMock,
    ...overrides,
  };

  return { deps, processPromptMock, downloadMock, prepareAudioPromptMock };
}

// Replace the not-configured test with fallback behavior
it("continues through shared audio preparation when STT is not configured", async () => {
  const { ctx, replyMock } = createVoiceContext();
  const { deps, processPromptMock, downloadMock } = createVoiceDeps({
    isSttConfigured: () => false,
  });

  await handleVoiceMessage(ctx, deps);

  expect(replyMock).toHaveBeenCalledWith(t("stt.recognizing"));
  expect(downloadMock).toHaveBeenCalled();
  expect(processPromptMock).toHaveBeenCalledWith(
    ctx,
    expect.stringContaining("Saved file path:"),
    deps,
  );
});

// Keep the empty-result behavior but source it from the shared audio-preparation result
it("shows empty-result message and skips prompt processing when the prepared transcript is blank", async () => {
  const { ctx, editMessageTextMock } = createVoiceContext();
  const { deps, processPromptMock } = createVoiceDeps({
    prepareAudioPrompt: vi.fn().mockResolvedValue({
      mode: "text",
      promptText: "",
      recognizedText: "   ",
      storedFile: {
        hostAbsolutePath: "/tmp/file_1.ogg",
        runtimeVisiblePath: "/state/media/123/2026/04/24/file_1.ogg",
        fileName: "file_1.ogg",
        mimeType: "audio/ogg",
        sizeBytes: 5,
        mediaType: "audio",
      },
    }),
  });

  await handleVoiceMessage(ctx, deps);

  expect(editMessageTextMock).toHaveBeenCalledWith(777, 101, t("stt.empty_result"));
  expect(processPromptMock).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the voice-handler test to verify the new expectations fail**

Run: `npm test -- tests/bot/handlers/voice.test.ts`
Expected: FAIL because `VoiceMessageDeps` does not yet expose `prepareAudioPrompt` and the handler still returns `stt.not_configured` early.

- [ ] **Step 3: Implement shared audio prompt preparation in the voice handler**

```typescript
// Modify src/bot/handlers/voice.ts
import { prepareAudioPrompt } from "../../media/ingest.js";

export interface VoiceMessageDeps extends ProcessPromptDeps {
  isSttConfigured?: () => boolean;
  downloadTelegramFile?: (
    ctx: Context,
    fileId: string,
  ) => Promise<{ buffer: Buffer; filename: string } | null>;
  transcribeAudio?: (audioBuffer: Buffer, filename: string) => Promise<SttResult>;
  prepareAudioPrompt?: typeof prepareAudioPrompt;
  processPrompt?: (
    ctx: Context,
    text: string,
    deps: ProcessPromptDeps,
    fileParts?: FilePartInput[],
    options?: { responseMode?: "text_only" | "text_and_tts" },
  ) => Promise<boolean>;
}

export async function handleVoiceMessage(ctx: Context, deps: VoiceMessageDeps): Promise<void> {
  const sttConfigured = deps.isSttConfigured ?? isSttConfigured;
  const downloadFile = deps.downloadTelegramFile ?? downloadTelegramFile;
  const transcribe = deps.transcribeAudio ?? transcribeAudio;
  const preparePrompt = deps.prepareAudioPrompt ?? prepareAudioPrompt;
  const processPrompt = deps.processPrompt ?? processUserPrompt;

  const voice = ctx.message?.voice;
  const audio = ctx.message?.audio;
  const fileId = voice?.file_id ?? audio?.file_id;

  if (!fileId) {
    logger.warn("[Voice] Received voice/audio message with no file_id");
    return;
  }

  const statusMessage = await ctx.reply(t("stt.recognizing"));

  try {
    const fileData = await downloadFile(ctx, fileId);
    if (!fileData) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMessage.message_id,
        t("stt.error", { error: "download failed" }),
      );
      return;
    }

    const prepared = await preparePrompt({
      ctx,
      telegramFileId: fileId,
      mimeType: audio?.mime_type || "audio/ogg",
      originalFileName: fileData.filename,
      fallbackFileName: fileData.filename,
      buffer: fileData.buffer,
      isSttConfigured: sttConfigured,
      transcribeAudio: transcribe,
      onFallbackStart: async () => {
        await ctx.api.editMessageText(
          ctx.chat!.id,
          statusMessage.message_id,
          t("bot.audio_processing"),
        );
      },
    });

    const recognizedText = prepared.recognizedText?.trim() || "";
    if (!recognizedText) {
      await ctx.api.editMessageText(ctx.chat!.id, statusMessage.message_id, t("stt.empty_result"));
      return;
    }

    try {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMessage.message_id,
        t("stt.recognized", { text: recognizedText }),
      );
    } catch (editError) {
      logger.warn("[Voice] Failed to edit status message with recognized text:", editError);
    }

    await processPrompt(ctx, prepared.promptText, deps);
  } catch (error) {
    logger.error("[Voice] Error processing voice message:", error);

    try {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMessage.message_id,
        t("bot.audio_process_error"),
      );
    } catch {
      await ctx.reply(t("bot.audio_process_error")).catch(() => {});
    }
  }
}
```

- [ ] **Step 4: Run the voice-handler test again to verify it passes**

Run: `npm test -- tests/bot/handlers/voice.test.ts`
Expected: PASS with the updated fallback expectations and the existing edit-failure test green.

- [ ] **Step 5: Commit the voice/audio migration**

```bash
git add src/bot/handlers/voice.ts tests/bot/handlers/voice.test.ts
git commit -m "feat: add audio prompt fallback flow"
```

---

### Task 9: Add the Remaining User-Facing Strings And Update Project Docs

**Files:**
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/de.ts`
- Modify: `src/i18n/es.ts`
- Modify: `src/i18n/fr.ts`
- Modify: `src/i18n/ru.ts`
- Modify: `src/i18n/zh.ts`
- Modify: `PRODUCT.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Run the combined code-level verification before doc updates**

Run these commands now to confirm the code-level implementation is green before updating product docs:

- `npm test -- tests/bot/handlers/photo.test.ts tests/bot/handlers/document.test.ts tests/bot/handlers/video.test.ts tests/bot/handlers/voice.test.ts tests/media/storage.test.ts tests/media/transcriber.test.ts tests/media/ingest.test.ts`
- `npm run lint`
- `npm run build`

Expected: PASS for the targeted tests and code checks. If any code check fails here, fix the code before updating `PRODUCT.md` and `CHANGELOG.md`.

- [ ] **Step 2: Add the remaining localized per-media strings**

```typescript
// Modify src/i18n/de.ts
"bot.photo_processing": "⏳ Foto wird analysiert...",
"bot.photo_process_error": "🔴 Foto konnte nicht verarbeitet werden",
"bot.file_processing": "⏳ Dokumenttext wird extrahiert...",
"bot.file_process_error": "🔴 Dokument konnte nicht verarbeitet werden",
"bot.video_processing": "⏳ Video wird analysiert...",
"bot.video_process_error": "🔴 Video konnte nicht verarbeitet werden",
"bot.audio_processing": "⏳ Audio wird transkribiert...",
"bot.audio_process_error": "🔴 Audio konnte nicht verarbeitet werden",

// Modify src/i18n/es.ts
"bot.photo_processing": "⏳ Analizando foto...",
"bot.photo_process_error": "🔴 No se pudo procesar la foto",
"bot.file_processing": "⏳ Extrayendo texto del documento...",
"bot.file_process_error": "🔴 No se pudo procesar el documento",
"bot.video_processing": "⏳ Analizando video...",
"bot.video_process_error": "🔴 No se pudo procesar el video",
"bot.audio_processing": "⏳ Transcribiendo audio...",
"bot.audio_process_error": "🔴 No se pudo procesar el audio",

// Modify src/i18n/fr.ts
"bot.photo_processing": "⏳ Analyse de la photo...",
"bot.photo_process_error": "🔴 Impossible de traiter la photo",
"bot.file_processing": "⏳ Extraction du texte du document...",
"bot.file_process_error": "🔴 Impossible de traiter le document",
"bot.video_processing": "⏳ Analyse de la vidéo...",
"bot.video_process_error": "🔴 Impossible de traiter la vidéo",
"bot.audio_processing": "⏳ Transcription audio en cours...",
"bot.audio_process_error": "🔴 Impossible de traiter l'audio",

// Modify src/i18n/ru.ts
"bot.photo_processing": "⏳ Анализирую фото...",
"bot.photo_process_error": "🔴 Не удалось обработать фото",
"bot.file_processing": "⏳ Извлекаю текст из документа...",
"bot.file_process_error": "🔴 Не удалось обработать документ",
"bot.video_processing": "⏳ Анализирую видео...",
"bot.video_process_error": "🔴 Не удалось обработать видео",
"bot.audio_processing": "⏳ Расшифровываю аудио...",
"bot.audio_process_error": "🔴 Не удалось обработать аудио",

// Modify src/i18n/zh.ts
"bot.photo_processing": "⏳ 正在分析照片...",
"bot.photo_process_error": "🔴 处理照片失败",
"bot.file_processing": "⏳ 正在提取文档文本...",
"bot.file_process_error": "🔴 处理文档失败",
"bot.video_processing": "⏳ 正在分析视频...",
"bot.video_process_error": "🔴 处理视频失败",
"bot.audio_processing": "⏳ 正在转录音频...",
"bot.audio_process_error": "🔴 处理音频失败",
```

- [ ] **Step 3: Update `PRODUCT.md` to reflect the new media behavior**

```markdown
// Modify PRODUCT.md
- [x] Image attachments support (send photos/screenshots from Telegram to OpenCode, persist the original file, and fall back to local text extraction when the selected model lacks image input)
- [x] PDF attachments support (send documents from Telegram to OpenCode, persist the original file, and fall back to local text extraction when the selected model lacks PDF input)
- [x] Text file attachments support (send code/config/log files from Telegram to OpenCode and include the saved local file path in the generated prompt)
- [x] Short Telegram video and video-note attachments support with persistent saved copies and automatic local analysis fallback when the selected model lacks video input
- [x] Voice/audio transcription via Whisper-compatible APIs (OpenAI/Groq/Together and compatible providers), with automatic local media fallback when STT is unavailable or fails
```

- [ ] **Step 4: Update `CHANGELOG.md` with the new runtime-aware media flow**

```markdown
// Add under CHANGELOG.md -> ## [Unreleased] -> ### Changed
- Persisted all incoming Telegram media under runtime-aware per-user storage and switched unsupported photo/PDF/video inputs plus unavailable audio STT flows to the local `openai-media-transcriber` scripts, forwarding extracted text together with the runtime-visible saved file path into OpenCode.
  - Why: Telegram attachments should survive beyond the immediate request, tenant containers need paths that are valid both on the host bind mount and inside `/state`, and coding-oriented text models should still be able to work from media context without manual model switching or a hard STT dependency.
  - Affects: `src/media/*`, `src/bot/handlers/photo.ts`, `src/bot/handlers/document.ts`, `src/bot/handlers/video.ts`, `src/bot/handlers/voice.ts`, `src/bot/index.ts`, `src/i18n/*.ts`, `tests/media/*.test.ts`, `tests/bot/handlers/*.test.ts`, `PRODUCT.md`, `package.json`
```

- [ ] **Step 5: Run the full verification suite and make sure everything is green**

Run: `npm test`
Expected: PASS with zero failing test files.

Run: `npm run lint`
Expected: PASS with exit code 0 and no warnings.

Run: `npm run build`
Expected: PASS with exit code 0 and a clean TypeScript build.

- [ ] **Step 6: Commit the docs, strings, and final integrated feature**

```bash
git add src/i18n/en.ts src/i18n/de.ts src/i18n/es.ts src/i18n/fr.ts src/i18n/ru.ts src/i18n/zh.ts PRODUCT.md CHANGELOG.md
git commit -m "feat: persist incoming media and add transcriber fallback"
```

---

## Post-Verification Review

After `npm test`, `npm run lint`, and `npm run build` all pass, run the repository-required security and architecture reviews in parallel.

### Security Review Prompt

```text
Review these changes for security issues only.

Context:
- Added runtime-aware persistent storage for incoming Telegram media.
- Added local `openai-media-transcriber` fallback for photo, PDF, video, video_note, and audio flows when the selected model or STT path cannot handle the input.
- Touched files: src/media/types.ts, src/media/storage.ts, src/media/transcriber.ts, src/media/ingest.ts, src/bot/handlers/photo.ts, src/bot/handlers/document.ts, src/bot/handlers/video.ts, src/bot/handlers/voice.ts, src/bot/index.ts, src/i18n/*.ts, PRODUCT.md, CHANGELOG.md, package.json, tests/media/*.test.ts, tests/bot/handlers/*.test.ts.
- Verification already passed: npm test, npm run lint, npm run build.

Focus on authn/authz, secrets handling, input validation, injection, SSRF, path traversal, unsafe deserialization, race conditions, logging leaks, privilege escalation, and remote-control abuse paths.
Pay extra attention to trust boundaries where the Telegram bot can trigger actions in local runtimes or external tools.

For each finding, report: severity, file:line, why it matters, exploitability, and the smallest safe fix.
If there are no findings, say so and mention any residual risk.
Do not suggest unrelated refactors.
```

### Architecture Review Prompt

```text
Review these changes for architecture and complexity quality.

Context:
- Added runtime-aware persistent storage for incoming Telegram media.
- Added local `openai-media-transcriber` fallback for photo, PDF, video, video_note, and audio flows when the selected model or STT path cannot handle the input.
- Touched files: src/media/types.ts, src/media/storage.ts, src/media/transcriber.ts, src/media/ingest.ts, src/bot/handlers/photo.ts, src/bot/handlers/document.ts, src/bot/handlers/video.ts, src/bot/handlers/voice.ts, src/bot/index.ts, src/i18n/*.ts, PRODUCT.md, CHANGELOG.md, package.json, tests/media/*.test.ts, tests/bot/handlers/*.test.ts.
- Verification already passed: npm test, npm run lint, npm run build.

Focus on coupling, cohesion, module boundaries, DDD bounded contexts, ubiquitous language, dependency direction, Clean Architecture layering, testability, observability, debuggability, scalability, and how hard it would be to replace one module with another.
Call out trade-offs, hotspots, hidden dependencies, and places where primitives leak across domain boundaries.
For each finding, report: severity, file:line, why it matters, and the smallest refactor that would improve the design.
Keep the focus on maintainability, not style.
```

If either review reports findings, fix them in a new commit and rerun `npm test`, `npm run lint`, and `npm run build` before considering the work complete.
