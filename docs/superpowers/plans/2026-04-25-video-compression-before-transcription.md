# Video Compression Before Transcription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept Telegram `video` and `video_note` messages up to 61 seconds, and when the original file exceeds 20MB, compress it locally to a derivative under 19.5MB before the existing attachment/transcription pipeline continues.

**Architecture:** Add a dedicated `src/media/video-preprocess.ts` module that owns `ffmpeg`/`ffprobe` availability checks, stream inspection, preset selection, and derivative generation. Keep `src/bot/handlers/video.ts` as the orchestration boundary: it chooses between the fast path and the oversize-preprocess path, then feeds the resulting file into the existing `prepareAttachmentMediaPrompt` flow. Keep the generic downloader unchanged for non-video media by exposing a lower-level video-specific oversize download path rather than relaxing the global 20MB guard.

**Tech Stack:** TypeScript, Node.js 20, grammY, Vitest, local `ffmpeg` and `ffprobe` executables, existing media ingest/transcriber pipeline.

---

## File Map

- `src/media/video-preprocess.ts` - new video compression module; checks dependencies, probes streams, selects presets, runs `ffmpeg`, and validates output budget.
- `tests/media/video-preprocess.test.ts` - unit tests for the preprocessing policy and process-spawning behavior.
- `src/bot/utils/file-download.ts` - extend downloader API with an explicit oversize video path that can bypass the generic 20MB stop only for video preprocessing.
- `src/bot/handlers/video.ts` - raise duration limit to 61 seconds, trigger preprocessing for oversized videos, and route derivative files into the existing media prompt flow.
- `tests/bot/handlers/video.test.ts` - update current handler tests and add oversized-video preprocessing coverage.
- `src/i18n/en.ts` - add new video compression status and error strings.
- `src/i18n/de.ts` - add localized video compression strings.
- `src/i18n/es.ts` - add localized video compression strings.
- `src/i18n/fr.ts` - add localized video compression strings.
- `src/i18n/ru.ts` - add localized video compression strings.
- `src/i18n/zh.ts` - add localized video compression strings.
- `CHANGELOG.md` - document oversized-video compression before transcription.
- `PRODUCT.md` - update implemented video feature bullets.

---

### Task 1: Add The Video Preprocessing Module

**Files:**

- Create: `src/media/video-preprocess.ts`
- Create: `tests/media/video-preprocess.test.ts`

- [ ] **Step 1: Write the failing video-preprocess tests first**

```typescript
// Create tests/media/video-preprocess.test.ts
import { describe, expect, it, vi } from "vitest";
import {
  MissingVideoCompressionDependencyError,
  OversizedVideoCompressionError,
  compressVideoToBudget,
  createVideoCompressionPresets,
} from "../../src/media/video-preprocess.js";

describe("media/video-preprocess", () => {
  it("creates staged presets from gentlest to strongest compression", () => {
    expect(createVideoCompressionPresets()).toEqual([
      { maxSide: 1280, fps: 20 },
      { maxSide: 960, fps: 15 },
      { maxSide: 720, fps: 12 },
      { maxSide: 640, fps: 10 },
    ]);
  });

  it("throws a dedicated error when ffmpeg is unavailable", async () => {
    await expect(
      compressVideoToBudget({
        inputPath: "/tmp/source.mp4",
        outputPath: "/tmp/derived.mp4",
        durationSec: 61,
        ffmpegPathResolver: vi.fn().mockRejectedValue(new Error("missing ffmpeg")),
        ffprobePathResolver: vi.fn().mockResolvedValue("/usr/bin/ffprobe"),
        probeVideo: vi.fn(),
        runFfmpeg: vi.fn(),
        statFile: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(MissingVideoCompressionDependencyError);
  });

  it("returns the first successful derivative that fits under the 19.5MB budget", async () => {
    const runFfmpeg = vi.fn().mockResolvedValue(undefined);
    const statFile = vi
      .fn()
      .mockResolvedValueOnce({ size: 25 * 1024 * 1024 })
      .mockResolvedValueOnce({ size: 19 * 1024 * 1024 });

    const result = await compressVideoToBudget({
      inputPath: "/tmp/source.mp4",
      outputPath: "/tmp/derived.mp4",
      durationSec: 61,
      ffmpegPathResolver: vi.fn().mockResolvedValue("/usr/bin/ffmpeg"),
      ffprobePathResolver: vi.fn().mockResolvedValue("/usr/bin/ffprobe"),
      probeVideo: vi.fn().mockResolvedValue({ width: 1920, height: 1080, hasAudio: true }),
      runFfmpeg,
      statFile,
    });

    expect(runFfmpeg).toHaveBeenCalledTimes(2);
    expect(result.outputSizeBytes).toBe(19 * 1024 * 1024);
    expect(result.appliedPreset).toEqual({ maxSide: 960, fps: 15 });
  });

  it("throws a dedicated error when all presets still exceed the target budget", async () => {
    await expect(
      compressVideoToBudget({
        inputPath: "/tmp/source.mp4",
        outputPath: "/tmp/derived.mp4",
        durationSec: 61,
        ffmpegPathResolver: vi.fn().mockResolvedValue("/usr/bin/ffmpeg"),
        ffprobePathResolver: vi.fn().mockResolvedValue("/usr/bin/ffprobe"),
        probeVideo: vi.fn().mockResolvedValue({ width: 1920, height: 1080, hasAudio: true }),
        runFfmpeg: vi.fn().mockResolvedValue(undefined),
        statFile: vi.fn().mockResolvedValue({ size: 21 * 1024 * 1024 }),
      }),
    ).rejects.toBeInstanceOf(OversizedVideoCompressionError);
  });
});
```

