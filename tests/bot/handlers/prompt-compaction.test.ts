import { describe, expect, it, vi } from "vitest";
import type { FilePartInput } from "@opencode-ai/sdk/v2";
import {
  maybeAutoCompactBeforePrompt,
  shouldAutoCompactBeforePrompt,
} from "../../../src/bot/handlers/prompt.js";

const processedMediaPrompt =
  "Telegram media was already processed locally.\n\nUse only the processed result below as the source of truth. Do not try to reopen, locate, inspect, or transcribe the original file again.\n\nProcessed media result:\nvideo transcript";

describe("bot/handlers/prompt media compaction", () => {
  it("triggers auto-compaction for processed media prompts when context usage is at least 95%", () => {
    expect(
      shouldAutoCompactBeforePrompt({
        text: processedMediaPrompt,
        fileParts: [],
        contextInfo: { tokensUsed: 394_000, tokensLimit: 400_000 },
      }),
    ).toBe(true);
  });

  it("does not auto-compact for processed media prompts when context usage is below threshold", () => {
    expect(
      shouldAutoCompactBeforePrompt({
        text: processedMediaPrompt,
        fileParts: [],
        contextInfo: { tokensUsed: 200_000, tokensLimit: 400_000 },
      }),
    ).toBe(false);
  });

  it("does not auto-compact when file attachments are still present", () => {
    const fileParts: FilePartInput[] = [
      {
        type: "file",
        mime: "video/mp4",
        filename: "clip.mp4",
        url: "data:video/mp4;base64,AAAA",
      },
    ];

    expect(
      shouldAutoCompactBeforePrompt({
        text: processedMediaPrompt,
        fileParts,
        contextInfo: { tokensUsed: 394_000, tokensLimit: 400_000 },
      }),
    ).toBe(false);
  });

  it("calls session.summarize before prompt dispatch when guard matches", async () => {
    const summarizeSession = vi.fn().mockResolvedValue({ error: undefined });

    const compacted = await maybeAutoCompactBeforePrompt({
      text: processedMediaPrompt,
      fileParts: [],
      contextInfo: { tokensUsed: 394_000, tokensLimit: 400_000 },
      session: { id: "session-1", directory: "/repo" },
      storedModel: { providerID: "cliproxyapi", modelID: "gpt-5.4-mini", variant: "default" },
      summarizeSession,
    });

    expect(compacted).toBe(true);
    expect(summarizeSession).toHaveBeenCalledWith({
      sessionID: "session-1",
      directory: "/repo",
      providerID: "cliproxyapi",
      modelID: "gpt-5.4-mini",
    });
  });

  it("continues without compaction when summarize reports an error", async () => {
    const summarizeSession = vi.fn().mockResolvedValue({ error: new Error("empty_stream") });

    const compacted = await maybeAutoCompactBeforePrompt({
      text: processedMediaPrompt,
      fileParts: [],
      contextInfo: { tokensUsed: 394_000, tokensLimit: 400_000 },
      session: { id: "session-1", directory: "/repo" },
      storedModel: { providerID: "cliproxyapi", modelID: "gpt-5.4-mini", variant: "default" },
      summarizeSession,
    });

    expect(compacted).toBe(false);
    expect(summarizeSession).toHaveBeenCalledTimes(1);
  });
});
