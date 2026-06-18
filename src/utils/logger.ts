import fs from "node:fs";
import path from "node:path";
import fsPromises from "node:fs/promises";
import { getRuntimeMode, type RuntimeMode } from "../runtime/mode.js";
import { getRuntimePaths } from "../runtime/paths.js";
import { config } from "../config.js";

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let logStream: fs.WriteStream | null = null;
let logFilePath: string | null = null;
let initializePromise: Promise<void> | null = null;
let cleanupPromise: Promise<void> | null = null;
let streamErrorReported = false;

function normalizeLogLevel(value: string): LogLevel {
  if (value in LOG_LEVELS) {
    return value as LogLevel;
  }

  return "info";
}

function formatPrefix(level: LogLevel): string {
  return `[${new Date().toISOString()}] [${level.toUpperCase()}]`;
}

function formatArg(arg: unknown): unknown {
  if (arg instanceof Error) {
    return arg.stack ?? `${arg.name}: ${arg.message}`;
  }

  return arg;
}

function withPrefix(level: LogLevel, args: unknown[]): unknown[] {
  const formattedArgs = args.map((arg) => formatArg(arg));
  const prefix = formatPrefix(level);

  if (formattedArgs.length === 0) {
    return [prefix];
  }

  if (typeof formattedArgs[0] === "string") {
    return [`${prefix} ${formattedArgs[0]}`, ...formattedArgs.slice(1)];
  }

  return [prefix, ...formattedArgs];
}

function shouldLog(level: LogLevel): boolean {
  const configLevel = normalizeLogLevel(config.server.logLevel);
  return LOG_LEVELS[level] >= LOG_LEVELS[configLevel];
}

function getInstalledLogFileName(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `bot-${year}-${month}-${day}.log`;
}

function getSourcesLogFileName(): string {
  return "bot.log";
}

function getLogFileName(mode: RuntimeMode): string {
  return mode === "installed" ? getInstalledLogFileName() : getSourcesLogFileName();
}

function getLogFilePathForMode(logsDirPath: string, mode: RuntimeMode): string {
  return path.join(logsDirPath, getLogFileName(mode));
}

function getLogFilePattern(mode: RuntimeMode): RegExp {
  if (mode === "installed") {
    return /^bot-\d{4}-\d{2}-\d{2}\.log$/;
  }

  return /^bot\.log$/;
}

function closeLogStream(): void {
  if (logStream) {
    try {
      logStream.close();
    } catch {
      // ignore close errors
    }

    logStream = null;
  }
}

function handleLogStreamError(error: unknown): void {
  if (streamErrorReported) {
    return;
  }

  streamErrorReported = true;
  reportLoggerInternalError("File logging stream error.", error);
  closeLogStream();
  logFilePath = null;
}

function reportLoggerInternalError(message: string, error: unknown): void {
  try {
    console.error(formatPrefix("error"), message, formatArg(error));
  } catch {
    // fail-safe: raw console
  }
}

function ensureLogStream(targetFilePath: string): void {
  if (logStream && logFilePath === targetFilePath) {
    return;
  }

  closeLogStream();
  logFilePath = targetFilePath;

  try {
    logStream = fs.createWriteStream(targetFilePath, { flags: "a" });
    logStream.on("error", (error) => {
      handleLogStreamError(error);
    });
    streamErrorReported = false;
  } catch (error) {
    reportLoggerInternalError(`Failed to open log file: ${targetFilePath}.`, error);
    logFilePath = null;
  }
}

async function cleanupOldLogs(logsDirPath: string, mode: RuntimeMode): Promise<void> {
  const retention = config.bot.logRetention;
  if (retention <= 0) {
    return;
  }

  const logFilePattern = getLogFilePattern(mode);
  const cutoffDate = Date.now() - retention * 24 * 60 * 60 * 1000;

  let entries: string[];
  try {
    entries = await fsPromises.readdir(logsDirPath);
  } catch {
    return;
  }

  const deletePromises = entries
    .filter((entry) => logFilePattern.test(entry))
    .filter((entry) => {
      if (mode !== "installed") {
        return false;
      }

      const match = entry.match(/^bot-(\d{4}-\d{2}-\d{2})\.log$/);
      if (!match) {
        return false;
      }

      const fileDateMs = Date.parse(match[1]);
      return !Number.isNaN(fileDateMs) && fileDateMs < cutoffDate;
    })
    .map((entry) =>
      fsPromises.rm(path.join(logsDirPath, entry), { force: true }).catch(() => {
        // ignore individual delete failures
      }),
    );

  await Promise.all(deletePromises);
}