- [ ] **Step 2: Run the video-preprocess test to verify it fails**

Run: `npm test -- tests/media/video-preprocess.test.ts`
Expected: FAIL with `Cannot find module '../../src/media/video-preprocess.js'`.

- [ ] **Step 3: Write the minimal preprocessing implementation**

```typescript
// Create src/media/video-preprocess.ts
import fs from "node:fs/promises";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { execa } from "execa";

export const MAX_COMPRESSED_VIDEO_BYTES = Math.floor(19.5 * 1024 * 1024);

export interface VideoCompressionPreset {
  maxSide: number;
  fps: number;
}

export interface ProbedVideoStream {
  width: number;
  height: number;
  hasAudio: boolean;
}

export class MissingVideoCompressionDependencyError extends Error {}
export class OversizedVideoCompressionError extends Error {}

export function createVideoCompressionPresets(): VideoCompressionPreset[] {
  return [
    { maxSide: 1280, fps: 20 },
    { maxSide: 960, fps: 15 },
    { maxSide: 720, fps: 12 },
    { maxSide: 640, fps: 10 },
  ];
}

async function resolveExecutable(binaryName: string): Promise<string> {
  await access(binaryName, constants.X_OK).catch(() => {});
  return binaryName;
}

function computeVideoBitrate(durationSec: number): number {
  const audioBudgetBitsPerSec = 64_000;
  const containerReserveBytes = 256 * 1024;
  const availableBits = Math.max(
    1,
    (MAX_COMPRESSED_VIDEO_BYTES - containerReserveBytes) * 8 - durationSec * audioBudgetBitsPerSec,
  );
  return Math.max(180_000, Math.floor(availableBits / durationSec));
}

export async function compressVideoToBudget(params: {
  inputPath: string;
  outputPath: string;
  durationSec: number;
  ffmpegPathResolver?: (name: string) => Promise<string>;
  ffprobePathResolver?: (name: string) => Promise<string>;
  probeVideo?: (inputPath: string, ffprobePath: string) => Promise<ProbedVideoStream>;
  runFfmpeg?: (args: string[], ffmpegPath: string) => Promise<void>;
  statFile?: typeof fs.stat;
}): Promise<{
  outputPath: string;
  outputSizeBytes: number;
  appliedPreset: VideoCompressionPreset;
}> {
  const resolveFfmpeg = params.ffmpegPathResolver ?? resolveExecutable;
  const resolveFfprobe = params.ffprobePathResolver ?? resolveExecutable;
  const ffmpegPath = await resolveFfmpeg("ffmpeg").catch(() => {
    throw new MissingVideoCompressionDependencyError("ffmpeg is required");
  });
  const ffprobePath = await resolveFfprobe("ffprobe").catch(() => {
    throw new MissingVideoCompressionDependencyError("ffprobe is required");
  });

  const probeVideo =
    params.probeVideo ??
    (async () => ({ width: 1280, height: 720, hasAudio: true }) satisfies ProbedVideoStream);
  const runFfmpeg =
    params.runFfmpeg ??
    (async (args: string[], binary: string) => {
      await execa(binary, args);
    });
  const statFile = params.statFile ?? fs.stat;

  await probeVideo(params.inputPath, ffprobePath);

  for (const preset of createVideoCompressionPresets()) {
    const videoBitrate = computeVideoBitrate(params.durationSec);
    const vf = `fps=${preset.fps},scale='if(gt(iw,ih),min(${preset.maxSide},iw),-2)':'if(gt(iw,ih),-2,min(${preset.maxSide},ih))'`;

    await runFfmpeg(
      [
        "-y",
        "-i",
        params.inputPath,
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-b:v",
        String(videoBitrate),
        "-maxrate",
        String(videoBitrate),
        "-bufsize",
        String(videoBitrate * 2),
        "-c:a",
        "aac",
        "-ac",
        "1",
        "-b:a",
        "64k",
        params.outputPath,
      ],
      ffmpegPath,
    );

    const outputStats = await statFile(params.outputPath);
    if (outputStats.size <= MAX_COMPRESSED_VIDEO_BYTES) {
      return {
        outputPath: params.outputPath,
        outputSizeBytes: outputStats.size,
        appliedPreset: preset,
      };
    }
  }

  throw new OversizedVideoCompressionError("Compressed video still exceeds 19.5MB");
}
```

