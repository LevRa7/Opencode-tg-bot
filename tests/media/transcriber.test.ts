import type { ExecFileOptions } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const execFileMock = vi.hoisted(() =>
  vi.fn(
    (
      _command: string,
      _args: ReadonlyArray<string>,
      _options: ExecFileOptions,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      callback(null, "ok", "");
      return undefined;
    },
  ),
);

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFile: execFileMock,
  };
});

import {
  MediaTranscriberError,
  resolveMediaTranscriberScriptPath,
  transcribeStoredMedia,
} from "../../src/media/transcriber.js";

const PHOTO_SCRIPT_PATH = fileURLToPath(
  new URL("../../skills/openai-media-transcriber/scripts/photo.mjs", import.meta.url),
);

describe("media/transcriber", () => {
  it("resolves the photo transcriber script path", () => {
    expect(resolveMediaTranscriberScriptPath("photo")).toBe(PHOTO_SCRIPT_PATH);
  });

  it("trims stdout and invokes process.execPath with the stored media path and prompt", async () => {
    execFileMock.mockImplementationOnce(
      (
        command: string,
        args: ReadonlyArray<string>,
        options: ExecFileOptions,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        expect(command).toBe(process.execPath);
        expect(args).toEqual([PHOTO_SCRIPT_PATH, "/host/media/photo.png", "describe this image"]);
        expect(options).toMatchObject({
          env: process.env,
          maxBuffer: 10 * 1024 * 1024,
        });
        callback(null, "  transcribed output\n", "");
        return undefined;
      },
    );

    await expect(
      transcribeStoredMedia({
        kind: "photo",
        hostAbsolutePath: "/host/media/photo.png",
        prompt: "describe this image",
      }),
    ).resolves.toBe("transcribed output");
  });

  it("normalizes process failures into MediaTranscriberError", async () => {
    const processError = Object.assign(new Error("command failed"), { code: 23 });
    execFileMock.mockImplementationOnce(
      (
        _command: string,
        _args: ReadonlyArray<string>,
        _options: ExecFileOptions,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callback(processError, "", "  transcriber stderr  ");
        return undefined;
      },
    );

    await expect(
      transcribeStoredMedia({
        kind: "photo",
        hostAbsolutePath: "/host/media/photo.png",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<MediaTranscriberError>>({
        name: "MediaTranscriberError",
        message: "command failed",
        scriptPath: PHOTO_SCRIPT_PATH,
        stderr: "transcriber stderr",
        exitCode: 23,
      }),
    );
  });

  it("treats empty stdout as a transcriber failure", async () => {
    execFileMock.mockImplementationOnce(
      (
        _command: string,
        _args: ReadonlyArray<string>,
        _options: ExecFileOptions,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callback(null, "  \n", "  no text generated  ");
        return undefined;
      },
    );

    await expect(
      transcribeStoredMedia({
        kind: "photo",
        hostAbsolutePath: "/host/media/photo.png",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<MediaTranscriberError>>({
        name: "MediaTranscriberError",
        message: "Media transcriber returned empty output",
        scriptPath: PHOTO_SCRIPT_PATH,
        stderr: "no text generated",
        exitCode: null,
      }),
    );
  });
});
