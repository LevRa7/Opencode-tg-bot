import { beforeEach, describe, expect, it } from "vitest";
import { attachManager } from "../../src/attach/manager.js";

describe("attachManager", () => {
  beforeEach(() => {
    attachManager.__resetForTests();
  });

  it("stores attached sessions independently per Telegram forum topic", () => {
    attachManager.attach(
      { userId: 10, chatId: -100, messageThreadId: 1 },
      { id: "session-a", title: "A", directory: "/repo/a" },
    );
    attachManager.attach(
      { userId: 10, chatId: -100, messageThreadId: 2 },
      { id: "session-b", title: "B", directory: "/repo/b" },
    );

    expect(
      attachManager.getAttachedSession({ userId: 10, chatId: -100, messageThreadId: 1 })?.id,
    ).toBe("session-a");
    expect(
      attachManager.getAttachedSession({ userId: 10, chatId: -100, messageThreadId: 2 })?.id,
    ).toBe("session-b");
  });

  it("finds the Telegram target for an attached OpenCode session", () => {
    attachManager.attach(
      { userId: 11, chatId: -200, messageThreadId: 77 },
      { id: "session-c", title: "C", directory: "/repo/c" },
    );

    expect(attachManager.getTargetForSession("session-c")).toEqual({
      chatId: -200,
      messageThreadId: 77,
    });
  });

  it("keeps latest session routing when an older scope reattaches another session", () => {
    attachManager.attach(
      { userId: 12, chatId: -300, messageThreadId: 1 },
      { id: "shared-session", title: "Shared", directory: "/repo/shared" },
    );
    attachManager.attach(
      { userId: 12, chatId: -300, messageThreadId: 2 },
      { id: "shared-session", title: "Shared", directory: "/repo/shared" },
    );
    attachManager.attach(
      { userId: 12, chatId: -300, messageThreadId: 1 },
      { id: "replacement-session", title: "Replacement", directory: "/repo/replacement" },
    );

    expect(attachManager.getTargetForSession("shared-session")).toEqual({
      chatId: -300,
      messageThreadId: 2,
    });
    expect(attachManager.getTargetForSession("replacement-session")).toEqual({
      chatId: -300,
      messageThreadId: 1,
    });
  });

  it("routes back to the newest remaining scope when the latest scope detaches", () => {
    attachManager.attach(
      { userId: 13, chatId: -400, messageThreadId: 1 },
      { id: "shared-session", title: "Shared", directory: "/repo/shared" },
      { attachedAt: "2026-01-01T00:00:00.000Z" },
    );
    attachManager.attach(
      { userId: 13, chatId: -400, messageThreadId: 2 },
      { id: "shared-session", title: "Shared", directory: "/repo/shared" },
      { attachedAt: "2026-01-01T00:01:00.000Z" },
    );

    attachManager.detach({ userId: 13, chatId: -400, messageThreadId: 2 });

    expect(attachManager.getTargetForSession("shared-session")).toEqual({
      chatId: -400,
      messageThreadId: 1,
    });
  });

  it("routes back to the newest remaining scope when the latest scope attaches another session", () => {
    attachManager.attach(
      { userId: 14, chatId: -500, messageThreadId: 1 },
      { id: "shared-session", title: "Shared", directory: "/repo/shared" },
      { attachedAt: "2026-01-01T00:00:00.000Z" },
    );
    attachManager.attach(
      { userId: 14, chatId: -500, messageThreadId: 2 },
      { id: "shared-session", title: "Shared", directory: "/repo/shared" },
      { attachedAt: "2026-01-01T00:01:00.000Z" },
    );

    attachManager.attach(
      { userId: 14, chatId: -500, messageThreadId: 2 },
      { id: "replacement-session", title: "Replacement", directory: "/repo/replacement" },
    );

    expect(attachManager.getTargetForSession("shared-session")).toEqual({
      chatId: -500,
      messageThreadId: 1,
    });
    expect(attachManager.getTargetForSession("replacement-session")).toEqual({
      chatId: -500,
      messageThreadId: 2,
    });
  });

  it("does not allow a different user to take over session routing", () => {
    attachManager.attach(
      { userId: 20, chatId: -600, messageThreadId: 1 },
      { id: "shared-session", title: "Shared", directory: "/repo/shared" },
    );

    attachManager.attach(
      { userId: 21, chatId: -601, messageThreadId: 2 },
      { id: "shared-session", title: "Shared", directory: "/repo/shared" },
    );

    expect(attachManager.getTargetForSession("shared-session")).toEqual({
      chatId: -600,
      messageThreadId: 1,
    });
    expect(
      attachManager.getAttachedSession({ userId: 20, chatId: -600, messageThreadId: 1 })?.id,
    ).toBe("shared-session");
    expect(
      attachManager.getAttachedSession({ userId: 21, chatId: -601, messageThreadId: 2 })?.id,
    ).toBe("shared-session");
  });
});