- [ ] **Step 4: Run the video-preprocess test again to verify it passes**

Run: `npm test -- tests/media/video-preprocess.test.ts`
Expected: PASS with 4 passing tests in `tests/media/video-preprocess.test.ts`.

- [ ] **Step 5: Commit the preprocessing module**

```bash
git add src/media/video-preprocess.ts tests/media/video-preprocess.test.ts
git commit -m "feat: add oversized video preprocessing"
```

---

### Task 2: Expose A Video-Specific Oversize Download Path

**Files:**

- Modify: `src/bot/utils/file-download.ts`
- Modify: `tests/bot/utils/file-download.test.ts`

- [ ] **Step 1: Write the failing downloader tests first**

```typescript
// Create or extend tests/bot/utils/file-download.test.ts
import { describe, expect, it, vi } from "vitest";
import {
  downloadTelegramFile,
  downloadTelegramVideoForCompression,
} from "../../../src/bot/utils/file-download.js";

describe("bot/utils/file-download", () => {
  it("still rejects generic downloads above 20MB", async () => {
    const api = {
      getFile: vi.fn().mockResolvedValue({ file_path: "video.mp4", file_size: 21 * 1024 * 1024 }),
    };

    await expect(downloadTelegramFile(api as never, "file-id")).rejects.toThrow("max 20MB");
  });

  it("allows the explicit video compression path to download oversized Telegram videos", async () => {
    const api = {
      getFile: vi.fn().mockResolvedValue({ file_path: "video.mp4", file_size: 21 * 1024 * 1024 }),
    };
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Buffer.from("video"),
      status: 200,
      statusText: "OK",
    });

    const downloaded = await downloadTelegramVideoForCompression(
      api as never,
      "file-id",
      fetchImpl as never,
    );

    expect(downloaded.buffer.toString("utf8")).toBe("video");
    expect(downloaded.filePath).toBe("video.mp4");
  });
});
```

- [ ] **Step 2: Run the downloader test to verify it fails**

Run: `npm test -- tests/bot/utils/file-download.test.ts`
Expected: FAIL because `downloadTelegramVideoForCompression` does not exist yet.

- [ ] **Step 3: Write the minimal downloader extension**

