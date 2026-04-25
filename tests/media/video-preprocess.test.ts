import { describe, expect, it, vi } from "vitest";
import {
  MAX_COMPRESSED_VIDEO_BYTES,
  MissingVideoCompressionDependencyError,
  OversizedVideoCompressionError,
  compressVideoToBudget,
  createVideoCompressionPresets,
} from "../../src/media/video-preprocess.js";

describe("media/video-preprocess", () => {
  it("returns the staged compression presets in order", () => {
    expect(createVideoCompressionPresets()).toEqual([
      { maxSide: 1280, fps: 20 },
      { maxSide: 960, fps: 15 },
      { maxSide: 720, fps: 12 },
      { maxSide: 640, fps: 10 },
    ]);
  });

  it("throws a missing dependency error when ffmpeg is unavailable", async () => {
    await expect(
      compressVideoToBudget({
        inputPath: "/tmp/input.mp4",
        outputDirectoryPath: "/tmp/output",
        ffmpegPathResolver: vi.fn().mockRejectedValue(new Error("ffmpeg missing")),
        ffprobePathResolver: vi.fn().mockResolvedValue("ffprobe"),
        probeVideo: vi.fn(),
        runFfmpeg: vi.fn(),
        statFile: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(MissingVideoCompressionDependencyError);
  });

  it("throws a missing dependency error when ffprobe is unavailable", async () => {
    await expect(
      compressVideoToBudget({
        inputPath: "/tmp/input.mp4",
        outputDirectoryPath: "/tmp/output",
        ffmpegPathResolver: vi.fn().mockResolvedValue("ffmpeg"),
        ffprobePathResolver: vi.fn().mockRejectedValue(new Error("ffprobe missing")),
        probeVideo: vi.fn(),
        runFfmpeg: vi.fn(),
        statFile: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(MissingVideoCompressionDependencyError);
  });

  it("returns the first derivative that fits under the byte budget", async () => {
    const probeVideo = vi.fn().mockResolvedValue({
      durationSeconds: 30,
      width: 1920,
      height: 1080,
    });
    const runFfmpeg = vi.fn().mockResolvedValue(undefined);
    const statFile = vi
      .fn()
      .mockResolvedValueOnce({ size: MAX_COMPRESSED_VIDEO_BYTES + 100_000 })
      .mockResolvedValueOnce({ size: MAX_COMPRESSED_VIDEO_BYTES - 100_000 });

    const result = await compressVideoToBudget({
      inputPath: "/tmp/input.mp4",
      outputDirectoryPath: "/tmp/output",
      ffmpegPathResolver: vi.fn().mockResolvedValue("ffmpeg"),
      ffprobePathResolver: vi.fn().mockResolvedValue("ffprobe"),
      probeVideo,
      runFfmpeg,
      statFile,
    });

    expect(probeVideo).toHaveBeenCalledWith({
      inputPath: "/tmp/input.mp4",
      ffprobePath: "ffprobe",
    });
    expect(runFfmpeg).toHaveBeenCalledTimes(2);
    expect(runFfmpeg).toHaveBeenNthCalledWith(1, {
      ffmpegPath: "ffmpeg",
      inputPath: "/tmp/input.mp4",
      outputPath: "/tmp/output/input-compressed-1280x20.mp4",
      maxSide: 1280,
      fps: 20,
      targetVideoBitrateKbps: expect.any(Number),
    });
    expect(runFfmpeg).toHaveBeenNthCalledWith(2, {
      ffmpegPath: "ffmpeg",
      inputPath: "/tmp/input.mp4",
      outputPath: "/tmp/output/input-compressed-960x15.mp4",
      maxSide: 960,
      fps: 15,
      targetVideoBitrateKbps: expect.any(Number),
    });
    expect(result).toEqual({
      outputPath: "/tmp/output/input-compressed-960x15.mp4",
      sizeBytes: MAX_COMPRESSED_VIDEO_BYTES - 100_000,
      preset: { maxSide: 960, fps: 15 },
    });
  });

  it("passes a chained scale and fps filter to ffmpeg", async () => {
    vi.resetModules();

    try {
      const execFileMock = vi.fn((command: string, args: readonly string[], callback: any) => {
        callback(null, "", "");
        return {};
      });

      vi.doMock("node:child_process", async (importOriginal) => {
        const actual = await importOriginal<typeof import("node:child_process")>();
        return {
          ...actual,
          execFile: execFileMock,
        };
      });

      const { compressVideoToBudget: compressVideoToBudgetWithMock } = await import(
        "../../src/media/video-preprocess.js"
      );

      await compressVideoToBudgetWithMock({
        inputPath: "/tmp/input.mp4",
        outputDirectoryPath: "/tmp/output",
        ffmpegPathResolver: vi.fn().mockResolvedValue("ffmpeg"),
        ffprobePathResolver: vi.fn().mockResolvedValue("ffprobe"),
        probeVideo: vi.fn().mockResolvedValue({
          durationSeconds: 30,
          width: 1920,
          height: 1080,
        }),
        statFile: vi.fn().mockResolvedValue({ size: MAX_COMPRESSED_VIDEO_BYTES - 1 }),
      });

      const ffmpegArgs = execFileMock.mock.calls[0]?.[1];
      const filterIndex = ffmpegArgs?.indexOf("-vf") ?? -1;

      expect(filterIndex).toBeGreaterThanOrEqual(0);
      expect(ffmpegArgs?.[filterIndex + 1]).toBe(
        "scale='if(gte(iw,ih),min(1280,iw),-2)':'if(gte(iw,ih),-2,min(1280,ih))',fps=20",
      );
    } finally {
      vi.doUnmock("node:child_process");
      vi.resetModules();
    }
  });

  it("throws an oversized error when every preset output remains over budget", async () => {
    const runFfmpeg = vi.fn().mockResolvedValue(undefined);
    const statFile = vi.fn().mockResolvedValue({ size: MAX_COMPRESSED_VIDEO_BYTES + 1 });

    await expect(
      compressVideoToBudget({
        inputPath: "/tmp/input.mp4",
        outputDirectoryPath: "/tmp/output",
        ffmpegPathResolver: vi.fn().mockResolvedValue("ffmpeg"),
        ffprobePathResolver: vi.fn().mockResolvedValue("ffprobe"),
        probeVideo: vi.fn().mockResolvedValue({
          durationSeconds: 45,
          width: 1280,
          height: 720,
        }),
        runFfmpeg,
        statFile,
      }),
    ).rejects.toBeInstanceOf(OversizedVideoCompressionError);

    expect(runFfmpeg).toHaveBeenCalledTimes(4);
  });
});
