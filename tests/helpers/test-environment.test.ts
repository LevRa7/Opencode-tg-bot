import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureTestEnvironment } from "./test-environment.js";

describe("tests/helpers/test-environment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sets BOT_LOCALE to en when the environment leaves it empty", () => {
    vi.stubEnv("BOT_LOCALE", "");

    ensureTestEnvironment();

    expect(process.env.BOT_LOCALE).toBe("en");
  });

  it("resets inherited BOT_LOCALE to en for deterministic test runs", () => {
    vi.stubEnv("BOT_LOCALE", "ru");

    ensureTestEnvironment();

    expect(process.env.BOT_LOCALE).toBe("en");
  });
});