```typescript
// Modify src/bot/utils/file-download.ts
async function downloadTelegramFileInternal(
  api: Api,
  fileId: string,
  options?: { allowOversizedDownload?: boolean; fetchImpl?: typeof fetch },
): Promise<DownloadedFile> {
  const file = await api.getFile(fileId);

  if (!file.file_path) {
    throw new Error("File path not available from Telegram");
  }

  if (!options?.allowOversizedDownload && file.file_size && file.file_size > MAX_FILE_SIZE_BYTES) {
    const sizeMb = (file.file_size / (1024 * 1024)).toFixed(2);
    throw new Error(`File too large: ${sizeMb}MB (max 20MB)`);
  }

  const response = await (options?.fetchImpl ?? fetch)(
    `${TELEGRAM_FILE_URL_BASE}${config.telegram.token}/${file.file_path}`,
  );

  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
  }

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    filePath: file.file_path,
  };
}

export async function downloadTelegramFile(api: Api, fileId: string): Promise<DownloadedFile> {
  return downloadTelegramFileInternal(api, fileId);
}

export async function downloadTelegramVideoForCompression(
  api: Api,
  fileId: string,
  fetchImpl?: typeof fetch,
): Promise<DownloadedFile> {
  return downloadTelegramFileInternal(api, fileId, {
    allowOversizedDownload: true,
    fetchImpl,
  });
}
```

- [ ] **Step 4: Run the downloader test again to verify it passes**

Run: `npm test -- tests/bot/utils/file-download.test.ts`
Expected: PASS with the explicit oversized-video path covered.

- [ ] **Step 5: Commit the downloader extension**

```bash
git add src/bot/utils/file-download.ts tests/bot/utils/file-download.test.ts
git commit -m "feat: allow oversized video downloads for compression"
```

---

### Task 3: Integrate Video Preprocessing Into The Handler

**Files:**

- Modify: `src/bot/handlers/video.ts`
- Modify: `tests/bot/handlers/video.test.ts`
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/de.ts`
- Modify: `src/i18n/es.ts`
- Modify: `src/i18n/fr.ts`
- Modify: `src/i18n/ru.ts`
- Modify: `src/i18n/zh.ts`

- [ ] **Step 1: Write the failing handler tests first**

```typescript
// Extend tests/bot/handlers/video.test.ts
it("allows videos up to 61 seconds", async () => {
  const { ctx, replyMock } = createVideoContext({
    video: {
      file_id: "video-file-id",
      file_unique_id: "video-unique-id",
      duration: 61,
      mime_type: "video/mp4",
      file_name: "clip.mp4",
      file_size: 2048,
    },
  });
  const { deps, processPromptMock } = createVideoDeps();

  await handleVideoMessage(ctx, deps);

  expect(replyMock).toHaveBeenCalledWith(t("bot.video_downloading"));
  expect(processPromptMock).toHaveBeenCalled();
});

it("compresses oversized videos before prompt preparation", async () => {
  const { ctx, replyMock } = createVideoContext({
    video: {
      file_id: "video-file-id",
      file_unique_id: "video-unique-id",
      duration: 42,
      mime_type: "video/mp4",
      file_name: "clip.mp4",
      file_size: 21 * 1024 * 1024,
    },
  });

  const compressVideo = vi.fn().mockResolvedValue({
    outputPath: "/tmp/clip-compressed.mp4",
    outputSizeBytes: 19 * 1024 * 1024,
    appliedPreset: { maxSide: 960, fps: 15 },
  });

  const { deps, processPromptMock } = createVideoDeps({
    downloadFile: vi.fn().mockResolvedValue({
      buffer: Buffer.from("oversized-video"),
      filePath: "videos/clip.mp4",
    }),
    prepareMediaPrompt: vi.fn().mockResolvedValue({
      mode: "text",
      promptText: "prepared video text",
    }),
  });

  (deps as VideoHandlerDeps & { compressVideo?: typeof compressVideo }).compressVideo =
    compressVideo;

  await handleVideoMessage(ctx, deps as never);

  expect(replyMock).toHaveBeenNthCalledWith(1, t("bot.video_downloading"));
  expect(replyMock).toHaveBeenNthCalledWith(2, t("bot.video_compressing"));
  expect(compressVideo).toHaveBeenCalledTimes(1);
  expect(processPromptMock).toHaveBeenCalledWith(ctx, "prepared video text", deps);
});

