import type { ChildProcess } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { restartCurrentProcess } from "../../src/runtime/restart.js";

function createChildProcess(): ChildProcess {
  return {
    unref: vi.fn(),
  } as unknown as ChildProcess;
}

describe("runtime/restart", () => {
  it("spawns detached wrapper and exits current process", () => {
    const wrapperProcess = createChildProcess();
    const spawnProcess = vi.fn(() => wrapperProcess);
    const exitProcess = vi.fn(() => {
      throw new Error("EXIT");
    }) as unknown as (code: number) => never;

    expect(() =>
      restartCurrentProcess({
        delayMs: 500,
        cwd: "/app",
        env: { TEST_ENV: "1" },
        argv: ["/usr/bin/node", "/app/dist/cli.js", "start"],
        execArgv: ["--trace-warnings"],
        execPath: "/usr/bin/node",
        spawnProcess,
        exitProcess,
      }),
    ).toThrow("EXIT");

    expect(spawnProcess).toHaveBeenCalledWith(
      "/usr/bin/node",
      [
        "--input-type=commonjs",
        "-e",
        expect.stringContaining("node:child_process"),
        "500",
        "/usr/bin/node",
        "/app",
        JSON.stringify(["--trace-warnings", "/app/dist/cli.js", "start"]),
      ],
      {
        cwd: "/app",
        env: { TEST_ENV: "1", NODE_OPTIONS: undefined },
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      },
    );
    expect(wrapperProcess.unref).toHaveBeenCalledTimes(1);
    expect(exitProcess).toHaveBeenCalledWith(0);
  });

  it("throws when entry script is missing", () => {
    expect(() =>
      restartCurrentProcess({
        argv: ["/usr/bin/node"],
        spawnProcess: vi.fn(),
        exitProcess: vi.fn(() => {
          throw new Error("EXIT");
        }) as unknown as (code: number) => never,
      }),
    ).toThrow("Cannot restart process without an entry script.");
  });

  it("exits directly with code 0 without spawning a wrapper when INVOCATION_ID is set", () => {
    const spawnProcess = vi.fn();
    const exitProcess = vi.fn(() => {
      throw new Error("EXIT");
    }) as unknown as (code: number) => never;

    const originalInvocationId = process.env.INVOCATION_ID;
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.INVOCATION_ID = "test-invocation-id";
    // Temporarily delete NODE_ENV to simulate non-test environment
    delete process.env.NODE_ENV;

    try {
      expect(() =>
        restartCurrentProcess({
          argv: ["/usr/bin/node", "index.js"],
          spawnProcess,
          exitProcess,
        }),
      ).toThrow("EXIT");

      expect(spawnProcess).not.toHaveBeenCalled();
      expect(exitProcess).toHaveBeenCalledWith(0);
    } finally {
      process.env.INVOCATION_ID = originalInvocationId;
      process.env.NODE_ENV = originalNodeEnv;
    }
  });
});
