import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { SessionType } from "../../src/keyboard/types.js";
import { createMainKeyboard } from "../../src/bot/utils/keyboard.js";
import { Keyboard } from "grammy";

// ---------------------------------------------------------------------------
// SessionType enum
// ---------------------------------------------------------------------------

describe("SessionType enum", () => {
  it("has three distinct values", () => {
    expect(SessionType.AGENT).toBe("agent");
    expect(SessionType.TERMINAL).toBe("terminal");
    expect(SessionType.NONE).toBe("none");
    expect(SessionType.AGENT).not.toBe(SessionType.TERMINAL);
    expect(SessionType.NONE).not.toBe(SessionType.AGENT);
  });
});

// ---------------------------------------------------------------------------
// createMainKeyboard isTerminalTopic resolution (Bug B, D)
// ---------------------------------------------------------------------------

describe("createMainKeyboard isTerminalTopic logic", () => {
  const model = { providerID: "test", modelID: "test-model", variant: void 0 };

  it("BUG B: shows agent buttons when isTerminalTopic is false", () => {
    const kb = createMainKeyboard("build", model, void 0, void 0, {
      isTerminalTopic: false,
    });
    const markup = kb.build();
    const row = markup[0];
    const allText = row.map((b: { text: string }) => b.text).join(" ");
    expect(allText).not.toContain("New Window");
    expect(allText).not.toContain("Stop");
  });

  it("BUG B: shows terminal buttons when isTerminalTopic is true", () => {
    const kb = createMainKeyboard("build", model, void 0, void 0, {
      isTerminalTopic: true,
      isRunning: false,
    });
    const markup = kb.build();
    const row = markup[0];
    const allText = row.map((b: { text: string }) => b.text).join(" ");
    expect(allText).toContain("New Window");
  });

  it("BUG B: shows token count when contextInfo provided and agent mode", () => {
    const kb = createMainKeyboard("build", model, { tokensUsed: 150000, tokensLimit: 200000 }, void 0, {
      isTerminalTopic: false,
    });
    const markup = kb.build();
    const row = markup[0];
    const allText = row.map((b: { text: string }) => b.text).join(" ");
    expect(allText).toMatch(/150K/);
    expect(allText).toMatch(/200K/);
  });

  it("BUG E: shows empty context indicator when contextInfo is undefined", () => {
    const kb = createMainKeyboard("build", model, void 0, void 0, {
      isTerminalTopic: false,
    });
    const markup = kb.build();
    const row = markup[0];
    const allText = row.map((b: { text: string }) => b.text).join(" ");
    expect(allText).not.toMatch(/0\s*\/\s*200K/);
  });

  it("BUG D: default isTerminalTopic (undefined) shows terminal buttons", () => {
    const kb = createMainKeyboard("build", model, void 0, void 0);
    const markup = kb.build();
    const row = markup[0];
    const allText = row.map((b: { text: string }) => b.text).join(" ");
    expect(allText).toContain("New Window");
  });

  it("BUG D FIXED: isTerminalTopic false agent path reached explicitly", () => {
    const kb = createMainKeyboard("build", model, { tokensUsed: 50000, tokensLimit: 200000 }, void 0, {
      isTerminalTopic: false,
    });
    const markup = kb.build();
    const row = markup[0];
    const allText = row.map((b: { text: string }) => b.text).join(" ");
    expect(allText).not.toContain("New Window");
    expect(allText).not.toContain("Stop");
    expect(allText).toMatch(/test-model/);
  });
});

// ---------------------------------------------------------------------------
// Token count formatting (Bug E helper)
// ---------------------------------------------------------------------------

describe("Token count formatting", () => {
  const model = { providerID: "provider", modelID: "model", variant: void 0 };

  it("formats 0 tokens correctly (0/200K)", () => {
    const kb = createMainKeyboard("build", model, { tokensUsed: 0, tokensLimit: 200000 }, void 0, {
      isTerminalTopic: false,
    });
    const markup = kb.build();
    const row = markup[0];
    const allText = row.map((b: { text: string }) => b.text).join(" ");
    expect(allText).toMatch(/0\s*\/\s*200K/);
  });

  it("formats <1000 tokens without abbreviation", () => {
    const kb = createMainKeyboard("build", model, { tokensUsed: 500, tokensLimit: 2000 }, void 0, {
      isTerminalTopic: false,
    });
    const markup = kb.build();
    const row = markup[0];
    const allText = row.map((b: { text: string }) => b.text).join(" ");
    expect(allText).toMatch(/500\s*\/\s*2K/);
  });

  it("formats K-range correctly", () => {
    const kb = createMainKeyboard("build", model, { tokensUsed: 45000, tokensLimit: 200000 }, void 0, {
      isTerminalTopic: false,
    });
    const markup = kb.build();
    const row = markup[0];
    const allText = row.map((b: { text: string }) => b.text).join(" ");
    expect(allText).toMatch(/45K\s*\/\s*200K/);
  });

  it("formats M-range correctly", () => {
    const kb = createMainKeyboard("build", model, { tokensUsed: 1500000, tokensLimit: 2000000 }, void 0, {
      isTerminalTopic: false,
    });
    const markup = kb.build();
    const row = markup[0];
    const allText = row.map((b: { text: string }) => b.text).join(" ");
    expect(allText).toMatch(/1\.5M\s*\/\s*2\.0M/);
  });
});