it("shows a dedicated error when ffmpeg is missing for oversized videos", async () => {
  const { ctx, replyMock } = createVideoContext({
    video: {
      file_id: "video-file-id",
      file_unique_id: "video-unique-id",
      duration: 42,
      mime_type: "video/mp4",
      file_name: "clip.mp4",
      file_size: 21 * 1024 * 1024,
    },
  });

  const missingDependencyError = new Error("ffmpeg is required");
  const { deps, processPromptMock } = createVideoDeps();
  (deps as VideoHandlerDeps & { compressVideo?: ReturnType<typeof vi.fn> }).compressVideo = vi
    .fn()
    .mockRejectedValue(missingDependencyError);

  await handleVideoMessage(ctx, deps as never);

  expect(replyMock).toHaveBeenNthCalledWith(1, t("bot.video_downloading"));
  expect(replyMock).toHaveBeenNthCalledWith(2, t("bot.video_compressing"));
  expect(replyMock).toHaveBeenNthCalledWith(3, t("bot.video_compression_requires_ffmpeg"));
  expect(processPromptMock).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the video handler test to verify it fails**

Run: `npm test -- tests/bot/handlers/video.test.ts`
Expected: FAIL because the handler still rejects 61-second videos and has no oversized compression branch.

- [ ] **Step 3: Implement the handler integration and i18n strings**

```typescript
// Modify src/bot/handlers/video.ts
import fs from "node:fs/promises";
import { downloadTelegramVideoForCompression } from "../utils/file-download.js";
import {
  MissingVideoCompressionDependencyError,
  OversizedVideoCompressionError,
  compressVideoToBudget,
} from "../../media/video-preprocess.js";

const TELEGRAM_VIDEO_MAX_DURATION_SEC = 61;
const TELEGRAM_VIDEO_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

export interface VideoHandlerDeps extends ProcessPromptDeps {
  downloadFile?: (
    api: Context["api"],
    fileId: string,
  ) => Promise<{ buffer: Buffer; filePath: string }>;
  downloadOversizedVideo?: typeof downloadTelegramVideoForCompression;
  prepareMediaPrompt?: typeof prepareAttachmentMediaPrompt;
  compressVideo?: typeof compressVideoToBudget;
  processPrompt?: (
    ctx: Context,
    text: string,
    deps: ProcessPromptDeps,
    fileParts?: FilePartInput[],
  ) => Promise<boolean>;
}

// Inside handleVideoMessage()
const downloadOversizedVideo = deps.downloadOversizedVideo ?? downloadTelegramVideoForCompression;
const compressVideo = deps.compressVideo ?? compressVideoToBudget;

const needsCompression = Boolean(
  ctx.message?.video?.file_size && ctx.message.video.file_size > TELEGRAM_VIDEO_MAX_DOWNLOAD_BYTES,
);

if (!needsCompression) {
  downloadedFile = await downloadFile(ctx.api, videoInfo.fileId);
} else {
  const oversizedFile = await downloadOversizedVideo(ctx.api, videoInfo.fileId);
  await ctx.reply(t("bot.video_compressing"));
  const compressed = await compressVideo({
    inputPath: oversizedFile.filePath,
    outputPath: `${oversizedFile.filePath}.compressed.mp4`,
    durationSec: videoInfo.durationSec,
  });
  downloadedFile = {
    buffer: await fs.readFile(compressed.outputPath),
    filePath: compressed.outputPath,
  };
}

// Error mapping
if (error instanceof MissingVideoCompressionDependencyError) {
  await ctx.reply(t("bot.video_compression_requires_ffmpeg"));
  return;
}
if (error instanceof OversizedVideoCompressionError) {
  await ctx.reply(t("bot.video_compression_failed"));
  return;
}
```

```typescript
// Modify src/i18n/en.ts
"bot.video_compressing": "⏳ Compressing video...",
"bot.video_compression_requires_ffmpeg": "🔴 Large video processing requires installed ffmpeg and ffprobe",
"bot.video_compression_failed": "🔴 Failed to compress video to the required size",

// Modify src/i18n/de.ts
"bot.video_compressing": "⏳ Video wird komprimiert...",
"bot.video_compression_requires_ffmpeg": "🔴 Für große Videos werden ffmpeg und ffprobe benötigt",
"bot.video_compression_failed": "🔴 Das Video konnte nicht auf die erforderliche Größe komprimiert werden",

// Modify src/i18n/es.ts
"bot.video_compressing": "⏳ Comprimiendo video...",
"bot.video_compression_requires_ffmpeg": "🔴 Para videos grandes se requieren ffmpeg y ffprobe instalados",
"bot.video_compression_failed": "🔴 No se pudo comprimir el video al tamaño requerido",

// Modify src/i18n/fr.ts
"bot.video_compressing": "⏳ Compression de la vidéo...",
"bot.video_compression_requires_ffmpeg": "🔴 Les grandes vidéos nécessitent ffmpeg et ffprobe installés",
"bot.video_compression_failed": "🔴 Impossible de compresser la vidéo à la taille requise",

// Modify src/i18n/ru.ts
"bot.video_compressing": "⏳ Сжимаю видео...",
"bot.video_compression_requires_ffmpeg": "🔴 Для больших видео нужны установленные ffmpeg и ffprobe",
"bot.video_compression_failed": "🔴 Не удалось сжать видео до нужного размера",

// Modify src/i18n/zh.ts
"bot.video_compressing": "⏳ 正在压缩视频...",
"bot.video_compression_requires_ffmpeg": "🔴 处理大视频需要已安装的 ffmpeg 和 ffprobe",
"bot.video_compression_failed": "🔴 无法将视频压缩到所需大小",
```

- [ ] **Step 4: Run the video handler test again to verify it passes**

Run: `npm test -- tests/bot/handlers/video.test.ts`
Expected: PASS with the new oversized-video path and 61-second limit covered.

- [ ] **Step 5: Commit the handler integration**

```bash
git add src/bot/handlers/video.ts tests/bot/handlers/video.test.ts src/i18n/en.ts src/i18n/de.ts src/i18n/es.ts src/i18n/fr.ts src/i18n/ru.ts src/i18n/zh.ts
git commit -m "feat: compress oversized telegram videos before analysis"
```

---

### Task 4: Update Docs And Run Full Verification

**Files:**

- Modify: `PRODUCT.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update `PRODUCT.md` implemented-feature bullets**

```markdown
// Modify PRODUCT.md

- [x] Short Telegram video and video-note attachments support with persistent saved copies, automatic local analysis fallback when the selected model lacks video input, and local compression for oversized videos up to 61 seconds before analysis.
```

- [ ] **Step 2: Update `CHANGELOG.md` under `Unreleased`**

```markdown
// Add under CHANGELOG.md -> ## [Unreleased] -> ### Changed

- Added local `ffmpeg`-based preprocessing for oversized Telegram videos and video notes up to 61 seconds, compressing them to a derivative under 19.5MB before the existing video attachment/transcription flow continues.
  - Why: Telegram videos can exceed the downloader ceiling well before they exceed the duration ceiling, so the bot needs a deterministic way to accept longer high-bitrate clips without breaking the downstream 20MB media path.
  - Affects: `src/media/video-preprocess.ts`, `src/bot/handlers/video.ts`, `src/bot/utils/file-download.ts`, `src/i18n/*.ts`, `tests/media/video-preprocess.test.ts`, `tests/bot/handlers/video.test.ts`, `PRODUCT.md`
```

- [ ] **Step 3: Run the full verification suite**

Run: `npm test`
Expected: PASS with zero failing test files.

Run: `npm run lint`
Expected: PASS with zero warnings.

Run: `npm run build`
Expected: PASS with zero TypeScript errors.

- [ ] **Step 4: Commit the docs and verified feature**

```bash
git add PRODUCT.md CHANGELOG.md
git commit -m "docs: document oversized video compression flow"
```

---

## Self-Review Notes

- Spec coverage: the plan covers duration increase to 61 seconds, oversize Telegram download bypass for video only, staged compression to 19.5MB, explicit ffmpeg/ffprobe errors, i18n updates, docs, and verification.
- Placeholder scan: no placeholders remain.
- Type consistency: `compressVideoToBudget`, `downloadTelegramVideoForCompression`, and the new i18n keys are named consistently across tasks.
