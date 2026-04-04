import { Context } from "grammy";
import { t } from "../../i18n/index.js";
import { config } from "../../config.js";
import { getLocalizedBotCommands } from "./definitions.js";

function formatHelpText(isAdmin: boolean): string {
  const commands = getLocalizedBotCommands({ isAdmin });
  const lines = commands.map((item) => `/${item.command} - ${item.description}`);

  return `📖 ${t("cmd.description.help")}

${lines.join("\n")}

${t("help.keyboard_hint")}`;
}

export async function helpCommand(ctx: Context): Promise<void> {
  const isAdmin = ctx.from?.id === config.telegram.adminUserId;
  await ctx.reply(formatHelpText(isAdmin));
}
