import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { join, parse } from "node:path";

export const MAX_COMPRESSED_VIDEO_BYTES = Math.floor(19.5 * 1024 * 1024);

const DEFAULT_AUDIO_BITRATE_KBPS = 64;
const DEFAULT_CONTAINER_OVERHEAD_KBPS = 16;
const MIN_VIDEO_BITRATE_KBPS = 150;

export interface VideoCompressionPreset {
  maxSide: number;
  fps: number;
}

export interface ProbedVideoStream {
  durationSeconds: number;
  width: number;
  height: number;
}

export class MissingVideoCompressionDependencyError extends Error {
  readonly dependencyName: "ffmpeg" | "ffprobe";

  constructor(dependencyName: "ffmpeg" | "ffprobe", cause?: unknown) {
    super(`Required video compression dependency is unavailable: ${dependencyName}`);
    this.name = "MissingVideoCompressionDependencyError";
    this.dependencyName = dependencyName;
    this.cause = cause;
  }
}

export class OversizedVideoCompressionError extends Error {
  readonly maxBytes: number;

  constructor(maxBytes: number) {
    super(`Compressed video still exceeds byte budget: ${maxBytes}`);
    this.name = "OversizedVideoCompressionError";
    this.maxBytes = maxBytes;
  }
}

interface ProbeVideoParams {
  inputPath: string;
  ffprobePath: string;
}

interface RunFfmpegParams {
  ffmpegPath: string;
  inputPath: string;
  outputPath: string;
  maxSide: number;
  fps: number;
  targetVideoBitrateKbps: number;
}

interface StatFileResult {
  size: number;
}

interface CompressVideoToBudgetParams {
  inputPath: string;
  outputDirectoryPath: string;
  maxBytes?: number;
  ffmpegPathResolver?: () => Promise<string>;
  ffprobePathResolver?: () => Promise<string>;
  probeVideo?: (params: ProbeVideoParams) => Promise<ProbedVideoStream>;
  runFfmpeg?: (params: RunFfmpegParams) => Promise<void>;
  statFile?: (filePath: string) => Promise<StatFileResult>;
}

interface CompressedVideoResult {
  outputPath: string;
  sizeBytes: number;
  preset: VideoCompressionPreset;
}

interface FfprobeJsonOutput {
  streams?: Array<{
    width?: number | string;
    height?: number | string;
  }>;
  format?: {
    duration?: number | string;
  };
}

export function createVideoCompressionPresets(): VideoCompressionPreset[] {
  return [
    { maxSide: 1280, fps: 20 },
    { maxSide: 960, fps: 15 },
    { maxSide: 720, fps: 12 },
    { maxSide: 640, fps: 10 },
  ];
}

export async function compressVideoToBudget(
  params: CompressVideoToBudgetParams,
): Promise<CompressedVideoResult> {
  const maxBytes = params.maxBytes ?? MAX_COMPRESSED_VIDEO_BYTES;
  const resolveFfmpegBinaryPath = params.ffmpegPathResolver ?? resolveFfmpegPath;
  const resolveFfprobeBinaryPath = params.ffprobePathResolver ?? resolveFfprobePath;
  const probeVideo = params.probeVideo ?? probeVideoWithFfprobe;
  const runFfmpeg = params.runFfmpeg ?? runFfmpegCompression;
  const statFileImpl = params.statFile ?? stat;

  const ffmpegPath = await resolveCompressionDependency({
    dependencyName: "ffmpeg",
    resolver: resolveFfmpegBinaryPath,
  });
  const ffprobePath = await resolveCompressionDependency({
    dependencyName: "ffprobe",
    resolver: resolveFfprobeBinaryPath,
  });
  const probedStream = await probeVideo({
    inputPath: params.inputPath,
    ffprobePath,
  });
  const targetVideoBitrateKbps = computeTargetVideoBitrateKbps({
    maxBytes,
    durationSeconds: probedStream.durationSeconds,
  });

  for (const preset of createVideoCompressionPresets()) {
    const outputPath = buildCompressedOutputPath({
      inputPath: params.inputPath,
      outputDirectoryPath: params.outputDirectoryPath,
      preset,
    });

    await runFfmpeg({
      ffmpegPath,
      inputPath: params.inputPath,
      outputPath,
      maxSide: preset.maxSide,
      fps: preset.fps,
      targetVideoBitrateKbps,
    });

    const outputStat = await statFileImpl(outputPath);
    if (outputStat.size <= maxBytes) {
      return {
        outputPath,
        sizeBytes: outputStat.size,
        preset,
      };
    }
  }

  throw new OversizedVideoCompressionError(maxBytes);
}

