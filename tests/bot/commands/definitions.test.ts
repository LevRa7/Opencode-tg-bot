import { describe, expect, it } from "vitest";
import { getLocalizedBotCommands } from "../../../src/bot/commands/definitions.js";

describe("bot/commands/definitions", () => {
  it("includes the ssh command in localized bot commands", () => {
    const commands = getLocalizedBotCommands({ isAdmin: true });
    const sshCommand = commands.find((cmd) => cmd.command === "ssh");
    
    expect(sshCommand).toBeDefined();
    expect(sshCommand?.description).toBe("Manage remote SSH servers");
  });
});
