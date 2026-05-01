import { describe, expect, it, vi } from "vitest";

const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: loggerMock,
}));

import {
  SubagentTopicService,
  type SubagentTopicScheduler,
} from "../../../src/bot/subagent-topics/service.js";

function createSchedulerSpy() {
  const scheduled: Array<{ run: () => Promise<void>; delayMs: number }> = [];
  const cancel = vi.fn();
  const scheduleDeletion: SubagentTopicScheduler = (run, delayMs) => {
    scheduled.push({ run, delayMs });

    return {
      cancel,
    };
  };

  return {
    cancel,
    scheduled,
    scheduleDeletion,
  };
}

describe("bot/subagent-topics/service", () => {
  it("creates a dedicated topic and exposes a silent delivery target for eligible forum subagents", async () => {
    const createForumTopic = vi.fn().mockResolvedValue({ messageThreadId: 321 });
    const deleteForumTopic = vi.fn().mockResolvedValue(undefined);
    const scheduler = createSchedulerSpy();
    const service = new SubagentTopicService({
      createForumTopic,
      deleteForumTopic,
      scheduleDeletion: scheduler.scheduleDeletion,
    });

    const scope = await service.syncSubagent({
      childSessionId: "child-1",
      topicName: "Research helper",
      parent: {
        chatId: -100123,
        isForum: true,
      },
    });

    expect(createForumTopic).toHaveBeenCalledWith({
      chatId: -100123,
      name: "Research helper",
    });
    expect(scope).toEqual({
      kind: "topic",
      childSessionId: "child-1",
      chatId: -100123,
      messageThreadId: 321,
      topicName: "Research helper",
    });
    expect(service.getScopeForSession("child-1")).toEqual(scope);
    expect(service.getTargetForSession("child-1")).toEqual({
      chatId: -100123,
      messageThreadId: 321,
      disableNotification: true,
    });
    expect(scheduler.scheduled).toEqual([]);
  });

  it("falls back without creating a topic for non-forum chats", async () => {
    const createForumTopic = vi.fn().mockResolvedValue({ messageThreadId: 321 });
    const service = new SubagentTopicService({
      createForumTopic,
      deleteForumTopic: vi.fn().mockResolvedValue(undefined),
      scheduleDeletion: createSchedulerSpy().scheduleDeletion,
    });

    const scope = await service.syncSubagent({
      childSessionId: "child-2",
      topicName: "Review helper",
      parent: {
        chatId: -100123,
        isForum: false,
      },
    });

    expect(createForumTopic).not.toHaveBeenCalled();
    expect(scope).toEqual({
      kind: "fallback",
      childSessionId: "child-2",
      chatId: -100123,
    });
    expect(service.getScopeForSession("child-2")).toEqual(scope);
    expect(service.getTargetForSession("child-2")).toBeNull();
  });

  it("schedules topic deletion only after the final response delivery marker", async () => {
    const createForumTopic = vi.fn().mockResolvedValue({ messageThreadId: 777 });
    const deleteForumTopic = vi.fn().mockResolvedValue(undefined);
    const scheduler = createSchedulerSpy();
    const service = new SubagentTopicService({
      createForumTopic,
      deleteForumTopic,
      scheduleDeletion: scheduler.scheduleDeletion,
    });

    await service.syncSubagent({
      childSessionId: "child-3",
      topicName: "Build helper",
      parent: {
        chatId: -100123,
        isForum: true,
      },
    });

    expect(scheduler.scheduled).toHaveLength(0);

    service.markFinalResponseDelivered("child-3", {
      terminalStatus: "completed",
      autoDeleteMinutes: 5,
    });

    expect(scheduler.scheduled).toHaveLength(1);
    expect(scheduler.scheduled[0]).toMatchObject({
      delayMs: 5 * 60 * 1000,
    });

    service.markFinalResponseDelivered("child-3", {
      terminalStatus: "completed",
      autoDeleteMinutes: 5,
    });

    expect(scheduler.scheduled).toHaveLength(1);

    await scheduler.scheduled[0].run();

    expect(deleteForumTopic).toHaveBeenCalledWith({
      chatId: -100123,
      messageThreadId: 777,
    });
    expect(service.getScopeForSession("child-3")).toBeNull();
    expect(service.getTargetForSession("child-3")).toBeNull();
  });

  it("clears the deletion handle after a scheduled delete failure so cleanup can be retried", async () => {
    const createForumTopic = vi.fn().mockResolvedValue({ messageThreadId: 888 });
    const deleteForumTopic = vi
      .fn()
      .mockRejectedValueOnce(new Error("telegram delete failed"))
      .mockResolvedValueOnce(undefined);
    const scheduler = createSchedulerSpy();
    const service = new SubagentTopicService({
      createForumTopic,
      deleteForumTopic,
      scheduleDeletion: scheduler.scheduleDeletion,
    });

    await service.syncSubagent({
      childSessionId: "child-4",
      topicName: "Retry helper",
      parent: {
        chatId: -100123,
        isForum: true,
      },
    });

    service.markFinalResponseDelivered("child-4", {
      terminalStatus: "completed",
      autoDeleteMinutes: 5,
    });

    expect(scheduler.scheduled).toHaveLength(1);
    await expect(scheduler.scheduled[0].run()).resolves.toBeUndefined();
    expect(service.getScopeForSession("child-4")).toEqual({
      kind: "topic",
      childSessionId: "child-4",
      chatId: -100123,
      messageThreadId: 888,
      topicName: "Retry helper",
    });
    expect(service.getTargetForSession("child-4")).toEqual({
      chatId: -100123,
      messageThreadId: 888,
      disableNotification: true,
    });
    expect(loggerMock.error).toHaveBeenCalledWith(
      "[SubagentTopicService] Failed to delete scheduled subagent topic",
      expect.objectContaining({
        sessionId: "child-4",
        chatId: -100123,
        messageThreadId: 888,
        error: expect.any(Error),
      }),
    );

    service.markFinalResponseDelivered("child-4", {
      terminalStatus: "completed",
      autoDeleteMinutes: 5,
    });

    expect(scheduler.scheduled).toHaveLength(2);
    await expect(scheduler.scheduled[1].run()).resolves.toBeUndefined();
    expect(service.getScopeForSession("child-4")).toBeNull();
    expect(service.getTargetForSession("child-4")).toBeNull();
  });

  it("cancels a scheduled deletion and clears registry state when the session is cleared", async () => {
    const scheduler = createSchedulerSpy();
    const service = new SubagentTopicService({
      createForumTopic: vi.fn().mockResolvedValue({ messageThreadId: 999 }),
      deleteForumTopic: vi.fn().mockResolvedValue(undefined),
      scheduleDeletion: scheduler.scheduleDeletion,
    });

    await service.syncSubagent({
      childSessionId: "child-5",
      topicName: "Cleanup helper",
      parent: {
        chatId: -100123,
        isForum: true,
      },
    });

    service.markFinalResponseDelivered("child-5", {
      terminalStatus: "completed",
      autoDeleteMinutes: 5,
    });

    service.clearSession("child-5");

    expect(scheduler.cancel).toHaveBeenCalledTimes(1);
    expect(service.getScopeForSession("child-5")).toBeNull();
    expect(service.getTargetForSession("child-5")).toBeNull();
  });

  it("marks a session as stopped and clears its registry entry", () => {
    const service = new SubagentTopicService({
      createForumTopic: vi.fn(),
      deleteForumTopic: vi.fn(),
    });

    service.markSubagentStopped("stopped-1");

    const linkState = service.getLinkState("stopped-1");
    expect(linkState).toEqual({ kind: "stopped" });
    expect(service.getScopeForSession("stopped-1")).toBeNull();
    expect(service.getTargetForSession("stopped-1")).toBeNull();
  });

  it("returns active link state for a synced topic subagent", async () => {
    const service = new SubagentTopicService({
      createForumTopic: vi.fn().mockResolvedValue({ messageThreadId: 555 }),
      deleteForumTopic: vi.fn(),
    });

    await service.syncSubagent({
      childSessionId: "child-active",
      topicName: "Active helper",
      parent: { chatId: -100456, isForum: true },
    });

    const linkState = service.getLinkState("child-active");
    expect(linkState).toEqual({
      kind: "active",
      url: "https://t.me/c/-100456/555",
    });
  });

  it("returns null link state for a fallback subagent", async () => {
    const service = new SubagentTopicService({
      createForumTopic: vi.fn(),
      deleteForumTopic: vi.fn(),
    });

    await service.syncSubagent({
      childSessionId: "child-fallback",
      topicName: "Fallback helper",
      parent: { chatId: -100456, isForum: false },
    });

    const linkState = service.getLinkState("child-fallback");
    expect(linkState).toBeNull();
  });

  it("returns null link state for unknown session", () => {
    const service = new SubagentTopicService({
      createForumTopic: vi.fn(),
      deleteForumTopic: vi.fn(),
    });

    expect(service.getLinkState("unknown")).toBeNull();
  });

  it("markSubagentStopped returns stopped state over active", async () => {
    const service = new SubagentTopicService({
      createForumTopic: vi.fn().mockResolvedValue({ messageThreadId: 777 }),
      deleteForumTopic: vi.fn(),
    });

    await service.syncSubagent({
      childSessionId: "child-stopped-after",
      topicName: "Stopped helper",
      parent: { chatId: -100456, isForum: true },
    });

    service.markSubagentStopped("child-stopped-after");

    const linkState = service.getLinkState("child-stopped-after");
    expect(linkState).toEqual({ kind: "stopped" });
  });

  it("cancels every scheduled deletion when all sessions are cleared", async () => {
    const scheduler = createSchedulerSpy();
    const service = new SubagentTopicService({
      createForumTopic: vi
        .fn()
        .mockResolvedValueOnce({ messageThreadId: 101 })
        .mockResolvedValueOnce({ messageThreadId: 202 }),
      deleteForumTopic: vi.fn().mockResolvedValue(undefined),
      scheduleDeletion: scheduler.scheduleDeletion,
    });

    await service.syncSubagent({
      childSessionId: "child-6",
      topicName: "Cleanup helper A",
      parent: {
        chatId: -100123,
        isForum: true,
      },
    });
    await service.syncSubagent({
      childSessionId: "child-7",
      topicName: "Cleanup helper B",
      parent: {
        chatId: -100123,
        isForum: true,
      },
    });

    service.markFinalResponseDelivered("child-6", {
      terminalStatus: "completed",
      autoDeleteMinutes: 5,
    });
    service.markFinalResponseDelivered("child-7", {
      terminalStatus: "completed",
      autoDeleteMinutes: 5,
    });

    service.clearAll();

    expect(scheduler.cancel).toHaveBeenCalledTimes(2);
    expect(service.getScopeForSession("child-6")).toBeNull();
    expect(service.getTargetForSession("child-6")).toBeNull();
    expect(service.getScopeForSession("child-7")).toBeNull();
    expect(service.getTargetForSession("child-7")).toBeNull();
  });
});
