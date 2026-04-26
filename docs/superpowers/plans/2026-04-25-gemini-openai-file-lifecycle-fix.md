# Gemini OpenAI File Lifecycle Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Gemini CLI OpenAI-compatible API so uploaded `file_id` values remain usable until media processing finishes explicitly, instead of being consumed and invalidated on first read.

**Architecture:** Keep the existing OpenAI-compatible `/v1/files` and `/v1/chat/completions` API surface, but change the server-side file lifecycle from “consume on first read” to “lease while in use, delete only after explicit processing completion or deletion.” Update `OpenAiFileStore` to separate binary reads from finalization, and update `/v1/chat/completions` to finalize uploads only after the request finishes successfully or definitively fails. Preserve cleanup and retention behavior for abandoned uploads.

**Tech Stack:** TypeScript, Express server in `packages/cli/src/server`, existing `OpenAiFileStore`, Vitest server tests.

---

## File Map

- `packages/cli/src/server/openaiFileStore.ts` - file lifecycle primitives; change binary access semantics so reads do not eagerly delete the upload.
- `packages/cli/src/server/openaiFileStore.test.ts` - storage-level lifecycle tests for binary retention and explicit finalization.
- `packages/cli/src/server/index.ts` - OpenAI-compatible route behavior; delay deletion/finalization until generation is explicitly completed.
- `packages/cli/src/server/index.test.ts` - API tests for reused `file_id` after transient failure, overlapping requests, and final cleanup semantics.

---

### Task 1: Change File Store Semantics From Consume-On-Read To Explicit Finalization

**Files:**

- Modify: `packages/cli/src/server/openaiFileStore.ts`
- Modify: `packages/cli/src/server/openaiFileStore.test.ts`

- [ ] **Step 1: Write the failing file-store tests first**

```ts
// Add to packages/cli/src/server/openaiFileStore.test.ts
it("keeps the binary available after reading it for processing", async () => {
  const file = await store.createUpload({
    filename: "video.mp4",
    purpose: "user_data",
    mimeType: "video/mp4",
    bytes: Buffer.from("video-bytes"),
  });

  const consumed = await store.consumeUploadBinary(file.id);

  expect(consumed?.binary.toString("utf8")).toBe("video-bytes");
  expect(await store.hasBinary(file.id)).toBe(true);
});

it("deletes the binary only when finalizeProcessed is called explicitly", async () => {
  const file = await store.createUpload({
    filename: "video.mp4",
    purpose: "user_data",
    mimeType: "video/mp4",
    bytes: Buffer.from("video-bytes"),
  });

  await store.consumeUploadBinary(file.id);
  await store.finalizeProcessed(file.id, "hello world");

  const metadata = await store.getMetadata(file.id);
  expect(await store.hasBinary(file.id)).toBe(false);
  expect(metadata?.resultText).toBe("hello world");
  expect(metadata?.processedAt).toEqual(expect.any(Number));
});
```

- [ ] **Step 2: Run the file-store test to verify it fails**

Run: `npm test --workspace @google/gemini-cli -- packages/cli/src/server/openaiFileStore.test.ts`
Expected: FAIL because `consumeUploadBinary()` currently deletes the binary immediately and `finalizeProcessed()` does not exist yet.

- [ ] **Step 3: Implement the minimal file-store lifecycle change**

```ts
// Modify packages/cli/src/server/openaiFileStore.ts
export class OpenAiFileStore {
  // ...existing constructor and createUpload...

  async finalizeProcessed(id: string, resultText: string): Promise<void> {
    const metadata = await this.getMetadata(id);
    if (!metadata) {
      throw new Error("Unknown file id");
    }

    fs.rmSync(this.binaryPath(id), { force: true });

    this.writeMetadata({
      ...metadata,
      processedAt: Date.now(),
      resultText,
    });
  }

  async markProcessed(id: string, resultText: string): Promise<void> {
    await this.finalizeProcessed(id, resultText);
  }

  async consumeUploadBinary(id: string): Promise<ConsumedOpenAiUpload | null> {
    const metadata = await this.getMetadata(id);
    const binaryPath = this.binaryPath(id);
    if (!metadata || !fs.existsSync(binaryPath)) {
      return null;
    }

    const binary = fs.readFileSync(binaryPath);
    return { metadata, binary };
  }
}
```

