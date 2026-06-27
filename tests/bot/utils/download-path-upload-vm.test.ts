import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks ──

const mockGetCurrentOpencodeRoute = vi.hoisted(() => vi.fn());

vi.mock("../../../src/opencode/client.js", () => ({
  getCurrentOpencodeRoute: mockGetCurrentOpencodeRoute,
}));

vi.mock("../../../src/utils/ssh-manager.js", () => ({
  sshManager: {
    isSshActive: vi.fn().mockReturnValue(false),
  },
}));

vi.mock("../../../src/config.js", () => ({
  config: {
    telegram: { adminUserId: 99999 },
    opencode: { apiUrl: "http://localhost:4096" },
  },
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../../src/runtime/paths.js", () => ({
  getRuntimePaths: () => ({ appHome: "/home/me/opencode-tg" }),
  getWorkspacesRoot: () => "/home/me/workspaces",
}));

// ── Imports after mocks ──

import { saveAttachment } from "../../../src/bot/utils/download-path-upload.js";

// ── Helpers ──

const BASE_URL = "http://192.168.123.1:8890";
const SERVED_DIR = "/tmp/test-served-files";
const TEST_BUFFER = Buffer.from("hello attachment");

// ── Tests ──

describe("saveAttachment — VM route (file-server)", () => {
  beforeEach(() => {
    process.env.FILE_SERVER_BASE_URL = BASE_URL;
    process.env.FILE_SERVER_DIR = SERVED_DIR;
  });

  it("saves file to served dir and returns HTTP URL as absolutePath", async () => {
    mockGetCurrentOpencodeRoute.mockReturnValue({
      kind: "vm",
      userId: 42,
      chatId: 777,
    });

    const result = await saveAttachment(TEST_BUFFER, "doc.pdf", "application/pdf");

    // absolutePath is an HTTP URL
    expect(result.absolutePath).toBe(`${BASE_URL}/doc.pdf`);
    expect(result.filename).toBe("doc.pdf");
    expect(result.sizeBytes).toBe(TEST_BUFFER.length);
  });

  it("returns local path when route is host", async () => {
    mockGetCurrentOpencodeRoute.mockReturnValue({
      kind: "host",
      userId: 42,
      chatId: 777,
    });

    const result = await saveAttachment(TEST_BUFFER, "script.sh", "text/plain");

    // Local path, not URL
    expect(result.absolutePath).toContain("Downloads");
    expect(result.absolutePath).not.toContain("http://");
  });

  it("resolves mimeType for VM uploads", async () => {
    mockGetCurrentOpencodeRoute.mockReturnValue({
      kind: "vm",
      userId: 42,
      chatId: 777,
    });

    const result = await saveAttachment(TEST_BUFFER, "photo.jpg", "");

    expect(result.mimeType).toBe("image/jpeg");
    expect(result.absolutePath).toBe(`${BASE_URL}/photo.jpg`);
  });

  it("handles video files via VM route", async () => {
    mockGetCurrentOpencodeRoute.mockReturnValue({
      kind: "vm",
      userId: 42,
      chatId: 777,
    });

    const result = await saveAttachment(TEST_BUFFER, "video.mp4", "video/mp4");

    expect(result.mimeType).toBe("video/mp4");
    expect(result.absolutePath).toBe(`${BASE_URL}/video.mp4`);
  });

  it("handles audio files via VM route", async () => {
    mockGetCurrentOpencodeRoute.mockReturnValue({
      kind: "vm",
      userId: 42,
      chatId: 777,
    });

    const result = await saveAttachment(TEST_BUFFER, "song.mp3", "audio/mpeg");

    expect(result.mimeType).toBe("audio/mpeg");
    expect(result.absolutePath).toBe(`${BASE_URL}/song.mp3`);
  });

  it("sanitizes filename with path traversal", async () => {
    mockGetCurrentOpencodeRoute.mockReturnValue({
      kind: "vm",
      userId: 42,
      chatId: 777,
    });

    const result = await saveAttachment(TEST_BUFFER, "../../../etc/passwd", "text/plain");

    expect(result.absolutePath).toBe(`${BASE_URL}/.._.._.._etc_passwd`);
    expect(result.filename).toBe("../../../etc/passwd");
  });
});
