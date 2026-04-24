import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { MediaTranscriberKind } from "./types.js";

const MEDIA_TRANSCRIBER_SCRIPT_URLS: Record<MediaTranscriberKind, URL> = {
  photo: new URL("../../skills/openai-media-transcriber/scripts/photo.mjs", import.meta.url),
  document: new URL("../../skills/openai-media-transcriber/scripts/document.mjs", import.meta.url),
  audio: new URL("../../skills/openai-media-transcriber/scripts/audio.mjs", import.meta.url),
  video: new URL("../../skills/openai-media-transcriber/scripts/video.mjs", import.meta.url),
};

export class MediaTranscriberError extends Error {
  readonly scriptPath: string;
  readonly stderr: string;
  readonly exitCode: number | null;

  constructor(params: {
    message: string;
    scriptPath: string;
    stderr: string;
    exitCode: number | null;
  }) {
    super(params.message);
    this.name = "MediaTranscriberError";
    this.scriptPath = params.scriptPath;
    this.stderr = params.stderr;
    this.exitCode = params.exitCode;
  }
}

export function resolveMediaTranscriberScriptPath(kind: MediaTranscriberKind): string {
  return fileURLToPath(MEDIA_TRANSCRIBER_SCRIPT_URLS[kind]);
}

export async function transcribeStoredMedia(params: {
  kind: MediaTranscriberKind;
  hostAbsolutePath: string;
  prompt?: string;
  execFileImpl?: typeof execFile;
}): Promise<string> {
  const scriptPath = resolveMediaTranscriberScriptPath(params.kind);
  const execFileImpl = params.execFileImpl ?? execFile;
  const args = [scriptPath, params.hostAbsolutePath];

  if (params.prompt) {
    args.push(params.prompt);
  }

  const completedProcess = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFileImpl(
      process.execPath,
      args,
      {
        env: process.env,
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, commandStdout, commandStderr) => {
        if (error) {
          reject(
            new MediaTranscriberError({
              message: error.message,
              scriptPath,
              stderr: commandStderr.trim(),
              exitCode: typeof error.code === "number" ? error.code : null,
            }),
          );
          return;
        }

        resolve({
          stdout: commandStdout,
          stderr: commandStderr,
        });
      },
    );
  });

  const trimmedStdout = completedProcess.stdout.trim();
  if (trimmedStdout.length === 0) {
    throw new MediaTranscriberError({
      message: "Media transcriber returned empty output",
      scriptPath,
      stderr: completedProcess.stderr.trim(),
      exitCode: null,
    });
  }

  return trimmedStdout;
}
