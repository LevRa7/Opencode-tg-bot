import { describe, expect, it, vi } from "vitest";
import { BOT_COMMANDS } from "../../../src/bot/commands/definitions.js";
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

    expect(api.setMyCommands).toHaveBeenCalledWith(BOT_COMMANDS, {
      scope: { type: "chat", chat_id: 123 },
    });
    expect(api.setChatMenuButton).toHaveBeenCalledWith({
      chat_id: 123,
      menu_button: { type: "commands" },
    });
  });

  it("syncs only commands for non-private chats", async () => {
    const api = createApi();

    await syncAuthorizedChatCommands(api, -100123, "supergroup");

    expect(api.setMyCommands).toHaveBeenCalledWith(BOT_COMMANDS, {
      scope: { type: "chat", chat_id: -100123 },
    });
    expect(api.setChatMenuButton).not.toHaveBeenCalled();
  });

  it("clears commands and restores default menu button for unauthorized private chats", async () => {
    const api = createApi();

    await syncUnauthorizedPrivateChatCommands(api, 456);

    expect(api.setMyCommands).toHaveBeenCalledWith([], {
      scope: { type: "chat", chat_id: 456 },
    });
    expect(api.setChatMenuButton).toHaveBeenCalledWith({
      chat_id: 456,
      menu_button: { type: "default" },
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
