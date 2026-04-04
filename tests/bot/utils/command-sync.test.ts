import { describe, expect, it, vi } from "vitest";
import { getLocalizedBotCommands } from "../../../src/bot/commands/definitions.js";
import {
  resetDefaultMenuButton,
  syncAuthorizedChatCommands,
  syncUnauthorizedPrivateChatCommands,
} from "../../../src/bot/utils/command-sync.js";

function createApi() {
  return {
    setMyCommands: vi.fn().mockResolvedValue(true),
    setChatMenuButton: vi.fn().mockResolvedValue(true),
  };
}

describe("command sync helpers", () => {
  it("syncs commands and menu button for authorized private chats", async () => {
    const api = createApi();

    await syncAuthorizedChatCommands(api, 123, "private");

    expect(api.setMyCommands).toHaveBeenCalledWith(getLocalizedBotCommands({ isAdmin: false }), {
      scope: { type: "chat", chat_id: 123 },
    });
    expect(api.setChatMenuButton).toHaveBeenCalledWith({
      chat_id: 123,
      menu_button: { type: "commands" },
    });
  });

  it("exposes export_data with dedicated description", async () => {
    const commands = getLocalizedBotCommands({ isAdmin: false });
    const exportData = commands.find((item) => item.command === "export_data");

    expect(exportData).toBeDefined();
    expect(exportData?.description).not.toBe(getLocalizedBotCommands({ isAdmin: false }).find((item) => item.command === "help")?.description);
  });

  it("syncs only commands for non-private chats", async () => {
    const api = createApi();

    await syncAuthorizedChatCommands(api, -100123, "supergroup");

    expect(api.setMyCommands).toHaveBeenCalledWith(getLocalizedBotCommands({ isAdmin: false }), {
      scope: { type: "chat", chat_id: -100123 },
    });
    expect(api.setChatMenuButton).not.toHaveBeenCalled();
  });

  it("clears commands and restores default menu button for unauthorized private chats", async () => {
    const api = createApi();

    await syncUnauthorizedPrivateChatCommands(api, 456);

    expect(api.setMyCommands).toHaveBeenCalledWith(getLocalizedBotCommands({ isAdmin: false }), {
      scope: { type: "chat", chat_id: 456 },
    });
    expect(api.setChatMenuButton).toHaveBeenCalledWith({
      chat_id: 456,
      menu_button: { type: "commands" },
    });
  });

  it("resets the default menu button", async () => {
    const api = createApi();

    await resetDefaultMenuButton(api);

    expect(api.setChatMenuButton).toHaveBeenCalledWith({
      menu_button: { type: "default" },
    });
  });
});
