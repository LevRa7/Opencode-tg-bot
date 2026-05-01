import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { setRuntimeMode } from "../../src/runtime/mode.js";

vi.mock("../../src/config.js", () => ({
  config: {
    server: {
      logLevel: "info",
    },
    bot: {
      logRetention: 2,
    },
  },
}));

async function createTempHome(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "logger-test-"));
}

async function loadLoggerModule() {
  return import("../../src/utils/logger.js");
}

function getLoggerFunctions() {
  const { logger } = globalThis as unknown as {
    logger: {
      debug: (...args: unknown[]) => void;
      info: (...args: unknown[]) => void;
      warn: (...args: unknown[]) => void;
      error: (...args: unknown[]) => void;
    };
  };
  return { logger };
}

describe("utils/logger", () => {
  beforeEach(() => {
    vi.stubEnv("LOG_LEVEL", "debug");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("rotates installed mode logs when the date changes", async () => {
    const tempHome = await createTempHome();
    const logsDirPath = path.join(tempHome, "logs");

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-11T23:59:59.000Z"));
    vi.stubEnv("LOG_LEVEL", "info");
    vi.stubEnv("LOG_RETENTION", "10");
    vi.stubEnv("OPENCODE_TELEGRAM_HOME", tempHome);
    setRuntimeMode("installed");

    const {
      initializeLogger,
      logger,
      getLogFilePath,
      __flushLoggerForTests,
      __resetLoggerForTests,
    } = await loadLoggerModule();

    await initializeLogger();
    logger.info("before midnight");
    await __flushLoggerForTests();

    const firstPath = path.join(logsDirPath, "bot-2026-04-11.log");
    expect(getLogFilePath()).toBe(firstPath);

    vi.setSystemTime(new Date("2026-04-12T00:00:01.000Z"));
    logger.info("after midnight");
    logger.warn("same new day");
    await __flushLoggerForTests();

    const secondPath = path.join(logsDirPath, "bot-2026-04-12.log");
    expect(getLogFilePath()).toBe(secondPath);

    const firstContent = await fs.readFile(firstPath, "utf-8");
    const secondContent = await fs.readFile(secondPath, "utf-8");
    const logFiles = (await fs.readdir(logsDirPath)).sort();

    expect(firstContent).toContain("[INFO] before midnight");
    expect(firstContent).not.toContain("after midnight");
    expect(secondContent).toContain("[INFO] after midnight");
    expect(secondContent).toContain("[WARN] same new day");
    expect(logFiles).toEqual(["bot-2026-04-11.log", "bot-2026-04-12.log"]);

    __resetLoggerForTests();
    await fs.rm(tempHome, { recursive: true, force: true });
  });

  it("cleans up old installed logs after date rotation", async () => {
    const tempHome = await createTempHome();
    const logsDirPath = path.join(tempHome, "logs");

    await fs.mkdir(logsDirPath, { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(logsDirPath, "bot-2026-04-09.log"), "old\n"),
      fs.writeFile(path.join(logsDirPath, "bot-2026-04-10.log"), "old\n"),
      fs.writeFile(path.join(logsDirPath, "notes.txt"), "keep\n"),
    ]);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-11T23:59:59.000Z"));
    vi.stubEnv("LOG_LEVEL", "info");
    vi.stubEnv("LOG_RETENTION", "2");
    vi.stubEnv("OPENCODE_TELEGRAM_HOME", tempHome);
    setRuntimeMode("installed");

    const { initializeLogger, logger, __flushLoggerForTests, __resetLoggerForTests } =
      await loadLoggerModule();

    await initializeLogger();
    logger.info("before midnight");
    await __flushLoggerForTests();

    vi.setSystemTime(new Date("2026-04-12T00:00:01.000Z"));
    logger.info("after midnight");
    await __flushLoggerForTests();

    const remainingFiles = (await fs.readdir(logsDirPath)).sort();
    expect(remainingFiles).toEqual(["bot-2026-04-11.log", "bot-2026-04-12.log", "notes.txt"]);

    __resetLoggerForTests();
    await fs.rm(tempHome, { recursive: true, force: true });
  });
});