- [ ] **Step 4: Run the file-store test again to verify it passes**

Run: `npm test --workspace @google/gemini-cli -- packages/cli/src/server/openaiFileStore.test.ts`
Expected: PASS with the new lifecycle tests green.

- [ ] **Step 5: Commit the file-store lifecycle foundation**

```bash
git add packages/cli/src/server/openaiFileStore.ts packages/cli/src/server/openaiFileStore.test.ts
git commit -m "fix: keep uploaded file binaries until processing completes"
```

---

### Task 2: Stop Invalidating `file_id` On First `/v1/chat/completions` Read

**Files:**

- Modify: `packages/cli/src/server/index.ts`
- Modify: `packages/cli/src/server/index.test.ts`

- [ ] **Step 1: Replace the failing API tests first**

```ts
// Replace the semantics in packages/cli/src/server/index.test.ts
it("keeps a media file_id reusable after Gemini processing fails", async () => {
  const uploadRes = await uploadFile();
  const uploaded = await uploadRes.json();

  mocks.geminiClient.generateContent.mockRejectedValueOnce(new Error("Gemini failure"));

  const failedRes = await fetchApi("POST", "/v1/chat/completions", {
    model: "gemini-3.1-flash-lite-preview",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Transcribe this media" },
          { type: "input_file", input_file: { file_id: uploaded.id } },
        ],
      },
    ],
  });

  expect(failedRes.status).toBe(500);

  mocks.geminiClient.generateContent.mockResolvedValueOnce({ text: "media reply" });

  const retryRes = await fetchApi("POST", "/v1/chat/completions", {
    model: "gemini-3.1-flash-lite-preview",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Try again" },
          { type: "input_file", input_file: { file_id: uploaded.id } },
        ],
      },
    ],
  });

  expect(retryRes.status).toBe(200);
});

it("keeps a media file_id reusable after an empty Gemini response", async () => {
  const uploadRes = await uploadFile();
  const uploaded = await uploadRes.json();

  mocks.geminiClient.generateContent.mockResolvedValueOnce({ text: "" });

  const emptyRes = await fetchApi("POST", "/v1/chat/completions", {
    model: "gemini-3.1-flash-lite-preview",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Transcribe this media" },
          { type: "input_file", input_file: { file_id: uploaded.id } },
        ],
      },
    ],
  });

  expect(emptyRes.status).toBe(200);

  mocks.geminiClient.generateContent.mockResolvedValueOnce({ text: "media reply" });

  const retryRes = await fetchApi("POST", "/v1/chat/completions", {
    model: "gemini-3.1-flash-lite-preview",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Try again" },
          { type: "input_file", input_file: { file_id: uploaded.id } },
        ],
      },
    ],
  });

  expect(retryRes.status).toBe(200);
});
```

- [ ] **Step 2: Run the server route tests to verify they fail**

Run: `npm test --workspace @google/gemini-cli -- packages/cli/src/server/index.test.ts`
Expected: FAIL because `/v1/chat/completions` currently consumes `file_id` on the first request and the existing tests explicitly lock in that behavior.

- [ ] **Step 3: Implement the minimal route fix in `/v1/chat/completions`**

```ts
// Modify packages/cli/src/server/index.ts
// In normalizeOpenAiMessageContent, keep reading via consumeUploadBinary for now,
// but after Task 1 it no longer deletes the binary.

// In the non-streaming path:
try {
  response = await config.getGeminiClient().generateContent(
    {
      model,
      ...(normalizedMessages.systemInstruction ||
      typeof temperature === "number" ||
      typeof max_tokens === "number"
        ? {
            config: {
              ...(normalizedMessages.systemInstruction
                ? {
                    systemInstruction: normalizedMessages.systemInstruction,
                  }
                : {}),
              ...(typeof temperature === "number" ? { temperature } : {}),
              ...(typeof max_tokens === "number" ? { maxOutputTokens: max_tokens } : {}),
            },
          }
        : {}),
    },
    normalizedMessages.contents,
    new AbortController().signal,
    LlmRole.MAIN,
  );
} catch (error) {
  // Do NOT finalize or delete the binary on failure.
  throw error;
}

for (const fileId of normalizedMessages.referencedFileIds) {
  await fileStore.finalizeProcessed(fileId, response.text ?? "");
}
```

