import { describe, expect, it, vi, beforeEach } from "vitest";

// Test the session verification logic in isolation.
// The function under test is the pattern:
//   if (deployTarget === "vm") → session.get() → if error → clearSession()
// Extracted from the SSH verification pattern at prompt.ts:754-776

const mocked = vi.hoisted(() => ({
  opencodeClient: {
    session: {
      get: vi.fn(),
      create: vi.fn(),
    },
  },
  getCurrentSession: vi.fn(),
  clearSession: vi.fn(),
  getUserDeployTarget: vi.fn(),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: mocked.opencodeClient,
}));

vi.mock("../../../src/settings/manager.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/settings/manager.js")>();
  return {
    ...actual,
    getCurrentSession: (...args: unknown[]) => mocked.getCurrentSession(...args),
    clearSession: (...args: unknown[]) => mocked.clearSession(...args),
    getUserDeployTarget: (...args: unknown[]) => mocked.getUserDeployTarget(...args),
  };
});

import { opencodeClient } from "../../../src/opencode/client.js";
import {
  getCurrentSession,
  clearSession,
  getUserDeployTarget,
} from "../../../src/settings/manager.js";

/**
 * Replicates the session verification logic that will be added to prompt.ts.
 * This is the extracted pure logic — no grammy context, no keyboard, no event subscriptions.
 */
async function verifyVmSessionBeforePrompt(
  scope: { userId: number },
): Promise<{ sessionCleared: boolean; reason?: string }> {
  const currentSession = getCurrentSession();
  if (!currentSession || !scope) {
    return { sessionCleared: false };
  }

  const deployTarget = getUserDeployTarget(scope.userId);
  if (deployTarget !== "vm") {
    return { sessionCleared: false };
  }

  try {
    const { data, error } = await opencodeClient.session.get({
      directory: currentSession.directory,
      sessionID: currentSession.id,
    });

    if (error || !data) {
      clearSession();
      return {
        sessionCleared: true,
        reason: error
          ? `Session not found on VM: ${JSON.stringify(error)}`
          : "Session data is null",
      };
    }
  } catch {
    clearSession();
    return { sessionCleared: true, reason: "Network error verifying session" };
  }

  return { sessionCleared: false };
}

describe("verifyVmSessionBeforePrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing when no current session", async () => {
    mocked.getCurrentSession.mockReturnValue(null);

    const result = await verifyVmSessionBeforePrompt({ userId: 123 });

    expect(result.sessionCleared).toBe(false);
    expect(mocked.opencodeClient.session.get).not.toHaveBeenCalled();
  });

  it("does nothing when deploy target is not 'vm'", async () => {
    mocked.getCurrentSession.mockReturnValue({
      id: "ses_test",
      title: "Test",
      directory: "/",
    });
    mocked.getUserDeployTarget.mockReturnValue("host");

    const result = await verifyVmSessionBeforePrompt({ userId: 123 });

    expect(result.sessionCleared).toBe(false);
    expect(mocked.opencodeClient.session.get).not.toHaveBeenCalled();
  });

  it("does nothing when deploy target is 'ssh'", async () => {
    mocked.getCurrentSession.mockReturnValue({
      id: "ses_test",
      title: "Test",
      directory: "/",
    });
    mocked.getUserDeployTarget.mockReturnValue("ssh");

    const result = await verifyVmSessionBeforePrompt({ userId: 123 });

    expect(result.sessionCleared).toBe(false);
    expect(mocked.opencodeClient.session.get).not.toHaveBeenCalled();
  });

  it("clears session when VM session.get returns error", async () => {
    mocked.getCurrentSession.mockReturnValue({
      id: "ses_old123",
      title: "Old session",
      directory: "/",
    });
    mocked.getUserDeployTarget.mockReturnValue("vm");
    mocked.opencodeClient.session.get.mockResolvedValue({
      data: null,
      error: { name: "NotFoundError", message: "Session not found: ses_old123" },
    });

    const result = await verifyVmSessionBeforePrompt({ userId: 456 });

    expect(result.sessionCleared).toBe(true);
    expect(result.reason).toContain("Session not found");
    expect(mocked.clearSession).toHaveBeenCalledOnce();
    expect(mocked.opencodeClient.session.get).toHaveBeenCalledWith({
      directory: "/",
      sessionID: "ses_old123",
    });
  });

  it("clears session when VM session.get returns null data", async () => {
    mocked.getCurrentSession.mockReturnValue({
      id: "ses_null",
      title: "Null session",
      directory: "/proj",
    });
    mocked.getUserDeployTarget.mockReturnValue("vm");
    mocked.opencodeClient.session.get.mockResolvedValue({
      data: null,
      error: null,
    });

    const result = await verifyVmSessionBeforePrompt({ userId: 789 });

    expect(result.sessionCleared).toBe(true);
    expect(result.reason).toBe("Session data is null");
    expect(mocked.clearSession).toHaveBeenCalledOnce();
  });

  it("clears session when VM session.get throws network error", async () => {
    mocked.getCurrentSession.mockReturnValue({
      id: "ses_net",
      title: "Net session",
      directory: "/",
    });
    mocked.getUserDeployTarget.mockReturnValue("vm");
    mocked.opencodeClient.session.get.mockRejectedValue(
      new Error("fetch failed"),
    );

    const result = await verifyVmSessionBeforePrompt({ userId: 999 });

    expect(result.sessionCleared).toBe(true);
    expect(result.reason).toContain("Network error");
    expect(mocked.clearSession).toHaveBeenCalledOnce();
  });

  it("keeps session when VM session.get succeeds", async () => {
    mocked.getCurrentSession.mockReturnValue({
      id: "ses_ok",
      title: "Good session",
      directory: "/",
    });
    mocked.getUserDeployTarget.mockReturnValue("vm");
    mocked.opencodeClient.session.get.mockResolvedValue({
      data: { id: "ses_ok", title: "Good session" },
      error: null,
    });

    const result = await verifyVmSessionBeforePrompt({ userId: 111 });

    expect(result.sessionCleared).toBe(false);
    expect(mocked.clearSession).not.toHaveBeenCalled();
    expect(mocked.opencodeClient.session.get).toHaveBeenCalledWith({
      directory: "/",
      sessionID: "ses_ok",
    });
  });

  it("does nothing when deploy target is undefined (not set)", async () => {
    mocked.getCurrentSession.mockReturnValue({
      id: "ses_x",
      title: "X",
      directory: "/",
    });
    mocked.getUserDeployTarget.mockReturnValue(undefined);

    const result = await verifyVmSessionBeforePrompt({ userId: 0 });

    expect(result.sessionCleared).toBe(false);
    expect(mocked.opencodeClient.session.get).not.toHaveBeenCalled();
  });
});
