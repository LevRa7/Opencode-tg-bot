import { spawn, type ChildProcess } from "child_process";

const DEFAULT_RESTART_DELAY_MS = 750;

export interface RestartCurrentProcessOptions {
  delayMs?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  argv?: string[];
  execArgv?: string[];
  execPath?: string;
  spawnProcess?: typeof spawn;
  exitProcess?: (code: number) => never;
}

function buildRestartWrapperScript(): string {
  return [
    "const { spawn } = require('node:child_process');",
    "const delayMs = Number(process.argv[1]);",
    "const execPath = process.argv[2];",
    "const cwd = process.argv[3];",
    "const args = JSON.parse(process.argv[4]);",
    "setTimeout(() => {",
    "  const child = spawn(execPath, args, {",
    "    cwd,",
    "    env: process.env,",
    "    detached: true,",
    "    stdio: 'ignore',",
    "    windowsHide: true,",
    "  });",
    "  child.unref();",
    "}, delayMs);",
  ].join(" ");
}

export function restartCurrentProcess(options: RestartCurrentProcessOptions = {}): never {
  const execPath = options.execPath ?? process.execPath;
  const execArgv = options.execArgv ?? process.execArgv;
  const argv = options.argv ?? process.argv;
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const delayMs = options.delayMs ?? DEFAULT_RESTART_DELAY_MS;
  const spawnProcess = options.spawnProcess ?? spawn;
  const exitProcess = options.exitProcess ?? process.exit;

  if (argv.length < 2) {
    throw new Error("Cannot restart process without an entry script.");
  }

  const resumedArgs = [...execArgv, ...argv.slice(1)];
  const wrapperProcess = spawnProcess(
    execPath,
    ["-e", buildRestartWrapperScript(), String(delayMs), execPath, cwd, JSON.stringify(resumedArgs)],
    {
      cwd,
      env,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    },
  ) as ChildProcess;

  wrapperProcess.unref();
  return exitProcess(0);
}