```ts
// In the streaming path, preserve the same principle:
// - keep binary available while generation is in progress
// - call finalizeProcessed(fileId, aggregatedText) only after generation completes or after the stream finishes with the final accumulated text
// - if generation throws before any usable completion result is finalized, do not finalize the file
```

- [ ] **Step 4: Run the server route tests again to verify they pass**

Run: `npm test --workspace @google/gemini-cli -- packages/cli/src/server/index.test.ts`
Expected: PASS with reused `file_id` behavior after transient failures and empty responses.

- [ ] **Step 5: Commit the server-side route fix**

```bash
git add packages/cli/src/server/index.ts packages/cli/src/server/index.test.ts
git commit -m "fix: keep file ids valid until processing completes"
```

---

### Task 3: Preserve Explicit Cleanup And One-Consumer Semantics Without Eager Deletion

**Files:**

- Modify: `packages/cli/src/server/index.test.ts`
- Modify: `packages/cli/src/server/openaiFileStore.ts`

- [ ] **Step 1: Add the failing concurrency and cleanup tests first**

```ts
// Extend packages/cli/src/server/index.test.ts
it("still allows only one overlapping media request to use the same file_id at a time", async () => {
  const uploadRes = await uploadFile();
  const uploaded = await uploadRes.json();

  let releaseGeneration: (() => void) | undefined;
  let firstCallStartedResolve: (() => void) | undefined;
  const firstCallStarted = new Promise<void>((resolve) => {
    firstCallStartedResolve = resolve;
  });

  mocks.geminiClient.generateContent.mockImplementation(
    () =>
      new Promise((resolve) => {
        firstCallStartedResolve?.();
        releaseGeneration = () => resolve({ text: "media reply" });
      }),
  );

  const requestBody = {
    model: "gemini-3.1-flash-lite-preview",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Transcribe this media" },
          { type: "input_file", input_file: { file_id: uploaded.id } },
        ],
      },
    ],
  };

  const firstResPromise = fetchApi("POST", "/v1/chat/completions", requestBody);
  await firstCallStarted;

  const secondRes = await fetchApi("POST", "/v1/chat/completions", requestBody);
  expect(secondRes.status).toBe(400);

  releaseGeneration?.();
  const firstRes = await firstResPromise;
  expect(firstRes.status).toBe(200);
});

// Extend packages/cli/src/server/openaiFileStore.test.ts
it("removes the binary only after finalizeProcessed and keeps retention based on processedAt", async () => {
  const file = await store.createUpload({
    filename: "video.mp4",
    purpose: "user_data",
    mimeType: "video/mp4",
    bytes: Buffer.from("abc"),
  });

  await store.consumeUploadBinary(file.id);
  expect(await store.hasBinary(file.id)).toBe(true);

  await store.finalizeProcessed(file.id, "done");
  expect(await store.hasBinary(file.id)).toBe(false);
});
```

- [ ] **Step 2: Run the overlapping-request and cleanup tests to verify they fail**

Run: `npm test --workspace @google/gemini-cli -- packages/cli/src/server/index.test.ts packages/cli/src/server/openaiFileStore.test.ts`
Expected: FAIL until the server distinguishes “in use” from “consumed and deleted”.

- [ ] **Step 3: Implement the minimal in-use guard without eager binary deletion**

```ts
// Modify packages/cli/src/server/openaiFileStore.ts
export type OpenAiUploadMetadata = {
  id: string;
  filename: string;
  purpose: string;
  mimeType: string;
  bytes: number;
  createdAt: number;
  processedAt?: number;
  resultText?: string;
  inUseAt?: number;
};

async claimUploadBinary(id: string): Promise<ConsumedOpenAiUpload | null> {
  const metadata = await this.getMetadata(id);
  const binaryPath = this.binaryPath(id);
  if (!metadata || !fs.existsSync(binaryPath) || metadata.inUseAt) {
    return null;
  }

  const binary = fs.readFileSync(binaryPath);
  this.writeMetadata({ ...metadata, inUseAt: Date.now() });
  return { metadata: { ...metadata, inUseAt: Date.now() }, binary };
}

async releaseClaim(id: string): Promise<void> {
  const metadata = await this.getMetadata(id);
  if (!metadata) {
    return;
  }
  const { inUseAt: _ignored, ...rest } = metadata;
  this.writeMetadata(rest);
}
```

