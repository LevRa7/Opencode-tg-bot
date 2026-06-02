import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getCurrentOpencodeRoute } from "../../src/opencode/client.js";
import { sshManager } from "../../src/utils/ssh-manager.js";
import { getCurrentTelegramConversationScope } from "../../src/telegram/scope.js";

vi.mock("../../src/telegram/scope.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/telegram/scope.js")>();
  return {
    ...actual,
    getCurrentTelegramConversationScope: vi.fn(),
  };
});

vi.mock("../../src/utils/ssh-manager.js", () => ({
  sshManager: {
    isSshActive: vi.fn(),
    getLocalPort: vi.fn(),
    getActiveConnection: vi.fn(),
  },
}));

describe("opencode/client", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("hijacks route if active SSH session exists for user", () => {
    const mockScope = { userId: 12345, chatId: 67890 };
    vi.mocked(getCurrentTelegramConversationScope).mockReturnValue(mockScope as any);
    vi.mocked(sshManager.isSshActive).mockReturnValue(true);
    vi.mocked(sshManager.getLocalPort).mockReturnValue(49888);

    const route = getCurrentOpencodeRoute();

    expect(route).toEqual({
      runtimeKey: "ssh:12345",
      baseUrl: "http://127.0.0.1:49888",
      kind: "tenant",
      password: undefined,
      userId: 12345,
      chatId: 67890,
      tenantId: "ssh-12345",
    });
  });

  it("falls back to default tenant route if SSH is not active for user", () => {
    const mockScope = { userId: 12345, chatId: 67890 };
    vi.mocked(getCurrentTelegramConversationScope).mockReturnValue(mockScope as any);
    vi.mocked(sshManager.isSshActive).mockReturnValue(false);

    const route = getCurrentOpencodeRoute();
    expect(route.runtimeKey).not.toContain("ssh");
  });
});
