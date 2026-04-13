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

  it("does not expose export_data after feature removal", async () => {
    const commands = getLocalizedBotCommands({ isAdmin: false });

    expect(commands.find((item) => item.command === "export_data")).toBeUndefined();
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

  it("includes all commands except admin-only for non-admin authorized users", async () => {
    const commands = getLocalizedBotCommands({ isAdmin: false });

    expect(commands.find((c) => c.command === "restart")).toBeUndefined();
    expect(commands.find((c) => c.command === "status")).toBeDefined();
    expect(commands.find((c) => c.command === "help")).toBeDefined();
  });

  it("includes admin-only commands for admin users", async () => {
    const commands = getLocalizedBotCommands({ isAdmin: true });

    expect(commands.find((c) => c.command === "restart")).toBeDefined();
    expect(commands.find((c) => c.command === "status")).toBeDefined();
  });

  it("shows menu button for authorized non-admin private chats", async () => {
    const api = createApi();

    await syncAuthorizedChatCommands(api, 999, "private");

    expect(api.setChatMenuButton).toHaveBeenCalledWith({
      chat_id: 999,
      menu_button: { type: "commands" },
    });
  });

  it("passes isAdmin parameter to filter commands correctly", async () => {
    const api = createApi();

    await syncAuthorizedChatCommands(api, 1, "private", true);

    expect(api.setMyCommands).toHaveBeenCalledWith(getLocalizedBotCommands({ isAdmin: true }), {
      scope: { type: "chat", chat_id: 1 },
    });
  });
});