```ts
// Modify packages/cli/src/server/index.ts
// Replace consumeUploadBinary(fileId) with claimUploadBinary(fileId)
// On generation success: finalizeProcessed(fileId, responseText)
// On generation failure: releaseClaim(fileId)
// This preserves one-consumer semantics while keeping retries possible after explicit failure.
```

- [ ] **Step 4: Run the overlapping-request and cleanup tests again to verify they pass**

Run: `npm test --workspace @google/gemini-cli -- packages/cli/src/server/index.test.ts packages/cli/src/server/openaiFileStore.test.ts`
Expected: PASS with one-consumer-at-a-time preserved and binary deletion happening only after explicit completion.

- [ ] **Step 5: Commit the explicit-finalization lifecycle**

```bash
git add packages/cli/src/server/openaiFileStore.ts packages/cli/src/server/openaiFileStore.test.ts packages/cli/src/server/index.ts packages/cli/src/server/index.test.ts
git commit -m "fix: finalize uploaded media after explicit completion"
```

---

### Task 4: Run Final Verification For The Server Fix

**Files:**

- Verify only: `packages/cli/src/server/openaiFileStore.ts`, `packages/cli/src/server/openaiFileStore.test.ts`, `packages/cli/src/server/index.ts`, `packages/cli/src/server/index.test.ts`

- [ ] **Step 1: Run the focused server test suite**

Run: `npm test --workspace @google/gemini-cli -- packages/cli/src/server/openaiFileStore.test.ts packages/cli/src/server/index.test.ts`
Expected: PASS with the updated lifecycle semantics.

- [ ] **Step 2: Run package lint/typecheck for the touched server code**

Run: `npm run lint --workspace @google/gemini-cli`
Expected: PASS with zero warnings.

Run: `npm run typecheck --workspace @google/gemini-cli`
Expected: PASS with zero TypeScript errors.

- [ ] **Step 3: Optional local repro script after the tests**

Run the previously failing sequence against the local server:

```bash
node --input-type=module - <<'NODE'
import {
  DEFAULT_BASE_URL,
  loadLocalGeminiToken,
  uploadFile,
  sendChatCompletion,
  buildChatCompletionPayload,
} from './skills/openai-media-transcriber/scripts/media_client.mjs';

const token = await loadLocalGeminiToken();
const baseUrl = process.env.GEMINI_LOCAL_BASE_URL ?? DEFAULT_BASE_URL;
const filePath = '/absolute/path/to/flaky-video-note.mp4';

const uploaded = await uploadFile({ baseUrl, token, filePath });
const payload = buildChatCompletionPayload({
  prompt: 'Briefly describe the visual content and transcribe the spoken audio.',
  fileId: uploaded.id,
});

for (let attempt = 1; attempt <= 3; attempt += 1) {
  try {
    const data = await sendChatCompletion({ baseUrl, token, payload });
    console.log(attempt, data.choices?.[0]?.message?.content ?? '');
  } catch (error) {
    console.error(attempt, error instanceof Error ? error.message : String(error));
  }
}
NODE
```

Expected: transient generation failures may still happen, but the same `file_id` should no longer become invalid immediately after the first failed attempt.

- [ ] **Step 4: Commit the verified server fix**

```bash
git add packages/cli/src/server/openaiFileStore.ts packages/cli/src/server/openaiFileStore.test.ts packages/cli/src/server/index.ts packages/cli/src/server/index.test.ts
git commit -m "test: cover reusable uploaded file lifecycle"
```

---

## Self-Review Notes

- Spec coverage: the plan covers the exact root cause found in `packages/cli/src/server/index.ts:303` and `packages/cli/src/server/openaiFileStore.ts:107-117`, plus the tests in `packages/cli/src/server/index.test.ts:889-1032` that currently lock in the problematic behavior.
- Placeholder scan: no placeholders remain.
- Type consistency: the plan uses `finalizeProcessed`, `claimUploadBinary`, and `releaseClaim` consistently across later tasks.
