import { beforeEach, describe, expect, it, vi } from "vitest";

// We test the retry logic by importing the helper function that will be extracted.
// Since the function is internal to prompt.ts, we test it through the module.
// For now, we create a standalone test of the retry logic pattern.

describe("bot/handlers/prompt-retry", () => {
  describe("isNetworkError", () => {
    // This helper will be extracted from prompt.ts.
    // Testing the detection logic that determines whether to retry.

    function isNetworkError(error: unknown): boolean {
      const errorText = String(error).toLowerCase();
      return errorText.includes("fetch failed") || errorText.includes("econnrefused");
    }

    it("detects 'fetch failed' as network error", () => {
      expect(isNetworkError(new TypeError("fetch failed"))).toBe(true);
    });

    it("detects 'ECONNREFUSED' as network error", () => {
      expect(isNetworkError(new Error("connect ECONNREFUSED 127.0.0.1:49600"))).toBe(true);
    });

    it("detects 'Fetch Failed' as network error (case-insensitive after toLowerCase)", () => {
      expect(isNetworkError(new Error("Fetch Failed"))).toBe(true);
    });

    it("does not detect API errors as network errors", () => {
      expect(isNetworkError(new Error("session.prompt: invalid session ID"))).toBe(false);
    });

    it("does not detect timeout errors as network errors", () => {
      expect(isNetworkError(new Error("Request timed out"))).toBe(false);
    });

    it("does not detect network error in plain object (not an Error)", () => {
      const err = { message: "TypeError: fetch failed" };
      expect(isNetworkError(err)).toBe(false); // String({message:...}) => "[object Object]"
    });
  });

  describe("retry logic behavior", () => {
    it("retries once on network error when restart succeeds", async () => {
      const ensureRuntime = vi.fn().mockResolvedValue({ success: true });
      const sessionPrompt = vi.fn()
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValueOnce({ error: null });

      let callCount = 0;
      const executePrompt = async () => {
        callCount++;
        return sessionPrompt();
      };

      // Simulate the retry flow
      let finalError: unknown = null;
      try {
        await executePrompt();
      } catch (error) {
        if (isNetworkError(error)) {
          const restartResult = await ensureRuntime();
          if (restartResult.success) {
            try {
              await executePrompt();
              // Succeeded on retry
            } catch (retryError) {
              finalError = retryError;
            }
          }
        } else {
          finalError = error;
        }
      }

      expect(callCount).toBe(2);
      expect(ensureRuntime).toHaveBeenCalledTimes(1);
      expect(finalError).toBeNull();
    });

    it("reports error when restart fails", async () => {
      const ensureRuntime = vi.fn().mockResolvedValue({ success: false, error: "port in use" });
      const sessionPrompt = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

      let finalError: unknown = null;
      try {
        await sessionPrompt();
      } catch (error) {
        if (isNetworkError(error)) {
          const restartResult = await ensureRuntime();
          if (!restartResult.success) {
            finalError = error; // Original error preserved
          }
        } else {
          finalError = error;
        }
      }

      expect(ensureRuntime).toHaveBeenCalledTimes(1);
      expect(finalError).toBeInstanceOf(TypeError);
    });

    it("reports error when retry also fails", async () => {
      const ensureRuntime = vi.fn().mockResolvedValue({ success: true });
      const sessionPrompt = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

      let finalError: unknown = null;
      try {
        await sessionPrompt();
      } catch (error) {
        if (isNetworkError(error)) {
          const restartResult = await ensureRuntime();
          if (restartResult.success) {
            try {
              await sessionPrompt();
            } catch (retryError) {
              finalError = retryError;
            }
          }
        } else {
          finalError = error;
        }
      }

      expect(sessionPrompt).toHaveBeenCalledTimes(2);
      expect(finalError).toBeInstanceOf(TypeError);
    });

    it("does not retry for non-network errors", async () => {
      const ensureRuntime = vi.fn();
      const sessionPrompt = vi.fn().mockRejectedValue(new Error("invalid session ID"));

      let finalError: unknown = null;
      let retried = false;
      try {
        await sessionPrompt();
      } catch (error) {
        if (isNetworkError(error)) {
          retried = true;
          const restartResult = await ensureRuntime();
          if (restartResult.success) {
            try {
              await sessionPrompt();
            } catch {
              // ignored
            }
          }
        } else {
          finalError = error;
        }
      }

      expect(sessionPrompt).toHaveBeenCalledTimes(1);
      expect(ensureRuntime).not.toHaveBeenCalled();
      expect(retried).toBe(false);
      expect(finalError).toBeInstanceOf(Error);
    });
  });

  describe("timeout wrapping", () => {
    it("rejects with timeout error when prompt exceeds 60s", async () => {
      const timeoutMs = 60_000;
      const slowPrompt = new Promise((resolve) => {
        setTimeout(resolve, 120_000); // Would take 2 minutes
      });

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`session.prompt timed out after ${timeoutMs}ms`)), timeoutMs);
      });

      // Use a shorter timeout for the test
      const testTimeoutMs = 50;
      const testSlowPrompt = new Promise((resolve) => {
        setTimeout(resolve, 200);
      });
      const testTimeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`session.prompt timed out after ${testTimeoutMs}ms`)), testTimeoutMs);
      });

      await expect(Promise.race([testSlowPrompt, testTimeoutPromise])).rejects.toThrow(
        "session.prompt timed out",
      );
    });

    it("resolves normally when prompt completes within timeout", async () => {
      const fastPrompt = Promise.resolve({ error: null });
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("timed out")), 60_000);
      });

      const result = await Promise.race([fastPrompt, timeoutPromise]);
      expect(result).toEqual({ error: null });
    });
  });
});

function isNetworkError(error: unknown): boolean {
  const errorText = String(error).toLowerCase();
  return errorText.includes("fetch failed") || errorText.includes("econnrefused");
}
