import { beforeEach, describe, expect, it, vi } from "vitest";
import { Agent as HttpsAgent } from "https";

const nodeFetchMock = vi.hoisted(() => vi.fn());
const mocked = vi.hoisted(() => ({
  config: {
    telegram: {
      token: "test-telegram-token",
      proxyUrl: "",
      apiRoot: "",
      proxySecret: "",
      forceIpv4: false,
    },
    server: {
      logLevel: "error",
    },
  },
  httpsProxyAgentMock: vi.fn(),
}));

vi.mock("../../../src/config.js", () => ({
  config: mocked.config,
}));

vi.mock("https-proxy-agent", () => ({
  HttpsProxyAgent: mocked.httpsProxyAgentMock,
}));

vi.mock("node-fetch", () => ({
  default: nodeFetchMock,
}));

import {
  downloadTelegramFile,
  downloadTelegramVideoForCompression,
  toDataUri,
  formatFileSize,
  isFileSizeAllowed,
  isTextMimeType,
} from "../../../src/bot/utils/file-download.js";

describe("bot/utils/file-download", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocked.config.telegram.proxyUrl = "";
    mocked.config.telegram.apiRoot = "";
    mocked.config.telegram.proxySecret = "";
    mocked.config.telegram.forceIpv4 = false;
    mocked.httpsProxyAgentMock.mockReset();
    nodeFetchMock.mockReset();
  });

  describe("downloadTelegramFile", () => {
    it("rejects files larger than 2048MB for generic downloads", async () => {
      const getFile = vi.fn().mockResolvedValue({
        file_path: "videos/oversized.mp4",
        file_size: 2500 * 1024 * 1024,
      });
      const api = {
        getFile,
      } as never;

      await expect(downloadTelegramFile(api, "oversized-file-id")).rejects.toThrow(
        "File too large: 2500.00MB (max 2048MB)",
      );
      expect(getFile).toHaveBeenCalledWith("oversized-file-id");
    });

    it("does not configure a fetch agent for direct downloads by default", async () => {
      nodeFetchMock.mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      });

      const getFile = vi.fn().mockResolvedValue({
        file_path: "photos/default.jpg",
        file_size: 1024,
      });
      const api = { getFile } as never;

      await downloadTelegramFile(api, "fid");

      const [, init] = nodeFetchMock.mock.calls[0];
      expect((init as { agent?: unknown } | undefined)?.agent).toBeUndefined();
    });

    it("uses an IPv4 HTTPS agent for direct downloads when TELEGRAM_FORCE_IPV4 is enabled", async () => {
      mocked.config.telegram.forceIpv4 = true;

      nodeFetchMock.mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      });

      const getFile = vi.fn().mockResolvedValue({
        file_path: "photos/ipv4.jpg",
        file_size: 1024,
      });
      const api = { getFile } as never;

      await downloadTelegramFile(api, "fid");

      const [, init] = nodeFetchMock.mock.calls[0];
      const agent = (init as { agent?: unknown } | undefined)?.agent;
      expect(agent).toBeInstanceOf(HttpsAgent);
      expect((agent as HttpsAgent).options.family).toBe(4);
    });
  });

  describe("downloadTelegramVideoForCompression", () => {
    it("downloads oversized video files through the explicit compression path", async () => {
      const getFile = vi.fn().mockResolvedValue({
        file_path: "videos/oversized.mp4",
        file_size: 25 * 1024 * 1024,
      });
      const api = {
        getFile,
      } as never;
      const fetchImpl = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer,
      });

      const result = await downloadTelegramVideoForCompression(api, "oversized-video-id", fetchImpl);

      expect(getFile).toHaveBeenCalledWith("oversized-video-id");
      expect(fetchImpl).toHaveBeenCalledWith(
        "https://api.telegram.org/file/bottest-telegram-token/videos/oversized.mp4",
        {},
      );
      expect(result).toEqual({
        buffer: Buffer.from([1, 2, 3, 4]),
        filePath: "videos/oversized.mp4",
      });
    });

    it("passes a proxy agent to fetch when the explicit compression path uses a proxy", async () => {
      mocked.config.telegram.proxyUrl = "http://proxy.internal:8080";

      const proxyAgent = { kind: "https-proxy-agent" };
      mocked.httpsProxyAgentMock.mockReturnValue(proxyAgent);

      const getFile = vi.fn().mockResolvedValue({
        file_path: "videos/proxied-oversized.mp4",
        file_size: 30 * 1024 * 1024,
      });
      const api = { getFile } as never;
      const fetchImpl = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => Uint8Array.from([9, 8, 7]).buffer,
      });

      await downloadTelegramVideoForCompression(api, "proxied-video-id", fetchImpl);

      expect(mocked.httpsProxyAgentMock).toHaveBeenCalledWith("http://proxy.internal:8080");
      expect(fetchImpl).toHaveBeenCalledWith(
        "https://api.telegram.org/file/bottest-telegram-token/videos/proxied-oversized.mp4",
        { agent: proxyAgent },
      );
    });

    it("still rejects oversized compression downloads above the dedicated hard cap", async () => {
      const getFile = vi.fn().mockResolvedValue({
        file_path: "videos/too-large.mp4",
        file_size: 80 * 1024 * 1024,
      });
      const api = { getFile } as never;

      await expect(downloadTelegramVideoForCompression(api, "too-large-video-id")).rejects.toThrow(
        /max .*MB/,
      );
    });
  });

  describe("toDataUri", () => {
    it("converts buffer to base64 data URI with correct MIME type", () => {
      const buffer = Buffer.from("Hello, World!");
      const dataUri = toDataUri(buffer, "text/plain");

      expect(dataUri).toBe("data:text/plain;base64,SGVsbG8sIFdvcmxkIQ==");
    });

    it("handles image MIME types", () => {
      const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic number
      const dataUri = toDataUri(buffer, "image/png");

      expect(dataUri).toMatch(/^data:image\/png;base64,/);
      expect(dataUri).toBe("data:image/png;base64,iVBORw==");
    });

    it("handles empty buffer", () => {
      const buffer = Buffer.from([]);
      const dataUri = toDataUri(buffer, "application/octet-stream");

      expect(dataUri).toBe("data:application/octet-stream;base64,");
    });
  });

  describe("isFileSizeAllowed", () => {
    it("returns true when file size is within limit", () => {
      expect(isFileSizeAllowed(100 * 1024, 200)).toBe(true); // 100KB < 200KB
      expect(isFileSizeAllowed(1024, 1)).toBe(true); // exactly at limit
    });

    it("returns false when file size exceeds limit", () => {
      expect(isFileSizeAllowed(300 * 1024, 200)).toBe(false); // 300KB > 200KB
      expect(isFileSizeAllowed(1025, 1)).toBe(false); // just over limit
    });

    it("returns true when file size is undefined (unknown)", () => {
      expect(isFileSizeAllowed(undefined, 100)).toBe(true);
    });
  });

  describe("formatFileSize", () => {
    it("formats bytes correctly", () => {
      expect(formatFileSize(0)).toBe("0B");
      expect(formatFileSize(500)).toBe("500B");
      expect(formatFileSize(1023)).toBe("1023B");
    });

    it("formats kilobytes correctly", () => {
      expect(formatFileSize(1024)).toBe("1.0KB");
      expect(formatFileSize(1536)).toBe("1.5KB");
      expect(formatFileSize(10240)).toBe("10.0KB");
    });

    it("formats megabytes correctly", () => {
      expect(formatFileSize(1024 * 1024)).toBe("1.0MB");
      expect(formatFileSize(2.5 * 1024 * 1024)).toBe("2.5MB");
      expect(formatFileSize(10 * 1024 * 1024)).toBe("10.0MB");
    });
  });

  describe("isTextMimeType", () => {
    it("returns true for text/* MIME types", () => {
      expect(isTextMimeType("text/plain")).toBe(true);
      expect(isTextMimeType("text/markdown")).toBe(true);
      expect(isTextMimeType("text/html")).toBe(true);
      expect(isTextMimeType("text/css")).toBe(true);
      expect(isTextMimeType("text/javascript")).toBe(true);
      expect(isTextMimeType("text/x-python")).toBe(true);
      expect(isTextMimeType("text/csv")).toBe(true);
    });

    it("returns true for whitelisted application/* types", () => {
      expect(isTextMimeType("application/json")).toBe(true);
      expect(isTextMimeType("application/xml")).toBe(true);
      expect(isTextMimeType("application/javascript")).toBe(true);
      expect(isTextMimeType("application/x-yaml")).toBe(true);
      expect(isTextMimeType("application/sql")).toBe(true);
    });

    it("returns false for other application/* types", () => {
      expect(isTextMimeType("application/pdf")).toBe(false);
      expect(isTextMimeType("application/zip")).toBe(false);
      expect(isTextMimeType("application/octet-stream")).toBe(false);
      expect(isTextMimeType("application/msword")).toBe(false);
    });

    it("returns false for image/* types", () => {
      expect(isTextMimeType("image/png")).toBe(false);
      expect(isTextMimeType("image/jpeg")).toBe(false);
      expect(isTextMimeType("image/gif")).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(isTextMimeType(undefined)).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(isTextMimeType("")).toBe(false);
    });
  });
});
