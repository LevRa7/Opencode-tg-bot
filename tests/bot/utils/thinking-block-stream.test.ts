import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  renderActiveDraftMock: vi.fn(),
  finalizeDraftMock: vi.fn(),
  clearActiveDraftMock: vi.fn(),
  clearSessionMock: vi.fn(),
  clearAllMock: vi.fn(),
  formatThinkingMessageWithReasoningMock: vi.fn(),
  formatThinkingCompletionWithDetailsMock: vi.fn(),
  formatThinkingCompletionMessageMock: vi.fn(),
  sendMessageWithoutDraftEffectMock: vi.fn(),
}));

vi.mock("../../../src/bot/utils/thinking-draft-lifecycle.js", () => ({
  ThinkingDraftLifecycle: class {
    renderActiveDraft = mocked.renderActiveDraftMock;
    finalizeDraft = mocked.finalizeDraftMock;
    clearActiveDraft = mocked.clearActiveDraftMock;
    clearSession = mocked.clearSessionMock;
    clearAll = mocked.clearAllMock;
  },
}));

vi.mock("../../../src/bot/utils/thinking-message.js", () => ({
  formatThinkingMessageWithReasoning: mocked.formatThinkingMessageWithReasoningMock,
  formatThinkingCompletionWithDetails: mocked.formatThinkingCompletionWithDetailsMock,
  formatThinkingCompletionMessage: mocked.formatThinkingCompletionMessageMock,
}));

vi.mock("../../../src/bot/utils/send-message-draft-effect-context.js", () => ({
  sendMessageWithoutDraftEffect: mocked.sendMessageWithoutDraftEffectMock,
}));

import {
  clearAllThinkingBlockStreams,
  clearThinkingBlockStream,
  configureThinkingBlockDraftIdAllocator,
  configureThinkingBlockDeliveryOrchestratorForTests,
  finalizeThinkingBlockStream,
  streamThinkingBlocks,
} from "../../../src/bot/utils/thinking-block-stream.js";

function createSendApi() {
  return {
    sendMessageDraft: vi.fn().mockResolvedValue(true),
    sendMessage: vi.fn().mockResolvedValue({ message_id: 101 }),
    editMessageText: vi.fn(),
    deleteMessage: vi.fn().mockResolvedValue(true),
  };
}

