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
  { command: "detach", descriptionKey: "cmd.description.detach" },
  { command: "sessions", descriptionKey: "cmd.description.sessions" },
  { command: "model", descriptionKey: "cmd.description.model" },
  { command: "variant", descriptionKey: "cmd.description.variant" },
  { command: "compact", descriptionKey: "cmd.description.compact" },
  { command: "settings", descriptionKey: "cmd.description.settings" },
  { command: "tts", descriptionKey: "cmd.description.tts" },
  { command: "projects", descriptionKey: "cmd.description.projects" },
  { command: "task", descriptionKey: "cmd.description.task" },
  { command: "tasklist", descriptionKey: "cmd.description.tasklist" },
  { command: "rename", descriptionKey: "cmd.description.rename" },
  { command: "commands", descriptionKey: "cmd.description.commands" },
  { command: "worktree", descriptionKey: "cmd.description.worktree" },
  { command: "skills", descriptionKey: "cmd.description.skills" },
  { command: "mcps", descriptionKey: "cmd.description.mcps" },
  { command: "open", descriptionKey: "cmd.description.open" },
  { command: "ls", descriptionKey: "cmd.description.ls" },
  { command: "stream", descriptionKey: "cmd.description.stream" },
  { command: "ssh", descriptionKey: "cmd.description.ssh" },
  { command: "restart", descriptionKey: "cmd.description.restart", adminOnly: true },
  { command: "opencode_start", descriptionKey: "cmd.description.opencode_start" },
  { command: "opencode_stop", descriptionKey: "cmd.description.opencode_stop" },
  { command: "share", descriptionKey: "cmd.description.share" },
  { command: "fork", descriptionKey: "cmd.description.fork" },
  { command: "revert", descriptionKey: "cmd.description.revert" },
  { command: "del", descriptionKey: "cmd.description.del" },
  { command: "connect", descriptionKey: "cmd.description.connect" },
  { command: "server", descriptionKey: "cmd.description.server" },
  { command: "memory", descriptionKey: "cmd.description.memory" },
  
  
  
  { command: "terminal", descriptionKey: "cmd.description.terminal" },
  { command: "help", descriptionKey: "cmd.description.help" },
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
