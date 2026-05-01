import { afterEach, describe, expect, it } from "vitest";
import { renderSubagentCards } from "../../src/summary/subagent-formatter.js";
import { resetRuntimeLocale, setRuntimeLocale } from "../../src/i18n/index.js";

describe("summary/subagent-formatter", () => {
  afterEach(() => {
    resetRuntimeLocale();
  });

  it("renders subagent cards with input-derived tool details in the card body", async () => {
    setRuntimeLocale("en");

    const text = await renderSubagentCards([
      {
        cardId: "card-1",
        sessionId: "child-1",
        parentSessionId: "root-1",
        agent: "explore",
        description: "task description",
        prompt: "task description",
        status: "running",
        providerID: "openai",
        modelID: "gpt-5.4",
        tokens: {
          input: 54000,
          output: 10,
          reasoning: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        cost: 0.18,
        currentTool: "read",
        currentToolInput: {
          filePath: "src/pinned/manager.ts",
          offset: 1,
          limit: 280,
        },
        currentToolTitle: "Reading pinned manager",
        updatedAt: Date.now(),
      },
    ]);

    expect(text.startsWith("<blockquote>")).toBe(true);
    expect(text.endsWith("</blockquote>")).toBe(true);
    expect(text).toContain("🧩 Task: task description");
    expect(text).toContain("Agent: explore");
    expect(text).toContain("Model: openai/gpt-5.4");
    expect(text).not.toContain("Context:");
    expect(text).not.toContain("Cost:");
    expect(text).toContain('📖 &quot;read&quot; `src/pinned/manager.ts`');
    expect(text).not.toContain("Reading pinned manager");
    expect(text).not.toContain("Working:");
  });

  it("localizes labels and shows terminal completion state", async () => {
    setRuntimeLocale("ru");

    const text = await renderSubagentCards([
      {
        cardId: "card-1",
        sessionId: "child-1",
        parentSessionId: "root-1",
        agent: "explore",
        description: "описание",
        prompt: "описание",
        status: "completed",
        providerID: "openai",
        modelID: "gpt-5.4",
        tokens: {
          input: 1000,
          output: 10,
          reasoning: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        cost: 0,
        updatedAt: Date.now(),
      },
    ]);

    expect(text.startsWith("<blockquote>")).toBe(true);
    expect(text).toContain("🧩 Задача: описание");
    expect(text).toContain("Агент: explore");
    expect(text).toContain("Модель: openai/gpt-5.4");
    expect(text).toContain("✅ Завершена");
  });

  it("shows error message on failed subagent", async () => {
    setRuntimeLocale("en");

    const text = await renderSubagentCards([
      {
        cardId: "card-1",
        sessionId: "child-1",
        parentSessionId: "root-1",
        agent: "explore",
        description: "task description",
        prompt: "task description",
        status: "error",
        providerID: "openai",
        modelID: "gpt-5.4",
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        cost: 0,
        terminalMessage: "Permission denied",
        updatedAt: Date.now(),
      },
    ]);

    expect(text.startsWith("<blockquote>")).toBe(true);
    expect(text).toContain("❌ Permission denied");
  });

  it("shows idle working state when no tool call is active", async () => {
    setRuntimeLocale("ru");

    const text = await renderSubagentCards([
      {
        cardId: "card-1",
        sessionId: "child-1",
        parentSessionId: "root-1",
        agent: "explore",
        description: "описание",
        prompt: "описание",
        status: "running",
        providerID: "openai",
        modelID: "gpt-5.4",
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        cost: 0,
        updatedAt: Date.now(),
      },
    ]);

    expect(text).toContain("⚙️ В работе...");
  });

  it("falls back to working state when tool event has no details yet", async () => {
    setRuntimeLocale("en");

    const text = await renderSubagentCards([
      {
        cardId: "card-1",
        sessionId: "child-1",
        parentSessionId: "root-1",
        agent: "explore",
        description: "task description",
        prompt: "task description",
        status: "running",
        providerID: "openai",
        modelID: "gpt-5.4",
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        cost: 0,
        currentTool: "read",
        currentToolInput: {},
        updatedAt: Date.now(),
      },
    ]);

    expect(text).toContain('📖 &quot;read&quot;');
    expect(text).not.toContain("⚙️ Working...");
  });

  it("shows useful subagent tool input details instead of internal generated titles", async () => {
    setRuntimeLocale("en");

    const text = await renderSubagentCards([
      {
        cardId: "card-1",
        sessionId: "child-1",
        parentSessionId: "root-1",
        agent: "explore",
        description: "inspect formatter",
        prompt: "inspect formatter",
        status: "running",
        providerID: "openai",
        modelID: "gpt-5.4",
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        cost: 0,
        currentTool: "read",
        currentToolInput: {
          filePath: "src/summary/subagent-formatter.ts",
        },
        currentToolTitle: "Reading subagent formatter",
        updatedAt: Date.now(),
      },
    ]);

    expect(text).toContain("src/summary/subagent-formatter.ts");
    expect(text).not.toContain("Reading subagent formatter");
  });

  it("escapes dynamic subagent fields before composing Telegram HTML", async () => {
    setRuntimeLocale("en");

    const text = await renderSubagentCards([
      {
        cardId: "card-1",
        sessionId: "child-1",
        parentSessionId: "root-1",
        agent: '<b>explore</b>',
        description: '<a href="https://evil.example">task</a>',
        prompt: "inspect formatter",
        status: "error",
        providerID: "openai",
        modelID: 'gpt-5.4</blockquote><b>boom</b>',
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        cost: 0,
        terminalMessage: '<i>Permission denied</i>',
        updatedAt: Date.now(),
      },
    ]);

    expect(text).toContain('&lt;a href=&quot;https://evil.example&quot;&gt;task&lt;/a&gt;');
    expect(text).toContain('Agent: &lt;b&gt;explore&lt;/b&gt;');
    expect(text).toContain('Model: openai/gpt-5.4&lt;/blockquote&gt;&lt;b&gt;boom&lt;/b&gt;');
    expect(text).toContain('❌ &lt;i&gt;Permission denied&lt;/i&gt;');
    expect(text).not.toContain('<a href="https://evil.example">task</a>');
    expect(text).not.toContain('<i>Permission denied</i>');
  });

  it("renders a topic link for an active subagent", async () => {
    setRuntimeLocale("en");

    const text = await renderSubagentCards([
      {
        cardId: "card-1",
        sessionId: "child-1",
        parentSessionId: "root-1",
        agent: "explore",
        description: "task description",
        prompt: "task description",
        status: "running",
        providerID: "openai",
        modelID: "gpt-5.4",
        tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        cost: 0,
        updatedAt: Date.now(),
        topicLinkLabel: "Open subagent thread",
        topicLinkUrl: "https://t.me/c/-100123/321",
      },
    ]);

    expect(text).toContain('• <a href="https://t.me/c/-100123/321">Open subagent thread</a>');
  });

  it("renders a stopped line for a stopped subagent", async () => {
    setRuntimeLocale("en");

    const text = await renderSubagentCards([
      {
        cardId: "card-1",
        sessionId: "child-1",
        parentSessionId: "root-1",
        agent: "explore",
        description: "task description",
        prompt: "task description",
        status: "running",
        providerID: "openai",
        modelID: "gpt-5.4",
        tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        cost: 0,
        updatedAt: Date.now(),
        stoppedLine: "Subagent was stopped",
      },
    ]);

    expect(text).toContain("• Subagent was stopped");
  });

  it("renders stopped line over topic link when both are present", async () => {
    setRuntimeLocale("en");

    const text = await renderSubagentCards([
      {
        cardId: "card-1",
        sessionId: "child-1",
        parentSessionId: "root-1",
        agent: "explore",
        description: "task description",
        prompt: "task description",
        status: "error",
        providerID: "openai",
        modelID: "gpt-5.4",
        tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        cost: 0,
        terminalMessage: "Permission denied",
        updatedAt: Date.now(),
        stoppedLine: "Subagent was stopped",
        topicLinkLabel: "Open subagent thread",
        topicLinkUrl: "https://t.me/c/-100123/321",
      },
    ]);

    expect(text).toContain("• Subagent was stopped");
    expect(text).not.toContain("Open subagent thread");
  });

  it("renders no link or stopped line for completed subagent without those fields", async () => {
    setRuntimeLocale("en");

    const text = await renderSubagentCards([
      {
        cardId: "card-1",
        sessionId: "child-1",
        parentSessionId: "root-1",
        agent: "explore",
        description: "task description",
        prompt: "task description",
        status: "completed",
        providerID: "openai",
        modelID: "gpt-5.4",
        tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        cost: 0,
        updatedAt: Date.now(),
      },
    ]);

    expect(text).toContain("✅ Completed");
    expect(text).not.toContain("•");
  });

  it("escapes topic link URL and label in HTML output", async () => {
    setRuntimeLocale("en");

    const text = await renderSubagentCards([
      {
        cardId: "card-1",
        sessionId: "child-1",
        parentSessionId: "root-1",
        agent: "explore",
        description: "task description",
        prompt: "task description",
        status: "running",
        providerID: "openai",
        modelID: "gpt-5.4",
        tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        cost: 0,
        updatedAt: Date.now(),
        topicLinkLabel: '<b>malicious</b>',
        topicLinkUrl: 'https://evil.example',
      },
    ]);

    expect(text).toContain('&lt;b&gt;malicious&lt;/b&gt;');
    expect(text).not.toContain('<b>malicious</b>');
  });

  it("escapes stoppedLine in HTML output", async () => {
    setRuntimeLocale("en");

    const text = await renderSubagentCards([
      {
        cardId: "card-1",
        sessionId: "child-1",
        parentSessionId: "root-1",
        agent: "explore",
        description: "task description",
        prompt: "task description",
        status: "running",
        providerID: "openai",
        modelID: "gpt-5.4",
        tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        cost: 0,
        updatedAt: Date.now(),
        stoppedLine: '<script>alert("xss")</script>',
      },
    ]);

    expect(text).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(text).not.toContain('<script>alert("xss")</script>');
  });

  it("escapes tool-step details before inserting them into Telegram HTML", async () => {
    setRuntimeLocale("en");

    const text = await renderSubagentCards([
      {
        cardId: "card-1",
        sessionId: "child-1",
        parentSessionId: "root-1",
        agent: "explore",
        description: "task description",
        prompt: "task description",
        status: "running",
        providerID: "openai",
        modelID: "gpt-5.4",
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        cost: 0,
        currentTool: "bash",
        currentToolInput: {
          command: '<b>npm test</b>',
          description: '<a href="https://evil.example">Run tests</a>',
        },
        updatedAt: Date.now(),
      },
    ]);

    expect(text).toContain('&lt;a href=&quot;https://evil.example&quot;&gt;Run tests&lt;/a&gt;');
    expect(text).toContain('&lt;b&gt;npm test&lt;/b&gt;');
    expect(text).not.toContain('<a href="https://evil.example">Run tests</a>');
    expect(text).not.toContain('<b>npm test</b>');
  });
});