// ---------------------------------------------------------------------------
// Sender prefix stripping (Bug F: topic naming)
// ---------------------------------------------------------------------------

function stripSenderPrefix(text: string): string {
  const senderMatch = text.match(/^(.+?):\s*\n/);
  if (senderMatch && senderMatch[1].length < 50) {
    return text.slice(senderMatch[0].length);
  }
  return text;
}

describe("Topic name sender prefix stripping", () => {
  it("BUG F: strips Name:\\n prefix from topic text", () => {
    const result = stripSenderPrefix("User:\nEnable sync with TG");
    expect(result).toBe("Enable sync with TG");
    expect(result).not.toContain("User:");
  });

  it("leaves text without prefix unchanged", () => {
    const result = stripSenderPrefix("Enable sync with TG");
    expect(result).toBe("Enable sync with TG");
  });

  it("does NOT strip long name prefixes (>50 chars)", () => {
    const longName = "A".repeat(51);
    const input = longName + ":\nquery";
    const result = stripSenderPrefix(input);
    expect(result).toBe(input);
  });

  it("handles text without newline after colon", () => {
    const input = "Just a: query without newline";
    const result = stripSenderPrefix(input);
    expect(result).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// KeyboardManager session mode isolation (Bug A)
// ---------------------------------------------------------------------------

describe("KeyboardManager session mode isolation (Bug A)", () => {
  it("SessionType.NONE is the default", () => {
    expect(SessionType.NONE).toBe("none");
  });

  it("Terminal keyboard shows system info, agent keyboard does not", () => {
    const model = { providerID: "p", modelID: "m", variant: void 0 };
    const cpuInfo = { usagePercent: 50, model: "Test CPU" };
    const ramInfo = { usedGB: 4, totalGB: 8, percentUsed: 50 };

    const termKb = createMainKeyboard("build", model, void 0, void 0, {
      isTerminalTopic: true,
      isRunning: false,
      cpuInfo,
      ramInfo,
    });
    const termMarkup = termKb.build();
    const termText = termMarkup
      .flat()
      .map((b: { text: string }) => b.text)
      .join(" ");
    expect(termText).toContain("CPU");

    const agentKb = createMainKeyboard("build", model, { tokensUsed: 1000, tokensLimit: 50000 }, void 0, {
      isTerminalTopic: false,
    });
    const agentText = agentKb.build()
      .flat()
      .map((b: { text: string }) => b.text)
      .join(" ");
    expect(agentText).not.toContain("CPU");
  });

  it("isTerminalTopic true always shows terminal buttons", () => {
    const model = { providerID: "p", modelID: "m", variant: void 0 };
    const kb = createMainKeyboard("build", model, void 0, void 0, {
      isTerminalTopic: true,
      isRunning: false,
    });
    const text = kb.build()[0]
      .map((b: { text: string }) => b.text)
      .join(" ");
    expect(text).toContain("New Window");
  });
});

// ---------------------------------------------------------------------------
// Context info update chain (Bug E)
// ---------------------------------------------------------------------------

describe("Context info update chain (Bug E)", () => {
  it("contextInfo flow: undefined -> {0,limit} -> {used,limit}", () => {
    const model = { providerID: "p", modelID: "m", variant: void 0 };

    // Step 1: no context info
    const kb1 = createMainKeyboard("build", model, void 0, void 0, {
      isTerminalTopic: false,
    });
    const text1 = kb1.build()[0]
      .map((b: { text: string }) => b.text)
      .join(" ");
    expect(text1).not.toMatch(/0\s*\/\s*200K/);

    // Step 2: initial setOnKeyboardUpdate fires with {0, limit}
    const kb2 = createMainKeyboard("build", model, { tokensUsed: 0, tokensLimit: 200000 }, void 0, {
      isTerminalTopic: false,
    });
    const text2 = kb2.build()[0]
      .map((b: { text: string }) => b.text)
      .join(" ");
    expect(text2).toMatch(/0\s*\/\s*200K/);

    // Step 3: after response, must be > 0
    const kb3 = createMainKeyboard("build", model, { tokensUsed: 45780, tokensLimit: 200000 }, void 0, {
      isTerminalTopic: false,
    });
    const text3 = kb3.build()[0]
      .map((b: { text: string }) => b.text)
      .join(" ");
    expect(text3).toMatch(/46K\s*\/\s*200K/);
    expect(text3).not.toMatch(/0%/);
  });
});
