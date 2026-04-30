import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  renderActiveDraftMock: vi.fn(),
  finalizeDraftMock: vi.fn(),
  clearActiveDraftMock: vi.fn(),
  clearSessionMock: vi.fn(),
  clearAllMock: vi.fn(),
  formatThinkingMessageWithReasoningMock: vi.fn(),
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
      .mockImplementation((title: string, reasoning: string) => ({
        text: `<b>${title}</b>\n\n<blockquote expandable>${reasoning}</blockquote>`,
        format: "html",
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
      "<b>Thinking</b>\n\n<blockquote expandable>Step 1</blockquote>",
      expect.objectContaining({
        chatId: 1,
        draftId: 1,
        routingIdentity: "1:main",
      }),
    );
    expect(sendApi.sendMessageDraft).toHaveBeenCalledWith(
      1,
      1,
      "<b>Thinking</b>\n\n<blockquote expandable>Step 1</blockquote>",
      {
        parse_mode: "HTML",
        disable_notification: true,
      },
    );
  });

  it("reuses the same draft id across active updates on the same route", async () => {
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
    expect(mocked.renderActiveDraftMock).toHaveBeenCalledTimes(2);
    expect(mocked.renderActiveDraftMock.mock.calls[0]?.[2]).toMatchObject({
      draftId: 77,
      routingIdentity: "1:5",
    });
    expect(mocked.renderActiveDraftMock.mock.calls[1]?.[2]).toMatchObject({
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

  it("replays the last good render after a failed update so finalize can recover", async () => {
    mocked.renderActiveDraftMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);
    mocked.finalizeDraftMock.mockImplementation(async () => {
      if (mocked.renderActiveDraftMock.mock.calls.length < 3) {
        throw new Error("stuck failed state");
      }
    });

    await streamThinkingBlocks({
      sessionId: "s1",
      target: { chatId: 1 },
      sendApi: createSendApi(),
      title: "Thinking",
      reasoningText: "Step 1",
    });

    await expect(
      streamThinkingBlocks({
        sessionId: "s1",
        target: { chatId: 1 },
        sendApi: createSendApi(),
        title: "Thinking",
        reasoningText: "Step 2",
      }),
    ).rejects.toThrow("boom");
    await Promise.resolve();

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

    expect(mocked.renderActiveDraftMock).toHaveBeenCalledTimes(3);
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
      formatThinkingMessageWithReasoning: (title: string, reasoning: string) => ({
        text: `<b>${title}</b>\n\n<blockquote expandable>${reasoning}</blockquote>`,
        format: "html",
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

  it("publishes a normal message on finalize and starts fresh on the next block", async () => {
    const sendApi = createSendApi();
    mocked.finalizeDraftMock.mockImplementation(async (_sessionId: string, transport) => {
      await transport.sendMessage(transport.chatId, "published thinking", {
        parse_mode: "HTML",
        disable_notification: true,
      });
    });

    const payload = {
      sessionId: "s1",
      target: { chatId: 1 },
      sendApi,
      title: "Thinking",
      reasoningText: "Step 1",
    };

    await streamThinkingBlocks(payload);
    await expect(
      finalizeThinkingBlockStream({
        sessionId: "s1",
        target: { chatId: 1 },
        sendApi,
        title: "Thinking",
      }),
    ).resolves.toBe("finalized");
    await streamThinkingBlocks(payload);

    expect(mocked.finalizeDraftMock).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({
        chatId: 1,
        routingIdentity: "1:main",
      }),
    );
    expect(mocked.sendMessageWithoutDraftEffectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sendMessage: expect.any(Function),
      }),
      1,
      "published thinking",
      {
        parse_mode: "HTML",
        disable_notification: true,
      },
    );
    expect(mocked.renderActiveDraftMock).toHaveBeenCalledTimes(2);
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
    expect(mocked.renderActiveDraftMock).toHaveBeenCalledTimes(2);
    expect(mocked.renderActiveDraftMock.mock.calls[1]?.[2]).toMatchObject({
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