function buildCompressedOutputPath(params: {
  inputPath: string;
  outputDirectoryPath: string;
  preset: VideoCompressionPreset;
}): string {
  const inputFileName = parse(params.inputPath).name;
  return join(
    params.outputDirectoryPath,
    `${inputFileName}-compressed-${params.preset.maxSide}x${params.preset.fps}.mp4`,
  );
}

function computeTargetVideoBitrateKbps(params: {
  maxBytes: number;
  durationSeconds: number;
}): number {
  const safeDurationSeconds = Math.max(1, Math.ceil(params.durationSeconds));
  const totalBudgetKbps = Math.floor((params.maxBytes * 8) / safeDurationSeconds / 1000);

  return Math.max(
    MIN_VIDEO_BITRATE_KBPS,
    totalBudgetKbps - DEFAULT_AUDIO_BITRATE_KBPS - DEFAULT_CONTAINER_OVERHEAD_KBPS,
  );
}

async function resolveFfmpegPath(): Promise<string> {
  return resolveBinaryOnPath("ffmpeg");
}

async function resolveFfprobePath(): Promise<string> {
  return resolveBinaryOnPath("ffprobe");
}

async function resolveBinaryOnPath(binaryName: "ffmpeg" | "ffprobe"): Promise<string> {
  try {
    await execFilePromise(binaryName, ["-version"]);
    return binaryName;
  } catch (error) {
    throw new MissingVideoCompressionDependencyError(binaryName, error);
  }
}

async function resolveCompressionDependency(params: {
  dependencyName: "ffmpeg" | "ffprobe";
  resolver: () => Promise<string>;
}): Promise<string> {
  try {
    return await params.resolver();
  } catch (error) {
    if (error instanceof MissingVideoCompressionDependencyError) {
      throw error;
    }

    throw new MissingVideoCompressionDependencyError(params.dependencyName, error);
  }
}

async function probeVideoWithFfprobe(params: ProbeVideoParams): Promise<ProbedVideoStream> {
  const completed = await execFilePromise(params.ffprobePath, [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height:format=duration",
    "-of",
    "json",
    params.inputPath,
  ]);
  const parsed = parseFfprobeJson(completed.stdout);

  return {
    durationSeconds: parsed.durationSeconds,
    width: parsed.width,
    height: parsed.height,
  };
}

function parseFfprobeJson(stdout: string): ProbedVideoStream {
  try {
    const parsed = JSON.parse(stdout) as FfprobeJsonOutput;
    const stream = parsed.streams?.[0];

    return {
      durationSeconds: coercePositiveNumber(parsed.format?.duration) ?? 1,
      width: coercePositiveNumber(stream?.width) ?? 0,
      height: coercePositiveNumber(stream?.height) ?? 0,
    };
  } catch {
    return {
      durationSeconds: 1,
      width: 0,
      height: 0,
    };
  }
}

function coercePositiveNumber(value: number | string | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

async function runFfmpegCompression(params: RunFfmpegParams): Promise<void> {
  const scaleFilter = [
    `scale='if(gte(iw,ih),min(${params.maxSide},iw),-2)'`,
    `'if(gte(iw,ih),-2,min(${params.maxSide},ih))'`,
  ].join(":");
  const videoFilter = `${scaleFilter},fps=${params.fps}`;

  await execFilePromise(params.ffmpegPath, [
    "-y",
    "-i",
    params.inputPath,
    "-vf",
    videoFilter,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "veryfast",
    "-b:v",
    `${params.targetVideoBitrateKbps}k`,
    "-maxrate",
    `${params.targetVideoBitrateKbps}k`,
    "-bufsize",
    `${params.targetVideoBitrateKbps * 2}k`,
    "-c:a",
    "aac",
    "-ac",
    "1",
    "-b:a",
    `${DEFAULT_AUDIO_BITRATE_KBPS}k`,
    "-movflags",
    "+faststart",
    params.outputPath,
  ]);
}

function execFilePromise(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}
