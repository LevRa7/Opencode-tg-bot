import type { ExecFileOptions } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const execFileMock = vi.hoisted(() =>
  vi.fn(
    (
      command: string,
      args: ReadonlyArray<string>,
      options: ExecFileOptions,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      callback(null, "", "");
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

import { stopBotContainers } from "../../src/runtime/docker.js";

const STOP_SCRIPT_PATH = fileURLToPath(new URL("../../docker/stop-opencode-containers.sh", import.meta.url));

describe("runtime/docker", () => {
  it("invokes the stop script through bash with a timeout", async () => {
    await stopBotContainers();

    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(execFileMock).toHaveBeenCalledWith(
      "bash",
      [STOP_SCRIPT_PATH],
      expect.objectContaining({
        env: process.env,
        maxBuffer: 1024 * 1024,
        timeout: 30_000,
        killSignal: "SIGKILL",
      }),
      expect.any(Function),
    );
  });

  it("rejects when the stop script fails", async () => {
    execFileMock.mockImplementationOnce(
      (
        _command: string,
        _args: ReadonlyArray<string>,
        _options: ExecFileOptions,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callback(new Error("boom"), "", "");
        return undefined;
      },
    );

    await expect(stopBotContainers()).rejects.toThrow("boom");
  });
});