describe("bot/utils/thinking-block-stream", () => {
  beforeEach(() => {
    mocked.renderActiveDraftMock.mockReset().mockResolvedValue(undefined);
    mocked.finalizeDraftMock.mockReset().mockResolvedValue(undefined);
    mocked.clearActiveDraftMock.mockReset().mockResolvedValue(undefined);
    mocked.clearSessionMock.mockReset();
    mocked.clearAllMock.mockReset();
    mocked.sendMessageWithoutDraftEffectMock.mockReset().mockResolvedValue({ message_id: 101 });
    mocked.formatThinkingMessageWithReasoningMock
      .mockReset()
      .mockImplementation((title: string) => ({
        text: `💭 ${title}`,
      }));
    mocked.formatThinkingCompletionWithDetailsMock
      .mockReset()
      .mockImplementation(async (title: string) => ({
        text: `💭 ${title}`,
      }));
    mocked.formatThinkingCompletionMessageMock
      .mockReset()
      .mockImplementation((title: string) => ({
        text: `💭 ${title}`,
      }));
    clearAllThinkingBlockStreams();
    configureThinkingBlockDeliveryOrchestratorForTests(null);
    configureThinkingBlockDraftIdAllocator({
      next: () => 1,
    });
  });

  it("renders the first full block through the active draft lifecycle", async () => {
    const sendApi = createSendApi();
    mocked.renderActiveDraftMock.mockImplementation(async (_sessionId: string, text: string, transport) => {
      await transport.sendMessageDraft(transport.chatId, transport.draftId, text, {
        parse_mode: "HTML",
        disable_notification: true,
      });
    });

    await streamThinkingBlocks({
      sessionId: "s1",
      target: { chatId: 1 },
      sendApi,
      title: "Thinking",
      reasoningText: "Step 1",
    });

    expect(mocked.formatThinkingMessageWithReasoningMock).toHaveBeenCalledWith("Thinking", "Step 1");
    expect(mocked.renderActiveDraftMock).toHaveBeenCalledTimes(1);
    expect(mocked.renderActiveDraftMock).toHaveBeenCalledWith(
      "s1",
      "💭 Thinking",
      expect.objectContaining({
        chatId: 1,
        draftId: 1,
        routingIdentity: "1:main",
      }),
    );
    expect(sendApi.sendMessageDraft).toHaveBeenCalledWith(
      1,
      1,
      "💭 Thinking",
      {
        parse_mode: "HTML",
        disable_notification: true,
      },
    );
  });

  it("keeps the same draft id while active reasoning changes on the same route", async () => {
    const next = vi.fn().mockReturnValue(77);
    configureThinkingBlockDraftIdAllocator({ next });

    await streamThinkingBlocks({
      sessionId: "s1",
      target: { chatId: 1, messageThreadId: 5 },
      sendApi: createSendApi(),
      title: "Thinking",
      reasoningText: "Step 1",
    });
    await streamThinkingBlocks({
      sessionId: "s1",
      target: { chatId: 1, messageThreadId: 5 },
      sendApi: createSendApi(),
      title: "Thinking",
      reasoningText: "Step 2",
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(mocked.renderActiveDraftMock).toHaveBeenCalledTimes(1);
    expect(mocked.renderActiveDraftMock.mock.calls[0]?.[2]).toMatchObject({
      draftId: 77,
      routingIdentity: "1:5",
    });
  });

  it("dedupes the same fully rendered active block", async () => {
    const payload = {
      sessionId: "s1",
      target: { chatId: 1 },
      sendApi: createSendApi(),
      title: "Thinking",
      reasoningText: "Step 1",
    };

    await streamThinkingBlocks(payload);
    await streamThinkingBlocks(payload);

    expect(mocked.renderActiveDraftMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes the lifecycle instead of deduping when the same text moves routes", async () => {
    const next = vi.fn().mockReturnValueOnce(30).mockReturnValueOnce(31);
    configureThinkingBlockDraftIdAllocator({ next });

    await streamThinkingBlocks({
      sessionId: "s1",
      target: { chatId: 1 },
      sendApi: createSendApi(),
      title: "Thinking",
      reasoningText: "Step 1",
    });
    await streamThinkingBlocks({
      sessionId: "s1",
      target: { chatId: 2 },
      sendApi: createSendApi(),
      title: "Thinking",
      reasoningText: "Step 1",
    });

    expect(mocked.renderActiveDraftMock).toHaveBeenCalledTimes(2);
    expect(mocked.renderActiveDraftMock.mock.calls[0]?.[2]).toMatchObject({
      draftId: 30,
      routingIdentity: "1:main",
    });
    expect(mocked.renderActiveDraftMock.mock.calls[1]?.[2]).toMatchObject({
      draftId: 31,
      routingIdentity: "2:main",
    });
  });

  it("clears the previous active draft before rendering when the route changes", async () => {
    const events: string[] = [];
    const next = vi.fn().mockReturnValueOnce(30).mockReturnValueOnce(31);
    configureThinkingBlockDraftIdAllocator({ next });
    mocked.clearActiveDraftMock.mockImplementation(async () => {
      events.push("clear");
      return "cleared";
    });
    mocked.renderActiveDraftMock.mockImplementation(async () => {
      events.push("render");
    });

    await streamThinkingBlocks({
      sessionId: "s1",
      target: { chatId: 1 },
      sendApi: createSendApi(),
      title: "Thinking",
      reasoningText: "Step 1",
    });
    await streamThinkingBlocks({
      sessionId: "s1",
      target: { chatId: 2 },
      sendApi: createSendApi(),
      title: "Thinking",
      reasoningText: "Step 2",
    });

    expect(mocked.clearActiveDraftMock).toHaveBeenCalledTimes(1);
    expect(mocked.clearActiveDraftMock).toHaveBeenCalledWith(
      "s1",
      true,
      expect.objectContaining({
        chatId: 1,
        draftId: 30,
        routingIdentity: "1:main",
      }),
    );
    expect(events).toEqual(["render", "clear", "render"]);
  });

  it("dedupes overlapping same-session updates while the first render is in flight", async () => {
    let resolveRender: (() => void) | null = null;
    mocked.renderActiveDraftMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRender = resolve;
        }),
    );

    const payload = {
      sessionId: "s1",
      target: { chatId: 1 },
      sendApi: createSendApi(),
      title: "Thinking",
      reasoningText: "Step 1",
    };

    const first = streamThinkingBlocks(payload);
    const second = streamThinkingBlocks(payload);

    await vi.waitFor(() => {
      expect(resolveRender).not.toBeNull();
    });

    if (!resolveRender) {
      throw new Error("expected in-flight render resolver");
    }

    (resolveRender as () => void)();
    await first;
    await second;

    expect(mocked.renderActiveDraftMock).toHaveBeenCalledTimes(1);
  });

  it("retries the same rendered block after a draft render rejection", async () => {
    const payload = {
      sessionId: "s1",
      target: { chatId: 1 },
      sendApi: createSendApi(),
      title: "Thinking",
      reasoningText: "Step 1",
    };

    mocked.renderActiveDraftMock.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(undefined);

    await expect(streamThinkingBlocks(payload)).rejects.toThrow("boom");
    await Promise.resolve();
    await streamThinkingBlocks(payload);

    expect(mocked.renderActiveDraftMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the last one-line render stable while retaining final reasoning details", async () => {
    const publisher = { publish: vi.fn().mockResolvedValue("https://telegra.ph/reasoning") };

    await streamThinkingBlocks({
      sessionId: "s1",
      target: { chatId: 1 },
      sendApi: createSendApi(),
      title: "Thinking",
      reasoningText: "Step 1",
    });

    await streamThinkingBlocks({
      sessionId: "s1",
      target: { chatId: 1 },
      sendApi: createSendApi(),
      title: "Thinking",
      reasoningText: "Step 2",
    });

    await expect(
      finalizeThinkingBlockStream({
        sessionId: "s1",
        target: { chatId: 1 },
        sendApi: createSendApi(),
        title: "Thinking",
        publisher,
      }),
    ).resolves.toBe("finalized");

    expect(mocked.renderActiveDraftMock).toHaveBeenCalledTimes(2);
    expect(mocked.formatThinkingCompletionWithDetailsMock).toHaveBeenCalledWith(
      "Thinking",
      "Step 2",
      publisher,
      undefined,
    );
  });

  it("finalizes through the draft lifecycle even when coordinator state is missing", async () => {
    await expect(
      finalizeThinkingBlockStream({
        sessionId: "missing-session",
        target: { chatId: 1 },
        sendApi: createSendApi(),
        title: "Thinking",
      }),
    ).resolves.toBe("finalized");

    expect(mocked.finalizeDraftMock).toHaveBeenCalledWith(
      "missing-session",
      expect.objectContaining({
        chatId: 1,
        routingIdentity: "1:main",
      }),
    );
  });

  it("uses the same fallback logical message id for live and final thinking when callers omit one", async () => {
    vi.resetModules();

    const deliveryItems: Array<Record<string, unknown>> = [];
    vi.doMock("../../../src/bot/delivery/session-delivery-orchestrator.js", () => ({
      SessionDeliveryOrchestrator: class {
        enqueue(item: Record<string, unknown>) {
          deliveryItems.push(item);
          return Promise.resolve();
        }

        flushSession() {
          return Promise.resolve();
        }

        clearSession() {
          return undefined;
        }

        clearAll() {
          return undefined;
        }
      },
    }));

    vi.doMock("../../../src/bot/utils/thinking-draft-lifecycle.js", () => ({
      ThinkingDraftLifecycle: class {
        renderActiveDraft = vi.fn().mockResolvedValue(undefined);
        finalizeDraft = vi.fn().mockResolvedValue(undefined);
        clearActiveDraft = vi.fn().mockResolvedValue(undefined);
        clearSession = vi.fn();
        clearAll = vi.fn();
      },
    }));

    vi.doMock("../../../src/bot/utils/thinking-message.js", () => ({
      formatThinkingMessageWithReasoning: (title: string) => ({
        text: `💭 ${title}`,
        format: undefined,
      }),
      formatThinkingCompletionMessage: (title: string) => ({
        text: `✅ Finished thinking — ${title}`,
        format: undefined,
      }),
      formatThinkingCompletionWithDetails: (title: string) =>
        Promise.resolve({
          text: `✅ Finished thinking — ${title}`,
          format: undefined,
        }),
    }));

    vi.doMock("../../../src/bot/utils/send-message-draft-effect-context.js", () => ({
      sendMessageWithoutDraftEffect: vi.fn().mockResolvedValue({ message_id: 101 }),
    }));

    const isolated = await import("../../../src/bot/utils/thinking-block-stream.js");

    isolated.configureThinkingBlockDraftIdAllocator({ next: () => 1 });
    await isolated.streamThinkingBlocks({
      sessionId: "s1",
      target: { chatId: 1 },
      sendApi: createSendApi(),
      title: "Thinking",
      reasoningText: "Step 1",
    });

    await expect(
      isolated.finalizeThinkingBlockStream({
        sessionId: "s1",
        target: { chatId: 1 },
        sendApi: createSendApi(),
        title: "Thinking",
      }),
    ).resolves.toBe("finalized");

    expect(deliveryItems.slice(0, 3)).toEqual([
      expect.objectContaining({
        sessionId: "s1",
        channel: "live",
        logicalMessageId: "thinking:s1",
      }),
      expect.objectContaining({
        sessionId: "s1",
        channel: "live",
        logicalMessageId: "thinking:s1",
        isTerminal: true,
      }),
      expect.objectContaining({
        sessionId: "s1",
        channel: "durable",
        waitForLogicalMessageLiveTerminal: "thinking:s1",
      }),
    ]);
    expect(deliveryItems[0]).toMatchObject({ channel: "live" });
    expect(deliveryItems[1]).toMatchObject({ channel: "live", isTerminal: true });
    expect(deliveryItems[2]).toMatchObject({ channel: "durable" });
    expect(deliveryItems[0]?.logicalMessageId).toBe(deliveryItems[1]?.logicalMessageId);
    expect(deliveryItems[1]?.logicalMessageId).toBe(
      deliveryItems[2]?.waitForLogicalMessageLiveTerminal,
    );

    vi.doUnmock("../../../src/bot/delivery/session-delivery-orchestrator.js");
    vi.doUnmock("../../../src/bot/utils/thinking-draft-lifecycle.js");
    vi.doUnmock("../../../src/bot/utils/thinking-message.js");
    vi.doUnmock("../../../src/bot/utils/send-message-draft-effect-context.js");
  });

  it("keeps coordinator state for later missing-routing cleanup when finalize cannot clear the old route", async () => {
    const next = vi.fn().mockReturnValueOnce(30);
    configureThinkingBlockDraftIdAllocator({ next });
    const routeASendApi = createSendApi();
    const routeBSendApi = createSendApi();
    mocked.clearActiveDraftMock.mockResolvedValue("preserved");
    const missingRoutingCleanup = {
      deleteText: vi.fn().mockResolvedValue(undefined),
      editText: vi.fn(),
      routingIdentity: "1:main",
      sendText: vi.fn(),
    };

    await streamThinkingBlocks({
      sessionId: "s1",
      target: { chatId: 1 },
      sendApi: routeASendApi,
      title: "Thinking",
      reasoningText: "Step 1",
    });

    await expect(
      finalizeThinkingBlockStream({
        sessionId: "s1",
        target: { chatId: 2 },
        sendApi: routeBSendApi,
        title: "Thinking",
      }),
    ).resolves.toBe("cleared");

    await clearThinkingBlockStream("s1", true, missingRoutingCleanup);

    expect(mocked.clearActiveDraftMock).toHaveBeenNthCalledWith(
      1,
      "s1",
      true,
      expect.objectContaining({
        chatId: 1,
        draftId: 30,
        routingIdentity: "1:main",
      }),
    );
    expect(mocked.clearActiveDraftMock).toHaveBeenNthCalledWith(
      2,
      "s1",
      true,
      expect.objectContaining({
        chatId: 1,
        draftId: 30,
        routingIdentity: "1:main",
      }),
    );
    expect(mocked.finalizeDraftMock).not.toHaveBeenCalled();
    expect(routeASendApi.sendMessage).not.toHaveBeenCalled();
    expect(routeBSendApi.sendMessage).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(missingRoutingCleanup.deleteText).not.toHaveBeenCalled();
  });

  it("publishes Telegraph details before finalizing the thinking stream", async () => {
    const sendApi = createSendApi();
    let resolveDetails: ((value: { text: string; format?: "html" }) => void) | null = null;
    let renderedFinalText = "💭 Thinking";
    mocked.renderActiveDraftMock.mockImplementation(async (_sessionId: string, text: string) => {
      renderedFinalText = text;
    });
    mocked.finalizeDraftMock.mockImplementation(async (_sessionId: string, transport) => {
      await transport.sendMessage(transport.chatId, renderedFinalText, {
        parse_mode: "HTML",
        disable_notification: true,
      });
    });
    mocked.formatThinkingCompletionWithDetailsMock.mockImplementation(
      () =>
        new Promise<{ text: string; format?: "html" }>((resolve) => {
          resolveDetails = resolve;
        }),
    );

    const payload = {
      sessionId: "s1",
      target: { chatId: 1 },
      sendApi,
      title: "Thinking",
      reasoningText: "Step 1\nStep 2",
    };

    await streamThinkingBlocks(payload);
    const finalizePromise = finalizeThinkingBlockStream({
        sessionId: "s1",
        target: { chatId: 1 },
        sendApi,
        title: "Thinking",
        publisher: { publish: vi.fn().mockResolvedValue("https://telegra.ph/reasoning") },
      });

    await vi.waitFor(() => {
      expect(mocked.formatThinkingCompletionMessageMock).toHaveBeenCalledWith("Thinking", "Step 1\nStep 2");
    });
    expect(mocked.formatThinkingCompletionWithDetailsMock).toHaveBeenCalledWith(
      "Thinking",
      "Step 1\nStep 2",
      expect.objectContaining({ publish: expect.any(Function) }),
      undefined,
    );
    expect(resolveDetails).not.toBeNull();
    expect(mocked.finalizeDraftMock).not.toHaveBeenCalled();

    resolveDetails?.({
      text: "<a href=\"https://telegra.ph/reasoning\">💭 Thinking</a>",
      format: "html",
    });
    await expect(finalizePromise).resolves.toBe("finalized");

    expect(mocked.renderActiveDraftMock).toHaveBeenLastCalledWith(
      "s1",
      "<a href=\"https://telegra.ph/reasoning\">💭 Thinking</a>",
      expect.objectContaining({ chatId: 1 }),
    );
    expect(mocked.finalizeDraftMock).toHaveBeenCalledTimes(1);
  });

  it("uses a fresh draft id for the final thinking render", async () => {
    const next = vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(11);
    configureThinkingBlockDraftIdAllocator({ next });

    await streamThinkingBlocks({
      sessionId: "s1",
      target: { chatId: 1 },
      sendApi: createSendApi(),
      title: "Thinking",
      reasoningText: "Step 1",
    });

    await expect(
      finalizeThinkingBlockStream({
        sessionId: "s1",
        target: { chatId: 1 },
        sendApi: createSendApi(),
        title: "Thinking",
      }),
    ).resolves.toBe("finalized");

    expect(mocked.renderActiveDraftMock).toHaveBeenNthCalledWith(
      1,
      "s1",
      "💭 Thinking",
      expect.objectContaining({ draftId: 10 }),
    );
    expect(mocked.renderActiveDraftMock).toHaveBeenNthCalledWith(
      2,
      "s1",
      "💭 Thinking",
      expect.objectContaining({ draftId: 11 }),
    );
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("falls back to the plain thinking completion when Telegraph details fail", async () => {
    const sendApi = createSendApi();
    let renderedFinalText = "";
    mocked.renderActiveDraftMock.mockImplementation(async (_sessionId: string, text: string) => {
      renderedFinalText = text;
    });
    mocked.formatThinkingCompletionWithDetailsMock.mockImplementation(
      async () => {
        throw new Error("telegraph unavailable");
      },
    );

    await streamThinkingBlocks({
      sessionId: "s1",
      target: { chatId: 1 },
      sendApi,
      title: "Thinking",
      reasoningText: "Step 1",
    });

    await expect(
      finalizeThinkingBlockStream({
        sessionId: "s1",
        target: { chatId: 1 },
        sendApi,
        title: "Thinking",
        publisher: { publish: vi.fn().mockResolvedValue("https://telegra.ph/reasoning") },
      }),
    ).resolves.toBe("finalized");

    expect(renderedFinalText).toBe("💭 Thinking");
    expect(mocked.finalizeDraftMock).toHaveBeenCalledTimes(1);
  });

  it("prefers completion reasoning over stale active reasoning when finalizing details", async () => {
    await streamThinkingBlocks({
      sessionId: "s1",
      target: { chatId: 1 },
      sendApi: createSendApi(),
      title: "Thinking",
      reasoningText: "stale streamed reasoning",
    });

    const options = {
      sessionId: "s1",
      target: { chatId: 1 },
      sendApi: createSendApi(),
      title: "Thinking",
      reasoningText: "final completion reasoning",
      publisher: { publish: vi.fn().mockResolvedValue("https://telegra.ph/reasoning") },
    } as Parameters<typeof finalizeThinkingBlockStream>[0] & { reasoningText: string };

    await finalizeThinkingBlockStream(options);

    expect(mocked.formatThinkingCompletionMessageMock).toHaveBeenCalledWith(
      "Thinking",
      "final completion reasoning",
    );
    expect(mocked.formatThinkingCompletionWithDetailsMock).toHaveBeenCalledWith(
      "Thinking",
      "final completion reasoning",
      expect.objectContaining({ publish: expect.any(Function) }),
      undefined,
    );
  });

  it("returns a failed outcome when durable finalization cannot be published", async () => {
    mocked.finalizeDraftMock.mockRejectedValueOnce(new Error("publish failed"));

    await streamThinkingBlocks({
      sessionId: "s1",
      target: { chatId: 1 },
      sendApi: createSendApi(),
      title: "Thinking",
      reasoningText: "Step 1",
    });

    await expect(
      finalizeThinkingBlockStream({
        sessionId: "s1",
        target: { chatId: 1 },
        sendApi: createSendApi(),
        title: "Thinking",
      }),
    ).resolves.toBe("failed");
  });

  it("uses a configured delivery orchestrator override when provided", async () => {
    const enqueue = vi.fn(async () => undefined);
    const flushSession = vi.fn(async () => undefined);
    const clearSession = vi.fn();
    const clearAll = vi.fn();

    configureThinkingBlockDeliveryOrchestratorForTests({
      enqueue,
      flushSession,
      clearSession,
      clearAll,
    });

    await streamThinkingBlocks({
      sessionId: "s1",
      target: { chatId: 1 },
      sendApi: createSendApi(),
      title: "Thinking",
      reasoningText: "Step 1",
    });

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "s1",
        channel: "live",
      }),
    );

    clearAllThinkingBlockStreams();
    expect(clearAll).toHaveBeenCalledTimes(1);
  });

  it("forced clear requests deletion only for the active unfinished block", async () => {
    const activeSendApi = createSendApi();
    const cleanupTransport = {
      deleteText: vi.fn().mockResolvedValue(undefined),
      editText: vi.fn(),
      routingIdentity: "1:main",
      sendText: vi.fn(),
    };
    mocked.clearActiveDraftMock.mockImplementation(async (_sessionId: string, _shouldClear: boolean, transport) => {
      await transport.deleteMessage(transport.chatId, transport.draftId);
    });

    await streamThinkingBlocks({
      sessionId: "s1",
      target: { chatId: 1 },
      sendApi: activeSendApi,
      title: "Thinking",
      reasoningText: "Step 1",
    });

    await clearThinkingBlockStream("s1", true, cleanupTransport);

    expect(mocked.clearActiveDraftMock).toHaveBeenCalledWith(
      "s1",
      true,
      expect.objectContaining({
        chatId: 1,
        draftId: 1,
        routingIdentity: "1:main",
      }),
    );
    expect(activeSendApi.deleteMessage).toHaveBeenCalledWith(1, 1);
    expect(cleanupTransport.deleteText).not.toHaveBeenCalled();
  });

  it("clears the stored active route when missing-routing cleanup arrives from another route", async () => {
    const activeSendApi = createSendApi();
    const cleanupTransport = {
      deleteText: vi.fn().mockResolvedValue(undefined),
      editText: vi.fn(),
      routingIdentity: "2:main",
      sendText: vi.fn(),
    };
    let activeRoute: string | null = null;
    let activeDraftId: number | null = null;

    mocked.renderActiveDraftMock.mockImplementation(async (_sessionId: string, _text: string, transport) => {
      activeRoute = transport.routingIdentity;
      activeDraftId = transport.draftId;
    });
    mocked.clearActiveDraftMock.mockImplementation(async (_sessionId: string, shouldClear: boolean, transport) => {
      if (!shouldClear || transport.routingIdentity !== activeRoute || activeDraftId === null) {
        return "dropped";
      }

      await transport.deleteMessage(transport.chatId, activeDraftId);
      activeRoute = null;
      activeDraftId = null;
      return "cleared";
    });

    await streamThinkingBlocks({
      sessionId: "s1",
      target: { chatId: 1 },
      sendApi: activeSendApi,
      title: "Thinking",
      reasoningText: "Step 1",
    });

    await clearThinkingBlockStream("s1", true, cleanupTransport);

    expect(mocked.clearActiveDraftMock).toHaveBeenCalledWith(
      "s1",
      true,
      expect.objectContaining({
        chatId: 1,
        draftId: 1,
        routingIdentity: "1:main",
      }),
    );
    expect(activeSendApi.deleteMessage).toHaveBeenCalledWith(1, 1);
    expect(cleanupTransport.deleteText).not.toHaveBeenCalled();
  });

  it("deletes stale drafts through the stored active route during cross-route cleanup", async () => {
    const next = vi.fn().mockReturnValueOnce(30);
    configureThinkingBlockDraftIdAllocator({ next });
    const activeSendApi = createSendApi();
    const cleanupTransport = {
      deleteText: vi.fn().mockResolvedValue(undefined),
      editText: vi.fn(),
      routingIdentity: "2:main",
      sendText: vi.fn(),
    };

    mocked.clearActiveDraftMock.mockImplementation(async (_sessionId: string, shouldClear: boolean, transport) => {
      if (!shouldClear) {
        return "dropped";
      }

      await transport.deleteMessage(transport.chatId, transport.draftId);
      return "cleared";
    });

    await streamThinkingBlocks({
      sessionId: "s1",
      target: { chatId: 1 },
      sendApi: activeSendApi,
      title: "Thinking",
      reasoningText: "Step 1",
    });

    await clearThinkingBlockStream("s1", true, cleanupTransport);

    expect(mocked.clearActiveDraftMock).toHaveBeenCalledWith(
      "s1",
      true,
      expect.objectContaining({
        chatId: 1,
        draftId: 30,
        routingIdentity: "1:main",
      }),
    );
    expect(activeSendApi.deleteMessage).toHaveBeenCalledWith(1, 30);
    expect(cleanupTransport.deleteText).not.toHaveBeenCalled();
  });

  it("drops coordinator state when clear skips deletion for shouldClear=false", async () => {
    const next = vi.fn().mockReturnValueOnce(70).mockReturnValueOnce(71);
    configureThinkingBlockDraftIdAllocator({ next });
    mocked.clearActiveDraftMock.mockResolvedValue("dropped");

    await streamThinkingBlocks({
      sessionId: "s1",
      target: { chatId: 1 },
      sendApi: createSendApi(),
      title: "Thinking",
      reasoningText: "Step 1",
    });

    await clearThinkingBlockStream("s1", false, {
      deleteText: vi.fn().mockResolvedValue(undefined),
      editText: vi.fn(),
      routingIdentity: "1:main",
      sendText: vi.fn(),
    });

    await streamThinkingBlocks({
      sessionId: "s1",
      target: { chatId: 1 },
      sendApi: createSendApi(),
      title: "Thinking",
      reasoningText: "Step 2",
    });

    expect(next).toHaveBeenCalledTimes(2);
    expect(mocked.renderActiveDraftMock).toHaveBeenCalledTimes(2);
    expect(mocked.renderActiveDraftMock.mock.calls[1]?.[2]).toMatchObject({
      draftId: 71,
      routingIdentity: "1:main",
    });
  });

  it("keeps coordinator state when lifecycle explicitly preserves a matching clear request", async () => {
    const next = vi.fn().mockReturnValueOnce(90).mockReturnValueOnce(91);
    configureThinkingBlockDraftIdAllocator({ next });
    mocked.clearActiveDraftMock.mockResolvedValue("preserved");

    await streamThinkingBlocks({
      sessionId: "s1",
      target: { chatId: 1 },
      sendApi: createSendApi(),
      title: "Thinking",
      reasoningText: "Step 1",
    });

    await clearThinkingBlockStream("s1", true, {
      deleteText: vi.fn().mockResolvedValue(undefined),
      editText: vi.fn(),
      routingIdentity: "1:main",
      sendText: vi.fn(),
    });

    await streamThinkingBlocks({
      sessionId: "s1",
      target: { chatId: 1 },
      sendApi: createSendApi(),
      title: "Thinking",
      reasoningText: "Step 2",
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(mocked.clearActiveDraftMock).toHaveBeenCalledWith(
      "s1",
      true,
      expect.objectContaining({ routingIdentity: "1:main" }),
    );
    expect(mocked.renderActiveDraftMock).toHaveBeenCalledTimes(1);
    expect(mocked.renderActiveDraftMock.mock.calls[0]?.[2]).toMatchObject({
      draftId: 90,
      routingIdentity: "1:main",
    });
  });

  it("drops coordinator state when clear skips deletion for a routing mismatch", async () => {
    const next = vi.fn().mockReturnValueOnce(80).mockReturnValueOnce(81);
    configureThinkingBlockDraftIdAllocator({ next });
    mocked.clearActiveDraftMock.mockResolvedValue("dropped");

    await streamThinkingBlocks({
      sessionId: "s1",
      target: { chatId: 1 },
      sendApi: createSendApi(),
      title: "Thinking",
      reasoningText: "Step 1",
    });

    await clearThinkingBlockStream("s1", true, {
      deleteText: vi.fn().mockResolvedValue(undefined),
      editText: vi.fn(),
      routingIdentity: "2:main",
      sendText: vi.fn(),
    });

    await streamThinkingBlocks({
      sessionId: "s1",
      target: { chatId: 1 },
      sendApi: createSendApi(),
      title: "Thinking",
      reasoningText: "Step 2",
    });

    expect(next).toHaveBeenCalledTimes(2);
    expect(mocked.clearActiveDraftMock).toHaveBeenCalledWith(
      "s1",
      true,
      expect.objectContaining({ routingIdentity: "1:main" }),
    );
    expect(mocked.renderActiveDraftMock).toHaveBeenCalledTimes(2);
    expect(mocked.renderActiveDraftMock.mock.calls[1]?.[2]).toMatchObject({
      draftId: 81,
      routingIdentity: "1:main",
    });
  });

  it("clears through the draft lifecycle even when coordinator state is missing", async () => {
    const transport = {
      deleteText: vi.fn().mockResolvedValue(undefined),
      editText: vi.fn(),
      routingIdentity: "1:main",
      sendText: vi.fn(),
    };

    await clearThinkingBlockStream("missing-session", true, transport);

    expect(mocked.clearActiveDraftMock).toHaveBeenCalledWith(
      "missing-session",
      true,
      expect.objectContaining({ routingIdentity: "1:main" }),
    );
  });

  it("clears lifecycle session state without transport even when coordinator state is missing", async () => {
    await clearThinkingBlockStream("missing-session", false);

    expect(mocked.clearSessionMock).toHaveBeenCalledWith("missing-session");
  });
});