function cleanupOldLogsInBackground(logsDirPath: string, mode: RuntimeMode): void {
  if (cleanupPromise) {
    return;
  }

  cleanupPromise = cleanupOldLogs(logsDirPath, mode)
    .catch((error) => {
      reportLoggerInternalError(`Failed to clean up old logs in ${logsDirPath}.`, error);
    })
    .finally(() => {
      cleanupPromise = null;
    });
}

function rotateInstalledLogIfNeeded(): void {
  const mode = getRuntimeMode();
  if (mode !== "installed" || !logFilePath) {
    return;
  }

  const runtimePaths = getRuntimePaths();
  const nextLogFilePath = getLogFilePathForMode(runtimePaths.logsDirPath, mode);
  if (logFilePath === nextLogFilePath) {
    return;
  }

  try {
    fs.mkdirSync(runtimePaths.logsDirPath, { recursive: true });
    fs.appendFileSync(nextLogFilePath, "");
    ensureLogStream(nextLogFilePath);
    cleanupOldLogsInBackground(runtimePaths.logsDirPath, mode);
  } catch (error) {
    reportLoggerInternalError(`Failed to rotate file logging to ${nextLogFilePath}.`, error);
    closeLogStream();
    logFilePath = null;
  }
}

function writeToFile(line: string): void {
  if (!logStream) {
    return;
  }

  try {
    rotateInstalledLogIfNeeded();
    if (!logStream) {
      return;
    }

    logStream.write(`${line}\n`);
  } catch (error) {
    handleLogStreamError(error);
  }
}

function writeToConsole(level: LogLevel, args: unknown[]): void {
  const prefixedArgs = withPrefix(level, args);

  if (level === "error") {
    console.error(...prefixedArgs);
  } else if (level === "warn") {
    console.warn(...prefixedArgs);
  } else {
    console.log(...prefixedArgs);
  }
}

async function initializeLoggerInternal(): Promise<void> {
  const mode = getRuntimeMode();
  const runtimePaths = getRuntimePaths();

  try {
    await fsPromises.mkdir(runtimePaths.logsDirPath, { recursive: true });
    const nextLogFilePath = getLogFilePathForMode(runtimePaths.logsDirPath, mode);
    await fsPromises.appendFile(nextLogFilePath, "");
    ensureLogStream(nextLogFilePath);
    await cleanupOldLogs(runtimePaths.logsDirPath, mode);
  } catch (error) {
    reportLoggerInternalError("Failed to initialise file logging.", error);
  }
}

export function getLogFilePath(): string | null {
  return logFilePath;
}

export async function __flushLoggerForTests(): Promise<void> {
  if (cleanupPromise) {
    await cleanupPromise;
  }

  if (!logStream) {
    return;
  }

  return new Promise<void>((resolve, reject) => {
    logStream!.write("", (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export function __resetLoggerForTests(): void {
  initializePromise = null;
  cleanupPromise = null;
  logFilePath = null;
  streamErrorReported = false;
  closeLogStream();
}

function log(level: LogLevel, args: unknown[]): void {
  if (!shouldLog(level)) {
    return;
  }

  writeToConsole(level, args);

  if (logStream) {
    const line = withPrefix(level, args)
      .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
      .join(" ");
    writeToFile(line);
  }
}

export const logger = {
  debug: (...args: unknown[]): void => {
    log("debug", args);
  },

  info: (...args: unknown[]): void => {
    log("info", args);
  },

  warn: (...args: unknown[]): void => {
    log("warn", args);
  },

  error: (...args: unknown[]): void => {
    log("error", args);
  },
};

export async function initializeLogger(): Promise<void> {
  if (initializePromise && logStream) {
    await initializePromise;
    return;
  }

  initializePromise = initializeLoggerInternal().catch((error) => {
    reportLoggerInternalError("Logger initialization failed.", error);
  });

  await initializePromise;
}
