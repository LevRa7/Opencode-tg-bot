import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveIncomingMediaFile } from "../../src/media/storage.js";

describe("media/storage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stores host runtime media under appHome and exposes the host path", async () => {
    const appHome = await fs.mkdtemp(path.join(os.tmpdir(), "media-host-"));
    vi.stubEnv("OPENCODE_TELEGRAM_HOME", appHome);
    vi.stubEnv("OPENCODE_TELEGRAM_RUNTIME_MODE", "installed");

    const storedFile = await saveIncomingMediaFile({
      owner: { userId: 42, runtimeKind: "host" },
      telegramFileId: "host-file-1",
      originalFileName: "photo.png",
      fallbackFileName: "photo.png",
      mimeType: "image/png",
      mediaType: "image",
      buffer: Buffer.from("host-image"),
      now: new Date("2026-04-24T10:11:12.000Z"),
    });

    const expectedPath = path.join(
      appHome,
      "media",
      "42",
      "2026",
      "04",
      "24",
      "2026-04-24T10-11-12-000Z-host-file-1-photo.png",
    );

    expect(storedFile.hostAbsolutePath).toBe(expectedPath);
    expect(storedFile.runtimeVisiblePath).toBe(expectedPath);
    expect(storedFile.fileName).toBe("2026-04-24T10-11-12-000Z-host-file-1-photo.png");
    expect(storedFile.mimeType).toBe("image/png");
    expect(storedFile.sizeBytes).toBe(Buffer.byteLength("host-image"));
    expect(storedFile.mediaType).toBe("image");
    await expect(fs.readFile(expectedPath, "utf-8")).resolves.toBe("host-image");
  });

  it("stores tenant runtime media in tenant state and exposes a /state path", async () => {
    const workspacesRoot = await fs.mkdtemp(path.join(os.tmpdir(), "media-tenant-"));
    vi.stubEnv("WORKSPACES_ROOT", workspacesRoot);

    const storedFile = await saveIncomingMediaFile({
      owner: { userId: 77, runtimeKind: "tenant", tenantId: "tenant-abc" },
      telegramFileId: "tenant-file-1",
      originalFileName: "meeting-notes.txt",
      fallbackFileName: "meeting-notes.txt",
      mimeType: "text/plain",
      mediaType: "text_document",
      buffer: Buffer.from("tenant-text"),
      now: new Date("2026-04-24T10:11:12.000Z"),
    });

    const expectedHostPath = path.join(
      workspacesRoot,
      "tenant-abc",
      "state",
      "media",
      "77",
      "2026",
      "04",
      "24",
      "2026-04-24T10-11-12-000Z-tenant-file-1-meeting-notes.txt",
    );
    const expectedRuntimePath = "/state/media/77/2026/04/24/2026-04-24T10-11-12-000Z-tenant-file-1-meeting-notes.txt";

    expect(storedFile.hostAbsolutePath).toBe(expectedHostPath);
    expect(storedFile.runtimeVisiblePath).toBe(expectedRuntimePath);
    expect(storedFile.fileName).toBe("2026-04-24T10-11-12-000Z-tenant-file-1-meeting-notes.txt");
    await expect(fs.readFile(expectedHostPath, "utf-8")).resolves.toBe("tenant-text");
  });

  it("sanitizes filename parts, preserves extension, and falls back to a safe stem", async () => {
    const appHome = await fs.mkdtemp(path.join(os.tmpdir(), "media-sanitize-"));
    vi.stubEnv("OPENCODE_TELEGRAM_HOME", appHome);
    vi.stubEnv("OPENCODE_TELEGRAM_RUNTIME_MODE", "installed");

    const storedFile = await saveIncomingMediaFile({
      owner: { userId: 9, runtimeKind: "host" },
      telegramFileId: "file/id:42",
      originalFileName: "../../Quarterly Report (final).pdf",
      fallbackFileName: "fallback-name.pdf",
      mimeType: "application/pdf",
      mediaType: "pdf",
      buffer: Buffer.from("pdf-data"),
      now: new Date("2026-04-24T10:11:12.000Z"),
    });

    expect(storedFile.fileName).toBe(
      "2026-04-24T10-11-12-000Z-file-id-42-Quarterly-Report-final.pdf",
    );

    const fallbackStoredFile = await saveIncomingMediaFile({
      owner: { userId: 9, runtimeKind: "host" },
      telegramFileId: "secondary",
      originalFileName: undefined,
      fallbackFileName: "...///???",
      mimeType: "application/octet-stream",
      mediaType: "pdf",
      buffer: Buffer.from("fallback-data"),
      now: new Date("2026-04-24T10:11:12.000Z"),
    });

    expect(fallbackStoredFile.fileName).toBe("2026-04-24T10-11-12-000Z-secondary-file");
  });

  it("rejects tenant owners with missing or unsafe tenant ids", async () => {
    await expect(
      saveIncomingMediaFile({
        owner: { userId: 5, runtimeKind: "tenant", tenantId: "" },
        telegramFileId: "tenant-file",
        fallbackFileName: "file.txt",
        mimeType: "text/plain",
        mediaType: "text_document",
        buffer: Buffer.from("tenant-text"),
        now: new Date("2026-04-24T10:11:12.000Z"),
      }),
    ).rejects.toThrow("Tenant media storage requires tenantId");

    for (const tenantId of ["../x", "tenant/a"]) {
      await expect(
        saveIncomingMediaFile({
          owner: { userId: 5, runtimeKind: "tenant", tenantId },
          telegramFileId: "tenant-file",
          fallbackFileName: "file.txt",
          mimeType: "text/plain",
          mediaType: "text_document",
          buffer: Buffer.from("tenant-text"),
          now: new Date("2026-04-24T10:11:12.000Z"),
        }),
      ).rejects.toThrow("Tenant media storage requires a safe tenantId path segment");
    }
  });
});
