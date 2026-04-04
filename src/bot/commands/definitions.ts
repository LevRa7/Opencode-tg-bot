import type { I18nKey } from "../../i18n/en.js";
import { t } from "../../i18n/index.js";

export interface BotCommandDefinition {
  command: string;
  description: string;
}

interface BotCommandI18nDefinition {
  command: string;
  descriptionKey: I18nKey;
  adminOnly?: boolean;
}

const COMMAND_DEFINITIONS: BotCommandI18nDefinition[] = [
  { command: "status", descriptionKey: "cmd.description.status" },
  { command: "new", descriptionKey: "cmd.description.new" },
  { command: "abort", descriptionKey: "cmd.description.stop" },
  { command: "sessions", descriptionKey: "cmd.description.sessions" },
  { command: "tts", descriptionKey: "cmd.description.tts" },
  { command: "projects", descriptionKey: "cmd.description.projects" },
  { command: "task", descriptionKey: "cmd.description.task" },
  { command: "tasklist", descriptionKey: "cmd.description.tasklist" },
  { command: "rename", descriptionKey: "cmd.description.rename" },
  { command: "commands", descriptionKey: "cmd.description.commands" },
  { command: "stream", descriptionKey: "cmd.description.stream" },
  { command: "restart", descriptionKey: "cmd.description.restart", adminOnly: true },
  { command: "opencode_start", descriptionKey: "cmd.description.opencode_start" },
  { command: "opencode_stop", descriptionKey: "cmd.description.opencode_stop" },
  { command: "reasoning", descriptionKey: "cmd.description.reasoning" },
  { command: "help", descriptionKey: "cmd.description.help" },
  { command: "export_data", descriptionKey: "cmd.description.export_data" },
];

export function getLocalizedBotCommands(options?: { isAdmin?: boolean }): BotCommandDefinition[] {
  const isAdmin = options?.isAdmin ?? true;

  return COMMAND_DEFINITIONS.filter((definition) => isAdmin || !definition.adminOnly).map(
    ({ command, descriptionKey }) => ({
      command,
      description: t(descriptionKey),
    }),
  );
}

export const BOT_COMMANDS: BotCommandDefinition[] = getLocalizedBotCommands({ isAdmin: true });
